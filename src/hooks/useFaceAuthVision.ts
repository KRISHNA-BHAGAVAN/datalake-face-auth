import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'react-native';
import { useCameraDevice, useCameraPermission, usePhotoOutput } from 'react-native-vision-camera';
import { useFaceDetectorOutput, type Face } from 'react-native-vision-camera-face-detector';
// Still-image detection for the capture burst. NOT the vision-camera-face-detector's
// useImageFaceDetector — that module's native detectFaces is broken on Android (it
// receives the Nitro-boxed `InputImage` sealed class but checks `is String`/`is Map`,
// so every input hits the `else` branch → "Invalid image type"). This ML Kit binding
// detects on a file URI correctly and is already in the native build (legacy path used it).
import FaceDetection from '@react-native-ml-kit/face-detection';

import { useLiveness } from '../liveness/useLiveness';
import { FaceRecognizer } from '../ml/FaceRecognizer';
import { FaceAntiSpoof } from '../ml/FaceAntiSpoof';
import { ImageProcessor } from '../ml/ImageProcessor';
import { OfflineStore } from '../storage/OfflineStore';
import { computeCosineSimilarity, averageEmbeddings } from '../recognition/CosineSimilarity';
import { FrameQuality } from '../recognition/FrameQuality';
import { config } from '../utils/config';
import { FaceLandmarkResult, LivenessChallengeType } from '../types';
import { logger } from '../utils/logger';

type AuthStatus = 'IDLE' | 'ENROLLING' | 'VERIFYING' | 'SUCCESS' | 'FAILED';
type Facing = 'front' | 'back';
type AuthAction = 'ENROLL' | 'VERIFY';

const STALE_SESSION_ERROR = 'STALE_FACE_AUTH_SESSION';

const challengesForAction = (action: AuthAction): LivenessChallengeType[] =>
  action === 'ENROLL' ? ['SMILE', 'TURN_HEAD_LEFT', 'TURN_HEAD_RIGHT'] : ['BLINK'];

const errorToMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * VisionCamera-based face auth. Liveness runs on the real-time native frame stream
 * (face-detector output → no takePictureAsync, no JS JPEG decode). The heavy work
 * (anti-spoof + recognition embeddings) runs once, in a short photo burst the moment
 * liveness passes. Public API matches the legacy useFaceAuth hook so the UI is unchanged.
 */
export function useFaceAuthVision() {
  const { livenessState, startLiveness, processFrame, resetLiveness } = useLiveness();
  const { hasPermission, requestPermission } = useCameraPermission();

  const [authStatus, setAuthStatus] = useState<AuthStatus>('IDLE');
  const [message, setMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [facing, setFacing] = useState<Facing>('front');
  const [modelsReady, setModelsReady] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  const device = useCameraDevice(facing);

  const currentAction = useRef<AuthAction | null>(null);
  const livenessStatusRef = useRef(livenessState.status);
  const resolvingRef = useRef(false); // guards the one-shot end burst
  const flowSessionRef = useRef(0);

  /**
   * "Shutter fired" notifications for the UI, delivered WITHOUT React state.
   *
   * A re-render during the capture burst is not free here. `useFaceDetectorOutput`
   * memoises on a rest-spread object that is rebuilt on every call, so its
   * `useMemo` never hits and it hands back a NEW native output each render —
   * which makes `<Camera outputs>` tear down and rebind the capture session.
   * One `setState` per photo therefore killed the burst: captures threw
   * "Not bound to a valid Camera" and enrollment never collected its embeddings.
   * (The same effect is why `capturePhotoWithRetry` exists: the single
   * `setIsProcessing(true)` before the burst already rebinds once.)
   *
   * So the overlay subscribes to this instead and animates imperatively.
   */
  const captureSubscribers = useRef(new Set<() => void>());
  const subscribeCapture = useCallback((fn: () => void) => {
    captureSubscribers.current.add(fn);
    return () => {
      captureSubscribers.current.delete(fn);
    };
  }, []);
  const emitCapture = useCallback(() => {
    captureSubscribers.current.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        // A broken listener must never take down the capture pipeline.
        logger.warn('capture listener failed', e);
      }
    });
  }, []);

  useEffect(() => {
    livenessStatusRef.current = livenessState.status;
  }, [livenessState.status]);

  useEffect(() => {
    let cancelled = false;

    Promise.all([FaceRecognizer.init(), FaceAntiSpoof.init()])
      .then(() => {
        if (!cancelled) {
          setModelsReady(true);
          setModelError(null);
        }
      })
      .catch((e) => {
        logger.error('Failed to load ML models', e);
        if (!cancelled) {
          setModelsReady(false);
          setModelError(errorToMessage(e));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const isStaleSession = useCallback(
    (sessionId: number) => sessionId !== flowSessionRef.current || !currentAction.current,
    []
  );

  const assertCurrentSession = useCallback(
    (sessionId: number) => {
      if (isStaleSession(sessionId)) {
        throw new Error(STALE_SESSION_ERROR);
      }
    },
    [isStaleSession]
  );

  const failAuth = useCallback((userMessage: string) => {
    flowSessionRef.current += 1;
    currentAction.current = null;
    setIsProcessing(false);
    setAuthStatus('FAILED');
    setMessage(userMessage);
  }, []);

  // --- Real-time liveness from the frame stream ----------------------------
  // The face-detector output calls this on the JS thread with detected faces.
  // We only drive the liveness state machine here; nothing heavy runs per frame.
  const onFacesDetected = useCallback(
    (faces: Face[]) => {
      if (!currentAction.current) return;
      const status = livenessStatusRef.current;
      if (status === 'PASSED' || status === 'FAILED') return;

      if (!faces.length) {
        processFrame({
          hasFace: false,
          boundingBox: null,
          blendshapes: null,
          yaw: 0,
          pitch: 0,
          roll: 0,
        });
        return;
      }

      const f = faces[0];

      // Face-validity gate. ML Kit only returns eye-open / smile classifications when
      // it has actually located eyes and a mouth on a detected face. A fist or random
      // blob that the detector false-positives on lacks these, so we treat it as
      // "no face" and refuse to advance the liveness challenges on a non-face.
      const hasClassifications =
        f.smilingProbability != null &&
        f.leftEyeOpenProbability != null &&
        f.rightEyeOpenProbability != null;
      if (!hasClassifications) {
        setMessage('Position your face clearly in view');
        processFrame({
          hasFace: false,
          boundingBox: null,
          blendshapes: null,
          yaw: 0,
          pitch: 0,
          roll: 0,
        });
        return;
      }

      // Real-time quality hints during live stream
      if (Math.abs(f.pitchAngle) > config.quality.maxPitchDeg) {
        setMessage('Keep your head level');
      } else if (
        (f.yawAngle < -35 || f.yawAngle > 35)
      ) {
        setMessage('Face the camera directly');
      } else {
        setMessage('');
      }

      const result: FaceLandmarkResult = {
        hasFace: true,
        boundingBox: { x: f.bounds.x, y: f.bounds.y, width: f.bounds.width, height: f.bounds.height },
        blendshapes: null,
        // Angles stay in DEGREES — the liveness state machine + config thresholds are
        // calibrated in degrees (legacy useFaceAuth used `-face.rotationY`, degrees).
        // yaw negated to match the legacy user-relative sign for the front camera.
        // VERIFY ON DEVICE: if turn-left/right are swapped, drop the negation.
        yaw: -f.yawAngle,
        pitch: f.pitchAngle,
        roll: f.rollAngle,
        smilingProbability: f.smilingProbability,
        leftEyeOpenProbability: f.leftEyeOpenProbability,
        rightEyeOpenProbability: f.rightEyeOpenProbability,
      };
      processFrame(result);
    },
    [processFrame]
  );

  const onError = useCallback((e: Error) => logger.warn('Face detector error', e), []);

  const faceOutput = useFaceDetectorOutput(
    useMemo(
      () => ({
        onFacesDetected,
        onError,
        // 'accurate' over 'fast': fewer non-face false-positives (e.g. a fist) and
        // stabler angles. The heavy per-frame JS decode is gone (native detection),
        // so we can afford it on the live liveness stream.
        performanceMode: 'accurate' as const,
        minFaceSize: 0.2, // ignore small/distant blobs; face must fill a fair part of frame
        runClassifications: true, // eye-open / smile probabilities for liveness
        runLandmarks: false, // not needed for liveness; alignment uses the still capture
        cameraFacing: facing,
        outputResolution: 'preview' as const,
      }),
      [onFacesDetected, onError, facing]
    )
  );

  const photoOutput = usePhotoOutput();
  const photoOutputRef = useRef(photoOutput);
  photoOutputRef.current = photoOutput;

  // --- One-shot recognition burst (runs when liveness passes) --------------
  const getImageSize = (uri: string) =>
    new Promise<{ width: number; height: number }>((resolve, reject) =>
      Image.getSize(uri, (width, height) => resolve({ width, height }), reject)
    );

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  // CameraX ImageCapture is bound asynchronously after the session is active;
  // the first capture(s) the instant liveness passes can throw
  // "Not bound to a valid Camera" while the photo use-case is still binding
  // (the running frame-analysis pipeline delays it). Retry briefly.
  const capturePhotoWithRetry = useCallback(async (attempts = 8, delayMs = 250) => {
    let lastErr: unknown;
    for (let a = 0; a < attempts; a++) {
      try {
        return await photoOutputRef.current.capturePhotoToFile({ enableShutterSound: false }, {});
      } catch (e) {
        lastErr = e;
        await sleep(delayMs);
      }
    }
    throw lastErr;
  }, []);

  const captureEmbeddings = useCallback(async (sessionId: number) => {
    if (!modelsReady) {
      throw new Error('Face models are still loading');
    }
    assertCurrentSession(sessionId);

    const wanted =
      currentAction.current === 'VERIFY'
        ? config.recognition.verifyEmbeddings
        : config.recognition.enrollEmbeddings;

    // Give CameraX a moment to bind the photo use-case before the burst.
    await sleep(300);
    assertCurrentSession(sessionId);

    const embeddings: number[][] = [];
    const spoofScores: number[] = [];
    let lastEmbedMs = 0;
    let lastIssue: string | null = null;

    const meanSpoofScore = () =>
      spoofScores.reduce((a, b) => a + b, 0) / spoofScores.length;

    /**
     * Have we sampled the anti-spoof model enough to commit? Stop early when the
     * running mean is clearly on one side of the boundary; keep sampling while
     * it's ambiguous, up to maxChecks.
     */
    const spoofDecided = () => {
      const { maxChecks, confidentLiveScore, confidentSpoofScore } = config.antiSpoof;
      if (spoofScores.length === 0) return false;
      if (spoofScores.length >= maxChecks) return true;
      const mean = meanSpoofScore();
      return mean >= confidentLiveScore || mean <= confidentSpoofScore;
    };

    // Collect up to `wanted` GOOD embeddings, with spare attempts so a single
    // blurry/off-angle frame doesn't sink the burst. We also keep going while the
    // anti-spoof verdict is still ambiguous, so the extra latency is only paid on
    // genuinely borderline faces.
    const maxAttempts = wanted + config.antiSpoof.maxChecks;

    for (let i = 0; i < maxAttempts && (embeddings.length < wanted || !spoofDecided()); i++) {
      let uri: string;
      try {
        const photo = await capturePhotoWithRetry();
        assertCurrentSession(sessionId);
        uri = photo.filePath.startsWith('file://') ? photo.filePath : `file://${photo.filePath}`;
        emitCapture();
      } catch (e) {
        if (errorToMessage(e) === STALE_SESSION_ERROR) throw e;
        lastIssue = `photo capture failed: ${errorToMessage(e)}`;
        logger.warn('capturePhotoToFile failed', e);
        continue;
      }

      // 'fast' is enough here: the face was already validated on the live stream,
      // and 'accurate' roughly doubles still-detect time.
      let faces: Awaited<ReturnType<typeof FaceDetection.detect>>;
      try {
        faces = await FaceDetection.detect(uri, {
          performanceMode: 'fast',
          landmarkMode: 'all', // eye positions for alignment
          classificationMode: 'all',
        });
        assertCurrentSession(sessionId);
      } catch (e) {
        if (errorToMessage(e) === STALE_SESSION_ERROR) throw e;
        lastIssue = `still-face detection failed: ${errorToMessage(e)}`;
        logger.warn('still-face detection failed', e);
        continue;
      }
      if (!faces.length) {
        lastIssue = 'no face found in captured photo';
        continue;
      }
      const f = faces[0];

      let width: number;
      let height: number;
      try {
        ({ width, height } = await getImageSize(uri));
        assertCurrentSession(sessionId);
      } catch (e) {
        if (errorToMessage(e) === STALE_SESSION_ERROR) throw e;
        lastIssue = `captured photo could not be read: ${errorToMessage(e)}`;
        logger.warn('captured photo could not be read', e);
        continue;
      }
      const normBox = {
        x: f.frame.left / width,
        y: f.frame.top / height,
        width: f.frame.width / width,
        height: f.frame.height / height,
      };

      // Quality gate first (geometry uses degrees, like FrameQuality expects).
      // Anti-spoof used to run before this, which meant a blurry or badly-lit frame
      // — one the pipeline was about to discard anyway — could still produce the
      // spoof verdict that failed the whole attempt. MiniFASNet keys on texture, so
      // an out-of-focus frame reads as a print attack. Only score good frames.
      const geo = FrameQuality.assessGeometry(
        { frame: { width: f.frame.width }, rotationX: f.rotationX, rotationY: f.rotationY },
        width
      );
      if (!geo.ok) {
        lastIssue = geo.reason;
        setMessage(geo.reason);
        continue;
      }

      const lm = f.landmarks;
      const eyes =
        lm?.leftEye && lm?.rightEye
          ? { left: lm.leftEye.position, right: lm.rightEye.position }
          : null;

      let tensor: Awaited<ReturnType<typeof ImageProcessor.processFaceImage>>;
      try {
        tensor = await ImageProcessor.processFaceImage(uri, width, height, normBox, eyes);
        assertCurrentSession(sessionId);
      } catch (e) {
        if (errorToMessage(e) === STALE_SESSION_ERROR) throw e;
        lastIssue = `face preprocessing failed: ${errorToMessage(e)}`;
        logger.warn('face preprocessing failed', e);
        continue;
      }

      const pixelQuality = FrameQuality.assessPixels(tensor.sharpness, tensor.brightness);
      if (!pixelQuality.ok) {
        lastIssue = pixelQuality.reason;
        setMessage(pixelQuality.reason);
        continue;
      }

      // Anti-spoof on a frame that already passed quality.
      if (!spoofDecided()) {
        try {
          const spoofBuf = await ImageProcessor.processAntiSpoofImage(uri, width, height, normBox);
          assertCurrentSession(sessionId);
          const spoof = await FaceAntiSpoof.classify(spoofBuf);
          assertCurrentSession(sessionId);
          spoofScores.push(spoof.liveScore);
        } catch (e) {
          if (errorToMessage(e) === STALE_SESSION_ERROR) throw e;
          lastIssue = `anti-spoof check failed: ${errorToMessage(e)}`;
          logger.warn('anti-spoof failed', e);
        }
      }

      if (embeddings.length < wanted) {
        try {
          const t0 = Date.now();
          const emb = await FaceRecognizer.getEmbedding(tensor.input);
          assertCurrentSession(sessionId);
          lastEmbedMs = Date.now() - t0;
          embeddings.push(emb);
          if (embeddings.length < wanted) {
            setMessage(`Captured frame ${embeddings.length} of ${wanted}`);
          } else {
            setMessage('Processing biometric template...');
          }
        } catch (e) {
          if (errorToMessage(e) === STALE_SESSION_ERROR) throw e;
          lastIssue = `embedding failed: ${errorToMessage(e)}`;
          logger.warn('embedding failed', e);
        }
      }
    }

    // Fail-open when every check errored (unchanged behaviour): the liveness
    // challenges already ran, and a transient tflite error shouldn't lock a genuine
    // user out. `lastIssue` carries the reason.
    const spoofScore = spoofScores.length > 0 ? meanSpoofScore() : null;
    const spoofed = spoofScore != null && spoofScore < config.antiSpoof.liveScoreThreshold;
    return { embeddings, spoofed, spoofScore, lastEmbedMs, lastIssue };
  }, [assertCurrentSession, capturePhotoWithRetry, emitCapture, modelsReady]);

  // Resolve the flow once liveness reaches a terminal state.
  useEffect(() => {
    if (!currentAction.current) return;

    if (livenessState.status === 'FAILED') {
      failAuth(livenessState.message || 'Liveness check failed. Please try again.');
      return;
    }
    if (livenessState.status !== 'PASSED' || resolvingRef.current) return;

    resolvingRef.current = true;
    const sessionId = flowSessionRef.current;
    const run = async () => {
      setIsProcessing(true);
      const startedAt = Date.now();
      try {
        const { embeddings, spoofed, spoofScore, lastEmbedMs, lastIssue } =
          await captureEmbeddings(sessionId);
        if (isStaleSession(sessionId)) return;

        if (spoofed) {
          logger.log(`[AntiSpoof] rejected, mean live score ${spoofScore?.toFixed(3)}`);
          failAuth('Presentation attack detected. Use your real face, not a photo or screen.');
          return;
        }
        if (embeddings.length === 0) {
          failAuth(
            lastIssue
              ? `Could not capture a clear face (${lastIssue}). Please try again.`
              : 'Could not capture a clear face. Please try again.'
          );
          return;
        }

        const avg = averageEmbeddings(embeddings);
        const action = currentAction.current;
        if (!action || isStaleSession(sessionId)) return;

        if (action === 'ENROLL') {
          const existing = await OfflineStore.getTemplates();
          if (isStaleSession(sessionId)) return;
          let maxSim = -1;
          for (const t of existing) {
            const sim = computeCosineSimilarity(avg, t.embedding);
            if (sim > maxSim) maxSim = sim;
          }
          if (maxSim >= config.enroll.duplicateThreshold) {
            currentAction.current = null;
            setConfidence(maxSim);
            setAuthStatus('SUCCESS');
            setMessage(
              `Already enrolled — matched an existing template at ${(maxSim * 100).toFixed(0)}%. No duplicate added.`
            );
            return;
          }
          await OfflineStore.saveTemplate({
            id: `user-${Date.now()}`,
            embedding: avg,
            createdAt: Date.now(),
            isSynced: false,
          });
          if (isStaleSession(sessionId)) return;
          currentAction.current = null;
          setAuthStatus('SUCCESS');
          setMessage('Enrollment successful! Face template saved offline.');
          return;
        }

        // VERIFY
        const templates = await OfflineStore.getTemplates();
        if (isStaleSession(sessionId)) return;
        if (templates.length === 0) {
          failAuth('Verification failed: no enrolled templates.');
          return;
        }
        const matchStart = Date.now();
        let maxSim = -1;
        for (const t of templates) {
          const sim = computeCosineSimilarity(avg, t.embedding);
          if (sim > maxSim) maxSim = sim;
        }
        const recognitionMs = lastEmbedMs + (Date.now() - matchStart);
        currentAction.current = null;
        setConfidence(maxSim);
        setLatencyMs(recognitionMs);
        if (maxSim >= config.recognition.cosineSimilarityThreshold) {
          setAuthStatus('SUCCESS');
          setMessage('Identity verified against your enrolled template.');
        } else {
          setAuthStatus('FAILED');
          setMessage('Face not recognized. Score is below the match threshold.');
        }
      } catch (e) {
        if (errorToMessage(e) === STALE_SESSION_ERROR) return;
        logger.error('Recognition burst error', e);
        failAuth('Error during face processing.');
      } finally {
        if (sessionId === flowSessionRef.current) {
          setIsProcessing(false);
        }
        void startedAt;
      }
    };
    run();
  }, [livenessState.status, livenessState.message, captureEmbeddings, failAuth, isStaleSession]);

  // --- Controls ------------------------------------------------------------
  const begin = useCallback(
    (action: AuthAction, challenges: LivenessChallengeType[]) => {
      if (modelError) {
        failAuth(`Face engine failed to load: ${modelError}`);
        return;
      }
      if (!modelsReady) {
        setAuthStatus('IDLE');
        setMessage('Preparing face engine...');
        return;
      }
      flowSessionRef.current += 1;
      resolvingRef.current = false;
      livenessStatusRef.current = 'IN_PROGRESS';
      currentAction.current = action;
      setAuthStatus(action === 'ENROLL' ? 'ENROLLING' : 'VERIFYING');
      setConfidence(null);
      setLatencyMs(null);
      setIsProcessing(false);
      setMessage('Follow the prompts. Anti-spoof and liveness checks are active.');
      resetLiveness();
      startLiveness(challenges);
    },
    [failAuth, modelError, modelsReady, resetLiveness, startLiveness]
  );

  const startEnrollment = useCallback(
    () => begin('ENROLL', challengesForAction('ENROLL')),
    [begin]
  );
  const startVerification = useCallback(() => begin('VERIFY', challengesForAction('VERIFY')), [begin]);

  const reset = useCallback(() => {
    flowSessionRef.current += 1;
    resolvingRef.current = false;
    livenessStatusRef.current = 'IDLE';
    currentAction.current = null;
    setAuthStatus('IDLE');
    setMessage('');
    setConfidence(null);
    setLatencyMs(null);
    setIsProcessing(false);
    resetLiveness();
  }, [resetLiveness]);

  const toggleFacing = useCallback(() => {
    const action = currentAction.current;
    // Invalidate session immediately on camera flip
    flowSessionRef.current += 1;
    resolvingRef.current = false;
    livenessStatusRef.current = action ? 'IN_PROGRESS' : 'IDLE';
    setIsProcessing(false);
    setConfidence(null);
    setLatencyMs(null);
    resetLiveness();

    setFacing((p) => (p === 'front' ? 'back' : 'front'));

    if (action) {
      begin(action, challengesForAction(action));
    } else {
      reset();
    }
  }, [begin, reset, resetLiveness]);

  // Keep the camera session running only while a flow is active.
  const isActive = authStatus === 'ENROLLING' || authStatus === 'VERIFYING';

  return {
    // liveness / auth
    livenessState,
    authStatus,
    message,
    isProcessing,
    /** Subscribe to per-photo shutter events. Fires no re-render — see above. */
    subscribeCapture,
    confidence,
    latencyMs,
    modelsReady,
    modelError,
    // camera
    device,
    hasPermission,
    requestPermission,
    facing,
    toggleFacing,
    isActive,
    faceOutput,
    photoOutput,
    // controls
    startEnrollment,
    startVerification,
    reset,
  };
}

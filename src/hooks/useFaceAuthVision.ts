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
import { SQLiteStore } from '../storage/SQLiteStore';
import { LocationService } from '../services/LocationService';
import {
  computeCosineSimilarity,
  computeWeightedCosineSimilarity,
  getPeriocularWeights,
  averageEmbeddings,
} from '../recognition/CosineSimilarity';
import { FrameQuality } from '../recognition/FrameQuality';
import { config } from '../utils/config';
import { FaceLandmarkResult, FaceTemplate, LivenessChallengeType } from '../types';
import { logger } from '../utils/logger';
import { BenchmarkMetrics } from '../components/ui/BenchmarkBadge';

type AuthStatus = 'IDLE' | 'ENROLLING' | 'VERIFYING' | 'SUCCESS' | 'FAILED';
type Facing = 'front' | 'back';
type AuthAction = 'ENROLL' | 'VERIFY';

const STALE_SESSION_ERROR = 'STALE_FACE_AUTH_SESSION';

const FACE_AUTH_PHOTO_RESOLUTION = { width: 768, height: 1024 } as const;
const FACE_AUTH_CAPTURE_SETTINGS = {
  enableShutterSound: false,
  enableVirtualDeviceFusion: false,
  enableRedEyeReduction: false,
  enableDistortionCorrection: false,
} as const;

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
  const [benchmarkMetrics, setBenchmarkMetrics] = useState<BenchmarkMetrics | null>(null);
  const [facing, setFacing] = useState<Facing>('front');
  const [modelsReady, setModelsReady] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [matchedImageUri, setMatchedImageUri] = useState<string | null>(null);
  const [probeImageUri, setProbeImageUri] = useState<string | null>(null);
  const [capturedFrameUris, setCapturedFrameUris] = useState<string[]>([]);

  const device = useCameraDevice(facing);

  const currentAction = useRef<AuthAction | null>(null);
  const livenessStatusRef = useRef(livenessState.status);
  const resolvingRef = useRef(false); // guards the one-shot end burst
  const flowSessionRef = useRef(0);
  const flowStartTimeRef = useRef<number>(0);
  const livenessDurationRef = useRef<number>(0);

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

  const getImageSize = (uri: string) =>
    new Promise<{ width: number; height: number }>((resolve, reject) =>
      Image.getSize(uri, (width, height) => resolve({ width, height }), reject)
    );

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const capturePhotoWithRetry = useCallback(async (attempts = 8, delayMs = 100) => {
    let lastErr: unknown;
    for (let a = 0; a < attempts; a++) {
      try {
        return await photoOutputRef.current.capturePhotoToFile(FACE_AUTH_CAPTURE_SETTINGS, {});
      } catch (e) {
        lastErr = e;
        await sleep(delayMs);
      }
    }
    throw lastErr;
  }, []);

  // --- Real-time liveness from the frame stream ----------------------------
  const onFacesDetected = useCallback(
    (faces: Face[]) => {
      if (!currentAction.current) return;
      const status = livenessStatusRef.current;
      if (status === 'PASSED' || status === 'FAILED') return;

      // Edge Case 6: Reject Multiple Faces in Frame (Spoof photo next to person)
      if (faces.length > 1) {
        setMessage('Multiple faces detected! Ensure only 1 person is in frame.');
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

      // Edge Case 8: Extreme Outdoor Lighting & Shadow Detection
      const eyeDiff = Math.abs((f.leftEyeOpenProbability ?? 1) - (f.rightEyeOpenProbability ?? 1));
      if (eyeDiff > 0.65) {
        setMessage('Lighting Warning: Direct side shadows / harsh glare detected');
      } else if (Math.abs(f.pitchAngle) > config.quality.maxPitchDeg) {
        setMessage('Keep your head level');
      } else if (f.yawAngle < -35 || f.yawAngle > 35) {
        setMessage('Face the camera directly');
      } else {
        setMessage('');
      }

      const result: FaceLandmarkResult = {
        hasFace: true,
        boundingBox: { x: f.bounds.x, y: f.bounds.y, width: f.bounds.width, height: f.bounds.height },
        blendshapes: null,
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
        performanceMode: 'fast' as const,
        minFaceSize: 0.15,
        runClassifications: true,
        runLandmarks: false,
        cameraFacing: facing,
        outputResolution: 'preview' as const,
      }),
      [onFacesDetected, onError, facing]
    )
  );

  const photoOutput = usePhotoOutput({
    targetResolution: FACE_AUTH_PHOTO_RESOLUTION,
    containerFormat: 'jpeg',
    quality: 0.8,
    qualityPrioritization: device?.supportsSpeedQualityPrioritization ? 'speed' : 'balanced',
  });
  const photoOutputRef = useRef(photoOutput);

  useEffect(() => {
    photoOutputRef.current = photoOutput;
  }, [photoOutput]);

  // iOS pre-allocates photo resources here; Android treats this as a no-op.
  useEffect(() => {
    photoOutput.prepareSettings([FACE_AUTH_CAPTURE_SETTINGS]).catch((e) => {
      logger.warn('Photo output preparation failed; continuing without warmup', e);
    });
  }, [photoOutput]);

  // --- One-shot recognition burst (runs when liveness passes) --------------
  const captureEmbeddings = useCallback(async (sessionId: number) => {
    if (!modelsReady) {
      throw new Error('Face models are still loading');
    }
    assertCurrentSession(sessionId);

    const wanted =
      currentAction.current === 'VERIFY'
        ? config.recognition.verifyEmbeddings
        : config.recognition.enrollEmbeddings;

    const embeddings: number[][] = [];
    const spoofScores: number[] = [];
    let lastEmbedMs = 0;
    let lastIssue: string | null = null;

    const meanSpoofScore = () =>
      spoofScores.reduce((a, b) => a + b, 0) / spoofScores.length;

    const spoofDecided = () => {
      const { maxChecks, confidentLiveScore } = config.antiSpoof;
      if (spoofScores.length === 0) return false;
      if (spoofScores.length >= maxChecks) return true;
      const mean = meanSpoofScore();
      // Only short-circuit on confident LIVE score. NEVER short-circuit on confident spoof
      // score because a single blurry/noisy first frame can easily yield a false confident spoof
      // score (e.g. 0.15) for a real human face, preventing checks on subsequent clearer frames.
      return mean >= confidentLiveScore;
    };

    const maxAttempts = wanted + config.antiSpoof.maxChecks;
    let lastCapturedPhotoUri: string | null = null;

    const capturedFrameUris: string[] = [];

    for (let attempts = 0; attempts < maxAttempts; attempts++) {
      assertCurrentSession(sessionId);
      if (embeddings.length >= wanted && spoofDecided()) break;

      let uri: string;
      try {
        const photo = await capturePhotoWithRetry(3, 50);
        assertCurrentSession(sessionId);
        uri = photo.filePath.startsWith('file://') ? photo.filePath : `file://${photo.filePath}`;
        emitCapture();
        lastCapturedPhotoUri = uri;
      } catch (e) {
        if (errorToMessage(e) === STALE_SESSION_ERROR) throw e;
        lastIssue = `photo capture failed: ${errorToMessage(e)}`;
        logger.warn('photo capture failed', e);
        continue;
      }

      let faces: Awaited<ReturnType<typeof FaceDetection.detect>>;
      try {
        faces = await FaceDetection.detect(uri, {
          performanceMode: 'fast',
          landmarkMode: 'all',
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

      if (!spoofDecided() && tensor.sharpness >= 8.0) {
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
          capturedFrameUris.push(uri);
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

    const maxSpoof = spoofScores.length > 0 ? Math.max(...spoofScores) : null;
    const meanSpoof = spoofScores.length > 0 ? meanSpoofScore() : null;
    const spoofed =
      maxSpoof != null &&
      meanSpoof != null &&
      maxSpoof < 0.35 &&
      meanSpoof < 0.35;
    const spoofScore = maxSpoof ?? meanSpoof;
    return { embeddings, spoofed, spoofScore, lastEmbedMs, lastIssue, lastCapturedPhotoUri, capturedFrameUris };
  }, [assertCurrentSession, capturePhotoWithRetry, emitCapture, modelsReady]);

  // Resolve the flow once liveness reaches a terminal state.
  useEffect(() => {
    if (!currentAction.current) return;

    if (livenessState.status === 'FAILED') {
      const msg = livenessState.message || 'Liveness check failed. Please try again.';
      queueMicrotask(() => failAuth(msg));
      return;
    }
    if (livenessState.status !== 'PASSED' || resolvingRef.current) return;

    resolvingRef.current = true;
    const sessionId = flowSessionRef.current;
    livenessDurationRef.current = Math.max(1, Date.now() - flowStartTimeRef.current);

    const run = async () => {
      setIsProcessing(true);
      try {
        const { embeddings, spoofed, spoofScore, lastEmbedMs, lastIssue, lastCapturedPhotoUri, capturedFrameUris: burstUris } =
          await captureEmbeddings(sessionId);
        if (isStaleSession(sessionId)) return;

        if (lastCapturedPhotoUri) {
          setProbeImageUri(lastCapturedPhotoUri);
        }
        if (burstUris && burstUris.length > 0) {
          setCapturedFrameUris(burstUris);
        }

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
          const matchStart = Date.now();
          const existing = await OfflineStore.getTemplates();
          if (isStaleSession(sessionId)) return;
          let maxSim = -1;
          let existingMatchTemplate: FaceTemplate | null = null;
          const weights = getPeriocularWeights(avg.length);
          for (const t of existing) {
            const sim = computeWeightedCosineSimilarity(avg, t.embedding, weights);
            if (sim > maxSim) {
              maxSim = sim;
              existingMatchTemplate = t;
            }
          }
          const matchMs = Date.now() - matchStart;
          const totalMs = Date.now() - flowStartTimeRef.current;

          setBenchmarkMetrics({
            livenessMs: livenessDurationRef.current,
            inferenceMs: lastEmbedMs,
            matchingMs: matchMs,
            totalMs,
          });
          setLatencyMs(totalMs);

          if (maxSim >= config.enroll.duplicateThreshold) {
            currentAction.current = null;
            setConfidence(maxSim);
            if (existingMatchTemplate) {
              const uri = await OfflineStore.getImageUri(existingMatchTemplate.id);
              if (uri) setMatchedImageUri(uri);
            }
            setAuthStatus('SUCCESS');
            setMessage(
              `Already enrolled — matched an existing template at ${(maxSim * 100).toFixed(0)}%. No duplicate added.`
            );
            return;
          }
          const newId = `user-${Date.now()}`;
          await OfflineStore.saveTemplate({
            id: newId,
            embedding: avg,
            createdAt: Date.now(),
            isSynced: false,
          });

          // Save face crop image to SSD for future offline match comparison
          if (lastCapturedPhotoUri) {
            await OfflineStore.saveTemplateImage(newId, lastCapturedPhotoUri).catch((e) =>
              logger.warn('Image save error during enrollment', e)
            );
          }

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
        let matchedTemplate: FaceTemplate | null = null;
        const weights = getPeriocularWeights(avg.length);
        for (const t of templates) {
          const sim = computeWeightedCosineSimilarity(avg, t.embedding, weights);
          if (sim > maxSim) {
            maxSim = sim;
            matchedTemplate = t;
          }
        }
        const matchMs = Date.now() - matchStart;
        const totalMs = Date.now() - flowStartTimeRef.current;

        setBenchmarkMetrics({
          livenessMs: livenessDurationRef.current,
          inferenceMs: lastEmbedMs,
          matchingMs: matchMs,
          totalMs,
        });

        currentAction.current = null;
        setConfidence(maxSim);
        setLatencyMs(totalMs);
        if (matchedTemplate) {
          const uri = await OfflineStore.getImageUri(matchedTemplate.id);
          if (uri) setMatchedImageUri(uri);
        }

        if (maxSim >= config.recognition.cosineSimilarityThreshold) {
          setAuthStatus('SUCCESS');
          setMessage('Identity verified against your enrolled template.');

          // Non-blocking background geotag capture (0ms verification latency)
          if (matchedTemplate) {
            LocationService.getGeotag()
              .then((location) => {
                if (location) {
                  SQLiteStore.saveLastKnownLocation(matchedTemplate.id, location);
                }
              })
              .catch((e) => logger.warn('Background location capture failed', e));
          }
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
      }
    };
    run();
  }, [livenessState.status, livenessState.message, captureEmbeddings, failAuth, isStaleSession]);

  // --- Controls ------------------------------------------------------------
  const begin = useCallback(
    (action: AuthAction) => {
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
      flowStartTimeRef.current = Date.now();
      resolvingRef.current = false;
      livenessStatusRef.current = 'IN_PROGRESS';
      currentAction.current = action;
      setAuthStatus(action === 'ENROLL' ? 'ENROLLING' : 'VERIFYING');
      setConfidence(null);
      setLatencyMs(null);
      setBenchmarkMetrics(null);
      setMatchedImageUri(null);
      setProbeImageUri(null);
      setCapturedFrameUris([]);
      setIsProcessing(false);
      setMessage('Follow the prompts. Anti-spoof and liveness checks are active.');
      resetLiveness();

      startLiveness(challengesForAction(action));
    },
    [failAuth, modelError, modelsReady, resetLiveness, startLiveness]
  );

  const startEnrollment = useCallback(() => begin('ENROLL'), [begin]);
  const startVerification = useCallback(() => begin('VERIFY'), [begin]);

  const reset = useCallback(() => {
    flowSessionRef.current += 1;
    resolvingRef.current = false;
    livenessStatusRef.current = 'IDLE';
    currentAction.current = null;
    setAuthStatus('IDLE');
    setMessage('');
    setConfidence(null);
    setLatencyMs(null);
    setBenchmarkMetrics(null);
    setMatchedImageUri(null);
    setProbeImageUri(null);
    setCapturedFrameUris([]);
    setIsProcessing(false);
    resetLiveness();
  }, [resetLiveness]);

  const toggleFacing = useCallback(() => {
    const action = currentAction.current;
    flowSessionRef.current += 1;
    resolvingRef.current = false;
    livenessStatusRef.current = action ? 'IN_PROGRESS' : 'IDLE';
    setIsProcessing(false);
    setConfidence(null);
    setLatencyMs(null);
    setBenchmarkMetrics(null);
    setMatchedImageUri(null);
    setProbeImageUri(null);
    setCapturedFrameUris([]);
    resetLiveness();

    setFacing((p) => (p === 'front' ? 'back' : 'front'));

    if (action) {
      begin(action);
    } else {
      reset();
    }
  }, [begin, reset, resetLiveness]);

  const isActive = authStatus === 'ENROLLING' || authStatus === 'VERIFYING';

  return {
    // liveness / auth
    livenessState,
    authStatus,
    message,
    isProcessing,
    subscribeCapture,
    confidence,
    latencyMs,
    benchmarkMetrics,
    matchedImageUri,
    probeImageUri,
    capturedFrameUris,
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

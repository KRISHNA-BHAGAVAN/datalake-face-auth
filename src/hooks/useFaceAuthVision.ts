import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'react-native';
import { useCameraDevice, useCameraPermission, usePhotoOutput } from 'react-native-vision-camera';
import {
  useFaceDetectorOutput,
  useImageFaceDetector,
  type Face,
} from 'react-native-vision-camera-face-detector';

import { useLiveness } from '../liveness/useLiveness';
import { FaceRecognizer } from '../ml/FaceRecognizer';
import { FaceAntiSpoof } from '../ml/FaceAntiSpoof';
import { ImageProcessor } from '../ml/ImageProcessor';
import { OfflineStore } from '../storage/OfflineStore';
import { computeCosineSimilarity, averageEmbeddings } from '../recognition/CosineSimilarity';
import { FrameQuality } from '../recognition/FrameQuality';
import { config } from '../utils/config';
import { FaceLandmarkResult } from '../types';

type AuthStatus = 'IDLE' | 'ENROLLING' | 'VERIFYING' | 'SUCCESS' | 'FAILED';
type Facing = 'front' | 'back';

const DEG2RAD = Math.PI / 180;

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

  const device = useCameraDevice(facing);

  const currentAction = useRef<'ENROLL' | 'VERIFY' | null>(null);
  const livenessStatusRef = useRef(livenessState.status);
  const resolvingRef = useRef(false); // guards the one-shot end burst

  useEffect(() => {
    livenessStatusRef.current = livenessState.status;
  }, [livenessState.status]);

  // Still-image detector for the end-of-flow capture burst (replaces ML Kit detect).
  const imageDetector = useImageFaceDetector({
    performanceMode: 'accurate',
    runLandmarks: true,
    runClassifications: true,
    minFaceSize: 0.15,
  });

  useEffect(() => {
    Promise.all([FaceRecognizer.init(), FaceAntiSpoof.init()]).catch((e) =>
      console.error('Failed to load ML models', e)
    );
  }, []);

  const failAuth = useCallback((userMessage: string) => {
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
      const result: FaceLandmarkResult = {
        hasFace: true,
        boundingBox: { x: f.bounds.x, y: f.bounds.y, width: f.bounds.width, height: f.bounds.height },
        blendshapes: null,
        // VERIFY ON DEVICE: yawAngle sign for front camera. If turn-left/right are
        // swapped during enrollment, negate this (yaw: -f.yawAngle * DEG2RAD).
        yaw: f.yawAngle * DEG2RAD,
        pitch: f.pitchAngle * DEG2RAD,
        roll: f.rollAngle * DEG2RAD,
        smilingProbability: f.smilingProbability,
        leftEyeOpenProbability: f.leftEyeOpenProbability,
        rightEyeOpenProbability: f.rightEyeOpenProbability,
      };
      processFrame(result);
    },
    [processFrame]
  );

  const onError = useCallback((e: Error) => console.warn('Face detector error', e), []);

  const faceOutput = useFaceDetectorOutput(
    useMemo(
      () => ({
        onFacesDetected,
        onError,
        performanceMode: 'fast' as const,
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

  const captureEmbeddings = useCallback(async () => {
    const wanted =
      currentAction.current === 'VERIFY'
        ? config.recognition.verifyEmbeddings
        : config.recognition.enrollEmbeddings;

    const embeddings: number[][] = [];
    let spoofChecks = 0;
    let spoofFails = 0;
    let lastEmbedMs = 0;

    for (let i = 0; i < wanted; i++) {
      let uri: string;
      try {
        const photo = await photoOutputRef.current.capturePhotoToFile({}, {});
        uri = photo.filePath.startsWith('file://') ? photo.filePath : `file://${photo.filePath}`;
      } catch (e) {
        console.warn('capturePhotoToFile failed', e);
        continue;
      }

      const faces = imageDetector.detectFaces({ uri });
      if (!faces.length) continue;
      const f = faces[0];

      const { width, height } = await getImageSize(uri);
      const normBox = {
        x: f.bounds.x / width,
        y: f.bounds.y / height,
        width: f.bounds.width / width,
        height: f.bounds.height / height,
      };

      // Anti-spoof backstop on the real captured frame.
      try {
        const spoofBuf = await ImageProcessor.processAntiSpoofImage(uri, width, height, normBox);
        const spoof = await FaceAntiSpoof.classify(spoofBuf);
        spoofChecks += 1;
        if (!spoof.isLive) spoofFails += 1;
      } catch (e) {
        console.warn('anti-spoof failed', e);
      }

      // Quality gate (geometry uses degrees, like FrameQuality expects).
      const geo = FrameQuality.assessGeometry(
        { frame: { width: f.bounds.width }, rotationX: f.pitchAngle, rotationY: f.yawAngle },
        width
      );
      if (!geo.ok) continue;

      const eyes =
        f.landmarks?.LEFT_EYE && f.landmarks?.RIGHT_EYE
          ? { left: f.landmarks.LEFT_EYE, right: f.landmarks.RIGHT_EYE }
          : null;
      try {
        const tensor = await ImageProcessor.processFaceImage(uri, width, height, normBox, eyes);
        if (!FrameQuality.assessPixels(tensor.sharpness, tensor.brightness).ok) continue;
        const t0 = Date.now();
        const emb = await FaceRecognizer.getEmbedding(tensor.input);
        lastEmbedMs = Date.now() - t0;
        embeddings.push(emb);
      } catch (e) {
        console.warn('embedding failed', e);
      }
    }

    const spoofed = spoofChecks > 0 && spoofFails >= Math.ceil(spoofChecks / 2);
    return { embeddings, spoofed, lastEmbedMs };
  }, [imageDetector]);

  // Resolve the flow once liveness reaches a terminal state.
  useEffect(() => {
    if (!currentAction.current) return;

    if (livenessState.status === 'FAILED') {
      failAuth(livenessState.message || 'Liveness check failed. Please try again.');
      return;
    }
    if (livenessState.status !== 'PASSED' || resolvingRef.current) return;

    resolvingRef.current = true;
    const run = async () => {
      setIsProcessing(true);
      const startedAt = Date.now();
      try {
        const { embeddings, spoofed, lastEmbedMs } = await captureEmbeddings();

        if (spoofed) {
          failAuth('Spoof detected. Use your real face, not a photo or screen.');
          return;
        }
        if (embeddings.length === 0) {
          failAuth('Could not capture a clear face. Please try again.');
          return;
        }

        const avg = averageEmbeddings(embeddings);
        const action = currentAction.current;

        if (action === 'ENROLL') {
          const existing = await OfflineStore.getTemplates();
          let maxSim = -1;
          for (const t of existing) {
            const sim = computeCosineSimilarity(avg, t.embedding);
            if (sim > maxSim) maxSim = sim;
          }
          currentAction.current = null;
          if (maxSim >= config.enroll.duplicateThreshold) {
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
          setAuthStatus('SUCCESS');
          setMessage('Enrollment successful! Face template saved offline.');
          return;
        }

        // VERIFY
        const templates = await OfflineStore.getTemplates();
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
        console.error('Recognition burst error', e);
        failAuth('Error during face processing.');
      } finally {
        setIsProcessing(false);
        void startedAt;
      }
    };
    run();
  }, [livenessState.status, livenessState.message, captureEmbeddings, failAuth]);

  // --- Controls ------------------------------------------------------------
  const begin = useCallback(
    (action: 'ENROLL' | 'VERIFY', challenges: Parameters<typeof startLiveness>[0]) => {
      resolvingRef.current = false;
      currentAction.current = action;
      setAuthStatus(action === 'ENROLL' ? 'ENROLLING' : 'VERIFYING');
      setConfidence(null);
      setLatencyMs(null);
      setIsProcessing(false);
      setMessage('Follow the prompts. Anti-spoof and liveness checks are active.');
      resetLiveness();
      startLiveness(challenges);
    },
    [resetLiveness, startLiveness]
  );

  const startEnrollment = useCallback(
    () => begin('ENROLL', ['SMILE', 'TURN_HEAD_LEFT', 'TURN_HEAD_RIGHT']),
    [begin]
  );
  const startVerification = useCallback(() => begin('VERIFY', ['BLINK']), [begin]);

  const reset = useCallback(() => {
    resolvingRef.current = false;
    currentAction.current = null;
    setAuthStatus('IDLE');
    setMessage('');
    setConfidence(null);
    setLatencyMs(null);
    setIsProcessing(false);
    resetLiveness();
  }, [resetLiveness]);

  const toggleFacing = useCallback(() => setFacing((p) => (p === 'front' ? 'back' : 'front')), []);

  // Keep the camera session running only while a flow is active.
  const isActive = authStatus === 'ENROLLING' || authStatus === 'VERIFYING';

  return {
    // liveness / auth
    livenessState,
    authStatus,
    message,
    isProcessing,
    confidence,
    latencyMs,
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

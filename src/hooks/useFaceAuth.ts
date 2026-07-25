import { useState, useCallback, useRef, useEffect } from 'react';
import FaceDetection from '@react-native-ml-kit/face-detection';
import { useLiveness } from '../liveness/useLiveness';
import { FaceRecognizer } from '../ml/FaceRecognizer';
import { FaceAntiSpoof } from '../ml/FaceAntiSpoof';
import { OfflineStore } from '../storage/OfflineStore';
import { computeCosineSimilarity, averageEmbeddings } from '../recognition/CosineSimilarity';
import { FrameQuality } from '../recognition/FrameQuality';
import { config } from '../utils/config';
import { FaceLandmarkResult } from '../types';
import { ImageProcessor } from '../ml/ImageProcessor';
import { logger } from '../utils/logger';

export function useFaceAuth() {
  const { livenessState, startLiveness, processFrame, resetLiveness } = useLiveness();
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState('');
  const [authStatus, setAuthStatus] = useState<'IDLE' | 'ENROLLING' | 'VERIFYING' | 'SUCCESS' | 'FAILED'>('IDLE');
  // Verify-result metrics surfaced to the UI (null until a verification resolves).
  const [confidence, setConfidence] = useState<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const cameraRef = useRef<any>(null);
  const lastEmbedMs = useRef(0); // wall time of the most recent embedding extraction
  const currentAction = useRef<'ENROLL' | 'VERIFY' | null>(null);
  const enrollmentEmbeddings = useRef<number[][]>([]);
  const loopRef = useRef<any>(null);
  const livenessStatusRef = useRef(livenessState.status);
  const spoofFailStreak = useRef(0); // consecutive non-live frames; debounce transient dips
  const isProcessingRef = useRef(false); // reentrancy guard (ref, not state, to keep callbacks stable)
  const frameCounter = useRef(0); // processed-frame index; used to throttle anti-spoof

  useEffect(() => {
    livenessStatusRef.current = livenessState.status;
  }, [livenessState.status]);

  const stopLoop = useCallback(() => {
    if (loopRef.current) {
      clearInterval(loopRef.current);
      loopRef.current = null;
    }
  }, []);

  useEffect(() => {
    Promise.all([FaceRecognizer.init(), FaceAntiSpoof.init()]).catch((e) =>
      logger.error('Failed to load ML models', e)
    );
    return () => {
      stopLoop();
    };
  }, [stopLoop]);

  const failAuth = useCallback(
    (userMessage: string) => {
      stopLoop();
      currentAction.current = null;
      setAuthStatus('FAILED');
      setMessage(userMessage);
    },
    [stopLoop]
  );

  const captureAndProcess = useCallback(async () => {
    if (isProcessingRef.current || !cameraRef.current || !currentAction.current) return;
    isProcessingRef.current = true;
    setIsProcessing(true);

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.3,
        base64: false,
      });
      if (!photo) return;

      const faces = await FaceDetection.detect(photo.uri, {
        performanceMode: 'fast', // 'accurate' is too slow for a per-frame loop
        landmarkMode: 'all', // needed for eye-based alignment
        classificationMode: 'all', // needed for blink/smile probabilities
      });

      if (faces.length === 0) {
        if (livenessStatusRef.current === 'IN_PROGRESS') {
          processFrame({
            hasFace: false,
            boundingBox: null,
            blendshapes: null,
            yaw: 0,
            pitch: 0,
            roll: 0,
          });
        }
        return;
      }

      const face = faces[0];
      frameCounter.current += 1;
      // --- TEMP DIAGNOSTIC (liveness signals) ---
      logger.log(
        `[Liveness] faces=${faces.length} ` +
        `smile=${(face.smilingProbability ?? -1).toFixed(2)} ` +
        `Leye=${(face.leftEyeOpenProbability ?? -1).toFixed(2)} ` +
        `Reye=${(face.rightEyeOpenProbability ?? -1).toFixed(2)} ` +
        `rotY=${(face.rotationY ?? 0).toFixed(1)} userYaw=${(-face.rotationY).toFixed(2)} ` +
        `challenge=${livenessStatusRef.current}`
      );
      // --- END DIAGNOSTIC ---
      const normalizedBox = {
        x: face.frame.left / photo.width,
        y: face.frame.top / photo.height,
        width: face.frame.width / photo.width,
        height: face.frame.height / photo.height,
      };

      // 1. Silent anti-spoof (MiniFASNet) — reject photos/screens before liveness.
      // Throttled: this is one of the heavier per-frame steps (JS JPEG decode + tflite),
      // so we run it every Nth frame instead of every frame. A photo/screen attack is
      // sustained, so periodic sampling still catches it.
      if (frameCounter.current % config.antiSpoof.checkEveryNFrames === 1) {
        const antiSpoofBuffer = await ImageProcessor.processAntiSpoofImage(
          photo.uri,
          photo.width,
          photo.height,
          normalizedBox
        );
        const spoofResult = await FaceAntiSpoof.classify(antiSpoofBuffer);
        if (!spoofResult.isLive) {
          // Debounce: a real face dips below threshold on some frames (motion blur,
          // mid-smile, head turn). Only fail on a sustained run of non-live frames,
          // which is what an actual photo/screen attack produces. Skip this frame.
          spoofFailStreak.current += 1;
          if (spoofFailStreak.current >= 3) {
            failAuth(
              `Spoof detected (${(spoofResult.liveScore * 100).toFixed(0)}% live). Use your real face, not a photo or screen.`
            );
          }
          return;
        }
        spoofFailStreak.current = 0;
      }

      const faceResult: FaceLandmarkResult = {
        hasFace: true,
        boundingBox: {
          x: face.frame.left,
          y: face.frame.top,
          width: face.frame.width,
          height: face.frame.height,
        },
        blendshapes: null,
        yaw: -face.rotationY,
        pitch: face.rotationX,
        roll: face.rotationZ,
        smilingProbability: face.smilingProbability,
        leftEyeOpenProbability: face.leftEyeOpenProbability,
        rightEyeOpenProbability: face.rightEyeOpenProbability,
      };

      // 2. Active liveness challenges (blink / smile / head turn)
      if (livenessStatusRef.current !== 'PASSED' && livenessStatusRef.current !== 'FAILED') {
        processFrame(faceResult);
      }

      // 3. Collect recognition embeddings during active liveness.
      // Gate on frame quality (pose/size, then sharpness/brightness) so blurry,
      // dark or off-angle frames don't poison the averaged template.
      const maxEmbeddings =
        currentAction.current === 'VERIFY'
          ? config.recognition.verifyEmbeddings
          : config.recognition.enrollEmbeddings;
      if (
        livenessStatusRef.current === 'IN_PROGRESS' &&
        enrollmentEmbeddings.current.length < maxEmbeddings &&
        FrameQuality.assessGeometry(face, photo.width).ok
      ) {
        try {
          const lm = face.landmarks;
          const eyes =
            lm?.leftEye && lm?.rightEye
              ? { left: lm.leftEye.position, right: lm.rightEye.position }
              : null;
          const tensor = await ImageProcessor.processFaceImage(
            photo.uri,
            photo.width,
            photo.height,
            normalizedBox,
            eyes
          );
          if (FrameQuality.assessPixels(tensor.sharpness, tensor.brightness).ok) {
            const embStart = Date.now();
            const emb = await FaceRecognizer.getEmbedding(tensor.input);
            lastEmbedMs.current = Date.now() - embStart;
            enrollmentEmbeddings.current.push(emb);
          }
        } catch (embError) {
          logger.warn('Failed to extract embedding during capture loop', embError);
        }
      }
    } catch (e) {
      logger.warn('Capture loop error', e);
    } finally {
      isProcessingRef.current = false;
      setIsProcessing(false);
    }
  }, [failAuth, processFrame]);

  const startLoop = useCallback(() => {
    stopLoop();
    loopRef.current = setInterval(() => {
      captureAndProcess();
    }, config.camera.captureIntervalMs);
  }, [stopLoop, captureAndProcess]);

  useEffect(() => {
    if (livenessState.status !== 'FAILED') return;
    if (currentAction.current) {
      failAuth(livenessState.message || 'Liveness check failed. Please try again.');
    }
  }, [livenessState.status, livenessState.message, failAuth]);

  useEffect(() => {
    if (livenessState.status !== 'PASSED' || !currentAction.current) return;
    stopLoop();

    const processResult = async () => {
      const embeddings = enrollmentEmbeddings.current;
      if (embeddings.length === 0) {
        failAuth('No face embeddings captured.');
        return;
      }

      const avgEmbedding = averageEmbeddings(embeddings);
      const action = currentAction.current;

      if (action === 'ENROLL') {
        try {
          // De-dup: if this face already matches an enrolled template, it's the same
          // person re-enrolling. Don't add a duplicate (and don't grow the count).
          const existing = await OfflineStore.getTemplates();
          let maxSim = -1;
          for (const t of existing) {
            const sim = computeCosineSimilarity(avgEmbedding, t.embedding);
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
            embedding: avgEmbedding,
            createdAt: Date.now(),
            isSynced: false,
          });
          setAuthStatus('SUCCESS');
          setMessage('Enrollment successful! Face template saved offline.');
        } catch (e) {
          logger.error('Error saving template:', e);
          failAuth('Failed to save face template.');
        }
        return;
      }

      if (action === 'VERIFY') {
        try {
          const templates = await OfflineStore.getTemplates();
          if (templates.length === 0) {
            failAuth('Verification failed: no enrolled templates.');
            return;
          }

          // Time the recognition decision: embedding inference (last frame) + match search.
          const matchStart = Date.now();
          let maxSimilarity = -1;
          let matchedTemplate = null;

          for (const t of templates) {
            const sim = computeCosineSimilarity(avgEmbedding, t.embedding);
            if (sim > maxSimilarity) {
              maxSimilarity = sim;
              matchedTemplate = t;
            }
          }
          const recognitionMs = lastEmbedMs.current + (Date.now() - matchStart);

          currentAction.current = null;
          const threshold = config.recognition.cosineSimilarityThreshold;
          setConfidence(maxSimilarity);
          setLatencyMs(recognitionMs);
          if (matchedTemplate && maxSimilarity >= threshold) {
            setAuthStatus('SUCCESS');
            setMessage('Identity verified against your enrolled template.');
          } else {
            setAuthStatus('FAILED');
            setMessage('Face not recognized. Score is below the match threshold.');
          }
        } catch (e) {
          logger.error('Error during verification:', e);
          failAuth('Error during face verification.');
        }
      }
    };

    processResult();
  }, [livenessState.status, stopLoop, failAuth]);

  const startEnrollment = useCallback(() => {
    enrollmentEmbeddings.current = [];
    frameCounter.current = 0;
    spoofFailStreak.current = 0;
    currentAction.current = 'ENROLL';
    setAuthStatus('ENROLLING');
    setConfidence(null);
    setLatencyMs(null);
    setMessage('Follow the prompts. Anti-spoof and liveness checks are active.');
    resetLiveness();
    startLiveness(['SMILE', 'TURN_HEAD_LEFT', 'TURN_HEAD_RIGHT']);
    startLoop();
  }, [startLiveness, startLoop, resetLiveness]);

  const startVerification = useCallback(() => {
    enrollmentEmbeddings.current = [];
    frameCounter.current = 0;
    spoofFailStreak.current = 0;
    currentAction.current = 'VERIFY';
    setAuthStatus('VERIFYING');
    setConfidence(null);
    setLatencyMs(null);
    setMessage('Follow the prompts. Anti-spoof and liveness checks are active.');
    resetLiveness();
    startLiveness(['BLINK']);
    startLoop();
  }, [startLiveness, startLoop, resetLiveness]);

  const reset = useCallback(() => {
    stopLoop();
    setAuthStatus('IDLE');
    setMessage('');
    setConfidence(null);
    setLatencyMs(null);
    setIsProcessing(false);
    enrollmentEmbeddings.current = [];
    frameCounter.current = 0;
    spoofFailStreak.current = 0;
    currentAction.current = null;
    resetLiveness();
  }, [resetLiveness, stopLoop]);

  return {
    cameraRef,
    livenessState,
    authStatus,
    message,
    isProcessing,
    confidence,
    latencyMs,
    startEnrollment,
    startVerification,
    reset,
  };
}

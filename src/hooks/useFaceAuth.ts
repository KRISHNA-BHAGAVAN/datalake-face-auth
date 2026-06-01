import { useState, useCallback, useRef, useEffect } from 'react';
import FaceDetection from '@react-native-ml-kit/face-detection';
import { useLiveness } from '../liveness/useLiveness';
import { FaceRecognizer } from '../ml/FaceRecognizer';
import { OfflineStore } from '../storage/OfflineStore';
import { computeCosineSimilarity, averageEmbeddings } from '../recognition/CosineSimilarity';
import { config } from '../utils/config';
import { FaceLandmarkResult } from '../types';
import { ImageProcessor } from '../ml/ImageProcessor';

export function useFaceAuth() {
  const { livenessState, startLiveness, processFrame, resetLiveness } = useLiveness();
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState('');
  const [authStatus, setAuthStatus] = useState<'IDLE' | 'ENROLLING' | 'VERIFYING' | 'SUCCESS' | 'FAILED'>('IDLE');
  
  const cameraRef = useRef<any>(null);
  const currentAction = useRef<'ENROLL' | 'VERIFY' | null>(null);
  const enrollmentEmbeddings = useRef<number[][]>([]);
  const loopRef = useRef<any>(null);
  const livenessStatusRef = useRef(livenessState.status);

  useEffect(() => {
    livenessStatusRef.current = livenessState.status;
  }, [livenessState.status]);

  useEffect(() => {
    // FaceRecognizer initialization (MobileFaceNet) is deferred to a follow-up task.
    // We just keep the skeleton.
    FaceRecognizer.init().catch(e => console.error(e));
    return () => { stopLoop(); };
  }, []);

  const stopLoop = useCallback(() => {
    if (loopRef.current) {
      clearInterval(loopRef.current);
      loopRef.current = null;
    }
  }, []);

  const startLoop = useCallback(() => {
    stopLoop();
    // Run the capture loop every 1200ms
    loopRef.current = setInterval(captureAndProcess, 1200);
  }, []);

  const captureAndProcess = async () => {
    if (isProcessing || !cameraRef.current) return;
    setIsProcessing(true);

    try {
      // 1. Capture still image
      const photo = await cameraRef.current.takePictureAsync({ 
        quality: 0.3, 
        base64: false,
        // shutterSound: false
      });
      if (!photo) {
        setIsProcessing(false);
        return;
      }

      // 2. Detect faces on the still image
      const faces = await FaceDetection.detect(photo.uri, {
        performanceMode: 'accurate',
        landmarkMode: 'all',
        classificationMode: 'all',
      });

      if (faces.length === 0) {
        processFrame({
          hasFace: false, boundingBox: null, blendshapes: null,
          yaw: 0, pitch: 0, roll: 0
        });
        setIsProcessing(false);
        return;
      }

      const face = faces[0];
      const faceResult: FaceLandmarkResult = {
        hasFace: true,
        boundingBox: { 
          x: face.frame.left, 
          y: face.frame.top, 
          width: face.frame.width, 
          height: face.frame.height 
        },
        blendshapes: null, // No longer used
        // Front camera: ML Kit yaw is image-space; negate so left/right match the user.
        yaw: -face.rotationY,
        pitch: face.rotationX,
        roll: face.rotationZ,
        smilingProbability: face.smilingProbability,
        leftEyeOpenProbability: face.leftEyeOpenProbability,
        rightEyeOpenProbability: face.rightEyeOpenProbability,
      };

      // 3. Update liveness state machine
      if (livenessStatusRef.current !== 'PASSED' && livenessStatusRef.current !== 'FAILED') {
        processFrame(faceResult);
      }

      // 4. Collect embeddings only during active liveness (capped for averaging)
      const maxEmbeddings = config.recognition.embeddingsToAverage;
      if (
        currentAction.current &&
        livenessStatusRef.current === 'IN_PROGRESS' &&
        enrollmentEmbeddings.current.length < maxEmbeddings
      ) {
        try {
          const normalizedBox = {
            x: face.frame.left / photo.width,
            y: face.frame.top / photo.height,
            width: face.frame.width / photo.width,
            height: face.frame.height / photo.height,
          };
          const faceBuffer = await ImageProcessor.processFaceImage(
            photo.uri,
            photo.width,
            photo.height,
            normalizedBox
          );
          const emb = await FaceRecognizer.getEmbedding(faceBuffer);
          enrollmentEmbeddings.current.push(emb);
        } catch (embError) {
          console.warn('Failed to extract embedding during capture loop', embError);
        }
      }

    } catch (e) {
      console.warn("Capture loop error", e);
    } finally {
      setIsProcessing(false);
    }
  };

  // Stop capture and surface failure when liveness times out
  useEffect(() => {
    if (livenessState.status !== 'FAILED') return;
    stopLoop();
    if (currentAction.current) {
      setAuthStatus('FAILED');
      setMessage(livenessState.message || 'Liveness check failed. Please try again.');
      currentAction.current = null;
    }
  }, [livenessState.status, livenessState.message, stopLoop]);

  // When liveness passes, run the ML processing (saving template or verification)
  useEffect(() => {
    if (livenessState.status === 'PASSED' && currentAction.current) {
      stopLoop();

      const processResult = async () => {
        const embeddings = enrollmentEmbeddings.current;
        if (embeddings.length === 0) {
          setAuthStatus('FAILED');
          setMessage('No face embeddings captured.');
          return;
        }

        const avgEmbedding = averageEmbeddings(embeddings);

        if (currentAction.current === 'ENROLL') {
          try {
            const template = {
              id: `user-${Date.now()}`,
              embedding: avgEmbedding,
              createdAt: Date.now(),
              isSynced: false,
            };
            await OfflineStore.saveTemplate(template);
            setAuthStatus('SUCCESS');
            setMessage('Enrollment Successful! Face template saved.');
          } catch (e) {
            console.error('Error saving template:', e);
            setAuthStatus('FAILED');
            setMessage('Failed to save face template.');
          }
        } else if (currentAction.current === 'VERIFY') {
          try {
            const templates = await OfflineStore.getTemplates();
            if (templates.length === 0) {
              setAuthStatus('FAILED');
              setMessage('Verification Failed: No enrolled templates.');
              return;
            }

            let maxSimilarity = -1;
            let matchedTemplate = null;

            for (const t of templates) {
              const sim = computeCosineSimilarity(avgEmbedding, t.embedding);
              if (sim > maxSimilarity) {
                maxSimilarity = sim;
                matchedTemplate = t;
              }
            }

            const threshold = config.recognition.cosineSimilarityThreshold;
            if (matchedTemplate && maxSimilarity >= threshold) {
              setAuthStatus('SUCCESS');
              setMessage(`Verification Successful! Match score: ${(maxSimilarity * 100).toFixed(1)}%`);
            } else {
              setAuthStatus('FAILED');
              setMessage(
                matchedTemplate 
                  ? `Verification Failed: Face not recognized (score: ${(maxSimilarity * 100).toFixed(1)}%).`
                  : 'Verification Failed: Face not recognized.'
              );
            }
          } catch (e) {
            console.error('Error during verification:', e);
            setAuthStatus('FAILED');
            setMessage('Error during face verification.');
          }
        }
      };

      processResult();
    }
  }, [livenessState.status, stopLoop]);

  const startEnrollment = useCallback(() => {
    enrollmentEmbeddings.current = [];
    currentAction.current = 'ENROLL';
    setAuthStatus('ENROLLING');
    setMessage('Follow instructions to enroll');
    startLiveness(['SMILE', 'TURN_HEAD_LEFT', 'TURN_HEAD_RIGHT']);
    startLoop();
  }, [startLiveness, startLoop]);

  const startVerification = useCallback(() => {
    enrollmentEmbeddings.current = [];
    currentAction.current = 'VERIFY';
    setAuthStatus('VERIFYING');
    setMessage('Follow instructions to verify');
    startLiveness(['BLINK']); 
    startLoop();
  }, [startLiveness, startLoop]);

  const reset = useCallback(() => {
    stopLoop();
    setAuthStatus('IDLE');
    setMessage('');
    setIsProcessing(false);
    enrollmentEmbeddings.current = [];
    currentAction.current = null;
    resetLiveness();
  }, [resetLiveness, stopLoop]);

  return {
    cameraRef,
    livenessState,
    authStatus,
    message,
    isProcessing,
    startEnrollment,
    startVerification,
    // handleFaceDetected is removed, the hook handles its own capture loop
    reset
  };
}

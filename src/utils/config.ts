export const config = {
  // Liveness constraints
  liveness: {
    blinkThreshold: 0.3, // legacy; superseded by the baseline-drop blink below
    // Blink = eyes were clearly open (baseline) then clearly closing (closed).
    // Detecting the transition is far more reliable than catching one fully-closed frame.
    blinkOpenBaseline: 0.6, // avg eye-open prob must have reached this first
    blinkClosedThreshold: 0.4, // ...then drop to/below this to count as a blink
    smileThreshold: 0.7,
    headTurnYawThreshold: 12, // DEGREES — yaw is fed in degrees (see useFaceAuthVision)
    challengeTimeoutMs: 10000,
  },
  // Silent face anti-spoofing (MiniFASNet V2 TFLite)
  antiSpoof: {
    liveClassIndex: 1, // MiniFAS V2: index 1 = live face
    liveScoreThreshold: 0.5,
    cropScale: 2.7,
    inputSize: 80,
    checkEveryNFrames: 3, // throttle: run anti-spoof every Nth frame to keep the loop fast
  },
  // Recognition constraints
  recognition: {
    cosineSimilarityThreshold: 0.65, // Adjust based on model accuracy tests
    enrollEmbeddings: 3, // averaged into the stored template (accuracy vs enroll speed)
    verifyEmbeddings: 1, // single good probe frame — fast verify; burst retries if it's bad
  },
  // Enrollment de-duplication: if a new enrollment matches an existing template at
  // or above this score, it's the same person re-enrolling — don't add a duplicate.
  // Slightly below the verify threshold so genuine re-enrollments are caught.
  enroll: {
    duplicateThreshold: 0.62,
  },
  // Per-frame quality gate. Frames failing these are skipped for embedding capture
  // so blurry / dark / off-angle frames don't poison the averaged template.
  quality: {
    minFaceWidthRatio: 0.18, // face width / image width
    maxYawDeg: 22, // |left-right head turn|
    maxPitchDeg: 22, // |up-down head tilt|
    minBrightness: 40, // mean luma 0..255
    maxBrightness: 235,
    minSharpness: 6, // variance-of-Laplacian; lenient to avoid over-rejecting
  },
  // ArcFace canonical eye positions (112x112). MobileFaceNet was trained on faces
  // aligned to these coordinates; we normalize each crop toward the eye positions.
  alignment: {
    leftEye: { x: 38.2946, y: 51.6963 },
    rightEye: { x: 73.5318, y: 51.5014 },
    outputSize: 112,
  },
  // Camera & performance
  camera: {
    targetFps: 30,
    // Note: high resolutions drop frame rate
    resolution: '720p',
    captureIntervalMs: 400, // capture/process loop cadence (was 1200; lower = snappier)
  },
  models: {
    faceRecognizer: 'mobilefacenet.tflite',
    minifasnet: 'minifasnet_v2.tflite',
  }
};

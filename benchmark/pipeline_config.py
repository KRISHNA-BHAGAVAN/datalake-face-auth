"""
Constants mirrored 1:1 from the React Native app so the benchmark measures the
*same* pipeline the device runs.

Sources:
  - src/utils/config.ts  (alignment, recognition thresholds)
  - src/ml/ImageProcessor.ts  (crop geometry + normalization)
  - src/recognition/CosineSimilarity.ts  (scoring)
"""

# ArcFace canonical eye positions in the 112x112 output (config.alignment).
ALIGN_LEFT_EYE = (38.2946, 51.6963)
ALIGN_RIGHT_EYE = (73.5318, 51.5014)
OUTPUT_SIZE = 112

# MobileFaceNet input normalization (ImageProcessor.toMobileFaceNetInput):
#   (px - 127.5) / 127.5  -> [-1, 1], channel order RGB, layout HWC.
NORM_MEAN = 127.5
NORM_STD = 127.5

# Margin-crop fallback ratio when eye-aligned window leaves the image
# (ImageProcessor.processFaceImage -> computeMarginCrop(..., 0.2)).
MARGIN_RATIO = 0.2

# Decision threshold the app uses for a positive match
# (config.recognition.cosineSimilarityThreshold).
APP_COSINE_THRESHOLD = 0.48

# Per-frame quality gate (config.quality). The app skips frames failing these so
# blurry / tiny / dark crops don't poison the template; the benchmark mirrors it
# to measure the same images the device would actually use.
# Yaw/pitch gates are device-only (ML Kit gives head angles; MediaPipe Face
# Detection here does not), so they are intentionally not replicated.
MIN_FACE_WIDTH_RATIO = 0.18    # bbox width / image width
MIN_BRIGHTNESS = 40            # mean luma 0..255 of the crop
MAX_BRIGHTNESS = 235
MIN_SHARPNESS = 6              # variance-of-Laplacian
# Detection-confidence floor — benchmark-only, drops mislabeled / non-face
# scrape noise. The device detector (ML Kit) has its own internal gate.
MIN_DETECTION_SCORE = 0.70

MODEL_PATH = "../assets/models/mobilefacenet.tflite"

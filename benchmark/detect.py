"""
Face detection + eye keypoints via MediaPipe Face Detection.

The app uses Google ML Kit on-device; here we use MediaPipe (also Google, same
landmark conventions, pip-installable). We only need two eye centers + a face
bounding box, which both detectors provide. Alignment is driven by the eye
midpoint + interocular distance, so small per-detector landmark differences do
not change the canonical target geometry.
"""

import mediapipe as mp

_mp_fd = mp.solutions.face_detection

# model_selection=1 -> full-range model, better for varied face sizes.
_detector = _mp_fd.FaceDetection(model_selection=1, min_detection_confidence=0.4)


class Detection:
    __slots__ = ("left_eye", "right_eye", "bbox", "score")

    def __init__(self, left_eye, right_eye, bbox, score):
        self.left_eye = left_eye          # (x, y) in pixels
        self.right_eye = right_eye        # (x, y) in pixels
        self.bbox = bbox                  # normalized (x, y, w, h)
        self.score = score                # detection confidence 0..1


def detect(rgb_image):
    """rgb_image: HxWx3 uint8 RGB numpy array. Returns Detection or None."""
    h, w = rgb_image.shape[:2]
    result = _detector.process(rgb_image)
    if not result.detections:
        return None

    # Highest-confidence detection.
    det = max(result.detections, key=lambda d: d.score[0])
    kp = det.location_data.relative_keypoints
    # MediaPipe keypoint order: 0=right eye, 1=left eye (subject-relative).
    right_eye = (kp[0].x * w, kp[0].y * h)
    left_eye = (kp[1].x * w, kp[1].y * h)

    rb = det.location_data.relative_bounding_box
    bbox = (rb.xmin, rb.ymin, rb.width, rb.height)
    return Detection(left_eye, right_eye, bbox, float(det.score[0]))

"""
Loads mobilefacenet.tflite and produces embeddings — the same model file the
app ships (assets/models/mobilefacenet.tflite), run through tf.lite.Interpreter.
"""

import os
import cv2
import numpy as np

try:
    # LiteRT — same runtime run_antispoof.py uses; lighter than full TensorFlow.
    from ai_edge_litert.interpreter import Interpreter as _Interpreter
except ImportError:
    try:
        import tensorflow as tf
        _Interpreter = tf.lite.Interpreter
    except ImportError:
        from tflite_runtime.interpreter import Interpreter as _Interpreter

import pipeline_config as C
from detect import detect
from preprocess import build_input


def _quality_ok(rgb, det):
    """Mirror config.quality: reject low-confidence, tiny, dark/blown, or blurry
    faces — the frames the device's quality gate would skip. Returns (ok, reason)."""
    h, w = rgb.shape[:2]
    if det.score < C.MIN_DETECTION_SCORE:
        return False, "low_confidence"
    if det.bbox[2] < C.MIN_FACE_WIDTH_RATIO:
        return False, "face_too_small"

    # Measure brightness/sharpness on the face region, not the whole frame.
    x = max(0, int(det.bbox[0] * w)); y = max(0, int(det.bbox[1] * h))
    fw = max(1, int(det.bbox[2] * w)); fh = max(1, int(det.bbox[3] * h))
    face = rgb[y:y + fh, x:x + fw]
    if face.size == 0:
        return False, "empty_crop"
    gray = cv2.cvtColor(face, cv2.COLOR_RGB2GRAY)
    brightness = float(gray.mean())
    if brightness < C.MIN_BRIGHTNESS or brightness > C.MAX_BRIGHTNESS:
        return False, "brightness"
    if float(cv2.Laplacian(gray, cv2.CV_64F).var()) < C.MIN_SHARPNESS:
        return False, "blurry"
    return True, "ok"


class Embedder:
    def __init__(self, model_path=None):
        path = model_path or os.path.join(os.path.dirname(__file__), C.MODEL_PATH)
        self.interpreter = _Interpreter(model_path=os.path.abspath(path))
        self.interpreter.allocate_tensors()
        self.inp = self.interpreter.get_input_details()[0]
        self.out = self.interpreter.get_output_details()[0]
        # Detect layout: NHWC [1,112,112,3] (expected) vs NCHW [1,3,112,112].
        self.channels_first = self.inp["shape"][1] == 3 and self.inp["shape"][-1] != 3

    def describe(self):
        return {
            "input_shape": [int(x) for x in self.inp["shape"]],
            "input_dtype": str(self.inp["dtype"]),
            "output_shape": [int(x) for x in self.out["shape"]],
            "embedding_dim": int(self.out["shape"][-1]),
            "layout": "NCHW" if self.channels_first else "NHWC",
        }

    def embed_tensor(self, tensor_hwc):
        """tensor_hwc: 112x112x3 float32 RGB in [-1,1]. Returns 1-D embedding."""
        x = tensor_hwc
        if self.channels_first:
            x = np.transpose(x, (2, 0, 1))
        x = np.expand_dims(x, 0).astype(self.inp["dtype"])
        self.interpreter.set_tensor(self.inp["index"], x)
        self.interpreter.invoke()
        return self.interpreter.get_tensor(self.out["index"]).reshape(-1).astype(np.float32)

    def embed_image(self, image_path, quality_gate=True):
        """
        Full app path: read -> detect -> [quality gate] -> align/crop -> normalize
        -> embed. Returns (embedding, aligned_bool) or (None, False) if no face is
        found or the face fails the quality gate (when enabled).
        """
        bgr = cv2.imread(image_path, cv2.IMREAD_COLOR)
        if bgr is None:
            return None, False
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        det = detect(rgb)
        if det is None:
            return None, False
        if quality_gate and not _quality_ok(rgb, det)[0]:
            return None, False
        tensor, aligned = build_input(rgb, det)
        return self.embed_tensor(tensor), aligned


def cosine(a, b):
    """Mirrors src/recognition/CosineSimilarity.ts (normalizes internally)."""
    na = np.linalg.norm(a)
    nb = np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))

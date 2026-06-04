"""
Crop + align + normalize a face into the MobileFaceNet input tensor.

Geometry is a direct port of src/ml/ImageProcessor.ts:
  - computeAlignedCrop: square crop mapping eye midpoint + interocular distance
    onto the ArcFace canonical eye positions (scale + translation, NO roll).
  - computeMarginCrop: 20% margin fallback when the aligned window leaves the image.
  - toMobileFaceNetInput: RGB, (px - 127.5) / 127.5.
"""

import math
import cv2
import numpy as np

import pipeline_config as C


def _aligned_crop(left_eye, right_eye, photo_w, photo_h):
    """Returns (x, y, side) integer square crop, or None if it leaves the image."""
    cl, cr = C.ALIGN_LEFT_EYE, C.ALIGN_RIGHT_EYE
    canon_inter = math.hypot(cr[0] - cl[0], cr[1] - cl[1])
    canon_mid = ((cl[0] + cr[0]) / 2, (cl[1] + cr[1]) / 2)

    src_inter = math.hypot(right_eye[0] - left_eye[0], right_eye[1] - left_eye[1])
    if src_inter < 1:
        return None
    src_mid = ((left_eye[0] + right_eye[0]) / 2, (left_eye[1] + right_eye[1]) / 2)

    side = (C.OUTPUT_SIZE * src_inter) / canon_inter
    scale = side / C.OUTPUT_SIZE
    origin_x = src_mid[0] - canon_mid[0] * scale
    origin_y = src_mid[1] - canon_mid[1] * scale

    x = round(origin_x)
    y = round(origin_y)
    s = round(side)
    if x < 0 or y < 0 or x + s > photo_w or y + s > photo_h:
        return None
    return (x, y, s)


def _margin_crop(bbox, photo_w, photo_h, margin=C.MARGIN_RATIO):
    """bbox: normalized (x, y, w, h). Returns (x, y, w, h) integer crop."""
    bx, by, bw, bh = bbox
    min_x, min_y = bx, by
    max_x, max_y = bx + bw, by + bh
    mx, my = bw * margin, bh * margin

    cx = math.floor(max(0.0, min_x - mx) * photo_w)
    cy = math.floor(max(0.0, min_y - my) * photo_h)
    cw = math.floor((min(1.0, max_x + mx) - max(0.0, min_x - mx)) * photo_w)
    ch = math.floor((min(1.0, max_y + my) - max(0.0, min_y - my)) * photo_h)

    cx = max(0, cx)
    cy = max(0, cy)
    cw = max(1, min(cw, photo_w - cx))
    ch = max(1, min(ch, photo_h - cy))
    return (cx, cy, cw, ch)


def build_input(rgb_image, detection):
    """
    rgb_image: HxWx3 uint8 RGB.
    detection: detect.Detection.
    Returns (tensor[112,112,3] float32, aligned: bool).
    """
    h, w = rgb_image.shape[:2]

    aligned = _aligned_crop(detection.left_eye, detection.right_eye, w, h)
    if aligned is not None:
        x, y, s = aligned
        crop = rgb_image[y:y + s, x:x + s]
        was_aligned = True
    else:
        x, y, cw, ch = _margin_crop(detection.bbox, w, h)
        crop = rgb_image[y:y + ch, x:x + cw]
        was_aligned = False

    resized = cv2.resize(crop, (C.OUTPUT_SIZE, C.OUTPUT_SIZE), interpolation=cv2.INTER_LINEAR)
    tensor = (resized.astype(np.float32) - C.NORM_MEAN) / C.NORM_STD  # RGB, [-1,1]
    return tensor, was_aligned

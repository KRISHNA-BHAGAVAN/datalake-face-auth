"""
Crop + align + normalize a face into the MobileFaceNet input tensor.

Geometry is a direct port of src/ml/ImageProcessor.ts:

  - compute_align_transform  <- computeAlignTransform
        the ArcFace similarity transform (scale + translation + ROTATION) fitted
        to the two eye correspondences.
  - app_warp                 <- warpAlignedFace
        native crop of the intersected source region, resize to a working buffer,
        then bilinear inverse-warp into 112x112 in JS. Includes the JPEG
        round-trip the device's save/decode step introduces.
  - margin_crop              <- computeMarginCrop
        square 20%-margin fallback when eye landmarks are unavailable.
  - normalization            <- toMobileFaceNetInput
        RGB, (px - 127.5) / 127.5.

`legacy_build_input` keeps the pre-fix rotation-free crop so `run_alignment_ab.py`
can measure the before/after. It is NOT what the app does any more.
"""

import math

import cv2
import numpy as np

import pipeline_config as C

MAX_WARP_BUFFER = 256  # mirrors ImageProcessor.MAX_WARP_BUFFER
WARP_JPEG_QUALITY = 100  # warp path passes compress: 1.0


# --------------------------------------------------------------------------
# current pipeline
# --------------------------------------------------------------------------
def compute_align_transform(eye_a, eye_b):
    """
    Port of ImageProcessor.computeAlignTransform.

    Eyes are ordered by IMAGE x, never by the detector's label: detectors name
    eyes subject-relative, so `left_eye` sits on the right-hand side of a
    front-camera picture, and a signed transform fed the labels directly rotates
    every face 180 degrees (measured: AUC 0.91 -> 0.72, FAR 89%).
    """
    p1, p2 = sorted([eye_a, eye_b], key=lambda p: p[0])
    cl, cr = C.ALIGN_LEFT_EYE, C.ALIGN_RIGHT_EYE

    dpx, dpy = p2[0] - p1[0], p2[1] - p1[1]
    src_inter = math.hypot(dpx, dpy)
    if not math.isfinite(src_inter) or src_inter < 1:
        return None

    dqx, dqy = cr[0] - cl[0], cr[1] - cl[1]
    s = math.hypot(dqx, dqy) / src_inter
    theta = math.atan2(dqy, dqx) - math.atan2(dpy, dpx)
    a, b = s * math.cos(theta), s * math.sin(theta)
    return {
        "a": a,
        "b": b,
        "tx": cl[0] - (a * p1[0] - b * p1[1]),
        "ty": cl[1] - (b * p1[0] + a * p1[1]),
    }


def reference_warp(rgb, t):
    """One direct cv2.warpAffine — the mathematical ideal the device approximates."""
    M = np.array([[t["a"], -t["b"], t["tx"]], [t["b"], t["a"], t["ty"]]], dtype=np.float32)
    return cv2.warpAffine(
        rgb, M, (C.OUTPUT_SIZE, C.OUTPUT_SIZE),
        flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE,
    )


def app_warp(rgb, t):
    """
    Port of ImageProcessor.warpAlignedFace — what the device actually computes.

    The source region is INTERSECTED with the image, never shifted: shifting would
    slide the face off the canonical eye positions, which is the whole point of the
    transform. Clamping the sample coordinates then replicates at the true image
    border, matching OpenCV's BORDER_REPLICATE.
    """
    out = C.OUTPUT_SIZE
    ph, pw = rgb.shape[:2]
    det = t["a"] ** 2 + t["b"] ** 2

    def to_source(u, v):
        uu, vv = u - t["tx"], v - t["ty"]
        return ((t["a"] * uu + t["b"] * vv) / det, (-t["b"] * uu + t["a"] * vv) / det)

    corners = [to_source(0, 0), to_source(out, 0), to_source(out, out), to_source(0, out)]
    xs = [c[0] for c in corners]
    ys = [c[1] for c in corners]
    rx = max(0, math.floor(min(xs)))
    ry = max(0, math.floor(min(ys)))
    rw = max(1, min(math.ceil(max(xs)), pw) - rx)
    rh = max(1, min(math.ceil(max(ys)), ph) - ry)

    scale = math.sqrt(det)
    work_w = max(out, min(MAX_WARP_BUFFER, math.ceil(rw * scale)))
    work_h = max(out, min(MAX_WARP_BUFFER, math.ceil(rh * scale)))

    region = rgb[ry:ry + rh, rx:rx + rw]
    if region.size == 0:
        return None
    buf = cv2.resize(region, (work_w, work_h), interpolation=cv2.INTER_LINEAR)

    # JPEG round-trip that cropResizeDecode performs (saveAsync -> jpeg.decode)
    ok, enc = cv2.imencode(
        ".jpg", cv2.cvtColor(buf, cv2.COLOR_RGB2BGR),
        [int(cv2.IMWRITE_JPEG_QUALITY), WARP_JPEG_QUALITY],
    )
    if not ok:
        return None
    buf = cv2.cvtColor(cv2.imdecode(enc, cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB)

    src_h, src_w = buf.shape[:2]
    per_x, per_y = src_w / rw, src_h / rh

    # vectorised equivalent of the per-pixel bilinear loop in the TypeScript
    u = np.arange(out, dtype=np.float64) + 0.5
    uu, vv = np.meshgrid(u, u)
    su, sv = uu - t["tx"], vv - t["ty"]
    sx = (t["a"] * su + t["b"] * sv) / det
    sy = (-t["b"] * su + t["a"] * sv) / det

    bx = np.clip((sx - rx) * per_x - 0.5, 0, src_w - 1)
    by = np.clip((sy - ry) * per_y - 0.5, 0, src_h - 1)
    x0, y0 = np.floor(bx).astype(int), np.floor(by).astype(int)
    x1 = np.minimum(x0 + 1, src_w - 1)
    y1 = np.minimum(y0 + 1, src_h - 1)
    fx, fy = (bx - x0)[..., None], (by - y0)[..., None]

    b = buf.astype(np.float64)
    warped = (
        b[y0, x0] * (1 - fx) * (1 - fy) + b[y0, x1] * fx * (1 - fy)
        + b[y1, x0] * (1 - fx) * fy + b[y1, x1] * fx * fy
    )
    return warped.astype(np.uint8)  # JS writes a Uint8Array, which truncates


def margin_crop(bbox, photo_w, photo_h, margin=C.MARGIN_RATIO):
    """
    Port of ImageProcessor.computeMarginCrop: SQUARE, shifted in-bounds rather
    than truncated, so the fallback hands the model the same face shape the
    aligned path does. bbox is normalized (x, y, w, h).
    """
    bx, by, bw, bh = bbox
    box_w, box_h = bw * photo_w, bh * photo_h
    cx, cy = (bx + bw / 2) * photo_w, (by + bh / 2) * photo_h

    side = max(box_w, box_h) * (1 + 2 * margin)
    w = min(side, photo_w)
    h = min(side, photo_h)
    x = min(max(0.0, cx - side / 2), photo_w - w)
    y = min(max(0.0, cy - side / 2), photo_h - h)
    return (round(x), round(y), max(1, round(w)), max(1, round(h)))


def _normalize(rgb_112):
    return (rgb_112.astype(np.float32) - C.NORM_MEAN) / C.NORM_STD


def build_input(rgb_image, detection):
    """
    The current app path. rgb_image: HxWx3 uint8 RGB.
    Returns (tensor[112,112,3] float32, aligned: bool).
    """
    h, w = rgb_image.shape[:2]

    t = compute_align_transform(detection.left_eye, detection.right_eye)
    if t is not None:
        warped = app_warp(rgb_image, t)
        if warped is not None:
            return _normalize(warped), True

    x, y, cw, ch = margin_crop(detection.bbox, w, h)
    crop = rgb_image[y:y + ch, x:x + cw]
    resized = cv2.resize(crop, (C.OUTPUT_SIZE, C.OUTPUT_SIZE), interpolation=cv2.INTER_LINEAR)
    return _normalize(resized), False


# --------------------------------------------------------------------------
# pre-fix pipeline, kept only for before/after measurement
# --------------------------------------------------------------------------
def _legacy_aligned_crop(left_eye, right_eye, photo_w, photo_h):
    """Pre-fix: axis-aligned square crop matching eye midpoint + interocular
    distance. No rotation. Returns (x, y, side) or None if it leaves the image."""
    cl, cr = C.ALIGN_LEFT_EYE, C.ALIGN_RIGHT_EYE
    canon_inter = math.hypot(cr[0] - cl[0], cr[1] - cl[1])
    canon_mid = ((cl[0] + cr[0]) / 2, (cl[1] + cr[1]) / 2)

    src_inter = math.hypot(right_eye[0] - left_eye[0], right_eye[1] - left_eye[1])
    if src_inter < 1:
        return None
    src_mid = ((left_eye[0] + right_eye[0]) / 2, (left_eye[1] + right_eye[1]) / 2)

    side = (C.OUTPUT_SIZE * src_inter) / canon_inter
    scale = side / C.OUTPUT_SIZE
    x = round(src_mid[0] - canon_mid[0] * scale)
    y = round(src_mid[1] - canon_mid[1] * scale)
    s = round(side)
    if x < 0 or y < 0 or x + s > photo_w or y + s > photo_h:
        return None
    return (x, y, s)


def _legacy_margin_crop(bbox, photo_w, photo_h, margin=C.MARGIN_RATIO):
    """Pre-fix: rectangular, truncated at the image edge."""
    bx, by, bw, bh = bbox
    mx, my = bw * margin, bh * margin
    cx = math.floor(max(0.0, bx - mx) * photo_w)
    cy = math.floor(max(0.0, by - my) * photo_h)
    cw = math.floor((min(1.0, bx + bw + mx) - max(0.0, bx - mx)) * photo_w)
    ch = math.floor((min(1.0, by + bh + my) - max(0.0, by - my)) * photo_h)
    cx, cy = max(0, cx), max(0, cy)
    return (cx, cy, max(1, min(cw, photo_w - cx)), max(1, min(ch, photo_h - cy)))


def legacy_build_input(rgb_image, detection):
    """The pipeline as it stood before the roll-alignment fix."""
    h, w = rgb_image.shape[:2]
    aligned = _legacy_aligned_crop(detection.left_eye, detection.right_eye, w, h)
    if aligned is not None:
        x, y, s = aligned
        crop = rgb_image[y:y + s, x:x + s]
        was_aligned = True
    else:
        x, y, cw, ch = _legacy_margin_crop(detection.bbox, w, h)
        crop = rgb_image[y:y + ch, x:x + cw]
        was_aligned = False
    resized = cv2.resize(crop, (C.OUTPUT_SIZE, C.OUTPUT_SIZE), interpolation=cv2.INTER_LINEAR)
    return _normalize(resized), was_aligned

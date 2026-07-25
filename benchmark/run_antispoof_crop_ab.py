#!/usr/bin/env python3
"""
A/B the anti-spoof crop geometry on real faces, using the deployed TFLite model.

Why this exists
---------------
`src/ml/ImageProcessor.processAntiSpoofImage` used to build its 80x80 MiniFASNet
input with `computeCenterScaleCrop` + `clampCrop`. That pair *truncated* the crop
rectangle when the scale-2.7 window left the image, instead of doing what upstream
Silent-Face does: clamp the scale, then *shift* the window back in-bounds at full
size. It now does the latter (`computeAntiSpoofCrop`); this script is the
before/after that justified the change.

Truncating changes two things the model is highly sensitive to:
  1. aspect ratio  (a 0.80 window becomes 0.565 on a 16:9 photo -> 42% squash)
  2. face-to-context ratio inside the 80x80 input

Both are fixed properties of the data MiniFASNet was trained on, so breaking
them pushes real faces toward the "spoof" classes. The failure is
distance-dependent: at arm's length the two crops agree exactly, and they
diverge as the user approaches the guide oval -- which is why the app rejected
genuine faces only *sometimes*.

This script runs both crop implementations through
`assets/models/minifasnet_v2.tflite` on the Indian-demographic portrait set and
reports how many real faces each one rejects at the deployed threshold.

Pass `--phone FRAC` to re-stage each portrait as a 9:16 selfie with the face
filling FRAC of the frame width. That is the geometry the device actually shoots,
and where the divergence is largest -- the scrape images are near-square, which
understates it.

Run from the repo root:
    benchmark/.venv/bin/python benchmark/run_antispoof_crop_ab.py
"""
from __future__ import annotations

import argparse
import glob
import os
import sys

import cv2
import numpy as np
from ai_edge_litert.interpreter import Interpreter

TFLITE = "assets/models/minifasnet_v2.tflite"
SCALE = 2.7
SIZE = 80
LIVE_IDX = 1
THRESH = 0.5


# --------------------------------------------------------------------------
# The two crop implementations under test
# --------------------------------------------------------------------------
def crop_upstream(img_bgr, bbox, scale=SCALE):
    """Silent-Face `generate_patches._get_new_box`: clamp scale, shift in-bounds."""
    src_h, src_w = img_bgr.shape[:2]
    x, y, bw, bh = bbox
    scale = min((src_h - 1) / bh, (src_w - 1) / bw, scale)
    nw, nh = bw * scale, bh * scale
    cx, cy = bw / 2 + x, bh / 2 + y
    lx, ly = cx - nw / 2, cy - nh / 2
    rx, ry = cx + nw / 2, cy + nh / 2
    if lx < 0:
        rx -= lx
        lx = 0
    if ly < 0:
        ry -= ly
        ly = 0
    if rx > src_w - 1:
        lx -= rx - src_w + 1
        rx = src_w - 1
    if ry > src_h - 1:
        ly -= ry - src_h + 1
        ry = src_h - 1
    patch = img_bgr[int(ly) : int(ry), int(lx) : int(rx)]
    return cv2.resize(patch, (SIZE, SIZE)), (int(rx) - int(lx), int(ry) - int(ly))


def crop_old(img_bgr, bbox, scale=SCALE):
    """The app's PRE-FIX computeCenterScaleCrop + clampCrop: truncates at the edges."""
    src_h, src_w = img_bgr.shape[:2]
    x, y, bw, bh = bbox
    cx, cy = x + bw / 2, y + bh / 2
    cw, ch = int(bw * scale), int(bh * scale)
    X, Y = int(cx - bw * scale / 2), int(cy - bh * scale / 2)
    X, Y = max(0, X), max(0, Y)
    cw = max(1, min(cw, src_w - X))
    ch = max(1, min(ch, src_h - Y))
    patch = img_bgr[Y : Y + ch, X : X + cw]
    return cv2.resize(patch, (SIZE, SIZE)), (cw, ch)


# --------------------------------------------------------------------------
def softmax(v):
    e = np.exp(v - v.max())
    return e / e.sum()


class Model:
    """One interpreter reused across images (the old script rebuilt it per call)."""

    def __init__(self, path):
        self.it = Interpreter(model_path=path)
        self.it.allocate_tensors()
        self.i = self.it.get_input_details()[0]
        self.o = self.it.get_output_details()[0]

    def live_score(self, crop_bgr):
        # NHWC, BGR, raw [0,255] -- upstream leaves `.div(255)` commented out.
        self.it.set_tensor(self.i["index"], crop_bgr[None].astype(np.float32))
        self.it.invoke()
        return softmax(self.it.get_tensor(self.o["index"]).flatten())[LIVE_IDX]


def to_phone_frame(img_bgr, box, face_frac, canvas=(1080, 1920)):
    """
    Re-stage a portrait as a phone selfie: 9:16 canvas, face centred and filling
    `face_frac` of the width. The web-scrape images are near-square (aspect ~1.0),
    where the two crop implementations barely differ; the device shoots 9:16,
    which is exactly where truncation does its damage. Both implementations see
    the *same* canvas, so this isolates crop geometry as the only variable.

    Edges are reflected rather than zero-padded so the model never sees a hard
    black border that neither implementation would encounter in the field.
    """
    cw, ch = canvas
    x, y, bw, bh = box
    s = (face_frac * cw) / bw
    resized = cv2.resize(img_bgr, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    fcx, fcy = (x + bw / 2) * s, (y + bh / 2) * s

    # window in the resized image that maps onto the canvas
    ox, oy = fcx - cw / 2, fcy - ch / 2
    rh, rw = resized.shape[:2]
    pad_l = max(0, int(np.ceil(-ox)))
    pad_t = max(0, int(np.ceil(-oy)))
    pad_r = max(0, int(np.ceil(ox + cw - rw)))
    pad_b = max(0, int(np.ceil(oy + ch - rh)))
    if pad_l or pad_t or pad_r or pad_b:
        resized = cv2.copyMakeBorder(
            resized, pad_t, pad_b, pad_l, pad_r, cv2.BORDER_REFLECT_101
        )
        ox += pad_l
        oy += pad_t
    ox, oy = int(round(ox)), int(round(oy))
    frame = resized[oy : oy + ch, ox : ox + cw]
    if frame.shape[0] != ch or frame.shape[1] != cw:
        return None, None
    new_box = (cw / 2 - (bw * s) / 2, ch / 2 - (bh * s) / 2, bw * s, bh * s)
    return frame, new_box


def detect_box(detector, img_bgr):
    """MediaPipe face detection -> (x, y, w, h) in pixels, largest face."""
    h, w = img_bgr.shape[:2]
    res = detector.process(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))
    if not res.detections:
        return None
    best = max(res.detections, key=lambda d: d.location_data.relative_bounding_box.width)
    r = best.location_data.relative_bounding_box
    x, y = r.xmin * w, r.ymin * h
    bw, bh = r.width * w, r.height * h
    # keep the box inside the frame; a negative origin is common near edges
    x, y = max(0.0, x), max(0.0, y)
    bw, bh = min(bw, w - x), min(bh, h - y)
    if bw < 20 or bh < 20:
        return None
    return (x, y, bw, bh)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--images",
        default="benchmark/data/indian-actor-images-dataset/Bollywood Actor Images",
        help="root folder of real face photos",
    )
    ap.add_argument("--limit", type=int, default=400)
    ap.add_argument(
        "--phone",
        type=float,
        default=None,
        metavar="FACE_FRAC",
        help="re-stage each portrait as a 9:16 phone selfie with the face filling "
        "FACE_FRAC of the frame width (0.45 ~ the app's guide oval)",
    )
    args = ap.parse_args()

    if not os.path.exists(TFLITE):
        sys.exit(f"model not found: {TFLITE} (run from the repo root)")

    paths = sorted(
        p
        for p in glob.glob(os.path.join(args.images, "**", "*.*"), recursive=True)
        if p.lower().endswith((".jpg", ".jpeg", ".png"))
    )
    if not paths:
        sys.exit(f"no images under {args.images}")
    # even spread across identities rather than the first N folders
    if len(paths) > args.limit:
        step = len(paths) / args.limit
        paths = [paths[int(i * step)] for i in range(args.limit)]

    import mediapipe as mp

    detector = mp.solutions.face_detection.FaceDetection(
        model_selection=1, min_detection_confidence=0.6
    )
    model = Model(TFLITE)

    rows = []
    for p in paths:
        img = cv2.imread(p)
        if img is None:
            continue
        box = detect_box(detector, img)
        if box is None:
            continue
        if args.phone is not None:
            img, box = to_phone_frame(img, box, args.phone)
            if img is None:
                continue
        h, w = img.shape[:2]
        face_frac = box[2] / w

        up_crop, up_dims = crop_upstream(img, box)
        ap_crop, ap_dims = crop_old(img, box)

        rows.append(
            {
                "face_frac": face_frac,
                "img_aspect": w / h,
                "up": model.live_score(up_crop),
                "app": model.live_score(ap_crop),
                "up_aspect": up_dims[0] / up_dims[1],
                "app_aspect": ap_dims[0] / ap_dims[1],
                "identical": up_dims == ap_dims,
            }
        )

    if not rows:
        sys.exit("no faces detected in any image")

    n = len(rows)
    up = np.array([r["up"] for r in rows])
    app = np.array([r["app"] for r in rows])
    same = np.array([r["identical"] for r in rows])

    print(f"\nReal faces scored: {n}   (model: {TFLITE}, threshold {THRESH})")
    print(f"Crops byte-identical between impls: {same.sum()} / {n} "
          f"({100*same.mean():.0f}%)  <- these can never differ\n")

    print(f"{'':22s} {'shipped (fixed)':>18s} {'pre-fix (old)':>18s}")
    print("-" * 62)
    print(f"{'mean live score':22s} {up.mean():18.3f} {app.mean():18.3f}")
    print(f"{'median live score':22s} {np.median(up):18.3f} {np.median(app):18.3f}")
    rej_up = (up < THRESH).sum()
    rej_app = (app < THRESH).sum()
    print(f"{'REAL faces rejected':22s} {rej_up:13d} ({100*rej_up/n:4.1f}%) "
          f"{rej_app:13d} ({100*rej_app/n:4.1f}%)")
    print("-" * 62)

    # Where it matters: the crops that actually differ.
    diff = [r for r in rows if not r["identical"]]
    if diff:
        d_up = np.array([r["up"] for r in diff])
        d_app = np.array([r["app"] for r in diff])
        print(f"\nOn the {len(diff)} images where the crops differ:")
        print(f"  mean live score   upstream {d_up.mean():.3f}   app {d_app.mean():.3f}"
              f"   (delta {d_app.mean()-d_up.mean():+.3f})")
        print(f"  real rejected     upstream {(d_up<THRESH).sum():3d}"
              f"        app {(d_app<THRESH).sum():3d}")
        flipped = int(((d_up >= THRESH) & (d_app < THRESH)).sum())
        recovered = int(((d_up < THRESH) & (d_app >= THRESH)).sum())
        print(f"  real faces LOST by old crop (live -> spoof): {flipped}")
        print(f"  real faces gained by old crop:              {recovered}")
        print(f"  mean aspect       upstream {np.mean([r['up_aspect'] for r in diff]):.3f}"
              f"   app {np.mean([r['app_aspect'] for r in diff]):.3f}")

    # Face size drives the divergence -- show it.
    print("\nBy how much of the frame the face fills (the distance proxy):")
    print(f"  {'face width':>12s} {'n':>5s} {'upstream':>9s} {'app':>9s} {'delta':>7s}")
    for lo, hi in [(0, 0.2), (0.2, 0.3), (0.3, 0.4), (0.4, 0.6), (0.6, 1.01)]:
        b = [r for r in rows if lo <= r["face_frac"] < hi]
        if not b:
            continue
        bu = np.mean([r["up"] for r in b])
        ba = np.mean([r["app"] for r in b])
        print(f"  {f'{lo:.0%}-{hi:.0%}':>12s} {len(b):5d} {bu:9.3f} {ba:9.3f} {ba-bu:+7.3f}")
    print()


if __name__ == "__main__":
    main()

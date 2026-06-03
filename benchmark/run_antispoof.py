#!/usr/bin/env python3
"""
Benchmark the deployed MiniFASNetV2 anti-spoof TFLite on labeled face images.

Correct preprocessing (discovered the hard way, matches upstream Silent-Face):
  - crop face, expand by scale 2.7 around center, resize to 80x80
  - channel order BGR (cv2 native)
  - values in RAW [0,255] range  (NO /255 normalization -- upstream to_tensor has
    `img.float().div(255)` commented out)
  - output is 3-class softmax; LIVE = index 1

Feeding RGB or [0,1] makes the model collapse to a constant "spoof" output.

Usage: .venv-convert/bin/python benchmark/run_antispoof.py
"""
import os
import glob
import cv2
import numpy as np
from ai_edge_litert.interpreter import Interpreter

TFLITE = "assets/models/minifasnet_v2.tflite"
SCALE = 2.7
SIZE = 80
LIVE_IDX = 1
THRESH = 0.5

cascade = cv2.CascadeClassifier(
    os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml")
)


def detect_box(img_bgr):
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    faces = cascade.detectMultiScale(gray, 1.1, 5, minSize=(60, 60))
    if len(faces) == 0:
        return None
    return max(faces, key=lambda f: f[2] * f[3])


def crop_scaled(img_bgr, bbox, scale):
    """Upstream generate_patches._get_new_box: keep box*scale, shift in-bounds."""
    src_h, src_w = img_bgr.shape[:2]
    x, y, bw, bh = bbox
    scale = min((src_h - 1) / bh, min((src_w - 1) / bw, scale))
    nw, nh = bw * scale, bh * scale
    cx, cy = bw / 2 + x, bh / 2 + y
    lx, ly, rx, ry = cx - nw / 2, cy - nh / 2, cx + nw / 2, cy + nh / 2
    if lx < 0: rx -= lx; lx = 0
    if ly < 0: ry -= ly; ly = 0
    if rx > src_w - 1: lx -= (rx - src_w + 1); rx = src_w - 1
    if ry > src_h - 1: ly -= (ry - src_h + 1); ry = src_h - 1
    return cv2.resize(img_bgr[int(ly):int(ry), int(lx):int(rx)], (SIZE, SIZE))


def softmax(v):
    e = np.exp(v - v.max())
    return e / e.sum()


def infer(crop_bgr):
    it = Interpreter(model_path=TFLITE)
    it.allocate_tensors()
    i, o = it.get_input_details()[0], it.get_output_details()[0]
    # NHWC, BGR, raw [0,255]
    it.set_tensor(i["index"], crop_bgr[None].astype(np.float32))
    it.invoke()
    return softmax(it.get_tensor(o["index"]).flatten())


def main():
    paths = sorted(p for p in glob.glob("benchmark/data/**/*.jpg", recursive=True)
                   if "_result" not in p and ".crop." not in p)
    npass = nfail = 0
    print(f"{'image':24s} {'truth':5s} {'live%':>6s} {'pred':5s}  probs[0,1,2]")
    print("-" * 70)
    for p in paths:
        name = os.path.basename(p)
        truth = "FAKE" if "_F" in name or "fake" in p.lower() else (
            "REAL" if "_T" in name or "real" in p.lower() or "live" in p.lower() else "?")
        img = cv2.imread(p)
        box = detect_box(img)
        if box is None:
            print(f"{name:24s} {truth:5s}  NO FACE DETECTED"); continue
        pr = infer(crop_scaled(img, box, SCALE))
        live = pr[LIVE_IDX]
        pred = "REAL" if live >= THRESH else "FAKE"
        ok = (pred == truth) if truth in ("REAL", "FAKE") else True
        npass += ok; nfail += (not ok)
        flag = "" if ok else "  <-- WRONG"
        print(f"{name:24s} {truth:5s} {live*100:5.1f}% {pred:5s}  "
              f"[{pr[0]:.3f}, {pr[1]:.3f}, {pr[2]:.3f}]{flag}")
    print("-" * 70)
    print(f"PASS {npass}  FAIL {nfail}")


if __name__ == "__main__":
    main()

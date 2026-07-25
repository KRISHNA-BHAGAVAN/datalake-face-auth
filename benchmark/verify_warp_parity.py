#!/usr/bin/env python3
"""
Prove the app's JS warp matches the cv2.warpAffine that `run_alignment_ab.py`
benchmarked.

`run_alignment_ab.py` measured the accuracy gain using a direct
`cv2.warpAffine(rgb, M, (112,112))`. The device cannot do that: expo-image-
manipulator only crops, scales and rotates about the image centre. So
`ImageProcessor.warpAlignedFace` instead
  1. computes the axis-aligned source region covering the rotated output window,
     INTERSECTED with the image (never shifted),
  2. asks the native layer to crop+resize that region to a working buffer
     (JPEG-encoded at quality 1.0, then decoded by jpeg-js),
  3. inverse-warps that buffer into 112x112 with bilinear sampling in JS.

This script re-implements step 1-3 exactly as the TypeScript does, runs both
paths through the real MobileFaceNet, and reports the cosine similarity between
the two embeddings. Anything above ~0.99 means the benchmarked gain transfers.

Run from `benchmark/`:
    .venv/bin/python verify_warp_parity.py
"""
from __future__ import annotations

import argparse
import glob
import math

import cv2
import numpy as np

import pipeline_config as C
from detect import detect
from embedder import Embedder, cosine, _quality_ok

from preprocess import compute_align_transform, reference_warp, app_warp

OUT = C.OUTPUT_SIZE


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--images",
                    default="data/indian-actor-images-dataset/Bollywood Actor Images")
    ap.add_argument("--limit", type=int, default=250)
    args = ap.parse_args()

    paths = sorted(p for p in glob.glob(f"{args.images}/**/*.*", recursive=True)
                   if p.lower().endswith((".jpg", ".jpeg", ".png")))
    if len(paths) > args.limit:
        step = len(paths) / args.limit
        paths = [paths[int(i * step)] for i in range(args.limit)]

    emb = Embedder()
    sims, rolls, pixdiff = [], [], []

    for p in paths:
        bgr = cv2.imread(p, cv2.IMREAD_COLOR)
        if bgr is None:
            continue
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        d = detect(rgb)
        if d is None or not _quality_ok(rgb, d)[0]:
            continue
        t = compute_align_transform(d.left_eye, d.right_eye)
        if t is None:
            continue

        ref = reference_warp(rgb, t)
        app = app_warp(rgb, t)
        if app is None:
            continue

        e_ref = emb.embed_tensor((ref.astype(np.float32) - C.NORM_MEAN) / C.NORM_STD)
        e_app = emb.embed_tensor((app.astype(np.float32) - C.NORM_MEAN) / C.NORM_STD)
        sims.append(cosine(e_ref, e_app))
        pixdiff.append(float(np.abs(ref.astype(int) - app.astype(int)).mean()))
        rolls.append(abs(math.degrees(math.atan2(t["b"], t["a"]))))

    if not sims:
        raise SystemExit("no usable images")

    sims = np.array(sims)
    pixdiff = np.array(pixdiff)
    rolls = np.array(rolls)

    print(f"\nimages compared: {len(sims)}")
    print("\nembedding agreement, app JS warp vs benchmarked cv2.warpAffine")
    print("-" * 60)
    print(f"  mean cosine    {sims.mean():.5f}")
    print(f"  min  cosine    {sims.min():.5f}")
    print(f"  p1   cosine    {np.percentile(sims, 1):.5f}")
    print(f"  below 0.99     {(sims < 0.99).sum()} / {len(sims)}")
    print(f"  below 0.95     {(sims < 0.95).sum()} / {len(sims)}")
    print(f"\n  mean abs pixel diff (0-255)  {pixdiff.mean():.2f}")
    print(f"  head roll present: mean {rolls.mean():.1f} deg, max {rolls.max():.1f} deg")
    print("-" * 60)
    verdict = "EQUIVALENT" if sims.min() > 0.95 and sims.mean() > 0.99 else "DIVERGENT"
    print(f"  verdict: {verdict}\n")


if __name__ == "__main__":
    main()

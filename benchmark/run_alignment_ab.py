#!/usr/bin/env python3
"""
A/B the face-alignment geometry for MobileFaceNet.

Variants
--------
current  : the pipeline BEFORE the fix — an axis-aligned square crop matching the
           eye MIDPOINT and INTEROCULAR DISTANCE (uniform scale + translation),
           leaving in-plane head roll in the image.

roll     : the full ArcFace similarity transform — scale + translation + ROTATION —
           as a single cv2.warpAffine. Two point correspondences determine a
           similarity transform exactly, so this is closed-form, not an estimate.
           This is the mathematical reference.

roll_app : what the device actually computes (`ImageProcessor.warpAlignedFace`,
           mirrored by `preprocess.build_input`) — native crop of the intersected
           region, then a bilinear inverse-warp. This is the number to quote.

MobileFaceNet is trained on ArcFace-aligned crops, where every training face is
upright by construction. Leaving roll in means a tilted probe is compared against
an upright template and part of the cosine distance is head tilt rather than
identity. This measures whether fixing that is worth it.

Run from `benchmark/`:
    .venv/bin/python run_alignment_ab.py --folders "data/indian-actor-images-dataset/Bollywood Actor Images"
    .venv/bin/python run_alignment_ab.py --lfw data/lfw --pairs data/pairs.txt --limit 2000
"""
from __future__ import annotations

import argparse
import math
import os

import cv2
import numpy as np

import pipeline_config as C
from datasets import build_pairs_from_folders, load_lfw_pairs
from detect import detect
from embedder import Embedder, cosine
from preprocess import (
    build_input,
    legacy_build_input,
    compute_align_transform,
    reference_warp,
)
from embedder import _quality_ok


# --------------------------------------------------------------------------
# variant: roll-corrected similarity transform (candidate)
# --------------------------------------------------------------------------
def build_input_roll(rgb, det):
    """Reference: one direct cv2.warpAffine with the ArcFace similarity transform."""
    t = compute_align_transform(det.left_eye, det.right_eye)
    if t is None:
        return None, False
    warped = reference_warp(rgb, t)
    return (warped.astype(np.float32) - C.NORM_MEAN) / C.NORM_STD, True


VARIANTS = {
    # "current" = the pipeline BEFORE the roll fix, for before/after comparison.
    "current": legacy_build_input,
    # "roll" = the mathematical reference (direct warpAffine).
    "roll": build_input_roll,
    # "roll_app" = what the device computes, and what `build_input` now does.
    "roll_app": build_input,
}


# --------------------------------------------------------------------------
def metrics(scores, labels, thr=C.APP_COSINE_THRESHOLD):
    scores = np.asarray(scores, dtype=np.float64)
    labels = np.asarray(labels, dtype=int)
    pos, neg = scores[labels == 1], scores[labels == 0]

    # AUC via rank statistic (Mann-Whitney U), ties handled by average ranks.
    order = np.argsort(scores)
    ranks = np.empty(len(scores), dtype=np.float64)
    ranks[order] = np.arange(1, len(scores) + 1)
    _, inv, counts = np.unique(scores, return_inverse=True, return_counts=True)
    sums = np.zeros(len(counts))
    np.add.at(sums, inv, ranks)
    ranks = (sums / counts)[inv]
    auc = (ranks[labels == 1].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg))

    acc_app = float(((scores >= thr) == (labels == 1)).mean())
    cand = np.unique(scores)
    accs = [(float(((scores >= t) == (labels == 1)).mean()), float(t)) for t in cand]
    acc_best, thr_best = max(accs)

    frr = float((pos < thr).mean())      # genuine rejected
    far = float((neg >= thr).mean())     # impostor accepted
    return dict(auc=auc, acc_app=acc_app, acc_best=acc_best, thr_best=thr_best,
                frr=frr, far=far, n_pos=len(pos), n_neg=len(neg))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--folders")
    ap.add_argument("--lfw")
    ap.add_argument("--pairs")
    ap.add_argument("--num-same", type=int, default=1500)
    ap.add_argument("--num-diff", type=int, default=1500)
    ap.add_argument("--limit", type=int, default=0, help="cap total pairs")
    ap.add_argument("--no-quality", action="store_true")
    args = ap.parse_args()

    if args.folders:
        pairs = build_pairs_from_folders(args.folders, args.num_same, args.num_diff)
        label = f"folders:{os.path.basename(args.folders.rstrip('/'))}"
    elif args.lfw and args.pairs:
        pairs = load_lfw_pairs(args.lfw, args.pairs)
        label = "LFW"
    else:
        ap.error("pass --folders, or --lfw with --pairs")

    if args.limit and len(pairs) > args.limit:
        step = len(pairs) / args.limit
        pairs = [pairs[int(i * step)] for i in range(args.limit)]

    uniq = sorted({p.a for p in pairs} | {p.b for p in pairs})
    print(f"{label}: {len(pairs)} pairs, {len(uniq)} unique images")
    print("detecting + embedding each image once per variant...\n")

    embedder = Embedder()
    # cache: path -> {variant: embedding}. Detection is shared across variants so
    # the ONLY difference between them is the alignment geometry.
    cache: dict[str, dict[str, np.ndarray]] = {}
    n_detect_fail = n_quality_fail = 0

    for i, path in enumerate(uniq):
        if i % 500 == 0 and i:
            print(f"  {i}/{len(uniq)}")
        bgr = cv2.imread(path, cv2.IMREAD_COLOR)
        if bgr is None:
            n_detect_fail += 1
            continue
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        det = detect(rgb)
        if det is None:
            n_detect_fail += 1
            continue
        if not args.no_quality and not _quality_ok(rgb, det)[0]:
            n_quality_fail += 1
            continue
        entry = {}
        for name, fn in VARIANTS.items():
            out = fn(rgb, det)
            if out is None or out[0] is None:
                continue
            entry[name] = embedder.embed_tensor(out[0])
        if len(entry) == len(VARIANTS):
            cache[path] = entry

    print(f"\nusable images: {len(cache)}  "
          f"(detect fail {n_detect_fail}, quality fail {n_quality_fail})\n")

    print(f"{'variant':10s} {'pairs':>6s} {'AUC':>7s} "
          f"{'acc@'+format(C.APP_COSINE_THRESHOLD,'.2f'):>9s} "
          f"{'best acc':>9s} {'@thr':>6s} {'FRR%':>6s} {'FAR%':>6s}")
    print("-" * 70)
    results = {}
    for name in VARIANTS:
        scores, labels = [], []
        for p in pairs:
            if p.a not in cache or p.b not in cache:
                continue
            scores.append(cosine(cache[p.a][name], cache[p.b][name]))
            labels.append(p.label)
        m = metrics(scores, labels)
        results[name] = m
        print(f"{name:10s} {len(scores):6d} {m['auc']:7.4f} {m['acc_app']:9.4f} "
              f"{m['acc_best']:9.4f} {m['thr_best']:6.3f} "
              f"{100*m['frr']:6.2f} {100*m['far']:6.2f}")
    print("-" * 70)

    base = results["current"]
    for name in VARIANTS:
        if name == "current":
            continue
        cand = results[name]
        print(f"\n{name} vs current:  AUC {cand['auc']-base['auc']:+.4f}   "
              f"acc {100*(cand['acc_app']-base['acc_app']):+.2f} pp   "
              f"FRR {100*(cand['frr']-base['frr']):+.2f} pp   "
              f"FAR {100*(cand['far']-base['far']):+.2f} pp")
    print("\n(FRR down = fewer genuine users rejected; FAR down = fewer impostors accepted)")
    print("'roll' is the reference cv2.warpAffine; 'roll_app' is the shipped JS warp.\n")

    # Better separability means a new operating point: find thresholds where the
    # shipped variant beats the OLD pipeline on BOTH error rates at once.
    print("Threshold sweep for the shipped variant (roll_app):")
    print(f"  baseline to beat — pre-fix pipeline: FRR {100*base['frr']:.2f}%  "
          f"FAR {100*base['far']:.2f}%\n")
    print(f"  {'thr':>6s} {'FRR%':>7s} {'FAR%':>7s} {'acc%':>7s}  {'':s}")
    scores, labels = [], []
    for p in pairs:
        if p.a in cache and p.b in cache:
            scores.append(cosine(cache[p.a]["roll_app"], cache[p.b]["roll_app"]))
            labels.append(p.label)
    scores = np.asarray(scores)
    labels = np.asarray(labels)
    for thr in [0.40, 0.45, 0.48, 0.50, 0.52, 0.55, 0.58, 0.60, 0.65]:
        m = metrics(scores, labels, thr)
        strictly_better = m["frr"] < base["frr"] and m["far"] <= base["far"]
        print(f"  {thr:6.2f} {100*m['frr']:7.2f} {100*m['far']:7.2f} "
              f"{100*m['acc_app']:7.2f}  {'<- beats old on BOTH' if strictly_better else ''}")
    print()


if __name__ == "__main__":
    main()

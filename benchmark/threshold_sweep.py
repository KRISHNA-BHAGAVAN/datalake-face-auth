"""
Threshold operating-point table for the LFW run.

Re-embeds the LFW pairs (same app pipeline) and reports, per candidate cosine
threshold: FRR (genuine rejected), FAR (impostor accepted), and balanced
accuracy. Use to pick a deployment threshold that trades usability vs security.

    python threshold_sweep.py --lfw data/lfw --pairs data/pairs.txt
"""

import argparse
import numpy as np

from datasets import load_lfw_pairs
from embedder import Embedder, cosine
from run_benchmark import embed_unique, score_pairs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lfw", required=True)
    ap.add_argument("--pairs", required=True)
    ap.add_argument("--thresholds", default="0.30,0.35,0.373,0.40,0.45,0.50,0.55,0.65")
    args = ap.parse_args()

    pairs = load_lfw_pairs(args.lfw, args.pairs)
    embedder = Embedder()
    cache, _, _ = embed_unique(embedder, pairs)
    scores, labels, _, _ = score_pairs(pairs, cache)

    pos = scores[labels == 1]   # genuine pairs
    neg = scores[labels == 0]   # impostor pairs
    n_pos, n_neg = len(pos), len(neg)

    print(f"\nGenuine pairs: {n_pos}   Impostor pairs: {n_neg}\n")
    print(f"{'thr':>6} | {'FRR %':>7} | {'FAR %':>7} | {'TAR %':>7} | {'bal acc %':>9}")
    print("-" * 50)
    for t in [float(x) for x in args.thresholds.split(",")]:
        frr = float((pos < t).mean()) * 100          # genuine scored below thr -> rejected
        far = float((neg >= t).mean()) * 100         # impostor scored above thr -> accepted
        tar = 100 - frr                              # genuine accepted
        acc = float((np.concatenate([pos >= t, neg < t])).mean()) * 100
        print(f"{t:>6.3f} | {frr:>7.2f} | {far:>7.2f} | {tar:>7.2f} | {acc:>9.2f}")


if __name__ == "__main__":
    main()

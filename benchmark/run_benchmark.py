"""
Face VERIFICATION benchmark for the app's MobileFaceNet pipeline.

Feeds image pairs through the exact app pipeline (detect -> eye-align -> 112x112
-> (x-127.5)/127.5 RGB -> mobilefacenet.tflite), scores each pair by cosine
similarity, and reports verification metrics: accuracy @ the app threshold,
best-threshold accuracy, LFW 10-fold accuracy (mean +/- std), ROC AUC, and
TAR@FAR. Liveness is intentionally NOT part of this benchmark.

Examples:
    # LFW (after: python fetch_lfw.py)
    python run_benchmark.py --lfw data/lfw --pairs data/pairs.txt

    # Any identity-foldered dataset (folder per person) — e.g. an Indian set
    python run_benchmark.py --folders /path/to/dataset --num-same 1500 --num-diff 1500

Outputs (in --out, default ./results): report.md, results.json, roc.png, scores.png
"""

import argparse
import json
import os

import numpy as np
from tqdm import tqdm

from datasets import load_lfw_pairs, build_pairs_from_folders
from embedder import Embedder, cosine
import pipeline_config as C


def embed_unique(embedder, pairs, quality_gate=True):
    """Embed every distinct image once. Returns {path: embedding} and fail count."""
    paths = sorted({p.a for p in pairs} | {p.b for p in pairs})
    cache, aligned_n, fail = {}, 0, 0
    for path in tqdm(paths, desc="embedding", unit="img"):
        emb, aligned = embedder.embed_image(path, quality_gate=quality_gate)
        if emb is None:
            fail += 1
            continue
        cache[path] = emb
        aligned_n += int(aligned)
    return cache, aligned_n, fail


def score_pairs(pairs, cache):
    scores, labels, folds, skipped = [], [], [], 0
    for p in pairs:
        ea, eb = cache.get(p.a), cache.get(p.b)
        if ea is None or eb is None:
            skipped += 1
            continue
        scores.append(cosine(ea, eb))
        labels.append(p.label)
        folds.append(p.fold)
    return np.array(scores), np.array(labels), np.array(folds), skipped


def accuracy_at(scores, labels, thr):
    pred = (scores >= thr).astype(int)
    return float((pred == labels).mean())


def best_threshold(scores, labels):
    """Threshold maximizing accuracy over candidate cuts."""
    cands = np.unique(scores)
    best_t, best_a = 0.0, 0.0
    for t in cands:
        a = accuracy_at(scores, labels, t)
        if a > best_a:
            best_a, best_t = a, float(t)
    return best_t, best_a


def lfw_10fold(scores, labels, folds):
    """Standard LFW protocol: per fold, pick threshold on the other 9 folds."""
    uniq = sorted(set(folds.tolist()))
    if len(uniq) < 2:
        return None
    accs = []
    for f in uniq:
        train = folds != f
        test = folds == f
        t, _ = best_threshold(scores[train], labels[train])
        accs.append(accuracy_at(scores[test], labels[test], t))
    return float(np.mean(accs)), float(np.std(accs))


def sweep_table(scores, labels, thresholds):
    """Operating-point sweep: per threshold, FRR / FAR / TAR / balanced accuracy.

    FRR = genuine pairs scored below threshold (rejected).
    FAR = impostor pairs scored at/above threshold (accepted) — the security risk.
    Lets a deployment threshold be chosen by trading usability (TAR) vs fraud (FAR)
    instead of hardcoding a magic number.
    """
    pos = scores[labels == 1]
    neg = scores[labels == 0]
    rows = []
    for t in thresholds:
        frr = float((pos < t).mean()) if len(pos) else 0.0
        far = float((neg >= t).mean()) if len(neg) else 0.0
        acc = float(np.concatenate([pos >= t, neg < t]).mean()) if len(scores) else 0.0
        rows.append({
            "threshold": float(t),
            "frr": frr,
            "far": far,
            "tar": 1.0 - frr,
            "balanced_acc": acc,
        })
    return rows


def tar_at_far(scores, labels, far_targets=(0.1, 0.01, 0.001)):
    """True Accept Rate at fixed False Accept Rate targets (impostor-driven)."""
    from sklearn.metrics import roc_curve
    fpr, tpr, _ = roc_curve(labels, scores)
    out = {}
    for far in far_targets:
        idx = np.searchsorted(fpr, far, side="right") - 1
        idx = max(0, min(idx, len(tpr) - 1))
        out[f"TAR@FAR={far:g}"] = float(tpr[idx])
    return out


def plots(scores, labels, out_dir):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from sklearn.metrics import roc_curve, auc

    fpr, tpr, _ = roc_curve(labels, scores)
    roc_auc = auc(fpr, tpr)

    plt.figure(figsize=(5, 5))
    plt.plot(fpr, tpr, label=f"AUC = {roc_auc:.4f}")
    plt.plot([0, 1], [0, 1], "--", color="gray", linewidth=0.8)
    plt.xlabel("False Accept Rate")
    plt.ylabel("True Accept Rate")
    plt.title("ROC — Face Verification")
    plt.legend(loc="lower right")
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, "roc.png"), dpi=140)
    plt.close()

    plt.figure(figsize=(6, 4))
    plt.hist(scores[labels == 1], bins=50, alpha=0.6, label="same person", color="#2a9d8f")
    plt.hist(scores[labels == 0], bins=50, alpha=0.6, label="different", color="#e76f51")
    plt.axvline(C.APP_COSINE_THRESHOLD, color="black", linestyle="--",
                label=f"app threshold {C.APP_COSINE_THRESHOLD}")
    plt.xlabel("cosine similarity")
    plt.ylabel("pair count")
    plt.title("Score distribution")
    plt.legend()
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, "scores.png"), dpi=140)
    plt.close()
    return float(roc_auc)


def write_report(out_dir, meta, results):
    with open(os.path.join(out_dir, "results.json"), "w") as f:
        json.dump({"meta": meta, "results": results}, f, indent=2)

    L = []
    L.append("# Face Verification Benchmark\n")
    L.append("Pipeline: same `mobilefacenet.tflite` + same preprocessing/alignment "
             "as the app (`src/ml/ImageProcessor.ts`). Liveness excluded.\n")
    L.append("## Setup\n")
    L.append(f"- Dataset: **{meta['dataset']}**")
    L.append(f"- Model: `{meta['model']['layout']}` input "
             f"{meta['model']['input_shape']}, embedding dim "
             f"**{meta['model']['embedding_dim']}**")
    L.append(f"- Pairs scored: **{results['pairs_scored']}** "
             f"({results['pos']} same / {results['neg']} different)")
    L.append(f"- Faces detected: {meta['detected']}/{meta['unique_images']} unique "
             f"images ({meta['detect_fail']} no-face); {meta['aligned']} eye-aligned")
    L.append(f"- Pairs skipped (face missing on one side): {results['skipped']}\n")
    L.append("## Results\n")
    L.append("| Metric | Value |")
    L.append("|---|---|")
    L.append(f"| Accuracy @ app threshold ({C.APP_COSINE_THRESHOLD}) | "
             f"**{results['acc_app']*100:.2f}%** |")
    L.append(f"| Best-threshold accuracy | {results['acc_best']*100:.2f}% "
             f"(thr={results['best_thr']:.3f}) |")
    if results.get("lfw_10fold"):
        m, s = results["lfw_10fold"]
        L.append(f"| LFW 10-fold accuracy | **{m*100:.2f}% ± {s*100:.2f}%** |")
    L.append(f"| ROC AUC | {results['auc']:.4f} |")
    for k, v in results["tar_far"].items():
        L.append(f"| {k} | {v*100:.2f}% |")
    sweep = results.get("sweep") or []
    if sweep:
        best = max(sweep, key=lambda r: r["balanced_acc"])
        L.append("\n## Threshold operating points\n")
        L.append("Cosine threshold is a tunable deployment parameter. FAR (impostor "
                 "accepted) is the fraud risk; FRR (genuine rejected) is the usability "
                 "cost. Pick the threshold meeting your target FAR, then read TAR.\n")
        L.append(f"App threshold is `{C.APP_COSINE_THRESHOLD}`; accuracy peaks at "
                 f"**{best['threshold']:.3f}** ({best['balanced_acc']*100:.2f}%).\n")
        L.append("| threshold | FRR % (genuine rejected) | FAR % (impostor accepted) "
                 "| TAR % (genuine accepted) | balanced acc % |")
        L.append("|---|---|---|---|---|")
        for r in sweep:
            tag = ""
            if abs(r["threshold"] - C.APP_COSINE_THRESHOLD) < 1e-9:
                tag = " (app)"
            elif r is best:
                tag = " (peak)"
            L.append(f"| {r['threshold']:.3f}{tag} | {r['frr']*100:.2f} | "
                     f"{r['far']*100:.2f} | {r['tar']*100:.2f} | "
                     f"{r['balanced_acc']*100:.2f} |")
        L.append("")

    L.append("\n## Plots\n")
    L.append("![ROC](roc.png)\n")
    L.append("![Score distribution](scores.png)\n")
    L.append("> Numbers reflect the on-device model + preprocessing. The benchmark "
             "uses MediaPipe for detection vs ML Kit on device; eye-midpoint "
             "alignment makes the embedding robust to that swap. Cross-check a few "
             "pairs on-device for the final figure.\n")
    report = "\n".join(L)
    with open(os.path.join(out_dir, "report.md"), "w") as f:
        f.write(report)

    # Standalone sweep.md for quick reference / pasting into the hackathon doc.
    if sweep:
        S = ["# Threshold operating points\n",
             f"Dataset: {meta['dataset']} — {results['pos']} genuine / "
             f"{results['neg']} impostor pairs.\n",
             "| threshold | FRR % | FAR % | TAR % | balanced acc % |",
             "|---|---|---|---|---|"]
        for r in sweep:
            S.append(f"| {r['threshold']:.3f} | {r['frr']*100:.2f} | "
                     f"{r['far']*100:.2f} | {r['tar']*100:.2f} | "
                     f"{r['balanced_acc']*100:.2f} |")
        with open(os.path.join(out_dir, "sweep.md"), "w") as f:
            f.write("\n".join(S) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lfw", help="LFW image root (folder per person)")
    ap.add_argument("--pairs", help="LFW pairs.txt")
    ap.add_argument("--folders", help="identity-foldered dataset root (auto-pairs)")
    ap.add_argument("--num-same", type=int, default=1500)
    ap.add_argument("--num-diff", type=int, default=1500)
    ap.add_argument("--limit", type=int, default=0, help="cap pairs (smoke test)")
    ap.add_argument("--thresholds",
                    default="0.30,0.35,0.373,0.40,0.45,0.50,0.55,0.65",
                    help="comma-separated cosine thresholds for the operating-point sweep")
    ap.add_argument("--out", default="results")
    ap.add_argument("--no-quality", dest="quality", action="store_false",
                    help="disable the app quality gate (keep blurry/tiny/dark faces)")
    ap.set_defaults(quality=True)
    args = ap.parse_args()

    if args.lfw and args.pairs:
        pairs = load_lfw_pairs(args.lfw, args.pairs)
        dataset = f"LFW ({os.path.basename(args.lfw)})"
    elif args.folders:
        pairs = build_pairs_from_folders(args.folders, args.num_same, args.num_diff)
        dataset = f"folders:{os.path.basename(args.folders.rstrip('/'))}"
    else:
        ap.error("provide either --lfw + --pairs, or --folders")

    if args.limit:
        # Stratified cap: take half same / half different so a smoke test still
        # has both classes. A naive pairs[:N] grabs LFW's leading 300 same-person
        # block first -> zero negatives -> AUC nan, TAR@FAR=0, fake 100%.
        half = args.limit // 2
        pos = [p for p in pairs if p.label == 1][:half]
        neg = [p for p in pairs if p.label == 0][: args.limit - half]
        pairs = pos + neg

    os.makedirs(args.out, exist_ok=True)
    embedder = Embedder()
    model_meta = embedder.describe()
    print("Model:", model_meta)
    print(f"Pairs: {len(pairs)}")

    print(f"Quality gate: {'on' if args.quality else 'off'}")
    cache, aligned_n, fail = embed_unique(embedder, pairs, quality_gate=args.quality)
    scores, labels, folds, skipped = score_pairs(pairs, cache)
    if len(scores) == 0:
        raise SystemExit("No pairs scored — check dataset paths / detection.")

    auc_val = plots(scores, labels, args.out)
    best_thr, acc_best = best_threshold(scores, labels)
    results = {
        "pairs_scored": int(len(scores)),
        "pos": int((labels == 1).sum()),
        "neg": int((labels == 0).sum()),
        "skipped": int(skipped),
        "acc_app": accuracy_at(scores, labels, C.APP_COSINE_THRESHOLD),
        "acc_best": acc_best,
        "best_thr": best_thr,
        "auc": auc_val,
        "tar_far": tar_at_far(scores, labels),
        "lfw_10fold": lfw_10fold(scores, labels, folds),
        "sweep": sweep_table(
            scores, labels, [float(x) for x in args.thresholds.split(",")]),
    }
    meta = {
        "dataset": dataset,
        "model": model_meta,
        "unique_images": len(cache) + fail,
        "detected": len(cache),
        "detect_fail": fail,
        "aligned": aligned_n,
    }
    write_report(args.out, meta, results)

    print("\n=== RESULTS ===")
    print(f"Accuracy @ {C.APP_COSINE_THRESHOLD}: {results['acc_app']*100:.2f}%")
    print(f"Best-threshold accuracy: {acc_best*100:.2f}% (thr={best_thr:.3f})")
    if results["lfw_10fold"]:
        m, s = results["lfw_10fold"]
        print(f"LFW 10-fold: {m*100:.2f}% +/- {s*100:.2f}%")
    print(f"AUC: {auc_val:.4f}")
    for k, v in results["tar_far"].items():
        print(f"{k}: {v*100:.2f}%")
    print("\n--- threshold sweep (thr | FRR% | FAR% | TAR% | bal acc%) ---")
    for r in results["sweep"]:
        print(f"{r['threshold']:>6.3f} | {r['frr']*100:>6.2f} | {r['far']*100:>6.2f} "
              f"| {r['tar']*100:>6.2f} | {r['balanced_acc']*100:>6.2f}")
    print(f"\nReport -> {os.path.join(args.out, 'report.md')}")


if __name__ == "__main__":
    main()

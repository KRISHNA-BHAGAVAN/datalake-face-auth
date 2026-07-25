"""
Template-averaging verification eval — mirrors how the APP actually enrolls.

The app stores a template = mean of `enrollEmbeddings` (3) captured embeddings and
verifies with a single probe (`verifyEmbeddings` 1). The pairwise LFW-style harness
(run_benchmark.py) instead scores single-image vs single-image, which is the harshest
possible case. This script reproduces the device behaviour for an identity-foldered
dataset:

    per identity with >= K+1 usable images:
        template = mean of K enroll embeddings (L2-normalized then averaged)
        probes   = the remaining images
    genuine  score = cosine(template_id, probe_of_same_id)
    impostor score = cosine(template_id, probe_of_other_id)

Reports the same metrics as run_benchmark (acc @ app threshold, best-threshold,
AUC, TAR@FAR, operating-point sweep) so the two are directly comparable.

    python template_eval.py --folders "data/.../Bollywood Actor Images" \
        --num-same 1500 --num-diff 1500 --out results/indian_template_avg
"""

import argparse
import os
import random

import numpy as np
from tqdm import tqdm

from embedder import Embedder, cosine
import pipeline_config as C
from run_benchmark import (accuracy_at, best_threshold, tar_at_far,
                           sweep_table, plots, write_report)

IMG_EXT = (".jpg", ".jpeg", ".png", ".bmp", ".webp")


def scan_identities(root):
    """root -> {identity_name: [image_path, ...]} for one-folder-per-person sets."""
    ids = {}
    for name in sorted(os.listdir(root)):
        d = os.path.join(root, name)
        if not os.path.isdir(d):
            continue
        imgs = [os.path.join(d, f) for f in sorted(os.listdir(d))
                if f.lower().endswith(IMG_EXT)]
        if imgs:
            ids[name] = imgs
    return ids


def l2norm(v):
    n = np.linalg.norm(v)
    return v / n if n else v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--folders", required=True, help="identity-foldered dataset root")
    ap.add_argument("--enroll", type=int, default=C_ENROLL(),
                    help="images averaged into a template (app: enrollEmbeddings=3)")
    ap.add_argument("--num-same", type=int, default=1500)
    ap.add_argument("--num-diff", type=int, default=1500)
    ap.add_argument("--thresholds",
                    default="0.30,0.35,0.373,0.40,0.45,0.50,0.55,0.65")
    ap.add_argument("--seed", type=int, default=1234)
    ap.add_argument("--out", default="results_template")
    ap.add_argument("--no-quality", dest="quality", action="store_false")
    ap.set_defaults(quality=True)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    os.makedirs(args.out, exist_ok=True)
    embedder = Embedder()
    model_meta = embedder.describe()
    print("Model:", model_meta)
    print(f"Quality gate: {'on' if args.quality else 'off'}  Enroll K={args.enroll}")

    identities = scan_identities(args.folders)

    # Embed every image once (quality-gated, same as the app would capture).
    templates = {}     # id -> averaged template embedding
    probes = {}        # id -> [probe embeddings]
    n_imgs = n_ok = 0
    for name, paths in tqdm(identities.items(), desc="identities", unit="id"):
        embs = []
        for p in paths:
            n_imgs += 1
            e, _ = embedder.embed_image(p, quality_gate=args.quality)
            if e is not None:
                embs.append(l2norm(e))
                n_ok += 1
        if len(embs) < args.enroll + 1:
            continue  # not enough usable images to enroll AND probe
        rng.shuffle(embs)
        templates[name] = l2norm(np.mean(embs[:args.enroll], axis=0))
        probes[name] = embs[args.enroll:]

    usable_ids = [n for n in templates if probes.get(n)]
    if len(usable_ids) < 2:
        raise SystemExit("Need >=2 identities with enough images after the quality gate.")

    # Genuine: template_id vs its own held-out probes.
    genuine = [(n, pe) for n in usable_ids for pe in probes[n]]
    rng.shuffle(genuine)
    genuine = genuine[: args.num_same]

    # Impostor: template_id vs a probe from a different identity.
    impostor = []
    while len(impostor) < args.num_diff:
        a, b = rng.sample(usable_ids, 2)
        impostor.append((a, rng.choice(probes[b])))

    scores, labels = [], []
    for n, pe in genuine:
        scores.append(cosine(templates[n], pe)); labels.append(1)
    for n, pe in impostor:
        scores.append(cosine(templates[n], pe)); labels.append(0)
    scores = np.array(scores); labels = np.array(labels)

    auc_val = plots(scores, labels, args.out)
    best_thr, acc_best = best_threshold(scores, labels)
    results = {
        "pairs_scored": int(len(scores)),
        "pos": int((labels == 1).sum()),
        "neg": int((labels == 0).sum()),
        "skipped": 0,
        "acc_app": accuracy_at(scores, labels, C.APP_COSINE_THRESHOLD),
        "acc_best": acc_best,
        "best_thr": best_thr,
        "auc": auc_val,
        "tar_far": tar_at_far(scores, labels),
        "lfw_10fold": None,
        "sweep": sweep_table(scores, labels,
                             [float(x) for x in args.thresholds.split(",")]),
    }
    meta = {
        "dataset": f"template-avg (K={args.enroll}) folders:"
                   f"{os.path.basename(args.folders.rstrip('/'))}",
        "model": model_meta,
        "unique_images": n_imgs,
        "detected": n_ok,
        "detect_fail": n_imgs - n_ok,
        "aligned": n_ok,
    }
    write_report(args.out, meta, results)

    print("\n=== RESULTS (template averaging) ===")
    print(f"Identities used: {len(usable_ids)}  "
          f"Genuine: {results['pos']}  Impostor: {results['neg']}")
    print(f"Accuracy @ {C.APP_COSINE_THRESHOLD}: {results['acc_app']*100:.2f}%")
    print(f"Best-threshold accuracy: {acc_best*100:.2f}% (thr={best_thr:.3f})")
    print(f"AUC: {auc_val:.4f}")
    for k, v in results["tar_far"].items():
        print(f"{k}: {v*100:.2f}%")
    print("\n--- threshold sweep (thr | FRR% | FAR% | TAR% | bal acc%) ---")
    for r in results["sweep"]:
        print(f"{r['threshold']:>6.3f} | {r['frr']*100:>6.2f} | {r['far']*100:>6.2f} "
              f"| {r['tar']*100:>6.2f} | {r['balanced_acc']*100:>6.2f}")
    print(f"\nReport -> {os.path.join(args.out, 'report.md')}")


def C_ENROLL():
    """App default enrollEmbeddings (kept here to avoid importing the TS config)."""
    return 3


if __name__ == "__main__":
    main()

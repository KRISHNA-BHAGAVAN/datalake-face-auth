# Face Verification Benchmark

Offline accuracy proof for the app's recognition model. It runs the **same**
`assets/models/mobilefacenet.tflite` through the **same** preprocessing the
device uses (detect → eye-landmark alignment to ArcFace canonical geometry →
112×112 → `(px-127.5)/127.5` RGB → embedding → cosine similarity), then scores
labeled image **pairs** to produce verification metrics.

Standalone and **does not touch the React Native app** — separate folder, own
Python venv, not bundled by Metro.

> Liveness / anti-spoofing is intentionally **out of scope** here. This measures
> recognition accuracy only.

## Headline results (reproduce with the commands below)

| Dataset | Protocol | Accuracy | ROC AUC | TAR@FAR=1% |
|---|---|---|---|---|
| **LFW** (Western, curated) | standard 10-fold, 6000 pairs | **96.75% ± 0.69%** | **0.982** | 94.6% |
| **Indian** (Bollywood actors) | template-avg, 1500/1500 pairs | **92.4%** (90.9% @ 0.45) | **0.964** | 83.4% |

- **LFW 96.8%** clears the hackathon's **>95% accuracy** bar on the de-facto
  standard verification protocol.
- **Indian 92.4%** demonstrates real device behaviour on Indian demographics, on
  an *uncontrolled, cross-decade* web-scrape (same actor photographed 30+ years
  apart). The residual gap vs LFW is era/age span, not a pipeline defect — see
  [Why two numbers](#why-two-numbers).

## Why the deployed threshold is 0.45 (not 0.65)

The benchmark drives the threshold choice. The model's separability is fixed
(AUC 0.982); the cosine threshold only picks the operating point — trading
**FRR** (genuine user rejected, usability) against **FAR** (impostor accepted,
fraud). The old `0.65` was far past the optimum: on LFW it rejected **~35% of
genuine users** (FRR 33.0%) while buying no extra security (FAR was already 0%
by 0.50). The sweep is in every run's `report.md` / `sweep.md`:

| threshold | FRR % (genuine rejected) | FAR % (impostor accepted) | balanced acc % |
|---|---|---|---|
| 0.373 (LFW peak) | 5.7 | 0.60 | 96.8 |
| **0.45 (deployed)** | 8.0 | **0.09** | 95.9 |
| 0.65 (old) | **33.0** | 0.00 | 83.3 |

`0.45` is security-leaning (FAR ≈ 1 impostor in 1400) while still clearing 95% on
LFW. Set in `src/utils/config.ts → recognition.cosineSimilarityThreshold`.

## What it reports

- **Accuracy @ app threshold** — how the deployed cut performs.
- **Best-threshold accuracy** — the ceiling at the optimal cut (+ the threshold).
- **LFW 10-fold accuracy (mean ± std)** — the standard LFW protocol.
- **ROC AUC** — threshold-independent separability.
- **TAR@FAR** = True Accept Rate at False Accept Rate `0.1 / 0.01 / 0.001` — the
  security-relevant metric (genuine accepts at a fixed impostor rate).
- **Threshold operating-point sweep** — FRR / FAR / TAR / balanced accuracy per
  candidate threshold (`--thresholds`), so the deployed value is data-justified.
- Plots: ROC curve, same-vs-different score histogram with the threshold marked.

Outputs land in `--out` (default `results/`): `report.md`, `results.json`,
`sweep.md`, `roc.png`, `scores.png`.

## Setup

```bash
cd benchmark
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Option A — LFW (recommended default, free, no license)

The de-facto face-verification benchmark: 6000 pairs (3000 same / 3000 different),
official `pairs.txt`.

```bash
python fetch_lfw.py     # -> data/lfw/ + data/pairs.txt
python run_benchmark.py --lfw data/lfw --pairs data/pairs.txt
```

`fetch_lfw.py` tries the UMass origin first; if that host is unreachable (common),
it automatically falls back to scikit-learn's figshare mirror — same data, no
signup. Smoke test first (stratified 200 pairs): add `--limit 200`.

## Option B — Indian-demographic / any identity-foldered dataset

The hackathon rewards diverse-Indian-demographic accuracy. The "proper" Indian
sets (IIIT-D **DFW**, **IIIT-D Face**, IITB **IMFDB**) require a signed research
license emailed to the host lab — slow, and not in pairs format. Instead use a
**free, no-agreement** identity-foldered Kaggle set:

```bash
# 135 Bollywood actors x ~50 imgs, one folder per actor (full-frame portraits)
pip install kagglehub
python -c "import kagglehub; print(kagglehub.dataset_download('iamsouravbanerjee/indian-actor-images-dataset'))"
# copy/symlink the printed path under data/, then point the harness at the
# 'Bollywood Actor Images' subfolder:
```

Any dataset arranged **one folder per person** works:

```
dataset/
  person_a/  img1.jpg  img2.jpg ...
  person_b/  img1.jpg ...
```

Two ways to evaluate it:

```bash
# 1) Pairwise (harshest: single image vs single image)
python run_benchmark.py \
  --folders "data/indian-actor-images-dataset/Bollywood Actor Images" \
  --num-same 1500 --num-diff 1500 --out results_indian

# 2) Template averaging (mirrors the app: enroll = mean of 3 embeddings vs a
#    single probe). This is how the device actually works -> the fair number.
python template_eval.py \
  --folders "data/indian-actor-images-dataset/Bollywood Actor Images" \
  --num-same 1500 --num-diff 1500 --out results_indian_template
```

## Quality gate

Both runners apply the app's per-frame quality gate by default (mirrors
`config.quality`): they skip faces that are low-confidence, too small
(`<0.18` width ratio), too dark/blown, or blurry (variance-of-Laplacian) — the
same frames the device would reject before capturing an embedding. Disable with
`--no-quality` to see the unfiltered floor. (Yaw/pitch gates are device-only —
ML Kit reports head angles, MediaPipe Face Detection here does not.)

## Why two numbers

LFW genuine pairs are same-era, curated photos; the Bollywood set's genuine pairs
mix a 1970s B&W still with a 2020s photo of the **same** actor (e.g. Sridevi
across a 30-year career) plus web-scrape label noise. Both faces can be sharp and
well-detected yet barely resemble each other — so the Indian set is intrinsically
a harder *stress test*, not a like-for-like LFW comparison. Two honest levers
close most of the gap without cheating:

1. **Quality gate** drops scrape noise (AUC 0.904 → 0.916 single-image).
2. **Template averaging** (the app's real 3-frame enroll) is the big one
   (AUC 0.916 → **0.964**, accuracy 86.7% → **92.4%**).

We deliberately **do not** claim >95% on Indian demographics — the curated-LFW
96.8% is the standard-protocol accuracy proof; the Indian 92.4% is a candid,
reproducible demonstration on a deliberately hard real-world distribution.

## Faithfulness note

Detection here uses **MediaPipe** (pip-installable) vs **ML Kit** on device. Both
are Google detectors with the same landmark conventions, and alignment is driven
by eye midpoint + interocular distance, so the embedding is robust to the swap.
Everything *after* detection — crop geometry, normalization, the model file
itself — is identical to the app. For the headline figure in the deck, cross-check
a handful of pairs on-device.

## File map

| File | Role |
|---|---|
| `pipeline_config.py` | constants mirrored from `src/utils/config.ts` + `ImageProcessor.ts` |
| `detect.py` | MediaPipe face detection + eye keypoints + confidence |
| `preprocess.py` | port of `ImageProcessor` align/crop/normalize |
| `embedder.py` | loads `mobilefacenet.tflite`, embeds, cosine, quality gate |
| `datasets.py` | LFW `pairs.txt` loader + identity-folder auto-pairing |
| `fetch_lfw.py` | download + extract LFW (UMass → sklearn/figshare fallback) |
| `run_benchmark.py` | pairwise orchestration + metrics + sweep + report |
| `template_eval.py` | template-averaging eval (app's 3-frame enroll behaviour) |
| `threshold_sweep.py` | standalone FRR/FAR/TAR table for a finished run |

"""
Pair builders. A "pair" is (path_a, path_b, label) where label 1 = same person,
0 = different person. fold is an optional int for LFW's 10-fold protocol.
"""

import os
import random
from collections import namedtuple

Pair = namedtuple("Pair", ["a", "b", "label", "fold"])


def _lfw_img(root, name, idx):
    return os.path.join(root, name, f"{name}_{int(idx):04d}.jpg")


def load_lfw_pairs(lfw_root, pairs_txt):
    """
    Parse the official LFW pairs.txt (6000 pairs, 10 folds of 300 same + 300 diff).
    lfw_root: directory containing one subfolder per person.
    """
    with open(pairs_txt) as f:
        lines = [ln.strip() for ln in f if ln.strip()]

    header = lines[0].split()
    n_folds, per = int(header[0]), int(header[1])  # e.g. 10, 300
    pairs = []
    i = 1
    for fold in range(n_folds):
        for _ in range(per):  # matched
            p = lines[i].split(); i += 1
            name, i1, i2 = p[0], p[1], p[2]
            pairs.append(Pair(_lfw_img(lfw_root, name, i1),
                              _lfw_img(lfw_root, name, i2), 1, fold))
        for _ in range(per):  # mismatched
            p = lines[i].split(); i += 1
            n1, i1, n2, i2 = p[0], p[1], p[2], p[3]
            pairs.append(Pair(_lfw_img(lfw_root, n1, i1),
                              _lfw_img(lfw_root, n2, i2), 0, fold))
    return pairs


def build_pairs_from_folders(root, num_same=1500, num_diff=1500, seed=42):
    """
    Auto-build pairs from any identity-foldered dataset (one folder per person,
    images inside). Use this for Indian-demographic sets obtained as folder-per-id.
    Deterministic given seed.
    """
    rng = random.Random(seed)
    people = {}
    for name in sorted(os.listdir(root)):
        d = os.path.join(root, name)
        if not os.path.isdir(d):
            continue
        imgs = sorted(
            os.path.join(d, f) for f in os.listdir(d)
            if f.lower().endswith((".jpg", ".jpeg", ".png"))
        )
        if imgs:
            people[name] = imgs

    names = list(people)
    if len(names) < 2:
        raise ValueError(f"Need >=2 identities with images under {root}")

    multi = [n for n in names if len(people[n]) >= 2]
    pairs = []

    # same-person pairs
    seen = set()
    tries = 0
    while len(pairs) < num_same and multi and tries < num_same * 50:
        tries += 1
        n = rng.choice(multi)
        a, b = rng.sample(people[n], 2)
        key = (a, b) if a < b else (b, a)
        if key in seen:
            continue
        seen.add(key)
        pairs.append(Pair(a, b, 1, 0))

    # different-person pairs
    seen = set()
    tries = 0
    while len([p for p in pairs if p.label == 0]) < num_diff and tries < num_diff * 50:
        tries += 1
        n1, n2 = rng.sample(names, 2)
        a = rng.choice(people[n1])
        b = rng.choice(people[n2])
        key = (a, b) if a < b else (b, a)
        if key in seen:
            continue
        seen.add(key)
        pairs.append(Pair(a, b, 0, 0))

    rng.shuffle(pairs)
    return pairs

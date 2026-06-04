"""
Fetch the official LFW dataset + pairs.txt (6000-pair, 10-fold protocol).

Tries the UMass origin first; if that host is unreachable (it often is), falls
back to scikit-learn's fetcher, which pulls the SAME data from a figshare mirror
and extracts the original (non-funneled) images to disk. Either way you end up
with local image files + pairs.txt that run_benchmark.py consumes.

Usage:
    python fetch_lfw.py        # -> ./data/lfw/  + ./data/pairs.txt
"""

import os
import shutil
import sys
import tarfile
import urllib.request

LFW_TGZ = "https://vis-www.cs.umass.edu/lfw/lfw.tgz"
PAIRS = "https://vis-www.cs.umass.edu/lfw/pairs.txt"
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")


def _download(url, dst):
    if os.path.exists(dst):
        print(f"  exists: {dst}")
        return

    def hook(blocks, bs, total):
        if total > 0:
            pct = min(100, blocks * bs * 100 // total)
            sys.stdout.write(f"\r    {pct}%")
            sys.stdout.flush()

    urllib.request.urlretrieve(url, dst, hook)
    print()


def _link_outputs(images_src, pairs_src):
    """Expose <images_src> as data/lfw and copy pairs file to data/pairs.txt."""
    lfw_dir = os.path.join(DATA_DIR, "lfw")
    pairs_dst = os.path.join(DATA_DIR, "pairs.txt")
    if not os.path.exists(lfw_dir):
        try:
            os.symlink(images_src, lfw_dir)
        except OSError:
            shutil.copytree(images_src, lfw_dir)
    if not os.path.exists(pairs_dst):
        shutil.copy(pairs_src, pairs_dst)
    print(f"Done.\n  images: {lfw_dir}\n  pairs:  {pairs_dst}")


def from_umass():
    tgz = os.path.join(DATA_DIR, "lfw.tgz")
    print(f"  downloading {LFW_TGZ}")
    _download(LFW_TGZ, tgz)
    _download(PAIRS, os.path.join(DATA_DIR, "pairs.txt"))
    lfw_dir = os.path.join(DATA_DIR, "lfw")
    if not os.path.isdir(lfw_dir):
        print("  extracting lfw.tgz ...")
        with tarfile.open(tgz) as t:
            t.extractall(DATA_DIR)
    print(f"Done.\n  images: {lfw_dir}\n  pairs:  {os.path.join(DATA_DIR, 'pairs.txt')}")


def from_sklearn():
    """figshare mirror via scikit-learn. Downloads original (non-funneled) images."""
    print("  falling back to scikit-learn LFW fetcher (figshare mirror) ...")
    from sklearn.datasets import get_data_home, fetch_lfw_pairs

    # We only want the download + extraction side-effect into <data_home>/lfw_home/;
    # the returned in-memory arrays are unused, so keep them tiny (resize small,
    # grayscale). The extracted on-disk images are the full-resolution originals.
    fetch_lfw_pairs(subset="10_folds", funneled=False, color=False,
                    resize=0.4, download_if_missing=True)

    lfw_home = os.path.join(get_data_home(), "lfw_home")
    images_src = os.path.join(lfw_home, "lfw")          # non-funneled images
    pairs_src = os.path.join(lfw_home, "pairs.txt")
    if not os.path.isdir(images_src):
        raise FileNotFoundError(f"expected images at {images_src}")
    if not os.path.exists(pairs_src):
        # some sklearn versions name it differently inside lfw_home
        alt = os.path.join(lfw_home, "pairs_10_folds.txt")
        pairs_src = alt if os.path.exists(alt) else pairs_src
    _link_outputs(images_src, pairs_src)


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    try:
        from_umass()
    except Exception as e:
        print(f"\n  UMass origin failed ({e.__class__.__name__}: {e}).")
        from_sklearn()


if __name__ == "__main__":
    main()

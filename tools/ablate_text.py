#!/usr/bin/env python3
"""Does the separation survive without text? -> static/data/text_ablation.json

    pip install torch torchvision open_clip_torch pillow numpy scikit-learn
    brew install tesseract
    python3 tools/ablate_text.py

Raised in review: the occlusion maps look like they lean on printed text, the section 1 quiz blurs
figures precisely because text is the human giveaway, and yet nothing is ever blurred or masked
before the embedding runs. So the post could measure text's influence RELATIVE to other patches
(section 6) but could not say what happens when the text is actually gone.

This runs that experiment. Every condition goes through the full pipeline from scratch -- embed,
standardize, PCA, Fisher discriminant, leave-one-out -- so the numbers are comparable to the
headline accuracy, and each gets a permutation test so "the separation collapsed" can be told
apart from "the separation is still there, just smaller".

    original        untouched, the baseline
    text_masked     OCR word boxes filled with CLIP's mean color
    random_masked   the SAME number and size of boxes per figure, placed at random -- the control

RANDOM_MASKED IS NOT OPTIONAL. Blanking any part of an image moves its embedding (the occlusion
maps in section 6 measure that drift at about -0.20 regardless of which patch is hidden). Without
a same-area control, any drop under text_masked would be read as a text effect when much of it is
just the cost of blanking pixels. The text effect is the gap between text_masked and random_masked,
not the gap between text_masked and original.

A caveat the numbers cannot remove: OCR finds text in 86% of real figures and 76% of generated
ones, and marks 15.4 vs 9.0 patches per figure, so text_masked damages the real population harder.
That asymmetry is reported in the output as masked_frac and has to be read alongside the accuracy.
"""
import csv
import json
import os
import re
import subprocess
import tempfile

import numpy as np
import open_clip
import torch
from PIL import Image
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL, PRETRAINED = "ViT-B-32", "laion2b_s34b_b79k"
SIDE, CONF = 224, 40
BOX_CACHE = f"{ROOT}/tools/figure_text_boxes.json"

# CLIP's training-set mean color: zero after normalization, i.e. the least informative fill.
MEAN_RGB = (123, 117, 104)


def figure_paths():
    out = []
    for sub, label in (("figures", 0), ("real-figures", 1)):   # 0 = generated, 1 = real
        d = os.path.join(ROOT, "static", "images", sub)
        for fn in sorted(os.listdir(d)):
            if fn.lower().endswith(".png"):
                out.append((os.path.join(d, fn), fn, label))
    return out


def ocr_boxes(path):
    with tempfile.TemporaryDirectory() as td:
        stem = os.path.join(td, "o")
        subprocess.run(["tesseract", path, stem, "tsv"], capture_output=True)
        rows = list(csv.DictReader(open(stem + ".tsv", encoding="utf-8", errors="ignore"),
                                   delimiter="\t", quoting=csv.QUOTE_NONE))
    boxes = []
    for r in rows:
        try:
            c = float(r.get("conf", -1))
        except ValueError:
            continue
        if c >= CONF and (r.get("text") or "").strip():
            boxes.append([int(r["left"]), int(r["top"]), int(r["width"]), int(r["height"])])
    return boxes


def load_boxes(paths):
    if os.path.exists(BOX_CACHE):
        return json.load(open(BOX_CACHE))
    cache = {}
    for i, (path, fn, _) in enumerate(paths):
        cache[f"{os.path.basename(os.path.dirname(path))}/{fn}"] = ocr_boxes(path)
        if i % 40 == 0:
            print(f"  ocr {i}/{len(paths)}", flush=True)
    json.dump(cache, open(BOX_CACHE, "w"))
    return cache


def crop224(path):
    """Exactly what preprocess does geometrically: short side to 224, then center crop."""
    img = Image.open(path).convert("RGB")
    w, h = img.size
    s = float(SIDE) / min(w, h)
    nw, nh = round(w * s), round(h * s)
    img = img.resize((nw, nh), Image.BICUBIC)
    left, top = (nw - SIDE) // 2, (nh - SIDE) // 2
    return img.crop((left, top, left + SIDE, top + SIDE)), s, left, top


def project_boxes(boxes, s, left, top):
    """Original-image word boxes -> coordinates inside the 224 crop."""
    out = []
    for (x, y, bw, bh) in boxes:
        x0, y0 = x * s - left, y * s - top
        x1, y1 = x0 + bw * s, y0 + bh * s
        x0, y0 = max(0, int(round(x0))), max(0, int(round(y0)))
        x1, y1 = min(SIDE, int(round(x1))), min(SIDE, int(round(y1)))
        if x1 > x0 and y1 > y0:
            out.append((x0, y0, x1, y1))
    return out


def fill(img, boxes):
    img = img.copy()
    px = img.load()
    for (x0, y0, x1, y1) in boxes:
        for yy in range(y0, y1):
            for xx in range(x0, x1):
                px[xx, yy] = MEAN_RGB
    return img


def random_boxes(boxes, rng):
    """Same count and same sizes, placed at random -- the control for 'blanking anything hurts'."""
    out = []
    for (x0, y0, x1, y1) in boxes:
        bw, bh = x1 - x0, y1 - y0
        nx = int(rng.integers(0, max(1, SIDE - bw)))
        ny = int(rng.integers(0, max(1, SIDE - bh)))
        out.append((nx, ny, min(SIDE, nx + bw), min(SIDE, ny + bh)))
    return out


def lda_loo_vec(X, y):
    """Per-figure leave-one-out correctness. Returned as a vector, not a mean, because the
    comparisons that matter here are PAIRED -- the same 269 figures under two treatments -- and a
    bootstrap interval on each accuracy separately is the wrong instrument for that. See mcnemar()."""
    n = len(X)
    Sxx, Sx = X.T @ X, X.sum(0)
    s1, n1 = X[y == 1].sum(0), int(y.sum())
    s0, n0 = X[y == 0].sum(0), n - n1
    if n0 < 2 or n1 < 2:
        return None
    I = np.eye(X.shape[1]) * 1e-6
    ok = np.zeros(n, bool)
    for i in range(n):
        xi = X[i]
        if y[i] == 1:
            m1, m0 = (s1 - xi) / (n1 - 1), s0 / n0
        else:
            m0, m1 = (s0 - xi) / (n0 - 1), s1 / n1
        m = (Sx - xi) / (n - 1)
        C = ((Sxx - np.outer(xi, xi)) - (n - 1) * np.outer(m, m)) / (n - 2)
        w = np.linalg.solve(C + I, m1 - m0)
        ok[i] = (w @ xi > (w @ m0 + w @ m1) / 2) == (y[i] == 1)
    return ok


def lda_loo(X, y):
    v = lda_loo_vec(X, y)
    return float("nan") if v is None else v.mean()


def mcnemar(a, b):
    """Exact two-sided McNemar on two per-figure correctness vectors over the same figures.
    Only the disagreements carry information: n01 = a wrong / b right, n10 = a right / b wrong."""
    n10 = int(np.sum(a & ~b))
    n01 = int(np.sum(~a & b))
    n = n10 + n01
    if n == 0:
        return dict(n10=0, n01=0, p=1.0)
    # exact binomial tail, no scipy dependency
    from math import comb
    k = min(n10, n01)
    tail = sum(comb(n, i) for i in range(0, k + 1)) / (2 ** n)
    return dict(n10=n10, n01=n01, p=round(min(1.0, 2 * tail), 6))


def evaluate(embeddings, y, rng, B=1000):
    """Full refit per condition, so every number is comparable to the headline accuracy."""
    coords = PCA(n_components=3).fit_transform(StandardScaler().fit_transform(embeddings))
    vec = lda_loo_vec(coords[:, :2], y)
    acc = float(vec.mean())
    null = np.array([lda_loo(coords[:, :2], rng.permutation(y)) for _ in range(B)])
    return dict(
        acc=round(acc, 4),
        null_mean=round(float(null.mean()), 4),
        p=round(float((1 + int((null >= acc).sum())) / (B + 1)), 5),
    ), vec


def main():
    paths = figure_paths()
    y = np.array([lab for _, _, lab in paths])
    print(f"{len(paths)} figures")
    boxes_by_file = load_boxes(paths)

    model, _, preprocess = open_clip.create_model_and_transforms(MODEL, pretrained=PRETRAINED)
    model.eval()
    to_tensor = preprocess.transforms[-2]      # MaybeToTensor
    normalize = preprocess.transforms[-1]      # Normalize

    rng = np.random.default_rng(0)
    variants = {k: [] for k in ["original", "text_masked", "random_masked"]}
    masked_area = {0: [], 1: []}

    for (path, fn, label) in paths:
        img, s, left, top = crop224(path)
        key = f"{os.path.basename(os.path.dirname(path))}/{fn}"
        bx = project_boxes(boxes_by_file.get(key, []), s, left, top)
        masked_area[label].append(sum((x1 - x0) * (y1 - y0) for x0, y0, x1, y1 in bx) / (SIDE * SIDE))

        variants["original"].append(normalize(to_tensor(img)))
        variants["text_masked"].append(normalize(to_tensor(fill(img, bx))))
        variants["random_masked"].append(normalize(to_tensor(fill(img, random_boxes(bx, rng)))))

    results, vectors = {}, {}
    for name, tens in variants.items():
        T = torch.stack(tens)
        embs = []
        with torch.no_grad():
            for i in range(0, len(T), 32):
                e = model.encode_image(T[i:i + 32])
                embs.append((e / e.norm(dim=-1, keepdim=True)).numpy().astype(np.float64))
        E = np.concatenate(embs)
        results[name], vectors[name] = evaluate(E, y, np.random.default_rng(1))
        print(f"  {name:<16} acc {results[name]['acc']:.4f}  "
              f"null {results[name]['null_mean']:.3f}  p {results[name]['p']}", flush=True)

    # The comparison the whole experiment rests on: text_masked against the same-area random
    # control, paired over the identical 269 figures.
    pairs = {
        "text_vs_random": mcnemar(vectors["random_masked"], vectors["text_masked"]),
        "text_vs_original": mcnemar(vectors["original"], vectors["text_masked"]),
        "random_vs_original": mcnemar(vectors["original"], vectors["random_masked"]),
    }
    for k, v in pairs.items():
        print(f"  mcnemar {k:<26} n10={v['n10']:<4} n01={v['n01']:<4} p={v['p']}")

    out = dict(
        n=len(paths), mcnemar=pairs,
        masked_frac=dict(gen=round(float(np.mean(masked_area[0])), 4),
                         real=round(float(np.mean(masked_area[1])), 4)),
        conditions=results,
    )
    dest = f"{ROOT}/static/data/text_ablation.json"
    json.dump(out, open(dest, "w"), separators=(",", ":"))
    print(json.dumps(out, indent=2))
    print("wrote", dest)


if __name__ == "__main__":
    main()

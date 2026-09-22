#!/usr/bin/env python3
"""Build static/data/occlusion.json — signed 7x7 patch-occlusion maps for section 6.

    pip install torch torchvision open_clip_torch pillow numpy scikit-learn
    python3 tools/occlusion.py

Self-contained: it reads the 269 figures shipped in static/images/ and needs nothing from
the source archive. It re-embeds them with the same encoder the post is built on, refits the
standardizer, the 3-component PCA and the two-dimensional Fisher discriminant, aligns the
component signs against static/maps/both_figures.json so PC1/PC2 keep the meaning sections 4
and 5 give them, and then, for each figure, hides one of ViT-B-32's 49 input patches at a time
and records how far the discriminant score moved.

A patch is hidden by setting it to zero in *normalized* tensor space, which is the mean color
of CLIP's training distribution — the least informative tile available, rather than a black
square the encoder has never seen.

Sign convention, which the page inverts when it paints: a POSITIVE delta means hiding the tile
pushed the score toward "real", so the tile itself was evidence for "generated".

Refitting this way reproduces the shipped coordinates at r > 0.999 on all three components;
the script prints the correlations so a regression is visible rather than silent.
"""
import json
import os

import numpy as np
import open_clip
import torch
from PIL import Image
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL, PRETRAINED = "ViT-B-32", "laion2b_s34b_b79k"
GRID = 7          # 224 / 32
PATCH = 32
BATCH = 49        # one figure's worth of occlusions per forward pass


def load_figures(preprocess):
    """Generated figures then real ones, each directory in sorted order — the same order
    make_graph() used, so ids line up with static/maps/both_figures.json."""
    tensors, names, labels = [], [], []
    for sub, label in (("figures", 0), ("real-figures", 1)):   # 0 = generated, 1 = real
        d = os.path.join(ROOT, "static", "images", sub)
        for fn in sorted(os.listdir(d)):
            if not fn.lower().endswith(".png"):
                continue
            img = Image.open(os.path.join(d, fn)).convert("RGB")
            tensors.append(preprocess(img))
            names.append(fn)
            labels.append(label)
    return torch.stack(tensors), names, np.array(labels)


def encode(model, tensors, batch=32):
    out = []
    with torch.no_grad():
        for i in range(0, len(tensors), batch):
            e = model.encode_image(tensors[i:i + batch])
            out.append((e / e.norm(dim=-1, keepdim=True)).numpy().astype(np.float64))
    return np.concatenate(out)


def lda_fit(X, y):
    """Fisher's rule: w = S^-1 (mu_real - mu_gen), threshold at the midpoint of the
    projected class means. Identical to the fit in tools/build_data.py."""
    m0, m1 = X[y == 0].mean(0), X[y == 1].mean(0)
    S = np.cov(X.T) + np.eye(X.shape[1]) * 1e-6
    w = np.linalg.solve(S, m1 - m0)
    return w, (w @ m0 + w @ m1) / 2


def main():
    model, _, preprocess = open_clip.create_model_and_transforms(MODEL, pretrained=PRETRAINED)
    model.eval()

    tensors, names, y = load_figures(preprocess)
    print(f"{len(names)} figures, input {tuple(tensors.shape)}")
    embeddings = encode(model, tensors)

    scaler = StandardScaler().fit(embeddings)
    pca = PCA(n_components=3).fit(scaler.transform(embeddings))
    coords = pca.transform(scaler.transform(embeddings))

    published = json.load(open(f"{ROOT}/static/maps/both_figures.json"))["nodes"]
    assert names == [n["name"] for n in published], "figure order drifted from the shipped map"
    P = np.array([[n["x"], n["y"], n["z"]] for n in published])
    corr = np.array([np.corrcoef(coords[:, k], P[:, k])[0, 1] for k in range(3)])
    print("agreement with the shipped map:", corr.round(5))
    coords *= np.sign(corr)

    w, t = lda_fit(coords[:, :2], y)
    base = coords[:, :2] @ w - t
    print("full-fit accuracy:", round(float(((base > 0).astype(int) == y).mean()), 4))

    def project(emb):
        c = pca.transform(scaler.transform(emb)) * np.sign(corr)
        return c[:, :2] @ w - t

    rows = []
    with torch.no_grad():
        for i in range(len(tensors)):
            variants = tensors[i].unsqueeze(0).repeat(GRID * GRID, 1, 1, 1)
            for p in range(GRID * GRID):
                r, c = divmod(p, GRID)
                variants[p, :, r * PATCH:(r + 1) * PATCH, c * PATCH:(c + 1) * PATCH] = 0.0
            scores = project(encode(model, variants, BATCH))
            rows.append(dict(
                n=names[i],
                c=int(1 - y[i]),                       # c=1 generated, as in arxaiv.json
                s=round(float(base[i]), 4),
                d=[round(float(v - base[i]), 4) for v in scores],
            ))
            if i % 25 == 0:
                print(f"  {i}/{len(tensors)} {names[i]}", flush=True)

    out = f"{ROOT}/static/data/occlusion.json"
    json.dump(dict(grid=GRID, w=[float(w[0]), float(w[1])], t=float(t), rows=rows),
              open(out, "w"), separators=(",", ":"))
    print("wrote", out, len(rows), "maps")


if __name__ == "__main__":
    main()

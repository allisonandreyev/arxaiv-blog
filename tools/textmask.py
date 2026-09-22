#!/usr/bin/env python3
"""Does CLIP's decision lean on the text in a figure? Adds `summary` to static/data/occlusion.json.

    brew install tesseract      # or apt-get install tesseract-ocr
    python3 tools/textmask.py   # after tools/occlusion.py

Raised in review: the occlusion maps appear to light up on printed text, even though the
embedding is `encode_image` only and much of the text in the generated half is not readable as
language. This script tests that instead of eyeballing it.

OCR runs at native resolution, where text is still legible, and the resulting word boxes are
pushed through the exact preprocess geometry — Resize(short side -> 224), CenterCrop(224) — so a
word lands on the patch the transformer actually saw. A patch is "text-bearing" if any word box
above the confidence floor overlaps it. The comparison is paired within each figure, so a figure
whose decision is diffuse cannot drown out one whose decision is sharp.

It also records the thing that makes the whole question hard: how much text OCR finds at all in
each population. The most degraded figures produce no boxes, so they enter the test as if they
had no text, which biases the measured effect DOWNWARD in the generated half.
"""
import csv
import json
import os
import subprocess
import tempfile

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONF = 40          # tesseract per-word confidence floor
GRID, PATCH, SIDE = 7, 32, 224


def word_boxes(path):
    with tempfile.TemporaryDirectory() as td:
        out = os.path.join(td, "o")
        subprocess.run(["tesseract", path, out, "tsv"], capture_output=True)
        rows = list(csv.DictReader(open(out + ".tsv"), delimiter="\t", quoting=csv.QUOTE_NONE))
    boxes = []
    for r in rows:
        try:
            conf = float(r.get("conf", -1))
        except ValueError:
            continue
        if conf < CONF or not (r.get("text") or "").strip():
            continue
        boxes.append((int(r["left"]), int(r["top"]), int(r["width"]), int(r["height"])))
    return boxes


def patch_mask(path):
    """1 where a detected word overlaps that patch of the 224x224 center crop."""
    w, h = Image.open(path).size
    s = float(SIDE) / min(w, h)                       # Resize(224) works on the SHORT side
    offx, offy = (round(w * s) - SIDE) / 2.0, (round(h * s) - SIDE) / 2.0   # CenterCrop
    mask = np.zeros(GRID * GRID, int)
    for (x, y, bw, bh) in word_boxes(path):
        x0, y0 = x * s - offx, y * s - offy
        x1, y1 = x0 + bw * s, y0 + bh * s
        if x1 <= 0 or y1 <= 0 or x0 >= SIDE or y0 >= SIDE:
            continue                                   # cropped away entirely
        for c in range(max(0, int(x0 // PATCH)), min(GRID - 1, int((x1 - 1e-6) // PATCH)) + 1):
            for r in range(max(0, int(y0 // PATCH)), min(GRID - 1, int((y1 - 1e-6) // PATCH)) + 1):
                mask[r * GRID + c] = 1
    return mask


def boot_ci(v, n=4000, seed=0):
    rs = np.random.default_rng(seed)
    means = [v[rs.integers(0, len(v), len(v))].mean() for _ in range(n)]
    return float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


def main():
    occ_path = f"{ROOT}/static/data/occlusion.json"
    occ = json.load(open(occ_path))
    rows = occ["rows"]

    masks = np.array([patch_mask(f"{ROOT}/static/images/"
                                 f"{'figures' if r['c'] == 1 else 'real-figures'}/{r['n']}")
                      for r in rows])
    D = np.array([r["d"] for r in rows])
    cls = np.array([r["c"] for r in rows])

    # Hiding ANY patch drags the score toward "generated", so the raw deltas carry a per-figure
    # offset that has nothing to do with which patch was hidden. Center it out before comparing.
    rel = D - D.mean(1, keepdims=True)
    mag = np.abs(rel)

    summary = {
        "bias_mean": round(float(D.mean()), 4),
        "bias_frac_neg": round(float((D < 0).mean()), 4),
        # how concentrated is the evidence? (median per-figure share held by the top 5 of 49)
        "top5_share": round(float(np.median(np.sort(mag, 1)[:, ::-1][:, :5].sum(1) / mag.sum(1))), 4),
        # could hiding one patch have changed the verdict?
        "flip_frac": round(float((np.abs(rel).max(1) > np.abs([r["s"] for r in rows])).mean()), 4),
        "text": {}, "ocr": {},
    }
    # left-right asymmetry of influence
    g = mag.reshape(len(rows), GRID, GRID)
    lr = g[:, :, :3].mean(axis=(1, 2)) - g[:, :, 4:].mean(axis=(1, 2))
    summary["lr_diff"] = round(float(lr.mean()), 4)
    summary["lr_frac"] = round(float((lr > 0).mean()), 4)

    for label, name in ((1, "gen"), (0, "real")):
        sel = cls == label
        summary["ocr"][name] = dict(
            detected_frac=round(float((masks[sel].sum(1) > 0).mean()), 4),
            mean_patches=round(float(masks[sel].sum(1).mean()), 2),
        )
        # paired: figures that have both kinds of patch
        usable = sel & (masks.sum(1) > 0) & (masks.sum(1) < GRID * GRID)
        idx = np.where(usable)[0]
        t = np.array([mag[i][masks[i] == 1].mean() for i in idx])
        n = np.array([mag[i][masks[i] == 0].mean() for i in idx])
        lo, hi = boot_ci(t - n)
        summary["text"][name] = dict(
            n=int(len(idx)),
            text=round(float(t.mean()), 4), nontext=round(float(n.mean()), 4),
            diff=round(float((t - n).mean()), 4), ci=[round(lo, 4), round(hi, 4)],
            frac_figs=round(float((t > n).mean()), 4),
            ratio=round(float(np.median(t / n)), 3),
        )

    occ["summary"] = summary
    json.dump(occ, open(occ_path, "w"), separators=(",", ":"))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()

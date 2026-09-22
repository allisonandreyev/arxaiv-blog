#!/usr/bin/env python3
"""Raw OCR over the 100 generated page images -> static/data/page_ocr.json.

    brew install tesseract      # or apt-get install tesseract-ocr
    python3 tools/page_ocr.py

Raised in review: there is no shipped code for the page OCR behind section 8, and the text the
archive displays went through an LLM pass that resolved garbled runs to their nearest sensible
reading. That pass only ever makes the text look better than the pixels are, and with nothing to
compare against, a reader has no way to see how much was smoothed over.

This script closes half of that. It re-OCRs the 100 page images shipped in static/images/papers/
-- so it needs nothing from the source archive -- and ships the RAW result beside the corrected
text already in the bundle. It cannot recover the original LLM pass, and does not try to. What it
gives you is the input that pass was working from, for all 100 pages instead of the one title
section 8 currently uses as an anecdote.

The size of the gap is measured as a dictionary-word rate: the share of alphabetic tokens that
appear in a system word list. Absolute values mean little -- the list has no scientific vocabulary
and no proper nouns, so it under-counts both texts -- but raw and corrected face the identical
dictionary on the identical pages, so the DIFFERENCE between them is meaningful and is the only
number this script reports as a finding.
"""
import csv
import json
import os
import re
import subprocess
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = os.path.join(ROOT, "static", "images", "papers")
WORDLIST = "/usr/share/dict/words"
MAX_CHARS = 6000          # per page, so the shipped file stays a reasonable size
CONF = 0                  # keep every row; the confidence distribution is itself the evidence


def words():
    if not os.path.exists(WORDLIST):
        raise SystemExit(f"no word list at {WORDLIST}; install one or edit WORDLIST")
    with open(WORDLIST, encoding="utf-8", errors="ignore") as f:
        return {w.strip().lower() for w in f if w.strip()}


DICT = words()


def dict_rate(text):
    """Share of alphabetic tokens that are dictionary words. Returns (rate, n_tokens)."""
    toks = [t.lower() for t in re.findall(r"[A-Za-z]+", text or "")]
    if not toks:
        return None, 0
    return round(sum(t in DICT for t in toks) / len(toks), 4), len(toks)


def ocr(path):
    """Plain text plus the per-word confidence table, from one tesseract run each."""
    with tempfile.TemporaryDirectory() as td:
        out = os.path.join(td, "o")
        subprocess.run(["tesseract", path, out], capture_output=True)
        text = open(out + ".txt", encoding="utf-8", errors="ignore").read()
        subprocess.run(["tesseract", path, out, "tsv"], capture_output=True)
        rows = list(csv.DictReader(open(out + ".tsv", encoding="utf-8", errors="ignore"),
                                   delimiter="\t", quoting=csv.QUOTE_NONE))
    confs = []
    for r in rows:
        try:
            c = float(r.get("conf", -1))
        except ValueError:
            continue
        if c >= CONF and (r.get("text") or "").strip():
            confs.append(c)
    return text, confs


def main():
    bundle = json.load(open(f"{ROOT}/static/data/arxaiv.json"))
    corrected = {p["f"]: p for p in bundle["papers"]}

    pages, raw_rates, corr_rates = {}, [], []
    files = sorted(os.listdir(PAGES), key=lambda f: int(re.sub(r"\D", "", f) or 0))
    for i, fn in enumerate(files):
        if not fn.lower().endswith((".jpg", ".jpeg", ".png")):
            continue
        text, confs = ocr(os.path.join(PAGES, fn))
        key = re.sub(r"\.(jpg|jpeg)$", ".png", fn, flags=re.I)   # the bundle keys on .png
        rate, ntok = dict_rate(text)
        row = dict(
            raw=" ".join(text.split())[:MAX_CHARS],
            tokens=ntok, rate=rate,
            conf=round(sum(confs) / len(confs), 1) if confs else None,
            n_conf=len(confs),
        )
        # the same measure over the LLM-corrected excerpt the archive displays
        c = corrected.get(key)
        if c:
            crate, cntok = dict_rate((c.get("abstract", "") + " " + c.get("refs", "")).strip())
            row["corr_rate"], row["corr_tokens"] = crate, cntok
            if rate is not None and crate is not None:
                raw_rates.append(rate); corr_rates.append(crate)
        pages[key] = row
        if i % 20 == 0:
            print(f"  {i}/{len(files)} {fn}", flush=True)

    # Robustness check: the raw text covers the whole page, including the author and affiliation
    # block, which is full of proper nouns no dictionary contains -- so some of the raw/corrected
    # gap could be that rather than correction. Re-score the raw text from "Abstract" onwards to
    # find out. (It does not explain the gap; dropping the block widens it slightly.)
    body_rates = []
    for row in pages.values():
        m = re.search(r"\bAbstract\b", row["raw"])
        if not m:
            continue
        r, _ = dict_rate(row["raw"][m.end():])
        if r is not None:
            body_rates.append(r)

    n = len(raw_rates)
    mean = lambda v: round(sum(v) / len(v), 4) if v else None
    out = dict(
        n_pages=len(pages),
        wordlist=os.path.basename(WORDLIST), wordlist_size=len(DICT),
        max_chars=MAX_CHARS,
        summary=dict(
            n=n,
            raw_rate=mean(raw_rates),
            corr_rate=mean(corr_rates),
            gap=round(mean(corr_rates) - mean(raw_rates), 4) if n else None,
            corr_higher=round(sum(c > r for r, c in zip(raw_rates, corr_rates)) / n, 4) if n else None,
            body_rate=mean(body_rates), n_body=len(body_rates),
            body_gap=round(mean(corr_rates) - mean(body_rates), 4) if body_rates else None,
            mean_conf=mean([p["conf"] for p in pages.values() if p["conf"] is not None]),
            mean_tokens=mean([p["tokens"] for p in pages.values()]),
        ),
        pages=pages,
    )
    dest = f"{ROOT}/static/data/page_ocr.json"
    json.dump(out, open(dest, "w"), separators=(",", ":"))
    print(json.dumps(out["summary"], indent=2))
    print("wrote", dest, os.path.getsize(dest) // 1024, "KB")


if __name__ == "__main__":
    main()

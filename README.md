# arxAIv — 100 Papers That Were Never Written

An explorable explanation submitted to **VISxAI 2026** (9th Workshop on Visualization for AI
Explainability, IEEE VIS, Boston).

100 computer-vision paper pages were *drawn*, not written, by text-to-image and multimodal models
from a single prompt. The site uses them to work out what a CLIP embedding actually encodes about
a synthetic scientific figure, and to show that the signal isn't reducible to how the images look.

**Live page:** [`index.html`](index.html) · the earlier project-page version is kept at
[`project-page.html`](project-page.html).

## What's here

| Path | What it is |
| --- | --- |
| `index.html` | The blog post. Eleven sections, six interactives, no framework. |
| `static/css/blog.css` | All page styling. Light-first with a dark-mode palette. |
| `static/js/arxaiv.js` | Every interactive: the real-vs-generated test, the CLIP map, the discriminant strip, the metric explorer, the bar charts, the 100-paper archive. Vanilla JS on a plain canvas — no CDN, no chart library. |
| `static/data/arxaiv.json` | The single data bundle the page reads (~320 KB). |
| `tools/build_data.py` | Rebuilds that bundle from the source spreadsheets and embedding maps. |
| `static/maps/` | The three.js force-graph embeds (`papers-glow.html`, `both_figures.html`) and their node/link JSON. |
| `static/images/` | Full-resolution figures and paper pages, plus 420 px thumbnails under `thumbs/`. |

## Key numbers on the page

All computed in `tools/build_data.py`, all reproducible from the shipped data:

- **84.9%** of the 2,147 nearest-neighbour links in CLIP space stay within their own population
  (generated 87.1%, real 81.7%).
- **87.0%** leave-one-out accuracy separating real from generated using linear discriminant
  analysis on just two PCA components, against a **58.0%** majority-class baseline.
- **63.9%** using seven low-level pixel statistics instead — the ablation that shows CLIP is not
  keying on surface appearance. Combining both reaches **94.8%**.
- **31.5%** of the 340 invented authors are attributed to institutions that do not exist;
  another **22.6%** to real institutions under a wrong name.

## Rebuilding the data bundle

`tools/build_data.py` reads the CVPR Art Gallery source archive (`Data/figure_metrics.csv`,
`paper_ocr_texts.xlsx`, `Github Release Dset.xlsx`) plus `static/maps/*.json`, recomputes the
classifiers and the pixel-statistic ablation, and writes `static/data/arxaiv.json`. Adjust the
`ZIP` path at the top, then:

```sh
pip install numpy openpyxl pillow
python3 tools/build_data.py
```

Note the script works around a defect in the source data: the OCR columns of
`Github Release Dset.xlsx` are shuffled relative to their filenames, so all text fields are taken
from `paper_ocr_texts.xlsx` instead.

## Running locally

The page fetches its data bundle, so it needs to be served over HTTP rather than opened from disk:

```sh
python3 -m http.server 8000
```

## Method

Figure embeddings: `OpenCLIP ViT-B-32` / `laion2b_s34b_b79k`, L2-normalised, standardised,
PCA-reduced, joined into a *k*=8 cosine nearest-neighbour graph. Title embeddings:
`all-MiniLM-L6-v2`. Affiliation and reference audits are manual.

## License

<a rel="license" href="http://creativecommons.org/licenses/by-sa/4.0/"><img alt="Creative Commons License" style="border-width:0" src="https://i.creativecommons.org/l/by-sa/4.0/88x31.png" /></a><br />This work is licensed under a <a rel="license" href="http://creativecommons.org/licenses/by-sa/4.0/">Creative Commons Attribution-ShareAlike 4.0 International License</a>.

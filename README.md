# arxAIv — 100 Papers That Were Never Written

100 computer-vision paper pages were *drawn*, not written, by text-to-image and multimodal models
from a single prompt. The site uses them as a worked example of a method: embed two populations with
a model that was never told what you are looking for, reduce, fit the simplest classifier that could
work, and then try to destroy your own result. Every number is scoped to these 269 images. Section 11
of the post lists the confounds that have been measured and the ones — including one large one — that
have not.

**Live page:** [`index.html`](index.html) · the earlier project-page version is kept at
[`project-page.html`](project-page.html).

## What's here

| Path | What it is |
| --- | --- |
| `index.html` | The blog post. Eleven sections, seven interactives, no framework. |
| `static/css/blog.css` | All page styling. Light-first with a dark-mode palette. |
| `static/js/arxaiv.js` | Every interactive: the real-vs-generated test, the CLIP map, the discriminant strip, the occlusion maps, the metric explorer, the bar charts, the 100-paper archive. Vanilla JS on a plain canvas — no CDN, no chart library. |
| `static/data/arxaiv.json` | The single data bundle the page reads (~320 KB). |
| `static/data/occlusion.json` | Signed 7×7 patch-occlusion maps for all 269 figures, read by section 6. |
| `tools/build_data.py` | Rebuilds that bundle from the source spreadsheets and embedding maps. |
| `tools/occlusion.py` | Rebuilds the occlusion maps. Self-contained: needs only `static/images/` and `static/maps/both_figures.json`, not the source archive. |
| `static/data/page_ocr.json` | Raw OCR of the 100 page images, shipped beside the LLM-corrected text so the two can be compared. Read by section 8. |
| `tools/correct_ocr.py` | The OCR correction pass as runnable code. `--dry-run` prints the exact prompt without calling anything. Writes `page_corrected.json`; never overwrites the original pass's output. |
| `tools/page_ocr.py` | Rebuilds it. Re-OCRs `static/images/papers/` and scores raw against corrected by dictionary-word rate. Needs only the repo. |
| `static/data/text_ablation.json` | What the discriminant scores with the text masked out, plus a same-area random control. Read by section 6. |
| `tools/ablate_text.py` | Rebuilds it. Masks OCR word boxes, refits the whole pipeline per condition, and runs paired McNemar tests. |
| `tools/textmask.py` | Tests whether the occlusion maps lean on printed text. OCRs each figure at native resolution, projects the word boxes into the 7×7 patch grid, and writes the paired comparison into `occlusion.json` as `summary`. |
| `tools/figure_gibberish_raw.csv` | Raw-OCR gibberish ratio and token count per generated figure. Ships with the repo, so this metric does not depend on the unshipped source archive. |
| `tools/colab_embeddings_and_graph_data_generation.py` | The Colab that produced the CLIP embeddings, the 269-figure map and the similarity table. Its header states exactly which published numbers it does and does not reproduce. |
| `static/maps/` | The three.js force-graph embeds (`papers-glow.html`, `both_figures.html`) and their node/link JSON. |
| `static/images/` | Full-resolution figures and paper pages, plus 420 px thumbnails under `thumbs/`. |

## Key numbers on the page

All computed in `tools/build_data.py`, all reproducible from the shipped data:

- **84.9%** of the 2,147 nearest-neighbor links in CLIP space stay within their own population
  (generated 87.1%, real 81.7%).
- **87.0%** leave-one-out accuracy separating real from generated using linear discriminant
  analysis on just two PCA components, against a **58.0%** majority-class baseline.
- **63.9%** using seven low-level pixel statistics instead — the ablation showing that those seven
  statistics do not account for the separation. Combining both reaches **94.8%**.
- **11.6%** of the corpus's variance is held by the two PCA components every scatter plot uses
  (6.1% + 5.5%; PC₃ brings it to 15.7%). Variance kept is not the same as class signal kept, and the
  post says so where the map is introduced.
- **94.8%** from a single threshold on raw image width — the unresolved confound. See below.
- **26%** of a figure's occlusion movement sits in its top 5 patches of 49 (median), and **87%**
  of figures cannot have their verdict flipped by hiding any one patch. The decision is diffuse.
- **+0.018** (95% CI +0.009 to +0.026) more centered influence on text-bearing patches than on the
  rest, in the generated half; **+0.019** (+0.008 to +0.032) in the real half. Text contributes,
  at roughly 10–17% more weight per patch — not several times more.
- **31.5%** of the 340 invented authors are attributed to institutions that do not exist;
  another **22.6%** to real institutions under a wrong name.
- **p < 0.0005** for the 87.0%: over 2,000 label shuffles the same leave-one-out procedure averages
  50.1% ± 5.4 and never exceeds 61.7%, so the observed value sits 6.8 SD clear of the null.
  Bootstrap 95% CI on the accuracy itself: **82.2% – 90.3%**.
- **49% vs 76%** dictionary-word rate: raw OCR of the 100 page images against the LLM-corrected
  excerpts the archive displays. A 27-point gap, with the corrected version higher on *every* page.
  Rescoring the raw text from "Abstract" onwards, to drop the proper-noun-heavy author block,
  widens the gap rather than closing it (28 points).
- **78.8%** leave-one-out accuracy with every detectable word masked out (null 50.2%), against
  **85.9%** for a same-area random-masking control and **87.0%** untouched. Removing the text costs
  7.1 points (McNemar p = 0.014); masking random boxes costs nothing measurable (p = 0.51). So
  roughly a quarter of the above-baseline signal is text and three quarters is not.
- **166** distinct surnames across 340 authors (entropy 6.63 bits of a possible 8.41, top ten
  surnames = 34.9% of authorships). Measured, but *not* compared — see below.

### The five "clusters" in section 10 are hand labels

Found while adding method teaching to the back half, and it is a correction rather than a caveat.
The `cluster` field is a near-copy of the hand-assigned `Subtopic` spreadsheet column, recorded
before any embedding was run — not something the title embedding discovered. The section used to
read as though the graph had found them.

Measured against the title-embedding graph the section actually displays:

| | modularity | agreement with hand labels |
| --- | --- | --- |
| hand-assigned subtopic labels | **0.19** | — |
| spectral clustering, k=5, same 600 edges | **0.59** | ARI **0.05** |

So the graph holds strong community structure and it is *not* the topic structure. The tally
survives (25 segmentation papers vs 12 generation papers is a hand count that never needed an
embedding); the claim that the embedding recovers the shape of the field does not. Computed in
`build_data.py` as `clusters_check`.

The cluster sizes were also hardcoded in `build_data.py` and off by one in two of five groups;
they are now counted from `papers.json`.

### The text-removal experiment

Section 6 measures text's influence *within* an image (occlusion), which cannot answer what the
classifier does when the text is gone. `tools/ablate_text.py` runs that: blank every OCR-detected
word box with the encoder's mean gray, re-embed all 269 figures, refit standardizer, PCA and
discriminant from scratch, score leave-one-out.

**The random-masked control is not optional.** Blanking anything moves an embedding — the occlusion
maps measure that drift at about −0.20 regardless of which patch is hidden — so the control masks
the same number of boxes at the same sizes in random positions. The text effect is the gap between
`text_masked` and `random_masked`, not between `text_masked` and `original`. Comparisons are paired
McNemar over the identical figures, because bootstrap intervals on each accuracy separately are the
wrong instrument for a same-corpus comparison.

A Gaussian-blur condition matching section 1's quiz was tried and is not shipped: it produced no
monotone dose-response, so blur perturbs the whole image rather than removing a text signal.

Masking is slightly uneven — it blanks 4.6% of a generated figure against 5.1% of a real one — but
that runs against the result rather than toward it.

### Claims that are measured but not compared

Section 9's surname concentration and section 10's subtopic proportions are now quantified, but
there is no real conference roster or proceedings tally scored the same way in this repository.
Concentration statistics are strongly sample-size dependent, so a baseline would have to be
subsampled to 340 authors before it meant anything. "Narrower than a real conference roster" and
"roughly the right proportions" have been cut from the post as assertions and replaced with the
numbers plus an explicit note that the comparison is missing.

### Naive occlusion measures itself

Worth knowing before trusting any saliency map. **81%** of the 13,181 raw occlusion deltas point the
same direction regardless of which patch was hidden, averaging **−0.20** — hiding anything at all
makes a figure read as more "generated", because removing information moves the embedding in a
consistent direction. Painted raw, every map is a solid wash and the probe is mostly reporting its
own artifact.

`arxaiv.js` centers each figure on its own mean delta before coloring, which changes the question
from "did hiding this patch move the score" (it always does) to "did hiding *this* patch move it
more than hiding an average patch of this figure". After centering the signs split evenly.

This is not cosmetic. Measured on **raw** deltas, influence looks strongly left-biased
(+0.069, present in 78% of figures); measured on **centered** deltas the asymmetry reverses and
collapses (−0.017, 33%). The uncorrected version would have supported a confident and completely
spurious claim about where CLIP looks.

### The resolution confound

Raised in review, and the largest open problem with the post. The median generated figure is **483 px**
wide; the median real figure is **994 px**. One threshold on image width — call anything wider than
**828 px** real — classifies **94.8%** of the corpus correctly, missing 14 of 269: the same accuracy and
the same error budget as the best classifier the post builds.

CLIP itself never sees width, because `preprocess` resizes every figure to 224×224 before the transformer
runs. But that resize is where the confound lives rather than where it dies — a 2,288 px figure downsampled
tenfold and a 342 px figure stretched up do not arrive with the same stroke weights, aliasing or effective
text size, and none of the seven pixel statistics measure any of that. **The test that would settle it is
resampling both populations to identical dimensions, re-embedding and refitting**, and it is not done here.
The dimensions are recomputed from PNG headers in `build_data.py` and land in the bundle under `provenance`.

Measured on the **short side**, which is what `Resize` actually operates on: generated figures run
118 / 269 / 822 (min / median / max) against 246 / 624 / 1260 for real, so real figures are
downsampled about **2.8×** into the 224 square and generated ones only **1.2×**. The real half
arrives smoother; the generated half keeps more high-frequency detail. Two designs would settle it,
and both are listed as future work in section 11 — restriction to the **246–822** overlap band
(92 generated, 89 real), and forcing every figure through one common low resolution. Each needs a
control against the loss of sample size or sharpness, for the same reason the random-masking
control exists.

### What is and isn't reproducible

`tools/colab_embeddings_and_graph_data_generation.py` produces the embeddings, `static/maps/both_figures.json`
(section 4's map, the PCs section 5 classifies on, the *k*=8 links behind the homophily number) and the
cosine-similarity table in section 3. `tools/build_data.py` recomputes everything above from those.

Three of the four per-figure diagnostics in section 7 — caption agreement, structural complexity,
repetition — do **not** have shipped code. They arrive as precomputed columns of `Data/figure_metrics.csv`
and `build_data.py` only copies them through. Recovering those scripts is outstanding work.

**The page OCR is now reproducible end to end, but not identical to the original run.** The
`abstract`, `refs` and `closest` fields still arrive precomputed, out of `paper_ocr_texts.xlsx` in
the unshipped source archive, and *that* run cannot be recovered. What the repo now has is both
halves of the method: `tools/page_ocr.py` re-OCRs the 100 page images (the input the corrector was
working from), and `tools/correct_ocr.py` is the correction pass itself — model, prompt and output
schema all in the file, `--dry-run` to read the prompt without spending anything.

The replacement pass differs from the original deliberately. It is instructed to be conservative:
where a run is too damaged to recover it must emit `[unrecoverable]` rather than invent a fluent
sentence, and it reports per-page `confidence` and the raw fragments it gave up on. It writes to
`page_corrected.json` and never touches the fields section 8 displays and measures against —
overwriting those would erase the gap that section is about. **Running it and diffing the two
passes is the interesting experiment**: disagreement between two corrections of the same pixels
bounds how much either one is inventing better than either does alone.

The **gibberish ratio is now shipped and reproducible**: `tools/figure_gibberish_raw.csv` holds a direct
raw-OCR pass over the 156 generated figures, with the token count each ratio was computed over.

The **map itself is now checkable without the source archive**. `tools/occlusion.py` re-embeds the 269
figures in `static/images/`, refits the standardizer, the PCA and the discriminant from scratch, and
asserts the figure order against `static/maps/both_figures.json`; it prints the per-component correlation
against the shipped coordinates, which is **r > 0.999** on all three. A regression in the embedding
pipeline would show up there rather than silently.

### The gibberish ratio was previously measuring the wrong thing

The `gibberish_ratio` column of `figure_metrics.csv` was not a per-figure measurement. 38% of its values
require a denominator larger than the largest figure-OCR token count (41), and its median implied
denominator is 24 against a median of 7 tokens actually recoverable from a figure. Against the direct
per-figure pass it correlates at **r = −0.05** — no better than a random permutation, and no reordering
of filenames reconciles them, so it is not the string-sort shuffle that affected the spreadsheet columns.
It was almost certainly computed over page-level text while section 7 labeled it per-figure.

Replacing it changes the published numbers substantially, and weakens the metric:

| | old (page-level) | new (raw figure OCR) |
| --- | --- | --- |
| mean | 0.119 | 0.098 |
| median | 0.123 | **0.000** |
| max | 0.451 | 1.000 (on 2 tokens) |
| figures scoring exactly 0 | — | 85 of 150 |
| figures where OCR found nothing | — | **6, ratio undefined** |

The denominator is the real finding. Median 7 tokens per figure, 38 figures at three or fewer, and six
that yield no tokens at all — so the most degraded figures produce *no* measurement rather than a high
one. `ocr_token_count` now ships alongside the ratio for that reason, and the six undefined figures are
carried as `null` rather than `0`.

### A correction applied to the section 3 numbers

The Colab's `compare()` averages `cosine_similarity(g, g)` and `cosine_similarity(r, r)` over the full
square matrices, so both within-group means include every figure's similarity to itself — a diagonal of
1.0, worth 1/*n*. The cross-group matrix has no diagonal, so the two numbers being compared were inflated
and the one they were compared against was not. `build_data.py` now strips it (`_offdiag`), taking
generated↔generated from 0.4963 to **0.4930** and real↔real from 0.4855 to **0.4809**; generated↔real is
unchanged at 0.4454. The smaller real set was inflated more, so the correction widens the gap the section
describes rather than closing it. The raw values are kept in the bundle under `clip_sim.raw`.

## Rebuilding the data bundle

`tools/build_data.py` reads the CVPR Art Gallery source archive (`Data/figure_metrics.csv`,
`paper_ocr_texts.xlsx`, `Github Release Dset.xlsx`) plus `static/maps/*.json`, recomputes the
classifiers and the pixel-statistic ablation, and writes `static/data/arxaiv.json`. Adjust the
`ZIP` path at the top, then:

```sh
pip install numpy openpyxl pillow
python3 tools/build_data.py
```

The occlusion maps are built separately, and need only what is already in this repository:

```sh
pip install torch torchvision open_clip_torch pillow numpy scikit-learn
python3 tools/occlusion.py          # -> static/data/occlusion.json, ~13k forward passes, ~20 min on CPU

brew install tesseract              # or apt-get install tesseract-ocr
python3 tools/textmask.py           # -> adds `summary` to occlusion.json
python3 tools/page_ocr.py           # -> static/data/page_ocr.json, ~10 min for 100 pages
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

Figure embeddings: `OpenCLIP ViT-B-32` / `laion2b_s34b_b79k`, L2-normalized, standardized,
PCA-reduced, joined into a *k*=8 cosine nearest-neighbor graph. Title embeddings:
`all-MiniLM-L6-v2`. Affiliation and reference audits are manual.

**Significance.** The 87.0% is checked with a permutation test (2,000 label shuffles, full
leave-one-out refit each time) and a bootstrap interval (1,000 resamples). Both in `build_data.py`.
Each null ships as a 270-long tally of how many shuffles scored each *k*/269 rather than as 2,000
floats, and section 5 plots both of them.
Note that the null for the width-threshold rule is **59.3%**, not 50%, because picking the best of
269 cut points overfits shuffled labels too — the threshold is re-searched inside every
permutation, and a procedure that searches must be compared against a null that searches.

**Occlusion maps.** For each figure, each of ViT-B-32's 49 input patches is set to zero in normalized
tensor space — the mean color of CLIP's training distribution, so the least informative tile available
rather than a black square the encoder has never seen — and the image is re-embedded and pushed through
the *frozen* standardizer, PCA and discriminant. The recorded delta is signed: **positive means hiding
the tile moved the score toward "real"**, so the tile itself was evidence for "generated". The page
inverts that when it paints, which is why warm tiles read as arguing "generated". Deltas are centered
per figure before painting — see *Naive occlusion measures itself* above.

**Text-patch test.** `tools/textmask.py` runs tesseract at native resolution (per-word confidence
floor 40), maps each word box through `Resize(short side → 224)` + `CenterCrop(224)` into the 7×7
grid, and marks every patch a word touches. Text and non-text influence are compared *paired within
each figure*, so a figure with a diffuse decision cannot drown out one with a sharp decision.
Caveat carried in the output: OCR finds usable text in 76% of generated figures against 86% of real
ones, and 9.0 vs 15.4 patches per figure, so the worst-degraded text counts as "not text" and the
generated-half effect is a lower bound.

**Raw vs corrected page text.** `tools/page_ocr.py` runs tesseract over each page image and scores
both versions by the share of word tokens appearing in `/usr/share/dict/words`. The absolute rates
mean little — the list has no scientific vocabulary and no proper nouns, so it under-counts both, and
the corrected excerpts are shorter than the pages they came from. The *difference* is the number to
read, since raw and corrected face the identical dictionary on the identical pages. Section 8 shows
both, switchable per paper.

**Page text is OCR plus an LLM correction pass.** Raw OCR over a rendered-then-degraded page
fails badly enough to be unreadable, so garbled runs were resolved by an LLM to their nearest
sensible reading (`acrial imegery` → *aerial imagery*). Every excerpt in `abstract`, `refs` and
`closest` in the data bundle is therefore *corrected* text, and reads more cleanly than the pixels
do. The `title` field is the exception: it comes from `Github Release Dset.xlsx` and never went
through the pass, which is why titles still carry visible malapropisms. Anything downstream of the
page text inherits the correction pass's guesses.

## License

<a rel="license" href="http://creativecommons.org/licenses/by-sa/4.0/"><img alt="Creative Commons License" style="border-width:0" src="https://i.creativecommons.org/l/by-sa/4.0/88x31.png" /></a><br />This work is licensed under a <a rel="license" href="http://creativecommons.org/licenses/by-sa/4.0/">Creative Commons Attribution-ShareAlike 4.0 International License</a>.

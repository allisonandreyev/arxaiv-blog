#!/usr/bin/env python3
"""Build static/data/arxaiv.json for the VISxAI blog post from the CVPR zip + existing maps."""
import collections, csv, json, math, os, re, struct
import numpy as np
import openpyxl

ROOT = "/Users/allisonandreyev_unrestricted/Desktop/arxaiv-vis"
ZIP = ("/private/tmp/claude-502/-Users-allisonandreyev-unrestricted-Desktop-arxaiv-vis/"
       "44e90aa7-1950-42bf-8930-edcc094ab4e8/scratchpad/cvpr/CVPR Art Gallery _26 Submission")
DATA = os.path.join(ZIP, "Data")

out = {}

# ---------------------------------------------------------------- figures map
d = json.load(open(f"{ROOT}/static/maps/both_figures.json"))
nodes, links = d["nodes"], d["links"]
byid = {n["id"]: n for n in nodes}

# per-figure diagnostic metrics (generated only)
metrics = {}
for r in csv.DictReader(open(f"{DATA}/figure_metrics.csv")):
    metrics[r["filename"]] = dict(
        clip=float(r["clip_similarity"]),
        cplx=float(r["structural_complexity"]),
        rep=float(r["repetition"]),
    )

# The gibberish_ratio column of figure_metrics.csv was NOT a per-figure measurement: 38% of
# its values require a denominator larger than the largest figure-OCR token count (41), and
# its median implied denominator is 24 against a median of 7 tokens actually recoverable from
# a figure. It correlates with the per-figure quantity at r = -0.05 — no better than a random
# permutation — so it was measuring page-level text while section 7 labeled it per-figure.
# Replaced with a direct pass over the figures. tools/figure_gibberish_raw.csv ships with the
# repo, so this metric no longer depends on the unshipped source archive.
#
# gibberish_ratio is blank where OCR recovered no tokens at all. That is not missing data —
# it is the most degraded figures refusing to be measured — so it stays None rather than 0,
# and ocr_token_count is carried alongside so the denominator is always visible.
for r in csv.DictReader(open(f"{ROOT}/tools/figure_gibberish_raw.csv")):
    g = r["gibberish_ratio"].strip()
    metrics.setdefault(r["filename"], {}).update(
        gib=float(g) if g else None,
        tok=int(r["ocr_token_count"]),
    )

figs = []
for n in nodes:
    gen = n["type"] == "generated"
    m = metrics.get(n["name"]) if gen else None
    f = dict(id=n["id"], n=n["name"], c=1 if gen else 0,
             x=round(n["x"], 3), y=round(n["y"], 3), z=round(n["z"], 3))
    if m:
        f.update(clip=round(m["clip"], 4), cplx=round(m["cplx"], 3), rep=int(m["rep"]),
                 gib=round(m["gib"], 4) if m.get("gib") is not None else None,
                 tok=m.get("tok"))
    figs.append(f)
out["figures"] = figs

X = np.array([[n["x"], n["y"], n["z"]] for n in nodes])
yl = np.array([0 if n["type"] == "generated" else 1 for n in nodes])


def lda_fit(X, y):
    m0, m1 = X[y == 0].mean(0), X[y == 1].mean(0)
    S = np.cov(X.T) + np.eye(X.shape[1]) * 1e-6
    w = np.linalg.solve(S, m1 - m0)
    return w, (w @ m0 + w @ m1) / 2


def lda_loo(X, y):
    c = 0
    for i in range(len(X)):
        k = np.ones(len(X), bool); k[i] = False
        w, t = lda_fit(X[k], y[k])
        c += int(w @ X[i] > t) == y[i]
    return c / len(X)


w2, t2 = lda_fit(X[:, :2], yl)
score = X[:, :2] @ w2 - t2
out["lda"] = dict(w=[float(w2[0]), float(w2[1])], t=float(t2),
                  loo2=round(float(lda_loo(X[:, :2], yl)), 4),
                  loo3=round(float(lda_loo(X, yl)), 4),
                  loo_pc1=round(float(lda_loo(X[:, :1], yl)), 4),
                  baseline=round(float(max(yl.mean(), 1 - yl.mean())), 4),
                  scores=[round(float(s), 4) for s in score])


# ------------------------------------------------- is 87% beyond chance? (section 5)
# Raised in review: with 269 points in two dimensions, "the observed separations are weak enough
# that they could arguably be attributed to noise". A permutation test answers exactly that and
# assumes nothing -- shuffle the labels so the classes are interchangeable by construction, refit
# the whole leave-one-out loop, and see what this procedure scores when there is nothing to find.
#
# Note what the null is NOT. For a rule that searches (the width threshold in out["provenance"])
# the null mean sits well above 50% before any real signal exists, because the search itself
# overfits the shuffled labels. A procedure that searches must be compared against a null that
# searches too.
def lda_loo_fast(X, y):
    """Same leave-one-out accuracy as lda_loo, via sufficient-statistic downdates so the loop
    is cheap enough to run a few thousand times."""
    n = len(X)
    Sxx, Sx = X.T @ X, X.sum(0)
    s1, n1 = X[y == 1].sum(0), int(y.sum())
    s0, n0 = X[y == 0].sum(0), n - n1
    if n0 < 2 or n1 < 2:
        return float("nan")
    I = np.eye(X.shape[1]) * 1e-6
    ok = 0
    for i in range(n):
        xi = X[i]
        if y[i] == 1:
            m1, m0 = (s1 - xi) / (n1 - 1), s0 / n0
        else:
            m0, m1 = (s0 - xi) / (n0 - 1), s1 / n1
        m = (Sx - xi) / (n - 1)
        C = ((Sxx - np.outer(xi, xi)) - (n - 1) * np.outer(m, m)) / (n - 2)
        w = np.linalg.solve(C + I, m1 - m0)
        ok += int((w @ xi > (w @ m0 + w @ m1) / 2) == (y[i] == 1))
    return ok / n


_rs = np.random.default_rng(0)
_B = 2000
_obs = lda_loo_fast(X[:, :2], yl)
_null = np.array([lda_loo_fast(X[:, :2], _rs.permutation(yl)) for _ in range(_B)])
_boot = np.array([lda_loo_fast(X[i, :2], yl[i])
                  for i in (_rs.integers(0, len(X), len(X)) for _ in range(1000))])
_boot = _boot[~np.isnan(_boot)]
out["lda"]["perm"] = dict(
    B=_B, obs=round(float(_obs), 4),
    null_mean=round(float(_null.mean()), 4), null_sd=round(float(_null.std()), 4),
    null_max=round(float(_null.max()), 4),
    sd_above=round(float((_obs - _null.mean()) / _null.std()), 1),
    p=round(float((1 + int((_null >= _obs).sum())) / (_B + 1)), 5),
    ci=[round(float(np.percentile(_boot, 2.5)), 4), round(float(np.percentile(_boot, 97.5)), 4)],
    # Accuracies are k/269, so the null is shipped as a tally of how many shuffles scored each
    # k -- 270 integers instead of 2,000 floats. Section 5 draws it.
    n=len(X),
    hist=np.bincount(np.round(_null * len(X)).astype(int), minlength=len(X) + 1).tolist(),
)

# k-NN homophily
same = [byid[l["source"]]["type"] == byid[l["target"]]["type"] for l in links]
gen_e = [(byid[l["source"]]["type"], byid[l["target"]]["type"]) for l in links]
out["knn"] = dict(
    edges=len(links),
    same=int(sum(same)),
    same_pct=round(100 * float(np.mean(same)), 1),
    gen_pct=round(100 * np.mean([b == "generated" for a, b in gen_e if a == "generated"]), 1),
    real_pct=round(100 * np.mean([b == "real" for a, b in gen_e if a == "real"]), 1),
    k=8,
)
out["links"] = [dict(s=l["source"], t=l["target"]) for l in links]

# centroids / spread
g, r = X[yl == 0], X[yl == 1]
out["geometry"] = dict(
    cen_gen=[round(float(v), 3) for v in g.mean(0)],
    cen_real=[round(float(v), 3) for v in r.mean(0)],
    cen_dist=round(float(np.linalg.norm(g.mean(0) - r.mean(0))), 3),
    spread_gen=round(float(np.linalg.norm(g - g.mean(0), axis=1).mean()), 3),
    spread_real=round(float(np.linalg.norm(r - r.mean(0), axis=1).mean()), 3),
)

# ------------------------------------------------- how much variance the map actually holds
# The coords in both_figures.json are PCA scores taken on StandardScaler-transformed 512-d
# CLIP embeddings (see tools/colab_embeddings_and_graph_data_generation.py: make_graph).
# StandardScaler divides by the population std, so each of the 512 input columns ends up with
# sample variance n/(n-1) and the total input variance is exactly 512 * n/(n-1). Each
# component's share of that is therefore recoverable from the three shipped coordinates alone,
# with no need to re-embed anything. Section 4 prints these.
NDIM = 512
comp_var = X.var(0, ddof=1)
total_var = NDIM * len(X) / (len(X) - 1)
out["pca"] = dict(
    dims=NDIM, n=len(X),
    evr=[round(float(100 * v / total_var), 2) for v in comp_var],
    cum=[round(float(100 * c / total_var), 2) for c in comp_var.cumsum()],
)


# ------------------------------------------------- provenance confound (sections 6 and 11)
# Raised in review: the two populations differ in raw pixel dimensions, and a single threshold
# on image width separates them about as well as anything else in this post. CLIP itself never
# sees width -- preprocess resizes every figure to 224x224 before the transformer -- but a gap
# this size means the two sets differ in resampling history, effective stroke weight and detail
# density per rendered pixel, none of which section 6's seven statistics measure. Computed from
# the PNG headers of the figures shipped in this repo, so it reproduces without the archive.
def png_size(path):
    with open(path, "rb") as f:
        head = f.read(26)
    return struct.unpack(">II", head[16:24]) if head[:8] == b"\x89PNG\r\n\x1a\n" else None


dims, dlab = [], []
for sub, lab in (("figures", 0), ("real-figures", 1)):   # 0 = generated, 1 = real, as in yl
    for fn in sorted(os.listdir(f"{ROOT}/static/images/{sub}")):
        if not fn.lower().endswith(".png"):
            continue
        wh = png_size(f"{ROOT}/static/images/{sub}/{fn}")
        if wh:
            dims.append(wh)
            dlab.append(lab)
W = np.array([d[0] for d in dims])
dlab = np.array(dlab)
# best single split on width, either polarity
acc_t = max(((max(float(((W > t).astype(int) == dlab).mean()),
                  float(((W <= t).astype(int) == dlab).mean())), int(t)) for t in np.unique(W)))
out["provenance"] = dict(
    n=len(W),
    gen_w_med=int(np.median(W[dlab == 0])), real_w_med=int(np.median(W[dlab == 1])),
    gen_w_min=int(W[dlab == 0].min()), gen_w_max=int(W[dlab == 0].max()),
    real_w_min=int(W[dlab == 1].min()), real_w_max=int(W[dlab == 1].max()),
    width_acc=round(acc_t[0], 4), width_thresh=acc_t[1],
    width_wrong=int(round((1 - acc_t[0]) * len(W))),
)


# The null for this rule is NOT 0.5. Picking the best of 269 candidate cut points overfits
# whatever labels it is given, including shuffled ones, so the threshold must be re-searched
# inside every permutation -- otherwise the test flatters a searched statistic. Section 5 uses
# the gap between this null and the discriminant's to make exactly that point.
def best_width_split(labels):
    return max(max(float(((W > t).astype(int) == labels).mean()),
                   float(((W <= t).astype(int) == labels).mean()))
               for t in np.unique(W))


_wnull = np.array([best_width_split(_rs.permutation(dlab)) for _ in range(2000)])
out["provenance"]["perm"] = dict(
    null_mean=round(float(_wnull.mean()), 4),
    p=round(float((1 + int((_wnull >= acc_t[0]).sum())) / 2001), 5),
    hist=np.bincount(np.round(_wnull * len(W)).astype(int), minlength=len(W) + 1).tolist(),
)

# ---------------------------------------------------------------- papers
wb = openpyxl.load_workbook(f"{DATA}/Github Release Dset.xlsx", data_only=True)
ws = wb["Sheet1"]
rows = list(ws.iter_rows(values_only=True))
hdr = [str(c).strip() if c else "" for c in rows[0]]
col = {h: i for i, h in enumerate(hdr) if h}
papers = {}
for row in rows[1:]:
    if not row or not row[0]:
        continue
    fn = str(row[0]).strip()
    def g(k):
        i = col.get(k)
        v = row[i] if i is not None and i < len(row) else None
        return str(v).strip() if v not in (None, "") else ""
    papers[fn] = dict(
        f=fn, title=g("Paper Title"), topic=g("Subtopic"),
        aff=g("Author Affiliations"), authors=g("Authors"),
        struct=g("Structural Integrity"),
    )
wb.close()

# NOTE: the OCR columns (G/H/I) of "Github Release Dset.xlsx" are shuffled — they were
# pasted in string-sorted filename order (1, 10, 100, 11, ...) against numerically-ordered
# rows, so paper N carries paper M's text. paper_ocr_texts.xlsx is correctly keyed by
# filename, so all text fields come from there instead.
wb = openpyxl.load_workbook(f"{DATA}/paper_ocr_texts.xlsx", data_only=True)
ws = wb.worksheets[0]
rows = list(ws.iter_rows(values_only=True))
hdr = [str(c).strip() if c else "" for c in rows[0]]
ci = {h: i for i, h in enumerate(hdr) if h}
for row in rows[1:]:
    if not row or not row[0]:
        continue
    fn = str(row[0]).strip()
    if fn not in papers:
        continue
    def gc(k, n):
        i = ci.get(k)
        v = row[i] if i is not None and i < len(row) else None
        return str(v).strip()[:n] if v not in (None, "", "None") else ""
    papers[fn]["abstract"] = gc("CONTENT", 1400)
    papers[fn]["refs"] = gc("REFERENCES", 900)
    s = gc("CLOSEST REAL", 300)
    papers[fn]["closest"] = re.sub(r'^s\d+\s*=\s*"?', "", s).strip().strip('"')
wb.close()

pj = json.load(open(f"{ROOT}/static/maps/papers.json"))
for n in pj["nodes"]:
    fn = n["id"]
    if fn in papers:
        papers[fn]["cluster"] = n["cluster"]
        if (not papers[fn]["title"] or papers[fn]["title"] == "None") and n.get("name"):
            papers[fn]["title"] = n["name"]

out["papers"] = sorted(papers.values(), key=lambda p: int(re.sub(r"\D", "", p["f"]) or 0))
out["paper_links"] = [dict(s=l["source"], t=l["target"], w=round(l["weight"], 4))
                      for l in pj["links"]]

# ---------------------------------------------------------------- tallies
# Counted from papers.json rather than typed in. The hardcoded tally this replaces was off by
# one in two of the five groups: it was the Subtopic spreadsheet column, and one paper carries a
# different cluster id in the graph.
CLUSTER_NAMES = {1: "Object detection", 2: "Semantics / segmentation", 3: "Image generation",
                 4: "Localization / spatiotemporal", 5: "Visual features / networks"}
_sizes = collections.Counter(int(n["cluster"]) for n in pj["nodes"])
out["clusters"] = [dict(id=i, name=CLUSTER_NAMES[i], n=_sizes[i]) for i in sorted(_sizes)]


# ------------------------------------------------- do the titles cluster this way? (section 10)
# The five groups are hand-assigned subtopic labels, not clusters -- they are a near-copy of the
# Subtopic column, assigned before any embedding was run. Section 10 used to imply the title
# embedding had discovered them, so this measures whether it could have.
#
# Modularity scores a partition by how much more edge weight falls inside groups than random
# rewiring of the same edges would give; adjusted Rand index scores agreement between two
# partitions, at 0 for unrelated ones. Spectral clustering is run on the same graph asking for
# the same number of groups, as the fairest available comparison.
_pidx = {n["id"]: i for i, n in enumerate(pj["nodes"])}
_n = len(pj["nodes"])
_A = np.zeros((_n, _n))
for _l in pj["links"]:
    _i, _j = _pidx[_l["source"]], _pidx[_l["target"]]
    _w = _l.get("weight", 1.0)
    _A[_i, _j] = _A[_j, _i] = max(_A[_i, _j], _w)
_lab = np.array([n["cluster"] for n in pj["nodes"]])


def modularity(A, lab):
    m, k, Q = A.sum() / 2, A.sum(1), 0.0
    for cl in np.unique(lab):
        sel = lab == cl
        Q += A[np.ix_(sel, sel)].sum() / (2 * m) - (k[sel].sum() / (2 * m)) ** 2
    return float(Q)


def adjusted_rand(a, b):
    pair = lambda cnt: sum(v * (v - 1) / 2 for v in cnt.values())
    s = pair(collections.Counter(zip(a, b)))
    sa, sb = pair(collections.Counter(a)), pair(collections.Counter(b))
    tot = len(a) * (len(a) - 1) / 2
    exp = sa * sb / tot
    return (s - exp) / ((sa + sb) / 2 - exp)


def _kmeans(Z, k, seed):
    r = np.random.default_rng(seed)
    C = Z[r.choice(len(Z), k, replace=False)]
    for _ in range(100):
        lab = ((Z[:, None, :] - C[None]) ** 2).sum(2).argmin(1)
        nxt = np.array([Z[lab == j].mean(0) if (lab == j).any() else C[j] for j in range(k)])
        if np.allclose(nxt, C):
            break
        C = nxt
    return lab


_deg = _A.sum(1)
_Dm = np.diag(1 / np.sqrt(np.maximum(_deg, 1e-12)))
_, _vec = np.linalg.eigh(np.eye(_n) - _Dm @ _A @ _Dm)
_U = _vec[:, 1:5]
_U = _U / np.maximum(np.linalg.norm(_U, axis=1, keepdims=True), 1e-12)
_best = max((modularity(_A, _kmeans(_U, 5, sd)), sd) for sd in range(20))
_spec = _kmeans(_U, 5, _best[1])
out["clusters_check"] = dict(
    q_labels=round(modularity(_A, _lab), 4),
    q_spectral5=round(float(_best[0]), 4),
    ari=round(float(adjusted_rand(_spec, _lab)), 3),
    n_links=len(pj["links"]),
)
out["affiliations"] = dict(
    total_authors=340, total_affiliations=317,
    rows=[
        dict(name="Hallucinated (institution does not exist)", n=107, pct_aff=33.75, pct_auth=31.47, kind="fake"),
        dict(name="Mutated (real institution, wrong name)", n=77, pct_aff=24.29, pct_auth=22.65, kind="mutated"),
        dict(name="Stanford", n=44, pct_aff=13.88, pct_auth=12.94, kind="real"),
        dict(name="None listed", n=23, pct_aff=7.26, pct_auth=6.76, kind="none"),
        dict(name="U Toronto", n=23, pct_aff=7.26, pct_auth=6.76, kind="real"),
        dict(name="MIT", n=19, pct_aff=5.99, pct_auth=5.59, kind="real"),
        dict(name="UC Berkeley", n=16, pct_aff=5.05, pct_auth=4.71, kind="real"),
        dict(name="Google / DeepMind", n=15, pct_aff=4.73, pct_auth=4.41, kind="real"),
        dict(name="CMU", n=10, pct_aff=3.15, pct_auth=2.94, kind="real"),
        dict(name="Georgia Tech", n=7, pct_aff=2.21, pct_auth=2.06, kind="real"),
        dict(name="UIUC", n=6, pct_aff=1.89, pct_auth=1.76, kind="real"),
    ])
out["structure"] = [
    dict(name="All features present", pct=69),
    dict(name="Missing title", pct=19),
    dict(name="Missing references", pct=8),
    dict(name="Missing affiliations", pct=7),
]
out["names"] = dict(
    last=[("Chen", 28), ("Zhang", 17), ("Wang", 11), ("Liu", 11), ("Lee", 10),
          ("Thompson", 9), ("Johnson", 9), ("Nguyen", 8), ("Smith", 8), ("Patel", 8),
          ("Doe", 7), ("Wu", 6), ("Wong", 5), ("Li", 5), ("Kim", 5), ("Xu", 5)],
    first=[("Michael", 20), ("David", 17), ("Emily", 13), ("John", 13), ("Kevin", 11),
           ("Laura", 9), ("Rachel", 8), ("Alex", 7), ("Daniel", 6), ("Eric", 6),
           ("Jane", 6), ("Jason", 5), ("Thomas", 5), ("Alice", 5), ("James", 5)],
    full=[("Kevin Chen", 4), ("David Chen", 4), ("John Doe", 4), ("Jacob Wang", 3),
          ("Emily Chen", 3), ("John Smith", 3), ("Jane Doe", 3), ("Alice Johnson", 3),
          ("Jane Smith", 3)],
)

# ------------------------------------------------- how concentrated is that, really? (section 9)
# Section 9 used to assert the surname distribution was "far narrower than any real conference
# roster". That is a comparative claim with nothing to compare against, so it was cut; what
# replaces it is the measurement, recomputed here from the per-paper author lists rather than
# from the hardcoded head above. (The two agree on the top ten, which is the only check available
# that those hardcoded lists are right.)
#
# Every one of these is sample-size dependent -- entropy in particular rises with N almost
# mechanically -- so none of them can be compared against a roster of a different size without
# subsampling first. That is the reason the comparison is still missing rather than merely absent.
_auth = [" ".join(a.split())
         for p_ in out["papers"]
         for a in re.split(r"[\n;,]", p_.get("authors", "") or "")
         if " ".join(a.split())]
_sur = [a.split()[-1] for a in _auth if a.split()]
_cnt = collections.Counter(_sur)
_N = len(_sur)
_ent = -sum((v / _N) * math.log2(v / _N) for v in _cnt.values())
_sorted = sorted(_cnt.values())
_gini = ((2 * sum((i + 1) * v for i, v in enumerate(_sorted))) / (len(_sorted) * sum(_sorted))
         - (len(_sorted) + 1) / len(_sorted))
out["names"]["conc"] = dict(
    n_authors=_N, n_distinct=len(_cnt),
    distinct_ratio=round(len(_cnt) / _N, 3),
    entropy=round(float(_ent), 3), entropy_max=round(math.log2(_N), 3),
    top1=round(100 * _cnt.most_common(1)[0][1] / _N, 1),
    top10=round(100 * sum(v for _, v in _cnt.most_common(10)) / _N, 1),
    gini=round(float(_gini), 3),
    doe=int(_cnt.get("Doe", 0)),
)
# compare() in tools/colab_embeddings_and_graph_data_generation.py reports gg.mean()
# and rr.mean() over the FULL square similarity matrices, so both within-group means
# include every figure's similarity to itself — a diagonal of 1.0, worth 1/n of the
# mean. The cross-group matrix g×r has no diagonal to include. Left uncorrected the
# two within-group numbers are inflated and the cross-group one is not, which is
# exactly the comparison section 3 rests on. Strip the diagonal so all three are
# means over distinct pairs. The smaller real set is inflated more (1/113 > 1/156),
# so this widens the generated-vs-real gap rather than narrowing it.
_RAW_SIM = dict(g2r=0.44537696, g2g=0.49628806, r2r=0.4854793)


def _offdiag(mean, m):
    """Mean over distinct pairs, given the mean over a full m x m matrix with unit diagonal."""
    return (mean * m * m - m) / (m * m - m)


_n_gen, _n_real = int((yl == 0).sum()), int((yl == 1).sum())
out["clip_sim"] = dict(
    g2r=_RAW_SIM["g2r"],                                  # cross-group: no diagonal
    g2g=round(_offdiag(_RAW_SIM["g2g"], _n_gen), 6),
    r2r=round(_offdiag(_RAW_SIM["r2r"], _n_real), 6),
    raw=_RAW_SIM,
)

# metric summary
gm = [f for f in figs if f["c"] == 1]
def summ(key):
    v = np.array([f[key] for f in gm if f.get(key) is not None])
    return dict(mean=round(float(v.mean()), 4), sd=round(float(v.std(ddof=1)), 4),
                min=round(float(v.min()), 4), max=round(float(v.max()), 4),
                med=round(float(np.median(v)), 4))
out["metric_summary"] = {k: summ(k) for k in ("clip", "cplx", "gib", "rep")}

# The gibberish ratio needs its own denominators reported with it: it is undefined where OCR
# found nothing, and exactly zero for most figures that do yield tokens.
_gv = np.array([f["gib"] for f in gm if f.get("gib") is not None])
_tv = np.array([f["tok"] for f in gm if f.get("tok") is not None])
out["metric_summary"]["gib"].update(n=int(len(_gv)), zero=int((_gv == 0).sum()),
                                    undefined=int((_tv == 0).sum()))
out["metric_summary"]["tok"] = dict(
    mean=round(float(_tv.mean()), 2), sd=round(float(_tv.std(ddof=1)), 2),
    min=int(_tv.min()), max=int(_tv.max()), med=int(np.median(_tv)),
    le3=int((_tv <= 3).sum()), le5=int((_tv <= 5).sum()), zero=int((_tv == 0).sum()))
out["counts"] = dict(papers=len(out["papers"]), gen_figs=int((yl == 0).sum()),
                     real_figs=int((yl == 1).sum()))

# ------------------------------------------------- pixel-statistics ablation
# Seven cheap appearance statistics, recomputed here for BOTH sets, so the post can
# test whether the CLIP separation is explainable by low-level looks alone.
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
PKEYS = ["edge", "ink", "colf", "sat", "ent", "white", "ar"]


def pixfeats(path):
    im = Image.open(path).convert("RGB")
    im.thumbnail((256, 256), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32) / 255.0
    gray = a @ np.array([0.299, 0.587, 0.114], np.float32)
    gx = np.abs(np.diff(gray, axis=1))[:-1, :]
    gy = np.abs(np.diff(gray, axis=0))[:, :-1]
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    rg, yb = R - G, 0.5 * (R + G) - B
    mx, mn = a.max(-1), a.min(-1)
    h, _ = np.histogram(gray, bins=64, range=(0, 1))
    h = h / h.sum()
    return dict(
        edge=float(np.sqrt(gx ** 2 + gy ** 2).mean()),
        ink=float((gray < 0.85).mean()),
        colf=float(np.sqrt(rg.std() ** 2 + yb.std() ** 2)
                   + 0.3 * np.sqrt(rg.mean() ** 2 + yb.mean() ** 2)),
        sat=float(np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0).mean()),
        ent=float(-(h[h > 0] * np.log2(h[h > 0])).sum()),
        white=float((gray > 0.95).mean()),
        ar=float(im.width / im.height),
    )


P = []
for f in figs:
    dirn = "figures" if f["c"] == 1 else "real-figures"
    P.append(pixfeats(f"{ROOT}/static/images/{dirn}/{f['n']}"))
for f, pf in zip(figs, P):
    f["p"] = {k: round(pf[k], 5) for k in PKEYS}

Xp = np.array([[pf[k] for k in PKEYS] for pf in P])
Xp = (Xp - Xp.mean(0)) / Xp.std(0)
yr = (yl == 1).astype(int)          # 1 = real


def auc(pos, neg):
    allv = np.concatenate([pos, neg])
    order = allv.argsort()
    ranks = np.empty(len(allv)); ranks[order] = np.arange(1, len(allv) + 1)
    n1, n2 = len(pos), len(neg)
    return (ranks[:n1].sum() - n1 * (n1 + 1) / 2) / (n1 * n2)


PLABEL = dict(edge="Edge density", ink="Ink coverage", colf="Colorfulness",
              sat="Saturation", ent="Tone entropy", white="White space",
              ar="Aspect ratio")
out["pixel"] = dict(
    keys=PKEYS, labels=PLABEL,
    rows=[dict(k=k,
               label=PLABEL[k],
               ai=round(float(Xp[yl == 0][:, i].mean()), 4),
               real=round(float(Xp[yl == 1][:, i].mean()), 4),
               ai_raw=round(float(np.array([pf[k] for pf, c in zip(P, yl) if c == 0]).mean()), 4),
               real_raw=round(float(np.array([pf[k] for pf, c in zip(P, yl) if c == 1]).mean()), 4),
               auc=round(float(max(auc(Xp[yl == 0][:, i], Xp[yl == 1][:, i]),
                                   1 - auc(Xp[yl == 0][:, i], Xp[yl == 1][:, i]))), 3),
               loo=round(float(lda_loo(Xp[:, [i]], yr)), 4))
          for i, k in enumerate(PKEYS)],
)
out["ablation"] = [
    dict(name="Always guess “generated”", acc=round(float(max(yr.mean(), 1 - yr.mean())), 4), kind="none"),
    dict(name="7 pixel statistics", acc=round(float(lda_loo(Xp, yr)), 4), kind="pixel"),
    dict(name="CLIP PC₁ only", acc=round(float(lda_loo(X[:, :1], yr)), 4), kind="clip"),
    dict(name="CLIP PC₁ + PC₂", acc=round(float(lda_loo(X[:, :2], yr)), 4), kind="clip"),
    dict(name="CLIP PCs + pixel statistics", acc=round(float(lda_loo(np.hstack([X[:, :2], Xp]), yr)), 4), kind="both"),
]

os.makedirs(f"{ROOT}/static/data", exist_ok=True)
with open(f"{ROOT}/static/data/arxaiv.json", "w") as fh:
    json.dump(out, fh, separators=(",", ":"))
print("wrote", os.path.getsize(f"{ROOT}/static/data/arxaiv.json"), "bytes")
print("papers:", len(out["papers"]), "figs:", len(figs))
print("lda:", {k: v for k, v in out["lda"].items() if k != "scores"})
print("knn:", out["knn"])
print("metric summary:", json.dumps(out["metric_summary"], indent=1))
miss = [p["f"] for p in out["papers"] if not p.get("closest")]
print("papers missing closest-real:", len(miss))
print("sample paper:", json.dumps(out["papers"][0])[:600])

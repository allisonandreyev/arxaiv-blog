/* arxAIv — interactives for the VISxAI blog post.
   Vanilla JS, no chart library, so the page keeps working with no CDN. */
(function () {
  'use strict';

  var D = null;                     // static/data/arxaiv.json
  var THUMB = {
    ai: 'static/images/thumbs/figures/',
    real: 'static/images/thumbs/real-figures/',
    paper: 'static/images/thumbs/papers/'
  };
  var FULL = {
    ai: 'static/images/figures/',
    real: 'static/images/real-figures/',
    paper: 'static/images/papers/'
  };

  // -------------------------------------------------------------- helpers

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function fmt(v, p) { return Number(v).toFixed(p == null ? 2 : p); }

  function figSrc(f, full) {
    var base = (full ? FULL : THUMB)[f.c === 1 ? 'ai' : 'real'];
    var name = full ? f.n : f.n.replace(/\.png$/i, '.jpg');
    return base + name;
  }

  // Seeded RNG so the quiz is reproducible per page load bucket but varied per visit.
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /* A tiny 2D plot surface on a HiDPI canvas with linear scales. */
  function Surface(canvas, opts) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.m = opts.margin || { t: 12, r: 12, b: 34, l: 44 };
    this.dom = opts.domain;           // {x:[min,max], y:[min,max]}
    this.h = opts.height || 420;
    this.resize();
  }
  Surface.prototype.resize = function () {
    var dpr = window.devicePixelRatio || 1;
    var w = this.c.parentNode.clientWidth || 640;
    this.w = w;
    this.c.style.height = this.h + 'px';
    this.c.width = Math.round(w * dpr);
    this.c.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.iw = w - this.m.l - this.m.r;
    this.ih = this.h - this.m.t - this.m.b;
  };
  Surface.prototype.sx = function (v) {
    var d = this.dom.x;
    return this.m.l + (v - d[0]) / (d[1] - d[0]) * this.iw;
  };
  Surface.prototype.sy = function (v) {
    var d = this.dom.y;
    return this.m.t + this.ih - (v - d[0]) / (d[1] - d[0]) * this.ih;
  };
  Surface.prototype.invx = function (px) {
    var d = this.dom.x;
    return d[0] + (px - this.m.l) / this.iw * (d[1] - d[0]);
  };
  Surface.prototype.invy = function (py) {
    var d = this.dom.y;
    return d[0] + (this.m.t + this.ih - py) / this.ih * (d[1] - d[0]);
  };
  Surface.prototype.clear = function () {
    this.ctx.clearRect(0, 0, this.w, this.h);
  };
  Surface.prototype.axes = function (xlab, ylab) {
    var ctx = this.ctx, i;
    ctx.save();
    ctx.strokeStyle = css('--rule');
    ctx.fillStyle = css('--ink-faint');
    ctx.lineWidth = 1;
    ctx.font = '11px ' + css('--sans').split(',')[0].replace(/"/g, '') + ', sans-serif';
    var xt = ticks(this.dom.x, 5), yt = ticks(this.dom.y, 4);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (i = 0; i < xt.length; i++) {
      var px = Math.round(this.sx(xt[i])) + 0.5;
      ctx.beginPath(); ctx.moveTo(px, this.m.t); ctx.lineTo(px, this.m.t + this.ih); ctx.stroke();
      ctx.fillText(trimNum(xt[i]), px, this.m.t + this.ih + 7);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (i = 0; i < yt.length; i++) {
      var py = Math.round(this.sy(yt[i])) + 0.5;
      ctx.beginPath(); ctx.moveTo(this.m.l, py); ctx.lineTo(this.m.l + this.iw, py); ctx.stroke();
      ctx.fillText(trimNum(yt[i]), this.m.l - 7, py);
    }
    ctx.fillStyle = css('--ink-soft');
    ctx.font = '600 11px ' + css('--sans').split(',')[0].replace(/"/g, '') + ', sans-serif';
    if (xlab) { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(xlab, this.m.l + this.iw / 2, this.h - 1); }
    if (ylab) {
      ctx.save();
      ctx.translate(11, this.m.t + this.ih / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(ylab, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  };

  function ticks(dom, n) {
    var span = dom[1] - dom[0];
    if (!(span > 0)) return dom.slice();
    var step = Math.pow(10, Math.floor(Math.log(span / n) / Math.LN10));
    var err = span / n / step;
    if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
    var out = [], v = Math.ceil(dom[0] / step) * step;
    for (; v <= dom[1] + step * 1e-6; v += step) out.push(Math.round(v / step) * step);
    return out;
  }
  function trimNum(v) {
    var a = Math.abs(v);
    if (a >= 1000) return (v / 1000) + 'k';
    if (a < 0.001 && a > 0) return v.toExponential(0);
    return String(Math.round(v * 1000) / 1000);
  }
  function extent(arr, get, pad) {
    var lo = Infinity, hi = -Infinity;
    arr.forEach(function (d) { var v = get(d); if (v < lo) lo = v; if (v > hi) hi = v; });
    var p = (hi - lo) * (pad == null ? 0.06 : pad);
    return [lo - p, hi + p];
  }

  /* Shared floating tooltip. */
  function Tip(host) {
    this.node = el('div', 'tip');
    host.style.position = 'relative';
    host.appendChild(this.node);
    this.host = host;
  }
  Tip.prototype.show = function (html, x, y) {
    this.node.innerHTML = html;
    this.node.classList.add('show');
    var w = this.node.offsetWidth, h = this.node.offsetHeight;
    var hw = this.host.clientWidth;
    var lx = Math.min(Math.max(4, x + 14), hw - w - 4);
    var ly = Math.max(4, y - h - 12);
    this.node.style.left = lx + 'px';
    this.node.style.top = ly + 'px';
  };
  Tip.prototype.hide = function () { this.node.classList.remove('show'); };

  // ---------------------------------------------------------------- lightbox

  var lightbox;
  function openLightbox(src, alt) {
    if (!lightbox) {
      lightbox = el('div', 'lightbox');
      var img = el('img');
      var close = el('button', 'lightbox-close', '×');
      close.setAttribute('aria-label', 'Close');
      lightbox.appendChild(img);
      lightbox.appendChild(close);
      document.body.appendChild(lightbox);
      lightbox.addEventListener('click', function () { lightbox.classList.remove('open'); });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') lightbox.classList.remove('open');
      });
    }
    var im = $('img', lightbox);
    im.src = src; im.alt = alt || '';
    lightbox.classList.add('open');
  }

  // ---------------------------------------------------------------- 1. quiz

  function initQuiz() {
    var host = $('#quiz');
    if (!host || !D) return;
    var ROUNDS = 8;
    var ai = D.figures.filter(function (f) { return f.c === 1; });
    var real = D.figures.filter(function (f) { return f.c === 0; });
    var rand = rng(Date.now() % 100000);
    function pick(arr, n) {
      var pool = arr.slice(), out = [];
      for (var i = 0; i < n && pool.length; i++) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
      return out;
    }
    var aiPicks = pick(ai, ROUNDS), realPicks = pick(real, ROUNDS);

    var stage = $('.quiz-stage', host);
    var scoreEl = $('.quiz-score', host);
    var dotsEl = $('.quiz-dots', host);
    var msgEl = $('.quiz-msg', host);
    var nextBtn = $('.quiz-next', host);
    var blurBtn = $('.quiz-blur', host);

    var round = 0, hits = 0, answered = false, results = [];
    var blurOn = true;
    stage.classList.add('blurred');

    if (blurBtn) blurBtn.addEventListener('click', function () {
      blurOn = !blurOn;
      blurBtn.setAttribute('aria-pressed', String(blurOn));
      stage.classList.toggle('blurred', blurOn);
    });

    for (var i = 0; i < ROUNDS; i++) dotsEl.appendChild(el('span', 'quiz-dot'));

    function render() {
      stage.innerHTML = '';
      answered = false;
      nextBtn.style.visibility = 'hidden';
      var pair = rand() < 0.5 ? [aiPicks[round], realPicks[round]] : [realPicks[round], aiPicks[round]];
      pair.forEach(function (f) {
        var card = el('button', 'quiz-card');
        card.type = 'button';
        var img = el('img');
        img.src = figSrc(f, false);
        img.alt = 'Scientific figure, source hidden';
        img.loading = 'lazy';
        var tag = el('span', 'quiz-tag ' + (f.c === 1 ? 'ai' : 'real'), f.c === 1 ? 'Generated' : 'Real');
        card.appendChild(img); card.appendChild(tag);
        card.addEventListener('click', function () { answer(f, card); });
        stage.appendChild(card);
      });
      msgEl.textContent = 'Round ' + (round + 1) + ' of ' + ROUNDS + ' — click the figure you think an image model drew.'
        + (blurOn ? ' Both are blurred; they sharpen once you answer.' : '');
      msgEl.style.color = '';
    }

    function answer(f, card) {
      if (answered) return;
      answered = true;
      var right = f.c === 1;
      if (right) hits++;
      results.push(right);
      $$('.quiz-card', stage).forEach(function (c) { c.classList.add('locked', 'revealed'); });
      card.classList.add(right ? 'correct' : 'wrong');
      dotsEl.children[round].classList.add(right ? 'hit' : 'miss');
      scoreEl.innerHTML = '<b>' + hits + '</b> / ' + (round + 1) + ' correct';
      msgEl.textContent = (right
        ? 'Correct — that one is generated.'
        : 'Not quite. The generated figure was the other one.')
        + (blurOn ? ' Now that it is sharp, look at the labels.' : '');
      msgEl.style.color = right ? css('--ok') : css('--warn');
      nextBtn.style.visibility = 'visible';
      nextBtn.textContent = round === ROUNDS - 1 ? 'See how you did →' : 'Next pair →';
    }

    nextBtn.addEventListener('click', function () {
      round++;
      if (round >= ROUNDS) {
        stage.innerHTML = '';
        var pct = Math.round(100 * hits / ROUNDS);
        var summary = el('div', 'panel');
        summary.style.gridColumn = '1 / -1';
        summary.innerHTML = '<div class="panel-title">Your score</div>' +
          '<p style="font-family:var(--sans);font-size:1.05rem;margin:.4rem 0 0">You spotted <b>' + hits +
          ' of ' + ROUNDS + '</b> generated figures (' + pct + '%). Chance is 50%.</p>' +
          '<p style="font-family:var(--sans);font-size:.88rem;color:var(--ink-faint);margin:.6rem 0 0">' +
          'Scroll on: the rest of this post is about a model that gets <b>87%</b> on the same 269 images ' +
          'using two numbers per figure — and about what those two numbers actually encode.</p>';
        stage.appendChild(summary);
        msgEl.textContent = '';
        nextBtn.style.visibility = 'hidden';
        return;
      }
      render();
    });

    render();
  }

  // ------------------------------------------------------ 2. embedding map

  function initMap() {
    var host = $('#embed-map');
    if (!host || !D) return;
    var canvas = $('canvas', host);
    var tip = new Tip($('.chart-holder', host));
    var pts = D.figures;
    var byId = {};
    pts.forEach(function (p) { byId[p.id] = p; });

    var show = 'all';
    var showEdges = false;
    var showBoundary = false;
    var hover = null;

    var surf = new Surface(canvas, {
      domain: { x: extent(pts, function (d) { return d.x; }), y: extent(pts, function (d) { return d.y; }) },
      height: Math.min(520, Math.max(340, window.innerHeight * 0.52)),
      margin: { t: 14, r: 14, b: 38, l: 46 }
    });

    function visible(p) { return show === 'all' || (show === 'ai') === (p.c === 1); }

    function draw() {
      surf.clear();
      surf.axes('principal component 1', 'principal component 2');
      var ctx = surf.ctx, i;

      if (showBoundary) {
        // LDA boundary: w0*x + w1*y = t   ->   y = (t - w0*x) / w1
        var w = D.lda.w, t = D.lda.t;
        var dx = surf.dom.x;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(surf.sx(dx[0]), surf.sy((t - w[0] * dx[0]) / w[1]));
        ctx.lineTo(surf.sx(dx[1]), surf.sy((t - w[0] * dx[1]) / w[1]));
        ctx.strokeStyle = css('--ink-faint');
        ctx.lineWidth = 1.6;
        ctx.setLineDash([6, 5]);
        ctx.stroke();
        ctx.restore();
      }

      if (showEdges) {
        ctx.save();
        ctx.lineWidth = 0.7;
        for (i = 0; i < D.links.length; i++) {
          var a = byId[D.links[i].s], b = byId[D.links[i].t];
          if (!a || !b || !visible(a) || !visible(b)) continue;
          var same = a.c === b.c;
          ctx.strokeStyle = same ? 'rgba(140,140,140,0.16)' : css('--warn');
          ctx.globalAlpha = same ? 1 : 0.5;
          ctx.beginPath();
          ctx.moveTo(surf.sx(a.x), surf.sy(a.y));
          ctx.lineTo(surf.sx(b.x), surf.sy(b.y));
          ctx.stroke();
        }
        ctx.restore();
      }

      for (i = 0; i < pts.length; i++) {
        var p = pts[i];
        var on = visible(p);
        ctx.beginPath();
        ctx.arc(surf.sx(p.x), surf.sy(p.y), p === hover ? 6.5 : 4.2, 0, 6.2832);
        ctx.fillStyle = p.c === 1 ? css('--ai') : css('--real');
        ctx.globalAlpha = on ? (p === hover ? 1 : 0.82) : 0.09;
        ctx.fill();
        if (p === hover) {
          ctx.globalAlpha = 1;
          ctx.lineWidth = 2;
          ctx.strokeStyle = css('--bg-raised');
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    function nearest(mx, my) {
      var best = null, bd = 18 * 18;
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        if (!visible(p)) continue;
        var dx = surf.sx(p.x) - mx, dy = surf.sy(p.y) - my, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    }

    canvas.addEventListener('mousemove', function (e) {
      var r = canvas.getBoundingClientRect();
      var mx = e.clientX - r.left, my = e.clientY - r.top;
      var p = nearest(mx, my);
      if (p !== hover) { hover = p; draw(); }
      if (p) {
        tip.show('<img src="' + figSrc(p, false) + '" alt="">' +
          '<span class="tip-k">' + (p.c === 1 ? 'Generated' : 'Real') + '</span> · ' + p.n,
          mx, my);
      } else tip.hide();
    });
    canvas.addEventListener('mouseleave', function () { hover = null; tip.hide(); draw(); });
    canvas.addEventListener('click', function (e) {
      var r = canvas.getBoundingClientRect();
      var p = nearest(e.clientX - r.left, e.clientY - r.top);
      if (p) openLightbox(figSrc(p, true), p.n);
    });

    $$('[data-show]', host).forEach(function (b) {
      b.addEventListener('click', function () {
        show = b.getAttribute('data-show');
        $$('[data-show]', host).forEach(function (o) {
          o.setAttribute('aria-pressed', String(o === b));
        });
        draw();
      });
    });
    var edgeBtn = $('[data-toggle="edges"]', host);
    if (edgeBtn) edgeBtn.addEventListener('click', function () {
      showEdges = !showEdges;
      edgeBtn.setAttribute('aria-pressed', String(showEdges));
      draw();
    });
    var bBtn = $('[data-toggle="boundary"]', host);
    if (bBtn) bBtn.addEventListener('click', function () {
      showBoundary = !showBoundary;
      bBtn.setAttribute('aria-pressed', String(showBoundary));
      draw();
    });

    window.addEventListener('resize', function () { surf.resize(); draw(); });
    draw();
  }

  // ------------------------------------------------- 3. discriminant strip

  function initDiscriminant() {
    var host = $('#discriminant');
    if (!host || !D) return;
    var canvas = $('canvas', host);
    var tip = new Tip($('.chart-holder', host));
    var scores = D.lda.scores;
    var pts = D.figures.map(function (f, i) { return { f: f, s: scores[i] }; });

    // bin into a beeswarm-ish histogram: x = score, y = stack index within bin
    var dom = extent(pts, function (d) { return d.s; }, 0.04);
    var NB = 46;
    var bins = [];
    pts.forEach(function (p) {
      var b = Math.min(NB - 1, Math.max(0, Math.floor((p.s - dom[0]) / (dom[1] - dom[0]) * NB)));
      (bins[b] = bins[b] || []).push(p);
    });
    var maxStack = 0;
    bins.forEach(function (b) {
      if (!b) return;
      b.sort(function (a, c) { return a.f.c - c.f.c; });
      b.forEach(function (p, i) { p.k = i; });
      if (b.length > maxStack) maxStack = b.length;
    });

    var surf = new Surface(canvas, {
      domain: { x: dom, y: [0, maxStack + 1] },
      height: 260,
      margin: { t: 14, r: 14, b: 40, l: 46 }
    });
    var hover = null;

    function draw() {
      surf.clear();
      var ctx = surf.ctx;
      // grey background halves
      ctx.save();
      ctx.fillStyle = css('--bg-sunken');
      ctx.globalAlpha = 0.75;
      ctx.fillRect(surf.m.l, surf.m.t, surf.sx(0) - surf.m.l, surf.ih);
      ctx.restore();
      surf.axes('discriminant score  (← looks generated   ·   looks real →)', 'figures');

      // boundary
      ctx.save();
      ctx.strokeStyle = css('--ink');
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(surf.sx(0), surf.m.t);
      ctx.lineTo(surf.sx(0), surf.m.t + surf.ih);
      ctx.stroke();
      ctx.restore();

      pts.forEach(function (p) {
        var predReal = p.s > 0;
        var isReal = p.f.c === 0;
        var wrong = predReal !== isReal;
        ctx.beginPath();
        ctx.arc(surf.sx(p.s), surf.sy(p.k + 0.6), p === hover ? 5.5 : 3.6, 0, 6.2832);
        ctx.fillStyle = isReal ? css('--real') : css('--ai');
        ctx.globalAlpha = p === hover ? 1 : 0.85;
        ctx.fill();
        if (wrong) {
          ctx.globalAlpha = 1;
          ctx.lineWidth = 1.6;
          ctx.strokeStyle = css('--ink');
          ctx.stroke();
        }
      });
      ctx.globalAlpha = 1;
    }

    function nearest(mx, my) {
      var best = null, bd = 14 * 14;
      pts.forEach(function (p) {
        var dx = surf.sx(p.s) - mx, dy = surf.sy(p.k + 0.6) - my, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = p; }
      });
      return best;
    }

    canvas.addEventListener('mousemove', function (e) {
      var r = canvas.getBoundingClientRect();
      var mx = e.clientX - r.left, my = e.clientY - r.top;
      var p = nearest(mx, my);
      if (p !== hover) { hover = p; draw(); }
      if (p) {
        var predReal = p.s > 0, isReal = p.f.c === 0;
        tip.show('<img src="' + figSrc(p.f, false) + '" alt="">' +
          '<span class="tip-k">' + (isReal ? 'Real' : 'Generated') + '</span>' +
          '<dl><dt>score</dt><dd>' + fmt(p.s, 2) + '</dd>' +
          '<dt>called</dt><dd>' + (predReal ? 'real' : 'generated') + '</dd>' +
          '<dt>verdict</dt><dd>' + (predReal === isReal ? 'hit' : 'miss') + '</dd></dl>', mx, my);
      } else tip.hide();
    });
    canvas.addEventListener('mouseleave', function () { hover = null; tip.hide(); draw(); });
    canvas.addEventListener('click', function (e) {
      var r = canvas.getBoundingClientRect();
      var p = nearest(e.clientX - r.left, e.clientY - r.top);
      if (p) openLightbox(figSrc(p.f, true), p.f.n);
    });
    window.addEventListener('resize', function () { surf.resize(); draw(); });
    draw();
  }

  // ------------------------------------------------- 4. metric explorer

  var METRICS = {
    clip: { key: 'clip', label: 'CLIP caption agreement', hint: 'cosine similarity between the figure and its own caption' },
    cplx: { key: 'cplx', label: 'Structural complexity', hint: 'edge/contour density of the rendered panel' },
    gib:  { key: 'gib',  label: 'Gibberish ratio', hint: 'share of OCR-recovered tokens that are not words' },
    rep:  { key: 'rep',  label: 'Repetition count', hint: 'duplicated glyph runs detected in the panel' }
  };

  function initMetrics() {
    var host = $('#metric-explorer');
    if (!host || !D) return;
    var canvas = $('canvas', host);
    var tip = new Tip($('.chart-holder', host));
    var pts = D.figures.filter(function (f) { return f.c === 1 && f.clip != null; });
    var xk = 'gib', yk = 'clip', hover = null, surf;

    function build() {
      surf = new Surface(canvas, {
        domain: {
          x: extent(pts, function (d) { return d[xk]; }),
          y: extent(pts, function (d) { return d[yk]; })
        },
        height: Math.min(460, Math.max(320, window.innerHeight * 0.46)),
        margin: { t: 14, r: 14, b: 40, l: 52 }
      });
    }

    function draw() {
      surf.clear();
      surf.axes(METRICS[xk].label, METRICS[yk].label);
      var ctx = surf.ctx;
      pts.forEach(function (p) {
        ctx.beginPath();
        ctx.arc(surf.sx(p[xk]), surf.sy(p[yk]), p === hover ? 6.5 : 4.2, 0, 6.2832);
        ctx.fillStyle = css('--ai');
        ctx.globalAlpha = p === hover ? 1 : 0.62;
        ctx.fill();
        if (p === hover) {
          ctx.lineWidth = 2; ctx.strokeStyle = css('--bg-raised'); ctx.globalAlpha = 1; ctx.stroke();
        }
      });
      ctx.globalAlpha = 1;
      // correlation readout
      var rr = pearson(pts.map(function (p) { return p[xk]; }), pts.map(function (p) { return p[yk]; }));
      var out = $('.metric-r', host);
      if (out) out.innerHTML = 'Pearson <span class="mono">r = ' + fmt(rr, 2) + '</span> across ' + pts.length + ' generated figures';
    }

    function pearson(a, b) {
      var n = a.length, ma = 0, mb = 0, i;
      for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
      ma /= n; mb /= n;
      var num = 0, da = 0, db = 0;
      for (i = 0; i < n; i++) {
        var u = a[i] - ma, v = b[i] - mb;
        num += u * v; da += u * u; db += v * v;
      }
      return num / Math.sqrt(da * db || 1);
    }

    function nearest(mx, my) {
      var best = null, bd = 16 * 16;
      pts.forEach(function (p) {
        var dx = surf.sx(p[xk]) - mx, dy = surf.sy(p[yk]) - my, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = p; }
      });
      return best;
    }

    canvas.addEventListener('mousemove', function (e) {
      var r = canvas.getBoundingClientRect();
      var mx = e.clientX - r.left, my = e.clientY - r.top;
      var p = nearest(mx, my);
      if (p !== hover) { hover = p; draw(); }
      if (p) {
        tip.show('<img src="' + figSrc(p, false) + '" alt="">' +
          '<span class="tip-k">' + p.n + '</span>' +
          '<dl><dt>caption fit</dt><dd>' + fmt(p.clip, 3) + '</dd>' +
          '<dt>complexity</dt><dd>' + fmt(p.cplx, 1) + '</dd>' +
          '<dt>gibberish</dt><dd>' + fmt(p.gib, 3) + '</dd>' +
          '<dt>repetition</dt><dd>' + p.rep + '</dd></dl>', mx, my);
      } else tip.hide();
    });
    canvas.addEventListener('mouseleave', function () { hover = null; tip.hide(); draw(); });
    canvas.addEventListener('click', function (e) {
      var r = canvas.getBoundingClientRect();
      var p = nearest(e.clientX - r.left, e.clientY - r.top);
      if (p) openLightbox(figSrc(p, true), p.n);
    });

    $$('select', host).forEach(function (s) {
      Object.keys(METRICS).forEach(function (k) {
        var o = el('option', null, METRICS[k].label);
        o.value = k;
        s.appendChild(o);
      });
      s.value = s.getAttribute('data-axis') === 'x' ? xk : yk;
      s.addEventListener('change', function () {
        if (s.getAttribute('data-axis') === 'x') xk = s.value; else yk = s.value;
        build(); draw();
      });
    });

    window.addEventListener('resize', function () { build(); draw(); });
    build(); draw();
  }

  // ------------------------------------------------- 5. bar lists

  function bars(hostSel, rows, opts) {
    var host = $(hostSel);
    if (!host) return;
    opts = opts || {};
    var max = Math.max.apply(null, rows.map(function (r) { return r.v; }));
    host.innerHTML = '';
    rows.forEach(function (r) {
      var row = el('div', 'bar-row');
      row.appendChild(el('div', 'bar-lab', r.label));
      var track = el('div', 'bar-track');
      var fill = el('div', 'bar-fill' + (r.kind ? ' ' + r.kind : ''));
      fill.style.width = (100 * r.v / max) + '%';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('div', 'bar-val', opts.fmt ? opts.fmt(r) : String(r.v)));
      host.appendChild(row);
    });
  }

  function initBars() {
    if (!D) return;
    bars('#aff-bars', D.affiliations.rows.map(function (r) {
      return { label: r.name, v: r.n, kind: r.kind };
    }), { fmt: function (r) { return r.v + '  (' + fmt(D.affiliations.rows.filter(function (x) { return x.name === r.label; })[0].pct_aff, 1) + '%)'; } });

    bars('#struct-bars', D.structure.map(function (r) {
      return { label: r.name, v: r.pct, kind: r.name === 'All features present' ? 'real' : 'fake' };
    }), { fmt: function (r) { return r.v + '%'; } });

    bars('#surname-bars', D.names.last.slice(0, 10).map(function (p) {
      return { label: p[0], v: p[1] };
    }), { fmt: function (r) { return r.v; } });

    bars('#cluster-bars', D.clusters.map(function (c) {
      return { label: c.name, v: c.n, kind: 'real' };
    }), { fmt: function (r) { return r.v + ' papers'; } });

    bars('#pixel-bars', D.pixel.rows.slice().sort(function (a, b) { return b.auc - a.auc; })
      .map(function (r) {
        return { label: r.label, v: (r.auc - 0.5) * 200, kind: 'none', auc: r.auc };
      }), { fmt: function (r) { return 'AUC ' + fmt(r.auc, 3); } });

    var maxAcc = 1;
    bars('#ablation-bars', D.ablation.map(function (a) {
      return { label: a.name, v: a.acc / maxAcc * 100, kind: a.kind === 'none' ? 'none' : (a.kind === 'pixel' ? 'mutated' : 'real'), acc: a.acc };
    }), { fmt: function (r) { return fmt(r.acc * 100, 1) + '%'; } });
  }

  // ------------------------------------------------- 6. paper explorer

  function initPapers() {
    var host = $('#paper-explorer');
    if (!host || !D) return;
    var grid = $('.paper-grid', host);
    var detail = $('.paper-detail', host);
    var filter = 'all';
    var sel = null;

    var CLUSTER_NAME = {};
    D.clusters.forEach(function (c) { CLUSTER_NAME[c.id] = c.name; });

    function flags(p) {
      var s = (p.struct || '').toLowerCase();
      var out = [];
      if (!p.title || p.title === 'None') out.push('no title');
      if (/missing/.test(s)) {
        if (/affil/.test(s)) out.push('no affiliations');
        if (/ref/.test(s)) out.push('no references');
      }
      if (!p.refs) out.push('no references');
      return out.filter(function (v, i, a) { return a.indexOf(v) === i; });
    }

    function match(p) {
      if (filter === 'all') return true;
      if (filter === 'broken') return flags(p).length > 0;
      if (filter === 'clean') return flags(p).length === 0;
      return String(p.cluster) === filter;
    }

    D.papers.forEach(function (p) {
      var b = el('button', 'paper-cell');
      b.type = 'button';
      var img = el('img');
      img.src = THUMB.paper + p.f.replace(/\.png$/i, '.jpg');
      img.alt = p.title || 'Untitled generated paper ' + p.f;
      img.loading = 'lazy';
      b.appendChild(img);
      b.addEventListener('click', function () { select(p, b); });
      p._node = b;
      grid.appendChild(b);
    });

    function applyFilter() {
      D.papers.forEach(function (p) { p._node.classList.toggle('dim', !match(p)); });
    }

    function select(p, node) {
      $$('.paper-cell', grid).forEach(function (n) { n.classList.remove('sel'); });
      node.classList.add('sel');
      sel = p;
      var f = flags(p);
      var affLines = (p.aff || '—').split('\n').join('\n');
      detail.innerHTML = '';
      var left = el('div');
      var im = el('img', 'page');
      im.src = FULL.paper + p.f.replace(/\.png$/i, '.jpg');
      im.alt = p.title || 'Generated paper page';
      im.style.cursor = 'zoom-in';
      im.addEventListener('click', function () { openLightbox(im.src, im.alt); });
      left.appendChild(im);
      detail.appendChild(left);

      var right = el('div', 'paper-meta');
      var h = el('h4', null, p.title && p.title !== 'None' ? p.title : '(no title on the page)');
      right.appendChild(h);
      var tags = el('div', 'tagset');
      tags.appendChild(el('span', 'tag', CLUSTER_NAME[p.cluster] || p.topic || 'unclustered'));
      if (!f.length) tags.appendChild(el('span', 'tag ok', 'structurally complete'));
      f.forEach(function (x) { tags.appendChild(el('span', 'tag bad', x)); });
      right.appendChild(tags);

      var dl = el('dl', 'kv');
      function kv(k, v) {
        dl.appendChild(el('dt', null, k));
        dl.appendChild(el('dd', null, v || '—'));
      }
      kv('file', p.f);
      kv('authors', p.authors);
      kv('affiliations', affLines);
      if (p.closest) kv('nearest real paper', p.closest);
      right.appendChild(dl);

      if (p.abstract) {
        right.appendChild(el('h4', null, 'What the page actually says'));
        right.appendChild(el('div', 'excerpt', p.abstract));
      }
      if (p.refs) {
        right.appendChild(el('h4', null, 'Its reference list'));
        right.appendChild(el('div', 'excerpt', p.refs));
      }
      detail.appendChild(right);
    }

    $$('[data-filter]', host).forEach(function (b) {
      b.addEventListener('click', function () {
        filter = b.getAttribute('data-filter');
        $$('[data-filter]', host).forEach(function (o) {
          o.setAttribute('aria-pressed', String(o === b));
        });
        applyFilter();
      });
    });

    select(D.papers[0], D.papers[0]._node);
  }

  // ------------------------------------------------- 7. number injection

  function fillNumbers() {
    if (!D) return;
    var vals = {
      'papers': D.counts.papers,
      'gen-figs': D.counts.gen_figs,
      'real-figs': D.counts.real_figs,
      'total-figs': D.counts.gen_figs + D.counts.real_figs,
      'authors': D.affiliations.total_authors,
      'affiliations': D.affiliations.total_affiliations,
      'knn-same': D.knn.same_pct + '%',
      'knn-gen': D.knn.gen_pct + '%',
      'knn-real': D.knn.real_pct + '%',
      'knn-edges': D.knn.edges,
      'lda-acc': Math.round(D.lda.loo2 * 1000) / 10 + '%',
      'lda-pc1': Math.round(D.lda.loo_pc1 * 1000) / 10 + '%',
      'lda-base': Math.round(D.lda.baseline * 1000) / 10 + '%',
      'lda-miss': D.lda.scores.filter(function (s, i) {
        return (s > 0) !== (D.figures[i].c === 0);
      }).length,
      'sim-g2g': fmt(D.clip_sim.g2g, 3),
      'sim-r2r': fmt(D.clip_sim.r2r, 3),
      'sim-g2r': fmt(D.clip_sim.g2r, 3),
      'gib-mean': fmt(D.metric_summary.gib.mean, 3),
      'gib-max': fmt(D.metric_summary.gib.max, 3),
      'clip-mean': fmt(D.metric_summary.clip.mean, 3),
      'clip-min': fmt(D.metric_summary.clip.min, 3),
      'cplx-mean': fmt(D.metric_summary.cplx.mean, 1),
      'hall-pct': fmt(D.affiliations.rows[0].pct_auth, 1) + '%',
      'mut-pct': fmt(D.affiliations.rows[1].pct_auth, 1) + '%',
      'notitle': D.papers.filter(function (p) { return !p.title || p.title === 'None'; }).length,
      'pixel-acc': fmt(D.ablation[1].acc * 100, 1) + '%',
      'both-acc': fmt(D.ablation[4].acc * 100, 1) + '%',
      'pixel-best-auc': fmt(Math.max.apply(null, D.pixel.rows.map(function (r) { return r.auc; })), 3)
    };
    $$('[data-n]').forEach(function (n) {
      var k = n.getAttribute('data-n');
      if (vals[k] != null) n.textContent = vals[k];
    });
  }

  // ------------------------------------------------- reading progress

  function initProgress() {
    var bar = el('div', 'progress');
    document.body.appendChild(bar);
    var ticking = false;
    function update() {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = (h > 0 ? Math.min(100, 100 * window.scrollY / h) : 0) + '%';
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  // ------------------------------------------------- boot

  function boot() {
    fillNumbers();
    initQuiz();
    initMap();
    initDiscriminant();
    initMetrics();
    initBars();
    initPapers();
  }

  initProgress();   // chrome that doesn't depend on the data bundle

  fetch('static/data/arxaiv.json')
    .then(function (r) { return r.json(); })
    .then(function (json) { D = json; boot(); })
    .catch(function (err) {
      console.error('arxAIv: could not load data bundle', err);
      $$('.needs-data').forEach(function (n) {
        n.innerHTML = '<p class="dek">This interactive needs <code>static/data/arxaiv.json</code>, ' +
          'which could not be loaded. If you opened this file directly from disk, serve the folder ' +
          'over HTTP instead (<code>python3 -m http.server</code>).</p>';
      });
    });
})();

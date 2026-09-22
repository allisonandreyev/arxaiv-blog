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
  function group(v) { return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  /* Normal quantile (Acklam's rational approximation, |error| < 1.2e-9). Needed to turn a
     multiple-comparison-corrected alpha into a critical |r|, so the noise band the explorer
     draws stays correct if the metric list ever changes length. */
  function zQuantile(p) {
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];
    var pl = 0.02425, q, r;
    if (p < pl) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
             ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - pl) return -zQuantile(1 - p);
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
           (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

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

  /* Third argument is optional: { rel, raw, base, ramp, G } from an occlusion row. When
     present, the lightbox crops to the same square the encoder sees (object-fit: cover on
     a 1:1 frame, exactly like .occ-frame) and overlays the same 7x7 patch grid, scaled up,
     instead of dropping it -- so a click zooms the patches in rather than away. */
  var lightbox, lightboxMedia, lightboxGrid, lightboxTip;
  function openLightbox(src, alt, patches) {
    if (!lightbox) {
      lightbox = el('div', 'lightbox');
      lightboxMedia = el('div', 'lightbox-media');
      var img = el('img');
      lightboxGrid = el('div', 'lightbox-grid');
      var close = el('button', 'lightbox-close', '×');
      close.setAttribute('aria-label', 'Close');
      lightboxMedia.appendChild(img);
      lightboxMedia.appendChild(lightboxGrid);
      lightbox.appendChild(lightboxMedia);
      lightbox.appendChild(close);
      document.body.appendChild(lightbox);
      lightboxTip = new Tip(lightboxMedia);
      lightbox.addEventListener('click', function () {
        lightbox.classList.remove('open');
        lightboxTip.hide();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { lightbox.classList.remove('open'); lightboxTip.hide(); }
      });
    }
    var im = $('img', lightbox);
    im.src = src; im.alt = alt || '';
    lightboxGrid.innerHTML = '';
    lightboxMedia.classList.toggle('has-grid', !!patches);
    if (patches) {
      patches.rel.forEach(function (v, i) {
        var cell = el('i');
        var k = patches.ramp(v);
        cell.style.background = k.fill;
        cell.style.opacity = k.alpha.toFixed(3);
        cell.addEventListener('mousemove', function (e) {
          var b = lightboxMedia.getBoundingClientRect();
          lightboxTip.show('<span class="tip-k">tile ' + ((i / patches.G | 0) + 1) + ',' +
            (i % patches.G + 1) + '</span>' + fmt(v, 3) +
            ' against this figure\'s average tile — hiding it argues <b>' +
            (v > 0 ? 'generated' : 'real') + '</b>' +
            '<br><span style="opacity:.65">raw ' + fmt(patches.raw[i], 3) +
            ', baseline ' + fmt(patches.base, 3) + '</span>',
            e.clientX - b.left, e.clientY - b.top);
        });
        cell.addEventListener('mouseleave', function () { lightboxTip.hide(); });
        lightboxGrid.appendChild(cell);
      });
    }
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
      // gray background halves
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
    gib:  { key: 'gib',  label: 'Gibberish ratio', hint: 'share of raw-OCR tokens that are not words' },
    tok:  { key: 'tok',  label: 'OCR tokens recovered', hint: 'how many tokens OCR found at all — the gibberish ratio\u2019s denominator' },
    rep:  { key: 'rep',  label: 'Repetition count', hint: 'duplicated glyph runs detected in the panel' }
  };
  // Distinct unordered pairings the explorer lets you flip through. Drives the
  // multiple-comparison correction in initMetrics(), so it must stay derived, not typed.
  var PAIRS = (function (k) { return k * (k - 1) / 2; })(Object.keys(METRICS).length);

  function initMetrics() {
    var host = $('#metric-explorer');
    if (!host || !D) return;
    var canvas = $('canvas', host);
    var tip = new Tip($('.chart-holder', host));
    var all = D.figures.filter(function (f) { return f.c === 1 && f.clip != null; });
    var pts = all, xk = 'tok', yk = 'gib', hover = null, surf;

    // A figure whose OCR recovered nothing has no gibberish ratio — the denominator is zero.
    // Dropping those six silently would hide the most degraded figures in the corpus, so they
    // are excluded from the plot only when an axis needs them, and counted out loud below it.
    function repoint() {
      pts = all.filter(function (f) { return f[xk] != null && f[yk] != null; });
    }

    function build() {
      repoint();
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
      var fit = lsq(pts.map(function (p) { return p[xk]; }), pts.map(function (p) { return p[yk]; }));

      // Best straight-line fit, drawn first so the points sit on top of it. This is the
      // line Pearson r is describing — without it, r is a number with nothing to point at.
      ctx.save();
      ctx.beginPath();
      ctx.rect(surf.m.l, surf.m.t, surf.iw, surf.ih);
      ctx.clip();
      ctx.beginPath();
      ctx.moveTo(surf.sx(surf.dom.x[0]), surf.sy(fit.at(surf.dom.x[0])));
      ctx.lineTo(surf.sx(surf.dom.x[1]), surf.sy(fit.at(surf.dom.x[1])));
      ctx.strokeStyle = css('--ink-faint');
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.globalAlpha = 0.85;
      ctx.stroke();
      ctx.restore();

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

      // correlation readout + a plain-language reading of it
      var out = $('.metric-r', host);
      if (out) {
        out.innerHTML = 'Pearson <span class="mono">r = ' + fmt(fit.r, 2) + '</span>' +
          ' · <span class="mono">r&sup2; = ' + fmt(fit.r * fit.r, 2) + '</span>';
      }
      drawMeter(fit, pts.length);
      var gl = $('.metric-gloss', host);
      if (gl) {
        var dropped = all.length - pts.length;
        gl.innerHTML = gloss(fit, pts.length) + (dropped
          ? ' <b>' + dropped + ' of ' + all.length + ' figures are not plotted here</b>, because OCR ' +
            'recovered no tokens from them at all and the ratio has no denominator. They are the ' +
            'most degraded figures in the corpus, and this metric cannot see them.'
          : '');
      }
    }

    // Least-squares fit plus the correlation coefficient, from one pass over the data.
    function lsq(a, b) {
      var n = a.length, ma = 0, mb = 0, i;
      for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
      ma /= n; mb /= n;
      var num = 0, da = 0, db = 0;
      for (i = 0; i < n; i++) {
        var u = a[i] - ma, v = b[i] - mb;
        num += u * v; da += u * u; db += v * v;
      }
      var slope = num / (da || 1);
      return {
        r: num / Math.sqrt(da * db || 1),
        slope: slope,
        at: function (x) { return mb + slope * (x - ma); }
      };
    }

    // Lowercase a metric label for mid-sentence use, but leave a leading acronym alone
    // so "CLIP caption agreement" does not come out as "clip caption agreement".
    function lcLabel(s) {
      var first = s.split(' ')[0];
      return first === first.toUpperCase() && first.length > 1
        ? s
        : s.charAt(0).toLowerCase() + s.slice(1);
    }

    // Puts the coefficient in words. Beginners read "r = -0.13" as "there is a relationship";
    // the job of this line is to gate that reading on whether it clears the noise band first.
    function bands(n) {
      // Two noise floors. The first is the textbook 95% band for a SINGLE test. But this panel
      // lets you flip through every pairing of the metric list looking for the interesting one,
      // which is exactly the behavior that inflates false positives -- with PAIRS comparisons
      // the chance of at least one spurious hit is 1 - 0.95^PAIRS, not 5%. The second band
      // divides alpha by the number of comparisons (Bonferroni) and is the one the verdict uses.
      var df = Math.sqrt(Math.max(n - 1, 2));
      return {
        single: 1.96 / df,
        family: zQuantile(1 - 0.05 / (2 * PAIRS)) / df,
        anyHit: 1 - Math.pow(0.95, PAIRS)
      };
    }

    function gloss(fit, n) {
      var r = fit.r, a = Math.abs(r);
      var xl = lcLabel(METRICS[xk].label), yl = lcLabel(METRICS[yk].label);
      var bd = bands(n), crit = bd.family;
      var pct = Math.round(r * r * 100);
      var line = ' The dashed line is the best straight fit through all ' + n + ' points, and ' +
        '<span class="mono">r&sup2; = ' + fmt(r * r, 2) + '</span> means ' + xl + ' accounts for ' +
        pct + '% of the variation in ' + yl + '.';
      var caveat = ' Pearson r only sees straight lines \u2014 a curved or clumped relationship can ' +
        'still score near zero.';
      var multi = ' The band above is corrected for the fact that this panel offers <b>' + PAIRS +
        '</b> pairings: judged one at a time you would use <span class="mono">|r| \u2248 ' +
        fmt(bd.single, 2) + '</span>, but flipping through all ' + PAIRS +
        ' at that threshold gives roughly a <b>' + Math.round(bd.anyHit * 100) +
        '%</b> chance of at least one spurious hit, so the floor moves to <span class="mono">|r| ' +
        '\u2248 ' + fmt(bd.family, 2) + '</span>.';
      var lead;
      if (a < crit) {
        lead = '<b>Inside the noise.</b> At <span class="mono">n = ' + n + '</span>, coefficients ' +
          'under <span class="mono">|r| \u2248 ' + fmt(crit, 2) + '</span> turn up routinely when ' +
          'there is no relationship at all, so <span class="mono">r = ' + fmt(r, 2) + '</span> is ' +
          'not evidence that ' + xl + ' and ' + yl + ' are related.';
      } else {
        var strength = a < 0.3 ? 'weak' : a < 0.5 ? 'moderate' : a < 0.7 ? 'strong' : 'very strong';
        lead = '<b>A ' + strength + ' ' + (r >= 0 ? 'positive' : 'negative') + ' trend.</b> As ' +
          xl + ' goes up, ' + yl + ' tends to ' + (r >= 0 ? 'rise' : 'fall') + '. That clears the ' +
          '<span class="mono">|r| \u2248 ' + fmt(crit, 2) + '</span> band you would expect from ' +
          'noise alone at <span class="mono">n = ' + n + '</span>.';
      }
      return lead + line + caveat + multi;
    }

    /* A visual callout for r: where this coefficient falls against the two noise bands.
       The number alone tells a beginner nothing about whether it is big. */
    function drawMeter(fit, n) {
      var host2 = $('.rmeter', host);
      if (!host2) return;
      var bd = bands(n), r = fit.r;
      var pos = function (v) { return ((v + 1) / 2 * 100).toFixed(2) + '%'; };
      var w = function (v) { return (v / 2 * 100).toFixed(2) + '%'; };
      host2.innerHTML =
        '<div class="rmeter-track">' +
          '<i class="rm-band rm-family" style="left:' + pos(-bd.family) + ';width:' +
            w(2 * bd.family) + '"></i>' +
          '<i class="rm-band rm-single" style="left:' + pos(-bd.single) + ';width:' +
            w(2 * bd.single) + '"></i>' +
          '<i class="rm-zero" style="left:50%"></i>' +
          '<i class="rm-mark' + (Math.abs(r) < bd.family ? ' is-noise' : '') +
            '" style="left:' + pos(r) + '"></i>' +
        '</div>' +
        '<div class="rmeter-scale"><span>\u22121</span><span>0</span><span>+1</span></div>' +
        '<div class="rmeter-key">shaded = coefficients this corpus produces by chance ' +
          '(<span class="rm-sw rm-single"></span> one test, ' +
          '<span class="rm-sw rm-family"></span> corrected for ' + PAIRS + ' pairings) \u00b7 ' +
          '<span class="rm-sw rm-mark"></span> r = ' + fmt(r, 2) + '</div>';
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
    var textMode = 'corrected';        // 'corrected' | 'raw', persists across selections

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

      /* The text below is LLM-corrected, which only ever makes the page look better than its
         pixels are. tools/page_ocr.py re-OCRs the same page image and ships what the corrector
         was working from, so the gap is visible on all 100 pages rather than asserted once. */
      var raw = PAGEOCR && PAGEOCR.pages[p.f];
      if (p.abstract || raw) {
        var head = el('div', 'excerpt-head');
        head.appendChild(el('h4', null, 'What the page says'));
        if (raw && raw.raw) {
          var grp = el('span', 'controls');
          [['corrected', 'LLM-corrected'], ['raw', 'raw OCR']].forEach(function (o) {
            var b = el('button', 'btn', o[1]);
            b.type = 'button';
            b.setAttribute('aria-pressed', String(textMode === o[0]));
            b.addEventListener('click', function () {
              textMode = o[0];
              select(p, p._node);
            });
            grp.appendChild(b);
          });
          head.appendChild(grp);
        }
        right.appendChild(head);

        if (textMode === 'raw' && raw && raw.raw) {
          right.appendChild(el('div', 'excerpt is-raw', raw.raw));
          var note = el('p', 'dek');
          note.style.marginTop = '.4rem';
          note.textContent = 'Straight out of tesseract, nothing cleaned up. ' +
            raw.tokens + ' word tokens, ' +
            (raw.rate != null ? fmt(raw.rate * 100, 0) + '% of them in a dictionary' : 'rate undefined') +
            (raw.conf != null ? ', mean confidence ' + fmt(raw.conf, 0) : '') + '.';
          right.appendChild(note);
        } else if (p.abstract) {
          right.appendChild(el('div', 'excerpt', p.abstract));
          if (p.refs) {
            right.appendChild(el('h4', null, 'Its reference list'));
            right.appendChild(el('div', 'excerpt', p.refs));
          }
          if (raw && raw.corr_rate != null && raw.rate != null) {
            var g = el('p', 'dek');
            g.style.marginTop = '.4rem';
            g.innerHTML = 'Dictionary-word rate <b>' + fmt(raw.corr_rate * 100, 0) +
              '%</b> here against <b>' + fmt(raw.rate * 100, 0) +
              '%</b> in the raw OCR of the same page. Switch above to see what was corrected.';
            right.appendChild(g);
          }
        }
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

  // ------------------------------------------------- 5b. permutation nulls

  /* Two null distributions, drawn from the count-per-correct histograms in the bundle.
     Accuracies are k/269, so the nulls are stored as a 270-long tally rather than 2,000
     floats. The point of drawing them together is the offset between them: the width rule
     searches 269 cut points, so its null starts at the majority baseline instead of 0.5. */
  function initPermTest() {
    var host = $('#permtest');
    if (!host || !D || !D.lda.perm || !D.lda.perm.hist) return;
    var canvas = $('canvas', host);
    var N = D.lda.perm.n || (D.counts.gen_figs + D.counts.real_figs);

    var series = [
      { hist: D.lda.perm.hist, obs: D.lda.loo2, color: '--accent',
        label: 'discriminant', tag: 'PC\u2081 + PC\u2082' },
      { hist: D.provenance.perm.hist, obs: D.provenance.width_acc, color: '--ink-faint',
        label: 'width threshold', tag: 'image width' }
    ];

    // Bin the k/N tallies into fixed 1-point-wide bins, then scale each curve to its own peak.
    // The width rule's null is five times taller than the discriminant's because it is five times
    // narrower -- on a shared count axis the broad curve would flatten into the baseline and the
    // comparison that matters, where each null SITS, would be the hardest thing to see.
    var NB = 100;
    series.forEach(function (sr) {
      var b = new Array(NB); for (var i = 0; i < NB; i++) b[i] = 0;
      sr.hist.forEach(function (count, k) {
        if (!count) return;
        b[Math.min(NB - 1, Math.floor(k / N * NB))] += count;
      });
      var mx = Math.max.apply(null, b) || 1;
      sr.bins = b.map(function (v) { return v / mx; });
    });

    var surf = new Surface(canvas, {
      domain: { x: [0, 1], y: [0, 1.28] },
      height: 250,
      margin: { t: 34, r: 16, b: 40, l: 50 }
    });

    function draw() {
      surf.clear();
      var ctx = surf.ctx, i;
      surf.axes('leave-one-out accuracy under shuffled labels', 'shuffles (each to its own peak)');

      series.forEach(function (sr) {
        var col = css(sr.color);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(surf.sx(0), surf.sy(0));
        for (i = 0; i < NB; i++) {
          var x0 = surf.sx(i / NB), x1 = surf.sx((i + 1) / NB), yv = surf.sy(sr.bins[i]);
          ctx.lineTo(x0, yv); ctx.lineTo(x1, yv);
        }
        ctx.lineTo(surf.sx(1), surf.sy(0));
        ctx.closePath();
        ctx.fillStyle = col; ctx.globalAlpha = 0.28; ctx.fill();
        ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.stroke();
        ctx.restore();
      });

      // observed values, marked where they actually fall
      ctx.save();
      ctx.font = '600 11px ' + css('--sans').split(',')[0].replace(/"/g, '') + ', sans-serif';
      series.forEach(function (sr, k) {
        var px = surf.sx(sr.obs), col = css(sr.color);
        ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(px, surf.m.t + (k ? 14 : 0)); ctx.lineTo(px, surf.m.t + surf.ih); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = col;
        ctx.textAlign = px > surf.m.l + surf.iw * 0.72 ? 'right' : 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(sr.tag + ' \u2014 ' + fmt(sr.obs * 100, 1) + '%',
          px + (ctx.textAlign === 'right' ? -6 : 6), surf.m.t + (k ? 16 : 2));
      });
      ctx.restore();
    }

    draw();
    window.addEventListener('resize', function () { surf.resize(); draw(); });
  }

  // ------------------------------------------------- 6b. occlusion maps

  /* Signed 7x7 patch-occlusion maps (tools/occlusion.py). Each row carries the figure's
     unoccluded discriminant score and 49 raw deltas: how far the score moved when that one
     32-pixel tile was replaced with the encoder's mean color.

     The raw deltas are NOT what gets painted. Hiding any tile at all drags the score toward
     "generated" -- the corpus mean delta is about -0.20, and 78% of all 13,181 deltas are
     negative -- because removing information moves the embedding in a consistent direction
     regardless of what was removed. Left uncorrected, every map would read as one solid blue
     wash and the occlusion would be measuring its own artifact. So each figure's 49 deltas are
     centered on that figure's own mean before they are colored, which asks the question that
     was actually interesting: not "did hiding this tile move the score" (it always does) but
     "did hiding THIS tile move it more, or less, than hiding an average tile of this figure".
     After centering the signs split almost exactly evenly, which is what a corrected measure
     should do. The raw value and the figure's baseline are both in the tooltip. */
  var OCC = null;
  var PAGEOCR = null;
  var MASKABL = null;                // static/data/text_ablation.json, section 6                // static/data/page_ocr.json, loaded lazily for section 8

  function initOcclusion() {
    var host = $('#occlusion');
    if (!host) return;
    var stage = $('.occ-stage', host);
    var btns = $$('[data-occ]', host);
    var G = 7, SHOWN = 6, mode = 'gen', shuffleSeed = 1;

    function fail(msg) {
      host.innerHTML = '<p class="dek">' + msg + '</p>';
    }

    // Center each figure on its own mean delta (see the note above), then scale the color
    // ramp to the corpus-wide 98th percentile of |centered delta| rather than to each figure's
    // own maximum -- otherwise a figure the classifier barely cares about would look just as
    // decisive as one it does.
    var scale = 1;
    function prepare() {
      var all = [];
      OCC.rows.forEach(function (r) {
        var mean = 0, i;
        for (i = 0; i < r.d.length; i++) mean += r.d[i];
        mean /= r.d.length;
        r.base = mean;
        r.rel = r.d.map(function (v) { return v - mean; });
        r.rel.forEach(function (v) { all.push(Math.abs(v)); });
      });
      all.sort(function (a, b) { return a - b; });
      scale = all[Math.floor(all.length * 0.98)] || 1;
    }

    function verdict(r) { return r.s > 0 ? 'real' : 'generated'; }
    function truth(r) { return r.c === 1 ? 'generated' : 'real'; }
    function correct(r) { return verdict(r) === truth(r); }

    function pick() {
      var rows = OCC.rows.slice();
      if (mode === 'gen') {
        rows = rows.filter(function (r) { return r.c === 1 && correct(r); })
                   .sort(function (a, b) { return a.s - b.s; });
      } else if (mode === 'real') {
        rows = rows.filter(function (r) { return r.c === 0 && correct(r); })
                   .sort(function (a, b) { return b.s - a.s; });
      } else if (mode === 'miss') {
        rows = rows.filter(function (r) { return !correct(r); })
                   .sort(function (a, b) { return Math.abs(b.s) - Math.abs(a.s); });
      } else {
        var rand = rng(shuffleSeed);
        rows.sort(function () { return rand() - 0.5; });
      }
      return rows.slice(0, SHOWN);
    }

    function ramp(v) {
      // v > 0: hiding this tile moved the score toward "real", so the tile argued
      // "generated" -- paint it with the generated color, and vice versa.
      var t = Math.max(-1, Math.min(1, v / scale));
      var c = t > 0 ? css('--real') : css('--ai');
      return { fill: c, alpha: Math.pow(Math.abs(t), 0.7) * 0.72 };
    }

    function render() {
      stage.innerHTML = '';
      var tip = new Tip(stage);
      pick().forEach(function (r) {
        var card = el('figure', 'occ-card');
        var frame = el('div', 'occ-frame');
        var img = el('img');
        img.src = figSrc(r, false);
        img.alt = (r.c === 1 ? 'Generated' : 'Real') + ' figure ' + r.n;
        img.loading = 'lazy';
        frame.appendChild(img);

        var grid = el('div', 'occ-grid');
        r.rel.forEach(function (v, i) {
          var cell = el('i');
          var k = ramp(v);
          cell.style.background = k.fill;
          cell.style.opacity = k.alpha.toFixed(3);
          cell.addEventListener('mousemove', function (e) {
            var b = stage.getBoundingClientRect();
            tip.show('<span class="tip-k">tile ' + ((i / G | 0) + 1) + ',' + (i % G + 1) +
              '</span>' + fmt(v, 3) + ' against this figure\'s average tile — hiding it argues <b>' +
              (v > 0 ? 'generated' : 'real') + '</b>' +
              '<br><span style="opacity:.65">raw ' + fmt(r.d[i], 3) +
              ', baseline ' + fmt(r.base, 3) + '</span>',
              e.clientX - b.left, e.clientY - b.top);
          });
          cell.addEventListener('mouseleave', function () { tip.hide(); });
          grid.appendChild(cell);
        });
        frame.appendChild(grid);
        frame.addEventListener('click', function () {
          openLightbox(figSrc(r, true), img.alt,
            { rel: r.rel, raw: r.d, base: r.base, ramp: ramp, G: G });
        });
        card.appendChild(frame);

        var cap = el('figcaption');
        cap.innerHTML = '<b class="' + (r.c === 1 ? 'gen' : 'rl') + '">' +
          (r.c === 1 ? 'generated' : 'real') + '</b> · score ' + fmt(r.s, 2) +
          ' · called <b>' + verdict(r) + '</b>' +
          (correct(r) ? '' : ' <span class="occ-miss">✕ wrong</span>');
        card.appendChild(cap);
        stage.appendChild(card);
      });
    }

    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.getAttribute('data-occ') === 'shuffle' && mode === 'shuffle') shuffleSeed++;
        mode = b.getAttribute('data-occ');
        btns.forEach(function (o) {
          o.setAttribute('aria-pressed', String(o === b));
        });
        render();
      });
    });

    fetch('static/data/occlusion.json')
      .then(function (r) { return r.json(); })
      .then(function (json) {
        OCC = json;
        // Rows are keyed by filename and class, the same pair figSrc() resolves against.
        prepare();
        fillOccNumbers(OCC.summary);
        render();
      })
      .catch(function (err) {
        console.error('arxAIv: could not load occlusion maps', err);
        fail('This interactive needs <code>static/data/occlusion.json</code>. Regenerate it with ' +
          '<code>tools/occlusion.py</code>, or serve this folder over HTTP if you opened the file ' +
          'from disk.');
      });
  }

  /* Numbers in the section 6 prose that come out of the occlusion bundle rather than the
     main one, so they land after its own fetch resolves. Written once, from tools/textmask.py,
     so the prose cannot drift from the measurement. */
  function fillOccNumbers(sm) {
    if (!sm) return;
    function pct(v, p) { return fmt(v * 100, p == null ? 0 : p) + '%'; }
    function signed(v, p) { return (v > 0 ? '+' : '\u2212') + fmt(Math.abs(v), p); }
    var vals = {
      'bias-frac': pct(sm.bias_frac_neg),
      'bias-mean': signed(sm.bias_mean, 2),
      'top5': pct(sm.top5_share),
      'noflip': pct(1 - sm.flip_frac),
      'gen-text': fmt(sm.text.gen.text, 3),
      'gen-nontext': fmt(sm.text.gen.nontext, 3),
      'gen-diff': signed(sm.text.gen.diff, 3),
      'gen-ci': '[' + signed(sm.text.gen.ci[0], 3) + ', ' + signed(sm.text.gen.ci[1], 3) + ']',
      'gen-frac': pct(sm.text.gen.frac_figs),
      'real-diff': signed(sm.text.real.diff, 3),
      'real-ci': '[' + signed(sm.text.real.ci[0], 3) + ', ' + signed(sm.text.real.ci[1], 3) + ']',
      'real-frac': pct(sm.text.real.frac_figs),
      'ocr-gen': pct(sm.ocr.gen.detected_frac),
      'ocr-real': pct(sm.ocr.real.detected_frac),
      'ocr-gen-p': fmt(sm.ocr.gen.mean_patches, 1),
      'ocr-real-p': fmt(sm.ocr.real.mean_patches, 1)
    };
    $$('[data-occ-n]').forEach(function (n) {
      var k = n.getAttribute('data-occ-n');
      if (vals[k] != null) n.textContent = vals[k];
    });
  }

  /* Section 8's raw OCR. Optional: if the file is missing the archive still renders, it just
     loses the corrected/raw toggle, so the page degrades to how it behaved before. */
  function initPageOcr() {
    if (!$('#paper-explorer')) return;
    fetch('static/data/page_ocr.json')
      .then(function (r) { return r.json(); })
      .then(function (json) {
        PAGEOCR = json;
        fillNumbers();
        var open = $('.paper-cell.sel', $('#paper-explorer'));
        if (open) open.click();          // redraw the detail panel now the raw text exists
      })
      .catch(function () { PAGEOCR = null; });
  }

  /* Section 6's text-removal experiment (tools/ablate_text.py). Three conditions, each a full
     refit. The random-masked control is drawn between the other two on purpose: the reader should
     see that blanking pixels at random costs almost nothing before they read the text bar. */
  function initMaskAblation() {
    var host = $('#mask-ablation');
    if (!host) return;
    fetch('static/data/text_ablation.json')
      .then(function (r) { return r.json(); })
      .then(function (json) {
        MASKABL = json;
        var c = json.conditions;
        bars('#mask-bars', [
          { label: 'Original figures', v: c.original.acc * 100, kind: 'real', acc: c.original.acc },
          { label: 'Random boxes masked (control)', v: c.random_masked.acc * 100, kind: 'none',
            acc: c.random_masked.acc },
          { label: 'Text masked', v: c.text_masked.acc * 100, kind: 'mutated',
            acc: c.text_masked.acc }
        ], { fmt: function (r) { return fmt(r.acc * 100, 1) + '%'; } });
        fillNumbers();
      })
      .catch(function () {
        host.innerHTML = '<p class="dek">This figure needs ' +
          '<code>static/data/text_ablation.json</code>; rebuild it with ' +
          '<code>tools/ablate_text.py</code>.</p>';
      });
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
      'gib-max': fmt(D.metric_summary.gib.max, 2),
      'gib-med': fmt(D.metric_summary.gib.med, 2),
      'gib-zero': D.metric_summary.gib.zero,
      'gib-n': D.metric_summary.gib.n,
      'gib-undef': D.metric_summary.gib.undefined,
      'tok-med': D.metric_summary.tok.med,
      'tok-mean': fmt(D.metric_summary.tok.mean, 1),
      'tok-max': D.metric_summary.tok.max,
      'tok-le3': D.metric_summary.tok.le3,
      'tok-le5': D.metric_summary.tok.le5,
      'clip-mean': fmt(D.metric_summary.clip.mean, 3),
      'clip-min': fmt(D.metric_summary.clip.min, 3),
      'cplx-mean': fmt(D.metric_summary.cplx.mean, 1),
      'hall-pct': fmt(D.affiliations.rows[0].pct_auth, 1) + '%',
      'mut-pct': fmt(D.affiliations.rows[1].pct_auth, 1) + '%',
      'notitle': D.papers.filter(function (p) { return !p.title || p.title === 'None'; }).length,
      'pixel-acc': fmt(D.ablation[1].acc * 100, 1) + '%',
      'both-acc': fmt(D.ablation[4].acc * 100, 1) + '%',
      'pixel-best-auc': fmt(Math.max.apply(null, D.pixel.rows.map(function (r) { return r.auc; })), 3),
      // section 4 — how much of the corpus the two map axes actually hold
      'evr1': fmt(D.pca.evr[0], 1) + '%',
      'evr2': fmt(D.pca.evr[1], 1) + '%',
      'evr12': fmt(D.pca.cum[1], 1) + '%',
      'evr123': fmt(D.pca.cum[2], 1) + '%',
      // section 5 — the discriminant written out, straight from the fitted weights
      'lda-w1': fmt(Math.abs(D.lda.w[0]), 3),
      'lda-w2': fmt(Math.abs(D.lda.w[1]), 3),
      'lda-t': fmt(D.lda.t, 3),
      // sections 6 and 11 — the provenance confound
      'gen-w': D.provenance.gen_w_med,
      'real-w': D.provenance.real_w_med,
      'width-acc': fmt(D.provenance.width_acc * 100, 1) + '%',
      'width-t': D.provenance.width_thresh,
      'width-wrong': D.provenance.width_wrong,
      'occ-passes': group((D.counts.gen_figs + D.counts.real_figs) * 49),
      // section 5 — the permutation test and the bootstrap interval
      'perm-b': group(D.lda.perm.B),
      'perm-null': fmt(D.lda.perm.null_mean * 100, 1) + '%',
      'perm-sd': fmt(D.lda.perm.null_sd * 100, 1),
      'perm-max': fmt(D.lda.perm.null_max * 100, 1) + '%',
      'perm-sd-above': fmt(D.lda.perm.sd_above, 1),
      'perm-p': D.lda.perm.p,
      'lda-ci': fmt(D.lda.perm.ci[0] * 100, 1) + '% to ' + fmt(D.lda.perm.ci[1] * 100, 1) + '%',
      'width-null': fmt(D.provenance.perm.null_mean * 100, 1) + '%',
      // section 9 — surname concentration
      'conc-n': D.names.conc.n_authors,
      'conc-distinct': D.names.conc.n_distinct,
      'conc-ratio': fmt(D.names.conc.distinct_ratio, 2),
      'conc-h': fmt(D.names.conc.entropy, 2),
      'conc-hmax': fmt(D.names.conc.entropy_max, 2),
      'conc-top1': fmt(D.names.conc.top1, 1) + '%',
      'conc-top10': fmt(D.names.conc.top10, 1) + '%',
      'conc-gini': fmt(D.names.conc.gini, 3),
      'conc-doe': D.names.conc.doe,
      // section 10 — does the title embedding recover the subtopics?
      'q-labels': fmt(D.clusters_check.q_labels, 2),
      'q-spectral': fmt(D.clusters_check.q_spectral5, 2),
      'q-ari': fmt(D.clusters_check.ari, 2),
      'q-links': D.clusters_check.n_links
    };
    // section 8 — how far the correction pass moved the text. Only available once
    // page_ocr.json has loaded, so these fill on the second call to fillNumbers().
    if (PAGEOCR && PAGEOCR.summary) {
      var sm = PAGEOCR.summary;
      vals['ocr-raw-rate'] = fmt(sm.raw_rate * 100, 0) + '%';
      vals['ocr-corr-rate'] = fmt(sm.corr_rate * 100, 0) + '%';
      vals['ocr-gap'] = fmt(sm.gap * 100, 0);
      vals['ocr-corr-higher'] = fmt(sm.corr_higher * 100, 0) + '%';
      vals['ocr-conf'] = fmt(sm.mean_conf, 0);
      vals['ocr-tokens'] = fmt(sm.mean_tokens, 0);
      vals['ocr-n'] = sm.n;
      vals['ocr-body-rate'] = fmt(sm.body_rate * 100, 0) + '%';
      vals['ocr-body-gap'] = fmt(sm.body_gap * 100, 0);
    }
    // section 6 — what survives with the text removed
    if (MASKABL) {
      var c = MASKABL.conditions, mc = MASKABL.mcnemar, base = D.lda.baseline;
      vals['mask-orig'] = fmt(c.original.acc * 100, 1) + '%';
      vals['mask-random'] = fmt(c.random_masked.acc * 100, 1) + '%';
      vals['mask-text'] = fmt(c.text_masked.acc * 100, 1) + '%';
      vals['mask-null'] = fmt(c.text_masked.null_mean * 100, 1) + '%';
      vals['mask-gap'] = fmt((c.random_masked.acc - c.text_masked.acc) * 100, 1);
      vals['mask-p'] = fmt(mc.text_vs_random.p, 3);
      vals['mask-ctrl-p'] = fmt(mc.random_vs_original.p, 2);
      // share of the above-baseline signal that the text was carrying
      vals['mask-share'] = Math.round(100 * (c.random_masked.acc - c.text_masked.acc) /
                                      (c.random_masked.acc - base)) + '%';
      vals['mask-area-gen'] = fmt(MASKABL.masked_frac.gen * 100, 1) + '%';
      vals['mask-area-real'] = fmt(MASKABL.masked_frac.real * 100, 1) + '%';
    }
    $$('[data-n]').forEach(function (n) {
      var k = n.getAttribute('data-n');
      if (vals[k] != null) n.textContent = vals[k];
    });

    // The cosine-similarity bars are scaled from the same numbers that print beside them,
    // so the two cannot drift apart when the underlying values are recomputed.
    var sims = { g2g: D.clip_sim.g2g, r2r: D.clip_sim.r2r, g2r: D.clip_sim.g2r };
    var top = Math.max(sims.g2g, sims.r2r, sims.g2r);
    $$('[data-bar]').forEach(function (b) {
      var v = sims[b.getAttribute('data-bar')];
      if (v != null && top > 0) b.style.width = (100 * v / top).toFixed(1) + '%';
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
    initPermTest();
    initOcclusion();
    initPageOcr();
    initMaskAblation();
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

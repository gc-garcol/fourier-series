/*
 * Fourier Series image drawing.
 *
 * Pipeline: image -> offscreen bitmap (~300px) -> threshold -> largest blob ->
 * ordered outer boundary (Moore-neighbour tracing) -> M points resampled by arc
 * length -> complex DFT of z = x + iy -> epicycle animation using the first N terms.
 *
 * Convention for N (see also the hint in the UI):
 *   c_0 (the DC term, the centre of the drawing) is always applied as a fixed offset.
 *   N counts the rotating circles (epicycles) on top of it, ordered by frequency:
 *   +1, -1, +2, -2, +3, -3, ...   So N = 1 is the single circle c_1 e^{it}.
 *   Reconstruction: z(t) = c_0 + sum over the first N terms of c_k e^{ikt}, t in [0, 2*pi).
 *   N is limited to M (the number of sampled points); at most M-1 non-DC terms exist,
 *   so N = M behaves like N = M-1 (exact reconstruction of the sampled points).
 */
(function () {
  'use strict';

  // ---- Constants -----------------------------------------------------------
  var WORK_SIZE = 300;        // longest side of the offscreen bitmap used for analysis
  var MAX_POINTS = 1024;      // M: resampled contour points
  var MIN_POINTS = 8;         // below this we treat the contour as unusable
  var DEFAULT_N = 200;
  var MIN_RADIUS_PX = 0.3;    // circles smaller than this are summed but not drawn
  var BASE_PERIOD_S = 12;     // seconds for one full period at speed 1x
  var FIT = 0.88;             // fraction of half the canvas used by the drawing

  var COLORS = {
    outline: 'rgba(255, 255, 255, 0.28)',
    ghost: 'rgba(94, 234, 212, 0.22)',
    trail: '#5eead4',
    circle: 'rgba(255, 255, 255, 0.25)',
    radius: 'rgba(255, 255, 255, 0.6)',
    tip: '#ffd166'
  };

  // ---- DOM -----------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  var canvas = $('stage');
  var ctx = canvas.getContext('2d');
  var fileInput = $('file-input');
  var sampleBtn = $('sample-btn');
  var sampleSelect = $('sample-select');
  var nInput = $('n-input');
  var nRange = $('n-range');
  var playBtn = $('play-btn');
  var speedRange = $('speed-range');
  var speedOut = $('speed-out');
  var circlesChk = $('circles-chk');
  var outlineChk = $('outline-chk');
  var statusEl = $('status');
  var dropOverlay = $('drop-overlay');

  // ---- State ---------------------------------------------------------------
  var state = {
    ready: false,
    M: 0,
    rawCount: 0,        // number of traced boundary pixels before resampling
    px: null,           // resampled, normalised points (Float64Array), y axis down
    py: null,
    dc: null,           // {re, im}
    terms: [],          // [{f, re, im, amp}] ordered +1, -1, +2, -2, ...
    cosT: null,         // cos/sin tables of 2*pi*j/M
    sinT: null,
    N: DEFAULT_N,
    maxN: MAX_POINTS,
    pathX: null,        // reconstruction at the M sample times for the current N
    pathY: null,
    progress: 0,        // 0..1 position within the period
    playing: true,
    speed: 1,
    showCircles: true,
    showOutline: true
  };
  var cssW = 0, cssH = 0;
  var rafId = 0, lastTs = 0;

  // ---- Status --------------------------------------------------------------
  function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', !!isError);
  }

  function updateInfoStatus() {
    if (!state.ready) return;
    setStatus('N = ' + state.N + ' (max ' + state.maxN + ') \u00b7 M = ' + state.M +
      ' resampled points \u00b7 ' + state.rawCount + ' traced contour points');
  }

  // ---- Image -> contour ----------------------------------------------------

  /** Draw a source (Image/canvas) to a padded, white-composited bitmap and return gray values. */
  function toGray(source, srcW, srcH) {
    var scale = WORK_SIZE / Math.max(srcW, srcH);
    var w = Math.max(1, Math.round(srcW * scale));
    var h = Math.max(1, Math.round(srcH * scale));
    var off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    var c = off.getContext('2d', { willReadFrequently: true });
    c.fillStyle = '#ffffff';            // composite transparency onto white
    c.fillRect(0, 0, w, h);
    c.drawImage(source, 0, 0, w, h);
    var data = c.getImageData(0, 0, w, h).data;
    var gray = new Uint8Array(w * h);
    for (var i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = Math.round(0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]);
    }
    return { gray: gray, w: w, h: h };
  }

  /** Otsu threshold on a 256-bin histogram. Returns t; pixels <= t are "dark". */
  function otsu(gray) {
    var hist = new Array(256).fill(0), i;
    for (i = 0; i < gray.length; i++) hist[gray[i]]++;
    var total = gray.length, sumAll = 0;
    for (i = 0; i < 256; i++) sumAll += i * hist[i];
    var wB = 0, sumB = 0, best = -1, thr = 127;
    for (i = 0; i < 256; i++) {
      wB += hist[i];
      if (wB === 0) continue;
      var wF = total - wB;
      if (wF === 0) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sumAll - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = i; }
    }
    return thr;
  }

  /** Binary mask with a 1px empty border (so tracing never leaves the array). Foreground = minority. */
  function buildMask(g) {
    var thr = otsu(g.gray);
    var W = g.w + 2, H = g.h + 2;
    var x, y;
    // Polarity comes from the image edge ring, which is almost always background. A silhouette
    // that fills most of the frame therefore still counts as foreground (global pixel counts would not).
    var edge = 0, edgeDark = 0;
    for (y = 0; y < g.h; y++) {
      var fullRow = y === 0 || y === g.h - 1;
      for (x = 0; x < g.w; x += (fullRow || g.w < 2 ? 1 : g.w - 1)) {   // full row, or just its two end pixels
        edge++;
        if (g.gray[y * g.w + x] <= thr) edgeDark++;
      }
    }
    var invert = edgeDark * 2 > edge;   // dark border -> dark background -> the light pixels are the shape
    var mask = new Uint8Array(W * H);
    for (y = 0; y < g.h; y++) {
      for (x = 0; x < g.w; x++) {
        var isDark = g.gray[y * g.w + x] <= thr;
        if (isDark !== invert) mask[(y + 1) * W + (x + 1)] = 1;
      }
    }
    return { mask: mask, W: W, H: H };
  }

  /** Keep only the largest 8-connected foreground component. Returns its size (0 if none). */
  function keepLargestComponent(m) {
    var mask = m.mask, n = mask.length, W = m.W;
    var labels = new Int32Array(n);
    var stack = new Int32Array(n);
    var next = 0, bestLabel = 0, bestSize = 0;
    for (var s = 0; s < n; s++) {
      if (!mask[s] || labels[s]) continue;
      next++;
      var sp = 0, size = 0;
      stack[sp++] = s;
      labels[s] = next;
      while (sp > 0) {
        var p = stack[--sp];
        size++;
        var px = p % W, py = (p - px) / W;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            var qx = px + dx, qy = py + dy;
            if (qx < 0 || qy < 0 || qx >= W || qy >= m.H) continue;
            var q = qy * W + qx;
            if (mask[q] && !labels[q]) { labels[q] = next; stack[sp++] = q; }
          }
        }
      }
      if (size > bestSize) { bestSize = size; bestLabel = next; }
    }
    for (var i = 0; i < n; i++) mask[i] = labels[i] === bestLabel ? 1 : 0;
    return bestSize;
  }

  // Moore neighbourhood, clockwise on screen (y axis down), starting at West.
  var DIRS = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];

  /** Trace the outer boundary of the single component in the mask as an ordered closed loop. */
  function traceBoundary(m) {
    var mask = m.mask, W = m.W, H = m.H;
    var start = -1, i;
    for (i = 0; i < mask.length; i++) if (mask[i]) { start = i; break; }
    if (start < 0) return [];
    var sx = start % W, sy = (start - sx) / W;
    var pts = [[sx, sy]];
    var cx = sx, cy = sy;
    var back = 0;                       // direction (from current pixel) of the cell we came from: West is empty
    var firstNext = -1;
    var limit = 4 * W * H;
    for (var step = 0; step < limit; step++) {
      var found = false;
      for (i = 1; i <= 8; i++) {
        var d = (back + i) % 8;
        var nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || !mask[ny * W + nx]) continue;
        // Cell checked just before the hit; it becomes the new backtrack reference.
        var pd = (d + 7) % 8;
        var bx = cx + DIRS[pd][0] - nx, by = cy + DIRS[pd][1] - ny;
        var nb = 0;
        for (var k = 0; k < 8; k++) if (DIRS[k][0] === bx && DIRS[k][1] === by) { nb = k; break; }
        var idx = ny * W + nx;
        if (step === 0) firstNext = idx;
        // Jacob's criterion: stop when we re-enter the start pixel heading to the same first neighbour.
        if (cx === sx && cy === sy && step > 0 && idx === firstNext) return pts;
        cx = nx; cy = ny; back = nb;
        pts.push([cx, cy]);
        found = true;
        break;
      }
      if (!found) return pts;           // isolated pixel
    }
    return pts;
  }

  /** Resample a closed polyline to M points uniformly by arc length. */
  function resample(pts, M) {
    var n = pts.length, cum = new Float64Array(n + 1), i;
    for (i = 0; i < n; i++) {
      var a = pts[i], b = pts[(i + 1) % n];
      cum[i + 1] = cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    var total = cum[n];
    if (!(total > 0)) return null;
    var xs = new Float64Array(M), ys = new Float64Array(M), seg = 0;
    for (var j = 0; j < M; j++) {
      var target = (j * total) / M;
      while (seg < n - 1 && cum[seg + 1] < target) seg++;
      var len = cum[seg + 1] - cum[seg];
      var f = len > 0 ? (target - cum[seg]) / len : 0;
      var p0 = pts[seg], p1 = pts[(seg + 1) % n];
      xs[j] = p0[0] + (p1[0] - p0[0]) * f;
      ys[j] = p0[1] + (p1[1] - p0[1]) * f;
    }
    return { xs: xs, ys: ys };
  }

  /** Full extraction. Throws Error with a user-friendly message on failure. */
  function extractContour(source, srcW, srcH) {
    var g = toGray(source, srcW, srcH);
    var m = buildMask(g);
    var size = keepLargestComponent(m);
    if (size === 0) throw new Error('No shape found in this image. Try a dark silhouette on a plain background.');
    var raw = traceBoundary(m);
    if (raw.length < MIN_POINTS) throw new Error('The shape found is too small to trace. Try a larger or simpler image.');
    var M = Math.min(MAX_POINTS, raw.length);
    var rs = resample(raw, M);
    if (!rs) throw new Error('The outline has no length. Try a different image.');

    // Centre on the centroid and normalise so the largest half-extent is 1.
    var cx = 0, cy = 0, i;
    for (i = 0; i < M; i++) { cx += rs.xs[i]; cy += rs.ys[i]; }
    cx /= M; cy /= M;
    var ext = 0;
    for (i = 0; i < M; i++) {
      rs.xs[i] -= cx; rs.ys[i] -= cy;
      ext = Math.max(ext, Math.abs(rs.xs[i]), Math.abs(rs.ys[i]));
    }
    if (!(ext > 0)) throw new Error('The outline is degenerate. Try a different image.');
    for (i = 0; i < M; i++) { rs.xs[i] /= ext; rs.ys[i] /= ext; }
    return { px: rs.xs, py: rs.ys, M: M, rawCount: raw.length };
  }

  // ---- Fourier -------------------------------------------------------------

  /** c_k = (1/M) sum_n z_n e^{-i 2 pi k n / M}, z_n = x_n + i y_n. Returns terms ordered 0 | +1, -1, +2, -2, ... */
  function computeFourier(px, py, M) {
    var cosT = new Float64Array(M), sinT = new Float64Array(M), j, n, k;
    for (j = 0; j < M; j++) {
      cosT[j] = Math.cos((2 * Math.PI * j) / M);
      sinT[j] = Math.sin((2 * Math.PI * j) / M);
    }
    var cRe = new Float64Array(M), cIm = new Float64Array(M);
    for (k = 0; k < M; k++) {
      var re = 0, im = 0;
      for (n = 0; n < M; n++) {
        var idx = (k * n) % M;
        var c = cosT[idx], s = sinT[idx];
        // (x + iy)(cos - i sin) = (x cos + y sin) + i (y cos - x sin)
        re += px[n] * c + py[n] * s;
        im += py[n] * c - px[n] * s;
      }
      cRe[k] = re / M;
      cIm[k] = im / M;
    }
    var terms = [];
    for (j = 1; j <= Math.floor(M / 2); j++) {
      terms.push({ f: j, re: cRe[j], im: cIm[j], amp: Math.hypot(cRe[j], cIm[j]) });
      var kn = M - j;                    // frequency -j; for even M, j = M/2 coincides with -j
      if (kn !== j) terms.push({ f: -j, re: cRe[kn], im: cIm[kn], amp: Math.hypot(cRe[kn], cIm[kn]) });
    }
    return { dc: { re: cRe[0], im: cIm[0] }, terms: terms, cosT: cosT, sinT: sinT };
  }

  /** Number of non-DC terms actually used for the current N. */
  function usedTerms() { return Math.min(state.N, state.terms.length); }

  /** Reconstruct the path at the M sample times using the first N terms. */
  function rebuildPath() {
    var M = state.M, px = new Float64Array(M), py = new Float64Array(M), s;
    for (s = 0; s < M; s++) { px[s] = state.dc.re; py[s] = state.dc.im; }
    var used = usedTerms(), cosT = state.cosT, sinT = state.sinT;
    for (var t = 0; t < used; t++) {
      var term = state.terms[t];
      var step = ((term.f % M) + M) % M, idx = 0;
      for (s = 0; s < M; s++) {
        var c = cosT[idx], sn = sinT[idx];
        px[s] += term.re * c - term.im * sn;
        py[s] += term.re * sn + term.im * c;
        idx += step;
        if (idx >= M) idx -= M;
      }
    }
    state.pathX = px;
    state.pathY = py;
  }

  // ---- N handling ----------------------------------------------------------

  function clampN(v) {
    if (!isFinite(v)) return null;
    return Math.min(state.maxN, Math.max(1, Math.round(v)));
  }

  /** Apply a new N. Does not touch the input fields (callers decide whether to rewrite them). */
  function applyN(n) {
    state.N = n;
    nRange.value = String(n);
    if (state.ready) { rebuildPath(); updateInfoStatus(); }
    requestDraw();
  }

  // ---- Loading -------------------------------------------------------------

  function useContour(res) {
    var f = computeFourier(res.px, res.py, res.M);
    state.M = res.M;
    state.rawCount = res.rawCount;
    state.px = res.px;
    state.py = res.py;
    state.dc = f.dc;
    state.terms = f.terms;
    state.cosT = f.cosT;
    state.sinT = f.sinT;
    state.maxN = res.M;
    state.ready = true;
    nInput.max = String(state.maxN);
    nRange.max = String(state.maxN);
    var n = clampN(state.N) || 1;
    nInput.value = String(n);
    applyN(n);
    state.progress = 0;
    requestDraw();
  }

  /** Show a load error and drop the previous shape so a stale drawing is not left under the message. */
  function showLoadError(msg) {
    state.ready = false;
    setStatus(msg, true);
    requestDraw();
  }

  function loadFromSource(source, w, h) {
    try {
      useContour(extractContour(source, w, h));
    } catch (err) {
      showLoadError(err && err.message ? err.message : 'Could not process this image.');
    }
  }

  function loadFile(file) {
    if (!file || (file.type && file.type.indexOf('image/') !== 0)) {
      showLoadError('Please choose an image file.');
      return;
    }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      var w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) { showLoadError('This image has no readable size.'); return; }
      loadFromSource(img, w, h);
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      showLoadError('Could not read this file as an image.');
    };
    img.src = url;
  }

  // ---- Built-in samples ----------------------------------------------------
  // Each draw function paints ONE solid black silhouette on the white size x size canvas (y axis down).
  // The tracer keeps only the largest connected blob and its outer boundary, so parts must overlap.

  // SAMPLES-START
  function fillPoly(g, pts) {
    g.beginPath();
    for (var i = 0; i < pts.length; i++) {
      if (i === 0) g.moveTo(pts[i][0], pts[i][1]); else g.lineTo(pts[i][0], pts[i][1]);
    }
    g.closePath();
    g.fill();
  }

  function fillCircle(g, x, y, r) {
    g.beginPath();
    g.arc(x, y, r, 0, 2 * Math.PI);
    g.fill();
  }

  function fillEllipse(g, x, y, rx, ry, rot) {
    g.beginPath();
    g.ellipse(x, y, rx, ry, rot, 0, 2 * Math.PI);
    g.fill();
  }

  /** Stroke the current path in black with round caps and joins. */
  function strokeBlack(g, width) {
    g.lineWidth = width;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = '#000000';
    g.stroke();
  }

  function drawHeart(g, size) {
    g.beginPath();
    for (var i = 0; i <= 360; i++) {
      var t = (i / 360) * 2 * Math.PI;
      var x = 16 * Math.pow(Math.sin(t), 3);
      var y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      var X = size / 2 + x * 11, Y = size / 2 - 15 - y * 11;
      if (i === 0) g.moveTo(X, Y); else g.lineTo(X, Y);
    }
    g.closePath();
    g.fill();
  }

  function drawStar(g) {
    var pts = [];
    for (var i = 0; i < 10; i++) {
      var a = (-90 + i * 36) * Math.PI / 180;
      var r = i % 2 === 0 ? 150 : 65;
      pts.push([200 + r * Math.cos(a), 210 + r * Math.sin(a)]);
    }
    fillPoly(g, pts);
  }

  function drawMoon(g) {
    fillCircle(g, 200, 200, 140);
    g.fillStyle = '#ffffff';            // the offscreen canvas is opaque white, so this cut is exact
    fillCircle(g, 255, 175, 115);
    g.fillStyle = '#000000';
  }

  function drawBalloon(g) {
    fillEllipse(g, 200, 150, 95, 115, 0);
    fillPoly(g, [[200, 258], [178, 294], [222, 294]]);
    g.beginPath();
    for (var y = 288; y <= 372; y += 2) {
      var x = 200 + 14 * Math.sin((y - 288) / 84 * 3 * Math.PI);
      if (y === 288) g.moveTo(x, y); else g.lineTo(x, y);
    }
    strokeBlack(g, 7);
  }

  function drawIceCream(g) {
    fillPoly(g, [[128, 232], [272, 232], [200, 375]]);   // cone
    fillEllipse(g, 200, 232, 90, 26, 0);                   // wide rim under the scoops
    fillCircle(g, 200, 185, 78);
    fillCircle(g, 200, 100, 55);
  }

  function drawApple(g) {
    fillCircle(g, 145, 235, 92);
    fillCircle(g, 255, 235, 92);
    fillCircle(g, 200, 245, 80);
    g.beginPath();                      // stem, starting inside the body below the dent
    g.moveTo(200, 180);
    g.lineTo(210, 95);
    strokeBlack(g, 14);
    fillEllipse(g, 245, 112, 40, 16, -0.4);   // leaf, its left end sits on the stem
  }

  function drawCherry(g) {
    fillCircle(g, 130, 290, 55);
    fillCircle(g, 270, 300, 55);
    g.beginPath();                      // two stems that start inside a cherry and meet at the top
    g.moveTo(130, 245);
    g.quadraticCurveTo(140, 130, 215, 70);
    g.moveTo(270, 255);
    g.quadraticCurveTo(255, 130, 215, 70);
    strokeBlack(g, 10);
    fillEllipse(g, 255, 60, 48, 20, -0.3);    // leaf touching the stem junction
  }

  function drawCat(g) {
    fillEllipse(g, 200, 135, 82, 68, 0);                    // head
    fillPoly(g, [[116, 120], [140, 32], [196, 84]]);        // left ear
    fillPoly(g, [[284, 120], [260, 32], [204, 84]]);        // right ear
    fillEllipse(g, 200, 278, 85, 98, 0);                    // body
    g.beginPath();                                          // upright tail
    g.moveTo(245, 338);
    g.bezierCurveTo(345, 365, 370, 300, 335, 225);
    strokeBlack(g, 22);
  }

  function drawDog(g) {
    fillEllipse(g, 225, 210, 100, 60, 0);                   // body
    fillPoly(g, [[92, 160], [180, 138], [200, 240], [112, 220]]);   // neck
    fillCircle(g, 110, 140, 45);                            // head
    fillEllipse(g, 72, 158, 34, 20, 0);                     // snout
    fillEllipse(g, 140, 112, 32, 13, 0.5);                  // floppy ear, flopping backwards
    g.fillRect(138, 225, 26, 125);                          // front legs
    g.fillRect(184, 225, 26, 125);
    g.fillRect(252, 225, 26, 125);                          // hind legs
    g.fillRect(298, 225, 26, 125);
    g.beginPath();                                          // tail
    g.moveTo(318, 185);
    g.quadraticCurveTo(365, 180, 360, 110);
    strokeBlack(g, 16);
  }

  var SAMPLES = [
    { id: 'heart', label: 'Heart', draw: drawHeart },
    { id: 'star', label: 'Star', draw: drawStar },
    { id: 'moon', label: 'Half moon', draw: drawMoon },
    { id: 'balloon', label: 'Balloon', draw: drawBalloon },
    { id: 'icecream', label: 'Ice cream', draw: drawIceCream },
    { id: 'apple', label: 'Apple', draw: drawApple },
    { id: 'cherry', label: 'Cherry', draw: drawCherry },
    { id: 'cat', label: 'Cat', draw: drawCat },
    { id: 'dog', label: 'Dog', draw: drawDog }
  ];
  // SAMPLES-END
  var DEFAULT_SAMPLE_ID = 'heart';

  function findSample(id) {
    for (var i = 0; i < SAMPLES.length; i++) if (SAMPLES[i].id === id) return SAMPLES[i];
    return SAMPLES[0];
  }

  function currentSampleId() { return sampleSelect.value || DEFAULT_SAMPLE_ID; }

  /** Draw the named built-in sample (black on white, offscreen) and run it through the normal pipeline. */
  function loadSample(id) {
    var size = 400;
    var c = document.createElement('canvas');
    c.width = size; c.height = size;
    var g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#000000';
    findSample(id).draw(g, size);
    loadFromSource(c, size, size);
  }

  // ---- Rendering -----------------------------------------------------------

  function resizeCanvas() {
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    cssW = Math.max(1, rect.width);
    cssH = Math.max(1, rect.height);
    var bw = Math.round(cssW * dpr), bh = Math.round(cssH * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    requestDraw();
  }

  function strokePolyline(xs, ys, count, ox, oy, scale, close) {
    ctx.beginPath();
    for (var i = 0; i < count; i++) {
      var x = ox + xs[i] * scale, y = oy + ys[i] * scale;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    if (close) ctx.closePath();
    ctx.stroke();
  }

  function draw() {
    ctx.clearRect(0, 0, cssW, cssH);
    if (!state.ready) return;
    var ox = cssW / 2, oy = cssH / 2;
    var scale = (Math.min(cssW, cssH) / 2) * FIT;
    var M = state.M;
    ctx.lineJoin = 'round';

    if (state.showOutline) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = COLORS.outline;
      strokePolyline(state.px, state.py, M, ox, oy, scale, true);
    }

    // Faint full reconstruction for the current N, so the effect of N is always visible.
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLORS.ghost;
    strokePolyline(state.pathX, state.pathY, M, ox, oy, scale, true);

    // Current tip and chain of circles (all used terms are summed; tiny ones are not drawn).
    var angle = state.progress * 2 * Math.PI;
    var x = state.dc.re, y = state.dc.im;
    var used = usedTerms();
    var drawCircles = state.showCircles;
    if (drawCircles) {
      ctx.lineWidth = 1;
    }
    for (var i = 0; i < used; i++) {
      var term = state.terms[i];
      var a = term.f * angle, c = Math.cos(a), s = Math.sin(a);
      var nx = x + term.re * c - term.im * s;
      var ny = y + term.re * s + term.im * c;
      if (drawCircles && term.amp * scale >= MIN_RADIUS_PX) {
        var cx = ox + x * scale, cy = oy + y * scale;
        ctx.strokeStyle = COLORS.circle;
        ctx.beginPath();
        ctx.arc(cx, cy, term.amp * scale, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.strokeStyle = COLORS.radius;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(ox + nx * scale, oy + ny * scale);
        ctx.stroke();
      }
      x = nx; y = ny;
    }

    // Trail: path from t = 0 up to the current position, ending exactly at the tip.
    var pos = state.progress * M;
    var whole = Math.floor(pos);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = COLORS.trail;
    ctx.beginPath();
    for (var k = 0; k <= whole && k < M; k++) {
      var tx = ox + state.pathX[k] * scale, ty = oy + state.pathY[k] * scale;
      if (k === 0) ctx.moveTo(tx, ty); else ctx.lineTo(tx, ty);
    }
    ctx.lineTo(ox + x * scale, oy + y * scale);
    ctx.stroke();

    ctx.fillStyle = COLORS.tip;
    ctx.beginPath();
    ctx.arc(ox + x * scale, oy + y * scale, 4, 0, 2 * Math.PI);
    ctx.fill();
  }

  // ---- Animation loop ------------------------------------------------------

  function frame(ts) {
    rafId = 0;
    if (state.playing && state.ready) {
      var dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : 0;
      state.progress = (state.progress + (dt * state.speed) / BASE_PERIOD_S) % 1;
    }
    lastTs = ts;
    draw();
    if (state.playing) rafId = requestAnimationFrame(frame);
  }

  function requestDraw() {
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  // ---- UI wiring -----------------------------------------------------------

  // Typing: apply any valid number immediately but leave the text alone until the field is committed.
  nInput.addEventListener('input', function () {
    var n = clampN(parseFloat(nInput.value));
    if (n !== null) applyN(n);
  });
  // Commit (blur / Enter): rewrite the field with the clamped value; empty or invalid keeps the current N.
  nInput.addEventListener('change', function () {
    var n = clampN(parseFloat(nInput.value));
    if (n === null) n = state.N;
    nInput.value = String(n);
    applyN(n);
    state.progress = 0;                  // committed change restarts the drawing from t = 0
  });
  nRange.addEventListener('input', function () {
    var n = clampN(parseFloat(nRange.value)) || 1;
    nInput.value = String(n);
    applyN(n);
    state.progress = 0;                  // slider change restarts the drawing from t = 0
  });

  playBtn.addEventListener('click', function () {
    state.playing = !state.playing;
    playBtn.textContent = state.playing ? 'Pause' : 'Play';
    playBtn.setAttribute('aria-pressed', String(state.playing));
    lastTs = 0;
    requestDraw();
  });

  speedRange.addEventListener('input', function () {
    state.speed = parseFloat(speedRange.value) || 1;
    speedOut.textContent = state.speed.toFixed(1) + '\u00d7';
  });
  circlesChk.addEventListener('change', function () { state.showCircles = circlesChk.checked; requestDraw(); });
  outlineChk.addEventListener('change', function () { state.showOutline = outlineChk.checked; requestDraw(); });

  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) loadFile(fileInput.files[0]);
  });
  SAMPLES.forEach(function (s) {
    var opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.label;
    sampleSelect.appendChild(opt);
  });
  sampleSelect.value = DEFAULT_SAMPLE_ID;
  sampleSelect.addEventListener('change', function () { loadSample(currentSampleId()); });
  sampleBtn.addEventListener('click', function () { loadSample(currentSampleId()); });

  // Drag and drop anywhere on the page.
  var dragDepth = 0;
  function hasFiles(e) {
    return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0;
  }
  window.addEventListener('dragenter', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    dropOverlay.hidden = false;
  });
  window.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', function (e) {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropOverlay.hidden = true;
  });
  window.addEventListener('drop', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.hidden = true;
    if (e.dataTransfer.files && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  });

  if (typeof ResizeObserver === 'function') new ResizeObserver(resizeCanvas).observe(canvas);
  window.addEventListener('resize', resizeCanvas);

  // ---- Start ---------------------------------------------------------------
  state.N = DEFAULT_N;
  resizeCanvas();
  loadSample(DEFAULT_SAMPLE_ID);
})();

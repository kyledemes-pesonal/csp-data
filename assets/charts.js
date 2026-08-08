/* Minimal SVG chart library for the CSP dashboard.
   Palette: dataviz reference instance (validated light+dark). Every figure gets
   CSV + PNG export and optional per-mark click-through to the OpenAlex UI. */
(function () {
  const LIGHT = {
    cat: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
    surface: '#fcfcfb', ink: '#0b0b0b', ink2: '#52514e', muted: '#898781',
    grid: '#e1e0d9', axis: '#c3c2b7',
  };
  const DARK = {
    cat: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
    surface: '#1a1a19', ink: '#ffffff', ink2: '#c3c2b7', muted: '#898781',
    grid: '#2c2c2a', axis: '#383835',
  };
  // OA status: fixed semantic colors drawn from the categorical steps; stack order
  // chosen so adjacent pairs keep CVD separation (validated with the skill validator).
  const OA_LIGHT = { closed: '#898781', bronze: '#eb6834', hybrid: '#4a3aa7', diamond: '#1baf7a', gold: '#eda100', green: '#008300' };
  const OA_DARK = { closed: '#898781', bronze: '#d95926', hybrid: '#9085e9', diamond: '#199e70', gold: '#c98500', green: '#008300' };
  const OA_ORDER = ['closed', 'bronze', 'hybrid', 'diamond', 'gold', 'green'];

  function isDark() {
    const t = document.documentElement.dataset.theme;
    if (t) return t === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function theme() { return isDark() ? DARK : LIGHT; }
  function oaColors() { return isDark() ? OA_DARK : OA_LIGHT; }

  const NS = 'http://www.w3.org/2000/svg';
  function el(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function fmtN(v) {
    if (v == null) return '–';
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (Math.abs(v) >= 1e4) return (v / 1e3).toFixed(0) + 'k';
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    if (Math.abs(v) < 10 && v % 1 !== 0) return v.toFixed(2);
    return String(Math.round(v));
  }

  // ---- tooltip singleton ----
  let tip;
  function tooltip() {
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'charttip';
      document.body.appendChild(tip);
    }
    return tip;
  }
  function showTip(html, ev) {
    const t = tooltip();
    t.innerHTML = html;
    t.style.display = 'block';
    const pad = 14;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    const r = t.getBoundingClientRect();
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - pad;
    t.style.left = x + 'px'; t.style.top = y + 'px';
  }
  function hideTip() { if (tip) tip.style.display = 'none'; }

  // ---- exports ----
  function dl(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  function exportCSV(name, rows) {
    const esc = (v) => {
      v = v == null ? '' : String(v);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    const csv = rows.map((r) => r.map(esc).join(',')).join('\r\n');
    dl(name + '.csv', new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  }
  function exportPNG(name, svg) {
    const T = theme();
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', NS);
    const vb = svg.viewBox.baseVal;
    const w = vb && vb.width ? vb.width : svg.clientWidth || 800;
    const h = vb && vb.height ? vb.height : svg.clientHeight || 400;
    clone.setAttribute('width', w * 2); clone.setAttribute('height', h * 2);
    const bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('x', vb ? vb.x : 0); bg.setAttribute('y', vb ? vb.y : 0);
    bg.setAttribute('width', w); bg.setAttribute('height', h);
    bg.setAttribute('fill', T.surface);
    clone.insertBefore(bg, clone.firstChild);
    const xml = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = w * 2; c.height = h * 2;
      c.getContext('2d').drawImage(img, 0, 0);
      c.toBlob((b) => dl(name + '.png', b), 'image/png');
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  }

  // ---- figure card ----
  function fig(parent, opts) {
    const card = document.createElement('div');
    card.className = 'fig';
    const head = document.createElement('div');
    head.className = 'fig-head';
    const ttl = document.createElement('div');
    ttl.className = 'fig-title';
    ttl.textContent = opts.title;
    head.appendChild(ttl);
    if (opts.note) {
      const n = document.createElement('div');
      n.className = 'fig-note';
      n.textContent = opts.note;
      head.appendChild(n);
    }
    const tools = document.createElement('div');
    tools.className = 'fig-tools';
    head.appendChild(tools);
    card.appendChild(head);
    const body = document.createElement('div');
    body.className = 'fig-body';
    card.appendChild(body);
    parent.appendChild(card);
    const slug = opts.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return {
      card, body,
      addTools(getRows, getSvg, uiUrl) {
        if (uiUrl) {
          const a = document.createElement('a');
          a.className = 'tbtn'; a.textContent = 'OpenAlex ↗';
          a.href = uiUrl; a.target = '_blank'; a.rel = 'noopener';
          a.title = 'Open this slice in the OpenAlex UI';
          tools.appendChild(a);
        }
        const csv = document.createElement('button');
        csv.className = 'tbtn'; csv.textContent = 'CSV';
        csv.title = 'Download the underlying data table';
        csv.onclick = () => exportCSV(slug, getRows());
        tools.appendChild(csv);
        const png = document.createElement('button');
        png.className = 'tbtn'; png.textContent = 'PNG';
        png.title = 'Download the figure as an image';
        png.onclick = () => { const s = getSvg(); if (s) exportPNG(slug, s); };
        tools.appendChild(png);
      },
    };
  }

  function legend(parent, entries) {
    const lg = document.createElement('div');
    lg.className = 'fig-legend';
    for (const e of entries) {
      const chip = document.createElement('span');
      chip.className = 'lg-chip';
      chip.innerHTML = `<span class="lg-dot" style="background:${e.color}"></span>${e.name}`;
      if (e.onclick) { chip.style.cursor = 'pointer'; chip.onclick = e.onclick; }
      if (e.faded) chip.style.opacity = 0.4;
      lg.appendChild(chip);
    }
    parent.appendChild(lg);
    return lg;
  }

  // ---- line chart (multi-series over years) ----
  function line(parent, opts) {
    // opts: title, note, series [{name,color,points:[{x,y,url,extra}]}], yfmt, uiUrl
    const F = fig(parent, opts);
    const T = theme();
    const W = 860, H = 320, M = { l: 56, r: 16, t: 12, b: 30 };
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart' }, F.body);
    const xs = [...new Set(opts.series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
    if (!xs.length) { F.body.innerHTML = '<div class="empty">No data</div>'; return F; }
    const ys = opts.series.flatMap((s) => s.points.map((p) => p.y)).filter((v) => v != null);
    const ymax = Math.max(...ys, 0) * 1.08 || 1;
    const x = (v) => M.l + ((v - xs[0]) / Math.max(xs[xs.length - 1] - xs[0], 1)) * (W - M.l - M.r);
    const y = (v) => H - M.b - (v / ymax) * (H - M.t - M.b);
    for (let i = 0; i <= 4; i++) {
      const v = (ymax / 4) * i;
      el('line', { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v), stroke: T.grid, 'stroke-width': 1 }, svg);
      el('text', { x: M.l - 8, y: y(v) + 4, 'text-anchor': 'end', fill: T.muted, 'font-size': 11 }, svg)
        .textContent = (opts.yfmt || fmtN)(v);
    }
    el('line', { x1: M.l, x2: W - M.r, y1: y(0), y2: y(0), stroke: T.axis, 'stroke-width': 1 }, svg);
    const step = Math.ceil(xs.length / 12);
    xs.forEach((v, i) => {
      if (i % step === 0 || i === xs.length - 1) {
        el('text', { x: x(v), y: H - 8, 'text-anchor': 'middle', fill: T.muted, 'font-size': 11 }, svg)
          .textContent = v;
      }
    });
    for (const s of opts.series) {
      const pts = s.points.filter((p) => p.y != null).sort((a, b) => a.x - b.x);
      if (!pts.length) continue;
      el('path', {
        d: pts.map((p, i) => (i ? 'L' : 'M') + x(p.x).toFixed(1) + ' ' + y(p.y).toFixed(1)).join(''),
        fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round',
      }, svg);
      for (const p of pts) {
        const c = el('circle', { cx: x(p.x), cy: y(p.y), r: 3.2, fill: s.color, stroke: T.surface, 'stroke-width': 1.5 }, svg);
        const hit = el('circle', { cx: x(p.x), cy: y(p.y), r: 9, fill: 'transparent' }, svg);
        hit.style.cursor = p.url ? 'pointer' : 'default';
        hit.addEventListener('mousemove', (ev) => showTip(
          `<b>${s.name}</b><br>${p.x}: <b>${(opts.yfmt || fmtN)(p.y)}</b>${p.extra ? '<br>' + p.extra : ''}${p.url ? '<br><span class=tiphint>click → OpenAlex</span>' : ''}`, ev));
        hit.addEventListener('mouseleave', hideTip);
        if (p.url) hit.addEventListener('click', () => window.open(p.url, '_blank'));
      }
    }
    if (opts.series.length > 1) {
      legend(F.card, opts.series.map((s) => ({ name: s.name, color: s.color })));
    }
    F.addTools(
      () => [['series', 'x', 'y'], ...opts.series.flatMap((s) => s.points.map((p) => [s.name, p.x, p.y]))],
      () => svg, opts.uiUrl);
    return F;
  }

  // ---- stacked bars over categories ----
  function stack(parent, opts) {
    // opts: title, categories [x...], series [{name,color,values:[..],urls:[..]}], pct?, uiUrl
    const F = fig(parent, opts);
    const T = theme();
    const W = 860, H = 320, M = { l: 56, r: 16, t: 12, b: 30 };
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart' }, F.body);
    const n = opts.categories.length;
    if (!n) { F.body.innerHTML = '<div class="empty">No data</div>'; return F; }
    const totals = opts.categories.map((_, i) => opts.series.reduce((a, s) => a + (s.values[i] || 0), 0));
    const ymax = opts.pct ? 100 : Math.max(...totals, 1) * 1.05;
    const bw = Math.min(40, ((W - M.l - M.r) / n) * 0.72);
    const xc = (i) => M.l + ((i + 0.5) / n) * (W - M.l - M.r);
    const y = (v) => H - M.b - (v / ymax) * (H - M.t - M.b);
    for (let i = 0; i <= 4; i++) {
      const v = (ymax / 4) * i;
      el('line', { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v), stroke: T.grid }, svg);
      el('text', { x: M.l - 8, y: y(v) + 4, 'text-anchor': 'end', fill: T.muted, 'font-size': 11 }, svg)
        .textContent = opts.pct ? v + '%' : fmtN(v);
    }
    const step = Math.ceil(n / 14);
    opts.categories.forEach((c, i) => {
      if (i % step === 0 || i === n - 1) {
        el('text', { x: xc(i), y: H - 8, 'text-anchor': 'middle', fill: T.muted, 'font-size': 11 }, svg).textContent = c;
      }
    });
    opts.categories.forEach((c, i) => {
      let acc = 0;
      const tot = totals[i] || 1;
      for (const s of opts.series) {
        const v = s.values[i] || 0;
        if (!v) continue;
        const vv = opts.pct ? (v / tot) * 100 : v;
        const y1 = y(acc + vv), y0 = y(acc);
        const r = el('rect', {
          x: xc(i) - bw / 2, y: y1, width: bw, height: Math.max(y0 - y1 - 1.5, 0.5),
          fill: s.color, rx: 1.5,
        }, svg);
        const url = s.urls && s.urls[i];
        r.style.cursor = url ? 'pointer' : 'default';
        r.addEventListener('mousemove', (ev) => showTip(
          `<b>${s.name}</b><br>${c}: <b>${fmtN(v)}</b> (${((v / tot) * 100).toFixed(1)}%)${url ? '<br><span class=tiphint>click → OpenAlex</span>' : ''}`, ev));
        r.addEventListener('mouseleave', hideTip);
        if (url) r.addEventListener('click', () => window.open(url, '_blank'));
        acc += vv;
      }
    });
    legend(F.card, opts.series.map((s) => ({ name: s.name, color: s.color })));
    F.addTools(
      () => [['category', ...opts.series.map((s) => s.name)],
             ...opts.categories.map((c, i) => [c, ...opts.series.map((s) => s.values[i] || 0)])],
      () => svg, opts.uiUrl);
    return F;
  }

  // ---- horizontal bars ----
  function barh(parent, opts) {
    // opts: title, items [{label,value,color,url,flag,sub}], vfmt, uiUrl
    const F = fig(parent, opts);
    const T = theme();
    const items = opts.items;
    if (!items.length) { F.body.innerHTML = '<div class="empty">No data</div>'; return F; }
    const rowH = 26, LW = 230;
    const W = 860, H = items.length * rowH + 14;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart' }, F.body);
    const vmax = Math.max(...items.map((d) => d.value), 1);
    const bx = LW + 10;
    items.forEach((d, i) => {
      const yy = 8 + i * rowH;
      const g = el('g', {}, svg);
      if (d.flag) {
        el('image', { href: d.flag, x: 4, y: yy + 3, width: 20, height: 14, preserveAspectRatio: 'xMidYMid slice' }, g);
      }
      const t = el('text', { x: d.flag ? 30 : 4, y: yy + 14, fill: T.ink2, 'font-size': 12 }, g);
      t.textContent = d.label.length > (d.flag ? 30 : 34) ? d.label.slice(0, d.flag ? 29 : 33) + '…' : d.label;
      const bwv = (d.value / vmax) * (W - bx - 70);
      const r = el('rect', { x: bx, y: yy + 2, width: Math.max(bwv, 1.5), height: rowH - 9, rx: 3, fill: d.color || theme().cat[0] }, g);
      el('text', { x: bx + Math.max(bwv, 1.5) + 6, y: yy + 14, fill: T.ink, 'font-size': 12, 'font-weight': 600 }, g)
        .textContent = (opts.vfmt || fmtN)(d.value);
      g.style.cursor = d.url ? 'pointer' : 'default';
      g.addEventListener('mousemove', (ev) => showTip(
        `<b>${d.label}</b><br>${(opts.vfmt || fmtN)(d.value)}${d.sub ? '<br>' + d.sub : ''}${d.url ? '<br><span class=tiphint>click → OpenAlex</span>' : ''}`, ev));
      g.addEventListener('mouseleave', hideTip);
      if (d.url) g.addEventListener('click', () => window.open(d.url, '_blank'));
    });
    F.addTools(
      () => [['label', 'value'], ...items.map((d) => [d.label, d.value])],
      () => svg, opts.uiUrl);
    return F;
  }

  // ---- donut ----
  function donut(parent, opts) {
    // opts: title, items [{label,value,color,url}], uiUrl
    const F = fig(parent, opts);
    const T = theme();
    const W = 860, H = 340, R = 128, cx = 240, cy = H / 2;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart' }, F.body);
    const items = opts.items.filter((d) => d.value > 0);
    const total = items.reduce((a, d) => a + d.value, 0) || 1;
    let a0 = -Math.PI / 2;
    for (const d of items) {
      const a1 = a0 + (d.value / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a, r) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
      const [x0, y0] = p(a0, R), [x1, y1] = p(a1, R), [xi1, yi1] = p(a1, R * 0.55), [xi0, yi0] = p(a0, R * 0.55);
      const path = el('path', {
        d: `M${x0} ${y0} A${R} ${R} 0 ${large} 1 ${x1} ${y1} L${xi1} ${yi1} A${R * 0.55} ${R * 0.55} 0 ${large} 0 ${xi0} ${yi0}Z`,
        fill: d.color, stroke: T.surface, 'stroke-width': 2,
      }, svg);
      path.style.cursor = d.url ? 'pointer' : 'default';
      path.addEventListener('mousemove', (ev) => showTip(
        `<b>${d.label}</b><br>${fmtN(d.value)} (${((d.value / total) * 100).toFixed(1)}%)${d.url ? '<br><span class=tiphint>click → OpenAlex</span>' : ''}`, ev));
      path.addEventListener('mouseleave', hideTip);
      if (d.url) path.addEventListener('click', () => window.open(d.url, '_blank'));
      const mid = (a0 + a1) / 2, frac = d.value / total;
      if (frac > 0.04) {
        const [lx, ly] = p(mid, R * 0.78);
        el('text', { x: lx, y: ly + 4, 'text-anchor': 'middle', fill: '#fff', 'font-size': 11, 'font-weight': 600 }, svg)
          .textContent = (frac * 100).toFixed(0) + '%';
      }
      a0 = a1;
    }
    // side list
    const lx = 420;
    items.slice(0, 14).forEach((d, i) => {
      const yy = 28 + i * 22;
      el('rect', { x: lx, y: yy - 10, width: 11, height: 11, rx: 2, fill: d.color }, svg);
      const t = el('text', { x: lx + 18, y: yy, fill: T.ink2, 'font-size': 12 }, svg);
      t.textContent = (d.label.length > 44 ? d.label.slice(0, 43) + '…' : d.label) + ' — ' + ((d.value / total) * 100).toFixed(1) + '%';
      if (d.url) {
        t.style.cursor = 'pointer';
        t.addEventListener('click', () => window.open(d.url, '_blank'));
      }
    });
    F.addTools(
      () => [['label', 'value', 'pct'], ...items.map((d) => [d.label, d.value, ((d.value / total) * 100).toFixed(2)])],
      () => svg, opts.uiUrl);
    return F;
  }

  window.Charts = { theme, oaColors, OA_ORDER, line, stack, barh, donut, fig, legend, el, fmtN, showTip, hideTip, exportCSV, isDark };
})();

/* CSP Board Intelligence Dashboard — app logic. */
(function () {
  const C = window.Charts;
  const J = window.CSP_JOURNALS, M = window.CSP_METRICS, L = window.CSP_LANDSCAPE,
        I = window.CSP_INTEL, CIT = window.CSP_CITING, CR = window.CSP_CROSSREF,
        P = window.CSP_PEERS, FL = window.CSP_FLAGS;

  const CUR_YEAR = new Date().getFullYear();
  const groups = J.groups.filter((g) => g.active);
  const allGroups = J.groups;
  const gname = {}; allGroups.forEach((g) => { gname[g.id] = g.name; });
  const gmembers = {}; allGroups.forEach((g) => { gmembers[g.id] = g.members; });

  function flag(cc) { return cc && FL.flags[cc.toUpperCase()] ? FL.flags[cc.toUpperCase()] : null; }
  function ccName(cc) { return (cc && FL.names[cc.toUpperCase()]) || cc || '?'; }
  function jfilter(gid) { return 'primary_location.source.id:' + gmembers[gid].join('|'); }
  function ui(filter) { return 'https://openalex.org/works?page=1&filter=' + encodeURIComponent(filter); }
  function pctOA(y) { return y.n ? (1 - (y.oa.closed || 0) / y.n) * 100 : null; }
  function esc(s) { const d = document.createElement('span'); d.textContent = s == null ? '' : s; return d.innerHTML; }

  // ---- live API with cache + fallback ----
  const apiCache = new Map();
  let apiBase = '/api';
  async function api(path) {
    if (apiCache.has(path)) return apiCache.get(path);
    let d;
    try {
      const r = await fetch(apiBase + path);
      if (!r.ok) throw new Error('proxy ' + r.status);
      d = await r.json();
    } catch (e) {
      const r = await fetch('https://api.openalex.org' + path);
      if (!r.ok) throw new Error('api ' + r.status);
      d = await r.json();
    }
    apiCache.set(path, d);
    return d;
  }

  // ---- tab plumbing ----
  const tabs = {};
  let activeTab = 'portfolio';
  function tabEl(id) { return document.getElementById('tab-' + id); }
  function showTab(id) {
    activeTab = id;
    document.querySelectorAll('.tabbtn').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + id));
    if (!tabs[id].rendered) { tabs[id].render(); tabs[id].rendered = true; }
  }
  function rerenderActive() { tabs[activeTab].rendered = false; tabs[activeTab].render(); tabs[activeTab].rendered = true; }

  function controlBar(parent) {
    const bar = document.createElement('div');
    bar.className = 'controls';
    parent.appendChild(bar);
    return bar;
  }
  function select(bar, label, options, value, onchange) {
    const w = document.createElement('label');
    w.className = 'ctl';
    w.innerHTML = `<span>${label}</span>`;
    const s = document.createElement('select');
    for (const [v, txt] of options) {
      const o = document.createElement('option');
      o.value = v; o.textContent = txt;
      if (v === value) o.selected = true;
      s.appendChild(o);
    }
    s.onchange = () => onchange(s.value);
    w.appendChild(s);
    bar.appendChild(w);
    return s;
  }
  function toggle(bar, labels, value, onchange) {
    const w = document.createElement('div');
    w.className = 'seg';
    labels.forEach(([v, txt]) => {
      const b = document.createElement('button');
      b.textContent = txt;
      b.classList.toggle('on', v === value);
      b.onclick = () => {
        w.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        onchange(v);
      };
      w.appendChild(b);
    });
    bar.appendChild(w);
    return w;
  }
  function note(parent, html) {
    const d = document.createElement('div');
    d.className = 'tabnote';
    d.innerHTML = html;
    parent.appendChild(d);
  }
  function partialNote() { return `${CUR_YEAR} is a partial year`; }

  // years helper: metric rows for a group between y0..y1
  function yearsOf(gid, y0, y1) {
    const ys = M.groups[gid] || {};
    return Object.keys(ys).map(Number).filter((y) => y >= y0 && y <= y1 && y >= 1900).sort((a, b) => a - b)
      .map((y) => ({ y, ...ys[String(y)] }));
  }

  /* ================= PORTFOLIO ================= */
  const pf = { sel: groups.slice(0, 6).map((g) => g.id), y0: 1900, boussoleJ: 'ALL' };
  tabs.portfolio = {
    render() {
      const root = tabEl('portfolio');
      root.innerHTML = '';
      note(root, `All ${groups.length} active CSP journals (predecessor titles folded in). ${partialNote()}.`);
      const bar = controlBar(root);
      // journal chips (max 8)
      const chipbox = document.createElement('div');
      chipbox.className = 'chips';
      allGroups.forEach((g) => {
        const b = document.createElement('button');
        b.className = 'chip' + (pf.sel.includes(g.id) ? ' on' : '') + (g.active ? '' : ' inactive');
        b.textContent = g.name.replace('Canadian Journal of ', 'CJ ');
        b.title = g.name + (g.active ? '' : ' (no longer published)');
        b.onclick = () => {
          if (pf.sel.includes(g.id)) pf.sel = pf.sel.filter((x) => x !== g.id);
          else if (pf.sel.length < 8) pf.sel.push(g.id);
          else return;
          this.render();
        };
        chipbox.appendChild(b);
      });
      bar.appendChild(chipbox);
      toggle(bar, [[1900, 'Full history'], [2000, '2000+'], [2010, '2010+'], [2019, '2019+']], pf.y0,
        (v) => { pf.y0 = +v; this.render(); });

      const T = C.theme();
      const sel = pf.sel.filter((id) => M.groups[id]);
      const mk = (title, val, yfmt, note2, urlFn) => C.line(root, {
        title, note: note2,
        series: sel.map((gid, i) => ({
          name: gname[gid], color: T.cat[i % 8],
          points: yearsOf(gid, pf.y0, CUR_YEAR).map((r) => ({
            x: r.y, y: val(r), url: urlFn ? urlFn(gid, r.y) : ui(jfilter(gid) + ',publication_year:' + r.y),
          })),
        })),
        yfmt,
      });
      mk('Publications per year', (r) => r.n);
      mk('Citations to date, by publication year', (r) => r.cites, null, 'total citations received by each year\'s cohort');
      mk('Mean FWCI by publication year', (r) => r.fwci, (v) => v.toFixed(2), 'works without FWCI (some types) excluded');
      mk('% Open Access by publication year', (r) => pctOA(r), (v) => v.toFixed(0) + '%');

      this.renderBoussole(root);
      this.renderIntel(root);
      this.renderTable(root);
    },

    renderBoussole(root) {
      const T = C.theme();
      const F = C.fig(root, {
        title: 'Disciplinary landscape (boussole des domaines)',
        note: 'each dot is a topic published in CSP journals, placed between the four OpenAlex domains by its domain mix; size = works, colour = field',
      });
      const bar = document.createElement('div');
      bar.className = 'controls sub';
      F.body.appendChild(bar);
      select(bar, 'Journal', [['ALL', 'All CSP journals'], ...groups.map((g) => [g.id, g.name])],
        pf.boussoleJ, (v) => { pf.boussoleJ = v; this.render(); });

      const W = 860, H = 560, cx = W / 2, cy = H / 2 + 6, R = 225;
      const svg = C.el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart' }, F.body);
      const DOMS = [[3, 'Physical Sciences', -Math.PI / 2], [1, 'Life Sciences', 0],
                    [4, 'Health Sciences', Math.PI / 2], [2, 'Social Sciences', Math.PI]];
      const pole = {};
      for (const [d, name, a] of DOMS) {
        pole[d] = [Math.cos(a), Math.sin(a)];
        C.el('circle', { cx: cx + Math.cos(a) * R, cy: cy + Math.sin(a) * R, r: 4, fill: T.muted }, svg);
        const lx = cx + Math.cos(a) * (R + 16), ly = cy + Math.sin(a) * (R + 16);
        C.el('text', {
          x: lx, y: ly + 4, 'text-anchor': a === 0 ? 'start' : a === Math.PI ? 'end' : 'middle',
          fill: T.ink2, 'font-size': 12.5, 'font-weight': 700, 'letter-spacing': '.04em',
        }, svg).textContent = name.toUpperCase();
      }
      C.el('circle', { cx, cy, r: R, fill: 'none', stroke: T.grid, 'stroke-dasharray': '3 4' }, svg);

      const perJ = pf.boussoleJ === 'ALL' ? null : (L.per_group[pf.boussoleJ] || {});
      const fcolor = {};
      L.field_order.forEach((f, i) => { fcolor[f] = L.field_palette[i]; });
      const tops = L.topics
        .map((t) => ({ ...t, nn: perJ ? (perJ[t.id] || 0) : t.n }))
        .filter((t) => t.nn > 0)
        .sort((a, b) => b.nn - a.nn);
      const nmax = Math.max(...tops.map((t) => t.nn), 1);
      for (const t of [...tops].reverse()) {
        let x = 0, y = 0;
        for (const d in t.mix) { const p = pole[d] || [0, 0]; x += p[0] * t.mix[d]; y += p[1] * t.mix[d]; }
        const px = cx + x * R, py = cy + y * R;
        const r = 2.5 + Math.sqrt(t.nn / nmax) * 22;
        const c = C.el('circle', {
          cx: px, cy: py, r, fill: fcolor[t.field] || T.muted, 'fill-opacity': 0.82,
          stroke: T.surface, 'stroke-width': 1,
        }, svg);
        c.style.cursor = 'pointer';
        const jf = pf.boussoleJ === 'ALL'
          ? 'primary_location.source.id:' + allGroups.flatMap((g) => g.members).join('|')
          : jfilter(pf.boussoleJ);
        c.addEventListener('mousemove', (ev) => C.showTip(
          `<b>${esc(t.name)}</b><br>${esc(t.f_name)} · ${esc(t.sf_name)}<br><b>${t.nn}</b> works${perJ ? ' in ' + esc(gname[pf.boussoleJ]) : ''}<br><span class=tiphint>click → OpenAlex</span>`, ev));
        c.addEventListener('mouseleave', C.hideTip);
        c.addEventListener('click', () => window.open(ui(jf + ',primary_topic.id:' + t.id), '_blank'));
      }
      const fieldsPresent = [...new Set(tops.map((t) => t.field))];
      C.legend(F.card, L.field_order.filter((f) => fieldsPresent.includes(f)).slice(0, 26).map((f) => ({
        name: (L.topics.find((t) => t.field === f) || {}).f_name || f, color: fcolor[f],
      })));
      F.addTools(() => [['topic', 'field', 'subfield', 'works'],
        ...tops.map((t) => [t.name, t.f_name, t.sf_name, t.nn])], () => svg);
    },

    renderIntel(root) {
      const T = C.theme();
      const h = document.createElement('h2');
      h.textContent = 'Board intelligence';
      root.appendChild(h);

      // market share
      const years = Object.keys(I.market_total).map(Number).filter((y) => y >= I.y0 && y <= CUR_YEAR).sort();
      const pubs = Object.entries(I.market)
        .map(([name, byY]) => ({ name, byY, recent: (byY[CUR_YEAR - 1] || 0) }))
        .sort((a, b) => (a.name.startsWith('Canadian') ? -1 : b.name.startsWith('Canadian') ? 1 : b.recent - a.recent));
      const shown = pubs.slice(0, 8);
      C.line(root, {
        title: 'Share of Canadian-authored output in CSP\'s subject space, by publisher',
        note: `works with ≥1 Canadian institution in CSP's top 15 subfields; ${partialNote()}`,
        series: shown.map((p, i) => ({
          name: p.name === 'Multidisciplinary Digital Publishing Institute' ? 'MDPI' : p.name,
          color: T.cat[i % 8],
          points: years.map((y) => ({
            x: y,
            y: I.market_total[y] ? ((p.byY[y] || 0) / I.market_total[y]) * 100 : null,
            extra: `${C.fmtN(p.byY[y] || 0)} of ${C.fmtN(I.market_total[y] || 0)} works`,
          })),
        })),
        yfmt: (v) => v.toFixed(1) + '%',
      });

      // CA share per journal
      const sel = pf.sel.filter((id) => M.groups[id]);
      C.line(root, {
        title: 'Canadian-authored share of each journal',
        note: 'works with ≥1 Canadian institution / all works; journals from the selection above',
        series: sel.map((gid, i) => ({
          name: gname[gid], color: T.cat[i % 8],
          points: yearsOf(gid, Math.max(pf.y0, 1950), CUR_YEAR).filter((r) => r.n >= 5).map((r) => ({
            x: r.y,
            y: ((I.ca_share[gid] || {})[r.y] || 0) / r.n * 100,
            url: ui(jfilter(gid) + ',publication_year:' + r.y + ',institutions.country_code:CA'),
          })),
        })),
        yfmt: (v) => v.toFixed(0) + '%',
      });

      // retractions
      const retr = allGroups.map((g) => ({
        label: g.name,
        value: Object.values(M.groups[g.id] || {}).reduce((a, r) => a + (r.retracted || 0), 0),
        url: ui(jfilter(g.id) + ',is_retracted:true'),
        color: T.cat[0],
      })).filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
      if (retr.length) {
        C.barh(root, { title: 'Retracted works by journal (all time)', items: retr });
      } else {
        note(root, 'No retracted works flagged in any CSP journal.');
      }

      // APC revenue proxy
      const apcYears = [];
      for (let y = 2010; y <= CUR_YEAR; y++) {
        let tot = 0;
        for (const g of allGroups) { const r = (M.groups[g.id] || {})[y]; if (r) tot += r.apc_paid || 0; }
        apcYears.push({ x: y, y: tot });
      }
      C.line(root, {
        title: 'APC revenue proxy (sum of estimated APCs paid, USD)',
        note: 'OpenAlex apc_paid estimates on gold/hybrid works across the whole portfolio — a rough order-of-magnitude line, not accounting data',
        series: [{ name: 'portfolio', color: T.cat[0], points: apcYears }],
        yfmt: (v) => '$' + C.fmtN(v),
      });
    },

    renderTable(root) {
      const h = document.createElement('h2');
      h.textContent = 'All journals';
      root.appendChild(h);
      const rows = allGroups.map((g) => {
        const ys = yearsOf(g.id, 2019, CUR_YEAR);
        const n19 = ys.reduce((a, r) => a + r.n, 0);
        const c19 = ys.reduce((a, r) => a + r.cites, 0);
        const fw = ys.reduce((a, r) => a + (r.fwci || 0) * r.fwci_n, 0);
        const fwn = ys.reduce((a, r) => a + r.fwci_n, 0);
        const closed = ys.reduce((a, r) => a + (r.oa.closed || 0), 0);
        const ca = ys.reduce((a, r) => a + ((I.ca_share[g.id] || {})[r.y] || 0), 0);
        const src = J.sources[g.id];
        return {
          g, n19, c19,
          fwci: fwn ? fw / fwn : null,
          oa: n19 ? (1 - closed / n19) * 100 : null,
          ca: n19 ? (ca / n19) * 100 : null,
          apc: src.apc_usd,
          h: src.h_index,
        };
      }).sort((a, b) => b.n19 - a.n19);
      const tbl = document.createElement('table');
      tbl.className = 'dt';
      tbl.innerHTML = `<thead><tr><th>Journal</th><th>Works 2019+</th><th>Citations</th>
        <th>Mean FWCI</th><th>% OA</th><th>% CA-authored</th><th>h-index</th><th>APC (USD)</th><th></th></tr></thead>`;
      const tb = document.createElement('tbody');
      for (const r of rows) {
        const tr = document.createElement('tr');
        if (!r.g.active) tr.className = 'inactive';
        tr.innerHTML = `<td><a href="https://openalex.org/sources/${r.g.id}" target="_blank" rel="noopener">${esc(r.g.name)}</a>${r.g.active ? '' : ' <span class=tag>historical</span>'}</td>
          <td>${C.fmtN(r.n19)}</td><td>${C.fmtN(r.c19)}</td>
          <td>${r.fwci == null ? '–' : r.fwci.toFixed(2)}</td>
          <td>${r.oa == null ? '–' : r.oa.toFixed(0) + '%'}</td>
          <td>${r.ca == null ? '–' : r.ca.toFixed(0) + '%'}</td>
          <td>${r.h ?? '–'}</td><td>${r.apc ? '$' + C.fmtN(r.apc) : '–'}</td>
          <td><a class=tbtn href="${ui(jfilter(r.g.id) + ',publication_year:2019-')}" target="_blank" rel="noopener">works ↗</a></td>`;
        tb.appendChild(tr);
      }
      tbl.appendChild(tb);
      root.appendChild(tbl);
    },
  };

  /* ================= BENCHMARK ================= */
  const bm = { j: groups[0].id, colored: [] };
  tabs.benchmark = {
    render() {
      const root = tabEl('benchmark');
      root.innerHTML = '';
      const bar = controlBar(root);
      select(bar, 'CSP journal', groups.map((g) => [g.id, g.name]), bm.j,
        (v) => { bm.j = v; bm.colored = []; this.render(); });
      const ps = P.peer_sets[bm.j];
      if (!ps) { note(root, 'No peer data built for this journal.'); return; }
      const sfNames = ps.subfields.map((s) => P.subfield_names[s] || s);
      note(root, `Peers = the 10 journals (megajournals included) where Canadian researchers publish most, 2019–present, in <b>${esc(gname[bm.j])}</b>'s top subfields: <i>${esc(sfNames.join(' · '))}</i>. Click a peer in a legend to colour it. ${partialNote()}.`);

      const T = C.theme();
      const years = [];
      for (let y = P.y0; y <= Math.min(P.y1, CUR_YEAR); y++) years.push(y);

      const cspRows = {};
      yearsOf(bm.j, P.y0, P.y1).forEach((r) => { cspRows[r.y] = r; });
      const cspSrc = J.sources[bm.j];

      const peerColor = (pid, i) => {
        const ci = bm.colored.indexOf(pid);
        return ci >= 0 ? T.cat[1 + (ci % 7)] : (C.isDark() ? '#4a4a47' : '#d5d4cd');
      };
      const togglePeer = (pid) => {
        if (bm.colored.includes(pid)) bm.colored = bm.colored.filter((x) => x !== pid);
        else { if (bm.colored.length >= 7) bm.colored.shift(); bm.colored.push(pid); }
        this.render();
      };

      const apcOfYear = (src, y) => {
        const ab = src && src.apc_usd_by_year;
        if (Array.isArray(ab)) {
          const hit = ab.find((r) => r.year === y || r.publication_year === y);
          if (hit) return hit.apc_usd ?? hit.price_usd ?? hit.usd ?? null;
        } else if (ab && typeof ab === 'object' && ab[y] != null) return ab[y];
        return src ? src.apc_usd : null;
      };

      const mk = (title, cspVal, peerVal, yfmt, note2) => {
        const series = [
          { name: gname[bm.j] + ' (CSP)', color: T.cat[0],
            points: years.map((y) => ({ x: y, y: cspRows[y] ? cspVal(cspRows[y], y) : null,
              url: ui(jfilter(bm.j) + ',publication_year:' + y) })) },
          ...ps.peers.map((p, i) => {
            const py = P.peers[p.id].years;
            return { name: p.name, color: peerColor(p.id, i),
              points: years.map((y) => ({ x: y, y: py[y] ? peerVal(py[y], p, y) : null,
                url: ui('primary_location.source.id:' + p.id + ',publication_year:' + y) })) };
          }),
        ];
        const F = C.line(root, { title, note: note2, series, yfmt });
        // replace legend with interactive peer chips
        const lg = F.card.querySelector('.fig-legend');
        if (lg) lg.remove();
        C.legend(F.card, [
          { name: gname[bm.j] + ' (CSP)', color: T.cat[0] },
          ...ps.peers.map((p, i) => ({ name: p.name, color: peerColor(p.id, i), onclick: () => togglePeer(p.id), faded: !bm.colored.includes(p.id) })),
        ]);
      };

      mk('Publications per year', (r) => r.n, (r) => r.n);
      mk('Citations to date, by publication year', (r) => r.cites, (r) => r.cites);
      mk('Mean FWCI', (r) => r.fwci, (r) => r.fwci, (v) => v.toFixed(2));
      mk('% Open Access', (r) => pctOA(r), (r) => pctOA(r), (v) => v.toFixed(0) + '%');
      mk('APC list price (USD)', (r, y) => apcOfYear(cspSrc, y), (r, p, y) => apcOfYear(p, y),
        (v) => '$' + C.fmtN(v), 'current/annual list price from OpenAlex sources; journals without an APC show nothing');

      // peer table
      const tbl = document.createElement('table');
      tbl.className = 'dt';
      tbl.innerHTML = `<thead><tr><th>Journal</th><th>Publisher</th><th>CA works 2019+ (in subfields)</th><th>h-index</th><th>APC (USD)</th></tr></thead>`;
      const tb = document.createElement('tbody');
      for (const p of ps.peers) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td><a href="https://openalex.org/sources/${p.id}" target="_blank" rel="noopener">${esc(p.name)}</a></td>
          <td>${esc(p.publisher)}</td><td>${C.fmtN(p.ca_works)}</td><td>${p.h_index ?? '–'}</td>
          <td>${p.apc_usd ? '$' + C.fmtN(p.apc_usd) : (p.is_oa ? 'diamond/none listed' : '–')}</td>`;
        tb.appendChild(tr);
      }
      tbl.appendChild(tb);
      root.appendChild(tbl);
    },
  };

  /* ================= PUBLISHING (live) ================= */
  const pub = { j: groups[0].id, y0: 2019, y1: CUR_YEAR, corr: false, dim: 'subfield' };
  tabs.publishing = {
    render() {
      const root = tabEl('publishing');
      root.innerHTML = '';
      const bar = controlBar(root);
      select(bar, 'Journal', groups.map((g) => [g.id, g.name]), pub.j, (v) => { pub.j = v; this.render(); });
      const yopts = []; for (let y = 1940; y <= CUR_YEAR; y++) yopts.push([y, String(y)]);
      select(bar, 'From', yopts, pub.y0, (v) => { pub.y0 = +v; this.render(); });
      select(bar, 'To', yopts.filter(([y]) => y >= pub.y0), pub.y1, (v) => { pub.y1 = +v; this.render(); });
      note(root, `Live from the OpenAlex API. ${partialNote()}.`);

      const T = C.theme();
      const jf = jfilter(pub.j) + `,publication_year:${pub.y0}-${pub.y1}`;
      const rows = yearsOf(pub.j, pub.y0, pub.y1);

      C.line(root, {
        title: 'Publications per year',
        series: [{ name: gname[pub.j], color: T.cat[0],
          points: rows.map((r) => ({ x: r.y, y: r.n, url: ui(jfilter(pub.j) + ',publication_year:' + r.y) })) }],
        uiUrl: ui(jf),
      });
      const oaC = C.oaColors();
      C.stack(root, {
        title: 'OA status per year',
        categories: rows.map((r) => r.y),
        series: C.OA_ORDER.map((st) => ({
          name: st, color: oaC[st],
          values: rows.map((r) => r.oa[st] || 0),
          urls: rows.map((r) => ui(jfilter(pub.j) + ',publication_year:' + r.y + ',oa_status:' + st)),
        })),
        uiUrl: ui(jf),
      });

      const live = document.createElement('div');
      root.appendChild(live);
      this.renderLive(live, jf).catch((e) => {
        live.innerHTML = `<div class="empty">Live API error: ${esc(e.message)}</div>`;
      });
    },

    async renderLive(box, jf) {
      const T = C.theme();
      const key = pub.j + ':' + pub.y0 + ':' + pub.y1;
      this._key = key;
      const stale = () => this._key !== key;
      box.innerHTML = '<div class="loading">Loading live breakdowns from OpenAlex…</div>';
      const gbs = 'primary_topic.id,primary_topic.subfield.id,primary_topic.field.id,authorships.institutions.id,authorships.countries,authorships.author.id';
      const [all, corr] = await Promise.all([
        api(`/works?filter=${encodeURIComponent(jf)}&group_bys=${gbs}&per-page=200&include_xpac=true`),
        api(`/works?filter=${encodeURIComponent(jf + ',authorships.is_corresponding:true')}&group_bys=authorships.institutions.id,authorships.countries&per-page=200&include_xpac=true`),
      ]);
      if (stale()) return;
      box.innerHTML = '';
      const g = (resp, key) => {
        const hit = (resp.group_bys || []).find((x) => x.group_by_key === key);
        return hit ? hit.groups : [];
      };
      const sid = (k) => k.split('/').pop();

      // subject donut with toggle
      const dimBox = document.createElement('div');
      box.appendChild(dimBox);
      const renderDonut = () => {
        dimBox.innerHTML = '';
        const bar = controlBar(dimBox);
        toggle(bar, [['topic', 'Topics'], ['subfield', 'Subfields'], ['field', 'Fields']], pub.dim,
          (v) => { pub.dim = v; renderDonut(); });
        const key = { topic: 'primary_topic.id', subfield: 'primary_topic.subfield.id', field: 'primary_topic.field.id' }[pub.dim];
        const fcolor = {};
        L.field_order.forEach((f, i) => { fcolor[f] = L.field_palette[i]; });
        const items = g(all, key).map((x) => ({
          label: x.key_display_name, value: x.count,
          fid: pub.dim === 'field' ? +sid(x.key).replace('fields/', '') : null,
          url: ui(jf + ',' + key + ':' + sid(x.key)),
        }));
        const top = items.slice(0, 8);
        const rest = items.slice(8).reduce((a, d) => a + d.value, 0);
        if (rest) top.push({ label: 'Other', value: rest });
        top.forEach((d, i) => {
          if (d.label === 'Other') d.color = T.muted;
          else if (pub.dim === 'field' && fcolor[d.fid]) d.color = fcolor[d.fid];
          else d.color = T.cat[i % 8];
        });
        C.donut(dimBox, { title: 'Subject mix (' + pub.dim + 's)', items: top, uiUrl: ui(jf) });
      };
      renderDonut();

      // institutions with corresponding toggle
      const instBox = document.createElement('div');
      box.appendChild(instBox);
      const renderInst = () => {
        instBox.innerHTML = '';
        const bar = controlBar(instBox);
        toggle(bar, [[false, 'All authorships'], [true, 'Corresponding only']], pub.corr,
          (v) => { pub.corr = v === true || v === 'true'; renderInst(); renderCty(); });
        const src = pub.corr ? corr : all;
        const extraF = pub.corr ? ',authorships.is_corresponding:true' : '';
        C.barh(instBox, {
          title: 'Top institutions' + (pub.corr ? ' (corresponding authorships)' : ''),
          note: 'count of works with ≥1 authorship from the institution',
          items: g(src, 'authorships.institutions.id').slice(0, 25).map((x) => ({
            label: x.key_display_name, value: x.count, color: T.cat[0],
            url: ui(jf + extraF + ',authorships.institutions.id:' + sid(x.key)),
          })),
          uiUrl: ui(jf),
        });
      };
      const ctyBox = document.createElement('div');
      box.appendChild(ctyBox);
      const renderCty = () => {
        ctyBox.innerHTML = '';
        const src = pub.corr ? corr : all;
        const extraF = pub.corr ? ',authorships.is_corresponding:true' : '';
        C.barh(ctyBox, {
          title: 'Top countries' + (pub.corr ? ' (corresponding authorships)' : ''),
          items: g(src, 'authorships.countries').slice(0, 25).map((x) => {
            const cc = sid(x.key).replace('countries/', '');
            return { label: x.key_display_name, value: x.count, color: T.cat[0],
              flag: flag(cc), url: ui(jf + extraF + ',authorships.countries:' + cc) };
          }),
          uiUrl: ui(jf),
        });
      };
      renderInst();
      renderCty();

      // top authors with per-journal modal country
      const auBox = document.createElement('div');
      box.appendChild(auBox);
      auBox.innerHTML = '<div class="loading">Resolving top-author countries…</div>';
      const top = g(all, 'authorships.author.id').slice(0, 25);
      const total = (await api(`/works?filter=${encodeURIComponent(jf)}&per-page=1&select=id&include_xpac=true`)).meta.count;
      let authorCC = {};
      let ccNote;
      if (total <= 8000) {
        const acc = {};
        let cursor = '*';
        while (cursor) {
          const d = await api(`/works?filter=${encodeURIComponent(jf)}&per-page=200&cursor=${encodeURIComponent(cursor)}&select=id,authorships&include_xpac=true`);
          for (const w of d.results) {
            for (const a of w.authorships || []) {
              const aid = a.author && a.author.id && a.author.id.split('/').pop();
              if (!aid) continue;
              acc[aid] = acc[aid] || {};
              for (const cc of a.countries || []) acc[aid][cc] = (acc[aid][cc] || 0) + 1;
            }
          }
          cursor = d.meta.next_cursor;
          if (!d.results.length) break;
        }
        for (const aid in acc) {
          const best = Object.entries(acc[aid]).sort((a, b) => b[1] - a[1])[0];
          if (best) authorCC[aid] = best[0];
        }
        ccNote = 'flag = country most often on that author\'s authorships in this journal';
      } else {
        const ids = top.map((x) => sid(x.key));
        const d = await api(`/authors?filter=${encodeURIComponent('ids.openalex:' + ids.join('|'))}&per-page=50&select=id,last_known_institutions`);
        for (const a of d.results) {
          const cc = a.last_known_institutions && a.last_known_institutions[0] && a.last_known_institutions[0].country_code;
          if (cc) authorCC[a.id.split('/').pop()] = cc;
        }
        ccNote = 'flag = author\'s current institutional country (selection too large for per-journal resolution)';
      }
      if (stale()) return;
      auBox.innerHTML = '';
      C.barh(auBox, {
        title: 'Top authors',
        note: ccNote,
        items: top.map((x) => {
          const aid = sid(x.key);
          return { label: x.key_display_name, value: x.count, color: T.cat[0],
            flag: flag(authorCC[aid]), sub: ccName(authorCC[aid]),
            url: ui(jf + ',authorships.author.id:' + aid) };
        }),
        uiUrl: ui(jf),
      });
    },
  };

  /* ================= CITING (static) ================= */
  const cit = { j: 'ALL', corr: false, dim: 'subfield' };
  tabs.citing = {
    render() {
      const root = tabEl('citing');
      root.innerHTML = '';
      const bar = controlBar(root);
      select(bar, 'Cited journal', [['ALL', 'All CSP journals'], ...groups.filter((g) => CIT.groups[g.id]).map((g) => [g.id, g.name])],
        cit.j, (v) => { cit.j = v; this.render(); });
      note(root, `Works citing CSP-journal works published 2019+ (static snapshot of ${C.fmtN(CIT.n_citing_works)} citing works; <b>data as of ${CIT.generated.slice(0, 10)}</b> — refresh with <code>py -3 build/build_citing.py</code>). OpenAlex link-outs are limited here: the OpenAlex UI cannot express “cites a whole journal”.`);

      const D = CIT.groups[cit.j];
      if (!D) { note(root, 'No citing data for this journal.'); return; }
      const T = C.theme();
      const years = Object.keys(D.years).map(Number).filter((y) => y >= 2018).sort();
      C.line(root, {
        title: 'Citing works per year',
        note: 'publication year of the citing work',
        series: [{ name: 'citing works', color: T.cat[0],
          points: years.map((y) => ({ x: y, y: D.years[y].n })) }],
      });
      const oaC = C.oaColors();
      C.stack(root, {
        title: 'OA status of citing works per year',
        categories: years,
        series: C.OA_ORDER.map((st) => ({
          name: st, color: oaC[st], values: years.map((y) => D.years[y].oa[st] || 0),
        })),
      });

      const dimBox = document.createElement('div');
      root.appendChild(dimBox);
      const renderDonut = () => {
        dimBox.innerHTML = '';
        const bar2 = controlBar(dimBox);
        toggle(bar2, [['topic', 'Topics'], ['subfield', 'Subfields'], ['field', 'Fields']], cit.dim,
          (v) => { cit.dim = v; renderDonut(); });
        const fcolor = {};
        L.field_order.forEach((f, i) => { fcolor[f] = L.field_palette[i]; });
        let items;
        if (cit.dim === 'topic') {
          items = D.topics.slice(0, 8).map((t) => ({ label: t.name, value: t.n }));
          const rest = D.topics.slice(8).reduce((a, t) => a + t.n, 0);
          if (rest) items.push({ label: 'Other', value: rest });
        } else {
          const acc = {};
          for (const t of D.topics) {
            const k = cit.dim === 'subfield' ? t.sfn : t.fn;
            if (!acc[k]) acc[k] = { value: 0, fid: t.f };
            acc[k].value += t.n;
          }
          items = Object.entries(acc).sort((a, b) => b[1].value - a[1].value)
            .map(([label, v]) => ({ label, value: v.value, fid: v.fid }));
          if (items.length > 8) {
            const rest = items.slice(8).reduce((a, d) => a + d.value, 0);
            items = items.slice(0, 8);
            items.push({ label: 'Other', value: rest });
          }
        }
        items.forEach((d, i) => {
          if (d.label === 'Other') d.color = T.muted;
          else if (cit.dim === 'field' && fcolor[d.fid]) d.color = fcolor[d.fid];
          else d.color = T.cat[i % 8];
        });
        C.donut(dimBox, { title: 'Subject mix of citing works (' + cit.dim + 's)', items });
      };
      renderDonut();

      const instBox = document.createElement('div');
      root.appendChild(instBox);
      const renderInst = () => {
        instBox.innerHTML = '';
        const bar3 = controlBar(instBox);
        toggle(bar3, [[false, 'All authorships'], [true, 'Corresponding only']], cit.corr,
          (v) => { cit.corr = v === true || v === 'true'; renderInst(); });
        const inst = cit.corr ? D.institutions_corr : D.institutions;
        C.barh(instBox, {
          title: 'Top citing institutions' + (cit.corr ? ' (corresponding)' : ''),
          note: 'count of citing works with ≥1 authorship from the institution',
          items: inst.slice(0, 25).map((x) => ({
            label: x.name || x.id, value: x.n, color: T.cat[0], flag: flag(x.c),
            url: 'https://openalex.org/institutions/' + x.id,
          })),
        });
        const cty = cit.corr ? D.countries_corr : D.countries;
        C.barh(instBox, {
          title: 'Top citing countries' + (cit.corr ? ' (corresponding)' : ''),
          items: Object.entries(cty).slice(0, 25).map(([cc, n]) => ({
            label: ccName(cc), value: n, color: T.cat[0], flag: flag(cc),
          })),
        });
      };
      renderInst();

      C.barh(root, {
        title: 'Top citing authors',
        note: 'flag = country most often on that author\'s citing authorships',
        items: D.authors.slice(0, 25).map((a) => ({
          label: a.name, value: a.n, color: T.cat[0], flag: flag(a.cc), sub: ccName(a.cc),
          url: 'https://openalex.org/authors/' + a.id,
        })),
      });
    },
  };

  /* ================= FUNDERS (live) ================= */
  const fu = { j: groups[0].id };
  tabs.funders = {
    render() {
      const root = tabEl('funders');
      root.innerHTML = '';
      const bar = controlBar(root);
      select(bar, 'Journal', groups.map((g) => [g.id, g.name]), fu.j, (v) => { fu.j = v; this.render(); });
      note(root, 'Funders tagged on works in this journal (all years). 🍁 marks Canadian funders. Unique grants = distinct award IDs among this journal\'s works.');
      const box = document.createElement('div');
      root.appendChild(box);
      box.innerHTML = '<div class="loading">Loading funders from OpenAlex…</div>';
      this.load(box, fu.j).catch((e) => {
        box.innerHTML = `<div class="empty">Live API error: ${esc(e.message)}</div>`;
      });
    },

    async load(box, jid) {
      const T = C.theme();
      const jf = jfilter(jid);
      const d = await api(`/works?filter=${encodeURIComponent(jf + ',funders.id:!null')}&per-page=1&select=id&include_xpac=true`);
      const total = d.meta.count;
      // stream works with funders for exact unique-grant counts
      const funders = {}; // fid -> {works, grants:Set}
      let cursor = '*', seen = 0;
      while (cursor) {
        const p = await api(`/works?filter=${encodeURIComponent(jf + ',funders.id:!null')}&per-page=200&cursor=${encodeURIComponent(cursor)}&select=id,funders,awards&include_xpac=true`);
        for (const w of p.results) {
          seen++;
          const fw = new Set();
          for (const f of w.funders || []) {
            const fid = f.id.split('/').pop();
            if (!funders[fid]) funders[fid] = { name: f.display_name, works: 0, grants: new Set() };
            if (!fw.has(fid)) { funders[fid].works++; fw.add(fid); }
          }
          for (const a of w.awards || []) {
            const fid = (a.funder_id || '').split('/').pop();
            if (fid && funders[fid]) funders[fid].grants.add(a.funder_award_id || a.id);
          }
        }
        cursor = p.meta.next_cursor;
        if (!p.results.length) break;
        if (fu.j !== jid) return;
        box.innerHTML = `<div class="loading">Loading funders… ${seen}/${total} funded works</div>`;
      }
      // funder countries
      const ids = Object.keys(funders);
      const country = {};
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        try {
          const r = await api(`/funders?filter=${encodeURIComponent('ids.openalex:' + chunk.join('|'))}&per-page=50&select=id,country_code`);
          for (const f of r.results) country[f.id.split('/').pop()] = f.country_code;
        } catch (e) { /* country stays unknown */ }
      }
      if (fu.j !== jid) return;
      box.innerHTML = '';
      const rows = ids.map((fid) => ({
        fid, name: funders[fid].name, works: funders[fid].works,
        grants: funders[fid].grants.size, cc: country[fid],
      })).sort((a, b) => b.works - a.works);

      C.barh(box, {
        title: 'Top funders by funded works',
        note: `${total} works in ${gname[jid]} carry ≥1 funder`,
        items: rows.slice(0, 25).map((r) => ({
          label: (r.cc === 'CA' ? '🍁 ' : '') + r.name, value: r.works, color: r.cc === 'CA' ? T.cat[1] : T.cat[0],
          flag: flag(r.cc), sub: `${r.grants} unique grants · ${ccName(r.cc)}`,
          url: ui(jf + ',funders.id:' + r.fid),
        })),
        uiUrl: ui(jf + ',funders.id:!null'),
      });

      const tbl = document.createElement('table');
      tbl.className = 'dt';
      tbl.innerHTML = `<thead><tr><th>Funder</th><th>Country</th><th>Funded works</th><th>Unique grants</th><th></th></tr></thead>`;
      const tb = document.createElement('tbody');
      for (const r of rows) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${r.cc === 'CA' ? '🍁 ' : ''}<a href="https://openalex.org/funders/${r.fid}" target="_blank" rel="noopener">${esc(r.name)}</a></td>
          <td>${flag(r.cc) ? `<img class=tflag src="${flag(r.cc)}" alt="">` : ''} ${esc(ccName(r.cc))}</td>
          <td>${r.works}</td><td>${r.grants}</td>
          <td><a class=tbtn href="${ui(jf + ',funders.id:' + r.fid)}" target="_blank" rel="noopener">works ↗</a></td>`;
        tb.appendChild(tr);
      }
      tbl.appendChild(tb);
      box.appendChild(tbl);
      const btn = document.createElement('button');
      btn.className = 'tbtn';
      btn.textContent = 'Download funder table (CSV)';
      btn.onclick = () => C.exportCSV('funders_' + jid, [['funder', 'country', 'funded_works', 'unique_grants'],
        ...rows.map((r) => [r.name, r.cc, r.works, r.grants])]);
      box.appendChild(btn);
    },
  };

  /* ================= METADATA HEALTH (static) ================= */
  const md = { j: Object.keys(CR.journals)[0] };
  tabs.metadata = {
    render() {
      const root = tabEl('metadata');
      root.innerHTML = '';
      const bar = controlBar(root);
      select(bar, 'Journal', groups.filter((g) => CR.journals[g.id]).map((g) => [g.id, g.name]),
        md.j, (v) => { md.j = v; this.render(); });
      const E = CR.journals[md.j];
      if (!E) { note(root, 'No Crossref data for this journal.'); return; }
      note(root, `Crossref record completeness for <b>${esc(gname[md.j])}</b> (ISSN ${E.issn}, ${C.fmtN(E.total_dois)} DOIs). Static snapshot, <b>data as of ${CR.generated.slice(0, 10)}</b> — refresh with <code>py -3 build/build_crossref.py</code>. “Current” ≈ last 2 years / “Backfile” = older, as Crossref defines them.`);

      const years = Object.keys(E.years).map(Number).sort();
      const seq = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
      const seqDark = ['#0d366b', '#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'];
      const dark = C.isDark();
      const ramp = (v) => { // v in 0..1
        const arr = seq;
        return arr[Math.min(arr.length - 1, Math.floor(v * arr.length))];
      };
      const txtFor = (v) => (v > 0.55 ? '#ffffff' : dark ? '#ffffff' : '#0b0b0b');

      const wrap = document.createElement('div');
      wrap.className = 'fig';
      wrap.innerHTML = `<div class="fig-head"><div class="fig-title">Metadata field coverage</div></div>`;
      const tbl = document.createElement('table');
      tbl.className = 'dt heat';
      tbl.innerHTML = `<thead><tr><th>Field</th><th>Backfile</th><th>Current</th>${years.map((y) => `<th>${y}</th>`).join('')}</tr></thead>`;
      const tb = document.createElement('tbody');
      const rowsOut = [['field', 'backfile', 'current', ...years]];
      for (const f of CR.fields) {
        const cov = E.coverage[f] || {};
        const tr = document.createElement('tr');
        let html = `<td>${esc(f)}</td>`;
        const cell = (v) => {
          if (v == null) return '<td class=na>–</td>';
          const pct = Math.round(v * 100);
          return `<td style="background:${ramp(v)};color:${txtFor(v)}">${pct}%</td>`;
        };
        html += cell(cov.backfile) + cell(cov.current);
        const rowVals = [cov.backfile, cov.current];
        for (const y of years) {
          const yr = E.years[String(y)] || {};
          const v = yr.total && yr[f] != null ? yr[f] / yr.total : null;
          html += cell(v);
          rowVals.push(v);
        }
        tr.innerHTML = html;
        tb.appendChild(tr);
        rowsOut.push([f, ...rowVals.map((v) => (v == null ? '' : (v * 100).toFixed(1)))]);
      }
      tbl.appendChild(tb);
      wrap.appendChild(tbl);
      root.appendChild(wrap);
      const btn = document.createElement('button');
      btn.className = 'tbtn';
      btn.textContent = 'Download coverage table (CSV)';
      btn.onclick = () => C.exportCSV('metadata_' + md.j, rowsOut);
      root.appendChild(btn);
      note(root, 'Similarity-check URLs have no per-year Crossref filter, so only overall coverage is shown for that field. Yearly totals are Crossref work counts and can differ slightly from OpenAlex counts.');
    },
  };

  /* ================= boot ================= */
  document.querySelectorAll('.tabbtn').forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });
  document.getElementById('themebtn').onclick = () => {
    const cur = document.documentElement.dataset.theme ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = cur === 'dark' ? 'light' : 'dark';
    Object.values(tabs).forEach((t) => { t.rendered = false; });
    tabs[activeTab].render(); tabs[activeTab].rendered = true;
  };
  const stamp = document.getElementById('stamp');
  stamp.textContent = `static data: metrics ${M.generated.slice(0, 10)} · citing ${CIT.generated.slice(0, 10)} · crossref ${CR.generated.slice(0, 10)} · peers ${P.generated.slice(0, 10)}`;
  showTab('portfolio');
})();

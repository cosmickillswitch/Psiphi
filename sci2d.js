/* Psi Phi Studio · science 2D types for Animath: diffusion particles and data charts from CSV. */
(function () {
  'use strict';
  const A = window.Animath;
  const col = c => A.color(c) || c || '#FFFFFF';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function seeded(seed) { let s = (seed >>> 0) || 1; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
  const gauss = r => { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const P = (pts, closed, stroke, sw, fill, fo) => ({ k: 'p', pts, closed: !!closed, stroke: stroke ? col(stroke) : null, sw: (sw == null ? 4 : sw) * 0.0075, fill: fill ? col(fill) : null, fo: fill ? (fo == null ? 1 : fo) : 0 });
  function label(text, x, y, size, c, align) {
    try {
      const b = A.build({ type: 'text', props: { text: String(text), size: size || 0.26, color: c || 'WHITE', font: 'sans', align: 'center' } });
      const w = b.bb[2] - b.bb[0], dx = align === 'left' ? w / 2 : align === 'right' ? -w / 2 : 0;
      return b.prims.filter(q => q.k === 'p' || q.k === 'g').map(q => { const n = Object.assign({}, q); if (n.pts) n.pts = n.pts.map(([a, bb]) => [a + x + dx, bb + y]); if (n.x != null) { n.x += x + dx; n.y += y; } return n; });
    } catch (e) { return []; }
  }

  /* ---------------- diffusion: particles on a random walk, with an optional barrier ---------------- */
  const SIMS = new Map();
  const DT = 0.05;
  function simulate(p) {
    const key = [p.n, p.w, p.h, p.D, p.start, p.barrier, p.perm, p.seed, p.maxT].join('|');
    let s = SIMS.get(key); if (s) return s;
    const n = clamp(Math.round(p.n), 10, 600), W = p.w, H = p.h, steps = Math.ceil(p.maxT / DT) + 1, r = seeded(p.seed || 7);
    const X = new Float32Array(n * steps), Y = new Float32Array(n * steps), side0 = new Uint8Array(n);
    const sd = Math.sqrt(2 * p.D * DT), bar = p.barrier === 'membrane', perm = clamp(p.perm, 0, 1);
    for (let i = 0; i < n; i++) {
      let x, y = (r() - 0.5) * H * 0.96;
      if (p.start === 'left') x = -W / 2 + r() * W * (bar ? 0.48 : 0.25);
      else if (p.start === 'centre') { x = gauss(r) * W * 0.05; y = gauss(r) * H * 0.08; }
      else x = (r() - 0.5) * W * 0.96;
      side0[i] = x < 0 ? 0 : 1;
      for (let k = 0; k < steps; k++) {
        X[i * steps + k] = x; Y[i * steps + k] = y;
        let nx = x + gauss(r) * sd, ny = y + gauss(r) * sd;
        if (bar && Math.sign(nx) !== Math.sign(x) && r() > perm) nx = x - (nx - x) * 0.5;          // bounces off the barrier
        if (nx < -W / 2) nx = -W - nx; if (nx > W / 2) nx = W - nx;                                   // reflecting walls
        if (ny < -H / 2) ny = -H - ny; if (ny > H / 2) ny = H - ny;
        x = clamp(nx, -W / 2, W / 2); y = clamp(ny, -H / 2, H / 2);
      }
    }
    s = { n, steps, X, Y, side0 }; SIMS.set(key, s); if (SIMS.size > 12) SIMS.delete(SIMS.keys().next().value);
    return s;
  }
  A.TYPES.diffusion = {
    label: 'Diffusion', icon: '⁘',
    defaults: { n: 160, w: 7, h: 3.6, D: 0.5, start: 'left', barrier: 'none', perm: 0.15, color: 'TEAL', accent: 'YELLOW', frame: 'GREY', hist: true, counts: true, seed: 7, maxT: 30 },
    fields: [['start', 'Start', 'select', [['left', 'All on the left (a gradient)'], ['centre', 'A drop in the middle'], ['random', 'Spread out']]],
      ['barrier', 'Barrier', 'select', [['none', 'None'], ['membrane', 'Membrane in the middle']]], ['perm', 'Permeability (0–1)', 'num', 0.05, p => p.barrier === 'membrane'],
      ['n', 'Particles', 'num', 10], ['D', 'Diffusion speed', 'num', 0.1], ['w', 'Width', 'num', 0.5], ['h', 'Height', 'num', 0.5],
      ['color', 'Particles', 'color'], ['accent', 'Particles that crossed', 'color'], ['frame', 'Box', 'color'], ['hist', 'Concentration profile', 'bool'], ['counts', 'Counts', 'bool'], ['seed', 'Random seed', 'num', 1]],
    build: p => {
      const W = p.w, H = p.h, out = [];
      out.push(P([[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]], true, p.frame, 3));
      if (p.barrier === 'membrane') for (let y = -H / 2; y < H / 2 - 0.01; y += 0.3) out.push(P([[0, y], [0, Math.min(H / 2, y + 0.18)]], false, '#F0AC5F', 6));
      const histH = p.hist ? 1.1 : 0;
      if (p.hist) out.push(P([[-W / 2, H / 2 + 0.25], [-W / 2, H / 2 + 0.25 + histH], [W / 2, H / 2 + 0.25 + histH]], false, p.frame, 2));
      out.push({ k: 'dyn', bb: [-W / 2, -H / 2 - (p.counts ? 0.6 : 0), W / 2, H / 2 + (p.hist ? 0.35 + histH : 0)], draw: (ctx, lt, pi, cf, scale) => {
        const S = simulate(p), t = clamp(lt, 0, p.maxT), f = t / DT, k0 = Math.min(S.steps - 1, Math.floor(f)), k1 = Math.min(S.steps - 1, k0 + 1), u = f - k0;
        const c1 = cf ? cf(col(p.color)) : col(p.color), c2 = cf ? cf(col(p.accent)) : col(p.accent);
        const R = 0.055, shown = Math.round(S.n * clamp(pi, 0, 1)), bins = new Array(24).fill(0);
        let left = 0;
        for (let i = 0; i < shown; i++) {
          const x = S.X[i * S.steps + k0] * (1 - u) + S.X[i * S.steps + k1] * u, y = S.Y[i * S.steps + k0] * (1 - u) + S.Y[i * S.steps + k1] * u;
          const crossed = p.barrier === 'membrane' && (x < 0 ? 0 : 1) !== S.side0[i];
          ctx.fillStyle = crossed ? c2 : c1; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
          if (x < 0) left++;
          bins[clamp(Math.floor((x + W / 2) / W * 24), 0, 23)]++;
        }
        if (p.hist && shown) {
          const mx = Math.max(4, ...bins), base = H / 2 + 0.25;
          ctx.fillStyle = c1; ctx.globalAlpha *= 0.75;
          for (let b = 0; b < 24; b++) { const hh = bins[b] / mx * histH; ctx.fillRect(-W / 2 + b * W / 24 + 0.02, base + histH - hh, W / 24 - 0.04, hh); }
          ctx.globalAlpha /= 0.75;
        }
        if (p.counts && shown) {
          ctx.save(); ctx.scale(0.01, 0.01); ctx.fillStyle = c1; ctx.font = '600 26px "IBM Plex Sans", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('left ' + left, -W / 4 * 100, (-H / 2 - 0.32) * 100); ctx.fillText('right ' + (shown - left), W / 4 * 100, (-H / 2 - 0.32) * 100);
          ctx.restore();
        }
      } });
      return out;
    }
  };

  /* ---------------- charts from CSV ---------------- */
  function parseCSV(text) {
    const rows = String(text || '').trim().split(/\r?\n/).map(l => l.split(/[,\t;](?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c => c.trim().replace(/^"(.*)"$/, '$1').replace(/""/g, '"'))).filter(r => r.length && r.some(c => c));
    if (!rows.length) return { head: [], rows: [] };
    const numeric = r => r.slice(1).some(c => c !== '' && isFinite(+c));
    const head = numeric(rows[0]) ? rows[0].map((_, i) => 'col' + i) : rows.shift();
    return { head, rows };
  }
  const SERIES = ['BLUE', 'GOLD', 'GREEN', 'RED', 'PURPLE', 'TEAL'];
  function niceTicks(lo, hi, n) {
    const span = hi - lo || 1, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0))), st = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || mag * 10;
    const out = []; for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) out.push(Math.round(v * 1e6) / 1e6); return out;
  }
  const fmt = v => Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 10 ? (+v.toFixed(1)).toString() : (+v.toFixed(2)).toString();
  A.TYPES.chart = {
    label: 'Chart', icon: '▥',
    defaults: { kind: 'forest', csv: 'study,estimate,low,high,weight\nStudy A,1.42,1.05,1.92,12\nStudy B,1.18,0.86,1.61,10\nStudy C,1.65,1.22,2.23,14\nStudy D,0.94,0.62,1.42,8\nStudy E,1.37,1.10,1.71,18\nPooled,1.31,1.16,1.48,0',
      title: 'Example data', xlabel: '', ylabel: '', w: 7, h: 4, color: 'BLUE', accent: 'GOLD', axis: 'WHITE', log: true, ref: 1 },
    fields: [['kind', 'Chart', 'select', [['bar', 'Bar chart'], ['line', 'Line graph'], ['scatter', 'Scatter plot'], ['forest', 'Forest plot (meta-analysis)'], ['pie', 'Pie chart'], ['donut', 'Donut chart']]],
      ['csv', 'Data (CSV: first row = headings)', 'textarea'], ['title', 'Title', 'text'], ['xlabel', 'x-axis label', 'text', null, p => !['forest', 'pie', 'donut'].includes(p.kind)], ['ylabel', 'y-axis label', 'text'],
      ['log', 'Log scale (ratios)', 'bool', null, p => p.kind === 'forest'], ['ref', 'Line of no effect', 'num', 0.5, p => p.kind === 'forest'],
      ['w', 'Width', 'num', 0.5], ['h', 'Height', 'num', 0.5], ['color', 'Colour', 'color'], ['accent', 'Accent (pooled / 2nd series)', 'color'], ['axis', 'Axes', 'color']],
    build: p => {
      const { head, rows } = parseCSV(p.csv), W = p.w, H = p.h, out = [], ax = p.axis;
      if (p.title) out.push(...label(p.title, 0, -H / 2 - 0.45, 0.32, ax));
      if (!rows.length) { out.push(P([[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]], true, ax, 2)); out.push(...label('Paste CSV data', 0, 0, 0.3, ax)); return out; }
      if (p.kind === 'pie' || p.kind === 'donut') {
        // the first number column; one slice per row, with a key on the right
        const vals = rows.map(r => Math.max(0, +r[1] || 0)), tot = vals.reduce((x, y) => x + y, 0) || 1, R = Math.min(H / 2, W * 0.3), cx = -W / 2 + R + 0.1, inner = p.kind === 'donut' ? R * 0.55 : 0;
        const PIE = [p.color, p.accent, 'GREEN', 'RED', 'PURPLE', 'TEAL', 'PINK', 'ORANGE', 'YELLOW', 'GREY'];
        let a0 = -Math.PI / 2;
        rows.forEach((r, i) => {
          const da = vals[i] / tot * Math.PI * 2; if (da <= 0) return; const c = PIE[i % PIE.length], n = Math.max(3, Math.ceil(da / 0.08)), pts = [];
          for (let k = 0; k <= n; k++) { const an = a0 + da * k / n; pts.push([cx + Math.cos(an) * R, Math.sin(an) * R]); }
          for (let k = n; k >= 0; k--) { const an = a0 + da * k / n; pts.push(inner ? [cx + Math.cos(an) * inner, Math.sin(an) * inner] : [cx, 0]); }
          out.push(P(pts, true, '#15161A', 2, c, 0.92));
          const mid = a0 + da / 2, pct = Math.round(vals[i] / tot * 100);
          if (pct >= 6) out.push(...label(pct + '%', cx + Math.cos(mid) * (inner ? (R + inner) / 2 : R * 0.62), Math.sin(mid) * (inner ? (R + inner) / 2 : R * 0.62), 0.2, '#111111'));
          const ky = -Math.min(H / 2, rows.length * 0.2) + i * 0.4 + 0.2, kx = cx + R + 0.5;
          out.push(P([[kx, ky - 0.1], [kx + 0.2, ky - 0.1], [kx + 0.2, ky + 0.1], [kx, ky + 0.1]], true, c, 1, c, 1));
          out.push(...label(r[0] + ' · ' + fmt(vals[i]), kx + 0.32, ky, 0.22, ax, 'left'));
          a0 += da;
        });
        if (p.ylabel && inner) out.push(...label(p.ylabel, cx, 0, 0.22, ax));
        return out;
      }
      if (p.kind === 'forest') {
        const L = -W / 2 + W * 0.32, Rr = W / 2, n = rows.length, rowH = H / n;
        const tr = v => p.log ? Math.log(Math.max(1e-6, v)) : v;
        let lo = Infinity, hi = -Infinity; for (const r of rows) { lo = Math.min(lo, tr(+r[2] || +r[1])); hi = Math.max(hi, tr(+r[3] || +r[1])); }
        lo = Math.min(lo, tr(p.ref)); hi = Math.max(hi, tr(p.ref)); const pad = (hi - lo) * 0.08 || 0.1; lo -= pad; hi += pad;
        const X = v => L + (tr(v) - lo) / (hi - lo) * (Rr - L);
        const maxW = Math.max(1, ...rows.map(r => +r[4] || 0));
        rows.forEach((r, i) => {
          const y = -H / 2 + rowH * (i + 0.5), est = +r[1], l = +r[2], u = +r[3], pooled = /pool|overall|total|summary/i.test(r[0]);
          out.push(...label(r[0], -W / 2, y, 0.24, pooled ? p.accent : ax, 'left'));
          if (pooled) out.push(P([[X(l), y], [X(est), y - rowH * 0.28], [X(u), y], [X(est), y + rowH * 0.28]], true, p.accent, 2, p.accent, 1));
          else {
            out.push(P([[X(l), y], [X(u), y]], false, p.color, 3));
            const s = 0.06 + 0.12 * Math.sqrt((+r[4] || maxW * 0.5) / maxW);
            out.push(P([[X(est) - s, y - s], [X(est) + s, y - s], [X(est) + s, y + s], [X(est) - s, y + s]], true, p.color, 1, p.color, 1));
          }
        });
        for (let y = -H / 2; y < H / 2; y += 0.2) out.push(P([[X(p.ref), y], [X(p.ref), Math.min(H / 2, y + 0.11)]], false, ax, 2));
        out.push(P([[L, H / 2 + 0.05], [Rr, H / 2 + 0.05]], false, ax, 2));
        const ticks = p.log ? [0.25, 0.5, 1, 2, 4, 8].filter(v => tr(v) >= lo && tr(v) <= hi) : niceTicks(lo, hi, 5);
        for (const v of ticks) { out.push(P([[X(v), H / 2 + 0.05], [X(v), H / 2 + 0.15]], false, ax, 2)); out.push(...label(fmt(v), X(v), H / 2 + 0.38, 0.2, ax)); }
        if (p.ylabel) out.push(...label(p.ylabel, (L + Rr) / 2, H / 2 + 0.75, 0.22, ax));
        return out;
      }
      // bar, line, scatter share axes
      const L = -W / 2 + 0.6, B = H / 2 - 0.5, T = -H / 2, Rr = W / 2;
      const nser = Math.max(1, head.length - 1), cats = rows.map(r => r[0]);
      const vals = rows.map(r => r.slice(1).map(Number));
      const catX = p.kind !== 'bar' && rows.some(r => r[0] === '' || !isFinite(+r[0])), xs = p.kind === 'bar' ? null : rows.map((r, i) => catX ? i + 1 : +r[0]);
      let ylo = Math.min(0, ...vals.flat().filter(isFinite)), yhi = Math.max(...vals.flat().filter(isFinite)); if (!(yhi > ylo)) yhi = ylo + 1;
      const yt = niceTicks(ylo, yhi, 5); ylo = Math.min(ylo, yt[0]); yhi = Math.max(yhi, yt[yt.length - 1]);
      const Y = v => B - (v - ylo) / (yhi - ylo) * (B - T);
      out.push(P([[L, T], [L, B], [Rr, B]], false, ax, 3));
      for (const v of yt) { out.push(P([[L - 0.1, Y(v)], [L, Y(v)]], false, ax, 2)); out.push(...label(fmt(v), L - 0.32, Y(v), 0.2, ax)); }
      if (p.ylabel) out.push(...label(p.ylabel, L, T - 0.25, 0.22, ax));
      if (p.xlabel) out.push(...label(p.xlabel, (L + Rr) / 2, B + 0.75, 0.22, ax));
      if (p.kind === 'bar') {
        const gw = (Rr - L) / rows.length, bw = gw * 0.7 / nser;
        rows.forEach((r, i) => {
          out.push(...label(cats[i], L + gw * (i + 0.5), B + 0.3, 0.2, ax));
          for (let s = 0; s < nser; s++) { const v = vals[i][s]; if (!isFinite(v)) continue; const x0 = L + gw * i + gw * 0.15 + bw * s, c = s ? (s === 1 ? p.accent : SERIES[s % 6]) : p.color; out.push(P([[x0, Y(0)], [x0, Y(v)], [x0 + bw, Y(v)], [x0 + bw, Y(0)]], true, c, 2, c, 0.85)); }
        });
        if (nser > 1) head.slice(1).forEach((hd, s) => { const c = s ? (s === 1 ? p.accent : SERIES[s % 6]) : p.color, x = Rr - 1.4, y = T + 0.15 + s * 0.32; out.push(P([[x, y - 0.1], [x + 0.2, y - 0.1], [x + 0.2, y + 0.1], [x, y + 0.1]], true, c, 1, c, 0.85)); out.push(...label(hd, x + 0.3, y, 0.2, c, 'left')); });
      } else {
        let xlo = Math.min(...xs.filter(isFinite)), xhi = Math.max(...xs.filter(isFinite)); if (!(xhi > xlo)) xhi = xlo + 1;
        const xt = catX ? [] : niceTicks(xlo, xhi, 6); if (catX) { xlo -= 0.5; xhi += 0.5; } else { xlo = Math.min(xlo, xt[0]); xhi = Math.max(xhi, xt[xt.length - 1]); }
        const X = v => L + (v - xlo) / (xhi - xlo) * (Rr - L);
        if (catX) rows.forEach((r, i) => { out.push(P([[X(i + 1), B], [X(i + 1), B + 0.1]], false, ax, 2)); out.push(...label(r[0], X(i + 1), B + 0.32, 0.2, ax)); });
        else for (const v of xt) { out.push(P([[X(v), B], [X(v), B + 0.1]], false, ax, 2)); out.push(...label(fmt(v), X(v), B + 0.32, 0.2, ax)); }
        for (let s = 0; s < nser; s++) {
          const c = s ? (s === 1 ? p.accent : SERIES[s % 6]) : p.color, pts = rows.map((r, i) => [X(xs[i]), Y(vals[i][s])]).filter(([a, b]) => isFinite(a) && isFinite(b));
          if (p.kind === 'line') out.push(P(pts, false, c, 5));
          for (const [a, b] of pts) { const cc = []; for (let k = 0; k < 14; k++) { const an = k / 14 * Math.PI * 2; cc.push([a + Math.cos(an) * 0.07, b + Math.sin(an) * 0.07]); } out.push(P(cc, true, c, 1, c, 1)); }
        }
        if (nser > 1) head.slice(1).forEach((hd, s) => out.push(...label('— ' + hd, Rr - 0.9, T + 0.2 + s * 0.3, 0.2, s ? (s === 1 ? p.accent : SERIES[s % 6]) : p.color)));
      }
      return out;
    }
  };

  /* ---------------- table: CSV in rows and columns (from Calsheet, Logos or typed in) ---------------- */
  function cells(text) {
    // quoted CSV, so commas inside a cell survive
    const rows = []; let row = [], cur = '', q = false; const t = String(text || '');
    for (let i = 0; i < t.length; i++) { const ch = t[i]; if (q) { if (ch === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; } else if (ch === '"') q = true; else if (ch === ',' || ch === '\t') { row.push(cur.trim()); cur = ''; } else if (ch === '\n') { row.push(cur.trim()); rows.push(row); row = []; cur = ''; } else if (ch !== '\r') cur += ch; }
    if (cur !== '' || row.length) { row.push(cur.trim()); rows.push(row); }
    return rows.filter(r => r.some(c => c !== ''));
  }
  const widthOf = (text, size) => { try { const b = A.build({ type: 'text', props: { text: String(text) || ' ', size, color: 'WHITE', font: 'sans', align: 'center' } }); return b.bb[2] - b.bb[0]; } catch (e) { return String(text).length * size * 0.55; } };
  A.TYPES.table = {
    label: 'Table', icon: '▦',
    defaults: { csv: 'Gene,Control,Treated\nCLDN5,4.1,6.2\nOCLN,3.3,5.1\nZO-1,2.8,4.9', header: true, stripes: true, lines: 'rows', size: 0.26, title: '', color: 'WHITE', accent: 'BLUE', fill: '#1E2230', numAlign: 'right' },
    fields: [['csv', 'Cells (CSV: one row per line)', 'textarea'], ['title', 'Title', 'text'], ['header', 'First row is headings', 'bool'], ['stripes', 'Striped rows', 'bool'],
      ['lines', 'Lines', 'select', [['rows', 'Between rows'], ['grid', 'Full grid'], ['none', 'None']]], ['size', 'Text size', 'num', 0.02], ['numAlign', 'Numbers', 'select', [['right', 'Right-aligned'], ['center', 'Centred'], ['left', 'Left-aligned']]],
      ['color', 'Text', 'color'], ['accent', 'Headings', 'color'], ['fill', 'Stripe colour', 'color']],
    build: p => {
      const rows = cells(p.csv), out = [], sz = Math.max(0.08, p.size || 0.26);
      if (!rows.length) { out.push(...label('Type rows of cells, commas between them', 0, 0, 0.24, p.color)); return out; }
      const nc = Math.max(...rows.map(r => r.length)), padX = sz * 0.7, rh = sz * 1.9;
      const cw = []; for (let c = 0; c < nc; c++) cw.push(Math.max(sz * 1.5, ...rows.map(r => widthOf(r[c] || '', sz))) + padX * 2);
      const W = cw.reduce((a, b) => a + b, 0), titleH = p.title ? sz * 2.2 : 0, H = rows.length * rh + titleH, x0 = -W / 2, y0 = -H / 2 + titleH;
      if (p.title) out.push(...label(p.title, 0, -H / 2 + sz * 0.8, sz * 1.25, p.color));
      const isNum = v => v !== '' && /^[-+−]?[£$€]?[\d,]*\.?\d+(e[-+]?\d+)?%?$/i.test(v);
      rows.forEach((r, i) => {
        const y = y0 + i * rh, head = p.header && i === 0;
        if (head) out.push(P([[x0, y], [x0 + W, y], [x0 + W, y + rh], [x0, y + rh]], true, null, 0, p.accent, 0.35));
        else if (p.stripes && (i - (p.header ? 1 : 0)) % 2 === 1) out.push(P([[x0, y], [x0 + W, y], [x0 + W, y + rh], [x0, y + rh]], true, null, 0, p.fill, 0.9));
        let x = x0;
        for (let c = 0; c < nc; c++) {
          const v = (r[c] || '').replace(/\$/g, '＄'); if (v) { const al = !head && isNum(v) ? p.numAlign : c === 0 || head ? 'left' : 'left'; const tx = al === 'right' ? x + cw[c] - padX : al === 'center' ? x + cw[c] / 2 : x + padX; out.push(...label(v, tx, y + rh / 2, sz, head ? p.accent : p.color, al === 'center' ? null : al)); }
          x += cw[c];
        }
        if (p.lines !== 'none' && i > 0) out.push(P([[x0, y], [x0 + W, y]], false, p.color, head || (p.header && i === 1) ? 2.5 : 1, null));
      });
      if (p.lines === 'grid') { out.push(P([[x0, y0], [x0 + W, y0], [x0 + W, y0 + rows.length * rh], [x0, y0 + rows.length * rh]], true, p.color, 2)); let x = x0; for (let c = 0; c < nc - 1; c++) { x += cw[c]; out.push(P([[x, y0], [x, y0 + rows.length * rh]], false, p.color, 1)); } }
      else if (p.lines === 'rows') { out.push(P([[x0, y0], [x0 + W, y0]], false, p.color, 2.5)); out.push(P([[x0, y0 + rows.length * rh], [x0 + W, y0 + rows.length * rh]], false, p.color, 2.5)); }
      return out;
    }
  };

  /* ---------------- periodic table: five looks, highlights, a legend, and cells that appear in order ---------------- */
  const PT_STYLES = [['classic', 'Classic (dark, tinted by family)'], ['solid', 'Solid colours'], ['blocks', 'By block (s, p, d, f)'], ['mono', 'Line (one colour)'], ['neon', 'Neon glow']];
  function ptMatch(p) {
    const E = window.Elements, q = String(p.highlight || '').trim();
    if (!q || !E) return null;
    const set = new Set();
    for (const tok of q.split(/[,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean)) {
      const e = E.find(tok); if (e) { set.add(e.z); continue; }
      const bk = tok.replace(/[-\s]*block$/, ''); if (/^[spdf]$/.test(bk)) { E.list.forEach(x => { if (x.block === bk) set.add(x.z); }); continue; }
      const per = tok.match(/^period\s*(\d)$/); if (per) { E.list.forEach(x => { if (x.period === +per[1]) set.add(x.z); }); continue; }
      const grp = tok.match(/^group\s*(\d+)$/); if (grp) { E.list.forEach(x => { if (x.group === +grp[1]) set.add(x.z); }); continue; }
      for (const [k, c] of Object.entries(E.CATS)) if (k === tok || c.label.toLowerCase().startsWith(tok.replace(/s$/, '')) || (tok.startsWith('noble') && k === 'noble') || (tok.startsWith('alkaline') && k === 'alkaline') || (tok.startsWith('halogen') && k === 'halogen')) E.list.forEach(x => { if (x.cat === k) set.add(x.z); });
    }
    return set;
  }
  A.TYPES.ptable = {
    label: 'Periodic table', icon: '▦',
    defaults: { style: 'classic', details: 'full', highlight: '', legend: true, title: '', w: 11, color: 'WHITE' },
    fields: [['style', 'Style', 'select', PT_STYLES], ['details', 'In each cell', 'select', [['full', 'Number, symbol, name and mass'], ['number', 'Number and symbol'], ['symbol', 'Symbol only']]],
      ['highlight', 'Highlight (e.g. Na, Cl · halogens · group 1 · period 3 · d-block)', 'text'], ['legend', 'Key', 'bool'], ['title', 'Title', 'text'], ['w', 'Width', 'num', 0.25],
      ['color', 'Line and text colour', 'color', null, p => p.style === 'mono' || p.style === 'neon']],
    build: p => {
      const E = window.Elements; if (!E) return [];
      const w = Math.max(3, p.w), c = w / 18, titleH = p.title ? c * 1.1 : 0, legH = p.legend ? c * (p.style === 'blocks' ? 0.9 : 1.6) : 0;
      const H = titleH + c * 9.5 + legH, top = -H / 2, left = -w / 2;
      const hi = ptMatch(p);
      return [{ k: 'dyn', bb: [-w / 2, -H / 2, w / 2, H / 2], draw: (ctx, lt, pi, cf, scale) => {
        const C = x => (cf ? cf(x) : x), st = p.style || 'classic', line = col(p.color || 'WHITE');
        const fam = e => st === 'blocks' ? E.BLOCKS[e.block].color : E.CATS[e.cat].color;
        const font = (wt, px) => wt + ' ' + Math.max(1, px) + 'px "IBM Plex Sans", system-ui, sans-serif';
        ctx.save(); ctx.scale(0.01, 0.01);
        const S = 100, cc = c * S, pad = cc * 0.06, rad = cc * 0.12;
        const box = (x, y, ww, hh) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, ww, hh, rad); else ctx.rect(x, y, ww, hh); };
        if (p.title) { ctx.fillStyle = C(st === 'solid' || st === 'blocks' ? '#FFFFFF' : line); ctx.font = font(600, cc * 0.62); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(p.title, left * S, (top + titleH * 0.45) * S); }
        const y0 = (top + titleH) * S, x0 = left * S, n = E.list.length;
        const shown = Math.max(0, Math.min(n, pi * n * 1.0001));
        const placeholder = (row, txt) => { const x = x0 + 2 * cc + pad, y = y0 + (row - 1) * cc + pad; ctx.globalAlpha = 0.6 * Math.min(1, pi * 3); ctx.setLineDash([cc * 0.08, cc * 0.08]); ctx.strokeStyle = C(st === 'mono' || st === 'neon' ? line : '#8C93A3'); ctx.lineWidth = cc * 0.025; box(x, y, cc - 2 * pad, cc - 2 * pad); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = ctx.strokeStyle; ctx.font = font(500, cc * 0.18); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, x + (cc - 2 * pad) / 2, y + (cc - 2 * pad) / 2); ctx.globalAlpha = 1; };
        const base = ctx.globalAlpha;
        placeholder(6, '57–71'); placeholder(7, '89–103');
        for (let i = 0; i < n; i++) {
          const e = E.list[i], a = Math.min(1, shown - i); if (a <= 0) break;
          const ry = e.row <= 7 ? e.row - 1 : e.row - 1.5, x = x0 + (e.col - 1) * cc + pad, y = y0 + ry * cc + pad, ww = cc - 2 * pad, k = fam(e);
          const dim = hi && !hi.has(e.z);
          ctx.globalAlpha = base * a * (dim ? 0.22 : 1);
          const pop = hi && !dim ? 1.06 : 1, cx = x + ww / 2, cy = y + ww / 2;
          ctx.save(); ctx.translate(cx, cy); ctx.scale(pop * (0.6 + 0.4 * a), pop * (0.6 + 0.4 * a)); ctx.translate(-cx, -cy);
          let ink = '#FFFFFF', sub = '#C9CDD6';
          if (st === 'classic') { box(x, y, ww, ww); ctx.fillStyle = C('#1B1E26'); ctx.fill(); ctx.globalAlpha *= 0.28; ctx.fillStyle = C(k); ctx.fill(); ctx.globalAlpha /= 0.28; ctx.strokeStyle = C(k); ctx.lineWidth = cc * 0.03; ctx.stroke(); }
          else if (st === 'solid' || st === 'blocks') { box(x, y, ww, ww); ctx.fillStyle = C(k); ctx.fill(); ink = '#12141A'; sub = '#2B2F3A'; }
          else if (st === 'mono') { box(x, y, ww, ww); ctx.strokeStyle = C(line); ctx.lineWidth = cc * 0.022; ctx.stroke(); ink = line; sub = line; }
          else { box(x, y, ww, ww); ctx.fillStyle = C('#0E1018'); ctx.fill(); ctx.shadowColor = C(k); ctx.shadowBlur = cc * 0.25; ctx.strokeStyle = C(k); ctx.lineWidth = cc * 0.035; ctx.stroke(); ctx.shadowBlur = 0; ink = k; sub = '#DDE1EA'; }
          ctx.fillStyle = C(ink); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          const det = p.details || 'full';
          if (det === 'symbol') { ctx.font = font(700, ww * 0.46); ctx.fillText(e.sym, cx, cy + ww * 0.02); }
          else {
            ctx.font = font(500, ww * 0.2); ctx.textAlign = 'left'; ctx.fillStyle = C(sub); ctx.fillText(String(e.z), x + ww * 0.1, y + ww * 0.17);
            ctx.textAlign = 'center'; ctx.fillStyle = C(ink);
            if (det === 'number') { ctx.font = font(700, ww * 0.42); ctx.fillText(e.sym, cx, cy + ww * 0.1); }
            else {
              ctx.font = font(700, ww * 0.36); ctx.fillText(e.sym, cx, cy - ww * 0.02);
              ctx.fillStyle = C(sub); let nm = e.name, fs = ww * 0.15; ctx.font = font(500, fs); while (ctx.measureText(nm).width > ww * 0.92 && fs > ww * 0.08) { fs *= 0.92; ctx.font = font(500, fs); }
              ctx.fillText(nm, cx, y + ww * 0.72);
              ctx.font = font(400, ww * 0.13); ctx.fillText(e.stable ? (+e.mass.toPrecision(e.mass < 10 ? 4 : 5)).toString() : e.massText, cx, y + ww * 0.88);
            }
          }
          ctx.restore();
        }
        ctx.globalAlpha = base;
        if (p.legend && pi > 0.6 && p.style !== 'mono') {
          ctx.globalAlpha = base * Math.min(1, (pi - 0.6) / 0.3);
          const items = st === 'blocks' ? Object.values(E.BLOCKS) : Object.values(E.CATS), per = st === 'blocks' ? 4 : 6;
          const ly = y0 + 9.5 * cc + cc * 0.25, colW = (w * S) / per;
          ctx.font = font(500, cc * 0.24); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          items.forEach((it, i) => {
            const lx = x0 + (i % per) * colW, yy = ly + Math.floor(i / per) * cc * 0.55, k = it.color;
            box(lx, yy - cc * 0.16, cc * 0.32, cc * 0.32);
            if (st === 'mono') { ctx.strokeStyle = C(line); ctx.lineWidth = cc * 0.02; ctx.stroke(); } else { ctx.fillStyle = C(k); ctx.fill(); }
            ctx.fillStyle = C(st === 'mono' ? line : '#D8DCE5'); ctx.fillText(it.label, lx + cc * 0.45, yy);
          });
        }
        ctx.restore();
      } }];
    }
  };
  window.Sci2D = { parseCSV };
})();

/* Psi Phi Studio · 3D layer.
   Psi Phi Studio's 3D engine (three.js) living underneath Animath's 2D layer. 3D things are ordinary Animath
   objects on the timeline: their clip, entrance/exit animations, parenting, keyframed position, scale
   and rotation all come from Animath, and this module turns them into a shared 3D scene that is drawn
   behind the 2D layer every frame (preview, still images and video export all go through it).
   1 frame unit = 10 Å when an object is shown at true size; otherwise objects are fitted to ~2.5 units. */
(function () {
  'use strict';
  const A = window.Animath;
  const THREE = window.THREE;
  const OK = !!THREE;
  let pdfjsP = null;
  const toast = (m) => { if (window.Bio3D && window.Bio3D.toast) window.Bio3D.toast(m); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = x => x * x * (3 - 2 * x);
const DEG = Math.PI / 180;
const CHAIN_COLS = ['#58C4DD','#83C167','#F0AC5F','#9A72AC','#FC6255','#5CD0B3','#F7D96F','#C55F73'];
const SS_COL = { H:'#FC6255', E:'#F7D96F', C:'#C9CFD8', N:'#83C167' };
const ELEM = { H:'#F2F2F2', C:'#9aa3b0', N:'#5b8def', O:'#FC6255', S:'#F7D96F', P:'#F0AC5F', FE:'#E0703A', MG:'#83C167', ZN:'#8E9BD8', CA:'#83C167', CL:'#5CD0B3', NA:'#9A72AC', K:'#9A72AC', SE:'#F0AC5F' };
const VDW = { H:1.1, C:1.7, N:1.55, O:1.52, S:1.8, P:1.8, FE:1.4, ZN:1.39, MG:1.73, CA:1.9, CL:1.75, NA:2.27, K:2.75, SE:1.9 };
const COV = { H:.31, C:.76, N:.71, O:.66, S:1.05, P:1.07, SE:1.2, BR:1.2, CL:1.02, F:.57, I:1.39 };
const METALS = new Set(['FE','ZN','MG','CA','NA','K','MN','CU','CO','NI','CD','HG']);
const WATER = new Set(['HOH','WAT','DOD','H2O']);
const DIMS = { H:[1.5,0.28], E:[1.25,0.32], C:[0.32,0.32], N:[0.55,0.55] };
const MEM_HALF = 19, TAIL_LEN = 15;
const JL = 130;   // patch extent (Å) along y and z
const AA3 = { L:'LEU', E:'GLU', K:'LYS', A:'ALA', G:'GLY', D:'ASP', S:'SER', I:'ILE', R:'ARG', Q:'GLN', P:'PRO' };
const VALENCE = { B:[3], C:[4], N:[3,5], O:[2], P:[3,5], S:[2,4,6], F:[1], CL:[1], BR:[1], I:[1] };
const colCache = {};
const C3 = hex => colCache[hex] || (colCache[hex] = new THREE.Color(hex));
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const MAX_PAGES = 12;
const MOL_PRESETS = [
  ['Glucose', 'OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O'],
  ['Caffeine', 'Cn1cnc2c1c(=O)n(C)c(=O)n2C'],
  ['Dopamine', 'NCCc1ccc(O)c(O)c1'],
  ['L-DOPA', 'N[C@@H](Cc1ccc(O)c(O)c1)C(=O)O'],
  ['Ethanol', 'CCO'],
  ['Aspirin', 'CC(=O)Oc1ccccc1C(=O)O'],
  ['Cholesterol', 'CC(C)CCC[C@@H](C)[C@H]1CC[C@H]2[C@@H]3CC=C4C[C@@H](O)CC[C@]4(C)[C@H]3CC[C@]12C'],
  ['Water', 'O'] ];

function hash01(i) { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
function parsePDB(text) {
  const atoms = [], ranges = [];
  const lines = text.split(/\r?\n/);
  for (const ln of lines) {
    const rec = ln.slice(0, 6);
    if (rec === 'ENDMDL') break;
    if (rec === 'ATOM  ' || rec === 'HETATM') {
      const alt = ln[16] || ' ';
      if (alt !== ' ' && alt !== 'A' && alt !== '1') continue;
      const name = ln.slice(12, 16).trim();
      let el = ln.slice(76, 78).trim().toUpperCase();
      if (!el) el = name.replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase();
      atoms.push({ name, resName: ln.slice(17, 20).trim(), chain: (ln[21] || 'A').trim() || 'A', resSeq: parseInt(ln.slice(22, 26)), ic: (ln[26] || '').trim(),
        x: parseFloat(ln.slice(30, 38)), y: parseFloat(ln.slice(38, 46)), z: parseFloat(ln.slice(46, 54)), el, het: rec === 'HETATM' });
    } else if (rec === 'HELIX ') {
      ranges.push({ type:'H', chain: ln[19], start: parseInt(ln.slice(21, 25)), end: parseInt(ln.slice(33, 37)) });
    } else if (rec === 'SHEET ') {
      ranges.push({ type:'E', chain: ln[21], start: parseInt(ln.slice(22, 26)), end: parseInt(ln.slice(33, 37)) });
    }
  }
  return { atoms: atoms.filter(a => isFinite(a.x)), ranges };
}
function cifLoops(text) {
  const lines = text.split(/\r?\n/); const loops = {}; let i = 0;
  const tok = /'(?:[^']|'(?=\S))*'|"(?:[^"])*"|\S+/g;
  while (i < lines.length) {
    if (lines[i].trim() === 'loop_') {
      i++; const heads = [];
      while (i < lines.length && lines[i].trim().startsWith('_')) { heads.push(lines[i].trim().split(/\s+/)[0]); i++; }
      if (!heads.length) continue;
      const cat = heads[0].split('.')[0];
      const fields = heads.map(h => h.split('.')[1]);
      const rows = []; let buf = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        if (t === 'loop_' || t.startsWith('_') || t.startsWith('data_') || t === '#') break;
        if (t.startsWith(';')) { i++; continue; }
        const parts = t.match(tok) || [];
        for (const p of parts) buf.push(p.replace(/^['"]|['"]$/g, ''));
        while (buf.length >= fields.length) rows.push(buf.splice(0, fields.length));
        i++;
      }
      loops[cat] = { fields, rows };
    } else i++;
  }
  return loops;
}
function parseCIF(text) {
  const L = cifLoops(text); const atoms = [], ranges = [];
  const A = L['_atom_site'];
  if (A) {
    const f = n => A.fields.indexOf(n);
    const iG = f('group_PDB'), iEl = f('type_symbol'), iName = f('auth_atom_id') >= 0 ? f('auth_atom_id') : f('label_atom_id'),
      iRes = f('auth_comp_id') >= 0 ? f('auth_comp_id') : f('label_comp_id'), iCh = f('auth_asym_id') >= 0 ? f('auth_asym_id') : f('label_asym_id'),
      iSeq = f('auth_seq_id') >= 0 ? f('auth_seq_id') : f('label_seq_id'), iX = f('Cartn_x'), iY = f('Cartn_y'), iZ = f('Cartn_z'),
      iAlt = f('label_alt_id'), iMod = f('pdbx_PDB_model_num'), iIc = f('pdbx_PDB_ins_code');
    let model = null;
    for (const r of A.rows) {
      if (iMod >= 0) { if (model === null) model = r[iMod]; else if (r[iMod] !== model) break; }
      if (iAlt >= 0 && r[iAlt] !== '.' && r[iAlt] !== '?' && r[iAlt] !== 'A') continue;
      atoms.push({ name: r[iName], resName: r[iRes], chain: r[iCh], resSeq: parseInt(r[iSeq]), ic: iIc >= 0 && r[iIc] !== '?' ? r[iIc] : '',
        x: +r[iX], y: +r[iY], z: +r[iZ], el: (r[iEl] || 'C').toUpperCase(), het: r[iG] === 'HETATM' });
    }
  }
  for (const [cat, type] of [['_struct_conf', 'H'], ['_struct_sheet_range', 'E']]) {
    const C = L[cat]; if (!C) continue;
    const f = n => C.fields.indexOf(n);
    const iC = f('beg_auth_asym_id'), iS = f('beg_auth_seq_id'), iE = f('end_auth_seq_id'), iT = f('conf_type_id');
    if (iC < 0 || iS < 0 || iE < 0) continue;
    for (const r of C.rows) {
      if (type === 'H' && iT >= 0 && !/^HELX/.test(r[iT])) continue;
      ranges.push({ type, chain: r[iC], start: parseInt(r[iS]), end: parseInt(r[iE]) });
    }
  }
  return { atoms: atoms.filter(a => isFinite(a.x) && !isNaN(a.resSeq)), ranges };
}
function buildStruct(raw, name) {
  const atoms = raw.atoms.filter(a => raw.keepH || (a.el !== 'H' && a.el !== 'D'));
  if (!atoms.length) return null;
  const res = [], resIndex = {}; let prevKey = null, cur = null;
  atoms.forEach((a, i) => {
    const key = a.chain + '|' + a.resSeq + '|' + (a.ic || '');
    if (key !== prevKey) {
      cur = { resName: a.resName, chain: a.chain, resSeq: a.resSeq, atoms: [], het: a.het, water: WATER.has(a.resName), ca: -1, p: -1 };
      res.push(cur);
      const rk = a.chain + '|' + a.resSeq; if (resIndex[rk] === undefined) resIndex[rk] = res.length - 1;
      prevKey = key;
    }
    a.ri = res.length - 1; a.water = cur.water; cur.atoms.push(i);
    if (a.name === 'CA' && a.el === 'C') cur.ca = i;
    if (a.name === 'P') cur.p = i;
  });
  let cx = 0, cy = 0, cz = 0, n = 0;
  for (const a of atoms) if (!a.water) { cx += a.x; cy += a.y; cz += a.z; n++; }
  if (!n) { for (const a of atoms) { cx += a.x; cy += a.y; cz += a.z; } n = atoms.length; }
  cx /= n; cy /= n; cz /= n;
  let rad = 0;
  for (const a of atoms) { a.x -= cx; a.y -= cy; a.z -= cz; if (!a.water) rad = Math.max(rad, Math.hypot(a.x, a.y, a.z)); }
  const chains = [];
  for (const r of res) {
    if (r.water) r.kind = 'water';
    else if (r.ca >= 0 && (!r.het || r.resName === 'MSE')) r.kind = 'prot';
    else if (r.p >= 0 && !r.het) r.kind = 'nuc';
    else r.kind = 'lig';
    const t = r.kind === 'prot' ? r.ca : r.kind === 'nuc' ? r.p : -1;
    if (t >= 0) r.pos = [atoms[t].x, atoms[t].y, atoms[t].z];
    else { let x = 0, y = 0, z = 0; for (const i of r.atoms) { x += atoms[i].x; y += atoms[i].y; z += atoms[i].z; } const m = r.atoms.length; r.pos = [x / m, y / m, z / m]; }
    if (!chains.includes(r.chain)) chains.push(r.chain);
    r.chainIdx = chains.indexOf(r.chain);
  }
  const segs = []; let seg = null, prev = null;
  res.forEach((r, i) => {
    if (r.kind !== 'prot' && r.kind !== 'nuc') { seg = null; prev = null; return; }
    const lim = r.kind === 'prot' ? 4.3 : 8.0;
    if (seg && prev && prev.chain === r.chain && prev.kind === r.kind && dist3(prev.pos, r.pos) < lim) seg.push(i);
    else { seg = [i]; segs.push(seg); }
    prev = r;
  });
  const counts = {}, seen = {};
  for (const r of res) if (r.kind === 'prot' || r.kind === 'nuc') counts[r.chain] = (counts[r.chain] || 0) + 1;
  for (const r of res) { r.ss = r.kind === 'nuc' ? 'N' : 'C'; if (counts[r.chain]) { seen[r.chain] = (seen[r.chain] || 0) + 1; r.frac = counts[r.chain] > 1 ? (seen[r.chain] - 1) / (counts[r.chain] - 1) : 0; } else r.frac = 0; }
  if (raw.ranges.length) {
    for (const g of raw.ranges) for (const r of res) if (r.kind === 'prot' && r.chain === g.chain && r.resSeq >= g.start && r.resSeq <= g.end) r.ss = g.type;
  } else estimateSS(res, segs);
  return { name, atoms, res, resIndex, segs, radius: Math.max(rad, 5), chains, nPoly: Object.values(counts).reduce((s, c) => s + c, 0) };
}
function estimateSS(res, segs) {
  const L = [];
  segs.forEach((seg, si) => {
    if (res[seg[0]].kind !== 'prot') return;
    const P = seg.map(i => res[i].pos), n = P.length, hm = new Array(n).fill(false);
    for (let i = 0; i + 4 < n; i++) {
      const d3 = dist3(P[i], P[i + 3]), d4 = dist3(P[i], P[i + 4]);
      hm[i] = d3 > 4.4 && d3 < 5.9 && d4 > 5.3 && d4 < 6.9;
    }
    for (let i = 0; i < n; i++) if (hm[i] && ((i > 0 && hm[i - 1]) || hm[i + 1])) for (let k = i; k <= i + 4 && k < n; k++) res[seg[k]].ss = 'H';
    seg.forEach((ri, k) => L.push({ ri, k, si, n }));
  });
  if (L.length > 5000) return;
  const ext = L.map(e => {
    const seg = segs[e.si]; if (e.k === 0 || e.k === e.n - 1) return false;
    return dist3(res[seg[e.k - 1]].pos, res[seg[e.k + 1]].pos) > 6.0;
  });
  const isE = new Array(L.length).fill(false);
  for (let a = 0; a < L.length; a++) {
    if (!ext[a] || res[L[a].ri].ss === 'H') continue;
    for (let b = 0; b < L.length; b++) {
      if (a === b || res[L[b].ri].ss === 'H') continue;
      if (L[a].si === L[b].si && Math.abs(L[a].k - L[b].k) < 4) continue;
      if (dist3(res[L[a].ri].pos, res[L[b].ri].pos) < 5.5) { isE[a] = true; break; }
    }
  }
  for (let a = 0; a < L.length; a++) {
    const run = isE[a] && ((a > 0 && isE[a - 1] && L[a - 1].si === L[a].si) || (a + 1 < L.length && isE[a + 1] && L[a + 1].si === L[a].si));
    if (run) res[L[a].ri].ss = 'E';
  }
}
function nerf(a, b, c, bond, ang, tor) {
  const bc = new THREE.Vector3().subVectors(c, b).normalize();
  const nn = new THREE.Vector3().subVectors(b, a).cross(bc).normalize();
  const m = new THREE.Vector3().crossVectors(nn, bc);
  const x = -bond * Math.cos(ang), y = bond * Math.sin(ang) * Math.cos(tor), z = bond * Math.sin(ang) * Math.sin(tor);
  return c.clone().addScaledVector(bc, x).addScaledVector(m, y).addScaledVector(nn, z);
}
function idealHelix(n) {
  const V = THREE.Vector3, phi = -57 * DEG, psi = -47 * DEG, om = Math.PI;
  const N = [new V(0, 0, 0)], CA = [new V(1.458, 0, 0)], C = [nerf(new V(0, 1, 0), N[0], CA[0], 1.525, 111 * DEG, -60 * DEG)], O = [];
  for (let i = 0; i < n - 1; i++) {
    N.push(nerf(N[i], CA[i], C[i], 1.329, 116.2 * DEG, psi));
    CA.push(nerf(CA[i], C[i], N[i + 1], 1.458, 121.7 * DEG, om));
    C.push(nerf(C[i], N[i + 1], CA[i + 1], 1.525, 111 * DEG, phi));
    O.push(nerf(N[i + 1], CA[i], C[i], 1.231, 120.5 * DEG, Math.PI));
  }
  O.push(nerf(N[n - 1], CA[n - 1], C[n - 1], 1.231, 120.5 * DEG, psi + Math.PI));
  const CB = CA.map((ca, i) => {
    const b = ca.clone().sub(N[i]), c = C[i].clone().sub(ca), a = b.clone().cross(c);
    return ca.clone().addScaledVector(a, -0.58273431).addScaledVector(b, 0.56802827).addScaledVector(c, -0.54067466);
  });
  return { N, CA, C, O, CB };
}
function demoRaw() {
  const V = THREE.Vector3, atoms = [], ranges = [];
  const corners = [[-5, -5], [5, -5], [5, 5], [-5, 5]];
  const seqs = ['SLEKLAKELEKLAKELEK', 'GEKLAKELEKLIKELEKL', 'SLEKLAKELERLAKELQK', 'GEKLAKELEKLAKELEKL'];
  const loopSeq = 'GDPS';
  let rs = 1; const helices = [];
  for (let h = 0; h < 4; h++) {
    const H = idealHelix(18);
    const mean = (arr, a, b) => { const v = new V(); for (let i = a; i < b; i++) v.add(arr[i]); return v.multiplyScalar(1 / (b - a)); };
    const st = mean(H.CA, 0, 4), en = mean(H.CA, 14, 18);
    const dir = en.clone().sub(st).normalize(), mid = st.clone().add(en).multiplyScalar(0.5);
    const up = new V(0, h % 2 ? -1 : 1, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(dir, up);
    const spin = new THREE.Quaternion().setFromAxisAngle(up, h * 1.3);
    const T = p => p.clone().sub(mid).applyQuaternion(q).applyQuaternion(spin).add(new V(corners[h][0], 0, corners[h][1]));
    for (const k of ['N', 'CA', 'C', 'O', 'CB']) H[k] = H[k].map(T);
    helices.push({ H, up, start: rs });
    rs += 18 + (h < 3 ? 4 : 0);
  }
  const push = (name, resName, resSeq, p, el) => atoms.push({ name, resName, chain:'A', resSeq, ic:'', x:p.x, y:p.y, z:p.z, el, het:false });
  helices.forEach((hx, h) => {
    const { H } = hx;
    for (let i = 0; i < 18; i++) {
      const aa = AA3[seqs[h][i]] || 'ALA', r = hx.start + i;
      push('N', aa, r, H.N[i], 'N'); push('CA', aa, r, H.CA[i], 'C'); push('C', aa, r, H.C[i], 'C'); push('O', aa, r, H.O[i], 'O');
      if (aa !== 'GLY') push('CB', aa, r, H.CB[i], 'C');
    }
    ranges.push({ type:'H', chain:'A', start: hx.start + 1, end: hx.start + 16 });
    if (h < 3) {
      const nx = helices[h + 1];
      const p0 = H.CA[17], p3 = nx.H.CA[0];
      // pick a loop bulge so the 4 loop residues sit ~3.7 Å apart along the path
      let bez = null, samples = null;
      for (let ext = 2; ext <= 16; ext += 0.25) {
        const p1 = p0.clone().addScaledVector(hx.up, ext), p2 = p3.clone().addScaledVector(nx.up, -ext);
        const f = t => { const u = 1 - t; return p0.clone().multiplyScalar(u * u * u).addScaledVector(p1, 3 * u * u * t).addScaledVector(p2, 3 * u * t * t).addScaledVector(p3, t * t * t); };
        const sm = [{ t: 0, s: 0, p: f(0) }];
        for (let k = 1; k <= 200; k++) { const p = f(k / 200); sm.push({ t: k / 200, s: sm[k - 1].s + p.clone().sub(sm[k - 1].p).length(), p }); }
        bez = f; samples = sm;
        if (sm[200].s / 5 >= 3.7) break;
      }
      const Ltot = samples[200].s;
      const atLen = s => { let k = 1; while (k < 200 && samples[k].s < s) k++; const a = samples[k - 1], b = samples[k]; return lerp(a.t, b.t, (s - a.s) / (b.s - a.s || 1)); };
      for (let j = 0; j < 4; j++) {
        const t = atLen(Ltot * (j + 1) / 5), ca = bez(t), tg = bez(Math.min(1, t + 0.02)).sub(bez(Math.max(0, t - 0.02))).normalize();
        const out = new V(ca.x, 0, ca.z).normalize(); const side = new V().crossVectors(tg, out).normalize();
        const aa = AA3[loopSeq[j]], r = hx.start + 18 + j;
        push('N', aa, r, ca.clone().addScaledVector(tg, -1.0).addScaledVector(side, 0.55), 'N');
        push('CA', aa, r, ca, 'C');
        const c = ca.clone().addScaledVector(tg, 1.0).addScaledVector(side, 0.55);
        push('C', aa, r, c, 'C');
        push('O', aa, r, c.clone().addScaledVector(out, 1.23), 'O');
      }
    }
  });
  return { atoms, ranges };
}
function resColor(st, ri, mode) {
  const r = st.res[ri];
  if (mode === 'chain' || mode === 'element') return C3(CHAIN_COLS[r.chainIdx % CHAIN_COLS.length]);
  if (mode === 'rainbow') return new THREE.Color().setHSL(0.62 * (1 - (r.frac || 0)), 0.62, 0.62);
  return C3(SS_COL[r.ss] || SS_COL.C);
}
function atomColor(st, a, mode) {
  if (a.el !== 'C' || mode === 'element') return C3(ELEM[a.el] || '#E07BE0');
  const r = st.res[a.ri];
  if (r.kind === 'lig') return C3('#d5d9e0');
  return resColor(st, a.ri, mode);
}
function buildCartoon(st, mode) {
  const pos = [], col = [], idx = []; let base = 0;
  const total = st.segs.reduce((s, g) => s + g.length, 0);
  const K = total > 4000 ? 3 : total > 1500 ? 5 : 8, M = total > 4000 ? 6 : 10;
  const V = THREE.Vector3, T = new V(), Nn = new V(), B = new V(), prevN = new V(0, 1, 0);
  for (const seg of st.segs) {
    const n = seg.length; if (n < 2) continue;
    const P = seg.map(ri => new V(...st.res[ri].pos));
    const curve = new THREE.CatmullRomCurve3(P, false, 'centripetal');
    const O = P.map((p, i) => {
      if (i === 0 || i === n - 1) return null;
      const v = p.clone().sub(P[i - 1].clone().add(P[i + 1]).multiplyScalar(0.5));
      return v.lengthSq() < 1e-6 ? null : v.normalize();
    });
    for (let i = 0; i < n; i++) if (!O[i]) {
      let j = 1, f = null; while (!f && j < n) { f = O[i - j] || O[i + j]; j++; }
      O[i] = f ? f.clone() : new V(0, 1, 0);
    }
    const ss = seg.map(ri => st.res[ri].ss);
    for (let i = 1; i < n; i++) if (ss[i] === 'E' && ss[i - 1] === 'E' && O[i].dot(O[i - 1]) < 0) O[i].negate();
    const O2 = O.map((v, i) => {
      if (ss[i] !== 'E') return v;
      const s = v.clone(); if (i > 0 && ss[i - 1] === 'E') s.add(O[i - 1]); if (i < n - 1 && ss[i + 1] === 'E') s.add(O[i + 1]);
      return s.lengthSq() > 1e-6 ? s.normalize() : v;
    });
    const dims = ss.map(s => DIMS[s] || DIMS.C), cols = seg.map(ri => resColor(st, ri, mode));
    const N = (n - 1) * K + 1;
    for (let s = 0; s < N; s++) {
      const u = s / (N - 1), f = u * (n - 1), i0 = Math.min(n - 1, Math.floor(f)), i1 = Math.min(n - 1, i0 + 1), fr = f - i0;
      const p = curve.getPoint(u); curve.getTangent(u, T); T.normalize();
      Nn.copy(O2[i0]).lerp(O2[i1], fr); Nn.addScaledVector(T, -Nn.dot(T));
      if (Nn.lengthSq() < 1e-8) Nn.copy(prevN); Nn.normalize(); prevN.copy(Nn);
      B.crossVectors(T, Nn).normalize();
      const sm = smooth(fr), w = lerp(dims[i0][0], dims[i1][0], sm), h = lerp(dims[i0][1], dims[i1][1], sm);
      const c = cols[fr < 0.5 ? i0 : i1];
      for (let j = 0; j < M; j++) {
        const a = j / M * Math.PI * 2, ca = Math.cos(a) * w, sa = Math.sin(a) * h;
        pos.push(p.x + B.x * ca + Nn.x * sa, p.y + B.y * ca + Nn.y * sa, p.z + B.z * ca + Nn.z * sa);
        col.push(c.r, c.g, c.b);
      }
      if (s < N - 1) for (let j = 0; j < M; j++) {
        const a = base + s * M + j, b = base + s * M + (j + 1) % M;
        idx.push(a, a + M, b, b, a + M, b + M);
      }
    }
    base += N * M;
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.04, side: THREE.DoubleSide });
  return new THREE.Mesh(g, m);
}
function computeBonds(st, list) {
  const out = []; if (list.length < 2) return out;
  const cell = 2.4, grid = new Map();
  const key = (x, y, z) => x + ',' + y + ',' + z;
  list.forEach((ai, li) => {
    const a = st.atoms[ai], k = key(Math.floor(a.x / cell), Math.floor(a.y / cell), Math.floor(a.z / cell));
    let arr = grid.get(k); if (!arr) grid.set(k, arr = []); arr.push(li);
  });
  list.forEach((ai, li) => {
    const a = st.atoms[ai]; if (METALS.has(a.el)) return;
    const gx = Math.floor(a.x / cell), gy = Math.floor(a.y / cell), gz = Math.floor(a.z / cell), ra = COV[a.el] || 0.8;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const arr = grid.get(key(gx + dx, gy + dy, gz + dz)); if (!arr) continue;
      for (const lj of arr) {
        if (lj <= li) continue;
        const b = st.atoms[list[lj]]; if (METALS.has(b.el)) continue;
        const cut = ra + (COV[b.el] || 0.8) + 0.45;
        const d2 = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
        if (d2 > 0.16 && d2 < cut * cut) out.push([ai, list[lj]]);
      }
    }
  });
  return out;
}
// molecule looks: CG (glossy, two-tone bonds, outlined), ball and stick, space-filling, sticks (licorice) and toon
const MOL_STYLES = { cg: { mul: 1.1, bond: 0.2, split: true, gloss: true, outline: 0.045 }, ballstick: { mul: 1, bond: 0.16 }, spacefill: { mul: 1 / 0.3, bond: 0, noBonds: true },
  sticks: { uniform: 0.22, bond: 0.22, split: true }, toon: { mul: 1, bond: 0.18, split: true, toon: true, outline: 0.09 } };
function buildAtomSet(st, list, mode, opts) {
  if (!list.length) return null;
  const O = opts || {};
  const big = list.length > 15000;
  const geo = new THREE.SphereGeometry(1, big ? 8 : (O.gloss || O.toon) ? 28 : 16, big ? 6 : (O.gloss || O.toon) ? 20 : 12);
  const mat = O.toon ? new THREE.MeshToonMaterial({}) : O.gloss ? new THREE.MeshPhysicalMaterial({ roughness: 0.22, metalness: 0.02, clearcoat: 1, clearcoatRoughness: 0.12 }) : new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.05 });
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false;
  list.forEach((ai, i) => mesh.setColorAt(i, atomColor(st, st.atoms[ai], mode)));
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  const pairs = O.noBonds ? [] : computeBonds(st, list);
  let bonds = null, bondOutline = null, outline = null;
  if (pairs.length) {
    const split = !!O.split, br = O.bond || 0.16, n = pairs.length * (split ? 2 : 1);
    const cg = new THREE.CylinderGeometry(1, 1, 1, big ? 5 : (O.gloss || O.toon) ? 16 : 8, 1, !split);
    const cm = O.toon ? new THREE.MeshToonMaterial({ color: split ? 0xffffff : 0xcfd4dc }) : O.gloss ? new THREE.MeshPhysicalMaterial({ color: split ? 0xffffff : 0xcfd4dc, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.15 })
      : new THREE.MeshStandardMaterial({ color: split ? 0xffffff : 0xcfd4dc, roughness: 0.5, metalness: 0.02 });
    bonds = new THREE.InstancedMesh(cg, cm, n); bonds.frustumCulled = false;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3(), mid = new THREE.Vector3(), sc = new THREE.Vector3();
    const mats = [];
    pairs.forEach(([i, j], k) => {
      const a = st.atoms[i], b = st.atoms[j];
      d.set(b.x - a.x, b.y - a.y, b.z - a.z); const len = d.length(); d.normalize();
      q.setFromUnitVectors(Y, d);
      if (split) {                                    // two halves, each in its own atom's colour
        for (const [f, at] of [[0.25, a], [0.75, b]]) {
          mid.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f); sc.set(br, len / 2, br);
          m.compose(mid, q, sc); bonds.setMatrixAt(mats.length, m); bonds.setColorAt(mats.length, atomColor(st, at, mode)); mats.push(m.clone());
        }
      } else { mid.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); sc.set(br, len, br); m.compose(mid, q, sc); bonds.setMatrixAt(k, m); mats.push(m.clone()); }
    });
    bonds.instanceMatrix.needsUpdate = true; if (bonds.instanceColor) bonds.instanceColor.needsUpdate = true;
    if (O.outline) {
      bondOutline = new THREE.InstancedMesh(cg, new THREE.MeshBasicMaterial({ color: 0x0b0d12, side: THREE.BackSide }), n); bondOutline.frustumCulled = false;
      const w = 1 + O.outline * 4, s2 = new THREE.Matrix4().makeScale(w, 1, w);
      mats.forEach((mm, i) => bondOutline.setMatrixAt(i, mm.clone().multiply(s2)));
      bondOutline.instanceMatrix.needsUpdate = true; bonds.add(bondOutline);
    }
  }
  if (O.outline) { outline = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0x0b0d12, side: THREE.BackSide }), list.length); outline.frustumCulled = false; mesh.add(outline); }
  return { mesh, bonds, list, size: -1, outline, opts: O };
}
function setAtomSize(set, st, size) {
  if (!set || Math.abs(set.size - size) < 1e-4) return;
  const m = new THREE.Matrix4(), O = set.opts || {}, ow = 1 + (O.outline || 0);
  set.list.forEach((ai, i) => {
    const a = st.atoms[ai], s = O.uniform ? O.uniform * size / 0.3 : (VDW[a.el] || 1.7) * size * (O.mul || 1);
    m.makeScale(s, s, s); m.setPosition(a.x, a.y, a.z); set.mesh.setMatrixAt(i, m);
    if (set.outline) { m.makeScale(s * ow, s * ow, s * ow); m.setPosition(a.x, a.y, a.z); set.outline.setMatrixAt(i, m); }
  });
  set.mesh.instanceMatrix.needsUpdate = true; if (set.outline) set.outline.instanceMatrix.needsUpdate = true; set.size = size;
}
function parseSMILES(smi) {
  const atoms = [], bonds = [], stack = [], ring = {};
  let prev = -1, pend = null, i = 0;
  const addBond = (a, b, o) => { bonds.push([a, b, o]); };
  const dflt = (a, b) => (atoms[a].arom && atoms[b].arom) ? 1.5 : 1;
  while (i < smi.length) {
    const ch = smi[i];
    if (ch === ' ' ) { i++; continue; }
    if (ch === '(') { stack.push(prev); i++; continue; }
    if (ch === ')') { prev = stack.pop(); i++; continue; }
    if ('-=#$:/\\'.includes(ch)) { pend = ch === '=' ? 2 : ch === '#' ? 3 : ch === '$' ? 4 : ch === ':' ? 1.5 : 1; i++; continue; }
    if (ch === '.') { prev = -1; i++; continue; }
    if (/[0-9%]/.test(ch)) {
      let num; if (ch === '%') { num = smi.slice(i + 1, i + 3); i += 3; } else { num = ch; i++; }
      if (prev < 0) throw new Error('ring number before any atom');
      if (ring[num]) { const r = ring[num]; addBond(r.a, prev, pend || r.o || dflt(r.a, prev)); delete ring[num]; }
      else ring[num] = { a: prev, o: pend };
      pend = null; continue;
    }
    let atom;
    if (ch === '[') {
      const j = smi.indexOf(']', i); if (j < 0) throw new Error('unclosed [');
      const m = smi.slice(i + 1, j).match(/^(\d+)?([A-Z][a-z]?|[a-z][a-z]?|\*)(@*(?:TH\d|AL\d|SP\d|TB\d+|OH\d+)?)?(H\d*)?([+-]+\d*)?(?::\d+)?$/);
      if (!m) throw new Error('can’t read [' + smi.slice(i + 1, j) + ']');
      const sym = m[2], arom = sym === sym.toLowerCase() && sym !== '*';
      atom = { el: sym === '*' ? 'C' : sym.toUpperCase(), arom, bracket: true, h: m[4] ? (m[4].length > 1 ? +m[4].slice(1) : 1) : 0 };
      i = j + 1;
    } else {
      const two = smi.slice(i, i + 2);
      let sym;
      if (two === 'Cl' || two === 'Br') sym = two; else if (/[BCNOPSFIbcnops]/.test(ch)) sym = ch; else throw new Error('unexpected “' + ch + '”');
      atom = { el: sym.toUpperCase(), arom: sym === sym.toLowerCase(), bracket: false };
      i += sym.length;
    }
    const idx = atoms.push(atom) - 1;
    if (prev >= 0) addBond(prev, idx, pend || dflt(prev, idx));
    pend = null; prev = idx;
  }
  if (Object.keys(ring).length) throw new Error('a ring is never closed');
  if (!atoms.length) throw new Error('no atoms');
  // implicit hydrogens
  const sum = atoms.map(() => 0);
  for (const [a, b, o] of bonds) { sum[a] += o; sum[b] += o; }
  const heavy = atoms.length;
  for (let a = 0; a < heavy; a++) {
    const at = atoms[a];
    let nh = at.bracket ? at.h : 0;
    if (!at.bracket) { const vs0 = VALENCE[at.el] || [sum[a]], vs = at.arom ? [vs0[0]] : vs0; const v = vs.find(x => x >= sum[a] - 0.01) ?? vs[vs.length - 1]; nh = Math.max(0, Math.floor(v - sum[a] + 0.01)); }
    for (let k = 0; k < nh; k++) { const hi = atoms.push({ el: 'H', arom: false }) - 1; bonds.push([a, hi, 1]); }
  }
  return { atoms, bonds };
}
function embedMolecule(mol) {
  const { atoms, bonds } = mol, n = atoms.length;
  const nb = atoms.map(() => []);
  const blen = (a, b, o) => { const r = (COV[atoms[a].el] || 0.77) + (COV[atoms[b].el] || 0.77); return r * (o === 2 ? 0.87 : o === 3 ? 0.78 : o === 1.5 ? 0.92 : 1); };
  for (const [a, b, o] of bonds) { const L = blen(a, b, o); nb[a].push([b, L, o]); nb[b].push([a, L, o]); }
  const ang = atoms.map((_, a) => {
    const os = nb[a].map(x => x[2]);
    if (os.includes(3) || os.filter(x => x === 2).length >= 2) return Math.PI;
    if (os.includes(2) || os.includes(1.5) || (atoms[a].arom)) return 120 * DEG;
    return 109.5 * DEG;
  });
  const cons = [], bonded = new Set();
  const pk = (a, b) => a < b ? a * 10000 + b : b * 10000 + a;
  for (const [a, b, o] of bonds) { cons.push([a, b, blen(a, b, o), 1]); bonded.add(pk(a, b)); }
  for (let c = 0; c < n; c++) for (let x = 0; x < nb[c].length; x++) for (let y = x + 1; y < nb[c].length; y++) {
    const [a, la] = nb[c][x], [b, lb] = nb[c][y];
    cons.push([a, b, Math.sqrt(la * la + lb * lb - 2 * la * lb * Math.cos(ang[c])), 0.6]); bonded.add(pk(a, b));
  }
  // initial positions: breadth-first, seeded
  const P = atoms.map(() => null); let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (let s = 0; s < n; s++) {
    if (P[s]) continue;
    P[s] = [s * 6, 0, 0]; const q = [s];
    while (q.length) { const a = q.shift(); for (const [b, L] of nb[a]) if (!P[b]) { const v = [rnd(), rnd(), rnd()], m = Math.hypot(...v) || 1; P[b] = [P[a][0] + v[0] / m * L, P[a][1] + v[1] / m * L, P[a][2] + v[2] / m * L]; q.push(b); } }
  }
  const steps = n > 120 ? 900 : 1600;
  for (let it = 0; it < steps; it++) {
    const lr = 0.5 * (1 - it / steps) + 0.05;
    for (const [a, b, d0, w] of cons) {
      const A = P[a], B = P[b], dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], d = Math.hypot(dx, dy, dz) || 1e-3;
      const f = (d - d0) / d * 0.5 * w * lr;
      A[0] += dx * f; A[1] += dy * f; A[2] += dz * f; B[0] -= dx * f; B[1] -= dy * f; B[2] -= dz * f;
    }
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      if (bonded.has(pk(a, b))) continue;
      const A = P[a], B = P[b], dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], d = Math.hypot(dx, dy, dz) || 1e-3;
      const lim = (atoms[a].el === 'H' || atoms[b].el === 'H') ? 2.4 : 3.1;
      if (d < lim) { const f = (d - lim) / d * 0.5 * 0.35 * lr; A[0] += dx * f; A[1] += dy * f; A[2] += dz * f; B[0] -= dx * f; B[1] -= dy * f; B[2] -= dz * f; }
    }
  }
  return P;
}
function moleculeRaw(smiles) {
  const mol = parseSMILES(smiles), P = embedMolecule(mol);
  const counts = {};
  return { keepH: true, ranges: [], atoms: mol.atoms.map((a, i) => { counts[a.el] = (counts[a.el] || 0) + 1; return { name: a.el + counts[a.el], resName: 'MOL', chain: 'M', resSeq: 1, ic: '', x: P[i][0], y: P[i][1], z: P[i][2], el: a.el, het: true }; }) };
}
function placeholderPages(n) {
  const out = [];
  for (let p = 0; p < n; p++) {
    const cv = document.createElement('canvas'); cv.width = 850; cv.height = 1100;
    const c = cv.getContext('2d');
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, 850, 1100);
    c.fillStyle = '#1c1f26'; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    let y = 90;
    if (p === 0) {
      c.font = '600 38px "STIX Two Text", serif'; c.fillText('Drop a PDF to replace', 70, y); y += 48; c.fillText('these placeholder pages', 70, y); y += 34;
      c.fillStyle = '#9aa1ad'; c.fillRect(70, y, 360, 10); y += 46;
    } else { c.fillStyle = '#9aa1ad'; c.font = '20px "STIX Two Text", serif'; c.fillText('Placeholder page ' + (p + 1), 70, 70); y = 110; }
    const colW = 335;
    for (let col = 0; col < 2; col++) {
      let yy = y;
      for (let l = 0; l < 32; l++) {
        if (p % 2 === 0 && col === 1 && l === 6) { // a little figure
          c.strokeStyle = '#d6d9df'; c.lineWidth = 2; c.strokeRect(70 + colW + 40, yy, colW, 230);
          const cols = ['#58C4DD', '#FC6255', '#83C167'];
          cols.forEach((cc, k) => { c.strokeStyle = cc; c.lineWidth = 4; c.beginPath(); for (let x = 0; x <= 300; x += 10) { const v = Math.sin(x / 40 + k * 1.3 + p) * 40 * (1 - k * 0.2) + 115; x ? c.lineTo(70 + colW + 58 + x, yy + v) : c.moveTo(70 + colW + 58, yy + v); } c.stroke(); });
          yy += 260; l += 10; continue;
        }
        const w = l % 7 === 6 ? colW * 0.55 : colW * (0.86 + hash01(p * 100 + l + col * 50) * 0.14);
        c.fillStyle = '#c5cad3'; c.fillRect(70 + col * (colW + 40), yy, w, 9); yy += 24;
        if (yy > 1020) break;
      }
    }
    c.fillStyle = '#9aa1ad'; c.font = '18px Inter, sans-serif'; c.textAlign = 'center'; c.fillText(String(p + 1), 425, 1065);
    out.push(cv);
  }
  return out;
}
async function renderPdfPages(buf, quiet) {
  const lib = await ensurePdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
  const n = Math.min(doc.numPages, MAX_PAGES), canvases = [];
  for (let i = 1; i <= n; i++) {
    if (!quiet) toast(`Rendering page ${i} of ${n}…`, 30000);
    const page = await doc.getPage(i);
    const vp0 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: 1300 / Math.max(vp0.width, vp0.height) });
    const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: c, viewport: vp }).promise;
    canvases.push(cv);
  }
  return { canvases, total: doc.numPages, n };
}
function imageToCanvas(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const sc = Math.min(1, 2048 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
      const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height); c.drawImage(img, 0, 0, cv.width, cv.height);
      res(cv);
    };
    img.onerror = () => rej(new Error('image'));
    img.src = url;
  });
}
function cropCanvas(cv, r) {
  const x0 = Math.round(r[0] * cv.width), y0 = Math.round(r[1] * cv.height), w = Math.max(4, Math.round((r[2] - r[0]) * cv.width)), hh = Math.max(4, Math.round((r[3] - r[1]) * cv.height));
  const out = document.createElement('canvas'); out.width = w; out.height = hh;
  out.getContext('2d').drawImage(cv, x0, y0, w, hh, 0, 0, w, hh);
  return out;
}
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); }); }
function ensurePdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!pdfjsP) pdfjsP = (async () => {
    const base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/';
    // Loading the worker as a plain script lets pdf.js run on the main thread (no cross-origin Worker needed).
    await loadScript(base + 'pdf.worker.min.js');
    await loadScript(base + 'pdf.min.js');
    const lib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
    lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js';
    return lib;
  })().catch(e => { pdfjsP = null; throw e; });
  return pdfjsP;
}
  /* ======================================================================
     Shared helpers
     ====================================================================== */
  const U = 10;                                   // Å per frame unit at true size
  const FIT = 25;                                 // fitted objects: radius → 2.5 frame units
  const FITS = { molecule: 34, sculpt: 28, transporter: 28, atom: 30 };
  const col = c => A.color(c) || c || '#FFFFFF';
  const C3s = c => new THREE.Color(col(c));

  /* ---------- molecules: SDF (PubChem) ---------- */
  function parseSDF(text) {
    const L = text.split(/\r?\n/);
    const counts = L[3] || '';
    const na = parseInt(counts.slice(0, 3)), nb = parseInt(counts.slice(3, 6));
    if (!(na > 0)) throw new Error('not a molfile');
    const atoms = [], bonds = [];
    let flat = true;
    for (let i = 0; i < na; i++) {
      const s = L[4 + i];
      const x = parseFloat(s.slice(0, 10)), y = parseFloat(s.slice(10, 20)), z = parseFloat(s.slice(20, 30));
      const el = s.slice(31, 34).trim().toUpperCase();
      if (Math.abs(z) > 1e-3) flat = false;
      atoms.push({ el, x, y, z, arom: false });
    }
    for (let i = 0; i < nb; i++) {
      const s = L[4 + na + i];
      const a = parseInt(s.slice(0, 3)) - 1, b = parseInt(s.slice(3, 6)) - 1, o = parseInt(s.slice(6, 9));
      bonds.push([a, b, o === 4 ? 1.5 : o]);
    }
    return { atoms, bonds, flat };
  }
  function molRawFromSDF(text) {
    const m = parseSDF(text);
    let P = m.atoms.map(a => [a.x, a.y, a.z]);
    if (m.flat) P = embedMolecule({ atoms: m.atoms, bonds: m.bonds });
    const counts = {};
    return { keepH: true, ranges: [], atoms: m.atoms.map((a, i) => { counts[a.el] = (counts[a.el] || 0) + 1; return { name: a.el + counts[a.el], resName: 'MOL', chain: 'M', resSeq: 1, ic: '', x: P[i][0], y: P[i][1], z: P[i][2], el: a.el, het: true }; }) };
  }
  // Common names that work offline (the name search needs PubChem, i.e. the internet).
  const NAME_SMILES = {
    glucose: 'OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O', caffeine: 'Cn1cnc2c1c(=O)n(C)c(=O)n2C', dopamine: 'NCCc1ccc(O)c(O)c1',
    'l-dopa': 'N[C@@H](Cc1ccc(O)c(O)c1)C(=O)O', levodopa: 'N[C@@H](Cc1ccc(O)c(O)c1)C(=O)O', ethanol: 'CCO', aspirin: 'CC(=O)Oc1ccccc1C(=O)O',
    cholesterol: 'CC(C)CCC[C@@H](C)[C@H]1CC[C@H]2[C@@H]3CC=C4C[C@@H](O)CC[C@]4(C)[C@H]3CC[C@]12C', water: 'O',
    serotonin: 'NCCc1c[nH]c2ccc(O)cc12', gaba: 'NCCCC(=O)O', glutamate: 'N[C@@H](CCC(=O)O)C(=O)O', 'glutamic acid': 'N[C@@H](CCC(=O)O)C(=O)O',
    acetylcholine: 'CC(=O)OCC[N+](C)(C)C', nicotine: 'CN1CCC[C@H]1c1cccnc1', adrenaline: 'CNC[C@H](O)c1ccc(O)c(O)c1', epinephrine: 'CNC[C@H](O)c1ccc(O)c(O)c1',
    noradrenaline: 'NC[C@H](O)c1ccc(O)c(O)c1', histamine: 'NCCc1c[nH]cn1', glycine: 'NCC(=O)O', alanine: 'C[C@H](N)C(=O)O', tryptophan: 'N[C@@H](Cc1c[nH]c2ccccc12)C(=O)O',
    tyrosine: 'N[C@@H](Cc1ccc(O)cc1)C(=O)O', phenylalanine: 'N[C@@H](Cc1ccccc1)C(=O)O', leucine: 'CC(C)C[C@H](N)C(=O)O', melatonin: 'CC(=O)NCCc1c[nH]c2ccc(OC)cc12',
    paracetamol: 'CC(=O)Nc1ccc(O)cc1', acetaminophen: 'CC(=O)Nc1ccc(O)cc1', ibuprofen: 'CC(C)Cc1ccc(cc1)C(C)C(=O)O', morphine: 'CN1CC[C@]23c4c5ccc(O)c4O[C@H]2[C@@H](O)C=C[C@H]3[C@H]1C5',
    benzene: 'c1ccccc1', methane: 'C', ammonia: 'N', 'carbon dioxide': 'O=C=O', urea: 'NC(=O)N', lactate: 'CC(O)C(=O)O', 'lactic acid': 'CC(O)C(=O)O', pyruvate: 'CC(=O)C(=O)O',
    'atp': 'Nc1ncnc2c1ncn2[C@@H]1O[C@H](COP(=O)(O)OP(=O)(O)OP(=O)(O)O)[C@@H](O)[C@H]1O', 'mannitol': 'OC[C@@H](O)[C@@H](O)[C@H](O)[C@H](O)CO',
    'sucrose': 'OC[C@H]1O[C@@](CO)(O[C@H]2O[C@H](CO)[C@@H](O)[C@H](O)[C@H]2O)[C@@H](O)[C@@H]1O', 'oxygen': 'O=O', 'nitric oxide': '[N]=O', 'diazepam': 'CN1C(=O)CN=C(c2ccccc2)c2cc(Cl)ccc21'
  };
  async function fetchPubChem(name) {
    const base = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/' + encodeURIComponent(name.trim());
    for (const rec of ['3d', '2d']) {
      try {
        const r = await fetch(base + '/SDF?record_type=' + rec);
        if (r.ok) { const t = await r.text(); if (/M {2}END|\$\$\$\$/.test(t)) return { sdf: t, rec }; }
        else if (r.status === 404 && rec === '2d') return null;
      } catch (e) { if (rec === '2d') throw e; }
    }
    return null;
  }
  async function fetchPDBText(id) {
    for (const ext of ['pdb', 'cif']) {
      try { const r = await fetch('https://files.rcsb.org/download/' + id + '.' + ext); if (r.ok) return { text: await r.text(), ext }; } catch (e) { if (ext === 'cif') throw e; }
    }
    return null;
  }
  async function searchRCSB(q) {
    const body = { query: { type: 'terminal', service: 'full_text', parameters: { value: q } }, return_type: 'entry', request_options: { paging: { start: 0, rows: 12 } } };
    const r = await fetch('https://search.rcsb.org/rcsbsearch/v2/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 204) return [];
    if (!r.ok) throw new Error('search failed (' + r.status + ')');
    const ids = ((await r.json()).result_set || []).map(x => x.identifier);
    if (!ids.length) return [];
    let titles = {};
    try {
      const g = await fetch('https://data.rcsb.org/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '{entries(entry_ids:' + JSON.stringify(ids) + '){rcsb_id struct{title}}}' }) });
      if (g.ok) for (const e of ((await g.json()).data || {}).entries || []) titles[e.rcsb_id] = e.struct && e.struct.title;
    } catch (e) { /* titles are optional */ }
    return ids.map(id => ({ id, title: titles[id] || '' }));
  }

  /* ======================================================================
     Procedural assets: anatomy, cell biology, primitives
     ====================================================================== */
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  function stdMat(c, o) { return new THREE.MeshStandardMaterial(Object.assign({ color: col(c), roughness: 0.45, metalness: 0.04 }, o || {})); }
  function glassMat(c, op) { return new THREE.MeshStandardMaterial({ color: col(c), roughness: 0.25, metalness: 0.0, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide }); }
  function rbcGeometry(R) {
    const pts = [];
    const z = r => 0.5 * Math.sqrt(Math.max(0, 1 - r * r)) * (0.207 + 2.003 * r * r - 1.123 * r ** 4);
    for (let i = 0; i <= 24; i++) { const r = i / 24; pts.push(new THREE.Vector2(r * R, z(r) * R)); }
    for (let i = 24; i >= 0; i--) { const r = i / 24; pts.push(new THREE.Vector2(r * R, -z(r) * R)); }
    return new THREE.LatheGeometry(pts, 40);
  }
  function capsuleGeometry(r, len, seg = 24) {
    const pts = [];
    for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + i / 10 * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r - len / 2)); }
    for (let i = 0; i <= 10; i++) { const a = i / 10 * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r + len / 2)); }
    return new THREE.LatheGeometry(pts, seg);
  }
  function seeded(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
  // a tube that narrows from r0 to r1 along a smooth curve, with a rounded tip
  function taperTube(curve, r0, r1, segs, mat) {
    const radial = 10, F = curve.computeFrenetFrames(segs, false), pos = [], idx = [];
    for (let i = 0; i <= segs; i++) {
      const u = i / segs, P = curve.getPointAt(u), r = lerp(r0, r1, Math.pow(u, 0.8)), N = F.normals[i], B = F.binormals[i];
      for (let j = 0; j < radial; j++) { const a = j / radial * Math.PI * 2, c = Math.cos(a), s2 = Math.sin(a); pos.push(P.x + (N.x * c + B.x * s2) * r, P.y + (N.y * c + B.y * s2) * r, P.z + (N.z * c + B.z * s2) * r); }
      if (i < segs) for (let j = 0; j < radial; j++) { const a = i * radial + j, b = i * radial + (j + 1) % radial; idx.push(a, a + radial, b, b, a + radial, b + radial); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const grp = new THREE.Group(); grp.add(new THREE.Mesh(g, mat));
    const tip = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.3, r1), 10, 8), mat); tip.position.copy(curve.getPointAt(1)); grp.add(tip);
    return grp;
  }
  function tube(points, r, c, seg) { const cur = new THREE.CatmullRomCurve3(points); return new THREE.Mesh(new THREE.TubeGeometry(cur, seg || Math.max(8, points.length * 6), r, 8, false), stdMat(c)); }

  const BIO_KINDS = {
    rbc: { label: 'Red blood cell', r3: 40, build(p) { const g = new THREE.Group(); g.add(new THREE.Mesh(rbcGeometry(40), stdMat(p.color || '#D2483C', { roughness: 0.35 }))); return { group: g }; } },
    capillary: {
      label: 'Capillary', r3: 80,
      build(p) {
        const g = new THREE.Group(), L = 170, R = 30;
        const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 48, 1, true), glassMat(p.color || '#F4A6C6', 0.3)); wall.rotation.z = Math.PI / 2; g.add(wall);
        const cells = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.3, R + 0.3, L, 6, 4, true), new THREE.MeshBasicMaterial({ color: col(p.accent || '#C55F73'), wireframe: true, transparent: true, opacity: 0.55 })); cells.rotation.z = Math.PI / 2; g.add(cells);
        const rbcGeo = rbcGeometry(15), rbcMat = stdMat('#D2483C', { roughness: 0.35 });
        const rnd = seeded(7), cellsIn = [];
        for (let i = 0; i < 7; i++) { const m = new THREE.Mesh(rbcGeo, rbcMat); m.userData = { ph: i / 7 * L, y: (rnd() - 0.5) * 18, z: (rnd() - 0.5) * 18, rx: rnd() * 6, ry: rnd() * 6 }; g.add(m); cellsIn.push(m); }
        return { group: g, update(o, t, k) { const fl = k('flow'); for (const m of cellsIn) { const u = m.userData; m.position.set(((u.ph + t * fl * 45) % L + L) % L - L / 2, u.y, u.z); m.rotation.set(u.rx + t * fl * 0.6, u.ry, 0); } } };
      }
    },
    neuron: {
      label: 'Neuron', r3: 90,
      build(p) {
        const g = new THREE.Group(), c = p.color || '#9A72AC', rnd = seeded(11), mat = stdMat(c, { roughness: 0.5 });
        const soma = new THREE.Mesh(new THREE.SphereGeometry(11, 40, 28), mat); soma.scale.set(1.25, 1, 1.05); soma.position.x = 2; g.add(soma);
        const hill = new THREE.Mesh(new THREE.ConeGeometry(5.5, 12, 24, 1, true), mat); hill.rotation.z = Math.PI / 2; hill.position.x = -11; g.add(hill);
        // dendrites: evenly spread primary branches that fork twice and taper smoothly
        const grow = (start, dir, len, r0, depth) => {
          const pts = [start.clone()], d = dir.clone();
          for (let i = 1; i <= 4; i++) { d.add(V3((rnd() - 0.5) * 0.18, (rnd() - 0.5) * 0.18, (rnd() - 0.5) * 0.18)).normalize(); pts.push(pts[i - 1].clone().addScaledVector(d, len / 4)); }
          const curve = new THREE.CatmullRomCurve3(pts), r1 = depth ? r0 * 0.62 : 0.45;
          g.add(taperTube(curve, r0, r1, 24, mat));
          if (depth > 0) {
            const end = curve.getPointAt(1), tg = curve.getTangentAt(1), side = V3(0, 1, 0).cross(tg); if (side.lengthSq() < 1e-4) side.set(0, 0, 1); side.normalize();
            const up = tg.clone().cross(side).normalize(), spin = rnd() * Math.PI;
            for (const sgn of [1, -1]) {
              const off = side.clone().multiplyScalar(Math.cos(spin)).addScaledVector(up, Math.sin(spin)).multiplyScalar(sgn * 0.55);
              grow(end, tg.clone().add(off).normalize(), len * 0.68, r1, depth - 1);
            }
          }
        };
        const NP = 7;
        for (let i = 0; i < NP; i++) {
          // directions spread over the hemisphere facing away from the axon (+x)
          const yv = 1 - 2 * (i + 0.5) / NP, rr = Math.sqrt(1 - yv * yv), a = i * 2.39996;
          const d = V3(0.55 + rr * Math.abs(Math.cos(a)) * 0.6, yv, rr * Math.sin(a) * 0.9).normalize();
          grow(d.clone().multiplyScalar(9).add(V3(2, 0, 0)), d, 22 + rnd() * 6, 2.6, 2);
        }
        // axon with evenly spaced myelin and nodes of Ranvier, ending in boutons
        const ax = []; for (let i = 0; i <= 8; i++) ax.push(V3(-16 - i * 13.5, Math.sin(i * 0.55) * 2.5, Math.sin(i * 0.4 + 1) * 1.5));
        const axCurve = new THREE.CatmullRomCurve3(ax);
        g.add(taperTube(axCurve, 1.9, 1.5, 80, mat));
        const myelin = stdMat(p.accent || '#F0E6D2', { roughness: 0.55 });
        for (let s2 = 0.05; s2 < 0.93; s2 += 0.1) {
          const m = new THREE.Mesh(capsuleGeometry(3.6, 8.5, 20), myelin); m.position.copy(axCurve.getPointAt(s2 + 0.04)); m.quaternion.setFromUnitVectors(V3(0, 1, 0), axCurve.getTangentAt(s2 + 0.04)); g.add(m);
        }
        const end = ax[ax.length - 1], tg0 = axCurve.getTangentAt(1);
        for (let i = 0; i < 5; i++) {
          const a = i / 5 * Math.PI * 2, d = tg0.clone().add(V3(0, Math.cos(a) * 0.8, Math.sin(a) * 0.8)).normalize();
          const curve = new THREE.CatmullRomCurve3([end, end.clone().addScaledVector(d, 5), end.clone().addScaledVector(d, 10).add(V3(0, Math.cos(a) * 2, Math.sin(a) * 2))]);
          g.add(taperTube(curve, 1.2, 0.8, 12, mat));
          const b = new THREE.Mesh(new THREE.SphereGeometry(2.3, 16, 12), mat); b.position.copy(curve.getPointAt(1)); g.add(b);
        }
        const pulse = new THREE.Mesh(new THREE.SphereGeometry(4.4, 18, 12), new THREE.MeshBasicMaterial({ color: col(p.signalColor || '#FFFF00'), transparent: true, opacity: 0.9 }));
        g.add(pulse);
        return { group: g, update(o, t, k) { const s2 = k('signal'); pulse.visible = s2 > 0.001 && s2 < 0.999; if (pulse.visible) pulse.position.copy(axCurve.getPointAt(Math.min(0.999, s2))); } };
      }
    },
    cell: {
      label: 'Cell', r3: 55,
      build(p) {
        const g = new THREE.Group(), rnd = seeded(5);
        const mem = new THREE.Mesh(new THREE.SphereGeometry(50, 48, 32), glassMat(p.color || '#83C167', 0.22)); mem.renderOrder = 2; g.add(mem);
        const nuc = new THREE.Mesh(new THREE.SphereGeometry(18, 32, 24), stdMat(p.accent || '#9A72AC', { transparent: true, opacity: 0.9 })); nuc.position.set(-6, 4, 0); g.add(nuc);
        const nl = new THREE.Mesh(new THREE.SphereGeometry(6, 20, 14), stdMat('#5B3C70')); nl.position.set(-2, 8, 8); g.add(nl);
        const mg = capsuleGeometry(3.2, 9, 14), mm = stdMat('#F0AC5F');
        for (let i = 0; i < 9; i++) { const m = new THREE.Mesh(mg, mm); const d = V3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize().multiplyScalar(30 + rnd() * 10); m.position.copy(d); m.rotation.set(rnd() * 6, rnd() * 6, rnd() * 6); g.add(m); }
        const vg = new THREE.SphereGeometry(2.4, 12, 8), vm = stdMat('#58C4DD');
        for (let i = 0; i < 14; i++) { const m = new THREE.Mesh(vg, vm); m.position.copy(V3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize().multiplyScalar(26 + rnd() * 18)); g.add(m); }
        return { group: g };
      }
    },
    mito: {
      label: 'Mitochondrion', r3: 40,
      build(p) {
        const g = new THREE.Group();
        const outer = new THREE.Mesh(capsuleGeometry(16, 44, 32), glassMat(p.color || '#F0AC5F', 0.35)); outer.rotation.z = Math.PI / 2; outer.renderOrder = 2; g.add(outer);
        const inner = stdMat(p.accent || '#FC6255', { side: THREE.DoubleSide });
        for (let i = 0; i < 9; i++) { const x = -30 + i * 7.5, up = i % 2 ? 1 : -1; const m = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 22, 12, 1), inner); m.scale.set(1, 1, 5); m.position.set(x, up * 4, 0); g.add(m); }
        return { group: g };
      }
    },
    dna: {
      label: 'DNA double helix', r3: 55,
      build(p) {
        const N = 30, rise = 3.4, R = 10, g = new THREE.Group(), BASE = ['#FC6255', '#F7D96F', '#58C4DD', '#83C167'];
        const beads = new THREE.InstancedMesh(new THREE.SphereGeometry(2.2, 14, 10), stdMat(p.color || '#DDDDDD'), N * 2);
        const rungs = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8), stdMat('#FFFFFF'), N * 2);
        beads.frustumCulled = rungs.frustumCulled = false; g.add(beads, rungs);
        const rnd = seeded(3), seq = [];
        for (let i = 0; i < N; i++) { const b = Math.floor(rnd() * 4); seq.push(b); rungs.setColorAt(i * 2, C3s(BASE[b])); rungs.setColorAt(i * 2 + 1, C3s(BASE[b ^ 1])); }
        rungs.instanceColor.needsUpdate = true;
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), Y = V3(0, 1, 0);
        let last = -1;
        return { group: g, update(o, t, k) {
          const uz = k('unzip'); if (Math.abs(uz - last) < 1e-4) return; last = uz;
          for (let i = 0; i < N; i++) {
            const y = (i - (N - 1) / 2) * rise, a = i * (2 * Math.PI / 10.5);
            const open = clamp((uz * (N + 6) - (N - 1 - i)) / 6, 0, 1);  // unzips from the top
            const spread = 1 + open * 1.8;
            const A1 = V3(Math.cos(a) * R * spread, y, Math.sin(a) * R * spread), A2 = V3(Math.cos(a + 2.4) * R * spread, y, Math.sin(a + 2.4) * R * spread);
            m4.makeTranslation(A1.x, A1.y, A1.z); beads.setMatrixAt(i * 2, m4);
            m4.makeTranslation(A2.x, A2.y, A2.z); beads.setMatrixAt(i * 2 + 1, m4);
            const mid = A1.clone().add(A2).multiplyScalar(0.5), half = (1 - open) * A1.distanceTo(A2) / 2;
            for (const [j, P] of [[0, A1], [1, A2]]) {
              const d = mid.clone().sub(P); const L = d.length() || 1; d.normalize();
              const c = P.clone().addScaledVector(d, half / 2 + 1);
              q.setFromUnitVectors(Y, d); sc.set(1.1, Math.max(0.01, half - 1), 1.1); m4.compose(c, q, sc); rungs.setMatrixAt(i * 2 + j, m4);
            }
          }
          beads.instanceMatrix.needsUpdate = true; rungs.instanceMatrix.needsUpdate = true;
        } };
      }
    },
    virus: {
      label: 'Virus', r3: 48,
      build(p) {
        const g = new THREE.Group();
        const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(32, 1), stdMat(p.color || '#5CD0B3', { flatShading: true })); g.add(cap);
        const ico = new THREE.IcosahedronGeometry(32, 1), pos = ico.attributes.position, seen = new Set(), spike = stdMat(p.accent || '#FC6255');
        for (let i = 0; i < pos.count; i++) {
          const v = V3(pos.getX(i), pos.getY(i), pos.getZ(i)), key = v.toArray().map(x => x.toFixed(1)).join(); if (seen.has(key)) continue; seen.add(key);
          const d = v.clone().normalize(), s = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 10, 8), spike); s.position.copy(d.clone().multiplyScalar(36)); s.quaternion.setFromUnitVectors(V3(0, 1, 0), d); g.add(s);
          const b = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 8), spike); b.position.copy(d.clone().multiplyScalar(42)); g.add(b);
        }
        return { group: g };
      }
    },
    bbbvessel: {
      label: 'BBB capillary (cut-away)', r3: 85,
      build(p) {
        const g = new THREE.Group(), L = 150, R = 30;
        // endothelium as a cut-away tube (270°) so you can see inside
        const endo = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 48, 1, true, 0.6, Math.PI * 1.5), stdMat(p.color || '#F4A6C6', { side: THREE.DoubleSide, roughness: 0.5 })); endo.rotation.z = Math.PI / 2; g.add(endo);
        const bm = new THREE.Mesh(new THREE.CylinderGeometry(R + 3, R + 3, L, 48, 1, true, 0.6, Math.PI * 1.5), glassMat('#BBBBBB', 0.25)); bm.rotation.z = Math.PI / 2; g.add(bm);
        // tight-junction seams along the vessel
        const tj = stdMat('#FC6255');
        for (const a of [1.2, 2.6, 4.0]) { const s = new THREE.Mesh(new THREE.BoxGeometry(L, 1.6, 1.6), tj); s.position.set(0, Math.cos(a + 0.6) * R, Math.sin(a + 0.6) * R); g.add(s); }
        // astrocyte end-feet hugging the outside
        const af = stdMat(p.accent || '#83C167', { transparent: true, opacity: 0.85 });
        for (let i = 0; i < 5; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(16, 20, 14), af); m.scale.set(1.6, 0.45, 1); const a = 1.0 + i * 0.85; m.position.set(-55 + i * 27, Math.cos(a) * (R + 8), Math.sin(a) * (R + 8)); m.lookAt(m.position.x, 0, 0); g.add(m); }
        // a pericyte
        const pc = new THREE.Mesh(new THREE.TorusGeometry(R + 5, 2.4, 8, 40, Math.PI * 1.1), stdMat('#9A72AC')); pc.rotation.y = Math.PI / 2; pc.position.x = 20; g.add(pc);
        const rbcGeo = rbcGeometry(14), rbcMat = stdMat('#D2483C', { roughness: 0.35 }), cellsIn = [], rnd = seeded(9);
        for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(rbcGeo, rbcMat); m.userData = { ph: i / 6 * L, y: (rnd() - 0.5) * 16, z: (rnd() - 0.5) * 16, rx: rnd() * 6 }; g.add(m); cellsIn.push(m); }
        return { group: g, update(o, t, k) { const fl = k('flow'); for (const m of cellsIn) { const u = m.userData; m.position.set(((u.ph + t * fl * 40) % L + L) % L - L / 2, u.y, u.z); m.rotation.set(u.rx + t * fl * 0.5, 0.4, 0); } } };
      }
    }
  };
  const PRIMS = {
    sphere: () => new THREE.SphereGeometry(1, 48, 32), cube: () => new THREE.BoxGeometry(1.5, 1.5, 1.5), cylinder: () => new THREE.CylinderGeometry(0.8, 0.8, 1.8, 48),
    cone: () => new THREE.ConeGeometry(0.9, 1.8, 48), torus: () => new THREE.TorusGeometry(0.8, 0.3, 24, 64), knot: () => new THREE.TorusKnotGeometry(0.7, 0.22, 160, 20),
    icosahedron: () => new THREE.IcosahedronGeometry(1, 0), dodecahedron: () => new THREE.DodecahedronGeometry(1, 0), octahedron: () => new THREE.OctahedronGeometry(1, 0),
    capsule: () => capsuleGeometry(0.6, 1.2, 40), plane: () => new THREE.PlaneGeometry(2, 2), ring: () => new THREE.RingGeometry(0.5, 1, 64)
  };
  function primMaterial(p) {
    const c = col(p.color);
    switch (p.material) {
      case 'matte': return new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
      case 'metal': return new THREE.MeshStandardMaterial({ color: c, roughness: 0.25, metalness: 0.85, side: THREE.DoubleSide });
      case 'glass': return new THREE.MeshStandardMaterial({ color: c, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
      case 'wire': return new THREE.MeshBasicMaterial({ color: c, wireframe: true });
      case 'toon': return new THREE.MeshToonMaterial({ color: c, side: THREE.DoubleSide });
      case 'clay': return new THREE.MeshMatcapMaterial({ matcap: matcap('clay'), color: c, side: THREE.DoubleSide });
      case 'clayglossy': return new THREE.MeshMatcapMaterial({ matcap: matcap('glossy'), color: c, side: THREE.DoubleSide });
      default: return new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.05, side: THREE.DoubleSide });
    }
  }

  /* ======================================================================
     Transporters and channels: stylised membrane proteins that carry cargo
     ====================================================================== */
  const helixGeo = OK && new THREE.CylinderGeometry(4.2, 4.2, 1, 18, 1);
  function helix(mat, x, z, y0, y1, tilt) { const m = new THREE.Mesh(helixGeo, mat); m.scale.y = y1 - y0; m.position.set(x, (y0 + y1) / 2, z); if (tilt) m.rotation.z = tilt; return m; }
  function ring(n, r, cx, cz, a0) { const o = []; for (let i = 0; i < n; i++) { const a = (a0 || 0) + i / n * Math.PI * 2; o.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); } return o; }
  function cargoGlucose(c) { const g = new THREE.Group(), mC = stdMat('#9aa3b0'), mO = stdMat('#FC6255'); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const s = new THREE.Mesh(new THREE.SphereGeometry(1.7, 12, 8), i === 5 ? mO : mC); s.position.set(Math.cos(a) * 3, 0, Math.sin(a) * 3); g.add(s); const oh = new THREE.Mesh(new THREE.SphereGeometry(1.3, 10, 8), mO); oh.position.set(Math.cos(a) * 5.4, (i % 2 ? 1 : -1) * 0.8, Math.sin(a) * 5.4); g.add(oh); } return g; }
  function cargoBlob(c, r) { const g = new THREE.Group(), m = stdMat(c); const rnd = seeded(13); for (let i = 0; i < 7; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(r || 1.9, 12, 8), m); s.position.set((rnd() - 0.5) * 5, (rnd() - 0.5) * 4, (rnd() - 0.5) * 5); g.add(s); } return g; }
  function water() { const g = new THREE.Group(); const o = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 8), stdMat('#FC6255')); g.add(o); const hm = stdMat('#F2F2F2'); for (const s of [-1, 1]) { const hh = new THREE.Mesh(new THREE.SphereGeometry(1.0, 10, 8), hm); hh.position.set(s * 1.25, 0.9, 0); g.add(hh); } return g; }
  const TRANSPORTERS = {
    glut1: { label: 'GLUT1 (glucose transporter)', r3: 30, build(p) {
      const g = new THREE.Group(), m1 = stdMat(p.color || '#58C4DD', { roughness: 0.45 }), m2 = stdMat(p.accent || '#5CD0B3', { roughness: 0.45 });
      const lobes = [new THREE.Group(), new THREE.Group()];
      lobes.forEach((L, k) => { const sx = k ? 1 : -1; for (const [x, z] of ring(6, 7.5, sx * 8.5, 0, k * 0.5)) L.add(helix(k ? m2 : m1, x, z, -21, 21, (x - sx * 8.5) * 0.01)); g.add(L); });
      const cargo = cargoGlucose(); g.add(cargo);
      return { group: g, update(o, t, k) {
        const ph = (((t - o.start) * k('rate')) % 1 + 1) % 1;
        // alternating access: open to the blood side, close around the sugar, open to the brain side
        const rock = Math.cos(ph * Math.PI * 2) * 0.12;
        lobes[0].rotation.z = rock; lobes[1].rotation.z = -rock;
        cargo.visible = k('cargo') > 0.5; cargo.position.set(0, 34 - ph * 68, 0); cargo.rotation.y = ph * 4;
      } };
    } },
    pgp: { label: 'P-glycoprotein (efflux pump)', r3: 42, build(p) {
      const g = new THREE.Group(), m1 = stdMat(p.color || '#F0AC5F', { roughness: 0.45 }), m2 = stdMat(p.accent || '#C55F73', { roughness: 0.45 }), halves = [new THREE.Group(), new THREE.Group()], nbds = [];
      halves.forEach((L, k) => { const sx = k ? 1 : -1; for (const [x, z] of ring(6, 7, sx * 8, 0, 0.3)) L.add(helix(k ? m2 : m1, x, z, -30, 22)); const nbd = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 16), k ? m2 : m1); nbd.scale.set(1, 0.75, 1); nbd.position.set(sx * 10, -38, 0); L.add(nbd); nbds.push(nbd); g.add(L); });
      const drug = cargoBlob('#83C167', 2); g.add(drug);
      const atp = new THREE.Mesh(new THREE.SphereGeometry(3, 14, 10), new THREE.MeshBasicMaterial({ color: col('YELLOW'), transparent: true, opacity: 0.9 })); atp.position.set(0, -38, 0); g.add(atp);
      return { group: g, update(o, t, k) {
        const ph = (((t - o.start) * k('rate')) % 1 + 1) % 1;
        const close = Math.sin(Math.min(1, ph / 0.5) * Math.PI);                  // NBDs come together, binding ATP
        const open = clamp((ph - 0.35) / 0.3, 0, 1) * (1 - clamp((ph - 0.85) / 0.15, 0, 1));
        halves[0].position.x = -4 * (1 - close); halves[1].position.x = 4 * (1 - close);
        halves[0].rotation.z = -0.16 * open; halves[1].rotation.z = 0.16 * open;
        atp.visible = close > 0.4; atp.scale.setScalar(0.6 + close * 0.5);
        drug.visible = k('cargo') > 0.5; drug.position.set(0, ph < 0.35 ? -8 : -8 + (ph - 0.35) / 0.65 * 52, 0);
      } };
    } },
    aquaporin: { label: 'Aquaporin (water channel)', r3: 30, build(p) {
      const g = new THREE.Group(), m1 = stdMat(p.color || '#5CD0B3', { roughness: 0.45 }), waters = [];
      for (const [cx, cz] of [[-10, -10], [10, -10], [-10, 10], [10, 10]]) {
        for (const [x, z] of ring(6, 5.6, cx, cz, 0.2)) g.add(helix(m1, x, z, -20, 20));
        for (let i = 0; i < 4; i++) { const w = water(); w.userData = { cx, cz, i }; g.add(w); waters.push(w); }
      }
      return { group: g, update(o, t, k) {
        const s = (t - o.start) * k('rate') * 60, on = k('cargo') > 0.5;
        for (const w of waters) { const u = w.userData, y = 28 - (((s + u.i * 15) % 60) + 60) % 60; w.visible = on; w.position.set(u.cx, y, u.cz); w.rotation.y = y * 0.2; }
      } };
    } },
    ionchannel: { label: 'Ion channel (K⁺)', r3: 30, build(p) {
      const g = new THREE.Group(), m1 = stdMat(p.color || '#9A72AC', { roughness: 0.45 }), gates = [], ions = [];
      for (let s = 0; s < 4; s++) {
        const a = Math.PI / 4 + s * Math.PI / 2, cx = Math.cos(a) * 12, cz = Math.sin(a) * 12, sub = new THREE.Group();
        for (const [x, z] of ring(4, 5, cx, cz, a)) sub.add(helix(m1, x, z, -10, 22));
        const gate = helix(m1, Math.cos(a) * 7, Math.sin(a) * 7, -24, -6); sub.add(gate); gates.push([gate, a]);
        g.add(sub);
      }
      const filt = new THREE.Mesh(new THREE.TorusGeometry(4.5, 1.2, 10, 24), stdMat('YELLOW')); filt.rotation.x = Math.PI / 2; filt.position.y = 12; g.add(filt);
      const im = stdMat(p.accent || '#D147BD');
      for (let i = 0; i < 5; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(2.3, 14, 10), im); g.add(m); ions.push(m); }
      return { group: g, update(o, t, k) {
        const open = clamp(k('open'), 0, 1), s = (t - o.start) * k('rate') * 60;
        for (const [gt, a] of gates) gt.position.set(Math.cos(a) * (7 + open * 5), -15, Math.sin(a) * (7 + open * 5));
        ions.forEach((m, i) => { const y = 32 - (((s + i * 12) % 60) + 60) % 60; m.visible = k('cargo') > 0.5 && (open > 0.3 || y > -2); m.position.set(0, open > 0.3 ? y : Math.max(y, -2 + i * 0.01), 0); });
      } };
    } }
  };

  /* ---------------- clay looks (matcaps, as in ClayForm) ---------------- */
  const MATCAPS = {};
  function matcap(kind) {
    if (MATCAPS[kind]) return MATCAPS[kind];
    const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, 256, 256);
    const g = x.createRadialGradient(100, 90, 8, 128, 128, 128);
    if (kind === 'glossy') { g.addColorStop(0, '#ffffff'); g.addColorStop(0.08, '#f2f2f2'); g.addColorStop(0.2, '#c9c9c9'); g.addColorStop(0.75, '#5a5a5a'); g.addColorStop(1, '#262626'); }
    else { g.addColorStop(0, '#f4f1ee'); g.addColorStop(0.45, '#c8c2bc'); g.addColorStop(0.85, '#7a7470'); g.addColorStop(1, '#8a8480'); }
    x.fillStyle = g; x.beginPath(); x.arc(128, 128, 127, 0, Math.PI * 2); x.fill();
    if (kind !== 'glossy') { const rim = x.createRadialGradient(128, 128, 100, 128, 128, 128); rim.addColorStop(0, 'rgba(255,240,225,0)'); rim.addColorStop(1, 'rgba(255,240,225,0.35)'); x.fillStyle = rim; x.beginPath(); x.arc(128, 128, 127, 0, Math.PI * 2); x.fill(); }
    const t = new THREE.CanvasTexture(c); MATCAPS[kind] = t; return t;
  }
  function applyLook(root, look) {
    root.traverse(m => {
      if (!m.isMesh) return;
      if (!m.userData.orig) m.userData.orig = m.material;
      const orig = m.userData.orig;
      if (look === 'original') { m.material = orig; return; }
      const o = Array.isArray(orig) ? orig[0] : orig;
      m.material = new THREE.MeshMatcapMaterial({ matcap: matcap(look), color: o.color ? o.color.clone() : new THREE.Color(0xffffff), vertexColors: !!(m.geometry && m.geometry.attributes.color),
        skinning: !!m.isSkinnedMesh, morphTargets: !!(m.geometry && m.geometry.morphAttributes && m.geometry.morphAttributes.position), side: THREE.DoubleSide });
    });
  }

  /* ======================================================================
     Membrane, tight junction and paper stack (from Psi Phi Studio), as entries
     ====================================================================== */
  const _mP = OK && new THREE.Vector3(), _mN = OK && new THREE.Vector3(), _mT1 = OK && new THREE.Vector3(), _mT2 = OK && new THREE.Vector3(), _mD = OK && new THREE.Vector3(), _mH = OK && new THREE.Vector3(),
    _mQ = OK && new THREE.Quaternion(), _mS = OK && new THREE.Vector3(), _mM = OK && new THREE.Matrix4(), _mY = OK && new THREE.Vector3(0, 1, 0), _mC = OK && new THREE.Vector3(), _mA = OK && new THREE.Vector3();
  function lipidMeshes(group, count, head, tail) {
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshStandardMaterial({ color: col(head), roughness: 0.4, metalness: 0.05 }), count);
    const tails = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 0.8, 1, 6, 1, false), new THREE.MeshStandardMaterial({ color: col(tail), roughness: 0.55, metalness: 0.02 }), count * 2);
    for (const m of [heads, tails]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; group.add(m); }
    return { heads, tails };
  }
  function makeMembrane(p) {
    const D = +p.radius || 110, n = Math.max(40, Math.round(Math.PI * D * D / 62)), lip = [];
    for (const s of [1, -1]) for (let i = 0; i < n; i++) {
      const kk = s > 0 ? i : i + 0.5, j = lip.length;
      lip.push({ s, rho: D * Math.sqrt((kk + 0.5) / n), phi: kk * 2.399963, p1: hash01(j) * 6.283, p2: hash01(j + 9999) * 6.283, az: hash01(j + 4242) * 6.283, sp: (hash01(j + 777) - 0.5) * 0.25 });
    }
    lip.sort((a, b) => a.rho - b.rho);  // so “Create” grows it from the middle outwards
    const group = new THREE.Group(), { heads, tails } = lipidMeshes(group, lip.length, p.head || 'GOLD', p.tail || '#ECE6CF');
    let key = '';
    return { group, r3: D, reveal(f) { heads.count = Math.round(lip.length * f); tails.count = heads.count * 2; }, setOpacity(op) { setOp(heads, op); setOp(tails, op); },
      update(o, t, k) {
        const b = k('bend'), th = k('thermal'), pore = k('pore'), tt = th > 0.001 ? t : 0;
        const kk = [b, th, pore, tt].map(v => (+v).toFixed(4)).join('|'); if (kk === key) return; key = kk;
        const r = b > 1e-3 ? D / (2 * b) : 0;
        const almax = r ? 2 * Math.asin(Math.min(1, D / (2 * r))) : 0, yshift = r ? r * (1 - Math.cos(almax)) / 2 : 0;
        lip.forEach((L, i) => {
          const cphi = Math.cos(L.phi), sphi = Math.sin(L.phi);
          if (!r) { _mP.set(L.rho * cphi, 0, L.rho * sphi); _mN.set(0, 1, 0); }
          else { const al = 2 * Math.asin(Math.min(1, L.rho / (2 * r))), sa = Math.sin(al), ca = Math.cos(al); _mP.set(r * sa * cphi, -r * (1 - ca) + yshift, r * sa * sphi); _mN.set(sa * cphi, ca, sa * sphi); }
          const kz = pore > 0 ? clamp((L.rho - pore) / 5, 0, 1) : 1;
          _mA.set(Math.abs(_mN.z) < 0.9 ? 0 : 1, 0, Math.abs(_mN.z) < 0.9 ? 1 : 0);
          _mT1.crossVectors(_mN, _mA).normalize(); _mT2.crossVectors(_mN, _mT1);
          const ca = Math.cos(L.az), sa = Math.sin(L.az);
          _mC.copy(_mT1).multiplyScalar(ca).addScaledVector(_mT2, sa);
          const bob = th * 1.3 * Math.sin(tt * 2.3 + L.p1);
          _mH.copy(_mP).addScaledVector(_mN, L.s * (MEM_HALF + bob));
          _mM.makeScale(4.2 * kz, 4.2 * kz, 4.2 * kz); _mM.setPosition(_mH); heads.setMatrixAt(i, _mM);
          const w1 = th * 0.32 * Math.sin(tt * 1.9 + L.p2), w2 = th * 0.32 * Math.cos(tt * 1.4 + L.p1);
          for (let q = 0; q < 2; q++) {
            const side = q ? -1 : 1;
            _mD.copy(_mN).multiplyScalar(-L.s).addScaledVector(_mT1, w1 + side * (0.12 + L.sp)).addScaledVector(_mT2, w2).normalize();
            _mS.copy(_mH).addScaledVector(_mN, -L.s * 3.2).addScaledVector(_mC, side * 1.6).addScaledVector(_mD, TAIL_LEN * kz / 2);
            _mQ.setFromUnitVectors(_mY, _mD);
            _mM.compose(_mS, _mQ, _mA.set(1.15 * kz + 1e-4, TAIL_LEN * kz + 1e-4, 1.15 * kz + 1e-4)); tails.setMatrixAt(i * 2 + q, _mM);
          }
        });
        heads.instanceMatrix.needsUpdate = true; tails.instanceMatrix.needsUpdate = true;
      } };
  }
  function makeJunction(p) {
    const lip = [], strands = [], sol = [], sp = 7.9, n = Math.floor(JL / sp);
    let j = 0;
    for (const c of [-1, 1]) for (const s of [1, -1]) for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      j++;
      lip.push({ c, s, y: -JL / 2 + (a + 0.5 + (hash01(j) - 0.5) * 0.5) * sp, z: -JL / 2 + (b + 0.5 + (hash01(j + 3131) - 0.5) * 0.5) * sp, p1: hash01(j + 17) * 6.283, p2: hash01(j + 9999) * 6.283, az: hash01(j + 4242) * 6.283, sp: (hash01(j + 777) - 0.5) * 0.25 });
    }
    for (const c of [-1, 1]) for (let k = 0; k < 5; k++) for (let z = -JL / 2 + 3; z < JL / 2 - 2; z += 6.5) strands.push({ c, y0: -40 + k * 20, z, ph: k * 1.7 + (c > 0 ? 0.4 : 0), p: hash01(strands.length + 55) * 6.283 });
    for (let i = 0; i < 80; i++) sol.push({ x: hash01(i + 901) - 0.5, z: (hash01(i + 1901) - 0.5) * JL * 0.9, ph: hash01(i + 2901) * JL });
    const group = new THREE.Group(), { heads, tails } = lipidMeshes(group, lip.length, p.head || 'GOLD', p.tail || '#ECE6CF');
    const mk = (geo, c, count) => { const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: col(c), roughness: 0.35, metalness: 0.04 }), count); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; group.add(m); return m; };
    const cl = mk(new THREE.SphereGeometry(1, 14, 10), p.strand || 'RED', strands.length), so = mk(new THREE.SphereGeometry(1, 10, 8), p.solute || 'TEAL', sol.length);
    let key = '', rv = 1;
    return { group, r3: 75, reveal(f) { rv = f; heads.count = Math.round(lip.length * f); tails.count = heads.count * 2; cl.count = Math.round(strands.length * f); }, setOpacity(op) { for (const m of [heads, tails, cl, so]) setOp(m, op); },
      update(o, t, k) {
        const gap = k('gap'), st = clamp(k('strands'), 0, 1), fl = clamp(k('flow'), 0, 1), th = k('jiggle');
        const kk = [gap, st, fl, th, t].map(v => (+v).toFixed(4)).join('|'); if (kk === key) return; key = kk;
        _mT1.set(0, 0, 1); _mT2.set(0, 1, 0);
        lip.forEach((L, i) => {
          const xm = L.c * (gap / 2 + 7 + MEM_HALF);
          _mN.set(-L.c * L.s, 0, 0); _mP.set(xm, L.y, L.z);
          const bob = th * 1.3 * Math.sin(t * 2.3 + L.p1);
          _mH.copy(_mP).addScaledVector(_mN, MEM_HALF + bob);
          _mM.makeScale(4.2, 4.2, 4.2); _mM.setPosition(_mH); heads.setMatrixAt(i, _mM);
          const ca = Math.cos(L.az), sa = Math.sin(L.az);
          _mC.copy(_mT1).multiplyScalar(ca).addScaledVector(_mT2, sa);
          const w1 = th * 0.32 * Math.sin(t * 1.9 + L.p2), w2 = th * 0.32 * Math.cos(t * 1.4 + L.p1);
          for (let q = 0; q < 2; q++) {
            const side = q ? -1 : 1;
            _mD.copy(_mN).negate().addScaledVector(_mT1, w1 + side * (0.12 + L.sp)).addScaledVector(_mT2, w2).normalize();
            _mS.copy(_mH).addScaledVector(_mN, -3.2).addScaledVector(_mC, side * 1.6).addScaledVector(_mD, TAIL_LEN / 2);
            _mQ.setFromUnitVectors(_mY, _mD);
            _mM.compose(_mS, _mQ, _mA.set(1.15, TAIL_LEN, 1.15)); tails.setMatrixAt(i * 2 + q, _mM);
          }
        });
        strands.forEach((B, i) => {
          const y = B.y0 + 4 * Math.sin(B.z / 14 + B.ph) + th * 0.6 * Math.sin(t * 2 + B.p);
          const kz = smooth(clamp(st * 1.15 - hash01(i + 333) * 0.15, 0, 1));
          _mH.set(B.c * (gap / 2 + 3.6), y, B.z);
          _mM.makeScale(4.2 * kz + 1e-4, 3.1 * kz + 1e-4, 3.1 * kz + 1e-4); _mM.setPosition(_mH); cl.setMatrixAt(i, _mM);
        });
        const open = clamp((gap - 5) / 7, 0, 1) * fl;
        sol.forEach((P, i) => {
          const y = JL / 2 - ((P.ph + t * 14) % JL);
          const s2 = open * clamp(Math.min(JL / 2 - y, y + JL / 2) / 10, 0, 1) * 2.3 + 1e-4;
          _mH.set(P.x * Math.max(0, gap - 6), y, P.z); _mM.makeScale(s2, s2, s2); _mM.setPosition(_mH); so.setMatrixAt(i, _mM);
        });
        for (const m of [heads, tails, cl, so]) m.instanceMatrix.needsUpdate = true;
      } };
  }
  function makePaper(canvases, p) {
    const group = new THREE.Group(), pages = [];
    canvases.forEach((cv, i) => {
      const aspect = cv.width / cv.height, tex = new THREE.CanvasTexture(cv);
      const geo = new THREE.PlaneGeometry(aspect, 1);
      const front = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.FrontSide }));
      const back = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xcfd3da, side: THREE.BackSide }));
      const pivot = new THREE.Group(); pivot.add(front, back); group.add(pivot);
      pages.push({ pivot, front, back, aspect, j: [hash01(i + 1) - 0.5, hash01(i + 51) - 0.5, hash01(i + 101) - 0.5] });
    });
    const size = 50;
    return { group, r3: 45, reveal(f) { pages.forEach((P, i) => { P.pivot.visible = i < Math.ceil(pages.length * f - 1e-6); }); }, setOpacity(op) { for (const P of pages) { setOp(P.front, op); setOp(P.back, op); } },
      update(o, t, k) {
        const n = pages.length, spread = smooth(clamp(k('spread'), 0, 1)), fan = k('fan') * DEG, focus = k('focus') - 1, lift = k('lift'), layout = o.props.layout || 'fan';
        const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
        pages.forEach((P, i) => {
          const asp = P.aspect;
          let sx = P.j[0] * 1.5, sy = P.j[1], sz = -i * 0.5, sr = P.j[2] * 5 * DEG;
          let lx = 0, ly = 0, lz = -i * 0.25, lr = 0;
          if (layout === 'fan') { const a = n > 1 ? (i / (n - 1) - 0.5) * fan : 0, R0 = size * 1.5; lx = Math.sin(a) * R0; ly = Math.cos(a) * R0 - R0; lr = -a; }
          else if (layout === 'row') lx = (i - (n - 1) / 2) * size * asp * 1.1;
          else { const c = i % cols, rr = Math.floor(i / cols); lx = (c - (cols - 1) / 2) * size * asp * 1.08; ly = -(rr - (rows - 1) / 2) * size * 1.08; }
          let x = lerp(sx, lx, spread), y = lerp(sy, ly, spread), z = lerp(sz, lz, spread), rz = lerp(sr, lr, spread), sc = 1;
          const w = smooth(clamp(lift * (1 - Math.abs(i - focus)), 0, 1));
          if (w > 0) { x = lerp(x, 0, w); y = lerp(y, size * 0.08, w); z = lerp(z, size * 0.9, w); rz = lerp(rz, 0, w); sc = 1 + 0.45 * w; }
          P.pivot.position.set(x, y, z); P.pivot.rotation.set(0, 0, rz); P.pivot.scale.set(size * sc, size * sc, 1);
        });
      } };
  }
  function setOp(mesh, a) {
    if (!mesh) return;
    const m = mesh.material, base = m.userData.baseOp == null ? (m.userData.baseOp = m.transparent ? m.opacity : 1) : m.userData.baseOp;
    const want = base * a, tr = want < 0.995 || m.userData.wasTransparent;
    if (m.userData.wasTransparent == null) m.userData.wasTransparent = m.transparent;
    if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
    m.opacity = want;
  }
  function setGroupOpacity(group, op) { group.traverse(m => { if (m.material) setOp(m, op); }); }

  /* ======================================================================
     Structures (proteins / nucleic acids) and molecules
     ====================================================================== */
  function makeStructure(st, p, isMol) {
    const mode = p.color || (isMol ? 'element' : 'ss');
    const group = new THREE.Group();
    const cartoon = isMol ? null : buildCartoon(st, mode); if (cartoon) group.add(cartoon);
    const polyList = [], hetList = [];
    st.atoms.forEach((a, i) => { const r = st.res[a.ri]; if (r.kind === 'water') { if (p.water) hetList.push(i); } else if (r.kind === 'lig') hetList.push(i); else polyList.push(i); });
    const sty = isMol ? (MOL_STYLES[p.style] || MOL_STYLES.ballstick) : null;
    const poly = buildAtomSet(st, polyList, mode), het = buildAtomSet(st, hetList, mode, sty);
    for (const s of [poly, het]) if (s) { group.add(s.mesh); if (s.bonds) group.add(s.bonds); }
    const idxCount = cartoon ? cartoon.geometry.index.count : 0;
    let rv = 1;
    return { group, r3: st.radius, st,
      reveal(f) { rv = f; if (cartoon) cartoon.geometry.setDrawRange(0, Math.floor(idxCount * f / 3) * 3); for (const s of [poly, het]) if (s) { s.mesh.count = Math.round(s.list.length * f); if (s.outline) s.outline.count = s.mesh.count; if (s.bonds) s.bonds.visible = f > 0.999; } },
      setOpacity(op) { this._op = op; },
      update(o, t, k) {
        const op = this._op == null ? 1 : this._op;
        if (isMol) { const sz = k('atomSize'), sk = k('sticks'); if (het) { setAtomSize(het, st, sz); setOp(het.mesh, op); setOp(het.outline, op); setOp(het.bonds, op * sk); if (het.bonds) { het.bonds.visible = rv > 0.999 && op * sk > 0.004; for (const c of het.bonds.children) setOp(c, op * sk); } } return; }
        const at = k('atoms'), sz = k('atomSize'), sk = k('sticks'), lg = k('ligands');
        setOp(cartoon, op * k('cartoon'));
        if (cartoon) cartoon.visible = op * k('cartoon') > 0.004;
        if (poly) { setAtomSize(poly, st, sz); setOp(poly.mesh, op * at); poly.mesh.visible = op * at > 0.004; setOp(poly.bonds, op * at * sk); if (poly.bonds) poly.bonds.visible = rv > 0.999 && op * at * sk > 0.004; }
        if (het) { setAtomSize(het, st, sz); setOp(het.mesh, op * lg); het.mesh.visible = op * lg > 0.004; setOp(het.bonds, op * lg * sk); if (het.bonds) het.bonds.visible = rv > 0.999 && op * lg * sk > 0.004; }
      } };
  }

  /* ---------- OBJ files (from Blender and others): positions, normals, UVs, vertex colours, one part per object/material ---------- */
  function objToGroup(text, p) {
    const V = [], N = [], T = [], VC = [];
    const parts = []; let cur = null;
    const part = name => { cur = { name, pos: [], nor: [], col: [] }; parts.push(cur); };
    part('Model');
    const lines = text.split(/\r?\n/);
    for (const raw of lines) {
      const t = raw.trim().split(/\s+/); const k = t[0];
      if (k === 'v') { V.push(+t[1], +t[2], +t[3]); if (t.length >= 7) VC.push(+t[4], +t[5], +t[6]); else VC.push(NaN, NaN, NaN); }
      else if (k === 'vn') N.push(+t[1], +t[2], +t[3]);
      else if (k === 'vt') T.push(+t[1], +t[2]);
      else if ((k === 'o' || k === 'g' || k === 'usemtl') && cur.pos.length) part(t.slice(1).join(' ') || 'Part');
      else if (k === 'f') {
        const nv = V.length / 3, nn = N.length / 3;
        const f = t.slice(1).map(w => { const a = w.split('/'); let vi = parseInt(a[0], 10), ni = a[2] ? parseInt(a[2], 10) : NaN; vi = vi < 0 ? nv + vi : vi - 1; ni = isNaN(ni) ? -1 : ni < 0 ? nn + ni : ni - 1; return [vi, ni]; });
        for (let j = 1; j + 1 < f.length; j++) for (const [vi, ni] of [f[0], f[j], f[j + 1]]) {
          cur.pos.push(V[vi * 3], V[vi * 3 + 1], V[vi * 3 + 2]);
          if (ni >= 0) cur.nor.push(N[ni * 3], N[ni * 3 + 1], N[ni * 3 + 2]); else cur.nor = null;
          if (!isNaN(VC[vi * 3])) cur.col.push(VC[vi * 3], VC[vi * 3 + 1], VC[vi * 3 + 2]); else cur.col = null;
        }
      }
    }
    const root = new THREE.Group(); let tris = 0;
    const tints = ['#C9CED6', '#8FB8E8', '#E8B48F', '#9FD4A3', '#D7A0F0', '#F28B82'];
    parts.filter(q => q.pos.length).forEach((q, i) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(q.pos, 3));
      if (q.nor && q.nor.length === q.pos.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(q.nor, 3)); else g.computeVertexNormals();
      if (q.col && q.col.length === q.pos.length) g.setAttribute('color', new THREE.Float32BufferAttribute(q.col, 3));
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col(tints[i % tints.length]), roughness: 0.55, metalness: 0.05, vertexColors: !!g.attributes.color, side: THREE.DoubleSide }));
      m.name = q.name; m.frustumCulled = false; root.add(m); tris += q.pos.length / 9;
    });
    if (!tris) throw new Error('no faces found in that OBJ');
    root.userData.tris = tris;
    return root;
  }

  /* ---------- atoms: an element in four looks (CG sphere, Bohr model, 3D orbits, electron cloud) ---------- */
  const ATOM_STYLES = [['cg', 'CG sphere (glossy, outlined)'], ['bohr', 'Bohr model (flat shells)'], ['orbits', '3D orbits'], ['cloud', 'Electron cloud']];
  function labelSprite(text, sub, color) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 160; const x = c.getContext('2d');
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = '700 92px "IBM Plex Sans", system-ui, sans-serif'; x.lineWidth = 14; x.strokeStyle = 'rgba(10,12,18,0.85)'; x.strokeText(text, 128, 70); x.fillStyle = color || '#ffffff'; x.fillText(text, 128, 70);
    if (sub) { x.font = '500 34px "IBM Plex Sans", system-ui, sans-serif'; x.lineWidth = 8; x.strokeText(sub, 128, 136); x.fillStyle = '#d8dbe3'; x.fillText(sub, 128, 136); }
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
    sp.renderOrder = 10; return sp;
  }
  function outlineOf(mesh, w) {
    const o = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color: 0x0b0d12, side: THREE.BackSide }));
    o.scale.setScalar(1 + (w || 0.06)); mesh.add(o); return o;
  }
  function makeAtom(p) {
    const E = window.Elements, el = (E && (E.find(p.element) || E.find(6))) || { z: 6, sym: 'C', name: 'Carbon', mass: 12.011, shells: [2, 4] };
    const charge = Math.round(+p.charge || 0), style = p.style || 'cg';
    const shells = E ? E.shells(el.z, charge) : el.shells, base = E ? E.colorOf(el) : '#9AA3B0';
    const group = new THREE.Group(), spin = new THREE.Group(); group.add(spin);
    const chargeText = charge ? (Math.abs(charge) > 1 ? Math.abs(charge) : '') + (charge > 0 ? '+' : '−') : '';
    const movers = []; let R = 4;
    const nucleus = () => {
      const A = Math.max(el.z, Math.round(el.mass || el.z * 2)), np = Math.min(el.z, 40), nn = Math.min(Math.max(0, A - el.z), Math.round(40 * (A - el.z) / Math.max(1, el.z)));
      const k = np + nn, Rn = 0.62 * Math.cbrt(k), g = new THREE.Group(), geo = new THREE.SphereGeometry(0.5, 18, 14);
      const mp = new THREE.MeshPhysicalMaterial({ color: col(p.proton || '#FC6255'), roughness: 0.3, clearcoat: 0.6 }), mn = new THREE.MeshPhysicalMaterial({ color: col(p.neutron || '#9AA3B0'), roughness: 0.35, clearcoat: 0.5 });
      const rnd = seeded(el.z * 7 + 3), kinds = []; for (let i = 0; i < k; i++) kinds.push(i < np ? 1 : 0);
      for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
      for (let i = 0; i < k; i++) {
        const r = Rn * Math.cbrt((i + 0.5) / k) * (k > 1 ? 1 : 0), y = 1 - 2 * (i + 0.5) / k, rr = Math.sqrt(Math.max(0, 1 - y * y)), a = i * 2.39996323;
        const m = new THREE.Mesh(geo, kinds[i] ? mp : mn); m.position.set(Math.cos(a) * rr * r, y * r, Math.sin(a) * rr * r); g.add(m);
      }
      return { g, Rn: Rn + 0.5 };
    };
    if (style === 'cg') {
      const r = 2.2 + 0.25 * Math.cbrt(el.z);
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 32), new THREE.MeshPhysicalMaterial({ color: col(p.color || base), roughness: 0.22, metalness: 0.02, clearcoat: 1, clearcoatRoughness: 0.15 }));
      spin.add(m); outlineOf(m, 0.05); R = r;
    } else {
      const N = nucleus(); spin.add(N.g);
      const eMat = new THREE.MeshPhysicalMaterial({ color: col(p.electron || '#58C4DD'), roughness: 0.25, clearcoat: 1, emissive: col(p.electron || '#58C4DD'), emissiveIntensity: 0.25 });
      const ringMat = new THREE.MeshBasicMaterial({ color: col(p.ring || '#cfd4dc'), transparent: true, opacity: 0.55 });
      const eGeo = new THREE.SphereGeometry(0.32, 16, 12), gap = style === 'cloud' ? 1.1 : 1.25;
      shells.forEach((n, i) => {
        const r = N.Rn + 1.4 + i * gap * (style === 'cloud' ? 1 : 1.15), holder = new THREE.Group();
        if (style === 'orbits') { const rnd = seeded(31 + i * 17); holder.rotation.set((rnd() - 0.5) * 2.6, (rnd() - 0.5) * 2.6, rnd() * Math.PI); }
        spin.add(holder);
        if (style === 'cloud') {
          const cnt = Math.min(1400, 160 + n * 70), pos = new Float32Array(cnt * 3), rnd = seeded(97 + i * 13);
          for (let j = 0; j < cnt; j++) { const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, rr = r + (rnd() + rnd() + rnd() - 1.5) * gap * 0.55, q = Math.sqrt(1 - u * u); pos[j * 3] = Math.cos(a) * q * rr; pos[j * 3 + 1] = u * rr; pos[j * 3 + 2] = Math.sin(a) * q * rr; }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
          const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: col(p.electron || '#58C4DD'), size: 0.16, transparent: true, opacity: 0.75, depthWrite: false }));
          holder.add(pts); movers.push({ holder, w: 0.25 / (i + 1), axis: 'y' });
        } else {
          holder.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.06, 8, 96), ringMat));
          const es = new THREE.Group(); holder.add(es);
          for (let j = 0; j < n; j++) { const a = j / n * Math.PI * 2, m = new THREE.Mesh(eGeo, eMat); m.position.set(Math.cos(a) * r, Math.sin(a) * r, 0); es.add(m); }
          movers.push({ holder: es, w: 1.4 / Math.pow(i + 1, 1.1) * (i % 2 ? -1 : 1), axis: 'z' });
        }
        R = r + 0.4;
      });
      if (style === 'bohr') spin.rotation.set(0, 0, 0);
    }
    let lab = null;
    if (p.labels !== false) {
      lab = labelSprite(el.sym + (chargeText ? chargeText : ''), p.labelName === false ? '' : (el.z + ' · ' + el.name), '#ffffff');
      const s = Math.max(3.2, R * 0.75); lab.scale.set(s * 1.6, s, 1); lab.position.set(0, style === 'cg' ? 0 : -R - s * 0.45, R * 0.2);
      group.add(lab);
    }
    return { group, r3: R + (lab && style !== 'cg' ? 2 : 0), update(o, t, k) {
      const sp = k('speed'), lt = (t - o.start) * sp;
      for (const m of movers) m.holder.rotation[m.axis] = lt * m.w * Math.PI;
      if (style === 'cloud' || style === 'cg') spin.rotation.y = lt * 0.15;
    } };
  }

  /* ======================================================================
     Object types (registered into Animath)
     ====================================================================== */
  // keyable numbers per type: [key, label, min, max, step, default]
  const K3 = {
    common: [['spin', 'Spin (°)', -360, 360, 1, 0], ['tilt3', 'Tilt (°)', -180, 180, 1, 0], ['z3', 'Depth (units)', -20, 20, 0.05, 0]],
    pdb: [['cartoon', 'Cartoon', 0, 1, 0.01, 1], ['atoms', 'Atoms', 0, 1, 0.01, 0], ['atomSize', 'Atom size', 0.15, 1, 0.01, 0.28], ['sticks', 'Sticks', 0, 1, 0.01, 1], ['ligands', 'Ligands', 0, 1, 0.01, 1]],
    molecule: [['atomSize', 'Atom size', 0.12, 1, 0.01, 0.3], ['sticks', 'Sticks', 0, 1, 0.01, 1]],
    sculpt: [],
    atom: [['speed', 'Electron speed', 0, 4, 0.01, 1]],
    membrane: [['bend', 'Curvature', 0, 1, 0.01, 0], ['thermal', 'Jiggle', 0, 1, 0.01, 0.5], ['pore', 'Pore (Å)', 0, 60, 0.5, 0]],
    junction: [['gap', 'Gap (Å)', 0, 40, 0.5, 0], ['strands', 'Strands', 0, 1, 0.01, 1], ['flow', 'Leak', 0, 1, 0.01, 0], ['jiggle', 'Jiggle', 0, 1, 0.01, 0.4]],
    paper: [['spread', 'Spread', 0, 1, 0.01, 0], ['fan', 'Fan angle (°)', 5, 140, 1, 50], ['focus', 'Focus page', 1, 12, 0.01, 1], ['lift', 'Lift page', 0, 1, 0.01, 0]],
    prim3d: [],
    transporter: [['rate', 'Speed (cycles/s)', 0, 3, 0.01, 0.5], ['cargo', 'Show cargo', 0, 1, 1, 1], ['open', 'Gate open (channel)', 0, 1, 0.01, 1]],
    bio3d: [['flow', 'Flow', 0, 3, 0.01, 1], ['signal', 'Signal (neuron)', 0, 1, 0.01, 0], ['unzip', 'Unzip (DNA)', 0, 1, 0.01, 0]]
  };
  const DEF_TILT = { membrane: 12, junction: 0 };
  const keyList = type => (K3[type] || []).concat(K3.common);
  function k3def(type, k) { const e = keyList(type).find(x => x[0] === k); if (k === 'tilt3' && DEF_TILT[type] != null) return DEF_TILT[type]; return e ? e[5] : 0; }
  function kv(o, k, t) { const v = A.keyVal(o, k, t); return typeof v === 'number' && isFinite(v) ? v : k3def(o.type, k); }
  const hitBox = (p, fit) => { const h = p.realScale ? Math.max(0.3, (p.r3 || 25) / U) : (fit || FIT) / U; return [{ k: 'dyn', bb: [-h, -h, h, h], draw: () => {} }]; };
  const COLOR_MODES = [['ss', 'Secondary structure'], ['rainbow', 'Rainbow (N → C)'], ['chain', 'By chain'], ['element', 'By element']];
  const TRUE = ['realScale', 'True size (1 unit = 10 Å)', 'bool'];
  const TYPES3 = {
    pdb: { label: 'Protein', icon: '🧬', defaults: { src: 'demo', title: 'Four-helix bundle', color: 'ss', water: false, r3: 22, realScale: false },
      fields: [['title', 'Title', 'text'], ['color', 'Colour by', 'select', COLOR_MODES], ['water', 'Show water', 'bool'], TRUE] },
    molecule: { label: 'Molecule', icon: '⌬', defaults: { smiles: 'OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O', sdf: '', title: 'Glucose', color: 'element', style: 'cg', r3: 5, realScale: false },
      fields: [['title', 'Name', 'text'], ['style', 'Style', 'select', [['cg', 'CG (glossy, two-tone bonds)'], ['ballstick', 'Ball and stick'], ['spacefill', 'Space-filling'], ['sticks', 'Sticks'], ['toon', 'Toon (outlined)']]], ['smiles', 'SMILES (used when there’s no PubChem file)', 'text'], ['color', 'Colour by', 'select', [['element', 'By element'], ['chain', 'Single colour']]], TRUE] },
    membrane: { label: 'Membrane', icon: '≋', defaults: { radius: 110, head: 'GOLD', tail: '#ECE6CF', r3: 110, realScale: false },
      fields: [['radius', 'Patch size', 'select', [[70, 'Small (14 nm)'], [110, 'Medium (22 nm)'], [160, 'Large (32 nm)']]], ['head', 'Head groups', 'color'], ['tail', 'Tails', 'color'], TRUE] },
    junction: { label: 'Tight junction', icon: '⫴', defaults: { head: 'GOLD', tail: '#ECE6CF', strand: 'RED', solute: 'TEAL', r3: 75, realScale: false },
      fields: [['strand', 'Claudin strands', 'color'], ['solute', 'Solutes', 'color'], ['head', 'Head groups', 'color'], TRUE] },
    paper: { label: 'Paper stack', icon: '🗎', defaults: { src: 'placeholder', title: 'Placeholder paper', layout: 'fan', pages: 5, r3: 45, realScale: false },
      fields: [['title', 'Title', 'text'], ['layout', 'Spread layout', 'select', [['fan', 'Fan'], ['row', 'Row'], ['grid', 'Grid']]]] },
    prim3d: { label: '3D shape', icon: '⬢', defaults: { shape: 'sphere', color: 'BLUE', material: 'glossy', r3: 1.2, realScale: false },
      fields: [['shape', 'Shape', 'select', Object.keys(PRIMS).map(k => [k, k[0].toUpperCase() + k.slice(1)])], ['color', 'Colour', 'color'], ['material', 'Material', 'select', [['glossy', 'Glossy'], ['matte', 'Matte'], ['clay', 'Clay'], ['clayglossy', 'Glazed clay'], ['metal', 'Metal'], ['glass', 'Glass'], ['toon', 'Toon'], ['wire', 'Wireframe']]]] },
    sculpt: { label: 'Sculpt', icon: '◕', defaults: { src: '', cfId: '', title: 'Clay sculpt', look: 'clay', play: true, speed: 1, loop: true, r3: 1.4, realScale: false },
      fields: [['title', 'Title', 'text'], ['look', 'Look', 'select', [['original', 'As made (its own colours)'], ['clay', 'Clay (as in ClayForm)'], ['glossy', 'Glazed clay']]], ['play', 'Play its animation', 'bool'], ['speed', 'Animation speed', 'num', 0.1], ['loop', 'Loop the animation', 'bool']] },
    atom: { label: 'Atom', icon: '⚛', defaults: { element: 'C', style: 'bohr', charge: 0, labels: true, labelName: true, color: '', electron: '#58C4DD', proton: '#FC6255', neutron: '#9AA3B0', r3: 10, realScale: false },
      fields: [['element', 'Element (symbol, name or number)', 'text'], ['style', 'Style', 'select', ATOM_STYLES], ['charge', 'Charge (ions: +1, −2 …)', 'num', 1], ['labels', 'Label', 'bool'], ['labelName', 'Number and name under the symbol', 'bool', null, p => p.labels !== false],
        ['color', 'Sphere colour (blank = element colour)', 'color', null, p => p.style === 'cg'], ['electron', 'Electrons', 'color', null, p => p.style !== 'cg'], ['proton', 'Protons', 'color', null, p => p.style !== 'cg'], ['neutron', 'Neutrons', 'color', null, p => p.style !== 'cg']] },
    transporter: { label: 'Transporter', icon: '⧖', defaults: { kind: 'glut1', color: '', accent: '', r3: 30, realScale: false },
      fields: [['kind', 'Protein', 'select', Object.entries(TRANSPORTERS).map(([k, v]) => [k, v.label])], ['color', 'Main colour', 'color'], ['accent', 'Accent colour', 'color'], TRUE] },
    bio3d: { label: 'Bio model', icon: '◉', defaults: { kind: 'rbc', color: '', accent: '', r3: 40, realScale: false },
      fields: [['kind', 'Model', 'select', Object.entries(BIO_KINDS).map(([k, v]) => [k, v.label])], ['color', 'Main colour', 'color'], ['accent', 'Accent colour', 'color'], TRUE] }
  };
  for (const [k, T] of Object.entries(TYPES3)) { T.build = p => hitBox(p, FITS[k]); T.is3D = true; A.TYPES[k] = T; }

  /* ======================================================================
     Registry: Animath object → 3D entry
     ====================================================================== */
  const ENT = new Map();       // obj id → { sig, entry | null, status }
  const DATA = new Map();      // data key → { status, value }
  let mediaGetter = null, onReady = null;
  function dataKey(o) { const p = o.props; if (o.type === 'sculpt') return 'sculpt:' + o.id + ':' + p.src; if (o.type === 'pdb') return 'pdb:' + p.src; if (o.type === 'paper') return 'paper:' + p.src; if (o.type === 'molecule') return 'mol:' + (p.sdf || '') + '|' + p.smiles; return null; }
  function loadData(key, o) {
    let d = DATA.get(key); if (d) return d;
    d = { status: 'loading', value: null }; DATA.set(key, d);
    const p = o.props;
    (async () => {
      if (o.type === 'pdb') {
        if (p.src === 'demo') return buildStruct(demoRaw(), 'Four-helix bundle');
        const blob = mediaGetter && await mediaGetter(p.src); if (!blob) throw new Error('structure file missing');
        const text = await blob.text();
        return buildStruct(/_atom_site\./.test(text) ? parseCIF(text) : parsePDB(text), p.title);
      }
      if (o.type === 'molecule') {
        let raw = null;
        if (p.sdf) { const blob = mediaGetter && await mediaGetter(p.sdf); if (blob) try { raw = molRawFromSDF(await blob.text()); } catch (e) { raw = null; } }
        if (!raw) raw = moleculeRaw(p.smiles);
        const st = buildStruct(raw, p.title); st.molName = p.title; return st;
      }
      if (o.type === 'sculpt') {
        const blob = mediaGetter && await mediaGetter(p.src); if (!blob) throw new Error('model file missing');
        if (p.fmt === 'obj') {                                // a Blender (or any) OBJ: the shape only
          const root = objToGroup(await blob.text(), p);
          const box = new THREE.Box3().setFromObject(root), center = box.getCenter(new THREE.Vector3()), radius = Math.max(0.05, box.getSize(new THREE.Vector3()).length() / 2);
          return { root, clips: [], center, radius };
        }
        await ensureGLTF();
        const buf = await blob.arrayBuffer();
        const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().parse(buf, '', res, rej));
        const root = gltf.scene, external = p.fmt === 'glb';
        const toS = v => external ? v : Math.pow(Math.max(0, v), 1 / 2.2);   // ClayForm writes linear colours; Blender's GLBs are already right
        root.traverse(m => {
          if (!m.isMesh) return;
          m.frustumCulled = false;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mt of mats) { if (!mt) continue; mt.side = THREE.DoubleSide; if (mt.color && !external) mt.color.setRGB(toS(mt.color.r), toS(mt.color.g), toS(mt.color.b)); }
          const ca = m.geometry && m.geometry.attributes.color;
          if (ca && !ca.userData && !external) { ca.userData = 1; for (let i = 0; i < ca.array.length; i++) ca.array[i] = toS(ca.array[i]); ca.needsUpdate = true; }
        });
        const box = new THREE.Box3().setFromObject(root), center = box.getCenter(new THREE.Vector3()), radius = Math.max(0.05, box.getSize(new THREE.Vector3()).length() / 2);
        return { root, clips: gltf.animations || [], center, radius };
      }
      if (o.type === 'paper') {
        if (p.src === 'placeholder') return placeholderPages(5);
        const blob = mediaGetter && await mediaGetter(p.src); if (!blob) throw new Error('paper file missing');
        if (blob.type === 'application/pdf' || p.kind === 'pdf') return (await renderPdfPages(await blob.arrayBuffer(), true)).canvases;
        const url = URL.createObjectURL(blob); try { return [await imageToCanvas(url)]; } finally { URL.revokeObjectURL(url); }
      }
    })().then(v => { d.status = 'ready'; d.value = v; if (onReady) onReady(); }, e => { console.warn(e); d.status = 'error'; d.error = e; if (onReady) onReady(); });
    return d;
  }
  function sigOf(o) {
    const p = o.props;
    switch (o.type) {
      case 'pdb': return [p.src, p.color, p.water].join('|');
      case 'sculpt': return [p.src].join('|');
      case 'molecule': return [p.sdf, p.smiles, p.color, p.style].join('|');
      case 'membrane': return [p.radius, col(p.head), col(p.tail)].join('|');
      case 'junction': return [col(p.head), col(p.tail), col(p.strand), col(p.solute)].join('|');
      case 'paper': return [p.src].join('|');
      case 'prim3d': return [p.shape, col(p.color), p.material].join('|');
      case 'bio3d': return [p.kind, col(p.color), col(p.accent)].join('|');
      case 'atom': return [p.element, p.style, p.charge, p.labels, p.labelName, col(p.color), col(p.electron), col(p.proton), col(p.neutron)].join('|');
      case 'transporter': return [p.kind, col(p.color), col(p.accent)].join('|');
    }
    return '';
  }
  function disposeGroup(g) { if (!g) return; if (g.parent) g.parent.remove(g); g.traverse(m => { if (m.geometry) m.geometry.dispose(); if (m.material) { if (m.material.map) m.material.map.dispose(); m.material.dispose(); } }); }
  function makeEntry(o) {
    const p = Object.assign({}, A.TYPES[o.type].defaults, o.props);
    switch (o.type) {
      case 'pdb': case 'molecule': { const d = loadData(dataKey(o), o); if (d.status !== 'ready') return d.status === 'error' ? { error: d.error } : null; return makeStructure(d.value, p, o.type === 'molecule'); }
      case 'paper': { const d = loadData(dataKey(o), o); if (d.status !== 'ready') return d.status === 'error' ? { error: d.error } : null; return makePaper(d.value, p); }
      case 'membrane': return makeMembrane(p);
      case 'junction': return makeJunction(p);
      case 'sculpt': {
        const d = loadData(dataKey(o), o); if (d.status !== 'ready') return d.status === 'error' ? { error: d.error } : null;
        const S = d.value, group = new THREE.Group(), inner = new THREE.Group();
        inner.add(S.root); inner.position.copy(S.center).negate(); group.add(inner);
        const mixer = S.clips.length ? new THREE.AnimationMixer(S.root) : null;
        if (mixer) for (const c of S.clips) mixer.clipAction(c).play();
        const dur = S.clips.length ? Math.max(...S.clips.map(c => c.duration)) : 0;
        let look = null;
        return { group, r3: S.radius, update(oo, t) {
          const want = oo.props.look || 'clay'; if (want !== look) { look = want; applyLook(S.root, look); }
          if (!mixer) return;
          const pp = oo.props; let lt = pp.play === false ? 0 : (t - oo.start) * (pp.speed == null ? 1 : +pp.speed);
          if (dur > 0) lt = pp.loop === false ? clamp(lt, 0, dur) : ((lt % dur) + dur) % dur;
          mixer.setTime(lt);
        } };
      }
      case 'prim3d': { const g = new THREE.Group(); const m = new THREE.Mesh((PRIMS[p.shape] || PRIMS.sphere)(), primMaterial(p)); g.add(m); return { group: g, r3: 1.2, mesh: m }; }
      case 'bio3d': { const B = BIO_KINDS[p.kind] || BIO_KINDS.rbc; const e = B.build(p); e.r3 = B.r3; return e; }
      case 'atom': return makeAtom(p);
      case 'transporter': { const B = TRANSPORTERS[p.kind] || TRANSPORTERS.glut1; const e = B.build(p); e.r3 = B.r3; return e; }
    }
    return null;
  }
  function entryFor(o) {
    const sig = sigOf(o);
    let r = ENT.get(o.id);
    if (r && r.sig === sig && (r.entry || r.error)) return r.entry;
    if (r && r.entry) { disposeGroup(r.entry.group); }
    const e = makeEntry(o);
    if (e && e.error) { ENT.set(o.id, { sig, entry: null, error: e.error }); return null; }
    if (!e) { ENT.set(o.id, { sig, entry: null }); return null; }
    ENT.set(o.id, { sig, entry: e });
    // remember the natural size so the hit box matches
    if (e.r3 && Math.abs((o.props.r3 || 0) - e.r3) > 0.01) { o.props.r3 = Math.round(e.r3 * 100) / 100; }
    world.add(e.group);
    return e;
  }
  function status(o) { const r = ENT.get(o.id); const d = dataKey(o) && DATA.get(dataKey(o)); if (r && r.error) return 'error'; if (d && d.status === 'error') return 'error'; if (r && r.entry) return 'ready'; return d ? d.status : 'ready'; }

  let gltfP = null;
  function ensureGLTF() {
    if (THREE.GLTFLoader) return Promise.resolve();
    return gltfP || (gltfP = loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js').catch(e => { gltfP = null; throw e; }));
  }
  /* ======================================================================
     Rendering (called from Animath's render, behind the 2D layer)
     ====================================================================== */
  let world = null, camera = null, scene3 = null;
  const renderers = new Map();
  function init() {
    scene3 = new THREE.Scene(); world = new THREE.Group(); scene3.add(world);
    camera = new THREE.PerspectiveCamera(35, 16 / 9, 1, 50000); scene3.add(camera);
    scene3.add(new THREE.HemisphereLight(0xffffff, 0x2a2e38, 0.75)); scene3.add(new THREE.AmbientLight(0xffffff, 0.14));
    const dl = new THREE.DirectionalLight(0xffffff, 0.8); dl.position.set(3, 4, 5); camera.add(dl);
  }
  function rendererFor(W, H) {
    const key = W + 'x' + H; let r = renderers.get(key);
    if (r) { renderers.delete(key); renderers.set(key, r); return r; }
    if (renderers.size >= 2) { const [k0, r0] = renderers.entries().next().value; r0.dispose(); r0.forceContextLoss && r0.forceContextLoss(); renderers.delete(k0); }
    r = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1); r.setSize(W, H, false); r.setClearColor(0x000000, 0);
    renderers.set(key, r); return r;
  }
  const CAMDEF = { orbit: 0, tilt: 0, dist: 1, fov: 35 };
  function cam3(scene) { return scene.cam3d || (scene.cam3d = { orbit: 0, tilt: 0, dist: 1, fov: 35, keys: {} }); }
  function camVal(scene, k, t) { const c = cam3(scene); const v = A.keyVal(c, k, t); return typeof v === 'number' && isFinite(v) ? v : CAMDEF[k]; }
  const REVEAL = { create: 1, write: 1, drawfill: 1, type: 1 };
  const _q = OK && new THREE.Quaternion();
  function draw(ctx, scene, t, W, H, list) {
    if (!OK || !list.length) return;
    if (!world) init();
    const fov = camVal(scene, 'fov', t), orbit = camVal(scene, 'orbit', t) * DEG, tilt = camVal(scene, 'tilt', t) * DEG;
    const D0 = 4 * U / Math.tan(fov * DEG / 2), dist = D0 * camVal(scene, 'dist', t);
    camera.fov = fov; camera.aspect = W / H;
    camera.position.set(dist * Math.cos(tilt) * Math.sin(orbit), dist * Math.sin(tilt), dist * Math.cos(tilt) * Math.cos(orbit));
    camera.lookAt(0, 0, 0); camera.near = Math.max(1, dist * 0.01); camera.far = dist * 20 + 5000; camera.updateProjectionMatrix();
    const live = new Set();
    let any = false;
    for (const it of list) {
      const o = it.o; live.add(o.id);
      let e = null;
      try { e = entryFor(o); } catch (err) { console.warn('3D object failed to build', o.type, err); ENT.set(o.id, { sig: sigOf(o), entry: null, error: err }); continue; }
      if (!e) continue;
      const g = e.group;
      if (it.op <= 0.002) { g.visible = false; continue; }
      g.visible = true; any = true;
      const P = it.P, sx = Math.hypot(P[0], P[1]), sy = Math.hypot(P[2], P[3]), rot = Math.atan2(P[1], P[0]);
      const p = o.props, fit = p.realScale ? 1 : (FITS[o.type] || FIT) / (p.r3 || e.r3 || 25);
      g.position.set(P[4] * U, P[5] * U, kv(o, 'z3', t) * U);
      g.rotation.set(kv(o, 'tilt3', t) * DEG, kv(o, 'spin', t) * DEG, rot, 'ZYX');
      g.scale.set(sx * fit, sy * fit, (sx + sy) / 2 * fit);
      const f = REVEAL[it.mode] ? clamp(it.p, 0, 1) : 1;
      if (e.reveal) e.reveal(f); else g.scale.multiplyScalar(Math.max(0.001, f));
      if (e.setOpacity) e.setOpacity(it.op); else setGroupOpacity(g, it.op);
      try { if (e.update) e.update(o, t, k => kv(o, k, t)); } catch (err) { console.warn('3D update failed', o.type, err); }
    }
    for (const [id, r] of ENT) if (!live.has(id)) { if (r.entry) r.entry.group.visible = false; }
    if (!any) return;
    lastWH = [W, H];
    const rd = rendererFor(W, H);
    sharedCam = (cam3(scene) || {}).mode === 'shared';
    if (sharedCam) rd.render(scene3, camera);
    else {
      // each object is drawn as if the camera were straight in front of it, so moving it around the frame doesn't skew or turn it
      const shown = []; for (const it of list) { const r = ENT.get(it.o.id); if (r && r.entry && r.entry.group.visible) shown.push(r.entry.group); }
      const auto = rd.autoClear; rd.autoClear = false; rd.clear();
      for (const g of shown) { for (const q of shown) q.visible = q === g; rd.clearDepth(); rd.render(scene3, headOnCam(g)); }
      for (const q of shown) q.visible = true; rd.autoClear = auto;
    }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.drawImage(rd.domElement, 0, 0, W, H); ctx.restore();
  }
  // ---------- a camera with the same lens, placed straight in front of one object and shifted so the object lands where the shared camera puts it ----------
  let sharedCam = false;
  const cam2 = OK && new THREE.PerspectiveCamera(), _fw = OK && new THREE.Vector3(), _hp = OK && new THREE.Vector3(), _hs = OK && new THREE.Vector3();
  function headOnCam(g) {
    if (sharedCam) return camera;
    g.updateMatrixWorld(true); _hp.setFromMatrixPosition(g.matrixWorld);
    camera.getWorldDirection(_fw);
    const depth = _hs.copy(_hp).sub(camera.position).dot(_fw);
    if (depth <= camera.near * 2) return camera;
    _hs.copy(_hp).project(camera);
    cam2.copy(camera, false); cam2.position.copy(_hp).addScaledVector(_fw, -depth); cam2.quaternion.copy(camera.quaternion);
    cam2.updateMatrixWorld(true); cam2.updateProjectionMatrix();
    const e = cam2.projectionMatrix.elements; e[8] -= _hs.x; e[9] -= _hs.y;
    cam2.projectionMatrixInverse.copy(cam2.projectionMatrix).invert();
    return cam2;
  }
  // ---------- anchors: where a 3D object or residue lands in the frame (frame units, y up) ----------
  let lastWH = [16, 9];
  const _av = OK && new THREE.Vector3();
  function projectFrame(v, W, H, cam) { _av.copy(v).project(cam || camera); if (_av.z > 1 || _av.z < -1) return null; return [_av.x * 4 * W / H, _av.y * 4]; }
  function anchor(scene, pin, W, H) {
    if (!camera || !pin || !pin.oid) return null;
    const r = ENT.get(pin.oid); if (!r || !r.entry || !r.entry.group.visible) return 'hidden';
    const e = r.entry; e.group.updateMatrixWorld(true);
    if (pin.res && e.st) {
      const ri = e.st.resIndex[pin.res]; if (ri == null) return null;
      const p = e.st.res[ri].pos, cam = headOnCam(e.group); _av.set(p[0], p[1], p[2]).applyMatrix4(e.group.matrixWorld);
      return projectFrame(_av, W, H, cam);
    }
    _av.setFromMatrixPosition(e.group.matrixWorld);
    return projectFrame(_av, W, H);
  }
  function pickResidue(scene, fx, fy) {
    if (!camera) return null;
    const [W, H] = lastWH; let best = null, bd = 0.35 * 0.35;
    const v = new THREE.Vector3();
    for (const [id, r] of ENT) {
      const e = r.entry; if (!e || !e.st || !e.group.visible) continue;
      e.group.updateMatrixWorld(true); const cam = headOnCam(e.group);
      e.st.res.forEach((res, ri) => {
        if (res.kind === 'water') return;
        v.set(res.pos[0], res.pos[1], res.pos[2]).applyMatrix4(e.group.matrixWorld).project(cam);
        if (v.z > 1 || v.z < -1) return;
        const x = v.x * 4 * W / H, y = v.y * 4, d = (x - fx) ** 2 + (y - fy) ** 2;
        if (d < bd) { bd = d; best = { oid: id, res: res.chain + '|' + res.resSeq, label: e.st.molName && res.kind === 'lig' ? e.st.molName : res.resName.charAt(0) + res.resName.slice(1).toLowerCase() + ' ' + res.resSeq }; }
      });
    }
    return best;
  }
  function forget(ids) { for (const [id, r] of ENT) if (!ids.has(id)) { if (r.entry) disposeGroup(r.entry.group); ENT.delete(id); } }

  /* ======================================================================
     2D anatomy & cell-biology diagrams (pure Animath vector primitives)
     ====================================================================== */
  const P2 = (pts, closed, stroke, sw, fill, fo) => ({ k: 'p', pts, closed: !!closed, stroke: stroke ? col(stroke) : null, sw: (sw == null ? 4 : sw) * 0.0075, fill: fill ? col(fill) : null, fo: fill ? (fo == null ? 1 : fo) : 0 });
  const circ = (cx, cy, r, n = 64, a0 = 0) => { const o = []; for (let i = 0; i < n; i++) { const a = a0 + i / n * Math.PI * 2; o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return o; };
  const ell = (cx, cy, rx, ry, rot = 0, n = 64) => { const o = [], c = Math.cos(rot), s = Math.sin(rot); for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, x = Math.cos(a) * rx, y = Math.sin(a) * ry; o.push([cx + x * c - y * s, cy + x * s + y * c]); } return o; };
  const blob = (cx, cy, r, amp, seed, n = 80) => { const rnd = seeded(seed); const ph = [rnd() * 6, rnd() * 6, rnd() * 6]; const o = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; const rr = r * (1 + amp * (Math.sin(3 * a + ph[0]) * 0.5 + Math.sin(5 * a + ph[1]) * 0.3 + Math.sin(2 * a + ph[2]) * 0.4)); o.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); } return o; };
  const arcPts = (cx, cy, r, a0, a1, n = 32) => { const o = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return o; };
  const curvePts = (pts, n = 12) => { const o = []; for (let i = 0; i < pts.length - 1; i++) { const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)]; for (let j = 0; j < n; j++) { const t = j / n, t2 = t * t, t3 = t2 * t; o.push([0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3), 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]); } } o.push(pts[pts.length - 1]); return o; };
  function labelPrims(text, x, y, size, c) {
    try {
      const b = A.build({ type: 'text', props: { text, size: size || 0.28, color: c || 'WHITE', font: 'sans', align: 'center' } });
      return b.prims.map(q => { const n = Object.assign({}, q); if (n.pts) n.pts = n.pts.map(([a, bb]) => [a + x, bb + y]); if (n.x != null) { n.x += x; n.y += y; } return n; }).filter(q => q.k === 'p' || q.k === 'g');
    } catch (e) { return []; }
  }
  const BIO2D = {
    nvu: { label: 'Neurovascular unit (cross-section)', build(p) {
      const c = col(p.color || 'WHITE'), L = p.labels, out = [];
      out.push(P2(blob(0, 0, 3.1, 0.07, 4), true, '#83C167', 3, '#83C167', 0.18));              // astrocyte end-feet sheath
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.3; out.push(P2(arcPts(0, 0, 2.75, a + 0.08, a + Math.PI / 3 - 0.08, 20), false, '#83C167', 7)); }
      out.push(P2(circ(0, 0, 2.45), true, '#BBBBBB', 2, null));                                 // basement membrane
      out.push(P2(arcPts(0, 0, 2.6, 3.6, 5.2, 30), false, '#9A72AC', 9));                       // pericyte
      out.push(P2(ell(0.15, -2.62, 0.45, 0.18, 0), true, '#9A72AC', 2, '#9A72AC', 0.9));
      out.push(P2(circ(0, 0, 2.3), true, '#F4A6C6', 3, '#F4A6C6', 0.25));                       // endothelium
      out.push(P2(circ(0, 0, 1.6), true, '#F4A6C6', 3, '#0B0B10', 1));                          // lumen
      for (const [a, nuc] of [[0.4, 1], [2.5, 1], [4.4, 1]]) { const x = Math.cos(a) * 1.95, y = Math.sin(a) * 1.95; out.push(P2(ell(x, y, 0.42, 0.2, a + Math.PI / 2), true, '#C55F73', 2, '#C55F73', 0.9)); }
      for (const a of [1.45, 3.45, 5.4]) { const x1 = Math.cos(a) * 1.62, y1 = Math.sin(a) * 1.62, x2 = Math.cos(a) * 2.28, y2 = Math.sin(a) * 2.28; out.push(P2([[x1, y1], [x2, y2]], false, '#FC6255', 7)); }
      out.push(P2(ell(-0.3, 0.2, 0.75, 0.32, 0.4), true, '#FC6255', 2, '#D2483C', 1));           // red blood cell
      if (L) {
        out.push(...labelPrims('Lumen', 0.35, -0.55, 0.26, c), ...labelPrims('Endothelial cell', 3.9, 1.8, 0.24, c), ...labelPrims('Tight junction', -3.9, -1.9, 0.24, '#FC6255'),
          ...labelPrims('Pericyte', -3.6, 2.4, 0.24, '#9A72AC'), ...labelPrims('Astrocyte end-foot', 3.8, -2.6, 0.24, '#83C167'), ...labelPrims('Basement membrane', 3.9, 0.4, 0.22, '#BBBBBB'));
        out.push(P2([[2.65, 1.65], [1.9, 1.05]], false, c, 1.5), P2([[-2.85, -1.75], [-1.3, -1.6]], false, '#FC6255', 1.5), P2([[-2.9, 2.25], [-1.6, 2.1]], false, '#9A72AC', 1.5), P2([[2.9, -2.4], [2.2, -1.75]], false, '#83C167', 1.5), P2([[2.75, 0.4], [2.45, 0.15]], false, '#BBBBBB', 1.5));
      }
      return out;
    } },
    cell2d: { label: 'Animal cell', build(p) {
      const out = [], rnd = seeded(21);
      out.push(P2(blob(0, 0, 3.2, 0.06, 2), true, col(p.color || '#83C167'), 4, col(p.color || '#83C167'), 0.12));
      out.push(P2(circ(-0.5, -0.2, 1.15), true, '#9A72AC', 3, '#9A72AC', 0.35), P2(circ(-0.3, -0.4, 0.35), true, '#9A72AC', 2, '#5B3C70', 0.9));
      for (let i = 0; i < 3; i++) out.push(P2(curvePts([[0.8, -1.3 + i * 0.3], [1.3, -1.1 + i * 0.3], [1.8, -1.4 + i * 0.3], [2.3, -1.1 + i * 0.3]]), false, '#58C4DD', 3));
      for (let i = 0; i < 5; i++) { const a = rnd() * 6.28, r = 1.7 + rnd() * 0.9; const x = Math.cos(a) * r, y = Math.sin(a) * r; out.push(P2(ell(x, y, 0.38, 0.18, a), true, '#F0AC5F', 2.5, '#F0AC5F', 0.5)); out.push(P2(curvePts([[x - 0.25, y], [x - 0.1, y + 0.1], [x, y - 0.1], [x + 0.12, y + 0.1], [x + 0.25, y]], 6), false, '#FC6255', 1.5)); }
      for (let i = 0; i < 8; i++) { const a = rnd() * 6.28, r = 1.5 + rnd() * 1.3; out.push(P2(circ(Math.cos(a) * r, Math.sin(a) * r, 0.1, 16), true, '#58C4DD', 1.5, '#58C4DD', 0.8)); }
      if (p.labels) out.push(...labelPrims('Nucleus', -0.5, 1.4, 0.24), ...labelPrims('Mitochondria', 2.6, 2.6, 0.22, '#F0AC5F'), ...labelPrims('Endoplasmic reticulum', 2.4, -2.0, 0.22, '#58C4DD'));
      return out;
    } },
    neuron2d: { label: 'Neuron', build(p) {
      const c = col(p.color || '#9A72AC'), out = [], rnd = seeded(31);
      out.push(P2(blob(-3, 0, 0.55, 0.15, 3), true, c, 3, c, 0.6));
      for (let i = 0; i < 6; i++) { const a = Math.PI * 0.35 + i / 5 * Math.PI * 1.3; const pts = [[-3 + Math.cos(a) * 0.5, Math.sin(a) * 0.5]]; let x = pts[0][0], y = pts[0][1]; for (let k = 0; k < 4; k++) { x += Math.cos(a + (rnd() - 0.5) * 0.8) * 0.45; y += Math.sin(a + (rnd() - 0.5) * 0.8) * 0.45; pts.push([x, y]); } out.push(P2(curvePts(pts, 8), false, c, 4)); const b2 = [pts[2], [pts[2][0] + Math.cos(a + 0.7) * 0.5, pts[2][1] + Math.sin(a + 0.7) * 0.5]]; out.push(P2(b2, false, c, 2.5)); }
      out.push(P2([[-2.45, 0], [3.0, 0]], false, c, 4));
      for (let x = -2.0; x < 2.6; x += 0.9) out.push(P2([[x, -0.16], [x + 0.7, -0.16], [x + 0.7, 0.16], [x, 0.16]], true, col(p.accent || '#F0E6D2'), 2, col(p.accent || '#F0E6D2'), 0.85));
      for (let i = 0; i < 4; i++) { const a = -0.7 + i * 0.45; const e = [3.0 + Math.cos(a) * 0.7, Math.sin(a) * 0.7]; out.push(P2([[3.0, 0], e], false, c, 3), P2(circ(e[0], e[1], 0.13, 16), true, c, 2, c, 1)); }
      if (p.labels) out.push(...labelPrims('Dendrites', -3.4, -1.9, 0.24, c), ...labelPrims('Soma', -3.0, 0.95, 0.24, c), ...labelPrims('Myelinated axon', 0.3, 0.6, 0.24), ...labelPrims('Terminals', 3.4, 1.15, 0.24, c));
      return out;
    } },
    mito2d: { label: 'Mitochondrion', build(p) {
      const c = col(p.color || '#F0AC5F'), out = [];
      const cap = (rx, ry) => { const o = []; for (let i = 0; i < 80; i++) { const a = i / 80 * Math.PI * 2; o.push([Math.cos(a) * rx, Math.sin(a) * ry]); } return o; };
      out.push(P2(cap(3, 1.35), true, c, 4, c, 0.2), P2(cap(2.75, 1.12), true, col(p.accent || '#FC6255'), 3));
      const z = []; for (let i = 0; i <= 12; i++) { const x = -2.4 + i * 0.4; z.push([x, i % 2 ? -1.05 : 1.05]); z.push([x + 0.2, i % 2 ? 0.25 : -0.25]); }
      out.push(P2(z.slice(0, -1), false, col(p.accent || '#FC6255'), 3));
      if (p.labels) out.push(...labelPrims('Outer membrane', 0, -1.75, 0.24, c), ...labelPrims('Cristae', 0, 1.7, 0.24, col(p.accent || '#FC6255')));
      return out;
    } },
    synapse2d: { label: 'Synapse', build(p) {
      const c = col(p.color || '#9A72AC'), out = [], rnd = seeded(41);
      out.push(P2(curvePts([[-2.2, -2.6], [-2.0, -0.6], [-1.2, 0.3], [0, 0.45], [1.2, 0.3], [2.0, -0.6], [2.2, -2.6]], 10), false, c, 4));
      out.push(P2(curvePts([[-2.2, 2.6], [-1.6, 1.2], [0, 1.0], [1.6, 1.2], [2.2, 2.6]], 10), false, col(p.accent || '#58C4DD'), 4));
      for (let i = 0; i < 9; i++) out.push(P2(circ(-1.3 + rnd() * 2.6, -1.8 + rnd() * 1.6, 0.2, 18), true, '#F7D96F', 2, '#F7D96F', 0.35));
      for (let i = 0; i < 6; i++) out.push(P2(circ(-0.9 + i * 0.36, 0.72, 0.05, 10), true, '#F7D96F', 1, '#F7D96F', 1));
      for (let i = 0; i < 5; i++) out.push(P2([[-0.8 + i * 0.4, 1.05], [-0.8 + i * 0.4, 1.25]], false, col(p.accent || '#58C4DD'), 4));
      if (p.labels) out.push(...labelPrims('Presynaptic terminal', 0, -2.9, 0.24, c), ...labelPrims('Synaptic cleft', 2.9, 0.75, 0.22), ...labelPrims('Postsynaptic cell', 0, 2.9, 0.24, col(p.accent || '#58C4DD')));
      return out;
    } },
    vessel2d: { label: 'Capillary (lengthwise)', build(p) {
      const c = col(p.color || '#F4A6C6'), out = [], rnd = seeded(51);
      out.push(P2([[-4, -1.2], [4, -1.2]], false, c, 6), P2([[-4, 1.2], [4, 1.2]], false, c, 6));
      for (let x = -3; x <= 3; x += 2) { out.push(P2([[x, -1.4], [x, -1.0]], false, '#FC6255', 6), P2([[x + 1, 1.0], [x + 1, 1.4]], false, '#FC6255', 6)); }
      for (let i = 0; i < 5; i++) out.push(P2(ell(-3.2 + i * 1.6, (rnd() - 0.5) * 0.6, 0.45, 0.2, (rnd() - 0.5) * 0.8), true, '#D2483C', 2, '#D2483C', 1));
      out.push(P2(curvePts([[-4, 1.7], [-2, 2.0], [0, 1.65], [2, 2.0], [4, 1.7]], 10), false, '#83C167', 7), P2(curvePts([[-4, -1.7], [-2, -2.0], [0, -1.65], [2, -2.0], [4, -1.7]], 10), false, '#83C167', 7));
      if (p.labels) out.push(...labelPrims('Blood flow →', 0, 0.75, 0.24), ...labelPrims('Tight junctions', 0, -2.55, 0.22, '#FC6255'), ...labelPrims('Astrocyte end-feet', 0, 2.55, 0.22, '#83C167'));
      return out;
    } },
    rbc2d: { label: 'Red blood cell', build(p) {
      const c = col(p.color || '#D2483C');
      const prof = []; for (let i = 0; i <= 40; i++) { const r = -1 + i / 20; const z = 0.5 * Math.sqrt(Math.max(0, 1 - r * r)) * (0.207 + 2.003 * r * r - 1.123 * r ** 4); prof.push([r * 1.6, -z * 1.6 - 0.0]); }
      const back = prof.slice().reverse().map(([x, y]) => [x, -y]);
      return [P2(circ(-2.2, 0, 1.6), true, c, 3, c, 0.85), P2(circ(-2.2, 0, 0.7), true, c, 2, '#FC6255', 0.6), P2(prof.concat(back).map(([x, y]) => [x + 2.0, y]), true, c, 3, c, 0.85)].concat(p.labels ? [...labelPrims('Top view', -2.2, 2.0, 0.24), ...labelPrims('Side view', 2.0, 2.0, 0.24)] : []);
    } },
    brain2d: { label: 'Brain (side view)', build(p) {
      const c = col(p.color || '#F4A6C6'), out = [];
      const outline = curvePts([[-3, 0.6], [-3.1, -0.6], [-2.4, -1.9], [-1, -2.6], [0.8, -2.6], [2.2, -2.1], [3.1, -1.0], [3.2, 0.3], [2.6, 1.1], [1.6, 1.35], [0.6, 1.15], [-0.4, 1.5], [-1.6, 1.6], [-2.6, 1.3], [-3, 0.6]], 8);
      out.push(P2(outline, true, c, 4, c, 0.25));
      out.push(P2(curvePts([[1.7, 1.35], [2.4, 1.6], [3.0, 1.95], [2.7, 2.35], [1.9, 2.2], [1.4, 1.7]], 8), true, c, 3, c, 0.35));     // cerebellum
      out.push(P2(curvePts([[0.9, 1.3], [1.1, 2.0], [1.0, 2.9]], 8), false, c, 5));                                                   // brainstem
      for (const s of [[[-2.2, -1.2], [-1.6, -0.4], [-1.9, 0.4]], [[-0.8, -2.2], [-0.4, -1.2], [-0.9, -0.3]], [[0.6, -2.3], [0.4, -1.3], [0.9, -0.5]], [[1.9, -1.7], [1.5, -0.9], [2.1, -0.1]], [[-1.3, 0.9], [-0.3, 0.6], [0.8, 0.9]]]) out.push(P2(curvePts(s, 8), false, c, 2.5));
      if (p.labels) out.push(...labelPrims('Cerebrum', -0.3, -3.0, 0.26, c), ...labelPrims('Cerebellum', 3.4, 2.9, 0.24, c), ...labelPrims('Brainstem', 0.2, 3.25, 0.24, c));
      return out;
    } }
  };
  A.TYPES.bio2d = { label: 'Diagram', icon: '❦', defaults: { kind: 'nvu', color: '', accent: '', labels: true },
    fields: [['kind', 'Diagram', 'select', Object.entries(BIO2D).map(([k, v]) => [k, v.label])], ['labels', 'Labels', 'bool'], ['color', 'Main colour', 'color'], ['accent', 'Accent colour', 'color']],
    build: p => (BIO2D[p.kind] || BIO2D.nvu).build(p) };

  /* ======================================================================
     Public API
     ====================================================================== */
  window.Bio3D = {
    ok: OK, U, FIT, K3, keyList, k3def, kv, BIO_KINDS, BIO2D, PRIMS, MOL_PRESETS, NAME_SMILES,
    is3D: type => !!(A.TYPES[type] && A.TYPES[type].is3D),
    draw, forget, status, camVal, cam3, anchor, pickResidue, TRANSPORTERS,
    setMediaGetter(fn) { mediaGetter = fn; }, onReady(fn) { onReady = fn; },
    parseSMILES, moleculeRaw, parseSDF, molRawFromSDF, parsePDB, parseCIF, buildStruct,
    fetchPubChem, fetchPDBText, searchRCSB, renderPdfPages, imageToCanvas,
    structInfo(o) { const d = DATA.get(dataKey(o)); return d && d.status === 'ready' ? d.value : null; },
    toast: null
  };
})();

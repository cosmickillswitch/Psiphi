/* Animath editor, laid out like a phone video editor: preview on top, a timeline that is always visible
   and scrolls under a fixed centre playhead, a toolbar along the bottom, and pop-up panels for editing. */
(function () {
  'use strict';
  const A = window.Animath;
  const $ = s => document.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) el.append(k);
    return el;
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const uid = () => Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6);
  const clone = o => JSON.parse(JSON.stringify(o, (k, v) => k[0] === '_' ? undefined : v));
  const round = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;
  const snap = v => Math.round(v * 20) / 20;
  const inFrame = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
  function toast(msg) { document.querySelectorAll('.toast').forEach(t => t.remove()); const t = h('div', { class: 'toast', role: 'status' }, msg); document.body.append(t); setTimeout(() => t.remove(), 2400); }
  function ask(msg, ok = 'OK') {
    return new Promise(res => {
      const d = h('dialog', { class: 'ask' });
      d.append(h('div', { class: 'dlg' }, h('p', {}, msg), h('div', { class: 'row end' },
        h('button', { type: 'button', class: 'btn quiet', onclick: () => { d.close(); res(false); } }, 'Cancel'),
        h('button', { type: 'button', class: 'btn danger', onclick: () => { d.close(); res(true); } }, ok))));
      d.addEventListener('close', () => setTimeout(() => d.remove(), 50));
      document.body.append(d); d.showModal();
    });
  }

  const ASPECTS = [['16:9', 'Landscape 16:9'], ['9:16', 'Portrait 9:16'], ['1:1', 'Square 1:1'], ['4:5', 'Portrait 4:5'], ['4:3', 'Classic 4:3'], ['21:9', 'Cinema 21:9']];
  const BGS = [['#000000', 'Black (Manim)'], ['#1E1E24', 'Charcoal'], ['#0E1A2B', 'Navy'], ['#FBF8F1', 'Paper'], ['#FFFFFF', 'White']];
  const SWATCH = ['WHITE', 'GREY', 'BLUE', 'TEAL', 'GREEN', 'YELLOW', 'GOLD', 'ORANGE', 'RED', 'MAROON', 'PURPLE', 'PINK', 'INK'];
  const ratio = a => { const [w, hh] = a.split(':').map(Number); return w / hh; };
  const isLight = bg => { const c = String(A.color(bg)).replace('#', ''); const n = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16); return ((n >> 16 & 255) * 0.3 + (n >> 8 & 255) * 0.59 + (n & 255) * 0.11) > 150; };
  const fmtT = t => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); };
  const MT = A.MAT;
  const MORPH = k => k === 'transform' || k === 'transformMatch';
  const objById = id => (scene && id && scene.objects.find(o => o.id === id)) || null;
  function descendants(o) { const out = []; const walk = p => scene.objects.forEach(c => { if (c.parent === p.id && c !== o && !out.includes(c)) { out.push(c); walk(c); } }); walk(o); return out; }
  function ancestors(o) { const out = []; let p = o, n = 0; while (p && p.parent && n++ < 30) { p = objById(p.parent); if (p) out.unshift(p); } return out; }

  // ---------- state ----------
  let scene = null, projId = null, sel = null, time = 0, playing = false, t0 = 0, guides = false, pps = 56;
  let hist = [], hi = -1, saveT = null, dirty = true, sheetKind = null;
  const stage = $('#stage'), sctx = stage.getContext('2d');

  function newScene(name) { return { v: 2, name: name || 'Untitled', aspect: '16:9', bg: '#000000', duration: 10, objects: [], vars: [], markers: [] }; }
  function makeObj(type, over = {}) {
    const T = A.TYPES[type];
    const n = scene.objects.filter(o => o.type === type).length + 1;
    const props = clone(T.defaults);
    if (isLight(scene.bg)) for (const k of ['color', 'axis']) if (props[k] === 'WHITE') props[k] = 'INK';
    const textish = ['text', 'math', 'title', 'truth', 'textpath'].includes(type);
    const o = {
      id: uid(), type, name: T.label + ' ' + n, start: round(time, 2), end: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1,
      props, anIn: { type: textish ? 'write' : type === 'sticker' ? 'grow' : type === 'group' ? 'fadein' : (type === 'image' || type === 'sprite') ? 'fadein' : 'create', dur: type === 'graph' ? 2 : type === 'group' ? 0.5 : 1, rate: 'smooth' },
      anOut: { type: 'fadeout', dur: 0.6, rate: 'smooth' }, emph: [], keys: {}, loop: type === 'sticker' ? 'bob' : 'none'
    };
    o.end = round(o.start + 4, 2);
    Object.assign(o, over);
    if (over.props) o.props = Object.assign(props, over.props);
    const B = window.Bio3D;
    if (B && B.is3D(type)) {
      for (const [k] of B.keyList(type)) if (o[k] == null) o[k] = B.k3def(type, k);
      if (!over.anIn) o.anIn = { type: type === 'paper' ? 'fadein' : 'create', dur: 1.5, rate: 'smooth' };
      if (!over.end) o.end = round(o.start + 6, 2);
    }
    if (type === 'bio2d' && !over.anIn) o.anIn = { type: 'create', dur: 2, rate: 'smooth' };
    return o;
  }

  // ---------- persistence and undo ----------
  const index = () => store.get('bstudio.index', []);
  function saveNow() {
    if (!scene || !projId) return;
    store.set('bstudio.p.' + projId, clone(scene));
    const ix = index().filter(p => p.id !== projId);
    ix.unshift({ id: projId, name: scene.name, updated: Date.now() });
    store.set('bstudio.index', ix);
  }
  function commit() {
    const s = JSON.stringify(clone(scene));
    if (hist[hi] === s) return;
    hist = hist.slice(0, hi + 1); hist.push(s); if (hist.length > 80) hist.shift(); hi = hist.length - 1;
    clearTimeout(saveT); saveT = setTimeout(saveNow, 300);
    updUndo();
  }
  let commitT = null;
  const commitSoon = () => { clearTimeout(commitT); commitT = setTimeout(commit, 400); };
  function undo(d) {
    const j = hi + d;
    if (j < 0 || j >= hist.length) return;
    hi = j; scene = JSON.parse(hist[hi]);
    if (sel && !scene.objects.some(o => o.id === sel)) sel = null;
    clearTimeout(saveT); saveT = setTimeout(saveNow, 300);
    refreshAll(); updUndo();
  }
  function updUndo() { $('#undo').disabled = hi <= 0; $('#redo').disabled = hi >= hist.length - 1; }
  function openProject(id) {
    const s = store.get('bstudio.p.' + id, null);
    if (!s) return false;
    projId = id; scene = s; sel = null; time = 0; playing = false;
    if (!scene.vars) scene.vars = [];
    if (!scene.markers) scene.markers = [];
    store.set('bstudio.current', id);
    loadMedia();
    hist = [JSON.stringify(clone(scene))]; hi = 0; updUndo();
    closeSheet(); refreshAll(); fillProjects();
    return true;
  }
  function createProject(s) { projId = uid(); scene = s; saveNow(); if (!openProject(projId)) { hist = [JSON.stringify(clone(scene))]; hi = 0; refreshAll(); fillProjects(); } }
  function fillProjects() {
    const p = $('#proj'); p.textContent = '';
    const ix = index();
    if (!ix.some(x => x.id === projId)) ix.unshift({ id: projId, name: scene.name });
    for (const it of ix) p.append(h('option', { value: it.id }, it.name));
    p.value = projId;
  }

  // ---------- media: images and sound live in IndexedDB, referenced by id from the scene ----------
  const idb = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      try { const r = indexedDB.open('bstudio-media', 1); r.onupgradeneeded = () => r.result.createObjectStore('m'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); }
    }));
    return {
      async put(id, blob) { try { const db = await open(); await new Promise((res, rej) => { const tx = db.transaction('m', 'readwrite'); tx.objectStore('m').put(blob, id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); return true; } catch (e) { return false; } },
      async get(id) { try { const db = await open(); return await new Promise((res, rej) => { const r = db.transaction('m').objectStore('m').get(id); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); }); } catch (e) { return null; } }
    };
  })();
  const memMedia = new Map();
  async function putMedia(id, blob) { memMedia.set(id, blob); return idb.put(id, blob); }
  async function getMedia(id) { return memMedia.get(id) || await idb.get(id); }
  const sound = { id: null, el: null, buf: null, peaks: null, dur: 0, url: null };
  function mediaIds(sc) {
    const ids = new Set(sc.objects.filter(o => o.type === 'image' && o.props.src).map(o => o.props.src)); if (sc.audio && sc.audio.id) ids.add(sc.audio.id);
    for (const o of sc.objects) if (o.type === 'sprite') for (const id of spriteSrcs(o)) ids.add(id);
    for (const o of sc.objects) { if (o.type === 'sculpt' && o.props.src) ids.add(o.props.src); if ((o.type === 'pdb' || o.type === 'paper') && o.props.src && !['demo', 'placeholder'].includes(o.props.src)) ids.add(o.props.src); if (o.type === 'molecule' && o.props.sdf) ids.add(o.props.sdf); }
    return ids;
  }
  const spriteSrcs = o => (o.props.srcs && o.props.srcs.length ? o.props.srcs : o.props.src ? [o.props.src] : []);
  async function loadMedia() {
    const want = [];
    for (const o of scene.objects) { if (o.type === 'image' && o.props.src) want.push(o.props.src); if (o.type === 'sprite') want.push(...spriteSrcs(o)); }
    for (const id of want) if (!A.IMAGES.has(id)) {
      A.IMAGES.set(id, { ok: false });
      getMedia(id).then(b => { if (b) A.setImage(id, URL.createObjectURL(b)).then(() => { A.fontsChanged(); dirty = true; }); else A.IMAGES.delete(id); });
    }
    const au = scene.audio;
    if (!au || !au.id) { if (sound.el) sound.el.pause(); Object.assign(sound, { id: null, el: null, buf: null, peaks: null, dur: 0 }); renderTimelineSoon(); return; }
    if (sound.id === au.id) return;
    sound.id = au.id;
    const b = await getMedia(au.id);
    if (!b || sound.id !== au.id) { if (!b) toast('The sound for this project isn’t on this device.'); return; }
    if (sound.url) URL.revokeObjectURL(sound.url);
    sound.url = URL.createObjectURL(b);
    sound.el = new Audio(sound.url); sound.el.preload = 'auto';
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ac = new AC();
      const ab = await b.arrayBuffer();
      sound.buf = await new Promise((res, rej) => ac.decodeAudioData(ab, res, rej));
      sound.dur = sound.buf.duration;
      const ch = sound.buf.getChannelData(0), N = Math.min(4000, Math.ceil(sound.dur * 40)), step = Math.floor(ch.length / N) || 1;
      sound.peaks = new Float32Array(N);
      for (let i = 0; i < N; i++) { let m = 0; for (let j = i * step, e = Math.min(ch.length, j + step); j < e; j += 4) { const v = Math.abs(ch[j]); if (v > m) m = v; } sound.peaks[i] = m; }
      ac.close && ac.close();
    } catch (e) { sound.buf = null; sound.peaks = null; sound.el.addEventListener('loadedmetadata', () => { sound.dur = sound.el.duration || 0; renderTimelineSoon(); }); }
    renderTimelineSoon();
  }
  // keep the sound in step with playback
  function syncSound() {
    const el = sound.el, au = scene.audio;
    if (!el || !au) return;
    el.volume = Math.max(0, Math.min(1, au.vol == null ? 1 : au.vol));
    const at = time - (au.offset || 0), dur = sound.dur || el.duration || 0;
    if (!playing || at < 0 || (dur && at >= dur)) { if (!el.paused) el.pause(); return; }
    if (el.paused) { try { el.currentTime = at; } catch (e) {} const p = el.play(); if (p && p.catch) p.catch(() => {}); }
    else if (Math.abs(el.currentTime - at) > 0.2) { try { el.currentTime = at; } catch (e) {} }
  }
  function blobToDataURL(b) { return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(b); }); }
  async function dataURLToBlob(u) { const r = await fetch(u); return r.blob(); }
  function pickFile(accept) {
    return new Promise(res => {
      // iPadOS greys out file types it doesn't know (.obj, .pdb, .cif …), so for those the picker shows every file and the importer checks the contents
      const loose = /\.(obj|pdb|ent|cif|mmcif|glb|gltf|stl|csv|tsv)\b/i.test(accept || '');
      const i = h('input', loose ? { type: 'file', style: 'position:fixed;left:-9999px' } : { type: 'file', accept, style: 'position:fixed;left:-9999px' });
      i.addEventListener('change', () => { res(i.files[0] || null); i.remove(); });
      document.body.append(i); i.click();
    });
  }
  async function importImage(file) {
    const f = file instanceof Blob ? file : await pickFile('image/*'); if (!f) return;
    try {
      const url = URL.createObjectURL(f);
      const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('that file isn’t an image this browser can read')); im.src = url; });
      let blob = f, w = img.naturalWidth, hh = img.naturalHeight;
      const MAX = 2048;
      if (Math.max(w, hh) > MAX) {
        const k = MAX / Math.max(w, hh), c = h('canvas'); c.width = Math.round(w * k); c.height = Math.round(hh * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        blob = await new Promise(res => c.toBlob(res, /png|gif|webp/.test(f.type) ? 'image/png' : 'image/jpeg', 0.9));
      }
      URL.revokeObjectURL(url);
      const id = 'img_' + uid();
      const saved = await putMedia(id, blob);
      await A.setImage(id, URL.createObjectURL(blob));
      const ar = hh / w, fit = Math.min(6, 5 / ar);
      addObj('image', { name: f.name.replace(/\.[^.]+$/, '').slice(0, 24) || 'Image', props: { src: id, ar: round(ar, 4), w: round(fit, 2) } });
      if (!saved) toast('Added. This browser won’t store images, so it lasts until you close the app.');
    } catch (e) { toast('Couldn’t add the image: ' + e.message); }
  }
  async function importSound(file, at) {
    const f = file instanceof Blob ? file : await pickFile('audio/*'); if (!f) return;
    const id = 'snd_' + uid();
    const saved = await putMedia(id, f);
    scene.audio = { id, name: (f.name || 'Sound').replace(/\.[^.]+$/, '').slice(0, 30) || 'Sound', offset: at > 0 ? round(at, 2) : 0, vol: 1 };
    commit();
    await loadMedia();
    if (sound.dur > scene.duration) { scene.duration = Math.ceil(sound.dur); commit(); }
    renderTimeline(); openSheet('audio');
    toast(saved ? 'Sound added. Tap ◆ Marker while it plays to mark the beats.' : 'Sound added for this session only (this browser won’t store it).');
  }

  function pickFiles(accept) {
    return new Promise(res => {
      const loose = /\.(obj|pdb|ent|cif|mmcif|glb|gltf|stl|csv|tsv|docx|sdf|mol|md)\b/i.test(accept || '');
      const i = h('input', loose ? { type: 'file', multiple: true, style: 'position:fixed;left:-9999px' } : { type: 'file', multiple: true, accept, style: 'position:fixed;left:-9999px' });
      i.addEventListener('change', () => { res([...i.files]); i.remove(); });
      document.body.append(i); i.click();
    });
  }
  const extOf = f => ((f && f.name || '').match(/\.([^.]+)$/) || [])[1] ? f.name.match(/\.([^.]+)$/)[1].toLowerCase() : '';
  const baseName = (f, n) => ((f && f.name) || 'File').replace(/\.[^.]+$/, '').slice(0, n || 24);

  // ---------- 3D models from Blender and elsewhere: OBJ (shape) or GLB (materials, rig and animation) ----------
  async function importModel(file) {
    const f = file instanceof Blob ? file : await pickFile('.obj,.glb,.gltf'); if (!f) return;
    const ext = extOf(f);
    if (ext === 'blend') { toast('Psi Phi Studio can’t open .blend files. In Blender use File → Export → glTF 2.0 (choose “glTF Binary .glb”) or Wavefront (.obj).', 7000); return; }
    if (ext === 'gltf') { toast('That’s a .gltf, which keeps its parts in separate files. In Blender export “glTF Binary (.glb)” instead.', 6000); return; }
    if (ext === 'fbx' || ext === 'stl' || ext === 'dae' || ext === 'usdz') { toast('That format isn’t supported yet. Export it from Blender as .glb or .obj.', 6000); return; }
    const head = new Uint8Array(await f.slice(0, 4).arrayBuffer());
    let fmt = (head[0] === 0x67 && head[1] === 0x6C && head[2] === 0x54 && head[3] === 0x46) ? 'glb' : null;
    if (!fmt) {
      const text = await f.text();
      if (/^\s*v\s+[-\d.]/m.test(text) && /^\s*f\s+\d/m.test(text)) fmt = 'obj';
      else { toast('That doesn’t look like an OBJ or GLB file.'); return; }
    }
    if (f.size > 60e6) toast('That’s a big model (' + Math.round(f.size / 1e6) + ' MB). It may be slow on an iPad; Decimate it in Blender if so.', 5000);
    const mid = 'mdl_' + uid(); await putMedia(mid, f);
    const nm = baseName(f);
    addObj('sculpt', { name: nm, props: { src: mid, fmt, title: nm, look: 'original', cfId: '' } });
    toast(fmt === 'glb' ? 'Model added with its materials' + ' (and animation, if it has one).' : 'Model added. OBJ files carry the shape only; set its look in the panel.');
  }
  async function openMoleculeFile(file) {
    const f = file instanceof Blob ? file : await pickFile('.sdf,.mol,.txt'); if (!f) return;
    const text = await f.text();
    try { const raw = B3.molRawFromSDF(text); if (!raw || !raw.atoms || !raw.atoms.length) throw new Error('no atoms'); }
    catch (e) { toast('That doesn’t look like an SDF or MOL file.'); return; }
    const mid = 'sdf_' + uid(); await putMedia(mid, new Blob([text], { type: 'chemical/x-mdl-sdfile' }));
    const nm = baseName(f); addObj('molecule', { name: nm, props: { sdf: mid, smiles: 'C', title: nm } });
  }

  // ---------- atoms: pick an element from a little periodic table ----------
  function elementDlg() {
    const E = window.Elements;
    return new Promise(res => {
      const d = h('dialog', { class: 'ask elemdlg' });
      let style = 'bohr';
      const styles = h('div', { class: 'seg' }, [['bohr', 'Bohr'], ['orbits', '3D orbits'], ['cloud', 'Cloud'], ['cg', 'CG sphere']].map(([k, l]) => {
        const b = h('button', { type: 'button', class: 'segbtn' + (k === style ? ' on' : ''), onclick: () => { style = k; styles.querySelectorAll('.segbtn').forEach(x => x.classList.toggle('on', x === b)); } }, l); return b; }));
      const grid = h('div', { class: 'egrid' });
      for (const e of E.list) {
        const ry = e.row <= 7 ? e.row : e.row + 0.5;
        grid.append(h('button', { type: 'button', class: 'ecell', title: e.name, style: 'grid-column:' + e.col + ';grid-row:' + Math.round(ry * 2) + '/span 2;--c:' + E.CATS[e.cat].color, onclick: () => { d.close(); res({ element: e.sym, style, name: e.name }); } },
          h('small', {}, e.z), h('b', {}, e.sym)));
      }
      d.append(h('div', { class: 'dlg' }, h('h2', {}, 'Add an atom'), h('p', { class: 'muted small' }, 'Pick a style, then an element. You can change both, and make it an ion, in the panel afterwards.'), styles, grid,
        h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn quiet', onclick: () => { d.close(); res(null); } }, 'Cancel'))));
      d.addEventListener('close', () => setTimeout(() => d.remove(), 50));
      document.body.append(d); d.showModal();
    });
  }
  async function addAtom() {
    if (!window.Elements) { toast('The element data didn’t load.'); return; }
    const r = await elementDlg(); if (!r) return;
    addObj('atom', { name: r.name, props: { element: r.element, style: r.style } });
  }

  // ---------- papers: PDFs, images and documents (Word .docx, text, Markdown) become a stack of pages ----------
  async function addPapers(files) {
    let fs = Array.isArray(files) ? files : files instanceof Blob ? [files] : await pickFiles('.pdf,application/pdf,image/*,.docx,.txt,.md');
    if (!fs || !fs.length) return;
    const isPdf = f => /pdf/i.test(f.type) || extOf(f) === 'pdf';
    const isImg = f => /^image\//.test(f.type) || /^(png|jpe?g|gif|webp|heic|heif|bmp)$/.test(extOf(f));
    const isDoc = f => /^(docx|txt|md|markdown|text)$/.test(extOf(f)) || f.type === 'text/plain';
    const bad = fs.find(f => !isPdf(f) && !isImg(f) && !isDoc(f));
    if (bad) { const e = extOf(bad); toast((e === 'pages' || e === 'doc' || e === 'key' || e === 'pptx') ? 'Psi Phi Studio can’t read .' + e + ' files. Export it as a PDF (or a Word .docx) first.' : 'Can’t use “' + bad.name + '”. PDFs, images, Word (.docx), text and Markdown work.', 6000); return; }
    // a single PDF or image: keep it as it is
    if (fs.length === 1 && (isPdf(fs[0]) || isImg(fs[0]))) {
      const f = fs[0], pdf = isPdf(f), mid = (pdf ? 'pdf_' : 'img_') + uid(); await putMedia(mid, f);
      addObj('paper', { name: baseName(f), props: { src: mid, kind: pdf ? 'pdf' : 'image', title: baseName(f), layout: pdf ? 'fan' : 'row' } });
      if (pdf) toast('Reading the PDF… the first 12 pages become sheets.');
      return;
    }
    // several PDFs: one stack each
    if (fs.some(isPdf)) { for (const f of fs) await addPapers([f]); return; }
    // documents and images: laid out as pages in a new PDF
    toast('Making a PDF from ' + (fs.length === 1 ? '“' + fs[0].name + '”' : fs.length + ' files') + '…');
    try {
      const pages = [];
      for (const f of fs) {
        if (isImg(f)) pages.push(await imagePage(f));
        else { const blocks = extOf(f) === 'docx' ? await docxBlocks(await f.arrayBuffer()) : textBlocks(await f.text(), /^(md|markdown)$/.test(extOf(f))); pages.push(...layoutPages(blocks)); }
        if (pages.length >= 40) break;
      }
      if (!pages.length) throw new Error('nothing to show');
      const pdf = await pagesToPDF(pages), mid = 'pdf_' + uid(); await putMedia(mid, pdf);
      const nm = baseName(fs[0]);
      addObj('paper', { name: nm, props: { src: mid, kind: 'pdf', title: nm, layout: 'fan' } });
      toast('Made a ' + pages.length + '-page PDF.' + (pages.length > 12 ? ' The first 12 pages become sheets.' : ''));
    } catch (e) { toast('Couldn’t make a PDF: ' + e.message); }
  }
  async function imagePage(f) {
    const url = URL.createObjectURL(f);
    try {
      const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('couldn’t read ' + f.name)); im.src = url; });
      const k = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); return c;
    } finally { URL.revokeObjectURL(url); }
  }
  // .docx is a zip; read word/document.xml with the browser's own inflater
  async function unzipEntry(buf, want) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let e = buf.byteLength - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('that .docx isn’t a valid file');
    let p = dv.getUint32(e + 16, true); const n = dv.getUint16(e + 10, true), dec = new TextDecoder();
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
      if (name === want) {
        const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true), data = u8.slice(start, start + csize);
        if (method === 0) return dec.decode(data);
        if (typeof DecompressionStream === 'undefined') throw new Error('this browser can’t unpack Word files; save it as a PDF instead');
        const out = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
        return dec.decode(out);
      }
      p += 46 + nl + xl + cl;
    }
    throw new Error('no document text inside');
  }
  async function docxBlocks(buf) {
    const xml = new DOMParser().parseFromString(await unzipEntry(buf, 'word/document.xml'), 'application/xml');
    const kids = (el, ln) => [...el.children].filter(c => c.localName === ln), kid = (el, ln) => el && kids(el, ln)[0];
    const attr = (el, a) => el && (el.getAttribute('w:' + a) || el.getAttribute(a));
    const runsOf = pEl => {
      const out = [];
      const walk = el => { for (const c of el.children) {
        if (c.localName === 'r') {
          const rp = kid(c, 'rPr'), b = !!kid(rp, 'b') && attr(kid(rp, 'b'), 'val') !== '0', it = !!kid(rp, 'i') && attr(kid(rp, 'i'), 'val') !== '0';
          for (const t of c.children) { if (t.localName === 't') out.push({ t: t.textContent, b, i: it }); else if (t.localName === 'tab') out.push({ t: '    ', b, i: it }); else if (t.localName === 'br' || t.localName === 'cr') out.push({ t: '\n', b, i: it }); }
        } else if (c.localName === 'hyperlink' || c.localName === 'ins' || c.localName === 'smartTag' || c.localName === 'sdtContent' || c.localName === 'sdt') walk(c);
      } };
      walk(pEl); return out;
    };
    const blocks = [], body = xml.getElementsByTagNameNS('*', 'body')[0] || xml.documentElement;
    const para = pEl => {
      const pp = kid(pEl, 'pPr'), sty = String(attr(kid(pp, 'pStyle'), 'val') || ''), list = !!kid(pp, 'numPr') || /^List(Bullet|Number|Paragraph)/i.test(sty);
      const hm = sty.match(/^(?:Heading|heading)\s?(\d)/), kind = /^Title$/i.test(sty) ? 'title' : hm ? 'h' + Math.min(3, +hm[1]) : list ? 'li' : 'p';
      const runs = runsOf(pEl);
      if (kind === 'p' && !runs.some(r => r.t.trim())) { blocks.push({ kind: 'gap' }); return; }
      blocks.push({ kind, runs, center: attr(kid(pp, 'jc'), 'val') === 'center' });
    };
    const walk = el => { for (const c of el.children) {
      if (c.localName === 'p') para(c);
      else if (c.localName === 'tbl') for (const tr of kids(c, 'tr')) { const cells = kids(tr, 'tc').map(tc => kids(tc, 'p').map(pp => runsOf(pp).map(r => r.t).join('')).join(' ').trim()); blocks.push({ kind: 'row', cells }); }
      else if (c.localName === 'sdt' || c.localName === 'sdtContent') walk(c);
    } };
    walk(body);
    return blocks;
  }
  function textBlocks(text, md) {
    const blocks = [];
    for (const line of text.replace(/\r/g, '').split('\n')) {
      if (!line.trim()) { blocks.push({ kind: 'gap' }); continue; }
      if (md) {
        const hm = line.match(/^(#{1,3})\s+(.*)$/); if (hm) { blocks.push({ kind: 'h' + hm[1].length, runs: [{ t: hm[2] }] }); continue; }
        const li = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
        const runs = []; (li ? li[1] : line).split(/(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/).forEach(seg => { if (!seg) return; if (/^\*\*.*\*\*$/.test(seg)) runs.push({ t: seg.slice(2, -2), b: true }); else if (/^(\*|_).*(\*|_)$/.test(seg)) runs.push({ t: seg.slice(1, -1), i: true }); else runs.push({ t: seg }); });
        blocks.push({ kind: li ? 'li' : 'p', runs }); continue;
      }
      blocks.push({ kind: 'p', runs: [{ t: line }] });
    }
    return blocks;
  }
  // A4 pages at 150 dpi, in Latin Modern
  function layoutPages(blocks) {
    const W = 1240, H = 1754, M = 130, pages = [];
    let c, x, y;
    const newPage = () => { c = document.createElement('canvas'); c.width = W; c.height = H; x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.fillStyle = '#16181d'; x.textBaseline = 'alphabetic'; y = M; pages.push(c); };
    const SZ = { title: 52, h1: 42, h2: 34, h3: 29, p: 25, li: 25, row: 22 };
    const fontFor = (k, b, i) => (i ? 'italic ' : '') + ((b || /^h|title/.test(k)) ? '700 ' : '400 ') + SZ[k] + 'px LM, "Latin Modern Roman", Georgia, serif';
    newPage();
    for (const bl of blocks) {
      if (pages.length > 40) break;
      if (bl.kind === 'gap') { y += 14; continue; }
      if (bl.kind === 'row') {
        const n = Math.max(1, bl.cells.length), cw = (W - 2 * M) / n, lh = SZ.row * 1.4;
        x.font = fontFor('row'); const lines = bl.cells.map(t => wrapPlain(x, t, cw - 16)), rows = Math.max(1, ...lines.map(l => l.length));
        if (y + rows * lh + 12 > H - M) newPage();
        x.strokeStyle = '#c7cad1'; x.lineWidth = 1.5; x.strokeRect(M, y, W - 2 * M, rows * lh + 12);
        lines.forEach((ls, i) => { if (i) { x.beginPath(); x.moveTo(M + i * cw, y); x.lineTo(M + i * cw, y + rows * lh + 12); x.stroke(); } ls.forEach((t, j) => x.fillText(t, M + i * cw + 8, y + (j + 1) * lh)); });
        y += rows * lh + 12; continue;
      }
      const k = bl.kind, sz = SZ[k], lh = sz * 1.38, indent = k === 'li' ? 34 : 0, maxW = W - 2 * M - indent;
      if (/^h|title/.test(k)) y += sz * 0.6;
      // words with their own bold/italic
      const words = []; for (const r of bl.runs || []) for (const part of String(r.t).split(/(\n|\s+)/)) { if (part === '') continue; words.push({ t: part, b: r.b, i: r.i }); }
      let line = [], lw = 0;
      const flush = last => {
        if (y + lh > H - M) newPage();
        y += lh; let xx = M + indent;
        const total = line.reduce((a, w) => a + w.w, 0); if (bl.center || k === 'title') xx = (W - total) / 2;
        if (k === 'li' && !flush.done) { x.font = fontFor('p'); x.fillText('•', M + 6, y); flush.done = true; }
        for (const w of line) { x.font = fontFor(k, w.b, w.i); x.fillText(w.t, xx, y); xx += w.w; }
        line = []; lw = 0;
      };
      flush.done = false;
      for (const w of words) {
        if (w.t === '\n') { flush(); continue; }
        x.font = fontFor(k, w.b, w.i); const ww = x.measureText(w.t).width;
        if (/^\s+$/.test(w.t)) { if (line.length) { line.push({ t: ' ', w: ww, b: w.b, i: w.i }); lw += ww; } continue; }
        if (lw + ww > maxW && line.length) { while (line.length && line[line.length - 1].t === ' ') { lw -= line.pop().w; } flush(); }
        line.push({ t: w.t, w: ww, b: w.b, i: w.i }); lw += ww;
      }
      if (line.length) flush();
      y += k === 'li' ? 4 : sz * 0.45;
    }
    return pages;
  }
  function wrapPlain(x, text, maxW) { const out = []; let cur = ''; for (const w of String(text).split(/\s+/)) { const t = cur ? cur + ' ' + w : w; if (x.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; } if (cur) out.push(cur); return out.length ? out : ['']; }
  // a small PDF writer: one JPEG per page
  async function pagesToPDF(canvases) {
    const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
    const put = d => { const b = typeof d === 'string' ? enc.encode(d) : d; parts.push(b); len += b.length; };
    const obj = (n, body) => { offs[n] = len; put(n + ' 0 obj\n'); for (const b of [].concat(body)) put(b); put('\nendobj\n'); };
    put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const n = canvases.length, kids = [];
    for (let i = 0; i < n; i++) kids.push((3 + i * 3) + ' 0 R');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>');
    for (let i = 0; i < n; i++) {
      const c = canvases[i], pw = 595.28, ph = +(pw * c.height / c.width).toFixed(2);
      const jpg = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88))).arrayBuffer());
      const content = 'q ' + pw + ' 0 0 ' + ph + ' 0 0 cm /Im0 Do Q';
      const P = 3 + i * 3;
      obj(P, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw + ' ' + ph + '] /Resources << /XObject << /Im0 ' + (P + 2) + ' 0 R >> >> /Contents ' + (P + 1) + ' 0 R >>');
      obj(P + 1, ['<< /Length ' + content.length + ' >>\nstream\n', content, '\nendstream']);
      obj(P + 2, ['<< /Type /XObject /Subtype /Image /Width ' + c.width + ' /Height ' + c.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpg.length + ' >>\nstream\n', jpg, '\nendstream']);
    }
    const total = 3 + n * 3, xref = len;
    let x = 'xref\n0 ' + total + '\n0000000000 65535 f \n'; for (let i = 1; i < total; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    put(x + 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    return new Blob(parts, { type: 'application/pdf' });
  }

  // ---------- voice: record from the microphone, starting at the playhead ----------
  async function recordVoice() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') { toast('This browser can’t record sound.'); return; }
    if (scene.audio && !await ask('Your scene already has a sound (“' + (scene.audio.name || 'Sound') + '”). Replace it with a new recording?', 'Record')) return;
    if (playing) setPlaying(false);
    const at = time;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { toast(inFrame ? 'The microphone is blocked in this preview. Try it in the version on GitHub Pages.' : 'Couldn’t use the microphone: ' + (e.message || e.name) + '. Check Settings → Safari → Microphone.', 6000); return; }
    const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined), chunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const d = h('dialog', { class: 'ask' });
    const clock = h('div', { class: 'recclock' }, '0:00'), meter = h('div', { class: 'recmeter' }, h('i'));
    const stopBtn = h('button', { type: 'button', class: 'btn primary' }, '■ Stop and add'), cancelBtn = h('button', { type: 'button', class: 'btn quiet' }, 'Cancel');
    // play the scene while recording, in step with the voice (the old sound stays quiet)
    const playC = h('input', { type: 'checkbox' }); playC.checked = !!store.get('psiphi-recplay', false);
    let muted = null;
    const playScene = on => { if (on) { time = Math.min(scene.duration, at + (performance.now() - t0r) / 1000); if (time < scene.duration) { setPlaying(true); if (sound.el) { muted = sound.el; sound.el.muted = true; } } } else if (playing) setPlaying(false); };
    playC.addEventListener('change', () => { store.set('psiphi-recplay', playC.checked); playScene(playC.checked); });
    d.append(h('div', { class: 'dlg' }, h('h2', {}, '🎙 Recording'), h('p', { class: 'muted small' }, 'It starts at ' + fmtT(at) + ' on the timeline. Drag the sound clip afterwards to move it.'), clock, meter,
      h('label', { class: 'chk' }, playC, h('span', {}, 'Play the scene while I record')), h('div', { class: 'row end' }, cancelBtn, stopBtn)));
    document.body.append(d);
    // with the reader open the recorder stays small and out of the way, so the script can still be read and scrolled
    if (reader) { d.classList.add('rec-float'); d.show(); reader.start(); } else d.showModal();
    const t0r = performance.now(); if (playC.checked) playScene(true);
    let ac = null, raf = 0; const t0 = performance.now();
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); const an = ac.createAnalyser(); an.fftSize = 512; ac.createMediaStreamSource(stream).connect(an); const buf = new Uint8Array(an.fftSize);
      const tick = () => { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); meter.firstChild.style.width = Math.min(100, m / 1.2) + '%'; const s = (performance.now() - t0) / 1000; clock.textContent = Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'); raf = requestAnimationFrame(tick); }; tick(); } catch (e) { }
    const finish = keep => new Promise(res => {
      cancelAnimationFrame(raf); if (ac) ac.close().catch(() => { }); if (playing) setPlaying(false); if (muted) muted.muted = false; if (reader) reader.stop();
      rec.onstop = () => { stream.getTracks().forEach(t => t.stop()); d.close(); setTimeout(() => d.remove(), 50); res(keep ? new Blob(chunks, { type: rec.mimeType || type || 'audio/mp4' }) : null); };
      try { rec.stop(); } catch (e) { rec.onstop(); }
    });
    rec.start(250);
    const blob = await new Promise(res => { stopBtn.onclick = () => finish(true).then(res); cancelBtn.onclick = () => finish(false).then(res); d.addEventListener('cancel', ev => { ev.preventDefault(); finish(false).then(res); }); });
    if (!blob || !blob.size) return;
    const ext = /webm/.test(blob.type) ? 'webm' : /ogg/.test(blob.type) ? 'ogg' : 'm4a';
    const f = new File([blob], 'Voice ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '.' + ext, { type: blob.type });
    await importSound(f, at);
  }

  // ---------- drag and drop files anywhere on the app ----------
  async function addDropped(files) {
    const docs = [];
    for (const f of files) {
      const e = extOf(f);
      if (/^(obj|glb|gltf|blend|fbx|stl|dae|usdz)$/.test(e)) await importModel(f);
      else if (/^(pdb|ent|cif|mmcif)$/.test(e)) await openStructureFile(f);
      else if (/^(sdf|mol)$/.test(e)) await openMoleculeFile(f);
      else if (/^audio\//.test(f.type) || /^(mp3|m4a|wav|aac|ogg|flac|caf)$/.test(e)) await importSound(f, time);
      else if (/^image\//.test(f.type) && files.length === 1) await importImage(f);
      else docs.push(f);
    }
    if (docs.length) await addPapers(docs);
  }
  (() => {
    let depth = 0; const hint = h('div', { class: 'drophint', hidden: true }, h('div', {}, '⤓ Drop to add', h('small', {}, 'OBJ / GLB models · PDB · SDF · PDF · images · Word · text · sound')));
    document.body.append(hint);
    const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    addEventListener('dragenter', e => { if (!hasFiles(e) || clay) return; e.preventDefault(); depth++; hint.hidden = false; });
    addEventListener('dragover', e => { if (!hasFiles(e) || clay) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    addEventListener('dragleave', e => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) hint.hidden = true; });
    addEventListener('drop', e => { if (!hasFiles(e) || clay) return; e.preventDefault(); depth = 0; hint.hidden = true; const fs = [...e.dataTransfer.files]; if (fs.length) addDropped(fs); });
  })();

  // ---------- stage ----------
  const narrow = () => matchMedia('(max-width: 899px)').matches;
  function sizeStage() {
    const wrap = $('#stageWrap');
    const r = ratio(scene.aspect);
    const colW = $('#col').clientWidth;
    const maxW = colW - 16, maxH = Math.max(150, window.innerHeight * (narrow() ? 0.42 : 0.52));
    let w = maxW, hh = w / r;
    if (hh > maxH) { hh = maxH; w = hh * r; }
    w = Math.floor(w); hh = Math.floor(hh);
    stage.style.width = w + 'px'; stage.style.height = hh + 'px';
    wrap.style.height = (hh + 16) + 'px';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    stage.width = Math.round(w * dpr); stage.height = Math.round(hh * dpr);
    document.documentElement.style.setProperty('--sheet-top', (wrap.getBoundingClientRect().bottom) + 'px');
    dirty = true;
    syncScroll();
  }
  function draw() {
    const W = stage.width, H = stage.height;
    A.render(sctx, scene, time, W, H, { guides: true });
    const ppu = H / 8;
    if (guides) {
      sctx.save(); sctx.strokeStyle = isLight(scene.bg) ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.12)'; sctx.lineWidth = 1;
      const uw = W / ppu / 2;
      for (let x = -Math.floor(uw); x <= uw; x++) { sctx.beginPath(); sctx.moveTo(W / 2 + x * ppu, 0); sctx.lineTo(W / 2 + x * ppu, H); sctx.stroke(); }
      for (let y = -4; y <= 4; y++) { sctx.beginPath(); sctx.moveTo(0, H / 2 - y * ppu); sctx.lineTo(W, H / 2 - y * ppu); sctx.stroke(); }
      sctx.strokeStyle = isLight(scene.bg) ? 'rgba(0,0,0,.3)' : 'rgba(255,255,255,.3)';
      sctx.beginPath(); sctx.moveTo(W / 2, 0); sctx.lineTo(W / 2, H); sctx.moveTo(0, H / 2); sctx.lineTo(W, H / 2); sctx.stroke();
      sctx.restore();
    }
    const o = selObj();
    if (drw) drawOverlay(W, H);
    else if (o && o._hit && !playing) {
      const g = boxGeom(o, W, H), k = W / stage.getBoundingClientRect().width || 1;
      sctx.save();
      sctx.strokeStyle = '#FFFFFF'; sctx.lineWidth = 1.5 * k; sctx.shadowColor = 'rgba(0,0,0,.6)'; sctx.shadowBlur = 3 * k;
      sctx.beginPath(); g.corners.forEach(([x, y], i) => i ? sctx.lineTo(x, y) : sctx.moveTo(x, y)); sctx.closePath(); sctx.stroke();
      sctx.beginPath(); sctx.moveTo(...g.top); sctx.lineTo(...g.rot); sctx.stroke();
      sctx.fillStyle = '#FFFFFF';
      for (const [x, y] of g.corners) { sctx.beginPath(); sctx.rect(x - 5 * k, y - 5 * k, 10 * k, 10 * k); sctx.fill(); }
      for (const [x, y, ax] of g.sides) { sctx.save(); sctx.translate(x, y); sctx.rotate(ax); sctx.beginPath(); (sctx.roundRect ? sctx.roundRect(-7 * k, -3 * k, 14 * k, 6 * k, 3 * k) : sctx.rect(-7 * k, -3 * k, 14 * k, 6 * k)); sctx.fill(); sctx.restore(); }
      sctx.beginPath(); sctx.arc(g.rot[0], g.rot[1], 8 * k, 0, 7); sctx.fill();
      sctx.strokeStyle = '#111'; sctx.lineWidth = 1.6 * k; sctx.shadowBlur = 0;
      sctx.beginPath(); sctx.arc(g.rot[0], g.rot[1], 4 * k, -0.3, 4.4); sctx.stroke();
      if (o.pivot || pivotMode) {
        const [ax, ay] = g.anchor, rr = (pivotMode ? 11 : 7) * k;
        sctx.strokeStyle = pivotMode ? '#FFFF00' : '#FFFFFF'; sctx.lineWidth = 2 * k; sctx.shadowBlur = 3 * k;
        sctx.beginPath(); sctx.arc(ax, ay, rr, 0, 7); sctx.moveTo(ax - rr * 1.6, ay); sctx.lineTo(ax + rr * 1.6, ay); sctx.moveTo(ax, ay - rr * 1.6); sctx.lineTo(ax, ay + rr * 1.6); sctx.stroke();
      }
      if (o.type === 'group') { sctx.fillStyle = 'rgba(0,0,0,.55)'; sctx.fillRect(g.corners[0][0], g.corners[0][1] - 18 * k, 64 * k, 16 * k); sctx.fillStyle = '#fff'; sctx.font = (11 * k) + 'px "IBM Plex Sans", sans-serif'; sctx.textBaseline = 'middle'; sctx.fillText('⧈ Group', g.corners[0][0] + 4 * k, g.corners[0][1] - 10 * k); }
      sctx.restore();
    }
    if (pivotMode && o) {
      sctx.save(); const k = W / (stage.getBoundingClientRect().width || W);
      sctx.fillStyle = 'rgba(0,0,0,.55)'; sctx.fillRect(8 * k, 8 * k, 190 * k, 24 * k);
      sctx.fillStyle = '#FFFF00'; sctx.font = (12 * k) + 'px "IBM Plex Sans", sans-serif'; sctx.textBaseline = 'middle';
      sctx.fillText('⊕ Drag to move the pivot', 14 * k, 20 * k); sctx.restore();
    }
    $('#time').textContent = fmtT(time);
    $('#dur').textContent = fmtT(scene.duration);
    const kb = $('#keyBtn');
    if (kb) { const on = o && Object.values(o.keys || {}).some(k => k.some(q => Math.abs(q.t - time) < 0.026)); kb.classList.toggle('on', !!on); kb.disabled = !o; }
  }
  function loop() {
    if (playing) {
      time = (performance.now() - t0) / 1000;
      if (time >= scene.duration) {
        if ($('#loopBtn').getAttribute('aria-pressed') === 'true') { t0 = performance.now(); time = 0; }
        else { time = scene.duration; setPlaying(false); }
      }
      draw(); syncScroll(); syncSound();
    } else if (dirty) { draw(); dirty = false; }
    requestAnimationFrame(loop);
  }
  function setPlaying(on) {
    playing = on;
    if (on) { if (time >= scene.duration - 0.01) time = 0; t0 = performance.now() - time * 1000; }
    if (sound.el) {
      // start the sound from the tap itself, so phones allow it to play
      if (on) { const p = sound.el.play(); if (p && p.then) p.then(syncSound).catch(() => {}); else syncSound(); }
      else sound.el.pause();
    }
    document.querySelectorAll('.playbtn').forEach(b => { b.textContent = on ? '❚❚' : '▶'; b.setAttribute('aria-label', on ? 'Pause' : 'Play'); });
    dirty = true;
    if (!on) refreshSheetValues();
    if (reader) reader.onPlay(on);
  }
  function setTime(t, fromScroll) {
    time = Math.max(0, Math.min(scene.duration, t)); dirty = true;
    if (!fromScroll) syncScroll();
    if (!playing) refreshSheetValues();
  }
  const selObj = () => (scene && scene.objects.find(o => o.id === sel)) || null;
  const GLOBAL_SHEETS = ['scene', 'add', 'media', 'library', 'values', 'camera', 'audio', 'code', 'ease', 'layers'];
  function select(id) {
    if (drw && id !== drw.id) endDraw();
    sel = id; dirty = true;
    renderTools(); renderTimeline();
    pivotMode = false;
    if (sheetKind && !GLOBAL_SHEETS.includes(sheetKind.split(':')[0])) { if (id) openSheet(sheetKind); else closeSheet(); }
    if (!narrow() && !drw) { if (id && (!sheetKind || GLOBAL_SHEETS.includes(sheetKind.split(':')[0]))) openSheet('edit'); else if (!id && (!sheetKind || !GLOBAL_SHEETS.includes(sheetKind.split(':')[0]))) openSheet('layers'); }
  }

  // ---------- Draw: pen, pencil and node editing for vector shapes ----------
  let drw = null;
  let drawStyle = Object.assign({ stroke: 'WHITE', sw: 4, fill: '', fo: 1 }, store.get('bstudio.drawstyle', {}));
  const drawObj = () => drw && scene.objects.find(o => o.id === drw.id);
  function objState(o) { const k = p => A.keyVal(o, p, time); return { x: k('x'), y: k('y'), s: k('scale'), sx: k('sx'), sy: k('sy'), r: k('rotation') * Math.PI / 180 }; }
  // frame units ↔ the object's own units, through parents, pivot and camera (from the last frame drawn)
  function toLocal(o, ux, uy) {
    const r = A.toLocalPt(o, ux, uy); if (r) return r;
    const st = objState(o), c = Math.cos(st.r), s = Math.sin(st.r); const dx = ux - st.x, dy = uy - st.y; const X = dx * c + dy * s, Y = -dx * s + dy * c; return [X / (st.s * st.sx || 1e-6), -Y / (st.s * st.sy || 1e-6)];
  }
  function toScreen(o, lx, ly, W, H) {
    const ppu = H / 8, f = A.toFramePt(o, lx, ly);
    if (f) return [W / 2 + f[0] * ppu, H / 2 - f[1] * ppu];
    const st = objState(o), c = Math.cos(st.r), s = Math.sin(st.r); const X = lx * st.s * st.sx, Y = -ly * st.s * st.sy; return [W / 2 + (st.x + X * c - Y * s) * ppu, H / 2 - (st.y + X * s + Y * c) * ppu];
  }
  // move an object by (dx, dy) in its parent's space, keyframes included
  function shiftPos(o, dx, dy) {
    for (const [p, d] of [['x', dx], ['y', dy]]) { if (o.keys[p] && o.keys[p].length) o.keys[p].forEach(k => { k.v = round(k.v + d, 3); }); else o[p] = round((o[p] || 0) + d, 3); }
  }
  function startDraw(existing) {
    if (playing) setPlaying(false);
    let o = existing;
    if (!o) {
      if (isLight(scene.bg) && drawStyle.stroke === 'WHITE') drawStyle.stroke = 'INK';
      o = makeObj('vector', { name: 'Drawing ' + (scene.objects.filter(x => x.type === 'vector').length + 1) });
      o.props.paths = [];
      scene.objects.push(o);
      if (o.end > scene.duration) scene.duration = Math.ceil(o.end);
      commit();
    }
    sel = o.id;
    drw = { id: o.id, tool: existing ? 'node' : 'pen', path: null, node: null, pen: null, drag: null, lastTap: 0 };
    const { inD, outD } = A.phases(o);
    if (time < o.start + inD || time > o.end - outD) setTime(Math.min(o.end - outD - 0.01, o.start + inD + 0.01));
    closeSheet(); renderTools(); renderTimeline(); dirty = true;
    toast(existing ? 'Drag nodes and handles. Tap a line to add a node.' : 'Pen: tap for corners, drag for curves');
  }
  function endDraw() {
    const o = drawObj();
    drw = null;
    if (o) {
      o.props.paths = (o.props.paths || []).filter(p => p.nodes.length);
      if (!o.props.paths.length) { scene.objects = scene.objects.filter(x => x !== o); sel = null; }
      else normaliseDrawing(o);
      commit();
    }
    closeSheet(); renderTools(); renderTimeline(); dirty = true;
  }
  // keep the object's origin at the drawing's centre, so rotating and resizing pivot around the middle
  function normaliseDrawing(o) {
    const ns = o.props.paths.flatMap(p => p.nodes);
    if (!ns.length) return;
    const xs = ns.map(n => n.x), ys = ns.map(n => n.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    if (Math.abs(cx) < 1e-6 && Math.abs(cy) < 1e-6) return;
    ns.forEach(n => { n.x = round(n.x - cx, 4); n.y = round(n.y - cy, 4); });
    // a set pivot stays where it was on the drawing; otherwise the position moves to the new middle
    if (o.pivot) { o.pivot = [round(o.pivot[0] - cx, 4), round(o.pivot[1] + cy, 4)]; return; }
    const st = objState(o), c = Math.cos(st.r), s = Math.sin(st.r);
    const X = cx * st.s * st.sx, Y = -cy * st.s * st.sy, dx = X * c - Y * s, dy = X * s + Y * c;
    shiftPos(o, dx, dy);
  }
  const newPath = n => ({ nodes: [n], closed: false, stroke: drawStyle.stroke, sw: drawStyle.sw, fill: drawStyle.fill, fo: drawStyle.fo });
  function reversePath(p) { p.nodes.reverse(); p.nodes.forEach(n => { [n.ix, n.ox] = [n.ox, n.ix]; [n.iy, n.oy] = [n.oy, n.iy]; }); }
  function smoothHandles(p, i) {
    const n = p.nodes, N = n.length, a = n[i];
    const prev = i > 0 ? n[i - 1] : p.closed ? n[N - 1] : null, next = i < N - 1 ? n[i + 1] : p.closed ? n[0] : null;
    if (!prev && !next) return;
    const tx = ((next || a).x - (prev || a).x) / (prev && next ? 4 : 3), ty = ((next || a).y - (prev || a).y) / (prev && next ? 4 : 3);
    Object.assign(a, { ox: tx, oy: ty, ix: -tx, iy: -ty, smooth: true });
  }
  function bezPoint(a, b, t) {
    const P0 = [a.x, a.y], P1 = [a.x + (a.ox || 0), a.y + (a.oy || 0)], P2 = [b.x + (b.ix || 0), b.y + (b.iy || 0)], P3 = [b.x, b.y];
    const L = (p, q) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const A1 = L(P0, P1), B1 = L(P1, P2), C1 = L(P2, P3), A2 = L(A1, B1), B2 = L(B1, C1), M = L(A2, B2);
    return { M, A1, A2, B2, C1 };
  }
  function drawDown(e) {
    const o = drawObj(); if (!o) { drw = null; return; }
    const r = stage.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const [ux, uy] = toUnits(e, r), [lx, ly] = toLocal(o, ux, uy);
    const P = o.props.paths || (o.props.paths = []);
    const near = (x, y, tol = 18) => { const [a, b] = toScreen(o, x, y, r.width, r.height); return Math.hypot(a - mx, b - my) < tol; };
    stage.setPointerCapture(e.pointerId);
    const selNode = drw.path != null && P[drw.path] ? P[drw.path].nodes[drw.node] : null;
    if (selNode && drw.tool !== 'pencil') for (const k of ['i', 'o']) {
      const hx = selNode[k + 'x'] || 0, hy = selNode[k + 'y'] || 0;
      if ((hx || hy) && near(selNode.x + hx, selNode.y + hy)) { drw.drag = { kind: 'handle', k, nd: selNode }; return; }
    }
    let hit = null;
    P.forEach((p, pi) => p.nodes.forEach((n, ni) => { if (!hit && near(n.x, n.y)) hit = [pi, ni]; }));
    if (drw.tool === 'pencil') { drw.drag = { kind: 'pencil', pts: [[lx, ly]] }; return; }
    if (drw.tool === 'pen') {
      const ap = drw.pen != null && P[drw.pen] && !P[drw.pen].closed ? P[drw.pen] : null;
      if (hit && ap && hit[0] === drw.pen) {
        if (hit[1] === 0 && ap.nodes.length >= 2) { ap.closed = true; drw.pen = null; drw.path = hit[0]; drw.node = 0; toast('Shape closed'); commit(); dirty = true; renderTools(); return; }
        if (hit[1] === ap.nodes.length - 1) { drw.pen = null; drw.path = hit[0]; drw.node = hit[1]; toast('Line finished'); dirty = true; renderTools(); return; }
      }
      if (hit && !ap) {
        const p = P[hit[0]];
        if (!p.closed && (hit[1] === 0 || hit[1] === p.nodes.length - 1)) { if (hit[1] === 0) reversePath(p); drw.pen = hit[0]; drw.path = hit[0]; drw.node = p.nodes.length - 1; toast('Carrying on from this end'); dirty = true; renderTools(); return; }
        drw.path = hit[0]; drw.node = hit[1]; drw.drag = { kind: 'node', nd: p.nodes[hit[1]], pi: hit[0], ni: hit[1], last: [lx, ly] }; dirty = true; renderTools(); return;
      }
      const n = { x: round(lx, 4), y: round(ly, 4) };
      if (ap) ap.nodes.push(n); else { P.push(newPath(n)); drw.pen = P.length - 1; }
      drw.path = drw.pen; drw.node = P[drw.pen].nodes.length - 1;
      drw.drag = { kind: 'pull', nd: n };
      dirty = true; renderTools(); return;
    }
    // node tool
    if (hit) {
      const now = performance.now(), same = drw.path === hit[0] && drw.node === hit[1];
      drw.path = hit[0]; drw.node = hit[1];
      if (same && now - drw.lastTap < 380) { toggleSmooth(); drw.lastTap = 0; return; }
      drw.lastTap = now;
      drw.drag = { kind: 'node', nd: P[hit[0]].nodes[hit[1]], pi: hit[0], ni: hit[1], last: [lx, ly] };
      dirty = true; renderTools(); return;
    }
    // tap on a line: add a node there
    let best = null;
    P.forEach((p, pi) => {
      const n = p.nodes, segs = n.length - 1 + (p.closed ? 1 : 0);
      for (let i = 0; i < segs; i++) for (let k = 1; k < 24; k++) {
        const t = k / 24, q = bezPoint(n[i], n[(i + 1) % n.length], t).M;
        const [a, b] = toScreen(o, q[0], q[1], r.width, r.height), d = Math.hypot(a - mx, b - my);
        if (d < 16 && (!best || d < best.d)) best = { d, pi, i, t };
      }
    });
    if (best) {
      const p = P[best.pi], a = p.nodes[best.i], b = p.nodes[(best.i + 1) % p.nodes.length], q = bezPoint(a, b, best.t);
      const curved = a.ox || a.oy || b.ix || b.iy;
      const m = { x: q.M[0], y: q.M[1], smooth: !!curved };
      if (curved) { a.ox = q.A1[0] - a.x; a.oy = q.A1[1] - a.y; b.ix = q.C1[0] - b.x; b.iy = q.C1[1] - b.y; m.ix = q.A2[0] - m.x; m.iy = q.A2[1] - m.y; m.ox = q.B2[0] - m.x; m.oy = q.B2[1] - m.y; }
      p.nodes.splice(best.i + 1, 0, m);
      drw.path = best.pi; drw.node = best.i + 1;
      drw.drag = { kind: 'node', nd: m, pi: best.pi, ni: best.i + 1, last: [lx, ly] };
      toast('Node added'); dirty = true; renderTools(); return;
    }
    drw.path = null; drw.node = null; dirty = true; renderTools();
  }
  function drawMove(e) {
    const d = drw && drw.drag; if (!d) return;
    const o = drawObj(); const r = stage.getBoundingClientRect();
    const [ux, uy] = toUnits(e, r), [lx, ly] = toLocal(o, ux, uy);
    d.moved = true;
    if (d.kind === 'pull') {
      let ox = lx - d.nd.x, oy = ly - d.nd.y;
      if (Math.hypot(ox, oy) < 0.06) { ox = 0; oy = 0; }
      Object.assign(d.nd, { ox, oy, ix: -ox, iy: -oy, smooth: !!(ox || oy) });
    } else if (d.kind === 'handle') {
      const nd = d.nd, k = d.k, other = k === 'i' ? 'o' : 'i';
      nd[k + 'x'] = lx - nd.x; nd[k + 'y'] = ly - nd.y;
      if (nd.smooth) { const L = Math.hypot(nd[other + 'x'] || 0, nd[other + 'y'] || 0), M = Math.hypot(nd[k + 'x'], nd[k + 'y']) || 1; nd[other + 'x'] = -nd[k + 'x'] / M * L; nd[other + 'y'] = -nd[k + 'y'] / M * L; }
    } else if (d.kind === 'node') {
      d.nd.x += lx - d.last[0]; d.nd.y += ly - d.last[1]; d.last = [lx, ly];
    } else if (d.kind === 'pencil') {
      const q = d.pts[d.pts.length - 1];
      if (Math.hypot(lx - q[0], ly - q[1]) > 0.02) d.pts.push([lx, ly]);
    }
    dirty = true;
  }
  function rdp(pts, eps) {
    if (pts.length < 3) return pts;
    const [a, b] = [pts[0], pts[pts.length - 1]];
    let idx = 0, dm = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
      const d = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L;
      if (d > dm) { dm = d; idx = i; }
    }
    if (dm <= eps) return [a, b];
    return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
  }
  function drawUp() {
    const d = drw && drw.drag; if (!drw) return;
    drw.drag = null;
    const o = drawObj(), P = o ? o.props.paths : [];
    if (!d) return;
    if (d.kind === 'pencil') {
      if (d.pts.length < 2) { dirty = true; return; }
      const st = objState(o);
      let pts = rdp(d.pts, 0.05 / Math.max(0.05, Math.abs(st.s)));
      let closed = false;
      const f = pts[0], l = pts[pts.length - 1];
      if (pts.length >= 4 && Math.hypot(f[0] - l[0], f[1] - l[1]) < 0.3 / Math.max(0.05, Math.abs(st.s))) { pts = pts.slice(0, -1); closed = true; }
      const p = newPath({ x: pts[0][0], y: pts[0][1] });
      p.nodes = pts.map(([x, y]) => ({ x: round(x, 4), y: round(y, 4) }));
      p.closed = closed;
      if (pts.length > 2) p.nodes.forEach((_, i) => smoothHandles(p, i));
      P.push(p); drw.path = P.length - 1; drw.node = null;
      if (closed) toast('Closed shape drawn');
    } else if (d.kind === 'node' && d.moved) {
      // drop an end onto another end to join lines, or onto its own start to close the shape
      const p = P[d.pi];
      if (p && !p.closed && (d.ni === 0 || d.ni === p.nodes.length - 1)) {
        const r = stage.getBoundingClientRect();
        const scr = n => toScreen(o, n.x, n.y, r.width, r.height);
        const me = scr(d.nd);
        const otherEnd = d.ni === 0 ? p.nodes[p.nodes.length - 1] : p.nodes[0];
        if (p.nodes.length >= 3) { const q = scr(otherEnd); if (Math.hypot(q[0] - me[0], q[1] - me[1]) < 18) { if (d.ni === 0) p.nodes.shift(); else p.nodes.pop(); p.closed = true; drw.node = 0; toast('Shape closed'); } }
        if (!p.closed) {
          for (let qi = 0; qi < P.length; qi++) {
            const B = P[qi]; if (qi === d.pi || B.closed) continue;
            const ends = [0, B.nodes.length - 1];
            const hitEnd = ends.find(ei => { const q = scr(B.nodes[ei]); return Math.hypot(q[0] - me[0], q[1] - me[1]) < 18; });
            if (hitEnd == null) continue;
            if (d.ni === 0) reversePath(p);
            if (hitEnd !== 0) reversePath(B);
            const dragged = p.nodes.pop();
            if (dragged.ix || dragged.iy) { B.nodes[0].ix = dragged.ix; B.nodes[0].iy = dragged.iy; }
            p.nodes.push(...B.nodes);
            P.splice(qi, 1);
            drw.path = P.indexOf(p); drw.node = null; toast('Lines joined');
            break;
          }
        }
      }
    }
    commit(); dirty = true; renderTools();
  }
  function toggleSmooth() {
    const o = drawObj(); if (!o || drw.path == null || drw.node == null) return;
    const p = o.props.paths[drw.path], n = p && p.nodes[drw.node]; if (!n) return;
    if (n.ox || n.oy || n.ix || n.iy) { Object.assign(n, { ox: 0, oy: 0, ix: 0, iy: 0, smooth: false }); toast('Corner'); }
    else { smoothHandles(p, drw.node); toast('Smooth'); }
    commit(); dirty = true; renderTools();
  }
  function drawAction(kind) {
    const o = drawObj(); if (!o) return;
    const P = o.props.paths, p = drw.path != null ? P[drw.path] : null;
    if (kind === 'close' && p) { p.closed = !p.closed; if (p.closed && !p.fill) { p.fill = drawStyle.fill || p.stroke; p.fo = p.fo == null ? 1 : p.fo; } toast(p.closed ? 'Shape closed: fill it in Style' : 'Shape opened'); if (drw.pen === drw.path) drw.pen = null; }
    else if (kind === 'delnode' && p && drw.node != null) { p.nodes.splice(drw.node, 1); if (p.nodes.length < 3) p.closed = false; if (!p.nodes.length) { P.splice(drw.path, 1); drw.path = null; drw.pen = null; } drw.node = null; }
    else if (kind === 'delpath' && p) { P.splice(drw.path, 1); drw.path = null; drw.node = null; drw.pen = null; }
    else if (kind === 'newline') { drw.tool = 'pen'; drw.pen = null; drw.path = null; drw.node = null; toast('Tap to start a new line'); }
    commit(); dirty = true; renderTools(); refreshSheet();
  }
  function renderDrawTools(bar) {
    const o = drawObj();
    const p = o && drw.path != null ? o.props.paths[drw.path] : null;
    const hasNode = p && drw.node != null;
    const t = (icon, label, fn, cls, dis) => { const b = tool(icon, label, fn, cls); if (dis) b.disabled = true; return b; };
    bar.append(t('✓', 'Done', endDraw, 'back'),
      t('✒', 'Pen', () => { drw.tool = 'pen'; renderTools(); }, drw.tool === 'pen' ? 'active' : ''),
      t('✎', 'Pencil', () => { drw.tool = 'pencil'; drw.pen = null; renderTools(); }, drw.tool === 'pencil' ? 'active' : ''),
      t('⌖', 'Nodes', () => { drw.tool = 'node'; drw.pen = null; renderTools(); }, drw.tool === 'node' ? 'active' : ''),
      t('◐', 'Style', () => openSheet('drawstyle'), sheetKind === 'drawstyle' ? 'active' : ''),
      t('∿', 'Smooth', toggleSmooth, '', !hasNode),
      t('◯', p && p.closed ? 'Open' : 'Close', () => drawAction('close'), '', !p || p.nodes.length < 3),
      t('＋', 'New line', () => drawAction('newline')),
      t('⌫', 'Del node', () => drawAction('delnode'), '', !hasNode),
      t('✕', 'Del line', () => drawAction('delpath'), 'danger', !p));
  }
  function drawStyleSheet(body) {
    const o = drawObj(); if (!o) return;
    const p = drw.path != null ? o.props.paths[drw.path] : null;
    const cur = p || drawStyle;
    const set = (k, v) => { drawStyle[k] = v; store.set('bstudio.drawstyle', drawStyle); if (p) p[k] = v; dirty = true; commitSoon(); };
    body.append(h('p', { class: 'muted small' }, p ? 'Changes the selected line, and new lines too.' : 'Sets the style for new lines. Select a line (Nodes tool) to change it.'));
    body.append(field('Line colour', colorField(cur.stroke, v => set('stroke', v))));
    body.append(field('Thickness (0 = no outline)', stepper(cur.sw, 1, v => set('sw', Math.max(0, v)))));
    body.append(field('Fill (closed shapes; ∅ = none)', colorField(cur.fill || '', v => set('fill', v), true)));
    body.append(field('Fill opacity', stepper(cur.fo == null ? 1 : cur.fo, 0.1, v => set('fo', Math.max(0, Math.min(1, v))))));
    if (p && p.nodes.length >= 3) body.append(h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: () => { drawAction('close'); } }, p.closed ? 'Open the shape' : 'Close into a shape')));
    body.append(h('p', { class: 'muted small' }, 'Pen: tap for a corner, drag for a curve, tap the first node to close. Pencil: draw freely; it becomes smooth, editable nodes. Nodes: drag nodes and their handles, tap a line to add a node, double-tap a node to switch smooth/corner, drop an end on another end to join.'));
  }
  function drawOverlay(W, H) {
    const o = drawObj(); if (!o) return;
    const k = W / (stage.getBoundingClientRect().width || W);
    const S = (x, y) => toScreen(o, x, y, W, H);
    const P = o.props.paths || [];
    sctx.save();
    sctx.lineWidth = 1.2 * k;
    P.forEach((p, pi) => {
      const active = pi === drw.path;
      p.nodes.forEach((n, ni) => {
        const [x, y] = S(n.x, n.y), selN = active && ni === drw.node;
        if (selN) for (const kk of ['i', 'o']) {
          const hx = n[kk + 'x'] || 0, hy = n[kk + 'y'] || 0; if (!hx && !hy) continue;
          const [a, b] = S(n.x + hx, n.y + hy);
          sctx.strokeStyle = '#7FB8FF'; sctx.beginPath(); sctx.moveTo(x, y); sctx.lineTo(a, b); sctx.stroke();
          sctx.fillStyle = '#7FB8FF'; sctx.beginPath(); sctx.arc(a, b, 5 * k, 0, 7); sctx.fill();
        }
        const r = (selN ? 7 : 5) * k;
        sctx.fillStyle = selN ? '#FFFF00' : active ? '#FFFFFF' : 'rgba(255,255,255,.55)';
        sctx.strokeStyle = '#000'; sctx.lineWidth = 1.5 * k;
        sctx.beginPath();
        if (n.ox || n.oy || n.ix || n.iy) sctx.arc(x, y, r, 0, 7); else sctx.rect(x - r, y - r, 2 * r, 2 * r);
        sctx.fill(); sctx.stroke();
        if (drw.tool === 'pen' && drw.pen === pi && ni === 0 && p.nodes.length >= 2) { sctx.strokeStyle = '#FFFF00'; sctx.lineWidth = 2 * k; sctx.beginPath(); sctx.arc(x, y, 12 * k, 0, 7); sctx.stroke(); }
      });
    });
    if (drw.drag && drw.drag.kind === 'pencil') {
      sctx.strokeStyle = A.color(drawStyle.stroke) || '#fff'; sctx.lineWidth = 2 * k; sctx.lineJoin = 'round'; sctx.lineCap = 'round';
      sctx.beginPath(); drw.drag.pts.forEach(([x, y], i) => { const [a, b] = S(x, y); i ? sctx.lineTo(a, b) : sctx.moveTo(a, b); }); sctx.stroke();
    }
    sctx.fillStyle = 'rgba(0,0,0,.55)'; sctx.fillRect(8 * k, 8 * k, 118 * k, 24 * k);
    sctx.fillStyle = '#FFFF00'; sctx.font = (12 * k) + 'px "IBM Plex Sans", sans-serif'; sctx.textBaseline = 'middle';
    sctx.fillText('✎ Drawing · ' + ({ pen: 'Pen', pencil: 'Pencil', node: 'Nodes' }[drw.tool]), 14 * k, 20 * k);
    sctx.restore();
  }

  // ---------- transform box: corners scale evenly, side bars stretch one way, the round handle rotates ----------
  function boxGeom(o, W, H) {
    const { P, bb } = o._hit, ppu = H / 8;
    const PF = MT.mul(P, MT.FLIP);
    const S = (lx, ly) => { const [x, y] = MT.ap(PF, lx, ly); return [W / 2 + x * ppu, H / 2 - y * ppu]; };
    const lx = Math.hypot(P[0], P[1]) || 1, ly = Math.hypot(P[2], P[3]) || 1;
    const px = 0.13 / lx, py = 0.13 / ly;
    const x0 = bb[0] - px, x1 = bb[2] + px, y0 = bb[1] - py, y1 = bb[3] + py, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const corners = [S(x0, y0), S(x1, y0), S(x1, y1), S(x0, y1)];
    const top = S(cx, y0), center = S(cx, cy);
    const dx = top[0] - center[0], dy = top[1] - center[1], L = Math.hypot(dx, dy) || 1, k = W / (stage.getBoundingClientRect().width || W);
    const rot = [top[0] + dx / L * 30 * k, top[1] + dy / L * 30 * k];
    const ang = Math.atan2(-P[1], P[0]);
    const sides = [[...top, ang], [...S(x1, cy), ang + Math.PI / 2], [...S(cx, y1), ang], [...S(x0, cy), ang + Math.PI / 2]];
    const pv = o.pivot || [0, 0], af = MT.ap(P, pv[0], pv[1]);
    return { corners, sides, top, rot, center, anchor: [W / 2 + af[0] * ppu, H / 2 - af[1] * ppu], anchorU: af };
  }
  let sdrag = null;
  const toUnits = (e, r) => { const ppu = r.height / 8; return [(e.clientX - r.left - r.width / 2) / ppu, -(e.clientY - r.top - r.height / 2) / ppu]; };
  // tapping a member of a group picks the group first, then the member on the next tap
  function pickTarget(c) {
    const cur = selObj(), path = cur ? [...ancestors(cur), cur].map(x => x.id) : [];
    for (const g of ancestors(c).filter(x => x.type === 'group')) if (!path.includes(g.id)) return g;
    return c;
  }
  let pivotMode = false;
  function setPivot(o, pv) {
    const old = o.pivot || [0, 0];
    const st = objState(o), RS = MT.mul(MT.mR(st.r), MT.mS(st.s * st.sx, st.s * st.sy));
    const [dx, dy] = MT.apv(RS, pv[0] - old[0], pv[1] - old[1]);
    o.pivot = Math.abs(pv[0]) < 1e-6 && Math.abs(pv[1]) < 1e-6 ? undefined : [round(pv[0], 4), round(pv[1], 4)];
    shiftPos(o, dx, dy);
  }
  const TP = new Map(); let orbit3 = null, pinch3 = null;
  const tpDist = () => { const [a, b] = [...TP.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
  stage.addEventListener('pointerdown', e => {
    if (drw) { drawDown(e); return; }
    if (pinPick) {
      const r0 = stage.getBoundingClientRect(), [px, py] = toUnits(e, r0), hit = window.Bio3D && window.Bio3D.pickResidue(scene, px, py), lo = objById(pinPick.id);
      if (hit && lo) { pinPick = null; pinTo(lo, { oid: hit.oid, res: hit.res }); if (lo.type === 'text' && /^(Residue|Label)$/.test(lo.props.text)) { lo.props.text = hit.label; commit(); refreshSheet(); } toast('Pinned to ' + hit.label + '.'); }
      else toast('No residue there. Tap closer to the protein or molecule, or press Esc.');
      return;
    }
    TP.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (TP.size === 2 && has3D() && !playing) { sdrag = null; orbit3 = null; pinch3 = { d: tpDist(), dist0: c3('dist') }; stage.setPointerCapture(e.pointerId); return; }
    const r = stage.getBoundingClientRect();
    const [ux, uy] = toUnits(e, r);
    const cur = selObj();
    if (cur && cur._hit && !playing && pivotMode) {
      sdrag = { o: cur, mode: 'pivot', ux, uy, moved: false, snap: clone({ x: cur.x, y: cur.y, kx: cur.keys.x, ky: cur.keys.y, pivot: cur.pivot }), Pi: MT.inv(cur._hit.P) };
      stage.setPointerCapture(e.pointerId);
      return;
    }
    if (cur && cur._hit && !playing) {
      const g = boxGeom(cur, r.width, r.height), mx = e.clientX - r.left, my = e.clientY - r.top;
      const near = ([x, y]) => Math.hypot(x - mx, y - my) < 20;
      let mode = null;
      if (near(g.rot)) mode = 'rot';
      else if (g.corners.some(near)) mode = 'corner';
      else { const i = g.sides.findIndex(near); if (i >= 0) mode = i % 2 ? 'sx' : 'sy'; }
      if (mode) {
        const k = p => A.keyVal(cur, p, time), P = cur._hit.P;
        const nx = MT.apv(P, 1, 0), ny = MT.apv(P, 0, 1), Lx = Math.hypot(...nx) || 1, Ly = Math.hypot(...ny) || 1;
        sdrag = { o: cur, mode, ux, uy, ax: g.anchorU[0], ay: g.anchorU[1], axX: [nx[0] / Lx, nx[1] / Lx], axY: [ny[0] / Ly, ny[1] / Ly], flip: Math.sign(P[0] * P[3] - P[1] * P[2]) || 1,
          s0: k('scale'), sx0: k('sx'), sy0: k('sy'), r0: k('rotation'), moved: false };
        stage.setPointerCapture(e.pointerId);
        return;
      }
    }
    const hit = A.hitTest(scene, ux, uy);
    if (!hit) {
      if (sel) select(null);
      if (has3D() && !playing) { orbit3 = { x: e.clientX, y: e.clientY, o0: c3('orbit'), t0: c3('tilt'), moved: false }; stage.setPointerCapture(e.pointerId); }
      return;
    }
    const o = pickTarget(hit);
    if (o.id !== sel) select(o.id);
    if (playing) setPlaying(false);
    const bi = o._hit ? MT.inv(o._hit.base) : MT.I;
    sdrag = { o, mode: 'move', ux, uy, bi, x0: A.keyVal(o, 'x', time), y0: A.keyVal(o, 'y', time), moved: false };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', e => {
    if (drw) { drawMove(e); return; }
    if (TP.has(e.pointerId)) TP.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch3 && TP.size >= 2) { setProp(cam3(), 'dist', round(Math.max(0.2, Math.min(6, pinch3.dist0 * pinch3.d / tpDist())), 3)); dirty = true; refreshSheetValues(); return; }
    if (orbit3) {
      const dx = e.clientX - orbit3.x, dy = e.clientY - orbit3.y; if (Math.hypot(dx, dy) > 2) orbit3.moved = true;
      setProp(cam3(), 'orbit', round(orbit3.o0 - dx * 0.4, 1)); setProp(cam3(), 'tilt', round(Math.max(-89, Math.min(89, orbit3.t0 + dy * 0.3)), 1));
      dirty = true; refreshSheetValues(); return;
    }
    if (!sdrag) return;
    const r = stage.getBoundingClientRect();
    const [ux, uy] = toUnits(e, r);
    const d = sdrag;
    if (!d.moved && Math.hypot(ux - d.ux, uy - d.uy) < 0.05) return;
    d.moved = true;
    const o = d.o;
    if (d.mode === 'pivot') {
      // measured against the drag's starting frame, so small roundings don't build up
      const [lx, ly] = MT.ap(d.Pi, ux, uy), s0 = d.snap;
      o.x = s0.x; o.y = s0.y; if (s0.kx) o.keys.x = clone(s0.kx); if (s0.ky) o.keys.y = clone(s0.ky); o.pivot = s0.pivot && s0.pivot.slice();
      setPivot(o, [lx, ly]);
    } else if (d.mode === 'move') {
      const [ddx, ddy] = MT.apv(d.bi, ux - d.ux, uy - d.uy);
      let nx = d.x0 + ddx, ny = d.y0 + ddy;
      if (guides) { nx = Math.round(nx * 4) / 4; ny = Math.round(ny * 4) / 4; }
      setProp(o, 'x', round(nx, 2)); setProp(o, 'y', round(ny, 2));
    } else if (d.mode === 'corner') {
      const f = Math.hypot(ux - d.ax, uy - d.ay) / (Math.hypot(d.ux - d.ax, d.uy - d.ay) || 1);
      setProp(o, 'scale', round(Math.max(0.05, d.s0 * f), 3));
    } else if (d.mode === 'sx' || d.mode === 'sy') {
      const ax = d.mode === 'sx' ? d.axX : d.axY;
      const p0 = (d.ux - d.ax) * ax[0] + (d.uy - d.ay) * ax[1], p1 = (ux - d.ax) * ax[0] + (uy - d.ay) * ax[1];
      let v = (d.mode === 'sx' ? d.sx0 : d.sy0) * (p1 / (p0 || 1e-6));
      if (Math.abs(v) < 0.05) v = 0.05 * (Math.sign(v) || 1);
      setProp(o, d.mode, round(v, 3));
    } else if (d.mode === 'rot') {
      let deg = d.r0 + d.flip * (Math.atan2(uy - d.ay, ux - d.ax) - Math.atan2(d.uy - d.ay, d.ux - d.ax)) * 180 / Math.PI;
      const snapTo = Math.round(deg / 15) * 15;
      if (Math.abs(deg - snapTo) < 4) deg = snapTo;
      setProp(o, 'rotation', round(deg, 1));
    }
    dirty = true; refreshSheetValues();
  });
  const endDrag = e => {
    if (e && e.pointerId != null) TP.delete(e.pointerId);
    if (orbit3 || pinch3) { const ch = (orbit3 && orbit3.moved) || pinch3; orbit3 = null; if (TP.size < 2) pinch3 = null; if (ch) commit(); return; }
    if (drw) { drawUp(); return; } if (sdrag && sdrag.moved) { commit(); renderTimeline(); } sdrag = null;
  };
  stage.addEventListener('wheel', e => { if (!has3D()) return; e.preventDefault(); setProp(cam3(), 'dist', round(Math.max(0.2, Math.min(6, c3('dist') * Math.exp(e.deltaY * 0.0012))), 3)); dirty = true; commitSoon(); refreshSheetValues(); }, { passive: false });
  stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('dblclick', () => { if (selObj()) openSheet('edit'); });

  function setProp(o, p, v) {
    const k = o.keys[p];
    if (k && k.length) {
      const t = round(time, 2);
      const ex = k.find(q => Math.abs(q.t - t) < 0.026);
      if (ex) ex.v = v; else { k.push({ t, v }); k.sort((a, b) => a.t - b.t); }
    } else o[p] = v;
  }
  function keyHere(o) { return Object.values(o.keys || {}).some(k => k.some(q => Math.abs(q.t - time) < 0.026)); }
  function toggleAllKeys() {
    const o = selObj(); if (!o) return;
    const t = round(time, 2);
    if (keyHere(o)) {
      for (const p of Object.keys(o.keys)) { o.keys[p] = o.keys[p].filter(q => Math.abs(q.t - t) >= 0.026); if (!o.keys[p].length) delete o.keys[p]; }
      toast('Keyframe removed at ' + fmtT(t));
    } else {
      for (const p of A.KEYABLE) { const k = o.keys[p] || (o.keys[p] = []); k.push({ t, v: A.keyVal(o, p, time) }); k.sort((a, b) => a.t - b.t); }
      toast('Keyframe added. Move the playhead, then drag or edit the object.');
    }
    commit(); renderTimeline(); dirty = true; refreshSheet();
  }
  function toggleKey(o, p) {
    const t = round(time, 2);
    const k = o.keys[p] || (o.keys[p] = []);
    const i = k.findIndex(q => Math.abs(q.t - t) < 0.026);
    if (i >= 0) { k.splice(i, 1); if (!k.length) delete o.keys[p]; }
    else { k.push({ t, v: A.keyVal(o, p, time) }); k.sort((a, b) => a.t - b.t); }
    commit(); refreshSheet(); renderTimeline(); dirty = true;
  }

  // ---------- add catalogue ----------
  const CATS = {
    text: { label: 'Text', icon: 'T', items: [['title', {}, 'Title card', 'H'], ['text', {}, 'Text', 'T'], ['math', {}, 'Maths', '∑'], ['math', { props: { tex: 'f(x) &= x^2 + 2x + 1 \\\\ &= (x+1)^2' } }, 'Working', '≡'], ['text', { props: { text: 'Note', size: 0.45, font: 'sans', color: 'GREY' } }, 'Caption', 'a'],
      ['textpath', {}, 'Curved text', '⌒'], ['textpath', { props: { shape: 'circle', text: 'ROUND AND ROUND • ', font: 'sans', size: 0.42 }, loop: 'spin' }, 'Text ring', '◌'], ['textpath', { props: { shape: 'wave', text: 'Making waves' } }, 'Wavy text', '〰'],
      ['math', { name: 'Live number', props: { tex: 'a = [[a:1]]' } }, 'Live number', '#']] },
    shapes: { label: 'Shapes', icon: '◯', items: [['shape', { props: { shape: 'circle' } }, 'Circle', '◯'], ['shape', { props: { shape: 'square', fo: 0.3 } }, 'Square', '□'], ['shape', { props: { shape: 'rect', color: 'WHITE', fill: 'WHITE', fo: 0 } }, 'Rectangle', '▭'],
      ['shape', { props: { shape: 'polygon', n: 6, color: 'TEAL', fill: 'TEAL', fo: 0.2 } }, 'Polygon', '⬡'], ['shape', { props: { shape: 'star', n: 5, color: 'GOLD', fill: 'GOLD', fo: 0.6 } }, 'Star', '☆'], ['shape', { props: { shape: 'ellipse', color: 'GREEN', fill: 'GREEN', fo: 0.2 } }, 'Ellipse', '⬭'],
      ['shape', { props: { shape: 'arrow', color: 'WHITE' } }, 'Arrow', '→'], ['shape', { props: { shape: 'darrow', color: 'WHITE' } }, 'Both ways', '↔'], ['shape', { props: { shape: 'line', color: 'WHITE' } }, 'Line', '—'],
      ['shape', { props: { shape: 'dot', color: 'YELLOW' } }, 'Dot', '•'], ['shape', { props: { shape: 'arc', color: 'YELLOW' } }, 'Arc', '◠'], ['shape', { props: { shape: 'brace', w: 3, color: 'WHITE' } }, 'Brace', '⏟'],
      ['geom', {}, 'Triangle', '△'], ['geom', { props: { pts: '-2,-1.2  2,-1.2  -2,1.6', labels: 'A B C', sides: 'a b c' } }, 'Right triangle', '◺']] },
    graph: { label: 'Graph', icon: '∿', items: [['graph', {}, 'sin & cos', '∿'], ['graph', { props: { f1: 'x^2/2', l1: 'y = \\tfrac{x^2}{2}', f2: '', xmin: -4, xmax: 4, ymin: -1, ymax: 6, area: true, a: 0, b: 2 } }, 'Area', '∫'],
      ['graph', { props: { f1: 'exp(x)', l1: 'e^x', f2: 'ln(x)', l2: '\\ln x', xmin: -3, xmax: 5, ymin: -3, ymax: 5, grid: true } }, 'Exp & log', 'eˣ'], ['graph', { props: { f1: '1/(1+exp(-x))', l1: '\\sigma(x)', f2: '', xmin: -6, xmax: 6, ymin: -0.2, ymax: 1.2, tracer: true } }, 'Sigmoid', 'σ'],
      ['graph', { props: { f1: '', f2: '', l1: '', xmin: -5, xmax: 5, ymin: -3, ymax: 3, grid: true } }, 'Empty axes', '┼']] },
    logic: { label: 'Logic', icon: '∀', items: [['venn', {}, 'Venn 2', '◎'], ['venn', { props: { n: 3, shade: '(A ∩ B) ∪ C' } }, 'Venn 3', '⊛'], ['truth', {}, 'Truth table', '⊤'], ['truth', { props: { formula: '~(P & Q) <-> ~P | ~Q' } }, 'De Morgan', '¬'],
      ['math', { props: { tex: '\\forall x \\, (P(x) \\to Q(x))' } }, 'Quantifier', '∀'], ['math', { props: { tex: 'A \\cup B = \\{ x \\mid x \\in A \\lor x \\in B \\}' } }, 'Set builder', '∪'],
      ['math', { props: { tex: '\\Box P \\to \\Diamond P' } }, 'Modal', '□'], ['math', { props: { tex: 'P \\to Q,\\; P \\vdash Q' } }, 'Sequent', '⊢']] },
    nodes: { label: 'Nodes', icon: '⋰', items: [['net', {}, 'Ring', '◯'], ['net', { props: { layout: 'complete', n: 6, motion: 'breathe' } }, 'Complete K₆', '✳'], ['net', { props: { layout: 'star', n: 8, nodec: 'GOLD' } }, 'Star', '✶'],
      ['net', { props: { layout: 'tree', n: 15, motion: 'none', nodec: 'GREEN', node: 0.14 } }, 'Tree', '⊥'], ['net', { props: { layout: 'grid', n: 16, motion: 'wave', node: 0.12, nodec: 'TEAL' } }, 'Grid', '#'],
      ['net', { props: { layout: 'random', n: 12, nodec: 'PINK', node: 0.13 } }, 'Random', '⁘'], ['net', { props: { layout: 'petersen', nodec: 'PURPLE', motion: 'rotate' } }, 'Petersen', '⬠'],
      ['net', { props: { layout: 'ring', n: 6, directed: true, curved: true, labels: 'abc', nodec: 'YELLOW', motion: 'none' } }, 'Directed', '↻'], ['net', { props: { layout: 'wheel', n: 9, labels: 'num', node: 0.2, motion: 'jitter', speed: 0.5 } }, 'Wheel', '⊛']] },
    geometry: { label: 'Geometry', icon: '∞', items: [['curve', {}, 'Lissajous', '∞'], ['curve', { props: { shape: 'rose', k: 5, color: 'PINK' } }, 'Rose', '✿'], ['curve', { props: { shape: 'spiral', color: 'GOLD' } }, 'Spiral', '@'],
      ['curve', { props: { shape: 'heart', color: 'RED' } }, 'Heart', '♡'], ['curve', { props: { shape: 'butterfly', color: 'PURPLE' } }, 'Butterfly', 'ʚɞ'], ['curve', { props: { shape: 'spiro', color: 'GREEN' } }, 'Spirograph', '❁'],
      ['curve', { props: { shape: 'epicycloid', k: 4, color: 'YELLOW' } }, 'Epicycloid', '✧'], ['curve', { props: { shape: 'custom' } }, 'x(t), y(t)', 'ƒ'],
      ['fractal', {}, 'Koch snowflake', '❄'], ['fractal', { props: { kind: 'sierpinski', depth: 5, color: 'YELLOW' } }, 'Sierpiński', '△'], ['fractal', { props: { kind: 'tree', depth: 8, color: 'GREEN' } }, 'Fractal tree', 'Y'],
      ['fractal', { props: { kind: 'dragon', depth: 8, color: 'ORANGE' } }, 'Dragon', '⌇'], ['fractal', { props: { kind: 'hilbert', depth: 4, color: 'TEAL' } }, 'Hilbert', '⊓'], ['fractal', { props: { kind: 'carpet', depth: 3, color: 'PURPLE' } }, 'Carpet', '▦']] },
    solids: { label: '3D', icon: '⬢', items: [['solid', { props: { shape: 'cube' } }, 'Cube', '◫'], ['solid', { props: { shape: 'tetrahedron', color: 'GOLD' } }, 'Tetrahedron', '△'], ['solid', { props: { shape: 'octahedron', color: 'GREEN' } }, 'Octahedron', '◇'],
      ['solid', {}, 'Icosahedron', '⬡'], ['solid', { props: { shape: 'dodecahedron', color: 'PURPLE' } }, 'Dodecahedron', '⬠'], ['solid', { props: { shape: 'sphere', style: 'wire', color: 'BLUE', tilt: 10 } }, 'Sphere', '◍'],
      ['solid', { props: { shape: 'torus', color: 'PINK', pitch: 55 } }, 'Torus', '◎'], ['solid', { props: { shape: 'cylinder', color: 'TEAL' } }, 'Cylinder', '▯'], ['solid', { props: { shape: 'cone', color: 'ORANGE' } }, 'Cone', '▲'],
      ['solid', { props: { shape: 'pyramid', color: 'YELLOW' } }, 'Pyramid', '⏶'], ['solid', { props: { shape: 'prism', color: 'RED' } }, 'Prism', '⧋']] },
    stickers: { label: 'Stickers', icon: '★', items: ['star', 'heart', 'check', 'cross', 'bulb', 'speech', 'thought', 'sparkle', 'arrow', 'question', 'exclaim', 'pin', 'brain'].map(k => ['sticker', { props: { kind: k } }, k[0].toUpperCase() + k.slice(1), { star: '★', heart: '♥', check: '✓', cross: '✕', bulb: '◍', speech: '❝', thought: '◌', sparkle: '✦', arrow: '➜', question: '?', exclaim: '!', pin: '⌖', brain: '❦' }[k]]) }
  };
  function addObj(type, over) {
    if (playing) setPlaying(false);
    const o = makeObj(type, clone(over || {}));
    const m = /\[\[\s*([A-Za-z]\w*)/.exec(JSON.stringify(o.props));
    if (m && !A.RESERVED.includes(m[1])) ensureVar(m[1]);
    if (o.end > scene.duration) scene.duration = Math.ceil(o.end);
    scene.objects.push(o);
    commit(); sel = o.id; renderTools(); renderTimeline(); dirty = true;
    openSheet('edit');
  }

  // ---------- toolbar ----------
  function tool(icon, label, fn, cls, id) { return h('button', { type: 'button', class: 'tool ' + (cls || ''), onclick: fn, id: id || null }, h('span', { class: 'ti' }, icon), h('span', { class: 'tlab' }, label)); }
  function renderTools() {
    const bar = $('#tools'); bar.textContent = '';
    if (drw) { renderDrawTools(bar); return; }
    const o = selObj();
    if (!narrow()) {
      for (const d of DOCK) bar.append(tool(d.icon, d.label, () => dockAction(d), (trayId === d.id || (d.panel && sheetKind === d.panel)) ? 'active' : ''));
      return;
    }
    if (!o) {
      bar.append(tool('✒', 'Draw', () => startDraw()));
      for (const [k, c] of Object.entries(CATS)) bar.append(tool(c.icon, c.label, () => openSheet('add:' + k), sheetKind === 'add:' + k ? 'active' : ''));
      bar.append(tool('▨', 'Media', () => openSheet('media'), sheetKind === 'media' ? 'active' : ''));
      bar.append(tool('❖', 'Library', () => openSheet('library'), sheetKind === 'library' ? 'active' : ''));
      bar.append(tool('#', 'Values', () => openSheet('values'), sheetKind === 'values' ? 'active' : ''));
      bar.append(tool('⌖', 'Camera', () => openSheet('camera'), sheetKind === 'camera' ? 'active' : ''));
      bar.append(tool('♪', 'Sound', () => scene.audio ? openSheet('audio') : importSound(), sheetKind === 'audio' ? 'active' : ''));
      bar.append(tool('▣', 'Scene', () => openSheet('scene'), sheetKind === 'scene' ? 'active' : ''));
      bar.append(tool('</>', 'Code', () => openSheet('code'), sheetKind === 'code' ? 'active' : ''));
    } else {
      bar.append(tool('‹', 'Done', () => select(null), 'back'));
      bar.append(tool('✎', 'Edit', () => openSheet('edit'), sheetKind === 'edit' ? 'active' : ''));
      if (o.type === 'vector') bar.append(tool('✒', 'Edit drawing', () => startDraw(o)));
      bar.append(tool('◐', 'Animate', () => { if (animTab === 'effects') animTab = 'in'; openSheet('animate'); }, sheetKind === 'animate' && animTab !== 'effects' ? 'active' : ''));
      bar.append(tool('✺', 'Effects', () => { animTab = 'effects'; openSheet('animate'); }, sheetKind === 'animate' && animTab === 'effects' ? 'active' : ''));
      bar.append(tool('☀', 'Style', () => openSheet('style'), sheetKind === 'style' ? 'active' : ''));
      bar.append(tool('◆', 'Keyframe', toggleAllKeys, keyHere(o) ? 'on' : '', 'keyBtn'));
      bar.append(tool('⤨', 'Position', () => openSheet('position'), sheetKind === 'position' ? 'active' : ''));
      bar.append(tool('⛓', 'Rig', () => openSheet('rig'), sheetKind === 'rig' ? 'active' : ''));
      bar.append(tool('❖', 'Save', () => saveToLibrary(o)));
      bar.append(tool('⧉', 'Copy', dup));
      bar.append(tool('⇡', 'Forward', () => move(1)));
      bar.append(tool('⇣', 'Back', () => move(-1)));
      bar.append(tool('⌫', 'Delete', del, 'danger'));
    }
  }

  // ---------- sheets ----------
  function openSheet(kind) {
    if (kind && kind.startsWith('add:') && !narrow()) { const id = { graph: 'graphs', solids: '3d' }[kind.slice(4)] || kind.slice(4); if (DOCK.some(d => d.id === id && d.items)) { openTray(id); return; } }
    sheetKind = kind;
    document.body.classList.add('sheet-open');
    $('#sheet').hidden = false;
    renderSheet(); renderTools();
    if (!narrow()) sizeStage();
  }
  function closeSheet() {
    if (!narrow() && scene && !drw) { const d = defaultPanel(); if (sheetKind !== d) { openSheet(d); return; } }
    sheetKind = null;
    document.body.classList.remove('sheet-open');
    $('#sheet').hidden = true;
    if (scene) { renderTools(); if (!narrow()) sizeStage(); }
  }
  function refreshSheet() { if (sheetKind) renderSheet(); }
  function renderSheet() {
    const body = $('#sheetBody'); const title = $('#sheetTitle');
    previews.clear();
    const keepScroll = body.scrollTop;
    body.textContent = '';
    const k = sheetKind || '';
    const o = selObj();
    if (!narrow() && !k.startsWith('add:') && k !== 'drawstyle' && k !== 'ease') panelTabs(body);
    if (k === 'layers') { title.textContent = 'Layers'; layersSheet(body); body.scrollTop = keepScroll; return; }
    if (k.startsWith('add:')) {
      const c = CATS[k.slice(4)];
      title.textContent = 'Add ' + c.label.toLowerCase();
      const g = h('div', { class: 'addgrid' });
      for (const [type, over, label, icon] of c.items) g.append(h('button', { type: 'button', class: 'addbtn', onclick: () => addObj(type, over) }, h('span', { class: 'ic' }, icon), h('span', {}, label)));
      body.append(g, h('p', { class: 'muted small' }, 'It’s added at the playhead (' + fmtT(time) + ') for 4 seconds. Drag it on the preview to place it.'));
    } else if (k === 'scene') { title.textContent = 'Scene'; sceneSheet(body); }
    else if (k === 'drawstyle') { title.textContent = 'Line & fill'; drawStyleSheet(body); }
    else if (k === 'media') { title.textContent = 'Images & sound'; mediaSheet(body); }
    else if (k === 'library') { title.textContent = 'Your library'; librarySheet(body); }
    else if (k === 'values') { title.textContent = 'Live values'; valuesSheet(body); }
    else if (k === 'camera') { title.textContent = 'Camera'; cameraSheet(body); }
    else if (k === 'audio') { title.textContent = 'Sound & markers'; audioSheet(body); }
    else if (k === 'code') { title.textContent = 'Manim code'; codeSheet(body); }
    else if (k === 'ease') { title.textContent = 'Easing curve'; easeSheet(body); }
    else if (!o) { closeSheet(); return; }
    else if (k === 'edit') { title.textContent = o.name; editSheet(body, o); }
    else if (k === 'position') { title.textContent = 'Position & keyframes'; positionSheet(body, o); }
    else if (k === 'animate') { title.textContent = 'Animate'; animateSheet(body, o); }
    else if (k === 'style') { title.textContent = 'Style'; styleSheet(body, o); }
    else if (k === 'rig') { title.textContent = 'Rig, group & follow'; rigSheet(body, o); }
    body.scrollTop = keepScroll;
  }
  $('#sheetClose').addEventListener('click', closeSheet);

  // form helpers
  function colorField(val, onset, allowBlank) {
    const wrap = h('div', { class: 'swatches' });
    const cur = A.color(val) || '';
    const inp = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(cur) ? cur : '#ffffff', title: 'Custom colour', 'aria-label': 'Custom colour' });
    inp.addEventListener('input', () => { onset(inp.value.toUpperCase()); mark(inp.value.toUpperCase()); });
    function mark(v) { wrap.querySelectorAll('.sw').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v || (v && A.color(b.dataset.v) === A.color(v)))); }
    if (allowBlank) wrap.append(h('button', { type: 'button', class: 'sw blank', 'data-v': '', title: 'Default', onclick: () => { onset(''); mark(''); } }, '∅'));
    for (const s of SWATCH) wrap.append(h('button', { type: 'button', class: 'sw', 'data-v': s, title: s.toLowerCase(), 'aria-label': s.toLowerCase(), style: 'background:' + A.color(s), onclick: () => { onset(s); mark(s); } }));
    wrap.append(inp);
    mark(val || '');
    return wrap;
  }
  const field = (label, control) => h('label', { class: 'fld' }, h('span', { class: 'fl' }, label), control);
  function numInput(v, step, on, id) {
    const i = h('input', { type: 'number', step: step || 0.1, value: v, inputmode: 'decimal', id: id || null });
    i.addEventListener('input', () => { const n = parseFloat(i.value); if (isFinite(n)) on(n); });
    return i;
  }
  function selectInput(opts, v, on) {
    const s = h('select', { onchange: () => on(s.value) }, opts.map(([k, l]) => h('option', { value: k }, l)));
    s.value = v; return s;
  }
  function stepper(v, step, on) {
    const i = numInput(v, step, on);
    const bump = d => { const n = round((parseFloat(i.value) || 0) + d, 3); i.value = n; on(n); };
    return h('div', { class: 'stepper' }, h('button', { type: 'button', 'aria-label': 'Decrease', onclick: () => bump(-step) }, '−'), i, h('button', { type: 'button', 'aria-label': 'Increase', onclick: () => bump(step) }, '+'));
  }
  const group = (title, ...kids) => h('section', { class: 'grp' }, title ? h('h3', {}, title) : null, ...kids);

  function editSheet(body, o) {
    const T = A.TYPES[o.type];
    const P = Object.assign({}, T.defaults, o.props);
    const changed = tl => { dirty = true; commitSoon(); if (tl) renderTimeline(); };
    const name = h('input', { type: 'text', value: o.name, 'aria-label': 'Name' });
    name.addEventListener('input', () => { o.name = name.value; $('#sheetTitle').textContent = o.name; changed(true); });
    body.append(field('Name', name));
    const err = h('div', { class: 'err', hidden: true });
    function validate() {
      let msg = '';
      try {
        if (o.type === 'graph') { A.compileFn(o.props.f1 ?? P.f1); A.compileFn(o.props.f2 ?? P.f2); }
        if (o.type === 'venn') A.parseSet(o.props.shade ?? P.shade);
        if (o.type === 'truth') A.parseLogic(o.props.formula ?? P.formula);
      } catch (e) { msg = e.message; }
      err.hidden = !msg; err.textContent = msg;
    }
    const conditional = T.fields.some(f => f[4]);
    for (const [key, label, kind, opt, when] of T.fields) {
      if (when && !when(P)) continue;
      const set = v => { o.props[key] = v; changed(); if (conditional) setTimeout(refreshSheetIfNotTyping, 0); };
      let c;
      if (kind === 'textarea' || kind === 'text') {
        c = h(kind === 'textarea' ? 'textarea' : 'input', kind === 'textarea' ? { rows: 2, spellcheck: 'false', autocapitalize: 'off' } : { type: 'text', spellcheck: 'false', autocapitalize: 'off' });
        c.value = P[key];
        c.addEventListener('input', () => { o.props[key] = c.value; changed(); validate(); });
        if (key === 'tex' || (o.type === 'text' && key === 'text')) { body.append(field(label, c), texKeys(c, v => { o.props[key] = v; changed(); })); continue; }
      }
      else if (kind === 'num') c = stepper(P[key], opt, set);
      else if (kind === 'select') c = selectInput(opt.map(x => [String(x[0]), x[1]]), String(P[key]), v => set(isNaN(+v) || v === '' ? v : +v));
      else if (kind === 'bool') { c = h('input', { type: 'checkbox' }); c.checked = !!P[key]; c.addEventListener('change', () => set(c.checked)); body.append(h('label', { class: 'chk' }, c, h('span', {}, label))); continue; }
      else if (kind === 'color') c = colorField(P[key], set, key === 'fill' && o.type === 'sticker');
      body.append(field(label, c));
    }
    body.append(err); validate();
    if (o.type === 'math') body.append(h('p', { class: 'muted small' }, 'LaTeX: \\frac{a}{b}, \\sqrt{x}, x^2, x_i, \\sum_{n=1}^{\\infty}, \\int_a^b, \\alpha … \\omega, \\forall \\exists \\land \\lor \\neg \\to \\vdash \\models, \\in \\cup \\cap \\subseteq \\emptyset, \\mathbb{R}, \\color{BLUE}{x}, \\text{words}. Use \\\\ for a new line and & to line equations up.'));
    if (o.type === 'text') body.append(h('p', { class: 'muted small' }, 'Put maths between dollar signs: The area is $\\pi r^2$.'));
    if (o.props.logosId || o.props.calcId) body.append(h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: () => editInDoc(o) }, o.props.calcId ? '▦ Edit in Calsheet' : '¶ Edit in Logos'), o.props.calcRange ? h('span', { class: 'muted small' }, 'From ' + o.props.calcRange) : null));
    if (o.type === 'table') body.append(h('p', { class: 'muted small' }, 'One row per line, commas between cells. Put a cell in "quotes" if it contains a comma.'));
    if (o.type === 'sprite' && (o.props.artId || o.props.pxId)) body.append(h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: () => o.props.artId ? openStudio('art', { proj: o.props.artId }, o) : openStudio('px', { proj: o.props.pxId }, o) }, o.props.artId ? '🖌 Edit in Tabula' : '▦ Edit in 8-Bit')));
    if (is3D(o)) body.append(threeDGroup(o));
    else if (o.type !== 'group') { const pg = pinGroup(o); if (pg) body.append(pg); }
    if (o.type === 'bio2d') body.append(handoverGroup(o));
    if (o.type === 'chart') body.append(h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: async () => { const f = await pickFile('.csv,.tsv,.txt,text/csv'); if (!f) return; o.props.csv = (await f.text()).slice(0, 20000); if (!o.props.title || o.props.title === 'Example data') o.props.title = f.name.replace(/\.[^.]+$/, ''); commit(); dirty = true; refreshSheet(); } }, '⤒ Import a CSV file…')),
      h('p', { class: 'muted small' }, 'Bar: label, value(s). Line/scatter: x, y(s). Forest: label, estimate, lower, upper, weight. A row called Pooled or Overall gets the summary diamond.'));
    body.append(group('On screen', h('div', { class: 'two' },
      field('From (s)', numInput(o.start, 0.1, v => { o.start = Math.max(0, Math.min(v, o.end - 0.1)); changed(true); })),
      field('To (s)', numInput(o.end, 0.1, v => { o.end = Math.max(v, o.start + 0.1); if (o.end > scene.duration) scene.duration = Math.ceil(o.end); changed(true); })))));
  }
  function refreshSheetIfNotTyping() { const a = document.activeElement; if (a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type === 'text'))) return; refreshSheet(); }
  // quick-insert keys for LaTeX on a phone keyboard
  function texKeys(ta, onv) {
    const keys = [['\\', '\\'], ['{ }', '{}', 1], ['^', '^{}', 1], ['_', '_{}', 1], ['frac', '\\frac{}{}', 6], ['√', '\\sqrt{}', 1], ['∑', '\\sum_{}^{}', 4], ['∫', '\\int_{}^{}', 4], ['α', '\\alpha '], ['π', '\\pi '], ['θ', '\\theta '],
      ['∀', '\\forall '], ['∃', '\\exists '], ['∧', '\\land '], ['∨', '\\lor '], ['¬', '\\neg '], ['→', '\\to '], ['↔', '\\leftrightarrow '], ['⊢', '\\vdash '], ['∈', '\\in '], ['∪', '\\cup '], ['∩', '\\cap '], ['⊆', '\\subseteq '], ['∅', '\\emptyset '], ['ℝ', '\\mathbb{R}'], ['≤', '\\leq '], ['≠', '\\neq '], ['×', '\\times '], ['$', '$$', 1]];
    const bar = h('div', { class: 'texkeys' });
    for (const [lab, ins, back] of keys) bar.append(h('button', { type: 'button', onpointerdown: e => e.preventDefault(), onclick: () => {
      const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a;
      ta.value = ta.value.slice(0, a) + ins + ta.value.slice(b);
      const p = a + ins.length - (back || 0);
      ta.focus(); ta.setSelectionRange(p, p); onv(ta.value);
    } }, lab));
    return bar;
  }
  function positionSheet(body, o) {
    const props = [['x', 'Across (x)', 0.25], ['y', 'Up (y)', 0.25], ['scale', 'Size', 0.1], ['sx', 'Stretch wide', 0.1], ['sy', 'Stretch tall', 0.1], ['rotation', 'Rotation (°)', 15], ['opacity', 'Opacity', 0.1]];
    body.append(h('p', { class: 'muted small' }, 'On the preview: drag a corner to resize, a side bar to stretch one way (drag past the middle to mirror it), and the round handle to rotate (it clicks to every 15°).'));
    body.append(h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: () => { for (const [p, v] of [['scale', 1], ['sx', 1], ['sy', 1], ['rotation', 0]]) setProp(o, p, v); commit(); refreshSheet(); dirty = true; } }, 'Reset size & rotation'),
      h('button', { type: 'button', class: 'btn', onclick: () => { setProp(o, 'sx', -A.keyVal(o, 'sx', time)); commit(); refreshSheet(); dirty = true; } }, '⇋ Mirror'),
      h('button', { type: 'button', class: 'btn', onclick: () => { setProp(o, 'sy', -A.keyVal(o, 'sy', time)); commit(); refreshSheet(); dirty = true; } }, '⇵ Flip')));
    for (const [p, label, step] of props) {
      const k = o.keys[p] || [];
      const here = k.some(q => Math.abs(q.t - time) < 0.026);
      const kb = h('button', { type: 'button', class: 'keybtn' + (here ? ' on' : k.length ? ' some' : ''), title: here ? 'Remove keyframe here' : 'Add keyframe here', 'aria-label': (here ? 'Remove ' : 'Add ') + label + ' keyframe', onclick: () => toggleKey(o, p) }, here ? '◆' : '◇');
      const st = stepper(round(A.keyVal(o, p, time), 2), step, v => { setProp(o, p, v); dirty = true; commitSoon(); if (k.length) renderTimelineSoon(); });
      st.querySelector('input').dataset.prop = p;
      body.append(h('div', { class: 'kfrow' }, h('span', { class: 'fl' }, label), st, kb));
    }
    const kt = [...new Set(Object.values(o.keys).flat().map(q => q.t))].sort((a, b) => a - b);
    if (kt.length) {
      body.append(h('div', { class: 'kchips' }, kt.map(t => h('span', { class: 'kpair' }, h('button', { type: 'button', class: 'chip', onclick: () => setTime(t) }, '◆ ' + fmtT(t)),
          h('button', { type: 'button', class: 'chip ease', title: 'Easing into this keyframe', 'aria-label': 'Easing into the keyframe at ' + fmtT(t), onclick: () => openEase({ kind: 'key', id: o.id, t }) }, '⌇'))),
        h('button', { type: 'button', class: 'chip quiet', onclick: () => { o.keys = {}; commit(); refreshSheet(); renderTimeline(); dirty = true; } }, 'Clear all')));
      body.append(h('p', { class: 'muted small' }, 'A property with keyframes animates between them. Changing it, or dragging the object, sets a keyframe at the playhead.'));
    } else body.append(h('p', { class: 'muted small' }, 'To animate movement: tap ◆ Keyframe in the toolbar, move the playhead along the timeline, then drag the object to its new place. Tap ◇ here to keyframe one property only.'));
    const drv = o.drive || {};
    body.append(group('Drive with a formula',
      h('p', { class: 'muted small' }, 'Uses your live values (Values), t = seconds and u = 0 → 1 through the clip. For example 2*sin(3t), a*45 or 1 + u. Leave blank to use keyframes.'),
      ...[['x', 'Across (x)'], ['y', 'Up (y)'], ['rotation', 'Rotation (°)'], ['scale', 'Size'], ['opacity', 'Opacity']].map(([p, l]) => {
        const i = h('input', { type: 'text', value: drv[p] || '', placeholder: '—', spellcheck: 'false', autocapitalize: 'off', 'aria-label': l + ' formula' });
        const out = h('span', { class: 'muted small fval' });
        const show = () => { const v = (o.drive || {})[p]; if (!v) { out.textContent = ''; return; } const r = A.evalExpr(v, Object.assign(A.varsAt(scene, time), { t: time, u: Math.max(0, Math.min(1, (time - o.start) / (o.end - o.start || 1))) })); out.textContent = isFinite(r) ? '= ' + round(r, 3) : '?'; out.classList.toggle('bad', !isFinite(r)); };
        i.addEventListener('input', () => { const v = i.value.trim(); if (!o.drive) o.drive = {}; if (v) o.drive[p] = v; else delete o.drive[p]; if (!Object.keys(o.drive).length) delete o.drive; show(); dirty = true; commitSoon(); });
        show();
        return h('div', { class: 'kfrow' }, h('span', { class: 'fl' }, l), i, out);
      })));
    body.append(h('label', { class: 'chk' }, (() => { const c = h('input', { type: 'checkbox' }); c.checked = guides; c.addEventListener('change', () => { guides = c.checked; $('#guides').setAttribute('aria-pressed', guides); dirty = true; }); return c; })(), h('span', {}, 'Show the coordinate grid and snap to quarter units')));
  }
  const RATES = [['smooth', 'Smooth'], ['linear', 'Linear'], ['easeIn', 'Ease in'], ['easeOut', 'Ease out'], ['backOut', 'Overshoot'], ['bounce', 'Bounce'], ['elastic', 'Elastic'], ['spring', 'Spring'], ['gravity', 'Gravity'], ['snap', 'Snap']];
  // ---------- animation presets with live preview tiles ----------
  let animTab = 'in';
  const previews = new Map();
  let pvRaf = 0, pvLast = 0;
  function miniScene(o, tab, k) {
    const m = clone(o);
    Object.assign(m, { id: 'pv', x: 0, y: 0, keys: {}, emph: [], loop: 'none', rotation: 0, opacity: 1, sx: 1, sy: 1, scale: 1 });
    delete m.parent; delete m.attach; delete m.path; delete m.drive;
    const kids = descendants(o).map(c => Object.assign(clone(c), { start: -10, end: 1e6, anIn: { type: 'appear', dur: 0 }, anOut: { type: 'none', dur: 0 }, emph: [], parent: c.parent === o.id ? 'pv' : c.parent }));
    if (o.type === 'group') { const b = o._hit ? o._hit.bb : [-2, -2, 2, 2]; const bw = (b[2] - b[0]) || 1, bh = (b[3] - b[1]) || 1; m.scale = Math.min(8.4 / bw, 5.2 / bh, 2); }
    else { const b = A.build(m), bw = (b.bb[2] - b.bb[0]) || 1, bh = (b.bb[3] - b.bb[1]) || 1; m.scale = Math.min(8.4 / bw, 5.2 / bh, 2.5); }
    let cycle = 2;
    if (tab === 'in') Object.assign(m, { start: 0, end: 999, anIn: { type: k, dur: 1, rate: k === 'write' ? 'linear' : 'smooth' }, anOut: { type: 'none', dur: 0 } });
    else if (tab === 'out') { Object.assign(m, { start: -10, end: 1.3, anIn: { type: 'appear', dur: 0 }, anOut: { type: MORPH(k) ? 'fadeout' : k, dur: 1 } }); cycle = 2.2; }
    else if (tab === 'loop') Object.assign(m, { start: 0, end: 1e6, anIn: { type: 'appear', dur: 0 }, anOut: { type: 'none', dur: 0 }, loop: k });
    else { Object.assign(m, { start: -10, end: 1e6, anIn: { type: 'appear', dur: 0 }, anOut: { type: 'none', dur: 0 }, emph: [{ type: k, t: 0.25, dur: 1.2 }] }); cycle = 1.9; }
    return { scene: { bg: '#000', duration: 1e6, objects: [m, ...kids], vars: scene.vars }, cycle, tab };
  }
  function pvLoop(now) {
    pvRaf = 0;
    if (!previews.size || sheetKind !== 'animate') return;
    if (now - pvLast > 33) {
      pvLast = now;
      const tt = now / 1000, vh = innerHeight;
      for (const [c, d] of previews) {
        if (!c.isConnected) { previews.delete(c); continue; }
        const r = c.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh) continue;
        const t = d.tab === 'loop' ? tt : tt % d.cycle;
        A.render(c.getContext('2d'), d.scene, t, c.width, c.height);
      }
    }
    pvRaf = requestAnimationFrame(pvLoop);
  }
  function animateSheet(body, o) {
    const changed = tl => { dirty = true; commitSoon(); if (tl) renderTimeline(); };
    const rates = RATES.concat(String(o.anIn.rate).startsWith('cb:') || String(o.anOut.rate).startsWith('cb:') ? [['cb', 'Custom curve']] : []);
    const rateSel = (an, which) => h('div', { class: 'row tight' }, selectInput(rates, String(an.rate || 'smooth').startsWith('cb:') ? 'cb' : (an.rate || 'smooth'), v => { if (v !== 'cb') { an.rate = v; changed(); } }),
      h('button', { type: 'button', class: 'btn small', onclick: () => openEase({ kind: which }) }, '⌇ Curve'));
    body.append(h('div', { class: 'tabs', role: 'tablist' }, [['in', 'In'], ['out', 'Out'], ['loop', 'Loop'], ['effects', 'Effects']].map(([k, l]) =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': animTab === k, class: 'tab' + (animTab === k ? ' on' : ''), onclick: () => { animTab = k; refreshSheet(); renderTools(); } }, l))));
    const list = animTab === 'in' ? A.ANIM_IN : animTab === 'out' ? A.ANIM_OUT : animTab === 'loop' ? A.LOOPS : A.EMPH;
    const cur = animTab === 'in' ? o.anIn.type : animTab === 'out' ? o.anOut.type : animTab === 'loop' ? (o.loop || 'none') : null;
    const others = scene.objects.filter(x => x !== o);
    const pick = k => {
      if (animTab === 'in') { o.anIn.type = k; changed(true); refreshSheet(); previewRange(o.start, o.start + Math.max(o.anIn.dur, 0.6) + 0.4); }
      else if (animTab === 'out') {
        o.anOut.type = k;
        if (MORPH(k) && !o.anOut.target) { const t = others.find(x => x.start >= o.end - 0.3) || others[0]; if (t) linkTransform(o, t); }
        changed(true); refreshSheet(); previewRange(Math.max(0, o.end - o.anOut.dur - 0.4), o.end + 0.3);
      } else if (animTab === 'loop') { o.loop = k; changed(); refreshSheet(); if (k !== 'none') previewRange(Math.max(o.start, time), Math.max(o.start, time) + 2.5); }
      else { const t = Math.max(o.start + (o.anIn.dur || 0), Math.min(time, o.end - 1.2)); o.emph.push({ type: k, t: round(t, 2), dur: 1.2 }); commit(); refreshSheet(); renderTimeline(); dirty = true; previewRange(t - 0.2, t + 1.4); }
    };
    if (animTab === 'effects') body.append(h('p', { class: 'muted small' }, 'Tap an effect to add it at the playhead. It shows as a yellow mark on the clip, which you can drag.'));
    for (const g of [...new Set(list.map(x => x[2]))]) {
      body.append(h('div', { class: 'glab' }, g));
      const grid = h('div', { class: 'animgrid' });
      for (const [k, l] of list.filter(x => x[2] === g)) {
        const c = h('canvas', { class: 'apv', width: 192, height: 128, 'aria-hidden': 'true' });
        grid.append(h('button', { type: 'button', class: 'atile' + (k === cur ? ' on' : ''), 'aria-pressed': k === cur, onclick: () => pick(k) }, c, h('span', {}, l)));
        if (!(animTab === 'out' && MORPH(k)) && k !== 'none' && k !== 'appear') previews.set(c, miniScene(o, animTab, k));
        else { const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 192, 128); x.fillStyle = '#666'; x.font = '40px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(MORPH(k) ? (k === 'transform' ? '⇢' : '⇢≡') : '∅', 96, 64); }
      }
      body.append(grid);
    }
    if (!pvRaf) pvRaf = requestAnimationFrame(pvLoop);
    if (animTab === 'in') body.append(group('Timing', h('div', { class: 'two' }, field('Seconds', stepper(o.anIn.dur, 0.25, v => { o.anIn.dur = Math.max(0.05, v); changed(true); })), field('Easing', rateSel(o.anIn, 'in')))));
    if (animTab === 'out') {
      const kids = [h('div', { class: 'two' }, field('Seconds', stepper(o.anOut.dur, 0.25, v => { o.anOut.dur = Math.max(0.05, v); changed(true); })), field('Easing', rateSel(o.anOut, 'out')))];
      if (MORPH(o.anOut.type)) {
        kids.push(field(o.anOut.type === 'transform' ? 'Transform into' : 'Match symbols into', selectInput([['', '— choose —'], ...others.map(x => [x.id, x.name])], o.anOut.target || '', v => { const t = scene.objects.find(x => x.id === v); if (t) linkTransform(o, t); else o.anOut.target = ''; changed(true); })));
        kids.push(h('p', { class: 'muted small' }, o.anOut.type === 'transform' ? 'Morphs this into the chosen object, like Manim’s Transform. That object is moved to start as this one ends.' : 'Like Manim’s TransformMatchingTex: symbols the two have in common glide to their new places, the rest fade out and in. Best between two equations.'));
      }
      body.append(group('Timing', ...kids));
    }
    if (animTab === 'effects' && (o.emph || []).length) {
      body.append(group('On this clip', ...(o.emph || []).map((e, i) => h('div', { class: 'emrow' },
        selectInput(A.EMPH.map(x => [x[0], x[1]]), e.type, v => { e.type = v; commitSoon(); renderTimeline(); dirty = true; }),
        h('label', { class: 'mini' }, 'at (s)', numInput(e.t, 0.1, v => { e.t = v; commitSoon(); renderTimeline(); dirty = true; })),
        h('label', { class: 'mini' }, 'for (s)', numInput(e.dur, 0.1, v => { e.dur = Math.max(0.1, v); commitSoon(); renderTimeline(); dirty = true; })),
        h('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Play this effect', onclick: () => previewRange(e.t - 0.2, e.t + e.dur + 0.2) }, '▶'),
        h('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Remove effect', onclick: () => { o.emph.splice(i, 1); commit(); refreshSheet(); renderTimeline(); dirty = true; } }, '✕')))));
    }
  }
  function styleSheet(body, o) {
    const set = (k, v) => { o[k] = v; dirty = true; commitSoon(); };
    const cur = o.style || {};
    const setS = (k, v) => { const s = o.style || (o.style = {}); if (v === '' || v == null || v === 'none' || v === 0) delete s[k]; else s[k] = v; if (!Object.keys(s).length) delete o.style; dirty = true; commitSoon(); };
    const chips = (opts, v, on) => h('div', { class: 'chips' }, opts.map(([k, l]) => h('button', { type: 'button', class: 'pick' + ((v || 'none') === k ? ' on' : ''), onclick: () => { on(k); refreshSheet(); } }, l)));
    body.append(group('Lines',
      field('Line style', chips([['none', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']], cur.dash, v => setS('dash', v))),
      field('Arrowheads on open lines', chips([['none', 'None'], ['end', 'End'], ['start', 'Start'], ['both', 'Both']], cur.arrow, v => setS('arrow', v)))));
    body.append(group('Gradient',
      field('Blend each colour into (∅ = no gradient)', colorField(cur.grad || '', v => setS('grad', v), true)),
      field('Direction (°, 0 = left to right)', stepper(cur.gangle || 0, 45, v => setS('gangle', v)))));
    body.append(group('Glow',
      h('p', { class: 'muted small' }, 'Glow lights the object from within. For a pulsing glow use Animate → Loop → Glow pulse, or Effects → Glow.'),
      field('Presets', h('div', { class: 'chips' }, [[0, 'None'], [0.35, 'Soft'], [0.7, 'Neon'], [1.2, 'Blazing']].map(([v, l]) =>
        h('button', { type: 'button', class: 'pick' + (Math.abs((o.glow || 0) - v) < 0.01 ? ' on' : ''), onclick: () => { set('glow', v); refreshSheet(); } }, l)))),
      field('Glow amount', stepper(o.glow || 0, 0.1, v => set('glow', Math.max(0, Math.min(1.5, v))))),
      field('Glow colour (∅ = its own colours)', colorField(o.glowColor || '', v => set('glowColor', v), true))));
    body.append(h('label', { class: 'chk' }, (() => { const c = h('input', { type: 'checkbox' }); c.checked = !!o.hidden; c.addEventListener('change', () => { o.hidden = c.checked || undefined; commit(); renderTimeline(); dirty = true; }); return c; })(),
      h('span', {}, 'Hide in the video (a faint guide here, for example a motion path)')));
  }

  // ---------- rigs, groups, graph riding and motion paths ----------
  function decompose(m) { const sx = Math.hypot(m[0], m[1]) || 1e-9; return { x: m[4], y: m[5], r: Math.atan2(m[1], m[0]), sx }; }
  // re-express an object's placement when it moves from parent space Pold to parent space Pnew (keyframes too)
  function placeUnder(o, Pold, Pnew) {
    const T = MT.mul(MT.inv(Pnew), Pold), d = decompose(T), dr = d.r * 180 / Math.PI;
    const xs = o.keys.x || [], ys = o.keys.y || [];
    if (xs.length || ys.length) {
      const times = [...new Set([...xs, ...ys].map(k => k.t))].sort((a, b) => a - b);
      const ease = (L, t) => (L.find(k => k.t === t) || {}).ease;
      const nx = [], ny = [];
      for (const t of times) { const [a, b] = MT.ap(T, A.keyVal(o, 'x', t), A.keyVal(o, 'y', t)); nx.push({ t, v: round(a, 3), ease: ease(xs, t) }); ny.push({ t, v: round(b, 3), ease: ease(ys, t) }); }
      o.keys.x = nx; o.keys.y = ny;
    } else { const [a, b] = MT.ap(T, o.x || 0, o.y || 0); o.x = round(a, 3); o.y = round(b, 3); }
    if (Math.abs(dr) > 1e-6) { if (o.keys.rotation && o.keys.rotation.length) o.keys.rotation.forEach(k => { k.v = round(k.v + dr, 2); }); else o.rotation = round((o.rotation || 0) + dr, 2); }
    if (Math.abs(d.sx - 1) > 1e-6) { if (o.keys.scale && o.keys.scale.length) o.keys.scale.forEach(k => { k.v = round(k.v * d.sx, 4); }); else o.scale = round((o.scale == null ? 1 : o.scale) * d.sx, 4); }
  }
  const worldOf = id => { const p = objById(id); return p ? A.restWorld(scene, p, time) : MT.I; };
  function reparent(o, pid) {
    const Pold = o.parent ? worldOf(o.parent) : MT.I;
    delete o.attach; delete o.path;
    if (pid) o.parent = pid; else delete o.parent;
    placeUnder(o, Pold, pid ? worldOf(pid) : MT.I);
  }
  function clearRefs(id) {
    scene.objects.forEach(x => {
      if (x.anOut && x.anOut.target === id) { x.anOut.target = ''; if (MORPH(x.anOut.type)) x.anOut.type = 'fadeout'; }
      if (x.parent === id) delete x.parent;
      if (x.attach && x.attach.to === id) delete x.attach;
      if (x.path && x.path.to === id) delete x.path;
    });
  }
  function makeGroup(list) {
    if (list.length < 2) { toast('Pick at least one other object to group with.'); return; }
    const parent = list[0].parent || null, Pp = parent ? worldOf(parent) : MT.I, Pi = MT.inv(Pp);
    let cx = 0, cy = 0;
    list.forEach(m => { const w = A.restWorld(scene, m, time), [x, y] = MT.ap(Pi, w[4], w[5]); cx += x; cy += y; });
    const g = makeObj('group', { name: 'Group ' + (scene.objects.filter(x => x.type === 'group').length + 1), start: Math.min(...list.map(m => m.start)), end: Math.max(...list.map(m => m.end)),
      x: round(cx / list.length, 2), y: round(cy / list.length, 2), anIn: { type: 'appear', dur: 0, rate: 'smooth' }, anOut: { type: 'none', dur: 0, rate: 'smooth' }, loop: 'none' });
    if (parent) g.parent = parent;
    scene.objects.splice(Math.min(...list.map(m => scene.objects.indexOf(m))), 0, g);
    const G = A.restWorld(scene, g, time);
    list.forEach(m => { m.parent = g.id; placeUnder(m, Pp, G); });
    commit(); select(g.id); toast('Grouped ' + list.length + ' objects');
  }
  function ungroup(g) {
    const kids = scene.objects.filter(c => c.parent === g.id), G = A.restWorld(scene, g, time), Pp = g.parent ? worldOf(g.parent) : MT.I;
    kids.forEach(c => { if (g.parent) c.parent = g.parent; else delete c.parent; placeUnder(c, G, Pp); });
    scene.objects = scene.objects.filter(x => x !== g);
    clearRefs(g.id);
    commit(); select(kids[0] ? kids[0].id : null); renderTimeline(); toast('Ungrouped');
  }
  const chk = (label, on, set) => h('label', { class: 'chk' }, (() => { const c = h('input', { type: 'checkbox' }); c.checked = !!on; c.addEventListener('change', () => set(c.checked)); return c; })(), h('span', {}, label));
  function rigSheet(body, o) {
    const others = scene.objects.filter(x => x !== o);
    const desc = new Set(descendants(o).map(x => x.id));
    const upd = () => { commit(); refreshSheet(); renderTimeline(); dirty = true; };
    if (o.type === 'group') {
      const kids = scene.objects.filter(c => c.parent === o.id);
      body.append(group('In this group', h('div', { class: 'chips' }, kids.map(c => h('button', { type: 'button', class: 'pick', onclick: () => select(c.id) }, c.name))),
        h('p', { class: 'muted small' }, 'Moving, sizing, turning or animating the group moves every member. On the preview, the first tap picks the group and a second tap picks the member.'),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: () => ungroup(o) }, 'Ungroup'))));
    } else {
      const sib = others.filter(x => (x.parent || null) === (o.parent || null) && !desc.has(x.id) && !(x.attach || x.path));
      const picks = new Set();
      body.append(group('Group', sib.length ? h('p', { class: 'muted small' }, 'Pick what to group with “' + o.name + '”, then tap Make group.') : h('p', { class: 'muted small' }, 'Add more objects to group them.'),
        h('div', { class: 'chips' }, sib.map(x => { const b = h('button', { type: 'button', class: 'pick', 'aria-pressed': 'false', onclick: () => { if (picks.has(x.id)) picks.delete(x.id); else picks.add(x.id); b.classList.toggle('on', picks.has(x.id)); b.setAttribute('aria-pressed', picks.has(x.id)); } }, x.name); return b; })),
        sib.length ? h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: () => makeGroup([o, ...sib.filter(x => picks.has(x.id))]) }, '⧈ Make group')) : null));
    }
    // parent
    body.append(group('Attach to a parent (rig)',
      h('p', { class: 'muted small' }, 'It then moves, turns and sizes with its parent, like a hand on an arm. Put each part’s pivot at its joint so it bends there.'),
      field('Parent', selectInput([['', '— none —'], ...others.filter(x => !desc.has(x.id)).map(x => [x.id, x.name])], o.parent || '', v => { reparent(o, v || null); upd(); }))));
    // pivot
    const bb = o._hit ? o._hit.bb : A.build(o).bb, cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
    const PV = [['Centre', cx, cy], ['Top', cx, bb[1]], ['Bottom', cx, bb[3]], ['Left', bb[0], cy], ['Right', bb[2], cy], ['Top left', bb[0], bb[1]], ['Top right', bb[2], bb[1]], ['Bottom left', bb[0], bb[3]], ['Bottom right', bb[2], bb[3]]];
    body.append(group('Pivot',
      h('p', { class: 'muted small' }, 'The point it turns and sizes around. Rigs bend at pivots, and the Pendulum loop swings from it.'),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn' + (pivotMode ? ' primary' : ''), onclick: () => { pivotMode = !pivotMode; if (!pivotMode) commit(); dirty = true; refreshSheet(); } }, pivotMode ? '✓ Done moving the pivot' : '⊕ Drag the pivot on the preview')),
      h('div', { class: 'chips' }, PV.map(([l, x, y]) => h('button', { type: 'button', class: 'pick', onclick: () => { setPivot(o, [x, -y]); commit(); dirty = true; } }, l)))));
    // graph
    const graphs = others.filter(x => x.type === 'graph'), at = o.attach || {};
    const gk = [h('p', { class: 'muted small' }, 'Sits on a graph’s curve and slides along it, like a dot on Manim’s axes.'),
      field('Graph', selectInput([['', '— not on a graph —'], ...graphs.map(g => [g.id, g.name])], at.to || '', v => {
        if (v) { o.attach = Object.assign({ fn: 1, x: '', tilt: false, ease: 'smooth' }, o.attach || {}, { to: v }); delete o.parent; delete o.path; o.x = 0; o.y = 0; delete o.keys.x; delete o.keys.y; }
        else delete o.attach;
        upd();
      }))];
    if (!graphs.length) gk.push(h('p', { class: 'muted small' }, 'Add a graph first (Graph in the toolbar).'));
    if (o.attach) {
      const xi = h('input', { type: 'text', value: at.x || '', placeholder: 'blank: slides left to right', spellcheck: 'false', autocapitalize: 'off' });
      xi.addEventListener('input', () => { o.attach.x = xi.value.trim(); dirty = true; commitSoon(); });
      gk.push(h('div', { class: 'two' }, field('Curve', selectInput([['1', 'Curve 1'], ['2', 'Curve 2']], String(at.fn || 1), v => { o.attach.fn = +v; dirty = true; commitSoon(); })), field('Slide easing', selectInput(RATES, at.ease || 'smooth', v => { o.attach.ease = v; dirty = true; commitSoon(); }))),
        field('Where along x', xi), h('p', { class: 'muted small' }, 'Blank: it travels along the curve during its clip. Or type a number (2), a live value (a) or a formula (3*sin(t)).'),
        chk('Tilt with the slope', at.tilt, v => { o.attach.tilt = v; dirty = true; commitSoon(); }));
    }
    body.append(group('Ride along a graph', ...gk));
    // path
    const pathy = others.filter(x => ['vector', 'curve', 'shape', 'geom', 'fractal'].includes(x.type) && !desc.has(x.id)), pa = o.path || {};
    const pk = [h('p', { class: 'muted small' }, 'Travels along another object’s outline during its clip. Draw a line with ✒ Draw to make a path.'),
      field('Path', selectInput([['', '— no path —'], ...pathy.map(g => [g.id, g.name])], pa.to || '', v => {
        if (v) { o.path = Object.assign({ ease: 'smooth', orient: false }, o.path || {}, { to: v }); delete o.parent; delete o.attach; o.x = 0; o.y = 0; delete o.keys.x; delete o.keys.y; }
        else delete o.path;
        upd();
      }))];
    if (o.path) {
      const tg = objById(pa.to);
      pk.push(field('Easing', selectInput(RATES, pa.ease || 'smooth', v => { o.path.ease = v; dirty = true; commitSoon(); })),
        chk('Turn to face along the path', pa.orient, v => { o.path.orient = v; dirty = true; commitSoon(); }),
        chk('Go the other way', pa.reverse, v => { o.path.reverse = v; dirty = true; commitSoon(); }),
        tg ? chk('Hide the path in the video', tg.hidden, v => { tg.hidden = v || undefined; commit(); renderTimeline(); dirty = true; }) : null);
    }
    body.append(group('Follow a path', ...pk));
  }

  // ---------- live values ----------
  function renameVar(a, b) {
    const re = new RegExp('\\b' + a + '\\b', 'g');
    const inTpl = s => String(s).replace(/\[\[([^\]]+)\]\]/g, m => m.replace(re, b));
    for (const o of scene.objects) {
      for (const [k, v] of Object.entries(o.props || {})) if (typeof v === 'string') o.props[k] = ['f1', 'f2', 'xt', 'yt'].includes(k) ? v.replace(re, b) : inTpl(v);
      if (o.drive) for (const k in o.drive) o.drive[k] = o.drive[k].replace(re, b);
      if (o.attach && o.attach.x) o.attach.x = String(o.attach.x).replace(re, b);
    }
  }
  function ensureVar(name) {
    if (!scene.vars) scene.vars = [];
    if (scene.vars.some(d => d.name === name)) return;
    const t = round(time, 2);
    scene.vars.push({ name, v: 0, keys: [{ t, v: 0 }, { t: round(t + 3, 2), v: 10 }] });
  }
  const keyBtn = (on, some, label, fn) => h('button', { type: 'button', class: 'keybtn' + (on ? ' on' : some ? ' some' : ''), 'aria-label': (on ? 'Remove ' : 'Add ') + label + ' keyframe', onclick: fn }, on ? '◆' : '◇');
  function keyChips(times, onEase) {
    return h('div', { class: 'kchips' }, times.map(t => h('span', { class: 'kpair' }, h('button', { type: 'button', class: 'chip', onclick: () => setTime(t) }, '◆ ' + fmtT(t)),
      h('button', { type: 'button', class: 'chip ease', 'aria-label': 'Easing into ' + fmtT(t), onclick: () => onEase(t) }, '⌇'))));
  }
  function valuesSheet(body) {
    const V = scene.vars || (scene.vars = []);
    body.append(h('p', { class: 'muted small' }, 'A live value is a number that changes over time, like Manim’s ValueTracker. Show it with [[a]] (or [[a:1]] for one decimal place) in any text or maths, use its name in a graph formula, or drive a position with it (Position → Drive with a formula).'));
    const now = A.varsAt(scene, time);
    V.forEach((d, i) => {
      const k = d.keys || (d.keys = []);
      const t = round(time, 2), here = k.find(q => Math.abs(q.t - t) < 0.026);
      const nm = h('input', { type: 'text', value: d.name, class: 'vname', 'aria-label': 'Name', spellcheck: 'false', autocapitalize: 'off' });
      nm.addEventListener('change', () => {
        const v = nm.value.trim();
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(v) || A.RESERVED.includes(v) || ['t', 'u', 'V'].includes(v) || V.some(x => x !== d && x.name === v)) { toast('Use a short name of letters, like a or speed (not x, t, u, e or a function name).'); nm.value = d.name; return; }
        renameVar(d.name, v); d.name = v; commit(); refreshSheet(); dirty = true;
      });
      const st = stepper(round(now[d.name], 3), d.step || 1, v => {
        if (k.length) { const ex = k.find(q => Math.abs(q.t - round(time, 2)) < 0.026); if (ex) ex.v = v; else { k.push({ t: round(time, 2), v }); k.sort((a, b) => a.t - b.t); } }
        else d.v = v;
        dirty = true; commitSoon();
      });
      const inp = st.querySelector('input'); inp.dataset.live = '1'; inp._get = () => round(A.varsAt(scene, time)[d.name], 3);
      const kb = keyBtn(here, k.length, d.name, () => { const j = k.findIndex(q => Math.abs(q.t - round(time, 2)) < 0.026); if (j >= 0) k.splice(j, 1); else { k.push({ t: round(time, 2), v: A.varsAt(scene, time)[d.name] }); k.sort((a, b) => a.t - b.t); } commit(); refreshSheet(); dirty = true; });
      const box = h('div', { class: 'vbox' }, h('div', { class: 'vrow' }, nm, st, kb, h('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Delete ' + d.name, onclick: () => { V.splice(i, 1); commit(); refreshSheet(); dirty = true; } }, '✕')));
      if (k.length) box.append(keyChips(k.map(q => q.t), tt => openEase({ kind: 'key', id: 'var:' + d.name, t: tt })));
      body.append(box);
    });
    const nextName = () => ['a', 'b', 'c', 'k', 'n', 'm', 'p', 'q', 'r', 's', 'w'].find(n => !V.some(d => d.name === n)) || 'v' + (V.length + 1);
    body.append(h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn', onclick: () => { V.push({ name: nextName(), v: 0, keys: [] }); commit(); refreshSheet(); } }, '＋ New value'),
      h('button', { type: 'button', class: 'btn', onclick: () => { const n = V[0] ? V[0].name : nextName(); ensureVar(n); addObj('math', { name: 'Number ' + n, props: { tex: n + ' = [[' + n + ':1]]' } }); } }, '＋ Show one on screen')));
    if (V.length) body.append(h('p', { class: 'muted small' }, 'To animate a value: tap ◇, move the playhead, then change the number. ⌇ sets how it eases between keyframes.'));
  }

  // ---------- camera ----------
  function camObj() { return scene.camera || (scene.camera = { x: 0, y: 0, zoom: 1, rotation: 0, keys: {} }); }
  function cameraSheet(body) {
    const cam = camObj();
    body.append(h('p', { class: 'muted small' }, 'Pan, zoom and turn the whole view, like Manim’s MovingCameraScene. Keyframe it as you would an object: tap ◇, move the playhead, then change a value.'));
    for (const [p, label, step] of [['x', 'Look at x', 0.5], ['y', 'Look at y', 0.5], ['zoom', 'Zoom', 0.1], ['rotation', 'Turn (°)', 15]]) {
      const k = cam.keys[p] || [], here = k.some(q => Math.abs(q.t - time) < 0.026);
      const st = stepper(round(A.keyVal(cam, p, time), 2), step, v => { setProp(cam, p, p === 'zoom' ? Math.max(0.1, v) : v); dirty = true; commitSoon(); });
      const inp = st.querySelector('input'); inp.dataset.live = '1'; inp._get = () => round(A.keyVal(cam, p, time), 2);
      body.append(h('div', { class: 'kfrow' }, h('span', { class: 'fl' }, label), st, keyBtn(here, k.length, label, () => toggleKey(cam, p))));
    }
    const kt = [...new Set(Object.values(cam.keys).flat().map(q => q.t))].sort((a, b) => a - b);
    if (kt.length) body.append(keyChips(kt, t => openEase({ kind: 'key', id: 'cam', t })));
    const move = (to, dur) => {
      const t = round(time, 2);
      for (const [p, v] of Object.entries(to)) { const k = cam.keys[p] || (cam.keys[p] = []); const v0 = A.keyVal(cam, p, time); [[t, v0], [round(t + dur, 2), v]].forEach(([tt, vv]) => { const ex = k.find(q => Math.abs(q.t - tt) < 0.026); if (ex) ex.v = round(vv, 3); else k.push({ t: tt, v: round(vv, 3) }); }); k.sort((a, b) => a.t - b.t); }
      if (t + dur > scene.duration) scene.duration = Math.ceil(t + dur);
      commit(); refreshSheet(); renderTimeline(); dirty = true; previewRange(t - 0.2, t + dur + 0.3);
    };
    const r = ratio(scene.aspect);
    body.append(group('Moves from the playhead',
      h('div', { class: 'chips' },
        h('button', { type: 'button', class: 'pick', onclick: () => move({ zoom: A.keyVal(cam, 'zoom', time) * 1.6 }, 2) }, 'Push in'),
        h('button', { type: 'button', class: 'pick', onclick: () => move({ zoom: A.keyVal(cam, 'zoom', time) / 1.6 }, 2) }, 'Pull out'),
        h('button', { type: 'button', class: 'pick', onclick: () => move({ x: 0, y: 0, zoom: 1, rotation: 0 }, 1.2) }, 'Back to start'),
        h('button', { type: 'button', class: 'pick', onclick: () => move({ rotation: A.keyVal(cam, 'rotation', time) + 15 }, 1.5) }, 'Tilt')),
      field('Focus on', selectInput([['', '— choose an object —'], ...scene.objects.filter(o => o.type !== 'group' || true).map(o => [o.id, o.name])], '', v => {
        const o = objById(v); if (!o) return;
        const W = A.restWorld(scene, o, Math.max(time, o.start)), bb = o._hit ? o._hit.bb : A.build(o).bb;
        const c = MT.ap(MT.mul(W, MT.FLIP), (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2), s = MT.mdet(W);
        const z = Math.max(0.3, Math.min(6, 0.75 * Math.min(8 / (((bb[3] - bb[1]) * s) || 1), 8 * r / (((bb[2] - bb[0]) * s) || 1))));
        move({ x: c[0], y: c[1], zoom: z }, 1.2);
      })),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn quiet', onclick: () => { delete scene.camera; commit(); refreshSheet(); dirty = true; } }, 'Remove all camera moves'))));
    if (window.Bio3D) body.append(camera3DGroup());
  }

  // ---------- sound and markers ----------
  function addMarker() {
    const t = round(time, 2);
    if (!scene.markers) scene.markers = [];
    if (!scene.markers.some(m => Math.abs(m - t) < 0.05)) { scene.markers.push(t); scene.markers.sort((a, b) => a - b); }
    commitSoon(); renderTimelineSoon();
    if (!playing && sheetKind === 'audio') refreshSheet();
    const b = document.getElementById('markBtn'); if (b) { b.classList.add('flash'); setTimeout(() => b.classList.remove('flash'), 150); }
  }
  function audioSheet(body) {
    const au = scene.audio;
    if (au) {
      body.append(h('div', { class: 'row' }, h('b', {}, '♪ ' + au.name), h('span', { class: 'muted small' }, sound.dur ? fmtT(sound.dur) : (sound.el ? '' : 'not on this device'))));
      body.append(h('div', { class: 'two' },
        field('Starts at (s)', stepper(au.offset || 0, 0.1, v => { au.offset = round(v, 2); renderTimelineSoon(); commitSoon(); })),
        field('Volume', stepper(au.vol == null ? 1 : au.vol, 0.1, v => { au.vol = Math.max(0, Math.min(1, round(v, 2))); commitSoon(); }))));
      body.append(h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: importSound }, 'Replace sound'),
        h('button', { type: 'button', class: 'btn quiet', onclick: () => { delete scene.audio; commit(); loadMedia(); refreshSheet(); renderTimeline(); } }, 'Remove sound')));
      body.append(h('p', { class: 'muted small' }, 'The sound plays with the preview and is mixed into exported videos. Drag its strip on the timeline to shift it.'));
    } else body.append(h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: importSound }, '♪ Add a sound…')), h('p', { class: 'muted small' }, 'Music or a voice-over from your device.'));
    const M = scene.markers || [];
    body.append(group('Markers',
      h('p', { class: 'muted small' }, 'Cues on the timeline, such as beats or words in a voice-over. Clips snap to them as you drag. Play, and tap Marker in time to drop them as you go (or press M).'),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', id: 'markBtn', onclick: addMarker }, '◆ Marker at playhead'), h('button', { type: 'button', class: 'btn', onclick: () => setPlaying(!playing) }, playing ? '❚❚ Pause' : '▶ Play')),
      M.length ? h('div', { class: 'kchips' }, M.map((m, i) => h('span', { class: 'kpair' }, h('button', { type: 'button', class: 'chip', onclick: () => setTime(m) }, '▾ ' + fmtT(m)),
        h('button', { type: 'button', class: 'chip ease', 'aria-label': 'Remove marker', onclick: () => { M.splice(i, 1); commit(); refreshSheet(); renderTimeline(); } }, '✕'))),
        h('button', { type: 'button', class: 'chip quiet', onclick: () => { scene.markers = []; commit(); refreshSheet(); renderTimeline(); } }, 'Clear all')) : null));
  }
  function mediaSheet(body) {
    const g = h('div', { class: 'addgrid' });
    g.append(h('button', { type: 'button', class: 'addbtn', onclick: importImage }, h('span', { class: 'ic' }, '▨'), h('span', {}, 'Image…')),
      h('button', { type: 'button', class: 'addbtn', onclick: importSound }, h('span', { class: 'ic' }, '♪'), h('span', {}, scene.audio ? 'Replace sound…' : 'Sound…')));
    body.append(g, h('p', { class: 'muted small' }, 'Images and sound are kept in this app on this device. A saved project file (Projects → Save project file) carries them with it.'));
  }

  // ---------- your library ----------
  let libEdit = false;
  const LIBK = 'bstudio.library';
  function retime(objs, dt, mapId) {
    objs.forEach(c => {
      c.start = round(c.start + dt, 3); c.end = round(c.end + dt, 3);
      c.emph = (c.emph || []).map(e => Object.assign(e, { t: round(e.t + dt, 3) }));
      for (const k in c.keys || {}) c.keys[k] = c.keys[k].map(q => Object.assign(q, { t: round(q.t + dt, 3) }));
      if (mapId) {
        c.id = mapId(c.id);
        for (const f of ['parent']) if (c[f]) c[f] = mapId(c[f], true);
        if (c.attach) { const m = mapId(c.attach.to, true); if (m) c.attach.to = m; else delete c.attach; }
        if (c.path) { const m = mapId(c.path.to, true); if (m) c.path.to = m; else delete c.path; }
        if (c.anOut && c.anOut.target) { const m = mapId(c.anOut.target, true); if (m) c.anOut.target = m; else { c.anOut.target = ''; if (MORPH(c.anOut.type)) c.anOut.type = 'fadeout'; } }
      }
    });
    return objs;
  }
  function thumbOf(objs) {
    try {
      const c = h('canvas'); c.width = 192; c.height = 128;
      const ctx = c.getContext('2d');
      const sc = { bg: scene.bg, duration: 1e6, objects: clone(objs), vars: scene.vars };
      const t = objs[0].start + A.phases(objs[0]).inD + 0.02;
      A.render(ctx, sc, t, 192, 128);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const o of sc.objects) { const hh = o._hit; if (!hh || hh.group) continue; const PF = MT.mul(hh.P, MT.FLIP), b = hh.bb; for (const [x, y] of [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]]) { const [a, d] = MT.ap(PF, x, y); x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, d); y1 = Math.max(y1, d); } }
      if (isFinite(x0)) { sc.camera = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom: Math.min(8 * 0.82 / ((y1 - y0) || 1), 12 * 0.82 / ((x1 - x0) || 1), 5), rotation: 0, keys: {} }; A.render(ctx, sc, t, 192, 128); }
      return c.toDataURL('image/jpeg', 0.8);
    } catch (e) { return null; }
  }
  function saveToLibrary(o) {
    const objs = clone([o, ...descendants(o)]);
    delete objs[0].parent; delete objs[0].attach; delete objs[0].path;
    retime(objs, -o.start);
    const lib = store.get(LIBK, []);
    lib.unshift({ id: uid(), name: o.name, objs, thumb: thumbOf(objs), at: Date.now() });
    if (!store.set(LIBK, lib)) { toast('Couldn’t save it: this device’s storage is full.'); return; }
    toast('Saved “' + o.name + '” to your library (❖ Library)');
  }
  function insertAsset(it) {
    if (playing) setPlaying(false);
    const ids = new Map(it.objs.map(c => [c.id, uid()]));
    const objs = retime(clone(it.objs), round(time, 2), (id, ref) => ids.get(id) || (ref ? null : uid()));
    scene.objects.push(...objs);
    const end = Math.max(...objs.map(c => c.end)); if (end > scene.duration) scene.duration = Math.ceil(end);
    commit(); select(objs[0].id); loadMedia(); toast('Added “' + it.name + '”');
  }
  function librarySheet(body) {
    const lib = store.get(LIBK, []);
    if (!lib.length) { body.append(h('p', { class: 'muted' }, 'Nothing saved yet. Select something you made, such as a drawing, a group or a rig, and tap ❖ Save. It then appears here in every project on this device.')); return; }
    const g = h('div', { class: 'addgrid libgrid' });
    lib.forEach((it, i) => g.append(h('div', { class: 'libitem' },
      h('button', { type: 'button', class: 'addbtn', onclick: () => insertAsset(it) }, it.thumb ? h('img', { src: it.thumb, alt: '' }) : h('span', { class: 'ic' }, '❖'), h('span', {}, it.name)),
      libEdit ? h('button', { type: 'button', class: 'iconbtn libdel', 'aria-label': 'Remove ' + it.name, onclick: async () => { if (!await ask('Remove “' + it.name + '” from your library?', 'Remove')) return; const L = store.get(LIBK, []); L.splice(i, 1); store.set(LIBK, L); refreshSheet(); } }, '✕') : null)));
    body.append(g, h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn quiet', onclick: () => { libEdit = !libEdit; refreshSheet(); } }, libEdit ? 'Done' : 'Edit')),
      h('p', { class: 'muted small' }, 'Tap one to add it at the playhead, with its animations.'));
  }

  // ---------- Manim code ----------
  function codeSheet(body) {
    let code;
    try { code = window.AnimathCode.generate(scene); } catch (e) { code = '# Couldn’t write the code: ' + e.message; }
    const name = slug().replace(/-/g, '_') + '.py';
    body.append(h('p', { class: 'muted small' }, 'This scene as Python for the Manim Community library, to run on a computer with Manim installed. It’s read-only: change the scene here and the code follows. Shapes Manim lacks become labelled placeholders.'));
    body.append(h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn primary', onclick: async () => { try { await navigator.clipboard.writeText(code); toast('Copied'); } catch (e) { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Selected: copy it with your keyboard or menu'); } } }, '⧉ Copy'),
      h('button', { type: 'button', class: 'btn', onclick: () => download(name, new Blob([code], { type: 'text/x-python' })) }, '⤓ Save ' + name)));
    const pre = h('pre', { class: 'code' }, h('code', {}, code));
    body.append(pre);
  }

  // ---------- easing curves ----------
  let easeT = null, easeBack = null, easeRaf = 0;
  function openEase(target) { easeT = target; easeBack = sheetKind === 'ease' ? easeBack : sheetKind; openSheet('ease'); }
  function easeKeys() {
    const t = easeT;
    if (t.id === 'cam') return Object.values(camObj().keys).map(k => k.find(q => Math.abs(q.t - t.t) < 0.026)).filter(Boolean);
    if (String(t.id).startsWith('var:')) { const d = (scene.vars || []).find(x => x.name === t.id.slice(4)); return d ? (d.keys || []).filter(q => Math.abs(q.t - t.t) < 0.026) : []; }
    const o = objById(t.id); return o ? Object.values(o.keys || {}).map(k => k.find(q => Math.abs(q.t - t.t) < 0.026)).filter(Boolean) : [];
  }
  function easeGet() {
    if (!easeT) return 'smooth';
    if (easeT.kind === 'in' || easeT.kind === 'out') { const o = selObj(); return o ? (easeT.kind === 'in' ? o.anIn.rate : o.anOut.rate) || 'smooth' : 'smooth'; }
    const k = easeKeys().find(q => q.ease); return (k && k.ease) || 'smooth';
  }
  function easeSet(v) {
    if (!easeT) return;
    if (easeT.kind === 'in' || easeT.kind === 'out') { const o = selObj(); if (o) (easeT.kind === 'in' ? o.anIn : o.anOut).rate = v; }
    else easeKeys().forEach(q => { q.ease = v; });
    dirty = true; commitSoon();
  }
  function curveIcon(c, f, opts) {
    const x = c.getContext('2d'), W = c.width, H = c.height, pad = opts && opts.pad || 8, lo = -0.35, hi = 1.35;
    const Y = v => H - pad - (v - lo) / (hi - lo) * (H - 2 * pad), X = u => pad + u * (W - 2 * pad);
    x.clearRect(0, 0, W, H);
    x.strokeStyle = 'rgba(255,255,255,.18)'; x.lineWidth = 1; x.beginPath(); x.moveTo(X(0), Y(0)); x.lineTo(X(1), Y(0)); x.moveTo(X(0), Y(1)); x.lineTo(X(1), Y(1)); x.stroke();
    x.strokeStyle = '#58C4DD'; x.lineWidth = 2.2; x.beginPath();
    for (let i = 0; i <= 80; i++) { const u = i / 80, v = f(u); i ? x.lineTo(X(u), Y(v)) : x.moveTo(X(u), Y(v)); }
    x.stroke();
    return { X, Y };
  }
  const easeFn = k => k === 'hold' ? (u => u < 1 ? 0 : 1) : A.rateFn(k);
  function easeSheet(body) {
    if (!easeT) { closeSheet(); return; }
    cancelAnimationFrame(easeRaf);
    const cur = easeGet();
    const what = easeT.kind === 'in' ? 'the in animation' : easeT.kind === 'out' ? 'the out animation' : 'the keyframe at ' + fmtT(easeT.t) + (easeT.id === 'cam' ? ' (camera)' : String(easeT.id).startsWith('var:') ? ' (' + easeT.id.slice(4) + ')' : '');
    body.append(h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn quiet', onclick: () => openSheet(easeBack && easeBack !== 'ease' ? easeBack : 'position') }, '‹ Back'), h('span', { class: 'muted small' }, 'How it moves into ' + what)));
    const g = h('div', { class: 'animgrid easegrid' });
    const list = RATES.concat(easeT.kind === 'key' ? [['hold', 'Hold, then jump']] : []);
    for (const [k, l] of list) {
      const c = h('canvas', { width: 120, height: 80, 'aria-hidden': 'true' });
      curveIcon(c, easeFn(k));
      g.append(h('button', { type: 'button', class: 'atile' + (k === cur ? ' on' : ''), 'aria-pressed': k === cur, onclick: () => { easeSet(k); refreshSheet(); } }, c, h('span', {}, l)));
    }
    body.append(g);
    // cubic-bezier editor
    let cb = String(cur).startsWith('cb:') ? cur.slice(3).split(',').map(Number) : [0.42, 0, 0.58, 1];
    const cv = h('canvas', { class: 'bez', width: 560, height: 420, 'aria-label': 'Drag the two handles to shape the curve' });
    const read = h('p', { class: 'muted small mono' });
    const dot = h('div', { class: 'easedot' }), track = h('div', { class: 'easetrack' }, dot);
    let geo = null;
    const paint = () => {
      const f = A.rateFn('cb:' + cb.join(','));
      geo = curveIcon(cv, f, { pad: 40 });
      const x = cv.getContext('2d'), P = (u, v) => [geo.X(u), geo.Y(v)];
      x.strokeStyle = 'rgba(255,255,0,.7)'; x.lineWidth = 1.5;
      [[0, 0, cb[0], cb[1]], [1, 1, cb[2], cb[3]]].forEach(([a, b, c2, d]) => { x.beginPath(); x.moveTo(...P(a, b)); x.lineTo(...P(c2, d)); x.stroke(); x.fillStyle = '#FFFF00'; x.beginPath(); x.arc(...P(c2, d), 13, 0, 7); x.fill(); });
      read.textContent = 'cubic-bezier(' + cb.map(v => round(v, 2)).join(', ') + ')' + (String(easeGet()).startsWith('cb:') ? '' : ' · drag a handle to use it');
    };
    let drag = -1;
    const pos = e => { const r = cv.getBoundingClientRect(), sx = cv.width / r.width, sy = cv.height / r.height; return [(e.clientX - r.left) * sx, (e.clientY - r.top) * sy]; };
    const inv = ([px, py]) => { const u = (px - 40) / (cv.width - 80), v = -0.35 + (cv.height - 40 - py) / (cv.height - 80) * 1.7; return [Math.max(0, Math.min(1, u)), Math.max(-0.6, Math.min(1.6, v))]; };
    cv.addEventListener('pointerdown', e => { const p = pos(e); const d = [[cb[0], cb[1]], [cb[2], cb[3]]].map(([u, v]) => Math.hypot(geo.X(u) - p[0], geo.Y(v) - p[1])); drag = d[0] <= d[1] ? 0 : 1; if (d[drag] > 60) drag = -1; else { cv.setPointerCapture(e.pointerId); e.preventDefault(); } });
    cv.addEventListener('pointermove', e => { if (drag < 0) return; const [u, v] = inv(pos(e)); cb[drag * 2] = round(u, 3); cb[drag * 2 + 1] = round(v, 3); easeSet('cb:' + cb.join(',')); paint(); g.querySelectorAll('.atile').forEach(b => b.classList.remove('on')); });
    const up = () => { if (drag >= 0) { drag = -1; commit(); } };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    body.append(group('Your own curve', cv, read, track, h('p', { class: 'muted small' }, 'Drag the yellow handles. Above the top line overshoots; below the bottom line pulls back first.')));
    paint();
    const t0 = performance.now();
    const anim = now => { if (sheetKind !== 'ease' || !dot.isConnected) return; const ph = ((now - t0) / 1600) % 1.4, u = Math.min(1, ph); dot.style.left = (easeFn(easeGet())(u) * 100).toFixed(2) + '%'; easeRaf = requestAnimationFrame(anim); };
    easeRaf = requestAnimationFrame(anim);
  }
  function sceneSheet(body) {
    const name = h('input', { type: 'text', value: scene.name });
    name.addEventListener('input', () => { scene.name = name.value; commitSoon(); clearTimeout(fpT); fpT = setTimeout(() => { saveNow(); fillProjects(); }, 500); });
    body.append(field('Project name', name));
    body.append(field('Shape of the video', h('div', { class: 'chips' }, ASPECTS.map(([k, l]) => h('button', { type: 'button', class: 'pick' + (scene.aspect === k ? ' on' : ''), onclick: () => { scene.aspect = k; commit(); sizeStage(); refreshSheet(); updAspect(); } }, l)))));
    body.append(field('Background', h('div', { class: 'chips' }, BGS.map(([k, l]) => h('button', { type: 'button', class: 'pick' + (scene.bg === k ? ' on' : ''), onclick: () => { scene.bg = k; commit(); dirty = true; refreshSheet(); } }, h('i', { class: 'bgdot', style: 'background:' + k }), l)),
      (() => { const c = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(scene.bg) ? scene.bg : '#000000', 'aria-label': 'Custom background' }); c.addEventListener('input', () => { scene.bg = c.value; dirty = true; commitSoon(); }); return c; })())));
    body.append(field('Length (seconds)', stepper(scene.duration, 1, v => { scene.duration = Math.max(1, v); commitSoon(); renderTimeline(); dirty = true; })));
    body.append(h('p', { class: 'muted small' }, 'The frame is 8 units tall with (0, 0) in the middle, as in Manim. Paper and White switch new objects to dark ink.'));
  }
  let fpT = null;
  function refreshSheetValues() {
    const o = selObj();
    if (sheetKind === 'position' && o) {
      document.querySelectorAll('#sheetBody .kfrow').forEach(row => {
        const inp = row.querySelector('input'), p = inp.dataset.prop;
        if (document.activeElement !== inp) inp.value = round(A.keyVal(o, p, time), 2);
        const k = o.keys[p] || [], here = k.some(q => Math.abs(q.t - time) < 0.026);
        const b = row.querySelector('.keybtn'); b.className = 'keybtn' + (here ? ' on' : k.length ? ' some' : ''); b.textContent = here ? '◆' : '◇';
      });
    }
    document.querySelectorAll('#sheetBody input[data-live]').forEach(i => { if (document.activeElement !== i && i._get) i.value = i._get(); });
    if (o) document.querySelectorAll('#sheetBody .k3row').forEach(row => { const k = o.keys[row.dataset.k] || [], here = k.some(q => Math.abs(q.t - time) < 0.026), b = row.querySelector('.keybtn'); if (b) { b.className = 'keybtn' + (here ? ' on' : k.length ? ' some' : ''); b.textContent = here ? '◆' : '◇'; } });
    if (sheetKind && sheetKind.startsWith('add:')) { const p = document.querySelector('#sheetBody .small'); if (p) p.textContent = 'It’s added at the playhead (' + fmtT(time) + ') for 4 seconds. Drag it on the preview to place it.'; }
  }
  let prevT = null;
  function previewRange(a, b) {
    clearTimeout(prevT);
    setTime(Math.max(0, a)); setPlaying(true);
    prevT = setTimeout(() => { if (playing) { setPlaying(false); } }, Math.max(300, (b - a) * 1000));
  }
  function linkTransform(o, t) {
    o.anOut.target = t.id;
    const len = Math.max(1, t.end - t.start);
    t.start = round(o.end, 2); t.end = round(t.start + len, 2);
    t.anIn = Object.assign({}, t.anIn, { type: 'appear' });
    if (t.end > scene.duration) scene.duration = Math.ceil(t.end);
  }
  function move(d) {
    const i = scene.objects.findIndex(o => o.id === sel), j = i + d;
    if (j < 0 || j >= scene.objects.length) { toast(d > 0 ? 'Already at the front' : 'Already at the back'); return; }
    const a = scene.objects; [a[i], a[j]] = [a[j], a[i]];
    commit(); renderTimeline(); dirty = true; toast(d > 0 ? 'Moved forward' : 'Moved back');
  }
  function dup() {
    const o = selObj(); if (!o) return;
    const fam = [o, ...descendants(o)], ids = new Map(fam.map(x => [x.id, uid()]));
    const copies = clone(fam).map(c => { c.id = ids.get(c.id); if (c.parent && ids.has(c.parent)) c.parent = ids.get(c.parent); return c; });
    const c = copies[0]; c.name = o.name + ' copy'; shiftPos(c, 0.5, -0.5);
    scene.objects.push(...copies); commit(); select(c.id); toast('Copied');
  }
  async function del() {
    const o = selObj(); if (!o) return;
    const gone = [o, ...(o.type === 'group' ? descendants(o) : [])];
    scene.objects = scene.objects.filter(x => !gone.includes(x));
    gone.forEach(x => clearRefs(x.id));
    commit(); closeSheet(); select(null); toast((gone.length > 1 ? 'Deleted the group and its ' + (gone.length - 1) + ' members.' : 'Deleted.') + ' Undo with ↶');
  }

  // ---------- timeline: scrolls under a fixed centre playhead ----------
  const tl = $('#timeline');
  const scr = h('div', { class: 'tl-scroll' });
  tl.append(scr, h('div', { class: 'tl-ph', 'aria-hidden': 'true' }),
    h('div', { class: 'tl-zoom' }, h('button', { type: 'button', 'aria-label': 'Zoom out', onclick: () => zoom(1 / 1.4) }, '−'), h('button', { type: 'button', 'aria-label': 'Zoom in', onclick: () => zoom(1.4) }, '+')));
  let lastProg = -1, half = 0;
  function zoom(f) { pps = Math.max(12, Math.min(320, pps * f)); renderTimeline(); }
  function syncScroll() { if (!scene) return; const x = Math.round(time * pps); if (Math.abs(scr.scrollLeft - x) > 0.5) { lastProg = x; scr.scrollLeft = x; } }
  scr.addEventListener('scroll', () => {
    if (Math.abs(scr.scrollLeft - lastProg) <= 1) return;
    lastProg = -1;
    if (tdrag && tdrag.moved) return;
    if (playing) setPlaying(false);
    setTime(scr.scrollLeft / pps, true);
  }, { passive: true });
  function renderTimeline() {
    if (!scene) return;
    half = Math.round(scr.clientWidth / 2);
    const D = scene.duration;
    const inner = h('div', { class: 'tl-inner', style: 'width:' + (half * 2 + D * pps) + 'px' });
    const ruler = h('div', { class: 'tl-ruler' });
    const step = pps > 110 ? 0.5 : pps > 40 ? 1 : pps > 20 ? 2 : 5;
    for (let t = 0; t <= D + 1e-9; t += step) {
      const major = Math.abs(t / (step * 2) - Math.round(t / (step * 2))) < 1e-6;
      ruler.append(h('span', { class: 'tick' + (major ? '' : ' minor'), style: 'left:' + (half + t * pps) + 'px' }, major ? (Number.isInteger(t) ? fmtShort(t) : t.toFixed(1)) : ''));
    }
    ruler.append(h('div', { class: 'tl-endmark', style: 'left:' + (half + D * pps) + 'px' }));
    (scene.markers || []).forEach(m => ruler.append(h('div', { class: 'tl-marker', 'data-mt': m, title: 'Marker ' + fmtT(m), style: 'left:' + (half + m * pps) + 'px' })));
    inner.append(ruler);
    const rows = h('div', { class: 'tl-rows' });
    // pack clips into shared lanes (like a phone video editor); the front-most layer goes on top
    const lanes = [];
    const laneOf = new Map();
    scene.objects.forEach(o => {
      let li = lanes.findIndex(L => L.every(q => o.start >= q.end - 1e-6 || o.end <= q.start + 1e-6));
      if (li < 0) { lanes.push([]); li = lanes.length - 1; }
      lanes[li].push(o); laneOf.set(o.id, li);
    });
    const laneEls = lanes.map(() => h('div', { class: 'tl-row' }));
    scene.objects.forEach(o => {
      const { inD, outD } = A.phases(o);
      const isSel = o.id === sel;
      const clip = h('div', { class: 'tl-clip t-' + o.type + (isSel ? ' sel' : '') + (o.hidden ? ' hid' : '') + (o.parent ? ' kid' : ''), 'data-id': o.id, 'data-mode': 'move', style: 'left:' + (half + o.start * pps) + 'px;width:' + Math.max(8, (o.end - o.start) * pps) + 'px' },
        h('div', { class: 'ph in', style: 'width:' + inD * pps + 'px' }), h('div', { class: 'ph out', style: 'width:' + outD * pps + 'px' }),
        h('span', { class: 'clabel' }, h('b', {}, A.TYPES[o.type].icon), ' ', (MORPH(o.anOut.type) ? '⇢ ' : '') + (o.type === 'group' ? '' : '') + (o.parent ? '↳ ' : '') + o.name));
      if (isSel) clip.append(h('div', { class: 'hd l', 'data-id': o.id, 'data-mode': 'left', 'aria-label': 'Trim start' }), h('div', { class: 'hd r', 'data-id': o.id, 'data-mode': 'right', 'aria-label': 'Trim end' }));
      (o.emph || []).forEach((e, i) => clip.append(h('div', { class: 'em', 'data-id': o.id, 'data-mode': 'emph', 'data-i': i, title: e.type, style: 'left:' + (e.t - o.start) * pps + 'px;width:' + Math.max(8, e.dur * pps) + 'px' })));
      [...new Set(Object.values(o.keys || {}).flat().map(q => q.t))].forEach(t => clip.append(h('div', { class: 'kf', 'data-id': o.id, 'data-mode': 'key', 'data-t': t, style: 'left:' + (t - o.start) * pps + 'px' })));
      laneEls[laneOf.get(o.id)].append(clip);
    });
    laneEls.slice().reverse().forEach(el => rows.append(el));
    if (scene.audio) {
      const au = scene.audio, dur = sound.dur || 4, w = Math.max(8, dur * pps);
      const cw = Math.min(6000, Math.ceil(w)), wave = h('canvas', { class: 'wave', width: cw, height: 56, style: 'width:' + w + 'px' });
      if (sound.peaks) { const x = wave.getContext('2d'), P = sound.peaks; x.fillStyle = 'rgba(131,193,103,.85)'; for (let i = 0; i < cw; i++) { const v = P[Math.floor(i / cw * P.length)] || 0, hh = Math.max(1, v * 50); x.fillRect(i, 28 - hh / 2, 1, hh); } }
      rows.append(h('div', { class: 'tl-row audio' }, h('div', { class: 'tl-clip t-audio', 'data-id': 'audio', 'data-mode': 'audio', style: 'left:' + (half + (au.offset || 0) * pps) + 'px;width:' + w + 'px' }, wave, h('span', { class: 'clabel' }, '♪ ' + au.name))));
    }
    rows.append(h('div', { class: 'tl-row add' }, h('button', { type: 'button', class: 'tl-add', style: 'left:' + (half + time * pps + 8) + 'px', onclick: () => { select(null); openSheet('add:text'); } }, '＋ Add')));
    inner.append(rows);
    const keepY = scr.scrollTop;
    scr.textContent = '';
    scr.append(inner);
    scr.scrollTop = keepY;
    lastProg = Math.round(time * pps); scr.scrollLeft = lastProg;
  }
  const fmtShort = t => t >= 60 ? Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0') : t + 's';
  let rtT = null; const renderTimelineSoon = () => { clearTimeout(rtT); rtT = setTimeout(renderTimeline, 120); };

  let tdrag = null;
  scr.addEventListener('click', e => {
    if (tdrag && tdrag.moved) return;
    const mk = e.target.closest('.tl-marker');
    if (mk) { setTime(+mk.dataset.mt); return; }
    const c = e.target.closest('.tl-clip');
    if (c && c.dataset.id === 'audio') { select(null); openSheet('audio'); return; }
    if (c) { if (c.dataset.id !== sel) select(c.dataset.id); return; }
    if (e.target.closest('.tl-ruler')) { const r = scr.getBoundingClientRect(); setTime((e.clientX - r.left + scr.scrollLeft - half) / pps); return; }
    if (!e.target.closest('button') && sel) select(null);
  });
  scr.addEventListener('pointerdown', e => {
    const t = e.target.closest('[data-mode]') || e.target, m = t.dataset.mode;
    if (m === 'audio' && scene.audio) { tdrag = { mode: 'audio', x0: e.clientX, off0: scene.audio.offset || 0, moved: false, pid: e.pointerId, o: null }; scr.setPointerCapture(e.pointerId); return; }
    if (!m || !t.dataset.id || t.dataset.id !== sel) return;
    const o = selObj(); if (!o) return;
    tdrag = { mode: m, o, x0: e.clientX, snap0: clone(o), i: +t.dataset.i, kt: +t.dataset.t, moved: false, pid: e.pointerId, kids: m === 'move' ? descendants(o).map(c => [c, clone(c)]) : [] };
    scr.setPointerCapture(e.pointerId);
  });
  scr.addEventListener('pointermove', e => {
    if (!tdrag) return;
    const d = snap((e.clientX - tdrag.x0) / pps);
    if (!tdrag.moved && Math.abs(e.clientX - tdrag.x0) < 5) return;
    tdrag.moved = true;
    if (tdrag.mode === 'audio') { scene.audio.offset = round(tdrag.off0 + d); dirty = true; renderTimeline(); return; }
    const o = tdrag.o, s = tdrag.snap0;
    // snap to markers
    const snapM = (v0, dd) => { for (const m of scene.markers || []) if (Math.abs(v0 + dd - m) < 6 / pps * 2) return m - v0; return dd; };
    if (tdrag.mode === 'move') {
      let dd = Math.max(-s.start, d);
      const a = snapM(s.start, dd); if (a !== dd) dd = a; else dd = snapM(s.end, dd);
      o.start = round(s.start + dd); o.end = round(s.end + dd);
      o.emph = s.emph.map(x => Object.assign({}, x, { t: round(x.t + dd) }));
      o.keys = Object.fromEntries(Object.entries(s.keys).map(([k, v]) => [k, v.map(q => ({ t: round(q.t + dd), v: q.v, ease: q.ease }))]));
      for (const [c, c0] of tdrag.kids) {
        c.start = round(c0.start + dd); c.end = round(c0.end + dd);
        c.emph = (c0.emph || []).map(x => Object.assign({}, x, { t: round(x.t + dd) }));
        c.keys = Object.fromEntries(Object.entries(c0.keys || {}).map(([k, v]) => [k, v.map(q => ({ t: round(q.t + dd), v: q.v, ease: q.ease }))]));
      }
    } else if (tdrag.mode === 'left') o.start = round(Math.max(0, Math.min(s.start + snapM(s.start, d), s.end - 0.2)));
    else if (tdrag.mode === 'right') o.end = round(Math.max(s.end + snapM(s.end, d), s.start + 0.2));
    else if (tdrag.mode === 'emph') o.emph[tdrag.i].t = round(Math.max(0, s.emph[tdrag.i].t + d));
    else if (tdrag.mode === 'key') {
      const nt = round(Math.max(0, tdrag.kt + d));
      o.keys = Object.fromEntries(Object.entries(s.keys).map(([k, v]) => [k, v.map(q => Math.abs(q.t - tdrag.kt) < 1e-6 ? { t: nt, v: q.v, ease: q.ease } : q).sort((a, b) => a.t - b.t)]));
    }
    if (o.end > scene.duration) scene.duration = Math.ceil(o.end);
    dirty = true;
    renderTimeline();
  });
  const tup = () => {
    if (!tdrag) return;
    const td = tdrag;
    setTimeout(() => { tdrag = null; }, 0);
    if (!td.moved) { if (td.mode === 'key') setTime(td.kt); else if (td.mode === 'emph') setTime(td.o.emph[td.i].t); return; }
    if (td.mode === 'audio') { commit(); renderTimeline(); return; }
    scene.objects.forEach(x => { if (MORPH(x.anOut.type) && x.anOut.target) { const t = scene.objects.find(y => y.id === x.anOut.target); if (t && (x === td.o || t === td.o)) { if (t === td.o) x.end = t.start; else { const len = t.end - t.start; t.start = x.end; t.end = round(t.start + len); } } } });
    commit(); renderTimeline(); refreshSheet();
  };
  scr.addEventListener('pointerup', tup); scr.addEventListener('pointercancel', tup);
  // pinch to zoom the timeline
  let pinch = null;
  scr.addEventListener('touchstart', e => { if (e.touches.length === 2) { pinch = { d: Math.abs(e.touches[0].clientX - e.touches[1].clientX) || 1, p: pps }; } }, { passive: true });
  scr.addEventListener('touchmove', e => {
    if (pinch && e.touches.length === 2) { e.preventDefault(); const d = Math.abs(e.touches[0].clientX - e.touches[1].clientX) || 1; pps = Math.max(12, Math.min(320, pinch.p * d / pinch.d)); renderTimeline(); }
  }, { passive: false });
  scr.addEventListener('touchend', () => { pinch = null; });

  // ---------- export ----------
  function pickMime(withAudio) {
    if (typeof MediaRecorder === 'undefined') return null;
    const c = withAudio ? ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      : ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    return c.find(m => MediaRecorder.isTypeSupported(m)) || '';
  }
  function exportSize(short) {
    const r = ratio(scene.aspect);
    return r >= 1 ? [Math.round(short * r / 2) * 2, short] : [short, Math.round(short / r / 2) * 2];
  }
  const slug = () => (scene.name || 'animation').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'animation';
  function download(name, blob) { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); }
  function openExport() {
    setPlaying(false);
    const dlg = $('#exportDlg'); dlg.textContent = '';
    const withAudio = !!(scene.audio && sound.buf);
    const mime = window.VidEnc && VidEnc.supported() ? 'video/mp4' : pickMime(withAudio);
    const res = selectInput([['720', '720p'], ['1080', '1080p'], ['1440', '1440p'], ['2160', '4K (slow on phones)']], '1080', () => info());
    const fps = selectInput([['30', '30 fps'], ['60', '60 fps']], '30', () => {});
    const sz = h('p', { class: 'muted small' });
    function info() { const [W, H] = exportSize(+res.value); sz.textContent = W + ' × ' + H + ' · ' + scene.aspect + ' · ' + fmtT(scene.duration) + ' · ' + (mime === null ? 'this browser can’t record video' : mime.includes('mp4') ? 'MP4' : 'WebM') + (withAudio ? ' · with sound' : scene.audio ? ' · sound not loaded, so silent' : ''); }
    info();
    const prog = h('progress', { max: 1, value: 0, hidden: true });
    const status = h('p', { class: 'small', 'aria-live': 'polite' });
    const out = h('div', { class: 'exportout' });
    let cancel = null;
    const go = h('button', { type: 'button', class: 'btn primary', disabled: mime === null, onclick: () => {
      go.disabled = true; prog.hidden = false; out.textContent = '';
      cancel = recordVideo(+res.value, +fps.value, mime, withAudio, (p, msg) => { prog.value = p; status.textContent = msg; }, (blob, ext) => {
        go.disabled = false; prog.hidden = true;
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        out.append(h('video', { src: url, controls: true, playsinline: true, loop: true }));
        out.append(h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: () => download(slug() + ext, blob) }, '⤓ Save video'),
          h('button', { type: 'button', class: 'btn primary', onclick: async () => { const id = await sendToFinal(blob, scene.name || 'Scene'); dlg.close(); openStudio('final', { kind: 'media:' + id }); } }, '🎬 Send to Final Stage')));
        if (inFrame) out.append(h('p', { class: 'muted small' }, 'This preview inside Claude can’t save files, so Save may do nothing here. It works in the version you install from GitHub.'));
      });
    } }, '● Record video');
    const png = h('button', { type: 'button', class: 'btn', onclick: () => {
      const [W, H] = exportSize(+res.value);
      const c = h('canvas'); c.width = W; c.height = H;
      A.render(c.getContext('2d'), scene, time, W, H);
      c.toBlob(b => { out.textContent = ''; out.append(h('img', { src: URL.createObjectURL(b), alt: 'Frame at ' + fmtT(time) })); out.append(h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: () => download(slug() + '-' + time.toFixed(1) + 's.png', b) }, '⤓ Save image'))); }, 'image/png');
    } }, '◻ This frame as an image');
    dlg.append(h('div', { class: 'dlg' },
      h('h2', {}, 'Export'),
      h('div', { class: 'two' }, field('Resolution', res), field('Frame rate', fps)), sz,
      h('p', { class: 'muted small' }, window.VidEnc && VidEnc.supported() ? 'Every frame is drawn and encoded in turn, so the video is smooth even when the scene is heavy. Keep the screen on until it finishes.' : 'This browser records in real time, so it takes as long as the scene. Keep the screen on until it finishes.'),
      prog, status, out,
      h('div', { class: 'row' }, go, png, h('span', { class: 'grow' }), h('button', { type: 'button', class: 'btn quiet', onclick: () => { if (cancel) cancel(); dlg.close(); } }, 'Close'))));
    dlg.showModal();
  }
  // frame by frame: every frame is drawn and encoded, however long it takes, so nothing is skipped
  function encodeVideo(short, fps, withAudio, onProg, onDone) {
    const [W, H] = exportSize(short);
    const c = h('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d');
    let cancelled = false; const t0 = performance.now();
    VidEnc.encode({ W, H, fps, duration: scene.duration, cancelled: () => cancelled,
      draw: (i, t) => { A.render(ctx, scene, Math.min(t, scene.duration), W, H); return c; },
      sounds: withAudio ? [{ buffer: sound.buf, at: scene.audio.offset || 0, vol: scene.audio.vol == null ? 1 : scene.audio.vol }] : [],
      onProg: (p, msg) => { const el = (performance.now() - t0) / 1000, left = p > 0.02 ? el / p - el : 0; onProg(p, msg + (left > 2 ? ' · about ' + fmtT(left) + ' left' : '')); } })
      .then(r => {
        if (!r) { onProg(0, 'Cancelled.'); onDone(null); return; }
        onProg(1, 'Done: ' + (r.blob.size / 1e6).toFixed(1) + ' MB MP4, every frame at ' + fps + ' fps' + (r.soundSkipped ? ' (silent: this device couldn’t encode the sound)' : '') + '.');
        if (!inFrame) download(slug() + '.mp4', r.blob);
        onDone(r.blob, '.mp4');
      })
      .catch(e => { onProg(0, 'Couldn’t export: ' + (e.message || e)); onDone(null); });
    return () => { cancelled = true; };
  }
  function recordVideo(short, fps, mime, withAudio, onProg, onDone) {
    if (window.VidEnc && VidEnc.supported() && (!withAudio || typeof AudioEncoder !== 'undefined')) return encodeVideo(short, fps, withAudio, onProg, onDone);
    const [W, H] = exportSize(short);
    const c = h('canvas', { style: 'position:fixed;left:-99999px;top:0;width:10px;height:10px' }); c.width = W; c.height = H;
    document.body.append(c);
    const ctx = c.getContext('2d');
    A.render(ctx, scene, 0, W, H);
    let rec, ac = null, src = null;
    let stream = c.captureStream(fps);
    if (withAudio) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        ac = new AC();
        const dest = ac.createMediaStreamDestination(), gain = ac.createGain();
        gain.gain.value = scene.audio.vol == null ? 1 : scene.audio.vol;
        src = ac.createBufferSource(); src.buffer = sound.buf; src.connect(gain); gain.connect(dest);
        stream = new MediaStream([...stream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
      } catch (e) { ac = null; src = null; }
    }
    try { rec = new MediaRecorder(stream, Object.assign(mime ? { mimeType: mime } : {}, { videoBitsPerSecond: Math.round(Math.min(40e6, W * H * fps * 0.12)) })); }
    catch (e) { onProg(0, 'This browser can’t record video: ' + e.message); onDone(null); c.remove(); return null; }
    const chunks = [];
    let stopped = false, raf = 0;
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      cancelAnimationFrame(raf); c.remove();
      try { if (src) src.stop(); if (ac && ac.close) ac.close(); } catch (e) {}
      if (stopped === 'cancel') { onProg(0, 'Cancelled.'); onDone(null); return; }
      const type = rec.mimeType || mime || 'video/webm';
      const blob = new Blob(chunks, { type });
      const ext = type.includes('mp4') ? '.mp4' : '.webm';
      onProg(1, 'Done: ' + (blob.size / 1e6).toFixed(1) + ' MB ' + (ext === '.mp4' ? 'MP4' : 'WebM') + '.');
      if (!inFrame) download(slug() + ext, blob);
      onDone(blob, ext);
    };
    rec.start(500);
    if (src) { const off = scene.audio.offset || 0; if (ac.resume) ac.resume(); src.start(ac.currentTime + Math.max(0, off), Math.max(0, -off)); }
    const start = performance.now(), D = scene.duration;
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      A.render(ctx, scene, Math.min(t, D), W, H);
      onProg(Math.min(1, t / D), 'Recording… ' + fmtT(Math.min(t, D)) + ' of ' + fmtT(D));
      if (t >= D + 0.25) { stopped = true; rec.stop(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { if (!stopped) { stopped = 'cancel'; rec.stop(); } };
  }

  // ---------- project menu ----------
  function openMenu() {
    const dlg = $('#menuDlg'); dlg.textContent = '';
    const act = (label, fn, cls) => h('button', { type: 'button', class: 'btn ' + (cls || ''), onclick: () => { dlg.close(); fn(); } }, label);
    const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0]; if (!f) return;
      try {
        const s = JSON.parse(await f.text()); if (!s.objects) throw new Error('that file isn’t an Animath project');
        if (s.media) { for (const [id, u] of Object.entries(s.media)) { try { await putMedia(id, await dataURLToBlob(u)); } catch (e) {} } delete s.media; }
        sound.id = null; createProject(s); toast('Opened “' + s.name + '”');
      } catch (e) { toast('Couldn’t open it: ' + e.message); }
    });
    dlg.append(h('div', { class: 'dlg' }, h('h2', {}, 'Projects'), h('div', { class: 'menu' },
      act('＋ New blank project', () => createProject(newScene('Untitled ' + (index().length + 1)))),
      act('＋ New copy of the demo', () => createProject(demoScene())),
      act('⧉ Duplicate this project', () => { const s = clone(scene); s.name += ' copy'; createProject(s); }),
      act('⤓ Save project file (.json)', async () => {
        const s = clone(scene), media = {};
        for (const id of mediaIds(scene)) { const b = await getMedia(id); if (b) media[id] = await blobToDataURL(b); }
        if (Object.keys(media).length) s.media = media;
        download(slug() + '.biostudio.json', new Blob([JSON.stringify(s, null, 1)], { type: 'application/json' }));
      }),
      act('</> Manim Python code', () => openSheet('code')),
      act('＋ New copy of the features tour', () => createProject(tourScene())),
      act('⤒ Open a project file', () => fileIn.click()),
      act('⌫ Delete this project', async () => {
        if (!await ask('Delete “' + scene.name + '”? This can’t be undone.', 'Delete')) return;
        store.del('bstudio.p.' + projId);
        store.set('bstudio.index', index().filter(p => p.id !== projId));
        const next = index()[0];
        if (!(next && openProject(next.id))) createProject(demoScene());
      }, 'quiet')),
      h('p', { class: 'muted small' }, inFrame ? 'In this preview, projects are kept in this browser only. Saving and opening files works in the version you install from GitHub.' : 'Projects are saved in this app on this device. Save a project file now and then as a backup.'),
      fileIn,
      h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn quiet', onclick: () => dlg.close() }, 'Close'))));
    dlg.showModal();
  }

  // ---------- demo ----------
  function demoScene() {
    const s = newScene('Demo');
    s.duration = 26;
    const keep = scene, keepT = time; scene = s;
    const O = (type, over) => { time = over.start; const o = makeObj(type, over); s.objects.push(o); return o; };
    O('title', { name: 'Title', start: 0, end: 3.6, props: { title: 'Animath', subtitle: 'Manim-style animation, on your phone' }, anIn: { type: 'write', dur: 1.6, rate: 'linear' } });
    const e1 = O('math', { name: 'Euler', start: 3.6, end: 6.6, props: { tex: 'e^{i\\pi} + 1 = 0', size: 1.3 } });
    const e2 = O('math', { name: 'Basel', start: 6.6, end: 10, props: { tex: '\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}', size: 1.1 }, emph: [{ type: 'circumscribe', t: 7.6, dur: 1.4 }] });
    e1.anOut = { type: 'transform', target: e2.id, dur: 1.2, rate: 'smooth' }; e2.anIn = { type: 'appear', dur: 0.5 };
    O('graph', { name: 'Graph', start: 10, end: 16, props: { f2: 'cos(x)', l2: '\\cos x', tracer: true }, anIn: { type: 'create', dur: 2.2, rate: 'smooth' } });
    O('venn', { name: 'Venn', start: 16, end: 21.5, x: -3.3, y: 0.2, scale: 0.85, props: { shade: 'A ∩ B' }, anIn: { type: 'create', dur: 1.5 } });
    O('truth', { name: 'Truth table', start: 16.6, end: 21.5, x: 3.4, y: 0, props: { formula: '(P -> Q) & P -> Q' }, emph: [{ type: 'indicate', t: 19.3, dur: 1 }] });
    O('sticker', { name: 'Sparkle', start: 18.6, end: 21.5, x: 6, y: 3, scale: 0.6, props: { kind: 'sparkle' }, anIn: { type: 'spin', dur: 0.8 }, loop: 'pulse' });
    const sq = O('shape', { name: 'Square', start: 21.5, end: 23.2, x: -2, props: { shape: 'square', fill: 'BLUE', fo: 0.5, color: 'BLUE' } });
    const ci = O('shape', { name: 'Circle', start: 23.2, end: 26, x: -2, props: { shape: 'circle', color: 'PINK', fill: 'PINK', fo: 0.5 }, keys: { x: [{ t: 23.6, v: -2 }, { t: 25, v: 2 }] } });
    sq.anOut = { type: 'transform', target: ci.id, dur: 1, rate: 'smooth' }; ci.anIn = { type: 'appear', dur: 0.5 };
    scene = keep; time = keepT;
    return s;
  }

  // a short scene that shows rigs, live values, graph riding, camera, paths, matching transforms and curved text
  function tourScene() {
    const s = newScene('Features tour');
    s.duration = 21;
    const keep = scene, keepT = time; scene = s;
    const O = (type, over) => { time = over.start; const o = makeObj(type, over); s.objects.push(o); return o; };
    O('title', { name: 'Title', start: 0, end: 3, props: { title: 'What’s new', subtitle: 'Rigs · live values · camera · paths' }, anIn: { type: 'write', dur: 1.4, rate: 'linear' } });
    s.vars = [{ name: 'a', v: -5, keys: [{ t: 4, v: -5 }, { t: 9, v: 5, ease: 'smooth' }] }];
    const g = O('graph', { name: 'Graph', start: 3, end: 11.5, props: { f1: 'sin(x) + x/4', l1: '' }, anIn: { type: 'create', dur: 1.5 } });
    O('shape', { name: 'Rider', start: 3.6, end: 11.5, scale: 2.2, props: { shape: 'dot', color: 'YELLOW' }, attach: { to: g.id, fn: 1, x: 'a', tilt: false }, anIn: { type: 'spring', dur: 0.8 } });
    O('math', { name: 'Readout', start: 3.6, end: 11.5, x: -4.5, y: 3.2, props: { tex: 'x = [[a:2]]', size: 0.8, color: 'YELLOW' }, anIn: { type: 'fadein', dur: 0.5 } });
    s.camera = { x: 0, y: 0, zoom: 1, rotation: 0, keys: { x: [{ t: 8, v: 0 }, { t: 9.3, v: 3.6 }, { t: 10.6, v: 0 }], y: [{ t: 8, v: 0 }, { t: 9.3, v: 0.6 }, { t: 10.6, v: 0 }], zoom: [{ t: 8, v: 1 }, { t: 9.3, v: 1.9, ease: 'spring' }, { t: 10.6, v: 1 }] } };
    const e1 = O('math', { name: 'Pythagoras', start: 11.5, end: 14, props: { tex: 'a^2 + b^2 = c^2', size: 1.2 } });
    const e2 = O('math', { name: 'Rearranged', start: 14, end: 16, props: { tex: 'a^2 = c^2 - b^2', size: 1.2 }, anIn: { type: 'appear', dur: 0.5 }, anOut: { type: 'fadeout', dur: 0.5 } });
    e1.anOut = { type: 'transformMatch', target: e2.id, dur: 1.4, rate: 'smooth' };
    const grp = O('group', { name: 'Pendulum', start: 16, end: 21, x: -3.5, y: 2.6, anIn: { type: 'fadein', dur: 0.5 }, anOut: { type: 'none', dur: 0 }, loop: 'pendulum' });
    O('shape', { name: 'Rod', start: 16, end: 21, parent: grp.id, x: 0, y: -1.3, rotation: 90, props: { shape: 'line', len: 2.6, color: 'GREY' }, anIn: { type: 'appear', dur: 0 }, anOut: { type: 'none', dur: 0 } });
    O('shape', { name: 'Bob', start: 16, end: 21, parent: grp.id, x: 0, y: -2.75, props: { shape: 'circle', r: 0.35, color: 'GOLD', fill: 'GOLD', fo: 0.9 }, anIn: { type: 'appear', dur: 0 }, anOut: { type: 'none', dur: 0 } });
    const path = O('vector', { name: 'Path', start: 16, end: 21, x: 2.6, y: -0.6, style: { dash: 'dashed', arrow: 'end' }, anIn: { type: 'create', dur: 1 },
      props: { paths: [{ nodes: [{ x: -2.4, y: 1.2, ox: 1.2, oy: -2.4 }, { x: 0, y: 0, ix: -0.8, iy: 0.8, ox: 0.8, oy: -0.8, smooth: true }, { x: 2.4, y: -1.2, ix: -1.2, iy: 2.4 }], closed: false, stroke: 'BLUE', sw: 3, fill: '', fo: 1 }] } });
    O('sticker', { name: 'Traveller', start: 16.8, end: 21, scale: 0.4, props: { kind: 'arrow' }, path: { to: path.id, ease: 'smooth', orient: true }, loop: 'none', anIn: { type: 'pop', dur: 0.4 } });
    O('textpath', { name: 'Arc title', start: 16.4, end: 21, y: 3.1, x: 2.6, props: { text: 'Rigs and paths', shape: 'arc', bend: 0.3, size: 0.55, color: 'TEAL' }, style: { grad: 'PINK', gangle: 0 }, anIn: { type: 'write', dur: 1, rate: 'linear' } });
    scene = keep; time = keepT;
    return s;
  }

  // ---------- wiring ----------

  // =====================================================================================
  // Psi Phi Studio additions: 3D objects, insert menus, tool dock trays, tablet panel
  // =====================================================================================
  const B3 = window.Bio3D;
  const is3D = o => !!(o && B3 && B3.is3D(o.type));
  if (B3) {
    B3.setMediaGetter(getMedia);
    B3.onReady(() => { dirty = true; if (sheetKind === 'edit') refreshSheetIfNotTyping(); });
    B3.toast = toast;
  }
  const wide = () => !narrow();

  // ---------- small dialogs ----------
  function promptDlg(title, label, placeholder, okLabel, initial, note) {
    return new Promise(res => {
      const d = h('dialog', { class: 'ask' });
      const inp = h('input', { type: 'text', placeholder: placeholder || '', value: initial || '', spellcheck: 'false', autocapitalize: 'off' });
      const done = v => { d.close(); res(v); };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') done(inp.value.trim() || null); });
      d.append(h('div', { class: 'dlg' }, h('h2', {}, title), field(label, inp), note ? h('p', { class: 'muted small' }, note) : null,
        h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn quiet', onclick: () => done(null) }, 'Cancel'),
          h('button', { type: 'button', class: 'btn primary', onclick: () => done(inp.value.trim() || null) }, okLabel || 'OK'))));
      d.addEventListener('close', () => setTimeout(() => d.remove(), 50));
      document.body.append(d); d.showModal(); setTimeout(() => inp.focus(), 50);
    });
  }
  function chooseDlg(title, items, note) {
    return new Promise(res => {
      const d = h('dialog', { class: 'ask' });
      const list = h('div', { class: 'chooser' }, items.map(it => h('button', { type: 'button', class: 'choice', onclick: () => { d.close(); res(it.value); } }, h('b', {}, it.label), it.sub ? h('span', { class: 'muted small' }, it.sub) : null)));
      d.append(h('div', { class: 'dlg' }, h('h2', {}, title), note ? h('p', { class: 'muted small' }, note) : null, list,
        h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn quiet', onclick: () => { d.close(); res(null); } }, 'Cancel'))));
      d.addEventListener('close', () => setTimeout(() => d.remove(), 50));
      document.body.append(d); d.showModal();
    });
  }
  const offlineNote = inFrame ? ' Inside the Claude preview the internet is blocked, so this only works in the version on GitHub Pages.' : '';

  // ---------- inserting 3D things ----------
  async function loadPDB(id) {
    id = String(id || '').trim().toUpperCase();
    if (!/^[0-9][A-Z0-9]{3}$/.test(id)) { toast('A PDB ID is four characters, like 1GFL or 4HHB.'); return; }
    toast('Fetching ' + id + ' from the RCSB…');
    let r = null;
    try { r = await B3.fetchPDBText(id); } catch (e) { r = null; }
    if (!r) { toast('Couldn’t reach the RCSB for ' + id + '.' + offlineNote + ' You can also download the file from rcsb.org and use Open file.'); return; }
    const mid = 'pdb_' + uid();
    await putMedia(mid, new Blob([r.text], { type: 'text/plain' }));
    addObj('pdb', { name: id, props: { src: mid, title: id, color: 'ss' } });
  }
  async function askPDB() { const id = await promptDlg('Fetch a protein', 'PDB ID', 'e.g. 1GFL', 'Fetch', '', 'Downloads the structure from the RCSB Protein Data Bank.' + offlineNote); if (id) loadPDB(id); }
  async function searchPDB(q) {
    q = q || await promptDlg('Search the Protein Data Bank', 'Search words', 'e.g. claudin, GLUT1, haemoglobin', 'Search', '', offlineNote.trim() || null);
    if (!q) return;
    toast('Searching the RCSB…');
    let res;
    try { res = await B3.searchRCSB(q); } catch (e) { toast('Search didn’t work: ' + e.message + '.' + offlineNote); return; }
    if (!res.length) { toast('No entries found for “' + q + '”.'); return; }
    const pick = await chooseDlg('Results for “' + q + '”', res.map(r => ({ label: r.id, sub: r.title, value: r.id })));
    if (pick) loadPDB(pick);
  }
  async function openStructureFile(file) {
    const f = file instanceof Blob ? file : await pickFile('.pdb,.ent,.cif,.mmcif,.txt'); if (!f) return;
    const text = await f.text();
    try { const raw = /_atom_site\./.test(text) ? B3.parseCIF(text) : B3.parsePDB(text); if (!raw.atoms.length) throw new Error('no atoms found'); }
    catch (e) { toast('That doesn’t look like a PDB or mmCIF file (' + e.message + ').'); return; }
    const mid = 'pdb_' + uid(); await putMedia(mid, f);
    const nm = f.name.replace(/\.[^.]+$/, '').slice(0, 24);
    addObj('pdb', { name: nm, props: { src: mid, title: nm, color: 'ss' } });
  }
  function moleculeFromSMILES(smiles, name) {
    try { B3.parseSMILES(smiles); } catch (e) { toast('Couldn’t read that SMILES: ' + e.message); return; }
    addObj('molecule', { name: name || 'Molecule', props: { smiles, sdf: '', title: name || 'Molecule' } });
  }
  async function moleculeByName(name) {
    name = name || await promptDlg('Molecule by name', 'Name (common or IUPAC)', 'e.g. caffeine, serotonin, 2-acetoxybenzoic acid', 'Find', '', 'Looks the name up on PubChem and uses its 3D structure.' + (inFrame ? ' In this preview the internet is blocked, so only common names that are built in will work (glucose, caffeine, dopamine, serotonin, GABA, ATP and others).' : ''));
    if (!name) return;
    const key = name.trim().toLowerCase(), local = B3.NAME_SMILES[key];
    let r = null;
    if (!inFrame || !local) { toast('Looking up “' + name + '” on PubChem…'); try { r = await B3.fetchPubChem(name); } catch (e) { r = null; } }
    const pretty = name.trim().replace(/^./, c => c.toUpperCase());
    if (r && r.sdf) {
      const mid = 'sdf_' + uid(); await putMedia(mid, new Blob([r.sdf], { type: 'chemical/x-mdl-sdfile' }));
      addObj('molecule', { name: pretty.slice(0, 24), props: { sdf: mid, smiles: local || 'C', title: pretty } });
      if (r.rec === '2d') toast('PubChem has no 3D model for this one, so its shape is built from the bonds.');
      return;
    }
    if (local) { moleculeFromSMILES(local, pretty); return; }
    toast('Couldn’t find “' + name + '”.' + offlineNote + ' Try a SMILES string instead.');
  }
  async function askSMILES() { const s = await promptDlg('Molecule from SMILES', 'SMILES', 'e.g. CC(=O)Oc1ccccc1C(=O)O', 'Build'); if (s) moleculeFromSMILES(s, 'Molecule'); }
  async function importPaper(files) { return addPapers(files); }
  // ---------- ClayForm: sculpt, rig and pose in a full-screen editor, then bring the result in ----------
  let clay = null;
  function openClay(opts, editObj) {
    if (clay) return;
    if (playing) setPlaying(false);
    closeTray(); closeMenus();
    const q = opts.proj ? 'proj=' + encodeURIComponent(opts.proj) : 'new=' + (opts.kind || 'head');
    const frame = h('iframe', { src: 'clayform.html?embed=1&' + q + '&t=' + Date.now(), allow: 'camera; fullscreen; gamepad', title: 'ClayForm' });
    const useBtn = h('button', { type: 'button', class: 'btn primary', disabled: true }, 'Loading ClayForm…');
    const close = () => { removeEventListener('message', onMsg); clearInterval(pinger); ov.remove(); clay = null; };
    const cancel = h('button', { type: 'button', class: 'btn quiet', onclick: async () => { if (await ask('Leave ClayForm without bringing the sculpt into your scene? (ClayForm keeps its own copy.)', 'Leave')) close(); } }, 'Cancel');
    const ov = h('div', { class: 'clay-ov', role: 'dialog', 'aria-label': 'ClayForm' },
      h('div', { class: 'clay-bar' }, h('b', {}, '◕ ClayForm'), h('span', { class: 'muted small' }, 'Sculpt · Objects · Rig · Pose · Stage. When you’re happy, bring it into the scene with its rig and animation.'), h('span', { class: 'grow' }), cancel, useBtn),
      frame);
    let waiting = null, pinger = null, isReady = false;
    // ask until ClayForm answers, so a missed "ready" can't leave the button stuck
    frame.addEventListener('load', () => { clearInterval(pinger); pinger = setInterval(() => { if (isReady || !document.body.contains(frame)) return clearInterval(pinger); try { frame.contentWindow.postMessage({ type: 'cf-ping' }, '*'); } catch (e) { } }, 1000); });
    function onMsg(e) {
      if (e.source !== frame.contentWindow) return;
      const d = e.data || {};
      if (d.type === 'cf-ready') { isReady = true; clearInterval(pinger); useBtn.disabled = false; useBtn.textContent = editObj ? '✓ Update in scene' : '✓ Use in scene'; }
      else if (d.type === 'cf-error') { clearTimeout(waiting); useBtn.disabled = false; useBtn.textContent = '✓ Try again'; toast('ClayForm couldn’t export: ' + d.message); }
      else if (d.type === 'cf-glb') {
        clearTimeout(waiting);
        (async () => {
          const mid = 'glb_' + uid();
          await putMedia(mid, new Blob([d.buf], { type: 'model/gltf-binary' }));
          const name = (d.name || 'Sculpt').slice(0, 24);
          if (editObj && objById(editObj.id)) { editObj.props.src = mid; editObj.props.cfId = d.projId; commit(); dirty = true; select(editObj.id); toast('Updated “' + editObj.name + '”.'); }
          else addObj('sculpt', { name, props: { src: mid, cfId: d.projId, title: name } });
          close();
        })();
      }
    }
    addEventListener('message', onMsg);
    useBtn.addEventListener('click', () => {
      useBtn.disabled = true; useBtn.textContent = 'Exporting…';
      try { frame.contentWindow.postMessage({ type: 'cf-export' }, '*'); } catch (e) { toast('Couldn’t reach ClayForm.'); }
      waiting = setTimeout(() => { useBtn.disabled = false; useBtn.textContent = '✓ Try again'; toast('ClayForm didn’t answer. Try again in a moment.'); }, 20000);
    });
    setTimeout(() => { if (useBtn.disabled && useBtn.textContent.startsWith('Loading')) { useBtn.disabled = false; useBtn.textContent = editObj ? '✓ Update in scene' : '✓ Use in scene'; } }, 8000);
    document.body.append(ov);
    clay = { ov, frame };
  }
  // ---------- Tabula (painting and frame-by-frame animation) and 8-Bit (pixel art): full-screen studios, like ClayForm ----------
  const STUDIOS = {
    art: { file: 'tabula.html', title: '🖌 Tabula', help: 'Paint, ink and animate frame by frame. Two-finger tap undoes, three-finger tap redoes, pinch to zoom.', name: 'Tabula' },
    px: { file: '8bit.html', title: '▦ 8-Bit', help: 'Pixels, palettes, layers and frames. Two-finger tap undoes, three-finger tap redoes, pinch to zoom.', name: '8-Bit' },
    logos: { file: 'logos.html', title: '¶ Logos', help: 'Write documents and scripts. Select text, a table or a picture and tap Use in scene, or show the whole document beside the stage.', name: 'Logos' },
    final: { file: 'finalstage.html', title: '🎬 Final Stage', help: 'Cut, arrange, add titles, music and effects, then export the finished video.', name: 'Final Stage', noUse: true },
    calc: { file: 'calsheet.html', title: '▦ Calsheet', help: 'Numbers, formulas and charts. Select cells and tap Use in scene for a table or chart, or show the sheet beside the stage.', name: 'Calsheet' }
  };
  // put a finished video into Final Stage's media library (same device, its own database)
  async function sendToFinal(blob, name) {
    const id = 'm_' + uid();
    const db = await openDB('psiphi-final', 'media');
    await new Promise((res, rej) => { const t = db.transaction('media', 'readwrite'); t.objectStore('media').put({ id, name: (name || 'Video').slice(0, 40), type: blob.type || 'video/mp4', blob, created: Date.now() }); t.oncomplete = res; t.onerror = () => rej(t.error); });
    db.close(); return id;
  }
  function openStudio(app, opts, editObj) {
    if (clay) return;
    const S = STUDIOS[app]; if (playing) setPlaying(false);
    closeTray(); closeMenus();
    const q = opts.proj ? 'proj=' + encodeURIComponent(opts.proj) : 'new=' + encodeURIComponent(opts.kind || '');
    const frame = h('iframe', { src: S.file + '?embed=1&' + q + '&t=' + Date.now(), allow: 'fullscreen; clipboard-read; clipboard-write', title: S.name });
    const label = editObj ? '✓ Update in scene' : '✓ Use in scene';
    const useBtn = h('button', { type: 'button', class: 'btn primary', disabled: true }, 'Loading…');
    let waiting = null, pinger = null, isReady = false;
    const close = () => { removeEventListener('message', onMsg); clearInterval(pinger); ov.remove(); clay = null; if (reader) setTimeout(() => reader && reader.refresh(), 300); };
    const cancel = h('button', { type: 'button', class: 'btn quiet', onclick: async () => { if (await ask('Leave ' + S.name + ' without bringing it into your scene? (' + S.name + ' keeps its own copy.)', 'Leave')) close(); } }, 'Cancel');
    const ov = h('div', { class: 'clay-ov', role: 'dialog', 'aria-label': S.name },
      h('div', { class: 'clay-bar' }, h('b', {}, S.title), h('span', { class: 'muted small' }, S.help), h('span', { class: 'grow' }), S.noUse ? h('button', { type: 'button', class: 'btn primary', onclick: () => { try { frame.contentWindow.postMessage({ type: 'st-save' }, '*'); } catch (e) { } setTimeout(close, 250); } }, '✓ Done') : cancel, S.noUse ? null : useBtn), frame);
    frame.addEventListener('load', () => { clearInterval(pinger); pinger = setInterval(() => { if (isReady || !document.body.contains(frame)) return clearInterval(pinger); try { frame.contentWindow.postMessage({ type: 'st-ping' }, '*'); } catch (e) { } }, 1000); });
    const reset = () => { clearTimeout(waiting); useBtn.disabled = false; useBtn.textContent = label; };
    async function storeFrames(bufs) { const ids = []; for (const buf of bufs) { const id = 'art_' + uid(), blob = new Blob([buf], { type: 'image/png' }); await putMedia(id, blob); await A.setImage(id, URL.createObjectURL(blob)); ids.push(id); } return ids; }
    function onMsg(e) {
      if (e.source !== frame.contentWindow) return;
      const d = e.data || {};
      if (d.type === 'st-ready') { isReady = true; clearInterval(pinger); reset(); }
      else if (d.type === 'st-cancel') reset();
      else if (d.type === 'st-error') { reset(); toast(S.name + ' couldn’t export: ' + d.message); }
      else if (d.type === 'st-result') {
        clearTimeout(waiting);
        (async () => {
          const name = (d.name || S.name).slice(0, 24), ar = round(d.h / d.w, 4), fit = round(Math.min(6, 5 / ar), 2);
          if (['text', 'image', 'table', 'chart', 'panel'].includes(d.kind)) { await docResult(d, name, editObj); close(); return; }
          let props;
          if (d.kind === 'sprite') { const [id] = await storeFrames([d.buf]); props = { src: id, srcs: [], frames: d.frames, cols: d.cols, rows: d.rows, fps: d.fps, ar, pixelated: true, pxId: d.projId }; }
          else { const ids = await storeFrames(d.bufs); props = { srcs: ids, src: '', frames: ids.length, cols: 1, rows: 1, fps: d.fps || 12, loop: d.loop || 'loop', ar, pixelated: false, artId: d.projId }; }
          if (editObj && objById(editObj.id)) { Object.assign(editObj.props, props); commit(); dirty = true; select(editObj.id); toast('Updated “' + editObj.name + '”.'); }
          else { addObj('sprite', { name, props: Object.assign({ w: fit }, props) }); toast(props.frames > 1 ? 'Added a ' + props.frames + '-frame animation. Speed, looping and the frame to hold are in its panel.' : 'Added “' + name + '”.', 4000); }
          close();
        })();
      }
    }
    addEventListener('message', onMsg);
    useBtn.addEventListener('click', () => {
      useBtn.disabled = true; useBtn.textContent = 'Preparing…';
      try { frame.contentWindow.postMessage({ type: 'st-export' }, '*'); } catch (e) { toast('Couldn’t reach ' + S.name + '.'); }
      waiting = setTimeout(() => { reset(); toast(S.name + ' didn’t answer. Try again in a moment.'); }, 180000);
    });
    setTimeout(() => { if (useBtn.disabled && useBtn.textContent.startsWith('Loading')) reset(); }, 8000);
    document.body.append(ov);
    clay = { ov, frame };
  }
  // ---------- Logos and Calsheet results: text, picture, table, chart, or the side reader ----------
  async function docResult(d, name, editObj) {
    const link = d.app === 'calsheet' ? { calcId: d.projId, calcSheet: d.sheetId || '', calcRange: d.range || '' } : { logosId: d.projId };
    if (d.kind === 'panel') { openReader(d.source || d.app, d.projId); return; }
    let type, props;
    if (d.kind === 'text') {
      type = 'text'; props = { text: d.text || '', size: d.heading ? Math.max(0.9, d.size || 0.9) : d.size || 0.5, color: d.color || 'WHITE', font: d.font || 'main', style: d.style || '', align: d.align || 'left' };
    } else if (d.kind === 'image') {
      const id = 'doc_' + uid(), blob = new Blob([d.buf], { type: 'image/png' }); await putMedia(id, blob); await A.setImage(id, URL.createObjectURL(blob));
      const ar = round(d.h / d.w, 4); type = 'image'; props = { src: id, ar, w: round(Math.min(7, 5 / ar), 2) };
    } else if (d.kind === 'table') {
      type = 'table'; props = { csv: d.csv || '', header: d.header !== false, stripes: d.stripes !== false };
    } else {
      type = 'chart'; props = { kind: d.chart || 'bar', csv: d.csv || '', title: d.title || '', xlabel: d.xlabel || '', ylabel: d.ylabel || '', log: false };
    }
    Object.assign(props, link);
    if (editObj && objById(editObj.id) && editObj.type === type) { Object.assign(editObj.props, props); commit(); dirty = true; select(editObj.id); refreshSheet(); toast('Updated “' + editObj.name + '”.'); }
    else { addObj(type, { name: (type === 'text' ? (d.text || name).split('\n')[0] : name).slice(0, 24), props }); toast({ text: 'Added the text.', image: 'Added the selection as a picture.', table: 'Added a table. Its rows can appear one by one with the “create” entrance.', chart: 'Added an animated chart.' }[type], 3500); }
  }
  const editInDoc = o => o.props.calcId ? openStudio('calc', { proj: o.props.calcId }, o) : openStudio('logos', { proj: o.props.logosId }, o);

  // ---------- the reader: a document or sheet beside the stage, to read from while recording or editing ----------
  // It is only on screen in the editor, never in the exported video.
  let reader = null;
  const RD = store.get('psiphi-reader', { x: null, y: 90, w: 360, h: 460, font: 18, speed: 28, mode: 'auto', withPlay: true, guide: true, dark: true, last: null });
  const saveRD = () => store.set('psiphi-reader', RD);
  function openDB(name, storeName) {
    return new Promise((res, rej) => { const r = indexedDB.open(name); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(storeName)) r.result.createObjectStore(storeName, { keyPath: 'id' }); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }
  async function docList(source) {
    const [dbn, st] = source === 'calsheet' ? ['psiphi-calsheet', 'books'] : ['psiphi-logos', 'docs'];
    try { const db = await openDB(dbn, st); if (!db.objectStoreNames.contains(st)) { db.close(); return []; } const all = await new Promise((res, rej) => { const q = db.transaction(st).objectStore(st).getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); }); db.close(); return all.sort((a, b) => b.updated - a.updated); } catch (e) { return []; }
  }
  const escH = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function sheetHTML(s) {
    const v = s.view || []; if (!v.length) return '<p class="rd-empty">This sheet is empty.</p>';
    let html = '<table class="rd-sheet">';
    v.forEach((row, r) => { html += '<tr><th>' + (r + 1) + '</th>'; row.forEach(c => { if (!c) { html += '<td></td>'; return; } html += '<td class="' + (c[1] ? 'n' : '') + '" style="' + (c[2] ? 'font-weight:700;' : '') + (c[3] ? 'background:' + escH(c[3]) + ';color:#111;' : '') + '">' + escH(c[0]) + '</td>'; }); html += '</tr>'; });
    return html + '</table>';
  }
  async function openReader(source, id) {
    source = source === 'calsheet' ? 'calsheet' : 'logos';
    const list = await docList(source);
    if (!list.length) { toast(source === 'logos' ? 'No Logos documents yet. Write one first (Insert → Logos).' : 'No Calsheet spreadsheets yet. Make one first (Insert → Calsheet).', 4000); return; }
    const item = list.find(x => x.id === id) || list.find(x => RD.last && x.id === RD.last.id) || list[0];
    if (!reader) buildReader();
    reader.load(source, item, list);
  }
  function buildReader() {
    const box = h('div', { class: 'reader' + (RD.dark ? ' dark' : ''), role: 'complementary', 'aria-label': 'Reader' });
    const pick = h('select', { class: 'rd-pick', 'aria-label': 'Document' }), sheetPick = h('select', { class: 'rd-pick', hidden: true, 'aria-label': 'Sheet' });
    const body = h('div', { class: 'rd-body' }), content = h('div', { class: 'rd-content' }), guide = h('div', { class: 'rd-guide', hidden: !RD.guide });
    body.append(h('div', { class: 'rd-pad' }), content, h('div', { class: 'rd-pad' }));
    const playB = h('button', { type: 'button', class: 'rd-btn', title: 'Start or stop scrolling' }, '▶');
    const speed = h('input', { type: 'range', min: '4', max: '140', value: String(RD.speed), title: 'Scrolling speed', 'aria-label': 'Speed' });
    const mode = h('select', { class: 'rd-mode', 'aria-label': 'Scrolling' }, h('option', { value: 'manual' }, 'Scroll by hand'), h('option', { value: 'auto' }, 'Auto-scroll'), h('option', { value: 'follow' }, 'Follow the timeline'));
    mode.value = RD.mode;
    const withPlay = h('input', { type: 'checkbox' }); withPlay.checked = RD.withPlay;
    const guideC = h('input', { type: 'checkbox' }); guideC.checked = RD.guide;
    const darkC = h('input', { type: 'checkbox' }); darkC.checked = RD.dark;
    const opts = h('div', { class: 'rd-opts', hidden: true },
      h('label', {}, withPlay, h('span', {}, 'Start with ▶ Play and 🎙 Record')), h('label', {}, guideC, h('span', {}, 'Reading line')), h('label', {}, darkC, h('span', {}, 'Dark page')),
      h('p', { class: 'muted small' }, 'Follow the timeline: the page scrolls from top to bottom over the length of your scene, so it stays in step when you scrub. The reader never appears in exported videos.'));
    const bar = h('div', { class: 'rd-head' }, h('span', { class: 'rd-grip', title: 'Drag to move' }, '⠿'), pick, sheetPick, h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'rd-btn', title: 'Smaller text', onclick: () => font(-1) }, 'A−'), h('button', { type: 'button', class: 'rd-btn', title: 'Larger text', onclick: () => font(1) }, 'A+'),
      h('button', { type: 'button', class: 'rd-btn', title: 'Edit', onclick: () => { const s = state; if (s) openStudio(s.source === 'calsheet' ? 'calc' : 'logos', { proj: s.item.id }); } }, '✎'),
      h('button', { type: 'button', class: 'rd-btn', title: 'Minimise', onclick: () => box.classList.toggle('min') }, '▁'),
      h('button', { type: 'button', class: 'rd-btn', title: 'Close', onclick: () => reader.close() }, '✕'));
    const foot = h('div', { class: 'rd-foot' }, playB, mode, speed, h('button', { type: 'button', class: 'rd-btn', title: 'Back to the top', onclick: () => { body.scrollTop = 0; } }, '⤒'), h('button', { type: 'button', class: 'rd-btn', title: 'Options', onclick: () => { opts.hidden = !opts.hidden; } }, '⚙'));
    const rz = h('span', { class: 'rd-rz', title: 'Drag to resize' });
    box.append(bar, h('div', { class: 'rd-view' }, body, guide), opts, foot, rz);
    document.body.append(box);
    let state = null, running = false, last = 0, acc = 0;
    const place = () => { const W = innerWidth, H = innerHeight; RD.w = Math.max(240, Math.min(RD.w, W - 16)); RD.h = Math.max(200, Math.min(RD.h, H - 60)); if (RD.x == null) RD.x = W - RD.w - 12; RD.x = Math.max(4, Math.min(RD.x, W - 80)); RD.y = Math.max(4, Math.min(RD.y, H - 60)); Object.assign(box.style, { left: RD.x + 'px', top: RD.y + 'px', width: RD.w + 'px', height: RD.h + 'px' }); };
    const font = d => { RD.font = Math.max(11, Math.min(44, RD.font + d * 2)); content.style.fontSize = RD.font + 'px'; saveRD(); };
    const sync = () => { playB.textContent = running ? '❚❚' : '▶'; playB.classList.toggle('on', running); speed.hidden = RD.mode !== 'auto'; playB.hidden = RD.mode === 'manual'; };
    const drag = (el, fn) => el.addEventListener('pointerdown', e => { if (e.target.closest('button,select,input')) return; e.preventDefault(); el.setPointerCapture(e.pointerId); const x0 = e.clientX, y0 = e.clientY, s0 = Object.assign({}, RD); const mv = ev => { fn(s0, ev.clientX - x0, ev.clientY - y0); place(); }; const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); saveRD(); }; el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); });
    drag(bar, (s0, dx, dy) => { RD.x = s0.x + dx; RD.y = s0.y + dy; });
    drag(rz, (s0, dx, dy) => { RD.w = s0.w + dx; RD.h = s0.h + dy; });
    addEventListener('resize', () => reader && place());
    // stop auto-scroll when the reader is scrolled by hand, so a finger can always take over
    body.addEventListener('touchstart', () => { if (running && RD.mode === 'auto') { running = false; sync(); } }, { passive: true });
    body.addEventListener('wheel', () => { if (running && RD.mode === 'auto') { running = false; sync(); } }, { passive: true });
    playB.addEventListener('click', () => { if (RD.mode === 'follow') { setPlaying(!playing); return; } running = !running; last = 0; sync(); });
    speed.addEventListener('input', () => { RD.speed = +speed.value; saveRD(); });
    mode.addEventListener('change', () => { RD.mode = mode.value; running = false; sync(); saveRD(); });
    withPlay.addEventListener('change', () => { RD.withPlay = withPlay.checked; saveRD(); });
    guideC.addEventListener('change', () => { RD.guide = guideC.checked; guide.hidden = !RD.guide; saveRD(); });
    darkC.addEventListener('change', () => { RD.dark = darkC.checked; box.classList.toggle('dark', RD.dark); saveRD(); });
    pick.addEventListener('change', async () => { const [src, id] = pick.value.split('|'); const list = await docList(src); const it = list.find(x => x.id === id); if (it) reader.load(src, it, null); });
    sheetPick.addEventListener('change', () => { if (state) { state.sheet = +sheetPick.value; render(); } });
    function render() {
      const { source, item } = state;
      if (source === 'logos') { content.className = 'rd-content doc' + (item.script ? ' script' : ''); content.innerHTML = item.html || '<p class="rd-empty">This document is empty.</p>'; content.querySelectorAll('[contenteditable]').forEach(e => e.removeAttribute('contenteditable')); content.querySelectorAll('img[src^="blob:"]').forEach(e => e.remove()); }
      else { content.className = 'rd-content sheetv'; const s = item.sheets[state.sheet] || item.sheets[0]; content.innerHTML = sheetHTML(s); }
      content.style.fontSize = RD.font + 'px';
    }
    function tick(ts) {
      if (!reader) return;
      const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0; last = ts;
      const max = body.scrollHeight - body.clientHeight;
      if (RD.mode === 'follow' && !box.classList.contains('min')) { const tgt = scene.duration > 0 ? time / scene.duration * max : 0; if (Math.abs(body.scrollTop - tgt) > 0.5) body.scrollTop = tgt; }
      else if (running && RD.mode === 'auto') { acc += RD.speed * dt; const step = Math.floor(acc); if (step) { body.scrollTop += step; acc -= step; } if (body.scrollTop >= max - 1) { running = false; sync(); } }
      requestAnimationFrame(tick);
    }
    reader = {
      box,
      async load(source, item, list) {
        state = { source, item, sheet: 0 }; RD.last = { source, id: item.id }; saveRD();
        const all = [...(source === 'logos' ? list || await docList('logos') : await docList('logos')).map(x => ['logos', x]), ...(source === 'calsheet' ? list || await docList('calsheet') : await docList('calsheet')).map(x => ['calsheet', x])];
        pick.textContent = ''; for (const [src, x] of all) pick.append(h('option', { value: src + '|' + x.id }, (src === 'logos' ? '¶ ' : '▦ ') + (x.name || 'Untitled')));
        pick.value = source + '|' + item.id;
        sheetPick.hidden = source !== 'calsheet' || item.sheets.length < 2; sheetPick.textContent = '';
        if (source === 'calsheet') { item.sheets.forEach((s, i) => sheetPick.append(h('option', { value: String(i) }, s.name))); state.sheet = Math.max(0, item.sheets.findIndex(s => s.id === item.sheetId)); sheetPick.value = String(state.sheet); }
        render(); body.scrollTop = 0; box.classList.remove('min'); sync();
      },
      async refresh() { if (!state) return; const list = await docList(state.source), it = list.find(x => x.id === state.item.id); if (it) { const top = body.scrollTop, sh = state.sheet; state.item = it; state.sheet = sh; render(); body.scrollTop = top; } },
      onPlay(on) { if (!RD.withPlay || RD.mode !== 'auto') return; running = on; last = 0; sync(); },
      start() { if (RD.mode === 'auto') { running = true; last = 0; sync(); } },
      stop() { if (RD.mode === 'auto') { running = false; sync(); } },
      close() { box.remove(); reader = null; }
    };
    place(); sync(); requestAnimationFrame(tick);
  }
  function chooseReader(source) {
    return async () => {
      const list = await docList(source);
      if (!list.length) { openStudio(source === 'calsheet' ? 'calc' : 'logos', { kind: source === 'calsheet' ? 'sheet' : 'script' }); toast(source === 'calsheet' ? 'Make a sheet, then Use in scene → Show beside the stage.' : 'Write your script, then Use in scene → Show beside the stage.', 4500); return; }
      openReader(source, list[0].id);
    };
  }

  const ACTIONS = {
    logosDoc: () => openStudio('logos', { kind: 'doc' }), logosScript: () => openStudio('logos', { kind: 'script' }), logosOpen: () => openStudio('logos', { kind: 'gallery' }), logosReader: chooseReader('logos'),
    calcNew: () => openStudio('calc', { kind: 'sheet' }), calcOpen: () => openStudio('calc', { kind: 'gallery' }), calcReader: chooseReader('calsheet'),
    sculptHead: () => openClay({ kind: 'head' }), sculptEmpty: () => openClay({ kind: 'empty' }), sculptDemo: () => openClay({ kind: 'demo' }),
    image: importImage, sound: importSound, paper: importPaper, model: importModel, molfile: openMoleculeFile, atom: addAtom, voice: recordVoice, pdb: askPDB, pdbsearch: () => searchPDB(), pdbfile: openStructureFile, molname: () => moleculeByName(), smiles: askSMILES,
    draw: () => startDraw(), sketch: () => { startDraw(); if (drw) { drw.tool = 'pencil'; renderTools(); toast('Pencil: draw freehand'); } }
  };

  // ---------- catalogue: the dock trays and the Insert menu share this ----------
  const M = (tex, size) => ['math', { props: { tex, size: size || 0.9 } }];
  const PHYS = [
    [...M('F = ma'), 'Newton’s 2nd law', 'F'], [...M('F = G\\frac{m_1 m_2}{r^2}'), 'Gravitation', 'G'], [...M('E = mc^2'), 'Mass–energy', 'E'], [...M('E_k = \\frac{1}{2}mv^2'), 'Kinetic energy', '½'],
    [...M('v = u + at \\\\ s = ut + \\frac{1}{2}at^2'), 'Kinematics', 'v'], [...M('p = mv'), 'Momentum', 'p'], [...M('F = -kx'), 'Hooke’s law', '⌇'], [...M('T = 2\\pi\\sqrt{\\frac{L}{g}}'), 'Pendulum', 'T'],
    [...M('V = IR'), 'Ohm’s law', 'Ω'], [...M('F = \\frac{1}{4\\pi\\varepsilon_0}\\frac{q_1 q_2}{r^2}'), 'Coulomb', 'q'], [...M('PV = nRT'), 'Ideal gas', 'P'], [...M('v = f\\lambda'), 'Waves', 'λ'],
    [...M('\\lambda = \\frac{h}{p}'), 'de Broglie', 'h'], [...M('S = k_B \\ln W'), 'Entropy', 'S'], [...M('i\\hbar\\frac{\\partial \\Psi}{\\partial t} = H\\Psi'), 'Schrödinger', 'Ψ'],
    [...M('\\nabla \\cdot E = \\frac{\\rho}{\\varepsilon_0}'), 'Gauss’s law', '∇'], [...M('J = -D\\frac{\\partial C}{\\partial x}'), 'Fick’s law', 'J'], [...M('E = \\frac{RT}{zF}\\ln\\frac{[X]_{\\text{out}}}{[X]_{\\text{in}}}'), 'Nernst', 'E'],
    [...M('D = \\frac{k_B T}{6\\pi\\eta r}'), 'Stokes–Einstein', 'D'], [...M('J = P \\cdot S \\cdot (C_{\\text{blood}} - C_{\\text{brain}})'), 'Barrier flux', 'J'], [...M('v = \\frac{V_{\\text{max}}[S]}{K_m + [S]}'), 'Michaelis–Menten', 'v'],
    ['diffusion', { name: 'Diffusion' }, 'Diffusion (gradient)', '⁘'], ['diffusion', { name: 'Diffusion across a barrier', props: { barrier: 'membrane', perm: 0.12 } }, 'Diffusion across a barrier', '⫶'],
    ['diffusion', { name: 'Diffusing drop', props: { start: 'centre', n: 220 } }, 'A diffusing drop', '◌'],
    ['graph', { props: { f1: 'sin(x)', l1: 'y = \\sin x', f2: '', xmin: -6, xmax: 6, ymin: -1.5, ymax: 1.5, tracer: true } }, 'Wave graph', '∿'],
    ['graph', { props: { f1: '10*exp(-x/2)', l1: 'N = N_0 e^{-\\lambda t}', f2: '', xmin: 0, xmax: 8, ymin: 0, ymax: 11, tracer: true } }, 'Decay graph', '↘']];
  const MATHS = [
    [...M('e^{i\\pi} + 1 = 0', 1.2), 'Euler’s identity', 'e'], [...M('x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'), 'Quadratic formula', '√'], [...M('a^2 + b^2 = c^2', 1.1), 'Pythagoras', '◺'],
    [...M('f\'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}'), 'Derivative', 'ƒ′'], [...M('\\int_a^b f(x)\\,dx = F(b) - F(a)'), 'Fundamental theorem', '∫'], [...M('\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}'), 'Basel problem', '∑'],
    [...M('\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}'), 'Gaussian integral', '∞'], [...M('e^x = \\sum_{n=0}^{\\infty} \\frac{x^n}{n!}'), 'Taylor series', 'Σ'], [...M('P(A \\mid B) = \\frac{P(B \\mid A)\\,P(A)}{P(B)}'), 'Bayes’ theorem', 'P'],
    [...M('f(x) &= x^2 + 2x + 1 \\\\ &= (x+1)^2'), 'Working', '≡'], ['math', { name: 'Live number', props: { tex: 'a = [[a:1]]' } }, 'Live number', '#'],
    ['graph', { props: { f1: 'exp(-x^2/2)', l1: 'e^{-x^2/2}', f2: '', xmin: -4, xmax: 4, ymin: -0.2, ymax: 1.2, area: true, a: -1, b: 1 } }, 'Bell curve', '⌒']];
  const PRIM3D = Object.keys((B3 && B3.PRIMS) || {}).map(k => ['prim3d', { props: { shape: k, color: ['BLUE', 'TEAL', 'GREEN', 'GOLD', 'RED', 'PURPLE', 'PINK', 'YELLOW'][k.length % 8] } }, k[0].toUpperCase() + k.slice(1), { sphere: '●', cube: '■', cylinder: '▮', cone: '▲', torus: '◎', knot: '∞', icosahedron: '⬡', dodecahedron: '⬠', octahedron: '◆', capsule: '⬭', plane: '▭', ring: '◌' }[k] || '⬢']);
  const ARTWORK = [['@art:screen', null, 'New artwork (screen size)', '🖌'], ['@art:square', null, 'Square canvas', '◻'], ['@art:portrait', null, 'A4 portrait', '▯'], ['@art:wide', null, 'HD 16:9', '▭'],
    ['@art:anim', null, 'New animation (720p)', '🎞'], ['@art:small', null, 'Small animation (square)', '🎞']];
  const PIXEL = [['@px:16', null, '16 × 16 icon', '▦'], ['@px:32', null, '32 × 32 sprite', '▦'], ['@px:48', null, '48 × 48 character', '▦'], ['@px:64', null, '64 × 64', '▦'], ['@px:128', null, '128 × 128 scene', '▦'], ['@px:160x144', null, '160 × 144 Game Boy screen', '▦']];
  const LOGOS = [['@logosDoc', null, 'New document', '¶'], ['@logosScript', null, 'New script (screenplay)', '🎬'], ['@logosOpen', null, 'Open a document…', '▤'], ['@logosReader', null, 'Show a document beside the stage', '📜']];
  const CALSHEET = [['@calcNew', null, 'New spreadsheet', '▦'], ['@calcOpen', null, 'Open a spreadsheet…', '▤'], ['@calcReader', null, 'Show a sheet beside the stage', '📊'], ['table', { name: 'Table' }, 'Table (type the cells)', '▤']];
  const SCULPT = [['@sculptHead', null, 'Sculpt a clay head', '◕'], ['@sculptEmpty', null, 'Sculpt from scratch', '◔'], ['@sculptDemo', null, 'Rigged clay character', '☺'],
    ['@puppet:puppet', null, 'Puppet (wooden mannequin)', '🪆'], ['@puppet:biped', null, 'Biped puppet', '🚶'], ['@puppet:quadruped', null, 'Quadruped puppet', '🐕'], ['@puppet:hexapod', null, 'Hexapod puppet', '🐜'], ['@puppet:octopod', null, 'Octopod · spider', '🕷'], ['@puppet:octopus', null, 'Octopod · octopus', '🐙'], ['@puppet:professor', null, 'The Professor (sculpted scientist)', '🧪']];
  const FLAT_SOLIDS = CATS.solids.items.map(([t, o, l, i]) => [t, o, l + ' (line)', i]);
  const ANATOMY = [['bio3d', { props: { kind: 'bbbvessel' } }, 'BBB capillary 3D', '⊜'], ['bio3d', { props: { kind: 'capillary' } }, 'Capillary 3D', '═'], ['bio3d', { props: { kind: 'neuron' } }, 'Neuron 3D', '✺'],
    ['bio3d', { props: { kind: 'rbc' } }, 'Red blood cell 3D', '●'], ['bio2d', { props: { kind: 'nvu' } }, 'Neurovascular unit', '◎'], ['bio2d', { props: { kind: 'vessel2d' } }, 'Capillary diagram', '═'],
    ['bio2d', { props: { kind: 'brain2d' } }, 'Brain diagram', '❦'], ['bio2d', { props: { kind: 'neuron2d' } }, 'Neuron diagram', '✳'], ['bio2d', { props: { kind: 'rbc2d' } }, 'RBC diagram', '◍'], ['sticker', { props: { kind: 'brain' } }, 'Brain sticker', '❦']];
  const CELL = [['bio3d', { props: { kind: 'cell' } }, 'Cell 3D', '◉'], ['bio3d', { props: { kind: 'mito' } }, 'Mitochondrion 3D', '⬭'], ['bio3d', { props: { kind: 'dna' } }, 'DNA 3D', '⌇'], ['bio3d', { props: { kind: 'virus' } }, 'Virus 3D', '✹'],
    ['membrane', {}, 'Lipid bilayer', '≋'], ['membrane', { bend: 1, props: { radius: 70 } }, 'Vesicle', '◌'], ['junction', {}, 'Tight junction', '⫴'],
    ['transporter', { name: 'GLUT1', props: { kind: 'glut1' } }, 'GLUT1 transporter', '⧖'], ['transporter', { name: 'P-glycoprotein', props: { kind: 'pgp' } }, 'P-gp efflux pump', '⧗'],
    ['transporter', { name: 'Aquaporin', props: { kind: 'aquaporin' } }, 'Aquaporin', '⁂'], ['transporter', { name: 'K⁺ channel', props: { kind: 'ionchannel' } }, 'Ion channel', '⊚'],
    ['bio2d', { props: { kind: 'cell2d' } }, 'Cell diagram', '◎'], ['bio2d', { props: { kind: 'mito2d' } }, 'Mitochondrion diagram', '⬭'], ['bio2d', { props: { kind: 'synapse2d' } }, 'Synapse diagram', '⋔']];
  const MOLS = [['@molname', null, 'By name…', '🔎'], ['@smiles', null, 'From SMILES…', '⌬'], ...((B3 && B3.MOL_PRESETS) || []).map(([n, s]) => ['molecule', { name: n, props: { smiles: s, title: n } }, n, '⌬'])];
  const FAMOUS = [['1GFL', 'Green fluorescent protein'], ['4HHB', 'Haemoglobin'], ['1UBQ', 'Ubiquitin'], ['4INS', 'Insulin'], ['1MBN', 'Myoglobin'], ['1BNA', 'B-DNA'], ['2RH1', 'β2-adrenergic receptor'], ['4PYP', 'GLUT1 transporter'], ['4P79', 'Claudin-15'], ['1AOI', 'Nucleosome'], ['6LU7', 'SARS-CoV-2 protease']];
  const PDBS = [['@pdb', null, 'Fetch by ID…', '⤓'], ['@pdbsearch', null, 'Search PDB…', '🔎'], ['@pdbfile', null, 'Open file…', '▤'], ['pdb', { name: 'Four-helix bundle', props: { src: 'demo', title: 'Four-helix bundle', color: 'rainbow' } }, 'Demo bundle (offline)', '🧬'],
    ...FAMOUS.map(([id, n]) => ['@fetch:' + id, null, n + ' · ' + id, '🧬'])];
  const MEDIA = [['@image', null, 'Image…', '▨'], ['@sound', null, 'Sound…', '♪'], ['@paper', null, 'PDF / paper…', '🗎'], ['paper', { name: 'Placeholder paper', props: { src: 'placeholder', title: 'Placeholder paper' } }, 'Placeholder paper', '🗐']];
  const ADD = [['@voice', null, 'Record voice…', '🎙'], ['@model', null, '3D model (OBJ / GLB)…', '⬢'],
    ['@pdbfile', null, 'PDB file…', '🧬'], ['@pdb', null, 'PDB by ID…', '⤓'], ['@pdbsearch', null, 'Search the PDB…', '🔎'],
    ['@molname', null, 'Molecule by name…', '⌬'], ['@smiles', null, 'Molecule from SMILES…', '⌬'], ['@molfile', null, 'Molecule file (SDF / MOL)…', '▤'],
    ['@atom', null, 'Atom…', '⚛'], ['ptable', { name: 'Periodic table' }, 'Periodic table', '▦'], ['ptable', { name: 'Periodic table', props: { style: 'blocks', details: 'number' } }, 'Periodic table · blocks', '▦'],
    ['@art:screen', null, 'Tabula (paint)…', '🖌'], ['@art:anim', null, 'Animation (draw frames)…', '🎞'], ['@px:32', null, '8-Bit (pixel art)…', '▦'],
    ['@logosDoc', null, 'Logos document…', '¶'], ['@logosScript', null, 'Logos script…', '🎬'], ['@logosReader', null, 'Script beside the stage', '📜'], ['@calcNew', null, 'Calsheet…', '▦'], ['@calcReader', null, 'Sheet beside the stage', '📊'], ['@paper', null, 'PDF / image / document…', '🗎'], ['@image', null, 'Image (flat)…', '▨'], ['@sound', null, 'Sound file…', '♪']];
  const DOCK = [
    { id: 'add', label: 'Add', icon: '＋', items: ADD },
    { id: 'draw', label: 'Draw', icon: '✒', act: 'draw' }, { id: 'sketch', label: 'Sketch', icon: '✎', act: 'sketch' },
    { id: 'text', label: 'Text', icon: 'T', items: CATS.text.items }, { id: 'shapes', label: 'Shapes', icon: '◯', items: CATS.shapes.items },
    { id: 'graphs', label: 'Graphs', icon: '∿', items: [...CATS.graph.items,
      ['chart', { name: 'Forest plot' }, 'Forest plot (CSV)', '⫶'], ['chart', { name: 'Bar chart', props: { kind: 'bar', log: false, title: 'Example data', csv: 'group,young,aged\nCortex,1.0,1.6\nHippocampus,1.1,2.1\nStriatum,0.9,1.4', ylabel: 'Relative permeability' } }, 'Bar chart (CSV)', '▥'],
      ['chart', { name: 'Line graph', props: { kind: 'line', log: false, title: 'Example data', csv: 'time,uptake\n0,0\n5,22\n10,38\n20,58\n30,69\n45,77\n60,80', xlabel: 'Time (min)', ylabel: 'Uptake (%)' } }, 'Line graph (CSV)', '⟋'],
      ['chart', { name: 'Scatter plot', props: { kind: 'scatter', log: false, title: 'Example data', csv: 'x,y\n1,2.1\n2,2.9\n3,4.2\n4,4.8\n5,6.1\n6,6.8\n7,8.2' } }, 'Scatter (CSV)', '⁙'],
      ['chart', { name: 'Pie chart', props: { kind: 'pie', log: false, title: 'Example data', csv: 'cell type,share\nAstrocytes,40\nNeurons,30\nMicroglia,10\nOligodendrocytes,20' } }, 'Pie chart (CSV)', '◔'],
      ['table', { name: 'Table' }, 'Table', '▤'], ['@calcNew', null, 'Calsheet (spreadsheet)…', '▦']] }, { id: 'logic', label: 'Logic', icon: '∀', items: CATS.logic.items },
    { id: 'physics', label: 'Physics', icon: '⚛', items: PHYS }, { id: 'maths', label: 'Maths', icon: '∑', items: MATHS },
    { id: 'nodes', label: 'Nodes', icon: '⋰', items: CATS.nodes.items }, { id: 'geometry', label: 'Geometry', icon: '∞', items: CATS.geometry.items },
    { id: '3d', label: '3D', icon: '⬢', items: [...SCULPT, ...PRIM3D, ...FLAT_SOLIDS] }, { id: 'stickers', label: 'Stickers', icon: '★', items: CATS.stickers.items },
    { id: 'media', label: 'Media', icon: '▨', items: MEDIA }, { id: 'library', label: 'Library', icon: '❖', panel: 'library' },
    { id: 'values', label: 'Values', icon: '#', panel: 'values' }, { id: 'camera', label: 'Camera', icon: '⌖', panel: 'camera' },
    { id: 'sounds', label: 'Sounds', icon: '♪', panel: 'audio' }, { id: 'scene', label: 'Scene', icon: '▣', panel: 'scene' }, { id: 'code', label: 'Code', icon: '</>', panel: 'code' },
    { id: 'molecules', label: 'Molecules', icon: '⌬', items: MOLS }, { id: 'pdbs', label: 'PDBs', icon: '🧬', items: PDBS },
    { id: 'anatomy', label: 'Anatomy', icon: '❦', items: ANATOMY }, { id: 'cell', label: 'Cell biology', icon: '◉', items: CELL }];
  function runItem(it) {
    const [type, over] = it;
    closeTray();
    if (type[0] === '@') {
      const a = type.slice(1);
      if (a.startsWith('fetch:')) { loadPDB(a.slice(6)); return; }
      if (a.startsWith('puppet:')) { openClay({ kind: a.slice(7) }); return; }
      if (a.startsWith('art:')) { openStudio('art', { kind: a.slice(4) }); return; }
      if (a.startsWith('px:')) { openStudio('px', { kind: a.slice(3) }); return; }
      if (ACTIONS[a]) ACTIONS[a]();
      return;
    }
    addObj(type, over);
  }
  function itemButton(it) { const [, , label, icon] = it; return h('button', { type: 'button', class: 'addbtn', onclick: () => runItem(it) }, h('span', { class: 'ic' }, icon || '•'), h('span', {}, label)); }
  function openPanel(kind) { closeTray(); if (kind === 'audio' && !scene.audio) { importSound(); return; } openSheet(kind); }
  function dockAction(d) {
    if (d.act) { closeTray(); ACTIONS[d.act](); return; }
    if (d.panel) { openPanel(d.panel); return; }
    if (trayId === d.id) { closeTray(); return; }
    openTray(d.id);
  }

  // ---------- tray: a CapCut-style pop-up above the dock ----------
  let trayId = null;
  function openTray(id) {
    trayId = id;
    const d = DOCK.find(x => x.id === id), tray = $('#tray');
    tray.textContent = '';
    const head = h('div', { class: 'tray-head' }, h('b', {}, d.label), h('span', { class: 'muted small' }, 'Added at the playhead (' + fmtT(time) + ')'), h('span', { class: 'grow' }), h('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Close', onclick: closeTray }, '✕'));
    tray.append(head);
    if (id === 'molecules') {
      const q = h('input', { type: 'text', placeholder: 'Name, e.g. serotonin or 2-acetoxybenzoic acid', spellcheck: 'false', autocapitalize: 'off' });
      const go = () => { const v = q.value.trim(); if (v) { closeTray(); moleculeByName(v); } };
      q.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      tray.append(h('div', { class: 'tray-search' }, q, h('button', { type: 'button', class: 'btn primary', onclick: go }, 'Find')));
    }
    if (id === 'pdbs') {
      const q = h('input', { type: 'text', placeholder: 'PDB ID (1GFL) or search words (claudin)', spellcheck: 'false', autocapitalize: 'off' });
      const go = () => { const v = q.value.trim(); if (!v) return; closeTray(); if (/^[0-9][A-Za-z0-9]{3}$/.test(v)) loadPDB(v); else searchPDB(v); };
      q.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      tray.append(h('div', { class: 'tray-search' }, q, h('button', { type: 'button', class: 'btn primary', onclick: go }, 'Go')));
    }
    tray.append(h('div', { class: 'addgrid tray-grid' }, d.items.filter(it => !(id === 'molecules' && it[0] === '@molname')).map(itemButton)));
    tray.style.setProperty('--dockh', $('#tools').offsetHeight + 'px'); tray.style.bottom = $('#tools').offsetHeight + 'px';
    tray.hidden = false; document.body.classList.add('tray-open');
    renderTools();
  }
  function closeTray() { if (!trayId) return; trayId = null; $('#tray').hidden = true; document.body.classList.remove('tray-open'); renderTools(); }

  // ---------- menu bar (File · Edit · Insert · View) ----------
  function closeMenus() { document.querySelectorAll('.mb-pop').forEach(p => p.remove()); document.querySelectorAll('.mb-btn').forEach(b => b.classList.remove('open')); }
  function popMenu(btn, entries) {
    const was = btn.classList.contains('open'); closeMenus(); if (was) return;
    btn.classList.add('open');
    const r = btn.getBoundingClientRect();
    const pop = h('div', { class: 'mb-pop', style: 'left:' + Math.round(r.left) + 'px;top:' + Math.round(r.bottom + 4) + 'px' });
    const fill = (el, list) => {
      for (const e of list) {
        if (e === '-') { el.append(h('hr')); continue; }
        if (e.sub) {
          const row = h('button', { type: 'button', class: 'mb-item has-sub' }, h('span', { class: 'mi' }, e.icon || ''), h('span', {}, e.label), h('span', { class: 'grow' }), h('span', { class: 'muted' }, '›'));
          row.addEventListener('click', ev => {
            ev.stopPropagation();
            pop.querySelectorAll('.mb-sub').forEach(s => s.remove()); pop.querySelectorAll('.has-sub').forEach(s => s.classList.remove('on'));
            row.classList.add('on');
            const rr = row.getBoundingClientRect(), pr = pop.getBoundingClientRect();
            const sub = h('div', { class: 'mb-pop mb-sub', style: 'left:' + Math.round(pr.right + 4) + 'px;top:' + Math.round(Math.min(rr.top, innerHeight - 40 - Math.min(e.sub.length, 14) * 40)) + 'px' });
            fill(sub, e.sub); document.body.append(sub);
            const sr = sub.getBoundingClientRect(); if (sr.right > innerWidth - 8) sub.style.left = Math.max(8, pr.left - sr.width - 4) + 'px';
          });
          el.append(row);
        } else {
          el.append(h('button', { type: 'button', class: 'mb-item', disabled: e.disabled ? true : null, onclick: ev => { ev.stopPropagation(); closeMenus(); e.fn(); } }, h('span', { class: 'mi' }, e.icon || ''), h('span', {}, e.label), e.key ? h('span', { class: 'grow' }) : null, e.key ? h('span', { class: 'muted small' }, e.key) : null));
        }
      }
    };
    fill(pop, entries); document.body.append(pop);
  }
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.mb-pop') && !e.target.closest('.mb-btn')) closeMenus(); });
  const itemsAsMenu = items => items.map(it => ({ label: it[2], icon: it[3], fn: () => runItem(it) }));
  const MENUS = {
    File: () => [
      { label: 'New blank canvas', icon: '＋', fn: () => createProject(newScene('Untitled ' + (index().length + 1))) },
      { label: 'New from the Studio demo', icon: '★', fn: () => createProject(studioDemo()) },
      { label: 'New from the Animath demo', icon: '∑', fn: () => createProject(demoScene()) },
      '-', { label: 'Projects, open & save…', icon: '▤', fn: openMenu },
      { label: 'Open a structure file…', icon: '🧬', fn: openStructureFile }, { label: 'Open a PDF / image as paper…', icon: '🗎', fn: importPaper },
      '-', { label: 'Export video or image…', icon: '⤓', fn: openExport }, { label: 'Final Stage (video editor)…', icon: '🎬', fn: () => openStudio('final', { kind: 'open' }) }, { label: 'Manim Python code', icon: '</>', fn: () => openPanel('code') }],
    Edit: () => { const o = selObj(); return [
      { label: 'Undo', icon: '↶', key: '⌘Z', fn: () => undo(-1), disabled: hi <= 0 }, { label: 'Redo', icon: '↷', key: '⇧⌘Z', fn: () => undo(1), disabled: hi >= hist.length - 1 }, '-',
      { label: 'Duplicate', icon: '⧉', key: '⌘D', fn: dup, disabled: !o }, { label: 'Delete', icon: '⌫', key: '⌫', fn: del, disabled: !o },
      { label: 'Bring forward', icon: '⇡', fn: () => move(1), disabled: !o }, { label: 'Send back', icon: '⇣', fn: () => move(-1), disabled: !o },
      { label: 'Keyframe at playhead', icon: '◆', key: 'K', fn: toggleAllKeys, disabled: !o }, { label: 'Save to library', icon: '❖', fn: () => o && saveToLibrary(o), disabled: !o },
      '-', { label: 'Select nothing', icon: '○', key: 'Esc', fn: () => select(null) }]; },
    Insert: () => [
      { label: 'Drawing', icon: '✒', sub: [{ label: 'Vector (pen)', icon: '✒', fn: ACTIONS.draw }, { label: 'Sketch (pencil)', icon: '✎', fn: ACTIONS.sketch }] },
      { label: 'Sculpt (ClayForm)', icon: '◕', sub: itemsAsMenu(SCULPT) },
      { label: 'Tabula', icon: '🖌', sub: itemsAsMenu(ARTWORK) },
      { label: '8-Bit', icon: '▦', sub: itemsAsMenu(PIXEL) },
      { label: 'Logos', icon: '¶', sub: itemsAsMenu(LOGOS) },
      { label: 'Calsheet', icon: '▦', sub: itemsAsMenu(CALSHEET) },
      ...DOCK.filter(d => d.items).map(d => ({ label: d.label, icon: d.icon, sub: itemsAsMenu(d.id === 'molecules' ? d.items : d.items) })),
      '-', { label: 'Molecule by name (PubChem)…', icon: '🔎', fn: () => moleculeByName() }, { label: 'Protein by PDB ID…', icon: '⤓', fn: askPDB }, { label: 'Search the PDB…', icon: '🔎', fn: () => searchPDB() }],
    View: () => [
      { label: (guides ? '✓ ' : '') + 'Grid', icon: '⌗', fn: () => $('#guides').click() }, { label: 'Loop playback', icon: '↻', fn: () => $('#loopBtn').click() },
      { label: 'Zoom timeline in', icon: '+', fn: () => zoom(1.4) }, { label: 'Zoom timeline out', icon: '−', fn: () => zoom(1 / 1.4) },
      '-', { label: '3D view: front', icon: '⬢', fn: () => set3DView(0, 0) }, { label: '3D view: three-quarter', icon: '⬢', fn: () => set3DView(35, 20) }, { label: '3D view: top', icon: '⬢', fn: () => set3DView(0, 85) },
      { label: 'Layers', icon: '☰', fn: () => openPanel('layers') }, { label: 'Scene settings', icon: '▣', fn: () => openPanel('scene') }]
  };
  document.querySelectorAll('.mb-btn').forEach(b => b.addEventListener('click', () => popMenu(b, MENUS[b.dataset.menu]())));

  // ---------- 3D camera ----------
  function cam3() { return B3 ? B3.cam3(scene) : { keys: {} }; }
  const c3 = k => B3 ? B3.camVal(scene, k, time) : 0;
  function set3DView(orbit, tilt) { const c = cam3(); setProp(c, 'orbit', orbit); setProp(c, 'tilt', tilt); commit(); dirty = true; refreshSheet(); }
  const has3D = () => scene && scene.objects.some(is3D);
  function camera3DGroup() {
    const c = cam3();
    const rows = [['orbit', 'Orbit (°)', 5, -720, 720], ['tilt', 'Tilt (°)', 5, -89, 89], ['dist', 'Distance', 0.05, 0.2, 6], ['fov', 'Lens (°)', 1, 10, 90]];
    const g = group('3D camera', h('p', { class: 'muted small' }, 'Turns the 3D world. On the preview, drag empty space to orbit, pinch (or scroll) to move closer. Keyframe it like anything else.'));
    const shared = c.mode === 'shared';
    g.append(h('div', { class: 'chips' }, h('span', { class: 'muted small' }, 'Perspective'),
      h('button', { type: 'button', class: 'pick' + (!shared ? ' on' : ''), onclick: () => { delete c.mode; commit(); refreshSheet(); dirty = true; } }, 'Each object faces you'),
      h('button', { type: 'button', class: 'pick' + (shared ? ' on' : ''), onclick: () => { c.mode = 'shared'; commit(); refreshSheet(); dirty = true; } }, 'One shared camera')),
      h('p', { class: 'muted small' }, shared ? 'One camera looks at the middle of the frame, so objects near the edges are seen from an angle, as in a real photo.' : 'Each 3D object looks the same wherever you move it in the frame. Orbit and tilt still turn them all together.'));
    for (const [p, label, step, mn, mx] of rows) {
      const k = c.keys[p] || [], here = k.some(q => Math.abs(q.t - time) < 0.026);
      const st = stepper(round(c3(p), 2), step, v => { setProp(c, p, Math.max(mn, Math.min(mx, v))); dirty = true; commitSoon(); });
      const inp = st.querySelector('input'); inp.dataset.live = '1'; inp._get = () => round(c3(p), 2);
      g.append(h('div', { class: 'kfrow' }, h('span', { class: 'fl' }, label), st, keyBtn(here, k.length, label, () => toggleKey(c, p))));
    }
    const kt = [...new Set(Object.values(c.keys).flat().map(q => q.t))].sort((a, b) => a - b);
    if (kt.length) g.append(keyChips(kt, t => setTime(t)));
    const move3 = (to, dur) => {
      const t = round(time, 2);
      for (const [p, v] of Object.entries(to)) { const k = c.keys[p] || (c.keys[p] = []); const v0 = c3(p); [[t, v0], [round(t + dur, 2), v]].forEach(([tt, vv]) => { const ex = k.find(q => Math.abs(q.t - tt) < 0.026); if (ex) ex.v = round(vv, 3); else k.push({ t: tt, v: round(vv, 3) }); }); k.sort((a, b) => a.t - b.t); }
      if (t + dur > scene.duration) scene.duration = Math.ceil(t + dur);
      commit(); refreshSheet(); renderTimeline(); dirty = true; previewRange(t - 0.2, t + dur + 0.3);
    };
    g.append(h('div', { class: 'chips' },
      h('button', { type: 'button', class: 'pick', onclick: () => move3({ orbit: c3('orbit') + 360 }, 8) }, 'Turntable 360°'),
      h('button', { type: 'button', class: 'pick', onclick: () => move3({ orbit: c3('orbit') + 45, tilt: 20 }, 3) }, 'Swing round'),
      h('button', { type: 'button', class: 'pick', onclick: () => move3({ dist: c3('dist') / 1.8 }, 2.5) }, 'Dolly in'),
      h('button', { type: 'button', class: 'pick', onclick: () => move3({ dist: c3('dist') * 1.8 }, 2.5) }, 'Dolly out'),
      h('button', { type: 'button', class: 'pick', onclick: () => move3({ orbit: 0, tilt: 0, dist: 1 }, 1.5) }, 'Back to front'),
      h('button', { type: 'button', class: 'pick', onclick: () => { scene.cam3d = { orbit: 0, tilt: 0, dist: 1, fov: 35, keys: {} }; commit(); refreshSheet(); dirty = true; } }, 'Reset')));
    return g;
  }

  // ---------- 3D section of the inspector ----------
  const KIND_KEYS = { capillary: ['flow'], bbbvessel: ['flow'], neuron: ['signal'], dna: ['unzip'] };
  function threeDGroup(o) {
    const g = group('3D');
    const st = B3.status(o);
    if (st === 'loading') g.append(h('p', { class: 'muted small' }, 'Loading…'));
    if (st === 'error') g.append(h('div', { class: 'err' }, 'Couldn’t load this one. If it came from a file, try adding it again.'));
    const S = B3.structInfo(o);
    if (S && o.type === 'pdb') g.append(h('p', { class: 'muted small' }, S.nPoly + ' residues · ' + S.atoms.length.toLocaleString() + ' atoms · chains ' + S.chains.join(', ')));
    if (S && o.type === 'molecule') g.append(h('p', { class: 'muted small' }, S.atoms.length + ' atoms (hydrogens included)' + (o.props.sdf ? ' · 3D shape from PubChem' : ' · idealised shape built from the SMILES')));
    for (const [k, label, mn, mx, step] of B3.keyList(o.type)) {
      if (o.type === 'bio3d' && ['flow', 'signal', 'unzip'].includes(k) && !(KIND_KEYS[o.props.kind] || []).includes(k)) continue;
      const kk = o.keys[k] || [], here = kk.some(q => Math.abs(q.t - time) < 0.026);
      const val = () => B3.kv(o, k, time);
      const rg = h('input', { type: 'range', min: mn, max: mx, step, value: val(), 'aria-label': label });
      const num = h('input', { type: 'number', min: mn, max: mx, step, value: round(val(), 3), inputmode: 'decimal' });
      rg.dataset.live = '1'; rg._get = val; num.dataset.live = '1'; num._get = () => round(val(), 3);
      const set = v => { if (!isFinite(v)) return; setProp(o, k, Math.max(mn, Math.min(mx, v))); dirty = true; commitSoon(); };
      rg.addEventListener('input', () => { set(+rg.value); num.value = rg.value; });
      num.addEventListener('input', () => { set(parseFloat(num.value)); rg.value = num.value; });
      g.append(h('div', { class: 'k3row', 'data-k': k }, h('span', { class: 'fl' }, label), rg, num, keyBtn(here, kk.length, label, () => toggleKey(o, k))));
    }
    // ready-made moves from the playhead
    const t0 = round(time, 2);
    const keyPair = (k, a, b, dur) => { const arr = o.keys[k] || (o.keys[k] = []); for (const [tt, v] of [[t0, a], [round(t0 + dur, 2), b]]) { const ex = arr.find(q => Math.abs(q.t - tt) < 0.026); if (ex) ex.v = v; else arr.push({ t: tt, v }); } arr.sort((x, y) => x.t - y.t); if (t0 + dur > o.end) o.end = round(t0 + dur + 0.5, 2); if (o.end > scene.duration) scene.duration = Math.ceil(o.end); };
    const quick = (label, fn, dur) => h('button', { type: 'button', class: 'pick', onclick: () => { fn(); commit(); refreshSheet(); renderTimeline(); dirty = true; previewRange(t0 - 0.2, t0 + dur + 0.3); } }, label);
    const chips = [quick('Spin 360°', () => keyPair('spin', B3.kv(o, 'spin', time), B3.kv(o, 'spin', time) + 360, 6), 6)];
    if (o.type === 'pdb') chips.push(quick('Cartoon → atoms', () => { keyPair('atoms', 0, 1, 1.5); keyPair('cartoon', 1, 0.25, 1.5); }, 1.5), quick('Atoms → cartoon', () => { keyPair('atoms', 1, 0, 1.5); keyPair('cartoon', 0.25, 1, 1.5); }, 1.5));
    if (o.type === 'membrane') chips.push(quick('Curl into a vesicle', () => keyPair('bend', B3.kv(o, 'bend', time), 1, 3), 3), quick('Open a pore', () => keyPair('pore', 0, 22, 2), 2));
    if (o.type === 'junction') chips.push(quick('Open the barrier', () => { keyPair('gap', 0, 18, 3); keyPair('strands', 1, 0.2, 3); keyPair('flow', 0, 1, 3.5); }, 3.5));
    if (o.type === 'paper') chips.push(quick('Fan out', () => keyPair('spread', 0, 1, 1.5), 1.5), quick('Lift a page', () => keyPair('lift', 0, 1, 1.2), 1.2));
    if (o.type === 'bio3d' && o.props.kind === 'neuron') chips.push(quick('Fire a signal', () => keyPair('signal', 0, 1, 1.5), 1.5));
    if (o.type === 'bio3d' && o.props.kind === 'dna') chips.push(quick('Unzip', () => keyPair('unzip', 0, 1, 3), 3));
    if (o.type === 'transporter' && o.props.kind === 'ionchannel') chips.push(quick('Open the gate', () => keyPair('open', 0, 1, 1.2), 1.2), quick('Close the gate', () => keyPair('open', 1, 0, 1.2), 1.2));
    g.append(h('div', { class: 'chips' }, chips));
    if (o.type === 'molecule') {
      const q = h('input', { type: 'text', placeholder: 'Swap for another name, e.g. dopamine', spellcheck: 'false' });
      const go = async () => { const v = q.value.trim(); if (!v) return; const keep = o.id; await moleculeByName(v); const n = selObj(); const old = objById(keep); if (n && old && n !== old) { Object.assign(n, { start: old.start, end: old.end, x: old.x, y: old.y, scale: old.scale, keys: clone(old.keys), anIn: clone(old.anIn), anOut: clone(old.anOut) }); scene.objects = scene.objects.filter(x => x !== old); commit(); renderTimeline(); dirty = true; } };
      q.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      g.append(field('Look up by name (PubChem)', h('div', { class: 'tray-search' }, q, h('button', { type: 'button', class: 'btn', onclick: go }, 'Find'))));
    }
    const lab = h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: () => addPinnedLabel(o) }, '＋ Label pinned to it'));
    if (o.type === 'pdb' || o.type === 'molecule') lab.append(h('button', { type: 'button', class: 'btn', onclick: () => { addPinnedLabel(o, null, 'Residue'); const l = selObj(); if (l) startPinPick(l); } }, '＋ Label a residue…'));
    if (o.type === 'transporter') lab.append(h('button', { type: 'button', class: 'btn', onclick: () => placeInMembrane(o) }, '≋ Seat it in a membrane'));
    g.append(lab);
    if (o.type === 'sculpt' && o.props.cfId) g.append(h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: () => openClay({ proj: o.props.cfId }, o) }, '◕ Edit in ClayForm')),
      h('p', { class: 'muted small' }, 'Re-sculpt, rig, pose or record a Stage take, then “Update in scene”. Its animation plays from the start of this clip; Spin, Tilt and Depth below move it around.'));
    if (o.type === 'paper') g.append(h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: async () => { const f = await pickFile('.pdf,application/pdf,image/*'); if (!f) return; const isPdf = /pdf/i.test(f.type) || /\.pdf$/i.test(f.name); const mid = (isPdf ? 'pdf_' : 'img_') + uid(); await putMedia(mid, f); o.props.src = mid; o.props.kind = isPdf ? 'pdf' : 'image'; commit(); dirty = true; refreshSheet(); } }, 'Replace with a PDF or image…')));
    return g;
  }

  // ---------- pinning 2D things to 3D ones ----------
  let pinPick = null;
  function startPinPick(o) {
    pinPick = { id: o.id };
    if (!narrow()) openSheet('edit');
    toast('Tap a residue (or a ligand) on the preview to pin “' + o.name + '” to it. Esc cancels.');
  }
  function pinTo(o, pin) {
    const fresh = !o.pin3d;
    o.pin3d = Object.assign({ line: true }, o.pin3d || {}, pin);
    if (fresh) { delete o.keys.x; delete o.keys.y; o.x = 1.3; o.y = 1.0; }
    commit(); dirty = true; refreshSheet();
  }
  function pinGroup(o) {
    const targets = scene.objects.filter(x => is3D(x));
    if (!targets.length) return null;
    const g = group('Pin to 3D');
    const cur = o.pin3d && objById(o.pin3d.oid);
    const sel_ = selectInput([['', '— not pinned —'], ...targets.map(x => [x.id, x.name + ' (' + (A.TYPES[x.type].label || x.type).toLowerCase() + ')'])], cur ? cur.id : '', v => {
      if (!v) { delete o.pin3d; commit(); dirty = true; refreshSheet(); return; }
      pinTo(o, { oid: v, res: null });
    });
    g.append(field('Follows', sel_));
    if (cur) {
      g.append(h('p', { class: 'muted small' }, o.pin3d.res ? 'Pinned to residue ' + o.pin3d.res.replace('|', ' ') + '. Its position below is now an offset from that point.' : 'Pinned to the whole object. Its position is now an offset from it, so it follows the object as the 3D camera moves.'));
      g.append(chk('Leader line', o.pin3d.line !== false, v => { o.pin3d.line = v; commit(); dirty = true; }));
    }
    const resTargets = targets.filter(x => x.type === 'pdb' || x.type === 'molecule');
    if (resTargets.length) g.append(h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: () => startPinPick(o) }, '⌖ Pick a residue on the preview…')));
    return g;
  }
  function addPinnedLabel(target, res, text) {
    addObj('text', { name: 'Label', x: 1.3, y: 1.0, props: { text: text || target.name, size: 0.42, font: 'sans', color: 'WHITE' }, pin3d: { oid: target.id, res: res || null, line: true } });
  }
  // ---------- 2D diagram → matching 3D model ----------
  const MATCH3D = { nvu: 'bbbvessel', vessel2d: 'capillary', neuron2d: 'neuron', rbc2d: 'rbc', cell2d: 'cell', mito2d: 'mito' };
  function handover(from, to, dur) {
    dur = dur || 1.4;
    const t = round(Math.max(from.start + 0.5, from.end - dur), 2);
    from.anOut = { type: 'fadeout', dur, rate: 'smooth' };
    to.start = t; to.anIn = { type: 'fadein', dur, rate: 'smooth' };
    if (to.end < t + 3) to.end = round(t + 4, 2);
    to.x = from.x; to.y = from.y;
    if (to.end > scene.duration) scene.duration = Math.ceil(to.end);
  }
  function handoverGroup(o) {
    const g = group('Hand over to 3D');
    const kind = MATCH3D[o.props.kind];
    if (kind) g.append(h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: () => {
      const n = makeObj('bio3d', { name: (window.Bio3D.BIO_KINDS[kind] || {}).label || '3D model', props: { kind } });
      handover(o, n); scene.objects.push(n); commit(); renderTimeline(); dirty = true; previewRange(n.start - 0.5, n.start + 2.2);
      toast('The diagram now crossfades into the 3D model at ' + fmtT(n.start) + '.');
    } }, '◉ Crossfade into the matching 3D model')));
    const targets = scene.objects.filter(x => is3D(x));
    if (targets.length) g.append(field('…or hand over to', selectInput([['', '— choose a 3D object —'], ...targets.map(x => [x.id, x.name])], '', v => { const t3 = objById(v); if (!t3) return; handover(o, t3); commit(); renderTimeline(); dirty = true; previewRange(t3.start - 0.5, t3.start + 2.2); })));
    g.append(h('p', { class: 'muted small' }, 'The diagram fades out at the end of its clip while the 3D model fades in at the same place, so the flat figure “becomes” the 3D one.'));
    return g;
  }
  // ---------- seat a transporter in a membrane ----------
  function placeInMembrane(t) {
    const m = scene.objects.find(x => x.type === 'membrane');
    if (!m) { const nm = makeObj('membrane', { name: 'Membrane', start: t.start, end: t.end, x: t.x, y: t.y, scale: 0.6, props: { realScale: true } }); nm.pore = 20; scene.objects.splice(scene.objects.indexOf(t), 0, nm); t.props.realScale = true; t.scale = 0.6; t.tilt3 = nm.tilt3; }
    else { m.props.realScale = true; t.props.realScale = true; t.x = m.x; t.y = m.y; t.scale = m.scale = m.scale && m.scale !== 1 ? m.scale : 0.6; m.pore = Math.max(m.pore || 0, 20); t.tilt3 = m.tilt3; t.spin = m.spin; }
    commit(); renderTimeline(); dirty = true; refreshSheet();
    toast('Seated in the membrane at true scale (both at ×' + t.scale + '), with a pore opened for it.');
  }

  // ---------- layers panel ----------
  function layersSheet(body) {
    if (!scene.objects.length) { body.append(h('p', { class: 'muted' }, 'This canvas is empty. Add things from the dock below or the Insert menu.')); return; }
    const list = h('div', { class: 'layers' });
    for (const o of scene.objects.slice().reverse()) {
      const T = A.TYPES[o.type] || {};
      const eye = h('button', { type: 'button', class: 'iconbtn small', title: o.hidden ? 'Show in the video' : 'Hide in the video', onclick: ev => { ev.stopPropagation(); o.hidden = !o.hidden; commit(); dirty = true; refreshSheet(); } }, o.hidden ? '◌' : '◉');
      list.append(h('div', { class: 'layer' + (o.id === sel ? ' on' : '') + (o.parent ? ' kid' : ''), onclick: () => select(o.id) },
        h('span', { class: 'li' }, T.icon || '•'), h('span', { class: 'ln' }, o.name), h('span', { class: 'muted small' }, fmtT(o.start) + '–' + fmtT(o.end)), eye));
    }
    body.append(list, h('p', { class: 'muted small' }, 'Top of the list is drawn in front. 3D things always sit behind the 2D layer, in one shared 3D space.'));
  }

  // ---------- panel tabs and actions (tablet) ----------
  const OBJ_TABS = [['edit', 'Edit'], ['animate', 'Animate'], ['effects', 'Effects'], ['style', 'Style'], ['position', 'Keys'], ['rig', 'Rig']];
  const GLOBAL_TABS = [['layers', 'Layers'], ['scene', 'Scene'], ['camera', 'Camera'], ['values', 'Values'], ['audio', 'Sound'], ['library', 'Library'], ['code', 'Code']];
  function panelTabs(body) {
    const o = selObj(), k = sheetKind || '';
    const tabs = o && !GLOBAL_SHEETS.includes(k.split(':')[0]) ? OBJ_TABS : GLOBAL_TABS;
    const cur = k === 'animate' && animTab === 'effects' ? 'effects' : k;
    const bar = h('div', { class: 'ptabs' }, tabs.map(([kk, l]) => h('button', { type: 'button', class: 'ptab' + (cur === kk ? ' on' : ''), onclick: () => {
      if (kk === 'effects') { animTab = 'effects'; openSheet('animate'); } else if (kk === 'animate') { if (animTab === 'effects') animTab = 'in'; openSheet('animate'); } else openPanel(kk);
    } }, l)));
    body.append(bar);
    if (o && tabs === OBJ_TABS) {
      const act = (icon, label, fn, cls) => h('button', { type: 'button', class: 'iconbtn ' + (cls || ''), title: label, 'aria-label': label, onclick: fn }, icon);
      body.append(h('div', { class: 'pactions' },
        act('‹', 'Back to layers', () => select(null)),
        o.type === 'vector' ? act('✒', 'Edit drawing', () => startDraw(o)) : null,
        act('◆', 'Keyframe everything at the playhead', toggleAllKeys, keyHere(o) ? 'keyon' : ''), act('⧉', 'Duplicate', dup), act('⇡', 'Bring forward', () => move(1)), act('⇣', 'Send back', () => move(-1)),
        act('❖', 'Save to library', () => saveToLibrary(o)), h('span', { class: 'grow' }), act('⌫', 'Delete', del, 'danger')));
    }
  }
  function defaultPanel() { return selObj() ? 'edit' : 'layers'; }

  // ---------- Studio demo ----------
  function studioDemo() {
    const s = newScene('Studio demo');
    s.duration = 24; s.bg = '#000000';
    s.cam3d = { orbit: 0, tilt: 0, dist: 1, fov: 35, keys: { orbit: [{ t: 3.5, v: -25 }, { t: 15, v: 35 }], tilt: [{ t: 3.5, v: 10 }, { t: 15, v: 18 }] } };
    const keep = scene, keepT = time; scene = s;
    const O = (type, over) => { time = over.start; const o = makeObj(type, over); s.objects.push(o); return o; };
    O('title', { name: 'Title', start: 0, end: 3.4, props: { title: 'The blood–brain barrier', subtitle: 'Psi Phi Studio demo' }, anIn: { type: 'write', dur: 1.6, rate: 'linear' } });
    const v = O('bio3d', { name: 'BBB capillary', start: 3.2, end: 11, x: 0, y: -0.3, scale: 1.2, props: { kind: 'bbbvessel' }, anIn: { type: 'fadein', dur: 1, rate: 'smooth' } });
    v.flow = 1; v.keys.spin = [{ t: 3.2, v: -20 }, { t: 11, v: 30 }];
    O('text', { name: 'Caption', start: 4.4, end: 10.6, x: 0, y: -3.3, props: { text: 'Endothelial cells sealed by tight junctions', size: 0.36, font: 'sans', color: 'GREY' } });
    const nvu = O('bio2d', { name: 'Neurovascular unit', start: 11, end: 17, x: -3.2, y: 0, scale: 0.75, props: { kind: 'nvu', labels: true }, anIn: { type: 'create', dur: 2.2, rate: 'smooth' } });
    const j = O('junction', { name: 'Tight junction', start: 11.2, end: 17.6, x: 3.8, y: 0, scale: 0.9, anIn: { type: 'create', dur: 1.6, rate: 'smooth' } });
    j.keys.gap = [{ t: 13.5, v: 0 }, { t: 15.5, v: 16 }]; j.keys.strands = [{ t: 13.5, v: 1 }, { t: 15.5, v: 0.2 }]; j.keys.flow = [{ t: 14.5, v: 0 }, { t: 16, v: 1 }];
    O('text', { name: 'Caption 2', start: 13.4, end: 17.4, x: 3.8, y: -3.1, props: { text: 'Breakdown: the seal opens', size: 0.34, font: 'sans', color: 'RED' } });
    const m = O('molecule', { name: 'Glucose', start: 17.6, end: 24, x: -3.3, y: 0.2, scale: 1.1, props: { smiles: 'OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O', title: 'Glucose' }, anIn: { type: 'create', dur: 1.4, rate: 'smooth' } });
    m.keys.spin = [{ t: 17.6, v: 0 }, { t: 24, v: 300 }];
    O('math', { name: 'Flux', start: 18.4, end: 24, x: 2.6, y: 0.6, props: { tex: 'J = P \\cdot S \\cdot (C_{\\text{blood}} - C_{\\text{brain}})', size: 0.75 } });
    O('text', { name: 'Caption 3', start: 19.4, end: 24, x: 2.6, y: -0.7, props: { text: 'GLUT1 carries glucose across', size: 0.34, font: 'sans', color: 'TEAL' } });
    scene = keep; time = keepT;
    return s;
  }

  function refreshAll() {
    sizeStage(); renderTools(); renderTimeline(); refreshSheet(); updAspect(); dirty = true;
    document.title = scene.name + ' · Psi Phi Studio';
  }
  document.querySelectorAll('.playbtn').forEach(b => b.addEventListener('click', () => setPlaying(!playing)));
  $('#toStart').addEventListener('click', () => { setPlaying(false); setTime(0); });
  $('#loopBtn').addEventListener('click', e => { const b = e.currentTarget; b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true'); });
  $('#guides').addEventListener('click', e => { guides = !guides; e.currentTarget.setAttribute('aria-pressed', guides); dirty = true; });
  $('#undo').addEventListener('click', () => undo(-1));
  $('#redo').addEventListener('click', () => undo(1));
  $('#exportBtn').addEventListener('click', openExport);
  $('#aspectBtn').addEventListener('click', () => {
    const d = h('dialog', { class: 'aspectdlg', 'aria-label': 'Video shape' });
    const grid = h('div', { class: 'aspgrid' });
    for (const [k, l] of ASPECTS) {
      const [w, hh] = k.split(':').map(Number), sc = 46 / Math.max(w, hh);
      grid.append(h('button', { type: 'button', class: 'asp' + (scene.aspect === k ? ' on' : ''), onclick: () => { scene.aspect = k; commit(); sizeStage(); refreshSheet(); updAspect(); d.close(); } },
        h('i', { style: 'width:' + Math.round(w * sc) + 'px;height:' + Math.round(hh * sc) + 'px' }), h('b', {}, k), h('span', {}, l.replace(/\s*\d+:\d+$/, ''))));
    }
    d.append(h('div', { class: 'dlg' }, h('h2', {}, 'Video shape'), grid, h('p', { class: 'muted small' }, 'Objects keep their positions in units, so a wider frame shows more around them.'), h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn quiet', onclick: () => d.close() }, 'Close'))));
    d.addEventListener('close', () => setTimeout(() => d.remove(), 50));
    document.body.append(d); d.showModal();
  });
  function updAspect() { $('#aspectBtn').textContent = scene.aspect + ' ▾'; }
  $('#menuBtn').addEventListener('click', openMenu);
  $('#proj').addEventListener('change', e => openProject(e.target.value));
  addEventListener('resize', () => { sizeStage(); renderTimeline(); });
  addEventListener('keydown', e => {
    const tag = (document.activeElement || {}).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
    else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(e.shiftKey ? 1 : -1); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); undo(1); }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); dup(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); del(); }
    else if (e.key === 'ArrowLeft') setTime(time - (e.shiftKey ? 1 : 0.1));
    else if (e.key === 'ArrowRight') setTime(time + (e.shiftKey ? 1 : 0.1));
    else if (e.key === 'k' && sel) toggleAllKeys();
    else if (e.key === 'm' || e.key === 'M') addMarker();
    else if (e.key === 'Escape') { if (pinPick) { pinPick = null; toast('Pinning cancelled.'); } else if (document.querySelector('.mb-pop')) closeMenus(); else if (trayId) closeTray(); else if (sheetKind && narrow()) closeSheet(); else if (drw) endDraw(); else select(null); }
  });
  if (document.fonts) {
    Promise.all(['20px LM', 'italic 20px LM', 'bold 20px LM', 'italic bold 20px LM', '20px LMMath', '20px "IBM Plex Sans"', '20px "IBM Plex Mono"'].map(f => document.fonts.load(f).catch(() => null)))
      .then(() => { A.fontsChanged(); dirty = true; });
  }

  const cur = store.get('bstudio.current', null);
  if (!(cur && openProject(cur))) { const first = index()[0]; if (!(first && openProject(first.id))) createProject(studioDemo()); }
  requestAnimationFrame(() => { renderTimeline(); syncScroll(); });
  requestAnimationFrame(loop);
  window.AnimathEditor = { get scene() { return scene; }, setTime, select, addObj, setPlaying, openSheet, get time() { return time; }, get soundPlaying() { return !!(sound.el && !sound.el.paused); } };
})();

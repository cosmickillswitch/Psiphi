/* Psi Phi Studio · frame-perfect video export.
   Every frame is drawn, then encoded with WebCodecs (H.264, plus AAC or Opus sound) and written into an MP4 file here,
   so nothing is skipped however slow a frame is to draw. Shared by Psi Phi Studio, ClayForm and Final Stage. */
(function () {
  'use strict';
  const has = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
  const te = new TextEncoder();
  // ---------- MP4 boxes ----------
  function cat(parts) { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; }
  const u8 = v => Uint8Array.of(v & 255), u16 = v => Uint8Array.of((v >> 8) & 255, v & 255), u24 = v => Uint8Array.of((v >> 16) & 255, (v >> 8) & 255, v & 255);
  const u32 = v => Uint8Array.of((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255), i32 = v => u32(v >>> 0);
  const str = s => te.encode(s), zeros = n => new Uint8Array(n);
  function box(type, ...parts) { const body = cat(parts.flat()); return cat([u32(body.length + 8), str(type), body]); }
  const full = (type, ver, flags, ...parts) => box(type, u8(ver), u24(flags), ...parts);
  const MATRIX = cat([0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].map(u32));
  function stts(durs) { const runs = []; for (const d of durs) { const r = runs[runs.length - 1]; if (r && r[1] === d) r[0]++; else runs.push([1, d]); } return full('stts', 0, 0, u32(runs.length), ...runs.map(([n, d]) => cat([u32(n), u32(d)]))); }
  function trak(t, id, movieDur, chunkOffset) {
    const isV = t.kind === 'video', n = t.sizes.length, dur = t.durs.reduce((a, b) => a + b, 0);
    const tkhd = full('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(movieDur), zeros(8), u16(0), u16(0), u16(isV ? 0 : 0x0100), u16(0), MATRIX, u32(isV ? t.w << 16 : 0), u32(isV ? t.h << 16 : 0));
    const mdhd = full('mdhd', 0, 0, u32(0), u32(0), u32(t.scale), u32(dur), u16(0x55C4), u16(0));
    const hdlr = full('hdlr', 0, 0, u32(0), str(isV ? 'vide' : 'soun'), zeros(12), str(isV ? 'VideoHandler\0' : 'SoundHandler\0'));
    const head = isV ? full('vmhd', 0, 1, zeros(8)) : full('smhd', 0, 0, zeros(4));
    const dinf = box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)));
    let entry;
    if (isV) entry = box('avc1', zeros(6), u16(1), zeros(16), u16(t.w), u16(t.h), u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(0x18), u16(0xFFFF), box('avcC', t.desc));
    else {
      const common = [zeros(6), u16(1), zeros(8), u16(t.ch), u16(16), u16(0), u16(0), u32(t.rate << 16)];
      if (t.codec === 'opus') entry = box('Opus', ...common, box('dOps', u8(0), u8(t.ch), u16(t.preSkip || 312), u32(t.rate), u16(0), u8(0)));
      else {
        const asc = t.desc, dsi = cat([u8(5), u8(asc.length), asc]), dcd = cat([u8(4), u8(13 + dsi.length), u8(0x40), u8(0x15), u24(0), u32(t.bitrate), u32(t.bitrate), dsi]), sl = cat([u8(6), u8(1), u8(2)]);
        entry = box('mp4a', ...common, full('esds', 0, 0, u8(3), u8(3 + dcd.length + sl.length), u16(0), u8(0), dcd, sl));
      }
    }
    const parts = [full('stsd', 0, 0, u32(1), entry), stts(t.durs)];
    if (t.cts && t.cts.some(x => x)) parts.push(full('ctts', 1, 0, u32(n), ...t.cts.map(c => cat([u32(1), i32(c)]))));
    if (isV) parts.push(full('stss', 0, 0, u32(t.keys.length), ...t.keys.map(k => u32(k + 1))));
    parts.push(full('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1)), full('stsz', 0, 0, u32(0), u32(n), ...t.sizes.map(u32)), full('stco', 0, 0, u32(1), u32(chunkOffset)));
    return box('trak', tkhd, box('mdia', mdhd, hdlr, box('minf', head, dinf, box('stbl', ...parts))));
  }
  function mux(tracks) {
    // MP4 with the index first, so it plays and shares straight away
    const ftyp = box('ftyp', str('isom'), u32(512), str('isom'), str('iso2'), str('avc1'), str('mp41'));
    const movieDur = Math.max(...tracks.map(t => Math.round(t.durs.reduce((a, b) => a + b, 0) / t.scale * 1000)));
    const build = offsets => box('moov', full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(movieDur), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(tracks.length + 1)), ...tracks.map((t, i) => trak(t, i + 1, movieDur, offsets[i])));
    const size0 = build(tracks.map(() => 0)).length, offs = []; let o = ftyp.length + size0 + 8;
    for (const t of tracks) { offs.push(o); o += t.data.reduce((a, b) => a + b.length, 0); }
    const moov = build(offs), dataLen = o - (ftyp.length + size0 + 8);
    return new Blob([ftyp, moov, u32(dataLen + 8), str('mdat'), ...tracks.flatMap(t => t.data)], { type: 'video/mp4' });
  }

  // ---------- choose codecs the device can do ----------
  async function videoConfig(W, H, fps) {
    const lvl = W * H > 2560 * 1440 ? '33' : W * H > 1920 * 1088 ? '32' : '28';
    const bitrate = Math.round(Math.min(40e6, Math.max(2e6, W * H * fps * 0.16)));
    for (const codec of ['avc1.6400' + lvl, 'avc1.4D00' + lvl, 'avc1.4200' + lvl, 'avc1.640033', 'avc1.42E01F']) {
      const cfg = { codec, width: W, height: H, bitrate, framerate: fps, avc: { format: 'avc' } };
      try { const s = await VideoEncoder.isConfigSupported(cfg); if (s.supported) return s.config || cfg; } catch (e) { }
    }
    return null;
  }
  async function audioConfig(rate, ch) {
    if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return null;
    for (const [codec, sr] of [['mp4a.40.2', rate], ['mp4a.40.2', 48000], ['mp4a.40.2', 44100], ['opus', 48000]]) {
      const cfg = { codec, sampleRate: sr, numberOfChannels: ch, bitrate: 160000 };
      try { const s = await AudioEncoder.isConfigSupported(cfg); if (s.supported) return cfg; } catch (e) { }
    }
    return null;
  }
  // mix one or more sounds into a single stereo buffer at the encoder's rate
  async function mixSound(sounds, duration, rate) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext; if (!OAC) return null;
    const len = Math.max(1, Math.ceil(duration * rate)), ctx = new OAC(2, len, rate);
    for (const s of sounds) {
      if (!s.buffer) continue;
      const src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = s.buffer; src.playbackRate.value = s.rate || 1;
      const vol = s.vol == null ? 1 : s.vol, at = s.at || 0, from = s.from || 0, len2 = s.len != null ? s.len : s.buffer.duration - from;
      const real = len2 / (s.rate || 1), start = Math.max(0, at), skip = Math.max(0, -at) * (s.rate || 1);
      g.gain.setValueAtTime(s.fadeIn ? 0 : vol, start);
      if (s.fadeIn) g.gain.linearRampToValueAtTime(vol, start + s.fadeIn);
      if (s.fadeOut) { g.gain.setValueAtTime(vol, Math.max(start, at + real - s.fadeOut)); g.gain.linearRampToValueAtTime(0, at + real); }
      src.connect(g); g.connect(ctx.destination);
      if (real - skip / (s.rate || 1) > 0) src.start(start, from + skip, Math.max(0, len2 - skip));
    }
    return ctx.startRendering();
  }

  /* encode({ W, H, fps, duration, draw: async (i, t) => canvas, sounds: [{ buffer, at, vol, from, len, rate, fadeIn, fadeOut }],
             onProg(p, msg), cancelled: () => bool }) → { blob, audio: bool } */
  async function encode(o) {
    const { W, H, fps, duration } = o, N = Math.max(1, Math.round(duration * fps));
    const vcfg = await videoConfig(W, H, fps); if (!vcfg) throw new Error('this device can’t encode H.264 at ' + W + '×' + H);
    const sounds = (o.sounds || []).filter(s => s && s.buffer);
    const acfg = sounds.length ? await audioConfig(sounds[0].buffer.sampleRate, 2) : null;
    const prog = o.onProg || (() => { }), dead = o.cancelled || (() => false);
    // video
    const V = { kind: 'video', w: W, h: H, scale: 90000, sizes: [], durs: [], cts: [], keys: [], data: [], desc: null };
    let vErr = null;
    const venc = new VideoEncoder({ output: (chunk, meta) => { if (meta && meta.decoderConfig && meta.decoderConfig.description && !V.desc) V.desc = new Uint8Array(meta.decoderConfig.description.buffer ? meta.decoderConfig.description.buffer.slice(meta.decoderConfig.description.byteOffset || 0, (meta.decoderConfig.description.byteOffset || 0) + meta.decoderConfig.description.byteLength) : meta.decoderConfig.description); const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); const i = V.sizes.length; if (chunk.type === 'key') V.keys.push(i); V.sizes.push(b.length); V.data.push(b); V.pts = V.pts || []; V.pts.push(chunk.timestamp); }, error: e => { vErr = e; } });
    venc.configure(vcfg);
    const frameDur = 1e6 / fps, tick = Math.round(90000 / fps);
    for (let i = 0; i < N; i++) {
      if (dead()) { try { venc.close(); } catch (e) { } return null; }
      if (vErr) throw vErr;
      const t = i / fps, cv = await o.draw(i, t);
      const vf = new VideoFrame(cv, { timestamp: Math.round(i * frameDur), duration: Math.round(frameDur) });
      venc.encode(vf, { keyFrame: i % Math.max(1, Math.round(fps * 2)) === 0 }); vf.close();
      while (venc.encodeQueueSize > 3) await new Promise(r => setTimeout(r, 4));
      if (i % 3 === 0 || i === N - 1) { prog(0.92 * (i + 1) / N, 'Frame ' + (i + 1) + ' of ' + N); await new Promise(r => setTimeout(r, 0)); }
    }
    await venc.flush(); venc.close(); if (vErr) throw vErr;
    if (!V.desc) throw new Error('the encoder gave no H.264 settings');
    // timing: one frame each, in decode order; composition offsets only if the encoder reordered frames
    for (let i = 0; i < V.sizes.length; i++) { V.durs.push(tick); V.cts.push(Math.round((V.pts[i] - i * frameDur) / 1e6 * 90000)); }
    const tracks = [V];
    // sound
    let withAudio = false;
    if (acfg && !dead()) {
      try {
        prog(0.94, 'Mixing the sound…');
        const mix = await mixSound(sounds, N / fps, acfg.sampleRate);
        if (mix) {
          const A = { kind: 'audio', codec: acfg.codec === 'opus' ? 'opus' : 'aac', rate: acfg.sampleRate, ch: 2, scale: acfg.sampleRate, bitrate: acfg.bitrate, sizes: [], durs: [], data: [], desc: null };
          let aErr = null;
          const aenc = new AudioEncoder({ output: (chunk, meta) => { if (meta && meta.decoderConfig && meta.decoderConfig.description && !A.desc) { const d = meta.decoderConfig.description; A.desc = new Uint8Array(d.buffer ? d.buffer.slice(d.byteOffset || 0, (d.byteOffset || 0) + d.byteLength) : d); } const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); A.sizes.push(b.length); A.data.push(b); A.durs.push(Math.max(1, Math.round((chunk.duration || (A.codec === 'aac' ? 1024 / A.rate * 1e6 : 20000)) / 1e6 * A.rate))); }, error: e => { aErr = e; } });
          aenc.configure(acfg);
          const L = mix.getChannelData(0), R = mix.getChannelData(1), step = 4096;
          for (let s = 0; s < mix.length; s += step) {
            const n = Math.min(step, mix.length - s), buf = new Float32Array(n * 2); buf.set(L.subarray(s, s + n), 0); buf.set(R.subarray(s, s + n), n);
            const ad = new AudioData({ format: 'f32-planar', sampleRate: A.rate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(s / A.rate * 1e6), data: buf });
            aenc.encode(ad); ad.close();
            while (aenc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 2));
          }
          await aenc.flush(); aenc.close();
          if (!aErr && A.sizes.length) {
            if (A.codec === 'aac' && !A.desc) { // build the two-byte AudioSpecificConfig ourselves
              const idx = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000].indexOf(A.rate);
              A.desc = Uint8Array.of((2 << 3) | (idx >> 1), ((idx & 1) << 7) | (2 << 3));
            }
            if (A.codec === 'opus') A.desc = A.desc || new Uint8Array(0);
            tracks.push(A); withAudio = true;
          }
        }
      } catch (e) { console.warn('sound not encoded', e); }
    }
    prog(0.99, 'Writing the MP4…');
    return { blob: mux(tracks), audio: withAudio, soundSkipped: sounds.length > 0 && !withAudio };
  }
  window.VidEnc = { supported: has, encode, mixSound, mux };
})();

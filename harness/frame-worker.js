// One frame-render worker, loaded into each browser tab of an animation run.
//
// A tab is its own renderer process, so N tabs render on N cores. Each takes a STRIDE — tab 0 does frames
// 1,4,7…, tab 1 does 2,5,8… — and posts every finished frame straight to a local save server, so no tab
// holds the set and none has to hand anything to another. MEASURED: three tabs at 16384 gave 3.33 s a
// frame against 5.66 s alone, which is 1.7x rather than 3x — each tab individually got SLOWER (10 s), so
// the ceiling is memory bandwidth, not cores. Three is about where it stops paying.
//
// The frames go to ffmpeg afterwards, never to MediaRecorder: capturing a canvas happens in real time, so
// a render slower than 41.7 ms silently drops frames (measured: 89 of 120 at 4K), while ffmpeg reads PNGs
// at its own pace and stamps them at whatever rate it is told.
//
// Load it into a page carrying the __anim hook, then:
//   __startWorker({ offset: 0, stride: 3, N: 120, W: 3840, OUT: 1920,
//                   slab: '/test-slabs/crosshatch.json', advance: 0.006, overlay: false, fog: false })
//
//   offset/stride  which frames this tab owns
//   N              total frames
//   W / OUT        render width, then the width it is supersampled down to before saving
//   slab           the slab to animate; its moon is the thing that moves
//   advance        arc length per frame. Landing on applyMoon's own 0.006 resample step makes the drag
//                  grow perfectly evenly; below it, consecutive frames share grid points and the drag
//                  ripples at roughly a 1.2-frame period
//   moonStrength   overrides the slab's; omit to use what the slab says
//   overlay        draw the gravity marks and the route (an explainer, not the picture)
//   fog            gather the fog into a travelling ball — a demo device, not part of any slab
window.__startWorker = async (opts) => {
  const a = window.__anim, STEP = 0.006;
  const S = window.__W = { ...opts, done: 0, bytes: 0, ms: [], running: true, error: null };
  const slab = await fetch(opts.slab || '/harness/dist/crosshatch.json').then(r => r.json());
  const full = slab.marks.find(m => m.kind === 'moon').samples;
  const proto = slab.marks.find(m => m.kind === 'vein').p;

  const cut = (L) => { const out = [full[0]]; let acc = 0;
    for (let i = 1; i < full.length && acc < L; i++) {
      const d = Math.hypot(full[i][0] - full[i-1][0], full[i][1] - full[i-1][1]);
      if (acc + d > L) { const u = (L - acc) / d;
        out.push([full[i-1][0] + (full[i][0]-full[i-1][0])*u, full[i-1][1] + (full[i][1]-full[i-1][1])*u, 1]); break; }
      acc += d; out.push(full[i]); }
    return out; };
  const at = (L) => { let acc = 0;
    for (let i = 1; i < full.length; i++) { const d = Math.hypot(full[i][0]-full[i-1][0], full[i][1]-full[i-1][1]);
      if (acc + d >= L) { const u = (L - acc) / d;
        return [full[i-1][0] + (full[i][0]-full[i-1][0])*u, full[i-1][1] + (full[i][1]-full[i-1][1])*u]; }
      acc += d; }
    return full[full.length - 1]; };

  const GATHER_SHOWN = 24, B = '120,200,255';
  const overlay = (c, F, W) => {
    const x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0);
    const P = p => [p[0] * W, p[1] * W];
    x.lineJoin = x.lineCap = 'round';
    x.strokeStyle = `rgba(${B},0.14)`; x.lineWidth = Math.max(1, W / 800);
    x.beginPath(); full.forEach((p, i) => { const [px, py] = P(p); i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.stroke();
    const walked = cut(F * STEP);
    x.strokeStyle = `rgba(${B},0.45)`; x.lineWidth = Math.max(1.5, W / 520);
    x.beginPath(); walked.forEach((p, i) => { const [px, py] = P(p); i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.stroke();
    const fade = F <= GATHER_SHOWN / 2 ? 1 : F >= GATHER_SHOWN ? 0 : 1 - (F - GATHER_SHOWN / 2) / (GATHER_SHOWN / 2);
    let seen = false, drives = 0, last = null;
    for (const g of a.geo.guides) {
      const [gx, gy] = P([g.x, g.y]), r = g.reach * W;
      if (g.reach > 0.3) {
        if (seen || fade <= 0) continue;
        seen = true;
        x.strokeStyle = `rgba(${B},${(0.26 * fade).toFixed(3)})`; x.lineWidth = Math.max(1, W / 900);
        x.setLineDash([W / 90, W / 120]);
        x.beginPath(); x.arc(gx, gy, r, 0, 6.2832); x.stroke(); x.setLineDash([]);
      } else { drives++; last = [gx, gy, r];
        x.fillStyle = `rgba(${B},0.38)`;
        x.beginPath(); x.arc(gx, gy, Math.max(1.2, W / 440), 0, 6.2832); x.fill(); }
    }
    if (last) {
      x.strokeStyle = `rgba(${B},0.7)`; x.lineWidth = Math.max(1, W / 700);
      x.beginPath(); x.arc(last[0], last[1], last[2], 0, 6.2832); x.stroke();
      x.fillStyle = 'rgba(180,230,255,0.95)';
      x.beginPath(); x.arc(last[0], last[1], Math.max(2, W / 260), 0, 6.2832); x.fill();
    }
    const s = W / 1024, fs = Math.round(15 * s);
    x.font = fs + 'px "IBM Plex Mono", monospace'; x.textBaseline = 'middle';
    const y0 = 0.625 * W - fs * 3.4, lx = fs * 1.2;
    const row = (i, txt, sw, al) => { if (al <= 0) return; const yy = y0 + i * fs * 1.6;
      sw(lx + fs * 0.6, yy, al);
      x.fillStyle = `rgba(${B},${(0.85 * al).toFixed(3)})`; x.fillText(txt, lx + fs * 1.8, yy); };
    row(0, 'gather · 6 pulls at reach 0.60', (cx, cy, al) => {
      x.strokeStyle = `rgba(${B},${(0.5 * al).toFixed(3)})`; x.lineWidth = Math.max(1, s); x.setLineDash([3 * s, 3 * s]);
      x.beginPath(); x.arc(cx, cy, fs * 0.45, 0, 6.2832); x.stroke(); x.setLineDash([]); }, fade);
    row(1, 'drive  · ' + drives + (drives === 1 ? ' pull' : ' pulls') + ' at reach 0.05', (cx, cy) => {
      x.strokeStyle = `rgba(${B},0.7)`; x.lineWidth = Math.max(1, s);
      x.beginPath(); x.arc(cx, cy, fs * 0.45, 0, 6.2832); x.stroke();
      x.fillStyle = `rgba(${B},0.7)`; x.beginPath(); x.arc(cx, cy, fs * 0.15, 0, 6.2832); x.fill(); }, 1);
  };

  const showOverlay = opts.overlay !== false;      // the explainer marks are optional: off for a clean look
  const frame = async (F) => {
    const t0 = performance.now();
    a.deserialize(slab); a.setSpectrum(0); a.size();
    if (opts.fog !== false) a.layers.find(Ly => Ly.key === 'fog').haze = 0.65;
    const mn = a.marks.find(m => m.kind === 'moon');
    if (opts.moonStrength != null) mn.p.moonStrength = opts.moonStrength;   // else the slab's own value stands
    mn.samples = cut(F * (opts.advance || STEP));        // a long authored path advances more than one step
    if (opts.fog !== false) {                     // the gathered fog ball: a demo device, not part of a slab
      let id = 900;
      const [s0x, s0y] = at(0.004);
      for (let i = 0; i < 6; i++) a.marks.push({ id: id++, kind: 'gravity', seed: 10 + i, at: [s0x, s0y], tgt: 'fog',
        p: { ...proto, reach: 12, strength: 0.95, sign: 1 } });
      for (let f = 1; f <= F; f++) { const [hx, hy] = at(f * STEP);
        a.marks.push({ id: id++, kind: 'gravity', seed: 500 + f, at: [hx, hy], tgt: 'fog',
          p: { ...proto, reach: 1, strength: 0.99, sign: 1 } }); }
    }
    a.build();
    const c = a.renderFull(S.W);
    if (showOverlay) overlay(c, F, S.W);
    const out = document.createElement('canvas');
    out.width = S.OUT; out.height = Math.round(S.OUT * c.height / c.width);
    const ox = out.getContext('2d'); ox.imageSmoothingEnabled = true; ox.imageSmoothingQuality = 'high';
    ox.drawImage(c, 0, 0, out.width, out.height);          // forces the 16k rasterisation, then supersamples
    c.width = 1; c.height = 1;
    const blob = await new Promise(r => out.toBlob(r, 'image/png'));
    out.width = 1; out.height = 1;
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s2 = ''; const CH = 0x8000;
    for (let i = 0; i < buf.length; i += CH) s2 += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
    const name = 'f' + String(F).padStart(3, '0') + '.png';
    await fetch('http://127.0.0.1:8792/?name=' + name, { method: 'POST', body: btoa(s2) });
    S.bytes += blob.size; S.done++; S.ms.push(performance.now() - t0);
  };

  const step = async () => {
    const F = S.offset + 1 + S.done * S.stride;
    if (!S.running || F > S.N) { S.running = false; return; }
    try { await frame(F); } catch (e) { S.error = String(e && e.message || e); S.running = false; return; }
    setTimeout(step, 0);
  };
  setTimeout(step, 0);
  return { started: true, first: S.offset + 1, stride: S.stride };
};

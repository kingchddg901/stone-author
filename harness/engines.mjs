// What the other two engines do with the same slab — Blink, Gecko and WebKit in one job.
//
// Safari cannot be tested from a PC, and every browser on iOS is WebKit underneath, so WebKit is the one
// engine the studio ships to blind. Playwright's WebKit build is not Safari (no Apple GPU or media stack)
// but it is the same rasteriser and the same canvas limits, which is what a render and a 20,000-pixel band
// actually depend on.
//
// A SMALL render is the right instrument for this. Since the coat is scaled by COAT_REF rather than by the
// window (see docs/final-render.md), a 1024 render is proportionally the same picture as a 32768 one — so an
// engine's rasterisation signature shows up at 1024 in the same proportions, for a few seconds of CPU. What
// 1024 cannot show is anything that only exists past a cap, so the caps are probed separately, at the band
// shapes the strip path actually asks for.
//
// WHAT FAILS THE GATE: an engine that will not launch, a render that is not deterministic within that engine,
// a blank or near-blank render, a streamed PNG that does not decode where CompressionStream exists, or a mean
// difference from Blink past 48/255 — nearly a fifth of the range, which is a catastrophe detector and
// nothing finer. Cross-engine byte identity was never the claim; the picture is. There is no measured
// baseline for what Gecko and WebKit legitimately differ by at this width yet, so the difference is
// REPORTED, with anything past 8/255 flagged for a human, rather than gated on a number nobody measured.
// Once the first runs have produced those numbers, the bar becomes Chris's call.
//
//   node harness/inject.mjs && node harness/engines.mjs
import { chromium, firefox, webkit } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { renderHero } from './hero.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const ref = JSON.parse(readFileSync(join(root, 'gallery', 'reference.json'), 'utf8'));
const hooked = pathToFileURL(join(here, 'dist', 'stone-author.hooked.html')).href;

// Each engine's own 1024 render is written out, because a mean and a map are my reading of the difference
// and the picture is his. CI keeps them as a run artifact; they are never committed.
const OUT = join(here, 'dist', 'engines');
const W = 1024;                 // the fast-check width: proportional to a hero, cheap enough for three engines
const STREAM_W = 2048;          // small enough for three engines
const STREAM_H = 256;           // and a band height forced low, so the MULTI-band path is what gets tested:
const MIN_BANDS = 4;            // at any width a container can afford, the planner would otherwise use one
const DIFF_BAR = 48;            // mean channel difference that means something broke, not that AA differs
const DIFF_WARN = 8;            // above this, say so — it is worth a human looking at the map
const ENGINES = [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]];

// The engine's own limits, measured rather than assumed: a canvas past a cap does not throw, it reports the
// size you asked for and hands back dead pixels. The band shapes are the ones stripPlan asks for in anger.
//
// Each shape is timed and the run gives up on the rest once one takes too long. The first version of this
// probe measured nothing of the sort and the CI step sat for 17 minutes with no output at all — a canvas
// allocation that an engine services slowly is indistinguishable from a hang unless you time it.
const probe = async ({ budgetMs }) => {
  const fits = (w, h) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    try {
      if (c.width !== w || c.height !== h) return false;            // silently clamped
      const x = c.getContext('2d'); if (!x) return false;
      x.fillStyle = '#fff'; x.fillRect(w - 2, h - 2, 2, 2);         // the far corner: a clamped canvas fails here
      return x.getImageData(w - 1, h - 1, 1, 1).data[0] === 255;
    } catch (_) { return false; } finally { c.width = 1; c.height = 1; }
  };
  const breathe = () => new Promise(r => setTimeout(r, 0));         // let the engine reclaim before the next one
  const t0 = Date.now();
  let lo = 1, hi = 65536;                                           // largest single side, by bisection: 1xN is cheap
  while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (fits(mid, 1) && fits(1, mid)) lo = mid; else hi = mid; }
  const sideMs = Date.now() - t0;
  const bands = [];
  for (const [w, h] of [[4096, 4096], [20724, 2048], [65535, 512], [65535, 1024]]) {
    if (Date.now() - t0 > budgetMs) { bands.push(`${w}x${h}:skipped`); continue; }
    const t1 = Date.now(); const ok = fits(w, h);
    bands.push(`${w}x${h}:${ok ? 'ok' : 'NO'}/${Date.now() - t1}ms`);
    await breathe();
  }
  return { stream: typeof CompressionStream === 'function', dpr: window.devicePixelRatio,
           side: lo, sideMs, bands: bands.join(' ') };
};

// The shape of the difference, not just its size: an 8x8 map of mean channel difference, so AA everywhere
// reads differently from one blown-out region.
const RAMP = ' .,:;ox%#';
const diff = ({ png }) => {
  const p = window.__heroPix;
  const img = new Image();
  return new Promise((res, rej) => {
    img.onerror = () => rej(new Error('the reference PNG did not decode in this engine'));
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = p.w; c.height = p.h;
      const cx = c.getContext('2d'); cx.drawImage(img, 0, 0);
      const b = cx.getImageData(0, 0, p.w, p.h).data, a = p.data;
      const G = 8, cell = new Float64Array(G * G), cellN = new Float64Array(G * G);
      let sum = 0, max = 0, over = 0, lum = 0, lum2 = 0, n = p.w * p.h;
      for (let y = 0; y < p.h; y++) {
        const gy = Math.min(G - 1, Math.floor(y * G / p.h));
        for (let x = 0; x < p.w; x++) {
          const i = (y * p.w + x) * 4;
          const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
          sum += d; if (d > max) max = d; if (d > 1) over++;
          const g = gy * G + Math.min(G - 1, Math.floor(x * G / p.w)); cell[g] += d; cellN[g]++;
          const L = (a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114); lum += L; lum2 += L * L;
        }
      }
      const mean = lum / n, sd = Math.sqrt(Math.max(0, lum2 / n - mean * mean));
      const rows = [];
      for (let gy = 0; gy < G; gy++) {
        let s = '';
        for (let gx = 0; gx < G; gx++) { const m = cell[gy * G + gx] / (cellN[gy * G + gx] || 1); s += RAMP[Math.min(RAMP.length - 1, Math.round(m))]; }
        rows.push(s);
      }
      // the difference as a picture, amplified 8x: an 8x8 map says how much and roughly where, an image says
      // WHAT — vein edges, a gradient's bands, one region blown out
      const vc = document.createElement('canvas'); vc.width = p.w; vc.height = p.h;
      const vx = vc.getContext('2d'), vi = vx.createImageData(p.w, p.h), vd = vi.data;
      for (let i = 0; i < n; i++) {
        const j = i * 4;
        const d = (Math.abs(a[j] - b[j]) + Math.abs(a[j + 1] - b[j + 1]) + Math.abs(a[j + 2] - b[j + 2])) / 3;
        const v = Math.min(255, Math.round(d * 8));
        vd[j] = vd[j + 1] = vd[j + 2] = v; vd[j + 3] = 255;
      }
      vx.putImageData(vi, 0, 0);
      const visual = vc.toDataURL('image/png');
      vc.width = 1; vc.height = 1;
      c.width = 1; c.height = 1;
      res({ mean: +(sum / n).toFixed(3), max: +max.toFixed(1), pctOver1: +(100 * over / n).toFixed(2), sd: +sd.toFixed(2), map: rows, visual });
    };
    img.src = png;
  });
};

// Does the strip path — the whole large-render tier — actually produce a decodable PNG on this engine?
const streamed = async ({ w, stripH }) => {
  if (typeof CompressionStream !== 'function') return { skipped: 'no CompressionStream — the tier is not offered here' };
  const t0 = Date.now();
  const r = await window.__sa.renderStreamedPNG(w, null, null, { stripH });
  const head = new Uint8Array(await r.blob.slice(0, 24).arrayBuffer());
  const sig = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => head[i] === v);
  const dv = new DataView(head.buffer);
  const bmp = await createImageBitmap(r.blob);                      // decodes the whole zlib stream, not just the header
  const out = { sig, ihdr: [dv.getUint32(16), dv.getUint32(20)], decoded: [bmp.width, bmp.height],
                bands: r.plan.strips, bytes: r.bytes, ms: Date.now() - t0 };
  bmp.close();
  return out;
};

// the richest hero on purpose: burn pass, a reality window and a mask, so an engine difference has somewhere
// to show up. The plainest hero would pass on an engine that cannot composite a window at all.
const hero = ref.heroes.find(h => h.mask && h.burn) || ref.heroes[0];
const results = [];
let reference = null, fail = 0;

// Every phase is timed, announced as it finishes, and bounded. A phase that overruns is REPORTED as a
// failure of that phase and the run moves on to the next engine — three engines in one job must not be able
// to leave a runner sitting in silence, and the timing is what says which one was slow.
// Budgets chosen so the WORST case still fits the job: 6 minutes per engine, 18 for three, inside the
// step's 22. Blink does the whole lot in about 10 seconds, so these are generous by an order of magnitude —
// they exist to turn a hang into a named failure, not to police speed.
const PHASE = { launch: 45e3, caps: 60e3, render: 90e3, diff: 45e3, stream: 120e3 };
async function within(label, ms, thunk) {
  const t0 = Date.now();
  let timer;
  const bomb = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${label} overran ${Math.round(ms / 1000)}s`)), ms); });
  try {
    const v = await Promise.race([thunk(), bomb]);
    console.log(`  ${label}: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return v;
  } finally { clearTimeout(timer); }
}
// and a backstop under all of it, in case a phase budget is itself wrong
const watchdog = setTimeout(() => {
  console.log('WATCHDOG: the engine gate ran past 19 minutes with phases that each claimed to be bounded.');
  process.exit(1);
}, 19 * 60e3);

for (const [name, type] of ENGINES) {
  const row = { name };
  let browser;
  console.log(`[${name}]`);
  try {
    browser = await within('launch', PHASE.launch, async () => {
      const b = await type.launch();
      const page = await b.newPage({ deviceScaleFactor: 1 });
      page.on('pageerror', e => { row.pageError = e.message; });
      await page.goto(hooked);
      await page.waitForFunction(() => !!window.__sa, null, { timeout: 30000 });
      row.page = page;
      return b;
    });
    const page = row.page;

    row.caps = await within('caps', PHASE.caps, () => page.evaluate(probe, { budgetMs: PHASE.caps - 30e3 }));
    const a = await within('render x2', PHASE.render, async () => {
      const first = await renderHero(page, { root, hero, ref, width: W });
      const second = await renderHero(page, { root, hero, ref, width: W });
      row.self = first.hash === second.hash;
      return first;
    });
    row.hash = a.hash.slice(0, 16);
    // Blink goes first and becomes the reference. It is also diffed against ITSELF, which is the comparison's
    // own noise floor: a diff that cannot read 0 where the pixels are identical is measuring itself.
    const isRef = !reference;
    row.against = isRef ? 'itself (the comparison\'s noise floor)' : 'blink';
    const refPng = isRef ? a.png : reference.png;
    if (isRef) reference = a;
    row.diff = await within('diff', PHASE.diff, () => page.evaluate(diff, { png: refPng }));
    row.stream = await within('streamed export', PHASE.stream, () => page.evaluate(streamed, { w: STREAM_W, stripH: STREAM_H }));
    mkdirSync(OUT, { recursive: true });
    const save = (file, dataURL) => writeFileSync(join(OUT, file), Buffer.from(dataURL.split(',')[1], 'base64'));
    save(`${name}-${hero.name}-${W}.png`, a.png);
    save(`${name}-vs-${isRef ? 'itself' : 'blink'}-x8.png`, row.diff.visual);
    delete row.diff.visual;                                         // written to disk; not wanted in the log
  } catch (e) {
    row.error = e.message;
    console.log(`  FAILED: ${e.message}`);
  } finally { delete row.page; if (browser) await browser.close().catch(() => {}); }
  results.push(row);
}
clearTimeout(watchdog);

console.log(`hero "${hero.name}" at ${W}px, streamed export at ${STREAM_W}px\n`);
for (const r of results) {
  console.log(`--- ${r.name} ---`);
  if (r.error) { console.log(`  LAUNCH/RENDER FAILED: ${r.error}`); fail++; continue; }
  const c = r.caps;
  console.log(`  caps    CompressionStream ${c.stream ? 'yes' : 'NO'} · dpr ${c.dpr} · largest side ${c.side} (${c.sideMs}ms) · bands ${c.bands}`);
  console.log(`  render  self-determinism ${r.self ? 'PASS' : 'FAIL'} · ${r.hash} · luma sd ${r.diff.sd}`);
  console.log(`  vs ${r.against}`);
  console.log(`          mean ${r.diff.mean}/255 · max ${r.diff.max} · ${r.diff.pctOver1}% of pixels differ by more than 1`);
  for (const line of r.diff.map) console.log(`          |${line}|`);
  const s = r.stream;
  if (s.skipped) console.log(`  stream  ${s.skipped}`);
  else console.log(`  stream  ${s.sig ? 'PNG' : 'NOT A PNG'} · IHDR ${s.ihdr.join('x')} · decoded ${s.decoded.join('x')} · ${s.bands} bands · ${(s.bytes / 1e6).toFixed(1)} MB scanlines · ${s.ms} ms`);
  if (r.pageError) console.log(`  page error: ${r.pageError}`);

  if (!r.self) { console.log(`  FAIL: ${r.name} does not render the same slab the same way twice.`); fail++; }
  // the reference row compares identical pixels: if that does not read ~0, the comparison is measuring itself
  if (r.against.startsWith('itself') && r.diff.mean > 0.5) { console.log(`  FAIL: the diff reads ${r.diff.mean}/255 between identical renders — it cannot be trusted to read a real difference.`); fail++; }
  if (r.diff.sd < 1) { console.log(`  FAIL: ${r.name}'s render is flat (luma sd ${r.diff.sd}) — a blank canvas, not a slab.`); fail++; }
  if (r.diff.mean > DIFF_BAR) { console.log(`  FAIL: ${r.name} differs from Blink by ${r.diff.mean}/255, past the ${DIFF_BAR} bar — that is not anti-aliasing.`); fail++; }
  else if (r.diff.mean > DIFF_WARN) console.log(`  WARN: ${r.diff.mean}/255 is more than rasterisation usually accounts for — look at the map above.`);
  if (!s.skipped) {
    const ok = s.sig && s.decoded[0] === s.ihdr[0] && s.decoded[1] === s.ihdr[1];
    if (!ok) { console.log(`  FAIL: the streamed PNG does not decode to the size it declares on ${r.name}.`); fail++; }
    // one band would mean the forced band height never arrived and this checked the easy path instead
    if (s.bands < MIN_BANDS) { console.log(`  FAIL: only ${s.bands} band(s) — the multi-band path was not exercised at all.`); fail++; }
  }
  console.log('');
}

const ran = results.filter(r => !r.error).length;
if (ran !== ENGINES.length) console.log(`${ran} of ${ENGINES.length} engines completed — an engine that cannot be measured is a failure, not a skip.`);
console.log(`Renders and x8 difference images: ${OUT}`);
console.log(fail ? `Engines: ${fail} failure(s).` : `Engines: PASS — all ${results.length} render the slab deterministically, and the difference from Blink is recorded above.`);
process.exit(fail ? 1 : 0);

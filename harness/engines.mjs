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
import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { renderHero } from './hero.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const ref = JSON.parse(readFileSync(join(root, 'gallery', 'reference.json'), 'utf8'));
const hooked = pathToFileURL(join(here, 'dist', 'stone-author.hooked.html')).href;

const W = 1024;                 // the fast-check width: proportional to a hero, cheap enough for three engines
const STREAM_W = 2048;          // small enough for three engines
const STREAM_H = 256;           // and a band height forced low, so the MULTI-band path is what gets tested:
const MIN_BANDS = 4;            // at any width a container can afford, the planner would otherwise use one
const DIFF_BAR = 48;            // mean channel difference that means something broke, not that AA differs
const DIFF_WARN = 8;            // above this, say so — it is worth a human looking at the map
const ENGINES = [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]];

// The engine's own limits, measured rather than assumed: a canvas past a cap does not throw, it reports the
// size you asked for and hands back dead pixels. The band shapes are the ones stripPlan asks for in anger.
const probe = () => {
  const fits = (w, h) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    try {
      if (c.width !== w || c.height !== h) return false;            // silently clamped
      const x = c.getContext('2d'); if (!x) return false;
      x.fillStyle = '#fff'; x.fillRect(w - 2, h - 2, 2, 2);         // the far corner: a clamped canvas fails here
      return x.getImageData(w - 1, h - 1, 1, 1).data[0] === 255;
    } catch (_) { return false; } finally { c.width = 1; c.height = 1; }
  };
  let lo = 1, hi = 65536;                                           // largest single side, by bisection
  while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (fits(mid, 1) && fits(1, mid)) lo = mid; else hi = mid; }
  const bands = [[4096, 4096], [20724, 2048], [65535, 512], [65535, 1024]]
    .map(([w, h]) => `${w}x${h}:${fits(w, h) ? 'ok' : 'NO'}`);
  return { stream: typeof CompressionStream === 'function', dpr: window.devicePixelRatio, side: lo, bands: bands.join(' ') };
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
      c.width = 1; c.height = 1;
      res({ mean: +(sum / n).toFixed(3), max: +max.toFixed(1), pctOver1: +(100 * over / n).toFixed(2), sd: +sd.toFixed(2), map: rows });
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

for (const [name, type] of ENGINES) {
  const row = { name };
  let browser;
  try {
    browser = await type.launch();
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    page.on('pageerror', e => { row.pageError = e.message; });
    await page.goto(hooked);
    await page.waitForFunction(() => !!window.__sa, null, { timeout: 30000 });

    row.caps = await page.evaluate(probe);
    const a = await renderHero(page, { root, hero, ref, width: W });
    const b = await renderHero(page, { root, hero, ref, width: W });
    row.self = a.hash === b.hash;
    row.hash = a.hash.slice(0, 16);
    // Blink goes first and becomes the reference. It is also diffed against ITSELF, which is the comparison's
    // own noise floor: a diff that cannot read 0 where the pixels are identical is measuring itself.
    row.against = reference ? 'blink' : 'itself (the comparison\'s noise floor)';
    const refPng = reference ? reference.png : a.png;
    if (!reference) reference = a;
    row.diff = await page.evaluate(diff, { png: refPng });
    row.stream = await page.evaluate(streamed, { w: STREAM_W, stripH: STREAM_H });
  } catch (e) {
    row.error = e.message;
  } finally { if (browser) await browser.close(); }
  results.push(row);
}

console.log(`hero "${hero.name}" at ${W}px, streamed export at ${STREAM_W}px\n`);
for (const r of results) {
  console.log(`--- ${r.name} ---`);
  if (r.error) { console.log(`  LAUNCH/RENDER FAILED: ${r.error}`); fail++; continue; }
  const c = r.caps;
  console.log(`  caps    CompressionStream ${c.stream ? 'yes' : 'NO'} · dpr ${c.dpr} · largest side ${c.side} · bands ${c.bands}`);
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

if (results.length !== ENGINES.length) { console.log(`only ${results.length} of ${ENGINES.length} engines ran — a gate that skips an engine is not a gate.`); fail++; }
console.log(fail ? `Engines: ${fail} failure(s).` : `Engines: PASS — all ${results.length} render the slab deterministically, and the difference from Blink is recorded above.`);
process.exit(fail ? 1 : 0);

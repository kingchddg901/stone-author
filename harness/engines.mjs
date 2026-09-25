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
import { encodePNG } from './png.mjs';
import { compare } from './compare.mjs';

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

console.log(`hero "${hero.name}" at ${W}px, streamed export at ${STREAM_W}px with a forced ${STREAM_H}px band\n`);
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

    const a = await within('render x2', PHASE.render, async () => {
      const first = await renderHero(page, { root, hero, ref, width: W, pixels: true });
      const second = await renderHero(page, { root, hero, ref, width: W });
      row.self = first.hash === second.hash;
      return first;
    });
    row.hash = a.hash.slice(0, 16);
    row.stream = await within('streamed export', PHASE.stream, () => page.evaluate(streamed, { w: STREAM_W, stripH: STREAM_H }));
    // caps last: it allocates canvases up to 65535x1024, and nothing after it should have to share a process
    // with whatever that leaves behind
    row.caps = await within('caps', PHASE.caps, () => page.evaluate(probe, { budgetMs: PHASE.caps - 20e3 }));

    // Blink goes first and becomes the reference. It is also compared against ITSELF, which is the
    // comparison's own noise floor: one that cannot read 0 where the pixels are identical is measuring itself.
    const isRef = !reference;
    row.against = isRef ? 'itself (the comparison\'s noise floor)' : 'blink';
    const mine = Buffer.from(a.px, 'base64');
    const theirs = isRef ? mine : reference;
    if (isRef) reference = mine;
    row.diff = compare(mine, theirs, a.w, a.h);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `${name}-${hero.name}-${W}.png`), Buffer.from(a.png.split(',')[1], 'base64'));
    writeFileSync(join(OUT, `${name}-vs-${isRef ? 'itself' : 'blink'}-x8.png`), encodePNG(a.w, a.h, row.diff.vis));
    delete row.diff.vis;                                            // written to disk; not wanted in the log
    report(row);                                                    // as each engine finishes, not at the end
  } catch (e) {
    row.error = e.message;
    console.log(`  FAILED: ${e.message}`);
    fail++;
  } finally { delete row.page; if (browser) await browser.close().catch(() => {}); }
  results.push(row);
}
clearTimeout(watchdog);

const ran = results.filter(r => !r.error).length;
if (ran !== ENGINES.length) console.log(`${ran} of ${ENGINES.length} engines completed — an engine that cannot be measured is a failure, not a skip.`);
console.log(`Renders and x8 difference images: ${OUT}`);
console.log(fail ? `Engines: ${fail} failure(s).` : `Engines: PASS — all ${ran} render the slab deterministically, and the difference from Blink is recorded above.`);
process.exit(fail ? 1 : 0);

// Printed as each engine finishes rather than at the end: the first run of this gate lost chromium's and
// webkit's numbers entirely because a later engine's failure came before the summary.
function report(r) {
  console.log(`  --- ${r.name} ---`);
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

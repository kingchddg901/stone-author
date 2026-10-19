// DOES A WORKER THAT FINISHES ITS OWN TILE PRODUCE THE SAME BYTES?
//
// The render core used to hand back an ImageBitmap and this thread did the rest for every pass: cut it
// into k x k stored tiles, read each back with getImageData, stamp the mark, sample the light, deflate.
// Measured on a 131,072 at a 4096 tile that is 306.7 ms of main-thread work per pass - 74.7 readback,
// 1.0 sample, 231.0 deflate - of a 520 ms pass, and it runs SERIALLY while eight workers sit finished
// and queued behind it. The pool's own trace shows the queue: passes hand over at 0.4, 240, 489 and
// 732 ms, each waiting one consumer's turn longer than the one before.
//
// With `p.fin` the worker does that work itself and hands back deflated bytes. Measured 3.5x on the
// paint-and-finish segment at 32,768, and ~2x expected end to end once the unchanged OPFS write is
// counted back in.
//
// WHAT THIS GATE IS FOR. None of that matters if the bytes move. Every master already on disk has to
// keep reproducing, and a render interrupted on one build and resumed on another would stitch
// main-thread tiles beside worker tiles - so "identical" is not a nice-to-have here, it is the whole
// licence to ship. This renders the same picture both ways and compares the DEFLATED BYTES of every
// stored tile, plus the four counts the master publishes from them: marked cells, litSum, litUp, litN.
//
// WHY BYTES AND NOT PIXELS. The pixels are what we care about, but the bytes are what the file holds
// and they are strictly harder: identical pixels can still deflate differently if anything about the
// compression path changed, and that was a live risk - CompressionStream is implemented per engine and
// this moves it from the main thread into a worker. Comparing bytes tests the pixels AND the codec.
//
//   node harness/inject.mjs && node harness/worker-finish.mjs
//   node harness/inject.mjs && node harness/worker-finish.mjs --ablate=marksig|cut|dark|all
//
// `marksig` feeds the worker a one-bit-different mark key, `cut` transposes the stored-tile address,
// and both must go RED. `dark` renders a picture with nothing lit and must trip a self-check rather
// than passing on an empty comparison - two blank tiles are equal, which is how this family of test
// lies. `--ablate=all` runs the shipped path and all three in one go, so a single CI line shows the
// gate passing and shows it able to fail.
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, normalize } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const hookedPath = join(here, 'dist', 'stone-author.hooked.html');
if (!existsSync(hookedPath)) {
  console.error('harness/dist/stone-author.hooked.html missing - run node harness/inject.mjs first');
  process.exit(1);
}

// A SOURCE EDIT, not a flag the engine reads: a flag would be a branch only the gate takes, and a gate
// that tests its own branch tests nothing. Each of these is a plausible way to get the worker's
// addressing wrong while everything still runs.
const CODE_AB = {
  marksig: { what: 'the worker stamps a different mark key',
             from: 'markSig: p.markSig || 0', to: 'markSig: (p.markSig || 0) ^ 1' },
  cut:     { what: 'the worker transposes the stored-tile address',
             from: 'var tx=d.gx*d.k+sx,ty=d.gy*d.k+sy;', to: 'var tx=d.gx*d.k+sy,ty=d.gy*d.k+sx;' },
};
const VACUOUS_AB = { dark: 'nothing in the picture emits, so every tile is blank' };

const args = process.argv.slice(2);
const abArg = (args.find(a => a.startsWith('--ablate=')) || '').slice(9);
const modes = abArg === 'all' ? ['', 'marksig', 'cut', 'dark'] : [abArg];
for (const m of modes) if (m && !CODE_AB[m] && !VACUOUS_AB[m]) { console.error('unknown ablation: ' + m); process.exit(1); }

// Served over http because a blob Worker cannot be built from a file:// document - Chromium gives that
// page an opaque origin and the pool would fail to start for a reason that has nothing to do with bytes.
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json' };
let patch = null, anchorMissed = null;
const server = createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  const p = normalize(join(root, decodeURIComponent(url)));
  if (!p.startsWith(root) || !existsSync(p)) { res.statusCode = 404; res.end('no'); return; }
  const dot = p.lastIndexOf('.');
  res.setHeader('content-type', TYPES[p.slice(dot)] || 'application/octet-stream');
  let body = readFileSync(p);
  if (patch && p === hookedPath) {
    const parts = body.toString('utf8').split(patch.from);
    // AN ABLATION THAT DOES NOT APPLY IS A FAILURE. If the anchor moves, the "ablated" run serves the
    // shipped file, matches, and the gate reports that it bites when it did nothing at all.
    if (parts.length !== 2) anchorMissed = patch.from;
    body = Buffer.from(parts.join(patch.to), 'utf8');
  }
  res.end(body);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch();
const fail = [], out = [];

for (const mode of modes) {
  const code = CODE_AB[mode];
  patch = code || null;
  anchorMissed = null;

  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(base + '/harness/dist/stone-author.hooked.html');
  await page.waitForFunction(() => !!window.__sa, null, { timeout: 20000 });

  const r = await page.evaluate(async (vacuous) => {
    const sa = window.__sa;
    // The app's own slab, built by its own producer. Authoring one here would test this file's idea of
    // a picture rather than the engine's.
    sa.render();
    const lines = (sa.geo && sa.geo.lines) || [];
    if (vacuous !== 'dark') {
      sa.OVR_uv['lay:major'] = [{ v: -1, c: '#35c8ff' }];
      sa.OVR_uv['lay:minor'] = [{ v: -1, c: '#ff36c0' }];
      for (const L of lines) if (L.layer) sa.OVR_uv['lay:' + L.layer] = sa.OVR_uv['lay:' + L.layer] || [{ v: -1, c: '#35c8ff' }];
    } else {
      for (const k of Object.keys(sa.OVR_uv)) delete sa.OVR_uv[k];
    }
    sa.setSpx(-1);

    const W = 16384, FH = Math.round(W * (sa.T.H || 0.625)), ts = 4096, store = 2048, bleed = 4;
    const rAcross = Math.ceil(W / ts), rDown = Math.ceil(FH / ts), k = ts / store;
    const across = Math.ceil(W / store), down = Math.ceil(FH / store);
    const N = rAcross * rDown;
    const plan = { budgetMB: 12885, tileMB: 67, FH, ts, store, k, bleed, rAcross,
                   renders: N, across, down, markSig: 0x9abcdef1 };
    const H = u8 => { let h = 0x811c9dc5 >>> 0; for (let i = 0; i < u8.length; i++) h = Math.imul(h ^ u8[i], 0x01000193) >>> 0; return h.toString(16); };

    // A: the worker finishes its own tile
    const poolF = await sa.tilePool(W, { ...plan, fin: true });
    if (!poolF) return { noPool: true };
    const A = [];
    for (let i = 0; i < N; i++) {
      const rec = await poolF.finish(i);
      A.push({ painted: rec.painted, marked: rec.marked, litSum: +rec.litSum.toFixed(4),
               litUp: rec.litUp, litN: rec.litN,
               parts: rec.parts.map(q => q.idx + ':' + q.z.length + ':' + H(q.z)).join('|') });
    }
    poolF.close();

    // B: the control - bitmap back, this thread cuts, marks, samples and deflates
    const poolB = await sa.tilePool(W, { ...plan });
    const B = [];
    for (let i = 0; i < N; i++) {
      const c = await poolB.tile(i), cx = c.getContext('2d');
      const gx = i % rAcross, gy = (i / rAcross) | 0;
      let mk = 0, lS = 0, lU = 0, lN = 0; const parts = [];
      for (let sy = 0; sy < k; sy++) for (let sx = 0; sx < k; sx++) {
        const tx = gx * k + sx, ty = gy * k + sy;
        if (tx >= across || ty >= down) continue;
        const pr = sa.storedTilePixels(cx, { bleed, store }, sx, sy, tx, ty, W, plan.markSig);
        const px = pr.px; mk += pr.marked;
        for (let q = 0; q < px.length; q += 400) { const l = (px[q] + px[q + 1] + px[q + 2]) / 3; lS += l; if (l > 40) lU++; lN++; }
        const z = await sa.deflateBytes(new Uint8Array(px.buffer, px.byteOffset, px.byteLength));
        parts.push(ty * across + tx + ':' + z.length + ':' + H(z));
      }
      c.width = 1; c.height = 1;
      B.push({ painted: true, marked: mk, litSum: +lS.toFixed(4), litUp: lU, litN: lN, parts: parts.join('|') });
    }
    poolB.close();
    sa.setSpx(0);

    const diffs = [];
    for (let i = 0; i < N; i++) for (const f of ['painted', 'marked', 'litSum', 'litUp', 'litN', 'parts'])
      if (A[i][f] !== B[i][f]) diffs.push('tile ' + i + ' ' + f);
    const litTiles = A.filter(a => a.litUp > 0).length;
    const totalLit = A.reduce((s, a) => s + a.litUp, 0);
    const totalBytes = A.reduce((s, a) => s + a.parts.split('|').reduce((t, q) => t + (+q.split(':')[1] || 0), 0), 0);
    return { tiles: N, stored: N * k * k, lines: lines.length, litTiles, totalLit, totalBytes,
             diffs: diffs.length, first: diffs.slice(0, 4) };
  }, VACUOUS_AB[mode] ? mode : null);
  await page.close();

  const label = mode ? 'ablated:' + mode : 'shipped';
  if (anchorMissed) { fail.push(`${label}: the ablation anchor is gone from the source, so nothing was ablated and this run proves nothing. Anchor: ${anchorMissed}`); continue; }
  if (r.noPool) { fail.push(`${label}: the pool refused to start - nothing was compared`); continue; }

  // THE SELF-CHECKS. Each is a way for the comparison to say "identical" having compared nothing.
  const vac = [];
  if (!r.lines) vac.push('no geometry was built');
  if (!r.litTiles) vac.push('no tile had lit content');
  if (r.litTiles < r.tiles / 2) vac.push(`only ${r.litTiles} of ${r.tiles} tiles are lit`);
  if (r.totalBytes < 1e6) vac.push(`only ${r.totalBytes} bytes of output - too little to carry a difference`);

  out.push(`${label}: ${r.tiles} passes, ${r.stored} stored tiles, ${r.litTiles} lit, `
    + `${(r.totalBytes / 1e6).toFixed(1)} MB deflated -> ${r.diffs} field(s) differ`
    + (vac.length ? `   [vacuous: ${vac.join('; ')}]` : ''));

  if (!mode) {
    for (const v of vac) fail.push(`shipped: ${v}`);
    if (r.diffs) fail.push(`shipped: a worker-finished tile differs from the main-thread control - ${r.diffs} field(s), first: ${r.first.join(', ')}`);
    if (errs.length) fail.push('shipped: page errors - ' + errs.join(' | '));
  } else if (VACUOUS_AB[mode]) {
    if (!vac.length) fail.push(`ablated:${mode} (${VACUOUS_AB[mode]}) tripped no self-check - this gate cannot tell an empty comparison from a real one`);
  } else {
    if (!r.diffs) fail.push(`ablated:${mode} (${code.what}) still matched - this gate does not bite`);
    if (vac.length) fail.push(`ablated:${mode} went vacuous, so its red proves nothing: ${vac.join('; ')}`);
  }
}

await browser.close();
server.close();

for (const l of out) console.log('  ' + l);
if (fail.length) { console.error('\nFAIL'); for (const f of fail) console.error('  - ' + f); process.exit(1); }
console.log('\nworker-finish: a worker that finishes its own tile writes the same bytes as this thread'
  + (modes.length > 1 ? ', and the gate goes red when the addressing moves or the comparison is emptied' : ''));

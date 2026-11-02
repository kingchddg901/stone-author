// DOES THE LENS SURVIVE THE WORKER BOUNDARY?
//
// The lens is the last coat pass and it is a GATHER: every output pixel is read from a displaced one.
// Until 2026-11-01 it ran once over an ASSEMBLED canvas off a <=640px snapshot, so the export path
// that streams tiles to disk had no lens in it at all (`ad34c4f`); since then it is laid per tile from
// the picture's own coordinates, with `lensReach()` putting its displacement into the bleed. Then
// `7e7ad41` replaced its per-pixel trig with a radial table, which added a carried FUNCTION and a
// carried VALUE to the serialised worker core.
//
// NONE OF THAT WAS GATED THROUGH THE POOL. The four pool harnesses here - uv, window, worker-finish,
// floor - set no lens at all, so `applyLens` had never once run inside a worker in CI. It was
// hand-checked at both commits, which is not a gate: a hand check is a claim about one afternoon.
//
// WHAT CAN GO WRONG ONLY IN THE WORKER. The core is assembled as SOURCE TEXT - a list of functions,
// then a preamble of values - so the pool can disagree with the main thread in ways no single-threaded
// render can show:
//
//   A NAME THAT IS NOT CARRIED. `lensTable` is in the windowFns return literal. Drop it and the worker
//   throws ReferenceError on the first lensed tile. check-worker-core reads that literal and catches
//   it statically, which is why that gate exists; this one proves the consequence.
//
//   A VALUE THAT IS NOT CARRIED, OR CARRIED DIFFERENTLY. `LENS_TAB_ERR` is emitted into the preamble
//   because the function list carries functions only. Emit a different number there and the worker
//   builds a COARSER TABLE than the main thread: no error, no warning, two tables for one picture and
//   a tile that is quietly wrong. That is this file's main ablation and the one defect shape nothing
//   else here can see.
//
// THE CLAIM IS DIFFERENTIAL, AND IT HAS TO BE. A pooled tile is NOT byte-identical to the sequential
// one everywhere, with or without a lens: measured on this grid, 39 of 40 tiles agree exactly and one
// does not - 30 channels at up to 2 levels, which the lens then makes SMALLER rather than larger (16
// at 2). That disagreement predates the lens and is not this file's question. So the claim is:
//
//     EVERY TILE THE POOL AND THE SEQUENTIAL PATH AGREE ON WITHOUT GLASS, THEY STILL AGREE ON WITH IT.
//
// Each tile is rendered four ways - sequential and pooled, at lens 0 and at the test lens - and a tile
// is ELIGIBLE when the two paths matched exactly at lens 0. Every eligible tile must then match
// exactly with the lens on. Tiles that were already dirty are REPORTED with both numbers rather than
// dropped, so the pre-existing difference stays visible instead of being quietly designed around.
//
// THE COMPARISON IS NOT THE GATE. uv-pool learned that the expensive way: its first four hand runs
// returned "identical" on tiles that were entirely blank. Two tiles with no lens in them are equal
// too, so every tile is also rendered sequentially at lens 0 and at the test lens, and the two must
// DIFFER. If they do not, the stage never ran and the zero above means nothing. `--ablate=nolens` is
// that failure made deliberate.
//
// THE GRID IS FIXED AND THE NUMBERS IN IT COME FROM THE APP. `tiffPlan` is the real planner and it
// CALIBRATES - a reference render, then a race between candidate tile sizes against the device's
// memory ceiling - so its grid is a property of the machine, which is not what a gate wants. The tile
// size is written down here; `FH` and `bleed` are taken from `H`, `COAT_REF` and `coatReachAt`, which
// is where tiffPlan gets them too.
//
// TWO THINGS ABOUT THE GRID THAT EACH COST A WRONG ANSWER BEFORE THIS FILE SETTLED:
//
//   FH MUST BE round(W * H). `renderOneTile` derives its height from W * H; `tilePool` takes FH from
//   the plan it is handed. Give them different heights and the lens's centre sits in two different
//   places, so EVERY pixel differs - measured at 99.99% with maxErr 188 on a build with nothing
//   whatever wrong with it. uv-pool passes FH = 2048 for W = 2048, where H is 0.625 and the height is
//   1280; that costs it nothing, because nothing it measures is centred on the picture, and it would
//   cost this file everything.
//
//   THE TILE SIZE MUST DIVIDE BOTH. On a partial last row the pool returns a FULL-height tile while
//   renderOneTile returns the clipped one - 620x620 against 620x364 - and comparing the overlap reads
//   40% of the tile as different because the two canvases hold different parts of the picture. 256
//   divides 2048 and 1280; 512 divides 2048 and not 1280. Asserted below rather than remembered.
//
//   node harness/inject.mjs && node harness/lens-pool.mjs
//   node harness/inject.mjs && node harness/lens-pool.mjs --ablate=coarse|nocarry|nolens|all
import { launchChromium } from './browser.mjs';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, normalize } from 'path';

const W = 2048, TS = 256;                 // 8 x 5, every tile full - see the grid note above
const LENS = 0.45, PITCH = 9;             // steeper and tighter than the default, so the displacement
                                          // is a real number rather than a rounding one: 32px of reach
const MOVE_FLOOR = 0.5;                   // % of a tile the lens must move for that tile to count
const CLEAN_FLOOR = 20;                   // of 40: measured 39, so this is half, and far above vacuous

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const hookedPath = join(here, 'dist', 'stone-author.hooked.html');
if (!existsSync(hookedPath)) {
  console.error('harness/dist/stone-author.hooked.html missing - run node harness/inject.mjs first');
  process.exit(1);
}

// SOURCE EDITS, not flags. A flag would be a branch only the gate takes, and a gate that tests its
// own branch tests nothing. Both of these edit the WORKER's side of the boundary, which is the only
// side a pooled-against-sequential comparison can see: an edit to the shared arithmetic would move
// both arms equally and still match.
const CODE_AB = {
  coarse:  { what: "the worker builds its table to a looser error budget than the main thread's",
             from: 'var LENS_TAB_ERR=${LENS_TAB_ERR};', to: 'var LENS_TAB_ERR=1;' },
  nocarry: { what: 'lensTable is not carried into the core, as a new function is not until it is listed',
             from: 'lensReach, lensField, lensTable, blurReach', to: 'lensReach, lensField, blurReach' },
};
// PAGE STATE, because that is what it is: not a broken engine, a comparison handed two tiles with no
// glass on either of them.
const VACUOUS_AB = { nolens: 'the slab carries no lens, so the stage never runs' };

const args = process.argv.slice(2);
const abArg = (args.find(a => a.startsWith('--ablate=')) || '').slice(9);
const modes = abArg === 'all' ? ['', 'coarse', 'nocarry', 'nolens'] : [abArg];
for (const m of modes) if (m && !CODE_AB[m] && !VACUOUS_AB[m]) { console.error('unknown ablation: ' + m); process.exit(1); }

// A STATIC SERVER, because a blob Worker cannot be constructed from a file:// document - Chromium
// gives that page an opaque origin and the pool would refuse to start for a reason that has nothing
// to do with the picture.
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json' };
let patch = null;
let anchorMissed = null;
const server = createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  const p = normalize(join(root, decodeURIComponent(url)));
  if (!p.startsWith(root) || !existsSync(p)) { res.statusCode = 404; res.end('no'); return; }
  const dot = p.lastIndexOf('.');
  res.setHeader('content-type', TYPES[p.slice(dot)] || 'application/octet-stream');
  let body = readFileSync(p);
  if (patch && p === hookedPath) {
    const t = body.toString('utf8');
    const parts = t.split(patch.from);
    // AN ABLATION THAT DOES NOT APPLY IS A FAILURE, not a pass. If the anchor moves, the "ablated"
    // run serves the shipped file, matches, and the gate reports biting when it did nothing at all.
    if (parts.length !== 2) { anchorMissed = patch.from; }
    body = Buffer.from(parts.join(patch.to), 'utf8');
  }
  res.end(body);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

async function measure(page, vacuous) {
  return page.evaluate(async ({ vacuous, W, TS, LENS, PITCH }) => {
    const sa = window.__sa;
    // THE SLAB IS THE APP'S OWN. render() is size(); build(); draw() - the producer itself, so the
    // geometry under the glass is a real slab rather than this file's idea of one.
    sa.render();
    const G = sa.G;
    G.lensType = 'fresnel';                      // the radial profile, and the only one with a table
    G.lensPitch = PITCH;

    const bs = W / sa.COAT_REF;
    const FH = Math.round(W * sa.H);
    if (W % TS || FH % TS) return { badGrid: `${TS} does not divide ${W}x${FH} - a partial tile makes the pool return a full-height canvas and the sequential path a clipped one, and the overlap is not the same picture` };
    const rAcross = W / TS, rows = FH / TS, n = rAcross * rows;

    const px = cv => cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const cmp = (A, B) => {
      let d = 0, mx = 0;
      for (let i = 0; i < A.length; i += 4) {
        const e = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
        if (e) d++;
        if (e > mx) mx = e;
      }
      return { d, mx, pct: +(100 * d / (A.length / 4)).toFixed(4) };
    };

    // ONE PASS PER LENS SETTING. The lens-0 pass is the BASELINE: it says which tiles the two paths
    // agree on at all, which is the only population the lensed pass can be judged against.
    const pass = {};
    const strength = vacuous === 'nolens' ? 0 : LENS;
    let sizeMismatch = 0, poolFail = null;
    for (const L of [0, strength]) {
      G.lens = L;
      const bleed = Math.ceil(sa.coatReachAt(bs, 0));
      const po = await sa.tilePool(W, { budgetMB: 4096, tileMB: Math.round((TS + 2 * bleed) ** 2 * 4 / 1e6),
                                        FH, ts: TS, bleed, rAcross, renders: n });
      if (!po) return { noPool: true };
      const rec = { L, bleed, reach: sa.lensReach(bs), width: po.planned, tiles: [] };
      try {
        for (let IDX = 0; IDX < n; IDX++) {
          const gx = IDX % rAcross, gy = (IDX / rAcross) | 0;
          const s = sa.renderOneTile(W, gx * TS, gy * TS, TS, TS, bleed);
          // A WORKER THAT THREW NEVER ANSWERS, so the wait is bounded. A hang here would surface as a
          // CI timeout many minutes later with nothing said; this says it in twenty seconds.
          let p = null;
          try {
            p = await Promise.race([po.tile(IDX),
              new Promise((_, rej) => setTimeout(() => rej(new Error('the pool did not return tile ' + IDX + ' within 20s')), 20000))]);
          } catch (e) { poolFail = poolFail || { L, IDX, why: String(e && e.message || e) }; break; }
          if (s.width !== p.width || s.height !== p.height) { sizeMismatch++; continue; }
          rec.tiles.push({ IDX, seq: px(s), pool: cmp(px(s), px(p)) });
        }
      } finally { try { po.close(); } catch {} }
      pass['L' + L] = rec;
      if (poolFail) break;
    }
    if (poolFail) return { poolFail, sizeMismatch };

    const b = pass.L0, l = pass['L' + strength];
    // THE LENS'S OWN EFFECT, from the two SEQUENTIAL renders of each tile. Not the pooled ones: that
    // would be asking the thing under test whether there was anything to test.
    const rows2 = [];
    for (let i = 0; i < Math.min(b.tiles.length, l.tiles.length); i++) {
      const bt = b.tiles[i], lt = l.tiles[i];
      if (bt.IDX !== lt.IDX) continue;
      rows2.push({ IDX: bt.IDX, moved: cmp(bt.seq, lt.seq), basePool: bt.pool, lensPool: lt.pool });
    }
    const eligible = rows2.filter(r => r.basePool.d === 0);
    const broke = eligible.filter(r => r.lensPool.d > 0);
    const dirtyBase = rows2.filter(r => r.basePool.d > 0)
      .map(r => `${r.IDX}: ${r.basePool.d}px/${r.basePool.mx} without the lens, ${r.lensPool.d}px/${r.lensPool.mx} with it`);
    const unmoved = rows2.filter(r => !(r.moved.pct >= 0.5)).map(r => `${r.IDX} (${r.moved.pct}%)`);

    const vac = [];
    if (!((sa.geo && sa.geo.lines) || []).length) vac.push('no geometry was built, so there is nothing for the lens to displace');
    if (strength > 0 && !(l.reach > 0)) vac.push('lensReach is 0 for a lens that is on - the bleed would never grow for it');
    if (unmoved.length) vac.push(`the lens moved less than 0.5% of ${unmoved.length} of ${rows2.length} tiles: ${unmoved.slice(0, 6).join(', ')}`);

    return { grid: `${TS}px ${rAcross}x${rows}`, FH, bleed: l.bleed, reach: l.reach, width: l.width,
             lens: strength, lines: ((sa.geo && sa.geo.lines) || []).length,
             tiles: rows2.length, eligible: eligible.length, sizeMismatch,
             movedMin: rows2.length ? Math.min(...rows2.map(r => r.moved.pct)) : 0,
             broke: broke.map(r => `${r.IDX}: ${r.lensPool.d}px up to ${r.lensPool.mx} levels`),
             dirtyBase, vac };
  }, { vacuous, W, TS, LENS, PITCH });
}

const browser = await launchChromium();
const fail = [];
const out = [];
// The shipped run's count of tiles the two paths already disagree on. An ablation is only
// LENS-SPECIFIC if it leaves that number alone - one that dirties the lens-0 pass too is breaking the
// pool rather than the lens. Null when the shipped run is not part of this invocation, and the check
// is then skipped rather than guessed at.
let shippedDirty = null;

for (const mode of modes) {
  const code = CODE_AB[mode];
  patch = code || null;
  anchorMissed = null;

  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(base + '/harness/dist/stone-author.hooked.html');
  await page.waitForFunction(() => !!window.__sa, null, { timeout: 20000 });
  let r;
  try { r = await measure(page, VACUOUS_AB[mode] ? mode : null); }
  catch (e) { r = { crashed: String(e && e.message || e) }; }
  await page.close();

  const label = mode ? 'ablated:' + mode : 'shipped';
  if (anchorMissed) { fail.push(`${label}: the ablation anchor is gone from the source - nothing was ablated, so this run proves nothing. Anchor: ${anchorMissed}`); continue; }
  if (r.badGrid) { fail.push(`${label}: ${r.badGrid}`); continue; }
  if (r.noPool) { fail.push(`${label}: the pool refused to start - nothing was compared`); continue; }

  // THE THREE WAYS THIS GATE NOTICES. A worker that threw and a tile that never arrived are what a
  // missing carried NAME looks like; an eligible tile going dirty is what a carried VALUE that
  // differs looks like, and it is the quiet one.
  const noticed = !!r.crashed || !!r.poolFail || errs.length > 0 || (r.broke || []).length > 0;

  if (r.crashed) out.push(`${label}: the page threw - ${r.crashed}`);
  else if (r.poolFail) out.push(`${label}: at lens ${r.poolFail.L}, tile ${r.poolFail.IDX} never came back - ${r.poolFail.why}`);
  else {
    out.push(`${label}: lens ${r.lens} pitch ${PITCH}, ${r.grid} of ${W}x${r.FH}, +${r.bleed}px bleed of which the lens asks ${r.reach}, pool ${r.width} wide, ${r.lines} lines`);
    out.push(`    ${r.eligible} of ${r.tiles} tiles agree without the lens; with it, ${r.eligible - (r.broke || []).length} of those ${r.eligible} still do`
             + `   (the lens moves at least ${r.movedMin}% of every tile)`);
    for (const d of r.dirtyBase) out.push(`    pre-existing, not the lens - tile ${d}`);
    for (const b of r.broke) out.push(`    THE LENS BROKE IT - tile ${b}`);
    if (r.sizeMismatch) out.push(`    ${r.sizeMismatch} tile(s) came back a different size from the two paths`);
    if (r.vac.length) out.push('    [vacuous: ' + r.vac.join('; ') + ']');
  }
  if (errs.length) out.push('    page errors: ' + errs.join(' | '));

  if (!mode) {
    shippedDirty = (r.dirtyBase || []).length;
    if (r.crashed) fail.push(`shipped: ${r.crashed}`);
    if (r.poolFail) fail.push(`shipped: at lens ${r.poolFail.L}, tile ${r.poolFail.IDX} never came back - ${r.poolFail.why}`);
    for (const v of r.vac || []) fail.push(`shipped: ${v}`);
    for (const b of r.broke || []) fail.push(`shipped: a tile the two paths agreed on without the lens differs with it - ${b}`);
    if (r.sizeMismatch) fail.push(`shipped: ${r.sizeMismatch} tile(s) differ in SIZE between the two paths - the grid is wrong, not the lens`);
    if ((r.eligible || 0) < CLEAN_FLOOR) fail.push(`shipped: only ${r.eligible} of ${r.tiles} tiles agree without the lens, under the ${CLEAN_FLOOR} floor - there is too little agreement left for the lensed comparison to mean anything`);
    if (errs.length) fail.push('shipped: page errors - ' + errs.join(' | '));
  } else if (VACUOUS_AB[mode]) {
    if (!(r.vac || []).length) fail.push(`ablated:${mode} (${VACUOUS_AB[mode]}) tripped no self-check - this gate cannot tell a lensless comparison from a lensed one`);
    if (noticed) fail.push(`ablated:${mode} broke the render - it is meant to empty the comparison, not fail it`);
  } else {
    if (!noticed) fail.push(`ablated:${mode} (${code.what}) changed nothing this gate can see - it does not bite`);
    // SPECIFIC TO THE LENS, or it is breaking the pool and proving something else. The lens-0 pass
    // never calls applyLens, so neither ablation can reach it: a worker that failed at lens 0, or a
    // baseline that got dirtier, means the edit went wider than the stage under test.
    if (r.poolFail && !(r.poolFail.L > 0))
      fail.push(`ablated:${mode} failed the lens-0 pass, where applyLens is never called - it is not specific to the lens`);
    if (shippedDirty !== null && (r.dirtyBase || []).length > shippedDirty)
      fail.push(`ablated:${mode} left ${(r.dirtyBase || []).length} tiles disagreeing without the lens against the shipped run's ${shippedDirty} - it is not specific to the lens`);
    if ((r.vac || []).length) fail.push(`ablated:${mode} went vacuous, so its red proves nothing: ${r.vac.join('; ')}`);
  }
}

await browser.close();
server.close();

for (const l of out) console.log('  ' + l);
if (fail.length) { console.error('\nFAIL'); for (const f of fail) console.error('  - ' + f); process.exit(1); }
console.log('\nlens-pool: every tile the pool and the sequential path agree on without glass, they agree on'
  + ' with it, on tiles proven to carry the lens'
  + (modes.length > 1 ? ', and the gate goes red when the worker loses the table or builds a different one' : ''));

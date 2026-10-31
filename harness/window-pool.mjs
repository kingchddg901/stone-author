// DOES A WORKER COMPOSITE A REALITY WINDOW THE SAME WAY THIS THREAD DOES?
//
// An island with Show through renders the slab AGAIN at its own light and feathers that render in
// through the disc. Until 2026-10-20 only the main thread could do it: renderSlabTo and
// compositeWindow each built their surface with document.createElement, and a worker has no
// `document`. So corePaintsThis carried a clause refusing the pool outright whenever a slab held one
//
//     !gatherMasks().some(w => w.show != null)
//
// and every windowed master this project ever rendered was single-threaded. On a 131,072 that is four
// and a half minutes against fifty-one seconds - the cost was never small, and nothing reported it.
//
// Both now go through newSurface and the worker's tile source composites its own windows, line for
// line with renderOneTile's block including the skip test that spares tiles no disc reaches. This
// gate is what lets that clause stay removed: it renders the same windowed slab both ways and
// compares the pixels of every tile.
//
// THE FAILURE THIS GUARDS IS SILENT. A worker that quietly skipped the composite would produce a
// master that is complete, correct-looking and missing its islands - which is exactly what happened
// once before, when the tiled path dropped windows entirely and it took a week to notice, because
// Hero's window shows DAYLIGHT and daylight is invisible in a daylight master.
//
//   node harness/inject.mjs && node harness/window-pool.mjs
//   node harness/window-pool.mjs --ablate=skip|nowin|all
//
// `skip` inverts the worker's own skip test so it composites nothing, and must go RED. `nowin` takes
// the window away so the two paths agree trivially, and must trip a SELF-CHECK rather than passing -
// because two tiles with no window in them are equal, and that is how this family of test lies.
import { launchChromium } from './browser.mjs';
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

// The anchor is the COMPACT form, which only the generated worker source carries; the main thread's
// own block is spaced and so cannot be hit by accident.
//
// IT MOVED ONCE AND THE GATE CAUGHT IT. The anchor was `if(win.show==null)continue;` until windows
// became per authored material: that guard left the loop for windowMasks(), the ablation found
// nothing to patch, and this harness refused to claim a result rather than passing on a run where
// nothing had been ablated. The new anchor gives the loop an empty list, which is the same failure
// in one fewer step - a worker that composites no windows at all.
const CODE_AB = {
  skip: { what: "the worker's window loop skips every window",
          from: 'var __W=windowMasks();', to: 'var __W=[];' },
};
const VACUOUS_AB = { nowin: 'the slab carries no window, so both paths agree trivially' };

const args = process.argv.slice(2);
const abArg = (args.find(a => a.startsWith('--ablate=')) || '').slice(9);
const modes = abArg === 'all' ? ['', 'skip', 'nowin'] : [abArg];
for (const m of modes) if (m && !CODE_AB[m] && !VACUOUS_AB[m]) { console.error('unknown ablation: ' + m); process.exit(1); }

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
    if (parts.length !== 2) anchorMissed = patch.from;
    body = Buffer.from(parts.join(patch.to), 'utf8');
  }
  res.end(body);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const browser = await launchChromium();
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

  const r = await page.evaluate(async (noWin) => {
    const sa = window.__sa;
    sa.render();
    if (!noWin) {
      // A reality window: an island with Show through on, looking out on DAYLIGHT. Under a black
      // light that disc is the most prominent object in the picture, which is what makes it a fair
      // subject - a window that matched the light around it would hide a dropped composite.
      sa.marks = sa.marks.concat([{ kind: 'mask', at: [0.46, 0.42], r: 0.17,
                                    p: { maskWin: 1, maskSpec: 0, maskFeather: 0.06, maskInvert: 0 } }]);
      sa.render();
    }
    const lines = (sa.geo && sa.geo.lines) || [];
    sa.OVR_uv['lay:major'] = [{ v: -1, c: '#35c8ff' }];
    sa.OVR_uv['lay:minor'] = [{ v: -1, c: '#ff36c0' }];
    for (const L of lines) if (L.layer) sa.OVR_uv['lay:' + L.layer] = sa.OVR_uv['lay:' + L.layer] || [{ v: -1, c: '#35c8ff' }];
    sa.setSpx(-1);

    const W = 16384, FH = Math.round(W * (sa.T.H || 0.625)), ts = 4096, bleed = 4;
    const rAcross = Math.ceil(W / ts), rDown = Math.ceil(FH / ts), N = rAcross * rDown;
    const plan = { budgetMB: 12885, tileMB: 67, FH, ts, store: ts, k: 1, bleed, rAcross,
                   renders: N, across: rAcross, down: rDown, markSig: 0 };
    const H = u8 => { let h = 0x811c9dc5 >>> 0; for (let i = 0; i < u8.length; i++) h = Math.imul(h ^ u8[i], 0x01000193) >>> 0; return h.toString(16); };
    const grab = c => { const d = c.getContext('2d').getImageData(bleed, bleed, ts, ts).data;
      let lit = 0; for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) > 40) lit++;
      const o = { h: H(d), lit: +(100 * lit / (d.length / 4)).toFixed(2) };
      c.width = 1; c.height = 1; return o; };

    const pool = await sa.tilePool(W, { ...plan });
    if (!pool) return { noPool: true, core: sa.corePaintsThis() };
    const A = []; for (let i = 0; i < N; i++) A.push(await pool.tile(i).then(grab));
    pool.close();
    const B = []; for (let i = 0; i < N; i++) { const gx = i % rAcross, gy = (i / rAcross) | 0;
      B.push(grab(sa.renderOneTile(W, gx * ts, gy * ts, ts, ts, bleed))); }

    // IS THERE A WINDOW IN THE PICTURE AT ALL? Rendered again with the island taken out: if that
    // changes nothing, the disc was never drawn and the comparison above compared nothing.
    //
    // DOWN THE SEQUENTIAL PATH, DELIBERATELY. The first version asked this through the pool, which is
    // the path an ablation disables - so `skip`, whose whole job is to stop the worker compositing,
    // made the picture look as though it had never held a window and the gate reported its own red as
    // vacuous. A check on whether the subject exists must not run through the thing under test.
    const kept = sa.marks;
    sa.marks = kept.filter(m => !(m.kind === 'mask' && m.p && m.p.maskWin));
    sa.render();
    const C = []; for (let i = 0; i < N; i++) { const gx = i % rAcross, gy = (i / rAcross) | 0;
      C.push(grab(sa.renderOneTile(W, gx * ts, gy * ts, ts, ts, bleed))); }
    sa.marks = kept; sa.render(); sa.setSpx(0);

    return { tiles: N, windows: kept.filter(m => m.kind === 'mask' && m.p && m.p.maskWin).length,
             mismatches: A.filter((x, i) => x.h !== B[i].h).length,
             windowChanges: B.filter((x, i) => x.h !== C[i].h).length,
             litWith: Math.max(...B.map(x => x.lit)), litWithout: Math.max(...C.map(x => x.lit)) };
  }, !!VACUOUS_AB[mode]);
  await page.close();

  const label = mode ? 'ablated:' + mode : 'shipped';
  if (anchorMissed) { fail.push(`${label}: the ablation anchor is gone, so nothing was ablated and this run proves nothing. Anchor: ${anchorMissed}`); continue; }
  if (r.noPool) { fail.push(`${label}: the pool refused to start (corePaintsThis ${r.core}) - nothing was compared`); continue; }

  const vac = [];
  if (!r.windows) vac.push('the slab carries no window');
  if (!r.windowChanges) vac.push('removing the window changed no tile - the disc is not being drawn');

  out.push(`${label}: ${r.tiles} tiles, ${r.windows} window(s), ${r.windowChanges} tile(s) change when it is removed `
    + `(lit ${r.litWithout}% -> ${r.litWith}%) -> ${r.mismatches} tile(s) differ pooled vs sequential`
    + (vac.length ? `   [vacuous: ${vac.join('; ')}]` : ''));

  if (!mode) {
    for (const v of vac) fail.push(`shipped: ${v}`);
    if (r.mismatches) fail.push(`shipped: a pooled tile differs from the sequential one - ${r.mismatches} of ${r.tiles}`);
    if (errs.length) fail.push('shipped: page errors - ' + errs.join(' | '));
  } else if (VACUOUS_AB[mode]) {
    if (!vac.length) fail.push(`ablated:${mode} tripped no self-check - this gate cannot tell an empty comparison from a real one`);
  } else {
    if (!r.mismatches) fail.push(`ablated:${mode} (${code.what}) still matched - this gate does not bite`);
    if (vac.length) fail.push(`ablated:${mode} went vacuous, so its red proves nothing: ${vac.join('; ')}`);
  }
}

await browser.close();
server.close();

for (const l of out) console.log('  ' + l);
if (fail.length) { console.error('\nFAIL'); for (const f of fail) console.error('  - ' + f); process.exit(1); }
console.log('\nwindow-pool: a worker composites a reality window exactly as this thread does'
  + (modes.length > 1 ? ', and the gate goes red when the composite is skipped or the window removed' : ''));

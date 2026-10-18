// DOES A POOLED TILE MATCH THE SEQUENTIAL ONE UNDER BLACK LIGHT?
//
// It did not, and for two separate reasons, and nothing could see either because the pool was never
// asked to paint UV at all: `corePaintsThis` carried a `!uvMode` clause, so black light always fell
// back to the main thread. A gate cannot find a bug in a branch that never runs.
//
// THE TWO FAULTS, both invisible in daylight because both sit inside `uvMode`:
//
//   1. THE GROUND. renderOneTile fills UV_GROUND (#000000); the worker filled UV_DARK (#0a0a0e).
//      applyCoat then lays UV_LIFT - UV_DARK x 1.9, the two bloom alphas - over the whole tile under
//      'lighter', so the sequential tile arrives at rgb(19,19,27) on empty ground and the pooled one
//      at rgb(29,29,41). The difference is rgb(10,10,14), which is UV_DARK exactly. Ablated here:
//      86.45% of the tile different, maxErr 14 - the blue channel of UV_DARK, which is the signature.
//
//   2. THE GLOW RADIUS. Every main-thread render path sets `glowPx = BLOOM_DRAW ? 16 * bs : 0` on
//      entry. The worker preamble declared `glowPx=0` and nothing ever wrote it, so the worker took
//      the wrong side of two branches at once: paintVeinLayer's `glowPx > 0` refused to draw each
//      element's halo, and applyCoat's `!(BLOOM_DRAW && glowPx > 0)` then ran the two blur passes
//      that exist only for an engine with no drawn halo. Ablated here: 93.98% different, maxErr 136.
//
// WHY THIS GATE IS SHAPED THE WAY IT IS. The first four times this comparison was run by hand it
// returned "identical" - on tiles that were entirely blank, because `deserialize` restores MARKS and
// only `build()` turns them into geometry, and the harness never called it. Two empty tiles are
// equal. So the comparison is not the gate; the comparison PLUS the proof that there was something
// to compare is the gate.
//
// Measured, on the two ways this file can pass while proving nothing:
//
//                        lines  emitting  UV lit%  maxV   pooled-vs-sequential
//     a real tile           70        70    45.06   255   0 px        <- the gate passing
//     nothing emits         70         0     4.98    50   0 px        <- would also "pass"
//     no geometry            0         -     1.99    51   0 px        <- would also "pass"
//
// LIT_FLOOR IS THE WEAK ONE AND IT IS DELIBERATELY NOT THE ONLY ONE. build() seeds a fresh slab per
// load, so how much of a tile is lit varies with the seed: this desktop produced 70 lines and 45%,
// CI's first run produced 11 lines and 24.02%. A floor set at 20 would have had four points of
// headroom on a number nothing controls, which is a gate that reds a correct render on an unlucky
// seed. So the floor drops to 10 - still twice the worst vacuous reading - and MAXV_FLOOR carries
// the real weight, because peak brightness does NOT vary with how much geometry a seed laid down:
// an emitting line is drawn at full strength or it is not there at all, which is 255 against 50.
//
// `uvVsDay` is kept as a check but does NOT discriminate - it reads 100% in all three rows, because
// the ground and coat change with the light whether or not anything glows. Saying so here so the
// next reader does not mistake it for the guard that saves this gate.
//
//   node harness/inject.mjs && node harness/uv-pool.mjs
//   node harness/inject.mjs && node harness/uv-pool.mjs --ablate=ground|glow|dark|nogeo|all
//
// `ground` and `glow` are SOURCE edits that put each fault back and require a red. `dark` and `nogeo`
// are the two vacuity modes above and require a self-check to trip. `all` runs the shipped file and
// all four in turn, so one CI run shows the gate passing and shows it is able to fail.
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, normalize } from 'path';

const LIT_FLOOR = 10;                     // see the table above: seed-dependent, so the weaker of the two
const MAXV_FLOOR = 150;                   // 255 when anything emits, 50 when nothing does - seed-independent

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const hookedPath = join(here, 'dist', 'stone-author.hooked.html');
if (!existsSync(hookedPath)) {
  console.error('harness/dist/stone-author.hooked.html missing - run node harness/inject.mjs first');
  process.exit(1);
}

// THE CODE ABLATIONS ARE SOURCE EDITS, not flags the engine reads. A flag would be a fifth branch
// that only the gate takes, and a gate that tests its own branch tests nothing. Each puts the shipped
// file back into the state it was actually in when the bug existed.
const CODE_AB = {
  ground: { what: 'the worker fills UV_DARK instead of UV_GROUND, as it did',
            from: 'if(uvMode){tcx.fillStyle=UV_GROUND;', to: 'if(uvMode){tcx.fillStyle=UV_DARK;' },
  glow:   { what: 'the worker never sets glowPx, as it did',
            from: 's += `glowPx=BLOOM_DRAW?16*d.bs:0;', to: 's += `/*ablated*/;' },
};
// THE VACUITY ABLATIONS ARE PAGE STATE, because that is what they were: not a broken engine, a
// comparison handed nothing to compare. They must be caught by a self-check, not by the diff.
const VACUOUS_AB = {
  dark:  'the geometry is there but nothing emits',
  nogeo: 'the geometry is empty',
};

const args = process.argv.slice(2);
const abArg = (args.find(a => a.startsWith('--ablate=')) || '').slice(9);
const modes = abArg === 'all' ? ['', 'ground', 'glow', 'dark', 'nogeo'] : [abArg];
for (const m of modes) if (m && !CODE_AB[m] && !VACUOUS_AB[m]) { console.error('unknown ablation: ' + m); process.exit(1); }

// A STATIC SERVER, because a blob Worker cannot be constructed from a file:// document - Chromium
// gives that page an opaque origin and the pool would fail to start for a reason that has nothing to
// do with the picture. Serving the repo over http is the smallest thing that makes the real path real.
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
    // run serves the shipped file, matches, and the gate reports that it bites when it did nothing.
    if (parts.length !== 2) { anchorMissed = patch.from; }
    body = Buffer.from(parts.join(patch.to), 'utf8');
  }
  res.end(body);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

// The whole measurement, run inside the page. `vacuous` selects a vacuity ablation or nothing.
async function measure(page, vacuous) {
  return page.evaluate(async ({ vacuous, LIT_FLOOR, MAXV_FLOOR }) => {
    const sa = window.__sa;
    // THE SLAB IS THE APP'S OWN. Authoring one here would mean a fixture that encodes this file's
    // idea of a slab rather than the engine's - and the first version of this comparison did exactly
    // that and compared two empty tiles. render() is size(); build(); draw(): the producer itself.
    sa.render();
    const lines = (sa.geo && sa.geo.lines) || [];
    if (vacuous !== 'dark') {
      // Every committed slab's OVR_uv entry is a one-stop list, so this is the shape real slabs
      // carry, and major/minor are the two buckets paintVeinLayer walks.
      sa.OVR_uv['lay:major'] = [{ v: -1, c: '#35c8ff' }];
      sa.OVR_uv['lay:minor'] = [{ v: -1, c: '#ff36c0' }];
      for (const L of lines) if (L.layer) sa.OVR_uv['lay:' + L.layer] = sa.OVR_uv['lay:' + L.layer] || [{ v: -1, c: '#35c8ff' }];
    } else {
      for (const k of Object.keys(sa.OVR_uv)) delete sa.OVR_uv[k];
    }
    if (vacuous === 'nogeo') lines.length = 0;

    const W = 2048, FH = 2048, ts = 512, bleed = 16, rAcross = 4, side = ts + 2 * bleed;
    const plan = () => ({ budgetMB: 4096, tileMB: 16, FH, ts, bleed, rAcross, renders: rAcross * 4 });
    const px = cv => cv.getContext('2d').getImageData(0, 0, side, side).data;
    const stats = A => { let lit = 0, mx = 0; for (let i = 0; i < A.length; i += 4) { const v = Math.max(A[i], A[i + 1], A[i + 2]); if (v > 40) lit++; if (v > mx) mx = v; } return { litPct: +(100 * lit / (A.length / 4)).toFixed(2), maxV: mx }; };
    const cmp = (A, B) => { let d = 0, mx = 0; for (let i = 0; i < A.length; i += 4) { const e = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])); if (e) d++; if (e > mx) mx = e; } return { diffPx: d, diffPct: +(100 * d / (A.length / 4)).toFixed(3), maxErr: mx }; };

    sa.setSpx(-1);
    const emitting = lines.filter(L => sa.emit(L.id, L.layer)).length;
    // Pick the tile with the most emitting geometry in it rather than a fixed index: build() seeds a
    // fresh slab on every load, so nothing guarantees a vein runs through tile 10, and a gate that
    // silently lands on an empty corner is the failure this whole file is about.
    const score = new Map();
    for (const L of lines) {
      if (!sa.emit(L.id, L.layer)) continue;
      for (const pt of L.pts) {
        const gx = Math.floor(pt[0] * W / ts), gy = Math.floor((pt[1] / (sa.T.H || 1)) * FH / ts);
        if (gx < 0 || gy < 0 || gx >= rAcross || gy * rAcross + gx >= rAcross * 4) continue;
        const i = gy * rAcross + gx; score.set(i, (score.get(i) || 0) + 1);
      }
    }
    const IDX = [...score.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0])[0] ?? 0;
    const gx = IDX % rAcross, gy = (IDX / rAcross) | 0;

    const uvSeq = px(sa.renderOneTile(W, gx * ts, gy * ts, ts, ts, bleed));
    let po = await sa.tilePool(W, plan());
    if (!po) return { noPool: true };
    const uvPool = px(await po.tile(IDX)); po.close();

    sa.setSpx(0);
    const daySeq = px(sa.renderOneTile(W, gx * ts, gy * ts, ts, ts, bleed));
    po = await sa.tilePool(W, plan());
    const dayPool = px(await po.tile(IDX)); po.close();

    const uvStats = stats(uvSeq);
    const vac = [];
    if (!lines.length) vac.push('no geometry was built');
    if (!emitting) vac.push('no line emitted under the UV light');
    if (uvStats.litPct < LIT_FLOOR) vac.push(`the UV tile is only ${uvStats.litPct}% lit, under the ${LIT_FLOOR}% floor - too dark to carry a difference`);
    if (uvStats.maxV < MAXV_FLOOR) vac.push(`the UV tile peaks at ${uvStats.maxV}, under the ${MAXV_FLOOR} floor - nothing in it is actually glowing`);
    if (!cmp(uvSeq, daySeq).diffPx) vac.push('the UV tile equals the daylight tile - the light did nothing');

    return { tile: IDX, lines: lines.length, emitting, vac,
             uv: cmp(uvSeq, uvPool), day: cmp(daySeq, dayPool), uvStats, dayStats: stats(daySeq) };
  }, { vacuous, LIT_FLOOR, MAXV_FLOOR });
}

const browser = await chromium.launch();
const fail = [];
const out = [];

for (const mode of modes) {
  const code = CODE_AB[mode];
  patch = code || null;
  anchorMissed = null;

  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(base + '/harness/dist/stone-author.hooked.html');
  await page.waitForFunction(() => !!window.__sa, null, { timeout: 20000 });
  const r = await measure(page, VACUOUS_AB[mode] ? mode : null);
  await page.close();

  const label = mode ? 'ablated:' + mode : 'shipped';
  if (anchorMissed) { fail.push(`${label}: the ablation anchor is gone from the source - nothing was ablated, so this run proves nothing. Anchor: ${anchorMissed}`); continue; }
  if (r.noPool) { fail.push(`${label}: the pool refused to start - nothing was compared`); continue; }

  out.push(`${label}: tile ${r.tile}, ${r.lines} lines (${r.emitting} emitting), UV ${r.uvStats.litPct}% lit peak ${r.uvStats.maxV} `
    + `-> pooled-vs-sequential ${r.uv.diffPct}% maxErr ${r.uv.maxErr}; daylight ${r.day.diffPct}% maxErr ${r.day.maxErr}`
    + (r.vac.length ? `   [vacuous: ${r.vac.join('; ')}]` : ''));

  if (!mode) {
    for (const v of r.vac) fail.push(`shipped: ${v}`);
    if (r.uv.diffPx) fail.push(`shipped: a pooled UV tile differs from the sequential one - ${r.uv.diffPct}% of pixels, up to ${r.uv.maxErr} levels`);
    if (r.day.diffPx) fail.push(`shipped: a pooled DAYLIGHT tile differs from the sequential one - ${r.day.diffPct}% of pixels, up to ${r.day.maxErr} levels`);
    if (errs.length) fail.push('shipped: page errors - ' + errs.join(' | '));
  } else if (VACUOUS_AB[mode]) {
    if (!r.vac.length) fail.push(`ablated:${mode} (${VACUOUS_AB[mode]}) tripped no self-check - this gate cannot tell an empty comparison from a real one`);
    if (r.uv.diffPx) fail.push(`ablated:${mode} changed the picture - it is meant to empty the comparison, not break the render`);
  } else {
    if (!r.uv.diffPx) fail.push(`ablated:${mode} (${code.what}) still matched - this gate does not bite`);
    if (r.day.diffPx) fail.push(`ablated:${mode} moved the DAYLIGHT tile too - the ablation is not specific to UV`);
    if (r.vac.length) fail.push(`ablated:${mode} went vacuous, so its red proves nothing: ${r.vac.join('; ')}`);
  }
}

await browser.close();
server.close();

for (const l of out) console.log('  ' + l);
if (fail.length) { console.error('\nFAIL'); for (const f of fail) console.error('  - ' + f); process.exit(1); }
console.log('\nuv-pool: a pooled UV tile is bit-exact against the sequential one, on a tile proven lit'
  + (modes.length > 1 ? ', and the gate goes red when either fault is put back or the comparison is emptied' : ''));

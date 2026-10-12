// Does this master carry a seam at its render-pass joins?
//
// A tiled master is painted in passes — 40 of them at 65535, eight across by five down — and each pass is
// its own canvas. Anything that differs between those canvases lands in the picture as a seam at a pass
// join, with geometry crossing it unbroken because geometry is drawn in slab space and is not the problem.
//
//   node tools/check-seam.mjs <master.tif> [...]        audit one or more masters
//   node tools/check-seam.mjs --self-test <master.tif>  prove both tests can go red
//   node tools/check-seam.mjs --inject <n> [--vary] <m> walk an injected seam down to find the floor
//
// TWO TESTS, BECAUSE THE DEFECT HAS TWO SHAPES AND EITHER ONE ALONE CERTIFIES POWER IT DOES NOT HAVE.
//
//   STEP      a systematic lift: every pass offset from its neighbour the same way. Signed, so it adds up
//             across cells. Measured with a slope-corrected discontinuity over 64 columns each side.
//   ROUGHNESS independent per-pass variation: each pass differs from its neighbour by its own amount in
//             its own direction, so a signed mean cancels to nothing however large the seam is. Measured
//             as the median single-column jump at joins against the same statistic at control columns in
//             the same file.
//
// WHAT A FLOOR MEASURES AGAINST THE SLAB IT WAS CUT FROM, 8,192 x 5,120 in 512 passes, the same
// picture rendered twice on 2026-10-12 with Lay tiles off and on:
//
//   render              joins     controls   ratio
//   slab (floor off)    0.0003    0.0007     0.5x     pass joins SMOOTHER than ordinary columns
//   floor (hexagons)    0.0449    0.0065     6.9x
//
// Two things to read off it. The tiled path itself puts NOTHING at a pass join - 0.5x is a join that
// cannot be found - so a floor's 6.9x belongs to the floor and not to the renderer's tiling. And a
// floor is intrinsically rougher EVERYWHERE, controls 0.0065 against 0.0007, because it has hairline
// joints all over the picture; the join excess sits on top of that and is 0.038 of 255, a seventh of
// one level. It does not fire: RATIO_FAIL is cleared but MIN_ROUGH is not, which is exactly the case
// MIN_ROUGH exists for - a control this smooth makes any ratio large.
//
// The S23 master of 2026-09-26 has the second and not the first: +0.080 signed (z +0.32, indistinguishable
// from no seam) against a roughness ratio of 9.0x. A signed-only gate passes it. That is not hypothetical
// — it is what this file did until the roughness test was added.
//
// WHAT MAKES THE PASSES DIFFER, measured 2026-10-01 in the live app by rendering the SAME global columns
// from two pass origins AT THE REAL OFFSET — adjacent passes are one pass apart, 8192 px — and diffing.
// `ctx.filter = blur()` is not origin-invariant, and whether two particular origins agree depends on the
// radius:
//
//   arm                                         coat blur radius   pixels differing   mean |diff|
//   black light, drawn glow, no coat blur              -                 0%            bit-identical
//   daylight, no coat blur                             -                 0%            bit-identical
//   daylight, specular 0.6                           131 px              0%            bit-identical
//   daylight, subsurface 0.05                        141 px              0%            bit-identical
//   daylight, subsurface 0.1                         151 px              0%            bit-identical
//   daylight, subsurface 0.5                         229 px              0%            bit-identical
//   daylight, subsurface 0.6                         249 px              0%            bit-identical
//   daylight, subsurface 0.7                         269 px              0%            bit-identical
//   daylight, subsurface 0.8                         288 px              0%            bit-identical
//   daylight, subsurface 0.9                         308 px             58.4%            0.195
//   daylight, subsurface 1.0                         328 px             13.4%            0.045
//   daylight, subsurface 1.2                         367 px              7.9%            0.026
//   black light, IMAGE-SPACE bloom                196 + 524 px          51.0%            0.207
//
// So it is NOT simply "which bloom": a coat blur is a coat blur and the line is the RADIUS. THE BREAK IS
// BETWEEN 288 AND 308 PX, six points below it are bit-identical, and above it the size of the
// disagreement does not scale — 58.4%, then 13.4%, then 7.9%. The image-space bloom runs two blurs, 196
// and 524 px, and the wide one is past the break; it is also additive over the whole canvas rather than a
// high-pass added back, so its disagreement lands as tone rather than as texture.
//
// TWO THINGS NOT TO GENERALISE FROM THAT TABLE. Against ARBITRARY offsets rather than 8192, blur disagrees
// with itself at almost every radius above a few pixels and which offsets agree changes with radius; only
// the pass size matters here. And an isolated `ctx.filter = blur()` bench does NOT reproduce any of this —
// built twice, it first measured canvas-edge truncation instead of origin phase, and once that was fixed
// it reported 0% at 524 px where the real renderer reports 51%, because the bloom blurs the destination
// canvas into itself twice under `lighter` and a separate-source bench does not. Every row above is the
// real renderOneTile at the real offset. Do not re-derive it from a toy.
//
// Geometry is innocent (drawn in slab space at integer offsets, which is why specks cross a join
// unbroken), the bleed is innocent (a bleed of 1600, past the blur's full 1573 reach, made it WORSE not
// better, so this is not truncation), and the writer is innocent (see THE TILE GRID above). Drawn glow
// replaced the image-space bloom on 2026-09-27, which is why the gate prints which bloom a master used:
// for a master with no large coat blur, that line is better evidence than this gate's own verdict.
//
// THREE WAYS TO GET THIS WRONG, all of them tried first:
//
//   THE GRADIENT. A plain mean-difference either side of a join is contaminated by the picture's own
//   slope. At x = 16384 of the S23 master the ground runs downhill at 0.086 per column; across a
//   16-column baseline that moves the difference by 1.4, which is larger than the seam. That measurement
//   reported +1.17 and it was recorded as a defect of a size the master does not have.
//
//   THE DITHER. Canvas gradients are dithered by the engine on a device-space ordered matrix, so a master
//   whose fog layer stacks gradient discs carries a 2-pixel weave of a few levels (see paintFogLayer in
//   the app). The step test removes it at pairUp; the roughness test draws its controls at EVEN columns
//   only, matching the joins, so the weave contributes identically to both sides of the comparison.
//
//   THE TILE GRID. A join is also a stored-tile edge, so a defect in the writer would look like a defect
//   in the renderer. It is not: on the S23 master the tile edges that are NOT pass joins sit at 0.041
//   against the joins' 0.326 and a control's 0.032. The gate reports that column so the distinction stays
//   visible rather than being taken on trust.
import { openSync, readSync, closeSync } from 'fs';
import { inflateSync } from 'zlib';

const BASE = 64;            // columns fitted each side of a join, for the step test
const BAND = 1024;          // rows per band; bands are the sample for the roughness test

// WHAT SIZE WOULD BE JUDGEABLE?
//
// The SKIP below is honest - a 2048 master in 1024 passes has ONE join and TWO bands - and the
// self-test proves the blindness rather than leaving it to be assumed: on such a file a constant
// +1.0 and a sign-varying 0.3 are both injected at every join and the gate stays green, because it
// never gets as far as a verdict. What "too few cells" does not say is what to render instead, and
// the arithmetic is not guessable from the message: cells are JOINS x BANDS, joins come from the
// PASS size, and bands are fixed 1024-row slices of the HEIGHT. So answer it both ways round - a
// smaller pass at this size, or this pass at a larger size - and let the caller pick.
const joinsIn = (w, pass) => { let n = 0; for (let x = pass; x < w - BASE; x += pass) if (x >= BASE) n++; return n; };
const clears = (w, h, pass) => { const j = joinsIn(w, pass); return j * Math.ceil(h / BAND) >= 20 && j * Math.ceil(h / pass) >= 4; };
function judgeable(p) {
  const out = [];
  for (let pass = p.pass >> 1; pass >= 64; pass >>= 1)
    if (clears(p.w, p.h, pass)) { out.push(`force the tile to ${pass} at this size`); break; }
  for (let k = 2; k <= 64; k *= 2) {
    const w = p.w * k, h = Math.round(p.h * k);
    if (clears(w, h, p.pass)) { out.push(`${out.length ? 'or keep' : 'keep'} ${num(p.pass)} and render at ${num(w)}`); break; }
  }
  return out.length ? `to get a verdict: ${out.join(', ')}` : 'no reachable size clears the bar for this plan';
}
const Z_FAIL = 4;           // standard errors the joins must sit off the control mean, step test
const MIN_STEP = 0.5;       // ...and at least this much of 255
const RATIO_FAIL = 3;       // join roughness over control roughness
const MIN_ROUGH = 0.1;      // ...and at least this much of 255 of excess, so a flat picture cannot divide by nothing

// THE BAR, measured 2026-10-01 over three 65535 masters of the same slab:
//
//   master                                        step excess      z   rough join  control  ratio
//   S23 uv 2026-09-26  image-space bloom, bleed 787    +0.080  +0.32      0.3262   0.0361    9.0x   SEAM
//   desktop daylight 2026-09-26  no coat blur          +0.345  +1.53      2.0155   2.0133    1.0x   clean
//   desktop uv 2026-10-01  drawn glow, bleed 4         +0.038  +0.27      0.1016   0.0863    1.2x   clean
//
// WHAT EACH TEST CAN SEE, by walking an injected seam down until the gate stops firing:
//
//   step test, constant injection on the S23 master:
//     +0.4 -> z 1.94   +0.6 -> z 2.75   +0.8 -> z 3.56   +0.9 -> z 3.97   +1.0 -> z 4.37   +1.17 -> z 5.06
//     so it fires at about one level of 255 and misses anything under roughly 0.9.
//
//   roughness test, sign-varying injection on the clean desktop uv master:
//     0.15 -> 2.4x   0.20 -> 2.8x   0.25 -> 3.3x   0.30 -> 3.9x   0.50 -> 6.2x
//     so it fires at about a quarter of a level — four times more sensitive than the step test, and it is
//     the one that sees a seam whose sign varies. On that same injection the step test reports z +0.51,
//     which is the whole reason both are here.
//
// WHERE THE ROUGHNESS TEST IS BLIND, and it matters: it needs a picture that is smooth away from the
// joins. On the daylight master the control roughness is 1.539, and an injected seam of 2.0 of 255 only
// reaches 1.9x — under the bar. Black light is smooth and this works there; a busy daylight master can
// only be judged by the step test. The gate says so in its output rather than implying a clean bill.

const num = n => n.toLocaleString('en-GB');
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / Math.max(1, a.length - 1)); };
const median = a => { const s = [...a].sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

// A BigTIFF reader, enough of one to walk a master's tiles. Same shape as openTiff in tools/tiff-meta.mjs.
function openTiff(path) {
  const fd = openSync(path, 'r');
  const at = (o, l) => { const b = Buffer.alloc(l); readSync(fd, b, 0, l, o); return b; };
  const head = at(0, 16);
  if (head.readUInt16LE(0) !== 0x4949 || head.readUInt16LE(2) !== 43) {
    closeSync(fd); throw new Error('not a little-endian BigTIFF — this reads masters, not arbitrary images');
  }
  const u64 = (b, p) => b.readUInt32LE(p) + b.readUInt32LE(p + 4) * 4294967296;
  const ifd = u64(head, 8), n = u64(at(ifd, 8), 0), ent = at(ifd + 8, n * 20);
  const SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 16: 8, 17: 8, 18: 8 }, tags = {};
  for (let i = 0; i < n; i++) {
    const e = i * 20, tag = ent.readUInt16LE(e), ty = ent.readUInt16LE(e + 2), c = u64(ent, e + 4);
    const by = (SZ[ty] || 0) * c;
    const raw = by <= 8 ? ent.subarray(e + 12, e + 12 + by) : at(u64(ent, e + 12), by);
    if (ty === 2) { tags[tag] = [raw.toString('utf8').replace(/\0+$/, '')]; continue; }
    const v = [];
    for (let k = 0; k < c; k++) v.push(ty === 16 ? u64(raw, k * 8) : ty === 4 ? raw.readUInt32LE(k * 4) : ty === 3 ? raw.readUInt16LE(k * 2) : raw[k]);
    tags[tag] = v;
  }
  const g = t => tags[t] && tags[t][0];
  return {
    at, close: () => closeSync(fd),
    w: g(256), h: g(257), tw: g(322), th: g(323), spp: g(277) || 4,
    comp: g(259), pred: g(317) || 1, desc: g(270),
    offs: tags[324], cnts: tags[325],
  };
}

// The pass plan comes from the master's own record of itself, never from an assumption about 8192: a
// forced tile writes a different one, and a gate that assumed the common case would read the wrong grid
// and report clean.
function planOf(f) {
  let m = {};
  try { m = JSON.parse(f.desc || '{}'); } catch (_) { /* a master with no block is handled by the caller */ }
  if (!m.render) return null;
  return { pass: m.render, store: m.tile || f.tw, w: m.w || f.w, h: m.h || f.h,
           spectrum: m.spectrum, bleed: m.bleed, bloomDraw: !!m.bloomDraw,
           sigma: Object.prototype.hasOwnProperty.call(m, 'sigma') ? m.sigma : null };
}

// WHAT THE MASTER'S OWN RECORD SAYS ABOUT ITS RISK, before a pixel is read. tiffPlan computes
// `sigma = coatRadius(W / COAT_REF)` and expMeta stamps it, so `sigma` IS the coat blur radius in output
// pixels — the same quantity the table above is indexed by. With `bloomDraw` that pins the configuration
// exactly, and it works where the pixel tests are weakest: a busy daylight master whose control roughness
// swamps the statistics still states its own radius.
//
// This REPORTS, it does not decide. A master can carry a seam from something this table has never seen,
// and the radius only covers the coat. The pixel tests run either way — they cost fifteen seconds.
//
// NOTE sigma 0 DOES NOT MEAN NOTHING BLURRED. coatRadius returns the subsurface/specular branch when the
// drawn glow is on, so a black-light master with a 16*bs = 1,048 px drawn halo records sigma 0. That halo
// is `shadowBlur`, a different code path, and it was measured origin-invariant at the pass offset (the
// first row of the table). Reading sigma 0 as "no blur ran" would be wrong; it means "no COAT blur ran".
const BREAK_LO = 288, BREAK_HI = 308;             // invariant at and below LO, broken at and above HI
function riskOf(p) {
  if (!p.bloomDraw && p.spectrum !== 0 && p.spectrum != null)
    return { at: true, why: `image-space emission bloom under black light — blurs at 196 and 524 px, the configuration measured to disagree across a pass join by 51% of pixels` };
  if (p.sigma == null)
    return { at: null, why: `no coat radius recorded (master predates the stamp), so the configuration cannot be read` };
  if (p.sigma >= BREAK_HI)
    return { at: true, why: `coat blur ${p.sigma} px is past the measured break at ${BREAK_LO}-${BREAK_HI} px` };
  if (p.sigma > BREAK_LO)
    return { at: null, why: `coat blur ${p.sigma} px sits inside the untested gap between ${BREAK_LO} and ${BREAK_HI} px` };
  return { at: false, why: `coat blur ${p.sigma} px, inside the region measured bit-identical across a pass join (six points from 131 to ${BREAK_LO} px)` };
}

const lineFit = (y, x0) => {                             // least squares, returning the value at x0
  const n = y.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += y[i]; sxx += i * i; sxy += i * y[i]; }
  const d = n * sxx - sx * sx;
  const a = (n * sxy - sx * sy) / d, b = (sy - a * sx) / n;
  return a * x0 + b;
};

// Average adjacent columns in pairs, so the 2-pixel dither weave is gone before anything is fitted.
// AN EVEN WINDOW IS NOT ENOUGH, which is what the first version of this assumed. The alternating
// component does sum to zero over an even window, so it moves no mean — but it is not orthogonal to the
// SLOPE: sum of (-1)^i * i over an even window is -n/2, so least squares gives it a tilt, and the two
// windows are extrapolated from opposite ends. Measured on a synthetic ramp carrying a pure weave and no
// seam at all, that tilt alone reported a discontinuity of 0.375 at amplitude 4 and 1.875 at amplitude 20
// — larger than the defect being hunted, manufactured out of a picture with no defect in it.
const pairUp = a => { const q = []; for (let k = 0; k + 1 < a.length; k += 2) q.push((a[k] + a[k + 1]) / 2); return q; };

// The discontinuity at the join between column x-1 and column x, with the local gradient removed. Pair k
// of the right window sits at column x + 2k + 0.5, so the join at x - 0.5 is pair index -0.5; the left
// window's m pairs end at column x - 1.5, putting the join at m - 0.5.
//
// Verified against synthetic input whose answer was chosen rather than derived from this code: a ramp of
// any slope, plus a weave of any amplitude, plus a step of S, returns exactly S to nine decimal places.
function discont(prof, x) {
  const L = prof.slice(x - BASE, x), R = prof.slice(x, x + BASE);
  if (L.length < BASE || R.length < BASE) return null;
  const lp = pairUp(L), rp = pairUp(R);
  return lineFit(rp, -0.5) - lineFit(lp, lp.length - 0.5);
}

// Walk the stored tiles that touch a vertical join and accumulate, per band of rows, the column means in
// a window either side of it — and, out of the same inflate, the mean jump at the stored-tile edges that
// are NOT pass joins, which is what separates the renderer from the writer.
function profiles(f, p, inject) {
  const across = Math.ceil(p.w / p.store), down = Math.ceil(p.h / p.store);
  const vJoins = [];
  for (let x = p.pass; x < p.w - BASE; x += p.pass) if (x >= BASE) vJoins.push(x);

  // WINDOW, not the whole width. A join needs BASE columns each side for the step test and a spread of
  // control columns for the roughness test; everything else in the picture is content this does not need.
  const HALF = Math.max(4 * BASE, p.store >> 2);
  const wins = vJoins.map(x => ({ x, lo: Math.max(0, x - HALF), hi: Math.min(p.w, x + HALF) }));
  const cols = new Set();
  for (const win of wins) for (let t = Math.floor(win.lo / p.store); t <= Math.floor((win.hi - 1) / p.store); t++) cols.add(t);

  const nBands = Math.ceil(p.h / BAND);
  // The divisor is geometry, never a count kept as tiles arrive: a window can straddle two stored tile
  // columns, and counting there once put the same row in twice and halved every mean.
  const acc = wins.map(win => Array.from({ length: nBands }, (_, b) => ({
    sum: new Float64Array(win.hi - win.lo), n: Math.max(0, Math.min((b + 1) * BAND, p.h) - b * BAND),
  })));
  // The stored-tile edges inside the decoded columns that are not pass joins, as their own sample.
  const tileEdges = [];
  for (let t = 1; t < across; t++) {
    const x = t * p.store;
    if (x % p.pass === 0) continue;
    if ([...cols].some(c => c === t || c === t - 1)) tileEdges.push(x);
  }
  const tileAcc = tileEdges.map(() => Array.from({ length: nBands }, () => ({ a: 0, b: 0, n: 0 })));
  let inflated = 0;

  for (let ty = 0; ty < down; ty++) {
    for (const tx of cols) {
      const T = ty * across + tx;
      if (T >= f.offs.length) continue;
      const px = inflateSync(f.at(f.offs[T], f.cnts[T]));
      inflated++;
      if (px.length !== p.store * p.store * f.spp) continue;      // a short tile is tiff-meta --audit's business
      const x0 = tx * p.store, y0 = ty * p.store;
      for (let j = 0; j < p.store; j++) {
        const gy = y0 + j; if (gy >= p.h) break;
        const bd = Math.min(nBands - 1, Math.floor(gy / BAND));
        const row = j * p.store * f.spp;
        const val = gx => {
          const o = row + (gx - x0) * f.spp;
          const v = (px[o] + px[o + 1] + px[o + 2]) / 3;
          return inject ? v + inject.at(Math.floor(gx / p.pass)) : v;
        };
        for (let wi = 0; wi < wins.length; wi++) {
          const win = wins[wi];
          const a0 = Math.max(win.lo, x0), a1 = Math.min(win.hi, x0 + p.store);
          if (a1 <= a0) continue;
          const sum = acc[wi][bd].sum;
          for (let gx = a0; gx < a1; gx++) sum[gx - win.lo] += val(gx);
        }
        for (let ti = 0; ti < tileEdges.length; ti++) {
          const x = tileEdges[ti];
          if (x >= x0 && x < x0 + p.store) tileAcc[ti][bd].a += val(x);
          if (x - 1 >= x0 && x - 1 < x0 + p.store) tileAcc[ti][bd].b += val(x - 1);
        }
      }
    }
  }
  for (let ti = 0; ti < tileEdges.length; ti++)
    for (let b = 0; b < nBands; b++) tileAcc[ti][b].n = Math.max(0, Math.min((b + 1) * BAND, p.h) - b * BAND);
  return { wins, acc, nBands, inflated, decodedCols: cols.size, across, tileEdges, tileAcc };
}

function audit(path, inject, quiet) {
  const f = openTiff(path);
  try {
    const p = planOf(f);
    if (!p) { console.log(`${path}\n  SKIP     no stone-author block, so no pass plan to check against`); return true; }
    if (f.comp !== 8 && f.comp !== 32946) { console.log(`${path}\n  SKIP     compression ${f.comp} is not deflate`); return true; }
    if (f.pred !== 1) { console.log(`${path}\n  SKIP     predictor ${f.pred} is not handled`); return true; }

    const { wins, acc, nBands, inflated, decodedCols, across, tileEdges, tileAcc } = profiles(f, p, inject);
    const nPassRows = Math.ceil(p.h / p.pass);

    // --- the STEP test: signed, per (join x pass row), gradient removed -----------------------------
    const stepJ = [], stepC = [];
    for (let wi = 0; wi < wins.length; wi++) {
      const win = wins[wi], atX = win.x - win.lo, W = win.hi - win.lo;
      for (let pr = 0; pr < nPassRows; pr++) {
        const sum = new Float64Array(W); let n = 0;
        for (let b = 0; b < nBands; b++) {
          const y = b * BAND; if (y < pr * p.pass || y >= (pr + 1) * p.pass) continue;
          for (let i = 0; i < W; i++) sum[i] += acc[wi][b].sum[i];
          n += acc[wi][b].n;
        }
        if (!n) continue;
        const prof = Array.from(sum, v => v / n);
        const d = discont(prof, atX);
        if (d !== null && isFinite(d)) stepJ.push({ x: win.x, pr, d });
        for (let off = BASE * 2; off + BASE <= atX; off += BASE)
          for (const c of [atX - off, atX + off]) {
            const v = discont(prof, c); if (v !== null && isFinite(v)) stepC.push(v);
          }
      }
    }

    // --- the ROUGHNESS test: unsigned single-column jump, per (join x band) -------------------------
    // Controls at EVEN columns only. Pass joins are even here, and the dither weave's jump depends on
    // column parity, so an odd control would be compared against a different thing.
    const roughJ = [], roughC = [];
    for (let wi = 0; wi < wins.length; wi++) {
      const win = wins[wi], atX = win.x - win.lo, W = win.hi - win.lo;
      // THE CONTROLS NEED ROOM AND THERE IS NOT ALWAYS ANY. HALF is max(4 * BASE, store / 4), so a
      // master stored in 512-px tiles has a window of exactly 256 either side, and a walk that starts
      // at 256 needing off + 1 < 256 takes NO step at all. roughC then came back empty, its median
      // NaN, the ratio Infinity, and the gate printed "no seam" and a floor of "about NaN" while the
      // only test that can catch a sign-varying seam was not running. Its own self-test said so and
      // was not read: on an 8,192 master stored in 512s an injected sign-varying 0.3 passed clean,
      // while the join measurement moved 0.0449 -> 0.3000, so only the controls were missing.
      //
      // A single-column jump is contaminated only AT the join, so a nearer control is sound. The
      // outward walk is left exactly as it was wherever it yields anything - every master this gate
      // has already judged is judged identically - and the nearer offsets are reached only when it
      // yields nothing at all.
      const lim = Math.min(atX, W - atX), offs = [];
      for (let off = 256; off + 1 < lim; off += 64) offs.push(off);
      if (!offs.length) for (let off = 64; off + 1 < lim; off += 64) offs.push(off);
      for (let b = 0; b < nBands; b++) {
        const a = acc[wi][b]; if (!a.n) continue;
        const jump = i => Math.abs(a.sum[i] - a.sum[i - 1]) / a.n;
        roughJ.push(jump(atX));
        for (const off of offs) {
          const l = atX - off, r = atX + off;
          if ((win.lo + l) % 2 === 0 && l >= 1) roughC.push(jump(l));
          if ((win.lo + r) % 2 === 0 && r < W) roughC.push(jump(r));
        }
      }
    }
    // the same jump at stored-tile edges that carry no pass join: the writer's own control
    const roughT = [];
    for (let ti = 0; ti < tileEdges.length; ti++)
      for (let b = 0; b < nBands; b++) {
        const t = tileAcc[ti][b]; if (t.n) roughT.push(Math.abs(t.a - t.b) / t.n);
      }

    if (stepJ.length < 4 || roughJ.length < 20) {
      console.log(`${path}\n  SKIP     too few cells to judge (${stepJ.length} step cells, ${roughJ.length} bands; needs 4 and 20)`);
      console.log(`           ${judgeable(p)}`);
      return true;
    }

    const jd = stepJ.map(j => j.d);
    const excess = mean(jd) - mean(stepC);
    const z = excess / (sd(jd) / Math.sqrt(jd.length));
    // AN EMPTY CONTROL SET IS NOT A PASS. Before this, the median of nothing was NaN, every
    // comparison against NaN was false, and the gate fell through to "no seam" - the one outcome it
    // had no evidence for. A test that could not run says so and the file is not cleared.
    if (!roughC.length) {
      console.log(`${path}
  INCONCLUSIVE  the roughness test had no control columns (window ${HALF} either side), so a`);
      console.log(`                sign-varying seam could not be looked for. The step test is not a substitute.`);
      return false;
    }
    const rj = median(roughJ), rc = median(roughC), rt = roughT.length ? median(roughT) : null;
    const ratio = rc > 0 ? rj / rc : Infinity;

    const light = p.spectrum === 0 ? 'daylight' : `spectrum ${p.spectrum}`;
    // The emission bloom is black-light only, so naming the build's bloom path on a daylight master would
    // describe a branch that never ran.
    const bloom = p.spectrum === 0 ? 'no emission bloom (daylight)' : p.bloomDraw ? 'drawn glow' : 'image-space bloom';
    if (!quiet) {
      console.log(path);
      console.log(`  plan     ${num(p.w)} x ${num(p.h)}, ${num(p.pass)} passes stored ${num(p.store)}, bleed ${p.bleed ?? '?'}, ${light}, ${bloom}`);
      const risk = riskOf(p);
      console.log(`  config   ${risk.at === true ? 'AT RISK' : risk.at === false ? 'expected invariant' : 'unknown'} — ${risk.why}`);
      console.log(`  read     ${inflated} tiles (${decodedCols} of ${across} columns), ${stepJ.length} step cells, ${roughJ.length} bands`);
    }
    console.log(`  step       ${excess >= 0 ? '+' : ''}${excess.toFixed(3)} against control, z ${z >= 0 ? '+' : ''}${z.toFixed(2)}  (a systematic lift; blind to a seam whose sign varies)`);
    console.log(`  roughness  joins ${rj.toFixed(4)}  controls ${rc.toFixed(4)}  ratio ${ratio.toFixed(1)}x` +
                (rt !== null ? `   tile edges (no pass join) ${rt.toFixed(4)}` : ''));
    if (rc > 0.5) console.log(`  note     control roughness ${rc.toFixed(3)} is high — this picture is busy, so the roughness test has little power here and the step test is what judged it`);

    const stepBad = Math.abs(z) > Z_FAIL && Math.abs(excess) > MIN_STEP;
    const roughBad = ratio > RATIO_FAIL && (rj - rc) > MIN_ROUGH;
    if (stepBad || roughBad) {
      if (stepBad) {
        const worst = [...stepJ].sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 4);
        console.error(`  SEAM     every pass is lifted from its neighbour by ${excess.toFixed(3)} of 255, consistent across ${jd.length} cells at ${Math.abs(z).toFixed(1)} standard errors.`);
        console.error(`           worst cells: ${worst.map(j => `x=${num(j.x)} row ${j.pr} ${j.d >= 0 ? '+' : ''}${j.d.toFixed(2)}`).join(', ')}`);
      }
      if (roughBad) {
        console.error(`  SEAM     the pass joins jump ${ratio.toFixed(1)}x harder than any other column in this picture (${rj.toFixed(3)} against ${rc.toFixed(3)} of 255).`);
        console.error(`           ${rt === null
          ? 'Every stored-tile edge here IS a pass join, so there is no edge that separates the writer from the renderer - neither is ruled out.'
          : rt < rj / 2
            ? `Stored-tile edges carrying no pass join sit at ${rt.toFixed(3)}, so this is the renderer and not the writer.`
            : 'Stored-tile edges are not clean either — suspect the writer as well as the renderer.'}`);
      }
      return false;
    }
    // NO DETECTION IS NOT A CLEAN BILL OF HEALTH, and saying "clean" without saying so cost two wrong
    // corrections on 2026-10-01 — both of them read a null result as an absence. There are only 7 join
    // columns at this width, so the roughness test has power for a strong case and little for a weak one.
    // State the floors every time, so the verdict cannot be quoted without them.
    const roughFloor = rc * RATIO_FAIL + MIN_ROUGH;
    console.log(`  no seam  neither test fires. NOT a clean bill: this run could have seen a systematic`);
    console.log(`           lift of about ${(MIN_STEP * 2).toFixed(1)} of 255 and a sign-varying seam of about ${(roughFloor - rc).toFixed(2)} in this picture.`);
    console.log(`           Anything smaller is below what ${jd.length} cells and ${roughJ.length} bands can resolve, not absent.`);
    return true;
  } finally { f.close(); }
}

// ---- the bite test ---------------------------------------------------------------------------------
// A gate that has never been seen to fail is a preference. This adds a seam to a real master as its
// pixels are read — nothing is written and no master is touched — in BOTH shapes, because an injection
// of one shape certifies power the gate does not have for the other. A constant step is what the first
// version of this injected, and it kept certifying a gate that passed the one master known to be bad.
const args = process.argv.slice(2);
const SELF = args.includes('--self-test');
const VARY = args.includes('--vary');
// `i >= 0`, not `i > 0`: indexOf returns 0 when --inject is the first argument, which is how it is
// normally typed, and the gate then silently ignored it and reported the unmodified master as clean.
const INJ = (() => { const i = args.indexOf('--inject'); return i >= 0 && args[i + 1] ? +args[i + 1] : null; })();
const paths = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--inject'));
if (!paths.length) {
  console.error('usage: node tools/check-seam.mjs [--self-test] [--inject <of 255> [--vary]] <master.tif> [...]');
  process.exit(2);
}

// constant: every pass sits one step above the last, so each join steps the same way.
// varying:  alternate passes sit a step high, so each join steps +A, -A, +A... and the signed mean is nil.
const constant = A => k => A * k;
const varying = A => k => (k % 2) * A;

let bad = 0;
for (const path of paths) {
  try {
    if (SELF) {
      console.log(`--- self-test on ${path} ---`);
      const clean = audit(path, null);
      if (!clean) {
        console.error('SELF-TEST INCONCLUSIVE: the unmodified master already fails, so a red on an injected one proves nothing.');
        console.error('Point --self-test at a master this gate calls clean, and audit this one on its own.');
        bad++;
      } else {
        let ok = true;
        console.log('  -- injecting a CONSTANT +1.0 step at every join (the step test must catch this)');
        if (audit(path, { at: constant(1.0) }, true)) { console.error('SELF-TEST FAILED: a constant +1.0 seam was injected and the gate stayed green.'); ok = false; }
        console.log('  -- injecting a SIGN-VARYING 0.3 step at every join (only the roughness test can catch this)');
        if (audit(path, { at: varying(0.3) }, true)) { console.error('SELF-TEST FAILED: a sign-varying 0.3 seam was injected and the gate stayed green.'); ok = false; }
        if (ok) console.log('self-test: clean passed, both injected shapes failed. The gate bites.');
        else bad++;
      }
    } else if (INJ !== null) {
      console.log(`--- ${path}: injecting a ${VARY ? 'sign-varying' : 'constant'} ${INJ} at every join ---`);
      if (!audit(path, { at: (VARY ? varying : constant)(INJ) })) bad++;
    } else if (!audit(path, null)) bad++;
  } catch (e) {
    console.error(`${path}: ${e.message}`);
    bad++;
  }
}
process.exit(bad ? 1 : 0);

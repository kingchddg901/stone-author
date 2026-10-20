// WHERE IS THE REALITY WINDOW? Reversed out of the render's own per-tile timings, because the master
// does not say.
//
// A master records `windows: 1` and `marks` as a COUNT. The disc's centre and radius are three numbers
// and none of them is written down, so the question "did the pool shed on the window?" - which decides
// whether a shed was the picture or the machine - cannot be answered from the record. It can be
// answered from the timings instead, and this does that.
//
// THE SIGNAL IS A STEP, NOT A GRADIENT. An island with Show through renders the slab AGAIN at its own
// light and feathers it in through the disc, and renderOneTile's skip test spares every tile no disc
// reaches. So a tile inside the disc does roughly twice the paint of one outside, and the change at
// the boundary is abrupt. The slab's own content - veins, cracks, a light gradient - varies smoothly
// and runs in filaments, so it does not make circular step edges. That difference is what is fitted.
//
// THE FIT. For each candidate centre, tiles are binned by distance and a radial mean profile is built;
// the score is the sharpest normalised drop in that profile over a plausible radius range. Coarse pass
// on a stride, then a refine pass around the winner.
//
// IT HAS TO BE ABLE TO FAIL, so `--control <sidecar>` runs the identical fit on a master with no
// window. The same slab at the same size with the island deleted is the honest control: if this
// reports a confident disc there too, it is fitting noise and its answer here means nothing. The
// contrast of the two is the whole claim.
//
//   node tools/find-window.mjs <sidecar.json> [--control <sidecar.json>] [--field ms|bytes]
import { readFileSync } from 'fs';

const NL = String.fromCharCode(10);
const args = process.argv.slice(2);
const FIELD = (() => { const i = args.indexOf('--field'); return i >= 0 ? args[i + 1] : 'ms'; })();
const CONTROL = (() => { const i = args.indexOf('--control'); return i >= 0 ? args[i + 1] : null; })();
const TARGET = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--control' && args[i - 1] !== '--field')[0];
if (!TARGET) { console.error('usage: node tools/find-window.mjs <sidecar.json> [--control <sidecar.json>] [--field ms|bytes]'); process.exit(1); }

function grid(path) {
  const o = JSON.parse(readFileSync(path, 'utf8'));
  const A = o.w / o.tile, D = Math.ceil(o.h / o.tile);
  const v = o.perTile && o.perTile[FIELD];
  if (!v) throw new Error(path + ': no perTile.' + FIELD);
  if (v.length !== A * D) throw new Error(path + ': perTile.' + FIELD + ' is ' + v.length + ', expected ' + (A * D));
  return { o, A, D, v };
}

// A 3x3 median, because one slow tile is not a boundary. The same reasoning the pool itself uses on
// `recent`: an outlier must not be able to carry a decision.
function smooth(v, A, D) {
  const out = new Float64Array(A * D);
  for (let y = 0; y < D; y++) for (let x = 0; x < A; x++) {
    const n = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < D && xx >= 0 && xx < A) n.push(v[yy * A + xx]);
    }
    n.sort((a, b) => a - b);
    out[y * A + x] = n[n.length >> 1];
  }
  return out;
}

// THE SHARPEST EDGE, scored as a SEPARATION rather than a ratio.
//
// The first version scored inside/outside as a ratio and it was degenerate: on both a windowed master
// and its no-window control it returned col 31 of 32 - the far right edge - at the minimum radius,
// because a ratio blows up wherever the outside annulus is small and thin, and at the edge of the grid
// it always is. The control was supposed to catch exactly that and did not, because comparing two
// degenerate fits still gave a 2x "separation". A contrast test has to be told what a bad fit looks
// like, not just what a good one scores.
//
// So: the annulus must contain enough tiles to be a comparison at all, the disc must contain enough to
// be a disc, and the score is the gap between the two means in units of the OUTSIDE spread - which
// cannot be inflated by an outside sample that is merely small.
function scoreAt(f, A, D, cx, cy, rMin, rMax) {
  const sum = new Float64Array(rMax + 2), cnt = new Float64Array(rMax + 2);
  for (let y = 0; y < D; y++) {
    const dy = y - cy, dy2 = dy * dy;
    for (let x = 0; x < A; x++) {
      const dx = x - cx, r = Math.sqrt(dx * dx + dy2) | 0;
      if (r > rMax) continue;
      sum[r] += f[y * A + x]; cnt[r]++;
    }
  }
  let best = { z: -Infinity, r: 0, inside: 0, outside: 0, nIn: 0, nOut: 0 };
  for (let r = rMin; r <= rMax - 6; r++) {
    let si = 0, ni = 0, so = 0, no = 0;
    for (let k = 0; k <= r; k++) { si += sum[k]; ni += cnt[k]; }
    const kHi = Math.min(rMax, r + Math.max(4, r >> 1));
    for (let k = r + 2; k <= kHi; k++) { so += sum[k]; no += cnt[k]; }
    // ENOUGH OF BOTH TO BE A COMPARISON. A disc of nine tiles and an annulus of twelve is not a
    // boundary, it is two small samples, and that is what the degenerate fit was made of.
    if (ni < 24 || no < 48) continue;
    const inside = si / ni, outside = so / no;
    // spread of the OUTSIDE, from the same bins, so the score cannot be inflated by a thin annulus
    let v = 0, nv = 0;
    for (let y = 0; y < D; y++) { const dy = y - cy, dy2 = dy * dy;
      for (let x = 0; x < A; x++) { const dx = x - cx, rr = Math.sqrt(dx * dx + dy2) | 0;
        if (rr <= r + 1 || rr > kHi) continue; const d = f[y * A + x] - outside; v += d * d; nv++; } }
    const sd = nv > 1 ? Math.sqrt(v / (nv - 1)) : 0;
    if (!(sd > 0)) continue;
    const z = (inside - outside) / sd;
    if (z > best.z) best = { z, r, inside, outside, nIn: ni, nOut: no };
  }
  return best;
}

function fit(path, label) {
  const { o, A, D, v } = grid(path);
  const f = smooth(v, A, D);
  const rMin = Math.max(3, Math.round(A * 0.04)), rMax = Math.round(A * 0.45);
  let best = null;
  const step = Math.max(1, Math.round(A / 64));
  for (let cy = 0; cy < D; cy += step) for (let cx = 0; cx < A; cx += step) {
    const s = scoreAt(f, A, D, cx, cy, rMin, rMax);
    if (!best || s.z > best.z) best = { ...s, cx, cy };
  }
  for (let cy = Math.max(0, best.cy - step); cy <= Math.min(D - 1, best.cy + step); cy++)
    for (let cx = Math.max(0, best.cx - step); cx <= Math.min(A - 1, best.cx + step); cx++) {
      const s = scoreAt(f, A, D, cx, cy, rMin, rMax);
      if (s.z > best.z) best = { ...s, cx, cy };
    }
  console.log(label + '   ' + o.w + '   windows: ' + o.windows + '   grid ' + A + ' x ' + D + ' tiles   field perTile.' + FIELD);
  console.log('   best circle   centre col ' + best.cx + ', row ' + best.cy + '   radius ' + best.r + ' tiles');
  console.log('   contrast      inside ' + best.inside.toFixed(0) + ' (' + best.nIn + ' tiles)  vs  annulus '
    + best.outside.toFixed(0) + ' (' + best.nOut + ' tiles)   separation ' + best.z.toFixed(2) + ' sd');
  console.log('   normalised    centre (' + (best.cx / A).toFixed(3) + ', ' + (best.cy / A).toFixed(3)
    + ') of WIDTH   radius ' + (best.r / A).toFixed(3) + ' of width');
  return { o, A, D, best };
}

console.log('');
const T = fit(TARGET, 'TARGET  ');
let C = null;
if (CONTROL) { console.log(''); C = fit(CONTROL, 'CONTROL '); }

if (C) {
  console.log('');
  const ratio = T.best.z / C.best.z;
  console.log('THE CONTROL IS THE CLAIM. A fit that is confident on a master with no window is fitting');
  console.log('the slab, not the island, and its answer on the target would mean nothing.');
  console.log('   target separation  ' + T.best.z.toFixed(2) + ' sd      control separation ' + C.best.z.toFixed(2) + ' sd'
    + '      ' + ratio.toFixed(2) + 'x');
  const far = Math.min(T.best.cx, T.A - 1 - T.best.cx, T.best.cy, T.D - 1 - T.best.cy);
  console.log('   target centre sits ' + far + ' tiles from the nearest edge (a fit that runs to the rim is the failure mode)');
  if (T.o.windows && !C.o.windows && ratio < 1.8 || far <= 1)
    console.log('   -> TOO CLOSE. This does not separate a windowed master from one without. Do not use the position.');
  else if (T.o.windows && !C.o.windows)
    console.log('   -> separated. The target position is usable as a stand-in until the disc is recorded.');
}
console.log('');

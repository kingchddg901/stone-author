// WHAT A SET OF MASTERS COST. One row per file, from the files themselves.
//
// Every master carries a self-description - width, height, tiling, build, per-tile timings, the light
// it was rendered under - and the byte count is on disk. So the cost of a render is never lost as long
// as the file exists, and a table of them never has to be kept in step by hand. This prints it.
//
// It exists because the numbers in docs/self-hosting.md were derived once, by hand, in a conversation,
// and the next person to want them would have had to derive them again from scratch or trust prose.
// Deriving them is one command; the prose is the thing that goes stale.
//
//   node tools/master-stats.mjs <master.tif> [...]            the table
//   node tools/master-stats.mjs <dir>                         every .tif in a directory
//   node tools/master-stats.mjs <...> --sort=w                order by width (default: as given)
//   node tools/master-stats.mjs <...> --csv                   machine-readable
//
// TIME IS THE FIELD THAT LIES, so it is the one this is careful about. `ms.render` covers the sitting
// that FINISHED the master. A render carried across an interruption records only the last sitting
// there - measured, a 262,144 that took 21.9 minutes over two sittings reports 10.1 - so a resumed
// master's own clock understates it by however much ran before the resume. The per-tile record does
// carry both, because a resumed tile's time is written into the row when it is adopted. So this prints
// the SUM OF THE PER-TILE RECORD as the render time, prints ms.render beside it, and flags the row.
// Where they agree the render was one sitting; where they do not, the sum is the honest one.
import { statSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { locateMeta } from './lib/find-meta.mjs';

const args = process.argv.slice(2);
const flag = k => args.some(a => a === '--' + k);
const str = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
let files = args.filter(a => !a.startsWith('--'));
if (!files.length) {
  console.error('usage: node tools/master-stats.mjs <master.tif|dir> [...] [--sort=w|time|bytes] [--csv]');
  process.exit(1);
}
// A directory expands to the masters in it, because "what did this folder cost" is the usual question.
files = files.flatMap(f => {
  if (!existsSync(f)) { console.error(f + ': not found'); process.exit(1); }
  if (!statSync(f).isDirectory()) return [f];
  return readdirSync(f).filter(n => /\.tiff?$/i.test(n)).map(n => join(f, n));
});

const rows = [];
for (const p of files) {
  const loc = locateMeta(p);
  const name = basename(p);
  if (!loc) { console.error(name + ': no metadata block - skipped'); continue; }
  const j = loc.meta, bytes = statSync(p).size;
  const per = (j.perTile && j.perTile.ms) || [];
  const sum = per.reduce((a, b) => a + b, 0);
  const px = (j.w || 0) * (j.h || 0);
  rows.push({
    name, w: j.w, h: j.h, px, bytes, build: j.build || '?',
    // WHAT WAS RENDERED, not just how big. Cost is a property of the slab before it is a property of
    // the width, so a table without these invites exactly the mistake of reading one slab's measured
    // time as what that width costs.
    inputs: j.inputs || '?', material: j.material || '?', slab: j.slab || '?',
    spectrum: j.spectrum === 0 ? 'day' : j.spectrum === -1 ? 'uv' : 'spx' + j.spectrum,
    tiles: j.renders, tile: j.render,
    msRender: j.ms ? j.ms.render : 0, msSum: sum, perN: per.length,
    per, perBy: (j.perTile && j.perTile.bytes) || null,   // kept for --cost; absent on older masters
    resumed: j.resumedTiles || 0,
    bpp: px ? bytes / px : 0,
    mean: j.light ? j.light.mean : null, lit40: j.light ? j.light.lit40 : null,
  });
}
if (!rows.length) { console.error('nothing readable'); process.exit(1); }

const sort = str('sort', null);
if (sort === 'w') rows.sort((a, b) => a.w - b.w);
else if (sort === 'time') rows.sort((a, b) => a.msSum - b.msSum);
else if (sort === 'bytes') rows.sort((a, b) => a.bytes - b.bytes);

// Decimal GB, matching how the masters' own sizes are quoted everywhere else in this repo.
const gb = n => (n / 1e9).toFixed(2);
const mins = ms => ms / 60000;
const dur = ms => { const m = mins(ms); return m >= 90 ? (m / 60).toFixed(2) + ' h' : m.toFixed(1) + ' min'; };

if (flag('csv')) {
  console.log('file,width,height,pixels,bytes,bytes_per_pixel,tiles,tile_size,render_ms_sum,render_ms_field,resumed_tiles,build,light,mean,lit40,material,slab,inputs');
  for (const r of rows) console.log([JSON.stringify(r.name), r.w, r.h, r.px, r.bytes, r.bpp.toFixed(6),
    r.tiles, r.tile, r.msSum, r.msRender, r.resumed, r.build, r.spectrum, r.mean, r.lit40,
    JSON.stringify(r.material), JSON.stringify(r.slab), r.inputs].join(','));
  process.exit(0);
}

console.log('   width      pixels     tiles@size        render   (own clock)      file     B/px   light  material  slab');
let anyResumed = false;
for (const r of rows) {
  if (r.resumed) anyResumed = true;
  console.log(
    String(r.w).padStart(9)
    + String((r.px / 1e9).toFixed(1) + ' Gpx').padStart(12)
    + String(r.tiles + '@' + r.tile).padStart(15)
    + String(dur(r.msSum)).padStart(14)
    // The bracket is a DISAGREEMENT signal, so it appears only when the two clocks actually disagree.
    // The per-tile sum and ms.render never match to the millisecond even on a single sitting - the
    // sum is tile work, the field is wall - so printing it always made a row look resumed when it
    // was not. 2% is comfortably above that gap and far below a missing sitting.
    + String(Math.abs(r.msSum - r.msRender) > 0.02 * Math.max(1, r.msSum) ? '(' + dur(r.msRender) + ')' : '').padStart(13)
    + String(gb(r.bytes) + ' GB').padStart(11)
    + String(r.bpp.toFixed(4)).padStart(9)
    + String(r.spectrum).padStart(6)
    + String(r.material).padStart(10)
    + '  ' + (r.slab.length > 28 ? r.slab.slice(0, 27) + '…' : r.slab)
    + (r.resumed ? '  RESUMED ' + r.resumed + ' of ' + r.tiles : ''));
}
if (anyResumed)
  console.log('\nRESUMED rows: render time is the sum of the per-tile record, which spans every sitting.\n'
    + 'The bracketed figure is the master\'s own ms.render, which covers only the sitting that finished it.');

// BYTES PER PIXEL FALLS AS A PICTURE GETS WIDER - within ONE picture. Each tile covers less of the
// slab and compresses better, and that trend is what makes an extrapolation to an untried width an
// upper bound rather than a guess.
//
// It is only a trend within one picture, and the first version of this printed it across whatever was
// given. On a folder holding several slabs that series read 2.6638 at 1024 and 0.0831 at 65,535 and
// looked like a law, when it was a sorted list of unrelated pictures: a 65,535 in this very set ranges
// from 0.0365 to 0.4384 bytes per pixel depending on the slab alone. The series is now grouped by the
// `inputs` hash, which is the signature of the state that produced the picture, so a line is only ever
// drawn through points that belong on one.
const byInputs = new Map();
for (const r of rows) { const k = r.inputs || '?'; byInputs.set(k, (byInputs.get(k) || []).concat(r)); }
let drew = false;
for (const [, set] of byInputs) {
  const byW = set.slice().sort((a, b) => a.w - b.w).filter((r, i, a) => !i || r.w !== a[i - 1].w);
  if (byW.length < 2) continue;
  drew = true;
  // The inputs hash is in the label because a slab NAME is not an identity: the same name edited
  // between renders is a different picture, and two groups printed under one name read as a
  // contradiction when they are simply two pictures.
  console.log('\nbytes per pixel by width, ' + byW[0].material + ' "' + byW[0].slab + '" [' + byW[0].inputs + ']:');
  console.log('  ' + byW.map(r => r.w + ' ' + r.bpp.toFixed(4)).join('   '));
  const f = byW[0], l = byW[byW.length - 1];
  console.log('  ' + (l.bpp < f.bpp ? 'falling' : 'rising') + ' ' + (Math.max(f.bpp, l.bpp) / Math.min(f.bpp, l.bpp)).toFixed(2)
    + 'x from ' + f.w + ' to ' + l.w);
}
if (!drew && rows.length > 1)
  console.log('\nNo bytes-per-pixel trend drawn: no single picture in this set spans two widths.\n'
    + 'That figure is a property of the picture, not the width - see the spread below.');

// THE SPREAD AT ONE WIDTH, which is the number anyone sizing up a render actually needs. Cost is a
// property of the SLAB far more than of the width: measured here, one 65,535 took 1.6 minutes and
// another took 33.5. Printing the range stops a single measured number being read as what a width
// costs. Time and size move in OPPOSITE directions - the 1.6 minute render is the largest file and
// the 15.5 minute one among the smallest - so neither can be inferred from the other.
const byWidth = new Map();
for (const r of rows) byWidth.set(r.w, (byWidth.get(r.w) || []).concat(r));
const spreads = [...byWidth.entries()].filter(([, v]) => new Set(v.map(r => r.inputs)).size > 1).sort((a, b) => a[0] - b[0]);
if (spreads.length) {
  console.log('\nSPREAD AT ONE WIDTH (different pictures, same pixel count):');
  console.log('   width   pictures        render range            file range        B/px range');
  for (const [w, v] of spreads) {
    const t = v.map(r => r.msSum).sort((a, b) => a - b), b = v.map(r => r.bytes).sort((a, b) => a - b);
    const pp = v.map(r => r.bpp).sort((a, b) => a - b);
    console.log(String(w).padStart(8) + String(new Set(v.map(r => r.inputs)).size).padStart(11)
      + String(dur(t[0]) + ' - ' + dur(t[t.length - 1])).padStart(22)
      + String(gb(b[0]) + ' - ' + gb(b[b.length - 1]) + ' GB').padStart(22)
      + String(pp[0].toFixed(4) + ' - ' + pp[pp.length - 1].toFixed(4)).padStart(18)
      + (t[0] > 0 ? '   ' + (t[t.length - 1] / t[0]).toFixed(1) + 'x' : ''));
  }
}

// IDENTICAL FILES ARE THE DETERMINISM EVIDENCE, so say when a set contains them rather than leaving it
// to be noticed. Equal size is not equal pixels - check-same-image.mjs answers that - but a set of
// byte-identical masters of one picture is the cheap first sign that nothing moved.
const bySize = new Map();
for (const r of rows) { const k = r.bytes + '|' + r.w; bySize.set(k, (bySize.get(k) || []).concat(r.name)); }
const dups = [...bySize.values()].filter(v => v.length > 1);
for (const d of dups)
  console.log('\n' + d.length + ' masters are byte-identical in size at this width:\n  ' + d.join('\n  ')
    + '\n  (equal size is not equal pixels - run tools/check-same-image.mjs to settle it)');

// ---- --cost: WHERE DID THE TIME GO ----------------------------------------------------------------
// A master stores two numbers per tile - how long the tile took and how many bytes it compressed to -
// and that pair separates work that scales with PIXELS from work that scales with OUTPUT SIZE. Fit
// ms = a + b x bytes: the intercept is everything that costs the same whatever the tile compressed to
// (paint, the readback, deflating a buffer whose INPUT size is fixed), and the slope is what rides on
// the output (the write).
//
// Measured on a 1,048,576: a = 1347 ms, so 76% of a five-hour render is the intercept, and dividing it
// by the tile's pixel count gives about 20 ns per pixel - flat across 2048, 4096 and 8192 tiles, which
// is how we know it is per-pixel work and not per-tile overhead.
//
// TWO HONEST LIMITS, printed rather than buried:
//
//   THE SPLIT IS NOT CLEAN. Busy tiles are both slower to paint AND bigger, so bytes correlates with
//   paint time and the slope absorbs some of it. R2 says how much of the variance bytes explains at
//   all; where it is low the a/b split is the shakiest part of this and the intercept is still the
//   number to trust, because it rests on every tile rather than on the fit's direction.
//
//   A NARROW RENDER UNDER-READS. At a fixed tile size a smaller render packs more slab into each tile,
//   so more of its cost is content: measured on ONE picture at 4096 tiles, the size-dependent share was
//   56% at 65,535, 42% at 131,072 and 25% at 524,288, and the intercept read 264, 314 and 311 ms. The
//   two wide ones agree to 1%; the narrow one is 16% low. It is not the same measurement more quietly.
if (flag('cost')) {
  const fits = [];
  for (const r of rows) {
    if (!r.perBy || !r.per || r.per.length !== r.perBy.length) {
      console.log('\n' + r.name + ': no per-tile bytes - cannot split (older master)');
      continue;
    }
    const n = r.per.length, add = a => a.reduce((x, y) => x + y, 0);
    const mMs = add(r.per) / n, mBy = add(r.perBy) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const dx = r.perBy[i] - mBy, dy = r.per[i] - mMs; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    const b = sxx ? sxy / sxx : 0, a = mMs - b * mBy, r2 = (sxx && syy) ? (sxy * sxy) / (sxx * syy) : 0;
    const tot = add(r.per), fixed = a * n, nsPx = a * 1e6 / (r.tile * r.tile);
    fits.push({ r, a, b, r2, nsPx, fixedPct: 100 * fixed / tot, tot });
    console.log('\n' + r.name);
    console.log('  ' + r.w + ' @ ' + r.tile + ' tiles, ' + n + ' of them, ' + dur(tot)
      + (r.resumed ? '   RESUMED ' + r.resumed : ''));
    console.log('  ms = ' + a.toFixed(0) + ' + ' + (b * 1e6).toFixed(1) + ' per MB out'
      + '      R2 ' + r2.toFixed(3) + (r2 < 0.3 ? '  <- bytes explain little of the variance; trust the intercept, not the split' : ''));
    console.log('  per-pixel ' + nsPx.toFixed(1) + ' ns      fixed ' + dur(fixed) + ' (' + (100 * fixed / tot).toFixed(0)
      + '%)   size-dependent ' + dur(tot - fixed) + ' (' + (100 * (tot - fixed) / tot).toFixed(0) + '%)');
  }
  // THE COMPARISON IS ON ns/px, not on wall time. Two runs minutes apart on one machine can differ by
  // far more than the effect being looked for - repeated page loads were measured inflating timings up
  // to 2x - and a per-pixel figure stays honest when a whole run drifted slow.
  if (fits.length > 1) {
    console.log('\nPER-PIXEL COST, which is what survives a run that drifted slow:');
    const srt = fits.slice().sort((x, y) => x.nsPx - y.nsPx);
    for (const f of srt)
      console.log('  ' + String(f.nsPx.toFixed(1) + ' ns').padStart(9) + '  @' + String(f.r.tile).padEnd(6)
        + String(f.r.w).padStart(9) + '  ' + f.r.name);
    const lo = srt[0], hi = srt[srt.length - 1];
    if (lo !== hi) console.log('  spread ' + (100 * (hi.nsPx / lo.nsPx - 1)).toFixed(1) + '%, cheapest at tile '
      + lo.r.tile + (lo.r.tile === hi.r.tile ? '  (same tile size: this is run-to-run, not tiling)' : ''));
  }
}

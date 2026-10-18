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
    spectrum: j.spectrum === 0 ? 'day' : j.spectrum === -1 ? 'uv' : 'spx' + j.spectrum,
    tiles: j.renders, tile: j.render,
    msRender: j.ms ? j.ms.render : 0, msSum: sum, perN: per.length,
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
  console.log('file,width,height,pixels,bytes,bytes_per_pixel,tiles,tile_size,render_ms_sum,render_ms_field,resumed_tiles,build,light,mean,lit40');
  for (const r of rows) console.log([JSON.stringify(r.name), r.w, r.h, r.px, r.bytes, r.bpp.toFixed(6),
    r.tiles, r.tile, r.msSum, r.msRender, r.resumed, r.build, r.spectrum, r.mean, r.lit40].join(','));
  process.exit(0);
}

console.log('   width      pixels     tiles@size        render   (own clock)      file     B/px   light  build');
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
    + '  ' + r.build
    + (r.resumed ? '  RESUMED ' + r.resumed + ' of ' + r.tiles : ''));
}
if (anyResumed)
  console.log('\nRESUMED rows: render time is the sum of the per-tile record, which spans every sitting.\n'
    + 'The bracketed figure is the master\'s own ms.render, which covers only the sitting that finished it.');

// Bytes per pixel falls as a picture gets wider, because each tile covers less of it and compresses
// better. Printed as a series rather than per row, because the TREND is the useful part - it is what
// makes an extrapolation to an untried width an upper bound rather than a guess.
const byW = rows.slice().sort((a, b) => a.w - b.w).filter((r, i, a) => !i || r.w !== a[i - 1].w);
if (byW.length > 1) {
  console.log('\nbytes per pixel by width: ' + byW.map(r => r.w + ' ' + r.bpp.toFixed(4)).join('   '));
  const f = byW[0], l = byW[byW.length - 1];
  console.log('  ' + (l.bpp < f.bpp ? 'falling' : 'rising') + ' across this set, '
    + (f.bpp / l.bpp).toFixed(2) + 'x from ' + f.w + ' to ' + l.w);
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

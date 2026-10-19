// HOW MANY PIXELS HAVE EVER BEEN RENDERED, by the method the provenance record was taken with.
//
// PROVENANCE.md publishes a figure - 768 renders totalling 1,107,051,880,835 pixels, the tebipixel
// crossed on 2026-10-01 - and that figure was computed once, inline, from a shell one-liner that
// existed only in a transcript. Recomputing it later by a reasonable-looking method got a DIFFERENT
// answer and nearly prompted a "correction" to a published page: the keys differed (at|w|engine, not
// at|w|inputs) and two of the three evidence directories had been forgotten. The published number was
// right and the re-derivation was wrong.
//
// So the method lives here now, and the tool CHECKS ITSELF against the published figure before
// reporting anything current. If that check fails, the method has drifted and the current number is
// not to be trusted - which is the opposite of what a one-liner in a transcript can tell you.
//
//   node tools/render-census.mjs            evidence directories only, as published
//   node tools/render-census.mjs --disk     also count masters on disk that never reached them
//
// THE KEY IS at|w|engine. `at` is the finish time to the millisecond, so two renders cannot collide;
// `engine` keeps the same picture rendered on two browsers as two renders, which is what it is. Using
// `inputs` instead collapses them and under-counts by about 8%.
//
// A RENDER WITH NO LIGHT IS NOT A RENDER. `light.mean === 0` means the master came back black, which
// happened during the early tier work; those are dropped, as they were in the original count.
//
// RECONSTRUCTIONS are counted but not as renders. A file carrying `_kind: "reconstruction"` holds an
// aggregate for masters that were deleted before being harvested - the pixel total is exact, the
// per-render detail is gone - and it deliberately has no top-level `w` so the per-render loop skips
// it. Its totals are added separately and reported on their own line, so the reader can always see
// how much of the figure rests on something other than a record of one render.
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, basename } from 'path';
import { locateMeta } from './lib/find-meta.mjs';

const DIRS = ['C:/Users/CKing/Documents/GITHUB/stone-author/.claude/master-meta',
              'C:/Users/CKing/Documents/testing and development/stone-author-evidence',
              'C:/Users/CKing/Downloads/render-evidence'];
const TEBI = 2n ** 40n;
const pxOf = o => BigInt(o.w) * BigInt(+o.h || Math.round(o.w * 0.625));
const pct = v => (100 * Number(v) / 2 ** 40).toFixed(3) + '%';
const withDisk = process.argv.includes('--disk');

const seen = new Map();                       // at|w|engine -> record
const recon = [];
let dirsMissing = 0;
for (const D of DIRS) {
  let e = []; try { e = readdirSync(D); } catch (_) { dirsMissing++; console.log('  (absent: ' + D + ')'); continue; }
  for (const f of e) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    let o; try { o = JSON.parse(readFileSync(join(D, f), 'utf8')); } catch (_) { continue; }
    if (!o) continue;
    if (o._kind === 'reconstruction') { recon.push({ f, o }); continue; }
    if (!o.w) continue;
    if (o.light && o.light.mean === 0) continue;
    seen.set((o.at || '') + '|' + o.w + '|' + (o.engine || '?'), o);
  }
}

// THE SELF-CHECK. Restricted to what existed when the record was taken, this must reproduce the
// published figure exactly. It is not a sanity check on the data - it is a check on THIS FILE.
const CUT = '2026-10-01T07:28:05.881Z';
const PUB_N = 768, PUB_PX = 1107051880835n;
const then = [...seen.values()].filter(o => (o.at || '') <= CUT);
const thenPx = then.reduce((s, o) => s + pxOf(o), 0n);
const ok = then.length === PUB_N && thenPx === PUB_PX;
console.log('method check against PROVENANCE.md (renders at or before ' + CUT.slice(0, 19) + ')');
console.log('   published  ' + PUB_N + ' renders   ' + PUB_PX.toLocaleString());
console.log('   computed   ' + then.length + ' renders   ' + thenPx.toLocaleString()
  + '   ' + (ok ? 'EXACT' : '*** MISMATCH - the method has drifted, do not quote what follows ***'));

let extra = 0;
if (withDisk) {
  const walk = (dir, d) => {
    let es; try { es = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = join(dir, e.name);
      if (e.isDirectory() && d < 3) { walk(p, d + 1); continue; }
      if (!/\.tiff?$/i.test(e.name)) continue;
      try { if (statSync(p).size < 1e5) continue; } catch { continue; }
      let loc; try { loc = locateMeta(p); } catch { continue; }
      if (!loc || !loc.meta.w) continue;
      const o = loc.meta;
      if (o.light && o.light.mean === 0) continue;
      const k = (o.at || '') + '|' + o.w + '|' + (o.engine || '?');
      if (!seen.has(k)) { seen.set(k, o); extra++; }
    }
  };
  walk('C:/Users/CKing/Downloads', 0);
}

const all = [...seen.values()];
const livePx = all.reduce((s, o) => s + pxOf(o), 0n);
const reconPx = recon.reduce((s, r) => s + BigInt(r.o.pixels || 0), 0n);
const reconN = recon.reduce((s, r) => s + (r.o.renders || 0), 0);
const total = livePx + reconPx;

console.log('\nrecords        ' + all.length + ' renders'
  + (withDisk ? '   (+' + extra + ' found only on disk)' : '   (evidence directories only)'));
console.log('pixels         ' + livePx.toLocaleString() + '   ' + pct(livePx));
if (recon.length) {
  console.log('\nreconstructed  ' + reconN + ' renders   ' + reconPx.toLocaleString() + '   ' + pct(reconPx));
  for (const r of recon) console.log('   ' + basename(r.f) + '  -  ' + (r.o.at || '?'));
  console.log('   (exact pixels, no per-render detail: deleted before harvest)');
}
console.log('\nTOTAL          ' + (reconN + all.length) + ' renders   ' + total.toLocaleString());
console.log('               ' + pct(total) + ' of 2^40   =   ' + (Number(total) / 2 ** 40).toFixed(4) + ' x 2^40');

// Crossings, over the dated records only - a reconstruction has no instant to attribute one to.
const rows = all.filter(o => o.at).sort((a, b) => a.at.localeCompare(b.at));
console.log('\ncrossings (dated renders only, so a reconstruction cannot be credited with one):');
for (let n = 1n; n * TEBI <= livePx; n++) {
  let run = 0n;
  for (const o of rows) {
    const b = run; run += pxOf(o);
    if (b < n * TEBI && run >= n * TEBI) {
      console.log('   ' + n + ' x 2^40   ' + o.at + '   by a ' + o.w
        + '   (' + pct(b) + ' -> ' + pct(run) + ')');
      break;
    }
  }
}
if (!ok) process.exit(1);

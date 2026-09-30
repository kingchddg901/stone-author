// IS THERE ACTUALLY A STONE IN THIS FILE?
//
// A master carries `inputs` and `state`, and both hash what went IN — the marks, G, T, the layer
// stack. Neither covers the GEOMETRY derived from those marks. The app builds that inside a
// requestAnimationFrame:
//
//     requestAnimationFrame(() => { if (needBuild) { build(); ... } draw(); ... });
//
// so between a slab landing and the next animation frame it holds every mark and ZERO lines, cracks
// and specks. A render started in that window produces an empty picture with a completely correct
// identity: the slab hash matches, the mark count matches, and the file is worthless. rAF does not run
// at all in a hidden document, so a backgrounded or fully occluded window never leaves that window.
//
// Three such files were made before this check existed and none of the other tools could see them —
// the slab check passed them, and the light figures went into a walk as data.
//
// A slab may legitimately have no cracks, or no specks. It cannot have marks and no geometry of any
// kind, so that combination is the signature: authored slabs never produce it, only lost races do.
//
//   node tools/check-geometry.mjs <file|dir> [...] [--since YYYY-MM-DD]
import { readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { findMeta } from './lib/find-meta.mjs';

const NL = String.fromCharCode(10);
const args = process.argv.slice(2);
const sinceAt = args.indexOf('--since');
const SINCE = sinceAt >= 0 ? args[sinceAt + 1] : null;
const skip = sinceAt >= 0 ? sinceAt + 1 : -1;
const targets = args.filter((a, i) => !a.startsWith('--') && i !== skip);
if (!targets.length) {
  console.error('usage: node tools/check-geometry.mjs <file|dir> [...] [--since YYYY-MM-DD]');
  process.exit(1);
}

const MASTER = /^stone-.*[.](tif|tiff|png|zip)$/i;
const rows = [];
function walk(p) {
  let s = null;
  try { s = statSync(p); } catch (_) { return; }
  if (s.isDirectory()) {
    for (const n of readdirSync(p)) walk(join(p, n));       // every subdirectory, not just matching ones
    return;
  }
  if (!MASTER.test(basename(p))) return;
  let m = null;
  try { m = findMeta(p); } catch (_) { return; }
  if (!m) return;
  if (SINCE && (!m.at || m.at.slice(0, 10) < SINCE)) return;
  rows.push({
    p, at: m.at || '', w: m.w, engine: m.engine || '?',
    marks: m.marks | 0, lines: m.lines | 0, cracks: m.cracks | 0, specks: m.specks | 0,
    mean: m.light ? m.light.mean : undefined,
  });
}
for (const t of targets) walk(t);
rows.sort((a, b) => a.at.localeCompare(b.at));

const dead = rows.filter(r => r.marks > 0 && !r.lines && !r.cracks && !r.specks);

console.log('geometry check   ' + rows.length + ' render(s)' + (SINCE ? ' since ' + SINCE : ''));
if (!dead.length) {
  console.log('  ok    every render carries derived geometry');
} else {
  console.log('  ' + dead.length + ' rendered an EMPTY STONE — marks present, no geometry at all:' + NL);
  console.log('  when                 engine            width   marks  lines cracks specks   light.mean');
  for (const r of dead)
    console.log('  ' + (r.at || '?').slice(0, 19).padEnd(20) + ' ' + String(r.engine).padEnd(16) +
      String(r.w).padStart(6) + String(r.marks).padStart(8) + String(r.lines).padStart(7) +
      String(r.cracks).padStart(7) + String(r.specks).padStart(7) +
      String(r.mean === undefined ? '-' : r.mean).padStart(12));
}

console.log(NL + '  engine              renders   empty');
const by = new Map();
for (const r of rows) {
  const a = by.get(r.engine) || { n: 0, bad: 0 };
  a.n++;
  if (r.marks > 0 && !r.lines && !r.cracks && !r.specks) a.bad++;
  by.set(r.engine, a);
}
for (const [eng, a] of [...by.entries()].sort())
  console.log('  ' + String(eng).padEnd(20) + String(a.n).padStart(7) + String(a.bad).padStart(8) +
    (a.bad ? '   <-' : ''));

process.exit(dead.length ? 1 : 0);

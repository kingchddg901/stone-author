// HARVEST AND DROP, WITHOUT BEING ASKED.
//
// A master is 300 to 800 MB and its evidence is about 30 KB. A terapixel run puts roughly 150 GB
// through the disk, which means the harvest-then-delete loop has to happen continuously rather than in
// batches — and doing it by hand is six identical rounds of inventory, geometry, record, remove.
//
// THE ORDER IS THE SAFETY. Nothing is deleted that has not first been read, judged, written out as a
// sidecar, and had that sidecar read back from disk. Each step can refuse, and a refusal leaves the
// master exactly where it is.
//
// WHEN IS A FILE FINISHED? Not when it stops growing — a render can stall for 87 seconds mid-write and
// a size-stability timer would call that done. But a master carries its metadata AFTER the image data,
// so `findMeta` only succeeds on a complete file. Parsing it IS the completeness test, and it is the
// same read the harvest needs anyway.
//
// AN EMPTY STONE IS NOT DELETED. `inputs` and `state` hash what went in, so a render made before its
// geometry was built carries a correct identity and no picture. Those are moved aside rather than
// removed: they are the only evidence of the condition that made them.
//
//   node tools/watch-harvest.mjs <dir> --meta <dir> [--keep <name>] [--aside <dir>] [--every <s>] [--dry]
//
//     --keep    a directory name never descended into (repeatable). The masters live in one.
//     --aside   where empty-geometry renders go. Default: <dir>/_no-geometry
//     --dry     do everything except delete, and say what it would have removed.
import { readdirSync, statSync, unlinkSync, renameSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { join, basename, extname, dirname } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { findMeta } from './lib/find-meta.mjs';

const NL = String.fromCharCode(10);
const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const many = name => args.reduce((a, v, i) => (v === '--' + name ? a.concat(args[i + 1]) : a), []);
const DRY = args.includes('--dry');
const DIR = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')))[0];
const META = flag('meta');
const EVERY = Math.max(2, +(flag('every', 10))) * 1000;
const KEEP = many('keep');
const ASIDE = flag('aside', DIR ? join(DIR, '_no-geometry') : null);

if (!DIR || !META) {
  console.error('usage: node tools/watch-harvest.mjs <dir> --meta <dir> [--keep <name>] [--aside <dir>] [--every <s>] [--dry]');
  process.exit(2);
}

// THE EXPORT IS NAMED AFTER THE SLAB, so renaming a slab renames every master it produces -- and this
// regex is the only thing deciding what gets harvested. Loading `HERO-MASTER-sealkey.json` on 2026-09-30
// turned the output into `HERO-MASTER-65535-...tif`, which matched nothing: 21 masters, 52.5 GiPx and
// 15.2 GB accumulated unseen for an hour, with no log line, because a name that does not match is
// indistinguishable from a directory with nothing in it.
//
// Listed explicitly rather than widened. A looser rule over a Downloads folder would start harvesting --
// and deleting -- files this project never wrote. Add a prefix here when a slab earns one.
const PREFIX = ['stone', 'HERO-MASTER'];
const MASTER = new RegExp('^(' + PREFIX.join('|') + ')-.*[.](tif|tiff|png|zip)$', 'i');
const stamp = () => new Date().toISOString().slice(11, 19);
const say = m => console.log(stamp() + '  ' + m);

// Files that have already been judged. A master that was refused is remembered so the same refusal is
// not printed every ten seconds — the point of the log is what CHANGED.
const settled = new Set();
let harvested = 0, removed = 0, freed = 0, aside = 0, refused = 0;

function candidates() {
  const out = [];
  (function walk(d) {
    let e = [];
    try { e = readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const f of e) {
      const p = join(d, f.name);
      if (f.isDirectory()) { if (!KEEP.includes(f.name) && f.name !== basename(ASIDE || '')) walk(p); continue; }
      if (MASTER.test(f.name) && !settled.has(p)) out.push(p);
    }
  })(DIR);
  return out;
}

function sidecarFor(p) { return join(META, basename(p, extname(p)) + '.json'); }

function record(p) {
  // meta-index owns the sidecar format and the index merge. Spawning it keeps one definition of both,
  // and its own read-back check runs inside it.
  const r = spawnSync(process.execPath, [join(HERE, 'meta-index.mjs'), p, '--out', META],
    { encoding: 'utf8' });
  if (r.status !== 0) return 'meta-index exited ' + r.status + ' ' + (r.stderr || '').trim().slice(0, 160);
  const at = sidecarFor(p);
  if (!existsSync(at)) return 'no sidecar was written';
  // READ IT BACK HERE TOO. meta-index checks its own write, but this process is the one about to delete
  // the master, so it does not take that on trust from another process.
  let j = null;
  try { j = JSON.parse(readFileSync(at, 'utf8')); } catch (e) { return 'sidecar does not parse: ' + e.message; }
  if (!j || !j.w || j.marks === undefined) return 'sidecar is missing the fields the master had';
  return null;
}

function sweep() {
  for (const p of candidates()) {
    let m = null;
    // A PARTIAL FILE FAILS HERE, which is exactly what we want: the metadata trails the image, so this
    // read is the completeness test. Try again next pass.
    try { m = findMeta(p); } catch (_) { continue; }
    if (!m || !m.w) continue;

    settled.add(p);
    const name = basename(p);
    const size = (() => { try { return statSync(p).size; } catch (_) { return 0; } })();

    if (m.marks > 0 && !m.lines && !m.cracks && !m.specks) {
      try {
        mkdirSync(ASIDE, { recursive: true });
        renameSync(p, join(ASIDE, name));
        aside++;
        say('EMPTY STONE   ' + name + '  -> ' + ASIDE + '   (marks ' + m.marks + ', no geometry; kept)');
      } catch (e) { refused++; say('could not move ' + name + ': ' + e.message); }
      continue;
    }

    const bad = record(p);
    if (bad) { refused++; say('REFUSED       ' + name + '  ' + bad); continue; }
    harvested++;

    if (DRY) { say('would remove  ' + name + '  ' + (size / 1e6).toFixed(0) + ' MB'); continue; }
    try {
      unlinkSync(p);
      removed++; freed += size;
      say('harvested     ' + name + '  ' + String(m.w) + 'px  ' + (size / 1e6).toFixed(0) + ' MB  freed');
    } catch (e) { refused++; say('recorded but could NOT delete ' + name + ': ' + e.message); }
  }
}

say('watching ' + DIR + (DRY ? '   (dry run: nothing will be deleted)' : ''));
say('  sidecars -> ' + META);
if (KEEP.length) say('  never entered: ' + KEEP.join(', '));
say('  empty stones -> ' + ASIDE);
sweep();
setInterval(sweep, EVERY);

const done = () => {
  console.log(NL + '  harvested ' + harvested + ', removed ' + removed + ' (' + (freed / 1e9).toFixed(2) +
    ' GB), set aside ' + aside + ', refused ' + refused);
  process.exit(0);
};
process.on('SIGINT', done);
process.on('SIGTERM', done);

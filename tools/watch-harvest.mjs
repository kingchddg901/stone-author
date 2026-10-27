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
//
// AN ENTRY MUST REACH THE `-<size>-` BOUNDARY, because MASTER concatenates the prefix with SHAPED and
// SHAPED opens on a hyphen. So a prefix that stops partway through a slab name matches nothing: for
// `universal master all three materials-1048576-...`, the entry `universal master` is followed by a
// SPACE where the regex wants `-`. It would be a dead entry, and check-harvest-names cannot see that --
// it appends a real tail TO THE PREFIX ITSELF, which makes any well-formed prefix match its own
// synthetic name whether or not a slab by that name has ever rendered. A dead entry is green.
const PREFIX = ['stone', 'HERO-MASTER', 'Glass Master Source', 'regression test',
                'universal master all three materials'];
// ESCAPED, because these are slab names a person typed rather than patterns. A slab called
// `glass (v2)` would otherwise build an invalid regex and take the tool down at startup - or, worse,
// a `.` in a name would quietly match any character.
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// THE SHAPE OF AN EXPORT, WHICH IS NOT THE SAME QUESTION AS WHETHER TO DELETE IT.
//
// The prefix list is deliberately narrow: a looser rule over a Downloads folder would start deleting
// files this project never wrote, and this particular Downloads folder holds 22 Baen CD archives to
// prove the point. But a narrow rule has a failure mode with no symptom, and this comment used to be
// the only record of it: on 2026-09-30 a renamed slab put 21 masters and 15.2 GB past the regex, and
// a name that does not match was indistinguishable from a directory with nothing in it.
//
// IT HAPPENED AGAIN. The ladder of 2026-10-24 exported 20 masters as `Glass Master Source-...`, and
// every one of them was invisible here; their sidecars exist only because they were made by hand.
// Two prefixes above fix those two slabs and fix nothing about the third.
//
// So the tail the EXPORTER writes - width, spectrum, platform, date, time - is matched separately,
// and only ever to COUNT AND SAY SO. The asymmetry is the safety property: the loose rule can do
// nothing but print a line, and the narrow rule above is still the only thing that can delete.
const SHAPED = /-\d+-[A-Za-z]+-[A-Za-z]+-[A-Za-z]+-\d{4}-\d{6}[.](tif|tiff|png|zip)$/i;

// A KNOWN SLAB **AND** THE EXPORT SHAPE, composed from the one definition above rather than written
// twice. The delete net used to be prefix + `.*` + extension, and `check-harvest-names` caught what
// that costs: `stone-author-main.zip` - this repo downloaded from GitHub into the same folder - was a
// candidate for harvesting, on a prefix meant for masters. Nothing had deleted one, because a zip
// with no metadata gets refused; it was a loaded gun with the safety on.
//
// Composing them can only ever NARROW what is deletable, and every master in the archive carries this
// tail because the exporter writes it. The warning net stays the shape alone, so a new slab is still
// seen - the two differ now in exactly one thing, whether the slab is known.
const MASTER = new RegExp('^(' + PREFIX.map(esc).join('|') + ')' + SHAPED.source, 'i');
const stamp = () => new Date().toISOString().slice(11, 19);
const say = m => console.log(stamp() + '  ' + m);

// Files that have already been judged. A master that was refused is remembered so the same refusal is
// not printed every ten seconds — the point of the log is what CHANGED.
const settled = new Set();
let harvested = 0, removed = 0, freed = 0, aside = 0, refused = 0;

// Reported once per name, not once per sweep: the log is for what CHANGED.
const unseen = new Set();

function candidates() {
  const out = [];
  (function walk(d) {
    let e = [];
    try { e = readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const f of e) {
      const p = join(d, f.name);
      if (f.isDirectory()) { if (!KEEP.includes(f.name) && f.name !== basename(ASIDE || '')) walk(p); continue; }
      if (MASTER.test(f.name)) { if (!settled.has(p)) out.push(p); continue; }
      // SHAPED LIKE AN EXPORT AND NOT MATCHED: say so, do nothing else. A slab name this tool has
      // never been told about looks exactly like an empty folder without this line.
      if (SHAPED.test(f.name) && !unseen.has(p)) {
        unseen.add(p);
        const slab = f.name.replace(SHAPED, '');
        say('NOT HARVESTED  ' + f.name);
        say('               looks like an export but no prefix matches. Add ' + JSON.stringify(slab) +
            ' to PREFIX in this file, or harvest it by hand:');
        say('               node tools/meta-index.mjs "' + p + '" --out "' + META + '"');
      }
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

    // TWO WAYS TO PRODUCE NOTHING, and the geometry counts only see one of them.
    //
    //   no geometry  -- the render ran before the geometry was built. marks exist, nothing else does.
    //   black frame  -- the geometry existed and was never PAINTED. Every count is perfect.
    //
    // The second was invisible here until 2026-09-30, when seven 16384 masters were harvested and
    // deleted carrying 666 marks, 70 lines, 232 cracks, 8050 specks and an image with no pixel above
    // zero anywhere. 16384 is the widest size that still demands one full-size assembly canvas
    // (16384 x 10240 RGBA = 640 MiB, with three windows each asking for one); it allocated, reported
    // success and painted nothing. Only `light.mean` sees it, and nothing was reading `light.mean`.
    //
    // A render from a build with no light figure cannot be judged and is left alone rather than guessed
    // at. A deliberately black slab would be set aside too, which costs a file in a directory and is the
    // cheap side of this trade.
    const noGeometry = m.marks > 0 && !m.lines && !m.cracks && !m.specks;
    const blackFrame = !!(m.light && m.light.mean === 0);
    if (noGeometry || blackFrame) {
      try {
        mkdirSync(ASIDE, { recursive: true });
        renameSync(p, join(ASIDE, name));
        aside++;
        say((blackFrame ? 'BLACK FRAME   ' : 'EMPTY STONE   ') + name + '  -> ' + ASIDE + '   ' +
            (blackFrame ? '(light.mean 0 at ' + m.w + 'px — allocated and painted nothing; kept)'
                        : '(marks ' + m.marks + ', no geometry; kept)'));
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
say('  harvests only: ' + PREFIX.map(s => s + '-*').join(', '));
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

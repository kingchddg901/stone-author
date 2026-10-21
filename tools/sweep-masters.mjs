// HARVEST EVERYTHING, KEEP WHAT WAS FLAGGED, DELETE THE REST.
//
// A master is 0.5 to 23 GB and its evidence is about half a megabyte. Rendering is fast enough now that
// the disk fills in an evening - 112 masters and 137 GB on the day this was written - so the
// harvest-then-delete loop has to be one command rather than six rounds of inventory by hand.
//
// THE FLAG IS A FOLDER, NOT A LIST. Anything under `keep/` is never touched. A list would be a filename
// typed twice - once when the render lands and once in the list - and a typo there does not error, it
// silently fails to protect something irreplaceable. A file is either in the folder or it is not, it can
// be moved from a file manager on any device, and it survives a rename.
//
// THE ORDER IS THE SAFETY, and every step can refuse. A refusal leaves the master where it is:
//
//   1. findMeta parses the master                      -> the file is complete, not half-written
//   2. meta-index writes the sidecar                   -> it reads it back itself and refuses on drift
//   3. this re-reads that sidecar, independently       -> it must equal the block in the master
//   4. ...and carry w, at, and one byte count PER TILE  -> see below
//   5. only then, and only with --go, unlink
//
// Step 4 is not ceremony. perTile.bytes is what made the 262,144 determinism comparison possible -
// 2,560 tiles agreeing across three runs - and once the master is gone it is the only record of the
// picture at tile granularity that will ever exist.
//
// NOTABLE IS A FLAG, NEVER A DECISION. Some masters are the only evidence of something and this says so,
// but it will not protect them: only the folder does. The point is that a sweep should not be the first
// time somebody notices a file was the last of its kind.
//
//   node tools/sweep-masters.mjs                 what it would do, and why
//   node tools/sweep-masters.mjs --go            actually delete the sweep list
//   node tools/sweep-masters.mjs --dir <path>    somewhere other than Downloads
//   node tools/sweep-masters.mjs --release 524288   let one held file go anyway
import { readdirSync, statSync, readFileSync, unlinkSync } from 'fs';
import { join, basename, resolve, sep } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { findMeta } from './lib/find-meta.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(HERE, '..');
const META = join(REPO, '.claude', 'master-meta');
const args = process.argv.slice(2);
const GO = args.includes('--go');
const DIR = (() => { const i = args.indexOf('--dir'); return i >= 0 ? args[i + 1] : 'C:/Users/CKing/Downloads'; })();
// HOW A REVIEW SAYS "YES, THAT ONE". The hold tier is a flag for review and it needs an exit that is not
// lowering HOLD_SECONDS, because a threshold moved to release one file silently releases everything else
// at that cost. A token names the file in the COMMAND, so the decision lands in shell history instead of
// in a constant nobody can read back - and a token matching nothing is reported, never shrugged off.
const RELEASE = args.reduce((a, v, i) => (args[i - 1] === '--release' ? a.concat(v.split(',')) : a), []);
const TEBI = 2n ** 40n;
const gb = n => (n / 1e9).toFixed(2) + ' GB';

// KEEP IS MATCHED ON THE PATH, case-insensitively, because Windows will hand back `keep` for a folder
// created as `Keep` and a sweep must not depend on which one it got.
const inKeep = p => p.toLowerCase().split(/[\\/]/).includes('keep');

function walk(dir, out, depth = 0) {
  let es; try { es = readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of es) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (depth < 3 && e.name !== '__MACOSX') walk(p, out, depth + 1); continue; }
    if (/\.tiff?$/i.test(e.name) && !/^\._/.test(e.name)) out.push(p);
  }
  return out;
}

// ---- the archive, for the notable tests -----------------------------------------------------------
const archive = [];
for (const f of readdirSync(META)) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  let o; try { o = JSON.parse(readFileSync(join(META, f), 'utf8')); } catch (_) { continue; }
  if (!o || !o.w || (o.light && o.light.mean === 0)) continue;
  archive.push({ name: f.replace(/\.json$/, ''), o });
}
const pxOf = o => BigInt(o.w) * BigInt(+o.h || Math.round(o.w * 0.625));
const count = (key) => {
  const m = new Map();
  for (const { o } of archive) { const k = key(o); if (k == null) continue; m.set(k, (m.get(k) || 0) + 1); }
  return m;
};
const bySlab = count(o => o.inputs);
const byKind = count(o => o.engine + '|' + o.w);

// WHICH MASTERS CARRIED A CROSSING, by the method render-census publishes: dated records only, in order,
// the one whose own pixels take the running total past n x 2^40.
const crossings = new Set();
{
  const rows = archive.filter(r => r.o.at).sort((a, b) => a.o.at.localeCompare(b.o.at));
  let run = 0n, next = TEBI;
  for (const r of rows) {
    const before = run; run += pxOf(r.o);
    while (before < next && run >= next) { crossings.add(r.name); next += TEBI; }
  }
}

// WHAT THE BUILD CAN STILL PRODUCE, which is the sharpest irreplaceability claim in here. Everything
// else on this list could in principle be re-rendered from its slab; a master made at a pass the ladder
// no longer offers cannot, and not via `?tile=` either, because the URL cap IS TILE_MAX. Read from the
// app rather than typed here, so banning or restoring a size moves this test with it.
//
// ADDED 2026-10-20, THE DAY IT WAS NEEDED AND MISSED. 8192 left the ladder that morning; that afternoon
// this tool put the two largest masters ever rendered - both 1,048,576 at an 8192 pass, 45.9 GB between
// them - on the sweep list with no remark at all. Four tests and not one of them was "the app can never
// make this again". A ban is exactly the event that turns ordinary files into last-of-their-kind.
const LADDER = (() => {
  try {
    const src = readFileSync(join(REPO, 'app', 'stone-author.html'), 'utf8');
    const m = src.match(/const TILE_LADDER = \[([^\]]*)\]/);
    return m ? m[1].split(',').map(s => +s.trim()).filter(Boolean) : null;
  } catch (_) { return null; }
})();
const TILE_CEIL = LADDER ? Math.max(...LADDER) : 0;

// AND THE BIGGEST FEW, because a sweep that takes the largest render ever made should have to say so.
const biggest = new Set(archive.slice()
  .sort((a, b) => { const x = pxOf(a.o), y = pxOf(b.o); return y > x ? 1 : y < x ? -1 : 0; })
  .slice(0, 3).map(r => r.name));

// WHAT JUSTIFIES KEEPING PIXELS, which turns out not to be the same question as what is rare.
//
// This list held 69.78 GB behind six rarity tests and was asked to justify it. Every one of them
// discriminates - measured over 824 records, none flags more than 3%, and the slab signature is a real
// grouping with 26 values and a biggest group of 496 - and not one of them is a reason to keep a TIFF,
// BECAUSE THE SIDECAR SURVIVES THE DELETE. Every figure in docs/devices.md, every Gecko-against-Blink
// table, the per-tile byte arrays, the shed records and plan.tried all came out of the json. "The only
// render of this slab" means the only COPY, not the only chance; the slab is reproducible. "Carried a
// tebipixel crossing" is bookkeeping about the ORDER OF THE ARCHIVE and was holding 4.22 GB for a tally.
// "A pass above the ladder" was the one strong test, for about an hour, until ?tile=8192 came back as an
// opt-in and made those reproducible too.
//
// SO THE AXIS IS COST TO REMAKE, read from ms.render, which the sidecar carries. It splits hard: three
// masters cost 11.2 hours of machine time between them and the other sixteen average under eight
// minutes. Rarity still PRINTS, because it is worth knowing a file was the last of its kind, but it no
// longer holds anything back - which is what "NOTABLE IS A FLAG, NEVER A DECISION" was always meant to
// say and did not manage, since the flag was wired straight to the hold.
const HOLD_SECONDS = 3600;

function notable(name, o) {
  const note = [], hold = [];
  const pass = o.render || o.tile;
  if (TILE_CEIL && pass > TILE_CEIL)
    note.push('a ' + pass + ' pass - above the ' + TILE_CEIL + ' ladder, so nothing picks it again unaided');
  if (crossings.has(name)) note.push('carried a tebipixel crossing');
  if (bySlab.get(o.inputs) === 1) note.push('the only render of this slab');
  if (byKind.get(o.engine + '|' + o.w) === 1) note.push('the only ' + o.engine + ' at ' + o.w);
  if (o.poolShed && o.poolShed.length) note.push('recorded a shed: ' + o.poolShed.join(' '));

  const secs = o.ms && o.ms.render ? o.ms.render / 1000 : 0;
  if (secs >= HOLD_SECONDS) hold.push('cost ' + (secs / 3600).toFixed(1) + ' h of machine time to render');
  if (biggest.has(name)) hold.push('one of the three largest renders on record (' + (Number(pxOf(o)) / 1e9).toFixed(1) + ' Gpx)');
  return { hold, note };
}

// ---- verify, exactly as the manual sweeps have done all along --------------------------------------
function verify(master, block) {
  const side = join(META, basename(master).replace(/\.tiff?$/i, '') + '.json');
  let s = null;
  try { s = JSON.parse(readFileSync(side, 'utf8')); } catch (_) { return 'no readable sidecar'; }
  if (JSON.stringify(s) !== JSON.stringify(block)) return 'the sidecar differs from the block in the master';
  if (!s.w) return 'the sidecar has no w';
  if (!s.at) return 'the sidecar has no at';
  // ONE ENTRY PER PASS, NOT PER STORED TILE. `renders` is the unit of work; `tiles` is the grid the
  // file declares, and they differ whenever the pass is wider than the store (an 8192 pass stores as
  // 4096 x2, so tiles = renders x 4). Checking against `tiles` refused two valid masters.
  const pt = s.perTile && s.perTile.bytes;
  if (!Array.isArray(pt)) return 'perTile.bytes is absent';
  const want = s.renders || s.tiles;
  if (!want) return 'the sidecar has no pass count to check perTile against';
  if (pt.length !== want) return 'perTile.bytes is ' + pt.length + ', expected one per pass (' + want + ')';
  return null;
}

// ---- go -------------------------------------------------------------------------------------------
const all = walk(DIR, []);
const kept = all.filter(inKeep), loose = all.filter(p => !inKeep(p));
console.log('\n' + DIR);
console.log('  ' + all.length + ' masters, ' + gb(all.reduce((s, p) => s + statSync(p).size, 0)));
console.log('  ' + kept.length + ' under keep/ - never touched');
console.log('  ' + loose.length + ' loose\n');

// harvest anything that has no sidecar yet, in one call
const need = loose.filter(p => {
  const side = join(META, basename(p).replace(/\.tiff?$/i, '') + '.json');
  try { const s = JSON.parse(readFileSync(side, 'utf8')); return !(s && s.w && s.at); } catch (_) { return true; }
});
if (need.length) {
  console.log('harvesting ' + need.length + ' without a sidecar...');
  const r = spawnSync(process.execPath, [join(REPO, 'tools', 'meta-index.mjs'), ...need, '--out', META], { encoding: 'utf8' });
  const line = (r.stdout || '').split('\n').find(l => /wrote|REFUSED/.test(l));
  console.log('  ' + (line || (r.stderr || '').trim().slice(0, 200) || 'no output') + '\n');
}

const sweep = [], hold = [], refused = [];
for (const p of loose) {
  let block = null; try { block = findMeta(p); } catch (_) { block = null; }
  if (!block) { refused.push([p, 'no metadata block - not a finished master']); continue; }
  const why = verify(p, block);
  if (why) { refused.push([p, why]); continue; }
  const n = notable(basename(p).replace(/\.tiff?$/i, ''), block);
  const rel = RELEASE.filter(t => basename(p).includes(t));
  const row = { p, size: statSync(p).size, why: n.hold, note: n.note, rel };
  (n.hold.length && !rel.length ? hold : sweep).push(row);
}
// A TOKEN THAT MATCHED NOTHING IS A TYPO, and a typo here reads as "it was already gone". Say so.
const dead = RELEASE.filter(t => !loose.some(p => basename(p).includes(t)));
if (dead.length) console.log('--release matched nothing: ' + dead.join(', ') + '\n');

const tot = a => a.reduce((s, x) => s + x.size, 0);
// A RELEASED FILE PRINTS WHAT IT WAS HELD FOR, on the sweep list, right where it is about to go. The
// reason it was held is exactly the thing being given up, so it belongs in the output of the command
// that gives it up - not only in the run before.
const lines = x => [...(x.rel && x.rel.length ? ['RELEASED by --release ' + x.rel.join(' ') + ', was held for:'] : []),
  ...x.why, ...x.note].map(w => '             ' + w).join('\n');
const said = x => x.note.length || x.why.length;
if (hold.length) {
  console.log('EXPENSIVE TO REMAKE - worth a look before it goes (' + gb(tot(hold)) + ')');
  for (const x of hold.sort((a, b) => b.size - a.size))
    console.log('  ' + gb(x.size).padStart(9) + '  ' + basename(x.p) + '\n' + lines(x));
  console.log('  move any of these into keep/ to protect it - this list does not\n');
}
if (refused.length) {
  console.log('REFUSED - left alone, nothing was verified about them');
  for (const [p, why] of refused) console.log('  ' + basename(p) + '\n             ' + why);
  console.log('');
}
console.log('SWEEP - harvested, verified, safe to remove (' + gb(tot(sweep)) + ', ' + sweep.length + ' files)');
const rows = sweep.sort((a, b) => b.size - a.size);
for (const x of rows.slice(0, 12))
  console.log('  ' + gb(x.size).padStart(9) + '  ' + basename(x.p) + (said(x) ? '\n' + lines(x) : ''));
if (rows.length > 12) console.log('  ... and ' + (rows.length - 12) + ' more');
// EVERY NOTE PRINTS, wherever the file sits in the list. Demoting a rarity test stopped it HOLDING a
// file back; it was never meant to stop it being SAID, and a last-of-its-kind is worth reading as it
// goes. A note below the twelfth row used to be invisible for no reason but sort order.
const tail = rows.slice(12).filter(said);
if (tail.length) {
  console.log('\n  further down the list, carrying a note:');
  for (const x of tail) console.log('  ' + gb(x.size).padStart(9) + '  ' + basename(x.p) + '\n' + lines(x));
}

if (!GO) { console.log('\nnothing deleted. pass --go to remove the sweep list.\n'); process.exit(0); }

let freed = 0, gone = 0;
for (const x of sweep) {
  // CHECKED AGAIN AT THE MOMENT OF DELETION, not once at the top. The sidecar is about to become the
  // only copy of this render; if it is not on disk and whole RIGHT NOW, the master stays.
  let block = null; try { block = findMeta(x.p); } catch (_) { block = null; }
  if (!block || verify(x.p, block)) { console.log('KEPT (failed the second check): ' + basename(x.p)); continue; }
  unlinkSync(x.p); freed += x.size; gone++;
}
console.log('\n' + gone + ' removed, ' + gb(freed) + ' reclaimed.\n');

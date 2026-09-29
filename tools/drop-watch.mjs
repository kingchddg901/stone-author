// WHAT ARRIVED, WHEN, AND HOW BIG. The companion to .claude/tools/smb-watch.ps1, which needs
// Administrator to read the client IP. This needs nothing: it watches the landing folders and writes
// down every file that appears and stops growing. If the elevated watcher is not running, this is the
// whole record.
//
// A file is recorded once its size has held steady across two polls. A copy in flight would otherwise be
// logged at whatever length it had reached, which is indistinguishable from a truncated transfer - and
// three files were briefly reported as having no metadata for exactly that reason.
//
//   node tools/drop-watch.mjs <dir> [...] --out drops.jsonl
//
// NO REGEXES FOR PATHS. The first version split on /[\\/]/ written through a shell heredoc, one
// backslash was eaten, and it shipped as /[\/]/ - which matches a forward slash and nothing else. Node's
// join() produces backslashes on Windows, so every path came out unsplit: `folder` logged as null and
// `name` logged as the whole relative path, for 185 arrivals, silently. Character comparison below.
import { readdirSync, statSync, appendFileSync, existsSync } from 'fs';
import { join } from 'path';

const NL = String.fromCharCode(10);
const SLASH = String.fromCharCode(47), BACKSLASH = String.fromCharCode(92);

const splitPath = p => {
  const out = [];
  let cur = '';
  for (const c of p) {
    if (c === SLASH || c === BACKSLASH) { if (cur) out.push(cur); cur = ''; }
    else cur += c;
  }
  if (cur) out.push(cur);
  return out;
};

const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const OUT = oi >= 0 ? args[oi + 1] : 'drops.jsonl';
// oi is -1 when --out is absent, and -1 + 1 is 0, which would drop the FIRST directory. The same
// off-by-one is written up in meta-index.mjs and was reproduced in sort-drops.mjs before being caught.
const skip = oi >= 0 ? oi + 1 : -1;
const DIRS = args.filter((a, i) => !a.startsWith('--') && i !== skip);
if (!DIRS.length) { console.error('usage: node tools/drop-watch.mjs <dir> [...] --out <file>'); process.exit(2); }

const say = o => appendFileSync(OUT, JSON.stringify(o) + NL);
const seen = new Map();
const settled = new Set();

function walk(dir, depth) {
  if (depth > 3 || !existsSync(dir)) return [];
  const out = [];
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, depth + 1));
    else if (!e.name.startsWith('.')) out.push(p);
  }
  return out;
}

say({ t: new Date().toISOString(), event: 'start', dirs: DIRS });
console.log('drop-watch -> ' + OUT + NL + '  watching: ' + DIRS.join(', '));

setInterval(() => {
  for (const d of DIRS) {
    for (const p of walk(d, 0)) {
      let st; try { st = statSync(p); } catch (e) { continue; }
      const prev = seen.get(p);
      seen.set(p, st.size);
      if (settled.has(p)) continue;
      if (prev === undefined) continue;                  // first sighting: it may still be growing
      if (prev !== st.size) continue;                    // still growing
      settled.add(p);
      // The landing FOLDER is the provenance for a file whose own metadata is missing or wrong, so it
      // is recorded as its own field: a later merge into one directory destroys it.
      const parts = splitPath(p);
      const rec = { t: new Date().toISOString(), event: 'arrived', path: p,
        name: parts[parts.length - 1] || p,
        folder: parts.length > 1 ? parts[parts.length - 2] : null,
        bytes: st.size, mtime: st.mtime.toISOString() };
      say(rec);
      console.log('  ' + rec.name + '  ' + (st.size / 1048576).toFixed(1) + ' MB  -> ' + rec.folder);
    }
  }
}, 2500);

// SORT A PILE OF MASTERS BY WHAT THEY SAY ABOUT THEMSELVES.
//
// A dump off several devices arrives in whatever folders a person managed to aim it at, with filenames
// that carry an engine and a date and nothing else. Two Samsung tablets both report as `android-chrome`
// and their files are indistinguishable by name. The metadata is not: cores, reported memory, device
// pixel ratio and the planner's own budget identify which machine made a file, and they were written by
// that machine at render time rather than chosen by hand afterwards.
//
// So this trusts the metadata and treats the landing folder as a CLAIM to be checked against it. Where
// they disagree the metadata wins and the disagreement is printed, because a misfiled master is exactly
// the kind of error that survives into a published table.
//
//   node tools/sort-drops.mjs <dir> [...]
//   node tools/sort-drops.mjs <dir> [...] --against <dir>    also report what is already there
//
// A file with no metadata block is reported, never guessed at. A file still being copied looks exactly
// like a file with no metadata, so size is sampled twice and anything growing is held back rather than
// judged.
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { findMeta } from './lib/find-meta.mjs';

const NL = String.fromCharCode(10);
const args = process.argv.slice(2);
const ai = args.indexOf('--against');
const AGAINST = ai >= 0 ? args[ai + 1] : null;
// ai is -1 when --against is absent, and -1 + 1 is 0, which drops the FIRST directory. The same
// off-by-one is written up in meta-index.mjs, where it was found the first time.
const skip = ai >= 0 ? ai + 1 : -1;
const DIRS = args.filter((a, i) => !a.startsWith('--') && i !== skip);
if (!DIRS.length) {
  console.error('usage: node tools/sort-drops.mjs <dir> [...] [--against <dir>]');
  process.exit(2);
}

// The fleet, keyed on what a master actually records. `cores` is the discriminator that matters most:
// the A7 Lite is an octa-core Helio P22T and the Tab A 8.0 a quad-core Snapdragon 429, and it is the
// only field that separates them - both report 2 GB, both report the same pixel ratio.
// The FILENAME is a weaker witness than the file. Forty masters here predate the `engine` field but
// were named with it, so the name is used only when the metadata is silent - and the basis is carried
// through to the output, because "the file says so" and "the name says so" are not the same claim.
function engineOf(m, name) {
  if (m.engine) return { engine: m.engine, from: 'file' };
  for (const e of ['win-chrome', 'win-firefox', 'linux-chrome', 'linux-firefox', 'ios-safari',
                   'android-chrome', 'android-firefox'])
    if (name.includes('-' + e + '-')) return { engine: e, from: 'name' };
  return { engine: '', from: 'nothing' };
}

function identify(m, name) {
  const eo = engineOf(m, name || '');
  const e = eo.engine;
  const tag = t => eo.from === 'name' ? t + ', from the NAME' : t;
  if (e.startsWith('win-')) return { device: 'desktop', why: tag(e), from: eo.from };
  if (e.startsWith('linux-')) return { device: 'linux box', why: tag(e), from: eo.from };
  if (e === 'ios-safari') return { device: 'iPhone 14 Pro', why: tag('ios-safari'), from: eo.from };
  if (e.startsWith('android-')) {
    if (m.cores === 4) return { device: 'Tab A 8.0', why: 'cores 4', from: 'file' };
    if (m.cores === 8 && m.mem === 8) return { device: 'S23 Ultra', why: 'cores 8, mem 8', from: 'file' };
    if (m.cores === 8 && m.mem === 2) return { device: 'A7 Lite', why: 'cores 8, mem 2', from: 'file' };
    if (m.cores === 8 && m.mem === null) return { device: 'S23 Ultra', why: 'cores 8, Gecko reports no mem', from: 'file' };
    return { device: 'an Android' + (eo.from === 'name' ? ' (only the name says so)' : '') + ' device', why: 'cores ' + m.cores + ', mem ' + m.mem, from: eo.from };
  }
  return { device: null, why: 'no engine in the file OR the name', from: 'nothing' };
}

const PUBLISHED = { a98ab1f5: 'black light', '2259e26a': 'daylight' };

function collect(dir) {
  const out = [];
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { out.push(...collect(p)); continue; }
    if (e.name.startsWith('.')) continue;
    // A master, not everything in the folder. Same test meta-index uses.
    if (!/^stone-.*[.](tif|tiff|png|zip)$/i.test(e.name)) continue;
    let st; try { st = statSync(p); } catch (_) { continue; }
    out.push({ path: p, name: e.name, size: st.size, folder: dir.split(/[\\/]/).pop() });
  }
  return out;
}

// A file being copied is indistinguishable from a file with no metadata. Sample twice.
async function settle(files) {
  const first = files.map(f => f.size);
  await new Promise(r => setTimeout(r, 4000));
  return files.map((f, i) => {
    let now = f.size;
    try { now = statSync(f.path).size; } catch (_) {}
    return { ...f, size: now, growing: now !== first[i] };
  });
}

const files = await settle(DIRS.flatMap(d => collect(d)));

const rows = [], noMeta = [], inFlight = [];
for (const f of files) {
  if (f.growing) { inFlight.push(f); continue; }
  let m = null; try { m = findMeta(f.path); } catch (_) {}
  if (!m) { noMeta.push(f); continue; }
  const id = identify(m, f.name);
  const tiles = m.perTile && m.perTile.ms ? m.perTile.ms.length : null;
  rows.push({ ...f, m, id, tiles,
    light: m.spectrum === 0 ? 'daylight' : 'black light',
    slab: PUBLISHED[m.inputs] ? 'published' : m.inputs,
    at: m.at, mins: m.ms && m.ms.render ? m.ms.render / 60000 : null,
    mean: m.light && m.light.mean });
}

// ---- by device, metadata first ----
const byDev = new Map();
for (const r of rows) {
  const k = r.id.device || 'unidentified';
  if (!byDev.has(k)) byDev.set(k, []);
  byDev.get(k).push(r);
}
console.log('SORTED BY WHAT THE FILE SAYS IT IS' + NL);
for (const [dev, list] of [...byDev].sort((a, b) => b[1].length - a[1].length)) {
  console.log(dev + '   ' + list.length + ' file' + (list.length === 1 ? '' : 's') +
    '   (' + list[0].id.why + ')');
  list.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  for (const r of list) {
    console.log('    ' + r.name.slice(0, 46).padEnd(47) +
      (r.size / 1048576).toFixed(0).padStart(4) + ' MB  ' +
      (r.tiles ? String(r.tiles) : '?').padStart(5) + ' tiles  ' +
      (r.mins !== null ? r.mins.toFixed(1) + ' min' : '?').padStart(9) + '  ' +
      r.light.padEnd(11) + ' ' + (r.slab === 'published' ? 'published slab' : 'slab ' + r.slab));
  }
  console.log('');
}

// ---- where the folder disagrees with the file ----
const FOLDER_TO_DEVICE = { 'iphone-14-pro': 'iPhone 14 Pro', 's23-ultra': 'S23 Ultra',
  'tab-a-8': 'Tab A 8.0', 'a7-lite': 'A7 Lite' };
const wrong = rows.filter(r => FOLDER_TO_DEVICE[r.folder] && r.id.device &&
  FOLDER_TO_DEVICE[r.folder] !== r.id.device);
if (wrong.length) {
  console.log('MISFILED - the folder says one device, the file says another:' + NL);
  for (const r of wrong)
    console.log('  ' + r.name.slice(0, 50).padEnd(51) + 'in ' + r.folder.padEnd(15) +
      ' but reports ' + r.id.device + '  (' + r.id.why + ')');
  console.log('');
} else if (rows.length) {
  console.log('Every file agrees with the folder it landed in.' + NL);
}

// ---- duplicates, matched on the render rather than the name ----
const key = r => r.at + '|' + r.m.inputs + '|' + (r.m.ms && r.m.ms.render);
const byKey = new Map();
for (const r of rows) { if (!byKey.has(key(r))) byKey.set(key(r), []); byKey.get(key(r)).push(r); }
const dupes = [...byKey.values()].filter(v => v.length > 1);
if (dupes.length) {
  // WHICH COPY TO KEEP. Prefer the one already in the long-term folder, then the largest - a short
  // copy is a truncated transfer, and picking by name would pick the one with a -2 suffix as often
  // as not. Nothing is deleted here; this only says what could be.
  let reclaim = 0, n = 0;
  console.log('THE SAME RENDER, MORE THAN ONE COPY' + NL);
  for (const g of dupes) {
    const keep = g.slice().sort((a, b) => {
      const ai = a.path.includes('render-ingest') ? 0 : 1, bi = b.path.includes('render-ingest') ? 0 : 1;
      return ai - bi || b.size - a.size;
    })[0];
    console.log('  ' + (keep.m.engine || '?') + '  ' + keep.light + '  ' + (keep.tiles || '?') +
      ' tiles  ' + (keep.mins !== null ? keep.mins.toFixed(1) + ' min' : '?') +
      '   rendered ' + String(keep.at).slice(0, 19));
    for (const r of g) {
      const same = r === keep;
      if (!same) { reclaim += r.size; n++; }
      console.log('      ' + (same ? 'KEEP  ' : 'spare ') + r.path.replace(/^.*Downloads[\/]/, '') +
        '  ' + (r.size / 1048576).toFixed(0) + ' MB' +
        (!same && r.size !== keep.size ? '   DIFFERENT SIZE - check before deleting' : ''));
    }
    console.log('');
  }
  console.log('  ' + n + ' spare cop' + (n === 1 ? 'y' : 'ies') + ', ' +
    (reclaim / 1073741824).toFixed(2) + ' GB reclaimable' + NL);
}

// Total footprint, by slab, so the cleanup question is answerable.
const bySlab = new Map();
for (const r of rows) {
  const k = r.slab === 'published' ? 'the published slab' : 'slab ' + r.slab;
  if (!bySlab.has(k)) bySlab.set(k, { n: 0, bytes: 0 });
  const e = bySlab.get(k); e.n++; e.bytes += r.size;
}
console.log('FOOTPRINT BY SLAB - only the published slab is comparable to anything' + NL);
for (const [k, v] of [...bySlab].sort((a, b) => b[1].bytes - a[1].bytes))
  console.log('  ' + k.padEnd(24) + String(v.n).padStart(3) + ' files  ' +
    (v.bytes / 1073741824).toFixed(2).padStart(6) + ' GB');
console.log('  ' + 'TOTAL'.padEnd(24) + String(rows.length).padStart(3) + ' files  ' +
  (rows.reduce((a, r) => a + r.size, 0) / 1073741824).toFixed(2).padStart(6) + ' GB' + NL);

if (AGAINST) {
  const have = new Map();
  for (const f of collect(AGAINST)) {
    let m = null; try { m = findMeta(f.path); } catch (_) {}
    if (m) have.set(m.at + '|' + m.inputs + '|' + (m.ms && m.ms.render), f.name);
  }
  const already = rows.filter(r => have.has(key(r)));
  console.log('ALREADY IN ' + AGAINST + ': ' + already.length + ' of ' + rows.length + NL);
  for (const r of already)
    console.log('  ' + r.name.slice(0, 50).padEnd(51) + 'same render as ' + have.get(key(r)));
  const fresh = rows.length - already.length;
  console.log(NL + fresh + ' file' + (fresh === 1 ? '' : 's') + ' in the dump are NOT already there.');
}

console.log(NL + '----');
console.log(rows.length + ' identified, ' + noMeta.length + ' with no metadata, ' +
  inFlight.length + ' still copying');
for (const f of inFlight) console.log('  still copying  ' + f.folder + '/' + f.name +
  '  ' + (f.size / 1048576).toFixed(0) + ' MB');
for (const f of noMeta) console.log('  NO METADATA    ' + f.folder + '/' + f.name +
  '  ' + (f.size / 1048576).toFixed(0) + ' MB');

// THE DATA FROM A MASTER, WITHOUT THE MASTER. Thirteen gigabytes of pixels carry about a third of a
// megabyte of evidence, and it is the third of a megabyte that is checkable: a reader who renders the
// same slab themselves compares metadata to metadata and never needs the file. Publishing the masters
// would only let them checksum a download, which proves the file was not edited — not that the renderer
// does what it claims. Withholding them makes the claim falsifiable in the useful direction.
//
//   node tools/meta-index.mjs <file|dir> [...]                 print the table, write nothing
//   node tools/meta-index.mjs <file|dir> [...] --out <dir>     write sidecars + index.json + index.md
//
// JSON IS THE SOURCE OF TRUTH AND THE TABLE IS DOWNSTREAM OF IT. buildTable is handed rows re-read from
// index.json and never touches a master, so a published table cannot say anything the published JSON
// does not. That split is the whole point, and tools/check-meta-index.mjs holds it.
import { readdirSync, statSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, basename, extname } from 'path';
import { findMeta } from './lib/find-meta.mjs';

const NL = String.fromCharCode(10);
const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const OUT = outAt >= 0 ? args[outAt + 1] : null;
// outAt is -1 when --out is absent, and -1 + 1 is 0, which silently dropped the FIRST target.
const skipIdx = outAt >= 0 ? outAt + 1 : -1;
const targets = args.filter((a, i) => !a.startsWith('--') && i !== skipIdx);
if (!targets.length) {
  console.error('usage: node tools/meta-index.mjs <file|dir> [...] [--out <dir>]');
  process.exit(1);
}

const MASTER = /^stone-.*[.](tif|tiff|png|zip)$/i;
function walk(p, into) {
  if (statSync(p).isDirectory()) {
    for (const n of readdirSync(p)) if (MASTER.test(n)) walk(join(p, n), into);
    return into;
  }
  into.push(p);
  return into;
}

// ONE ROW PER MASTER, flattened to what a stranger can check against their own render. The untouched
// block goes to the sidecar; this is the part that answers "did your engine land where mine did".
function row(path, m) {
  const w = m.w || 0, h = m.h || 0;
  const t = m.perTile && m.perTile.ms ? m.perTile.ms : null;
  const median = t && t.length ? [...t].sort((a, b) => a - b)[t.length >> 1] : null;
  const or = v => (v === undefined ? null : v);
  return {
    file: basename(path),
    build: or(m.build),                     // absent on every master before 2026.09.27.23
    inputs: or(m.inputs),                   // the picture signature: same value = same picture and light
    slab: or(m.slab),
    w, h,
    gigapixels: w && h ? +((w * h) / 1e9).toFixed(3) : null,
    spectrum: or(m.spectrum),
    engine: or(m.engine),
    glowRule: or(m.glowRule),               // WHICH engine line produced the lift, not merely its value
    glowLift: or(m.glowLift),
    glowAuto: !!m.glowAuto,
    bloomDraw: !!m.bloomDraw,
    bleed: or(m.bleed),
    sigma: or(m.sigma),
    storeTile: or(m.tile),
    renderTile: or(m.render),
    tiles: or(m.tiles),
    lightMean: m.light ? m.light.mean : null,
    lit40: m.light ? m.light.lit40 : null,
    renderMs: m.ms ? or(m.ms.render) : null,
    tileMedianMs: median,
    cores: or(m.cores),
    arch: or(m.arch),
    memoryGB: or(m.mem),
    dpr: or(m.dpr),
    maxTexture: or(m.maxTexture),
    bytes: (() => { try { return statSync(path).size; } catch (_) { return null; } })(),
  };
}

const dash = v => (v === null || v === undefined ? '-' : String(v));
const padL = (v, n) => dash(v).padStart(n);
const padR = (v, n) => dash(v).padEnd(n);

// HANDED ROWS, NEVER A PATH. If this ever reads a master the table stops being a view of the published
// data and becomes a second source nobody can check against it.
function buildTable(rows) {
  const head = ['file', 'width', 'light', 'lit>40', 'spectrum', 'engine', 'rule', 'lift', 'from', 'bleed', 'tile', 'inputs', 'build'];
  const wid = [45, 6, 6, 6, 8, 14, 6, 6, 4, 5, 5, 8, 14];
  const out = [];
  out.push(head.map((h, i) => (i ? padL(h, wid[i]) : padR(h, wid[i]))).join('  '));
  out.push(wid.map(n => '-'.repeat(n)).join('  '));
  const sorted = [...rows].sort((a, b) =>
    (a.w - b.w) || dash(a.spectrum).localeCompare(dash(b.spectrum)) ||
    dash(a.engine).localeCompare(dash(b.engine)) || dash(a.file).localeCompare(dash(b.file)));
  for (const r of sorted) {
    out.push([
      padR(r.file, wid[0]),
      padL(r.w, wid[1]),
      padL(r.lightMean === null ? null : r.lightMean.toFixed(2), wid[2]),
      padL(r.lit40 === null ? null : r.lit40.toFixed(2), wid[3]),
      padL(r.spectrum === -1 ? 'black' : r.spectrum === 0 ? 'daylight' : r.spectrum, wid[4]),
      padL(r.engine, wid[5]),
      padL(r.glowRule, wid[6]),
      padL(r.glowLift, wid[7]),
      padL(r.glowLift === null ? null : (r.glowAuto ? 'auto' : 'set'), wid[8]),
      padL(r.bleed, wid[9]),
      padL(r.renderTile, wid[10]),
      padL(r.inputs, wid[11]),
      padL(r.build, wid[12]),
    ].join('  '));
  }
  return out.join(NL);
}

// WHAT THIS HAS BEEN PROVEN TO RUN ON. Also handed rows, never a path - the coverage claim has to be a
// view of the published data for the same reason the table is. A hardware CLASS, never an identity:
// the device identity is sealed, and these fields are the ones a master carries in the clear.
// THE ONE FILE THIS TOOL DOES NOT GENERATE. devices.json in the OUTPUT folder carries what only a human
// knows: the real models behind each hardware class, their published specs, and the conditions a run was
// made under. A master seals its identity by design, so none of it can be derived. Regenerating must not
// destroy it, which is why it is READ from the output folder and never written there.
function loadDevices(dir) {
  if (!dir) return [];
  try { return JSON.parse(readFileSync(join(dir, 'devices.json'), 'utf8')).devices || []; }
  catch (_) { return []; }                        // absent is normal: the tables just say (unmapped)
}
function deviceFor(list, r) {
  for (const d of list) {
    let hit = true;
    for (const k of Object.keys(d.match || {})) if (r[k] !== d.match[k]) { hit = false; break; }
    if (hit) return d;
  }
  return null;
}
function specSheet(known) {
  if (!known.length) return '';
  const seen = new Set(), out = [NL + '## The devices behind those classes' + NL];
  out.push('From `devices.json`, maintained by hand: a master seals its identity, so none of this can be');
  out.push('derived from the data above.' + NL);
  for (const d of known) {
    if (seen.has(d.name + d.model)) continue;
    seen.add(d.name + d.model);
    out.push('### ' + d.name + (d.model ? '  (' + d.model + ')' : ''));
    for (const [label, k] of [['SoC', 'soc'], ['GPU', 'gpu'], ['RAM', 'ram'],
                              ['Storage', 'storage'], ['Display', 'display'], ['OS', 'os'],
                              ['Sender IP', 'ip'], ['Model read from the seal', 'sealed_model']])
      if (d[k]) out.push('- **' + label + '** ' + d[k]);
    if (d.note) out.push(NL + d.note);
    out.push('');
  }
  return out.join(NL);
}
function buildDevices(rows, known) {
  const by = new Map();
  for (const r of rows) {
    if (!r.engine) continue;
    const k = [r.engine, r.arch || String.fromCharCode(45), r.cores, r.memoryGB === null ? String.fromCharCode(45) : r.memoryGB,
               r.dpr === null ? String.fromCharCode(45) : Number(r.dpr).toFixed(3), r.maxTexture].join(String.fromCharCode(124));
    if (!by.has(k)) by.set(k, { n: 0, maxW: 0, tiles: new Set(), sample: r });
    const e = by.get(k);
    e.n++;
    if (r.w > e.maxW) e.maxW = r.w;
    if (r.renderTile) e.tiles.add(r.renderTile);
  }
  const head = ["device", "engine", "cores", "mem GB", "dpr", "maxTexture", "masters", "largest", "render tiles"];
  const wid = [26, 16, 6, 7, 7, 11, 8, 9, 26];
  const out = [head.map((h, i) => (i ? padL(h, wid[i]) : padR(h, wid[i]))).join("  "),
               wid.map(n => "-".repeat(n)).join("  ")];
  for (const [k, e] of [...by.entries()].sort()) {
    const f = k.split(String.fromCharCode(124));
    const d = deviceFor(known, e.sample);
    out.push([padR(d ? d.name : "(unmapped)", wid[0]), padL(f[0], wid[1]), padL(f[2], wid[2]), padL(f[3], wid[3]),
              padL(f[4], wid[4]), padL(f[5], wid[5]), padL(e.n, wid[6]), padL(e.maxW, wid[7]),
              padL([...e.tiles].sort((a, b) => a - b).join(", "), wid[8])].join("  "));
  }
  out.push("");
  // CLASSES OVERCOUNT DEVICES, and a reader will take the number as machines. One tablet reports its
  // texture limit on some runs and not on others; the desktop appears at two display scalings. Both
  // splits are findings in themselves, so the table keeps them and the count states the difference.
  const names = new Set();
  for (const e of by.values()) { const d = deviceFor(known, e.sample); if (d) names.add(d.name + '|' + d.model); }
  out.push("distinct hardware classes: " + by.size +
    (names.size ? "   physical devices behind them: " + names.size : ""));
  return out.join(NL);
}

const files = [];
for (const t of targets) walk(t, files);
const rows = [], skipped = [], blocks = new Map();
for (const f of files) {
  let m = null;
  try { m = findMeta(f); } catch (e) { skipped.push([f, String(e.message || e)]); continue; }
  if (!m) { skipped.push([f, 'no metadata block']); continue; }
  rows.push(row(f, m));
  blocks.set(f, m);
}

const known = loadDevices(OUT);
if (OUT) {
  mkdirSync(OUT, { recursive: true });
  const seen = new Map();
  let wrote = 0;
  for (const [f, m] of blocks) {
    const name = basename(f, extname(f)) + '.json';
    // A .tif and the .zip wrapping it share a stem, and the second write would silently replace the
    // first. Same block is fine; a different one means two masters are about to collapse into one row.
    const text = JSON.stringify(m, null, 2);
    if (seen.has(name) && seen.get(name) !== text) {
      console.error('REFUSED: ' + name + ' would be written twice with different contents');
      process.exit(1);
    }
    seen.set(name, text);
    const at = join(OUT, name);
    writeFileSync(at, text);
    // READ IT BACK BEFORE CLAIMING IT. A sidecar that does not reparse to the block it came from is
    // worse than no sidecar: it is evidence that disagrees with its master, and nothing would say so.
    if (JSON.stringify(JSON.parse(readFileSync(at, 'utf8'))) !== JSON.stringify(m)) {
      console.error('REFUSED: ' + name + ' did not read back identical to the block in ' + basename(f));
      process.exit(1);
    }
    wrote++;
  }
  writeFileSync(join(OUT, 'index.json'), JSON.stringify(rows, null, 2));
  // Built from what index.json HOLDS, re-read from disk - so the table is provably a view of the file
  // that is published beside it, not of the masters that are not.
  const published = JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8'));
  writeFileSync(join(OUT, 'index.md'),
    '# Masters, as they describe themselves' + NL + NL +
    'Extracted from each master by `findMeta` in `tools/tiff-meta.mjs`, written by' + NL +
    '`tools/meta-index.mjs`. `index.json` is the source of truth; this table is a view of it.' + NL +
    'The masters themselves are not published — render the slab yourself and compare.' + NL + NL +
    '```' + NL + buildTable(published) + NL + '```' + NL + NL +
    '## Proven to run on' + NL + NL +
    'Hardware CLASS, in the clear on every master. The device identity is sealed and is not here.' + NL + NL +
    '```' + NL + buildDevices(published, known) + NL + '```' + NL + specSheet(known));
  console.log('wrote ' + wrote + ' sidecar(s), index.json (' + published.length + ' rows) and index.md to ' + OUT);
} else {
  console.log(buildTable(rows));
}
if (skipped.length) {
  console.log(NL + 'skipped ' + skipped.length + ':');
  for (const [f, why] of skipped) console.log('  ' + basename(f) + '  ' + why);
}

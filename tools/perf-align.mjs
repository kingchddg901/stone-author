// LINE A MASTER'S PER-TILE TIMINGS UP AGAINST WHAT THE MACHINE WAS DOING.
//
// A master records perTile.ms - one duration per tile - which says WHEN a tile was slow and never why.
// One tile on an S23 took 38 seconds against a 52 ms median, and nothing in the file could distinguish a
// GC pause from a thermal step from another program. tools/perfmon.ps1 writes a timestamped system trace;
// this aligns the two.
//
// Tile k's end = (at - ms.render) + sum(perTile.ms[0..k]), because `at` is stamped by expMeta when the
// metadata is WRITTEN, which is after the last tile. That only works for a render on THIS machine: a
// phone's clock is its own, so the trace and the master would be in different time bases.
//
//   node tools/perf-align.mjs <master.tif> <perf.jsonl> [--top 12]
import { readFileSync } from 'fs';
import { findMeta } from './lib/find-meta.mjs';

const [file, perfFile] = process.argv.slice(2);
if (!file || !perfFile) { console.error('usage: node tools/perf-align.mjs <master.tif> <perf.jsonl> [--top N]'); process.exit(2); }
const topN = +((process.argv.find(a => a.startsWith('--top=')) || '').split('=')[1] || 12);

const m = findMeta(file);
if (!m) { console.error('no metadata block in ' + file); process.exit(2); }
const ms = m.perTile && m.perTile.ms;
if (!ms || !ms.length) { console.error('this master carries no per-tile timings'); process.exit(2); }

const endMs = Date.parse(m.at);
const total = (m.ms && m.ms.render) || ms.reduce((a, b) => a + b, 0);
const startMs = endMs - total;

const samples = readFileSync(perfFile, 'utf8').split(String.fromCharCode(10))
  .filter(l => l.trim()).map(l => { try { return JSON.parse(l); } catch (_) { return null; } })
  .filter(Boolean).map(s => ({ ...s, ts: Date.parse(s.t) })).sort((a, b) => a.ts - b.ts);
if (!samples.length) { console.error('no usable samples in ' + perfFile); process.exit(2); }

const near = t => {
  let best = null, bd = Infinity;
  for (const s of samples) { const d = Math.abs(s.ts - t); if (d < bd) { bd = d; best = s; } }
  return bd <= 8000 ? best : null;                          // no sample within 8s: say so rather than guess
};

// cumulative end time per tile
const ends = new Array(ms.length);
let acc = 0;
for (let i = 0; i < ms.length; i++) { acc += ms[i]; ends[i] = startMs + acc; }

const sorted = ms.slice().sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
const covered = samples.filter(s => s.ts >= startMs && s.ts <= endMs).length;

console.log(file.split(/[\/]/).pop());
console.log('  ' + m.w + ' x ' + m.h + ', tile ' + m.tile + ', ' + ms.length + ' tiles, ' + (total / 60000).toFixed(2) + ' min');
console.log('  render ran ' + new Date(startMs).toISOString() + '  ->  ' + m.at);
console.log('  trace has ' + samples.length + ' samples, ' + covered + ' of them inside the render');
if (!covered) { console.log(String.fromCharCode(10) + '  THE TRACE DOES NOT OVERLAP THE RENDER - nothing to align.'); process.exit(1); }
console.log();

const fmt = s => s ? ['cpu ' + String(s.cpu).padStart(5), 'freeMB ' + String(s.availMB).padStart(5),
  'diskW ' + String(s.diskWrMBs).padStart(6), s.browser ? s.browser.name + ' ' + Math.round(s.browser.totalMB) + 'MB' : ''].join('  ') : '(no sample within 8s)';

const idx = ms.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, topN);
console.log('  THE ' + topN + ' SLOWEST TILES  (median ' + median + ' ms)');
for (const [v, i] of idx) {
  const s = near(ends[i]);
  console.log('    tile ' + String(i).padStart(6) + '  ' + String(v).padStart(7) + ' ms = ' + (v / median).toFixed(1).padStart(6) + 'x median   ' + fmt(s));
}
console.log();

// is slowness associated with anything the machine was doing?
const slowSet = new Set(idx.map(([, i]) => i));
const pick = want => {
  const out = { cpu: [], availMB: [], diskWrMBs: [] };
  for (let i = 0; i < ms.length; i++) {
    if (want !== slowSet.has(i)) continue;
    const s = near(ends[i]); if (!s) continue;
    for (const k of Object.keys(out)) if (typeof s[k] === 'number') out[k].push(s[k]);
  }
  return out;
};
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const slow = pick(true), rest = pick(false);
console.log('  MACHINE STATE, slowest tiles vs the rest');
for (const k of ['cpu', 'availMB', 'diskWrMBs']) {
  const a = avg(slow[k]), b = avg(rest[k]);
  const note = (isNaN(a) || isNaN(b)) ? '' : (Math.abs(a - b) > Math.abs(b) * 0.25 ? '   <-- differs' : '');
  console.log('    ' + k.padEnd(12) + 'slow ' + (isNaN(a) ? 'n/a' : a.toFixed(1)).padStart(8) + '    rest ' + (isNaN(b) ? 'n/a' : b.toFixed(1)).padStart(8) + note);
}

// What a master says about itself. Every TIFF and PNG the studio writes carries a JSON block describing
// the render that made it, and this prints it without decoding a pixel — so it answers "what was this,
// and where did the time go" in milliseconds rather than the minutes audit-tiff.mjs needs to inflate
// every tile. Works on a .tif, or on the .zip the artifact runtime wraps one in, because the block is
// found by scanning rather than by parsing a container.
//
// The pairing is the point. A slow master has two possible causes that look identical from the outside:
// the picture was dense, or the machine was stalling. perTile.ms against perTile.bytes separates them —
// time that tracks bytes is content, time that spikes where bytes did not is the machine.
//
//   node tools/tiff-meta.mjs <file> [file...]
//   node tools/tiff-meta.mjs --rename <file> [file...]        what it WOULD rename, changing nothing
//   node tools/tiff-meta.mjs --rename --go <file> [file...]   do it
import { openSync, readSync, closeSync, statSync, existsSync, renameSync } from 'fs';

const WINDOW = 4 << 20;                                  // the block sits in the IFD tail; head is a fallback
const RE = /\{"tool":"stone-author"[\s\S]*/;

function findMeta(path) {
  const fd = openSync(path, 'r');
  try {
    const size = statSync(path).size;
    for (const off of [Math.max(0, size - WINDOW), 0]) {
      const len = Math.min(WINDOW, size - off);
      const b = Buffer.alloc(len);
      readSync(fd, b, 0, len, off);
      const m = RE.exec(b.toString('latin1'));
      if (!m) continue;
      for (let cut = Math.min(m[0].length, 1 << 16); cut > 40; cut--) {   // the block is not delimited
        try { return JSON.parse(m[0].slice(0, cut)); } catch (_) {}
      }
    }
    return null;
  } finally { closeSync(fd); }
}

const num = n => n.toLocaleString('en-GB');
const secs = ms => (ms / 1000 < 90 ? (ms / 1000).toFixed(1) + ' s' : (ms / 60000).toFixed(1) + ' min');
const median = a => { const s = [...a].sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const baseOf = p => p.replace(/\\/g, '/').split('/').pop();
const dirOf = p => { const q = p.replace(/\\/g, '/'); const i = q.lastIndexOf('/'); return i < 0 ? '.' : q.slice(0, i); };

function correlate(a, b) {                               // Pearson, to say whether time followed content
  const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let sab = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; sa += da * da; sb += db * db; }
  return sa && sb ? sab / Math.sqrt(sa * sb) : null;
}

const lightOf = m => m.spectrum === 0 ? 'day' : m.spectrum === -1 ? 'uv'
  : 'spx' + String(Math.round(m.spectrum * 100)).replace('-', 'm');

function engineOf(m) {
  const u = m.ua || '';
  const plat = /Android/.test(u) ? 'android' : /iPhone|iPad|iPod/.test(u) ? 'ios'
    : /Windows/.test(u) ? 'win' : /Mac OS X/.test(u) ? 'mac' : /Linux|X11/.test(u) ? 'linux' : 'web';
  // Order is load-bearing: every Chromium engine also claims Safari, and Edge and Opera also claim Chrome.
  const eng = /Firefox\//.test(u) ? 'firefox' : /Edg\//.test(u) ? 'edge' : /OPR\/|Opera/.test(u) ? 'opera'
    : /Chrome\//.test(u) ? 'chrome' : /Safari\//.test(u) ? 'safari' : 'other';
  return plat + '-' + eng;
}

// A HAND-GIVEN NAME WINS. Renaming only ever tidies up after the app, so a file is a candidate while it
// still carries a name the app itself produced — the old default (the slab stem, or "stone", then the
// width) or the current scheme. "Chrome Hero UV-65535.tif" records something a machine cannot recover,
// and is left exactly as it is.
function appNamed(base, m) {
  const stems = ['stone'];
  if (m.slab) stems.push(m.slab);
  for (const stem of stems) {
    const esc = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // A trailing -2, -3 ... is the save server's collision suffix, not a judgement someone typed.
    if (new RegExp('^' + esc + '-' + m.w + '(-\\d+)?\\.[a-z0-9]+$', 'i').test(base)) return 'the old default';
    if (new RegExp('^' + esc + '-' + m.w + '-[a-z0-9]+-[a-z]+-[a-z]+-\\d{4}-\\d{6}(-\\d+)?\\.[a-z0-9]+$', 'i').test(base)) return 'the current scheme';
  }
  return null;
}

function canonical(base, m) {
  const ext = (base.match(/\.[a-z0-9]+$/i) || ['.tif'])[0];
  let stem = m.slab;
  if (!stem) { const cut = base.indexOf('-' + m.w); stem = cut > 0 ? base.slice(0, cut) : 'stone'; }
  stem = stem.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_').replace(/^[-_.]+|[-_.]+$/g, '') || 'stone';
  const d = new Date(m.at), p2 = n => String(n).padStart(2, '0');
  const stamp = isNaN(d) ? '' : '-' + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  return stem + '-' + m.w + '-' + lightOf(m) + '-' + engineOf(m) + stamp + ext;
}

const RENAME = process.argv.includes('--rename'), GO = process.argv.includes('--go');
const paths = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!paths.length) { console.error('usage: node tools/tiff-meta.mjs [--rename [--go]] <file> [file...]'); process.exit(2); }

let bad = 0;
const plan = [];
for (const path of paths) {
  let st;
  try { st = statSync(path); } catch (e) { console.error(`${path}\n  cannot read: ${e.code || e.message}`); bad++; continue; }
  const m = findMeta(path);
  console.log(`\n${path}`);
  console.log(`  ${(st.size / 1e6).toFixed(1)} MB on disk`);
  if (!m) { console.log('  no stone-author metadata block found'); bad++; continue; }
  const ms = m.ms || {}, G = m.G || {};
  const geom = m.tiled
    ? `tiled ${m.tile} (${Math.ceil(m.w / m.tile)} x ${Math.ceil(m.h / m.tile)} = ${m.tiles}, rendered in ${m.renders || '?'} passes of ${m.render || '?'})`
    : m.streamed ? `streamed, ${m.bands} bands` : 'single stream';
  console.log(`  ${m.w ? num(m.w) + ' x ' + num(m.h) : '?'}  ${geom}`);
  console.log(`  rendered ${m.at}  scope=${m.scope}  slab=${m.slab || '(not recorded)'}  family=${m.family}`);
  console.log(`  spectrum ${m.spectrum}${m.spectrum === -1 ? ' (black light)' : m.spectrum === 0 ? ' (daylight)' : ''}   back light ${G.backlight ?? '?'}   state ${m.state || '(not recorded)'}`);
  console.log(`  content  ${num(m.marks || 0)} marks, ${num(m.lines || 0)} veins${m.cracks != null ? `, ${num(m.cracks)} cracks, ${num(m.specks)} specks, ${num(m.drusy)} drusy, ${num(m.seams)} seams` : ' (counts not recorded)'}`);
  console.log(`  machine  ${m.cores || '?'} cores, dpr ${m.dpr}, toDisk ${m.toDisk ?? '(not recorded)'}`);
  console.log(`           ${(m.ua || '').slice(0, 100)}`);
  if (ms.render) {
    const raw = (m.tiles || 0) * (m.tile || 0) ** 2 * 4;
    console.log(`  render   ${secs(ms.render)}${ms.total ? `  (total ${secs(ms.total)})` : ''}` +
                `${raw ? `   ${(raw / 1e6 / (ms.render / 1000)).toFixed(0)} MB/s of raw pixels in` : ''}` +
                `${m.bytes ? `   ${(m.bytes / 1e6 / (ms.render / 1000)).toFixed(1)} MB/s out` : ''}`);
  }
  const pt = m.perTile;
  if (pt && Array.isArray(pt.ms) && pt.ms.length) {
    const t = pt.ms, med = median(t), hi = t.filter(x => x > 2 * med);
    console.log(`  per tile ${t.length} render tiles: median ${med} ms, fastest ${Math.min(...t)}, slowest ${Math.max(...t)}`);
    if (Array.isArray(pt.bytes) && pt.bytes.length === t.length) {
      const r = correlate(t, pt.bytes);
      console.log(`           time vs bytes r = ${r === null ? 'n/a' : r.toFixed(2)}  ->  ` +
        (r === null ? 'cannot tell' : r > 0.7 ? 'time followed the PICTURE (dense tiles cost more)'
          : r > 0.3 ? 'partly the picture, partly something else'
          : 'time did NOT follow the picture — look at the machine, not the slab'));
    }
    console.log(`           ${hi.length ? `${hi.length} tile(s) over twice the median (${hi.slice(0, 8).join(', ')}${hi.length > 8 ? ', …' : ''}) — the shape of a STALL` : 'no tile over twice the median — no stalls'}`);
  } else if (m.tiled) {
    console.log('  per tile not recorded (master predates per-tile timing)');
  }
  if (RENAME && m.w) plan.push({ path, base: baseOf(path), m });
}

if (RENAME) {
  console.log(GO ? '\nrenaming:' : '\nwould rename (nothing is changed without --go):');
  for (const { path, base, m } of plan) {
    const why = appNamed(base, m);
    if (!why) { console.log(`  keep  ${base}\n          hand-named, left alone`); continue; }
    const to = canonical(base, m);
    if (base === to) { console.log(`  ok    ${base}`); continue; }
    const dest = dirOf(path) + '/' + to;
    if (existsSync(dest)) { console.log(`  STOP  ${base}\n          -> ${to} already exists, left alone`); bad++; continue; }
    console.log(`  ${GO ? 'move' : 'plan'}  ${base}   (${why})\n          -> ${to}`);
    if (GO) { try { renameSync(path, dest); } catch (e) { console.log(`          failed: ${e.message}`); bad++; } }
  }
}
process.exit(bad ? 1 : 0);

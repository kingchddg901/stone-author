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
import { openSync, readSync, closeSync, statSync } from 'fs';

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

function correlate(a, b) {                               // Pearson, to say whether time followed content
  const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let sab = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; sa += da * da; sb += db * db; }
  return sa && sb ? sab / Math.sqrt(sa * sb) : null;
}

let bad = 0;
for (const path of process.argv.slice(2)) {
  let st; try { st = statSync(path); } catch (e) { console.error(`${path}\n  cannot read: ${e.code || e.message}`); bad++; continue; }
  const m = findMeta(path);
  console.log(`\n${path}`);
  console.log(`  ${(st.size / 1e6).toFixed(1)} MB on disk`);
  if (!m) { console.log('  no stone-author metadata block found'); bad++; continue; }
  const ms = m.ms || {}, G = m.G || {};
  console.log(`  ${m.w ? num(m.w) + ' x ' + num(m.h) : '?'}  ${m.tiled ? `tiled ${m.tile} (${Math.ceil(m.w / m.tile)} x ${Math.ceil(m.h / m.tile)} = ${m.tiles}, rendered in ${m.renders || '?'} passes of ${m.render || '?'})` : m.streamed ? `streamed, ${m.bands} bands` : 'single stream'}`);
  console.log(`  rendered ${m.at}  scope=${m.scope}  family=${m.family}`);
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
}
process.exit(bad ? 1 : 0);

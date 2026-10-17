// TWO RENDERS, SIDE BY SIDE. Never a computed diff.
//
// The question this answers is whether widening the pool bought anything, and it is not answerable by
// subtracting one master from another: pass counts can differ, tile sizes can differ, and a figure like
// "+1.3 min" hides whether the extra workers painted more or just painted slower. So every quantity is
// printed in its own lane and the reader does the comparing.
//
// THE CONTROL IS THE SOLO BASELINE. Pass 0 paints alone in both runs - target starts at 1 so poolSettle
// can keep that time as its reference - so it is the same work, on one worker, on the same machine. If
// the two runs disagree on it, the machine was not in the same state and nothing else below is a
// comparison. That check is printed first and loudly, because a thermal state or a background job would
// otherwise read as a result.
//
// AND THE NUMBER THAT MATTERS IS NOT THE WALL CLOCK. A wider pool that contends harder can paint more
// worker-seconds for the same wall clock, which looks like a win and is not one. The effective speedup
// -- workers x solo / mean loaded pass -- is what says whether a core earned its place.
//
//   node tools/pool-compare.mjs <a.tif> <b.tif>
import { findMeta } from './lib/find-meta.mjs';

const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (files.length !== 2) { console.error('usage: node tools/pool-compare.mjs <a.tif> <b.tif>'); process.exit(2); }

const secs = ms => (ms / 1000 < 90 ? (ms / 1000).toFixed(1) + 's' : (ms / 60000).toFixed(2) + ' min');
const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

function read(f) {
  const j = findMeta(f);
  if (!j) return { name: f, bad: 'no metadata block' };
  const t = j.trace, ms = j.perTile?.ms || [];
  const o = { name: f.replace(/\\/g, '/').split('/').pop(), build: j.build, pass: j.render, px: j.w,
              passes: ms.length, wall: ms.reduce((a, b) => a + b, 0), W: t?.target || j.workers };
  if (!t) { o.bad = 'no trace block - rendered before the instrumentation, or not pooled'; return o; }
  const r = t.r || [], q = t.q || [], dw = t.dw || [], w = t.w || [];
  o.solo = r[0];
  o.loaded = r.length > 1 ? r.slice(1).reduce((a, b) => a + b, 0) / (r.length - 1) : null;
  o.paint = r.reduce((a, b) => a + b, 0);
  o.paintMed = med(r);
  const sr = [...r].sort((a, b) => a - b);
  o.spread = sr[Math.floor(sr.length * 0.9)] / sr[Math.floor(sr.length * 0.1)];
  o.busyMean = t.busy?.length ? t.busy.reduce((a, b) => a + b, 0) / t.busy.length : null;
  o.floor = o.paint / o.W;
  o.dwell = dw.length ? med(dw) : null;
  o.write = w.length ? med(w) : null;
  o.queue = q.length ? med(q.filter(v => v >= 0)) : null;
  o.contention = o.loaded && o.solo ? o.loaded / o.solo : null;
  o.effective = o.contention ? o.W / o.contention : null;
  // Per-worker means, to show whether a wider pool stayed even or grew a cold tail.
  if (t.k) {
    const by = new Map();
    for (let x = 0; x < t.k.length; x++) {
      const e = by.get(t.k[x]) || { n: 0, r: 0 }; e.n++; e.r += r[x]; by.set(t.k[x], e);
    }
    const means = [...by.values()].map(e => e.r / e.n);
    o.wkSpread = Math.max(...means) / Math.min(...means);
    o.wkN = by.size;
  }
  return o;
}

const A = read(files[0]), B = read(files[1]);
const lane = (label, a, b, note) =>
  console.log('  ' + label.padEnd(26) + String(a).padStart(16) + String(b).padStart(16) + (note ? '   ' + note : ''));

console.log('');
console.log('  ' + ' '.repeat(26) + 'A'.padStart(16) + 'B'.padStart(16));
console.log('  ' + '-'.repeat(58));
lane('file', '', '');
console.log('    A  ' + A.name);
console.log('    B  ' + B.name);
console.log('');
lane('build', A.build || '?', B.build || '?');
lane('picture / pass', A.px + '/' + A.pass, B.px + '/' + B.pass);
lane('passes', A.passes, B.passes);
lane('workers', A.W ?? '?', B.W ?? '?');
if (A.bad || B.bad) {
  console.log('');
  if (A.bad) console.log('  A: ' + A.bad);
  if (B.bad) console.log('  B: ' + B.bad);
  console.log('');
  process.exit(0);
}
if (A.pass !== B.pass || A.passes !== B.passes) {
  console.log('');
  console.log('  !! DIFFERENT PASS PLAN. These two did not do the same work, so the wall clocks below are');
  console.log('     not comparable and the per-pass figures are the only ones that mean anything.');
}

console.log('');
console.log('  THE CONTROL - pass 0, painted alone on one worker in both runs');
lane('solo baseline pass', secs(A.solo), secs(B.solo));
{
  const d = Math.abs(A.solo - B.solo) / Math.min(A.solo, B.solo);
  if (d > 0.1) {
    console.log('     !! ' + (100 * d).toFixed(0) + '% apart. The same work on one worker should not differ by that much,');
    console.log('        so the machine was not in the same state. Treat everything below as suspect:');
    console.log('        a thermal state, a background job or a different slab would all read as a result.');
  } else {
    console.log('     within ' + (100 * d).toFixed(1) + '% - the machine was in the same state, so the rest is a comparison');
  }
}

console.log('');
console.log('  WHAT IT COST');
lane('wall clock', secs(A.wall), secs(B.wall));
lane('paint worker-time', secs(A.paint), secs(B.paint));
lane('floor (paint / workers)', secs(A.floor), secs(B.floor));
lane('overhead above floor', (100 * (A.wall - A.floor) / A.wall).toFixed(1) + '%',
                             (100 * (B.wall - B.floor) / B.wall).toFixed(1) + '%');
lane('utilisation (sampled)', A.busyMean ? (100 * A.busyMean / A.W).toFixed(1) + '%' : '-',
                              B.busyMean ? (100 * B.busyMean / B.W).toFixed(1) + '%' : '-');

console.log('');
console.log('  DID THE EXTRA CORES EARN THEIR PLACE?');
lane('mean pass under load', secs(A.loaded), secs(B.loaded));
lane('contention vs solo', A.contention.toFixed(2) + 'x', B.contention.toFixed(2) + 'x');
lane('effective speedup', A.effective.toFixed(2) + 'x', B.effective.toFixed(2) + 'x',
     'of a nominal ' + A.W + 'x / ' + B.W + 'x');
{
  // The honest figure: a core earns its place only if effective speedup rose by more than the width did
  // not. Printed as the ratio, because "20% faster" was the arithmetic that assumed no contention.
  const gain = B.effective / A.effective - 1;
  const nominal = B.W / A.W - 1;
  console.log('     width +' + (100 * nominal).toFixed(0) + '%  ->  throughput ' +
              (gain >= 0 ? '+' : '') + (100 * gain).toFixed(1) + '%' +
              (gain < nominal * 0.5 ? '   <- most of the added width went to contention, not work' : ''));
}

console.log('');
console.log('  THE PICTURE DID NOT CHANGE, SO THESE SHOULD NOT EITHER');
lane('median paint per pass', secs(A.paintMed), secs(B.paintMed), 'rises with contention');
lane('paint spread p90/p10', A.spread.toFixed(2) + 'x', B.spread.toFixed(2) + 'x', 'a property of the slab');
lane('worker spread', A.wkSpread ? A.wkSpread.toFixed(2) + 'x' : '-',
                      B.wkSpread ? B.wkSpread.toFixed(2) + 'x' : '-', 'a cold tail shows here');

console.log('');
console.log('  THE CONSUMER, which a wider pool does not help');
lane('median dwell', A.dwell === null ? '-' : A.dwell + 'ms', B.dwell === null ? '-' : B.dwell + 'ms',
     'finished, waiting its turn');
lane('median write', A.write === null ? '-' : A.write + 'ms', B.write === null ? '-' : B.write + 'ms',
     'deflate + sink, main thread');
lane('median queue', A.queue === null ? '-' : A.queue + 'ms', B.queue === null ? '-' : B.queue + 'ms',
     'dispatch -> ack');
console.log('');

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
  // THE CONTROL ASSUMES THE SOLO PASS IS INVARIANT UNDER WHATEVER IS BEING TESTED, and that is true
  // of a width change, or a scheduling change, or anything paid once per render - the warp-field memo
  // among them, since pass 0 builds the field either way and its time did not move.
  //
  // It is NOT true of a change to the per-pixel walk. Pass 0 paints pixels like any other, so a change
  // that makes pixels cheaper makes the control cheaper by the same factor - and then wall/solo shows
  // nothing, while the raw clock shows everything. The tool cannot tell that apart from a faster
  // machine, so when the builds differ AND the solo moved it says so instead of picking one.
  if (A.build !== B.build && d > 0.05) {
    console.log('     !! ' + (100 * d).toFixed(0) + '% apart, and the BUILDS differ - so the control cannot');
    console.log('        separate a faster machine from a change that also made pass 0 cheaper.');
    console.log('        Read the raw wall clock and the mean paint below; the normalised figure is a');
    console.log('        LOWER bound here, not the answer.');
  } else if (d > 0.1) {
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
  // THE ANSWER, WHICH IS A RATIO OF RATIOS. The raw wall clock cannot say whether a width change paid,
  // because the machine is never in exactly the same state twice: measured here at 4.7% between two
  // runs fifteen minutes apart. So divide each run's wall clock by its OWN solo pass - the same work on
  // one worker, in that run, on that machine - and what remains is the width and nothing else.
  //
  // It took three readings to get this right. The first pair had no control and said -10.7%; the second
  // had a control that REFUSED it at 16% apart; only the third was clean. Each time the raw wall clock
  // pointed somewhere the normalised figure did not.
  const nA = A.wall / A.solo, nB = B.wall / B.solo;         // wall measured in that run's own solo passes
  const gain = nA / nB - 1;                                 // B faster than A => positive
  const nominal = B.W / A.W - 1;
  // NEGATIVE ZERO IS A DIRECTION THAT IS NOT THERE. A residual of -4e-7 formats as "-0.0%", which
  // reads as a small loss; anything under half the printed precision is flattened to zero first.
  const sign = v => { const p = 100 * v, q = Math.abs(p) < 0.05 ? 0 : p; return (q >= 0 ? '+' : '') + q.toFixed(1) + '%'; };
  // NAME THE VARIABLE THAT ACTUALLY MOVED. This said "THE WIDTH IS WORTH" whatever the two runs
  // differed by, and printed "+9.8% for +0.0% more workers" on a pair where the width was identical
  // and the BUILD was the thing under test. A figure attached to the wrong cause is the same defect
  // as a figure with no control: the number is right and what it is a number about is not.
  const sameW = A.W === B.W;
  const what = sameW ? (A.build !== B.build ? 'the build ' + A.build + ' -> ' + B.build : 'the change')
                     : A.W + ' -> ' + B.W + ' workers';
  console.log('     raw wall clock         ' + sign(A.wall / B.wall - 1) + '  going ' + what);
  console.log('     of which the machine   ' + sign(A.solo / B.solo - 1) + '  (the solo pass differed by that much)');
  console.log('     SO ' + (sameW ? 'THE CHANGE' : 'THE WIDTH ') + ' IS WORTH  ' + sign(gain) +
              (sameW ? '  at the same width' : '  for ' + sign(nominal) + ' more workers'));
  if (Math.abs(gain) < 0.02)
    console.log('     -> within measurement noise: the width made no difference at all.');
  else if (gain < nominal * 0.5 && nominal > 0)
    console.log('     -> most of the added width went to contention, not work.');
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

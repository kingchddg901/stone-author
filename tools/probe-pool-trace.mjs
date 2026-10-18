// CAN THE READER TELL THE TWO WORLDS APART? Nothing else about it matters.
//
// The claim pool-trace.mjs makes is that it separates a saturated pool from a starved one. Both
// produce the same completion log - that is the entire reason the trace was built - so a reader that
// is secretly keying on perTile.ms would pass every plausible test and then confirm whatever it was
// asked to confirm. A trace that agrees with its author is worse than no trace, because it reads as
// evidence.
//
// So the two synthetic masters below carry a BYTE-IDENTICAL perTile.ms. They differ only in the busy
// series and the per-pass stamps. If the verdict is the same for both, the reader is useless and this
// probe is the only thing that would say so.
//
// Ground truth is not derived from the reader: each world is simulated from a dispatch rule, and its
// busy series is COUNTED from the resulting dispatch/finish intervals rather than asserted.
//
//   node tools/probe-pool-trace.mjs
import { writeFileSync, mkdtempSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';

let fails = 0;
const ok = (what, cond, got) => {
  if (!cond) { fails++; console.error('  FAIL  ' + what + (got === undefined ? '' : '   ' + got)); }
  else console.log('  ok    ' + what + (got === undefined ? '' : '   ' + got));
};

const W = 8, N = 40, T = 40000, D = 500, TICK = 250;

// ---- WORLD A: the pipeline as the code actually runs it ------------------------------------------
// Three rules, all read off tilePool rather than imagined:
//   1. Pass 0 paints ALONE, because target starts at 1 so poolSettle can keep its time as a baseline.
//   2. target opens to the full width the moment that baseline lands, and tile(0)'s post-await loop
//      dispatches passes 1..8 together.
//   3. After that a pass is dispatched only when the pass eight before it is CONSUMED - `inflight`
//      holds a resolved tile until the consumer takes it, and `start` refuses any index already
//      there, so a finished-but-unconsumed tile occupies a window slot.
// Nothing here is fitted to the data. If the rules are right, the spike phase falls out of them.
const dispA = [], fin = [], wrote = [], msArr = [];
dispA[0] = 0; fin[0] = T; wrote[0] = T + D; msArr[0] = Math.round(wrote[0]);
for (let n = 1; n < N; n++) {
  dispA[n] = n <= W ? fin[0] : wrote[n - W];
  fin[n] = dispA[n] + T;
  const prev = wrote[n - 1];
  wrote[n] = Math.max(fin[n], prev) + D;
  msArr[n] = Math.round(wrote[n] - prev);
}

// ---- WORLD B: the same completions, reached a different way --------------------------------------
// Identical finish and written times - so an identical completion log - but each worker sat idle and
// started late, painting for two seconds instead of forty. A real possibility, and indistinguishable
// from world A by perTile.ms alone.
const dispB = fin.map(f => f - 2000);
// ---- WORLD C: neither full nor idle, to show the reader has more than two buckets ---------------
const dispC = fin.map(f => f - T * 0.7);

const seriesFor = (disp) => {
  const span = Math.max(...fin) + D;
  const v = [];
  for (let t = 0; t <= span; t += TICK) {
    let b = 0;
    for (let n = 0; n < N; n++) if (disp[n] <= t && t < fin[n]) b++;
    v.push(b);
  }
  return v;
};
const busyAt = (disp, t) => { let b = 0; for (let n = 0; n < N; n++) if (disp[n] <= t && t < fin[n]) b++; return b; };

function master(disp, name) {
  const busy = seriesFor(disp);
  const i = [], d = [], q = [], r = [], dw = [], w = [], k = [], bD = [], bS = [], bF = [];
  for (let n = 0; n < N; n++) {
    i.push(n); d.push(Math.round(disp[n])); q.push(0);
    r.push(Math.round(fin[n] - disp[n]));
    // DWELL AND WRITE SPLIT. The consumer takes passes in order, so a pass that finished early sits
    // until its turn; `wrote` is when its write ended, and D is how long that write took.
    dw.push(Math.max(0, Math.round(wrote[n] - D - fin[n]))); w.push(D);
    k.push(n % W);
    bD.push(busyAt(disp, disp[n])); bS.push(busyAt(disp, disp[n]));
    bF.push(busyAt(disp, fin[n] - 1));
  }
  return {
    tool: 'stone-author', build: 'probe', slab: name, material: 'glass',
    w: 65535, h: 40959, render: 4096, tile: 4096, tiles: N, renders: N, workers: W,
    ms: { render: Math.round(wrote[N - 1]), total: Math.round(wrote[N - 1]) },
    perTile: { ms: msArr, bytes: msArr.map(() => 600000) },
    trace: { t0: 0, tick: TICK, busy, target: W, i, d, q, r, dw, w, k, bD, bS, bF, rows: N },
  };
}

const dir = mkdtempSync(join(tmpdir(), 'pooltrace-'));
const write = (obj, fn) => { const p = join(dir, fn); writeFileSync(p, JSON.stringify(obj)); return p; };
const A = master(dispA, 'saturated'), B = master(dispB, 'starved'), C = master(dispC, 'partial');

// ---- the premise: the two worlds are indistinguishable from the completion log ------------------
ok('world A and world B carry an IDENTICAL completion log',
   JSON.stringify(A.perTile.ms) === JSON.stringify(B.perTile.ms),
   'median ' + [...msArr].sort((a, b) => a - b)[N >> 1] + ' ms, ' + msArr.filter(v => v > 3000).length + ' spikes');
// THE RULES PREDICT THE REAL MASTER, which is the only reason to trust the simulation at all. The
// 65,535 v138 render - 40 passes of 8192, eight workers - spiked at passes 0, 1, 9, 17, 25, 33 and
// nowhere else on that period. The three dispatch rules above were read off the code, not fitted to
// that list, and they reproduce it exactly: 0 is the solo baseline, 1 is the first full batch, and
// every eighth after that is the consumer catching up with the dispatch front.
{
  const got = msArr.map((v, n) => [n, v]).filter(([, v]) => v > 3000).map(([n]) => n);
  ok('           the dispatch rules reproduce the REAL master\'s spike phase',
     got.join(' ') === '0 1 9 17 25 33', 'predicted ' + got.join(' ') + '  measured 0 1 9 17 25 33');
}
ok('           so anything keying on perTile.ms MUST give the same answer for both', true);

const run = p => execFileSync(process.execPath, ['tools/pool-trace.mjs', p], { encoding: 'utf8' });
const outA = run(write(A, 'a.json')), outB = run(write(B, 'b.json')), outC = run(write(C, 'c.json'));

// ---- and the reader separates them anyway --------------------------------------------------------
ok('world A reads as SATURATED', /VERDICT: SATURATED/.test(outA), (outA.match(/utilisation:.*/) || [''])[0].trim());
ok('world B reads as STARVED', /VERDICT: STARVED/.test(outB), (outB.match(/utilisation:.*/) || [''])[0].trim());
ok('world C reads as PARTIAL, so there are three answers and not two',
   /VERDICT: PARTIAL/.test(outC), (outC.match(/utilisation:.*/) || [''])[0].trim());
ok('the three verdicts are genuinely different strings',
   new Set([outA, outB, outC].map(o => (o.match(/VERDICT: (\w+)/) || [])[1])).size === 3);

// ---- the idle figure has to be the size of the prize, not a decoration -------------------------
// World A is full: the idle time is the warm-up and nothing else. World B is idle nearly throughout.
{
  const idleOf = o => { const m = o.match(/idle worker-time ([\d.]+)(s|min)/); return m ? +m[1] * (m[2] === 'min' ? 60 : 1) : null; };
  const ia = idleOf(outA), ib = idleOf(outB);
  ok('the starved world reports far more idle worker-time', ia !== null && ib !== null && ib > ia * 5,
     'saturated ' + ia + 's vs starved ' + ib + 's');
}

// ---- ABLATION: WHICH record carries the verdict, and which must not ------------------------------
// The verdict is the integrated paint intervals, because the two samples both lie and in opposite
// directions: a 250 ms series cannot see a 5 ms paint (measured live: zero busy in 201 of 204 samples
// while the transitions said eight), and the finish-instant count is biased high because finishes
// cluster (a pool painting 28 s in every 40 reads as completely full). So two claims, and the first
// would have passed before the integral existed - which is exactly why it is worth asserting.
{
  // 1. The coarse sampler must NOT be able to move it. Give world B world A's series AND its instant
  //    counts; the intervals still say starved, and so must the verdict.
  const faked = JSON.parse(JSON.stringify(B));
  faked.trace.busy = A.trace.busy;
  faked.trace.bD = A.trace.bD; faked.trace.bS = A.trace.bS; faked.trace.bF = A.trace.bF;
  const out = run(write(faked, 'ablate-series.json'));
  ok('ablation: the coarse series CANNOT flip the verdict any more', /VERDICT: STARVED/.test(out),
     (out.match(/VERDICT: \w+/) || [''])[0]);
  ok('           and the disagreement is reported rather than silently resolved',
     /series says [\d.]+ where the integrated/.test(out),
     (out.split('\n').find(l => /NOTE:/.test(l)) || 'no note').trim());

  // 2. The intervals MUST be able to. Give world B world A's paint spans and nothing else.
  const spanned = JSON.parse(JSON.stringify(B));
  spanned.trace.d = A.trace.d; spanned.trace.q = A.trace.q; spanned.trace.r = A.trace.r;
  const out2 = run(write(spanned, 'ablate-spans.json'));
  ok('ablation: swapping ONLY the paint intervals DOES flip it', /VERDICT: SATURATED/.test(out2),
     (out2.match(/VERDICT: \w+/) || [''])[0]);
}
// And the reverse: strip the series entirely and the reader must refuse to answer rather than guess.
{
  const bare = JSON.parse(JSON.stringify(A));
  delete bare.trace;
  const out = run(write(bare, 'ablate-none.json'));
  ok('ablation: with no trace at all it says so instead of guessing',
     /no trace block/.test(out) && !/VERDICT/.test(out));
  ok('           and does not read absence as a quiet pool', /NOTHING about utilisation/.test(out));
}

// ---- the per-worker table must be able to finger one worker -------------------------------------
{
  const lop = JSON.parse(JSON.stringify(A));
  for (let x = 0; x < lop.trace.i.length; x++) if (lop.trace.k[x] === 3) lop.trace.r[x] *= 3;
  const out = run(write(lop, 'ablate-worker.json'));
  ok('one slow worker is called out by id', /slowest worker is 3\.\d+x/.test(out),
     (out.match(/slowest worker is .*/) || [''])[0].trim());
  ok('and an even pool is not', /slowest worker is 1\.00x/.test(outA),
     (outA.match(/slowest worker is .*/) || [''])[0].trim());
}

// ---- coordinates, which are derived rather than stored ------------------------------------------
{
  ok('the pass index is turned back into a tile position', /\b9\s+9,0\b/.test(outA) || /\b9\s+9,0/.test(outA),
     (outA.split('\n').find(l => /^\s+9\s/.test(l)) || '').trim());
}

// ---- AND THE SIDE-BY-SIDE READER, whose one load-bearing claim is the CONTROL -------------------
// pool-compare.mjs exists to answer "did widening the pool buy anything", and the only thing standing
// between it and confirming whatever it is shown is the solo-baseline check: pass 0 paints alone in
// every run, so if two runs disagree on it the machine was not in the same state and nothing else is a
// comparison. A threshold that never fires would let a thermal state read as a result - which is the
// shape of every wrong conclusion in this investigation so far.
{
  const cmp = (a, b, an, bn) =>
    execFileSync(process.execPath, ['tools/pool-compare.mjs', write(a, an), write(b, bn)], { encoding: 'utf8' });

  // 1. Same machine state: the control must PASS and say so.
  const same = cmp(A, JSON.parse(JSON.stringify(A)), 'cmp-a.json', 'cmp-a2.json');
  ok('the control passes when the solo pass agrees', /the machine was in the same state/.test(same),
     (same.split('\n').find(l => /within/.test(l)) || '').trim());
  ok('and identical inputs report no width effect', /SO THE CHANGE IS WORTH  \+0\.0%/.test(same));


  // 2. A machine that drifted. Same picture, same width, but the solo pass cost half as much - which is
  //    what a thermal state or a background job looks like. The tool must refuse to call it a result.
  const drift = JSON.parse(JSON.stringify(A));
  drift.trace.r = drift.trace.r.map((v, x) => x === 0 ? Math.round(v / 2) : v);
  const dout = cmp(A, drift, 'cmp-a3.json', 'cmp-drift.json');
  ok('ablation: a solo pass that disagrees is refused as a comparison',
     /apart\. The same work on one worker should not differ/.test(dout) && /Treat everything below as suspect/.test(dout));
  ok('           and the control is the thing that catches it, not the wall clock',
     !/the machine was in the same state/.test(dout));

  // 3. Different work. Comparing a 40-pass plan against a 160-pass one is not a comparison of widths.
  const other = JSON.parse(JSON.stringify(A));
  other.render = 8192; other.renders = 40;
  other.perTile.ms = other.perTile.ms.slice(0, 40);
  const pout = cmp(A, other, 'cmp-a4.json', 'cmp-plan.json');
  ok('a different pass plan is called out before any figure is read',
     /DIFFERENT PASS PLAN/.test(pout));

  // 4. THE CONFOUND, BUILT ON PURPOSE. The question "did more workers help" is a ratio of ratios: wall
  //    clock divided by that run's OWN solo pass, because the machine is never in the same state twice.
  //    A real afternoon produced three readings of one change - -10.7% with no control, a refusal at 16%
  //    apart, and -0.3% once clean - and the raw wall clock pointed the wrong way in two of them.
  //
  //    The worlds above cannot test this: they share a completion log by construction, so they share a
  //    wall clock, and a metric that reads wall/solo must see nothing. These two are built to differ.
  const widthCase = (W, wallMin, soloSec, name) => {
    const m = JSON.parse(JSON.stringify(A));
    m.workers = W; m.trace.target = W; m.trace.k = m.trace.k.map(v => v % W);
    const want = wallMin * 60000, have = m.perTile.ms.reduce((a, b) => a + b, 0);
    m.perTile.ms = m.perTile.ms.map(v => Math.round(v * want / have));   // scale the wall clock
    m.trace.r = m.trace.r.slice(); m.trace.r[0] = Math.round(soloSec * 1000);
    return write(m, name);
  };
  const run2 = (a, b) => execFileSync(process.execPath, ['tools/pool-compare.mjs', a, b], { encoding: 'utf8' });

  // 4a. SAME MACHINE (solo identical), B finishes a fifth sooner. That IS the width, and must read so.
  const realOut = run2(widthCase(8, 100, 20, 'w-8-100-20.json'), widthCase(10, 80, 20, 'w-10-80-20.json'));
  ok('a genuine width gain is reported as one', /SO THE WIDTH  IS WORTH  \+25\.0%/.test(realOut),
     (realOut.split('\n').find(l => /WIDTH IS WORTH/.test(l)) || '').trim());
  ok('           and the machine is credited with nothing', /of which the machine   \+0\.0%/.test(realOut));

  // 4b. THE TRAP. Identical wall clocks to 4a - so an identical RAW reading of +25% - but the solo pass
  //     says the machine was a fifth faster. The width is then worth nothing, and that is the whole
  //     reason the control exists.
  const fakeOut = run2(widthCase(8, 100, 20, 'w-8-100-20b.json'), widthCase(10, 80, 16, 'w-10-80-16.json'));
  ok('ablation: the SAME raw gain on a faster machine is worth nothing',
     /SO THE WIDTH  IS WORTH  \+0\.0%/.test(fakeOut),
     (fakeOut.split('\n').find(l => /WIDTH IS WORTH/.test(l)) || '').trim());
  ok('           the raw wall clock reads identically in both cases, which is the point',
     /raw wall clock         \+25\.0%/.test(realOut) && /raw wall clock         \+25\.0%/.test(fakeOut));
  ok('           and it says the machine took the credit', /of which the machine   \+25\.0%/.test(fakeOut));
  ok('           calling it noise rather than a result', /made no difference at all/.test(fakeOut));
  // THE LABEL HAS TO NAME WHAT MOVED. It read "THE WIDTH IS WORTH" on a pair whose width was
  // identical and whose BUILD was under test, printing "+9.8% for +0.0% more workers" - a correct
  // number attached to the wrong cause, which is the same defect as a number with no control.
  ok('a width comparison says so', /going 8 -> 10 workers/.test(realOut),
     (realOut.split(String.fromCharCode(10)).find(l => /raw wall clock/.test(l)) || '').trim());
  {
    const sameWidth = JSON.parse(JSON.stringify(A)); sameWidth.build = 'probe-b';
    const out = cmp(A, sameWidth, 'cmp-lblA.json', 'cmp-lblB.json');
    ok('and an equal-width pair names the build instead', /going the build probe -> probe-b/.test(out),
       (out.split(String.fromCharCode(10)).find(l => /raw wall clock/.test(l)) || '').trim());
    ok('           and never claims the width did it', !/THE WIDTH/.test(out));
  }
}

// ---- THINNING A PERIOD-W SIGNAL, which is where the obvious answer is the wrong one --------------
// A long render cannot carry a row per pass, so rows are thinned. Thin by keeping every Nth pass and
// the stride beats against the period: one pass in W carries the batch's paint, so a stride that
// shares a factor with W keeps only fast passes or only slow ones. The trace then shows a render with
// no waits in it at all - clean, confident and false.
//
// Keeping RUNS of W consecutive passes cannot do that: any W consecutive passes span exactly one
// period whatever the alignment. This measures both on a 10,240-pass render carrying the real
// dispatch rule, and the numbers are the argument.
{
  const N = 10240, WW = 8, Tp = 34000, Dp = 400, CAP = 4096;
  const disp = [], fn = [], wr = [], pm = [];
  disp[0] = 0; fn[0] = Tp; wr[0] = Tp + Dp; pm.push(Math.round(wr[0]));
  for (let n = 1; n < N; n++) {
    disp[n] = n <= WW ? fn[0] : wr[n - WW];
    fn[n] = disp[n] + Tp;
    const prev = wr[n - 1];
    wr[n] = Math.max(fn[n], prev) + Dp;
    pm.push(Math.round(wr[n] - prev));
  }
  const med = [...pm].sort((a, b) => a - b)[N >> 1];
  const isSpike = n => pm[n] > med * 3;
  const trueRatio = pm.filter((_, n) => isSpike(n)).length / N;

  // The stride each strategy settles on for the same row budget, by the same doubling.
  const strideFor = (unit) => { let e = 1; while (Math.ceil(N / unit / e) * unit > CAP) e *= 2; return e; };
  const runEvery = strideFor(WW), passEvery = strideFor(1);
  const keptRun = [], keptPass = [];
  for (let n = 0; n < N; n++) {
    if (Math.floor(n / WW) % runEvery === 0) keptRun.push(n);
    if (Math.floor(n / 1) % passEvery === 0) keptPass.push(n);
  }
  const ratio = a => a.filter(isSpike).length / a.length;

  ok('the render carries a real period-' + WW + ' pattern to thin',
     Math.abs(trueRatio - 1 / WW) < 0.01, (100 * trueRatio).toFixed(1) + '% of passes are waits');
  ok('both strategies keep a comparable number of rows',
     Math.abs(keptRun.length - keptPass.length) < CAP,
     'runs ' + keptRun.length + ' (every ' + runEvery + '), per-pass ' + keptPass.length + ' (every ' + passEvery + ')');

  // THE MEASUREMENT. Runs preserve the ratio; the stride annihilates it.
  ok('runs preserve the wait ratio', Math.abs(ratio(keptRun) - trueRatio) < 0.01,
     (100 * ratio(keptRun)).toFixed(1) + '% against a true ' + (100 * trueRatio).toFixed(1) + '%');
  ok('ablation: thinning per pass ALIASES it away entirely', ratio(keptPass) < trueRatio / 50,
     (100 * ratio(keptPass)).toFixed(2) + '% against a true ' + (100 * trueRatio).toFixed(1) +
     '% - a ' + Math.round(trueRatio / Math.max(ratio(keptPass), 1e-9)) + 'x collapse, and nothing would say so');

  // AND THE CONSEQUENCE, through the real reader rather than asserted.
  const build = (kept, every, run, name) => {
    const i = [], d = [], q = [], r = [], dw = [], w = [], k = [], bF = [];
    for (const n of kept) {
      i.push(n); d.push(Math.round(disp[n])); q.push(2); r.push(Tp);
      dw.push(Math.max(0, Math.round(wr[n] - Dp - fn[n]))); w.push(Dp); k.push(n % WW); bF.push(WW);
    }
    return write({ tool: 'stone-author', build: 'probe', slab: name, material: 'glass',
      w: 1048576, h: 655360, render: 8192, tile: 4096, tiles: N, renders: N, workers: WW,
      ms: { render: wr[N - 1], total: wr[N - 1] }, perTile: { ms: pm, bytes: pm.map(() => 6e5) },
      trace: { t0: 0, tick: 8000, busy: new Array(2000).fill(WW), target: WW,
               i, d, q, r, dw, w, k, bD: bF, bS: bF, bF, rows: i.length, run, every,
               capped: every > 1 || undefined } }, name + '.json');
  };
  const outRun = execFileSync(process.execPath, ['tools/pool-trace.mjs', build(keptRun, runEvery, WW, 'thin-run')], { encoding: 'utf8' });
  const outPass = execFileSync(process.execPath, ['tools/pool-trace.mjs', build(keptPass, passEvery, 1, 'thin-pass')], { encoding: 'utf8' });
  ok('the run-thinned trace still reaches the RIGHT verdict', /VERDICT: SATURATED/.test(outRun),
     (outRun.match(/VERDICT: \w+/) || [''])[0]);
  ok('and says it is a sample rather than the whole render', /kept as runs of 8 every /.test(outRun),
     (outRun.split('\n').find(l => /rows: /.test(l)) || '').trim());
  ok('ablation: the pass-thinned one has no waits left to read',
     /NO VERDICT/.test(outPass), (outPass.split('\n').find(l => /NO VERDICT/.test(l)) || 'it reached one anyway').trim());
  ok('           and says so instead of reporting a quiet pool', /cannot read a verdict from/.test(outPass));
}

console.log('');
if (fails) { console.error('probe-pool-trace: ' + fails + ' FAILED'); process.exit(1); }
console.log('probe-pool-trace: two worlds with one completion log, told apart by the paint intervals -');
console.log('                  which neither the coarse series nor the finish-instant count could do;');
console.log('                  and a width comparison that refuses to answer when the control disagrees.');

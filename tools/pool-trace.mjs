// WHAT THE WORKERS WERE ACTUALLY DOING, read off a finished master.
//
// perTile.ms says a pass took 42 seconds. That number is consumer-side wall - ask the pool for a
// pass, have it written - and it is the SAME number whether the other seven workers were painting
// throughout or sitting idle. Eight workers handed eight tiles finish together, so one consumption
// in eight carries the batch's whole render and the other seven read as the write cost. A completion
// log of 42s, 0.5, 0.4, 0.5, 0.4, 0.5, 0.5, 0.4 is what BOTH look like.
//
// This lays the per-pass stamps over the busy series and says which it was. The verdict rests on one
// quantity: the mean number of workers busy DURING the waits. Near the pool width means the pipeline
// was full and the wait is the render - there is nothing to recover and a faster pool is the wrong
// fix. Well below it means the consumer starved the pool, and the idle worker-seconds printed beside
// it are what a different dispatch strategy could buy.
//
//   node tools/pool-trace.mjs <file> [file...]
//   node tools/pool-trace.mjs --rows <file>        every pass, not only the slow ones
import { findMeta } from './lib/find-meta.mjs';

const args = process.argv.slice(2);
const ROWS = args.includes('--rows');
const files = args.filter(a => !a.startsWith('--'));
if (!files.length) { console.error('usage: node tools/pool-trace.mjs [--rows] <file> [file...]'); process.exit(2); }

const secs = ms => (ms / 1000 < 90 ? (ms / 1000).toFixed(1) + 's' : (ms / 60000).toFixed(1) + 'min');
const median = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const pad = (v, n) => String(v).padStart(n);

for (const f of files) {
  console.log(f.replace(/\\/g, '/').split('/').pop());
  let j;
  try { const m = findMeta(f); j = m.meta || m; } catch (e) { console.log('  unreadable: ' + e.message + '\n'); continue; }

  const t = j.trace;
  if (!t) {
    // ABSENT IS NOT A FINDING. A master written before the trace existed, or one painted on this
    // thread, carries no series - and neither says the pool was busy or idle.
    console.log('  no trace block. Either this master predates it, or `workers` is absent and nothing');
    console.log('  was pooled. This says NOTHING about utilisation either way.');
    console.log('  workers: ' + (j.workers === undefined ? 'absent (single-threaded)' : j.workers) + '\n');
    continue;
  }

  const W = t.target || j.workers || 0;
  const rAcross = Math.ceil(j.w / j.render);
  const ms = j.perTile?.ms || [];
  const med = ms.length ? median(ms) : 0;
  const busy = t.busy || [];
  const tick = t.tick || 0;

  console.log('  ' + j.w.toLocaleString('en-GB') + ' px, ' + j.render + ' pass, ' + (j.renders || ms.length) +
              ' passes, ' + W + ' workers'
              // TWO VOCABULARIES, because the archive holds both. A master written before
              // 2026-10-20 carries `poolShed`: workers actually taken away. One written after
              // carries `poolStrain`: what the same measurement saw, with nothing acted on.
              // Printing one as the other would read a record of loss as a record of load.
              + (j.poolShed ? '  SHED ' + j.poolShed.join(' ') : '')
              + (j.poolStrain ? '  STRAIN over ' + j.poolStrain.over + ', panic ' + j.poolStrain.panic
                                + ', worst ' + j.poolStrain.max + 'x' : ''));
  console.log('  busy series: ' + busy.length + ' samples at ' + tick + ' ms = ' + secs(busy.length * tick) +
              (t.capped ? '   (per-pass rows capped at ' + t.rows + ')' : ''));

  // ---- the headline ------------------------------------------------------------------------------
  if (busy.length && W) {
    const sum = busy.reduce((a, b) => a + b, 0);
    const mean = sum / busy.length;
    const idleWs = busy.reduce((a, b) => a + (W - b), 0) * tick / 1000;
    const hist = Array.from({ length: W + 1 }, () => 0);
    for (const b of busy) hist[Math.min(W, b)]++;
    console.log('  utilisation: mean ' + mean.toFixed(2) + ' of ' + W + ' = ' +
                (100 * mean / W).toFixed(1) + '%     idle worker-time ' + secs(idleWs * 1000));
    console.log('  busy histogram: ' + hist.map((c, i) => i + ':' + (100 * c / busy.length).toFixed(0) + '%')
                .filter((_, i) => hist[i]).join('  '));
  }

  // ---- the question: how many were busy while the consumer waited? ------------------------------
  const i = t.i || [], d = t.d || [], q = t.q || [], r = t.r || [], w = t.w || [], k = t.k || [];
  // dw and bF are what the verdict rests on, so they are read explicitly rather than spread: a master
  // written before the dwell/write split carries no `dw`, and a row that quietly reported `undefined`
  // as a number would make a saturated pool read as whatever the coarse tick happened to catch.
  const dw = t.dw || [], bF = t.bF || [];
  // A MAP, NOT indexOf. The rows are sparse now - runs kept at a stride - and a linear scan per lookup
  // is quadratic in the pass count on exactly the long renders this was widened for.
  const at = new Map(); for (let x = 0; x < i.length; x++) at.set(i[x], x);
  const row = n => {
    const x = at.has(n) ? at.get(n) : -1;
    return x < 0 ? null : { d: d[x], q: q[x], r: r[x], w: w[x], k: k[x],
                            dw: dw.length ? dw[x] : undefined, bF: bF.length ? bF[x] : undefined };
  };
  // ---- OCCUPANCY, INTEGRATED RATHER THAN SAMPLED --------------------------------------------------
  // Every recorded pass occupied a worker over exactly [d+q, d+q+r], so the mean number of workers
  // painting across any window is the summed overlap divided by the window. That is exact: no tick to
  // fall between, and no instant to land on.
  //
  // Both samples lie, in opposite directions, and each was caught by a case the other passed:
  //   - the 250 ms SERIES cannot see a paint shorter than itself. Measured on a live pool at a 4096
  //     stone pass: zero busy in 201 of 204 samples while the transitions said eight.
  //   - bF, the count at the finish instant, is biased HIGH because finishes cluster - a pool painting
  //     28 seconds in every 40 reads as completely full, because the instant a pass ends is precisely
  //     when its siblings are still going.
  // The intervals have neither problem and were already being recorded for something else.
  const spans = [];
  for (let x = 0; x < i.length; x++) {
    const a = d[x] + Math.max(0, q[x]);
    if (r[x] >= 0) spans.push([a, a + r[x]]);
  }
  const occupancy = (t0, t1) => {
    if (!(t1 > t0) || !spans.length) return null;
    let acc = 0;
    for (const [a, b] of spans) { const lo = a > t0 ? a : t0, hi = b < t1 ? b : t1; if (hi > lo) acc += hi - lo; }
    return acc / (t1 - t0);
  };

  const sliceBusy = (t0, t1) => {
    if (!busy.length || !tick) return null;
    const a = Math.max(0, Math.floor(t0 / tick)), b = Math.min(busy.length - 1, Math.ceil(t1 / tick));
    if (b < a) return null;
    const seg = busy.slice(a, b + 1);
    return { n: seg.length, min: Math.min(...seg), max: Math.max(...seg),
             mean: seg.reduce((x, y) => x + y, 0) / seg.length };
  };

  // ---- the warm-up is not the dispatch strategy's fault, and must be priced separately ----------
  // The pool paints the FIRST pass alone on purpose: target starts at 1 so poolSettle can keep that
  // time as its baseline, because no memory figure a browser offers can say whether eight tiles will
  // fit and only time is a witness. So the opening pass runs at one eighth of the width by design,
  // and a utilisation figure that averages across it is judging that decision rather than the
  // dispatch. Reported on its own line, never folded into the verdict, and never hidden either.
  let warmTo = 0;
  if (busy.length && W) { while (warmTo < busy.length && busy[warmTo] < W) warmTo++; }
  if (warmTo && tick) {
    const idleWarm = busy.slice(0, warmTo).reduce((a, b) => a + (W - b), 0) * tick / 1000;
    console.log('  warm-up: ' + secs(warmTo * tick) + ' before all ' + W + ' were painting (' +
                secs(idleWarm * 1000) + ' idle worker-time) - the solo baseline pass, by design');
  }

  // WHAT THE TRACE ACTUALLY COVERS, SAID OUT LOUD. The per-pass rows stop at the cap - 4,096 of a
  // 1,048,576 master's 40,960 passes - so every figure below describes the OPENING of the render and
  // not the whole of it. Said plainly, because a verdict computed from the first tenth and printed
  // without qualification is the shape of every wrong reading in this investigation: the number is
  // right, the thing it is a number ABOUT is not what the reader assumes.
  // SPARSE IS NOT TRUNCATED, and the difference decides what the figures below are ABOUT. Rows are
  // kept as runs of `run` consecutive passes at a stride of `every`, so a long render is sampled
  // across its whole length rather than described up to a cut. Both the density and the SPAN are
  // printed: a trace holding 40% of the passes spread evenly is a different thing from one holding
  // the first 40%, and the earlier version could not tell them apart because it inferred coverage
  // from the last index alone.
  const partial = i.length > 0 && i.length < ms.length;
  const thinned = (t.every || 1) > 1;
  if (partial) {
    const span = i[i.length - 1] - i[0] + 1;
    const even = t.every > 1;
    console.log('  rows: ' + i.length.toLocaleString('en-GB') + ' of ' + ms.length.toLocaleString('en-GB') +
                ' passes (' + (100 * i.length / ms.length).toFixed(0) + '%)' +
                (even ? ', kept as runs of ' + t.run + ' every ' + t.every : '') +
                ', spanning passes ' + i[0] + '-' + i[i.length - 1]);
    if (span < ms.length * 0.9)
      console.log('     !! that span is only ' + (100 * span / ms.length).toFixed(0) +
                  '% of the render, so the per-pass figures describe THAT window, not the whole run.');
  }

  const slow = ms.map((v, n) => [n, v]).filter(([, v]) => v > med * 3).map(([n]) => n);
  const shown = (ROWS ? i.slice() : slow).filter(n => at.has(n));
  if (shown.length) {
    console.log('');
    // `at fin` is the instant count (biased high); `mean` is the integrated occupancy over the wait,
    // which is the figure the verdict uses.
    console.log('  pass    x,y    wall      queue   paint    dwell    write   wkr   at fin    mean');
    let satN = 0, satSum = 0, serN = 0, serSum = 0;
    for (const n of shown) {
      const e = row(n);
      if (!e) continue;
      const prev = row(n - 1);
      // The wait ran from the moment the previous pass was written to the moment this one came back.
      const t1 = e.d + Math.max(0, e.q) + e.r;
      const t0 = prev ? prev.d + Math.max(0, prev.q) + prev.r + (prev.dw || 0) + prev.w : e.d;
      const b = sliceBusy(t0, t1);
      // STEADY STATE ONLY. The first batch cannot be at width - pass 0 is deliberately solo and
      // passes 1..W are its first opening - so the verdict is taken from the waits after it. Those
      // rows still print; they are just not evidence about dispatch.
      //
      // AND THE VERDICT COMES FROM bF, NOT FROM THE SERIES. bF is the number of workers painting at
      // the instant this pass finished, recorded in the handler itself; the series is a 250 ms tick
      // that cannot see a short paint. Measured on a live pool at a 4096 stone pass: the tick said
      // zero busy in 201 of 204 samples while bF said eight. The series is kept as the cross-check
      // below, because it is the only thing that can show a gap containing no transitions at all.
      // WHICH RECORD CAN ANSWER DEPENDS ON HOW THE ROWS WERE KEPT, and getting this wrong is silent.
      // The span integral is exact only when it can see EVERY pass overlapping the window. Once rows
      // are thinned to runs the unrecorded passes are invisible to it, so it systematically
      // under-counts and reads a saturated pool as PARTIAL - measured on a synthetic 10,240-pass
      // render where every worker was busy throughout and the integral said 5.4 of 8.
      //
      // The busy series does not have that problem: it spans the whole render whatever the rows do.
      // Its weakness is the opposite one - a tick cannot see a paint shorter than itself - and that
      // does not bite here, because a render long enough to need thinning has passes measured in tens
      // of seconds against a tick of at most a few. So: integral when the rows are dense, series when
      // they are thinned, and the verdict says which it used.
      const occ = thinned ? (b ? b.mean : null) : occupancy(t0, t1);
      if (n > W && occ !== null) { satN++; satSum += occ; }
      if (n > W && b) { serN++; serSum += b.mean; }
      console.log('  ' + pad(n, 5) + ' ' + pad((n % rAcross) + ',' + ((n / rAcross) | 0), 7) +
                  pad(secs(ms[n]), 9) + pad(e.q < 0 ? 'no ack' : e.q + 'ms', 9) +
                  pad(secs(e.r), 8) + pad(e.dw === undefined ? '-' : e.dw + 'ms', 9) +
                  pad(e.w + 'ms', 9) + pad('w' + e.k, 6) +
                  pad(e.bF === undefined ? '-' : e.bF + '/' + W, 8) +
                  (occ === null ? '' : pad(occ.toFixed(1), 8)));
    }
    // NO VERDICT IS A RESULT TOO, and it has to say so. A trace whose windows collapse - a resumed
    // render where the previous passes are not in this record, a cap that landed inside the warm-up -
    // leaves nothing to integrate, and printing the table with no line under it reads as "fine".
    if (!satN) {
      console.log('');
      console.log('  NO VERDICT: ' + (shown.length ? shown.length + ' slow passes shown, but none of them had a' :
                  'no slow passes in the retained window, so there is no') +
                  ' measurable wait to integrate over.');
      console.log('  That is not a quiet pool - it is a record this tool cannot read a verdict from.');
    }
    if (satN && W) {
      const m = satSum / satN;
      console.log('');
      const pc = 100 * m / W;
      console.log('  (occupancy from ' + (thinned ? 'the ' + tick + ' ms busy series, because the rows are thinned' :
                                                    'the paint intervals, which are complete here') + ')');
      console.log('  (steady state: ' + satN + ' waits after the first batch; the warm-up above is excluded' +
                  (partial ? '; from ' + i.length.toLocaleString('en-GB') + ' sampled passes of ' +
                   ms.length.toLocaleString('en-GB') : '') + ')');
      // DISAGREEMENT MEANS THE TICK IS TOO COARSE, not that the pool changed its mind.
      if (serN) {
        const sm = serSum / serN;
        if (Math.abs(sm - m) > 1) {
          console.log('  NOTE: the ' + tick + ' ms series says ' + sm.toFixed(1) + ' where the integrated');
          console.log('  intervals say ' + m.toFixed(1) + '. A tick cannot see a paint shorter than itself, so the');
          console.log('  integral is the figure to trust; read the series only for gaps holding no passes.');
        }
      }
      if (pc >= 95) {
        console.log('  VERDICT: SATURATED. ' + m.toFixed(1) + ' of ' + W + ' workers (' + pc.toFixed(0) +
                    '%) were painting while the consumer waited.');
        console.log('  The wait IS the render, arriving one pass in ' + W + '. A different dispatch strategy');
        console.log('  cannot recover it; only a cheaper pass or a wider pool can.');
      } else if (pc <= 50) {
        console.log('  VERDICT: STARVED. Only ' + m.toFixed(1) + ' of ' + W + ' workers (' + pc.toFixed(0) +
                    '%) were painting while the consumer waited.');
        console.log('  The pool was idle for want of work. Dispatch-on-completion is the fix, and the idle');
        console.log('  worker-time above is the size of the prize.');
      } else {
        console.log('  VERDICT: PARTIAL. ' + m.toFixed(1) + ' of ' + W + ' (' + pc.toFixed(0) +
                    '%) busy during the waits - neither a full pipeline nor an idle one.');
        console.log('  Read the per-worker table: a pool that ramps has a cold tail, a pool that is simply');
        console.log('  narrow does not.');
      }
    }
  }

  // ---- was it one worker, or all of them? --------------------------------------------------------
  if (k.length && W) {
    const by = new Map();
    for (let x = 0; x < i.length; x++) {
      const e = by.get(k[x]) || { n: 0, r: 0, worst: 0, q: 0 };
      e.n++; e.r += r[x]; e.worst = Math.max(e.worst, r[x]); e.q += Math.max(0, q[x]);
      by.set(k[x], e);
    }
    console.log('');
    console.log('  worker  passes   paint total   mean     worst    queued');
    for (const id of [...by.keys()].sort((a, b) => a - b)) {
      const e = by.get(id);
      console.log('  ' + pad('w' + id, 6) + pad(e.n, 8) + pad(secs(e.r), 14) + pad(secs(e.r / e.n), 9) +
                  pad(secs(e.worst), 9) + pad(e.q + 'ms', 10));
    }
    const tot = [...by.values()].map(e => e.r / e.n);
    const spread = Math.max(...tot) / Math.min(...tot);
    console.log('  slowest worker is ' + spread.toFixed(2) + 'x the fastest per pass' +
                (spread > 1.5 ? '  <- one worker is carrying differently; look at affinity, not the picture' : ''));
  }
  console.log('');
}

// A COMPLETION LOG CANNOT TELL A STALL FROM A QUEUE, AND THAT IS WHAT THIS PROTECTS.
//
// perTile.ms is consumer-side wall: ask the pool for a pass, have it written. Eight workers handed
// eight tiles at once finish together, so one consumption in eight carries the batch's entire render
// and the other seven read as the write cost. Measured on a real 65,535 master: waits of 42, 36, 35,
// 38, 38, 37, 36, 33 s at passes 1, 9, 17, 25, 33, 41, 49, 57 - a perfect period of eight - against a
// median of 556 ms everywhere else. That shape is produced BOTH by a pool at 100% utilisation and by
// a pool that falls to one worker and ramps back, and ms alone cannot separate them. A conclusion was
// drawn from it anyway - "90% of the render is stall" - and it was not supported.
//
// So: three deltas and three busy counts per pass, a worker id, and a uniform busy series. What this
// file defends is the handful of places where a plausible-looking edit would make the trace agree with
// whatever it was asked to agree with - which is worse than having no trace, because a trace reads as
// evidence.
//
//   node tools/check-pool-trace.mjs
import { readFileSync } from 'fs';

const SRC = readFileSync(new URL('../app/stone-author.html', import.meta.url), 'utf8');
let fails = 0;
const ok = (what, cond, got) => {
  if (!cond) { fails++; console.error('  FAIL  ' + what + (got === undefined ? '' : '   ' + got)); }
  else console.log('  ok    ' + what + (got === undefined ? '' : '   ' + got));
};

const POOL = SRC.slice(SRC.indexOf('const start = (idx) => {'), SRC.indexOf('    return {\n      get workers()'));

// ---- the ack must never be mistaken for the tile ------------------------------------------------
// It carries no bitmap. Resolving on it hands the consumer `undefined`, which fails the tilePainted()
// guard and costs a retry at best; the real bitmap is then never closed, which at an 8192 pass is
// 256 MB leaked per tile on a machine the pool already has to nurse for memory.
{
  ok('the pool discriminates the ack before resolving', POOL.includes("if (e.data.type === 'ack') {"));
  const arm = POOL.slice(POOL.indexOf("if (e.data.type === 'ack')"), POOL.indexOf('tr.f = performance.now()'));
  ok('the ack arm returns rather than falling through', /return;/.test(arm));
  ok('and never reaches res() on that arm', !/\bres\(/.test(arm));
  // ABLATION: without the guard the FIRST message of every pass settles the tile.
  const broken = POOL.replace(arm, '');
  ok('ablation: dropping the ack guard is visible from here',
     broken !== POOL && !broken.includes("e.data.type === 'ack'"));

  // The OTHER consumer of the same serialised core: renderTiledParallel draws e.data.bmp with no
  // type test, so an unguarded ack throws inside an onmessage where nothing is listening.
  const rp = SRC.slice(SRC.indexOf('async function renderTiledParallel('), SRC.indexOf('async function tilePool('));
  ok('renderTiledParallel ignores the ack too', rp.includes("if (e.data.type === 'ack') return;"));
}

// ---- the busy count has to be read on the right side of the flag --------------------------------
// Off by one in either direction turns a full pipeline into a seven-eighths one and back, which is
// exactly the distinction the trace exists to make.
{
  const flag = POOL.indexOf('q.busy = true;');
  const bD = POOL.indexOf('bD: busyCount()');
  ok('bD is read AFTER the worker is marked busy', flag > 0 && bD > flag, 'busy=true@' + flag + ' bD@' + bD);
  const bF = POOL.indexOf('tr.bF = busyCount()');
  const settle = POOL.indexOf('poolSettle(q, tr.f - t0)');
  ok('bF is read BEFORE poolSettle frees the worker', bF > 0 && settle > bF, 'bF@' + bF + ' settle@' + settle);
  ok('the ack arm samples it too, so a starved thread is visible', /r\.bS = busyCount\(\)/.test(POOL));
}

// ---- a worker's name must survive the array it lives in -----------------------------------------
// poolSettle splices the pool when it sheds, so a position is not an identity: index 3 before a shed
// and index 3 after are different workers, and a trace keyed on position blames the wrong one.
{
  ok('the id is assigned at creation', /pool\.push\(\{ w, busy: false, id: i \}\)/.test(SRC));
  ok('the trace carries that id, not an array position', /k: q\.id/.test(POOL));
  const settle = SRC.slice(SRC.indexOf('function poolSettle('), SRC.indexOf('const start = (idx) =>'));
  ok('shedding still splices, which is why the id is needed', /pool\.splice\(i, 1\)/.test(settle));
}

// ---- the series must stay uniform AND bounded, proved by running it -----------------------------
// The strong half of the file. Decimation is arithmetic, and arithmetic goes wrong in ways no text
// match sees: a halving that forgets to widen the stated interval leaves a series whose first half is
// 250 ms apart and whose second half is 500, which reads as the pool recovering when nothing changed
// but the bookkeeping.
{
  const fn = SRC.match(/const poolTick = \(v\) => \{[\s\S]*?\n      \};/);
  ok('poolTick is extractable, so this gate runs the REAL one', !!fn);

  const run = (src, ticks, cap = 4096) => {
    const PT = { t0: 0, ms: 250, every: 1, tick: 0, v: [] };
    const body = src.replace('const poolTick = (v) =>', 'return (v) =>').replace(/;$/, '');
    const tick = new Function('PT', 'TRACE_ROWS', body)(PT, cap);
    for (let i = 0; i < ticks; i++) tick(i);                  // the value IS the raw sample number
    return PT;
  };
  const uniform = PT => {
    for (let k = 0; k < PT.v.length; k++) if (PT.v[k] !== k * PT.every) return false;
    return true;
  };

  const PT = run(fn[0], 60000);
  ok('bounded however long the render runs', PT.v.length <= 4096, PT.v.length + ' kept of 60,000 ticks');
  ok('the stated interval widened to match', PT.ms === 250 * PT.every, PT.ms + ' ms, every ' + PT.every);
  ok('every kept sample sits exactly one interval from the last', uniform(PT),
     'head ' + PT.v.slice(0, 4).join(',') + ' tail ' + PT.v[PT.v.length - 1]);
  ok('and the series still starts at the first tick', PT.v[0] === 0);

  // ABLATION 1: forget to widen the interval. The BOUND still passes; uniformity goes red.
  const A = run(fn[0].replace('PT.every *= 2;', ''), 60000);
  ok('ablation: an un-widened interval is caught by the uniformity test',
     !uniform(A), 'bounded=' + (A.v.length <= 4096) + ' uniform=' + uniform(A));

  // ABLATION 2: drop the decimation. UNIFORMITY still passes; the bound goes red.
  const B = run(fn[0].replace(/if \(PT\.v\.length >= TRACE_ROWS\) \{[\s\S]*?\n        \}/, ''), 60000);
  ok('ablation: no decimation at all is caught by the bound', B.v.length > 4096, B.v.length + ' kept');
  ok('           and that ablation is otherwise sound, so the two tests are independent', uniform(B));
}

// ---- it must stop when the pool does ------------------------------------------------------------
// A setInterval reading a getter on a closed pool runs for as long as the tab lives.
{
  const win = SRC.slice(SRC.indexOf('ptTimer = setInterval'), SRC.indexOf('}, PT_TICK);') + 14);
  ok('the timer clears itself once the pool is gone',
     /if \(!pool\) \{ clearInterval\(ptTimer\); ptTimer = 0; return; \}/.test(win));
  const sites = (SRC.match(/pool\.close\(\); pool = null;/g) || []).length;
  ok('and every path nulls the pool, success and throw alike', sites >= 2, sites + ' sites');
}

// ---- one fact, one copy --------------------------------------------------------------------------
// A tile's coordinates are i % rAcross and i / rAcross. Storing them would be a second copy that can
// disagree with the first; what the gate owes instead is proof the derivation is POSSIBLE from what
// the master already records.
{
  const meta = SRC.slice(SRC.indexOf('trace: poolRan ?'), SRC.indexOf('trace: poolRan ?') + 600);
  ok('the trace stores the pass index', /\bi: trI\b/.test(meta));
  // Without an absolute, the passes and the busy series are two records that cannot be laid over
  // each other - and laying them over each other IS the measurement.
  ok('and an absolute dispatch time to place it on the busy series', /\bd: trD\b/.test(meta));
  ok('that absolute shares the series epoch, not the export clock',
     /trD\.push\(Math\.round\(st\.d - PT\.t0\)\)/.test(SRC));
  ok('and not a duplicate coordinate pair', !/\bgx:|\bgy:/.test(meta));
  ok('the master records the pass size the coordinates derive from', /\brender: p\.ts\b/.test(SRC));
  ok('and the picture width beside it', /\bw: W\b/.test(SRC));
}

// ---- absent means single-threaded, never "no stall" ---------------------------------------------
{
  ok('the whole block is absent when nothing was pooled', /trace: poolRan \? \{/.test(SRC));
  ok('it says so when the row cap truncated it', /capped: trI\.length >= TRACE_ROWS \|\| undefined/.test(SRC));
  // FIVE STAMPS, NOT FOUR. Finished and handed-over are different events because the consumer takes
  // passes in order, and the gap between them is the tile sitting in `inflight` holding a window slot
  // that `start` then refuses to reuse - the stall itself. Conflated into one number it read as a
  // four-second write, measured live at a 4096 stone pass where the real write was 500 ms.
  ok('dwell is recorded apart from the write', /trDw\.push\(Math\.round\(tCons - st\.f\)\)/.test(SRC));
  ok('and the write is measured from the handover, not from the finish',
     /trW\.push\(Math\.round\(performance\.now\(\) - tCons\)\)/.test(SRC));
  ok('the handover instant is taken where the canvas arrives', /tCons = performance\.now\(\);/.test(SRC));
  ok('both reach the master', SRC.includes('dw: trDw') && SRC.includes('r: trR, dw: trDw'));
  ok('a missing ack is recorded as -1, never as zero queue time',
     /trQ\.push\(Math\.round\(st\.s \? st\.s - st\.d : -1\)\)/.test(SRC));
  ok('the row cap is stated in the block, so a reader knows it is whole', /rows: trI\.length/.test(SRC));
}

console.log('');
if (fails) { console.error('check-pool-trace: ' + fails + ' FAILED'); process.exit(1); }
console.log('check-pool-trace: the four stamps sit on the right side of their flags, the busy series is');
console.log('                  uniform and bounded, and an ack can never be read as a tile.');

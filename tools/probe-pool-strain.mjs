// THE POOL MEASURES HOW HARD IT IS FINDING THE RENDER, AND DOES NOTHING ABOUT IT.
//
// It used to shed a worker when the figure got high enough. This file was `probe-pool-shed.mjs` and
// most of it tested that shedding: when it fired, how far it walked, when it stopped, and when it gave
// a worker back. None of that exists now, and the reason is in `app/stone-author.html` beside
// STRAIN_AT: the comment justifying the threshold said the mechanism "still caught swapping at 5-20x",
// and across seventeen renders on five devices and three engines - every one at a pool footprint where
// paging was arithmetically impossible - the readings spanned 1x to 18x. The range it fired on is a
// SUBSET of the range it false-fires on. Measured cost on one machine two days apart: 27% on a 262,144
// that shed 8 workers to 3, and 13% on a 1,048,576 that shed to 5.
//
// SO THE SUBJECT IS NOW THE MEASUREMENT. Three things have to hold:
//
//   1  the width NEVER MOVES after the ramp, whatever the figures say   (case B, and its ablation)
//   2  the figures are still worth recording - a row median a band cannot manufacture, a short window
//      that does not shrink, thresholds lifted from the app rather than copied   (C, D, E)
//   3  the tile ladder still bounds the footprint those figures are about   (the ban claims)
//
// CASE B IS AN ASSERTION THAT NOTHING HAPPENS, which cannot bite on its own - so the ablation at the
// end puts a `target--` back and requires B to go red. Without it this file would pass against a pool
// that sheds on every pass.
//
//   node tools/probe-pool-strain.mjs
import { readFileSync } from 'fs';

const SRC = readFileSync(new URL('../app/stone-author.html', import.meta.url), 'utf8');
const NL = String.fromCharCode(10);

function liftFn(name) {
  // AMBIGUITY IS AN ERROR, not a tie to break by position. `settle` existed twice in this file and the
  // first match was an unrelated speck routine, so the probe lifted code it had never read and died on
  // a TypeError rather than on a claim. A probe that silently tests the wrong subject is worse than one
  // that does not run.
  const needle = 'function ' + name + '(';
  const hits = [];
  for (let k = SRC.indexOf(needle); k >= 0; k = SRC.indexOf(needle, k + 1)) hits.push(k);
  if (!hits.length) throw new Error('cannot find function ' + name + ' - probe is stale');
  if (hits.length > 1) throw new Error(name + ' is defined ' + hits.length + ' times - lift is ambiguous');
  let i = SRC.indexOf('{', hits[0]), d = 0;
  for (;; i++) { if (SRC[i] === '{') d++; else if (SRC[i] === '}' && --d === 0) break; }
  return SRC.slice(hits[0], i + 1);
}

// THE WHOLE DECISION, NOT JUST THE FUNCTION. The thresholds and the counters are as much the subject as
// poolSettle is, and a probe that lifted the function and then declared constants of its own would be
// testing a pool of its own invention. The probe supplies only what a BROWSER would: n, the plan, and
// the worker array.
function liftRegion(from, fnName) {
  const a = SRC.indexOf(from);
  if (a < 0) throw new Error('cannot find `' + from + '` - probe is stale');
  if (SRC.indexOf(from, a + 1) >= 0) throw new Error('`' + from + '` is ambiguous - lift is unsafe');
  const b = SRC.indexOf('function ' + fnName + '(', a);
  if (b < 0) throw new Error('cannot find ' + fnName + ' after `' + from + '` - probe is stale');
  let i = SRC.indexOf('{', b), d = 0;
  for (;; i++) { if (SRC[i] === '{') d++; else if (SRC[i] === '}' && --d === 0) break; }
  return SRC.slice(a, i + 1);
}
const REGION = liftRegion('const STRAIN_AT = p.fin', 'poolSettle');

// WHAT IS LIFTED IS THE EXPRESSION, NOT ITS SHAPE. The strain level scales with how oversubscribed the
// machine is, and an earlier version of this parsed a floor and a slope out of that line and rebuilt the
// formula here - which meant holding the app to a formula of its own that merely resembled it. Measured:
// with the ratio ABLATED UPSIDE DOWN not one claim went red, because the rebuilt formula was rescaled by
// the same parse. So the app's own expression is evaluated against a stubbed navigator.
const M = SRC.match(/const STRAIN_AT = p\.fin \? ([^:]+?) : (\d+);/);
if (!M) throw new Error('cannot find STRAIN_AT - probe is stale');
const FIN_SRC = M[1].trim(), STRAIN_AT = Number(M[2]);
const strainFin = (workers, cores) =>
  new Function('n', 'navigator', 'return (' + FIN_SRC + ');')(workers, { hardwareConcurrency: cores });

const WIDTH = liftFn('poolWidthFor');
const PMAX = Number(liftSliceNum('const POOL_MAX = (\\d+);'));
function liftSliceNum(re) { const m = SRC.match(new RegExp(re)); return m ? m[1] : null; }
if (!PMAX) throw new Error('cannot find POOL_MAX - probe is stale');
const widthOn = (cores, room) =>
  new Function('navigator', 'POOL_MAX', 'EXP_FORCE_SEQ', 'corePaintsThis',
    WIDTH + NL + 'return poolWidthFor(' + room + ', 1);')(
    { hardwareConcurrency: cores }, PMAX, false, () => true);

// Rebuild the closure the measurement lives in: the same names, the same initial values, fake workers.
function makePool(n, opts = {}) {
  const across = opts.across != null ? opts.across : 8;
  const cores = opts.cores != null ? opts.cores : 12;
  const killed = [], pool = [];
  for (let i = 0; i < n; i++) pool.push({ busy: true, id: i, w: { terminate() { killed.push(i); } } });
  const api = new Function('n', 'p', 'pool', 'killed', 'navigator',
    (opts.region || REGION) + NL + `
    return {
      settle: ms => { const q = pool.find(x => x.busy) || pool[0]; q.busy = true; poolSettle(q, ms); },
      state: () => ({ target, base, alive: pool.length, killed: killed.length,
                      strain: { ...strain }, at: STRAIN_AT, row: ROW, short: SHORT }),
    };`)(n, { fin: !!opts.fin, rAcross: across }, pool, killed, { hardwareConcurrency: cores });
  return { ...api, across };
}

// ONE ROW, THE SHAPE A DISC ACTUALLY MAKES: `hi` tiles at `mult` x the baseline, CONTIGUOUS, then the
// rest at 1x. Contiguity is the point - a disc covers a column range, so its expensive tiles arrive
// together, which is exactly how they came to fill a window shorter than a row.
const feedRow = (P, hi, mult, base = 1000) => {
  for (let i = 0; i < P.across; i++) P.settle(i < hi ? mult * base : base);
};

let fails = 0;
const claim = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `${NL}          got  ${JSON.stringify(got)}${NL}          want ${JSON.stringify(want)}`}`);
};

console.log(NL + 'strain levels: ' + STRAIN_AT + 'x the solo tile when the worker only paints,'
  + NL + '               ' + strainFin(2, 4096).toFixed(2) + 'x - ' + strainFin(8, 8).toFixed(2)
  + 'x when it finishes the tile too, by how oversubscribed the machine is' + NL);

console.log('A  the ramp: the first tile paints alone and becomes the baseline');
{
  const P = makePool(8);
  claim('starts at one worker, so tile 0 is uncontended', P.state().target, 1);
  P.settle(1000);
  const s = P.state();
  claim('that tile sets the baseline', s.base, 1000);
  claim('and the pool opens to its planned width', s.target, 8);
}

console.log(NL + 'B  AND THE WIDTH NEVER MOVES AGAIN, whatever the figures say');
{
  // Every one of these used to take workers away. The 10,000 ms case walked a pool of eight down to
  // two; the 5,000 ms case was the original red input for the shed heuristic.
  for (const [what, ms, times] of [['1.2x, a pool with room', 1200, 40],
                                   ['5x, the old red input', 5000, 40],
                                   ['20x, past the old panic figure', 20000, 40],
                                   ['100x, a machine in real trouble', 100000, 200]]) {
    const P = makePool(8, { fin: true, cores: 12 }); P.settle(1000);
    for (let i = 0; i < times; i++) P.settle(ms);
    const s = P.state();
    claim(what + ' -> still 8 wide, nothing terminated', [s.target, s.killed, s.alive], [8, 0, 8]);
  }
}

console.log(NL + 'C  but it is all recorded');
{
  const P = makePool(8, { fin: true, cores: 12 }); P.settle(1000);
  for (let i = 0; i < 40; i++) P.settle(20000);
  const s = P.state();
  claim('20x counts against the panic figure', s.strain.panic > 0, true);
  claim('and against the strain level', s.strain.over > 0, true);
  claim('and the worst ratio is kept', s.strain.max, 20);
}
{
  const P = makePool(8, { fin: true, cores: 12 }); P.settle(1000);
  for (let i = 0; i < 40; i++) P.settle(1200);
  claim('1.2x is a working pool and counts as nothing', P.state().strain, { over: 0, panic: 0, max: 1 });
}

console.log(NL + 'D  the window is a ROW, so a band cannot manufacture the figure');
{
  // THE DEFECT THIS WAS FOR, measured. A reality window on a 262,144 made eight CONSECUTIVE tiles
  // expensive, an eight-tile median read 6x, and the pool shed five workers for it. A disc is the same
  // share of a ROW at every image size, which is what makes the row the one window it cannot carry.
  for (const across of [32, 64]) {
    const hi = Math.round(across * 0.46);
    const P = makePool(8, { across, fin: true, cores: 12 }); P.settle(1000);
    for (let r = 0; r < 6; r++) feedRow(P, hi, 6);
    claim('across ' + across + ': ' + hi + ' of ' + across + ' tiles at 6x is a disc, not strain',
      P.state().strain.over, 0);
  }
  const Q = makePool(8, { across: 64, fin: true, cores: 12 }); Q.settle(1000);
  for (let r = 0; r < 3; r++) feedRow(Q, 64, 6);
  claim('a WHOLE row at 6x is not a disc, and is recorded', Q.state().strain.over > 0, true);

  // WHERE THE FIRST READING LANDS SAYS HOW BIG THE WINDOW IS. It used to be Math.max(2, target) and
  // landed at tile 8 whatever the image was, so a narrowing render decided on three or four samples.
  const firstAt = across => {
    const P = makePool(8, { across, fin: true, cores: 12 }); P.settle(1000);
    for (let i = 1; i <= across * 3; i++) { P.settle(6000); if (P.state().strain.over) return i; }
    return -1;
  };
  claim('the row figure waits for a full ROW of evidence', [firstAt(16), firstAt(64)], [16, 64]);
}

console.log(NL + 'E  the short window is one pass of the PLANNED pool, and constant');
{
  const a = makePool(8, { across: 64, fin: true }).state();
  const b = makePool(4, { across: 64, fin: true }).state();
  claim('it follows the planned width, not a literal', [a.short, b.short], [8, 4]);
  claim('and the row follows the plan, not the pool', [a.row, b.row], [64, 64]);
}

console.log(NL + 'F  the strain level is the app’s own expression, on every machine in the fleet');
{
  // A worker that paints, reads back and deflates its own tile legitimately costs 3-4x a solo pass, so
  // the finish level sits above that. How far above depends on the machine, and these are not written
  // here - they are the app's expression evaluated at the worker/core shapes in .claude/master-meta.
  for (const [what, pool, hc] of [['win-chrome      8 of 12', 8, 12],
                                  ['android-chrome  8 of  8', 8, 8],
                                  ['ios-safari      4 of  4', 4, 4]]) {
    const at = strainFin(pool, hc);
    const P = makePool(pool, { fin: true, cores: hc }); P.settle(1000);
    claim(what + ' -> ' + at.toFixed(2) + 'x : the running pool agrees with the lifted expression',
      P.state().at, at);
  }
  claim('a box running one worker per core tolerates MORE than one with cores to spare',
    strainFin(4, 4) > strainFin(8, 12), true);
  claim('it never drops to the plain-paint level, however many spare cores there are',
    strainFin(2, 4096) > STRAIN_AT, true);
}

console.log(NL + 'G  8192 is unreachable as a tile size, which is what bounds the footprint');
{
  const ladder = JSON.parse(SRC.match(/const TILE_LADDER = (\[[0-9, ]*\]);/)[1]);
  claim('the ladder tops out at 4096', Math.max(...ladder), 4096);
  claim('and it is the ladder the canvasFits probe iterates',
    SRC.includes('for (const ts of TILE_LADDER) {'), true);
  claim('the planner starts at TILE_MAX rather than a number of its own',
    SRC.includes('let ts = Math.min(W, TILE_MAX);'), true);
  claim('and ?tile= cannot name a size the planner will not consider',
    SRC.includes('v >= 256 && v <= TILE_MAX ? v : 0'), true);
  const bleed = 4, tileMB = t => Math.round((t + 2 * bleed) ** 2 * 4 / 1e6);
  const peak = PMAX * tileMB(Math.max(...ladder));
  claim('so the pool can never hold more than 550 MB of tiles (' + PMAX + ' x '
    + tileMB(Math.max(...ladder)) + ' MB = ' + peak + ' MB)', peak <= 550, true);
  claim('where the banned size would have allowed over 2 GB (' + PMAX + ' x ' + tileMB(8192) + ' MB)',
    PMAX * tileMB(8192) > 2000, true);
  let bad = [];
  for (let hc = 2; hc <= 64; hc++) for (const room of [2, 3, 8, 64, 4096]) {
    const w = widthOn(hc, room);
    if (w && w > hc) bad.push(w + ' on ' + hc);
  }
  claim('poolWidthFor never returns more workers than cores', bad, []);
}

console.log(NL + 'ablation: a shed put back');
{
  // CASE B ASSERTS THAT NOTHING HAPPENS, and an assertion that nothing happens cannot bite on its own.
  // This puts the old action back - one decrement, guarded exactly as it used to be - and requires B to
  // notice. Without this the file passes against a pool that sheds on every pass.
  const acts = REGION.replace('if (med > STRAIN_AT * base) strain.over++;',
                              'if (med > STRAIN_AT * base) { strain.over++; if (target > 2) target--; }');
  if (acts === REGION) { console.log('  FAIL  could not find the row branch to ablate - probe is stale'); fails++; }
  else {
    const P = makePool(8, { region: acts, fin: true, cores: 12 }); P.settle(1000);
    for (let i = 0; i < 200; i++) P.settle(20000);
    claim('case B stops biting: the width walks down to the old floor', P.state().target, 2);
  }
}

console.log(NL + 'ablation: the row comparison neutered');
{
  const flat = REGION.replace('if (med > STRAIN_AT * base) strain.over++;', '');
  if (flat === REGION) { console.log('  FAIL  could not find the row comparison to ablate - probe is stale'); fails++; }
  else {
    const P = makePool(8, { region: flat, fin: true, cores: 12 }); P.settle(1000);
    for (let i = 0; i < 40; i++) P.settle(20000);
    claim('cases C and D stop biting: nothing is recorded at the row', P.state().strain.over, 0);
  }
}

console.log(NL + 'ablation: the panic comparison neutered');
{
  const slow = REGION.replace('if (m >= PANIC * base) strain.panic++;', '');
  if (slow === REGION) { console.log('  FAIL  could not find the panic comparison to ablate - probe is stale'); fails++; }
  else {
    const P = makePool(8, { region: slow, fin: true, cores: 12 }); P.settle(1000);
    for (let i = 0; i < 40; i++) P.settle(20000);
    claim('case C stops biting on the short window', P.state().strain.panic, 0);
  }
}

console.log(fails ? `${NL}${fails} FAILED${NL}` : NL + 'all claims hold' + NL);
process.exit(fails ? 1 : 0);

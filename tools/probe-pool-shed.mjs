// DOES THE POOL NOTICE IT IS TOO WIDE?
//
// The width comes from memBudget(), which is navigator.deviceMemory x MEM_SHARE - the machine's TOTAL
// memory, not what is free on it. Measured on a 16 GB desktop with roughly 2300 MB actually free, that
// budget read 12885 MB; eight 8192 tiles allocated inside it without a single throw and then paged for
// three hours. Nothing in the browser will report free memory (deviceMemory is total, performance.memory
// is the JS heap and canvases are not in it, measureUserAgentSpecificMemory needs a cross-origin
// isolation a single file on Pages cannot set), and an allocation probe agrees with the fiction because
// PAGING DOES NOT FAIL - it just takes longer.
//
// So the pool measures. The first tile paints alone and its time is the baseline; afterwards a pool with
// room costs about that per tile and a pool that is swapping costs several times it.
//
// THE INPUT THAT MAKES THIS RED is case C: a baseline of 1000ms and a run of tiles at 5x it. Before the
// ramp-and-shed the pool held its planned width for all 640 tiles whatever the machine did. The ablation
// neuters the contention comparison and requires C to stop shedding.
//
//   node tools/probe-pool-shed.mjs
import { readFileSync } from 'fs';

const SRC = readFileSync(new URL('../app/stone-author.html', import.meta.url), 'utf8');

function liftFn(name) {
  // AMBIGUITY IS AN ERROR, not a tie to break by position. `settle` existed twice in this file and the
  // first match was an unrelated speck routine, so the probe lifted code it had never read and died on
  // a TypeError rather than on a claim. A probe that silently tests the wrong subject is worse than one
  // that does not run.
  const needle = 'function ' + name + '(';                 // indexOf, not a built regex: the '(' needs
  const hits = [];                                         // escaping and an escape built through a
  for (let k = SRC.indexOf(needle); k >= 0; k = SRC.indexOf(needle, k + 1)) hits.push(k);
  if (!hits.length) throw new Error('cannot find function ' + name + ' - probe is stale');
  if (hits.length > 1) throw new Error(name + ' is defined ' + hits.length + ' times - lift is ambiguous');
  let i = SRC.indexOf('{', hits[0]), d = 0;
  for (;; i++) { if (SRC[i] === '{') d++; else if (SRC[i] === '}' && --d === 0) break; }
  return SRC.slice(hits[0], i + 1);
}
const SETTLE = liftFn('poolSettle');
// TWO THRESHOLDS NOW, because a worker that finishes its own tile does more and contends more.
// Lifted rather than copied, so the probe cannot drift from the app it is testing.
//
// WHAT IS LIFTED IS THE EXPRESSION, NOT ITS SHAPE. The finish threshold scales with how
// oversubscribed the machine is, and the first version of this parsed a floor and a slope out of
// that line and rebuilt the formula here - which meant the probe held the app to a formula of its
// own that merely resembled it. Measured: with the ratio ABLATED UPSIDE DOWN not one claim went
// red, because the rebuilt formula was rescaled by the same parse and the bound became a
// tautology; and the monotonicity claim had no red input at all. So the app's own expression is
// evaluated here against a stubbed navigator. A wrong edit to its shape is now something these
// claims can SEE rather than something that quietly stops them lifting.
const M = SRC.match(/const SHED_AT = p\.fin \? ([^:]+?) : (\d+);/);
if (!M) throw new Error('cannot find SHED_AT - probe is stale');
const FIN_SRC = M[1].trim(), SHED_AT = Number(M[2]);
const shedFin = (workers, cores) =>
  new Function('n', 'navigator', 'return (' + FIN_SRC + ');')(workers, { hardwareConcurrency: cores });

// The width the app would actually choose on a given machine, lifted the same way - because the
// threshold's upper bound is a property of THIS, not of the expression above.
const WIDTH = liftFn('poolWidthFor');
const PMAX = Number((SRC.match(/const POOL_MAX = (\d+);/) || [])[1]);
if (!PMAX) throw new Error('cannot find POOL_MAX - probe is stale');
const widthOn = (cores, room) =>
  new Function('navigator', 'POOL_MAX', 'EXP_FORCE_SEQ', 'corePaintsThis',
    WIDTH + String.fromCharCode(10) + 'return poolWidthFor(' + room + ', 1);')(
    { hardwareConcurrency: cores }, PMAX, false, () => true);

// Rebuild the closure settle() lives in: the same names, the same initial values, fake workers.
function makePool(n, settleSrc = SETTLE, shedAt = SHED_AT) {
  return new Function('n', 'SHED_AT', `
    let target = 1, base = 0;
    const recent = [], shedLog = [];
    // Mirrors the app: the median that triggered the last shed, and the latch that stops shedding
    // once a shed has failed to help. Kept in step by hand, which is why case D exists - if the app
    // gains more shed state and this does not, D is what notices.
    let lastShedMed = 0, shedDone = false;
    const killed = [];
    const pool = []; for (let i = 0; i < n; i++) pool.push({ busy: true, w: { terminate() { killed.push(i); } } });
    ${settleSrc}
    return {
      settle: ms => { const q = pool.find(x => x.busy) || pool[0]; q.busy = true; poolSettle(q, ms); },
      state: () => ({ target, base, alive: pool.length, shed: shedLog.slice(), killed: killed.length }),
    };`)(n, shedAt);
}

let fails = 0;
const claim = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`}`);
};

console.log(String.fromCharCode(10) + 'shed thresholds: ' + SHED_AT + 'x the solo tile when the worker only paints,'
  + String.fromCharCode(10) + '                 ' + shedFin(2, 4096).toFixed(2) + 'x - ' + shedFin(8, 8).toFixed(2)
  + 'x when it finishes the tile too, by how oversubscribed the machine is' + String.fromCharCode(10));

console.log('A  the ramp: the first tile paints alone and becomes the baseline');
{
  const P = makePool(8);
  claim('starts at one worker, so tile 0 is uncontended', P.state().target, 1);
  P.settle(1000);
  const s = P.state();
  claim('that tile sets the baseline', s.base, 1000);
  claim('and the pool opens to its planned width', s.target, 8);
}

console.log('\nB  a machine with room: eight tiles at 1.2x the solo time');
{
  const P = makePool(8); P.settle(1000);
  for (let i = 0; i < 16; i++) P.settle(1200);
  const s = P.state();
  claim('stays at full width', s.target, 8);
  claim('nothing shed', s.shed, []);
  claim('no worker terminated', s.killed, 0);
}

console.log('\nC  a machine that is swapping: tiles at 5x the solo time');
{
  const P = makePool(8); P.settle(1000);
  for (let i = 0; i < 8; i++) P.settle(5000);
  const s = P.state();
  claim('drops a worker', s.target, 7);
  claim('and says what it saw', s.shed, ['7@5x']);
  claim('the shed worker is TERMINATED, not left holding its canvas', s.killed, 1);
  claim('the live pool shrinks with it', s.alive, 7);
}

console.log('\nD  it keeps shedding while the contention holds, and stops at two');
{
  const P = makePool(8); P.settle(1000);
  for (let i = 0; i < 200; i++) P.settle(10000);
  const s = P.state();
  claim('floors at two - one worker is slower than no worker', s.target, 2);
  claim('six terminated, two alive', [s.killed, s.alive], [6, 2]);
}

console.log(String.fromCharCode(10) + 'D2 shedding that makes things WORSE stops, instead of running to two');
{
  // Measured on a daylight 131,072 finishing in-worker: 7@3x, 6@4x, 5@3x, 4@7x, 3@7x, 2@3x. It shed
  // six times, the ratio CLIMBED as workers left, and it arrived at two having taken 159 s where the
  // UV equivalent shed once and took 51. Workers that are contending are not workers that are
  // swapping, and taking them away cannot help - fewer tiles in flight is always less memory, so a
  // rising median while shedding means memory was never the problem.
  const P = makePool(8); P.settle(1000);
  for (let i = 0; i < 8; i++) P.settle(4000);     // 4x: over the threshold, so it sheds
  for (let i = 0; i < 96; i++) P.settle(9000);    // and then WORSE as it narrows
  const s = P.state();
  claim('it stops above the floor rather than running down to two', s.target > 2, true);
  claim('and says so in the trail', s.shed.some(x => String(x).startsWith('held@')), true);
}

console.log(String.fromCharCode(10) + 'F  the finish path tolerates the contention it causes - on EVERY machine in the fleet');
{
  // A worker that paints its tile, reads it back and deflates it legitimately costs 3-4x a solo
  // pass, so the finish threshold has to sit above that. HOW FAR above depends on the machine, and
  // the thresholds below are not written here - they are the app's own expression, evaluated at the
  // worker/core shapes actually recorded in .claude/master-meta.
  //
  // THE DESKTOP IS THE LEAST CONTENDED BOX IN THE FLEET, and it is the one every finish number was
  // measured on: POOL_MAX caps it at 8 workers across 12 cores, while every handheld in the record
  // runs one worker per core. A single flat threshold tuned there is tuned to the best case and
  // sheds on everything else at ordinary load - which is the whole reason this scales.
  const FLEET = [
    ['win-chrome      8 workers / 12 cores', 8, 12],
    ['android-chrome  8 workers /  8 cores', 8, 8],
    ['ios-safari      4 workers /  4 cores', 4, 4],
  ];
  for (const [what, pool, hc] of FLEET) {
    const at = shedFin(pool, hc), tag = what + ' -> ' + at.toFixed(2) + 'x';
    const P = makePool(pool, SETTLE, at); P.settle(1000);
    for (let i = 0; i < 40; i++) P.settle(4000);
    claim(tag + ' : 4x is the work, not swapping - nothing shed', [P.state().shed, P.state().target], [[], pool]);
    const Q = makePool(pool, SETTLE, at); Q.settle(1000);
    for (let i = 0; i < 40; i++) Q.settle(12000);
    claim(tag + ' : 12x is still trouble, and still sheds', Q.state().target < pool, true);
  }

  // PROPERTIES OF THE SHAPE. This is what evaluating the app's own line can be held to and a
  // copied number cannot: each claim below goes red for a different wrong edit to it.
  claim('a box running one worker per core tolerates MORE than one with cores to spare',
    shedFin(4, 4) > shedFin(8, 12), true);
  claim('it never drops to the plain-paint threshold, however many spare cores there are',
    shedFin(2, 4096) > SHED_AT, true);
  {
    // There IS an upper bound, but it is not a property of that expression - it rests on
    // poolWidthFor clamping the width to the core count, so workers/cores can never exceed one.
    // Lifted and run across the widths it can actually return, rather than asserted. If that
    // clamp ever goes, this is the claim that was resting on it.
    const full = shedFin(8, 8), out = [];
    for (let hc = 2; hc <= 64; hc++) for (const room of [2, 3, 8, 64, 4096]) {
      const n = widthOn(hc, room);
      if (!n) continue;                                  // refused the pool: no threshold to bound
      if (n > hc) { out.push('width ' + n + ' on ' + hc + ' cores'); continue; }
      const v = shedFin(n, hc);
      if (!(v > SHED_AT && v <= full)) out.push(n + ' of ' + hc + ' -> ' + v);
    }
    claim('poolWidthFor never returns more workers than cores, so the threshold stays within ('
      + SHED_AT + ', ' + full + ']', out, []);
    // Two separate `|| 4` fallbacks, one in each lifted line. Change one and not the other and a
    // browser that will not report its cores gets a width and a threshold that disagree.
    claim('a browser that will not say how many cores it has still lands inside that bound',
      [widthOn(undefined, 4096), shedFin(widthOn(undefined, 4096), undefined)], [PMAX / 2, full]);
  }
}

console.log('\nE  a single slow tile is not contention');
{
  const P = makePool(8); P.settle(1000);
  P.settle(9000); for (let i = 0; i < 7; i++) P.settle(1100);
  claim('the median ignores the outlier, so nothing is shed', P.state().shed, []);
}

console.log('\nablation: the contention comparison neutered');
{
  const flat = SETTLE.replace(/med > SHED_AT \* base/, 'false');
  if (flat === SETTLE) { console.log('  FAIL  could not find the comparison to ablate - probe is stale'); fails++; }
  else {
    const P = makePool(8, flat); P.settle(1000);
    for (let i = 0; i < 200; i++) P.settle(10000);
    claim('case C and D stop biting, so they were testing that comparison', P.state().target, 8);
  }
}

console.log(fails ? `\n${fails} FAILED\n` : '\nall claims hold\n');
process.exit(fails ? 1 : 0);

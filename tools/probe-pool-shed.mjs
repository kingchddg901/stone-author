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
const SHED_AT = Number((SRC.match(/const SHED_AT = (\d+)/) || [])[1]);
if (!SHED_AT) throw new Error('cannot find SHED_AT - probe is stale');

// Rebuild the closure settle() lives in: the same names, the same initial values, fake workers.
function makePool(n, settleSrc = SETTLE) {
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
    };`)(n, SHED_AT);
}

let fails = 0;
const claim = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`}`);
};

console.log(`\nSHED_AT = ${SHED_AT}x the solo tile\n`);

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

// DOES THE POOL NOTICE IT IS TOO WIDE - AND NOTICE WHEN IT IS NOT ANY MORE?
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
// AND WHAT A MEASURED 262,144 TAUGHT IT. That render shed five times, 8 workers down to 3, and ran its
// last three-quarters at 2.9 - 423.7 s against the 346 s its own throughput says it should have taken.
// Nothing in it was swapping. A reality window makes a band of tiles that legitimately cost 5-6x a
// baseline taken on a tile the disc never touched, and the old 8-tile measurement window could be
// filled entirely by that band - which is why the same slab at 131,072 lost 5 s and at 262,144 lost 78.
// Cases G through L are that lesson: measure over a ROW so a band cannot carry the median, shed fast
// anyway when the figure is past arguing with, and give a worker back when the pressure lifts.
//
//   node tools/probe-pool-shed.mjs
import { readFileSync } from 'fs';

const SRC = readFileSync(new URL('../app/stone-author.html', import.meta.url), 'utf8');
const NL = String.fromCharCode(10);

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

// THE WHOLE DECISION, NOT JUST THE FUNCTION. The thresholds, the latches and the counters are as much
// the subject as poolSettle is, and a probe that lifted the function and then declared constants of its
// own would be testing a pool of its own invention. So the lift runs from the first threshold to the end
// of poolSettle, and the probe supplies only what a BROWSER would: n, the plan, the worker array and a
// spawn. Everything that decides anything comes from the app.
function liftRegion(from, fnName) {
  const a = SRC.indexOf(from);
  if (a < 0) throw new Error('cannot find `' + from + '` - probe is stale');
  if (SRC.indexOf(from, a + 1) >= 0) throw new Error('`' + from + '` is ambiguous - lift is unsafe');
  const needle = 'function ' + fnName + '(';
  const b = SRC.indexOf(needle, a);
  if (b < 0) throw new Error('cannot find ' + fnName + ' after `' + from + '` - probe is stale');
  let i = SRC.indexOf('{', b), d = 0;
  for (;; i++) { if (SRC[i] === '{') d++; else if (SRC[i] === '}' && --d === 0) break; }
  return SRC.slice(a, i + 1);
}
const REGION = liftRegion('const SHED_AT = p.fin', 'poolSettle');

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
    WIDTH + NL + 'return poolWidthFor(' + room + ', 1);')(
    { hardwareConcurrency: cores }, PMAX, false, () => true);

// Rebuild the closure the decision lives in: the same names, the same initial values, fake workers.
// GROWING IS ASYNC in the app - a worker has to start and take its modulator bitmaps before it can be
// handed a tile - so settle() flushes microtasks afterwards and every case awaits it. A probe that
// stayed synchronous would see exactly one recovery and never a second, because the guard that stops
// two spawns racing is cleared in a `finally`.
const flush = async () => { for (let i = 0; i < 4; i++) await null; };
function makePool(n, opts = {}) {
  const across = opts.across != null ? opts.across : 8;
  const cores = opts.cores != null ? opts.cores : 12;
  const killed = [], pool = [];
  for (let i = 0; i < n; i++) pool.push({ busy: true, w: { terminate() { killed.push(i); } } });
  const api = new Function('n', 'p', 'pool', 'killed', 'navigator', 'spawnWorker',
    (opts.region || REGION) + NL + `
    return {
      settle: ms => { const q = pool.find(x => x.busy) || pool[0]; q.busy = true; poolSettle(q, ms); },
      state: () => ({ target, base, alive: pool.length, shed: shedLog.slice(),
                      killed: killed.length, shedAt: SHED_AT }),
    };`)(n, { fin: !!opts.fin, rAcross: across }, pool, killed,
         { hardwareConcurrency: cores },
         () => Promise.resolve({ terminate() { killed.push(-1); } }));
  return { settle: async ms => { api.settle(ms); await flush(); }, state: api.state, across };
}

// ONE ROW, THE SHAPE A DISC ACTUALLY MAKES: `hi` tiles at `mult` x the baseline, CONTIGUOUS, then the
// rest of the row at 1x. Contiguity is the whole point - a disc covers a column range, so its
// expensive tiles arrive together, which is exactly how they came to fill an 8-tile window.
const feedRow = async (P, hi, mult, base = 1000) => {
  for (let i = 0; i < P.across; i++) await P.settle(i < hi ? mult * base : base);
};
const plusses = P => P.state().shed.filter(x => String(x).startsWith('+'));

let fails = 0;
const claim = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `${NL}          got  ${JSON.stringify(got)}${NL}          want ${JSON.stringify(want)}`}`);
};

console.log(NL + 'shed thresholds: ' + SHED_AT + 'x the solo tile when the worker only paints,'
  + NL + '                 ' + shedFin(2, 4096).toFixed(2) + 'x - ' + shedFin(8, 8).toFixed(2)
  + 'x when it finishes the tile too, by how oversubscribed the machine is' + NL);

console.log('A  the ramp: the first tile paints alone and becomes the baseline');
{
  const P = makePool(8);
  claim('starts at one worker, so tile 0 is uncontended', P.state().target, 1);
  await P.settle(1000);
  const s = P.state();
  claim('that tile sets the baseline', s.base, 1000);
  claim('and the pool opens to its planned width', s.target, 8);
}

console.log(NL + 'B  a machine with room: tiles at 1.2x the solo time');
{
  const P = makePool(8); await P.settle(1000);
  for (let i = 0; i < 16; i++) await P.settle(1200);
  const s = P.state();
  claim('stays at full width', s.target, 8);
  claim('nothing shed', s.shed, []);
  claim('no worker terminated', s.killed, 0);
}

console.log(NL + 'C  a machine that is swapping: tiles at 5x the solo time');
{
  const P = makePool(8); await P.settle(1000);
  for (let i = 0; i < 8; i++) await P.settle(5000);
  const s = P.state();
  claim('drops a worker', s.target, 7);
  claim('and says what it saw', s.shed, ['7@5x']);
  claim('the shed worker is TERMINATED, not left holding its canvas', s.killed, 1);
  claim('the live pool shrinks with it', s.alive, 7);
}

console.log(NL + 'D  it keeps shedding while the contention holds, and stops at two');
{
  const P = makePool(8); await P.settle(1000);
  for (let i = 0; i < 200; i++) await P.settle(7000);
  const s = P.state();
  claim('floors at two - one worker is slower than no worker', s.target, 2);
  claim('six terminated, two alive', [s.killed, s.alive], [6, 2]);
}

console.log(NL + 'D2 shedding that makes things WORSE stops, instead of running to two');
{
  // Measured on a daylight 131,072 finishing in-worker: 7@3x, 6@4x, 5@3x, 4@7x, 3@7x, 2@3x. It shed
  // six times, the ratio CLIMBED as workers left, and it arrived at two having taken 159 s where the
  // UV equivalent shed once and took 51. Workers that are contending are not workers that are
  // swapping, and taking them away cannot help - fewer tiles in flight is always less memory, so a
  // rising median while shedding means memory was never the problem.
  const P = makePool(8); await P.settle(1000);
  for (let i = 0; i < 8; i++) await P.settle(4000);     // 4x: over the threshold, so it sheds
  for (let i = 0; i < 96; i++) await P.settle(9000);    // and then WORSE as it narrows
  const s = P.state();
  claim('it stops above the floor rather than running down to two', s.target > 2, true);
  claim('and says so in the trail', s.shed.some(x => String(x).startsWith('held@')), true);
}

console.log(NL + 'E  a single slow tile is not contention');
{
  const P = makePool(8); await P.settle(1000);
  await P.settle(9000); for (let i = 0; i < 7; i++) await P.settle(1100);
  claim('the median ignores the outlier, so nothing is shed', P.state().shed, []);
}

console.log(NL + 'F  the finish path tolerates the contention it causes - on EVERY machine in the fleet');
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
    const P = makePool(pool, { fin: true, cores: hc }); await P.settle(1000);
    claim(tag + ' : the running pool agrees with the lifted expression', P.state().shedAt, at);
    for (let i = 0; i < 40; i++) await P.settle(4000);
    claim(tag + ' : 4x is the work, not swapping - nothing shed', [P.state().shed, P.state().target], [[], pool]);
    const Q = makePool(pool, { fin: true, cores: hc }); await Q.settle(1000);
    for (let i = 0; i < 40; i++) await Q.settle(9000);
    claim(tag + ' : 9x is still trouble, and still sheds', Q.state().target < pool, true);
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

console.log(NL + 'G  the measurement window is a ROW, so a band of window tiles cannot carry the median');
{
  // THE DEFECT THIS IS FOR, measured. A reality window on a 262,144 shed five workers, 8 down to 3,
  // every ratio between 5x and 7x, and nothing was swapping: a disc covers a contiguous column
  // range, so 8 CONSECUTIVE tiles inside it were all expensive and an 8-tile median read 6x. The
  // same slab at 131,072 shed twice, because a 15-tile-wide disc fills an 8-tile window less often
  // than a 29-tile-wide one does. THE SIZE DEPENDENCE IS THE BUG, not the threshold - and a row is
  // the unit that removes it, because a disc is the same share of a row at every image size.
  for (const across of [32, 64]) {
    const hi = Math.round(across * 0.46);                // the measured disc: 46% of a row, both sizes
    const P = makePool(8, { across, fin: true, cores: 12 }); await P.settle(1000);
    for (let r = 0; r < 6; r++) await feedRow(P, hi, 6);
    claim('across ' + across + ': ' + hi + ' of ' + across + ' tiles at 6x is a disc, not a swap',
      P.state().shed, []);
  }
  // WHERE THE FIRST SHED LANDS SAYS HOW BIG THE WINDOW IS - the whole fix, stated as a number. The
  // first version of this claim compared the shed logs at across 32 and 64 and called them equal,
  // which they were BEFORE the fix as well: on a synthetic band both sizes run to the floor, so the
  // claim could not go red in either direction and proved nothing. The window's size can be measured
  // directly instead. It used to be Math.max(2, target) and landed at tile 8 whatever the image was.
  const firstShedAt = async (across) => {
    const P = makePool(8, { across, fin: true, cores: 12 }); await P.settle(1000);
    for (let i = 1; i <= across * 3; i++) { await P.settle(6000); if (P.state().shed.length) return i; }
    return -1;
  };
  claim('the first shed waits for a full ROW of evidence, not a pool-width of it',
    [await firstShedAt(16), await firstShedAt(64)], [16, 64]);

  const Q = makePool(8, { across: 64, fin: true, cores: 12 }); await Q.settle(1000);
  for (let r = 0; r < 3; r++) await feedRow(Q, 64, 6);
  claim('a WHOLE row at 6x is not a disc, and still sheds', Q.state().target < 8, true);
}

console.log(NL + 'H  pressure past arguing with does not wait for a row');
{
  // Waiting a whole row for corroboration is the price of G, and on a 2 GB tablet a row of paging
  // tiles is minutes. Dilution is only wanted where the figure is ambiguous; nothing needs a second
  // opinion about 20x. So a short window survives for exactly that.
  const P = makePool(8, { across: 64, fin: true, cores: 12 }); await P.settle(1000);
  for (let i = 0; i < 8; i++) await P.settle(20000);
  claim('20x sheds an eighth of a row in, without waiting for the row', P.state().target, 7);
  claim('and that is the only shed so far', P.state().shed.length, 1);
}

console.log(NL + 'I  a worker comes back at the next row, one per row, never past the planned width');
{
  const P = makePool(8, { across: 16, fin: true, cores: 12 }); await P.settle(1000);
  for (let i = 0; i < 16; i++) await P.settle(20000);
  const low = P.state().target;
  claim('it shed first', low < 8, true);
  // THE MEASUREMENT WINDOW NO LONGER SHRINKS WITH THE POOL. It used to be Math.max(2, target), so at
  // three workers the median was three samples - noisiest exactly where it was most fragile, and the
  // 262,144's last two sheds were decided on four samples and three. One row in, one worker out, at
  // any width, is what proves the cadence constant.
  for (let k = 1; k <= 3; k++) {
    await feedRow(P, 0, 1);
    claim('quiet row ' + k + ' gives back exactly one worker', plusses(P).length, k);
  }
  for (let r = 0; r < 10; r++) await feedRow(P, 0, 1);
  claim('it climbs back to the planned width and stops there', P.state().target, 8);
  claim('and every step is in the trail', plusses(P).length, 8 - low);
}

console.log(NL + 'J  recovery is gated on EVIDENCE, not on the clock');
{
  // 4.5x is not shedding territory at a 5.00x threshold - but it is not room either. A clock that
  // widened on elapsed rows alone would walk straight back into the pressure it had just escaped.
  const P = makePool(8, { across: 16, fin: true, cores: 12 }); await P.settle(1000);
  for (let i = 0; i < 16; i++) await P.settle(20000);
  const low = P.state().target;
  for (let r = 0; r < 10; r++) await feedRow(P, 16, 4.5);
  claim('ten rows at 4.5x: nothing shed and nothing given back',
    [P.state().target, plusses(P)], [low, []]);
}

console.log(NL + 'K  a shed right after a recovery holds the shed for good');
{
  const P = makePool(8, { across: 16, fin: true, cores: 12 }); await P.settle(1000);
  for (let i = 0; i < 16; i++) await P.settle(20000);
  const low = P.state().target;
  await feedRow(P, 0, 1);
  const mid = P.state().target;
  claim('it recovered once', mid, low + 1);
  for (let i = 0; i < 16; i++) await P.settle(20000);   // and the pressure is straight back
  const plusBefore = plusses(P).length;
  for (let r = 0; r < 10; r++) await feedRow(P, 0, 1);
  claim('ten quiet rows afterwards add no further recovery', plusses(P).length, plusBefore);
}

console.log(NL + 'L  the tablet: pressure that never lifts is never recovered from');
{
  // A pool that is genuinely paging shows a median that stays elevated AS WORKERS LEAVE, because
  // fewer tiles in flight is less memory but it is still swapping. That signature is what the
  // recovery gate must be unable to satisfy - this is the case the whole mechanism exists for, and
  // an un-shed must not be able to undo the rescue.
  const P = makePool(4, { across: 16, fin: true, cores: 4 }); await P.settle(2000);
  for (let r = 0; r < 20; r++) await feedRow(P, 16, 19, 2000);
  const s = P.state();
  claim('it sheds to the floor', s.target, 2);
  claim('and never gives a worker back', plusses(P), []);
}

console.log(NL + 'ablation: the row comparison neutered');
{
  const flat = REGION.replace(/med > SHED_AT \* base/, 'false');
  if (flat === REGION) { console.log('  FAIL  could not find the comparison to ablate - probe is stale'); fails++; }
  else {
    const P = makePool(8, { region: flat }); await P.settle(1000);
    for (let i = 0; i < 200; i++) await P.settle(5000);   // 5x: over SHED_AT, under the panic figure
    claim('cases C, D and G stop biting, so they were testing that comparison', P.state().target, 8);
  }
}

console.log(NL + 'ablation: the recovery gate neutered');
{
  const loose = REGION.replace(/med <= CONTENTION \* base/, 'true');
  if (loose === REGION) { console.log('  FAIL  could not find the recovery gate to ablate - probe is stale'); fails++; }
  else {
    const P = makePool(8, { region: loose, across: 16, fin: true, cores: 12 }); await P.settle(1000);
    for (let i = 0; i < 16; i++) await P.settle(20000);
    const low = P.state().target;
    for (let r = 0; r < 4; r++) await feedRow(P, 16, 4.5);
    claim('case J stops biting: it widens back into 4.5x', P.state().target > low, true);
  }
}

console.log(NL + 'ablation: the panic window neutered');
{
  const slow = REGION.replace(/m >= PANIC \* base/, 'false');
  if (slow === REGION) { console.log('  FAIL  could not find the panic test to ablate - probe is stale'); fails++; }
  else {
    const P = makePool(8, { region: slow, across: 64, fin: true, cores: 12 }); await P.settle(1000);
    for (let i = 0; i < 8; i++) await P.settle(20000);
    claim('case H stops biting: 20x now waits out a whole row before anything happens',
      P.state().shed, []);
  }
}

console.log(NL + 'ablation: recovery taken out of the else, so the clock alone widens');
{
  const always = REGION.replace('else if (med <= CONTENTION * base) grow(med);', 'if (true) grow(med);');
  if (always === REGION) { console.log('  FAIL  could not find the recovery branch to ablate - probe is stale'); fails++; }
  else {
    const P = makePool(4, { region: always, across: 16, fin: true, cores: 4 }); await P.settle(2000);
    for (let r = 0; r < 20; r++) await feedRow(P, 16, 19, 2000);
    claim('case L stops biting: the tablet is handed workers back while it is still paging',
      plusses(P).length > 0, true);
  }
}

console.log(fails ? `${NL}${fails} FAILED${NL}` : NL + 'all claims hold' + NL);
process.exit(fails ? 1 : 0);

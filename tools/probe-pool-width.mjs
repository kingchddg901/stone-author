// DOES THE PLANNER PICK FOR THE POOL, OR FOR ONE PASS?
//
// tiffPlan used to score candidates by `est` - one measured tile multiplied by the pass count, which is
// the SEQUENTIAL wall clock. The pool paints N at once and N shrinks as the tile grows, so the quantity
// that decides the real wall clock is est/N. A big tile wins the first comparison by amortising per-pass
// overhead and can lose the second by being too big to run more than a few at a time.
//
// THE INPUT THAT MAKES THIS RED is case A below: a 2 GB device at 65536, where 8192 and 4096 both divide
// the grid cleanly, 8192 has the lower est, and 8192 nevertheless loses because the budget holds five of
// it and eight of the other. Before the fix the planner takes 8192 there. The ablation at the end swaps
// poolWidthFor for a constant and requires case A to STOP biting - a probe that passes with the thing it
// tests removed is testing nothing.
//
// Case C is the honest limit and is asserted as such: on a desktop both candidates clamp to the CORE
// CAP, so this fix does NOT change what a 16 GB machine picks at 131072. What bit there was peak
// MEMORY against free memory, which this does not address and which the budget, not the planner, owns.
//
// THE WIDTH CLAIMS NAME WHICH CONSTRAINT BINDS, not a number. Three can bind - the budget's room, the
// core count, and POOL_MAX - and asserting the literal hid which one it was. It hid a false sentence
// too: case A used to read "the budget holds eight 4096 tiles", and the budget holds TWENTY-FOUR. The
// eight was the cap, and the prose had been describing the wrong mechanism since it was written. Found
// when the cap moved to 10 on 2026-10-17, where only the numbers failed and every conclusion held.
//
//   node tools/probe-pool-width.mjs
import { readFileSync } from 'fs';

const SRC = readFileSync(new URL('../app/stone-author.html', import.meta.url), 'utf8');

// ---- LIFT, DO NOT COPY -----------------------------------------------------------------------------
function liftFn(name) {
  // AMBIGUITY IS AN ERROR, not a tie to break by position. `settle` existed twice in the app and the
  // first match was an unrelated speck routine, so the sibling probe lifted code it had never read and
  // died on a TypeError rather than on a claim. Silently testing the wrong subject is the worst of the
  // three outcomes, because it looks like a pass.
  const needle = 'function ' + name + '(';                 // indexOf, not a built regex: the '(' needs
  const hits = [];                                         // escaping and an escape built through a
  for (let k = SRC.indexOf(needle); k >= 0; k = SRC.indexOf(needle, k + 1)) hits.push(k);
  if (!hits.length) throw new Error('cannot find function ' + name + ' - probe is stale');
  if (hits.length > 1) throw new Error(name + ' is defined ' + hits.length + ' times - lift is ambiguous');
  const at = hits[0];
  let i = SRC.indexOf('{', at), d = 0;
  for (;; i++) {
    if (SRC[i] === '{') d++;
    else if (SRC[i] === '}' && --d === 0) break;
  }
  return SRC.slice(at, i + 1);
}
function liftSlice(from, to) {
  const a = SRC.indexOf(from);
  if (a < 0) throw new Error('cannot find slice start: ' + from.slice(0, 40) + ' - probe is stale');
  const b = SRC.indexOf(to, a);
  if (b < 0) throw new Error('cannot find slice end - probe is stale');
  return SRC.slice(a, b + to.length);
}

const POOL_WIDTH_SRC = liftFn('poolWidthFor');
// ITS ONE DEPENDENCY, LIFTED TOO. poolWidthFor reads POOL_MAX, the ceiling on how many cores a render
// may take, and a lifted function with a free variable throws ReferenceError at the first call - which
// is a loud failure and so the safe kind. Lifted rather than restated: a second copy of the number here
// would let the probe keep passing after the app's cap moved, which is the quiet kind.
const POOL_MAX_SRC = liftSlice('const POOL_MAX = ', ';');
const POOL_MAX = +(POOL_MAX_SRC.match(/(\d+)/) || [])[1];
if (!(POOL_MAX >= 2)) throw new Error('cannot read POOL_MAX - probe is stale');
// The whole choice, verbatim: safe / wallOf / fast / peakOf / roomy. Edited in the app, seen here.
const CHOICE_SRC = liftSlice('const safe = ok.reduce(', 'const roomy = memKnown && peakOf(fast) <= MEM_EASY * budget;');

const MEM_EASY = 0.5, MEM_SHARE = 6, TIFF_STORE_MAX = 4096, BLEED = 4;
const budgetOf = gb => gb * 1024 ** 3 * MEM_SHARE / 8;
const tileNeed = (t, bleed, surfaces) => { const e = t + 2 * bleed; return e * e * 4 * surfaces + TIFF_STORE_MAX * TIFF_STORE_MAX * 4; };

// Build the choice in a scope holding exactly what tiffPlan holds at that point.
function choose(env, poolSrc) {
  const fn = new Function('ok', 'budget', 'budgetMB', 'bleed', 'MEM_EASY', 'navigator', 'EXP_FORCE_SEQ', 'corePaintsThis',
    POOL_MAX_SRC + `
     ` + poolSrc + `
     const tileMBof = t => Math.round((t + 2 * bleed) ** 2 * 4 / 1e6);
     const widthOf = t => poolWidthFor(budgetMB, tileMBof(t)) || 1;
     ` + CHOICE_SRC + `
     return { ts: (roomy ? fast : safe).ts, width: widthOf(fast.ts), fast: fast.ts, roomy };`);
  return fn(env.ok, env.budget, Math.round(env.budget / 1e6), BLEED, MEM_EASY,
            { deviceMemory: env.gb, hardwareConcurrency: env.cores }, false, () => env.pool);
}

// Candidates as the ladder would produce them: est = passes * ms, ms carries a per-pass fixed cost so the
// big tile genuinely wins the sequential race (40 passes x 420ms = 16800 against 160 x 120 = 19200).
const cand = (ts, W, msPerPass) => {
  const passes = Math.ceil(W / ts) * Math.ceil(Math.round(W * 0.625) / ts);
  return { ts, est: passes * msPerPass, need: tileNeed(ts, BLEED, 1), passes };
};
const LADDER_65536 = [cand(8192, 65536, 420), cand(4096, 65536, 120)];

let fails = 0;
const claim = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`}`);
  return ok;
};

console.log('\nthe ladder at 65536, both sizes dividing the grid cleanly');
console.log(`  8192: ${LADDER_65536[0].passes} passes, est ${LADDER_65536[0].est}ms`);
console.log(`  4096: ${LADDER_65536[1].passes} passes, est ${LADDER_65536[1].est}ms   <- the SLOWER one sequentially\n`);

console.log('A  THE SCORING. 2 GB: room for five 8192 tiles and twenty-four 4096 ones, so the budget');
console.log('   binds the big tile and the core cap (' + POOL_MAX + ') binds the small one');
const A = choose({ ok: LADDER_65536, budget: budgetOf(2), gb: 2, cores: 12, pool: true }, POOL_WIDTH_SRC);
claim('est/N makes 4096 the fast one although 8192 has the lower est', A.fast, 4096);
claim('and it survives the peak gate, so that is the choice', A.ts, 4096);
claim('and the cap is what binds the winner here, not the budget', A.width, POOL_MAX);

console.log('\nB  the same device with no pool (a reality window, a back light, no Worker)');
const B = choose({ ok: LADDER_65536, budget: budgetOf(2), gb: 2, cores: 12, pool: false }, POOL_WIDTH_SRC);
claim('falls back to the sequential winner, exactly as before', B.ts, 8192);
claim('width reported as 1', B.width, 1);

console.log('\nC  16 GB desktop - deviceMemory caps at 8, room is 23 and 96, so BOTH');
console.log('   candidates clamp to the core cap of ' + POOL_MAX + ' - equal widths, nothing for est/N to reorder');
const C = choose({ ok: LADDER_65536, budget: budgetOf(8), gb: 8, cores: 12, pool: true }, POOL_WIDTH_SRC);
claim('still picks 8192: equal width cannot break the est ordering', C.ts, 8192);
claim('THE LIMIT OF THIS FIX - it would not have changed the 131072 run', C.width, POOL_MAX);

console.log('\nD  two cores: width follows the core count, not only the budget');
const D = choose({ ok: LADDER_65536, budget: budgetOf(2), gb: 2, cores: 2, pool: true }, POOL_WIDTH_SRC);
claim('width follows hardwareConcurrency, not just the budget', D.width, 2);

// The OTHER half, on its own. At 4 GB both candidates clamp to 8 workers, so the scoring cannot break
// the tie and still names 8192 - but eight 8192 tiles are 2152MB against a 1610MB half-ceiling, so the
// peak gate rejects it and takes the smallest that calibrated. The old gate judged ONE tile (336MB) and
// waved it through. This is the case the 131072 run would have needed a smaller budget to reach.
console.log('\nE  THE PEAK GATE. 4 GB: equal widths, so only the N-wide footprint can move this');
const E = choose({ ok: LADDER_65536, budget: budgetOf(4), gb: 4, cores: 12, pool: true }, POOL_WIDTH_SRC);
claim('the scoring still names 8192 - equal width cannot reorder est', E.fast, 8192);
claim('but eight of them will not fit, so the choice is 4096', E.ts, 4096);
claim('and it says so: not roomy', E.roomy, false);

// ---- ABLATION --------------------------------------------------------------------------------------
// Remove the thing under test and require the bite to disappear. A constant width makes est/N a scaled
// est, so the ordering reverts and case A must take 8192 again.
console.log('\nablation: poolWidthFor replaced by a constant');
const FLAT = 'function poolWidthFor(){ return 4; }';
const A2 = choose({ ok: LADDER_65536, budget: budgetOf(2), gb: 2, cores: 12, pool: true }, FLAT);
claim("case A's SCORING reverts to 8192, so case A was testing the width", A2.fast, 8192);
// Its outcome does NOT revert, and that is the point the first run of this probe missed: the peak gate
// is still live under the ablation and still rejects 8192. An outcome assertion here passed with the
// subject removed. Recorded rather than deleted - it is the reason the two halves are asserted apart.
claim('its outcome does not, because the peak gate acts on its own', A2.ts, 4096);

console.log(fails ? `\n${fails} FAILED\n` : '\nall claims hold\n');
process.exit(fails ? 1 : 0);

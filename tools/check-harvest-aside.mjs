// WHICH MASTERS ARE KEPT RATHER THAN RECORDED AND DELETED.
//
// `watch-harvest.mjs` reads a master, judges it, writes a sidecar, reads that sidecar back, and only
// then deletes 300-800 MB of pixels. `asideVerdict` is the judging step, and it is the one step whose
// failure is silent: a master it waves through is recorded as good and removed, leaving behind a
// sidecar that says nothing was wrong. There is no second copy of the file to notice with.
//
// IT HAS FAILED THAT WAY TWICE. 2026-09-30: seven 16384 masters with perfect geometry counts and no
// pixel above zero anywhere were harvested and deleted, because nothing read `light.mean`. 2026-10-30:
// three wood masters came off the GPU path as one flat colour at `light.mean` 23.33 — nowhere near
// zero — and `lit40` was the figure that separated them, 0.00 against 36.76 to 100 on every other
// master of that session.
//
// WHAT THIS HAS TO PROVE:
//   1  each clause fires on a master that really exhibits its condition
//   2  it does NOT fire on real renders, including a deliberately near-black one
//   3  a master with no light figure is left alone rather than guessed at
//   4  the `lit40` clause is load-bearing — ablate it and the case it catches walks through
//   5  the `mean === 0` clause is still load-bearing and still wins the label it always won
//
//   node tools/check-harvest-aside.mjs
import { readFileSync } from 'fs';

const SRC = readFileSync(new URL('./watch-harvest.mjs', import.meta.url), 'utf8');
let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log('  ok    ' + name); return; }
  fails++; console.log('  FAIL  ' + name + (detail === undefined ? '' : '   got ' + JSON.stringify(detail)));
};

// LIFTED, NOT COPIED, between the markers in the tool — the same technique as check-harvest-names.
// A second copy of this predicate here would pass while the real one was wrong, which is the only way
// this gate could lie.
const OPEN = '// ASIDE>>>', CLOSE = '// <<<ASIDE';
const a = SRC.indexOf(OPEN), b = SRC.indexOf(CLOSE);
if (a < 0 || b < 0 || b < a) {
  console.error('check-harvest-aside: cannot find the ASIDE markers in watch-harvest.mjs — this gate is stale');
  process.exit(1);
}
const BODY = SRC.slice(a + OPEN.length, b);
const lift = (src = BODY) => new Function(src + '\nreturn asideVerdict;')();
const verdict = lift();
const codeOf = m => { const v = verdict(m); return v && v.code.trim(); };

// REAL FIXTURES, copied off real sidecars rather than invented. `.claude/` is not committed, so they
// are pasted here; every number below was read out of a master's own metadata block.
const GPU_WOOD   = { w: 16384, marks: 666,  lines: 70,  cracks: 232, specks: 8050, light: { mean: 23.33, lit40: 0,     every: 100 } };
const BLACK      = { w: 16384, marks: 666,  lines: 70,  cracks: 232, specks: 8050, light: { mean: 0,     lit40: 0,     every: 100 } };
const MOON_ONLY  = { w: 32768, marks: 1224, lines: 361, cracks: 0,   specks: 0,    light: { mean: 1.29,  lit40: 0.94,  every: 100 } };
const GOOD_WOOD  = { w: 16384, marks: 666,  lines: 70,  cracks: 232, specks: 8050, light: { mean: 54.9,  lit40: 87.86, every: 100 } };
const GOOD_STONE = { w: 65535, marks: 1224, lines: 361, cracks: 0,   specks: 0,    light: { mean: 69.6,  lit40: 76.99, every: 100 } };
const NO_LIGHT   = { w: 65535, marks: 666,  lines: 70,  cracks: 232, specks: 8050 };
const GLASS      = { w: 32768, marks: 14,   lines: 0,   cracks: 0,   specks: 0,    light: { mean: 129.63, lit40: 100,  every: 100 } };

// ---- 1: each clause fires on the thing it is for -------------------------------------------------
ok('a flat frame that is not black -> NOTHING LIT', codeOf(GPU_WOOD) === 'NOTHING LIT', codeOf(GPU_WOOD));
ok('light.mean 0 -> BLACK FRAME (unchanged label)', codeOf(BLACK) === 'BLACK FRAME', codeOf(BLACK));

// ---- 2: it leaves real renders alone -------------------------------------------------------------
// THE NEAR-BLACK ONE IS THE POINT. A moon-only A/B at 32,768 reads light.mean 1.29 — darker than the
// flat wood frame above by a factor of eighteen — and it is a picture somebody meant. It is also the
// LOWEST non-zero lit40 in an archive of 1,138 masters carrying one; the next is 1.03 and then there
// is a jump to 6.26. So this row is the whole margin the `=== 0` test has, and it is 0.94 wide.
ok('a deliberately near-black render is left alone', verdict(MOON_ONLY) === null, codeOf(MOON_ONLY));
ok('a good wood master is left alone', verdict(GOOD_WOOD) === null, codeOf(GOOD_WOOD));
ok('a good stone master is left alone', verdict(GOOD_STONE) === null, codeOf(GOOD_STONE));

// ---- 3: no light figure means no judgement -------------------------------------------------------
ok('a build with no light figure is left alone', verdict(NO_LIGHT) === null, codeOf(NO_LIGHT));

// ---- 4: the lit40 clause is load-bearing ---------------------------------------------------------
// ABLATION. Strip the clause and the master it was added for must walk straight through, because a
// test that passes with the code removed is measuring something else. The substitution is asserted
// before it is used, so a reworded clause fails here rather than silently ablating nothing.
const CLAUSE = 'const nothingLit = !!(light && light.lit40 === 0);';
ok('the lit40 clause is where this gate thinks it is', BODY.includes(CLAUSE));
if (BODY.includes(CLAUSE)) {
  const without = lift(BODY.replace(CLAUSE, 'const nothingLit = false;'));
  ok('ablated: the flat frame walks through', without(GPU_WOOD) === null, without(GPU_WOOD));
  ok('ablated: the black frame is still caught by mean === 0',
     !!without(BLACK) && without(BLACK).code.trim() === 'BLACK FRAME');
}

// ---- 5: the mean clause is load-bearing too ------------------------------------------------------
const MEANCLAUSE = 'const blackFrame = !!(light && light.mean === 0);';
ok('the mean clause is where this gate thinks it is', BODY.includes(MEANCLAUSE));
if (BODY.includes(MEANCLAUSE)) {
  const without = lift(BODY.replace(MEANCLAUSE, 'const blackFrame = false;'));
  // It is still caught — by lit40 — but under the OTHER label, which is what proves the two clauses
  // are separate rules and not one rule written twice.
  ok('ablated: a black frame falls through to NOTHING LIT',
     !!without(BLACK) && without(BLACK).code.trim() === 'NOTHING LIT');
}

// ---- the noGeometry clause, pinned rather than endorsed ------------------------------------------
// `noGeometry` is `marks > 0 && !lines && !cracks && !specks`, and `lines`, `cracks` and `specks` are
// STONE vocabulary. A glass or wood slab authored without stone marks satisfies it by construction.
// Measured against the archive on 2026-10-30: 224 masters match it and ALL 224 are real pictures —
// lit40 62.50 to 100.00, not one of them at zero. 212 glass, 4 wood, 1 stone.
//
// It has not bitten because those slabs mostly never matched the harvester's PREFIX, which is the same
// symptomless gap that hid two earlier failures. This row therefore PINS the current behaviour rather
// than approving it: the decision to narrow the clause to stone has not been made, and when it is,
// this assertion goes red and whoever changed it reads this comment.
ok('PINNED (known false positive): a glass master matches noGeometry',
   codeOf(GLASS) === 'EMPTY STONE', codeOf(GLASS));

console.log(fails ? '\ncheck-harvest-aside: ' + fails + ' FAILED' : '\ncheck-harvest-aside: ok');
process.exit(fails ? 1 : 0);

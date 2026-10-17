// THE CARRY CHECK MUST NOT COST MORE THAN IT IS WORTH.
//
// The op editor answers "can this export size carry this chain?" by MEASURING - one small patch at
// the chosen size, the same patch at four times it, averaged back and correlated. It has to measure,
// because no arithmetic over the op list can answer it: a product of the per-op scales reports one
// real chain EXPANDING the gather (0.15 across, 0.31 down) while that chain renders at correlation
// 0.074 against a supersampled reference. The horseshoe is area-preserving and its fineness is
// fold-on-fold, which per-op factors cannot see.
//
// Measuring costs two renders, so the thing that can go wrong is not correctness but COST. Three ways,
// and all three are visible in the source:
//
//   1  it runs while an export is running, and a five-hour master competes with a tooltip
//   2  it runs on every slider pixel instead of once the hand stops
//   3  it runs for stone or wood, which were measured at 0.9999 and never need asking
//
// Plus one correctness trap worth pinning: a flat patch has no variance, and a correlation over two
// constants is 0/0. It must report agreement, not NaN, or an empty corner of a slab reads as a defect.
//
//   node tools/check-carry.mjs
import { readFileSync } from 'fs';

const SRC = readFileSync(new URL('../app/stone-author.html', import.meta.url), 'utf8');
let fails = 0;
const ok = (what, cond, got) => {
  if (!cond) { fails++; console.error('  FAIL  ' + what + (got === undefined ? '' : '   ' + got)); }
  else console.log('  ok    ' + what + (got === undefined ? '' : '   ' + got));
};

// The function body, so every assertion below is about the check and not about some other code
// that happens to mention the same word.
const at = SRC.indexOf('async function carryCheck()');
const body = at < 0 ? '' : SRC.slice(at, SRC.indexOf('\n  }', at));

ok('the check exists', at > 0);
ok('and the panel has somewhere to put it', SRC.includes('id="ops-carry"'));

// ---- the three costs ---------------------------------------------------------------------------------
ok('it refuses to run while an export is running', /\bexporting\b/.test(body));
ok('it refuses for anything but glass', /currentMaterial\(\)\s*!==\s*'glass'/.test(body));
ok('it refuses without a size', /!\(W > 0\)/.test(body));
ok('and all three refusals share one guard, so none can be added without the others',
   /if \(currentMaterial\(\)[^\n]*exporting[^\n]*W > 0\)/.test(body));

// EVERY WAY THE FIELD CHANGES HAS TO REACH IT. drawOps reruns only on add, remove and reorder, so
// hanging the check there alone left a slider drag showing the PREVIOUS answer - and the magnitude is
// exactly what decides it: the reference chain reads 0.987 at roll 2.0 and 0.074 at 2.5. A stale
// number is worse than no number, and this is the assertion that was missing when that shipped.
{
  const opSl = SRC.match(/sl\.addEventListener\('input', \(\) => \{ op\.a = .*\}\);/);
  ok('the op MAGNITUDE slider retriggers the check', !!opSl && /carryLater\(\)/.test(opSl[0]));
  const glSl = SRC.match(/el\.addEventListener\('input', \(\) => \{ GLASS\[k\] = .*\}\);/);
  ok('and so do the glass parameter sliders', !!glSl && /carryLater\(\)/.test(glSl[0]));
  const dOps = SRC.slice(SRC.indexOf('function drawOps()'), SRC.indexOf('function drawOps()') + 1800);
  ok('as does the list itself, on add, remove and reorder', /carryLater\(\);/.test(dOps));
}

{
  const d = SRC.match(/function carryLater\(\)[\s\S]{0,220}?setTimeout\(([\s\S]{0,60}?),\s*(\d+)\s*\)/);
  ok('a slider does not fire it on every pixel - it is debounced', !!d, d ? d[2] + ' ms' : 'no debounce');
  ok('and the pending one is cancelled, or a drag queues a check per pixel',
     /function carryLater\(\)[\s\S]{0,120}?clearTimeout\(carryTimer\)/.test(SRC));
}

// ---- the correctness trap ----------------------------------------------------------------------------
{
  const c = SRC.indexOf('function carryCorr(');
  const cbody = c < 0 ? '' : SRC.slice(c, SRC.indexOf('\n  }', c));
  ok('a flat patch reports agreement rather than NaN', /sa < 1e-9 \|\| sb < 1e-9/.test(cbody));
}

// ---- the thresholds have to be the right way round ---------------------------------------------------
{
  const m = SRC.match(/CARRY_SOFT = ([0-9.]+), CARRY_BAD = ([0-9.]+)/);
  ok('the thresholds exist', !!m);
  if (m) {
    const soft = +m[1], bad = +m[2];
    ok('bad is stricter than soft, or every warning reads as the severe one', bad < soft,
       'bad ' + bad + ' < soft ' + soft);
    ok('and both sit inside a correlation, which cannot exceed 1', soft <= 1 && bad >= 0,
       soft + ' / ' + bad);
  }
}

// ---- the bleed is the coat's, not a constant ---------------------------------------------------------
// check-bleed.mjs owns this repo-wide; repeated here because this function was written with a 4 in it
// and that gate is what caught it.
{
  const p = SRC.indexOf('function carryPatch(');
  const pbody = p < 0 ? '' : SRC.slice(p, SRC.indexOf('\n  }', p));
  ok('the patch takes its bleed from coatReach', /coatReach\(/.test(pbody));
  ok('and not from a literal', !/const bleed = \d/.test(pbody));
}

// ---- every string it can show is a key ---------------------------------------------------------------
{
  const keys = ['glass.carry-busy', 'glass.carry-ok', 'glass.carry-soft', 'glass.carry-bad'];
  for (const k of keys) {
    ok('"' + k + '" is defined and used',
       SRC.includes('"' + k + '"') && SRC.includes("TR('" + k + "'"));
  }
}

// ---- ABLATION - each guard removed must be visible from here -----------------------------------------
// Without this the checks above are greps that have never been shown able to fail.
{
  const cases = [
    ['the export guard', s => s.replace(/ \|\| exporting/, ''), b => /\bexporting\b/.test(b)],
    ['the glass guard', s => s.replace(/currentMaterial\(\) !== 'glass' \|\| /, ''), b => /currentMaterial\(\)\s*!==\s*'glass'/.test(b)],
  ];
  for (const [name, breakIt, probe] of cases) {
    const broken = breakIt(SRC);
    const a2 = broken.indexOf('async function carryCheck()');
    const b2 = a2 < 0 ? '' : broken.slice(a2, broken.indexOf('\n  }', a2));
    ok('ablation: removing ' + name + ' goes red', broken !== SRC && !probe(b2));
  }
}

console.log('');
if (fails) { console.error('check-carry: ' + fails + ' FAILED'); process.exit(1); }
console.log('check-carry: the editor measures only for glass, only when idle, and only once the hand');
console.log('             stops - and a flat patch reads as agreement, not as a defect.');

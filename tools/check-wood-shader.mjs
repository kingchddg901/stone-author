// IS THE WGSL THE SAME FUNCTION AS THE APP'S?
//
// Nothing in this repo's 53 gates executes WGSL - Playwright will not spawn here and CI runners have
// no GPU - so a shader block is unverified code until somebody renders with it. That is tolerable for
// the LAST step and not for the first: a port that is wrong in its third constant should be caught
// before 130 more lines are written on top of it.
//
// So this compares the two TEXTS where they must agree, which is the part a transcription gets wrong.
// Every literal number in the app's function must appear in the WGSL and the other way about, in the
// same multiplicity. A dropped 0.92, a 7919 typed as 7912, a 104729 that became 104792 - each is a
// different picture and none of them is a syntax error.
//
// WHAT IT CANNOT DO is prove the arithmetic. Two functions can share every constant and differ in
// where they put them. That needs both running on the same inputs, which needs a GPU, which is the
// next step and not this one. This gate is the floor, not the ceiling, and says so.
//
// WHAT IT HAS TO PROVE:
//   1  the blocks are well formed - balanced braces, no stray backtick, no control character
//   2  every constant in the app's woodEye and woodStain is in the WGSL, and none is invented
//   3  the two hash calls are keyed DIFFERENTLY, which is what keeps eyes off the diagonal
//   4  the cell index floors before it converts, which JS does and a direct i32() does not
//
//   node tools/check-wood-shader.mjs
import { readFileSync } from 'fs';
import { WGSL } from './lib/wood-gpu.mjs';

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log('  ok    ' + name); return; }
  fails++; console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};

const APP = readFileSync(new URL('../app/stone-author.html', import.meta.url), 'utf8');
const lift = (sig) => {
  const k = APP.indexOf(sig);
  if (k < 0) return null;
  let i = APP.indexOf('{', k), d = 0;
  for (;; i++) { if (APP[i] === '{') d++; else if (APP[i] === '}' && --d === 0) break; }
  return APP.slice(k, i + 1);
};
// comments carry prose numbers - 0.71r, 1-d^2 - that are not constants of the arithmetic
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
// A SQUARING IS SPELLED TWO WAYS. `x ** 2` in JS is `x * x` in the WGSL - the same arithmetic, and
// it leaves the exponent with no counterpart. Counted separately below rather than quietly dropped:
// an exponent that changed from 2 to 3 is a real defect and must not hide here.
const unsquare = s => s.replace(/\*\* ?2\b/g, '');
const nums = (s) => {
  const out = new Map();
  for (const m of strip(s).matchAll(/(?<![\w.])(\d+\.?\d*(?:e-?\d+)?)/g)) {
    const v = parseFloat(m[1]);
    out.set(v, (out.get(v) || 0) + 1);
  }
  return out;
};

// ---- 1: well formed --------------------------------------------------------------------------------
for (const name of ['woodEye', 'woodStain']) {
  const src = WGSL[name];
  ok(name + ' is a non-empty block', typeof src === 'string' && src.length > 100);
  let d = 0, bad = false;
  for (const ch of src) { if (ch === '{') d++; else if (ch === '}') { d--; if (d < 0) bad = true; } }
  ok(name + ' has balanced braces', d === 0 && !bad, 'depth ' + d);
  ok(name + ' carries no stray backtick', src.indexOf('`') < 0);
  const ctl = [...src].filter(c => c.charCodeAt(0) < 9 || (c.charCodeAt(0) > 13 && c.charCodeAt(0) < 32));
  ok(name + ' carries no control character', ctl.length === 0, ctl.length + ' found');
  ok(name + ' declares the function it is named for', src.indexOf('fn ' + name + '(') >= 0);
}

// ---- 2: the constants ------------------------------------------------------------------------------
// WGSL spells floats with a trailing .0 that JS does not, so compare by VALUE rather than by token.
const PAIRS = [
  ['woodEye', 'function woodEye(th, zp, cell, wFt, rad)'],
  ['woodStain', 'function woodStain(th, rad, zp, inv, thr)'],
];
for (const [name, sig] of PAIRS) {
  const cpu = lift(sig);
  ok(name + ': the app still has it where this gate looks', !!cpu, sig);
  if (!cpu) continue;
  const a = nums(unsquare(cpu)), b = nums(WGSL[name]);
  // the loop bounds and the `** 2` are spelled differently on the two sides, so compare the set of
  // DISTINCT values rather than their multiplicity - a wrong number still shows, a repeat does not
  const missing = [...a.keys()].filter(v => !b.has(v));
  const invented = [...b.keys()].filter(v => !a.has(v));
  ok(name + ': every constant of the app is in the WGSL', missing.length === 0,
     'missing ' + missing.join(', '));
  ok(name + ': and the WGSL invents none', invented.length === 0, 'invented ' + invented.join(', '));
}

// ---- 2b: and every squaring survived as a multiplication ---------------------------------------------
{
  const cpu = lift(PAIRS[0][1]);
  const sq = (strip(cpu).match(/\*\* ?2/g) || []).length;
  ok('the app squares exactly once in woodEye', sq === 1, sq + ' squaring(s)');
  ok('and the WGSL spells that as a multiplication', /let w2 = w \* w;/.test(WGSL.woodEye));
  ok('ABLATION an exponent of 3 would still be seen, not stripped',
     nums(unsquare('a ** 3')).has(3));
  ok('while the 2 of a squaring is', !nums(unsquare('a ** 2')).has(2));
}

// ---- 3: the two hashes are keyed differently --------------------------------------------------------
// jy keys on (cy2, cx2 + 7919) where jx keys on (cx2, cy2). Hash the same pair twice and every eye
// lands on the diagonal - which is the one thing real bird's eye never does.
{
  const e = WGSL.woodEye;
  ok('jx keys on (cx2, cy2)', /woodHash\(cx2,\s*cy2\)/.test(e));
  ok('jy keys on the SWAPPED pair plus 7919', /woodHash\(cy2,\s*cx2 \+ 7919\)/.test(e));
  ok('and the size hash on a third key', /woodHash\(cx2 \+ 104729,\s*cy2 \+ 31337\)/.test(e));
  // ABLATION: the same pair twice would pass every constant check above
  const same = e.replace(/woodHash\(cy2,\s*cx2 \+ 7919\)/, 'woodHash(cx2, cy2 + 7919)');
  ok('ABLATION a same-keyed pair is a different text this test can see', same !== e);
}

// ---- 4: floor before convert -------------------------------------------------------------------------
// JS Math.floor(-0.5) is -1; WGSL i32(-0.5) is 0, because the conversion truncates toward zero. A
// board on the far side of the pith has negative theta, so a direct conversion steps the whole grid
// at the axis.
{
  const e = WGSL.woodEye;
  ok('the cell index floors before converting', /i32\(floor\(th \/ cell\)\)/.test(e) &&
     /i32\(floor\(zp \/ cell\)\)/.test(e));
  ok('ABLATION a bare i32() would have been a different text', !/i32\(th \/ cell\)/.test(e));
  ok('and the app does floor there too', /Math\.floor\(th \/ cell\)/.test(APP));
}

console.log('');
console.log('  NOT PROVEN HERE: that the arithmetic agrees. Two functions can share every constant and');
console.log('  put them in different places. That needs both running on the same inputs, on a GPU.');
console.log('');
if (fails) { console.error('check-wood-shader: ' + fails + ' FAILED'); process.exit(1); }
console.log('check-wood-shader: the ported blocks are well formed and carry the app’s own constants.');

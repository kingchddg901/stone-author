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
import { WGSL, WOOD_ORDER, woodSource } from './lib/wood-gpu.mjs';
import { WGSL as GLASS } from './lib/glass-gpu.mjs';
import { PART_NAMES, SQ_MAX, UNI_FLOAT_NAMES, UNI_INT_NAMES } from './lib/wood-real.mjs';

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
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*/, '')).join('\n');
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

// ---- 5: THE UNIFORM HAS A READER AT BOTH ENDS --------------------------------------------------------
// THIS SECTION EXISTS BECAUSE IT FOUND SOMETHING THE MOMENT IT WAS WRITTEN. Every gate before it
// asks whether the packer carries what `shade` indexes - which is the right question and only half
// of it. Nothing asked the reverse: whether a field the packer WRITES is ever read.
//
// Two were not. `E.EYESF` was read in two places and `E.EYES` in two others, left from when EYES
// was an int flag; and HASFIRE tested `F.FIRE.length` on a value that is the boolean `kf > 0`, so
// it packed 0 for every tree and a burnt log would have rendered unburnt. Both compile. Both paint
// wood. Neither is a syntax error or a crash, which is exactly why a text gate has to ask.
//
// THE GENERATED STRUCT CLOSES ONE DIRECTION BY CONSTRUCTION: the Env is built from the packer's own
// name lists, so a name the shader reads and nothing declares will not compile at all. What is left
// is the other direction, and it needs a reason per exemption - the hand-written part of a derived
// gate is where the next miss comes from.
{
  const src = Object.values(WGSL).join(String.fromCharCode(10));
  const body = WGSL.woodEnv.slice(WGSL.woodEnv.indexOf('{'), WGSL.woodEnv.indexOf('}'));
  const decl = new Set([...body.matchAll(/([A-Za-z_]\w*): [fi]32/g)].map(m => m[1]));
  const read = new Set([...src.matchAll(/E[.]([A-Za-z_]\w*)/g)].map(m => m[1]));

  ok('the Env is generated from the packer, not typed out',
     decl.size === UNI_FLOAT_NAMES.length + UNI_INT_NAMES.length,
     decl.size + ' declared vs ' + (UNI_FLOAT_NAMES.length + UNI_INT_NAMES.length) + ' named');
  const ghost = [...read].filter(n => !decl.has(n));
  ok('every field the shader reads is declared', ghost.length === 0, 'UNDECLARED: ' + ghost.join(', '));

  // CARRIED WITHOUT A READER, WITH A REASON EACH. Correct and free is not the same as wrong: these
  // three are real values the field computes, the uniform has room for them, and the log view is a
  // plausible next consumer. FIRE was none of those and is gone.
  const SPARE = new Map([
    ['LMAX', 'the ring table radial extent; the shader gets KS = (K-1)/LMAX precomputed instead'],
    ['n', 'the ring COUNT in years; the shader indexes the baked tables by K and never needs it'],
    ['oEDGE', 'the trunk ring boundaries; shade reads the GRAFT edge (aGEDGE) and takes the trunk '
            + 'through the LUT and KS, so only the log view would want this one'],
  ]);
  const idle = [...decl].filter(n => !read.has(n) && !n.startsWith('pad') && !SPARE.has(n));
  ok('every other declared field has a reader', idle.length === 0, 'NEVER READ: ' + idle.join(', '));
  ok('and every exemption says why', [...SPARE.values()].every(r => r.length > 30));

  // AND EVERY ARENA PART HAS AN ACCESSOR. The same question one layer down: a part in PART_NAMES with
  // no a<NAME>() is bytes nothing can reach, which is how a boolean got packed as a table.
  const noAcc = PART_NAMES.filter(p => src.indexOf('fn a' + p + '(') < 0 && !SPARE.has('o' + p));
  ok('every arena part has an accessor', noAcc.length === 0, 'NO ACCESSOR: ' + noAcc.join(', '));

  ok('ABLATION a field with no reader is caught',
     [...decl].filter(n => !new Set([...read].filter(x => x !== 'KS')).has(n)
                        && !n.startsWith('pad') && !SPARE.has(n)).includes('KS'));
  ok('ABLATION a part with no accessor is caught',
     ['LUT', ...PART_NAMES].filter(p => ('a' + p) === 'aNOSUCH').length === 0
       && PART_NAMES.concat('NOSUCH').filter(p => src.indexOf('fn a' + p + '(') < 0
            && !SPARE.has('o' + p)).join(',') === 'NOSUCH');
}

// ---- 6: THE SCRATCH IS BIG ENOUGH FOR THE APP IT IS A PORT OF -----------------------------------------
// SQ is a function-local array and WGSL needs its length at compile time, where the app sizes one
// from a list at run time. Two features ship today and the app says in a comment that a third is
// five more keys rather than another case to write - so the bound is read out of the app's own DEV
// literal and the gate goes red if it ever outgrows the shader, instead of the shader quietly
// painting a tree with a branch missing.
{
  const k = APP.indexOf('const DEV = [');
  ok('the DEV literal is where this gate looks', k >= 0);
  let i = APP.indexOf('[', k), d = 0;
  for (;; i++) { if (APP[i] === '[') d++; else if (APP[i] === ']' && --d === 0) break; }
  const dev = APP.slice(k, i + 1);
  const entries = (dev.match(/\{ a: WOOD[.]/g) || []).length;
  ok('and it reads as a list of features', entries >= 2, entries + ' found');
  ok('the shader has scratch for every one', SQ_MAX >= entries, SQ_MAX + ' slots, ' + entries + ' features');
  ok('the shader declares SQ with that bound', WGSL.woodEnv.indexOf('const SQ_MAX: i32 = ' + SQ_MAX) >= 0
     && WGSL.woodShadeBody.indexOf('var SQ: array<f32, SQ_MAX>;') >= 0);
  ok('ABLATION one more feature than the shader holds is caught', !(entries - 1 >= SQ_MAX + 1));
  ok('and a shader with room for one would be', !(1 >= entries));
}


// ---- 7: THE MODULE ASSEMBLES, IN AN ORDER WGSL WILL ACCEPT -------------------------------------------
// woodSource borrows woodAtan2, woodHash and fbm2 from the glass blocks rather than keeping a second
// copy, and the set is CLOSED OVER THE CALLS instead of listed - fbm2 calls vnoise and vnoise calls
// nz, and neither name appears anywhere in wood's own text, so a list would have missed both.
//
// AND THE ORDER IS THE PART THAT WENT WRONG. The first spelling appended each pass's blocks as it
// found them, so fbm2 landed before the vnoise it calls. WGSL wants declaration before use, which
// makes that a compile error - and a compile error nothing in this repo can run is a defect that
// travels all the way to a GPU to be found. So the borrowed set is sorted into glass's own
// declaration order, and this checks the result rather than the sorting.
{
  const asm = woodSource(GLASS);
  ok('the assembly places every wood block', WOOD_ORDER.length === Object.keys(WGSL).length,
     WOOD_ORDER.length + ' ordered of ' + Object.keys(WGSL).length + ' blocks');
  ok('woodEnv comes first, because everything reads E and ARR', WOOD_ORDER[0] === 'woodEnv');
  ok('and woodMain last, because it calls all of it',
     WOOD_ORDER[WOOD_ORDER.length - 1] === 'woodMain');
  ok('it borrows from glass rather than copying', asm.borrowed.length >= 3, asm.borrowed.join(' '));
  ok('including the transitive ones no wood block names',
     asm.borrowed.indexOf('vnoise') >= 0 && asm.borrowed.indexOf('nz') >= 0, asm.borrowed.join(' '));

  // DECLARED BEFORE USE, walked line by line over the assembled text.
  const lines = asm.code.split(String.fromCharCode(10));
  const DEF = /fn ([A-Za-z_]\w*)[ ]*[(]/g;
  const all = new Set();
  for (const l of lines) for (const m of l.matchAll(DEF)) all.add(m[1]);
  const late = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(DEF)) seen.add(m[1]);
    for (const m of lines[i].matchAll(/([A-Za-z_]\w*)[ ]*[(]/g)) {
      const n = m[1];
      if (all.has(n) && !seen.has(n) && lines[i].indexOf('fn ' + n + '(') < 0) {
        late.push(n + ' at line ' + (i + 1));
      }
    }
  }
  ok('every function is declared before it is called', late.length === 0, late.join('; '));

  // ABLATION: the exact fault the sorting fixed. Hand-build the text in the order the first
  // spelling produced and the walk above must see it.
  {
    const bad = [GLASS.fbm2, GLASS.vnoise, GLASS.nz].join(String.fromCharCode(10))
                  .split(String.fromCharCode(10));
    const a2 = new Set(); const s2 = new Set(); const l2 = [];
    for (const l of bad) for (const m of l.matchAll(DEF)) a2.add(m[1]);
    for (let i = 0; i < bad.length; i++) {
      for (const m of bad[i].matchAll(DEF)) s2.add(m[1]);
      for (const m of bad[i].matchAll(/([A-Za-z_]\w*)[ ]*[(]/g)) {
        if (a2.has(m[1]) && !s2.has(m[1]) && bad[i].indexOf('fn ' + m[1] + '(') < 0) l2.push(m[1]);
      }
    }
    ok('ABLATION fbm2 placed before vnoise is caught', l2.indexOf('vnoise') >= 0, l2.join(','));
  }

  // ABLATION: a block added to WGSL and left out of the order must refuse to assemble.
  {
    WGSL.woodNewBlockForTheAblation = 'fn zz() -> f32 { return 0.0; }';
    let threw = null;
    try { woodSource(GLASS); } catch (e) { threw = e.message; }
    delete WGSL.woodNewBlockForTheAblation;
    ok('ABLATION an unplaced block refuses to assemble', !!threw && /unplaced/.test(threw), threw);
  }
}


// ---- 8: THE MODULE DECLARES EVERY ENTRY POINT THE POOL ASKS FOR ---------------------------------------
// Four of the five are unreachable by the dependency closure, because nothing in a shader CALLS an
// entry point - the pool names it to createComputePipeline. So the closure found `main` and missed
// pack, packTex, vfull and fblit, and the first wood export would have died at the second pipeline.
//
// THE LIST IS READ OUT OF THE POOL rather than typed here. Every `entryPoint: 'x'` in the app is a
// pipeline somebody creates, so the app states the requirement and this checks it - which is the
// difference between a gate and a note.
{
  const want = [...new Set([...APP.matchAll(/entryPoint: '([A-Za-z_]\w*)'/g)].map(m => m[1]))];
  ok('the app names its entry points where this gate reads them', want.length >= 4, want.join(' '));
  const code = woodSource(GLASS).code;
  const missing = want.filter(n => code.indexOf('fn ' + n + '(') < 0);
  ok('the wood module declares every one', missing.length === 0, 'MISSING: ' + missing.join(', '));
  ok('ABLATION an entry point left out is caught',
     want.concat('nosuchentry').filter(n => code.indexOf('fn ' + n + '(') < 0).join() === 'nosuchentry');
}

console.log('');
if (fails) { console.error('check-wood-shader: ' + fails + ' FAILED'); process.exit(1); }
console.log('check-wood-shader: the ported blocks are well formed and carry the app’s own constants.');

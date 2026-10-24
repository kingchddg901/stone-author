// THE UNROLLED CHAIN IS THE SAME CHAIN, AND IT IS ACTUALLY BEING BUILT.
//
// compileUnform slices the per-kind bodies out of glassUnform's own source and emits them in order
// with the loop gone. Two things have to hold and only one of them is about correctness:
//
//   IT AGREES. The generated function returns the same doubles as the walk, bitwise, for every kind
//   and every flag combination the records can carry.
//   IT BUILDS. compileUnform already checks itself against the walk and returns null on any
//   disagreement, so a slicing failure degrades to the old speed rather than to a wrong picture -
//   which means a correctness test ALONE would pass a generator that never generated anything. Half
//   of what is below exists to catch that, because it is the failure this design makes invisible.
//
// The helpers the chain reaches - glassUnwarp, rollStampAt, rollerAt, rollerHand - are stubbed here
// rather than lifted, because they need lattices and bound rollers that only a live tile has. They
// are stubbed as real functions of their arguments, never as constants: both paths call the same
// stub, so agreement still tests the unrolling, and a stub that ignored its inputs would let a
// dropped coordinate through.
//
//   node tools/probe-chain-spec.mjs             prove it
//   node tools/probe-chain-spec.mjs --ablate    prove it can go red
import { readFileSync } from 'fs';

const SRC = readFileSync(new URL('../app/stone-author.html', import.meta.url), 'utf8');

function liftFn(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('no function ' + name);
  let d = 0;
  for (let k = SRC.indexOf('{', i); k < SRC.length; k++) {
    if (SRC[k] === '{') d++;
    else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); }
  }
  throw new Error('unbalanced ' + name);
}

// SLAB_FT comes from the app, not from memory - it sizes every stir and press coordinate.
const SLAB_FT = +(SRC.match(/const SLAB_FT = (\d+)/) || [])[1];
if (!SLAB_FT) { console.error('probe-chain-spec: FAIL - could not read SLAB_FT from the app'); process.exit(1); }

const STUBS = `
  const SLAB_FT = ${SLAB_FT};
  function glassUnwarp(S, cu, cvv, out) { out[0] = Math.sin(cu * 3.1 + S.q) * 0.013; out[1] = Math.cos(cvv * 2.7 - S.q) * 0.011; }
  function rollStampAt(s, v, op) { const h = Math.sin(s * 5.3 + v * 3.1 + op.q); return h > 0 ? h * 0.5 : 0; }
  function rollerAt(B, cu, cvv, out) { out[0] = cu * B.a + 0.07; out[1] = cvv * B.b - 0.03; }
  function rollerHand(B, s, out) { out[0] = 0.5 + 0.25 * Math.sin(s * 2.1); out[1] = 0.1 * Math.cos(s); }
`;

// THE CACHE DECLARATION IS LIFTED TOO, not re-written here. compileUnform memoises one function per
// chain SHAPE in _UNFC, and a probe that declared its own would be testing something else. This
// probe went red the moment unformKey and _UNFC were added and not carried, which is the behaviour
// wanted from it — the same thing probe-glass-gradient.mjs caught when glassFormT started reading
// the hash cache. Lifting a function means lifting every name its text reaches for.
const UNFC_DECL = (SRC.match(/const _UNFC = [{][^;]*[}];/) || [])[0];
if (!UNFC_DECL) { console.error('probe-chain-spec: FAIL - no _UNFC declaration in the app'); process.exit(1); }

function build(mutate) {
  let bodies = liftFn('unformBodies'), comp = liftFn('compileUnform'), walk = liftFn('glassUnform');
  if (mutate) ({ bodies, comp, walk } = mutate({ bodies, comp, walk }));
  const src = STUBS + liftFn('woodAtan2') + '\n' + walk + '\n' + bodies + '\n'
    + UNFC_DECL + '\n' + liftFn('unformKey') + '\n' + comp
    + '\nreturn { glassUnform, unformBodies, unformKey, compileUnform, peek: () => _UNFC };';
  return new Function(src)();
}

// ---- the records a chain can hold ------------------------------------------------------------
// Written as compileOps emits them, including the fields only one kind reads, because a generated
// block gets the WHOLE record and a missing field would read as undefined rather than throw.
const R = {
  spin:      { k: 1, a: 1.2, ox: 0.31, oy: -0.22 },
  spinOrig:  { k: 1, a: -0.7, ox: 0, oy: 0 },
  blow:      { k: 2, s: 1.8, ox: 0, oy: 0 },
  blowOff:   { k: 2, s: 0.6, ox: -0.4, oy: 0.25 },
  roll:      { k: 3, s: 2.5, rot: false, st: null, cd: 1, sd: 0, u0: 0, ox: 0, oy: 0 },
  rollRot:   { k: 3, s: 1.3, rot: true, st: null, cd: Math.cos(0.4), sd: Math.sin(0.4), u0: 0.1, ox: 0, oy: 0 },
  rollStamp: { k: 3, s: 1.7, rot: false, st: {}, raw: { q: 0.3 }, cd: 1, sd: 0, u0: 0.05, ox: 0, oy: 0 },
  press:     { k: 4, B: { a: 1.1, b: 0.9 }, face: 2.5, bite: 1.2, raw: { q: 0.7 }, ox: 0, oy: 0 },
  pressNoB:  { k: 4, B: null, face: 2.5, bite: 1, raw: { q: 0 }, ox: 0, oy: 0 },
  stir:      { k: 5, S: { q: 0.5 }, ox: 0, oy: 0 },
  stirNoS:   { k: 5, S: null, ox: 0, oy: 0 },
  noop:      { k: 0, ox: 0, oy: 0 },
};
const F0 = () => ({ PX: 0.91, PY: -0.3, H: 0.625, PV: [0, 0], PH: [0, 0] });
const CHAINS = [
  ['the reference slab: roll, stir, blow, stir, spin, blow, blow, stir',
   ['stir', 'blow', 'blow', 'spin', 'stir', 'blow', 'stir', 'roll']],
  ['every kind at once', ['spin', 'blow', 'roll', 'press', 'stir']],
  ['every flag the records carry',
   ['spinOrig', 'blowOff', 'rollRot', 'rollStamp', 'pressNoB', 'stirNoS', 'noop']],
  ['one op', ['spin']],
  ['two spins about different centres', ['spin', 'spinOrig']],
];

// a point set DISTINCT from the lattice compileUnform checks itself on, so this is an independent
// reading rather than a restatement of the generator's own opinion
const PTS = [];
for (let i = -11; i <= 11; i++) for (let j = -11; j <= 11; j++)
  PTS.push([i * 0.2903 + 0.0071, j * 0.2411 - 0.0053]);
PTS.push([0, 0], [1e-12, 0], [0, -1e-12], [-3.7, 4.9]);

let fails = 0;
const claim = (ok, what, detail) => { if (!ok) fails++; console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + what + (detail ? '   ' + detail : '')); };

function compare(APP, names) {
  const F = F0();
  F.OPC = names.map(n => R[n]);
  const fn = APP.compileUnform(F);
  if (!fn) return { built: false, bad: 0, n: 0 };
  const a = [0, 0, 0], b = [0, 0, 0];
  let bad = 0, worst = 0;
  for (const [x, y] of PTS) {
    APP.glassUnform(x, y, F, a);
    fn(x, y, F, b);
    for (let i = 0; i < 3; i++) if (!Object.is(a[i], b[i])) { bad++; worst = Math.max(worst, Math.abs(a[i] - b[i])); }
  }
  return { built: true, bad, worst, n: PTS.length };
}

const APP = build(null);

console.log('\nA  it builds — a generator that always fell back would pass section B for free');
for (const [what, names] of CHAINS) {
  const r = compare(APP, names);
  claim(r.built, 'specialised: ' + what, names.length + ' ops');
}
const bodyCount = Object.keys(APP.unformBodies()).length;
claim(bodyCount === 5, 'all five kinds were sliced out of the walk', bodyCount + ' of 5');

console.log('\nB  it agrees with the walk, bitwise');
for (const [what, names] of CHAINS) {
  const r = compare(APP, names);
  claim(r.built && r.bad === 0, what,
    r.built ? r.n * 3 + ' values, ' + r.bad + ' differing' + (r.bad ? ', worst ' + r.worst : '') : 'did not build');
}

console.log('\nE  one function per shape, kept — and the shape is the whole key');
{
  const A2 = build(null);
  const F = F0(); F.OPC = [R.spin, R.blow, R.stir];
  const first = A2.compileUnform(F);
  // the same SHAPE with different scalars must reuse the function, because the generated code reads
  // the records from F at call time and so depends on the kind sequence alone
  const F2 = F0(); F2.OPC = [{ ...R.spin, a: 9.1 }, { ...R.blow, s: 3.3 }, R.stir];
  const again = A2.compileUnform(F2);
  claim(!!first && first === again, 'the same kind sequence reuses the same function object',
    'different scalars, same shape');
  // and reuse has to still be RIGHT for the second slab, which is the claim that makes it safe
  const a = [0, 0, 0], b = [0, 0, 0];
  let bad = 0;
  if (again) for (const [x, y] of PTS) {
    A2.glassUnform(x, y, F2, a); again(x, y, F2, b);
    for (let i = 0; i < 3; i++) if (!Object.is(a[i], b[i])) bad++;
  }
  claim(!!again && bad === 0, 'and the reused function is correct for the second slab’s values',
    PTS.length * 3 + ' values, ' + bad + ' differing');
  const F3 = F0(); F3.OPC = [R.blow, R.spin, R.stir];
  const other = A2.compileUnform(F3);
  claim(!!other && other !== first, 'a different kind sequence builds a different function', 'blow and spin swapped');
  const F4 = F0(); F4.OPC = [R.spin, { k: 9, ox: 0, oy: 0 }];
  claim(A2.compileUnform(F4) === null, 'an unsliceable shape is remembered as null');
  claim(A2.compileUnform(F4) === null, 'and stays null on the next tile rather than being retried');
}

console.log('\nC  a chain it cannot slice falls back rather than guessing');
{
  const F = F0(); F.OPC = [R.spin, { k: 9, ox: 0, oy: 0 }];
  claim(APP.compileUnform(F) === null, 'an unknown op kind returns null', 'k = 9');
  const F2 = F0(); F2.OPC = [];
  claim(APP.compileUnform(F2) === null, 'an empty chain returns null');
  const F3 = F0(); F3.OPC = new Array(65).fill(R.blow);
  claim(APP.compileUnform(F3) === null, 'a chain longer than the cap returns null', '65 ops');
}

if (process.argv.includes('--ablate')) {
  console.log('\nD  ablations — the self-check must be what is protecting the picture');
  // break an emitted body. The self-check must REJECT it, so compileUnform returns null.
  // THE TARGET IS THE SPIN'S OWN ARITHMETIC, and it has to be text the spin actually contains. It
  // used to read 'op.a * r'; build 2026.10.24.179 rewrote the spin as a rotation and that string went
  // away, so both arms below silently stopped corrupting anything and reported a false red. A bent
  // ablation is worse than none, because it reads as the gate working.
  const SPINEXPR = 'op.a * Math.sqrt(px * px + py * py)';
  const bend = ({ bodies, comp, walk }) => {
    if (walk.indexOf(SPINEXPR) < 0) throw new Error('the spin no longer contains ' + SPINEXPR
      + ' — repoint the ablation rather than leaving it matching nothing');
    return { bodies: bodies.replace('out[k] = src.slice(open + 1, i);',
      "out[k] = src.slice(open + 1, i).replace('" + SPINEXPR + "', '" + SPINEXPR + " * 1.0000001');"),
      comp, walk };
  };
  {
    const A = build(bend);
    const F = F0(); F.OPC = [R.spin, R.blow];
    claim(A.compileUnform(F) === null, 'caught: a corrupted spin body is rejected by the self-check');
  }
  // and with the self-check removed, that same corruption must reach the output - otherwise the
  // ablation above proved nothing about the self-check
  {
    // DISABLE THE TEST, DO NOT DELETE THE CODE. Cutting the self-check out by pattern left the
    // single-point check at the origin standing - where the spin's r > 1e-9 guard makes this
    // corruption invisible anyway - and mangled the syntax into compileUnform's own catch, so the
    // arm reported "did not build" and proved nothing. Both comparisons are neutered by name.
    const A = build(({ bodies, comp, walk }) => {
      const b = bend({ bodies, comp, walk });
      const off = comp.split('if (!Object.is(a[0], b[0]) || !Object.is(a[1], b[1]) || !Object.is(a[2], b[2])) return null;')
        .join('if (false) return null;');
      return { bodies: b.bodies, walk, comp: off };
    });
    const F = F0(); F.OPC = [R.spin, R.blow];
    const fn = A.compileUnform(F);
    let differs = false;
    if (fn) {
      const a = [0, 0, 0], b = [0, 0, 0];
      for (const [x, y] of PTS) {
        A.glassUnform(x, y, F, a); fn(x, y, F, b);
        if (!Object.is(a[0], b[0]) || !Object.is(a[1], b[1])) { differs = true; break; }
      }
    }
    claim(differs, 'and without the self-check that corruption reaches the output',
      !fn ? 'did not build — the ablation did not isolate the self-check'
          : differs ? 'built, and differs' : 'built but AGREES — the corruption never landed');
  }
  // a slicer that returns nothing must fall back, not emit an empty chain that silently does nothing
  {
    const A = build(({ bodies, comp, walk }) => ({ bodies: bodies.replace('return out;', 'return {};'), comp, walk }));
    const F = F0(); F.OPC = [R.spin, R.blow];
    claim(A.compileUnform(F) === null, 'caught: a slicer that finds no bodies returns null');
  }
}

console.log('');
if (fails) { console.error('probe-chain-spec: ' + fails + ' FAILED'); process.exit(1); }
console.log('probe-chain-spec: OK — the unrolled chain is the walk, and it is really being built');

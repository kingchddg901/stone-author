// THE SPIN IS A ROTATION, AND THE SHIPPED FORM IS THE EXACT ONE.
//
// A spin maps p to c + R(-a*r)*(p - c). The build before `2026.10.24.179` computed that by recovering
// the angle with woodAtan2, subtracting a*r and rebuilding the point from r and the new angle. Same
// map, three transcendentals instead of two, and - because woodAtan2 is a polynomial approximation -
// an angular error that `c + r*(cos, sin)` turns into a POSITIONAL one of r times epsilon.
//
// Two separate claims live here and they are not the same kind of claim:
//
//   THE NEW FORM IS EXACT. Checked against the rotation written the other way with Math.atan2, which
//   has no approximation in it. This is a correctness assertion and it has a tolerance in ULPs.
//   THE OLD FORM WAS NOT, AND BY HOW MUCH. Measured and printed rather than asserted, because the
//   number is the accepted cost of the change and renderer-determinism.md quotes it. A probe that
//   only asserted the first claim would let that figure drift silently out of the doc.
//
//   node tools/probe-spin-identity.mjs             prove it
//   node tools/probe-spin-identity.mjs --ablate    prove it can go red
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

// The chain the walk runs is spin-only here, so the stir, roll and press helpers are never reached.
// They are stubbed anyway: a free name that is never executed does not throw, and relying on that is
// how a probe starts passing for the wrong reason.
const STUBS = `
  const SLAB_FT = 8;
  function glassUnwarp(S, cu, cvv, out) { out[0] = 0; out[1] = 0; }
  function rollStampAt(s, v, op) { return 0; }
  function rollerAt(B, cu, cvv, out) { out[0] = 0; out[1] = 0; }
  function rollerHand(B, s, out) { out[0] = 0; out[1] = 0; }
`;

// THE SPIN'S TABLE TRAVELS WITH THE WALK. glassUnform reads SPIN_T, SPIN_NB and SPIN_TURN, so all
// three have to be lifted beside it - the same rule that caught three probes in one afternoon. The
// declaration and the builder come from the app rather than being written again here.
const SPIN_DECL = (SRC.match(/const SPIN_NB = [^;]*;/) || [])[0];
if (!SPIN_DECL) { console.error('FAIL - no SPIN_NB declaration in the app'); process.exit(1); }
const SPIN_ENV = SPIN_DECL + String.fromCharCode(10) + liftFn('spinTable')
  + String.fromCharCode(10) + 'const SPIN_T = spinTable();' + String.fromCharCode(10);

function build(mutate) {
  let walk = liftFn('glassUnform');
  if (mutate) walk = mutate(walk);
  return new Function(STUBS + SPIN_ENV + liftFn('woodAtan2') + '\n' + walk
    + '\nreturn { glassUnform, woodAtan2 };')();
}

const APP = build(null);

// ---- the two references -----------------------------------------------------------------------
// EXACT: the rotation written the long way, with Math.atan2 rather than the approximation. A
// different formulation of the same map, so agreement to a few ULPs is a real check and not a
// restatement of the shipped expression.
const exact = (x, y, ox, oy, a) => {
  const px = x - ox, py = y - oy, r = Math.sqrt(px * px + py * py);
  if (r === 0) return [ox, oy];
  const th = Math.atan2(py, px) - a * r;
  return [ox + r * Math.cos(th), oy + r * Math.sin(th)];
};
// OLD: exactly what shipped before 179, kept so the accepted cost stays measured.
const old = (x, y, ox, oy, a) => {
  const px = x - ox, py = y - oy, r = Math.sqrt(px * px + py * py);
  if (r > 1e-9) { const th = APP.woodAtan2(py, px) - a * r; return [ox + r * Math.cos(th), oy + r * Math.sin(th)]; }
  return [x, y];
};
const shipped = (x, y, ox, oy, a) => {
  const F = { OPC: [{ k: 1, a, ox, oy }] }, out = [0, 0, 0];
  APP.glassUnform(x, y, F, out);
  return [out[0], out[1]];
};

const CASES = [
  ['the reference slab: a = 1.2 at the origin', 0, 0, 1.2],
  ['off-centre', 0.31, -0.22, 1.2],
  ['strong', 0, 0, 4.0],
  ['negative', 0, 0, -0.7],
];
const PTS = [];
for (let i = -45; i <= 45; i++) for (let j = -45; j <= 45; j++)
  PTS.push([i * 0.089 + 0.0031, j * 0.077 - 0.0017]);

let fails = 0;
const claim = (ok, what, detail) => { if (!ok) fails++; console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + what + (detail ? '   ' + detail : '')); };
// SCALED BY THE RADIUS, NOT BY THE RESULT. The two formulations cancel when a coordinate lands near
// zero, which sends a relative-to-result error to 1e-10 while the absolute error stays at 1e-16 feet.
// Measuring against the radius is the honest scale: it is the size of the thing being rotated.
const dev = (p, q, r) => Math.abs(p - q) / Math.max(1e-9, r);

console.log('\nA  the shipped spin is the rotation, to the table’s bound');
for (const [name, ox, oy, a] of CASES) {
  let worst = 0, worstAbs = 0;
  for (const [x, y] of PTS) {
    const S = shipped(x, y, ox, oy, a), E = exact(x, y, ox, oy, a);
    const r = Math.hypot(x - ox, y - oy);
    worst = Math.max(worst, dev(S[0], E[0], r), dev(S[1], E[1], r));
    worstAbs = Math.max(worstAbs, Math.abs(S[0] - E[0]), Math.abs(S[1] - E[1]));
  }
  // THE BOUND IS THE TABLE'S, NOT THE ARITHMETIC'S, AND IT HAS MOVED TWICE.
  //
  //   until 181   1e-13   Math.cos and Math.sin, exact to a few ULPs
  //        181    1e-7    a 16,384-entry table, worst 1.8e-8  = 5.2e-4 px of 65,535
  //        182    1e-6    a  4,096-entry table, worst 2.9e-7  = 1.4e-2 px
  //
  // The table shrank for CACHE, not accuracy: 181 went bimodal on a 256 KB-per-worker table and
  // 4,096 entries is 64 KB. Both bounds are measured h^2/8 of the step, and the probe reported
  // 2.94e-7 against a predicted 2.94e-7 when the size changed — which is the arithmetic confirming
  // itself rather than a tolerance being nudged until it passed. Tighten this and the TABLE changes.
  claim(worst < 1e-6, name, 'worst ' + worst.toExponential(2) + ' of the radius, '
    + worstAbs.toExponential(2) + ' ft = ' + (worstAbs / 8 * 65535).toExponential(1)
    + ' px of 65,535, over ' + PTS.length.toLocaleString() + ' points');
}
{
  // the centre, where the old form needed a guard and this one does not
  const S = shipped(0.31, -0.22, 0.31, -0.22, 1.2);
  claim(Object.is(S[0], 0.31) && Object.is(S[1], -0.22), 'r = 0 returns the centre, with no guard', JSON.stringify(S));
}

console.log('\nB  what the change cost, measured — renderer-determinism.md quotes these');
{
  const ME = [];
  for (const [name, ox, oy, a] of CASES) {
    let worstAbs = 0, worstR = 0, sum = 0;
    for (const [x, y] of PTS) {
      const S = shipped(x, y, ox, oy, a), O = old(x, y, ox, oy, a);
      const d = Math.max(Math.abs(S[0] - O[0]), Math.abs(S[1] - O[1]));
      const r = Math.hypot(x - ox, y - oy);
      sum += d;
      if (d > worstAbs) { worstAbs = d; worstR = r; }
    }
    ME.push({ name, worstAbs, worstR, mean: sum / PTS.length });
    console.log('        ' + name.padEnd(42) + 'worst ' + worstAbs.toExponential(2) + ' ft at r = '
      + worstR.toFixed(2) + '  (' + (worstAbs / 8 * 65535).toFixed(1) + ' px of 65,535)   mean '
      + (sum / PTS.length).toExponential(2) + ' ft');
  }
  // the angular error itself, which is where all of that comes from
  let we = 0, se = 0, n = 0;
  for (let i = 0; i < 6000; i++) {
    const th = (i / 6000) * 2 * Math.PI - Math.PI;
    const e = Math.abs(APP.woodAtan2(Math.sin(th), Math.cos(th)) - th);
    n++; se += e; if (e > we) we = e;
  }
  console.log('        woodAtan2 itself: mean ' + (se / n).toExponential(2) + ' rad, worst ' + we.toExponential(2) + ' rad');
  claim(we > 1e-4 && we < 1e-2, 'woodAtan2 is an approximation, and still the one measured',
    'worst ' + we.toExponential(2) + ' rad — if this moves, the doc is stale');
  claim(ME.every(m => m.worstAbs > 1e-4), 'the old form really did differ by a visible amount',
    'if this goes green-to-red the comparison was never worth making');
}

if (process.argv.includes('--ablate')) {
  console.log('\nC  ablations — each must go red');
  // EVERY MUTATION BELOW IS ASSERTED TO LAND, by requiring the text it replaces to be present. The
  // 'cos and sin are swapped' arm targeted Math.cos(ar)/Math.sin(ar), which build 181 replaced with a
  // table read — so it quietly stopped corrupting anything, and it still reported ok because its
  // threshold was 1e-13 while the table's own error is 1.8e-8. It would have passed on any build.
  const must = (w, from, to) => {
    if (w.indexOf(from) < 0) throw new Error('the spin no longer contains: ' + from.slice(0, 48)
      + ' — repoint this ablation rather than leaving it matching nothing');
    return w.replace(from, to);
  };
  const ABL = [
    ['the rotation turns the wrong way', w => must(w,
      'x = ox + px * c1 + py * s1; y = oy - px * s1 + py * c1;',
      'x = ox + px * c1 - py * s1; y = oy + px * s1 + py * c1;')],
    ['the radius is dropped from the angle', w => must(w,
      'ar = op.a * Math.sqrt(px * px + py * py)', 'ar = op.a')],
    ['the table rows are swapped, so cos reads sin', w => must(w,
      'const c1 = SPIN_T[sj] + sf * (SPIN_T[sj + 2] - SPIN_T[sj]);',
      'const c1 = SPIN_T[sj + 1] + sf * (SPIN_T[sj + 3] - SPIN_T[sj + 1]);')],
    ['the interpolation is dropped, leaving the nearest entry', w => must(w,
      'const si = su | 0, sf = su - si, sj = si << 1;', 'const si = su | 0, sf = 0, sj = si << 1;')],
    ['the turn reduction is dropped, so the index runs off the table', w => must(w,
      'const sq = ar * SPIN_TURN, su = (sq - Math.floor(sq)) * SPIN_NB;',
      'const sq = ar * SPIN_TURN, su = sq * SPIN_NB;')],
  ];
  for (const [what, mut] of ABL) {
    let red = false, why = '';
    try {
      const A = build(mut);
      const sh = (x, y, ox, oy, a) => { const F = { OPC: [{ k: 1, a, ox, oy }] }, o = [0, 0, 0]; A.glassUnform(x, y, F, o); return [o[0], o[1]]; };
      let worst = 0;
      for (const [x, y] of PTS) { const S = sh(x, y, 0, 0, 1.2), E = exact(x, y, 0, 0, 1.2);
        const r = Math.hypot(x, y); worst = Math.max(worst, dev(S[0], E[0], r), dev(S[1], E[1], r)); }
      red = !(worst < 1e-6); why = 'worst ' + worst.toExponential(2) + ' of the radius';
    } catch (e) { red = true; why = 'threw: ' + e.message; }
    claim(red, 'caught: ' + what, why);
  }
}

console.log('');
if (fails) { console.error('probe-spin-identity: ' + fails + ' FAILED'); process.exit(1); }
console.log('probe-spin-identity: OK — the spin is the rotation within the table’s bound, and what it cost is measured above');

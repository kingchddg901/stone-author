// AN ANALYTIC GRADIENT FOR glassFormT, PROVED BEFORE IT IS WIRED IN.
//
// docs/glass-one-pixel.md §4: glassFormT is called three times per pixel per sample, and two of those
// calls exist only to finite-difference a gradient that feeds the shading. Measured there: all three
// are 40.6% of a 1024 tile and the gradient pair alone 27.9%, which scaled to a 4096 tile is about
// 6.2 s of 16.9 s - roughly three minutes of an 8:18 master. The value and both partials share the
// same four corner hashes, so twelve hashes can do what thirty-six do now.
//
// THIS PROBE DOES NOT CHANGE THE RENDERER. It lifts nz, vnoise, fbm2 and glassFormT out of the app,
// implements the analytic gradient beside them, and asks two different questions:
//
//   1. IS THE DERIVATIVE RIGHT?  A finite difference is an APPROXIMATION, so analytic and FD are not
//      supposed to be equal. What proves the derivative is that FD CONVERGES to it as the step
//      shrinks - halve eps, halve the error. A wrong derivative does not converge, it plateaus at
//      whatever it is wrong by. This is the claim that can fail.
//
//   2. WHAT WOULD CHANGE?  At the production eps of 0.004 ft the two differ by a real amount, and
//      that difference is the shading shift every existing glass master would take. §4 of the doc
//      argues it is "a fraction of a level" because the gradient feeds only `sl` in the shading
//      multiplier - never a coordinate, never the ribbon label, which is the dangerous class in §7.
//      Verified here at the call site: gu and gv are read at exactly one line.
//
// THREE PLACES THE TWO LEGITIMATELY DISAGREE, and the probe counts them rather than hiding them:
// the max(T, 0.05) clamp, the r < FR piecewise in the spun crown, and the cusps of the rolled
// roller's triangle wave. At a cusp the true derivative does not exist; a finite difference steps
// straight over it and returns an average. Those samples are reported, not scored.
//
//   node tools/probe-glass-gradient.mjs
import { readFileSync } from 'fs';

const SRC = readFileSync(new URL('../app/stone-author.html', import.meta.url), 'utf8');
function liftFn(name) {
  const needle = 'function ' + name + '(';
  const hits = [];
  for (let k = SRC.indexOf(needle); k >= 0; k = SRC.indexOf(needle, k + 1)) hits.push(k);
  if (!hits.length) throw new Error('cannot find function ' + name + ' - probe is stale');
  if (hits.length > 1) throw new Error(name + ' is defined ' + hits.length + ' times - lift is ambiguous');
  let i = SRC.indexOf('{', hits[0]), d = 0;
  for (;; i++) { if (SRC[i] === '{') d++; else if (SRC[i] === '}' && --d === 0) break; }
  return SRC.slice(hits[0], i + 1);
}

// The LAST four are the shipped analytic path. This probe keeps its own reference implementation
// below - instrumented with the edge flags the scoring needs, which the shipped one has no business
// carrying - and section D asserts the two agree. Without that, the probe would go on proving a COPY
// correct while the app drifted away from it, which is the failure mode a probe is supposed to catch.
const lifted = ['nz', 'vnoise', 'fbm2', 'glassFormT', 'vnoiseG', 'fbm2G', 'glassFormTG'].map(liftFn).join('\n');
const APP = new Function(lifted + '\nreturn { nz, vnoise, fbm2, glassFormT, glassFormTG };')();
const { nz, fbm2, glassFormT } = APP;
const shippedFormTG = APP.glassFormTG;

// ---- the analytic side ------------------------------------------------------------------------
// vnoise interpolates with a smoothstep, sx = tx^2(3-2tx), whose derivative is 6tx(1-tx). The value
// and both partials read the SAME four corner hashes - which is the whole saving, because the hashes
// are the expensive part and everything after them is arithmetic.
function vnoiseG(x, y, s, out) {
  const xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const dsx = 6 * tx * (1 - tx), dsy = 6 * ty * (1 - ty);
  const a = nz(xi, yi, s), b = nz(xi + 1, yi, s), c = nz(xi, yi + 1, s), d = nz(xi + 1, yi + 1, s);
  const top = a + (b - a) * sx, bot = c + (d - c) * sx;
  out[0] = top + (bot - top) * sy;
  out[1] = dsx * ((b - a) * (1 - sy) + (d - c) * sy);
  out[2] = dsy * (bot - top);
}
const _v = [0, 0, 0];
function fbm2G(x, y, s, out) {
  vnoiseG(x, y, s, _v);                 let v = _v[0] * 0.6, gx = _v[1] * 0.6, gy = _v[2] * 0.6;
  vnoiseG(x * 2.1, y * 2.1, s + 9, _v); v += _v[0] * 0.3; gx += _v[1] * 0.3 * 2.1; gy += _v[2] * 0.3 * 2.1;
  vnoiseG(x * 4.3, y * 4.3, s + 19, _v); v += _v[0] * 0.1; gx += _v[1] * 0.1 * 4.3; gy += _v[2] * 0.1 * 4.3;
  out[0] = v; out[1] = gx; out[2] = gy;
}

const _f = [0, 0, 0];
// Returns [T, dT/dox, dT/doy] and a flag for each place the derivative is not defined or is clamped.
function glassFormTG(ox, oy, F, fv, out) {
  let T = F.TH, dx = 0, dy = 0;
  let edge = 0;                                            // 1 clamp, 2 piecewise, 4 cusp
  if (F.RM > 0 && (fv[0] || fv[1])) {
    const a = ox * fv[0] + oy * fv[1], c = -ox * fv[1] + oy * fv[0];
    fbm2G(c * F.RS, a * F.RS * 0.06, 71, _f);
    const k = F.RM * 0.30 * 2;
    const m = 1 + k * (_f[0] - 0.5);
    // chain rule through the rotation into (across, along)
    const dmx = k * (_f[1] * (-fv[1] * F.RS) + _f[2] * (fv[0] * F.RS * 0.06));
    const dmy = k * (_f[1] * (fv[0] * F.RS) + _f[2] * (fv[1] * F.RS * 0.06));
    dx = T * dmx; dy = T * dmy; T *= m;
  } else if (F.RM > 0) {
    fbm2G(ox * F.RS * 0.5, oy * F.RS * 0.5, 11, _f);
    const k = F.RM * 0.18 * 2;
    const m = 1 + k * (_f[0] - 0.5);
    dx = T * k * _f[1] * F.RS * 0.5; dy = T * k * _f[2] * F.RS * 0.5; T *= m;
  }
  if (F.form === 'spun') {
    const r = Math.sqrt(ox * ox + oy * oy);
    const drx = r > 0 ? ox / r : 0, dry = r > 0 ? oy / r : 0;
    const inside = r < F.FR;
    if (!inside) edge |= 2;
    const m = 1 - 0.45 * (inside ? r / F.FR : 1);
    const dmx = inside ? -0.45 * drx / F.FR : 0, dmy = inside ? -0.45 * dry / F.FR : 0;
    dx = dx * m + T * dmx; dy = dy * m + T * dmy; T *= m;
    const b = r / (F.FR * 0.07), e = Math.exp(-b * b), db = 1 / (F.FR * 0.07);
    const kb = F.TH * 2.0 * e * (-2 * b) * db;
    dx += kb * drx; dy += kb * dry; T += F.TH * 2.0 * e;
    const ks = F.TH * F.RM * 0.14 * Math.cos(r * F.RS * 7) * F.RS * 7;
    dx += ks * drx; dy += ks * dry; T += F.TH * F.RM * 0.14 * Math.sin(r * F.RS * 7);
  } else if (F.form === 'rolled') {
    const u = ox * F.FP, f = u - Math.floor(u);
    if (f < 1e-9 || Math.abs(f - 0.5) < 1e-9) edge |= 4;    // the cusps of the triangle
    dx += F.TH * F.FD * (f < 0.5 ? 2 : -2) * F.FP;
    T += F.TH * F.FD * (1 - Math.abs(2 * f - 1));
  }
  if (T <= 0.05) { edge |= 1; out[0] = 0.05; out[1] = 0; out[2] = 0; out[3] = edge; return; }
  out[0] = T; out[1] = dx; out[2] = dy; out[3] = edge;
}

// ---- the fixtures ------------------------------------------------------------------------------
// Derived from what glassFormT actually reads, across every branch it has: all three forms, flowing
// and poured, and a reach that straddles FR so the piecewise is exercised rather than avoided.
const FORMS = [
  // FR SPANS THE LATTICE. At 1.6 ft against points reaching 3.8 the crown's piecewise excluded 1,348
  // of 1,600 samples and section B was measured on the rim alone - the part of a spun disc with the
  // least structure in it. A disc wide enough to hold the sample field puts the bullion, the rings
  // and the thinning all inside the scored set.
  { name: 'spun, flowing',  F: { TH: 4.2, RM: 0.7, RS: 9.0, form: 'spun',   FR: 4.2, FP: 0, FD: 0 },    fv: [0.6, 0.8] },
  { name: 'spun, poured',   F: { TH: 4.2, RM: 0.7, RS: 9.0, form: 'spun',   FR: 4.2, FP: 0, FD: 0 },    fv: [0, 0] },
  { name: 'rolled',         F: { TH: 5.0, RM: 0.5, RS: 6.0, form: 'rolled', FR: 0, FP: 3.7, FD: 0.35 }, fv: [1, 0] },
  { name: 'blown',          F: { TH: 3.4, RM: 0.9, RS: 12.0, form: 'blown', FR: 0, FP: 0, FD: 0 },      fv: [0, 1] },
  { name: 'poured, no draw', F: { TH: 3.0, RM: 0.6, RS: 7.0, form: 'poured', FR: 0, FP: 0, FD: 0 },     fv: [0, 0] },
];

let fails = 0;
const claim = (what, ok, detail) => {
  if (!ok) fails++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + what + (detail ? '   ' + detail : ''));
};
const fd = (F, fv, ox, oy, eps, axis) =>
  (glassFormT(axis ? ox : ox + eps, axis ? oy + eps : oy, F, fv) - glassFormT(ox, oy, F, fv)) / eps;

// A fixed lattice rather than Math.random: the same points every run, so a regression is a
// regression and not a reroll. Spread over feet, which is what ox/oy are.
const PTS = [];
for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++)
  PTS.push([(i - 20) * 0.19 + 0.037, (j - 20) * 0.17 + 0.023]);

const out = [0, 0, 0, 0];

console.log('\nA  the derivative is right: a finite difference CONVERGES to it as the step shrinks');
for (const { name, F, fv } of FORMS) {
  const errs = [];
  for (const eps of [0.004, 0.002, 0.001, 0.0005]) {
    let sum = 0, n = 0;
    for (const [ox, oy] of PTS) {
      glassFormTG(ox, oy, F, fv, out);
      if (out[3]) continue;                                 // clamp, piecewise or cusp: not scored
      const scale = Math.max(1e-6, Math.abs(out[1]) + Math.abs(out[2]));
      sum += (Math.abs(fd(F, fv, ox, oy, eps, 0) - out[1]) + Math.abs(fd(F, fv, ox, oy, eps, 1) - out[2])) / scale;
      n++;
    }
    errs.push(sum / Math.max(1, n));
  }
  // halving eps should roughly halve the error - a WRONG derivative plateaus instead
  const ratio = errs[0] / errs[errs.length - 1];
  claim(name.padEnd(18) + 'error falls ' + ratio.toFixed(1) + 'x over an 8x smaller step',
    ratio > 4, 'err ' + errs.map(e => e.toFixed(4)).join(' -> '));
}

console.log('\nB  what it would change, at the production eps of 0.004 ft');
console.log('   the gradient feeds only `sl = (gu*Lx + gv*Ly)*0.05`, and `m = 1 + REL*0.55*sl/(1+|sl|)`');
for (const { name, F, fv } of FORMS) {
  const Lx = 0.6, Ly = 0.8, REL = 0.8;
  let worst = 0, sum = 0, n = 0, edges = 0;
  for (const [ox, oy] of PTS) {
    glassFormTG(ox, oy, F, fv, out);
    if (out[3]) { edges++; continue; }
    const gu = fd(F, fv, ox, oy, 0.004, 0), gv = fd(F, fv, ox, oy, 0.004, 1);
    const slA = (out[1] * Lx + out[2] * Ly) * 0.05, slF = (gu * Lx + gv * Ly) * 0.05;
    const mA = 1 + REL * 0.55 * (slA / (1 + Math.abs(slA)));
    const mF = 1 + REL * 0.55 * (slF / (1 + Math.abs(slF)));
    const lv = Math.abs(mA - mF) * 255;                     // worst case: a channel at full
    if (lv > worst) worst = lv;
    sum += lv; n++;
  }
  console.log('     ' + name.padEnd(18) + 'mean ' + (sum / Math.max(1, n)).toFixed(2)
    + ' levels   worst ' + worst.toFixed(2) + '   (' + edges + ' of ' + PTS.length + ' at an edge case)');
}

console.log('\nC  the saving, in hashes');
{
  const perFbm = 3 * 4;                                    // 3 octaves x 4 corner hashes
  console.log('     three glassFormT calls   3 x ' + perFbm + ' = ' + (3 * perFbm) + ' hashes');
  console.log('     one call with gradients  1 x ' + perFbm + ' = ' + perFbm + ' hashes');
  console.log('     and two fewer of every exp, sin, sqrt and branch in the rest of the function');
  claim('the gradient pair costs two thirds of the hashes', 3 * perFbm - perFbm, 24);
}

console.log('\nD  the SHIPPED glassFormTG is the one proved above');
{
  const mine = [0, 0, 0, 0], theirs = [0, 0, 0];
  let worstT = 0, worstG = 0, checked = 0;
  for (const { F, fv } of FORMS) for (const [ox, oy] of PTS) {
    glassFormTG(ox, oy, F, fv, mine);
    shippedFormTG(ox, oy, F, fv, theirs);
    // T IS COMPARED AGAINST glassFormT, NOT against this file's reference. The reference writes the
    // streak as 1 + k*(f-0.5); the app writes glassFormT's own 1 + RM*0.30*(f-0.5)*2 - algebraically
    // equal, different last place. The app is right to keep its twin EXACT, and that is the invariant
    // worth asserting: the new function returns the OLD thickness, so the only thing that moved is the
    // slope. Asserting against the reference instead went red at 1.78e-15 and was the wrong question.
    const t0 = glassFormT(ox, oy, F, fv);
    if (theirs[0] !== t0) worstT = Math.max(worstT, Math.abs(theirs[0] - t0) || 1e-300);
    const s = Math.max(1e-9, Math.abs(mine[1]) + Math.abs(mine[2]));
    worstG = Math.max(worstG, (Math.abs(theirs[1] - mine[1]) + Math.abs(theirs[2] - mine[2])) / s);
    checked++;
  }
  claim('thickness is bit-identical to glassFormT', worstT === 0,
    checked + ' points' + (worstT ? '   worst |dT| ' + worstT.toExponential(2) : ''));
  claim('gradient matches the reference', worstG < 1e-12, 'worst relative ' + worstG.toExponential(2));
}

console.log('');
if (fails) { console.log(fails + ' FAILED'); process.exit(1); }
console.log('glass-gradient: OK — the analytic derivative converges, and the shading shift is measured above');

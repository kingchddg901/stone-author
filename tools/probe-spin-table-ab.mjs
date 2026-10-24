// INDEX THE SPIN TABLE BY THE ANGLE OR BY THE RADIUS? The shipped answer is the angle, and the
// reasons at app/stone-author.html:6943 are architectural rather than measured: one table serves every
// spin on every slab, there is no Rmax to bound, no fallback branch and no per-op array sized by `a`.
// All true, and none of it says which is FASTER. That comparison had never been run.
//
// WHAT THE OTHER ONE WOULD BE. A radius-indexed table holds cos(a*r) and sin(a*r) sampled along r for
// ONE op, so the lookup is a multiply and an index - no reduction into turns, no floor, no subtract.
// It pays for that three times: a table per op rather than one for the process, a bound on r with a
// branch for anything past it, and an accuracy that scales with `a` where the angle table's does not.
// The angle table's step is 2*pi/4096 of ANGLE whatever the slab does; the radius table's step is
// a*Rmax/4096, so a tight spin samples the same curve more coarsely.
//
// THE SLAB'S OWN SPIN IS a = 1.2, read out of harness/dist/slab.json, and the sweep runs either side
// of it rather than over invented numbers.
//
// MEASURED THE WAY TODAY TAUGHT. Timing several arms in sequence did not reproduce in
// vnoisec-variants-probe - the first position is clean and every later one drifts - so each arm is
// timed against the shipped one INTERLEAVED A B B A with the order flipped each round, and the
// reference arm's own spread is printed as the only honest statement of how far the box moved.
//
//   node tools/probe-spin-table-ab.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(root, 'app/stone-author.html'), 'utf8').replace(/\r\n/g, String.fromCharCode(10));

function liftFn(name) {
  const at = SRC.indexOf('function ' + name + '(');
  if (at < 0) { console.error('FAIL - no function ' + name + ' in the app'); process.exit(1); }
  let d = 0;
  for (let j = SRC.indexOf('{', at); j < SRC.length; j++) {
    if (SRC[j] === '{') d++;
    else if (SRC[j] === '}') { d--; if (!d) return SRC.slice(at, j + 1); }
  }
  console.error('FAIL - unbalanced ' + name); process.exit(1);
}
const SPIN_DECL = (SRC.match(/const SPIN_NB = [^;]*;/) || [])[0];
if (!SPIN_DECL) { console.error('FAIL - no SPIN_NB declaration in the app'); process.exit(1); }

// THE SHIPPED ARM IS LIFTED, NOT RETYPED, table and constants and all.
const env = new Function(SPIN_DECL + String.fromCharCode(10) + liftFn('spinTable')
  + String.fromCharCode(10) + 'const SPIN_T = spinTable();'
  + String.fromCharCode(10) + 'return { SPIN_NB, SPIN_TURN, SPIN_T };')();
const { SPIN_NB, SPIN_TURN, SPIN_T } = env;

// And the arm itself is sliced out of glassUnform's spin case, so this cannot drift from the walk.
const SPIN_SRC = (() => {
  const i = SRC.indexOf('const px = x - ox, py = y - oy, ar = op.a * Math.sqrt(px * px + py * py);');
  if (i < 0) { console.error('FAIL - the spin arm is not where this probe expects it'); process.exit(1); }
  const j = SRC.indexOf('y = oy - px * s1 + py * c1;', i);
  if (j < 0) { console.error('FAIL - the spin arm does not end where this probe expects it'); process.exit(1); }
  return SRC.slice(i, j + 'y = oy - px * s1 + py * c1;'.length);
})();
const shipped = new Function('SPIN_NB', 'SPIN_TURN', 'SPIN_T',
  'return function (x, y, ox, oy, op, out) {' + SPIN_SRC + ' out[0] = x; out[1] = y; };'
)(SPIN_NB, SPIN_TURN, SPIN_T);

// ---- the alternative: one table per op, indexed by r --------------------------------------------
const RMAX = 8 * Math.SQRT2;                 // a slab's far corner from any centre on it, in feet
function radiusTable(a, nb) {
  const t = new Float64Array((nb + 2) * 2);
  for (let i = 0; i <= nb + 1; i++) {
    const ang = a * (i * RMAX / nb);
    t[2 * i] = Math.cos(ang); t[2 * i + 1] = Math.sin(ang);
  }
  return t;
}
function makeRadius(a, nb) {
  const T = radiusTable(a, nb), SC = nb / RMAX;
  return function (x, y, ox, oy, op, out) {
    const px = x - ox, py = y - oy, r = Math.sqrt(px * px + py * py);
    let c1, s1;
    const u = r * SC;
    if (u >= nb) { const ar = a * r; c1 = Math.cos(ar); s1 = Math.sin(ar); }   // the fallback the angle table does not need
    else {
      const i = u | 0, f = u - i, j = i << 1;
      c1 = T[j] + f * (T[j + 2] - T[j]);
      s1 = T[j + 1] + f * (T[j + 3] - T[j + 1]);
    }
    out[0] = ox + px * c1 + py * s1;
    out[1] = oy - px * s1 + py * c1;
  };
}
// and the exact form, as the thing both are approximating
function exact(x, y, ox, oy, op, out) {
  const px = x - ox, py = y - oy, ar = op.a * Math.sqrt(px * px + py * py);
  const c1 = Math.cos(ar), s1 = Math.sin(ar);
  out[0] = ox + px * c1 + py * s1;
  out[1] = oy - px * s1 + py * c1;
}

// ---- accuracy, in the unit the picture is measured in -------------------------------------------
const PXFT = 65535 / 8;
function worstPx(fn, a) {
  const op = { a }, o = [0, 0], e = [0, 0];
  let worst = 0;
  for (let i = 0; i <= 4000; i++) {
    const r = (i / 4000) * RMAX;
    for (const th of [0.0, 0.7, 1.9, 3.3, 5.1]) {
      const x = r * Math.cos(th), y = r * Math.sin(th);
      fn(x, y, 0, 0, op, o); exact(x, y, 0, 0, op, e);
      const d = Math.hypot(o[0] - e[0], o[1] - e[1]);
      if (d > worst) worst = d;
    }
  }
  return worst * PXFT;
}

// ---- speed, interleaved, never in sequence ------------------------------------------------------
const W = 520, SX = 0.0031, SY = 0.0029;
const walk = fn => {
  const op = { a: 1.2 }, o = [0, 0];
  return reps => {
    let s = 0;
    for (let k = 0; k < reps; k++)
      for (let j = 0; j < W; j++) {
        const y = j * SY + 0.11;
        for (let i = 0; i < W; i++) { fn(i * SX + 0.17, y, 0.4, 0.3, op, o); s += o[0] + o[1]; }
      }
    return s;
  };
};
const ROUNDS = 5;
function pairRatio(a, b, unit) {
  const as = [], bs = [];
  a(unit); b(unit);
  for (let r = 0; r < ROUNDS; r++)
    for (const w of (r % 2 ? ['b', 'a', 'a', 'b'] : ['a', 'b', 'b', 'a'])) {
      const f = w === 'a' ? a : b;
      const t0 = process.hrtime.bigint(); f(unit);
      (w === 'a' ? as : bs).push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
  const mn = v => Math.min(...v), mx = v => Math.max(...v);
  return { best: mn(bs) / mn(as), worst: mx(bs) / mx(as),
    aMs: mn(as), bMs: mn(bs), aDrift: (mx(as) / mn(as) - 1) * 100 };
}
function calibrate(fn) {                       // enough passes to clear the clock, as the breakdown probe does
  let M = 1;
  for (let i = 0; i < 14; i++) {
    const t0 = process.hrtime.bigint(); fn(M);
    const dt = Number(process.hrtime.bigint() - t0) / 1e6;
    if (dt >= 25) break;
    M = Math.max(M + 1, Math.ceil(M * Math.max(1.7, 25 / Math.max(dt, 0.05))));
  }
  return M;
}

console.log('spin table: indexed by the angle, or by the radius?');
console.log('');
console.log('ACCURACY, worst positional error in px of a 65,535 render');
console.log('  the slab\'s own spin is a = 1.2; the table is 4,096 entries either way');
console.log('');
console.log('     a      angle-indexed (shipped)   radius-indexed');
let accFail = 0;
for (const a of [0.3, 1.2, 4, 12, 40]) {
  const sa = worstPx(shipped, a), ra = worstPx(makeRadius(a, SPIN_NB), a);
  console.log('  ' + String(a).padStart(4) + '   ' + sa.toFixed(4).padStart(18) + '   ' + ra.toFixed(4).padStart(14)
    + (ra > sa * 2 ? '   <-- coarser' : ''));
  if (!(sa < 0.1)) accFail++;                 // the shipped table's own claim: 0.014 px at 65,535
}
console.log('');
console.log('  the angle table samples 2*pi/4096 of ANGLE whatever `a` is; the radius table samples');
console.log('  a*Rmax/4096, so its error grows with the spin while the shipped one does not.');

console.log('');
console.log('SPEED, interleaved A B B A against the shipped arm, 520x520 samples a pass');
const shipWalk = walk(shipped), radWalk = walk(makeRadius(1.2, SPIN_NB)), exactWalk = walk(exact);
const M = calibrate(shipWalk);
for (const [name, w] of [['radius-indexed', radWalk], ['Math.cos/sin, no table', exactWalk]]) {
  const p = pairRatio(shipWalk, w, M);
  console.log('  ' + name.padEnd(24) + p.best.toFixed(3) + 'x best   ' + p.worst.toFixed(3) + 'x worst'
    + '   (shipped ' + p.aMs.toFixed(1) + ' ms, drift ' + p.aDrift.toFixed(0) + '%)');
}
console.log('  unit = ' + M + ' passes; a ratio under 1 is FASTER than what ships');

// ---- can the accuracy check fail? ---------------------------------------------------------------
console.log('');
console.log('ABLATION - the accuracy check must be able to bite');
const bentTable = radiusTable(1.2, SPIN_NB);
bentTable[2 * 1000] += 0.01;                   // one entry nudged, deep inside the table
const bent = (() => { const T = bentTable, SC = SPIN_NB / RMAX;
  return function (x, y, ox, oy, op, out) {
    const px = x - ox, py = y - oy, r = Math.sqrt(px * px + py * py), u = r * SC;
    const i = u | 0, f = u - i, j = i << 1;
    const c1 = T[j] + f * (T[j + 2] - T[j]), s1 = T[j + 1] + f * (T[j + 3] - T[j + 1]);
    out[0] = ox + px * c1 + py * s1; out[1] = oy - px * s1 + py * c1;
  }; })();
const bentErr = worstPx(bent, 1.2), cleanErr = worstPx(makeRadius(1.2, SPIN_NB), 1.2);
const bites = bentErr > cleanErr * 10;
console.log('  one table entry nudged by 0.01: ' + cleanErr.toFixed(4) + ' px -> ' + bentErr.toFixed(2) + ' px   '
  + (bites ? 'caught' : 'NOT CAUGHT - the accuracy check is decoration'));

console.log('');
const bad = accFail + (bites ? 0 : 1);
console.log(bad ? 'FAIL ' + bad + ' check(s)' : 'the shipped table holds its claim, and the check can fail');
process.exit(bad ? 1 : 0);

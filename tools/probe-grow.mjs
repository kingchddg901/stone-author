/**
 * A LINE STILL BEING DRAWN: the growth gate, pinned.
 *
 * The creation animation grows one mark at a time. `lineGeom` does it by dropping segments past
 * `gcut` from `keep` - never by being handed a shorter path - and a child line waits for the pen to
 * reach the point it grows out of. Five claims, each run against its own ablation; a claim whose
 * ablation still passes is reported as decoration rather than a test.
 *
 *   a normal render is UNTOUCHED     GROW_ID null, or GROW_T >= 1, or another mark: gcut is 1 and
 *                                   `s > 1` is false for every segment, `s` being a midpoint
 *                                   fraction. Not "almost the same" - the same bytes.
 *   only the grown mark moves        the family is chosen by `extra.mark`, which all five call
 *                                   sites pass.
 *   a growing line is the FINISHED   at grow 0.5 the segments still drawn carry exactly the widths
 *   line with its tail undrawn      they will have when the line is done.
 *   a child waits for the pen        `extra.at` is its fraction along the parent: absent before,
 *                                   arriving over GROW_WIN, whole after.
 *
 * THE SHAPE CLAIM'S ABLATION IS THE IMPLEMENTATION NEARLY WRITTEN INSTEAD: truncate `pts`. That
 * renormalises `total`, so `s` rescales and the swing, the break threshold and both tapers move -
 * the part already on screen writhes as the line grows, and the cut end pinches out because `tE`
 * tapers any line ending inside the slab.
 *
 * THE CHILD CLAIM'S ABLATION IS THE FIRST VERSION OF THIS FILE'S SUBJECT: ignore `extra.at` and
 * give every line in the family the same GROW_T. Minors then grow at a fraction of their OWN length
 * regardless of where they attach, so a minor near the tip finishes before the pen arrives.
 *
 *   node tools/probe-grow.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', 'app', 'stone-author.html'), 'utf8');

function lift(n) {
  const at = SRC.indexOf('function ' + n + '(');
  if (at < 0) throw new Error('probe cannot find function ' + n + ' - has it been renamed?');
  let d = 0;
  for (let j = SRC.indexOf('{', at); j < SRC.length; j++) {
    if (SRC[j] === '{') d++; else if (SRC[j] === '}') { d--; if (!d) return SRC.slice(at, j + 1); }
  }
  throw new Error('probe cannot read the body of ' + n);
}
const liftConst = re => {
  const m = SRC.match(re);
  if (!m) throw new Error('probe cannot find ' + re);
  return m[0];
};

const MARK = 7;
const SEL = '(GROW_ID === null || GROW_T >= 1 || extra.mark !== GROW_ID) ? 1';
const GATE = 'if (s > gcut) keep[i] = 0;';
const CHILD = ': extra.at == null ? GROW_T';

// lineGeom and the four things it reaches. LIFTED, not restated: a probe carrying its own copy of
// the width and taper arithmetic would agree with itself while the renderer moved. mix is a
// FUNCTION and gaussOf a one-liner - a `const mix = ` regex matches a LOCAL twelve thousand lines
// away in a colour helper, and a greedy gaussOf swallows the real mix with it.
function build(ablate) {
  let geom = lift('lineGeom');
  const must = (a, b) => {
    if (!geom.includes(a)) throw new Error('probe is stale: lineGeom no longer contains ' + a);
    geom = geom.replace(a, b);
  };
  if (ablate === 'ungrown-cuts-everything') must(SEL, SEL.replace('? 1', '? 0'));
  if (ablate === 'cut-just-under') must(GATE, 'if (s > gcut * 0.99) keep[i] = 0;');
  if (ablate === 'any-mark-grows') must(SEL, '(GROW_ID === null || GROW_T >= 1) ? 1');
  if (ablate === 'ignore-at') must(CHILD, ': true ? GROW_T');   // every line takes GROW_T, `at` unread
  if (ablate === 'no-gate') must(GATE, '');
  const body = [
    'const H = 0.625;',
    'let GROW_ID = null, GROW_T = 1;',
    liftConst(/const GROW_WIN = [^\n]*/),
    lift('mix'),
    lift('mulberry32'),
    liftConst(/const gaussOf = [^\n]*/),
    liftConst(/const sub = [^\n]*/),
    lift('smooth1d'),
    liftConst(/const inside = [^\n]*/),
    geom,
    'return { lineGeom, GROW_WIN, setGrow: (id, t) => { GROW_ID = id; GROW_T = t; } };',
  ].join('\n');
  return new Function(body)();
}

// A path that ENDS INSIDE THE SLAB on purpose, so `tE` tapers it: that is the case a truncated path
// gets wrong, and a line running off the edge would hide the defect.
const PTS = Array.from({ length: 61 }, (_, i) => [0.18 + 0.0095 * i, 0.26 + 0.055 * Math.sin(i / 7)]);
const F = { swing: 0.6, breaks: 0.25 };
const M = { breaks: 1 };
const main = x => ['L7', PTS, 0.004, F, M, 12345, 0, { mark: MARK, ...x }];

const A = build(null);
const REF = build('no-gate');
const whole = (() => { REF.setGrow(null, 1); return REF.lineGeom(...main()); })();
const run = (E, id, t, x) => { E.setGrow(id, t); return E.lineGeom(...main(x)); };
const drawn = L => Array.from(L.keep).filter(Boolean).length;

let bad = 0;
const rows = [];
function claim(title, ablation, fn) {
  const real = fn(A), abl = fn(build(ablation));
  const ok = real.n === 0, bites = abl.n > 0;
  if (!ok || !bites) bad++;
  rows.push('  ' + (ok ? (bites ? 'ok  ' : 'DECO') : 'FAIL') + '  ' + title.padEnd(48) +
    (ok ? 'clean of ' + real.of : real.n + ' of ' + real.of + ' BAD  ' + real.eg) +
    '   | ablated(' + ablation + '): ' + (bites ? abl.n + ' caught' : 'STILL CLEAN - the check cannot fail'));
}
const sameAsWhole = L => {
  let n = 0, of = 0, eg = '';
  for (let i = 0; i < whole.keep.length; i++) {
    of++;
    if (whole.keep[i] !== L.keep[i] || whole.w[i] !== L.w[i]) { n++; if (!eg) eg = 'seg ' + i; }
  }
  return { n, of, eg };
};

claim('not growing is the gate deleted, byte for byte', 'ungrown-cuts-everything',
  E => sameAsWhole(run(E, null, 1)));

claim('grow = 1 on the grown mark is a no-op too', 'cut-just-under',
  E => sameAsWhole(run(E, MARK, 1)));

claim('another mark is untouched while this one grows', 'any-mark-grows',
  E => sameAsWhole(run(E, MARK + 1, 0.4)));

// THE CLAIM WITH TEETH: the drawn part carries the FINISHED widths.
claim('a growing line keeps the finished line\'s shape', 'truncate-pts', E => {
  let got;
  if (E === A) got = run(E, MARK, 0.5);
  else {
    const cum = [0];
    for (let i = 1; i < PTS.length; i++) cum.push(cum[i - 1] + Math.hypot(PTS[i][0] - PTS[i - 1][0], PTS[i][1] - PTS[i - 1][1]));
    const k = cum.findIndex(c => c > cum[cum.length - 1] / 2);
    got = E.lineGeom('L7', PTS.slice(0, k), 0.004, F, M, 12345, 0, { mark: MARK });
  }
  let n = 0, of = 0, eg = '';
  for (let i = 0; i < got.w.length && i < whole.w.length; i++) {
    if (E === A && !got.keep[i]) continue;              // the undrawn tail is not part of the claim
    of++;
    if (Math.abs(got.w[i] - whole.w[i]) > 1e-12) {
      n++; if (!eg) eg = 'seg ' + i + ' w ' + got.w[i].toFixed(6) + ' vs finished ' + whole.w[i].toFixed(6);
    }
  }
  return { n, of, eg };
});

// A CHILD WAITS FOR THE PEN. At `at` = 0.5 it is absent at 0.5, part-drawn inside the window, and
// whole once the pen is GROW_WIN past it. The ablation is the version that ignored `extra.at`.
claim('a child waits for the pen to reach it', 'ignore-at', E => {
  const at = 0.5, W = E.GROW_WIN;
  const cases = [
    ['before',  0.30, g => g === 0],
    ['at it',   0.50, g => g === 0],
    ['inside',  at + W / 2, g => g > 0 && g < drawn(whole)],
    ['past it', at + W + 0.01, g => g === drawn(whole)],
    ['done',    1.00, g => g === drawn(whole)],
  ];
  let n = 0, of = 0, eg = '';
  for (const [name, t, want] of cases) {
    of++;
    const g = drawn(run(E, MARK, t, { at, parent: 'L7', taperStart: false }));
    if (!want(g)) { n++; if (!eg) eg = name + ' @ grow ' + t.toFixed(2) + ' drew ' + g + ' of ' + drawn(whole); }
  }
  return { n, of, eg };
});

// and the gate has to actually drop something, or the shape claim compares nothing
{
  const half = drawn(run(A, MARK, 0.5)), full = drawn(whole);
  const ok = half > 0 && half < full;
  if (!ok) bad++;
  rows.push('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + 'grow 0.5 draws some of the line, not all'.padEnd(48) +
    half + ' of ' + full + ' segments kept   | none or all would make the shape claim vacuous');
}

console.log('A LINE STILL BEING DRAWN - the growth gate\n');
console.log(rows.join('\n'));
console.log('\n' + (bad ? bad + ' PROBLEM(S)' : 'all claims hold, and every ablation broke them'));
process.exit(bad ? 1 : 0);

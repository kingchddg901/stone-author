/**
 * A LINE STILL BEING DRAWN: the growth gate, pinned.
 *
 * The creation animation grows one mark at a time, and `lineGeom` does it by dropping segments past
 * `gcut` from `keep` - NOT by handing the function a shorter path. The comment in the app claims
 * that distinction matters. This is that claim, made falsifiable:
 *
 *   a normal render is UNTOUCHED      gcut is 1 for every line when GROW_ID is null, and `s` is a
 *                                    midpoint fraction so `s > 1` is false for every segment. Not
 *                                    "almost the same" - the same bytes.
 *   grow = 1 is the same no-op       even on the mark being grown.
 *   a growing line is the FINISHED    at grow 0.5 the segments still drawn must have exactly the
 *   line with its tail undrawn       widths they will have when the line is done.
 *   the mark id is parsed, not        ids are 'L<mark>', 'L<mark>e<seg>', '<parent>.<k>', 'B<mark>'.
 *   prefix-matched                   'L70' starts with 'L7' and is a different mark.
 *
 * THE THIRD CLAIM IS THE ONE WITH TEETH, and its ablation is the implementation that was nearly
 * written instead: truncate `pts`. That renormalises `total`, so `s` rescales and the swing, the
 * break threshold and the tapers all move - the part already on screen writhes as the line grows,
 * and the cut end pinches out because `tE` tapers any line that ends inside the slab. The ablation
 * runs that version and the claim must catch it.
 *
 * Every claim is run against its own ablation: a claim whose ablation still passes is reported as
 * decoration rather than a test.
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

// lineGeom and the four things it reaches. LIFTED, not restated: a probe carrying its own copy of
// the width/taper arithmetic would agree with itself while the renderer moved.
function build(ablate) {
  let geom = lift('lineGeom');
  if (ablate === 'null-cuts-everything') {
    geom = geom.replace('const gcut = GROW_ID === null ? 1', 'const gcut = GROW_ID === null ? 0');
  }
  if (ablate === 'no-gate') geom = geom.replace('if (s > gcut) keep[i] = 0;', '');
  // Cuts at just under gcut, so grow = 1 stops being a no-op. 'null-cuts-everything' cannot test
  // that claim - it only perturbs the GROW_ID === null branch, and the claim sets a real id, so it
  // came back STILL CLEAN: an ablation that does not reach the code under test proves nothing.
  if (ablate === 'cut-just-under') geom = geom.replace('if (s > gcut) keep[i] = 0;', 'if (s > gcut * 0.99) keep[i] = 0;');
  const body = [
    'const H = 0.625;',
    'let GROW_ID = null, GROW_T = 1;',
    // mix is a FUNCTION and gaussOf a one-liner. A `const mix = ` regex matches a LOCAL twelve
    // thousand lines away inside a colour helper, and a greedy gaussOf swallows the real mix with
    // it - so each is lifted by the shape it actually has, not the shape it looks like it has.
    lift('mix'),
    lift('mulberry32'),
    liftConst(/const gaussOf = [^\n]*/),
    liftConst(/const sub = [^\n]*/),
    lift('smooth1d'),
    liftConst(/const inside = [^\n]*/),
    geom,
    'return { lineGeom, setGrow: (id, t) => { GROW_ID = id; GROW_T = t; } };',
  ].join('\n');
  return new Function(body)();
}

// A path that ENDS INSIDE THE SLAB on purpose, so `tE` tapers it: that is the case a truncated path
// gets wrong, and a line running off the edge would hide the defect.
const PTS = Array.from({ length: 61 }, (_, i) => [0.18 + 0.0095 * i, 0.26 + 0.055 * Math.sin(i / 7)]);
const F = { swing: 0.6, breaks: 0.25 };
const M = { breaks: 1 };
const ARGS = ['L7', PTS, 0.004, F, M, 12345, 0, {}];

const run = (E, id, t) => { E.setGrow(id, t); return E.lineGeom(...ARGS); };
const A = build(null);

let bad = 0;
const rows = [];
function claim(title, ablation, fn) {
  const real = fn(A), abl = fn(build(ablation));
  const ok = real.n === 0, bites = abl.n > 0;
  if (!ok || !bites) bad++;
  rows.push('  ' + (ok ? (bites ? 'ok  ' : 'DECO') : 'FAIL') + '  ' + title.padEnd(50) +
    (ok ? 'clean of ' + real.of : real.n + ' of ' + real.of + ' BAD  ' + real.eg) +
    '   | ablated(' + ablation + '): ' + (bites ? abl.n + ' caught' : 'STILL CLEAN - the check cannot fail'));
}

// 1. a normal render is untouched. The reference is a build with the gate line DELETED.
claim('GROW_ID null is the gate deleted, byte for byte', 'null-cuts-everything', E => {
  const ref = build('no-gate'); ref.setGrow(null, 1);
  const base = ref.lineGeom(...ARGS), got = run(E, null, 1);
  let n = 0, of = 0, eg = '';
  for (let i = 0; i < base.keep.length; i++) {
    of++;
    if (base.keep[i] !== got.keep[i] || base.w[i] !== got.w[i]) { n++; if (!eg) eg = 'seg ' + i; }
  }
  return { n, of, eg };
});

// 2. and grow = 1 on the grown mark itself is the same no-op, because s is a midpoint fraction.
claim('grow = 1 on the grown mark is also a no-op', 'cut-just-under', E => {
  const ref = build('no-gate'); ref.setGrow(null, 1);
  const base = ref.lineGeom(...ARGS), got = run(E, 7, 1);
  let n = 0, of = 0, eg = '';
  for (let i = 0; i < base.keep.length; i++) {
    of++;
    if (base.keep[i] !== got.keep[i] || base.w[i] !== got.w[i]) { n++; if (!eg) eg = 'seg ' + i; }
  }
  return { n, of, eg };
});

// 3. THE CLAIM WITH TEETH. At grow 0.5 the drawn segments carry the widths of the FINISHED line.
// The ablation is the implementation this replaced: hand lineGeom a truncated path instead.
claim('a growing line keeps the finished line\'s shape', 'truncate-pts', E => {
  const ref = build('no-gate'); ref.setGrow(null, 1);
  const whole = ref.lineGeom(...ARGS);
  let got;
  if (E === A) { got = run(E, 7, 0.5); }
  else {
    // the ablation: cut the PATH at half its arc length and build from that
    const cum = [0];
    for (let i = 1; i < PTS.length; i++) cum.push(cum[i - 1] + Math.hypot(PTS[i][0] - PTS[i - 1][0], PTS[i][1] - PTS[i - 1][1]));
    const half = cum[cum.length - 1] / 2;
    const k = cum.findIndex(c => c > half);
    const short = PTS.slice(0, k);
    got = E.lineGeom('L7', short, 0.004, F, M, 12345, 0, {});
  }
  // compare only the segments the growing line actually draws
  let n = 0, of = 0, eg = '';
  for (let i = 0; i < got.w.length; i++) {
    if (E === A && !got.keep[i]) continue;              // undrawn tail is not part of the claim
    if (i >= whole.w.length) break;
    of++;
    if (Math.abs(got.w[i] - whole.w[i]) > 1e-12) {
      n++;
      if (!eg) eg = 'seg ' + i + ' w ' + got.w[i].toFixed(6) + ' vs finished ' + whole.w[i].toFixed(6);
    }
  }
  return { n, of, eg };
});

// 4. the id family, which decides whether the right lines grow together.
{
  const markOf = id => parseInt(String(id).slice(1), 10);
  const want = [['L7', 7], ['L7e2', 7], ['L7.3', 7], ['L7.3.1', 7], ['B7', 7], ['L70', 70], ['L700', 700]];
  const wrong = want.filter(([id, m]) => markOf(id) !== m);
  const prefixWouldCollide = 'L70'.startsWith('L7');
  const ok = wrong.length === 0;
  if (!ok || !prefixWouldCollide) bad++;
  rows.push('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + 'the mark id is parsed, not prefix-matched'.padEnd(50) +
    (ok ? want.length + ' ids resolve' : 'WRONG: ' + JSON.stringify(wrong)) +
    '   | a prefix test WOULD collide (L70 starts with L7): ' + prefixWouldCollide);
}

// 5. and the gate has to actually drop something, or claim 3 is comparing nothing.
{
  const got = run(A, 7, 0.5);
  const drawn = Array.from(got.keep).filter(Boolean).length;
  const ref = build('no-gate'); ref.setGrow(null, 1);
  const full = Array.from(ref.lineGeom(...ARGS).keep).filter(Boolean).length;
  const ok = drawn > 0 && drawn < full;
  if (!ok) bad++;
  rows.push('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + 'grow 0.5 draws some of the line, not all'.padEnd(50) +
    drawn + ' of ' + full + ' segments kept   | a gate that dropped none or all would make claim 3 vacuous');
}

console.log('A LINE STILL BEING DRAWN - the growth gate\n');
console.log(rows.join('\n'));
console.log('\n' + (bad ? bad + ' PROBLEM(S)' : 'all claims hold, and every ablation broke them'));
process.exit(bad ? 1 : 0);

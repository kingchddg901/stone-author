// THE PROBE MUST BE ABLE TO GIVE UP.
//
// canvasFits answers "can this device paint a surface this big" by allocating one and reading it back.
// It holds EXP_PEAK of them at once. TWO SEPARATE DEFECTS came out of that, on two devices, and they
// are not the same problem - an earlier version of this file said they were, and it was wrong.
//
// ONE: TOO SLOW TO BE AN ANSWER.  A Gecko phone preparing the 8192 candidate at a 24576 RENDER WIDTH
// locked the page - no error, no timeout, nothing in any log. It is not a memory problem: that
// candidate needs about 770 MB against a 1.5 GB cap, so it is affordable and simply slow. It is also
// not one size being too big, because both quantities that size the surface scale with the render
// width rather than the tile - bs is W/COAT_REF, the blur is 3*bs, the bleed is coatReach(bs) - so any
// hard-coded ceiling would be walked past by a large enough render. The fix is a TIME budget, checked
// between surfaces. It cannot interrupt one synchronous allocation, but with EXP_PEAK at 2 it can
// decline to do it twice.
//
// TWO: TOO BIG TO SURVIVE.  The A7 Lite reached for an 8196 canvas - the 8192 candidate at a bleed of
// 2, so a SMALL render width, nothing like 24576 - and was killed by Android. 537 MB of test against
// its 537 MB budget, on a tablet with about a gigabyte free. Nothing was slow; it was fatal. The
// arithmetic that refuses it already existed in the shortlist twenty lines below, and ran AFTER the
// allocation that crashed. The fix is to check the TEST's own cost before allocating anything.
//
// Time does not catch the A7 and size does not catch the phone. Both guards, both gated here.
//
// THREE CALL SITES DELIBERATELY HAVE NO BUDGET, and this gate does not ask them to:
//   sideCap()          1 x N canvases, measured at 2 ms in Blink and 9 ms in Gecko
//   the band loop      halves until a pixel holds; a timeout would pick a smaller band on slow devices
//   the forced probe   "neither gate may refuse it" - a timeout would misreport a slow bloom as lost
//
//   node tools/check-probe-budget.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = 'app/stone-author.html';
const NL = String.fromCharCode(10);

// The two ladders. Each climbs candidate sizes toward whatever this device cannot do, which is the
// shape that stalls; both must hand canvasFits a budget.
const LADDERS = [
  { what: 'exportCeiling, the export width ladder', find: 'what the EXPORT needs, not one canvas' },
  { what: 'the tile probe, the candidate ladder', find: 'pass.push(ts)' },
];

// The size guard, which must sit BEFORE the allocation in the probe loop.
const SIZE_GUARD = 'side * side * 4 * EXP_PEAK > probeCap';
// Written out once, with no escapes, because seven separate escapes were lost through generators in
// the session that produced this file. A literal newline in an ablation is how the last one went.
const GUARD_LINE = 'if (side * side * 4 * EXP_PEAK > probeCap) { tooBig.push(ts); continue; }';
const FITS_LINE = 'if (canvasFits(side, side, EXP_PEAK, sigma, FITS_MS)) pass.push(ts);';

function body(src, from) {
  // The text of one function, brace-matched from its opening brace.
  const open = src.indexOf('{', from);
  let d = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return src.slice(open, i + 1); }
  }
  return '';
}

function check(src) {
  const fail = [];

  const defAt = src.indexOf('function canvasFits(');
  if (defAt < 0) { fail.push('canvasFits is not declared'); return fail; }
  const sig = src.slice(defAt, src.indexOf(')', defAt) + 1);
  if (!sig.includes('budgetMs')) fail.push('canvasFits does not take a budget: ' + sig.trim());

  const fn = body(src, defAt);
  // It has to CONSULT the budget, not merely accept it, and between surfaces rather than once at the
  // top - a single check at entry would pass this gate and stall exactly as before.
  const consults = fn.split('spent()').length - 1;
  if (consults < 3) fail.push('canvasFits consults its budget ' + consults + ' time(s); it must do so between surfaces, not once');
  if (!fn.includes('held.push')) fail.push('canvasFits no longer holds its canvases; the budget guards the wrong thing');

  if (src.indexOf('const FITS_MS') < 0) fail.push('FITS_MS is not defined');

  // The size guard, and the ORDER of it. Refusing after the allocation is what the A7 already did.
  const guardAt = src.indexOf(SIZE_GUARD);
  if (guardAt < 0) fail.push('the probe does not check the test size before allocating');
  else {
    const fitsAt = src.indexOf('canvasFits(side, side');
    if (fitsAt >= 0 && guardAt > fitsAt)
      fail.push('the size guard runs AFTER canvasFits; that is the defect, not the fix');
  }

  for (const L of LADDERS) {
    const at = src.indexOf(L.find);
    if (at < 0) { fail.push('cannot find ' + L.what); continue; }
    // The call is on the same line as the marker.
    const lineStart = src.lastIndexOf(NL, at) + 1;
    const lineEnd = src.indexOf(NL, at);
    const line = src.slice(lineStart, lineEnd < 0 ? src.length : lineEnd);
    if (!line.includes('canvasFits(')) { fail.push(L.what + ': no canvasFits call on that line'); continue; }
    if (!line.includes('FITS_MS')) fail.push(L.what + ' calls canvasFits WITHOUT a budget:' + NL + '      ' + line.trim());
  }
  return fail;
}

const src = readFileSync(join(root, APP), 'utf8');
const live = check(src);

console.log('probe time budget');
if (live.length) for (const f of live) console.log('  FAIL  ' + f);
else console.log('  ok    canvasFits takes a budget, consults it between surfaces, and both ladders pass it');

// ABLATIONS. A gate that has never been red is a preference. Each of these is the real defect, put back.
const ABLATIONS = [
  ['the tile probe drops its budget',
    s => s.replace('canvasFits(side, side, EXP_PEAK, sigma, FITS_MS)', 'canvasFits(side, side, EXP_PEAK, sigma)')],
  ['exportCeiling drops its budget',
    s => s.replace('canvasFits(w, Math.round(w * H), EXP_PEAK, 0, FITS_MS)', 'canvasFits(w, Math.round(w * H), EXP_PEAK)')],
  ['canvasFits stops taking a budget',
    s => s.replace('function canvasFits(w, h, n, sigma, budgetMs) {', 'function canvasFits(w, h, n, sigma) {')],
  ['the budget is accepted but never consulted',
    s => s.split('if (spent()) return false;').join('if (false) return false;')],
  ['only the first surface is checked, not between them',
    s => { let n = 0; return s.split('if (spent()) return false;').map((p, i, a) => i < a.length - 1 && ++n > 1 ? p + 'if (false) return false;' : p + (i < a.length - 1 ? 'if (spent()) return false;' : '')).join(''); }],
  ['FITS_MS is removed',
    s => s.replace('const FITS_MS = 1500;', 'const NOT_FITS_MS = 1500;')],
  ['the size guard is dropped',
    s => s.split(GUARD_LINE).join('')],
  ['the size guard runs after the allocation instead of before',
    s => s.split(GUARD_LINE).join('').split(FITS_LINE).join(FITS_LINE + NL + '          ' + GUARD_LINE)],
];

let bit = 0;
console.log('');
for (const [name, mangle] of ABLATIONS) {
  const broken = mangle(src);
  if (broken === src) { console.log('  FAIL  ablation did not change the source: ' + name); continue; }
  const got = check(broken);
  if (got.length) { bit++; console.log('  ok    caught: ' + name); }
  else console.log('  FAIL  NOT CAUGHT: ' + name);
}

console.log('');
const ok = live.length === 0 && bit === ABLATIONS.length;
console.log(bit + ' of ' + ABLATIONS.length + ' ablations bite' + (live.length ? '   AND THE LIVE SOURCE FAILS' : ''));
process.exit(ok ? 0 : 1);

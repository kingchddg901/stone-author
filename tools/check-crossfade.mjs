// THE CROSSFADE, RUN AGAINST THE SHIPPED SOURCE.
//
// The claim is exact and easy to get wrong in a way nothing would notice: with stops at -1, 0 and +1, a
// crossfade from -1 to +1 must NOT consult the stop at 0. Sweeping the spectrum walks the number line, so
// 0 sits in the path and interrupts. The crossfade asks each artifact what it looks like AT each end and
// mixes those two answers, so the middle stop is never evaluated.
//
// "Never evaluated" is not observable from a rendered picture without pixel-peeping a browser, and the
// difference is one colour channel. So this lifts mixHexAt, emitAt and emitCross OUT of the app by their
// own source text and runs them in Node. It is the shipped code, not a copy of it: change the function in
// the app and this runs the changed one.
//
//   node tools/check-crossfade.mjs
import { readFileSync } from 'fs';

const NEWLINE = String.fromCharCode(10);
const app = readFileSync('app/stone-author.html', 'utf8');

// Pull a declaration out by matching braces, with strings and comments respected well enough for these.
function lift(startsWith) {
  const at = app.indexOf(startsWith);
  if (at < 0) { console.error('could not find: ' + startsWith); process.exit(2); }
  let i = app.indexOf('{', at), depth = 0, inStr = 0;
  for (; i < app.length; i++) {
    const c = app[i];
    if (inStr) { if (c === String.fromCharCode(92)) i++; else if (c === inStr) inStr = 0; continue; }
    if (c === "'" || c === '"' || c === '`') inStr = c;
    else if (c === '/' && app[i + 1] === '/') { i = app.indexOf(NEWLINE, i); continue; }
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return app.slice(at, i + 1); }
  }
  console.error('unterminated: ' + startsWith);
  process.exit(2);
}

const line = needle => {
  const at = app.indexOf(needle);
  if (at < 0) { console.error('could not find: ' + needle); process.exit(2); }
  return app.slice(at, app.indexOf(NEWLINE, at));
};

const SPX_TOL = Number(line('SPX_TOL = ').split('SPX_TOL = ')[1].split(';')[0].split(',')[0]);
const UV_DARK = line("UV_DARK = '").split("UV_DARK = '")[1].split("'")[0];

const src = [
  line('const rgbHex = '),
  lift('function hexRGB('),
  lift('const mixHexAt = '),
  lift('const emitAt = '),
  lift('const emitCross = '),
  'return { mixHexAt, emitAt, emitCross };',
].join(NEWLINE);
const { mixHexAt, emitAt, emitCross } = new Function('SPX_TOL', 'UV_DARK', src)(SPX_TOL, UV_DARK);

const RED = '#ff0000', GREEN = '#00ff00', BLUE = '#0000ff';
const three = [{ v: -1, c: RED }, { v: 0, c: GREEN }, { v: 1, c: BLUE }];
const onlyLow = [{ v: -1, c: RED }];
const onlyMid = [{ v: 0.5, c: '#ffffff' }];
const onlyHigh = [{ v: 1, c: BLUE }];
const g = hex => parseInt(hex.slice(3, 5), 16);

const cases = [
  ['sweep sits exactly on a stop', () => emitAt(three, -1), RED],
  ['sweep at 0 is the middle stop', () => emitAt(three, 0), GREEN],
  ['SWEEP between -1 and 0 MIXES IN THE MIDDLE STOP', () => emitAt(three, -0.5), '#808000'],
  ['...and that mix carries green, which is the interruption', () => g(emitAt(three, -0.5)) > 100, true],
  ['crossfade at t=0 is exactly the first stop', () => emitCross(three, -1, 1, 0), RED],
  ['crossfade at t=1 is exactly the second', () => emitCross(three, -1, 1, 1), BLUE],
  ['CROSSFADE -1 -> +1 AT THE MIDPOINT IS RED/BLUE', () => emitCross(three, -1, 1, 0.5), '#800080'],
  ['...and carries NO green, so the stop at 0 was never consulted', () => g(emitCross(three, -1, 1, 0.5)), 0],
  ['a stop the move passes is ignored at every t', () => [0.25, 0.5, 0.75].every(t => g(emitCross(three, -1, 1, t)) === 0), true],
  ['lit at one end only: fades out to the dark', () => emitCross(onlyLow, -1, 1, 1), UV_DARK],
  ['lit at one end only: full colour at that end', () => emitCross(onlyLow, -1, 1, 0), RED],
  ['lit at the OTHER end only: fades in from the dark', () => emitCross(onlyHigh, -1, 1, 0), UV_DARK],
  ['lit at the OTHER end only: full colour there', () => emitCross(onlyHigh, -1, 1, 1), BLUE],
  ['lit at neither end stays unlit', () => emitCross(onlyMid, -1, 1, 0.5), null],
  ['the ends are resolved by the ORDINARY rule, blending and all', () => {
    const pair = [{ v: -1, c: RED }, { v: -0.9, c: BLUE }];
    return emitCross(pair, -0.95, 1, 0) === emitAt(pair, -0.95);
  }, true],
  ['...which is a blend here, not a stop', () => emitAt([{ v: -1, c: RED }, { v: -0.9, c: BLUE }], -0.95) !== RED, true],
];

let bad = 0;
console.log('stops: red@-1  green@0  blue@+1     SPX_TOL ' + SPX_TOL + '   UV_DARK ' + UV_DARK);
for (const [label, fn, want] of cases) {
  let got;
  try { got = fn(); } catch (e) { got = 'threw: ' + e.message; }
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label + (ok ? '' : '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)));
}
console.log(bad === 0 ? NEWLINE + 'the crossfade never evaluates the light between its two ends' : NEWLINE + bad + ' of ' + cases.length + ' wrong');
process.exit(bad === 0 ? 0 : 1);

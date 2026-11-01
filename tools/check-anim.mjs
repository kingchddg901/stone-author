/**
 * A TIMELINE IS A FUNCTION OF THE FRAME INDEX AND NOTHING ELSE.
 *
 * That property is the whole reason a film can be trusted: re-render frame i and you get frame i.
 * It is what made a lost frame recoverable to the exact pixel when the creation film was made by
 * hand - frame 581 was mark 19 at growth 0.4, and re-rendering it took one try. A timeline that
 * carried a counter, a clock or a cached "last value" would still produce a film; it would just
 * produce a DIFFERENT one on the second run, and nothing downstream could tell.
 *
 * So this lifts animAt out of the app and holds it to:
 *
 *   pure          the same (i, N) gives the same answer, always, in any order
 *   endpoints     frame 0 is `from` and the last frame is `to`, exactly
 *   in range      no frame ever leaves [from, to], whichever way the ramp runs
 *   staggered     with the toggle on, each track owns its own span and is still at `from`
 *                 before its span opens and at `to` after it closes
 *
 * AND THAT THE FILM IS NOT SAVED INTO THE SLAB. A slab is a picture, not a film; one that carried
 * a timeline would reopen mid-ramp. Asserted against serialize() rather than trusted.
 *
 *   node tools/check-anim.mjs
 *   node tools/check-anim.mjs --ablate
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'app', 'stone-author.html'), 'utf8');
const ABLATE = process.argv.includes('--ablate');

function lift(n) {
  const at = SRC.indexOf('function ' + n + '(');
  if (at < 0) throw new Error('probe cannot find ' + n + ' - has it been renamed?');
  let d = 0;
  for (let j = SRC.indexOf('{', at); j < SRC.length; j++) {
    if (SRC[j] === '{') d++; else if (SRC[j] === '}') { d--; if (!d) return SRC.slice(at, j + 1); }
  }
  throw new Error('probe cannot read the body of ' + n);
}

const CLAMP = 'p = Math.max(0, Math.min(1, (u - a) / (b - a)));';
function build(ablate) {
  let fn = lift('animAt');
  if (ablate === 'no-clamp') {
    if (!fn.includes(CLAMP)) throw new Error('probe is stale: the stagger clamp moved');
    fn = fn.replace(CLAMP, 'p = (u - a) / (b - a);');
  }
  if (ablate === 'one-span') fn = fn.replace('const a = k / n, b = (k + 1) / n;', 'const a = 0, b = 1;');
  return new Function('ANIM', fn + '; return animAt;');
}

let bad = 0, ablatedBit = false;
const rows = [];
const claim = (ok, targeted, title, detail) => {
  if (!ok && !(ABLATE && targeted)) bad++;
  if (ABLATE && targeted && !ok) ablatedBit = true;
  const tag = !ok ? (ABLATE && targeted ? 'red ' : 'FAIL') : (ABLATE && !targeted ? 'n/a ' : 'ok  ');
  rows.push('  ' + tag + '  ' + title.padEnd(48) + detail);
};

const TRACKS = [
  { key: 'subsurface', from: 0, to: 2 },
  { key: 'specular', from: 1, to: 0 },                 // deliberately DOWNWARD: a clamp that only
];                                                     // guards the upward case passes without it
const N = 120;
const mk = (ablate, stagger) => build(ablate)({ tracks: TRACKS, stagger });

// ---- 1. pure --------------------------------------------------------------------------------
{
  const at = mk(null, true);
  const order = [0, 61, 7, 119, 61, 0, 119, 7];
  const seen = new Map();
  let n = 0, eg = '';
  for (const i of order) {
    const v = JSON.stringify(at(i, N));
    if (seen.has(i) && seen.get(i) !== v) { n++; if (!eg) eg = 'frame ' + i + ' answered twice, differently'; }
    seen.set(i, v);
  }
  claim(n === 0, false, 'the same frame always answers the same',
        n ? eg : order.length + ' calls out of order, ' + seen.size + ' distinct frames, no drift');
}

// ---- 2. endpoints, both directions ----------------------------------------------------------
{
  const at = mk(null, false);
  const a = at(0, N), b = at(N - 1, N);
  const ok = a[0].value === 0 && a[1].value === 1 && b[0].value === 2 && b[1].value === 0;
  claim(ok, false, 'frame 0 is `from`, the last frame is `to`',
        'first ' + JSON.stringify(a.map(x => x.value)) + '  last ' + JSON.stringify(b.map(x => x.value)));
}

// ---- 3. THE CLAIM WITH TEETH: nothing ever leaves its range ----------------------------------
claim((() => {
  const at = mk(ABLATE ? 'no-clamp' : null, true);
  let bad2 = 0, eg = '';
  for (let i = 0; i < N; i++) {
    for (const v of at(i, N)) {
      const t = TRACKS.find(x => x.key === v.key);
      const lo = Math.min(t.from, t.to) - 1e-9, hi = Math.max(t.from, t.to) + 1e-9;
      if (v.value < lo || v.value > hi) {
        bad2++;
        if (!eg) eg = v.key + ' reached ' + v.value.toFixed(3) + ' outside [' + t.from + ',' + t.to + ']';
      }
    }
  }
  rows.__range = bad2 ? eg : 'all ' + (N * TRACKS.length) + ' values inside their ranges';
  return bad2 === 0;
})(), true, 'no frame leaves its track\'s range', rows.__range);

// ---- 4. staggered tracks wait their turn ------------------------------------------------------
{
  const at = mk(ABLATE ? 'one-span' : null, true);
  // two tracks: track 1 owns the second half, so before halfway it must still be at `from`
  const early = at(10, N)[1].value, late = at(N - 1, N)[1].value, mid = at(N - 1, N)[0].value;
  const ok = early === TRACKS[1].from && late === TRACKS[1].to && mid === TRACKS[0].to;
  claim(ok, ABLATE, 'a staggered track waits for its span',
        'track 2 at frame 10 = ' + early + ' (wants ' + TRACKS[1].from + '), at the end = ' + late +
        '; track 1 finished = ' + mid);
}

// ---- 5. the film is not saved into the slab ---------------------------------------------------
{
  const i = SRC.indexOf('function serialize(');
  const body = i < 0 ? '' : SRC.slice(i, i + 4000);
  const leaks = /\bANIM\b/.test(body);
  claim(i >= 0 && !leaks, false, 'a slab carries no timeline',
        i < 0 ? 'serialize() not found' : (leaks ? 'serialize() mentions ANIM' : 'serialize() is clean of ANIM'));
}

console.log('A TIMELINE IS A FUNCTION OF THE FRAME INDEX' + (ABLATE ? '  [ABLATED]' : '') + '\n');
console.log(rows.join('\n'));
if (ABLATE) {
  console.log('\n' + (ablatedBit
    ? 'ablation held: the range claim went red, as it must. n/a = not targeted by this ablation'
    : 'ABLATION DID NOT BITE - an unclamped stagger is invisible to this gate') +
    (bad ? '  (and ' + bad + ' unrelated claim(s) are genuinely failing)' : ''));
  process.exit(ablatedBit && !bad ? 0 : 1);
}
console.log('\n' + (bad ? bad + ' PROBLEM(S)' : 'anim: OK - the timeline is pure and stays in range'));
process.exit(bad ? 1 : 0);

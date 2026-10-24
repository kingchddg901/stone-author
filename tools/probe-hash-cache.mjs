// THE CORNER CACHE RETURNS THE SAME NOISE, NOT A CHEAPER ONE.
//
// vnoiseC keeps the four lattice-corner hashes of the last cell it saw, per slot, and reuses them
// when the next call lands in that same cell. nz is a pure function of three integers, so this is
// exact rather than approximate - but "exact by construction" is a claim about code that can be
// edited, and this is what holds it. Every assertion below is bitwise equality against the
// uncached pair, over a walk that makes the cache both hit and miss.
//
// WHY A HIT RATE IS ASSERTED AND NOT MERELY REPORTED. A test that only ever misses passes without
// exercising the thing it is testing: every call would fall through to nz and of course agree. So
// the walk is checked for a floor on its hit rate first, and the equality claim is only meaningful
// above it. This is the same trap probe-glass-gradient.mjs hit by comparing the shipped function
// against its own reference instead of against glassFormT.
//
//   node tools/probe-hash-cache.mjs              prove it
//   node tools/probe-hash-cache.mjs --ablate     prove it can go red
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

// THE DECLARATION IS LIFTED TOO, not re-written here. Its SIZE and its NaN fill are both load
// bearing - a zero fill would let slot 0 answer for seed 0 at cell (0,0) - so a probe that declared
// its own array would prove nothing about the one that ships.
const DECL = (SRC.match(/const _NZC = new Float64Array\([^;]*\);/) || [])[0];
if (!DECL) { console.error('probe-hash-cache: FAIL - no _NZC declaration found in the app'); process.exit(1); }

const ablate = process.argv.includes('--ablate');

function build(mutate) {
  let decl = DECL, fns = ['nz', 'vnoise', 'fbm2', 'vnoiseC', 'vnoiseCfill', 'fbm2C'].map(liftFn).join('\n');
  if (mutate) ({ decl, fns } = mutate(decl, fns));
  return new Function(decl + '\n' + fns + '\nreturn { nz, vnoise, fbm2, vnoiseC, vnoiseCfill, fbm2C, peek: () => _NZC };')();
}

// ---- the walk --------------------------------------------------------------------------------
// A scanline inside one cell, then a jump across several, then an interleave of two seeds through
// the same slots. The interleave is the part that matters: it is how a false hit would show up,
// because two different call sites sharing a slot must MISS on each other rather than answer.
function* walk() {
  for (let row = 0; row < 24; row++) {
    const y = row * 0.013 + 0.0007;
    for (let i = 0; i < 400; i++) yield [i * 0.004 + 0.0003, y];      // dense: mostly hits
    for (let i = 0; i < 40; i++) yield [i * 3.7 + 0.11, y + i * 2.3]; // sparse: mostly misses
  }
}

let fails = 0;
const claim = (ok, what, detail) => {
  if (!ok) fails++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + what + (detail ? '   ' + detail : ''));
};

// THE TWO SHAPES THE WALK CANNOT REACH, because the walk mirrors how the app calls this and the app
// gives every slot exactly one seed. Both guards in vnoiseC are therefore dead weight against
// CURRENT usage and live defence against the next call site, and an ablation list run only against
// the walk reports them as untested - which is how this probe first read.
//
//   ONE SLOT, TWO SEEDS at the same cell. If the key drops the seed, the slot answers for whichever
//   site wrote it last. Nothing in the app does this today; a fourth site reusing a base would.
//   SEED 0 AT CELL (0,0) on a slot nothing has touched. A zero-filled array compares equal on all
//   three key fields there and serves four zeros. nz(0,0,0) really is 0, but its three neighbours
//   are not, so the interpolation differs and this is a wrong picture, not a slow one.
//
// These run FIRST on each freshly built module, because the second one needs a virgin slot.
function runAdversarial(APP) {
  const { vnoise, vnoiseC } = APP;
  let n = 0, bad = 0, worst = 0;
  const check = (want, got) => { n++; if (!Object.is(want, got)) { bad++; worst = Math.max(worst, Math.abs(want - got)); } };
  // virgin slot, seed 0, cell (0,0) - must be before anything else writes slot 10
  check(vnoise(0.5, 0.5, 0), vnoiseC(0.5, 0.5, 0, 10));
  check(vnoise(0.25, 0.75, 0), vnoiseC(0.25, 0.75, 0, 10));
  // one slot, two seeds, same cell, alternating
  for (let i = 0; i < 200; i++) {
    const x = 3.2 + (i % 7) * 0.01, y = 1.4 + (i % 5) * 0.01;
    for (const s of [71, 311, 71, 907]) check(vnoise(x, y, s), vnoiseC(x, y, s, 9));
  }
  return { n, bad, worst };
}

function run(APP, label) {
  const { fbm2, fbm2C, vnoise, vnoiseC } = APP;
  const adv = runAdversarial(APP);
  let n = adv.n, bad = adv.bad, worst = adv.worst, hits = 0, siteCalls = 0, prev = new Map();
  // the three slot bases the app actually uses, with the seeds it actually passes
  const SITES = [[71, 0], [11, 3], [311, 6]];
  for (const [x, y] of walk()) {
    for (const [s, k] of SITES) {
      // count a hit the way vnoiseC decides one: same cell as the previous call on that slot
      const xi = Math.floor(x), yi = Math.floor(y), key = s + ':' + xi + ':' + yi;
      if (prev.get(k) === key) hits++;
      prev.set(k, key);
      siteCalls++;
      const want = fbm2(x, y, s), got = fbm2C(x, y, s, k);
      n++;
      if (!Object.is(want, got)) { bad++; worst = Math.max(worst, Math.abs(want - got)); }
    }
    // and the single-octave pair, through a slot the sites do not use
    const w1 = vnoise(x, y, 907), g1 = vnoiseC(x, y, 907, 11);
    n++; if (!Object.is(w1, g1)) { bad++; worst = Math.max(worst, Math.abs(w1 - g1)); }
  }
  // the rate is over the WALK's own calls - the adversarial ones are built to miss, and folding
  // them in would understate how hard the walk is leaning on the cache
  return { n, bad, worst, adv: adv.n, hitPct: 100 * hits / siteCalls };
}

console.log('\nA  the cache is actually being exercised');
const APP = build(null);
const r = run(APP, 'shipped');
claim(r.hitPct > 60, 'the walk hits the cache on most calls',
  r.hitPct.toFixed(1) + '% of ' + r.n.toLocaleString() + ' calls — below this, equality proves nothing');

console.log('\nB  every value is bit-identical to the uncached pair');
claim(r.bad === 0, 'fbm2C === fbm2 and vnoiseC === vnoise, bitwise',
  r.n.toLocaleString() + ' calls (' + r.adv + ' of them adversarial), ' + r.bad + ' differing' + (r.bad ? ', worst ' + r.worst : ''));

console.log('\nC  the slots the app asks for fit the array it declares');
const slots = +(DECL.match(/Float64Array\((\d+)\s*\*\s*7\)/) || [])[1];
const bases = [...SRC.matchAll(/fbm2C\([^;]*?,\s*(\d+)\s*\)/g)].map(m => +m[1]);
const widest = bases.length ? Math.max(...bases) + 2 : -1;
claim(slots > 0 && widest >= 0 && widest < slots,
  'the highest slot an fbm2C call site reaches is inside the array',
  'bases ' + JSON.stringify(bases) + ' -> highest slot ' + widest + ', array holds ' + slots);
claim(/\.fill\(NaN\)/.test(DECL), 'the array is NaN-filled, so a fresh core starts with every slot missing', DECL);

// ---- ablations -------------------------------------------------------------------------------
// Three ways to break the cache, each of which MUST make section B red. Without these the equality
// above is consistent with a cache that is never consulted at all.
if (ablate) {
  console.log('\nD  ablations — each must go red');
  const ABL = [
    ['the key ignores the cell, so stale corners are served',
      (d, f) => ({ decl: d, fns: f.replace('if (_NZC[o] !== s || _NZC[o + 1] !== xi || _NZC[o + 2] !== yi)', 'if (_NZC[o] !== s)') })],
    ['the key ignores the seed, so one site answers for another',
      (d, f) => ({ decl: d, fns: f.replace('if (_NZC[o] !== s || _NZC[o + 1] !== xi || _NZC[o + 2] !== yi)', 'if (_NZC[o + 1] !== xi || _NZC[o + 2] !== yi)') })],
    ['the array is zero-filled, so slot 0 answers for seed 0 at cell (0,0)',
      (d, f) => ({ decl: d.replace('.fill(NaN)', ''), fns: f })],
    ['every call uses one slot, so the three sites evict each other and must still agree',
      (d, f) => ({ decl: d, fns: f.replace('const o = slot * 7;', 'const o = 0;') })],
  ];
  for (const [what, mut] of ABL) {
    let red = false, why = '';
    try { const g = run(build(mut), what); red = g.bad > 0; why = g.bad + ' differing of ' + g.n.toLocaleString(); }
    catch (e) { red = true; why = 'threw: ' + e.message; }
    // the last one is a CORRECTNESS-preserving ablation: sharing a slot only costs hits, so it
    // must stay GREEN. An ablation list where every entry goes red cannot tell those apart.
    const wantRed = !/must still agree/.test(what);
    claim(red === wantRed, (wantRed ? 'caught: ' : 'tolerated, as it should be: ') + what, why);
  }
}

console.log('');
if (fails) { console.error('probe-hash-cache: ' + fails + ' FAILED'); process.exit(1); }
console.log('probe-hash-cache: OK — the cache returns the same noise, and the walk proves it was used');

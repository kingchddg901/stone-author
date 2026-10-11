/**
 * Does the calibration actually reach the drawing code?
 *
 * It did not. calProfile was created, loaded, displayed, saved and cleared, and read by nothing:
 * pressure stayed on a fixed 0.15 + 1.7*p and tilt on fixed 9 and 25 degree thresholds past rest.
 * The calibration section's own opening comment is the specification it was failing to meet -
 * "every normalisation the channels need is a property of a HAND and a DEVICE, never a constant",
 * and, measured, "a real hand spends 90% of a stroke in the bottom TENTH of the pressure sensor".
 *
 * So the claim with teeth is not "the profile changes something". It is that a hand working in the
 * bottom tenth gets the FULL range over the tenth it actually uses, where the constant curve hands
 * it a thin slice and calls a normal stroke a faint one. Plus the other half: with no profile the
 * curve must be bit-for-bit what it was, or wiring this breaks every slab already on disk.
 *
 *   node tools/probe-pen-calibration.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', 'app', 'stone-author.html'), 'utf8');
function lift(name) {
  const at = SRC.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = SRC.indexOf('{', at); j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (depth === 0) return SRC.slice(at, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
const NEEDED = ['penPress', 'pressureReal', 'pressFactor', 'tiltReal', 'leanProfile'];
// Taken from the source, not retyped: the output range is the thing under test, and a probe that
// carried its own copy of it would agree with itself whatever the app did.
const RANGE = SRC.match(/^ *const PRESS_LO = .*$/m)[0];
const SMOOTH = SRC.match(/^ *const smoothstep = .*$/m)[0];
const api = new Function(
  'let calProfile = null;\n' + RANGE + '\n' + SMOOTH + '\n' +
  NEEDED.map(lift).join('\n') +
  '\nreturn {' + NEEDED.join(',') + ', setCal: p => { calProfile = p; },' +
  ' LO: PRESS_LO, HI: PRESS_HI};')();
const { penPress, leanProfile, setCal, LO, HI } = api;

let bad = 0;
const say = (ok, msg) => { if (!ok) bad++; console.log('  ' + (ok ? 'OK  ' : 'RED ') + msg); };

// ---- unchanged when off ---------------------------------------------------------------------------
setCal(null);
let worst = 0;
for (let i = 0; i <= 1000; i++) { const p = i / 1000; worst = Math.max(worst, Math.abs(penPress(p) - (LO + 1.7 * p))); }
console.log('PRESSURE');
say(worst === 0, `with no profile the curve is bit-for-bit the old one (worst difference ${worst})`);

// ---- a real hand, from the section's own note -------------------------------------------------------
const HAND = { press: { lo: 0.04, mid: 0.09, hi: 0.22 }, lean: { rest: 0.07, max: 0.35 } };
setCal(null);
const wasNatural = penPress(HAND.press.mid), wasLight = penPress(HAND.press.lo), wasHard = penPress(HAND.press.hi);
setCal(HAND);
const nowNatural = penPress(HAND.press.mid), nowLight = penPress(HAND.press.lo), nowHard = penPress(HAND.press.hi);
console.log(`  a hand living in the bottom tenth: light ${HAND.press.lo}, natural ${HAND.press.mid}, hard ${HAND.press.hi}`);
console.log(`    before   light ${wasLight.toFixed(3)}  natural ${wasNatural.toFixed(3)}  hard ${wasHard.toFixed(3)}` +
            `   (span ${(wasHard - wasLight).toFixed(3)} of ${(HI - LO).toFixed(2)})`);
console.log(`    after    light ${nowLight.toFixed(3)}  natural ${nowNatural.toFixed(3)}  hard ${nowHard.toFixed(3)}` +
            `   (span ${(nowHard - nowLight).toFixed(3)} of ${(HI - LO).toFixed(2)})`);
say(Math.abs(nowNatural - 1) < 1e-9,
    `a natural stroke comes out NEUTRAL (${nowNatural.toFixed(3)}), where it used to be ${wasNatural.toFixed(3)} - a normal stroke drawn faint`);
say(Math.abs(nowLight - LO) < 1e-9 && Math.abs(nowHard - HI) < 1e-9,
    'light and hard reach the ends of the range this hand was never getting near');
say((nowHard - nowLight) > (wasHard - wasLight) * 3,
    `it gets ${((nowHard - nowLight) / (wasHard - wasLight)).toFixed(1)}x the range it had`);

// ---- still sane ---------------------------------------------------------------------------------------
let mono = true, inRange = true, prev = -Infinity;
for (let i = 0; i <= 1000; i++) {
  const v = penPress(i / 1000);
  if (v < prev - 1e-12) mono = false;
  if (v < LO - 1e-9 || v > HI + 1e-9) inRange = false;
  prev = v;
}
say(mono, 'the remap never goes backwards: pressing harder never draws thinner');
say(inRange, `and never leaves ${LO}..${HI}, so the output range is still art direction and not the hand's`);

// ---- a profile that says nothing usable ----------------------------------------------------------------
setCal({ press: { lo: 0.5, mid: 0.5, hi: 0.5 } });
let degen = 0;
for (let i = 0; i <= 100; i++) { const p = i / 100; degen = Math.max(degen, Math.abs(penPress(p) - (LO + 1.7 * p))); }
say(degen === 0, 'a degenerate profile (light = natural = hard) falls back rather than dividing by zero');

// ---- tilt -------------------------------------------------------------------------------------------
console.log('\nTILT');
// A STIFF GRIP, which is the case that was being thrown away. This hand lays the pen to 0.18 and
// no further - 0.11 past its rest - so the fixed 9-to-25-degree window barely opens for it, and
// everything it does with tilt lands in the first tenth of an effect built for somebody else.
//
// The first version of this used a hand that lays to 0.35, which is 0.28 past rest and therefore
// almost exactly the fixed 25/90 = 0.278. Of course the two curves agreed: the case could not
// discriminate, and a test that cannot tell the two apart passes on either.
const STIFF = { press: HAND.press, lean: { rest: 0.07, max: 0.18 } };
const rest = 0.07;
// Varying, because tiltReal reads a constant lean as hardware with no sensor; and HELD at the lay
// for the last quarter, because leanProfile averages over a +-8 window and a ramp that only
// touches its maximum at the final sample can never read as fully laid. That is the smoothing
// being right, not the threshold being wrong.
const S = Array.from({ length: 40 }, (_, i) => {
  const u = i / 39, r = Math.min(1, u / 0.75);
  return [u, 0, i * 8, 0.5, 0.07 + r * 0.11 + Math.sin(u * 13) * 0.0015, 0];
});
setCal(null);
const fixed = leanProfile(S, rest);
setCal(STIFF);
const fitted = leanProfile(S, rest);
say(!!fixed && !!fitted, 'both profiles produce a lean curve at all');
const at = u => [fixed(u), fitted(u)];
const [f25, c25] = at(0.25), [f50, c50] = at(0.5), [f100, c100] = at(1);
console.log(`    a grip that only lays to ${STIFF.lean.max} (${(STIFF.lean.max - rest).toFixed(2)} past rest)`);
console.log(`    quarter through   fixed ${f25.toFixed(3)}   fitted ${c25.toFixed(3)}`);
console.log(`    half through      fixed ${f50.toFixed(3)}   fitted ${c50.toFixed(3)}`);
console.log(`    laid right down   fixed ${f100.toFixed(3)}   fitted ${c100.toFixed(3)}`);
// Not 1e-6: the jitter tiltReal REQUIRES means the +-8 average sits a hair under the peak it is
// averaging, always. Demanding exactly 1 would be demanding a hand that does not shake, which is
// the same hand tiltReal refuses to believe in.
say(c100 > 0.99, `fitted: laying the pen down as far as THIS hand does reaches full effect (${c100.toFixed(4)})`);
say(f100 < 0.25, `fixed: the same hand, laid as far as it goes, got ${f100.toFixed(3)} of the effect - almost none of it`);
let tm = true, tp = -Infinity;
for (let i = 0; i <= 200; i++) { const v = fitted(i / 200); if (v < tp - 1e-12) tm = false; tp = v; }
say(tm, 'and it never goes backwards either');

console.log('');
process.exit(bad ? 1 : 0);

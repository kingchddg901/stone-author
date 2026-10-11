/**
 * The drawn roller: a pass, with pressure and tilt.
 *
 * The claim that has to be able to go red is not "tilt does something" - almost any wiring does
 * something. It is that **leaning ALONG the pass does nothing**. Azimuth is screen-relative, and
 * mapped raw it would make the control change meaning every time the path curves: the same wrist
 * angle would tip the roller one way on the way out and the other way on the way back. So the
 * probe runs the same lean at two azimuths, across the pass and along it, and the second must be
 * indistinguishable from no tilt at all.
 *
 * Also checked: that the face is a real edge, that pressure reaches the bite, and that "one, start
 * down" lands a stamp at the beginning of the stroke rather than wherever the origin happens to be.
 *
 * Calls the app's rollerPath / rollerBake / rollerAt / rollerHand / rollStampAt, lifted from
 * source. Pen samples are synthesised here - [x, y, t, pressure, lean, azimuth] - because the point
 * is what the code does with a hand, and a hand is exactly what a probe cannot have.
 *
 *   node tools/probe-glass-roller.mjs [out.png]
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
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
const NEEDED = ['resample', 'pressureReal', 'pressFactor', 'tiltReal',
                'leanProfile', 'penAxis', 'rollerPath', 'rollerBake', 'rollerAt', 'rollerHand',
                'starR', 'rollStampAt'];
const SLAB_FT = +(SRC.match(/const SLAB_FT = (\d+)/) || [, 8])[1];
// smoothstep is an arrow const rather than a declaration, so it comes across by its own line -
// still taken from the source, because leanProfile's thresholds are measured through it.
const SMOOTH = SRC.match(/^ *const smoothstep = .*$/m)[0];
const api = new Function('SLAB_FT',
  SMOOTH + '\n' + NEEDED.map(lift).join('\n') + '\nreturn {' + NEEDED.join(',') + '};')(SLAB_FT);
const { rollerBake, rollerAt, rollerHand, rollStampAt } = api;

const H = 0.62;
// A pass that curves, so "along" and "across" are not the same direction at both ends - which is
// the only way the tilt claim can bite.
const N = 90;
function stroke({ press, lean, azMode }) {
  const S = [];
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    const x = 0.08 + u * 0.84, y = H * 0.5 + Math.sin(u * Math.PI) * 0.17;
    // the pass's own direction here, so "across" and "along" can be asked for by name
    const dx = 0.84, dy = Math.cos(u * Math.PI) * Math.PI * 0.17;
    const ang = Math.atan2(dy, dx);
    const az = azMode === 'across' ? ang + Math.PI / 2 : azMode === 'along' ? ang : 0;
    S.push([x, y, i * 8, press(u), lean(u), az]);
  }
  return S;
}
const FLAT = () => 0.5, NOLEAN = () => 0;
const RAMP = u => 0.18 + 0.72 * u;                  // light at the start, hard at the end
// A HAND IS NEVER PERFECTLY STEADY, and tiltReal knows it: a lean reporting one value for the
// whole pass is hardware that has no tilt, not a hand that held still. A constant here made the
// tilt silently do nothing and made the "along does nothing" claim pass VACUOUSLY - both sides
// zero. Which is a real property to know about, not a bug: a perfectly steady lean is
// indistinguishable from no sensor, by construction, exactly as a flat 0.5 is for pressure.
const LEAN = u => 38 / 90 + Math.sin(u * 11) * 0.015;

const P = { rollD: 6, rollFace: 2.4, rollStampN: 24, rollStampSize: 1, rollStampRot: 45, rollBite: 1 };
function mark(S, opts) { return { kind: 'roller', samples: S, rest: 6 / 90, p: { ...P, ...opts } }; }
const face = P.rollFace, st = Array.from({ length: P.rollStampN }, (_, i) => ({
  a: i * 360 / P.rollStampN, x: -face / 2 + (i + 0.5) * (face / P.rollStampN),
  rot: P.rollStampRot, r: P.rollStampSize }));
const OP = { D: P.rollD, face, bite: 1, st };

const pv = [0, 0], ph = [1, 0];
// What the painter does per pixel, so the probe cannot drift from it.
function biteAt(B, cu, cvv) {
  rollerAt(B, cu, cvv, pv);
  const s = pv[0], v = pv[1], half = face * 0.5;
  if (!(v > -half && v < half)) return { bite: 0, star: 0, s, v };
  rollerHand(B, s, ph);
  let bite = ph[0] * (1 + ph[1] * (v / half));
  if (bite < 0) bite = 0; else if (bite > 1) bite = 1;
  return { bite, star: bite > 0 ? rollStampAt(s, v, OP) : 0, s, v };
}

const CASES = [
  ['no pen: flat pressure, no tilt', mark(stroke({ press: FLAT, lean: NOLEAN, azMode: 'none' }), { pressure: false, tilt: false })],
  ['pressure ramping light to hard', mark(stroke({ press: RAMP, lean: NOLEAN, azMode: 'none' }), { pressure: true, tilt: false })],
  ['leaning ACROSS the pass',        mark(stroke({ press: FLAT, lean: LEAN, azMode: 'across' }), { pressure: false, tilt: true })],
  ['leaning ALONG the pass',         mark(stroke({ press: FLAT, lean: LEAN, azMode: 'along' }), { pressure: false, tilt: true })],
];

const PW = 760, PH = Math.round(PW * H), PAD = 22;
const WID = PW, HT = (PH + PAD) * CASES.length;
const px = Buffer.alloc(WID * HT * 3, 232);
const stats = [];
CASES.forEach(([label, m], r) => {
  const B = rollerBake(m, H);
  if (!B) throw new Error('rollerBake returned null for: ' + label);
  let touched = 0, starPx = 0, biteSum = 0;
  const half4 = [0, 0, 0, 0], halfN = [0, 0, 0, 0];      // bite summed in four bands across the face
  let firstHalf = 0, lastHalf = 0, fn = 0, ln = 0;
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
    const cu = (x + 0.5) / PW, cvv = (y + 0.5) / PW;
    const q = biteAt(B, cu, cvv);
    let g = 232;
    if (q.bite > 0) {
      touched++; biteSum += q.bite;
      const band = Math.min(3, Math.max(0, Math.floor((q.v / (face * 0.5) * 0.5 + 0.5) * 4)));
      half4[band] += q.bite; halfN[band]++;
      if (q.s < B.total * 0.25) { firstHalf += q.bite; fn++; }
      else if (q.s > B.total * 0.75) { lastHalf += q.bite; ln++; }
      g = 232 - 120 * q.bite;
    }
    let R = g, G = g, Bl = g;
    if (q.star > 0) { starPx++; R = 196; G = 60; Bl = 48; }
    const o = ((r * (PH + PAD) + PAD + y) * WID + x) * 3;
    px[o] = R; px[o + 1] = G; px[o + 2] = Bl;
  }
  stats.push({ label, touched, starPx, bite: biteSum / Math.max(1, touched),
               bands: half4.map((s, i) => s / Math.max(1, halfN[i])),
               first: firstHalf / Math.max(1, fn), last: lastHalf / Math.max(1, ln), B });
});

const raw = Buffer.alloc((WID * 3 + 1) * HT);
for (let y = 0; y < HT; y++) { raw[y * (WID * 3 + 1)] = 0; px.copy(raw, y * (WID * 3 + 1) + 1, y * WID * 3, (y + 1) * WID * 3); }
let TBL = null;
function crc32(b) {
  if (!TBL) { TBL = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; TBL[n] = c; } }
  let c = -1; for (let i = 0; i < b.length; i++) c = TBL[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}
const chunk = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
  const b = Buffer.concat([Buffer.from(ty, 'ascii'), d]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(b) >>> 0); return Buffer.concat([l, b, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(WID, 0); ihdr.writeUInt32BE(HT, 4); ihdr[8] = 8; ihdr[9] = 2;
const outPath = process.argv[2] || path.join(HERE, '..', 'glass-roller.png');
fs.writeFileSync(outPath, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));

const total = PW * PH;
console.log('wrote', outPath, WID + 'x' + HT);
console.log(`pass length ${stats[0].B.total.toFixed(3)} ft, C = ${(Math.PI * P.rollD / 12).toFixed(3)} ft` +
            ` -> ${(stats[0].B.total / (Math.PI * P.rollD / 12)).toFixed(2)} turns`);
console.log('\nMEASURED');
for (const s of stats) console.log(`  ${s.label.padEnd(32)} touched ${(s.touched / total * 100).toFixed(1).padStart(5)}%` +
  `  bite ${s.bite.toFixed(3)}  across the face [${s.bands.map(b => b.toFixed(2)).join(' ')}]` +
  `  start ${s.first.toFixed(2)} end ${s.last.toFixed(2)}  star ${(s.starPx / total * 100).toFixed(2)}%`);

const [flat, ramp, across, along] = stats;
let bad = 0;
const say = (ok, msg) => { if (!ok) bad++; console.log('  ' + (ok ? 'OK  ' : 'RED ') + msg); };
console.log('\nCLAIMS');
say(flat.touched > 0 && flat.touched < total * 0.9,
    `the face is a real edge: it touched ${(flat.touched / total * 100).toFixed(1)}% of the sheet, not all of it`);
say(flat.starPx > 0, 'the die reaches the glass');
say(ramp.last > ramp.first * 1.5,
    `pressure reaches the bite: ${ramp.first.toFixed(2)} at the start of the pass, ${ramp.last.toFixed(2)} at the end`);
const tiltSpread = Math.abs(across.bands[3] - across.bands[0]);
say(tiltSpread > 0.2,
    `leaning ACROSS tips one end down: ${across.bands[0].toFixed(2)} at one edge of the face, ` +
    `${across.bands[3].toFixed(2)} at the other`);
// THE ONE THAT MATTERS. Along the pass is just how the pen is held; it must do nothing, on a curve
// as much as on a straight, or the control changes meaning as the hand turns.
const alongSpread = Math.abs(along.bands[3] - along.bands[0]);
const flatSpread = Math.abs(flat.bands[3] - flat.bands[0]);
// GUARDED, so it cannot pass vacuously. If the across case produced no spread either, both sides
// are zero and this says nothing at all - which is exactly how it passed the first time it ran.
say(tiltSpread > 0.2 && Math.abs(alongSpread - flatSpread) < 0.05,
    `leaning ALONG does nothing: spread across the face ${alongSpread.toFixed(3)} against ` +
    `${flatSpread.toFixed(3)} with no tilt at all, while leaning across gives ${tiltSpread.toFixed(3)}`);
process.exit(bad ? 1 : 0);

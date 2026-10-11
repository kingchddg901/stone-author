/**
 * The moon as a stir stick: does it move the melt the right way, by the right amount?
 *
 * Three things are easy to get wrong here and none of them are visible by reading:
 *   SIGN      the baked field says where a point WENT; a field has no points to follow, so the
 *             painter needs where the glass now here CAME FROM. One minus sign, and backwards
 *             looks entirely plausible on screen.
 *   UNITS     the stick is dragged in SLAB coordinates and the melt lives in the formed object's
 *             feet. The u and v scales are only equal because oy carries a compensating H.
 *   THE BAKE  a 161-wide grid standing in for a function that walks the whole pass.
 *
 * So each is measured rather than asserted, against the app's own functions lifted from source.
 * What it does NOT cover: mask discs. _wmask is left empty, which is the real no-mask case, and
 * warpMaskAt is the app's own - but a run with chaos discs down is not tested here.
 *
 *   node tools/probe-glass-stir.mjs [out.png]
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
const NEEDED = ['woodHash', 'woodAtan2', 'nz', 'vnoise', 'fbm2', 'glassGather', 'glassLay',
                'resample', 'warpMaskAt', 'moonDisp', 'glassStir', 'glassUnstir'];
const api = new Function(
  'let _wmask = [];\n' +                                   // no mask discs: warpMaskAt then returns 1
  NEEDED.map(lift).join('\n') + '\nreturn {' + NEEDED.join(',') + '};')();
const { glassGather, glassLay, moonDisp, glassStir, glassUnstir, warpMaskAt } = api;

const SLAB_FT = +(SRC.match(/const SLAB_FT = (\d+)/) || [, 8])[1];
const H = 0.62, PANEX = 0, PANEY = 0;

// A stick dragged left to right across the middle, as a mark the app would have committed.
const DRAG = { kind: 'moon', p: { moonReach: 1.6, moonStrength: 2.2 },
               samples: Array.from({ length: 60 }, (_, i) => [0.12 + (i / 59) * 0.76, H * 0.5]) };
const S = glassStir(H, [DRAG]);
if (!S) throw new Error('glassStir returned null for a 60-sample drag');

// ---- 1. the bake against the function it stands in for ----------------------------------------
const direct = moonDisp(DRAG);
let maxField = 0, maxErr = 0;
for (let j = 0; j <= 240; j++) for (let i = 0; i <= 240; i++) {
  const cu = i / 240, cvv = (j / 240) * H;
  const [ax, ay] = direct(cu, cvv);
  const out = [0, 0]; glassUnstir(S, cu, cvv, out);
  maxField = Math.max(maxField, Math.hypot(ax, ay));
  maxErr = Math.max(maxErr, Math.hypot(out[0] + ax, out[1] + ay));   // out is already negated
}

// ---- 2. the sign, and 3. reach ------------------------------------------------------------------
const on = [0, 0]; glassUnstir(S, 0.5, H * 0.5, on);                 // under the stick
const off = [0, 0]; glassUnstir(S, 0.5, H * 0.5 + 0.40, off);        // well outside the ball
// A rightward drag carries the melt right, so the glass now at x came from the LEFT: back[0] < 0.
const signOK = on[0] < 0;

// ---- render: the same lay-up, unstirred and stirred ---------------------------------------------
const TW = 600, TH = 190, PAD = 24;
const INK = [[159, 216, 200], [47, 111, 143], [200, 146, 63], [142, 75, 110]];
const CASES = [['blown, laid along the rod', 'blown', 0], ['spun, laid along the rod', 'spun', 0]];
const W = TW, HT = (TH + PAD) * CASES.length * 2;
const px = Buffer.alloc(W * HT * 3, 17);
const gth = [0, 0], lay = [0, -1, 0], back = [0, 0];
let row = 0, shifts = [];

for (const [label, form, layAng] of CASES) {
  for (const stirred of [false, true]) {
    const F = { form, SST: 4, CS: 3, CN: 3, CW: 0.25, RS: 6,
                LC: Math.cos(layAng * Math.PI / 180), LS: Math.sin(layAng * Math.PI / 180), TW: 0, LP: 0 };
    let firstEdgeMid = null, prev = -1;
    for (let y = 0; y < TH; y++) {
      for (let x = 0; x < TW; x++) {
        const cu = x / TW, cvv = (y / TH) * H;
        let sx = PANEX + (cu - 0.5) * SLAB_FT / 12;
        let sy = PANEY + (cvv / H - 0.5) * SLAB_FT * H / 12;
        if (stirred) { glassUnstir(S, cu, cvv, back); sx += back[0] * SLAB_FT / 12; sy += back[1] * SLAB_FT / 12; }
        glassGather(sx, sy, F, gth);
        glassLay(gth[0], gth[1], F, lay);
        // the first band change along the centre row: a position that can be compared
        if (y === (TH >> 1)) { if (prev >= 0 && lay[0] !== prev && firstEdgeMid === null) firstEdgeMid = x; prev = lay[0]; }
        const c = INK[lay[0] % INK.length];
        const o = ((row * (TH + PAD) + PAD + y) * W + x) * 3;
        px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2];
      }
    }
    shifts.push({ label, stirred, firstEdgeMid });
    row++;
  }
}

const raw = Buffer.alloc((W * 3 + 1) * HT);
for (let y = 0; y < HT; y++) { raw[y * (W * 3 + 1)] = 0; px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
let TBL = null;
function crc32(buf) {
  if (!TBL) { TBL = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; TBL[n] = c; } }
  let c = -1; for (let i = 0; i < buf.length; i++) c = TBL[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(HT, 4); ihdr[8] = 8; ihdr[9] = 2;
const out = process.argv[2] || path.join(HERE, '..', 'glass-stir.png');
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));

const pct = maxField > 0 ? (maxErr / maxField * 100) : NaN;
console.log('wrote', out, W + 'x' + HT);
console.log('mask at an unmasked point   ', warpMaskAt(0.5, H * 0.5), '(1 = no discs down, as declared)');
console.log('peak displacement           ', maxField.toFixed(5), 'slab units =',
            (maxField * SLAB_FT / 12).toFixed(5), 'ft');
console.log('bake vs direct, worst       ', maxErr.toFixed(6), `(${pct.toFixed(2)}% of peak)`,
            !(pct < 2) ? '<-- TOO COARSE' : 'ok');
console.log('under the stick, back[]     ', on.map(v => v.toFixed(4)).join(', '),
            signOK ? '(came from the LEFT of a rightward drag: correct)' : '<-- SIGN IS BACKWARDS');
console.log('0.40 outside the ball       ', off.map(v => v.toFixed(4)).join(', '),
            Math.hypot(...off) === 0 ? '(no reach, as a finite ball must)' : '<-- LEAKS BEYOND ITS RADIUS');
for (const s of shifts) console.log(`  ${s.label.padEnd(26)} ${s.stirred ? 'stirred  ' : 'unstirred'} first band edge at x=${s.firstEdgeMid}`);
const moved = shifts[0].firstEdgeMid !== shifts[1].firstEdgeMid;
console.log(moved ? 'the stir MOVED the lay-up.' : 'THE STIR CHANGED NOTHING - the probe is blind or the wiring is dead.');

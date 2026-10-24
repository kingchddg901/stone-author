/**
 * The mould and the list: does the ORDER of the operations actually change the glass?
 *
 * That is the whole claim of the ops list, and it is the one a sum would silently fail. If the
 * renderer added the warps instead of composing them, every pair would commute and every reorder
 * would be a no-op - which looks like a perfectly good render and is worth nothing.
 *
 * So the probe swaps pairs and counts the pixels whose LABEL changed. Two cautions it respects:
 *   - some pairs genuinely commute. blow is a uniform scale and roll is a diagonal one, and
 *     diagonal matrices commute, so blow/roll SHOULD come out identical. Reporting that as a
 *     failure would be the probe inventing a defect.
 *   - a difference of zero on a NON-commuting pair is a red, not a curiosity.
 *
 * It calls the app's own glassUnform and glassLay, lifted from source, and leaves out only the
 * painter's Beer-Lambert pass: the question is which compartment is where, and the tint and the
 * relief only make that harder to read.
 *
 * It runs in Node because the app resisted being driven from a browser pane. The pane stops
 * servicing requestAnimationFrame when the desktop window is not in front, and the redraw's
 * `queued` guard then latches on a frame that will never run - so the canvas holds whatever was
 * painted at load and every "render" reads the same stale frame. That surfaced as twelve identical
 * cells, which looks exactly like a finding and is not one. ABLATE any canvas probe: paint
 * something yourself and assert it gets overwritten. (Shimming rAF after load cannot clear the
 * latch; serving a copy with the shim prepended BEFORE the app's own script can.)
 *
 *   node tools/probe-glass-lay.mjs [out.png]
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
const NEEDED = ['woodHash', 'woodAtan2', 'nz', 'vnoise', 'fbm2', 'resample', 'warpMaskAt',
                'mix', 'moonDisp', 'glassWarp', 'glassUnwarp', 'vnoiseC', 'vnoiseCfill', 'fbm2C', 'compileOps', 'glassUnform', 'glassLay',
                'glassBlob', 'glassBlobDepth', 'glassCellSDF', 'glassCellSpread', 'glassDepth'];
const SLAB_FT = +(SRC.match(/const SLAB_FT = (\d+)/) || [, 8])[1];
// OPK IS LIFTED, NOT RETYPED. compileOps reads it to turn an op's kind STRING into the integer
// glassUnform switches on, and a second copy here would drift the first time a kind is added -
// the app's own worker core carries it across for exactly this reason.
const OPK_SRC = (SRC.match(/const OPK = \{[^}]*};/) || [])[0];
const NZC_DECL = (SRC.match(/const _NZC = new Float64Array\([^;]*\);/) || [])[0];
if (!NZC_DECL) throw new Error('the app has no _NZC declaration - the corner cache cannot be lifted');
const SPIN_DECL = (SRC.match(/const SPIN_NB = [^;]*;/) || [])[0];
if (!SPIN_DECL) throw new Error('the app has no SPIN_NB declaration - the spin table cannot be lifted');
if (!OPK_SRC) throw new Error('the app has no OPK table - compileOps cannot be lifted');
// G/fam/strHue are app state rather than geometry: the current's SHAPE here is the app's, its seed
// is not. _wmask empty means warpMaskAt returns 1, which is the real no-discs case.
const G = { warp: 0, cloudScale: 1, cloudX: 0, cloudY: 0 };
const api = new Function('G', 'SLAB_FT',
  OPK_SRC + '\n' + NZC_DECL + '\n' + SPIN_DECL + '\n' +
  'let _wmask = []; let fam = "probe"; const strHue = () => 0.5;\n' +
  NEEDED.map(lift).join('\n') + '\n'
  + lift('spinTable') + '\nconst SPIN_T = spinTable();\n'
  + 'return {' + NEEDED.join(',') + '};')(G, SLAB_FT);
const { glassUnform, glassLay, glassWarp, compileOps } = api;
// Both read out of the source, because the whole point is whether these two agree.
const CN_MAX = +(SRC.match(/CN: Math[.]max[(]2, Math[.]min[(](\d+)/) || [, 0])[1];
const TOKENS = (SRC.match(/key: 'glass[A-F]'/g) || []).length;

const H = 0.62;
const DRAG = { kind: 'moon', p: { moonReach: 1.6, moonStrength: 2.4 },
               samples: Array.from({ length: 60 }, (_, i) => [0.12 + (i / 59) * 0.76, H * 0.5]) };
const S = glassWarp(H, [DRAG]);

const base = { MR: false, PX: 0, PY: 0, H, S, CS: 3, CN: 3, CW: 0.25, RS: 6, LC: 1, LS: 0, TW: 0, LP: 0 };
const TW_ = 300, TH_ = 190, PAD = 22;
const INK = [[159, 216, 200], [47, 111, 143], [200, 146, 63], [142, 75, 110]];

const out = [0, 0], lay = [0, -1, 0];
function field(ops, radial) {
  const F = { ...base, OPS: ops, MR: radial };
  F.OPC = compileOps(F, F.OPS);          // glassUnform walks the COMPILED ops, never F.OPS
  const a = new Uint8Array(TW_ * TH_);
  for (let y = 0; y < TH_; y++) for (let x = 0; x < TW_; x++) {
    const cu = x / TW_, cvv = (y / TH_) * H;
    const ox = (cu - 0.5) * SLAB_FT / 12, oy = (cvv / H - 0.5) * SLAB_FT * H / 12;
    glassUnform(ox, oy, F, out);
    glassLay(out[0], out[1], F, lay);
    a[y * TW_ + x] = lay[0];
  }
  return a;
}
const differ = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n / a.length; };

const SPIN = { k: 'spin', a: 1.2 }, BLOW = { k: 'blow', a: 1.8 },
      ROLL = { k: 'roll', a: 2.5 }, STIR = { k: 'stir' };
const PAIRS = [
  ['spin / blow', [SPIN, BLOW], [BLOW, SPIN], true],
  ['spin / roll', [SPIN, ROLL], [ROLL, SPIN], true],
  ['stir / blow', [STIR, BLOW], [BLOW, STIR], true],
  ['blow / roll', [BLOW, ROLL], [ROLL, BLOW], false],   // both diagonal scales: these DO commute
];

const ROWS = [
  ['a plain pour', []],
  ['spin', [SPIN]],
  ['stir, then blow', [STIR, BLOW]],
  ['blow, then stir', [BLOW, STIR]],
  ['spin, roll, spin', [SPIN, ROLL, { k: 'spin', a: 0.8 }]],
];
const W = TW_ * 2, HT = (TH_ + PAD) * ROWS.length;
const px = Buffer.alloc(W * HT * 3, 17);
for (let r = 0; r < ROWS.length; r++) {
  [false, true].forEach((radial, c) => {
    const a = field(ROWS[r][1], radial);
    for (let y = 0; y < TH_; y++) for (let x = 0; x < TW_; x++) {
      const ink = INK[a[y * TW_ + x] % INK.length];
      const o = ((r * (TH_ + PAD) + PAD + y) * W + c * TW_ + x) * 3;
      px[o] = ink[0]; px[o + 1] = ink[1]; px[o + 2] = ink[2];
    }
  });
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
const outPath = process.argv[2] || path.join(HERE, '..', 'glass-lay.png');
fs.writeFileSync(outPath, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));

console.log('wrote', outPath, W + 'x' + HT, '(left column strips, right column radial)');
console.log('warp field for the stir:', S ? 'built' : 'NULL - the stir op would be a no-op');
let bad = 0;
const say = (ok, msg) => { if (!ok) bad++; console.log('  ' + (ok ? 'OK  ' : 'RED ') + msg); };
console.log('\nDOES THE ORDER MATTER? pixels whose compartment changed when the pair is swapped:');
for (const [name, A, B, mustDiffer] of PAIRS) {
  const d = differ(field(A, false), field(B, false));
  const ok = mustDiffer ? d > 0.01 : d === 0;
  if (!ok) bad++;
  console.log(`  ${name.padEnd(12)} ${(d * 100).toFixed(1).padStart(5)}%  ` +
    (mustDiffer ? (ok ? 'order matters, as composition requires' : '<-- IDENTICAL: the ops are SUMMED, not composed')
                : (ok ? 'commutes, correctly - both are diagonal scales' : '<-- these should commute and do not')));
}
// EVERY COLOUR REACHABLE FROM EVERY MOULD. The token set is copied in four places - the painter's
// canes array, the colour-count clamp, the cells editor's cycle and the blob hash - and a set
// extended in one copy and not the others is invisible: the render still works, it just quietly
// cannot say two of the colours. Which is exactly what happened when E and F were added for the
// five-colour test and the clamp stayed at four.
console.log('\nEVERY COLOUR, EVERY MOULD');
say(CN_MAX === TOKENS, `the colour clamp (${CN_MAX}) matches the number of tokens (${TOKENS})`);
{
  const probe = [0, -1, 0, 1];
  const mb = { ...base, OPS: [], CN: TOKENS, MC: null, MW: 0.5, MOB: 0.7, MST: 4, MSQ: 2, MJ: 0.7 };
  for (const [name, F] of [['strips', { ...mb, MR: false, MB: false }],
                           ['radial', { ...mb, MR: true, MB: false }],
                           ['blobs', { ...mb, MR: false, MB: true }]]) {
    const got = new Set();
    for (let i = 0; i < 40000; i++) {
      const x = (i % 200) / 25 - 4, y = ((i / 200) | 0) / 25 - 4;
      glassLay(x, y, F, probe); if (probe[0] >= 0) got.add(probe[0]);
    }
    say(got.size === TOKENS, `${name} reaches all ${TOKENS} colours (got ${[...got].sort((a, b) => a - b).join(',')})`);
  }
}

const dm = differ(field([], false), field([], true));
console.log(`\nmould strips vs radial, no ops: ${(dm * 100).toFixed(1)}% ` +
  (dm > 0.01 ? 'differ - the mould is its own thing, not a warp' : '<-- THE MOULD SHAPE DOES NOTHING'));
if (dm <= 0.01) bad++;
process.exit(bad ? 1 : 0);

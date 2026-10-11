/**
 * Cookies on a cookie sheet, and a roller that starts with one, start down.
 *
 * BLOBS are the same budget on a simpler shape: a disc of area pi*r^2 at `start` times target
 * thickness can cover start*pi*r^2, so it reaches r*(sqrt(start)-1) and no further. What that buys
 * is interweaving - neighbours of different sizes have different reaches, so where two fronts meet
 * is nowhere near halfway between them, and the joins come out as curves.
 *
 * TOUCH-DOWN. The stamp phase used to be pinned to the object's origin, which on a piece shorter
 * than the roller's circumference arbitrarily decided which arc of the roller ever touched it -
 * and therefore which band of the sheet came out bare. That is most of the composition, decided by
 * accident. It is now the leading edge of the pane along the roll's own direction. The probe
 * checks it by MOVING THE PANE: if the phase is pinned to the pass, the star pattern travels with
 * the glass; if it were still pinned to the origin it would stay put and the glass would slide
 * under it.
 *
 *   node tools/probe-glass-blobs.mjs [out.png]
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
const NEEDED = ['woodHash', 'woodAtan2', 'nz', 'vnoise', 'fbm2', 'mix', 'resample', 'warpMaskAt',
                'moonDisp', 'glassWarp', 'glassUnwarp', 'starR', 'rollStampAt', 'rollStamp',
                'glassBlob', 'glassBlobDepth', 'glassCellSDF', 'glassCellSpread', 'glassDepth',
                'glassUnform', 'glassLay'];
const SLAB_FT = +(SRC.match(/const SLAB_FT = (\d+)/) || [, 8])[1];
const G = { warp: 0, cloudScale: 1, cloudX: 0, cloudY: 0 };
const api = new Function('G', 'SLAB_FT',
  'let _wmask = []; let fam = "probe"; const strHue = () => 0.5;\n' +
  NEEDED.map(lift).join('\n') + '\nreturn {' + NEEDED.join(',') + '};')(G, SLAB_FT);
const { glassLay, glassUnform } = api;

const INK = [[196, 48, 43], [46, 139, 87], [47, 111, 143], [122, 59, 142], [217, 131, 36], [142, 75, 110]];
const W = 0.5, H = 0.62;
const D_IN = 6, NSTAMP = 24, FACE = 5;
const STAMPS = Array.from({ length: NSTAMP }, (_, i) => ({
  a: i * 15, x: -FACE / 2 + (i + 0.5) * (FACE / NSTAMP), rot: 45, r: 1 }));

const base = { MB: true, MW: W, MJ: 0.7, MOB: 0.7, MR: false, PX: 0, PY: 0, H, S: null,
               CS: 3, CN: 5, CW: 0, RS: 6, LC: 1, LS: 0, TW: 0, LP: 0, MC: null };
// The painter's own rule for where a roller touched down, so the probe cannot drift from it.
function touchdown(op, px, py) {
  const hx = SLAB_FT / 24, hy = SLAB_FT * H / 24;
  const dr = (+op.d || 0) * Math.PI / 180, cd = Math.cos(dr), sd = Math.sin(dr);
  let m = Infinity;
  for (const c of [[-hx, -hy], [hx, -hy], [-hx, hy], [hx, hy]]) {
    const u = (px + c[0]) * cd + (py + c[1]) * sd; if (u < m) m = u;
  }
  return m;
}

const PPF = 190, PW = Math.round(4 * PPF), PH = Math.round(1 * PPF), PAD = 24;
const out = [0, 0, 0], lay = [0, -1, 0, 1];
function render(px, { start, jit, stamped, paneX = 0, paneY = 0 }) {
  const ROLL = { k: 'roll', a: 1, d: 90, D: D_IN, st: STAMPS };
  const F = { ...base, MST: start, MSQ: Math.sqrt(start), MJ: jit, PX: paneX, PY: paneY,
              OPS: stamped ? [ROLL] : [] };
  F.RU0 = stamped ? [touchdown(ROLL, paneX, paneY)] : [];
  const buf = new Uint8Array(PW * PH * 3);
  let bare = 0, star = 0, lap = 0;
  const starRows = new Set();
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
    const ox = paneX + (x + 0.5) / PPF - 2, oy = paneY + (y + 0.5) / PPF - 0.5;
    glassUnform(ox, oy, F, out);
    glassLay(out[0], out[1], F, lay);
    let R, Gc, B;
    if (lay[0] < 0) { R = Gc = B = 232; bare++; }
    else {
      const c = INK[lay[0] % INK.length], a = lay[3];
      R = 232 + (c[0] - 232) * a; Gc = 232 + (c[1] - 232) * a; B = 232 + (c[2] - 232) * a;
      if (lay[1] >= 0) { lap++; R *= 0.72; Gc *= 0.72; B *= 0.72; }   // two in the path: darker
    }
    if (out[2] > 0) { star++; starRows.add(y); R += (255 - R) * 0.6; Gc += (255 - Gc) * 0.6; B += (255 - B) * 0.6; }
    const o = (y * PW + x) * 3; buf[o] = R; buf[o + 1] = Gc; buf[o + 2] = B;
  }
  return { buf, bare, star, lap, rows: [...starRows] };
}

const CASES = [
  ['blobs at rest (1.0x)',            { start: 1.0, jit: 0.7, stamped: false, paneX: 0 }],
  ['his figure for blobs (4.0x)',     { start: 4.0, jit: 0.7, stamped: false, paneX: 0 }],
  ['4.0x on a dead grid (scatter 0)', { start: 4.0, jit: 0,   stamped: false, paneX: 0 }],
  ['4.0x, pressed',                   { start: 4.0, jit: 0.7, stamped: true,  paneX: 0 }],
  ['same, pane moved 0.7 ft ALONG',   { start: 4.0, jit: 0.7, stamped: true,  paneY: 0.7 }],
];
const WID = PW, HT = (PH + PAD) * CASES.length;
const px = Buffer.alloc(WID * HT * 3, 236);
const res = CASES.map(([, cfg], r) => {
  const o = render(px, cfg);
  for (let y = 0; y < PH; y++)
    for (let x = 0; x < PW; x++) {
      const s = (y * PW + x) * 3, d = ((r * (PH + PAD) + PAD + y) * WID + x) * 3;
      px[d] = o.buf[s]; px[d + 1] = o.buf[s + 1]; px[d + 2] = o.buf[s + 2];
    }
  return o;
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
const outPath = process.argv[2] || path.join(HERE, '..', 'glass-blobs.png');
fs.writeFileSync(outPath, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));

const total = PW * PH;
console.log('wrote', outPath, WID + 'x' + HT);
console.log('\nMEASURED');
CASES.forEach(([label], i) => console.log(`  ${label.padEnd(32)} bare ${(res[i].bare / total * 100).toFixed(1).padStart(5)}%` +
  `  interwoven ${(res[i].lap / total * 100).toFixed(1).padStart(5)}%  star ${(res[i].star / total * 100).toFixed(2).padStart(5)}%`));

let bad = 0;
const say = (ok, msg) => { if (!ok) bad++; console.log('  ' + (ok ? 'OK  ' : 'RED ') + msg); };
const [rest, four, grid, pressed, moved] = res;
console.log('\nCLAIMS');
// Spreading dough BUTTS against its neighbour; it does not stack. So the two-deep area is the
// overlap they were PLACED with, and it must not move when the budget does - which is also the
// claim that would go red if a spread were quietly being counted as a second layer.
say(Math.abs(rest.lap - four.lap) <= 2,
    `two-deep area is placement overlap, not spread: ${(rest.lap / total * 100).toFixed(1)}% at rest` +
    ` and ${(four.lap / total * 100).toFixed(1)}% at 4.0x`);
say(four.bare < rest.bare, `and cover more of the tray (${(four.bare / total * 100).toFixed(1)}% bare vs ${(rest.bare / total * 100).toFixed(1)}%)`);
say(grid.bare !== four.bare, 'scatter changes the result - a dead grid is not the same tray');
// THE PIN. Move the pane along the roll and the stars must travel WITH the glass. Pinned to the
// origin they would stay where they were and the glass would slide under them.
const sameRows = pressed.rows.filter(r => moved.rows.includes(r)).length;
const overlap = sameRows / Math.max(1, Math.min(pressed.rows.length, moved.rows.length));
say(pressed.star > 0 && moved.star > 0, 'the roller hits in both positions');
// 0.7 ft is not a whole number of circumferences (C = 1.571 ft), so pinned to the ORIGIN the
// pattern would land somewhere else entirely. Pinned to the pass it cannot move at all.
say(overlap > 0.95, `moving the pane 0.7 ft ALONG the roll leaves the stamp rows where they were ` +
    `(${(overlap * 100).toFixed(0)}% the same): the phase is pinned to the pass, not the origin`);
process.exit(bad ? 1 : 0);

/**
 * His test, pressed. Five colours in an authored mould, then a stamped roller.
 *
 *   W = 0.5 ft, L = 1 ft. Left to right: Red 1Wx1L, Green 1Wx(L/2), Blue 2Wx1L,
 *   Purple 1Wx1L, Orange 3Wx1L  ->  8W = 4 ft wide, 1 ft long.
 *   Roller 5 ft face, 6 in round -> C = pi*D = 18.85 in.
 *   24 star stamps, 1 in across, glyph rotated 45 deg, 15 deg apart around the roller and
 *   staggered along its face so no two share a track.
 *
 * Three rows, so the slump can be seen doing its job rather than asserted:
 *   set hard first   slump 0 - the barriers come off set glass and the void past Green is crisp
 *   part set         the real model: whatever has glass nearby creeps into that void
 *   pressed          the same, with the roller run over it
 *
 * Calls the app's glassUnform, glassLay and starR, lifted from source. The Beer-Lambert pass is
 * left out on purpose - the question is which compartment is where and what the roller hit, and
 * the tint only makes that harder to read. A press THINS the sheet, so it is drawn paler.
 *
 *   node tools/probe-glass-press.mjs [out.png]
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
                'moonDisp', 'glassWarp', 'glassUnwarp', 'starR', 'rollStamp', 'glassUnform', 'glassLay',
                'glassNearestCell', 'glassSlumpReach', 'glassSlumpThin'];
const SLAB_FT = +(SRC.match(/const SLAB_FT = (\d+)/) || [, 8])[1];
const G = { warp: 0, cloudScale: 1, cloudX: 0, cloudY: 0 };
const api = new Function('G', 'SLAB_FT',
  'let _wmask = []; let fam = "probe"; const strHue = () => 0.5;\n' +
  NEEDED.map(lift).join('\n') + '\nreturn {' + NEEDED.join(',') + '};')(G, SLAB_FT);
const { glassUnform, glassLay, glassSlumpThin, glassSlumpReach } = api;

// ---- his numbers --------------------------------------------------------------------------------
const W = 0.5, L = 1;
const CELLS = [{ w: 1, l: 1, c: 0 }, { w: 1, l: 0.5, c: 1 }, { w: 2, l: 1, c: 2 },
               { w: 1, l: 1, c: 3 }, { w: 3, l: 1, c: 4 }];
const INK = [[196, 48, 43], [46, 139, 87], [47, 111, 143], [122, 59, 142], [217, 131, 36]];
const NAME = ['Red', 'Green', 'Blue', 'Purple', 'Orange'];

const TOT = CELLS.reduce((s, c) => s + c.w, 0) * W;          // 4 ft
const FACE = 5, D_IN = 6, NSTAMP = 24, STEP_DEG = 15, STAR_IN = 1, STAR_ROT = 45;
const C_FT = Math.PI * D_IN / 12;
// Staggered across the face: no two share a track, so each traces its own line down the piece.
const STAMPS = Array.from({ length: NSTAMP }, (_, i) => ({
  a: i * STEP_DEG, x: -FACE / 2 + (i + 0.5) * (FACE / NSTAMP), rot: STAR_ROT, r: STAR_IN }));
// a:1 is a press, not a draw - he said press, and a press that stretched would be a roll-out.
// d:90 puts the roll along the 1 ft length, so the roller's 5 ft face spans the 4 ft width.
const ROLL = { k: 'roll', a: 1, d: 90, D: D_IN, st: STAMPS };

const EX = [-TOT / 2], HL = [];
for (const c of CELLS) { EX.push(EX[EX.length - 1] + c.w * W); HL.push(c.l * L * 0.5); }
const baseF = { MC: CELLS, MEX: EX, MHL: HL, MW: W, MR: false, PX: 0, PY: 0, H: 0.62, S: null,
                CS: 3, CN: 3, CW: 0, RS: 6, LC: 1, LS: 0, TW: 0, LP: 0 };

const PPF = 300, PW = Math.round(TOT * PPF), PH = Math.round(L * PPF), PAD = 26;
// A sweep, because the question is not "does it creep" but "what stops it". Nothing stops it
// except how far it got before it set, so that is the axis.
const ROWS = [['set hard before unmoulding (0%)', 0, false],
              ['a quarter of the way to level', 0.25, false],
              ['most of the way (60%)', 0.6, false],
              ['levelled right out (100%)', 1, false],
              ['levelled, and pressed', 1, true]];
const WID = PW, HT = (PH + PAD) * ROWS.length;
const px = Buffer.alloc(WID * HT * 3, 236);
const gth = [0, 0, 0], lay = [0, -1, 0, 1];
const stats = [];

ROWS.forEach(([label, slump, pressed], r) => {
  const F = { ...baseF, SLP: slump, NR: [0, -1], OPS: pressed ? [ROLL] : [] };
  F.MRCH = glassSlumpReach(F);              // the worst void: what the slump is a fraction OF
  const thin = glassSlumpThin(F);
  let bare = 0, crept = 0, starPx = 0;
  const hitTracks = new Set();
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
    const ox = (x + 0.5) / PPF - TOT / 2, oy = (y + 0.5) / PPF - L / 2;
    glassUnform(ox, oy, F, gth);
    glassLay(gth[0], gth[1], F, lay);
    let R, Gc, B;
    if (lay[0] < 0) { R = Gc = B = 232; bare++; }             // bare glass
    else {
      // Depth, honestly: the slump's thinning applies to the whole sheet, and the creeping lip
      // is thinner still. Thickness is what makes a tint, so both show as paler.
      const c = INK[lay[0] % INK.length], a = lay[3] * thin;
      if (lay[3] < 0.999) crept++;
      R = 232 + (c[0] - 232) * a; Gc = 232 + (c[1] - 232) * a; B = 232 + (c[2] - 232) * a;
    }
    if (gth[2] > 0) { starPx++; hitTracks.add(Math.round(ox * 48)); R += (255 - R) * 0.55; Gc += (255 - Gc) * 0.55; B += (255 - B) * 0.55; }
    const o = ((r * (PH + PAD) + PAD + y) * WID + x) * 3;
    px[o] = R; px[o + 1] = Gc; px[o + 2] = B;
  }
  stats.push({ label, slump, bare, crept, starPx, thin, tracks: hitTracks.size });
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
const outPath = process.argv[2] || path.join(HERE, '..', 'glass-press.png');
fs.writeFileSync(outPath, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));

const total = PW * PH;
console.log('wrote', outPath, WID + 'x' + HT, `(${PPF} px/ft, rows top to bottom as listed)`);
console.log('\nTHE MOULD');
let acc = 0;
CELLS.forEach((c, i) => { console.log(`  ${NAME[i].padEnd(7)} ${c.w}W x ${c.l}L = ${(c.w * W).toFixed(2)} x ${(c.l * L).toFixed(2)} ft` +
  `   spans x ${(acc - TOT / 2).toFixed(2)} to ${(acc + c.w * W - TOT / 2).toFixed(2)}`); acc += c.w * W; });
console.log(`  total ${(TOT / W)}W = ${TOT.toFixed(2)} ft wide, ${L.toFixed(2)} ft long`);
console.log('\nTHE ROLLER');
console.log(`  D = ${D_IN} in  ->  C = pi*D = ${(C_FT * 12).toFixed(2)} in = ${C_FT.toFixed(3)} ft`);
console.log(`  the piece is ${(L * 12).toFixed(0)} in long, so the roller turns ${(L / C_FT * 360).toFixed(0)} deg -` +
            ` ${L >= C_FT ? 'more than' : 'LESS THAN'} one revolution, and the repeat ${L >= C_FT ? 'repeats' : 'never repeats on this piece'}`);
console.log(`  ${NSTAMP} stamps ${STEP_DEG} deg apart, so only those within ${(L / C_FT * 360).toFixed(0)} deg can land: ` +
            `${Math.floor(L / C_FT * 360 / STEP_DEG) + 1} of ${NSTAMP}`);
console.log(`  face ${FACE} ft vs glass ${TOT} ft: stamps outside +-${TOT / 2} ft miss the piece entirely`);
console.log('\nMEASURED');
for (const s of stats) console.log(`  ${s.label.padEnd(32)} bare ${(s.bare / total * 100).toFixed(1).padStart(5)}%` +
  `  crept ${(s.crept / total * 100).toFixed(1).padStart(5)}%  depth ${(s.thin * 100).toFixed(1).padStart(5)}%` +
  `  star ${(s.starPx / total * 100).toFixed(2).padStart(5)}%  tracks ${s.tracks}`);
const hard = stats[0], soft = stats[1], full = stats[3], prs = stats[4];
// THE MASS CLAIM. The void is 2 x (0.5 x 0.25) = 0.25 of 4 sq ft, so a sheet that fills it
// completely must end up 3.75/4 = 93.75% as deep. That figure is arrived at from his dimensions,
// NOT from the renderer, which is the only reason it can disagree with it.
const voidArea = 2 * (1 * W) * (0.5 * L * 0.5), sheet = TOT * L;
const expect = (sheet - voidArea) / sheet;
let bad = 0;
const say = (ok, msg) => { if (!ok) bad++; console.log('  ' + (ok ? 'OK  ' : 'RED ') + msg); };
console.log('\nCLAIMS');
say(hard.crept === 0 && hard.thin === 1, 'set hard: nothing creeps and nothing thins - the control is genuinely off');
say(soft.crept > 0, 'part set: the neighbours DO invade the void past Green');
say(soft.bare < hard.bare, `part set leaves less bare glass (${(soft.bare / total * 100).toFixed(1)}% vs ${(hard.bare / total * 100).toFixed(1)}%)`);
say(full.bare === 0, `levelled: the void is GONE (${(full.bare / total * 100).toFixed(2)}% bare left)`);
say(Math.abs(full.thin - expect) < 0.01,
    `levelled depth ${(full.thin * 100).toFixed(1)}% against ${(expect * 100).toFixed(2)}% from his dimensions` +
    ` - filling a void costs exactly the area it added`);
say(full.thin < hard.thin, 'the slump makes the WHOLE sheet shallower, not just where it crept');
say(prs.starPx > 0, 'the roller actually hit the glass');
say(prs.tracks > 1, `the stamps are staggered: ${prs.tracks} separate tracks, not one line`);
process.exit(bad ? 1 : 0);

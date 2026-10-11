/**
 * Render the LAY-UP field on its own, straight out of the app's real functions.
 *
 * The browser pane cannot drive this app: requestAnimationFrame is never serviced there, so the
 * canvas holds whatever was painted once at load and every "render" reads the same stale frame.
 * That is a measurement artifact that looks exactly like a finding - twelve identical cells - so
 * the harness moved off the browser entirely.
 *
 * It extracts glassGather and glassLay BY SOURCE from app/stone-author.html and calls them. It does
 * not reimplement them, because a probe driving a copy proves something about the copy. The one
 * thing it does leave out is the painter's Beer-Lambert pass, deliberately: the question here is
 * which ribbon is where, and the tint, relief and thickness only make that harder to read.
 *
 *   node tools/probe-glass-lay.mjs [out.png]
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', 'app', 'stone-author.html'), 'utf8');

// ---- lift the real functions out of the app ---------------------------------------------------
function lift(name) {
  const at = SRC.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('not found: ' + name);
  let i = SRC.indexOf('{', at), depth = 0;
  for (let j = i; j < SRC.length; j++) {
    const ch = SRC[j];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return SRC.slice(at, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
const NEEDED = ['woodHash', 'woodAtan2', 'nz', 'vnoise', 'fbm2', 'glassGather', 'glassLay'];
const mod = new Function(NEEDED.map(lift).join('\n') + '\nreturn {' + NEEDED.join(',') + '};')();
const { glassGather, glassLay } = mod;

// ---- the app's own GLASS defaults, so the probe cannot drift from them -------------------------
const dstart = SRC.indexOf('const GLASS = {');
const DEF = Object.fromEntries([...SRC.slice(dstart, SRC.indexOf('};', dstart))
  .matchAll(/(\w+)\s*:\s*(-?[\d.]+|'[a-z]+')/g)].map(m => [m[1], m[2].replace(/'/g, '')]));

// ---- the matrix -------------------------------------------------------------------------------
const TW_ = 300, TH_ = 200, PAD = 22;
const COLS = ['blown', 'spun', 'rolled', 'poured'];
const ROWS = [
  ['along the rod',   { lay: 0,  twist: 0,   lap: 0 }],
  ['around the rod',  { lay: 90, twist: 0,   lap: 0 }],
  ['along, twisted',  { lay: 0,  twist: 1.2, lap: 0 }],
  ['at 45 degrees',   { lay: 45, twist: 0,   lap: 0 }],
  ['along, lapped',   { lay: 0,  twist: 0,   lap: 0.15 }],
];
// Four flat, maximally distinguishable labels. Flat on purpose: a label field has no interior, so
// anything that shades inside a band would be the probe talking, not the field.
const INK = [[159, 216, 200], [47, 111, 143], [200, 146, 63], [142, 75, 110]];

const W = TW_ * COLS.length, H = (TH_ + PAD) * ROWS.length;
const px = Buffer.alloc(W * H * 3, 17);

const gth = [0, 0], lay = [0, -1, 0];
let laps = 0, cells = [];

for (let r = 0; r < ROWS.length; r++) {
  const cfg = ROWS[r][1];
  for (let c = 0; c < COLS.length; c++) {
    const F = {
      form: COLS[c],
      SST: 4, CS: 3, CN: 3, CW: 0.25, RS: +DEF.reamScale || 6,
      LC: Math.cos(cfg.lay * Math.PI / 180), LS: Math.sin(cfg.lay * Math.PI / 180),
      TW: cfg.twist, LP: cfg.lap,
    };
    const seen = new Set();
    for (let y = 0; y < TH_; y++) {
      for (let x = 0; x < TW_; x++) {
        const ox = (x / TW_ - 0.5) * 2.0, oy = (y / TH_ - 0.5) * 1.3;
        glassGather(ox, oy, F, gth);
        glassLay(gth[0], gth[1], F, lay);
        seen.add(lay[0]);
        let [R, G, B] = INK[lay[0] % INK.length];
        if (lay[1] >= 0) {                                   // the lap: the neighbour stacks on top
          laps++;
          const d = INK[lay[1] % INK.length], w = lay[2] * 0.75;
          // Two filters in series DARKEN; they do not average. Multiply, never lerp.
          R *= (1 - w * (1 - d[0] / 255)); G *= (1 - w * (1 - d[1] / 255)); B *= (1 - w * (1 - d[2] / 255));
        }
        const o = ((r * (TH_ + PAD) + PAD + y) * W + c * TW_ + x) * 3;
        px[o] = R; px[o + 1] = G; px[o + 2] = B;
      }
    }
    cells.push({ form: COLS[c], lay: ROWS[r][0], bands: seen.size });
  }
}

// ---- PNG ---------------------------------------------------------------------------------------
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
};
let TBL = null;
function crc32(buf) {
  if (!TBL) { TBL = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; TBL[n] = c; } }
  let c = -1; for (let i = 0; i < buf.length; i++) c = TBL[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
const out = process.argv[2] || path.join(HERE, '..', 'glass-lay.png');
fs.writeFileSync(out, Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEDC'.replace('DC', 'ND'), Buffer.alloc(0))]));

console.log('wrote', out, W + 'x' + H);
console.log('lap pixels:', laps, laps > 0 ? '(the lap is reachable)' : '(NO LAP EVER FIRED - the probe is blind)');
for (const c of cells) console.log(`  ${c.form.padEnd(7)} ${c.lay.padEnd(16)} bands=${c.bands}`);

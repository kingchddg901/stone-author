// HOW MUCH OF A MASTER LIVES ABOVE A SMALLER RENDER'S REACH?
//
// "There is a 65535 of the glass on disk; I do not know how much is in it that is not in the 4096."
// That is answerable from the file itself and needs no second render: take real tiles at 1:1, box
// filter them down by the ratio between the two sizes, bring them back up, and measure what did not
// survive. What is left is exactly the signal the smaller render cannot carry, whatever it does.
//
// The filter is a plain box average, which is what an honest downscale does and is the kindest case:
// a sharper filter would lose more, not less, so every figure here is a FLOOR on what is lost.
//
// Reported three ways, because one number hides the shape of it:
//   lost        mean |residual| per channel, 0-255
//   over 8      the share of channel values that move by more than 8 levels, which is where a
//               difference stops being plausibly invisible on a screen
//   variance    the residual's variance against the picture's own. A clean split: everything the
//               block average keeps is below the cutoff and everything in the residual is above it,
//               so the ratio is the share of the picture's contrast that the smaller size cannot
//               hold. NOT a neighbour-roughness ratio, which was the first thing here and was
//               worthless: a 16x nearest upsample makes 15 of every 16 neighbours identical BY
//               CONSTRUCTION, so it reported ~94% before looking at a single pixel of content.
//
//   node tools/detail-above.mjs <master.tif> [--at 4096] [--tiles 6]
import { openSync, readSync, closeSync, statSync } from 'fs';
import { inflateSync } from 'zlib';

const args = process.argv.slice(2);
const path = args.find(a => !a.startsWith('--'));
const numArg = (flag, dflt) => { const i = args.indexOf(flag); return i >= 0 ? +args[i + 1] : dflt; };
const AT = numArg('--at', 4096), WANT = numArg('--tiles', 6);
if (!path) { console.error('usage: node tools/detail-above.mjs <master.tif> [--at 4096] [--tiles 6]'); process.exit(1); }

function openTiff(p) {
  const fd = openSync(p, 'r');
  const at = (o, l) => { const b = Buffer.alloc(l); readSync(fd, b, 0, l, o); return b; };
  const u64 = (b, q) => b.readUInt32LE(q) + b.readUInt32LE(q + 4) * 4294967296;
  const ifd = u64(at(0, 16), 8), n = u64(at(ifd, 8), 0), ent = at(ifd + 8, n * 20);
  const SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 16: 8, 17: 8, 18: 8 }, tags = {};
  for (let i = 0; i < n; i++) {
    const e = i * 20, tag = ent.readUInt16LE(e), ty = ent.readUInt16LE(e + 2), c = u64(ent, e + 4);
    const by = (SZ[ty] || 0) * c;
    const raw = by <= 8 ? ent.subarray(e + 12, e + 12 + by) : at(u64(ent, e + 12), by);
    const v = [];
    for (let k = 0; k < c; k++) v.push(ty === 16 ? u64(raw, k * 8) : ty === 4 ? raw.readUInt32LE(k * 4) : ty === 3 ? raw.readUInt16LE(k * 2) : raw[k]);
    tags[tag] = v;
  }
  const g = t => tags[t] && tags[t][0];
  return { at, close: () => closeSync(fd), w: g(256), h: g(257), tw: g(322), th: g(323),
           spp: g(277) || 4, offs: tags[324], cnts: tags[325] };
}

const f = openTiff(path);
const RATIO = Math.max(2, Math.round(f.w / AT));
const TW = f.tw, TH = f.th, SPP = f.spp;
if (!f.offs) { console.error('not a tiled TIFF'); process.exit(1); }

// Spread the sample over the file rather than taking the first few tiles, which are one corner of
// one picture and say nothing about the rest of it.
const total = f.offs.length;
const picks = [];
for (let i = 0; i < WANT && i < total; i++) picks.push(Math.floor((i + 0.5) * total / Math.min(WANT, total)));

let sumLost = 0, nCh = 0, over8 = 0, maxLost = 0, read = 0;
// running sums for the variance split: the picture's own, and the residual's
let sFull = 0, sFull2 = 0, sRes = 0, sRes2 = 0;
for (const T of picks) {
  let px;
  try { px = inflateSync(f.at(f.offs[T], f.cnts[T])); } catch (_) { continue; }
  if (px.length < TW * TH * SPP) continue;
  read++;
  const DW = Math.floor(TW / RATIO), DH = Math.floor(TH / RATIO);
  // box filter down
  const small = new Float64Array(DW * DH * 3);
  for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let j = 0; j < RATIO; j++) for (let i2 = 0; i2 < RATIO; i2++)
      s += px[((y * RATIO + j) * TW + x * RATIO + i2) * SPP + c];
    small[(y * DW + x) * 3 + c] = s / (RATIO * RATIO);
  }
  // back up, nearest - the smaller render has no information between its samples either
  for (let y = 0; y < DH * RATIO; y++) for (let x = 0; x < DW * RATIO; x++) {
    const si = ((y / RATIO | 0) * DW + (x / RATIO | 0)) * 3, di = (y * TW + x) * SPP;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(px[di + c] - small[si + c]);
      sumLost += d; nCh++; if (d > 8) over8++; if (d > maxLost) maxLost = d;
    }
    for (let c = 0; c < 3; c++) {
      const v = px[di + c], r = v - small[si + c];
      sFull += v; sFull2 += v * v; sRes += r; sRes2 += r * r;
    }
  }
}
f.close();

const mb = (statSync(path).size / 1e6).toFixed(1);
console.log(`\n${path}`);
console.log(`  ${f.w} x ${f.h}, ${mb} MB, tiles ${TW}x${TH} (${total}), read ${read} spread across the file`);
console.log(`  against a ${AT} render: ${RATIO}x fewer samples per axis\n`);
console.log(`  lost        mean ${(sumLost / nCh).toFixed(2)} of 255 per channel, max ${maxLost}`);
console.log(`  over 8      ${(over8 / nCh * 100).toFixed(1)}% of channel values`);
const varFull = sFull2 / nCh - (sFull / nCh) ** 2;
const varRes = sRes2 / nCh - (sRes / nCh) ** 2;
console.log(`  variance    picture ${varFull.toFixed(0)}, residual ${varRes.toFixed(0)}`);
console.log(`              ${(varRes / varFull * 100).toFixed(1)}% of the picture's contrast is finer than ${AT} can hold\n`);
console.log(`  A box filter is the kindest downscale there is, so these are FLOORS on what is lost.`);

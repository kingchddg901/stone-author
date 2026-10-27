// LOOK AT A MASTER. Downsample a tiled BigTIFF to a PNG you can open.
//
// Every master this app writes is a single-level tiled BigTIFF of up to 43 gigapixels, which no viewer
// will open - so the only way the picture has ever been inspected is by rendering it again at a size a
// screen can take. That is not the same artifact: it re-runs the engine instead of reading what was
// written. When two masters disagree, re-rendering cannot show you the disagreement.
//
// This reads the file. Each tile is inflated, box-reduced to CELL x CELL, and placed on the grid, so
// the thumbnail is made of the stored pixels and nothing else. A box reduction over the whole tile is
// the honest one here: it is the average of every pixel, so a tile that is uniformly too bright reads
// as too bright rather than being sampled past.
//
//   node tools/thumb-master.mjs <master.tif> [more.tif ...] [--cell=64] [--out=dir]
//                                 [--region=x0,y0,x1,y1]
//
// `--region` reads only the tiles covering that rectangle, given as FRACTIONS of the whole picture.
// A full read is the honest default and stays the default; the flag exists because at 1,048,576 a
// whole master is 2.75 TB of inflate and 71 minutes, and a question about one disc does not need the
// other 89% of the frame. `--region=0.22,0.11,0.55,0.45` reads about a tenth of that.
//
// IT SNAPS OUT TO WHOLE TILES, which is not a rounding convenience. A cell of this thumbnail is the
// box mean of an ENTIRE tile, so half a tile has nothing to report; the window actually read comes
// back as `ext` and is printed every time, because a caller who asked for 0.22 and silently got 0.19
// would line the result up against the wrong rectangle. The output is named for the region too, so a
// partial read cannot be mistaken on disk for a picture of the whole master.
//
// Writes <name>.thumb.png beside each input, or into --out. With two or more inputs it also writes
// pair-wise difference thumbnails, amplified, because a 9-level shift over a whole picture is invisible
// side by side and obvious once it is the only thing on screen. The difference is |a-b| per channel,
// scaled by --gain (default 8) and clamped - so black is agreement and anything you can see is not.
import { openSync, readSync, closeSync, statSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { inflateSync } from 'zlib';
import { join, basename, dirname } from 'path';
import { encodePNG } from '../harness/png.mjs';

const INFLATE = new Set([8, 32946]);          // Adobe Deflate and the zip-style tag; both zlib streams

// The same reader check-same-image.mjs uses, kept to its shape deliberately: 322/323 for the tile
// shape, 324/325 for where each tile lives, 259 for how it was packed. Returns null for anything it
// cannot decode rather than guessing.
function tileIndex(path) {
  const fd = openSync(path, 'r');
  try {
    const at = (o, l) => { const b = Buffer.alloc(l); readSync(fd, b, 0, l, o); return b; };
    const h = at(0, 16);
    if (!(h[0] === 0x49 && h[1] === 0x49)) return null;
    const big = h.readUInt16LE(2) === 43;
    const u64 = (b, p) => b.readUInt32LE(p) + b.readUInt32LE(p + 4) * 4294967296;
    const ifd = big ? u64(h, 8) : h.readUInt32LE(4);
    if (!ifd) return null;
    const n = big ? u64(at(ifd, 8), 0) : at(ifd, 2).readUInt16LE(0);
    const entSz = big ? 20 : 12, ent = at(ifd + (big ? 8 : 2), n * entSz);
    const SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 16: 8, 17: 8, 18: 8 }, tags = {};
    for (let i = 0; i < n; i++) {
      const e = i * entSz, tag = ent.readUInt16LE(e), ty = ent.readUInt16LE(e + 2);
      const c = big ? u64(ent, e + 4) : ent.readUInt32LE(e + 4);
      const by = (SZ[ty] || 0) * c, inl = big ? 8 : 4, vAt = e + (big ? 12 : 8);
      const raw = by <= inl ? ent.subarray(vAt, vAt + by)
                            : at(big ? u64(ent, vAt) : ent.readUInt32LE(vAt), by);
      const v = [];
      for (let k = 0; k < c; k++)
        v.push(ty === 16 ? u64(raw, k * 8) : ty === 4 ? raw.readUInt32LE(k * 4)
             : ty === 3 ? raw.readUInt16LE(k * 2) : raw[k]);
      tags[tag] = v;
    }
    const offs = tags[324], cnts = tags[325];
    if (!offs || !cnts || !offs.length || offs.length !== cnts.length) return null;
    return { offs, cnts, comp: (tags[259] && tags[259][0]) || 1,
             tw: tags[322] && tags[322][0], th: tags[323] && tags[323][0],
             W: tags[256] && tags[256][0], H: tags[257] && tags[257][0],
             spp: (tags[277] && tags[277][0]) || 4 };
  } catch (e) { return null; } finally { closeSync(fd); }
}

function thumbOf(path, CELL, REG) {
  const ix = tileIndex(path);
  if (!ix) return { err: 'cannot read the tile directory - not a little-endian tiled TIFF this app wrote' };
  if (!INFLATE.has(ix.comp)) return { err: 'compression ' + ix.comp + ' is not deflate' };
  const across = Math.ceil(ix.W / ix.tw), down = Math.ceil(ix.H / ix.th);
  const gx0 = REG ? Math.max(0, Math.floor(REG[0] * ix.W / ix.tw)) : 0;
  const gy0 = REG ? Math.max(0, Math.floor(REG[1] * ix.H / ix.th)) : 0;
  const gx1 = REG ? Math.min(across - 1, Math.ceil(REG[2] * ix.W / ix.tw) - 1) : across - 1;
  const gy1 = REG ? Math.min(down - 1, Math.ceil(REG[3] * ix.H / ix.th) - 1) : down - 1;
  if (gx1 < gx0 || gy1 < gy0) return { err: 'that region covers no whole tile of this master' };
  const cols = gx1 - gx0 + 1, rows = gy1 - gy0 + 1;
  const tw = cols * CELL, th = rows * CELL;
  const out = new Uint8Array(tw * th * 4);
  const fd = openSync(path, 'r');
  let read = 0, blank = 0, skipped = 0;
  try {
    for (let t = 0; t < ix.offs.length && t < across * down; t++) {
      const gx = t % across, gy = (t / across) | 0;
      if (gx < gx0 || gx > gx1 || gy < gy0 || gy > gy1) { skipped++; continue; }
      if (!ix.cnts[t]) { blank++; continue; }
      const raw = Buffer.alloc(ix.cnts[t]);
      readSync(fd, raw, 0, ix.cnts[t], ix.offs[t]);
      let px;
      try { px = inflateSync(raw); } catch (_) { blank++; continue; }
      read++;
      // BOX-REDUCE THE WHOLE TILE. Every stored pixel contributes, so a uniform shift survives the
      // reduction - which is the entire point of looking at the file rather than re-rendering it.
      const sx = ix.tw / CELL, sy = ix.th / CELL, spp = ix.spp;
      for (let cy = 0; cy < CELL; cy++) {
        const y0 = Math.floor(cy * sy), y1 = Math.min(ix.th, Math.floor((cy + 1) * sy));
        for (let cx = 0; cx < CELL; cx++) {
          const x0 = Math.floor(cx * sx), x1 = Math.min(ix.tw, Math.floor((cx + 1) * sx));
          let r = 0, g = 0, b = 0, a = 0, n = 0;
          for (let y = y0; y < y1; y++) {
            let p = (y * ix.tw + x0) * spp;
            for (let x = x0; x < x1; x++, p += spp) {
              r += px[p]; g += px[p + 1]; b += px[p + 2]; a += spp > 3 ? px[p + 3] : 255; n++;
            }
          }
          if (!n) continue;
          const o = (((gy - gy0) * CELL + cy) * tw + (gx - gx0) * CELL + cx) * 4;
          out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
        }
      }
    }
  } finally { closeSync(fd); }
  return { w: tw, h: th, rgba: out, tiles: ix.offs.length - skipped, grid: [cols, rows],
           W: ix.W, H: ix.H, tile: ix.tw, read, blank, skipped,
           ext: [gx0 * ix.tw / ix.W, gy0 * ix.th / ix.H,
                 Math.min(1, (gx1 + 1) * ix.tw / ix.W), Math.min(1, (gy1 + 1) * ix.th / ix.H)] };
}

const args = process.argv.slice(2);
const files = args.filter(a => !a.startsWith('--'));
const num = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? +a.slice(k.length + 3) : d; };
const str = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const CELL = num('cell', 64), GAIN = num('gain', 8), OUT = str('out', null);
// FAILS ON A BAD REGION RATHER THAN FALLING BACK TO THE WHOLE PICTURE. A silent fallback would read
// 2.75 TB when a tenth was asked for, and - worse - would answer a different question than the one
// that was put, with nothing on screen to say so.
const RAWREG = str('region', null);
let REGION = null;
if (RAWREG !== null) {
  const p = RAWREG.split(',').map(Number);
  if (p.length !== 4 || p.some(v => !isFinite(v)) || p.some(v => v < 0 || v > 1) || p[0] >= p[2] || p[1] >= p[3]) {
    console.error('--region wants x0,y0,x1,y1 as fractions of the picture, 0..1, with x0<x1 and y0<y1');
    process.exit(1);
  }
  REGION = p;
}
if (!files.length) { console.error('usage: node tools/thumb-master.mjs <master.tif> [...] [--cell=64] [--gain=8] [--out=dir] [--region=x0,y0,x1,y1]'); process.exit(1); }
if (OUT && !existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const made = [];
for (const f of files) {
  if (!existsSync(f)) { console.error(f + ': not found'); process.exit(1); }
  const name = basename(f).replace(/\.tiff?$/i, '');
  const t = thumbOf(f, CELL, REGION);
  if (t.err) { console.error(name + ': ' + t.err); process.exit(1); }
  const tag = REGION ? '.r' + t.ext.map(v => v.toFixed(3)).join('_') : '';
  const dest = join(OUT || dirname(f), name + tag + '.thumb.png');
  writeFileSync(dest, encodePNG(t.w, t.h, t.rgba));
  // A MEAN OVER THE THUMBNAIL, not over the file. It will not equal the master's own light.mean - that
  // one samples every 100th pixel of the full picture - so it is reported as its own number and never
  // compared with the recorded one.
  let s = 0; for (let i = 0; i < t.rgba.length; i += 4) s += Math.max(t.rgba[i], t.rgba[i + 1], t.rgba[i + 2]);
  console.log(`${name}\n  ${t.W}x${t.H} tile ${t.tile} -> ${t.w}x${t.h} (${t.grid[0]}x${t.grid[1]} cells of ${CELL})`
    + `  tiles read ${t.read}/${t.tiles}${t.blank ? ', ' + t.blank + ' unreadable' : ''}  thumb peak-mean ${(s / (t.rgba.length / 4)).toFixed(2)}`
    + (REGION ? `\n  REGION x ${t.ext[0].toFixed(3)}-${t.ext[2].toFixed(3)}, y ${t.ext[1].toFixed(3)}-${t.ext[3].toFixed(3)}`
        + ` (asked ${REGION[0]}-${REGION[2]}, ${REGION[1]}-${REGION[3]}; snapped out to whole tiles)`
        + `  ${t.skipped} tile(s) not read` : '')
    + `\n  -> ${dest}`);
  made.push({ name, t, dest });
}

for (let i = 0; i < made.length; i++) for (let j = i + 1; j < made.length; j++) {
  const A = made[i], B = made[j];
  if (A.t.w !== B.t.w || A.t.h !== B.t.h) { console.log(`(no diff for ${A.name} vs ${B.name}: different grids)`); continue; }
  const d = new Uint8Array(A.t.w * A.t.h * 4);
  let worst = 0, moved = 0;
  for (let p = 0; p < d.length; p += 4) {
    const e = [0, 1, 2].map(k => Math.abs(A.t.rgba[p + k] - B.t.rgba[p + k]));
    const m = Math.max(...e); if (m > worst) worst = m; if (m) moved++;
    for (const k of [0, 1, 2]) d[p + k] = Math.min(255, e[k] * GAIN);
    d[p + 3] = 255;
  }
  const dest = join(OUT || dirname(files[0]), A.name + '__vs__' + B.name + '.diff.png');
  writeFileSync(dest, encodePNG(A.t.w, A.t.h, d));
  console.log(`diff ${A.name} vs ${B.name}\n  ${moved} of ${d.length / 4} cells moved, worst channel delta ${worst} (shown at ${GAIN}x)\n  -> ${dest}`);
}

// ADD PYRAMID LEVELS TO A MASTER THAT WAS WRITTEN WITHOUT THEM.
//
// Every master this app has written is a single-level tiled BigTIFF, so a viewer must decode the whole
// picture to show any of it - which past a few gigapixels no viewer can. Overview levels fix that: a
// reduced copy at each halving, so a viewer opens the smallest and fetches full-resolution tiles only
// where you zoom.
//
// WHY THIS CAN APPEND RATHER THAN REWRITE. tiffLayout puts the tile data first and the directory, the
// offset arrays, the description and the JSON block all in the TAIL:
//
//   header(16) | tile data | gap | IFD | desc | TileOffsets[] | TileByteCounts[] | JSON block
//
// Nothing structural lives among the pixels. So this truncates at the last tile's end, appends the new
// levels, and writes a fresh tail - existing pixels are never rewritten and no second copy of the file
// is needed, which matters at 58 GB where there is no room for one.
//
// THE TAIL IS BACKED UP BEFORE IT IS DESTROYED. Appending means overwriting the old tail before the new
// one exists, and a crash in that window leaves a file with sound pixels and no directory. The old tail
// goes to <file>.tailbak first and is removed only on success; --restore puts it back.
//
// THE REDUCER IS LIFTED FROM THE APP, not reimplemented. A retrofitted master and one built with levels
// from the start must agree byte for byte, and two implementations of "box filter" will not.
//
//   node tools/add-overviews.mjs <master.tif> [--stop 2048] [--dry-run]
//   node tools/add-overviews.mjs <master.tif> --restore
import { openSync, readSync, writeSync, closeSync, statSync, existsSync, unlinkSync,
         ftruncateSync } from 'fs';
import { inflateSync, deflateSync } from 'zlib';
import { loadReducer, levels } from './lib/pyramid.mjs';
import { locateMeta } from './lib/find-meta.mjs';

const reduce2 = loadReducer();

// THE REDUCER KNOWS RGBA AND THAT STAYS TRUE. It is lifted from the app rather than reimplemented,
// because a retrofitted master and one built with levels from the start have to agree byte for byte
// and two box filters will not. A master is three channels since the alpha drop, so the tiles are
// widened for the reducer and narrowed again before they are written - the reducer itself is
// untouched, and the result is the same bytes it would have produced.
//
// EXACT, NOT CLOSE. A box filter treats channels independently and a constant alpha averages to
// itself, so widening with 255, reducing, and dropping the fourth channel gives precisely the RGB
// that reducing RGB directly would. That is the whole reason this is allowed to cost two copies a
// tile rather than a second implementation.
const widen = (px, spp) => {
  if (spp === 4) return px;
  const n = (px.length / 3) | 0, out = new Uint8Array(n * 4);
  for (let i = 0, o = 0; o < out.length; i += 3, o += 4) {
    out[o] = px[i]; out[o + 1] = px[i + 1]; out[o + 2] = px[i + 2]; out[o + 3] = 255;
  }
  return out;
};
const narrow = (px, spp) => {
  if (spp === 4) return px;
  const n = (px.length / 4) | 0, out = new Uint8Array(n * 3);
  for (let i = 0, o = 0; o < out.length; i += 4, o += 3) {
    out[o] = px[i]; out[o + 1] = px[i + 1]; out[o + 2] = px[i + 2];
  }
  return out;
};
const args = process.argv.slice(2);
const path = args.find(a => !a.startsWith('--'));
const DRY = args.includes('--dry-run');
const RESTORE = args.includes('--restore');
const STOP = (() => { const i = args.indexOf('--stop'); return i < 0 ? 2048 : +args[i + 1] || 2048; })();
if (!path) {
  console.error('usage: node tools/add-overviews.mjs <master.tif> [--stop 2048] [--dry-run] [--restore]');
  process.exit(2);
}
const BAK = path + '.tailbak';
const num = n => n.toLocaleString();
const gb = n => (n / 1e9).toFixed(2) + ' GB';

const fd = openSync(path, RESTORE || DRY ? 'r' : 'r+');
const rd = (o, l) => { const b = Buffer.alloc(l); readSync(fd, b, 0, l, o); return b; };
const u64 = (b, p) => b.readUInt32LE(p) + b.readUInt32LE(p + 4) * 4294967296;
const put64 = (b, p, v) => { b.writeUInt32LE(v % 4294967296, p); b.writeUInt32LE(Math.floor(v / 4294967296), p + 4); };

const head = rd(0, 16);
if (head.toString('latin1', 0, 2) !== 'II' || head.readUInt16LE(2) !== 43) {
  console.error('not a little-endian BigTIFF'); process.exit(1);
}
const ifd0At = u64(head, 8);
const nEnt = u64(rd(ifd0At, 8), 0);
const entBuf = rd(ifd0At + 8, nEnt * 20);
const nextIfd = u64(rd(ifd0At + 8 + nEnt * 20, 8), 0);
const SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 16: 8, 17: 8, 18: 8 };
const tags = new Map();
for (let i = 0; i < nEnt; i++) {
  const e = i * 20, tag = entBuf.readUInt16LE(e), ty = entBuf.readUInt16LE(e + 2), c = u64(entBuf, e + 4);
  const bytes = (SZ[ty] || 0) * c;
  const raw = bytes <= 8 ? entBuf.subarray(e + 12, e + 12 + bytes) : rd(u64(entBuf, e + 12), bytes);
  const v = [];
  for (let k = 0; k < c; k++)
    v.push(ty === 16 ? u64(raw, k * 8) : ty === 4 ? raw.readUInt32LE(k * 4)
         : ty === 3 ? raw.readUInt16LE(k * 2) : raw[k]);
  tags.set(tag, { ty, v, raw });
}
const T0 = t => (tags.get(t) ? tags.get(t).v[0] : undefined);
const W = T0(256), H = T0(257), TW = T0(322), TH = T0(323), SPP = T0(277), COMP = T0(259);
const offs0 = tags.get(324).v, cnts0 = tags.get(325).v;
const END = offs0.reduce((m, o, i) => Math.max(m, o + cnts0[i]), 16);

if (RESTORE) {
  closeSync(fd);
  if (!existsSync(BAK)) { console.error('no ' + BAK + ' to restore from'); process.exit(1); }
  const n = statSync(BAK).size;
  const f2 = openSync(path, 'r+'), b = openSync(BAK, 'r');
  const buf = Buffer.alloc(n); readSync(b, buf, 0, n, 0);
  ftruncateSync(f2, END);
  writeSync(f2, buf, 0, n, END);
  closeSync(b); closeSync(f2); unlinkSync(BAK);
  console.log('restored ' + num(n) + ' bytes of tail; the file is as it was');
  process.exit(0);
}

// REFUSALS, BEFORE ANYTHING IS TOUCHED. Each one is a thing this cannot do rather than a thing it
// would rather not: a wrong guess here destroys a tail it has already taken.
const refuse = m => { console.error('refused: ' + m); closeSync(fd); process.exit(1); };
if (nextIfd !== 0) refuse('this master already has more than one directory - levels may already be here');
if (!TW || !TH) refuse('not a tiled TIFF');
if (COMP !== 8) refuse('compression ' + COMP + ' is not Adobe Deflate, which is all this writes');
if (SPP !== 4 && SPP !== 3) refuse(SPP + ' samples per pixel; this knows RGB and RGBA');
if (TW !== TH) refuse('non-square tiles are not mapped');
if (existsSync(BAK)) refuse(BAK + ' exists - a previous run died. --restore first, or delete it.');

const meta = locateMeta(path);
if (!meta) refuse('no JSON provenance block - this may not be a master from this studio');
const size0 = statSync(path).size;
const tailLen = size0 - END;
const LV = levels(W, H, TW, STOP);

console.log(path);
console.log('  ' + num(W) + ' x ' + num(H) + ', tiled ' + TW + ', ' + num(offs0.length) + ' tiles, ' + gb(size0));
console.log('  tile data ends at ' + num(END) + ', tail is ' + num(tailLen) + ' bytes');
console.log('  provenance block ' + num(meta.end - meta.start) + ' bytes, kept');
if (!LV.length) { console.log('  already at or under ' + STOP + 'px: nothing to add'); closeSync(fd); process.exit(0); }
console.log('  ' + LV.length + ' level(s): ' + LV.map(l => l.w + 'x' + l.h).join('  '));
if (DRY) { console.log('  --dry-run: nothing written'); closeSync(fd); process.exit(0); }

const metaText = rd(meta.start, meta.end - meta.start);
{ const bak = openSync(BAK, 'w'); const b = rd(END, tailLen); writeSync(bak, b, 0, tailLen, 0); closeSync(bak); }
console.log('  tail backed up to ' + BAK);

// EACH LEVEL IS BUILT FROM THE ONE ABOVE IT, not from the base. A level-L tile covers 2x2 tiles of
// level L-1, and reduce2 turns each of those into exactly one quadrant - so the mapping is four reads,
// four reductions and a blit, with no resampling across a tile seam.
let at = END;
let prev = { across: Math.ceil(W / TW), down: Math.ceil(H / TW), offs: offs0, cnts: cnts0 };
const built = [];
const t0 = Date.now();
for (const L of LV) {
  const offs = [], cnts = [], half = TW >> 1;
  for (let ty = 0; ty < L.down; ty++) {
    for (let tx = 0; tx < L.across; tx++) {
      const out = new Uint8Array(TW * TW * 4);
      for (let q = 0; q < 4; q++) {
        const sy = ty * 2 + (q >> 1), sx = tx * 2 + (q & 1);
        if (sy >= prev.down || sx >= prev.across) continue;      // past the grid: padding, left at zero
        const i = sy * prev.across + sx;
        const small = reduce2(widen(inflateSync(rd(prev.offs[i], prev.cnts[i])), SPP), TW, TW);
        const ox = (q & 1) * half, oy = (q >> 1) * half;
        for (let y = 0; y < half; y++)
          out.set(small.subarray(y * half * 4, (y + 1) * half * 4), ((oy + y) * TW + ox) * 4);
      }
      // NARROWED BEFORE THE DEFLATE, so a written level has the same sample count as the base it
      // came from - and the level above reads it back through widen() on the next pass.
      const w8 = narrow(out, SPP);
      const z = deflateSync(Buffer.from(w8.buffer, w8.byteOffset, w8.byteLength), { level: 6 });
      writeSync(fd, z, 0, z.length, at);
      offs.push(at); cnts.push(z.length); at += z.length;
    }
    process.stdout.write('\r  ' + L.w + 'x' + L.h + '  row ' + (ty + 1) + '/' + L.down + '      ');
  }
  built.push({ w: L.w, h: L.h, offs, cnts });
  prev = { across: L.across, down: L.down, offs, cnts };
  console.log('\r  ' + L.w + 'x' + L.h + '  ' + num(offs.length) + ' tiles, ' +
              gb(cnts.reduce((a, b) => a + b, 0)) + '              ');
}

// THE NEW TAIL: one directory per level, chained. BigTIFF is an 8-byte entry count, 20-byte entries and
// an 8-byte next-directory pointer; tags ascend, and a value of 8 bytes or fewer sits inline rather than
// behind an offset. Level 0 keeps its ImageDescription; the reduced levels carry NewSubfileType 1, which
// is what a reader looks for to know an overview from a page.
const SHORT = 3, LONG = 4, LONG8 = 16, ASCII = 2;
const pages = [{ w: W, h: H, offs: offs0, cnts: cnts0, reduced: false },
               ...built.map(b => ({ w: b.w, h: b.h, offs: b.offs, cnts: b.cnts, reduced: true }))];
const entriesFor = pg => {
  const e = [];
  const put = (tag, ty, count, inline, blob) => e.push({ tag, ty, count, inline, blob });
  if (pg.reduced) put(254, LONG, 1, b => b.writeUInt32LE(1, 0));
  put(256, LONG, 1, b => b.writeUInt32LE(pg.w, 0));
  put(257, LONG, 1, b => b.writeUInt32LE(pg.h, 0));
  put(258, SHORT, SPP, b => { for (let i = 0; i < SPP; i++) b.writeUInt16LE(8, i * 2); });
  put(259, SHORT, 1, b => b.writeUInt16LE(8, 0));
  put(262, SHORT, 1, b => b.writeUInt16LE(2, 0));
  if (!pg.reduced && tags.has(270))
    put(270, ASCII, tags.get(270).raw.length, null, tags.get(270).raw);
  put(277, SHORT, 1, b => b.writeUInt16LE(SPP, 0));
  put(284, SHORT, 1, b => b.writeUInt16LE(1, 0));
  put(322, LONG, 1, b => b.writeUInt32LE(TW, 0));
  put(323, LONG, 1, b => b.writeUInt32LE(TH, 0));
  put(324, LONG8, pg.offs.length, null, null);
  put(325, LONG8, pg.cnts.length, null, null);
  // ExtraSamples DESCRIBES THE FOURTH CHANNEL, so it is absent when there is not one. The entry
  // count here is derived from this array rather than declared, so dropping an entry needs no
  // second edit - which is the defect the app's own writer shipped when the alpha went.
  if (SPP === 4) put(338, SHORT, 1, b => b.writeUInt16LE(2, 0));
  put(339, SHORT, SPP, b => { for (let i = 0; i < SPP; i++) b.writeUInt16LE(1, i * 2); });
  return e;
};
const widthOf = (e, pg) => e.tag === 324 || e.tag === 325 ? pg.offs.length * 8
                         : e.tag === 270 ? e.count : SZ[e.ty] * e.count;
// TWO PASSES, because an entry has to know where its own data landed before it can point at it.
const tailAt = Math.ceil(at / 8) * 8;
const laid = [];
let p = tailAt;
for (const pg of pages) {
  const ents = entriesFor(pg);
  const rec = { pg, ents, ifdAt: p, far: new Map() };
  p += 8 + ents.length * 20 + 8;
  for (const e of ents) {
    const w = widthOf(e, pg);
    if (w > 8) { rec.far.set(e, p); p += Math.ceil(w / 8) * 8; }
  }
  laid.push(rec);
}
const tail = Buffer.alloc(p - tailAt);
const rel = o => o - tailAt;
laid.forEach((rec, i) => {
  put64(tail, rel(rec.ifdAt), rec.ents.length);
  let e = rel(rec.ifdAt) + 8;
  for (const ent of rec.ents) {
    tail.writeUInt16LE(ent.tag, e); tail.writeUInt16LE(ent.ty, e + 2);
    put64(tail, e + 4, ent.count);
    const far = rec.far.get(ent);
    if (far !== undefined) put64(tail, e + 12, far);
    else if (ent.inline) ent.inline(tail.subarray(e + 12, e + 20));
    else if (ent.tag === 324) put64(tail, e + 12, rec.pg.offs[0]);   // a one-tile level sits inline
    else if (ent.tag === 325) put64(tail, e + 12, rec.pg.cnts[0]);
    e += 20;
  }
  put64(tail, e, i + 1 < laid.length ? laid[i + 1].ifdAt : 0);
  for (const [ent, off] of rec.far) {
    const a = rel(off);
    if (ent.tag === 324) rec.pg.offs.forEach((v, k) => put64(tail, a + k * 8, v));
    else if (ent.tag === 325) rec.pg.cnts.forEach((v, k) => put64(tail, a + k * 8, v));
    else if (ent.tag === 270) ent.blob.copy(tail, a);
  }
});
if (tailAt > at) writeSync(fd, Buffer.alloc(tailAt - at), 0, tailAt - at, at);
writeSync(fd, tail, 0, tail.length, tailAt);
writeSync(fd, metaText, 0, metaText.length, tailAt + tail.length);
ftruncateSync(fd, tailAt + tail.length + metaText.length);
put64(head, 8, laid[0].ifdAt);
writeSync(fd, head, 0, 16, 0);               // the first-directory pointer moved with the tail
closeSync(fd);
unlinkSync(BAK);                             // only now: everything after this point is recoverable

const now = statSync(path).size;
console.log('');
console.log('  ' + pages.length + ' directories, first at ' + num(laid[0].ifdAt));
console.log('  ' + gb(now) + ' on disk, ' + ((now / size0 - 1) * 100).toFixed(1) + '% larger');
console.log('  ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');

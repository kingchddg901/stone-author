// The grid export: a picture rendered one tile at a time and written into a tiled BigTIFF.
//
// Three things are gated here, and only the first is visible in a screenshot.
//
// THE TILES JOIN. Neighbouring tiles are rendered independently, so the only thing making them agree is
// that each one is computed from the same geometry through the same transform, with enough bleed for the
// coat's widest blur to have real pixels to sample. Verified by eye at 10,922% on a four-tile corner of a
// 65535 master — no brightness step and, subtler, no phase shift in the grain, which would mean a
// sub-pixel error in the tile offset that is invisible at 100% and corrupts every boundary. That is what
// this protects: if the bleed multiplier, the transform or the crop ever drift, the join opens up.
//
// A TILE IS BIT-IDENTICAL IN ISOLATION. It is what makes a lost tile cost one tile. If rendering depended
// on anything accumulated from the tiles before it, recovery would silently produce a different picture.
//
// THE CONTAINER IS WELL-FORMED. Parsed back here rather than trusted: tags in ascending order, the
// declared tile count, and every tile inflating to exactly the bytes that went in. The parser shares no
// code with the writer, and the last check ablates it — a corrupted tile must go red, or none of the rest
// of this means anything.
//
//   node harness/inject.mjs && node harness/tiff.mjs
import { chromium } from 'playwright';
import { inflateSync } from 'zlib';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const hooked = pathToFileURL(join(here, 'dist', 'stone-author.hooked.html')).href;

// 1024 x 640 in 512px tiles is 2 across and 2 DOWN — so the bottom row is padded, which is the case TIFF
// demands and the one most likely to be written wrong.
const W = 1024, H = 640, TS = 512;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('page error:', e.message));
await page.goto(hooked);
await page.waitForFunction(() => !!window.__sa, null, { timeout: 15000 });

const res = await page.evaluate(async ({ W, H, TS }) => {
  const sa = window.__sa;
  sa.render();
  const bleed = Math.ceil(12 * (W / 1000));            // the coat's bleed at this width, as tiffPlan takes it
  const grab = (c, x, y, w, h) => c.getContext('2d').getImageData(x, y, w, h).data;

  // (a) the same region rendered as ONE tile and as TWO, to prove the join
  const one = sa.renderOneTile(W, 0, 0, TS * 2, TS, bleed);
  const oneL = grab(one, bleed, bleed, TS, TS), oneR = grab(one, bleed + TS, bleed, TS, TS);
  one.width = 1; one.height = 1;
  const a = sa.renderOneTile(W, 0, 0, TS, TS, bleed), b = sa.renderOneTile(W, TS, 0, TS, TS, bleed);
  const splitL = grab(a, bleed, bleed, TS, TS), splitR = grab(b, bleed, bleed, TS, TS);
  a.width = 1; a.height = 1; b.width = 1; b.height = 1;
  const diff = (p, q) => {
    let sum = 0, max = 0, off = 0, n = 0;
    for (let i = 0; i < p.length; i += 4) {
      let d = 0;
      for (let k = 0; k < 3; k++) { const v = Math.abs(p[i + k] - q[i + k]); if (v > d) d = v; }
      sum += d; if (d > max) max = d; if (d) off++; n++;
    }
    return { mean: sum / n, max, pct: 100 * off / n };
  };

  // (b) a tile rendered twice, second time alone — recovery must be exact
  const t1 = sa.renderOneTile(W, TS, 0, TS, TS, bleed);
  const px1 = grab(t1, bleed, bleed, TS, TS); t1.width = 1; t1.height = 1;
  let same = px1.length === splitR.length;
  for (let i = 0; same && i < px1.length; i++) if (px1[i] !== splitR[i]) same = false;

  // (c) a real tiled TIFF, and the raw tiles that went into it
  const raws = [], comp = [];
  for (let gy = 0; gy < Math.ceil(H / TS); gy++) for (let gx = 0; gx < Math.ceil(W / TS); gx++) {
    const c = sa.renderOneTile(W, gx * TS, gy * TS, TS, TS, bleed);
    const px = new Uint8Array(grab(c, bleed, bleed, TS, TS));
    c.width = 1; c.height = 1;
    raws.push(px); comp.push(await sa.deflateBytes(px));
  }
  const { blob } = sa.tiffTiled(W, H, TS, TS, comp, 'harness');
  const buf = new Uint8Array(await blob.arrayBuffer());
  const b64 = (u8) => { let s = ''; const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s); };
  const joined = new Uint8Array(raws.length * TS * TS * 4);
  raws.forEach((r, i) => joined.set(r, i * TS * TS * 4));
  return { bleed, tiles: comp.length, joinL: diff(oneL, splitL), joinR: diff(oneR, splitR),
           reRenderIdentical: same, tiff: b64(buf), rawTiles: b64(joined) };
}, { W, H, TS });
await browser.close();

const tiff = Buffer.from(res.tiff, 'base64');
const raw = Buffer.from(res.rawTiles, 'base64');
const fail = [];

// ---- the join -------------------------------------------------------------------------------------
// Measured at mean 0 with under 0.05% of pixels differing at all; the bar is set well above that so an
// ordinary rounding difference never goes red, and an actual seam always does.
for (const [side, d] of [['left', res.joinL], ['right', res.joinR]]) {
  if (!(d.mean <= 0.05)) fail.push(`${side} half: split tiles differ from one tile by mean ${d.mean.toFixed(4)} — a seam`);
  if (!(d.pct <= 1)) fail.push(`${side} half: ${d.pct.toFixed(2)}% of pixels differ across the join`);
}
if (!res.reRenderIdentical) fail.push('a tile re-rendered on its own is NOT identical — recovery would change the picture');

// ---- the container --------------------------------------------------------------------------------
const parse = (f) => {
  const u16 = p => f.readUInt16LE(p), u32 = p => f.readUInt32LE(p);
  const u64 = p => f.readUInt32LE(p) + f.readUInt32LE(p + 4) * 4294967296;
  if (f.toString('latin1', 0, 2) !== 'II') throw new Error('not little-endian');
  if (u16(2) !== 43) throw new Error(`version ${u16(2)}, expected 43 (BigTIFF)`);
  if (u16(4) !== 8) throw new Error(`offset size ${u16(4)}, expected 8`);
  const SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 16: 8, 17: 8, 18: 8 };
  const ifd = u64(8), n = u64(ifd), tags = {};
  let last = -1;
  for (let i = 0; i < n; i++) {
    const e = ifd + 8 + i * 20, tag = u16(e), type = u16(e + 2), count = u64(e + 4);
    if (tag <= last) throw new Error(`IFD entries out of order at tag ${tag}`);
    last = tag;
    const at = (SZ[type] || 0) * count <= 8 ? e + 12 : u64(e + 12);
    tags[tag] = { count, all: () => Array.from({ length: count }, (_, k) =>
      type === 3 ? u16(at + k * 2) : type === 4 ? u32(at + k * 4) : u64(at + k * 8)) };
  }
  return tags;
};
let tags = null;
try { tags = parse(tiff); } catch (e) { fail.push(`container: ${e.message}`); }
if (tags) {
  const need = { 256: W, 257: H, 259: 8, 262: 2, 277: 4, 322: TS, 323: TS };
  for (const [tag, want] of Object.entries(need)) {
    if (!tags[tag]) { fail.push(`missing tag ${tag}`); continue; }
    const got = tags[tag].all()[0];
    if (got !== want) fail.push(`tag ${tag} is ${got}, expected ${want}`);
  }
  const offs = tags[324] && tags[324].all(), cnts = tags[325] && tags[325].all();
  if (!offs || offs.length !== res.tiles) fail.push(`${offs ? offs.length : 0} tile offsets, expected ${res.tiles}`);
  else {
    const want = TS * TS * 4;
    for (let i = 0; i < offs.length; i++) {
      let px;
      try { px = inflateSync(tiff.subarray(offs[i], offs[i] + cnts[i])); }
      catch (e) { fail.push(`tile ${i} did not inflate: ${e.message}`); continue; }
      if (px.length !== want) { fail.push(`tile ${i} inflated to ${px.length}, expected ${want}`); continue; }
      if (!px.equals(raw.subarray(i * want, (i + 1) * want))) fail.push(`tile ${i} is not the pixels that went in`);
    }
  }
}

// ---- ablation: the parser must be able to fail ----------------------------------------------------
// A checker that passes on anything is worse than no checker, because silence reads as covered.
let bit = null;
try {
  const bad = Buffer.from(tiff); bad[tiff.length >> 1] ^= 0xFF;
  const t = parse(bad), o = t[324].all(), c = t[325].all();
  let caught = false;
  for (let i = 0; i < o.length && !caught; i++) {
    try {
      const px = inflateSync(bad.subarray(o[i], o[i] + c[i]));
      if (!px.equals(raw.subarray(i * TS * TS * 4, (i + 1) * TS * TS * 4))) caught = true;
    } catch (_) { caught = true; }
  }
  bit = caught;
} catch (_) { bit = true; }                        // a corrupt header failing the parse counts too
if (!bit) fail.push('ABLATION FAILED: a corrupted tile was not detected, so the checks above prove nothing');

for (const f of fail) console.error('  ' + f);
console.log(fail.length
  ? `TIFF grid: ${fail.length} failure(s).`
  : `TIFF grid: PASS — ${res.tiles} tiles at bleed ${res.bleed}, join mean ${res.joinL.mean.toFixed(4)}/`
    + `${res.joinR.mean.toFixed(4)}, a tile re-renders identically, every tile round-trips, and a corrupted one goes red.`);
process.exit(fail.length ? 1 : 0);

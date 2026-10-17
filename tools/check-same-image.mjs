// DO TWO RENDERS OF THE SAME SLAB AND LIGHT PRODUCE THE SAME PICTURE?
//
// Until now that claim rested on two numbers out of a master's metadata - light.mean and light.lit40,
// each to two decimal places - plus the `inputs` hash, which is a hash of the STATE THAT WENT IN and
// says nothing about the pixels that came out. Four renders can agree on all three and still differ,
// and the project has been publishing determinism claims on that basis.
//
// This compares the actual image bytes. A master is image data followed by a JSON self-description, and
// that description MUST differ between two renders: it carries `at`, `ms.render` and 10,240 per-tile
// timings. So the comparison runs over [0, metaStart) - the image - and the metadata is excluded by
// LOCATION rather than by hoping it compares equal.
//
// IT RUNS IN TWO STAGES, because the stored bytes are not the question. Masters are written with
// CompressionStream('deflate'), which exposes no level, so each platform's zlib picks its own: measured
// at level 6 under Blink and level 5 under WebKit. On 2026-10-15 that made one picture 895 MB on a
// desktop and 1,012 MB on an iPhone - 13% apart, on pixels that were identical to the bit across all
// 163,840 tiles. THIS TOOL CALLED THAT A DIFFERENT PICTURE, in those words: "a different length, so
// different pixels". It was the false alarm the tool exists to avoid, on the exact cross-engine claim
// it was written to support. So a stored-byte mismatch is now a QUESTION: the tiles are inflated and the
// pixels compared, and only a pixel difference is a difference.
//
// AND IT MAPS ONE TILING ONTO ANOTHER, because the tile size is the planner's business and not the
// picture's. One slab is tiled whatever each device can afford - 512 on a desktop, 1024 on a 2 GB
// tablet, 4096 where the texture limit allows - so a fleet rendering ONE picture produces masters at
// several tile sizes, and refusing to compare those refuses most of the fleet. Where the sizes divide,
// the larger tile IS a block of the smaller: a 1024 tile is a 2x2 of 512s, a 4096 tile an 8x8. Padding
// is excluded by location - a tile is always full size, two tilings pad different regions, and
// comparing that would report a difference the picture does not have.
//
//   node tools/check-same-image.mjs a.tif b.tif c.tif ...
//   node tools/check-same-image.mjs --selftest
//
// Files are grouped by their `inputs` hash, so a daylight and a black-light master of the same slab are
// never compared with each other - they SHOULD differ, and reporting that as a failure would be noise.
// Within a group, every file is compared against the first.
//
// NO REGEXES IN HERE ON PURPOSE. Five separate escapes were lost through generators while this
// session's tools were being written - \s and \b collapsing to bare letters, silently - so path
// splitting and every other bit of text handling below uses lastIndexOf and character comparison.
import { openSync, readSync, closeSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { inflateSync, deflateSync } from 'zlib';
import { locateMeta } from './lib/find-meta.mjs';
import { loadMark, onMark } from './lib/mark.mjs';

// THE MARK READER, OPTIONAL BY DESIGN. Positional marks are a property of the pictures this tool
// compares, not of this tool, so failing to lift them must never fail a comparison. If the app moves
// out from under it MK stays null, nothing below consults it, and every verdict is what it was.
let MK = null;
try { MK = loadMark(); } catch (_) { MK = null; }

const CHUNK = 8 << 20;
const NL = String.fromCharCode(10);
const SLASH = String.fromCharCode(47), BACKSLASH = String.fromCharCode(92);

function baseName(p) {
  const i = Math.max(p.lastIndexOf(SLASH), p.lastIndexOf(BACKSLASH));
  return i < 0 ? p : p.slice(i + 1);
}

// Compare the first `len` bytes of two files. Returns the first differing offset and how many of the
// bytes examined differ, so a one-byte flip and a wholly different picture do not read the same.
function compareRegion(pathA, pathB, len) {
  const fa = openSync(pathA, 'r'), fb = openSync(pathB, 'r');
  try {
    const ba = Buffer.alloc(CHUNK), bb = Buffer.alloc(CHUNK);
    let off = 0, firstDiff = -1, diffBytes = 0;
    while (off < len) {
      const want = Math.min(CHUNK, len - off);
      const ra = readSync(fa, ba, 0, want, off), rb = readSync(fb, bb, 0, want, off);
      const n = Math.min(ra, rb);
      if (n === 0) break;
      if (ba.compare(bb, 0, n, 0, n) !== 0) {
        for (let i = 0; i < n; i++) {
          if (ba[i] !== bb[i]) { if (firstDiff < 0) firstDiff = off + i; diffBytes++; }
        }
      }
      off += n;
    }
    return { firstDiff, diffBytes, examined: off };
  } finally { closeSync(fa); closeSync(fb); }
}

// WHERE THE IMAGE ACTUALLY ENDS: at the first IFD, not at the metadata block.
//
// Found by this tool firing on its first real run. Comparing [0, metaStart) reported 3 to 5 differing
// bytes between masters that are otherwise identical across 596 MB, every time at the same place. They
// were not pixels - they were IFD entries, and all three are DOWNSTREAM OF THE METADATA'S OWN LENGTH:
//
//   tag 0x010E ImageDescription  count = the metadata string length, which differs every render
//   tag 0x0144 TileOffsets       pointer, shifted by that length difference
//   tag 0x0145 TileByteCounts    pointer, shifted by that length difference
//
// The IFD sits between the tile data and the metadata, so [0, metaStart) swept it in. Two renders MUST
// differ there - `at`, `ms.render` and 10,240 per-tile timings make the block a different length - and
// reporting that as different pixels is a false alarm on the exact claim this tool exists to test.
// Returns 0 when the header is not a TIFF, and the caller falls back to the metadata offset.
function firstIfdOffset(path) {
  const fd = openSync(path, 'r');
  try {
    const h = Buffer.alloc(16);
    if (readSync(fd, h, 0, 16, 0) < 16) return 0;
    const le = h[0] === 0x49 && h[1] === 0x49, be = h[0] === 0x4D && h[1] === 0x4D;
    if (!le && !be) return 0;
    const magic = le ? h.readUInt16LE(2) : h.readUInt16BE(2);
    if (magic === 43) {                                  // BigTIFF: 8-byte offset at byte 8
      const v = le ? h.readBigUInt64LE(8) : h.readBigUInt64BE(8);
      return v > 0n && v < BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : 0;
    }
    if (magic === 42) return le ? h.readUInt32LE(4) : h.readUInt32BE(4);
    return 0;
  } catch (e) { return 0; } finally { closeSync(fd); }
}

// THE TILE INDEX, so the pixels can be compared instead of the bytes they happened to be stored as.
// Reads the IFD only: 322/323 for the tile shape, 324/325 for where each tile lives, 259 for how it was
// packed. Returns null for anything it cannot decode - a PNG master, an untiled TIFF, a big-endian file
// this project never writes - and the caller SAYS SO rather than treating "cannot tell" as "same".
const INFLATE = new Set([8, 32946]);        // Adobe Deflate and the zip-style tag; both are zlib streams
function tileIndex(path) {
  const fd = openSync(path, 'r');
  try {
    const at = (o, l) => { const b = Buffer.alloc(l); readSync(fd, b, 0, l, o); return b; };
    const h = at(0, 16);
    if (!(h[0] === 0x49 && h[1] === 0x49)) return null;      // little-endian only, which is what we write
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
    // W, H and the sample count come too, because a cross-tiling comparison needs the grid and the
    // row stride, and the picture edge needs to be known so padding can be left out of it.
    return { offs, cnts, comp: (tags[259] && tags[259][0]) || 1,
             tw: tags[322] && tags[322][0], th: tags[323] && tags[323][0],
             W: tags[256] && tags[256][0], H: tags[257] && tags[257][0],
             spp: (tags[277] && tags[277][0]) || 4 };
  } catch (e) { return null; } finally { closeSync(fd); }
}

// DO TWO MASTERS HOLD THE SAME PIXELS, however they were packed? Tile for tile, inflated. Slow on
// purpose - a 43-gigapixel pair takes about three and a half minutes and reads 1.9 GB twice - which is
// why it runs ONLY after the cheap stored-byte comparison has already failed. An unreadable index is
// reported as unreadable; it is never reported as agreement.
// DO THE TWO FILES PLACE THEIR TILES THE SAME WAY? Not what the tiles hold - where the directory says
// each one IS. Added 2026-10-16 after a deliberately broken resume transposed two entries in the tile
// directory and this tool called the result IDENTICAL: the tile DATA was untouched, byte for byte at
// the same offsets, and only the mapping from index to offset had changed. The compared region ends at
// the first IFD, and TileOffsets and TileByteCounts live AFTER it, so the one thing that had changed
// was the one thing nothing looked at.
//
// Two files holding the same bytes in a different ORDER are not the same picture. Stage two already
// knew that - comparePixels walks tag 324 and compares tile i against tile i - but it only ran when the
// region comparison failed, and a transposition is invisible there. So the directories are checked
// before stage one is allowed to settle anything.
function sameDirectory(pa, pb) {
  const A = tileIndex(pa), B = tileIndex(pb);
  if (!A || !B) return true;                   // not readable here: stage two will say so properly
  if (A.offs.length !== B.offs.length) return false;
  for (let i = 0; i < A.offs.length; i++)
    if (A.offs[i] !== B.offs[i] || A.cnts[i] !== B.cnts[i]) return false;
  return true;
}

function comparePixels(pa, pb) {
  const A = tileIndex(pa), B = tileIndex(pb);
  if (!A || !B) return { error: 'no readable tile index in ' + baseName(!A ? pa : pb) };
  if (A.comp !== B.comp) return { error: 'packed differently - codec ' + A.comp + ' against ' + B.comp };
  if (A.comp !== 1 && !INFLATE.has(A.comp)) return { error: 'codec ' + A.comp + ' is not one this can unpack' };
  if (A.W !== B.W || A.H !== B.H)
    return { error: 'a different picture size - ' + A.W + 'x' + A.H + ' against ' + B.W + 'x' + B.H };
  if (A.spp !== B.spp) return { error: 'a different sample count - ' + A.spp + ' against ' + B.spp };
  if (A.tw !== A.th || B.tw !== B.th) return { error: 'non-square tiles are not mapped' };
  // THE TILE SIZE IS THE PLANNER'S BUSINESS, NOT THE PICTURE'S. One slab is tiled whatever each device
  // can afford - 512 on a desktop, 1024 on a 2 GB tablet, 4096 where the texture limit allows - so
  // refusing to compare two tilings refuses most of a real fleet. Where the sizes divide, the larger
  // tile IS a block of the smaller: a 1024 tile is a 2x2 of 512s, a 4096 tile an 8x8. Small first, so
  // the mapping only ever runs one way, and ratio 1 falls through the same loop as the equal case.
  const small = A.tw <= B.tw, S = small ? A : B, L = small ? B : A;
  const ps = small ? pa : pb, pl = small ? pb : pa;
  const ratio = L.tw / S.tw;
  if (!Number.isInteger(ratio))
    return { error: 'tile sizes ' + S.tw + ' and ' + L.tw + ' do not divide' };
  const Scols = Math.ceil(S.W / S.tw), Srows = Math.ceil(S.H / S.tw);
  const Lcols = Math.ceil(L.W / L.tw), Lrows = Math.ceil(L.H / L.tw);
  if (S.offs.length !== Scols * Srows || L.offs.length !== Lcols * Lrows)
    return { error: 'the tile count does not match the grid the header describes' };
  const fs_ = openSync(ps, 'r'), fl = openSync(pl, 'r');
  try {
    const grab = (fd, o, l) => { const b = Buffer.alloc(l); readSync(fd, b, 0, l, o); return b; };
    const open = S.comp === 1 ? (b => b) : (b => inflateSync(b));
    const Srow = S.tw * S.spp, Lrow = L.tw * L.spp;
    let diff = 0, bytes = 0, firstTile = -1, worst = 0, diffBytes = 0, markShaped = 0;
    for (let lr = 0; lr < Lrows; lr++) {
      for (let lc = 0; lc < Lcols; lc++) {
        const li = lr * Lcols + lc;
        const lb = open(grab(fl, L.offs[li], L.cnts[li]));
        let bad = false;
        for (let qy = 0; qy < ratio; qy++) for (let qx = 0; qx < ratio; qx++) {
          const sr = lr * ratio + qy, sc = lc * ratio + qx;
          if (sr >= Srows || sc >= Scols) continue;
          // PADDING IS NOT THE PICTURE. A TIFF tile is always full size, so the right and bottom edges
          // carry padding - and two tilings pad DIFFERENT regions, which would read as a difference the
          // picture does not have. Only bytes inside W x H are compared.
          const x0 = sc * S.tw, y0 = sr * S.tw;
          const validW = Math.min(S.tw, S.W - x0) * S.spp, validR = Math.min(S.tw, S.H - y0);
          if (validW <= 0 || validR <= 0) continue;
          const si = sr * Scols + sc, sb = open(grab(fs_, S.offs[si], S.cnts[si]));
          bytes += validW * validR;
          for (let r = 0; r < validR; r++) {
            const so = r * Srow, lo = (qy * S.tw + r) * Lrow + qx * Srow;
            if (lb.compare(sb, so, so + validW, lo, lo + validW) !== 0) {
              bad = true;
              const ay = y0 + r;
              for (let k = 0; k < validW; k++) {
                const d = Math.abs(lb[lo + k] - sb[so + k]);
                if (!d) continue;
                diffBytes++;
                if (d > worst) worst = d;
                // IS THIS BYTE SHAPED LIKE A MARK? Blue, on a cell's bottom row, inside the marked
                // span, and moved by exactly one. All four together, or it is an ordinary difference.
                if (MK && d === 1 && k % S.spp === 2 && onMark(MK, x0 + ((k / S.spp) | 0), ay)) markShaped++;
              }
            }
          }
        }
        if (bad) { diff++; if (firstTile < 0) firstTile = li; }
      }
    }
    return { diff, tiles: L.offs.length, bytes, firstTile, worst, ratio, sTile: S.tw, lTile: L.tw,
             diffBytes, markShaped };
  } catch (e) { return { error: 'inflating: ' + e.message }; } finally { closeSync(fs_); closeSync(fl); }
}

// WHAT A MASTER SAYS ABOUT ITSELF. Reads its first tile and asks the app's own markRead what is there.
// null means no mark this build understands: an unmarked master, or another scheme entirely. Said apart
// from 'moved', because treating absence as misplacement would condemn every master rendered before
// marking existed - which is all of docs/sidecars.
// HOW MANY DIRECTORIES. One is a plain master; more means overview levels, which change the stored
// size without changing a pixel of the base.
function pages(path) {
  try {
    const fd = openSync(path, 'r');
    try {
      const h = Buffer.alloc(16); readSync(fd, h, 0, 16, 0);
      let at = h.readUInt32LE(8) + h.readUInt32LE(12) * 4294967296, n = 0;
      while (at && n < 64) {
        const c = Buffer.alloc(8); readSync(fd, c, 0, 8, at);
        const ents = c.readUInt32LE(0) + c.readUInt32LE(4) * 4294967296;
        const nx = Buffer.alloc(8); readSync(fd, nx, 0, 8, at + 8 + ents * 20);
        at = nx.readUInt32LE(0) + nx.readUInt32LE(4) * 4294967296; n++;
      }
      return n;
    } finally { closeSync(fd); }
  } catch (_) { return 1; }
}
function markState(path) {
  if (!MK) return null;
  try {
    const T = tileIndex(path);
    if (!T || !T.offs.length) return null;
    const fd = openSync(path, 'r');
    try {
      const b = Buffer.alloc(T.cnts[0]);
      readSync(fd, b, 0, T.cnts[0], T.offs[0]);
      const px = T.comp === 1 ? b : inflateSync(b);
      for (const c of MK.markRead(px, T.tw, 0, 0))
        if (c.present && c.got.ver === MK.MARK_VER) return c.got;
    } finally { closeSync(fd); }
  } catch (_) { /* a master this cannot unpack simply has nothing to say */ }
  return null;
}

function describe(path) {
  const loc = locateMeta(path);
  if (!loc) return { path, error: 'no metadata block - not a master this tool can read' };
  const m = loc.meta;
  const ifd = firstIfdOffset(path);
  // The image ends at whichever comes first, and never past the metadata.
  const imageLen = ifd > 0 && ifd < loc.start ? ifd : loc.start;
  return {
    path, size: statSync(path).size, imageLen, ifd, metaStart: loc.start, metaLen: loc.end - loc.start,
    inputs: m.inputs, spectrum: m.spectrum, mean: m.light && m.light.mean,
    ms: m.ms && m.ms.render, at: m.at,
  };
}

const lightOf = f => (f.spectrum === 0 ? 'daylight' : 'spectrum ' + f.spectrum);

function run(paths, quiet) {
  const files = paths.map(describe);
  for (const f of files) if (f.error) console.log('SKIPPED  ' + f.path + '  ' + f.error);
  const good = files.filter(f => !f.error);
  if (good.length < 2) { console.log('need at least two readable masters'); return 2; }

  const groups = new Map();
  for (const f of good) {
    if (!groups.has(f.inputs)) groups.set(f.inputs, []);
    groups.get(f.inputs).push(f);
  }

  let failures = 0, compared = 0;
  for (const [inputs, g] of groups) {
    g.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    console.log('inputs ' + inputs + '   ' + lightOf(g[0]) + '   ' + g.length +
      ' master' + (g.length === 1 ? '' : 's'));
    for (const f of g) {
      console.log('    ' + baseName(f.path) + '   ' + (f.size / 1048576).toFixed(2) + ' MB   image ' +
        f.imageLen + (f.ifd ? '' : ' (no IFD, to metadata)') + '   meta ' + f.metaLen + '   mean ' + f.mean +
        (f.ms ? '   ' + (f.ms / 60000).toFixed(2) + ' min' : ''));
    }
    if (g.length === 1) { console.log('    only one in this group, nothing to compare' + NL); continue; }
    const ref = g[0];
    for (const f of g.slice(1)) {
      compared++;
      // STAGE ONE, the fast path: two masters from one engine pack identically and settle here in
      // seconds over the whole region. Agreement here is conclusive and needs nothing further.
      let r = null;
      if (f.imageLen === ref.imageLen) {
        r = compareRegion(ref.path, f.path, ref.imageLen);
        // THE DIRECTORY TOO, before this is allowed to mean anything. Identical bytes in a different
        // order is a different picture, and it is exactly what a broken resume produces.
        if (r.firstDiff < 0 && sameDirectory(ref.path, f.path)) {
          console.log('    IDENTICAL  ' + baseName(f.path) + '   ' + r.examined + ' image bytes, byte for byte');
          continue;
        }
        if (r.firstDiff < 0) {
          console.log('    DIFFERS  ' + baseName(f.path) + '   the tile data is identical but the tile' +
                      ' DIRECTORY is not - the same bytes placed differently is a different picture');
          failures++; continue;
        }
      }
      // STAGE TWO: the stored bytes disagree, which is not yet a verdict. Different deflate levels pack
      // identical pixels to different lengths, so the only honest next question is what the tiles hold.
      const px = comparePixels(ref.path, f.path);
      if (px.error) {
        // Fall back to what stage one saw. A master this cannot unpack still differs in its stored
        // bytes, and the byte-level finding is the most that can honestly be said about it.
        if (r) {
          console.log('    DIFFERS  ' + baseName(f.path) + '   first at byte ' + r.firstDiff + ', ' +
            r.diffBytes + ' of ' + r.examined + ' differ (' +
            (100 * r.diffBytes / r.examined).toFixed(4) + '%)');
        } else {
          console.log('    DIFFERS  ' + baseName(f.path) + '   image region is ' + f.imageLen +
            ' bytes against ' + ref.imageLen + ', and the pixels could not be compared: ' + px.error);
        }
        failures++; continue;
      }
      if (px.diff === 0) {
        console.log('    IDENTICAL  ' + baseName(f.path) + '   ' + px.tiles + ' tiles, ' +
          (px.bytes / 1073741824).toFixed(2) + ' GiB of pixels, byte for byte after inflation');
        // WHY IT IS BIGGER, SAID CORRECTLY. This read 'that is the compressor' whatever the cause, and
        // since 2026-10-16 a master can carry overview levels: a retrofitted 65,535 came out 66.1%
        // larger with its base byte-identical, and this line blamed deflate for pixels it had never
        // seen. The directory count is what tells the two apart.
        const bigWhy = pages(f.path) > pages(ref.path) ? 'that is the overview levels, not the compressor'
                     : pages(ref.path) > pages(f.path) ? 'the OTHER master carries overview levels'
                     : 'that is the compressor, not the picture';
        console.log('               stored image region differs by ' + (f.imageLen - ref.imageLen) +
          ' bytes (' + (100 * (f.imageLen / ref.imageLen - 1)).toFixed(1) + '%) - ' + bigWhy);
        continue;
      }
      console.log('    DIFFERS  ' + baseName(f.path) + '   ' + px.diff + ' of ' + px.tiles +
        ' tiles differ after inflation, first at tile ' + px.firstTile +
        (px.worst ? ', worst byte delta ' + px.worst : ''));
      // THE MARKED-AGAINST-UNMARKED PAIR, NAMED. Marking is on by default, so every comparison
      // against a master rendered before it lands here - and a bare DIFFERS makes that look like a
      // determinism failure when it is an era boundary. It stays a FAILURE: the files do differ, and
      // a gate that forgave it would forgive a real one. It just says which it is.
      if (px.diffBytes > 0 && px.markShaped === px.diffBytes) {
        const a = markState(ref.path), b = markState(f.path);
        console.log('             every differing byte is blue, on a cell mark row, and moved by one.');
        if (!a !== !b) {
          const m = a ? ref : f, u = a ? f : ref;
          console.log('             ' + baseName(m.path) + ' carries positional marks (picture ' +
                      (a || b).sig + '); ' + baseName(u.path) + ' carries none.');
          console.log('             The same picture either side of the day marking went on. Render');
          console.log('             with ?mark=0 to reproduce the unmarked one.');
        } else if (a && b && a.sig !== b.sig) {
          console.log('             both carry marks, but they name different pictures: ' +
                      a.sig + ' and ' + b.sig + '.');
        } else {
          console.log('             both sides agree on marking, so the picture itself differs.');
        }
      }
      failures++;
    }
    console.log('');
  }

  // Size ACROSS groups is a different question from identity within one, and worth printing because
  // it is the thing a person eyeballs: a black-light and a daylight master of one slab compress to
  // roughly the same size or they do not, and neither answer is a fault.
  if (groups.size > 1) {
    console.log('across lights, mean file size:');
    const sizes = [];
    for (const [inputs, g] of groups) {
      const mb = g.reduce((a, f) => a + f.size, 0) / g.length / 1048576;
      sizes.push(mb);
      console.log('  ' + inputs + '  ' + lightOf(g[0]).padEnd(14) + mb.toFixed(2) + ' MB   (n=' + g.length + ')');
    }
    const lo = Math.min(...sizes), hi = Math.max(...sizes);
    console.log('  spread ' + (hi - lo).toFixed(2) + ' MB, ' + (100 * (hi / lo - 1)).toFixed(1) + '%');
  }

  if (!quiet) {
    console.log(NL + compared + ' comparison' + (compared === 1 ? '' : 's') + ', ' +
      (failures ? failures + ' DIFFERED' : 'every same-light group is byte-identical'));
  }
  return failures ? 1 : 0;
}

// PROVE IT CAN GO RED. A comparison tool that only ever prints IDENTICAL is indistinguishable from
// one that does not read the files at all. Each case below is built to a known answer and asserted.
function selftest() {
  const dir = mkdtempSync(join(tmpdir(), 'same-image-'));
  const meta = i => '{"tool":"stone-author","inputs":"deadbeef","spectrum":0,"at":"2026-01-0' + i +
    'T00:00:00Z","ms":{"render":1000},"light":{"mean":1.0}}';
  const make = (name, image, i) => {
    const p = join(dir, name);
    writeFileSync(p, Buffer.concat([image, Buffer.from(meta(i), 'latin1')]));
    return p;
  };
  // A MINIMAL BIGTIFF, because the stage-two path reads a real IFD and a flat buffer cannot exercise it.
  // Laid out the way a master is: header, tile data, the two out-of-line arrays, the IFD, then the JSON
  // block appended last - so the IFD sits between the pixels and the metadata exactly as it does in the
  // files this tool is pointed at.
  const u64 = v => { const b = Buffer.alloc(8); b.writeUInt32LE(v % 4294967296, 0);
                     b.writeUInt32LE(Math.floor(v / 4294967296), 4); return b; };
  // Cuts its own tiles from a whole image, because the TILING is the thing under test: the same pixels
  // have to be expressible at two tile sizes, and a TIFF tile is always FULL SIZE with the edge padded.
  // `padByte` fills that padding, so a case can make two tilings disagree in padding alone and require
  // the comparison to ignore it.
  const SPP = 4;
  const bigTiff = (name, img, W, H, TS, level, i, padByte = 0, swap = null) => {
    const cols = Math.ceil(W / TS), rows = Math.ceil(H / TS), tiles = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const tl = Buffer.alloc(TS * TS * SPP, padByte);
      for (let y = 0; y < TS; y++) {
        const iy = r * TS + y; if (iy >= H) break;
        const x0 = c * TS, w = Math.max(0, Math.min(TS, W - x0)) * SPP;
        if (w > 0) img.copy(tl, y * TS * SPP, (iy * W + x0) * SPP, (iy * W + x0) * SPP + w);
      }
      tiles.push(tl);
    }
    const p = join(dir, name), comp = tiles.map(t => deflateSync(t, { level })), n = comp.length;
    let off = 16; const offs = [];
    for (const c of comp) { offs.push(off); off += c.length; }
    // A TRANSPOSED DIRECTORY: the same bytes at the same places, two index entries exchanged. The tile
    // DATA is untouched, so a comparison over the stored region cannot see it.
    const lens = comp.map(c => c.length);
    if (swap) { const [a, b] = swap;
                const o = offs[a], l = lens[a];
                offs[a] = offs[b]; lens[a] = lens[b]; offs[b] = o; lens[b] = l; }
    const offsAt = off, cntsAt = offsAt + 8 * n, ifdAt = cntsAt + 8 * n;
    const head = Buffer.alloc(16);
    head.write('II', 0, 'latin1'); head.writeUInt16LE(43, 2); head.writeUInt16LE(8, 4);
    head.writeUInt16LE(0, 6); u64(ifdAt).copy(head, 8);
    const short1 = v => { const b = Buffer.alloc(8); b.writeUInt16LE(v, 0); return b; };
    const ent = (tag, ty, count, val) => {
      const b = Buffer.alloc(20);
      b.writeUInt16LE(tag, 0); b.writeUInt16LE(ty, 2); u64(count).copy(b, 4); val.copy(b, 12);
      return b;
    };
    // A SINGLE-TILE IMAGE PUTS ITS ARRAYS INLINE. A BigTIFF entry carries 8 bytes of value, so one
    // LONG8 IS the value and only two or more are stored out of line behind an offset. Writing the
    // offset form for n = 1 made the reader take the array's address as the tile's address - which the
    // four-tile cases above could never have shown, because they are always out of line.
    const offsVal = n === 1 ? u64(offs[0]) : u64(offsAt);
    const cntsVal = n === 1 ? u64(comp[0].length) : u64(cntsAt);
    const tags = [ent(256, 4, 1, u64(W)), ent(257, 4, 1, u64(H)), ent(259, 3, 1, short1(8)),
                  ent(277, 3, 1, short1(SPP)),
                  ent(322, 4, 1, u64(TS)), ent(323, 4, 1, u64(TS)),
                  ent(324, 16, n, offsVal), ent(325, 16, n, cntsVal)];
    writeFileSync(p, Buffer.concat([head, ...comp, Buffer.concat(offs.map(u64)),
      Buffer.concat(lens.map(u64)),
      Buffer.concat([u64(tags.length), ...tags, u64(0)]), Buffer.from(meta(i), 'latin1')]));
    return p;
  };
  const img = Buffer.alloc(4096, 7);
  let pass = 0, fail = 0;
  const check = (name, got, want) => {
    if (got === want) { pass++; console.log('  ok    ' + name); }
    else { fail++; console.log('  FAIL  ' + name + '   expected ' + want + ', got ' + got); }
  };
  try {
    // 1. Identical images, DIFFERENT metadata (a different `at`) - must still read IDENTICAL.
    check('identical image, differing metadata', run([make('a.tif', img, 1), make('b.tif', img, 2)], true), 0);

    // 2. ONE byte of image flipped. The ablation that matters most: the smallest possible difference,
    //    and one that would not move light.mean or lit40 by any amount either would print.
    const one = Buffer.from(img); one[2000] = 8;
    check('one image byte flipped', run([make('c.tif', img, 1), make('d.tif', one, 2)], true), 1);

    // 3. A different image LENGTH - caught before any byte comparison runs.
    check('image region a different length',
      run([make('e.tif', img, 1), make('f.tif', Buffer.alloc(2048, 7), 2)], true), 1);

    // 4. The LAST byte of the image region, where an off-by-one in the bound would hide it.
    const lastB = Buffer.from(img); lastB[img.length - 1] = 9;
    check('last image byte flipped', run([make('g.tif', img, 1), make('h.tif', lastB, 2)], true), 1);

    // 5. The FIRST byte, the other boundary.
    const firstB = Buffer.from(img); firstB[0] = 9;
    check('first image byte flipped', run([make('k.tif', img, 1), make('l.tif', firstB, 2)], true), 1);

    // 6. Metadata differing in LENGTH must NOT register, because the compared region ends where the
    //    metadata begins - a real pair differs here every time (perTile timings are never equal).
    const p1 = join(dir, 'i.tif'), p2 = join(dir, 'j.tif');
    writeFileSync(p1, Buffer.concat([img, Buffer.from(meta(1), 'latin1')]));
    const longer = meta(2).split('"mean":1.0').join('"mean":1.0,"pad":"padding padding padding"');
    writeFileSync(p2, Buffer.concat([img, Buffer.from(longer, 'latin1')]));
    check('metadata of a different length', run([p1, p2], true), 0);

    // 7-9. THE CASE THAT MADE STAGE TWO NECESSARY: identical pixels packed at different deflate levels.
    //      This is the shape of the real failure - a desktop master and an iPhone master of one picture,
    //      13% apart in stored bytes and identical across all 163,840 tiles - which this tool reported
    //      as a different picture until it learned to inflate.
    // H is deliberately NOT a multiple of 128: at tile 128 the bottom row is half padding, and at tile
    // 256 the padding is a different shape again. Every cross-tiling case below therefore runs over an
    // edge where the two files pad differently, which is exactly where a naive mapping goes wrong.
    const W = 256, H = 192;
    const pic = Buffer.alloc(W * H * 4);
    for (let i = 0; i < pic.length; i++) pic[i] = (i * 7 + (i >> 5) * 13) & 0xff;
    const lo = bigTiff('lo.tif', pic, W, H, 128, 1, 1), hi = bigTiff('hi.tif', pic, W, H, 128, 9, 2);
    // THE TEST'S OWN ABLATION. If the two levels happened to pack to the same bytes, the next case would
    // pass through stage ONE and prove nothing about stage two. Assert the premise before leaning on it.
    check('the two levels really do pack to different sizes', statSync(lo).size !== statSync(hi).size, true);
    check('same pixels, different deflate level', run([lo, hi], true), 0);

    // ...and the ablation that stops "always identical" from passing: one byte of one tile moved, still
    // at two different levels, so the only route to a verdict is through the inflated comparison.
    const bent = Buffer.from(pic); bent[4000] = (bent[4000] + 1) & 0xff;
    check('one pixel moved, still different levels',
      run([lo, bigTiff('hibent.tif', bent, W, H, 128, 9, 2)], true), 1);

    // 10-12. CROSS-TILING. One slab is tiled whatever each device can afford - 512 on a desktop, 1024
    //        on a 2 GB tablet, 4096 where the texture limit allows - so the same picture arrives at two
    //        tile sizes, and the comparison refused that outright until it learned to map one onto the
    //        other. A 256 tile is a 2x2 block of 128s, the way a 1024 is a 2x2 of 512s.
    const t128 = bigTiff('t128.tif', pic, W, H, 128, 6, 1);
    const t256 = bigTiff('t256.tif', pic, W, H, 256, 6, 2);
    check('same pixels, 128-tiled against 256-tiled', run([t128, t256], true), 0);
    check('one pixel moved, across two tilings',
      run([t128, bigTiff('t256bent.tif', bent, W, H, 256, 6, 2)], true), 1);
    // AND THE ONE THAT PROVES THE CLIP. Both files pad, and they pad DIFFERENT regions. Fill one side's
    // padding with 0xFF and the picture is still the same picture. If the mapping compared padding this
    // reads DIFFERS, and the cross-tiling verdict above would be worth nothing.
    check('padding differs, picture does not',
      run([t128, bigTiff('t256pad.tif', pic, W, H, 256, 6, 2, 0xFF)], true), 0);

    // 13. A TRANSPOSED DIRECTORY, which this tool called IDENTICAL until 2026-10-16. A deliberately
     //    broken resume swapped two entries in a real master's tile directory: the tile DATA was
     //    untouched, byte for byte at the same offsets, and only the mapping from index to offset had
     //    changed. The compared region ends at the first IFD and the directory lives AFTER it, so the
     //    one thing that had changed was the one thing nothing looked at. Same bytes in a different
     //    order is a different picture.
    const t128b = bigTiff('t128swap.tif', pic, W, H, 128, 6, 2, 0, [0, 3]);
    check('a transposed tile directory is NOT identical', run([t128, t128b], true), 1);

    // 14-19. THE MARKED-AGAINST-UNMARKED PAIR. Marking is on by default, so every comparison with a
    //        master rendered before that lands here, and a bare DIFFERS reads as a determinism failure
    //        when it is an era boundary. These need a picture at least one CELL tall: every case above
    //        is 192 px and cannot hold a mark row at all, so none of them could ever exercise this -
    //        'one pixel moved' passing with no mark line proved nothing until now.
    if (!MK) check('the mark functions could be lifted from the app', false, true);
    else {
      const C = MK.MARK_CELL, span = MK.MARK_BITS * MK.MARK_COPIES;
      const cell = Buffer.alloc(C * C * 4);
      for (let i = 0; i < cell.length; i++) cell[i] = (i * 31 + (i >> 7) * 17) & 0xff;
      const marked = Buffer.from(cell);
      // THE PREMISE, ASSERTED BEFORE ANYTHING LEANS ON IT. A stamp that marked nothing would make
      // every case below pass by comparing a picture with itself.
      check('the fixture really is stamped', MK.markStamp(marked, C, 0, 0, C, C, 0xdeadbeef), 1);
      check('and the stamp really changed bytes', !marked.equals(cell), true);
      const plain = bigTiff('m-plain.tif', cell, C, C, C, 6, 1);
      const say = paths => {
        const lines = [], real = console.log;
        console.log = (...a) => lines.push(a.map(String).join(' '));
        let r; try { r = run(paths, true); } finally { console.log = real; }
        return { r, out: lines.join(NL) };
      };
      const pair = say([plain, bigTiff('m-stamped.tif', marked, C, C, C, 6, 2)]);
      check('a marked master differs from its unmarked twin', pair.r, 1);
      check('and the pair is named, not left as a bare DIFFERS',
            /carries positional marks/.test(pair.out) && /carries none/.test(pair.out), true);

      // THE ABLATIONS. Each moves ONE blue byte by one level and differs from a real mark in exactly
      // one respect - the row, the span, the channel. If any is called a mark then the detection is
      // matching on 'small' rather than on shape, which would let a real one-level defect hide behind
      // the explanation. A detection that cannot say no is not a detection.
      const bend = at => { const b = Buffer.from(cell); b[at] = b[at] === 255 ? 254 : b[at] + 1; return b; };
      const px = (x, y, ch) => (y * C + x) * 4 + ch;
      const said = (name, img) => check(name, /positional marks/.test(say([plain, bigTiff(name, img, C, C, C, 6, 2)]).out), false);
      said('ABLATION one blue level OFF the mark row is not a mark', bend(px(C - 1, C - 2, 2)));
      said('ABLATION one blue level PAST the span is not a mark', bend(px(C - 1 - span, C - 1, 2)));
      said('ABLATION one RED level inside the span is not a mark', bend(px(C - 1, C - 1, 0)));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  console.log(NL + pass + ' passed, ' + fail + ' failed');
  return fail ? 1 : 0;
}

const args = process.argv.slice(2);
if (args[0] === '--selftest') process.exit(selftest());
if (!args.length) {
  console.error('usage: node tools/check-same-image.mjs <master.tif> ... | --selftest');
  process.exit(2);
}
process.exit(run(args, false));

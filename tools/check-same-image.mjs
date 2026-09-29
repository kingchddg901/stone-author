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
import { locateMeta } from './lib/find-meta.mjs';

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
      if (f.imageLen !== ref.imageLen) {
        console.log('    DIFFERS  ' + baseName(f.path) + '   image region is ' + f.imageLen +
          ' bytes against ' + ref.imageLen + ' - a different length, so different pixels');
        failures++; continue;
      }
      const r = compareRegion(ref.path, f.path, ref.imageLen);
      if (r.firstDiff < 0) {
        console.log('    IDENTICAL  ' + baseName(f.path) + '   ' + r.examined + ' image bytes, byte for byte');
      } else {
        console.log('    DIFFERS  ' + baseName(f.path) + '   first at byte ' + r.firstDiff + ', ' +
          r.diffBytes + ' of ' + r.examined + ' differ (' +
          (100 * r.diffBytes / r.examined).toFixed(4) + '%)');
        failures++;
      }
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

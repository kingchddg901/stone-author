// THE LENS'S PARAMETERS, PACKED. The companion to lens-gpu.mjs, and the only place the uniform's
// field order is written down.
//
// WHY THIS IS NOT PART OF A MATERIAL. stone-real, wood-real and glass-real each pack a material: the
// ground, the modulators, the content layers. The lens packs none of that, because the lens does not
// know what is underneath it. It is the LAST coat pass - after the subsurface and the specular - and
// all it ever reads is the coated tile that came out of applyCoat. So it sits beside the materials
// rather than inside one, and tools/check-material-fork.mjs stays quiet: there is no stone/wood/X
// branch here to put at a seam, because there is no branch.
//
// WHAT IT DOES NOT CARRY, which is the interesting half:
//
//   NO RADIAL TABLE. applyLens tabulates amp*sin(kr)/r and 1+amp*k*cos(kr) because a sin and a cos
//   cost about 40 ns each in a scalar loop and the sqrt costs 2. On the GPU they are hardware
//   instructions and a table would be a buffer read, so the kernel computes the field directly. That
//   makes the shader STRICTLY MORE ACCURATE than the CPU path, which carries up to LENS_TAB_ERR of
//   interpolated displacement - so the two renderers cannot agree bit for bit, by construction and
//   not by accident. docs/stone-gpu.md already sets the bar for that: new against OLD judged by eye,
//   new against ITSELF judged in bytes.
//
//   NO ARENA, NO CELL TABLES, NO PER-LAYER FILTERS. One uniform of twelve scalars and two pixel
//   buffers is the whole binding set. stone's arena is 103.8 MB at 32,768; this is 48 bytes.
//
// THE PIXELS GO AS u32, ONE PER PIXEL, because that is what a canvas hands over: getImageData gives
// RGBA bytes, and a Uint32Array view of them is exactly what unpack4x8unorm reads on a little-endian
// machine. Keeping them packed means the gather indexes whole pixels rather than channels, which is
// the same arithmetic applyLens does with `(sy * w + sx) << 2` and one less multiply.

// THE FIELD ORDER, AND THE SHADER'S STRUCT IS GENERATED FROM IT. Written once here; lens-gpu.mjs
// imports both lists and builds the struct, so a field added in the middle cannot leave the shader
// reading the next one along. stone-gpu.mjs's header records what that defect looked like when the
// indices were written by hand: every layer read its grid out of its own padding and drew nothing.
export const LENS_FLOAT_NAMES = [
  'k',      // the field's angular frequency, 2*PI / pitch in draw px
  'amp',    // displacement amplitude in px; amp*k is PI*lens whatever the pitch
  'caus',   // the brightness gain, G.lens * 0.35
  'cx',     // the picture's centre, in PICTURE pixels and not the tile's
  'cy',
  'vx',     // this tile's top-left in picture pixels - whole numbers, always
  'vy',
  'fwm1',   // fw - 1 and fh - 1, precomputed because the clamp wants the limit and not the size
  'fhm1',
];
export const LENS_INT_NAMES = [
  'w',      // the tile's own width and height, in pixels, bleed included
  'h',
  'kind',   // 0 fresnel, 1 reeded, 2 water - see KINDS
];

// THE TYPE GOES AS A NUMBER, and the mapping lives here rather than in the shader so one table
// answers for both halves. A string would be a branch on a string in a per-pixel kernel.
export const KINDS = { fresnel: 0, reeded: 1, water: 2 };

// A UNIFORM IS PADDED TO 16 BYTES, and the padding is DERIVED rather than written. Twelve scalars is
// 48 bytes and needs none today; the thirteenth would need twelve bytes of it, and a hand-written
// `_pad` is the kind of thing that stays at the old size when the list grows.
export const UNI_SCALARS = LENS_FLOAT_NAMES.length + LENS_INT_NAMES.length;
export const UNI_PAD = (16 - ((UNI_SCALARS * 4) % 16)) % 16 / 4;      // in scalars, not bytes
export const UNI_BYTES = (UNI_SCALARS + UNI_PAD) * 4;

// PACK ONE TILE'S CALL. `f` is lensField's return - the same object applyLens reads, so the two
// paths cannot disagree about what the field IS - plus the tile's own geometry.
//
// EVERY NUMBER HERE IS ALSO READ BY THE CPU PATH. That is deliberate: if the shader is handed a
// different k or a different centre than applyLens would use, the two pictures differ for a reason
// that has nothing to do with the gather, and the fidelity comparison measures the wrong thing.
export function packLens(f, tile) {
  const { w, h, vx, vy, fw, fh } = tile;
  const kind = KINDS[f.type];
  if (kind === undefined) throw new Error('lens-real: unknown lens type ' + f.type);
  const buf = new ArrayBuffer(UNI_BYTES);
  const fv = new Float32Array(buf), iv = new Int32Array(buf);
  const vals = { k: f.k, amp: f.amp, caus: f.caus, cx: f.cx, cy: f.cy, vx, vy, fwm1: fw - 1, fhm1: fh - 1 };
  const ints = { w, h, kind };
  // FAIL CLOSED ON A NAME NOBODY SUPPLIED. An Int32Array coerces undefined to 0 IN SILENCE and a
  // Float32Array to NaN, so a field added to a list above and not to a map here writes a plausible
  // zero or a poison that only shows up as a black tile. The struct cannot catch this - it is
  // GENERATED from these same lists, so it grows with them and the two can never disagree, which
  // makes any struct-against-packer check an identity. This is the thing that can actually fail.
  for (const [names, map] of [[LENS_FLOAT_NAMES, vals], [LENS_INT_NAMES, ints]])
    for (const n of names)
      if (!Number.isFinite(map[n])) throw new Error('lens-real: no finite value for ' + n);
  LENS_FLOAT_NAMES.forEach((n, i) => { fv[i] = vals[n]; });
  LENS_INT_NAMES.forEach((n, i) => { iv[LENS_FLOAT_NAMES.length + i] = ints[n]; });
  return buf;
}

// THE DISPATCH SHAPE, here rather than at the call site so the kernel's workgroup size is stated
// once. 8x8 because the gather's neighbours are its own neighbours: a workgroup covering a square
// block reads a square block of source, which is the best locality a displacement field allows.
export const WG = 8;
export const dispatchFor = (w, h) => [Math.ceil(w / WG), Math.ceil(h / WG), 1];

// ONE OUTPUT TILE OF ONE PYRAMID LEVEL, from the four compressed tiles above it.
//
// A level-L tile covers 2x2 tiles of level L-1, and reduce2 turns each of those into exactly one
// quadrant - so the mapping is four inflates, four reductions and a blit, with no resampling across a
// tile seam. Pulled out of add-overviews so a worker thread and a probe can both drive it.
//
// THE QUADRANT ORDER IS LOAD-BEARING: quad q sits at x = (q & 1) * half, y = (q >> 1) * half, and the
// caller must pass its sources in that same q order. Transposing those two shifts is the one mistake
// here that yields a perfectly valid file full of shuffled quarters, so probe-pyramid-order gives the
// four quads four different colours and reads the corners back.
import { inflateSync, deflateSync } from 'zlib';

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
export const widen = (px, spp) => {
  if (spp === 4) return px;
  const n = (px.length / 3) | 0, out = new Uint8Array(n * 4);
  for (let i = 0, o = 0; o < out.length; i += 3, o += 4) {
    out[o] = px[i]; out[o + 1] = px[i + 1]; out[o + 2] = px[i + 2]; out[o + 3] = 255;
  }
  return out;
};
export const narrow = (px, spp) => {
  if (spp === 4) return px;
  const n = (px.length / 4) | 0, out = new Uint8Array(n * 3);
  for (let i = 0, o = 0; o < out.length; i += 4, o += 3) {
    out[o] = px[i]; out[o + 1] = px[i + 1]; out[o + 2] = px[i + 2];
  }
  return out;
};

// quads: four Buffers of DEFLATED source tile, in q order, or null for a quadrant past the grid edge -
// which is left at zero, exactly as padding at the right and bottom of a level has always been.
export function tileFromQuads(quads, TW, SPP, reduce2) {
  const out = new Uint8Array(TW * TW * 4), half = TW >> 1;
  for (let q = 0; q < 4; q++) {
    if (!quads[q]) continue;
    const small = reduce2(widen(inflateSync(quads[q]), SPP), TW, TW);
    const ox = (q & 1) * half, oy = (q >> 1) * half;
    for (let y = 0; y < half; y++)
      out.set(small.subarray(y * half * 4, (y + 1) * half * 4), ((oy + y) * TW + ox) * 4);
  }
  // NARROWED BEFORE THE DEFLATE, so a written level has the same sample count as the base it came
  // from - and the level above reads it back through widen() on the next pass.
  const w8 = narrow(out, SPP);
  return deflateSync(Buffer.from(w8.buffer, w8.byteOffset, w8.byteLength), { level: 6 });
}

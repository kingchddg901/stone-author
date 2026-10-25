// THE WOOD SCENE, FLATTENED FOR A SHADER - the packer half of the wood port.
//
// `glass-real.mjs` does this for glass and this is its sibling, deliberately shaped the same way: one
// flat f32 arena of named parts, one uniform of scalars, and a per-entry record for the thing there
// are many of. Reading one teaches the other.
//
// WHY WOOD IS THE CANDIDATE AND STONE IS NOT. Measured across the archive at >=16,384 wide on
// win-chrome: stone renders at 101.4 Mpx/s, glass at 7.7 on the CPU painter and 102.9 through the
// shader, and wood at 21.9. Stone was never evaluating a field per pixel - it issues canvas
// commands the browser already runs on the GPU - so it is already at the rate glass reaches WITH a
// shader and has nothing to gain. Wood's painter is the same shape glass's was: createImageData, a
// nested loop, one call per pixel, putImageData.
//
// AND THE PER-PIXEL CALL IS ONE FUNCTION. `shade` in woodSampler, 222 lines of which 130 are code,
// reaching only woodHash and woodAtan2 - both already ported for glass - plus woodStain and woodEye.
// The work is not the arithmetic. It is THIS: the state that function closes over is a tree.
//
// WHAT HAS TO BE FLATTENED, and it is why the scope is comparable to glass's rather than smaller:
//
//   the trunk     lut tv tw th pax pay edge WV wv WK FIRE FE   - eleven arrays and a feature list
//   the graft     lut tv tw edge                               - a SECOND tree, for a grafted scion
//   the sampler   ~40 scalars, 21 of them colour components
//
// A GRAFT IS A WHOLE TREE. `WOOD.graft` names a section whose slab is itself wood, and shade reads
// that field's rings for the grafted part of the board. So the arena carries two fields, not one -
// the cache was built to hold both at once for exactly this reason.
//
// NOTHING HERE DRAWS. This file turns a field into bytes and is testable in Node with no GPU, which
// is the whole reason it comes first: the unknowns are in the flattening, not in the shading.

// the arena's parts, in the order the Env's offsets name them
export const PART_NAMES = [
  'LUT', 'TV', 'TW', 'TH', 'PAX', 'PAY', 'EDGE',     // the trunk's ring tables and pith track
  'WV', 'WVA', 'WK', 'FIRE',                          // its wave family and fire sector
  'FE',                                               // its features, 24 floats each
  'GLUT', 'GTV', 'GTW', 'GEDGE',                      // the graft's, when there is one
];

const f32 = a => a instanceof Float32Array ? a : new Float32Array(a || []);

// A FEATURE IS TWENTY-FOUR FLOATS, the way an op is sixteen. Every field woodField hands back, in a
// fixed order, so the shader indexes rather than searches.
//
// rDie IS SUBSTITUTED, and this is the one value that does not survive the trip unchanged. A feature
// that never dies carries Infinity, and while f32 can hold it, a shader that runs where infinities
// are flushed would compare against garbage. The sentinel is past any radius a tree in feet can
// reach, so the comparison it feeds reads the same and the value is finite everywhere.
//
// AND IT IS A POWER OF TWO ON PURPOSE. The first spelling was 1e30, which is not representable in
// f32 and came back as 1.0000000150474662e30 - fine for a greater-than, wrong the moment anything
// compares it for equality, which is exactly what a sentinel invites. 2^100 round trips exact.
export const FE_STRIDE = 24;
export const NEVER_DIES = 2 ** 100;

export function feRow(f) {
  const a = new Float32Array(FE_STRIDE);
  a[0] = f.amp; a[1] = f.ux; a[2] = f.uy; a[3] = f.al; a[4] = f.zw; a[5] = f.wl;
  a[6] = f.ax; a[7] = f.ay; a[8] = f.az;
  a[9] = f.px; a[10] = f.py;
  a[11] = f.qx; a[12] = f.qy; a[13] = f.qz;
  a[14] = f.kn; a[15] = f.kp; a[16] = f.zc; a[17] = f.r0;
  a[18] = f.dead ? 1 : 0;
  a[19] = Number.isFinite(f.rDie) ? f.rDie : NEVER_DIES;
  a[20] = f.prune; a[21] = f.ageN; a[22] = f.rbMax;
  return a;
}

// THE UNIFORM IS 512 BYTES, not glass's 304, and that is a choice rather than a measurement. Glass's
// is cramped - supersampling took one of its two spare words and the per-op metadata bases took the
// other two - because four probe pages build that bind group independently and a required binding
// added there breaks every one of them. Wood has no probes yet, so its layout is free, and starting
// it with room is cheaper than discovering the ceiling later.
export const UNI_BYTES = 512;
const FLOATS = 96, INTS = 32;                      // 96*4 + 32*4 = 512

export function packWood(F, extra) {
  const G = extra.graft || null;                   // the scion's field, or none
  const S = extra.sampler || {};                   // woodSampler's own constants
  const C = extra.colours || {};                   // seven triples, resolved from COL at draw time

  const parts = {
    LUT: f32(F.lut), TV: f32(F.tv), TW: f32(F.tw), TH: f32(F.th),
    PAX: f32(F.pax), PAY: f32(F.pay), EDGE: f32(F.edge),
    WV: f32(F.WV), WVA: f32(F.wv), WK: f32(F.WK), FIRE: f32(F.FIRE),
    FE: (() => {
      const fe = F.FE || [];
      const a = new Float32Array(fe.length * FE_STRIDE);
      fe.forEach((f, i) => a.set(feRow(f), i * FE_STRIDE));
      return a;
    })(),
    GLUT: f32(G && G.lut), GTV: f32(G && G.tv), GTW: f32(G && G.tw), GEDGE: f32(G && G.edge),
  };

  // an empty part still needs an offset; the shader never indexes one whose count is zero
  const offs = {}; let at = 0;
  for (const n of PART_NAMES) { offs[n] = at; at += Math.max(parts[n].length, 1); }
  const arena = new Float32Array(at);
  for (const n of PART_NAMES) if (parts[n].length) arena.set(parts[n], offs[n]);

  const b = new ArrayBuffer(UNI_BYTES), d = new DataView(b);
  const col = (k, dflt) => { const v = C[k] || dflt; return [v[0], v[1], v[2]]; };
  const FL = [
    // the trunk's scalars
    F.R || 0, F.LMAX || 0, F.fsp || 0, F.fcz || 0,
    F.urel || 0, F.rwl || 0, F.zoff || 0, F.ginv || 0,
    F.fwl || 0, F.fchar || 0, F.fzw || 0, 0,
    // the sampler's
    S.KS || 0, S.ZS || 0, S.GKS || 0, S.MINL || 0,
    S.MINV || 0, S.MTHR || 0, S.GLOSS || 0, S.LIT || 0,
    S.ffx || 0, S.ffy || 0, S.fcIn || 0, S.fcOut || 0,
    S.FSEV || 0, S.ECELL || 0, S.ERADFT || 0, S.eyeDepth || 0,
    // the board's geometry, which the painter resolves before the loop
    extra.len || 0, extra.wid || 0, extra.y0 || 0, extra.H || 0,
    extra.pcx || 0, extra.pcy || 0, extra.cux || 0, extra.cuy || 0,
    extra.bandY || 0, 0, 0, 0,
    // seven colour triples, early / late / heart / knot / mineral / graft-early / graft-late
    ...col('early', [196, 150, 96]), 0,
    ...col('late', [96, 62, 34]), 0,
    ...col('heart', [90, 52, 24]), 0,
    ...col('knot', [74, 47, 24]), 0,
    ...col('mineral', [93, 97, 82]), 0,
    ...col('graftEarly', [196, 150, 96]), 0,
    ...col('graftLate', [96, 62, 34]), 0,
  ];
  for (let i = 0; i < FLOATS; i++) d.setFloat32(i * 4, FL[i] || 0, true);

  const IN = [
    F.K || 0, F.Z || 0, F.NA || 0, F.NW || 0,
    (F.FE && F.FE.length) || 0, F.n || 0, S.EYES ? 1 : 0, S.WAVY ? 1 : 0,
    (G && G.K) || 0, (G && G.n) || 0, G ? 1 : 0, 0,
    offs.LUT, offs.TV, offs.TW, offs.TH,
    offs.PAX, offs.PAY, offs.EDGE, offs.WV,
    offs.WVA, offs.WK, offs.FIRE, offs.FE,
    offs.GLUT, offs.GTV, offs.GTW, offs.GEDGE,
    extra.tileX || 0, extra.tileY || 0, extra.tileW || 0, extra.tileH || 0,
  ];
  for (let i = 0; i < INTS; i++) d.setInt32(FLOATS * 4 + i * 4, IN[i] || 0, true);

  return {
    uni: b, arena, offs, parts,
    summary: {
      features: (F.FE && F.FE.length) || 0,
      rings: F.K || 0, slices: F.Z || 0,
      waves: F.NW || 0,
      graft: !!G,
      arenaFloats: arena.length,
    },
  };
}

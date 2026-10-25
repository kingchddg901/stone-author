// THE WOOD SCENE, FLATTENED FOR A SHADER - the packer half of the wood port.
//
// `glass-real.mjs` does this for glass and this is its sibling, deliberately shaped the same way: one
// flat f32 arena of named parts, one uniform of scalars, and a per-entry record for the thing there
// are many of. Reading one teaches the other.
//
// WHY WOOD AND NOT STONE. Measured across the archive at >=16,384 wide on win-chrome: stone renders
// at 101.4 Mpx/s, glass at 7.7 on the CPU painter and 102.9 through the shader, wood at 21.9. Stone
// was never evaluating a field per pixel - it issues canvas commands the browser already runs on the
// GPU - so it is ALREADY at the rate glass reaches with a shader. Wood's painter is the shape
// glass's was: createImageData, a nested loop, one call a pixel, putImageData.
//
// THE FIRST VERSION OF THIS FILE WAS WRONG AND THE WAY IT WAS WRONG IS THE POINT. It read
// woodField's return statement, saw `fsp, fcz, urel, rwl, zoff, ginv, fwl, fchar, fzw` listed among
// the scalars, and packed them as uniform floats. They are ARRAYS - shade indexes every one by ring
// or by slice - and a feature's `al` and `zw` are arrays too, not numbers. A RETURN STATEMENT SAYS
// WHAT COMES BACK; ONLY THE CONSUMER SAYS WHAT SHAPE IT IS.
//
// And the first gate could not see it, because its fixture was built from the same wrong reading. A
// fixture written from the author's belief tests the author's belief. `check-wood-inputs` replaces
// that: it pulls the alias map out of woodSampler's own declarations and the subscripted set out of
// shade's own body, and requires FIELD_PARTS below to account for every name that survives the join.
// Nothing in it is written down by hand, so a tenth array in the app goes red on its own.

// the arena's parts, in the order the Env's offsets name them
export const PART_NAMES = [
  'LUT', 'TV', 'TW', 'TH', 'PAX', 'PAY', 'EDGE',          // the trunk's ring tables and pith track
  'GINV', 'ZOFF', 'UREL', 'RWL',                           // the taper, and ring width by ring
  'FSP', 'FCZ', 'FWL', 'FCHAR', 'FZW',                     // the fire's tables
  'WVA', 'WZC', 'WZS', 'FIRE',                             // the wave family, by wave and by slice
  'FE', 'FEAL', 'FEZW',                                    // features: scalars, lobes, z windows
  'GLUT', 'GTV', 'GTW', 'GEDGE',                           // the graft's, when there is one
];

// WHICH PART CARRIES WHICH FIELD PROPERTY. `check-wood-inputs` reads every name shade subscripts
// straight out of the app and requires an entry here for each, so this map is the packer's CLAIM
// about what it carries and that gate is the app's ANSWER.
//
// `WV` names the wave FAMILY, whose members are objects holding two tables apiece, so it resolves to
// the first of the two concatenated tables rather than to a part of its own - there is no flat WV.
export const FIELD_PARTS = {
  lut: 'LUT', tv: 'TV', tw: 'TW', th: 'TH', pax: 'PAX', pay: 'PAY', edge: 'EDGE',
  ginv: 'GINV', zoff: 'ZOFF', urel: 'UREL', rwl: 'RWL',
  fsp: 'FSP', fcz: 'FCZ', fwl: 'FWL', fchar: 'FCHAR', fzw: 'FZW',
  wv: 'WVA', WV: 'WZC', 'wave:zc': 'WZC', 'wave:zs': 'WZS', FIRE: 'FIRE',
  FE: 'FE', 'feature:al': 'FEAL', 'feature:zw': 'FEZW',
  'graft:lut': 'GLUT', 'graft:tv': 'GTV', 'graft:tw': 'GTW', 'graft:edge': 'GEDGE',
};

const f32 = a => a instanceof Float32Array ? a : new Float32Array(a || []);

// MANY TABLES OF ONE LENGTH, laid end to end. Every wave carries a zc of Z and every feature a zw of
// Z, so entry i starts at i * stride and the shader needs no table of offsets. A caller whose
// entries disagree on length is a DEFECT rather than a case: it would mean the field built them
// differently, and silently indexing past one is worse than refusing.
function catSame(list, pick, what) {
  if (!list.length) return new Float32Array(0);
  const first = f32(pick(list[0]) || []), n = first.length;
  for (const g of list) {
    if (f32(pick(g) || []).length !== n) throw new Error('packWood: ' + what + ' of two lengths');
  }
  const out = new Float32Array(n * list.length);
  list.forEach((g, i) => out.set(f32(pick(g) || []), i * n));
  return out;
}

// A FEATURE'S SCALARS ARE TWENTY-TWO FLOATS, the way an op is sixteen. Its `al` and `zw` are TABLES
// and live in their own parts - a lobe is NA long and a z window is Z long, and neither belongs in a
// fixed-width record. That is the correction this file exists to record.
//
// rDie IS SUBSTITUTED, and it is the one value that does not survive the trip unchanged. A feature
// that never dies carries Infinity, and while f32 can hold it, a shader running where infinities are
// flushed would compare against garbage. The sentinel is past any radius a tree in feet can reach.
//
// AND IT IS A POWER OF TWO ON PURPOSE. The first spelling was 1e30, which is not representable in
// f32 and came back as 1.0000000150474662e30 - fine for a greater-than, wrong the moment anything
// compares a sentinel for equality, which is what a sentinel invites. 2^100 round trips exact.
export const FE_STRIDE = 22;
export const NEVER_DIES = 2 ** 100;

export function feRow(f) {
  const a = new Float32Array(FE_STRIDE);
  a[0] = f.amp; a[1] = f.ux; a[2] = f.uy; a[3] = f.zc; a[4] = f.wl;
  a[5] = f.ax; a[6] = f.ay; a[7] = f.az;
  a[8] = f.px; a[9] = f.py;
  a[10] = f.qx; a[11] = f.qy; a[12] = f.qz;
  a[13] = f.kn; a[14] = f.kp; a[15] = f.r0;
  a[16] = f.dead ? 1 : 0;
  a[17] = Number.isFinite(f.rDie) ? f.rDie : NEVER_DIES;
  a[18] = f.prune; a[19] = f.ageN; a[20] = f.rbMax;
  return a;
}

// THE UNIFORM IS 512 BYTES, not glass's 304, and that is a choice rather than a measurement. Glass's
// is cramped - supersampling took one of its two spare words and the per-op metadata bases took the
// other two - because four probe pages build that bind group independently and a required binding
// added there breaks every one of them. Wood has no probes of its own yet, so its layout is free,
// and starting it with room is cheaper than discovering the ceiling later.
export const UNI_BYTES = 512;
// EXPORTED so a gate reads the layout instead of repeating it. The first spelling of
// check-wood-pack hardcoded 96 and went red when this moved, which is a test coupled to a number
// rather than to the thing the number describes.
export const UNI_FLOATS = 80;
const FLOATS = UNI_FLOATS, INTS = 48;              // 80*4 + 48*4 = 512

export function packWood(F, extra) {
  const G = extra.graft || null;                   // the scion's field, or none
  const S = extra.sampler || {};                   // woodSampler's own constants
  const C = extra.colours || {};                   // seven triples, resolved from COL at draw time
  const FE = F.FE || [], WV = F.WV || [];

  const parts = {
    LUT: f32(F.lut), TV: f32(F.tv), TW: f32(F.tw), TH: f32(F.th),
    PAX: f32(F.pax), PAY: f32(F.pay), EDGE: f32(F.edge),
    GINV: f32(F.ginv), ZOFF: f32(F.zoff), UREL: f32(F.urel), RWL: f32(F.rwl),
    FSP: f32(F.fsp), FCZ: f32(F.fcz), FWL: f32(F.fwl), FCHAR: f32(F.fchar), FZW: f32(F.fzw),
    WVA: f32(F.wv), FIRE: f32(F.FIRE),
    WZC: catSame(WV, w => w.zc, 'a wave zc'),
    WZS: catSame(WV, w => w.zs, 'a wave zs'),
    FE: (() => {
      const a = new Float32Array(FE.length * FE_STRIDE);
      FE.forEach((f, i) => a.set(feRow(f), i * FE_STRIDE));
      return a;
    })(),
    FEAL: catSame(FE, f => f.al, 'a feature lobe'),
    FEZW: catSame(FE, f => f.zw, 'a feature z window'),
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
    F.R || 0, F.LMAX || 0, 0, 0,
    S.KS || 0, S.ZS || 0, S.GKS || 0, S.MINL || 0,
    S.MINV || 0, S.MTHR || 0, S.GLOSS || 0, S.LIT || 0,
    S.ffx || 0, S.ffy || 0, S.fcIn || 0, S.fcOut || 0,
    S.FSEV || 0, S.ECELL || 0, S.ERADFT || 0, S.eyeDepth || 0,
    extra.len || 0, extra.wid || 0, extra.y0 || 0, extra.H || 0,
    extra.pcx || 0, extra.pcy || 0, extra.cux || 0, extra.cuy || 0,
    extra.bandY || 0, 0, 0, 0,
    ...col('early', [196, 150, 96]), 0,
    ...col('late', [96, 62, 34]), 0,
    ...col('heart', [90, 52, 24]), 0,
    ...col('knot', [74, 47, 24]), 0,
    ...col('mineral', [93, 97, 82]), 0,
    ...col('graftEarly', [196, 150, 96]), 0,
    ...col('graftLate', [96, 62, 34]), 0,
  ];
  for (let i = 0; i < FLOATS; i++) d.setFloat32(i * 4, FL[i] || 0, true);

  // THE STRIDES ARE IN THE UNIFORM because the shader indexes table i at i * stride. NA is a lobe's
  // length and Z a slice count; a wave's zc and a feature's zw are both Z long.
  const IN = [
    F.K || 0, F.Z || 0, F.NA || 0, F.NW || 0,
    FE.length, F.n || 0, S.EYES ? 1 : 0, S.WAVY ? 1 : 0,
    (G && G.K) || 0, (G && G.n) || 0, G ? 1 : 0, F.WK || 0,
    ...PART_NAMES.map(n => offs[n]),
    extra.tileX || 0, extra.tileY || 0, extra.tileW || 0, extra.tileH || 0,
  ];
  for (let i = 0; i < INTS; i++) d.setInt32(FLOATS * 4 + i * 4, IN[i] || 0, true);

  return {
    uni: b, arena, offs, parts,
    summary: {
      features: FE.length, rings: F.K || 0, slices: F.Z || 0,
      waves: WV.length, lobe: F.NA || 0, graft: !!G,
      arenaFloats: arena.length,
    },
  };
}

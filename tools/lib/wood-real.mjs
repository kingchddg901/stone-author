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
  'LUT', 'TV', 'TW', 'TS', 'TH', 'PAX', 'PAY', 'EDGE',    // the trunk's ring tables and pith track
  'GINV', 'ZOFF', 'UREL', 'RWL',                           // the taper, and ring width by ring
  'FSP', 'FCZ', 'FWL', 'FCHAR', 'FZW',                     // the fire's tables
  'WVA', 'WZC', 'WZS',                                     // the wave family, by wave and by slice
  'FE', 'FEAL', 'FEZW', 'FEWL',                            // features: scalars, lobes, z windows, ring weights
  'GLUT', 'GTV', 'GTW', 'GEDGE',                           // the graft's, when there is one
];

// WHICH PART CARRIES WHICH FIELD PROPERTY. `check-wood-inputs` reads every name shade subscripts
// straight out of the app and requires an entry here for each, so this map is the packer's CLAIM
// about what it carries and that gate is the app's ANSWER.
//
// `WV` names the wave FAMILY, whose members are objects holding two tables apiece, so it resolves to
// the first of the two concatenated tables rather than to a part of its own - there is no flat WV.
export const FIELD_PARTS = {
  lut: 'LUT', tv: 'TV', tw: 'TW', ts: 'TS', th: 'TH', pax: 'PAX', pay: 'PAY', edge: 'EDGE',
  ginv: 'GINV', zoff: 'ZOFF', urel: 'UREL', rwl: 'RWL',
  fsp: 'FSP', fcz: 'FCZ', fwl: 'FWL', fchar: 'FCHAR', fzw: 'FZW',
  wv: 'WVA', WV: 'WZC', 'wave:zc': 'WZC', 'wave:zs': 'WZS',
  FE: 'FE', 'feature:al': 'FEAL', 'feature:zw': 'FEZW', 'feature:wl': 'FEWL',
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
// THE RECORD'S LAYOUT, NAMED. The shader indexes these by number, so the two have to agree and a
// list is the only thing that makes the agreement checkable. `wl` is NOT here - it is a table and
// lives in FEWL - and when it left it took index 4 with it, leaving a hole that is now closed.
export const FE_FIELDS = ['amp', 'ux', 'uy', 'zc', 'ax', 'ay', 'az', 'px', 'py',
                          'qx', 'qy', 'qz', 'kn', 'kp', 'r0', 'dead', 'rDie',
                          'prune', 'ageN', 'rbMax'];
export const FE_STRIDE = FE_FIELDS.length;
export const NEVER_DIES = 2 ** 100;

// HOW MANY FEATURES THE SHADER HAS SCRATCH FOR. The CPU painter keeps a Float64Array of each
// feature's strength across the two passes of the ring inversion, sized at run time from the list.
// A shader cannot: its scratch is a function-local array and that needs a length at compile time.
//
// TWO TODAY AND THE APP SAYS SO IN A LITERAL - DEV is two entries filtered by amp > 0 - but the
// comment above it is explicit that a third is five more keys and a row of sliders, not another
// case to write. So the seam is built for more than it ships: four slots, and packWood REFUSES a
// field with more rather than the shader quietly dropping the extra one. A refused document falls
// to the CPU painter, which has no such bound; a truncated loop would paint a plausible tree with
// a branch missing and nothing anywhere would say so. check-wood-shader reads DEV out of the app
// and goes red if it ever outgrows this.
export const SQ_MAX = 4;

export function feRow(f) {
  const a = new Float32Array(FE_STRIDE);
  // WRITTEN THROUGH THE NAMED LIST, so a field cannot land at an index nobody meant. The one
  // substitution is rDie, below.
  FE_FIELDS.forEach((k, i) => {
    if (k === 'dead') { a[i] = f.dead ? 1 : 0; return; }
    if (k === 'rDie') { a[i] = Number.isFinite(f.rDie) ? f.rDie : NEVER_DIES; return; }
    a[i] = f[k];
  });
  return a;
}

// THE UNIFORM IS 512 BYTES, not the 304 glass gets, and that is a choice rather than a measurement.
// The glass one is cramped - supersampling took one of its two spare words and the per-op metadata
// bases took the other two - because four probe pages build that bind group independently and a
// required binding added there breaks every one of them. Wood has no probes of its own yet, so its
// layout is free, and starting it with room is cheaper than discovering the ceiling later.
//
// AND IT IS NAMED RATHER THAN POSITIONAL, which is the one thing the glass layout is not. That one
// writes a bare array and its WGSL struct repeats the order by hand - a replica pair, reconciled
// only when somebody notices. The struct below is GENERATED from these two lists, so there is no
// second copy to drift, for the same reason feRow writes through FE_FIELDS rather than to numbers.
//
// IT CAUGHT ITS FIRST ONE BEFORE IT HAD A CONSUMER. The shader read E.EYESF in two places and
// E.EYES in two others, left over from when EYES was an int flag and the strength needed a float
// beside it. Declared as a field, EYESF would have compiled, run, painted wood and silently thrown
// away the eye dimple and the gloss darkening - the slider moves and nothing happens. Generated, an
// undeclared name will not compile and an unwritten one goes red below.
export const UNI_FLOAT_NAMES = [
  'R', 'LMAX', 'EYES', 'pad0',
  'KS', 'ZS', 'GKS', 'MINL',
  'MINV', 'MTHR', 'GLOSS', 'LIT',
  'ffx', 'ffy', 'fcIn', 'fcOut',
  'FSEV', 'ECELL', 'ERADFT', 'eyeDepth',
  // THE BOARD AND ITS PLACE IN THE LOG. len and wid are the plank, y0 and bandY where it was sawn
  // from, pcx/pcy the pith and cux/cuy the cut direction - and H is the sheet aspect, the one field
  // here that belongs to the canvas rather than to the tree.
  'len', 'wid', 'y0', 'H',
  'pcx', 'pcy', 'cux', 'cuy',
  // THE FACE NORMAL, which the two views set for themselves. Figure is an angle BETWEEN the fibre
  // and the surface, so the surface has to be part of the question.
  'bandY', 'pnx', 'pny', 'pnz',
  // SEVEN TRIPLES, each padded to four so a colour starts on a vec4 boundary whether or not the
  // struct is ever read as vectors.
  'earlyR', 'earlyG', 'earlyB', 'pad1',
  'lateR', 'lateG', 'lateB', 'pad2',
  'heartR', 'heartG', 'heartB', 'pad3',
  'knotR', 'knotG', 'knotB', 'pad4',
  'minR', 'minG', 'minB', 'pad5',
  'gEarlyR', 'gEarlyG', 'gEarlyB', 'pad6',
  'gLateR', 'gLateG', 'gLateB', 'pad7',
  // BEYOND THE BARK THERE IS NO BOARD, and the surround is what says so rather than clamped bark.
  'surR', 'surG', 'surB', 'pad8',
  'SATD', 'pad11', 'pad12', 'pad13',
  'pad14', 'pad15', 'pad16', 'pad17',
  'pad18', 'pad19', 'pad20', 'pad21',
  'pad22', 'pad23', 'pad24', 'pad25',
];

// THE STRIDES ARE IN THE UNIFORM because the shader indexes table i at i * stride. NA is a lobe
// length and Z a slice count; a wave zc and a feature zw are both Z long.
//
// fullW IS THE SHEET, NOT THE TILE, and that is the whole coordinate contract. The CPU painter
// takes a device pixel through the canvas inverse affine, incrementally, column by column; a shader
// has no previous pixel to add to and no canvas transform to invert. So it does what the glass one
// does - normalise the pixel position on the SHEET - which is identical for the axis-aligned tiling
// an export uses and for nothing else. A rotated affine would need the real inverse, and the pool
// refuses rather than approximating one.
export const UNI_INT_NAMES = [
  'K', 'Z', 'NA', 'NW',
  'NF', 'n', 'pad26', 'WAVY',
  'GK', 'Gn', 'HASGRAFT', 'WK',
  // WHICH FEATURE CARRIES THE KNOT FACE, or -1. The app finds it with FE.find(f => f.kn > 0) once
  // per paint; a shader cannot search a list per pixel, so it is told.
  'KNI', 'HASFIRE', 'fullW', 'pad27',
  ...PART_NAMES.map(n => 'o' + n),
  'tileX', 'tileY', 'tileW', 'tileH',
];

export const UNI_BYTES = 512;
// EXPORTED so a gate reads the layout instead of repeating it. The first spelling of
// check-wood-pack hardcoded 96 and went red when this moved, which is a test coupled to a number
// rather than to the thing the number describes.
export const UNI_FLOATS = UNI_FLOAT_NAMES.length;
export const UNI_INTS = UNI_INT_NAMES.length;

// WHERE ONE FIELD LIVES, by name. The pool patches three of these per band and nothing else, and it
// asks here rather than carrying byte offsets of its own - which is what the glass pool does, and
// what made its OFF_TX a third copy of the layout.
export function uniOffset(n) {
  const f = UNI_FLOAT_NAMES.indexOf(n);
  if (f >= 0) return f * 4;
  const i = UNI_INT_NAMES.indexOf(n);
  if (i < 0) throw new Error('uniOffset: no uniform field ' + n);
  return UNI_FLOATS * 4 + i * 4;
}

export function packWood(F, extra) {
  const G = extra.graft || null;                   // the scion's field, or none
  const S = extra.sampler || {};                   // woodSampler's own constants
  const C = extra.colours || {};                   // seven triples, resolved from COL at draw time
  const FE = F.FE || [], WV = F.WV || [];

  const parts = {
    LUT: f32(F.lut), TV: f32(F.tv), TW: f32(F.tw), TS: f32(F.ts), TH: f32(F.th),
    PAX: f32(F.pax), PAY: f32(F.pay), EDGE: f32(F.edge),
    GINV: f32(F.ginv), ZOFF: f32(F.zoff), UREL: f32(F.urel), RWL: f32(F.rwl),
    FSP: f32(F.fsp), FCZ: f32(F.fcz), FWL: f32(F.fwl), FCHAR: f32(F.fchar), FZW: f32(F.fzw),
    WVA: f32(F.wv),
    WZC: catSame(WV, w => w.zc, 'a wave zc'),
    WZS: catSame(WV, w => w.zs, 'a wave zs'),
    FE: (() => {
      const a = new Float32Array(FE.length * FE_STRIDE);
      FE.forEach((f, i) => a.set(feRow(f), i * FE_STRIDE));
      return a;
    })(),
    FEAL: catSame(FE, f => f.al, 'a feature lobe'),
    FEZW: catSame(FE, f => f.zw, 'a feature z window'),
    // FE[q].wl[gi] - indexed by RING, not by slice, which is why it is its own part and not folded
    // in with zw. Missed on the first two passes: the gate saw a bare `wl[` and I called it scratch.
    FEWL: catSame(FE, f => f.wl, 'a feature ring weight'),
    GLUT: f32(G && G.lut), GTV: f32(G && G.tv), GTW: f32(G && G.tw), GEDGE: f32(G && G.edge),
  };

  // an empty part still needs an offset; the shader never indexes one whose count is zero
  const offs = {}; let at = 0;
  for (const n of PART_NAMES) { offs[n] = at; at += Math.max(parts[n].length, 1); }
  const arena = new Float32Array(at);
  for (const n of PART_NAMES) if (parts[n].length) arena.set(parts[n], offs[n]);

  // EVERY VALUE BY NAME, so a field cannot land at an index nobody meant and a field nobody
  // supplies cannot pass as a zero.
  const pn = extra.pn || [0, 0, 0];
  const cols = {};
  for (const [key, pre, dflt] of [
    ['early', 'early', [196, 150, 96]], ['late', 'late', [96, 62, 34]],
    ['heart', 'heart', [90, 52, 24]], ['knot', 'knot', [74, 47, 24]],
    ['mineral', 'min', [93, 97, 82]],
    ['graftEarly', 'gEarly', [196, 150, 96]], ['graftLate', 'gLate', [96, 62, 34]],
  ]) {
    const v = C[key] || dflt;
    cols[pre + 'R'] = v[0]; cols[pre + 'G'] = v[1]; cols[pre + 'B'] = v[2];
  }
  const sur = extra.surround || [0, 0, 0];

  const V = {
    // EYES IS A FLOAT, not a flag. WOOD.eyes is a strength the app uses BOTH as a test and as a
    // multiplier - eyeG * EYES * eyeDepth - so writing it as 0 or 1 throws the slider away. WAVY
    // beside it really is a boolean (waveAmp > 0) and stays an int.
    R: F.R, LMAX: F.LMAX, EYES: S.EYES,
    KS: S.KS, ZS: S.ZS, GKS: S.GKS, MINL: S.MINL, MINV: S.MINV, MTHR: S.MTHR,
    GLOSS: S.GLOSS, LIT: S.LIT, SATD: S.SATD,
    ffx: S.ffx, ffy: S.ffy, fcIn: S.fcIn, fcOut: S.fcOut,
    FSEV: S.FSEV, ECELL: S.ECELL, ERADFT: S.ERADFT, eyeDepth: S.eyeDepth,
    len: extra.len, wid: extra.wid, y0: extra.y0, H: extra.H,
    pcx: extra.pcx, pcy: extra.pcy, cux: extra.cux, cuy: extra.cuy, bandY: extra.bandY,
    pnx: pn[0], pny: pn[1], pnz: pn[2],
    ...cols,
    surR: sur[0], surG: sur[1], surB: sur[2],
    K: F.K, Z: F.Z, NA: F.NA, NW: F.NW, NF: FE.length, n: F.n,
    WAVY: S.WAVY ? 1 : 0, WK: F.WK,
    GK: G ? G.K : 0, Gn: G ? G.n : 0, HASGRAFT: G ? 1 : 0,
    KNI: S.KNI === undefined ? -1 : S.KNI,
    // F.FIRE IS A BOOLEAN, not a table, and this tested it for a `.length` it has never had -
    // so HASFIRE packed 0 for every tree and a burnt one would have come back unburnt. It also had
    // a part in the arena, `f32(true)`, which is a one-element array of zero built by coercion.
    // Nothing caught it because nothing required a field the packer WRITES to have a READER: the
    // guard existed, read as complete, and the shoulder just past it was the bug.
    HASFIRE: F.FIRE ? 1 : 0,
    fullW: extra.fullW, tileX: extra.tileX, tileY: extra.tileY,
    tileW: extra.tileW, tileH: extra.tileH,
  };
  for (const n of PART_NAMES) V['o' + n] = offs[n];

  // A DECLARED FIELD NOTHING SUPPLIES IS THE EYESF DEFECT FROM THE PACKER SIDE: the struct names
  // it, the shader reads it, and it is quietly zero for the life of the port. A pad is the one
  // thing allowed to be absent, because being absent is what a pad is for.
  const absent = [...UNI_FLOAT_NAMES, ...UNI_INT_NAMES]
    .filter(n => !n.startsWith('pad') && !(n in V));
  if (absent.length) throw new Error('packWood: nothing supplies ' + absent.join(', '));

  // AND THE ONE BOUND THE SHADER CANNOT GROW INTO AT RUN TIME. Refusing here is what keeps the
  // alternative honest: the caller falls back to the CPU painter, which has no such limit.
  if (FE.length > SQ_MAX) {
    throw new Error('packWood: ' + FE.length + ' features, shader scratch holds ' + SQ_MAX);
  }

  // Number.isFinite AND NOT `|| 0`. KNI is legitimately -1 and an offset legitimately 0, so the
  // falsy test is the wrong one; what has to become zero is undefined, null and NaN.
  const num = v => (Number.isFinite(v) ? v : 0);
  const b = new ArrayBuffer(UNI_BYTES), d = new DataView(b);
  UNI_FLOAT_NAMES.forEach((n, i) => d.setFloat32(i * 4, num(V[n]), true));
  UNI_INT_NAMES.forEach((n, i) => d.setInt32(UNI_FLOATS * 4 + i * 4, num(V[n]) | 0, true));

  return {
    uni: b, arena, offs, parts,
    summary: {
      features: FE.length, rings: F.K || 0, slices: F.Z || 0,
      waves: WV.length, lobe: F.NA || 0, graft: !!G,
      arenaFloats: arena.length,
    },
  };
}

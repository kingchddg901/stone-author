// DOES THE WOOD SCENE SURVIVE BEING FLATTENED?
//
// `wood-real.mjs` is the first half of the wood port and the half where the unknowns are. The shading
// is 130 lines of arithmetic reaching two functions already ported for glass; the hard part is that
// `shade` closes over a TREE - eleven arrays, a feature list, and a second whole field when the board
// carries a graft. Nothing here draws, so all of it is checkable in Node with no GPU.
//
// WHAT THIS HAS TO PROVE:
//   1  a feature keeps all of its fields, in an order the shader can index blind
//   2  a feature that never dies survives the trip, which Infinity does not
//   3  the arena's parts do not overlap and land where their offsets say
//   4  an empty part still has an offset, because the shader indexes before it counts
//   5  the uniform is the size it claims and its integers start where it says
//   6  a graft is carried as a second field rather than folded into the first
//
//   node tools/check-wood-pack.mjs
import { packWood, feRow, PART_NAMES, FE_STRIDE, NEVER_DIES, UNI_BYTES } from './lib/wood-real.mjs';

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log('  ok    ' + name); return; }
  fails++; console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};

// A FEATURE WITH EVERY FIELD DISTINCT, so a transposition cannot hide behind two equal values.
const feat = (base, dead) => ({
  amp: base + 1, ux: base + 2, uy: base + 3, al: base + 4, zw: base + 5, wl: base + 6,
  ax: base + 7, ay: base + 8, az: base + 9,
  px: base + 10, py: base + 11,
  qx: base + 12, qy: base + 13, qz: base + 14,
  kn: base + 15, kp: base + 16, zc: base + 17, r0: base + 18,
  dead, rDie: dead ? base + 19 : Infinity,
  prune: base + 20, ageN: base + 21, rbMax: base + 22,
});

const field = (n, feats) => ({
  lut: new Float32Array(n).fill(1), tv: new Float32Array(n).fill(2),
  tw: new Float32Array(n).fill(3), th: new Float32Array(n).fill(4),
  pax: new Float32Array(n).fill(5), pay: new Float32Array(n).fill(6),
  edge: new Float32Array(n).fill(7),
  WV: new Float32Array(3).fill(8), wv: new Float32Array(3).fill(9), WK: new Float32Array(3).fill(10),
  FIRE: new Float32Array(2).fill(11),
  FE: feats, NA: 2, K: 180, R: 1.5, LMAX: 12, Z: 64, NW: 3, n,
  fsp: 0.1, fcz: 0.2, urel: 0.3, rwl: 0.4, zoff: 0.5, ginv: 0.6,
  fwl: 0.7, fchar: 0.8, fzw: 0.9,
});

// ---- 1 and 2: the feature record -------------------------------------------------------------------
{
  const r = feRow(feat(100, true));
  ok('a feature is ' + FE_STRIDE + ' floats', r.length === FE_STRIDE, r.length + '');
  // every field distinct means the row must be strictly increasing over the fields that carry base+k
  const want = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118];
  ok('the first eighteen fields are in their fixed order',
     want.every((v, i) => r[i] === v), Array.from(r.slice(0, 18)).join(','));
  ok('dead is a flag, not a value', r[18] === 1);
  ok('and the three tail fields follow it', r[20] === 120 && r[21] === 121 && r[22] === 122,
     r[20] + ',' + r[21] + ',' + r[22]);

  const alive = feRow(feat(200, false));
  ok('a feature that never dies does NOT pack Infinity', Number.isFinite(alive[19]), String(alive[19]));
  ok('it packs the sentinel instead', alive[19] === NEVER_DIES, String(alive[19]));
  ok('which is past any radius a tree in feet can reach', NEVER_DIES > 1e20);
  // ABLATION: if rDie were passed through, this is what the arena would have held
  ok('ABLATION Infinity would not have survived a Float32Array round trip as a comparable number',
     !Number.isFinite(new Float32Array([Infinity])[0]));
  const dies = feRow(feat(300, true));
  ok('and a feature that DOES die keeps its real radius', dies[19] === 319, String(dies[19]));
}

// ---- 3, 4, 5: the arena and the uniform --------------------------------------------------------------
{
  const F = field(8, [feat(0, false), feat(50, true)]);
  const r = packWood(F, { sampler: { KS: 1, ZS: 2, EYES: true, WAVY: false }, colours: {},
                          len: 12, wid: 2, H: 3 });

  // offsets ascend, and each part's data is AT its offset
  let mono = true, placed = true, prev = -1;
  for (const n of PART_NAMES) {
    if (r.offs[n] <= prev && r.parts[n].length) mono = false;
    prev = r.offs[n];
    const p = r.parts[n];
    for (let i = 0; i < p.length; i++) if (r.arena[r.offs[n] + i] !== p[i]) { placed = false; break; }
  }
  ok('the parts ascend through the arena', mono);
  ok('and every part is AT its own offset', placed);

  // nothing overlaps: the sum of the slots each part claims is the arena's length
  const claimed = PART_NAMES.reduce((a, n) => a + Math.max(r.parts[n].length, 1), 0);
  ok('and no two parts overlap', claimed === r.arena.length, claimed + ' vs ' + r.arena.length);

  ok('an EMPTY part still has an offset', r.offs.GLUT >= 0 && r.parts.GLUT.length === 0,
     'GLUT at ' + r.offs.GLUT);
  ok('and the one it claims is not shared with the next part',
     r.offs.GTV > r.offs.GLUT, r.offs.GLUT + ' then ' + r.offs.GTV);

  ok('the uniform is ' + UNI_BYTES + ' bytes', r.uni.byteLength === UNI_BYTES, r.uni.byteLength + '');
  const d = new DataView(r.uni);
  ok('the trunk radius is the first float', Math.abs(d.getFloat32(0, true) - 1.5) < 1e-6);
  ok('and the ring count is the first int', d.getInt32(96 * 4, true) === 180,
     String(d.getInt32(96 * 4, true)));
  ok('the feature count rides with it', d.getInt32(96 * 4 + 4 * 4, true) === 2);
  ok('FE holds both features end to end', r.parts.FE.length === 2 * FE_STRIDE,
     r.parts.FE.length + '');
  ok('the second starts where the first ends', r.parts.FE[FE_STRIDE] === 51,
     String(r.parts.FE[FE_STRIDE]));
}

// ---- 6: a graft is a second tree -----------------------------------------------------------------
{
  const F = field(8, [feat(0, false)]);
  const G = field(5, []);
  const bare = packWood(F, { sampler: {}, colours: {} });
  const graft = packWood(F, { sampler: {}, colours: {}, graft: G });
  ok('without a graft the scion parts are empty',
     bare.parts.GLUT.length === 0 && bare.parts.GEDGE.length === 0);
  ok('with one they carry ITS field rather than the trunk one',
     graft.parts.GLUT.length === 5 && graft.parts.GLUT[0] === 1 && graft.parts.GEDGE[0] === 7,
     graft.parts.GLUT.length + ' floats');
  ok('and the trunk is untouched by it',
     graft.parts.LUT.length === bare.parts.LUT.length, 'trunk LUT moved');
  const d = new DataView(graft.uni);
  ok('the uniform says a graft is present', d.getInt32(96 * 4 + 10 * 4, true) === 1);
  ok('and ABLATION says so only when there is one',
     new DataView(bare.uni).getInt32(96 * 4 + 10 * 4, true) === 0);
  ok('the graft grows the arena rather than sharing the trunk parts',
     graft.arena.length > bare.arena.length, bare.arena.length + ' -> ' + graft.arena.length);
}

console.log('');
if (fails) { console.error('check-wood-pack: ' + fails + ' FAILED'); process.exit(1); }
console.log('check-wood-pack: a tree flattens into an arena and a uniform without losing a field,');
console.log('                 and a grafted board carries two of them.');

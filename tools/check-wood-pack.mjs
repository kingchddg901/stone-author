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
import { packWood, feRow, PART_NAMES, FE_STRIDE, FE_FIELDS, NEVER_DIES, UNI_BYTES, UNI_FLOATS } from './lib/wood-real.mjs';

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log('  ok    ' + name); return; }
  fails++; console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};

// A FEATURE WITH EVERY FIELD DISTINCT, so a transposition cannot hide behind two equal values.
// VALUES THAT ASCEND IN feRow's OWN ORDER, so a transposition shows as a number out of sequence
// rather than hiding behind two equal fields. `al` and `zw` are TABLES - a lobe NA long, a z window
// Z long - which is the correction this fixture exists to hold: the first version of it had them as
// numbers, because the author did, and so it agreed with the mistake instead of the app.
const NA = 5, ZN = 8;
// BUILT FROM THE NAMED LIST, so field i carries base + i and a reordering cannot hide. The fixture
// used to spell the order out by hand and drifted twice when the record changed - a test that
// repeats a layout is a second copy of it.
const feat = (base, dead) => {
  const f = { wl: new Float32Array(6).fill(base + 80),
              al: new Float32Array(NA).fill(base + 90),
              zw: new Float32Array(ZN).fill(base + 91) };
  FE_FIELDS.forEach((k, i) => { f[k] = base + i; });
  f.dead = dead;
  f.rDie = dead ? base + FE_FIELDS.indexOf('rDie') : Infinity;
  return f;
};
const AT = k => FE_FIELDS.indexOf(k);

const field = (n, feats) => ({
  lut: new Float32Array(n).fill(1), tv: new Float32Array(n).fill(2),
  tw: new Float32Array(n).fill(3), th: new Float32Array(n).fill(4),
  pax: new Float32Array(n).fill(5), pay: new Float32Array(n).fill(6),
  edge: new Float32Array(n).fill(7),
  // NINE TABLES THE FIRST VERSION PACKED AS UNIFORM FLOATS. shade indexes every one.
  ginv: new Float32Array(ZN).fill(21), zoff: new Float32Array(ZN).fill(22),
  urel: new Float32Array(n).fill(23), rwl: new Float32Array(n).fill(24),
  fsp: new Float32Array(ZN).fill(25), fcz: new Float32Array(ZN).fill(26),
  fwl: new Float32Array(ZN).fill(27), fchar: new Float32Array(ZN).fill(28),
  fzw: new Float32Array(ZN).fill(29),
  // a wave is an OBJECT holding two tables, not a number
  WV: [{ zc: new Float32Array(ZN).fill(31), zs: new Float32Array(ZN).fill(32) },
       { zc: new Float32Array(ZN).fill(33), zs: new Float32Array(ZN).fill(34) }],
  wv: new Float32Array(3).fill(9), WK: 2, FIRE: new Float32Array(2).fill(11),
  FE: feats, NA, K: 180, R: 1.5, LMAX: 12, Z: ZN, NW: 2, n,
});

// ---- 1 and 2: the feature record -------------------------------------------------------------------
{
  const r = feRow(feat(100, true));
  ok('a feature is ' + FE_STRIDE + ' floats', r.length === FE_STRIDE, r.length + '');
  // every field distinct means the row must be strictly increasing over the fields that carry base+k
  const plain = FE_FIELDS.filter(k => k !== 'dead' && k !== 'rDie');
  ok('every field lands at its own index',
     plain.every(k => r[AT(k)] === 100 + AT(k)),
     plain.filter(k => r[AT(k)] !== 100 + AT(k)).join(',') || 'all in place');
  ok('dead is a flag, not a value', r[AT('dead')] === 1);
  ok('the record is exactly the named fields', r.length === FE_FIELDS.length,
     r.length + ' floats for ' + FE_FIELDS.length + ' names');
  ok('and wl, al and zw are NOT among them',
     !FE_FIELDS.includes('wl') && !FE_FIELDS.includes('al') && !FE_FIELDS.includes('zw'));

  const alive = feRow(feat(200, false));
  const AT_RDIE = AT('rDie');
  ok('a feature that never dies does NOT pack Infinity', Number.isFinite(alive[AT_RDIE]), String(alive[AT_RDIE]));
  ok('it packs the sentinel instead', alive[AT_RDIE] === NEVER_DIES, String(alive[AT_RDIE]));
  ok('which is past any radius a tree in feet can reach', NEVER_DIES > 1e20);
  // ABLATION: if rDie were passed through, this is what the arena would have held
  ok('ABLATION Infinity would not have survived a Float32Array round trip as a comparable number',
     !Number.isFinite(new Float32Array([Infinity])[0]));
  const dies = feRow(feat(300, true));
  ok('and a feature that DOES die keeps its real radius', dies[AT_RDIE] === 300 + AT('rDie'), String(dies[AT_RDIE]));
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
  ok('and the ring count is the first int', d.getInt32(UNI_FLOATS * 4, true) === 180,
     String(d.getInt32(UNI_FLOATS * 4, true)));
  ok('the feature count rides with it', d.getInt32(UNI_FLOATS * 4 + 4 * 4, true) === 2);
  ok('FE holds both features end to end', r.parts.FE.length === 2 * FE_STRIDE,
     r.parts.FE.length + '');
  ok('the second starts where the first ends', r.parts.FE[FE_STRIDE] === 50,
     String(r.parts.FE[FE_STRIDE]));
  // THE TABLES THAT ARE NOT IN THE RECORD, laid end to end at their own strides
  ok('each feature contributes a lobe of NA', r.parts.FEAL.length === 2 * 5, r.parts.FEAL.length + '');
  ok('and a z window of Z', r.parts.FEZW.length === 2 * 8, r.parts.FEZW.length + '');
  ok('the second lobe follows the first', r.parts.FEAL[5] === 140, String(r.parts.FEAL[5]));
  ok('a wave contributes two tables, not a number',
     r.parts.WZC.length === 2 * 8 && r.parts.WZS.length === 2 * 8,
     r.parts.WZC.length + '/' + r.parts.WZS.length);
  ok('and the second wave follows the first', r.parts.WZC[8] === 33, String(r.parts.WZC[8]));
  ok('the nine per-slice tables are arrays, not uniform floats',
     r.parts.GINV.length === 8 && r.parts.UREL.length === 8 && r.parts.FCHAR.length === 8,
     [r.parts.GINV.length, r.parts.UREL.length, r.parts.FCHAR.length].join(','));
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
  ok('the uniform says a graft is present', d.getInt32(UNI_FLOATS * 4 + 10 * 4, true) === 1);
  ok('and ABLATION says so only when there is one',
     new DataView(bare.uni).getInt32(UNI_FLOATS * 4 + 10 * 4, true) === 0);
  ok('the graft grows the arena rather than sharing the trunk parts',
     graft.arena.length > bare.arena.length, bare.arena.length + ' -> ' + graft.arena.length);
}

console.log('');
if (fails) { console.error('check-wood-pack: ' + fails + ' FAILED'); process.exit(1); }
console.log('check-wood-pack: a tree flattens into an arena and a uniform without losing a field,');
console.log('                 and a grafted board carries two of them.');

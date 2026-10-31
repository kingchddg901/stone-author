// ---- the synthetic warp grid, identical on both sides ---------------------------------------------
const WNX = 17, WNY = 13, WH = 0.625;
function makeWarp() {
  const u = new Float32Array(WNX * WNY), v = new Float32Array(WNX * WNY);
  for (let j = 0; j < WNY; j++) for (let i = 0; i < WNX; i++) {
    const k = j * WNX + i;
    u[k] = Math.sin(i * 0.7 + j * 0.31) * 0.013 + i * 0.0004;
    v[k] = Math.cos(i * 0.23 - j * 0.57) * 0.011 - j * 0.0003;
  }
  return { nx: WNX, ny: WNY, H: WH, u, v };
}



// ROLLED AND FLATTENED ARE NOT ONE FORM. glassFlow treats them identically - both run across the
// sheet - but glassFormT gives only ROLLED the roller texture, and collapsing them onto one
// integer had the shader drawing flattened slabs a surface the CPU never draws.
const FORM = { spun: 1, poured: 2, blown: 3, rolled: 4, flattened: 5 };

// THE SCENE THE SHADER IS TESTED AGAINST, one copy for the harness and the tile probe.
//
// It is SYNTHETIC and chosen to be awkward rather than realistic: a ribbon taller than it is wide so
// glassCellSDF's min takes both arms, an MD of zero so glassDepth's lim > 0 guard is reached, a
// roller profile walked past both ends where the app clamps, and stamps widened far past a real
// roller's because at realistic sizes the press path fired on 2 samples of 2,048 and that output
// agreed only because both sides were zero.
//
// The op chain is compiled by the APP's own compileOps - buildChain takes it as an argument - so the
// records cannot drift from what the walk expects.
//
// envUni packs the uniform: 40 floats then 36 integers, 304 bytes, which the uniform address space
// needs to be a multiple of sixteen. allArrays packs the twelve arrays, the spin table and the op
// records into the single arena the shader reads through its offset accessors.

// SYNTHETIC, SHARED, AND DELIBERATELY AWKWARD. The ribbon edges are uneven and one ribbon is taller
// than it is wide, so glassCellSDF's min(hw, hh) is exercised both ways round rather than always
// taking the same arm. MD carries a zero, because glassDepth's `lim > 0` guard is the kind of branch
// that only shows up when something has run out of budget.
const NRIB = 6, MOB = 0.7, MST = 2.5;
function makeRibbon() {
  const ex = new Float32Array(NRIB + 1), hl = new Float32Array(NRIB);
  const md = new Float32Array(NRIB), rim = new Float32Array(NRIB);
  let x = -1.4;
  for (let i = 0; i <= NRIB; i++) { ex[i] = x; x += 0.31 + (i % 3) * 0.17; }
  for (let i = 0; i < NRIB; i++) {
    hl[i] = 0.12 + (i % 4) * 0.19;
    md[i] = i === 2 ? 0 : 0.08 + (i % 5) * 0.06;
    rim[i] = 0.011 + (i % 3) * 0.004;
  }
  return { ex, hl, md, rim };
}
const RIBD = makeRibbon();
const W = makeWarp();

// A SYNTHETIC ROLLER, same idea: a grid for rollerAt and a profile for rollerHand, with total > 0 so
// the normal path runs. The total === 0 guard gets its own case rather than being hidden in this one.
const RNX = 11, RNY = 9, RH = 0.625, RPROF = 7, RTOTAL = 3.3;
function makeRoller() {
  const s = new Float32Array(RNX * RNY), v = new Float32Array(RNX * RNY);
  for (let j = 0; j < RNY; j++) for (let i = 0; i < RNX; i++) {
    const k = j * RNX + i;
    s[k] = Math.sin(i * 0.41 + j * 0.19) * 1.7 + i * 0.09;
    v[k] = Math.cos(i * 0.33 - j * 0.47) * 0.8 - j * 0.05;
  }
  const pr = new Float32Array(RPROF), tl = new Float32Array(RPROF);
  for (let i = 0; i < RPROF; i++) { pr[i] = 0.2 + Math.sin(i * 0.8) * 0.4; tl[i] = -0.3 + i * 0.11; }
  return { s, v, pr, tl };
}
const ROLD = makeRoller();


// THE FORM SCALARS, chosen so every branch above is reached: RM > 0 so the streak runs, SD and INC
// both > 0 so glassMelt does not take its early return, and FR small enough that r < FR is false for
// most of the sweep and true near the centre - the pontil boss is the interesting part.
const FV = { TH: 4.2, RM: 0.55, RS: 26, FR: 2.1, FP: 3.3, FD: 0.18, SD: 0.12, INC: 0.07, SST: 4 };


// BLOB SCALARS. MSQ above 2 so the search radius is the wider 5x5 one, and CN small enough that the
// colour modulo wraps rather than never firing.
const BLV = { MW: 0.5, MSQ: 3.2, MJ: 0.7, CN: 6, MST: 2.5 };

// STAMPS, deliberately overlapping and spread around the circumference, with one rotated off-axis so
// starR's angle argument is not always near zero. D is in inches; the app turns it into a
// circumference in feet, and that conversion is part of what is being checked.
// THE RADII ARE DELIBERATELY LARGE. At realistic sizes - r around an inch, so R = r/24 is about
// 0.04 ft against a 1.57 ft circumference - the op chain produced a non-zero press on 2 samples out
// of 2,048, which means that output channel agreed because BOTH SIDES WERE ZERO almost everywhere.
// A channel that is never exercised is not a channel that was checked. Widened until the press path
// actually fires; the test is for coverage, not for a plausible roller.
const STD = { D: 6, list: [
  { a: 0,   x: -0.4, r: 5.5, rot: 0 },
  { a: 37,  x: 0.0,  r: 4.5, rot: 23 },
  { a: 140, x: 0.35, r: 7.0, rot: 71 },
  { a: 250, x: -0.1, r: 3.5, rot: 0 },
  { a: 330, x: 0.2,  r: 6.0, rot: 199 },
] };
function stampArr() {
  const a = new Float32Array(STD.list.length * 4);
  STD.list.forEach((s, i) => { a[4 * i] = s.a; a[4 * i + 1] = s.x; a[4 * i + 2] = s.r; a[4 * i + 3] = s.rot; });
  return a;
}


// ONE BUILDER, so no case can describe the environment slightly differently from another. The layout
// mirrors the Env struct exactly: twenty-eight floats then twelve integers, 160 bytes, which is a
// multiple of sixteen as the uniform address space requires.
const MCC_COL = [2, 0, 5, 1, 4, 3];                      // the cane index each ribbon carries
function envUni(o) {
  o = o || {};
  // 40 floats then 36 integers - 304 bytes, which the uniform address space needs to be a multiple
  // of sixteen. The order mirrors the Env struct in glass-gpu.mjs exactly; the two are read together
  // or not at all.
  const b = new ArrayBuffer(320), d = new DataView(b);
  const F = [FV.TH, FV.RM, FV.RS, FV.FR,
             FV.FP, FV.FD, FV.SD, FV.INC,
             FV.SST, MOB, MST, BLV.MW,
             BLV.MSQ, BLV.MJ, BLV.CN, o.TW !== undefined ? o.TW : 0.21,
             o.LC !== undefined ? o.LC : 0.83, o.LS !== undefined ? o.LS : 0.42,
             o.CW !== undefined ? o.CW : 0.6, o.CS !== undefined ? o.CS : 1.7,
             o.LP !== undefined ? o.LP : 0.18, Math.PI * STD.D / 12, WH, RH,
             RTOTAL, PANEX, PANEY, SLAB_FT,
             CV.TH2, o.CORD !== undefined ? o.CORD : CV.CORD, CV.OPQ, CV.OREF,
             CV.kr, CV.kg, CV.kb, CV.LBR,
             CV.LBG, CV.LBB, WH, 0];
  F.forEach((v, i) => d.setFloat32(i * 4, v, true));
  const offs = arenaOffsets().offs;
  const I = [FORM[o.form || 'rolled'], o.MR ? 1 : 0, o.MB ? 1 : 0,
             o.MCn !== undefined ? o.MCn : 0,
             STD.list.length, WNX, WNY, RNX,
             RNY, RPROF, 0, 0]
    .concat(offs.slice(0, 12))                 // all float offsets; aSTS does its own x4 stride
    .concat([offs[12], offs[13], CHAIN ? CHAIN.F.OPC.length : 0, offs[14]])
    .concat([NCANE, o.tileW || 0, o.tileX || 0, o.tileY || 0])
    .concat([o.fullW || 0, 0, 0, 0]);
  I.forEach((v, i) => d.setInt32(160 + i * 4, v, true));
  // THE RELIEF TAIL. All three default to ZERO, so every probe that does not ask for relief
  // packs exactly the bytes it packed before and its picture cannot move.
  [o.REL || 0, o.LX || 0, o.LY || 0, 0]
    .forEach((v, i) => d.setFloat32(304 + i * 4, v, true));
  return b;
}

const MCCARR = new Float32Array(MCC_COL);

// THE COLOUR STAGE. kr, kg, kb are the base tint's absorption, LBR/LBG/LBB the light, and the canes
// their own absorptions - three floats each, which is why aCANE strides by three. OREF is the opal's
// single path length in millimetres; OPQ at zero leaves the thickness deciding the tint, which is
// what the slab this was measured against does.
const CV = { TH2: FV.TH, CORD: 0.8, OPQ: 0, OREF: 8,
             kr: 0.075 * 0.6, kg: 0.022 * 0.6, kb: 0.055 * 0.6,
             LBR: 252, LBG: 250, LBB: 244 };
const CANES = new Float32Array([
  0.21, 0.06, 0.13,   0.07, 0.17, 0.24,   0.19, 0.04, 0.21,
  0.05, 0.22, 0.09,   0.24, 0.14, 0.03,   0.16, 0.09, 0.20,
]);
const NCANE = CANES.length / 3;
let SLAB_FT = 8, CHAIN = null, SPINT = null;   // filled once the app is lifted
// the harness and the tile probe both lift the app themselves, then hand the pieces here
function setChain(slab, chain, spin) { SLAB_FT = slab; CHAIN = chain; SPINT = spin; }
// one arena, packed in the order the Env's offsets name
function arenaParts() {
  return [W.u, W.v, RIBD.ex, RIBD.hl, RIBD.md, RIBD.rim,
          ROLD.s, ROLD.v, ROLD.pr, ROLD.tl, stampArr(), MCCARR,
          SPINT || new Float32Array(2), CHAIN ? chainArena(CHAIN.F.OPC) : new Float32Array(16),
          CANES];
}
function arenaOffsets() {
  const parts = arenaParts(), offs = []; let at = 0;
  for (const a of parts) { offs.push(at); at += a.length; }
  return { offs, total: at };
}
function allArrays() {
  const parts = arenaParts(), { total } = arenaOffsets();
  const arena = new Float32Array(total); let at = 0;
  for (const a of parts) { arena.set(a, at); at += a.length; }
  return [arena];
}
// every binding referenced once, so none is eliminated - see the note where this was first needed
const TOUCH_ALL = '  if (i == 4294967295u) { OUT[0] = ARR[0] + f32(E.MCn); }' + String.fromCharCode(10);


// THE CHAIN IS COMPILED BY THE APP, not described here. compileOps turns an authored op into the
// record glassUnform actually walks - kind strings into integers, degrees into cos and sin, the
// stamp list into a flag - and a hand-built record would be a second copy of that mapping, drifting
// the first time a field is added. The arena rows are read OFF the app's own OPC.
const PANEX = 0.21, PANEY = -0.13;
const OPS_IN = [
  { k: 'spin',  a: 1.2, cx: 0.3, cy: -0.2 },
  { k: 'blow',  a: 1.4 },
  { k: 'roll',  a: 0.8, d: 31, st: STD.list, D: STD.D },
  { k: 'press', a: 1.0, d: 12, face: 5, bite: 1.3, st: STD.list, D: STD.D, ri: 0 },
  { k: 'stir',  a: 1.0 },
];
function buildChain(app, SLAB_FT) {
  // the roller and warp states the press and stir arms read - one each, shared, see the WGSL note
  const B = { nx: RNX, ny: RNY, H: RH, s: ROLD.s, v: ROLD.v, total: RTOTAL,
              R: { P: new Array(RPROF), pr: ROLD.pr, tl: ROLD.tl } };
  const F = { PX: PANEX, PY: PANEY, H: RH, ROLL: [B], S: W, PV: [0, 0], PH: [0, 0],
              RU0: OPS_IN.map(() => 0.4) };
  F.OPC = app.compileOps(F, OPS_IN);
  return { F, B };
}
function chainArena(OPC) {
  const a = new Float32Array(OPC.length * 16);
  OPC.forEach((op, i) => {
    const b = i * 16;
    a[b] = op.k; a[b + 1] = op.ox; a[b + 2] = op.oy; a[b + 3] = op.a; a[b + 4] = op.s;
    a[b + 5] = op.rot ? 1 : 0; a[b + 6] = op.cd; a[b + 7] = op.sd; a[b + 8] = op.u0;
    a[b + 9] = op.face; a[b + 10] = op.bite;
    a[b + 11] = op.st ? 1 : 0; a[b + 12] = op.B ? 1 : 0; a[b + 13] = op.S ? 1 : 0;
  });
  return a;
}



export { CANES, CV, NCANE, BLV, FORM, FV, MCCARR, MCC_COL, MOB, MST, NRIB, OPS_IN, PANEX, PANEY, RH, RIBD, RNX, RNY, ROLD, RPROF, RTOTAL, STD, TOUCH_ALL, W, WH, WNX, WNY, allArrays, arenaOffsets, arenaParts, buildChain, chainArena, envUni, makeRibbon, makeRoller, makeWarp, setChain, stampArr };

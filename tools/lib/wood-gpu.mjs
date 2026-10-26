// THE WOOD FIELD IN WGSL - the shader half of the wood port.
//
// `glass-gpu.mjs` is the sibling and the model: named blocks of WGSL in one object, assembled by the
// caller, with the app inlining a copy that `check-gpu-sync` holds identical. Nothing here allocates
// or binds; it is text, and the probe pages and the exporter each build what they need from it.
//
// TWO OF WOOD'S DEPENDENCIES WERE ALREADY HERE. `woodHash` and `woodAtan2` were ported for glass -
// glass reaches them through its own cell and stamp work - so the wood port inherits them rather
// than writing them twice. That is also why they live in glass-gpu.mjs and are imported here: one
// definition, and the gate that proves it bit-identical to the app's is already running.
//
// THE ORDER THIS GOES IN. woodEye and woodStain first, because they are 37 lines between them and
// each has a CPU twin that can be driven with the same inputs on both sides. `shade` comes after,
// and it is 130 lines in ONE function - which is the real risk of this port. Glass's was verified
// function by function through gpu-port-harness, seventeen of them, each against its own twin. A
// single large function cannot be bisected that way, so the two small ones are the chance to prove
// the plumbing before the thing that cannot be halved arrives.

import { FE_FIELDS, FE_STRIDE, SQ_MAX,
         UNI_FLOAT_NAMES, UNI_INT_NAMES } from './wood-real.mjs';

export const WGSL = {};

// THE FIELD INDICES, GENERATED FROM THE PACKER'S OWN LIST. A shader that indexes a record by number
// and a packer that writes it by name are a replica pair, and today that pair has already drifted
// once - `wl` left for its own part and took index 4 with it. Typing the numbers here a second time
// would be the third copy of the layout. They are built instead, so a reorder in wood-real.mjs
// moves them without anybody remembering.
const LF = String.fromCharCode(10);   // no escape sequence survives a generator intact
WGSL.woodFields = FE_FIELDS.map((k, i) => 'const FE_' + k + ': i32 = ' + i + ';').join(LF) +
  LF + 'const FE_STRIDE: i32 = ' + FE_STRIDE + ';';


// AN EYE IS A CELL LOOKUP, NOT A TEXTURE. Nine cells around the point, each holding one jittered eye
// of its own size; the nearest one that actually covers the point wins.
//
// FLOOR BEFORE i32, AND IT MATTERS. JS Math.floor(-0.5) is -1 and WGSL i32(-0.5) is 0, because the
// conversion truncates toward zero. A board on the far side of the pith has negative theta, so the
// direct conversion would put a whole half of the log one cell out and the eyes would step at the
// axis. floor() first, then convert.
//
// THE ARGUMENT SWAP IN THE SECOND HASH IS DELIBERATE and is in the app: jy keys on (cy2, cx2 + 7919)
// where jx keys on (cx2, cy2). Hashing the same pair twice would put every eye on the diagonal.
WGSL.woodEye = `
fn woodEye(th: f32, zp: f32, cell: f32, wFt: f32, rad: f32) -> f32 {
  // THE NEAR-PITH BOUND. A physical eye subtends wFt/rad, which runs away as rad falls; past about
  // half a cell the nine cells below stop covering it and eyes tear at the cell edges.
  let cap = 0.5 * cell * rad;
  let w = select(cap, wFt, wFt < cap);
  let w2 = w * w;
  let gx = i32(floor(th / cell));
  let gy = i32(floor(zp / cell));
  var best = 1.0;                                      // the SQUARED normalised distance, so 1 is a miss
  for (var i = -1; i <= 1; i = i + 1) {
  for (var j = -1; j <= 1; j = j + 1) {
    let cx2 = gx + i;
    let cy2 = gy + j;
    // 0.92 is as far as the jitter can go while the nine cells checked still cover every eye that
    // could reach this point; at 0.7 the eyes sat in visible diagonal rows.
    let jx = (f32(cx2) + 0.5 + (woodHash(cx2, cy2) - 0.5) * 0.92) * cell;
    let jy = (f32(cy2) + 0.5 + (woodHash(cy2, cx2 + 7919) - 0.5) * 0.92) * cell;
    // and each eye its own size, because a field of identical dots reads as a pattern, not as wood
    let sz = 0.5 + 1.0 * woodHash(cx2 + 104729, cy2 + 31337);
    let r2 = w2 * sz * sz;
    // the angular offset becomes an ARC: dx and dy are both lengths, so the test is a circle
    let dx = (th - jx) * rad;
    let dy = zp - jy;
    let d2 = dx * dx + dy * dy;
    // Order the candidates on d2/r2 and take the sqrt ONCE, at the end: both that and the cone
    // 1 - sqrt(d2/r2) fall monotonically in d, so they pick the same winner.
    if (d2 < r2) { let q = d2 / r2; if (q < best) { best = q; } }
  }
  }
  // A CONE, not a bump. Constant slope from centre to rim, so the ring boundaries it bends come out
  // EVENLY SPACED - the little contour map that reads as an eye.
  if (best < 1.0) { return 1.0 - sqrt(best); }
  return 0.0;
}`;

// HOW STAINED THIS POINT IS. A smooth field over the cross-section, thresholded: everything above
// the threshold is stained and nothing else is, so coverage is one declared number.
//
// The streaks run UP because the field's z frequency is a fiftieth of its cross-section frequency.
// Nearly constant along z means a patch in the section extrudes into a slowly drifting column,
// which is how a vessel runs, and it crosses the rings instead of following them.
WGSL.woodStain = `
fn woodStain(th: f32, rad: f32, zp: f32, inv: f32, thr: f32) -> f32 {
  let arc = th * rad;
  let v = fbm2(arc * inv, rad * inv + zp * inv * 0.02, 4211);
  // Saturating well before v = 1, because fbm2 never gets near it - normalising against 1 capped
  // the strongest stain at about a third of the token colour however hard it was driven.
  let s = (v - thr) / 0.18;
  if (v > thr) { return select(s, 1.0, s > 1.0); }
  return 0.0;
}`;

// ---- THE ARENA -----------------------------------------------------------------------------------
// One flat f32 buffer of named parts, the way glass's is, with the bases in the uniform. Written as
// accessors rather than inline indexing so a stride appears ONCE: FEWL is per-feature by RING and
// FEZW per-feature by SLICE, and that distinction cost two rounds to notice.
WGSL.woodArena = `
fn aLUT(i: i32) -> f32 { return ARR[E.oLUT + i]; }
fn aTV(i: i32) -> f32 { return ARR[E.oTV + i]; }
fn aTW(i: i32) -> f32 { return ARR[E.oTW + i]; }
fn aTS(i: i32) -> f32 { return ARR[E.oTS + i]; }
fn aTH(i: i32) -> f32 { return ARR[E.oTH + i]; }
fn aPAX(i: i32) -> f32 { return ARR[E.oPAX + i]; }
fn aPAY(i: i32) -> f32 { return ARR[E.oPAY + i]; }
fn aGINV(i: i32) -> f32 { return ARR[E.oGINV + i]; }
fn aZOFF(i: i32) -> f32 { return ARR[E.oZOFF + i]; }
fn aUREL(i: i32) -> f32 { return ARR[E.oUREL + i]; }
fn aRWL(i: i32) -> f32 { return ARR[E.oRWL + i]; }
fn aFSP(i: i32) -> f32 { return ARR[E.oFSP + i]; }
fn aFCZ(i: i32) -> f32 { return ARR[E.oFCZ + i]; }
fn aFWL(i: i32) -> f32 { return ARR[E.oFWL + i]; }
fn aFCHAR(i: i32) -> f32 { return ARR[E.oFCHAR + i]; }
fn aFZW(i: i32) -> f32 { return ARR[E.oFZW + i]; }
fn aWVA(i: i32) -> f32 { return ARR[E.oWVA + i]; }
fn aWZC(w: i32, z: i32) -> f32 { return ARR[E.oWZC + w * E.Z + z]; }
fn aWZS(w: i32, z: i32) -> f32 { return ARR[E.oWZS + w * E.Z + z]; }
// FE_STRIDE and the field order come from wood-real.mjs's FE_FIELDS. A shader that indexes by
// number and a packer that writes by name are a replica pair and drift silently, so the stride is
// repeated here once and check-wood-shader holds the two together.
fn aFE(q: i32, f: i32) -> f32 { return ARR[E.oFE + q * FE_STRIDE + f]; }
fn aFEAL(q: i32, i: i32) -> f32 { return ARR[E.oFEAL + q * E.NA + i]; }
fn aFEZW(q: i32, z: i32) -> f32 { return ARR[E.oFEZW + q * E.Z + z]; }
fn aFEWL(q: i32, k: i32) -> f32 { return ARR[E.oFEWL + q * E.K + k]; }
fn aGLUT(i: i32) -> f32 { return ARR[E.oGLUT + i]; }
fn aGTV(i: i32) -> f32 { return ARR[E.oGTV + i]; }
fn aGTW(i: i32) -> f32 { return ARR[E.oGTW + i]; }
fn aGEDGE(i: i32) -> f32 { return ARR[E.oGEDGE + i]; }`;

// ---- HALF ONE: EVERYTHING BUT THE KNOT -------------------------------------------------------------
// Returns the colour this point would be if no branch ran through it.
//
// THE w COMPONENT IS THE FALSE RETURN. The app returns false OUTSIDE THE LOG rather than clamping to
// the outermost ring, because clamping paints solid bark out to the slab edge and that reads as the
// renderer giving up - the truth is there is no wood there, and the caller draws the live edge of a
// board wider than the log it came from. Zero in w carries that.
//
// THE INVERSION RUNS TWICE ON PURPOSE. Once features, waves and eyes have moved the surface the
// rings are no longer circles, so "which ring is this point in" stops being a lookup on the radius.
// It is still a subtraction - take the concentric answer, correct by the deviation accumulated
// there, read again - and the deviation moves by well under a ring width per ring, so one
// refinement lands it.
//
// SQ IS SCRATCH, one slot per feature, because the app keeps a Float64Array of them across the two
// passes of that inversion rather than computing each feature's strength twice.
//
// AND IT IS PER INVOCATION, WHICH THE FIRST DRAFT GOT WRONG. It was written as workgroup scope,
// copying the app's one shared array, and at a workgroup of 64 that is 64 pixels writing the same
// four slots: feature strengths bleeding between neighbours, which would read as noise in the
// figure rather than as a crash. A function-local var is the fix, and it is also why SQ_MAX has to
// exist - a local array needs its length at compile time, where the app sizes one at run time.
WGSL.woodShadeBody = `
fn woodShadeBody(ddx: f32, ddy: f32, zi: i32, zp: f32, fu: f32, fv: f32) -> vec4<f32> {
  var SQ: array<f32, SQ_MAX>;
  let rad0 = sqrt(ddx * ddx + ddy * ddy);
  let rad = rad0 * aGINV(zi) + aZOFF(zi);
  if (rad > E.R) { return vec4<f32>(0.0, 0.0, 0.0, 0.0); }

  var li = 0;
  var eyeHold = 0.0;
  var fireW = 0.0;
  var fireCav = 0.0;

  if (E.NF > 0 || E.WAVY != 0 || E.EYES != 0 || E.HASFIRE != 0) {
    let inv = 1.0 / select(rad, 1e-9, rad == 0.0);
    var eyeG = 0.0;
    if (E.EYES != 0) {
      eyeG = woodEye(woodAtan2(ddy, ddx), zp, E.ECELL, E.ERADFT, rad0);
      // ORIENTATION. The needle runs along the radius, so what decides whether this face shows an
      // eye or a faint fleck is how square it is to that needle - one dot product, and the whole
      // quarter-versus-flat behaviour comes out of it.
      let iv3 = 1.0 / select(rad0, 1e-9, rad0 == 0.0);
      let sq2 = (ddx * iv3) * E.pnx + (ddy * iv3) * E.pny;
      eyeG = eyeG * select(sq2, -sq2, sq2 < 0.0);
      eyeHold = eyeG;
    }
    var wsum = 0.0;
    if (E.WAVY != 0) {
      // THE CHEBYSHEV RECURRENCE, which is where the integer-wavenumber constraint earns its keep:
      // k, 2k and 3k are three more multiplies each, not three sines.
      let ct = ddx * inv;
      let st = ddy * inv;
      var ck = 1.0;
      var sk = 0.0;
      for (var h = 0; h < E.WK; h = h + 1) { let x = ck * ct - sk * st; sk = sk * ct + ck * st; ck = x; }
      var hc = ck;
      var hs = sk;
      for (var i = 0; i < E.NW; i = i + 1) {
        wsum = wsum + hs * aWZC(i, zi) + hc * aWZS(i, zi);
        let x = hc * ck - hs * sk; hs = hs * ck + hc * sk; hc = x;
      }
    }
    for (var q = 0; q < E.NF; q = q + 1) {
      let ca = (ddx * aFE(q, FE_ux) + ddy * aFE(q, FE_uy)) * inv;
      let ai = i32((ca + 1.0) * 0.5 * f32(E.NA - 1));
      SQ[q] = aFE(q, FE_amp) * aFEAL(q, ai) * aFEZW(q, zi);
    }
    let gi0 = i32(rad * E.KS);
    let ur = aUREL(gi0);
    let rw = aRWL(gi0);
    // THE FIRE, pulling the surface IN over its sector. Its contribution is SUBTRACTED from the
    // radius, which is the one direction everything else here is forbidden to move.
    if (E.HASFIRE != 0) {
      let iv = 1.0 / select(rad0, 1e-9, rad0 == 0.0);
      let ca = (ddx * iv) * E.ffx + (ddy * iv) * E.ffy;
      if (ca > E.fcOut) {
        let den = select(E.fcIn - E.fcOut, 1e-9, (E.fcIn - E.fcOut) == 0.0);
        let sgs = select((ca - E.fcOut) / den, 1.0, ca >= E.fcIn);
        fireW = sgs * sgs * (3.0 - 2.0 * sgs) * aFZW(zi) * E.FSEV;
      }
    }
    // THE DIMPLE MOVES THE SURFACE INWARD, the one direction the foam model otherwise forbids, and
    // it is quoted in RING WIDTHS. Two parts: the BASE is the same dip on every annual layer, so
    // they keep their spacing however deep it goes; the RIPPLE is the stack of shallow cones that
    // varies BETWEEN layers, which is the one held under a ring width.
    let eBase = eyeG * E.EYES * E.eyeDepth;
    let eRip = select(0.7, eBase * 0.3, eBase * 0.3 < 0.7);
    let eyeD = (eBase + eRip * (ur * ur - 0.5)) * rw;

    var gi = i32(rad * E.KS);
    var dv = wsum * aWVA(gi) - eyeD - fireW * aFWL(gi);
    for (var q = 0; q < E.NF; q = q + 1) { dv = dv + SQ[q] * aFEWL(q, gi); }
    var rr = rad - dv;
    gi = i32(select(0.0, rr * E.KS, rr > 0.0));
    dv = wsum * aWVA(gi) - eyeD - fireW * aFWL(gi);
    for (var q = 0; q < E.NF; q = q + 1) { dv = dv + SQ[q] * aFEWL(q, gi); }
    rr = rad - dv;
    if (fireW > 0.0 && rr > E.R) { fireCav = fireW; }
    li = i32(select(0.0, rr * E.KS, rr > 0.0));
  } else {
    li = i32(rad * E.KS);
  }

  // THE FINE GRAIN IS NOT DECORATION. Without the second hash term wood reads as plastic.
  var w = aLUT(li)
        + (woodHash(i32(fv * 2600.0), 7) - 0.5) * 0.06
        + (woodHash(i32(fu * 1700.0), i32(fv * 2600.0)) - 0.5) * 0.035;
  w = clamp(w, 0.0, 1.25);
  var cr = E.lateR + (E.earlyR - E.lateR) * w;
  var cg = E.lateG + (E.earlyG - E.lateG) * w;
  var cb = E.lateB + (E.earlyB - E.lateB) * w;

  let h = aTH(li);
  if (h != 0.0) {
    let s = 0.55 + 0.45 * w;
    cr = cr + (E.heartR * s - cr) * h;
    cg = cg + (E.heartG * s - cg) * h;
    cb = cb + (E.heartB * s - cb) * h;
  }

  // VALUE AND WARMTH, BELOW THE BLEND, mirroring the painter. The conversion above is a lerp, so at
  // h = 1 it is a full replacement and anything applied before it is wiped - which on a log whose
  // sapwood is a thin shell is the whole board. At h = 0 this is the same expression in the same
  // order as before the move, so sapwood is bit-identical and only the overwritten pixels change.
  let mv = 1.0 + aTV(li);
  let mw = aTW(li) * 26.0;
  cr = cr * mv + mw;
  cg = cg * mv;
  cb = cb * mv - mw;
  // SATURATION, a scale about this pixel's OWN luma. Value moves all three channels together and
  // warmth trades red against blue; neither can make wood more or less COLOURED.
  //
  // AFTER THE HEARTWOOD BLEND, mirroring the painter, and for the reason recorded there: at h = 1
  // the conversion is a full replacement, so saturation applied above it is wiped across the whole
  // board on any log whose sapwood is a thin shell.
  //
  // THE BRANCH MIRRORS THE PAINTER'S TOO. With the amplitude at zero every TS entry is zero and ms
  // is exactly 1, but g + (cr - g) * 1.0 is not bit-identical to cr in f32 - it is a subtract and
  // an add back. The CPU gates on the same scalar, so gating here is what keeps the two arms equal
  // rather than nearly equal.
  if (E.SATD != 0.0) {
    let ms = 1.0 + aTS(li);
    let g = 0.299 * cr + 0.587 * cg + 0.114 * cb;
    cr = g + (cr - g) * ms; cg = g + (cg - g) * ms; cb = g + (cb - g) * ms;
  }

  if (E.MINL != 0.0) {
    let ms = woodStain(woodAtan2(ddy, ddx), rad0, zp, E.MINV, E.MTHR) * E.MINL;
    if (ms > 0.0) {
      cr = cr + (E.minR - cr) * ms;
      cg = cg + (E.minG - cg) * ms;
      cb = cb + (E.minB - cb) * ms;
    }
  }
  // FIGURE. The dark bands are the fibres diving away from the light, which is why turning the
  // light reverses the ribbon - that reversal is the whole tell of real figure.
  if (E.GLOSS != 0.0 && E.pnz == 0.0) {
    let iv2 = 1.0 / select(rad0, 1e-9, rad0 == 0.0);
    let rx = ddx * iv2;
    let ry = ddy * iv2;
    let dNr = rx * E.pnx + ry * E.pny;
    let dNt = -ry * E.pnx + rx * E.pny;
    let eh3 = eyeHold * eyeHold * eyeHold;
    var m = 1.0 + E.GLOSS * E.LIT * (aFSP(li) * dNt + aFCZ(zi) * dNr)
          - E.GLOSS * eh3 * E.EYES * 0.38;
    if (!(m > 0.0)) { m = 0.0; }
    cr = cr * m; cg = cg * m; cb = cb * m;
  }
  // CHAR, toward soot, which is warmer than neutral black.
  let chw = select(select(0.0, fireW * aFCHAR(li), fireW > 0.0), fireCav, fireCav > 0.0);
  if (chw > 0.0) {
    let m2 = 1.0 - select(0.72, 0.88, fireCav > 0.0) * chw;
    cr = cr * m2; cg = cg * m2 * 0.94; cb = cb * m2 * 0.88;
  }
  return vec4<f32>(cr, cg, cb, 1.0);
}`;

// ---- HALF TWO: THE KNOT FACE -----------------------------------------------------------------------
// KN is the ONE feature carrying a knot face - the app finds it once per paint with
// FE.find(f => f.kn > 0) - and E.KNI is its index, or -1 when the tree has none.
//
// IT REPLACES THE COLOUR RATHER THAN BLENDING INTO IT. Everything above this is the wood the branch
// grew THROUGH; inside the cone there is no trunk ring to tint, there is branch. The w component
// says whether the point landed inside, and the caller takes xyz only when it did.
//
// THE CONE, NOT A CYLINDER. rb grows with distance along the branch, and a dead one stopped gaining
// rings when it died - te clamps the length that counts, which is what makes an encased knot a cone
// frozen at its burial and a live one a cone that is still widening.
//
// q2 IS PYTHAGORAS WITH THE ALONG-AXIS PART SUBTRACTED, and it is clamped at zero because floating
// point can take it a hair negative on the axis itself, where the answer is exactly zero.
WGSL.woodKnot = `
fn woodKnot(ddx: f32, ddy: f32, zp: f32, zi: i32, rad: f32, rad0: f32) -> vec4<f32> {
  if (E.KNI < 0) { return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
  let k = E.KNI;
  let dzz = zp - aFE(k, FE_zc);
  let tt = ddx * aFE(k, FE_ax) + ddy * aFE(k, FE_ay) + dzz * aFE(k, FE_az);     // along the branch, from the pith
  let r0 = aFE(k, FE_r0);
  let rDie = aFE(k, FE_rDie);
  if (!(tt > r0 && tt <= rDie)) { return vec4<f32>(0.0, 0.0, 0.0, 0.0); }

  let te = select(rDie, tt, tt < rDie);                             // it stopped gaining rings when it died
  let rb = aFE(k, FE_kn) * (te - r0);
  let ss = ddx * aFE(k, FE_px) + ddy * aFE(k, FE_py);
  let q2 = max(0.0, rad0 * rad0 + dzz * dzz - tt * tt);
  if (!(q2 < rb * rb)) { return vec4<f32>(0.0, 0.0, 0.0, 0.0); }

  var dd = sqrt(q2);
  if (E.WAVY != 0) {
    // THE SAME WAVE FAMILY, ON THE BRANCH'S OWN PERPENDICULARS. The trunk's harmonics are taken
    // around the pith; here they are taken around the branch axis, which is why qx/qy/qz exist at
    // all - the second perpendicular, so the recurrence has a plane to turn in.
    let bb = ddx * aFE(k, FE_qx) + ddy * aFE(k, FE_qy) + dzz * aFE(k, FE_qz);
    let iq = 1.0 / select(dd, 1e-9, dd == 0.0);
    let bc = ss * iq;
    let bs = bb * iq;
    var ck = 1.0;
    var sk = 0.0;
    for (var h = 0; h < E.WK; h = h + 1) { let x = ck * bc - sk * bs; sk = sk * bc + ck * bs; ck = x; }
    dd = dd + (sk * aWZC(0, zi) + ck * aWZS(0, zi)) * aWVA(i32(rad * E.KS)) * 0.5;
    if (dd < 0.0) { dd = 0.0; }
  }

  var kv = 1.0;
  var kcr = E.knotR;
  var kcg = E.knotG;
  var kcb = E.knotB;

  if (E.HASGRAFT != 0) {
    // GRAFTED: the branch takes its rings FROM THE SCION'S OWN TREE, not from a synthetic pitch.
    // aLoc is where along the scion's life this part of the branch sits, so an older part of the
    // stem reads an older ring - the walk is the recipe rather than a scatter.
    let aLoc = aFE(k, FE_ageN) * (rb / aFE(k, FE_rbMax));
    let hi = f32(E.Gn - 1);
    let aIx = i32(select(select(aLoc, hi, aLoc > hi), 1.0, aLoc < 1.0));
    let gRad = (dd / select(rb, 1e-9, rb == 0.0)) * aGEDGE(aIx);
    let gq = i32(gRad * E.GKS);
    let gl = select(E.GK - 1, gq, gq < E.GK);
    let gw = aGLUT(gl);
    let gmv = 1.0 + aGTV(gl);
    let gmw = aGTW(gl) * 26.0;
    kcr = (E.gLateR + (E.gEarlyR - E.gLateR) * gw) * gmv + gmw;
    kcg = (E.gLateG + (E.gEarlyG - E.gLateG) * gw) * gmv;
    kcb = (E.gLateB + (E.gEarlyB - E.gLateB) * gw) * gmv - gmw;
    kv = 1.0;
  } else {
    // UNGRAFTED: its own latewood, at its own pitch - a branch is a stem and has a stem's history,
    // and without this it reads as a drilled hole rather than as wood.
    let u2 = (dd * aFE(k, FE_kp)) % 1.0;
    let lt = select(0.0, (u2 - 0.72) / 0.28, u2 > 0.72);
    kv = 1.0 - 0.55 * lt * lt;
  }

  // THE RIM. An INTERGROWN knot joins the wood that grew around it and stays tight; one that was
  // PRUNED OR DIED gets a bark ring, and prune fades that ring out as the collar closes over it.
  let rim = dd / select(rb, 1e-9, rb == 0.0);
  if (aFE(k, FE_dead) != 0.0) {
    let pr = aFE(k, FE_prune);
    kv = kv * (0.72 + 0.2 * pr);                                    // sound heartwood is darker, not dead
    if (rim > 0.74) { kv = kv * (0.18 + (0.55 - 0.18) * pr); }
  } else if (rim > 0.88) {
    kv = kv * 0.55;
  }
  return vec4<f32>(kcr * kv, kcg * kv, kcb * kv, 1.0);
}`;

// ---- THE TWO HALVES, COMPOSED ----------------------------------------------------------------------
// The whole of shade. Written as a composition rather than one function so the integration can be
// BISECTED: render a wood tile both ways, and if it diverges, return early from woodKnot and
// measure again. The defect is then in one half or the other without needing a CPU twin for each,
// which gpu-port-harness cannot provide here - shade is a closure, not a top-level function, so
// liftFromApp has nothing to find.
//
// OUT OF RANGE IS A FALSE RETURN, NOT A COLOUR. The app returns false outside the log and the caller
// paints the surround, which is the live edge of a board wider than the log it came from. w carries
// that through both halves.
WGSL.woodShade = `
fn woodShade(ddx: f32, ddy: f32, zi: i32, zp: f32, fu: f32, fv: f32) -> vec4<f32> {
  let body = woodShadeBody(ddx, ddy, zi, zp, fu, fv);
  if (body.w == 0.0) { return body; }                               // outside the log
  let rad0 = sqrt(ddx * ddx + ddy * ddy);
  let rad = rad0 * aGINV(zi) + aZOFF(zi);
  let knot = woodKnot(ddx, ddy, zp, zi, rad, rad0);
  let c = select(body.xyz, knot.xyz, knot.w > 0.0);
  return vec4<f32>(clamp(c, vec3<f32>(0.0), vec3<f32>(255.0)), 1.0);
}`;

// ---- THE ENV, GENERATED ----------------------------------------------------------------------------
// NOT TYPED OUT. wood-real.mjs names every slot of its own uniform and this walks those two lists,
// so the struct and the packer cannot disagree about an order or a name: there is one list and two
// readers of it. The glass port does it the other way - a bare array there, a hand-written struct
// here - and that pair is why check-gpu-sync exists.
//
// WHAT THAT BUYS, CONCRETELY: a field the shader reads but nothing declares will not compile, and a
// field declared but never written makes packWood throw. The first draft of the body read E.EYESF
// twice; with a hand-written struct that is a plausible picture with the eyes switched off.
const chunk4 = (xs, ty) => {
  const out = [];
  for (let i = 0; i < xs.length; i += 4) {
    out.push('  ' + xs.slice(i, i + 4).map(n => n + ': ' + ty).join(', ') + ',');
  }
  return out.join(LF);
};
WGSL.woodEnv = 'struct Env {' + LF +
  chunk4(UNI_FLOAT_NAMES, 'f32') + LF +
  chunk4(UNI_INT_NAMES, 'i32') + LF +
  '}' + LF +
  '@group(0) @binding(2) var<uniform> E: Env;' + LF +
  '@group(0) @binding(3) var<storage, read> ARR: array<f32>;' + LF +
  'const SQ_MAX: i32 = ' + SQ_MAX + ';';

// ---- THE ENTRY POINT -------------------------------------------------------------------------------
// One invocation a pixel, and the whole of the port is three lines of it: work out where on the
// board this pixel is, ask shade, write three floats. Everything above was getting the field here.
//
// THE COORDINATE CONTRACT, AND IT IS NOT THE PAINTER'S. The CPU walks the canvas's own inverse
// affine incrementally - solve the row start, then one add per column - which is general for any
// transform and exact in slab space. A shader has no previous pixel to add to, so it would have to
// evaluate the affine per invocation; and for the tiling an export actually uses that affine is
// DIAGONAL, which makes the whole thing equal to normalising the pixel's position on the sheet.
// That is what the glass path does, so wood does the same and the two cannot drift apart over what
// a tile coordinate means. A rotated transform would need the real inverse and the pool refuses
// instead, because approximating one silently would move every pixel.
//
// zi TRUNCATES TOWARD ZERO on both sides - JS `| 0` and WGSL i32() agree - and cu cannot be
// negative after the clamp, so the low end needs no guard and the high end gets the app's own.
//
// THE SURROUND IS NOT A COLOUR THE SHADER CHOOSES. shade returns w = 0 outside the log, and a plank
// set wider than the tree is a LIVE EDGE rather than a failure; the app paints STONE_BG there and
// so does this, from the uniform, because deciding it here would be a second opinion about what
// the board's background is.
WGSL.woodMain = `
@group(0) @binding(0) var<storage, read_write> PX: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let n = u32(E.tileW * E.tileH);
  // TWO DIMENSIONS WHEN IT HAS TO BE. A 4096 px export tile plus bleed is past the 65,535
  // workgroups-per-dimension limit every implementation has, so the grid is split and this puts it
  // back together; a one-dimensional dispatch has nw.x alone and collapses to g.x.
  let gi = g.x + g.y * nw.x * 64u;
  if (gi >= n) { return; }
  let px = i32(gi) % E.tileW;
  let py = i32(gi) / E.tileW;

  let fw = f32(E.fullW);
  let su = (f32(E.tileX + px) + 0.5) / fw;
  let sv = (f32(E.tileY + py) + 0.5) / fw;
  // CLAMP, NEVER SKIP: the field extends by at most a pixel at its own edge, which is what any
  // sampler does. Skipping would leave the pixel unwritten, and that erases.
  let cu = clamp(su, 0.0, 1.0);
  let cvv = clamp(sv, 0.0, E.H);

  var zi = i32(cu * E.len * E.ZS);
  if (zi > E.Z - 1) { zi = E.Z - 1; }
  let yy = E.y0 + E.bandY + (cvv / E.H) * E.wid;      // across the plank, along the cut plane
  let c = woodShade(E.pcx - yy * E.cuy - aPAX(zi), E.pcy + yy * E.cux - aPAY(zi),
                    zi, cu * E.len, cu, cvv);
  let rgb = select(vec3<f32>(E.surR, E.surG, E.surB), c.xyz, c.w > 0.0);
  let o = gi * 3u;
  PX[o] = rgb.x;
  PX[o + 1u] = rgb.y;
  PX[o + 2u] = rgb.z;
}`;

// ---- THE WHOLE MODULE, ASSEMBLED ---------------------------------------------------------------------
// WOOD DOES NOT OWN EVERY FUNCTION IT CALLS. woodAtan2, woodHash and fbm2 were ported for glass and
// are already proven bit-identical to the app by gpu-port-harness, so wood inherits them rather than
// a second copy going unverified beside them. All three are pure - no E.*, no buffer - which is what
// makes them safe to lift into a module with a completely different Env.
//
// THE DEPENDENCY SET IS COMPUTED, NOT LISTED. A list would be a replica of the call sites, and the
// thing it would miss is the transitive step: fbm2 calls vnoise, vnoise calls nz, and neither of
// those appears anywhere in wood's own text. So this closes over the calls instead - take what is
// called and not defined, find the block that defines it, repeat - and a new call in a wood block
// pulls its dependency in with no edit here.
//
// NO EXEMPTION LIST OF BUILTINS, DELIBERATELY. An unresolved name is simply one no block defines, so
// clamp and select and `if` fall out for free; and a builtin wrongly left off such a list would have
// cost nothing anyway, which is the test of whether the list was load-bearing.
//
// THE ORDER OF WOOD'S OWN BLOCKS IS A FACT ABOUT THE SHADER and is written down: woodEnv declares the
// struct and the two bindings everything else reads, woodFields the record indices, and woodMain is
// the entry point that calls all of it. A block added and not placed here goes red rather than
// landing wherever the object happened to put it.
export const WOOD_ORDER = ['woodEnv', 'woodFields', 'woodEye', 'woodStain', 'woodArena',
                           'woodShadeBody', 'woodKnot', 'woodShade', 'woodMain'];

export function woodSource(GW) {
  const unordered = Object.keys(WGSL).filter(k => WOOD_ORDER.indexOf(k) < 0);
  if (unordered.length) throw new Error('woodSource: unplaced block(s) ' + unordered.join(', '));
  const mine = WOOD_ORDER.map(k => WGSL[k]).join(LF);

  const defs = s => [...s.matchAll(/fn ([A-Za-z_][A-Za-z0-9_]*)[ ]*[(]/g)].map(m => m[1]);
  const defined = new Set(defs(mine));
  const taken = [];
  // EIGHT PASSES IS NOT A GUESS AT THE DEPTH, it is a refusal to loop forever on a cycle. The real
  // chain is three deep today and the loop stops as soon as a pass adds nothing.
  for (let pass = 0; pass < 8; pass++) {
    const text = taken.map(k => GW[k]).join(LF) + LF + mine;
    const called = new Set([...text.matchAll(/([A-Za-z_][A-Za-z0-9_]*)[ ]*[(]/g)].map(m => m[1]));
    const add = [];
    for (const n of called) {
      if (defined.has(n)) continue;
      // THE BLOCK THAT DEFINES IT, if any block does. A name nothing defines is a builtin or a
      // keyword and needs no entry anywhere.
      const k = Object.keys(GW).find(k2 => typeof GW[k2] === 'string'
        && GW[k2].indexOf('fn ' + n + '(') >= 0);
      if (k && taken.indexOf(k) < 0 && add.indexOf(k) < 0) add.push(k);
    }
    if (!add.length) break;
    for (const k of add) { for (const d of defs(GW[k])) defined.add(d); }
    for (const k of add) taken.push(k);
  }

  // AND SORTED INTO GLASS'S OWN DECLARATION ORDER AT THE END, which is the correction that mattered.
  // Sorting per pass does not work: the first pass takes fbm2 and the second the vnoise it calls, so
  // appending by pass puts a function before the one it depends on. WGSL wants declaration before
  // use, so that is a compile error rather than a wrong picture - but it is a compile error nothing
  // in this repo can run, which makes it a defect that reaches a GPU to be found. glass-gpu.mjs is
  // written in dependency order already: nz, then vnoise, then fbm2.
  const order = Object.keys(GW);
  taken.sort((a, b) => order.indexOf(a) - order.indexOf(b));

  // AND THE READBACK, WHICH THE CLOSURE CANNOT FIND. pack, packTex, vfull and fblit are ENTRY
  // POINTS: the pool names them to createPipeline and no shader function calls them, so closing over
  // the call sites reaches none of the four. They are named here for exactly that reason and for no
  // other - a hand-written dependency is a liability, and the one that earns it is the one a
  // discoverable rule provably cannot discover.
  //
  // THEY NEED NOTHING OF GLASS. All four read PX, E.tileW, E.tileH and the Band uniform, every one
  // of which wood's Env also declares, so the two materials share one readback rather than wood
  // getting a second copy of the rounding argument that cost 76 channels to settle.
  const ENTRY = ['pack', 'tex'];
  const entry = ENTRY.filter(k => typeof GW[k] === 'string');

  return {
    code: taken.concat(entry).map(k => GW[k]).join(LF) + LF + mine,
    borrowed: taken.concat(entry),
  };
}

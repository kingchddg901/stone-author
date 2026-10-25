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

export const WGSL = {};

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
fn aTH(i: i32) -> f32 { return ARR[E.oTH + i]; }
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
fn aFE(q: i32, f: i32) -> f32 { return ARR[E.oFE + q * 20 + f]; }
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
// SQ IS A WORKGROUP-SCOPE SCRATCH, one slot per feature, because the app keeps a Float64Array of
// them across the two passes of that inversion rather than computing each feature's strength twice.
WGSL.woodShadeBody = `
fn woodShadeBody(ddx: f32, ddy: f32, zi: i32, zp: f32, fu: f32, fv: f32) -> vec4<f32> {
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
      let ca = (ddx * aFE(q, 1) + ddy * aFE(q, 2)) * inv;
      let ai = i32((ca + 1.0) * 0.5 * f32(E.NA - 1));
      SQ[q] = aFE(q, 0) * aFEAL(q, ai) * aFEZW(q, zi);
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
    let eBase = eyeG * E.EYESF * E.eyeDepth;
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
  let mv = 1.0 + aTV(li);
  let mw = aTW(li) * 26.0;
  var cr = (E.lateR + (E.earlyR - E.lateR) * w) * mv + mw;
  var cg = (E.lateG + (E.earlyG - E.lateG) * w) * mv;
  var cb = (E.lateB + (E.earlyB - E.lateB) * w) * mv - mw;

  // ...then the material state on top of it, and the ring keeps its own light and dark through the
  // conversion rather than being replaced by a flat heartwood colour.
  let h = aTH(li);
  if (h != 0.0) {
    let s = 0.55 + 0.45 * w;
    cr = cr + (E.heartR * s - cr) * h;
    cg = cg + (E.heartG * s - cg) * h;
    cb = cb + (E.heartB * s - cb) * h;
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
          - E.GLOSS * eh3 * E.EYESF * 0.38;
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

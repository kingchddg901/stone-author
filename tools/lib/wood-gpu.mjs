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

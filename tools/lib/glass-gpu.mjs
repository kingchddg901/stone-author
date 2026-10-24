// THE GLASS SHADER, one copy, shared by every tool that needs it.
//
// It grew inside tools/gpu-port-harness.html one function at a time, each proven against the app's
// own JS before the next went in - eighteen rows, sixteen functions, all 282 lines of the renderer's
// per-pixel path. It is lifted out here now that it has stopped changing and a second consumer wants
// it: the harness proves it function by function, the tile probe assembles it and times it, and a
// second copy would drift the first time either one is edited.
//
// THE CONTRACT. Three bindings: a uniform Env of scalars and arena offsets at 2, one storage arena
// of f32 at 3, and whatever the caller puts at 0 and 1. Twelve arrays live in that one arena because
// WebGPU guarantees only eight storage buffers a stage and twelve plus input and output is fourteen -
// raising the limit works on a desktop and fails on the floor of the spec.
//
// Entries are concatenated in dependency order; WGSL.env must come first.

export const NLC = String.fromCharCode(10);
const WGSL = {};

WGSL.env = `
struct Env {
  // the melt and the form
  TH: f32, RM: f32, RS: f32, FR: f32,
  FP: f32, FD: f32, SD: f32, INC: f32,
  SST: f32, MOB: f32, MST: f32, MW: f32,
  MSQ: f32, MJ: f32, CN: f32, TW: f32,
  LC: f32, LS: f32, CW: f32, CS: f32,
  LP: f32, STC: f32, WPH: f32, RLH: f32,
  RLtotal: f32, PX: f32, PY: f32, SLAB: f32,
  TH2: f32, CORD: f32, OPQ: f32, OREF: f32,
  kr: f32, kg: f32, kb: f32, LBR: f32,
  LBG: f32, LBB: f32, H2: f32, pad9: f32,
  // the integers
  form: i32, MR: i32, MB: i32, MCn: i32,
  STn: i32, WPnx: i32, WPny: i32, RLnx: i32,
  RLny: i32, RLn: i32, pad3: i32, pad4: i32,
  oWU: i32, oWV: i32, oMEX: i32, oMHL: i32,
  oMD: i32, oMRIM: i32, oBS: i32, oBV: i32,
  oRPR: i32, oRTL: i32, oSTS: i32, oMCC: i32,
  oSPIN: i32, oOPS: i32, nOps: i32, oCANE: i32,
  nCane: i32, tileW: i32, tileX: i32, tileY: i32,
  // tileH IS NOT ALWAYS tileW. A 4096 px export tile plus bleed is 4,104 square and its f32
  // intermediate is 202 MB, against a 128 MiB storage binding limit that every implementation
  // has - so the app renders such a tile in horizontal BANDS, each a short tile with its own
  // tileY. Below this line a band and a tile are the same thing.
  fullW: i32, tileH: i32, pad7: i32, pad8: i32,
};
@group(0) @binding(2) var<uniform> E: Env;
@group(0) @binding(3) var<storage, read> ARR: array<f32>;
fn aWU(k: i32) -> f32 { return ARR[E.oWU + k]; }
fn aWV(k: i32) -> f32 { return ARR[E.oWV + k]; }
fn aMEX(k: i32) -> f32 { return ARR[E.oMEX + k]; }
fn aMHL(k: i32) -> f32 { return ARR[E.oMHL + k]; }
fn aMD(k: i32) -> f32 { return ARR[E.oMD + k]; }
fn aMRIM(k: i32) -> f32 { return ARR[E.oMRIM + k]; }
fn aBS(k: i32) -> f32 { return ARR[E.oBS + k]; }
fn aBV(k: i32) -> f32 { return ARR[E.oBV + k]; }
fn aRPR(k: i32) -> f32 { return ARR[E.oRPR + k]; }
fn aRTL(k: i32) -> f32 { return ARR[E.oRTL + k]; }
fn aSTS(k: i32) -> vec4<f32> { let o = E.oSTS + k * 4; return vec4<f32>(ARR[o], ARR[o + 1], ARR[o + 2], ARR[o + 3]); }
fn aMCC(k: i32) -> f32 { return ARR[E.oMCC + k]; }
fn aSPIN(k: i32) -> f32 { return ARR[E.oSPIN + k]; }
fn aOP(i: i32, f: i32) -> f32 { return ARR[E.oOPS + i * 16 + f]; }
fn aCANE(i: i32, c: i32) -> f32 { return ARR[E.oCANE + (i % E.nCane) * 3 + c]; }
const PINF: f32 = 1e30;`;


WGSL.nz = `
fn nz(xi: i32, yi: i32, s: i32) -> f32 {
  var h: u32 = (u32(xi) * 374761393u) ^ (u32(yi) * 668265263u) ^ (u32(s) * 2246822519u);
  h = (h ^ (h >> 13u)) * 1274126177u;
  return f32(h ^ (h >> 16u)) / 4294967296.0;
}`;

// THE SAME RATIONAL, TERM FOR TERM. Not a better atan2 - a port. The app ships this approximation and
// the GPU path has to draw what the CPU path draws, so an IMPROVEMENT here would be a defect.
WGSL.woodAtan2 = `
fn woodAtan2(y: f32, x: f32) -> f32 {
  let ax = select(x, -x, x < 0.0); let ay = select(y, -y, y < 0.0);
  let mn = min(ax, ay); let mx = max(ax, ay);
  let a = mn / (mx + 1e-12);
  var r = a * (0.7853981634 - (a - 1.0) * (0.2447 + 0.0663 * a));
  if (ay > ax) { r = 1.5707963268 - r; }
  if (x < 0.0) { r = 3.1415926536 - r; }
  return select(r, -r, y < 0.0);
}`;

// A SELECTOR, NOT A COMPUTATION. form is an integer here because WGSL has no strings; the mapping is
// fixed in FORM below and both sides read it from the same place.
WGSL.glassFlow = `
fn glassFlow(ox: f32, oy: f32, form: i32) -> vec2<f32> {
  if (form == 1) {                                   // spun: radial, and it VARIES with position
    var r = sqrt(ox * ox + oy * oy);
    if (r == 0.0) { r = 1e-6; }
    return vec2<f32>(ox / r, oy / r);
  }
  if (form == 2) { return vec2<f32>(0.0, 0.0); }     // poured
  if (form == 3) { return vec2<f32>(0.0, 1.0); }     // blown
  return vec2<f32>(1.0, 0.0);                        // rolled and flattened run across the sheet
}`;

// A BILINEAR READ OF A GRID, and the first function here that needs a buffer. The app writes
// `fx | 0`, which truncates toward zero; i32() does the same, and cu is bounded to [0,1] so the two
// cannot part company on a negative.
WGSL.glassUnwarp = `
fn glassUnwarp(cu: f32, cvv: f32) -> vec2<f32> {
  let fx = cu * f32(E.WPnx - 1); let fy = (cvv / E.WPH) * f32(E.WPny - 1);
  var i0 = i32(fx); var j0 = i32(fy);
  if (i0 > E.WPnx - 2) { i0 = E.WPnx - 2; } if (i0 < 0) { i0 = 0; }
  if (j0 > E.WPny - 2) { j0 = E.WPny - 2; } if (j0 < 0) { j0 = 0; }
  // WRITTEN AS a + t*(b-a), NOT a*(1-t) + b*t. The two are the same algebraically and are not the
  // same in f32. This document's op chain divides the coordinate by 2.5 to 11.5 before each stir
  // sees it, while cu maps with a fixed slab-space centre, so tx reaches -200 on a 161-column grid
  // and every sample extrapolates far off the grid's edge. That is not a defect to clamp away - it
  // is where the material's fine detail comes from.
  //
  // At tx = -200 the shipped spelling forms u[k]*201 - u[k+1]*200: two numbers two hundred times
  // the answer, subtracted. About 7.6 bits of cancellation, which f64 absorbs out of its 53 and f32
  // cannot out of its 24 - and it was 64 levels on 3.1% of a tile. This spelling subtracts the two
  // grid values FIRST, while they are the same size, then scales the difference. Measured against
  // an f64 reference over the real coordinate windows: worst error 1.01e-4 the old way, 2.72e-6
  // this way, a factor of 37, and within about 6 ulps of what f32 can represent at all.
  let tx = fx - f32(i0); let ty = fy - f32(j0);
  let k = j0 * E.WPnx + i0; let k2 = k + E.WPnx;
  let ua = aWU(k) + tx * (aWU(k + 1) - aWU(k));
  let ub = aWU(k2) + tx * (aWU(k2 + 1) - aWU(k2));
  let va = aWV(k) + tx * (aWV(k + 1) - aWV(k));
  let vb = aWV(k2) + tx * (aWV(k2 + 1) - aWV(k2));
  let u = -(ua + ty * (ub - ua));
  let v = -(va + ty * (vb - va));
  return vec2<f32>(u, v);
}`;


// UNCACHED ON PURPOSE. vnoiseC is a per-thread last-cell cache and a GPU invocation has no previous
// sample to cache from, so what gets ported is vnoise. The cache never changes the ANSWER - it only
// skips recomputing it - so the value this has to match is the CPU's cached fbm2C all the same.
WGSL.vnoise = `
fn vnoise(x: f32, y: f32, s: i32) -> f32 {
  let fx = floor(x); let fy = floor(y);
  let xi = i32(fx); let yi = i32(fy);
  let tx = x - fx; let ty = y - fy;
  let sx = tx * tx * (3.0 - 2.0 * tx); let sy = ty * ty * (3.0 - 2.0 * ty);
  let a = nz(xi, yi, s); let b = nz(xi + 1, yi, s);
  let c = nz(xi, yi + 1, s); let d = nz(xi + 1, yi + 1, s);
  return (a * (1.0 - sx) + b * sx) * (1.0 - sy) + (c * (1.0 - sx) + d * sx) * sy;
}`;

WGSL.fbm2 = `
fn fbm2(x: f32, y: f32, s: i32) -> f32 {
  return vnoise(x, y, s) * 0.6 + vnoise(x * 2.1, y * 2.1, s + 9) * 0.3
       + vnoise(x * 4.3, y * 4.3, s + 19) * 0.1;
}`;

// THE RIBBON GEOMETRY. MEX, MHL, MD and MRIM are per-ribbon arrays; MOB and MST are scalars. The
// app writes its own min/max and abs out longhand as ternaries - select() and min()/max() are the
// same operations, not an improvement, and anything else would be a second implementation.
WGSL.ribbon = `
fn glassCellSDF(gc: f32, ga: f32, i: i32) -> f32 {
  let cx = (aMEX(i) + aMEX(i + 1)) * 0.5;
  let hw = (aMEX(i + 1) - aMEX(i)) * 0.5;
  let hh = aMHL(i);
  let r = min(hw, hh) * E.MOB;
  let ax = abs(gc - cx) - (hw - r);
  let ay = abs(ga) - (hh - r);
  let qx = max(ax, 0.0); let qy = max(ay, 0.0);
  let inner = max(ax, ay);
  return sqrt(qx * qx + qy * qy) + min(inner, 0.0) - r;
}
fn glassDepth(d: f32, i: i32) -> f32 {
  let lim = aMD(i); let rim = aMRIM(i);
  if (d <= -rim) { return 1.0; }
  var far = 1.0;
  if (d <= 0.0) { far = 0.0; } else if (lim > 0.0) { far = d / lim; }
  var edge = 1.0;
  if (d <= 0.0) { if (rim > 0.0) { edge = -d / rim; } else { edge = 1.0; } }
  let thin = 1.0 - (1.0 - 1.0 / E.MST) * far;
  return edge * thin;
}`;

// THE ROLLER. Two more grid reads, the same bilinear shape as glassUnwarp, plus a walk along the
// roller's own profile. B.total of zero is the app's guard against a roller that never moved.
WGSL.roller = `
fn rollerAt(cu: f32, cvv: f32) -> vec2<f32> {
  let fx = cu * f32(E.RLnx - 1); let fy = (cvv / E.RLH) * f32(E.RLny - 1);
  var i0 = i32(fx); var j0 = i32(fy);
  if (i0 > E.RLnx - 2) { i0 = E.RLnx - 2; } if (i0 < 0) { i0 = 0; }
  if (j0 > E.RLny - 2) { j0 = E.RLny - 2; } if (j0 < 0) { j0 = 0; }
  // the same stable spelling, for the same reason; see the note on glassUnwarp above
  let tx = fx - f32(i0); let ty = fy - f32(j0);
  let k = j0 * E.RLnx + i0; let k2 = k + E.RLnx;
  let sa = aBS(k) + tx * (aBS(k + 1) - aBS(k));
  let sb = aBS(k2) + tx * (aBS(k2 + 1) - aBS(k2));
  let va = aBV(k) + tx * (aBV(k + 1) - aBV(k));
  let vb = aBV(k2) + tx * (aBV(k2 + 1) - aBV(k2));
  let s = sa + ty * (sb - sa);
  let v = va + ty * (vb - va);
  return vec2<f32>(s, v);
}
fn rollerHand(s: f32) -> vec2<f32> {
  let n = E.RLn;
  var u = 0.0;
  if (E.RLtotal > 0.0) { u = s / E.RLtotal; }
  let f = clamp(u, 0.0, 1.0) * f32(n - 1);
  var i = i32(f); if (i > n - 2) { i = n - 2; } if (i < 0) { i = 0; }
  let g = f - f32(i);
  return vec2<f32>(aRPR(i) + (aRPR(i + 1) - aRPR(i)) * g, aRTL(i) + (aRTL(i + 1) - aRTL(i)) * g);
}`;


// THE SAME INTEGER SHAPE AS nz, so the same gate: bit-identical or the port is wrong. The app writes
// `| 0` after the multiply AND after the add, which is i32 wraparound; u32 wraps identically and is
// the only wrap WGSL actually defines - signed overflow there is an indeterminate value, not a wrap.
WGSL.woodHash = `
fn woodHash(a: i32, b: i32) -> f32 {
  var h: u32 = u32(a) * 374761393u + u32(b) * 668265263u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return f32(h ^ (h >> 16u)) / 4294967296.0;
}`;

// THE FORM BLOCK, shared by glassFormT and glassMelt. Scalars only; neither reaches an array.
WGSL.form = `
`;

// FIRST FUNCTION HERE WITH TRANSCENDENTALS IN IT. exp and sin are not IEEE-exact on a GPU and vary by
// vendor inside the allowed ULP budget - section 3 of glass-gpu.md is explicit that this is why the
// GPU path is a different renderer. So this row is expected to sit looser than the pure arithmetic
// ones, and HOW MUCH looser is a thing to measure rather than wave at.
WGSL.glassFormT = `
fn glassFormT(ox: f32, oy: f32, fv: vec2<f32>) -> f32 {
  var T = E.TH;
  if (E.RM > 0.0 && (fv.x != 0.0 || fv.y != 0.0)) {
    let a = ox * fv.x + oy * fv.y;
    let c = -ox * fv.y + oy * fv.x;
    T = T * (1.0 + E.RM * 0.30 * (fbm2(c * E.RS, a * E.RS * 0.06, 71) - 0.5) * 2.0);
  } else if (E.RM > 0.0) {
    T = T * (1.0 + E.RM * 0.18 * (fbm2(ox * E.RS * 0.5, oy * E.RS * 0.5, 11) - 0.5) * 2.0);
  }
  if (E.form == 1) {
    let r = sqrt(ox * ox + oy * oy);
    var k = 1.0;
    if (r < E.FR) { k = r / E.FR; }
    T = T * (1.0 - 0.45 * k);
    let b = r / (E.FR * 0.07);
    T = T + E.TH * 2.0 * exp(-b * b);
    T = T + E.TH * E.RM * 0.14 * sin(r * E.RS * 7.0);
  } else if (E.form == 4) {
    let u = ox * E.FP;
    let f = u - floor(u);
    T = T + E.TH * E.FD * (1.0 - abs(2.0 * f - 1.0));
  }
  return max(T, 0.05);
}`;

// A NINE-CELL WALK with an early a continue in it - the first ported function whose threads can take
// different numbers of iterations. On a CPU that is a branch; in a warp it is divergence, and this is
// a small taste of what glassLay will do at a much larger scale.
WGSL.glassMelt = `
fn glassMelt(ox: f32, oy: f32, fv: vec2<f32>) -> vec2<f32> {
  var o = vec2<f32>(0.0, 0.0);
  if (E.SD <= 0.0 && E.INC <= 0.0) { return o; }
  let flowing = fv.x != 0.0 || fv.y != 0.0;
  var ux = 1.0; var uy = 0.0; var drawn = 1.0;
  if (flowing) { ux = fv.x; uy = fv.y; drawn = E.SST; }
  let a0 = ox * ux + oy * uy;
  let c0 = -ox * uy + oy * ux;
  let cs = 0.06;
  let csa = cs * drawn;
  let gx = i32(floor(c0 / cs));
  let gy = i32(floor(a0 / csa));
  for (var i = -1; i <= 1; i = i + 1) {
    for (var j = -1; j <= 1; j = j + 1) {
      let cx = gx + i;
      let cy = gy + j;
      let h = woodHash(cx, cy + 991);
      let jx = (f32(cx) + 0.5 + (woodHash(cx, cy) - 0.5) * 0.8) * cs;
      let jy = (f32(cy) + 0.5 + (woodHash(cy, cx + 17) - 0.5) * 0.8) * csa;
      let dx = (c0 - jx) / (cs * 0.32);
      let dy = (a0 - jy) / (csa * 0.32);
      let d2 = dx * dx + dy * dy;
      if (d2 < 1.0) {
        let q = 1.0 - d2;
        if (h < E.SD) { o.x = max(o.x, q); }
        else if (h > 1.0 - E.INC) { o.y = max(o.y, q); }
      }
    }
  }
  return o;
}`;


// NO INFINITY IN WGSL, so the sentinel is a number no real p can reach. The app seeds p1 and p2 with
// Infinity and also returns it when sp <= 0; 1e30 stands in for both, and the p1 > 1 test that
// decides "every blob near here ran out first" behaves the same against either.
WGSL.blob = `
fn glassBlobDepth(d: f32, rr: f32) -> f32 {
  let lim = rr * (E.MSQ - 1.0); let rim = rr * 0.16;
  if (d <= -rim) { return 1.0; }
  var far = 1.0;
  if (d <= 0.0) { far = 0.0; } else if (lim > 0.0) { far = d / lim; }
  var edge = 1.0;
  if (d <= 0.0) { if (rim > 0.0) { edge = -d / rim; } else { edge = 1.0; } }
  return edge * (1.0 - (1.0 - 1.0 / E.MST) * far);
}
// TWENTY-FIVE NEIGHBOURS AND A RUNNING BEST TWO. Every thread does the same count of iterations here
// - the app's loop has no a continue - so this one does not diverge; glassLay is where that starts.
fn glassBlob(gc: f32, ga: f32) -> vec4<f32> {
  let s = E.MW; let sq = E.MSQ - 1.0;
  let gx = floor(gc / s); let gy = floor(ga / s);
  var p1 = PINF; var d1 = 0.0; var c1 = -1.0; var b1 = 0.0;
  var p2 = PINF; var d2 = 0.0; var c2 = -1.0; var b2 = 0.0;
  var R = 1;
  if (E.MSQ > 2.0) { R = 2; }
  for (var j = -R; j <= R; j = j + 1) {
    for (var i = -R; i <= R; i = i + 1) {
      let cx = i32(gx) + i; let cy = i32(gy) + j;
      let jx = (f32(cx) + 0.5 + (woodHash(cx, cy) - 0.5) * E.MJ) * s;
      let jy = (f32(cy) + 0.5 + (woodHash(cy, cx + 31) - 0.5) * E.MJ) * s;
      let rr = s * 0.5 * (0.62 + 0.3 * woodHash(cx + 5, cy + 11));
      let dx = gc - jx; let dy = ga - jy;
      let d = sqrt(dx * dx + dy * dy) - rr;
      let sp = rr * sq;
      var pp = PINF;
      if (d <= 0.0) { pp = d; } else if (sp > 0.0) { pp = d / sp; }
      let col = f32(i32(floor(woodHash(cx + 101, cy + 211) * E.CN)) % i32(E.CN));
      if (pp < p1) { p2 = p1; d2 = d1; c2 = c1; b2 = b1; p1 = pp; d1 = d; c1 = col; b1 = rr; }
      else if (pp < p2) { p2 = pp; d2 = d; c2 = col; b2 = rr; }
    }
  }
  var o = vec4<f32>(-1.0, -1.0, 0.0, 0.0);
  if (c1 < 0.0 || p1 > 1.0) { return o; }
  o.x = c1; o.w = glassBlobDepth(d1, b1);
  if (c2 >= 0.0 && d2 <= 0.0) { o.y = c2; o.z = glassBlobDepth(d2, b2); }
  return o;
}`;

// THE REAL atan2 HERE, not woodAtan2 - the app calls Math.atan2 in rollStampAt and the wood
// approximation elsewhere, and a port that tidied that away would draw a different star.
WGSL.stamp = `
fn starR(th: f32, R: f32) -> f32 {
  let s = 0.6283185307;                                           // pi / 5
  let r2 = R * 0.42;
  var a = th % (2.0 * s);
  if (a < 0.0) { a = a + 2.0 * s; }
  if (a > s) { a = 2.0 * s - a; }
  return R * r2 * sin(s) / (R * sin(a) + r2 * sin(s - a));
}
// A VARIABLE-LENGTH LOOP WITH FOUR EARLY EXITS AND A RETURN FROM THE MIDDLE. Threads take different
// numbers of iterations, so this is the first genuinely divergent function in the port.
fn rollStampAt(s: f32, v: f32) -> f32 {
  if (E.STn <= 0) { return 0.0; }
  let C = E.STC;
  var u = s % C;
  if (u < 0.0) { u = u + C; }
  for (var i = 0; i < E.STn; i = i + 1) {
    let st = aSTS(i);
    let R = st.z / 24.0;
    var du = u - (((st.x / 360.0) % 1.0 + 1.0) % 1.0) * C;
    if (du > C * 0.5) { du = du - C; } else if (du < -C * 0.5) { du = du + C; }
    if (du <= R && du >= -R) {
      let dv = v - st.y;
      if (dv <= R && dv >= -R) {
        let d2 = du * du + dv * dv;
        if (d2 <= R * R) {
          let rr = starR(atan2(dv, du) - st.w * 0.0174532925, R);
          if (d2 <= rr * rr) { return 1.0; }
        }
      }
    }
  }
  return 0.0;
}`;


// THE FUNCTION THE WHOLE RATIO RESTS ON. Three paths out of one entry: a blob delegation, a walk
// over every ribbon with a skip in it, and the procedural strips. Neighbouring pixels can take
// different ones, and on a GPU that is warp divergence - every thread in the group pays for the
// slowest path any of them takes. This is the first ported function where the SHAPE of the control
// flow, not its arithmetic, is what the measurement is about.
//
// out.x and out.y are cane INDICES and out.z, out.w their depths - the same split glassBlob has, and
// the same reason: section 3's dangerous class is the index, not the shade.
WGSL.glassLay = `
fn glassLay(gc0: f32, ga0: f32) -> vec4<f32> {
  var gc = gc0; var ga = ga0;
  if (E.MR != 0) {
    let r = sqrt(gc * gc + ga * ga);
    gc = woodAtan2(ga, gc) * (0.5 + r);
    ga = r;
  }
  if (E.MB != 0) { return glassBlob(gc, ga); }
  if (E.MCn > 0) {
    var i1 = -1; var p1 = PINF; var d1 = 0.0;
    var i2 = -1; var p2 = PINF; var d2 = 0.0;
    for (var i = 0; i < E.MCn; i = i + 1) {
      // the app writes !(md[i] >= 0), which also skips a NaN; >= 0.0 keeps that sense
      if (aMD(i) >= 0.0) {
        let d = glassCellSDF(gc, ga, i);
        var pp = PINF;
        if (d <= 0.0) { pp = d; } else if (aMD(i) > 0.0) { pp = d / aMD(i); }
        if (pp < p1) { p2 = p1; i2 = i1; d2 = d1; p1 = pp; i1 = i; d1 = d; }
        else if (pp < p2) { p2 = pp; i2 = i; d2 = d; }
      }
    }
    var o = vec4<f32>(-1.0, -1.0, 0.0, 0.0);
    if (i1 < 0 || p1 > 1.0) { return o; }
    o.x = f32(i32(aMCC(i1)));
    o.w = glassDepth(d1, i1);
    if (i2 >= 0 && d2 <= 0.0) { o.y = f32(i32(aMCC(i2))); o.z = glassDepth(d2, i2); }
    return o;
  }
  let c = gc + E.TW * ga;
  var pp = c * E.LC - ga * E.LS;
  pp = pp + E.CW * 0.25 * (fbm2(gc * E.RS * 0.35, ga * E.RS * 0.35, 311) - 0.5) * 2.0;
  let ph = pp * E.CS;
  let fl = floor(ph);
  let f = ph - fl;
  let cn = i32(E.CN);
  var i = i32(fl) % cn;
  if (i < 0) { i = i + cn; }
  var o = vec4<f32>(f32(i), -1.0, 0.0, 1.0);
  if (E.LP > 0.0) {
    if (f < E.LP) { o.y = f32((i + cn - 1) % cn); o.z = (E.LP - f) / E.LP; }
    else if (f > 1.0 - E.LP) { o.y = f32((i + 1) % cn); o.z = (f - 1.0 + E.LP) / E.LP; }
  }
  return o;
}`;


// THE OP CHAIN, WALKED BACKWARDS, ONE PIXEL AT A TIME. Five kinds behind one loop, and which arm a
// pixel takes depends on the slab rather than the pixel - so unlike glassLay every thread in a group
// runs the same sequence here. The divergence in this function is in rollStampAt underneath it.
//
// WHAT THIS DOES NOT PORT, and it matters for assembly rather than for correctness: op.B and op.S
// are a PER-OP roller grid and warp grid in the app, and here every press reads the one synthetic
// roller and every stir the one synthetic warp. The arithmetic of all five arms is exercised; the
// plumbing that gives each op its own grid is a second arena offset per op and belongs with the tile
// assembly, not with proving the walk.
//
// SPIN_NB and SPIN_TURN are the app's own constants, and the table itself rides in the arena -
// 4,096 entries of interleaved cos and sin, two guard entries past the end so the lerp never reads
// off it, exactly as spinTable builds it.
WGSL.opchain = `
const SPIN_NB: f32 = 4096.0;
const SPIN_TURN: f32 = 0.15915494309189535;
fn glassUnform(x0: f32, y0: f32) -> vec3<f32> {
  var x = x0; var y = y0; var press = 0.0;
  for (var i = E.nOps - 1; i >= 0; i = i - 1) {
    let k = i32(aOP(i, 0));
    let ox = aOP(i, 1); let oy = aOP(i, 2);
    if (k == 1) {
      let px = x - ox; let py = y - oy;
      let ar = aOP(i, 3) * sqrt(px * px + py * py);
      let sq = ar * SPIN_TURN;
      let su = (sq - floor(sq)) * SPIN_NB;
      let si = i32(su); let sf = su - f32(si); let sj = si << 1u;
      let c1 = aSPIN(sj) + sf * (aSPIN(sj + 2) - aSPIN(sj));
      let s1 = aSPIN(sj + 1) + sf * (aSPIN(sj + 3) - aSPIN(sj + 1));
      x = ox + px * c1 + py * s1;
      y = oy - px * s1 + py * c1;
    } else if (k == 2) {
      let s = aOP(i, 4);
      x = ox + (x - ox) / s;
      y = oy + (y - oy) / s;
    } else if (k == 3) {
      let cd = aOP(i, 6); let sd = aOP(i, 7);
      if (aOP(i, 11) != 0.0) {
        let h = rollStampAt(x * cd + y * sd - aOP(i, 8), -x * sd + y * cd);
        press = max(press, h);
      }
      let s = aOP(i, 4);
      if (aOP(i, 5) != 0.0) {
        let a0 = x * cd + y * sd; let c0 = -x * sd + y * cd;
        let a1 = a0 / s; let c1 = c0 * s;
        x = a1 * cd - c1 * sd;
        y = a1 * sd + c1 * cd;
      } else { x = x / s; y = y * s; }
    } else if (k == 4) {
      if (aOP(i, 12) != 0.0) {
        let cu = (x - E.PX) * 12.0 / E.SLAB + 0.5;
        let cvv = (y - E.PY) * 12.0 / E.SLAB + 0.5 * E.WPH;
        let r = rollerAt(cu, cvv);
        let half = aOP(i, 9);
        if (r.y > -half && r.y < half) {
          let hh = rollerHand(r.x);
          let bite = aOP(i, 10) * hh.x * (1.0 + hh.y * (r.y / half));
          if (bite > 0.0) {
            let h = rollStampAt(r.x, r.y);
            if (h > 0.0) { press = max(press, h * min(bite, 1.0)); }
          }
        }
      }
    } else if (k == 5) {
      if (aOP(i, 13) != 0.0) {
        let cu = (x - E.PX) * 12.0 / E.SLAB + 0.5;
        let cvv = (y - E.PY) * 12.0 / E.SLAB + 0.5 * E.WPH;
        let w = glassUnwarp(cu, cvv);
        x = x + w.x * E.SLAB / 12.0;
        y = y + w.y * E.SLAB / 12.0;
      }
    }
  }
  return vec3<f32>(x, y, press);
}`;


// THE WHOLE PIXEL, ASSEMBLED. Everything above is a function the harness proved on its own; this is
// the order paintGlassContent runs them in, and the only new arithmetic is the colour stage at the
// end - three Beer-Lambert exponentials over absorptions the canes and the lay decide.
//
// WHAT IS LEFT OUT, deliberately, because none of it is per-pixel arithmetic a GPU would take over:
// supersampling (the renderer is at one sample a pixel on this slab, counted), the canvas write, and
// the relief slope, which needs glassFormTG rather than glassFormT and is cold here - REL is 0 on
// the slab this was measured against, which the call counter showed as fbm2G firing zero times.
WGSL.tile = `
@group(0) @binding(0) var<storage, read_write> PX: array<f32>;
// DISPATCHED IN TWO DIMENSIONS WHEN IT HAS TO BE. A 512 px tile is 4,096 workgroups and fits in one
// dimension; the exporter's 2048 px tile plus bleed is 2,056 square, which is 66,049 - past the
// 65,535 per-dimension limit every WebGPU implementation has. Every probe used 512 and none of them
// could have found this; the first thing to ask for a real export tile hit it immediately.
//
// num_workgroups rather than another uniform field, so a ONE-dimensional dispatch is unchanged:
// nw.y is 1 and g.y is 0 there, and the index collapses back to g.x.
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let n = u32(E.tileW * E.tileH);
  let gi = g.x + g.y * nw.x * 64u;
  if (gi >= n) { return; }
  let px = i32(gi) % E.tileW;
  let py = i32(gi) / E.tileW;

  // where this pixel sits on the sheet, exactly as the paint loop computes it
  let fw = f32(E.fullW);
  let ssu = (f32(E.tileX + px) + 0.5) / fw;
  let ssv = (f32(E.tileY + py) + 0.5) / fw;
  let cu = clamp(ssu, 0.0, 1.0);
  let cvv = clamp(ssv, 0.0, E.H2);
  let ox = E.PX + (cu - 0.5) * E.SLAB / 12.0;
  let oy = E.PY + (cvv / E.H2 - 0.5) * E.SLAB * E.H2 / 12.0;

  let u = glassUnform(ox, oy);
  let fv = glassFlow(ox, oy, E.form);
  var T = glassFormT(ox, oy, fv);
  let melt = glassMelt(u.x, u.y, fv);
  if (melt.x > 0.0) { T = T - E.TH2 * 0.5 * melt.x; }
  if (melt.y > 0.0) { T = T + E.TH2 * 0.6 * melt.y; }
  if (u.z > 0.0) { T = T - E.TH2 * 0.55 * u.z; }
  T = max(T, 0.05);
  if (E.OPQ > 0.0) { T = T + (E.OREF - T) * E.OPQ; }

  var m = 1.0 - 0.45 * melt.x + 0.25 * melt.y;
  m = max(m, 0.0);

  var ar = E.kr; var ag = E.kg; var ab = E.kb;
  if (E.CORD > 0.0) {
    let L = glassLay(u.x, u.y);
    if (L.x >= 0.0) {
      let i1 = i32(L.x);
      let s = E.CORD * 0.6 * L.w;
      ar = ar + s * aCANE(i1, 0); ag = ag + s * aCANE(i1, 1); ab = ab + s * aCANE(i1, 2);
      if (L.y >= 0.0) {
        let i2 = i32(L.y);
        let sw = s * L.z;
        ar = ar + sw * aCANE(i2, 0); ag = ag + sw * aCANE(i2, 1); ab = ab + sw * aCANE(i2, 2);
      }
    }
  }
  let o = i32(gi) * 3;
  PX[o] = E.LBR * exp(-ar * T) * m;
  PX[o + 1] = E.LBG * exp(-ag * T) * m;
  PX[o + 2] = E.LBB * exp(-ab * T) * m;
}`;

// PACKING TO BYTES ON THE GPU, SO THE FLOATS NEVER CROSS THE BUS.
//
// main writes f32 RGB - twelve bytes a pixel - and tools/gpu-sheet-probe.html measured that moving
// those off the GPU is 93% of a batched tile's wall clock. The canvas wants u8 RGBA, four bytes.
// So this reads the f32 buffer where it already lives and writes the bytes beside it; only the
// bytes are read back, and the floats stay on the device.
//
// RGBA, NOT RGB, AND THE WASTED BYTE PAYS FOR ITSELF. Three bytes a pixel is a third less to move,
// and it was what this did first - but ImageData is RGBA, so every pixel then needed a JS loop to
// spread 3 bytes into 4. Measured in the exporter at 2048: that loop was 14.6 ms of a 32.5 ms tile,
// 45% of it, while the extra byte costs about 3 ms of transfer. Writing RGBA makes the readback a
// single TypedArray.set - a memcpy - instead of 4.2 million iterations.
//
// A SEPARATE ENTRY POINT RATHER THAN A CHANGE TO main, deliberately. main is the thing
// gpu-port-harness.html proved function by function and gpu-tile-probe.html compares against the
// CPU; folding the pack into it would put the verified path and a new one in the same function.
//
// ROUNDING IS NOT A DETAIL HERE. The canvas stores through ToUint8Clamp, which rounds ties to even,
// and WGSL's round does the same - but "the spec says so" is not a measurement, so the probe
// compares these bytes against a Uint8ClampedArray of the f32 arm and counts how many exact ties
// the run contained. 660 of them, all agreeing, the first time it was asked.
WGSL.pack = `
@group(0) @binding(1) var<storage, read_write> PK: array<u32>;
@compute @workgroup_size(64)
fn pack(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let n = u32(E.tileW * E.tileH);
  let gi = g.x + g.y * nw.x * 64u;          // two dimensions when needed; see the note on main
  if (gi >= n) { return; }
  let o = gi * 3u;
  let r = u32(clamp(round(PX[o]), 0.0, 255.0));
  let gg = u32(clamp(round(PX[o + 1u]), 0.0, 255.0));
  let b = u32(clamp(round(PX[o + 2u]), 0.0, 255.0));
  PK[gi] = r | (gg << 8u) | (b << 16u) | 0xff000000u;
}`;

// PACKING INTO A TEXTURE, SO THE PIXELS NEVER REACH THIS THREAD AT ALL.
//
// WGSL.pack above writes bytes into a buffer and the main thread maps that buffer, which is 23.4 ms
// of a 28.2 ms tile - measured - and all of it this thread waiting for a device round trip. The
// bytes do not have to come here. A compute pass can write a storage TEXTURE, a render pass can
// blit that onto a canvas, and transferToImageBitmap hands the canvas to a worker without any
// pixel crossing into JS. Measured bare on one 2056-square tile: 8.0 ms of main thread becomes 0.2.
//
// THE CANVAS IS NOT THE STORAGE TARGET, and the first version of this made that mistake. A canvas
// is bgra8unorm, STORAGE_BINDING on that format is a validation error, and with no error scope the
// pass simply never ran - the pixel asked to be red came back black and the timing was the cost of
// doing nothing. So the compute pass writes an rgba8unorm texture we own, and the RENDER PASS
// converts into whatever the canvas is. That needs no feature flag and cannot swap channels,
// because the hardware converts rather than the shader guessing the order.
//
// ROUND BEFORE NORMALISING, OR IT IS A DIFFERENT PAINTER. A texture store takes 0..1 and quantises
// itself. Handing it PX[o]/255.0 lets the hardware resolve the tie, and it resolves 11.5% of them
// the other way from round(): 76 channels of 12,582,912, measured against the f32 arm over this
// document's 660 exact ties. round() first - the same call WGSL.pack uses - leaves an integer, and
// n/255*255 in f32 lands within 3e-5 of n for every n in 0..255, so there is no tie left to break.
// With it, 0 of 12,582,912. That is the difference between a faster readback and a new renderSig
// key, a resume that refuses across the switch, and every master re-dated.
//
// THE BAND OFFSET IS ITS OWN UNIFORM. PX holds one band at a time - a 4096 tile plus bleed wants
// 202 MB of f32 against a 128 MiB binding - while the texture is the whole tile, so the pack needs
// to know which rows it is writing. It goes in a buffer of its own rather than in a spare field of
// the 304-byte uniform, because that struct and glass-real.mjs's packer are a replica pair and a
// new meaning for a pad word would have to be reconciled in both.
WGSL.tex = `
struct Band { y0: i32, pad1: i32, pad2: i32, pad3: i32 }
@group(0) @binding(4) var TEX: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(6) var<uniform> BND: Band;
@compute @workgroup_size(8, 8)
fn packTex(@builtin(global_invocation_id) g: vec3<u32>) {
  let tw = u32(E.tileW);
  let th = u32(E.tileH);                      // this band's height, not the tile's
  if (g.x >= tw || g.y >= th) { return; }
  let o = (g.y * tw + g.x) * 3u;
  textureStore(TEX, vec2<i32>(i32(g.x), BND.y0 + i32(g.y)),
    vec4<f32>(clamp(round(PX[o]), 0.0, 255.0) / 255.0,
              clamp(round(PX[o + 1u]), 0.0, 255.0) / 255.0,
              clamp(round(PX[o + 2u]), 0.0, 255.0) / 255.0, 1.0));
}
// ONE TRIANGLE COVERS THE TARGET. Three vertices at (-1,-1), (3,-1), (-1,3) leave a right triangle
// whose clipped area is the whole clip space, which is one draw call and no index buffer.
@vertex
fn vfull(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var q = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  return vec4<f32>(q[i], 0.0, 1.0);
}
@group(0) @binding(5) var SRC: texture_2d<f32>;
// textureLoad AND NOT A SAMPLER: one texel to one pixel, nothing to interpolate and nothing to be
// inexact about. A sampler would put filtering between the shader and the file.
@fragment
fn fblit(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  return textureLoad(SRC, vec2<i32>(i32(pos.x), i32(pos.y)), 0);
}`;

export { WGSL };

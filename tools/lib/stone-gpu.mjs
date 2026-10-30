// STONE AS A COMPUTE SHADER — the third material through the same path.
//
// WHAT IT OWNS. renderOneTile lays the ground, calls its `paint` callback, then applies the coat and
// the reality windows. The callback REPLACES paintContent, so this shader owns what paintStoneContent
// owns and nothing more: the base modulators, then every content layer in authored order. The coat
// stays on the CPU, which is the only reason one dispatch is enough - applyCoat is twelve box-blur
// passes and a per-pixel shader cannot do those in one.
//
// WHY EACH PIECE LOOKS THE WAY IT DOES, every line of it measured against the CPU painter first:
//
//   THE GROUND IS LAID AGAIN HERE. clouds composites with soft-light, which needs its real backdrop;
//   source-over is associative and soft-light is not, so clouds cannot be floated on transparency and
//   blitted over the ground afterwards. Two flat fills are cheap to repeat and the face comes out
//   opaque.
//
//   SOFT-LIGHT IS THE W3C FORMULA, including the D(Cb) branch at Cb = 0.25. Measured over all 4,096
//   (Cb, Cs) pairs of a ramp cross: max 1, mean 0.244, no sample off by more than a level. The
//   Photoshop formula - the one that gets written from memory - is max 17 on the same grid.
//
//   CLOUDS IS BILINEAR OUT OF THE ARENA, not a texture, so stone needs no texture binding and the
//   pool needs no change: 200 x 125 is 25,000 floats. Canvas's own upscale is NOT bilinear - max 27,
//   mean 3.33 against it on a pure-noise source, and the same at 2.6x as at 20.5x, so it is a
//   different filter rather than a phase error. THROUGH THE REAL GROUND STACK it does not matter:
//   soft-light at layOp over a filled ground comes out at max 1, mean 0.011 with bilinear, where
//   Catmull-Rom - the obvious "better" filter - is max 3, mean 0.444. A source near 0.5 barely moves
//   its backdrop and the alpha scales it again, so chasing the intermediate number would have made
//   the picture forty times worse.
//
//   A FOG BLOB'S COLOUR FADES AS IT THINS. The gradient's far stop is `transparent`, rgba(0,0,0,0),
//   and canvas interpolates it UNPREMULTIPLIED - so the colour darkens toward black rather than
//   merely fading, repeated source-over stops being order-independent, and no product collapses a
//   plane. A closed form that assumed constant colour read ~50 levels light at mid-radius.
//
//   A VEIN STROKE IS A UNION OF CAPSULES. Every context that draws veins sets lineCap and lineJoin
//   to 'round', so coverage is min-distance-to-segment against half the width. Confirmed: interior
//   error against canvas is at most 3 levels, which is the per-stroke 8-bit compositing rounding.
//
//   AND THE COVERAGE RAMP IS A PIXEL/BAND OVERLAP, not clamp(hw - d + 0.5). That form gives 0.5
//   coverage for a zero-width stroke and his thinnest segments are sub-pixel - 0.00002 draw units is
//   0.08 px at 4096. Supersampling the union does NOT converge to canvas (ss 2/4/8/16/32 gives
//   boundary max 65/46/41/41/40, a plateau at 1024 samples a pixel, because Skia fills its own
//   flattened outline); this ramp sits at that same floor for one distance evaluation.
//
//   CHUNKS COMPOSITE ONE AT A TIME, IN ORDER. runs() strokes six segments per stroke() at alpha well
//   under 1, and consecutive chunks share a vertex, so their round caps overlap by a half-disc that
//   composites TWICE - a bead at every sixth segment. Four chunk composites against one composite of
//   the same path differ by max 73, mean 9.82. One distance field per line would be cleaner than
//   canvas and wrong by that much.

// THE PACKER'S OWN LISTS, so the struct below is generated rather than written twice. sync-gpu's
// strip() takes this statement off when it inlines the file, where both halves share one scope.
import { UNI_FLOAT_NAMES, UNI_INT_NAMES, LAY_STRIDE, LAY_FIELDS,
         CH_STRIDE, CH_FIELDS, POLY_STRIDE, POLY_FIELDS } from './stone-real.mjs';

// EXPORTED AT THE DECLARATION, AND THAT IS NOT A STYLE CHOICE. sync-gpu's strip() runs its drop
// regexes BEFORE it takes the export keyword off, so a bare `const WGSL = {}` is removed and a
// `export const WGSL = {}` survives - which is the difference between this block having its own
// registry and writing into GLASS's. The first spelling here was bare: stoneSource then saw
// glass's nineteen blocks as unplaced, and glass's own code() would have carried stone's.
export const WGSL = {};
const LF = String.fromCharCode(10);

// THE ENV, GENERATED FROM THE PACKER'S OWN LISTS, so the struct and the packer cannot drift. Four to
// a line only to keep it readable; WGSL does not care.
//
// AND THE FIELD INDICES ARE GENERATED TOO, which is not tidiness. The first spelling of stoneLayer
// indexed the layer record by hand-written numbers - cell at 25, cx at 23 - against a record whose
// cell is at 23 and cx at 21, so every layer would have read its grid out of its own padding and
// drawn nothing. The packer's own list is the only thing that knows where a field is.
const chunk4 = (names, ty) => {
  const out = [];
  for (let i = 0; i < names.length; i += 4)
    out.push('  ' + names.slice(i, i + 4).map(n => n + ': ' + ty).join(', ') + ',');
  return out.join(LF);
};

const idxOf = (list, n) => {
  const i = list.indexOf(n);
  if (i < 0) throw new Error('stone-gpu: no field named ' + n);
  return i;
};
const idxBlock = [
  ...['kind', 'alpha', 'colR', 'm0', 'offR', 'oPrim', 'nPrim', 'oCS', 'oCI']
    .map(n => 'const L_' + n.toUpperCase() + ': i32 = ' + idxOf(LAY_FIELDS, n) + ';'),
  ...['width', 'colR', 'alpha', 'oSeg', 'nSeg', 'blurS']
    .map(n => 'const C_' + n.toUpperCase() + ': i32 = ' + idxOf(CH_FIELDS, n) + ';'),
  ...['colR', 'alpha', 'oVert', 'nVert']
    .map(n => 'const P_' + n.toUpperCase() + ': i32 = ' + idxOf(POLY_FIELDS, n) + ';'),
].join(LF);

WGSL.env = `
struct Env {
${chunk4(UNI_FLOAT_NAMES, 'f32')}
${chunk4(UNI_INT_NAMES, 'i32')}
};
@group(0) @binding(0) var<storage, read_write> PX: array<f32>;
@group(0) @binding(2) var<uniform> E: Env;
@group(0) @binding(3) var<storage, read> ARR: array<f32>;
// SEVEN, EIGHT AND NINE, because 4, 5 and 6 are ALREADY TAKEN by the readback this shader borrows
// from glass: packTex declares 4 as its storage texture and 6 as its band uniform, and the blit takes
// 5. All of it is one module, where a binding may be declared once and with one type, so 4 here was a
// compile error - and the error a device reports for it names neither of the two declarations.
@group(0) @binding(7) var<storage, read> BSRC: array<f32>;
@group(0) @binding(8) var<storage, read_write> BDST: array<f32>;
@group(0) @binding(9) var<storage, read_write> BACC: array<f32>;

const LAY: i32 = ${LAY_STRIDE};
const CHS: i32 = ${CH_STRIDE};
const PYS: i32 = ${POLY_STRIDE};
fn aLay(i: i32, f: i32) -> f32 { return ARR[E.oLAY + i * LAY + f]; }
fn aCh(i: i32, f: i32) -> f32 { return ARR[E.oCH + i * CHS + f]; }
fn aPy(i: i32, f: i32) -> f32 { return ARR[E.oPOLY + i * PYS + f]; }

${idxBlock}`;

// THE W3C SOFT-LIGHT, per channel. D(Cb)'s branch at 0.25 is load-bearing: drop it and the dark half
// of every mottle is wrong, which reads as a flat picture rather than as a blend bug.
WGSL.stoneSoftLight = `
fn softLight1(cb: f32, cs: f32) -> f32 {
  var d = sqrt(cb);
  if (cb <= 0.25) { d = ((16.0 * cb - 12.0) * cb + 4.0) * cb; }
  if (cs <= 0.5) { return cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb); }
  return cb + (2.0 * cs - 1.0) * (d - cb);
}
fn softLight(cb: vec3<f32>, cs: f32) -> vec3<f32> {
  return vec3<f32>(softLight1(cb.x, cs), softLight1(cb.y, cs), softLight1(cb.z, cs));
}`;

// THE CLOUDS MOTTLE, bilinear out of the arena. Clamp-to-edge, and the sample is taken at the
// destination pixel's own centre mapped into texel space - the half-texel offset is exactly the kind
// of thing that reads as a faint overall shift rather than as a bug.
// THE THREE MODULATOR MAPS, bilinear out of the arena. Clamp-to-edge, and the sample is taken at the
// destination pixel's own centre mapped into texel space - the half-texel offset is exactly the kind
// of thing that reads as a faint overall shift rather than as a bug.
//
// ONE SAMPLER, THREE CALLERS. The clouds, the bands and the breccia are the same question asked of
// different maps - a small canvas built once over the whole slab and stretched across it - so the
// weights are worked out once here. bilin takes a STRIDE because breccia carries colour: it is a base
// SETTER rather than a modulator, so it is three floats a texel where the other two are one.
WGSL.stoneCloud = `
fn bilinW(w: f32, h: f32, u: f32, v: f32) -> vec4<f32> {
  let x = u * w - 0.5; let y = v * h - 0.5;
  return vec4<f32>(floor(x), floor(y), x - floor(x), y - floor(y));
}
fn bilin1(o: i32, w: f32, h: f32, u: f32, v: f32) -> f32 {
  let cw = i32(w); let ch = i32(h);
  if (cw <= 0 || ch <= 0) { return 0.5; }
  let q = bilinW(w, h, u, v);
  let x0 = i32(q.x); let y0 = i32(q.y); let tx = q.z; let ty = q.w;
  let xa = clamp(x0, 0, cw - 1); let xb = clamp(x0 + 1, 0, cw - 1);
  let ya = clamp(y0, 0, ch - 1); let yb = clamp(y0 + 1, 0, ch - 1);
  let p00 = ARR[o + ya * cw + xa]; let p10 = ARR[o + ya * cw + xb];
  let p01 = ARR[o + yb * cw + xa]; let p11 = ARR[o + yb * cw + xb];
  return mix(mix(p00, p10, tx), mix(p01, p11, tx), ty);
}
fn bilin3(o: i32, w: f32, h: f32, u: f32, v: f32) -> vec3<f32> {
  let cw = i32(w); let ch = i32(h);
  if (cw <= 0 || ch <= 0) { return vec3<f32>(0.0); }
  let q = bilinW(w, h, u, v);
  let x0 = i32(q.x); let y0 = i32(q.y); let tx = q.z; let ty = q.w;
  let xa = clamp(x0, 0, cw - 1); let xb = clamp(x0 + 1, 0, cw - 1);
  let ya = clamp(y0, 0, ch - 1); let yb = clamp(y0 + 1, 0, ch - 1);
  let a = o + (ya * cw + xa) * 3; let b = o + (ya * cw + xb) * 3;
  let c = o + (yb * cw + xa) * 3; let d = o + (yb * cw + xb) * 3;
  let p00 = vec3<f32>(ARR[a], ARR[a + 1], ARR[a + 2]);
  let p10 = vec3<f32>(ARR[b], ARR[b + 1], ARR[b + 2]);
  let p01 = vec3<f32>(ARR[c], ARR[c + 1], ARR[c + 2]);
  let p11 = vec3<f32>(ARR[d], ARR[d + 1], ARR[d + 2]);
  return mix(mix(p00, p10, tx), mix(p01, p11, tx), ty);
}
fn cloudAt(u: f32, v: f32) -> f32 { return bilin1(E.oCLOUD, E.cloudW, E.cloudH, u, v); }
fn bandAt(u: f32, v: f32) -> f32 { return bilin1(E.oBAND, E.bandW, E.bandH, u, v); }
fn brecAt(u: f32, v: f32) -> vec3<f32> { return bilin3(E.oBREC, E.brecW, E.brecH, u, v); }`;

WGSL.stoneSeg = `
fn segDist(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
  let v = b - a; let w = p - a;
  let vv = dot(v, v);
  var t = 0.0;
  if (vv > 0.0) { t = clamp(dot(w, v) / vv, 0.0, 1.0); }
  return length(w - v * t);
}`;

// A SPECK, WHICH IS A FILLED CLOSED PATH AND NOT A STROKE.
//
// TWO ANSWERS OUT OF ONE WALK: the crossing test says which side of the outline the pixel is on, and
// the min distance to the edges says how far. Together they are the signed distance, and coverage is
// the same pixel-band overlap the strokes use - for a shape wider than a pixel that expression
// reduces to clamp(0.5 - sd), so the two kinds ramp alike and a speck does not read sharper or
// softer than a vein of the same size.
//
// THE CROSSING TEST, NOT A HALFPLANE MAX, because a speck is star-shaped rather than convex: its
// vertices sit at equal angles with independent radii, so a deep notch between two long spikes is
// OUTSIDE the shape and inside every edge halfplane. The ray goes in +x from the pixel; the
// straddle guard is what makes the divide safe, since two vertices on the same side of p.y never
// reach it.
WGSL.stonePoly = `
fn polySD(p: vec2<f32>, o: i32, n: i32) -> f32 {
  var d = 1e30;
  var inside = false;
  var pj = vec2<f32>(ARR[o + (n - 1) * 2] * E.fullW - f32(E.tileX),
                     ARR[o + (n - 1) * 2 + 1] * E.fullW - f32(E.tileY));
  for (var i = 0; i < n; i = i + 1) {
    let pi = vec2<f32>(ARR[o + i * 2] * E.fullW - f32(E.tileX),
                       ARR[o + i * 2 + 1] * E.fullW - f32(E.tileY));
    d = min(d, segDist(p, pj, pi));
    if ((pi.y > p.y) != (pj.y > p.y)) {
      let t = (p.y - pi.y) / (pj.y - pi.y);
      if (p.x < pi.x + t * (pj.x - pi.x)) { inside = !inside; }
    }
    pj = pi;
  }
  if (inside) { return -d; }
  return d;
}`;

// A BLURRED STROKE, WITHOUT READING A NEIGHBOUR.
//
// This is the whole reason a blur can be on this path at all. A vein stroke is a union of
// round-capped capsules, and the convolution of a half-plane with a Gaussian is the normal CDF - so
// across a capsule, whose cross-section is a slab of width 2*hw, blurred coverage is the difference
// of two CDFs at the two edges. Nothing around the pixel is needed: the distance field already says
// where the edges are.
//
// EXACT ALONG THE STROKE, APPROXIMATE WITHIN SIGMA OF A CAP, where the local shape is a disc rather
// than a slab. At the radii this material uses - sigma about 1.1 output pixels against strokes tens
// of pixels wide - that is a fraction of one cap.
//
// phi IS THE TANH FORM, 0.5*(1 + tanh(0.7978845608*(x + 0.044715*x^3))), which is the Gaussian CDF
// to about 1e-4 - two orders inside the 8-bit quantisation it is feeding.
WGSL.stonePhi = `
fn phi(x: f32) -> f32 {
  return 0.5 * (1.0 + tanh(0.7978845608 * (x + 0.044715 * x * x * x)));
}`;

// ONE CONTENT LAYER AT ONE PIXEL. Fog and marks share the loop because kinds INTERLEAVE in authored
// order - a vein layer sits between two fog runs in his own slab - so one list, one stride and a kind
// field to branch on. Each layer carries its own grid, which is why the matrix can be hoisted out of
// the primitive loop: a shared grid would need the layer decoded and its twelve numbers re-read per
// TEST, about 1800 reads against 72 for a six-plane run.
WGSL.stoneLayer = `
fn layerAt(li: i32, q: vec2<f32>, c: i32, acc0: vec3<f32>) -> vec3<f32> {
  var acc = acc0;
  let kind = i32(aLay(li, L_KIND));
  let oCS = i32(aLay(li, L_OCS));
  let oCI = i32(aLay(li, L_OCI));
  let oPrim = i32(aLay(li, L_OPRIM));

  if (kind == 0) {
    let lo = i32(ARR[E.oFCS + oCS + c]); let hi = i32(ARR[E.oFCS + oCS + c + 1]);
    let a = aLay(li, L_ALPHA);
    let col = vec3<f32>(aLay(li, L_COLR), aLay(li, L_COLR + 1), aLay(li, L_COLR + 2));
    let r0 = vec3<f32>(aLay(li, L_M0), aLay(li, L_M0 + 1), aLay(li, L_M0 + 2));
    let r1 = vec3<f32>(aLay(li, L_M0 + 3), aLay(li, L_M0 + 4), aLay(li, L_M0 + 5));
    let r2 = vec3<f32>(aLay(li, L_M0 + 6), aLay(li, L_M0 + 7), aLay(li, L_M0 + 8));
    let off = vec3<f32>(aLay(li, L_OFFR), aLay(li, L_OFFR + 1), aLay(li, L_OFFR + 2));
    for (var k = lo; k < hi; k = k + 1) {
      let b = E.oBLOB + (oPrim + i32(ARR[E.oFCI + oCI + k])) * 3;
      let bx = ARR[b] * E.fullW - f32(E.tileX);
      let by = ARR[b + 1] * E.fullW - f32(E.tileY);
      let br = ARR[b + 2] * E.fullW;
      let d = distance(q, vec2<f32>(bx, by));
      if (d < br) {
        let g = 1.0 - d / br;                  // the gradient parameter, 1 at the centre
        let sa = a * g;
        let src = col * g;                     // unpremultiplied: the colour fades too
        var cs = vec3<f32>(dot(r0, src), dot(r1, src), dot(r2, src)) + off;
        cs = clamp(cs, vec3<f32>(0.0), vec3<f32>(255.0));
        acc = cs * sa + acc * (1.0 - sa);
      }
    }
    return acc;
  }

  let lo = i32(ARR[E.oMCS + oCS + c]); let hi = i32(ARR[E.oMCS + oCS + c + 1]);

  // SPECKS SHARE THE MARK GRID, so the cell run is read before the kinds part: a cell list is a run
  // of primitive indices and only the layer record knows what they index.
  if (kind == 2) {
    for (var k = lo; k < hi; k = k + 1) {
      let pi = oPrim + i32(ARR[E.oMCI + oCI + k]);
      let o = E.oPV + i32(aPy(pi, P_OVERT)) * 2;
      let nv = i32(aPy(pi, P_NVERT));
      let sd = polySD(q, o, nv);
      let cov = clamp(0.5 - sd, 0.0, 1.0);
      if (cov > 0.0) {
        let col = vec3<f32>(aPy(pi, P_COLR), aPy(pi, P_COLR + 1), aPy(pi, P_COLR + 2));
        let sa = aPy(pi, P_ALPHA) * cov;
        acc = col * sa + acc * (1.0 - sa);
      }
    }
    return acc;
  }

  for (var k = lo; k < hi; k = k + 1) {
    let ci = oPrim + i32(ARR[E.oMCI + oCI + k]);
    let hw = aCh(ci, C_WIDTH) * E.fullW * 0.5;
    let col = vec3<f32>(aCh(ci, C_COLR), aCh(ci, C_COLR + 1), aCh(ci, C_COLR + 2));
    let a = aCh(ci, C_ALPHA);
    let os = E.oSEG + i32(aCh(ci, C_OSEG)) * 4;
    let ns = i32(aCh(ci, C_NSEG));
    var d = 1e30;
    for (var s = 0; s < ns; s = s + 1) {
      let j = os + s * 4;
      let p0 = vec2<f32>(ARR[j] * E.fullW - f32(E.tileX), ARR[j + 1] * E.fullW - f32(E.tileY));
      let p1 = vec2<f32>(ARR[j + 2] * E.fullW - f32(E.tileX), ARR[j + 3] * E.fullW - f32(E.tileY));
      d = min(d, segDist(q, p0, p1));
    }
    // THE UNBLURRED RAMP IS UNTOUCHED, and that matters: it is a pixel/band overlap rather than a
    // clamp, because a zero-width stroke would otherwise read 0.5 coverage and this material's
    // thinnest segments are sub-pixel. The blurred branch only runs where a blur was asked for, so
    // every existing picture comes out byte for byte as it did.
    let sg = aCh(ci, C_BLURS);
    var cov = clamp(min(0.5, d + hw) - max(-0.5, d - hw), 0.0, 1.0);
    if (sg > 0.0) { cov = clamp(phi((hw - d) / sg) - phi((-hw - d) / sg), 0.0, 1.0); }
    if (cov > 0.0) {
      let sa = a * cov;
      acc = col * sa + acc * (1.0 - sa);
    }
  }
  return acc;
}`;

// THE LAST BIT, SPENT THE WAY THE CANVAS SPENDS IT.
//
// A 2D context DITHERS a gradient - it has to, because eight bits across a slow ramp bands - and
// measured on one haze transition the painter never repeats a value along a scanline (51 levels,
// longest run 1, 99.9% of neighbours differ) while this shader, quantising the true value once,
// runs 62 to 157 identical pixels at a time. Both are smooth from a distance and both are an
// artefact up close: the painter's is a cross-hatch, this one's is a contour.
//
// AND IT IS NOT ONLY A LOOK. applyCoat's subsurface pass is a feature HIGH-PASS, so it amplifies
// whatever high-frequency content it is handed. Given the painter's dither it lifts it into a
// visible screen; given a banded ramp it has almost nothing to lift. That is the whole of the mean
// gap between the two renderers on a coated slab - measured against coat strength, 0.125 of 255 at
// subsurface 0 rising to 1.454 at 0.9, with the painter's standard deviation climbing 26.73 to
// 28.02 while this shader's sat flat at 25.6.
//
// SO THE SHADER DITHERS TOO. A 4x4 ordered matrix, the canonical Bayer, built arithmetically rather
// than from a table - verified against the published matrix, sixteen distinct values, mean offset
// exactly zero over the cell. Added before the readback quantises, it turns the quantisation error
// into a pattern instead of a step: no banding, and the coat is handed the texture it expects.
//
// ONE OFFSET FOR ALL THREE CHANNELS, deliberately. Dithering each channel independently is what
// gives the painter its colour cast in the haze - measured, R 16.217 against B 15.554 where this
// shader is neutral to three decimals. A common offset moves the luminance and leaves the hue.
//
// INDEXED BY ABSOLUTE POSITION, never by the position within a tile, or the pattern would restart
// at every tile edge and the seams would be the one thing a 43-gigapixel master cannot have. The
// mask with 3 is correct for a negative coordinate too, which the bleed produces at the first tile:
// two's complement AND takes the low two bits, which is the periodic answer.
WGSL.stoneDither = `
fn dither4(px: i32, py: i32) -> f32 {
  let x = px & 3; let y = py & 3;
  let xa = x & 1; let ya = y & 1;
  let xb = (x >> 1) & 1; let yb = (y >> 1) & 1;
  let fine = 2 * xa + 3 * ya - 4 * xa * ya;
  let coarse = 2 * xb + 3 * yb - 4 * xb * yb;
  return (f32(4 * fine + coarse) + 0.5) / 16.0 - 0.5;
}`;

// THE TILE. One invocation a pixel, the ground laid, the modulators over it, then every content layer
// in authored order. PX is three floats a pixel, which is what the borrowed readback entries read.
//
// TWO DIMENSIONS WHEN NEEDED, the same shape glass's main uses: a band of a 4096 tile is more
// invocations than one dimension of workgroups can address on every device.
WGSL.stoneBloom = `
// THE EMISSION BLOOM, ON THE SHADER. applyCoat draws it with two ctx.filter passes - 0.55 at a 3*bs
// token and 0.35 at 8*bs, composited 'lighter' over the tile's own content - and measured inside the
// pool that is 204.1 ms of a 680.4 ms worker tile, of which about half is the drawing. This is that
// drawing.
//
// WHAT IT MATCHES IS THREE BOX BLURS, NOT A GAUSSIAN. ctx.filter blur is the SVG feGaussianBlur
// approximation: d = floor(s * 3 * sqrt(2*PI) / 4 + 0.5), then three boxes - three of width d when d
// is odd, and when d is even one biased left, one biased right and one of d+1 centred. That is the
// target, and it is the cheap one: a box blur is O(1) a pixel with a running sum however wide it is,
// where a true Gaussian at this sigma would be 247 taps an axis. At 16,384 the two tokens are 49.15
// and 131.07, so d is 92 and 246 - both even, so both take the biased pair plus the odd one.
//
// ONE INVOCATION PER LINE, not per pixel, because the running sum has to walk the line in order. A
// 2844 square tile is 2844 threads an axis, which is poor occupancy and still far less total work
// than any parallel-per-pixel form of the same filter.
//
// OUTSIDE THE BUFFER READS ZERO, which is what the canvas does with the transparent black beyond its
// own edge - and it never shows, because the bleed is wider than the filter reaches: three boxes of
// 246 reach 369 px and coatReach lays 398. check-bleed is the gate on that.
//
// THE CONTENT IS KEPT IN BACC rather than PX, because PX is both the blur's source and the sum it is
// added back into. Two blurs of the SAME content, so the pristine copy has to outlive the first.
fn blSpan(mode: i32, d: i32) -> vec2<i32> {
  let m = mode % 3;
  if (m == 0) { let h = (d - 1) / 2; return vec2<i32>(-h, h); }   // centred; d is odd here
  if (m == 1) { return vec2<i32>(-(d / 2), d / 2 - 1); }          // the pixel boundary to the left
  return vec2<i32>(-(d / 2) + 1, d / 2);                          // and to the right
}
fn blAt(line: i32, t: i32, vert: bool) -> vec3<f32> {
  let len = select(E.tileW, E.tileH, vert);
  if (t < 0 || t >= len) { return vec3<f32>(0.0); }
  let q = select(line * E.tileW + t, t * E.tileW + line, vert);
  let o = q * 3;
  return vec3<f32>(BSRC[o], BSRC[o + 1], BSRC[o + 2]);
}
// A TILED TRANSPOSE, WHICH IS WHAT MAKES THE HORIZONTAL BLUR COALESCED.
//
// blbox walks a line with one thread, and which axis that is decides everything. Walking DOWN (vert)
// indexes threads along x, the unit stride, so a warp's 32 loads fall in one or two cache lines.
// Walking ACROSS indexes threads along y, so at 2844 wide the neighbouring threads of a warp are
// 34 KB apart and every lane is its own memory transaction. Measured: the bloom cost 80 ms a tile
// with three of its six passes an axis in that state.
//
// So nothing walks across any more. Transpose, do the vertical walk - which in transposed space IS
// the horizontal blur - transpose back, and do the vertical walk again. Both stages take the good
// path and blSpan's horizontal modes are now unreachable; they stay because the span arithmetic is
// shared and a mode is cheaper to keep than a second span function.
//
// COALESCED ON BOTH SIDES, which a naive transpose is not: reading DST[y][x] = SRC[x][y] directly
// makes one of the two strided. A 32-square block goes through workgroup memory so that both the
// read and the write run along x. The 33 stride is the usual padding against bank conflicts, and
// three separate f32 planes rather than one vec3 array because a workgroup vec3 pads to 16 bytes
// and 32*33*16 would not fit the 16 KB a workgroup gets.
var<workgroup> TR0: array<f32, 1056>;
var<workgroup> TR1: array<f32, 1056>;
var<workgroup> TR2: array<f32, 1056>;
@compute @workgroup_size(32, 8)
fn bltrans(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_id) l: vec3<u32>) {
  let n = u32(E.tileW);                   // square: the bloom only runs where the band IS the tile
  let bx = wg.x * 32u; let by = wg.y * 32u;
  for (var r = 0u; r < 4u; r = r + 1u) {
    let ly = l.y + r * 8u;
    let x = bx + l.x; let y = by + ly;
    if (x < n && y < n) {
      let o = (y * n + x) * 3u; let q = ly * 33u + l.x;
      TR0[q] = BSRC[o]; TR1[q] = BSRC[o + 1u]; TR2[q] = BSRC[o + 2u];
    }
  }
  workgroupBarrier();
  for (var r = 0u; r < 4u; r = r + 1u) {
    let ly = l.y + r * 8u;
    let x = by + l.x; let y = bx + ly;     // the swapped block, so the write runs along x too
    if (x < n && y < n) {
      let o = (y * n + x) * 3u; let q = l.x * 33u + ly;
      BDST[o] = TR0[q]; BDST[o + 1u] = TR1[q]; BDST[o + 2u] = TR2[q];
    }
  }
}
@compute @workgroup_size(64)
fn blsave(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let i = i32(g.x + g.y * nw.x * 64u);
  if (i >= E.tileW * E.tileH * 3) { return; }
  BACC[i] = PX[i];
}
@compute @workgroup_size(64)
fn blbox(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let gi = i32(g.x + g.y * nw.x * 64u);
  let vert = E.blMode >= 3;
  let lines = select(E.tileH, E.tileW, vert);
  if (gi >= lines) { return; }
  let len = select(E.tileW, E.tileH, vert);
  let sp = blSpan(E.blMode, E.blD);
  let w = f32(sp.y - sp.x + 1);
  var sum = vec3<f32>(0.0);
  for (var k = sp.x; k <= sp.y; k = k + 1) { sum = sum + blAt(gi, k, vert); }
  // RESEEDING, WHICH IS AN EXPERIMENT AND NOT A FEATURE. blRS = 0 is the plain running sum; blRS = n
  // recomputes the window from scratch every n steps; blRS = 1 recomputes it at EVERY pixel, which
  // is the exact box blur with no accumulated drift at all and therefore the ground truth this is
  // measured against. If the shader's two-level deficit survives blRS = 1, f32 drift is not the
  // cause and the error is in the arithmetic.
  let rs = max(E.blRS, 1);
  for (var t = 0; t < len; t = t + 1) {
    if (E.blRS > 0 && t > 0 && (t % rs) == 0) {
      sum = vec3<f32>(0.0);
      for (var k = sp.x; k <= sp.y; k = k + 1) { sum = sum + blAt(gi, t + k, vert); }
    }
    let q = select(gi * E.tileW + t, t * E.tileW + gi, vert);
    let o = q * 3;
    let v = sum / w;
    BDST[o] = v.x; BDST[o + 1] = v.y; BDST[o + 2] = v.z;
    sum = sum + blAt(gi, t + 1 + sp.y, vert) - blAt(gi, t + sp.x, vert);
  }
}
// CLAMPED HERE AND NOT ONLY AT THE END, because 'lighter' clamps at every one of its own draws and
// a blown highlight is where that shows.
@compute @workgroup_size(64)
fn bladd(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let i = i32(g.x + g.y * nw.x * 64u);
  if (i >= E.tileW * E.tileH * 3) { return; }
  PX[i] = min(PX[i] + E.blGain * BSRC[i], 255.0);
}
// AND THE DITHER GOES ON HERE INSTEAD OF IN main. It is about the WRITE - which way a pixel rounds
// when the pack takes it to eight bits - so blurring it would spend it on nothing and leave the
// bloom to band. main skips it whenever blOn is set; this is the other half of that.
@compute @workgroup_size(64)
fn blmix(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let gi = i32(g.x + g.y * nw.x * 64u);
  let n = E.tileW * E.tileH;
  if (gi >= n) { return; }
  let ix = gi % E.tileW; let iy = gi / E.tileW;
  let dz = dither4(E.tileX + ix, E.tileY + iy);
  let o = gi * 3;
  PX[o] = clamp(PX[o] + dz, 0.0, 255.0);
  PX[o + 1] = clamp(PX[o + 1] + dz, 0.0, 255.0);
  PX[o + 2] = clamp(PX[o + 2] + dz, 0.0, 255.0);
}`;

WGSL.stoneTile = `
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let n = u32(E.tileW * E.tileH);
  let gi = g.x + g.y * nw.x * 64u;
  if (gi >= n) { return; }
  let p = i32(gi);
  let ix = p % E.tileW; let iy = p / E.tileW;
  let q = vec2<f32>(f32(ix) + 0.5, f32(iy) + 0.5);

  // SLAB COORDINATES, used by the mottle and by the grid lookup below.
  let cu = (f32(E.tileX) + q.x) / E.fullW;
  let cv = (f32(E.tileY) + q.y) / E.fullW;

  // THE GROUND, exactly as renderOneTile lays it: the backdrop, then groundCol at layOp('base').
  var acc = vec3<f32>(E.bgR, E.bgG, E.bgB);
  if (E.hasGround == 1) {
    let gnd = vec3<f32>(E.gndR, E.gndG, E.gndB);
    acc = gnd * E.gndOp + acc * (1.0 - E.gndOp);
  }

  // THE THREE MODULATORS, IN paintStoneContent's ORDER AND ITS BLENDS. Slab coordinates, so each
  // sample lands where the CPU's drawImage(0, 0, 1, H) puts it: u over the slab width, v over its
  // height. Breccia is first and is a base SETTER - plain source-over at its own opacity, carrying
  // colour - then the mottle and the bands modulate whatever base that left, both soft-light.
  if (E.hasBrec == 1 && E.brecOp > 0.0) {
    let bc = brecAt(cu, cv / 0.625);
    acc = bc * E.brecOp + acc * (1.0 - E.brecOp);
  }
  if (E.hasCloud == 1 && E.cloudOp > 0.0) {
    let cs = clamp(cloudAt(cu, cv / 0.625) / 255.0, 0.0, 1.0);
    let b = softLight(acc / 255.0, cs) * 255.0;
    acc = b * E.cloudOp + acc * (1.0 - E.cloudOp);
  }
  if (E.hasBand == 1 && E.bandOp > 0.0) {
    let bs = clamp(bandAt(cu, cv / 0.625) / 255.0, 0.0, 1.0);
    let b = softLight(acc / 255.0, bs) * 255.0;
    acc = b * E.bandOp + acc * (1.0 - E.bandOp);
  }

  // THE CELL IS GLOBAL, so it is found ONCE per pixel in draw space rather than per layer in tile
  // pixels - which is also what lets one packed grid serve every tile of a render.
  let cxi = clamp(i32(floor(cu * f32(E.gx))), 0, E.gx - 1);
  let cyi = clamp(i32(floor(cv / 0.625 * f32(E.gy))), 0, E.gy - 1);
  let c = cyi * E.gx + cxi;

  for (var li = 0; li < E.nLay; li = li + 1) {
    acc = layerAt(li, q, c, acc);
  }

  // The dither goes on LAST, after every layer, because it is about the write rather than the
  // arithmetic: it decides which way this pixel rounds when the readback takes it to eight bits.
  // SKIPPED WHEN THE BLOOM RUNS, which applies it after the blur instead - see WGSL.stoneBloom.
  let dz = select(dither4(E.tileX + ix, E.tileY + iy), 0.0, E.blOn == 1);
  let out = clamp(acc + vec3<f32>(dz), vec3<f32>(0.0), vec3<f32>(255.0));
  let o = p * 3;
  PX[o] = out.x; PX[o + 1] = out.y; PX[o + 2] = out.z;
}`;

// DECLARATION ORDER, because WGSL wants a function declared before it is used and a wrong order here
// is a compile error that only a real device reports.
const STONE_ORDER = ['env', 'stoneSoftLight', 'stoneCloud', 'stoneSeg', 'stonePhi', 'stonePoly',
                     'stoneLayer', 'stoneDither', 'stoneBloom', 'stoneTile'];

function stoneSource(GW) {
  const unplaced = Object.keys(WGSL).filter(k => STONE_ORDER.indexOf(k) < 0);
  if (unplaced.length) throw new Error('stoneSource: unplaced block(s) ' + unplaced.join(', '));
  const mine = STONE_ORDER.map(k => WGSL[k]).join(LF);

  // AND THE READBACK, WHICH NO CLOSURE CAN FIND. pack, packTex, vfull and fblit are ENTRY POINTS:
  // the pool names them to createPipeline and no shader function calls them, so walking call sites
  // reaches none of the four. They need nothing of glass - all four read PX, E.tileW, E.tileH and the
  // Band uniform, every one of which this Env also declares by those names, so the three materials
  // share one readback rather than stone getting a third copy of the rounding argument.
  const ENTRY = ['pack', 'tex'];
  const entry = ENTRY.filter(k => GW && typeof GW[k] === 'string');
  if (entry.length !== ENTRY.length) {
    throw new Error('stoneSource: the readback block(s) ' +
      ENTRY.filter(k => entry.indexOf(k) < 0).join(', ') + ' are not in the glass WGSL');
  }
  return { code: entry.map(k => GW[k]).join(LF) + LF + mine, borrowed: entry };
}

export { STONE_ORDER, stoneSource };

// THE LENS AS A COMPUTE SHADER — the last coat pass, and the first coat stage to leave the CPU.
//
// WHAT IT OWNS. One pixel of the coated tile. applyCoat has already laid the ground, the content, the
// bloom, the subsurface and the specular; this reads that picture and refracts it. It owns nothing
// else and knows nothing about the material underneath - see lens-real.mjs for why that keeps it out
// of stone-gpu.mjs.
//
// WHY IT CAN BE A KERNEL AT ALL, when the rest of the coat cannot. docs/stone-gpu.md puts it plainly:
// "applyCoat is twelve box-blur passes and a per-pixel shader cannot do those in one". The lens is
// not a box blur. It is a GATHER: every output pixel reads exactly one input pixel, at a position it
// computes from its own coordinates and nothing else. That is the one shape a per-pixel kernel is
// perfect for, and it is why this stage moves while the subsurface stays.
//
// MEASURED BEFORE IT WAS WRITTEN, which is the only reason it exists: the lens is 41.8% of a 32,768
// render (8.33 s of 19.91 s, by ablation), the subsurface 6.1%, and the GPU is at 47.6% mean while a
// 65,535 render runs - 0 of 33 samples at or above 80%, against a 4.3% idle floor. So the expensive
// stage is this one and the device has room for it. Had the GPU been pegged - as it is on a fog-heavy
// slab, where Skia's coat blur holds it at 87% - this would have been the wrong thing to build.
//
// NEAREST NEIGHBOUR, BY TRUNCATION, AND NOT A SAMPLER. This is the line to read twice. applyLens ends
//
//     const pX = fX | 0, pY = fY | 0;
//
// which is a truncation, so the stage is nearest-neighbour. A WGSL `sampler` with linear filtering is
// the obvious thing to reach for here and it would be WRONG - visibly softer everywhere the lens
// displaces, on every pixel, in a way no mean would flag as a defect because the mean barely moves.
// There is no sampler in this file. The source is a storage buffer and the gather indexes it, which
// is the same arithmetic the CPU does and cannot filter by accident.
//
// AND THE TRUNCATION HAPPENS IN THE PICTURE'S FRAME, BEFORE THE TILE'S ORIGIN COMES OFF. Also from
// applyLens, which carries the defect in its own comment: `(fX - vx) | 0` is the same geometry and
// not the same pixel. At column 0, row 64 of a 384px test picture the displacement is 1e-14 and fY
// lands on 63.99999999999999, which truncates to 63 - but add the bleed first and the sum has no
// double nearer than 70.0, so the tile reads row 64. One pixel, on one row, only where a tile
// boundary falls: the shape of a renderer that looks non-deterministic. vx and vy are whole pixels,
// so taking them off AFTERWARDS is exact.
//
// TWO BUFFERS, BECAUSE A GATHER CANNOT WRITE ITS OWN SOURCE. applyLens solves this with a band
// buffer; a kernel has no ordering at all, so the output is a second buffer and there is no band.
import { LENS_FLOAT_NAMES, LENS_INT_NAMES, UNI_PAD } from './lens-real.mjs';

// EXPORTED AT THE DECLARATION, AND THAT IS NOT A STYLE CHOICE - the same note stone-gpu.mjs carries.
// sync-gpu's strip() runs its drop regexes BEFORE it takes the export keyword off, so a bare
// `const WGSL = {}` is removed and this one survives, which is the difference between this block
// having its own registry and writing into glass's.
//
// IT ONLY BITES BECAUSE sync-gpu PASSES THIS FILE THAT DROP REGEX. It was first wired with an empty
// drop list, where the bare spelling would have been harmless - and check-gpu-block's leak check was
// therefore a claim that could not fail. The list is there now and the ablation goes red.
export const WGSL = {};
const LF = String.fromCharCode(10);

// THE UNIFORM, GENERATED FROM THE PACKER'S OWN LISTS, so the struct and the packer cannot drift. The
// pad comes from the list lengths too: a thirteenth scalar needs twelve bytes of padding, and a
// hand-written `_pad` is exactly the thing that stays at the old size when the list grows.
const pad = UNI_PAD ? LF + Array.from({ length: UNI_PAD }, (_, i) => `  _pad${i}: f32,`).join(LF) : '';
WGSL.lensEnv = `
struct LensEnv {
${LENS_FLOAT_NAMES.map(n => `  ${n}: f32,`).join(LF)}
${LENS_INT_NAMES.map(n => `  ${n}: i32,`).join(LF)}${pad}
};
@group(0) @binding(0) var<uniform> L: LensEnv;
@group(0) @binding(1) var<storage, read> LSRC: array<u32>;
@group(0) @binding(2) var<storage, read_write> LDST: array<u32>;
`;

// THE BRIGHTNESS, WHICH IS WHERE THE CAUSTIC COMES FROM. A ray bundle that converges carries the same
// light through less area, so the Jacobian of the displacement is a brightness: 1/|jac|, floored so a
// fold does not divide by nothing, and capped at 2.
//
// THE FLOOR AND THE CAP ARE BOTH REACHABLE AND BOTH MATTER. max(0.3, |jac|) puts a KINK in b, which
// is why folding this into the CPU's radial table was priced and rejected - across a kink linear
// interpolation is wrong to first order where the sinusoid is wrong to second. None of that applies
// here: there is no table, so b is evaluated exactly and the kink costs nothing. The cap cannot fire
// from the UI - it needs lens >= 1.224 against a slider that stops at 1 - but a loaded file reaches
// it, so it is kept and tools/check-lens-table.mjs pins the slider's range against it.
WGSL.lensBright = `
fn lensBright(j: f32) -> f32 {
  let m = 1.0 / max(0.3, abs(j));
  let b = 1.0 + L.caus * max(0.0, m - 1.0);
  return select(b, 2.0, b > 2.0);
}
`;

// THE FIELD. Three profiles, and the shapes are the reason fresnel is the expensive one:
//
//   reeded   displacement is a function of x ALONE, so the CPU lays it down as an array once per
//            tile and pays nothing per pixel. 17.9 ns/px measured.
//   water    a function of x and of y SEPARATELY, so two arrays - and the axes CROSS, dx comes from
//            y and dy from x. Not a transcription slip: applyLens reads `dx = dyr[y]; dy = dxc[x]`.
//   fresnel  a function of the DISTANCE from the centre, which is both coordinates at once and
//            cannot be an array. That is what cost a sin, a cos and two divides in every pixel.
//
// On the GPU all three cost about the same, which is the point: the profile that could not be
// precomputed is the one that stops needing to be.
//
// THE `r == 0.0` SUBSTITUTION IS THE SHIPPED BEHAVIOUR, kept rather than tidied. At the exact centre
// rx/r is 0/0; applyLens writes `|| 1` and so reads the field at r = 1 instead. Both displacements
// are multiplied by rx = ry = 0 and vanish either way, so the only thing that substitution decides is
// jac - and evaluating jac at r = 1 is what the CPU does, so it is what happens here.
WGSL.lensField = `
fn lensField(x: f32, y: f32) -> vec3<f32> {      // dx, dy, jac
  if (L.kind == 1) {
    let p = (x + L.vx) * L.k;
    return vec3<f32>(L.amp * sin(p), 0.0, 1.0 + L.amp * L.k * cos(p));
  }
  if (L.kind == 2) {
    return vec3<f32>(L.amp * sin((y + L.vy) * L.k), L.amp * sin((x + L.vx) * L.k), 1.0);
  }
  let rx = x + L.vx - L.cx;
  let ry = y + L.vy - L.cy;
  var r = sqrt(rx * rx + ry * ry);
  if (r == 0.0) { r = 1.0; }
  let sr = L.amp * sin(r * L.k) / r;
  return vec3<f32>(sr * rx, sr * ry, 1.0 + L.amp * L.k * cos(r * L.k));
}
`;

// THE GATHER. One invocation a pixel, and every clamp in the order applyLens does them.
//
// CLAMPED AT THE PICTURE'S EDGE FIRST, THEN AT THE TILE'S. The first is the lens's own behaviour and
// is identical on every path - it is what the stage does at the edge of the slab. The second can only
// bite when the bleed is short of lensReach, where it smears rather than reading a pixel the tile was
// never given, so if the two ever disagree it is the bleed that is wrong and not this.
//
// THE ALPHA IS NOT LIT. applyLens writes `o[oi + 3] = src[si + 3]` - the source alpha, untouched by
// b. A caustic brightens the light coming through, not the glass's coverage, and multiplying alpha
// here would make a refracted edge opaque.
WGSL.lensGather = `
@compute @workgroup_size(8, 8)
fn lensGather(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = u32(L.w);
  if (gid.x >= w || gid.y >= u32(L.h)) { return; }
  let x = f32(gid.x);
  let y = f32(gid.y);
  let f = lensField(x, y);
  let fX = clamp(x + L.vx + f.x, 0.0, L.fwm1);
  let fY = clamp(y + L.vy + f.y, 0.0, L.fhm1);
  let sx = clamp(i32(floor(fX) - L.vx), 0, L.w - 1);
  let sy = clamp(i32(floor(fY) - L.vy), 0, L.h - 1);
  let src = unpack4x8unorm(LSRC[u32(sy) * w + u32(sx)]);
  let lit = min(src.rgb * lensBright(f.z), vec3<f32>(1.0));
  LDST[gid.y * w + gid.x] = pack4x8unorm(vec4<f32>(lit, src.a));
}
`;

// ONE MODULE, ASSEMBLED IN DEPENDENCY ORDER. The env declares L before lensBright reads L.caus and
// before lensField reads L.k, and WGSL has no forward declarations for module-scope variables.
export const PARTS = ['lensEnv', 'lensBright', 'lensField', 'lensGather'];
export function lensCode() {
  const missing = PARTS.filter(p => !WGSL[p]);
  if (missing.length) throw new Error('lens-gpu: unplaced part(s) ' + missing.join(', '));
  return PARTS.map(p => WGSL[p]).join(LF);
}

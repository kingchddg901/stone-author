// Can a tile still lose its light?
//
// Two different defects hid behind the same symptom — a master that is whole, correctly sized, fully
// drawn, correctly signed, and dim:
//
//   TRUNCATION  bleed was sized against the blur radii that existed when it was written, and nothing
//               failed when wider ones were added. Gradual: 66% of the light at 3.9 sigma, 86% at 7.8.
//   LOST BLOOM  a large canvas paints perfectly and silently declines to blur. Total, and no reported
//               number predicts it: one tablet reported MAX_TEXTURE_SIZE 8192 and matched, the other
//               reported 4096 while rendering a correct 5670px canvas.
//
// So this gate is an INVENTORY plus a wiring check. Every blur in the app is declared with why it is
// safe, the reach arithmetic is executed rather than trusted, and the probe that catches the second
// defect must be wired where the plan can act on it.
//
//   node tools/check-bleed.mjs
import { readFileSync } from 'fs';

const app = readFileSync('app/stone-author.html', 'utf8');
const fail = [];

// ---- 1. the inventory ------------------------------------------------------------------------------
// covered  - coatRadius() accounts for it, so bleed grows with it
// excluded - cannot happen in a tile: the back light renders whole-image, the lens runs once on the
//            assembled picture, and the scratch helper is only reached from the back light
// output   - in output pixels, does not scale with the render; covered via maxAdjBlur / maxGlow
const DECLARED = {
  '3 * bs': 'covered',
  '8 * bs': 'covered',
  '(2 + 3 * ss) * bs': 'covered',
  '(1 + 2 * ss) * bs': 'covered',
  '2 * bs': 'covered',
  '0.6 * bs': 'covered',
  '5 * bs': 'excluded',
  '11 * bs': 'excluded',
  'px': 'excluded',              // blurCanvas, the back light's scatter scratch
  'sigma': 'excluded',           // bloomWorks probing the device, not rendering a tile
  'r': 'excluded',               // blurDraw's own filter call: the radius is the caller's, declared there
  '4': 'excluded',               // CAN_FILTER's fixed 4px support test on a 32px canvas
  "' + b + '": 'output',
};

// Match the interpolated expression whole. A lazy character class stops at the first `)`, which silently
// reduced `${(2 + 3 * ss) * bs}` to `(2 + 3 * ss` and then reported it as undeclared — a gate that mangles
// its own input reads as a finding about the code.
const found = new Set();
for (const m of app.matchAll(/blur\(\$\{(.+?)\}px\)/g)) found.add(m[1].trim());
for (const m of app.matchAll(/blur\((\d[\d.]*)px\)/g)) found.add(m[1].trim());
for (const m of app.matchAll(/'blur\('\s*\+\s*([\w$]+)/g)) found.add("' + " + m[1] + " + '");
// blurDraw is the choke point where a blur happens without naming a filter — WebKit has no ctx.filter,
// so the bloom goes through a pyramid there instead. Its radius argument counts as a blur in the
// inventory exactly like a filter string, or moving a blur behind it would hide it from this gate.
for (const m of app.matchAll(/blurDraw\([^,]+,\s*[^,]+,\s*([^,]+),/g)) found.add(m[1].trim());

for (const r of found) if (!(r in DECLARED)) fail.push(`undeclared blur radius \`${r}\` — is it reachable in a tile, and does coatRadius cover it?`);
for (const r of Object.keys(DECLARED)) if (!found.has(r)) fail.push(`declared blur \`${r}\` is no longer in the app — this inventory describes code that is gone`);

const radius = app.slice(app.indexOf('function coatRadius'), app.indexOf('function coatReach'));
if (!radius.includes('bs')) fail.push('coatRadius does not mention the coat scale at all');
for (const [r, why] of Object.entries(DECLARED)) {
  if (why !== 'covered') continue;
  const needle = r.replace(/\bss\b/, 'G.subsurface');
  if (!radius.includes(needle)) fail.push(`\`${r}\` is declared covered but coatRadius does not include \`${needle}\``);
}
if (!/shadowBlur\s*=\s*gl \* 6/.test(app)) fail.push('the artifact glow no longer sets shadowBlur = gl * 6 — the reach for it is wrong');
if (!/shadowReach\(6 \* maxGlow\(\)\)/.test(app)) fail.push('coatReach stopped accounting for the artifact glow');

// ---- 2. the arithmetic, executed -------------------------------------------------------------------
// blur(r) sets the DEVIATION to r. Believing it reaches r is the original defect, so run the real code.
const reachSrc = app.slice(app.indexOf('const blurReach ='), app.indexOf('const shadowReach'));
let blurReach;
try {
  blurReach = new Function('r', reachSrc + '\nreturn blurReach(r);');
  blurReach(1);
} catch (e) {
  fail.push('cannot execute blurReach from the app: ' + e.message);
  blurReach = null;
}
if (blurReach) {
  // 3r, not 1r: the conventional cut for a true Gaussian, and above the box approximation's exact 2.82r.
  // The original defect was a bleed of 1.5r believed to be a 50% margin.
  for (const r of [1, 8, 64, 524.3, 2000]) {
    const got = blurReach(r);
    if (!(got >= 3 * r)) fail.push(`blurReach(${r}) = ${got}, under 3r — the reach of a Gaussian is not its radius`);
  }
  if (blurReach(0) !== 0 || blurReach(-5) !== 0) fail.push('blurReach must be 0 for a blur that is not applied');
}
for (const m of app.matchAll(/bleed\s*=\s*[^;\n]*/g))
  if (/12 \* bs|12 \* \(W \/ COAT_REF\)/.test(m[0])) fail.push(`a bleed is back on the old constant: ${m[0].trim()}`);

// ---- 3. the bloom probe, wired where the plan can act on it ----------------------------------------
const plan = app.slice(app.indexOf('async function tiffPlan'), app.indexOf('async function exportTiff'));
if (!/const sigma = coatRadius\(/.test(plan)) fail.push('tiffPlan does not compute the slab blur radius, so it cannot probe for the bloom');
if (!/canvasFits\(ew, ew, 1, probeSigma\)/.test(plan)) fail.push('the plan probes the canvas without asking whether it BLURS');
// The proof records that a surface ALLOCATES. Whether it blurs is a different answer — and every one of
// tonight's bloomless masters read `proven` in its trail, meaning no probe ran at all.
if (!/proven >= ts && !\(probeSigma > 0\)/.test(plan)) fail.push('the tile proof bypasses the bloom probe: a proven tile must still be blur-tested');
// A blur cannot happen in place, so a blooming render peaks at about twice its canvas. Counting one
// surface is what let an 8192 pass through the budget and then fail to allocate on the device.
// Count what is alive AT ONCE: the tile, and at the peak inside compositeWindow the alternate-light
// render and the masked copy too, plus one transient scratch if anything blurs. Over-counting is not the
// safe direction — five surfaces put a tablet four megabytes over budget at 2048 and sent it halving to a
// 512 tile: 51x overdraw and 10,240 passes.
if (!/const surfaces = \(wins \? 3 : 1\) \+ \(sigma > 0 \? 1 : 0\)/.test(plan) || !/need = ew \* ew \* 4 \* surfaces/.test(plan))
  fail.push('the budget no longer counts simultaneous surfaces, so it will either wave through a pass the device cannot hold or halve away from one it can');
// The canvas is ts + 2 x bleed, so below the bleed halving doubles the passes and barely shrinks the
// canvas. Derived from the bleed, which is derived from the slab — not a fitted floor.
if (!/ts <= Math\.max\(256, bleed\)/.test(plan)) fail.push('the halving loop has no efficiency floor: it will grind down to tiles smaller than their own bleed');
if (!/BLOOM LOST/.test(plan)) fail.push('a bloom refusal is not named in the plan trail, so a master cannot explain itself');
// A browser with no ctx.filter fails EVERY size, so probing per size only deletes the feature and caps the
// device. Ask once on a small canvas, then render and declare it rather than refuse.
if (!/const canBlur = sigma > 0/.test(plan)) fail.push('the plan does not ask whether the browser can blur at all, so a WebKit device is refused at every size instead of told');
if (!/const probeSigma = canBlur \? sigma : 0/.test(plan)) fail.push('the per-size probe is not skipped when the browser cannot blur at all');
if (!/bloomless: p\.canBlur \? undefined : true/.test(app)) fail.push('a master rendered without a bloom does not say so');

const probe = app.slice(app.indexOf('function bloomWorks'), app.indexOf('function canvasFits'));
// Through blurDraw, so it exercises whatever this browser really uses - the filter where there is one,
// the pyramid where there is not. A probe that tests a path the renderer does not take proves nothing.
if (!/blurDraw\(x, c, sigma, w, h\)/.test(probe))
  fail.push('bloomWorks no longer blurs the canvas onto itself through blurDraw, so it tests a path the renderer may not take');
if (!/data\[3\]/.test(probe)) fail.push('bloomWorks must read ALPHA: a colour test cannot tell a black slab from a dropped blur');

// ---- 3b. the whole-image steps this path has no whole image for ------------------------------------
// renderFull, the strip path and the worker path all composite reality windows onto an assembled canvas.
// The BigTIFF path assembles nothing, so for a week it simply omitted them and every tiled master lost
// its islands — invisible in daylight, where the window shows daylight, and the loudest object in the
// picture under black light. It composites per tile now, and must keep doing so.
const oneTile = app.slice(app.indexOf('function renderOneTile'), app.indexOf('async function renderTiledStepped'));
if (!/compositeWindow\(cx, win, ew, eh/.test(oneTile)) fail.push('renderOneTile does not composite reality windows: every tiled master would lose its islands');
if (!/win\.show == null\) continue/.test(oneTile)) fail.push('renderOneTile composites masks that are not windows');
// Presence only: it catches the line being deleted, not the condition being neutered — `if (false && …)`
// still reads as present. Say so rather than let it look stronger than it is.
if (!/wx \+ wr < ex0 \|\| wx - wr > ex0 \+ ew/.test(oneTile)) fail.push('renderOneTile has no intersection test: every tile would pay for every window');

// ---- 4. the light a master records about itself ----------------------------------------------------
if (!/litSum \+= l;/.test(app)) fail.push('the export no longer accumulates the light it wrote');
// The trailing non-digit is load-bearing: without it this passes on `i += 4000`, and an ablation that
// changed the stride tenfold read as green.
if (!/i \+= 400[^\d]/.test(app)) fail.push('the light sample stride changed: it must match tiff-meta --audit (every 100th pixel) or the two numbers are not comparable');
if (!/light: litN \?/.test(app)) fail.push('the measured light is not recorded in the metadata');

// ---- 5. the stored tile must divide the render pass ------------------------------------------------
if (/const store = Math\.min\(ts, TIFF_STORE_MAX\), k = ts \/ store/.test(app))
  fail.push('store/k assumes k is 1 or 2 again: a forced pass of 6144 then writes bleed into the picture');
if (!/while \(store > 1 && ts % store !== 0\) store >>= 1/.test(app)) fail.push('the stored tile is not derived as a divisor of the render pass');

if (fail.length) { console.error('bleed:\n  ' + fail.join('\n  ')); process.exit(1); }
console.log(`bleed: OK — ${found.size} blur radii declared, reach is at least 3x the deviation, bloom probed at`
          + ` plan time, light recorded as written, stored tile divides the pass`);

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
  "' + b + '": 'output',
};

// Match the interpolated expression whole. A lazy character class stops at the first `)`, which silently
// reduced `${(2 + 3 * ss) * bs}` to `(2 + 3 * ss` and then reported it as undeclared — a gate that mangles
// its own input reads as a finding about the code.
const found = new Set();
for (const m of app.matchAll(/blur\(\$\{(.+?)\}px\)/g)) found.add(m[1].trim());
for (const m of app.matchAll(/blur\((\d[\d.]*)px\)/g)) found.add(m[1].trim());
for (const m of app.matchAll(/'blur\('\s*\+\s*([\w$]+)/g)) found.add("' + " + m[1] + " + '");

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
if (!/canvasFits\(ew, ew, 1, sigma\)/.test(plan)) fail.push('the plan probes the canvas without asking whether it BLURS');
// The proof records that a surface ALLOCATES. Whether it blurs is a different answer — and every one of
// tonight's bloomless masters read `proven` in its trail, meaning no probe ran at all.
if (!/proven >= ts && !\(sigma > 0\)/.test(plan)) fail.push('the tile proof bypasses the bloom probe: a proven tile must still be blur-tested');
if (!/BLOOM LOST/.test(plan)) fail.push('a bloom refusal is not named in the plan trail, so a master cannot explain itself');

const probe = app.slice(app.indexOf('function bloomWorks'), app.indexOf('function canvasFits'));
if (!/filter = `blur\(\$\{sigma\}px\)`/.test(probe) || !/drawImage\(c, 0, 0\)/.test(probe))
  fail.push('bloomWorks no longer blurs the canvas onto itself the way applyCoat does');
if (!/data\[3\]/.test(probe)) fail.push('bloomWorks must read ALPHA: a colour test cannot tell a black slab from a dropped blur');

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

// A PNG THAT CANNOT SAY WHAT LIGHT IT CARRIES.
//
// Three export paths write the metadata block and they had drifted: the tiled path recorded light.mean,
// lit40 and the glow lift; the plain PNG path and the streamed PNG path recorded none of the three. It
// looked like symmetry to add them and it was not. Measured at 8192 across five engines, a PNG and a
// TIFF of the same slab at the same tile in one session:
//
//   daylight     agree to ±0.03 on every engine
//   black light  the PNG is about 2 brighter on every engine with a POSITIVE lift, and 0.07 on WebKit,
//                the only one running a negative one
//
// The bloom lands differently once tiles are assembled, so the two paths genuinely differ and the gap
// tracks the lift. A light figure without the lift beside it therefore cannot be read at all, which is
// why this gate insists on both or neither.
//
// IT EARNED ITS PLACE THE DAY IT SHIPPED. The first streamed renders under the new field showed WebKit
// black light at 20480 reading mean 12.30, lit40 7.26, against 57-62 for every other engine on the same
// path and 61.44 for WebKit itself at 8192. The image is broken, and that path had recorded nothing
// about its own light until then.
//
//   node tools/check-png-meta.mjs
import { readFileSync } from 'fs';

const NL = String.fromCharCode(10);
const app = readFileSync('app/stone-author.html', 'utf8');
const fail = [];

// ---- the measurement itself -------------------------------------------------------------------
if (!app.includes('function sampleLight('))
  fail.push('sampleLight is gone: the plain PNG path has no way to measure its own light, and that path never reads pixels back for any other reason');

// THE PHASE CARRIES ACROSS STRIPS, and this is the whole reason the figure is checkable. Restarting the
// stride at each strip boundary samples a DIFFERENT set of pixels from a single pass over the image, so
// the recorded number would be statistically similar to one derived from the file and never equal to it.
// Verified on 11 masters, five engines, both lights: derived == recorded, every time.
if (app.includes('function sampleLight(') && !app.includes('off = i - L'))
  fail.push('sampleLight no longer carries its sampling phase between strips: the figure it records would no longer equal one derived from the finished file, so a reader could not check it');
if (app.includes('function sampleLight(') && !app.includes('litOff = i - L'))
  fail.push('the streamed path no longer carries its sampling phase between chunks and bands: same defect, on the path that renders everything above 16384');

// The app's own arithmetic, not an equivalent of it. A flat mean of R,G,B — NOT Rec.601 — and the lit
// threshold at 40, in every path, or the three figures are not comparable with each other.
for (const [what, frag] of [['every 100th pixel of RGBA', 'i += 400'], ['the lit threshold', 'l > 40']])
  if (app.split(frag).length - 1 < 2)
    fail.push(what + ' (' + frag + ') appears fewer than twice: the tiled, plain and streamed paths must measure the same thing the same way or their numbers cannot be compared');

// ---- both PNG paths record it ----------------------------------------------------------------
// pngMeta exists because the lift is a const arrow declared late in the file, so an export up at line
// 5900 cannot even NAME it without a temporal dead zone — check-bleed enforces that on the identifier.
if (!app.includes('function pngMeta('))
  fail.push('pngMeta is gone: the PNG paths cannot reach the glow lift from where they are written, so the light they record becomes unreadable');
if (app.includes('function pngMeta(') && !/function pngMeta\([\s\S]{0,400}?glowLift/.test(app))
  fail.push('pngMeta no longer sets the glow lift, which is the only reason it exists');

const plain = app.indexOf("pngText(raw, 'stone-author', pngMeta({");
if (plain < 0) fail.push('the plain PNG path no longer builds its metadata through pngMeta, so it records no glow lift');
else {
  const block = app.slice(plain, plain + 500);
  if (!block.includes('light,')) fail.push('the plain PNG path no longer records its light');
}

const streamed = app.indexOf('renderStreamedPNG(W, m => pngMeta({');
if (streamed < 0) fail.push('the streamed PNG path no longer builds its metadata through pngMeta, so it records no glow lift');
else {
  const block = app.slice(streamed, streamed + 800);
  if (!block.includes('light: m.light')) fail.push('the streamed PNG path no longer records its light');
  // Counted for exactly this and then dropped for months: a render that halved its bands under memory
  // pressure was indistinguishable from one that did not, and surviving that is why the degrade exists.
  if (!block.includes('shrinks: m.shrinks')) fail.push('the streamed PNG path no longer records how many times it had to halve a band, so a degraded render is once again indistinguishable from a slow one');
}

console.log('png metadata');
if (fail.length) for (const f of fail) console.log('  FAIL  ' + f);
else console.log('  ok    both PNG paths record light and the lift, and the sampling phase carries');

// ---- ABLATIONS. A gate that has never been red is a preference. ---------------------------------
const ABL = [
  ['sampleLight is removed', s => s.replace('function sampleLight(', 'function notSampleLight(')],
  ['the plain path stops carrying its phase', s => s.replace('off = i - L', 'off = 0')],
  ['the streamed path stops carrying its phase', s => s.replace('litOff = i - L', 'litOff = 0')],
  ['pngMeta is removed', s => s.replace('function pngMeta(', 'function notPngMeta(')],
  ['the plain path drops its light', s => s.replace(NL + '          light,' + NL, NL)],
  ['the streamed path drops its light', s => s.replace('light: m.light,', '')],
  ['the streamed path drops its shrink count', s => s.replace('shrinks: m.shrinks || undefined,', '')],
  ['the plain path goes back to expMeta', s => s.replace("pngText(raw, 'stone-author', pngMeta({", "pngText(raw, 'stone-author', expMeta({")],
  ['the streamed path goes back to expMeta', s => s.replace('renderStreamedPNG(W, m => pngMeta({', 'renderStreamedPNG(W, m => expMeta({')],
];

function check(src) {
  const bad = [];
  if (!src.includes('function sampleLight(')) bad.push(1);
  if (src.includes('function sampleLight(') && !src.includes('off = i - L')) bad.push(1);
  if (src.includes('function sampleLight(') && !src.includes('litOff = i - L')) bad.push(1);
  if (!src.includes('function pngMeta(')) bad.push(1);
  const p = src.indexOf("pngText(raw, 'stone-author', pngMeta({");
  if (p < 0) bad.push(1); else if (!src.slice(p, p + 500).includes('light,')) bad.push(1);
  const s2 = src.indexOf('renderStreamedPNG(W, m => pngMeta({');
  if (s2 < 0) bad.push(1);
  else { const b = src.slice(s2, s2 + 800);
    if (!b.includes('light: m.light')) bad.push(1);
    if (!b.includes('shrinks: m.shrinks')) bad.push(1); }
  return bad.length;
}

let bit = 0;
console.log('');
for (const [name, mangle] of ABL) {
  const broken = mangle(app);
  if (broken === app) { console.log('  FAIL  ablation changed nothing: ' + name); continue; }
  if (check(broken)) { bit++; console.log('  ok    caught: ' + name); }
  else console.log('  FAIL  NOT CAUGHT: ' + name);
}

console.log('');
console.log(bit + ' of ' + ABL.length + ' ablations bite' + (fail.length ? '   AND THE LIVE SOURCE FAILS' : ''));
process.exit(fail.length === 0 && bit === ABL.length ? 0 : 1);

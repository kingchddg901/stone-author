// A SQUARE MASK IS A WINDOW ON THE SLAB, NOT THE SLAB SQUASHED INTO A SQUARE.
//
// docs/architecture.md has said since before anything produced one that the source "rasterises to a
// 430-px card or a 2048 squared mask without a bitmap ever being scaled", and that the simple reader
// wants 4 grey masks at 2048 squared. Nothing emitted that shape: every mask came out W x round(W*H),
// because H = 0.625 is a build constant and the export canvas was built from W alone.
//
// The fix is a VIEW - the pair (canvas, transform) each mask builder sets up identically:
//
//   viewSlab(W)    w = W,  h = round(W*H),  scale W,      no offset      the whole 8 x 5 ft slab
//   viewSquare(S)  w = h = S,               scale S / H,  dx = -(S/H)*(1-H)/2
//
// viewSquare is the LARGEST CENTRED SQUARE of that same rasterisation: H of draw space is 5 ft, so
// the window is 5 x 5 ft and keeps 62.5% of the slab's width. At S = 2048 the scale is 3276.8 - not
// an integer, and deliberately not rounded, because rounding it is what would make this a resample.
//
// THERE ARE TWO WAYS TO FILL A SQUARE AND ONLY ONE OF THEM IS TRUE.
//
//   setTransform(S/H, 0, 0, S/H, dx, 0)   a window. Uniform scale. Veins keep their proportions.
//   setTransform(S,   0, 0, S/H,  0, 0)   a squeeze. The whole 8 ft in frame, grain 1.6x wider
//                                         than tall. It fills the canvas, it looks almost right,
//                                         and it is a lie about the stone.
//
// The squeeze is the plausible mistake and it is invisible in a thumbnail, so clause 3 is the
// load-bearing one. Clause 6 holds the other way of getting this wrong: doing the crop as a shifted
// drawImage of the finished picture, which reads pixels from outside the canvas - the same defect
// check-relief-bleed exists for, wearing the same output.
//
//   node tools/check-square-view.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const APP = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'stone-author.html'), 'utf8');
let bad = 0;
const fail = (m) => { console.log('  FAIL  ' + m); bad++; };
const ok = (m) => console.log('  ok    ' + m);

// LIFTED FROM THE SOURCE, never retyped: a gate that restates the arithmetic agrees with itself
// rather than with the app. H comes out of the source too.
const lift = (name, re) => { const m = APP.match(re); if (!m) return null; return m[1]; };
const Hsrc = lift('H', /\n  const H = ([\d.]+);/);
const slabSrc = lift('viewSlab', /\n  const viewSlab = (W => \([^;]*?\));/);
const sqSrc = lift('viewSquare', /\n  const viewSquare = (S => \([^;]*?\));/);
const sqMask = lift('SQUARE_MASK', /\n  const SQUARE_MASK = (\d+);/);

if (!Hsrc || !slabSrc || !sqSrc || !sqMask) {
  console.log('  FAIL  cannot lift H / viewSlab / viewSquare / SQUARE_MASK from the app - the seam is gone or renamed');
  process.exit(1);
}
const H = Number(Hsrc);
const viewSlab = new Function('H', 'return (' + slabSrc + ');')(H);
const viewSquare = new Function('H', 'return (' + sqSrc + ');')(H);
const S = Number(sqMask);

// 1. THE SLAB VIEW IS THE OLD BEHAVIOUR, EXACTLY. Every export ever taken was W x round(W*H) with
// scale W and no offset; if this clause moves, every existing slab re-renders differently.
{
  let drift = 0;
  for (const W of [1, 2, 3, 430, 512, 1024, 2048, 3276, 3277, 4096, 8192, 16384, 65535]) {
    const V = viewSlab(W);
    if (V.w !== W || V.h !== Math.round(W * H) || V.k !== W || V.dx !== 0) { drift++; if (drift === 1) fail(`viewSlab(${W}) is not the historical sizing: got w=${V.w} h=${V.h} k=${V.k} dx=${V.dx}, want w=${W} h=${Math.round(W * H)} k=${W} dx=0`); }
  }
  if (!drift) ok('viewSlab reproduces the historical W x round(W*H) sizing over 13 widths');
}

// 2. THE SQUARE VIEW IS SQUARE. The one clause a glance would catch, and the cheapest to break by
// copying viewSlab's height expression.
{
  let nonsq = 0;
  for (const s of [256, 512, 1024, 2048, 4096]) { const V = viewSquare(s); if (V.w !== s || V.h !== s) { nonsq++; if (nonsq === 1) fail(`viewSquare(${s}) is ${V.w} x ${V.h}, not square`); } }
  if (!nonsq) ok('viewSquare is w === h === S over 5 sizes');
}

// 3. THE SCALE IS UNIFORM, IN THE ARITHMETIC AND IN THE TRANSFORM. The squeeze lives here.
{
  const V = viewSquare(S);
  if (Math.abs(V.k - S / H) > 1e-9) fail(`viewSquare(${S}).k is ${V.k}, not S / H = ${S / H} - a different scale per axis is the squeeze`);
  else ok(`viewSquare(${S}).k is S / H = ${V.k}, one scale for both axes`);
  // and the builders must actually emit it in both slots
  const emit = [...APP.matchAll(/cx\.setTransform\(V\.k, 0, 0, V\.k, V\.dx, 0\)/g)].length;
  const bad2 = [...APP.matchAll(/cx\.setTransform\(V\.k, 0, 0, (?!V\.k,)/g)].length;
  if (emit < 2) fail(`only ${emit} builder(s) emit setTransform(V.k, 0, 0, V.k, V.dx, 0) - expected the base mask and the coverage mask`);
  else ok(`${emit} builders emit the uniform transform with the offset in it`);
  if (bad2) fail('a builder emits setTransform with a different vertical scale - that fills the square by squashing the slab into it');
  else ok('no builder scales the axes differently');
}

// 4. IT IS THE LARGEST CENTRED SQUARE. Derived back out of the view, so a wrong window cannot hide
// behind a right-looking offset: x0 = -dx/k must be (1-H)/2, and the window must be H wide.
{
  const V = viewSquare(S);
  const x0 = -V.dx / V.k, x1 = x0 + S / V.k;
  if (Math.abs(x0 - (1 - H) / 2) > 1e-9) fail(`the window starts at x=${x0} in draw space, not (1-H)/2 = ${(1 - H) / 2} - it is not centred`);
  else ok(`the window is centred: x from ${x0} to ${x1} of 0..1`);
  if (Math.abs((x1 - x0) - H) > 1e-9) fail(`the window is ${x1 - x0} wide in draw space, not H = ${H} - it is not the largest square that fits`);
  else ok(`the window is H wide, so the square is the tallest the slab allows (${(8 * H).toFixed(2)} x 5.00 ft of an 8 x 5 ft slab)`);
}

// 5. NO RESAMPLE AT THE CONTRACT SIZE. k * H must land on S exactly; a rounded k is a resample
// wearing a window's clothes.
{
  const V = viewSquare(S);
  if (V.k * H !== S) fail(`viewSquare(${S}).k * H = ${V.k * H}, not ${S} exactly - the square is being resampled`);
  else ok(`k * H === ${S} exactly, so the square is delivered without scaling a bitmap`);
}

// 6. THE OFFSET IS ON THE TRANSFORM, NOT ON A COMPOSITE. The other way to crop is to draw the
// finished picture at an offset, which reads pixels the canvas never held.
{
  const iB = APP.indexOf('function expBaseMask('), iC = APP.indexOf('function expCoverage(');
  const seg = APP.slice(iB, APP.indexOf('\n  function ', iC + 10));
  const shifted = [...seg.matchAll(/drawImage\([^)]*V\.dx[^)]*\)/g)].map(m => m[0]);
  if (shifted.length) fail(`the window is applied by shifting a drawn image (${shifted[0]}) - that reads outside the canvas`);
  else ok('neither builder applies the window by shifting a drawn image');
}

// 7. ONE COPY OF THE DRAWING CODE. A square builder cloned from the slab builder is how a square
// mask and its slab mask start disagreeing about what is in the stone.
for (const fn of ['expBaseMask', 'expCoverage']) {
  const n = (APP.match(new RegExp('function ' + fn + '\\(', 'g')) || []).length;
  if (n !== 1) fail(`there are ${n} copies of ${fn} - the square set must go through the same builder as the slab set`);
  else ok(`${fn} is declared exactly once`);
}

// 8. THE KIT CARRIES THEM, AND THE .ora OFFSET IS DERIVED. names[] and makers[] align by position,
// and the .ora layers sit directly after the named PNGs: a literal index there silently packs a
// mask as the slab the moment anything is inserted ahead of it.
{
  const sq = [...APP.matchAll(/'masks\/square\/(base|major|minor|micro)\.png'/g)].map(m => m[1]);
  if (sq.length !== 4) fail(`the kit names ${sq.length} square masks, not 4 (base/major/minor/micro): ${sq.join(', ')}`);
  else ok('the kit names all 4 square masks: ' + sq.join(', '));
  const calls = [...APP.matchAll(/viewSquare\(SQUARE_MASK\)/g)].length;
  if (calls !== 4) fail(`${calls} makers ask for viewSquare(SQUARE_MASK), but 4 files are named - names[] and makers[] align by position, so they must match`);
  else ok('4 makers ask for the square view, one per named file');
  if (!/const oraAt = names\.length;/.test(APP)) fail('the .ora offset is not derived from names.length - a literal index packs the wrong image the moment one is inserted ahead of it');
  else ok('the .ora offset is derived from names.length');
  if (/buildOraFrom\(bytes\[\d/.test(APP)) fail('buildOraFrom is still handed a literal byte index');
  else ok('buildOraFrom takes no literal index');
}

// 9. THE CONTRACT SIZE IS THE PUBLISHED ONE. docs/architecture.md names 2048 squared; if the code
// and the doc drift, a consumer reads the doc.
{
  const doc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'architecture.md'), 'utf8');
  if (S !== 2048) fail(`SQUARE_MASK is ${S}; docs/architecture.md publishes 2048 squared`);
  else ok('SQUARE_MASK is 2048');
  if (!/2048²/.test(doc)) fail('docs/architecture.md no longer states the 2048 squared contract this gate is pinned to');
  else ok('docs/architecture.md still states the 2048 squared contract');
}

console.log(bad ? `\nsquare-view: ${bad} FAILURE(S)` : '\nsquare-view: OK');
process.exit(bad ? 1 : 0);

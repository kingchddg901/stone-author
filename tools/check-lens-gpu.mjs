// THE LENS KERNEL'S THREE INVISIBLE DEFECTS, PINNED.
//
// This gate does NOT check that the shader draws the right picture - that needs a GPU, so it is the
// browser harness's job and CI is its first run. What it checks is the set of mistakes that would
// leave the shader compiling, running, and quietly drawing something else. Each one was reachable
// while this was being written and none of them would move a mean enough to notice.
//
//   1. A SAMPLER. applyLens ends `const pX = fX | 0` - a truncation - so the stage is
//      NEAREST-NEIGHBOUR. A WGSL sampler with linear filtering is the obvious thing to reach for and
//      it is wrong: visibly softer everywhere the lens displaces, on every pixel of every tile.
//   2. THE TRUNCATION IN THE WRONG FRAME. `floor(fX - vx)` is the same geometry as
//      `floor(fX) - vx` and NOT the same pixel. applyLens carries the measurement: at column 0,
//      row 64 of a 384px picture the displacement is 1e-14, fY lands on 63.99999999999999, and the
//      wrong frame reads row 63. One pixel, one row, only where a tile boundary falls - which is
//      the shape of a renderer that looks non-deterministic.
//   3. A LIT ALPHA. The caustic brightens the light coming through, not the glass's coverage.
//      Multiplying alpha by b makes a refracted edge opaque.
//
// AND THE STRUCT AGAINST THE PACKER, because the shader's field order is generated from the packer's
// own lists and a gate that cannot see a drift there would let every field read the next one along.
//
//   node tools/check-lens-gpu.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'lib', 'lens-gpu.mjs'), 'utf8');
const { lensCode, PARTS, WGSL } = await import('./lib/lens-gpu.mjs');
const R = await import('./lib/lens-real.mjs');

let bad = 0;
const fail = (m) => { console.log('  FAIL  ' + m); bad++; };
const ok = (m) => console.log('  ok    ' + m);
const code = lensCode();

// 1. NO SAMPLER, AND NOT ONLY IN THE ASSEMBLED CODE. A part that is written but never placed in
// PARTS would carry one past this check, so the MODULE TEXT is searched too.
for (const where of [['assembled WGSL', code], ['the module source', SRC.replace(/^\/\/.*$/gm, '')]]) {
  const hits = ['sampler', 'textureSample', 'textureLoad', 'textureGather'].filter(t => where[1].includes(t));
  if (hits.length) fail(`${where[0]} reaches for ${hits.join(', ')} - the gather is nearest-neighbour`);
  else ok(`no sampler in ${where[0]}`);
}

// 2. THE FRAME. Both spellings are legal WGSL and only one is the shipped geometry.
if (!/floor\(fX\)\s*-\s*L\.vx/.test(code) || !/floor\(fY\)\s*-\s*L\.vy/.test(code))
  fail('the truncation is not `floor(fX) - L.vx` - see applyLens on the 63.99999999999999 row');
else ok('truncated in the picture frame, then moved into the tile');
if (/floor\(\s*fX\s*-\s*L\.vx|floor\(\s*fY\s*-\s*L\.vy/.test(code))
  fail('`floor(fX - L.vx)` is present - the same geometry and not the same pixel');
else ok('the tile origin never comes off before the truncation');

// AND THE PICTURE'S CLAMP COMES FIRST. The tile clamp can only bite where the bleed is short of
// lensReach; the picture clamp is the stage's own behaviour at the edge of the slab. Reversed, the
// edge of every tile would read as the edge of the picture.
const iPic = code.search(/clamp\([^)]*L\.fwm1\)/), iTile = code.search(/clamp\(i32\(floor/);
if (iPic < 0 || iTile < 0) fail('cannot find both clamps');
else if (iPic > iTile) fail('the tile is clamped before the picture - the orders are not interchangeable');
else ok('picture clamp before tile clamp');

// 3. THE ALPHA RIDES THROUGH UNLIT.
if (!/vec4<f32>\(\s*lit\s*,\s*src\.a\s*\)/.test(code))
  fail('the written alpha is not src.a - a caustic must not multiply coverage');
else ok('alpha passes through unlit');
if (/src\.a\s*\*|\*\s*src\.a/.test(code)) fail('src.a is multiplied somewhere');
else ok('src.a is never multiplied');

// 4. THE PACKER FAILS CLOSED, which is the drift that can actually happen here.
//
// TWO CHECKS WERE WRITTEN HERE FIRST AND BOTH WERE IDENTITIES - recorded so they are not re-added as
// reassurance. "The struct matches the packer's lists" cannot fail: lens-gpu.mjs GENERATES the struct
// from those lists, so it grows with them and the two can never disagree. "The uniform is a multiple
// of 16 bytes" cannot fail either: UNI_PAD is derived to make it one. Ablated by adding a field to
// LENS_INT_NAMES - the gate stayed GREEN while the packer wrote a silent zero for it, which is the
// defect those two were supposed to be about.
//
// What CAN fail is the value map: an Int32Array coerces undefined to 0 in silence. So the packer
// throws on a name it has no finite value for, and this is that guard's bite test.
let threw = null;
try { R.packLens({ k: 1, amp: 2, cx: 4, cy: 5, type: 'fresnel' }, { w: 8, h: 9, vx: 10, vy: 11, fw: 12, fh: 13 }); }
catch (e) { threw = e.message; }
if (!threw) fail('packLens accepted a field with no caus - it must not write undefined');
else ok('packer throws on an unsupplied name: ' + threw.replace('lens-real: ', ''));
const full = R.packLens({ k: 1, amp: 2, caus: 0.3, cx: 4, cy: 5, type: 'fresnel' },
                        { w: 8, h: 9, vx: 10, vy: 11, fw: 12, fh: 13 });
if (full.byteLength !== R.UNI_BYTES) fail(`packed ${full.byteLength} bytes, UNI_BYTES says ${R.UNI_BYTES}`);
else if ([...new Float32Array(full).slice(0, R.LENS_FLOAT_NAMES.length)].some(v => !Number.isFinite(v)))
  fail('a float field packed non-finite');
else ok(`a complete call packs ${full.byteLength} finite bytes`);
if (R.KINDS.fresnel !== 0 || R.KINDS.reeded !== 1 || R.KINDS.water !== 2)
  fail('KINDS moved - the kernel branches on 1 and 2 by number');
else ok('KINDS still 0/1/2, which is what the kernel branches on');

// 5. THE FIELD IS THE EXACT ONE, not a second approximation of it. The CPU path interpolates a table
// and check-lens-table.mjs measures that error against this same closed form, so the shader being
// exact is what makes the two paths' disagreement a BOUNDED quantity rather than an open question.
// A table creeping into the kernel would silently double the error budget.
if (/LTAB|lensTable|table\[/i.test(code)) fail('the kernel reads a table - it must compute the field');
else ok('the field is computed, not tabulated');
for (const [what, re] of [['sin(r*k)/r displacement', /L\.amp\s*\*\s*sin\(r\s*\*\s*L\.k\)\s*\/\s*r/],
                          ['1 + amp*k*cos(r*k) jacobian', /1\.0\s*\+\s*L\.amp\s*\*\s*L\.k\s*\*\s*cos\(r\s*\*\s*L\.k\)/],
                          ['the 0.3 jacobian floor', /max\(0\.3,\s*abs\(j\)\)/],
                          ['the b > 2 cap', /select\(b,\s*2\.0,\s*b\s*>\s*2\.0\)/]])
  if (!re.test(code)) fail(`${what} is not in the kernel as written`); else ok(what);

// AND WATER'S AXES CROSS. applyLens reads `dx = dyr[y]; dy = dxc[x]` - dx from y and dy from x. A
// transcription that un-crosses them is still a plausible-looking water lens.
if (!/sin\(\(y \+ L\.vy\) \* L\.k\),\s*L\.amp \* sin\(\(x \+ L\.vx\) \* L\.k\)/.test(code))
  fail("water's axes do not cross - dx comes from y and dy from x");
else ok("water's axes cross");

// 6. A PART THAT IS NEVER PLACED IS NOT IN THE SHADER. lensCode throws rather than silently
// assembling a module with a function the rest of it calls.
const declared = [...SRC.matchAll(/^WGSL\.(\w+)\s*=/gm)].map(m => m[1]);
const unplaced = declared.filter(d => !PARTS.includes(d));
if (unplaced.length) fail('part(s) declared and never placed: ' + unplaced.join(', '));
else ok(`all ${declared.length} declared part(s) are in PARTS`);
if (PARTS.indexOf('lensEnv') !== 0) fail('lensEnv must come first - it declares L');
else ok('lensEnv is first, so L exists before it is read');

console.log(bad ? `\nlens-gpu: ${bad} FAILURE(S)` : '\nlens-gpu: OK');
process.exit(bad ? 1 : 0);

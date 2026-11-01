/**
 * THE UNIFORM BUFFER MUST BE AS BIG AS THE STRUCT IT FEEDS.
 *
 * WebGPU computes `minBindingSize` from the shader's own struct and refuses a smaller buffer at bind
 * time, so a size that the struct has outgrown is not a subtle wrongness - every export on that
 * material fails outright:
 *
 *     Binding size (304) of [Buffer (unlabeled)] is smaller than the minimum binding size (320).
 *
 * That is what glass did from the relief port until 2026-10-31. REL, LX, LY and a pad were appended
 * to struct Env - bytes 304..319 - and `tools/lib/glass-real.mjs` followed, allocating 320 and
 * packing REL at 304. The app's `GPU_MAT.glass.uni: 304` did not, and EVERY glass GPU export was
 * refused, relieved or not, because the shader declares that minimum whatever the scene holds.
 *
 * WHY check-gpu-sync COULD NOT SEE IT, which is the part worth keeping. That gate regenerates the
 * app's inlined copy of glass-gpu.mjs and glass-real.mjs and diffs it byte for byte - it is exact
 * about everything INSIDE that block. `uni:` is app-only glue outside it. The one number that sizes
 * the buffer was the one thing not being compared, and a gate that is exact about its own scope
 * reads as covering more than it does.
 *
 * GLASS IS THE ONLY MATERIAL THAT CAN DRIFT THIS WAY. Stone and wood build the struct text AND the
 * byte count from a single name list, so adding a field moves both. Glass has a literal struct and
 * a hand-written number: two copies of one fact. This gate is the third reader that makes them
 * agree, and it also asserts the other two STAY derived - a numeric literal appearing there is the
 * same defect arriving in a new place.
 *
 *   node tools/check-gpu-uni.mjs
 *   node tools/check-gpu-uni.mjs --ablate
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'app', 'stone-author.html'), 'utf8');
const ABLATE = process.argv.includes('--ablate');

const FIELD = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(f32|i32|u32)/g;

// The glass struct is the literal one carrying nCane; stone's and wood's are interpolated from a
// name list and parse as empty here, which is itself the property claimed below.
function structs(src) {
  const out = [];
  for (const m of src.matchAll(/struct Env \{/g)) {
    const i = m.index, j = src.indexOf('};', i);
    if (j < 0) continue;
    const body = src.slice(i, j).split('\n').map(l => l.split('//')[0]).join(' ');
    const f = [...body.matchAll(FIELD)].map(x => x[1]);
    out.push({ at: i, fields: f, bytes: 4 * f.length });
  }
  return out;
}

const rows = [];
let bad = 0;
// `targeted` marks the ONE claim this ablation is meant to break. The others are not ablated at
// all, so reporting them as decoration would be a false report - and a gate that overstates what
// its own ablation proved is the exact shape of defect this file exists to catch.
let ablatedBit = false;
const claim = (ok, targeted, title, detail) => {
  if (!ok && !(ABLATE && targeted)) bad++;
  if (ABLATE && targeted && !ok) ablatedBit = true;
  const tag = !ok ? (ABLATE && targeted ? 'red ' : 'FAIL') : (ABLATE && !targeted ? 'n/a ' : 'ok  ');
  rows.push('  ' + tag + '  ' + title.padEnd(50) + detail);
};

// ---- 1. the glass struct and the glass uniform size agree ----------------------------------------
const glass = structs(SRC).find(s => s.fields.includes('nCane'));
if (!glass) {
  console.log('gpu-uni: cannot find the glass struct Env (does it still carry nCane?)');
  process.exit(2);
}
const decl = SRC.match(/glass: \{[\s\S]{0,2000}?\buni: (\d+)\b/);
if (!decl) {
  console.log('gpu-uni: cannot find GPU_MAT.glass.uni');
  process.exit(2);
}
let declared = +decl[1];
if (ABLATE) declared -= 16;                            // the exact shortfall the relief port left
claim(declared === glass.bytes, true,                    // the claim this ablation targets
      'glass: GPU_MAT.glass.uni equals struct Env',
      'struct ' + glass.fields.length + ' scalars = ' + glass.bytes + ' bytes, uni = ' + declared +
      (declared === glass.bytes ? '' : '  <-- a bind group with this is REFUSED'));

// ---- 2. the last row is still the relief one, so the count above is not a coincidence ------------
const tail = glass.fields.slice(-4).join(',');
claim(tail === 'REL,LX,LY,pad10', false,
      'glass: the struct still ends with the relief row',
      'last four: ' + tail);

// ---- 3. stone and wood must stay DERIVED. A literal here is this defect in a new place. ----------
for (const mat of ['stone', 'wood']) {
  const m = SRC.match(new RegExp(mat + ': \\{[\\s\\S]{0,2000}?\\buni: ([A-Za-z0-9_]+)'));
  const v = m ? m[1] : null;
  const derived = !!v && !/^\d+$/.test(v);
  claim(derived, false, mat + ': uniform size is derived, not a literal',
        v === null ? 'no uni found' : 'uni: ' + v + (derived ? '' : '  <-- hardcoded, can drift'));
}

// ---- 4. and the module that packs it allocates the same ------------------------------------------
const real = readFileSync(join(ROOT, 'tools', 'lib', 'glass-real.mjs'), 'utf8');
const ab = real.match(/new ArrayBuffer\((\d+)\)/);
claim(!!ab && +ab[1] === glass.bytes, false,
      'glass-real.mjs allocates the same size',
      ab ? 'ArrayBuffer(' + ab[1] + ')' : 'no ArrayBuffer found');

console.log('THE UNIFORM BUFFER MUST BE AS BIG AS THE STRUCT IT FEEDS' + (ABLATE ? '  [ABLATED: glass uni -16]' : '') + '\n');
console.log(rows.join('\n'));
if (ABLATE) {
  console.log('\n' + (ablatedBit
    ? 'ablation held: the glass size claim went red, as it must. n/a = not targeted by this ablation'
    : 'ABLATION DID NOT BITE - the glass size claim cannot fail') +
    (bad ? '  (and ' + bad + ' unrelated claim(s) are genuinely failing)' : ''));
  process.exit(ablatedBit && !bad ? 0 : 1);
}
console.log('\n' + (bad ? bad + ' PROBLEM(S)' : 'gpu-uni: OK - every uniform size matches the struct it feeds'));
process.exit(bad ? 1 : 0);

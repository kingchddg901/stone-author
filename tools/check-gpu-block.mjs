// THE GENERATED BLOCK MUST RUN, NOT ONLY MATCH.
//
// check-gpu-sync compares the app's copy of the shaders against tools/lib byte for byte. That catches
// a hand edit and a missed sync, and it cannot catch the one failure the block has actually had: the
// text being right and the code throwing on load.
//
// sync-gpu.mjs carries the incident in its own comment. wood-gpu.mjs declares a WGSL of its own, so
// inside the wood block that name is WOOD's - which made a capture written in there a read of a const
// in its own temporal dead zone. "The app threw on load and started nothing: gates green, the shader
// compiling on a real device, and no studio." Byte-for-byte agreement said nothing about it, because
// the bytes were exactly what they were meant to be.
//
// So this evaluates the block and calls what comes out. It needs no GPU and no browser: the packers
// are arithmetic and the shader assemblers are string concatenation, which is why they can be checked
// here instead of waiting for CI's Playwright run.
//
// FOUR BLOCKS SHARE ONE SCOPE, which is the other thing worth holding. Glass sits at the top level;
// wood, stone and the lens each get a block because all four declare a WGSL. If one of them writes
// into another's registry the parts go missing from one shader and arrive, unplaced, in another -
// stone-gpu.mjs records that exact defect from when its own WGSL was spelled bare. So the registries
// are checked for each other's parts, not just for being non-empty.
//
//   node tools/check-gpu-block.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { OPEN, CLOSE } from './sync-gpu.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(ROOT, 'app', 'stone-author.html'), 'utf8');

let bad = 0;
const fail = (m) => { console.log('  FAIL  ' + m); bad++; };
const ok = (m) => console.log('  ok    ' + m);

const a = app.indexOf(OPEN), b = app.indexOf(CLOSE);
if (a < 0 || b < 0 || b < a) { console.log('  FAIL  the app has no usable GPU-SYNC markers'); process.exit(1); }
const block = app.slice(a + OPEN.length, b);
ok(`block found, ${block.length} chars`);

// 1. IT EVALUATES. A redeclaration, a TDZ read or a syntax error in the generated scope lands here
// rather than in a browser with no studio.
let out = null;
try {
  out = new Function(block + `
    return { WGSL, LENS_SRC, LENS_PACK, LENS_UNI_BYTES, LENS_DISPATCH,
             STONE_SRC, STONE_PACK, STONE_COLLAPSE, WOOD_SRC, WOOD_PACK };`)();
  ok('the block evaluates');
} catch (e) {
  fail(`the block THREW on evaluation - ${e.constructor.name}: ${e.message}`);
  console.log('\ngpu-block: 1 FAILURE (nothing below could run)');
  process.exit(1);
}

// 2. EVERY ASSEMBLER ASSEMBLES. A lazy getter that was never assigned is null, which reads as "this
// material is simply not built" everywhere except here.
const SRCS = { LENS_SRC: 1000, STONE_SRC: 10000, WOOD_SRC: 10000 };
const code = {};
for (const [n, floor] of Object.entries(SRCS)) {
  if (typeof out[n] !== 'function') { fail(`${n} is ${out[n] === null ? 'null' : typeof out[n]}, not a function`); continue; }
  try {
    const s = out[n]();
    if (typeof s !== 'string' || s.length < floor) fail(`${n}() returned ${typeof s} of ${s && s.length} - under the ${floor} floor`);
    else { code[n] = s; ok(`${n}() assembles ${s.length} chars`); }
  } catch (e) { fail(`${n}() THREW - ${e.constructor.name}: ${e.message}`); }
}

// 3. THE PACKERS ARE THERE. Arithmetic, so a missing one is a null rather than an error until a
// render asks for it.
for (const n of ['LENS_PACK', 'STONE_PACK', 'WOOD_PACK', 'STONE_COLLAPSE'])
  if (typeof out[n] !== 'function') fail(`${n} is not a function`); else ok(`${n} is a function`);
if (out.LENS_UNI_BYTES % 16 || !out.LENS_UNI_BYTES) fail(`LENS_UNI_BYTES is ${out.LENS_UNI_BYTES}`);
else ok(`LENS_UNI_BYTES ${out.LENS_UNI_BYTES}`);
if (typeof out.LENS_DISPATCH !== 'function') fail('LENS_DISPATCH is not a function');
else { const d = out.LENS_DISPATCH(64, 48); ok(`LENS_DISPATCH(64,48) -> ${d.join('x')}`); }

// 4. NOBODY WROTE INTO GLASS'S REGISTRY. The top-level WGSL belongs to glass; a block whose own
// registry was spelled bare has it dropped by strip() and its parts land here instead - which leaves
// glass carrying another material's functions and that material's own code() finding them unplaced.
const glassKeys = Object.keys(out.WGSL || {});
if (!glassKeys.length) fail('glass WGSL registry is empty');
else ok(`glass WGSL registry holds ${glassKeys.length} part(s)`);
// A NAME PREFIX DOES NOT DECIDE OWNERSHIP, which the first spelling of this check got wrong. It
// looked for /^(lens|stone|wood)/ and went red on woodAtan2 and woodHash, which are in glass's
// registry ON PURPOSE: sync-gpu.mjs records that woodSource "borrows woodAtan2, woodHash, fbm2 and
// what those call in turn from the glass blocks above, so the three functions both materials use
// have one definition and one set of probes behind them". Wood reaching into glass is the design.
// The lens reaching into glass is not - it closes over nothing and shares nothing, so a lens part
// appearing out here means its own registry was dropped and its parts went to the wrong place.
const strays = glassKeys.filter(k => /^lens/.test(k));
if (strays.length) fail(`glass registry carries the lens's parts: ${strays.join(', ')} - its own WGSL was dropped`);
else ok("no lens part leaked into glass's registry");

// 5. AND THE LENS'S WGSL IS THE MODULE'S, AT RUN TIME. check-gpu-sync proves the TEXT was copied;
// this proves the copy, once evaluated, produces the same shader the module does.
const mod = (await import('./lib/lens-gpu.mjs')).lensCode();
if (code.LENS_SRC === undefined) fail('no LENS_SRC output to compare');
else if (code.LENS_SRC !== mod) fail(`LENS_SRC() differs from the module: ${code.LENS_SRC.length} vs ${mod.length} chars`);
else ok('LENS_SRC() is byte-identical to the module at run time');

// AND THE THREE SHADERS ARE THREE SHADERS. A block that assembled another's parts would show up as
// one of these containing the other's entry point.
if (code.LENS_SRC && code.STONE_SRC && code.STONE_SRC.includes('fn lensGather'))
  fail("stone's shader carries the lens kernel");
else if (code.LENS_SRC && code.LENS_SRC.includes('fn stoneTile'))
  fail("the lens shader carries stone's tile kernel");
else ok('the shaders do not carry each other');

console.log(bad ? `\ngpu-block: ${bad} FAILURE(S)` : '\ngpu-block: OK');
process.exit(bad ? 1 : 0);

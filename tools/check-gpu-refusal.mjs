// WHEN THE GPU PATH WILL NOT TAKE A DOCUMENT, DOES IT SAY SO - AND DOES IT SAY SO IN THE RECORD?
//
// The arena carries ONE warp grid and ONE roller grid. A document whose stirs disagree about their
// warp state has always been refused; a document whose presses disagree about their roller was not,
// and `const B = (F.ROLL && F.ROLL[0]) || null` quietly stamped every press with the first one. That
// is the worse of the two failures: not a refusal but a DIFFERENT PICTURE from the one the CPU
// painter draws, with no throw, no console line and nothing in the master to say it happened. A
// guard existed for the neighbouring case, which is exactly how the shoulder went unchecked.
//
// And the refusal itself was unrecorded. A master drawn on the CPU because the GPU would not take it
// looked identical in the archive to one drawn on the CPU because nobody asked - both simply lacked
// `gpu` - so the reason lived only in a console nobody was watching. Recovering one such reason cost
// a morning on 2026-10-25, which is why `gpu: false`, `gpuWhy` and `gpuDetail` now exist.
//
// WHAT THIS HAS TO PROVE:
//   1  two disagreeing warp states are refused, and the message names the count
//   2  two disagreeing press rollers are refused the same way
//   3  the guards are discriminating, not blanket - one shared roller passes, and so does none
//   4  a document with one of each gets past both
//   5  the app carries the failure sentence out of both places the pool gives up
//   6  a refusal is written into the master, and the toggle being off is NOT a refusal
//
//   node tools/check-gpu-refusal.mjs
import { readFileSync } from 'fs';
import { packReal } from './lib/glass-real.mjs';

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log('  ok    ' + name); return; }
  fails++; console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};

// A DOCUMENT REDUCED TO WHAT THE GUARDS READ. packReal takes SLAB and H, finds a warp, finds a
// roller, collects the stamps - none of which needs a real slab - and then checks the two sets. So
// the guards are reachable on a skeleton, and anything thrown after them is a different sentence.
const WARP_A = { u: new Float32Array(4), v: new Float32Array(4) };
const WARP_B = { u: new Float32Array(4), v: new Float32Array(4) };
const ROLL_A = { s: new Float32Array(4), v: new Float32Array(4), R: {} };
const ROLL_B = { s: new Float32Array(4), v: new Float32Array(4), R: {} };
const stir = S => ({ k: 5, S, raw: {} });
const press = B => ({ k: 4, B, raw: {} });

const run = OPC => {
  try { packReal({ OPC, H: 1, ROLL: [ROLL_A, ROLL_B], SG: {}, S: null }, { SLAB: 1 }); return null; }
  catch (e) { return (e && e.message) || String(e); }
};
const says = (msg, what) => !!msg && msg.indexOf(what) >= 0;

// ---- 1: disagreeing warps ------------------------------------------------------------------------
{
  const m = run([stir(WARP_A), stir(WARP_B)]);
  ok('two warp states are refused', says(m, 'warp states'), m);
  ok('and the message names the count', says(m, '2 warp states'), m);
  ok('and says why rather than just no', says(m, 'per-op grids not built'), m);
}

// ---- 2: disagreeing rollers ------------------------------------------------------------------------
{
  const m = run([press(ROLL_A), press(ROLL_B)]);
  ok('two roller states are refused', says(m, 'roller states'), m);
  ok('and the message names the count', says(m, '2 roller states'), m);
}

// ---- 3: THE ABLATIONS - the guards discriminate rather than blanket-refuse -------------------------
// Same two presses, one bit different: they share a roller. If this still said "roller states" the
// test above would be proving nothing except that two presses exist.
{
  const shared = run([press(ROLL_A), press(ROLL_A)]);
  ok('ABLATION two presses sharing ONE roller are not refused for it', !says(shared, 'roller states'), shared);
  const none = run([press(null), press(null)]);
  ok('ABLATION two presses with no roller at all are not refused for it', !says(none, 'roller states'), none);
  const oneStir = run([stir(WARP_A), stir(WARP_A)]);
  ok('ABLATION two stirs sharing ONE warp are not refused for it', !says(oneStir, 'warp states'), oneStir);
  // three presses, two rollers: the count must follow the SET, not the op count
  const three = run([press(ROLL_A), press(ROLL_A), press(ROLL_B)]);
  ok('the count is of distinct rollers, not of presses', says(three, '2 roller states'), three);
}

// ---- 4: one of each gets past both -----------------------------------------------------------------
{
  const m = run([stir(WARP_A), press(ROLL_A)]);
  ok('a document with one of each passes both guards',
     !says(m, 'warp states') && !says(m, 'roller states'), m);
}

// ---- 5 and 6: the app carries it out, and writes it down --------------------------------------------
const APP = readFileSync(new URL('../app/stone-author.html', import.meta.url), 'utf8');
const has = (re, name) => ok(name, re.test(APP), String(re));
{
  const fails0 = APP.match(/gpuFail = \(e && e\.message\) \|\| String\(e\);/g) || [];
  ok('the failure sentence is captured at BOTH places the pool gives up', fails0.length === 2,
     fails0.length + ' site(s)');
  has(/console\.warn\('gpu: this document will not pack'/, 'the pack failure still logs');
  has(/console\.warn\('gpu: pipelines failed'/, 'the pipeline failure still logs');
  has(/let gpuFail = null;/, 'gpuFail is declared');
  has(/gpuWhy: \(gpuWhy && gpuWhy !== 'exp\.gpu\.off'\) \? gpuWhy : undefined,/,
      'the master records the refusal key');
  has(/gpu: \(poolRan && poolRan\.gpu\) \? true\s*\n\s*: \(\(gpuWhy && gpuWhy !== 'exp\.gpu\.off'\) \? false : undefined\),/,
      'and records gpu:false rather than leaving it absent');
  has(/gpuDetail: \(gpuWhy === 'exp\.gpu\.failed' && gpuFail\) \? gpuFail : undefined,/,
      'the detail rides only with exp.gpu.failed');
  // THE TOGGLE BEING OFF IS NOT A REFUSAL, and the record must not claim it was.
  const offGuards = (APP.match(/gpuWhy !== 'exp\.gpu\.off'/g) || []).length;
  ok('exp.gpu.off is excluded everywhere it could be written', offGuards >= 4, offGuards + ' guard(s)');
}

// ---- the ablation for 5: strip the capture and the check must go red --------------------------------
{
  const cut = APP.replace(/gpuFail = \(e && e\.message\) \|\| String\(e\);\n\s*/g, '');
  const n = (cut.match(/gpuFail = /g) || []).length;
  ok('ABLATION with the capture stripped, the site count is no longer 2', n !== 2, n + ' site(s)');
}

console.log('');
if (fails) { console.error('check-gpu-refusal: ' + fails + ' FAILED'); process.exit(1); }
console.log('check-gpu-refusal: a document the arena cannot hold is refused for the right reason,');
console.log('                   and the refusal reaches the master instead of a console.');

// HOW MUCH OF A RENDER IS THE NOISE FIELD? Count the calls; do not remove them.
//
// docs/glass-gpu.md priced a GPU-native field at 246x the CPU pool and then could not say what that
// was worth, because the field's SHARE of a render had never been measured. Every number in that
// document hung on it: at a 70% share the port buys 3.3x, at 30% it buys 1.4x, and those are
// different decisions.
//
// ABLATION WAS THE OBVIOUS INSTRUMENT AND IT LIED. Stubbing fbm2C and fbm2G to something cheap made
// a 520-square tile at W=65535 take 277.9 ms against the control's 164.9 - SLOWER, after removing
// work, with per-tile readings swinging 196 to 344. The stub changed the field's VALUES, the values
// decide the ribbon labelling in glassLay, and the renderer then painted a different picture. An
// ablation can only measure the thing it removes when nothing downstream depends on what it removed.
//
// COUNTING PERTURBS NOTHING. Every value, every branch and every pixel stays exactly as it was; the
// only addition is one increment per call. Measured cost of that: 163.6 ms against the control's
// 164.9, which is inside the control's own spread. Multiply the count by the per-call cost measured
// separately by tools/cpu-breakdown-probe.html and the share falls out.
//
// MEASURED 2026-10-24 on the glass master slab, radial mould, four tiles across the sheet:
//
//   2.000 fbm2C a pixel, every tile          one in glassFormT, one in glassLay's cord wander
//   0     fbm2G                              REL is 0 on this slab, so the gradient path is cold
//   1     glassFormT, 1 glassLay a pixel     no supersampling: one sample per pixel
//   597-651 ns a pixel of tile paint         mean 625
//
// fbm2C costs 40.0-44.4 ns on this box, so the noise is 80-89 ns of 625 - 13-14% of paint. Add the
// three Beer-Lambert exponentials and the whole modelled field is 17.7%. At the GPU's measured 246x
// that is 1.15x to 1.21x on paint, and it is the answer the GPU document was waiting for.
//
//   node harness/inject.mjs && node tools/count-field-calls.mjs
//
// then serve the repo and, in a browser on harness/dist/field-counted.html:
//
//   const slab = await (await fetch('/harness/dist/slab.json')).json();
//   __sa.deserialize(slab); __sa.render();
//   for (const k in __N) __N[k] = 0;
//   const t0 = performance.now();
//   __sa.renderOneTile(65535, 0, 0, 520, 520, 0);
//   ({ ms: performance.now() - t0, counts: __N });
//
// A COUNT IS NOT A COST. This says how MANY, never how long; the per-call figure has to come from
// cpu-breakdown-probe.html on the same machine in the same session, because the two engines measured
// there differ on this arithmetic by a factor of four.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'harness', 'dist', 'stone-author.hooked.html');
const OUT = join(root, 'harness', 'dist', 'field-counted.html');

if (!existsSync(SRC)) {
  console.error('no hooked build at harness/dist/stone-author.hooked.html');
  console.error('Run: node harness/inject.mjs');
  process.exit(1);
}

// WHICH FUNCTIONS. The two noise entry points on the per-sample path, plus the three callers, so the
// counts cross-check each other: fbm2C must come out at exactly twice glassFormT on a slab whose
// cord wander is on, and glassFormT must equal the pixel count unless something supersamples.
const WANT = ['fbm2C', 'fbm2G', 'glassFormT', 'glassFormTG', 'glassLay'];

const src = readFileSync(SRC, 'utf8');
const LB = 123, RB = 125;                                  // { and }, by code - see check-worker-core
function bodyOf(t, name) {
  const i = t.indexOf('function ' + name + '(');
  if (i < 0) return null;
  let d = 0;
  for (let k = t.indexOf(String.fromCharCode(LB), i); k < t.length; k++) {
    const c = t.charCodeAt(k);
    if (c === LB) d++;
    else if (c === RB) { d--; if (!d) return t.slice(i, k + 1); }
  }
  return null;
}

let out = src.replace(/\r\n/g, String.fromCharCode(10));
const done = [], missing = [];
for (const name of WANT) {
  const b = bodyOf(out, name);
  if (!b) { missing.push(name); continue; }
  const n = out.split(b).length - 1;
  if (n !== 1) { missing.push(name + ' (appears ' + n + ' times)'); continue; }
  const open = b.indexOf(String.fromCharCode(LB)) + 1;
  out = out.replace(b, b.slice(0, open) + ' window.__N.' + name + '++;' + b.slice(open));
  done.push(name);
}
if (missing.length) {
  console.error('could not count: ' + missing.join(', '));
  console.error('the app has been edited and this tool is stale - fix it rather than trusting a partial count');
  process.exit(1);
}

const anchor = '  window.__sa = {';
if (out.split(anchor).length - 1 !== 1) {
  console.error('could not find the __sa hook to declare the counters beside');
  process.exit(1);
}
out = out.replace(anchor, '  window.__N = { ' + WANT.map(n => n + ': 0').join(', ') + ' };'
  + String.fromCharCode(10) + anchor);

writeFileSync(OUT, out);
console.log('counted ' + done.length + ' of ' + WANT.length + ': ' + done.join(', '));
console.log('-> harness/dist/field-counted.html');
console.log('counters live on window.__N and are zeroed by hand before a tile');

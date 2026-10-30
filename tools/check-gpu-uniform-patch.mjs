// AN OFFSET A MATERIAL DOES NOT DECLARE MUST NEVER BE WRITTEN.
//
// `gpuPool` patches a few fields of the uniform per band, and it asks the MATERIAL where they live:
//
//   const { x: OFF_TX, y: OFF_TY, h: OFF_TH, blOn: OFF_BLON, ... } = M.off();
//
// Only stone declares the bloom's five. Wood's `off()` and glass's return `{x, y, h}`, so on those
// two `OFF_BLON` is `undefined` - and `DataView.setInt32(undefined, 0)` neither throws nor skips. It
// coerces the offset to 0 and writes a 32-bit zero over the FIRST field of that material's uniform.
//
// WHAT THAT COST, 2026-10-30. Wood's first field is `R`, the log radius. With R = 0 the test in
// woodShadeBody - `if (rad > E.R)` - held for every pixel, so it returned w = 0, main selected the
// surround colour, and a 16,384 master came back as one flat #15161b with every geometry count
// perfect and the export reporting success. Three were written before anything noticed, and the
// harvester would have recorded all three as good and deleted them, because `light.mean` read 23.33
// rather than 0. Measured end to end: packWood wrote [0.9586, 2, 0, 0, 8191.5, ...] and the device
// received [0, 2, 0, 0, 8191.5, ...], differing in that one float and nothing else.
//
// IT WAS A REGRESSION, not a limitation. At 3e3e174 the destructure read `{x, y, h}` and the token
// OFF_BLON did not appear in the file at all; GPU wood had rendered correctly at builds .224 and
// .227, including twice at 1,048,576. The bloom's offsets arrived with the stone shader and nothing
// asked whether the other two materials supplied them.
//
// WHAT THIS HAS TO PROVE:
//   1  every name the pool pulls out of M.off() is either supplied by EVERY material, or is only
//      ever written through a guard that skips an undefined offset
//   2  a name supplied by every material may be written directly - a required field that goes
//      missing should break loudly rather than quietly paint the wrong band
//   3  the guards actually guard: handed undefined they write nothing
//   4  and they are not merely present - ablating one turns this red
//
//   node tools/check-gpu-uniform-patch.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'app', 'stone-author.html'), 'utf8');
let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log('  ok    ' + name); return; }
  fails++; console.log('  FAIL  ' + name + (detail === undefined ? '' : '   ' + detail));
};
const die = m => { console.error('check-gpu-uniform-patch: ' + m); process.exit(1); };

// ---- what the pool asks the material for ---------------------------------------------------------
const dm = SRC.match(/const \{([^}]*)\} = M\.off\(\);/);
if (!dm) die('cannot find the `= M.off()` destructure - this gate is stale');
// `x: OFF_TX, y: OFF_TY, ...` -> key -> variable
const ASKED = new Map();
for (const part of dm[1].split(',')) {
  const kv = part.trim().match(/^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)$/);
  if (kv) ASKED.set(kv[1], kv[2]);
}
if (!ASKED.size) die('the destructure parsed to nothing');

// ---- what each material supplies -----------------------------------------------------------------
// GPU_MAT's materials each carry `off: () => ({ ... })`. Keys are read at depth 1 of that object, so
// a call like STONE_UNI_OFF('tileX') inside a value cannot be mistaken for a key.
const gi = SRC.indexOf('const GPU_MAT = {');
if (gi < 0) die('cannot find GPU_MAT');
let d = 0, ge = gi;
for (let i = SRC.indexOf('{', gi); i < SRC.length; i++) {
  if (SRC[i] === '{') d++; else if (SRC[i] === '}') { d--; if (!d) { ge = i; break; } }
}
const BODY = SRC.slice(gi, ge + 1);
const MATS = new Map();
for (const m of BODY.matchAll(/^\s{4}([A-Za-z_$][\w$]*): \{$/gm)) {
  const start = m.index + m[0].length;
  const oi = BODY.indexOf('off: () => ({', start);
  if (oi < 0) continue;
  let dd = 0, oe = oi;
  for (let i = BODY.indexOf('{', oi); i < BODY.length; i++) {
    if (BODY[i] === '{') dd++; else if (BODY[i] === '}') { dd--; if (!dd) { oe = i; break; } }
  }
  const inner = BODY.slice(BODY.indexOf('{', oi) + 1, oe);
  const keys = new Set();
  let depth = 0;
  for (const tk of inner.matchAll(/[{}()[\]]|([A-Za-z_$][\w$]*)\s*:/g)) {
    const t = tk[0];
    if (t === '{' || t === '(' || t === '[') { depth++; continue; }
    if (t === '}' || t === ')' || t === ']') { depth--; continue; }
    if (depth === 0 && tk[1]) keys.add(tk[1]);
  }
  MATS.set(m[1], keys);
}
if (MATS.size < 2) die('found ' + MATS.size + ' materials in GPU_MAT - expected the fork to have several');
console.log('  materials: ' + [...MATS.keys()].join(', '));
console.log('  pool asks for: ' + [...ASKED.keys()].join(', '));

// ---- 1 + 2: universal fields may be direct, optional ones must be guarded -------------------------
const universal = [], optional = [];
for (const key of ASKED.keys()) {
  (([...MATS.values()].every(s => s.has(key))) ? universal : optional).push(key);
}
console.log('  supplied by every material: ' + (universal.join(', ') || '(none)'));
console.log('  optional: ' + (optional.join(', ') || '(none)'));
ok('at least one field is optional (otherwise this gate is idle)', optional.length > 0);

for (const key of optional) {
  const v = ASKED.get(key);
  const missing = [...MATS.entries()].filter(([, s]) => !s.has(key)).map(([n]) => n);
  // a direct write is `<anything>.setInt32(VAR,` or `.setFloat32(VAR,` - the guards take the view as
  // their FIRST argument, so a guarded call never matches this shape.
  const direct = new RegExp('\\.set(?:Int32|Float32|Uint32)\\(\\s*' + v + '\\b', 'g');
  const n = (SRC.match(direct) || []).length;
  ok('"' + key + '" is not supplied by ' + missing.join('/') + ', so ' + v + ' is never written directly',
     n === 0, n ? n + ' direct write(s) found - DataView would coerce undefined to offset 0' : '');
}

// ---- 3: the guards actually guard ----------------------------------------------------------------
// LIFTED from the app rather than restated here, so the gate measures the real line.
// THE WHOLE LINE, not `[^;]+` - the first `;` in these is INSIDE the arrow body, so that spelling
// lifted a truncated expression and the gate died on a syntax error of its own making.
const gm = SRC.match(/^[ \t]*const blInt = .*$/m);
const gf = SRC.match(/^[ \t]*const blF32 = .*$/m);
ok('the guards exist in the pool', !!gm && !!gf);
if (gm && gf) {
  const mk = src => new Function('return (' + src.trim().replace(/^const \w+ = /, '').replace(/;\s*$/, '') + ');')();
  const blInt = mk(gm[0]), blF32 = mk(gf[0]);
  const calls = [];
  const view = { setInt32: (o, v) => calls.push(['i', o, v]), setFloat32: (o, v) => calls.push(['f', o, v]) };
  blInt(view, undefined, 1); blF32(view, undefined, 1);
  ok('an undefined offset writes nothing', calls.length === 0, JSON.stringify(calls));
  blInt(view, 0, 7); blF32(view, 4, 1.5);
  ok('a real offset still writes', calls.length === 2 && calls[0][1] === 0 && calls[1][1] === 4,
     JSON.stringify(calls));
  // ---- 4: ABLATION. An unguarded helper must fail the test above, or it is not being measured.
  const bad = mk('const blInt = (view, off, v) => { view.setInt32(off, v, true); };');
  const c2 = [];
  bad({ setInt32: (o, v) => c2.push([o, v]) }, undefined, 1);
  ok('ablated: an unguarded helper DOES write at undefined', c2.length === 1 && c2[0][0] === undefined);
  // and that this is the coercion that did the damage
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat32(0, 0.9586, true);
  dv.setInt32(undefined, 0, true);
  ok('ablated: DataView coerces an undefined offset to byte 0', dv.getFloat32(0, true) === 0);
}

console.log(fails ? '\ncheck-gpu-uniform-patch: ' + fails + ' FAILED' : '\ncheck-gpu-uniform-patch: ok');
process.exit(fails ? 1 : 0);

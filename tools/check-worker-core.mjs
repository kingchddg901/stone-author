// DOES THE WORKER CORE CARRY EVERYTHING IT REACHES FOR?
//
// The core is this file's own functions put through `fn.toString()` into an inline Blob worker. That
// is the whole trick and the whole hazard: a function serialised out of its closure keeps its TEXT
// and loses its SCOPE, so every name it touches has to be declared in the worker preamble or lifted
// beside it. Miss one and nothing complains until the worker runs that line, on whatever device
// happens to take that path.
//
// It has happened four times. `groundCol` was caught by hand while wiring it. `surfaceGloss` was not:
// it landed with the glaze, applyCoat asks for it on every tile of every material, and the pool threw
// for every render after it. Then `sectionList`, reported from an iPhone rendering wood - a different
// name, earlier in the paint order, on the same broken core. Then `WOOD_IN`, which the first version
// of THIS gate could not see, because it is a number rather than a function and the scan looked only
// for calls. Every other gate here checks the app. This is the only one that checks what it GENERATES.
//
//   node tools/check-worker-core.mjs              audit
//   node tools/check-worker-core.mjs --self-test  prove it can go red
//
// WHAT IT LOOKS FOR, after WOOD_IN: a REFERENCE, not a call. A function is reached by being called
// and a constant by being read, and only the second kind is invisible to a bracket. It also takes
// every declarator on a line - `const WOOD_FT = 1, WOOD_IN = 1 / 12;` declares two, and reading only
// the first is why WOOD_IN was not merely unreported but never in the set to check.
//
// TRANSITIVE, because carrying a function carries its own reach: adding one to the list can import
// several more free names behind it, which is how a fix becomes the next bug.
import { readFileSync } from 'fs';

const SRC = readFileSync('app/stone-author.html', 'utf8');
const SELF = process.argv.includes('--self-test');

// ---- what the worker is given ------------------------------------------------------------------
const fnsAt = SRC.indexOf('const fns = {');
if (fnsAt < 0) { console.error('could not find the worker core function list'); process.exit(2); }
const listed = [...new Set(SRC.slice(fnsAt + 13, SRC.indexOf('};', fnsAt))
  .split(/[,\s]+/).map(s => s.trim()).filter(s => /^[A-Za-z_$][\w$]*$/.test(s)))];
const preamble = SRC.slice(SRC.indexOf('let s = `var H=', fnsAt), SRC.indexOf('self.onmessage', fnsAt));
const carried = new Set(listed);
for (const m of preamble.matchAll(/var ([A-Za-z_$][\w$,]*)/g))
  for (const n of m[1].split(',')) if (n) carried.add(n);
for (const m of preamble.matchAll(/([A-Za-z_$][\w$]*)\s*=/g)) carried.add(m[1]);

// Names the preamble REPLACES rather than merely declares: `ensureClouds` and its two siblings are
// rewritten there as stubs handing back a bitmap passed in at init. Walking the app's version of one
// reports what IT reaches, which is a function the worker does not have.
const overridden = new Set();
for (const m of preamble.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*\(\)\s*=>/g)) overridden.add(m[1]);

// ---- KNOWN AND ACCOUNTED FOR --------------------------------------------------------------------
// A name here is one the core reaches and does not carry, with the reason it is survivable. `gated`
// means a guard keeps the pool away from the path - corePaintsThis is where those live - and says
// which guard. `unreviewed` means exactly that: nobody has walked the path, so it may throw when the
// path runs. The list is meant to SHRINK, and anything not on it fails the build.
const DECLARED = {
  sectionList: 'gated - only a graft reaches it, and corePaintsThis refuses the pool when one is set',
  blurDraw:    'gated - applyCoat reaches it only under `f.uvMode`, and corePaintsThis refuses the pool in uvMode. Verified at the call site, not assumed',
  serialize:   'unreviewed - wrap; lifting it would carry the whole app state, so it has to stay gated instead',
  TR:          'unreviewed - weightOf, on a branch no tile paint is known to take',
  layToken:    'unreviewed - weightOf, same branch',
  registerSelectedColours: 'unreviewed - weightOf, same branch',
  pressFactor: 'unreviewed - rollerPath, the pen path, which a tile render does not drive',
  leanProfile: 'unreviewed - rollerPath, same',
  penAxis:     'unreviewed - rollerPath, same',
  liftCol:     'unreviewed - fxOn and paintSpecksLayer',
  emitCross:   'unreviewed - emit, the crossfade branch',
  hk:          'unreviewed - cellGrid and forNear',
  at:          'unreviewed - tangent',
  inside:      'unreviewed - lineGeom',
  smooth1d:    'unreviewed - lineGeom',
  meanOfRegion: 'unreviewed - loudestCell',
  // VALUES, which the first version of this gate could not see at all. Every one is reachable only
  // on a branch, which is why the pool worked for the 262,144 glass daylight render and broke on
  // wood: that run took none of these paths. They are listed, not fixed, because fixing one wrongly
  // is worse than leaving it - glowPx varies per tile, so a snapshot would be quietly wrong where a
  // missing name is loudly broken.
  BLOOM_DRAW:  'unreviewed - HIGHEST RISK of this group. applyCoat reads it inside the uvMode branch (gated), but fxOn, paintSpecksLayer and paintVeinLayer read it on their glow branches, which are not',
  glowPx:      'unreviewed - with BLOOM_DRAW, and harder: it is set per tile from the blur scale, so it cannot be emitted as a constant',
  UV_LIFT:     'unreviewed - applyCoat, uvMode branch only, so gated with blurDraw',
  mmC:         'unreviewed - applyCoat, the metal-mask canvas; reached when a slab has a metal layer',
  spC:         'unreviewed - applyCoat, the specular canvas; reached when gloss is above zero',
  crossOn:     'unreviewed - emit, the crossfade branch',
  crossA:      'unreviewed - emit, same branch',
  crossB:      'unreviewed - emit, same branch',
  crossT:      'unreviewed - emit, same branch',
  kit:         'unreviewed - weightOf; the theme kit, which a worker has no business holding',
  selected:    'unreviewed - weightOf; the selection, likewise',
  press:       'unreviewed - glassUnform and paintGlassContent, the press path',
  pen:         'unreviewed - rollerPath, the pen path',
  end:         'unreviewed - resample',
  raw:         'unreviewed - deflect',
};

// ---- every module-level name, every declarator ---------------------------------------------------
const topLevel = new Set();
for (const m of SRC.matchAll(/\n  (?:async )?function\s+([A-Za-z_$][\w$]*)/g)) topLevel.add(m[1]);
for (const m of SRC.matchAll(/\n  (?:const|let|var)\s+([^\n;]*)/g)) {
  let depth = 0, expect = true, name = '';
  for (const ch of m[1]) {
    if ('([{'.includes(ch)) { depth++; continue; }
    if (')]}'.includes(ch)) { depth--; continue; }
    if (depth !== 0) continue;
    if (ch === ',') { if (name) { topLevel.add(name); name = ''; } expect = true; continue; }
    if (!expect) continue;
    if (/[A-Za-z_$]/.test(ch) && !name) { name = ch; continue; }
    if (name && /[\w$]/.test(ch)) { name += ch; continue; }
    if (name) { topLevel.add(name); name = ''; }
    if (ch !== ' ') expect = false;
  }
  if (name) topLevel.add(name);
}

// ---- the scan -------------------------------------------------------------------------------------
function bodyOf(name) {
  for (const open of ['\n  function ' + name + '(', '\n  async function ' + name + '(',
                      '\n  const ' + name + ' = ', '\n  let ' + name + ' = ']) {
    const i = SRC.indexOf(open);
    if (i < 0) continue;
    let d = 0, began = false;
    for (let k = i; k < SRC.length; k++) {
      const c = SRC[k];
      if (c === '{') { d++; began = true; }
      else if (c === '}') { d--; if (began && d === 0) return SRC.slice(i, k + 1); }
      else if (c === '\n' && d === 0 && began) return SRC.slice(i, k);
    }
  }
  return null;
}
const strip = b => b.replace(/\/\/[^\n]*/g, '').replace(/'[^'\n]*'/g, "''")
                    .replace(/"[^"\n]*"/g, '""').replace(/`[^`]*`/g, '``');

// A REFERENCE: not preceded by a word character or a dot (so `WOOD.graft` is a property, not this
// name), not followed by a word character, and not a key in an object literal.
function uses(body, name) {
  let at = body.indexOf(name);
  while (at >= 0) {
    const before = at === 0 ? ' ' : body[at - 1];
    const after = body[at + name.length] || ' ';
    let k = at + name.length;
    while (body[k] === ' ') k++;
    if (!/[\w$.]/.test(before) && !/[\w$]/.test(after) && body[k] !== ':') return true;
    at = body.indexOf(name, at + 1);
  }
  return false;
}
// the only false positive available: the caller declares the name itself
function shadows(body, name) {
  for (const kw of ['const ', 'let ', 'var ', 'function ']) {
    let at = body.indexOf(kw + name);
    while (at >= 0) {
      if (!/[\w$]/.test(body[at + kw.length + name.length] || ' ')) return true;
      at = body.indexOf(kw + name, at + 1);
    }
  }
  const head = body.slice(0, body.indexOf('{') + 1);
  return new RegExp('[(,]\\s*' + name + '\\s*[,)=]').test(head);
}

function reach(seed, carriedSet) {
  const found = new Map();
  const queue = [...seed], seen = new Set(seed);
  while (queue.length) {
    const n = queue.shift();
    const raw = bodyOf(n); if (!raw) continue;
    const b = strip(raw);
    for (const other of topLevel) {
      if (other === n || !uses(b, other) || shadows(b, other)) continue;
      if (carriedSet.has(other)) {
        if (!seen.has(other) && !overridden.has(other)) { seen.add(other); queue.push(other); }
        continue;
      }
      if (!found.has(other)) found.set(other, []);
      if (!found.get(other).includes(n)) found.get(other).push(n);
    }
  }
  return found;
}

const unresolved = reach(listed, carried);

if (SELF) {
  // THE BITE, IN BOTH SHAPES, because the gate has already been blind to one of them: drop a carried
  // FUNCTION and a carried VALUE and require each one back.
  const fn = listed.find(n => bodyOf(n));
  const val = [...carried].find(n => !listed.includes(n) && /^[A-Z][A-Z_0-9]{2,}$/.test(n)
                                     && SRC.includes('  const ' + n));
  let bad = 0;
  for (const [kind, victim] of [['function', fn], ['value', val]]) {
    if (!victim) { console.log(`self-test: no ${kind} available to drop`); bad++; continue; }
    const less = new Set(carried); less.delete(victim);
    const after = reach(listed.filter(n => n !== victim), less);
    const caught = after.has(victim);
    console.log(`self-test: dropped the ${kind} ${victim} - ${caught ? 'reported' : 'NOT REPORTED'}`);
    if (!caught) bad++;
  }
  if (bad) { console.error('SELF-TEST FAILED: the scan did not report something it no longer carries'); process.exit(2); }
  console.log('self-test: both shapes caught. The gate bites.');
  process.exit(0);
}

const fresh = [...unresolved].filter(([n]) => !(n in DECLARED));
const known = [...unresolved].filter(([n]) => n in DECLARED);

console.log(`worker core: ${listed.length} functions carried, ${unresolved.size} names reached and not carried`);
for (const [n, callers] of known.sort())
  console.log(`  known  ${n.padEnd(22)} <- ${callers.join(', ')}   ${DECLARED[n]}`);
if (!fresh.length) {
  const un = known.filter(([n]) => DECLARED[n].startsWith('unreviewed')).length;
  console.log(`worker core: OK - nothing new. ${un} still unreviewed; the list is meant to shrink.`);
  process.exit(0);
}
for (const [n, callers] of fresh)
  console.error(`  NEW    ${n.padEnd(22)} <- ${callers.join(', ')}`);
console.error(`worker core: ${fresh.length} name(s) the core reaches and cannot resolve, and that nothing accounts for.`);
console.error('Carry it beside the function that needs it (fns list for a function, the preamble for a');
console.error('value), or gate the pool away from that path in corePaintsThis - then record which here.');
process.exit(1);

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
// A SECOND WAY IN, and it is not a loophole. A name declared BELOW renderCoreSrc cannot be written
// into the literal above without opening a temporal dead zone, which check-bleed refuses by name -
// glowLift is a const arrow some seven thousand lines further down. The app's answer is the one its
// own comment describes: a hoisted function declaration, called from up there, resolving against the
// live binding at call time. So `Object.assign(fns, glowFns())` carries whatever glowFns returns,
// and this reads that function's body to find out what that is. Anything carried this way is as
// carried as anything in the literal; missing it would report real names as unresolved forever.
for (const m of SRC.matchAll(/Object\.assign\(fns, (\w+)\(\)\)/g)) {
  const body = bodyOf(m[1]);
  if (!body) continue;
  const ret = body.match(/return \{([^}]*)\}/);
  if (ret) for (const n of ret[1].split(/[,\s]+/).map(x => x.trim()).filter(x => /^[A-Za-z_$][\w$]*$/.test(x)))
    if (!listed.includes(n)) listed.push(n);
}
let preamble = SRC.slice(SRC.indexOf('let s = `var H=', fnsAt), SRC.indexOf('self.onmessage', fnsAt));
// AND THE PREAMBLE CAN BE BUILT IN PIECES, for the same dead-zone reason the fns list can. A line
// that reads `s += glowPreamble();` emits declarations this scan would otherwise never see, and the
// names in them would be reported unresolved for ever. Inline the called function's body before
// scanning, so a `var` written there counts exactly as one written inline.
for (const m of preamble.matchAll(/s \+= (\w+)\(\);/g)) {
  const body = bodyOf(m[1]);
  if (body) preamble += String.fromCharCode(10) + body;
}
let ORDER_OK = 0;
// ---- ORDER, NOT ONLY PRESENCE --------------------------------------------------------------------
// A name can be carried and still be unusable where the preamble uses it. The lifted functions are
// emitted as `var name = function...` - an ASSIGNMENT, which declares early and assigns late - so a
// preamble line that CALLS one of them runs while it is still undefined.
//
// That shipped once. `var SPIN_T=spinTable();` sat fifty lines above the function list and every
// worker threw `spinTable is not a function`, while the main thread - where the same table is a
// module const declared after the function - worked perfectly. Nothing caught it: this gate checked
// that spinTable was carried, which it was; every probe and every local measurement went through
// renderOneTile, which is the MAIN THREAD and never builds a core at all.
//
// So: no preamble line may call a lifted function. Allocations and built-ins only.
{
  const emitAt = SRC.indexOf('for (const n in fns)', fnsAt);
  const before = emitAt < 0 ? '' : SRC.slice(SRC.indexOf('let s = `var H=', fnsAt), emitAt);
  // SCANNED, NOT MATCHED. A RegExp built from a string needs its backslashes doubled, and the first
  // version of this line lost them through a generator - `[^\w$.]` became `[^w$.]` and the pattern
  // would not even compile. Plain indexOf cannot be mangled that way.
  const NLC = String.fromCharCode(10);
  const wordish = c => c === '_' || c === '$' || (c >= '0' && c <= '9')
    || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
  const bad = [];
  for (const n of listed) {
    for (let at = before.indexOf(n); at >= 0; at = before.indexOf(n, at + 1)) {
      const pre = at > 0 ? before[at - 1] : ' ';
      if (wordish(pre) || pre === '.') continue;          // part of a longer name, or a property
      let k = at + n.length;
      while (before[k] === ' ') k++;
      if (before[k] !== '(') continue;                    // a mention, not a call
      // and only inside an emitted template, which is what becomes worker source
      const ls = before.lastIndexOf(NLC, at) + 1;
      const line = before.slice(ls, before.indexOf(NLC, at));
      if (line.trimStart().startsWith('s +=') && !bad.includes(n)) { bad.push(n); break; }
    }
  }
  if (bad.length) {
    console.error('worker core: ' + bad.length + ' preamble line(s) CALL a lifted function before the');
    console.error('function list is emitted, so the name is declared but still undefined when it runs:');
    for (const n of bad) console.error('  TOO EARLY   ' + n + '()');
    console.error('Move the line below `for (const n in fns)`. The preamble may use built-ins only.');
    process.exit(1);
  }
  ORDER_OK = listed.length;
}

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
    // AN EXPRESSION-BODIED ARROW HAS NO BRACES, and this used to scan straight past it looking for
    // one - capturing every line until the next balanced brace pair anywhere below, comments and all.
    // `glowLift` is `const glowLift = () => A ? B : C;` and the over-capture invented three names out
    // of the prose beneath it: expMeta, redraw, and `negative`, which is not declared anywhere in the
    // app at all. A gate that manufactures names is worse than one with a gap, because it teaches the
    // reader to skim its output.
    //
    // So: track brackets of every kind, and for a `const`/`let` declaration end at the first `;` that
    // is outside all of them. A braced body still ends where it always did.
    let d = 0, began = false, par = 0, sq = 0;
    for (let k = i; k < SRC.length; k++) {
      const c = SRC[k];
      if (c === '(') par++;
      else if (c === ')') par--;
      else if (c === '[') sq++;
      else if (c === ']') sq--;
      else if (c === '{') { d++; began = true; }
      else if (c === '}') { d--; if (began && d === 0) return SRC.slice(i, k + 1); }
      // A COMMA ENDS IT TOO, because these declarations come in groups: `const SLAB_FT = 8, FT_MM =
      // 304.8;` and `let fam = 'carrara', tool = 'vein', view = 'stone';`. Stopping only at the
      // semicolon made each name appear to reach its siblings - which is how the first draft of this
      // fix reported `FT_MM <- SLAB_FT`. A comma inside brackets is an argument list, not a sibling,
      // which is what the three counters are for.
      else if ((c === ';' || c === ',') && !began && d === 0 && par === 0 && sq === 0) return SRC.slice(i, k + 1);
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
console.log(`  preamble order: ${ORDER_OK} carried names checked, none called before the function list`);
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

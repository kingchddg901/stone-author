// BUILDS THE PAGES IN tools/ CANNOT MAKE FOR THEMSELVES.
//
// Four diagnostic pages compare one build of the app against another, or read what a function was
// handed while a real tile was painted. A browser page can do neither: it cannot check out a git
// ref, and it cannot reach inside the app's IIFE to instrument a closure-local function. This makes
// those builds, so the pages are runnable by somebody who was not here when they were written.
//
//   node tools/make-probe-builds.mjs                 everything, with HEAD as the "before" ref
//   node tools/make-probe-builds.mjs --ref=v1.2.0    compare against that ref instead
//   node tools/make-probe-builds.mjs --only=perop    one target
//   node tools/make-probe-builds.mjs --only=ablate   the paint ablation, below
//
// WHAT EACH PAGE NEEDS
//   tools/ab-tile-stats.html      stone-author.before.html + stone-author.hooked.html
//   tools/ab-slab-picture.html    the same two
//   tools/unwarp-recorded.html    stone-author.rec-before.html + stone-author.rec-after.html
//   tools/stir-domain.html        perop-capture.html
//
// The "before" build comes from a git ref and the "after" from the WORKING TREE, which is the pair
// that answers "what did my edit do to the picture". With a clean tree the two are identical, and
// every page here says so rather than reporting a perfect match - a differential that cannot find
// anything has not been shown able to find anything.
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const APP = join(ROOT, 'app', 'stone-author.html');
const DIST = join(ROOT, 'harness', 'dist');

const args = process.argv.slice(2);
const argOf = (n, d) => (args.find(a => a.startsWith('--' + n + '=')) || ('=' + d)).split('=')[1];
const REF = argOf('ref', 'HEAD');
const ONLY = argOf('only', '');

const run = (cmd, a) => execFileSync(cmd, a, { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });

// THE RECORDER THAT GOES INSIDE glassUnwarp. It records what the function was HANDED, which is the
// one thing a caller-side reconstruction keeps getting wrong: an earlier attempt rebuilt the
// (cu, cvv) mapping from F.RM and F.RS by their names and was simply measuring its own guess.
const UNWARP_REC = [
  '  const __UW = { n: 0, out: 0, cvvLo: 1e9, cvvHi: -1e9, fyLo: 1e9, fyHi: -1e9,',
  '                 fxLo: 1e9, fxHi: -1e9, dLo: 1e9, dHi: -1e9, perS: new Map() };',
  '  window.__UW = __UW;',
  '  function glassUnwarp(S, cu, cvv, out) {',
  '    {',
  '      const _fy = (cvv / S.H) * (S.ny - 1), _fx = cu * (S.nx - 1);',
  '      __UW.n++;',
  '      if (_fy < 0 || _fy > S.ny - 1 || _fx < 0 || _fx > S.nx - 1) __UW.out++;',
  '      if (cvv < __UW.cvvLo) __UW.cvvLo = cvv; if (cvv > __UW.cvvHi) __UW.cvvHi = cvv;',
  '      if (_fy < __UW.fyLo) __UW.fyLo = _fy; if (_fy > __UW.fyHi) __UW.fyHi = _fy;',
  '      if (_fx < __UW.fxLo) __UW.fxLo = _fx; if (_fx > __UW.fxHi) __UW.fxHi = _fx;',
  "      const key = S.nx + 'x' + S.ny + '@' + (S.H || 0).toFixed(4);",
  '      let r = __UW.perS.get(key);',
  '      if (!r) { r = { n: 0, out: 0, fyLo: 1e9, fyHi: -1e9 }; __UW.perS.set(key, r); }',
  '      r.n++; if (_fy < 0 || _fy > S.ny - 1) r.out++;',
  '      if (_fy < r.fyLo) r.fyLo = _fy; if (_fy > r.fyHi) r.fyHi = _fy;',
  '    }',
  '',
].join('\n');

// AND THE ONE KEYED BY CHAIN POSITION. Pooling every stir's calls together cannot tell a mapping
// that is wrong from a chain that carries the coordinate out, and those need different repairs.
// glassUnform walks the chain BACKWARDS, so the first stir to fire is the highest op index.
const PEROP_REC = [
  '  const __PO = { rows: new Map() };',
  '  window.__PO = __PO;',
  '  function glassUnwarp(S, cu, cvv, out) {',
  '    {',
  '      const key = __PO.cur === undefined ? -1 : __PO.cur;',
  '      let r = __PO.rows.get(key);',
  '      if (!r) { r = { n: 0, cuLo: 1e9, cuHi: -1e9, cvLo: 1e9, cvHi: -1e9, outU: 0, outV: 0 };',
  '                __PO.rows.set(key, r); }',
  '      r.n++;',
  '      if (cu < r.cuLo) r.cuLo = cu; if (cu > r.cuHi) r.cuHi = cu;',
  '      if (cvv < r.cvLo) r.cvLo = cvv; if (cvv > r.cvHi) r.cvHi = cvv;',
  '      if (cu < 0 || cu > 1) r.outU++;',
  '      if (cvv < 0 || cvv > S.H) r.outV++;',
  '    }',
  '',
].join('\n');

const SIG = '  function glassUnwarp(S, cu, cvv, out) {';
const OPS = '        const S = op.S;';
const TAILSIG = "    out[1] = -((S.v[k] * (1 - tx) + S.v[k + 1] * tx) * (1 - ty) + (S.v[k2] * (1 - tx) "
              + "+ S.v[k2 + 1] * tx) * ty);";

// EVERY INJECTION IS COUNTED. A replace that silently matches nothing leaves a build that looks
// instrumented, exposes no recorder, and sends the page down its "the build is stale" path - which
// reads as the page being broken rather than this script having missed.
function must(src, needle, what) {
  const n = src.split(needle).length - 1;
  if (n !== 1) {
    console.error(`make-probe-builds: ${what} appears ${n} times, expected 1`);
    console.error('the app has moved under this tool - fix the anchor rather than shipping a build');
    console.error('that cannot record anything');
    process.exit(1);
  }
}

function instrument(src, rec, perOp) {
  must(src, SIG, 'the glassUnwarp signature');
  let out = src.replace(SIG, rec);
  if (perOp) { must(src, OPS, "the stir arm's op.S"); out = out.replace(OPS, OPS + ' __PO.cur = i;'); }
  else {
    must(src, TAILSIG, "glassUnwarp's last line");
    out = out.replace(TAILSIG, TAILSIG + '\n'
      + '    if (out[0] < __UW.dLo) __UW.dLo = out[0];'
      + ' if (out[0] > __UW.dHi) __UW.dHi = out[0];');
  }
  return out;
}


// ---- THE PAINT ABLATION -------------------------------------------------------------------------
// WHAT A RENDER COSTS WITH PAINTING FREE, which is the floor a perfect GPU port approaches. It exists
// because estimating that floor from the current arrangement has been wrong every time it was tried:
// the port does not make one stage faster, it RESTRUCTURES - twelve workers that paint and finish
// become one painter and N finishers - so a share measured under the old arrangement is a share of an
// arrangement that stops existing. Wood was called "might not speed this up much at all" on exactly
// that reasoning and went 8.8x.
//
// IT MUST NOT ABLATE THE BYTES. The obvious stub is a flat fill, and it is wrong: stone writes 0.645
// GB and chewing that is the finishers' whole job, so a flat fill compresses to nothing and the
// render comes in far under the true floor - a fake ceiling, read confidently. So the stub paints ONE
// real tile per worker and blits that cache for every tile after it. Byte volume survives, per-tile
// painting does not.
//
// IT REMOVES PAINTING FROM ALL TWELVE WORKERS AT ONCE, which is why it prices the restructure rather
// than just the arithmetic: the contention that painting causes goes with it.
//
// VALIDATE IT BEFORE TRUSTING IT. Wood through the real shader is 12.5 s at 65,535 / tile 2048 / pool
// 12. If the ablated wood render lands near that, this predicts GPU wall and can be pointed at a
// material that has no shader. If it lands somewhere else it is measuring something else, and the
// thing to do is throw it out rather than reason from it.
//
// FOUR EDITS, because the pooled path paints in a WORKER. The core is serialised with fn.toString()
// out of its closure, so it keeps the TEXT and loses the SCOPE: the replacement travels, and every
// free name in it has to be declared in the preamble or lifted beside it. check-worker-core says in
// its own comment that a function declaration is invisible to it, so __ablPaint would not have been
// caught - it is carried here deliberately rather than by the gate noticing.
const ABLATE = [
  [`  function paintContent(ident, angleView) {
    if (MATERIAL === 'wood') return paintWoodContent(ident, angleView);
    if (MATERIAL === 'glass') return paintGlassContent(ident, angleView);
    return paintStoneContent(ident, angleView);
  }`,
   `  function paintContent(ident, angleView) {
    const cv = g2d.canvas;
    const k = cv.width + 'x' + cv.height + '|' + (ident ? 1 : 0) + '|' + (angleView ? 1 : 0)
            + '|' + (uvMode ? 1 : 0) + '|' + MATERIAL;
    if (__ablCv && __ablKey === k) {
      const t = g2d.getTransform();
      g2d.setTransform(1, 0, 0, 1, 0, 0);
      g2d.drawImage(__ablCv, 0, 0);
      g2d.setTransform(t);
      return;
    }
    __ablPaint(ident, angleView);
    try {
      const c2 = new OffscreenCanvas(cv.width, cv.height);
      const x2 = c2.getContext('2d');
      x2.setTransform(1, 0, 0, 1, 0, 0);
      x2.drawImage(cv, 0, 0);
      __ablCv = c2; __ablKey = k;
    } catch (_) { __ablCv = null; __ablKey = ''; }
  }
  function __ablPaint(ident, angleView) {
    if (MATERIAL === 'wood') return paintWoodContent(ident, angleView);
    if (MATERIAL === 'glass') return paintGlassContent(ident, angleView);
    return paintStoneContent(ident, angleView);
  }`,
   'the painter'],

  ['      paintWoodContent, paintContent, setMaterial,',
   '      paintWoodContent, paintContent, __ablPaint, setMaterial,',
   'the lift list'],

  ['    s += `var ssC,lensC,spC,mmC;',
   '    s += `var __ablCv=null,__ablKey=\'\';`;\n    s += `var ssC,lensC,spC,mmC;',
   'the worker preamble'],
];

function ablate(src) {
  let out = src;
  for (const [from, to, what] of ABLATE) {
    const n = out.split(from).length - 1;
    if (n !== 1) {
      console.error('make-probe-builds: the ablation could not find ' + what
                    + ' (' + n + ' matches) - the app has moved under this recipe');
      process.exit(1);
    }
    out = out.split(from).join(to);
  }
  return out;
}

const held = readFileSync(APP, 'utf8');
let restored = false;
const restore = () => { if (!restored) { writeFileSync(APP, held); restored = true; } };
process.on('exit', restore);
process.on('SIGINT', () => { restore(); process.exit(130); });

function build(src, outName, capture) {
  writeFileSync(APP, src);
  run('node', ['harness/inject.mjs']);
  if (capture) {
    run('node', ['tools/capture-scene.mjs']);
    renameSync(join(DIST, 'scene-capture.html'), join(DIST, outName));
  } else {
    renameSync(join(DIST, 'stone-author.hooked.html'), join(DIST, outName));
  }
  console.log('  ' + outName);
}

function atRef(ref) {
  try {
    return execFileSync('git', ['show', ref + ':app/stone-author.html'],
                        { cwd: ROOT, maxBuffer: 1 << 28 }).toString('utf8');
  } catch {
    console.error(`make-probe-builds: cannot read app/stone-author.html at ${ref}`);
    process.exit(1);
  }
}

const chrLF = String.fromCharCode(10);
const want = n => !ONLY || ONLY === n;
const before = atRef(REF);
// NORMALISED BEFORE COMPARING, because git stores LF and a Windows checkout has CRLF, so the raw
// strings are never equal and this check could never fire - which is exactly the failure it exists
// to catch, one level up.
const same = s => s.split(String.fromCharCode(13) + chrLF).join(chrLF);
if (same(before) === same(held)) {
  console.log(`note: the working tree matches ${REF}, so the two arms will be IDENTICAL.`);
  console.log('      Every page checks for that and says so; a match it reports is not a result.');
}

console.log(`building against ${REF}:`);
if (want('ab')) {
  build(before, 'stone-author.before.html', false);
  build(held, 'stone-author.hooked.html', false);
}
if (want('unwarp')) {
  build(instrument(before, UNWARP_REC, false), 'stone-author.rec-before.html', false);
  build(instrument(held, UNWARP_REC, false), 'stone-author.rec-after.html', false);
}
if (want('perop')) {
  build(instrument(held, PEROP_REC, true), 'perop-capture.html', true);
}
// THE FLOOR, with painting free. One build; the two renders that read it are a wood validation
// against a known 12.5 s and then whatever material is in question.
if (want('ablate')) {
  build(ablate(held), 'stone-author.paint-ablated.html', false);
}

restore();
// and leave the ordinary builds the rest of the harness expects, not an instrumented one
run('node', ['harness/inject.mjs']);
run('node', ['tools/capture-scene.mjs']);
if (!existsSync(join(DIST, 'slab.json'))) {
  console.log('note: harness/dist/slab.json is missing - the pages load a slab from there.');
}
console.log('app/stone-author.html restored; harness/dist rebuilt from it');

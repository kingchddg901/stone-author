// THE SUBSURFACE'S WHOLE-PICTURE FIELD, AND THE ONE WAY IT GOES WRONG IN SILENCE.
//
// The field exists so a tile stops blurring: applyCoat adds this tile's piece of a precomputed
// envelope instead of computing |orig - blur(orig)| from neighbours, and coatRadius therefore drops the
// clause that charged 2.40% of picture width in bleed. At 1,048,576 that is 25,170px each side, which
// is what made the render impossible rather than slow.
//
// SO THE TWO HALVES ARE ONE DECISION WEARING TWO FACES. A tile whose bleed was sized for the field and
// whose coat then fell through to the original blur reads 25,170 pixels of neighbours it was never
// given - it blurs against a transparent edge at every tile join. That does not throw, does not fail a
// syntax check, does not change a byte count, and produces a master that passes every other gate in
// this repo with a lattice in it. One predicate, asked twice, is the only defence, and this gate holds
// the code to it.
//
// EVERY CLAIM HERE IS ABLATED. --ablate mutates the app text in memory, one break at a time, and
// asserts the matching check goes RED. A check that cannot go red is a preference, and a gate made of
// preferences reads as coverage.
//
//   node tools/check-coat-field.mjs
//   node tools/check-coat-field.mjs --ablate
import { readFileSync } from 'fs';

const APP = 'app/stone-author.html';
const ABLATE = process.argv.includes('--ablate');

// Each check takes the app text and returns null when it holds, or the reason it does not. Named so an
// ablation can address one by name, which is what makes the ablation table legible rather than a count.
const CHECKS = {

  // ---- the two faces of one decision -------------------------------------------------------------
  'bleed-asks-the-predicate': app => {
    const r = body(app, 'function coatRadius');
    if (!r) return 'coatRadius is not in the app';
    const cl = lineWith(r, '(2 + 3 * G.subsurface) * bs');
    if (!cl) return 'coatRadius no longer carries the subsurface clause at all';
    if (!cl.includes('coatFieldUsable(')) {
      return 'coatRadius charges the subsurface bleed without asking coatFieldUsable - so a field render ' +
             'would pay the full 2.40% of W and the ceiling is unchanged';
    }
    if (!/!\s*coatFieldUsable\(/.test(cl)) return 'the clause is guarded by coatFieldUsable but not NEGATED - the sense is inverted';
    return null;
  },

  'coat-asks-the-predicate': app => {
    const a = body(app, 'function applyCoat');
    if (!a) return 'applyCoat is not in the app';
    const br = lineWith(a, 'fieldSubsurface(');
    if (!br) return 'applyCoat has no field branch - the bleed could still be dropped while the tile blurs';
    if (!br.includes('coatFieldUsable(')) {
      return 'applyCoat takes the field branch without asking coatFieldUsable, so the branch and the ' +
             'bleed are deciding separately - this is the divergence the whole gate exists for';
    }
    if (!br.includes('coatField') || !br.includes('vp')) return 'the field branch does not require both a built field and a vp';
    return null;
  },

  'one-predicate-only': app => {
    // The conditions must live in ONE function and nowhere else. A second spelling - even a correct
    // one - is a copy that will drift, and the shorter copy is always the bug.
    //
    // THE OWNER IS coatFieldWhyNot, which returns the REASON, and coatFieldUsable is derived from it.
    // That split exists because a flag that is on and silently does nothing is worse than one that is
    // off: at exactly 4,096 the width test is strict, so ?field=1 engaged at every width except the
    // most natural one to test at, and the only tell was a missing line in the plan trail. The trail
    // now names the clause that refused - which is only honest if the reasons and the boolean cannot
    // disagree, hence the derivation rather than two lists.
    const w = body(app, 'function coatFieldWhyNot');
    if (!w) return 'coatFieldWhyNot is not in the app; the reasons and the boolean have no single owner';
    if (!w.includes('FIELD_ON')) return 'coatFieldWhyNot does not read the flag';
    // THE COMPARISON, not the name. `includes('FIELD_W')` passed an ablation that replaced the test
    // with `if (false)` while leaving FIELD_W in the reason string beside it - the SECOND time in this
    // one gate that a presence test stood in for a reachability test, after `includes('gpuPool(')`.
    if (!/if \(!\(bs \* COAT_REF > FIELD_W\)\)/.test(w)) {
      return 'coatFieldWhyNot does not GATE on bs * COAT_REF > FIELD_W (the name may be present, the ' +
             'test is not), so a render at or below the prelude width would build a field for nothing';
    }
    if (!w.includes('G.subsurface')) return 'coatFieldWhyNot does not check that there IS a subsurface';
    if (!w.includes('BOOST')) return 'coatFieldWhyNot does not stand aside for the boost, which already replaced this stage';
    const u = body(app, 'function coatFieldUsable');
    if (!u) return 'coatFieldUsable is not in the app';
    if (!/return !coatFieldWhyNot\(/.test(u)) {
      return 'coatFieldUsable does not derive from coatFieldWhyNot - two spellings of one condition, and ' +
             'the trail would eventually name a reason the bleed did not act on';
    }
    const n = count(app, 'coatFieldUsable(');
    if (n < 3) return 'coatFieldUsable is called ' + (n - 1) + ' time(s) outside its own declaration; the bleed and the coat must BOTH ask it';
    if (!/coat field OFF: /.test(app)) return 'the trail never says why the field was refused, so an inert flag is silent again';
    return null;
  },

  // ---- the no-neighbour claim, which is what buys the ceiling ------------------------------------
  'field-branch-reads-nothing': app => {
    const f = body(app, 'function fieldSubsurface');
    if (!f) return 'fieldSubsurface is not in the app';
    if (/filter\s*=\s*[`'"]blur/.test(f) || /blurDraw\(/.test(f)) {
      return 'fieldSubsurface blurs. The bleed has already been dropped to BLEED_MARGIN, so any blur here ' +
             'reads past the tile edge with nothing behind it';
    }
    if (f.includes("'difference'")) return 'fieldSubsurface takes a difference, which is a second read of the picture it was meant to avoid';
    if (!f.includes("'lighter'")) return 'fieldSubsurface does not composite with lighter, so it is not adding the envelope back the way the stage did';
    return null;
  },

  'gain-loop-kept': app => {
    const f = body(app, 'function fieldSubsurface');
    if (!f) return 'fieldSubsurface is not in the app';
    // `lighter` clamps per channel at every step, so two draws at 0.95 and 0.85 are NOT one draw at
    // 1.8 wherever the sum reaches 255 - and brightening what is already bright is this stage's job.
    if (!/g\s*-=\s*0\.95/.test(f) || !/0\.9\s*\*\s*G\.subsurface/.test(f)) {
      return 'the gain loop is gone or changed; collapsing it to one draw changes the picture wherever the sum clamps';
    }
    if (!/\/\s*F\.K/.test(f)) return 'the stored gain is never divided back out, so the field is applied K times too strong';
    return null;
  },

  // ---- the prelude must see the stage's INPUT ----------------------------------------------------
  'prelude-coat-is-a-noop': app => {
    const a = body(app, 'function applyCoat');
    if (!a) return 'applyCoat is not in the app';
    const ret = a.indexOf('if (coatFieldBuilding) return;');
    if (ret < 0) return 'applyCoat does not return early while the field is being built, so the field would be the envelope of a picture that already has one';
    for (const stage of ['EMISSION BLOOM', 'fieldSubsurface(', 'SPECULAR TOP-COAT', 'applyLens(']) {
      const at = a.indexOf(stage);
      if (at >= 0 && at < ret) return 'the coatFieldBuilding return sits BELOW `' + stage + '`, so the prelude would include it';
    }
    return null;
  },

  'prelude-flag-is-paired': app => {
    const b = body(app, 'function buildCoatField');
    if (!b) return 'buildCoatField is not in the app';
    if (!b.includes('coatFieldBuilding = true')) return 'buildCoatField never sets coatFieldBuilding, so the prelude would get a full coat';
    if (!/finally\s*\{\s*coatFieldBuilding = false/.test(b)) {
      return 'coatFieldBuilding is cleared outside a finally - a throw in the prelude then leaves applyCoat a no-op for the rest of the session, ' +
             'which renders every later tile with no coat at all';
    }
    if (!b.includes('innerColour')) return 'buildCoatField does not tint the field, so the field route would lose the warm internal glow the stage has';
    return null;
  },

  'prelude-matches-the-render-painter': app => {
    // THE DEFECT THIS CHECK EXISTS FOR, measured 2026-10-30. The first prelude went through
    // renderSlabTo - the CPU painter - while the tiles it fed were drawn by the shader. The subsurface
    // is a high-pass and the two painters differ twentyfold in local contrast (7.029 against 0.341,
    // docs/stone-gpu.md), so the field came back 4x too strong - 8.737 against 2.213 - and the picture
    // rendered +4.97% brighter. Nothing threw, every other gate stayed green, and the master's own
    // record could not say which painter had built its field.
    const b = body(app, 'async function buildCoatField');
    if (!b) return 'buildCoatField is not in the app, or is no longer async';
    if (!/function buildCoatField\(W, viaGpu\)/.test(b)) {
      return 'buildCoatField does not take the render\'s painter, so it decides for itself - which is how it ' +
             'came to build a CPU field for a shader render';
    }
    // THE ASSIGNMENT SHAPE, not the token. `includes('gpuPool(')` was the first spelling and it passed
    // an ablation that left the name in place while neutering the call - `gp = await null && gpuPool(`.
    // A present identifier is not a reachable call, and that is the one mistake this file is about.
    if (!/gp = await gpuPool\(/.test(b)) {
      return 'buildCoatField does not actually call gpuPool into gp - the name may be there, but a GPU render ' +
             'would still get a CPU-painted field 4x too strong';
    }
    if (!/P = await gp\.tile\(0\)/.test(b)) return 'the shader prelude never takes the tile it dispatched';
    if (!b.includes('renderSlabTo')) return 'buildCoatField has no CPU prelude left, so a CPU render would get a shader field - the same mismatch the other way';
    if (!/painter = 'shader'/.test(b) || !/painter = 'painter'/.test(b)) {
      return 'the field does not record WHICH painter built it; a master that cannot say is a master whose field strength cannot be checked';
    }
    // and the call site must hand it the answer rather than a constant
    if (!/buildCoatField\(W, !!\(pool && pool\.gpu\)\)/.test(app)) {
      return 'the call site does not pass the render\'s own painter to buildCoatField';
    }
    if (!/' by the ' \+ cfBuilt\.painter/.test(app)) return 'the plan trail does not record the prelude\'s painter';
    return null;
  },

  'every-export-that-drops-the-bleed-builds-the-field': app => {
    // THE DEFECT, 2026-10-31. The field was wired into exportTiff alone. But coatRadius drops the
    // subsurface clause from coatFieldUsable, which knows nothing about WHICH export is running - so
    // exportAll (tiledPlan) and exportStreamed (stripPlan) took their bleed from coatReach, got 4,
    // and then applyCoat found coatField null and ran the FULL blur against it. A 131px blur with 4px
    // of margin bands at every tile join, renders cleanly, and reports success. Two builds shipped
    // that way and a real PNG was made with it.
    //
    // So: every export entry that reaches a planner must build the field. Named explicitly rather
    // than discovered, because "I added a path and forgot" is exactly how this happened.
    const PLANNERS = { exportTiff: 'tiffPlan', exportAll: 'tiledPlan', exportStreamed: 'stripPlan' };
    for (const [fn, planner] of Object.entries(PLANNERS)) {
      const b = body(app, 'async function ' + fn) || body(app, 'function ' + fn);
      if (!b) return fn + ' is not in the app; this check no longer describes the export surface';
      if (!b.includes('buildCoatField(')) {
        return fn + ' never builds the field, but its bleed comes from ' + planner + ' -> coatReach, ' +
               'which drops the subsurface clause - so it would blur full width against a bleed of 4';
      }
      if (!/coatField = null/.test(b)) return fn + ' never clears coatField, so the next render of another slab could sample this one\'s';
    }
    // and a planner nobody checked is a planner that can repeat it
    for (const planner of Object.values(PLANNERS)) {
      if (!app.includes('function ' + planner)) return planner + ' is gone; the export surface changed under this check';
    }
    return null;
  },

  'prelude-blur-is-opaque-before-the-difference': app => {
    // MEASURED 2026-10-31. A canvas blur pulls transparency in from outside its source, so the blurred
    // copy's alpha falls off over 4*sigma at every border - 130 at the edge for sigma 20, reaching 255
    // only at 80px. `difference` is a composite, and over an opaque backdrop it resolves to
    // a*|P - blur| + (1 - a)*P, so a short alpha mixes the PICTURE back into the envelope. P's mean is
    // ~65 against the envelope's ~5, so the inflation reached ~32 levels in a band one tile deep after
    // upsampling: every edge tile of a 65,535 render leaned +0.87 to +2.25 while the interior sat at
    // +0.204. Forcing alpha to 255 keeps the renormalised RGB and makes the composite exactly the
    // difference. The narrow blur needs none of this - it is READ with getImageData, never composited.
    const b = body(app, 'async function buildCoatField');
    if (!b) return 'buildCoatField is not in the app';
    if (/blurDraw\(ax,/.test(b)) {
      return 'the wide blur is drawn straight into the difference context, so its short alpha mixes P ' +
             'back into the envelope at every picture border';
    }
    if (!/d4\[i\] = 255/.test(b)) return 'the blurred copy is never forced opaque, so the difference composites a*|P-blur| + (1-a)*P at the edges';
    if (!/globalCompositeOperation = 'difference'/.test(b)) return 'the prelude no longer takes a difference at all';
    if (!/ax\.drawImage\(Wd, 0, 0\)/.test(b)) return 'the difference does not draw the opaque blurred copy';
    return null;
  },

  'prelude-width-is-the-measured-floor': app => {
    // 2,048 was MEASURED insufficient: the busiest region's envelope climbs 24% from 2,048 to 16,384,
    // well above a 10.54% floor, while 4,096 -> 32,768 holds to 1.4%. A default below 4,096 ships a
    // field that does not match the picture it is standing in for.
    const d = app.match(/get\('fieldw'\)[\s\S]{0,160}?\?\s*\(v\s*\|\s*0\)\s*:\s*(\d+)/);
    if (!d) return 'FIELD_W has no readable default';
    if (+d[1] < 4096) return 'FIELD_W defaults to ' + d[1] + '; 2,048 was measured insufficient and 4,096 is the measured convergence floor';
    const g = app.match(/get\('fieldw'\)[\s\S]{0,160}?v\s*>=\s*(\d+)/);
    if (!g) return 'FIELD_W accepts any value from the URL with no floor at all';
    return null;
  },

  // ---- the crossing: both pools, and the names at the far end ------------------------------------
  'both-pools-carry-the-field': app => {
    // TWO pools build worker state - renderTiledParallel's and the GPU finisher pool - and a field that
    // reaches one and not the other seams the picture where the two kinds of tile meet.
    const states = [...app.matchAll(/const state = \{[\s\S]*?\};/g)].map(m => m[0]);
    if (states.length < 2) return 'expected two worker-state literals, found ' + states.length + '; this check no longer describes the app';
    const without = states.filter(s => !s.includes('coatFieldMsg()')).length;
    if (without) return without + ' of ' + states.length + ' worker-state literals do not carry coatFieldMsg(), so some tiles would get the field and some would not';
    return null;
  },

  'worker-can-resolve-the-field': app => {
    const p = body(app, 'function windowPreamble');
    if (!p) return 'windowPreamble is not in the app';
    for (const n of ['FIELD_ON', 'FIELD_W', 'coatField', 'coatFieldBuilding']) {
      if (!p.includes(n)) return 'the worker preamble does not declare ' + n + ', so the serialised coat throws on the first tile';
    }
    const w = body(app, 'function windowFns');
    if (!w) return 'windowFns is not in the app';
    const ret = w.match(/return \{([^}]*)\}/);
    if (!ret) return 'windowFns has no readable return literal';
    for (const n of ['coatFieldUsable', 'fieldSubsurface', 'fieldCanvas']) {
      if (!ret[1].includes(n)) return 'windowFns does not carry ' + n + ' to the workers';
    }
    return null;
  },

  // ---- the record has to tell the two pictures apart ---------------------------------------------
  'signature-moves-with-the-flag': app => {
    // The field agrees with the per-tile stage to 1.3-1.4%, which is close and is not the same picture.
    // Without a key here a field master and a blurred one of the same slab claim one `inputs`, and the
    // second offers to RESUME the first onto a different tile plan.
    const sig = app.slice(app.indexOf('...(BOOST ? { boost: BOOST }'), app.indexOf('.toString(16);', app.indexOf('...(BOOST ? { boost: BOOST }')));
    if (!sig) return 'the render signature is not where this check expects it';
    if (!/FIELD_ON\s*\?/.test(sig)) return 'the render signature does not key on FIELD_ON, so a field master would claim a blurred master\'s inputs';
    if (!sig.includes('FIELD_W')) return 'the signature does not include FIELD_W, and the prelude width changes the field';
    if (!sig.includes('FIELD_PX')) return 'the signature does not include FIELD_PX, and the store width changes the field';
    return null;
  },

  'field-is-cleared-after-a-render': app => {
    const at = app.indexOf('drewOnGpu = false; bloomOnGpu = false; backlitFor = null;');
    if (at < 0) return 'the export cleanup is not where this check expects it';
    const tail = app.slice(at, at + 1400);
    if (!/coatField = null/.test(tail)) {
      return 'the export does not clear coatField, so the next export of a DIFFERENT slab could sample this one\'s field';
    }
    if (!/coatFieldBuilding = false/.test(tail)) return 'the export does not clear coatFieldBuilding, so a throw mid-prelude disables the coat for the session';
    return null;
  },
};

// ---- the plumbing ---------------------------------------------------------------------------------
// Brace-counted, comment-blind on purpose: a `}` inside a comment DOES end a body here, exactly as it
// does for check-worker-core, and finding that out cost a round. Comments are stripped first so that
// cannot happen to this gate too.
function strip(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}
function body(app, head) {
  const i = app.indexOf(head);
  if (i < 0) return null;
  const s = strip(app.slice(i));                 // to the end: exportTiff alone exceeds any fixed slice,
                                                 // and a truncated body reads as a MISSING function
  let d = 0, started = false;
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '{') { d++; started = true; }
    else if (s[k] === '}') { d--; if (started && d === 0) return s.slice(0, k + 1); }
  }
  return null;
}
const NL = String.fromCharCode(10);
function lineWith(t, needle) {
  const at = t.indexOf(needle);
  if (at < 0) return null;
  const a = t.lastIndexOf(NL, at) + 1, b = t.indexOf(NL, at);
  return t.slice(a, b < 0 ? t.length : b);
}
function count(app, needle) {
  let n = 0;
  for (let at = app.indexOf(needle); at >= 0; at = app.indexOf(needle, at + 1)) n++;
  return n;
}

// ---- run ------------------------------------------------------------------------------------------
const app = readFileSync(APP, 'utf8');
const fail = [];
for (const [name, fn] of Object.entries(CHECKS)) {
  let why = null;
  try { why = fn(app); } catch (e) { why = 'the check itself threw: ' + (e && e.message); }
  if (why) fail.push(name + ': ' + why);
}

if (!ABLATE) {
  if (fail.length) {
    console.error('coat field: ' + fail.length + ' problem(s)');
    for (const f of fail) console.error('  ' + f);
    process.exit(1);
  }
  console.log('coat field: OK - ' + Object.keys(CHECKS).length + ' claims hold; one predicate decides both the bleed and the branch,');
  console.log('            the field branch reads no neighbours, the prelude sees the stage\'s input, both pools carry it,');
  console.log('            and the signature moves with the flag. Run --ablate to see each one go red.');
  process.exit(0);
}

// ABLATIONS. Each entry breaks the app text one way and names the check that must catch it. A break no
// check catches is printed as a BLIND SPOT rather than quietly passing, which is the failure mode an
// ablation table is for.
const ABLATIONS = [
  ['bleed stops asking the predicate', 'bleed-asks-the-predicate',
   a => a.replace('&& !coatFieldUsable(bs, uv)) r = Math.max(r, (2 + 3 * G.subsurface)', ') r = Math.max(r, (2 + 3 * G.subsurface)')],
  ['the guard is un-negated', 'bleed-asks-the-predicate',
   a => a.replace('&& !coatFieldUsable(bs, uv))', '&& coatFieldUsable(bs, uv))')],
  ['the coat decides on its own', 'coat-asks-the-predicate',
   a => a.replace('&& coatField && vp && coatFieldUsable(bs, f.uvMode))', '&& coatField && vp)')],
  ['the predicate loses its width test', 'one-predicate-only',
   a => a.replace("if (!(bs * COAT_REF > FIELD_W)) return 'W '", "if (false) return 'W '")],
  ['the boolean stops deriving from the reasons', 'one-predicate-only',
   a => a.replace('function coatFieldUsable(bs, uv) { return !coatFieldWhyNot(bs, uv); }',
                  'function coatFieldUsable(bs, uv) { return FIELD_ON && G.subsurface > 0 && !BOOST && bs * COAT_REF > FIELD_W; }')],
  ['the trail stops saying why', 'one-predicate-only',
   a => a.replace("p.trail.push('coat field OFF: '", "void ('coat field off '")],
  ['the field branch blurs', 'field-branch-reads-nothing',
   a => a.replace("tx.globalCompositeOperation = 'lighter';" + NL + "    // THE GAIN LOOP IS KEPT",
                  "tx.globalCompositeOperation = 'lighter'; tx.filter = `blur(${4}px)`;" + NL + "    // THE GAIN LOOP IS KEPT")],
  // ANCHORED ON `/ F.K`, which only the field's copy has. The first spelling was `replace('g -= 0.95',
  // 'g -= 99')` and that text occurs TWICE - String.replace takes the first, which is the ORIGINAL
  // subsurface stage. So the ablation broke a loop this check does not read, the check correctly stayed
  // green, and the table reported a blind spot in the gate. An ablation that mutates the wrong copy is
  // the same defect as a guard that checks the wrong copy, and it reads as the opposite finding.
  ['the gain loop is collapsed', 'gain-loop-kept',
   a => a.replace('g -= 0.95) {' + NL + '      tx.globalAlpha = Math.min(0.95, g) / F.K;',
                  'g -= 99) {' + NL + '      tx.globalAlpha = Math.min(0.95, g) / F.K;')],
  ['the stored gain is not divided out', 'gain-loop-kept',
   a => a.replace('Math.min(0.95, g) / F.K', 'Math.min(0.95, g)')],
  ['the prelude gets a full coat', 'prelude-coat-is-a-noop',
   a => a.replace('if (coatFieldBuilding) return;', '')],
  ['the prelude flag is not in a finally', 'prelude-flag-is-paired',
   a => a.replace('finally { coatFieldBuilding = false; }', '').replace('try { P = renderSlabTo', 'P = renderSlabTo')],
  ['the field loses its tint', 'prelude-flag-is-paired',
   a => a.replace("ax.fillStyle = COL.innerColour || '#ffcf8f';", "ax.fillStyle = '#ffffff';")],
  // one per export entry: the bug was ONE path forgotten, so each must be able to go red alone
  ['exportAll stops building the field', 'every-export-that-drops-the-bleed-builds-the-field',
   a => a.replace('      await buildCoatField(W, false);\n      if (only) {', '      if (only) {')],
  ['exportStreamed stops building the field', 'every-export-that-drops-the-bleed-builds-the-field',
   a => a.replace("      await buildCoatField(W, false);                       // stripPlan's", "      // stripPlan's")],
  ['exportTiff stops building the field', 'every-export-that-drops-the-bleed-builds-the-field',
   a => a.replace('const cfBuilt = await buildCoatField(W, !!(pool && pool.gpu));', 'const cfBuilt = null;')],
  ['the blurred copy is left translucent', 'prelude-blur-is-opaque-before-the-difference',
   a => a.replace('for (let i = 3; i < d4.length; i += 4) d4[i] = 255;', '')],
  ['the wide blur goes straight into the difference', 'prelude-blur-is-opaque-before-the-difference',
   a => a.replace('ax.drawImage(Wd, 0, 0);', 'blurDraw(ax, P, (2 + 3 * ss) * bsF, fw, fh);')],
  ['the prelude drops below the measured floor', 'prelude-width-is-the-measured-floor',
   a => a.replace('(v | 0) : 4096;', '(v | 0) : 2048;')],
  // the four shapes the painter match can break in, one ablation each
  ['the prelude decides its own painter', 'prelude-matches-the-render-painter',
   a => a.replace('async function buildCoatField(W, viaGpu) {', 'async function buildCoatField(W) {\n    const viaGpu = true;')],
  // TWO SHAPES, because they are caught by different things. The first leaves the identifier in place
  // and neuters the call, which a presence test passes; the second removes it, which a presence test
  // catches. Only the first found the weakness in this check.
  ['the shader call is neutered, name left', 'prelude-matches-the-render-painter',
   a => a.replace('gp = await gpuPool(fw, { ts: fw', 'gp = await null && gpuPool(fw, { ts: fw')],
  ['the shader tile is never taken', 'prelude-matches-the-render-painter',
   a => a.replace("try { P = await gp.tile(0); painter = 'shader'; }", "try { painter = 'shader'; }")],
  ['the CPU prelude is removed', 'prelude-matches-the-render-painter',
   a => a.replace('try { P = renderSlabTo(fw, fh, [fw, 0, 0, fw, 0, 0], bsF, lightSpectrum, null); }',
                  'try { P = null; }')],
  ['the call site hardcodes the painter', 'prelude-matches-the-render-painter',
   a => a.replace('await buildCoatField(W, !!(pool && pool.gpu))', 'await buildCoatField(W, false)')],
  ['one pool loses the field', 'both-pools-carry-the-field',
   a => a.replace('bkW: bkOn ? backlitFor.gw : 0, bkH: bkOn ? backlitFor.gh : 0, ...coatFieldMsg() };',
                  'bkW: bkOn ? backlitFor.gw : 0, bkH: bkOn ? backlitFor.gh : 0 };')],
  ['the worker cannot resolve the branch', 'worker-can-resolve-the-field',
   a => a.replace('coatFieldUsable, fieldSubsurface, fieldCanvas };', 'fieldCanvas };')],
  ['the preamble forgets the flag', 'worker-can-resolve-the-field',
   a => a.replace("'var FIELD_ON=' + FIELD_ON + ',FIELD_W=' + FIELD_W", "'var FIELD_W=' + FIELD_W")],
  ['the signature stops moving', 'signature-moves-with-the-flag',
   a => a.replace("...(FIELD_ON ? { field: FIELD_W + '/' + FIELD_PX } : {}),", '')],
  ['the field is left standing', 'field-is-cleared-after-a-render',
   a => a.replace('drewOnGpu = false; bloomOnGpu = false; backlitFor = null;', 'drewOnGpu = false; bloomOnGpu = false; backlitFor = null; /*x*/')
         .replace(/drewOnGpu = false; bloomOnGpu = false; backlitFor = null; \/\*x\*\/[\s\S]*?coatField = null; coatFieldBuilding = false;/,
                  'drewOnGpu = false; bloomOnGpu = false; backlitFor = null;')],
];

let bad = 0;
console.log('ABLATIONS - each break must turn its named check RED. A break nothing catches is a blind spot.' + NL);
for (const [label, want, mutate] of ABLATIONS) {
  const m = mutate(app);
  if (m === app) { console.log('  ' + 'INERT'.padEnd(6) + label.padEnd(44) + 'the mutation did not change the file - this ablation tests nothing'); bad++; continue; }
  const red = [];
  for (const [name, fn] of Object.entries(CHECKS)) {
    let why = null;
    try { why = fn(m); } catch (e) { why = 'threw'; }
    if (why) red.push(name);
  }
  const ok = red.includes(want);
  if (!ok) bad++;
  console.log('  ' + (ok ? 'RED' : 'BLIND').padEnd(6) + label.padEnd(44) +
              (ok ? 'caught by ' + want + (red.length > 1 ? ' (+' + (red.length - 1) + ' more)' : '')
                  : 'NOT caught by ' + want + (red.length ? '; only ' + red.join(', ') : '; nothing went red')));
}
console.log(NL + (bad ? bad + ' ablation(s) did not bite - those claims are preferences, not checks'
                      : 'all ' + ABLATIONS.length + ' ablations bite; every claim in this gate can go red'));
if (fail.length) { console.error(NL + 'NOTE: the unmutated app already fails ' + fail.length + ' check(s):'); for (const f of fail) console.error('  ' + f); }
process.exit(bad || fail.length ? 1 : 0);

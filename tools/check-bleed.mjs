// Can a tile still lose its light?
//
// Two different defects hid behind the same symptom — a master that is whole, correctly sized, fully
// drawn, correctly signed, and dim:
//
//   TRUNCATION  bleed was sized against the blur radii that existed when it was written, and nothing
//               failed when wider ones were added. Gradual: 66% of the light at 3.9 sigma, 86% at 7.8.
//   LOST BLOOM  a large canvas paints perfectly and silently declines to blur. Total, and no reported
//               number predicts it: one tablet reported MAX_TEXTURE_SIZE 8192 and matched, the other
//               reported 4096 while rendering a correct 5670px canvas.
//
// So this gate is an INVENTORY plus a wiring check. Every blur in the app is declared with why it is
// safe, the reach arithmetic is executed rather than trusted, and the probe that catches the second
// defect must be wired where the plan can act on it.
//
//   node tools/check-bleed.mjs
import { readFileSync } from 'fs';

const app = readFileSync('app/stone-author.html', 'utf8');
const fail = [];

// ---- 1. the inventory ------------------------------------------------------------------------------
// covered  - coatRadius() accounts for it, so bleed grows with it
// excluded - cannot happen in a tile: the back light renders whole-image, the lens runs once on the
//            assembled picture, and the scratch helper is only reached from the back light
// output   - in output pixels, does not scale with the render; covered via maxAdjBlur / maxGlow
const DECLARED = {
  '3 * bs': 'covered',
  '8 * bs': 'covered',
  '(2 + 3 * ss) * bs': 'covered',
  '(1 + 2 * ss) * bs': 'covered',
  '2 * bs': 'covered',
  '0.6 * bs': 'covered',
  '5 * bs': 'excluded',
  '11 * bs': 'excluded',
  'px': 'excluded',              // blurCanvas, the back light's scatter scratch
  'sigma': 'excluded',           // bloomWorks probing the device, not rendering a tile
  'r': 'excluded',               // blurDraw's own filter call: the radius is the caller's, declared there
  '4': 'excluded',               // CAN_FILTER's fixed 4px support test on a 32px canvas
  "' + b + '": 'output',
};

// Match the interpolated expression whole. A lazy character class stops at the first `)`, which silently
// reduced `${(2 + 3 * ss) * bs}` to `(2 + 3 * ss` and then reported it as undeclared — a gate that mangles
// its own input reads as a finding about the code.
const found = new Set();
for (const m of app.matchAll(/blur\(\$\{(.+?)\}px\)/g)) found.add(m[1].trim());
for (const m of app.matchAll(/blur\((\d[\d.]*)px\)/g)) found.add(m[1].trim());
for (const m of app.matchAll(/'blur\('\s*\+\s*([\w$]+)/g)) found.add("' + " + m[1] + " + '");
// blurDraw is the choke point where a blur happens without naming a filter — WebKit has no ctx.filter,
// so the bloom goes through a pyramid there instead. Its radius argument counts as a blur in the
// inventory exactly like a filter string, or moving a blur behind it would hide it from this gate.
for (const m of app.matchAll(/blurDraw\([^,]+,\s*[^,]+,\s*([^,]+),/g)) found.add(m[1].trim());

for (const r of found) if (!(r in DECLARED)) fail.push(`undeclared blur radius \`${r}\` — is it reachable in a tile, and does coatRadius cover it?`);
for (const r of Object.keys(DECLARED)) if (!found.has(r)) fail.push(`declared blur \`${r}\` is no longer in the app — this inventory describes code that is gone`);

const radius = app.slice(app.indexOf('function coatRadius'), app.indexOf('function coatReach'));
if (!radius.includes('bs')) fail.push('coatRadius does not mention the coat scale at all');
for (const [r, why] of Object.entries(DECLARED)) {
  if (why !== 'covered') continue;
  const needle = r.replace(/\bss\b/, 'G.subsurface');
  if (!radius.includes(needle)) fail.push(`\`${r}\` is declared covered but coatRadius does not include \`${needle}\``);
}
if (!/shadowBlur\s*=\s*gl \* 6/.test(app)) fail.push('the artifact glow no longer sets shadowBlur = gl * 6 — the reach for it is wrong');
if (!/shadowReach\(6 \* maxGlow\(\)\)/.test(app)) fail.push('coatReach stopped accounting for the artifact glow');

// ---- 2. the arithmetic, executed -------------------------------------------------------------------
// blur(r) sets the DEVIATION to r. Believing it reaches r is the original defect, so run the real code.
const reachSrc = app.slice(app.indexOf('const blurReach ='), app.indexOf('const shadowReach'));
let blurReach;
try {
  blurReach = new Function('r', reachSrc + '\nreturn blurReach(r);');
  blurReach(1);
} catch (e) {
  fail.push('cannot execute blurReach from the app: ' + e.message);
  blurReach = null;
}
if (blurReach) {
  // 3r, not 1r: the conventional cut for a true Gaussian, and above the box approximation's exact 2.82r.
  // The original defect was a bleed of 1.5r believed to be a 50% margin.
  for (const r of [1, 8, 64, 524.3, 2000]) {
    const got = blurReach(r);
    if (!(got >= 3 * r)) fail.push(`blurReach(${r}) = ${got}, under 3r — the reach of a Gaussian is not its radius`);
  }
  if (blurReach(0) !== 0 || blurReach(-5) !== 0) fail.push('blurReach must be 0 for a blur that is not applied');
}
for (const m of app.matchAll(/bleed\s*=\s*[^;\n]*/g))
  if (/12 \* bs|12 \* \(W \/ COAT_REF\)/.test(m[0])) fail.push(`a bleed is back on the old constant: ${m[0].trim()}`);

// A BLUR THAT FEEDS AN ADDITIVE COMPOSITE CANNOT GO MISSING QUIETLY. WebKit has no ctx.filter, and most
// of this renderer's filtered passes survive that: subsurface and the specular glint each blur into a
// `difference` high-pass, and difference against an unblurred copy of the same canvas is black, so the
// pass adds or screens black and simply vanishes. Wrong art, right picture. The back light's two passes
// composite with `lighter`, so unblurred they added two SHARP copies of the whole image at 0.30 and 0.18
// alpha - the picture at 1.48x brightness with every edge intact. blurDraw is the only path with a
// fallback, so an additive pass has to use it.
const backlit = app.slice(app.indexOf('function paintBacklit'), app.indexOf('function applyCoat'));
for (const m of backlit.matchAll(/filter\s*=\s*.blur\(/g))
  fail.push(`the back light blurs with a raw canvas filter (${m[0]}): where ctx.filter is absent that pass adds a SHARP copy of the picture, because it composites with lighter`);
if ((backlit.match(/blurDraw\(/g) || []).length < 2)
  fail.push('the back light scatter and bloom do not both go through blurDraw, so a browser with no canvas filter gets a wrong picture rather than a missing effect');
if (!/blurDraw\(t, src, px/.test(app))
  fail.push('blurCanvas does not go through blurDraw, so a layer declaring scatter gets a sharp copy of the accumulator instead of diffused light');

// The harness counts too. tiff.mjs restated the bleed as `Math.ceil(12 * (W / 1000))` under a comment
// claiming it was what tiffPlan takes, and went on passing for every commit after that stopped being
// true. A test that hard-codes a derived value is testing its own copy of the past, and this rule only
// scanned app/, so the copy was never going to be caught.
for (const f of ['harness/tiff.mjs', 'harness/render.mjs', 'harness/hero.mjs']) {
  let src = '';
  try { src = readFileSync(f, 'utf8'); } catch (_) { continue; }
  if (/12 \* \(W \/ 1000\)|12 \* bs|12 \* \(W \/ COAT_REF\)/.test(src))
    fail.push(`${f} restates the bleed instead of asking the app for it — it will keep passing after the app changes`);
}

// ---- 3. the plan is MEASURED, not predicted --------------------------------------------------------
// A synthetic probe answers one question about an empty canvas. One real tile at the planned settings
// answers all of them: allocation, this device's blur ceiling, whether the bloom happened, whether the
// window composited, whether a tile reads back. The reference it is judged against is the whole picture
// at 1024 - one canvas, untiled, nothing that can be truncated - and the comparison is sound because the
// renderer is scale-invariant, measured at 60.61 for the same region at both 20480 and 24576.
const plan = app.slice(app.indexOf('async function tiffPlan'), app.indexOf('async function exportTiff'));
// From the top of the calibration block, not from calibrate() itself: meanOfRegion sits above it, and a
// slice that starts too late reads as "the code is missing" when it is only out of frame.
const cal = app.slice(app.indexOf('const CAL_REF_W'), app.indexOf('async function tiffPlan'));
if (!/renderFull\(CAL_REF_W\)/.test(plan)) fail.push('the plan has no untiled reference to judge a tile against');
if (!/calibrate\(W, FH, ts, bleed, ref, refCx\)/.test(plan)) fail.push('the plan does not calibrate its candidates on a real tile');
if (!/renderOneTile\(W, pick\.gx \* ts/.test(cal)) fail.push('calibration does not render a REAL tile, so it tests a path the render does not take');
if (!/got >= CAL_PASS \* want/.test(cal)) fail.push('calibration does not compare the tile against the reference');
// A SAMPLED mean is the wrong statistic across a scale change: at full resolution every hundredth pixel
// lands on a sparse speck field while the reference has those specks averaged in. Measured 0.92 on a
// render that could not lose anything, against a 0.9 threshold.
if (!/i \+= 4\) \{ s \+= /.test(cal)) fail.push('calibration samples rather than summing every pixel, so its tolerance sits in the noise');
// No memory veto: deviceMemory rounds DOWN to a power of two, so arithmetic on it refused renders the
// hardware could do. The only pre-attempt refusal left is a single canvas over the browser's own limit.
if (/const inBudget = need <= budget/.test(plan)) fail.push('the memory veto is back: it refuses on arithmetic over a hint that rounds down by up to half');
if (!/ew \* ew \* 4 > CANVAS_HARD_MAX/.test(plan)) fail.push('nothing stops an attempt at a canvas past the browser renderer limit');
// The largest workable tile is not automatically the best one, and a time estimate cannot say which is:
// it goes as (1 + 2*bleed/ts)^2, so its ordering is fixed by its own formula and the biggest candidate
// won every race. The choice has to read the device's headroom, which is the quantity that actually
// differs between two tiles that both calibrated - 14% of a desktop's budget against 56% of a tablet's.
if (/a\.est - b\.est/.test(plan))
  fail.push('the choice is back on the time estimate alone, whose ordering is fixed by its own formula - it can only ever take the biggest candidate');
if (!/fast\.need <= MEM_EASY \* budget/.test(plan))
  fail.push('the choice does not weigh the winner against the memory ceiling, so a tablet grazing its cap takes the same tile as a desktop with 6 GB spare');
if (!/need: needOf\(proven\)/.test(plan))
  fail.push('a remembered plan carries no memory figure, so the headroom test reads undefined and silently takes the protective tile every time');
if (!/const safe = ok\.reduce\(\(a, b\) => \(b\.ts < a\.ts \? b : a\)\)/.test(plan))
  fail.push('the protective candidate is not the smallest that calibrated, so it is whichever way the ladder happened to fill');
// The fast one is the lowest MEASURED estimate, never the biggest tile. (1 + 2*bleed/ts)^2 says bigger is
// always faster and that holds only where the grid divides: at 16384 a 10240 height needs two rows of
// 8192, a 60% overshoot, and 8192 draws 0.32 Gpx against 4096's 0.29. ms x passes carries both.
if (/const fast = ok\[ok\.length - 1\]|const fast = ok\[0\]/.test(plan))
  fail.push('the fast candidate is taken by position rather than by its measured estimate: at a width where the tile grid does not divide, the biggest tile is the SLOWER one and costs three times the memory');
if (!/const fast = ok\.reduce\(\(a, b\) => \(b\.est < a\.est \? b : a\)\)/.test(plan))
  fail.push('the fast candidate is not chosen on its measured estimate');
// An unknown ceiling is not a generous one. deviceMemory is Chromium-only, so Safari and Gecko fall back
// to a flat 4 GB that nothing measured - and an iPhone is the device least able to honour it.
if (!/const memKnown = navigator\.deviceMemory > 0/.test(plan))
  fail.push('the plan does not check whether the memory figure is real, so on Safari and Gecko it spends a fabricated 4 GB ceiling');
if (!/roomy = memKnown &&/.test(plan))
  fail.push('the speed premium is granted without a measured ceiling to spend it against');
// A REMEMBERED PLAN IS THE ANSWER TO A RACE, so it is only valid under the rule that ran the race. The
// remembered path re-calibrates the tile but never re-applies the choice, so a device that settled on a
// size under a superseded rule would keep taking it. The rule therefore lives IN the key, which makes the
// invalidation automatic instead of a version bump someone has to remember.
if (!/':m' \+ MEM_EASY/.test(app))
  fail.push('the plan key does not carry the choice rule, so a plan settled under a rule that has since changed is reused unchanged');
if (!/\(navigator\.deviceMemory > 0 \? 'k' : 'u'\)/.test(app))
  fail.push('the plan key does not record whether the memory figure was real, so an engine that gains deviceMemory keeps a plan chosen without one');

// AND IT HAS TO NAME THE RIGHT CAUSE. The refusal printed exp.err.tile - "cannot hold a tile big enough",
// a memory sentence - whatever the reason, including the case where a candidate fitted at 500MB against a
// 537MB ceiling, rendered, and came back carrying 19% of the light. A diagnostic that asserts the wrong
// cause is worse than one that says nothing: that message sent a debugging session after memory ceilings
// while the trail beside it already read DIM 32.0 vs 171.4.
if (!/bestLit = Math\.max\(bestLit, cal\.got \/ cal\.want\)/.test(plan))
  fail.push('the plan does not record that a candidate RENDERED and came back dim, so it cannot tell that failure from a memory refusal');
if (!/bestLit >= 0/.test(plan) || !/exp\.err\.dim/.test(plan))
  fail.push('the refusal reports exp.err.tile whatever happened, so a tile that fitted and came back dim is reported as a memory limit');
if (!/!cal\.ok && !cal\.why && cal\.want > 0/.test(plan))
  fail.push('the dim test does not exclude candidates that could not be made at all, so a canvas that never allocated would be reported as dim');

// MEASURING IS NOT REPEATABLE ON ITS OWN. Candidates are compared on timing and timings move, so two
// renders of the same slab on one machine could pick different tile sizes - and a different tile size
// is a different canvas, which Chrome does not rasterise identically. The race runs once per device,
// width and light; after that the answer is remembered and only verified.
if (!/proven && proven <= ts/.test(plan)) fail.push('the plan does not consult what this device already settled on, so render #3 and render #50,000 can differ');
if (!/proveTile\(p\.ts, W\)/.test(app)) fail.push('a completed render does not record its plan, so nothing is ever remembered');
// The store is keyed calSig:width:light. forgetTile deleted all[calSig()] for two commits after that
// change, so a plan that produced an UNDRAWN TILE was refused correctly and then kept, ready to be handed
// back to the next render. The one path that un-remembers a bad plan had silently stopped working.
// It used to DELETE the record, which was right when the record was a number and wrong once it carried a
// death list too — deleting the entry erases exactly what a failure just taught the device. It clears the
// finished plan and keeps the list.
if (!/planWrite\(W, \{ ok: 0, bad: planRec\(W\)\.bad \|\| \[\] \}\)/.test(app))
  fail.push('forgetTile does not clear the finished plan while keeping the death list');
if (!/markAttempt\(p\.ts, W\)/.test(app)) fail.push('nothing is recorded before the first tile, so a device that dies mid-render learns nothing');
if (!/died\.includes\(ts\)/.test(plan)) fail.push('the plan does not skip a size this device died on');
// The semicolon matters: without it this matches `function forgetTile(W) {` and passes while the CALL
// site has stopped passing the width — the definition satisfying a check about its caller.
if (!/forgetTile\(W\);/.test(app)) fail.push('the blank-tile guard does not pass the width, so it forgets nothing');
// Narrow, and it exists because rewriting a comment deleted this declaration: `trail` is pushed to in
// seven places and declared in one, and `node --check` cannot see a missing declaration — it is a runtime
// ReferenceError, not a parse error. Nothing else exercises the tiled planner at all, which is the real
// gap: the harness renders 4096, and the grid path only engages past 16384.
if (!/const trail = \[\];/.test(plan)) fail.push('the plan trail is never declared: every tiled export would die with a ReferenceError');
if (!/proveTile\(0, W\)/.test(plan)) fail.push('a remembered plan that stops calibrating is not dropped');

// ---- 3b. the whole-image steps this path has no whole image for ------------------------------------
// renderFull, the strip path and the worker path all composite reality windows onto an assembled canvas.
// The BigTIFF path assembles nothing, so for a week it simply omitted them and every tiled master lost
// its islands — invisible in daylight, where the window shows daylight, and the loudest object in the
// picture under black light. It composites per tile now, and must keep doing so.
const oneTile = app.slice(app.indexOf('function renderOneTile'), app.indexOf('async function renderTiledStepped'));
if (!/compositeWindow\(cx, win, ew, eh/.test(oneTile)) fail.push('renderOneTile does not composite reality windows: every tiled master would lose its islands');
if (!/win\.show == null\) continue/.test(oneTile)) fail.push('renderOneTile composites masks that are not windows');
// Presence only: it catches the line being deleted, not the condition being neutered — `if (false && …)`
// still reads as present. Say so rather than let it look stronger than it is.
if (!/wx \+ wr < ex0 \|\| wx - wr > ex0 \+ ew/.test(oneTile)) fail.push('renderOneTile has no intersection test: every tile would pay for every window');

// ---- 4. the light a master records about itself ----------------------------------------------------
if (!/litSum \+= l;/.test(app)) fail.push('the export no longer accumulates the light it wrote');
// The trailing non-digit is load-bearing: without it this passes on `i += 4000`, and an ablation that
// changed the stride tenfold read as green.
if (!/i \+= 400[^\d]/.test(app)) fail.push('the light sample stride changed: it must match tiff-meta --audit (every 100th pixel) or the two numbers are not comparable');
if (!/light: litN \?/.test(app)) fail.push('the measured light is not recorded in the metadata');

// ---- 5. the stored tile must divide the render pass ------------------------------------------------
if (/const store = Math\.min\(ts, TIFF_STORE_MAX\), k = ts \/ store/.test(app))
  fail.push('store/k assumes k is 1 or 2 again: a forced pass of 6144 then writes bleed into the picture');
if (!/while \(store > 1 && ts % store !== 0\) store >>= 1/.test(app)) fail.push('the stored tile is not derived as a divisor of the render pass');

if (fail.length) { console.error('bleed:\n  ' + fail.join('\n  ')); process.exit(1); }
console.log(`bleed: OK — ${found.size} blur radii declared, reach is at least 3x the deviation, bloom probed at`
          + ` plan time, light recorded as written, stored tile divides the pass`);

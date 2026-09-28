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
  'sig': 'excluded',             // glowRatio measuring this engine against itself on its own canvas, never a tile
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
// INVERTED 2026-09-27. This used to name the ONE historical mistake — a bleed of `12 * bs` — and pass
// everything else, so `14 * bs`, or any fresh inline arithmetic, would have gone straight through. A
// blocklist keyed to the past only ever catches the bug you already had. The contract runs the other way:
// coatReach is the one thing that knows what a bleed is, so every bleed must come FROM it, and anything
// else fails on sight whether or not it has been seen before. `bleedPx` is admitted because it is the
// caller-supplied override, and the caller got it from coatReach.
//
// Same shape as a document rule that bans the spelled-out form once the abbreviation is defined: it is
// not enough to forbid one known longhand, you have to require the short form everywhere.
for (const m of app.matchAll(/bleed\s*=\s*[^;\n]*/g))
  if (!/coatReach|bleedPx/.test(m[0]))
    fail.push(`a bleed is computed without coatReach, so there are now two answers to a question that has one: ${m[0].trim()}`);

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
  // Inverted for the same reason as the app rule above: naming the one wrong formula lets the next wrong
  // formula through. A harness has exactly one legitimate source for a bleed, which is to ask the app.
  for (const m of src.matchAll(/bleed\s*=\s*[^;\n]*/g))
    if (!/plan\.bleed|tiffPlan|\.bleed\b/.test(m[0]))
      fail.push(`${f} computes its own bleed instead of asking the app for it — it will keep passing after the app changes: ${m[0].trim()}`);
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

// ?dim=off WITHHOLDS A JUDGEMENT ABOUT LIGHT, NOTHING ELSE. The light gate refuses on a prediction, so a
// render it declines leaves nothing to check the prediction against - a wrong veto looks exactly like a
// right one. The light FLOOR this replaced was refusing correct renders and only forcing one found that
// out. So the override has to keep every other refusal intact, and the master has to say it was used.
if (!plan.includes('const dimmed = !cal.ok && !cal.why && cal.got != null'))
  fail.push('the dim override does not distinguish a dim tile from a canvas that could not be made, so ?dim=off would force a render onto a surface that does not exist');
if (!plan.includes('cal.ok || (dimmed && DIM_OK)'))
  fail.push('?dim=off does not actually admit the candidate, so the override cannot be exercised');
if (!app.includes('dimOverride: DIM_OK || undefined'))
  fail.push('a master rendered with the light veto withheld does not record that, so its light figure would later be read as a normal result');
if (!app.includes("get('dim')"))
  fail.push('the dim override is not read from the URL, so it can never be turned on');

// ?bloom=draw MUST NOT LEAK. The flag removes the blur that the entire bleed exists to feed, so if the
// bleed collapsed while the blur still ran, every tile would be blurred against a transparent edge and
// every master would come back dim with no other symptom - the exact defect this whole file was written
// for. The two have to move together, and with the flag off nothing may change at all.
if (!app.includes('if (uv && !BLOOM_DRAW) r = Math.max(r, 8 * bs, 3 * bs);'))
  fail.push('coatRadius no longer collapses the bleed under ?bloom=draw, or collapses it unconditionally: the bleed and the blur it feeds must switch together');
if (!app.includes('if (!(BLOOM_DRAW && glowPx > 0)) {'))
  fail.push('applyCoat runs the image-space bloom regardless of ?bloom=draw, so the drawn glow would be added ON TOP of the blurred one');

// THE SCRATCH MASTER IS DROPPED BEFORE THE NEXT ONE IS WRITTEN. Nothing ever removed it, so a finished
// render left a master-sized block of site data behind - and because createWritable swaps at close(), the
// old file and the new one coexisted for the whole run. 1.5 GB of a tablet's storage to make 744 MB.
if (!app.includes("removeEntry('stone-master.tif')"))
  fail.push('the OPFS scratch master is never removed: every render leaves one behind, and the old one is still there while the next is written');
{
  const rm = app.indexOf("removeEntry('stone-master.tif')"), mk = app.indexOf("getFileHandle('stone-master.tif'");
  if (rm >= 0 && mk >= 0 && rm > mk)
    fail.push('the scratch master is removed AFTER its handle is taken, which either deletes the file being written or does nothing at all');
}

// THE PREVIEW NEVER DRAWS PER-ELEMENT GLOW, INCLUDING INSIDE AN ISLAND. Zeroing glowPx in the live paint
// was not enough: a reality window renders the WHOLE SLAB again at another light, every frame, and it
// goes through renderSlabTo which sets glowPx back on. The preview kept paying 8,050 per-element shadows
// inside the island and a 2 GB tablet could not open the studio.
if (!app.includes('glowPx = (BLOOM_DRAW && !glowSuppress) ? 16 * coatScale : 0;'))
  fail.push('renderSlabTo enables drawn glow unconditionally, so the live view pays for it inside every reality window, every frame');
if (!app.includes('const prevSuppress = glowSuppress; glowSuppress = true;'))
  fail.push('the interactive window path does not suppress drawn glow, so the preview renders the whole slab again with per-element shadows');
if (!app.includes('} finally { glowSuppress = prevSuppress; }'))
  fail.push('the glow suppression is not restored in a finally, so a throw mid-window would leave every later export without its drawn glow');

// ?glow=auto MUST TRACK SIGMA AND MUST NOT SERVE A STALE COLOUR. The deficit it corrects grows with the
// blur, so a fixed lift is right at exactly one width - 0.61 matches at 65535 and reads +7.5% over at
// 32768. A master SET rendered across widths on one number would disagree with itself.
//
// The cache is the silent one. liftCol memoises by colour string because a tile paints 8,050 specks; if
// the lift moves between renders and the map is not cleared, the next width paints the previous width's
// colours and nothing anywhere says so.
if (!app.includes("GLOW_RAW === 'auto'"))
  fail.push('?glow=auto is not recognised, so a mass render across widths has no way to stay consistent with itself');
if (!app.includes('glowPx * 0.00065 - 0.07'))
  fail.push('the automatic lift is not the fitted function of sigma, so it cannot be right at more than one width');
if (!app.includes('if (t !== liftCached) { liftMap.clear(); liftCached = t; }'))
  fail.push('the lifted-colour cache is not invalidated when the lift changes: a second render at another width would silently reuse the colours from the first');
if (!app.includes('glowLift: BLOOM_DRAW && uvMode ? +glowLift().toFixed(3) : undefined'))
  fail.push('the master records the requested lift rather than the effective one, so an auto render would claim a lift it did not use');
// A LIFT OF EXACTLY ZERO HAS TO SURVIVE THE STAMP. `|| undefined` deleted it, and zero is not the
// uninteresting case - it is what WebKit shipped, and the one value that was measurably wrong. Every
// WebKit master from before the constant carries no glowLift field, which reads as "this build did not
// record it" rather than "it ran at zero". Nothing else in the file distinguishes the two.
const stamp = app.split(String.fromCharCode(10)).find(l => l.includes('glowLift:') && l.includes('toFixed')) || '';
if (stamp.includes('|| undefined'))
  fail.push('a glow lift of exactly zero is stamped as absent, so a master that ran at the one wrong value is indistinguishable from one whose build never recorded a lift');

// DRAWN GLOW IS THE DEFAULT, AND WEBKIT TAKES A NEGATIVE LIFT. Those two have to ship together. Blink
// runs -10.2% against its own image-space master at 65535 and wants 0.612; WebKit OVERSHOOTS and wants
// -0.304. Applying the Blink number there lands roughly +30% over-bright, and the 0 this branch used to
// return lands +7.8% - so a default without the engine branch, or with it pinned to zero, ships every
// Safari master brighter than the set it belongs to. Discriminated on CAN_FILTER because that is a probe,
// not a user agent.
if (!app.includes("return !/^(blur|off|0)$/i.test(new URLSearchParams(location.search).get('bloom')"))
  fail.push('drawn glow is not the default, or ?bloom=blur no longer backs it out - one of the two is now wrong');
if (!app.includes('!CAN_FILTER ? WEBKIT_LIFT'))
  fail.push('the lift is not engine-aware: WebKit would take the Blink value on a path that already overshoots, landing about +30% over-bright');
// THE CONSTANT IS A MEASUREMENT, SO IT IS PINNED. -0.304 is the mean of two fitted matches, -0.3045 at
// 65535 and -0.3036 at 32768, against a reference that is width-invariant. A zero or a positive number
// here is the old defect returning, and a value drifting far from the measurement means the fit moved
// without the readings behind it moving.
const wk = app.match(/const WEBKIT_LIFT = ([-0-9.]+);/);
if (!wk) fail.push('the WebKit lift is no longer a named constant, so the one number that brings that engine onto the reference cannot be found or checked');
else if (!(+wk[1] >= -0.4 && +wk[1] <= -0.2))
  fail.push('the WebKit lift is ' + wk[1] + ', outside the measured -0.3045 to -0.3036 by more than the readings allow: a zero or a positive value is the defect that shipped every Safari master +7.8% over the set');
// DECLARED BEFORE IT IS READ. The same rule the plan trail broke: a const read from a branch above its
// declaration is a temporal dead zone that throws only when that branch is taken - and this branch is
// taken on exactly one engine, the one that cannot be debugged from here.
else if (app.includes('!CAN_FILTER ? WEBKIT_LIFT') && app.indexOf('const WEBKIT_LIFT =') > app.indexOf('!CAN_FILTER ? WEBKIT_LIFT'))
  fail.push('WEBKIT_LIFT is read above its own declaration - a temporal dead zone on the one branch only WebKit takes, so it would throw on iOS and nowhere else');
// GECKO HAS ITS OWN LINE, AND IT IS SELECTED BY A CAPABILITY, NOT A NAME. Gecko wants 0.417 at 32768
// and 0.780 at 65535 where Blink wants 0.271 and 0.612; running Blink numbers there leaves every Firefox
// master about 3% under the set. The discriminator is a CSS property only Gecko has, confirmed on all
// three engines - the DOM-property form reads false on Firefox 156 and would classify Gecko as Blink.
if (!app.includes("CSS.supports('-moz-appearance', 'none')"))
  fail.push('Gecko is no longer detected by a capability only Gecko has, so Firefox takes the Blink lift and lands about 3 percent under the rest of the set');
// TARGETED AT THE EXECUTABLE FORM, not the coefficients: the comment above it quotes the same two
// numbers, so a check for the bare expression passed with the code deleted. Caught by ablation.
if (!app.includes('IS_GECKO ? glowPx * 0.000692 + 0.054 :'))
  fail.push('the Gecko lift is not the fitted line through its two measured matches, so Firefox cannot agree with the set at more than one width');
if (app.slice(app.indexOf('const WEBKIT_LIFT'), app.indexOf('const liftCv')).includes('userAgent'))
  fail.push('the engine branch reads a user agent instead of probing a capability, which is a claim and not a measurement');
// A PROBE IS NOT A FINISHED RENDER. `ok` in the tile-proof record means this device rendered a master
// at that tile and came back; `probe` means a canvas allocated, kept its size and returned the pixel
// written into its far corner. The second is much weaker evidence and must never be written into the
// first, or one button press would tell the planner a size is proven that has never produced a tile.
if (!app.includes('rec.probe = pass'))
  fail.push('the tile probe no longer records its result as probe evidence, so it cannot be told apart from a tile this device actually finished a render with');
if (app.includes('rec.ok =') || app.includes('rec.ok='))
  fail.push('the tile probe writes into ok, which means a passing canvas probe would be recorded as a finished render - the planner then trusts a size nothing has ever rendered');

// DECLARED BEFORE READ, FOR A LIST OF NAMES. Two temporal dead zones landed in one evening and the
// check below only knew two constants by name, so a third slipped past: a listener registered at line
// 4700 read state declared at 6100, inside one IIFE, and threw on every interaction. A fourth
// (tierLarge) was already there and had never been noticed.
//
// LIMIT, stated because it decides what may be added here: this flags a bare use ABOVE the
// declaration, ignoring comment lines. That is only a defect when the use runs at LOAD - top level, or
// a listener registered there. A reference inside a function that is merely called later is legal, so
// this is a curated list and never a sweep.
const IDCH = c => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === "$";
function usedBefore(lines, name, upTo) {
  for (let i = 0; i < upTo; i++) {
    const t = lines[i];
    if (t.trim().startsWith("//")) continue;
    for (let at = t.indexOf(name); at >= 0; at = t.indexOf(name, at + 1)) {
      const b = at === 0 ? " " : t[at - 1], a = t[at + name.length] || " ";
      if (!IDCH(b) && !IDCH(a)) return i + 1;
    }
  }
  return 0;
}
{ const lines = app.split(String.fromCharCode(10));
  for (const name of ["WEBKIT_LIFT", "IS_GECKO", "glowKnob", "tierLarge", "glowLift"]) {
    const decl = lines.findIndex(l => l.includes("let " + name) || l.includes("const " + name));
    if (decl < 0) { fail.push("the declaration of " + name + " is gone, so its order cannot be checked"); continue; }
    const use = usedBefore(lines, name, decl);
    if (use) fail.push(name + " is read at line " + use + " but declared at line " + (decl + 1) +
      ": a temporal dead zone, which throws only when that earlier code runs - for a listener, whenever the user gets there first");
  }
}

// DECLARED BEFORE READ, same rule the plan trail broke and on a branch only one engine takes.
if (app.includes('IS_GECKO ? glowPx') && app.indexOf('const IS_GECKO =') > app.indexOf('IS_GECKO ? glowPx'))
  fail.push('IS_GECKO is read above its own declaration - a temporal dead zone that throws on Firefox and nowhere else');
// AND THE MASTER HAS TO SAY WHICH RULE RAN. A lift of 0.271 alone does not distinguish Blink taking its
// own line from Gecko wrongly taking Blink's - the number is identical, the picture is not.
// THE BUILD HAS TO REACH THE FILE. It was on screen and nowhere in a master, so a set rendered across
// today's builds could never be attributed - and it cannot be retrofitted, because a file written
// without it can never learn its own build. Three builds today moved drawn output.
if (!app.includes('build: BUILD,'))
  fail.push('a master does not record which build drew it, so a set rendered across builds cannot be attributed and never can be, since this cannot be added to a file after the fact');
// AND ONLY WHEN ONE WAS DRAWN. The glow is gated on uvMode, so a daylight master draws no halo at all
// and a lift stamped there is a claim about a render that did not happen.
if (!app.includes('GLOW_AUTO && BLOOM_DRAW && uvMode ?'))
  fail.push('a master does not record WHICH engine rule produced its lift, so a Gecko render that silently took the Blink line is indistinguishable from a Blink one');
if (!app.includes("GLOW_RAW === '' || GLOW_RAW === 'auto'"))
  fail.push('the lift does not default to auto, so a default render uses no correction at all and comes back dim at every large width');
if (!app.includes('glowRatio: BLOOM_DRAW && uvMode ? glowRatio() : undefined'))
  fail.push('a master does not record the drawn-against-blurred ratio, so the per-engine branch can never be replaced by a fitted curve');
// THE PROBE READING ZERO HAS TO REACH THE FILE. It reads zero on every engine today - the blurred branch
// quantises away below half a level - and the old stamp deleted that zero, so a probe that never saw
// anything was indistinguishable from a build that never had one. The gate above proves the LINE exists;
// only a recorded zero proves the probe RAN. Nothing static can check the canvas arithmetic itself.
const ratioStamp = app.split(String.fromCharCode(10)).find(l => l.includes('glowRatio:') && l.includes('glowRatio()')) || '';
if (ratioStamp.includes('|| undefined'))
  fail.push('the drawn-against-blurred probe drops a reading of exactly zero, which is the reading it actually gives: a probe that saw nothing would look like a build that never ran one');

// AN EXPLICIT ?glow NUMBER WINS, INCLUDING A NEGATIVE ONE. WebKit does not under-deliver, it overshoots,
// so the only way to measure what it needs is to be able to take light away - and the engine branch that
// pins it to 0 would otherwise swallow the very value being tested.
if (!app.includes("const glowLift = () => GLOW_RAW !== '' && !GLOW_AUTO ? GLOW_SET"))
  fail.push('an explicit ?glow value no longer wins over the engine branch, so WebKit cannot be measured at any lift but zero');
if (!app.includes('return v >= -1 && v <= 1 ? v : 0;'))
  fail.push('?glow rejects negative values, so an engine that overshoots has no way to be brought down');
if (!app.includes('const mix = t >= 0 ? (v => v + (255 - v) * t) : (v => v * (1 + t));'))
  fail.push('the negative lift mirrors the positive expression instead of mixing toward black: white is a distance to 255, black is a fraction of what is there, and the wrong gap darkens by the wrong amount');

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
// EXISTING IS NOT THE SAME AS IN SCOPE. This checked only that `const trail = []` was present, and it
// passed for the whole life of a defect where the declaration sat THIRTEEN LINES BELOW a push to it.
// The push was guarded by `sigma > 0 && !canBlur` - black light on an engine with no canvas filter - so
// every other combination short-circuited before touching the dead zone and it fired on one device in
// the world. node --check cannot see a temporal dead zone, and neither can a test that asks whether a
// line exists. Ask where it is instead.
const trailDecl = plan.indexOf('const trail = [];'), trailUse = plan.indexOf('trail.push');
if (trailDecl < 0) fail.push('the plan trail is never declared: every tiled export would die with a ReferenceError');
else if (trailUse >= 0 && trailUse < trailDecl)
  fail.push('the plan trail is pushed to before it is declared - a temporal dead zone, which throws only when the condition guarding that push is true, so it can hide from every engine but one');
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

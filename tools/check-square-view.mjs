// A SQUARE MASK IS A WINDOW ON THE SLAB, NOT THE SLAB SQUASHED INTO A SQUARE.
//
// docs/architecture.md has said since before anything produced one that the source "rasterises to a
// 430-px card or a 2048 squared mask without a bitmap ever being scaled", and that the simple reader
// wants 4 grey masks at 2048 squared. Nothing emitted that shape: every mask came out W x round(W*H),
// because H = 0.625 is a build constant and the export canvas was built from W alone.
//
// The fix is a VIEW - the pair (canvas, transform) each mask builder sets up identically:
//
//   viewSlab(W)    w = W,  h = round(W*H),  scale W,      no offset      the whole 8 x 5 ft slab
//   viewSquare(S)  w = h = S,               scale S / H,  dx = -(S/H)*(1-H)/2
//
// viewSquare is the LARGEST CENTRED SQUARE of that same rasterisation: H of draw space is 5 ft, so
// the window is 5 x 5 ft and keeps 62.5% of the slab's width. At S = 2048 the scale is 3276.8 - not
// an integer, and deliberately not rounded, because rounding it is what would make this a resample.
//
// THERE ARE TWO WAYS TO FILL A SQUARE AND ONLY ONE OF THEM IS TRUE.
//
//   setTransform(S/H, 0, 0, S/H, dx, 0)   a window. Uniform scale. Veins keep their proportions.
//   setTransform(S,   0, 0, S/H,  0, 0)   a squeeze. The whole 8 ft in frame, grain 1.6x wider
//                                         than tall. It fills the canvas, it looks almost right,
//                                         and it is a lie about the stone.
//
// The squeeze is the plausible mistake and it is invisible in a thumbnail, so clause 3 is the
// load-bearing one. Clause 6 holds the other way of getting this wrong: doing the crop as a shifted
// drawImage of the finished picture, which reads pixels from outside the canvas - the same defect
// check-relief-bleed exists for, wearing the same output.
//
//   node tools/check-square-view.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const APP = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'stone-author.html'), 'utf8');
let bad = 0;
const fail = (m) => { console.log('  FAIL  ' + m); bad++; };
const ok = (m) => console.log('  ok    ' + m);

// LIFTED FROM THE SOURCE, never retyped: a gate that restates the arithmetic agrees with itself
// rather than with the app. H comes out of the source too.
const lift = (name, re) => { const m = APP.match(re); if (!m) return null; return m[1]; };
const Hsrc = lift('H', /\n  const H = ([\d.]+);/);
const slabSrc = lift('viewSlab', /\n  const viewSlab = (W => \([^;]*?\));/);
const sqSrc = lift('viewSquare', /\n  const viewSquare = (S => \([^;]*?\));/);
const sqMask = lift('SQUARE_MASK', /\n  const SQUARE_MASK = (\d+);/);

if (!Hsrc || !slabSrc || !sqSrc || !sqMask) {
  console.log('  FAIL  cannot lift H / viewSlab / viewSquare / SQUARE_MASK from the app - the seam is gone or renamed');
  process.exit(1);
}
const H = Number(Hsrc);
const viewSlab = new Function('H', 'return (' + slabSrc + ');')(H);
const viewSquare = new Function('H', 'return (' + sqSrc + ');')(H);
const S = Number(sqMask);

// 1. THE SLAB VIEW IS THE OLD BEHAVIOUR, EXACTLY. Every export ever taken was W x round(W*H) with
// scale W and no offset; if this clause moves, every existing slab re-renders differently.
{
  let drift = 0;
  for (const W of [1, 2, 3, 430, 512, 1024, 2048, 3276, 3277, 4096, 8192, 16384, 65535]) {
    const V = viewSlab(W);
    if (V.w !== W || V.h !== Math.round(W * H) || V.k !== W || V.dx !== 0) { drift++; if (drift === 1) fail(`viewSlab(${W}) is not the historical sizing: got w=${V.w} h=${V.h} k=${V.k} dx=${V.dx}, want w=${W} h=${Math.round(W * H)} k=${W} dx=0`); }
  }
  if (!drift) ok('viewSlab reproduces the historical W x round(W*H) sizing over 13 widths');
}

// 2. THE SQUARE VIEW IS SQUARE. The one clause a glance would catch, and the cheapest to break by
// copying viewSlab's height expression.
{
  let nonsq = 0;
  for (const s of [256, 512, 1024, 2048, 4096]) { const V = viewSquare(s); if (V.w !== s || V.h !== s) { nonsq++; if (nonsq === 1) fail(`viewSquare(${s}) is ${V.w} x ${V.h}, not square`); } }
  if (!nonsq) ok('viewSquare is w === h === S over 5 sizes');
}

// 3. THE SCALE IS UNIFORM, IN THE ARITHMETIC AND IN THE TRANSFORM. The squeeze lives here.
{
  const V = viewSquare(S);
  if (Math.abs(V.k - S / H) > 1e-9) fail(`viewSquare(${S}).k is ${V.k}, not S / H = ${S / H} - a different scale per axis is the squeeze`);
  else ok(`viewSquare(${S}).k is S / H = ${V.k}, one scale for both axes`);
  // and the builders must actually emit it in both slots
  const emit = [...APP.matchAll(/cx\.setTransform\(V\.k, 0, 0, V\.k, V\.dx, 0\)/g)].length;
  const bad2 = [...APP.matchAll(/cx\.setTransform\(V\.k, 0, 0, (?!V\.k,)/g)].length;
  if (emit < 2) fail(`only ${emit} builder(s) emit setTransform(V.k, 0, 0, V.k, V.dx, 0) - expected the base mask and the coverage mask`);
  else ok(`${emit} builders emit the uniform transform with the offset in it`);
  if (bad2) fail('a builder emits setTransform with a different vertical scale - that fills the square by squashing the slab into it');
  else ok('no builder scales the axes differently');
}

// 4. IT IS THE LARGEST CENTRED SQUARE. Derived back out of the view, so a wrong window cannot hide
// behind a right-looking offset: x0 = -dx/k must be (1-H)/2, and the window must be H wide.
{
  const V = viewSquare(S);
  const x0 = -V.dx / V.k, x1 = x0 + S / V.k;
  if (Math.abs(x0 - (1 - H) / 2) > 1e-9) fail(`the window starts at x=${x0} in draw space, not (1-H)/2 = ${(1 - H) / 2} - it is not centred`);
  else ok(`the window is centred: x from ${x0} to ${x1} of 0..1`);
  if (Math.abs((x1 - x0) - H) > 1e-9) fail(`the window is ${x1 - x0} wide in draw space, not H = ${H} - it is not the largest square that fits`);
  else ok(`the window is H wide, so the square is the tallest the slab allows (${(8 * H).toFixed(2)} x 5.00 ft of an 8 x 5 ft slab)`);
}

// 5. NO RESAMPLE AT THE CONTRACT SIZE. k * H must land on S exactly; a rounded k is a resample
// wearing a window's clothes.
{
  const V = viewSquare(S);
  if (V.k * H !== S) fail(`viewSquare(${S}).k * H = ${V.k * H}, not ${S} exactly - the square is being resampled`);
  else ok(`k * H === ${S} exactly, so the square is delivered without scaling a bitmap`);
}

// 6. THE OFFSET IS ON THE TRANSFORM, NOT ON A COMPOSITE. The other way to crop is to draw the
// finished picture at an offset, which reads pixels the canvas never held.
{
  const iB = APP.indexOf('function expBaseMask('), iC = APP.indexOf('function expCoverage(');
  const seg = APP.slice(iB, APP.indexOf('\n  function ', iC + 10));
  const shifted = [...seg.matchAll(/drawImage\([^)]*V\.dx[^)]*\)/g)].map(m => m[0]);
  if (shifted.length) fail(`the window is applied by shifting a drawn image (${shifted[0]}) - that reads outside the canvas`);
  else ok('neither builder applies the window by shifting a drawn image');
}

// 7. ONE COPY OF THE DRAWING CODE. A square builder cloned from the slab builder is how a square
// mask and its slab mask start disagreeing about what is in the stone.
for (const fn of ['expBaseMask', 'expCoverage']) {
  const n = (APP.match(new RegExp('function ' + fn + '\\(', 'g')) || []).length;
  if (n !== 1) fail(`there are ${n} copies of ${fn} - the square set must go through the same builder as the slab set`);
  else ok(`${fn} is declared exactly once`);
}

// 8. THE KIT CARRIES THEM, AND THE FILE NAME IS DERIVED FROM THE SUFFIX. This clause used to count
// four square entries in the paced makers[]/names[] pair and check the two lengths matched. That
// pair is gone: the layer LIST is the material's to choose, a positional pair cannot express a list
// whose length moves with the slab, and the square set has its own loop. The property it protected
// is unchanged - the files named are the masks produced - so it is re-aimed here rather than
// dropped, because a gate pinned to a mechanism that no longer exists reads green on anything.
//
// WHAT MAKES EACH OF THESE RED: a fifth entry in stoneMasks; a second layer claiming primary; a
// literal 'masks/square/base.png' back in the kit; a hardcoded 6 where F.CN decides the cane count;
// a suffix with a capital or an underscore in it, which the consumer refuses outright.
{
  const SUFFIX = /^[a-z][a-z0-9-]{0,23}$/;                 // the consumer's own rule, restated
  const listOf = (re, end) => { const a = APP.indexOf(APP.match(re)?.[0] ?? '\0'); if (a < 0) return null;
    const b = APP.indexOf(end, a); return b < 0 ? null : APP.slice(a, b); };

  // ONE MATERIAL CHOOSES THE LIST, and the loop draws every entry through the square view. One call,
  // because the set is now iterated rather than enumerated.
  const calls = [...APP.matchAll(/viewSquare\(SQUARE_MASK\)/g)].length;
  if (calls !== 1) fail(`${calls} call(s) to viewSquare(SQUARE_MASK); the square set is one loop over materialMasks() and wants exactly one`);
  else ok('one square view, iterated over the material\'s own layer list');
  if (!/const sqMasks = materialMasks\(\);/.test(APP)) fail('the square set is not built from materialMasks() - the layer list is the material\'s to choose and nothing else may enumerate it');
  else ok('the square set comes from materialMasks()');

  // THE NAME IS THE SUFFIX. A literal file name beside a suffix is two sources for one fact, and the
  // one that drifts is the one nothing reads.
  if (!/const file = m\.suffix \+ '\.png';/.test(APP)) fail('the square mask file name is not derived from the layer suffix');
  else ok('each square mask file name is derived from its layer suffix');
  const lits = [...APP.matchAll(/'masks\/square\/[a-z-]+\.png'/g)].map(m => m[0]);
  if (lits.length) fail(`${lits.length} literal square mask path(s) left in the app: ${lits.join(', ')} - the name must come from the suffix`);
  else ok('no literal square mask paths remain');

  // STONE STILL PUBLISHES ITS FOUR, in the order it published them.
  const st = listOf(/const stoneMasks = \(\) => \[/, '];');
  if (!st) fail('cannot find stoneMasks');
  else {
    const got = [...st.matchAll(/suffix: '([^']+)'/g)].map(m => m[1]);
    const want = ['base', 'major', 'minor', 'micro', 'web'];
    if (got.join(',') !== want.join(',')) fail(`stoneMasks publishes [${got}], not [${want}]`);
    else ok(`stoneMasks publishes ${want.join('/')}, in that order`);
  }

  // STONE'S FIELD LAYER IS COVERAGE, AND THE BACK LIGHT STILL HAS ITS OWN READER.
  //
  // RED WHEN: base is pointed back at expBaseMask; expBaseMask loses the other callers that wanted
  // it unchanged; micro joins the subtraction; the veins are summed instead of unioned; or the base
  // composite is drawn back into the field builder.
  {
    const sf = /function expStoneField\(Wv\) \{([\s\S]*?)\n  \}/.exec(APP);
    if (st && /suffix: 'base'[^}]*draw: V => expBaseMask\(V\)/.test(st))
      fail("stone's base is drawn by expBaseMask again - that flattens the ground COLOUR to luminance and measured mean 8.00 contrast 0.00 with every pixel below 32, which is not a field layer by either test");
    else if (!st || !/suffix: 'base'[^}]*draw: V => expStoneField\(V\)/.test(st))
      fail("stone's base is not drawn by expStoneField");
    else ok("stone's base is drawn by expStoneField, not by expBaseMask");

    // expBaseMask IS STILL THE BACK LIGHT'S, and this clause used to prove it by COUNTING callers -
    // at least two outside the declaration. That was a proxy, and it expired the moment the slab set
    // stopped calling it: the count fell to one and the gate reddened on a change that had not gone
    // near the back light. Checked by NAME now, which is what it always meant.
    if (!/const W = 512, body = expBaseMask\(W\);/.test(APP))
      fail('the back light no longer reads expBaseMask as its glowing body - it is the one caller that wants the ground COLOUR flattened to luminance rather than coverage, so repointing it changes the back light on every slab and reports nothing');
    else ok("expBaseMask is still the back light's glowing body");

    if (!sf) fail('cannot find expStoneField');
    else {
      if (!/\['major', 'minor'\]/.test(sf[1]))
        fail("expStoneField does not subtract exactly major and minor - a vein is a fracture filled with other mineral so the matrix is absent there, but specks and drusy are inclusions WITHIN it; taking micro out as well measured mean 141.31 contrast 126.75 with 44.59% below 32, because micro alone covers 37.93% of the square");
      else ok('expStoneField subtracts the veins and leaves the speckle field alone');
      if (!/if \(vd\[i\] > vein\[j\]\) vein\[j\] = vd\[i\]/.test(sf[1]))
        fail('the vein coverages are not unioned - summing them punches a darker hole wherever a minor crosses a major, which is the matrix being absent twice over');
      else ok('the vein coverages are unioned, not summed');
      if (/ensureBreccia|ensureClouds|ensureBands/.test(sf[1]))
        fail('the base composite is drawn into the field builder again - ablated one modulator at a time, clouds and bands changed NOTHING (soft-light leaves a light base light) and breccia drove the mean to 10.13 by painting its clasts source-over; the variation is matrix COLOUR and a layer carries one hex, so it has nowhere to go');
      else ok('the base composite is kept out of the field builder, as measured');
    }
  }

  // GLASS PUBLISHES THE SHEET PLUS ONE LAYER PER CANE, and the cane count is the SHEET'S, not six:
  // glassScene clamps it and a slab may ask for two, so a fixed six would publish four black layers
  // and spend the consumer's eight-layer budget on nothing.
  const gl = listOf(/function glassMasks\(\) \{/, '\n  }\n');
  const wd = listOf(/function woodMasks\(\) \{/, '\n  }\n');
  if (!gl) fail('cannot find glassMasks');
  else {
    if (!/suffix: 'ground', primary: true/.test(gl)) fail('glass does not declare `ground` primary - the card surface paints one layer untinted and the consumer\'s flat-field warning cannot catch a field layer, so it must be declared, never defaulted');
    else ok('glass declares the ground layer primary explicitly');
    if (!/const CN = glassScene\(\)\.F\.CN;/.test(gl)) fail('the glass cane count is not read from the scene - a fixed count publishes empty layers');
    else ok('the glass cane count comes from the sheet, not a constant');
    if (!/'cane-' \+ GLASS_CANE_LET\[k\]/.test(gl)) fail('the cane suffix is not derived from GLASS_CANE_LET - the token letter and the layer letter must be one fact');
    else ok('each cane suffix is derived from the shared palette letters');
  }

  // AT MOST ONE PRIMARY PER LIST. The consumer REFUSES a pack with two, so this is a refusal, not a
  // warning - and the lists are far enough apart in the file for a second one to look deliberate.
  for (const [nm, body] of [['stoneMasks', st], ['glassMasks', gl], ['woodMasks', wd]]) {
    if (!body) continue;
    const n = [...body.matchAll(/primary: true/g)].length;
    if (n !== 1) fail(`${nm} marks ${n} layers primary; the consumer REFUSES a pack with more than one and DEFAULTS to layer 0 on none - and its flat-field warning cannot catch a defaulted field layer in any material, because the threshold is 1.5 while the shipped field band starts at 2.8. Exactly one, declared.`);
    else ok(`${nm} declares exactly one primary layer`);
  }

  // EVERY SUFFIX IS LEGAL TO THE CONSUMER. A capital or an underscore is a refused pack, and the
  // export reports success either way.
  const let_ = /const GLASS_CANE_LET = '([^']*)';/.exec(APP);
  if (!let_) fail('cannot find GLASS_CANE_LET - the cane suffixes cannot be checked without it');
  const all = [...APP.matchAll(/suffix: '([^']+)'/g)].map(m => m[1]).concat(
    [...(let_ ? let_[1] : '')].map(c => 'cane-' + c));
  const illegal = all.filter(x => !SUFFIX.test(x));
  if (illegal.length) fail(`illegal layer suffix(es) for the consumer: ${illegal.join(', ')}`);
  else ok(`all ${all.length} layer suffixes match the consumer's ${SUFFIX}`);

  // EVERY LAYER CARRIES A COLOUR AND AN OPACITY. The consumer indexes both and refuses the pack if
  // either is missing - only `primary` is optional there - and the first real export of this set was
  // REFUSED for exactly that, on the one layer that had no opacity. A descriptor missing either is
  // therefore not a degraded pack, it is no pack, and the export reports success all the same.
  for (const [nm, body] of [['stoneMasks', st], ['glassMasks', gl], ['woodMasks', wd]]) {
    if (!body) continue;
    const entries = [...body.matchAll(/suffix: '[^']+'/g)].length;
    const cols = [...body.matchAll(/colour: /g)].length;
    const ops = [...body.matchAll(/opacity: /g)].length;
    if (cols < entries || ops < entries)
      fail(`${nm} declares ${entries} layer(s) but ${cols} colour(s) and ${ops} opacity(s) - the consumer requires both on every layer and refuses the pack when either is absent`);
    else ok(`${nm}: all ${entries} layer(s) carry a colour and an opacity`);
  }
  if (!/color: packHex\(m\.colour\), opacity: packUnit\(m\.opacity\)/.test(APP))
    fail('the manifest does not emit color and opacity unconditionally - a conditional emit is how the first export of this set was refused');
  else ok('the manifest emits color and opacity on every layer, unconditionally');

  // A MANIFEST GOES WITH THEM, declaring the schema the consumer checks first.
  const push = /^\s*files\.push\(\{ name: 'masks\/square\/material\.json'/m.test(APP);
  if (!push || !/schema: 1, id: materialPackLatch\(\)/.test(APP))
    fail('the square set ships without an UNGUARDED schema-1 manifest - masks with no descriptor are not a pack, and a push behind a condition leaves the path literal in the file while nothing writes it');
  else ok('a schema-1 manifest ships beside the square masks, unguarded');

  // THE NAME IS DISPLAY TEXT; THE ID IS A NAMESPACE. Measured against the consumer's own
  // id_conflict(): `wood` is refused outright, `wood-oak` and `marble-carrara` are refused for being
  // prefixed BY a reserved name, and an id equal to a reserved one makes assertUniqueTokenKeys throw
  // with the initial rebuild() unguarded - the card never defines. `ma-glass`, `ma-stone` and
  // `ma-wood` all come back clear, so the `ma-` prefix is what is keeping them clear.
  //
  // WHAT THIS PINS is the SEPARATION, not the format: the slab's name may reach `name`, and must
  // never reach the id. An id carrying anything that moves - the slab name, the picture, a render
  // signature - dangles every room using the pack the moment it moves, and says nothing.
  //
  // RED WHEN: materialPackId reads slabName, or stops being 'ma-' + the material; or the manifest
  // stops carrying the slab's name at all.
  {
    // THE LATCH IS THE INVARIANT, not the format. An earlier spelling of this clause asserted that
    // materialPackId was literally 'ma-' + MATERIAL and read nothing that moves - both deliberately
    // false now, since it derives from the slab name - so it would have failed the very change it
    // existed to protect. What has to hold is that a STORED id wins before anything is derived.
    const body = /function materialPackId\(\) \{([\s\S]*?)\n  \}/.exec(APP);
    if (!body) fail('cannot find materialPackId');
    else {
      const first = body[1].trim().split(String.fromCharCode(10))[0].trim();
      if (!/^if \(packId\) return packId;/.test(first))
        fail(`materialPackId does not return a stored id FIRST (its first statement is: ${first.slice(0, 70)}) - a derivation reached before the stored value is a derivation that can overrule it, and the id following anything that moves dangles every room using the pack, silently`);
      else ok('a stored pack id wins before anything is derived');
      if (!/'ma-' \+ MATERIAL/.test(body[1]))
        fail("the 'ma-' prefix is not applied in materialPackId - it is what keeps every id clear of the consumer's reserved floor-type names (wood, wood-oak, marble-carrara and tile-x are all refused by its own id_conflict), and the clearance is structural only while the prefix is ours");
      else ok("the 'ma-' prefix is applied in code, not taken from the slab");
      if (!/\.slice\(0, 32\)/.test(body[1]))
        fail("the derived id is not capped at 32 - the consumer's id regex stops there, and this repo's own glass slab makes a 35-character one");
      else ok('the derived id is capped at the 32 characters the consumer allows');
    }

    // IT LATCHES WHEN THE PACK LEAVES, and the manifest goes through the latch rather than round it.
    if (!/if \(!packId\) \{ packId = materialPackId\(\); saveLocal\(\); \}/.test(APP))
      fail('materialPackLatch does not store the derived id - without that the id is recomputed on every export and follows the slab name for ever');
    else ok('the pack id is stored the first time a pack is exported');
    if (!/id: materialPackLatch\(\)/.test(APP))
      fail('the manifest does not take its id through the latch - an export that publishes a derived id without storing it leaves nothing to latch');
    else ok('the manifest takes its id through the latch');
    if (!/packId = typeof o\.packId === 'string'/.test(APP) || !/name: slabName, packId,/.test(APP))
      fail('packId does not round-trip through serialize and deserialize - a latch that is not saved is not a latch');
    else ok('packId round-trips through serialize and deserialize');

    // AND IT NEVER REACHES THE RENDER SIGNATURE. renderSig hashes an explicit, MEASURED list; a
    // publication id on it would re-date every master on disk and orphan every resume, and no fix
    // afterwards recovers them because a master keeps the signature it was written with.
    const rs = /const renderSig = \(\) => \{([\s\S]*?)\n  \};/.exec(APP);
    if (!rs) fail('cannot find renderSig');
    else if (/packId/.test(rs[1]))
      fail('packId is inside renderSig - it does not reach a pixel, and hashing it re-dates every master on disk and orphans every resume');
    else ok('the pack id is not on the render signature');

    if (!/const nm = \(slabName \|\| ''\)\.trim\(\);/.test(APP) || !/if \(nm\) desc\.name = nm;/.test(APP))
      fail("the manifest does not carry the slab's name - `name` is display text the consumer coerces with str(), the one field a slab name can reach without consequence");
    else ok("the manifest carries the slab's own name as display text");
  }

  // THE SLAB-ASPECT SET READS THE SAME LIST. This had no clause at all, which is how it stayed
  // stone-shaped while the square set was fixed: five literal builders, all of them stone, so a
  // glass slab's masks/major.png carried marble veins drawn from a glass picture and nothing could
  // tell - a mask of the wrong material is a perfectly well-formed mask. It keeps its place in the
  // paced makers[] because these are full-size canvases at the render width, which is what EXP_PEAK
  // paces; names[] and makers[] therefore still align by POSITION, and the only way a positional
  // pair can carry a list whose length moves is for both to be built from that list.
  //
  // RED WHEN: either array goes back to literals, or they stop coming from the same list.
  {
    if (!/const slabSet = materialMasks\(\);/.test(APP))
      fail('the slab-aspect mask set is not built from materialMasks() - five literal stone builders is what gave a glass slab marble veins, and a mask of the wrong material is still a well-formed mask');
    else ok('the slab-aspect set comes from materialMasks() too');
    if (!/\.\.\.slabSet\.map\(m => \(\) => m\.draw\(viewSlab\(W\)\)\)/.test(APP))
      fail('the slab makers are not built from slabSet - a literal list beside a derived names[] is a positional pair that disagrees the moment a material publishes a different number of layers');
    else ok('the slab makers are built from that list, through viewSlab');
    if (!/\.\.\.slabSet\.map\(m => 'masks\/' \+ m\.suffix \+ '\.png'\)/.test(APP))
      fail('the slab mask names are not derived from the layer suffixes');
    else ok('the slab mask names are derived from the same suffixes');
    const lits = [...APP.matchAll(/'masks\/(?!square)[a-z-]+\.png'/g)].map(m => m[0]);
    if (lits.length) fail(`${lits.length} literal slab mask path(s) left in the app: ${lits.join(', ')}`);
    else ok('no literal slab mask paths remain');
  }

  // WOOD PUBLISHES SIX, AND THE SEAM THAT LETS IT IS FREE ON THE RENDER PATH.
  //
  // The record said wood's tiers "live as scalars inside shade with no seam to tap them". The seam is
  // the `out` buffer the board painter already passes per pixel; it was three slots wide. Asking for
  // the tiers means handing in a wider one, so what has to hold is that the RENDER path never does:
  // both painters allocate [0, 0, 0] and the guard reads false for every rendered pixel. Measured
  // against HEAD on a wood board at 1024, the painted pixels are byte-identical (FNV 3aa91700 both)
  // and the cost difference is +2.1% median against a 43.4% spread within either build - which is to
  // say unmeasurable here, and the first sequential pass that read +5.1% was the bench.
  //
  // RED WHEN: wood goes back to an empty list; a painter's buffer grows past three slots, which is
  // what would put the tier writes on the render path; the guard is removed, which does the same;
  // the pair stops being complementary; or a knot stops excluding the wood it replaced.
  {
    if (!/if \(MATERIAL === 'wood'\) return woodMasks\(\);/.test(APP))
      fail("wood does not publish its own masks - it returned [] for one release on the record that its tiers had no seam to tap, which was a description of the plumbing mistaken for a conclusion");
    else ok('wood publishes its own mask list');
    if (!wd) fail('cannot find woodMasks');
    else {
      const got = [...wd.matchAll(/suffix: '([^']+)'/g)].map(m => m[1]);
      const want = ['ground', 'early', 'late', 'heart', 'mineral', 'knot'];
      if (got.join(',') !== want.join(',')) fail(`woodMasks publishes [${got}], not [${want}]`);
      else ok(`woodMasks publishes ${want.join('/')}, in that order`);
      if (!/suffix: 'early', primary: true/.test(wd))
        fail("wood does not declare `early` primary - the ground is the board's EXTENT and is 255 everywhere on a plank inside its log, so untinted it is a white card; earlywood covers the board too and carries the ring banding, measured 228.97 mean at contrast 39.4");
      else ok('wood declares earlywood primary, not the ground');
    }

    // THE GUARD, AND THE BUFFERS THAT KEEP IT FALSE. Checked together, because either alone is
    // satisfiable while the other is not: a guard with a wide buffer behind it costs on every pixel,
    // and a narrow buffer with no guard writes past its end.
    if (!/if \(out\.length > 3\) \{/.test(APP))
      fail("shade writes the tiers unguarded - the board painter calls it once per pixel per tile, so this is the whole difference between a seam and a tax");
    else ok('the tier writes sit behind a buffer-length guard');
    const wide = [...APP.matchAll(/const out = \[0, 0, 0[^\]]*\]/g)].map(m => m[0]);
    const painters = wide.filter(x => x === 'const out = [0, 0, 0]').length;
    if (painters < 2)
      fail(`only ${painters} painter(s) allocate a 3-slot out buffer - both the board and the log view must, or the tier writes land on the render path`);
    else ok(`${painters} painters allocate a 3-slot buffer, so the guard is false while rendering`);

    const sh = /out\[3\] = tkn \? 0 : e;([\s\S]*?)out\[7\] = tkn;/.exec(APP);
    if (!sh) fail('cannot find the tier demux in shade');
    else {
      if (!/out\[4\] = tkn \? 0 : 1 - e;/.test(sh[0]))
        fail('late is not 1 - early - the ring is a lerp between the two, so the pair must tile the board; measured, early 228.97 + late 25.38 = 254.36 against a ground of 255');
      else ok('latewood is one minus earlywood, so the pair tiles the board');
      if (!/out\[5\] = tkn \? 0 : hh;/.test(sh[0]) || !/out\[6\] = tkn \? 0 : tms;/.test(sh[0]))
        fail('a knot does not exclude the tiers it replaced - the knot block ASSIGNS the colour rather than blending, so reporting the surrounding wood there describes wood that is not on screen');
      else ok('a knot excludes the tiers its colour replaced');
    }
  }

  // AND THE .ora OFFSET IS STILL DERIVED. The .ora layers sit directly after the named PNGs, so a
  // literal index there silently packs a mask as the slab the moment anything is inserted ahead.
  if (!/const oraAt = names\.length;/.test(APP)) fail('the .ora offset is not derived from names.length - a literal index packs the wrong image the moment one is inserted ahead of it');
  else ok('the .ora offset is derived from names.length');
  if (/buildOraFrom\(bytes\[\d/.test(APP)) fail('buildOraFrom is still handed a literal byte index');
  else ok('buildOraFrom takes no literal index');
}

// 9. THE CONTRACT SIZE IS THE PUBLISHED ONE. docs/architecture.md names 2048 squared; if the code
// and the doc drift, a consumer reads the doc.
{
  const doc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'architecture.md'), 'utf8');
  if (S !== 2048) fail(`SQUARE_MASK is ${S}; docs/architecture.md publishes 2048 squared`);
  else ok('SQUARE_MASK is 2048');
  if (!/2048²/.test(doc)) fail('docs/architecture.md no longer states the 2048 squared contract this gate is pinned to');
  else ok('docs/architecture.md still states the 2048 squared contract');
}

console.log(bad ? `\nsquare-view: ${bad} FAILURE(S)` : '\nsquare-view: OK');
process.exit(bad ? 1 : 0);

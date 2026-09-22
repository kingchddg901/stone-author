# The stone generator

Built 2026-09-20. `panel/stone-art.js` emits stone as **structure**; `panel/stone-raster.js`
turns that into paintable masks; `tools/stone_preview.py` draws it so a human can look.

Every rule below came from a measurement or a defect, not from a preference. Where a number
appears it was measured — off real marble slabs, off the generator's own output, or off an eye
test. Nothing here is wired into the panel yet.

    python tools/stone_preview.py --stone carrara --seed 7
    python tools/stone_preview.py --stone carrara --cut 0.5,1.0 --film 0.005
    python tools/stone_preview.py --stone carrara --wander 0.4 --aim across

Unknown flags pass through as stone overrides, so a parameter can be tried without editing the
table. For driving it by hand rather than by flag, `tools/stone-studio.html` is the control
surface (section 11).

---

## 1. It emits structure, never pixels

A stone comes out as veins — polylines in 0..1 with attributes — and the caller decides how to
draw them. The split earns its keep three times:

**Flexibility.** One stone serves a 430px card and a full-panel background by rasterising at
different densities, not by scaling a bitmap.

**Testability.** "Branch spacing is irregular" becomes an assertion about an array. Measuring
the same thing on a raster needs a skeletonising algorithm, and when that was tried it produced
a flat 472–558 branch points per 1000 skeleton pixels across *every* population including
micro — which is dots, and cannot branch. The probe was measuring its own artifacts.

**Scale.** Compressing a card means **more veins at the same gauge**. A bitmap cannot do that:
shrink it and the fine tiers fall below a pixel and turn to grey mush.

*A fourth reason appeared later:* rotation. Rotating geometry is exact — segment lengths survive
to 1e-12. Rotating a bitmap resamples and softens every vein.

## 2. Four tiers, separated by three orthogonal tests

Measured from real marble masks. Width separates major+minor from subminor+micro; **length**
separates subminor (strokes) from micro (dots, the same gauge); **distance to the major network**
separates minor from subminor.

| tier | gauge | median area | distance to major |
|---|---|---|---|
| major | 5.9mm | 846px | — |
| minor | 3.7mm | 167px | **59px** — shadows the network |
| subminor | 2.4mm | 74px | 81px |
| micro | 2.1mm | 11px | 90px |

Random scatter sits at **79px**, so subminor and micro are statistically independent of the
fracture network and minor is not. That is a fact about stone, and the generator reproduces it.

## 3. Minor is not a population, it is branching

Its gauge ratio to major is 3.7/5.9 = **0.63**, which falls straight out of a per-generation
scale factor, and it sits closer to the network than chance. Both facts say the same thing: minor
is generation-1 branching of major. One recursive `grow()` serves both, and there is no separate
minor generator.

Branch parameters that matter, each for a reason:

- **`branchPer` is per unit of PARENT LENGTH**, never a global budget. Long veins then branch more
  for free and it stays scale-free.
- **`branchScale` is mandatory.** Without a per-generation reduction, generation 2 matches
  generation 1 and the hierarchy collapses. Real marble's minor layer is **83% of its ink** in the
  chunky sub-population — that is what the collapse looks like from the inside.
- **`branchAngle` is the character parameter.** Near-90° reads as circuit trace however well the
  lengths are tuned. Measured on the generator's own output: **zero** branches at 90°, and against
  a *local* null nothing spikes at 15, 22.5, 30, 45 or 60.

## 4. Grade, sharpness, depth and film are four things

This is the model, and conflating any two of them produces a specific wrong result.

| | what it is | what it does |
|---|---|---|
| **grade** | the pencil | darkness *and* smudge together — intrinsic to the line |
| **sharpness** | `gaugeMm` | width, independent; a 2H and a 6B can be the same width |
| **depth** | position in the stack | ordering only — **nothing** to how the line is drawn |
| **film** | deposit above a sheet | where the haze of depth actually comes from |

A dark sharp vein can lie at the bottom of the stack and still be dark and sharp. What makes it
read as deep is that **things formed over it**. Depth was originally doing all three jobs; the
test that replaced that one asserts depth changes the gauge, blur and brightness by *exactly*
nothing.

Grade's smudge is a **fraction of the stroke**, never an absolute blur. A fixed blur smears the
fine tiers away and leaves the wide ones crisp — an absolute 1.1px blur is 1.5× the width of a
0.75px micro vein and 0.2× a major.

## 5. A vein is a walk in DIRECTION, with a spring

Walking position gives a jittery scribble. Walking the heading gives something that looks like it
propagated. The heading is a **damped spring about its launch**, not a free walk: without the
restoring term, 11% of veins curled past half a turn and one completed a full loop. Fractures
propagate; they do not curl back on themselves.

**`wander` is the direction knob, not `coherence`.** Coherence only spreads the *launch* headings
and saturates — 0.82, 0.92 and 0.97 render identically. A low-wander vein holds the line it was
given, which is what makes Carrara read as banding.

`wander` and `commit` are settable **per tier**. Rigid majors with wandering minors read as a
hard primary network carrying chaotic secondary damage; everything rigid reads as shattered glass.
That is a different material out of the same generator.

## 6. Some stones want a chord, not a heading

Carrara is "a kid with a pencil colouring corner to corner with random fill and pressure" — the
strokes are straight, and they all cross the stone. So a vein can be given an **exit** rather than
a direction.

- **`aim: "across"`** — enter one side, exit the **same position** on the other, plus `aimDrift`
  for the grain angle. Chords are parallel *by construction* rather than by tuning wander toward
  zero and hoping.
- **`aim: "antipode"`** — exit at `t+2`. This also guarantees a crossing, but `t` and `t+2` are
  antipodal **through the centre**, so every chord passes through the middle and the stone comes
  out a starburst. Right for a radial stone, wrong for a banded one.

`fallOff` kills some veins early and `startLate` begins others inside the stone, so no two share a
span. `aimNoise` nudges the exit a percent or two — exact symmetry is the tell, and breaking it
costs only 0.6° of parallelism (8.5° → 9.1°).

## 7. Banding is offset duplication

A parallel fracture set comes out of one stress field, so its members genuinely are near-copies
of each other shifted sideways. No placement algorithm is needed.

The offset is perpendicular to the **local** heading — a constant vector shears a curved vein off
its own curve. Only the *skeleton* is shared: each sibling gets its own id, and therefore its own
width profile, gauge, and entry and exit along the run. That is what stops a band reading as a
photocopy.

Each sibling also steps one **depth level** and is strictly thinner, so opacity and haze fall out
of the depth machinery for free. The step shares its sign with the lateral offset, so a band runs
outward *and* deeper together — a dipping bed rather than a flat set of lines.

## 8. A stone is a block, not a picture with depth

Every feature occupies a depth **range** and **dips** sideways as it descends. Choose a different
depth window and you take a different face off the same block: veins vanish, buried ones dominate,
the film that sat over something goes with the sheets you removed, and cross-cutting order
reorganises.

`atDepth(vein, d)` returns how present a feature is there — ramped at the ends of its range rather
than snapping — and where it sits, drifted by its dip. Two faces of one block share **under 75%**
of their features.

Extent is sized to what a thing *is*: a fracture plane runs through much of the block, a crystal
grain occupies a sliver.

## 9. Visibility has a measured floor

Set on a 5×5 grid of width against contrast, read by eye, on a dark substrate (L\*=12.2).

- **The threshold law is `C ∝ 1/w`**, fitted **k = 1.03**. An eye and sub-pixel coverage maths
  agree to 3%, so "give back exactly what the gauge cost" *is* the threshold curve — the
  compensation terminates on its own rather than being a taste knob.
- **Below ~1.4px, authored width stops being a visible parameter.** A 0.70px vein at ΔL\*6 and a
  1.375px vein at ΔL\*3 have peak contrasts of 4.20 and 3.00 but **identical** supra-threshold
  widths, 1.03 and 1.04px. A 2× gauge difference is invisible.
- **So tier identity changes axis with footprint.** Gauge carries it when spread out; contrast
  carries it when compressed, because gauge collapses. "Strengthen contrast, never width" is then
  not merely the safe choice — it is the only one that works at card scale.
- **Sub-visual is not a defect.** Real marble carries structure some people see and some do not.
  A tier you *rely on* to read must clear the floor; content below it is texture, and is only
  dropped for aliasing.

## 10. The empty must be empty

Veiling is multiplicative. A sheet whose blank areas sit at 0.02 instead of 0 becomes visible fog
once several stack, and it degrades gently enough to read as a bad palette rather than as a bug.
Measured across six sheets: **0.00022** of full ink, below one 8-bit step.

Haze that is wanted is added **deliberately** as `film`, graded by depth and drifting across the
slab from a seeded origin, so two cards of one stone are not the same picture. Accidental veiling
cannot be removed; a film is a token.

## 11. Two levels, and the theme owns colour

His ruling, and it decides what the control surface is:

| | question | output |
|---|---|---|
| **level 1** | what this stone **is** | a definition for `STONES` — change one and it is a different stone |
| **level 2** | what **this surface** shows of it | a few numbers beside a stone's name — same stone, seen differently |
| **the theme** | what colour any of it is | tokens, as for every other surface in the panel |

`panel/stone-controls.js` holds that as data: every parameter with its kind, range, level and
one line of what it does. `tools/stone-studio.html` is a surface built from it, and
`tools/serve-studio.py` serves it (ES modules do not load over `file://`).

    python tools/serve-studio.py      #  localhost:8777/tools/stone-studio.html

The schema is data rather than a form for one reason: `test/stone-controls.test.mjs` reads the
generator's **source** and holds the two to each other in both directions. A parameter the
generator reads with no control fails; a control naming a parameter nothing reads fails too. A
schema that only had to be a superset would rot into one, silently — an unreachable knob is
indistinguishable from a knob that does nothing.

`rotate` is the one genuinely awkward member. It is read from the stone definition, because an
origin stone turns by rotating its entry **arc** rather than by spinning finished geometry — so it
is authored data used as an instance knob. It sits at level 2 anyway: "this slab went in sideways"
is a surface decision every time.

**The frame time is the tool.** The loop is tweak, look, tweak, so latency is not a nicety — it
decides whether the surface can be driven at all. Measured on Carrara at six sheets, 430px card
supersampled four times:

| | |
|---|---|
| generate | 7.1ms |
| resolve and bucket | 0.8ms |
| draw and composite | ~5ms |
| **median frame under a drag** | **13ms** |
| PNG encode | ~~214ms~~ removed |
| decode back | ~~48ms~~ removed |

262ms of the original 270 was a round trip: `sheetUri` PNG-encoded six canvases to 750KB of base64
so the studio could decode them straight back. That encode exists for CSS `mask-image`, which the
studio never uses. `sheetCanvas` is the primitive now and `sheetUri` a wrapper on it, so anything
compositing to a canvas takes the canvas. A test holds the studio to asking for one.

**Hold and flip.** The question a control surface is actually asked is not "is this good" but "is
this better than the last one", and the answer arrives in the moment of the swap. **Hold** keeps the
current stone, **Flip** (or space) swaps against it, **Restore** carries on from it. Both sides are
kept as finished pixels rather than as parameters to re-render, because re-rendering on the swap
turns a blink into a wait and the comparison is lost in the wait. The held readout and block text
flip with the picture — a held image beside live numbers is worse than no comparison at all.


**The studio shows the three things that fail silently**, because none of them raises anything:

- **majors in frame** — the empty-stone guard, live. Under 30% and it says the entry arc and the
  grain disagree.
- **short, per tier** — how far each tier sits from the visibility floor, as a multiple of
  it. ×1.00 is the floor exactly, so anything under 1 is being generated and not seen. A tier
  that is *entirely* short is not faint, it is **absent**: it costs its full generation time and
  contributes only haze. Shipped Carrara reads major ×1.33, minor **×0.45**, subminor
  **×0.63**, micro ×1.34 — its whole middle is invisible, because the wash is four times
  the stroke. A count alone said a tier was in trouble; the ratio says which way to turn the knob
  and when to stop.
- **this cut, of all** — how much of the block the depth window kept.

## 12. In the panel

ONE MATERIAL, PANEL-WIDE. His ruling: this is a TH—E, not a room's flooring, so unlike VA there
is no per-tile material and no second slab to reconcile with the first. That turns one slab into
the correct model rather than a compromise, and it is what makes the rest of this cheap.

The theme picks it: **Stone**, **Vein colour**, **Vein strength**, **Where**. The stone list is
derived from `STONES`, so adding one to the table makes it appear in the theme tab.

**A PLATE AND A BACKGROUND ARE DIFFERENT DRAWINGS OF THE SAME STONE**, and that is the whole
design. A background has no neighbours, so it is simply scaled to fit — nothing to agree with,
nothing to seam. A plate sits beside other plates, and its gauge has to agree with theirs.

Getting the plates right took three tries, each judged on screen:

| | gauge | seams |
|---|---|---|
| `mask-size: cover` — scale the slab into each tile | **wrong** — a 6x2 and a 4x5 plate read as different materials | none |
| fixed size, RANDOM per-tile offset | right | **hard seam inside a single plate** |
| fixed size, the tile's OWN GRID OFFSET | right | one continuous wrap across the wall |

The third is the one he named: render the material underneath and cut the plates out of it. Every
tile paints the same slab at the same size, offset by where that tile sits on the grid, so a vein
leaving one plate arrives in the next. The wrap is still there and is now what tiling a floor from
one slab actually looks like, rather than a glitch.

Rows are fixed at 64 + 8, so the vertical offset is exact arithmetic. Columns are `1fr`, so their
width is measured once by a `ResizeObserver` and published as `--db-col`.

The wear masks scale to fit and get away with it, because a blob has no width to disagree about.

**One slab for the whole panel**, cut per tile. The masks are published as variables on the host
and every tile references them: inlining a data URI per tile puts the same 180KB on screen twelve
times. Measured at 900x700, once per theme change: 368-817KB and 128-421ms. A slab big enough
never to wrap at all (1400px) costs 1.2-2MB and up to 1.7s, which is why it wraps.

Stone paints UNDER wear, because a plate is quarried and then it lives.

**The colour model is Vacuum Agent's, and that is where its power comes from.** Every property is
a MASTER plus a signed per-tier OFFSET, never an independent absolute:

    opacity  clamp(0%, calc(master + offset), 100%)
    blur     max(0px, calc(master + offset))
    colour   oklch(from master calc(l + light) calc(c * chroma) calc(h + hue))

So the master rides all four tiers at once and the offsets keep the RELATIONSHIP between them.
Four absolute colours would have to be re-picked together every time the master moved, and the
stone would stop being one stone.

The point of it, in VA's own words, is ATMOSPHERIC PERSPECTIVE: a finer tier recedes on all three
axes at once — fainter, softer, hazier colour — so it reads as DEPTH rather than as a second vein
system arguing with the first. That is why the colour is DERIVED rather than chosen. A lighter,
less saturated, slightly shifted version of the same ink is a vein further away; an unrelated
colour is a different mineral. Measured on Calacatta, the four tiers come out:

| tier | L | C | H |
|---|---|---|---|
| major | 0.479 | 0.0473 | 75.9 |
| minor | 0.509 | 0.0388 | 78.9 |
| subminor | 0.529 | 0.0331 | 80.9 |
| micro | 0.549 | 0.0284 | 81.9 |

Opacity and blur default to NO offset, because the generator already recedes the fine tiers itself
— BTwashBT is 7px on minor and 9px on subminor — and a second recession on top double-counts it.
Colour recession has no counterpart in the generator, which emits relative contrast and no colour
at all, so it carries a mild default.

Addressing a tier at all needs the masks SPLIT BY TIER, because a mask says where and how much: a
tier sharing a mask with three others cannot be given its own colour and cannot be taken away.
That costs 1.6-2x the bytes and up to 2x the time, measured, so the panel only splits once a tier
offset is actually in use.

---

## Traps

Each of these shipped, was measured, and was fixed. They are here because every one failed
**silently**.

**An origin that disagrees with the grain empties the stone.** An origin on one edge with a bias
pointing at that same edge sent every vein straight back out — **0%** of majors reached the frame,
and nothing errored. Two fixes: origins now *aim* at a point inside the stone (launching along the
inward normal only managed 20% against 74% for plain box seeding), and the grain heading is
**derived** from the origin by mirroring it through the centre. A derived heading cannot contradict
its origin. Guarded by a test that fails if any arc empties the stone.

**`aimDrift` is a global angle, so its sign flips with the entry side.** A left entry drifting down
and a right entry drifting down are opposite chords. Without the flip, half the entries clipped a
corner instead of crossing.

**Band siblings were hooked at the end.** The offset took its direction from vertex *k* to *k+1*,
and at the last vertex *k+1* clamped to itself — zero-length direction, zero offset, so the final
point snapped onto the parent. With wander at 0, plain majors measured 1.00000 straight and
siblings 0.98026; that gap is what gave it away. `ribbonPolygon` looks backward at the last vertex
for the same reason.

**A hardcoded launch jitter swamped `coherence`.** `walk` added ±0.06 turns unconditionally — a
spread of 12.5° on its own — so a stone asking for parallel strokes could not get below 13° however
high its coherence went. Now scaled by coherence: 14.3° → 5.0°.

**Rotation over-compensated.** Scaling counts by the full seed-box area ratio left a rotated
box-seeded stone **27% denser** than an upright one. A stone *with* an origin now rotates by
turning its entry arc instead, because spinning finished geometry swings the entry off frame.

**A mask drawn as luminance is opaque everywhere.** `sheetUri` emitted white-on-black, which reads
well to a human and is useless to both consumers: CSS `mask-image` takes **alpha** unless told
otherwise, and a canvas compositing one has to convert every pixel first. The first thing that used
it filled the whole surface with ink and drew a flat grey rectangle. Sheets are alpha now, which
also makes "the empty must be empty" literal rather than conventional — transparent contributes
nothing under any blend, where a black that is 0.02 off still veils.

**The generator could only be reached by name.** `stoneArt` looked its stone up in `STONES`, so
anything wanting an ad-hoc definition — an override flag, an authoring surface — had to overwrite a
table entry, generate, and put it back. It worked, and it was a landmine for anything that ever
generated two stones at once. It takes a definition now, and `_dir` is written onto a copy: handed a
caller's object, that had been writing a grain field into the caller's own state and then into
whatever got saved from it.

**A backtick in a CSS comment ends the stylesheet.** The panel's CSS is a template literal, and a
comment explaining a rule in `backticks` closes it. What follows parses as JavaScript, so the error
lands hundreds of lines away on a word like `mask`. `node --check` does NOT catch it — it falls back
to a CommonJS parse — and the repo's existing imports test, which loads every module for real, did.

**A test that greps source keeps matching the comment that explains it.** Three times now. The
studio's canvas check passed with the option deleted, because a comment four lines above quoted
the option while explaining why it was there. Then the panel's `mask-size: cover` check failed while
the CSS was correct, because the rule is commented with the thing it must not do. It is fixed in
the helper that extracts a rule, not in each assertion, because the next one will do it again.


**A module that throws while evaluating renders a blank page.** The studio is 600 lines of module
JavaScript that nothing else loads, and a parse error logs one line and draws nothing — which is
indistinguishable from a tool that has not finished loading. A stray newline inside a string literal
sat there through several reloads while every symptom pointed at the render. `panel/test/stone-studio.test.mjs`
compiles the script and checks every name it imports is really exported.

**requestAnimationFrame does not fire in a hidden tab.** Coalescing renders to one per frame is
right, and it meant the studio opened in a background tab and sat blank until it was both looked at
AND touched. It falls back to a timeout while `document.hidden`.

**A test that greps source can match the comment explaining it.** The check that the studio asks for
canvases rather than data URIs passed with the option deleted, because four lines above it a comment
quoted the option while explaining why it was there. It reads the de-commented body now. This is the
third time a test here has passed by finding the wrong thing; the ablation is the only reason any of
them were caught.


**Positional ids re-rolled untouched tiers.** Ids that ran off the combined array index shifted
whenever an earlier tier's count changed, re-seeding the width substream for every later tier. Ids
are per tier now, so pushing the micro population up leaves every other tier byte-identical.

---

## What is not built

- **Nothing is wired into the panel.** The next step is a substrate layer on a tile; today a plate
  is a flat `tile-surface` and everything paints over it. The studio proves the browser half of the
  path works — `stone-raster.js` had never run against a real canvas before it.
- **Anisotropic blur.** A pencil point gives sharp lines, its edge gives spread, a flat eraser
  gives smear. Every blur here is a circular Gaussian — a pencil held perfectly upright at all
  times.
- **The material panel itself.** The studio is a dev tool served off disk; a tab inside the panel
  is not built. `stone-controls.js` is the seam it would read, so it should cost a renderer rather
  than a redesign. Two controls still want better than a slider: `origin` wants the perimeter
  diagram, and `aim` changes what the other Entry controls mean.
- **Jade, granite, breccia.** Reachable — jade came out of VA's marble masks with a palette change
  and a 32px blur, which also proves a heavily blurred line network *is* a field, so no separate
  field primitive is needed. Breccia wants the closed-polygon primitive the crystals already use.

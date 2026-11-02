# The tiled floor — what it costs, and why it cost that

A floor is the slab cut into a repeating pattern and laid. Three paths reach pixels and only one of
them was expensive, which is why this went unnoticed: the studio feels fine.

| path | how it got pixels, as written | paid the cost below |
| --- | --- | --- |
| studio preview | `drawTiles` → `drawTilesTo` with no callback → blit from the painted offscreen | no |
| PNG and kit export | `renderFloor` → paint the slab once at `min(W, 8192)`, then blit | no |
| **TIFF master** | `exportTiff` → `renderFloorTile` → **paint once per piece** | **yes** |

`drawTilesTo(F, tc, px, direct, only)` takes the per-piece painter as its fourth argument, and
`renderFloorTile` is the only caller that passes one. The other two blit out of a slab painted once.

> **SUPERSEDED IN PART, 2026-10-31.** Every path in that table built the floor **piece by piece**,
> which is what all three did when this was written. An ordered floor is no longer built that way: it
> is a cut pattern stroked over a finished slab tile, cheaper than any number below and not the same
> picture. What still describes live code is the pool, the canvas kind and the instruments. The
> windowing and one-paint sections are how it got here, kept because the measurements are the
> argument. **The live answer is the last section: [the cut](#and-then-the-cut-replaced-all-of-it).**

## The cost was a law, not a number

Measured on `gallery/slabs/Hero_Psyker.json`, `harness/floor-cost.mjs`, before the change:

| width | tile | pieces crossing the tile | floor tile | slab tile | ratio |
| --- | --- | --- | --- | --- | --- |
| 8,192 | 2048 | 17 | 6,318 ms | 367 ms | **17.22×** |
| 2,048 | 2048 (one tile = the whole picture) | 134 | 38,800 ms | 325 ms | **119×** |

**A floor tile cost (pieces crossing it) × a slab tile.** Per piece that is 372 ms at 8,192 against
367 ms for the whole tile painted once, and 290 ms at 2,048 against 325 — within 1.4%. The driver
varied eight-fold between the two rows and the ratio tracked it both times, so this is the
relationship rather than one sample.

The reason is in `renderFloorTile`'s own comment: `paintContent` writes its raster with
`putImageData`, which by specification ignores the clipping region, so each piece painted the WHOLE
scratch canvas and the clip then discarded everything but its polygon. Painting was **98.63%** of a
floor tile, and the pieces tile the plane, so the work was N times the pixels that reach the file.

## Each piece now paints its own window

`drawTilesTo` already computed each piece's bounding box for the cut-section case; it now passes it
to the callback, and `renderFloorTile` paints a canvas of that box instead of the whole tile.

**The transform is unchanged** — same scale, same origin, same shift. Slab coordinates are kept,
which is the condition under which the repo had already measured a windowed paint pixel-identical to
cropping one out of a full render. `woodRect` bounds its fill by the canvas it is handed, so the
painter needed no change: it was written window-aware.

**The box is padded by the tile's own `bleed`**, which is `coatReach(bs)` — a max over
`blurReach(coatRadius)`, `blurReach(maxAdjBlur())` and `shadowReach(6 * maxGlow())`. Using the tile's
own answer rather than a new constant is what keeps a windowed piece and a whole tile agreeing.

**The scratch is resized for every piece even when the size has not changed.** The cheaper spelling
is to `clearRect` when it matches, and that hands one piece a context its neighbour has already drawn
through while a piece whose box differs gets a fresh one. Nothing leaks state today, but "fresh or
inherited, depending on whether the previous piece happened to be the same size" is a difference that
only ever surfaces as an irreproducible one.

### What it bought

Same slab, same tile, same 17 pieces:

| | before | after |
| --- | --- | --- |
| floor tile | 6,318 ms | **701 ms** |
| floor ÷ slab tile | 17.22× | **1.87×** |
| painting share of a floor tile | 98.63% | **96.2%** |

**9.0×**, and painting is still almost all of what is left — which is the opposite of what this
document said when it was written.

**CORRECTED 2026-10-31.** The first reading here was **−3.17%**, taken from
`tools/make-probe-builds.mjs --only=ablate` and reported as "the ablation can no longer find any
painting to remove". That was the instrument failing, not the work vanishing. The ablation caches one
painted canvas and blits it for every call after, **keyed on canvas size** — and windowing gives every
piece its own box. Counted on the key the tool actually uses: **19 calls, 18 distinct keys, one hit.**
It ablated nothing, so the ablated arm was the full arm with a rounding error, and the negative sat
inside the run-to-run spread exactly as a null does.

Re-measured with the same bargain and a key that can hit — one cache, blitted *scaled* to whatever
size the caller asks for, so byte volume survives in every piece and per-piece painting does not:

```
              full      ablated   painting share
slab tile    370.1 ms     58.0 ms     84.3%     <- known cell; the repo's own ablation reads ~90%
floor tile   730.8 ms     27.5 ms     96.2%
```

A **timer around `paintContent` is not an alternative** and was tried first: it reads 5.2% on that
same slab tile, because stone paints by issuing canvas commands that the browser rasterises lazily,
so the time spent inside the function is command submission and not the work. The known cell is what
caught it — a probe that disagrees with a measured answer by 17× is the probe.

## It is not the same picture, and that was ruled

`harness/floor-window.mjs`, ten cells at 8,192, the middle tile, interior only, against the build
before the change:

| pattern | in order | shuffled |
| --- | --- | --- |
| rhombus | 2.651 / 32 | 2.052 / 47 |
| hex | 2.537 / 30 | 3.189 / 35.7 |
| cairo | 3.632 / 34.7 | 3.311 / 39.3 |
| herringbone | 3.293 / 36 | 4.264 / 48 |
| subway | 3.023 / 36 | 2.437 / 26 |

*mean / max, in levels of 255. Between 46% and 61% of pixels move by more than one level.*

**Padding does not close it, and that is how the cause was found.** The repo settled the equivalent
question for the drawn glow by sweeping bleed; the same sweep here is flat:

```
pad     4      64     256    1024
mean    2.052  2.061  2.061  1.845
```

Flat from 4 px to 1,024 means it is not a reach that a bigger box would capture — **the paint depends
on where in the device the canvas sits.** The drawn glow was ruled out separately, with `?bloom=blur`
verified to actually reach the page before the null was believed. The remaining candidate, not
measured, is the painter's per-fill dither, which `stone-gpu.md` records as 7.029 RMS of local
contrast against the shader's 0.341: keyed to device pixels, moving the box re-dithers what is inside
it.

**Ruled 2026-10-31: accept it.** The standing precedent is the GPU path, whose ~1.5 mean gap against
the CPU painter was accepted on 2026-10-29, and the engine gate, which takes 7.919 between Blink and
Gecko. What is NOT the same as those is that this is one renderer changing its answer for the same
inputs, so every master rendered before BUILD 2026.10.31.268 was laid the other way.

Correctness is unaffected and `harness/floor.mjs` says so on the windowed build: joins 0.004–0.010,
a re-rendered tile identical to itself (mean 0, max 0), and the shuffle-versus-guide control firing
at 15.46 over 96.8% of pixels — the positive control that proves that gate has a question to answer.

## And the pool takes it now

`poolWhyNot` and its boolean twin `corePaintsThis` both opened with `!layTiles`, because the
serialised worker core had neither `drawTilesTo` nor `renderFloorTile` in its function list. A floor
master therefore ran single-threaded while a slab master got twelve workers. Both travel now.

**What the core gained.** The floor's functions in the `fns` list, and in the preamble the things an
object cannot ride that list as: `PATTERNS` is emitted as source, because the list serialises each
value with `toString` and an object stringifies to `[object Object]`. `CAIRO8`, `GROUT` and
`SLOT_INK` are JSON. `T` travels in both pool inits and is declared beside `layTiles`.

**What it deliberately did not gain.** `stoneSource`, `sectionOf`, `cutScale` and `coverSrc` are
**throwing** stubs. They serve the blit branches, and a pooled tile always supplies `direct`, so it
never reaches one; a stub that returned a plausible value instead would turn an unreachable branch
into a picture that is merely wrong. `sectionList` is the exception and returns `[]` — `drawTilesTo`
and `stageN` genuinely call it on every floor tile — and that empty list is true **by construction**,
because any section at all now refuses the pool, not just a cut one.

Two things fell out of reading the path rather than from the goal:

- **`drawScaleBar` was called at the end of `drawTilesTo`, unconditionally.** It draws into the
  studio's `ctx`, not into the target beside it, so it was repainting the studio's own scale bar as a
  side effect of writing a file — and it reads `Wc`, `V.z` and `dpr`, none of which exist in a worker.
  It belongs to the path that is drawing the studio, and is now there — in `drawTiles`, which has
  since gone with the per-piece floor, and after it in `draw` itself.
- **`stoneSource` painted a 1,600 px slab offscreen even when every piece is painted directly.** That
  is work nobody collects, and it is what dragged `renderStoneOffscreen`, `syncBuild` and
  `holdingBuild` behind it. Now conditional on something actually reading `stoneC`.

## The canvas kind, which is what a pooled floor really cost

A pooled floor tile came back differing from the sequential one by 110,762 pixels of a 4,104 tile, up
to 189 levels. None of it was the core, the serialisation or the lift list. **A DOM canvas
antialiases a clip edge and an OffscreenCanvas does not**, and a worker shims
`document.createElement` to `new OffscreenCanvas`, so the two threads drew different edges:

```
pooled vs sequential                      110,762 px (0.6576%)  max 189
DOM vs OffscreenCanvas, ONE thread        110,787 px (0.6578%)  max 189
```

The second row is the same function, the same inputs, the same thread, swapping only the kind of
canvas — and it is the same number. A DOM canvas leaves `rgba(33,33,33,23)` on a clip edge where an
OffscreenCanvas leaves nothing.

**The floor is the only path that clips**, which is why this was never reachable before: `uv-pool`,
`window-pool` and `worker-finish` all assert a pooled tile is byte-identical to a sequential one and
all of them pass, because `renderOneTile` sets no clip and the two kinds then agree exactly.

**That is true of the tiles those three check, and not of every tile.** Measured 2026-11-01 while
adding `lens-pool`: walking all 40 tiles of a 256px grid at 2048, with the bleed the app's own
`coatReach` asks for (54px), **38 or 39 agree exactly and one or two do not** — a few dozen channels
at up to 4 levels, on tiles 2 and 8 of that grid. It is small, it predates the lens, and the lens
does not make it worse; it is why `lens-pool` asks a **differential** question instead of a
byte-identity one: every tile the two paths agree on *without* glass must still agree *with* it. A
gate demanding byte-identity across the whole grid would be red today for a reason that has nothing
to do with what it tests.

**It survives the cleanest measurement available.** On a freshly loaded page, with every sequential
render taken before any pool exists and the pooled tiles asked for in ascending order with none
skipped, one tile still differs. The pixels are in the tile's INTERIOR, not its bleed, so they would
reach a master: a compact 30x61 patch, mostly +1 on a single channel, max 4.

**IT IS THE COAT'S BLUR, AND IT IS NOT BIT-REPRODUCIBLE RUN TO RUN.** Attributed 2026-11-01 by
ablation rather than by argument:

| | |
| --- | --- |
| `subsurface 0, specular 0` | **four consecutive pool walks clean**, and the bleed drops to 12px |
| `subsurface 2, specular 0` | 3 of 4 walks dirty — tile 2 at 50 channels, max 4 |
| `subsurface 0, specular 0.75` | 4 of 4 walks dirty — tile 2 at 13 channels, max 6 |

So it is not one stage: it is what those two share, which is a blur laid through `ctx.filter` onto a
scratch canvas and composited back. **The affected AREA tracks the blur radius** — 7, 53, 50 and 101
channels at subsurface 0.5, 1, 2 and 4, where the bleed those settings ask for is 26, 35, 54 and
91px — while the per-channel magnitude stays put at mean 1-2 and max 4-6. A wider blur spreads the
same hair's-breadth disagreement over more pixels rather than making it worse.

**It is nondeterministic, and discretely so.** Five identical walks of one slab on one page read
`clean`, `8`, `2+8`, `2+6+8`, `2`. But when a susceptible tile is dirty it is dirty by the SAME
amount every time — tile 2 is 59 channels at 4 levels, or it is exact — so each tile has one
alternative rendering rather than a spread. That is a branch being taken differently, not noise, and
the likeliest branch is the one Skia makes about how to execute a canvas blur. Inferred, not proved:
no ablation here reaches inside `ctx.filter`.

**Nothing to fix, and there is precedent for saying so.** `docs/final-render.md` already attributes
the cross-engine differences to *gradient and blur quantisation* inside the blooms, and the GPU-vs-CPU
coat gap was ruled accepted on 2026-10-29 for this same stage — `applyCoat`'s subsurface pass is a
high-pass, so it is the part of this renderer most sensitive to a sub-level difference in what it is
handed. At 13 to 101 channels of a 132,496-pixel tile, this is 0.01% to 0.08%.

Ruled out on the way, each by measurement: not the lens (present at lens 0, and the lens leaves the
difference alone or shrinks it); not the modulator bitmaps the pool ships its workers (persists with
clouds, bands and breccia all at 0); not the pool's WIDTH (the same width 8 gives clean and dirty
runs); not a DOM canvas against an OffscreenCanvas (`renderOneTile` run with `document.createElement`
shimmed to return an OffscreenCanvas, exactly as the worker preamble shims it, was byte-identical to
the DOM-canvas render); and not the sequential path drifting (two full passes of 40 tiles with no
pool in existence, 80 renders, zero drift).

**THREE WAYS TO MEASURE THIS WRONG, each of which cost a wrong answer on the way to `lens-pool`.**
Any future pooled-against-sequential comparison meets all three:

- **Ask for tiles in ascending order from 0, skipping none.** The pool answers no other order. Ask it
  for tile 3 before 0..2 and it returns no bitmap, so the caller dies inside `drawImage`; ask for
  tile 0 and then tile 2, skipping 1, and tile 2 comes back **59 channels different at 4 levels**
  from both the sequential render and from a pool asked for tile 2 *alone*, while 0,1,2 in order is
  exact. A gate that sampled a few tile indices would be measuring the pool's bookkeeping rather than
  its painting. `po.tile(i)` is also one-shot per index: asking twice throws.
- **Take every sequential render before any pool is built.** A main-thread `renderOneTile` taken
  straight after pool activity can come back **59 channels different at 4 levels**, where the render
  after *that* heals back to the value every render before the pool gave — so the pooled tile was
  right and the sequential one beside it was the odd one out. It did not reproduce on demand, so it
  is a timing interaction rather than a deterministic fault.
- **`FH` must be `round(W * H)`, and the tile size must divide both.** See `harness/lens-pool.mjs`'s
  header: mismatched heights put the lens's centre in two places and every pixel differs (99.99%,
  maxErr 188) on a sound build, and a partial last row makes the pool return a full-height canvas
  against the sequential path's clipped one.

`floorCanvas(w, h)` now hands both threads an OffscreenCanvas, falling back to a DOM canvas only
where there is none — and a browser without `OffscreenCanvas` has no pool either, so there is no
second path on that machine to disagree with. **Pooled against sequential is now 0 pixels**, with the
control firing at 60.4%.

**The picture cost is the floor's outer border and nothing else.** Interior tiles are byte-identical
between the two kinds: the same comparison on an interior tile at 8,192 reads mean 0.000, max 0.0,
and only a tile the border crosses differs at all — mean 0.019 over a whole 4,096 picture. Ruled
2026-10-31 after looking at both.

That zero is also the reason the claim is that narrow. An interior tile was measured first, came back
at exactly 0.000, and a null that clean on a difference known to exist is a sample that could not
contain it — the border had to be put in frame before the number meant anything.

## And then one paint for the whole tile

Windowing removed the redundancy but not the repetition: seventeen pieces still meant seventeen
paints, and a floor tile still cost 1.87 slab tiles for the same pixels.

Under `guide` it need not. `drawTilesTo` says so itself: *"Guide is the absent case on purpose: the
piece a slot is handed is the one cut at that slot, the delta is zero"*. The only displacement is the
grout spacing, so every piece's material is the slab's material a **bounded** distance away. Measured
over every instance, as a share of render width:

| | pieces | max shift | px @8192 | px @65535 |
| --- | --- | --- | --- | --- |
| guide, grout 1/32 | 139 | 0.106% | 9 | 70 |
| guide, grout 1/4 | 139 | 0.846% | 70 | 555 |
| guide, 6in tiles | 1048 | 0.297% | 25 | 195 |

So the tile is painted **once** over a box grown by that much, and each piece is a blit of that one
buffer at its own offset through its own clip. Shuffle and stack are not this: there the assembly
plan adds a delta that can reach anywhere in the slab, and a graft or a cut section takes the piece
off another board entirely.

**The offset is rounded to a whole pixel**, and that is the one thing it changes about the picture. A
fractional translate applied to vector drawing is exact; applied to a raster it RESAMPLES, and every
piece would come back softened. Rounding keeps the material crisp and puts the floor's spacing out by
under a pixel — sub-pixel on a 70 px spread at 65,535.

**It is guarded on area, not on mode.** The margin grows with the grout and with the render while the
tile does not, so the one-paint path is taken only while the grown box stays under **1.5×** the area
of the tile. The per-piece walk costs about 2× a single paint of the same area — 730 ms
against a slab tile's 370 — so the guard sits below where it stops paying rather than at it.

### What it bought

| | per-piece | one paint |
| --- | --- | --- |
| floor tile | 730.8 ms | **349.1 ms** |
| floor ÷ slab tile | 1.87× | **0.96×** |
| painting share | 96.2% | 97.45% |

**A floor tile now costs what a slab tile costs.** Against where this started — 6,318 ms for the same
tile — that is **18.1×**. The painting share staying high is the point, not a leftover: it is one
paint now, and that paint is nearly all of it.

### The picture, and how the guard was proved

`harness/floor-window.mjs`, ten cells at 8,192, against the build before:

| pattern, in order | mean | max | | shuffled |
| --- | --- | --- | --- | --- |
| hex | 4.765 | 175.7 | | IDENTICAL |
| cairo | 7.031 | 178 | | IDENTICAL |
| rhombus | 7.424 | 178 | | IDENTICAL |
| subway | 8.246 | 177 | | IDENTICAL |
| herringbone | 8.252 | 177 | | IDENTICAL |

**Five differ, five are identical, and which five is the result.** Every shuffled cell comes back
byte-identical because shuffle takes the per-piece path in both builds; every in-order cell differs
because that is the path that changed. A single mean could not have shown that the branch fires
exactly where it is supposed to and nowhere else.

For scale, the engine gate accepts **7.919** between Blink and Gecko. Ruled 2026-10-31 on the worst
512 px crop the data could find: *"i cant see a diff"*.

The first attempt to show that crop was taken with `shuffle: true` and came back at mean 0.000 — a
configuration that structurally could not contain the change, read as a clean result. That is twice
in one session, and both times the zero was too clean to be believed.

## What this did NOT change

**`exp.gpu.floor` is no longer a flat refusal.** An ordered floor tile is one paint of one rectangle
— the same shape `renderOneTile` hands the shader — so the clause reads `layTiles && !floorAsCut()`,
and only the floors that are not a cut are turned away: a graft or a cut section, which takes the
piece off another board entirely, and a floor laid over more than one stage.

`floorAsCut()` has **two readers and one copy**: `gpuWhyNot`, to decide whether to offer the shader,
and `renderFloorTile`, to decide whether this tile is a slab tile with lines on it. It had a third —
`gpuPool`, which sized its slot buffers by the margin the grout opened — and that reader went with
the grout, because the box the shader fills is now the tile and its bleed and nothing more. One copy
is deliberate: `poolWhyNot` and `corePaintsThis` are a documented twin pair, a clause was added to one
and not the other earlier the same day, five lines apart, and a harness caught it rather than a
person.

`renderFloorTile` **throws** `floor/paint:not-a-cut` if a painter reaches the per-piece walk. Of
everything here that could go wrong, a CPU-painted tile inside a master that records `gpu` is the only
one that would not look like a failure, so it is the one made loud.

> **THE GPU BRANCH HAS NEVER EXECUTED.** Every gate above exercises the CPU path, because the machine
> this was written on reports `exp.gpu.noadapter` — WebGPU's API present, no adapter — so a shader
> cannot be run, measured or verified here at all. The wiring is reasoned from the code and gated on
> the CPU side only. It wants a real browser before it is believed, which is where the rest of this
> repo's GPU numbers were taken.

**A floor laid from sections still runs sequentially**, by the same argument the graft clause already
made: a section is a whole slab record and nothing ships one. The refusal still reports
`exp.pool.floor`, whose string reads "a tiled floor" — now less specific than the clause it reports.
Renaming it is fifteen packs of work and has not been done.

## The instruments

| | |
| --- | --- |
| `harness/floor.mjs` | the correctness gate — joins, re-render, and a positive control. Runs in CI |
| `harness/floor-pool.mjs` | a pooled floor tile against the sequential one, byte for byte, plus the refusal in both directions and a control |
| `harness/lens-pool.mjs` | the lens through a worker: every tile the two paths agree on without glass must agree with it. Runs in CI with all three ablations |
| `harness/floor-cost.mjs` | the painting share, via the repo's own paint ablation. Asks what painting costs, never what a port would buy |
| `harness/floor-window.mjs` | the cross-build pixel differential. Needs `tools/make-probe-builds.mjs --only=ab`, so it is not in CI |

The last two open **a fresh page per cell**. The first version of `floor-window.mjs` reused one page
per build, and each cell then inherited what the last had left behind: the same comparison read mean
0.95 over 12.4% of pixels on a reused page and 2.05 over 48.7% on a fresh one. The contaminated
number was the flattering one, which is how it survived being read.

## Two things worth fixing that this did not

- **The app has two module-scope bindings named `T`** — the i18n translate function and the floor
  settings object — in separate `<script>` blocks, which is the only reason that is not a
  redeclaration. `check-worker-core` binds the i18n one, so it cannot tell the two apart in either
  direction: it reports that function's free names as the core's, and it would not notice the floor
  `T` failing to travel.
- **A registry entry in `check-worker-core` can rot while staying green.** `sectionList` was recorded
  as "only a graft reaches it"; `drawTilesTo` and `stageN` then started reaching it and the status
  stayed `known`. The gate *did* print the new callers beside the name — nothing compares a recorded
  reason against the callers it was written for.

## And then the cut replaced all of it

Everything above makes a floor tile cheaper to **build piece by piece**. A master then came back flat
acid green, and the reason was that a floor built that way is not the slab it was cut from at all.

Measured on `storm treeline v21 green test` at W 512, cairo 36in, square edge, against the same slab
rendered whole:

| | saturation | luma |
| --- | --- | --- |
| slab, subsurface 0 | 1.9 | 44.9 |
| floor, subsurface 0 | 6.3 | 72.8 |
| slab, subsurface 2 | 12.6 | 51.7 |
| floor, subsurface 2 | **124.7** | 121.6 |

**With the subsurface off the floor was already 62% brighter than the slab**, so the per-piece walk
never produced the slab's picture; the subsurface is a high-pass and multiplied that gap eleven-fold.
Neither the piece count (58 pieces and ~1,000 both read ~124) nor the edge finish (tumbled 124.4,
square 124.7) moved it, which is what ruled out the seams and the chamfer in turn. Two other
mechanisms were proposed and measured **wrong** first: coating before the cut made it worse
(122.9 → 135.8) and the bevel made no difference at all.

**The fix was the author's own model of the thing** — *"it's a cut pattern on a slab"*. Render the
slab tile, the whole pipeline, ground and content and coat; then stroke the cut geometry over what
comes back. The pieces fit, so there is nothing to spread, nothing to displace, nothing to re-sample
and nothing to coat twice, and the floor's subsurface is the slab's **by construction** rather than by
agreement. `renderFloorTile` opens on `floorAsCut()` and hands an ordered floor straight to
`renderOneTile`; `cutOverlay` strokes every piece polygon as a hairline and finishes its edge.

Saturation on that cell: **124.7 → 16.4**, against the slab's own 12.6.

**What went with it, as settings and not only as code paths:** grout, kerf, shuffle and off-the-stack.
Shuffle and the stack were the only reason a piece's material ever came from somewhere else, which is
what made a floor a separately-built picture; grout and kerf were the only reason a piece was ever
laid anywhere but where it was cut. A slab saved with any of them loads and renders as an ordered cut
— the fields are simply not read. The joint is a hairline at 1/32 in, floored at one device pixel so
it never vanishes, which is what the preview always fell back to when grout went sub-pixel anyway.

Two paths were coating-blind and are fixed in the same pass, because a cut is only cheap if the thing
under it is finished: the studio preview returned before `applyCoat` whenever tiles were laid, and the
PNG and kit path blitted out of `renderStoneOffscreen`, which calls `paintContent` and never
`applyCoat`. A PNG of a floor came back with no subsurface, no specular, no emission bloom and no
lens while the TIFF beside it had all four.

### What this made dead, and what finding it cost

| gone | was |
| --- | --- |
| `floorOnePaint`, `floorMargin`, `ONE_PAINT_MAX`, `FLOOR_SRC_MAX` | the one-paint machinery above |
| `assemblyPlan`, `drawTiles`, `tools/probe-assembly.mjs` | the assembly, and the probe that held it |
| `t.shift` | still produced, and now identically zero in every pattern |

That last row is why `probe-cut-section.mjs` had to change rather than simply pass. Thirteen of its
seventeen claims turn on the shift, and with the shift zero every one of their ablations came back
**STILL CLEAN — the check cannot fail**, which is the sound a dead check makes. They run against a
built contrast now: `spread`, which pushes `floorPitch` off 1 the way a grout used to, so what they
assert is that the `poly - shift` subtraction is present and correct the moment a floor is laid
anywhere but on its own cut. All seventeen bite again, 47 to 6,142 caught per ablation.

**That probe is also how a red CI went unnoticed for three commits.** It is a CI step and not a
`check-*.mjs`, so the sweep this repo's own `CLAUDE.md` recommended — a glob over `tools/check-*.mjs`
— could not see it, and it had been failing since the settings were removed. The gate list is the
named `run:` steps, which is what the sweep in `CLAUDE.md` now reads.

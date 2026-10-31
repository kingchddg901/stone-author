# The bleed is what a blur costs, and it grows with the picture

A tile cannot blur what it cannot see. Every blur in the coat therefore forces each tile to paint a
margin of its neighbours — the **bleed** — and then throw that margin away. The margin is not a
constant: it is set by the blur radius, and the coat's blur radius is a fixed *fraction of the
picture*, so the bleed grows with every render size while the tile does not.

This page is about what that costs, measured on a real slab, and about the alternative added on
2026-10-30: lighting features from their **geometry** instead of from a blur, which needs no
neighbours at all.

Read [`capabilities.md`](capabilities.md) for where the coat sits in the draw order, and
[`stone-gpu.md`](stone-gpu.md) for the shader. The coat runs on the **CPU in both renderers**, so
nothing here is a GPU feature.

## Where the number comes from

```
coatRadius = max((2 + 3*ss) * bs, (1 + 2*ss) * bs)      bs = W / COAT_REF,  COAT_REF = 1000
blurReach(r) = max(ceil(1.5 * floor(r*3*sqrt(2pi)/4 + 0.5)), ceil(3*r))
bleed = max(blurReach(coatRadius), blurReach(maxAdjBlur()), shadowReach(6*maxGlow())) + 4
```

`(2+3ss) − (1+2ss) = 1+ss`, always positive, so **the wider blur always wins** and it is the one
inside the `difference`. That matters: the wide blur is the *selector* — the low-pass term of the
feature high-pass — and the narrow one is cosmetic, softening the lift on its way back in. The bleed
is spent entirely on the clause that produces information. There is nothing to reallocate.

At `subsurface 0.9` the radius is `4.70 * bs`, which is **0.47% of the picture width** at any size.
Measured across masters: 154/32768 and 308/65535 both give 0.0047.

| width | sigma | bleed | tile 2048 surface | painted / delivered |
|---|---|---|---|---|
| 16,384 | 77 | 236 | 2520² | 1.51× |
| 32,768 | 154 | 467 | 2982² | 2.12× |
| 65,535 | 308 | **929** | 3906² | **3.64×** |

At 65,535 a 2048 tile paints a 3906 square to deliver 2048. **73% of every painted pixel is
discarded.**

## What that cost, on v21 at 65,535

Four times the output pixels came in at twenty-seven times the wall. It decomposes exactly:

```
27.0x  =  6.86x  more painted pixels       bleed 467 -> 929, tile forced at 2048
       x  3.93x  slower per painted pixel  150.7 -> 38.3 Mpx/s
```

**The second factor is not memory bandwidth.** That is what [`stone-gpu.md`](stone-gpu.md)'s tile
ladder concluded and it does not transfer here — its sweep ran at 65,535 **UV**, where sigma is 0 and
there is no coat blur at all, on the CPU. Read on the box across the whole 254-second render:

| | mean | note |
|---|---|---|
| GPU utilisation | **87%** | ≥80% in 101 of 128 samples, peak 99% |
| CPU total | 31% | at a 1,418 MHz effective clock — the workers are waiting |
| DRAM read | 4.3 Gbps | **0.54 GB/s** on a desktop with tens available |
| GPU VRAM / dynamic | 3,617 / 959 MB | no VRAM exhaustion, no heavy PCIe spill at this tile |

The GPU is saturated and the memory bus is idle. `gpuOwn` reads **0.3 s** of that render because it
times the stone shader only — the busy GPU is canvas2d/Skia doing the coat blur, the one thing whose
sigma had doubled. A blur is GPU work in both renderers.

## The drawn boost

`?boost=1`, or the **DRAWN BOOST** checkbox under the Subsurface slider. Off by default.

`boostFeatures` re-draws each visible layer's own geometry under the transform the content was
painted with — what the metal mask in `applyCoat` already does, and granted no bleed there either,
because everything is drawn under the full-image CTM and the canvas clips what falls outside.
`coatRadius` drops the subsurface clause in the same breath, which is the only reason the bleed
actually falls; replacing the stage without that keeps the whole cost and changes only the look.

Measured at two widths, because one width cannot tell *small* from *stops growing*:

```
arm              sigma  bleed | sigma@16384  bleed@16384 | renderFull
(no flag)           10     33 |          77          236 | 3565ab4e9cef
?boost=1             0      8 |           0            8 | 770102c387cf
?boost=nonsense     10     33 |          77          236 | 3565ab4e9cef
```

The blurred bleed grows 7.2×; the boosted bleed does not move. An unrecognised value is
byte-identical to no flag, so a typo gives the shipped picture rather than a quietly different one.

**The order inside it is load-bearing**, and cost three attempts, none visible in a code read:

1. **Multiply after the mask floods the tile.** Canvas blend modes composite source-over, so a
   full-opacity `fillRect` through `multiply` yields `Co = (1-ab) + ab*Cb` and `ao = 1`: outside the
   coverage, where `ab` is 0, the result is **white at alpha 1** and the mask is destroyed. The
   subsurface stage runs those same two lines safely only because *its* scratch is opaque.
2. **`destination-in` inside the layer loop empties the scratch.** It applies per draw call, so each
   layer erases what the last kept, and the fills with no branch — base, clouds, bands, breccia —
   wipe the result to nothing. The tell was every colour hashing *identically*.
3. **Reversing to picture-then-mask loses bitwise identity.** Identical in exact arithmetic, not in
   8-bit premultiplied storage, because the mask then makes a second trip through `drawImage`.
   Skipping the multiply did not bring the hash back, which ruled out the tint and left the reorder.

So the tinted picture is built in `mmC` and the original operation is kept: coverage into `ssC`, then
`source-in` that source.

## They are different tools, not two prices for one effect

The subsurface's blur is a **selector**. `|orig − blur(orig)|` is ~0 across smooth cloud, so a tint
multiplied into it colours structure and leaves the field alone — a colour grade that selects
structure with nothing authored by anyone. The boost cannot reach that from the other side: coverage
is coverage.

| | subsurface | drawn boost |
|---|---|---|
| weights by | local contrast | geometry coverage |
| lifts a hair-thin branch | **harder** than a fat vein | the same |
| reaches soft edges with no geometry | yes | no |
| reaches the painter's dither (7.029 RMS vs the shader's 0.341) | yes | no |
| bleed at 65,535 | 929 | **8** |

Ruled by the author 2026-10-30, having seen both: *"things like that are worth the bleed in my
opinion but a light scale across the whole image not so much"*, and on the gap a mask would leave:
*"that last 20% might have a lot of what we need … i can pay the time when i want the effect"*.

That test reads back on a decision already made: [`emitter-bloom.md`](emitter-bloom.md)'s
`BLOOM_DRAW` removed a blur that was pure magnitude — a halo, no selection — costing **1,577 px** of
bleed at 65,535. A light scale across the whole image, exactly.

## The tile crossover inverts

65,535 × 40,959, same picture, same GPU:

| | tile 2048 | tile 4096 |
|---|---|---|
| **subsurface** | 4.2 min *(3.8 on a second run)* | **2.2 min** |
| **drawn boost** | **24.0 s** | 1.6 min |

With the blur, 4096 wins — it amortises a 929 px bleed over fewer tiles. With the boost, 2048 wins by
**4.0×**, because there is no bleed left to amortise and footprint is all that remains. That is the
tile ladder's own finding back in force, and it is why the ladder's conclusion failed to transfer
earlier: the boost puts a daylight render into the no-blur regime the ladder was measured in.

**The 4× is not work.** Painted pixels are near-identical between the two boosted runs — 2.726 G at
2048 against 2.705 G at 4096, overhead 1.016× and 1.008×. It is all footprint, which is the same
lesson as the `est` defect in the ladder comment: right per worker-second, wrong per render.

Best against best is **2.2 min → 24.0 s**, and the box is what makes that more than a speed number:

| 65,535, tile as shown | subsurface @4096 | boost @4096 | boost @2048 |
|---|---|---|---|
| physical memory floor | **63 MB** | 418 MB | **6,130 MB** |
| physical load peak | **100%** | 97% | 62% |
| `d3dDyn` peak — system RAM lent to the GPU | **7,513 MB** | 3,434 MB | **835 MB** |

63 MB free is one allocation from falling over. The blur's 142 MB tile surfaces drove 7.5 GB of GPU
spill across PCIe into a 16 GB box.

## The colour

`innerColour` is the colour light comes back out as. The subsurface multiplies its high-pass by it
before adding it back under `lighter`; `boostFeatures` multiplies the same token into the picture
before masking it. Default `#ffcf8f` — the literal that was hardcoded until 2026-10-30, so an unset
token paints exactly what every slab on disk already paints.

`#ffffff` **skips the multiply outright**, which is what makes "no tint" exact rather than rounded:
with it, `?boost=1` reproduces `770102c387cf` and the retired `?boost=screen` reproduced
`e85cc63a4673`, the untinted hashes recorded before the tint existed.

The key is deliberately not named for the subsurface — that stage is its first consumer, not its
meaning, and it has since picked up two more jobs: tinting the boost, and pulling a GPU render's
colour back toward the CPU's. It is also not named "inner light": `i18n/_glossary.json` warns that a
translator reaching for *"lit from within"* collides with the **back light**, a separate control and a
separate pass. And it carries no `...Glow` suffix, because `maxGlow()` scans `COL` for `/Glow$/` and
feeds what it finds to `shadowReach()`, where a colour coerces to `NaN`, reads as 0, and sits in the
bleed path looking deliberate.

It lives in `OVR`, so unlike the toggle it **is** saved with the slab and carried in every master's
`inputs`.

## What is known wrong

**The amount curve.** `boostFeatures` reuses the blur stage's `min(0.95, 0.9 * ss)` so the slider
would read the same, which was bad reasoning: the old stage draws a *high-pass* at that alpha —
mostly near zero — and this draws the whole picture through a coverage mask at it. At 4096,
`subsurface 0.9`: the old stage's **entire** travel from 0.9 to 2 moves `light.mean` 39.59 → 43.79,
while the boost at one setting moves it to 66.11. Six times the old range in a single step.

With a saturated tint a channel clips at `255/(1+a)`:

```
ss 0.2   a 0.18   clips above 216      ss 0.9    a 0.81   clips above 141
ss 0.4   a 0.36   clips above 188      ss 1.06+  a 0.95   clips above 131
```

Below the clip everything scales and the hue leans; between one channel clipping and the next the
lean is hardest; above them all it returns to flat white. The top half of the slider is **one
setting**, because the curve caps at `ss ≈ 1.06`. Accepted rather than fixed: the dramatic look uses
the subsurface and pays its bleed, and the boost is for the renders that cannot afford it.

**`screen` was tried and dropped.** `out = in + a*in*(1-in)` peaks at mid-grey and falls to **zero at
white**, so it protects highlights — and this subject *is* the highlights. It spent its lift on the
mid-grey cloud body and read duller and flatter. Ruled 2026-10-30: *"gain had is closer"*.
`?boost=screen` now turns the boost **off** rather than quietly meaning gain.

## The fog, and the moon

Recorded because the code reads as an invitation to remove it and the reason is not in the code.

1. **Fog is in the boost's mask**, and that is why coverage reaches the whole frame. The reference
   slab carries five layers at `bucket: 'fog'` and their blobs are field-sized, where a high-pass
   sees a smooth fog interior as ~0 and lifts only structure.
2. **It cannot be withdrawn, because the moon is a fog layer.** The ring is the subject. Dropping fog
   from the mask — a single argument at the `drawLayerArtifacts` call — loses it.
3. **A per-layer mask set would recover the selection and not the weighting**, and is ruled not worth
   building. The mask loop is already per *layer* rather than per bucket, and `metal` is the
   precedent for a per-layer scalar the coat reads, so moon-fog-in / weather-fog-out is a filter
   rather than a system. What no mask buys at any price is the contrast weighting.

Measured on a moon-only render at 32,768, and the sign flips: on the full picture the boost is
**brighter** (`light.mean` 63.19 → 96.03, +52%); with only the moon it is **dimmer** (1.47 → 1.29,
−12%). Contrast-weighting concentrates the lift on the ring's gradient; coverage-weighting spreads it
over the blob's whole disc, most of which is the moon's dark centre, where gain multiplies near-zero
by near-zero.

## The field route: the same stage, read from the whole picture (`?field=1`)

Added 2026-10-30. **Off by default**, and with the flag absent every path below behaves as it did
before it existed.

The subsurface's two blurs are both a fixed fraction of picture width — 0.80% and 0.50% at subsurface
2 — so the bleed it charges is **2.40% of W at every width**. That is what makes a large render
impossible rather than slow: at 1,048,576 the bleed is 25,170 px each side, so a tile canvas is at
least 50,340 px *however small the tile*, against an 8,192 texture limit and a 2^28 canvas-area cap.
`?tile=1024` and `?tile=4096` both failed at 1,048,576 with the same 50,340, which is the tell.

What the stage actually is, read in three steps: a low-pass at 0.80% of W; a **pointwise** rectify,
`|orig − that|`; and a second low-pass at 0.50% of W over the rectified result. Because the middle
step is an absolute value, what survives is not a band of the picture — it is the **local-contrast
envelope** of the fine detail, smoothed. Neither low-pass needs full resolution, and the pointwise
step needs no neighbours at all.

So `buildCoatField` renders a prelude at `FIELD_W`, performs those three operations over the whole
picture with the canvas's own blur, stores the result at `FIELD_PX` with a gain, and each tile adds its
own rectangle of it with a scaled `drawImage` and the original gain loop. No blur per tile, so
`coatRadius` drops the clause — `coatFieldUsable` is the single predicate both the bleed and the branch
ask, and `check-coat-field.mjs` holds them to it with sixteen ablations.

### Why 4,096, measured

Four regions of storm treeline v21 in picture-relative coordinates, envelopes taken from the masters on
disk rather than from a bench:

| pair | widths | gain | rms |
|---|---|---|---|
| `inputs 25bcafc6` | 4,096 → 32,768 | ×0.997 – ×1.002 | 1.3 – 1.4% |
| `inputs d22cd3d4` | 16,384 → 65,535 | ×1.005 – ×1.034 | 1.1 – 12.4% |

Against a floor of **0.00% exactly** for one picture rendered twice at one width and tile size, and
0.5–1.5% in the bright regions (up to 10.54% in the dim ones) for one picture under two different tile
sizes. Three octaves of width moves the field **less than changing the tile size does**.

It converges, and by 4,096. **2,048 is measured insufficient**: the busiest region climbs 4.951 →
5.979 → 7.432 from 1,024 to 2,048 to 16,384 — +24% over its last octave, well above floor — and is then
flat to 65,535. Below 4,096 the content is not resolved; 361 veins across 1,024 px are near a pixel
wide, and the rectified high-pass of a 1 px line is not the field a 16 px line with dither in it gives.

### What it buys, and the shoulder it does not reach

| W | bleed today | subsurface clause off | both off | `ew` @ tile 4096 |
|---|---|---|---|---|
| 262,144 | 6,296 | 1,577 | 4 | 16,688 / 7,250 / 4,104 |
| 1,048,576 | 25,170 | 6,296 | 4 | 54,436 / 16,688 / 4,104 |

Dropping the subsurface clause alone is **not sufficient**: `buildGlint` is the same
difference-of-blur at a quarter the radius, so it then becomes the wall — 6,296 at 1,048,576, a 16,688
px tile canvas, still past 8,192. A **glossy** slab therefore reaches 262,144 on the GPU with the field
on, not 1,048,576; a slab with `specular` and layer `gloss` at zero (which v21 is) has nothing left
charging and reaches 1,048,576. The glint's band was **not measured** and cannot be from anything on
disk — the glint exists only where gloss is non-zero, and there is no glossy render at two widths to
compare — so it is untouched on purpose.

### Verified end to end, and what came back wrong

storm treeline v21 at 16,384, stone, `state f1dbc011`, rendered back to back, the flag the only
difference:

| | control | `?field=1` |
|---|---|---|
| bleed (`needed`) | 2,520 → **236** | 2,064 → **8** |
| coat sigma | 77 px | *no blur in this render* |
| size | 52.8 MB | 52.9 MB |
| `light.mean` | 63.24 | **66.38** |
| render | 2.8 s | **7.6 s** |

The bleed falls and `inputs` moves, both as designed. Two things do not:

1. **It was brighter, and the cause was the painter.** The first version rendered its prelude through
   `renderSlabTo` — the CPU painter — while the tiles it fed were drawn by the shader. The subsurface
   is a high-pass, and [`stone-gpu.md`](stone-gpu.md) prices the two painters for exactly that: 7.029
   RMS of local contrast from the painter against 0.341 from the shader, twentyfold, from the painter's
   accumulated per-fill dither over 770 overlapping gradients. The field came back about four times too
   strong (its own trail read `mean 8.737`) and the picture rendered **+4.97% brighter** over 71.9M
   channels, 80.8% of them brighter against 3.9% darker.

   The 2026-10-29 ruling accepted that gap *between two renders*. This had put it *inside one*, which
   the ruling does not cover.

   **Fixed 2026-10-30: the prelude is drawn by the painter that draws the tiles.** `buildCoatField`
   takes the render's own choice and dispatches one 4,096 tile through `gpuPool` when the shader is
   painting — the pool wants only `{ts, bleed, rAcross, rDown}`, and 4,096 is a single tile well inside
   every limit the export has already cleared. It is **not** "always use the shader": a CPU render's
   CPU prelude was already matched, and forcing the shader would break the match the other way. The
   field records which painter built it, and the trail says so.

   Measured at 8,192, same state, the flag the only difference:

   | whole picture, 21.6M channels | CPU prelude | shader prelude |
   |---|---|---|
   | mean | +2.545 (+4.82%) | **−0.052 (−0.10%)** |
   | rms of the difference | 4.584 | **0.938** |
   | brighter / darker / identical | 67.2 / 4.5 / 28.3% | **7.9 / 9.9 / 82.2%** |
   | over 2 levels | 31.81% | **1.40%** |
   | over 8 levels | 8.72% | **0.26%** |
   | field's own mean | 8.737 | **4.836** |

   82% of channels land bit-identical and the bias is gone — 7.9% brighter against 9.9% darker is
   symmetric, which is what an approximation looks like rather than an error. What remains is the
   field's genuine cost: a 512-cell store and a bilinear upsample, 0.938 rms with a worst pixel of 29.
   The author's verdict on renders made with the route before this fix was already *very close to the
   same as the wide-bleed version*; this closes the measured gap behind that.

   `check-coat-field.mjs`'s `prelude-matches-the-render-painter` holds it, with five ablations. One of
   them is why that check is written as it is: the first spelling asked `includes('gpuPool(')`, and an
   ablation that left the identifier in place while neutering the call — `gp = await null && gpuPool(` —
   passed it. A present identifier is not a reachable call.

2. **The prelude costs a render, and where that pays has not been measured.** At 8,192 the field arm
   now takes 1.8 s against 6.9 s with the CPU prelude, because one GPU tile is far cheaper than a
   whole-image CPU render — but the per-tile blur it replaces is itself cheap at small sizes, and the
   saving only grows with the over-paint: 1.5× at 16,384, 51× at 262,144. `coatFieldUsable` currently
   engages anywhere above `FIELD_W`, which is lower than where the route starts paying. The crossover
   is an open measurement, not a tuned constant.

`FIELD_PX` is a URL knob rather than a constant for a stated reason: agreement was validated at W/256
cells and the default stores 512, which resolves the field's own smoothness (0.50% of W is 2.56 cells
at 512, only 1.28 at 256). Storing finer than the validation carries more of the true field and cannot
add error, but the agreement of that finer content is untested.

### The border band, and the one the control still has

Added 2026-10-31, after a column profile of a 65,535 A/B found every edge tile leaning positive
(+0.87 to +2.25) while the interior sat flat.

A canvas blur pulls in whatever lies outside its source, and outside is **transparent**. Measured on a
flat opaque grey at sigma 20, the blurred copy's alpha reads 130 at the edge, 155 at 5 px, 216 at 20 px
and reaches 255 only at 80 px — a band of **4 sigma**. The RGB is fine, because `getImageData`
un-premultiplies and hands back the correct average of the samples that exist. But `difference` is a
*composite*, and over an opaque backdrop it resolves to

```
a * |P - blur|  +  (1 - a) * P
```

so a short alpha mixes the **picture itself** back into the envelope. P's mean is ~65 against the
envelope's ~5, so the inflation reaches ~32 levels at the very edge. At the 4,096 prelude the band is
~131 px — 3.2% of the width — which upsamples to ~2,096 px at 65,535, almost exactly one 2048 tile.
That is why whole edge tiles lit up and nothing inside them did.

Forcing the blurred copy's alpha to 255 before the difference keeps the renormalised RGB and makes the
composite exactly `|P - blur|`. On a flat region, where the true answer is zero at every depth:

| depth from border | 0 | 2 | 5 | 10 | 20 | 40 | 80 |
|---|---|---|---|---|---|---|---|
| before | 34 | 32 | 29 | 24 | 15 | 6 | 3 |
| after | 1 | 1 | 1 | 1 | 1 | 0 | 0 |

The residual 1 is un-premultiply rounding and does not decay; it is the floor of the method. On a
*textured* interior the change is **exactly zero** — which is the shape the first test skipped, and
checking only the flat case is what made an interior figure look like it had moved when it had not.

**The narrow blur needs none of this**, and the asymmetry is not an oversight: its result is read with
`getImageData` rather than composited, so it already gets the renormalised average. Only a composite
is hurt by a short alpha, and only the wide blur is composited.

### What this exposed in the per-tile path

Measured over 540 interior tiles with the border excluded on **both** axes — excluding on one axis and
averaging over the other is what made an earlier reading of this wrong:

| pair | whole picture | border ring (100 tiles) | true interior (540) |
|---|---|---|---|
| control → field, before | +0.2461 | +1.4186 | **+0.0290** |
| control → field, after | −0.4692 | −3.0542 | **+0.0096** |

The interior agrees to **0.015% of mean**. The ring now reads −3.05, and that is the **control's** own
border artifact, not the field's: an edge tile is a 5202 px canvas with 1577 px of bleed, its blur's
artifact band is 4 sigma = 2096 px from the *canvas* edge, so it reaches 2096 − 1577 = **519 px into
the picture** — a quarter of an edge tile. The field no longer has one at all, so the difference is the
per-tile path being wrong there.

Left alone deliberately. Matching would mean reproducing a defect; repairing the per-tile path would
move every master ever rendered, which is the same trade the 2026-10-29 ruling weighed and declined.

## Reachable from

- [`capabilities.md`](capabilities.md) — the draw order and the control list.
- [`emitter-bloom.md`](emitter-bloom.md) — `BLOOM_DRAW`, the first time a coat blur was replaced by
  something drawn, and the 1,577 px it removed.
- [`stone-gpu.md`](stone-gpu.md) — the shader, the tile ladder, and the coat/painter difference the
  high-pass amplifies.
- [`master-timing.md`](master-timing.md) — render wall times and what they do and do not discriminate.
- [`image-pyramid.md`](image-pyramid.md) — reduced-resolution representations of a picture, and what
  survives one.

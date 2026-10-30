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

## Reachable from

- [`capabilities.md`](capabilities.md) — the draw order and the control list.
- [`emitter-bloom.md`](emitter-bloom.md) — `BLOOM_DRAW`, the first time a coat blur was replaced by
  something drawn, and the 1,577 px it removed.
- [`stone-gpu.md`](stone-gpu.md) — the shader, the tile ladder, and the coat/painter difference the
  high-pass amplifies.
- [`master-timing.md`](master-timing.md) — render wall times and what they do and do not discriminate.

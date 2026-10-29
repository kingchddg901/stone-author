# A GPU path for stone — the third material, and the first one the preview uses

> **Read "What a real render found" and the two sections after it before trusting any fidelity
> number on this page.** Everything here was measured on tiles and preview frames; the first
> *masters* were rendered on 2026-10-29 and read **light.mean 39.6 against 49.0** on an adjusted-haze
> slab. That number turned out to be two things stacked — a metric averaged over the tile padding,
> and the coat — and the shape it was blamed on is no longer refused. One of the per-tile numbers
> below was also taken on a quiet tile.

`glass-gpu.md` is the long argument: whether a shader is worth it, what a tile is made of, how the
readback gets off the main thread, and the three instruments that were wrong before the fourth was
right. `wood-gpu.md` is the delta a second material cost. **Neither is repeated here.**

Stone is different from both in one way that matters: it is the material this repo had *measured and
written off*, and it is the only one whose shader the **studio preview** runs. Everything below is
either the retirement of that premise or the preview.

## The premise that was retired, and by what

`final-render.md` and `wood-gpu.md` both carried the same measured conclusion: **a stone port buys
1.0×**. The method was right — ablate the painter, keep the byte volume, measure — and the arithmetic
was exact: 350.3 MB ÷ 22.1 MB/s = 15.85 s, so the render *was* the file going out and removing the
painting left it at 15.8 s either way.

It generalised from one slab. `final-render.md` already carries the qualification, measured
2026-10-28, and the short version is this: on a fog-heavy slab the sink costs **0.0 s at every size
from 8,192 to 65,535**, so there is no I/O for painting to hide behind; the GPU sits at 82–93%
utilisation while the CPU uses 2.34 threads of 12; and ablating one blur token from a fifteen-mark
layer took a 32,768 render from 7.83 min to 4.14.

A second half of the premise lived in `gpuWhyNot`'s own comment — that canvas 2D already rasterises
on the GPU, *"so there is nothing there to port"*. That canvas 2D rasterises on the GPU says where
the **work** happens, not that the work is well shaped. Eight pool workers are eight queues into one
card, and a tile's cost is the command stream, not the fill rate. Measured against the CPU painter on
one slab, same tile, same geometry:

| | CPU | shader | |
| --- | --- | --- | --- |
| veins — 5,565 chunk strokes a tile | 2.5 ms | **0.1595 ms** | **15.7×**, one dispatch |
| fog — one plane's 770 blobs, binned | — | — | **13.8×**, and bit-identical |

**Both halves of the premise are kept rather than deleted.** They are the reason `exp.gpu.nomaterial`
reads the way it does, and a reader who finds `nomaterial` on an older stone master needs to know
which of the two answers that master was written under.

## What the shader owns

`renderOneTile` lays the ground and applies the coat; the callback it hands out **replaces
`paintContent`**, so this shader owns the base modulators and the content layers and nothing else.
That is what makes one dispatch enough — `applyCoat` is twelve box-blur passes and a per-pixel shader
cannot do those in one.

It draws its own ground anyway, because the mottle composites with **soft-light**, and soft-light
needs its real backdrop underneath. Source-over is associative; soft-light is not.

Source of truth is `tools/lib/stone-real.mjs` (the packer) and `tools/lib/stone-gpu.mjs` (the WGSL),
inlined into the app by `tools/sync-gpu.mjs` and compared byte-for-byte by `check-gpu-sync`.

### The grid is in draw space, and it has to be

`gpuPool` calls `pack(ew, W)` **once per render** and then patches only `tileX`, `tileY` and `tileH`
per band. Anything built in tile-local pixels is therefore per-tile data the patch cannot carry. The
first version binned at `tileX: 0`: every tile but the top-left got a grid with **zero** non-empty
cells, the shader drew bare ground, and it did it in 0.38 ms because the inner loops never ran.
**Fast and wrong reads like fast.**

One global grid in draw space, packed once, read by every tile. Verified not leaking: mean error
varies **1.40×** with position *within* a cell against **2.79×** with absolute position, and there is
no spike at the cell edges.

### What it costs to hold

The arena is **13.5 MB at 4096, 47.5 at 8192, 103.8 at 32768** and at 65,536 (the grid caps at 512
across). It fits — this desktop reports a 2048 MB storage binding limit — but it is 104 MB of new
allocation per render on a box that has been memory-tight at 32,768 before, and it is dominated by
**eighteen per-layer cell tables**. One shared grid carrying (layer, primitive) pairs would collapse
that, at the cost of re-reading a layer's twelve filter numbers per *test* instead of hoisting them
once — about 1,800 reads against 72 for a six-plane run, which is why it is per-layer today. A price,
not a defect.

## The export

Registered in `GPU_MAT` beside glass and wood: `code`, `uni`, `off`, `why`, `pack`. Nothing in
`gpuPool` changed.

The differential is **`renderOneTile` against itself** — once painting on the CPU, once handed the
shader's face through its own `paint` callback — so both tiles get the same ground and the same coat
from the same code and only the content can differ. Comparing the shader to a re-implementation of
the painter would only have proved that two descriptions of stone agree.

On the authored slab at a 512 tile of a 4096 render, tile (1536, 2048), the two vein blurs lifted as
an ablation:

| | |
| --- | --- |
| GPU **1.15 ms** against CPU **55.2 ms** | **47.9×** (a second run: 1.17 against 62.8 = 53.8×) |
| GPU tile vs CPU tile | mean **4.91**, p50 4, p90 8, p99 18, max 73 |

Max 73 is 19 channels of 786,432; 166 are over 40. For scale, the engine gate in `final-render.md`
accepts a mean of **7.919** between Blink and Gecko.

## The preview

**The window is one tile.** `draw()` puts slab point (u, v) at canvas pixel (k·u + ox, k·v + oy), so a
preview frame is a tile of a k-wide render whose origin is (−ox, −oy) — the same four numbers
`gpuPool` patches per band. Nothing in the shader, the packer or `GPU_MAT` learns that it is being
asked for a preview.

It is **not** the export's pool, and reusing it would have been wrong: `gpuPool` is two buffer sets, a
lookahead and a fault gate at the handoff, for a six-minute render of hundreds of tiles written to
disk. The preview is one rect, now, on the main thread, thrown away next frame. What they share is
the only thing worth sharing — `GPU_MAT`, the capability and the compiled module.

### What a frame is made of

Measured on the authored slab at 1209 × 756, dpr 1.5, blurs lifted so the path accepts it:

| | ms a frame |
| --- | --- |
| as authored | **678** |
| blurs lifted | **382** |
| − the veins | ~280 |
| − the haze planes as well | **≤16** — vsync |

So the coat, the reality windows, the guides and the overlay are a rounding error and **the content
is the frame**: 6,608 radial gradients and 361 veins. The two blur tokens alone are 296 ms of it.

| | ms |
| --- | --- |
| `stoneScene` | 19.6 |
| `packStone` | 26.6 |
| shader, on the device | 6.3 |
| dispatch + readback, wall | 9.6 |

**End to end, through `redraw` → `prevFill` → `draw`, with a measured two-frame floor subtracted:
384 ms becomes 51 ms — 7.6×.** The two readings are independent: 19.6 + 26.6 + 9.6 ≈ 56 from the
parts, 50.6 from the whole.

### The packing is per frame on purpose

Keeping the arena would make a view move a **10 ms** frame — it is slab-space, and only `fullW`,
`tileX` and `tileY` change. Reusing it needs a cheap answer to *"is this still the same document"*,
and the only one this app has is `renderSig()` at **20.7 ms measured**, which would spend half the
saving on the question. A dirty flag set by the four view handlers would be cheaper, and a stale face
the first time a mutation is routed through one. Named, not built; the seam is `prevRender`, which
owns the pack and the dispatch together.

### Three ways a blitted face goes wrong silently

`check-preview-face.mjs` is the tripwire, and every one of its assertions has been ablated to watch
it go red.

1. **The generation stops counting.** Every control reaches the face through `redraw`, which counts a
   generation so a face made before an edit cannot be served after it. The harness hook had its own
   entry that did not count, and a haze-removal ablation then measured **mean 54.8** against a face
   that still had the haze in it. The number looked exactly like a finding.
2. **The two sites in `draw()` drift apart.** The face replaces the backdrop *and* the content, so
   both read one answer. A backdrop that forgets paints a CPU ground under a shader face.
3. **The size check goes.** The `ResizeObserver` calls `size()` and `draw()` without `redraw`, so the
   only thing between a resize and a `putImageData` at the wrong size is `prevFace`'s own comparison.

### What the preview refuses

`prevWhyNot` asks whether the shader can draw this **frame**; `gpuWhyNot` asks whether it can draw
this **document**. The identity and angle views belong to the first — they draw each mark in a colour
standing for its own id rather than drawing the stone — and putting them in `gpuWhyNot` would refuse
a *glass* master for a reason only a preview can have.

Everything else is the document's own ladder. That ladder was long when this page was written and
is short now: the web, speck, drusy and stylolite layers are drawn, the vein halo and strain
colouring turned out to be *stale* clauses refusing work the scene already did, and the blur is
computed in closed form. What is left to turn a document away is breccia, tonal bands, a per-layer
blend mode or glow, the back light, the tiled floor, a colour-adjusted haze plane, and a blur on a
shape that is not a stroke — all unported work rather than caution, which is the distinction glass's
`relief` and wood's log view draw.

## How close the two pictures are, and the one difference a person can see

The preview's content stage against the painter's, whole window, origin exactly on the pixel:

| averaged over | mean | max |
| --- | --- | --- |
| 1 × 1 | 8.80 | 199 |
| 2 × 2 | 5.17 | 99.5 |
| 4 × 4 | **4.84** | 91.3 |

**4.84 is the export's 4.91 again**, on a different path, at a different scale. What a 2 × 2 average
removes — about 3.6 of the 8.8 — is a per-pixel pattern, and it belongs to the canvas rather than to
the shader.

**A canvas radial gradient carries an ordered dither.** One fill is a clean ramp (25, 26, 26, 27 …)
with the dither at ±1 of the last bit; ten overlapping fills of the same gradient measure ±4; and this
slab lays **ten** haze planes. In the sky the CPU alternates on a 2 × 2 period by about ±20 while the
shader walks a smooth ramp:

```
CPU     84 105  87 108  79 101  80 100   shader  103 102 102 101 100  99  98  97
```

So the shader's sky is the *cleaner* of the two, and turning the switch on visibly smooths it. That
is a real difference and `hint.gpu` already promises one — "not pixel-for-pixel the same picture".

**The integer origin costs almost nothing.** `tileX`/`tileY` are i32, so a view whose origin falls
between pixels is rounded by up to half a pixel. Same zoom, same `fullW`, same window, the only
difference being where the view sits inside a pixel: mean 8.449 against 8.811 at 2 × 2 — **0.36**,
against a 4.84 residual and a 7.919 engine gate.

## What a real render found, 2026-10-29

Every number above this line came from a tile or a preview frame. The first masters were rendered on
the author's own desktop the same day, both arms of a matched pair: same slab, same width, same tile,
only the switch moved.

| 8,192, TIFF, render only | render | file | light.mean |
| --- | --- | --- | --- |
| CPU, 8 workers | 19.8 s | 79.7 MB | **48.96** |
| GPU | **2.2 s** | 14.6 MB | **39.59** |

**9.0× — and the wrong picture.** `light.mean` is the instrument this project already trusts across
sizes and tile sizes; a 9.4 move in it is not a rounding. The file is 5.4× smaller because the
picture is flatter. Both masters pass `check-placement`; both are structurally complete, with every
vein, tree and cloud in the right place. Nothing about a finished render would have shown it.

### What it was not

- **Not the coat.** Rendering both arms again with `G.subsurface` at 0 left a gap of 7.06 from 10.96,
  so `applyCoat`'s high-pass amplifies it by about a third and does not cause it.
- **Not the texture readback.** `gpuPool` prefers the storage-texture path and every stone
  comparison ever made used the buffer path, so this was the obvious suspect. Driven out of one
  dispatch, against the same PX, the two paths are **byte-identical** — 0 of 786,432 channels.
- **Not the tile size, and not the two-dimensional dispatch split.** Same origin, 512 against 2048,
  scored only on the 512 square they share: identical to two decimals, including the split that
  engages for the first time at 2048.
- **Not the collapse arithmetic.** `collapseFilter` against `ctx.filter` on an opaque fill, at
  hue 14 / saturate 2 / brightness 6 / contrast 3, agrees to the digit.
- **Not the order of filter and fade.** `layerAt` filters `col*g`, the already-faded colour, which
  is what the canvas filters too — and the canvas's law was measured directly, one gradient at known
  radii: colour and alpha both fade, which is what the shader implements.

### What it is

Bisected on `L.haze`, which `paintFogLayer` and `stoneScene` both read, so zeroing a plane removes it
from **both** renderers at once. Over a 512 tile of a 4,096 render, shader minus painter, signed — so
the canvas's own gradient dither, zero-mean and worth about ±20 in bright haze, cannot hide in it:

| | signed | absolute over 2×2 |
| --- | --- | --- |
| marks, no haze at all | **+0.05** | 0.19 |
| one **plain** haze plane | **−0.63** | 1.11 |
| one **adjusted** plane (saturate 4, brightness 9) | **+5.36** | 5.51 |
| the whole document | **−8.42** | 14.28 |

The ground is right, the marks are right, plain haze is right, and an adjusted plane read +5.36.
A clause was shipped for that shape with the mechanism unfound. **It has since been chased down and
the clause is gone** — see "The adjusted haze plane, and why the clause went" below. The leading
guess recorded here at the time, that the canvas rasterises the gradient to eight bits before the
filter, was measured and is not the cause.

### And the lesson about the 4.91

The registration measured **one tile**, at (1536, 2048), and read mean 4.91. Walking the same
measurement down the picture gives 19.5 in the upper sky against 5.6 at that height. **It was a quiet
tile.** One sample is not a null, and the fix is to walk the picture, which `tools/thumb-master.mjs`
diffing two matched masters does in one command.

A second trap, for the next person sampling tiles by hand: a 512 tile at y=2200 of a 4,096 × 2,560
render **hangs off the bottom of the picture**, and the rows below 2,560 disagree wildly because
`binDiscs` drops a primitive whose bounding disc lies entirely outside the grid (`j0 > j1`, so its
loop never runs). No master contains those rows. The numbers from that crop are void.

## The two bars are different, and only one of them is exactness

Set by the author, 2026-10-29, and it governs how everything on this page should be read:

> it doesn't need to be an exact match. It just needs to be visually close. If I can't tell the
> difference without zooming in per pixel, that's a fine differential from the CPU — but each GPU
> render on the same firmware on the same box out of the same browser at the same tile and the same
> resolution should be exactly the same.

So **GPU against CPU is judged by eye**, and a mean-error number is a way of finding candidates to
look at rather than the verdict itself. The haze refusal above survives that bar easily: the two
masters are visibly different pictures, the sky flattens, and nobody needs to zoom.

**GPU against GPU is judged in bytes**, and it holds. Four masters of one slab, 4,096, TIFF, render
only, compared with `check-same-image`:

| run | what varied | image bytes |
| --- | --- | --- |
| 1 | — | 6,006,184 |
| 2 | second render, same page | **identical, byte for byte** |
| 3 | **fresh page** — new adapter, new device, pipelines compiled from scratch | **identical** |
| 4 | **4 finishers instead of 8** (`?pool=4`) | **identical** |

The fourth is more than the bar asks for: the finisher count is not recorded in a master's metadata,
so if it moved the pixels, two masters of one picture could disagree with nothing in either file to
say why. It does not.

**The gate was ablated before any of that was believed.** One byte flipped at offset 3,000,000 of a
copy: `DIFFERS … first at byte 3000000, 1 of 6006184 differ`, exit 1. A comparison that has never
come back red has not been shown able to.

## The blur is on the shader, and it did not need a neighbour

A blur is the one filter primitive that is not a function of its own pixel, which is why four of the
five collapse into a matrix at pack time and this one could not. It is on the path anyway, because a
vein stroke is a union of round-capped capsules and **the convolution of a half-plane with a Gaussian
is the normal CDF** — so blurred coverage across a capsule is the difference of two CDFs at its two
edges, and the distance field already says where those are:

```
cov = phi((hw - d) / s) - phi((-hw - d) / s)
```

Exact along the stroke, approximate within one sigma of a cap, where the local shape is a disc rather
than a slab.

**`ctx.filter`'s blur is the spec's three-box approximation, not a Gaussian**, and the box width
quantises to whole pixels — `d = floor(N·3·√(2π)/4 + 0.5)`, three boxes of `d` when it is odd and two
of `d` plus one of `d+1` when it is even. `boxSigma` derives the real deviation from those variances.
Measured against the canvas, a single stroke's cross-section at four widths and five radii:

| token | derived σ | rms | worst | least-squares ceiling |
| --- | --- | --- | --- | --- |
| 0.9 | 1.080 | 0.80 | 3.0 | 0.77 / 2.8 |
| 1.25 | 1.080 | 0.80 | 3.0 | — |
| 2 | 2.121 | 0.80 | 2.8 | 0.61 / 1.8 |
| 4 | 4.143 | 0.86 | 2.3 | 0.73 / 1.8 |
| 8 | 7.483 | 1.11 | 2.4 | 0.67 / 1.6 |

Within half a level of the best any single-σ formula could do, with nothing to calibrate at run time.
**A 0.9 token and a 1.25 token are the same blur** — both land on `d = 2` and produce byte-identical
profiles, which is worth knowing before anybody tunes between them.

What it buys: on one authored slab at 16,384 the render stage went from **1.7 minutes to 3.1 seconds**,
because the blur was most of the CPU's work and the shader does it for two CDF evaluations. Ablated
rather than asserted — with the haze removed and the blur left in, the two renderers agree at
**mean |Δ| 0.189 of 255**.

## The shader dithers, for the same reason the canvas does

Eight bits across a slow ramp bands. Quantising the true value once gave runs of 62 identical pixels
along a haze scanline where the painter never repeated one; both look smooth from a distance and both
are an artefact up close, a contour against a cross-hatch. So `stoneDither` adds a 4 × 4 ordered Bayer
offset before the readback quantises — keyed to **absolute** pixel position, so the pattern runs
through a tile edge instead of restarting at it, and one offset for all three channels, because
dithering each independently is what gives a canvas gradient its colour cast.

It costs nothing and pays twice: the longest run fell to 35 with 51.9% of neighbours differing, and
the agreement with the painter on the gallery slab **improved**, from mean |Δ| 1.80 to 1.62. Two
renders of the same tile remain byte-identical.

## The coat sees more in the painter's picture than in the shader's — and that is accepted

`applyCoat`'s subsurface stage is a feature **high-pass**, so it amplifies whatever high-frequency
content it is handed. The two renderers do not hand it the same thing. RMS deviation from a 3 × 3
local mean over one haze crop, which is exactly what the high-pass sees:

| | uncoated input | after the coat |
| --- | --- | --- |
| painter | **7.029** | 8.008 |
| shader | **0.341** | 0.369 |

Twentyfold, in a region where the two **means** agree to 0.119. The painter's figure is its own
accumulated per-fill dither over 770 overlapping gradients; the shader has no such thing. So on a slab
with `subsurface` the coat lifts the painter's picture and barely touches the shader's, and the
delivered means separate in proportion to the coat — 0.125 at subsurface 0, rising to 1.454 at 0.9.

**This is not a defect on either side and there is no clause for it.** Decided by the author on
2026-10-29, after looking at both: *accept it.* A ±0.5-level dither contributes about 0.289 RMS, so
matching 7.0 would take noise some twenty-four levels deep — degradation, not dither. The alternatives
were to take the coat's high-pass from a slightly blurred copy, which moves every CPU master ever
rendered, or to refuse `subsurface` outright, which would turn away exactly the slabs the blur work
unlocked.

So: **a mean gap of about 1.5 on a coated slab is this, and it is settled.** Anyone measuring it again
will find the same number and should not go looking for a fog bug — the fog was checked to 0.119 with
the coat off, one isolated blob matches the canvas's gradient law to 0.315, and the ground and mottle
agree at 0.00.

## The adjusted haze plane, and why the clause went

`exp.gpu.stone.fogadj` refused any haze plane carrying hue, saturation, brightness or contrast. It
was shipped on a real measurement — one adjusted plane read **+5.36** where a plain one read −0.63 —
with the mechanism explicitly unfound. Chased down on 2026-10-29, three steps, each ruling out the
step before it:

**The filter maths is exact.** At globalAlpha 1 the collapsed matrix, applied once to the faded
colour, matches the canvas across the whole ramp:

| g | 0.95 | 0.80 | 0.60 | 0.50 | 0.35 | 0.25 | 0.15 | 0.10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| canvas | 243 | 205 | 154 | 128 | 90 | 64 | 39 | 11 |
| model | 242.9 | 204.6 | 153.6 | 128.1 | 89.9 | 64.4 | 38.9 | 11.9 |

The collapse was also checked value by value against applying each primitive in turn — identical on
every sample. So neither the composition order nor the single clamp is wrong, and the guess that the
canvas quantises the gradient before filtering changes nothing when modelled.

**It is not the stack.** Blob count varied from 2 to 770 with the radius held constant, every pixel
compared, the shader quantised to eight bits as the readback does:

| blobs | 2 | 15 | 60 | 198 | 770 |
| --- | --- | --- | --- | --- | --- |
| relative gap | 15.6% | 15.6% | 15.2% | 13.8% | 12.9% |

Flat. A stacking defect cannot be flat in the blob count.

**It is the painter attenuating its own faint edge.** The whole gap lives at g = 0.1 to 0.3 — the
outer third of a blob — and only at low globalAlpha. At g = 0.25 the arithmetic says 2.5; the shader
reads 2.51 and the canvas reads 1.27.

So the shader was right and the clause was refusing a document for being drawn correctly. **Ruled by
the author on 2026-10-29: accept it, the shader is right.** What the canvas does to that faint edge
is still unnamed — an eight-bit premultiplied layer somewhere in the filter path, or an alpha term in
the chain — and it is no longer a reason to turn a document away. The key stays in the strings
because masters written under the clause carry it.

Three instrument failures were met getting here and are worth more than the result: comparing the
shader's raw f32 against the painter's eight bits read as "+139.7%" where everything below half a
level is 0 in one and 0.1–0.4 in the other; sub-sampling a dithered image by 2 and by 3 gave means
of 18.214 and 16.108 **for the same picture**; and a model labelled "collapse to one matrix" had been
implemented sequentially, so the collapse the app ships was never in the comparison that cleared it.

## Reachable from

- the **TIFF export**, through `gpuPool`, when the per-slab switch is on and the ladder is clear;
- the **studio preview**, through `redraw` → `prevFill` → `draw`, under the same switch and the same
  ladder plus `prevWhyNot`'s own two clauses.

One switch (`sa.gpu.v1`, keyed by slab name) governs both, because a person who wants the faster
painter wants it in both places and a second switch would be a second thing to disagree about.

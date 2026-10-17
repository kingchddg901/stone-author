# Supersampling the glass field

Status: **scoped, not built.** The defect is measured and the mechanism is understood; nothing here
is implemented.

A glass master renders one sample per pixel. The field it samples has structure below every pixel,
so most of what a glass render shows at the sizes anybody uses is **not in the glass**.

## What was measured

One 128 x 128 patch of a slab, rendered at five sample rates and box-averaged back to the same grid,
so every row is the same physical area. `corr` is against the 1024-samples-per-pixel reference.

| samples/px | rendered at | speckle band `corr` | flow band `corr` |
|---|---|---|---|
| 1 | 262,144 | **0.084** | **0.849** |
| 16 | 1,048,576 | 0.741 | 0.982 |
| 64 | 2,097,152 | 0.959 | 0.995 |
| 256 | 4,194,304 | 0.992 | 0.999 |
| 1024 | 8,388,608 | 1.000 | 1.000 |

Two regions of one slab, one render, opposite answers:

| | contrast at 1 spp | contrast converged | overstated by |
|---|---|---|---|
| speckle band | 25.45 | 6.85 | **3.7x** |
| flow band | 25.75 | 20.33 | 1.27x |

**The speckle band's native render correlates 0.084 with what is there.** Not "less detail" — no
shared structure, while reporting nearly four times the contrast. The truth in that band is a nearly
uniform grey-green; the native render shows swirling coloured moire.

**The flow band's native render correlates 0.849.** Every band is in the right place at the right
colour, broken into dashes rather than drawn continuous. That one is real and undersampled.

The mean never moves — 143.97 at 1 spp against 143.88 at 1024 — so the renderer is unbiased. What is
wrong is the variance, which is the signature of point-sampling rather than of a mistake in the field.

## Why it happens, and why it is nobody's bug

The op list composes into a stretch-and-fold map. On the slab measured:

    stir -> blow 1.8 -> blow 1.6 -> spin 1.2 -> stir -> blow 1.6 -> stir -> roll 2.5

`roll` is `x /= s; y *= s` — an area-preserving stretch, 2.5x one way and 1/2.5 the other. `spin`
rotates by an angle proportional to radius, which is a shear. `stir` advects through a displacement
field. Composed, that is a horseshoe: the ribbon boundaries get finer geometrically with every op,
without limit.

And the quantity sampled is **a label**, deliberately — `docs/glass.md` is explicit that the field
answers which colour is here as an integer so that two ribbons fold past each other and stay two
ribbons. A label field has no band limit by construction and cannot be filtered in the field, because
the average of ribbon 3 and ribbon 7 is not a ribbon.

Neither half is a defect. The folds are what glass does and the label is what keeps the colours from
muddying. **Both are correct, and together they guarantee aliasing at one sample per pixel.**

## What supersampling is allowed to average

The label cannot be averaged. The **colour after the lookup** can, and must — that is what any
physical sensor does over its own area. So the sampling loop runs `glassUnform` and `glassLay` per
sub-sample and averages the RGB it gets back. Nothing in `docs/glass.md` is weakened by that: a lap
still stacks, a slump is still a watershed, and two ribbons still never make a third **in the field**.
What changes is only that a pixel covering a boundary is allowed to report the boundary.

## Where it goes

`paintGlassContent` paints the field in a per-pixel JavaScript loop (`app/stone-author.html:6844`),
not through the rasteriser. That matters three ways:

- **The cost lands on one loop.** Coat, bloom, marks and the assembly are untouched.
- **It stays exact across engines.** `docs/sidecars/README.md` measured the `putImageData` paths
  byte-identical across Blink x86-64, Blink ARM and WebKit ARM; the rasterised paths are the ones
  that differ. Averaging integers does not change that.
- **Peak memory is unchanged.** The band `ImageData` is the same size; only the inner iteration count
  grows.

## What it costs, honestly

N x N supersampling multiplies that loop by N squared. The real 262,144 glass master took 94.9 min
over 2,560 tiles on eight workers, and the field loop dominates it:

| rate | speckle `corr` | cost multiplier | that master becomes |
|---|---|---|---|
| 2 x 2 | ~0.4 | ~4x | about 6 h |
| 4 x 4 | 0.741 | ~16x | about 25 h |
| 16 x 16 | 0.992 | ~256x | about 17 days |

**Uniform supersampling at a rate that fixes the speckle is not affordable**, and at a rate that is
affordable it does not fix the speckle. That is the finding that shapes the design: it has to be
adaptive, and the adaptation has to be cheap.

## The cheap criterion, which the map already knows

The required rate is set by how far the op chain stretches a pixel. `glassUnform` is an explicit
inverse map, so its local Jacobian is two extra evaluations by finite difference — and the stretch
factor says directly how many ribbon widths a pixel-sized box covers after the chain.

Stretch varies smoothly, so it does not need measuring per pixel. Evaluate it on a coarse lattice —
one value per 64 x 64 block is the obvious first guess — and pick N for the block. The speckle band
and the flow band would then separate themselves: the measurements above say the flow band needs
about 4 spp to pass 0.98 while the speckle band needs 256, and the only thing dividing them is
cumulative stretch.

A fallback that needs no Jacobian: render a block at 1 spp and at 2 spp and compare. Where they
agree, stop. That is ordinary adaptive sampling, costs 5x in the quiet regions rather than 1x, and
makes no assumption about the map.

## Risks worth naming before starting

- **It breaks byte-identity with every master ever rendered.** A supersampled render of a slab is a
  different picture from the one on disk, so `renderSig` must take the sample rate or two masters
  with one `inputs` will disagree — which is the one thing that signature exists to prevent.
  `docs/sidecars/README.md` already carries an era boundary for positional marking; this is a second.
- **Cross-tiling byte-identity must survive.** The sub-sample offsets have to be anchored to the
  final picture grid, never to the tile, or a 512-tiled and a 4096-tiled render stop agreeing and the
  property the whole export is arranged around is gone.
- **An adaptive rate is a per-block decision, so it must be recorded.** A master whose rate varied
  and does not say where is not reproducible. The block lattice belongs in the metadata beside
  `perTile`.
- **It is slower in exactly the renders that are already slowest**, because stretch accumulates
  toward the bottom of the slab and that is also where the tiles are densest.
- **Only glass is scoped here.** Stone hit the quantisation floor at 1,048,576 in the same test, so
  it has a finite smallest feature and gains nothing from this. Wood has not been measured.

## Staging

1. **The measurement as a probe.** Render one patch at 1, 4, 16 and 64 spp and assert the correlation
   series rises and the contrast converges. Ablate it by feeding a band-limited field, which must
   show no change with rate — without that, a probe that always reports improvement proves nothing.
2. **Uniform supersampling behind a flag**, at the sampling loop only. The gate: at 1 spp the output
   must be byte-identical to today, so the path can be shipped before it is ever switched on.
3. **The Jacobian estimate**, checked against the measured requirement rather than against itself —
   the stretch it predicts for the flow band and for the speckle band must differ by the ratio the
   table above shows, or it is not measuring what it claims.
4. **Adaptive rate**, with the block lattice in the metadata.
5. **A supersampled reference master** at a size small enough to afford, so every later claim about
   this has something to be wrong against.

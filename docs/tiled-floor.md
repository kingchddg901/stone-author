# The tiled floor — what it costs, and why it cost that

A floor is the slab cut into a repeating pattern and laid. Three paths reach pixels and only one of
them was expensive, which is why this went unnoticed: the studio feels fine.

| path | how it gets pixels | paid the cost below |
| --- | --- | --- |
| studio preview | `drawTiles` → `drawTilesTo` with no callback → blit from the painted offscreen | no |
| PNG and kit export | `renderFloor` → paint the slab once at `min(W, FLOOR_SRC_MAX)` = 8,192, then blit | no |
| **TIFF master** | `exportTiff` → `renderFloorTile` → **paint once per piece** | **yes** |

`drawTilesTo(F, tc, px, direct, only)` takes the per-piece painter as its fourth argument, and
`renderFloorTile` is the only caller that passes one. The other two blit out of a slab painted once.

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
| painting share of a floor tile | 98.63% | **−3.17%** |

**9.0×.** The painting share is the result worth reading: the ablation in
`tools/make-probe-builds.mjs --only=ablate` can no longer find any painting to remove, and the small
negative sits inside the 2–3% run-to-run spread. What remains in the 1.87 is the blits, the per-piece
canvases and `applyCoat`.

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

## What this did NOT change

**`exp.gpu.floor` still stands.** The windowing is a CPU change. A floor master still has no shader,
and `exportTiff` still nulls the pool whenever tiles are laid — the serialised worker core has
neither `drawTilesTo` nor `renderFloorTile` in its function list — so it also still runs
single-threaded while a slab master gets twelve workers. Both remain open; they are now worth
proportionally more than they were, because the redundant painting they would have parallelised or
moved to a shader is gone.

## The instruments

| | |
| --- | --- |
| `harness/floor.mjs` | the correctness gate — joins, re-render, and a positive control. Runs in CI |
| `harness/floor-cost.mjs` | the painting share, via the repo's own paint ablation. Asks what painting costs, never what a port would buy |
| `harness/floor-window.mjs` | the cross-build pixel differential. Needs `tools/make-probe-builds.mjs --only=ab`, so it is not in CI |

Both of the latter open **a fresh page per cell**. The first version of `floor-window.mjs` reused one
page per build, and each cell then inherited what the last had left behind: the same comparison read
mean 0.95 over 12.4% of pixels on a reused page and 2.05 over 48.7% on a fresh one. The contaminated
number was the flattering one, which is how it survived being read.

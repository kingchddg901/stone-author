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
  It belongs to `drawTiles`, the path that is drawing the studio, and is now there.
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

## What this did NOT change

**`exp.gpu.floor` still stands.** The windowing and the pool are both CPU work; a floor master still
has no shader. It is now the last of the three, and worth proportionally less than it was, because
the redundant painting it would have moved to a shader is gone and the remaining work is spread over
twelve workers.

**A floor laid from sections still runs sequentially**, by the same argument the graft clause already
made: a section is a whole slab record and nothing ships one. The refusal still reports
`exp.pool.floor`, whose string reads "a tiled floor" — now less specific than the clause it reports.
Renaming it is fifteen packs of work and has not been done.

## The instruments

| | |
| --- | --- |
| `harness/floor.mjs` | the correctness gate — joins, re-render, and a positive control. Runs in CI |
| `harness/floor-pool.mjs` | a pooled floor tile against the sequential one, byte for byte, plus the refusal in both directions and a control |
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

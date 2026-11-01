# The creation film — how a slab is filmed being made

[`gallery/creation.mp4`](../gallery/creation.mp4) is a slab built from nothing, in the order its marks
were drawn: 4,674 frames at 1280 × 800, 2:35.8 at 30 fps.

**It reads best at quarter speed.** The file is 30 fps and a player's 0.25× makes it 10:23, which is
the pace the picture actually wants — the marks were paced for a 2:36 film and the result is a little
hurried at full rate. Nothing in the file needs changing for that; it is a playback setting, and
saying so here is cheaper than shipping a second encode four times the length.

## The mark order is already the build order

No ordering had to be invented. `fullBuild()` has always rebuilt all geometry from `marks` in order,
oldest rock first, because that is what makes a slab deterministic — so the sequence the film needs
is the sequence the renderer already uses. On this slab:

```
marks   0-19   20 veins          the structure
       20-22   3 webs
       23-28   magnets, stylolites
       29-646  614 gravity marks  the detail, accreting
          664  the moon
          665  the mask
```

Twenty veins lay the structure, then six hundred gravity marks accrete the grain. That shape was not
arranged; it is how the slab was drawn.

## A growing line is the finished line with its tail undrawn

A vein that appears whole is a pop. To draw one partway, `lineGeom` drops segments past a cut from
`keep` — it is **not** handed a shorter path:

```js
const gcut = (GROW_ID === null || GROW_T >= 1 || extra.mark !== GROW_ID) ? 1
           : extra.at == null ? GROW_T
           : clamp((GROW_T - extra.at) / min(GROW_WIN, 1 - extra.at));
...
if (s > gcut) keep[i] = 0;
```

Everything above that line — `cum`, `total`, `s`, the swing noise, the break threshold, both tapers —
is computed from the **whole** path, so the part already on screen is byte-identical to how it will
look when the line is done.

**Truncating the path is the obvious version and it is wrong twice.** `total` shrinks, so `s`
renormalises and the swing, breaks and boudinage all rescale — the drawn part writhes as the line
grows. And the truncation point is a line ending inside the slab, which `tE` pinches out, so the
growing tip renders as a finished vein end. `tools/probe-grow.mjs` runs that implementation as the
ablation for the claim it would break: 29 segments caught, against 0 for the one that shipped.

**A child waits for the pen.** `extra.at` is a minor's fraction along its parent, carried by the
minor, the dendritic sub-branch and the Branch tool since long before any of this — so a minor at 0.3
is absent until the parent is 30% drawn, then arrives over `GROW_WIN` of the parent's length. En-echelon
segments gained an `at` too: they had none, so that whole variant used to appear in a single frame
while every other vein grew.

`GROW_T >= 1` short-circuits to 1 for every line, which is what makes *finished is untouched*
structural rather than arithmetical — a child attached at 0.95 would otherwise still be mid-window
when its parent was done.

The growth is **session state and never serialised.** A slab that saved "veins 40% grown" would
reopen as a half-finished picture.

## The base advances; it never rebuilds

This is the difference between 24 minutes and seven and a half hours.

`build()` already has the right operation — clone the geometry, `applyMark` the newest, stamp — but
its incremental branch fires only when the array is **one mark longer** than the last build. Six
frames of one mark at rising growth leave the length unchanged, so frames two through six fall
through to `fullBuild`. Measured at 512 on this slab:

| | |
|---|---|
| a full rebuild | **~4,810 ms** |
| folding a finished mark into the base | **~1 ms** |

So the driver holds the base after mark *k−1* and re-applies mark *k* at each growth, which is that
branch's body with the growth varying. The clone shape is copied from it verbatim — a shallower one
lets a frame mutate the base, and the corruption accumulates down the film rather than failing.

**The measurement that proves it is the split.** Per-frame cost rises as the film runs, which looks
exactly like the base rebuilding. It is not:

| | at mark 30 | at mark 630 |
|---|---|---|
| `applyMark` | 0.5 ms | **0.6 ms** — flat |
| `renderTiled` | 17.4 ms | 46.2 ms — more content to draw |

A combined number reads as a climb and indicts the wrong thing. 664 marks commit in **7.2 seconds
total**; rebuilding per mark would be 53 minutes.

## Only two kinds of mark re-render

`lineGeom` builds `vein` and `branch` kinds. Webs, stylolites, magnets and gravity marks never touch
it, so a gravity mark's six frames are **byte-identical** — the encoder writes one PNG and uploads the
same bytes under all six names. **1,425 pictures were drawn for 4,674 frames.**

## The moon is claymation, and it is not a cheat

A moon is a warp, not a line, so the growth gate cannot touch it. Instead each frame is a **fresh
build with the moon's samples sliced to a prefix** — which is honest rather than synthesised, because
`applyMoon` sums the ball's motion *along the samples*: a shorter sample list genuinely is a shorter
pass. Measured, each longer path moves the picture:

| moon samples | pixels differing from the previous frame |
|---|---|
| 272 of 1,089 | 10.96%, max 214 |
| 545 | 22.83%, max 216 |
| 817 | 15.84%, max 219 |
| 1,089 | 10.60%, max 193 |

It costs **~4.9 s a frame**, because a moon in the array forces `fullBuild` *and* `warpGeo` — which is
also why the driver cannot help here: it mirrors the incremental branch, and that branch never calls
`warpGeo`. 180 frames, six seconds of film, and about fifteen minutes of the render.

## What it cost

| | |
|---|---|
| frames | 4,674 — 20 veins × 30, 644 marks × 6, moon 180, hold 30 |
| render | 24.4 min at 2048 |
| intermediates | 22.1 GB of PNGs, deleted after encoding |
| pictures drawn | 1,425 |
| lost frames | **1** |

That one frame is worth the row. A transient upload failure took `film_00581.png` past all ten
retries — one PUT in 4,674. It was recoverable to the exact pixel because the timeline is a pure
function of the frame index: 581 is mark 19 at growth 0.4, and re-rendering it took one try.

**Always gate the encode on a contiguous-sequence check.** `ffmpeg`'s `%05d` renumbers from a gap, so
a single missing frame puts every later frame at the wrong time — a fault that looks like bad pacing
rather than a missing file.

For the concurrency lesson behind that single failure — six upload workers lost 278 frames of 1,800
where one worker lost none — see [the tiled floor](tiled-floor.md), which records the same shape of
mistake in a different place.

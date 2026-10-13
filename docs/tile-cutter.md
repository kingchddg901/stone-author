# The tile cutter — parked design

A **cut layer**: a pure vector set carried in the slab file that says where to cut, so a rendered
master can be sliced into its pieces afterwards and those pieces reassembled into a floor that
repeats forever.

This is parked, not built. It replaces an in-browser composite that *was* built, tested and removed
on 2026-10-13, and the reason it replaces it is not taste — the post-process route is strictly
cheaper and strictly more exact. What follows is the evidence, so nobody has to rediscover it.

## Why the in-browser composite was dropped

Composing live meant a full `applySlabState` and material field rebuild **per section, per build**.
Seven sections on the test slab, which is why that file is 4.1 MB: every section carries a whole
slab — 666 marks, 17 layers, both the wood and glass blocks. It also asked the author to hold a
slot-by-tier assignment model in their head while working.

Done afterwards, from masters already on disk, none of that cost exists. Four properties make it
work, and all four were already true:

- the slabs are **deterministic** — same inputs, same pixels
- the scale is **true** — slab units are real inches, recorded
- **every tile's size is in the master when it is made** — `lay.sizeIn`, or `pieceIn` for a plank
- there is already a **render system** to run the output back through

## The premise, measured

Three measurements on 2026-10-13, against a 2048 × 1280 master of a plain slab (no floor laid) and a
slab file carrying eight snagged squares at 6 in on a 96 in slab.

**A cut box is in normalised slab units, and the render maps 1 → W pixels.** Every component —
x, y, w *and* h — scales by W. There is no aspect correction anywhere, because slab space is
1 wide and H tall and the render maps the width.

**The lattice coordinate predicts the box exactly.** A snagged cut records `{pi, m, n, box}`.
Anchored on one cut and stepping by the tile size alone, all eight boxes came out to the pixel:

```
one lattice step = 128 px   (6 in on a 96 in slab)
[0] m=-1 n=-1  predicted 896,512   recorded 896,512   MATCH
...
all 8 boxes are exactly what their lattice coordinate predicts
```

So `box` is **redundant** — convenient, but `(m, n)` plus the tile size is the resolution-independent
truth, which is the property a vector cut layer needs.

**Reassembly from the cut list is bit-identical.** Pieces placed back by `(m, n)` — never using the
stored box for placement — diffed against the master:

```
worst channel difference 0,  differing samples 0   over 131,072 covered pixels
```

## The repeat is a property of the lattice, not of the pixels

Nothing has to wrap. A 2 × 2 of squares is a fundamental domain, so one piece per parity class
`(m mod 2, n mod 2)` tiles the plane; the block boundary is simply another joint, the same as every
joint inside it. Demonstrated: four pieces cut from the master, tiled 8 × 8 — 64 tiles, no edge
search, no compatibility pass.

What more pieces buy is **repeat length, not correctness**. Four distinctive pieces and the eye finds
the repeat in a second. That is the design knob, and it is what the slot and tier machinery already
spends: more sources per slot, longer before the repeat is visible.

### Edge matching is only needed without a joint

Butt-join difference across a seam, measured on the same eight pieces:

| pairing | mean abs rgb |
| --- | --- |
| true neighbours, cut adjacent on the slab | 6.55 |
| arbitrary pairs, any piece beside any | 53.02 |

(Only two true pairs in that set, so treat 6.55 as indicative; the 53 is over 54 pairs.)

With a joint, the hairline break is the licence and any face goes against any face — no search. That
is why shuffled floors read correctly, and it was measured independently: shuffle pass-joins at
0.0156 against control columns at 0.0132, indistinguishable. Without a joint, 8.1× is the gap an
edge-matching search would have to close, and **6.55 is its floor, not zero** — adjacent columns of
real texture differ by that much.

## What the layer should carry

**The lattice vectors and the per-cell assignment.** Both already exist: `PATTERNS[name](u)` returns
`ax` and `ay`, and the slot assignment is `slotOf` plus `T.seedMap`. Emit the rectangular period as
the viewBox so a dumb consumer can drop the file in and repeat it — but store what that period is
*derived from*, because it is derivable in three lines and a stored derivation goes stale the first
time a pattern's geometry is tuned.

### Every pattern has a rectangular period. Not all of them are rational.

A lattice point is `n·ax + m·ay`; solving it onto each axis gives the period.

| pattern | `ax` | `ay` | rectangular period | exact integer-pixel tile |
| --- | --- | --- | --- | --- |
| square | (u, 0) | (0, u) | u × u | yes |
| octagon | (u, 0) | (0, u) | u × u | yes |
| basketweave | (2L, 0) | (0, 2L) | 2L × 2L | yes |
| herringbone | (w, w) | (−w, 3w) | 4w × 4w, **8 pieces** | yes |
| hex | (w, 0) | (w/2, 1.5r) | w × 3r | **no — √3 : 1** |
| triangle | (u, 0) | (u/2, h) | u × u√3 | **no — √3 : 1** |
| rhombus | (1.5R, R√3/2) | (0, R√3) | 3R × R√3 | **no — √3 : 1** |

**Herringbone is the one whose cut count is not its slot count.** Its vectors are both diagonal —
the source comment says "lattice found by search" — which is the stair-step you see on screen. The
primitive cell is 2 pieces; squaring it up costs 4×, giving a 2u × 2u square of 8 bricks. A cut layer
meant to produce a square tileable image must carry the rectangular period for this one, not the
primitive.

**Hex, triangle and rhombus have no exact raster tile.** The period exists geometrically but is
√3 : 1, so an integer-pixel texture can only approximate it. It looks right for three repeats and has
drifted several pixels by fifty — nothing errors, the texture just stops lining up far from the
origin. This is the strongest argument for the layer being **pure vector**: vectors are exact at any
size, and the consumer eats the rounding once at the edge instead of accumulating it per repeat.

## Groupings still to write

`GROUPS` is already an array per pattern and `T.grouping` already selects within it — rhombus proves
the multi-grouping case. Everything below is data, not machinery.

Known today: rhombus (rosette 5, hex 3), octagon (5), cairo (4). Named but not written: hex with
interlock (4), triangle as a hex (6), basketweave as split squares (4), herringbone (2 primitive /
8 rectangular), and a **second octagon grouping** — the table currently holds "1 octagon and 4
squares"; "4 octagons and 1 square" is a different partition of the same tiling. Diamond needs no
entry at all: it is the square lattice rotated 45°, so the plain `(m + 2n) % N` cycle places it.

They sort into two piles:

- **`pi`-keyed** (cairo's `[0,1,2,3][pi]`, basketweave, triangle-as-hex) — nearly free, and
  self-verifying, because the polys are distinct by construction.
- **parity-keyed** (octagon, rhombus rosette, hex-with-interlock) — these need the cells enumerated
  and the partition proved before being trusted.

The rhombus comment records why that second pile needs proving: *"Splitting both by m, as this did,
gave the two pi-0 neighbours the same slot and every rosette four sections instead of five."* It was
caught by measuring real lattice cells — 41 of 41 interior diamonds, each lying in exactly two
hexagons — not by reasoning about it. A `slotOf` that looks right and silently merges two cells costs
a section nobody ever sees, and nothing errors.

## What exists already

Nothing here needs inventing, which is most of the point:

- `linesSVG()` already emits vector paths in normalised slab coordinates and already ships in the
  export bundle as `lines.svg` — the precedent, and probably the vehicle.
- `tileInstances()` already computes every piece's polygon and its `shift`, so the cut set is derived
  and deterministic.
- `renderFloorTile` already paints one polygon through a clip at an arbitrary resolution, so
  "export the pieces at near any res" is that pointed at a single bounding box.
- Snagged sections already record `{pi, m, n, box}` — where on the slab *and* which lattice cell.

## See also

- [Sections](sections.md) — a tile is a window on the slab; `cutBoxFromInstance` and the proof that
  a windowed render is pixel-identical to a crop.

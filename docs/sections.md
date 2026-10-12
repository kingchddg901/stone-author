# Sections — a tile is a window on the slab

A **section** is a cut: a tile's shape together with the place on the slab it was cut from. The floor
is then laid out of sections rather than out of one repeated render, which is what a real fabricator
does with a slab and what the tile engine could not do before.

The whole subsystem rests on one property, and it was already true before any of this was built.

## The painter is a function of position

Every tile instance already carried `poly` (its outline on the floor) and `shift` (how far the pattern
moved it). `poly − shift` is therefore **exactly where on the slab that tile was cut from** — computed
for every tile on every layout, and thrown away every time.

`cutBoxFromInstance` keeps it. Given that box, the renderer draws the slab *windowed* to that region
and magnified, which is pixel-identical to cropping the same region out of a full-size render.
`tools/probe-cut-section.mjs` gates it: 19 claims over 14 patterns × 5 sizes, each re-run with the fix
removed so the claim cannot pass vacuously. Mean difference against a crop: **0**.

One pattern reports `n/a` rather than a number, and the reason is worth keeping: `fishscale` tiles
overlap, so their shift is identically zero and there is nothing for the test to distinguish. A probe
that printed `0` there would be claiming a pass it never earned.

## Sections are material-agnostic

`withSlab` renders a kept cut from any slab, so a section carries no allegiance to the material that
produced it. A stone section, a wood section and a glass section are the same kind of object and can
sit in the same floor. This is the material fork's invariant doing real work rather than being
asserted: the tile engine never reads `MATERIAL`, so it never had to learn about three of anything.

- **Snag** takes one tile and makes it a section.
- **Keep a tile** keeps the cut you are looking at.
- **Add a saved slab** brings a `.json` in as a section *without the editor becoming that slab*.
- A **section list** per material, and a **tile setter** that picks each tile's source.

## Slot and seed are different questions

A **slot** is a position *type* — shape × cell parity — not a position. That is what lets one shared
tile keep a single identity while every centre still sees a full set of different neighbours.

A **seed cell** is `(pi, m%2, n%2)`: strictly finer than a slot. Setting the motif's tiles by hand and
letting the rest of the floor fill from them is the seed path, and it is checked before any grouping
rule.

## The rhombus had four sections where it should have had five

The shipped rule split both diamond orientations by `m`. Measured off the real lattice, the neighbours
of the standing diamond at `(n, m)` are `pi 0` at `(n−1, m)` and `(n, m)`, and `pi 2` at `(n−1, m+1)`
and `(n, m)` — so the `pi-0` pair shares `m` and differs only in `n`, while the `pi-2` pair differs in
both. **Each orientation is split by a different axis.** Splitting both by `m` gave the two `pi-0`
neighbours the same slot, and every rosette four sections instead of five.

This was found from a hand-drawn diagram, not from the code, and the reason the code could not find it
is recorded: `tools/probe-rosette.mjs` placed tiles at `m*ax + n*ay` while the app places them at
`n*ax + m*ay`. The probe had **certified the broken rule**. The swap is fixed and now asserted, and the
retired rule is carried as a standing ablation so the probe stays able to fail.

The underlying fact is geometric: **the rosette is two hexagons sharing the standing diamond.**
Measured, 41 of 41 interior diamonds lie in exactly two hexagons whose union is five tiles and whose
only shared tile is the diamond. 3 + 3 − 1 = 5.

## The hexagon is a second grouping, not a replacement

Three rhombi, one per orientation. It **partitions** — every tile lies in exactly one hexagon of a
given handedness, against the rosette's two — so the no-repeat rule needs nothing cleverer than the
orientation itself, and it holds for both handednesses at once.

Three sections then draw the isometric cube, which is the oldest thing this tiling does and was not
reachable at all: below the rosette's five it fell through to the plain-cut lattice cycle. And because
neighbouring hexagons may share a side, the grouping kills same-section edge matches outright —
measured, **0 of 333 edge pairs** share a section.

## A cut fixes the geometry it was measured against

Order of operations. Tile type, size and kerf are interchangeable and may be set in any order. But a
section was cut from a *particular* geometry, so once a cut is selected that geometry is locked: a cut
carried from a rhombus into a different tile would warp the data it was measured against, silently,
and produce a plausible floor that is wrong.

## Where the detail lives

The rules themselves are in `GROUPS` in `app/stone-author.html`, commented with the measurements that
produced them. The gates are `tools/probe-cut-section.mjs` (the cut geometry) and
`tools/probe-rosette.mjs` (the groupings, the adjacency census, and the seed). Both ablate.

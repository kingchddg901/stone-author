# Supersampling where it is needed

Status: **measured, not built. A capability, not a speed improvement** — see the note below the
cost table: it makes an SS=1 render slower, and only pays once supersampling is wanted.
The arithmetic and the measurements are here; nothing is implemented, and the two things that would
decide the implementation are named at the end.

Glass aliases. The field holds a **label**, not a colour, so it cannot be filtered where it is
sampled — a band edge finer than the pixel grid resolves as speckle rather than as a soft edge. The
renderer already carries the honest fix, in the sampling loop's own words:

> the only honest way to show a fold finer than the grid is to look more than once and average the
> COLOUR after the lookup — which is what a sensor does over its own area, and leaves the material
> rule untouched: nothing mixes in the field, only in the pixel.

That is supersampling, and at SS=4 it costs **16× the per-pixel work**. On a 1,048,576 that turns a
24.5-hour render into **16.3 days**, which is why it has never been used at size.

## The aliasing is localised, and it has already been measured

The glass ladder's per-tile byte counts are a map of where the field outruns the grid. A tile whose
bytes-per-pixel sits near the encoder's incompressible ceiling is a tile full of speckle:

| width | tiles over 0.50 bytes/px | share |
| --- | --- | --- |
| 16,384 | 6 of 40 | **15.0%** |
| 32,768 | 18 of 160 | 11.3% |
| 65,535 | 49 of 640 | 7.7% |
| 131,072 | 129 of 2,560 | 5.0% |

**And the share falls as the render grows.** A fixed saturated *area* would multiply the tile count
by 4 every doubling; measured, it goes ×3.00, ×2.72, ×2.63. So the noisy region shrinks by about a
third per doubling as the grid catches up with the field — which is the whole reason this works:

**supersampling is needed least exactly where it costs most.**

## What adaptive costs

Supersample only the tiles that need it, at SS=4, with a coarse probe priced generously at 0.25× a
plain render:

| width | aliasing | plain | uniform SS=4 | adaptive SS=4 | premium |
| --- | --- | --- | --- | --- | --- |
| 65,535 | 7.7% | 6 min | 1.5 h | **14 min** | 2.41× |
| 131,072 | 5.0% | 23 min | 6.1 h | **46 min** | 2.00× |
| 262,144 | 3.3% | 1.5 h | 24.5 h | **2.7 h** | 1.75× |
| 524,288 | 2.2% | 6.1 h | 4.1 days | **9.6 h** | 1.58× |
| 1,048,576 | 1.4% | 24.5 h | 16.3 days | **35.9 h** | **1.47×** |

**16.3 days to 35.9 hours — 10.9× — and the premium shrinks with size** rather than growing. The
plain-render figures use 0.5379 s per 2048 tile, measured live on a 1,048,576 at 28% through rather
than extrapolated from the ladder.

**It is a capability, not a speedup, and the distinction matters.** Every render made so far is SS=1,
and adaptive supersampling makes an SS=1 render *slower* — 1.47× at 1,048,576, for the probe and the
1.4% it then samples sixteen times. The 10.9× is uniform SS=4 against adaptive SS=4, which is a
comparison between two renders nobody currently makes.

So it belongs on a different list from the analytic gradient (12.4% off every render) or a GPU
partial port (1.55× off every render). Those make the work faster. This makes a render that is
currently unaffordable merely expensive — 16.3 days to 35.9 hours — and buys nothing at all until
the aliasing is worth paying to fix.

## Where the aliasing comes from

Half of it is one op. Rendering 16,384 with and without the spin:

| | as-is | no spin |
| --- | --- | --- |
| saturated tiles | 15.0% (6/40) | **7.5% (3/40)** |
| worst tile | 0.6414 | **0.5136** |
| 90th percentile | 0.5950 | 0.4923 |
| median tile | 0.1617 | **0.2171** |
| total bytes | 39,177,337 | 41,521,885 (**+6.0%**) |

**The spin is responsible for half the aliasing**, and it lowers the ceiling as well as the count —
the worst tiles are less saturated, not merely fewer. Its unbounded `a·r` shear compresses the film
hardest at the rim, which is where the sub-pixel structure comes from.

But it is not free to remove. The median tile goes **up 34%** and the picture gets 6% bigger, because
the spin does two things at once: it smears the film radially, thinning structure everywhere while
compressing it into speckle in a few places. Without it nothing is over-compressed and nothing is
thinned — the bands stay compact and dense across the whole sheet.

So a bounded **twist** in place of the spin is a *different look*, not a free fix. And once adaptive
supersampling exists it is worth **8%** (1.47× → 1.36× at 1,048,576), because halving 1.4% cannot move
much. Twist should be built because it is a gesture worth having, not as an aliasing remedy.

The other half is in the fields — `ream` at scale 26, `cords` at scale 13 across 5 strands, the stir
lattice. No op change reaches those, so adaptive supersampling is the only thing that will.

## The two things that would decide the implementation

**Detection has to cost less than it saves.** The 0.25× above is an estimate, not a measurement. The
honest test is a sparse probe of the label across a tile: if every sample agrees there is nothing
finer than the grid there. Per-tile byte counts already predict the saturated set strongly, so even a
crude probe should work — but *should* is not measured.

**Per-tile adaptation will show seams.** Two neighbouring tiles rendered at SS=1 and SS=4 have
visibly different noise character, and the boundary between them is a tile edge — precisely where an
artefact is least acceptable. Per-pixel adaptation has no seam and costs more detection. That trade is
a looking question rather than a measuring one, and it is the real design decision.

## Method

The measurements above come from rendering each tile through the app's own `renderOneTile` in the
hooked harness, deflating it with the app's own `deflateBytes`, and reading the byte counts — not from
a model of what compression would do.

It is calibrated against a real master: the as-is 16,384 run totalled **39,177,337 bytes against the
master's 39,240,859**, a difference of **0.16%**, and its saturated share came out at 15.0% — the same
figure computed independently from that master's own `perTile.bytes`. The no-spin run is therefore
measuring the picture rather than the method.

Timings in that experiment are **not** comparable: the render loop includes the deflate, and a less
noisy picture deflates faster, so the −21.3% wall-clock difference between the two runs is confounded.
The aliasing figures are clean because they are properties of the output.

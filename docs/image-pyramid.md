# A master nothing can open

Status: **scoped, not built.**

Every master this app has ever written is a single-level tiled BigTIFF — one IFD, full resolution,
nothing else. So a viewer has to decode the whole picture to show you any of it, and past a certain
size none of them can - though the figure usually quoted for that is a RESERVATION rather than a
requirement. GIMP *budgets* **110.8 GB** of working space to open a 131,072 and **443 GB** for a
262,144, on a machine with 16. What it actually writes is far less: **about 60 GB** of scratch,
measured on 2026-10-25 opening a 262,144 whose file was 11.08 GB. Seven times less than the budget,
and still 60 GB of real disk for as long as the image is open. Four times per
doubling puts the two sizes behind the `WHY` rung at roughly 1.8 TB and 7 TB of scratch.

The files are correct and checkable — `tiff-meta` reads provenance without touching a pixel,
`check-placement` and `check-same-image` work one tile at a time — but they cannot be **looked at**.
A 3.61 GB master is already past what a desktop viewer opens comfortably, and that is the smallest
thing at the top of the ladder.

An image pyramid is the standard answer: reduced-resolution levels stored in the same file, so a
viewer opens a 2,048-wide overview instantly and fetches full-resolution tiles only where you zoom.

## What it costs

Seven levels take a 262,144 master down to 2,048 wide:

| | |
|---|---|
| levels | 131072, 65536, 32768, 16384, 8192, 4096, 2048 |
| extra pixels | 14.3 Gpx — **33.3%** of the base, the ¼ + ¹⁄₁₆ + … series |
| extra bytes | ~1.20 GB on a 3.61 GB master, so ~4.82 GB |

**A third is the ceiling on PIXELS, and the bytes are worse.** Measured by retrofitting a 65,535 master
on 2026-10-16: it came out **66.1% larger**, not 33%. Level 1 alone carried 43% of the base's bytes for
a quarter of its pixels - about 1.7x the bytes per pixel. Reducing fine stone texture concentrates it
rather than smoothing it, so deflate does worse on an overview than on the picture it came from. This
document said the opposite until it was measured.

### Measured on the terapixel, 2026-10-25: a pyramid level is a SUPERSAMPLED render

Nine levels were appended to the 1,048,576 master and every tile counted. It added **40.18 GB to a
44.69 GB base - 89.9% larger**, against the 33.3% pixel arithmetic predicts and the 66.1% measured at
65,535. Every byte below is read back out of the file's own directories, not sampled:

| level | width | tiles | GB | B/px | vs the level above | averages | native ss=4 at that width |
|---|---|---|---|---|---|---|---|
| base | 1,048,576 | 163,840 | 44.689 | 0.06503 | — | 1 | — |
| 1 | 524,288 | 40,960 | 23.433 | 0.13640 | 2.097 | 4 | — |
| 2 | 262,144 | 10,240 | 11.341 | 0.26406 | 1.936 | 16 | **0.2579** |
| 3 | 131,072 | 2,560 | 3.901 | 0.36333 | 1.376 | 64 | 0.3100 |
| 4 | 65,536 | 640 | 1.068 | 0.39795 | 1.095 | 256 | — |
| 5 | 32,768 | 160 | 0.298 | 0.44347 | 1.114 | 1,024 | **0.4673** |
| 6 | 16,384 | 40 | 0.089 | 0.53063 | 1.197 | 4,096 | 0.5811 |
| 7 | 8,192 | 12 | 0.029 | 0.68568 | 1.292 | 16,384 | 0.7372 |
| 8 | 4,096 | 4 | 0.010 | 0.91844 | 1.339 | 65,536 | 0.9546 |
| 9 | 2,048 | 1 | 0.003 | 1.19578 | 1.302 | 262,144 | 1.2377 |

**The per-halving ratio is not a constant** - 2.10 at the first halving, 1.10 by the fourth - so there
is no single multiplier to quote, which is what the previous version of this section got wrong.

**But the last two columns suggested what is going on.** A reduced level of THIS master sits within
about 9% of a NATIVE 4x4-supersampled render at the same width, across seven levels, and 2.4-4x ABOVE
a plain ss=1 one - which looked like a mechanism rather than a coincidence: **reducing by 2^k averages
4^k source samples, and averaging samples is what supersampling does.** The ladder in `glass-gpu.md`
measured that supersampling costs a flat 2.78x the bytes at every resolution, so a pyramid level's
size looked predictable from it. The one outlier is level 3 at +17%; the rest fall just under.

**That reading was right about this master and wrong as a general rule.** A second pyramid, on a
supersampled base, does not obey it - see below. What survives is the weaker statement: the levels are
not smoothed copies of the picture, they are the picture sampled more heavily, which is why they do
not get cheaper per pixel relative to the base.

### A second pyramid, on an ss=4 base - and the convergence

The 1,048,576 was rendered again on 2026-10-25 at 4x4 sampling (122.30 GB, 0.17796 B/px) and given the
same nine levels, 2,305 s at 11 workers. Its levels came to **63,581,553,098 bytes, 52.0% of its
base** - well under the 89.9% the ss=1 base paid, because a base that has already averaged sixteen
samples has less left to concentrate.

**The model above does not survive it.** Against the same native ss=4 ladder it runs 1.150, 1.004,
0.898, 0.864, 0.879, 0.919, 0.959, 0.966 - a spread of -14% to +15%, systematically UNDER in the
middle, where the ss=1 base's pyramid sat within 9% and mostly just over. So "a reduced level is a
native 4x4 render" is a property of the base it was reduced from, not of reduction.

**What IS general is that the two pyramids converge.** Same widths, same slab, one built from a
1-sample base and one from a 16-sample base:

| width | from ss=1 | from ss=4 | ratio |
|---|---|---|---|
| 524,288 | 0.13640 | 0.26890 | **1.971** |
| 262,144 | 0.26406 | 0.29646 | 1.123 |
| 131,072 | 0.36333 | 0.31121 | 0.857 |
| 65,536 | 0.39795 | 0.33984 | 0.854 |
| 32,768 | 0.44347 | 0.40366 | 0.910 |
| 16,384 | 0.53063 | 0.51104 | 0.963 |
| 8,192 | 0.68568 | 0.67779 | 0.988 |
| 4,096 | 0.91844 | 0.91556 | 0.997 |
| 2,048 | 1.19578 | 1.19604 | **1.000** |

At the first halving they differ by **2x**. By 8,192 they are within 1.2%, and at 2,048 they agree to
**0.02%** - two renders that share no byte of their base arriving at the same picture. The ratio does
not approach 1 from one side either: it crosses below around 131,072, bottoms at 0.854, and comes
back. A damped crossing, not a decay.

**Which is the real result, and it is about sampling rather than about compression.** Enough averaging
erases where you started. The base sampling rate decides the top of a pyramid and stops mattering
somewhere around a 128:1 reduction - so for any view served from a deep level, rendering at ss=4 buys
nothing a box filter would not have given, and the 2.9 hours it cost over ss=1 bought only the levels
near the top and the base itself.

Both masters were deleted after measurement. The per-tile byte counts of both pyramids - 54,617
numbers each, which no sidecar records - are kept beside their sidecars as `.levels.json`.

**WHY THE ESTIMATE AHEAD OF THIS RUN WAS 21 GB, OR 1.9x LOW.** The prediction came from timing 24
output tiles, and it was wrong twice over. The sampler took `ox` and `oy` from the same loop variable,
so its 24 "spread across the sheet" tiles were **24 points on a diagonal line** through a 256x160
grid. Worse, no 24 tiles could have carried it: level 1's tiles run **12 KB to 6,203 KB with a median
of 86 KB and a mean of 559 KB**, so the total is set by a dense minority that a small sample misses by
construction - 24 tiles on a coprime stride still came out 16% low. The diagonal gave 309 KB a tile
and predicted 12.98 GB for a level that holds 23.43. A heavy-tailed per-tile distribution has no cheap
mean; count them all, or quote the ladder's 2.78x instead.

## Build it as a post-pass, not inline

The obvious design is to downsample each tile as it is painted, while its pixels are already in hand.
It is also the wrong one. A level-1 tile covers 2×2 level-0 tiles, so an inline build holds a row of
them until all four arrive:

| tile | across | row buffer, level 1 | all levels |
|---|---|---|---|
| 2048 | 128 | 537 MB | ~716 MB |
| 512 | 512 | 134 MB | ~179 MB |

Affordable against a 12.9 GB budget, but it is memory spent to avoid IO that is nearly free. Reading
the tiles back costs ~1.20 GB read and the same written — a third of the base, cascading, each level a
quarter of the one before. The writer worker already has a `read` op; stage 3's verification uses it.

So: **finish the base level, then walk it.** No buffer, no change to the render loop, and the
downsample sees exactly the bytes that are on disk rather than the bytes that were about to be.

## It can be retrofitted, and that falls out of the layout

`tiffLayout` writes the tile data first and puts everything else in the tail:

```
header(16) | tile data | gap | IFD | description | TileOffsets[] | TileByteCounts[] | JSON block
```

Nothing structural lives among the pixels. A retrofit therefore reads the JSON block, truncates at the
last tile's end, appends the new levels, and writes a fresh tail. **The existing pixels are never
rewritten and no second copy of the file is needed** — which matters at 58 GB, where there is no room
for one.

That makes `tools/add-overviews.mjs` the same algorithm as the in-app post-pass, pointed at a file
instead of a sync access handle. Every master already on disk can be made openable without
re-rendering.

**One definition of the downsample, lifted, not copied.** A retrofitted master and a freshly-built one
must agree byte for byte or the two paths have forked. This repo has been bitten twice in one day by
exactly that shape — the export and the resume verification each preparing their own tile pixels, and
a cache key naming its inputs by hand — so the tool lifts the reducer out of the app the way
`tools/lib/mark.mjs` lifts the mark format.

### The tiles are built in parallel; the writes are not

Measured on the 1,048,576 master, one output tile costs **222 ms** on one core - four reads and
inflates at 13.3 ms, four reductions at 25.2 ms, one deflate at 68.1 ms - and there are 54,617 of
them across nine levels. **3.4 hours**, of which 45% is the reducer and 31% the deflate: pure CPU over
tiles that do not know about each other.

**The write is the part that cannot move.** A tile's offset is decided by where it lands, so
`TileOffsets` is a record of write order rather than a plan; emit tile 7 before tile 6 and the file
still holds every byte, in the wrong place, under a directory that says otherwise. So the tiles are
built on worker threads and handed back to be **written in index order**, which is all
`tools/lib/pyramid-pool.mjs` does. The pixel work moved whole into `tools/lib/pyramid-tile.mjs` and
`--jobs 1` runs that same path, so there is no serial twin to drift from.

| jobs | tiles/s | per worker | nine levels |
|---|---|---|---|
| 1 | 4.5 | 4.50 | 3.37 h |
| 4 | 14.73 | 3.68 | 1.03 h |
| 8 | 20.34 | 2.54 | 0.75 h |
| **11** | **25.06** | 2.28 | **0.61 h** |
| 12 | 23.91 | 1.99 | 0.63 h |

**Eleven workers on twelve cores is a measurement, not a courtesy.** Twelve is slower than eleven, and
the per-worker rate halves by eight, which is what memory-bandwidth-bound work looks like - the
reducer walks a 16.8 MB buffer per source tile. The default is `availableParallelism() - 1` and
`--jobs` overrides it.

**The claim that this changed no bytes is checked against the real thing.** A green suite cannot see a
reordered tile, so the serial tool at `a25505b` and the parallel one were each run over a copy of the
same 16,384 master - 40 base tiles, three levels, including padded quadrants and a one-tile level.
Serial, `--jobs 1` and `--jobs 8` all came out at SHA-256 `18e6d466...`, byte for byte identical.
`tools/probe-pyramid-order.mjs` holds the parts of that a gate can carry: ordering under a backwards
schedule, the quadrant mapping read back by corner, and one byte stream across three job counts, each
ablated.

## What it touches

The ripple is larger than the feature. Every reader takes the first IFD's tile arrays as *the*
picture:

- `tiffLayout` writes one IFD and computes one directory
- `tiff-meta` reports one geometry
- `check-same-image` compares the first IFD's tiles and would read two masters' base levels only
- `check-placement` walks the first IFD, and **cells are anchored to the picture**, so a reduced level
  has no business carrying marks at all — the lattice is defined in full-resolution pixels
- `check-bleed` anchors on the writer's handle, which does not change

Marks are the sharp one. A level-1 tile is not at a 512 cell boundary of the *picture*, and
downsampling destroys the low bits the marks live in. Overviews must be left unmarked, and
`check-placement` must know to read the base level rather than whichever IFD it meets first.

## Staging

1. **The reducer, and a probe for it.** A fixed 2×2 box filter, lifted the way the mark format is.
   Deterministic, so two renders agree; alpha-correct; and ablated against a known input.
2. **The post-pass in the app**, writing levels after the base is closed. Gate: a master with levels
   must still read identically at the base — `check-same-image` against one built without.
3. **The readers**, each taught that a master may have levels and that the base is the one to check.
4. **`tools/add-overviews.mjs`**, sharing the reducer. Gate: retrofitting a master must produce the
   same bytes as rendering it with levels from the start.

Stage 1 and 2 are useful alone — they make new masters openable. Stage 4 is what rescues the ones
already written.

## Risks worth naming before starting

- **It is another era boundary.** Everything on disk has no levels, and a master with them is a
  different file from a master without, for the same picture. `check-same-image` will need to say
  which it is looking at, the way it already names the marked-against-unmarked pair.
- **Byte-identity must survive.** A fixed box filter is a pure function of the picture, so two renders
  should still agree. That is a claim to gate, not to assume.
- **The tail rewrite is the dangerous moment of a retrofit.** It truncates a file it cannot replace.
  It should write the new tail to a sibling and only then truncate — or refuse where there is no room
  to be careful.
- **`markedCells` and the provenance block** describe the base level. They should keep doing so, and
  say that they do.

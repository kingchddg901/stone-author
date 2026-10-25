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

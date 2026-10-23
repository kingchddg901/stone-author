# What a master costs

A render's file size is not a fixed cost per pixel. Across the thirteen widths on the ladder the median
cost falls **55.7× per pixel**, so a master a million pixels wide costs far less than its pixel count
suggests. This doc states that stair, what causes it — two separate things, measured, of very different
sizes — and what the figure cannot be read to mean.

Every number here comes from the harvested master sidecars (`.claude/master-meta/`), which record each
render's own metadata whether or not the file still exists. 825 masters. Two conventions hold throughout,
and both matter because getting them wrong is how the first version of this doc disagreed with itself:

- **One median.** Every figure is a median of per-master values, averaging the middle pair on an even
  count. Mixing that with a median-of-totals divided by a pixel count moves the low rungs by ~1.5%.
- **Streamed masters are excluded**, for a reason given below that matters more than the exclusion.

## The stair

Median compressed payload per width, with the ratio against raw 8-bit RGBA (4 bytes a pixel):

| width | Mpx | masters | median file | bytes/px | vs raw |
|---|---|---|---|---|---|
| 1,024 | 0.7 | 44 | 1.2 MB | 1.8857 | 2:1 |
| 2,048 | 2.6 | 43 | 4.0 MB | 1.5254 | 3:1 |
| 4,096 | 10.5 | 39 | 11.5 MB | 1.0972 | 4:1 |
| 8,192 | 41.9 | 78 | 31.3 MB | 0.7453 | 5:1 |
| 16,384 | 167.8 | 52 | 74.4 MB | 0.4433 | 9:1 |
| 20,480 | 262.1 | 33 | 104.8 MB | 0.3998 | 10:1 |
| 24,576 | 377.5 | 37 | 138.2 MB | 0.3660 | 11:1 |
| 32,768 | 671.1 | 43 | 217.6 MB | 0.3242 | 12:1 |
| 65,535 | 2,684.2 | 403 | 723.2 MB | 0.2694 | 15:1 |
| 131,072 | 10,737.4 | 24 | 1.52 GB | 0.1413 | 28:1 |
| 262,144 | 42,949.7 | 19 | 3.89 GB | 0.0906 | 44:1 |
| 524,288 | 171,798.7 | 1 | 9.92 GB | 0.0577 | 69:1 |
| 1,048,576 | 687,194.8 | 10 | 23.27 GB | 0.0339 | 118:1 |

From one end to the other: **1,048,576× the pixels for 18,833× the bytes.** Four times the pixels costs
between 2.1 and 3.3 times the bytes at every rung, never four.

## What this is not

The stair is a trend across thirteen widths. It is **not** a figure for any one width, and a step between
neighbours is meaningless on its own — the scatter within a single width is larger than the step to the
next one almost everywhere:

| width | n | median | min | max | spread, % of median |
|---|---|---|---|---|---|
| 1,024 | 44 | 1.8857 | 0.0486 | 2.8411 | 148% |
| 2,048 | 43 | 1.5254 | 0.4716 | 2.3304 | 122% |
| 4,096 | 39 | 1.0972 | 0.5403 | 1.7866 | 114% |
| 8,192 | 78 | 0.7453 | 0.3080 | 1.3724 | 143% |
| 16,384 | 52 | 0.4433 | 0.0187 | 1.1568 | 257% |
| 20,480 | 33 | 0.3998 | 0.1414 | 0.6972 | 139% |
| 24,576 | 37 | 0.3660 | 0.1221 | 0.5699 | 122% |
| 32,768 | 43 | 0.3242 | 0.0978 | 0.4277 | 102% |
| 65,535 | 403 | 0.2694 | 0.0200 | 0.4384 | 155% |
| 131,072 | 24 | 0.1413 | 0.1244 | 0.1678 | 31% |
| 262,144 | 19 | 0.0906 | 0.0190 | 0.1052 | 95% |
| 524,288 | 1 | 0.0577 | 0.0577 | 0.0577 | 0% |
| 1,048,576 | 10 | 0.0339 | 0.0289 | 0.0339 | 15% |

The cause is the slab, not the size: a nearly empty slab renders at 0.0187 bytes/px at 16,384 while a
dense one costs sixty times that at the same width. The two tight rows (131,072 and 1,048,576) are tight
because they are nearly all one slab on one machine, which is a property of the sample and not of the
ladder.

Holding the slab, the light and the engine constant (stone, uv, desktop Blink) gives the same overall
fall but is **not monotonic**: 24,576 reads 0.3534 and 32,768 reads 0.3932, on cells of two and three
runs. The pooled medians are monotonic across all thirteen widths; a held control on small cells is not.
Read the trend, never a rung.

## Two mechanisms, and they are not the same size

The obvious explanation — a bigger render is mostly empty, so most tiles compress to nothing — is true
only at the very top. Below 131,072 the share of tiles at the compression floor actually *falls*:

| width | tiles | % of tiles at the floor |
|---|---|---|
| 2,048 | 12 | 8.3% |
| 4,096 | 40 | 2.5% |
| 8,192 | 40 | 2.5% |
| 16,384 | 40 | 2.5% |
| 20,480 | 70 | 1.4% |
| 24,576 | 96 | 1.0% |
| 32,768 | 160 | 0.6% |
| 65,535 | 160 | 0.6% |
| 131,072 | 640 | 0.4% |
| 262,144 | 10,240 | 6.5% |
| 524,288 | 10,240 | 21.7% |
| 1,048,576 | 40,960 | 39.6% |

So emptiness cannot explain ten of the thirteen rows. Separating the two effects needs the per-tile
figures, where the *dearest* tile in a master is by definition fully occupied — emptiness cannot touch
that column:

| width | pass | dearest tile, bytes/px | 90th pct | median tile |
|---|---|---|---|---|
| 2,048 | 512 | 1.6615 | 1.5877 | 1.0088 |
| 4,096 | 512 | 1.4537 | 1.4453 | 0.9077 |
| 8,192 | 1,024 | 1.2740 | 1.1085 | 0.6071 |
| 16,384 | 2,048 | 1.0140 | 0.8441 | 0.3646 |
| 20,480 | 2,048 | 0.9780 | 0.7850 | 0.3207 |
| 24,576 | 2,048 | 0.9341 | 0.7189 | 0.2915 |
| 32,768 | 2,048 | 0.8910 | 0.7159 | 0.2749 |
| 65,535 | 4,096 | 0.6934 | 0.5280 | 0.2351 |
| 131,072 | 4,096 | 0.7104 | 0.3335 | 0.1090 |
| 262,144 | 2,048 | 0.7214 | 0.2254 | 0.0456 |
| 524,288 | 4,096 | 0.5355 | 0.1432 | 0.0331 |
| 1,048,576 | 4,096 | 0.4808 | 0.0878 | 0.0153 |

Both columns fall, by very different factors, and that is the finding:

- **The busiest content gets cheaper per pixel: 3.5×** (1.662 → 0.481). The element count is fixed, so
  detail that spanned one pixel at 2,048 spans hundreds at 1,048,576. Neighbouring pixels agree with each
  other and deflate wins. This operates at every width and is the whole of the effect low on the ladder.
- **More of the image becomes nothing: the median tile falls 65.7×** (1.009 → 0.0153), against the
  dearest tile's 3.5×. The gap between those two columns *is* the emptiness, and it only becomes the
  larger term above 131,072.

**The dearest column is not monotonic, and one exception is not explained.** 131,072 (0.7104) and 262,144
(0.7214) both sit *above* 65,535 (0.6934). For 262,144 there is a reason — its median pass is 2,048 where
its neighbours use 4,096, so its tiles are a quarter the area and the figure is not comparable. 131,072
has no such excuse: the same 4,096 pass as 65,535, 24 masters, and it still reads higher. So the 3.5×
holds end to end while the column wobbles in the middle, and the trend is what carries, exactly as with
the stair.

## The streamed exception — `o.bytes` means something else there

Seventeen masters report **exactly 4 bytes a pixel plus one byte a row**, to the byte: `w × h × 4 + h`.
That is not a compression ratio. Every one of them carries `streamed: true`, and the streamed writer
(`renderStreamedPNG`) does compress — through `CompressionStream('deflate')`, the same encoder every other
path uses. What it records in `bytes` is the count of **uncompressed scanline bytes fed in**, because that
is the quantity its write-completeness check needs: the band total must equal `p.FH * rowLen` or the
render refuses itself.

A band written twice overshoots and one skipped falls short, and either would be invisible to every
decoder — so the check is right to exist and right to count inputs. The defect is that it stores the
result under `bytes`, the key every other path uses for the output size. The writer's own comment names
the real figure for a 20480 hero: a file of 171 MB, against the 1,048 MB its metadata reports.

**So `o.bytes` is the compressed payload on every path except streamed, where it is the uncompressed
input.** Anything that reads it across paths is wrong by about 6× on those masters. Two places it bites:

- Any size analysis. The first version of the table above showed 20,480 at exactly 4.0000 bytes/px, which
  is what sent this doc looking.
- `tools/split-hwinfo.mjs` predicts a render's disk writes from `o.bytes` to decide whether anything else
  was using the disk. On a streamed 65,535 it expects 12.3 GB where the real master is about 0.8 GB, so it
  would tolerate 11.4 GB of foreign I/O before firing. That check is dead on every streamed run, and it
  was validated only against tiled ones.

The fix is cheap — the IDAT chunks are all accumulated before the metadata string is built, so the
compressed size is knowable at that point — but it adds a persisted key and is not made here.

## Payload versus file

That `o.bytes` is the payload and not the size on disk is **already recorded** in
[`docs/sidecars/README.md`](sidecars/README.md), which measures it 3.9 MB short of the file on one
262,144 master and says to use `archive/index.json` — the only place the on-disk size is kept — for
anything about compression. The stair above still uses the sidecar payload, because the index covers only
the 90 archived masters against 825 here, and the gap is small enough not to move it.

How small, across all 90 masters where both figures are recorded:

| | gap, file over payload |
|---|---|
| median | 0.0026% |
| large renders (≥ 8,192) | 0.0006% – 0.44% |
| 1,024 | up to 6.97% |

The container's directory and metadata chunk are a fixed cost, so they vanish into a 23 GB file and are
visible in a 1.2 MB one. That tilts the stair slightly: measured as **files** rather than payloads the
fall is **58.7×** rather than 55.7×, because the low rung gains ~7% and the top gains 0.005%. The
direction of every finding above is unchanged.

One entry in that index must not be read as a container gap: the 262,144 glass master records 48.4%,
because its file was re-saved from GIMP after signing. Same pixels, a different encoder — GIMP's TIFF
deflate came out 1.484× ours, 6.33 GB against 4.26 GB. That is a measured difference between two saves
rather than a clean encoder comparison, since GIMP's settings at the time are unknown.

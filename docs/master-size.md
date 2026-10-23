# What a master costs

A render's file size is not a fixed cost per pixel. Across the thirteen widths on the ladder it falls
**56× per pixel**, so a master a million pixels wide costs far less than its pixel count suggests. This
doc states that stair, what causes it — two separate things, measured, of very different sizes — and what
the figure cannot be read to mean.

Every number here comes from the harvested master sidecars (`.claude/master-meta/`), which record each
render's own metadata whether or not the file still exists. 825 masters. **Streamed masters are excluded**,
for a reason given at the end that matters more than the exclusion.

## The stair

Median compressed payload per width, with the ratio against raw 8-bit RGBA (4 bytes a pixel):

| width | Mpx | masters | median file | bytes/px | vs raw |
|---|---|---|---|---|---|
| 1,024 | 0.7 | 44 | 1.2 MB | 1.8584 | 2:1 |
| 2,048 | 2.6 | 43 | 4.0 MB | 1.5254 | 3:1 |
| 4,096 | 10.5 | 39 | 11.5 MB | 1.0972 | 4:1 |
| 8,192 | 41.9 | 78 | 31.3 MB | 0.7244 | 6:1 |
| 16,384 | 167.8 | 52 | 74.4 MB | 0.4374 | 9:1 |
| 20,480 | 262.1 | 33 | 104.8 MB | 0.3998 | 10:1 |
| 24,576 | 377.5 | 37 | 138.2 MB | 0.3660 | 11:1 |
| 32,768 | 671.1 | 43 | 217.6 MB | 0.3242 | 12:1 |
| 65,535 | 2,684.2 | 403 | 723.2 MB | 0.2694 | 15:1 |
| 131,072 | 10,737.4 | 24 | 1.52 GB | 0.1413 | 28:1 |
| 262,144 | 42,949.7 | 19 | 3.89 GB | 0.0906 | 44:1 |
| 524,288 | 171,798.7 | 1 | 9.92 GB | 0.0577 | 69:1 |
| 1,048,576 | 687,194.8 | 9 | 23.27 GB | 0.0339 | 118:1 |

From one end to the other: **1,048,576× the pixels for 18,833× the bytes.** Four times the pixels costs
between 2.4 and 3.1 times the bytes at every rung, never four.

## What this is not

The stair is a trend across thirteen widths. It is **not** a figure for any one width, and a step between
neighbours is meaningless on its own — the scatter within a single width is larger than the step to the
next one almost everywhere:

| width | n | median | min | max | spread, % of median | next step |
|---|---|---|---|---|---|---|
| 1,024 | 44 | 1.8584 | 0.0486 | 2.8411 | 150% | 18% |
| 8,192 | 78 | 0.7244 | 0.3080 | 1.3724 | 147% | 40% |
| 16,384 | 52 | 0.4374 | 0.0187 | 1.1568 | 260% | 9% |
| 65,535 | 403 | 0.2694 | 0.0200 | 0.4384 | 155% | 48% |
| 131,072 | 24 | 0.1413 | 0.1244 | 0.1678 | 31% | 36% |
| 1,048,576 | 9 | 0.0339 | 0.0289 | 0.0339 | 15% | — |

The cause is the slab, not the size: a nearly empty slab renders at 0.0187 bytes/px at 16,384 while a
dense one costs sixty times that at the same width. The two tight rows (131,072 and 1,048,576) are tight
because they are nearly all one slab on one machine, which is a property of the sample and not of the
ladder.

Holding the slab, the light and the engine constant (stone, uv, desktop Blink) gives the same overall
fall — 2.6599 down to 0.0339 — but it is **not monotonic**: 24,576 reads 0.3534 and 32,768 reads 0.3932,
on cells of two and three runs. The pooled medians are monotonic across all thirteen widths; a held
control on small cells is not. Read the trend, never a rung.

## Two mechanisms, and they are not the same size

The obvious explanation — a bigger render is mostly empty, so most tiles compress to nothing — is true
only at the very top. Below 131,072 the share of tiles at the compression floor actually *falls*:

| width | tiles | % of tiles at the floor |
|---|---|---|
| 2,048 | 12 | 8.3% |
| 16,384 | 40 | 2.5% |
| 32,768 | 160 | 0.6% |
| 131,072 | 640 | 0.2% |
| 262,144 | 10,240 | 6.5% |
| 524,288 | 10,240 | 21.7% |
| 1,048,576 | 40,960 | 39.6% |

So emptiness cannot explain ten of the thirteen rows. Separating the two effects needs the per-tile
figures, where the *dearest* tile in a master is by definition fully occupied — emptiness cannot touch
that column:

| width | pass | dearest tile, bytes/px | 90th pct | median tile |
|---|---|---|---|---|
| 2,048 | 512 | 1.6420 | 1.5818 | 0.9645 |
| 8,192 | 1,024 | 1.2688 | 1.1012 | 0.5771 |
| 16,384 | 2,048 | 1.0099 | 0.8441 | 0.3542 |
| 32,768 | 2,048 | 0.8910 | 0.7159 | 0.2749 |
| 65,535 | 4,096 | 0.6934 | 0.5280 | 0.2318 |
| 131,072 | 4,096 | 0.6185 | 0.3320 | 0.1090 |
| 524,288 | 4,096 | 0.5355 | 0.1432 | 0.0331 |
| 1,048,576 | 4,096 | 0.4808 | 0.0878 | 0.0153 |

Both columns fall, by very different factors, and that is the finding:

- **The busiest content gets cheaper per pixel: 3.4×** (1.642 → 0.481). The element count is fixed, so
  detail that spanned one pixel at 2,048 spans hundreds at 1,048,576. Neighbouring pixels agree with each
  other and deflate wins. This operates at every width and is the whole of the effect low on the ladder.
- **More of the image becomes nothing: the median tile falls 63×** (0.965 → 0.015), against the dearest
  tile's 3.4×. The gap between those two columns *is* the emptiness, and it only becomes the larger term
  above 131,072.

262,144 is omitted from the per-tile table: its median pass is 2,048 where its neighbours use 4,096, so
its tiles are a quarter the area and its dearest-tile figure is not comparable to the rows around it.

## The streamed exception — `o.bytes` means something else there

Seventeen masters report **exactly 4 bytes a pixel plus one byte a row**, to the byte: `w × h × 4 + h`.
That is not a compression ratio. Every one of them carries `streamed: true`, and the streamed writer
(`renderStreamedPNG`) does compress — through `CompressionStream('deflate')`, the same encoder every other
path uses. What it records in `bytes` is the count of **uncompressed scanline bytes fed in**, because that
is the quantity its write-completeness check needs:

```js
const want = p.FH * rowLen;
if (bytes !== want) throw new Error(`streamed ${bytes} scanline bytes, expected ${want}`);
```

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

`o.bytes` is the compressed payload, not the size on disk: the container's directory and the metadata
chunk are written after it is counted. On the largest master measured both ways the payload is
23,273,826,219 bytes and the file is 23,274,978,488 — a gap of 1.15 MB, or 0.005%. Immaterial to
everything above, and worth knowing before treating a sidecar figure as a disk figure.

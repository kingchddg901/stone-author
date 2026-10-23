# What a master costs

A render's file size is not a fixed cost per pixel. It falls as the render grows — but how fast, and
why, turns out to be a property of the **material**, not of the renderer. Stone and glass were both
walked up a size ladder on a single slab, and they do different things for opposite reasons.

Every number here comes from the harvested master sidecars (`.claude/master-meta/`), which record each
render's own metadata whether or not the file still exists. Four conventions hold throughout, and each
one is here because getting it wrong produced a wrong answer first:

- **One median.** Every figure is a median of per-master values, averaging the middle pair on an even
  count. Mixing that with a median-of-totals divided by a pixel count moves the low rungs by ~1.5%.
- **The tile pass is part of the measurement.** A 2048 pass and a 4096 pass of the *same picture* differ
  by 9–38% in bytes. Any figure here that pools passes is noisier for it, and says so.
- **One slab.** 805 of 851 masters share a single stone slab, which is the only reason a controlled
  stone ladder exists at all. The glass ladder was rendered for this doc for the same reason.
- **Streamed masters are excluded**, for a reason given near the end that matters more than the exclusion.

## The stair, pooled

Median compressed payload per width across every master on record — all slabs, all passes, all devices:

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

**1,048,576× the pixels for 18,833× the bytes.** This table is useful for "roughly what will this cost",
and for nothing else — it pools three things that each move the figure by tens of percent, and the
sections below take them apart.

## Tile size changes the file by up to 38%

Deflate's sliding window is 32 KB regardless of how much you feed it, and the TIFF carries no predictor
(tags written are 256, 257, 258, 259, 262 — no 317). A 2048-wide RGBA row is 8 KB, so the window spans
about four rows; a 4096-wide row is 16 KB, so it spans two. **A bigger tile sees less vertical context,
and vertical context is where the correlation is.**

Measured on one stone slab under one light, at every width where both passes exist:

| width | pass 2048 | pass 4096 | 2048 is smaller by |
|---|---|---|---|
| 4,096 | 1.3778 | 1.6668 | 17.3% |
| 8,192 | 0.7197 | 1.0161 | 29.2% |
| 16,384 | 0.3808 | 0.5646 | 32.6% |
| 20,480 | 0.3583 | 0.5628 | 36.3% |
| 24,576 | 0.3047 | 0.4933 | 38.2% |
| 32,768 | 0.2467 | 0.3936 | 37.3% |
| 65,535 | 0.2662 | 0.2917 | 8.7% |
| 131,072 | 0.1413 | 0.1603 | 11.9% |
| 262,144 | 0.0866 | 0.0983 | 11.9% |
| 1,048,576 | 0.0289 | 0.0339 | 14.8% |

**It does not keep going.** "Smaller is better" holds from 4096 down to 2048 and then reverses,
because shrinking the tile trades window context against more tile boundaries and more deflate streams,
and the two balance somewhere below 2048. Measured on the same slab, best pass per width:

| width | 512 | 1024 | 2048 | 4096 | best |
|---|---|---|---|---|---|
| 4,096 | **1.0972** | 1.3658 | 1.3778 | 1.6668 | 512 |
| 8,192 | **0.6875** | 0.7210 | 0.7197 | 1.0161 | 512 |
| 16,384 | 0.4302 | 0.4556 | **0.3808** | 0.5646 | 2048 |
| 24,576 | 0.3695 | 0.3741 | **0.3047** | 0.4933 | 2048 |
| 32,768 | 0.3257 | 0.3235 | **0.2467** | 0.3936 | 2048 |
| 65,535 | **0.2296** | 0.2458 | 0.2662 | 0.2917 | 512 |
| 262,144 | — | — | **0.0866** | 0.0983 | 2048 |

512 wins at four widths and 2048 at seven, with no clean pattern between them — 65,535 picks 512 while
both its neighbours pick 2048, on the best-sampled cells in the table. So there is an optimum rather
than a direction, it is not stable across widths, and **a master rendered at a pass the ladder did not
use is not comparable to it without this table.** That matters for the fleet: a device whose GL limit
forces a smaller tile is not producing a smaller file for a reason anyone can predict.

**Confirmed on identical pixels.** The glass slab was rendered at 65,535 under both passes. The light
figure, measured over every pixel, is byte-for-byte identical (`{"mean":143.8,"lit40":100,"every":100}`),
so the two files are the same picture. The 4096 pass cost **+9.1%** (428.2 MB against 392.5 MB) and ran
**7.6% slower** (8:16 against 7:41). Bigger tiles cost twice over, and nothing in the GPU path wants them
either: readback is 0.1% of a tile at SS=1 and 0.007% at SS=4, so fewer dispatches buys around 0.08%.

## What the scatter is, and what it is not

An earlier version of this doc said the spread within a width was "the slab, not the size". That was
wrong by omission — the pass is in there too, and at several widths it is the larger term:

| width | pooled spread | one slab, one light, one pass | pass medians apart |
|---|---|---|---|
| 8,192 | 148% | 28% | 56% |
| 16,384 | 260% | 38% | 48% |
| 24,576 | 122% | 46% | 62% |
| 32,768 | 102% | 48% | 60% |
| 65,535 | 155% | 14% | 27% |
| 262,144 | 95% | 24% | 13% |

Control the slab, the light and the pass and the residual spread drops from 95–260% to 14–48%. A single
step between neighbouring widths is 8–48%, so **the pooled stair is a trend over thirteen widths and
never a comparison between two of them.**

## Stone: elements that thin out

The obvious explanation for a falling cost — a bigger render is mostly empty, so most tiles compress to
nothing — is true of stone only at the very top. Below 131,072 the share of tiles at the compression
floor actually *falls*:

| width | tiles | % at the floor |
|---|---|---|
| 2,048 | 12 | 8.3% |
| 16,384 | 40 | 2.5% |
| 32,768 | 160 | 0.6% |
| 131,072 | 640 | 0.4% |
| 262,144 | 10,240 | 6.5% |
| 524,288 | 10,240 | 21.7% |
| 1,048,576 | 40,960 | 39.6% |

Separating the two effects needs the per-tile figures, where the *dearest* tile in a master is by
definition fully occupied — emptiness cannot touch that column:

| width | pass | dearest tile, bytes/px | 90th pct | median tile |
|---|---|---|---|---|
| 2,048 | 512 | 1.6615 | 1.5877 | 1.0088 |
| 8,192 | 1,024 | 1.2740 | 1.1085 | 0.6071 |
| 16,384 | 2,048 | 1.0140 | 0.8441 | 0.3646 |
| 32,768 | 2,048 | 0.8910 | 0.7159 | 0.2749 |
| 65,535 | 4,096 | 0.6934 | 0.5280 | 0.2351 |
| 131,072 | 4,096 | 0.7104 | 0.3335 | 0.1090 |
| 524,288 | 4,096 | 0.5355 | 0.1432 | 0.0331 |
| 1,048,576 | 4,096 | 0.4808 | 0.0878 | 0.0153 |

- **The busiest content gets 3.5× cheaper per pixel** (1.662 → 0.481). Stone's element count is fixed at
  9,021, so detail that spanned one pixel at 2,048 spans hundreds at 1,048,576; neighbouring pixels agree
  and deflate wins. This operates at every width.
- **The median tile falls 65.7×** (1.009 → 0.0153). The gap between those two columns *is* the emptiness,
  and it only becomes the larger term above 131,072.

The dearest column is not monotonic and one exception is unexplained: 131,072 (0.7104) and 262,144
(0.7214) both sit above 65,535 (0.6934). For 262,144 the pass is 2,048 where its neighbours use 4,096, so
its tiles are a quarter the area and the figure is not comparable. 131,072 has no such excuse.

## Glass: a field that does not thin out

Rendered for this doc: one glass slab (element signature `13/0/0/0/0/0`, state `924b76af`), one build,
pass 2048, 8 workers, walked from 2,048 to 131,072.

| width | tiles | wall | bytes | bytes/px | ratio |
|---|---|---|---|---|---|
| 2,048 | 1 | 3.1 s | 1,237,474 | 0.4721 | — |
| 4,096 | 4 | 7.5 s | 3,948,886 | 0.3766 | 0.7978 |
| 8,192 | 12 | 13.1 s | 12,471,164 | 0.2973 | 0.7895 |
| 16,384 | 40 | 33.2 s | 39,240,859 | 0.2339 | 0.7866 |
| 32,768 | 160 | 2:01 | 124,011,301 | 0.1848 | 0.7901 |
| 65,535 | 640 | 7:41 | 392,456,484 | 0.1462 | 0.7912 |
| 131,072 | 2,560 | 28:04 | 1.24 GB | 0.1156 | 0.7904 |

**Glass is a power law.** The ratio is 0.7909 ± 0.0034 over six doublings — a relative spread of 0.43% —
so `bytes/px = 0.4721 × 0.791^doublings`, an exponent of **−0.338** on width.

The 131,072 rung was predicted before it was rendered, from a law fitted on the six rungs below it:
**predicted 0.1156 bytes/px and 1.24 GB; measured 0.1156 and 1.24 GB**, a ratio of 0.7904 against 0.7910.
That is an out-of-sample extrapolation a full doubling past its own data, landing within 0.08%.

### Stone is not a power law, on matched footing

The same control — one slab, one light, one pass (2048):

| | mean ratio per doubling | sd | relative spread | exponent |
|---|---|---|---|---|
| glass | 0.7909 | 0.0034 | **0.4%** | −0.338 |
| stone | 0.6484 | 0.1965 | **30%** | −0.625 |

Stone's ratios wander from 0.52 to 1.08 with no trend — it even goes *up* from 32,768 to 65,535 — while
glass holds four significant figures. Stone's compression also improves nearly twice as fast per
doubling when it improves at all.

The reason is the same thing that makes the two materials cost what they do to render. Stone is a fixed
number of drawn elements thinning out across more pixels, and they thin at different rates at different
scales. Glass is a field evaluated per pixel, with structure at every scale, so it scales.

### The mechanism is inverted

| | 2,048 | 65,535 | |
|---|---|---|---|
| glass, dearest tile | 0.295 | 0.653 | **rises 2.2×** |
| glass, median tile | 0.295 | 0.051 | falls 5.8× |
| stone, dearest tile | 1.662 | 0.481 | **falls 3.5×** |

Stone's busiest region gets *smoother* per pixel as it resolves. Glass's busiest region gets *richer*.
Glass's total still falls, but it falls because the median empties, not because detail runs out.

### The sheet is not exhausted

At first reading the pinned upper tail looks like a detail ceiling — p95, p99 and max stop moving between
32,768 and 65,535 (ratios 0.99, 1.05, 1.06). It is not exhaustion but **saturation**: those tiles are
aliasing, carrying structure finer than the pixel grid, and aliasing is what deflate cannot compress. The
value is pinned because ~0.65 bytes/px is what that pattern costs the encoder.

The discriminator is the *extent*, not the value:

| width | tiles >0.50 bytes/px | share |
|---|---|---|
| 16,384 | 6 of 40 | 15.0% |
| 32,768 | 18 of 160 | 11.3% |
| 65,535 | 49 of 640 | 7.7% |
| 131,072 | 129 of 2,560 | 5.0% |

A fixed saturated area would multiply the count by 4 every doubling. It goes ×3.00, ×2.72, ×2.63 — so the
noisy region **shrinks by about a third per doubling** as it resolves into real structure. The 5.0% at
131,072 was predicted at ~5.2% before the render. The sheet keeps paying, with diminishing returns, and
never fully resolves — which is what a field with structure at every scale should do.

### Controls

Both axes were checked rather than assumed. The 2,048 and 65,535 rungs were each rendered twice, later in
the same session:

- **bytes byte-identical both times** (1,237,474 and 392,456,484), so determinism holds exactly and the
  compression axis is not in question;
- **wall clock reproduced to 1.0% and 3.2%**, so the ladder's timing is not an artefact of running the
  small rungs first.

One thing remains unexplained: per-tile cost falls 4.28× from a lone 2048 tile (3.083 s) to one inside a
640-tile render (0.720 s), and the pass-2048 runs carry a real ~40% penalty over their first 128 tiles.
The obvious reading is warm-up amortisation, but the pass-4096 run of the same picture shows **no ramp at
all** over the equivalent pixel count, so whatever it is does not scale with pixels. Recorded here as
open rather than explained.

## The streamed exception — `o.bytes` means something else there

Seventeen masters report **exactly 4 bytes a pixel plus one byte a row**, to the byte: `w × h × 4 + h`.
That is not a compression ratio. Every one carries `streamed: true`, and the streamed writer
(`renderStreamedPNG`) does compress — through `CompressionStream('deflate')`, the same encoder every other
path uses. What it records in `bytes` is the count of **uncompressed scanline bytes fed in**, because that
is the quantity its write-completeness check needs: the band total must equal `p.FH * rowLen` or the
render refuses itself.

A band written twice overshoots and one skipped falls short, and either would be invisible to every
decoder — so the check is right to exist and right to count inputs. The defect is that it stores the
result under `bytes`, the key every other path uses for the output size. The writer's own comment names
the real figure for a 20480 hero: a file of 171 MB, against the 1,048 MB its metadata reports.

**So `o.bytes` is the compressed payload on every path except streamed, where it is the uncompressed
input** — about 6× out. Two places it bites:

- Any size analysis. The first version of this doc showed 20,480 at exactly 4.0000 bytes/px, which is what
  sent it looking.
- `tools/split-hwinfo.mjs` predicts a render's disk writes from `o.bytes`. On a streamed 65,535 it expects
  12.3 GB where the real master is about 0.8 GB, so it would tolerate 11.4 GB of foreign I/O before
  firing. That check now refuses the prediction on a streamed master rather than passing it.

The fix is cheap — the IDAT chunks are all accumulated before the metadata string is built, so the
compressed size is knowable at that point — but it adds a persisted key and is not made here.

## Payload versus file

That `o.bytes` is the payload and not the size on disk is **already recorded** in
[`docs/sidecars/README.md`](sidecars/README.md), which measures it 3.9 MB short of the file on one
262,144 master and says to use `archive/index.json` — the only place the on-disk size is kept — for
anything about compression. The ladders above still use the sidecar payload, because the index covers only
the 90 archived masters, and the gap is small enough not to move them:

| | gap, file over payload |
|---|---|
| median | 0.0026% |
| large renders (≥ 8,192) | 0.0006% – 0.44% |
| 1,024 | up to 6.97% |

The container's directory and metadata chunk are a fixed cost, so they vanish into a 23 GB file and are
visible in a 1.2 MB one. Measured as **files** rather than payloads the pooled stone stair falls 58.7×
rather than 55.7×. The direction of every finding above is unchanged.

One entry in that index must not be read as a container gap: the 262,144 glass master records 48.4%,
because its file was re-saved from GIMP after signing. Same pixels, a different encoder — GIMP's TIFF
deflate came out 1.484× ours, 6.33 GB against 4.26 GB. That is a measured difference between two saves
rather than a clean encoder comparison, since GIMP's settings at the time are unknown.

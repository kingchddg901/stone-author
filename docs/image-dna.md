# Image DNA

Status: **scoped, not built.** The wire format below is settled and the gate width is
measured; no bit of it is written yet.

Every cell of a marked master already carries its own address and the key of the picture it belongs to.
Image DNA is the next question: carry **the slab itself** — so a fragment of the picture holds the
instructions to regenerate the whole of it, at any size, with no file around it.

The name decides the hard part. DNA is what a thing *is* — identical in every cell, the same whoever
reads it, independent of the circumstances of its birth. That is exactly the rule the marks already live
under, and it settles every question about what may go in.

## What goes in, and what cannot

**In: what the picture IS.** The slab — family, layers, the adjustment ladder, the UV palette, and the
marks that are the artwork. Plus the light, which is *not* in the slab and must ride alongside.

**Out: what the rendering DID.** The tile plan especially, and it is the one that looks safe and is not.
`ts`, `store`, `bleed`, `across`, `down` vary by machine — *"512 on a desktop, 1024 on a 2 GB tablet,
4096 where the texture limit allows"* — so encoding them would end byte-identity across the fleet. The
timings and the device are out for the same reason. All of it is already in the JSON block, which is the
birth certificate and should stay one.

**And the structural half is not needed at all**, because it falls out of what is already written:

| | |
|---|---|
| W, H | from the extremal cell addresses. `cx_max = floor(W/512) - 1` pins W to a 512-wide band, and the export widths are a fixed menu, so one band is one entry |
| the aspect | `const H = 0.625` is a build constant, so it lives in the code, not the data |
| `cy_max` | fully determined by `cx_max` through that ratio — so it is **free integrity**, not payload: a fragment whose two extremes disagree is not from this renderer |
| the tile grid | `TileWidth`, `ImageWidth` and the tile count are in the IFD already |

**The trap in that**: 65,535 is deliberately one pixel under 65,536, so `65535/512 = 127.998` and the
last column is partial and unmarked. `cx_max` is 126, and anyone deriving `W = (cx_max + 1) x 512` gets
65,024 — wrong, and still inside the right band, so it never announces itself. The fleet's reference
size is the one size where the naive formula is wrong and lands in the right bucket anyway.

## Why the payload is smaller than it looks

Measured on `gallery/slabs/HERO-MASTER-sealkey.json`:

| | bytes | |
|---|---|---|
| the whole slab | 533,302 | 56,260 deflated |
| `marks` | 529,023 | **99.2% of it** |
| everything else | 3,531 | ~1,500 deflated |
| session state the seal already strips | 565 | `name, tool, view, guidesOn, NEXT, nextId, activeLayer` |

So separating "session" from "picture" saves 565 bytes in 533,000. The seal does it for correctness,
not for size, and there is nothing to win by doing it again.

What makes the file big is the **container**, not the content:

| inside `marks` | bytes | |
|---|---|---|
| punctuation and keys | 325,835 | 62% |
| numbers | 168,013 | 32%, at a mean of **11.7 decimal places** |
| the literal word `null` | 35,175 | 7% — 43% of every sample is three nulls |

One pixel at 1,048,576 wide is 9.5 x 10^-7, so seven significant figures addresses a pixel at the
largest render there will ever be. The other ten digits are float64 noise, faithfully preserved.

## The encoding

A sequence marker, a type lookup, then the numbers that feed that type. No keys, because the type says
what follows; no ids, because the position **is** the id.

Seven kinds, with their counts in this slab: `gravity` 614, `magnet` 24, `vein` 20, `web` 3, `styl` 3,
`moon` 1, `mask` 1. Each has a fixed field set, derivable from the data rather than invented.

The biggest single win is not the samples. **Every mark carries a full settings snapshot `p` — 260,411
bytes, 49% of all the marks — and there are twenty-six distinct snapshots among 666 marks.** A table and
a 5-bit index replaces it:

| component | as JSON | packed | |
|---|---|---|---|
| `p` snapshots | 260,411 | 915 | **285x** — 26 entries deflated, plus 666 x 5 bits |
| samples | 190,504 | 21,752 | 2,719 x (24 + 24 + 16) bits |
| id, kind, seed, fam | ~77,000 | 4,579 | the sequence position is the id |
| **marks** | **529,023** | **27,246** | 19x against JSON — **2.0x against deflated JSON** |

That last column is the honest one. Deflate had already found most of the `p` repetition, so the table
beats it 285x on that component and 2x overall. **Size stopped being the argument several steps back.**

## What the packing actually buys

Not disk. A 262,144 master is 42.9 Gpx and the blue low-bit plane alone holds 80 MiB; both candidates
are free. What halving the payload buys is **the smallest fragment that can rebuild the picture**:

| payload | bits | cells at 1024 bits each | any crop about |
|---|---|---|---|
| deflated JSON | 450,080 | 440 | 10,752 px square |
| packed | 217,968 | 213 | **7,680 px square** |

With erasure coding it is *any* 213 cells, not particular ones, so a crop need not know where it came
from. On a 262,144 master that is a thirty-fourth of the width, from anywhere, to rebuild the whole.

The fully literal version — every cell carrying the entire genome — does not fit: it needs 1.72 bits per
pixel, and writing the whole blue plane would cost about 16 GB of growth on a 3.61 GB master. So it is
"every twenty-cell neighbourhood", not "every cell". The metaphor has a ceiling.

## Two things already true, and one that is not

**`renderSig` is already in every cell, and it is the hash of exactly this payload.** Recover the slab,
re-hash it, and it either matches the key sitting beside it or it does not. The genome arrives with its
own checksum, and that was free.

**`JSON.stringify` is deterministic here** — key order is insertion order and number formatting is
specified exactly — so the simple route costs no reproducibility. That was expected to be an argument
for packing and is not.

**Quantising coordinates changes the render.** Sub-pixel position decides antialiasing coverage, so a
slab rounded to whole pixels is a different picture from the one on disk, and byte-identity with
existing masters would break. Two ways out, the first better: **quantise at authoring time**, so the
saved slab *is* the quantised one and what is encoded is exactly what renders; or keep 24-bit
coordinates for sixteenfold sub-pixel at 1,048,576, which is what the table above already costs.

## The wire format

Right-to-left from the cell's right edge, which is already how `markStamp` walks. The genome is a
**strict suffix** of the mark that ships today, so nothing that reads marks now needs teaching:

```
[magic 32][address+version 32][picture key 32][dnaVer 8][fragment 20][of 20][chunk 1024]
|<-------------- the 96 bits that already ship -------->||<------------ new ----------->|
```

**No separators anywhere.** `dnaVer` selects the schema and the schema fixes every field width behind
it, so a delimiter has nothing left to disambiguate; and the cell's own address already says which
fragment this is, so the lattice supplies the framing between fragments. A reader that stops after 96
bits still decodes the address correctly — the same append-only property that made the pyramid
retrofit possible.

| | |
|---|---|
| record | 1,168 bits, three copies = 3,504 px |
| span | the bottom **seven** rows of the cell, where the mark alone needs one |
| cost | 1.34% of pixels written, about 215 MB of growth on a 3.61 GB master |

The chunk size is the one free parameter, and it buys crop size with file size:

| chunk | cells to rebuild | smallest crop | file growth |
|---|---|---|---|
| 288 | 757 | 14,336 px | 2.2% |
| **1024** | **213** | **7,680 px** | **6.0%** |
| 2048 | 107 | 5,632 px | 11.2% |

288 reuses the existing span exactly, but a third of it is header and it needs a crop larger than most
whole renders. 2048 doubles the file cost to halve a crop that is already small.

### Why the gate stays 32 bits wide

`tools/probe-gate.mjs`, and the answer is **not** that a narrow gate is unsafe. Measured, it is not:

| | 3-bit gate | 32-bit magic |
|---|---|---|
| four real renders, 1.6 M positions each | 204k-448k pass the gate, up to 427 reach 2-of-3 agreement, **0** pass the range check | 0 at every stage |
| random periodic fields, every period to 96 | 4.07 M reach agreement, **0** survive | 0 |

The **address range check is the stage that rejects** — `ver` plus `cx < across` plus `cy < down` is 1
in 26,214 — and the original design that failed had the weak gate and copy-agreement with no range
check at all. That missing stage was the defect, not the width.

What the width buys is the one case that defeats all three stages, which it does at **every** gate
width: a field whose period equals the record stride repeats the record exactly, so the copies agree
for free. Three things must then coincide - periodicity at the stride, the gate pattern present, and an
in-range address behind it — and the gate is the only term the format controls:

| gate | one periodic field in | each corrupting |
|---|---|---|
| 3-bit | 209,715 | ~3,579 reads |
| 32-bit | 112,589,990,684,262 | ~2,497 reads |

The failure is catastrophic rather than graceful: one qualifying field misreads thousands of cells, not
one. Against that, the narrow gate has a genuine advantage worth recording — its 67-bit record stride
is **prime**, so only periods 1 and 67 expose it, where the 32-bit gate's stride of 96 has twelve such
periods. Width wins on the gate term while losing on the stride term, and the gate term is larger by
nine orders of magnitude.

The whole saving was going to be 29 bits of 1,168 — **2.5%** — because the genome chunk dominates the
record. Gate width stopped mattering to size the moment a payload rode behind it.

### A genuine record reads twice

`markRead` accepts `agree >= 2`, so a real record is *also* detectable one stride late, where its
second and third copies are the only two in the window. `markRead` never meets this because it reads
one fixed cell-aligned position. **A DNA reader recovering from an arbitrary crop has to scan**, so it
does: prefer `agree == MARK_COPIES`, or de-duplicate by alignment. Measured at two alignments per
planted record, at every gate width.

## Staging

1. **The packed format and its probe.** Round-trip every slab in `gallery/slabs/` and assert the
   re-parsed slab renders byte-identically. Ablate the type table — a wrong index must go red.
2. **Write it, behind a flag**, the way marking started. The payload is deterministic, so a master with
   DNA must still compare IDENTICAL to one without, after inflation, outside the carrying cells.
3. **Read it back from a crop.** The gate that matters: take an arbitrary 8,000 px square out of a real
   master, recover the slab, re-render it, and compare against the original. Until a crop has rebuilt a
   picture this is a format and not a feature.
4. **Erasure coding**, so any sufficient set of cells will do rather than particular ones.

## Risks worth naming before starting

- **It publishes the artwork.** Anyone with a large enough crop can regenerate the full picture at any
  resolution. For a CC0 project that is a feature, and the strongest possible answer to "is this
  reproducible" — but it is a different thing from recording provenance, and wants deciding rather than
  inheriting.
- **It is a format, so it needs a version in the payload**, and the reader must refuse a version it does
  not know rather than guess at it. The mark carries a version already; this needs its own.
- **The light is the easy thing to forget.** The slab does not contain it, a loaded slab opens in
  daylight, and a genome without it regenerates the right picture under the wrong light. That is the
  same gap that made UV renders unresumable until 2026-10-16.
- **Small pictures cannot carry it.** 28 KB at three copies needs 689,904 pixels; a 1024 x 640 preview
  has 655,360 in all. Image DNA is a property of large masters, and the writer must decline rather than
  half-fill.

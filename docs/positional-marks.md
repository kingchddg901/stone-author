# Every tile says where it belongs

A tile that moves takes its pixels with it, and nothing in the picture objects.

On 2026-10-16 a deliberately broken resume transposed two entries in a real master's tile directory.
The tile *data* was untouched — byte for byte, at the same offsets — and only the mapping from index to
offset had changed. [`check-same-image`](../tools/check-same-image.mjs) called the result **IDENTICAL**,
every light figure agreed to the digit, and the per-tile weight check could not see it at all wherever a
render tile is cut into several stored ones. A transposition **moves** pixels without altering one of
them, so nothing that reads the pixels as a set can tell.

So every tile carries its own address.

## The format

The lattice is **512 pixels square and anchored to the picture**, never to the tiling. A cell's mark
lives in the **blue low bit of its bottom row**, written right-to-left from the cell's right edge:

| | |
|---|---|
| cell | 512 × 512, at `(cx, cy) = (x / 512, y / 512)` |
| row | `y = (cy + 1) × 512 − 1` |
| span | 288 pixels, leftwards from `x = (cx + 1) × 512 − 1` |
| payload | 96 bits, written **three times** |

The 96 bits are three words: a **magic** `0x5A4D4B31`, the **address** packed with a version, and the
**picture key** — `renderSig`, the same value the master publishes as `inputs`. Reading requires the
magic *and* two of the three copies agreeing. An earlier design used a 4-bit version as its tell and
matched noise one time in sixteen; copy-agreement alone was then defeated by a real master whose blue
low bits ran periodic (`0x1111`). A 32-bit magic is what survived both.

Because the lattice belongs to the picture, a **512-tiled and a 4096-tiled render of one slab carry
identical marks at identical absolute pixels**. Cross-tiling byte-identity survives marking, which is
the property the whole design is arranged around.

A cell that is **partly padding** at the right or bottom edge is left unmarked. Padding is not the
picture.

## What it costs

Measured over every byte of a 32,768 × 20,480 stone master, marked against its unmarked twin:

| | |
|---|---|
| pixels written | 737,280 — one in 910 |
| pixels that **changed value** | 368,521 — one in 1,821 |
| channel | blue, every one; red and green are never touched |
| size of change | exactly one level, every one |
| direction | 140,010 up, 228,511 down |
| information carried | 12 bytes per cell, 30 KiB over the master |
| stored image region grew | 276,832 bytes |

Half the written pixels already carried the right bit, which is why only half changed. The downward
skew is the address word: it is mostly zeros, so the mark darkens more often than it brightens.

Nothing can wrap. The write is `(v & 254) | bit`, which cannot exceed the value it started from — a 255
goes **down** to 254 rather than over the ceiling. An additive `v + bit` would wrap 255 to 0;
[`probe-mark`](../tools/probe-mark.mjs) puts blue-255 pixels under the mark and goes red if the formula
is ever changed back.

## Why it cannot be seen

One level is the finest step the file or an 8-bit display can hold, so there is nothing thinner to
render. More to the point, **the picture is already noisier than the mark**. Adjacent pixels in that
master differ by two and three levels of blue, and across all 671,088,640 pixels blue is odd 50.7% of
the time — the low bit is a coin flip everywhere in the render already. A mark replaces one coin flip
with another, at the same amplitude.

Blue also carries about 7% of perceived luminance against green's 59%, which is why it is the channel
marked.

Confirmed at 25600% in GIMP against the unmarked twin: pixel `(5631, 511)` reads `17, 17, 21` in the
marked master and `17, 17, 20` in the unmarked one — a difference the Pointer dialog shows and the
canvas does not. At any zoom that fits more than one row on screen the marks are averaged away before
they reach the eye.

## Reading it back

```
node tools/check-placement.mjs <master.tif> [--all]
```

Samples 40 tiles by default, which takes seconds; `--all` reads every one. A sample is evidence and the
whole file is proof, and the difference matters here — a transposition is two tiles out of thousands.

`markRead` is **lifted out of the app by text** and run as itself, through
[`tools/lib/mark.mjs`](../tools/lib/mark.mjs) — the same function that wrote the marks, never a second
implementation of the format. A reader that agreed with a *copy* of the writer would prove the copy and
nothing else.

A master carrying no mark this build understands is reported as exactly that, not as misplaced.
Treating absence as movement would condemn every master rendered before marking existed.

## Turning it off

Marking is **on**. `?mark=0` turns it off — for reproducing a master from before 2026-10-16, or for a
picture that must not be altered at all. A marked master records `marked` (the format version) and
`markedCells` in its JSON block; an unmarked one omits both.

## The era boundary

`inputs` does **not** change when marks are added. A marked and an unmarked render of one picture
therefore **share a signature and differ in bytes** — every master under [`sidecars/`](sidecars/)
predates marking and carries none.

`check-same-image` recognises that pair by its shape — blue only, mark rows only, delta exactly one —
reads both files' marks, and says which is which instead of reporting a bare `DIFFERS`. It still counts
as a failure, because the files do differ and a gate that forgave this would forgive a real one.

Two **marked** renders of one picture remain byte-identical, at any tile size.

## How much the plane could hold

The mark uses 0.11% of one cell's blue low bits. The rest is unspent:

| per 512 cell | |
|---|---|
| blue low bit, one copy | 32 KiB |
| blue low bit, two copies | 16 KiB |
| blue low bit, three copies | 11 KiB |
| all three channels, one copy | 96 KiB |

Over the whole 32,768 × 20,480 master that is **80 MiB** in blue alone, 240 MiB across three channels.

It is not free, though — the bits are free, the **bytes** are not. The low-bit plane is where deflate
was finding its redundancy, and filling it with payload destroys that. Measured on the pair above, the
mark cost **3.0 bytes of file for every byte of low bit written**, and 9.0 bytes of file for every byte
of information actually carried. A payload using the whole plane would grow the file by far more than
the payload itself.

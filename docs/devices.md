# What it runs on, and how fast

Five machines have each produced a **65,535 × 40,959** master — 2.684 gigapixels — in both daylight and
black light. This page records what they are, what they took, and what each one taught.

Every figure comes from the masters themselves. A master records its own build, engine, hardware class,
tile plan, per-tile timings and the light it was written with, so nothing here is a recollection. The
device *identity* is encrypted under the slab and is not derived from the files; the models below are
supplied by hand in the evidence set.

## The set

Latest run per device and light, all on build `2026.09.27.25` or later.

| device | engine | light | mean | lit>40 | time | render tile | passes | median tile | throughput |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| iPhone 14 Pro | WebKit | black | 61.32 | 40.2% | **1.5 min** | 2048 | 640 | 103 ms | **29.7 Mpx/s** |
| desktop | Blink | black | 61.50 | 47.0% | 1.8 min | 8192 | 40 | 2,423 ms | 24.4 Mpx/s |
| S23 Ultra | Blink | black | 61.59 | 47.1% | 2.7 min | 4096 | 160 | 893 ms | 16.9 Mpx/s |
| desktop | Gecko | black | 61.34 | 44.9% | 6.9 min | 2048 | 640 | 470 ms | 6.5 Mpx/s |
| S23 Ultra | Gecko | black | 58.42 | 38.4% | 10.1 min | 2048 | 640 | 677 ms | 4.5 Mpx/s |
| Tab A 8.0 | Blink | black | 61.58 | 47.1% | 28.6 min | 2048 *(forced)* | 640 | 2,381 ms | 1.6 Mpx/s |
| A7 Lite | Blink | black | 61.33 | 46.9% | 29.1 min | 1024 | 2,560 | 598 ms | 1.6 Mpx/s |
| iPhone 14 Pro | WebKit | daylight | 71.40 | 58.6% | 2.2 min | 2048 | 640 | 151 ms | 20.1 Mpx/s |
| desktop | Blink | daylight | 45.03 | 34.9% | 2.4 min | 4096 | 160 | 876 ms | 18.5 Mpx/s |
| S23 Ultra | Blink | daylight | 45.41 | 35.0% | 2.3 min | 4096 | 160 | 762 ms | 19.2 Mpx/s |
| desktop | Gecko | daylight | 46.25 | 36.2% | 8.2 min | 4096 | 160 | 1,318 ms | 5.5 Mpx/s |
| S23 Ultra | Gecko | daylight | 46.55 | 36.2% | 11.1 min | 4096 | 160 | 2,090 ms | 4.0 Mpx/s |
| Tab A 8.0 | Blink | daylight | 45.40 | 35.1% | 21.8 min | 2048 *(forced)* | 640 | 1,547 ms | 2.1 Mpx/s |
| A7 Lite | Blink | daylight | 44.73 | 34.8% | 22.5 min | 2048 | 640 | 1,703 ms | 2.0 Mpx/s |

Throughput is rendered pixels per second including the bleed margin, which is the fair comparison when
devices choose different tile sizes.

## The same slab at a 512 tile

Every device above also rendered the published slab at a **forced 512 tile — 10,240 passes**, the most
any configuration in this project has taken. The point was not speed. It was to find out whether a tile
that small changes the picture, and what it does to a machine while it runs.

| device | engine | light | mean | lit>40 | time | median tile | slowest tile | throughput |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| desktop | Blink | daylight | 45.03 | 34.9% | 5.6 min | 29 ms | 955 ms | 8.21 Mpx/s |
| desktop | Blink | black | 61.49 | 47.0% | 6.2 min | 33 ms | 209 ms | 7.47 Mpx/s |
| S23 Ultra | Blink | daylight | 45.40 | 35.0% | 6.7 min | 33 ms | 105 ms | 6.90 Mpx/s |
| S23 Ultra | Blink | black | 61.58 | 47.1% | 10.4 min | 52 ms | 38,056 ms* | 4.45 Mpx/s |
| desktop | Gecko | daylight | 46.25 | 36.2% | 9.4 min | 33 ms | 240 ms | 4.91 Mpx/s |
| desktop | Gecko | black | 61.33 | 44.9% | 13.7 min | 62 ms | 401 ms | 3.37 Mpx/s |
| S23 Ultra | Gecko | daylight | 46.55 | 36.2% | 18.2 min | 64 ms | 481 ms | 2.53 Mpx/s |
| S23 Ultra | Gecko | black | 58.50 | 38.5% | 22.8 min | 106 ms | 552 ms | 2.03 Mpx/s |
| Tab A 8.0 | Blink | daylight | 45.40 | 35.1% | 58.7 min | 287 ms | 742 ms | 0.79 Mpx/s |
| A7 Lite | Blink | black | 61.33 | 46.9% | 61.5 min | 322 ms | 712 ms | 0.75 Mpx/s |
| Tab A 8.0 | Blink | black | 61.57 | 47.1% | 64.1 min | 330 ms | 971 ms | 0.72 Mpx/s |

\* One tile of 38,056 ms on the S23 under Blink. It is the only tile in that master over 2 seconds, its
p99 is 185 ms, and it accounts for 38 of that render's 623 seconds — an interruption on the handset, not
render work. It is left in rather than trimmed, because a figure quietly cleaned is worth less than one
explained.

Throughput here counts the padded 520 px surface across all 10,240 passes: 2,769 Mpx rendered.

The iPhone and the A7 Lite's daylight master are absent from this table because those runs were not made,
not because they failed.

### The picture does not change

Each figure above is within a hundredth of what the same device produced at its own much larger tile —
across tile changes of 8x, 4x, 2x and 4x:

| device / light | at its own tile | at 512 | delta |
| --- | --- | --- | --- |
| S23 Gecko, daylight | 46.55 @4096 | 46.55 | **0.00** |
| A7 Lite, black | 61.33 @1024 | 61.33 | **0.00** |
| Tab A 8.0, black | 61.58 @2048 | 61.57 | −0.01 |
| S23 Gecko, black | 58.42 @2048 | 58.50 | +0.08 |

Two exact zeros. Tile size is a memory and scheduling decision, not a visual one — which is what makes
it safe to take a smaller tile on a device that needs one.

### What it costs, and what it buys

512 costs **1.6x to 2.3x** the time, consistently across hardware from a 2019 budget tablet to a desktop.

What it buys is that **the machine stays alive**. The slowest single tile is the figure that matters, and
it collapses:

| run | median tile | slowest tile |
| --- | --- | --- |
| desktop Gecko @2048 | ~500 ms | **14,500 ms** |
| desktop Gecko @512 | 62 ms | **401 ms** |
| Tab A 8.0 @512 | 330 ms | **971 ms** |

Excluding the one handset interruption noted above, **no tile anywhere in the fleet at 512 reaches a
second.** The same machine and engine that produced 9.4 and 14.5 second tiles at a 2048 tile has a worst
tile of 0.40 s at 512 — thirty-six times better.

That is why a 512 render feels different rather than merely slower. A 65,535 px export at 2048 blocks
the main thread for up to fourteen seconds at a stretch; at 512 the longest block on the slowest tablet
in the set is under one second, and the tablets stay scrollable throughout.

## The machines

### Desktop — AMD Ryzen 5 5500, Radeon RX 6500 XT

6 cores / 12 threads at 3.6 GHz, 16 GB (2 × 8 GB @ 3600), Windows 11 Home 10.0.26200. The reference
machine: the figure everything else is calibrated against, **61.33**, was made here with the image-space
bloom at 65535 in 3.0 minutes.

It is the only machine that reports its memory honestly — 16 GB installed, 16 GB reported — and the only
one that takes an 8192 render tile, which is why its 40 passes are the fewest in the set. Its
`hardwareConcurrency` of 12 is threads, not cores.

It also contributed almost no defects, and that is not a coincidence. It satisfies every assumption the
code makes, so it can only confirm them.

### iPhone 14 Pro — A16 Bionic

6-core CPU (2 performance at 3.46 GHz, 4 efficiency at 2.02 GHz), 6 GB LPDDR5, 2556 × 1179 at 460 ppi.

**The fastest machine in the set.** 1.5 minutes for 2.684 gigapixels, 29.7 Mpx/s, ahead of a desktop with
a discrete GPU. Its per-tile median of **103 ms** is four times quicker than anything else at the same
tile size, and its distribution is the tightest measured — slowest tile 591 ms, under 6× the median.

It under-reports itself more than any other device: `hardwareConcurrency` says 4 where the A16 has 6, and
`navigator.deviceMemory` is absent entirely, so the planner budgets it on a 4 GB assumption.

It is also the one device where `ctx.filter` **accepts** a blur and does not apply it. The app detects
this by drawing through the filter and reading a pixel back rather than trusting the property, and falls
to a mip pyramid — which is why an image-space master from this phone exists at all.

Proven offline: a 65535 black-light master rendered start to finish in airplane mode, in roughly 92
seconds.

### Galaxy S23 Ultra (SM-S918U) — Snapdragon 8 Gen 2

Octa-core (1 × 3.36 GHz Cortex-X3, 2 × 2.8 A715, 2 × 2.8 A710, 3 × 2.0 A510), Adreno 740, 12 GB, 512 GB,
6.8 in at 1440 × 3088. Android 16.

**Every figure here is throttled.** It ran in Samsung's Light performance mode throughout — the only
device in the set with that setting — so 2.7 minutes is the hardware not trying.

It reports 8 GB for 12, because `navigator.deviceMemory` clamps at 8 on Android. The planner therefore
budgeted 6,442 MB against roughly 9,700 MB of real headroom, and never used the difference.

Under Gecko the same handset is a different machine: 9.6 to 11.2 minutes against Chrome's 2.3 to 2.7, and
its black-light master lands 4.75% under the reference at the maximum possible correction. See
[`renderer-determinism.md`](renderer-determinism.md).

### Galaxy Tab A7 Lite (SM-T220) — MediaTek Helio P22T

Octa-core Cortex-A53 (4 × 2.3 GHz, 4 × 1.8 GHz), PowerVR GE8320, 3 GB, 8.7 in at 800 × 1340. Android 14.

It rendered its black-light master at a **1024 render tile — 2,560 passes**, more than any other device,
and landed on **61.33**: exactly the reference, the closest figure in the set.

It did so on a **537 MB budget**. It has 3 GB installed, reports 2 GB because the memory API rounds down
to a power of two, and roughly 1 GB is actually free — so the figure the planner budgets against is
understated against what is installed and badly overstated against what is available. A deliberate
`?mem=2` brings it to a quarter of the reported figure, which is about half of what is genuinely free.
That share is recorded in the master as `plan.memShare: 2`, and no other master in the set carries it.

### Galaxy Tab A 8.0, 2019 (SM-T290) — Snapdragon 429

Quad-core Cortex-A53 at 1.95 GHz, Adreno 504, 2 GB, 8.0 in at 1280 × 800. Android 11, Chrome 154.

The floor, deliberately. A budget tablet from 2019 that reports a `MAX_TEXTURE_SIZE` of **4096** and
writes a 65,535 px master — because the output is never allocated, only the tile, which peaked at
2,056 px.

**It is the only device whose tile must be set by hand**, and its masters record that they were:
`forcedTile: 2048`. At the 4096 tile its planner chose for itself, the drawn halo is truncated at every
tile join — visible at a four-corner junction, measurable as roughly 1% of missing light, and present in
daylight too, so it is the base layer and not the glow. The same tile is also **2.8× slower**: 85.2
minutes against 21.8 for the identical daylight master.

It is also the only device that never reuses a remembered plan. Its cache has to be cleared by hand
because that Android and Chrome combination gets stuck, and clearing wipes the plan store — so it races
candidate tiles from scratch on every run, paying 52 to 89 seconds before a pixel is drawn.

## What the spread says

**Fastest to slowest is 19×** for the same master: 1.5 minutes on a phone, 28.6 on a tablet. Both
produce a light figure within 0.5% of the same reference.

**The engine matters more than the hardware.** Chrome on a *throttled* S23 Ultra runs at 16.9 Mpx/s;
Firefox on a 12-thread desktop with a discrete GPU runs at 6.5. The phone is 2.6× the desktop, because
Gecko is paint-bound where Blink is compression-bound — its per-tile time stops tracking the bytes each
tile produces.

**Gecko also has by far the heaviest tail.** Slowest tile against median: iPhone 5.7×, desktop Chrome
2.0×, A7 Lite 2.6× — desktop Firefox **20×**, with single tiles taking 9.4 and 14.5 seconds against
half-second medians.

**Four Blink devices agree to 0.41%** at 65535 under black light — 61.33, 61.50, 61.58, 61.59 — across
x86 and three generations of ARM, from 2 GB to 16 GB, one of them throttled. The per-engine correction is
genuinely a property of the engine and not of the machine.

**Reported capability figures are unreliable in every direction.** Core counts are threads. Memory is
rounded down, clamped at 8, and describes installed rather than available. `MAX_TEXTURE_SIZE` bounds the
tile and not the output. The user-agent reports Android 10 on all three Samsungs and is wrong on all
three. Two browsers on one handset disagree about its pixel ratio and its texture limit. This is why the
planner measures a real tile before committing rather than trusting any of it.

## Reproducing any of this

See [`reproduce.md`](reproduce.md). The app, the slab and the readers are all here; the masters are not,
because a download you could only checksum proves the file was not edited rather than that the renderer
works.

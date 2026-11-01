# What it runs on, and how fast

Five machines have each produced a **65,535 × 40,959** master — 2.684 gigapixels — in both daylight and
black light. This page records what they are, what they took, and what each one taught.

Every figure comes from the masters themselves. A master records its own build, engine, hardware class,
tile plan, per-tile timings and the light it was written with, so nothing here is a recollection. The
device *identity* is encrypted under the slab and is not derived from the files; the models below are
supplied by hand in the evidence set.

## The set

Latest run per device and light, all on build `2026.09.27.25` or later — which means **this table predates the per-engine halo calibration** of 2026-09-30 and the builds after it. The masters behind it are drawn-halo renders, so the shape of the figures holds, but the timings and light figures will move when the set is re-cut; treat them as the state of that week rather than of the current build.

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

## On the current build

The set above is the week of 2026-09-27. Everything below was measured on 2026-10-20, builds
`2026.10.20.164` and `.165`, after the tiled path gained a worker pool, worker-side tile finishing, and
a pool that no longer narrows itself. **One slab, one spectrum, `inputs 65724e44`** — so these rows
compare to each other, not to the set above.

### The fleet at 65,535 UV

Each device at the tile it ran fastest. `hc` is `navigator.hardwareConcurrency`, which is **not a core
count**: the desktop reports 12 for 6 cores with SMT, Safari clamps to 4 on a 6-core A16, and an 8-core
Android reports 8 unequal cores. `per worker` is throughput divided by mean occupancy.

| device | engine | hc | tile | pool | mean busy | time | Mpx/s | per worker |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| desktop | Blink | 12 | 4096 | 8 | 7.12 | 22.9 s | **117.5** | 16.5 |
| iPhone 14 Pro | WebKit | 4 | 2048 | 4 | 3.78 | 48.0 s | **55.9** | 14.8 |
| S23 Ultra | Blink | 8 | 2048 | 8 | 7.55 | 49.0 s | **54.8** | 7.2 |
| desktop | Gecko | 12 | 4096 | 8 | 6.18 | 1:46 | **25.3** | 4.1 |
| S23 Ultra | Gecko | 8 | 1024 | 8 | 2.29 | 12:10 | **3.7** | 1.6 |
| A7 Lite | Blink | 8 | 2048 | 8 | 7.81 | 12:37 | **3.5** | 0.5 |
| Tab A 8.0 | Blink | 4 | 2048 | 4 | 3.90 | 20:54 | **2.1** | 0.5 |

Those are all 65,535 renders. That matters for the two Gecko rows in particular — the Blink/Gecko gap
narrows from 4.34× to 2.37× between 65,535 and 262,144 on this machine, so the table reads Gecko at the
size where it looks worst. See *"Gecko is N times slower" is not one number* below.

The iPhone is the finding in that table. It matches the S23 Ultra's total throughput with **half the
workers** and lands within 11% of the desktop *per worker* — 14.8 against 16.5. The whole of its gap to
the desktop is worker count, and that count is a Safari policy rather than a hardware limit.

The two weakest devices carry the other one. The A7 Lite ran at **7.81 of 8** and the Tab A 8.0 at
**3.90 of 4** — the two best occupancy ratios in the fleet, better than the desktop's 7.12 of 8. Both
shed and recovered under the previous build; neither narrows now. The Tab A is the device the shed
heuristic was built for, and its own record in `docs/sidecars/README.md` has it shedding 4 → 2 and
losing a third of its throughput to it.

### The same fleet at 262,144

Sixteen times the pixels — 42.9 Gpx — and the order holds but the spread opens from 56× to 70×:

| device | engine | hc | tile | pool | light | time | Mpx/s | narrowing | build |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| desktop | Blink | 12 | 4096 | 8 | uv | 5.1 min | **139.2** | — | .163 |
| S23 Ultra | Blink | 8 | 2048 | 8 | uv | 9.5 min | **75.0** | — | .164 |
| iPhone 14 Pro | WebKit | 4 | 2048 | 4 | uv | 11.7 min | **61.2** | shed ×12 | .164 |
| desktop | Gecko | 12 | 4096 | 8 | uv | 12.2 min | **58.8** | strain only | .165 |
| A7 Lite | Blink | 8 | 2048 | 8 | uv | 1.64 h | **7.3** | strain only | .165 |
| Tab A 8.0 | Blink | 4 | 2048 | 4 | uv | 2.87 h | **4.2** | strain only | .165 |
| Tab A 8.0 | Blink | 4 | 1024 | 2 | day | 6.08 h | **2.0** | shed 4 → 2 | .82 |

**The A7 Lite row is the best evidence the shed retirement has produced.** A 2 GB tablet carried 10,240
passes at **8 of 8 workers and never narrowed** — and its `poolStrain` reads `over 1, panic 229, max 18`.
The ratio axis called that device in trouble **229 times**, with a worst reading of 18× its own solo
baseline, on a pool footprint of 8 × 17 MB where paging is arithmetically impossible. Under the
mechanism that used to act on that figure it would have shed repeatedly and finished narrow. It finished
at full width in 1.64 h instead, which is what "the range it fired on is a subset of the range it
false-fires on" looks like when the device is allowed to carry on.

**And the last two rows are the same device, before and after.** The Tab A 8.0 ran this size twice:
6.08 h at 2 workers of 4 planned, having shed 4 → 3 → 2, and then 2.87 h at 4 of 4 with 98% occupancy.
**2.12× on the same hardware** — and per worker-second the two runs are within 8% of each other, so
1.96 × 1.08 accounts for all of it. Almost the whole gain is the pool not narrowing; the 1024 → 2048 pass
is the 8%. The shed was costing this device **52% of its throughput**, which is worse than the third
recorded against its 65,535 in `docs/sidecars/README.md`.

### What the two tablets say about the strain figure

With both on build `.165` at the same size and the same 2 GB, the readings diverge completely:

| device | cores | wall | mean busy | `poolStrain` |
| --- | --- | --- | --- | --- |
| A7 Lite | 8 | 1.64 h | 7.87 of 8 (98%) | `over 1, panic 229, max 18` |
| Tab A 8.0 | 4 | 2.87 h | 3.92 of 4 (98%) | none at all |

Same build, same render, same memory, same occupancy, both finished at full width — and one read as in
trouble 229 times while the other never crossed a threshold. That isolates the mechanism: **strain is
measured against the first solo tile, so the ratio scales with pool width rather than with distress.**
Eight workers against a fast solo baseline read 10–18×; four against a slower one read nothing.
`STRAIN_AT = 3 + 3 × (n / hardwareConcurrency)` exists to correct for exactly this and under-corrects on
the 8-core device. It is a cleaner falsification of the ratio axis than the 1× to 18× range was, because
nothing differs between these two runs except the width the ratio is implicitly scaled by.

### Pool width at 1,048,576, and why `trace.busy` is not a saturation figure

Five renders of the same slab at the same 4096 pass, varying only the pool width — the first and only
size where the question has been asked with a hardware log attached.

| workers | mean busy | machine otherwise | wall | Mpx/s | Mpx/worker-s |
| --- | --- | --- | --- | --- | --- |
| 5, after shedding from 8 | 5.70 | quiet | **74.0 min** | **154.7** | 27.2 |
| 5, after shedding from 8 | 5.65 | quiet | **74.1 min** | 154.6 | **27.4** |
| 6 | 5.80 | a long video | 79.2 min | 144.6 | 24.9 |
| 8 | 7.90 | desk in use | 76.2 min | 150.4 | 19.0 |
| 8 | 7.83 | desk in use | 82.2 min | 139.4 | 17.8 |

**Fewer workers is the better pool and does not finish sooner.** Per worker-second the ordering is
clean and monotonic — 27 at five, 25 at six, 18–19 at eight — and the wall clock refuses to follow it.
The two 8-worker runs are 76.2 and 82.2, an 8% spread on one configuration, which is wider than any
difference between configurations and is the first thing to know before reading the rest.

**The figure that explains it comes from the hardware log, not the trace.** Aligned to each render's
own window, with the machine's own baseline subtracted from each — the 10 minutes before the 8-worker
run, the half hour after the 6-worker one:

| | 8 workers | 6 workers |
| --- | --- | --- |
| threads busy, machine alone | 1.49 | 1.04 |
| threads busy during the render | 4.91 | 5.21 |
| **the render alone** | **3.42** | **4.17** |
| per busy worker | **0.44** | **0.72** |
| pool reported busy | 7.83 of 8 (98%) | 5.80 of 6 (97%) |

So **the pool reports 97–98% busy while each busy worker consumes under three quarters of a thread,
and under half of one at eight.** Those are not contradictory readings: `trace.busy` counts a worker
from dispatch to completion, including everything it spends waiting on readback, transfer and deflate.
It is an occupancy figure and it has been read as a saturation figure — including in this document's
own 65,535 table, where "mean busy" should be understood as *how much of the pool was holding a tile*,
not *how much of the machine was working*.

And six workers put **22% more CPU into the render than eight did** (4.17 threads against 3.42) while
using two fewer. Two workers' worth of apparent width was buying nothing and costing scheduling.

### Nothing on this machine is the ceiling

Every candidate, measured in the same window as the renders above:

| | 8 workers | 6 workers |
| --- | --- | --- |
| CPU | 40.9% of twelve threads | 43.4% |
| memory load | 84%, 2,675 MB free | 90%, 1,542 MB free |
| page file | 1,218 MB | 1,427 MB |
| core temperature | 49.3 °C | 46.4 °C |
| package power | 31.7 W | 32.2 W |
| drive write | 5.4 MB/s at 3.6% busy | 5.7 MB/s at 6.5% busy |

Against a 12-minute **glass** render on the same machine, which pinned all six cores at 88–91%,
reached 68.8 °C and pulled 58.9 W. Stone at 1,048,576 takes six times as long while asking the machine
for half as much.

The drive figure is the one that closes itself: the same log shows the master being copied out
afterwards at **84.6 MB/s with peaks past 340**, so the render could write fifteen times faster and
does not. That is a comparison rather than an assumption — see `docs/resumable-render.md`.

### The paging premise, measured and false

The shed retirement's own note blames a three-hour 8192 render on paging. Measured across the full 85
minutes of load on the 8-worker run, from a 4,411 MB baseline:

- free memory touched **62 MB** at minute three of the ramp and was never near it again;
- the trend **rose in all seven** ten-minute windows;
- it finished at **4,768 MB — 357 MB above where it started**;
- the page file peaked 335 MB up and ended **83 MB below** its baseline.

The 6-worker run repeats it from a tighter 2,906 MB start: floor 122 MB, finished at 3,794 MB, page
file ending 73 MB below baseline. **Nothing was pushed to disk and kept, in either run.** That premise
had been carried as fact for weeks without an instrument pointed at it.

Strain tells the same story from the other side: the 8-worker run recorded **38 panics** and the
6-worker run **none at all**, on a render that was 4% slower and demonstrably no closer to any limit.
As with the two tablets above, the ratio tracks the width it is scaled by.

### The desktop tile walk

The same image at five tile sizes on both engines, 160 passes to 40,960 — a 256× range. 256 is below
the ladder and reachable only through `?tile=`, which exists for exactly this.

| tile | passes | Blink | Gecko | Blink Mpx/s | Gecko Mpx/s | Blink bytes | Gecko bytes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 256 | 40,960 | 5:31 | 15:40 | 8.1 | 2.9 | 0.58 | 0.66 |
| 512 | 10,240 | 97.0 s | 4:22 | 27.7 | 10.3 | 0.60 | 0.69 |
| 1024 | 2,560 | 43.9 s | 2:16 | 61.2 | 19.7 | 0.66 | 0.74 |
| 2048 | 640 | 27.1 s | 1:51 | 99.0 | 24.1 | 0.71 | 0.82 |
| 4096 | 160 | 22.9 s | 1:46 | 117.5 | 25.3 | 0.78 | 0.96 |

**The optimum tile is a property of the device, not of the renderer.** The desktop's is 4096 on both
engines; the S23 Ultra's is 2048, where 4096 costs it 35% — a 4104² tile is 67 MB, past any phone's
cache and against far less memory bandwidth. The planner picks correctly on each without being told.

### Per-tile overhead, and an architectural difference between the engines

The same pixels painted in 256× as many pieces. Each step doubles the passes; the figure is the cost of
each *extra* tile.

| step | Blink | Gecko |
| --- | --- | --- |
| 4096 → 2048 | 8.9 ms | 10.8 ms |
| 2048 → 1024 | 8.7 ms | 12.9 ms |
| 1024 → 512 | 6.9 ms | 16.4 ms |
| 512 → 256 | 7.6 ms | 22.1 ms |

**Blink's per-tile overhead is a constant. Gecko's is not.** Blink sits at 6.9–8.9 ms with no trend
across the whole range; Gecko starts higher and roughly doubles, rising about 30% each time the tile
count doubles.

That is the difference between a cost you can price and one you cannot. On Blink a render is
`paint + ~8 ms × passes`, and one measurement prices any configuration. On Gecko a tile count four
doublings past where you measured will cost about twice what the linear model says — extrapolating that
trend to 655,360 passes puts the marginal cost near 60 ms.

Whether it is true degradation or a longer render accumulating something — allocator pressure, GC, the
heat of a 15-minute run — these four points cannot say, because duration and pass count move together
across them. Separating the two needs a long render at a large tile, which nothing here provides.

### "Gecko is N times slower" is not one number

The figure depends on both the tile and the render size, and it moves by more than a factor of two
across the range measured here. Two things set it.

**The tile sets which cost you are measuring.** Fitting the Blink walk to `overhead + paint`, with the
overhead taken from the marginals and the paint scaling with tile area, reproduces every measured point
to within 2.6%:

| tile | measured ms/pass | model | paint | overhead share |
| --- | --- | --- | --- | --- |
| 256 | 8.07 | 8.13 | 0.53 | **94%** |
| 512 | 9.47 | 9.72 | 2.12 | 80% |
| 1024 | 17.15 | 16.07 | 8.47 | 44% |
| 2048 | 42.34 | 41.48 | 33.88 | 18% |
| 4096 | 143.13 | 143.13 | 135.53 | **5%** |

So a 256 tile is almost entirely machinery and a 4096 tile is almost entirely paint. And the two
engines differ by *different* amounts on those two costs — **2.9× on overhead, 4.7× on paint** — so the
gap you measure is a blend, and it walks between them as the tile grows:

| tile | 256 | 512 | 1024 | 2048 | 4096 |
| --- | --- | --- | --- | --- | --- |
| Gecko ÷ Blink | 2.84× | 2.70× | 3.10× | 4.11× | **4.64×** |

Gecko's own costs do not fit that model — its overhead is not a constant, so no single value describes
it — but the blend explains why the same two engines read as 2.7× apart at one tile and 4.6× at another.

**And the render size moves it again, in the other direction.** At a fixed 4096 tile, on the same slab,
with shed runs excluded and Firefox at 158.0 throughout:

| render | Blink ms/pass | Gecko ms/pass | gap | Blink Mpx/s | Gecko Mpx/s |
| --- | --- | --- | --- | --- | --- |
| 65,535 | 142.8 | 619.4 | **4.34×** | 117.5 | 27.1 |
| 262,144 | 120.5 | 285.3 | **2.37×** | 139.2 | 58.8 |

Gecko's cost per pass falls 0.599 then 0.769 across those two doublings while Blink's falls 0.844 over
both together, so this is Gecko converging rather than Blink degrading. Where it settles is not known:
two ratios are not a trend, and the 131,072 point has no clean comparator because the only Blink render
at that size and tile shed four workers.

The practical consequence is that **the fleet table above reads Gecko at its worst**. Those rows are
65,535 renders, which is the smallest size here and the one where the paint ratio dominates most
completely. The same engine on the same machine at 262,144 is within 2.4× of Blink rather than 4.3×.

Gecko also runs a less saturated pool at every size — **6.16 to 6.64 mean busy against Blink's 7.08 to
7.61** — which costs it about a tenth before any painting happens, and is a third difference again from
the other two.

### What tiling does to the picture, and what it does not

`light.mean` across each engine's whole walk:

| engine | 256 | 512 | 1024 | 2048 | 4096 |
| --- | --- | --- | --- | --- | --- |
| Blink | 61.51 | 61.49 | 61.49 | 61.50 | 61.50 |
| Gecko | 62.87 | 62.87 | 62.87 | 62.87 | 62.87 |

**Each engine holds its own constant to four significant figures across a 256× range in pass count**,
and the two differ from each other by 1.38. Tiling does not touch the light; the engine does. The
iPhone's 61.32 and the S23's 61.58 are each equally stable, and the iPhone's figure reproduces the
`61.32 / 40.2%` in the set above — measured a month earlier, on the pre-pool architecture.

The **bytes** do move, and monotonically: Blink 0.58 → 0.78 GB and Gecko 0.66 → 0.96 GB across the same
walk, +34% and +45%. Same total light, up to 45% more data. So the tile size changes the *spatial
detail* of the output and its compressibility, not its energy — the drawn halo is cut at every tile
edge, and more edges means more cuts, but no light is lost. Three engines and four devices agree on the
direction. `?tile=` therefore selects a slightly different picture as well as a speed, which is why a
master records the tile it was written at.

## The same slab at a 512 tile

Every device in the set rendered the published slab at a **forced 512 tile — 10,240 passes**, the most
any configuration in this project has taken. The point was not speed. It was to find out whether a tile
that small changes the picture, and what it does to a machine while it runs.

| device | engine | light | mean | lit>40 | time | median tile | slowest tile | throughput |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| iPhone 14 Pro | WebKit | black | 61.28 | 40.2% | 4.3 min | 22 ms | 67 ms | 10.68 Mpx/s |
| iPhone 14 Pro | WebKit | daylight | 71.17 | 58.4% | 4.7 min | 23 ms | 74 ms | 9.90 Mpx/s |
| desktop | Blink | daylight | 45.03 | 34.9% | 5.6 min | 29 ms | 955 ms | 8.21 Mpx/s |
| desktop | Blink | black | 61.49 | 47.0% | 6.2 min | 33 ms | 209 ms | 7.47 Mpx/s |
| S23 Ultra | Blink | daylight | 45.40 | 35.0% | 6.7 min | 33 ms | 105 ms | 6.90 Mpx/s |
| desktop | Gecko | daylight | 46.25 | 36.2% | 9.4 min | 33 ms | 240 ms | 4.91 Mpx/s |
| S23 Ultra | Blink | black | 61.58 | 47.1% | 10.4 min | 52 ms | 38,056 ms* | 4.45 Mpx/s |
| desktop | Gecko | black | 61.33 | 44.9% | 13.7 min | 62 ms | 401 ms | 3.37 Mpx/s |
| S23 Ultra | Gecko | daylight | 46.55 | 36.2% | 18.2 min | 64 ms | 481 ms | 2.53 Mpx/s |
| S23 Ultra | Gecko | black | 58.50 | 38.5% | 22.8 min | 106 ms | 552 ms | 2.03 Mpx/s |
| A7 Lite | Blink | daylight | 44.74 | 34.8% | 58.6 min | 292 ms | 712 ms | 0.79 Mpx/s |
| Tab A 8.0 | Blink | daylight | 45.40 | 35.1% | 58.7 min | 287 ms | 742 ms | 0.79 Mpx/s |
| A7 Lite | Blink | black | 61.33 | 46.9% | 61.5 min | 322 ms | 712 ms | 0.75 Mpx/s |
| Tab A 8.0 | Blink | black | 61.57 | 47.1% | 64.1 min | 330 ms | 971 ms | 0.72 Mpx/s |

\* One tile of 38,056 ms on the S23 under Blink. It is the only tile in that master over 2 seconds, its
p99 is 185 ms, and it accounts for 38 of that render's 623 seconds — an interruption on the handset, not
render work. It is left in rather than trimmed, because a figure quietly cleaned is worth less than one
explained.

Throughput counts the padded 520 px surface across all 10,240 passes: 2,769 Mpx rendered.

### The picture does not change

Each figure above is within a quarter of a unit of what the same device produced at its own much larger
tile — across tile changes of 8x, 4x and 2x:

| device / light | at its own tile | at 512 | delta |
| --- | --- | --- | --- |
| S23 Gecko, daylight | 46.55 @4096 | 46.55 | **0.00** |
| A7 Lite, black | 61.33 @1024 | 61.33 | **0.00** |
| Tab A 8.0, black | 61.58 @2048 | 61.57 | −0.01 |
| A7 Lite, daylight | 44.73 @2048 | 44.74 | +0.01 |
| iPhone, black | 61.32 @2048 | 61.28 | −0.04 |
| S23 Gecko, black | 58.42 @2048 | 58.50 | +0.08 |
| iPhone, daylight | 71.40 @2048 | 71.17 | −0.23 |

Two exact zeros and nothing past a quarter of a unit. Tile size is a memory and scheduling decision, not
a visual one — which is what makes it safe to take a smaller tile on a device that needs one.

### What it costs, and what it buys

512 costs **1.6x to 2.3x** the time, consistently across hardware from a 2019 budget tablet to a desktop.

What it buys is that **the machine stays alive**. The slowest single tile is the figure that matters, and
it collapses:

| run | median tile | slowest tile |
| --- | --- | --- |
| desktop Gecko @2048 | ~500 ms | **14,500 ms** |
| desktop Gecko @512 | 62 ms | **401 ms** |
| Tab A 8.0 @512 | 330 ms | **971 ms** |
| iPhone @512 | 22 ms | **67 ms** |

Excluding the one handset interruption noted above, **no tile anywhere in the fleet at 512 reaches a
second.** The same machine and engine that produced 9.4 and 14.5 second tiles at a 2048 tile has a worst
tile of 0.40 s at 512 — thirty-six times better.

That is why a 512 render feels different rather than merely slower. A 65,535 px export at 2048 blocks the
main thread for up to fourteen seconds at a stretch; at 512 the longest block on the slowest tablet in
the set is under a second, and the tablets stay scrollable throughout.

**The iPhone is the extreme case in both directions.** It is the fastest machine here at 512 —
10.69 Mpx/s, ahead of a desktop with a discrete GPU — and its slowest tile of the 10,240 is **67 ms**,
three times its own median. No other device in the set comes within an order of magnitude of that
consistency.

## The set: material × settings × device × renderer

The matrix this page exists to fill. A **cell** is a material with its settings — subsurface,
window, light — at one size on one slab; each cell wants both renderers on each device. GPU and CPU
are **different paths**, not two timings of one thing: they do not draw the same picture and carry
different render signatures, so a cell holding both compares *paths*, and the same cell on two
devices compares *devices*. A tablet cell has no GPU half and is complete with one.

Cut 2026-11-01 on build `2026.10.31.289`, every device, 65,535 × 40,959, universal master.

| | desktop | S23 Ultra | iPhone 14 Pro | A7 Lite | Tab A 8.0 |
|---|---|---|---|---|---|
| **glass** GPU | 21.6 s | 42.8 s | 25.7 s | — | — |
| **glass** CPU | 257.3 s | 511.0 s | 409.4 s | 2,236 s | **7,485 s** |
| *GPU is* | 11.89× | 11.93× | **15.95×** | no GPU | no GPU |
| **wood** GPU | 11.3 s | 18.2 s | 25.2 s | — | — |
| **wood** CPU | 109.6 s | 208.3 s | 141.5 s | 1,430 s | 3,665 s |
| *GPU is* | 9.68× | 11.46× | **5.62×** | no GPU | no GPU |
| **stone**, one window, GPU | 28.7 s | 121.4 s | 150.7 s | — | — |
| **stone**, one window, CPU | 25.8 s | 32.7 s | 69.4 s | 726 s | 886 s |
| *GPU is* | **1.11× slower** | **3.71× slower** | **2.17× slower** | no GPU | no GPU |
| CPU vs this desktop | 1.00× | 1.27–1.99× | 1.29–2.69× | 8.69–28.17× | **29.09–34.38×** |

**Both tablets are CPU-only by hardware** — they predate WebGPU, and no 2 GB device in this archive
has ever recorded a GPU render. See [`glass-gpu.md`](glass-gpu.md).

### Every row carries a validity check, and one row fails it

A GPU and a CPU master of one cell should draw the same picture. `light.mean` says whether they did:

| cell | desktop | S23 | iPhone |
| --- | --- | --- | --- |
| glass | **0.00** | **0.00** | **0.00** |
| wood | **0.00** | **0.00** | **0.00** |
| stone, one window | 1.00 | 0.63 | **17.03** |

Glass and wood agree to the second decimal on every device that has both paths, so those ratios time
one picture against the same picture. **The iPhone's stone pair does not**, and 17.03 is not a
rounding difference — the median across all 33 paired cells in this archive is **0.273**. That one
figure should be read as *two different pictures timed against each other* until it is looked at.
See "both renderers can be wrong" below.

### The weakest device is a flat multiple; the next one up is not

The Tab A 8.0 runs **29.09×, 33.45× and 34.38×** the desktop across the three materials — nearly
constant. The A7 Lite runs **8.69×, 13.05× and 28.17×** — a 3.2× swing over the same three. Two
2 GB tablets, and only one of them degrades uniformly. They differ elsewhere too: the Tab A is the
only device in the fleet with a **4096 texture ceiling**, it is the only one that needed a **1024
tile** for anything (wood, 2,560 tiles, 61 min, where every other device-material pair took 2048),
and it is the only one that cannot load `storm treeline v21` — while the A7 can.

**Glass on the Tab A is the longest render in the set**: 2 h 04 m for a 29 MB file. The material the
GPU likes most is the one the weakest CPU likes least.

## The GPU against the CPU, build and configuration held fixed

The wider evidence behind the three rows above. Measured 2026-11-01 from the masters' own records. **Only pairs that share a build *and* a complete
configuration are listed**, because both confound this comparison badly and in opposite directions:
six CPU changes took a 65,535 from 7.645 min to 4.743 over the period these records cover, so a GPU
master from one build against a CPU master from another measures the GPU and five weeks of CPU work
at once. The configuration matters just as much — a first pass of this table keyed only on material,
size, light and tile, and it got three rows wrong, one of them by **sign**. `bloomDraw`, `windows`
and `sigma` all change the work and all now sit in the key.

What survives is 22 pairs on two devices.

### Desktop — Blink, 12 hc, RX 6500 XT

| build | cell | n GPU/CPU | GPU | CPU | GPU is |
| --- | --- | --- | --- | --- | --- |
| `.24.186` | glass 32,768 | 1/1 | 31.87 s | 89.16 s | 2.80× |
| `.25.215` | glass 32,768 | 1/1 | 5.40 s | 133.07 s | 24.64× |
| `.25.216` | glass 32,768 | 2/5 | 4.16 s | 105.04 s | 25.23× |
| `.25.218` | glass 32,768 | 5/3 | 4.54 s | 112.72 s | 24.85× |
| `.25.221` | glass 32,768 | 2/1 | 4.06 s | 223.32 s | **54.96×** |
| `.31.284` | glass 32,768 | 1/1 | 3.25 s | 67.20 s | 20.68× |
| `.31.284` | glass 32,768, 4096 tile | 1/1 | 7.66 s | 79.62 s | 10.39× |
| `.24.186` | glass 65,535 | 2/1 | 104.62 s | 357.91 s | 3.42× |
| `.25.211` | glass 65,535 | 2/2 | 11.21 s | 248.05 s | 22.14× |
| `.31.271` | stone 4,096, subsurface | 1/1 | 0.70 s | 13.00 s | 18.65× |
| `.31.272` | stone 4,096, subsurface | 2/2 | 0.78 s | 14.41 s | 18.42× |
| `.31.275` | stone 4,096, subsurface, **one window** | 1/1 | 0.98 s | 1.28 s | 1.31× |
| `.30.251` | stone 4,096, subsurface, 4096 tile | 3/1 | 1.24 s | 9.77 s | 7.86× |
| `.29.234` | stone 16,384, subsurface | 1/1 | 3.36 s | 131.79 s | 39.18× |
| `.31.253` | stone 16,384, subsurface | 1/1 | 2.37 s | 97.14 s | **40.99×** |
| `.29.238` | stone 32,768, subsurface, 4096 tile | 1/1 | 27.32 s | 471.61 s | 17.26× |
| `.29.234` | stone 16,384 **UV, halo moved** | 3/1 | 5.14 s | 4.39 s | **1.17× slower** |
| `.29.247` | wood 16,384 | 3/3 | 1.15 s | 7.94 s | 6.88× |

### S23 Ultra — Blink, 8 hc, Snapdragon 8 Gen 2

All four on build `2026.10.31.289`, all 65,535 on a 2048 tile. **The only device in the archive with
every material paired on a single build**, which is why it is the one that shows the next finding.

| cell | n GPU/CPU | GPU | CPU | GPU is |
| --- | --- | --- | --- | --- |
| glass | 2/2 | 42.82 s | 511.04 s | **11.93×** |
| wood | 1/1 | 18.17 s | 208.29 s | **11.46×** |
| stone | 1/1 | 121.36 s | 32.70 s | **3.71× slower** |
| stone, subsurface | 1/2 | 176.75 s | 35.93 s | **4.92× slower** |

### iPhone 14 Pro — WebKit, 4 hc, A16 Bionic

Added 2026-11-01, hours after this section first said the iPhone had no pair. It now has exactly one,
and it is the cleanest in the set — **16 of 17 configuration fields identical**.

| build | cell | n GPU/CPU | GPU | CPU | GPU is |
| --- | --- | --- | --- | --- | --- |
| `.31.289` | glass 65,535, subsurface 2 | 1/1 | 26.10 s | 463.91 s | **17.77×** |

The one field that differs is **`workers`: 1 on the GPU against 4 on the CPU.** That is not a
mismatched pair, it is what choosing the GPU *means* — a pool is many queues into one card, so the
GPU path runs one. It is listed because a reader checking the pair would otherwise find the
difference and not know which it was.

**Not comparable to the S23 rows above on subsurface**, which ran `G.subsurface` 1 against this
pair's 2.

**Both tablets have none and never will** — they predate WebGPU, and no 2 GB device in this archive
has ever recorded a GPU render. See [`glass-gpu.md`](glass-gpu.md).

### A device can serve a stale build, and only the master says so

Of sixteen masters pulled off the iPhone on 2026-11-01, **thirteen were build `2026.10.24.187`** — a
week old — including every one rendered during the night of the 31st, while the S23 was rendering the
same slab on `.289`. The phone was reported as "acting odd, running kinda slow" at the time and this
is the likeliest reason. The two `.289` masters above arrived only the following morning, after the
cache turned over.

**So a fleet comparison has to read `build` from each master and not from the day it was made.** Of
the three glass-with-subsurface GPU masters on that phone, the `.187` one took **28.2 minutes** and
the `.289` one **26.1 seconds** — which is *not* a build speedup: the older render carried
`sigma` 524, `bleed` **1577** and one window against the newer one's 0, 4 and none. Different work
entirely. The comparison that looks most dramatic here is the one that means least, and only the
record distinguishes them.

### No single multiple describes this renderer

One cell — glass, 32,768, daylight, 2048 tile, desktop, identical configuration — returns **2.80×,
20.68×, 24.64×, 24.85×, 25.23× and 54.96×** on six builds. That is a **19.6× spread in the ratio
itself**, and the two legs move independently: the GPU figure ranges 3.25 s to 31.87 s and the CPU
figure 67.2 s to 223.3 s across the same six. `.24.186` is the GPU's first shipping build and is the
2.80×.

So a GPU multiple quoted for this renderer is a statement about one build, one device, one material,
one size and one window count simultaneously. The earlier proxy estimate of 1.3–1.9× in
[`glass-gpu.md`](glass-gpu.md) is below every figure in both tables; that page records why.

### The sign is not constant, and it turns on the cell rather than the material

Glass and wood go to the GPU by 5.6–16× on every device that has one. **The stone cell with a
window goes the other way on all three — 1.11×, 2.17× and 3.71× slower.** But stone *without* a
window wins 7.8–41× on the desktop, so the material is not what decides it; the cell is. A window
composites over a finished tile (`stone-author.html`, the `compositeWindow` call in the tile path),
which is CPU work the shader cannot take, and the GPU path runs **one worker** against the CPU
path's four to twelve — so the un-accelerable part runs single-threaded on the GPU side.

That mechanism is read from the code and consistent with the figures; it has not been isolated by
ablation, and the window pairs are few. Stated as the leading explanation, not a measured one.

**What is not held fixed is the width.** Every S23 row is 65,535 and every desktop stone row is
4,096 to 32,768, so the divergence is device, size, or both, and these records cannot separate them.
A desktop stone-with-subsurface pair at 65,535 exists but spans builds `.237`–`.253` on the GPU side
against `.231` on the CPU side, which is exactly the confound this section excludes.

### UV on the shader is measured, and it is not a win

`uvMode && BLOOM_DRAW` refuses the shader, because under a spectrum the drawn halo *is* the picture
and the shader reads one pixel. `?bloom=blur` moves that halo into `applyCoat` after the shader hands
its face back, and the shader then accepts the slab. Those three desktop UV masters are that path —
`bloomDraw` absent, `sigma` 131 — and they are **1.17× slower than the CPU**, 5.14 s against 4.39 s.
The GPU leg spreads 40% (4.40, 4.55, 6.48 s) against a single CPU record, so read it as *no
measurable gain* rather than as a precise loss. It is the only measurement of this path there is.

### One window collapsed the advantage

`.31.275` returns 1.31× where `.31.271` and `.31.272` return 18.65× and 18.42× — same material,
size, tile and subsurface, on three consecutive builds, differing in `windows`. One record against
two, on a field nothing else here varies deliberately. Named because it is in the data, not
concluded.

### A ratio across devices is partly a ratio of worker counts

**The GPU path runs exactly one worker on every device** — measured on all three that have one. The
CPU path runs 4 to 12. So a GPU/CPU ratio is one GPU against *N* CPU workers, and *N* differs:

| device | CPU workers | glass ratio | CPU worker-seconds |
| --- | --- | --- | --- |
| desktop | 8 | 11.89× | 2,058 |
| S23 Ultra | 8 | 11.93× | 4,088 |
| iPhone 14 Pro | **4** | **15.95×** | **1,638** |
| A7 Lite | 8 | no GPU | 17,890 |

The iPhone's ratio is the fleet's highest on glass because it has the least parallelism to
surrender, not because its shader is better. Normalise it away and the order changes: per CPU
worker-second the iPhone is the **fastest machine here**, which independently reproduces this page's
earlier finding that its deficit is Safari's four-worker cap rather than its silicon. On the GPU
path, where everyone runs one worker, the three land within 2× of each other.

**But the correction does not generalise either.** On wood the iPhone's ratio is **5.62×, the
fleet's lowest**, with the same four workers. The denominator did not move and the answer inverted,
because its GPU is 1.19× the desktop's on glass and 2.23× on wood. Worker count explains one cell
and fails on the next — which is the argument for the whole matrix rather than a headline number.

### Both renderers can be wrong, and the one that looks right did less

On the iPhone's `storm treeline v21` cell, every configuration field is identical except `gpu`
itself — and the two renders disagree by **48.76** of mean. Read from the stored pixels with
[`thumb-master.mjs`](../tools/thumb-master.mjs):

| | pixels exactly R=G=B | mean channel spread | `light.mean` | `lit40` |
| --- | --- | --- | --- | --- |
| GPU | **54.6%** | 2.78 | 59.10 | 61.89 |
| CPU | 11.9% | 8.47 | 107.86 | 87.88 |

**The GPU dropped the colour** in the fog and the moon — over half the picture is literally R=G=B —
while keeping it on the marks. **The CPU applied it and shattered**: stepped concentric banding
through the moon, hard-edged rectangles at sub-tile scale, washed out. One declined the work and one
broke doing it, and the one that declined is the one that looks correct.

**The GPU master passes every guard the harvester has.** `blackFrame` wants `light.mean === 0`; it
reads 59.10. `nothingLit` wants `lit40 === 0`; it reads 61.89. It would be recorded as good and the
master deleted — the same shape as the three wood masters at mean 23.33 that `lit40 === 0` was added
for, except this one does not trip that guard either, because the picture *is* lit. It simply is not
coloured. A greyscale-share figure separates them cleanly: 54.6% against 11.9%.

**And the scale of the look decided the answer.** At `--cell=64` each cell is the mean of a 64×64
block, which turned the CPU's blockiness into smoothness and made the broken render read as the
clean one. The defect only appeared at `--cell=256` over a region. A mean finds candidates to look
at; the looking has to happen at the scale of the artifact.

## The machines

### Desktop — AMD Ryzen 5 5500, Radeon RX 6500 XT

6 cores / 12 threads at 3.6 GHz, 16 GB (2 × 8 GB @ 3600), Windows 11 Home 10.0.26200. The reference
machine: the figure everything else is calibrated against, **61.33**, was made here with the image-space
bloom at 65535 in 3.0 minutes.

It is the only machine that reports its memory honestly — 16 GB installed, 16 GB reported — and the only
one that ever took an 8192 render tile, which is why its 40 passes are the fewest in the set — and why
that figure is now historical: **8192 left the tile ladder on 2026-10-20** and the largest tile is 4096.
Its
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

**The GPU's advantage is not one number, and not even one sign.** Same renderer, same device, same
configuration: 2.80× to 54.96× across six builds of one cell. And on the S23 glass and wood go to the
GPU by 11.5× while stone goes the other way by 3.71×. Any figure for "what the GPU buys" is a
statement about a build, a device, a material and a size at once.

**Reported capability figures are unreliable in every direction.** Core counts are threads. Memory is
rounded down, clamped at 8, and describes installed rather than available. `MAX_TEXTURE_SIZE` bounds the
tile and not the output. The user-agent reports Android 10 on all three Samsungs and is wrong on all
three. Two browsers on one handset disagree about its pixel ratio and its texture limit. This is why the
planner measures a real tile before committing rather than trusting any of it.

## Reproducing any of this

See [`reproduce.md`](reproduce.md). The app, the slab and the readers are all here; the masters are not,
because a download you could only checksum proves the file was not edited rather than that the renderer
works.

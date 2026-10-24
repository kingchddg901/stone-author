# What a master's own clock can be asked

Every master carries `ms.render` and a `perTile` array. Those two fields have been written for months
and read as "how long it took" and "where the time went", and both readings are wrong in ways that
matter — one of them by a factor of fifteen.

This doc states what the fields actually mean, gives the two checks that recover the truth from them,
and reports what those checks found when run over every long render in the archive. Nothing here
needed new instrumentation. The data was always there; the questions were not.

## `ms.render` is not the render time

It is wall clock from the top of **this session's** tile loop:

```js
const tR = Date.now();
...
const msRender = Date.now() - tR;
```

A render that lost its page and resumed starts that clock again. The tiles already on disk are
replayed into the master from their stored rows, so the file is complete and correct — but the time it
reports covers only the part rendered after the reload.

**Measured, on a Tab A 8.0 that reloaded mid-render:**

| | |
| --- | --- |
| `ms.render` | 3:28 |
| real elapsed | **52:35** |

A **15× understatement**. Taken at face value that master makes the slowest device in the fleet look
like the fastest by a wide margin, and nothing in the file says otherwise — `resumeSig` deliberately
excludes the build so a job can survive a deploy, and no field records that a resume happened at all.

## `perTile.ms` is a consumer timeline, not per-tile durations

It is tempting to read the array as "what each tile cost". It is not. Entries are elapsed consumer
time charged to whichever tile the main thread was handling, so with eight workers a batch that
finishes together puts one large value in the array and **zeroes** beside it. In the archive 24–41% of
entries are zero while *every* tile has bytes.

Two consequences, and they point opposite ways:

- **Sums are real.** `sum(perTile.ms)` equals wall clock on an uninterrupted render, because the clock
  starts at the top of each iteration. Block sums and row sums are honest elapsed time.
- **Per-entry means are not a cost.** "The dearest tile took 12,489 ms" is an artefact of which tile
  the consumer happened to be holding. Any analysis dividing by the number of non-zero entries is
  measuring the pool's scheduling, not the picture.

The honest per-tile figure is `wall / grid`, and the honest shape is block sums.

## The two checks

Both fall out of the above, both work on any master with per-tile timings, and neither needs a field
that does not already exist.

### 1. `sum(perTile.ms) / ms.render` — did this render resume or stall?

On 796 of 801 masters this ratio sits within 5% of 1.00. The exceptions are diagnostic:

- **above 1.05 — resumed.** The array holds work this session did not do. The Tab A's 32,768 reads
  **15.15**; a 262,144 from 2026-10-21 reads 1.15, meaning its reported 2.87h was really **3.31h**.
- **below 0.95 — stalled.** The wall holds time no tile accounts for. A 16,384 on android-firefox
  reads 0.650: 690 s of tiles inside a 1,062 s wall, so 372 seconds where nothing was being consumed.

### 2. Second half against first — did it degrade through the run?

Sum the block totals for the back half and the front half and compare. **Every uninterrupted render in
the archive reads negative**, between −1% and −49%, because the opening tiles carry a ramp. So a
*positive* number has to overcome that tailwind to appear at all, which is what makes it unambiguous.

## What the checks found

Run over all twenty renders of an hour or more:

- **1 resumed**, its duration understated by 13% in every comparison made since.
- **0 stalled.**
- **9 degraded**, and they are not scattered.

### Every 1,048,576 on the desktop degrades, and it is memory, not heat

The eight 1,048,576 stone renders read `+17, +2, +17, +9, +17, +5, +8, +2`. The same machine's 65,535
*glass* renders read **−15%**. Same night, same build, opposite directions.

Hardware monitoring separates them. Across the 1M stone runs free memory floored at **312–468 MB** and
the page file rose **658 MB**; across glass it never fell below **1,773 MB** with the page file flat at
1,300 MB. The CPU held **4,197 MHz throughout both** and never throttled.

So the 1M renders slow down under memory pressure that accumulates as the job proceeds, and glass —
whose whole working set is one 17 MB tile — has nothing to accumulate. **A degradation reading is not
a thermal reading until something else says it is.**

### A 3.78-hour render that should have taken two minutes

A 32,768 sequential on win-firefox, 2026-09-29. Its tenths, in seconds:

```
  70  23  26  26  1768  2971  3080  3005  2607  34
```

Four tenths in 145 seconds, then three and a half hours in the middle, then the last tenth in 34. That
is not a slow processor and not throttling — nothing throttles by 6× and then recovers. A 32,768
sequential render holds a 2.68 GB canvas; this is a memory wall and an eventual recovery. Chrome
renders that size in about two minutes, so the run was roughly **100× slower than the machine can do
it**, and all of it in the middle 60%.

It sat unexamined for a month because nothing in the master says "this went wrong" — only the shape of
its own timings does.

## Degradation across the fleet

| device | render | workers | second half vs first |
| --- | --- | --- | --- |
| desktop (fan, 50.8 W) | 65,535 glass | 8 | −15% |
| desktop | 1,048,576 stone | 4–8 | +2% to +17% *(memory)* |
| iPhone 14 Pro, cold | 65,535 glass | 4 | **−28%** |
| iPhone 14 Pro, hot | 65,535 glass | 4 | **+3%** |
| S23 Ultra | 65,535 glass | 8 | −8% |
| Tab A 8.0 | 32,768 glass | **4** | **−2%** |
| A7 Lite | 65,535 glass | **8** | **+25%** |

Two things read off that table.

**Power density, not size.** The device that sagged first was the *fast* phone in a hand-sized
aluminium body, not the slow tablet with room to spread. The desktop, the only machine with a fan,
never moved.

**Worker count is the power knob, and it overrides the body.** The Tab A and the A7 Lite are the same
class of device. The Tab A ran four workers for 52 minutes and read −2%; the A7 ran **eight** for 65
minutes and read **+25%**, with its tenths steady near 300 s and then spiking to 730 s late:

```
  510  288  302  313  309  300  292  346  730  485
```

So a fleet timing taken at eight workers on a fanless device is measuring the throttle as much as the
silicon, and the same device at four workers is not.

## Comparing two builds needs the free-memory floor beside the clock

A build-to-build timing comparison on this machine is not interpretable without the minimum free
memory of each run. Measured on three consecutive builds rendering the same slab at 65,535, same
tiling, same worker count, same `inputs` signature:

| build | render | clock | temp | cpu | **min free RAM** |
| --- | --- | --- | --- | --- | --- |
| `171` | 7.68 min | 4171 | 57.5 | 72.2% | 2,448 MB |
| `171` | 7.61 min | 4186 | 59.4 | 74.4% | 2,120 MB |
| `172` | 6.70 min | 4169 | 58.3 | 71.5% | **439 MB** |
| `173` | 6.18 min | 4148 | 59.7 | 71.5% | 1,584 MB |
| `173` | 6.16 min | 4206 | 57.4 | 69.2% | 1,584 MB |

**Clock, temperature and CPU match across all five to within about 1%. Only memory differs, and it
differs by four to six times.** The `172` run sat in the same 312–468 MB band this doc already
names as the cause of 1M degradation, and it is handicapped by roughly 0.44 min — 7%.

That one bad run sits on *both* comparisons it takes part in, and it pushes them in opposite
directions. Against `171` it makes the analytic gradient look **smaller** than it is: the published
12.4% is a floor, and the clean `171`→`173` pair is 19.3% for both changes together. Against `173`
it makes the relief guard look **larger** than it is: 7.9% from the clocks against ~1% from three
measurements that hold memory fixed.

**The two changes can still be separated, without a third clean render.** The un-starved anchors
bracket them: `171` pays three `glassFormT` evaluations a sample and `173` pays one, so the
difference between those two is twice the in-render cost of one call — `x` = 0.7375 min, which is
132 ns a call across eight workers over 2.68 G samples. Timing the shipped functions against each
other gives the derivative algebra at 0.090 of one call, so `a` = 0.066 min and a clean `172` would
have run 6.24 min rather than the 6.70 it recorded:

| | worth at 65,535 |
| --- | --- |
| analytic gradient, build `172` | **18.4%** |
| relief guard, build `173` | **1.06%** |
| both together | **19.3%** — measured directly, no model |

Only `a/x` comes from a bench rather than a master, and **the split is insensitive to it**: the
guard is small, so doubling its figure moves the gradient by half a point. The guard's 1.06% also has
an independent confirmation — a tile rendered at `relief: 0` against `relief: 1e-12` inside one page
load reads 1.0%, with the output verified identical between the arms.

**The tell was that the saving disagreed with itself across two widths.** The guard removes a fixed
slice of per-sample work, and both rungs render the same slab, so its saving *cannot* depend on
render width — yet it came out 20.9% at 32,768 and 7.8% at 65,535. A 13-point spread in a quantity
that must be constant is proof that an input is wrong, not a reason to average the two.

Three things follow, and they apply to every optimisation measured from here on:

- **Record the free-memory minimum with every timing comparison**, not the mean: the `172` run
  averaged 1,759 MB and bottomed at 439.
- **Prefer an A/B inside one session** over two renders on different days. Where a change is a
  runtime branch it can be measured without a second build at all — the relief guard is
  `REL > 0`, so rendering at `relief: 1e-12` takes the expensive path with a brightness
  contribution of nil and reproduces the previous build's work exactly, output verified identical.
- **A microbenchmark of the same arithmetic runs about 1.7× faster than the render does.** One
  `glassFormT` call times at 76.9 ns in a tight 1,600-point loop and costs ~130 ns in the render,
  where the coordinates are all distinct and the branches are cold. Use the microbenchmark for
  *ratios* between two functions and the renders for absolute scale.

## Wall time divided by busy threads separates three causes that look alike

`ms.render` alone cannot tell a slower machine from slower code from a worse schedule. Multiplying
wall by the mean busy threads from a hardware log gives **core-seconds**, the total work, and the two
numbers together name the cause:

| wall | core-seconds | what it is |
| --- | --- | --- |
| up | **up** | more work per sample — the code, or the optimiser's treatment of it |
| up | flat | the same work, badly spread — load imbalance, stragglers, a serial consumer |
| up | up, with lower clocks | the machine — check clocks, temperature and the free-memory floor first |

Measured on five 32,768 renders of one build on a quiet box, byte-identical output: 700 to 872
core-seconds, a **25% swing in total work for identical work done**. That could not be imbalance,
and the block sums were slow in every fifth rather than only the first, so it was not a warm-up
either. It was the optimiser declining to inline a function that had grown — see
`glass-one-pixel.md`. Outlining the cold path took the spread from 17.2% to 0.8%.

### How quiet the box has to be, and it is quieter than it looks

Core-seconds only measure the render when nothing else runs, because the thread sum counts every
thread on the machine. Under foreign load it measures the machine.

**Measured the hard way: a build was reverted as a 3.7% loss and the same build later came back 3.4%
faster.** The runs that condemned it sat at **8.25 and 8.23 busy threads** against the comparison
set's **8.02–8.09**, and that 0.2 was read as noise. It is 2.5% of eight workers — comparable to the
effect being measured, and it inverted the sign. Free memory was 1,000 MB lower in the same rows and
that was read past too.

| effect being measured | the box has to be held to |
| --- | --- |
| 10% or more | eyeballing the CPU trace is enough |
| ~3% | **better than 1% of the pool — 0.08 threads of 8** |
| under 1% | not resolvable on this machine; use more runs or a longer render |

Two practical rules fall out. **Record the busy-thread count beside every timing and compare it to the
baseline's, not to an idea of idle** — a window that reads 12% CPU can still be 0.2 threads above the
run it is being compared with. And **a build must not be handed over for rendering in the minutes
after a gate sweep**: 37 node processes at 90% CPU were still clearing when the next render started,
and the triplet that followed trended 1.722, 1.686, 1.620 as they drained — monotonic improvement is
the shape of decaying contamination, not of a build warming up.

**A falling core-second count with a flatter wall gain is the signal that a render has stopped being
compute-bound.** At 32,768 the same change took 9.4% off the work and 4.5% off the clock, with busy
threads dropping from 8.3–8.6 to 8.0 — the workers outran the consumer. That is a real ceiling and it
arrives at small sizes first.

## A render gets slower the longer its page has been open

**Measured across six sessions on 2026-10-23, at 65,535 on one slab.** He reloads the app only to
change build, so each build's runs are one page session:

| build | #1 | #2 | #3 | #4 | #5 | #2 vs #1 | last vs best |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `173` | 6.179 | 6.165 | | | | −0.2% | 0.0% |
| `174` | 6.032 | 6.007 | | | | −0.4% | 0.0% |
| `175` | 5.383 | 5.314 | | | | −1.3% | 0.0% |
| `177` | 5.216 | 5.204 | | | | −0.2% | 0.0% |
| `181` | 4.894 | 4.769 | **5.280** | | | −2.5% | **+10.7%** |
| `182` | 4.704 | 4.722 | 4.733 | 4.815 | **5.076** | +0.4% | **+7.9%** |

**Every two-run session is tight. Every session of three or more has its last render 8–11% slow.**
The second render is usually the fastest — a warm-up of about half a percent — and then it turns.
`182`'s five runs rise monotonically in wall AND in core-seconds, 2251 → 2213 → 2253 → 2291 → 2437,
while the clock falls only 0.8%. So it is work, not boost and not the machine: the box sat at 4.5–10%
for the whole half hour before that fifth run.

This is the degradation the app's own note beside `_warpMemo` records — the same build measuring
34,782 ms late in a session and 15,648 immediately after opening a fresh tab. What is new here is the
SIZE of it inside four renders, and that it is invisible unless a session is run past two.

**It cost a diagnosis.** Build `181`'s slow third run was read as the spin table going bimodal on a
256 KB footprint, and the 64 KB table was built to fix it. Compared like-for-like by position the
shrink is worth **3.9% at #1 and 1.0% at #2**, with core-seconds at positions 1–3 below `181`'s best
— real, but a few percent rather than the removal of a mode that was never there.

**Two rules follow.** Compare renders at the SAME position in their session, never a first against a
third. And treat anything past the second render in one page as carrying an unknown penalty: reload
between them, which costs seconds and is the only thing known to reset it.

## Comparing two designs: build both, interleave, keep the best of each

Chris's protocol, adopted 2026-10-24 after a day of picking designs by microbench and having the
renders disagree. **Build both candidates, measure each on real renders, then combine.** Not: reason
about which ought to win.

The bench had earned no such trust. On that one day it priced a radius-indexed spin table 8 points
above an angle-indexed one and that choice was never tested on a render; it said unrolling the op
chain was worth 19% where the render said 2-3%; it preferred a generated chain built per tile that
was slower in production; and it could not see the cache effect that made a 256 KB table bimodal.
Four design calls, and in every one the only number that settled anything came from a master.

**Stage both as two copies of THE APP; do not revert between them.** The app, not a harness page:
the harness has no export and never writes a master, so it cannot produce the only number that
settles anything. `app/stone-author.html` is self-contained, so two copies with two filenames
coexist and either can be opened. No dirty tree, no revert step, no chance of measuring a
half-reverted mixture, and the pair is still re-runnable a week later - which a revert is not.

**Each copy carries its own build marker, so every master self-identifies its arm.** That is what
makes interleaving free: render in any order, keep no notes, and the pairing is reconstructed
afterwards from the `build` field the files already record. It is also the only version of this that
survives a mistake - a master cannot be filed under the wrong arm, because nobody files it.

**Interleave, do not block, and the strongest reason is the section above.** `A B A B A B`, not
`AAA` then `BBB`. Two drifts are in play. The box drifts: a gate sweep at 90% CPU was still clearing
when a triplet started and sent it 1.722 -> 1.686 -> 1.620 as it drained. And the PAGE drifts: the
last render of a session runs 8-11% slow, which is larger than most differences worth measuring.
Blocking lets both land entirely on one arm.

**Switching between two app files handles the page drift for free**, because loading the other file
is a fresh page - so an interleaved sequence puts every render at position #1 or #2 of its own
session, which is exactly where the table above says a render is trustworthy. Interleaving within one
page would not: it would spread the drift evenly but still accumulate it.

**Three runs an arm, not two.** Two runs on build `181` agreed at 4.769 and 4.894 and were both
wrong about the build; the third read 5.280 and exposed a 10.8% spread. A pair that agrees is not
evidence of a tight build - it can be two samples from one mode of a bimodal one.

**And read core-seconds, not only the wall.** Interleaving removes drift between the arms; it does
not say whether a difference is work or scheduling. The table above does.

**Combining is usually available, and is the reason to build both rather than choose.** The spin
tables are the live example: the angle form won on simplicity - one universal table, no maximum
radius to bound, no fallback branch - while the radius form measured faster by skipping the turn
reduction. That read as a straight trade until the 64 KB finding showed entry count was never the
constraint, which means a 4,096-entry **radius** table would be the same 64 KB and keep the speed.
The best of both was reachable and the bench could not see it, because what decided it was cache.

## What this does not recover

`trace.busy` exists on 50% of the long renders and `poolStrain` on 25% — both are newer than the
renders, so per-worker scheduling on the old ones is gone for good. Everything derived from per-tile
timing is not, which is most of what is worth asking.

Neither check is wired into a tool. `tools/split-hwinfo.mjs` and `tools/sweep-masters.mjs` are the
natural homes — a master that resumed or degraded should not join a timing comparison silently, which
is exactly what has been happening.

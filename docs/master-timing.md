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

## What this does not recover

`trace.busy` exists on 50% of the long renders and `poolStrain` on 25% — both are newer than the
renders, so per-worker scheduling on the old ones is gone for good. Everything derived from per-tile
timing is not, which is most of what is worth asking.

Neither check is wired into a tool. `tools/split-hwinfo.mjs` and `tools/sweep-masters.mjs` are the
natural homes — a master that resumed or degraded should not join a timing comparison silently, which
is exactly what has been happening.

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

## What this does not recover

`trace.busy` exists on 50% of the long renders and `poolStrain` on 25% — both are newer than the
renders, so per-worker scheduling on the old ones is gone for good. Everything derived from per-tile
timing is not, which is most of what is worth asking.

Neither check is wired into a tool. `tools/split-hwinfo.mjs` and `tools/sweep-masters.mjs` are the
natural homes — a master that resumed or degraded should not join a timing comparison silently, which
is exactly what has been happening.

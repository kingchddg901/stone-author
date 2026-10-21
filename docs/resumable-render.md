# A render that survives losing the page

Status: **built, proven, and ON BY DEFAULT since 2026-10-16.** A 32,768 was rendered, killed near half
way, picked up and finished - and `check-same-image` found it **byte-identical to the same picture
rendered straight through**: 280,144,040 image bytes, byte for byte. Stages 1 to 4 below are done.

**The break-and-catch is done, and it is the half that mattered.** A build that transposed two entries in
the tile directory produced a master the gate called **IDENTICAL**: the tile *data* was untouched, so
nothing comparing the stored region could see that two tiles had swapped places. The GATE was wrong, not
the resume. `sameDirectory()` closed that, and [positional marking](positional-marks.md) exists because
of it - every tile now carries the address it believes it holds. Both are gated:
`check-same-image --selftest` case 13, and [`tools/check-placement.mjs`](../tools/check-placement.mjs)
against a real master.

`?resume=0` turns it off, for a render that must start clean or a device whose record is suspect.

**What it will not do.** A resume needs the OPFS writer: a device that cannot open a sync access handle
starts clean rather than pretending. A record belonging to another picture is refused on `renderSig`,
silently and finally - there is no adapting one to a job it was not written for.

**A RESUMED MASTER UNDERSTATES ITS OWN COST.** `ms.render` covers the sitting that FINISHED the file.
Per-tile values are arrival intervals and sum to wall clock - 1.000 on every single-sitting master - so
on a resumed one they sum across both sittings. The killed 32,768 reported 19.7 s and summed to 42.3 s,
against 41.4 s for the same picture in one go: **2.3% apart**, which is the resume doing the same work in
two halves rather than saving any of it. `tiff-meta` prints both, because the single figure is the one
these tables quote.
The record below - what is durably done, and what must match before a resume is legal - lives in the app
as `resumeSig`, `resumeRow`, `resumeScan` and `resumeState`, and `tools/probe-resume.mjs` lifts those four
and replays a crash at every row. Stages 1 to 4 are still ahead of it.

## Why

On 26 September three 65535 masters were lost, each after more than an hour of work, and each to a
different cause:

| what happened | what it killed |
| --- | --- |
| the tablet's screen went to sleep overnight | a completed grid, at an unknown tile |
| two devices uploaded a file under the same name | a finished 90-minute master, after the render |
| the tablet took an Android 13 upgrade mid-render | a UV master around tile 140 |
| **2026-10-12:** `tiffLayout` threw on the first byte of the directory | **a 262144 master, 95 minutes, with all 2560 tiles already written** |

The second was a tooling bug and is fixed. The first has a partial answer in the screen wake lock. The
third has no answer at all, and neither does the next cause we have not met yet — a browser crash, an
out-of-memory kill, a closed tab, a power cut.

**The fourth is a different class, and it is the one that makes the case.** Nothing was lost. The page
did not close, the device did not sleep, the OS did not update, memory was never short. The render *ran
to completion* — 2560 of 2560 tiles painted, compressed and written — and then `tiffLayout` computed a
negative alignment gap and threw before the first byte of the directory was written. `pad8` used
`(n + 7) & ~7`, and `&` coerces to **signed** int32, so it wrapped at 2^31 rather than at the 2^32 it
looks like it has. Tile data ending at 4,264,729,215 bytes produced `gap = -4294967295`, and
`new Uint8Array(gap)` ended ninety-five minutes of work.

The bug is fixed (`Math.ceil(n / 8) * 8`, exact to 2^53) and gated by `tools/probe-tiff-offsets.mjs`,
which reproduces the field failure to the error string. That is not the point here. The point is that
**every tile was correct and on disk, and not one of them survived** — so this document's premise no
longer rests on devices we cannot control. It rests on the writer, which is ours, and on any future
exception anywhere in `finish()`.

The renders these devices are being asked to do run for 90 to 120 minutes. **A job that takes ninety
minutes cannot depend on a ninety-minute window in which nothing goes wrong**, and that is the whole
premise of using idle tablets as render boxes: plug it in and walk away.

## What already works in our favour

A tiled BigTIFF is not a stream. It carries `TileOffsets` and `TileByteCounts` as arrays, so a tile can be
written at any offset, in any order, and replaced later without touching its neighbours. The grid render
path was built on that property deliberately, and `harness/tiff.mjs` already gates the part that makes it
true: **a tile re-renders bit-identically in isolation**. If it did not, recovering one lost tile would
silently produce a different picture at that tile.

So the picture is already recoverable a tile at a time. The format supports it and the renderer supports
it.

## What throws it away

`tiffSink` opens the output with `createWritable()`. That is a staging API: writes accumulate in a swap
file and are only committed to the real file when `close()` is called. A process that dies at tile 150 of
160 leaves **nothing** — not a partial file, not 150 usable tiles. The tail was never written either, so
there is no index even for what did land.

This is the single reason a lost render costs the whole render rather than one tile — and it is worth
being exact about how little it takes. `finish()` calls `tiffLayout`, writes the tail, patches the header
at position 0, then calls `close()`. **Everything is discarded by a throw anywhere in the first of those
four steps**, which is pure arithmetic over numbers already in hand. A defect in a line that touches no
pixels costs every pixel.

Confirmed by search after the 2026-10-12 loss: no `.crswap` file survived anywhere in the Chrome profile,
and the largest file in it was unrelated. The swap is not recoverable by hand.

## The trap in the obvious fix

The tempting fix is to close and reopen the writable every few tiles so progress is committed. Do not
reach for it without measuring: reopening with `createWritable({ keepExistingData: true })` may copy the
existing file into the new swap file. On a 790 MB master that is potentially hundreds of megabytes copied
per commit, on the slowest device we own, which is also the one that needs this most. It could easily cost
more than the render.

## The shape of the fix

`createSyncAccessHandle()` is the right tool. It writes **in place** at an offset, with no swap file, and
`flush()` makes those bytes durable. It is available in Chrome, Firefox and Safari, and it is
**worker-only**, which is the main structural consequence: the sink has to move off the main thread.

That gives three pieces:

**1. The sink moves into a worker.** The worker owns the file handle, the tile offset table and the
running byte count. The main thread sends it `{ index, bytes }` per stored tile and the worker writes at
the computed offset and flushes. Tile payloads are `Uint8Array`s and transfer zero-copy, so this does not
add a copy of the picture.

**2. A manifest, written alongside.** A small JSON file in the same OPFS directory recording the job's
identity and which tile indices are durably written. It must be flushed *after* the tiles it describes, so
that a manifest never claims a tile the file does not have. The reverse — a tile present but unclaimed —
is safe, because it is simply re-rendered.

**3. A resume offer on load.** If a manifest exists and its identity matches the current state, offer to
continue; otherwise ignore it.

## What identifies a resumable job

This is where the work done today pays. Resuming into a file rendered from a *different picture* would
produce a seamed master that looks plausible and is wrong, and the old `state` fingerprint cannot detect
that: a daylight master and a black-light master of the same slab both report `19acbddd`.

The identity must be **`renderSig`** — the signature over inputs that actually reach the pixels — plus the
geometry the file was written with: width, height, stored tile size, render tile size and bleed. Render
tile size matters because it determines which pixels each tile saw; a resumed job must continue with the
same plan even if the device would now choose a different one. If any of those differ, the manifest is for
a different job and is discarded, not adapted.

## What cannot be resumed, and should say so

- **A different slab, or the same slab edited.** `renderSig` catches it; the offer simply does not appear.
- **A different device.** The file lives in that origin's OPFS on that machine. Cross-device resume would
  mean shipping partial masters around, which is a different feature and probably not worth it.
- **A tile that was mid-write when the process died.** The manifest will not claim it, so it is
  re-rendered. This is the reason the manifest is flushed second.
- **Losing power.** Not the process — the machine. `FileSystemSyncAccessHandle.flush()` pushes the
  handle's buffer into the file, which is what makes a crashed tab, an OOM eviction or a closed window
  recoverable. It is **not** an fsync, and the web platform exposes no way to ask for one, so the bytes
  sit in the OS page cache until the OS chooses to write them down. A power cut takes whatever had not
  been written, and that includes the record itself. Measured on 2026-10-17 during a brownout
  mid-render: the resume offer was **absent**, not corrupt and not partial — which is the shape to
  expect, since the directory metadata goes with the data.

  This is a real limit and not a missing call: `flush()` is already issued after every tile and every
  row. Nothing in the page can improve on it. What was wrong was the description — the writer worker's
  own comment claimed `flush()` "makes the bytes durable" and offered that as the reason resume works,
  which folded two failure classes into one word. **Resume survives the process dying; it does not
  survive the machine dying.** Say which, because the difference is the whole feature.

- **Running out of storage.** This is the one the feature most looks like it should cover and least
  does: the tiles already written are exactly what resume relies on, and if the render stopped because
  there was nowhere to put the next one, continuing it hits the same wall at the same tile. The offer
  will appear and the resume will fail.

  **And the requirement is twice the finished master, for the whole run.** Chrome implements
  `createWritable` with a swap file exchanged at `close()`, so the old master and the new one both exist
  for the length of the render — measured at 65,535, that is 1.5 GB of a tablet's storage to produce a
  744 MB file. A 1,048,576 master is around 23 GB, so it wants roughly **46 GB** while it runs, which is
  more than a 32 GB tablet has in total. It fails by a factor of five, not by a margin.

  **Nothing in the page can check this, and the asymmetry is the useful part.** `navigator.storage
  .estimate()` returns `quota` and `usage` for the origin, and because the master lives in OPFS that is
  at least the right volume — but `quota` is a padded, fingerprint-resistant budget the browser may
  revise, and it says nothing about what the OS does to the disk underneath. So it can prove a render
  **impossible** and can never prove one **fits**. A browser cannot read free disk space at all.

  The remedy is therefore a stated contract rather than a gate: the headroom is the operator's to
  confirm, and `big.storage-note` says so in the panel beside the tier checkboxes, where it appears once
  **Unreasonable** is ticked — before **WHY**, rather than after. Narrowing the input instead would close
  a seam that is deliberately open: a desktop with the room should not be refused because a tablet
  would not have been able to.

## A related opportunity, which is not this feature

While measuring UV renders, the per-tile cost decomposed as roughly **10 ms of painting against 1,300 to
3,300 ms of deflate**. The tile loop currently awaits each deflate before painting the next tile. If
`CompressionStream` does its work off the main thread — untested, and cheap to test — then overlapping
compression of tile N with painting of tile N+1 would cost almost nothing and recover most of that time.

**The 262144 reading below was wrong, and the way it was wrong is worth keeping.** It said: 2560 render
tiles with a median of 1,113 ms against a mean of 2,225, so 2560 × the median is 47.5 minutes inside a
94.9-minute render — *half the wall clock was stalls* — with 747 tiles over twice the median and a
time-vs-bytes correlation of 0.01, tiff-meta's signature for the machine rather than the slab. It then
concluded that the pool was not the cause, **because** it ran its full eight workers and never shed.

That inference is backwards. A pool that ran eight wide and never shed is a *saturated* pool, and a
saturated pool produces exactly this shape: `perTile.ms` is consumer-side wall, the consumer takes
passes in order, so one consumption in eight carries the batch's entire paint and the other seven read
as the write cost. The near-zero bytes correlation is what a bimodal artefact looks like, not evidence
of a stalling machine.

Measured on that master's own numbers, 2026-10-17: its slow passes fall at **0, 1, 9, 17** and then at
gaps of **8** — later splitting into 3,5,3,5 and 1,2,5, every run still summing to eight. A period equal
to the pool width, which is the pipeline and not the hardware. The same signature appears in two 65,535
glass masters, and a trace of one with per-pass paint times recorded gave **93.7% utilisation, eight
workers busy for 87% of all samples, and a wall clock within 7.6% of the pool's own floor.** The paint
time per pass was flat to within 8%.

So the time was painting, and it was the picture. What the figure actually measures is where the paint
got attributed. `tools/pool-trace.mjs` answers this off a master now; `docs/final-render.md` rung 3 has
the width consequence, which is the one lever the measurement did leave open.

The overlap opportunity in the paragraph above still stands on its own evidence — 10 ms of painting
against 1,300 to 3,300 ms of deflate is a UV-render measurement and nothing here touches it.

This is worth knowing because it touches the same loop. It should not be bundled into the resumability
work: one changes durability, the other changes scheduling, and mixing them would make a regression in
either hard to attribute. Measure the overlap question separately first.

## What is built, and three things this document did not say

The four functions are pure and self-contained so that a probe can lift them by text and run them as
themselves. That was the constraint, not a preference: OPFS and the worker that will own it do not exist
outside a browser, and Playwright will not spawn on the machine this was written on, so anything decidable
had to be decidable on the Node side of the boundary. `tools/probe-resume.mjs` proves a round trip, a torn
tail cut at every byte of its last row, and a crash at every row index replaying to a byte-identical
layout - with three ablations, because a comparison that cannot go red has proved nothing. Removing one
line from `resumeState` turns it red with the exact number, which is how that was checked.

**The save confirm waits for a person, and the clock must not.** The confirm exists because
`download()` returns the moment a click is dispatched — a cancelled Save As, a full volume and a
finished download are indistinguishable from inside the page, so nothing is deleted until someone says
the file arrived. That makes it the one blocking step in an export, and the 1,048,576 master found what
it cost: **351:29** on screen against **300.5 min** in the file's own metadata, fifty-one minutes of an
unattended dialog counted as render time. The TIFF was honest throughout — `ms.total` is captured up
with the rest of the metadata, before the save — so only the number on screen was wrong, which is the
only number anybody reads. The elapsed is locked before the confirm now — and so is the ticking
clock beside it, which is the half that was missed first time: a live 1024 render with the confirm
held 75.9 s read **Saved the render — 1024px — 0:00** next to a clock still showing **1:16**. One
corrected line beside an uncorrected one reads as agreement and is not.
`tools/check-export-clock.mjs` goes red if either half ever drifts again.

**The identity is `renderSig`, and that is what the record stores.** Confirmed rather than assumed: the
master's own `inputs` field IS `renderSig()` (`app/stone-author.html:9246`), so the signature a sidecar
publishes and the signature a resume matches on are the same value.

**The build is deliberately NOT in it, decided 2026-10-15.** Including it is the safe reading - a later
build could lay tiles out differently, and half a master from each would be a corruption nobody could
explain afterwards. It was taken out anyway, because it means every deploy abandons every job in flight,
and this repo shipped four builds on the day this was written. A six-hour render on the A7 cannot be
hostage to a docs typo going out.

What that costs is named rather than hidden: **if the render path changes between two builds, a resumed
master is half each and nothing would say so.** A master records the build it FINISHED under, so a
cross-build resume is invisible in its own provenance block. Recording both builds would make it
visible and is cheap; it is not done. The probe pins the decision from both sides - one case catches a
field that stopped counting, another catches the build quietly coming back and killing resumes that
nobody would connect to a deploy.

**And it carries the accumulators, which this document missed entirely.** The export loop keeps more than
tiles. `litSum`, `litUp` and `litN` become `light.mean` and `lit>40` in the provenance block - every light
figure in `docs/sidecars/README.md` comes from them - and `tileMs` / `tileBytes` become the `perTile`
arrays the whole stall analysis rests on. A resume that restores only the tiles produces **a valid master
with a wrong provenance block**: every pixel correct, the light figures describing only the part rendered
after the crash. That is worse than a render that failed honestly, because it looks finished. The record
therefore has one row per RENDER tile carrying that row's light and timing deltas alongside its cut.

**The record is append-only and binary, not a JSON manifest.** Once the per-tile arrays are in it, a
manifest rewritten whole at each checkpoint costs about 1.5 MB a time at 163,840 tiles - several hundred
megabytes of writes over a run, on the device that can least afford them. A row is appended once and never
revisited. Each row is sealed by repeating its payload length after the payload, so a row half-written when
the power went fails to seal and the scan stops there: a torn tail is the normal shape of this file, not an
error. Rows are recorded in WRITE order and nothing reads them assuming an order, which is what keeps a
count-based resume from quietly appearing - the loop consumes render tiles in index order today, the pool
paints them out of order, and the sink is already index-addressed for the cut.

**`tiffLayout` did not keep that discipline, and was fixed on 2026-10-16.** It took the end of the file
from `offs[N - 1] + cnts[N - 1]` — the tile with the highest *index*, which is a claim about *write*
order and a different thing entirely. It held only because the export loop's nested quarters happen to
finish on tile `N-1`; it would have stopped holding the day pool results are consumed as they land, or
a cut reorders its pieces, or a resume fills a gap left in the middle. The end is now the maximum over
every tile, and a tile that was never written throws instead of reaching the header as `NaN`.

The cost of getting it wrong is not a failed render but a convincing one. Fed the same tiles in reverse
write order, the old line put the directory **4,263,063,287 bytes inside the tile data** —
[`probe-tiff-offsets`](../tools/probe-tiff-offsets.mjs) case E, with the ablation that proves a grid
written in index order is unaffected, so what is under test is the ordering and not the arithmetic.

## A signature is not evidence, and one of ours was wrong

This document chose `renderSig` as the resume identity on the grounds that it covers the inputs that
actually reach the pixels. On **2026-10-15** two UV masters of one slab shared `renderSig 95ef95fe` and
did not share a picture: `light.mean` 64 against 61.33, with the planner's own reference measurement
agreeing the picture had moved - 149.9 against 140.9 on the same calibration. Everything else the
masters record was identical, including `stateSig`.

The cause was never found. For that slab, every field `renderSig` leaves out is either empty
(`sections`, `folders`, `perItem`), or correctly excluded - `wood` and `glass` cannot reach stone pixels,
and `material: "stone"` is the default case the signature is built around. So it came from session state
outside the slab, or a 32-bit CRC collision, and the state that produced the first master was gone before
anyone looked. **It is not a regression** - the build of the day reproduces byte-identically, in both
lights, across a probe race and a remembered plan alike.

What survives is the lesson. **Resuming on a hash alone is trusting the one thing that has been observed
to lie.** So before a resume is taken, tiles the file ALREADY HOLDS are re-rendered and compared byte for
byte. A match is direct evidence the picture has not moved, rather than a promise. `harness/tiff.mjs`
already gates the property this leans on - a tile re-renders bit-identically in isolation - so a mismatch
means the picture changed, not that rendering is noisy.

Three functions, pure and probed like the record:

- **`resumeCheckCount(tileMs, budgetMs, cap)`** - how many can be afforded, asked of the file rather than
  guessed. The record already carries the per-tile timings of the run that wrote it, so the master says
  what a verification tile costs ON THAT DEVICE. One ten-second budget buys hundreds at 512 on a desktop,
  sixteen at 4096, and two on an A7 - the slow devices check fewer without being told which they are.
  Never fewer than one: a resume with no evidence at all is what this exists to prevent.
- **`resumeSample(rows, want)`** - the first and the last written always, then an even spread. The last is
  nearest whatever stopped the render; the first catches a systematic placement error a middle sample
  would sail past. Even rather than random, so a failure reproduces by rerunning the check.
- **`resumeVerify(stored, fresh)`** - the verdict, over compressed bytes, which is what the file stores and
  what the render path already has. That leans on deflate being deterministic within one engine, measured
  the same day at 263,979,432 bytes byte-identical across two runs. If it ever is not, this reports a
  mismatch and the resume is abandoned: **failing closed costs a render that could have been saved,
  failing open writes a master that is half one picture and half another and says nothing.**

`tools/probe-resume.mjs` covers all three, including the ablation a careless implementation passes -
nothing compared against nothing is not agreement, it is no evidence.

## Staging

Each stage is useful alone, which matters because the value arrives before the whole thing is done.

1. **Move the sink into a worker on `createSyncAccessHandle`, flushing per tile.** No manifest, no resume
   UI. On its own this already means a killed render leaves a file containing every tile it finished —
   recoverable by hand. Gate: the existing TIFF round-trip must still pass, byte for byte, against a
   master written the old way.
2. **Write the manifest.** Still no resume UI. Now a killed render leaves a file *and* a statement of what
   is in it.
3. **Offer the resume.** Match on `renderSig` plus geometry, THEN re-render a sample of tiles the file
   already holds and compare them byte for byte; render only the missing indices; write the tail; verify.
   The signature decides whether to look; the tiles decide whether to trust.
4. **Prove it by killing it.** The gate that matters: render a small grid, kill the page at a known tile,
   reload, resume, and compare the result byte for byte against the same grid rendered in one go. Until
   that test exists and has been seen to fail when resume is broken, the feature is not finished.

## Risks worth naming before starting

- **Sync access handles are exclusive.** Two tabs rendering to the same file will conflict. The job
  identity should include something per-session, or the second tab should be refused with an explanation.
- **OPFS quota.** A resumable job leaves large files on disk between attempts. There needs to be a way to
  discard an abandoned job, and a policy for how long one is kept.
- **Safari.** Support exists, but the iPhone path already differs from the others (it reaches the app
  through the artifact runtime), so it needs verifying rather than assuming.
- **The A7 is the target and the hardest case.** It is the device that loses renders and the one with the
  least memory. Whatever is built must be measured there, not only on the desktop, because the desktop
  was thought never to encounter the problem. It encountered it on 2026-10-12 and lost
  ninety-five minutes at 262144, so "the slow devices need this" is now "the writer needs this".

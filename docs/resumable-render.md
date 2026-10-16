# A render that survives losing the page

Status: **the part that can be tested is built and gated. The worker and the OPFS wiring are not.**
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

## A related opportunity, which is not this feature

While measuring UV renders, the per-tile cost decomposed as roughly **10 ms of painting against 1,300 to
3,300 ms of deflate**. The tile loop currently awaits each deflate before painting the next tile. If
`CompressionStream` does its work off the main thread — untested, and cheap to test — then overlapping
compression of tile N with painting of tile N+1 would cost almost nothing and recover most of that time.

The 262144 master gives this a sharper number from the other side. Its 2560 render tiles had a **median
of 1,113 ms** and a mean of 2,225: 2560 × the median is 47.5 minutes inside a 94.9-minute render, so
**half the wall clock was stalls**, with 747 tiles over twice the median and time-vs-bytes correlation of
0.01 — tiff-meta's own signature for *the machine, not the slab*. The pool is not the cause; it ran its
full eight workers and never shed. Whatever that time is, it is not painting and it is not the picture.

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

## Staging

Each stage is useful alone, which matters because the value arrives before the whole thing is done.

1. **Move the sink into a worker on `createSyncAccessHandle`, flushing per tile.** No manifest, no resume
   UI. On its own this already means a killed render leaves a file containing every tile it finished —
   recoverable by hand. Gate: the existing TIFF round-trip must still pass, byte for byte, against a
   master written the old way.
2. **Write the manifest.** Still no resume UI. Now a killed render leaves a file *and* a statement of what
   is in it.
3. **Offer the resume.** Match on `renderSig` plus geometry; render only the missing indices; write the
   tail; verify.
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

# Provenance

Material Author's **build** — the code, the commits, the published artifact, and the design as it was
actually worked out — was done with **Claude Code**, directed by Chris. It was called **Stone Author**
while the two archived sessions below ran, and this file keeps that name wherever it is describing that
period rather than the program as it stands. Alongside it, Chris used a separate **ChatGPT**
conversation as a **sounding board**: a place to pressure-test an idea and head off side-quest distractions
before committing it to the build, while Claude implemented. The same topics (the layer-transfer optical
model, the Fresnel-lens-as-refraction-relief primitive, the semantic-grid spotlight, the CPU/GPU split)
appear on both sides because Chris carried them between the two — but the decisions and the implementation
live in the Claude build; the ChatGPT thread is the idea-check, not a second builder. This file points to the
record of each.

## Build — Claude Code

The build is **two continuous Claude Code sessions**, back to back — the second one opened 23 seconds after
the first closed — running from 2026-09-20 20:03 UTC to 2026-10-01 07:34 UTC: ten days, eleven hours and
thirty-one minutes of wall-clock span, 12,875 tool calls, all 296 commits in this repo. Both are archived: every message, every tool
call *with its arguments*, and every tool result. That record is the provenance oracle — the one source that
can answer "why is this the way it is?" down to the exact call that made it.

The raw material is ~717 MB across the two, so it is **not committed here** — it lives as compressed archives
kept privately and, if ever published, attached to a GitHub Release. These tables are the pointer to them.

### Session 1 — the studio

| | |
|---|---|
| Session ID | `698bc007-76d7-4c9f-8f93-ad00bf28ca5c` |
| Span | 2026-09-20 20:03:43Z → 2026-09-23 06:55:12Z (58h 51m wall-clock, breaks included) |
| Captured | after the session closed — **complete** |
| Transcript | 247.6 MB, 30,243 lines |
| Tool calls | 4,384 (arguments recorded verbatim) |
| Tool results | 4,383 (full output; 145 errors) |
| Sidecars | 51 files, 35.6 MB (large results offloaded from the transcript) |
| Commits here | 41 of 296 — the marble studio itself, from the repo split on Sep 21 |
| Archive | `stone-author-session-698bc007-76d7-4c9f-8f93-ad00bf28ca5c.tar.xz` (113.8 MB, xz) |
| SHA-256 | `8365ee337924e61da2f5efb22a38b04d5ae31619e855febb008fc3f6957f9c2a` |

### Session 2 — the coat, the layers, and the masters

| | |
|---|---|
| Session ID | `28da307f-5ea7-4449-815d-ae43b7b0ba89` |
| Span | 2026-09-23 06:55:35Z → 2026-10-01 07:34:30Z (192h 39m) |
| Captured | after the session closed — **complete** |
| Transcript | 469.2 MB, 75,146 lines |
| Tool calls | 8,491 (arguments recorded verbatim) |
| Tool results | 8,491 (full output; 297 errors) |
| Sidecars | 77 files, 61.4 MB — 67 offloaded results plus 10 subagent transcripts (5 runs) |
| Commits here | 255 of 296 — the coat tier, the layer system, the master export path, the render calibration, and the tebipixel run |
| Archive | `stone-author-session-28da307f-5ea7-4449-815d-ae43b7b0ba89.tar.xz` (143.0 MB, xz) |
| SHA-256 | `ccf9071b7fd52e1edc8ec4f8f489149b8df1f5a1df2332ae891ea7969078b645` |

The second session is the larger part of this repo's history: the coat tier (subsurface, specular, the one
movable light, light temperature, black light and the condition-agnostic spectrum engine, the lens top-coat,
and the layer-aware back-light fold), the layer system (Fog, layer delete, render order decoupled from kind,
layer-select sculpt, protected warp islands, the Mask tool), the two-pane workbench, the gallery heroes,
`renderFull` and `renderTiled`, off-thread PNG encode, strips, the large render tiers, the whole tiled-BigTIFF
master path with its export guards, and the refactor that removed Wood and made this stone-only — a
decision later reversed, which is why the program is Material Author again.

Its last day is the render calibration, and most of it is wrong answers corrected by measurement. The image-space bloom was found to reach 2.41%
of the image width per side — 1,577 px against a 2,048 px tile at 65535, which made a black-light master
arithmetically impossible on a tablet. It was replaced with a halo drawn per element, taking the bleed from
1,577 px to 4. That correction then had to be measured for each browser engine, because each draws a
different halo: Blink wants the lift raised with width, Gecko wants its own steeper line, WebKit wants light
taken away. Three engines on five devices now land within 0.3% of one reference — with one configuration that does
NOT, Gecko on Android, which cannot be brought there by the correction at all and is recorded as what it is.
The transcript holds
every wrong mechanism proposed on the way — four of them for one tablet's truncation alone, each killed by a
measurement Chris sent back.

The set it produced is documented in [`docs/devices.md`](docs/devices.md): five machines, each rendering
a 65,535 × 40,959 master in both lights, from a 2019 budget tablet with 2 GB through to a desktop. Four
Blink devices agree to 0.41% on the same picture, the slowest is 19× the fastest, and the fastest is a
phone. A reader can check any of it without the masters — see [`docs/reproduce.md`](docs/reproduce.md).

It also holds the failures of the checks themselves, which is the less flattering half: gates written that
could not fail, a probe that had never once produced a reading while appearing to work, escape sequences
mangled three separate times in generated code, and a temporal dead zone written and shipped green past six
gates before a browser found it in ten seconds.

**Contents of each archive:** the transcript `.jsonl` (one JSON object per line: messages, tool calls +
arguments, tool results) and the sidecar files it references — results too large to inline were offloaded and
left behind as a pointer, so without those blobs the record is incomplete. Each archive was checked before it
was cut: every offloaded blob present is referenced by its transcript, and nothing referenced is absent (51
of 51, and 77 of 77). Both are replayable call by call — which is how the build's every decision, dead end,
and correction can be reconstructed.

**On "captured".** A capture taken while a session is running is a prefix of that session, and the first
archive published here was one: it was cut on 2026-09-23 at 02:16 UTC, five hours before session 1 actually
ended, and so listed 4,042 tool calls rather than 4,384. Session 1 has since closed and been re-archived
complete, which is why its hash on this page has changed; the earlier archive was verified to be a byte-exact
prefix of the new one, so nothing was lost in the swap. Session 2's archive has since been swapped the same
way: its prefix was cut on 2026-09-27 at 01:42 UTC and held 4,794 of the session's 8,491 tool calls, and the
session then ran on for another four days. Before the complete archive replaced it, that prefix was checked
against the closed transcript and found byte-exact — 233,296,031 of 469,200,088 bytes, ending cleanly at line
38,557 of 75,146. Both prefixes are kept beside the archives they preceded, renamed `.PARTIAL-…`, so either
swap can be re-checked rather than taken on trust.

### The build since the archives — 2026-11-01

The two sessions above are no longer the whole build. **This repo holds 813 commits; the archives
above cover 296 of them.** The rest are not a second effort and not missing — the build is one
continuous conversation, and every session in it opens seconds after the last one closed:

| session | span | commits | archived |
|---|---|---|---|
| `698bc007-76d7-4c9f-8f93-ad00bf28ca5c` | 2026-09-20T20:03:43Z → 09-23T06:55:12Z | 41 | **complete** |
| `28da307f-5ea7-4449-815d-ae43b7b0ba89` | 2026-09-23T06:55:35Z → 10-01T07:34:30Z | 255 | **complete** |
| `737db4ea-f00e-4813-9c88-318db85d6fab` | 2026-10-01T07:36:19Z → 10-11T20:05:57Z | 91 | **complete** |
| `cabd461f-55fa-425c-80ca-5f8c1d6f80c7` | 2026-10-11T20:06:16Z → 10-17T03:57:11Z | 124 | **complete** |
| `4a8d2045-4cd6-4ebb-ac6e-043e2e5d5369` | 2026-10-17T03:57:32Z → 10-18T08:06:38Z | 33 | **complete** |
| `1ac6f3a3-b809-4883-8d66-66ea6ad56959` | 2026-10-18T08:07:26Z → 10-19T04:21:57Z | 7 | **complete** |
| `04a48e69-bc78-4cd7-8215-7d16bde8a113` | 2026-10-19T04:22:17Z → 10-26T07:24:40Z | 179 | **complete** |
| `c0060eab-6f05-43e2-a66a-39273ecc4ede` | 2026-10-26T07:24:54Z → **open** | 83 | prefix only |

**Those counts sum to 813, which is every commit in the repo**, and the first two sum to the 296 the
sections above were written from. Nothing falls outside a session. The gaps between them, in order,
are 22.8 s, 1 m 49 s, 19.0 s, 21.0 s, 48.0 s, 20.9 s and 14.2 s.

#### Why this looked like a gap

An earlier version of this section reported 2026-10-01 → 10-19 as having **no record**. That was
wrong, and how it was wrong is worth keeping.

**A transcript is filed under the directory its session STARTED in, not the one it worked in.** This
build began inside a `eufy-vacuum-manager` worktree and changed directory into `stone-author`, so
four of its sessions are stored under a `eufy-vacuum-manager` key and three more under that
worktree's key — both archived sessions among them. Searching the folder named after this repo finds
the two most recent sessions and nothing else, which reads exactly like a hole in the middle of the
record. The folder named for the project is the one place these transcripts were never going to be.

The four sessions in question carry `GITHUB/stone-author` as the dominant working directory on their
entries — 9,728, 11,848, 6,237 and 748 of them respectively — and name this repo four times more
often than the one they are filed under.

**The search that confirmed the gap was wrong in its own way, which is the more useful half.** A
sweep by file modification time returned nothing, and nothing read as corroboration. But these files
are touched long after their sessions close: one that ended 2026-10-01 carries a modification time of
2026-11-01. That timestamp says nothing about when a session ran. The sweep that found them reads the
first and last timestamp *inside* each transcript instead, which is the only thing that does.

Two further transcripts are not in the chain and are recorded here rather than left out: a 1 h 27 m
session on 2026-10-01 that ran concurrently with the one above it, and a worktree session spanning
2026-09-24 → 10-09 that refreshed docs. Their commits fall inside the windows in the table.

#### The two newest archives

`04a48e69` has closed, so it is archived complete, the same way the first two were.

| | |
|---|---|
| Transcript | 267,606,296 bytes, 58,284 lines |
| Tool calls | 7,132 |
| Sidecars | 6, every one referenced by the transcript, no orphans either way |
| Archive | `stone-author-session-04a48e69-bc78-4cd7-8215-7d16bde8a113.tar.xz` — 37,897,172 bytes, xz -6 -T0 |
| SHA-256 | `71e17e781070a1a7f8f7525e1f319e0832e3dc9ae3a779ceab8485a9c567bd04` |

`c0060eab` is still running, so what exists for it is a prefix **and is named one**, the way the two
earlier live captures were. It is cut from a staged snapshot, so the check below describes the same
bytes the archive holds, and it must be re-cut once the session closes.

| | |
|---|---|
| Captured | 2026-11-01T08:13Z — **session still open; this is a PREFIX** |
| Transcript | 350,378,062 bytes at capture, still growing |
| Sidecars | 77 — 35 in `tool-results/`, 42 in `subagents/` |
| Referenced | 33 of 77. The 42 subagent files are not named in the transcript at all, by filename or by agent id, where the earlier sessions' were; 2 background-task outputs are present and unreferenced |
| Archive | `…c0060eab-6f05-43e2-a66a-39273ecc4ede.PARTIAL-capture-2026-11-01T0813Z.tar.xz` — 55,667,916 bytes |
| SHA-256 | `529935cdd659b78bfefd01e83a3c759a5468856c5630316aaa6a3c42a8475525` |

#### The four in the middle

All four are closed, so all four are archived complete. Each was checked both ways before it was
cut — every sidecar referenced by its transcript, and nothing referenced that is not present.

| session | transcript | calls | sidecars | archive |
|---|---|---|---|---|
| `737db4ea` | 108,081,706 B, 18,516 lines | 2,308 | 39 of 39 | 33,636,892 B |
| `cabd461f` | 120,608,876 B, 21,664 lines | 2,413 | 9 of 9 | 28,640,532 B |
| `4a8d2045` | 70,599,454 B, 12,844 lines | 1,732 | 1 of 1 | 11,925,884 B |
| `1ac6f3a3` | 10,573,400 B, 1,923 lines | 251 | none | 1,776,080 B |

SHA-256, in the same order:

```
737db4ea  64e43c8f846e7d55f1453efde3d79acc3c0a6e03dc35a2810852440da666ddce
cabd461f  2d2c88eadae0ae8b33fcc1bd0dc5cb4e19c41dd5f1bd4610dc20d328556bb142
4a8d2045  f79264ea6a1d090f1d31f27dd148e7df70e24808f7d326a3e5ea24bddb71fd92
1ac6f3a3  7382f435b1e3b8c1974109f1e488294e7b644d5385261ced2b4570b640c5d8ff
```

**These four are mixed sessions, and their archives are not purely this project.** They are filed
under a `eufy-vacuum-manager` key because that is where they opened, and they do carry real work for
that repo alongside this one. By working directory the split runs 9,728/1,129, 11,848/1,481,
6,237/2,606 and 748/680 — so the last of them is close to half another project's subject. Said here
because an archive named for this one should not quietly contain a different one.

**Every session in the chain is now archived except the open one**, which can only ever be a prefix
until it closes.

What that period built is the part of the program this record does not otherwise describe: wood and
glass returning as the second and third material paths behind a single fork, the GPU renderers beside
the CPU ones, the interface in fifteen languages, and the film pipeline in
[`docs/creation-film.md`](docs/creation-film.md).

## The corpus

What the record above produced: **768 renders totalling 1,107,051,880,835 pixels — a tebipixel, 2^40,
crossed at 100.686%, overshooting it by 7,540,253,059** on 2026-10-01 at 07:23:23.938Z. That is ten days and eleven hours after the first
session opened, and six days after the first render existed.

The crossing is attributable to a single master rather than a batch, because every render records its own
finish time to the millisecond:

| | |
|---|---|
| Render | `stone-65535-day-win-chrome-1001-002324` |
| Finished | 2026-10-01T07:23:23.938Z — number 766 of 768 |
| Took | 160 s at a 4096 tile, 65,535 × 40,959 |
| Before / after | 1023.5227 GiPx (99.9534%) → 1026.0226 GiPx (100.1975%) |

Its two siblings finished 1.5 and 1.7 seconds later, in the same wall-clock second; the milliseconds are
what make it one render and not three.

**It cost 54 h 07 m of actual rendering — 2.25 days — at a 37.2% duty cycle over 6.06 calendar days.**
Compute time is measured on 768 of 768 renders, not extrapolated. The remaining 62.8% is a person being
away from the desk, which is the whole reason the figure is kept separately from the calendar.

| engine | renders | compute | GiPx | Mpx/s |
|---|---|---|---|---|
| win-chrome | 398 | 17 h 60 m | 797.2 | 13.21 |
| android-chrome | 139 | 19 h 33 m | 86.3 | 1.32 |
| ios-safari | 80 | 1 h 10 m | 49.8 | 12.83 |
| win-firefox | 63 | 6 h 06 m | 27.6 | 1.35 |
| android-firefox | 50 | 3 h 36 m | 27.0 | 2.24 |
| *(no engine recorded)* | 38 | 5 h 43 m | 43.1 | 2.25 |

Five machines, three engine families, five engine/platform combinations — and **every width from 1,024 to
65,535 was rendered on all five, with no gaps**. The desktop carries 80.0% of the pixels but only 60.0%
of the renders; the handhelds are 35.0% of the renders for 15.8% of the pixels. That asymmetry is the
point rather than an inefficiency: every defect this build found was found on a handheld. A farm that was
all desktop would have more pixels and no findings.

**The masters are not kept.** Each is harvested to a ~21 KB sidecar carrying its full identity, geometry,
tile plan, per-tile timings and light figure, and then deleted. 952 sidecars occupy 20.6 MB. Every figure
in this section re-derives from them, which is the only reason any of it can be stated at all — the
pictures it describes no longer exist.

### Eighteen days on — 2026-10-19

| | |
|---|---|
| Renders | **855** |
| Pixels | **3,221,720,850,845** |
| | **2.93 × 2^40** |
| 2 × 2^40 crossed | 2026-10-17T05:55:53.358Z, by a 1,048,576 — 143.0% → 205.5% in one render |

The second tebipixel is attributable to a single master the way the first was, and more starkly: a
1,048,576 × 655,360 render is 687.2 Gpx, 62.5% of a tebipixel on its own, so it crossed the line from
well behind it.

**The method is now [`tools/render-census.mjs`](tools/render-census.mjs) rather than a one-liner.** The
figure above was first recomputed by a method that looked reasonable and was wrong twice over — keyed on
`inputs` instead of `engine`, which collapses the same picture rendered on two browsers into one render
and under-counts by about 8%, and reading one of the three evidence directories instead of all three.
It disagreed with the published crossing date by a fortnight and nearly prompted a "correction" to the
paragraph above. The published figure was right. So the census now **checks itself against it** before
reporting anything current, and exits non-zero if it cannot reproduce 768 renders and 1,107,051,880,835
pixels exactly. A number that can only be re-derived by remembering how it was derived is not a record.

**Two gaps in this one, stated rather than smoothed over.**

The evidence directories were not fed between 2026-10-01 and 2026-10-19. Forty-three masters rendered in
that window existed only as files; they have since been harvested, which is why the ledger is current
again, but nothing would have noticed if they had been deleted first.

Forty-four were. A prune on 2026-10-19 removed masters from `Downloads` before harvesting them, against
the discipline the paragraph above describes. The width census taken either side of that prune is exact,
so **195,622,920,205 of the pixels in the total are a reconstruction** — 44 renders whose pixel count is
certain and whose individual records are gone. The census reports that line separately rather than
folding it in, because a reader is entitled to know how much of a figure rests on a record of one render
and how much on an aggregate.

**What is excluded, and why.** Seven renders at 16,384 recorded a light figure of exactly zero: the
assembly canvas allocated, reported success and painted nothing, while every other field — identity,
geometry counts, tile plan, a plausible 51-63 s duration — looked correct. They are kept as sidecars and
excluded from the count, because the count is of pictures. A further 38 renders predate the metadata
carrying an `engine` field and cannot be attributed to a machine; they are counted in the total and
excluded from the per-engine table above, where they appear as their own row rather than being
distributed by guess.

### Thirty-one days on — 2026-11-01

| | |
|---|---|
| Renders | **1,416** |
| Pixels | **16,132,687,602,275** |
| | **14.67 × 2^40** |
| Tebipixels crossed | **14**, the last on 2026-10-27T06:58:14.342Z |

The census still reproduces the published first crossing exactly — 768 renders and
1,107,051,880,835 pixels — before it reports anything current, and exits non-zero if it cannot.

**Eleven of the fourteen crossings were made by a single 1,048,576-wide render.** At 687.2 Gpx each
that is 62.5% of a tebipixel on its own, so the line is jumped rather than approached: the fourteenth
went 1366.776% → 1429.276% in one picture. Of the other three, one was crossed by a 262,144, one by
a 131,072, and only the first by a 65,535 — the width the whole of the first ten days was built on.

**Which render crosses a line is not a fixed fact, and this table is the demonstration.** Every
figure here is recomputed from the whole corpus in date order, so adding renders *earlier* in the
sequence shifts what was crossing when. Between the two harvests of 2026-11-01 the ninth crossing
moved from 899.130% → 903.037% to 896.323% → 900.229%, and the thirteenth stopped being a 262,144
and became a 131,072. Nothing was edited to make that happen; the census simply had more of the
record to read. A crossing is a property of the corpus, not of the picture that happened to make it.

The reconstruction line is unchanged at 44 renders and 195,622,920,205 pixels, still reported apart
from the rest rather than folded into it. It was 6.1% of the total when it was recorded and is 1.21%
now, which is the shape a stated gap should have: it does not grow, and the record around it does.

**Those figures moved the same day, by a harvest.** 88 masters were read, recorded and deleted —
5.57 GB off the disk — which is the discipline described above working rather than a change of mind.
65 of the 88 were new to the ledger and the other 23 already had records; the sweep added
25,756,319,750 pixels and crossed nothing, since none of it was large enough to land on a boundary.

Most of them were nearly missed. `watch-harvest` deletes, so what it matches is deliberately narrow —
a slab name it has not been told about produces masters it will not touch — and three slabs had been
renamed since the list was last extended. It said so for every one of them, naming the prefix to add,
which is the whole point of the warning net being wider than the delete net. Before that net existed
the same situation twice produced silence and an hour of masters accumulating unseen.

**A second harvest the same day took the rest of it.** 49 masters, **24.03 GB**, read, recorded and
deleted — the whole of the five-device set that filled `docs/devices.md`, from a desktop, an S23
Ultra, an iPhone 14 Pro and both tablets. Nothing was refused and nothing was set aside.

That sweep is also the first on which the harvester's own empty-stone test was **narrowed to stone**.
Written material-blind it asked `marks > 0 && !lines && !cracks && !specks`, and lines, cracks and
specks are stone counters — so a correct glass master satisfied it by construction. A dry run set ten
aside, including a 4.57 GB 262,144; across the archive **224 of 1,316 masters matched it and 212 were
glass**. They were kept rather than deleted, so nothing was lost, but a master set aside never enters
this ledger, and glass would have stopped entering it entirely.

**One master was held back from that harvest deliberately, and it is the interesting one.** A GPU
render whose CPU twin differs in no configuration field at all drew a different picture: over half
its pixels are literally R=G=B, because it dropped the colour in the fog and the moon while keeping
it on the marks. Its `light.mean` reads 59.10 and its `lit40` 61.89, so it passes every guard this
harvester has — it would have been recorded as good and removed, leaving a sidecar with no field
that records the defect. Its pixels are counted in the figures above; the file itself is kept,
because no number in the record says what is wrong with the picture.

**The films are not in any of this, and cannot be.** This program now writes video as well as masters,
and a video has no sidecar path — nothing reads a WebM back into the ledger. The creation film alone
is 12,210 frames at 512 × 320, a little over 2.0 Gpx of rendering the corpus does not count. Every
figure in this section is therefore a count of **masters**, not of everything this program has drawn.

## Design — ChatGPT

Alongside the build, Chris ran a ChatGPT conversation as a **sounding board** — somewhere to check an idea
and avoid getting pulled onto tangents while Claude implemented. It pressure-tested the same problems from
the architecture side: structure-first generation and keeping the material/document as the semantic truth;
the Fresnel lens (reframed as a general top-surface **refraction-relief** primitive, not a special case);
back light and optical depth as a **local layer-transfer fold** — each layer declares what it does to the
arriving field and hands its result onward; the spotlight as **semantic-grid intersection**, exciting a
whole artifact when any of its cells is lit rather than masking pixels; a CPU/GPU split with Canvas/CPU as
the reference renderer and WebGPU as an optional single-frame "beauty" backend (GPU→CPU readback is worth it
only when a large parallel calculation collapses to a compact field); and the observation that "spectroscopy"
fell out for free as composition of existing machinery — the signal that a feature lock was timely. These
were vetted here; the calls and the code were made in the build.

Chris provided a curated, scoped extract of that conversation. It is Stone-Author-only (unrelated sidebars
omitted) and it labels its own evidence: it distinguishes exact current-chat wording, timestamped facts
recovered from prior-chat context, and project docs used only to anchor the chronology, and it does not
invent per-turn clock times it could not recover. The full raw ChatGPT conversation is not part of this
record — only the extract is. Its span covers session 1; nothing from the sounding board is recorded here for
the work after 2026-09-23.

| | |
|---|---|
| Extract | `Stone_Author_Transcript_Extract_2026-09-20_to_2026-09-23.docx` |
| Span | 2026-09-20 → 2026-09-23 |
| Size | 43,676 bytes |
| SHA-256 | `e4e6ae9a231746e74e90abb86198ccd92b9d52f24bf815e80dcb074e612fd343` |

## Privacy

The raw Claude archives contain personal paths, an email, and private working notes, so they are kept
private; the shareable account is the origin story in [`README.md`](README.md), written from this record
rather than quoting it, and the raw dumps are never shared as-is. The ChatGPT extract above was already curated and scoped
before it reached this record. Verify any copy with `sha256sum <file>` against the hash listed for it.

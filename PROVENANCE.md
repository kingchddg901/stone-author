# Provenance

Stone Author's **build** — the code, the commits, the published artifact, and the design as it was actually
worked out — was done with **Claude Code**, directed by Chris. Alongside it, Chris used a separate **ChatGPT**
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
master path with its export guards, and the refactor that removed Wood and made this stone-only.

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

**What is excluded, and why.** Seven renders at 16,384 recorded a light figure of exactly zero: the
assembly canvas allocated, reported success and painted nothing, while every other field — identity,
geometry counts, tile plan, a plausible 51-63 s duration — looked correct. They are kept as sidecars and
excluded from the count, because the count is of pictures. A further 38 renders predate the metadata
carrying an `engine` field and cannot be attributed to a machine; they are counted in the total and
excluded from the per-engine table above, where they appear as their own row rather than being
distributed by guess.

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

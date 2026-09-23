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

The bulk of the build is one continuous Claude Code session, archived complete: every message, every tool
call *with its arguments*, and every tool result. It's the provenance oracle — the one source that can
answer "why is this the way it is?" down to the exact call that made it.

The raw record is ~254 MB (a 228 MB transcript plus 45 offloaded sidecar blobs it references), so it is
**not committed here** — it lives as a compressed archive kept privately and, if ever published, attached
to a GitHub Release. This table is the pointer to it.

| | |
|---|---|
| Session ID | `698bc007-76d7-4c9f-8f93-ad00bf28ca5c` |
| Span | 2026-09-20 20:03 → 2026-09-23 01:47 UTC (53h 44m wall-clock; the marble studio itself from Sep 21) |
| Tool calls | 4,042 (arguments recorded verbatim) |
| Tool results | 4,040 (full output; 136 errors) |
| Sidecars | 45 files, 26 MB (large results offloaded from the transcript) |
| Archive | `stone-author-session-698bc007-76d7-4c9f-8f93-ad00bf28ca5c.tar.xz` (101 MB, xz) |
| SHA-256 | `3d5cc32d62910c09ab1f701004bf0a4ee6053e69a1b9f4cc22733ff9dde6dee2` |

**Contents:** the transcript `.jsonl` (one JSON object per line: messages, tool calls + arguments, tool
results) and the 45 sidecar files it references (montages and large blobs). It is replayable call-by-call —
which is how the build's every decision, dead end, and correction can be reconstructed.

The build then **continued in a later Claude Code session**, `28da307f-5ea7-4449-815d-ae43b7b0ba89`, which
added the coat tier and the back light — subsurface, specular, the one movable light, black light and the
condition-agnostic spectrum engine, the lens top-coat, and the layer-aware back-light fold (roughly artifact
v49 onward). That session's transcript is retained separately and not yet folded into the archive above, so
the table's counts and hash cover the first session only.

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
record — only the extract is.

| | |
|---|---|
| Extract | `Stone_Author_Transcript_Extract_2026-09-20_to_2026-09-23.docx` |
| Span | 2026-09-20 → 2026-09-23 |
| Size | 43,676 bytes |
| SHA-256 | `e4e6ae9a231746e74e90abb86198ccd92b9d52f24bf815e80dcb074e612fd343` |

## Privacy

The raw Claude archive contains personal paths, an email, and private working notes, so it is kept private;
a curated, scrubbed timeline for the origin story (see [`README.md`](README.md)) is derived from it, and the
raw dump is never shared as-is. The ChatGPT extract above was already curated and scoped before it reached
this record. Verify any copy with `sha256sum <file>` against the hash listed for it.

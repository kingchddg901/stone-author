# Provenance

Stone Author was built in a **single continuous Claude Code session**. The complete forensic
record of that build — every message, every tool call *with its arguments*, and every tool
result — is archived. It's the provenance oracle: the one source that can answer "why is this
the way it is?" down to the exact call that made it.

The raw record is ~254 MB (a 228 MB transcript plus 45 offloaded sidecar blobs it references),
so it is **not committed here** — it lives as a compressed archive kept privately and, if ever
published, attached to a GitHub Release. This file is the pointer to it.

| | |
|---|---|
| Session ID | `698bc007-76d7-4c9f-8f93-ad00bf28ca5c` |
| Span | 2026-09-20 20:03 → 2026-09-23 01:47 UTC (53h 44m wall-clock; the marble studio itself from Sep 21) |
| Tool calls | 4,042 (arguments recorded verbatim) |
| Tool results | 4,040 (full output; 136 errors) |
| Sidecars | 45 files, 26 MB (large results offloaded from the transcript) |
| Archive | `stone-author-session-698bc007-76d7-4c9f-8f93-ad00bf28ca5c.tar.xz` (101 MB, xz) |
| SHA-256 | `3d5cc32d62910c09ab1f701004bf0a4ee6053e69a1b9f4cc22733ff9dde6dee2` |

**Contents:** the transcript `.jsonl` (one JSON object per line: messages, tool calls + arguments,
tool results) and the 45 sidecar files it references (montages and large blobs). It is replayable
call-by-call — which is how the build's every decision, dead end, and correction can be reconstructed.

**Privacy:** the raw archive contains personal paths, an email, and private working notes, so it is
kept private. A curated, scrubbed timeline for the origin story (see [`README.md`](README.md)) is
derived from it — the raw dump is never shared as-is. Verify a copy with
`sha256sum <archive>` against the hash above.

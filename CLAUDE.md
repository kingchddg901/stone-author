# Working in this repo

## Read before measuring

The engines are **already characterised**. Before running any experiment comparing browsers, read:

- **`docs/final-render.md`** — cross-engine differences with numbers: each engine is byte-deterministic
  with itself; Gecko differs from Blink by a mean of 7.919/255 and WebKit by 8.547/255, reproduced across
  runs. Same magnitude, different kind — **Gecko's difference lives in gradient and blur quantisation
  inside the blooms**, WebKit's at every edge, where its small-geometry anti-aliasing leaves debris chips
  visibly blocky.
- **`docs/gallery.md`** — the engine gate that produces those numbers, and what each engine does to the
  bloom (Gecko: concentric ring banding around every glow, plus a broad diffuse wash).
- **`docs/capabilities.md`** — the draw order, including where the bloom sits in `applyCoat`.
- **`docs/renderer-determinism.md`** — what was added on 2026-09-26: cross-*architecture* drift and the
  farmed-tile question. It builds on the above rather than replacing it.

**The blooms are the known locus of engine disagreement.** A brightness difference between engines in a
dark region is that, not a new discovery. Measuring it again costs a round trip and finds what the docs
already say.

## A short sample measures the ramp, not the steady state

Two unrelated systems here behave this way, and the error always runs the same direction — it makes the
weaker device look worse than it is.

**Render.** Mobile devices get faster through a run as the CPU governor commits to higher clocks; desktops
do not. Measured as ms per MB of output, by quarter of the run: Tab A 114/116/92/**79**, S23
106/118/94/**82**, desktop Chrome 116/88/94/**101**. And the **first tile is expensive on every device** —
138% of its own average on the Tab A, 177% on the iPhone, 215% on desktop Chrome, where a fixed warm-up
cost is a larger fraction of a 3.6-second tile.

So a small render is measured almost entirely inside the ramp and **understates** a device's sustained
throughput. It is not a conservative proxy for a large one.

**Network.** The same, on the radio. The Tab A moved 46 MB at 5.5 MB/s and 793 MB at **12.7** — the small
transfer never left TCP slow-start and Wi-Fi rate adaptation. The iPhone shows no such effect (29.5
against 29.3), the S23 a small one. The weaker the link, the longer it takes to settle, so the device
most likely to be written off is the one the short sample misjudges most.

**Read the transferred size before reading the rate**, and prefer a full-size run when the number will be
used to decide whether a device is viable.

## Gates before any push

```
node tools/check-i18n.mjs          # every string routed, every pack complete
node tools/check-build.mjs         # the build marker moves when the app does
node tools/check-render-purity.mjs # nothing that scales the coat may measure the window
node tools/check-wake-lock.mjs     # every export path takes and drops the screen lock
node tools/check-device-seal.mjs   # the device identity is sealed under the slab, and fails closed
node tools/check-bleed.mjs         # every blur has bleed behind it; the bloom is probed, not assumed
node tools/check-meta-window.mjs   # a master's own record is found however far back in the file it sits
node tools/check-fn-refs.mjs       # every line pin in docs/functions.md lands on its function
node tools/check-material-fork.mjs # the stone/wood/X branch lives at one seam, nowhere else
node tools/check-gpu-sync.mjs      # the app's copy of the shader and packer matches tools/lib
node tools/check-preview-face.mjs  # the studio asks once whether the GPU drew this frame
node tools/check-plan-memory.mjs   # only a render the planner CHOSE may write the remembered tile
node tools/check-coat-field.mjs    # one predicate decides both the subsurface field and the bleed it drops
node tools/check-fmt-vocab.mjs     # a slider readout that prints a word routes it; the prose rule cannot see one
node tools/check-i18n-fallback.mjs # a routed element inline fallback still says what its dictionary entry says
node tools/check-draft-gate.mjs    # an unreviewed translation is offered, never imposed on a matching browser
```

The browser harness (`harness/*.mjs`) needs Playwright and **does** run locally, through
`launchChromium` in `harness/browser.mjs`. Corrected 2026-11-02: this used to say it cannot spawn here,
which stopped being true when that fallback landed on 2026-10-31. A **bare** `chromium.launch()` still
dies with `spawn UNKNOWN` — full `chrome.exe` wants a private side-by-side assembly this box does not
have, at *every* revision — but the fallback launches `chrome-headless-shell` from Playwright's own
cache instead, and all 15 harness scripts that open a browser route through it, `npm run verify`
included.

**The numbers still belong to CI.** Locally the fallback is chromium 148; CI runs the pinned 1.48.2's
own build. So verify here that a harness edit *runs*, and never compare a pixel or a timing from a local
run against a committed baseline. `harness/engines.mjs` is deliberately not wired to the fallback,
because there the browser's identity is the measurement.

**That list is not the CI set, and CI is not `tools/**`.** There are **47** `tools/check-*.mjs` and the
block above names 16. `tools/**` in `i18n.yml` is the **trigger** — it decides *when* the workflow runs,
not *what* it runs. The workflow then executes an **explicit list of named `run:` steps**, so a check that
is not in that list gates nothing, however green it is locally. Corrected 2026-10-30: this used to say the
other checks "gate a push whether or not they were run here", which is how two gates written that same day
were left out of CI by the person who wrote them. **A new `check-*.mjs` is not wired until it is a step in
`.github/workflows/i18n.yml`.** Run all of them before pushing anyway:

```
for f in tools/check-*.mjs; do node "$f" >/dev/null 2>&1 || echo "RED: $f"; done
```

**And that sweep is not the CI set either — `check-*` is not all of it.** CI runs `tools/probe-*.mjs`
steps too, and some take a flag. `probe-cut-section` sat RED in CI for three commits on 2026-10-31
because the glob above cannot see a `probe-`, and the push before each one was gated on a green sweep.
Read the names out of the workflow and run those:

```
grep -oE 'node tools/[a-z0-9.-]+\.mjs( --[a-z-]+)?' .github/workflows/i18n.yml | sort -u | while read -r c; do $c >/dev/null 2>&1 || echo "RED: $c"; done
```

**Four come back RED from the `check-*` glob and are not failures — they are tools with no argument.**
`geometry`, `placement`, `same-image` and `seam` each take a `master.tif` and analyse it (*is there
actually a stone in this file?*, *does every tile sit where it says it does?*, and so on). This repo
deliberately does not commit masters, so run bare they print a usage line and exit 1 or 2. Do not go
chasing them as something a change just broke. One of the four is not like the others: **`same-image` has
a working `--selftest` that CI already runs**, so it is green in CI and red in the sweep only because the
sweep does not pass the flag, and the workflow-derived sweep above passes it. The other three are not
CI steps at all, so they never appear in that one. `seam`'s `--self-test` is a mode applied to a
master, not a substitute for one, and `geometry` and `placement` have no self-test at all.

**`check-build` cannot see your working tree, so it can only go red AFTER you commit.** It diffs
`HEAD~1..HEAD` — the last two COMMITS — and asks whether `app/stone-author.html` moved while `BUILD` did
not. Run before committing it is reporting on the PREVIOUS commit and says nothing about the one you are
about to make, which is why it reads green right until the moment it matters. Bump `BUILD` in the SAME
commit as any app edit, and if you only notice after, amend rather than leave a bump commit behind.
Missed twice in a row on 2026-10-29, both times by running the gates, seeing green, and committing after.

**A derived CI expectation from `.github/workflows/*.yml` alone undercounts.** `pages build and deployment`
is GitHub-managed and is not one of those files, so a push that changes the app fires three runs, not two.

**And it is not the app that fires it — every push to `master` does.** Measured across six pushes on
2026-11-01: it ran for one that changed `app/` + `tools/` + `docs/`, one that changed `app/` + `docs/`,
two that changed `harness/` + `docs/`, one that changed **only** `docs/`, and one that changed **only**
`harness/`. So the derivation is *the workflows whose `paths:` match, plus one*, always — and that rule
was then used FORWARD rather than only backward: the commit adding this paragraph changes **only this
file**, which no workflow's `paths:` lists, so it was predicted to fire pages alone. It did, which is
worth more than the six counts behind it. Getting that
wrong is not cosmetic in either direction: expect too many and a clean CI reads as inconclusive, too
few and a run you never looked at reads as green. Derive the workflow part from each file's own
`on.push.paths` rather than from habit — `engines.yml` wants `harness/engines|compare|png|hero.mjs`
specifically and sits out almost everything, and `i18n.yml` does **not** list `harness/`, so a
harness-only push fires gallery and pages and nothing else.

## Facts that bite

- **This repo is public.** `.claude/` is gitignored and stays that way — private tooling and notes live
  there. Never commit anything from it.
- **`app/stone-author.html` is the whole app**, and it is also the artifact. One file.
- **British spelling** in user-facing strings and prose. Exceptions: "artifact" (rendering term of art)
  and -ize endings (valid Oxford British).
- **`state` in a master's metadata cannot tell two pictures apart** — it moves on tool and layer
  selection and does not move when the light changes. Use `inputs` (the render signature). Both are
  recorded; `state` is kept only so older masters still read.
- A master that finished is not a master that is correct. **Audit before trusting**: a lost canvas writes
  a transparent tile and the export reports success. `tools/tiff-meta.mjs` reads any master's own record
  of itself.

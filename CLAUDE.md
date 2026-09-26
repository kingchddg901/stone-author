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

## Gates before any push

```
node tools/check-i18n.mjs          # every string routed, every pack complete
node tools/check-build.mjs         # the build marker moves when the app does
node tools/check-render-purity.mjs # nothing that scales the coat may measure the window
node tools/check-wake-lock.mjs     # every export path takes and drops the screen lock
```

The browser harness (`harness/*.mjs`) needs Playwright and runs in CI; it cannot spawn locally here, so CI
is its first run.

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

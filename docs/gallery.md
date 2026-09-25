# The gallery & the determinism harness

The public showcase (`gallery/`), the render recipe that drives it (`gallery/reference.json`), and the
Playwright harness (`harness/`, `.github/workflows/gallery.yml`) that proves the render is a pure
function of the slab. Companion docs: [`architecture.md`](architecture.md) (how the studio is built),
[`final-render.md`](final-render.md) (the offline render pipeline the harness calls).

The one-line claim the gallery makes and the harness defends: **the `.json` slab is the master, and the
render is a deterministic function of it** — the same slab produces the same image, byte for byte, at any
resolution, in a fixed browser build.

---

## The gallery — `gallery/`

A static showcase page (`gallery/index.html`, no build) titled **"African St Laurent, Warped"**: one
authored marble idea shown four ways — **pristine → subtly wrong → screaming → turned inside out**. Four
*heroes* rendered from **two slabs**:

| # | hero | slab | what it is |
|---|---|---|---|
| 01 | **before** | `slabs/before.json` | the married gold-and-white fracture network on near-black granite, exactly as authored — no warp, no burn |
| 02 | **daylight** | `slabs/warped.json` | the same stone warped ~1.5 % and scorched at the junction: nothing you can point to, but the veins don't quite land |
| 03 | **psyker** | `slabs/warped.json` | the *same* slab at full warp, recoloured into emission under a −1 (UV/psyker) spectrum, with a **reality window** at the burn — daylight stone showing through the screaming |
| 04 | **chaos** | `slabs/warped.json` | the same slab, same disc, **mask inverted** — the warp acts *only* inside the disc, so the stone around it holds still in daylight while the window looks out on the −1 spectrum. The 03 relationship turned inside out |

### `slabs/Hero_Psyker.json` — the psyker hero as a standalone slab

Heroes 02–04 are `warped.json` plus settings the harness applies at render time, so the psyker look does
not exist as a file you can simply **Load**. `Hero_Psyker.json` is that file: the same slab with the UV
palette baked into `OVR_uv` (each entry stored against spectrum −1, `lay:minor` deliberately absent so the
minors stay dark) and the reality window added as a real `mask` mark. `moonStrength` needed no change —
`warped.json` already carries 2.15, which means the harness's override is a no-op for 03 and 04 and only
ever mattered for 02.

**Load it, then press Black light.** A slab always opens in daylight — `uvMode`/`lightSpectrum`/`spotOn`
are deliberately not persisted — so the palette arrives with the file but the light does not. Verified by
ablation: at spectrum −1 this slab renders 2,653 saturated pixels of 16,892 sampled (cyan 1072, orange 911,
green 290, magenta 194) while `warped.json` at the *same* spectrum renders **0 lit, 0 saturated** — the
difference is entirely the baked palette.

The gallery image also has a **burn** pass applied after the render (radial multiply + lighter at the
junction, from `reference.json`). That is a post-process on the exported canvas, not part of any slab, so
the preset does not carry it.

Daylight and psyker are one geometry under two lights: at rest it reads near-true; under the other
spectrum the distortion it was always carrying is exposed. Committed PNGs live in `gallery/img/` at
**1600 × 1000** (the slab keeps its 8×5 ratio); the page notes the same slabs re-render up to ~168 MP.
Each slab re-loads into Stone Author (Load → the `.json`) and re-renders at any size.

The page is dedicated to the public domain under **CC0 1.0** — as is the whole repo, studio included;
see [`architecture.md`](architecture.md#licensing).

## The recipe — `gallery/reference.json`

The slabs are the master, but two heroes add post-steps that aren't stored in the slab (a scorch, an
emission palette, a protective mask). `reference.json` is that recipe plus the reference hashes, read by
`harness/render.mjs`:

- **`width` / `height`** — the render size (1600 × 1000).
- **`burn`** — the scorch at the junction, applied to the finished canvas as two radial overlays: a
  `multiply` gradient (darkens to a charred centre) then a `lighter` ring (the ember glow). Pure
  compositing on top of the render; not part of the slab.
- **`psykerPalette`** — `spectrum: -1` plus an `OVR_uv` map of per-layer emission colours (veins fire
  electric cyan, granite scatters in neon). Applied by writing `{v:-1, c}` emission entries onto the
  live `OVR_uv` before rendering.
- **`heroes[]`** — per hero: `slab`, output `image`, and the extra steps — `spectrum`, `moonStrength`
  (overrides the slab's moon force), `mask` (`{at, r, feather, window, invert, spec}` — `window:true` = a
  reality window, `invert:true` makes the disc the **only** place the warp may act, and `spec` is the
  window's own light, 0 = daylight. `invert`/`spec` both default off, which is exactly what heroes 01–03
  were rendered with before either existed, so their hashes are unmoved), `palette` (`"psyker"` or false),
  `burn` (bool).
- **`pixelSHA256`** — SHA-256 over the **raw RGBA `getImageData`** of the final canvas. This is the
  cross-*system* reference: file bytes are encoder-specific, raw pixels are not.
- **`fileSHA256`** — SHA-256 of the committed PNG (same-encoder integrity of what's in `img/`).

`before` is a pure slab render (`deserialize` + render, daylight); `daylight` and `psyker` layer the
recipe's extra steps on top.

---

## The harness — `harness/`

The shipped `app/stone-author.html` has **no external render API** on purpose. The harness adds one only
in a throwaway copy:

- **`inject.mjs`** — reads the shipped app, splices a tiny `window.__sa` hook *inside* the app's IIFE (so
  it can see the closure: `deserialize`, `renderFull`, `setSpectrum`, a `render()` rebuild, and getters
  for `G` / `OVR_uv` / `marks` / `layers`), and writes `harness/dist/stone-author.hooked.html`. **The
  shipped artifact stays clean** — the hook lives only in `dist/`.
- **`render.mjs`** — launches headless Chromium (Playwright), loads the hooked page, and for each hero
  runs the recipe: `deserialize(slab)` → apply moon/mask/palette/spectrum overrides → `render()` →
  `renderFull(W)` → optional burn overlay → hash the raw RGBA. It renders **each hero twice from a fresh
  `deserialize`** and asserts the two hashes are **identical** — the **self-determinism gate**. `--write`
  additionally regenerates `gallery/img/*.png` from the render.
- **`hero.mjs`** — the hero recipe itself (mask, moon, palette, spectrum, burn), shared by `render.mjs`
  and `engines.mjs`. It lives on its own because a second copy of it would drift, and the copy that
  drifted would be the one a gate was measuring.
- **`engines.mjs`** — the same hero in **Blink, Gecko and WebKit**, in one job. Safari cannot be tested
  from a PC, and every browser on iOS is WebKit underneath, so WebKit is the one engine the studio ships
  to blind; Playwright's WebKit is not Safari (no Apple GPU or media stack) but it is the same rasteriser
  and the same canvas limits. See *[three engines, one job](#three-engines-one-job)* below.
- **`package.json`** — scripts: `build` (inject only), `verify` (inject + render = the gate), `render`
  (inject + render `--write`). One dev dep: `playwright` pinned to **1.48.2**.

```bash
node harness/inject.mjs && node harness/render.mjs            # self-determinism gate
node harness/inject.mjs && node harness/render.mjs --write     # + regenerate gallery/img/*.png
node harness/inject.mjs && node harness/engines.mjs            # Blink vs Gecko vs WebKit
```

## CI — `.github/workflows/gallery.yml`

On push to `master` and on PRs touching `app/stone-author.html`, `gallery/**`, `harness/**`, or the
package files (plus `workflow_dispatch`), the workflow runs inside the pinned
`mcr.microsoft.com/playwright:v1.48.2-noble` container: `npm ci` → `node harness/inject.mjs` →
`node harness/render.mjs`. A non-identical pair fails the job.

---

## Three engines, one job

`engines.mjs` renders the richest hero — burn pass, mask, reality window — at **1024** in all three
engines. A small render is the right instrument for this: since the coat is scaled by `COAT_REF` rather
than by the window ([final-render.md](final-render.md)), a 1024 render is proportionally the same picture
as a 32768 one, so an engine's rasterisation signature shows up at 1024 in the same proportions for a few
seconds of CPU. What 1024 cannot show is anything that only exists past a cap, so the caps are measured
separately, at the band shapes the strip path actually asks for.

Per engine it reports: `CompressionStream` (without it the large tiers are not offered at all), the
largest single canvas side by bisection, whether `4096×4096`, `20724×2048`, `65535×512` and `65535×1024`
can each hold a written pixel at the far corner, self-determinism, a streamed multi-band PNG, and the
difference from Blink as a mean, a max, a percentage and an **8×8 map** — so the *shape* of the difference
is visible, and anti-aliasing everywhere reads differently from one blown-out region.

What **fails** the job: an engine that will not launch, a render that is not deterministic within that
engine, a flat render, a streamed PNG that does not decode to the size it declares, fewer bands than the
forced band height should produce (which would mean the easy single-band path was tested instead), and a
mean difference past **48/255** — a catastrophe detector, not a fidelity bar. What is **reported but not
gated**: the difference itself, flagged above 8/255 for a human. Cross-engine byte identity was never the
claim; the picture is. There is no measured baseline yet for what Gecko and WebKit legitimately differ by
at this width, and a bar nobody measured is worse than no bar.

Two things this gate cannot reach: real Safari (Apple's own GPU and media stack), and iOS memory
behaviour. It bounds the risk rather than closing it — the expected WebKit outcome is *smaller bands, or
the tier not offered*, not a corrupt file, because the app decides by measuring rather than by engine name.

## What determinism actually holds — and what doesn't

The self-determinism gate exercises exactly the property the "slab is the master" claim rests on, and it
found the shape of that claim precisely:

- **Within a fixed Chromium build the render is byte-identical run-to-run** — across a fresh
  `deserialize`, a reload, even a process restart. The render is a **pure function of the slab** here.
  This is what the [`deserialize` hard-reset](functions.md) buys: a load resets `G`/`T`/`NEXT` to their
  captured pristine defaults (`G0`/`T0`/`NEXT0`) *before* applying the slab and invalidates the
  cloud/band/breccia + incremental caches, so nothing from a previous slab or a dirtied session can leak
  into the result. The harness renders twice from a fresh load precisely to exercise this.
- **Across *different* Chromium builds the raw bytes differ** — sub-pixel canvas anti-aliasing is not
  specified to the bit and varies between builds. **The picture is identical; the bytes are not**, and
  that difference is below what a shared image is for. So the CI **gates on self-determinism** (hard) and
  **deliberately does not gate on a cross-build reference match**: the committed `pixelSHA256` is a
  recorded reference (informative when compared from another environment), not a pass/fail bar. The
  cross-build reference comparison was dropped from the harness for this reason.

The practical consequence: regenerate `gallery/img/*.png` (`--write`) and re-record the hashes from the
*same* environment you'll gate in, and pin that environment (the container image) so the gate is stable.

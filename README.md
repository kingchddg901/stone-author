# Stone Author

Tools for making stone: author it by hand, generate it, or rip it from a photograph — and
lay it as tile. Extracted from the HA dashboard builder once the stone work outgrew it.

The dashboard is one *consumer* of what this repo produces. This repo is the *producer*:
the authoring app, the generator, the rip/harvest pipeline, and the mask format they share.

## How it came to be

It started as one sentence: **"I want a better background for my Home Assistant card."**

Nobody believes the rest came from that, so here is the lineage.

1. **Theming the cards came first.** A Lovelace card needed its colours editable without
   hand-writing CSS. The machinery for that — declare a token, get an editor, let users re-theme —
   had nothing to do with Home Assistant, or with any particular tokens, so it came out as its own
   library: **[token-theme-kit](https://github.com/kingchddg901/token-theme-kit)**, extracted from
   the card. *(First extraction.)*

2. **The background wanted to be stone.** Marble, granite — not a flat fill, and not a stock JPEG
   that pixelates when the card resizes. A photo can't scale; a *description* of the stone can. So
   the texture became a **generator**: emit the stone as structure, rasterise it to greyscale
   **value masks** at whatever size the surface needs. Colour never bakes in — it routes at draw
   time from the theme.

3. **The generator was good at structure and bad at art.** It could reproduce measured facts about
   real marble but it couldn't be *directed*. So the model flipped to an **authored generator**:
   you draw where the line goes, and the family decides what it becomes. Your line is the route;
   the family is the character.

4. **Then it kept growing.** A pour brush. A tile engine (15 patterns, real grout and kerf). Pen
   pressure and tilt. Gravity and magnet brushes. A layer model. Marble primitives — clouds,
   banding, breccia, drusy, stylolites. Vein-structure variants. Each addition was small; the sum
   outgrew the dashboard builder it lived in.

5. **So it became its own repo.** That extraction *proved* the boundary was real: the stone tools
   came away clean, and the dashboard kept only the thin renderer that consumes their output.
   *(Second extraction.)*

6. **The loop closed** when colour needed a home. The token-theme-kit from step 1 — built to theme
   a DOM, having never imagined a `<canvas>` — dropped into the authoring app as its colour engine,
   *unchanged*. A card's theming engine now colours a marble slab it will never be rendered on.

A card background → a theming engine and a stone generator → an authoring studio → its own repo → a
pluggable colour layer, with a WebGPU render pipeline next. Two clean extractions along the way,
each one the proof that the layer under it was real. Not the path anyone would have planned — the
path that taking one small want seriously actually produced.

> This README is the story. The **code** is documented separately and without the narrative:
> [`docs/architecture.md`](docs/architecture.md) (how the parts fit) and
> [`docs/functions.md`](docs/functions.md) (the function reference).

## What's here

### `app/` — the authoring tools (self-contained HTML, open in any browser)
- **`stone-author.html`** — the main tool. Draw where the lines go; the family (Carrara,
  Calacatta, Nero Marquina, Granite) decides what they are. Tools: Vein, Branch, Web,
  Stylolite, Pour, Gravity, Magnet, Chip, Tune, Cloud, Moon, Mask (protected islands / reality
  windows), Light, Move. Pen pressure and tilt (opt-in). **Lay tiles**
  cuts the authored slab into a repeating pattern on a floor — 15 patterns (square, rectangle,
  subway, hexagon, Cairo, diagonal, herringbone, basketweave, triangle, rhombus, octagon,
  penny, fish scale, arabesque lantern, French/Versailles), with grout, kerf, edge finish,
  and per-tile chipping. Sizes are real, on an 8×5 ft slab. Marble **primitives** (clouds,
  banding, breccia, drusy, stylolites) and per-line **vein variants** (sinuous, dendritic,
  en-echelon, boudinage, halo). A **layer** model (eye / solo / opacity, blend, glow) and a
  **colour layer** — colour decoupled from the family, edited through the vendored token-theme-kit
  — so the slab is a saveable *source* that bakes to masks at any size. See
  [`docs/architecture.md`](docs/architecture.md).
- **`stylus-probe.html`** — reports exactly what a stylus sends the browser (pen vs touch,
  pressure levels, tilt, hover, sample rate) plus a debug history. Used to tune the pen.
- **`pollock-pour.html`** — the pour brush on its own: paint thrown along a line.
- **`breathing-constellation.html`** — a starfield toy that breathes through the spectrum.

Each app is one file with everything inline. No build step; no server needed to open one.

### `gallery/` — the public showcase
A static page (`index.html`, no build) — **"African St Laurent, Warped"**: one authored marble idea
shown three ways (pristine → subtly wrong → screaming). Three heroes (`img/*.png`) from two slabs
(`slabs/before.json`, `slabs/warped.json`); `reference.json` is the render recipe + reference hashes.
CC0. See [`docs/gallery.md`](docs/gallery.md).

### `harness/` — the determinism harness
A Playwright harness that renders each gallery hero from its slab under headless Chromium and gates on
**self-determinism** (byte-identical twice from a fresh load). `inject.mjs` adds a render hook to a
throwaway copy of the app (the shipped file stays clean); `render.mjs` runs the gate (`--write`
regenerates the gallery PNGs); `.github/workflows/gallery.yml` runs it in CI. See
[`docs/gallery.md`](docs/gallery.md).

### `tools/` — the Python pipeline
- **`stone_generate.py`** — generate stone as independent layers (L1 layering, L2 fractures,
  L3 crystals, L4 pour). `python tools/stone_generate.py --self-test`. Its output masks are
  interchangeable with ripped ones.
- **`stone_rip.py`** — rip layer masks out of a photograph (colour routes, greyscale stores).
- **`stone_harvest.py`** — run the rip over many stones; writes masks, label maps, t-maps,
  vector paths, and a record per stone.
- **`stone_verify.py`, `stone_sweep.py`, `stone_dedupe.py`, `stone_contact.py`,
  `stone_preview.py`, `stone_screen.py`, `stone_fetch.py`** — measurement, verification,
  and support for the pipeline.
- **`stone-studio.html` / `serve-studio.py` / `stone-dump.mjs`** — a control surface over
  the panel generator (ES modules need a server: `python tools/serve-studio.py`).

### `docs/`
- **`architecture.md`** — what the whole system is and how the parts fit (the *code* documentation;
  the origin story is this README). Start here.
- **`functions.md`** — the function reference for `app/stone-author.html`, grouped by subsystem.
- **`capabilities.md`** — the verified inventory of what an authored slab can use (tools, settings,
  coat/spectrum/back-light/lens, layers, export), from a four-way code read.
- **`final-render.md`** — the offline render pipeline (`renderFull`/`renderTiled`, workers, encoders)
  and roadmap, plus the CPU/GPU split.
- **`colour-layer.md`** — the colour engine: character vs colour, the vendored token-theme-kit as
  editor + resolver, the adjustment set, the per-id / speck-group colour, the canvas colour menu.
- **`gallery.md`** — the gallery showcase, the render recipe, and the determinism harness/CI.
- **`stone-generator.md`** — every rule in the Python/panel generator, each traced to a measurement
  or a defect. Read before changing that generator.

## The output contract (what a consumer reads)

A stone is a set of greyscale **value masks**, one per layer/tier, plus optional
`<band>-labels.png` (16-bit vein id), `<band>-<tier>-t.png` (position along a vein),
`<band>-<tier>-paths.json` ([y, x, half-width] per point), and `direction-field.npy`.
Colour is never stored — it routes at draw time from a theme. A generated layer and a
ripped layer are the same shape, so downstream code can't tell them apart. This is the seam
the dashboard card consumes.

## Consumers

The HA dashboard builder keeps only the *renderer* — the card that takes masks + a theme and
draws the tile (`panel/stone-art.js`, `stone-raster.js`, `stone-controls.js` over there).
Coupling is loose: this repo produces mask files; the dashboard vendors a copy of the built
masks. No cross-repo build.

## Provenance

Reference photographs used to rip stone are other people's product photography and **never
enter this repo**. Only code, synthetic output, and stone from the author's own material may
be committed. The harvested corpus stays local.

## Status

Extracted from `ha-dashboard-builder` (2026). The authoring app has, so far: save-the-source +
autosave, first-class layer control (many layers per bucket, reorderable stack), the marble primitives
batch (clouds, banding, breccia, drusy, stylolites, **fog / resin core**), per-line vein variants, the
export step (one zip: masks + rich id/t maps + `.ora` + SVG + source), and a colour layer via the
vendored token-theme-kit — per-layer *and* per-artifact colour, selected by clicking, with a full
render-time **adjustment set** (blur · hue · saturation · brightness · contrast · weight) that resolves
artifact → layer → bucket. Granite is **field-per-layer**: every **+ Granite layer** is its own speck
field with its own density, size, seed, colour and adjustments — the "Pollock engine".

Since then it has grown a **coat tier** (subsurface glow, specular top-coat + feature glint, one movable
light with warm↔cool temperature, tile-edge relight); a condition-agnostic **spectrum engine**
(`lightSpectrum` + per-artifact emission colours — black light, reactive spotlight, any spectrum); a
**layer-aware back light** (each layer declares its transmittance + scatter); a **lens top-coat** (ideal
glass relief — fresnel / reeded / water — as real per-pixel refraction); **warp** (a global cloud-driven
field, the local **moon** brush, **protected-island masks**, and **reality windows** that show daylight
through under another light); and a **deterministic load** (`deserialize` is a pure function of the slab).
The offline render bakes the whole pipeline (`renderFull` / tiled), and a **gallery** + Playwright
**determinism harness** ([`docs/gallery.md`](docs/gallery.md)) show it off and gate it in CI.

A render is not capped by what one canvas can hold. Past 16384 the export **streams the picture in bands**
straight into a PNG, so the whole image never exists at once: measured in Chrome on a 12-core desktop,
**65535 × 40959 — 2.68 gigapixels — took 10:56 in a browser tab**, 35 bands, 10.7 GB of scanlines
compressed into an 841 MB file, and run twice across a build change it came back byte-identical. The
friction in front of that tier is not decoration: the same slab is **0:14 at 16384 and 3:07 at 32768**,
because streaming costs roughly three times as much per pixel as the direct path. Full ladder in
[`docs/capabilities.md`](docs/capabilities.md).

**Stone Author is stone-only**: the early Wood family and Knot tool were removed once the stone system
outgrew them — wood (author a tree by its rings, then "mill" boards as geometry) and metal are envisioned
as their own future systems that reuse this producer/consumer spine. Next up is a **WebGPU render
pipeline** and **layered PSD/PSB export** (one file-layer per authoring layer) — see the roadmap in
[`docs/architecture.md`](docs/architecture.md) and [`docs/final-render.md`](docs/final-render.md).

**Licence.** [CC0 1.0 Universal](LICENSE) — public domain. To the extent possible under law, Chris King
has waived all copyright and related rights to `stone-author`, including the gallery slabs and renders.
**No attribution required** — use it, fork it, print it, sell it. The vendored `token-theme-kit` is CC0
as well, so there is no notice you are obliged to keep. (Credit is welcome, never owed.)

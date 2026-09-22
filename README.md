# Stone Author

Tools for making stone: author it by hand, generate it, or rip it from a photograph — and
lay it as tile. Extracted from the HA dashboard builder once the stone work outgrew it.

The dashboard is one *consumer* of what this repo produces. This repo is the *producer*:
the authoring app, the generator, the rip/harvest pipeline, and the mask format they share.

## What's here

### `app/` — the authoring tools (self-contained HTML, open in any browser)
- **`stone-author.html`** — the main tool. Draw where the lines go; the family (Carrara,
  Calacatta, Nero Marquina, Granite, Wood) decides what they are. Tools: Vein, Branch, Web,
  Pour, Gravity, Magnet, Knot, Chip, Move. Pen pressure and tilt (opt-in). **Lay tiles**
  cuts the authored slab into a repeating pattern on a floor — 15 patterns (square, rectangle,
  subway, hexagon, Cairo, diagonal, herringbone, basketweave, triangle, rhombus, octagon,
  penny, fish scale, arabesque lantern, French/Versailles), with grout, kerf, edge finish,
  and per-tile chipping. Sizes are real, on an 8×5 ft slab.
- **`stylus-probe.html`** — reports exactly what a stylus sends the browser (pen vs touch,
  pressure levels, tilt, hover, sample rate) plus a debug history. Used to tune the pen.
- **`pollock-pour.html`** — the pour brush on its own: paint thrown along a line.
- **`breathing-constellation.html`** — a starfield toy that breathes through the spectrum.

Each app is one file with everything inline. No build step; no server needed to open one.

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
- **`stone-generator.md`** — every rule in the generator, each traced to a measurement or a
  defect. Read before changing the generator.

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

Extracted from `ha-dashboard-builder` (2026). License: TBD — not yet chosen, so treat as
all-rights-reserved until one is added.

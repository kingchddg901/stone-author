# Stone Author — architecture & origins

What this system is, how its parts fit, and — because nobody believes the origin — how it
came to be. For the deep dives, see [`stone-generator.md`](stone-generator.md) (the Python/panel
generator, rule by rule) and [`colour-layer.md`](colour-layer.md) (the colour engine).

---

## Origins

It started as: **"I want a better background for my Home Assistant card."**

That is the whole seed. The rest grew out of taking that sentence seriously.

1. **Theming the cards** came first. A Home Assistant Lovelace card needed its colours to be
   editable without hand-writing CSS. The machinery for that — declare a token, get an editor,
   let users re-theme — turned out to have nothing to do with Home Assistant, or with any
   particular tokens. So it came out as its own thing: **[token-theme-kit](https://github.com/kingchddg901/token-theme-kit)**,
   a zero-domain theming engine, *extracted from* that card. (First extraction.)

2. **The background itself** wanted to be stone — marble, granite — not a flat fill or a
   stock JPEG that pixelates when the card resizes. A photo can't scale; a *description* of the
   stone can. So the texture became a **generator**: emit the stone as structure (veins as
   polylines, tiers, a direction field), rasterise it to greyscale **value masks** at whatever
   size the surface needs. Colour never gets baked in — it routes at draw time from the theme.
   That is the spine everything shares: *colour routes, greyscale stores.*

3. **The generator was good at structure and bad at art.** It could reproduce measured facts
   about real marble (branch spacing, tier independence, visibility floors — all in
   `stone-generator.md`) but it couldn't be *directed*. So the model flipped to an **authored
   generator**: you draw where the line goes, and the *family* decides what it becomes — how it
   roughens, swells, breaks, branches. Your line is the route; the family is the character.

4. **Then it kept growing.** A pour brush (paint thrown along a line). A tile engine (cut the
   slab into a repeating floor — 15 patterns, real grout and kerf). Pen pressure and tilt. Gravity
   and magnet brushes for granite. A layer model. Marble primitives — clouds, banding, breccia,
   drusy, stylolites. Vein-structure variants. Each addition was small; the sum outgrew the
   dashboard builder it lived in.

5. **So it became its own repo** — `stone-author`. That extraction *proved* the boundary was
   real: the stone tools came away clean, and the dashboard kept only the thin renderer that
   consumes their output. (Second extraction.)

6. **The loop closed** when colour needed a home. The token-theme-kit from step 1 — built to
   theme a DOM, having never imagined a `<canvas>` — dropped into the authoring app as its colour
   engine, *unchanged*. Its editor builds itself around the stone's layers; its resolver hands
   back values the canvas paints with. A card's theming engine now colours a marble slab it will
   never be rendered on.

So: a card background → a theming engine and a stone generator → an authoring studio → its own
repo → a pluggable colour layer, with a WebGPU render pipeline next. Two clean extractions along
the way, each one the proof that the layer under it was real. It is not the path anyone would
have planned. It is the path that taking one small want seriously actually produced.

---

## The shape: producers, consumers, one contract

The repo is the **producer**. Its output is a set of greyscale **value masks** — one per
layer/tier — plus optional metadata (16-bit vein-id maps, along-the-vein *t*-maps, vector paths,
a direction field). **Colour is never stored.** A mask says *where* and *how much*; a theme
decides *what colour*, later.

Because the contract is just "greyscale masks + optional metadata," a mask that was **authored**,
one that was **generated**, and one that was **ripped from a photograph** are the same shape —
downstream code can't tell them apart. That interchangeability is the point.

**Consumers** read the contract at whatever richness they need:

- **Vacuum Agent** (`eufy-vacuum-manager`) — the simple reader: 4 grey masks (base / major /
  minor / micro) at 2048².
- **HA dashboard builder** (`ha-dashboard-builder`) — the rich reader: masks plus vein ids and
  *t*-maps, the per-tier colour model, the tile wrap. It keeps only the *renderer*
  (`panel/stone-art.js`, `stone-raster.js`, `stone-controls.js`); this repo produces the masks it
  vendors.

Loose coupling on purpose: no cross-repo build. This repo makes files; consumers copy them.

---

## What's in the repo

### `app/` — the authoring tools (self-contained HTML, no build, no server)

**`stone-author.html`** is the studio (the focus of the recent work). Draw where lines go; the
**family** (Carrara, Calacatta, Nero Marquina, Granite, Wood) decides what they are.

- **Tools** — Vein, Branch, **Stylolite**, Web, Pour, Gravity, Magnet, Knot, Chip, Move.
- **Slab primitives** (per family, seeded, greyscale) — **clouds/mottling**, **banding**,
  **breccia clasts**, **drusy sparkle**, on top of the ground and the fracture/speck structure.
- **Vein-structure variants** (per line) — natural, **sinuous**, **dendritic**, **en-echelon**,
  **boudinage**, **halo**. Chosen on the vein tool; each line keeps its own.
- **Tiles** — cut the slab into a repeating floor: 15 patterns (square, rectangle, subway,
  hexagon, Cairo, diagonal, herringbone, basketweave, triangle, rhombus, octagon, penny, fish
  scale, arabesque lantern, French/Versailles), with grout, kerf, edge finish, per-tile chipping.
  Real sizes on an 8×5 ft slab.
- **Pen** — pressure (width / flow) and tilt (edge softness), opt-in, measured from your rest
  grip. Baseline input is one pointer + time; stylus extras are enhancement, never required.
- **Layers** — each render layer has eye / solo / opacity, and (structural layers) blend mode +
  glow. Solo keeps the stone ground under the isolated layer.
- **Colour** — the token-theme-kit colour layer (see below). Per-layer colour, decoupled from
  family.
- **Save the source** — a slab is a small JSON of marks + family + settings + colour; masks and
  previews **bake** from it at any resolution. Autosaves locally; Save/Load a `stone.json`.

The other apps are focused single-file tools: **`stylus-probe.html`** (what a pen actually sends),
**`pollock-pour.html`** (the pour brush alone), **`breathing-constellation.html`** (a colour toy).

### `tools/` — the Python pipeline

`stone_generate.py` (generate as independent layers), `stone_rip.py` (rip masks from a
photograph), `stone_harvest.py` (rip a corpus), and measurement/verification helpers. The
generator's every rule is traced to a measurement or a defect in `stone-generator.md` — read it
before changing the generator.

### `docs/`

`stone-generator.md` (the generator), `colour-layer.md` (the colour engine), and this file.

---

## How the studio is built

### Character vs colour

A **family** is character only — the *shape* language (rough, swing, breaks, branches; grain vs
specks). It no longer owns colour. **Colour is its own layer**, applied per render layer, anything
you like, independent of the family. This split is the recent architecture's spine and the reason
the colour engine could drop in.

### Render layers vs consumer buckets

Two related ideas kept distinct so the system can grow:

- **Consumer buckets** — the fixed export contract (`base / major / minor / micro`, + `web` for the
  rich reader). Never grows. What VA and the dashboard read *by key*.
- **Render layers** — the (growing) list the studio actually paints. Each tags the **bucket** it
  flattens into. Today mostly 1:1; but clouds/banding/breccia all flatten into `base`, drusy into
  `micro`, stylolites into `minor`. Add a primitive → add a render layer → it exports through its
  bucket automatically.

The paint order is a stack: `base → breccia → clouds → bands → web → micro → drusy → styl →
minor → major`. Base is the *setter* (breccia is an opaque clast mosaic when on); clouds and bands
are soft-light *modulators* over it.

### Determinism — a knob edits, it doesn't re-roll

One PRNG stream per role per sample (`mulberry32`, seeded via `sub(seed, salt…)`). Because each
element draws from its own stable stream, turning a knob **edits** the result instead of
re-rolling it: more pour appends specks, higher drusy density adds crystals (the first N stay put),
cloud scale morphs the field continuously. Counts use an exact-quantile Poisson so a higher rate
never yields *fewer* — the naïve samplers aren't monotone, and it showed.

### Vector to raster

Authoring is **vector** (a vein is a route → core + shoulder; specks and clouds are fields);
rendering is **raster** (drawn 3× supersampled, downsampled). The same source rasterises to a
430-px card or a 2048² mask without a bitmap ever being scaled.

### The colour engine (token-theme-kit)

Vendored into the artifact (bundled ~16 KB, MIT notice kept), used as **editor + resolver** — not
for CSS. Two token groups (*Colour*, *Effects*) feed its self-building editor; its resolver hands
back **values** the canvas paints with (`fillStyle`, `globalCompositeOperation`, canvas shadow).
That value seam is renderer-agnostic on purpose: a WebGPU pass reads the same values into shader
uniforms. Full detail and the canvas colour menu in [`colour-layer.md`](colour-layer.md).

---

## Status & roadmap

**Done:** save-the-source + autosave · first-class layer control · the primitives batch
(clouds, banding, breccia, drusy, stylolites) · vein-structure variants · the colour layer
(per-layer colour + blend + glow via the vendored token-theme-kit).

**Next:** per-id colour (tune any single vein/clast; extends the token-theme-kit repo) · the
remaining canvas colour menu (gradients, filters) · targeted per-item reroll · the export step
(VA's 4 grey masks; the dashboard's rich masks; `.ora` + SVG for lines) · a bake step for
formats/resolutions · a WebGPU render pipeline.

---

## The through-line

**Extractability proves a layer.** Twice now a piece has come away clean — the theming kit from a
card, the stone tools from the dashboard — and each time the clean seam was the proof that what
sat under it was a real layer, not a tangle. The producer/consumer split, the render-layer/bucket
split, the character/colour split, the value-not-CSS resolver: all the same instinct. It is why a
card background could become this without a rewrite at any step.

---

## Licensing

`token-theme-kit` is **MIT** (© 2026 Chris King) — its notice ships with the vendored copy.
`stone-author`'s own licence is **not yet chosen**; until one is added, treat it as
all-rights-reserved. Reference photographs used by the rip pipeline are other people's product
photography and never enter the repo — only code, synthetic output, and stone from the author's
own material is committed.

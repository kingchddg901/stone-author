# Stone Author — architecture

What this system is and how its parts fit — the documentation of the code. The origin story is
deliberately *not* here; it lives in the [README](../README.md). Companion docs:
[`functions.md`](functions.md) (the function reference), [`colour-layer.md`](colour-layer.md) (the
colour engine), [`stone-generator.md`](stone-generator.md) (the Python/panel generator, rule by
rule).

The shared spine, in one line: **colour routes, greyscale stores** — the generator emits
structure, rasterises it to greyscale value masks, and a theme decides colour at draw time.

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

- **Tools** — Vein, Branch, **Stylolite**, Web, Pour, Gravity, Magnet, Knot, Chip, **Tune** (tap a
  vein to colour just that one), **Cloud** (drag to move the cloud/warp field), **Moon** (drag a local
  warp brush across the slab), Move.
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
  family, plus **per-id** overrides (the Tune tool) that inherit their layer until changed.
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
(per-layer colour + blend + glow via the vendored token-theme-kit) · **per-id colour** (the Tune
tool; built on the kit's new `inherit` feature) · **speck colour groups + variants** (a primary/
secondary hierarchy on the granite ground and on drusy pockets) · **warp** (a cloud-driven domain
warp of the whole structure — the molten flow) · **moveable clouds** (drag the warp field with the
Cloud tool) · the **generation warp model** (a rooted trunk, an inverse-square bond from branch to
sub-branch, warp amount rising with depth — "Deep drift") · **export** (one zip: VA's four grey
masks + a base value map, the dashboard's rich id/*t* maps with legend and vector paths, a completed
render, a layered `.ora`, and an SVG — the whole contract in one file, at a chosen pixel width) · the
**warp guide** (the Cloud tool draws the warp field as a teal vector overlay — the source of the
distortion made visible, a guide that never bakes into an export) · the **moon** (a *local* warp brush,
distinct from the gentle global field: drag a "ball" across the slab and it drags the geometry it passes
into its wake, forward-push, fading at the rim; a stored mark, deterministic. Its reverse *field* is the
exact negative, but that's the field on clean stone, not an undo: passes stack in order onto
already-warped geometry, and no hand can retrace a pass point-for-point anyway (same start, every sample
between; the stylus/screen sample rate alone shifts it), so a hand-reverse only ever gets *close* and
leaves a residue that accumulates with repeated tries. That near-miss is the intended authoring feel —
overshoot and chase it back; the mark of the hand is the residue. The **Undo button** (it drops the mark)
is the true undo).

**Next:** per-id beyond veins (clasts / seams) · the remaining canvas colour menu (gradients,
filters) · per-pixel displacement of the base fields under warp · targeted per-item reroll · a bake
step for more formats/resolutions · a WebGPU render pipeline.

---

## Design principle

**Extractability proves a layer.** The seams here are one instinct applied repeatedly —
producer/consumer, render-layer/bucket, character/colour, value-not-CSS resolver. When a piece
comes away clean, the boundary under it was real, which is what lets the system grow by *addition*
rather than by rewrite. New primitive → new render layer tagged with a bucket. New colour control →
new token. New renderer (WebGPU) → same resolved values behind it.

---

## Licensing

`token-theme-kit` is **MIT** (© 2026 Chris King) — its notice ships with the vendored copy.
`stone-author`'s own licence is **not yet chosen**; until one is added, treat it as
all-rights-reserved. Reference photographs used by the rip pipeline are other people's product
photography and never enter the repo — only code, synthetic output, and stone from the author's
own material is committed.

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
**family** (Carrara, Calacatta, Nero Marquina, Granite) decides what they are.

- **Tools** — Vein, Branch, **Stylolite**, Web, Pour, Gravity, Magnet, Chip, **Tune** (tap a
  vein to colour just that one), **Cloud** (drag to move the cloud/warp field), **Moon** (drag a local
  warp brush across the slab), Move.
- **Slab primitives** (per family, seeded, greyscale) — **clouds/mottling**, **banding**,
  **breccia clasts**, **drusy sparkle**, and a **fog / resin core** (a flat, untinted grayscale haze of
  sparse soft particles, rendered deep under the veins to read as sub-surface depth — the milky
  imperfection a fabricator saws off; particles are movable so the magnet can sculpt clear windows and
  pools), on top of the ground and the fracture/speck structure.
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

A **family** is character only — the *shape* language (rough, swing, breaks, branches; the granite
speck ground). It no longer owns colour. **Colour is its own layer**, applied per render layer, anything
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

The paint order is a stack: `base → breccia → clouds → bands → fog → web → micro → drusy → styl →
minor → major`. Base is the *setter* (breccia is an opaque clast mosaic when on); clouds, bands and
fog are soft *modulators* over it.

### User layers within a bucket

A **bucket can hold many layers**. A mark files into the **active layer** of its bucket (a vein → the
active `major` layer, a branch → active `minor`, a web stroke → active `web`); each layer carries its
own **eye / opacity / warp** (and, later, colour / effects / lock). So you can put some majors on one
layer and warp them while another major layer holds dead still — two layers, one bucket, affected
independently. `addLayer(bucket)` creates one (key `bucket#n`, the plain `bucket` key is the default
layer); the Layers panel gives each row eye · name (tap = make active, ▸) · solo · **W** (warp
follow/hold) · opacity, plus **+ Major / + Minor / + Web layer**.

A **layer is an authoring group, orthogonal to the bucket**: `stampLayers` tags every line/edge with
its mark's layer (`L.layer` / `e.layer`), and render + warp read *that*, while export still buckets
each line by its kind. So a single layer can even hold marks that export to different buckets — which
is what makes a cross-bucket "group as an object" selection possible later. Fields that aren't marks
follow the same rule: the **granite speck ground is field-per-layer** — every **+ Granite layer** is its
own micro-bucket layer with its own **density, speck size and seed**, its own colour, and the full
adjustment set, and `buildGround` unions them (each speck tagged with its layer). The fields are
generated independently — reseeding one leaves the others bit-identical — and couple only through shared
marks: a vein deflects around *all* the grains it meets, so both fields' specks bend with it (physical,
not a leak). This is the "Pollock engine": subdivide a roughly-constant on-screen density across
independently-coloured fields.

**Selection scopes effects.** The selection is a set of **token keys** — `lay:<layer>` for a layer (its
row checkbox) or `id:<artifact>` for one **artifact** (tap it with the **Tune/Select** tool; the id is
resolved from the click and stays internal — a selected artifact shows as a dashed accent handle, never a
number). The hit-test walks **veins** (`nearestLine`, key `id:L…`/`id:B…`), **web cracks** (`nearestWeb`; a crack
picks its whole **spread**, key `id:W<mark>`) and **stylolite seams** (`nearestStyl`, key `id:S<mark>`) —
web/seam by point-to-segment (`segD`) — ranks the candidates by distance and takes the nearest within
~26 px. Layers and artifacts live in one selection, and the *same* adjustment set targets any of them.
Nothing selected = the effect's global default. Three things scope to it today, all *baking* onto the
selected keys:
- **Force tools** — select the Fog or a granite layer and Gravity/Magnet sculpt *that* field
  (push clears a window, pull pools), leaving everything else untouched; select nothing → the specks.
- **Colour** — per-layer colour is a **generated token**, `lay:<key>`, minted whole from the layer
  (`layToken(L)`: key from its key, label from its label, `inherit` from its bucket — nothing
  hand-authored, adding a layer *is* authoring its colour). Values live in the flat `OVR` store and the
  render reads them (per-id → per-layer → bucket), so every coloured layer paints. **The editor displays
  only the *selected* layers' tokens** (`registerLayerColours` registers the selection) — so a slab with a
  hundred coloured layers never floods the editor; select to bring a few into view. A `.selact` swatch is
  the quick path; the editor is the fine one. (Modeled on the VA theme-token system: generate from a live
  list, store flat, scope the *display* by selection, inherit from where the token lives.)
- **Warp** — *follow* / *hold* set the selected layers' warp weight (this is what the temporary "Warp
  holds major" toggle did, now general).
- **The adjustment set** — beyond colour, six render-time adjustments per selected target: **blur · hue ·
  saturation · brightness · contrast** (canvas `ctx.filter`) and **weight** (a line-width multiplier).
  Each is a `<key>:<name>` number token (e.g. `id:L1:hue`, `lay:major#2:blur`), generated per selected
  target with VA-style ranges (blur 0–8, hue ±180, the multipliers 0–2). At render each item resolves every
  adjustment up the granularity — **artifact → its layer → its bucket → default** (`adjOf`) — and the
  filters compose into one `ctx.filter` string (`filterOf`); weight scales the stroke width through `runs`.
  So the *same* set tunes a whole layer or a single vein, and a vein only stores what it overrides. Applied
  to veins, web, and the **speck / drusy fields** (per layer, with per-layer field colour); the **fog stays
  untinted by design** (a haze, no colour token). The **coat tier** rides on top: **subsurface** shipped first
  (a `Subsurface` ground control — the feature high-pass added back as a warm internal glow, so flat areas
  never white-out and features glow like light through a thin translucent sheet); **specular top-coat**
  shipped next (a `Specular` strength + a `Light angle` — a movable glossy sheen screen-composited toward the
  light, plus a **feature glint** masked to the lit hotspot so veins catch the light). **Tile-edge light**
  reads the *same* `G.lightAngle` (`edgeFinish` lights the bevel/pillow/tumbled chamfer by edge-normal·light),
  and a draggable **Light tool** aims that one shared light for both. A **Light temperature** control tints the
  whole light warm ↔ cool (sheen, glint and edge highlights together; neutral = the old warm-white). The
  **fluted slab finish** was dropped; the **lens top-coat** (its own section below) is the final coat layer.

**Lighting conditions (spectra) — an index-match engine.** The light sits at a **scalar spectrum value**
(`lightSpectrum`; 0 = daylight, e.g. −1 = UV, +1 = IR). Each artifact's `OVR_uv` entry is `{v, c}` — an
**activation value** and an **emission colour** — and it lights up with `c` only when the light's value is
within `SPX_TOL` of `v` (a scalar compare — no physics, no per-pixel). Sweep the dial and *different* sets of
artifacts light up in sequence; non-matching ones fall to near-black with an additive bloom (safe on black),
so a daylight-`op:0` feature can hide in daylight and reveal under its light. The **Black light** button is
just a preset to −1; the Selected swatch authors `{v: lightSpectrum, c}` (the artifact activates wherever the
dial is when you colour it). This is deliberately **condition-agnostic** — UV, infrared, X-ray, a photo
negative, any theoretical spectrum is the same mechanism (a value + a palette), so it's *one* engine, not a
per-condition feature. **Reactive spotlight** (`spotOn`, `G.lightX/lightY/spotR`): the light becomes a beam;
an artifact also has to fall inside it — per-point for specks (`emit(id,layer,x,y)`), whole-artifact-if-any-
point-touches for lines (`beamPts`) — so dragging the Light tool sweeps a UV torch over the slab. All O(1)-ish,
no GPU; a uniform grid would only be an optimisation for a shaped cone or extreme counts.

**Lens top-coat — refraction as pixel displacement.** The last coat pass models an *ideal glass relief* on the
very top (`G.lens` strength, `G.lensType` = fresnel / reeded / water, `G.lensPitch`). Physically a flat ideal
lens does almost nothing head-on and only bends light as you view off-axis or light it from behind — and that
bending is exactly a **displacement of the image beneath it**. So the pass is a per-pixel *gather*: each output
pixel samples the finished slab at an offset given by the lens profile (radial sine = concentric Fresnel rings,
per-column sine = reeded grooves, crossed sines = hammered "water" glass). A gather is used rather than a
mesh-blit warp because a blit tears wherever neighbouring cells diverge by more than the overlap — which, at any
visible amplitude, is everywhere; a gather never tears. It runs on a downscaled snapshot (`lensC`, ≤640px,
upscaled back — the glass hides the softening), so real refraction stays cheap **without a GPU**. A soft
**caustic** brightens (only — glass concentrates light, it never punches dark bands) where the relief focuses,
so it reads on dark stone and washes out on white, the way a real caustic does. This is the transmission-side
dual of the spectrum engine's emission, and the same fold will run **back-to-front for a future back light**.

This is the real mechanism the temporary toggles (`fogSculpt`, "Warp holds major") stood in for.

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
is the true undo) · the **fog / resin-core** layer (a flat untinted grayscale haze, deep, for sub-surface
depth; movable particles for the magnet to sculpt) · the **layer system, first slice** (multiple user
layers per bucket for major / minor / web, an active layer marks file into, per-layer eye / opacity /
warp, saved and restored) · **layer selection** (select layers; the **force tools**, a **colour** swatch,
and **warp** follow/hold all scope to the selection and bake onto those layers).

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

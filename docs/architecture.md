# Material Author — architecture

What this system is and how its parts fit — the documentation of the code. The origin story is
deliberately *not* here; it lives in the [README](../README.md). Companion docs:
[`functions.md`](functions.md) (the function reference), [`colour-layer.md`](colour-layer.md) (the
colour engine), [`stone-generator.md`](stone-generator.md) (the Python/panel generator, rule by
rule), [`i18n.md`](i18n.md) (translating the studio), [`input-channels.md`](input-channels.md) (one
adapter turning a stroke into named channels) and [`moon.md`](moon.md) (Moon as a moving-body event — both
designed, not yet implemented).

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

- **Vacuum Agent** (`eufy-vacuum-manager`) — the simple reader: greyscale masks at 2048², written
  to `masks/square/` on every full export with a `material.json` beside them. They are the largest
  **centred square** of the slab — 5 × 5 ft of the 8 × 5 ft picture, 62.5% of its width — not the
  whole slab fitted to a square, so the grain keeps its proportions.
  **How many, and which, is the material's answer** (`materialMasks`, at the material fork), not a
  fixed four: stone publishes **five** (base / major / minor / micro / web), **glass seven** (the
  sheet, then one layer per cane) and **wood six** (the board, then one per tier: early / late /
  heart / mineral / knot). What each exported before this was stone's vein geometry drawn from a
  wood or glass slab — a picture of marble handed over as a description of oak, undetectable
  because a mask of the wrong material is a perfectly well-formed mask.
  **Every layer is colour type 0, 8-bit** — hand-encoded, because no canvas will produce greyscale
  and the consumer refuses anything else — and every layer carries a colour and an opacity, both of
  which the consumer requires. Exactly one is declared `primary`, always explicitly: the consumer's
  own flat-field warning sits at contrast 1.5 while the shipped field band starts at 2.8, so it can
  never catch a defaulted field layer. Verified against the shipped validator, not a copy of it:
  `ma-glass` 7 layers, primary `ground` 4.2; `ma-stone` 5, primary `base` 77.0; `ma-wood` 6,
  primary `early` 39.3 — the only one of the three that lands mid-band rather than at an edge.
  **A laid floor publishes one more: the CUT.** Until 2026-11-14 the masks were the un-laid slab,
  and it was not a wood defect but the whole mask export. Measured on one slab through one button
  with a single switch between two runs: `render.png` moved and **all six masks came back
  byte-identical**, so `layTiles`, `plankLen`, `plankVary`, `plankStagger`, `stage` and `set` were
  every one of them dropped at the export boundary. Stone was the same, all five identical. The
  cut is now a layer of its own (`expJoints`) rather than lines scratched into the others, because
  a mask is coverage for ONE colour and a joint drawn into `early` would be painted in
  earlywood's — which is also what would let a consumer give it its own *scale*, if board size is
  ever to be dialled independently of grain size. It is appended at the single `materialMasks`
  fork, **last**, since the cut is drawn over the material, and only when the floor is laid: with
  no cut the mask is all black, a layer that draws nothing and spends one of the consumer's eight.
  That takes the counts to **6 / 7 / 8**, and `MAX_LAYERS` is 8 with the check written `>
  MAX_LAYERS`, so glass lands exactly *on* the cap rather than over it.
  **What it does NOT yet carry is a floor laid from more than one board.** At `stage` 1 the
  render's own floor is a slab with lines on it — "the stone runs continuous across the joint and
  the cut is SHOWN rather than opened" — so publishing the cut matches the render exactly. Above
  one stage, or with sections, each piece is cut from somewhere else in the cant and the mask
  content would have to be laid per piece as well; `expWoodTiers` and `expCoverage` still sample
  one board or one slab. Stated rather than gated: no check here renders a mask.
  **Wood's seam is the `out` buffer, not a produce/combine split.** `shade` was said to have no seam
  to tap because it combines the tiers inline and returns RGB, and splitting it was priced as a
  hot-loop change with the WGSL port mirroring it. There was a third option: the board painter
  already passes `out` per pixel at full resolution, and it was three slots wide. A caller that
  wants the tiers hands in a wider one, `shade` fills slots 3–7 behind `if (out.length > 3)`, and
  both painters allocate `[0, 0, 0]` so the guard is false for every rendered pixel. Measured
  against the previous commit on a wood board at 1024: painted pixels **byte-identical** (FNV
  `3aa91700` from both builds), cost **+2.1%** median against a **43.4%** spread within either
  build — unmeasurable on this bench. No shader change, because the masks are CPU-only.
  **early and late are one number read two ways**, because the ring is a lerp between them: measured
  228.97 + 25.38 = 254.36 against a board coverage of 255, so the pair tiles the board with nothing
  left over. A knot **excludes** the tiers its colour replaced, since the knot block assigns rather
  than blends. All six layers ship on every wood pack even when a control is off and the mask comes
  out black: the layer set mints the token namespace, so a layer that appears and disappears with a
  setting would break any theme that had styled it.
  **ONE list serves BOTH aspects.** The slab-aspect `masks/*.png` used to be five literal builders
  in the export, all of them stone, so a glass slab's `masks/major.png` carried marble veins drawn
  from a glass picture and a wood slab's did too — the same defect the square set had, surviving in
  the one place it had not been fixed, and undetectable because a mask of the wrong material is a
  perfectly well-formed mask. Both sets read `materialMasks()` now, which is what added `web`: the
  slab set always wrote it and the square set never did, so one list had to carry it or the kit
  would have lost a file. The slab set keeps its place in the paced `makers[]` because those are
  full-size canvases at the render width, which is what `EXP_PEAK` paces; `names[]` and `makers[]`
  still align by position, and both are built from the same list in the same order so a material
  that publishes a different number of layers cannot make them disagree.
  **The slab set stays RGBA**, where the square set is hand-encoded to colour type 0: that transcode
  materialises an ImageData plus a one-byte-per-pixel row buffer for the whole canvas, which is fine
  at a fixed 2048 and is not at 16384 — 168 Mpx, so 671 MB plus 168 MB on top of the canvas, against
  a path already measured at 1.28 GiB for two canvases. The consumer that requires type 0 reads the
  square set, which is bounded by the contract.
  **A mask is COVERAGE, not the material's colour**, and that is what stone's field layer turns on:
  `layerAlpha = luminance/255 × opacity`, with the colour carried by the layer's own `color`. A
  near-black marble's matrix still covers the whole floor, so flattening the ground colour to
  luminance — which is what `expBaseMask` does — answers the wrong question and measured mean 8.00
  contrast 0.00 with every pixel below 32. `expStoneField` publishes full coverage with the **veins
  taken out of its core** instead: 229.15 / 76.97 / 10.14% against the consumer's own shipped
  `marble-base-mask` at 232.6 / 71.3 / 8.5%, reached without tuning anything. Major and minor are
  subtracted because a vein is a fracture filled with other mineral and the matrix is genuinely
  absent there; micro is not, because specks and drusy are inclusions *within* it, and taking micro
  out as well measured 141.53 / 124.39 / 42.53% — micro alone covers 40.53% of that square.
  **The subtraction is a step at full coverage, not a depth, and that is the consumer's own
  arithmetic rather than a preference.** The veins are layers *over* this one, so a proportional
  subtraction takes the matrix out twice — and because this layer is what makes the floor opaque,
  the second removal does not darken the stone, it lets the room's flat fill through: `D·m·(1−m)`
  of it, measured at **8.69% of the vein feather and 25.00% at the worst pixel** at full depth, on
  both slabs, against an arithmetic `D/4`. No depth in [0,1] removes it — 0.5 and 0.37 only scale
  the bleed to 12.55% and 9.34% while collapsing the field's contrast from 79.50 to 39.60 and
  29.31, losing on both axes. Confining the hole to where a vein is *solid* makes every term zero
  and costs the floor nothing, because the pixels it changes are the ones the vein layer covers
  opaquely. **Every figure here is one scope**, `viewSquare(SQUARE_MASK)` at 2048: the field's mean
  is scale-stable across 512–4096 and its contrast is not, 75.12 → 80.20.
  `expBaseMask` is unchanged and still has its own callers: the back light reads it as the
  translucent body that glows.
  **The `id` is a namespace and the `name` is display text, and the slab's own name may only reach
  the second.** The consumer mints every theme token from the id by rule — `--evcc-floor-<id>-<suffix>`
  — so the token *format* is not ours to choose; the id and the layer suffixes are the only two
  things this end supplies. An id equal to a reserved floor type makes `assertUniqueTokenKeys` throw
  with the initial `rebuild()` unguarded, so **the card never defines**; an id that is a prefix of
  one has a scoped theme import clear the reserved material's keys, and one prefixed *by* one has
  its own keys cleared. Measured against the consumer's own `id_conflict`: `wood`, `wood-oak`,
  `marble-carrara` and `tile-x` are all refused, while `ma-glass` / `ma-stone` / `ma-wood` come back
  clear — the `ma-` prefix is what keeps them clear, and the clearance is **structural rather than a
  copy of their list**, which grows with every shipped material and whose misses are silent.
  **The id is per slab, derived from its name ONCE and then latched.** It is stored in the slab
  (`packId`), and a stored id wins before anything is derived — so the id reads like the slab
  because it was made from its name, and stops following the name the moment the pack exists.
  Rename the slab afterwards and the manifest's `name` moves while the id does not.
  **A slab with no name gets its render signature as the tail, not the bare stem.** The stem
  alone was ONE id for every unnamed slab — four of this repo's six — and the consumer keys a
  material on that id, while its `build_catalog` skips a later drop-in claiming a taken one with
  nothing but a log line, so the second pack silently never appears. One reached a live box as
  `ma-stone` before this was found, which is how it was found. `renderSig` carries neither `name`
  nor `packId`, so the tail cannot be circular and naming the slab later does not move it —
  measured `0bb5a991` named and cleared. Twelve gallery rows now mint twelve distinct ids, none a
  bare stem, and the digest is order-independent: read forward, reversed, and one slab per page.
  The latch closes
  at the **first export**, which is the consumer's own instruction: permanent from the first time the
  pack leaves the generator. Before that there is no pack in the wild and nothing can dangle; after
  it, changing the id makes every room on that pack fall back to `floor_type` — correct behaviour
  that looks exactly like the pack not being installed, so nothing anywhere reports it.
  The derived form is `ma-<material>-<slug of the name>`, capped at the 32 characters the id regex
  allows and **cut at a word rather than through one** — this repo's glass slab wants 35 and gets
  `ma-glass-disco-glass-v138-just`. A slab with no name latches `ma-<material>`.
  A latched id keeps its material even if the slab's material later changes, which reads like a bug
  and is correct: it is still one slab and one pack, and re-minting would dangle every room on it.
  `family` reports the material truthfully.
  **The author can see and change it, in the File section beside the slab's name.** It was minted
  with nothing on screen to show it for one release — visible only once the pack had been exported,
  which is a poor place to meet the one irreversible commitment in it. The box holds the **tail**:
  the stem is a separate element shown beside it and is not the author's to type, because an input
  they can type the stem into is one they can type a reserved floor-type name into. The typed tail
  is slugged and capped on **commit** rather than per keystroke — slugging as you type eats the
  separator just pressed — and the placeholder is the **derived** tail, set from code rather than
  routed because it is data: it shows what will ship if the box is left alone, and it follows the
  slab's name right up until the first export latches it. **Clearing the box goes back to deriving**,
  which is the only way out of a latch taken by accident, and is safe under exactly the condition the
  latch itself turns on. One routed string, `a11y.pack-id`, in all fifteen packs.
  **It is not on the render signature.** `renderSig` hashes an explicit, measured list; a
  publication id there would re-date every master on disk and orphan every resume, and no fix
  afterwards recovers them because a master keeps the signature it was written with. Measured live:
  `renderSig` reads `ca4c0198` with the id absent, with two different ids, and after a rename, while
  `stateSig` moves — which is what it already does on tool and layer selection, and why nothing
  compares it. `HERO-MASTER-sealkey` still reads daylight `2259e26a` / black light `a98ab1f5`.
  A stored id the consumer would refuse is passed through unchanged: that is a loud failure naming
  the field, where silently rewriting an author's namespace is the quiet one that dangles rooms.
  **`scale` and `opacity` are deliberately not declared.** The consumer's own table is tuned by eye
  (0.05 everywhere but `concrete` 0.16 and carpet 0.09) and a drop-in's fallback chain lands on
  0.05 anyway, so declaring 0.05 is identical to omitting it and any other figure is a guess — note
  that this end *could* derive a physically anchored one, since it alone knows the mask is 5 × 5 ft
  of real slab, but it would be the only such number in an eyeballed table and a per-type token
  slider exists for tuning it. `opacity` is the material's *card* opacity; the nearest thing here is
  `GLASS.opq`, the sheet's physical opacity, which is a different quantity.
- **HA dashboard builder** (`ha-dashboard-builder`) — the rich reader *in intent*: masks plus vein
  ids and *t*-maps, the per-tier colour model, the tile wrap. It keeps only the *renderer*.
  **Measured 2026-11-13, because the claim mattered:** it builds its own fields in
  `panel/material-art.js`, references none of these filenames, and its own `docs/stone-generator.md`
  records that a white-on-black mask "is useless to both consumers" because CSS `mask-image` takes
  alpha. So nothing live reads these PNGs today, and "this repo produces the masks it vendors" was
  aspirational rather than current.
- **The rich set is STONE's**, and that is a property of the material rather than a choice.
  `rich/vein-ids.png`, `rich/vein-t.png`, `rich/paths.json` and `lines.svg` are four views of ONE
  thing: a list of authored strokes carrying identity, a parent, and a parameter along their length.
  Stone has that — its marks become `geo.lines`. Wood's structure is **grown** from a ring model
  around a wandering pith and glass's is **poured** into a mould, so neither has strokes to identify
  or to run along. `materialRich()` at the fork answers with **the set itself** — `{vectors: true}`
  for stone, or `{file, draw, legend}` for a material whose features are labelled rather than drawn.
  That is the third shape in three releases (boolean → a three-word kind → this), and the churn was
  avoidable: the ring map was already written down as the third answer when the kind went in. A word
  for a set still needs a second lookup to find its builder, its filename and its legend; carrying
  them together is one fact in one place, and the two branches become exclusive **by construction**
  rather than by a test — a vector descriptor has no `file`, a label descriptor has no `vectors`.
  **It was not the harmless empty files it was recorded as.** `geo.lines` does not care which
  material is selected: `Hero_Psyker` exported as wood and as stone gives a **different**
  `render.png` — so the material really was wood — and **byte-identical** vein ids, *t*-map, legend
  (70 entries), paths (70 lines) and SVG (73 strokes). **1.77 MB of marble vein geometry in a wood
  kit**, describing veins nowhere in the picture; the same defect the mask set carried, in the last
  place it survived. The glass kit's empty versions were a property of one slab having no vein
  marks, not of the material. Skipping them also skips the work: `expIdT` builds two full-size
  canvases and the kit encodes both, which at 16384 is two 671 MB allocations for nothing. Stone's
  own set is unchanged, 1,850,490 bytes before and after.
  **Glass publishes the label field instead**, as `rich/cane-ids.png` plus `rich/legend.json`: it
  has no strokes, but it has a label at every point — which compartment was poured there — which is
  the same kind of artifact answering the same question. Same rgb index encoding as the vein ids
  (`i & 255`, `i >> 8 & 255`, `i >> 16 & 255`), so one routine decodes both; `0` is bare glass and
  the canes are 1-based, and the legend's keys are the very suffixes `material.json` carries, so
  index 1 is `cane-a` in both files and `cane-a` has a hex in one of them. The two join on a **name**
  rather than on a position. Measured on `disco-glass-fits`: six distinct indices, every one of them
  joining the manifest, and the legend's six entries matching its six cane layers.
  **This is the right place for a paint-by-numbers image and the mask set was not**: there luminance
  *is* alpha, so a grey per label would have been read as six opacities. Nothing reads this as
  coverage — but it still has to be read at its own resolution, because an index cannot be averaged:
  measured, a 1/8 box filter leaves 12.05% of pixels blended and 1.57% nearest a colour that was
  never in their footprint.
  It costs a second walk of the field — the vein maps are canvas strokes, this is `F.UNF` plus
  `glassLay` at every pixel, which is the same walk the slab-aspect cane masks already pay, so a
  glass kit pays it twice. Sharing the cache would mean module state keyed on a view, and a stale one
  there would publish one slab's labels over another's picture.
  **Wood publishes the ring-index map**, `rich/ring-ids.png` plus its legend: which ring — which
  **year** — the wood at each pixel was laid. It is the one thing in a board that is nowhere else;
  the tier masks say early or late or heart, and none of them says *when*. Same rgb index encoding
  again, `0` for outside the log (the live edge, where a plank set wider than its log runs off the
  end of the wood), rings 1-based. Measured on `Hero_Psyker` as wood: 82 distinct indices spanning
  rings 42–123 — the band a plank crosses in a 220-ring log — a 220-entry legend matching
  `WOOD.rings` exactly, and every index in the image present in it.
  **The year was already being walked and not kept.** The LUT fill loop steps `k` to the ring
  containing each radius — `lut`, `tv`, `ts`, `th` and every feature weight are indexed through it —
  and the one thing it did not store was `k` itself. One `Uint16Array(K)` and one assignment.
  **It is not `li`.** `shade` has `li = (rad * KS) | 0`, a *radial sample* index counting steps
  across the LUT, and the two part company exactly as much as the rings differ in width — which is
  the whole point of a growth curve. Publishing `li` would have mislabelled a sample index as a year
  under a correct-looking name.
  **The lookup sits at the caller, and `check-wood-inputs` is why.** That gate requires the GPU
  packer to carry every array `shade` subscripts, and the shader has no use for the ring table: `K`
  runs 16,384 to 131,072, so packing it would be 64 KB to 512 KB of unread arena per render. Its one
  hand-written exemption list is, by its author's own note, where the next miss comes from — so
  `shade` reports the sample and `expRingIds` does the `F.ri[…]` lookup, and the gate stays fully
  derived from `shade`'s own body.

Loose coupling on purpose: no cross-repo build. This repo makes files; consumers copy them.

---

## What's in the repo

### `app/` — the authoring tools (self-contained HTML, no build, no server)

**`stone-author.html`** is the studio (the focus of the recent work). Draw where lines go; the
**family** (Carrara, Calacatta, Nero Marquina, Granite) decides what they are.

- **Tools** — Vein, Branch, **Stylolite**, Web, Pour, Gravity, Magnet, Chip, **Tune** (tap a
  vein to colour just that one), **Cloud** (drag to move the cloud/warp field), **Moon** (drag a local
  warp brush across the slab), **Mask** (tap/drag an island that holds the warp still — or *inverts*, so the
  warp acts only inside it — optionally a reality window showing the disc under a light of its own),
  **Light** (drag to aim the one shared light / spotlight beam),
  Move.
- **Slab primitives** (per family, seeded, greyscale) — **clouds/mottling**, **banding**,
  **breccia clasts**, **drusy sparkle**, and a **fog / resin core** (a flat, untinted greyscale haze of
  sparse soft particles, rendered deep under the veins to read as sub-surface depth — the milky
  imperfection a fabricator saws off; particles are movable so the magnet can sculpt clear windows and
  pools), on top of the ground and the fracture/speck structure.
- **Vein-structure variants** (per line) — natural, **sinuous**, **dendritic**, **en-echelon**,
  **boudinage**, **halo**. Chosen on the vein tool; each line keeps its own.
- **Tiles** — cut the slab into a repeating floor: 13 patterns (square, rectangle, subway,
  hexagon, Cairo, diagonal, herringbone, basketweave, triangle, rhombus, octagon, and plank run
  and chevron for wood), with edge finish and per-tile chipping. A floor is a **cut pattern on a
  slab** — the slab tile rendered whole, then the cut geometry stroked over it — so the pieces fit
  and the joint is a hairline on the seam rather than a gap opened for it.
  Real sizes on an 8×5 ft slab. A tile can also be **kept as a section** — its shape together with
  the place on the slab it was cut from — and a floor laid out of sections drawn from any material;
  see [sections](sections.md).
- **Pen** — pressure (width / flow) and tilt (edge softness), opt-in, measured from your rest
  grip. Baseline input is one pointer + time; stylus extras are enhancement, never required.
- **Layers** — each render layer has eye / solo / opacity, and (structural layers) blend mode +
  glow. Solo keeps the stone ground under the isolated layer.
- **Colour** — the token-theme-kit colour layer (see below). Per-layer colour, decoupled from
  family, plus **per-id** overrides (the Tune tool) that inherit their layer until changed.
- **Save the source** — a slab is a small JSON of marks + family + settings + colour; masks and
  previews **bake** from it at any resolution. Autosaves locally; Save/Load a `stone.json`, and
  **Save/Load one material** — stone, wood and glass held and edited side by side, each savable on its
  own, rather than three slabs overwriting each other in one slot. The per-material split is by
  OWNERSHIP, not by a list of names: a colour token belongs to whichever material claims it and stone
  takes the remainder, because listing stone's tokens explicitly lost all nine per-layer colours the
  first time a material was loaded over it.

The other apps are focused single-file tools: **`stylus-probe.html`** (what a pen actually sends),
**`pollock-pour.html`** (the pour brush alone), **`breathing-constellation.html`** (a colour toy).

### `tools/` — the Python pipeline

`stone_generate.py` (generate as independent layers), `stone_rip.py` (rip masks from a
photograph), `stone_harvest.py` (rip a corpus), and measurement/verification helpers. The
generator's every rule is traced to a measurement or a defect in `stone-generator.md` — read it
before changing the generator.

### `gallery/` — the public showcase

`index.html` is a static showcase page (no build) — **"African St Laurent, Warped"**, one authored
marble idea shown four ways (pristine → subtly wrong → screaming → turned inside out). Four *heroes*
(`img/*.png`, 1600×1000)
from **two slabs** (`slabs/before.json`, `slabs/warped.json`); `reference.json` is the render recipe +
reference hashes. Dedicated to the public domain under CC0. Full detail in [`gallery.md`](gallery.md).

### `harness/` — the determinism harness

`inject.mjs` splices a `window.__sa` render hook into a *throwaway* copy of the app
(`harness/dist/stone-author.hooked.html`; the shipped artifact stays clean); `render.mjs` renders each
gallery hero from its slab under headless Chromium and gates on **self-determinism** — byte-identical
twice from a fresh `deserialize`. `package.json` holds the scripts, `.github/workflows/gallery.yml` runs
it in CI. Full detail in [`gallery.md`](gallery.md).

### `docs/`

[`functions.md`](functions.md) (the function reference), [`capabilities.md`](capabilities.md) (the
verified capability inventory), [`final-render.md`](final-render.md) (the offline render pipeline &
roadmap), [`colour-layer.md`](colour-layer.md) (the colour engine), [`gallery.md`](gallery.md) (the
gallery + determinism harness), [`renderer-determinism.md`](renderer-determinism.md) (what may be farmed
between machines), [`device-seal.md`](device-seal.md) (what a master records about the machine, and what
it seals), [`positional-marks.md`](positional-marks.md) (how every tile carries its own address),
[`image-pyramid.md`](image-pyramid.md) (scoped, not built: why nothing can open a master),
[`image-dna.md`](image-dna.md) (scoped, not built: a fragment that can rebuild the picture),
[`filament-floor.md`](filament-floor.md) (scoped, not built: why a glass render shows what is not
there, and the smallest feature the model is missing),
[`stir-fields.md`](stir-fields.md) (scoped, not built: one drag per stir instead of one for all
of them),
[`self-hosting.md`](self-hosting.md) (serving it yourself, and the sizes that unlocks), [`emitter-bloom.md`](emitter-bloom.md) (drawing the glow instead of blurring for it — a scope,
not a build), [`i18n.md`](i18n.md) (translating the studio), `stone-generator.md` (the
Python/panel generator), and this file. Design notes, **not yet implemented**:
[`input-channels.md`](input-channels.md) (one adapter turning a stroke into named channels) and
[`moon.md`](moon.md) (Moon as a moving-body event) and [`resumable-render.md`](resumable-render.md) (picking
a dead render back up).

---

## How the studio is built

### Materials — one fork, one seam

Stone is path 1; **wood** is path 2. A material supplies a field and a way to query a 2D face out of
it: stone's query is the identity, because the marks *are* the face; wood's is a plane through a 3D
growth-ring field around a wandering pith, so the cut is not a property of the board but of **where on
the plane you stand** — `cos(theta) = p / r`, tangent at `r = p` (plainsawn cathedrals), rift at
`r ≈ 1.41p`, straightening toward quartersawn as `r` grows. One log yields every cut, and a wide board
drifts in character across its own width. Nothing stores a board.

The fork lives at **exactly one function**, `paintContent`, between the authored content and everything
downstream of the face. The coat and light tier, warp, masks, the layer and token spine, tiling, the
tiled render, the master export, the device seal and i18n are all material-agnostic and must never learn
which path they are on — tiling especially, since herringbone, basketweave and chevron are *parquet*
patterns that came from wood in the first place. `tools/check-material-fork.mjs` fails the build if the
`MATERIAL` discriminator is read anywhere outside the marked seam.

Two consequences worth stating rather than discovering:

- **Wood replaces the content, not just the ground.** `paintContent` is the whole content pass, so in
  wood the veins, cracks, specks and drusy do not paint. The marks are still in the slab and come back
  when you switch to Stone; they are simply not what a board is made of.
- **Wood paints nothing in the ident pass or under black light.** It has no items to colour by id and
  no fluorescent minerals. A flat brown in either would be a lie that looks like data.

The material is **serialised** (`material`, alongside `fam`), so it is part of the picture and part of
the device seal. A slab saved before the fork has no `material` key and loads as stone.

Wood's own settings live in **`WOOD`, deliberately not in `G`** — eight sliders for the cut, the ring
profile and the pith's motion. `renderSig` hashes `G` *wholesale*, so a single new key there moves the
signature of every master ever rendered: measured, the default state goes `bc019919` → `da405c25`, and
no fix afterwards recovers a master that was written under the old number. `material` and `wood`
therefore enter the signature **only when the material is wood**, which is the same unchanged-when-off
shape the crossfade light tuple uses. Stone slabs hash exactly as they did before wood existed, proven
in both directions by `tools/ablate-state-sig.mjs`: a wood number must move the hash on a wood slab and
must not move it on a stone one.

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

**Render order is the `layers[]` array order — decoupled from kind.** `paintStoneContent` walks the
layers in array order and dispatches each to its per-kind painter (`paintFogLayer` / `paintWebLayer` /
`paintSpecksLayer` / `paintDrusyLayer` / `paintStylLayer` / `paintVeinLayer`); the default array order
*is* the stack above, so a fresh slab is unchanged. But because position is now the array index, not the
kind, **kinds interleave**: move a web layer up and it composites *over* a major; drop a haze to any
depth and it diffuses everything below it. Each layer composites **atomically** (a vein layer paints its
own halo → shoulder → main as a unit). Two things stay welded to kind and are *not* reorderable: the
three **ground setters** (breccia, clouds, bands) + the base body stay pinned at the bottom (they *set*
the ground, they aren't content — `isGroundLayer`), and the **export bucket** a mark flattens into is
still its kind, so reordering never touches the coverage masks VA reads. Reorder with the row's ▲▼
(`moveLayer`, blocked from sinking a content layer into the pinned ground); the stack order travels with
the slab (serialized in `layers[]` order, restored on load; `clearUserLayers` resets to
`DEFAULT_LAYER_ORDER`). *Proven a byte-for-byte no-op against the pre-refactor renderer on a rich slab
(ground + fog + web + veins + coat), all inputs pinned.*

### User layers within a bucket

A **bucket can hold many layers**. A mark files into the **active layer** of its bucket (a vein → the
active `major` layer, a branch → active `minor`, a web stroke → active `web`); each layer carries its
own **eye / opacity / warp** (and, later, colour / effects / lock). So you can put some majors on one
layer and warp them while another major layer holds dead still — two layers, one bucket, affected
independently. `addLayer(bucket)` creates one (key `bucket#n`, the plain `bucket` key is the default
layer); the Layers panel gives each row eye · name (tap = make active, ▸) · solo · **W** (warp
follow/hold) · opacity · **×** (delete), plus **+ Major / + Minor / + Web layer**.

**Deleting a layer** (`deleteLayer`, the row's `×`) removes a *user* layer and **everything drawn into
it** — the five bucket defaults have no `×` and are permanent. It's the destructive counterpart to
`addLayer`, and the counterpart to add's asymmetry is that a delete has to *unwind every reference* a
layer key accumulates: its colour/adjustment tokens, UV emission, selection, folder membership, hidden
mark-ids and the active/solo pointers, plus (via `gcOrphans`) any per-id override left orphaned when its
vein went with the layer. An empty layer deletes on one tap; a non-empty one arms and takes a second
(there is no bulk undo). **Clearing the whole slab** (`freshSlab`, the **Clear** button) is the same
unwind writ large: it drops marks *and* user layers *and* their tokens for a genuinely blank slab, but
keeps the **studio** — family, tile, warp, coat and lens — so "clear" resets the drawing, not the setup.

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

The **fog / haze is field-per-layer the same way**: every **+ Fog layer** is a fog *plane* with its own
`haze` / `size` / `density` / `seed`, `buildFog` unions them (each blob tagged with its layer), and — now
that render order is the stack order — a plane sits at whatever *depth* you place it. That's the point: a
haze's depth is what it diffuses (a deep dense resin core under everything, a light veil near the top),
which was the whole "insert a haze at a depth" idea made concrete. A fog plane exports through `base` like
the original, and it's *not* pinned ground (`isGroundLayer` excludes `field==='fog'`), so it reorders
freely. The Fog sliders drive the active fog plane (`syncFog`, like `syncGranite`). **Layer-select sculpt:**
select a fog plane (or a granite layer) and the force tools — gravity clears a window / gathers a pool,
magnet combs — act on *that* layer's field only (`sculptTarget` → the layer key on the mark, `sculptParticles`
filters `p.layer === m.tgt`). A legacy mark's bare `'fog'`/`'micro'` still moves the default plane, so old
slabs are unchanged; only a slab with *several* fields of a kind plus a sculpt sees the tighter targeting.

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
visible amplitude, is everywhere; a gather never tears. **It runs at the resolution being written**, evaluating
the profile in the picture's own coordinates, so a tile can take its own piece of the field and the stage sits
with the rest of the coat. Until 2026-11-01 it ran on a downscaled snapshot (`lensC`, ≤640px, upscaled back) on
the argument that the glass hid the softening; at 2048 it did not — mean |dx| **2.509** against **4.668** for the
same render without the lens, which is the slab's own detail replaced by an upscale of itself. A snapshot also
needs a whole picture, and the export path that streams tiles to disk never has one, so that path had no lens in
it at all. The cost of the move was a per-pixel `sqrt`, `sin` and `cos` over the whole tile rather than over
640px: **67 ns/px** against reeded's and water's 16, which a per-stage ablation priced at **181 ms of a 318 ms
coat** at 2048 and 1.6 hours at 1,048,576. Since 2026-11-01 the trig is a **radial table**. The field is a
function of `r` alone, so `lensTable` tabulates `amp·sin(kr)/r` and `1 + amp·k·cos(kr)` against radius and the
loop interpolates between two entries — which takes the two divides with it as well, because the displacement
*is* that first number times `rx` and `ry`. The `sqrt` stays: one hardware instruction, about 2 ns. The loop
measured **56.7 → 29.3 ns/px (1.94×)** at 2048 and the whole render of one slab there **344 → 244 ms**; reeded
and water came out 1.03× and 1.00×, which is the control. Across five picture widths and four tile shapes the
gain runs **1.6× to 2.0×**, stable to 0.03 between two reads but with no monotone story in it — not the table
outgrowing a cache (30 KB at 16,384 against 32 KB at 2048, because the length follows the caller and a tile
tabulates only the radii it reaches), and a 1024² tile of a 2048 picture breaks any account based on picture
size or working set at 1.34×. Read it as **1.7× in the middle, 1.6× for an export**, with the spread
unexplained: the lens at 1,048,576 goes from about 1.6 h to about 1 h. It is not free of consequence — linear interpolation of a
sinusoid is wrong by at most `amp·(k·dr)²/8`, so the step is sized from the error it is allowed to make and
**0.59% of channels move, by a median of one** (mean |d| 0.0161/255, against the 0.96/255 tiling already costs).
`tools/check-lens-table.mjs` measures the real error against the trig, and found the first version of that bound
0.75% optimistic because the quotient's second derivative carries two terms the plain sinusoid bound omits. A soft
**caustic** brightens (only — glass concentrates light, it never punches dark bands) where the relief focuses,
so it reads on dark stone and washes out on white, the way a real caustic does. This is the transmission-side
dual of the spectrum engine's emission, and the same fold runs **back-to-front for the back light** below.

**Back light — the layer-aware fold.** `paintBacklit` (`G.backlight`) models light from *behind* the slab: the
render is no longer flatten-as-you-go but a per-pixel **fold**, deepest layer to top, where each bucket does its
own thing to the light. It reuses the machinery we already had — `expBaseMask` (the translucent matrix, the part
that *glows*) and `expCoverage` per occluding bucket (veins/seams/specks/web, the part that *occludes*) — so the
stack needs no change. `light = backlightColour · intensity · bodyTransmit · Π (tᵦ + (1−tᵦ)(1−coverageᵦ))`: a
covered bucket drops the light toward its transmittance `tᵦ` (veins nearly opaque → dark veils; specks semi; the
pale matrix glows; a dense/dark stone blocks most of it, which is why black Marquina goes nearly dark — correct).
This is the transmission dual of black-light emission: black light turns the external light down so *emitters*
dominate; back light drives light through from behind so *occlusion* shapes it — and the two now **compose**.
On top of occlusion + glow the fold adds **emission** (reuse the `emit` path — self-luminous inclusions glow
*through* the backlight at the current spectrum, which is what a dark stone like Marquina needs to sing) and a
**scatter/bloom** so the glow reads as light rather than a tint. Back light takes precedence over uv, so you can
sit at an authored spectrum value and see the transillumination *and* the fluorescence at once.

**Each layer declares what it does to the light** — the full model. Every layer carries `transmit` (0 opaque →
1 clear) and `scatter`, defaulted per identity and authored on the Selected bar. The fold is now genuinely
*per-layer*, not per-bucket: the base bucket is the glowing body, then each other layer in turn (deepest → top)
optionally scatters the accumulated light (a blur) and then occludes by `layerMask` — its *own* coverage
(`.layer === key`), multiplied toward its *own* `transmit`. So two layers in the same bucket can differ — an
opaque vein layer throwing a hard dark veil next to a translucent one that barely dims — which per-bucket
constants could never express. With `emission` already per-artifact (`OVR_uv`), this is the literal
`{emission, transmittance, scatter}` declaration per layer, folded once in light-travel order. `source-over` is
still the degenerate case; the light direction (front vs back) is just the direction the fold runs.

This is the real mechanism the temporary toggles (`fogSculpt`, "Warp holds major") stood in for.

### Determinism — a knob edits, it doesn't re-roll

One PRNG stream per role per sample (`mulberry32`, seeded via `sub(seed, salt…)`). Because each
element draws from its own stable stream, turning a knob **edits** the result instead of
re-rolling it: more pour appends specks, higher drusy density adds crystals (the first N stay put),
cloud scale morphs the field continuously. Counts use an exact-quantile Poisson so a higher rate
never yields *fewer* — the naïve samplers aren't monotone, and it showed.

**A load is a pure function of the slab, too.** `deserialize` **hard-resets `G`/`T`/`NEXT` to the pristine
defaults captured at boot (`G0`/`T0`/`NEXT0`) before applying the saved values**, and invalidates the
render caches (the cloud/band/breccia signatures and the incremental-build cache). So a key absent from a
save falls to its default rather than inheriting a leftover from whatever was loaded before — loading the
*same* slab always renders the *same* picture, regardless of the session's prior state. Without this, a
partial or older slab loaded into a dirtied session rendered differently.

**How far that determinism reaches.** The [harness](gallery.md) gates the core of it: each hero renders
**byte-identical twice from a fresh `deserialize`** (one Chromium process). Observed more broadly, within a
**fixed Chromium build** the render is byte-identical across a reload and a process restart too — a pure
function of the slab *there*. Across **different** Chromium builds the raw bytes differ — sub-pixel canvas
anti-aliasing isn't specified to the bit and varies between builds; the **picture is identical, the bytes
aren't**, which is below what a shared image is for. So the CI gates on self-determinism (hard) and
deliberately does *not* gate on a cross-build byte match.

### Vector to raster

Authoring is **vector** (a vein is a route → core + shoulder; specks and clouds are fields);
rendering is **raster** (drawn 3× supersampled, downsampled). The same source rasterises to a
430-px card or a 2048² mask without a bitmap ever being scaled. That held for the card long before
anything produced the square: masks came out `W × round(W·H)` and nothing emitted 2048² at all.
A **view** closes it — `viewSlab(W)` and `viewSquare(S)` are the canvas-and-transform pair every mask
builder sets up, so the square is a window on the same rasterisation rather than a second one.

### The colour engine (token-theme-kit)

Vendored into the artifact (bundled ~16 KB; CC0, so no notice is required), used as **editor + resolver** — not
for CSS. Two token groups (*Colour*, *Effects*) feed its self-building editor; its resolver hands
back **values** the canvas paints with (`fillStyle`, `globalCompositeOperation`, canvas shadow).
That value seam is renderer-agnostic on purpose: a WebGPU pass reads the same values into shader
uniforms. Full detail and the canvas colour menu in [`colour-layer.md`](colour-layer.md).

---

## Glass — why the colour cannot mix

The model the glass path is built against, in the order it happens:

> **Mould — pour — partial set — barriers out — stir — form.**

Glass is poured into a set of moulds, left to set part-way, and only then are the barriers lifted
and the stick put through it. Every property the renderer needs falls out of that sequence rather
than being imposed on top of it:

- **Immiscibility is a fact of manufacture, not a rule.** Each colour went into its own
  compartment and was already stiff before anything could diffuse. So the field holds a *label* —
  which colour is here — and sampling a label through a deformation cannot average. Two colours
  go around each other and stay two colours with nothing enforcing it.
- **The stir comes before the forming.** The stick drags what is in the melt, the colours and the
  bubbles. The crown's profile and the roller's flutes are pressed after it came out, so they are
  read at the unstirred position. See `glassStir` / `glassUnstir`.
- **The forming is a map, never a direction.** You cannot form what is not there, so the colour
  field is authored in the mould's own coordinates and each process maps back into them. This is
  why a spun disc shows a pinwheel without a line of code about pinwheels. See `glassGather`.
- **A lap darkens, it does not blend.** Barriers pulled while the glass is only part-set let one
  colour slump over its neighbour. The light then crosses both, so the absorptions add — two
  filters in series. An average would be the one thing the whole model exists to avoid.

The mould layout is a **partition of the plane into labelled cells**: parallel strips with a lay
angle and a twist, radial wedges, or compartments authored one by one with their own width,
length and colour. Free blobs are a further member of the same partition and need no new
machinery downstream.

**A ribbon is rolled dough, and what stops it spreading is running out.** It is an oblong, not a
rectangle — which matters more than it sounds, because equidistant between two rectangles is a
perpendicular bisector, and a field built on rectangles joins its colours along dead-straight
facets however the fronts are shaped.

Each ribbon starts thicker than the sheet wants to be — 2× target, invented, and invented is fine
— and thins as it covers more ground, so it stops when it is down to target and there is nothing
left to press. The reach is therefore **per ribbon**, from a closed form rather than a solver: a
ribbon that runs out leaves void for a neighbour that has not, and two fronts with different
budgets do not meet halfway, which is where the curved joins come from. Every operation resets the
thickness, so there is no running total to carry through the op list.

A roller carries **stamps**, and **C = πD** means the circumference *is* the repeat — not a pitch
anyone chooses. A piece shorter than C never sees a full revolution, so an arc of the roller never
touches it at all; with stamps staggered along the face that arrives as a band across the sheet
with no marks on it. The flutes are a different roller surface: circumferential grooves, whose
pitch runs across the sheet and is genuinely free of C.

## Status & roadmap

**Done:** save-the-source + autosave · first-class layer control · the primitives batch
(clouds, banding, breccia, drusy, stylolites) · vein-structure variants · the colour layer
(per-layer colour + blend + glow via the vendored token-theme-kit) · **per-id colour** (the Tune
tool; built on the kit's new `inherit` feature) · **speck colour groups + variants** (a primary/
secondary hierarchy on the granite ground and on drusy pockets) · **warp** (a cloud-driven domain
warp of the whole structure — the molten flow) · **moveable clouds** (drag the warp field with the
Cloud tool) · the **generation warp model** (a rooted trunk, an inverse-square bond from branch to
sub-branch, warp amount rising with depth — "Deep drift") · **export** (one zip: VA's greyscale mask set —
the material chooses it, seven for glass — with its `material.json`, the dashboard's rich id/*t* maps with legend and vector paths, a completed
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
is the true undo) · the **Mask tool → islands** (tap or drag to place a feathered disc that decides where the
warp is allowed to act — both the global field and every moon multiply their displacement by it. **Protects**
holds a region **normal** while the rest distorts: a cauterised scar, a burn, an *island of normalcy*.
**Window into chaos** inverts the sense, and once one exists the slab holds still everywhere *except* inside
these discs — so the disc is a window onto the only part still churning. One product, so they compose: a
protect island inside a chaos window is a calm eye in the storm, and with no chaos disc placed the arithmetic
is unchanged, which is why old slabs are untouched. Re-editable marks like everything else; the anchor pass is
left unmasked, so it shapes the field warp, not the root bond. A parallel `G.warpMask` list holds
programmatic/legacy discs) · the **reality window** (a mask can *show a different light through* its disc, at
whatever spectrum that island carries — SA re-renders the slab at it and feathers it in, baked into the live
view **and** every export, so *daylight seen through a UV/psyker view* is authored in the tool, not composited
by hand afterward) · the **fog / resin-core** layer (a flat untinted greyscale haze, deep, for sub-surface
depth; movable particles for the magnet to sculpt) · the **layer system, first slice** (multiple user
layers per bucket for major / minor / web, an active layer marks file into, per-layer eye / opacity /
warp, saved and restored) · **layer selection** (select layers; the **force tools**, a **colour** swatch,
and **warp** follow/hold all scope to the selection and bake onto those layers) · a **deterministic load**
(`deserialize` hard-resets to pristine defaults + invalidates the render caches, so a load is a pure
function of the slab) · the **gallery** (a CC0 showcase, three heroes from two slabs) and the
**determinism harness** (a Playwright self-determinism gate in CI — see [`gallery.md`](gallery.md)).

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

`stone-author` is **[CC0 1.0 Universal](../LICENSE)** — public domain. To the extent possible under
law, Chris King has waived all copyright and related rights to the code, the gallery slabs and the
renders; **no attribution is required**. The vendored `token-theme-kit` is CC0 as well (it was MIT
until 2026-09-24 — copies obtained under MIT remain valid under MIT's terms), so there is no notice a
consumer is obliged to keep. Reference photographs used by the rip pipeline are other people's product
photography and never enter the repo — only code, synthetic output, and stone from the author's
own material is committed.

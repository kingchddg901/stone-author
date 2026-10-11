# Wood: the material fork in Stone Author

Companion to [`glass.md`](glass.md).

Written for an agent picking this up cold. Everything below is on `master` unless it says otherwise.
The 83 KB `SESSION_HANDOFF.md` beside this file was **not touched** — it predates this work.

---

## What this is

Stone Author grew a second material. Wood is **path 2**; stone is path 1. If it works, the app becomes
**Material Author** and a material is a plugin: *a field, a 2D-face query, and — newly understood — its
own control surface.*

Wood's model: a **3D growth-ring scalar field about a wandering pith**. A board is a plane handed to
that field; the face is the field's level set on the plane. Nothing stores a board. The cut is decided
by where the plane stands, because the angle between ring and face is

```
cos(theta) = p / r        p = plane's distance from the axis, r = radius from the pith at that point
```

`r = p` is tangent → plainsawn cathedrals · `r ≈ 1.41p` → rift · `r >> p` → quartersawn. One log yields
every cut, and a wide board drifts in character across its own width. That drift is the behaviour, not
a tolerance.

**Independently arrived at, then confirmed:** this is the same representation as Larsson et al.,
SIGGRAPH 2022 ("a three-dimensional scalar field representing the time of added growth"). Convergent,
not copied.

---

## Commits, in order

| sha | what |
|---|---|
| `6f1adbe` | `tools/check-material-fork.mjs` — the gate, armed before there was anything to gate |
| `0832ef0` | the seam: `paintContent` dispatcher, 10 call sites repointed, wood stubbed to stone |
| `db3a55d` | the real `paintWoodContent` — ring field, pith wander, the tiled-render constraints |
| `37ac907` | eight sliders in a `WOOD` object, **not** in `G` (see the signature rule below) |

All four pushed to `master`. CI green on each, including the browser harness.

---

## The architecture

### One seam, and a gate that enforces it

The fork lives at exactly one function, `paintContent`, between the authored content and everything
downstream of the face:

```js
// ---- MATERIAL FORK BEGIN ----
let MATERIAL = 'stone';
function setMaterial(m) { MATERIAL = (m === 'wood') ? 'wood' : 'stone'; }
function currentMaterial() { return MATERIAL; }   // persistence and chrome read through HERE
function paintContent(ident, angleView) {
  if (MATERIAL === 'wood') return paintWoodContent(ident, angleView);
  return paintStoneContent(ident, angleView);
}
// ---- MATERIAL FORK END ----
```

`tools/check-material-fork.mjs` fails the build if the token `MATERIAL` is read anywhere outside those
markers. It matches the **token**, not the words "stone"/"wood" — deliberately, because the app already
has a VIEW called `stone` and slabs record `"view":"stone"`, so a word-grep would be a false-positive
machine. `currentMaterial()` does not match the token, which is why chrome may call it.

Everything downstream of the face is material-agnostic and must stay that way: the coat and light tier,
warp, masks, the layer and token spine, tiling, the tiled render, the master export, the device seal,
i18n. **Tiling especially** — herringbone, basketweave and Versailles are parquet patterns that came
from wood in the first place, so a material test inside the tile engine would be a bug, not a feature.

### Two consequences, stated so nobody rediscovers them as defects

- **Wood replaces the whole content pass.** Veins, cracks, specks and drusy do not paint in wood. The
  marks are still in the slab and come back with Stone.
- **Wood paints nothing in the ident pass or under black light.** No items to colour by id, no
  fluorescent minerals. A flat brown in either would be a lie that looks like data.

### The three constraints inside `paintWoodContent`

1. **Slab coordinates, never pixel index.** The loop inverts the canvas transform per row. A tile
   renders its own rectangle under its own transform, so anything keyed to pixels — the fibre noise
   especially — would step at the tile seams.
2. **Seeded through `sub()`.** A render stays a pure function of the slab; the gallery harness gates
   byte-identical renders from a fresh load and one `Math.random` fails it on run one.
3. **No per-pixel transcendentals.** Ring profile and pith wander are both sampled into lookups once.
   A master tile is tens of megapixels and four `sin()` per pixel is minutes of nothing.

### The putImageData trap

`putImageData` replaces **alpha** as well as colour. The device-space box therefore rounds **inward to
pixel centres** and the out-of-slab branch **clamps** rather than skipping. Either alone would punch a
transparent hairline through the lit ground the caller drew underneath — an erase, not a miss.

### The worker core

`renderCoreSrc()` serialises the render core into a Blob worker. Stone's painters reference no RNG at
all (their geometry is precomputed on the main thread and posted as `geo`), but wood builds its field
at paint time, so the core now also carries `mix, mulberry32, gaussOf, sub, woodField, woodHash` and
emits `var WOOD=...` alongside `var H=...`. The parallel path has no live caller, but a serialised copy
that references a function it does not carry is a trap for whoever revives it.

---

## THE SIGNATURE RULE — read this before adding any setting

`renderSig()` hashes `G` **wholesale**. Measured, not reasoned:

```
default state, one key added to G:    bc019919  ->  da405c25
```

A master keeps the signature it was written with and nothing recovers it afterwards. The published hero
set is fourteen files all reading `a98ab1f5`. **So a new slab setting must never go into `G`** unless
orphaning every master is the intent.

Wood's settings live in their own `WOOD` object (with `WOOD0` for the reset-on-load), serialised as
`wood`, and both `material` and `wood` enter `renderSig` **only when the material is wood** — the same
unchanged-when-off shape the crossfade light tuple uses. Stone slabs hash exactly as before wood existed.

**Verified end to end, app against the standalone mirror:**

| | live app | `node tools/state-sig.mjs` |
|---|---|---|
| stone, daylight | `bc019919` | `bc019919` |
| wood, daylight | `ca59eb3f` | `ca59eb3f` |

`bc019919` is the pre-wood published default-state daylight signature. Unmoved.

### The ablation, and why the pair check exists

`tools/ablate-state-sig.mjs` carries the claim in both directions. Both halves were proven to bite by
breaking the mirror on purpose:

- hash `wood` unconditionally → **2 red** (the stone must-not, and the stone pair)
- drop `wood` from the hash → **1 red** (the wood pair)

The second ablation is the whole reason the isolated pair check exists. Dropping `wood` entirely left
**both** cases that *mention* wood green, because those change the material too and the material alone
moves the hash. Only two slabs differing in one wood number and nothing else can prove the settings are
read at all — the same trap the light section of that file was written for.

---

## The settings

`WOOD`, in `app/stone-author.html`, with a slider each in the **Wood** panel (shown only under Wood):

| key | default | range | what it does |
|---|---|---|---|
| `plane` | 0.27 | 0.02–0.9 | **the whole quarter↔cathedral axis**, since cos θ = plane / r |
| `y0` | 0.2 | −0.4–0.6 | which segment of that plane the board is |
| `rings` | 220 | 40–400 | ring count |
| `late` | 0.52 | 0–1 | latewood darkness — the contrast of the grain |
| `lean` | 0.01 | 0–0.08 | pith along the saw plane → stripe **spacing** breathes |
| `leanFine` | 0.006 | 0–0.04 | faster ripple on the above |
| `wander` | 0.008 | 0–0.06 | pith across the board → the stripes **bend** |
| `wanderFine` | 0.004 | 0–0.03 | faster ripple on the above |
| `drift` | 0.4 | 0–1.5 | how far colour wanders from pith to bark |
| `driftRings` | 90 | 3–200 | how many rings it takes to wander that far |

Not exposed, deliberately (shape of the log, not art direction): `seed`, `trunk`, `len`, `wid`.

### Colour

Two tokens, `woodEarly` (`#c49660`) and `woodLate` (`#603e22`), in the ordinary Colour group, resolved
through `OVR → recolour() → COL` like everything else. They are registered with a **`def`** rather than
seeded into `OVR` by `seedColours`, because `OVR` is hashed by `renderSig`: two keys written there at
boot would re-date every master exactly the way a new `G` key would. An unset token resolves from its
default, so `COL.woodEarly` exists while `OVR` stays byte-identical, and the keys appear only once
someone picks a colour — at which point the signature *should* move.

On top of that, colour varies **per ring as a correlated walk**, two channels (value and warmth). The
walk is an OU process whose reversion is `exp(-1/driftRings)`, normalised by `sqrt(1 - rev²)` to unit
stationary spread so that changing the correlation length does not silently change the amplitude —
otherwise the two controls fight and neither means anything alone. A small uncorrelated term rides on
top, which is what stops it reading as a smooth gradient.

**The walk is indexed by RING, and in a single-stem log the ring index *is* the growth year.** So this
is already colour as a function of growth history rather than of radius. The two only diverge when the
topology does: at a fork, year-120 wood is year-120 wood in both leaders. When that lands, the lookup
is driven by the growth-time field instead of by `r` and none of the colour code changes.

**Measured, so nobody re-derives it:** the default board spans r ≈ 0.34–0.70 of a trunk of radius 1, so
it only crosses about 85 of the 220 rings. Colour drift visible *across one board* is therefore about a
third of the drift across the log. That is correct — a board does not see the whole tree — but it means
a dramatic drift needs a bigger `drift`, a wider `wid`, or a `y0` nearer the pith.

The four wander amplitudes were tuned down from `0.03 / 0.015 / 0.024 / 0.011` — the originals read as
too wavy. `woodField()` memoises on `JSON.stringify(WOOD)` rather than a hand-kept list of the fields
that matter today: a list is a slider that silently does nothing the first time someone forgets it.

---

## The tuning artifact, and the loop that needs no transcription

A private artifact carries the live build (link not recorded here: it is a public repo and the
artifact does not open for anyone else),
with `i18n/_index.json` and `i18n/it.json` published alongside. Capabilities declared: `db`, `user`,
`downloads` (the app has feature-detected runtime support; without the declaration Export silently does
nothing).

The page autosaves the whole slab to `data/users/<id>/autosave`, and that record **includes the `wood`
block**. So tuning done in the artifact can be read straight out with `ArtifactData` `list` on
`data/users/me` and landed in the repo — nobody has to type numbers back.

The older shared artifact `QNnjrqE2Zv4KY7mChVyaaP` is build `2026.09.26.5`, stone only, **deliberately
left alone** because it is shared by link and viewers see updates immediately.

---

## Known debts

- ~~Colour is two hard-coded literals.~~ **Cleared.** Wood's two colours are now tokens
  (`COL.woodEarly` / `COL.woodLate`) resolved at draw time like every other colour, and the colour
  varies with the ring index as a correlated walk — see below.
- No vessel/pore structure and no rays. That is what a second species actually needs — oak's ring-porous
  earlywood bands and its ray fleck are not in the model at all.
- No heartwood/sapwood transition. It is the other big radial colour fact and it is not modelled, and
  it is the one that breaks "colour is a function of growth year" — heartwood colour forms long after
  the ring did.
- Colour has two channels, value and warmth. **No saturation, and no per-species bounds.** Those bounds
  are most of what separates one species' colour from another's — a walnut wants a broad dark-to-light
  range, a maple a narrow pale one with subtle warmth — so this is the next colour move, not another
  amplitude.
- Rings are perfectly round. See "the accumulated surface" below; it gates most of the event list.
- `docs/devices.md` is still pinned to build `2026.09.27.25` with pre-halo figures.
- `tools/check-seam.mjs` is untracked in the working tree — a TIFF master seam tool from an earlier
  investigation, not part of this work.

---

## Open direction — the control surface

The live observation that wood needs **a control surface almost completely different from stone's**,
and it is right:

- **Stone is space.** You draw where the lines go; a mark freezes the settings it was drawn with. The
  forward-only rule — *"settings apply to your next line, never the last one"* — is load-bearing enough
  that `ablate-state-sig.mjs` asserts it (`NEXT` must not move the hash).
- **Wood is time, then space.** You author a growth history — fork at year 80, fire at 115, branch lost
  at 145 — and *then* mill it. An event at year 80 changes everything after it. That is **retroactive by
  nature, the exact opposite of stone's promise.** The two materials do not merely need different
  widgets; they need different promises about what an edit does.

One place wood *can* keep the stone idiom: **the end grain is a control surface for the cut.** The
cross-section is free — the same field queried on a `z = const` plane instead of `x = const` — and on it
a cut is a line you could drag. That turns "Cut 0.27, Board position 0.20" into aiming a saw.
A sketch of this (separate code, not the app) is in the session scratchpad as `wa/endgrain.py`.

### The accumulated surface — the one real architectural gap

**What is built:** rings are concentric circles about a pith curve. `r = hypot(dx, dy)`, then a LUT
from radius to ring. Ring *widths* vary with age and the pith wanders with height, but every ring is
perfectly round at every height.

**What is not:** rings that inherit the previous ring's shape.

```
R(n+1, theta, z) = R(n, theta, z) + G(n, theta, z)
```

Each layer starts where the last one ended — layers of foam on a form. A bulge laid down in year 30
still bends the grain in year 150, and it fades only if something smooths it. That single change is
the prerequisite for **every** event on the interference list that is not a pure scaling:

- eccentric growth, reaction wood, a persistent lean
- a fire scar: a theta-window where growth stops for some years and the survivors grow around it
- **a wound being buried.** A carving is two separate operations — a geometric *subtraction* at year
  50, and the *growth response* afterwards. The generator never needs to know what a letter is; it
  needs to accept an arbitrary wound shape. But you cannot bury anything in a field of perfect
  circles, so this is gated on the accumulation.

**It is affordable, and here is how.** The naive version stores 220 surfaces and inverts them per
pixel. Instead, keep the concentric solution as `R0(n)` — the existing LUT — and write the deviation
as a field:

```
R(n, theta, z) = R0(n) + S(theta, z, n)
```

`S` is a small sum of sines in theta, z and n, which varies *slowly in n*. So given a query point, take
the concentric ring index as the first guess and run **one Newton step** to correct it. Sample `S` into
a 2D lookup over (theta, z) — 256x256 interpolated is plenty — and the per-pixel cost is two LUT reads
and a divide, not four `sin()` calls. The no-transcendentals rule survives intact.

Two constraints to carry: growth must stay non-negative, and surfaces must not self-intersect, or the
foam folds back through wood that already exists.

### A fork

A **fork** is not a parameter. It is a topology change: the field goes from one pith curve to two, and
the cross-section's connected components go 1 → 2 over the transition years. Concretely that means
`r = hypot(dx, dy)` about a single axis becomes a smooth-min over per-axis fields with blending near the
junction — a real but bounded change to `woodField`/`paintWoodContent`, not a rewrite. The published
work (Larsson 2022) already takes a **branching skeleton** as its input, which is the shape to copy.

### On fitting the field to photographs

Both halves of the inverse problem are published and tractable:

- Sawmill side: pith location from optical scans of all four faces, mean error 2.6 / 3.2 mm over 104
  boards ([Springer 2020](https://link.springer.com/article/10.1007/s00107-020-01558-1)); a
  [2021 follow-up](https://link.springer.com/10.1007/s00226-021-01266-w) does it from raw RGB.
- Graphics side: [Nindel et al. 2023](https://arxiv.org/pdf/2302.01820) fits a procedural solid-wood
  model to **a single photograph** (curved Gabor filters, phase-based loss, no training set);
  [Larsson et al. CGF 2024](https://diglib.eg.org/handle/10.1111/cgf15074) infers the internal 3D ring
  field from annotated photos of a block's outside faces.

Two caveats that matter more than the methods:

1. **The degeneracy is geometric.** A quartersawn face has `r → ∞`, the arches flatten, and the
   curvature that would give absolute radius is simply not in the image. Rift and plainsawn carry the
   information. That is why the published methods want four faces.
2. **Drying distortion is the same order as the signal.** A wide slab moves millimetres across its
   width as it dries; the published pith-location accuracy is 2.6–3.2 mm. On a dried, surfaced slab the
   distortion is a substantial fraction of what you are trying to measure.

**Provenance:** other people's photographs — a dealer's inventory shots included — are theirs. Look at
them, fit against them, verify against them. They never enter the repo.

---

## Reconciling the "Multi-Species Procedural Tree Generator" concept handoff

A separate concept document exists, written outside this repo, proposing a multi-species
history-driven tree generator. It is a good statement of **direction** and a poor statement of
**state**. Three of its claims are wrong about this project and would send a fresh reader to rebuild
what is already on `master`:

| it says | actually |
|---|---|
| "No implementation language, rendering framework, or target engine has been selected" | **Selected and ruled on.** A fork inside Stone Author's single self-contained HTML file, canvas 2D. Path 1 stone, path 2 wood, path X others. No build step, no dynamic loading. |
| "No implementation has been established" | Four commits on `master`. The field, the mill, the gate, the panel. |
| "A practical first prototype would be a single-species trunk with variable annual ring spacing and an arbitrary cutting plane" | **That is what shipped.** It is `paintWoodContent` plus the eight sliders. |

Its YAML event schemas are illustrative and should not be imported as-is: a growth-event list would be
a new serialised key, and the signature rule above governs where such a key may live (not `G`; riding
the material condition).

Its dataset proposal — "preserve original images and their provenance" — is the one thing to refuse.
Other people's photographs do not enter this repo, whatever the folder structure.

**Four things in it are genuinely new and worth keeping:**

1. **Specialty sellers photograph exceptional lumber.** Their inventory is not a representative sample
   of how a species grows. A profile fitted naively to dealer photographs would make every generated
   tree a show piece. This silently poisons any fitting loop and is easy to miss.
2. **Therefore figure must be an explicit option, not the default.** Ordinary species character,
   individual and environmental variation, and exceptional figure are three separate dials.
3. **Changing one event must not re-roll unrelated wood.** This one is already solved here and the
   mechanism is in the app: one PRNG stream per role per sample, `sub(seed, salt…)`, which is why
   turning a knob *edits* rather than re-rolls. Give each growth event its own salt and the property
   falls out. See "Determinism — a knob edits, it doesn't re-roll" in `docs/architecture.md`.
4. **Not every species has distinct annual rings.** Many tropical species do not. An engine that
   assumes rings will produce convincing variations of pine wearing other colours.

Scope note: expanding from "wood is a material in Stone Author" to "a multi-species growth engine"
does **not** change the plugin shape. A species is a parameter set over the same growth-time field; the
eight sliders are the first species profile's parameter surface, they just are not called that yet.
What a second species genuinely needs is the missing anatomical layer — ring-porous earlywood vessel
bands, rays and their fleck — not a different architecture.

---

## Commands

```bash
# every gate CI runs, plus the three that take arguments
for g in check-i18n check-build check-render-purity check-wake-lock check-device-seal check-crossfade \
         check-panel-tokens ablate-state-sig check-bleed check-png-meta check-fn-refs \
         check-material-fork check-probe-budget; do node tools/$g.mjs; done

node tools/check-fn-refs.mjs --fix          # repin docs/functions.md after any line shift
node tools/state-sig.mjs test-slabs/default-state.json     # expect bc019919 / 37d2ca86
python tools/serve-studio.py                # http://127.0.0.1:8777/app/stone-author.html
```

The browser harness (`npm run verify`) cannot run locally — Playwright will not spawn in this
environment. CI is its first run; do not gate anything on having verified it here.

---

## LOCKED 2026-10-10 — where it landed

Wood is **closed for now**. More species may come; nothing else is planned. Everything below is on
`master`, each piece committed with its measurement in the message.

### The invariants, and what each one cost to learn

- **CAUSALITY.** Growth at year X reaches outward only. The ring scale is FIXED and the radius is
  DERIVED; never normalise to a target radius. Measured: a board that never meets the live edge is
  **bit-identical** across a 180-ring and a 4000-ring tree. Two separate regressions were caught by
  this test, both mine — the eye grid anchored to the emergent bark radius, and the LUT domain
  tracking R.
- **UNCHANGED WHEN OFF.** Every feature added after the first release defaults to a value that
  reproduces the previous render exactly. Verified at 0 pixels each time.
- **THE SEAM.** One fork, `paintContent`, gated by `tools/check-material-fork.mjs`. The gate now
  skips whole-line comments — it was flagging prose about itself. Ablated both ways when loosened.
- **TAPER IS GROWTH, NOT GEOMETRY.** A ring laid when the apex was at 30 ft does not exist at 150.
  Higher wood has FEWER rings, not thinner ones, so the correction is an ADD, not a scale.
- **A SPECIES IS A ROW OF NUMBERS.** Nothing is a mode. This is why the graft needs no compatibility
  check: there is nothing to violate.

### Calibration against a real tree

The General Sherman is the only external ground truth in here. NPS records 36.5 ft at the ground and
17.5 ft at sixty feet up. Solving the scale at the ground ONLY and reading 60 ft as a prediction:
**17.79 ft at taper 0.7, flare 0.4** — 0.3 ft out, 1.7%, on a figure nothing was fitted to.

That calibration is what proved basal flare was a missing MECHANISM rather than a tuning problem:
the which-rings-reached-here model alone saturates at 22.7 ft and no setting closes the gap.

### What a later session should know before adding species

- `SPECIES` rows must set EVERY field they can, including the fibre and eye values. A preset that
  half-seeds leaves the previous species' figure behind, which is worse than no preset.
- The numbers are **eyeballed from wood anatomy, not measured**. The place measured data goes is
  that table, and the source is ITRDB — raw ring-width series, numbers rather than photographs.
  Carry its bias: ITRDB samples climate-SENSITIVE trees, so its rings run narrow and variable
  against a sawlog's.
- Adding a key to `WOOD` is safe; adding one to `G` or `T` is not — both are hashed wholesale by
  `renderSig` and one new key re-dates every master on disk. `WOOD` is signed only under wood.

### Open, deliberately

- More species. Nothing blocks it.
- The ungrafted knot still uses a free pitch control rather than a growth curve; it has no tree
  behind it, so that is correct rather than pending.
- Spacing of bird's eye is angular, so eyes crowd towards the pith instead of new ones appearing as
  the cambium stretches. Quoted at one foot of radius so the error sits where it is smallest.
- Recursive grafts need a branch TREE; there is one branch (`dev2`).

### The repeated failure, recorded because it cost the most

Roughly a third of the measurements I wrote were wrong before the code was. The shapes:

1. **A constant across settings that should differ** — 147022 four times, 1324 twice, 353.2 for
   three different views. Always a dead probe, never a finding.
2. **Stale reads.** Two warm-up renders are not always enough after a batch of slider writes; three
   are. A custom element renders asynchronously, so reading its shadow root synchronously returns
   empty and looks exactly like a bug.
3. **The pixel floor.** A 3x5 blob IS aspect 1.67. Quantisation is not a measurement.
4. **Testing the path I had just written.** The colour-editor filter was verified by CLICKING the
   material button — the one path that was never broken. The restore path, which is how the app
   actually opens, was untouched and still wrong.

The reliable oracle throughout was a rendered image, and the reliable discriminator was an arm that
MUST read zero beside an arm that must not.

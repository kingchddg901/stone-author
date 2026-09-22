# The colour layer

How Stone Author colours a slab. Written after step 4 (artifact **v22**).

## The split: character vs colour

A **family** (`FAM` in `app/stone-author.html`) is now **character only** — how veins
rough, swell, break, branch; grain vs specks; how many web cells. It no longer owns colour.

**Colour is its own layer.** The generator produces a greyscale *structure*; colour is applied
on top, per render layer, and can be anything — independent of the family. Switching family
changes character, **not** colour. A **"Palette from family"** button re-adopts a family's
palette on demand (one click); otherwise your colours stay put.

## Where the values live

Two objects, split so a *reset* truly clears an override:

- **`OVR`** — the overrides the editor edits and we persist. Seeded from a family's palette
  (`seedColours`), decoupled thereafter.
- **`COL`** — the *resolved* values the renderer paints from (`COL.ground`, `COL.major`, …),
  computed by `recolour()` running `OVR` through the kit's resolver: an unset token falls back to
  its default or its inherited layer. The renderer reads `COL`, never the hardcoded `FAM` palette.

`serialize` stores `OVR` (plus `perItem`, below); older saves that stored resolved values as `COL`
migrate into `OVR` on load. A "Palette from family" button re-seeds `OVR` on demand.

## The engine: token-theme-kit (vendored)

The [token-theme-kit](https://github.com/kingchddg901/token-theme-kit) is **vendored into the
artifact** — bundled with esbuild to an IIFE global `TTK` (~16 KB, MIT notice kept, `@881024b`),
inlined as `<script id="ttk-vendor">`. Re-vendor by re-bundling `src/index.js` + `src/element.js`
and replacing that block.

It is used as **editor + resolver**, not for CSS:

- **Registry / editor.** Two token groups — *Colour (per layer)* and *Effects (per layer)* — feed
  the kit's self-building `<theme-kit-editor>`. Add a token, a control appears; the kit renders
  `color`, `select`, and `number` widgets with zero editor code here.
- **Resolver, not CSS vars.** The kit's normal output is CSS custom properties. A canvas has no CSS
  to theme, so we take the resolved **values** and paint with them. This is the crux of the
  extraction test — *the kit dropped into a canvas host it was built to never assume, unchanged* —
  and it is exactly what a future **WebGPU** pass wants: feed the same values into shader uniforms.
- **Persistence.** A tiny adapter binds the kit to `COL` (`load` returns it; `save` merges + redraws
  + autosaves). Stone Author keeps owning save/load; the kit never persists on its own here.

## Controls today

Per render layer:

| Control | Canvas mechanism | Where |
|---|---|---|
| colour | `fillStyle` / `strokeStyle` (any CSS colour, incl. oklch/wide-gamut) | Colour group |
| opacity | `globalAlpha` | Layers panel |
| blend mode | `globalCompositeOperation` (multiply … luminosity) | Effects group |
| glow | canvas shadow, tinted by the layer's own colour | Effects group |

Effects are wired for the structural layers (`major, minor, web, micro, styl, drusy`) via
`fxOn`/`fxOff` around each paint, and skipped in the identity/angle views.

## The canvas colour menu (for later)

Canvas gives essentially the CSS palette as per-layer state, plus pixel-level control. Not yet
exposed, cheap to add: **gradients** (linear/radial/conic fills), **filters**
(`ctx.filter`: blur / brightness / contrast / saturate / hue-rotate), and blend/glow on the
base-bucket layers. Each maps to a kit control type. The one thing canvas loses from CSS is the
cascade — replaced by the token **resolver**.

## Per-id colour (done)

Colour resolves **bucket → layer → per-id override**, and per-id is live for veins:

- The **Tune** tool taps a vein; `tuneId(id, bucket)` registers a per-item colour token that
  **inherits** its layer, in a "Per-item" editor group generated from the artwork on demand (not a
  static list of hundreds).
- Resolution falls back **id → layer** via a new *generic* token-theme-kit feature: a token can
  declare `inherit: '<otherKey>'`, and `resolveValues` returns the override, else the inherited
  token's resolved value, else its own default (chains resolve; cycles terminate). Added and tested
  in the kit repo (`@65b401a`) — domain-free, so any consumer gets it.
- An unset per-item control shows the layer colour; **reset** clears the override and it follows the
  layer again — which is why the `OVR`/`COL` split above was needed.

Reachable next: extend Tune to clasts / seams / specks (hit-testing per surface). The kit's
large-registry test already locks scale, so the count is not the wall. Chris expects the kit to
**expand again for a WebGPU render pipeline** — the value-resolution seam is renderer-agnostic on
purpose, so that is additive.

## Status

Steps 1–4 done: save/load source · layer control · primitives + vein variants · colour layer
(colour + blend + glow). Artifact **v22**. The base compositing stack is
`base → breccia → clouds → bands → web → micro → drusy → styl → minor → major`.

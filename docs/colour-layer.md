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

`COL` is the live value bag (colours + effects). It is:

- **seeded** from a family's palette (`seedColours`) but decoupled thereafter,
- **read by the renderer** at paint time (`COL.ground`, `COL.major`, …) instead of the old
  hardcoded `FAM` palette,
- **saved in the stone source** (`serialize`) so colour travels with the slab; older saves fall
  back to the family palette.

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

## Next chapter: per-id

Colour resolves **bucket → layer → per-id override**. Per-layer is done; **per-id** is the next
slice and lands in the token-theme-kit repo (Chris's call — improving his own kit is the
extendability proof):

- a registry **generated from the current artwork** (the ids present), not a static list,
- a canvas **"tap a surface to tune it"** path, not a flat list of hundreds of controls,
- the resolver falling back id → layer → bucket, with per-id entries as overrides that reset to
  inherit the layer.

The kit's large-registry test already locks scale, so the count is not the wall. Chris also
expects the kit to **expand again for a WebGPU render pipeline** — the value-resolution seam above
is renderer-agnostic on purpose, so that expansion is additive.

## Status

Steps 1–4 done: save/load source · layer control · primitives + vein variants · colour layer
(colour + blend + glow). Artifact **v22**. The base compositing stack is
`base → breccia → clouds → bands → web → micro → drusy → styl → minor → major`.

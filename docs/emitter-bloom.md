# Emitter-space bloom — a scope, not a build

The bloom is currently **image-space**: render the tile, blur the whole thing twice, add it back. That one
decision is upstream of most of what went wrong in September 2026 — the bleed, the tile-edge truncation,
the canvas-size ceiling that silently dropped the blur on two tablets, and WebKit having no bloom at all.

The alternative is **emitter-space**: we know exactly where the light is, because it is geometry. 70 veins,
232 cracks, 8,050 specks, each with a position, a shape and an emission colour from `OVR_uv`. Draw the glow
instead of deriving it from pixels.

This page scopes that. It is not built, and one measurement below may prevent half of it being buildable.

## What it would buy

| today | emitter-space |
| --- | --- |
| bleed of 1,577 px at 65535, 84.5% of a 2048 tile's pixels thrown away | **no bleed** (measured, see below) |
| every tile join is a place the blur was truncated | no joins — each emitter contributes identically to every tile it reaches |
| the blur silently stops above a canvas size on some devices | nothing is filtered, so nothing can be declined |
| WebKit has no `ctx.filter`, so Safari gets no bloom | `shadowBlur` is not `ctx.filter`; it works everywhere |
| Gecko and WebKit differ *inside the blur* — the known locus of engine disagreement | a different mechanism, which may or may not agree better |

## The measurement it rests on

**A shape drawn entirely outside the canvas still casts its shadow into it.** Measured in Chrome, a
100×200 rect whose right edge sits 40 px left of a 400×400 canvas, `shadowBlur` 400:

```
alpha at x=2: 34    x=20: 30    x=80: 19    x=200: 4
control, same shape 2px inside:  33 at x=150, 14 at x=250, 3 at x=350
```

So a tile can be drawn with **zero bleed** and still receive the glow of emitters beyond its edge, because
the whole picture is submitted to every tile and the canvas clips the result rather than the input. That is
the entire memory and overdraw argument, and it is the reason to consider this at all.

**Verify this on Gecko and WebKit before building.** One engine culling shadows by the shape's own bounds
would put the bleed straight back.

## The risk that may kill the wide pass

Canvas composites at 8 bits per draw. A single speck given a very wide glow spreads its ink over a huge
area and lands **below one level**, where it rounds to nothing:

```
8x8 source, shadowBlur 1048:  no measurable alpha at any distance
```

Today's bloom blurs the **composite**: 8,050 specks are summed at full precision and quantised once, so
their collective faint haze survives. Per-element glow quantises 8,050 times, and 8,050 zeroes are zero.

That faint distributed haze is not a detail — it is a large part of what the black-light field *is*. So:

- the **narrow** pass (`3 × bs`) is probably safe: less spread, more alpha per element
- the **wide** pass (`8 × bs`) is the one at risk, and it is the one that carries the field

### The obvious hybrid buys nothing — corrected 2026-09-27

An earlier draft of this page proposed drawn glow for the narrow pass and image-space for the wide one, and
claimed that cut the bleed to roughly a third. **It cuts it by zero.** `coatReach` is a `Math.max` over its
contributors, not a sum, and under the black light the **wide** pass is already the one setting it:
`blurReach(8 bs)` is 1,573 px against `blurReach(3 bs)`'s 590. Measured at 65535:

| what moves to drawn glow | bleed | a 2048 tile keeps | a 4096 tile keeps |
| --- | --- | --- | --- |
| today, all image-space | 1,577 px | 15.5% | 31.9% |
| narrow pass only (`3 × bs`) | **1,577 px — no change at all** | 15.5% | 31.9% |
| wide pass only (`8 × bs`) | **594 px (0.38×)** | 40.1% | 60.1% |
| both | the output-space floor — the per-artifact adjustment blurs and artifact glows, which do not grow with the render | — | — |

So the pass that carries the field haze, and the one at risk of quantising to nothing, is also **the only
pass that buys any bleed**. The safe half of the hybrid is the worthless half. That inverts the staging
below: the wide pass is not an optional last step, it is the whole decision.

It also bounds what a bleed fix can do for the tile choice. The planner's floor is `ts > bleed`, so at
65535 today the smallest legal tile is 2048; at 594 it would be 1024, and at 594 a 2048 pass draws 2.6×
fewer pixels than it does now. That is the number the memory-versus-speed balance turns on — with the
bleed at 594 a protective tile costs about 1.5× the fast one instead of 3.4×.

## The other look difference

Per-element glow is **additive per element**; blurring the composite adds first and blurs once. Where
emitters overlap — the dense speck fields, a vein crossing a chip — the two give different answers, and
drawn glow will be brighter there. That is an art change and it is Chris's call, not a correctness matter.

## Mechanism

The per-element machinery already exists. `fxOn(key, colour, ident)` sets `g2d.shadowColor` and
`g2d.shadowBlur` from the palette for each artifact; a glow pass would set a much larger radius and
composite with `lighter`. `shadowBlur` is in **output pixels**, unaffected by the transform, which happens
to be exactly what is wanted: σ is an output-space quantity here (524 px at 65535).

The cost is that every painter — veins, web, specks, drusy, stylolites — must know its own emission colour
a second time. That is a real refactor of the one path that has not been touched, and it is why this is a
scope rather than a commit.

## Staging, each step useful alone

1. **Measure the quantisation floor on the WIDE pass.** At 65535, what fraction of the current wide-pass
   light comes from elements whose individual glow lands under one level? Nothing below matters until this
   is answered, because the narrow pass on its own changes the bleed by nothing.
2. **Verify off-canvas shadows in Gecko and WebKit.** If either culls, stop and rethink.
3. **Wide pass behind a flag.** `?bloom=draw`, compared against the current build on one device — and
   judged on the field by eye, not on the mean. A haze that quantised away reads as a mean that barely
   moved, which is the shape of every defect this renderer has had.
4. **If it holds, drop the bleed to the narrow pass's reach** — 594 px at 65535, and a 2048 tile goes from
   keeping 15.5% of its pixels to keeping 40.1%.
5. Narrow pass too, only if it reads right, which takes the bleed to the output-space floor.

## What would kill it

- an engine that culls off-canvas shadows
- the quantisation floor eating the field haze, with no hybrid that reads right
- `shadowBlur` at σ ≈ 524 being clamped or catastrophically slow on a tablet — **untested, and it is the
  device that matters most**
- the additive overlap reading wrong to the eye, which no measurement will settle

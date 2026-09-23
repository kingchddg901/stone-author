# Final Render — architecture & roadmap

Stone Author has two renderers by intent:

- **Interactive / reference renderer** — the live `draw()` on the main-thread canvas. Fast, screen-resolution, drives authoring. This is the *reference*: it defines what the slab looks like.
- **Final Render** — an **offline, single-frame** job. It does not have to be realtime; it has to produce one correct, very pretty frame at whatever resolution and format the output needs. Seconds are acceptable.

The single-frame constraint is the whole leverage. There is no 16.7 ms budget, no need to keep state GPU-resident, no reason to fear a synchronization point — a sync is just another stage in the job. That permits a **heterogeneous render graph where CPU and GPU are peers**, each stage running wherever it is cheapest and clearest. (This model was worked out with the ChatGPT design sounding-board — see [`PROVENANCE.md`](../PROVENANCE.md); the calls and the code are here.)

## Invariant: the document is the truth

Every backend consumes the same semantic document (stable artifact ids, families per mark, layers, colour tokens, observation/spectrum state, procedural recipes). No renderer is ever the source of truth. A higher-quality backend may **reveal more** (sharper refraction, real caustics, subsurface, metallic sheen) but must **not become compositionally different** — the invariant is *compositional* identity, not pixel identity. The seam is already renderer-agnostic: values, not CSS vars; `geo` is plain data; the coverage/field renders are resolution-parametric.

## Known gap — FIXED

`expCompleted(W)` used to stop at `paintStoneContent`, so `render.png` (and the `.ora` merged image) were missing everything from v49 on — no coat tier, back light, or lens. **Fixed:** `expCompleted` now delegates to `renderFull(W)` (below), which runs the complete pipeline. Exports carry the coat; the coverage masks stay geometry-only by design.

## Build order

1. **`renderFull` — the offline render primitive. ✓ DONE.** The complete pipeline (base → content → coat, incl. back light + lens) to a fresh W-wide canvas, whole slab, no pan/zoom. The coat passes were factored into a shared `applyCoat(targetCanvas, targetCtx, blurScale, flags)` used by *both* live `draw()` and `renderFull`, so there is one implementation and no drift; blur/scatter radii scale with the output resolution (`bs = W/Wc`). `expCompleted` now returns `renderFull(W)`, so **exports finally bake the coat / back light / lens** (the masks stay geometry-only). Verified pixel-for-pixel against live `draw()`. This is also what one tile renders — the foundation for everything below.
2. **Tiling + bleed. ✓ DONE.** `renderTiled(W, tilePx=1024, bleedPx)` splits the output into tiles; each renders its slab sub-region **expanded by a bleed margin** (`ceil(12·bs)`) so cross-tile blur/subsurface/specular are seamless, then the bleed is cropped and the tile blitted into the assembly canvas. Two coordinate subtleties handled: the specular hotspot is placed in **full-image space** (`applyCoat` takes a `vp` viewport), and the **lens runs once on the assembled image** (it downscales to ≤640, so it's global + cheap — and its displacement can exceed a tile's bleed). Back light isn't tiled yet (its fold is a whole-slab 512 pass) → falls back to `renderFull`. `expCompleted` now uses it, so exports stay memory-bounded. **Verified against `renderFull`: mean pixel diff 0.99/255, no visible seams.** Intermediate **resolution belongs to the operation**, not the export — the lens proves it (≤640 gather regardless of final size). *Next within this rung:* tile the back-light fold at full res; stream tiles to an encoder for exports beyond the ~16k canvas cap.
3. **CPU-worker pool.** Parallelize the tile loop across `OffscreenCanvas` + Web Workers. Workers receive **immutable render jobs** (region, geometry, materials, observation, seeds, quality) and own no document truth. *Constraint to resolve:* the shipped tool is a single self-contained HTML artifact, so worker code must be inlined (Blob URL) and needs a **DOM-free render core** — the render stack must be extractable from the IIFE. Slice: build the render core as a pure module first (main-thread), then hand it to workers.
4. **Pluggable encoders (output layer).** The render produces **pixel buffers** (and, for layered output, per-layer buffers); encoding is a separate, pluggable stage:
   - **Flat raster:** PNG (have), JPEG, WebP; float/EXR-style later for HDR.
   - **Layered:** ORA / OpenRaster (have — 5 bucket layers), **PSD**, and **PSB** (Photoshop large-document; handles >30k-px canvases where PSD caps out, so it pairs with the tiled huge-export path). Both PSD/PSB from their open specifications.
   - Layered output maps SA's buckets/layers to file layers, so a slab opens editable in Photoshop/GIMP/Krita.
5. **GPU compute (optional acceleration).** Use the GPU where there is *massive repetition of similar math* — dense field evaluation, high-res refraction, large convolution/scatter, spectral response. Complicated math does not require a GPU; 500 million simple calculations do. Two patterns:
   - **Reduce-before-readback:** GPU evaluates millions of samples, returns a **compact field** (e.g. a 257×257 displacement / angle / transmission field, a spectral LUT, a caustic-intensity field); CPU interpolates it while rasterizing tiles. Worth it only when the returned representation is much smaller than the computation. Fits SA's *smooth* stages (lens displacement, subsurface, caustic).
   - **Let the GPU finish the pixels** when a stage is already pixel-shaped and huge — no reason to drag it back through the CPU.
   The per-layer occlusion fold is coverage-shaped (hard edges), not a smooth field, so it stays CPU or goes full-GPU-pixels.

**Rule:** do not move work to the GPU because it *sounds* like graphics work — measure first, reduce the unnecessary work before choosing the processor. The Fresnel lens is the worked example: it sounded like an obvious GPU feature; once the real requirement was understood, the work was cheap enough to stay CPU-side.

## Capability inventory — what an authored (hero) slab can use

The full-spec / hero author draws on all of this; each is a controllable, factored dimension.

- **Families** (carrara, calacatta, marquina, granite) — character only. **Family is per-mark** (`FAM[m.fam]`, "the character it was drawn with"): a slab can carry veins of different stones at once, and an authored **branch (minor) carries its own family** while attaching to a parent major of any family. Cross-breeding is in the data model, not a feature request.
- **Layers & buckets** — 5 export buckets (base/web/micro/minor/major), many authoring layers per bucket, sedimentary order = render order. Per-layer eye / opacity / warp, editable label + derived tag, per-layer hide (7th dimension) with a Hidden list, spectrum-workspace folders.
- **Colour** — decoupled from structure (`OVR` → `recolour` → `COL`). Per-layer *and* per-artifact tokens (click-to-select), inherit artifact→layer→bucket. A full **adjustment set** per target: blur · hue · saturation · brightness · contrast · weight.
- **Primitives** — veins (6 variants: natural/sinuous/dendritic/echelon/boudinage/halo), branches, web spreads, stylolite seams, drusy pockets, granite speck fields (field-per-layer), breccia, clouds, bands, fog.
- **Warp / choreography** — global cloud warp, per-layer warp weight, and the **moon** (a stored path + settings). The moon is the choreography surface: reverse its stored path (`samples.reverse()`) to negate the field, replay with a *different reach* for coherent **anti-symmetry**, ramp settings across a stacked pass. Tedious for a human, exact for an AI.
- **Coat tier** — subsurface (internal warm glow), specular top-coat + feature glint, one movable light (angle + temperature), tile-edge relight.
- **Observation / lighting** — the condition-agnostic **spectrum engine** (`lightSpectrum`, `OVR_uv` = list of `{v,c}`, index-match activation), reactive **spotlight**, **black light**, and the **layer-aware back light**: a per-layer optical fold where each layer declares `transmit` + `scatter`, with emission composed through and a scatter/bloom.
- **Lens top-coat** — an ideal glass relief (fresnel / reeded / water), real per-pixel refraction, brighten-only caustic; runs over the back light.
- **Export** — masks (VA reads the 4 grey coverage maps), rich set (vein ids + along-vein t + vector paths), `source.json` (reloadable), `.ora`. → extended by the encoder layer above.

## AI-authoring thesis (why the hero matters)

Against a from-corpus generator: a generator samples the corpus's *joint* distribution (combinations that exist). SA factored the material into orthogonal, labeled, continuous axes, so an author reaches the *product* space — the continuous in-between (201.232, not discrete 201) **and** the coherent-impossible (a four-family slab, down to a mixed-family vein tree). The engineering discipline (every factored dimension) *is* the creative range. The Final Render exists to render that hero at a fidelity and scale that makes the point undeniable.

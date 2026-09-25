# Final Render — architecture & roadmap

Stone Author has two renderers by intent:

- **Interactive / reference renderer** — the live `draw()` on the main-thread canvas. Fast, screen-resolution, drives authoring. This is the *reference*: it defines what the slab looks like.
- **Final Render** — an **offline, single-frame** job. It does not have to be realtime; it has to produce one correct, very pretty frame at whatever resolution and format the output needs. Seconds are acceptable.

The single-frame constraint is the whole leverage. There is no 16.7 ms budget, no need to keep state GPU-resident, no reason to fear a synchronization point — a sync is just another stage in the job. That permits a **heterogeneous render graph where CPU and GPU are peers**, each stage running wherever it is cheapest and clearest. (This model was worked out with the ChatGPT design sounding-board — see [`PROVENANCE.md`](../PROVENANCE.md); the calls and the code are here.)

## Invariant: the document is the truth

Every backend consumes the same semantic document (stable artifact ids, families per mark, layers, colour tokens, observation/spectrum state, procedural recipes). No renderer is ever the source of truth. A higher-quality backend may **reveal more** (sharper refraction, real caustics, subsurface, metallic sheen) but must **not become compositionally different** — the invariant is *compositional* identity, not pixel identity. The seam is already renderer-agnostic: values, not CSS vars; `geo` is plain data; the coverage/field renders are resolution-parametric.

## Proven: the slab is the master (gallery + harness)

The invariant isn't just asserted — it's gated in CI. The [gallery](gallery.md) renders three heroes from two `.json` slabs; the Playwright [harness](gallery.md) injects a headless render hook, renders each hero **twice from a fresh `deserialize`**, and asserts the two raw-pixel hashes are identical — a **self-determinism gate**. What it establishes, and its exact limit:

- **The render is a pure function of the slab within a fixed browser build** — the harness gates the core case (byte-identical twice from a fresh `deserialize`); observed more broadly it holds across a reload and a process restart too. This leans on the `deserialize` **hard-reset**: a load resets `G`/`T`/`NEXT` to their pristine defaults (`G0`/`T0`/`NEXT0`) *before* applying the slab and invalidates the cloud/band/breccia + incremental caches, so the result never inherits a previous slab or a dirtied session. The offline `renderFull`/`renderTiled` path (no pan/zoom, whole slab, resolution-parametric) is what makes a hero reproducible at any size.
- **Cross-build byte identity is deliberately *not* required.** Sub-pixel canvas anti-aliasing varies between Chromium builds — the *picture* is identical, the *bytes* aren't, which is below what a shared image is for. So the CI gates on self-determinism (hard) and does not gate on a cross-build reference match; the committed `pixelSHA256` is a recorded reference, not a pass/fail bar. This is the practical face of *compositional identity, not pixel identity*: the same slab is the same picture everywhere, exact to the bit only within one build.
- **Across *engines* the difference is now measured, not assumed.** The [engine gate](gallery.md#three-engines-one-job) puts the same hero through Blink, Gecko and WebKit: each is byte-deterministic with itself, and Gecko differs from Blink by a mean of 7.919/255 and WebKit by 8.547/255 — reproduced exactly across two runs. Same magnitude, different *kind*: Gecko's lives in gradient and blur quantisation inside the blooms, WebKit's at every edge, where its small-geometry anti-aliasing leaves the debris chips visibly blocky. The claim this supports is the one above, with a number attached to it.

### The window was in the render — FIXED

The purity claim above had a hole the self-determinism gate could not see, because that gate renders twice
in one window. The coat's blur radii are written in units of a **coat scale**, and every path derived that
scale from the *on-screen* canvas width (`W/Wc`, or `dpr` live). Faithful to the preview, but it made the
coat a property of the slab **and the browser window**: measured at 1024 with specular, subsurface and lens
on, the same hero exported one image at a 620px canvas and a different one at 767px. The reality windows
were worse — the strip path scaled them by `bs` while `renderFull` scaled them by the window, so the two
export paths disagreed with each other as well.

`COAT_REF = 1000` is now the only reference: `bs = W/COAT_REF` in `renderFull`, the tiled plan and the strip
path; the reality windows and the back-light glow take the same ratio; and the live view uses
`cv.width/COAT_REF`, which is that same ratio expressed against the reference, so the preview still matches
what the export produces. A 1024px render is therefore a proportionally exact preview of a 65535px one —
which is what makes a quick check worth anything.

`tools/check-render-purity.mjs` keeps it that way: it reads the coat-scale argument of every `applyCoat`,
`compositeWindow`, `renderSlabTo` and `paintBacklit` call, follows a forwarded local (`bs`) to every place it
is assigned, and fails if any of them mentions a window measurement without `COAT_REF`. Ablated against all
five call sites of the original bug — each one turns it red — and it fails rather than passes when it finds
no coat scales at all, so it cannot go quietly blind.

## Known gap — FIXED

`expCompleted(W)` used to stop at `paintStoneContent`, so `render.png` (and the `.ora` merged image) were missing everything from v49 on — no coat tier, back light, or lens. **Fixed:** `expCompleted` now delegates to `renderTiled(W)` (rung 2 below — pixel-equal to `renderFull` but tiled so a huge export stays memory-bounded), which runs the complete pipeline. Exports carry the coat; the coverage masks stay geometry-only by design.

## Build order

1. **`renderFull` — the offline render primitive. ✓ DONE.** The complete pipeline (base → content → coat, incl. back light + lens) to a fresh W-wide canvas, whole slab, no pan/zoom. The coat passes were factored into a shared `applyCoat(targetCanvas, targetCtx, blurScale, flags)` used by *both* live `draw()` and `renderFull`, so there is one implementation and no drift; blur/scatter radii scale with the output resolution (`bs = W/COAT_REF`, see *the window was in the render* below). `expCompleted` now returns `renderFull(W)`, so **exports finally bake the coat / back light / lens** (the masks stay geometry-only). Verified pixel-for-pixel against live `draw()`. This is also what one tile renders — the foundation for everything below.
2. **Tiling + bleed. ✓ DONE.** `renderTiled(W, tilePx=1024, bleedPx)` splits the output into tiles; each renders its slab sub-region **expanded by a bleed margin** (`ceil(12·bs)`) so cross-tile blur/subsurface/specular are seamless, then the bleed is cropped and the tile blitted into the assembly canvas. Two coordinate subtleties handled: the specular hotspot is placed in **full-image space** (`applyCoat` takes a `vp` viewport), and the **lens runs once on the assembled image** (it downscales to ≤640, so it's global + cheap — and its displacement can exceed a tile's bleed). Back light isn't tiled yet (its fold is a whole-slab 512 pass) → falls back to `renderFull`. `expCompleted` now uses it, so exports stay memory-bounded. **Verified against `renderFull`: mean pixel diff 0.99/255, no visible seams.** Intermediate **resolution belongs to the operation**, not the export — the lens proves it (≤640 gather regardless of final size). *Next within this rung:* tile the back-light fold at full res; stream tiles to an encoder for exports beyond the ~16k canvas cap.
3. **CPU-worker pool. ✓ BUILT — but measured a no-op, so not the default.** `renderCoreSrc()` serializes the render core (`paintStoneContent` + coat + helpers, via `fn.toString()`) into an inline Blob worker; `renderTiledParallel(W)` runs an `OffscreenCanvas` worker pool, each worker rendering whole tiles and transferring `ImageBitmap`s back (cloud/band/breccia modulators built once and posted; `ensure*` stubbed). **Verified pixel-perfect vs `renderTiled` (maxDiff 0).** But the **speedup is ≤1.07×** (12 cores): the render is GPU-bound (canvas-2D + `ctx.filter` are already accelerated — a full 4096 is ~127ms), so worker setup + bitmap transfer swamps the CPU work. Left as available infrastructure, **not** wired into `expCompleted`. The real deliverables: (a) a **proven DOM-free, serializable render core** — the extraction the GPU backend and parallel probing both need; (b) it pays off only for a genuinely CPU-heavy per-pixel stage or print sizes past the ~16k canvas cap (tiling + streaming, mandatory regardless of speed). *Measure first — this is the workers' version of the GPU rule below.*
4. **Pluggable encoders (output layer). ✓ PNG encode parallelised.** The render produces **pixel buffers** (and, for layered output, per-layer buffers); encoding is a separate, pluggable stage. **Measured:** the export's cost is PNG compression, *not* the render — `toBlob` is ~1s per full-res file vs ~55ms to render it (~20×). So `encodePNGs(canvases)` renders every file on the main thread (fast) then encodes them **one-per-worker** via `OffscreenCanvas.convertToBlob` — the workers' real payoff, the *inverse* of the tile-render case (there each unit was cheap; here each is a ~1s encode). `exportAll` now batches all ~14 PNGs (main + `.ora`) through it. Verified byte-correct (zip + nested .ora `testzip` clean, PNG signatures valid). **Old export ≈ 15s of UI-freezing encode → 0.2–1.3s off-thread** (66× at 2048, 12× at 4096). Formats:
   - **Flat raster:** PNG (have), JPEG, WebP; float/EXR-style later for HDR.
   - **Layered:** ORA / OpenRaster (have — 5 bucket layers), **PSD**, and **PSB** (Photoshop large-document; handles >30k-px canvases where PSD caps out, so it pairs with the tiled huge-export path). Both PSD/PSB from their open specifications.
   - Layered output maps SA's buckets/layers to file layers, so a slab opens editable in Photoshop/GIMP/Krita.
   - **⚠ Editable-layers gap (Chris, share-for-edit):** today the export flattens *authoring layers* into the 5 fixed *buckets* — so a shared export can't be re-edited at the layer granularity it was authored in (you get 5 merged buckets, not the N authoring layers). The layered encoders should emit **one file-layer per authoring layer** (`layers[]`, incl. `#`-suffixed user layers), not per bucket. Small, well-contained; do it when the PSD/PSB path is built.
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

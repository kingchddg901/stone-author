# Final Render — architecture & roadmap

Material Author has two renderers by intent:

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
what the export produces. A 1024px render is therefore a proportionally exact preview of a 262144px one —
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
2. **Tiling + bleed. ✓ DONE.** `renderTiled(W, tilePx=1024, bleedPx)` splits the output into tiles; each renders its slab sub-region **expanded by a bleed margin** (`coatReach(bs, uv)` — the reach of whatever actually blurs in *this* render, plus `BLEED_MARGIN`) so cross-tile blur/subsurface/specular are seamless. Since the drawn halo became the default on 2026-09-30 the emission bloom contributes **nothing** to that margin: a drawn halo reads no neighbouring pixels, so the whole picture is submitted to every tile and the canvas clips the *output* rather than the input. The figure that used to dominate here — 1,577 px at 65535 — is now 4. `?bloom=blur` restores the old path and with it the old margin, then the bleed is cropped and the tile blitted into the assembly canvas. Two coordinate subtleties handled: the specular hotspot is placed in **full-image space** (`applyCoat` takes a `vp` viewport), and the **lens runs once on the assembled image** (it downscales to ≤640, so it's global + cheap — and its displacement can exceed a tile's bleed). Back light isn't tiled yet (its fold is a whole-slab 512 pass) → falls back to `renderFull`. `expCompleted` now uses it, so exports stay memory-bounded. **Verified against `renderFull`: mean pixel diff 0.99/255, no visible seams.** Intermediate **resolution belongs to the operation**, not the export — the lens proves it (≤640 gather regardless of final size). *Next within this rung:* tile the back-light fold at full res; stream tiles to an encoder for exports beyond the ~16k canvas cap.
3. **CPU-worker pool. ✓ LIVE on the tiled path. The no-op finding was true of the case it measured, and only that case.** `renderCoreSrc()` serializes the render core (`paintStoneContent` + coat + helpers, via `fn.toString()`) into an inline Blob worker; `renderTiledParallel(W)` runs an `OffscreenCanvas` worker pool, each worker rendering whole tiles and transferring `ImageBitmap`s back (cloud/band/breccia modulators built once and posted; `ensure*` stubbed). **Verified pixel-perfect vs `renderTiled` (maxDiff 0)** — still the property everything else here rests on.

   The 2026-09 figure of **≤1.07× on 12 threads** was measured on the *direct* path at 4096, where a whole
   tile is ~127 ms and worker setup plus bitmap transfer swamps it. That reading was correct and its
   generalisation was not. On the **tiled TIFF** path the arithmetic inverts: a tile is seconds rather than
   milliseconds, setup is paid once for the whole job, and the measured speedup is **4.25× across 8
   workers** (2.2× against the sequential tiled path end to end), byte-identical either way. Wired into the
   TIFF export in `d28167c` and gated by `corePaintsThis()` — daylight, no reality window, no back light,
   `Worker` and `OffscreenCanvas` present — which are exactly the conditions under which the serialised
   core reproduces the main-thread render with zero differing bytes.

   **The planner picks the tile for the pool, not for one pass.** `tiffPlan` scored candidates on
   `est = passes × ms`, which is the *sequential* wall clock: it rewards the big tile for amortising
   per-pass overhead, and that is the same tile the pool can run fewest of at once. It now scores
   `est / N`, and the headroom test weighs `N × tile` instead of one tile. Both ask `poolWidthFor`, the
   single function `tilePool` itself uses, so the planner cannot optimise for a width that never arrives.
   Measured bite: at 65536 on a 2 GB device the budget holds five 8192 tiles against twenty-four 4096
   ones, so 8192 wins on `est` (16,800 ms against 19,200) and loses the wall clock. That case is now a
   test of the *scoring* rather than of a reachable plan — the probe feeds it a synthetic ladder, because
   a rule enforced only by a list returns the first time somebody edits the list. Three constraints can
   bind the width — the budget's room, the core count and `POOL_MAX` — and the probe now asserts *which*,
   because asserting the number hid the mechanism: this sentence read "eight 4096 ones" for as long as the
   cap was eight, and the budget held twenty-four the whole time. `tools/probe-pool-width.mjs`.

   **The width cap, raised from eight to ten on 2026-10-17.** A 65,535 glass master traced at **93.7%
   utilisation**, eight workers busy for 87% of all samples, and a wall clock within **7.6%** of
   `paint ÷ workers`. Scheduling had nothing left to give — the pool was already doing the job — so the
   only quantity that could still move the clock was how many cores it may use, and neither cores (12)
   nor memory (room for 192 tiles at a 4096 pass) was binding. `POOL_MAX` was. Ten and not twelve on
   purpose: the machine stays usable, and the main thread still owes ~400 ms per pass to `getImageData`,
   the light sample, deflate and the sink.

   **It is not free throughput, and the same master says so.** The solo baseline pass painted in
   **26.2 s**; the mean pass under eight-way load took **39.2 s** — 1.49× contention already, an
   effective 5.36× of a nominal 8×. So the floor arithmetic that promises 20% at ten workers assumes a
   constant pass cost that is demonstrably false. The shed logic is what makes raising the cap an
   experiment rather than a gamble, and `tools/pool-trace.mjs` reads the result off the next master.

   **And the paint is uniform, which closes a door.** Per-pass paint across that render varied by
   p90/p10 = **1.08×**, standard deviation 6.6% of the mean, with picture-row means between 35.9 s and
   40.5 s. Longest-Processing-Time scheduling, out-of-order consumption and a two-deep per-worker queue
   were all scoped against the hope that pass costs varied; they do not, on this material. The earlier
   reading that glass detail was top-heavy came from `perTile.ms`, which is consumer-side wall, and was
   an artefact of the consumer's position in the pipeline.

   **The pool measures whether it is too wide, because nothing it can ask will tell it.** Every memory
   figure a browser offers describes the machine, not what is free on it: `navigator.deviceMemory` is total
   RAM (it reported 16 on a desktop whose budget then read 12,885 MB while ~2,300 MB was actually free),
   `performance.memory` is the JS heap and canvas backing stores are not in it, and
   `measureUserAgentSpecificMemory` needs a cross-origin isolation a single file on Pages cannot set. An
   allocation probe agrees with the fiction, because **paging does not fail — it just takes longer**:
   eight 8192 tiles allocated without a throw and then swapped for three hours.

   **That size is no longer reachable, and the incident above cannot recur.** 8192 left the tile ladder
   on 2026-10-20: across 713 masters on record there are none at it, across 137 plans where the planner
   was free to choose it picked it never, and what it did instead was calibrate it 54 times for 2,202
   seconds — the worst a 456-second allocation of an 874 MB tile on a 2 GB tablet. The largest tile is
   now 4096, so eight workers hold 8 × 67.4 MB = **539 MB on any device, in any configuration**, against
   the 2.15 GB that paged. `tools/probe-pool-width.mjs` asserts that ceiling and the footprint that
   follows from it.

   **The mechanism that used to act on this is gone.** It measured how far over the solo baseline a pass
   ran and shed a worker when the figure got high enough. It no longer does, and the reason is that the
   figure cannot carry the decision. The comment justifying the threshold said it "still caught swapping
   at 5–20×"; across **seventeen renders on five devices and three engines — every one at a pool
   footprint where paging was arithmetically impossible — the readings spanned 1× to 18×**. The range it
   fired on is a subset of the range it false-fires on, so no threshold placed on that axis separates the
   two, and every device converged on the same 10–14× cluster regardless of engine, content or hardware.

   Measured cost on one machine two days apart: **27%** on a 262,144 that shed 8 workers to 3, and
   **13%** on a 1,048,576 that shed to 5. Of the seventeen, thirteen ended narrower than planned; the
   four that recovered paid between two and twelve worker terminate-and-respawn round trips to arrive
   back where they started, an iPhone's 262,144 doing six.

   So the pool paints the first tile alone, keeps that time as a baseline, and **records** what the rest
   of the render costs against it. It never narrows. `poolStrain` carries three numbers — row medians
   past the strain level, short-window medians past 10×, and the worst ratio seen — which is what a
   device genuinely in trouble would show up in, at no cost in parallelism to one that is not.
   `tools/probe-pool-strain.mjs` holds the arithmetic, and its central claim is that the width never
   moves after the ramp whatever the figures say; the ablation at the end puts a `target--` back and
   requires that claim to go red, because an assertion that nothing happens cannot bite on its own.

   **The level is still not one number**, because the figure is still worth recording honestly. A worker
   that finishes its own tile also reads it back and deflates it, and eight of those at once legitimately
   cost 3–4× a solo pass — measured. So the finish level is `3 + 3 × (workers / hardwareConcurrency)`:
   5.00 on a desktop that `POOL_MAX` caps at 8 workers against a reported 12, 6 on a device reporting one
   worker per thread, and plain painting stays at 3. `hardwareConcurrency` is what the browser schedules
   against; it is **not** a core count — the desktop reports 12 for 6 cores with SMT, Safari clamps to 4
   on a 6-core A16, and an 8-core Android reports 8 unequal cores. The ratio is honest about subscription
   to what the browser offers, and nothing more.

   **And the window is a row, because a reality window is a band.** A 262,144 carrying one disc shed five
   times, 8 workers down to 3, and ran its last three-quarters at 2.9 workers — 423.7 s where its own
   throughput says 346. Nothing in it was swapping. A disc covers a contiguous column range, so eight
   *consecutive* tiles inside it were all expensive and an eight-tile median read 6×; the same slab at
   131,072 read it only twice, because a 15-tile-wide disc fills an eight-tile window less often than a
   29-tile-wide one does. The size dependence was the bug — and a disc is the same share of a *row* at
   every image size, which is what makes the row the one window it cannot manufacture. Kept at a row even
   now that nothing acts on it, because a figure worth recording is one a band cannot fake. The window
   also no longer shrinks with the pool: it was `max(2, target)`, so that render's last two readings were
   taken on four samples and on three.

   **What the retirement gives back to the smallest devices in the fleet.** Measured the day it landed,
   65,535 UV at a 2048 tile: a Galaxy Tab A 8.0 ran **3.90 of 4 workers** and an A7 Lite **7.81 of 8** —
   the two best occupancy ratios in the fleet, better than the desktop's 7.12 of 8. Both had shed and
   recovered under the previous build; neither narrows now. The Tab A's own record in
   `docs/sidecars/README.md` has it shedding 4 → 2 and losing a third of its throughput to it.

   **UV is refused for a measured reason, not an assumed one.** `corePaintsThis` has always had a
   `!uvMode` clause, and the natural reading is that the serialised core cannot paint UV. It mostly
   can: it already branches on `uvMode` in its own tile setup and already receives `uvMode` and
   `lightSpectrum` at init. What it lacked was the emission path - `BLOOM_DRAW`, `glowPx`, `liftCol`,
   the glow knobs, the crossfade state `emit` reads, and `blurDraw` with its pyramid fallback.

   Carrying all of those was tried on 2026-10-18 and **the result does not match**. Measured on an
   empty slab at a 256 tile: sequential returns uniform `rgb(19,19,27)`, which is `UV_DARK` exactly,
   and the same tile through the pool returns uniform `rgb(29,29,41)` - about **1.52x on every
   channel**, with no content in either, so the divergence is in the UV background and coat rather
   than in anything drawn. A master must not depend on whether a pool ran, so the clause stays until
   that lift is traced and the two agree byte for byte.

   Two things are worth keeping from the attempt. The dependency closure is larger than the gate's
   list suggests - eight named names pulled in twenty-one once followed - and carrying them trips
   `check-bleed`, because `glowLift`, `IS_GECKO` and `WEBKIT_LIFT` are `const` declared far below
   `renderCoreSrc`, a temporal dead zone the project enforces on the bare identifier. Any future
   attempt needs those hoisted first, by the function-declaration route the glow comment already
   describes.

   **The master says what ran.** `workers` is the width, which no longer moves once the ramp is over,
   and `poolStrain` is how hard the render found it. A master written before 2026-10-20 carries
   `poolShed` instead — a record of workers actually taken away, which is a different fact and not
   comparable. `trace.busy` remains the honest account either way: a sampled series of how many workers
   were actually painting, since one can still be idle between dispatches. That field previously could not appear on any master: it was read after the success path had
   already closed the pool and nulled it, while its comment told the reader that absence meant
   single-threaded — which made a render at 94% of twelve threads read as having painted on one.
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

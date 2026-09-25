# Stone Author — capability spec

The complete, verified inventory of what an authored slab can use. Compiled from a four-way read of
`app/stone-author.html`. Line numbers are approximate. This is the palette the full-spec / hero author draws
on, and the surface the Final Render must reproduce. See [`final-render.md`](final-render.md) for the render
pipeline that consumes it.

## 1. Model

- **5 export buckets** (`LAYERS`, ~L518): `base`, `web`, `micro`, `minor`, `major`. Fixed consumer contract, read by key — visibility/opacity/effects here never change an exported mask.
- **Layers live inside buckets, many per bucket** (`layers`, ~L533). A layer is an authoring group; a mark files into the *active* layer of its bucket; layers flatten into their bucket on export. Sedimentary order = paint order (deepest → top). Per-layer: `on`, `op`, `warp`, and (back light) `transmit`, `scatter`; micro layers also `field/density/size/seed`.
- **Family is per-mark** (`FAM[m.fam]`, L1508 — "the character it was drawn with"). One slab can carry veins of different stones, and an authored branch carries its own family while attaching to a parent of any family. Cross-breeding is in the data model, not a feature.
- **Colour is decoupled from family/structure** — `OVR` (overrides) → `recolour()` → `COL` (resolved, painted). Resolution at paint time: `id:` override → `lay:` override → resolved bucket in `COL`. Family enters only at `seedColours()`.

## 2. Families — `FAM` (~L420)

Character only (structure + preview colours). Fields:

| field | meaning |
|---|---|
| `gauge` | base vein width (× `NEXT.gauge`) |
| `rough` | fine-roughening amplitude (× `NEXT.rough`) |
| `onset` | exponent delaying roughening by scale (higher = crisper coarse) |
| `swing` | width variation along a vein |
| `breaks` | fraction of a line rendered as gaps |
| `branches` | `[min,max]` family-minor count per major |
| `branchLen` | minor/branch length multiplier |
| `soft` | edge-softness / halo width multiplier |
| `cells` | base web-cell count |
| `stretch` | web-cell elongation along the crack |
| `spread` | web-cell scatter σ |
| `groundSpecks` | granite only — seeds a speck ground, enables gravity/deflect/fold |
| `ground`/`vein`/`web`/`speck` | preview colours (real colour lives in `OVR`/`COL`) |

| field | carrara | calacatta | marquina | granite |
|---|---|---|---|---|
| ground | `#e6e6e4` | `#f2eee6` | `#121316` | `#151517` |
| vein | `#6c727b` | `#554d3c` | `#ecebe7` | `#ebe9e4` |
| gauge | 0.0045 | **0.011** | 0.005 | 0.004 |
| rough | 0.26 | 0.18 | 0.24 | 0.24 |
| onset | 1.5 | **2.2** | 1.7 | 1.7 |
| swing | 0.25 | **0.30** | 0.20 | 0.20 |
| breaks | **0.22** | 0.10 | 0.18 | 0.12 |
| branches | [3,5] | [1,3] | [2,4] | [0,2] |
| branchLen | 1.0 | **1.2** | 0.9 | 0.7 |
| soft | **1.5** | 0.9 | 1.1 | 1.0 |
| cells | 900 | 500 | **1100** | 900 |
| stretch | **2.2** | 1.6 | 2.0 | 2.0 |
| spread | 0.05 | 0.04 | **0.06** | 0.05 |
| groundSpecks | — | — | — | ✓ |

## 3. Tools (`data-tool`, ~L87)

| tool | mark kind | what it does |
|---|---|---|
| Vein | `vein` → `buildVein` | major vein; hand-routed, fractal-roughened, spawns family minors, deflects around specks, folds specks. 6 variants. |
| Branch | `branch` → `buildBranch` | tap a vein (≤26px) to sprout a tributary, or drag to hand-route; width from the parent's realized gauge, character from its own family. |
| Web | `web` → `buildWeb` | crack line + Delaunay cell cloud, denser at the line, elongated along its run. |
| Stylolite | `styl` → `buildStyl` | toothy interlocking seam, tapered to nothing at both ends. |
| Pour | `pour` → `buildPour` | Poisson speck trail; rate builds with dwell + curvature; fling/spatter on sharp fast curves. |
| Gravity | `gravity` → `applyGravity` | pull/push the speck field (granite ground, or the Fog layer if selected). |
| Magnet | `magnet` → `applyMagnet` | rotates speck orientation to a bar-magnet field; hover-trace commits weakly. |
| Chip | `chip` → `chipEdge` | (tiles on) knock a jagged bite from a tile edge. Uses `T.chipIn`. |
| Tune | — | no mark; tap an artifact to toggle it into `selected` (`id:` keys). |
| Cloud | — | drag pans `G.cloudX/Y` (cloud + warp field origin). |
| Moon | `moon` → `applyMoon` | drag a ball; forward-warps geometry into its wake. Applied in `warpGeo`, not baked. |
| Mask | `mask` → `gatherMasks`/`warpMaskAt` | tap or drag an island. **Protects** holds the warp still inside it (an island of normalcy); **Window into chaos** (`maskInvert`) inverts the sense, so once one exists the warp acts *only* inside these discs. With the show-through toggle on, the island also renders at its own **Window spectrum** (`maskSpec`, 0 = daylight), baked into the live view and every export. `p:{maskFeather, maskWin, maskSpec, maskInvert}`. |
| Light | — | drag sets `G.lightX/Y/lightAngle` (shared light + spotlight beam). |
| Move | — | pan the viewport. Two-finger pinch always zooms. |

## 4. Per-stroke settings — `NEXT` (~L483)

Snapshot onto every mark as `p: {...NEXT}`. Defaults / range / effect:

| key | default | range | effect |
|---|---|---|---|
| `pressure` / `tilt` | false | bool | enable pen-pressure width / pen-lean edge softening |
| `gauge` | 1 | 0.3–3 | × `F.gauge` vein width |
| `rough` | 1 | 0–2.5 | × `F.rough` roughening |
| `breaks` | 1 | 0–3 | × `F.breaks` gaps |
| `branches` | 1 | 0–2.5 | × family minor count (**inert for `echelon`**) |
| `defl` | 1 | 0–2 | vein deflection around specks (**inert unless `specks>50`**) |
| `fold` | 1 | 0–2.5 | speck fold-strain around a vein (**inert if no specks**) |
| `variant` | natural | enum | natural / sinuous / dendritic / echelon / boudinage / halo |
| `varAmt` | 1 | 0.3–2 | sinuate / echelon offset amplitude |
| `blen` | 1 | 0.3–3 | × `F.branchLen` tapped-branch length |
| `gauge2` | 1 | 0.3–3 | × parent gauge → branch width |
| `spread` | 1 | 0.3–3 | × `F.spread` web scatter σ |
| `density` (web) | 1 | 0.3–3 | × `F.cells` web cell count |
| `stretch` | 1 | 0.4–2.5 | × `F.stretch` cell elongation |
| `stylAmp`/`stylTooth`/`stylWidth` | 1 | 0.2–3 / 0.3–3 / 0.4–3 | seam tooth amplitude / frequency / width |
| `prate` | 1500 | 200–4000 | pour Poisson rate /s |
| `pwidth` | 1 | 0.3–4 | pour trail width |
| `pfling` | 1 | 0–3 | fling/spatter count — **conditional: only fires when `acc>3` (sharp fast pour)**, L1490 |
| `sign` | 1 | ±1 | gravity pull(+)/push(−) |
| `strength` | 0.5 | 0.05–0.9 | gravity intensity |
| `reach` | 1 | 0.3–3 | gravity radius |
| `mag` | 1 | ±1 | magnet align(+)/scatter(−) |
| `mstrength`/`mreach`/`mheight` | 0.6/1/1 | 0.1–1.5 / 0.3–3 / 0.3–3 | magnet intensity / radius / fan sharpness |
| `moonReach` | 1 | 0.3–3 | moon ball radius |
| `moonStrength` | 1 | 0.2–3 | moon drag multiplier — **unclamped in `applyMoon`** (a Save/Load can exceed the slider) |
| `maskFeather` | 0.06 | — | Mask disc edge softness (feathered `r`→`r+feather`) |
| `maskWin` | 0 | 0/1 | reality window off / on (`FMT`: `off` / `on`) — on = the island shows another light through |
| `maskSpec` | 0 | −1–1 | the window's **own** light spectrum (`FMT`: `daylight` at 0, else the value). Absent on a mark saved before it existed ⇒ falls back to 0 |
| `maskInvert` | 0 | 0/1 | island sense (`FMT`: `protect` / `chaos`) — 1 = a window into chaos, the warp acts only inside |

**Variants:** `natural` (plain); `sinuous` (low-freq wobble, `varAmt`); `dendritic` (×2.2 minors, each throws sub-branches); `echelon` (route diced into 3–6 offset segments — **returns before spawning any family minors**, so `branches` is a no-op); `boudinage` (rhythmic width pinch/swell, orthogonal per-mark); `halo` (wide soft low-alpha shoulder, `L.gauge*6*F.soft`).

## 5. Primitives / generators

- **`buildVein`** — major trunk + family minors; deflects around specks (`>50`), folds specks (`intrude`), tapers ends, pressure/tilt.
- **`buildBranch`** — one minor off a parent at arc-length `at`; routed (drag) or tapped (family auto-routes, length ∝ 1/√zoom); width from `par.gauge*0.5*gauge2`; own family.
- **`buildStyl`** — toothy seam, family-independent geometry.
- **`buildWeb`** — PCA on the route → seeds scattered in a stretched/rotated frame → Delaunay → probabilistic sub-cracks thinning with distance; always adds the leading crack.
- **`buildPour`** — timed velocity/curvature → Poisson speck emission; dwell widens; fling on angular-accel spikes.
- **`applyGravity`** — pull (order-preserving) / push (area-preserving disc or strip) on specks or fog.
- **`applyMagnet`** — rotate-only orientation to a dipole fan+comb field; time-over-spot builds; hover weak.
- **`buildGround`/`groundFor`** — granite speck ground, per-micro-layer density/size/seed, cached, **hard fit-cap** (`fits = floor(3500*1.8/size²)`), relaxed so nothing touches.
- **`buildDrusy`** — index-deterministic crystal pockets (density only appends).
- **`buildBreccia` / `buildClouds` / `buildBands` / `buildFog`** — base-bucket canvas modulators (Voronoi clasts / fBm mottle / directional bands / uniform haze). Clouds double as the **warp field**.
- **`warpGeo` + `applyMoon`** — global cloud-fBm domain warp (`G.warp`, per-generation `warpDepth`) + local moon drag; anchor pass re-pins roots (bond `1/(1+d)²` — trunk planted, deep tips loose).
- **`gatherMasks` + `warpMaskAt`** — **protected islands**: a feathered disc where `warpMaskAt` returns a 0→1 multiplier (0 inside `r`, smoothstepping to 1 across `feather`), and **both** warps (global field *and* every moon) scale their per-point displacement by it — so a region holds normal while the rest distorts. Discs come from `G.warpMask` (programmatic / legacy) **and** every Mask mark; the anchor pass is deliberately *not* masked (freezes the field warp, not the root bond).

## 6. Slab settings — `G` (~L487)

Full table with defaults/ranges is in [`final-render.md`] and the source; key groups:

- **Coat/light:** `subsurface` (0–2), `specular` (0–1), `lightAngle` (±180), `lightTemp` (±1), `lightX/lightY` (Light-tool only), `spotR` (0.05–0.6), `backlight` (0–2), `lens` (0–1), `lensPitch` (2–40), `lensType` (fresnel/reeded/water).
- **Body:** `cloudStrength`/`cloudScale`/`cloudX`/`cloudY`, `warp`/`warpDepth`, `warpMask` (the programmatic protected-island list, `[]` by default), `bandStrength`/`bandFreq`/`bandAngle`/`bandWave`, `brecStrength`/`brecClasts`/`brecSeam`, `drusyDensity`/`drusySize`/`drusyBright`/`drusyGroups`/`drusySubs`, `speckGroups`/`speckSubs`.
- Granite `gspecks`/`gsize`/reseed **and** the fog `fogHaze`(0–0.06)/`fogSize`/`fogDensity` are **not** `G` — they write the active micro / fog **plane** (`density`/`size`/`seed`, `haze`/`size`/`density`). Old saves that stored them on `G` migrate onto the plane on load, then the `G` keys are deleted.

## 7. Colour / tokens / adjustment set

- Stores: `OVR` (edited/persisted), `COL` (resolved), `perItem` (id→bucket), `OVR_uv` (spectrum emission, lists of `{v,c}`).
- Token keys: bucket (`major`…), `lay:<layer>`, `id:<artifact>` (`W`=web, `S`=seam, else vein), `micro:<g>[.<v>]`, `drusy:<g>[.<v>]`, `<key>Blend`/`<key>Glow` (FX layers), `<base>:<adj>`.
- **Adjustment set `ADJ`** (per target, resolves artifact→layer→bucket→default): `blur` 0–8, `hue` ±180, `sat` 0–2, `bright` 0–2, `contrast` 0–2 (all via `ctx.filter`), `weight` 0.2–3 (line-width multiplier). Applied per-artifact; **veins run it twice** (shoulder + main stroke), so effects compound.

## 8. Coat / lighting / spectrum / back light / lens

Order in `draw()`: ground → (backlit **xor** daylight content) → `applyCoat` (uv bloom → subsurface → specular → **lens, the last coat pass**) → **reality windows** (`applyWindowsScreen`) → guides. `applyCoat` is shared with `renderFull`, so exports run the same coat.

- **Subsurface** — feature high-pass, warm-tinted (`#ffcf8f`), added `lighter`; >1 adds passes.
- **Specular** — radial `screen` hotspot toward `lightAngle` + masked feature glint, tinted `lightRGB()`.
- **One light** — `lightRGB()` warm↔cool from `lightTemp`; `setLight()` positions it; feeds specular, tile edges (`edgeFinish`), back light.
- **Spectrum engine** — `lightSpectrum` scalar; `emit(id,layer,x,y)` returns `c` when `|lightSpectrum−v| ≤ SPX_TOL` (0.12) and (if `spotOn`) inside `spotR`; else `UV_DARK`. `beamPts` gates whole strokes. Black light = preset −1. Folders = spectrum workspaces.
- **Back light** (`paintBacklit`) — per-layer optical fold: base bucket = glowing body; each layer occludes toward its `transmit` and diffuses by its `scatter` (blur of the **whole** accumulator); emission composed through; scatter/bloom. Defaults `BL_T` (veins .05 … matrix 1).
- **Lens** — ideal glass relief (fresnel/reeded/water), per-pixel refraction at ≤640px, brighten-only caustic; runs on `cv` **after** everything (incl. back light).
- **Reality window** — a Mask island with its window on shows a *different light through* its disc: `renderSlabTo` re-renders the whole slab at the island's `show` spectrum (its own `maskSpec` for a tool mask, `e.show` for a `G.warpMask` entry — **any** spectrum either way), `compositeWindow` feathers that alt render in through the disc, and `applyWindows` / `applyWindowsScreen` run it onto every finished render — the live view **and** every export (end of `renderFull` / `renderTiled` / `renderTiledParallel`). So *daylight through a UV/psyker view* is authored in the tool, not hand-composited after — and the window can point the other way just as easily.

## 9. Layers / selection / hide / folders

- **Layers** — 5 buckets, 11 default layers, `#`-suffixed user layers; derived display tags (`M1`/`N2`…, not stored).
- **Selection** — `selected` Set of token keys (`lay:`/`id:`), ephemeral. Selected bar: colour, no-colour, warp/hold, hide, and back-light `pass`(`transmit`)/`scatter`.
- **Hide** — `hidden` Set of **mark ids** (7th dimension); skipped by render + hit-test; recovered only from the Hidden list.
- **Folders** — `{name, v, c, members}` spectrum workspaces: enter (set light + select), tag (batch-author `OVR_uv`).

## 10. Export / serialize

- **`exportAll(W)`** → one store-zip: `render.png` (`expCompleted`), `masks/{base,major,minor,micro,web}.png`, `rich/{vein-ids,vein-t}.png` + `legend.json` + `paths.json`, `lines.svg`, `source.json`, `slab.ora` (capped `min(W,2048)`).
- **✓ Gap fixed:** `expCompleted` now delegates to `renderTiled(W)` (which is verified pixel-equal to `renderFull` but tiled so a huge export stays memory-bounded; back light falls back to `renderFull`), so `render.png` (and the `.ora` merged image) bake the full pipeline — coat tier, back light, lens. The coverage masks stay geometry-only by design.
- **Peak memory is two canvases, not fourteen.** `exportAll` builds in groups of `EXP_PEAK` (2) and frees each canvas before making the next. It used to render all fourteen first and hold them alive: 1.2 GiB at 8192 and **5.0 GiB at 16384**, which no machine has. The batch existed to hand the whole set to the CPU worker pool that this repo's history records as *"measured a no-op"* — so it cost 8× the peak and bought nothing. `canvasFits(w, h, n)` probes `EXP_PEAK` canvases, so the offered ceiling matches what the export actually needs; the cache key carries a version because ceilings measured under the old probe were wrong by 8×.
- **The ceiling on screen is the ceiling that applies.** `exportCeiling()` probes 2048→16384 for `EXP_PEAK`
  canvases, which is the ceiling of the *direct* export — and the line beside the width menu stated it as
  *"this device tops out at 16384px"* whatever the streamed tiers were doing. On a machine that had just
  written a true 65535px render, that sentence was on screen: measured before the streamed path existed and
  never revisited. The line now reports the largest width actually on offer, and says *"more behind the
  tickboxes below"* while a bigger one is a tick away rather than out of reach.
- **The side cap is measured, not assumed.** `CANVAS_SIDE_CAP = 65535` is Blink's figure, and the streamed
  tiers were gated by the tickboxes alone — so a browser that cannot hold a canvas that wide would be
  offered the size anyway, and a clamped canvas does not throw: it reports the width asked for and never
  writes the far end. `sideCap()` bisects `1×N` (2 ms in Blink, 9 ms in Gecko, cached per device signature);
  widths past it are shown disabled with the reason, and `renderStreamedPNG` refuses against the measured
  number. The cap is a property of the **build**, not the engine: CI measured Gecko and WebKit clamping to
  32767 while a desktop Firefox wrote a genuine 65535×40959 file — verified by decoding row 0 of that file
  edge to edge, opaque all the way to x=65534.
- **An export reports itself for as long as it runs.** A status line under the File buttons counts the images, then packing, then saving, with a bar; the Export button is held disabled and restored in a `finally`. Before this the only signal was a `hint()`, which removes itself after 2.6 s — invisible at 1024, where the whole export finishes first, and useless at 16384, where minutes of blocked main thread looked like a hung page. Each step yields with `setTimeout` (**not** `requestAnimationFrame`, which stops firing when the window is backgrounded) so the line paints before the next render blocks. Gated by `harness/export-progress.mjs`, which requires the message to keep *changing* — a single message that never moves is the defect it exists to catch.
- **Export scope: `Everything` or `Just the render`.** The kit is 8 full-size images plus 6 at `min(W,2048)`, and `expIdT` builds two of the big ones in a **single pass** — it walks the lines once, drawing the id map and the t map together — so *two* full-size canvases alive at once is a floor for the kit, whatever `EXP_PEAK` is. At 16384 that is 1.28 GiB before a byte of PNG, plus every encoded PNG staying alive in `bytes[]` until the archive is built. `Just the render` holds exactly one canvas, encodes it, frees it, and writes the PNG straight out with no archive: roughly 0.9 GB against 1.8 GB at 16384. It is also simply the common case — most of the time you want the picture.
- **An export reports itself tile by tile, and records its own timings.** `renderTiled` is split into a plan (the assembly canvas plus one closure per tile) and two drivers: the synchronous one runs the closures back to back exactly as before; `renderTiledStepped` runs the *same* closures in the *same* order with a yield between them, so a render-only export reports `Rendering tile 7 of 160`. At 16384 that is 16 × 10 tiles over about two minutes — the difference between a job you can watch and one that looks wedged. Stages that cannot count themselves (PNG encoding is a single call) show a moving stripe, and a wall-clock timer runs throughout: elapsed time plus stage name distinguishes *alive* from *wedged* even with no percentage available. The finished line stays on screen with its time, as the record of the last export.
- **The output carries its own provenance.** A render-only PNG gets a `tEXt` chunk spliced in after IHDR holding scope, dimensions, tile count, byte count, per-stage milliseconds (`render` / `encode` / `total`), mark and line counts, family, spectrum, `devicePixelRatio`, core count and the user-agent. The full kit gets the same as `export.json` inside the archive. This is what makes a later performance change checkable rather than a feeling. **It records the user-agent string**, because on a phone the device *is* the measurement — strip the chunk before sharing a render if that matters. **Baseline, S23 Ultra, whole kit at 16384×10240**, from the export's own `export.json`: `render 70,102 ms`, `encode 57,346 ms`, `toPack 128,585 ms`, 14 images, 234,284,278 bytes of PNG, 241 MB archive, 2:21 on the app's own clock. That is **1.358 G pixels produced** — ≈52 ns/px to render, ≈42 ns/px to encode, ≈9.6 M px/sec end to end. **Encode is 45% of the work**, and it runs on one core, because anything over `ENC_BIG` is routed away from the worker pool; at 8192 three copies of an image is 480 MiB and the pool would be affordable, which is the measured case for raising that threshold rather than for reviving `renderTiledParallel` (that parallelises the 55% half and is recorded here as a no-op).

An earlier draft of this paragraph said there was **no instrumented figure for render-only at 16384**, and
quoted ≈1.4 M px/sec from a stopwatch that included the download notification appearing — arithmetic on a
guess, disowned by its author. There is now a measured ladder, from the app's own finish line, one width
after another on the same slab (666 marks · 70 vein lines · 232 cracks · 8,050 specks), scope **Just the
render**, Chrome 152 on a 12-core Windows desktop:

| width | pixels | time | throughput | path |
|---|---|---|---|---|
| 1024 | 0.66 MP | 0:00 | — | direct |
| 2048 | 2.6 MP | 0:00 | — | direct |
| 4096 | 10.5 MP | 0:01 | ~10 MP/s | direct |
| 8192 | 41.9 MP | 0:03 | ~14 MP/s | direct |
| 16384 | 167.8 MP | **0:14** | ~12 MP/s | direct |
| 20480 | 262.1 MP | **0:55** | 4.8 MP/s | streamed |
| 24576 | 377.5 MP | 1:21 | 4.7 MP/s | streamed |
| 32768 | 671.1 MP | 3:07 | 3.6 MP/s | streamed |
| 65535 | 2,684 MP | **10:56** | 4.1 MP/s | streamed |

**The step is at 16384 → 20480: 1.6× the pixels, 3.9× the time.** That is not a curve, it is the move onto
the strip path, which repaints the slab once per band — the direct export runs at ~12–14 MP/s and the
streamed one settles at ~4–5 and stays there, so streaming costs roughly **3× per pixel**, flat. (32768 at
3.6 is low against both its neighbours and reads as machine state, not as a property of that width.) This
is the measurement behind the friction in front of the large tiers: *"this is not fast"* is not a hedge.

**Extreme names the machine it is known to finish on.** Beside its tickbox and again in its confirmation
dialogue: *"Recommended: 16 GB of memory — the machine this tier is known to finish on. Below that it is
untested, not unsupported."* Untested rather than unsupported because nobody has tested a boundary, and
refusing a machine we have never tried would be a stronger claim than the evidence carries. Whatever
`navigator.deviceMemory` says is printed beside it rather than used as a verdict, because it cannot be one:
Gecko and WebKit do not implement it, and Blink builds disagree — the CI Chromium reports 8 where the
desktop one reports 16.

**What is known about anyone else's machine: almost nothing, and one number decides much of it.** The
Extreme tier has been completed on exactly one machine — 16 GB, 12 cores, Windows — across four browsers.
The [engine gate](gallery.md#three-engines-one-job) proves the path itself works in Blink, Gecko and
WebKit, but at 2048 with a forced band height: not at 65535, and not under memory pressure. And
`stripPlan`'s budget is reduced by `navigator.deviceMemory`, which is a **Chromium-only API**. Measured in
CI: Blink reports 8 and plans at 900 MB; Gecko and WebKit report nothing, fall back to 4, and plan at
**537 MB** — whatever the machine actually has. That is ~1.7× the bands, and every band repaints the whole
slab, so a Firefox user on a 64 GB workstation renders slower than a Chrome user on 8 GB *by our choice,
not the engine's*. It is left conservative on purpose: an allocation succeeding is not the same as a
machine sustaining it, and on the desktop where the 900 MB figure was measured, 1.5 GB killed the renderer
outright. The honest summary of the tier is the one its own dialogue gives — not fast, not guaranteed
stable — with the addition that *stable here* is a sample of one.

The 65535 run's own `tEXt` chunk: **35 bands**, 10,737,033,219 bytes of scanlines compressed to 841,322,901
(12.8:1), `render 452,936 ms` of `total 655,393 ms` — so deflate and write are **31%** of the wall clock,
not a rounding error. Run twice, 74 minutes apart and across a build change, the image data came back
**byte-identical** (SHA-256 over all 51 IDAT chunks); the two 841 MB files differ only in this chunk, whose
timestamp and timings happen to be the same length, which is why their byte counts matched and their file
hashes did not. That is the determinism gate's claim at 2.68 gigapixels, where no CI job can follow it.

The kit run also settles a prediction that was wrong: the kit at 16384 was estimated at ~1.8 GB peak and called unlikely to fit on a phone. It fits — the accumulated PNG bytes came to 234 MB rather than the ~500 MB guessed, putting the real peak near 1.5 GB.
- **Canvas work is deferred, so the timings had to be forced to be honest.** Draw calls return long before the rasteriser has done anything; the work lands when something reads the pixels, which in an export is `toBlob`. So the masks appeared to render in milliseconds and their real cost was charged to `encode`. Measured on a phone at 16384: the kit's fourteen images "rendered" in 90.2 s while render-only took 91.2 s for **one**, and the kit's encode ran 97 s longer than render-only's — that 97 s was seven full-size images rasterising, mis-filed. `flushCanvas` reads one pixel back before the render clock stops. **It costs ~5%** on a real slab (666 marks, 8192: `toPack` 13.9/14.0 s before, 14.4/15.0 s after) and buys a split that is true.
  - A cautionary measurement from the same work: on a **4-mark** slab the same change looked like a **2.85× speedup** (11.2 s → 3.6 s, repeatable to under 1%). It is not. A near-empty canvas stays GPU-backed so `toBlob` pays a full readback per image; a content-heavy one has already fallen back to CPU. Benchmarking the export on a trivial slab measures the browser's storage heuristics, not this app.
- **Tiling is not the bottleneck** — hypothesis killed by measurement, so nobody spends a day on it. At 8192 on a desktop, with rasterisation forced: `renderTiled` 1,698/1,670 ms against `renderFull` 1,651/1,559 ms, i.e. **~5%**, despite `renderTiled` submitting the whole slab's content once per tile (40 tiles at 8192, 160 at 16384). The interesting number from the same run is `expBaseMask` at **1,320 ms** — nearly as expensive as the entire finished slab — because it reads the whole canvas back to convert it to luminance. Coverage masks are 53–79 ms each, `expIdT` 67 ms for both.
- **The clock restarts each export.** `expStat` starts the timer only when it is unset, and a finished export deliberately *freezes* it so the last time stays on screen — so a second export in the same page load used to count on from the first one's start. Reproduced: a 368 ms export reported `0:04`. That reached the recorded figures too — `ms.total` (render-only) and `ms.toPack` (the kit) are measured from that clock, so a second-in-session export inflated them; `ms.render` and `ms.encode` are timed independently and were never affected. Invisible to any test that reloads between runs, which is why the gate now runs its second export on the *same page* and requires the clock to read `0:00`.
- **Every encode failure settles.** Three places could leave a promise hanging for ever, and an export that hangs looks nothing like one that failed: the worker's `onmessage` is `async`, so a rejection inside it is an unhandled rejection *in the worker* and never reaches `w.onerror`; the same for any throw, including `new OffscreenCanvas` refusing the size; and the no-worker fallback called `b.arrayBuffer()` on the `null` that `toBlob` hands back when it cannot encode, so the throw was swallowed inside the callback and the executor had already returned. The symptom is an export stuck on *"Rendering 1 of 14"* with the **UI still responsive** — the main thread is idle, waiting. The worker now reports failures as messages, the fallback rejects, and the failure is shown on the status line where it **stays** rather than through `hint()`, which self-destructs after 2.6 s.
- **Large images do not go through the worker pool.** The pool needs **three** copies of an image where `toBlob` needs one: `createImageBitmap` snapshots the canvas, the worker's `OffscreenCanvas` holds a second, `convertToBlob` allocates the output. At 16384×10240 that is 640 MiB × 3 ≈ 1.9 GiB for a single image, and the export encodes `EXP_PEAK` of them at once. Anything over `ENC_BIG` (8M pixels) is encoded directly, one buffer at a time; the 2048-class images still parallelise.
- **`serialize()`** persists: `v(=1), fam, tool, view, layTiles, guidesOn, G, T, NEXT, nextId, layers[{key,label,bucket,on,op,warp,field,density,size,seed,haze,transmit,scatter}], soloLay, activeLayer, OVR, OVR_uv, perItem, hidden[], folders[], marks[]`. Not persisted: `selected`, `COL` (derived), `uvMode/lightSpectrum/spotOn` (reset on load), `layerSeq` (rederived).
- **`deserialize` — deterministic load.** A load is a **pure function of the slab**: it hard-resets `G`/`T`/`NEXT` to the captured pristine defaults `G0`/`T0`/`NEXT0` **before** applying the saved values (a key absent from the save falls to its default, never a leftover from a previous slab or a dirtied session), and **invalidates the render caches** — cloud/band/breccia signatures + the incremental-build cache (`last = null`). The harness renders each hero twice from a fresh `deserialize` to gate on exactly this (see [`gallery.md`](gallery.md)).
- **`deserialize` migrations:** retired family→carrara, retired tool→vein, drop `knot` marks, `gspecks/gsize`→micro plane, `fogHaze/fogSize/fogDensity`→fog plane, `COL`→`OVR`, `OVR_uv` normalized to lists (`v54` plain colour → `[{v:-1,c}]`, `v55` single `{v,c}` → `[it]`), folder defaults, always opens in daylight.

## 11. Pathological probes

Edge-case / "abuse it coherently" uses, surfaced by the fan-out and reasoned from code. Status: **✓verified** (rendered), **~predicted** (code-supported, not yet rendered).

| # | probe | prediction | status |
|---|---|---|---|
| P1 | Cross-family graft (vein X + branch Y) | branch character from own family, width from parent gauge — coherent graft | ✓ verified |
| P2 | Moon path reversed via Save/Load, `moonStrength=50` (unclamped) | mirrored wake, exaggerated anti-symmetric drift, no NaN | **✓ verified** — coherent violent drag, geometry stretched into the wake far past the slider |
| P3 | Echelon vein + `branches`=2.5 | branches slider is a **no-op** (echelon returns before minors); `defl` still applies | **✓ verified** — echelon shows only its offset segments, zero family minors ⚠ *fix candidate: disable/grey the branches slider for echelon* |
| P4 | `defl`/`fold` maxed, no speck field | **visual no-op** (hard `specks` gate, not gradual) | ~predicted (usability gap) |
| P5 | Boudinage branch on halo trunk | glowing halo trunk + rhythmic-pinch tributary compose (orthogonal per-mark `extra`) | ~predicted |
| P6 | Lens over back light | glass refracts + caustic-brightens the transilluminated glow (lens has no `!backlit` guard) | ✓ verified (back-light montage) |
| P7 | Spotlight `spotR=0.05` at an unauthored spectrum value | full blackout despite a full UV palette (both `emit` gates fail) | ~predicted (gap: silent) |
| P8 | `transmit=1` + `scatter=1` on a near-invisible layer | layer looks inert but **globally blurs the whole back-light accumulator** (scatter isn't masked to its coverage) | ✓ verified → **✓ FIXED**: scatter now masked to the layer's own coverage (`layerCov` + `destination-in`), so it diffuses only where the layer occludes |
| P9 | `warpDepth=1.5` on a deep branch chain | trunk planted (`d=0`), deep tips fly apart (`1/(1+d)²` anchor decays) — "root stays, tips drift" | **✓ verified** — deep tips fan out further while the trunk holds |
| P10 | Stacked ADJ maxima on one `id:` vein | oversized soft double-halo (filter/weight applied twice: shoulder + main stroke) + glow/blend | ~predicted |

Correction logged: one explorer flagged pour `pfling` as a *dead slider*; the source (`buildPour` L1490) reads it — it's **conditional** (fires only when `acc>3`), not dead.

**Two verified probes are genuine fixes, not just curiosities:** P3 (the `branches` slider silently does nothing for echelon veins) and **P8** (back-light `scatter` blurs the entire accumulator regardless of the layer's coverage — physically it should diffuse only where that layer occludes). P8 is the one worth correcting in the render before the hero.
</content>

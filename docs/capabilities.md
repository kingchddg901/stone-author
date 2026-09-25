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
- **An export reports itself for as long as it runs.** A status line under the File buttons counts the images, then packing, then saving, with a bar; the Export button is held disabled and restored in a `finally`. Before this the only signal was a `hint()`, which removes itself after 2.6 s — invisible at 1024, where the whole export finishes first, and useless at 16384, where minutes of blocked main thread looked like a hung page. Each step yields with `setTimeout` (**not** `requestAnimationFrame`, which stops firing when the window is backgrounded) so the line paints before the next render blocks. Gated by `harness/export-progress.mjs`, which requires the message to keep *changing* — a single message that never moves is the defect it exists to catch.
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

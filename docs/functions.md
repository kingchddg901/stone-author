# Function reference — `app/stone-author.html`

The functions of the authoring studio, grouped by subsystem. One inline `<script>`; line numbers
are anchors into it and drift as the file changes — the grouping and signatures are the stable part.
For *why* the pieces fit this way, see [`architecture.md`](architecture.md); for the colour engine,
[`colour-layer.md`](colour-layer.md).

Conventions: a **mark** `m` is a user action (`{id, kind, seed, samples|at|…, p, fam}`), where `m.p`
is the frozen `NEXT` settings it was drawn with. `out`/`geo` is the built geometry bag
(`{lines, byId, web, specks, styl, drusy, knots, grain, guides}`). `F = FAM[fam]` is the family
(character); `COL` holds colour + effect values. Frame coordinates are `0..1` across, `0..H` down.

---

## Randomness & seeding

A knob edits instead of re-rolls because every role draws from its own stable stream.

- `mulberry32(a)` — the PRNG; returns a `()=>[0,1)` generator. *(569)*
- `mix(...v)` — hash integers/seeds into one 32-bit seed (FNV-style). *(578)*
- `sub(...key)` — a seeded stream **pair** `[rand, gauss]` for one role (`mix`es the key). *(583)*
- `gaussOf(r)` — wrap a uniform stream into a normal-distribution generator. *(577)*
- `poisson(lam, r)` — a Poisson count by exact quantile of one uniform — **monotone** in `lam`
  (a higher rate never yields fewer). *(584)*
- `strHue(s)` — hash a string to a hue `0..359` (identity-view colours). *(595)*

## Paths & line geometry

- `smooth1d(n, scale, g)` — a smoothed 1-D noise track of length `n`. *(598)*
- `resample(P, step)` — even-arc-length resample of a polyline. *(609)*
- `smoothPath(P, h)` — smooth a polyline. *(628)*
- `handRoute(P)` — turn raw pointer samples into a clean route (resample → smooth → resample). *(689)*
- `roughen(knots, levels, sched, g)` — fractal midpoint displacement; `sched(L)` sets per-scale
  amplitude (the vein vs crack schedules). *(704)*
- `lineGeom(id, pts, gauge, F, M, seed, salt, extra)` — build a line: per-segment width, breaks,
  arc length, taper; applies `extra.press` / `extra.wmod` (boudinage) / `extra.lean`. *(720)*
- `at(L, t)` — point at fraction `t` along line `L`. *(748)*
- `tangent(L, t)` — heading at `t`, measured over a chord (not one rough segment). *(756)*
- `add(out, L)` — push a line into `out` and index it by id. *(760)*
- `sinuate(kn, seed, M)` — add a tapered low-frequency wave to a route (the *sinuous* variant). *(764)*
- `curvature(pts, chord, smooth)` — signed curvature along a path (fold strain, deflection). *(1101)*

## Pen input

Baseline is one pointer + time; pressure/tilt are opt-in enhancements read from the rest grip.

- `pressureReal(S)` / `pressFactor(S)` — is pressure present, and its along-stroke width factor. *(639/644)*
- `tiltReal(S)` / `leanProfile(S, rest)` — is tilt present, and lean from the rest grip along the stroke. *(658/671)*
- `restLean()` / `azOf(e)` / `leanOf(e)` — running rest-grip baseline; azimuth and lean from a
  Pointer Event. *(1912/1921/1927)*

## Tools — a mark becomes geometry

Dispatched by `applyMark(m, out)` on `m.kind`. *(1397)*

- `buildVein(m, F, out)` — the vein: route → roughen → `lineGeom`, family branches, and the
  per-line variant (sinuous / dendritic / echelon / boudinage / halo). *(779)*
- `buildBranch(m, F, out)` — a minor grown by tap or drag off a parent vein; honours the variant. *(831)*
- `buildStyl(m, out)` — a stylolite: the route becomes an interlocking toothy seam. *(901)*
- `buildWeb(m, F, out)` — a crack along the line plus a Delaunay web of cells that thins out. *(919)*
- `buildPour(m, out)` — the pour brush: specks thrown along the line (slow pools, fast thins, bends fling). *(1340)*
- `applyGravity(m, out)` — pull/push specks toward a point or line. Also the **fog sculptor**: when the
  mark targets fog (`m.tgt === 'fog'`) it retargets to `out.fog` — **push clears a window** in the haze,
  **pull gathers a resin pool** (its pull/push *is* the fog's polarity), leaving veins/specks untouched
  (zero smear). *(1194)*
- `applyMagnet(m, out)` — comb specks like iron filings along the pen's lean; retargets to `out.fog` when
  `m.tgt === 'fog'`, but it only rotates orientation, so round haze blobs show nothing (yet). *(1231)*
- **Selection** (`selected` = a set of token keys: `lay:<layer>` from a row checkbox, `id:<vein>` from a
  Tune/Select tap; `highlightSelected()` draws the dashed accent handle on selected veins, live-only, never
  exported; `registerSelectedColours()` registers a colour token per selected key, each inheriting its
  bucket — "selected for display") is what an effect scopes to; three effects bake onto the selected keys:
  (1) the **force tools** — `sculptTarget()` → a gravity/magnet mark's `m.tgt`, so they sculpt the selected
  particle field (Fog / specks), else the specks default (replaced the `fogSculpt` toggle; old `fogTarget`
  still reads); (2) **colour** — a generated `lay:<key>` token (`layToken(L)` derives key/label/type/
  `inherit`-bucket from the layer; `registerLayerColours()` registers only the *selected* layers so the
  editor stays parseable). Values live in the flat `OVR`; `vcol`/web read `OVR['lay:<layer>']` (per-id →
  per-layer → bucket); the `.selact` swatch writes them and `ed.values` re-syncs so an open editor won't
  clobber the write. (3) **warp** — *follow*/*hold* set the selected layers' warp weight; (4) **adjustment
  set** — `ADJ` (blur/hue/sat/bright/contrast/weight); `adjTokens(base,label)` generates the `<key>:<name>`
  number tokens per selected target; `adjOf(id,layer,bucket,name,def)` resolves one up the granularity
  (artifact→layer→bucket→default); `filterOf(...)` composes the five filters into a `ctx.filter` string
  applied per vein/web edge and per speck/drusy **field** (per layer, `OVR['lay:<layer>']` also gives a
  field its colour); `weightOf(...)` scales the stroke width via `runs`'s `wmul`. Fog is left untinted. Row
  select boxes drive membership. Fog is deep-copied in the incremental clone so a fog push never corrupts the base field.
- `knotGeom(m)` / `woodGrain(F, knots)` / `trace(x, y, sg)` — a wood knot, the grain field flowing
  around knots, and one traced grain streamline. *(1290/1293/1315)*
- `delaunay(P)` / `distTo(route, p)` — Bowyer–Watson triangulation and nearest-distance-to-route
  (web support). *(861/891)*

## Granite specks — a never-touch particle field

- `speck(r, g, x, y, t, o)` — construct one speck (position, size, elongation, jitter). *(969)*
- `cellGrid(items, cell)` / `forNear(g, cell, x, y, rc, fn)` — spatial hash grid and neighbour
  iteration. *(981/989)*
- `relax(sp, iters, hot)` / `settle(specks)` — relaxation so specks bunch but never overlap
  (active-set over a flat typed grid). *(1001/1055)*
- `pathIndex(pts, cell)` / `moveRadial(q, near, dNew, fx, fy)` — index a path for proximity; move a
  speck radially (gravity). *(1064/1092)*
- `deflect(kn, specks, mul)` — bend a vein route a few degrees around dense rock. *(1115)*
- `intrude(L, specks, M, route)` — push specks aside along a vein (crowded inside a turn, thinned
  outside). *(1148)*
- `groundFor(density, size, seed)` — one granite speck field for a `(density, size, seed)` key: minted
  once (fit-capped, then relaxed) and **cached per key**, returning fresh copies so a rebuild moves
  nothing a sibling already settled. *(1384)*
- `buildGround()` — the whole granite ground: the **union of every micro-bucket `field:'specks'`
  layer's** `groundFor(...)`, each speck tagged `s.layer` so it renders / warps / sculpts / colours per
  field. One field by default; many once you add **+ Granite layer**. *(1401)*

## Slab primitives — seeded fields on the base

Each is cached to an offscreen and rebuilt only when its inputs change.

- `buildClouds()` / `ensureClouds()` — tileable fBm mottle as a grey delta (soft-light modulator). *(469/492)*
- `buildBands()` / `ensureBands()` — directional tonal bands as a grey delta (soft-light). *(499/517)*
- `buildBreccia()` / `ensureBreccia()` — a jittered-Voronoi clast mosaic with a contrast matrix
  (opaque base setter). *(524/547)*
- `buildDrusy()` — crystal-pocket sparkle points, deterministic by index (density appends). *(552)*
- `buildFog()` — a flat, even grayscale **haze / resin core**: a jittered grid of heavily-overlapping soft
  particles (reads as a uniform sheet, not clumps), rendered deep under the veins at a low fixed grey and
  `G.fogHaze` alpha, never tinted. Family-independent (a defect, not character); off by default. Particles
  carry birth positions (`x0`/`y0`) so the magnet can push them into clear windows and pools. *(497)*
- `hexRGB(h)` — parse `#rgb`/`#rrggbb` to `[r,g,b]`. *(467)*

## Build pipeline

- `applyMark(m, out)` — dispatch one mark to its builder. *(1397)*
- `build()` — incremental (append the last mark to a cloned `geo`) when possible, else `fullBuild`; then
  `warpGeo`. The incremental path is skipped while warp is on so nothing is warped twice. *(1407)*
- `fullBuild()` — rebuild all geometry from `marks` in order (older rock first). *(1421)*
- `warpGeo()` — cloud-driven domain **warp**: displace every built point (veins/grain/specks/styl/drusy/
  knots) by `G.warp` along the cloud's fBm field, offset by `G.cloudX`/`cloudY` (the field is **moveable**,
  same offset as the cloud mottle) and **scaled per layer** by each layer's `warp` weight. `fbm2()` /
  `vnoise()` / `nz()` are that shared noise; the **Cloud** tool drags `cloudX`/`cloudY` (a `cloudpan`
  gesture). Branch warp is a **generation model** (`depthOf`: major n0, its branch n1, …): vein warp **rises
  with depth** (`1 + d·G.warpDepth`, the "Deep drift" knob), and a final **anchor** pass re-pins each line's
  root — the major to its own origin (`L._r0`), a branch to its parent's post-warp attach point (`L.at`) —
  over a ~4% rigid zone, with **bond strength `1/(1+d)²`** (inverse-square). Net: the trunk stays planted
  while each deeper generation pushes harder against a weaker bond, so tips wander off; `warpDepth = 0`
  collapses to coherent uniform warp. (The per-layer `warp` weight + "Warp holds major veins" toggle still
  gate whether a whole layer warps at all.) `warpGeo` runs **two warps** before the shared anchor pass: the
  gentle global field (above, when `G.warp > 0`) and every **moon** mark (below); `build()`'s incremental
  path is also skipped whenever a moon exists, so a moon always rebuilds. *(1421)*
- `applyMoon(m, W)` — one **moon**: a dragged local warp brush ("ball" of radius `M.moonReach`, force
  `M.moonStrength`). A **forward-warp** — each point's displacement is the ball's motion summed along the
  pass, weighted by a soft falloff (`1 − d²/R²`, 1 at the centre → 0 at the rim), computed from the
  point's original position and applied once — so within a pass it's **order-free**, and the reverse
  pass's *field* is the exact negative (cosine −0.999 on a clean base). That is **not** a workflow undo,
  though: moons apply in sequence onto already-warped geometry, so a stacked reverse leaves a residue,
  and repeated forward+reverse pairs *accumulate* (rms ≈ 0.026 → 0.042 → 0.055) rather than cancelling.
  A hand can't retrace a pass point-for-point regardless (sample rate alone shifts it) — the near-miss is
  the intended feel; the **Undo button** (drops the mark) is the real undo. Warps only layers whose
  `warp` weight is on; the anchor pass after still keeps a dragged branch from snapping off. Passes are
  marks, so they stack. *(1441)*

## Tile engine

Each pattern is a fundamental cell of polygons plus two lattice vectors, in inches for tile size `u`.

- `PATTERNS` — the pattern table (`u => {polys, ax, ay, overlap?}`), 15 patterns. *(1438)*
- `circlePoly(cx, cy, r, n)` / `versaillesModule(u)` / `cairoCell(u)` — the many-point and
  composite cells (penny/fish-scale, French, Cairo pentagons). *(1480/1483/1505)*
- `insetPoly(P, d)` — inset a polygon (grout, tumbled edges). *(1511)*
- `tileInstances()` — every tile polygon across the slab for the current pattern. *(1519)*
- `renderStoneOffscreen()` — bake the authored slab once to a reused offscreen. *(1546)*
- `chipEdge(poly, mk)` — replace one edge with a jagged inward bite (Chip tool). *(1557)*
- `drawTiles(F)` — lay the tiled floor: clip each tile, wrap the slab image, grout, edges, chips. *(1573)*
- `edgeFinish(poly, px)` — a lit chamfer (bevel / pillow / tumbled). *(1610)*
- `whichTile(fx, fy)` — hit-test a point to a tile and its nearest edge. *(1625)*
- `inFr(v)` — inches → frame units. *(1435)*

## Rendering

- `size()` — size the canvas to the element and device pixel ratio. *(1636)*
- `draw()` — one frame: ground/base fill, then `paintStoneContent` (or `drawTiles`), guides, live
  stroke, status. *(1643)*
- `paintStoneContent(ident, angleView)` — paint every layer in stack order
  (`base→breccia→clouds→bands→web→micro→drusy→styl→minor→major`), gated by layer visibility. The
  core of the renderer. *(1677)*
- `runs(L, colour, fixedWidth, alpha, shoulder)` — stroke a line in chunks (shoulder or core pass). *(1838)*
- `fxOn(key, colour, ident)` / `fxOff(s)` — set a layer's blend mode + colour glow around its paint,
  then restore. *(1669/1676)*
- `paintLive()` — the in-progress stroke. *(1659)*
- `ellipse(K, f, jit)` / `drawKnot(K, F, ident, op)` — knot rings and rim. *(1756/1767)*
- `drawScaleBar()` / `drawGuides()` — the scale bar and the gravity/magnet guide overlay. *(1778/1790)*
- `drawWarpGuide()` — the **warp field made visible**: samples the same `fbm2` displacement `warpGeo`
  uses, on a coarse grid, and draws each node's base displacement as a teal arrow (direction exact,
  length/opacity the field magnitude normalised to the grid max). Shown with the **Cloud** tool while
  `G.warp > 0`; rides `cloudX`/`cloudY`, and is a guide — never baked into an export.
- `idColour(id, t)` — identity-view colour for an id. *(1641)*
- `redraw(rebuild)` — schedule a frame on rAF (rebuild geometry if asked), then autosave. *(1858)*
- `stat()` / `clampView()` / `zoomAt(ex, ey, f)` / `hint(msg)` — status line, view clamp, zoom, hint. *(1866/1871/1877/1898)*

## Layers

- `layers` / `layAt(k)` — the layer list and lookup. Fixed passes use `key === bucket`; user layers use a
  `bucket#n` key. Each has `{key, label, bucket, on, op, warp}`. *(455)*
- `layVis(k)` — visibility, honouring solo (solo keeps `base` under the soloed layer). *(459)*
- `layOp(k)` — a layer's opacity. *(460)*
- `activeLayer` — the active layer per bucket (`{major, minor, web, micro}`); a mark files into
  `activeLayer[its bucket]` at commit. `addLayer(bucket)` appends a layer (grouped after its bucket's
  last) and makes it active — a new **micro** layer gets `field:'specks'` and its own density/size/seed;
  `setActiveLayer(key)` picks the active one. *(≈475/519)*
- `syncGranite()` — reflect the **active granite layer's** density/size into the ground sliders. The
  Specks/Speck-size sliders and **Reseed** all act on `activeLayer.micro` only, so each field is tuned
  independently. *(532)*
- `stampLayers(out)` — after every build, tag each line (`L.layer`) and web edge (`e.layer`) with its
  mark's layer, falling back to the bucket for legacy marks or a deleted layer. Render (`lk`) and both
  warps read this, so eye/opacity/warp are per-layer while export still buckets by kind. *(≈1590)*
- `buildLayerUI()` / `syncLayerUI()` / `relayer()` — build the Layers panel (eye · name=make-active ·
  solo · **W** warp-hold · opacity, plus the **+ layer** buttons), reflect state, and repaint. Rebuilt on
  `deserialize` so restored user layers reappear. *(2078/2094/2077)*

## Colour layer

- `OVR` / `COL` / `perItem` — the overrides the editor edits and we persist / the *resolved* values
  the renderer paints from / `id → layer bucket` for per-item (per-id) tokens. `COLOUR_TOKENS` /
  `FX_LAYERS` / `BLENDS` — the colour token list, the layers that carry blend/glow, the blend options.
- `seedColours(f)` — seed the colour **overrides** (`OVR`) from family `f`'s palette (never effects). *(389)*
- `recolour()` — resolve `OVR` → `COL` through the kit (fills defaults + `inherit`); the renderer reads `COL`.
- `setupColour()` — create the kit, register the Colour / Effects / Per-item groups, bind the adapter
  to `OVR`, resolve, mount the editor. *(2052)*
- `registerPerItem()` — (re)register the Per-item token group from `perItem`; each id **inherits** its layer.
- `groupTokens(prefix, ng, nv, label, inheritBase)` — build a nested primary/secondary token set:
  group `‹prefix›g` inherits `inheritBase`; variant `‹prefix›g.v` inherits the group. Capped 5×4.
- `registerSpeckGroups()` — (re)register "Speck colours" (`micro:g.v`, from `G.speckGroups`/`speckSubs`;
  a speck's group+variant are birth-position hashes `speck().u`/`.u2`) and "Drusy colours" (`drusy:g.v`;
  a drusy pocket is the group, its crystals the variants).
- `tuneId(id, bucket)` — the Tune tool's action: give a vein a per-item colour token that follows its
  layer until changed (reset returns it).
- `mountEditor()` — (re)create the `<theme-kit-editor>` so its inputs reflect `OVR`. *(2068)*

## Interaction

- `nearestLine(fx, fy)` — the nearest vein (for Branch tap/drag). *(1934)*
- `commit(m)` — push a mark (freezing `NEXT`/`fam` onto it) and rebuild. *(1987)*
- `end(e)` — pointer-up: build the right mark for the active tool. *(1988)*
- `commitHover()` — commit a hover trace (pen/mouse working above the slab). *(2028)*

## The source — save, load, restore

- `serialize()` — the stone source: `{v, fam, tool, view, layTiles, G, T, NEXT, layers, soloLay, COL,
  marks}`. *(2112)*
- `deserialize(o)` — restore a source (guards `v`), reseed colour, re-mount the editor, redraw. *(2118)*
- `writeLocal()` / `saveLocal()` / `tryLoadLocal()` — autosave (debounced + flush on hide), and
  restore on load. *(2132/2133/2138)*
- `syncUI()` — push all state into the controls after a load. *(2143)*
- `showGround()` — show/hide the family-specific ground panel. *(2104)*
- `download(name, text)` — a Blob download for Save (falls back when the `downloads` capability is
  absent). *(2158)*

## Export — one zip: masks, render, the rich set, `.ora`, SVG, source

`exportAll(W)` renders everything at `W` pixels wide (the slab keeps its 8×5 ratio) and packs it into a
single store-only zip. It prefers the `downloads` capability and falls back to `download()`.

- `crc32(u8)` — CRC-32 over a byte array (the zip checksum). *(2299)*
- `zipStore(files)` — a store-only (uncompressed) zip `Blob` from `[{name, data}]`. PNGs are already
  compressed and `.ora` requires stored entries, so nothing is deflated. Writes local headers, a
  central directory, and the EOCD by hand. *(2300)*
- `toU8(canvas)` — a canvas as PNG bytes (`toBlob` → `Uint8Array`). *(2313)*
- `expCanvas(W)` / `polyPath(cx, pts)` — an off-screen slab-ratio canvas; a polyline subpath. *(2314/2315)*
- `expCompleted(W)` — the finished slab, every layer baked in (what `render.png` holds). *(2316)*
- `expBaseMask(W)` — the base composite (ground + breccia + clouds + bands) flattened to luminance:
  the greyscale value map for the `base` bucket. *(2322)*
- `expCoverage(kind, W)` — white-on-black coverage for a consumer bucket (`major` / `minor` / `micro`
  / `web`); `minor` also stamps the stylolites, `micro` the specks and drusy. *(2333)*
- `expBucket(bucketKey, W)` — one bucket in colour, transparent elsewhere, by gating layers to that
  bucket — the layer PNGs inside the `.ora`. *(2343)*
- `expIdT(W)` — the rich pair: a vein-**id** map (each line an rgb-encoded index) and an
  along-the-vein **t** map (grey 0→255 head to tail), plus the `{index: id}` legend. *(2351)*
- `pathsJSON()` — the vectors as data: slab size in feet, then each line's `id / major / parent / at`,
  its points, and its per-sample widths. *(2360)*
- `linesSVG()` — the veins and stylolites as an SVG path drawing (a 1000-px-wide vector proof). *(2361)*
- `buildOra(W)` — an OpenRaster `.ora`: a nested zip with `mimetype` stored first, a `stack.xml`
  (top child = top layer), the five bucket layers under `data/`, and a `mergedimage` + thumbnail.
  Opens in Krita / GIMP / Photoshop. *(2368)*
- `exportAll(W)` — assemble `render.png`, `masks/{base,major,minor,micro,web}.png`,
  `rich/{vein-ids,vein-t}.png` + `legend.json` + `paths.json`, `lines.svg`, `source.json`, and
  `slab.ora` into one zip and hand it to the viewer. *(2382)*

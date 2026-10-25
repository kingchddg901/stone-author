# Function reference — `app/stone-author.html`

The functions of the authoring studio, grouped by subsystem. One inline `<script>`; line numbers
are anchors into it and drift as the file changes — the grouping and signatures are the stable part.
For *why* the pieces fit this way, see [`architecture.md`](architecture.md); for the colour engine,
[`colour-layer.md`](colour-layer.md).

Conventions: a **mark** `m` is a user action (`{id, kind, seed, samples|at|…, p, fam}`), where `m.p`
is the frozen `NEXT` settings it was drawn with. `out`/`geo` is the built geometry bag
(`{lines, byId, web, specks, styl, drusy, guides}`). `F = FAM[fam]` is the family
(character); `COL` holds colour + effect values. Frame coordinates are `0..1` across, `0..H` down.

---

## Randomness & seeding

A knob edits instead of re-rolls because every role draws from its own stable stream.

- `mulberry32(a)` — the PRNG; returns a `()=>[0,1)` generator. *(2472)*
- `mix(...v)` — hash integers/seeds into one 32-bit seed (FNV-style). *(2481)*
- `sub(...key)` — a seeded stream **pair** `[rand, gauss]` for one role (`mix`es the key). *(2486)*
- `gaussOf(r)` — wrap a uniform stream into a normal-distribution generator. *(2480)*
- `poisson(lam, r)` — a Poisson count by exact quantile of one uniform — **monotone** in `lam`
  (a higher rate never yields fewer). *(2487)*
- `strHue(s)` — hash a string to a hue `0..359` (identity-view colours). *(2498)*

## Paths & line geometry

- `smooth1d(n, scale, g)` — a smoothed 1-D noise track of length `n`. *(2501)*
- `resample(P, step)` — even-arc-length resample of a polyline. *(2512)*
- `smoothPath(P, h)` — smooth a polyline. *(2531)*
- `handRoute(P)` — turn raw pointer samples into a clean route (resample → smooth → resample). *(2624)*
- `roughen(knots, levels, sched, g)` — fractal midpoint displacement; `sched(L)` sets per-scale
  amplitude (the vein vs crack schedules). *(2639)*
- `lineGeom(id, pts, gauge, F, M, seed, salt, extra)` — build a line: per-segment width, breaks,
  arc length, taper; applies `extra.press` / `extra.wmod` (boudinage) / `extra.lean`. *(2655)*
- `at(L, t)` — point at fraction `t` along line `L`. *(2683)*
- `tangent(L, t)` — heading at `t`, measured over a chord (not one rough segment). *(2691)*
- `add(out, L)` — push a line into `out` and index it by id. *(2695)*
- `sinuate(kn, seed, M)` — add a tapered low-frequency wave to a route (the *sinuous* variant). *(2699)*
- `curvature(pts, chord, smooth)` — signed curvature along a path (fold strain, deflection). *(3038)*

## Pen input

Baseline is one pointer + time; pressure/tilt are opt-in enhancements read from the rest grip.

**The 20-stroke calibration feeds these.** It used to be measured, stored, displayed — and read by
nothing, while pressure sat on a fixed curve and tilt on fixed 9°/25° thresholds. `calProfile` is
declared beside the channels that read it rather than in the section that fills it: `let` has a
dead zone, and the cost of being wrong about reachability during init is the app not starting.
Verified by `tools/probe-pen-calibration.mjs`.

- `pressureReal(S)` / `pressFactor(S)` — is pressure present, and its along-stroke width factor.
- `penPress(p)` — **this hand's pressure, on this device.** `0.15 + 1.7p` assumes a hand that uses the
  whole sensor and the calibration's own note says they do not — a real one spends most of a stroke
  in the bottom tenth. The measured light/natural/hard remap the **input**; the output range is
  untouched, because how far a vein may thin or thicken is art direction and not a property of
  anyone's grip. Piecewise through the middle, so the natural stroke comes out neutral — every
  hand's light and hard are lopsided about it. Falls back to the old curve bit-for-bit when nothing
  has been measured. *(2575)* *(639/644)*
- `tiltReal(S)` / `leanProfile(S, rest)` — is tilt present, and lean from the rest grip along the stroke. *(658/671)*
- `restLean()` / `azOf(e)` / `leanOf(e)` — running rest-grip baseline; azimuth and lean from a
  Pointer Event. *(1912/1921/1927)*

## Tools — a mark becomes geometry

Dispatched by `applyMark(m, out)` on `m.kind`. *(8167)*

- `buildVein(m, F, out)` — the vein: route → roughen → `lineGeom`, family branches, and the
  per-line variant (sinuous / dendritic / echelon / boudinage / halo). *(2714)*
- `buildBranch(m, F, out)` — a minor grown by tap or drag off a parent vein; honours the variant. *(2766)*
- `buildStyl(m, out)` — a stylolite: the route becomes an interlocking toothy seam. *(2836)*
- `buildWeb(m, F, out)` — a crack along the line plus a Delaunay web of cells that thins out. *(2854)*
- `buildPour(m, out)` — the pour brush: specks thrown along the line (slow pools, fast thins, bends fling). *(3248)*
- `applyGravity(m, out)` — pull/push specks toward a point or line. Also the **fog sculptor**: when the
  mark targets fog (`m.tgt === 'fog'`) it retargets to `out.fog` — **push clears a window** in the haze,
  **pull gathers a resin pool** (its pull/push *is* the fog's polarity), leaving veins/specks untouched
  (zero smear). *(3138)*
- `applyMagnet(m, out)` — comb specks like iron filings along the pen's lean; retargets to `out.fog` when
  `m.tgt === 'fog'`, but it only rotates orientation, so round haze blobs show nothing (yet). *(3176)*
- **Selection** (`selected` = a set of token keys: `lay:<layer>` from a row checkbox, `id:<artifact>` from a
  Tune/Select tap — a **vein** (`nearestLine` → `id:L…`), a **web spread** (`nearestWeb` → `id:W<mark>`,
  any crack picks the whole spread) or a **stylolite seam** (`nearestStyl` → `id:S<mark>`); `segD` is the
  point-to-segment helper they share and the tap ranks all candidates by distance, nearest within 26 px wins;
  `highlightSelected()` draws the dashed accent handle on selected veins, web spreads **and seams**, live-only,
  never exported; `registerSelectedColours()` registers a colour + adjustment token per selected key, each
  inheriting its bucket (a web id inherits `web`, a seam id inherits `styl`) — "selected for display") is what
  an effect scopes to; three effects bake onto the selected keys:
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
- `delaunay(P)` / `distTo(route, p)` — Bowyer–Watson triangulation and nearest-distance-to-route
  (web support). *(861/891)*

## Granite specks — a never-touch particle field

- `speck(r, g, x, y, t, o)` — construct one speck (position, size, elongation, jitter). *(2904)*
- `cellGrid(items, cell)` / `forNear(g, cell, x, y, rc, fn)` — spatial hash grid and neighbour
  iteration. *(981/989)*
- `relax(sp, iters, hot)` / `settle(specks)` — relaxation so specks bunch but never overlap
  (active-set over a flat typed grid). *(1001/1055)*
- `pathIndex(pts, cell)` / `moveRadial(q, near, dNew, fx, fy)` — index a path for proximity; move a
  speck radially (gravity). *(1064/1092)*
- `deflect(kn, specks, mul)` — bend a vein route a few degrees around dense rock. *(3052)*
- `intrude(L, specks, M, route)` — push specks aside along a vein (crowded inside a turn, thinned
  outside). *(3085)*
- `groundFor(density, size, seed)` — one granite speck field for a `(density, size, seed)` key: minted
  once (fit-capped, then relaxed) and **cached per key**, returning fresh copies so a rebuild moves
  nothing a sibling already settled. *(3222)*
- `buildGround()` — the whole granite ground: the **union of every micro-bucket `field:'specks'`
  layer's** `groundFor(...)`, each speck tagged `s.layer` so it renders / warps / sculpts / colours per
  field. One field by default; many once you add **+ Granite layer**. *(3239)*

## Slab primitives — seeded fields on the base

Each is cached to an offscreen and rebuilt only when its inputs change.

- `buildClouds()` / `ensureClouds()` — tileable fBm mottle as a grey delta (soft-light modulator). *(469/492)*
- `buildBands()` / `ensureBands()` — directional tonal bands as a grey delta (soft-light). *(499/517)*
- `buildBreccia()` / `ensureBreccia()` — a jittered-Voronoi clast mosaic with a contrast matrix
  (opaque base setter). *(524/547)*
- `buildDrusy()` — crystal-pocket sparkle points, deterministic by index (density appends). *(2454)*
- `buildFog()` — a flat, even greyscale **haze / resin core**: a jittered grid of heavily-overlapping soft
  particles (reads as a uniform sheet, not clumps), a low fixed grey, never tinted. **Field-per-layer, like
  granite:** it unions every fog **plane** (`L.field==='fog'`), each with its own `haze` / `size` / `density`
  / `seed`, tagging each blob with its layer — so you can stack a deep dense resin core and a light surface
  veil at different depths. Off by default. Particles carry birth positions (`x0`/`y0`) for the magnet.
  *(≈668)*
- `syncFog()` — reflect the **active fog plane's** `haze`/`size`/`density` into the Fog sliders (the mirror
  of `syncGranite`; the sliders drive `layAt(activeLayer.fog)`, not `G`). *(≈654)*
- `addLayer(bucket)` also takes `'fog'`: a new haze plane (`field:'fog'`, own `haze`/`size`/`density`/`seed`,
  bucket `base` for export), added by the **+ Fog layer** button and reorderable in the stack like any
  content layer. *(≈568)*
- `sculptParticles(m, out)` — **layer-select sculpt**: the particles a force mark grabs are its *target
  layer's* field only. `sculptTarget()` returns the selected fog plane or granite layer's key (fog
  preferred), stored on the mark as `m.tgt`; `sculptParticles` picks `out.fog`/`out.specks` by kind and
  filters to `p.layer === m.tgt`. A bare `'fog'`/`'micro'` (legacy mark or the default layer) moves that
  default plane; a `#` key moves only its own plane. Works for granite layers too. *(≈1427)*
- `hexRGB(h)` — parse `#rgb`/`#rrggbb` to `[r,g,b]`. *(2272)*

## Glass — a lay-up, then a forming process

Material path 3. Two fields, and the order between them is the whole model: the ribbons are laid
onto the gather first, and only then is it drawn, spun, rolled or poured — **you cannot form what
is not there.** So the colour field is authored in gather coordinates and each process is an
inverse *map* back into them, never a direction the bands are derived from.

- `glassFlow(ox, oy, F, out)` — unit vector the melt was drawn along: the axis for blown, radial
  for spun, the roll for rolled, and `(0,0)` for poured, which was never drawn at all. *(6588)*
- `glassFormT(ox, oy, F, fv)` — **thickness in millimetres**, which is the field glass actually
  carries: ream along the draw, the crown's thinning and pontil boss, the roller's flutes. The
  inclusions are deliberately kept out of it, because the gradient is taken of this field alone.
  Called once per sample on a slab with no relief; where there is relief, `glassFormTG` is called
  instead and this is not called at all. *(6599)*
- `glassFormTG(ox, oy, F, fv, out)` — the same thickness **and both its slopes**, from one set of
  hashes instead of three. Every value line is `glassFormT`'s own, character for character, so the
  thickness it returns is bit-identical; the derivative lines are the chain rule alongside them.
  Twelve hashes where the finite difference cost thirty-six. The slopes feed `sl`, and `sl` is
  multiplied by `REL`, so the sampler calls this **only when relief is above zero** and takes plain
  `glassFormT` otherwise — until build `2026.10.22.173` the gradient was computed on every poured
  slab and then multiplied by zero. Both claims are gated: `tools/probe-glass-gradient.mjs` holds
  the thickness bit-identical over 8,000 points and the derivative to 1.6e-14 of a converged finite
  difference. *(6643)*
- `glassMelt(ox, oy, F, fv, out)` — what was *in* the melt. Bubbles are voids and thin the sheet;
  inclusions thicken it. Both are drawn out along the flow, so both are ellipses aligned to it. *(6687)*
- `glassBlob(gc, ga, F, out)` — **cookies on a cookie sheet.** Blobs thicker than the sheet wants
  to be, spreading until they run out and interweaving where their fronts meet. A disc is the easy
  case of the budget — area `π(r+d)² = start·πr²` gives `d = r(√start − 1)` exactly, no quadratic.
  On a jittered **grid**: the grid is what stops two landing on top of each other, the jitter is what
  stops it looking like a grid, and together they are what make it affordable — a point can only be
  reached from a ring or two away, so the cost is a fixed 9 or 25 however many blobs the sheet holds.
  Spreading dough **butts**, it does not stack, so the two-deep area is the overlap they were placed
  with and does not grow with the budget. *(6735)*
- `glassBlobDepth(d, rr, F)` — the ribbon's ramp with the disc's radius standing in for the corner
  radius, which for a disc is the same thing. *(6762)*
- `glassCellSDF(gc, ga, i, F)` — one ribbon as a **signed distance**: negative inside, positive
  outside, zero on its edge, so “is there glass here” and “how far is the nearest glass” are the sign
  and the value of one number and the shape cannot differ between them. A rolled ribbon is an
  **oblong** — square corners at 0, semicircular ends at 1. That single fact removes every straight
  edge the field used to have: equidistant between two *rectangles* is a perpendicular bisector no
  matter how round their fronts are, which is why rounding the fronts never touched the facets. *(6781)*
- `glassCellSpread(i, F)` — **how far this ribbon can afford to go.** It starts thicker than the
  sheet wants to be and thins as it covers more, so it stops when it reaches target: `start × A0` is
  the most area its material can cover. Dilating an oblong keeps the core and grows the radius, so
  area is a quadratic in `r + d` and this is its root — no search, one line per cell per frame.
  **This is what stops a slump**: not a distance anyone set, but running out. A ribbon that runs out
  leaves void for a neighbour that has not, and two fronts with different budgets do not meet
  halfway — which is where the curved joins come from. *(6800)*
- `glassDepth(d, i, F)` — how much glass ended up over this spot. Full through the middle, feathering
  over the last of the rim because rolled dough has no cliff edge, and down to `1/start` out at the
  limit of what it could afford. One ramp, because a rim and a spread are the same question twice.
  The rim is 16% of the corner radius: at 50% it ate a third of every ribbon and the sheet read as
  airbrush — visible at `start = 1`, where nothing can spread and the softness could only have been
  the rim. *(6773)*
- `penAxis(S)` — which way the pen is leaning, along the stroke. `leanProfile` answers how FAR from
  the rest grip; this answers which way, interpolated through cos/sin so it cannot spin the wrong
  way round the back at the wrap. Azimuth is `sample[5]`. *(6826)*
- `rollerPath(m)` — a drawn pass, with what the hand was doing at every point of it. **The tilt is
  signed against the path normal**: leaning across the pass tips one end of the face down, leaning
  along it resolves to zero. That is the whole of making the control mean the same thing on a curve
  as on a straight — the magnet reads azimuth as a world direction, which is right for a magnet and
  would make this change meaning every time the path bent. *(6847)*
- `rollerBake(m, H)` — the pass baked to a grid of **(along, across)** in feet, because
  nearest-point-on-path walks every segment — ~170 of them times 600k pixels, against ~170 times
  16k here. Across is SIGNED, which is what tells the two ends of the face apart. *(6874)*
- `rollerAt(B, cu, cvv, out)` / `rollerHand(B, s, out)` — where this point sits under the pass, and
  what the hand was doing that far along it. *(5485/5495)*
- `rollStampAt(s, v, op)` — which stamp is at (along, across). Both the straight roll and a drawn
  pass ask exactly this, so it is one function: two copies of a stamp layout would drift, and the
  drift would be invisible because both would keep producing stars. *(6935)*
- `starR(th, R)` — a five-pointed star as a radius per angle. Exact rather than fitted: between
  an outer vertex and the next inner one the edge is a straight **chord**, and a chord through polar
  points `(r1,0)` and `(r2,s)` has radius `r1*r2*sin(s) / (r1*sin(a) + r2*sin(s-a))`. It checks out at
  both ends by construction, which is why it needs no fudge factor. *(6817)*
- `rollStamp(x, y, op)` — what the roller pressed in. **C = πD**, so the circumference *is* the
  repeat along the roll — not a pitch anyone picks — and a stamp's angle around the roller is its
  phase inside that repeat, its position along the face where it lands across the sheet.
  **One, start down**: phase 0 is where the roller first touched the sheet, not the object's origin.
  On a piece shorter than C that choice decides which arc ever touches it — and therefore which
  band comes out bare — so the origin was deciding most of the composition by accident. If the piece
  is shorter than C the roller never completes a revolution, so a contiguous arc never touches it; with
  staggered stamps that arrives as a **band across the sheet with no marks**, which is the geometry
  being honest and not a gap to fill. Distinct from the flutes in `glassFormT`: those are
  circumferential grooves, so their pitch runs across the sheet and is genuinely free of C. *(6958)*
- `glassUnform(x0, y0, F, out)` — **undo every operation, last first**, arriving in the mould's own
  coordinates. Composition, not a sum: each op hands the next the frame it was applied in, which is
  the difference between blowing a stirred sheet and stirring a blown one. `spin` shears angle by
  radius, `blow` spreads from the centre, `roll` stretches one way and squeezes the other (area
  kept, so a roll lengthens a pattern without fading it), `stir` is the baked warp field. An empty
  list is a plain pour. *(7081)*
- `unformBodies()` / `compileUnform(F)` — **the same walk with the loop taken out, built from the
  walk's own source.** `glassUnform` is the largest single line item in a sample at 179 ns, and 19%
  of that is the loop and the branch dispatch rather than the arithmetic; hoisting `F`'s constant
  fields and keeping the loop was worth 0.68%, so unrolling is the only version of this that pays.
  `unformBodies` cuts the per-kind bodies out of `glassUnform`'s text and `compileUnform` emits them
  in chain order, each block opening with `const op=O[i]` so the body needs no substitution at all.
  Slicing rather than re-writing is deliberate: a hand-written generator would be a **second copy of
  the arithmetic**, which diverges the first time one copy is edited. It **checks itself** against
  the walk over a lattice and returns `null` on any disagreement, so a slicing failure costs speed
  and never a pixel. Two conventions in there are load-bearing: no brace character in a string
  literal, because every tool that lifts code out of this file finds the end by counting braces; and
  no spaces in the emitted source, because `check-i18n` reads a spaced statement as prose. Gated by
  `tools/probe-chain-spec.mjs`, which holds both halves — that it agrees, and that it is really
  building rather than silently falling back. *(7196)*

- `glassLay(gc, ga, F, out)` — which compartment is here, as an **integer label, never a mixture**:
  Carries the mould's SHAPE — strips, radial wedges, or **authored compartments** each with its
  own width, length and colour. A compartment shorter than its neighbours leaves a void, so the
  field has to be able to answer **-1, nothing was poured here**.

  THE SLUMP is what “partially set” means in practice: the barriers come off before the glass is
  hard, so the nearest poured rectangle creeps into any void — measured as a distance to every
  cell rather than a look left/look right, which gets the sideways invasion and a cell creeping
  past its own end from one piece of arithmetic with no axis favoured. What creeps is a LABEL, so
  two neighbours reaching the same void from opposite sides meet at a seam; what fades is the
  AMOUNT of glass, because a creeping edge is thin and thickness already sets the depth of a tint.
  A wedge mould is not a spin. A wedge mould is not a spin: a spin shears
  Sampling a label through a deformation cannot average, so two colours fold past each other and stay
  two colours with nothing enforcing it. Also the lay angle, the twist (a shear of the
  circumference by axial position) and the lap. **The lap is a stack, not a blend** — where two
  ribbons overlap the light crosses both, so the absorptions add and the seam goes *darker*. *(7291)*
- `paintGlassContent(ident, angleView)` — the painter: Beer-Lambert per channel over the thickness,
  which is why a thick sheet goes green down its edge. Says nothing in either diagnostic. *(7642)*

- `moonDisp(m)` — how far one moon pushed what was at a point. **One question, two askers**:
  stone warps its geometry through it, glass samples its field back through it, and lifting it out of
  `applyMoon` is what stops the two drifting — a stir that disagreed with the warp would be a
  second moon. *(3386)*
- `glassWarp(H, moons)` — EVERY warp - the whole-slab current and each moon pass - baked to one grid in **slab** coordinates, because `disp()`
  walks the whole pass: ~170 points times 600k pixels becomes ~170 times 16k. Measured at 0.45%% of
  peak against the function it stands in for. `null` when nothing stirred. *(7365)*
- `glassUnwarp(S, cu, cvv, out)` — **where the glass now here came from.** The baked field says
  where a point went and a field has no points to follow, so it is read backwards — the minus sign
  lives here, and it is the one thing about this that is easy to get the wrong way round. *(7391)*

The stir is probed by `tools/probe-glass-stir.mjs`, which checks the things reading cannot:
the sign, the slab-to-feet conversion, and the bake against the function it replaces.
Verified by `tools/probe-glass-lay.mjs`, which lifts `glassGather` and `glassLay` out of the source
and renders the lay-up field alone. It runs in Node because the app resisted being driven from a
browser pane: the pane stops servicing `requestAnimationFrame` when the desktop window is not in
front, and the redraw's `queued` guard then latches on a frame that will never run, so every canvas
read returns the one frame painted at load. That surfaced as twelve identical cells, which looks
exactly like a finding and is not one — **ablate any canvas probe** by painting something yourself
and asserting it gets overwritten. Shimming rAF after load cannot clear the latch; serving a copy
with the shim prepended *before* the app's script can.

Wood's functions are **not yet listed here**; that gap predates the glass path.
## Build pipeline

- `applyMark(m, out)` — dispatch one mark to its builder. *(3305)*
- `build()` — incremental (append the last mark to a cloned `geo`) when possible, else `fullBuild`; then
  `warpGeo`. The incremental path is skipped while warp is on so nothing is warped twice. *(3461)*
- `fullBuild()` — rebuild all geometry from `marks` in order (older rock first). *(3477)*
- `warpGeo()` — cloud-driven domain **warp**: displace every built point (veins/specks/styl/drusy)
  by `G.warp` along the cloud's fBm field, offset by `G.cloudX`/`cloudY` (the field is **moveable**,
  same offset as the cloud mottle) and **scaled per layer** by each layer's `warp` weight. `fbm2()` /
  `vnoise()` / `nz()` are that shared noise; the **Cloud** tool drags `cloudX`/`cloudY` (a `cloudpan`
  gesture). Branch warp is a **generation model** (`depthOf`: major n0, its branch n1, …): vein warp **rises
  with depth** (`1 + d·G.warpDepth`, the "Deep drift" knob), and a final **anchor** pass re-pins each line's
  root — the major to its own origin (`L._r0`), a branch to its parent's post-warp attach point (`L.at`) —
  over a ~4% rigid zone, with **bond strength `1/(1+d)²`** (inverse-square). Net: the trunk stays planted
  while each deeper generation pushes harder against a weaker bond, so tips wander off; `warpDepth = 0`
  collapses to coherent uniform warp. (The per-layer `warp` weight + "Warp holds major veins" toggle still
  gate whether a whole layer warps at all.) `warpGeo` runs **two warps** before the shared anchor pass: the
  gentle global field (above, when `G.warp > 0`) and every **moon** mark (below) — each point's displacement
  scaled by `warpMaskAt` (protected islands, below); `build()`'s incremental
  path is also skipped whenever a moon exists, so a moon always rebuilds. *(3408)*
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
  marks, so they stack. *(3398)*
- `gatherMasks()` — the **island** set, unioned from two sources: `G.warpMask` (programmatic / legacy discs)
  and every **Mask mark** the tool places (`{kind:'mask', at, r, p:{maskFeather, maskWin, maskSpec,
  maskInvert}}`). Returns `{x, y, r, feather, invert, show}` discs. `invert` picks the disc's **sense**
  (false = protect, true = a window into chaos). `show` is the reality-window light: a spectrum value, or
  `null` for no window — a tool mask with `maskWin` on resolves to its own `maskSpec`, and a mark saved
  before `maskSpec` existed falls back to `0` (daylight), so old slabs keep their meaning. A `G.warpMask`
  entry carries `show` directly (`'show' in e ? e.show : null`). `warpGeo` caches the set in `_wmask` before
  it warps; the render reads it live for windows.
- `warpMaskAt(x, y)` — the warp-authority lookup over the cached `_wmask`: a 0–1 multiplier that both warps
  multiply their per-point displacement by, the global field **and** every moon. Each disc is **1 inside
  `r`**, smoothstepping to **0 across `feather`**, **0 beyond** — the two senses then read that ramp
  opposite ways:
  - **protect** discs multiply the running product by `1 - a`, so a region holds **normal** while the rest
    distorts: a cauterised scar, a burn, an *island of normalcy*.
  - **chaos** discs (`invert`) are unioned (`max`), and the product is multiplied by that union. So the
    moment one exists the slab holds still **everywhere except** inside their union — a window onto the only
    part still churning. With none placed the union is skipped entirely and the result is bit-for-bit the
    protect-only arithmetic, which is why existing slabs are untouched.

  Because it is one product, the two compose with no special case: a protect disc inside a chaos disc is a
  calm eye in the storm. The shared **anchor** pass is deliberately **not** masked, so a line whose root lies
  outside a mask still re-pins its first ~4%; the mask shapes the *field* warp, not the root bond. *(3370)*
- `renderSlabTo(w, h, tf, coatScale, spec)` — paint the **current** geometry once more into a fresh canvas at a
  given transform and **light spectrum** `spec` (`uvMode` derived as `spec !== 0`), coat and all. The machinery a
  reality window needs to show one region under a different light without re-authoring. Saves/restores `g2d`,
  `lightSpectrum`, `uvMode`. Calls only `paintStoneContent`/`applyCoat`, never `renderFull` — so no recursion.
- `compositeWindow(target, win, w, h, tf, coatScale, cx, cy, kr)` — feather one island's `renderSlabTo` in
  through its disc (a `destination-in` radial: solid to `r`, fading across `feather`) and draw it onto `target`.
- `applyWindows(canvas, W)` / `applyWindowsScreen()` — run every reality-window island onto a finished render:
  `applyWindows` on an export canvas (full-slab transform, `0..1 → 0..W`) — called at the end of `renderFull`,
  `renderTiled` and `renderTiledParallel`; `applyWindowsScreen` on the live `ctx` at the view transform, from
  `draw`. A no-op unless a mask carries a `show`. This is why *island of normalcy = daylight through a UV/psyker
  view* is authored in SA, not hand-composited afterwards — and since `show` is the island's own `maskSpec`,
  the window can look out on any light, not only daylight.
- `drawMaskGuides()` — the Mask tool's dashed rings (solid at `r`, faint at `r+feather`), plus the live disc as
  you drag. Colour carries both bits at once via `maskCol(win, inv)`: amber = protects, rose = window into
  chaos, and the lit pair (teal / magenta) means that disc also shows through. Guide-only, never exported.
  *(draw, tool === 'mask')*

## Tile engine

Each pattern is a fundamental cell of polygons plus two lattice vectors, in inches for tile size `u`.

- `PATTERNS` — the pattern table (`u => {polys, ax, ay, overlap?}`), 13 patterns. *(4787)*
- `patternOf(u)` — the ONE lookup into it. A slab records `T.pattern` by name, so one naming a
  pattern this build does not have falls back to square rather than calling undefined.
- `cairoCell(u)` — the composite cell (Cairo pentagons). *(3556)*
- `insetPoly(P, d)` — inset a polygon (grout, tumbled edges). *(3562)*
- `tileInstances()` — every tile polygon across the slab for the current pattern. *(3639)*
- `renderStoneOffscreen()` — bake the authored slab once to a reused offscreen. *(4011)*
- `chipEdge(poly, mk)` — replace one edge with a jagged inward bite (Chip tool). *(4083)*
- `drawTiles(F)` — lay the tiled floor: clip each tile, wrap the slab image, grout, edges, chips. *(4260)*
- `edgeFinish(poly, px)` — a lit chamfer (bevel / pillow / tumbled), each edge shaded by its outward
  normal · the shared light `G.lightAngle` (highlight facing the light, shadow away). *(4265)*
- `setLight(f)` / `drawLightGuide()` — aim the shared light from the slab centre toward `f` (the Light
  tool's `lightdrag`), and draw the little sun marker at the slab edge in the light's direction.
- `lightRGB()` — the light's colour from `G.lightTemp` (warm amber ← neutral warm-white → cool blue). The
  tile-edge highlights tint to it; neutral (0) = the old look.
- `specRGB()` — **what the specular is made of.** A dielectric — stone, glass, varnish — reflects the
  *light's* colour, so its highlight is near white; a metal reflects *its own*, and that one difference
  is most of what separates gold from yellow paint. `G.specMetal` leans the sheen and the glint from
  `lightRGB()` toward the `specTint` colour token (gold by default; it also serves silver, copper,
  bronze). At 0 it returns `lightRGB()` to the integer, so every slab already on disk paints unchanged.
  Measured on a gold-brown slab: switching the specular on at Metal 0 lifts the frame by **+16 R, +20 G,
  +28 B** — most in blue, which is the desaturation that reads as paint — and Metal 1 takes blue back
  down by 20 with red untouched. The tile-edge chamfer deliberately keeps reading `lightRGB()`: that is
  geometry catching the light, not a surface reflecting it, and tinting it would gild the grout.
  *What it does not do* is the dark side: real gold goes red-brown in shadow, and the body colour
  here is whatever the ground token says. That is a value ramp, not a tint, and is not built.
- **Per layer, so only the vein is gold.** `L.metal` (0–1, authored on the Selected bar beside Pass
  and Scatter) makes the coat run **one pass per colour**, each kept to its own side of a mask: the
  light's colour everywhere, the tint's colour where the metal layers painted. The mask is the
  layers' own geometry re-drawn through `drawLayerArtifacts` under the transform the content was
  painted with — read off the context at the top of `applyCoat` rather than reconstructed, so it is
  right on the preview's panned and zoomed view and on an export tile's offset alike, and no call
  site passes anything. Feature layers only: the ground is a fill and has no geometry to re-draw.
  Measured as the share of pixels that move by more than 3: **global metal 53.3%**, metal on the
  major veins alone **0.95%**, on the minor veins alone **0.68%**, and major-against-minor **1.56%** —
  so the two are genuinely different regions, not the same mask twice.

  With no metal layer the coat takes the **original** path, not the masked one routed through a
  scratch buffer, and that is deliberate: the gradient would be quantised to 8-bit premultiplied
  twice, which measured 6 levels against the shipped build on a slab with no metal in it. Verified
  against a preview built from the shipped file: **mean 0, max 0**, where two renders of the same
  build also differ by 0 and the two ablations (a gold vein, 38; global metal, 51) show the
  comparison can fail. The same differential caught a second one: building the glint before the
  sheen instead of after looks like pure tidying — it only touches its own scratch — but the glint
  is a difference-of-blur **of `tcv`**, and the sheen is part of what it reads.
- `tileInstanceAt(fx, fy)` — hit-test a point to the tile **instance**: its lattice position and, above
  all, its `shift`, which is where on the slab it was cut from. *(4285)*
- `whichTile(fx, fy)` — the same hit test, reduced to a key and a nearest edge (what Chip wants). *(4292)*
- `inFr(v)` — inches → frame units. *(3497)*

### Sections — a floor laid from more than one slab

- `applySlabState(o)` — everything that IS a slab, and nothing that is the screen. Split out of
  `deserialize` so something other than a *load* can put a slab into the engine. The loader keeps the
  half that fills the name field, arms Move, un-presses UV and remounts panels — none of which may
  happen while a tile is being baked. *(9213)*
- `withSlab(rec, fn)` / `withSlabs(recs, each)` — **paint something that is not the current slab, and
  leave no trace.** The snapshot goes through `serialize()` because that is already the complete
  definition of what a slab is — anything it forgets is a bug in *saving*, one place, rather than a
  second list to keep in step. The restore is in a `finally`: if a bake throws, the user's own slab
  still comes back. The plural takes one snapshot around a whole run instead of a pair per section.
  *(7498/7506)*
- `sectionFromHere(name)` / `sectionFromWoodCut(e, base)` — a section is the slab as it stands, named,
  with `sections` stripped from the embedded record for the obvious reason. A **kept cut reads forward**:
  it was only ever “this slab with these wood settings and these three colours”, so it becomes exactly
  that against the record it loads beside. *(3328/3336)*
### A tile, taken as a section

*Select one particular rhombus on a tiled stone panel and keep that — its shape and the place it was
cut from — as a source the floor can be laid from later.*

A tile already **is** a window on the slab: `poly - shift` is exactly where it was cut, computed for
every tile and until now folded into the blit offset and discarded. The painter is a function of
position, so that window can be rendered on its own — measured in all three materials, painting only
the box with slab coordinates kept and the transform magnified is **pixel-identical** to cropping it
out of a full slab render (mean 0, max 0), and the same comparison against the real offscreen band is
also mean 0. Moving the window 0.12 of a slab width gives mean 50.9, and painting the whole slab
instead gives 22.3, so the comparison is not vacuous.

It is not a saving, it is **resolution**. A 14″ rhombus gets 77 × 44 pixels of a 700 × 438 band today
and is stretched over a far larger tile; windowed into the same band it gets 700 × 404 — **9.1×
linear detail, for 256 ms against 275 ms**, slightly *cheaper*, because fewer veins cross a small box
than cross a whole slab. The cost of a floor is unchanged and is about section **count**, not cutting:
the band canvas already shrinks as sections grow (`cw = max(700, SW/√st)`) so the pixel budget stays
flat. Windowing per *section* is free; windowing per *tile* would not be.

- `cutBoxFromInstance(t)` — the window, in slab units, **wrapped and clamped into the slab**. A tile's
  window drifts with kerf and shuffle and can sit past the slab edge, where `drawTiles` wraps it — but
  a window render cannot wrap, and outside the slab rectangle the painter has nothing to say, so an
  unclamped box comes back as bare background. Wrap the origin, then pull it in until the box fits.
  *(3687)*
- `cutScale(cw, bandPx, box)` — how big the cut is painted: uniform (never distorted) and the tighter
  of the two ratios, so the box lands inside its band however long and thin the tile is. *(3698)*
- `coverSrc(sw, sh, dw, dh)` — **cover, never stretch.** A cut is one tile's box and the tiles it is
  laid into need not share its shape — a cut from a standing diamond can land on a laid one — so it
  crops and centres instead of distorting, and when the two shapes agree it uses the whole box with no
  offset at all. *(3703)*
- `picking()` — **selecting tiles and composing with them are two modes, and the app ran them at
  once.** The first snag laid the whole floor from the tile just taken, which removed the thing you
  were selecting *from*: a second tap could only re-take the first cut, and the set could never grow
  past one. While Snag is armed the floor shows the live slab and the sections are set aside, so
  every tap picks off the original material; leave the tool and the composed floor returns. Nothing
  is persisted by it — it decides which picture is on screen, not what the slab is. Arming or leaving
  it invalidates the baked offscreen, or the mode flips and the picture does not.

  The source lookup and the list append are **different questions** and sharing one answer cost the
  append: `SRC` is empty while picking, the list is always the real one. Appending to the
  picking-empty copy made every tap replace the set. Measured after: four taps give 1, 2, 3, 4
  sections with four distinct cut boxes, and leaving Snag returns a stage of 4.
- `cutsHeld()` / `syncTileLocks()` — **once a cut is taken, the geometry it was measured against is
  fixed.** A cut is a box in slab units derived from one tile's outline at a given pattern, size and
  kerf; change any of those afterwards and the same box is reinterpreted against a different shape —
  a rhombus cut poured into a hexagon — which renders without error and is wrong. Those three
  controls disable while any section carries a cut, and the note says why. They are interchangeable
  among themselves until then, and clearing the sections unlocks them. Grouping stays free: it
  decides which section goes where, not what shape a tile is.

  **A whole-slab Keep does not lock anything** — only a cut does, because only a cut has tile
  geometry baked into it. Measured: 0 of 12 patterns disabled after a plain Keep, 12 of 12 after a
  cut, 0 again after Clear. The cut also records its `pattern`, `sizeIn` and `kerfIn`, so a mismatch
  is detectable and not merely preventable.
- `snagTile(fx, fy)` — the Snag tool. The slab it records is the one that tile is **showing**, not the
  one on the controls: once a floor is laid from sections the tile in front of you is section
  `sectionOf(t)`, and keeping the live slab would hand back a different stone from the one pointed at.
  Snagging a tile that is *already* a cut carries its box across rather than re-measuring a tile
  against an already-magnified band. *(3812)*

A cut section's band **is** the tile, so `drawTiles` has nothing to wrap and no shift to apply: one
draw, the band's box covering the tile's box. That is what makes every tile laid from the cut show the
same piece rather than walking across the slab. Bands are now clipped to their own row — a full-slab
transform exactly filled its band so nothing ever needed it, but a cut band is the slab magnified ~9×
and the rest of it would land in the neighbours. Measured: the stone painter overshoots its slab by
**64 px**, so the clip also stops a bleed into the next board that was there all along; glass and wood
are clean.

Pinned by `tools/probe-cut-section.mjs` — 17 claims over 12 patterns × 5 sizes, each re-run with the
fix removed, because a guard that cannot be made to fail is not evidence that anything is guarded. The
one case where an ablation *cannot* apply is stated rather than waved through: an overlapping pattern
is never pushed apart, so its shift is identically zero and every tile already samples one position.

### The export's worker pool

The TIFF export paints its render tiles on a pool when — and only when — the serialised core
reproduces the picture exactly.

- `corePaintsThis()` — the predicate: daylight, no reality window that shows, no back light, and
  `Worker`/`OffscreenCanvas` present. `renderOneTile` fills **`UV_GROUND`** under black light where
  the core fills `UV_DARK`, and it composites **reality windows** per tile, which the core cannot —
  the comment beside that records that every tiled master written before *that* fix was missing its
  islands. Porting `compositeWindow` and `renderSlabTo` into a worker is a much larger job on the one
  path in this app with a history of writing plausible, wrong, 10 GB files, so the predicate refuses
  instead. Verified to refuse: black light and back-light-with-tiles-off both fall to sequential, and
  daylight comes back to the pool afterwards rather than latching.
- `tilePool(W, p)` — a bounded look-ahead over the render grid. Tiles are consumed **in order**,
  because the stats, the timing and the blank-tile retry all read in sequence; the win is having the
  next few already in flight. Concurrency is `min(cores, 8, budgetMB / tileMB)` — the plan's memory
  arithmetic was written for one tile at a time and N in flight multiply it — and it returns `null`
  below two workers, since one worker is slower than none.
- The core gained `keepBleed`, so the worker hands back the bled tile exactly as `renderOneTile`
  returns it. Cropping in the worker and re-offsetting in the export would be the same arithmetic in
  two places.
- **The retry is always on the main thread.** A worker that handed back an unallocated backing is in
  no state to be asked again, and the point of the retry is to get the tile.
- The metadata records `workers`; absent means it painted on this thread.

Verified byte for byte: at 2048 wide forced to 512 px tiles — 12 render tiles — every tile from the
pool is identical to `renderOneTile`, 0 differing bytes, worst level 0. Painting those 12 took
2,509 ms on the pool against 8,748 sequential, **3.49×**, at the tile size that punishes the pool
most.

### Three slabs at once — one material per file

A slab file carries stone, wood **and** glass, so a plain Load replaces all three: open a wood and
its stone comes with it, over the stone you were working on. That is correct for a load, and it is
why three materials could not be held and edited at once.

- `MAT_PART` — the partition. **Stone keeps the layer spine with it**, because a mark names its layer
  by key and taking marks without layers strands them on layers that are not there: `marks`,
  `nextId`, `fam`, `layers`, `soloLay`, `activeLayer`, `perItem`, `hidden`, `folders`, plus the seven
  stone tokens. Wood and glass are one object each plus their own tokens, and bring no layers.
  Everything else — the coat, the light, the tiling, the shared `ground` — belongs to the slab rather
  than to a material and is never touched.
- `loadMaterialFrom(o, mat)` — start from what is here, replace one slot. A token the file does not
  set is **cleared**, not left behind; leaving it would blend the palette being loaded with the one
  being replaced.
- `materialOnly(mat)` — the mirror. The slab with the other two taken out, but still a **valid slab**:
  `marks` stays present (empty for wood and glass), the layer spine travels, the coat and tiling come
  too, so the file opens on its own with plain Load. A fragment only one code path can read is a
  format, not a save.

Measured on three real slabs — a 666-mark granite master, a wood authored over it, and a 13-mark
carrara glass:

```
plain load HERO          marks 666  fam granite  glass-ops 2  wood-plane 0.27
plain load General Wood  marks 666  fam granite  glass-ops 3  wood-plane 0.27
plain load glass         marks  13  fam carrara  glass-ops 8  wood-plane -10.56   <- the 666 gone

into the STONE slot      marks 666  fam granite  glass-ops 8  wood-plane -10.56
into the WOOD slot       marks 666  fam granite  glass-ops 8  wood-plane 0.27
into the GLASS slot      marks 666  fam granite  glass-ops 8  wood-plane 0.27     <- all three
```

And the save round-trips: a wood-only file is `material: wood`, 0 marks, no glass object, no stone or
glass tokens, 17 layers. Wreck the wood to `plane 99`, load the file back, and `plane 0.27` returns
while the 666 marks and 8 glass ops are untouched.

### The section list, and the tile setter

Sections were data with no face: a count, a Keep button and a Clear button, so the only way to tell
one from another was to delete the lot and start again.

- `drawSectionList()` — one row per section: a material swatch, an editable name, up/down, and drop.
  Order is load-bearing — it is the order the floor hands sections out in.
- `drawSetter()` — **the motif is a seed: fill it in and the floor repeats from it.** The block drawn
  is 2×2 cells, not one, because a slot is a shape *type* times a cell *parity* and 2×2 is exactly the
  period in which every slot appears — for every pattern, with no per-pattern table to keep. Click a
  cell, choose a section (or *Choose for me*), and every tile at that cell follows.

  **A seed cell is finer than a slot**, which is why it replaced it. Under the hexagon grouping the
  slot *is* the orientation, so all four cells of a given `pi` take the same section and no rule can
  separate them; the seed can. Measured on rhombus — 12 cells, 3 polys × 2 × 2:

  ```
  rule only   0:0:0 → 0   0:0:1 → 0   0:1:0 → 0   0:1:1 → 0
  with seed   0:0:0 → 2   0:0:1 → 0   0:1:0 → 1   0:1:1 → 0
  ```

  Each cell key resolves to exactly **one** section across every instance on the floor — that is the
  repeat — and an unfilled cell still answers to the grouping.
- `T.seedMap` / `seedKey(t)` / `seededSection(t, N)` — keyed `pattern:pi:m%2:n%2`, and deliberately
  *not* by grouping: the same block of tiles means the same thing whichever rule would otherwise have
  filled it. Checked before every rule in `sectionOf`. A section that is dropped leaves its cells to
  fall back rather than stranding them, exactly as a slot pin does.
  `T.slotMap` is still read, so slabs saved while the setter wrote slots keep their pins, but the
  setter writes the seed now.
- `T.slotMap` — `{ "<pattern>:<grouping>": { "<slot>": "<section id>" } }`, keyed on the grouping as
  well as the pattern because a slot number means a different position in each: rosette n2 and
  hexagon n2 are not the same tile. Stored by the section's **id**, not its place in the list, so
  reordering moves the sections and not the assignment — verified: with slot 1 pinned to the third
  section the slot reads `2` where the derived rule gives `1`, and after that section moves to the
  front it reads `0`. An id that no longer resolves falls back to the derived pick, so dropping a
  section leaves the floor whole instead of stranding a slot.
- `pinnedSection(R, slot, N)` — the lookup, also applied on the plain-cut path under the key
  `<pattern>:cut`.

Pinning two slots of one motif to the same section is allowed. The no-repeat rule exists to stop an
*accidental* repeat; a deliberate one is the user's to make.

### Groupings — which tiles may not repeat a section

A pattern declares one or more **groupings**. A grouping is a motif — the set of tiles that must not
repeat a section — plus the slot each tile takes inside it. `T.grouping` picks one by key and falls
back to the pattern's first, so a slab saved before there was a choice lands where it always did.
The control appears only where a pattern has more than one.

The rhombus has two, and they are the same five tiles read two ways:

- **rosette** (5 slots) — a standing diamond and the four laid ones touching it. Rosettes **overlap**:
  measured, every interior laid tile belongs to exactly two.
- **hexagon** (3 slots) — three rhombi, one per orientation. Hexagons **partition**: every tile
  belongs to exactly one of a given handedness. The slot is simply the orientation, and because each
  hexagon takes one of each, the rule holds for both handednesses at once.

**The rosette is two hexagons sharing the standing diamond** — 3 + 3 − 1 = 5, which is where its five
comes from. Measured on the app's own `tileInstances`, 41 of 41 interior standing diamonds lie in
exactly two hexagons, at `0@(0,0) + 2@(0,0)` and `0@(−1,0) + 2@(−1,1)`, whose union is exactly five
tiles and whose only shared tile is the diamond.

Three sections then draw the isometric cube, **which was not reachable at all**: below the rosette's
five, `sectionOf` fell through to the plain-cut lattice cycle and all three orientations landed on all
three sections. Of 242 hexagons the hex grouping repeats a section in 0; the plain cut repeats in 121.

**A section never meets itself across an edge** under the hex grouping — 0 of 333 edge-sharing pairs,
at every count from 3 to 8 — because two rhombi that share an edge always differ in orientation, so
they differ in slot, so they differ in slot *class*, and sections are handed out by class. Nothing
has to be checked for it. The same measurement on the rosette grouping returns 153 at N=3 and N=4,
where the rule cannot apply, so the zero is not vacuous.

- `GROUPS` / `rosetteOf()` / `sectionOf(t, N)` — **which section a tile is cut from.** One rule: no slot may
  repeat inside a rosette. A slot is a position TYPE, not a position — octagon-or-square × cell
  parity (5), standing / laid-by-*n* / laid-by-*m* (5), pentagon orientation (4) — which is what lets
  a shared tile keep one identity while every centre still sees a full set.
  **The two rhombus orientations are split by different axes, and that is the whole of it.** Measured
  off the real lattice, the neighbours of the standing diamond at (*n*, *m*) are pi 0 at (*n*−1, *m*)
  and (*n*, *m*), and pi 2 at (*n*−1, *m*+1) and (*n*, *m*): the pi-0 pair shares *m* and differs only
  in *n*, the pi-2 pair differs in both. Splitting both by *m* — as it shipped until build
  `2026.10.11.23` — gave the two pi-0 neighbours the same slot and **every** rhombus rosette four
  sections instead of five. It survived because `probe-rosette.mjs` laid its own tiles at
  *m*·ax + *n*·ay while `tileInstances` lays them at *n*·ax + *m*·ay, and under that exchange the
  broken rule reads clean. The probe now asserts the app's convention, lifts the rule instead of
  keeping a copy of it, and carries the retired rule as a standing ablation.
  A rotating window per rosette cannot work: a square belongs to four octagons, so it has no single
  rosette to take a window position from. Instead section *s* belongs to slot class *s mod k*, so two
  slots can never reach the same section and the rule holds by **construction**; the extra sections
  are still used, because slot *i* cycles through `{i, i+k, i+2k, …}` across the floor.
  Below *k* sections the rule is unsatisfiable, so it falls back to a plain cut **and says so**.
  Verified by `tools/probe-rosette.mjs`. *(3945)*

**Slots per fundamental cell**, which is what a per-slot selector would key on: 1 for square, plank,
rect, subway, hex and diagonal; 2 for triangle, herringbone and octagon;
3 for rhombus; 8 for cairo and basketweave. A fixed slot map can only express
*sections = slots*; anything else needs the assignment to step per cell, and the floor then repeats
every `lcm(sections, slots)` cells.

## Rendering

- `size()` — size the canvas to the element and device pixel ratio. *(4301)*
- `draw()` — one frame: ground/base fill, then `paintStoneContent` (or `drawTiles`), the coat passes in order
  (emission bloom in uv · **subsurface** · **specular** · **lens**), guides, live stroke, status. *(5377)*
- **Subsurface** (`G.subsurface`, coat tier v1) — a post-pass in stone view: build the feature **high-pass**
  in the `ssC` scratch canvas (`stone` composited with `difference` against a blur of itself, so flat areas
  are ~black and only veins/specks/edges survive), `multiply` it warm, then add it back over the stone with
  `lighter`. Because flat regions contribute ~0 it never white-outs, on light or dark stone; features glow
  warm like light through a thin translucent sheet. One `Subsurface` ground slider (0 = opaque, 0–2). Tunable v1.
- **Specular top-coat** (`G.specular`, `G.lightAngle`, coat tier v1) — a post-pass after subsurface: a soft
  warm-white radial gloss hotspot placed toward `lightAngle` off the slab centre, `screen`-composited at
  strength `G.specular`, so a movable sheen sweeps the polished surface as the light moves. The **one light**
  (`lightAngle`) is shared — tile-edge relief will read the same angle. `Specular` / `Light angle` ground
  sliders, plus a **feature glint**: the feature high-pass in `ssC`, masked by the same hotspot radial
  gradient (so features glint only where the light sweeps) and `screen`-composited — veins catch the light.
- **Spectrum engine** (`lightSpectrum`, `OVR_uv` = key → **list** of `{v,c}`, `emit(id,layer,x,y)`, `beamPts`, `SPX_TOL`) — a
  stone-view mode when the light is off daylight (`uvMode = lightSpectrum !== 0`). The base fills near-black
  (`UV_DARK`), daylight body layers + coat passes are skipped, and `emit` returns an artifact's emission `c`
  **only when `|lightSpectrum − v| ≤ SPX_TOL`** (index match) **and** (if `spotOn`) it's inside the beam —
  per-point for specks, `beamPts(pts)` for lines; else it falls to `UV_DARK`. An additive **emission bloom**
  glows the result (safe on the black ground). The Selected swatch writes `{v: lightSpectrum, c}`. `setSpectrum`
  moves the dial (Black light = −1); `setLight` sets the beam position `G.lightX/lightY`; `drawLightGuide`
  shows the beam ring under `spotOn`. `OVR_uv` serialises with the slab; a load opens in daylight; v54 saves
  (plain-colour `OVR_uv`) migrate to `{v:−1, c}`.
- **The one light** (`G.lightAngle`) is shared: `setLight(f)` aims it from the slab centre toward the pointer,
  the **Light tool** drags it (a `lightdrag` gesture; `drawLightGuide()` draws a little sun at the slab edge),
  `edgeFinish` lights tile edges by edge-normal·light, and the specular sheen/glint place their hotspot by it.
- **Back light** (`paintBacklit`, `G.backlight`) — a stone-view mode (replaces the daylight body + its front-lit
  coat passes) modelling light from **behind**: the **per-layer fold**, where *each layer declares what it does to
  the light*. Every layer carries `transmit` (0 opaque → 1 clear) and `scatter` (diffusion), defaulted per identity
  (`BL_T`: veins ~0.05, seams 0.1, minor 0.12, web 0.22, specks 0.45, drusy 0.55, base/matrix = the glow) and
  authored on the Selected bar (`pass` / `scatter` sliders). The fold, on a ≤512px `workC`:
  1. the **base bucket is the glowing body** — `expBaseMask` luminance → `backC`: `backlightColour · intensity ·
     (0.18 + 0.82·lum)·baseTransmit · falloff` (a dark matrix passes less; hot-centre toward `G.lightX/lightY`).
  2. then **each non-base layer in turn, deepest→top**: if it scatters, blur the accumulated light (`blurCanvas`);
     then `multiply` by `layerMask(L,t)` — white where clear, grey(t) where the layer covers — so the light drops
     toward that layer's `t` where it occludes. `layerMask` renders just that layer's artifacts (filtered by
     `.layer === L.key`), so two same-bucket layers can differ (an opaque vein layer vs a translucent one).
  Then **emission-compose** (reuse the uv `emit` path into `emitC`, clip the UV_DARK floor, add with `lighter`) so
  self-luminous inclusions glow *through* at the current `lightSpectrum` (dark stones need this), and a
  **scatter/bloom** so the glow reads as light. Colour = `lightRGB()`; drawn under the view transform; the **lens**
  still runs over it. Takes **precedence over uv** so emitters compose at the dial value. `transmit`/`scatter`
  persist per layer with the slab (old saves keep the defaults). This is the full "each layer declares its
  {emission, transmittance, scatter}" model — `emission` = its `OVR_uv`, the other two on the layer.
- **Lens top-coat** (`G.lens`, `G.lensType`, `G.lensPitch`) — the last coat pass in stone view: an ideal glass
  relief on the very top that **refracts** what lies beneath. Real per-pixel refraction (a mesh-blit warp tears
  at any real amplitude; a **gather** cannot), done on a downscaled snapshot in `lensC` (≤640px, upscaled back —
  glass softens it) so it stays cheap. Each output pixel samples the source at a displacement from the lens
  profile: **fresnel** (radial sine → concentric rings), **reeded** (per-column sine → vertical grooves),
  **water** (crossed sines → hammered/wavy glass). Displacement scales with the groove (`amp = lens·0.5·pw`),
  so steepness tracks strength not pitch. A soft **caustic** brightens (never darkens — glass has no dark bands)
  where the relief focuses, via `1/|jacobian|`; it reads on dark stone and washes out on white, as a real caustic
  does. Latent head-on for an ideal flat lens; built to pair with a future back light (the same fold, run
  back-to-front). `Lens` / `Lens grooves` sliders + a `Lens type` group; persists in `G` with the slab.
- `paintStoneContent(ident, angleView)` — the core of the renderer. Paints the pinned **ground**
  (breccia / clouds / bands) first, then **walks `layers[]` in array order** and dispatches each to its
  per-kind painter — so render z-order is the stack order, not the kind, and kinds interleave. Gated by
  layer visibility. *(≈2229)*
- `paintFogLayer` / `paintWebLayer(only)` / `paintSpecksLayer(…, only)` / `paintDrusyLayer` /
  `paintStylLayer` / `paintVeinLayer(…, only)` — each paints ONE layer's marks (the `only` key filters
  the geometry). A vein layer composites atomically: halo → shoulder → main for just its lines. Extracted
  from the old fixed kind-sequence so the walk above can order them freely. Also serialized into the
  worker core (`renderCoreSrc`). *(≈2229)*
- `moveLayer(key, dir)` — reorder a content layer in the stack (`dir` +1 = up, −1 = down), swapping with
  the adjacent layer; blocked from crossing into the pinned ground (`isGroundLayer` = base body + the 3
  setters). Rebuilds + saves. The row's ▲▼ call it. Stack order serializes in `layers[]` order and is
  restored on load; `DEFAULT_LAYER_ORDER` + `clearUserLayers` reset it. *(≈602)*
- `runs(L, colour, fixedWidth, alpha, shoulder)` — stroke a line in chunks (shoulder or core pass). *(8058)*
- `fxOn(key, colour, ident)` / `fxOff(s)` — set a layer's blend mode + colour glow around its paint,
  then restore. *(1669/1676)*
- `paintLive()` — the in-progress stroke. *(5435)*
- `drawScaleBar()` / `drawGuides()` — the scale bar and the gravity/magnet guide overlay. *(1778/1790)*
- `drawWarpGuide()` — the **warp field made visible**: samples the same `fbm2` displacement `warpGeo`
  uses, on a coarse grid, and draws each node's base displacement as a teal arrow (direction exact,
  length/opacity the field magnitude normalised to the grid max). Shown with the **Cloud** tool while
  `G.warp > 0`; rides `cloudX`/`cloudY`, and is a guide — never baked into an export.
- `idColour(id, t)` — identity-view colour for an id. *(4306)*
- `redraw(rebuild)` — schedule a frame on rAF (rebuild geometry if asked), then autosave. *(8078)*
- `stat()` / `clampView()` / `zoomAt(ex, ey, f)` / `hint(msg)` — status line, view clamp, zoom, hint. *(1866/1871/1877/1898)*

## Layers

- `layers` / `layAt(k)` — the layer list and lookup. Fixed passes use `key === bucket`; user layers use a
  `bucket#n` key. Each has `{key, label, bucket, on, op, warp}`. *(8086)*
- `layVis(k)` — visibility, honouring solo (solo keeps `base` under the soloed layer). *(2264)*
- `layOp(k)` — a layer's opacity. *(2265)*
- `activeLayer` — the active layer per bucket (`{major, minor, web, micro}`); a mark files into
  `activeLayer[its bucket]` at commit. `addLayer(bucket)` appends a layer (grouped after its bucket's
  last) and makes it active — a new **micro** layer gets `field:'specks'` and its own density/size/seed;
  `setActiveLayer(key)` picks the active one. *(≈475/519)*
- `deleteLayer(key)` — remove a **user** layer (`#`-keyed only; the bucket defaults are permanent) **and
  everything drawn into it** (Photoshop-style): drops marks with `m.layer===key`, then sweeps every
  reference — its colour + adjustment tokens (`lay:<key>`, `lay:<key>:<adj>`), UV emission
  (`OVR_uv['lay:'+key]`), the `selected` entry, `folders[].members`, hidden mark-ids, and the active/solo
  pointers (active falls back to the bucket default). Rebuilds geo **synchronously** (`build()`, since
  `redraw` defers to rAF) *then* runs `gcOrphans()`. The Layers panel shows a `×` on each user row: an
  empty layer deletes on the first tap, a non-empty one **arms** and needs a second tap (there's no bulk
  undo). *(≈572)*
- `gcOrphans()` — after a rebuild, drop per-id overrides (`OVR`/`OVR_uv` `id:*`, `perItem`, `selected`
  `id:*`) whose artifact is no longer in `geo` (also sweeps any pre-existing orphans). *(≈585)*
- `purgeLayerTokens(key)` / `clearUserLayers()` — the shared cleanup idioms: the first removes a layer's
  `lay:*` tokens + folder membership + selection; the second drops all `#` layers and resets `activeLayer`
  to the bucket defaults (used by both `deserialize` and `freshSlab`). *(≈577)*
- `freshSlab()` — the **Clear** button: a genuinely blank slab — clears marks **and** user layers **and**
  their tokens (`OVR`/`OVR_uv`/`perItem`, selection, hidden, folders), resets the default layers and the
  default granite field, and reseeds a clean daylight palette from the current family — while **keeping the
  studio** (family, tile, warp, coat, lens). Previously Clear only emptied `marks`, so user layers and
  their overrides leaked into the "fresh" slab. *(≈590)*
- `syncGranite()` — reflect the **active granite layer's** density/size into the ground sliders. The
  Specks/Speck-size sliders and **Reseed** all act on `activeLayer.micro` only, so each field is tuned
  independently. *(2260)*
- `stampLayers(out)` — after every build, tag each line (`L.layer`) and web edge (`e.layer`) with its
  mark's layer, falling back to the bucket for legacy marks or a deleted layer. Render (`lk`) and both
  warps read this, so eye/opacity/warp are per-layer while export still buckets by kind. *(≈1590)*
- `buildLayerUI()` / `syncLayerUI()` / `relayer()` — build the Layers panel (eye · name=make-active ·
  solo · **W** warp-hold · opacity, plus the **+ layer** buttons), reflect state, and repaint. Rebuilt on
  `deserialize` so restored user layers reappear. Each row carries a **derived tag** (`M1` = bucket letter +
  live ordinal, recomputed here, never stored) and the name is **double-tap-to-rename** (edits `label`; key
  and tag untouched). The Selected bar's **hide** adds the artifact's **mark** to `hidden` (a whole vein +
  its sub-lines, by mark); the **Hidden list** below is the only way back (each row un-hides). *(2078/2094/2077)*
- `buildFolderUI()` — the **Folders** panel: spectrum workspaces (`folders` = `{name, v, c, members}`). **+ folder
  from selected layers** captures the selection at the current `lightSpectrum`; a row's **tag** batch-authors
  `OVR_uv[member] += {v,c}` for every member at once, **enter** sets the light to the folder's `v` and selects its
  members (so the editor filters to them via "selected for display"), the swatch sets `c`, double-tap renames.
  Pure author-side organisation — members keep their own tokens; deleting a folder frees nothing. Persists with the slab.

## Colour layer

- `OVR` / `COL` / `perItem` — the overrides the editor edits and we persist / the *resolved* values
  the renderer paints from / `id → layer bucket` for per-item (per-id) tokens. `COLOUR_TOKENS` /
  `FX_LAYERS` / `BLENDS` — the colour token list, the layers that carry blend/glow, the blend options.
- `seedColours(f)` — seed the colour **overrides** (`OVR`) from family `f`'s palette (never effects). *(2026)*
- `recolour()` — resolve `OVR` → `COL` through the kit (fills defaults + `inherit`); the renderer reads `COL`.
- `setupColour()` — create the kit, register the Colour / Effects / Per-item groups, bind the adapter
  to `OVR`, resolve, mount the editor. *(8408)*
- `registerPerItem()` — (re)register the Per-item token group from `perItem`; each id **inherits** its layer.
- `groupTokens(prefix, ng, nv, label, inheritBase)` — build a nested primary/secondary token set:
  group `‹prefix›g` inherits `inheritBase`; variant `‹prefix›g.v` inherits the group. Capped 5×4.
- `registerSpeckGroups()` — (re)register "Speck colours" (`micro:g.v`, from `G.speckGroups`/`speckSubs`;
  a speck's group+variant are birth-position hashes `speck().u`/`.u2`) and "Drusy colours" (`drusy:g.v`;
  a drusy pocket is the group, its crystals the variants).
- `tuneId(id, bucket)` — the Tune tool's action: give a vein a per-item colour token that follows its
  layer until changed (reset returns it).
- `mountEditor()` — (re)create the `<theme-kit-editor>` so its inputs reflect `OVR`. *(8515)*

## Interaction

- `nearestLine(fx, fy)` — the nearest vein (for Branch tap/drag). *(8191)*
- `commit(m)` — push a mark (freezing `NEXT`/`fam` onto it) and rebuild. *(8289)*
- `end(e)` — pointer-up: build the right mark for the active tool. *(8294)*
- `commitHover()` — commit a hover trace (pen/mouse working above the slab). *(8372)*

## The source — save, load, restore

- `serialize()` — the stone source: `{v:1, fam, tool, view, layTiles, guidesOn, G, T, NEXT, nextId,
  layers[{key,label,bucket,on,op,warp,field,density,size,seed,haze,transmit,scatter}], soloLay,
  activeLayer, OVR, OVR_uv, perItem, hidden[], folders[], marks[]}`. It persists **`OVR`, not `COL`** —
  `COL` is derived (`recolour()`), so only the overrides travel; the resolved values rebuild on load. *(9172)*
- `deserialize(o)` — restore a source (guards `v === 1`), then rebuild. It is written so that **a load is a
  pure function of the slab**, not of whatever was loaded before: it **hard-resets `G`/`T`/`NEXT` to their
  captured pristine defaults `G0`/`T0`/`NEXT0` *before* applying the saved values** (a key absent from the
  save falls to its default, never a leftover), and **invalidates the render caches** — the
  cloud/band/breccia signatures (`cloudSig = bandSig = brecSig = ''`) and the incremental-build cache
  (`last = null`) — so nothing survives a load. Then `clearUserLayers` (drop the previous slab's `#` layers,
  reset `activeLayer`), reset the default granite + fog planes, re-create + reorder saved layers, run the
  migrations, clear + reload `OVR`/`OVR_uv`/`perItem`/`hidden`/`folders`, reseed + `recolour`, re-mount the
  editor, and redraw. Always opens in daylight (`lightSpectrum = 0`, uv/spot off). The harness renders each
  hero twice from a fresh `deserialize` precisely to exercise this determinism. *(9180)*
- `writeLocal()` / `saveLocal()` / `tryLoadLocal()` — autosave (debounced + flush on hide), and
  restore on load. *(2132/2133/2138)*
- `syncUI()` — push all state into the controls after a load. *(9823)*
- `showGround()` — show/hide the family-specific ground panel. *(9094)*
- `download(name, text)` — a Blob download for Save (falls back when the `downloads` capability is
  absent). *(9848)*

## Export — one zip: masks, render, the rich set, `.ora`, SVG, source

`exportAll(W)` renders everything at `W` pixels wide (the slab keeps its 8×5 ratio) and packs it into a
single store-only zip. It prefers the `downloads` capability and falls back to `download()`.

- `crc32(u8)` — CRC-32 over a byte array (the zip checksum). *(9866)*
- `zipStore(files)` — a store-only (uncompressed) zip `Blob` from `[{name, data}]`. PNGs are already
  compressed and `.ora` requires stored entries, so nothing is deflated. Writes local headers, a
  central directory, and the EOCD by hand. *(10249)*
- `toU8(canvas)` — a canvas as PNG bytes (`toBlob` → `Uint8Array`). *(11479)*
- `expCanvas(W)` / `polyPath(cx, pts)` — an off-screen slab-ratio canvas; a polyline subpath. *(2314/2315)*
- `expCompleted(W)` — the finished slab, every layer baked in (what `render.png` holds). *(11505)*
- `expBaseMask(W)` — the base composite (ground + breccia + clouds + bands) flattened to luminance:
  the greyscale value map for the `base` bucket. *(11512)*
- `expCoverage(kind, W)` — white-on-black coverage for a consumer bucket (`major` / `minor` / `micro`
  / `web`); `minor` also stamps the stylolites, `micro` the specks and drusy. *(11523)*
- `expBucket(bucketKey, W)` — one bucket in colour, transparent elsewhere, by gating layers to that
  bucket — the layer PNGs inside the `.ora`. *(11533)*
- `expIdT(W)` — the rich pair: a vein-**id** map (each line an rgb-encoded index) and an
  along-the-vein **t** map (grey 0→255 head to tail), plus the `{index: id}` legend. *(11541)*
- `pathsJSON()` — the vectors as data: slab size in feet, then each line's `id / major / parent / at`,
  its points, and its per-sample widths. *(11550)*
- `linesSVG()` — the veins and stylolites as an SVG path drawing (a 1000-px-wide vector proof). *(11551)*
- `buildOraFrom(merged, buckets, order, W)` — an OpenRaster `.ora` assembled from already-encoded
  PNG bytes: a nested zip with `mimetype` stored first, a `stack.xml` (top child = top layer), the
  bucket layers under `data/`, and a `mergedimage` + thumbnail. Opens in Krita / GIMP / Photoshop.
  Takes the encoded bytes rather than rendering them, so the encode happens once. *(11596)*
- `exportAll(W)` — assemble `render.png`, `masks/{base,major,minor,micro,web}.png`,
  `rich/{vein-ids,vein-t}.png` + `legend.json` + `paths.json`, `lines.svg`, `source.json`, and
  `slab.ora` into one zip and hand it to the viewer. *(11774)*

## Large renders — what a canvas can hold, and what to do past it

Above `STRIP_FROM` (16384) the picture is never allocated whole: it is rendered as horizontal bands and
written straight into a PNG's IDAT stream, so peak memory is one band rather than one image. Everything
here answers a question about the machine by **measuring it**, because a canvas past a cap does not throw —
it reports the size asked for and leaves the far end unwritten. See
[`capabilities.md`](capabilities.md) for the measured ladder and what it costs.

- `canvasFits(w, h, n)` — can this machine hold `n` canvases of `w × h`? Writes the **far corner** and
  reads it back, because a silently clamped canvas passes every other test. *(9392)*
- `exportCeiling()` — the direct export's ceiling: probes 2048→16384 for `EXP_PEAK` (2) canvases, cached
  per device signature. This is the ceiling of the *non-streamed* path only. *(9414)*
- `sideCap()` — the widest single canvas this **build** can allocate, by bisecting `1 × N`, cached. Not a
  constant: CI measures Gecko and WebKit clamping to 32767 while a desktop Firefox writes a true 65535, so
  the cap belongs to the build rather than the engine. *(9436)*
- `applyExportCeiling()` — disables the plain sizes past `exportCeiling()`, leaves the tier sizes to
  `applyTiers()`, and re-runs it so the ceiling line matches the armed tiers. *(9470)*
- `stripPlan(W, opts)` — band geometry: band height from a 900 MB budget (reduced by
  `navigator.deviceMemory`, which is Chromium-only), bleed capped at 256, then **probed** with
  `canvasFits` and halved until a band actually holds a written pixel. *(4863)*
- `renderStrip(W, y0, h, bleed, wins)` — one band with bleed above and below, painted at the full-slab
  transform with a tile offset so global gradients and the specular hotspot land in image space. *(4891)*
- `pngChunk(type, data)` / `pngTextChunk(keyword, text)` — a self-framed PNG chunk; the `tEXt` chunk that
  carries provenance. *(4469 / 4476)*
- `renderStreamedPNG(W, meta, onStrip, opts)` — the strip engine: band → filter byte 0 → a
  `CompressionStream('deflate')`, whose output is exactly the zlib stream IDAT wants. Refuses past
  `sideCap()`, and **refuses if the scanline byte count does not match the plan**, because a band written
  twice or skipped is invisible to every decoder. Returns `{blob, plan, msRender, bytes}`. *(9896)*
- `expMeta(o)` — the provenance object spliced in as `tEXt`: tool, timestamp, mark and line counts,
  family, spectrum, `devicePixelRatio`, cores, user-agent, and the run's own timings. *(10183)*
- `bigDialog(text, goLabel)` — the friction dialogue. Resolves from its **buttons** and polls `open`,
  never the `close` event, which was measured never firing in an embedded Chromium. *(12761)*
- `applyTiers()` — arms Large / Extreme, hides or disables sizes past `sideCap()` with the reason, forces
  render-only scope above `STRIP_FROM`, and writes the ceiling line — which states the largest size
  actually on offer, not a probe's answer to a different question. *(12786)*
- `memNote()` — Extreme's hardware recommendation (16 GB, the machine it is known to finish on) plus
  whatever `navigator.deviceMemory` says, reported beside it rather than used as a verdict. *(12863)*
- `exportStreamed(W)` — drives the above with the shared progress line, clock and failure handling. *(16583)*

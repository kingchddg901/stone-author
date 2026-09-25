# Input channels — one adapter, many tools

> A gesture carries more than a path. **One adapter turns a raw stroke into a set of named channels; each
> tool consumes all of them, some of them, or none.** Stylus hardware supplies the channels directly;
> mouse and touch supply the unavailable ones from explicit controls. A tool sees the same channel set
> either way and never asks what device drew it.

**Status: partly built, by accident rather than by design.** The shape exists — two extractor functions
and a per-mark opt-in — but it is incomplete and used inconsistently. See
[Where the code stands](#where-the-code-stands). Generalised out of [`moon.md`](moon.md), which is the
first tool that needs the whole set.

## The channels

| channel | source | what it means |
|---|---|---|
| **path** | pointer position | where the gesture went |
| **speed / dwell** | derived, `v = distance / Δt` | how long the gesture acted on each part of the slab |
| **pressure** | stylus pressure, or an authored value | how strongly or closely it acted |
| **tilt** | stylus lean + azimuth, or an authored value | its orientation, and any asymmetry that implies — **normalised against the user's learned rest grip, never raw degrees**, and structured as `amount` / `signed` / `azimuth` so a tool takes only the part it needs (see below) |

Every stroke carries all four. **A tool declares which it consumes** — a vein wants pressure for width and
lean for edge softness; the magnet wants all four; a chip wants only the path. Unused channels cost
nothing, and a tool never branches on the input device.

```
                 ┌─ stylus pressure ─────┐
physical stylus ─┼─ stylus tilt ─────────┤
                 │                       ▼
                 │                 CHANNEL SET
                 │              path · speed · pressure · tilt
                 │                       │
                 │                       ▼
                 │              tool consumes what it needs
                 │
mouse / touch ───┼─ explicit pressure ───┤
                 └─ explicit tilt ───────┘
```

## Tilt is normalised, and the normalisation is part of the channel

**The tilt channel is not device tilt.** Everyone holds a pen at their own angle, so an absolute reading
is meaningless — what carries intent is *how far past your normal grip you leaned*. The studio already
does this:

```js
smoothstep(9 / 90, 25 / 90, leanAverage − rest)
```

So the channel is a **0..1 "how far past your rest grip"**, ramping over roughly 9° to 25° beyond it —
not an angle. Three consequences the adapter has to carry, not leave to each tool:

- **Consumers receive the normalised value.** A tool asking for tilt must never see raw degrees.
- **The authored mouse/touch value lives in the same 0..1 space.** If the explicit control is in degrees
  while the stylus path is normalised, the two inputs stop producing the same event — which is the whole
  point of the adapter.
- **The baseline travels with the mark.** `rest` is already captured once at pointer-down and frozen onto
  the mark, which is what keeps a stored slab's render reproducible. Keep that.

### Signed tilt: which way you leaned

`0..1` throws away **direction**. Lean left and lean right by the same amount and the channel cannot tell
them apart — even though the information is right there, since a stylus reports lean *and* azimuth, and
`leanProfile` simply never looks at azimuth.

A first pass at this claimed the sign was useless or harmful for two of the three consumers. **That was
wrong** — every one of them has a real use for it, and the uses are more interesting than "softer":

| consumer | what the sign buys it |
|---|---|
| vein edge softness | **throws the shade the other way.** Today lean only *softens*, symmetrically. Signed, the soft shoulder goes to the side you lean toward and the other edge stays crisp — which is how a chisel or a broad nib actually behaves. The `halo → shoulder → main` paint order already has the shoulder to offset. |
| Moon's asymmetric field | which side the body passed on. |
| magnet | **combs across the stroke instead of along it** — a 90° turn of the alignment axis, not a polarity. See below: it only works if the sign is applied after the angle doubling. |

The magnet is worth doing carefully, because **where the `×−1` lands decides whether it does anything at
all.** The field is built in *doubled-angle* space:

```js
c2 = Math.cos(2 * Math.atan2(ay, ax))     // ax, ay = the axis direction
s2 = Math.sin(2 * Math.atan2(ay, ax))
vx = (1 − comb) * fan * Math.cos(2 * ra) + comb * c2
da = Math.atan2(vy, vx) / 2 − sp.ang      // halved again to recover an axis
```

Doubling is what makes a speck *axial* — "a speck has no front", so θ and θ+180° are the same thing. Two
different negations follow, and they are not the same operation:

| negate | effect |
|---|---|
| `(ax, ay)` — the direction **before** doubling | **nothing.** It shifts the angle by π, and doubled that is 2π. Inverting the stroke's read direction this way is a genuine no-op. |
| `(c2, s2)` — the axial vector **after** doubling | **a 90° rotation.** `atan2(−s2, −c2) / 2 = θ + π/2`. The comb turns to lie *across* the stroke instead of along it. |

So the sign has to be applied to the axial vector, not to the direction it was built from. Applied there
it is not a polarity at all — it is **comb along the path versus comb across it**, which is the useful
control and the one a mouse user would actually want.

Negating the **whole** field `(vx, vy)`, fan term included, goes further: the pole's radial starburst
becomes its perpendicular, so specks lie tangent to circles around the pole rather than radiating from it.
A swirl instead of a sunburst. Worth trying once the channel exists.

(Not to be confused with `sign = M.mag`, the existing Align/Scatter toggle, which is a separate `×−1`
deciding whether specks rotate toward the field or are randomised.)

### Scatter does not scatter — it blurs

A tool-model note rather than a channel one, but it lands here because the fix uses the signed channel and
the same doubled-angle machinery.

Scatter is the `else` arm of the alignment step:

```js
if (sign > 0) { /* rotate toward the field axis */ }
else sp.ang += g() * 1.4 * w;          // g = a gaussian stream
```

That is a **zero-mean random walk on each speck's own current angle**. Its expected change is zero, so the
ensemble's *mean* orientation is preserved exactly — and mean orientation is what alignment IS. The
variance grows, the alignment stays. It does not randomise the field, it **blurs** it, which is why
scattering an aligned patch still reads as aligned.

The falloff makes it worse: `w = min(1, str · dt · 30 · exp(−ρ² / (R²·0.5)))`, so only specks directly
under the pole get a meaningful kick and the rim barely moves. The result is a soft smudge of whatever was
already there, rather than disorder.

**The better model, and Chris's: sweep the target instead of jittering the speck.** Keep rotating specks
*toward* a field axis exactly as Align does, but let that axis **turn along the path** — a fairly quick
walk through the full 0–360°. Then:

- specks at different points along the stroke are combed to genuinely different angles, so the *ensemble*
  is disordered while each individual speck stays crisply oriented — which is what real rock looks like,
  grains pointing every way but each one definite;
- **Scatter stops being a separate mode.** It becomes Align with a rotating target, and the rate of
  rotation is the control. Rate 0 is Align. One mechanism, one parameter, no `if/else`;
- a **rotational range** falls out as the natural knob — how far the sweep spans. A few degrees gives a
  loose, natural-looking grain; a full turn gives complete disorder;
- the **sweep direction** (clockwise or anticlockwise) is exactly what the signed tilt channel is for;
- and it is **deterministic**, which removes mechanism 3 below — there is no random stream left to key to
  a sample index.

**Per length or per time?** Chris: *a simple d/t*. That settles it, because speed as the angular rate is
not a third option — it **is** the per-length one:

```
dθ/dt = k·v = k·(ds/dt)   ⟹   dθ = k·ds   ⟹   θ = k·s
```

Drive the sweep at a rate proportional to speed and integrate it over time, and the axis angle comes out
proportional to **arc length**. The two candidates collapse into one, and it is the right one on three
counts:

- **The pattern belongs to the path, not to the hand.** Draw the same path slowly or quickly and you get
  the same scatter. Reproducible, and it keeps the swept target deterministic.
- **Dwell does the physically correct thing.** At `v → 0` the axis stops advancing, so standing still
  drives one angle *harder* rather than winding through others — which is exactly what holding a bar
  magnet over filings does. It aligns them hard along one axis; it does not swirl them. My earlier note
  arguing for the time-based version had this backwards.
- **The channels stop overlapping.** Dwell already controls alignment *strength* through
  `w = min(1, str · dt · 30 · …)`. Under per-length, dwell owns strength and travel owns angle — one
  quantity each, composing cleanly, instead of both fighting over the same knob.

So: **θ = k · s**, with `k` the rotational range per unit length, and the sign of `k` taken from the signed
tilt channel.

#### Sampling is per second, so don't compute the speed

Pointer events arrive on a **time** schedule, not a distance one — the repo's own tuning note measured
Chris's S Pen at **60 Hz**. So `d/t` is well defined per sample, and the question "does that give a
meaningful speed" is the right one to ask. Two answers, pulling opposite ways:

**You don't need the speed.** `θ = k·s` is a running sum of segment lengths:

```js
theta += k * Math.hypot(p[i][0] - p[i-1][0], p[i][1] - p[i-1][1]);
```

No division, no `dt`. Computing `v = ds/dt` and then multiplying by `dt` again is the same number with
timestamp jitter added and removed for nothing — and event timestamps are the noisiest thing in the
record. `applyMagnet` already clamps `dt` to `[0, 0.05]` precisely because it is unreliable. Accumulate
distance directly.

**But 60 Hz does bite, on the angular step.** The *pattern* is speed-independent; its *sampling* is not.
At 60 Hz a brisk drag of one slab width in half a second moves ≈0.033 slab units between samples. If `k`
is set to a full turn per quarter width — a plausible "quick walk" — that is

```
0.033 / 0.25 × 360° ≈ 48° of sweep per sample
```

— about seven discrete orientation bands rather than a smooth sweep.

**Which is not a bug.** It was called an artifact here first, and Chris was right to reject that: *why
would that be smooth, it's fast as heck.* A flick **should** land as a handful of coarse steps; a long
slow stroke over the same path takes many more samples across the same distance and comes out smooth. So
speed does not change the angular envelope — the path fixes that — it changes the **granularity**, and
chunky-when-fast is the honest result. Do not subdivide it away.

#### Reopened: sweeping by time, which is cleaner still

Chris: *sweep by time, per sample — that falls out clean, does it not?* It does, and cleaner than the
length version, because samples arrive on a time schedule:

```js
theta += k * dt;        // one multiply. no hypot, no division, nothing.
```

This was first written up as a *trap* — that a literal per-sample step makes the sweep a property of the
hardware, since a 240 Hz stylus would wind four times faster than a 60 Hz one. Chris: **it is just a
calibration.** Right, and the numbers are clean — 6°/sample at 60 Hz is 360°/s, so 120 Hz wants 3°/sample
for the same rate. Calibrate the per-sample step from the device rate and per-sample *is* per-time.

That reframing is better than the original, because it exposes a trade that "just use `dt`" hides:

| | per-sample, calibrated | raw `dt` |
|---|---|---|
| timestamp jitter | **immune** — the step is a constant | **inherits it** — and timestamps are the noisiest thing in the record, which is why `applyMagnet` clamps `dt` to `[0, 0.05]` |
| dropped or coalesced samples | **under-advances** — the sweep silently falls behind the gesture | **correct** — the gap is in the timestamp |
| cost | one add | one multiply |

So neither pure form is right: a constant is smooth but lies when the rate wobbles; raw `dt` is honest but
noisy. The synthesis is to **calibrate per stroke** — take the *median* `dt` across the stroke's samples
and use that as the constant:

```js
const step = k * med(dts);      // one calibrated constant per stroke
```

Median because a few stalls should not move it, which is the same reason `restLean()` already uses `med()`
for the grip baseline. That gets the smoothness of a constant, the device-independence of `dt`, and
robustness against the frame the browser dropped — and it costs one pass over the samples that the stroke
is already being walked for.

A long stall is then the one case left over, and it should probably be treated as what it is — the user
stopped — rather than as a very slow sample.

**What it changes.** Time and length are not variations on one idea, they are different instruments:

| | θ = k·s (length) | θ = k·t (time) |
|---|---|---|
| what fixes the pattern | **the path** — the hand only sets graininess | **the gesture** — same path, wildly different results |
| fast flick | full angular range, coarsely stepped | long, gently turning comb |
| slow drag | full angular range, smooth | winds through many turns over a short path |
| **dwell** | no angular change — combs one angle **harder** | winds **in place**: a local swirl |

The dwell row is the decision. Under length, dwell owns strength alone and travel owns angle — the clean
separation argued for above. Under time, dwell does both: it drives harder *and* spins the target, which
is a grind-it-in-place gesture. For a **magnet** that is wrong physics (a bar magnet held still does not
rotate). For a **scatter** control it is arguably exactly right, and it matches the original phrasing —
*a fairly quick walk through 0–359* is a rate over time, not over distance.

Since Scatter is being folded into Align as one rate, the choice decides both. Recommendation: **θ = k·dt**
— cheapest, device-independent once calibrated per stroke (above), and
grind-in-place is a gesture worth having. The cost is giving up "the same path always scatters the same
way", and that is Chris's call to make rather than mine.

#### While we are here: the pen's samples are being thrown away

`getCoalescedEvents()` appears **nowhere** in the studio. Browsers coalesce pointer moves down to roughly
frame rate and hand back the full-rate history only if asked, so a 120–240 Hz stylus is very likely being
recorded at ~60. That 60 Hz measurement may be the browser's rate, not the pen's.

This is free fidelity for **every** channel, not just this one — a better speed estimate, a finer tilt
profile, more of the pressure curve, and a smaller subdivision burden above. Worth measuring before
building anything that depends on sample density.

### Dragging the magnet left-to-right already differs from right-to-left

Observed by Chris, and it is real — the same path drawn in opposite directions gives visibly different
stone. Which looks like it contradicts the no-op above, and does not: **reversing a stroke is not negating
an axis.** Three separate mechanisms produce it, and they are worth telling apart because only one of them
is a design decision.

**1. The effect accumulates in stroke order.** Each sample rotates nearby specks *toward* the field by a
weight `w`, and the target changes along the stroke. Iterative convergence toward a moving target is
order-dependent: a speck reached early and nudged repeatedly does not end where the same speck reached
late does. This is the big one, and it is **correct**. A body that passed left-to-right *is* a different
event from one that passed right-to-left, and the whole Moon design rests on exactly that. The magnet is
already demonstrating the principle the rest of this document is arguing for.

**2. The heading estimator is seeded pointing right.** When there is no tilt to read — mouse, finger — the
axis is taken from the direction of travel, smoothed:

```js
let hx = 1, hy = 0;                                    // ← seeded along +X
hx = hx * 0.7 + dx / d * 0.3;                          // exponential moving average
```

A left-to-right drag begins already aligned with its own heading. A right-to-left one has to converge from
`(1, 0)` to `(−1, 0)` — and on the way it passes through `hx ≈ 0`, where the vector is near zero-length
and `Math.hypot(hx, hy) || 1` quietly falls back to dividing by 1 instead of normalising. So the first
stretch of a leftward stroke is combed by a heading that is still turning around, and briefly by one that
is barely a direction at all. That is **accidental**, not modelled. It only bites on the no-tilt path.

**3. The scatter stream is keyed to sample index.** `sub(m.seed, 60, i)` draws its randomness from the
sample's position in the stroke, so reversing the stroke gives the same physical location a different
draw. Irrelevant under Align, which never uses `g`; under **Scatter** it changes the result outright. Also
accidental — and it disappears entirely under the swept-target model above, which has no random stream.

So the direction-dependence should be *kept* — and its accidental half fixed, so that what survives is the
part that means something. Seed the heading from the stroke's first real motion rather than from `+X`, and
key the scatter stream to something spatial rather than to `i`. Then a reversed drag differs because the
encounter genuinely ran the other way, which is the answer the model should be giving.

A cheap way to tell mechanism 1 from mechanism 2, if it matters: repeat the test **with a pen**. With tilt
present the heading estimator is never consulted, so any remaining difference is pure stroke order.

So the reason to keep tilt structured is not that some tools cannot use the sign. It is that **azimuth
carries strictly more than the sign does** — a bearing is not recoverable from ±1 — and different tools
want the same quantity at different resolutions:

```
tilt = {
  amount  : 0 .. 1        magnitude past the rest grip   — how far
  signed  : -1 .. +1      which side of the reference    — which way
  azimuth : radians       the full bearing               — exactly where
}
```

`amount` stays exactly what ships today, so nothing that reads tilt now has to change — and a tool can
move up a resolution when it wants one, without the adapter growing a second channel.

**Signed against what, though?** Three defensible references, and they are not interchangeable:

- **the rest grip's own azimuth** — deviation from your habitual lean direction. Most consistent with how
  magnitude is already normalised, and stable across a stroke.
- **the stroke's direction of travel** — "leaning into the turn or out of it". The most expressive for a
  drawing tool, but it rotates as the stroke curves, so the same wrist angle changes sign mid-stroke.
- **the slab** — absolute screen left/right. Simplest, and indifferent to both the user and the gesture.

Worth choosing deliberately rather than discovering later. The rest-grip reference is the one that matches
the rest of this design.

**One real failure mode to handle.** Near upright, azimuth is *noisy* — a nearly-vertical pen swings its
reported bearing wildly on tiny wobbles. So the sign has to be **gated by the magnitude**: inside the dead
zone the sign is not weak, it is meaningless, and must read 0 rather than flickering between ±1. The
existing `smoothstep(9/90, 25/90, …)` already establishes that dead zone for magnitude; the signed reading
needs the symmetric version of it, and should inherit the same gate.

**A side benefit for mouse and touch.** A signed value is far easier to author without a stylus: one
slider reading *lean left — upright — lean right* is natural, where a 2D azimuth needs a dial. So `signed`
is probably the channel the explicit control should expose, with `azimuth` left to stylus input and to
tools that genuinely need a bearing.

### The learned grip does not settle, and it should

Today the baseline is a **sliding window**, not a learned constant:

| | today |
|---|---|
| source | samples taken **while the pen is down** (`gripLean`), capped to the last 900 |
| ready at | **60 samples** |
| before that | median of hover in the last 500 ms; failing that, `leanProfile` silently uses the median of the **stroke's own first 8 samples** |
| persisted | **no** — every page load relearns from zero |

That produces three problems, all of the same shape: *the same physical gesture means different things at
different moments.*

1. **It drifts all session.** A rolling median over the last 900 pen-down samples moves as you work — and
   a long, deliberately leaned stroke shifts the very baseline it is being measured against.
2. **It is contaminated by its own signal.** `gripLean` is collected *while drawing*, which is exactly
   when the user is tilting on purpose. **Hover** is the cleaner source: the pen near the surface, not
   being used for anything.
3. **Early strokes are normalised against something else entirely.** Below 60 samples there are two
   further fallbacks, and the last one uses the stroke itself as its own reference — so the first marks of
   a session answer a different question than the rest.

Renders stay safe, because `rest` is frozen onto each mark. It is the **authoring feel** that is not
reproducible, which is harder to notice and more annoying to live with.

What it should be instead — and it is cheap:

- **Learn from hover**, not from pen-down.
- **Settle and freeze.** A few hundred samples is right; at a stylus's 120–240 Hz that is one to three
  seconds of hovering, so the cost is nothing. Once settled, stop moving it for the session.
- **Persist it** to local storage, so a returning user is not relearned from zero every page load.
- **Make it visible and resettable** — one value the user can see and clear if they change grip or device.
  A learned constant the user cannot inspect is a magic number with extra steps.

## Why the adapter, and not per-tool reads

Three things follow from putting this in one place rather than in each tool:

- **Mouse and touch stop being second-class.** The missing channels get authored values, not silent
  defaults, and they get them once instead of per tool.
- **A tool's channel appetite becomes declared, not implied.** Today you find out what a tool reads by
  reading it.
- **The gesture stays a semantic event.** A mark keeps its trajectory and its varying parameters rather
  than a baked result — which is what makes a stroke replayable later.

## Where the code stands

**Capture is already complete.** Every stroke records all six raw slots, for every tool:

```js
gesture.samples.push([ f[0], f[1], now(), pen(e), leanOf(e), azOf(e) ]);
//                     x     y     time   pressure  lean      azimuth
```

**Two extractors already exist** and are exactly the right shape — raw samples in, a per-stroke profile
out, `null` when the channel is switched off:

```js
const press  = M.pressure ? pressFactor(m.samples) : null;
const leanAt = M.tilt     ? leanProfile(m.samples, m.rest) : null;
```

**But they are used inconsistently, and the set is incomplete.**

| tool | how it gets its channels |
|---|---|
| vein, branch | `pressFactor` / `leanProfile` — the intended path |
| magnet | re-derives lean, azimuth, pressure and `dt` **inline from the raw samples**, duplicating the extractors it does not call |
| moon | consumes none — `resample()` discards time, pressure and tilt on its first line |

What is missing to make it a real adapter:

1. **A speed/dwell extractor.** Only the magnet derives `dt`, and it does so inline.
2. **An azimuth extractor.** `leanProfile` covers lean; the magnet reads `q[5]` itself.
3. **A source for mouse and touch.** There is no authored pressure or tilt anywhere. The magnet's fallback
   is a silent constant — `lean = 55/90`, axis along travel — which is a guess standing in for a control
   the user never had. Its tilt value must be in the **normalised** 0..1 space, not degrees.
4. **A settled, persisted rest grip**, learned from hover — see
   [Tilt is normalised](#tilt-is-normalised-and-the-normalisation-is-part-of-the-channel). The magnet's
   `lean = 55/90` fallback is a second, unrelated normalisation sitting beside the first.
5. **A declaration.** Nothing states which channels a tool consumes; it is discoverable only by reading
   each tool.

## The order that makes sense

The cheap, reversible step first, because it proves the seam without changing a pixel:

1. **Extract what the magnet already does inline** into speed/dwell and azimuth extractors beside
   `pressFactor` and `leanProfile`, and have the magnet call them. Behaviour identical, duplication gone —
   and a rendering diff should confirm *identical*, since the magnet is the one tool already using the
   whole set.
2. **Add the mouse/touch source**, feeding the same extractors from authored values. This is the half that
   makes it an adapter rather than a helper library, and it fixes the magnet's silent default as a
   side-effect.
3. **Point Moon at it** — see [`moon.md`](moon.md). Moon is the first tool that needs all four and has
   none, which is why it surfaced the idea.

Step 3 changes how existing Moon marks render, since they carry timing they never expressed. Steps 1 and 2
do not, and that is the argument for doing them first.

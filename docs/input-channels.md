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

Worth deciding whether the sweep advances per unit **length** along the path or per unit **time**. Length
makes a slow, careful pass and a quick flick produce the same pattern; time makes dwell wind the axis
further, which is more consistent with how the rest of the magnet already treats time.

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

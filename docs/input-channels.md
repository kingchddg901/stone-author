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
*toward* a field axis exactly as Align does, but let that axis **turn** — the magnet is a bar that spins
while you move it. Then:

- specks at different points along the stroke are combed to genuinely different angles, so the *ensemble*
  is disordered while each individual speck stays crisply oriented — which is what real rock looks like,
  grains pointing every way but each one definite;
- **Scatter stops being a separate mode.** It becomes Align with a rotating target, and the rate of
  rotation is the control. Rate 0 is Align. One mechanism, one parameter, no `if/else`;
- the **spin rate** is the knob, and it is the only one: slow rotation reads as a loose natural grain,
  faster as disorder;
- the **sweep direction** (clockwise or anticlockwise) is exactly what the signed tilt channel is for;
- and it is **deterministic**, which removes mechanism 3 below — there is no random stream left to key to
  a sample index.

#### Scatter is a rotating magnet

The tidy way to say it, and the one that makes everything else fall out:

> **Align is angular velocity zero. Scatter is angular velocity non-zero.**

Not "a rotational range applied along the path" — that is what it looks like in code, not what is
happening. The magnet is physically spinning while you move it, and `0–359` is not a noise range, it is
the bar completing a turn. One mechanism, one parameter, and the invariant the specks have always had
survives untouched: **the magnet may rotate a shape; it never translates one.**

**ω is a property of the tool, not of your hand.** A real spinning magnet does not spin faster because you
sweep it faster. So the field orientation advances with **time**:

```
θ(t) = ω·t
```

#### Why a slow pass scatters and a fast one does not

The disorder is not per-speck randomness. It is a **phase difference between neighbours**. Two specks a
distance `d` apart along the path are encountered `Δt = d/v` apart, during which the bar has turned:

```
Δθ = ω·d / v
```

Which is rotation *per unit distance* `k = ω/v` — and it is **inversely** proportional to speed:

| pass | Δθ between neighbours | result |
|---|---|---|
| **slow** | large — the bar turns a long way between one speck's encounter and the next | neighbouring shapes end up at unrelated angles: **disorder** |
| **fast** | small — the bar crosses a neighbourhood before turning much | **broad patches of common orientation** |
| **dwell** | one population sees a changing field repeatedly | depends on the accumulation model — a swirl, or a last-field bias. Worth *observing* rather than specifying |

Each shape still holds a perfectly definite orientation throughout. The **population** loses alignment
because its members met different phases of the same rotating field. Apparent randomness, emerging from
`position × trajectory × spin rate × encounter duration`, with no RNG anywhere.

#### Calibration, and the rate to avoid

Per-sample step is `ω` divided by the device rate, so one rotation per second is **6°/sample at 60 Hz,
3° at 120 Hz, 1.5° at 240 Hz**. Because the tracking weight `w` also carries `dt`, both scale together
and the physics comes out the same on any hardware — device independence in the model, not just the
bookkeeping.

One rate to stay away from: the field is **axial**, so a speck responds to the axis mod 180° and the alias
period is **half a turn, not a whole one**. Any multiple of 180°/sample reads as a bar standing perfectly
still. 6°/sample is 30 samples per axial cycle, nowhere near it; keeping the step under ~30° keeps the
whole family out of reach.

#### How this was settled, since the reasoning went wrong twice

Recorded because the wrong turns are instructive. Two earlier passes concluded the sweep should advance by
**arc length** (`θ = k·s`), once from algebra and once from a lag argument. Both rested on an unexamined
assumption — that the spin rate rides on travel speed. It does not: a spinning bar has its own clock. With
`ω` fixed, `k = ω/v` *emerges* and is speed-dependent, which is the entire effect.

Chris proposed sweeping by time early and was argued out of it. He was right.

The per-speck **lag** analysis from that detour is still true — `sp.ang += da*w` is a first-order approach
and `w` carries `dt`, so a speck does trail the field. But it answers *where one speck ends up*, whereas
scatter is a question about *how much neighbours differ*. It is a secondary effect, not the mechanism.

And the gaussian kick is now clearly wrong for a reason better than "it preserves the mean": it was
**simulating the appearance of disorder instead of the thing that causes it.** Ask what physically
happened and the special case collapses into one parameter on the mechanism that was already there.

#### Measured from real use — a controlled sheet

Chris authored a clean granite sheet (everything but the speck ground zeroed) and drew five magnet
strokes, **deliberately holding pressure steady and varying only speed and direction.** Measuring that
file is worth more than any amount of reasoning about what a hand does.

| mark | n | speed (slab-widths/s) | direction | straightness | pressure mean ± sd | lean mean ± sd |
|---|---|---|---|---|---|---|
| 1 | 18 | 0.401 | 11° | 0.99 | 0.121 ± 0.135 (**111%**) | 0.384 ± 0.031 |
| 2 | 6 | 0.027 | 35° | 0.87 | 0.013 ± 0.006 (44%) | 0.394 ± 0.004 |
| 3 | 127 | 0.059 | 3° | 0.98 | 0.050 ± 0.029 (59%) | 0.309 ± 0.140 |
| 4 | 14 | 0.459 | 93° | 0.99 | 0.115 ± 0.045 (39%) | 0.629 ± 0.109 |
| 5 | 172 | 0.031 | 91° | 0.99 | 0.045 ± 0.023 (52%) | 0.389 ± 0.097 |

**Sample rate: 60.2 Hz.** The figure in the tuning note is real, at least at the event level.

**Speed spans 17×** — 0.027 to 0.459 — from one hand, on purpose, with straightness 0.98+ on four of the
five. The rotating-magnet model needs exactly that range to show both regimes, and a hand supplies it
without being asked.

**But "steady pressure" is not steady in the data.** He held his hand still and the signal moved with a
coefficient of variation of **39–111%**. That is not a light-touch habit to design around — the entire
gesture lives in the bottom tenth of the sensor's range (p90 = **0.086**, max 0.368), which is precisely
where a stylus is least linear and noisiest. Two consequences:

- **Pressure needs the same treatment tilt already gets.** Tilt is normalised against a learned rest
  grip; pressure is normalised against nothing, so the studio reads 0..1 while a real hand delivers
  0..0.1. Normalise against the user's *observed working range*, learned the same way.
- **And it needs smoothing, which tilt also already gets.** `leanProfile` takes a ±8-sample moving
  average. `applyMagnet` reads `q[3]` **raw, per sample** — so at these CVs the magnet's strength and its
  standoff height are being modulated by sensor noise. Compare the lean column: sd 0.03–0.14 against a
  mean of ~0.39. **Tilt is by far the cleaner channel in a real hand**, and it is the one that got the
  care.

**Sizing ω against real speeds.** At his median 0.059 and a speck spacing of ~0.005:

| ω | per-sample step at 60 Hz | neighbour phase gap at median speed |
|---|---|---|
| 0.5 rot/s | 3° | 15° — a loose grain |
| 1 rot/s | 6° | 31° |
| 3 rot/s | 18° | **92° — full decorrelation** |
| 5 rot/s | 30° | 153° |

So **~3 rot/s** is the scatter end and the useful dial runs roughly **0.5–5 rot/s**. Note the per-sample
step depends only on ω and the sample rate, *not* on speed — so a fast flick cannot alias no matter how
quick it is, and the whole range stays clear of the 90°/sample ceiling. Speed changes only the spatial
frequency, which is the effect.

#### Simulating input, for testing the model

The channels can be driven synthetically, which is what makes the rotating-magnet model testable one
variable at a time — a hand cannot hold speed constant while sweeping `ω`. A `PointerEvent` with
`pointerType: 'pen'` carries `pressure`, `tiltX` and `tiltY`, and the studio reads them through exactly
the same path as real hardware. Verified end to end against the live build: a synthetic stroke committed a
magnet mark whose samples carried the pressure ramp (0.200 → 0.900) and the tilt sweep as sent, and the
specks moved.

Two things a simulator must get right, both found by getting them wrong:

- **Pace the events in real time.** Dispatching a stroke in a tight loop gives `dt ≈ 0.2 ms` — about 80×
  too fast — and since `w` carries `dt`, the magnet barely acts. `await` one frame between samples;
  ~17 ms reproduces 60 Hz.
- **Hover before pressing.** `restLean()` needs either 60 pen-down samples or five hover samples within
  500 ms, so a stroke that begins at pointer-down has no grip baseline to normalise against.

**And a finding that measurement turned up, where reading the code had only implied it:** the magnet mark
commits as `{kind, seed, samples, tgt}` — **no `rest`**. Confirmed by inspecting a committed mark:
`'rest' in mark === false`. So `applyMagnet` reads `q[4]` **raw**, and the magnet is the one tool that
never rest-normalises its tilt. Two people with different natural grips get different magnet behaviour
from the same gesture, and the same person changing grip changes the tool. That is the "second, unrelated
normalisation" noted above, now measured rather than inferred — and folding it into the shared adapter
fixes it as a side-effect.

#### Measured on the phone — and it refutes the coalescing hypothesis

A 53-second capture from Chris's **Galaxy S23 Ultra (Android 16, WebView)**, 3,537 events, 59 strokes:

| | measured |
|---|---|
| `pointermove` | 1,690 events — median interval **16.6 ms → 60.2 Hz** |
| `pointerrawupdate` | 1,705 events — **also 60.2 Hz**, offered but no finer |
| **coalesced** | **24 events in the whole capture** (0.7%) |
| pressure (pen down) | 0.000–**0.613**, median **0.089**, p90 0.298, 597 distinct values |
| lean | 1.0–70.9°, median 41°, 540 distinct values |
| hover | **52% of all events** |

On that evidence alone the coalescing idea looked dead: 24 events out of 3,537, and `pointerrawupdate`
offered but returning the same 60.2 Hz. **Then the same pen was captured in Chrome on the same phone, and
the webview turns out to be the outlier.** One device is not a population, and a single capture nearly
retired a real finding:

| same pen, same phone | WebView (Claude app) | **Chrome 153** |
|---|---|---|
| `pointermove` | 60.2 Hz | 60.2 Hz |
| `pointerrawupdate` | **60.2 Hz** — offered, no finer | **476 Hz** |
| coalesced events | 24 (0.7% of all) | **11,232 (49.5% of all)** |
| pressure max | 0.613 | **1.000** |
| pressure distinct values | 597 | **3,143** |

What each listening strategy would actually capture:

| | WebView | Chrome |
|---|---|---|
| `pointermove` only — **what the studio does today** | 31.7 /s | 23.3 /s |
| move + `getCoalescedEvents()` | 32.1 /s (**×1.0**) | 135.3 /s (**×5.8**) |
| `pointerrawupdate` | 32.0 /s (×1.0) | 89.1 /s (×3.8) |

**So the studio is discarding about five-sixths of the pen in Chrome, and nothing in the webview.** Both
statements are true and neither generalises. Consume coalesced events: it costs nothing where there is
nothing to gain, and recovers 5.8× where there is.

And it changes the pressure conclusion from *should* to *must*. The **same pen** tops out at 0.613 in one
browser and 1.000 in the other, with five times the distinct values. A calibration constant tuned in
either one would be wrong in the other, so the working range has to be **learned at runtime** — exactly
like the rest grip, and for exactly the same reason.

**And the authoring actually happens in Chrome**, which settles which column matters. Chris works in
Chrome on the phone rather than the Claude app view, because the app's webview does not keep
`localStorage` across a close — the studio autosaves correctly (debounced, flushed on `visibilitychange`
*and* `pagehide`) and the webview discards it anyway, silently.

So the ×5.8 is not a hypothetical about some other browser. It is being lost on every stroke of the real
work, in the environment the real work happens in. That moves consuming coalesced events from "worth
doing" to the first thing worth doing.

**What the capture does confirm, with better evidence than the granite sheet:**

- **Pressure needs normalising.** Even when deliberately exercising it — press light, then hard, as the
  probe asks — the median is **0.089** and p90 is **0.298**. The top third of the range is reachable but
  rare and 1.0 never arrives at all, so mapping raw 0..1 onto the effect spends most of its resolution on
  pressures nobody applies. 597 distinct values means the sensor has plenty to give; the mapping is what
  wastes it.
- **Tilt is the strong channel.** 1–71°, median 41°, 540 distinct values — swung across most of its range
  in ordinary use.
- **Hover is abundant.** Over half of all events. Learning the rest grip from hover, proposed above on
  principle, has plenty of data to learn from in practice.

#### The studio does not ask for the extra samples

`getCoalescedEvents()` appears **nowhere** in `app/stone-author.html`, and `pointerrawupdate` is not
listened for either — one sample per `pointermove`, which is vsync. The stylus probe asks for both, which
is how the table above exists.

Measured, that is **×5.8 of the pen thrown away in Chrome and nothing in the webview**. Worth doing, and
cheap: `getCoalescedEvents()` is one call inside the existing `pointermove` handler, it degrades to
nothing where the browser has nothing extra, and every channel gains at once — a finer speed estimate, a
denser tilt profile, more of the pressure curve.

Two cautions that come with it. The extra points carry their own timestamps, so anything deriving `dt`
must read each sample's own rather than assume a frame; and a stroke's sample count stops being a property
of the gesture, which matters to the per-stroke median `dt` calibration proposed above.

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

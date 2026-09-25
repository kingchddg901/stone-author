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
| magnet | **flips the polarity of alignment.** With one caveat below. |

The magnet caveat is worth stating precisely, because the obvious reading does not work. Its comb term
uses **doubled angles**:

```js
c2 = Math.cos(2 * Math.atan2(ay, ax)),  s2 = Math.sin(2 * Math.atan2(ay, ax))
```

Doubling is what makes a speck *axial* — "a speck has no front", so θ and θ+180° are the same thing.
Which means negating the tilt axis, `(ax, ay) → (−ax, −ay)`, is a **mathematical no-op**: it shifts the
angle by π, and doubled that is 2π. So a sign cannot flip the magnet's *axis*.

But the magnet already has a `×−1` that does flip its behaviour — `sign = M.mag`, the Align/Scatter
toggle, where positive rotates specks toward the field and negative randomises them. **That** is the
polarity a signed tilt could drive: lean one way to comb the specks into order, the other way to break the
order up, instead of reaching for a button. Same idea, different term.

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

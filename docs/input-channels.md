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
| **tilt** | stylus lean + azimuth, or an authored value | its orientation, and any asymmetry that implies |

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
   the user never had.
4. **A declaration.** Nothing states which channels a tool consumes; it is discoverable only by reading
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

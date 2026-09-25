# Moon as a moving-body event

> **Moon is a moving-body simulation authored by a stroke.** Position records the body's trajectory,
> pressure its influence/proximity, tilt its orientation, and pointer timing its speed and dwell. Stylus
> hardware supplies those channels directly; mouse and touch supply the unavailable channels through
> explicit controls. Both produce the same semantic Moon event.

**Status: designed, not implemented.** Chris's design. What ships today is described under
[Where the code stands](#where-the-code-stands), which is a short list — most of the input this needs is
already being captured and then discarded.

Companion docs: [`architecture.md`](architecture.md), [`capabilities.md`](capabilities.md),
[`functions.md`](functions.md) (`applyMoon`, `applyMagnet`).

## The shift

The existing definition already fits: *Moon warps geometry as if a gravitational body had passed through
it.* What changes is that **the stroke should describe the event**, not merely say where to apply a canned
warp.

A Moon stroke is not:

> Paint deformation along this line.

It is:

> A body travelled this trajectory with these continuously varying properties. Work out what happened to
> the stone as it passed.

Four channels describe one event:

| channel | what it is |
|---|---|
| pointer position | the body's trajectory |
| pressure | the body's influence / proximity |
| tilt | the body's orientation, and the asymmetry of its field |
| timing | how long its influence acted on each part of the slab |

That means the **complete pointer history** is useful. Store sampled position, time, pressure and tilt —
do not reduce the gesture to a polyline at capture time.

## Speed and dwell come for free

Speed needs no slider. It is derived: `v = distance / Δt`.

A fast sweep means the body spent little time influencing any region; a slow pass means greater exposure;
a pause means the body lingered and deformation accumulated there.

```
flick through  →  brief encounter
slow drag      →  sustained encounter
dwell          →  local catastrophe
```

These are **not three modes**. They are consequences of how the body was moved.

## Pressure is the body's state, not the brush's

Pressure is the continuously varying third channel, and the conceptual reading matters: it is
**influence / proximity**, not "make the brush stronger because the pen pressed harder."

One gesture can therefore begin distant, descend into a close encounter, and recede:

```
light ───────╮
             ╰━━━ HEAVY ━━━╮
                           ╰──── light
```

The resulting warp inherits that history.

## Tilt is orientation

Tilt gives the passing body an axis. Upright is the roughly symmetric case; leaning supplies a direction,
letting the deformation become asymmetric along the stylus orientation. Because tilt varies continuously
during a stroke, the body's orientation can change **during** the encounter.

```
stroke geometry = where it went
pressure        = how strongly / closely it passed
tilt            = how it was oriented
time / speed    = how long its influence acted
```

This is the studio's input philosophy generally: *the gesture describes what happened; the renderer works
out what that event does to the material.*

## Mouse and touch cannot be second-class

Moon must not require a pressure/tilt stylus. The baseline input is pointer + time; stylus data is an
**enhancement, not a requirement**. So Moon needs an input mode that supplies the missing dimensions
explicitly — a mouse user sets the equivalent proximity and orientation deliberately, then draws the
trajectory.

The point is to avoid a crippled "mouse Moon". The simulation receives the same conceptual event either
way; only the source of the channels changes.

```
                 ┌─ stylus pressure ─────┐
physical stylus ─┼─ stylus tilt ─────────┤
                 │                       │
                 │                       ▼
                 │                 MOON EVENT
                 │              path
                 │              pressure
                 │              orientation
                 │              time / speed
                 │                       │
                 │                       ▼
                 │                  deformation
                 │
mouse / touch ───┼─ explicit pressure ───┤
                 └─ explicit tilt ───────┘
```

**Same event model, different input adapters.** That separation is the architectural core and should
survive any rewrite of this note.

**And it is not Moon's.** The adapter is general: one thing turns a raw stroke into named channels, and
each tool consumes all of them, some, or none. A vein wants pressure and lean; the magnet wants all four;
a chip wants only the path. Moon is simply the first tool that needs the complete set and has none of it,
which is why the idea surfaced here — but it belongs at the input layer, shared. It is written up on its
own terms in [`input-channels.md`](input-channels.md), including the two extractors that already exist.

It also means a recorded Moon is not merely "a warped result". It is a **replayable semantic event**
carrying a trajectory and its changing parameters — which is what makes replaying Moon history possible
later. This design comes first: it is how that history gets authored in the first place.

## Where the code stands

The gap is narrower than it looks, because **the capture layer already records all four channels for every
stroke**:

```js
gesture.samples.push([ f[0], f[1], now(), pen(e), leanOf(e), azOf(e) ]);
//                     x     y     time   pressure  lean      azimuth
```

`applyMagnet` already consumes all of them — `q[2]` as a per-sample `dt` so a slow pass aligns harder than
a flick, `q[3]` to bring the magnet closer, `q[4]`/`q[5]` as the magnet's axis. So the precedent is in the
same file.

`applyMoon` discards three of the four on its first line:

```js
const path = resample(m.samples, 0.006);
```

Resampling to **even spacing** does not merely ignore timing, it actively destroys it: a fast sweep and a
slow drag along the same path produce an identical polyline. What remains is summed as
`(path[i] − path[i−1])` weighted by a radially symmetric falloff and scaled by a single constant
`st = 0.5 × moonStrength`. Which is to say: today's Moon is exactly the thing the design rules out —
deformation painted along a line.

So the work is, in order:

1. **Stop discarding.** Have `applyMoon` walk `m.samples` rather than a resampled polyline, so time,
   pressure and tilt survive to the point of use.
2. **Derive speed and dwell** from consecutive sample timestamps, as `applyMagnet` already does.
3. **Let pressure vary along the stroke**, replacing the constant `st`.
4. **Let tilt make the field asymmetric**, replacing the radially symmetric `f = 1 − d²/R²`.
5. **Add the explicit channel controls** for mouse and touch — but not here. That is the shared input
   adapter, and the same gap exists in the Magnet, which falls back to a silent default (`lean = 55/90`,
   axis along travel) rather than to anything the user authored. See
   [`input-channels.md`](input-channels.md); its steps 1 and 2 are prerequisites for this one, and unlike
   this one they change nothing on screen.

Step 1 is the one that unblocks the rest, and it is also the one that changes existing renders: a Moon
mark authored before this would begin honouring timing it was drawn with but never expressed. Worth a
deliberate decision about old slabs rather than a silent change — see the determinism note in
[`gallery.md`](gallery.md).

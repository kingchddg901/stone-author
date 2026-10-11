# Glass: material path 3 in Stone Author

**LOCKED at build 2026.10.11.16.** Complete and in use; the open items below are directions, not
debts. Companion to [`wood.md`](wood.md); the reader-facing summary is in
[`architecture.md`](architecture.md) under “Glass — why the colour cannot mix”.

## The model, in one line

**Mould → pour → partial set → barriers out → stir → form**, and the forming is an ordered list of
warps the renderer walks *backwards*. Written up for readers in `docs/architecture.md` under
"Glass — why the colour cannot mix"; this note is the working detail behind it.

Two rulings shape everything, and neither is negotiable from inside the code:

- **The glass is fake.** Any order of operations is allowed. Physical plausibility is not the goal.
- **It needs to look right, not be a fluid sim.** The whole thing is a distance field, a label
  lookup and some scalar multiplies. No iteration, no solver. When a measurement starts getting
  refined past the point of visible difference, stop.

## Why the field holds a LABEL

Each colour went into its own compartment and was already stiff before anything could diffuse, so
immiscibility is a *fact of manufacture*, not a rule anybody enforces. The field answers **which
colour is here**, as an integer. Sampling a label through a deformation cannot average — so two
colours fold past each other and stay two colours with no code defending it.

Everything else follows from refusing to blend:

- **A lap is a STACK.** Two ribbons overlapping means light crosses both, so absorptions *add* and
  the seam goes darker. Never an average.
- **A slump is a WATERSHED.** Nearest poured source wins, which is what a uniformly advancing front
  gives, so the compartment with the most frontage takes the middle of a void and the others take
  the corners without being told to.

## The four moulds, and who picks the colour

| mould | shape | colour chosen by |
|---|---|---|
| `strips` | parallel bands; lay angle, twist, lap, wander | cycled, in order |
| `radial` | wedges about the centre | cycled, in order |
| `cells` | authored, each its own W × L | **named per cell** |
| `blobs` | jittered tray of discs | hashed from the grid cell |

`cells` is the only one where you say which colour goes where. Six tokens (`glassA`–`glassF`).

**The replica trap, already paid once:** the token set is copied in four places — the painter's
`canes` array, the `CN` clamp, the cells editor's cycle, the blob hash. E and F were added for the
five-colour test and the clamp stayed at four, so two colours were reachable only from `cells`.
Nothing errored. `probe-glass-lay.mjs` now reads the clamp *and* counts the tokens out of source and
walks every mould asking what it can produce. **Add a seventh token and that probe is the thing that
tells you what you forgot.**

## The budget — what stops a spread

Not a distance anyone sets: **running out**. A ribbon starts at `start` × target thickness (2×
default, 4× suits blobs) and thins as it covers more, so it stops at target.

- Oblong: area is a quadratic in `(r + d)`; the reach is its root (`glassCellSpread`).
- Disc: `d = r(√start − 1)` exactly (`glassBlob`).

A ribbon that runs out leaves void for a neighbour that has not, and **two fronts with different
budgets do not meet halfway** — which is where the curved joins come from. Measured on the five-cell
test at 2×: Green 1.31 in, Red/Purple 1.79, Blue 2.63, Orange 3.20. *Not ordered by size*, because a
bigger ribbon has more material **and** more perimeter to spend it over. That non-ordering is the
thing that makes it a budget rather than a scale factor.

**Every operation resets thickness to 2×**, deliberately, so there is no running total threaded
through the op list. Tracking it would be a second state machine earning nothing visible.

## RIBBONS ARE OBLONGS, NOT RECTANGLES — the one that cost the most

Every straight edge in the field traced back to the source being a box. **Equidistant between two
rectangles is a perpendicular bisector** — dead straight however round the fronts are — and three of
those meeting is a cut gemstone.

**Two fixes that cannot work, in case either looks tempting again.** Rounding each cell's own
front gives the taper and cannot touch the facets, because the facets were never a front. Fading
the seam where fronts meet hides them and leaves the cause. Only curved *sources* remove them.

Think of a rolled ribbon as rolled dough, which also settles the profile and not just the outline:
thickest in the middle, feathering at the rim, no cliff edge. The rim is **16% of the corner radius** — at 50% it ate a third of every
ribbon and the sheet read as airbrush. The tell was `start = 1`, where nothing can spread, so the
softness could only have been the rim.

## The op list

`GLASS.ops`, oldest first, walked **backwards**, each op undoing itself in the frame the next handed
it. Composition, not a sum — and a sum is the failure that looks fine, because every pair would
commute and every reorder would be a silent no-op.

| op | forward |
|---|---|
| `spin` | θ += a·r — the outside drags round more than the centre |
| `blow` | r *= a — everything spreads from the centre |
| `roll` | x *= a, y /= a — area kept, so it lengthens a pattern without fading it |
| `stir` | the baked warp field (whole-slab current + every moon pass) |
| `press` | a **drawn** roller pass — see below |

Empty list = a plain pour. The forming buttons are **presets that fill the list**, not modes.

Proven by swapping pairs and counting changed labels: spin/roll 31.7%, stir/blow 11.2%, spin/blow
1.3%. `blow/roll` is **0.0% and correct** — both are diagonal scales and diagonal matrices commute.
The probe knows that and does not call it a defect; it reds on a *non*-commuting pair coming back
identical.

**A mould is not a warp.** Wedges were radial before anything happened; a spin shears what is
already there. Radial mould spun = pinwheel; strip mould spun = swirled stripes. Collapsing the two
would lose one.

## The roller

A drawn mark, like the moon. A pass is a path, so a point's place under it is **(along, across)** —
stamps repeat every C along, the face spans a fixed distance across, and curves come free because
arc length does not care that the path bent.

**C = πD.** The circumference *is* the repeat; not a pitch anyone sets. A piece shorter than C never
sees a full turn, so an arc of the roller never touches it — and with stamps staggered along the
face that arrives as **a band across the sheet with no marks on it**. On the 12 in test piece against
C = 18.85 in, 8 of 24 stamps could not land.

**One, start down:** phase 0 is arc length 0, where the stroke began. Exact, where the straight roll
had to infer it from pane corners.

A drawn pass **presses**; it does not stretch. Stretching along a curve needs the inverse map from
path coordinates back to world — not built.

Flutes are *not* replaced by stamps: circumferential grooves have a pitch running across the sheet,
genuinely free of C. Different roller surface, both real.

### Pressure and tilt

**Tilt is signed against the path normal, never the screen.** Leaning across the pass tips one end of
the face down; leaning along it is how you hold the pen and must do nothing. The magnet reads azimuth
as a world direction — right for a magnet, and here it would make the control change meaning every
time the path curved. Measured on a *curving* pass: across spreads the bite 0.25→1.00, along gives
0.000.

## Open

- **Stretch along a drawn pass** — needs the inverse map from path coordinates back to world. A
  drawn pass presses; it does not stretch, and that is why it is its own op rather than a `roll`.
- **Refraction** — nothing behind the sheet yet, so nothing is refracted through it and the slope
  of the thickness is the honest cue. It is also what would let glass sit over wood.
- `seedStretch` overlaps the blow and roll ops: both elongate bubbles, so a drawn-out sheet gets it
  twice. Harmless at the defaults, unresolved in principle.
- The scatter control is load-bearing in a way that is not obvious: at zero, every blob has
  identical neighbours at identical distances, so every watershed is a straight line and the tray
  comes out as a square-celled quilt rather than as blobs. **If the blobs ever read as tiled, check
  the scatter before the budget.**

## Probes — all in `tools/`, all run in Node

`probe-glass-lay` (moulds + op order + the colour-set anchor), `probe-glass-stir` (warp field: sign,
units, bake error), `probe-glass-press` (the five-cell test), `probe-glass-blobs`, `probe-glass-roller`,
`probe-pen-calibration`.

**They run in Node because the browser pane cannot drive this app.** The pane stops servicing
`requestAnimationFrame` when the desktop window is not in front, and the redraw's `queued` guard then
latches on a frame that never runs — so every canvas read returns the frame painted at load. That
surfaced as *twelve identical cells*, which reads exactly like a finding. Shimming rAF after load
cannot clear the latch; serving a copy with the shim prepended **before** the app's script can.

### Probe failures already paid for — every one was the probe, not the code

Worth reading before writing another:

- **Twelve identical cells** — stale canvas, above. Ablate any canvas probe: paint something
  yourself and assert it gets overwritten.
- **"Leaning along does nothing" passed vacuously** — both sides zero, because tilt was doing
  nothing at all. *Guard a comparison claim on the positive case having fired.*
- **The tilt did nothing** because the synthetic hand held a perfectly constant lean, and `tiltReal`
  correctly reads that as hardware with no sensor. **A perfectly steady lean is indistinguishable
  from no sensor, by construction** — same shape as a flat 0.5 for pressure. A hand is never that
  steady.
- **A tilt case that could not discriminate** — the test hand laid to 0.35, which is 0.28 past rest
  and therefore almost exactly the fixed 25/90 = 0.278 it was meant to be distinguished *from*. A
  test that cannot tell two answers apart passes on either.
- **Moved the pane across the roll to test phase**, which is measured along it. Could not have
  changed; reported a number with no meaning.
- **"Nothing interweaves at rest"** ignored that jittered cookies can be *placed* touching.

## The pen calibration (not glass, found here)

`calProfile` was measured, stored, displayed — and **read by nothing**, while pressure sat on a fixed
`0.15 + 1.7p` and tilt on fixed 9°/25° thresholds. Now wired.

The split that made it clean: **the output range is art direction** (how far a vein may thin or
thicken) and is untouched; **the input mapping is the hand**. On a hand living in the bottom tenth,
a natural stroke went 0.303 → 1.000 — its ordinary stroke was being drawn faint. A stiff grip that
only lays to 0.18 got 0.008 of the tilt effect; fitted, full lay is full effect.

`calProfile` is declared beside the channels that read it, not in the section that fills it: `let`
has a dead zone and the readers sit thousands of lines above where it used to be declared.

With no profile the curve is **bit-for-bit** what it was — checked over a thousand points.

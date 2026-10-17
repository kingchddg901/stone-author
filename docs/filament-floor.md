# The filament floor: giving glass a smallest feature

Status: **scoped, not built.** The defect is measured, the cause is located, and the fix is a
model correction rather than a rendering trick.

A glass render shows structure that is not in the glass. In the worst band measured it correlates
**0.084** with the truth while reporting 3.7x the contrast — not less detail, a different picture.
The cause is that the field has no smallest feature, and the reason it has none is a line of the
model that was left out on purpose.

## The invariant this is built under

**A single layer never mixes.** Two ribbons fold past each other and stay two ribbons; the field
answers *which colour is here* as an integer and the average of ribbon 3 and ribbon 7 is not a
ribbon. A lap stacks — light crosses both and the absorptions add — and that is the only way two
colours ever meet. See [`glass.md`](glass.md).

Nothing below weakens that. The fix does not blend, at any scale.

A pixel is a separate matter: a sensor wider than a ribbon edge records a mixture of what it covers,
because the pixel is wide, not because the glass mixed. That is a display property and it is allowed.
It is also not what this document is for.

## What was measured

One 128 x 128 patch, rendered at five sample rates and box-averaged back to one grid, so every row is
the same physical area. `corr` is against the 1024-samples-per-pixel reference.

| samples/px | rendered at | speckle band | flow band | wood |
|---|---|---|---|---|
| 1 | 262,144 | **0.084** | **0.849** | **0.9999** |
| 16 | 1,048,576 | 0.741 | 0.982 | 1.0000 |
| 64 | 2,097,152 | 0.959 | 0.995 | 1.0000 |
| 256 | 4,194,304 | 0.992 | 0.999 | 1.0000 |
| 1024 | 8,388,608 | 1.000 | 1.000 | — |

| | contrast at 1 spp | converged | overstated |
|---|---|---|---|
| speckle band | 25.45 | 6.85 | **3.7x** |
| flow band | 25.75 | 20.33 | 1.27x |
| wood | 26.86 | 26.84 | 1.0005x |

The mean never moves — 143.97 at 1 spp against 143.88 at 1024 — so the renderer is unbiased. The
variance is what is fabricated, which is the signature of point-sampling rather than of a mistake in
the field.

**Only glass does this, and that is measured rather than assumed.** Stone reached the quantisation
floor at 1,048,576; wood renders at 0.9999 on one sample. Both have a smallest feature. Glass does
not, and the next section is why.

## The cause: a thickness that resets

The op list composes into a stretch-and-fold. On the slab measured:

    stir -> blow 1.8 -> blow 1.6 -> spin 1.2 -> stir -> blow 1.6 -> stir -> roll 2.5

`roll` is `x /= s; y *= s`, an area-preserving stretch. `spin` rotates by an angle proportional to
radius, which is a shear. `stir` advects through a displacement field. Composed, that is a horseshoe,
and the ribbon boundaries halve geometrically with every fold.

The horseshoe is right — it is what working a gather does. What is missing is the consequence:
**stretching a ribbon thins it**, and glass that gets thin enough stops being a ribbon.
[`glass.md`](glass.md) records the decision that left this out:

> Every operation resets thickness to 2x, deliberately, so there is no running total threaded through
> the op list. Tracking it would be a second state machine earning nothing visible.

That is the line the measurement falsifies. The absence of that running total is exactly why the
field keeps subdividing: nothing ever tells it the glass has run out of material to subdivide with.

## The fix: pinch-off, not blending

Thread thickness through the op chain. Each op's local stretch thins the ribbon it carries; where a
ribbon's width falls below what glass can physically hold, it is no longer there.

**What happens to it is breakup, not dissolution.** Surface tension drives a stretched filament to
bead and part (Rayleigh-Plateau); the thread pinches off and the surrounding colour closes over the
gap. So below the floor the label **snaps to the dominant neighbour**. One ribbon takes the space.

That is a watershed, which the model already speaks — a slump resolves by nearest poured source
winning. It creates no colour that was not already a ribbon, so the invariant holds untouched.

**The field becomes band-limited at the floor**, and one sample per pixel is correct for any render
whose pixel is at or below it.

## The scale, which is physical rather than chosen

Worked-glass filament breakup is of order 1-50 um. On a 96 in slab:

| floor | one pixel at |
|---|---|
| 5 um | 487,680 |
| **10 um** | **243,840** |
| 25 um | 97,536 |
| 50 um | 48,768 |

A 10 um floor lands one pixel at 243,840 — within 7% of 262,144. The floor is not a fudge sized to
fix a rendering problem; it is a property of glass that happens to sit where these renders already
are. Below the matching size the output is honest but coarse, which is the correct behaviour for a
picture too small to hold the detail.

## The gate: protect the bands

The floor and supersampling act the same way on the picture — both remove what is below the scale
the render can carry and leave what is above it. So neither is judged by how much it removes. Both
are judged by **what survives**.

That makes one two-sided test the whole acceptance criterion:

| band | must become | because |
|---|---|---|
| speckle | near-uniform, matching the 1024-spp reference | its structure is not in the glass |
| flow | unchanged, still matching its own 1024-spp reference | its structure **is** in the glass |

**The second row is the one that can fail, and it is the floor's own risk.** Set the floor too
coarse and it stops being a filament limit and starts merging ribbons that the render could have
resolved — destroying exactly the bands it exists to protect, and doing it invisibly, because a
merged band looks like a rendered band. The margin is not generous: at 262,144 a pixel is 9.3 um and
a 10 um floor sits right on it, while the flow band's own structure is only a little above that — it
scores 0.849 at one sample and carries 27% excess contrast, so most of it is resolvable and some of
it is not.

So the floor is not a constant to pick once and move on from. It is the one number this change turns
on, and the gate has to measure both rows every time it moves.

## Why not supersampling

Integrating the field harder is the other way to the same image, and it was scoped first. It is worse
on every axis except that it needs no model change:

| rate | speckle `corr` | cost | a 94.9 min master becomes |
|---|---|---|---|
| 2 x 2 | ~0.4 | ~4x | about 6 h |
| 4 x 4 | 0.741 | ~16x | about 25 h |
| 16 x 16 | 0.992 | ~256x | about 17 days |

The rate that fixes the speckle is unaffordable and the affordable rate does not fix it. The floor
costs two finite differences and fixes it at every size, including the preview, which supersampling
would not.

They are not exclusive. **The floor is the fix**; modest supersampling remains available afterwards
as edge cleanup on ribbons still above the floor, which is where the flow band's 0.849 sits. That is
a display choice about boundary pixels and carries no claim about the material.

## Risks worth naming before starting

- **It breaks byte-identity with every master on disk.** A floored render is a different picture from
  the one stored, so `renderSig` must take the floor or two masters with one `inputs` will disagree —
  the one thing that signature exists to prevent. [`sidecars/README.md`](sidecars/README.md) already
  carries an era boundary for positional marking; this is a second.
- **The floor must not be resolution-dependent.** If it is derived from the pixel rather than from the
  glass, two sizes of one slab stop being the same picture and cross-tiling identity goes with it.
- **Dominance has to be decided deterministically**, and identically on every engine, or masters stop
  agreeing across the fleet — which [`renderer-determinism.md`](renderer-determinism.md) measures and
  the kit depends on.
- **It changes the look of every existing glass slab**, including ones that were tuned against the
  aliased output. The speckle band becomes a near-uniform tone, because that is what is there.
- **Glass only.** Stone and wood have smallest features already and gain nothing.

## Staging

1. **The measurement as a probe.** Render one patch at 1, 4, 16 and 64 spp and assert the correlation
   series rises and the contrast converges. Ablate with a band-limited field, which must show no
   change with rate — without that, a probe that always reports improvement proves nothing.
2. **Thickness through the chain**, recorded but not yet acted on, so the quantity can be inspected
   against renders before it changes any pixel.
3. **The floor, behind a flag.** The gate: with the floor at zero the output must be byte-identical
   to today, so the path ships before it is switched on.
4. **Pinch-off by dominance**, with a probe that asserts no output colour is absent from the ribbon
   set — the invariant, stated as a test that can go red.
5. **A floored reference master** at a size small enough to afford, so later claims have something to
   be wrong against.

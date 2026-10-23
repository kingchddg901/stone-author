# One pixel of glass, end to end

Everything that happens to produce a single output pixel, in order. Written because the question
"where does the time go" kept being answered by guessing, and because the stack is short enough to
hold in one page once it is written down.

Notation: `F` is the per-tile form state, built once in `paintGlassContent` before any pixel. Capital
letters like `F.TH` are precomputed constants for the whole tile. `ox, oy` are slab coordinates in
feet.

---

## 0. Precomputed once per tile, never per pixel

| | |
|---|---|
| `F.OPC` | the op list compiled to records — integer kind, coerced numbers, trig taken, stir lattice and press roller resolved |
| `F.SG` | the warp lattices, one per distinct stir range, **memoised across tiles** — 161 × ny of paired Float32 |
| `canes[]` | the six glass colours as absorption coefficients, `1 − c/255` per channel |
| `kr, kg, kb` | the base colour, same form |
| `LBR, LBG, LBB` | the light behind the sheet |
| `F.MEX`, `F.MHL`, `F.MD`, `F.MRIM` | mould cell extents, half-lengths, depth limits, rim widths |
| `SSO[]`, `SSN` | supersample offsets and the reciprocal of the sample count |

---

## 1. Screen pixel → slab coordinate

```
su, sv   = inverse affine of the tile's placement, stepped per pixel
ssu, ssv = su + iv.a·SSO[jx] + iv.c·SSO[jy]        (one per supersample)
cu, cvv  = clamp(ssu, 0, 1), clamp(ssv, 0, H)
ox = paneX + (cu  − 0.5)·SLAB_FT/12
oy = paneY + (cvv/H − 0.5)·SLAB_FT·H/12
```

---

## 2. Walk the forming backwards — `glassUnform`

The ops run **in reverse**: the painted point is where the glass ended up, and we ask where it came
from. For each compiled op, newest first:

```
spin    r  = |p − c|
        θ  = atan2(py, px) − a·r                   radius-proportional rotation
        p  = c + r·(cos θ, sin θ)

blow    p  = c + (p − c)/s                         uniform scale about a centre

roll    p' = R(−d)·diag(1/s, s)·R(d)·p             anisotropic scale on its own axis
        and reads its stamp marks here, before the roll is undone

stir    (cu, cvv) = slab → lattice coordinates
        d = −bilinear(S.u, S.v, cu, cvv)           the moon field, read backwards
        p += d·SLAB_FT/12

press   reads the roller's own (along, across) coordinates and accumulates `press`
```

Output: `sx, sy` — where this pixel's glass was before forming — and `press`.

**Measured cost, 4096 tile:** the whole walk ≈ 34%. Of that, 4 spins are **24.4%** of the tile and
4 stirs **9.0%**; 7 blows and a roll together are **~0.3%**. The cheap ops are the foldable ones.

### The moon field, in three stages

```
1. one moon → a displacement function          (moonDisp)
   R  = 0.08·moonReach,  st = 0.5·moonStrength
   path = resample(samples, 0.006)
   for a point p, over path samples sᵢ within R:
       f  = 1 − |p − sᵢ|²/R²                   soft ball, 1 at centre, 0 at rim
       a += (sᵢ − sᵢ₋₁)·f
   displacement = a·st                          O(path length)

2. all moons → one lattice                      (glassWarp)
   161 × 101 cells, each summing every moon × the mask
   O(path) becomes O(1): 16,261 cells instead of 16.7M pixels

3. per pixel → bilinear read                    (glassUnwarp)
```

Stage 2 is the whole trick and it was already there. What is left per pixel is four cache lines of
lattice per stir, because `u` and `v` are separate arrays and the two rows are 644 B apart.

---

## 3. The draw direction — `glassFlow`

```
spun    (ox, oy)/|p|        radial: varies with position
poured  (0, 0)              no draw
blown   (0, 1)
rolled  (1, 0)
```

---

## 4. Thickness — `glassFormT`, **called three times**

```
T = F.TH
if RM > 0 and flowing:
    a = p·fv,  c = p⊥fv                         along and across the draw
    T *= 1 + RM·0.30·(fbm2(c·RS, a·RS·0.06, 71) − 0.5)·2
else if RM > 0:
    T *= 1 + RM·0.18·(fbm2(ox·RS·0.5, oy·RS·0.5, 11) − 0.5)·2

spun:    r = |p|
         T *= 1 − 0.45·min(r/FR, 1)
         T += TH·2.0·exp(−(r/(FR·0.07))²)       the bullseye
         T += TH·RM·0.14·sin(r·RS·7)            concentric rings from the spin
rolled:  f = frac(ox·FP)
         T += TH·FD·(1 − |2f − 1|)              the roller's flutes

T = max(T, 0.05)
```

Called at `(ox, oy)`, `(ox+ε, oy)` and `(ox, oy+ε)` — the third and second are a **finite-difference
gradient** `gu, gv`, used only for shading. So two of the three calls exist to light the surface, not
to measure it.

**Measured, 1024 tile, 5 reps interleaved, reference drift −2.2%:**

| | |
|---|---|
| baseline | 1,398 ms |
| + the two gradient calls | 1,788 ms → **they cost 390 ms** |
| + one extra base call | 1,587 ms → **one `formT` costs 189 ms** |

The two cross-check: 2 × 189 = 378 against 390 measured, 3.2% apart. All three calls are **40.6%** of
that tile; the gradient pair alone is **27.9%**. Scaled per-pixel to a 4096 tile — it is pure
per-pixel work — the gradient is about **6.2 s of a 16.9 s tile, 36.5%**, or roughly three minutes of
an 8:18 master.

**An analytic gradient is available and would collapse three calls into one.** `vnoise` interpolates
with a smoothstep, `sx = tx²(3−2tx)`, whose derivative `6tx(1−tx)` is closed-form — and value and
both partials share the *same four corner hashes*, which are the expensive part. Twelve hashes
instead of thirty-six.

It is **not bit-exact**: a closed-form gradient and a finite difference at ε = 0.004 are close, not
equal, so no existing master reproduces. Note where it lands, though — the gradient feeds only `sl`
in the shading multiplier below. It never touches a coordinate and never touches the ribbon label, so
it moves nothing across a boundary. That is a different class of change from the spin identity in §2,
which moves coordinates and would jump pixels by up to 130 levels. The call site was re-verified on
build `2026.10.22.172`: `gu`/`gv` are read at exactly one line, `sl` at exactly one, and `m` is a
plain multiplier on the final RGB that never reaches `T`, the absorption terms or `glassLay`.

**The SIZE of it was asserted here and not measured, and the assertion was wrong.** This said the
shift was "a fraction of a level". [`tools/probe-glass-gradient.mjs`](../tools/probe-glass-gradient.mjs)
scores it over 1,600 points per form at the production ε = 0.004:

| form | mean | worst |
| --- | --- | --- |
| spun, flowing | **4.75 levels** | 16.72 |
| spun, poured | **4.71** | 14.00 |
| rolled | 2.76 | **56.91** |
| blown | 2.62 | 15.13 |
| poured, no draw | 0.21 | 0.95 |

Only the drawless pour is under a level. The **class** claim survived measurement and the
**magnitude** claim did not, which is why the two are now stated apart: a safe class is not the same
as a small change, and this doc had been using one to imply the other.

**Landed in build `2026.10.22.172`.** `glassFormTG` returns the thickness and both slopes from one set
of hashes. Its value lines are `glassFormT`'s own character for character — re-associating even
`1 + k*(f-0.5)` would move `T` in the last place on every pixel — and section D of the probe asserts
the shipped function's thickness is **bit-identical to `glassFormT` across 8,000 points**. So the only
thing that moved is the slope, and the table above is the whole of the change rather than part of it.

---

## 5. What is in the melt — `glassMelt`

A 3×3 neighbourhood of a jittered lattice in draw-aligned coordinates:

```
cell size cs = 0.06 across, cs·SST along
for the 9 cells around (c₀, a₀):
    h = hash(cell)
    jittered centre, d² = squared distance / (0.32·cell)²
    if d² < 1:  q = 1 − d²
        h < SD       → a seed      (bubble)  out[0] = max(out[0], q)
        h > 1 − INC  → an inclusion (stone)  out[1] = max(out[1], q)
```

Then:

```
if melt[0] > 0:  T −= TH·0.50·melt[0]          a bubble is a void
if melt[1] > 0:  T += TH·0.60·melt[1]          a stone is not
if press  > 0:   T −= TH·0.55·press
T = max(T, 0.05)
if OPQ > 0:      T += (OREF − T)·OPQ
```

---

## 6. Shading

```
sl = (gu·Lx + gv·Ly)·0.05
m  = 1 + REL·0.55·(sl/(1 + |sl|)) − 0.45·melt[0] + 0.25·melt[1]
m  = max(m, 0)
```

The `sl/(1+|sl|)` is a soft clamp — slope mapped into (−1, 1) without a branch.

---

## 7. Which ribbon — `glassLay`

Only when `CORD > 0`. In radial moulds the coordinates are first bent: `gc = atan2(ga, gc)·(0.5+r)`,
`ga = r`.

For **cells**, the nearest two compartments by a signed distance, each a rounded box:

```
glassCellSDF(gc, ga, i):
    cx = (ex[i] + ex[i+1])/2,  hw = (ex[i+1] − ex[i])/2,  hh = hl[i]
    r  = min(hw, hh)·MOB                                   the oblong radius
    ax = |gc − cx| − (hw − r),  ay = |ga| − (hh − r)
    SDF = |max(ax,0), max(ay,0)| + min(max(ax,ay), 0) − r

priority p = d ≤ 0 ? d : d/MD[i]                           inside wins outright
keep the best two (i1, d1) and (i2, d2)
depth = edge · (1 − (1 − 1/MST)·far)                       rim falloff × thinning
```

Returns the compartment id, the neighbour's id if they lap, the lap weight, and the depth.

**This is where the "label" lives.** `out[0]` is an integer compartment, and the average of ribbon 3
and ribbon 7 is not a ribbon — which is why nothing downstream may interpolate a coordinate, why
supersampling averages **colour** and not position, and why every optimisation here has to be bit-exact
rather than close.

---

## 8. Colour, and why it is not the cheap part

```
ar, ag, ab = kr, kg, kb                                    the base absorption
if lay[0] ≥ 0:
    c   = canes[lay[0] mod 6],  s = CORD·0.6·lay[3]
    a  += s·c
    if lay[1] ≥ 0:                                         a lap: the neighbour is on top
        d   = canes[lay[1] mod 6],  sw = s·lay[2]
        a  += sw·d
```

Choosing the colour is an array index and three multiply-adds against a palette computed once per
tile. Then:

```
r = LBR·exp(−ar·T)·m
g = LBG·exp(−ag·T)·m                                       Beer–Lambert
b = LBB·exp(−ab·T)·m
```

**Three `exp` per pixel per sample.** The palette is free; the absorption law is not. This is also
exactly why the material reads as "a coded greyscale with a palette": `T` carries all the structure,
the cane choice only decides *which* absorption curve `T` is pushed through.

---

## 9. Average and store

```
accR += r  (and g, b)                                      over SS² samples
px[o]   = min(accR·SSN, 255)
px[o+1] = min(accG·SSN, 255)
px[o+2] = min(accB·SSN, 255)
px[o+3] = 255
```

Averaging happens on **colour**, after the lookup — never on the coordinate, for the reason in §7.

---

## What this adds up to

Per pixel per sample, at minimum: one op walk (sixteen records on the reference slab, four of them
spins), one `glassFlow`, **one** `glassFormT` — which may call `fbm2`, `exp` and `sin` — one
`glassMelt` over nine hashed cells, one `glassLay` over every mould compartment, and three `exp`
for the absorption.

That said **three** `glassFormT` until build `2026.10.22.172` replaced the finite difference with an
analytic gradient, and the line stayed wrong here for a day afterwards. §4 has the arithmetic.

Measured shares of a 4096 tile on the reference slab:

| | |
|---|---|
| spin ×4 | 24.4% |
| stir ×4 | 9.0% |
| blow ×7 + roll | 0.3% |
| everything else — flow, thickness, melt, ribbons, colour, coat | **66%** |

Two optimisations landed on 2026-10-17 (the warp field memoised per render, the op list compiled per
tile) and took a 65,535 master from 12.44 to 8.30 minutes and the preview from 1,618 to 327 ms. Both
removed work that was being **repeated**, not work that was being done.

## The corner cache, and what it taught about where the cost is

A third piece of repeated work, found on 2026-10-23 and shipped in build `2026.10.23.174`.

`fbm2` is three `vnoise` octaves and each `vnoise` reads four lattice-corner hashes, so twelve `nz`
calls per `fbm2`. There are **two `fbm2` call sites per sample** on this slab — `glassFormT`'s ream
and `glassLay`'s cord wander — which is 24 `nz` a pixel, and almost all of it is the same four
corners over and over. Instrumented over a 2048 tile:

| | same lattice cell as the previous call |
| --- | --- |
| 65,535 | **96.5%** |
| 1,048,576 | **99.3%** |

**The rate rises with render size**, because a finer pixel step puts more samples inside one cell —
the opposite of how adaptive supersampling behaves, where the prize shrinks as the render grows.
`vnoiseC` keeps the last cell's four corners per call site per octave and reuses them; measured on
the shipped path it hits **93.1%** at 65,535 and **99.3%** at 1,048,576.

It is **exact, not approximate**. `nz` is a pure function of three integers, so a cached corner is
the same double, and both `vnoiseC` and `fbm2C` carry their uncached siblings' expressions character
for character. `tools/probe-hash-cache.mjs` holds that bitwise over 43,042 calls and ablates four
ways; the renderer's own `check-same-image.mjs` is the end-to-end check.

**What was surprising is how little of `fbm2` the hashing turned out to be.** Eliminating ~95% of the
hash work removes only **37.4%** of one `fbm2` — 58.9 ns falls to 36.9 ns — which puts `nz` at
roughly **1.8 ns a call**. The smoothstep interpolation and the coordinate multiplies are the bulk of
it, not the integer hashing.

That matters beyond this optimisation, because `glass-gpu.md` rests its verdict partly on the claim
that this work is "a hash chain, not shading" and that a GPU's advantage evaporates on integer
multiply. The hash share is real but smaller than that framing implies, and that section should be
re-read against these numbers rather than trusted.

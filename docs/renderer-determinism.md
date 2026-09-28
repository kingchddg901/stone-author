# What changes the pixels, and what does not

**This builds on [`final-render.md`](final-render.md) and [`gallery.md`](gallery.md), which already
establish the cross-engine picture** — each engine byte-deterministic with itself, Gecko differing from
Blink by a mean of 7.919/255 and WebKit by 8.547/255, with Gecko's difference living in blur quantisation
inside the **blooms** and WebKit's at every edge. That was measured before any of this. Read it first; an
engine brightness difference in a dark region is the known bloom disagreement, not a finding.

What is new here is a different question, asked at 65535 in a tiled master: **can a single master be
assembled from tiles rendered on different machines?** If two machines disagree, a farmed master has a
seam at every device boundary. That needs two things the earlier work did not cover — the difference
*within* one engine across CPU architectures, and whether any of these differences are **visible at a
join** rather than merely present in the bytes.

Measured 26 September 2026 on one slab (`Hero_Psyker`, 666 marks) at 65535 × 40959 into 160 stored tiles
of 4096. Those masters were made **before** the bleed was sized to the blur's reach and before
reality windows were composited per tile, so every figure on this page describes renders whose bloom was
truncated at each tile join and whose islands were missing. The CONCLUSIONS are about how two engines
differ from each other, which both masters in a pair shared, so they are expected to hold — but the
numbers need re-measuring on the new set before they are quoted as current. Every master was audited tile by tile before being compared: all tiles inflate to full size and
every tile contains drawn pixels.

## The result

| axis | bit-identical | visible difference |
| --- | --- | --- |
| same engine, eight app builds apart | **yes**, 160/160 tiles | none |
| same engine, browser version + dpr + runtime all changed | **yes**, 148/148 comparable | none |
| Blink x86 vs Blink ARM | **no** | **none found** |
| Gecko vs Blink or WebKit | **no** | **yes — a different picture** |
| WebKit vs Blink | **no** | **not tested visually** |

### Farming across Blink is safe

x86 and ARM differ on every tile, but by ±1–3 levels: 85.8% of channels within ±3, 0.03% beyond ±8,
nothing beyond ±15, on a picture whose mean is 22. Structure is unchanged — the lit fraction agrees to
1.10% against 1.12%. The drift is floating-point rounding in Skia, and it also explains why the ARM master
is 8% larger: that noise is incompressible.

Checked visually at the hardest place available rather than a convenient one: a vertical tile boundary
with a 296px vein crossing it, left half from Chrome on x86 and right half from Chrome on ARM, so the vein
changes machine mid-stroke. Rendered in daylight and under black light, each against a control crop of the
same region drawn entirely on one machine. **No join is visible in either light.**

### Mixing engines is not safe

Gecko lights **2.14×** as many pixels as Blink and WebKit — 3.94% against 1.84% above the same threshold,
on the same slab with the same signature. That is not an encoding difference; Firefox draws a heavier
glow. It shows up three independent ways: the lit fraction, the file size (529 MB against 286 MB under
black light), and the performance regime — Firefox under UV is paint-bound, its per-tile times nearly
constant, while every other engine and light is compression-bound with time tracking bytes.

The same engine difference reverses in daylight, where the glow is inactive: Gecko writes 188 MB against
Blink's 730 MB for the identical picture. So file size is an engine property, not a quality measure, and
the spread across engines is 4.2×.

#### Re-measured 2026-09-28, and the lit-fraction figure inverted

Everything above was measured against the **image-space** bloom, which has since been replaced by a halo
drawn per element. That changed which engine lights more, so the 2.14× no longer describes the shipping
renderer. On slab `a98ab1f5` at 65,535 under black light, each engine at its own fitted correction:

| engine | mean | lit>40 |
| --- | --- | --- |
| Blink | 61.50 | **47.00%** |
| Gecko | 61.34 | **44.85%** |
| WebKit | 61.32 | **40.23%** |

Gecko now lights **fewer** pixels than Blink, not more. The means agree to 0.3% because a per-engine lift
is fitted to make them; the **distributions do not**, and a one-parameter correction can only pin one
statistic. Do not read matched brightness as a matched picture.

What did survive is the performance claim, now confirmed on a second platform. Firefox is paint-bound
where Blink is compression-bound: on one handset running both, time against bytes per tile reads **0.44**
under Gecko and **0.86** under Blink. Daylight costs Gecko *more* than black light — 11.2 min against 9.6
— where Blink shows the opposite, which is what a paint-bound renderer does when the field it must cover
grows. See [`devices.md`](devices.md) for the timings.

### WebKit cannot be mixed with Blink, in either light

Checked the same way as the ARM/x86 pair — a vein crossing a tile boundary, one engine either side,
against a control. **The join is obvious at a glance**, a clear step in field brightness down the whole
boundary. Measured at that location under black light, on a field whose mean is 63:

| | mean shift across the join | per-64px-block, median | max |
| --- | --- | --- | --- |
| Blink ARM vs Blink x86 | **0.15** | 0.36 | 1.31 |
| WebKit vs Blink x86 | **−16.53** | 18.10 | 38.07 |

Those figures are **local to that one boundary**, which is the right statistic for "is this join visible"
and the wrong one for "is the picture mixable". Scanning **every** tile edge of the same two masters — 640
strips of 64px, the whole picture rather than the studied crossing — the Blink pair reads **median 0.66,
worst 1.88**, at tile 120 on a field of 82. Larger than the local numbers, as a worst-of-640 must be, and
still inside the band that was confirmed invisible by eye. The verdict rests on the whole picture, not on
the one place it was looked at.

**Which masters.** The x86 side is Chrome on the Windows workstation, the only x86 Blink master in the set
(12 cores, dpr 1). The ARM side is Chrome on a Galaxy S23 (8 cores, dpr 2). Identify a master by the
`cores` and `dpr` in its own metadata, never by the platform word in its filename: `engineTag()` reports
the UA platform, and Chrome in desktop-site mode sends `X11; Linux x86_64` from an Android phone — so the
ARM masters here are named `linux-chrome`, and the token that is false is `x86_64`, not `Linux`.

A 16.5-level step on a field of 63 is a 26% brightness drop across the boundary. In daylight it is worse
and in the same direction: mean luma on one tile reads Blink 22.0, Gecko 28.5, WebKit 37.2.

This is the known bloom disagreement, so it is a defect to fix rather than a property to design around —
but until it is fixed, **only Blink devices may be mixed.**

### Measure the local mean, not the per-pixel difference

The WebKit result was predicted wrong twice before being measured correctly, and both mistakes are easy
to repeat.

**A seam is a low-frequency difference over an area, so a per-pixel distribution cannot see it.** The
WebKit/Blink per-channel histogram looks reassuring — 38.9% of channels within ±1 — because a uniform
+16 across a whole region barely moves a histogram of per-pixel deltas while being unmissable on screen.
The statistic that matches the eye is the **mean of a block, compared across the join**. It agreed with
observation in both directions here: 0.15 invisible, 16.53 glaring.

**The bloom difference is regional, so it must be measured where the join is.** At tile 77 WebKit and
Blink agree almost exactly under black light (27.6 against 27.1) and the lit fractions match at 1.84%;
at tile 148 they are 16.5 apart. Statistics taken in a quiet region say nothing about a loud one.

## Method, so this is repeatable

- `tools/tiff-meta.mjs` reads any master's own record of itself, including the `inputs` signature that
  says whether two files came from the same picture. `state` cannot answer that and must not be used for
  it — see the signature note in the app.
- `.claude/tools/tile-diff.mjs` compares two masters tile by tile. It refuses mismatched spectra, and it
  has been shown to detect a single flipped bit in 10.7 GB.
- **The UV master is the vein-finder.** Locating a vein crossing in daylight fails, because the ground is
  bright and any threshold matches whole tile edges. Under black light the veins are the only lit things
  on a near-black field, so a run of lit pixels along a boundary line is unambiguously a vein. The
  geometry is identical between lights, so coordinates found in UV transfer straight to the daylight
  master.
- A seam crop is worthless without a **control** crop of the same region drawn on one machine. The same
  grain, veins and tile edges appear in both; only what is in the mixed crop and absent from the control
  is a seam.

## What this does not cover

Same slab, one size, one tile geometry. Nothing here says what happens at other widths, with other
families, or with effects this slab does not use — `Hero_Psyker` has no drusy and no back light. The
rounding drift could plausibly be larger where a filter chain is longer.

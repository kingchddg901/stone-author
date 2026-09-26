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
of 4096. Every master was audited tile by tile before being compared: all tiles inflate to full size and
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

### WebKit splits by light

**Under black light it sits in the same band as the ARM/x86 pair** — 28.7% of channels identical, 38.9%
within ±1, and the lit fraction matches Blink exactly at 1.84%. Mixable, on the same evidence.

**In daylight it is not mixable**, and the cause is the known bloom disagreement rather than anything new.
Mean luma on the same tile: Blink 22.0, Gecko 28.5, WebKit 37.2 — all three differ, in a dark region,
which is exactly where a bloom lifting the floor shows. A 69% brightness difference would read as an
obvious step at any boundary. That makes it a defect to fix rather than a property to design around, but
until it is fixed those tiles are not interchangeable in daylight.

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

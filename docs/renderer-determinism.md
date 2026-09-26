# What changes the pixels, and what does not

Measured 26 September 2026, on one slab (`Hero_Psyker`, 666 marks) rendered at 65535 × 40959 into 160
stored tiles of 4096, across four engines and two architectures. Every master below was audited tile by
tile before being compared: all tiles inflate to full size and every tile contains drawn pixels.

The question behind all of it: **can a single master be assembled from tiles rendered on different
machines?** If two machines disagree, a farmed master has a seam at every device boundary.

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

### WebKit is unresolved

Same lit fraction as Blink (1.84%), but brighter peaks — 211 against 174 — and by far the smoothest
rasterisation, giving a 54 MB master where Blink gives 286 MB under black light. Statistically it looks
closer to Blink than Gecko does, but it has not been through the vein crossing test, so **do not assume it
can be mixed with Blink.** That test is the open item, and it matters because the iPhone is the fastest
device measured.

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

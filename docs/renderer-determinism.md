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
| same engine, eight app builds apart | **yes**, 160/160 tiles | none — but see `179` below |
| same engine, browser version + dpr + runtime all changed | **yes**, 148/148 comparable | none |
| same engine and machine, same render tile size | **yes**, byte for byte | none |
| same engine and machine, **different render tile size** | **no**, 632/640 tiles | **none found** |
| Blink x86 vs Blink ARM | **no** | **none found** |
| Gecko vs Blink or WebKit | **no** | **yes — a different picture** |
| WebKit vs Blink | **no** | **not tested visually** |

### Build `2026.10.24.179` changed the picture on purpose — the only one that has

The row above says eight app builds apart is bit-identical, and that was true of every build until this
one. **A glass slab with a spin in it does not reproduce across `179`,** and the break was taken
deliberately after looking at it.

**What was wrong.** A spin maps `p` to `c + R(-a*r)*(p - c)`. The renderer computed that by recovering
the angle with `woodAtan2`, subtracting `a*r`, and rebuilding the point from `r` and the new angle —
the same map, the long way round. But `woodAtan2` is a **polynomial approximation**, mean error
**9.70e-4 rad** and worst **1.51e-3 rad**, and `c + r*(cos, sin)` turns an angular error into a
positional one of `r * epsilon`:

| distance from the centre | displacement | px of 65,535 across an 8 ft slab |
| --- | --- | --- |
| 1 ft | 1.51e-3 ft | 12.4 |
| 4 ft | 6.04e-3 ft | 49.4 |
| 5.7 ft | 8.60e-3 ft | 70.5 |

So every glass master with a spin carries bands where the approximation put them rather than where the
geometry does, and the error grows towards the rim. `woodAtan2` is named for the material it was
written for: in `woodEye` and `woodStain` an angle is used as an angle and 0.06° is invisible. It was
reused in two glass paths that multiply it by radius.

**What it cost to fix.** Written as the rotation it is, the spin needs no `atan2` and no `r > 1e-9`
guard — at `r = 0` the cosine is 1, the sine is 0, and the point lands on the centre. The new form is
exact: checked against the same map written with `Math.atan2`, it agrees to **2.05e-15 of the radius,
8.3e-11 px of 65,535**. The change against the OLD form, on the reference slab, is **7.08e-3 ft worst
(58 px) and 2.53e-3 ft mean**.

Measured on a 1024 tile at 65,535, same slab, nothing else altered:

| where on the sheet | pixels that moved | worst level | mean where moved |
| --- | --- | --- | --- |
| near the spin centre | **53.9%** | 94 | 45.5 |
| mid-sheet | 15.3% | 105 | 31.0 |
| at the corner | 23.5% | 95 | 39.5 |

**What was accepted.** The look was compared side by side at 1:1 before the change landed and judged
close enough, with the note that the lower region may want supersampling — which agrees with
`adaptive-supersampling.md`, where the spin is already held responsible for half the aliasing. The
trade is: masters rendered before `179` are historical for any slab with a spin, and in exchange the
spin is geometrically true and the renderer is deterministic again from `179` on.

**Measured on a render: 1.8% off the wall and 2.2% off the compute at 65,535**, against build `180`'s
predecessor on a box held to 0.03 threads. That matches the 2.3% ceiling the function bench predicted,
which is the only microbench prediction on this renderer that has held. The 32,768 pair is not quoted:
it ran 0.2 threads above its comparison set, and its core-seconds went up while its wall went down,
which is what that margin looks like.

**It is not a speed change and should not be quoted as one.** `woodAtan2` is a polynomial, so dropping
it saves **9.4% of one spin** — a ceiling of about 2.3% off a render, since four spins are 24.4% of a
4096 tile. Gated by `tools/probe-spin-identity.mjs`, which asserts the exactness and *prints* the
accepted cost rather than asserting it, so the figures above cannot drift out of this page unnoticed.

### Build `2026.10.24.181` moved it again, by four orders of magnitude less

`cos` and `sin` of `a*r` are **69% of a spin's cost** and the `sqrt` is 20%, measured by removal. They
now come off a **16,384-entry table over one turn**, interpolated. Indexing by the *angle* rather than
the radius makes one table serve every spin on every slab — `cos` and `sin` are periodic, so there is
no maximum radius to bound, no fallback branch and no per-op array sized by `a`. Reducing in **turns**
rather than radians keeps a divide out of the hot path and was worth 9 of the 47 points on its own:
38.0% off a spin with the divide, **47.3%** without.

| | worst coordinate error | as px of 65,535 |
| --- | --- | --- |
| `woodAtan2`, shipping until `179` | 8.60e-3 ft | **70.5** |
| the table, from `181` | 9.26e-8 ft | **7.6e-4** |

**So this build moves the picture away from a form that was itself 90,000 times less accurate.** What
it costs, measured on 1024 tiles at 65,535 against exact `cos`/`sin`:

| where | pixels moved of 1,048,576 | worst level | over 16 levels |
| --- | --- | --- | --- |
| near the spin centre | **49 — 0.0047%** | 66 | 3 |
| mid-sheet | 7 — 0.0007% | 64 | 3 |
| at the corner | 46 — 0.0044% | 66 | 11 |

About **17 pixels per million**, each one a ribbon label flipping where a sample sat within 5e-4 px of
a boundary — a label cannot average, so a flip is large when it happens. Against `179`'s 53.9% at a
mean of 45 levels, this is four orders of magnitude smaller, and it is the mechanism rather than noise.

**Measured on renders, and deterministic again.** Two 65,535 runs on `181` are **byte-identical to
each other** at 392,459,832 image bytes, and both differ from `180` on **631 of 640 tiles, worst byte
delta 106** — so almost every tile carries a few of those 17-per-million flips, which is what a
scatter of that density looks like at 4.2 M pixels a tile.

**On speed it is faster on average and much less predictable, and a third run is what showed that.**
Two runs read 4.769 and 4.894 min against `180`'s 5.116, and a floor of 4.3% was recorded here. The
third read **5.280 — slower than `180`** — on a box at 12.3% with 7.98 busy threads against `180`'s
8.06. That floor was wrong and is withdrawn.

| build | runs | tile time | spread |
| --- | --- | --- | --- |
| `177` | 2 | 312.1, (5.216 min pair) | **0.2%** |
| `180` | 1 | 306.8 | — |
| `181` | 3 | **293.5 / 286.0 / 316.6** | **10.8%** |

The slow run is slower in **every fifth** — 86.4/56.5/56.2/55.5/62.1 against 79.8/50.3/50.7/50.3/54.9
— with the same first-fifth share, so it is not a warm-up. That is build `174`'s signature returning:
one build, two modes, each held for a whole render. Core-seconds agree, 2529 against 2260 on two runs
both clean by thread count.

So: mean 4.981 min against `177`'s 5.210, **4.4% faster on average**, covering the spin identity and
the table together — but `181`'s worst run is **1.5% slower than `177`'s typical**. The variance went
from 0.2% to 10.8%, which is a regression in predictability even though the mean improved.

### Build `2026.10.24.182` shrinks the table to 64 KB

4,096 entries rather than 16,384, **for cache and not for accuracy**. Interleaved cos and sin mean one
cache line carries a whole lookup, and 64 KB a worker sits beside a tile's working set instead of
competing with it.

| | entries | per worker | worst cos/sin error | as px of 65,535 |
| --- | --- | --- | --- | --- |
| `181` | 16,384 | 256 KB | 1.84e-8 | 5.2e-4 |
| `182` | 4,096 | **64 KB** | **2.94e-7** | **1.4e-2** |
| `woodAtan2`, until `179` | — | — | 1.51e-3 rad | **70.5** |

The bound the probe asserts moved from 1e-7 to 1e-6 with it, and the measurement came in at **2.94e-7
against a predicted h²/8 of 2.94e-7** — the arithmetic confirming itself rather than a tolerance
nudged until it passed. Against `181`, measured on 1024 tiles at 65,535: **601 pixels per million
changed near the spin centre, 627 at the corner, 91 mid-sheet**, worst 105 levels. Still three orders
of magnitude below `179`'s 53.9%.

**CORRECTED 2026-10-23, later the same evening: there was probably no bimodality to fix.** A fifth
`182` run came in at 5.076 min and exposed what both builds were really showing — **a render gets
slower the longer its page has been open**, 8–11% by the third to fifth render of one session, across
six sessions. `181`'s slow third run was its *third render*, not a cache mode. `master-timing.md` has
the table.

What survives, compared like-for-like at the same position in a session: the 64 KB table is **3.9%
faster at #1 and 1.0% at #2**, with core-seconds at positions 1–3 below `181`'s best of 2260. Real,
and a few percent. That `181` turns by its third render while `182` holds to its fourth is one
session each — suggestive of the footprint mattering, not established. The paragraph below was
written before the fifth run and reads the spread as a property of the build; it is kept because the
error is the instructive part, and because the numbers in it are correct even where the conclusion
drawn from them is not.

Four 65,535 runs on the quietest box of the day — 8.9% cpu, 1.07 threads beforehand:

| build | runs | wall | spread | sd | core-seconds |
| --- | --- | --- | --- | --- | --- |
| `180` | 1 | 5.116 min | — | — | 2475 |
| `181` | 3 | 4.981 mean | **10.3%** | 0.2664 | 2260 **and** 2529, both clean |
| `182` | 4 | **4.743 mean** | **2.3%** | **0.0493** | 2251 / 2213 / 2253 / 2291 |

`182` lands on `181`'s **good** mode and the bad one is gone: 2213–2291 against 181's 2260-or-2529 on
two runs that were equally clean by thread count. So the fast mode was the table working and the slow
mode was it falling out of cache, which is what a 256 KB array read at a scattered index does and a
64 KB one does not. **9.0% less compute than `180`** and 7.3% off the wall, with the variance 5.4×
tighter — and all four masters are **byte-identical** at 392,466,320, so the renderer is deterministic
again from `182`.

Worth keeping from the shape of it: the accuracy-for-speed trade everyone reaches for first was not
the lever. The table was already five thousand times finer than what it replaced, and making it
*coarser* made it faster **and** more predictable, because the binding constraint was never precision.

**The leading suspect is the table's footprint**, and it is a suspect rather than a finding. 16,384
entries of two doubles is 256 KB per worker, 2 MB across the pool, accessed at an index that moves
with `a*r` and so does not stay in cache the way a scanline does. A 4,096-entry table would be 64 KB
with a worst error of 2.9e-7 — 0.014 px of 65,535, still five thousand times finer than `woodAtan2`
— and is the obvious thing to measure next. Nothing here has measured a cache miss.

`tools/probe-spin-identity.mjs` holds the bound at 1e-7 of the radius and ablates five ways. Two of
its arms had to be repointed at the table, and one of them — `cos` and `sin` swapped — had silently
stopped corrupting anything while still reporting green, because its threshold was tighter than the
table's own error. Every mutation now **throws** if the text it replaces is absent.

**Still open, and the same defect.** The radial mould reads `woodAtan2(ga, gc) * (0.5 + r)`, which
amplifies the same error by radius in the same way. It is untouched: there the angle is genuinely
wanted, so the choice is the approximation or `Math.atan2`'s cost, and that is a separate look
decision rather than an identity waiting to be used.

### The render tile size changes the picture

Measured 19 October 2026, one slab under black light at 131,072 × 81,920, rendered twice at a forced
4096 tile and twice at 8192, interleaved on one machine within twenty minutes. **Each pair is
byte-identical to its partner**; across the pair, 632 of 640 stored tiles differ.

**The 8192 arm of this experiment can no longer be run.** That size left the tile ladder on 2026-10-20
and `?tile=` will not accept it, so the pairing above is a record rather than a reproduction. The
finding it carries — that a forced tile change moves the drawn glow and therefore the bytes — is
unaffected: any two tile sizes still on the ladder show it.

The cause is the drawn glow. Each element casts its halo with `shadowBlur = glowPx` — 2,097 px at that
width — and the tile bleed is **4 px**, because `coatRadius` grants drawn glow none. A shape outside the
canvas does cast its shadow in, which is what that was argued from, but the result still depends on how
big the canvas is. Reproduced in seconds at 16,384, where the same region rendered inside a 2048 tile
and a 4096 tile differs on 1.699% of pixels at bleed 4, 0.553% at 64, 0.43% at 256 and **nothing at
786** — which is exactly `blurReach(glowPx)`.

It stays at 4 because the correct bleed is unallocatable. `blurReach(glowPx)` is 3,146 px at 65,535 and
6,292 at 131,072, where a 4096 tile becomes a 16,680 px canvas at 1,113 MB — past the 900 MB hard cap.
A 1,048,576 would want 50,332 px of bleed. Above 65,535 the choice is this or no drawn glow.

**The cost is below the display.** Of the 3.95% of pixels that differ at 131,072, 95% move by exactly
one level and 99.3% by one or two; two pixels in 4.19M exceeded ±2 in the 16,384 reproduction. The
514,446 above ±16 all sit on lit content and are **scattered, not seam-clustered** — 6.63% land within
64 px of a tile join against 6.15% for a uniform scatter, with a flat distance profile. There is no
visible join, no grid, and no structural change; it is ±1 on the glow's own gradient contours.

So a master is reproducible on one machine as long as the tile size is, and the tile size comes from a
remembered `proven` value, the memory budget and a calibration — any of which can move. The resume
already pins it (`tilePinned`) so a part-finished master cannot be stitched from two tilings.

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
(12 threads, dpr 1). The ARM side is Chrome on a Galaxy S23 (8 cores, dpr 2). Identify a master by the
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
  says whether two files came from the same **document inputs**. `state` cannot answer that and must not
  be used for it — see the signature note in the app. **It is not a picture identity across builds, and
  since `179` it cannot be.** `inputs` signs the document, never the renderer, so two masters that agree
  on it can still be different pictures if a build moved the arithmetic between them: the `175` and
  `180` 65,535 masters both read `cefe5c` and differ on **640 of 640 tiles, worst byte delta 113**, with
  the compressed image moving 392,456,504 to 392,462,224 bytes. Compare bytes within one build era, or
  read the `build` field first.
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

**Positional marks are not in any figure here.** Every master measured
below was rendered before marking existed. Marking alters one pixel in 1,821 by one level of blue, so a
marked and an unmarked render of one picture differ in bytes while sharing a signature — see
[`positional-marks.md`](positional-marks.md), which gives the cost and the shape of that difference.
It does not affect anything concluded here: marks are identical between two renders of one picture, at
any tile size, so every comparison in this file holds when both sides are marked.

Same slab, one size, one tile geometry. Nothing here says what happens at other widths, with other
families, or with effects this slab does not use — `Hero_Psyker` has no drusy and no back light. The
rounding drift could plausibly be larger where a filter chain is longer.

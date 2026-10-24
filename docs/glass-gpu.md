# A GPU path for glass — measured, and worth building for the long ones

Status: **measured 2026-10-24, and the answer reversed.** The one measurement this page asked for
now exists: `tools/gpu-native-probe.html`, three arms, against the *current* arithmetic with the
corner cache granted to the CPU. A GPU-native field — noise read out of a hardware-filtered texture
rather than hashed per invocation — came back at **246× the eight-worker pool** on an RDNA-2 desktop,
3.30× the transliterated port the page had been arguing about. Read "The measurement, 2026-10-24"
first. Everything under "Where this stands" was the right question and is now answered; every hour
figure below it is stale.

Earlier status, left as written: **OPEN 2026-10-23, partial port first.** This document was closed
on the strength of a correct measurement and a wrong judgement, and reopened within hours. Both are
left visible below, because the mistake is more instructive than the conclusion.

## The measurement, 2026-10-24

`tools/gpu-native-probe.html`, run in the pane on this desktop. One AMD RDNA-2 part, twelve cores
reported, the renderer's real eight-worker pool as the divisor. **Desktop only so far** — the probe is
written to run on the S23 and the iPhone and has not yet.

| arm | per 270,400-sample pass | vs one thread | vs the 8-worker pool |
|---|---|---|---|
| CPU as shipped, corner cache in place | 28.5 ms (105 ns a sample) | 1× | 0.125× |
| GPU, the same hashing transliterated | 0.048 ms | 597× | **74.6×** |
| GPU native, filtered texture | 0.014 ms | 1,970× | **246×** |

### Three devices, all measured, all saying go

| device | pool | CPU a pass | native arm | vs its own pool | filter error |
|---|---|---|---|---|---|
| desktop, AMD RDNA-2 | 8 | 28.5 ms | 0.014 ms | **246×** | 0.368 levels (f32) |
| S23 Ultra, Adreno 7xx | 8 | 25.8 ms | 0.036 ms | **89×** | 0.822 levels (f16) |
| iPhone 14 Pro, A16, iOS 18.7 | 4 | 9.0 ms | 0.044 ms | **51×** | 0.425 levels (f16) |

Every ladder exactly linear — the iPhone's native arm read 2.9 / 5.7 / 11.3 / 22.5 ms for 64 / 128 /
256 / 512 passes, the S23's 2.4 / 4.7 / 9.3 / 18.6 — and every arm passed the scaling gates.

**The weakest device is 51×, and the decision stops caring above about 50×.** Past that the field is
no longer what limits the render, so the three devices are not 246× / 89× / 51× worth of different
answers; they are three devices that all clear the only bar that matters. The 5× spread between them
changes the Amdahl column by a few percent and nothing else.

### Two findings that constrain the port

**The filter is not the same function on every device, so a GPU render would not be byte-identical
across them.** At the same half precision the iPhone lands 0.425 levels from the CPU's `vnoise` and
the S23 lands **0.822** — nearly double, on identical lattice data. That is the texture unit's own
weight precision, not the format, and it is not something a shader can control. Against the
determinism this project holds elsewhere — same slab, same pixels, gated in CI — a GPU field means
**same slab, same picture, different bytes, by vendor.** Under a level is invisible and the existing
`woodAtan2` shipped at 1.5e-3 rad for months, so this is very likely acceptable; but it is a property
to decide on deliberately rather than discover after the port exists.

**Mobile GPUs need the clock asked for.** The S23's transliterated arm read 27.7 / 16.9 / 33.8 /
67.5 ms — the last three exactly linear at 0.132 ms a pass, the first inflated threefold, with all
five readings at the first rung identical. A compile is paid once and shows in one reading, not five,
so this was never compile cost: a mobile governor ramps on sustained load and one short dispatch does
not ask for it. The whole first rung ran at idle frequency. The probe now warms at the *top* of its
ladder. Anything that measures a phone GPU over a short burst is measuring the governor.

### Still unexplained, and worth more than the port

**The iPhone's CPU arm is 9.0 ms a pass against this desktop's 28.5 and the S23's 25.8** — three
times faster per core on identical lifted arithmetic. Its ladder is 9.0 / 18.0 / 36.0 / 73.0, exactly
linear, and the accumulator gate proves the loop ran, so it is not a JIT deleting work.

`tools/cpu-breakdown-probe.html` takes the field apart on the desktop, each piece against a baseline
of plain float multiply-add measured on the same device in the same run — a faster *core* moves every
row together, a badly compiled *call* moves one row:

| piece | ns an op | × baseline | share of a sample |
|---|---|---|---|
| baseline `a*b+c` | 1.42 | 1.0× | — |
| `Math.imul` | 0.45 | 0.3× | — |
| `Math.floor` | 0.80 | 0.6× | — |
| `nz` | 1.34 | 0.9× | 29% |
| `vnoise`, uncached | 5.99 | 4.2× | — |
| **`Math.exp`** | **9.55** | **6.7×** | **26%** |
| `fbm2C` | 40.0 | 28.1× | 72% |
| the whole sample | 110.9 | 77.9× | 100% |

Parts to whole within 2%, so the breakdown describes the renderer rather than nine microbenchmarks.

**And it already bounds the answer.** The desktop sample is 110.9 ns, the iPhone's is 33.3. Three
`Math.exp` are 26% of the sample — the largest single oddity in the table at 6.7× baseline — but
making them **free** leaves 82.3 ns against the iPhone's 33.3, still 2.5×. **No single call can
explain the gap**; whatever it is has to be broad. That points at the core rather than at one
pathological intrinsic, which would close the question — but the phones have not run this probe yet,
and the `× baseline` column is what decides it.

**The corner cache was re-tested here and it holds.** Measured call by call, `vnoiseC` came out at
12.7 ns against the uncached `vnoise`'s 6.0 — twice the cost, which cannot be squared with the cache
being worth 13.3% of a live render. Stack against stack it is `fbm2C` 40.0 ns against `fbm2` 45.5 —
**0.88×, the cache paying 12%**, consistent with the live figure. The per-call number is the artifact:
a function measured alone inlines differently from the same function inside the sample loop. The
established measurement was right and the new derivation was the suspect.

The CPU arm is **lifted out of `app/stone-author.html` at run time** — `nz`, `vnoise`, `vnoiseC`,
`vnoiseCfill`, `fbm2C` and the `_NZC` declaration, fetched and sliced — so it is the shipped
arithmetic and not a second copy of it. That is the discipline that caught three drifts in a day.

**What the native arm is.** `vnoise` *is* bilinear interpolation of a hash lattice, and a GPU does
bilinear interpolation in fixed-function silicon. Put the lattice in an `r32float` texture, pre-warp
the sample coordinate to `floor(x) + smoothstep(frac(x))`, and one `textureSampleLevel` returns
`(a(1−sx) + b·sx)(1−sy) + (c(1−sx) + d·sx)·sy` — vnoise's own expression. Six samples replace
twenty-four hashes and all their interpolation.

**This is the reversal.** "Where this stands" argued, correctly, that the corner cache is worth 13.3%
to the CPU and that a per-invocation port cannot have it — the port would recompute twenty-four
hashes where the CPU computes about one. All true, and it does not matter: the native path never
hashes at all. **The texture unit is the cache the port was said not to have, in hardware.** The 246×
is measured with the CPU's cache advantage already granted, on the arithmetic as it ships today.

Sanity, so the figure is not taken on faith: 270,400 × 6 fetches in 0.014 ms is 116 Gsample/s, under
an RDNA-2 part's texture peak; the hash arm's 135 Ghash/s is consistent with 32-bit integer multiply
running at quarter rate. Both are plausible and neither is at a limit.

### What the hardware filter costs in accuracy

Measured against the CPU's own `vnoise` over 4,096 points spread across cells and across the
fraction: mean **4.27e-4**, worst **2.40e-3** — **0.368 levels of 255** through the field's 0.30
multiplier. Under half a level, against a spin table already shipped at 2.9e-7 and a `woodAtan2`
shipped for months at 1.5e-3 rad. The filter is accurate enough to be a renderer, not a toy.

### The cost the GPU clock cannot see, and what it forces

**0.59 ms a dispatch** of submit, fence and map, outside the pass and paid whatever the pass
contains. At 65,535 a 520²-tile port would be 16,129 dispatches — **9 s of round trip before any
arithmetic**. A GPU field has to go out in few, large dispatches; a tile-at-a-time port throws the
win away on overhead. This is a shape constraint on the port, decided before any code.

### A fast field is not a fast render

This prices the noise field and the three exponentials. A render is also the unform walk, the roller
and stamp geometry, the ribbon label, the colour flatten and the write. **The field's share of a real
render is not measured**, and it is the whole decision:

| if the field is | the render is | 5:05 becomes |
|---|---|---|
| 30% | 1.43× faster | 3:34 |
| 50% | 1.99× faster | 2:33 |
| 70% | 3.30× faster | 1:32 |
| 90% | 9.65× faster | 32 s |
| 95% | 18.6× faster | 16 s |
| 99% | 71× faster | 4 s |

**Measuring that share is the next step**, and it is cheap — the per-line-item timings already exist
for the CPU path. Nothing else about the port should be decided first.

### Three instruments were wrong before the fourth was right

Recorded because each failure is invisible unless you look for it, and the first two produced
confident numbers.

| instrument | what it reported | why it was wrong |
|---|---|---|
| one dispatch, `onSubmittedWorkDone` | 2.50 ms for 24 hashes, 2.80 ms for 6 texture samples | 4× the work, 12% more time. The fence resolved before the work landed; it timed a queue. |
| reps 1–8, same fence | flat 2.4–3.4 ms while `out[0]` scaled exactly 1:2:4:8 | the work certainly happened; 52M hashes is a fraction of a millisecond, buried under the round trip |
| copy and `mapAsync` | pinned to 33.3 ms, escaping to 16.8, free only by the fourth rung | two frames at 60 Hz. A map resolution handed to the compositor is quantised by the compositor. |
| timestamp query | 3.1 / 6.2 / 12.2 / 24.4 and 0.9 / 1.9 / 3.7 / 7.4 ms, ±0.1 across five reads | the GPU writes the clock either side of the pass. No submit, no fence, no map, no frame. |

The probe now refuses to quote a slope unless `out[0]` scales with the rep count (the loop was not
folded away), the readings rise with the work, and the ladder is monotonic. It prints `NOT MEASURED`
and the reason instead — it did, twice, on the way to the table above.

## Where this stands after 2026-10-24

**Three things changed, and two of them cut against the port.**

**The baseline moved 38%.** Every hour in the verdict table rests on a 1,048,576 measured at 24.5 h,
live, at 0.538 s a tile. Six CPU changes since took a 65,535 from **7.645 min to 4.743**, measured,
byte-identical where claimed and recorded in `renderer-determinism.md`. At the same scaling that
1,048,576 is **about 15.2 h**, so the partial port's 8.7 h becomes **nearer 5.4 h at an unchanged
ratio** — and the ratio is not unchanged.

**The biggest CPU win is one a per-invocation GPU port cannot have.** The corner cache is worth 13.3%
of a 65,535 and it works by keeping the four lattice hashes of the **last cell this thread saw**:
consecutive samples on a scanline land in the same cell 93–99% of the time. A GPU invocation has no
previous sample. It would recompute all twenty-four hashes where the CPU now computes about one,
so the work the port would take over is **roughly 37% cheaper on the CPU than when the port was
priced**. Recovering it on a GPU means cooperating across a workgroup, which is a different and much
larger piece of work than the shading pass §3 scopes. This is an architectural observation, not a
measurement.

**And the page disagrees with itself about which port.** The verdict names "the shading class already
proved safe in §3" at 1.55×, worth 8.7 h. Item 3 of §7 closes "a WebGPU compute pass for
`glassFormT` alone" at a 1.25× ceiling on a poured sheet. Those are two different ports with two
different ratios, and the header has been saying OPEN while the list says CLOSED. Nothing below
resolves it.

**So the honest position is that this cannot be decided from this page as written.** What it needs is
one measurement: the port's ratio against the *current* arithmetic, on a poured sheet, with the
corner cache in place on the CPU side. Until that exists the 1.55× is a number about a renderer that
was retired in a day. The CPU list is also not finished — the radial mould still carries
`woodAtan2`, and `adaptive-supersampling.md` is measured and unbuilt — and doing the cheap exact
thing first is what this document already got right once.

A written answer to "would it help, what would it cost, and what breaks", decided against
measurements rather than against the obvious appeal of an idle GPU. The appeal *was* an error — the
GPU is not sitting idle for want of being asked, and the speedup is small. What took a second pass is
that a small multiple of a very large number is still a very large number.

## The verdict, before the reasoning that led to it

Measured with [`tools/gpu-probe.html`](../tools/gpu-probe.html), which runs the same arithmetic in
WGSL and in JavaScript on whatever opens it and reports the ratio:

| device | WebGPU | GPU vs one thread | GPU vs the whole pool | a full port would give |
| --- | --- | --- | --- | --- |
| Tab A 8.0 | **none** | — | — | **not possible** |
| A7 Lite | **none** | — | — | **not possible** |
| desktop, RX 6500 XT | yes | 15.9× | 1.3× (12 threads) | 1.90× |
| S23 Ultra | yes | 12.8× | 1.6× (8 threads) | 1.56× |
| iPhone 14 Pro | yes | 7.6× | 1.9× (4 threads) | 1.82× |

**Nothing reaches 2×, and neither of the two devices with the most to gain can run it at all.**
Both tablets predate WebGPU, which is not a coincidence that will age away in the direction anyone
wants: the hardware slow enough to need a GPU path is the hardware too old to have the API. Those
figures are also the optimistic bound: the probe is a proxy with no op chain, no SDF loop and no cell
walk, and all three branch — divergence costs a GPU far more than it costs a core.

### The multiple is not the decision. The clock is.

That table was read as "1.3–1.9×, not worth a second renderer" and the doc was closed on it. The
error is visible the moment the same ratio is written in hours instead:

| render | CPU today | full port 1.90× | saved | partial 1.55× | saved |
| --- | --- | --- | --- | --- | --- |
| 65,535 | 7 min | 4 min | 3 min | 4 min | 2 min |
| 262,144 | 1.8 h | 56 min | 51 min | 1.2 h | 38 min |
| **1,048,576** | **24.5 h** | **12.9 h** | **11.6 h** | **15.8 h** | **8.7 h** |
| 262,144 SS=4 | 28.6 h | 15.0 h | 13.5 h | 18.4 h | 10.1 h |
| 1,048,576 SS=4 | 19.1 days | 10.0 days | 9.0 days | 12.3 days | 6.8 days |

1.9× is three minutes on a 65,535 and **eleven and a half hours** on a 1,048,576. The 24.5 h row is
not a projection from the ladder — it is a render measured live at 0.538 s a tile, 28% of the way
through, on the machine this would be built for.

**And supersampling does not dilute it.** The ratio is the card's throughput advantage, which is
fixed, so the absolute saving scales with the render rather than shrinking against it. At the sizes
where this slab needs SS to resolve its aliasing, the saving is measured in days.

So the verdict is:

- **The partial port is worth building: 8.7 h on the render currently running.** The label stays on
  the CPU, nothing moves that is not the shading class already proved safe in §3, no existing master
  changes, and the CPU path stays canonical behind the toggle §6 specifies.
- **The full port's extra 2.9 h does not obviously pay for what it costs** — an integer-label rewrite
  of the *CPU* path, re-dating every glass master in the 130-level class. Judge it on its own later,
  against a partial port already banked, not bundled into this decision.
- **It is a desktop feature and always was.** Both tablets have no WebGPU, and the phones only ever
  render small. §6's toggle — opt-in, off by default, declared in metadata, never planner-chosen — is
  unchanged and is now the whole deployment story.

**Why, in one line: this work is a hash chain, not shading.** Three `fbm2` evaluations is 36 `nz`
calls, and `nz` is `Math.imul`, xor and shift — roughly 250–290 **integer** operations per sample
against a handful of floats and three `exp`. A GPU is enormous at float throughput and ordinary at
32-bit integer multiply, so the one arithmetic shape where its advantage mostly evaporates is exactly
the shape this renderer has. It also explains the observation that started the whole line of enquiry:
the card never bumps during a glass render because integer hashing does not light up the parts of a
GPU that draw power.

The corollary is the useful part. **The ratio moves inversely with core count** — 15.9× a single
thread on the desktop against 7.6× on the iPhone, because a device with fast cores has a GPU that is
proportionally less far ahead of them. The two cancel, every device lands between 1.3× and 1.9×, and
there is no device-class where this pays.

**What the prize turned out to be instead.** §4's analytic gradient, which needs no GPU, no toggle and
no capability matrix: landed in build `2026.10.22.172`, bit-identical output on a poured sheet, step 1
of the list in §7 all along, and it cost nothing in risk.

It is worth **about 18%** off a 65,535 — not the 12.4% first published here. That figure came from a
172 master that rendered with 439 MB free, and `master-timing.md` sets out why a run in that band is
handicapped by around 7%. The clean anchors are the two `171` baselines at 7.64 min and the two
`173` runs at 6.17 min, both un-starved: **19.3% for the gradient and the relief guard together**,
measured with no model in it, and a floor rather than a point, since `173` had less memory headroom
than `171` did. The guard accounts for about 1.1% of that, so the gradient has the rest — and because
the guard is small the split hardly moves even if its own figure is wrong by double.

On a 1,048,576 that is **four and a half hours**, and it was the first item on §7's list to pay.

**It is no longer the only one, and the CPU side has now overtaken this whole document's premise.**
The corner cache of build `2026.10.23.175` took a further **13.34%** off a 65,535, measured as 18.6%
less compute (`glass-one-pixel.md`). Together with the gradient, a 65,535 has gone from 7.645 min on
build `171` to 5.349 on `175` — **30.0% in one day, no second renderer, no toggle, no capability
matrix, every master byte-identical.**

That cuts at the table above from both ends. The partial port was priced at 1.24-1.44×, which is 19
to 31% off a render; the CPU work has already delivered 30% and carries none of the port's risk. And
because the GPU ratio applies to whatever compute remains, taking 19% of the work out of the CPU path
takes the same share off the port's absolute saving. **The case for building a second renderer is
weaker than when this was reopened, and the reason is that the cheap path was not finished.**

**What the closing argument got wrong, recorded because the shape of it will recur.** The measurement
was right and the inference was not. A ratio was compared against an intuition about whether a
speedup "feels worth it", and that intuition had been formed on seven-minute test renders while the
actual work had grown to day-and-a-half ones. Nothing in the table was wrong; the table simply had no
column for hours, so the number it was judged against did not exist.

**Two things worth keeping from the measurement**, since both were open questions:

- **The GPU is deterministic run to run** — bit-identical across five dispatches of 262,144
  invocations. Cross-*device* determinism is a far weaker claim and untested, but a device reproducing
  itself is the rule that matters.
- **f32 shading is not the problem.** Against the fp64 reference the divergence is **0.0002 levels
  mean, 0.002 max** — four orders of magnitude under the analytic-gradient change already shipped. The
  "cannot be bit-exact" objection is correctly aimed at the compartment label (§3) and badly
  overstated for the shading. Only the label flips, at roughly 0.0034% of samples, and each flip is
  the 130-level class.

---

**The original short version, left as written.** Glass is the one material here that is genuinely
compute-bound, the work is almost exactly fragment-shader shaped, and the GPU sits at 3% of its clock
while six cores burn — an idleness that belongs to glass alone, since a stone render drives the same
card to 1,911 MHz. But a GPU pass **cannot be bit-exact with the CPU pass**, and §7 of
`glass-one-pixel.md` explains why that is worse for glass than it would be for stone. So this is a
*second renderer behind a toggle*, not an optimisation — and there is a 36% CPU win already specified
that should land first.

The sentence that did not survive is "almost exactly fragment-shader shaped". It is shaped like a hash
chain, and that single word is the difference between an order of magnitude and 1.3×.

---

## 1. Why glass and not stone — measured

Same machine, same render size, same engine, 2026-10-21:

| material | elements | workers | time | Mpx/s |
| --- | --- | --- | --- | --- |
| stone | 8,951 | 8 | **22.9 s** | 117.5 |
| glass | 14 | 8 | **8.3 min** | 5.4 |

**Glass is 22× slower per pixel with 639× fewer elements.** All of that difference is per-pixel
shading. And the two load the machine completely differently:

| | glass, 10 workers | stone, 6 workers |
| --- | --- | --- |
| cores | all six at **88–91%** | 4.17 threads of 12 |
| package power | **58.9 W** | 32.2 W |
| core temp | **68.8 °C** | 46.4 °C |
| GPU | 2.9%, **94 MHz of 2,887** | **59.5%, 1,911 MHz, 30.6 W** |

Stone is bound by its hand-offs — 0.72 CPU threads per busy worker, drive under 7%, memory with
headroom, and no *sustained* saturation anywhere. Not nothing, though: that stone GPU cell read
`idle` until 2026-10-22, when four 1,048,576 runs measured it at 44.8–67.6% mean and **99% peak in
every one** against a 1.6% idle floor. `OffscreenCanvas` 2D in a worker is hardware-accelerated, so a
stone render already uses this card — which strengthens the conclusion below rather than weakening it,
because a WebGPU pass would contend for a device that is two-thirds busy rather than claim an idle one.

**A faster compute device makes a render that is waiting wait at the same speed.** Glass is the
opposite: it is the only workload in the archive that pins this machine, and it
pins it doing arithmetic.

So the GPU question is a glass question. Stone would get nothing, and every 1,048,576 rendered so far
has been stone.

---

## 2. The work is fragment-shader *shaped*, and that was the wrong thing to measure

> **Measured 2026-10-23 and found to be the error in this document.** The per-pixel work does have the
> shape of a fragment shader — independent samples, no communication, pure arithmetic. What it does
> not have is the arithmetic a GPU is fast at. The cost below is dominated by `fbm2`, `fbm2` is 12
> `nz` calls, and `nz` is integer multiply and xor. Shape is not throughput, and this section
> measured the shape.

From `glass-one-pixel.md`, per pixel per supersample: one op walk (16 records, 4 of them spins), one
`glassFlow`, **three** `glassFormT` each of which may call `fbm2`, `exp` and `sin`, one `glassMelt`
over nine hashed cells, one `glassLay` over every mould compartment, and three `exp` for Beer–Lambert.

Measured shares of a 4096 tile on the reference slab:

| | |
| --- | --- |
| spin × 4 | 24.4% |
| stir × 4 | 9.0% |
| blow × 7 + roll | 0.3% |
| flow, thickness, melt, ribbons, colour, coat | **66%** |

Every one of those is a good fit:

- **No inter-pixel dependency.** Pixels never read each other. §9 averages colour within a pixel's own
  supersamples and nothing else.
- **The op list is uniform across a tile.** `F.OPC` is compiled once per tile, so every invocation
  walks the same records in the same order — no divergent branching between neighbouring pixels, which
  is the usual thing that ruins a shader port.
- **The stir lattice is a texture.** 161 × 101 paired Float32 read bilinearly, which is a *free*
  hardware operation on a GPU and is currently four cache lines per stir on the CPU because `u` and `v`
  are separate arrays 644 B apart.
- **`exp`, `sin`, `atan2`, hashes and fbm** are what shader cores are for.
- **The SDF loop in `glassLay`** is a rounded-box distance per compartment — textbook shader work.
- **Supersampling is embarrassingly parallel** and is pure multiplication of the same work.

The per-tile constants (`F.TH`, `canes[]`, `kr/kg/kb`, `LBR/LBG/LBB`, mould extents, `SSO[]`) are
uniforms. The compiled op list is a small uniform buffer or a 1D texture.

---

## 3. What breaks: the ribbon label

This is the whole of the risk and it is specific.

`docs/renderer-determinism.md` already establishes that **mixing engines is not safe** — Gecko draws a
heavier line than Blink on the same slab with the same signature — while farming across Blink on
different CPU architectures *is* safe, at ±1–3 levels on 85.8% of channels. A GPU is further from the
CPU than x86 is from ARM:

- JavaScript numbers are **doubles**; a shader is **fp32**, and WebGPU does not offer fp64.
- GPU transcendentals are not IEEE-exact. `exp`, `sin` and `atan2` vary by vendor and driver version
  within the allowed ULP budget.
- So the same slab would not reproduce, on any device, ever.

For most of the pipeline that would be a tolerance question. **§7 is why it is not.**

> `out[0]` is an integer compartment, and the average of ribbon 3 and ribbon 7 is not a ribbon — which
> is why nothing downstream may interpolate a coordinate, and why every optimisation here has to be
> bit-exact rather than close.

A fp32 coordinate that lands a hair the wrong side of a `glassCellSDF` boundary does not shade
slightly differently — it selects **a different cane**, and the doc measures that class of error at up
to **130 levels**. Compare the analytic-gradient change discussed in §4 of that doc, which is also not
bit-exact but "never touches a coordinate and never touches the ribbon label" — a re-verified claim.
That doc also said it "shifts shading by a fraction of a level"; measured, it is 2.6–4.8 levels on
four of five forms. The CLASS is what separates the two cases, not the size: a shading-only change of
five levels is still categorically safer than a coordinate change of one, because only one of them can
select a different cane.

**Two classes of inexactness, and the GPU sits in the dangerous one.** Any port has to treat the
coordinate walk and `glassLay` as structural, not numeric.

### What that means in practice

A GPU pass is a **different renderer**, not a faster one, and must be labelled as such everywhere the
output is compared — the same way `bloomless` and `omits` already declare a path that produced
something different. Concretely:

- the master records which renderer drew it, so a reader a year later is never guessing;
- `renderSig` / the gallery gate must not treat a GPU master and a CPU master as the same picture;
- the engine gate in `docs/gallery.md` gains a fourth row rather than folding into an existing one.

---

## 4. Do the cheap thing first

`glass-one-pixel.md` §4 already specifies a **36.5%** saving with no GPU at all:

> Called at `(ox, oy)`, `(ox+ε, oy)` and `(ox, oy+ε)` — the third and second are a finite-difference
> gradient, used only for shading. **An analytic gradient is available and would collapse three calls
> into one.** Twelve hashes instead of thirty-six.

Measured on a 1024 tile: all three calls are 40.6%, the gradient pair alone 27.9%; scaled to a 4096
tile that is **about 6.2 s of a 16.9 s tile, roughly three minutes of an 8:18 master**.

It is not bit-exact either — but it lands in the *safe* class: it feeds only `sl` in the shading
multiplier, never a coordinate, never the label. So it costs existing masters their reproduction and
buys a third of the render back, on every device, with no new renderer, no toggle, and no capability
matrix.

**Doing this first also makes the GPU case honest**, because it removes a third of the work the GPU
would otherwise be credited with removing.

---

## 5. The hardware is not the obstacle

Measured on the machine in question — Ryzen 5 5500, **Radeon RX 6500 XT**, 4 GB, PCIe 4.0 ×4:

| | |
| --- | --- |
| readback per 4096 tile | 67 MB |
| PCIe 4.0 ×4 | ~8 GB/s theoretical; this drive sustained 349 MB/s to disk, so the link is not the floor |
| readback cost | **~15–20 ms against a 16.9 s tile** — 0.1% |
| VRAM for 8 workers | 8 × 67 MB = **536 MB of 4,096** |
| observed VRAM peak | 2,378 MB, dynamic spill flat at ~200 MB |

The ×4 link is this card's famous weakness and it does not matter here, because the traffic is one
readback per tile rather than streaming. The card ran the entire 12-minute glass render at **94 MHz of
a 2,887 MHz clock and 4 W** — there is an order of magnitude of headroom sitting idle.

That was read off HWiNFO live and no archived log covered it, so it was unverifiable for eleven days.
Reproduced 2026-10-22 on `glass hard baseline-65535-day-win-chrome-1022-211553`, 229 samples over
7:41: **3.0% util, 112 MHz, 3.3 W, 29.9 °C**, while the CPU held 72.5% mean at 4,173 MHz and 48.2 W
with no throttling. The original reading stands to within 18 MHz and 0.1 percentage points.

The real hardware question is not this card. It is that the fleet includes an iPhone, an S23, a Tab A
8.0 and an A7 Lite, and a GPU path that only works on the desktop splits the fleet in a way the CPU
path never has.

---

## 5a. The fleet is where this goes wrong, and it is measurable

A GPU path as the *main* path would hurt every device except the one it was written on. Three
separate reasons, in increasing order of how hard they are to work around.

**The GL texture limit already excludes the tiles in use.** `maxTexture` is the one GPU fact a master
carries, and the archive has it for every device:

| device | maxTexture | pass sizes used | largest + bleed | |
| --- | --- | --- | --- | --- |
| desktop | 16384 | 256 … 8192 | 8200 | fits |
| iPhone 14 Pro | 16384 | 512 … 2048 | 2056 | fits |
| S23 Ultra (Blink) | 8192 | 512 … 2048 | 2056 | fits |
| A7 Lite | 8192 | 512 … 2048 | 2056 | fits |
| **Tab A 8.0** | **4096** | 512 … **4096** | **4104** | **exceeds it** |

The Tab A has rendered at a 4104 tile on a device that reports a 4096 limit, **because the 2D canvas
path is not bound by it** — a canvas larger than the GL maximum is allocated and painted anyway. A
texture-backed path has no such freedom. So on that device a GPU renderer silently caps at 2048 where
the CPU renderer uses 4096, and `canvasFits` would not catch it because `canvasFits` probes a 2D
canvas. Note also the S23 reports 8192 under Blink and 16384 under Gecko on the same silicon: the
limit is a driver and browser policy, not a hardware constant, so it cannot be inferred from the
device.

**The compute ratio that justifies this on the desktop does not exist on a phone.** A discrete card
has roughly an order of magnitude on its host CPU — which is why a 6500 XT idling at 94 MHz beside six
pinned cores is an obvious waste. An entry-level mobile SoC's GPU shares a die, a power budget and a
thermal envelope with its CPU, so the ratio collapses toward parity. The same port that is a large win
on one machine is a rounding error on a Tab A and may be a loss once setup and readback are counted.

**And on mobile the memory is unified**, so GPU work competes for exactly the bandwidth the render
already needs — on a 2 GB device, where `memBudget()` is 537 MB and `poolWidthFor` is already the
binding constraint, that is the worst possible thing to add. The desktop's discrete VRAM is what makes
its readback free; a phone has no such separation.

**Thermal closes it.** The 12-minute glass render on the desktop **never reached steady state** — core
temperature was still climbing 66.0 → 70.5 °C in its final third at 58.9 W. A phone reaches its limit
in a fraction of that time and throttles the GPU first, because the display compositor has priority.
A 12-minute desktop render is a 2-hour mobile one, and the mobile fleet is where the long renders are
least forgiving.

**Which is the argument for the order in §4 rather than against the GPU.** The analytic gradient is
~36% on *every device in the fleet*, in the safe class of inexactness, with no capability matrix. The
GPU path is a large win on exactly one machine and a liability on the rest. Both are worth doing; only
one of them is worth doing first, and only one of them should ever be reachable without being asked
for.

---

## 6. The toggle

Opt-in, and the shape is already established by `?tile=` and `?pool=`: a deliberate control that is
**off by default**, never chosen by a planner, and recorded in the master when used.

- **Default off, always.** The CPU path stays canonical. A GPU master is a deliberate artifact.
- **Declared in the metadata**, not inferred. Absent means CPU, the way absent `bloomless` means the
  bloom was there.
- **Refuses rather than falls back silently.** If `navigator.gpu` is missing or adapter request fails,
  say so — a silent fallback would produce a CPU master that the operator believes is a GPU one, which
  is the `poolWhy` lesson from 2026-10-21: a window refused the worker pool for weeks and the file said
  nothing, so the pool measured at 0% and the retraction went into the repo.
- **Never on the tile ladder or in the planner.** Same reasoning that put 8192 behind `?tile=` — and
  §5a is the stronger version of it: a planner that could choose the GPU would choose it on a Tab A,
  where the GL limit halves the tile, the memory is unified and the thermal budget is a fraction of a
  desktop's. The one device that benefits is the one nobody needs to protect.

---

## 7. What it would and would not buy

**Would:** glass at 5.4 Mpx/s is the only thing here with an order of magnitude on the table, and the
work is the right shape. If a shader reached even a tenth of this card's idle headroom, an 8:18 master
becomes minutes.

**Would not:** anything for stone, which is every large render made so far; anything on the fleet until
each device is proven; and nothing at all for the hand-off ceiling that makes a 1,048,576 take 79
minutes with 4.17 threads of 12 busy.

**Open questions, in the order they should be answered** — all four now answered, three of them not
the way this list expected:

1. ~~Land the analytic gradient.~~ **DONE, build `2026.10.22.172`.** ~18% off a 65,535, on every
   device, no toggle — revised up from 12.4% once the baseline it had been measured against turned out
   to be memory-starved. The only item on this list that paid, and the only one that needed no GPU.
2. ~~Measure whether `OffscreenCanvas` 2D in a worker is falling back to software raster.~~
   **ANSWERED 2026-10-22: it is not.** A stone render drives this card to 1,911 MHz and 59.5% mean
   utilisation, so the accelerated path works and reaches a worker. The 94 MHz is glass declining to
   use a GPU that stone uses heavily — the difference is the workload, not a setting. Nothing to fix.
3. ~~A WebGPU compute pass for `glassFormT` alone, 40.6% of a tile.~~ **CLOSED.** That 40.6% was
   measured on a slab whose `glassFormT` takes a long branch. On a *poured* sheet it takes the
   shortest one — a single `fbm2`, no `sqrt`, `exp`, `sin` or `cos` — and measures ~20% of a tile,
   so this step's ceiling there is 1.25×. A second renderer behind a toggle for 1.25× is not a thing
   to build.
4. ~~The full per-pixel port.~~ **CLOSED.** Priced against the measured GPU ratio rather than an
   Amdahl ceiling: 1.90× on the desktop, 1.56x on the S23, 1.82× on the iPhone, impossible on the
   Tab A. The ceiling said 21×; the ceiling assumed an infinitely fast GPU and this one is 1.3–1.9×
   a CPU pool.

**What this list got right**, and it is worth saying because the ordering was the useful part: step 1
first, and step 1 was the whole return. Doing the cheap CPU thing before the expensive GPU thing is
also what made the GPU case honest — §4 said so at the time, and it was right for a reason it could
not have known, since landing the gradient is what revealed `glassFormT` to be 20% rather than 40.6%
of a poured tile.

**What would reopen this.** A material whose per-pixel cost is float-dominated rather than
hash-dominated, or a device whose GPU is strong where its CPU is weak. Neither exists in this fleet.
Wood is the only untested material, and its cost profile is unknown.

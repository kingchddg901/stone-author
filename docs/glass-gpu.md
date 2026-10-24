# A GPU path for glass — measured, and worth building for the long ones

Status: **CLOSED 2026-10-24. Do not build it.** Both halves are now measured and they point opposite
ways. A GPU-native field is **246× the eight-worker pool** (`tools/gpu-native-probe.html`, three
devices) — and the field is only **13–18% of a render** (`tools/count-field-calls.mjs`, counted on
the master slab), so the whole port is worth **1.15× to 1.21×**. 5:05 becomes about 4:20. That buys a
second renderer, a second code path for the ribbon label, and a picture that is no longer
byte-identical across GPU vendors. Read "What the field is actually worth" first; the rest of the
page is the reasoning that led here and is kept.

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

### Answered: it is not the core, it is V8 on the composed noise functions

`tools/cpu-breakdown-probe.html`, run 1 after a fresh load on all three devices, each piece calibrated
to run long enough to clear the clock's granularity.

| piece | desktop, V8/x86 | S23, V8/ARM | iPhone 14 Pro, JSC/ARM | desktop ÷ iPhone |
|---|---|---|---|---|
| baseline `a*b+c` | 1.42 | 1.79 | **2.02** | **0.70×** |
| `Math.imul` | 0.45 | 0.52 | 0.35 | 1.29× |
| `Math.floor` | 0.80 | 0.70 | 0.65 | 1.23× |
| `nz` | 1.34 | 1.13 | 0.88 | 1.52× |
| `Math.exp` | 9.55 | 7.43 | 3.16 | 3.02× |
| `vnoise`, uncached | 5.99 | 6.03 | 3.50 | 1.71× |
| `vnoiseC` | 12.67 | 10.97 | 3.13 | **4.05×** |
| `fbm2C` | 40.0 | 36.83 | 9.09 | **4.40×** |
| the whole sample | 110.9 | 95.74 | **33.17** | 3.34× |

**The iPhone has the SLOWEST baseline of the three.** 2.02 ns against the S23's 1.79 and the desktop's
1.42, on a serial multiply-add chain — and it still does the whole sample 3.3× faster. Whatever is
happening, the silicon is not ahead on plain arithmetic. That closes "an A16 is just that good".

**Two instruction sets running V8 agree within 16%; one ARM core running JavaScriptCore is 2.9× away.**
x86-64 and ARM landing together while a second ARM part lands three times off is the engine, not the
hardware.

**And the primitives are near-equal.** `Math.imul` 1.29×, `Math.floor` 1.23×, `nz` 1.52×. V8 is not
bad at this arithmetic. It is bad at the *composition* of it:

| | `fbm2` against its own three `vnoise` calls |
|---|---|
| desktop, V8 | **2.53× its parts** |
| S23, V8 | **2.21× its parts** |
| iPhone, JSC | **0.96× its parts** |

On JavaScriptCore the octave stack costs exactly the three calls inside it. On V8 it costs two and a
half times them — the pieces are fine and the function built out of them is not, which is the
signature of calls that are not being inlined or of a function that has fallen out of the optimiser's
budget. **This project has already met that exact failure**: `vnoiseCfill` was outlined from `vnoiseC`
precisely because a hot function carrying calls can fall out of V8's inlining budget, and it produced
bimodal per-render behaviour until it was.

### Answered again, one level down: V8 does not inline `vnoiseC`

`tools/vnoisec-gap-probe.html` takes the function apart instead of rewriting it. Each piece gets its
own loop, because a first version shared one `walk(body)` helper whose single call site went
megamorphic across seven bodies and measured an indirect call every time — `nz` read 12.17 ns there
against the 1.34 it actually costs.

| | ns a call |
|---|---|
| floors, key reads, value reads, arithmetic — **summed** | **3.94** |
| `vnoiseC` as shipped | 12.26 |
| `vnoiseC` made call-free, typed array kept — build 174's shape | 12.41 |
| `vnoiseC` declared normally rather than lifted — **control** | 12.47 |
| **`vnoiseC`'s body inlined into the loop** | **3.54** |
| JavaScriptCore's `vnoiseC` | **3.13** |

**The body costs 3.5 ns and the call costs 9.** JSC's 3.13 is the inlined-body figure, so JSC inlines
this function and V8 does not — and that is the whole 4×. It also explains the rest at a stroke:
uncached `vnoise` is inlined by both, so those sit 1.71× apart; the primitives are all inlined, so
they are near equal; and the variants probe's full-inline arm swinging between 0.564× and 0.888× was
V8 *sometimes* inlining.

**Confirmed on a second V8 device, 2026-10-24.** An S23 re-ran the breakdown and shows the same
signature: `vnoiseC` 10.80 ns against an uncached `vnoise` of 6.03 — the cached form costing MORE
than the uncached one, which is backwards for a cache and only possible if the call is not inlined.
The iPhone is the only device where it goes the right way round, 3.13 against 3.50. Two V8 builds on
different instruction sets agree with each other; JavaScriptCore does not. The run reproduces across
sessions too: 96.25 ns a sample against 95.74 earlier the same day, 0.5% apart.

| | `vnoiseC` | uncached `vnoise` | cached / uncached | the call, over a 3.54 ns body |
|---|---|---|---|---|
| desktop, V8 | 12.26 | 5.99 | 2.05× | 8.72 ns — **8.4% of a 625 ns pixel** |
| S23, V8 | 10.80 | 6.03 | 1.79× | 7.26 ns — **7.3% of a 594 ns pixel** |
| iPhone, JSC | 3.13 | 3.50 | 0.89× | none — the cache pays, as it should |

There are six `vnoiseC` a pixel, so **roughly 8% of every pixel on V8 is one function not being
inlined**. A shader pays none of it, which is a small part of the GPU path's case and the first part
of it that is measured on two devices rather than argued.

**All three devices, both engines, every piece.** The decomposition now exists on a JavaScriptCore
device as well, and it makes the finding much sharper than one engine could:

| ns a call | floors | key | 4 reads | arith | nz | **body inlined** | **called** | **call tax** |
|---|---|---|---|---|---|---|---|---|
| desktop, V8 | 0.99 | 1.74 | 0.72 | 2.41 | 1.34 | **3.54** | 12.26 | **+8.72** |
| S23, V8 | 0.81 | 1.49 | 0.95 | 3.16 | 1.29 | **3.63** | 10.93 | **+7.30** |
| iPhone, JSC | 0.96 | 1.18 | 0.86 | 2.45 | 0.97 | **3.38** | **2.93** | **−0.45** |

**Every piece is near equal and the body costs the same everywhere — 3.38 to 3.63 ns across two
engines and three parts.** The whole of the 4× is the call: V8 pays 7–9 ns for it and JSC pays
nothing. On JSC the called form is in fact marginally CHEAPER than the inlined one, which is why that
device’s run flips the probe’s own verdict line to “it is not the call” — correct there, and the
reverse of V8.

**And it accounts for the gap.** The desktop sample is 110.9 ns against the iPhone’s 33.3, a
difference of 77.6. Six un-inlined `vnoiseC` calls are **52.3 ns of that, 67%**; three `Math.exp` are
**19.1 ns, 25%**. Together **92%**. There is no third thing to find.

**A WRONG INFERENCE, KILLED BY THE SAME RUN.** Before the iPhone ran this, the reasoning was that
JSC’s body must be cheaper in its non-flop part — seven `Float64Array` reads — because JSC’s whole
called function beat V8’s inlined body on a device whose baseline flop is 43% slower. The direct test
says no: four value reads cost **0.86 ns on the iPhone against 0.72 on the desktop**, so JSC is
*slower* at typed-array access, not faster. The advantage is the call and only the call.

**And §2306’s outlining is vindicated hardest on JSC.** Folding the miss path back into `vnoiseC`
costs 8.32 ns there against 2.93 as it ships — **2.8× worse**, where on V8 the same change is within
noise. The decision that fixed build 174’s bimodality turns out to matter far more on the engine that
was never measured when it was made.

**Shape does not move it.** Folding the miss path in — build 174's actual arrangement, which the
variants probe only ever tested alongside a storage change that was independently 20–30% worse —
gives 12.41 ns. The call to `vnoiseCfill` is not what blocks inlining.

**And the probe was controlled against itself.** Everything here is lifted through `new Function`, and
a dynamically compiled closure need not be inlined like an ordinary nested one. Declared normally it
costs 12.47 against the lifted 12.26, so `new Function` is not the confound and every lifted figure
measured today stands — including the `fbm2C` cost the field-share ruling rests on.

**Closed, with no fix.** The only arrangement that reaches 3.5 ns is one inlined copy in a small
function, and `fbm2C` needs three — which makes the enclosing function large enough that V8
flip-flops. There is no stable win available from JS here. What is worth carrying away is the general
figure: **a per-sample helper V8 declines to inline costs about 9 ns a call**, which is why unrolling
the op walk was worth doing and why new per-sample functions should be viewed with suspicion.

**The size of the prize.** `vnoiseC` runs six times a sample, so its 12.67 ns is 76 of the desktop's
110.9. Bringing it to the iPhone's 3.13 would make the sample 27.7 ns — and the whole desktop render
roughly 3× faster, on the renderer that ships today, with no second code path and no device-dependent
filter precision. Even halving it is worth about 1.5×.

**`Math.exp` was tried and there is nothing to take.** It is 3.02× between the engines and 26–29% of
a *sample*, but a sample is not a render: **3 exps a pixel** (counted, by wrapping `Math.exp` during a
real tile) at 9.20 ns is **27.6 ns of 625 — 4.4% of paint**, so even a free one buys 1.046×. And
nothing is free. The arguments live in **−1.1667 to −0.1603**, a range narrow enough that a table
should have walked it, and every replacement measured *slower* than the intrinsic on V8:

| | ns a call | worst, in levels of 255 |
|---|---|---|
| **`Math.exp`** | **9.20** | 0 |
| quarter-range + two squarings | 10.75 | 0.007 |
| Taylor 5 | 11.25 | 0.764 |
| 4,096-entry table over [−8, 0] | 11.45 | 0.0001 |
| Taylor 7 | 12.38 | 0.019 |

Accuracy was never the obstacle — the table is 0.0001 levels. V8’s `Math.exp` is a native intrinsic
and no JS beats it, and the table pays the same typed-array cost that makes `vnoiseC` slow here. The
`woodAtan2` precedent does not carry: `Math.atan2` costs 22.3 ns, which left room for an
approximation, and `Math.exp` at 9.20 does not. The three call sites are
`paintGlassContent`’s Beer-Lambert on `ar`, `ag`, `ab` — per-pixel accumulated absorptions, not
constants, so they share no base and cannot be folded into one exp and a few multiplies either.

**The inlining variants were tried, and none is adoptable.** `tools/vnoisec-variants-probe.html`
builds eight rewrites of `vnoiseC`, each checked bit-identical against the shipped `fbm2C` before
timing, each pitted against it interleaved A/B/B/A. Across six fresh page loads:

| variant | ratio across loads | |
|---|---|---|
| closure variables, no typed array | 1.16 – 1.32× | **always worse** |
| closure vars with the fill inlined | 1.21 – 1.33× | always worse — the known-bad control |
| one shared function, offset passed | 0.92 – 0.99× | stable, and barely a win |
| three functions, offset passed | 0.599 – 0.921× | **swings 54%** |
| key and values in separate arrays | 0.600 – 0.908× | **swings 51%** |
| all three octaves inlined into one | **0.564 – 0.888×** | **swings 57%** |

Each is *tight inside its own run* — the inlined variant read `[16.5 16.5 16.6 16.6 16.6 16.8 16.9
17.0 17.2 17.4]` ms on one load and sat at 26.2 on another. V8 picks a mode when it optimises the
function and holds it for the life of the page. **That is build 2026.10.23.174 exactly**, which took
either 87 or 110 core-seconds for the same input and held whichever it got, and which outlining
`vnoiseCfill` is what fixed. A rewrite that is 43% faster in one session and 11% in the next is that
defect returning, not a win.

**The obvious candidate was wrong.** Plain closure variables — no typed array, no bounds check — were
the most likely fix and are reliably 20–30% *slower*: V8 boxes mutated closure `let`s into context
objects. Recorded so it is not tried again.

**And none of it closes the 4×.** Even the inlined variant's fast mode is 22.8 ns against
JavaScriptCore's 9.09 for the same `fbm2C`. The gap is not the computed index, not the function
shape, and not the call structure. It remains open.

**Not acted on.** A microbenchmark cannot authorise a change to `app/stone-author.html`; the standard
here is a before/after on a real render on the real box. Since the modes live *between* page loads,
the probe now keeps each load's ratios in `localStorage` and shows the history — several loads are
needed before any of these numbers means anything.

**One caveat on the instrument.** The `× baseline` column was meant to be the headline here and it
misled once: the baseline is a *serial* dependency chain, so it measures floating-point latency, while
the field is throughput and memory. The desktop beat the S23 on the baseline (1.42 vs 1.79) and lost
to it on the real sample (110.9 vs 95.7) — ranked opposite to the work. The per-piece ns compared
across devices is what carried the finding; the ratio column is only each device's own profile. The
probe says so on its own page now.

**The corner cache was re-tested and it holds.** Call by call, `vnoiseC` came out at 12.7 ns against
the uncached `vnoise`'s 6.0 — twice the cost, which cannot be squared with the cache being worth 13.3%
of a live render. Stack against stack it is `fbm2C` 40.0 against `fbm2` 45.5, **0.88×, the cache paying
12%**, agreeing with the live figure; on the iPhone 0.90×. The established measurement was right and
the new derivation was the suspect, which is the order those two should be doubted in.

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

### What the field is actually worth

This is the measurement every number above was waiting for, and it closes the page.

`tools/count-field-calls.mjs` puts a counter in each noise entry point and each of its callers and
changes nothing else. On the glass master slab, radial mould, four tiles spread across the sheet, at
the real export size of `renderOneTile(65535, …, 520, 520, 0)`:

| counted | per pixel |
|---|---|
| `fbm2C` | **2.000**, on every tile — one in `glassFormT`, one in `glassLay`'s cord wander |
| `fbm2G` | 0 — `REL` is 0 on this slab, so the gradient path is cold |
| `glassFormT`, `glassLay` | 1 each — **no supersampling**, one sample per pixel |
| tile paint | **597–651 ns**, mean 625 |

`fbm2C` costs 40.0–44.4 ns on this box, so the noise is **80–89 ns of 625 — 13–14% of paint**. Add the
three Beer-Lambert exponentials and the whole modelled field is **17.7%**.

| what a GPU field replaces | share | at 246× | 5:05 becomes |
|---|---|---|---|
| the noise only | 12.8–14.2% | **1.15–1.16×** | 4:21 – 4:26 |
| the noise and the exponentials | 17.7% | **1.21×** | 4:11 |

**So the port is worth about a fifth, not a third and not nine times.** And that is a ceiling: it
treats the GPU side as free, ignoring the 0.59–1.51 ms of submit, fence and map per dispatch. Against
it stands a second renderer to write and keep, §3's ribbon label which cannot be filtered at all, and
a picture that differs by vendor because the texture unit's filter precision does (0.368 levels on
the desktop, 0.822 on an S23). **That is not a trade worth making.**

The sanity check that the tile is the render: 10,033 tiles of 520² cover a 65,535 × 40,959 sheet, and
at 164.9 ms each over eight workers that is 3:27 of paint inside a 5:05 render — the rest being
assembly and encoding, which a GPU field does not touch either.

### Ablation was the obvious instrument and it lied

Worth keeping, because it failed in the direction that looks like a result. Stubbing `fbm2C` and
`fbm2G` to something cheap made a tile take **277.9 ms against the control's 164.9** — *slower,*
after removing work — with per-tile readings swinging 196 to 344. The stub changed the field's
**values**, the values decide the ribbon labelling in `glassLay`, and the renderer then painted a
different picture. An ablation measures the thing it removes only when nothing downstream depends on
what it removed. Counting perturbs nothing: 163.6 ms against the control's 164.9, inside its own
spread.

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

## 2b. The port, measured on the real document

All 282 lines of the per-pixel path are ported and verified function by function in
`tools/gpu-port-harness.html` - eighteen rows, each against the app’s own JS. `tools/gpu-tile-probe.html`
then assembles them into one shader and draws a 512-square tile at W=65535, both ways, from the F that
`paintGlassContent` actually built (captured by `tools/capture-scene.mjs`, read across a same-origin iframe).

**The real document is nothing like a synthetic one, which is why this had to be done twice.** The glass
master carries **eight ops** - stir, blow, blow, spin, stir, blow, stir, roll - **no ribbons at all** (so
`glassLay` takes the procedural strips, not the per-ribbon walk), no roller, no stamps, and the radial
mould on. The invented scene had five ops, six ribbons and five stamps, and measured **67% more work a
pixel** than the renderer does.

### Speed

**97.7× the eight-worker pool** on the real document: 391 ns a pixel on the CPU against 0.50 on the GPU.
The CPU arm lands within 34% of `renderOneTile`’s measured 594 ns a pixel, the remainder being the canvas
write, the tile setup and the band loop, which this does not do and a GPU would not take over.

That is lower than the 247× the synthetic scene gave, for the obvious reason: the real document is less
CPU work per pixel while the GPU time did not move. **It is also a floor rather than a figure** - the GPU
finished the tile in 0.131 ms seven times running, which is close enough to the clock that the ratio is
bounded by the measurement rather than by the hardware.

### And §3’s failure is real, with exactly one cause

| | worst | channels past 5 levels |
|---|---|---|
| all eight ops | **64.5 levels** | **3.10%** |
| the same tile, roll dropped | **0.000 levels** | **0** |

Not general fp32 fuzz. **One op, and through it one line of the app.** The roll multiplies y by 2.5, which
puts every pixel of the tile at `cvv ≈ −0.685` - outside the warp grid’s [0, 0.625]. `glassUnwarp` then
clamps the grid INDEX and not the INTERPOLANT:

```
let i0 = fx | 0, j0 = fy | 0;
if (j0 > S.ny - 2) j0 = S.ny - 2; if (j0 < 0) j0 = 0;   // the index is clamped
const ty = fy - j0;                                      // ty is NOT
```

With `fy = −109.6` the index clamps to 0 and `ty` stays at −109.6, so the bilinear blend becomes
`u[k]·110.6 − u[k2]·109.6` - a difference of two numbers a hundred times larger than the answer.
**f64 absorbs that and f32 cannot.** The grid’s own values span [−0.452, 0.660]; the extrapolation returns
−1.123, a 0.75 ft displacement the stir never authored.

**This is a property of the CPU renderer, not of the port**, and it is in every master with a stir and a
roll in it. It is deterministic, so nothing on disk is wrong in the sense of varying - but the guard that
exists reads as complete and is not. Clamping `tx` and `ty` would make the GPU path agree to **zero levels**
on this document, and would also move the CPU’s own picture, so it is a deliberate change rather than a fix
to be slipped in.

### The readback, and why the wasted byte pays for itself

**The pack writes RGBA, and three bytes a pixel was the wrong answer even though it moves less.** The
shader's second entry point reads the f32 buffer where it already lives and writes bytes beside it, so
only the bytes cross the bus. RGB is a quarter less again to move and it is what shipped first - but a
canvas is RGBA, so the readback then had to spread three bytes into four, a JS loop over 4.2 million
pixels a tile. Writing the fourth byte on the device makes that loop a single `TypedArray.set`.

Measured through `gpuPool(W, p).tile(n)` on the real document, same plan both ways - 2048 px render
tiles plus bleed 4, so 4,227,136 px a tile, W=16384, eight tiles spread across the sheet, best of three
reps:

| | the readback | `tile()` in all |
| --- | --- | --- |
| RGB, spread into RGBA in JS | 53.67 ms | 72.61 ms |
| RGBA, one `set()` | **2.15 ms** | **29.54 ms** |

**25× on the step and 2.46× on the GPU half of a tile**, for a third more bytes on the wire. The loop
was 74% of that half; the memcpy is 7%.

**The bytes are the same bytes.** `tools/gpu-sheet-probe.html` compares the packed output against a
`Uint8ClampedArray` of the f32 arm - the exact question, since that is what an ImageData write applies -
and reports **0 of 12,582,912 colour channels apart**, with **660 exact ties** in the run, so a
disagreement about how the two round a tie would have shown up rather than being assumed away. The alpha
is checked separately and the check was ablated: drop the `0xff000000u` and it reports all 4,194,304
pixels non-opaque while the colour channels stay 0 apart. End to end, `tools/gpu-path-check.html`
returns the same four rows before and after the change, channel count for channel count.

**What this does not say.** On the desktop's own exporter the same loop measured 14.6 ms of a 32.5 ms
tile, not 53.7 of 72.6. The figures above come from the hooked build in a browser pane, where a
JS-bound step suffers more than a GPU-bound one. The ratio is the finding; the absolute belongs to the
machine that measured it.

### What a tile is actually made of, and the three answers that were wrong

**Five timers, because four guesses in a row missed.** `gpuOwn` now carries `wait`, `asm`, `sub`,
`map` and `err` beside `copy`, and they partition a tile with the remainder visible. Every design
below was argued from arithmetic first and the arithmetic was wrong every time.

Per tile on the desktop, 2048 render tiles, `?pool=12`, four runs of a 65,535:

| | | |
| --- | --- | --- |
| `map` — awaiting `mapAsync` | 15.85 – 16.04 ms | shader + pack + the readback |
| `err` — `popErrorScope` | **7.80 – 9.41 ms** | **28% of a 28.5 ms tile** |
| `asm` — ground, blit, coat, windows | 1.62 – 1.77 ms | |
| `copy` — the memcpy | 1.17 – 1.29 ms | |
| `sub` — encode and submit | 0.06 ms | |
| outside `draw` — loop, OPFS, handoff | 4.58 – 5.86 ms | |

**The composite is 1.7 ms, not 13.** It was going to be moved into the finish workers on the
strength of a 13.4 ms figure that came from subtracting `copy` from `draw` and assuming the
remainder was `renderOneTile`. With the coat off - and this slab has `specular 0, subsurface 0,
lens 0, backlight 0, sigma 0`, so `applyCoat` returns early - the composite is nothing. Turn three
coat tokens up to 0.6 and the same tile goes from 27 ms to 239, so the work is real and this slab
simply does not ask for it: **the GPU path is fast on bare slabs and has never been measured on a
coat-bearing one.** That is a hole in the toggle rather than a shave on a benchmark.

**Submit batching is dead.** `sub` is 0.06 ms, and a bare 16.1 MB readback batched four into one
submit measured 1.19× against one at a time - 6.1 ms a tile against 7.25. The sheet probe says the
same thing in its own words at this size: *1.09×, nothing.*

**And `popErrorScope` is 28% of a tile on one machine and 8% on another.** 7.8-9.4 ms on the
desktop against 1.3-2.5 ms in the harness, while `map` is 16 ms on both - so it is not the bus and
it is not the shader. Ablating the await in the harness moved the number into `map` and left the
wall clock alone, which is the same lesson the RGBA readback taught: removing a serial await does
not remove the device's latency, it relocates which await is holding it. With the lookahead running,
tile *i*'s pop is waiting on tile *i+1*'s submitted work as well.

What the scope was costing it was not buying, though. Every band of every tile pushed one, and
validation can only newly fail when the dispatch geometry changes - which comes from `rows`, and
`rows` takes two values in a whole render. So the scope is kept for an unseen row count and
`dev.onuncapturederror` carries the rest. **That handler did not exist**: errors raised outside the
scope went to the console and nothing could fail a render on them.

**And the replacement did not bite, which only a probe caught.** It threw at the end of `paintOne` -
the producer - and the producer runs ahead of the consumer: tile 1 drew cleanly after a validation
error was raised on the device, because its paint had already completed as tile 0's prefetch. One
tile late with a single prefetch, up to thirteen with the finisher lookahead, and those tiles are
written to OPFS and the TIFF rather than discarded. The gate belongs at the handoff, so
`pool.tile()` and `pool.finish()` both refuse once a fault is visible, and
[`tools/check-gpu-fault.mjs`](../tools/check-gpu-fault.mjs) reads those two call sites rather than
the handler - ablated three ways, each one red.

**`?pool=12` is worth 1.11×** and costs nothing: `?pool=N` already existed. Four 65,535 runs at
18.2-19.3 s against 20.3-21.4 at the default 8, and the richer build they ran on carries timers that
cost time rather than save it, so it is a floor. The finisher width is also recorded now - the GPU
pool pins `workers: 1` because the GPU paints and one thread drives it, so `?pool=12` produced a
record byte-identical to `?pool=8` in every field and the experiment could only be judged on a wall
clock with its own variable unrecorded.

### The readback does not have to touch the main thread, and the proof took two wrong turns

**`map` is 23.4 ms of a 28.2 ms tile - 83%, one device round-trip, all of it serial on the main
thread.** It is there because the bytes have to arrive in JS before `putImageData` can place them.
They do not have to: a compute pass can write a storage TEXTURE, a render pass can blit that onto a
canvas, and `transferToImageBitmap` hands the canvas to a worker without this thread ever seeing a
pixel.

| 2056 square, one real export tile | main thread | and then |
| --- | --- | --- |
| compute to a buffer, map it, read it here | **8.0 ms** | - |
| compute to a texture, render it, transfer the bitmap | **0.2 ms** | a worker spends 15.4 ms reading it |

**THE FIRST VERSION OF THAT MEASUREMENT WAS A NO-OP AND IT SAID 20x.** It made the CANVAS texture
the compute pass's storage target. The canvas is `bgra8unorm`, `STORAGE_BINDING` on that format is
a validation error, and there was no error scope around it - so the pass never ran, the pixel asked
to be red came back `[0, 0, 0, 255]`, and the timing was the cost of doing nothing. The number was
reported before anybody looked at a pixel.

What replaced it writes an `rgba8unorm` texture we own and lets the RENDER PASS convert into
whatever the canvas is. That needs no feature flag - `bgra8unorm-storage` is in the adapter's list
but was never requested - and it cannot swap channels, because the hardware does the conversion
rather than the shader guessing the order. Verified rather than assumed: a pixel asked for R44 G128
B0 comes back `[44, 128, 0]`, and `gpu-sheet-probe.html` counts red-against-blue per pixel.

### And the quantisation has to be told where the tie goes

A texture store takes 0..1 and quantises itself, so the obvious spelling hands it `PX[o] / 255.0`
and lets the hardware multiply by 255 again. That round trip through f32 is not exact on a tie, and
this document produces 660 real ones:

| the texture arm, 16 tiles against the f32 reference | channels apart |
| --- | --- |
| `PX[o] / 255.0` | **76** of 12,582,912, worst 1 level |
| `clamp(round(PX[o]), 0.0, 255.0) / 255.0` | **0** of 12,582,912 |

Eleven per cent of the ties went the other way. Rounding first - the same `round()` the byte pack
uses, in the same order - leaves an integer, and `n / 255 * 255` in f32 lands within 3e-5 of `n` for
every `n` in 0..255, so the quantiser has no tie left to break.

**That is the difference between a faster readback and a new painter.** One level on 76 channels is
invisible next to the 108-level f32 stir divergence this path already carries, but it is not
nothing: it would have meant its own `renderSig` key, a resume that refuses across the switch, and
every master re-dated. Byte-identical means the readback can move to a worker and nothing else
changes.

Both arms live in [`tools/gpu-sheet-probe.html`](../tools/gpu-sheet-probe.html) against the same
reference and the same tie counter, so there is one gate for "the GPU's bytes are the canvas's
bytes" rather than two that can drift apart.

### Step one of two: the composite moves, and the bytes do not

The texture readback only works if the worker can wrap the glass, because the main thread never sees
a pixel to wrap it with. So the ground, the coat and the windows move first - on their own merits
that is worth 1.6 ms a tile, which is nothing, and the reason to do it is the readback that follows.

`tile()` was one function: paint, then composite. It is two now. `paintSlot(i)` carries the prefetch,
the slot rotation and the fault check and hands back a slot; `glassFrom(slot)` puts that slot's
ImageData on a scratch surface and transfers it out as a bitmap; `tile(i)` is still there, composite
and all, for the sequential path and for `gpu-path-check.html`. The worker gained a third branch
beside `d.bmp`: `d.glass` is the picture only, blitted inside `woodRect()` under the tile's own
transform, with everything `renderOneTile` wraps round it still to happen.

**And the gate is the bytes that reach the TIFF, not an intermediate canvas.**
[`tools/gpu-worker-composite.html`](../tools/gpu-worker-composite.html) runs both arms in one build
off one shader - the main thread's `renderOneTile` plus `storedTilePixels`, against the worker's
composite and cut - inflates the deflated parts and compares every channel, because two different
tiles can compress to the same length. **0 apart over 67,108,864 bytes**, with arm A checked for
flatness so that an agreement means something.

It also caught the one defect this step had, on its first run. The message that carries the bitmap
chose its field with `bmp: (bmp && !asGlass) || undefined, glass: (bmp && asGlass) || undefined` -
and `a && b` yields `b`, so `glass` was the BOOLEAN `true` rather than the bitmap. Every tile threw
in `drawImage`. Written out as a ternary and checked as a truth table rather than by eye.

## 2a. RULING 2026-10-24: a hard toggle, with its trade-offs plain

**His call, and it decides the shape before any code.** The GPU path is a toggle the person throws,
not a mode the renderer chooses, and what it costs is stated where they throw it.

**What that removes from scope.** No auto-detection, no “use the GPU when it looks faster”, no
per-pixel hybrid, no silent fallback to the CPU when a device lacks a feature — a device that cannot
run the path says so and the toggle stays off. None of those should be built, and none of the
measurement effort should go into making the two paths agree: §3 already establishes they cannot, and
the ruling accepts that rather than fighting it.

**What it adds.** The toggle needs honest copy, and honest copy is blocked on measurement — “plain”
means a number, not an adjective. It cannot be written until the port has been built far enough to
say how much faster, how much CPU it gives back, and how far the picture moves. That is what
milestone 1 is for, and the toggle’s own text is one of its outputs. Every string of it routes
through i18n at creation, as everything user-facing here does.

**A consequence worth naming early: resume.** An unfinished render on disk is offered back to be
continued, and a GPU-drawn partial continued by the CPU would seam — not slightly, but at the
§3 class of error, where a coordinate on the wrong side of a boundary selects a different cane. The
renderer has to be part of what resume matches on, beside the existing signature, or the offer has to
be withheld across a toggle change. This is a correctness requirement, not a nicety.

**And the preview follows the toggle.** Authoring on one renderer and mastering on the other means
what you saw is not what you get. A hard toggle is coherent precisely because it can switch the whole
app, editor included; a toggle that moved only the export would reintroduce the mismatch it exists to
make visible.

**Left undecided:** where the toggle lives, and whether it is per-document or per-install.

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

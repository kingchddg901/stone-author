# A GPU path for glass — scope

Not a plan to build one. A written answer to "would it help, what would it cost, and what breaks",
so the decision is made against measurements rather than against the obvious appeal of an idle GPU.

**The short version.** Glass is the one material here that is genuinely compute-bound, the work is
almost exactly fragment-shader shaped, and the GPU sits at 3% of its clock while six cores burn. But a
GPU pass **cannot be bit-exact with the CPU pass**, and §7 of `glass-one-pixel.md` explains why that is
worse for glass than it would be for stone. So this is a *second renderer behind a toggle*, not an
optimisation — and there is a 36% CPU win already specified that should land first.

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
| GPU | 2.9%, **94 MHz of 2,887** | idle |

Stone is bound by its hand-offs — 0.72 CPU threads per busy worker, drive under 7%, memory with
headroom, nothing saturated. **A faster compute device makes a render that is waiting wait at the same
speed.** Glass is the opposite: it is the only workload in the archive that pins this machine, and it
pins it doing arithmetic.

So the GPU question is a glass question. Stone would get nothing, and every 1,048,576 rendered so far
has been stone.

---

## 2. The work is fragment-shader shaped

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
bit-exact but "never touches a coordinate and never touches the ribbon label", so it "shifts shading by
a fraction of a level".

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

**Open questions, in the order they should be answered:**

1. Land the analytic gradient. A third of glass, on every device, in the safe class of inexactness.
2. Measure whether `OffscreenCanvas` 2D in a worker is falling back to software raster on this
   machine — the GPU at 94 MHz during a CPU-pinned render says something is not reaching it, and that
   may be a setting rather than a missing renderer.
3. Only then: a WebGPU compute pass for `glassFormT` alone, which is 40.6% of a tile and does **not**
   touch the ribbon label — the largest win in the safe class, and a port small enough to validate
   against the CPU path tile by tile.
4. The full per-pixel port, with `glassLay` kept on the CPU or proven exact, last.

Step 3 is the interesting one: it is most of the win, and it stops short of the thing that breaks.

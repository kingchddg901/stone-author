# A GPU path for wood — the second material through the same pipeline

`glass-gpu.md` is the long argument: whether a shader is worth it, what a tile is actually made of,
how the readback gets off the main thread, and the three instruments that were wrong before the
fourth was right. **None of that is repeated here.** This is the delta: what a second material cost,
what it found, and what it is reachable from.

It also closes a prediction that document made. Its controlled matrix — one slab carrying all three
materials, one build, one width, one tile size — ended with:

> Both instruments say the same thing: **a shader port would help wood - less than it helped glass,
> and not nothing.**

That was a forecast from per-pixel cost and worker scaling, with no shader in existence. The row is
now measured, on the same slab at the same 65,535 and the same 2048 tile:

| material | path | wall | Mpx/s | against its own CPU |
| --- | --- | --- | --- | --- |
| stone | CPU, 12 workers | 26.0 s | 103.0 | — no port, and none wanted |
| wood | CPU, 12 workers | 105.8 s | 25.4 | — |
| wood | **GPU, 8 finishers** | **12.5 s** | **214.7** | **8.5×** |
| glass | CPU, 12 workers | 222.5 s | 12.1 | — |
| glass | GPU, 12 finishers | 11.3 s | 238.1 | 20.0× |

*2.684 Gpx per render. Stone, wood CPU and both glass rows are the matrix in `glass-gpu.md`; the
wood GPU row is this port.*

**The forecast was right in both halves.** Less than glass — 8.5× against 20.0× — and a long way from
nothing.

**And the shader collapses the per-pixel difference between materials.** On the CPU, wood is 2.1×
cheaper per pixel than glass. On the GPU they land at 214.7 and 238.1 Mpx/s, a 1.1× spread, because
neither is bound by its field any more.

**WHAT BOUNDS THEM INSTEAD IS NOT KNOWN, and an earlier draft of this line said it was.** It claimed
the remainder is the bus, on the grounds that every GPU render here writes at about 7 MB/s out while
raw pixels come in at 700–860 — and concluded that a third material should be predicted from that
band. Stone falsified both halves the same day. Measured at 65,535 on this slab, stone writes
**22.1 MB/s out**, three times the rate that was being read as a ceiling; so wood’s GPU render at
7.4 MB/s is not write-bound either, and 7 MB/s was only wood’s byte volume divided by wood’s time.

**So do not predict a material from that band.** Stone is the counterexample, and it is measured —
see *What a port would buy stone* at the end.

---

## 1. The pipeline was not the work

`gpuPool` is four hundred lines: two buffer sets so tile *n+1* is on the device while *n* is
deflated, a lookahead that keeps the finishers fed, bands sized to `maxStorageBufferBindingSize`, a
fault gate at the handoff, one submit per band. Wood needed every line of it and changed none.

So what went in is the material-shaped hole, not a second pool:

```js
const GPU_MAT = {
  glass: { code, uni: 304, off, why, pack },
  wood:  { code, uni: WOOD_UNI_BYTES, off, why, pack },
};
```

Five entries. `code()` is the WGSL, compiled once per material and memoised on the capability;
`uni` the uniform's byte size; `off()` the three byte offsets the pool patches per band; `why()` the
material's own refusals; `pack()` the scene.

**A copy was the other option and it is the worse one.** This path is measured on hardware three
times over, and every fix it has had — the fault gate moved to the handoff, one submit per band
rather than per tile, the texture readback — would afterwards have had to land twice, with a green
suite unable to see a missing copy.

### The capability splits: device once, module per material

`gpuCapability()` used to open the device *and* compile the shader, caching one verdict. With two
materials that is wrong: a wood module that will not build on some device would refuse glass there
too, which is a refusal for a reason that is not true. The device check and `gpuModule(mat)` are now
separate, the module is memoised per material, and `gpuWhyNot()` reads the answer rather than
computing it — which is what keeps that predicate synchronous.

**One visible consequence.** The GPU row in the export panel is now shown whenever the *device*
opens. On a machine where the shader will not compile you get the row plus `exp.gpu.noshader` named
in the panel, instead of the switch silently vanishing. The reason is visible; the behaviour changed.

---

## 2. The Env is generated, and that is what found the defects

`wood-real.mjs` names every slot of its own uniform in two lists, and `wood-gpu.mjs` builds the WGSL
struct by walking them. One list, two readers, no replica. The glass side does it the other way — a
bare array there, a hand-written struct here — and that pair is why `check-gpu-sync` exists.

Three defects came out of writing it, and the point is that **all three compile, run, and paint
wood.** None is a crash or a syntax error.

| | what it was | what it would have shipped |
| --- | --- | --- |
| `E.EYESF` | read twice, `E.EYES` read twice — a leftover from when EYES was an int flag and the strength needed a float beside it | the eye dimple and the gloss darkening silently gone: the slider moves and nothing happens |
| `HASFIRE` | tested `F.FIRE.length` on a value that is the boolean `kf > 0`, so it packed **0 for every tree**. `FIRE` also had an arena part, `f32(true)` — a one-element array of zero built by coercion | a burnt log rendering unburnt |
| `SQ` | workgroup scope, copying the app's one shared scratch array | at a workgroup of 64, sixty-four pixels writing the same four slots — feature strengths bleeding between neighbours, which reads as noise in the figure |

Generation is what turns the first into a hard failure: an undeclared name does not compile. The
packer closes the other direction — a field the struct declares that nothing supplies makes
`packWood` throw, naming it. **Nothing previously required a field the packer *writes* to have a
*reader*,** and that is the gap `HASFIRE` lived in.

`SQ` is also why `SQ_MAX` exists. A function-local WGSL array needs its length at compile time where
the app sizes one at run time; `packWood` refuses a field with more features than the shader holds,
rather than a truncated loop painting a tree with a branch missing. A gate reads the app's own `DEV`
literal and goes red if it ever outgrows the bound.

---

## 3. The coordinate contract

The CPU painter walks the canvas's inverse affine incrementally — solve the row start, then one add
per column — which is general for any transform and exact in slab space. A shader has no previous
pixel to add to.

It does not evaluate the affine per invocation either. **It normalises the pixel's position on the
sheet**, exactly as the glass path does:

```wgsl
let su = (f32(E.tileX + px) + 0.5) / f32(E.fullW);
let sv = (f32(E.tileY + py) + 0.5) / f32(E.fullW);
```

That is equal to inverting the transform **only when the transform is diagonal**, and it is:
`renderOneTile` sets `setTransform(finalW, 0, 0, finalW, -ex0, -ey0)` — `b` and `c` are literally
zero. The two materials therefore cannot drift apart over what a tile coordinate means. A rotated
transform would need the real inverse; approximating one would move every pixel.

---

## 4. What it refuses

**`exp.gpu.logview`** — `paintWoodLog` cuts the same field at `z = const` instead of `x = const` and
none of it is ported. `paintWoodContent` returns early for the log view, so the shader would draw the
board while the CPU drew the section.

That is the whole list. There was a second one and it was wrong, which is worth writing down.

### The refusal that was aimed at another path

`exp.gpu.woodstage` turned away `stageN() > 1 || woodBandY !== 0`, reasoning that a sectioned or
staged slab is painted by walking boards while the pool packs one scene for the whole export.

Every word of that is true of the **floor** and **preview** painters and of neither path the pool
serves. `stageN()` is read at five places — inside `drawTilesTo`, the composite builder and the
sections panel. `woodBandY` is set only by those same walks and reset by them. `exportTiff` paints
through `renderOneTile → paintContent → paintWoodContent`, which consults neither; the floor is
already refused one line above by `exp.gpu.floor`; and `bandY` rides in the uniform anyway, so the
shader paints whichever board the painter would.

**It cost two 65,535 masters**, which came back carrying both halves of their own contradiction:

```
gpu refused: exp.gpu.woodstage   pool 12x2048
floor none laid - these pixels are the slab, not pieces cut from it
```

The same slab with the clause gone: 1.9 min → 12.9 s, 96 → 834 MB/s of raw pixels in, and tiles over
twice the median from 264 down to 15.

**The rule that came out of it, now gated in `check-gpu-refusal`:** a clause may only be predicated
on something the painter it stands in for actually *reads*. If the CPU painter never consults a
value, the shader cannot disagree with it about that value, and refusing on it turns away work for
nothing. Each material names its own content painter and scene builder, both lifted from the app;
`stageN` appears in neither of wood's, and the ablation puts the clause back and goes red.

Said plainly rather than left to look covered: **the gate would not have caught the `woodBandY`
half**, because `paintWoodContent` does read it. That half was not wrong in the same way — it was
merely unreachable.

---

## 5. What it is reachable from — read this before measuring anything

`gpuPool` has **exactly one caller: `exportTiff`.** The routing:

```js
if (fmt === 'tiff') return exportTiff(W);          // the only path that reaches gpuPool
if (W <= STRIP_FROM) return exportAll(W, …);       // STRIP_FROM = 16384
```

and the format selector only *auto-picks* TIFF above `STRIP_FROM`, and only while nobody has touched
it:

```js
if (ff && !fmtChosen) ff.value = +sel.value > STRIP_FROM ? 'tiff' : 'png';
```

So: **a PNG export never reaches the GPU at any size**, and neither does `Export → just the render`,
which goes through `renderTiledStepped` and has no pool of any kind. This is not new with wood —
glass has always been TIFF-only — but it is the first thing anyone chasing "why is it not on the
GPU" needs, and it is not visible from the toggle.

**The panel names the painter at the moment it chooses**, and only then: `Preparing…  GPU x 4096` if
the shader has it, or the pool width plus the refusing clause in brackets if not. The durable answer
is in the master — `gpu`, `gpuWhy`, `gpuDetail` and the `tried` trail — which `tools/tiff-meta.mjs`
prints without decoding a pixel. Read the record, not the status line.

---

## 6. Agreement with the CPU painter

`tools/gpu-path-check.html` compares `gpuPool(W, p).tile(n)` against `renderOneTile` on the same
tiles through the same plan. It takes a material now, so one page covers both.

**Tile 0, pixels where any channel differs by more than one level:**

| width | tile | pixels past 1 | worst | past 5 |
| --- | --- | --- | --- | --- |
| 4096 | 2056² | 151 of 4,227,136 | 23 | 36 |
| 8192 | 4104² | 551 of 16,842,816 | 22 | 64 |
| 16384 | 2056² | 20 of 4,227,136 | **2** | **0** |

**Four tiles at 4096 on a `stage = 4` document, channels past one level** (three per pixel, so not
comparable with the table above): 1,572 / 1,595 / 1,215 / 1,222 — 0.010–0.013%, worst 25,
deterministic across repeated runs.

For contrast, glass on its saved slab is **1.419% of channels and 108 levels** at the same width —
and bit-identical before and after this change, which is how the pool refactor was shown to be a
no-op for it.

### The shape says rounding, not a defect

Of 151 flagged pixels, 150 have a flagged neighbour and the largest connected blob is **4 pixels**,
in runs along *x*, scattered over the whole tile. No contiguous area, no geometry.

That is the f32 quantiser flipping a ring index where the ring curve runs locally horizontal — so the
difference is the local early/late contrast, which is why the histogram is bimodal: a 2–6 level group
(ordinary rounding) and a tight 18–25 group (one ring either side). It is also why the worst case
collapses to 2 levels at 16384, where tile 0 samples a different part of the sheet: a geometric
defect does not vanish by looking elsewhere.

**Checked by eye at the hardest place.** The CPU and GPU masters of the same slab, opened at the same
coordinates at pixel zoom on a ring boundary, both read `593418` — R 89, G 52, B 24 — with the edge
on the same scanline.

### The two masters will not share a key

A GPU master and a CPU master of the same document carry **different `inputs` hashes**, because the
renderer is part of `renderSig` by design. They will not resume across each other and will not
dedupe. That is intended; see `renderer-determinism.md`.

---

## 7. What CI cannot do

Fifty-six gates run in CI and **not one of them executes WGSL** — there is no GPU on a runner, and
Playwright will not spawn on the authoring machine. Every shader block is unverified text until a
real device is asked to build it. `check-wood-shader` says so in its own header and calls itself the
floor.

`tools/wood-compile-probe.html` is the step above that floor, and deliberately narrow: it asks a
device to compile the assembled module and to create **every pipeline the pool creates**, which is
the whole class of failure that reaches a person as "the GPU refused and would not say why". It
renders nothing and compares nothing.

```
python tools/serve-studio.py        then  localhost:8777/tools/wood-compile-probe.html
```

It found nothing. **Loading the app found the defect it could not**: wood's generated block declares
a `WGSL` of its own, so capturing glass's inside that block read a `const` in its own temporal dead
zone. Every gate green, the shader compiling on hardware, and the studio starting nothing. A module
that builds is not an app that runs.

---

## 8. The gates

Four sections were added to `check-wood-shader`, each with an ablation that goes red:

- **every declared uniform field has a reader**, and every exemption carries a reason. Three are
  carried without one — `LMAX`, `n`, `oEDGE` — because they are real values the field computes that
  only the log view would want. `FIRE` was none of those and is gone.
- **every arena part has an accessor.** The same question one layer down, and how a boolean came to
  be packed as a table.
- **the module assembles in an order WGSL accepts.** `woodSource` borrows `woodAtan2`, `woodHash` and
  `fbm2` from the glass blocks rather than keeping unverified copies, and closes over the call sites
  rather than listing them — `fbm2` calls `vnoise` and `vnoise` calls `nz`, and neither name appears
  anywhere in wood's own text. The first spelling appended each pass as it found it and put `fbm2`
  before the `vnoise` it calls, which is a compile error nothing in this repo can run.
- **every entry point the pool asks for exists.** Four of the five are unreachable by that closure,
  because nothing in a shader *calls* an entry point — the pool names it to `createPipeline`. The
  list is read out of the app's own `entryPoint:` strings.

And in `check-gpu-refusal`, the rule from §4: a refusal must be about the path it stands in for.

Assembling the module measures 1.24 ms, so it is lazy — most loads never export wood at all.

---

## Where this leaves the three materials

### What a port would buy stone: measured at 1.0×

**Stone has nothing to gain, and this is the measurement rather than the argument.** The argument was
available from worker scaling and was not trusted, because reasoning from the current bottleneck has
failed every time it was tried here — wood was called *“might not speed this up much at all”* from
its own stall-bound record and went 8.8×.

So the painter was ablated instead. `tools/make-probe-builds.mjs --only=ablate` builds the app with
per-tile painting replaced by a blit of one cached tile, which keeps the byte volume and removes the
work. One slab, one pane, 65,535 / tile 2048 / pool 12, nothing crossed:

| stone | render | MB/s in | MB/s out | file | median tile |
| --- | --- | --- | --- | --- | --- |
| non-ablated | 15.8 s | 679 | 22.1 | 350.3 MB | 2 ms |
| painter ablated | **15.8 s** | 681 | 22.3 | 351.4 MB | 2 ms |

Identical to the digit, and the mechanism is arithmetic: **350.3 MB ÷ 22.1 MB/s = 15.85 s.** Stone’s
render time *is* its file going out. A shader removes painting, and stone’s painting costs nothing
to remove.

The ablation swaps painting for a blit, so a null result could in principle mean the two cost the
same. Two independent readings say it does not: the median tile is 2 ms in **both** arms, and the
write alone accounts for the whole render without reference to painting at all.

`gpuWhyNot` answers `exp.gpu.nomaterial` for stone, named for the absence rather than for whichever
material happens to be missing a shader.

**Glass and wood are both on the shader**, and land within 1.1× of each other there against 2.1×
apart on the CPU.

**What a third material would cost** is now a known quantity rather than a guess: a packer, a WGSL
block set, five entries in `GPU_MAT`, and a `why()`. The pipeline underneath has taken a second
material without changing a line, which is the only evidence that it was ever a pipeline rather than
a glass renderer with a loop in it.

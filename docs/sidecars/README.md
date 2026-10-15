# Master sidecars — the fleet, and the size ladder

The metadata extract (a **sidecar**) from a master: what it was, what made it, and how long each tile
took. **Twenty masters, twenty sidecars**, in four sets that are evidence for four different things.

**The fleet** — one **65,535 × 40,959** master (≈2.684 gigapixels) rendered on each device in the
[fleet](../devices.md), under each browser engine it ran, in **daylight** (spectrum 0) and **UV / black
light** (spectrum −1). Fourteen masters of the same picture across six devices: evidence that the
engines *agree*.

**The size ladder** — the same picture at 131,072 and 262,144 px wide, on one desktop. Two masters:
evidence that per-tile cost does not grow with the output.

These are the data *from* the masters, not the masters: 13 GB of pixels carry about a third of a megabyte
of checkable evidence, and this is that evidence. A master records its own build, engine, hardware class,
tile plan, per-tile timings and the light it was written with — scanned out of the file's JSON block by
[`tools/tiff-meta.mjs`](../../tools/tiff-meta.mjs) / [`tools/meta-index.mjs`](../../tools/meta-index.mjs)
without decoding a pixel. The masters themselves are not published (400 MB to 4.26 GB each, about 19 GB
in all); render the slab yourself and compare — see [`docs/reproduce.md`](../reproduce.md).

**Device identity is sealed.** Each sidecar's `dev` field is encrypted (or withheld) under a key derived
from the slab's own bytes — see [`docs/device-seal.md`](../device-seal.md). What stays in the clear is
hardware **class** (engine, cores, memory, device-pixel-ratio, reported texture limit), which is what an
audit needs and identifies nobody. Every figure in the tables below is read out of the JSON beside it —
except the **device** column, which is a label from [`docs/devices.md`](../devices.md), because a sidecar
names hardware class and deliberately not a machine.

**EVERY SIDECAR BELOW PREDATES THE MATERIAL KEY, so none of them can say what it is made of.** A slab
carries stone, wood and glass at once unless one is exported alone, so `family` is the STONE family and
is present whatever was drawn: a wood master reports `family: "carrara"`, and its `marks` / `lines` /
`cracks` / `specks` / `drusy` / `seams` counts are the stone vocabulary, describing nothing a viewer of
that master would see. **Two of the four sets below are wood and read as marble.** Found 2026-10-15 by
downsampling a master whose block said `carrara` and which is unmistakably wood — after the author of
this file had already drawn the wrong conclusion from the block without looking at the picture.

**Fixed in build `2026.10.15.83`.** The export records `material` beside `family`
(`app/stone-author.html:9225`), read through `currentMaterial()` exactly as saving a slab reads it — so
the export records the answer and never branches on it, which is the only thing the material seam
forbids. [`tools/tiff-meta.mjs`](../../tools/tiff-meta.mjs) gates the field on the build: a master older
than `.83` prints *not recorded (build … predates the key)* rather than being read as stone, because
absence means cannot-say and never marble. It cannot be retrofitted, so the twenty sidecars here stay as
they are. **Read the pixels, not the family.**

## The fleet — one picture, six devices, three engines, two lights

| device | engine | light | tile | tiles | min | med tile ms | light mean | lit>40 | glow rule | inputs | sidecar |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Desktop — Ryzen 5 5500 / RX 6500 XT | win-chrome | daylight (0) | 512 | 10240 | 5.6 | 29 | 45.03 | 34.9% | — | 2259e26a | `stone-65535-day-win-chrome-0928-164529.json` |
| Desktop — Ryzen 5 5500 / RX 6500 XT | win-chrome | UV (−1) | 512 | 10240 | 6.2 | 33 | 61.49 | 47.0% | blink | a98ab1f5 | `stone-65535-uv-win-chrome-0928-170227.json` |
| Desktop — Ryzen 5 5500 / RX 6500 XT | win-firefox | daylight (0) | 512 | 10240 | 9.4 | 33 | 46.25 | 36.2% | — | 2259e26a | `stone-65535-day-win-firefox-0928-174148.json` |
| Desktop — Ryzen 5 5500 / RX 6500 XT | win-firefox | UV (−1) | 512 | 10240 | 13.7 | 62 | 61.33 | 44.9% | gecko | a98ab1f5 | `stone-65535-uv-win-firefox-0928-180008.json` |
| iPhone 14 Pro — A16 Bionic | ios-safari | daylight (0) | 512 | 10240 | 5 | 23 | 71.17 | 58.4% | — | 2259e26a | `stone-65535-day-ios-safari-0929-020154.json` |
| iPhone 14 Pro — A16 Bionic | ios-safari | UV (−1) | 512 | 10240 | 4.4 | 23 | 61.28 | 40.2% | webkit | a98ab1f5 | `stone-65535-uv-ios-safari-0929-165009.json` |
| Galaxy S23 Ultra — Snapdragon 8 Gen 2 | android-chrome | daylight (0) | 512 | 10240 | 6.7 | 33 | 45.40 | 35.0% | — | 2259e26a | `stone-65535-day-android-chrome-0928-171330.json` |
| Galaxy S23 Ultra — Snapdragon 8 Gen 2 | android-chrome | UV (−1) | 512 | 10240 | 10.4 | 52 | 61.58 | 47.1% | blink | a98ab1f5 | `stone-65535-uv-android-chrome-0928-172715.json` |
| Galaxy S23 Ultra — Snapdragon 8 Gen 2 | android-firefox | daylight (0) | 512 | 10240 | 18.3 | 64 | 46.55 | 36.2% | — | 2259e26a | `stone-65535-day-android-firefox-0928-183552.json` |
| Galaxy S23 Ultra — Snapdragon 8 Gen 2 | android-firefox | UV (−1) | 1024 | 2560 | 12.9 | 225 | 56.96 | 38.0% | gecko | a98ab1f5 | `stone-65535-uv-android-firefox-0929-020431.json` |
| Galaxy Tab A7 Lite — Helio P22T | android-chrome | daylight (0) | 512 | 10240 | 58.6 | 292 | 44.74 | 34.8% | — | 2259e26a | `stone-65535-day-android-chrome-0928-180657.json` |
| Galaxy Tab A7 Lite — Helio P22T | android-chrome | UV (−1) | 512 | 10240 | 61.5 | 322 | 61.33 | 46.9% | blink | a98ab1f5 | `stone-65535-uv-android-chrome-0928-191259.json` |
| Galaxy Tab A 8.0 (2019) — Snapdragon 429 | android-chrome | daylight (0) | 512 | 10240 | 58.7 | 287 | 45.40 | 35.1% | — | 2259e26a | `stone-65535-day-android-chrome-0928-180720.json` |
| Galaxy Tab A 8.0 (2019) — Snapdragon 429 | android-chrome | UV (−1) | 512 | 10240 | 64.1 | 330 | 61.57 | 47.1% | blink | a98ab1f5 | `stone-65535-uv-android-chrome-0928-191520.json` |

Notes:
- **light mean / lit>40** are the rendered light, sampled over every hundredth pixel. Under UV the four
  Blink devices agree to ~0.4% after the per-engine glow correction (`glowRule`); in daylight there is no
  glow, so the engines are not meant to agree. See [`docs/renderer-determinism.md`](../renderer-determinism.md).
- **inputs** is a signature over the picture *and* the light; a shared value means the same picture was
  rendered. Daylight masters share one signature, UV masters another.
- Build `2026.09.28.5/.6` throughout (one S23/Gecko UV run is the closest available). These predate the
  2026-09-30 per-engine halo re-calibration, so treat the figures as that week's, per [`docs/devices.md`](../devices.md).
- Three Android-Chrome devices (S23 Ultra, Tab A7 Lite, Tab A 8.0) share an `engine` string and are told
  apart by hardware class: cores 8 / maxTexture 8192 / dpr 2 (S23), cores 8 / 8192 / dpr 1.331 (A7 Lite),
  cores 4 / maxTexture 4096 (Tab A 8.0).

## The size ladder — one picture, one desktop, 4× the width

| master | gigapixels | tile | tiles | min | med tile ms | fastest | slowest | pool | build | sidecar |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 131,072 × 81,920 | 10.74 | 4096 | 640 | 24.3 | 1661 | 298 | 31131 | — | 2026.10.11.39 | `glass-131072-day-win-chrome-1011-203108.json` |
| 262,144 × 163,840 | 42.95 | 4096 | 2560 | 95.2 | 1115 | 301 | 30752 | 8 workers | 2026.10.11.42 | `glass-262144-day-win-chrome-1012-003012.json` |

Both are the slab `glass` on the desktop (win-chrome, 12 cores, 16 GB, dpr 1.2), daylight, bleed 4, and
both carry `inputs` **`8c6d6582`** — the same signature over picture and light, so these are one picture
at two sizes and not two pictures. Light mean 143.80 and lit>40 100.00% in both, which is the same thing
said in pixels.

- **The output grew 4× in each direction and the time grew 3.9×.** 640 tiles to 2,560, 24.3 min to 95.2.
  Four times the tiles for four times the wall clock is the claim that per-tile cost is flat; coming in
  slightly *under* it is the worker pool, which landed between build `.39` and `.42`. The median tile fell
  from **1,661 ms to 1,115 ms** while the picture got sixteen times larger in area.
- **The spread did not move**: fastest 298 ms against 301, slowest 31,131 ms against 30,752. The slow tail
  is the same tail — tiles whose content is dense, not tiles that ran out of room.
- Both forced tile 4096 against a 12,885 MB budget. The `.39` run records `4096/4104=67MB:forced, no blur`;
  the `.42` run `4096:remembered, calibrated 173.7 vs 173.7 in 18605ms` — the calibration agreeing with
  itself to a tenth after the plan was reused.
- At the slab's real 8 × 5 ft, the 262,144 master is **2,731 DPI**. It stops there by decision rather than
  by limit: opening one costs about 443 GB of working space.

## Cross-engine bit-identity — one picture, two engines, two architectures

| device | engine | cores | workers | dpr | toDisk | min | med tile ms | file bytes | sidecar |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| iPhone 14 Pro — A16 Bionic | ios-safari | 4 reported, 6 real | 4 | 3 | true | 35.05 | 12 | 1,012,119,232 | `iPhone wood test-262144-day-ios-safari-1014-225800.json` |
| Desktop — AMD Ryzen 5 5500 | win-chrome | 12 | 8 | 1.5 | false | 35.49 | 13 | 895,438,456 | `iPhone wood test-262144-day-win-chrome-1014-235042.json` |
| iPhone 14 Pro — A16 Bionic | ios-safari | 4 reported, 6 real | **2**, shed from 4 | 3 | true | 32.26 | 10 | 1,012,081,296 | `iPhone wood test-262144-day-ios-safari-1015-002415.json` |

One slab at 262,144 × 163,840 — 42.95 gigapixels — in daylight, build `2026.10.14.82`, bleed 4, tile
forced to 512 on all three, 163,840 tiles each. All three carry `inputs` **`8cef8303`** and report light
mean 52.84 at lit>40 98.77%.

**Every one of the 163,840 tile pairs is byte-identical after inflation** — 160 GiB of RGBA on each
side, zero differing bytes. Not a sample; the whole picture. A Blink renderer on x86-64 Windows and a
WebKit renderer on ARM produced the same 43 gigapixels to the bit. The two WebKit runs agree on their
stored bytes as well, all 1,008,199,704 of them, so the deflate is deterministic within an engine too.

- **The files differ by about 13% and none of it is pixels.** 895 MB against 1,012 MB for identical
  image data. Masters are written with `CompressionStream('deflate')`, which exposes no level, so each
  engine compresses at whatever its platform zlib defaults to. Re-deflating this master's own tiles at
  each level reproduces the stored size exactly at **level 6**, and lands within 0.8% of the WebKit file
  at **level 5**. File size is a property of the compressor, not of the picture — which
  [`renderer-determinism.md`](../renderer-determinism.md) concludes by a different route, from engines
  that genuinely drew different pixels.

- **`tools/check-same-image.mjs` called this pair DIFFERENT**, reporting *"a different length, so
  different pixels"*. That was false here, and false by construction: it compared the stored region
  `[0, metaStart)`, which cannot see through a compression-level difference. Sound for two masters from
  one engine; unsound for the cross-engine comparison its own header says it was written to support.
  **Fixed the same day.** The comparison now runs in two stages — stored bytes first, and on a mismatch
  the tiles are inflated and the pixels compared, so only a pixel difference counts as one. The self-test
  went from six cases to nine, the new three being this exact shape: same pixels at two deflate levels
  must read identical; one moved pixel at two deflate levels must still read different; and an assertion
  that the two levels really do pack to different sizes, without which the first of those would settle on
  the fast path and prove nothing. On this pair the tool now reads *"163840 tiles, 160.00 GiB of pixels,
  byte for byte after inflation — stored image region differs by 116,695,288 bytes (11.6%), that is the
  compressor, not the picture"*. The 11.6% here and the 13% above are one gap measured from either end.

- **This does not contradict [`renderer-determinism.md`](../renderer-determinism.md)**, which tables
  WebKit against Blink as *not* bit-identical. That was measured on `Hero_Psyker` at **666 marks**, a
  STONE slab. This one is **wood** — grain, a cathedral figure band and a board joint are plainly in it.
  Its marks, veins and cracks all read zero because those are stone elements and this is not stone. The
  picture is not empty, and an earlier draft of this section said it was, on the strength of a block that
  never names the material. The two results localise the divergence rather than disagreeing: wood grain
  is computed per pixel in JavaScript and written with `putImageData` (`app/stone-author.html:6765`,
  `:6841`), which touches no rasteriser, while stone marks, veins and blooms are drawn with
  `createRadialGradient` and path operations (`:4317`, `:4515`, `:4995`) through Skia or CoreGraphics.
  **What is painted per pixel is exact across engines; what is rasterised is what differs.** A picture
  with real structure in it agreeing to the bit is a stronger result than an empty one would have been.
  Nothing here says a *stone* slab would agree, and stone was already measured not to.

- **The dead heat is not evidence of a shared ceiling.** 35.05 min against 35.49, 1.2% apart, reached
  from opposite directions: WebKit opened at 89.9 tiles/s and shed 13.9% across the run, Blink held flat
  at +0.4% from first decile to last. The phone was throttling and still finished first, on four workers
  against eight — and `hardwareConcurrency` under-reports the A16 as 4 where it has 6, so that was four
  workers on six cores. Whether two unlike machines converging on ~77 tiles/s is chance or a shared
  serial constraint cannot be answered from two files.

- **The second WebKit run shed its own pool, and that is why it is the fastest of the three.** It planned
  four workers and recorded `poolShed ["3@6x","2@4x"]` — down to three when the median tile reached six
  times the solo baseline, then to the floor of two at four times. `SHED_AT = 3` names that signature as
  swapping rather than contention, and the numbers agree with it: the phone was **memory**-bound at four
  workers, never CPU-bound. Narrowed to two it ran **32.26 min at 84.7 tiles/s**, three minutes faster
  than the same device at four, while throttling *harder* (−19.7% against −13.9%) and logging 8,895 slow
  tiles against 829. Those tiles cost 131.7 s and it still won by 168. Run #1, which never shed, is the
  control for what the mechanism is worth — and the pool width that the shed corrected is the one
  `Math.min(hardwareConcurrency, 8)` hands any device reporting eight cores or fewer, which gets no
  headroom for the sink at all. The desktop's cap of 8 out of 12 leaves it four, and it never shed.

- **Slow tiles are not stalls at this magnitude.** WebKit logged 829 tiles over twice the median against
  Blink's 46 — most likely `toDisk: true`, the phone streaming to storage mid-render. They cost 16.1 s
  and 1.0 s, which is 0.77% and 0.05% of their runs. `tiff-meta` names that shape a STALL without
  weighing what it cost.

## The ceiling — what the smallest device in the fleet can finish

| device | engine | cores | mem | maxTexture | workers | tile | tiles | min | med tile ms | sidecar |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Galaxy Tab A 8.0 (2019) — Snapdragon 429 | android-chrome | 4 | 2 GB | 4096 | **2**, shed from 4 | 1024 | 40960 | **365.0** | 359 | `stone-262144-day-android-chrome-1015-043639.json` |

262,144 × 163,840 — the same 42.95 gigapixels as the pair above — `inputs` **`a5bb7b48`**, build
`2026.10.14.82`, daylight, tile forced to 1024, `toDisk` true. **Also wood**, and a different picture
from the pair above. The block calls the slab `stone` and the family `carrara` and records 5 marks, 16
lines and 132 cracks; none of that describes what a viewer sees, for the reason given at the top of this
file — the material is never recorded, so the stone vocabulary is all a reader gets.

**It finished.** Six hours and five minutes on a 2019 budget tablet with four cores, 2 GB of reported
memory and a 4,096 texture limit, against a 1,611 MB budget — 1.96 Mpx/s, about a tenth of what the
desktop manages. That is the whole result. Nothing here is a comparison; the picture is not the one the
cross-engine pair rendered and the tile size is not theirs either.

- **It shed its pool too**, `poolShed ["3@3x","2@3x"]` — four to three to the floor of two, both steps at
  exactly the `SHED_AT = 3` threshold, where the iPhone's fired at 6× and 4×. Two devices, two different
  pressures, same mechanism, same floor.

- **The −33% from first decile to last is the shed, not decay.** Decile 1 ran at 2.70 tiles/s before the
  pool narrowed; deciles 2 through 10 read 1.88, 1.80, 1.79, 1.79, 1.80, 1.80, 1.81, 1.81, 1.81. Flat to
  ±1% for five and a half hours on a device with 2 GB. Read the deciles before reading the trend.

- **`tiff-meta` calls 43.9% of its tiles a STALL, and they are not.** 17,976 tiles over twice the median,
  nominally 43.8% of the run. The series alternates strictly by parity instead: even-index intervals mean
  242 ms, odd-index 827, a 1,069 ms cycle delivering two tiles. Slow runs number 17,961 with a median
  length of 1 and a longest of 3 — isolated singles, which is what a two-beat rhythm looks like and not
  what a stall looks like. It is not content: mean stored bytes are 19,998 for the slow population and
  19,928 for the fast. It is not merely the worker count: the second iPhone master ran the same two
  workers with an even/odd ratio of **1.00** against this one's **3.41**.

  **The mechanism is open.** A fixed serial cost against a variable paint would leave the short beat
  tight and the long beat broad; measured, it is the other way round — CV 0.376 short against 0.223 long.
  So the rhythm is established and its cause is not. What follows regardless is that a per-tile outlier
  count means nothing without checking whether the series alternates, and `tiff-meta` does not check.

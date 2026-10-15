# Master sidecars — the fleet, and the size ladder

The metadata extract (a **sidecar**) from a master: what it was, what made it, and how long each tile
took. **Sixteen masters, sixteen sidecars**, in two sets that are evidence for two different things.

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

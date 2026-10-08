# Master sidecars — one 65,535 px render per device, browser, and light

The metadata extract (a **sidecar**) from one **65,535 × 40,959** master (≈2.684 gigapixels) rendered on
each device in the [fleet](../devices.md), under each browser engine it ran, in **daylight** (spectrum 0)
and **UV / black light** (spectrum −1). Fourteen masters, fourteen sidecars.

These are the data *from* the masters, not the masters: 13 GB of pixels carry about a third of a megabyte
of checkable evidence, and this is that evidence. A master records its own build, engine, hardware class,
tile plan, per-tile timings and the light it was written with — scanned out of the file's JSON block by
[`tools/tiff-meta.mjs`](../../tools/tiff-meta.mjs) / [`tools/meta-index.mjs`](../../tools/meta-index.mjs)
without decoding a pixel. The masters themselves are not published (400–800 MB each); render the slab
yourself and compare — see [`docs/reproduce.md`](../reproduce.md).

**Device identity is sealed.** Each sidecar's `dev` field is encrypted (or withheld) under a key derived
from the slab's own bytes — see [`docs/device-seal.md`](../device-seal.md). What stays in the clear is
hardware **class** (engine, cores, memory, device-pixel-ratio, reported texture limit), which is what an
audit needs and identifies nobody. The table below is generated from the sidecars in this folder, re-read
from disk — it states nothing the JSON beside it does not.

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

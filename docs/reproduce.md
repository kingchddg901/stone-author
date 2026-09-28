# Check it yourself

Every figure this project publishes about the renderer can be reproduced from three things that are all
in this repository or served from it: the app, one slab, and a reader that prints what a master says about
itself. The masters themselves are **not** published — they run to 400–800 MB each, and a download you
could only checksum would prove the file had not been edited, not that the renderer does what it claims.
Rendering it yourself is a stronger test, so that is the one on offer.

## The four steps

1. **Open the app.**
   <https://kingchddg901.github.io/stone-author/app/stone-author.html>
   It is a single HTML file. Nothing is installed and nothing is sent anywhere; the render happens in
   your browser and the file is written by your browser.

2. **Load the slab.** In the **FILE** panel, press **Load** and choose
   [`gallery/slabs/HERO-MASTER-sealkey.json`](../gallery/slabs/HERO-MASTER-sealkey.json).

3. **Set `Light spectrum` to −1.** This is the step that is easy to miss, and missing it is the most
   likely reason a good-faith attempt appears to fail. **The light is not stored in the slab.** A slab
   describes the stone; the light is a separate setting, and the app opens at daylight (`0`). Render at
   daylight and you will measure **45.03**, not the black-light figure, and conclude the claim is wrong
   when what actually happened is that you measured a different picture.

4. **Export, then read it.** Set the width to `65535`, choose **TIFF**, and export. Then:

   ```
   node tools/tiff-meta.mjs <your-file.tif>
   ```

   Node 18 or newer. The reader decodes no pixels — it scans for the JSON block every master carries — so
   it answers in milliseconds regardless of file size.

## What should come back

The signature first, because it is the one that says you rendered the same picture:

```
inputs   a98ab1f5          black light  (spectrum -1)
inputs   2259e26a          daylight     (spectrum 0)
```

`inputs` is a signature over the picture **and** the light. If yours differs, something upstream is
different and the light figures below are not comparable — check step 3 before anything else.

Then the light, measured as the master was written, sampled over every hundredth pixel:

| engine | rule applied | lift | light mean |
| --- | --- | --- | --- |
| Blink (Chrome, Edge) | `blink` | 0.612 | 61.50 |
| Gecko (Firefox) | `gecko` | 0.78 | 61.34 |
| WebKit (Safari) | `webkit` | −0.304 | 61.32 |

**The claim is that those three agree to within 0.3%**, against an image-space reference of 61.33 measured
independently. Three engines, three different glow implementations, one picture. If your figure lands
outside roughly 61.2–61.6 on a current build, that is a real disagreement and worth reporting — the
interesting outcome is the one that does not match.

In daylight the engines do **not** agree and are not meant to: Blink 45.03, Gecko 46.25, WebKit 71.40.
There is no glow under daylight, so there is nothing for the per-engine correction to correct. See
[`renderer-determinism.md`](renderer-determinism.md).

## Reading a whole folder at once

```
node tools/meta-index.mjs <folder> --out <folder-for-the-evidence>
```

This writes one JSON sidecar per master, an `index.json`, and an `index.md` holding two tables — the
masters, and the hardware they have been proven to run on. **The JSON is the source of truth and the
tables are generated from it**, re-read from disk rather than from memory, so a published table cannot
state anything the published data does not.

## What a master will not tell you

The device **identity** — the user-agent string and, on Chromium, the model — is encrypted, under a key
derived from the slab's own bytes. Hardware **class** stays in the clear, because an audit needs it and it
identifies nobody: engine, core count, memory, device pixel ratio, reported texture limit. To open the
identity on a master you made yourself, hand the reader the slab:

```
node tools/tiff-meta.mjs --slab gallery/slabs/HERO-MASTER-sealkey.json <your-file.tif>
```

Details in [`device-seal.md`](device-seal.md).

## Two things worth knowing before you draw conclusions

**Core counts are threads, not cores.** `navigator.hardwareConcurrency` reports logical processors, so a
6-core desktop appears as 12. iOS reports 4 where the A16 has 6.

**Reported memory is not real memory.** `navigator.deviceMemory` rounds down to a power of two and is
clamped on Android — a 12 GB phone reports 8, and a browser that does not implement it at all (Firefox,
Safari) records nothing. The tile planner budgets against this figure, so it plans conservatively on
exactly the devices with the most headroom.

Neither is a defect in the renderer, and both are why the planner **measures a real tile** before
committing to a plan rather than trusting any of these numbers.

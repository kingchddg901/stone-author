# Running it yourself, and why you would

The published site stops at **262,144 px**. The rung above it — `WHY`, unlocking **524,288** and
**1,048,576** — is offered only when the app is served from a local machine. Not greyed out, not
behind a warning: absent.

That is a line rather than a gate. A 1,048,576 render is 687 billion pixels, several hours and tens of
gigabytes, and it is not something to put one tickbox away from somebody who wandered onto a web page
on a phone. It is a perfectly reasonable thing to do on your own disk, where the only thing at risk is
your own evening.

So: serve it yourself and the rung appears. Nothing is unlocked, patched or worked around — the same
file behaves differently because the check is on where it was served from.

## What counts as local

The app accepts exactly these as the page's hostname:

```
localhost        127.0.0.1        [::1]        ::1        anything ending .localhost
```

A LAN address like `192.168.1.5` does **not** count, deliberately: the point is a machine you are
sitting at, not a server you can reach.

## The quickest route

```bash
git clone https://github.com/kingchddg901/stone-author
cd stone-author
python tools/serve-studio.py
```

Then open **`http://127.0.0.1:8777/app/stone-author.html`**. The script takes a port if you want one:
`python tools/serve-studio.py 8778`.

Any static server works — there is no build step and no backend. Two things it needs:

- **`app/stone-author.html`**, which is the entire studio: one file, no bundler, no dependencies.
- **the `i18n/` folder at the site root**, for the translation packs. English is inlined in the app, so
  without it everything still works, in English only.

Serve the repository root rather than `app/`, or the packs will not be found.

## Turning the rung on

The ladder is cumulative and each rung is armed for the session, never persisted past a reload:

```
Large render   →   Extreme   →   Unreasonable   →   WHY
  32,768           65,535        131,072            524,288
                                 262,144            1,048,576
```

Tick down the ladder in the Render section. `WHY` appears only after `Unreasonable` is armed, and only
on a local origin. The format must be **TIFF** — no canvas on any engine is that wide, so only the
tiled path can produce one.

## What it actually costs

Measured on a 16 GB desktop, **6 cores / 12 threads** at 3.6 GHz. (A master records `cores` from
`navigator.hardwareConcurrency`, which reports threads — see [`devices.md`](devices.md).)

**These are one slab's times, not a width's.** Every row below is the same stone picture, which is the
only way the doubling behaves like a law. Cost is a property of what is being drawn far more than of
how wide it is: across the masters on hand, twelve different pictures at 65,535 range from **1.6 to
33.5 minutes — 21×** — and glass is the expensive end because it computes per pixel where stone draws
strokes. File size runs the *other* way, so the quick one is the big file and neither predicts the
other. Read a row as "this is possible", never as "this is what that width costs".

| width | pixels | tiles | time | file |
|---|---|---|---|---|
| 262,144 | 42.9 Gpx | 10,240 at 2048 | 22 min | 3.61 GB |
| 524,288 | 171.8 Gpx | 10,240 at 4096 | 71 min | 9.92 GB |
| 1,048,576 | 687.2 Gpx | 10,240 at 8192 | 5 h 02 min | 22.93 GB |

**1,048,576 has been completed, in one sitting.** The whole ladder is measured; nothing in this table
is projected. The top rung was first finished across an interruption and has since been rendered
straight through — 301.5 min at 1.767 s a tile, with the master's own clock and the per-tile record
agreeing to the second because there was only one sitting for them to disagree about.

None of it is kept by hand. Every master carries its own width, tiling, build, per-tile timings and
light, and its byte count is on disk, so this table is re-derived from the files rather than
maintained:

```
node tools/master-stats.mjs <dir-of-masters> --sort=w
```

If a row here ever disagrees with that command, the command is right.

One of those rows — the 262,144 — was rendered across more than one sitting, so its time is the **sum
of the per-tile record** rather than the `ms.render` the master carries. That field covers only the
sitting that finished a master, and reads 10.1 min against the 22 it took. Anyone checking a row
against a file will meet that discrepancy and should know which figure is which; `master-stats.mjs`
flags a resumed row and prints both.

The estimate this table replaced is worth keeping as a note on method: it put the 1,048,576 "near five
hours" from a running average of 1.73 s a tile, and the render averaged 1.767. It also put the file at
"roughly 40 GB", called that an upper bound rather than an estimate because bytes per pixel had fallen
at every doubling, and was right twice over — the rate fell again and the file came in at 22.93 GB.

**Watching the percentage, though: an early projection reads LOW.** Per-tile cost is not flat across a
render. Measured on three separate 10,240-tile renders, the first tenth runs 9.7–14.5% under the mean,
the middle 30–60% runs 7–13% over, and the tail eases off again. The slab's busy region sits through
the middle rows, so cost tracks content rather than progress — which is the same reason a width does
not predict a time.

Scaling the per-tile record up from the 9.5% mark would have under-read all three finishes, by 8.9%,
11.6% and 13.3%. By halfway that is down to 3.6%, 0.7% and 3.0%, and the sign is no longer reliably
negative. So treat an early number as a floor and wait for halfway if you want a figure.

**Two clocks, and they do not agree.** The above is the per-tile record. The progress line in the app
is wall clock, which carries the fixed startup the tiles do not — workers, the warp field, the cloud,
band and breccia bitmaps — and that inflates the early rate in the opposite direction. On the clean
1,048,576 the two cancelled to within 4.1% at the 9.5% mark, which is better than either basis manages
alone and is luck rather than method. Do not correct one basis with a factor measured on the other;
that was tried on this very render and made the answer worse than leaving it alone.

Bytes per pixel **falls** as the width grows — 0.0842 at 262,144, 0.0577 at 524,288, 0.0334 at
1,048,576 — because each tile covers less of the picture and compresses better.

**Free disk is double the file at the moment of saving.** The master is written to origin-private
storage first and then handed to the browser to save, so both exist at once. That is ~46 GB for a
1,048,576.

## Things worth knowing before a long one

- **Keep the window visible.** Not focused — visible. A hidden tab throttles timers, and although the
  render loop no longer depends on one, nothing else about a backgrounded tab is a promise.
- **A killed render resumes.** Reload and the Render section offers it back, with the size, the light
  and how much is on disk. Verified across a kill, a reload and a two-sitting finish.
- **Storage is per origin.** `127.0.0.1:8777` and `127.0.0.1:8778` are different origins with separate
  scratch space, so serving on two ports gives you two genuinely independent renders at once. The same
  separation means a render started on one port cannot be resumed on the other.
- **The browser will hold it.** This used to read "nothing above 262,144 is known to work", and the
  open question was whether a browser would keep tens of gigabytes of origin-private storage and then
  hand a file that size back to save. It does: a 22.92 GB master was written and saved. The tile
  addressing reaches to 8,388,608 px, so that is still not the limit either. What has *not* been tried
  is the rung above, and quota and free disk both refuse *after* the render rather than before it.

## Looking at the result

Past a few gigapixels most viewers struggle with a master — GIMP *budgets* 443 GB of working space for
a 262,144. [`vipsdisp`](https://github.com/libvips/vipsdisp) streams tiles and will open one, and
`tools/add-overviews.mjs` adds pyramid levels to an existing master so that zooming *out* works too.
See [`image-pyramid.md`](image-pyramid.md).

The repository's own readers never decode the picture at all: `tools/tiff-meta.mjs` reads what a master
says about itself, and `tools/check-placement.mjs` proves every tile sits where it claims. Both work at
any size, on a file nothing can display.

## Why you probably shouldn't

Two things people expect to stop them, which do not.

**Not memory.** The renderer never holds the finished picture. It works in bounded tiles, compresses
each one and writes it straight to disk, so a 687-gigapixel render has the same working set as a small
one. **Not a GPU either.** Five machines have each produced a 65,535 × 40,959 master in both lights,
from a 2019 budget tablet with 2 GB upward. Ordinary hardware is the design target.

The problems are elsewhere.

**Storage.** A 1,048,576 master measured 22.92 GB. The working copy lives in browser-managed storage
and saving it makes a second one, so the figure that matters is roughly double — ~46 GB. Browser quota
and free disk are both real limits, and both refuse *after* the render rather than before it.

**Time.** Hours, not minutes. Resume makes an interruption recoverable; it does not make 687 billion
pixels less work. The same picture is 2.75 TB of uncompressed pixels before a byte of deflate.

**Viewing.** The two tiers differ, and the difference is the dimensions rather than the memory.

**At 262,144 an editor opens it.** Measured 2026-10-25: an 11.08 GB master, four-by-four supersampled,
took about **60 GB** of scratch in GIMP and gave it back on close. The **443 GB** figure quoted here
for years is what GIMP *budgets* - a reservation it declares, not disk it commits - and it is roughly
seven times the real cost. So the honest shape at that size is a long wait and tens of gigabytes of
temporary disk while it is open, not impossibility. It is still not a recommendation.

**At 1,048,576 nothing here has opened one**, and the wall is the side length rather than the working
set. Editors carry a maximum dimension and 262,144 sits at or very near GIMP's, which is why that size
opens and the tier above is a refusal at load rather than a long wait. Check your own build's limit
before planning on it.

What works at any size is the tiled reader described above, because a master is tiled BigTIFF and such
a reader only ever touches the tiles the viewport needs.

**What more pixels actually buy.** Not nothing — and this is the one most people get backwards. The
field is procedural and has no resolution of its own, so a larger render keeps *finding* structure
rather than magnifying what it already had; how much it finds depends on the slab. The limit is not
that detail runs out. It is that nothing can take delivery of it: 65,535 is already 683 DPI across
eight feet, past what any print or screen can receive.

**The original brief.** This started as one sentence — *"I want a better background for my Home
Assistant card."* If you are weighing up two and three-quarter terabytes of uncompressed pixels in
pursuit of that, you have travelled some distance from the requirement.

None of these is a reason to stop. They are good reasons to know why you are doing it, which is the
whole of what the rung is asking.

The renderer will attempt the job. Whether you should have started it is a separate question.

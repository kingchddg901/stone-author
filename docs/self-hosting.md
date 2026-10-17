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

Measured, not estimated, on a 16 GB twelve-core desktop:

| width | pixels | tiles | time | file |
|---|---|---|---|---|
| 262,144 | 42.9 Gpx | 10,240 at 2048 | 22 min | 3.61 GB |
| 524,288 | 171.8 Gpx | 10,240 at 4096 | 71 min | 9.92 GB |
| 1,048,576 | 687.2 Gpx | 10,240 at 8192 | ~4.9 h | ~40 GB |

Bytes per pixel **falls** as the width grows — 0.084 at 262,144, 0.0577 at 524,288 — because each tile
covers less of the picture and compresses better.

**Free disk is double the file at the moment of saving.** The master is written to origin-private
storage first and then handed to the browser to save, so both exist at once. Budget ~80 GB for a
1,048,576.

## Things worth knowing before a long one

- **Keep the window visible.** Not focused — visible. A hidden tab throttles timers, and although the
  render loop no longer depends on one, nothing else about a backgrounded tab is a promise.
- **A killed render resumes.** Reload and the Render section offers it back, with the size, the light
  and how much is on disk. Verified across a kill, a reload and a two-sitting finish.
- **Storage is per origin.** `127.0.0.1:8777` and `127.0.0.1:8778` are different origins with separate
  scratch space, so serving on two ports gives you two genuinely independent renders at once. The same
  separation means a render started on one port cannot be resumed on the other.
- **Nothing above 262,144 is known to work.** The tile addressing reaches to 8,388,608 px, so that is
  not the limit; what has never been proven is whether a browser will hold tens of gigabytes of
  origin-private storage, or hand back a file that size to save. Either can refuse, and it would refuse
  *after* the render.

## Looking at the result

Past a few gigapixels no ordinary viewer will open a master — GIMP budgeted 443 GB of working space for
a 262,144. [`vipsdisp`](https://github.com/libvips/vipsdisp) streams tiles and will open one, and
`tools/add-overviews.mjs` adds pyramid levels to an existing master so that zooming *out* works too.
See [`image-pyramid.md`](image-pyramid.md).

The repository's own readers never decode the picture at all: `tools/tiff-meta.mjs` reads what a master
says about itself, and `tools/check-placement.mjs` proves every tile sits where it claims. Both work at
any size, on a file nothing can display.

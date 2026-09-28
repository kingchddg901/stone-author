# Using Stone Author

A single web page that lets you draw a slab of stone and render it at up to 65,535 px. Nothing installs,
nothing uploads, and the file is written by your own browser.

This is the guide for using it. If you want to check the figures the project publishes, see
[`reproduce.md`](reproduce.md); if you want to know what hardware it runs on, [`devices.md`](devices.md).

---

## The five-minute version

1. Open the page. Pick a **family** at the top — Carrara, Calacatta, Nero Marquina or Granite. That sets
   the ground and the character of what you draw next.
2. Take the **Vein** tool and draw. Each stroke becomes a vein with the settings that were showing when
   you drew it.
3. Open **Coat & light** and move `Light angle` and `Subsurface`. The stone starts behaving like stone.
4. Open **File**, type a name, press **Save**. That writes a `.json` slab — the recipe, not the picture.
5. Open **Render**, choose a width, press **Export**.

Everything else on this page is detail about those five steps.

---

## Three things worth understanding before anything else

### Settings apply to your next line, never the last one

> *Settings apply to your next line. Lines already down keep the settings they were drawn with.*

This is the single rule that explains the most confusion. Sliders are not a live preview of the selected
object — they are the settings the **next** stroke will be born with. To change something already drawn,
select it with **Tune** and edit it, or delete it and draw again.

Pen pressure and tilt are part of that birth state too: with pressure on, how hard you press sets a
vein's width along its length and a pour's flow; with tilt on, leaning the pen further than you normally
hold it softens the vein's edge.

### Layers are buckets, not a canvas stack

The **Layers** panel does not list your strokes. It lists *kinds* — Major veins, Minor veins, Fracture
web, Micro / specks, Stylolite seam, Drusy sparkle, Banding, Breccia clasts, Clouds / mottling, Fog /
resin core, Base / ground. Every mark you make lands in the bucket that matches what it is.

That is why **Colour** and **Effects** are per-layer: you tint *all* the major veins at once, because the
system thinks in materials rather than in drawing order. You can add your own layers with the buttons at
the bottom of the panel when you want two sets of major veins that behave differently.

### The light is not part of the slab

A slab records the stone. The **light** — the spectrum, the spotlight, the back light — is a separate
setting, and **it resets when you reload or load a file.** The page always opens at daylight.

This catches everyone, including the people who wrote it. If you set up a black-light look, save, reload
and render, you will get a daylight render and wonder what happened. Set the light *after* loading, every
time.

---

## The tools

**Drawing the stone**

| tool | what it does |
| --- | --- |
| **Vein** | the primary stroke. Draw a vein. |
| **Branch** | grow a branch off what is already there |
| **Web** | fracture web — the fine cracked network |
| **Stylolite** | the jagged pressure seams that run through marble |
| **Pour** | pours material; with pressure on, how hard you press sets the flow |
| **Cloud** | soft mottling and cloud |
| **Moon** | *drag it across the slab — it drags what it passes into its wake, hard in the middle, fading at the edge* |

**Moving what is already there**

| tool | what it does |
| --- | --- |
| **Gravity** | moves specks. Needs specks to move — switch to Granite, or pour some first |
| **Magnet** | turns specks, rather than moving them. Same requirement |
| **Tune** | select a vein, web or seam to edit or hide it. This is how you change something already drawn |
| **Move** | pans the view. **A freshly loaded slab always starts on this tool**, so a stray tap cannot draw on a picture you have just restored |

**The rest**

| tool | what it does |
| --- | --- |
| **Mask** | cuts a window. *The next island inverts the mask* — once one exists, warp acts only inside these discs and the rest of the slab holds still |
| **Chip** | tap a tile edge to chip its corner. Needs **Lay tiles** on first |
| **Light** | drag the spotlight beam around the slab |

---

## The panels, roughly in the order you will want them

**Layers** — the buckets, their visibility, their order, and per-layer opacity. Add your own with the
buttons at the bottom.

**Colour** — a colour per layer, and effects per layer (blend mode and glow). Because it is per layer,
changing "Major veins" changes every major vein at once.

**Tiles & floor** — cuts the slab you have drawn into a repeating pattern and lays it on a floor. Fifteen
patterns, real sizes on an 8 × 5 ft slab, with grout, saw kerf and edge treatment. *In order* keeps the
veins continuous tile to tile; *Shuffled* cuts each tile at a random point.

**Coat & light** — subsurface, specular and polish, the movable light, temperature, and:

- **Spectrum.** `0` is daylight. Sweep it and only the artifacts whose emission you authored near that
  value light up. **Black light is −1.**
- **Spotlight** turns the light into a beam — drag it with the Light tool.
- **Back light** lights from behind. Each bucket occludes by its own transmittance — veins nearly opaque,
  specks semi, the matrix glowing — folded deepest to top. Tint it with Light temperature.
- **Lens** is an ideal glass relief on the very top. Flat and perfect, so head-on it does almost nothing;
  it refracts what lies beneath as it steepens, and it is built to pair with a back light.

**Clouds & warp, Banding, Breccia, Drusy, Fog & resin, Granite ground** — the generators. Each fills its
own bucket procedurally, so you can get a long way without drawing at all.

**Calibrate the pen** — if you are using a stylus, do this once. It measures what your pen actually
reports rather than assuming.

**File** — Save, Load, and the slab name. Save writes the recipe as JSON; it is small, and it is the thing
worth keeping.

**Render** — everything about producing an image. See below.

**How the tools read** — the forward-only rule, in the app, where you need it.

---

## Rendering

**Width.** The menu offers up to whatever your device can actually do, probed rather than assumed. The
line beside it tells you what that is.

**What to export.** *Just the render* is the image. *Everything* is the full kit.

**Large render / Extreme.** Above 16,384 px the export renders one tile at a time and writes each to disk
as it goes. **It cannot resume — do not close the tab.** A 65,535 px render is 2.68 gigapixels and
produces a file of several hundred megabytes.

**Tile.** The planner races candidate tile sizes and picks one. **Probe** measures which sizes your device
can actually paint at the chosen width — it allocates each one, marks its far corner and reads it back,
which is how a canvas that silently stops painting is caught. Only sizes that pass are offered.

> On a device short of memory it is often worth taking one size **below** what the planner settles on: a
> large tile can lose light at the joins in a way a single calibration tile cannot show, and on the
> slowest hardware tested the smaller tile was also the faster one.

**Glow lift.** Under black light each element draws its own halo, and this mixes that halo toward white —
or, negative, toward black. **Auto** uses the value measured for your browser engine, so a set rendered
across several machines agrees. Turn Auto off to depart from it deliberately: engine character is a
choice, not a fault.

**What the file carries.** Every render embeds a description of itself — the build, the engine, the
hardware class, the tile plan, the timings, and the light as it was written. Read it back with:

```
node tools/tiff-meta.mjs <your-file.tif>
```

Your device's *identity* — the user-agent, and on Chromium the model — is encrypted in there under a key
derived from your slab. Hardware class stays readable; identity does not, unless you hand over the slab.

---

## Things that will surprise you

**The light resets on load.** Covered above, and it is the most common way a render comes out wrong.

**Two browsers will not give you the same picture.** They will be close under black light — the per-engine
correction exists for exactly that — but they are not identical, and in daylight they are not even close.
This is treated as a palette rather than a bug. Render a set on one engine if you want it consistent.

**A slab is not a picture.** Loading one gives you the stone back exactly; it does not restore your light,
your view, or your export settings.

**Big renders are slow on small devices, and that is fine.** A 2019 tablet with 2 GB produces a 65,535 px
master in about half an hour. Leave it alone and let it run; it does not need watching.

**Nothing leaves your machine.** The render happens in your browser and the file is written by your
browser. There is no server.

---

## Licence

CC0 — public domain. Use it, fork it, print it, sell it. No attribution required.

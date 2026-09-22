"""Rip a reference photograph of stone into tier masks.

    python tools/stone_rip.py slab.jpg --name carrara --out textures/carrara

Takes one image of real stone and writes one SOFT greyscale mask per tier, plus
a contact sheet to look at. The masks are the shape Vacuum Agent's floor
textures already use, so a registry entry can point straight at them and the
Material tab's colour model works on them unchanged.

WHY THIS AND NOT THE GENERATOR. A photograph IS real marble. The hardest part of
the generator was making something look real; the hardest part here is only
separating what is already there. What is given up is that a photo is ONE FACE -
there is no depth stack to cut, and no seed to re-roll. VA ships four flat
layers with no depth model and looks right, so that is a cost worth paying.

THE SEPARATION IS THE WHOLE JOB, and four probes in this project have already
passed by measuring their own artifacts rather than the stone. Each rule below
is one of those, paid for:

  FLAT-FIELD ONLY THE LIGHTING, AND AT THE RIGHT RADIUS. A vignetting check once
  flagged all four slabs in the reference set, so the gradient is real. But the
  first radius here was 0.08 of the frame, which is CLOUD scale - and on a
  Bardiglio Nuvolato the cloud is the stone. It is what nuvolato means. Erasing
  it as glare would have thrown away more of that marble than the veins carry.
  The lighting comes out at 0.40 of the frame; the cloud is kept as its own
  layer, which is also what VA's `base` mask is.

  SCALE THE VEIN FIELD AGAINST THE GROUND'S NOISE, NOT ITS EXTREMES. A min-max
  stretch spreads the GROUND over the full range too, so the field stops being
  bimodal and Otsu splits the stone instead of the veins. Measured: it called
  60% of a Bardiglio a major vein.

  THE TIERS ARE THE STONE'S, NOT A TABLE'S. 5.9 / 3.7 / 2.4mm are CARRARA's
  gauges. Different marbles have different geometries - which is the whole
  reason for ripping real references instead of generating - and forcing
  Bardiglio through Carrara's numbers put 532 components and 18% of the slab
  into `major` and left the other tiers empty. The splits are clustered out of
  this stone's own width distribution, in log width because a gauge series is
  multiplicative.

  NOT EVERY STONE HAS FOUR TIERS. Carrara-like marbles do. A Bardiglio is a
  cloud, one dense vein network and speckle. Reporting four when there are three
  fills a tier with whatever was nearest.

  NEVER SEGMENT ON BRIGHTNESS ALONE. A specular segmentation threw away 35% of a
  slab, because polished stone has highlights brighter than the ground and
  darker veins in the same frame. Local CONTRAST is what a vein is; absolute
  brightness is what the lighting was. (Prefer honed reference images anyway.)

  DO NOT TUNE THE THRESHOLD ON THE DATA YOU THEN VALIDATE WITH. A percentile
  threshold once manufactured a perfect -1.000 correlation by construction.
  Otsu is chosen because it has no knob to fit.

  NO SKELETON JUNCTION COUNTS. Branch-point density came out flat at 472-558
  per 1000 skeleton pixels across EVERY population including micro - which is
  dots, and cannot branch. It was measuring the skeletoniser.

TIERS use the discriminators measured off real marble masks, and they are
ORTHOGONAL on purpose: WIDTH separates major+minor from subminor+micro, LENGTH
separates subminor (strokes) from micro (dots, the same gauge), and DISTANCE TO
THE MAJOR NETWORK separates minor from subminor. Minor shadows the network at
59px where random scatter sits at 79px; that is a fact about stone, not a
threshold someone liked.

CARD SCALE IS THE POINT. At card scale most marbles show only a HANDFUL of
veins - Statuario about three, Calacatta Gold four or five - while VA's mask has
81 major components per slab. Ripping a whole 3m slab therefore puts slab-scale
structure on a 430px tile. Pass --mm to say how wide the image is in millimetres
and --card to say how many millimetres a card shows, and it crops before it
measures.

BOOKMATCH. The dramatic white marbles are mostly photographed as mirrored pairs
(calacatta-gold scored 0.93, carrara 0.87, statuario 0.86). Ripping one whole
gives a visibly mirrored mask. --half crops to one side of the mirror axis,
which is a real single slab.

Needs numpy and opencv-python, which the panel itself does not.
"""
import argparse
import json
import os
import pathlib
import sys

# OpenEXR is compiled into this OpenCV but gated behind an environment flag, and
# the flag is read at IMPORT. EXR is the one format an editor offers that really
# does carry more than 8 bits of anything, so it is worth the two lines.
os.environ.setdefault("OPENCV_IO_ENABLE_OPENEXR", "1")

import cv2                                            # noqa: E402
import numpy as np                                    # noqa: E402

# Tier gauges in millimetres, measured off real marble. The same numbers the
# generator authors to, so a ripped stone and a generated one are the same kind.
GAUGE_MM = {"major": 5.9, "minor": 3.7, "subminor": 2.4, "micro": 2.1}
# Minor shadows the fracture network; random scatter sits at 79px on the slabs
# these were measured from, so anything past that is independent of it.
MINOR_SHADOW = 0.75          # fraction of the scatter distance, as a multiple of major width


def read_raw(path, wh):
    """A headerless dump, with the layout WORKED OUT rather than assumed.

    A .raw has no header at all, so the pixel count is the only thing that can
    say what is in it. Given the dimensions, bytes-per-pixel pins the channel
    count and depth together - and it has to be pinned, because an image tool
    saying "32 bit" can mean 32 bits PER PIXEL (8-bit RGBA) or 32 bits per
    CHANNEL (float). His export measured 8.0000 bytes per pixel, which is
    16-bit RGBA, and reading it as float32 would have produced NaNs and
    infinities rather than an obviously wrong picture.
    """
    import os
    w, h = wh
    n = os.path.getsize(path)
    px = w * h
    if px <= 0 or n % px:
        sys.exit(f"{n} bytes is not a whole number of pixels for {w}x{h}")
    bpp = n // px
    layout = {1: (1, np.uint8), 2: (1, np.uint16), 3: (3, np.uint8), 4: (4, np.uint8),
              6: (3, np.uint16), 8: (4, np.uint16), 12: (3, np.float32), 16: (4, np.float32)}
    if bpp not in layout:
        sys.exit(f"{bpp} bytes per pixel is not a layout this knows")
    ch, dt = layout[bpp]
    a = np.fromfile(path, dtype=dt).reshape(h, w, ch).astype(np.float32)
    if dt != np.float32:
        a /= float(np.iinfo(dt).max)
    # Alpha is not tone: averaging it in would lift every pixel toward white.
    rgb = a[:, :, :3] if ch >= 3 else a[:, :, :1]
    g = rgb.mean(axis=2)
    print(f"raw: {w}x{h} {ch}ch {np.dtype(dt).name} ({bpp} bytes/px)", file=sys.stderr)
    return np.clip(g, 0, 1)


def crop_to_slab(g, pad=0.01):
    """Cut the backdrop away and keep the stone.

    A product shot stands the slab on a black sweep, and the backdrop is not
    neutral - it BREAKS three separate measurements before anything downstream
    has a chance:

      it reads as CLIPPING, because it genuinely is pure black - 40% of one
      Bardiglio frame, which looked like a ruined exposure and was a curtain;

      it FAKES A BOOKMATCH, because black on the left mirrors black on the
      right perfectly. That slab scored 0.85 with no mirror symmetry in the
      stone at all - the backdrop was correlating with itself;

      and it poisons the ripper, whose flat-field, MAD scale and width
      clustering all take the whole frame as their population.

    Found as the largest bright region rather than by a border heuristic,
    because a slab is not always centred and the sweep is not always even.
    """
    # EXACTLY ZERO, not a percentile. Measured across the set: the studio sweep
    # is pure black (0,0,0) on 8 of 9 slabs, at 97-100% of the border - so the
    # backdrop announces itself and needs no threshold to find. A percentile
    # with a margin was the first version, and it is a knob that would quietly
    # eat the darkest bands of a Nero Marquina. The ninth image has no backdrop
    # at all - it is already a crop of stone - and is left alone, which is what
    # the coverage test below is for.
    dark = float((g <= 0.004).mean())
    if dark < 0.02:
        return g, False
    mask = (g > 0.004).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if n < 2:
        return g, False
    i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x, y, w, h, area = stats[i]
    if area / g.size > 0.92:                  # already a crop of stone
        return g, False
    dx, dy = int(w * pad), int(h * pad)
    out = g[y + dy: y + h - dy, x + dx: x + w - dx]
    return (out, True) if out.size > 0.05 * g.size else (g, False)


def read_psd(path):
    """A PSD's flattened composite, at ANY bit depth.

    Pillow reads 8-bit PSDs and nothing else, so a 16 or 32-bit save - which is
    one toggle in the editor - came back "unreadable". Downgrading to suit the
    tool is the wrong way round, so this reads the composite directly.

    Only the composite, never the layers: the layer stack is the working file's
    business, and what ships is what Photoshop already flattened.

    RLE is PackBits per scanline, with every scanline's byte count listed up
    front. Deep files also BYTE-SHUFFLE each row - all the high bytes of the
    row, then all the next - so a 16-bit row is two planes of w bytes and not
    w interleaved pairs. Read without unshuffling it comes out as noise that
    still has the right histogram, which is the sort of wrong that passes a
    glance at the numbers.
    """
    import struct
    b = pathlib.Path(path).read_bytes()
    if b[:4] != b"8BPS":
        return None
    ch, h, w, depth, mode = struct.unpack(">HIIHH", b[12:26])
    o = 26
    for _ in range(3):                                   # colour mode, resources, layers
        o += 4 + struct.unpack(">I", b[o:o + 4])[0]
    comp, = struct.unpack(">H", b[o:o + 2]); o += 2
    per = depth // 8
    need = w * h * per

    if comp == 0:
        planes = [b[o + i * need: o + (i + 1) * need] for i in range(ch)]
    elif comp == 1:
        counts = np.frombuffer(b[o:o + 2 * h * ch], ">u2"); o += 2 * h * ch
        planes = []
        for c in range(ch):
            rows = []
            for r in range(h):
                n = int(counts[c * h + r])
                buf, out, i = b[o:o + n], bytearray(), 0
                while i < len(buf):                      # PackBits
                    k = buf[i]; i += 1
                    if k < 128:
                        out += buf[i:i + k + 1]; i += k + 1
                    elif k > 128:
                        out += bytes([buf[i]]) * (257 - k); i += 1
                rows.append(bytes(out)); o += n
            planes.append(b"".join(rows))
    else:
        return None                                      # ZIP: not seen in the wild here

    out = []
    for c in range(min(3, ch)):
        a = np.frombuffer(planes[c][:need], np.uint8)
        if len(a) < need:
            return None
        if per == 1:
            out.append(a.reshape(h, w).astype(np.float32) / 255.0)
        else:
            # unshuffle: (h, per, w) bytes -> (h, w, per) -> big-endian scalars
            v = np.ascontiguousarray(a.reshape(h, per, w).transpose(0, 2, 1))
            dt = ">u2" if per == 2 else ">f4"
            v = v.view(dt).reshape(h, w).astype(np.float32)
            out.append(v / 65535.0 if per == 2 else v)
    g = np.mean(out, axis=0)
    print(f"psd: {w}x{h} {ch}ch {depth}-bit "
          f"{'raw' if comp == 0 else 'RLE'}", file=sys.stderr)
    return np.clip(g, 0, 1)


def grey(path, raw=None):
    """The image as float 0..1, greyscale, at whatever depth it arrived in.

    Pillow first, because it reads PSD, TIFF and 16-bit PNG and OpenCV's plain
    IMREAD_COLOR reads none of those usefully - it crushes 16 bits to 8 on the
    way in, and the faint end is exactly where a subtle vein lives. A PSD can be
    handed over as it is; no export step, no second copy to keep in step.

    READS: PNG, TIFF, PSD, BMP, TGA, PPM, JPEG2000, WEBP and DDS through Pillow;
    EXR and 16-bit anything through OpenCV; a headerless .raw with --raw WxH.

    JPEG IS THE ONE FORMAT TO AVOID, and lossy WEBP with it. This thresholds
    high-frequency content, and JPEG's 8x8 block ringing sits in the same band
    as the finest veins - it does not look like damage, it looks like micro.
    Anything lossless is fine, and measured on the same image through three
    paths (16-bit raw, PSD, 8-bit PNG) the depth changed the major count by
    259 / 251 / 254 - which is to say, not at all. Use whatever is least work.

    Colour is dropped here and never looked at again: colour is the theme's.
    """
    if raw:
        return read_raw(path, raw)
    if str(path).lower().endswith((".psd", ".psb")) or             pathlib.Path(path).read_bytes()[:4] == b"8BPS":
        g = read_psd(path)
        if g is not None:
            return g
    try:
        from PIL import Image
        im = Image.open(str(path))
        a = np.asarray(im.convert("I;16") if im.mode in ("I;16", "I") else im.convert("L"))
        return a.astype(np.float32) / float(np.iinfo(a.dtype).max if a.dtype != np.float32 else 1.0)
    except Exception:
        pass
    im = cv2.imread(str(path), cv2.IMREAD_UNCHANGED | cv2.IMREAD_ANYDEPTH)
    if im is None:
        sys.exit(f"cannot read {path}")
    if im.ndim == 3:
        im = cv2.cvtColor(im[:, :, :3], cv2.COLOR_BGR2GRAY)
    scale = 65535.0 if im.dtype == np.uint16 else 255.0
    return im.astype(np.float32) / scale


def flat_field(g):
    """Divide out the slow illumination, and NOTHING ELSE.

    The radius here is the whole argument. Lighting varies across the FRAME;
    the cloud in a Bardiglio Nuvolato varies across a hand's width, and it is
    the stone's own structure - it is what nuvolato MEANS. The first version
    used 0.08 of the frame, which is cloud scale, so it would have erased the
    one thing that makes that marble itself and called it glare.

    So: only the very slowest gradient comes out here. The cloud is separated
    below, as its own layer, which is also what VA's `base` mask is."""
    h, w = g.shape
    base = cv2.GaussianBlur(g, (0, 0), 0.40 * min(h, w))
    # SUBTRACTIVE, not a division. Illumination really is multiplicative, so
    # dividing is the physically tidy answer - and it makes the whole tool
    # polarity-dependent, because (1-g)/blur(1-g) is not 1 - g/blur(g). His
    # invert check caught it: the same slab upside down gave mask IoUs of 66%,
    # 30% and 12% where they should have been identical. The band-pass below is
    # subtractive anyway, so the division was the odd step out.
    return g - base + 0.5


def cloud_field(flat, sigma_frac=0.045):
    """The stone's broad tone - banding, clouding, the drifts a slab has.

    Everything slower than a vein and faster than the lighting. Kept as a layer
    rather than removed, because on a clouded marble it carries more of the
    look than the veins do."""
    h, w = flat.shape
    c = cv2.GaussianBlur(flat, (0, 0), sigma_frac * min(h, w))
    return np.clip((c - c.min()) / (np.ptp(c) + 1e-9), 0, 1)


def vein_field(flat, fine, coarse):
    """A band-pass: what is darker (or lighter) than its immediate surround.

    Returns ink in 0..1 where 1 is the strongest vein, and the polarity it
    found. Polarity is DETECTED, not assumed: Carrara is dark veins on light
    stone and Nero Marquina is the reverse, and guessing wrong silently rips
    the ground out instead of the veins."""
    lo = cv2.GaussianBlur(flat, (0, 0), fine)
    hi = cv2.GaussianBlur(flat, (0, 0), coarse)
    band = lo - hi
    # Veins are the RARE side, so the tail that is longer is the stone's ground
    # and the short heavy tail is the ink. Skew says which.
    m, sd = band.mean(), band.std() + 1e-9
    skew = float((((band - m) / sd) ** 3).mean())
    polarity = -1.0 if skew < 0 else 1.0        # negative skew = dark veins
    band = band * polarity

    # SCALED AGAINST THE GROUND'S OWN NOISE, never min to max. A min-max stretch
    # spreads the GROUND across the whole range too, so the field is no longer
    # bimodal and Otsu then splits the stone rather than the veins - measured on
    # a Bardiglio, it called 60% of the slab a major vein. The median and MAD
    # are taken over every pixel, and because veins are a small minority they
    # describe the ground: a vein is then what sits several robust sigmas above
    # it, which is a statement about the stone and not a number that was tuned.
    med = float(np.median(band))
    mad = float(np.median(np.abs(band - med))) * 1.4826 + 1e-9
    ink = np.clip((band - med) / (4.0 * mad), 0, 1)
    return ink, polarity


def components(mask):
    """Connected components with a per-component WIDTH from the distance
    transform. Width is 2x the largest inscribed radius, which is the widest
    the vein gets - a median over the skeleton would report the tapers."""
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    dist = cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, 5)
    out = []
    for i in range(1, n):
        area = int(stats[i, cv2.CC_STAT_AREA])
        if area < 4:
            continue
        sel = labels == i
        width = float(2.0 * dist[sel].max())
        out.append({"label": i, "area": area, "width": max(width, 1.0),
                    # length from area and width, not from a skeleton: the
                    # skeletoniser is what made the branch probe lie.
                    "length": area / max(width, 1.0)})
    return out, labels


def populations(widths, k=3, rounds=40):
    """Where THIS stone's width populations actually split, in log width.

    1-D Lloyd's, seeded on quantiles so it is deterministic.

    THE FIXED mm TABLE WAS THE MISTAKE, and it is the generator's mistake
    repeated: 5.9 / 3.7 / 2.4mm are CARRARA's gauges, measured off Carrara-like
    masks. Bardiglio Nuvolato is a different stone with a different geometry -
    which is the whole reason for ripping real references rather than generating
    - so forcing its veins through Carrara's numbers put 532 components and 18%
    of the slab into `major` and left the other three tiers empty.

    Log width, not width, because a gauge series is multiplicative: the measured
    minor/major ratio is 0.63, and the step from 5.9 to 3.7 is the same KIND of
    step as 3.7 to 2.4. In linear width the wide end dominates the clustering.
    """
    x = np.log(np.asarray(widths, np.float64) + 1e-6)
    if len(x) < k:
        return []
    c = np.quantile(x, np.linspace(0.15, 0.85, k))
    for _ in range(rounds):
        lab = np.abs(x[:, None] - c[None, :]).argmin(1)
        new = np.array([x[lab == i].mean() if (lab == i).any() else c[i] for i in range(k)])
        if np.allclose(new, c):
            break
        c = np.sort(new)
    # the boundaries are the midpoints between neighbouring centres
    return [float(np.exp((c[i] + c[i + 1]) / 2)) for i in range(k - 1)]


def classify(comps, labels, px_per_mm, shape):
    """Four tiers by the three orthogonal discriminators.

    The width boundaries are the MIDPOINTS between adjacent measured gauges -
    5.9, 3.7, 2.4, 2.1mm - so nothing here is a threshold somebody liked. Note
    subminor and micro share a gauge, which is why width cannot separate them
    and LENGTH does: a stroke against a dot.

    The first version of this had a dead expression where the major/minor split
    should have been, so every wide component became major and 83% of the micro
    went with it. It scored 97% on the one number I was watching."""
    # THE STONE'S OWN SPLITS, not a table. Falls back to the measured Carrara
    # gauges only when there is too little to cluster.
    breaks = populations([c["width"] for c in comps], k=3)
    if len(breaks) == 2:
        minor_fine, major_minor = breaks
    else:
        cut = {t: GAUGE_MM[t] * px_per_mm for t in GAUGE_MM}
        major_minor = (cut["major"] + cut["minor"]) / 2
        minor_fine = (cut["minor"] + cut["subminor"]) / 2
    tiers = {t: np.zeros(shape, np.uint8) for t in GAUGE_MM}

    # MAJOR first: it is the network everything else is measured against.
    major = [c for c in comps if c["width"] >= major_minor]
    for c in major:
        tiers["major"][labels == c["label"]] = 1

    # DISTANCE TO THAT NETWORK separates minor from the scattered tiers. Minor
    # shadows it at 59px where random scatter sits at 79px, measured - so the
    # test is "closer than chance would put it", not "close".
    major_any = tiers["major"].any()
    d_major = (cv2.distanceTransform(1 - tiers["major"], cv2.DIST_L2, 5)
               if major_any else np.full(shape, 1e6, np.float32))
    near = MINOR_SHADOW * 79.0 * px_per_mm / (GAUGE_MM["major"] / 5.9)

    for c in comps:
        if c["width"] >= major_minor:
            continue
        sel = labels == c["label"]
        shadows = major_any and float(d_major[sel].min()) < near
        if c["width"] >= minor_fine and shadows:
            t = "minor"
        elif c["length"] >= 3.0 * c["width"]:
            t = "subminor"                    # a stroke
        else:
            t = "micro"                       # a dot
        tiers[t][sel] = 1
    return tiers


def value_field(g, mask, polarity):
    """HOW MUCH a layer paints, taken from the PHOTOGRAPH - because ink cannot say.

    The mask decides WHERE. These were the same field until 2026-09-20, and on
    a high-contrast stone that field is saturated. Measured on african-st-
    laurent: `ink` under the structure mask ran a median of 1.000 with 73.8% of
    it pinned at the maximum and an IQR of 0.038, so every percentile from p50
    to p99.9 selected the identical 284,661 pixels. soft() below is documented
    as keeping "the swell and pinch and the soft boundary" and was keeping none
    of it - the composite read as flat paint, which no earlier probe could see
    because none of them composited anything.

    THAT IS NOT A FAULT IN `ink`, which is a DETECTOR and is scaled to be one:
    clipped into four robust sigmas so Otsu has a bounded field to cut. A grey-
    on-white Carrara uses that range; a white vein on a pure black ground blows
    through it everywhere. So ink keeps its job and the value comes from the
    source. Same image, same masks: IQR 0.038 -> 0.640, pinned 73.8% -> 1.3%.

    Scaled between the GROUND's own level and the mask's 99th percentile, so a
    vein reaches 1 where it is strongest and falls away through its shoulder.
    Polarity-aware, and invert-symmetric BY ARITHMETIC rather than by luck:
    inverting the image swaps which end is ground and which is peak, and the
    two swaps cancel. So his invert check covers this field too, and --check-
    invert asserts it.
    """
    sel = mask > 0
    if not sel.any():
        return np.zeros_like(g, np.float32)
    ground = float(np.median(g[~sel])) if (~sel).any() else float(np.median(g))
    peak = float(np.percentile(g[sel], 1 if polarity < 0 else 99))
    span = peak - ground
    if abs(span) < 1e-6:            # no range to speak of: fall back to binary
        return sel.astype(np.float32)
    return np.clip((g - ground) / span, 0, 1).astype(np.float32)


def soft(value, mask, feather=0.6):
    """A tier's mask keeps a real VALUE, not a flat fill.

    A binary mask throws away the swell and pinch and the soft boundary, which
    is most of what makes a vein read as a fracture rather than a drawn line.
    The value comes from value_field() above - it used to come from `ink`, and
    that is the one change that took the composite from flat paint to something
    indistinguishable from the photograph at tile size."""
    m = cv2.GaussianBlur(mask.astype(np.float32), (0, 0), feather)
    return np.clip(value * m, 0, 1)


def separate(g, px_per_mm, fine, coarse):
    """The whole pipeline, as one call, so it can be run twice.

    Run it twice and it HAS to agree with itself: inverting the image should
    flip the polarity label and change nothing else at all. See --check-invert.

    Returns cloud, ink, polarity, comps, labels, tiers, VALUE - seven, and the
    last one is newer than the rest. `ink` is the DETECTOR and `value` is what
    a layer paints with; they were one field and that cost the composite its
    swell on every high-contrast stone.
    """
    flat = flat_field(g)
    cloud = cloud_field(flat)
    # The veins are measured against the CLOUD, not against a flat average, so a
    # pale vein crossing a dark band and the same vein crossing a light one are
    # the same vein. Measured against the average, half of it disappears.
    ink, polarity = vein_field(flat - (cloud - float(cloud.mean())) * 0.6, fine, coarse)

    # HYSTERESIS, not a single cut. A hairline vein sits only just above the
    # ground along most of its length, so one threshold BEADS it - the vein
    # survives where it is strongest and breaks everywhere else. The beads are
    # stubby, so they fail the length test that separates a stroke from a dot.
    # Seed at Otsu, which has no knob to fit, then grow into everything
    # connected that is still above the ground: 1.5 robust sigmas, and `ink` is
    # scaled in units of four of them, so it is 0.375 by arithmetic.
    t, _ = cv2.threshold((ink * 255).astype(np.uint8), 0, 255,
                         cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    seed = (ink * 255 >= t).astype(np.uint8)
    grow = (ink >= 1.5 / 4.0).astype(np.uint8)
    n, lab = cv2.connectedComponents(grow, connectivity=8)
    keep = np.zeros(n, bool)
    keep[np.unique(lab[seed > 0])] = True
    keep[0] = False                                   # the background is not a vein
    binary = keep[lab].astype(np.uint8)

    comps, labels = components(binary)
    # WHERE and HOW MUCH are two fields, not one. See value_field().
    value = value_field(g, binary, polarity)
    return (cloud, ink, polarity, comps, labels,
            classify(comps, labels, px_per_mm, g.shape), value)


def self_test():
    """The bite test for value_field, on a stone built so `ink` MUST saturate.

    Black ground, bright veins, deliberately high contrast - the shape that
    broke it on african-st-laurent. Nothing here is fitted to the real image:
    the stone is drawn from a seed, and the thresholds are the ones a flat mask
    fails and a real one passes by a wide margin.

    ABLATED THREE WAYS before it was committed, because a test that cannot go
    red is a preference. Each one fails the assertion it should and no others:

      value := ink              pinned 76.9%, iqr 0.000, does not span - the
                                exact defect, and 76.9% here against the 73.8%
                                measured on the real african-st-laurent
      value := the binary mask  all four, a flat fill being the other way to
                                lose the swell
      ground := a fixed 0.0     ONLY the invert assertion, max difference
                                1.0000 - which is what proves that check is not
                                just restating the saturation ones

    Asserts three things:
      NOT SATURATED  under a quarter of the masked pixels at the maximum, and
                     an IQR with room in it. A field pinned at its max still
                     has a sane mean, a sane coverage and a passing invert
                     check, which is exactly how this hid.
      SPANS          the field reaches both ends - a vein core at 1, a shoulder
                     near 0 - because a mask that is uniformly 0.5 is as flat
                     as one that is uniformly 1.
      INVERT-SYMMETRIC  the field is derived to cancel under inversion, so any
                     difference at all means the derivation changed. This is an
                     assertion about arithmetic, not a tuned tolerance.
    """
    rng = np.random.default_rng(7)
    n = 640
    g = np.full((n, n), 0.02, np.float32)
    for k in range(9):                       # veins, each with its own strength
        x0, y0 = rng.integers(0, n, 2)
        ang = rng.uniform(0, np.pi)
        half = rng.uniform(1.5, 5.0)
        peak = rng.uniform(0.45, 1.0)
        yy, xx = np.mgrid[0:n, 0:n]
        d = np.abs((xx - x0) * np.sin(ang) - (yy - y0) * np.cos(ang))
        g = np.maximum(g, peak * np.exp(-(d / half) ** 2))
    # and scattered specks, so the frame is not one crossing network: nine
    # veins that intersect are TWO components, which is correct and made the
    # first version of this test fail on its own setup rather than on the
    # thing it is asserting.
    yy, xx = np.mgrid[0:n, 0:n]
    for k in range(40):
        cx, cy = rng.integers(12, n - 12, 2)
        r = rng.uniform(1.2, 2.6)
        peak = rng.uniform(0.35, 0.8)
        d2 = (xx - cx) ** 2 + (yy - cy) ** 2
        g = np.maximum(g, peak * np.exp(-d2 / (2 * r * r)))
    g = np.clip(g + rng.normal(0, 0.004, (n, n)), 0, 1).astype(np.float32)

    _, ink, pol, comps, _, tiers, value = separate(g, n / 400.0, 1.2, 18.0)
    struct = np.zeros(g.shape, np.uint8)
    for m in tiers.values():
        struct |= m
    if not struct.any() or len(comps) < 3:
        print(f"FAIL  the synthetic stone produced no structure ({len(comps)} components)")
        return 1

    x = value[struct > 0]
    pin = float((x >= 0.999).mean())
    iqr = float(np.percentile(x, 75) - np.percentile(x, 25))
    ipin = float((ink[struct > 0] >= 0.999).mean())
    _, _, _, _, _, _, value2 = separate(1.0 - g, n / 400.0, 1.2, 18.0)
    vdiff = float(np.abs(value - value2).max())

    bad = []
    if pin > 0.25:
        bad.append(f"value pinned at max {pin*100:.1f}% (ceiling 25%)")
    if iqr < 0.15:
        bad.append(f"value iqr {iqr:.3f} (floor 0.15)")
    if float(x.max()) < 0.9 or float(np.percentile(x, 5)) > 0.4:
        bad.append(f"value does not span: max {x.max():.2f}, p5 {np.percentile(x,5):.2f}")
    if vdiff > 0.02:
        bad.append(f"not invert-symmetric, max abs difference {vdiff:.4f}")

    print(f"  synthetic stone   {len(comps)} components, "
          f"{'dark' if pol < 0 else 'light'} veins")
    print(f"  ink   pinned {ipin*100:5.1f}%   <- the field this used to paint with")
    print(f"  value pinned {pin*100:5.1f}%   iqr {iqr:.3f}   "
          f"span {x.min():.2f}-{x.max():.2f}")
    print(f"  invert  max abs difference {vdiff:.5f}")
    for b in bad:
        print(f"  FAIL  {b}")
    print("  PASS" if not bad else "  FAILED")
    return 1 if bad else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image", nargs="?", default=None)
    ap.add_argument("--name", default="stone")
    ap.add_argument("--out", default="ripped")
    ap.add_argument("--mm", type=float, default=None,
                    help="how many millimetres wide the IMAGE is (a slab is ~3000)")
    ap.add_argument("--card", type=float, default=400,
                    help="how many millimetres a card shows; the crop is taken to this")
    ap.add_argument("--half", choices=["left", "right", "top", "bottom"], default=None,
                    help="bookmatched pairs: keep one side of the mirror axis")
    ap.add_argument("--size", type=int, default=1024, help="output mask size, px")
    ap.add_argument("--check-invert", action="store_true",
                    help="his sanity check, and it is nearly free: rip the image, rip it "
                         "upside down, and the masks must be IDENTICAL. Polarity is "
                         "DETECTED, so inverting may flip the label and nothing else. It "
                         "caught a divisive flat-field that made the whole tool depend on "
                         "which way up the stone was - IoU 66/30/12%% where it had to be 100.")
    ap.add_argument("--raw", default=None, metavar="WxH",
                    help="a headerless .raw dump; give its pixel dimensions and the "
                         "channel count and depth are worked out from the file size")
    ap.add_argument("--self-test", action="store_true",
                    help="rip a synthetic high-contrast stone and assert the "
                         "value field is not saturated, spans its range and is "
                         "invert-symmetric. Needs no image.")
    ap.add_argument("--fine", type=float, default=1.2)
    ap.add_argument("--coarse", type=float, default=18.0)
    args = ap.parse_args()

    if args.self_test:
        sys.exit(self_test())
    if not args.image:
        sys.exit("give an image, or --self-test")

    raw = None
    if args.raw:
        try:
            raw = tuple(int(v) for v in args.raw.lower().split("x")[:2])
        except ValueError:
            sys.exit(f"--raw wants WxH, not {args.raw!r}")
    g = grey(args.image, raw)
    h, w = g.shape

    if args.half:
        if args.half == "left":   g = g[:, : w // 2]
        if args.half == "right":  g = g[:, w // 2:]
        if args.half == "top":    g = g[: h // 2, :]
        if args.half == "bottom": g = g[h // 2:, :]
        h, w = g.shape

    # CARD SCALE. Crop to what a card actually shows before measuring anything,
    # or every tier count is a slab's and lands on a 430px tile.
    if args.mm:
        keep = min(1.0, args.card / (args.mm * (w / max(w, 1))))
        if keep < 1.0:
            cw, ch = int(w * keep), int(h * keep)
            x, y = (w - cw) // 2, (h - ch) // 2
            g = g[y:y + ch, x:x + cw]
            h, w = g.shape

    # CLIPPING IS THE ONE EDIT THAT CANNOT BE UNDONE. Brightness and contrast
    # wash out of this pipeline by construction - a subtractive flat-field drops
    # a constant offset and the MAD scaling drops a constant gain - so pushing
    # them costs nothing and buys nothing. Pushing them until the shadows CRUSH
    # is different: that information is gone, and nothing downstream can tell
    # the difference between a dark band and a black one.
    #
    # Measured on the same slab at three treatments: untouched clipped 0.07% of
    # its pixels and 4.2% of its fine features stayed strokes; a moderate push
    # clipped 0.00% and reached 5.3%; a hard push clipped 25.64% and fell to
    # 2.7%. The hard push also produced the MOST components, which is why the
    # count is not the thing to watch - the veins were breaking up, not
    # resolving.
    black = float((g <= 0.004).mean())
    white = float((g >= 0.996).mean())
    if max(black, white) > 0.02:
        print(f"  CLIPPED: {black*100:.1f}% crushed to black, {white*100:.1f}% blown to white."
              f" That detail is gone, and pushing the editor harder will not recover it.",
              file=sys.stderr)

    g = cv2.resize(g, (args.size, args.size), interpolation=cv2.INTER_AREA)
    px_per_mm = args.size / float(args.card)

    cloud, ink, polarity, comps, labels, tiers, value = separate(
        g, px_per_mm, args.fine, args.coarse)

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    report = {"stone": args.name, "polarity": "dark veins" if polarity < 0 else "light veins",
              "px_per_mm": round(px_per_mm, 3), "components": len(comps), "tiers": {}}
    # The cloud ships as its own layer, the way VA's base mask does.
    cv2.imwrite(str(out / f"{args.name}-cloud.png"), (cloud * 255).astype(np.uint8))
    report["tiers"]["cloud"] = {"components": 1, "coverage": 1.0}
    panels = [("source", g), ("cloud", cloud), ("ink", ink), ("value", value)]
    for tier, m in tiers.items():
        s = soft(value, m)
        cv2.imwrite(str(out / f"{args.name}-{tier}.png"), (s * 255).astype(np.uint8))
        n = sum(1 for c in comps if m[labels == c["label"]].any())
        report["tiers"][tier] = {"components": n, "coverage": round(float((s > 0.03).mean()), 4)}
        panels.append((tier, s))

    # SATURATION, printed every run, because this is the failure that hid from
    # every numeric probe for a week: a field pinned at its maximum still has a
    # perfectly reasonable mean, a sane coverage and a passing invert check.
    struct = np.zeros(g.shape, np.uint8)
    for m in tiers.values():
        struct |= m
    if struct.any():
        for nm, f in (("ink", ink), ("value", value)):
            x = f[struct > 0]
            pin = float((x >= 0.999).mean())
            iqr = float(np.percentile(x, 75) - np.percentile(x, 25))
            report[f"{nm}_pinned"] = round(pin, 4)
            print(f"  {nm:<6} under the mask   pinned at max {pin*100:5.1f}%   "
                  f"iqr {iqr:.3f}")
        if report.get("value_pinned", 0) > 0.25:
            print("  VALUE IS SATURATED - the masks will composite as flat paint.",
                  file=sys.stderr)

    # A CONTACT SHEET, because every broken probe in this project was caught by
    # a rendered picture and none of them by reading a number.
    cell = 320
    sheet = np.zeros((cell + 22, cell * len(panels), 3), np.uint8)
    for i, (label, img) in enumerate(panels):
        v = cv2.resize((np.clip(img, 0, 1) * 255).astype(np.uint8), (cell, cell))
        sheet[22:, i * cell:(i + 1) * cell] = cv2.cvtColor(v, cv2.COLOR_GRAY2BGR)
        cv2.putText(sheet, label, (i * cell + 6, 15), cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                    (225, 225, 225), 1, cv2.LINE_AA)
    cv2.imwrite(str(out / f"{args.name}-contact.png"), sheet)

    if args.check_invert:
        _, _, pol2, _, _, flipped, value2 = separate(
            1.0 - g, px_per_mm, args.fine, args.coarse)
        worst = 1.0
        for tier, mask in tiers.items():
            other = flipped[tier]
            union = int((mask | other).sum())
            iou = float((mask & other).sum()) / union if union else 1.0
            worst = min(worst, iou)
            print(f"  invert {tier:<9} IoU {iou*100:6.2f}%")
        print(f"  invert polarity  {report['polarity']} -> "
              f"{'dark veins' if pol2 < 0 else 'light veins'}")
        # value_field is invert-symmetric by arithmetic, so this is an
        # assertion about the derivation and not a tolerance that was tuned.
        vdiff = float(np.abs(value - value2).max())
        report["invert_value_maxdiff"] = round(vdiff, 5)
        print(f"  invert value     max abs difference {vdiff:.5f}")
        if vdiff > 0.02:
            print(f"  VALUE FIELD IS NOT INVERT-SYMMETRIC ({vdiff:.4f}) - it is derived to cancel",
                  "  under inversion, so this means the derivation itself changed.",
                  file=sys.stderr)
        report["invert_iou"] = round(worst, 4)
        if worst < 0.99:
            print(f"  INVERT CHECK FAILED: worst tier agrees only {worst*100:.1f}%. "
                  f"Something in the pipeline depends on which way up the stone is.",
                  file=sys.stderr)

    (out / f"{args.name}.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"-> {out}/{args.name}-contact.png")


if __name__ == "__main__":
    main()

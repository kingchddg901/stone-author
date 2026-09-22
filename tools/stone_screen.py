"""Screen a candidate reference before spending any time on it.

    python tools/stone_screen.py *.png
    curl -o candidate.png "<cdn url>" && python tools/stone_screen.py candidate.png

Answers the questions that decide whether an image is worth keeping, before it
gets edited, cropped or ripped. All of them are cheap and all of them have
caught something real.

  BOOKMATCH. The dramatic white marbles are mostly photographed as MIRRORED
  PAIRS - two slabs from the same block opened like a book. Measured on the
  reference set: calacatta-gold 0.93, carrara 0.87, statuario 0.86, borghini
  0.55, breccia 0.50-0.54; portoro, verde-alpi, nero-marquina and grand-antique
  came back clean. Ripping a bookmatched image whole gives a mask with a mirror
  line through it, which reads as a rendering fault rather than as stone. It is
  not a reason to discard - CROP TO ONE HALF of the mirror axis and what is left
  is a real single slab.

  SPECULAR BLOWOUT. Polished stone throws highlights brighter than its own
  ground, and a segmentation that ever looks at absolute brightness throws the
  slab away - measured once at 35%. Honed is matte and has none. Reported as the
  share of near-white pixels that carry no local detail: a highlight is flat,
  a white vein is not.

  CLIPPING - CRUSHED, not merely DARK. Shadows crushed or highlights blown are
  information already gone, and no editing recovers it. But a Nero Marquina is
  black marble, and measuring darkness alone called 86% of one a ruined
  exposure. Crushed pixels are FLAT; dark stone still carries detail. Same
  distinction the specular check makes at the other end of the range.

  RECOMPRESSION, JUDGED AT WORKING SIZE. JPEG ringing sits in the same band as
  the finest veins, so it reads as MICRO rather than as damage - a whole tier of
  artifacts shaped like stone. But the artifacts are a fixed 8 pixels, so a
  source several times larger than the working size has them averaged away by
  the downsample. Measured: a 5408px JPEG scores 1.96 native and 1.00 at 1024,
  while a 2100px lossless PNG scores 1.05. The big JPEG is the cleaner file by
  the time it is used. Judging at native size flagged the better source and
  passed the worse one, so "never JPEG" is the wrong rule - the rule is RATIO.

  SIZE, and whether it was EARNED. There is a floor below which the fine tiers
  are smaller than a pixel and no processing invents them back - and upscaling
  past that floor is the one fault that makes a file look better on every other
  check while adding nothing. Caught by top-octave energy at native size:
  natives run 26-45%, an upscale runs about 12%, and the same image halved and
  doubled back scores 12.55% against its own native 28.00%.

WATERMARKS ARE NOT SCREENED, and that is deliberate rather than an omission: a
reliable detector is a research problem, and a bad one would quietly pass a
watermarked slab as clean. They are obvious to a person in one second. Look.
"""
import argparse
import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from stone_rip import grey, crop_to_slab                     # noqa: E402

import cv2                                                   # noqa: E402


def mirror(g, axis):
    """How much one half is the other half reflected. 1.0 is a perfect fold."""
    h, w = g.shape
    if axis == "v":                      # fold about the vertical centre line
        a, b = g[:, : w // 2], np.fliplr(g[:, w - w // 2:])
    else:
        a, b = g[: h // 2, :], np.flipud(g[h - h // 2:, :])
    n = min(a.shape[1], b.shape[1]) if axis == "v" else min(a.shape[0], b.shape[0])
    a, b = (a[:, :n], b[:, :n]) if axis == "v" else (a[:n], b[:n])
    return float(np.corrcoef(a.ravel(), b.ravel())[0, 1])


def specular(g):
    """Near-white pixels that carry NO local detail - a blown highlight, not a
    white vein. A vein keeps structure inside it; a highlight is flat."""
    bright = g > 0.93
    if bright.sum() < 50:
        return 0.0
    detail = cv2.Laplacian(g, cv2.CV_32F, ksize=3)
    flat = np.abs(detail) < 0.01
    return float((bright & flat).mean())


def straight_edges(g):
    """Long straight lines that are not the picture's own border.

    STONE HAS NONE. A crop of a slab face is all curves and grain; a straight
    run of 20% of the frame is a MANUFACTURED edge - the slab's own edge, a
    rack, a door frame, signage, the horizon of a yard. So it catches in one
    measure the two faults that a photograph taken in a showroom has and a
    normalized frontal shot does not: the slab not filling the frame, and the
    slab being shot from the side, where its edges converge and the scale
    changes across the image.

    Scale varying across the frame is the quiet one. Nothing downstream can see
    it, and every width measurement - which is what the whole tiering rests on -
    is then wrong by a different amount in each corner.
    """
    h, w = g.shape
    e = cv2.Canny((g * 255).astype(np.uint8), 60, 160)
    lines = cv2.HoughLinesP(e, 1, np.pi / 180, threshold=90,
                            minLineLength=int(0.20 * min(h, w)), maxLineGap=6)
    if lines is None:
        return 0, 0.0
    longest = 0.0
    n = 0
    for x1, y1, x2, y2 in np.asarray(lines).reshape(-1, 4):
        # ignore the frame itself
        if min(x1, x2) < 4 or max(x1, x2) > w - 5 or min(y1, y2) < 4 or max(y1, y2) > h - 5:
            continue
        L = float(np.hypot(x2 - x1, y2 - y1))
        n += 1
        longest = max(longest, L / min(h, w))
    return n, longest


def upscaled(g):
    """Top-octave energy, at NATIVE size. An upscale cannot invent it.

    This is the one fault that makes a file look BETTER on every other check:
    take an 800px slab to 1600 and the "too small, the fine tiers will be under
    a pixel" warning goes away while not one real detail has been added.

    Controlled on one image with only the resampling changed - halve it, double
    it back - which is ground truth built rather than derived:

      native              28.00%       halved then doubled   12.55%

    A file he had scaled 2x came in at 12.35%, against 26-45% for every native
    photograph measured. Under about 18% means the detail is interpolation.

    Measured at native resolution, and that is the whole trick: the first
    version resized to 512 first and separated nothing, because resizing throws
    away the exact band an upscale is missing.

    WHAT IT CATCHES, measured on one image with only the resampler changed:

      native                    28.00%
      nearest neighbour         36.33%   NOT CAUGHT - scores ABOVE native
      bilinear                  14.85%   caught
      bicubic                   12.55%   caught
      bicubic sharper           15.12%   caught

    NEAREST NEIGHBOUR DEFEATS IT, because hard pixel steps are broadband high
    frequency - it looks MORE detailed than the original to this measure. It is
    also the one that looks obviously blocky, so the eye catches what the number
    cannot, which is the trade being made.

    Heavy SHARPENING also defeats it: bicubic plus an unsharp at 2x reaches
    20.76% and passes. A spectral-cliff measure - the ratio of power just below
    the original Nyquist to just above it - resists sharpening better, because
    sharpening lifts the tail without filling the cliff. Calibrated over 30 real
    slabs it gave a +1.56 effect size but the distributions OVERLAP: 37% of
    natives sat above the upscales' 10th percentile. So it is not a gate, and it
    is recorded here rather than shipped as one.
    """
    n = min(1 << (min(g.shape).bit_length() - 1), 2048)
    if n < 256:
        return None
    c = g[:n, :n] - g[:n, :n].mean()
    F = np.abs(np.fft.fftshift(np.fft.fft2(c)))
    yy, xx = np.mgrid[0:n, 0:n]
    r = np.hypot(yy - n / 2, xx - n / 2)
    return float(F[r > n / 4].sum() / max(F[r > 4].sum(), 1e-9))


def blockiness(g, work=1024):
    """JPEG's 8x8 grid, measured AT THE SIZE IT WILL BE RIPPED AT.

    Not at native size, and the difference decides which file to keep. JPEG
    artifacts sit at a fixed 8 pixels, so what matters is how big they are
    RELATIVE to the working size - a source three to five times larger has them
    averaged away by the downsample before anything looks for a vein.

    Measured on one Bardiglio: a 5408px JPEG scores 1.96 native and 1.00 at
    both 2048 and 1024. A 2100px lossless PNG scores 1.05 native and 1.01 at
    2048. So the JPEG is the cleaner of the two by the time it is used, and
    judging at native size flagged the better file and passed the worse one.

    "Never JPEG" was the wrong rule. The rule is the RATIO.
    """
    h, w = g.shape
    if w > work:
        g = cv2.resize(g, (work, max(1, int(work * h / w))), interpolation=cv2.INTER_AREA)
    d = np.abs(np.diff(g, axis=1))
    edges = d[:, 7::8]
    inner = np.delete(d, np.s_[7::8], axis=1)
    return float(edges.mean() / (inner.mean() + 1e-9))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("images", nargs="+")
    args = ap.parse_args()

    print(f"{'file':<34}{'size':>12}{'mirror v/h':>13}{'clip':>13}{'specular':>10}"
          f"{'jpeg':>7}{'lines':>6}  verdict")
    print("-" * 112)
    for path in args.images:
        p = pathlib.Path(path)
        try:
            g = grey(p)
        except SystemExit:
            print(f"{p.name[:33]:<34}  unreadable")
            continue
        # the backdrop comes off FIRST, or it fakes a bookmatch and reads as
        # a ruined exposure - both measured on a real slab shot
        g, cropped = crop_to_slab(g)
        h, w = g.shape
        mv, mh = mirror(g, "v"), mirror(g, "h")
        # CRUSHED, not merely DARK. A Nero Marquina is black marble and read
        # back "clipped 86%" - which was the stone. Crushed pixels are FLAT;
        # dark stone still carries detail, the same distinction the specular
        # check makes at the other end of the range.
        detail = np.abs(cv2.Laplacian(g, cv2.CV_32F, ksize=3))
        flat = detail < 0.004
        black = float(((g <= 0.004) & flat).mean())
        white = float(((g >= 0.996) & flat).mean())
        spec, blk = specular(g), blockiness(g)
        nlines, longest = straight_edges(g)
        octave = upscaled(g)

        notes = []
        if max(mv, mh) > 0.45:
            notes.append(f"bookmatched - crop to one half ({'left/right' if mv > mh else 'top/bottom'})")
        if max(black, white) > 0.02:
            notes.append(f"clipped {max(black, white)*100:.0f}%")
        if spec > 0.02:
            notes.append("polished - blown highlights, prefer honed")
        if blk > 1.10:
            notes.append(f"recompressed AND too small to downsample it away "
                         f"({w}px) - artifacts will land in the micro band")
        if cropped:
            notes.append("cropped off the backdrop")
        if octave is not None and octave < 0.18:
            notes.append(f"UPSCALED - top octave {octave*100:.0f}%, natives run 26-45%. "
                         f"The pixels are interpolation, not detail")
        if min(w, h) < 700:
            notes.append("small - the fine tiers will be under a pixel")
        if nlines >= 3 or longest > 0.45:
            notes.append(f"straight edges x{nlines} - slab edge, rack or a side shot; "
                         f"crop to stone only")

        print(f"{p.name[:33]:<34}{f'{w}x{h}':>12}{f'{mv:.2f}/{mh:.2f}':>13}"
              f"{f'{black*100:.1f}/{white*100:.1f}%':>13}{spec*100:>9.1f}%{blk:>7.2f}"
              f"{nlines:>6}  {'; '.join(notes) if notes else 'clean'}")

    print("\nwatermarks are not screened - look at the picture, they take a second to spot")


if __name__ == "__main__":
    main()

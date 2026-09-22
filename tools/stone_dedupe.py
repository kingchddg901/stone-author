"""How many of these layers are actually different from each other?

    python tools/stone_dedupe.py refs/*.jpg --tier major
    python tools/stone_dedupe.py refs/*.jpg --tier major --keep 0.12

A library of 557 stones is not a library of 557 STRUCTURES. Two Carraras shot
in different yards are the same kind of thing, and once a layer is a mask the
question "is this one worth keeping" has an answer rather than an opinion.

NOT PIXEL SIMILARITY. Two slabs of one marble never align pixel for pixel and
are still interchangeable; two unrelated stones can share a histogram and look
nothing alike. What decides it is the layer's STRUCTURE, so a layer is reduced
to what the tiering already measures about it:

  coverage          how much of the face it occupies
  density           components per megapixel - a few fat veins or a thousand
  width             median and spread, in log width, because gauge is
                    multiplicative - the measured minor/major ratio is 0.63
  length            median and spread of length over width, which is the
                    difference between a stroke and a dot
  direction         orientation concentration - whether it runs one way or
                    every way. This is what separates a banded Portoro from a
                    scattered breccia at the same gauge.

Distances are computed after each axis is standardised, so no axis dominates
because it happens to be measured in bigger numbers - coverage runs 0 to 1 and
density runs to thousands, and unstandardised the density would be the only
thing the answer ever depended on.

IT DOES NOT WORK YET, AND THE TEST THAT SAYS SO IS IN THE HISTORY OF THIS FILE.
Ground truth: two slabs cut from the SAME quarry stone, which nothing here
knows about. Over 20 slabs of 9 stones the nearest neighbour was the same stone
1 time in 20, against 7 in 100 by chance, and same-stone pairs sat 3.27 apart
against 3.65 for unrelated ones - an effect size of +0.33, which is nothing.

So the radius table below is reporting distances that are not measuring
structure, and any percentage read off it is a coincidence. It printed "radius
1.2 keeps 80%" on the first run, which is exactly the figure he had guessed
cold, and that agreement meant nothing at all.

THE LIKELIEST CAUSE IS A KNOWN HOLE, not a verdict on the idea: SCALE IS NEVER
NORMALISED. Every image is handed the same px_per_mm, while the slabs are
different physical sizes photographed at different distances - and the tiering
rests entirely on width IN MILLIMETRES. Two slabs of one stone shot at
different scales are sorted into different tiers before the fingerprint sees
them. The slab size is in the filename (`103x37in`) and is not wired through.
Fix that first, re-run the same-stone test, and only then believe any of it.

A FIRST TEST USED THE WRONG GROUND TRUTH and should be ignored: stones sharing
a name prefix. `azul-` is a colour and `calacatta-` spans thirty unrelated
marbles, so it was measuring nothing either way.

WHAT IT DOES NOT DO is decide. It reports which layers sit inside a radius of
each other and what the radius costs, because "unique enough to keep" is a
judgement about what reads differently at tile size, and that is his eye and
not a threshold in a file.
"""
import argparse
import pathlib
import sys

import cv2
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from stone_rip import grey, separate, crop_to_slab           # noqa: E402

AXES = ["coverage", "density", "width", "width spread", "length", "length spread", "direction"]


def fingerprint(comps, mask, shape):
    """Seven numbers that say what KIND of structure this layer is."""
    h, w = shape
    mp = (h * w) / 1e6
    if not comps:
        return None
    widths = np.log(np.array([c["width"] for c in comps]) + 1e-6)
    lens = np.log(np.array([c["length"] / max(c["width"], 1e-6) for c in comps]) + 1e-6)

    # orientation concentration, from the structure tensor. Circular, so it is
    # the resultant length of the doubled angles - 0 is every way at once, 1 is
    # one way only. Doubled because a vein at 10 degrees and one at 190 are the
    # same direction, which a plain mean would average to nothing.
    gx = cv2.Sobel(mask, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(mask, cv2.CV_32F, 0, 1, ksize=3)
    mag = np.hypot(gx, gy)
    # >=, NOT >. The mask is BINARY, so its Sobel magnitudes are quantised, and
    # on a dense mask more than 3% of pixels sit at the maximum - the 97th
    # percentile then EQUALS the max and a strict > selects nothing at all,
    # falling through to direction 0.0, which reads as "every way at once"
    # rather than as a failed measurement. Where it does select something it
    # selects a biased subset. Measured across 72 band-orientations, 58 of them
    # moved by more than 0.02 when this was corrected, several by 0.4.
    sel = mag >= np.percentile(mag, 97)
    if sel.sum() > 50:
        ang = 2 * np.arctan2(gy[sel], gx[sel])
        direction = float(np.hypot(np.cos(ang).mean(), np.sin(ang).mean()))
    else:
        direction = 0.0

    return np.array([
        float(mask.mean()),
        len(comps) / max(mp, 1e-6),
        float(np.median(widths)),
        float(widths.std()),
        float(np.median(lens)),
        float(lens.std()),
        direction,
    ])


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("images", nargs="+")
    ap.add_argument("--tier", default="major",
                    choices=["major", "minor", "subminor", "micro"])
    ap.add_argument("--size", type=int, default=768)
    ap.add_argument("--keep", type=float, default=None,
                    help="report how many survive at this radius")
    args = ap.parse_args()

    names, vecs = [], []
    for path in args.images:
        p = pathlib.Path(path)
        try:
            g, _ = crop_to_slab(grey(p))
        except SystemExit:
            continue
        if min(g.shape) < 200:
            continue
        g = cv2.resize(g, (args.size, args.size), interpolation=cv2.INTER_AREA)
        try:
            _, _, _, comps, labels, tiers, _ = separate(g, args.size / 400.0, 1.2, 18.0)
        except Exception:
            continue
        mask = tiers[args.tier].astype(np.float32)
        keep = [c for c in comps if mask[labels == c["label"]].any()]
        f = fingerprint(keep, mask, g.shape)
        if f is None or not np.isfinite(f).all():
            continue
        names.append(p.stem)
        vecs.append(f)
        print(f"  {len(names):>4}  {p.stem[:44]}", flush=True)

    if len(vecs) < 2:
        sys.exit("not enough layers to compare")
    X = np.array(vecs)
    # standardise, or density (thousands) is the only axis that ever matters
    X = (X - X.mean(0)) / (X.std(0) + 1e-9)
    D = np.linalg.norm(X[:, None, :] - X[None, :, :], axis=2)
    np.fill_diagonal(D, np.inf)

    print(f"\n{len(names)} '{args.tier}' layers, {len(AXES)} axes\n")
    print("closest pairs - these are the ones that do the same job:")
    iu = np.triu_indices(len(names), 1)
    order = np.argsort(D[iu])[:8]
    for k in order:
        i, j = iu[0][k], iu[1][k]
        print(f"  {D[i, j]:5.2f}   {names[i][:32]:<34}{names[j][:32]}")

    print("\nhow many survive, by radius:")
    for r in (0.6, 0.9, 1.2, 1.6, 2.2, 3.0):
        chosen = []
        for i in np.argsort(-X.std(1)):          # most distinctive first
            if all(D[i, j] > r for j in chosen):
                chosen.append(i)
        print(f"  radius {r:<5} keeps {len(chosen):>4} of {len(names)}"
              f"  ({len(chosen)/len(names)*100:>4.0f}%)")

    if args.keep:
        chosen = []
        for i in np.argsort(-X.std(1)):
            if all(D[i, j] > args.keep for j in chosen):
                chosen.append(i)
        print(f"\nat radius {args.keep}, keep:")
        for i in sorted(chosen, key=lambda i: names[i]):
            print(f"  {names[i]}")


if __name__ == "__main__":
    main()

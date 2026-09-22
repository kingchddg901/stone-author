"""Sweep the brightness and contrast he was setting by hand, and show the grid.

    python tools/stone_sweep.py stone.psd --mm 1200

Runs the ripper across a grid of the two adjustments he was making in an image
editor - contrast up, brightness down - and lays the results out as one sheet
to look at, with the numbers underneath.

IT DOES NOT PICK. There is no score here that says which cell is best, and that
is deliberate: the objective is what the stone looks like, and the stopping rule
on this whole project has been a side-by-side judged by his eye. A number that
claimed to rank these would be a number I invented, and the four probes this
project has already had pass by measuring their own artifacts all started as
reasonable-looking numbers.

What it DOES report per cell, because these are measurable rather than matters
of taste:

  components     how much structure crossed the threshold at all
  tier split     how that structure divided into the stone's own populations
  strokes        the share of fine features long enough to be strokes rather
                 than dots. This is the BEADING tell: a hairline vein broken by
                 the threshold turns into stubs, and stubs are dots. When this
                 climbs, veins are staying whole.
  invert         his sanity check, run on every cell for free - rip it upside
                 down and the masks must be identical. Any cell under 100 means
                 that cell's result depends on which way up the stone is, and
                 nothing else it reports can be trusted.

The adjustments are applied the way an editor does: contrast pivots about mid
grey, brightness shifts after. Doing it in the other order makes contrast
amplify the brightness shift and the grid stops being a grid.
"""
import argparse
import pathlib
import sys

import cv2
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from stone_rip import grey, separate                        # noqa: E402


def adjust(g, contrast, brightness):
    """Contrast about mid grey, then brightness - an editor's order."""
    return np.clip((g - 0.5) * contrast + 0.5 + brightness, 0, 1)


def strokes(comps):
    """The share of fine features long enough to be a stroke, not a dot.

    The beading tell. A hairline vein cut by a threshold becomes stubs, and a
    stub is a dot; when this rises, veins are surviving whole."""
    fine = [c for c in comps if c["width"] <= np.median([x["width"] for x in comps])]
    if not fine:
        return 0.0
    return sum(1 for c in fine if c["length"] >= 3.0 * c["width"]) / len(fine)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image")
    ap.add_argument("--mm", type=float, default=1200)
    ap.add_argument("--card", type=float, default=None)
    ap.add_argument("--size", type=int, default=640)
    ap.add_argument("--out", default="sweep.png")
    ap.add_argument("--contrast", default="1.0,1.4,1.8,2.2")
    ap.add_argument("--brightness", default="0.0,-0.10,-0.20")
    ap.add_argument("--show", default="major", choices=["major", "minor", "micro", "ink"])
    ap.add_argument("--raw", default=None, metavar="WxH")
    args = ap.parse_args()

    raw = tuple(int(v) for v in args.raw.lower().split("x")[:2]) if args.raw else None
    base = grey(args.image, raw)
    base = cv2.resize(base, (args.size, args.size), interpolation=cv2.INTER_AREA)
    px_per_mm = args.size / float(args.card or args.mm)

    cs = [float(v) for v in args.contrast.split(",")]
    bs = [float(v) for v in args.brightness.split(",")]

    cell, pad = args.size // 2, 34
    sheet = np.zeros((len(bs) * (cell + pad), len(cs) * cell, 3), np.uint8)
    print(f"{'contrast':>9}{'bright':>8}{'comps':>7}{'major':>7}{'minor':>7}"
          f"{'sub':>6}{'micro':>7}{'strokes':>9}{'invert':>8}")
    print("-" * 75)

    for r, b in enumerate(bs):
        for c, k in enumerate(cs):
            g = adjust(base, k, b)
            _, ink, _, comps, _, tiers, _ = separate(g, px_per_mm, 1.2, 18.0)
            # his check, on every cell: free, and it says whether to believe the row
            _, _, _, _, _, flip, _ = separate(1.0 - g, px_per_mm, 1.2, 18.0)
            # AN EMPTY TIER AGREES WITH ITSELF PERFECTLY. The first version
            # divided by max(union, 1), so a tier that neither rip populated
            # scored 0/1 = 0% - and a destructive cell is exactly where a tier
            # empties out, so the check reported FAILURES precisely where it
            # had nothing to say. On zimbabwe that was 5 of 12 cells called
            # broken when 1 was. stone_rip.py's own --check-invert has always
            # had this right; this copy did not.
            def agree(a, b):
                union = int((a | b).sum())
                return float((a & b).sum()) / union if union else 1.0
            iou = min(agree(tiers[t], flip[t]) for t in tiers)
            n = {t: int(cv2.connectedComponents(tiers[t])[0]) - 1 for t in tiers}
            print(f"{k:>9.2f}{b:>8.2f}{len(comps):>7}{n['major']:>7}{n['minor']:>7}"
                  f"{n['subminor']:>6}{n['micro']:>7}{strokes(comps)*100:>8.0f}%"
                  f"{iou*100:>7.0f}%")

            img = ink if args.show == "ink" else tiers[args.show].astype(np.float32)
            v = cv2.resize((np.clip(img, 0, 1) * 255).astype(np.uint8), (cell, cell))
            y = r * (cell + pad)
            sheet[y + pad:y + pad + cell, c * cell:(c + 1) * cell] = \
                cv2.cvtColor(v, cv2.COLOR_GRAY2BGR)
            cv2.putText(sheet, f"c{k:.1f} b{b:+.2f}", (c * cell + 6, y + 22),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (235, 235, 235), 1, cv2.LINE_AA)

    cv2.imwrite(args.out, sheet)
    print(f"\n{args.out}   showing: {args.show}")


if __name__ == "__main__":
    main()

"""Stack a harvest's masks back up. Does the stone come back?

    python tools/stone_verify.py
    python tools/stone_verify.py --band coarse --sheet out.png

HIS SUCCESS TEST, and it is the only one here that looks at the whole thing at
once: "the masks when stacked should give roughly the same shape as the base in
gray scale". Every other number in this project measures one property of one
pass. This composites what a harvest actually produced and asks whether it is
the stone.

WHAT IT COMPARES. The masks carry the photograph's own value, so stacking them
over a ground and against a vein level reconstructs a greyscale image directly.
That is compared with the source at the same working size, POLARITY CORRECTED -
a dark-veined stone's value field runs the other way, and comparing without
that flip measures the polarity convention rather than the rip.

THE CONTROL IS THE POINT. A reconstruction covering 10% of the frame correlates
with the source somewhat no matter what, because both are mostly ground. So the
same reconstruction is also scored SHIFTED by a few hundred pixels, and the
number that matters is the gap. A stone whose aligned score barely beats its
shifted score has masks in the right proportion and the wrong places.

WHAT A PASS LOOKS LIKE: aligned well above shifted. What a failure looks like:
they converge. What a SUSPICIOUS pass looks like: both very high, which means
the ground is carrying the correlation and neither is telling you about
structure - read the gap, never the absolute.
"""
import argparse
import json
import pathlib
import sys

import cv2
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from stone_rip import grey, crop_to_slab, separate  # noqa: E402

TIERS = ("major", "minor", "subminor", "micro")


def corr(a, b):
    a = (a - a.mean()).ravel()
    b = (b - b.mean()).ravel()
    n = np.linalg.norm(a) * np.linalg.norm(b)
    return float(a @ b / n) if n else 0.0


def source_at(path, short):
    g0, _ = crop_to_slab(grey(path))
    h0, w0 = g0.shape
    d = (short, int(round(short * h0 / w0))) if w0 <= h0 else (int(round(short * w0 / h0)), short)
    return np.ascontiguousarray(cv2.resize(g0, d, interpolation=cv2.INTER_AREA), np.float32)


def stack(folder, band):
    """Max-combine the tiers. MAX, not sum: tiers are disjoint by construction
    but feathering overlaps them at the edges, and summing there would push a
    boundary brighter than any vein core."""
    out = None
    for t in TIERS:
        f = folder / f"{band}-{t}.png"
        if not f.exists():
            continue
        im = cv2.imread(str(f), cv2.IMREAD_GRAYSCALE)
        if im is None:
            continue
        v = im.astype(np.float32) / 255.0
        out = v if out is None else np.maximum(out, v)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--harvest", default="C:/Users/CKing/Downloads/stone-refs/harvest")
    ap.add_argument("--targets", default="C:/Users/CKing/Downloads/stone-refs/target")
    ap.add_argument("--band", default="default", choices=["fine", "default", "coarse", "all"])
    ap.add_argument("--sheet", default=None, help="write a source/reconstruction contact sheet")
    args = ap.parse_args()

    H = pathlib.Path(args.harvest)
    T = pathlib.Path(args.targets)
    rows, panels = [], []
    for rec in sorted(H.glob("*/record.json")):
        d = json.loads(rec.read_text(encoding="utf-8"))
        src_file = next((p for p in T.glob("*") if p.stem == d["stone"]), None)
        if src_file is None:
            print(f"{d['stone']:<34}  source not found")
            continue
        g = source_at(src_file, d["short"])
        bands = TIERS and (["fine", "default", "coarse"] if args.band == "all" else [args.band])
        v = None
        for b in bands:
            s = stack(rec.parent, b)
            if s is not None:
                v = s if v is None else np.maximum(v, s)
        if v is None or v.shape != g.shape:
            print(f"{d['stone']:<34}  no masks, or {None if v is None else v.shape} != {g.shape}")
            continue

        # POLARITY FROM THE SOURCE, not from the record. Since the harvester
        # normalises the ground to zero, the recorded polarity describes the
        # NORMALISED image - where structure is always bright - so applying it
        # to the raw source skips a flip that should happen. It does not change
        # the gap (correlation is invariant under flipping one variable, and
        # ground and vein are both derived from whichever space you are in), but
        # it inverts the SOURCE PANEL of the contact sheet, which is the half a
        # person actually judges.
        lo5, hi5 = np.percentile(g, 5), np.percentile(g, 95)
        mid = float(np.median(g))
        dark_veined = (hi5 - mid) < (mid - lo5)
        tgt = (1.0 - g) if dark_veined else g
        hot = v > 0.05
        if hot.sum() < 200:
            print(f"{d['stone']:<34}  almost nothing in the masks")
            continue
        ground = float(np.median(tgt[~hot])) if (~hot).any() else 0.0
        vein = float(np.percentile(tgt[hot], 90))
        recon = ground + (vein - ground) * v

        aligned = corr(recon, tgt)
        shifted = corr(np.roll(np.roll(recon, 173, 0), 271, 1), tgt)
        rows.append((aligned - shifted, d["stone"], aligned, shifted, float(v.mean())))
        if args.sheet:
            n = 300
            a = cv2.resize((np.clip(tgt, 0, 1) * 255).astype(np.uint8), (n, n))
            b = cv2.resize((np.clip(recon, 0, 1) * 255).astype(np.uint8), (n, n))
            cell = np.vstack([a, b])
            cell = cv2.cvtColor(cell, cv2.COLOR_GRAY2BGR)
            cv2.rectangle(cell, (0, 0), (n, 18), (16, 16, 16), -1)
            cv2.putText(cell, d["stone"][:26], (4, 13), cv2.FONT_HERSHEY_SIMPLEX,
                        0.38, (235, 235, 235), 1, cv2.LINE_AA)
            panels.append(cell)

    if not rows:
        sys.exit("nothing verified")
    print(f"\nband: {args.band}   source (top) against stacked masks (bottom)\n")
    print(f"{'stone':<34}{'aligned':>9}{'shifted':>9}{'GAP':>8}{'coverage':>10}")
    print("-" * 72)
    for gap, s, a, sh, cov in sorted(rows, key=lambda r: -r[0]):
        print(f"{s[:33]:<34}{a:>9.3f}{sh:>9.3f}{gap:>8.3f}{cov*100:>9.1f}%")
    g = np.array([r[0] for r in rows])
    print(f"\n{len(rows)} stones   gap: min {g.min():.3f}  median {np.median(g):.3f}  "
          f"max {g.max():.3f}")
    print("the GAP is the result. A high aligned score with a high shifted score "
          "means the\nground is carrying it and the structure is telling you nothing.")
    if args.sheet and panels:
        cols = 8
        rowsn = (len(panels) + cols - 1) // cols
        h, w = panels[0].shape[:2]
        sheet = np.full((rowsn * h, cols * w, 3), 20, np.uint8)
        for i, c in enumerate(panels):
            y, x = divmod(i, cols)
            sheet[y * h:(y + 1) * h, x * w:(x + 1) * w] = c
        cv2.imwrite(args.sheet, sheet)
        print(f"\n{args.sheet}")


if __name__ == "__main__":
    main()

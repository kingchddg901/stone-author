"""Draw a stone from panel/stone-art.js, so its output can be looked at.

The generator emits structure and never pixels, which is what lets one stone
serve a card and a background at different densities - but it also means there
is nothing to look at without a rasteriser. This is that rasteriser, and it is
a DEV TOOL, not part of the panel: the real one is CSS mask layers.

    python tools/stone_preview.py --stone carrara --seed 7 --out preview.png
    python tools/stone_preview.py --stone carrara --cut 0.5,1.0   # lower face
    python tools/stone_preview.py --stone carrara --wander 0.4 --follow 0.8

Needs numpy and opencv-python, which the panel itself does not.

Three things here mirror decisions made in the generator, and getting them
wrong makes the stone look wrong in ways that read as bad parameters:

  DEPTH IS PAINT ORDER.  Sheets are drawn deepest first and composite OVER what
  is beneath. Blending with max() instead only brightens crossings, so depth
  stops reading as depth and becomes a second opacity knob.

  COVERAGE AND VALUE ARE SEPARATE.  "Over" needs to know where a sheet is (0..1)
  and how dark it is, as two things. Baking the value into the fill conflates
  them and the compositing goes wrong quietly.

  THE EMPTY MUST BE EMPTY.  Veiling is multiplicative: a sheet whose blank areas
  sit at 0.02 instead of 0 turns into visible fog once a few are stacked, and it
  degrades so gently that it reads as a bad palette rather than as a bug.
"""
import argparse
import json
import pathlib
import subprocess
import sys

import cv2
import numpy as np

REPO = pathlib.Path(__file__).resolve().parent.parent
W, H, SS = 430, 210, 4          # card size, and the supersample for sub-pixel widths
LEVELS = 8                      # depth sheets; a render budget, not a property of the stone

# Ground and vein colour per stone. These belong to a THEME, not to the
# generator - it emits relative contrast and says nothing about colour.
PALETTE = {
    "carrara":       ((232, 230, 226), (120, 120, 124), 34),
    "nero-marquina": ((22, 21, 21),    (236, 238, 241), 62),
    "calacatta":     ((242, 241, 238), (112, 114, 120), 42),
    "statuario":     ((243, 242, 240), (104, 106, 112), 46),
    "jade":          ((95, 117, 51),   (47, 102, 5),    44),
}


def dump(args, extra):
    cmd = ["node", str(REPO / "tools" / "stone-dump.mjs"),
           "--stone", args.stone, "--seed", str(args.seed),
           "--footprint", str(args.footprint)] + extra
    out = subprocess.run(cmd, capture_output=True, text=True, cwd=REPO)
    if out.returncode:
        sys.exit(out.stderr.strip() or "stone-dump failed")
    return json.loads(out.stdout)


def ground(bgr, seed):
    r = np.random.default_rng(seed)
    lo = cv2.GaussianBlur(r.random((H, W)).astype(np.float32), (0, 0), 22)
    lo = (lo - lo.min()) / (np.ptp(lo) + 1e-9)
    grain = cv2.GaussianBlur(r.random((H, W)).astype(np.float32), (0, 0), 0.8)
    f = 0.97 + 0.05 * lo + 0.02 * (grain - 0.5)
    return np.clip(np.array(bgr, np.float32)[None, None, :] * f[..., None], 0, 255)


def film_field(seed, lo=0.001, hi=0.009):
    """A deposit that drifts across the slab, so two cards of one stone are not
    the same picture. Softened deliberately: a straight ramp reads as a lighting
    artefact, because nothing in stone is that straight."""
    yy, xx = np.mgrid[0:H, 0:W]
    xx, yy = xx / W, yy / H
    r = np.random.default_rng(seed)
    ang, ox, oy = r.random() * 2 * np.pi, r.random(), r.random()
    t = (xx - ox) * np.cos(ang) + (yy - oy) * np.sin(ang)
    t = (t - t.min()) / (np.ptp(t) + 1e-9)
    t = cv2.GaussianBlur(t.astype(np.float32), (0, 0), 26)
    t = (t - t.min()) / (np.ptp(t) + 1e-9)
    return (lo + (hi - lo) * t).astype(np.float32)


def ribbon(points, widths, px):
    """A stroke whose width varies per vertex: offset both sides along the local
    normal and fill the polygon. A constant-thickness polyline throws the swell
    and pinch away, which is most of what makes a vein read as a fracture."""
    P = np.array([[p[0] * W * SS, p[1] * H * SS] for p in points], np.float64)
    if len(P) < 2:
        return None
    d = np.gradient(P, axis=0)
    L = np.hypot(d[:, 0], d[:, 1])
    L[L < 1e-9] = 1e-9
    n = np.stack([-d[:, 1] / L, d[:, 0] / L], 1)
    half = (np.array(widths, np.float64) * px * SS / 2.0)[:, None]
    return np.round(np.vstack([P + n * half, (P - n * half)[::-1]])).astype(np.int32)


def poly_of(v):
    if v.get("closed"):          # a crystal is a filled silhouette, not a stroke
        return np.round(np.array([[p[0] * W * SS, p[1] * H * SS]
                                  for p in v["points"]])).astype(np.int32)
    return ribbon(v["points"], v["widths"], v["px"])


def render(block, cut=None, film=0.0, film_seed=11):
    gb, vb, base = PALETTE.get(block["stone"], PALETTE["carrara"])
    img = ground(gb, abs(hash(block["stone"])) % 9999)
    F = film_field(film_seed) if film else None

    lo, hi = cut if cut else (0.0, 1.0)
    sheets = {}
    for v in block["veins"]:
        d = v.get("depth") or 0.0
        if d < lo or d > hi:
            continue
        sheets.setdefault(min(LEVELS - 1, int(d * LEVELS)), []).append(v)

    acc = np.zeros((H, W), np.float32)
    for level in sorted(sheets, reverse=True):          # deepest first
        cover = np.zeros((H * SS, W * SS), np.float32)
        value = np.zeros_like(cover)
        for v in sheets[level]:
            poly = poly_of(v)
            if poly is None:
                continue
            t = np.zeros_like(cover)
            cv2.fillPoly(t, [poly], 1.0, cv2.LINE_AA)
            b = round(v["blur"] * 2) / 2
            if b > 0:
                t = cv2.GaussianBlur(t, (0, 0), max(0.3, b * SS))
            np.maximum(cover, t, out=cover)
            np.maximum(value, t * float(v["achieved"]), out=value)
        c = np.clip(cv2.resize(cover, (W, H), interpolation=cv2.INTER_AREA), 0, 1)
        d = cv2.resize(value, (W, H), interpolation=cv2.INTER_AREA)
        acc = acc * (1 - c) + d                          # over, not max
        if F is not None:
            # film is carried BY the sheet, so shallower veins cover it
            above = max(0, level - int(lo * LEVELS))
            f = F * above * film
            acc = acc * (1 - f) + f

    a = np.clip(acc * base / 100.0, 0, 1)[..., None]
    return np.clip(img * (1 - a) + np.array(vb, np.float32)[None, None, :] * a,
                   0, 255).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--stone", default="carrara")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--footprint", type=float, default=400,
                    help="mm of stone across the card; bigger = more compressed")
    ap.add_argument("--cut", default=None,
                    help="depth window, e.g. 0.5,1.0 for the lower face of the block")
    ap.add_argument("--film", type=float, default=0.0,
                    help="deposit rate per sheet; 0.005 is a faint body, 0.03 is fog")
    ap.add_argument("--out", default="stone-preview.png")
    args, extra = ap.parse_known_args()

    block = dump(args, extra)
    cut = tuple(float(x) for x in args.cut.split(",")) if args.cut else None
    img = render(block, cut=cut, film=args.film)
    cv2.imwrite(args.out, img)

    kept = sum(1 for v in block["veins"]
               if not cut or cut[0] <= (v.get("depth") or 0) <= cut[1])
    tiers = {}
    for v in block["veins"]:
        tiers[v["tier"]] = tiers.get(v["tier"], 0) + 1
    print(f"{args.out}  {args.stone} seed {args.seed} @ {args.footprint:.0f}mm"
          f"  {kept}/{len(block['veins'])} features"
          f"  ({', '.join(f'{k} {n}' for k, n in sorted(tiers.items()))})")
    if block["overrides"]:
        print(f"  overrides: {block['overrides']}")


if __name__ == "__main__":
    main()

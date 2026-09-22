"""Harvest a set of masters: every band, every tier, traced to paths.

    python tools/stone_harvest.py --jobs 8
    python tools/stone_harvest.py --targets D:/picks --short 900 --jobs 4

Runs the whole rip over a folder of chosen stones and writes, per stone, the
masks it found and the centreline paths they trace to. Unattended and
resumable: a stone whose record already exists is skipped, so an interrupted
run continues where it stopped.

ONE WORKER PER STONE. There is no judgement anywhere in this loop - it is the
same deterministic pipeline applied N times - so the parallelism that helps is
a process pool and nothing smarter.

THREE BANDS, NOT ONE. `fine` and `coarse` were held at 1.2/18.0 in every call
for a whole session, and measured afterwards that band is a CHOICE with the
same standing as a tonal adjustment: on bardiglio-nuvolato and
woodgrain-athens-2 a coarse 2.5/40 pass returns structure that sits FURTHER
from the default band's than a random shift of the same mask would - 26.7% and
28.9% inside a dilated default against controls of 36.0% and 48.6%. It is not
finding the same veins from another angle, it is finding what the default band
never looks at. On african-st-laurent and vanta-black the same coarse pass is
99%+ inside the default and adds nothing but double counting, so which bands a
stone wants is per stone and the point of harvesting all three is to find out.

WHAT IT DOES NOT DO is merge the bands. Overlapping harvests are collapsed by
eye, not by a rule - "take these layers that contain the structure you want,
collapse that down to a single layer" - so this writes each pass separately and
records how much of each is new.

THE TRACER took three fixes to stop measuring itself, and all three are here:
junctions found by CROSSING NUMBER rather than neighbour count (a diagonal
staircase pixel has three neighbours and is not a fork), walking BOTH ways from
the start, and DRAINING each component rather than walking it once. Coverage is
then 100% by construction. The first two versions covered 48.3% and 66.7% and
both looked fine, because a trace that never held the network does not respond
to simplification tolerance - which is the tell to watch in the output.

No skimage, no scipy, no cv2.ximgproc in this environment, so Zhang-Suen
thinning and Douglas-Peucker are written out below.
"""
import argparse
import json
import pathlib
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed

import cv2
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from stone_rip import grey, crop_to_slab, separate, flat_field, cloud_field  # noqa: E402

BANDS = (("fine", 0.6, 6.0), ("default", 1.2, 18.0), ("coarse", 2.5, 40.0))
N8 = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]
WALK = ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1))


def _nb(img):
    return [np.roll(np.roll(img, dy, 0), dx, 1) for dy, dx in N8]


def thin(img):
    """Zhang-Suen, vectorised, to a fixed point."""
    im = (img > 0).astype(np.uint8).copy()
    im[0, :] = im[-1, :] = im[:, 0] = im[:, -1] = 0
    while True:
        removed = 0
        for step in (0, 1):
            P = _nb(im)
            B = sum(P)
            seq = P + [P[0]]
            A = sum(((seq[i] == 0) & (seq[i + 1] == 1)).astype(np.uint8) for i in range(8))
            if step == 0:
                c1, c2 = (P[0] * P[2] * P[4] == 0), (P[2] * P[4] * P[6] == 0)
            else:
                c1, c2 = (P[0] * P[2] * P[6] == 0), (P[0] * P[4] * P[6] == 0)
            kill = (im == 1) & (B >= 2) & (B <= 6) & (A == 1) & c1 & c2
            k = int(kill.sum())
            if k:
                im[kill] = 0
                removed += k
        if not removed:
            return im


def crossing(skel):
    """Zhang-Suen's A(): 1 at an endpoint, 2 along any run however it
    staircases, >=3 only at a real fork. Counting neighbours instead shreds
    straight diagonal runs into false junctions and loses most of a skeleton."""
    P = _nb(skel)
    seq = P + [P[0]]
    return sum(((seq[i] == 0) & (seq[i + 1] == 1)).astype(np.uint8) for i in range(8)) * skel


def paths_from(skel):
    """Break at true junctions, DRAIN each remaining component, keep junctions."""
    nodes = (crossing(skel) >= 3) & (skel > 0)
    seg = skel.copy()
    seg[nodes] = 0
    n, lab = cv2.connectedComponents(seg, 8)
    out = []
    for i in range(1, n):
        ys, xs = np.where(lab == i)
        pts = set(zip(ys.tolist(), xs.tolist()))
        if not pts:
            continue
        deg = {q: sum(((q[0] + dy, q[1] + dx) in pts) for dy, dx in N8) for q in pts}
        ends = [q for q, k in deg.items() if k <= 1]
        start = ends[0] if ends else next(iter(pts))
        seen = {start}

        def walk(frm):
            run, cur = [], frm
            while True:
                nxt = None
                for dy, dx in WALK:
                    q = (cur[0] + dy, cur[1] + dx)
                    if q in pts and q not in seen:
                        nxt = q
                        break
                if nxt is None:
                    return run
                run.append(nxt)
                seen.add(nxt)
                cur = nxt

        while True:
            # walk() MUTATES seen, so each direction is walked exactly once and
            # its result kept. Calling it and discarding the return consumes a
            # direction silently - which is the 66.7%-coverage bug, reintroduced
            # by a careless edit and caught only by reading it again.
            back = walk(start)
            fwd = walk(start)
            order = back[::-1] + [start] + fwd
            # >= 1, not >= 2. An isolated skeleton pixel is a dot and still
            # belongs to the layer; dropping it is why skeleton_covered came
            # back at 0.9956 median instead of the 1.0 this is supposed to
            # guarantee, worst 0.8674, and every worst case was the minor tier
            # where fragments are smallest.
            if len(order) >= 1:
                out.append(np.array(order, np.int32))
            left = pts - seen
            if not left:
                break
            start = next(iter(left))
            seen.add(start)
    return out, nodes


def dp(pts, tol):
    """Douglas-Peucker, iterative - a long vein must not blow the stack."""
    keep = np.zeros(len(pts), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        p, q = pts[a].astype(np.float64), pts[b].astype(np.float64)
        v = q - p
        L = float(np.hypot(*v))
        seg = pts[a + 1:b].astype(np.float64)
        if L < 1e-6:
            d = np.hypot(*(seg - p).T)
        else:
            d = np.abs(v[1] * (seg[:, 0] - p[0]) - v[0] * (seg[:, 1] - p[1])) / L
        i = int(np.argmax(d))
        if d[i] > tol:
            k = a + 1 + i
            keep[k] = True
            stack += [(a, k), (k, b)]
    return pts[keep]


def agree(a, b):
    """An empty tier agrees with itself. Dividing by max(union, 1) scores two
    empty masks 0%, and a destructive pass is exactly where a tier empties."""
    u = int((a | b).sum())
    return float((a & b).sum()) / u if u else 1.0


def direction_field(g, sig_frac=0.055, cells=32):
    """The fold geometry, as a small grid of angles.

    Ripped rather than invented: a field built from a noise gradient is full of
    vortices and renders as eddies, while real foliation is sheared rock and has
    almost none. It is also nearly free - it varies so slowly that a 32x32 grid
    holds it."""
    b = cv2.GaussianBlur(g, (0, 0), 0.006 * min(g.shape))
    gx = cv2.Sobel(b, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(b, cv2.CV_32F, 0, 1, ksize=3)
    sg = sig_frac * min(g.shape)
    Jxx = cv2.GaussianBlur(gx * gx, (0, 0), sg)
    Jyy = cv2.GaussianBlur(gy * gy, (0, 0), sg)
    Jxy = cv2.GaussianBlur(gx * gy, (0, 0), sg)
    th = 0.5 * np.arctan2(2 * Jxy, Jxx - Jyy) + np.pi / 2
    small = cv2.resize(np.stack([np.cos(2 * th), np.sin(2 * th)], -1).astype(np.float32),
                       (cells, cells), interpolation=cv2.INTER_AREA)
    return (0.5 * np.arctan2(small[..., 1], small[..., 0])).astype(np.float32)


def orientation(mask):
    """Concentration of doubled gradient angles. Guarded - an unguarded version
    returned nan on an isotropic stone and the nan propagated into a table."""
    f = mask.astype(np.float32)
    gx = cv2.Sobel(f, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(f, cv2.CV_32F, 0, 1, ksize=3)
    mag = np.hypot(gx, gy)
    if not np.isfinite(mag).any() or mag.max() <= 0:
        return 0.0
    # >=, NOT >. A binary mask's Sobel magnitudes are quantised, and on a dense
    # mask more than 3% of pixels sit at the maximum - so the 97th percentile
    # EQUALS the max and a strict > selects nothing. The guard below then fired
    # and returned 0.000, which reads as "perfectly isotropic" rather than as a
    # failed measurement. Five stones in the first harvest reported 0.000 that
    # way. A guard that converts a crash into a plausible wrong number is worse
    # than the crash.
    sel = mag >= np.percentile(mag, 97)
    if sel.sum() < 50:
        return 0.0
    a = 2 * np.arctan2(gy[sel], gx[sel])
    return float(np.hypot(np.cos(a).mean(), np.sin(a).mean()))


def harvest(path, out_dir, short, tol):
    """One stone, every band. Returns a record; writes masks and traces."""
    p = pathlib.Path(path)
    t0 = time.time()
    g0, _ = crop_to_slab(grey(p))
    h0, w0 = g0.shape
    # SHORT edge, not long. Computing the other way silently halves the working
    # size on a portrait slab, which is how a whole screening table once ran at
    # half the resolution it claimed.
    if w0 <= h0:
        dsize = (short, int(round(short * h0 / w0)))
    else:
        dsize = (int(round(short * w0 / h0)), short)
    g = np.ascontiguousarray(cv2.resize(g0, dsize, interpolation=cv2.INTER_AREA), np.float32)
    H, W = g.shape
    rec = {"stone": p.stem, "source": f"{w0}x{h0}", "working": f"{W}x{H}",
           "short": short, "bands": {}}

    # GROUND TO ZERO, ONCE PER STONE. Another destructive pass in his sense -
    # it throws away 43-47% of the frame, everything BRIGHTER than ground, and
    # that costs nothing because on a dark-veined stone everything above ground
    # IS ground. There is no structure up there to lose.
    #
    # It is not merely a fairer comparison, it is a better RIP. Measured:
    # grey-wave 4585 -> 6445 components and coverage 8.36% -> 11.44%, velvet-
    # grey-2 3296 -> 4670 and 9.71% -> 14.15%, amber-grey 1231 -> 1446. And the
    # stacked-mask gap rises with it - +0.04 to +0.14 on the pale stones - which
    # is what says the extra coverage is real structure and not noise, since
    # noise would raise coverage and lower the gap.
    #
    # Dark stones are untouched (+/-0.015) and african-st-laurent clips 0.0%,
    # because bright-veins-on-black is ALREADY in this form. That is why it was
    # scoring 0.956 while its pale neighbours sat at 0.45.
    #
    # Once per stone, not once per band: the ground is a property of the stone.
    # NB: not `t0` - that is the start time, and shadowing it turns the elapsed
    # calculation into float-minus-dict at the very end of a long function.
    _, _, pol0, _, _, tiers0, _ = separate(g, short / 1200.0, 1.2, 18.0)
    s0 = np.zeros(g.shape, np.uint8)
    for t in tiers0:
        s0 |= tiers0[t]
    if s0.any() and (~(s0 > 0)).any():
        ground = float(np.median(g[s0 == 0]))
        peak = float(np.percentile(g[s0 > 0], 1 if pol0 < 0 else 99))
        if abs(peak - ground) > 0.02:
            scaled = (g - ground) / (peak - ground)
            # what was actually CLAMPED - outside 0..1 before the clip. Counting
            # pixels AT zero afterwards is a different thing entirely: african-
            # st-laurent's ground IS zero, so that reads 56% "clipped" on a
            # stone the normalisation does not touch.
            rec["normalised"] = {
                "ground": round(ground, 4), "peak": round(peak, 4),
                "clamped_low": round(float((scaled < 0).mean()), 4),
                "clamped_high": round(float((scaled > 1).mean()), 4)}
            g = np.clip(scaled, 0, 1).astype(np.float32)
        else:
            rec["normalised"] = None      # nothing to stretch; leave it alone
    else:
        rec["normalised"] = None

    stem = out_dir / p.stem
    stem.mkdir(parents=True, exist_ok=True)
    field = direction_field(g)
    np.save(stem / "direction-field.npy", field)
    rec["direction_field_cells"] = list(field.shape)

    cl = cloud_field(flat_field(g))
    masks = {}
    for tag, fine, coarse in BANDS:
        _, ink, pol, comps, labels, tiers, value = separate(g, short / 1200.0, fine, coarse)
        s = np.zeros(g.shape, np.uint8)
        for t in tiers:
            s |= tiers[t]
        masks[tag] = s
        # WHICH VEIN. separate() already computes this and it was being thrown
        # away at the end. A raster mask supports per-vein selection through a
        # contiguous wand EXCEPT where veins cross, and on a cross-hatch that is
        # most of them - an id map is what makes `label == 47` one vein through
        # three crossings. 16-bit: the densest band measured 8622 components.
        lab16 = np.clip(labels, 0, 65535).astype(np.uint16) * (s > 0)
        cv2.imwrite(str(stem / f"{tag}-labels.png"), lab16)
        rec.setdefault("label_max", {})[tag] = int(lab16.max())
        _, _, _, _, _, flip, _ = separate(1.0 - g, short / 1200.0, fine, coarse)
        inv = min(agree(tiers[t], flip[t]) for t in tiers)
        smear = cv2.GaussianBlur((value * (s > 0)).astype(np.float32), (0, 0), 0.045 * min(H, W))
        a = (smear - smear.mean()).ravel()
        b = (cl - cl.mean()).ravel()
        cc = float(abs(a @ b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))
        band = {"fine": fine, "coarse": coarse, "components": len(comps),
                "coverage": round(float(s.mean()), 5),
                "invert_iou": round(inv, 4),
                "value_pinned": round(float((value[s > 0] >= 0.999).mean()) if s.any() else 0.0, 4),
                "polarity": "dark" if pol < 0 else "light",
                "orientation": round(orientation(s), 4),
                "cloud_from_structure": round(cc, 4),
                "tiers": {}}
        for t, m in tiers.items():
            cv2.imwrite(str(stem / f"{tag}-{t}.png"),
                        (np.clip(value * (m > 0), 0, 1) * 255).astype(np.uint8))
            entry = {"px": int(m.sum()), "coverage": round(float(m.mean()), 5)}
            if m.sum() >= 400 and t in ("major", "minor"):
                skel = thin(m)
                dist = cv2.distanceTransform(m, cv2.DIST_L2, 5)
                paths, nodes = paths_from(skel)
                traced = sum(len(q) for q in paths) + int(nodes.sum())
                simp = []
                for q in paths:
                    r = dp(q, tol) if tol > 0 else q
                    w = dist[r[:, 0], r[:, 1]]
                    simp.append([[int(y), int(x), round(float(v), 2)]
                                 for (y, x), v in zip(r, w)])
                entry.update({
                    "skeleton_px": int(skel.sum()),
                    "skeleton_covered": round(traced / max(int(skel.sum()), 1), 4),
                    "paths": len(paths),
                    "points": sum(len(q) for q in simp),
                    "points_per_1k_mask_px": round(sum(len(q) for q in simp) / max(m.sum() / 1000, 1e-9), 2),
                })
                (stem / f"{tag}-{t}-paths.json").write_text(
                    json.dumps({"tolerance": tol, "paths": simp}), encoding="utf-8")

                # HOW FAR ALONG. A glow travelling down a vein needs position
                # on its own centreline, and the traced walk is already that
                # walk - t is the index, normalised, and then carried out to
                # the full width of the vein by nearest centreline pixel.
                # Junction pixels are NOT seeded: they belong to no single path,
                # so letting the nearest path pixel win keeps t continuous
                # through a crossing instead of punching a hole in it.
                tseed = np.zeros(m.shape, np.float32)
                onpath = np.zeros(m.shape, np.uint8)
                for q in paths:
                    n_q = len(q)
                    tv = (np.arange(n_q, dtype=np.float32) / (n_q - 1)) if n_q > 1                         else np.array([0.5], np.float32)
                    tseed[q[:, 0], q[:, 1]] = tv
                    onpath[q[:, 0], q[:, 1]] = 1
                if onpath.any():
                    _, near = cv2.distanceTransformWithLabels(
                        (onpath == 0).astype(np.uint8), cv2.DIST_L2, 5,
                        labelType=cv2.DIST_LABEL_PIXEL)
                    ys, xs = np.where(onpath > 0)
                    lut = np.zeros(int(near.max()) + 1, np.float32)
                    lut[near[ys, xs]] = tseed[ys, xs]
                    tmap = lut[near] * (m > 0)
                    cv2.imwrite(str(stem / f"{tag}-{t}-t.png"),
                                (np.clip(tmap, 0, 1) * 65535).astype(np.uint16))
            band["tiers"][t] = entry
        rec["bands"][tag] = band

    d = masks["default"]
    dil = cv2.dilate(d, np.ones((17, 17), np.uint8))
    for tag in ("fine", "coarse"):
        m = masks[tag]
        sh = np.roll(np.roll(m, 137, 0), 211, 1)
        rec["bands"][tag]["inside_dilated_default"] = round(
            float((m & dil).sum()) / max(int(m.sum()), 1), 4)
        rec["bands"][tag]["shifted_control"] = round(
            float((sh & dil).sum()) / max(int(sh.sum()), 1), 4)
    rec["seconds"] = round(time.time() - t0, 1)
    (stem / "record.json").write_text(json.dumps(rec, indent=2), encoding="utf-8")
    return rec


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--targets", default="C:/Users/CKing/Downloads/stone-refs/target")
    ap.add_argument("--list", default=None,
                    help="a file of image paths, one per line, INSTEAD of --targets. Lets a "
                         "few hundred stones be harvested where they already live rather than "
                         "copying a gigabyte of them into a folder to be globbed.")
    ap.add_argument("--out", default="C:/Users/CKing/Downloads/stone-refs/harvest")
    ap.add_argument("--short", type=int, default=900,
                    help="working SHORT edge. 900 keeps 508 of 556 heroes without upscaling")
    ap.add_argument("--tol", type=float, default=1.0, help="Douglas-Peucker tolerance, px")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--redo", action="store_true", help="re-harvest stones already done")
    args = ap.parse_args()

    src = pathlib.Path(args.targets)
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    if args.list:
        files = [pathlib.Path(l.strip()) for l in
                 pathlib.Path(args.list).read_text(encoding="utf-8").splitlines() if l.strip()]
        missing = [f for f in files if not f.exists()]
        if missing:
            sys.exit(f"{len(missing)} listed files do not exist, first: {missing[0]}")
    else:
        files = sorted(src.glob("*.jpg")) + sorted(src.glob("*.png"))
    todo = [p for p in files
            if args.redo or not (out / p.stem / "record.json").exists()]
    print(f"{len(files)} stones, {len(todo)} to harvest, {args.jobs} workers, "
          f"short edge {args.short}\n", flush=True)
    if not todo:
        return

    done = []
    with ProcessPoolExecutor(max_workers=args.jobs) as ex:
        futs = {ex.submit(harvest, str(p), out, args.short, args.tol): p for p in todo}
        for i, f in enumerate(as_completed(futs), 1):
            p = futs[f]
            try:
                rec = f.result()
            except Exception as e:
                print(f"[{i}/{len(todo)}] {p.stem:<34} FAILED  {type(e).__name__}: {e}",
                      flush=True)
                continue
            done.append(rec)
            d = rec["bands"]["default"]
            print(f"[{i}/{len(todo)}] {rec['stone']:<34}{rec['working']:>10}  "
                  f"{d['components']:>5} comps  invert {d['invert_iou']*100:>3.0f}%  "
                  f"{rec['seconds']:>6.0f}s", flush=True)

    if not done:
        return
    print(f"\n{'stone':<30}{'band':<9}{'comps':>7}{'invert':>8}{'orient':>8}"
          f"{'cloud':>7}{'new vs default':>16}")
    print("-" * 92)
    for rec in sorted(done, key=lambda r: r["stone"]):
        for tag in ("fine", "default", "coarse"):
            b = rec["bands"][tag]
            if tag == "default":
                new = "-"
            else:
                # below the shifted control means it lands FURTHER from the
                # default band than chance - genuinely elsewhere, not the same
                # veins seen from another angle
                ins, ctrl = b["inside_dilated_default"], b["shifted_control"]
                new = f"{ins*100:.0f}% in ({ctrl*100:.0f}% by chance)"
            print(f"{rec['stone'][:29]:<30}{tag:<9}{b['components']:>7}"
                  f"{b['invert_iou']*100:>7.0f}%{b['orientation']:>8.3f}"
                  f"{b['cloud_from_structure']:>7.3f}{new:>16}")
    (out / "summary.json").write_text(json.dumps(done, indent=2), encoding="utf-8")
    print(f"\n{len(done)} harvested -> {out}")


if __name__ == "__main__":
    main()

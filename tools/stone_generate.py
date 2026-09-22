"""Generate stone as independent layers, not one coherent stone.

    python tools/stone_generate.py --out generated/ --seed 7
    python tools/stone_generate.py --out generated/ --onset 2.4 --pull 0.6
    python tools/stone_generate.py --out generated/ --pour 2500        # banded
    python tools/stone_generate.py --out generated/ --pour 3000 --pour-json strokes.json
    python tools/stone_generate.py --self-test

A NON-ZERO STARTER, in his words - "It doesn't look bad as pseudo. Marble
general line thickness and raggedness would do a lot of others. Then, we can
train it from actual paths." The parameters here are set by eye and are meant
to be REPLACED by values read out of harvested paths, not tuned forever.

WHY LAYERS. The old generator (panel/stone-art.js) tried to author a whole stone
in one pass, and most of its machinery - the spring, chord aiming, branching,
origins, arrest, nucleation - existed to make one part agree with another. A
layer does not have to agree with anything. The layers know nothing about each
other except one DIRECTION that L2 and L4 read off L1, the cheap version of every
layer sharing a fabric.

EACH LAYER IS A DIFFERENT PHYSICAL PROCESS, his geology:
  L1  deformed original layering. PSEUDOFRACTAL - it follows the fold, so it is
      smooth at large scale and rough only up close.
  L2  fractures or inclusions. A TRUE FRACTAL - fracture networks are rough at
      every scale - and it follows L1's flow, "mostly".
  L3  crystalline inclusions. Small, irregular, lightly clustered toward L1.
  L4  a POUR, off unless --pour > 0. Specks thrown along sketched lines the way
      paint leaves a stick: at a steady rate in TIME, so where the hand slows the
      line pools and where it hurries it thins, a held point spreads into a
      puddle, and a fast tight bend flings drops along the tangent - outside the
      curve. The default sketch is BANDING: long strokes along L1's flow with a
      slow speed profile, so each band swells and thins along its length.
      Measured on mercury-light, whose speck density varies 1.72x a random
      scatter's ACROSS its grain and 0.99x ALONG it: plain noise with a density
      envelope, nothing else. L4's specks are L3's, only placed, so a band is
      density and not a new kind of mark. --pour-json takes drawn strokes
      instead - {"strokes": [[[x, y, t], ...], ...]}, x and y in frame widths,
      t in seconds.

WHAT EACH EARLIER VERSION GOT WRONG, because the fix is the reason for the code:
  - one roughness at every scale on L1 read as LIGHTNING. That was fracture
    statistics on the wrong layer; `onset` delays the roughness instead.
  - an even Voronoi web read as CRACKLE GLAZE. Cells are now seeded from a slow
    density field, so big panes sit next to small ones.
  - L1 width at +-40% wandering every 2% of the line made veins BEAD. It now
    swells and pinches 0.8-1.2x over the run.
  - the remaining fuzz on a vein is PATH roughness, not width. Shown by drawing
    the same paths two ways: removing the width jitter left the fuzz exactly
    where it was. The knob for it is `onset`.

OUTPUT is L1.png, L2.png, L3.png (and L4.png when poured) as 8-bit greyscale
VALUE masks - a core and a shoulder, never a flat fill - in the same form
stone_harvest writes, so a generated layer and a ripped one are interchangeable
downstream. Plus preview.png, three grounds stacked, for looking.

TO TRAIN IT: every harvested `<band>-<tier>-paths.json` holds [y, x, half-width]
per point. Thickness is the half-width column. Raggedness is the centreline's
power spectrum - straight in log-log is a true fractal, a bend is pseudofractal,
and WHERE it bends is `onset`.
"""
import argparse
import json
import math
import pathlib
import sys

import cv2
import numpy as np

SS = 3   # draw at 3x and downsample: real anti-aliasing, not a blurred edge


def smooth1d(n, scale, rng):
    """A slow random process along a path, unit variance."""
    k = max(3, int(scale))
    v = rng.normal(size=n + 2 * k)
    v = np.convolve(v, np.ones(k) / k, mode="same")[k:k + n]
    return (v - v.mean()) / (v.std() + 1e-9)


def pseudofractal(p0, p1, depth, rough, rng, onset=1.6):
    """Midpoint displacement with roughness that RISES with depth: ~0 at the
    coarse passes, `rough` at the finest. onset=0 is a true fractal."""
    pts = [np.array(p0, float), np.array(p1, float)]
    for d in range(depth):
        r = rough * ((d + 1) / depth) ** onset
        nxt = [pts[0]]
        for a, b in zip(pts[:-1], pts[1:]):
            seg = b - a
            L = float(np.hypot(*seg)) + 1e-9
            perp = np.array([-seg[1], seg[0]]) / L
            nxt += [(a + b) / 2 + perp * rng.normal() * L * r, b]
        pts = nxt
    return np.array(pts)


def run_width(n, rng, swing):
    """Swells and pinches over the RUN, held inside +-swing of its gauge.
    Smoothed over a third of the line - not the ~10 segments that beaded it."""
    v = smooth1d(n, max(6, n // 3), rng)
    return 1 + swing * v / (np.abs(v).max() + 1e-9)


def jitter_width(n, rng, var=0.5):
    """Faster, looser width for the web - fractures do not keep a gauge."""
    return np.clip(1 + var * smooth1d(n, 10, rng), 0.25, 2.0)


def draw(canvas, pts, w, keep):
    for i in range(len(pts) - 1):
        if keep[i]:
            a = tuple(int(v * SS) for v in pts[i])
            b = tuple(int(v * SS) for v in pts[i + 1])
            cv2.line(canvas, a, b, 1.0, max(1, int(round(w[i] * SS))), cv2.LINE_AA)


def gaps(n, rng, frac):
    """Breaks come in RUNS: a threshold on a slow process. A break every other
    segment reads as dashes, and never breaking reads as ink."""
    if frac <= 0:
        return np.ones(n, bool)
    g = smooth1d(n, 14, rng)
    return g > np.quantile(g, frac)


def finish(big, size, core, shoulder):
    """Downsample, then a core and a shoulder instead of an edge."""
    small = cv2.resize(big, (size, size), interpolation=cv2.INTER_AREA)
    v = np.clip(cv2.GaussianBlur(small, (0, 0), core) * 0.85
                + cv2.GaussianBlur(small, (0, 0), shoulder) * 0.45, 0, 1)
    return (v / max(float(v.max()), 1e-6)).astype(np.float32)


def flow_of(mask):
    """Dominant direction of a layer, from its structure tensor. The gradient
    runs ACROSS a vein, so the vein runs at right angles to it."""
    b = cv2.GaussianBlur(mask.astype(np.float32), (0, 0), 6)
    gx = cv2.Sobel(b, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(b, cv2.CV_32F, 0, 1, ksize=3)
    th = 0.5 * np.arctan2(2 * float((gx * gy).sum()),
                          float((gx * gx).sum() - (gy * gy).sum()))
    return th + np.pi / 2


def layer1(rng, size, mains=5, rough=0.30, onset=1.6, width=5.5, swing=0.20, breaks=0.18):
    big = np.zeros((size * SS, size * SS), np.float32)
    base = rng.uniform(0, np.pi)
    for _ in range(mains):
        ang = base + rng.normal() * 0.30          # a shared tendency, not a grid
        c = rng.uniform(0.1, 0.9, 2) * size
        d = np.array([np.cos(ang), np.sin(ang)]) * size * 0.85
        main = pseudofractal(c - d, c + d, 8, rough, rng, onset)
        n = len(main) - 1
        draw(big, main, width * run_width(n, rng, swing), gaps(n, rng, breaks))
        for _ in range(int(rng.integers(2, 5))):
            i = int(rng.integers(len(main) // 5, 4 * len(main) // 5))
            a2 = ang + rng.choice([-1, 1]) * rng.uniform(0.25, 0.7)
            end = main[i] + np.array([np.cos(a2), np.sin(a2)]) * rng.uniform(0.12, 0.35) * size
            br = pseudofractal(main[i], end, 7, rough, rng, onset)
            m = len(br) - 1
            draw(big, br, width * 0.5 * run_width(m, rng, swing), gaps(m, rng, breaks))
    return finish(big, size, 0.9, 3.2)


def layer2(rng, size, l1, cells=85, rough=0.16, width=1.1, stretch=2.0):
    """Voronoi in a frame stretched along L1's flow, with VARIED cell density."""
    th = flow_of(l1 > 0.2)
    dens = cv2.GaussianBlur(rng.normal(size=(size, size)).astype(np.float32), (0, 0), size * 0.12)
    dens = (dens - dens.min()) / (float(np.ptp(dens)) + 1e-9)
    seeds = []
    while len(seeds) < cells:
        p = rng.uniform(-60, size + 60, 2)
        x, y = int(np.clip(p[0], 0, size - 1)), int(np.clip(p[1], 0, size - 1))
        if rng.random() < 0.15 + 0.85 * dens[y, x]:
            seeds.append(p)
    c, s = np.cos(th), np.sin(th)
    R = np.array([[c, s], [-s, c]])
    ctr = np.array([size / 2, size / 2])
    q = (np.array(seeds) - ctr) @ R.T
    q[:, 0] /= stretch                              # compress along flow, Voronoi, then
    lo, hi = q.min(0) - 400, q.max(0) + 400         # expand back: cells come out stretched
    sub = cv2.Subdiv2D((int(lo[0]), int(lo[1]), int(hi[0] - lo[0]), int(hi[1] - lo[1])))
    for p in q:
        sub.insert((float(p[0]), float(p[1])))
    facets, _ = sub.getVoronoiFacetList([])
    big = np.zeros((size * SS, size * SS), np.float32)
    seen = set()
    for f in facets:
        f = np.array(f, float)
        f[:, 0] *= stretch
        f = np.clip(f @ R + ctr, -80, size + 80)
        for a, b in zip(f, np.roll(f, -1, axis=0)):
            key = tuple(sorted((tuple(np.round(a)), tuple(np.round(b)))))
            if key in seen:
                continue
            seen.add(key)
            e = pseudofractal(a, b, 5, rough, rng, onset=0.0)   # TRUE fractal
            n = len(e) - 1
            draw(big, e, width * jitter_width(n, rng), gaps(n, rng, 0.08))
    return finish(big, size, 0.6, 1.8), float(th)


def layer3(rng, size, l1, count=2600, grain=1.6, pull=0.35):
    """Crystalline, small, lightly clustered toward L1 - "a preference", so
    light on purpose. At pull 0.35 it measures 1.2-1.4x denser near L1 depending
    on size and seed, against the ~1.07x a uniform scatter shows by chance: real,
    and below perception."""
    near = cv2.GaussianBlur(l1.astype(np.float32), (0, 0), size * 0.04)
    near = near / (near.max() + 1e-9)
    patch = cv2.GaussianBlur(rng.normal(size=(size, size)).astype(np.float32), (0, 0), size * 0.06)
    patch = (patch - patch.min()) / (float(np.ptp(patch)) + 1e-9)
    dens = (1 - pull) * 0.55 + pull * near + 0.45 * (1 - pull) * patch
    dens = dens / dens.max()
    big = np.zeros((size * SS, size * SS), np.float32)
    placed = 0
    while placed < count:
        c = rng.uniform(0, size, 2)
        if rng.random() > dens[int(c[1]) % size, int(c[0]) % size]:
            continue
        placed += 1
        k = int(rng.integers(4, 7))
        r = grain * np.exp(rng.normal(0, 0.45))     # lognormal: a long tail
        ang = rng.uniform(0, 2 * np.pi) + np.arange(k) * 2 * np.pi / k
        rr = r * (1 + rng.uniform(-0.35, 0.35, k))
        sq = rng.uniform(0.6, 1.0)
        pts = np.stack([c[0] + np.cos(ang) * rr, c[1] + np.sin(ang) * rr * sq], 1)
        cv2.fillPoly(big, [np.round(pts * SS).astype(np.int32)],
                     float(rng.uniform(0.35, 1.0)), cv2.LINE_AA)
    return finish(big, size, 0.5, 1.2)


def _key(base, *k):
    """A stream of its own under `base`. Every role of every sample of every
    stroke draws from one, so turning a knob EDITS the pour instead of re-rolling
    it: more pour appends specks and never moves the ones already down, fling
    adds or removes drops only, width spreads what is there."""
    return np.random.default_rng(np.random.SeedSequence(base.entropy, spawn_key=base.spawn_key + k))


def _count(rng, lam):
    """A Poisson count as the exact QUANTILE of one uniform. The same uniform
    never gives fewer specks at a higher rate, which is what lets more pour
    APPEND. numpy's own sampler is not monotone in lam: doubling the rate once
    drew SMALLER counts for some samples and 5 of 5416 specks vanished."""
    u = rng.random()
    if lam <= 0:
        return 0
    c, k, ll = 0.0, 0, math.log(lam)
    while True:
        c += math.exp(k * ll - lam - math.lgamma(k + 1))
        if c >= u or k > lam + 12 * math.sqrt(lam) + 20:
            return k
        k += 1


def band_sketch(rng, flow, lines=4, speed=0.35, length=1.6, wander=0.012, hz=60):
    """The banding sketch: long strokes ALONG the flow, in frame widths, each
    with a slow speed profile (0.6-1.6x) so the band swells where the hand
    would slow and thins where it would hurry. Returns (x, y, t) arrays."""
    d = np.array([np.cos(flow), np.sin(flow)])
    m = np.array([-d[1], d[0]])
    half = 0.5 * (abs(m[0]) + abs(m[1]))          # the frame's half-extent across the flow
    grid = 256
    strokes = []
    for _ in range(lines):
        c = np.array([0.5, 0.5]) + m * rng.uniform(-half, half)
        pace = np.exp(0.5 * smooth1d(grid, grid // 4, rng))
        lat = wander * smooth1d(grid, grid // 3, rng)
        s, t, rows = -length / 2, 0.0, []
        while s <= length / 2:
            j = min(int((s / length + 0.5) * (grid - 1)), grid - 1)
            p = c + d * s + m * lat[j]
            rows.append((p[0], p[1], t))
            s += speed * pace[j] / hz
            t += 1 / hz
        strokes.append(np.array(rows))
    return strokes


def pour_specks(strokes, base, rate, width=1.0, fling=1.0):
    """The pour. Rows of (x, y, size, angle, elongation, value, kind, seed) in
    frame widths; elongation and value are None where the speck takes L3's law.

    Deposit is `rate` specks per SECOND, not per unit length - that one choice is
    the whole of "slow pools, fast thins". Width narrows with speed and keeps
    spreading while the hand dwells. Where speed^2 x curvature passes a
    threshold, drops leave along the tangent and land outside the bend; a stroke
    that ends still moving flicks a tail. Specks lie loosely along the stroke:
    0.9 rad of spread is the weak combing measured on the noise granites."""
    out = []
    wid = lambda v: width * (0.0035 + 0.02 * np.exp(-v / 0.35))  # noqa: E731
    for j, S in enumerate(strokes):
        S = np.asarray(S, float)
        n = len(S)
        if n == 0:
            continue
        x, y, t = S[:, 0], S[:, 1], np.maximum.accumulate(S[:, 2])
        a = np.clip(np.searchsorted(t, t - 0.03, "right") - 1, 0, n - 1)
        b = np.clip(np.searchsorted(t, t + 0.03, "left"), 0, n - 1)
        dt = t[b] - t[a]
        ok = dt > 1e-4
        vx = np.where(ok, (x[b] - x[a]) / np.where(ok, dt, 1.0), 0.0)
        vy = np.where(ok, (y[b] - y[a]) / np.where(ok, dt, 1.0), 0.0)
        sp = np.hypot(vx, vy)
        th = np.zeros(n)
        for i in range(n):
            th[i] = np.arctan2(vy[i], vx[i]) if sp[i] > 0.02 else (th[i - 1] if i else 0.0)
        ds = sp[1:] * np.diff(t)
        turn = (np.diff(th) + np.pi) % (2 * np.pi) - np.pi
        ku = np.zeros(n)
        ku[1:] = np.where(ds > 1e-5, np.clip(turn / np.where(ds > 1e-5, ds, 1.0), -300, 300), 0.0)
        k2 = np.convolve(ku, np.ones(5), "same") / np.convolve(np.ones(n), np.ones(5), "same")

        cnt = _count(_key(base, 1, j, 0, 1), rate * 0.04)          # the first touch splats
        U, N = _key(base, 1, j, 0, 2).random((cnt, 2)), _key(base, 1, j, 0, 3).standard_normal((cnt, 2))
        w = wid(0.0) * 1.4
        for q in range(cnt):
            out.append((x[0] + N[q, 0] * w, y[0] + N[q, 1] * w, 1.0, U[q, 0] * np.pi,
                        None, None, "splat", int(U[q, 1] * 2 ** 31)))
        dwell = 0.0
        for i in range(1, n):
            dti, v = min(max(t[i] - t[i - 1], 0.0), 0.1), sp[i]
            tx, ty = np.cos(th[i]), np.sin(th[i])
            nx, ny = -ty, tx
            dwell = dwell + dti if v < 0.06 else dwell * 0.85
            w = wid(v) * np.sqrt(1 + dwell / 0.4)
            cnt = _count(_key(base, 1, j, i, 1), rate * dti)
            if cnt:
                U = _key(base, 1, j, i, 2).random((cnt, 2))
                N = _key(base, 1, j, i, 3).standard_normal((cnt, 3))
                px, py = x[i - 1] + (x[i] - x[i - 1]) * U[:, 0], y[i - 1] + (y[i] - y[i - 1]) * U[:, 0]
                al, ac = N[:, 0] * w * 0.5, N[:, 1] * w
                for q in range(cnt):
                    out.append((px[q] + tx * al[q] + nx * ac[q], py[q] + ty * al[q] + ny * ac[q], 1.0,
                                th[i] + N[q, 2] * 0.9, None, None, "pour", int(U[q, 1] * 2 ** 31)))
            acc = v * v * abs(k2[i])
            if fling > 0 and acc > 3:
                side = -np.sign(k2[i])                                    # the outside of the bend
                cnt = _count(_key(base, 1, j, i, 4), min(fling * (acc / 3 - 1) * dti * 60, 8))
                U = _key(base, 1, j, i, 5).random((cnt, 6))
                N = _key(base, 1, j, i, 6).standard_normal((cnt, 3))
                for q in range(cnt):
                    d = v * (0.03 + 0.07 * U[q, 0])
                    off = d * 0.3 * U[q, 1] * side
                    out.append((x[i] + tx * d + nx * off + N[q, 0] * 0.002,
                                y[i] + ty * d + ny * off + N[q, 1] * 0.002,
                                1.4 + 1.2 * U[q, 2], th[i] + N[q, 2] * 0.15, 1.6 + 1.8 * U[q, 3],
                                0.55 + 0.45 * U[q, 4], "fling", int(U[q, 5] * 2 ** 31)))
        ve = sp[-1]
        if fling > 0 and ve > 0.5:                                        # lifting while moving
            tx, ty = np.cos(th[-1]), np.sin(th[-1])
            m = int(round((3 + ve * 5) * min(fling, 2)))
            U = _key(base, 1, j, n, 7).random((m, 4))
            N = _key(base, 1, j, n, 8).standard_normal((m, 3))
            for q in range(m):
                d = ve * (0.015 + 0.012 * q + 0.008 * U[q, 0])
                out.append((x[-1] + tx * d + N[q, 0] * 0.002, y[-1] + ty * d + N[q, 1] * 0.002,
                            max(0.6, 1.8 - q * 0.09), th[-1] + N[q, 2] * 0.2, 1.4 + 1.5 * U[q, 1],
                            0.5 + 0.5 * U[q, 2], "tail", int(U[q, 3] * 2 ** 31)))
    return out


def render_specks(specks, size, grain):
    """L3's crystal, turned to lie along its stroke: same lognormal size, same
    4-6 sided outline, same squash and value range where the row leaves them open."""
    big = np.zeros((size * SS, size * SS), np.float32)
    for x, y, scale, ang, el, val, _, seed in specks:
        r_ = np.random.default_rng(seed)
        k = int(r_.integers(4, 7))
        r = grain * scale * np.exp(r_.normal(0, 0.45))
        spin = r_.uniform(0, 2 * np.pi) + np.arange(k) * 2 * np.pi / k
        rr = r * (1 + r_.uniform(-0.35, 0.35, k))
        e = el if el is not None else 1.0 / r_.uniform(0.6, 1.0)
        v = val if val is not None else r_.uniform(0.35, 1.0)
        lx, ly = np.cos(spin) * rr * e, np.sin(spin) * rr
        ca, sa = np.cos(ang), np.sin(ang)
        pts = np.stack([x * size + lx * ca - ly * sa, y * size + lx * sa + ly * ca], 1)
        cv2.fillPoly(big, [np.round(pts * SS).astype(np.int32)], float(v), cv2.LINE_AA)
    return finish(big, size, 0.5, 1.2)


def layer4(base, size, flow, pour=0, lines=4, speed=0.35, pwidth=1.0, fling=1.0,
           grain=1.6, sketch=None):
    """The pour. `pour` is the number of specks poured over the whole sketch,
    so it reads like L3's `count`; the rate follows from the sketch's duration."""
    if pour <= 0:
        return np.zeros((size, size), np.float32), []
    strokes = sketch if sketch is not None else band_sketch(_key(base, 0), flow, lines, speed)
    dur = sum(float(S[-1][2] - S[0][2]) for S in strokes if len(S) > 1) or 1.0
    specks = pour_specks(strokes, base, pour / dur, pwidth, fling)
    return render_specks(specks, size, grain), specks


def load_sketch(path):
    """Drawn strokes: {"strokes": [[[x, y, t], ...], ...]}, x and y in frame
    widths, t in seconds. Time must not run backwards within a stroke."""
    data = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    strokes = [np.asarray(s, float) for s in data["strokes"]]
    for i, s in enumerate(strokes):
        if s.ndim != 2 or s.shape[1] != 3:
            raise ValueError(f"stroke {i}: each point is [x, y, t], got shape {s.shape}")
    return strokes


def generate(seed=7, size=900, **kw):
    """Every layer. Each gets its own stream, so changing one layer's
    parameters never re-rolls another's geometry - and L1-L3 come out the same
    whether or not anything is poured (a fourth child of the seed sequence does
    not disturb the first three)."""
    ss = np.random.SeedSequence(seed).spawn(4)
    r1, r2, r3 = (np.random.default_rng(x) for x in ss[:3])
    l1 = layer1(r1, size, **{k: v for k, v in kw.items()
                             if k in ("mains", "rough", "onset", "width", "swing", "breaks")})
    l2, th = layer2(r2, size, l1, **{k: v for k, v in kw.items()
                                     if k in ("cells", "stretch")})
    l3 = layer3(r3, size, l1, **{k: v for k, v in kw.items()
                                 if k in ("count", "grain", "pull")})
    l4, _ = layer4(ss[3], size, th, **{k: v for k, v in kw.items()
                                       if k in ("pour", "lines", "speed", "pwidth", "fling",
                                                "grain", "sketch")})
    return l1, l2, l3, l4, th


def composite(size, ground, layers):
    out = np.ones((size, size, 3), np.float32) * np.array(ground, np.float32)
    for v, col, op in layers:
        a = (v * op)[..., None]
        out = out * (1 - a) + np.array(col, np.float32) * a
    return np.clip(out * 255, 0, 255).astype(np.uint8)


def cluster_ratio(l3, l1):
    near = cv2.dilate((l1 > 0.2).astype(np.uint8), np.ones((61, 61), np.uint8)) > 0
    return float((l3[near] > 0.3).mean()) / max(float((l3[~near] > 0.3).mean()), 1e-9)


def self_test():
    """Seven properties the design depends on, each able to go red.

      WIDTH BOUNDED     every L1 width sample inside 1 +- swing
      L2 FOLLOWS L1     the web's measured flow within 20 deg of L1's
      L3 CLUSTERS       micro denser near L1 than far, beyond the ~1.07 a
                        uniform scatter shows by chance
      L4 POOLS          a stroke's slow half holds ~3x the specks per unit
                        length of a half three times faster
      L4 FOLLOWS L1     the banding's measured flow within 20 deg of L1's
      L4 EDITS          doubling the pour keeps every speck already down, and
                        fling never moves a poured speck
      L1-L3 UNTOUCHED   pixel-identical with the pour on and off

    ABLATED before commit: pull=0 drops the cluster ratio to the uniform
    baseline and fails the third; stretch=1.0 gives an isotropic web whose flow
    no longer tracks L1 and fails the second. For L4: depositing per unit LENGTH
    instead of per second takes the pool ratio to ~1; bands drawn across the flow
    instead of along it land ~90 deg off; drawing a sample's positions and
    offsets from one shared stream breaks the edit property; and drawing from
    L3's stream before L3 is placed breaks the last.
    """
    fails = []
    w = np.array([run_width(255, np.random.default_rng(i), 0.2) for i in range(50)])
    if w.min() < 0.8 - 1e-6 or w.max() > 1.2 + 1e-6:
        fails.append(f"width left 0.8-1.2x: {w.min():.3f}-{w.max():.3f}")
    l1, l2, l3, l4, th = generate(seed=7, size=600, pour=2500)
    d = abs(((np.degrees(flow_of(l2 > 0.2)) - np.degrees(th)) + 90) % 180 - 90)
    if d > 20:
        fails.append(f"L2 flow is {d:.1f} deg off L1's")
    cr = cluster_ratio(l3, l1)
    if cr < 1.12:
        fails.append(f"L3 cluster ratio {cr:.2f} (need > 1.12, uniform is ~1.07)")

    base = np.random.SeedSequence(7).spawn(4)[3]
    line, px, tt = [], 0.1, 0.0                   # straight: 0.2 frame/s, then 0.6
    while px < 0.9:
        line.append((px, 0.5, tt))
        px += (0.2 if px < 0.5 else 0.6) / 120
        tt += 1 / 120
    line = np.array(line)
    # rate high enough that Poisson noise cannot fake a verdict: at 2000 the
    # ratio's own sd is ~0.11 and one draw read 2.64 against a true ~2.92
    sp = pour_specks([line], base, rate=20000, fling=0)
    xs = np.array([s[0] for s in sp])
    pool = ((xs > 0.2) & (xs < 0.5)).sum() / max(int(((xs >= 0.5) & (xs < 0.8)).sum()), 1)
    if not 2.7 < pool < 3.3:
        fails.append(f"L4 pool ratio {pool:.2f} (a 3x slower hand should lay ~3x the specks)")
    d4 = abs(((np.degrees(flow_of(l4 > 0.2)) - np.degrees(th)) + 90) % 180 - 90)
    if d4 > 20:
        fails.append(f"L4 banding is {d4:.1f} deg off L1's flow")
    wiggle = np.array([(x, 0.5 + 0.12 * np.sin(x * 25), t) for x, _, t in line])
    k = lambda rows, kind=None: {(round(r[0], 9), round(r[1], 9))  # noqa: E731
                                 for r in rows if kind is None or r[6] == kind}
    once, twice = pour_specks([wiggle], base, 2000), pour_specks([wiggle], base, 4000)
    no_fling, big_fling = pour_specks([wiggle], base, 2000, fling=0), pour_specks([wiggle], base, 2000, fling=3)
    kept = k(once) <= k(twice)
    still = k(no_fling, "pour") == k(big_fling, "pour") and len(k(big_fling, "fling")) > 0
    if not (kept and still):
        fails.append(f"L4 re-rolled instead of editing: more pour kept all {kept}, "
                     f"fling left the pour alone and added drops {still}")
    a = generate(seed=7, size=600)
    same = all(np.array_equal(p, q) for p, q in zip(a[:3], (l1, l2, l3)))
    if not same:
        fails.append("L1-L3 changed when L4 poured")
    print(f"  width      {w.min():.3f}-{w.max():.3f}x")
    print(f"  L2 vs L1   {d:.1f} deg apart")
    print(f"  L3 cluster {cr:.2f}x near L1")
    print(f"  L4 pool    {pool:.2f}x the specks where the hand is 3x slower")
    print(f"  L4 vs L1   {d4:.1f} deg apart")
    print(f"  L4 edits   more pour kept every speck {kept}; fling moved no poured speck {still}")
    print(f"  L1-L3      identical with and without the pour {same}")
    for f in fails:
        print(f"  FAIL  {f}")
    print("  PASS" if not fails else "  FAILED")
    return 1 if fails else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="generated")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--size", type=int, default=900)
    ap.add_argument("--mains", type=int, default=5, help="L1: long veins across the frame")
    ap.add_argument("--rough", type=float, default=0.30, help="L1: roughness at the finest pass")
    ap.add_argument("--onset", type=float, default=1.6,
                    help="L1: how LATE roughness arrives. 0 is a true fractal (lightning); "
                         "higher keeps the vein smooth further down in scale")
    ap.add_argument("--width", type=float, default=5.5, help="L1: gauge, px at --size")
    ap.add_argument("--swing", type=float, default=0.20, help="L1: width swell over the run, +-")
    ap.add_argument("--breaks", type=float, default=0.18, help="L1: share of each vein broken")
    ap.add_argument("--cells", type=int, default=85, help="L2: web cells")
    ap.add_argument("--stretch", type=float, default=2.0,
                    help="L2: how far cells elongate along L1's flow. 1.0 is isotropic")
    ap.add_argument("--count", type=int, default=2600, help="L3: crystals")
    ap.add_argument("--grain", type=float, default=1.6, help="L3: median crystal radius, px")
    ap.add_argument("--pull", type=float, default=0.35,
                    help="L3: clustering toward L1. 0 is uniform; 0.35 is measurable, not visible")
    ap.add_argument("--pour", type=int, default=0,
                    help="L4: specks poured along the sketch. 0 is off, and leaves L1-L3 as they were")
    ap.add_argument("--pour-lines", type=int, default=4, help="L4: bands in the default sketch")
    ap.add_argument("--pour-speed", type=float, default=0.35,
                    help="L4: the default sketch's hand speed, frame widths a second. Slower pools")
    ap.add_argument("--pour-width", type=float, default=1.0, help="L4: spread of the pour, x")
    ap.add_argument("--pour-fling", type=float, default=1.0,
                    help="L4: drops thrown off fast tight bends. Straight bands throw none")
    ap.add_argument("--pour-json", default=None,
                    help='L4: drawn strokes instead of bands, {"strokes": [[[x, y, t], ...], ...]}')
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        sys.exit(self_test())

    kw = {k: getattr(args, k) for k in ("mains", "rough", "onset", "width", "swing", "breaks",
                                        "cells", "stretch", "count", "grain", "pull", "pour")}
    kw.update(lines=args.pour_lines, speed=args.pour_speed, pwidth=args.pour_width,
              fling=args.pour_fling, sketch=load_sketch(args.pour_json) if args.pour_json else None)
    l1, l2, l3, l4, th = generate(args.seed, args.size, **kw)
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    named = [("L1", l1), ("L2", l2), ("L3", l3)] + ([("L4", l4)] if args.pour > 0 else [])
    for name, v in named:
        cv2.imwrite(str(out / f"{name}.png"), (np.clip(v, 0, 1) * 255).astype(np.uint8))
    s = args.size
    # L4 takes L3's colour: the same specks, only denser, so a band reads as density
    grounds = [composite(s, g, [(l3, c3, 0.5), (l4, c3, 0.5), (l2, c2, 0.65), (l1, c1, 0.95)])
               for g, c1, c2, c3 in (((0.93, 0.93, 0.94), (0.30, 0.31, 0.34), (0.52, 0.53, 0.56), (0.55, 0.55, 0.58)),
                                     ((0.07, 0.07, 0.08), (0.96, 0.95, 0.93), (0.78, 0.78, 0.80), (0.72, 0.72, 0.74)),
                                     ((0.50, 0.52, 0.56), (0.97, 0.96, 0.94), (0.85, 0.85, 0.87), (0.80, 0.80, 0.82)))]
    cv2.imwrite(str(out / "preview.png"), np.hstack(grounds))
    print(f"L1 flow {np.degrees(th) % 180:.1f} deg   L3 cluster {cluster_ratio(l3, l1):.2f}x")
    print(f"-> {out}/{' '.join(n + '.png' for n, _ in named)} preview.png")


if __name__ == "__main__":
    main()

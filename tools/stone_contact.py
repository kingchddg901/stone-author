"""A wall of stone, so a catalogue can be looked at instead of opened.

    python tools/stone_contact.py --material Marble --finish HONED
    python tools/stone_contact.py --slugs portoro grand-antique jadeite

Builds one labelled contact sheet from the site's declared hero images, at
browse resolution. 558 stones is 558 tabs opened by hand; it is one picture
here, and the full-size file is only fetched for the ones worth having.

CHEAP ON PURPOSE. It pulls the `-p-500` derivative, about 40KB a stone, because
the job is CHOOSING and nothing is measured off this. The moment a stone is
picked, `stone_fetch.py <slug> --heroes` gets the original.

The catalogue comes from the browse page, which declares a css class per stone
named after that stone's slug - so material, finish, colour and origin are all
filterable without opening anything.
"""
import argparse
import html as H
import pathlib
import re
import subprocess
import sys

import cv2
import numpy as np

INDEX = "https://www.newyorkstone.com/stones"
CACHE = pathlib.Path("C:/Users/CKing/AppData/Local/Temp/nys-index.html")


def catalogue():
    """Every stone: slug, name, material, finish, colour, origin, hero url."""
    if not CACHE.exists() or CACHE.stat().st_size < 100000:
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_bytes(subprocess.run(["curl", "-sS", "-L", INDEX],
                                         capture_output=True).stdout)
    raw = CACHE.read_bytes().decode("utf-8", "replace")
    heroes = dict(re.findall(
        r"\.background-([a-z0-9-]+)\s*\{\s*background-image:\s*url\('([^']+)'\)", raw))
    out = []
    for b in raw.split('class="browse-item-wrapper"')[1:]:
        m = re.search(r'href="/stone/([a-z0-9-]+)"', b)
        if not m:
            continue
        f = {k: H.unescape(v).strip('"').strip()
             for k, v in re.findall(r'filter-([a-z0-9-]+)="[^"]*"[^>]*>([^<]*)<', b)}
        name = re.search(r'browse-item-name">([^<]+)<', b)
        out.append({"slug": m.group(1), "name": (name.group(1).strip() if name else ""),
                    "material": f.get("material", ""), "finish": f.get("finish", ""),
                    "color": f.get("color", ""), "origin": f.get("origin", ""),
                    "hero": heroes.get(m.group(1), "")})
    return out


def small(url, cache):
    """The browse-size derivative. Choosing does not need the original."""
    stem = re.sub(r"(-p-\d+)?\.(jpe?g|png)$", "", url, flags=re.I)
    dest = cache / (stem.rsplit("/", 1)[-1][-40:] + ".jpg")
    if dest.exists() and dest.stat().st_size > 2000:
        return dest
    for u in (stem + "-p-500.jpeg", stem + "-p-500.jpg", url):
        r = subprocess.run(["curl", "-sS", "-L", "-H", "Accept: */*", "-o", str(dest),
                            "-w", "%{http_code}", u], capture_output=True, text=True)
        if r.stdout.strip() == "200" and dest.stat().st_size > 2000:
            return dest
    dest.unlink(missing_ok=True)
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--material", default=None)
    ap.add_argument("--finish", default=None)
    ap.add_argument("--color", default=None)
    ap.add_argument("--slugs", nargs="*", default=None)
    ap.add_argument("--cols", type=int, default=8)
    ap.add_argument("--cell", type=int, default=220)
    ap.add_argument("--limit", type=int, default=96)
    ap.add_argument("--out", default="stone-contact.png")
    args = ap.parse_args()

    rows = catalogue()
    if args.slugs:
        want = set(args.slugs)
        rows = [r for r in rows if r["slug"] in want]
    for key in ("material", "finish", "color"):
        v = getattr(args, key)
        if v:
            rows = [r for r in rows if r[key].lower() == v.lower()]
    rows = [r for r in rows if r["hero"]][: args.limit]
    if not rows:
        sys.exit("nothing matched - try --material Marble --finish HONED")

    cache = pathlib.Path("C:/Users/CKing/AppData/Local/Temp/nys-thumbs")
    cache.mkdir(parents=True, exist_ok=True)
    print(f"{len(rows)} stones", flush=True)

    cols = args.cols
    rn = (len(rows) + cols - 1) // cols
    cell, pad = args.cell, 20
    sheet = np.full((rn * (cell + pad), cols * cell, 3), 18, np.uint8)
    got = 0
    for i, r in enumerate(rows):
        f = small(r["hero"], cache)
        if not f:
            continue
        im = cv2.imread(str(f))
        if im is None:
            continue
        got += 1
        h, w = im.shape[:2]
        s = cell / min(h, w)                       # fill the cell, centre-crop
        im = cv2.resize(im, (max(1, int(w * s)), max(1, int(h * s))))
        y0 = max(0, (im.shape[0] - cell) // 2)
        x0 = max(0, (im.shape[1] - cell) // 2)
        im = im[y0:y0 + cell, x0:x0 + cell]
        if im.shape[0] != cell or im.shape[1] != cell:
            im = cv2.resize(im, (cell, cell))
        cy, cx = divmod(i, cols)
        y = cy * (cell + pad)
        sheet[y + pad:y + pad + cell, cx * cell:(cx + 1) * cell] = im
        cv2.putText(sheet, r["slug"][:28], (cx * cell + 4, y + 14),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.38, (225, 225, 225), 1, cv2.LINE_AA)

    cv2.imwrite(args.out, sheet)
    print(f"{got} drawn  ->  {args.out}")
    print("pick the slugs you want, then:  python tools/stone_fetch.py <slugs> --heroes")


if __name__ == "__main__":
    main()

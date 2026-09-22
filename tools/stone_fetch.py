"""Collect reference slabs from newyorkstone.com, at full resolution.

    python tools/stone_fetch.py portoro grand-antique verde-alpi --out refs/
    python tools/stone_fetch.py --list-only portoro

A DEV TOOL for gathering reference images to rip. Nothing it downloads belongs
in a repo: these are someone else's product photographs, kept locally as
references the way a swatch book is.

WHAT IT KNOWS, all of it learned the hard way on an earlier pass:

  THE ORIGINAL IS NOT `-p-3200`. Webflow serves resized derivatives named
  `-p-500`, `-p-1600`, `-p-3200` and so on, and the BARE filename with no
  suffix is the original. Measured on one Portoro slab: -p-3200 is 3200x2133
  and the original is 6000x4000 - nearly four times the pixels. The earlier
  reference set took -p-3200 and left that on the table, which is most of why
  its fine tiers came out below a pixel.

  THE FILENAME CARRIES THE SLAB SIZE IN INCHES - `86x66`, `103x37`, case
  varying. That is the physical scale, free, and the ripper wants it. It is an
  ESTIMATE of the image scale rather than a measurement, because the slab does
  not fill the frame exactly, so it is reported and never silently used.

  A STONE'S PAGE LISTS OTHER STONES' SLABS in its related items, so the filter
  is the stone name in the FILENAME and not merely the page it was found on.

  PREFER HONED OVER POLISHED. Honed is matte and has no specular blowout at
  all; a brightness-based segmentation once threw away 35% of a polished slab.
  The finish is in the filename too, so honed sorts first.

  CURL-LIKE FETCH, NEVER A BROWSER ONE. Image CDNs content-negotiate on the
  Accept header, and a browser asking for webp gets a lossy re-encode of the
  same URL - measured elsewhere at a tenth the bytes. Ask for anything.
"""
import argparse
import pathlib
import re
import subprocess
import sys
import urllib.parse

# `&` ends it too: the html escapes its own quotes, so a url sitting in an
# attribute runs straight into `&quot;` and the match swallows it. One stone
# failed to download for exactly that, with the entity on the end of the name.
CDN = r"https://cdn\.prod\.website-files\.com/[^\"' )>&]+"
# strips BOTH the derivative suffix and the extension, so a url and its own
# resized twin collapse to one entry - otherwise every slab lists twice
DERIV = re.compile(r"(-p-\d+)?\.(jpe?g|png)$", re.I)
SIZE = re.compile(r"[_-](\d{2,3})\s*[xX]\s*(\d{2,3})[_-]")
FINISH = re.compile(r"(honed|polished|leathered|brushed)", re.I)


INDEX = "https://www.newyorkstone.com/stones"


def index_map(cache=pathlib.Path("C:/Users/CKing/AppData/Local/Temp/nys-index.html")):
    """slug -> hero image, for every stone, from ONE request.

    THE SITE DECLARES IT. The browse page writes a css class per stone named
    after that stone's slug:

        .background-bardiglio-nuvolato { background-image: url('...') }

    558 of them, one per stone, so the hero needs no guessing at DOM order and
    no filename pattern - both of which I was doing, and both of which were
    wrong for some stones. It is also ONE fetch for the whole catalogue rather
    than one page per stone.

    The declared hero is the authoritative one: for Bardiglio it names
    thumbnail-90-1 where walking the stone's own page found thumbnail-90-2.
    """
    if not cache.exists() or cache.stat().st_size < 100000:
        cache.parent.mkdir(parents=True, exist_ok=True)
        r = subprocess.run(["curl", "-sS", "-L", INDEX], capture_output=True)
        cache.write_bytes(r.stdout)
    html = cache.read_bytes().decode("utf-8", "replace")
    return dict(re.findall(
        r"\.background-([a-z0-9-]+)\s*\{\s*background-image:\s*url\('([^']+)'\)", html))


def page(slug):
    url = f"https://www.newyorkstone.com/stone/{slug}"
    # bytes, then decode loosely: the page carries bytes that Windows' default
    # cp1252 refuses, and text=True would raise rather than return the html.
    r = subprocess.run(["curl", "-sS", "-L", url], capture_output=True)
    r_stdout = r.stdout.decode("utf-8", "replace")
    if r.returncode or not r_stdout:
        print(f"  {slug}: page not reachable", file=sys.stderr)
        return ""
    return r_stdout


# words that appear in a slug and never identify a stone
NOISE = {"marble", "granite", "quartzite", "porcelain", "onyx", "stone", "slab",
         "classico", "classic", "new", "white", "black", "dark", "light"}


def tokens(slug):
    """The parts of a slug that actually name the stone."""
    parts = [t for t in re.split(r"[^a-z0-9]+", slug.lower()) if len(t) >= 4]
    strong = [t for t in parts if t not in NOISE]
    return strong or parts


def candidates(html, slug):
    """Full-resolution originals whose FILENAME names this stone.

    SCORED ON TOKENS, not on the whole slug. A page slug carries words the
    photographer never used - `white-carrara-3` against a file called
    BIANCO_CARRARA matched nothing at all, and five stones came back empty for
    that reason while their pages were fine. Each candidate is scored by how
    many of the slug's identifying words its filename contains, and only the
    best-scoring ones are kept - so `calacatta-gold` prefers a calacatta gold
    over the other calacattas a page lists alongside it.
    """
    want = tokens(slug)
    seen = {}
    # THE PAGE'S OWN HERO IS NAMED FOR NOTHING. It is called `thumbnail-NN`,
    # carries no stone name, and was therefore invisible to a name filter -
    # while being the best file on the page: a tight crop of the slab face with
    # NO BACKDROP and, unlike the catalogue shots, NO WATERMARK. The one
    # measured came out 5408x3042, which is larger than the lossless PNGs.
    # It is unnamed, so it cannot be verified as this stone by filename; it is
    # marked as needing an eye rather than trusted.
    # ONLY THE FIRST, in DOM order. Every stone on the page has a thumbnail,
    # including the related ones listed alongside, and the page's own hero is
    # the one that comes first. Taking them all would quietly collect
    # neighbours under this stone's name.
    #
    # It is also the STABLE image: slab photos come and go with inventory,
    # while the catalogue hero stays even when nothing is in stock - so for a
    # stone with no slabs on the floor it may be the only picture there is.
    for u in re.findall(CDN, html):
        name = urllib.parse.unquote(u.rsplit("/", 1)[-1]).lower()
        # two namings for the same idea. `thumbnail-NN` is the big one - one
        # measured at 5408x3042 - while `<stone>-detail` is a small crop,
        # 1600-1866px, which is below what the fine tiers need but is still a
        # clean watermark-free face where nothing better exists.
        if not ("thumbnail" in name or name.endswith(("-detail.jpg", "-detail.jpeg",
                                                      "-detail.png", "-detail"))):
            continue
        if any(c["score"] == 99 for c in seen.values()):
            break
        base = DERIV.sub("", u)
        stem = base.rsplit("/", 1)[-1]
        seen.setdefault(stem, {
            "url": base + ".jpg", "alts": [base + e for e in (".jpeg", ".png")],
            "name": stem, "score": 99, "inches": None, "finish": "hero?",
        })
    for u in re.findall(CDN, html):
        name = urllib.parse.unquote(u.rsplit("/", 1)[-1])
        flat = re.sub(r"[^a-z0-9]", "", name.lower())
        score = sum(1 for t in want if t in flat)
        if not score:
            continue
        # every derivative maps back to one original; keep the original only
        base = DERIV.sub("", u)
        original = base + ".jpg"
        stem = base.rsplit("/", 1)[-1]
        if stem in seen:
            continue
        m = SIZE.search(name)
        f = FINISH.search(name)
        seen[stem] = {
            "url": original, "alts": [base + e for e in (".jpeg", ".png", ".JPG")],
            "name": stem, "score": score,
            "inches": (int(m.group(1)), int(m.group(2))) if m else None,
            "finish": f.group(1).lower() if f else "?",
        }
    # best name match first, then honed, then the ones that declared a size
    named = [c for c in seen.values() if c["score"] < 99]
    heroes = [c for c in seen.values() if c["score"] == 99]
    best = max((c["score"] for c in named), default=0)
    keep = [c for c in named if c["score"] == best]
    # heroes first: no watermark, no backdrop, and bigger than the catalogue PNGs
    return heroes + sorted(keep, key=lambda c: (c["finish"] != "honed",
                                                c["inches"] is None, c["name"]))


def download(c, out, slug, n):
    """NAMED FOR THE STONE, which is his trick and plainly better than mine.

    The CDN's own filename is a content hash with a marketing code bolted on -
    `5ff4d71b393bb97850e1ab90_thumbnail-90-2.jpg` - and says nothing about what
    is in it. The slug off the end of the page url does, it is unique, and it
    is what he is already typing when he saves one by hand. So a file grabbed
    here and a file he saved himself sit in the same folder under the same
    name, which is the point.
    """
    stem = slug if n == 0 else f"{slug}-{n + 1}"
    dest = out / f"{stem}.jpg"
    for url in [c["url"], *c["alts"]]:
        r = subprocess.run(["curl", "-sS", "-L", "-H", "Accept: */*",
                            "-o", str(dest), "-w", "%{http_code} %{size_download}", url],
                           capture_output=True, text=True)
        code, _, size = r.stdout.partition(" ")
        if code == "200" and int(size or 0) > 50000:
            return dest, int(size)
    dest.unlink(missing_ok=True)
    return None, 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stones", nargs="+", help="slugs as they appear in the site's urls")
    ap.add_argument("--out", default="refs")
    ap.add_argument("--per-stone", type=int, default=2)
    ap.add_argument("--list-only", action="store_true")
    ap.add_argument("--heroes", action="store_true",
                    help="the page's own hero only - unwatermarked, tight-cropped, "
                         "and the stable image when the floor is empty. One per stone, "
                         "so a long list of slugs costs one download each.")
    args = ap.parse_args()

    out = pathlib.Path(args.out)
    if not args.list_only:
        out.mkdir(parents=True, exist_ok=True)

    heroes = index_map() if args.heroes else {}
    stones = args.stones
    if len(stones) == 1 and stones[0] == "all":
        if not heroes:
            sys.exit("--heroes is required with `all`")
        stones = sorted(heroes)
        print(f"{len(stones)} stones declared on the browse page", flush=True)
    for slug in stones:
        if args.heroes and slug in heroes:
            u = heroes[slug]
            # THE DECLARED URL FIRST, exactly as the site wrote it. Stripping
            # it back to a stem and guessing the extension lost a stone whose
            # hero was neither .jpg nor .jpeg - and the site had just handed
            # over the right answer. The stem variants stay as fallbacks only,
            # because a declared url may still point at a resized derivative.
            base = DERIV.sub("", u)
            c = {"url": u, "alts": [base + e for e in (".jpg", ".jpeg", ".png")],
                 "name": slug, "score": 99, "inches": None, "finish": "hero"}
            print("")
            print(slug)
            if args.list_only:
                print("  hero      declared   " + u.rsplit("/", 1)[-1][:56])
                continue
            dest, size = download(c, out, slug, 0)
            if not dest:
                print("  hero      FAILED")
                continue
            from PIL import Image
            w, h = Image.open(dest).size
            print(f"  hero      {w}x{h}  {size/1e6:.1f}MB  ->  {dest.name}")
            continue
        html = page(slug)
        if not html:
            continue
        cands = candidates(html, slug)
        if args.heroes:
            cands = [c for c in cands if c["score"] == 99] or cands[:1]
        print(f"\n{slug}  -  {len(cands)} slab(s)")
        for i, c in enumerate(cands[: args.per_stone if not args.list_only else None]):
            inch = f"{c['inches'][0]}x{c['inches'][1]}in" if c["inches"] else "size unknown"
            if args.list_only:
                print(f"  {c['finish']:<9} {inch:<14} {c['name'][:60]}")
                continue
            dest, size = download(c, out, slug, i)
            if not dest:
                print(f"  {c['finish']:<9} {inch:<14} FAILED   {c['name'][:48]}")
                continue
            try:
                from PIL import Image
                w, h = Image.open(dest).size
                mm = c["inches"][0] * 25.4 if c["inches"] else None
                scale = f"~{w/mm:.2f}px/mm" if mm else "scale unknown"
                print(f"  {c['finish']:<9} {inch:<14} {w}x{h}  {size/1e6:.1f}MB  {scale}"
                      f"  ->  {dest.name[:40]}")
            except Exception as e:
                print(f"  {c['finish']:<9} {inch:<14} downloaded but unreadable: {e}")

    if not args.list_only:
        print(f"\nnow screen them:  python tools/stone_screen.py {out}/*.jpg")
        print("these are reference images, kept locally - none of this belongs in a repo")


if __name__ == "__main__":
    main()

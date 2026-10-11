"""Write app/_preview.html: the app with a requestAnimationFrame shim prepended.

    python tools/make-preview.py        then  localhost:8777/app/_preview.html

WHY THIS EXISTS. The app cannot be driven from an embedded browser pane as it ships. The pane
stops servicing requestAnimationFrame when the host window is not in front, and the redraw's
`queued` guard then latches on a frame that will never run - so the canvas holds whatever was
painted at load and every later read returns that same stale frame. It does not error. It looks
like a render that never changes, which reads as a finding about the renderer and is a finding
about the harness.

Shimming rAF AFTER load cannot clear the latch, because the latch is already set. The shim has to
be there before the app's own script runs, which is the only thing this script does.

The output is git-ignored and disposable; regenerate it after any edit to the app.
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "app" / "stone-author.html"
OUT = ROOT / "app" / "_preview.html"
SHIM = (
    "<script>/* PREVIEW SHIM - not part of the app, see tools/make-preview.py */\n"
    "window.requestAnimationFrame = function (cb) {\n"
    "  return setTimeout(function () { cb(performance.now()); }, 0);\n"
    "};\n</script>\n"
)

text = SRC.read_text(encoding="utf-8")
anchor = '<meta charset="utf-8">'
if anchor not in text:
    sys.exit("anchor not found in %s - has the head changed?" % SRC.name)
i = text.index(anchor) + len(anchor)
out = text[:i] + "\n" + SHIM + text[i:]

# A TEST HOOK, in the preview copy only. The engine is one IIFE, so nothing inside it can be
# reached from a page script - and the pieces most worth testing, withSlab above all, are exactly
# the ones that must not become a production surface. Injected beside the definition rather than
# exported, so the shipped file has no idea this exists.
HOOK = (
    "\n  window.__probe = { withSlab, serialize, applySlabState, H, SW, T, inFr,\n"
    "    tileInstances, PATTERNS, stageN, stoneC, renderStoneOffscreen, tileInstanceAt,\n"
    "    cutBoxFromInstance, cutScale, coverSrc, snagTile, sectionList, sectionFromHere,\n"
    "    setSections(a) { sections = a; },\n"
    # PAINT THE SLAB UNDER AN ARBITRARY TRANSFORM. The offscreen painter only ever uses
    # setTransform(cw,0,0,cw,0,ty) - a whole slab, scaled to fit. The open question is whether the
    # painter is a function of POSITION, which is the only thing that lets a window of the slab be
    # rendered on its own, so the transform has to be the probe's to choose.
    "    paintInto(cv, tf) {\n"
    "      const c = cv.getContext('2d'), prev = g2d; g2d = c;\n"
    "      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height);\n"
    # The SAME background the offscreen lays down, or a comparison against a real band measures the
    # ground fill instead of the stone: STONE_BG is near black and COL.ground is pale marble, which
    # came out as a mean difference of 188 of 255 and swamped the thing being tested.
    "      c.fillStyle = STONE_BG; c.fillRect(0, 0, cv.width, cv.height);\n"
    "      if (layVis('base')) { c.globalAlpha = layOp('base'); c.fillStyle = COL.ground;\n"
    "        c.fillRect(0, 0, cv.width, cv.height); c.globalAlpha = 1; }\n"
    "      c.lineCap = 'round'; c.lineJoin = 'round';\n"
    "      c.setTransform(tf[0], tf[1], tf[2], tf[3], tf[4], tf[5]);\n"
    "      try { paintContent(false, false); } finally { g2d = prev; }\n"
    "      return cv;\n"
    "    } };\n"
)
MARK = "  function withSlab(rec, fn) {"
if MARK in out:
    out = out.replace(MARK, HOOK + MARK, 1)
else:
    print("  note: withSlab not found, so the preview has no test hook")
OUT.write_text(out, encoding="utf-8")
print("wrote %s (%d bytes)" % (OUT.relative_to(ROOT), OUT.stat().st_size))

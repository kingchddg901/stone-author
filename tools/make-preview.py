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
OUT.write_text(text[:i] + "\n" + SHIM + text[i:], encoding="utf-8")
print("wrote %s (%d bytes)" % (OUT.relative_to(ROOT), OUT.stat().st_size))

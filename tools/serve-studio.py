"""Static server for tools/stone-studio.html, with caching off.

A dev tool for a dev tool, and it exists for one reason: ES modules go through
the HTTP cache, python -m http.server sends no Cache-Control, and Chrome then
applies heuristic freshness. Edit panel/stone-art.js, reload, and the page can
quietly keep running the module it loaded first - which reads exactly like the
edit having no effect, and cost an hour once.

    python tools/serve-studio.py          then  localhost:8777/tools/stone-studio.html
"""
import functools, http.server, pathlib, socketserver, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):        # one line per reload is enough
        if "304" not in (args[1] if len(args) > 1 else ""):
            sys.stderr.write("%s %s\n" % (self.command, self.path))


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
handler = functools.partial(NoCache, directory=str(ROOT))
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", port), handler) as srv:
    print(f"http://127.0.0.1:{port}/tools/stone-studio.html", flush=True)
    srv.serve_forever()

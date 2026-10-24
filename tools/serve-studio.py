"""Static server for tools/stone-studio.html, with caching off.

A dev tool for a dev tool, and it exists for one reason: ES modules go through
the HTTP cache, python -m http.server sends no Cache-Control, and Chrome then
applies heuristic freshness. Edit panel/stone-art.js, reload, and the page can
quietly keep running the module it loaded first - which reads exactly like the
edit having no effect, and cost an hour once.

    python tools/serve-studio.py          then  localhost:8777/tools/stone-studio.html

It also accepts PUT /_out/<name>.png|.json, writing under tools/_out/, so a probe page can hand a
rendered comparison back to disk instead of trapping it in a tab. Loopback only; see do_PUT.
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

    # A WAY TO GET A RENDER OUT OF THE BROWSER. A probe page can render a tile, composite a
    # comparison and show it - and then the picture exists only inside the tab. Reading it back out
    # as base64 through the devtools console costs thousands of tokens a look, which is enough to
    # stop looking, which is the actual damage: the whole point of these pages is that somebody
    # sees the picture.
    #
    # PUT /_out/<name> writes the body under tools/_out/. Deliberately narrow:
    #   - the directory is fixed, and the name must be a bare filename from a small character set,
    #     so nothing it is sent can name a path, a parent, or a drive;
    #   - .png and .json only, because this exists to carry renders and the numbers beside them;
    #   - 64 MiB, which is far more than a composite needs and far less than a disk;
    #   - loopback only, which the bind below already enforces for every method.
    # It is a dev tool's dev tool, same as the no-cache header above: never run this on a box where
    # something you did not write can reach the port.
    def do_PUT(self):
        import re
        m = re.fullmatch(r"/_out/([A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(?:png|json))", self.path)
        if not m:
            self.send_error(403, "PUT only to /_out/<name>.png or .json")
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self.send_error(400, "bad Content-Length")
            return
        if not 0 < n <= 64 * 1024 * 1024:
            self.send_error(413, "0 < body <= 64 MiB")
            return
        out = ROOT / "tools" / "_out"
        out.mkdir(parents=True, exist_ok=True)
        dest = out / m.group(1)
        body = self.rfile.read(n)
        if len(body) != n:
            self.send_error(400, "short body")
            return
        dest.write_bytes(body)
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()
        sys.stderr.write("PUT %s (%d bytes)\n" % (dest, len(body)))


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
handler = functools.partial(NoCache, directory=str(ROOT))

# THREADED, BECAUSE ONE SILENT SOCKET USED TO STOP THE WHOLE SERVER. This ran on
# socketserver.TCPServer, which handles exactly one connection at a time: it accepts a socket and
# blocks reading the request line. Chrome opens speculative preconnect sockets that never send one,
# so the server sat in that read while every real request queued behind it - the port still
# listening, the process still alive, and nothing answering. It looks like a hang with no error
# anywhere, and it cost a debugging detour mid-session.
#
# ThreadingHTTPServer gives each connection its own daemon thread, so a socket that says nothing
# wastes a thread instead of the server. The timeout then reaps it rather than leaking one per
# preconnect.
class Serve(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    timeout = 10


NoCache.timeout = 10                       # a connection that sends nothing is closed, not waited on
with Serve(("127.0.0.1", port), handler) as srv:
    print(f"http://127.0.0.1:{port}/tools/stone-studio.html", flush=True)
    srv.serve_forever()

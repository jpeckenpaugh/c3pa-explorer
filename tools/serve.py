#!/usr/bin/env python3
"""C3PA Explorer — local static server for the frontend (browser edition).

Serves frontend/ as static files on 127.0.0.1:<port> (8011 by default) with the
correct MIME types (the sql.js worker needs .wasm → application/wasm and
.js → text/javascript). index.html is now the sql.js shell itself (boot module,
vendored bootstrap, relative paths), so NO rewriting happens at request time —
the bytes on disk are served verbatim.

Path map:
  /              → frontend/index.html
  /js/*, /sqljs/*, /styles.css, /app.js → frontend/*
  /builds.json   → repo-root builds.json (the published-snapshot registry)
  /snapshots/*   → repo-root c3pa-db_*.tar.gz / meta_*.md
  /favicon.ico   → 204
"""
import argparse
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent  # <repo>/tools
ROOT = HERE.parent                      # <repo>
FRONTEND_DIR = ROOT / "frontend"

DEFAULT_PORT = 8011


class FrontendHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".db": "application/octet-stream",
    }

    server_version = "C3PAExplorer/1.0"

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _resolve_route(self, path):
        if path == "/":
            return FRONTEND_DIR / "index.html"
        if path == "/builds.json":
            return ROOT / "builds.json"
        if path.startswith("/snapshots/"):
            # c3pa-db_*.tar.gz / meta_*.md live at the repo root
            return ROOT / path[len("/snapshots/"):]
        if path.startswith("/static/"):
            return FRONTEND_DIR / path[len("/static/"):]
        return FRONTEND_DIR / path.lstrip("/")

    def _is_within(self, base: Path, target: Path) -> bool:
        try:
            target.resolve().relative_to(base.resolve())
            return True
        except ValueError:
            return False

    def do_GET(self):
        self._handle_route(write_body=True)

    def do_HEAD(self):
        self._handle_route(write_body=False)

    def _handle_route(self, write_body):
        path = urllib.parse.urlparse(self.path).path

        if path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return

        target = self._resolve_route(path)
        if not target or not self._is_within(ROOT, target):
            self.send_error(403, "Forbidden")
            return
        try:
            payload = target.read_bytes()
        except OSError:
            self.send_error(404, "Not Found")
            return
        self.send_response(200)
        self.send_header("Content-Type", self.guess_type(str(target)))
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if write_body:
            self.wfile.write(payload)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), FrontendHandler)
    print("C3PA Explorer (browser edition): http://127.0.0.1:%d" % args.port, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
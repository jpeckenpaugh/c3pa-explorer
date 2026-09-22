#!/usr/bin/env python3
"""C3PA Explorer — browser edition static server.

Serves the existing frontend/ SPA as static files on 127.0.0.1:<port> (8011 by
default), plus the browser-edition runtime under /browser/ and the vendored
sql.js WASM with the correct MIME type.

frontend/index.html is served via an IN-MEMORY REWRITE at request time (the
Phase-2 boot module is injected immediately before the SPA's main.js module,
and the two jsDelivr bootstrap CDN URLs are replaced with the vendored copies
under /browser/vendor/bootstrap/). The file on disk is never modified, so the
FastAPI-served page stays byte-identical (§7b.2, §7b.4).

Path map (§7b.3):
  /              → rewritten frontend/index.html
  /static/*      → frontend/*
  /browser/*     → browser/*
  /favicon.ico   → 204
MIME: .wasm → application/wasm (ESM import() and the wasm fetch need a
JavaScript/application MIME), .js/.mjs → text/javascript, Cache-Control:
no-store. Reference: jpeckenpaugh/ch poc-browser/serve.py.
"""
import argparse
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent  # <repo>/browser
ROOT = HERE.parent                      # <repo>
FRONTEND_DIR = ROOT / "frontend"
BROWSER_DIR = HERE

DEFAULT_PORT = 8011

INDEX_MAIN_TAG = '<script type="module" src="/static/js/main.js">'
BOOT_TAG = '<script type="module" src="/browser/js/core/boot.js"></script>\n  '
CDN_BOOTSTRAP = [
    ("https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css",
     "/browser/vendor/bootstrap/bootstrap.min.css"),
    ("https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js",
     "/browser/vendor/bootstrap/bootstrap.bundle.min.js"),
]


def rewrite_index(html: str) -> str:
    """Inject the boot module + vendor the CDN links, all in memory."""
    if INDEX_MAIN_TAG not in html:
        return html
    html = html.replace(INDEX_MAIN_TAG, BOOT_TAG + INDEX_MAIN_TAG, 1)
    for cdn, local in CDN_BOOTSTRAP:
        html = html.replace(cdn, local)
    return html


class BrowserHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".db": "application/octet-stream",
    }

    server_version = "C3PAExplorerBrowserEdition/1.0"

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # -- path mapping ----------------------------------------------------------

    def _resolve_route(self, path):
        if path == "/":
            return "index", FRONTEND_DIR / "index.html"
        if path == "/builds.json":
            return "file", ROOT / "builds.json"
        if path.startswith("/snapshots/"):
            name = path[len("/snapshots/"):]
            return "file", ROOT / name  # c3pa-db_*.tar.gz, meta_*.md at repo root
        if path.startswith("/static/"):
            return "file", FRONTEND_DIR / path[len("/static/"):]
        if path.startswith("/browser/"):
            return "file", BROWSER_DIR / path[len("/browser/"):]
        return None, None

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
        kind, target = self._resolve_route(path)

        if kind == "index":
            try:
                html = target.read_text(encoding="utf-8")
            except OSError:
                self.send_error(404, "Not Found")
                return
            payload = rewrite_index(html).encode("utf-8")
            self._send_bytes(payload, "text/html; charset=utf-8", 200, write_body)
            return

        if path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return

        if kind == "file":
            if not self._is_within(target.parent, target):
                self.send_error(403, "Forbidden")
                return
            try:
                payload = target.read_bytes()
            except OSError:
                self.send_error(404, "Not Found")
                return
            self._send_bytes(payload, self.guess_type(str(target)), 200, write_body)
            return

        self.send_error(404, "Not Found")

    def _send_bytes(self, payload, content_type, status, write_body):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if write_body:
            self.wfile.write(payload)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), BrowserHandler)
    print("C3PA Explorer (browser edition): http://127.0.0.1:%d" % args.port, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
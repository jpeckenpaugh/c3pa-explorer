#!/usr/bin/env python3
"""CI/CD site assembler — builds the deployable static site for GitHub Pages.

The browser edition (sql.js) of the C3PA Explorer ships as a static `site/`.
This script takes the implementation sources from THIS repo (the SPA in
`frontend/`, the browser-edition runtime in `browser/`, the snapshot artifacts
at the repo root) and emits `site/` with everything GitHub Pages needs,
pre-rewritten so NO server-side processing is required at request time:

  site/index.html          SPA shell rewritten for the browser edition:
                             - boot module (<browser/js/core/boot.js>) injected
                               immediately before the SPA main.js module
                             - the two jsDelivr bootstrap CDN links replaced by
                               the vendored copies under browser/vendor/…
                             - absolute /static/… + /browser/… links made
                               RELATIVE so the page also works when served from
                               a repo subpath (https://<user>.github.io/<repo>/)
  site/static/             the SPA (styles.css, js/…)  — unchanged verbatim
  site/browser/            browser-edition runtime + vendored sql.js/bootstrap
  site/snapshots/          the canonical snapshot tar.gz + its meta_*.md
  site/builds.json         the published registry (envelope/db hashes, url)

Repo layout of the deployable:
  site/index.html          served at /
  site/static/*            the SPA assets (relative: static/…)
  site/browser/*           runtime + vendor (relative: browser/…)

Stdlib only, Python 3.9-compatible. Run from the repo root (source defaults to
the repo root, i.e. one level above tools/):
  python3 tools/build_site.py [--source /path/to/repo] [--out site]
"""
import argparse
import json
import os
import shutil
from pathlib import Path

DEFAULT_SOURCE = Path(__file__).resolve().parent.parent

INDEX_MAIN_TAG = '<script type="module" src="/static/js/main.js">'
BOOT_TAG = '<script type="module" src="browser/js/core/boot.js"></script>\n  '
CDN_BOOTSTRAP = [
    ("https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css",
     "browser/vendor/bootstrap/bootstrap.min.css"),
    ("https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js",
     "browser/vendor/bootstrap/bootstrap.bundle.min.js"),
]
# Relative-path rewrites: served at root of the Pages site, so the leading
# slash becomes redundant and would break under a /repo/ subpath.
PATH_REWRITES = [
    ('href="/static/', 'href="static/'),
    ('src="/static/', 'src="static/'),
]


def parse_args(argv):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source", default=str(DEFAULT_SOURCE))
    ap.add_argument("--out", default="site")
    return ap.parse_args(argv)


def rewrite_index(html):
    if INDEX_MAIN_TAG not in html:
        raise SystemExit("index.html missing the expected main.js module tag")
    html = html.replace(INDEX_MAIN_TAG, BOOT_TAG + INDEX_MAIN_TAG, 1)
    for cdn, local in CDN_BOOTSTRAP:
        html = html.replace(cdn, local)
    for before, after in PATH_REWRITES:
        html = html.replace(before, after)
    return html


def main(argv=None):
    args = parse_args(argv)
    src = Path(args.source)
    out = Path(args.out)

    if not (src / "frontend" / "index.html").exists():
        raise SystemExit(f"source POC not found at {src}/frontend/index.html")
    if (out / "index.html").exists():
        shutil.rmtree(out)
    (out / "static").mkdir(parents=True)
    (out / "browser").mkdir(parents=True)
    (out / "snapshots").mkdir(parents=True)

    # 1) index.html — rewritten SPA shell.
    shell = (src / "frontend" / "index.html").read_text(encoding="utf-8")
    (out / "index.html").write_text(rewrite_index(shell), encoding="utf-8")

    # 2) static/ = the SPA (styles.css + js/ + app.js shim) verbatim.
    for rel in ("styles.css", "app.js", "js"):
        s = src / "frontend" / rel
        d = out / "static" / rel
        shutil.copy2(s, d) if s.is_file() else shutil.copytree(s, d)

    # 3) browser/ = runtime + vendored deps (no dev tools).
    for rel in ("js", "vendor"):
        shutil.copytree(src / "browser" / rel, out / "browser" / rel)

    # 4) Snapshots from the POC root builds.json + matching archive/meta.
    builds = json.loads((src / "builds.json").read_text(encoding="utf-8"))
    entry = builds["builds"][0]
    for name in (entry["file"],):  # tar.gz
        shutil.copy2(src / name, out / "snapshots" / name)
    meta_name = f"meta_{entry['db_short']}.md"
    if (src / meta_name).exists():
        shutil.copy2(src / meta_name, out / "snapshots" / meta_name)
    (out / "builds.json").write_text(json.dumps(builds, indent=2) + "\n", encoding="utf-8")

    # 5) Pages niceties.
    (out / ".nojekyll").write_text("")
    (out / "README.md").write_text(
        "This directory is the generated GitHub Pages static site for the "
        "C3PA Explorer browser edition. Do not hand-edit: regenerate with "
        "`python3 tools/build_site.py`.\n",
        encoding="utf-8",
    )

    print(f"site assembled -> {out}/")
    print(f"  index.html   {os.path.getsize(out/'index.html')} B")
    print(f"  static/      {len(list((out/'static').rglob('*')))} entries")
    print(f"  browser/     {len(list((out/'browser').rglob('*')))} entries")
    print(f"  snapshots/   {[p.name for p in (out/'snapshots').iterdir()]}")
    print(f"  builds.json  {out/'builds.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
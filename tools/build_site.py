#!/usr/bin/env python3
"""CI/CD site assembler — builds the deployable static site for GitHub Pages.

The frontend is now the browser-edition shell itself: `frontend/index.html`
references the sql.js runtime and vendored bootstrap via RELATIVE paths, so
there is no serve-time rewriting and no generated duplicate of the SPA. This
script just stages the deployable directory for Pages:

  site/                 = frontend/ (index.html, js/, sqljs/, styles.css, app.js)
  site/builds.json      = repo-root builds.json (the published-snapshot registry)
  site/snapshots/       = the canonical snapshot tar.gz + meta_*.md
  site/.nojekyll, README

`site/` is a CI/local build output — it is gitignored, never committed, and
never a second source of truth.

Stdlib only, Python 3.9-compatible. Run from the repo root:
  python3 tools/build_site.py [--source /path/to/repo] [--out site]
"""
import argparse
import json
import os
import shutil
from pathlib import Path

DEFAULT_SOURCE = Path(__file__).resolve().parent.parent


def parse_args(argv):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source", default=str(DEFAULT_SOURCE))
    ap.add_argument("--out", default="site")
    return ap.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    src = Path(args.source)
    out = Path(args.out)

    if not (src / "frontend" / "index.html").exists():
        raise SystemExit(f"source repo not found at {src}/frontend/index.html")
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    # 1) the SPA + sql.js runtime verbatim (index.html already IS the shell).
    shutil.copytree(src / "frontend", out, dirs_exist_ok=True)

    # 2) the published-snapshot registry + archive (relative to the site root,
    #    as frontend/sqljs/js/core/published.js expects: "builds.json" + "snapshots/<file>").
    builds = json.loads((src / "builds.json").read_text(encoding="utf-8"))
    entry = builds["builds"][0]
    (out / "snapshots").mkdir()
    shutil.copy2(src / entry["file"], out / "snapshots" / entry["file"])
    meta_name = f"meta_{entry['db_short']}.md"
    if (src / meta_name).exists():
        shutil.copy2(src / meta_name, out / "snapshots" / meta_name)
    (out / "builds.json").write_text(json.dumps(builds, indent=2) + "\n", encoding="utf-8")

    # 3) Pages niceties.
    (out / ".nojekyll").write_text("")
    (out / "README.md").write_text(
        "Generated GitHub Pages site for the C3PA Explorer browser edition. "
        "Do not hand-edit: regenerate with `python3 tools/build_site.py`.\n",
        encoding="utf-8",
    )

    print(f"site assembled -> {out}/")
    print(f"  index.html   {os.path.getsize(out / 'index.html')} B")
    print(f"  entries      {len(list(out.rglob('*')))}")
    print(f"  snapshots/   {[p.name for p in (out / 'snapshots').iterdir()]}")
    print(f"  builds.json  {out / 'builds.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
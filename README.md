# C3PA Explorer — demo (browser edition)

Live demo (GitHub Pages): **https://jpeckenpaugh.github.io/c3pa-explorer/**

This repository hosts the **browser-only** C3PA Explorer — the vanilla SPA on
top of [sql.js](https://sql.js.org/en/) (SQLite compiled to WebAssembly). There
is **no backend**: the CSS/JS/runtime are all static, the database ships as a
prebuilt, signed snapshot, and every query runs in your browser.

It intentionally does **not** carry the FastAPI backend, the POC history, or
any dev tools — those live in the POC repo. This is the CI/CD deployment
pipeline for the demo.

## What's here

| Path | Contents |
| :--- | :--- |
| `site/` | **generated** static site (Pages serves this) |
| `site/index.html` | SPA shell, pre-rewritten for the browser edition (boot module injected, bootstrap vendored, relative subpath-safe URLs) |
| `site/static/` | the SPA (pages, components, styles) |
| `site/browser/` | browser-edition runtime: sql.js worker, bridge, boot, and vendored `sql.js` + bootstrap |
| `site/snapshots/` | canonical snapshot `c3pa-db_v0.1_<sha8>.tar.gz` + `meta_<sha8>.md` |
| `site/builds.json` | registry: file, canonical URL, envelope hash, db hash, row counts |
| `tools/build_site.py` | the CI/CD assembler |
| `.github/workflows/pages.yml` | deploy to Pages on push to `main` |

## Snapshot trust model

The snapshot archive `c3pa-db_v0.1_<db8>.tar.gz` contains `explorer.db` +
`meta_*.md`. Its **envelope hash** (the tar.gz itself) and the inner **db hash**
are both recorded in `site/builds.json` under `file` / `envelope_hash` /
`db_sha256`. The app verifies the uploaded archive against these recorded
values, so a snapshot that matches a published build imports as *known good*.

## Rebuilding the site

The demo is assembled from the authoritative implementation (POC repo):

```bash
python3 tools/build_site.py --source /path/to/c3pa-explorer_2 --out site
```

Regenerate after changing the runtime, then commit `site/`. The Pages workflow
deploys on push to `main`.

## Local preview

```bash
cd site && python3 -m http.server 8011
# open http://127.0.0.1:8011
```
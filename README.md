# C3PA Explorer

A proof-of-concept web app for exploring the [C3PA Dataset](https://github.com/MaazBinMusa/C3PA_Dataset)
(400 expert-annotated privacy policies, CCPA/CPRA) at both the **source** level
(verbatim annotator spans) and the **derived** level (deterministically
re-extracted text units).

One repo, two runtimes:

- **FastAPI edition** — the full app with a Python backend over a normalized
  SQLite database (`backend/` + `frontend/`).
- **Browser edition** — the same SPA running entirely in the browser on
  [sql.js](https://sql.js.org/en/) (SQLite → WebAssembly) against a prebuilt,
  signed snapshot. This is what GitHub Pages serves at
  **https://jpeckenpaugh.github.io/c3pa-explorer/**.

Both editions share the SPA and the same SQLite schema. The browser edition
simply swaps the network API for an in-page sql.js worker that reproduces the
same JSON shapes.

## Two data layers

**SOURCE** — verbatim from the C3PA repo: 400 documents (HTML + crawl metadata)
and 45,121 annotator spans (`ra1`–`ra6`, `Text`, `Label`).

**DERIVED** — produced by `backend/extract.py`, a fully deterministic, rule-based
pipeline (no trained models):

```
HTML
  -> DOM structural pass     drop chrome: nav/header/footer/menu/cookie/chat/...
  -> leaf text blocks        paragraphs; <ul>/<ol> join the text flow
  -> lead-in + list merge    a block ending ":" joins a following list
  -> rule-based splitter     abbreviation/initial/decimal/URL/email guards
  -> unit classifier         complete-thought sentencehood + typed fragments
  -> 3-tier annotation re-alignment   (annotation_in_sentence /
                              sentence_in_annotation_paragraph / partial_overlap)
```

Units are `sentence` or `fragment`; fragment types include `heading`,
`list_item`, `lead_in`, `short`, `nav`, `phone`, `email`, `url`, `copyright`,
`other`. Label categories apply to **sentences only**: `single_label`,
`multi_label`, `unlabeled` (measurement-relative — not a verified negative;
positive-unlabeled caution). Fragments carry a distinct `not-eligible` state
by design. See the rationale comment in `backend/extract.py:classify_unit`.

Every row keeps provenance (`source_html`, `source_csv`, `crawl_path`); the
`alignment` table records the exact annotation→unit mapping for auditable
labels.

## What you can do

- **Dashboard** — corpus stats, label distribution, fragment sub-types, annotator coverage.
- **Documents** — browse/search all 400 policies (DB/WS subsets, URLs).
- **Document detail** — three tabs: *Source* (verbatim spans + alignment status),
  *Sentences*, and *Fragments*. Click any unit to see exactly which annotations
  support it and via which alignment strategy.
- **Unit explorer** — filter a slice (label subset, unit kind, fragment type,
  label category, subset, min annotators, high-confidence, full-text) then
  **export** as a timestamped ZIP archive with partition files
  (`train_*`/`eval_*`/`test_*` or `data_*`) and `meta.json` (FastAPI edition).

## Repo layout

| Path | Contents |
| :--- | :--- |
| `backend/` | FastAPI app: `api/` routers, `services/`, `schemas/`, `core/`; pipeline in `db.py`, `extract.py`, `ingest.py`, `export.py` |
| `frontend/` | The vanilla SPA (Bootstrap 5, no build step): `index.html`, `js/core/`, `js/components/`, `js/pages/` |
| `browser/` | Browser-edition runtime: sql.js worker + bridge + boot, vendored `sql.js` + bootstrap, `serve.py` (localhost static server) |
| `site/` | **Generated** GitHub Pages site (do not hand-edit; regenerate with `tools/build_site.py`) |
| `tools/build_site.py` | Assembles `site/` from the repo source (SPA + browser runtime + snapshot) |
| `snapshots/` | (inside `site/`) canonical snapshot `c3pa-db_v0.1_<sha8>.tar.gz` + `meta_<sha8>.md` |
| `builds.json` | Snapshot registry: file, canonical URL, envelope hash, db hash, row counts |
| `scripts/` | `package_snapshot.py` (snapshot archive + registry), `build_colab_notebook.py` (notebook generator) |
| `notebooks/` | `build_snapshot_colab.ipynb` — rebuild the snapshot DB on Colab |
| `tests/` | Backend `unittest` + JS unit + browser-edition parity/bridge tests |
| `c3pa-sentence-label-parser/` | Git submodule: the baseline parser + the C3PA dataset (needed only to rebuild the DB) |

## Quickstart

### FastAPI edition (full backend)

```bash
# Clone with the dataset submodule (only needed to rebuild the DB from source)
git clone --recurse-submodules https://github.com/jpeckenpaugh/c3pa-explorer.git

./install.sh     # creates .venv, installs deps, builds data/explorer.db
./run.sh         # http://localhost:8765  (interactive API docs at /docs)
./tests.sh       # backend + frontend + browser-edition parity suite
```

The submodule is **optional**: `backend.ingest` clones the C3PA dataset itself
if the dataset dir is missing, and the Colab notebook (`notebooks/`) does the
same on Google's servers. Cloners who only want the browser edition can skip it.

### Browser edition

Option A — the live demo (no local anything): **https://jpeckenpaugh.github.io/c3pa-explorer/**

Option B — locally, served statically:

```bash
python3 browser/serve.py      # http://127.0.0.1:8011
# or serve the generated site directory:
cd site && python3 -m http.server 8011
```

Pick the snapshot (`site/snapshots/c3pa-db_v0.1_663586da.tar.gz`) or a
notebook-built `explorer.db`; everything runs in your browser, no network calls
after load.

## Snapshot trust model

The snapshot archive `c3pa-db_v0.1_<db8>.tar.gz` contains `explorer.db` +
`meta_*.md`. Its **envelope hash** (the tar.gz itself) and the inner **db hash**
are both recorded in `builds.json` under `file` / `envelope_hash` /
`db_sha256`. The app verifies the uploaded archive against these recorded
values, so a snapshot that matches a published build imports as *known good*.

Rebuilding a snapshot:

```bash
# 1) build the DB (needs the dataset)
.venv/bin/python -m backend.ingest
# 2) package it (zip -> tar.gz + meta + builds.json registry)
.venv/bin/python scripts/package_snapshot.py --zip explorer.zip
```

## Rebuilding the site

The `site/` directory is the deployable Pages artifact, assembled from this
repo's own sources so it can never drift from the SPA/runtime:

```bash
python3 tools/build_site.py    # reads the repo root, writes site/
```

Regenerate after changing the SPA or browser runtime, then commit `site/`. The
Pages workflow also re-runs this and diffs against `site/` on every push to
`main` (see `.github/workflows/pages.yml`).

## Testing

`./tests.sh` runs the whole suite in one command:

- Backend API tests (Python `unittest` via FastAPI `TestClient`, `tests/test_api.py`)
- Frontend unit tests (Node native runner, `tests/frontend/*.test.js`)
- Browser-edition tests: FastAPI↔sql.js JSON parity, bridge/URL parsing,
  snapshot archive, published-snapshot, and export ports (`tests/jbrowser_*.test.js`)

## API (FastAPI edition)

- `GET /api/stats`, `GET /api/labels`, `GET /api/fragment-types`
- `GET /api/documents[?subset=&q=&limit=&offset=]`, `/api/documents/{doc_id}`,
  `/api/documents/{doc_id}/rendered`, `/api/documents/{doc_id}/annotations`, `/html`
- `GET /api/units[?subset=&doc_id=&category=&unit_kind=&fragment_type=&labels=&min_annotators=&high_confidence=&q=&limit=&offset=]`
- `GET /api/annotations[?doc_id=&ranumb=&label=&status=&limit=&offset=]`
- `GET /api/alignment?unit_id=`
- `GET /api/export?format=&split=&...` — timestamped ZIP with partition files
- `GET /api/search?q=` — global multi-entity search

Interactive docs at `http://localhost:8765/docs`.

## License / credit

Code is open source. Data and annotations remain under the C3PA dataset's terms;
cite the C3PA paper (EMNLP 2024) if you use derived data:

> Musa, M. B., Winston, S. M., Allen, G., Schiller, J., Moore, K., Quick, S., Melvin, J., Srinivasan, P., Diamantis, M. E., Nithyanand, R. (2024). *C3PA: An Open Dataset of Expert-Annotated and Regulation-Aware Privacy Policies to Enable Scalable Regulatory Compliance Audits.* EMNLP 2024.
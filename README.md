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
  hash-verified snapshot. This is what GitHub Pages serves at
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
labels. The full extraction rules and rationale are in
[docs/extraction_logic.md](docs/extraction_logic.md).

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
| `frontend/` | **The one SPA** (Bootstrap 5, no build step) — runs in *both* modes. `index.html`, `js/core/`, `js/components/`, `js/pages/` |
| `frontend/sqljs/` | The sql.js engine, a component of the frontend: WASM worker + bridge + boot, the SQL query ports, vendored `sql.js` + bootstrap |
| `site/` | **Build output only** (gitignored): assembled by `tools/build_site.py` for GitHub Pages. Never committed, never a source of truth |
| `tools/build_site.py` | Stages `site/` from `frontend/` + the snapshot (no rewriting — `index.html` is already the shell) |
| `tools/serve.py` | Local static server for the browser edition (WASM MIME types) |
| `builds.json` | Snapshot registry: file, canonical URL, envelope hash, db hash, row counts |
| `c3pa-db_*.tar.gz`, `meta_*.md` | The canonical hash-verified snapshot + its metadata |
| `.github/workflows/pages.yml` | The single CI workflow: required test matrix on PR/push, Pages deploy on `main` |
| `scripts/` | `package_snapshot.py` (snapshot archive + registry), `verify_snapshot.py` (canonical URL + hash check), `build_colab_notebook.py` (notebook generator) |
| `notebooks/` | `build_snapshot_colab.ipynb` — rebuild the snapshot DB on Colab |
| `tests/` | Backend `unittest` + JS unit + browser-edition parity/bridge tests; `make_fixture_db.py` builds the small CI fixture |
| `c3pa-sentence-label-parser/` | Git submodule: the baseline parser + the C3PA dataset (needed only to rebuild the DB) |

## Two engines, one frontend

The SPA defaults to the **sql.js (WASM) engine**: on load it auto-loads the
latest hash-verified snapshot (or restores the one cached in your browser) and runs
every query in a Web Worker — no server, no network calls after the snapshot
download. A **DB icon** in the top nav opens a modal that shows snapshot
details (schema version, dataset commit, hashes, integrity, row counts) and can
switch the engine to a **FastAPI backend** — same origin, or a remote origin
such as `http://localhost:8765` — for users who prefer a Python backend.
The switch is persisted per-browser; the single swap point is
`frontend/js/core/api.js`.

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
python3 tools/serve.py      # http://127.0.0.1:8011
```

On load the app auto-loads the published snapshot (`builds.json` +
`snapshots/c3pa-db_v0.1_663586da.tar.gz` on the same origin); you can also pick
a local snapshot file or a notebook-built `explorer.db` via the file picker, or
point the DB icon at a FastAPI backend.

## Snapshot trust model

The snapshot archive `c3pa-db_v0.1_<db8>.tar.gz` contains `explorer.db` +
`meta_*.md`. Its **envelope hash** (the tar.gz itself) and the inner **db hash**
are both recorded in `builds.json` under `file` / `envelope_hash` /
`db_sha256`. This is SHA-256 verification, not a cryptographic signature: the
app verifies any snapshot it loads against the recorded values, so a snapshot
that matches a published build imports as *known good*.

The canonical download URL is
`https://raw.githubusercontent.com/jpeckenpaugh/c3pa-explorer/main/c3pa-db_v0.1_663586da.tar.gz`
(also recorded as `canonical_url` in `meta_663586da.md`). Verify it with:

```bash
python3 scripts/verify_snapshot.py --mode head   # HTTP 200 only (PR CI)
python3 scripts/verify_snapshot.py --mode full   # download + envelope/db hashes
```

CI runs the HEAD check on pull requests and the full hash check on `main`
pushes and the weekly schedule.

Rebuilding a snapshot:

```bash
# 1) build the DB (needs the dataset)
.venv/bin/python -m backend.ingest
# 2) package it (zip -> tar.gz + meta + builds.json registry)
.venv/bin/python scripts/package_snapshot.py --zip explorer.zip
```

## Rebuilding the site

`site/` is a build output, not a committed folder. Regenerate it whenever you
want to preview the exact deployable locally:

```bash
python3 tools/build_site.py    # reads the repo root, writes site/
```

`.github/workflows/pages.yml` is the only workflow. Pull requests run the
required test matrix (Python 3.10 + 3.12, Node 20) plus a HEAD check of the
canonical snapshot URL. On push to `main` the same tests run with the full
snapshot hash check; only if they pass does the `deploy` job assemble `site/`
fresh from the repo and publish it. No regeneration discipline is required, and
no drift is possible because `site/` is never a second source of truth.

## Testing

Local one-command path (builds the full DB, keeps the original experience):

```bash
./install.sh
./tests.sh
```

Fast local/CI path (no dataset, no 400-document build; Python deps still
required via `pip install -r requirements.txt`):

```bash
python3 tests/make_fixture_db.py --out data/explorer.db
C3PA_DB_PATH=data/explorer.db PYTHON=python3 ./tests.sh
```

`make_fixture_db.py` deterministically extracts the first 5 documents from each
subset of the checked-in canonical snapshot, so the suite is self-contained and
offline. `tests.sh` uses `.venv/bin/python` by default and honors `PYTHON=...`;
all Python and parity tests read `data/explorer.db` unless `C3PA_DB_PATH` points
elsewhere. In CI a missing fixture DB fails loudly instead of skipping parity.

The suite (in order, fail-fast) covers:

- Backend API tests (Python `unittest` via FastAPI `TestClient`, `tests/test_api.py`)
- FastAPI fixture generation for parity (`tests/gen_fastapi_fixtures.py`)
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

See [docs/export_api.md](docs/export_api.md) for the export field, split, and
ZIP layout reference. Interactive docs at `http://localhost:8765/docs`.

## License / credit

Code is open source. Data and annotations remain under the C3PA dataset's terms;
cite the C3PA paper (EMNLP 2024) if you use derived data:

> Musa, M. B., Winston, S. M., Allen, G., Schiller, J., Moore, K., Quick, S., Melvin, J., Srinivasan, P., Diamantis, M. E., Nithyanand, R. (2024). *C3PA: An Open Dataset of Expert-Annotated and Regulation-Aware Privacy Policies to Enable Scalable Regulatory Compliance Audits.* EMNLP 2024.
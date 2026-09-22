#!/usr/bin/env python3
"""Generate notebooks/build_snapshot_colab.ipynb (standalone Colab snapshot builder).

Follows the qsbc pattern (scripts/build_colab_notebook.py -> notebooks/*.ipynb).
This POC repo has no git remote, so the four backend files needed by the ingest
path (backend/__init__.py, backend/db.py, backend/extract.py, backend/ingest.py)
are VENDORED into the notebook as generated %%writefile cells, read from this
checkout at generation time (regenerated each build -> no drift by construction).

    python3 scripts/build_colab_notebook.py

Python >= 3.9 compatible (keep it that way: the repo's bare `python3` is 3.9.6).
This generator must stay pure-json over file strings -- it must NOT re-import
the vendored backend (which uses PEP 604 `str | None` and needs 3.10+).

code_rev resolution (baked at GENERATION time, recorded in the manifest cell):
  1. C3PA_EXPLORER_REV env override
  2. else `git rev-parse HEAD` of this checkout (read-only)
  3. else "vendored-cells" + UTC timestamp
"""
import json
import os
import subprocess
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NOTEBOOK_DIR = os.path.join(ROOT, "notebooks")
OUT = os.path.join(NOTEBOOK_DIR, "build_snapshot_colab.ipynb")

# Agreed snapshot schema version. The SAME literal must live in exactly two
# places that must agree: this generator (emitted into the notebook's manifest
# cell) and browser/js/core/snapshot-version.js (Phase 2 creates it).
SNAPSHOT_SCHEMA_VERSION = "c3pa-explorer-snapshot-v1"

VENDORED_FILES = [
    "backend/__init__.py",
    "backend/db.py",
    "backend/extract.py",
    "backend/ingest.py",
]


def read(relpath):
    with open(os.path.join(ROOT, relpath), encoding="utf-8") as fh:
        return fh.read()


def git_head_or_none():
    try:
        head = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
        return head or None
    except Exception:
        return None


def resolve_code_rev():
    env_rev = os.environ.get("C3PA_EXPLORER_REV")
    if env_rev and env_rev.strip():
        return env_rev.strip()
    head = git_head_or_none()
    if head:
        return head
    return "vendored-cells " + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def md(source):
    return {"cell_type": "markdown", "metadata": {}, "source": source.splitlines(keepends=True)}


def code(source):
    return {"cell_type": "code", "metadata": {}, "source": source.splitlines(keepends=True)}


def writefile_cell(relpath, content):
    """Emit a %%writefile cell; body is byte-faithful to the vendored file.

    A cell with no body after the magic line (empty file, e.g.
    backend/__init__.py) writes an empty file when executed.
    """
    lines = ["%%writefile " + relpath + "\n"]
    if content:
        lines.extend(content.splitlines(keepends=True))
    return {"cell_type": "code", "metadata": {}, "source": lines}


MD_TITLE = """
# C3PA Explorer -- Colab Snapshot Build

Builds `explorer.db` (the C3PA Explorer SQLite snapshot) on Google Colab by
running the **unchanged** deterministic pipeline (`backend.ingest` ->
`extract.py` + alignment) against a shallow clone of the official C3PA
dataset, then embeds a `manifest` table (`schema_version`, `dataset_commit`,
`code_rev`, `counts`, `db_sha256`, `built_at`) and downloads the single file
for the browser edition (sql.js file-picker -> in-memory database).

**Python >= 3.10 required** (the vendored backend uses PEP 604 `str | None`
annotations). Colab's default runtime (3.11 / 3.12) is fine; the notebook
asserts this in cell 2.

**How to rebuild:** run every cell in order, then pick `explorer.db` in the
browser edition. The notebook is regenerated from this checkout by
`scripts/build_colab_notebook.py` (vendored `%%writefile` cells -> no drift);
the dataset is shallow-cloned at HEAD, so `dataset_commit` (recorded in the
manifest) pins data provenance.

**Dataset layout note:** `git clone --depth 1` of
`MaazBinMusa/C3PA_Dataset.git` provides `Crawl/db.csv` + `Crawl/ws.csv` as
flat regular files (no submodule). The dataset's own README claims `Crawl/`
has `DB/`/`WS/` subfolders -- that is stale; **do not "fix"**
`load_crawl_meta`'s `Crawl/*{db,ws}*.csv` glob to match it.

**Build-time dependency:** only `beautifulsoup4==4.15.0` (pinned; it also
pulls `soupsieve` + `typing-extensions`). Extraction uses stdlib
`html.parser` only -- no lxml/html5lib, spacy, or fastapi.

**Expected full-corpus counts** (derived live from the built DB, not
hardcoded): 400 documents / 121,287 units / 84,985 sentences / 36,302
fragments / 45,121 annotations.
""".strip() + "\n"

CELL_CLONE = """
# 1. Dataset: shallow clone (flat Crawl layout) + provenance
import os
import subprocess
import sys

assert sys.version_info >= (3, 10), "vendored backend requires Python >= 3.10 (PEP 604 `str | None` annotations)"

os.chdir("/content")

DATASET = "C3PA_Dataset"
DATASET_URL = "https://github.com/MaazBinMusa/C3PA_Dataset.git"

# An interrupted clone leaves a dir without Htmls/ -- git clone refuses to
# write into a non-empty dir, so in that case DELETE C3PA_Dataset and re-run.
if not os.path.isdir(os.path.join(DATASET, "Htmls")):
    !git clone --depth 1 {DATASET_URL} {DATASET}

# Integrity asserts. ingest's `ensure_dataset` ignores git exit codes, so do
# not trust it -- verify the artifacts the pipeline actually needs right here.
for req in (
    os.path.join(DATASET, "Htmls"),
    os.path.join(DATASET, "Crawl", "db.csv"),
    os.path.join(DATASET, "Crawl", "ws.csv"),
):
    assert os.path.exists(req), f"missing dataset artifact: {req}"

# Layout note: --depth 1 provides Crawl/db.csv + Crawl/ws.csv as flat regular
# files (no submodule). The dataset README's "Crawl has DB/WS subfolders" is
# stale -- do NOT 'fix' load_crawl_meta's glob to match it.

dataset_commit = subprocess.check_output(
    ["git", "-C", DATASET, "rev-parse", "HEAD"], text=True).strip()
print("dataset_commit:", dataset_commit)
print("dataset top-level:", sorted(os.listdir(DATASET)))
""".strip() + "\n"

CELL_MKDIR = """
# 2. Prepare /content/backend for the vendored files (belt-and-braces)
import os
os.makedirs("/content/backend", exist_ok=True)
print("backend/ ready:", os.path.isdir("/content/backend"))
""".strip() + "\n"

CELL_PIP = """
# 3. Only build-time dep: beautifulsoup4, pinned (matches the recorded baseline;
# unpinned bs4 could drift counts). It pulls soupsieve + typing-extensions.
# Extraction uses stdlib html.parser only -- no lxml/html5lib, spacy, or fastapi.
!pip install -q beautifulsoup4==4.15.0
import bs4
print("bs4", bs4.__version__)
""".strip() + "\n"

CELL_INGEST = """
# 4. Build the snapshot DB with the UNCHANGED pipeline.
#
# Full corpus by default. For a QUICK SMOKE BUILD set MAX_DOCS, e.g.:
#   MAX_DOCS = 5
# When set, --max-docs N is passed to ingest and the manifest is flagged
# partial (counts are then for the partial slice, not the full corpus).
MAX_DOCS = None
PARTIAL = MAX_DOCS is not None

import os
import subprocess
import sys

cmd = [
    sys.executable, "-m", "backend.ingest",
    "--dataset-dir", "C3PA_Dataset",
    "--db", "explorer.db",
]
if PARTIAL:
    cmd += ["--max-docs", str(int(MAX_DOCS))]
print("+", " ".join(cmd))
subprocess.check_call(cmd)
print("ingest exit: OK")
""".strip() + "\n"

CELL_MANIFEST_TEMPLATE = """
# 5. Embed the manifest table into explorer.db
#
# Counts use the SAME SQL + key names as backend/services/stats_service.py
# get_stats_data, so manifest counts can never drift from /api/stats.
# db_sha256 is hashed LAST, over the closed final file (see below).

import hashlib
import json
import os
import sqlite3
from datetime import datetime, timezone

# Agreed snapshot schema version -- must equal browser/js/core/snapshot-version.js.
SNAPSHOT_SCHEMA_VERSION = "__SNAPSHOT_SCHEMA_VERSION__"
# Baked at GENERATION time by scripts/build_colab_notebook.py (C3PA_EXPLORER_REV
# env override, else repo git HEAD, else "vendored-cells" + timestamp).
code_rev = "__CODE_REV__"

DB_PATH = "explorer.db"
MAX_DOCS = globals().get("MAX_DOCS")              # defined by the ingest cell; survives re-runs
PARTIAL = MAX_DOCS is not None
dataset_commit = globals().get("dataset_commit") or "unknown"


def cnt(conn, sql, params=()):
    return conn.execute(sql, params).fetchone()[0]


conn = sqlite3.connect(DB_PATH)                   # read-write: the manifest table is new
conn.row_factory = sqlite3.Row
try:
    # --- counts: same SQL + key names as stats_service.get_stats_data ---
    kinds = {r["unit_kind"]: r["n"] for r in conn.execute(
        "SELECT unit_kind, COUNT(*) n FROM text_units GROUP BY unit_kind")}
    cats = {r["label_category"]: r["n"] for r in conn.execute(
        "SELECT label_category, COUNT(*) n FROM text_units WHERE unit_kind='sentence' GROUP BY label_category")}
    counts = {
        "documents": cnt(conn, "SELECT COUNT(*) FROM documents"),
        "units": cnt(conn, "SELECT COUNT(*) FROM text_units"),
        "sentences": kinds.get("sentence", 0),
        "fragments": kinds.get("fragment", 0),
        "annotations": cnt(conn, "SELECT COUNT(*) FROM annotations"),
        "aligned": cnt(conn, "SELECT COUNT(*) FROM annotations WHERE status='aligned'"),
        "unmatched": cnt(conn, "SELECT COUNT(*) FROM annotations WHERE status='unmatched'"),
        "ambiguous": cnt(conn, "SELECT COUNT(*) FROM annotations WHERE status='ambiguous'"),
        "single_label_sentences": cats.get("single_label", 0),
        "multi_label_sentences": cats.get("multi_label", 0),
        "unlabeled_sentences": cats.get("unlabeled", 0),
        "high_confidence_single": cnt(
            conn, "SELECT COUNT(*) FROM text_units WHERE label_category='single_label' AND annotator_count>=2"),
        "subsets": {r["subset"]: r["n"] for r in
                    conn.execute("SELECT subset, COUNT(*) n FROM documents GROUP BY subset")},
    }

    expected_docs = 400 if not PARTIAL else 1
    assert counts["documents"] >= expected_docs, (
        f"documents={counts['documents']} below expected {expected_docs}; dataset incomplete?"
    )
    if PARTIAL:
        counts["partial"] = True
        counts["max_docs"] = int(MAX_DOCS)

    conn.execute("CREATE TABLE IF NOT EXISTS manifest (key TEXT PRIMARY KEY, value TEXT)")
    conn.executemany("INSERT OR REPLACE INTO manifest (key, value) VALUES (?,?)", [
        ("schema_version", SNAPSHOT_SCHEMA_VERSION),
        ("dataset_commit", dataset_commit),
        ("code_rev", code_rev),
        ("counts", json.dumps(counts, sort_keys=True, separators=(",", ":"))),
        ("built_at", datetime.now(timezone.utc).isoformat()),
    ])
    conn.commit()
    conn.execute("VACUUM")
finally:
    conn.close()

for side in ("-wal", "-shm"):
    assert not os.path.exists(DB_PATH + side), \
        f"stray {DB_PATH}{side} left behind; checkpoint/close failed"

# db_sha256 LAST, over the CLOSED final file. The stored value covers the
# delivered bytes with the checksum row itself excluded (a file cannot contain
# the hash of its own final bytes). Transport integrity is `PRAGMA
# integrity_check` + schema_version; db_sha256 is the provenance checksum.
db_sha256 = hashlib.sha256(open(DB_PATH, "rb").read()).hexdigest()

conn = sqlite3.connect(DB_PATH)
try:
    conn.executemany("INSERT OR REPLACE INTO manifest (key, value) VALUES (?,?)", [
        ("db_sha256", db_sha256),
    ])
    conn.commit()
    conn.execute("VACUUM")
finally:
    conn.close()

for side in ("-wal", "-shm"):
    assert not os.path.exists(DB_PATH + side), \
        f"stray {DB_PATH}{side} left behind; checkpoint/close failed"

print("=== manifest ===")
conn = sqlite3.connect(DB_PATH)
try:
    for k, v in sorted(conn.execute("SELECT key, value FROM manifest")):
        shown = v if len(v) <= 120 else v[:120] + "..."
        print(f"  {k:<14} {shown}")
finally:
    conn.close()
print("db size:", os.path.getsize(DB_PATH), "bytes")
""".strip() + "\n"

CELL_DOWNLOAD = """
# 6. Download the snapshot + optional Google Drive copy.
#
# files.download streams the whole file through kernel comms into a browser
# Blob (~153 MB) -- fine on a desktop browser; the Drive copy is the robust
# path for large files. This cell never mounts Drive (it blocks on an
# interactive auth prompt); an already-mounted Drive is picked up if present.
import os
from google.colab import files

files.download("explorer.db")

MOUNT_DRIVE = False   # set True to also copy to MyDrive/c3pa_explorer/
if MOUNT_DRIVE and os.path.exists("/content/drive/MyDrive"):
    import shutil
    dest_dir = "/content/drive/MyDrive/c3pa_explorer"
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, "explorer.db")
    shutil.copy("explorer.db", dest)
    print("copied to:", dest)
else:
    print("Drive copy skipped (MOUNT_DRIVE=False or /content/drive/MyDrive not mounted)")
""".strip() + "\n"


def main():
    code_rev = resolve_code_rev()
    git_head = git_head_or_none()

    manifest_cell = CELL_MANIFEST_TEMPLATE.replace(
        "__SNAPSHOT_SCHEMA_VERSION__", SNAPSHOT_SCHEMA_VERSION).replace(
        "__CODE_REV__", json.dumps(code_rev)[1:-1])  # plain literal, no escaping surprises
    md_title = MD_TITLE

    cells = [md(md_title), code(CELL_CLONE), code(CELL_MKDIR)]
    for rel in VENDORED_FILES:
        cells.append(writefile_cell(rel, read(rel)))
    cells.append(code(CELL_PIP))
    cells.append(code(CELL_INGEST))
    cells.append(code(manifest_cell))
    cells.append(code(CELL_DOWNLOAD))

    notebook = {
        "nbformat": 4,
        "nbformat_minor": 5,
        "metadata": {
            "colab": {},
            "kernelspec": {"name": "python3", "display_name": "Python 3"},
            "language_info": {"name": "python"},
            "c3pa_explorer": {
                "generator": "scripts/build_colab_notebook.py",
                "schema_version": SNAPSHOT_SCHEMA_VERSION,
                "code_rev": code_rev,
                "git_head": git_head,
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "vendored_files": VENDORED_FILES,
            },
        },
        "cells": cells,
    }

    os.makedirs(NOTEBOOK_DIR, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(notebook, fh, indent=1)
    print("wrote %s (%d cells)" % (OUT, len(cells)))
    for i, c in enumerate(cells):
        first = "".join(c["source"])[:60].replace("\n", " ")
        print("  [%02d] %-8s %s" % (i, c["cell_type"], first))


if __name__ == "__main__":
    main()
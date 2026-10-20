#!/usr/bin/env python3
"""Execute the Colab notebook as a small smoke build and stamp provenance.

Dev-only helper (not needed by CI or the runtime): it executes
`notebooks/build_snapshot_colab.ipynb` with nbclient in a throwaway directory,
then rewrites the "Last verified" markdown cell with the real runtime, dataset
commit, schema version, code revision, MAX_DOCS, and counts. The resulting
notebook keeps only text/count/hash outputs; `explorer.db` stays outside the
repo.

    python3 -m pip install nbformat nbclient ipykernel   # once
    python3 scripts/build_colab_notebook.py
    python3 scripts/run_colab_smoke.py                    # writes executed .ipynb
    python3 scripts/check_notebook_sync.py

Network is required for the dataset shallow clone and the pinned bs4 install.
"""
import argparse
import json
import os
import platform
import re
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NOTEBOOK = os.path.join(ROOT, "notebooks", "build_snapshot_colab.ipynb")

MAX_DOCS_LINE = re.compile(r"(?m)^MAX_DOCS = .*$")
DATASET_COMMIT_LINE = re.compile(r"dataset_commit:\s*([0-9a-f]{7,40})")


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--notebook", default=NOTEBOOK)
    ap.add_argument("--workdir", default=None,
                    help="scratch build directory (default: a fresh temp dir)")
    ap.add_argument("--max-docs", type=int, default=5,
                    help="smoke-build document limit (default: 5)")
    ap.add_argument("--timeout", type=int, default=1800,
                    help="per-cell timeout in seconds (default: 1800)")
    return ap.parse_args(argv)


def patch_max_docs(nb, max_docs):
    patched = 0
    for cell in nb.cells:
        if cell.get("cell_type") != "code":
            continue
        source = cell.get("source", "")
        if "backend.ingest" not in source:
            continue
        new_source, n = MAX_DOCS_LINE.subn("MAX_DOCS = %d" % max_docs, source, count=1)
        if n:
            cell["source"] = new_source
            patched += 1
    if patched != 1:
        raise SystemExit("expected exactly one ingest MAX_DOCS cell, patched %d" % patched)
    return patched


def clear_execution(nb):
    for cell in nb.cells:
        if cell.get("cell_type") == "code":
            cell["outputs"] = []
            cell["execution_count"] = None


def output_text(cell):
    parts = []
    for out in cell.get("outputs", []):
        if out.get("output_type") == "stream":
            parts.append(out.get("text", ""))
        elif out.get("output_type") in ("execute_result", "display_data"):
            text = out.get("data", {}).get("text/plain", "")
            parts.append("".join(text) if isinstance(text, list) else text)
        elif out.get("output_type") == "error":
            parts.append("\n".join(out.get("traceback", [])))
    return "".join(parts)


def find_dataset_commit(nb):
    for cell in nb.cells:
        if cell.get("cell_type") != "code":
            continue
        match = DATASET_COMMIT_LINE.search(output_text(cell))
        if match:
            return match.group(1)
    return None


def read_manifest(workdir):
    db_path = os.path.join(workdir, "explorer.db")
    if not os.path.exists(db_path):
        return None, None
    conn = sqlite3.connect(db_path)
    try:
        rows = dict(conn.execute("SELECT key, value FROM manifest"))
    finally:
        conn.close()
    counts = json.loads(rows["counts"]) if rows.get("counts") else {}
    return counts, os.path.getsize(db_path)


def find_last_verified_cell(nb):
    for cell in nb.cells:
        if cell.get("cell_type") == "markdown" and "## Last verified" in cell.get("source", ""):
            return cell
    return None


def stamp_provenance(nb, max_docs, dataset_commit, counts, db_size, workdir):
    cell = find_last_verified_cell(nb)
    if cell is None:
        raise SystemExit("notebook has no 'Last verified' markdown cell")

    runtime = "%s %s" % (platform.python_implementation(), platform.python_version())
    metadata = nb.get("metadata", {}).get("c3pa_explorer", {})
    schema = metadata.get("schema_version", "unknown")
    code_rev = metadata.get("code_rev", "unknown")
    built_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    counts = counts or {}

    lines = [
        "## Last verified -- PARTIAL SMOKE BUILD",
        "",
        "> **Smoke build only:** this notebook was executed with `MAX_DOCS = %d`, so"
        % max_docs,
        "> every count below is for **%s of 400 documents**, not the full corpus."
        % counts.get("documents", max_docs),
        "> Re-run with `MAX_DOCS = None` for a full snapshot.",
        "",
        "| Field | Value |",
        "| --- | --- |",
        "| Verified (UTC) | `%s` |" % built_at,
        "| Runtime | `%s` (local ipykernel smoke runner; not Google Colab) |" % runtime,
        "| Dataset commit | `%s` |" % (dataset_commit or "unknown"),
        "| Schema version | `%s` |" % schema,
        "| Code revision | `%s` |" % code_rev,
        "| MAX_DOCS | **%d (partial smoke build)** |" % max_docs,
    ]
    for key, label in (
        ("documents", "Documents"),
        ("units", "Units"),
        ("sentences", "Sentences"),
        ("fragments", "Fragments"),
        ("annotations", "Annotations"),
        ("aligned", "Aligned annotations"),
    ):
        if key in counts:
            lines.append("| %s | %s |" % (label, counts[key]))
    if db_size is not None:
        lines.append("| Snapshot size | %d bytes (not committed) |" % db_size)
    lines += [
        "",
        "Scratch build directory (outside the repo): `%s`. The download cell"
        % workdir,
        "used its non-Colab fallback, so no browser download occurred.",
        "",
    ]
    cell["source"] = "\n".join(lines)


def main(argv=None):
    args = parse_args(argv)

    try:
        import nbformat
        from nbclient import NotebookClient
    except ImportError as exc:
        raise SystemExit(
            "missing dev dependency: %s\nInstall with: python3 -m pip install "
            "nbformat nbclient ipykernel" % exc)

    with open(args.notebook, encoding="utf-8") as fh:
        notebook = nbformat.read(fh, as_version=4)

    patch_max_docs(notebook, args.max_docs)
    clear_execution(notebook)

    workdir = args.workdir or tempfile.mkdtemp(prefix="c3pa-colab-smoke-")
    os.makedirs(workdir, exist_ok=True)

    os.environ["C3PA_COLAB_WORKDIR"] = workdir
    # Debian/Ubuntu system interpreters need this for the notebook's pip cell.
    os.environ.setdefault("PIP_BREAK_SYSTEM_PACKAGES", "1")

    print("executing %s (MAX_DOCS=%d) in %s" % (args.notebook, args.max_docs, workdir))
    client = NotebookClient(
        notebook,
        timeout=args.timeout,
        startup_timeout=60,
        kernel_name="python3",
        resources={"metadata": {"path": workdir}},
    )
    client.execute()

    dataset_commit = find_dataset_commit(notebook)
    if dataset_commit is None:
        git_dir = os.path.join(workdir, "C3PA_Dataset")
        if os.path.isdir(os.path.join(git_dir, ".git")):
            import subprocess
            dataset_commit = subprocess.check_output(
                ["git", "-C", git_dir, "rev-parse", "HEAD"], text=True).strip()
    counts, db_size = read_manifest(workdir)

    stamp_provenance(notebook, args.max_docs, dataset_commit, counts, db_size, workdir)
    nbformat.write(notebook, args.notebook)

    print("stamped Last verified; wrote %s" % args.notebook)
    if counts:
        print("counts:", ", ".join("%s=%s" % (k, counts[k]) for k in
                                   ("documents", "units", "sentences", "fragments")
                                   if k in counts))
    print("scratch build dir:", workdir)
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Fail if the committed Colab notebook has drifted from the backend sources.

`scripts/build_colab_notebook.py` vendors backend/__init__.py, backend/db.py,
backend/extract.py, and backend/ingest.py into `%%writefile` cells. A plain
regeneration diff would also erase executed outputs, so this check compares
cell SOURCES and STRUCTURE only -- `outputs`, `execution_count`, `generated_at`,
and the baked `code_rev` value are intentionally ignored.

It also requires the "Last verified" provenance cell to be stamped (not the
freshly generated placeholder), so a regenerate -> execute -> commit workflow
cannot silently drop the smoke-build evidence.

    python3 scripts/check_notebook_sync.py

Stdlib only (supports the repo's bare python3). Exits non-zero on drift.
"""
import argparse
import difflib
import importlib.util
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GENERATOR = os.path.join(HERE, "build_colab_notebook.py")
NOTEBOOK = os.path.join(ROOT, "notebooks", "build_snapshot_colab.ipynb")

# The manifest cell bakes the repo revision at generation time. It is volatile
# by design (regeneration on a new commit must not fail the sync check).
_CODE_REV_LINE = re.compile(r'(?m)^code_rev = ".*"$')

LAST_VERIFIED_REQUIRED = (
    "last verified",
    "smoke",
    "max_docs",
    "dataset commit",
    "schema version",
    "code revision",
    "runtime",
)
LAST_VERIFIED_PLACEHOLDER_MARKERS = (
    "not yet executed",
    "run `scripts/run_colab_smoke.py`",
)

MAX_DIFF_LINES = 40


def load_generator():
    spec = importlib.util.spec_from_file_location("build_colab_notebook", GENERATOR)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def cell_source(cell):
    src = cell.get("source", "")
    if isinstance(src, list):
        return "".join(src)
    return src


def normalize(source):
    return _CODE_REV_LINE.sub('code_rev = "<CODE_REV>"', source)


def show_diff(expected, actual, label):
    diff = list(difflib.unified_diff(
        expected.splitlines(keepends=True),
        actual.splitlines(keepends=True),
        fromfile="generated " + label,
        tofile="committed " + label,
        n=2,
    ))
    if len(diff) > MAX_DIFF_LINES:
        diff = diff[:MAX_DIFF_LINES] + ["... (diff truncated)\n"]
    return "".join(diff)


def check_provenance(source):
    text = source.lower()
    missing = [needle for needle in LAST_VERIFIED_REQUIRED if needle not in text]
    if missing:
        return ["Last verified cell is missing: " + ", ".join(missing)]
    placeholders = [m for m in LAST_VERIFIED_PLACEHOLDER_MARKERS if m in text]
    if placeholders:
        return ["Last verified cell is still the unexecuted placeholder "
                "(run scripts/run_colab_smoke.py)"]
    return []


def main(argv=None):
    ap = argparse.ArgumentParser(description="Check notebook source drift (stdlib only).")
    ap.add_argument("--notebook", default=NOTEBOOK)
    args = ap.parse_args(argv)
    notebook_path = args.notebook

    errors = []
    with open(notebook_path, encoding="utf-8") as fh:
        notebook = json.load(fh)

    gen = load_generator()
    expected_cells = gen.build_cells("<CODE_REV>")
    actual_cells = notebook.get("cells", [])

    if len(expected_cells) != len(actual_cells):
        errors.append(
            "cell count drifted: generated %d, committed %d "
            "(regenerate with scripts/build_colab_notebook.py)"
            % (len(expected_cells), len(actual_cells)))

    last_verified_idx = None
    for i, expected in enumerate(expected_cells):
        if expected.get("cell_type") == "markdown" and "## Last verified" in cell_source(expected):
            last_verified_idx = i
            break

    for i, (expected, actual) in enumerate(zip(expected_cells, actual_cells)):
        label = "cell %d" % i
        if expected.get("cell_type") != actual.get("cell_type"):
            errors.append("%s type drifted: generated %r, committed %r"
                          % (label, expected.get("cell_type"), actual.get("cell_type")))
            continue

        if i == last_verified_idx:
            errors.extend("%s: %s" % (label, e) for e in check_provenance(cell_source(actual)))
            continue

        expected_source = normalize(cell_source(expected))
        actual_source = normalize(cell_source(actual))
        if expected_source != actual_source:
            first = actual_source.splitlines()[0] if actual_source else "<empty>"
            errors.append("%s source drifted (%s):\n%s"
                          % (label, first[:60], show_diff(expected_source, actual_source, label)))

    metadata = notebook.get("metadata", {}).get("c3pa_explorer", {})
    if metadata.get("schema_version") != gen.SNAPSHOT_SCHEMA_VERSION:
        errors.append("metadata schema_version drifted: generated %r, committed %r"
                      % (gen.SNAPSHOT_SCHEMA_VERSION, metadata.get("schema_version")))
    if metadata.get("vendored_files") != gen.VENDORED_FILES:
        errors.append("metadata vendored_files drifted: generated %r, committed %r"
                      % (gen.VENDORED_FILES, metadata.get("vendored_files")))

    if errors:
        print("Notebook source sync check FAILED (%s)" % notebook_path)
        for err in errors:
            print("- " + err)
        print("\nFix: python3 scripts/build_colab_notebook.py, then re-run the smoke build.")
        return 1

    print("Notebook source sync check passed (%d cells, %d vendored files)."
          % (len(actual_cells), len(gen.VENDORED_FILES)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

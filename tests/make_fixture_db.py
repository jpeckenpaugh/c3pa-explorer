#!/usr/bin/env python3
"""Build a small, deterministic fixture DB for tests and CI.

The canonical snapshot archive checked into the repo (`builds.json` →
`c3pa-db_v0.1_<db8>.tar.gz`) is the single source of truth. This script
extracts its `explorer.db`, keeps the first N documents from each subset
(default 5 DB + 5 WS), and writes a compact SQLite DB with the same schema
and the `manifest` provenance table. It never builds the 400-document corpus
and needs no dataset submodule or network access.

Usage:
    python tests/make_fixture_db.py --out data/explorer.db
    C3PA_DB_PATH=data/explorer.db ./tests.sh
"""

import argparse
import json
import os
import sqlite3
import sys
import tarfile
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from backend.db import SCHEMA  # noqa: E402

DEFAULT_ARCHIVE = os.path.join(ROOT, "c3pa-db_v0.1_663586da.tar.gz")
DEFAULT_OUT = os.path.join(ROOT, "data", "explorer.db")

MANIFEST_SCHEMA = "CREATE TABLE IF NOT EXISTS manifest (key TEXT PRIMARY KEY, value TEXT)"


def parse_args(argv):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--archive", default=None,
                    help="canonical snapshot tar.gz (default: latest builds.json entry)")
    ap.add_argument("--out", default=DEFAULT_OUT, help="fixture DB path to write")
    ap.add_argument("--docs-per-subset", type=int, default=5,
                    help="documents to keep from each subset (default: 5)")
    return ap.parse_args(argv)


def archive_path_from_registry():
    try:
        builds = json.load(open(os.path.join(ROOT, "builds.json"), encoding="utf-8"))
        return os.path.join(ROOT, builds["builds"][0]["file"])
    except Exception:
        return DEFAULT_ARCHIVE


def extract_db(archive, dest):
    with tarfile.open(archive, "r:gz") as tf:
        members = [m for m in tf.getmembers() if m.isfile() and m.name.lower().endswith(".db")]
        if len(members) != 1:
            raise SystemExit(f"expected exactly one .db in {archive}; got {[m.name for m in members]}")
        src = tf.extractfile(members[0])
        with open(dest, "wb") as out:
            while True:
                chunk = src.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
        return members[0].name


def copy_docs(conn, doc_ids):
    marks = ",".join("?" for _ in doc_ids)
    conn.execute(
        f"INSERT INTO documents SELECT * FROM src.documents WHERE doc_id IN ({marks})",
        doc_ids,
    )
    conn.execute(
        f"INSERT INTO annotations SELECT * FROM src.annotations WHERE doc_id IN ({marks})",
        doc_ids,
    )
    conn.execute(
        f"INSERT INTO text_units SELECT * FROM src.text_units WHERE doc_id IN ({marks})",
        doc_ids,
    )
    conn.execute(
        "INSERT INTO unit_labels SELECT * FROM src.unit_labels WHERE unit_id IN "
        f"(SELECT unit_id FROM src.text_units WHERE doc_id IN ({marks}))",
        doc_ids,
    )
    conn.execute(
        "INSERT INTO alignment SELECT * FROM src.alignment WHERE unit_id IN "
        f"(SELECT unit_id FROM src.text_units WHERE doc_id IN ({marks}))",
        doc_ids,
    )
    has_manifest = conn.execute(
        "SELECT 1 FROM src.sqlite_master WHERE type='table' AND name='manifest'"
    ).fetchone()
    if has_manifest:
        conn.execute("INSERT INTO manifest SELECT * FROM src.manifest")


def main(argv=None):
    args = parse_args(argv)
    archive = os.path.abspath(args.archive or archive_path_from_registry())
    if not os.path.exists(archive):
        raise SystemExit(f"canonical snapshot archive not found: {archive}")

    out_path = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    for suffix in ("", "-wal", "-shm"):
        try:
            os.remove(out_path + suffix)
        except FileNotFoundError:
            pass

    with tempfile.TemporaryDirectory(prefix="c3pa-fixture-") as tmp:
        src_path = os.path.join(tmp, "source.db")
        member = extract_db(archive, src_path)

        conn = sqlite3.connect(out_path)
        try:
            conn.execute("PRAGMA foreign_keys = OFF")
            conn.execute("PRAGMA journal_mode = DELETE")
            conn.executescript(SCHEMA)
            conn.executescript(MANIFEST_SCHEMA)
            conn.execute("ATTACH DATABASE ? AS src", (src_path,))

            doc_ids = []
            for subset in ("DB", "WS"):
                rows = conn.execute(
                    "SELECT doc_id FROM src.documents WHERE subset = ? ORDER BY num LIMIT ?",
                    (subset, args.docs_per_subset),
                ).fetchall()
                doc_ids.extend(r[0] for r in rows)
            if not doc_ids:
                raise SystemExit(f"no documents found in {member} of {archive}")

            copy_docs(conn, doc_ids)
            conn.commit()
            conn.execute("DETACH DATABASE src")
            conn.execute("VACUUM")
        finally:
            conn.close()

    conn = sqlite3.connect(out_path)
    try:
        counts = {
            table: conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
            for table in ("documents", "annotations", "text_units", "unit_labels", "alignment")
        }
    finally:
        conn.close()

    print(f"source : {archive} ({member})")
    print(f"fixture: {out_path} ({os.path.getsize(out_path):,} bytes)")
    print(f"docs   : {doc_ids[0]} .. {doc_ids[-1]} ({len(doc_ids)} total)")
    print("counts : " + json.dumps(counts, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())

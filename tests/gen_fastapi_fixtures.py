#!/usr/bin/env python3
"""Phase 0 parity fixture generator (FastAPI side).

Runs the real FastAPI routers via TestClient against data/explorer.db and
writes one file of the RAW response bytes (utf-8 JSON) per manifest entry to
tests/expected/ (gitignored). Both the params list and the derived-id rules
are shared with tests/jbrowser_parity.test.js via tests/fixtures.manifest.json.

WAL hygiene (section 5a.B2): this generator FIRST opens the DB and runs
`PRAGMA wal_checkpoint(TRUNCATE)` with NO writes (db.py flips journal_mode to
WAL on connect, so -wal may otherwise hold pages invisible to the raw byte
load used by sql.js). After the checkpoint nothing writes to the DB, so the
sql.js byte-read and the Python reads see the same complete file.

Skips (exit 0 with a message) when data/explorer.db is absent.
"""

import json
import os
import sqlite3
import sys
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

DB_PATH = os.path.join(ROOT, "data", "explorer.db")
MANIFEST_PATH = os.path.join(ROOT, "tests", "fixtures.manifest.json")
EXPECTED_DIR = os.path.join(ROOT, "tests", "expected")


def main() -> int:
    if not os.path.exists(DB_PATH):
        print(f"Skipping fixture generation: {DB_PATH} not found (snapshot build is a hard dependency).")
        return 0

    # 5a.B2: complete the main file without any writes.
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")

    # Import here so the skip path never needs FastAPI installed.
    from fastapi.testclient import TestClient
    from backend.main import app

    os.makedirs(EXPECTED_DIR, exist_ok=True)
    manifest = json.load(open(MANIFEST_PATH, encoding="utf-8"))
    entries = manifest["entries"]
    client = TestClient(app)

    seeds = {
        "DOC_ID": client.get("/api/documents", params={"limit": "1"}).json()["rows"][0]["doc_id"],
        "UNIT_ID": client.get("/api/units", params={"limit": "1"}).json()["rows"][0]["unit_id"],
        "ANNOTATION_ID": client.get("/api/annotations", params={"limit": "1", "offset": "0"}).json()["rows"][0]["annotation_id"],
    }

    def resolve(text: str) -> str:
        for token, value in seeds.items():
            text = text.replace("{" + token + "}", str(value))
        return text

    written = 0
    for entry in entries:
        path = resolve(entry["path"])
        params = {k: resolve(v) for k, v in entry.get("params", {}).items()}
        url = path + "?" + urllib.parse.urlencode(params) if params else path
        res = client.get(url)
        if res.status_code != 200:
            raise SystemExit(
                f"Fixture {entry['id']}: expected 200 from {url}, got {res.status_code} — "
                "manifest must only contain 200-path requests."
            )
        out = os.path.join(EXPECTED_DIR, entry["file"])
        with open(out, "wb") as f:
            f.write(res.content)
        written += 1

    print(f"Wrote {written} fixture files to {EXPECTED_DIR}/")
    print("Derived seeds:", json.dumps(seeds, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
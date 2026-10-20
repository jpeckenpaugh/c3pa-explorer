#!/usr/bin/env python3
"""Verify the canonical snapshot URL recorded in builds.json.

Two modes:
  head  - lightweight check that the URL returns HTTP 200 (PR CI).
  full  - download the archive and verify both recorded hashes:
            sha256(downloaded tar.gz) == envelope_hash
            sha256(extracted explorer.db) == db_sha256
          (main pushes, scheduled runs, release checks).

Stdlib only. Usage:
    python scripts/verify_snapshot.py --mode head
    python scripts/verify_snapshot.py --mode full
"""

import argparse
import hashlib
import io
import json
import os
import sys
import tarfile
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILDS_PATH = os.path.join(ROOT, "builds.json")
USER_AGENT = "c3pa-explorer-snapshot-verifier/1.0"


def parse_args(argv):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--mode", choices=("head", "full"), default="head")
    ap.add_argument("--builds", default=BUILDS_PATH, help="snapshot registry json")
    ap.add_argument("--timeout", type=float, default=60.0, help="HTTP timeout seconds")
    return ap.parse_args(argv)


def load_entry(path):
    registry = json.load(open(path, encoding="utf-8"))
    builds = registry.get("builds") or []
    if not builds:
        raise SystemExit(f"no builds recorded in {path}")
    return sorted(builds, key=lambda b: b.get("version", ""))[-1]


def request(url, method, timeout):
    req = urllib.request.Request(url, method=method, headers={"User-Agent": USER_AGENT})
    return urllib.request.urlopen(req, timeout=timeout)


def check_head(entry, timeout):
    url = entry["url"]
    print(f"HEAD {url}")
    with request(url, "HEAD", timeout) as res:
        status = res.status
    if status != 200:
        raise SystemExit(f"canonical URL returned HTTP {status}: {url}")
    print("  HTTP 200 OK")


def check_full(entry, timeout):
    url = entry["url"]
    print(f"GET  {url}")
    with request(url, "GET", timeout) as res:
        if res.status != 200:
            raise SystemExit(f"canonical URL returned HTTP {res.status}: {url}")
        archive = res.read()
    envelope = hashlib.sha256(archive).hexdigest()
    print(f"  downloaded {len(archive):,} bytes")
    print(f"  envelope  {envelope}")
    print(f"  recorded  {entry['envelope_hash']}")
    if envelope != entry["envelope_hash"]:
        raise SystemExit("envelope_hash mismatch: downloaded archive does not match builds.json")

    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tf:
        members = [m for m in tf.getmembers() if m.isfile() and m.name.lower().endswith(".db")]
        if len(members) != 1:
            raise SystemExit(f"expected exactly one .db in archive; got {[m.name for m in members]}")
        db_bytes = tf.extractfile(members[0]).read()
    db_sha = hashlib.sha256(db_bytes).hexdigest()
    print(f"  db        {members[0].name} ({len(db_bytes):,} bytes)")
    print(f"  db sha256 {db_sha}")
    print(f"  recorded  {entry['db_sha256']}")
    if db_sha != entry["db_sha256"]:
        raise SystemExit("db_sha256 mismatch: extracted database does not match builds.json")
    if "db_bytes" in entry and len(db_bytes) != entry["db_bytes"]:
        raise SystemExit(
            f"db_bytes mismatch: downloaded {len(db_bytes):,}, recorded {entry['db_bytes']:,}"
        )
    print("  hashes verified")


def main(argv=None):
    args = parse_args(argv)
    entry = load_entry(args.builds)
    try:
        if args.mode == "head":
            check_head(entry, args.timeout)
        else:
            check_full(entry, args.timeout)
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"canonical URL returned HTTP {exc.code}: {entry['url']}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"could not reach canonical URL {entry['url']}: {exc.reason}") from exc
    print(f"OK: {entry['version']} snapshot ({args.mode})")
    return 0


if __name__ == "__main__":
    sys.exit(main())

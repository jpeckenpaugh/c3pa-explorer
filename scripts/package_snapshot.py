#!/usr/bin/env python3
"""Package a C3PA Explorer snapshot into a canonical tar.gz deliverable.

Snapshot model (as specified):
  explorer.zip (pure source)  --unzip-->  explorer.db bytes
  db_sha256 = sha256(bytes)                 (e.g. ...1234)
  meta_<sha8>.md    file naming the db hash, contains the FULL db sha256
  explorer_<sha8>.tar.gz  = { explorer.db, meta_<sha8>.md }
  envelope_sha256 = sha256(explorer_<sha8>.tar.gz)     (e.g. ...abcd)
  builds.json (github-published registry): { file: "explorer_<sha8>.tar.gz",
                                             envelope_hash: abcd, db_sha256, counts, ... }

Chain of trust: db hash is exposed in the artifact NAMES (convenience + human
cross-check); the authoritative anchor is the published builds.json, which pins
the envelope hash (of the whole tar.gz) and the db hash together.

Stdlib only, Python 3.9-compatible. Deterministic output (tar mtime=0).
"""
import argparse
import hashlib
import io
import json
import os
import sqlite3
import tarfile
import tempfile
import zipfile
from datetime import datetime, timezone


def parse_args(argv):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--zip", default="explorer.zip", help="pure source zip (single .db entry)")
    ap.add_argument("--version", default="v0.1", help="snapshot version tag, e.g. v0.1")
    ap.add_argument("--out-dir", default=".", help="where to write the tar.gz + meta")
    ap.add_argument("--builds", default="builds.json", help="registry json to update/append")
    ap.add_argument("--sha-length", type=int, default=8, help="short-hash prefix length for names")
    ap.add_argument("--db-name", default="explorer.db", help="member name for the db inside the archive")
    ap.add_argument("--archive-prefix", default="c3pa-db", help="archive name prefix (canonical URL uses this)")
    ap.add_argument("--canonical-prefix", default="https://github.com/jpeckenpaugh/c3pa-explorer",
                    help="repo base URL for the published snapshot path")
    return ap.parse_args(argv)


def unzip_db(path):
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if not n.startswith("__MACOSX/")]
        dbs = [n for n in names if n.lower().endswith(".db")]
        if len(dbs) != 1:
            raise SystemExit(f"expected exactly one .db in {path}; got {dbs or names}")
        return z.read(dbs[0]), dbs[0]


def open_db(db_bytes):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.write(db_bytes)
    tmp.close()
    return sqlite3.connect(tmp.name), tmp.name


def live_counts(db_bytes):
    con, path = open_db(db_bytes)
    try:
        cur = con.cursor()
        tables = [r[0] for r in cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        return {t: cur.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tables}
    finally:
        con.close()
        os.unlink(path)


def read_manifest(db_bytes):
    con, path = open_db(db_bytes)
    try:
        cur = con.cursor()
        has = cur.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='manifest'").fetchone()
        manifest = {}
        if has:
            for k, v in cur.execute("SELECT key, value FROM manifest ORDER BY key"):
                manifest[k] = v
        return manifest
    finally:
        con.close()
        os.unlink(path)


def build_meta(db_bytes, counts, manifest, version, sha_short, sha_full, canonical_url):
    now = datetime.now(timezone.utc).isoformat()
    lines = [
        f"# C3PA Explorer Snapshot — {version}",
        "",
        f"- canonical_url: `{canonical_url}`",
        f"- db_sha256: `{sha_full}`",
        f"- db_short: `{sha_short}`",
        f"- db_bytes: {len(db_bytes)}",
        f"- built_at: {manifest.get('built_at', now)}",
        f"- schema_version: {manifest.get('schema_version', 'unknown')}",
        f"- dataset_commit: `{manifest.get('dataset_commit', 'unknown')}`",
        f"- code_rev: `{manifest.get('code_rev', 'unknown')}`",
        "",
        "## Row counts per table (secondary verification)",
        "",
        "| table | rows |",
        "| :--- | ---: |",
    ]
    for t in sorted(counts):
        lines.append(f"| {t} | {counts[t]:,} |")
    m = manifest.get("counts")
    if m:
        try:
            parsed = json.loads(m)
            lines.append("")
            lines.append("## Manifest counts (build-time records)")
            for k in sorted(parsed):
                lines.append(f"- {k}: {parsed[k]}")
        except Exception:
            pass
    lines.append("")
    lines.append("> Chain of trust: this hash and the filename prefix are convenience")
    lines.append("> cross-checks. The authoritative anchor is the published")
    lines.append("> `builds.json` registry, which pins the envelope hash (of the")
    lines.append("> whole tar.gz) together with this db hash.")
    return "\n".join(lines) + "\n"


def main(argv=None):
    args = parse_args(argv)

    db_bytes, _inner = unzip_db(args.zip)
    print(f"unzipped '{args.zip}' -> {len(db_bytes):,} bytes")

    db_sha = hashlib.sha256(db_bytes).hexdigest()
    n = args.sha_length
    db_short = db_sha[:n]
    counts = live_counts(db_bytes)
    manifest = read_manifest(db_bytes)
    print(f"db_sha256   : {db_sha}")
    print(f"db_short    : {db_short}")
    print(f"counts      : {json.dumps(counts)}")

    # 1) meta_<sha8>.md — named with the db short hash, contains the full hash.
    # 2) canonical archive: c3pa-db_{version}_{sha8}.tar.gz, with its own URL
    #    (db hash embedded in the name) recorded as a field inside the bundle.
    archive_name = f"{args.archive_prefix}_{args.version}_{db_short}.tar.gz"
    canonical_url = f"{args.canonical_prefix}/snapshots/{archive_name}"

    meta_name = f"meta_{db_short}.md"
    meta_bytes = build_meta(db_bytes, counts, manifest, args.version, db_short, db_sha,
                            canonical_url).encode("utf-8")
    meta_path = os.path.join(args.out_dir, meta_name)
    with open(meta_path, "wb") as fh:
        fh.write(meta_bytes)
    print(f"wrote {meta_path}")

    # 3) c3pa-db_{version}_{sha8}.tar.gz = { explorer.db, meta_<sha8>.md }
    archive_path = os.path.join(args.out_dir, archive_name)
    with tarfile.open(archive_path, "w:gz", compresslevel=9, format=tarfile.GNU_FORMAT) as tf:
        for name, data in ((args.db_name, db_bytes), (meta_name, meta_bytes)):
            ti = tarfile.TarInfo(name)
            ti.size = len(data)
            ti.mtime = 0
            tf.addfile(ti, io.BytesIO(data))
    print(f"wrote {archive_path}  ({os.path.getsize(archive_path)/1e6:.2f} MB)")

    # 4) envelope hash = sha256 of the tar.gz itself
    envelope_sha = hashlib.sha256(open(archive_path, "rb").read()).hexdigest()
    print(f"envelope_sha: {envelope_sha}")

    # 5) builds.json registry entry — the published, authoritative anchor.
    entry = {
        "version": args.version,
        "file": archive_name,
        "url": canonical_url,
        "envelope_hash": envelope_sha,
        "db_sha256": db_sha,
        "db_short": db_short,
        "db_bytes": len(db_bytes),
        "counts": counts,
        "schema_version": manifest.get("schema_version", "unknown"),
        "dataset_commit": manifest.get("dataset_commit", "unknown"),
        "built_at": manifest.get("built_at", datetime.now(timezone.utc).isoformat()),
    }
    registry = {"builds": []}
    if os.path.exists(args.builds):
        try:
            registry = json.load(open(args.builds))
        except Exception:
            registry = {"builds": []}
        registry.setdefault("builds", [])
        registry["builds"] = [b for b in registry["builds"] if b.get("version") != args.version]
    registry["builds"].append(entry)
    registry["builds"].sort(key=lambda b: b["version"])
    with open(args.builds, "w") as fh:
        json.dump(registry, fh, indent=2)
        fh.write("\n")
    print(f"registry: {args.builds} (+{args.version})\n")
    print("=== builds.json entry ===")
    print(json.dumps(entry, indent=2))


if __name__ == "__main__":
    main()
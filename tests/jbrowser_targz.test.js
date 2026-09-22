// Phase 2 — snapshot tar.gz extraction test. Verifies browser/js/core/snapshot-targz.js
// against the canonical deliverable produced by scripts/package_snapshot.py:
//   explorer_<db_short>.tar.gz = { explorer.db, meta_<db_short>.md }
// The extractor must find explorer.db, open it in sql.js with the known-good
// counts, and validate against the embedded manifest.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "../frontend/sqljs/vendor/sql.js/sql-wasm.js";
import { isGzipBytes, extractSingleDbFromTarGz } from "../frontend/sqljs/js/core/snapshot-targz.js";
import { validateManifest } from "../frontend/sqljs/js/core/bridge.js";
import { SNAPSHOT_SCHEMA_VERSION } from "../frontend/sqljs/js/core/snapshot-version.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const SQLJS_DIR = path.join(ROOT, "frontend", "sqljs", "vendor", "sql.js");

// Canonical archive name from builds.json (db short-hash prefix).
const builds = JSON.parse(fs.readFileSync(path.join(ROOT, "builds.json"), "utf8"));
const entry = builds.builds[0];
const ARCHIVE_PATH = path.join(ROOT, entry.file);

const gzBytes = new Uint8Array(fs.readFileSync(ARCHIVE_PATH));

test("targz: isGzipBytes detects the snapshot archive", () => {
  assert.ok(isGzipBytes(gzBytes));
  assert.ok(!isGzipBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04])));
});

test("targz: envelope hash in builds.json matches the archive bytes", () => {
  const digest = crypto.createHash("sha256").update(gzBytes).digest("hex");
  assert.equal(digest, entry.envelope_hash, "envelope_hash");
  assert.ok(
    entry.file.startsWith(`c3pa-db_${entry.version}_${entry.db_short}`),
    "filename uses version + db short hash"
  );
});

test("targz: extractSingleDbFromTarGz yields a valid sql.js database", async () => {
  const { name, bytes } = await extractSingleDbFromTarGz(gzBytes);
  assert.ok(name.toLowerCase().endsWith(".db"), `entry name ${name}`);
  assert.equal(bytes.length, entry.db_bytes, `db_bytes ${bytes.length}`);

  const SQL = await initSqlJs({ locateFile: (f) => path.join(SQLJS_DIR, f) });
  const db = new SQL.Database(bytes);
  db.run("PRAGMA foreign_keys=ON");
  const stmt = db.prepare("SELECT COUNT(*) AS n FROM documents");
  stmt.step();
  assert.equal(stmt.getAsObject().n, entry.counts.documents);
  stmt.free();
  db.close();
});

test("targz: manifest inside the archive matches the agreed schema version", async () => {
  const { bytes } = await extractSingleDbFromTarGz(gzBytes);
  const SQL = await initSqlJs({ locateFile: (f) => path.join(SQLJS_DIR, f) });
  const db = new SQL.Database(bytes);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='manifest'");
  const has = tables.step();
  tables.free();
  if (!has) {
    db.close();
    console.log("  (old-format snapshot without manifest — skip validation)");
    return;
  }
  const st = db.prepare("SELECT key, value FROM manifest ORDER BY key");
  const rows = [];
  while (st.step()) rows.push(st.getAsObject());
  st.free();
  db.close();
  const verdict = validateManifest({ rows }, SNAPSHOT_SCHEMA_VERSION);
  assert.equal(verdict.ok, true, `manifest should validate (reason=${verdict.reason})`);
});
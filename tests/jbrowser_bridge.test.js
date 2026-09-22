// Phase 2 — browser-edition bridge tests (URL→param parsing + manifest
// validation). Pure and browser-free: imports browser/js/core/{bridge,
// snapshot-version}.js under `node --test` — no Worker, no DOM, no
// data/explorer.db (§7b.9/§7b.10). sql.js-under-Node is proven by the Phase 0
// parity suite; here an in-memory SQL.Database only proves the manifest SQL
// reads + the pure validator agree.
//
// tests/fixtures.manifest.json is consumed READ-ONLY: every manifest entry's
// path+params must parse to the same handler + coerced args the parity harness
// drives through createQuery(). The {DOC_ID}/{UNIT_ID}/{ANNOTATION_ID} path
// tokens are substituted with SYNTHETIC ids so the assertions stay independent
// of the database.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "../frontend/sqljs/vendor/sql.js/sql-wasm.js";
import { parseRequestUrl, validateManifest, createBridge } from "../frontend/sqljs/js/core/bridge.js";
import { SNAPSHOT_SCHEMA_VERSION } from "../frontend/sqljs/js/core/snapshot-version.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const SQLJS_DIR = path.join(ROOT, "frontend", "sqljs", "vendor", "sql.js");
const MANIFEST_PATH = path.join(HERE, "fixtures.manifest.json");

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const SYNTHETIC = { DOC_ID: "DB1", UNIT_ID: "42", ANNOTATION_ID: "12345" };

const resolveTokens = (text) =>
  text.replace(/\{(DOC_ID|UNIT_ID|ANNOTATION_ID)\}/g, (tok) => SYNTHETIC[tok.slice(1, -1)]);

function toQueryString(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) sp.set(String(k), resolveTokens(String(v)));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function resolvedParams(params) {
  const out = {};
  for (const [k, v] of Object.entries(params || {})) out[k] = resolveTokens(String(v));
  return out;
}

function assertThrowsStatus(fn, status) {
  try {
    fn();
    assert.fail(`expected a route error with status ${status}`);
  } catch (error) {
    assert.equal(error.status, status, `status for thrown route error (got ${error.message})`);
  }
}

// ---- (a) URL→param parsing over the shared fixtures manifest ----------------

for (const entry of manifest.entries) {
  test(`bridge parseRequestUrl: ${entry.id}`, () => {
    const url = resolveTokens(entry.path) + toQueryString(entry.params);
    const parsed = parseRequestUrl(url);
    assert.equal(parsed.handler, entry.call.method, `handler for ${entry.id}`);

    if (entry.call.pathArgs) {
      let expectedArgs = entry.call.pathArgs.map(resolveTokens);
      if (entry.call.method === "annotationDetail") expectedArgs = expectedArgs.map(Number);
      assert.deepEqual(parsed.args, expectedArgs, `path args for ${entry.id}`);
    } else {
      assert.equal(parsed.args.length, 1, `query-arg bundle for ${entry.id}`);
      assert.deepEqual(parsed.args[0], resolvedParams(entry.params || {}), `coerced query params for ${entry.id}`);
    }
  });
}

// ---- (b) manifest validation (pure validator + synthetic sql.js DB) ---------

let sqlPromise = null;
const getSQL = () => (sqlPromise ||= initSqlJs({ locateFile: (f) => path.join(SQLJS_DIR, f) }));

function run(db, sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    if (params && params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

function buildManifestPayload(SQL, { schemaVersion = SNAPSHOT_SCHEMA_VERSION } = {}) {
  const db = new SQL.Database(); // in-memory synthetic snapshot
  db.run("CREATE TABLE manifest (key TEXT PRIMARY KEY, value TEXT)");
  db.run("CREATE TABLE documents (doc_id TEXT PRIMARY KEY)");
  db.run("INSERT INTO manifest VALUES ('schema_version', ?)", [schemaVersion]);
  db.run("INSERT INTO manifest VALUES ('counts', ?)", ['{"documents":1}']);
  return { db, rows: run(db, "SELECT key, value FROM manifest ORDER BY key") };
}

test("bridge: validateManifest accepts a matching synthetic snapshot", async () => {
  const SQL = await getSQL();
  const { db, rows } = buildManifestPayload(SQL);
  const verdict = validateManifest({ rows }, SNAPSHOT_SCHEMA_VERSION);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.manifest.schema_version, SNAPSHOT_SCHEMA_VERSION);
  assert.equal(JSON.parse(verdict.manifest.counts).documents, 1);
  db.close();
});

test("bridge: validateManifest rejects a schema_version mismatch", async () => {
  const SQL = await getSQL();
  const { db, rows } = buildManifestPayload(SQL, { schemaVersion: "some-other-v2" });
  const verdict = validateManifest({ rows }, SNAPSHOT_SCHEMA_VERSION);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "version_mismatch");
  assert.equal(verdict.actual, "some-other-v2");
  assert.equal(verdict.expected, SNAPSHOT_SCHEMA_VERSION);
  db.close();
});

test("bridge: validateManifest reports a snapshot with no manifest table", () => {
  const verdict = validateManifest({ missing: true }, SNAPSHOT_SCHEMA_VERSION);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "missing");
});

// ---- (c) route-precedence + error mapping (404/422/501) ---------------------

test("bridge: /api/documents/order matches before /api/documents/{doc_id}", () => {
  const parsed = parseRequestUrl("/api/documents/order");
  assert.equal(parsed.handler, "documentsOrder");
  assert.deepEqual(parsed.args, [{}]);
});

test("bridge: {annotation_id} coerces to Number; non-integers are 422", () => {
  assert.deepEqual(parseRequestUrl("/api/annotations/12345").args, [12345]);
  assertThrowsStatus(() => parseRequestUrl("/api/annotations/abc"), 422);
  assertThrowsStatus(() => parseRequestUrl("/api/annotations/12.5"), 422);
});

test("bridge: bad int / bool query params are 422", () => {
  assertThrowsStatus(() => parseRequestUrl("/api/documents?limit=abc"), 422);
  assertThrowsStatus(() => parseRequestUrl("/api/units?min_annotators="), 422);
  assertThrowsStatus(() => parseRequestUrl("/api/units?high_confidence=banana"), 422);
});

test("bridge: /api/alignment passes unit_id as a positional arg (no 404)", () => {
  const parsed = parseRequestUrl("/api/alignment?unit_id=42");
  assert.equal(parsed.handler, "alignment");
  assert.deepEqual(parsed.args, ["42"]);
});

test("bridge: export endpoints route to export handlers (no 501)", () => {
  assert.equal(parseRequestUrl("/api/export?format=csv").export, true);
  assert.equal(parseRequestUrl("/api/export/preview?format=csv").export, true);
  // recognized but rejected
  assertThrowsStatus(() => parseRequestUrl("/api/documents/DB1/html"), 501);
});

test("bridge: unknown paths are 404 Not Found", () => {
  assertThrowsStatus(() => parseRequestUrl("/api/does-not-exist"), 404);
});

test("bridge: SNAPSHOT_SCHEMA_VERSION is the agreed constant", () => {
  assert.equal(SNAPSHOT_SCHEMA_VERSION, "c3pa-explorer-snapshot-v1");
});

// ---- (d) fetchJSON return path (regression: reply IS the response object) ----

/** A fake worker client resolving `dispatch` with the stats payload directly,
 *  exactly as the real worker's `call` resolves with `data.result`. */
function fakeClientWithResult(result) {
  return {
    async call(op, payload) {
      assert.equal(op, "dispatch");
      return result;
    },
  };
}

test("bridge: fetchJSON returns the worker reply as the JSON body", async () => {
  const statsBody = { documents: 400, sentences: 84985, fragments: 36302, annotations: 45121, label_distribution: [], annotators: [], single_label_sentences: 0, multi_label_sentences: 0, single_label_stars: {}, multi_label_stars: {} };
  // Regression: this must resolve the OBJECT, not `reply.result` (which would
  // be undefined and crash dashboard.js reading `s.documents`).
  const facade = createBridge({ client: fakeClientWithResult(statsBody) });
  facade.resolveReady({ error: null });
  const body = await facade.fetchJSON("/api/stats");
  assert.equal(body.documents, 400);
  assert.equal(body.sentences, 84985);
});

test("bridge: fetchJSON surfaces a dispatch error with HTTP status + detail", async () => {
  const facade = createBridge({
    client: { async call() { throw Object.assign(new Error("unknown document DB_X"), { status: 404, detail: "unknown document DB_X" }); } },
  });
  facade.resolveReady({ error: null });
  try {
    await facade.fetchJSON("/api/documents/DB_X");
    assert.fail("expected an HTTP 404 error");
  } catch (error) {
    assert.equal(error.status, 404);
    assert.equal(error.message, "unknown document DB_X");
  }
});

test("bridge: fetchJSON blocks on `ready` until boot resolves it", () => {
  const facade = createBridge({ client: fakeClientWithResult({ documents: 1 }) });
  let settled = false;
  const p = facade.fetchJSON("/api/stats").then(() => { settled = true; });
  // Not resolved yet — the promise must be pending (no failure, no settle).
  assert.equal(settled, false);
  facade.resolveReady({ error: null });
  return p.then(() => assert.equal(settled, true));
});
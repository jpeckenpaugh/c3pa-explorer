/*
 * C3PA Explorer browser edition — sql.js Worker (single-queue, op registry).
 *
 * A CLASSIC dedicated-worker script (created by the bridge with
 * `new Worker("/browser/js/core/worker.js")` — deliberately NOT {type:'module'}
 * so importScripts() is available for the classic vendored sql-wasm.js).
 * Modeled on jpeckenpaugh/ch poc-browser/js/db/worker.js: same importScripts +
 * initSqlJs({ locateFile }) pattern, same single-queue serialization, same
 * `self.onmessage({data:{id,op,payload}})` → `{id, result|error}` envelope
 * (§7b.1). The error envelope follows the ch worker: {message,name,status,
 * detail,body} so the bridge can synthesize the HTTP error the SPA expects
 * (§7b.6).
 *
 * Relative URL resolution inside a worker is against the worker script's own
 * URL (self.location.href), so:
 *   ../../vendor/sql.js/sql-wasm.{js,wasm}  → /browser/vendor/sql.js/…
 *   ../query/sqlite-bridge.js               → /browser/js/query/sqlite-bridge.js
 * The Phase-0 query modules are imported IN PLACE and invoked through the
 * createQuery(db) facade — never copied or edited (§7b.1).
 */

let SQL = null;
let database = null;
let queue = Promise.resolve();
let initialized = false;
let failed = null;

const registry = new Map();
const NOT_FOUND_HANDLERS = new Set(["documentDetail", "documentRendered", "documentAnnotations", "annotationDetail"]);

function query(sql, params = []) {
  const statement = database.prepare(sql);
  try {
    if (params && params.length) statement.bind(params);
    const rows = [];
    while (statement.step()) rows.push(statement.getAsObject());
    return rows;
  } finally {
    statement.free();
  }
}

async function initialize() {
  if (failed) throw failed;
  if (initialized) return;
  importScripts(new URL("../../vendor/sql.js/sql-wasm.js", self.location.href).href);
  SQL = await initSqlJs({
    locateFile: () => new URL("../../vendor/sql.js/sql-wasm.wasm", self.location.href).href,
  });
  initialized = true;
}

function requireWorkspace() {
  if (!database) {
    const err = new Error("no workspace open");
    err.status = 409;
    throw err;
  }
}

// ---- op registry -----------------------------------------------------------

// open(bytes) → new SQL.Database(bytes) + PRAGMA foreign_keys=ON.
registry.set("workspace.open", (payload) => {
  const bytes = payload.bytes;
  if (database) {
    try { database.close(); } catch { /* best-effort */ }
    database = null;
  }
  database = new SQL.Database(new Uint8Array(bytes));
  database.run("PRAGMA foreign_keys=ON");
  return { opened: true };
});

// Raw row primitive (covers any ad-hoc SQL; parity harness uses the same SQL).
registry.set("db.query", (payload) => {
  requireWorkspace();
  return query(String(payload.sql), payload.params || []);
});

// manifest.read → full manifest table, or {missing:true} if absent (§7b.5).
registry.set("manifest.read", () => {
  requireWorkspace();
  const tables = query("SELECT name FROM sqlite_master WHERE type='table' AND name='manifest'");
  if (!tables.length) return { missing: true };
  return { rows: query("SELECT key, value FROM manifest ORDER BY key") };
});

// integrity.check → PRAGMA integrity_check (first value must be 'ok').
registry.set("integrity.check", () => {
  requireWorkspace();
  const rows = query("PRAGMA integrity_check");
  const first = rows.length ? rows[0] : null;
  const value = first ? Object.values(first)[0] : null;
  return { ok: value === "ok", rows };
});

// dispatch → run a named createQuery(db) handler with positional args.
// The query modules load lazily on the first dispatch (never before the DB is
// open and validated) and only via import('../query/sqlite-bridge.js').
// Errors from the 404-able handlers (they throw "unknown …" for missing ids)
// are tagged 404 so the bridge can synthesize the HTTP-equivalent detail
// (§7b.6). /api/alignment is intentionally NOT here — unknown units return
// {unit_id, rows: []}, never an error (§5a.B4).
let queryHandle = null;
function runDispatch(handler, args) {
  requireWorkspace();
  if (!queryHandle) {
    const err = new Error("query modules not loaded");
    err.status = 500;
    throw err;
  }
  const fn = queryHandle[handler];
  if (typeof fn !== "function") {
    const err = new Error(`unknown handler: ${handler}`);
    err.status = 404;
    err.detail = "unknown endpoint";
    throw err;
  }
  try {
    return fn(...args);
  } catch (error) {
    throw Object.assign(new Error(error.message), {
      status: NOT_FOUND_HANDLERS.has(handler) ? 404 : 500,
      detail: error.message,
    });
  }
}
registry.set("dispatch", async (payload) => {
  if (!queryHandle && !failed) {
    const mod = await import("../query/sqlite-bridge.js");
    queryHandle = mod.createQuery(database);
  }
  return runDispatch(payload.handler, payload.args || []);
});

// ---- export (Phase 3 browser port of /api/export*) -------------------------

// export.preview → validate+preview dict (mirrors /api/export/preview)
registry.set("export.preview", async (payload) => {
  requireWorkspace();
  const mod = await import("../query/export-service.js");
  const handle = mod.createExportHandler(database);
  return handle.preview(payload.params, payload.opts || {});
});

// export.download → build the ZIP in-memory; returns {file, bytes}
registry.set("export.download", async (payload) => {
  requireWorkspace();
  const mod = await import("../query/export-service.js");
  const handle = mod.createExportHandler(database);
  const res = await handle.download(payload.params, payload.opts || {});
  // Structured-clone transfers Uint8Array fine, but expose a plain ArrayBuffer
  // for the port-transfer optimization and simple downstream Blob construction.
  const bytes = res.zip.buffer instanceof ArrayBuffer ? res.zip.buffer : res.zip;
  return { file: res.zipFilename, bytes };
});

// ---- single-queue serialization --------------------------------------------

self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      await initialize();
      const handler = registry.get(data.op);
      if (!handler) {
        const err = new Error(`unknown operation: ${data.op}`);
        err.status = 404;
        throw err;
      }
      const result = await handler(data.payload || {});
      // Transfer binary payloads (ZIP downloads) over the same message port.
      const transfer = result && result.bytes instanceof ArrayBuffer ? [result.bytes] : [];
      self.postMessage({ id: data.id, result }, transfer);
    } catch (error) {
      const tagged = error.status
        ? error
        : Object.assign(new Error(error.message), {
            status: 500,
            detail: error.detail || error.message,
          });
      self.postMessage({
        id: data.id,
        error: {
          message: tagged.message,
          name: tagged.name || "Error",
          status: tagged.status,
          detail: tagged.detail || tagged.message,
        },
      });
    }
  });
};
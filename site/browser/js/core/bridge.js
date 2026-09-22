/* C3PA Explorer browser edition — main-thread bridge facade.
 *
 * Two responsibilities, deliberately separated so the browser-free pieces are
 * directly testable under `node --test` (§7b.9):
 *
 *   parseRequestUrl(url)   — pure URL → {handler, args} against the exact
 *                            FastAPI route table (registration order, §5a.D8),
 *                            mirroring backend/schemas/units.py coercion.
 *   validateManifest(...)  — pure embedded-manifest validator (missing table
 *                            vs schema_version mismatch vs ok).
 *
 *   createBridge()         — the runtime facade (Worker client + the
 *                            `fetchJSON` the SPA calls via
 *                            globalThis.c3paBrowser). Constructing the Worker
 *                            only happens inside this factory (boot.js calls it
 *                            at runtime), so importing this module is safe in
 *                            Node — no Worker/DOM/fetch at top level.
 *
 * The worker never throws HTTP-visible errors directly: it replies with the
 * `ch`-style error envelope {message,name,status,detail,body} (§7b.6), and this
 * module converts to the exact throw shape the existing api.js fetchJSON
 * produces (`HTTP <status>: {"detail": …}`).
 */
"use strict";

// ---------------------------------------------------------------------------
// Pure: URL → handler dispatch table + param coercion
// ---------------------------------------------------------------------------

class RouteError extends Error {
  constructor(status, detail) {
    super(`route ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

const OK_BOOL = new Set(["1", "0", "true", "false", "yes", "no", "on", "off", "t", "f", "y", "n"]);
const INT_RE = /^-?\d+$/;

// Ordered exactly like FastAPI registration (§5a.D8, backend/main.py:24-29 and
// each router's definition order): literal routes BEFORE {param} routes within a
// path family. First match wins. `path: true` → positional string arg;
// `path: "int"` → positional Number arg (NaN ⇒ 422); `queryArg` → the single
// query param passed positionally (/api/alignment); otherwise the handler gets
// one arg: the object of provided query params (FastAPI ignores unknown keys,
// so only declared keys are forwarded).
const ROUTES = Object.freeze([
  // /api (stats router) — backend/api/stats.py
  Object.freeze({ re: /^\/api\/stats$/, handler: "stats", ints: ["evidence_threshold"], strs: ["ranumbs"] }),
  Object.freeze({ re: /^\/api\/labels$/, handler: "labels" }),
  Object.freeze({ re: /^\/api\/fragment-types$/, handler: "fragmentTypes" }),

  // /api/documents — backend/api/documents.py: /order BEFORE /{doc_id}
  Object.freeze({ re: /^\/api\/documents$/, handler: "documents", ints: ["limit", "offset"], strs: ["subset", "q", "sort", "order"] }),
  Object.freeze({ re: /^\/api\/documents\/order$/, handler: "documentsOrder" }),
  Object.freeze({ re: /^\/api\/documents\/([^/]+)\/rendered$/, handler: "documentRendered", path: true }),
  Object.freeze({ re: /^\/api\/documents\/([^/]+)\/annotations$/, handler: "documentAnnotations", path: true }),
  Object.freeze({ re: /^\/api\/documents\/([^/]+)\/html$/, handler: null, unsupported: true }),
  Object.freeze({ re: /^\/api\/documents\/([^/]+)$/, handler: "documentDetail", path: true }),

  // /api/annotations — backend/api/annotations.py ({annotation_id} → int)
  Object.freeze({ re: /^\/api\/annotations$/, handler: "annotations", ints: ["limit", "offset"], strs: ["doc_id", "ranumb", "label", "labels", "exclude_labels", "status"] }),
  Object.freeze({ re: /^\/api\/annotations\/([^/]+)$/, handler: "annotationDetail", path: "int" }),

  // /api (units router) — backend/api/units.py + backend/schemas/units.py
  Object.freeze({
    re: /^\/api\/units$/, handler: "units",
    ints: ["limit", "offset", "min_annotators", "evidence_threshold", "min_support"],
    bools: ["high_confidence"],
    strs: ["subset", "doc_id", "category", "unit_kind", "fragment_type", "q", "labels", "exclude_labels", "sample_view", "support_mode"],
  }),
  // /api/alignment — no-404 asymmetry: unknown unit ⇒ {unit_id, rows: []}
  Object.freeze({ re: /^\/api\/alignment$/, handler: "alignment", queryArg: "unit_id", strs: ["unit_id"] }),

  // /api/search — backend/api/search.py
  Object.freeze({ re: /^\/api\/search$/, handler: "search", strs: ["q"] }),

  // /api/export + /api/export/preview — handled by the export ops (Phase 3 port)
  Object.freeze({ re: /^\/api\/export\/preview$/, handler: "exportPreview", export: true }),
  Object.freeze({ re: /^\/api\/export$/, handler: "exportDownload", export: true }),
]);

function intError(key, value) {
  return new RouteError(422, [
    { type: "int_parsing", loc: ["query", key], msg: "Input should be a valid integer, unable to parse string as an integer", input: value },
  ]);
}

function boolError(key, value) {
  return new RouteError(422, [
    { type: "bool_parsing", loc: ["query", key], msg: "Input should be a valid boolean", input: value },
  ]);
}

function decodeParam(value) {
  // URLSearchParams already percent-decodes values; keep explicit for safety.
  return value;
}

/**
 * Parse a request URL (/api/...) into {handler, args} positioned to feed the
 * createQuery(db) facade in browser/js/query/sqlite-bridge.js
 * (e.g. {handler:"documents", args:[{limit:"3"}]} → q.documents({limit:"3"})).
 *
 * Throws a RouteError (status/detail props) on: unknown path (404), declared
 * int params that don't parse (422), declared bool params outside pydantic's
 * accepted set (422), non-integer {annotation_id} (422), or recognized-but-
 * unsupported endpoints (501). Values are passed through as strings — the
 * facade's own coercion (coerceInt/boolOr/parseLabels) owns defaults and
 * comma-splitting, exactly as pydantic default-binding did at parity time.
 */
export function parseRequestUrl(rawUrl) {
  const href = String(rawUrl).split("#", 1)[0];
  const qm = href.indexOf("?");
  const path = qm === -1 ? href : href.slice(0, qm);
  const qs = qm === -1 ? "" : href.slice(qm + 1);

  const params = new URLSearchParams(qs);
  const raw = {};
  for (const [k, v] of params) raw[k] = v;

  for (const route of ROUTES) {
    const m = route.re.exec(path);
    if (!m) continue;

    if (route.unsupported) {
      throw new RouteError(501, `endpoint not supported in the browser edition: ${path}`);
    }

    // Path-arg routes first (they don't consume query params).
    if (route.path === "int") {
      const segment = decodeURIComponent(m[1]);
      if (!INT_RE.test(segment)) {
        throw new RouteError(422, [
          { type: "int_parsing", loc: ["path", "annotation_id"], msg: "Input should be a valid integer", input: segment },
        ]);
      }
      return { handler: route.handler, args: [Number(segment)] };
    }
    if (route.path) {
      return { handler: route.handler, args: [decodeURIComponent(m[1])] };
    }

    // Forward only declared query params, string-coerced (FastAPI ignores the rest).
    const provided = {};
    for (const key of route.ints || []) {
      const v = raw[key];
      if (v === undefined) continue;
      if (v === "" || !INT_RE.test(v)) throw intError(key, v);
      provided[key] = decodeParam(v);
    }
    for (const key of route.bools || []) {
      const v = raw[key];
      if (v === undefined) continue;
      const normalized = String(v).trim().toLowerCase();
      if (!OK_BOOL.has(normalized)) throw boolError(key, v);
      provided[key] = decodeParam(v);
    }
    for (const key of route.strs || []) {
      const v = raw[key];
      if (v === undefined) continue;
      provided[key] = decodeParam(v);
    }

    if (route.queryArg) {
      if (provided[route.queryArg] === undefined) {
        throw new RouteError(422, [
          { type: "missing", loc: ["query", route.queryArg], msg: "Field required" },
        ]);
      }
      return { handler: route.handler, args: [provided[route.queryArg]], export: !!route.export };
    }
    return { handler: route.handler, args: [provided], export: !!route.export };
  }

  throw new RouteError(404, "Not Found");
}

// ---------------------------------------------------------------------------
// Pure: embedded manifest validation (§7b.9)
// ---------------------------------------------------------------------------

/**
 * Validate the payload produced by the worker's `manifest.read` op:
 *   { missing: true }                 — no `manifest` table in the snapshot
 *   { rows: [{key, value}, …] }       — table contents
 * Against the expected schema version. Returns {ok, reason, manifest?, actual?}.
 */
export function validateManifest(payload, expectedVersion) {
  if (!payload || payload.missing) return { ok: false, reason: "missing" };
  const map = {};
  for (const row of payload.rows || []) map[row.key] = row.value;
  if (!map.schema_version) return { ok: false, reason: "missing_version", manifest: map };
  if (map.schema_version !== expectedVersion) {
    return { ok: false, reason: "version_mismatch", actual: map.schema_version, expected: expectedVersion, manifest: map };
  }
  return { ok: true, manifest: map };
}

// ---------------------------------------------------------------------------
// Runtime: Worker transport + fetchJSON facade (boot.js only, never Node tests)
// ---------------------------------------------------------------------------

// Split a /api/... query URL into {opts, params} from the query string, with
// the boolean/int/float coercion the FastAPI export routers used.
function parseExportUrl(rawUrl) {
  const href = String(rawUrl).split("#", 1)[0];
  const qm = href.indexOf("?");
  const qs = qm === -1 ? "" : href.slice(qm + 1);
  const sp = new URLSearchParams(qs);
  const str = (k, d) => (sp.get(k) ?? d);
  const bool = (k, d) => (sp.has(k) ? ["1", "true", "yes", "on", "t", "y"].includes(sp.get(k).trim().toLowerCase()) : d);
  const num = (k, d) => (sp.has(k) ? Number(sp.get(k)) : d);
  const opts = {
    format: str("format", "csv"),
    split: bool("split", true),
    splitTrain: num("split_train", 80),
    splitEval: num("split_eval", 10),
    splitTest: num("split_test", 10),
    seed: num("seed", 42),
    stratify: bool("stratify", true),
    excludeOther: bool("exclude_other", false),
    maxDocLabelPct: num("max_doc_label_pct", 0),
  };
  if (sp.has("fields")) opts.fields = sp.get("fields");
  // The remaining unit-filter params (subset, category, labels, ...) pass
  // through as raw strings/ints; parseUnitParams in the query layer coerces.
  const params = {};
  for (const [k, v] of sp) {
    if (!["format", "split", "split_train", "split_eval", "split_test", "seed",
          "stratify", "exclude_other", "max_doc_label_pct", "fields"].includes(k)) {
      params[k] = v;
    }
  }
  return { params, opts };
}

function httpError(status, detail) {
  const body = JSON.stringify({ detail }).slice(0, 200);
  const err = new Error(`HTTP ${status}: ${body}`);
  err.status = status;
  return err;
}

function createWorkerClient() {
  // Relative to the page URL so the app works from a repo subpath
  // (https://<user>.github.io/<repo>/) as well as from localhost root —
  // §7b.3 CI/CD deployment requirement.
  const worker = new Worker(new URL("browser/js/core/worker.js", location.href).href);
  let nextId = 0;
  let terminalError = null;
  const pending = new Map();

  worker.onmessage = ({ data }) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) {
      const err = new Error(data.error.message || "browser worker error");
      err.status = data.error.status || 500;
      err.detail = data.error.detail;
      if (data.error.name) err.name = data.error.name;
      request.reject(err);
    } else {
      request.resolve(data.result);
    }
  };
  worker.onerror = (event) => {
    terminalError = new Error(event.message || "browser worker failed");
    terminalError.status = 500;
    for (const request of pending.values()) request.reject(terminalError);
    pending.clear();
  };

  const call = (op, payload = {}) => {
    if (terminalError) return Promise.reject(terminalError);
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ id, op, payload });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  };

  return { call, worker };
}

/**
 * Create the installed `globalThis.c3paBrowser` facade. `ready` is an internal
 * promise that boot.js resolves (with `{error: null}` or `{error: "…"}`) only
 * after the worker has opened the snapshot and validation passed — every
 * fetchJSON awaits it, so the SPA's page renders queue instead of failing while
 * the user is still picking a file (§7b.2).
 */
export function createBridge({ client = null } = {}) {
  const client0 = client || createWorkerClient();
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  const exportPreview = async (rawUrl) => {
      const status = await ready;
      if (status && status.error) throw new Error(status.error);
      const { params, opts } = parseExportUrl(rawUrl);
      const reply = await client0.call("export.preview", { params, opts });
      if (typeof reply === "object" && reply && reply.error) throw httpError(400, reply.error);
      return reply;
    };
    const exportDownload = async (rawUrl) => {
      const status = await ready;
      if (status && status.error) throw new Error(status.error);
      const { params, opts } = parseExportUrl(rawUrl);
      const reply = await client0.call("export.download", { params, opts });
      if (typeof reply === "object" && reply && reply.error) throw httpError(400, reply.error);
      return reply;
    };

  const facade = {
    ready,
    resolveReady,
    ops: client0,
    async fetchJSON(url, opts) {
      const status = await ready;
      if (status && status.error) throw new Error(status.error);
      let parsed;
      try {
        parsed = parseRequestUrl(url);
      } catch (error) {
        throw httpError(error.status || 500, error.detail || error.message);
      }
      if (parsed.export) {
        return exportPreview(url);
      }
      const reply = await client0.call("dispatch", { handler: parsed.handler, args: parsed.args });
      return reply;
    },

    // /api/export/preview → {valid, counts, warnings, ...} (mirrors FastAPI)
    exportPreview,

    // /api/export → run the build in the worker, return {file, bytes}
    exportDownload,
  };
  return facade;
}

// Internal (exported for tests/lint symmetry; not part of the public surface).
export { RouteError, ROUTES };
// Thin execution wrapper over an injected, already-initialized SQL.Database
// (sql.js) plus the environment-agnostic `createQuery(db)` factory.
//
// §5a D5: the ported query modules stay pure of IO — each environment (html
// Worker in Phase 2, Node parity harness now) performs its own
// initSqlJs({ locateFile }) and passes the database in via createQuery(db).
//
// The row primitive mirrors `connection.row_factory = sqlite3.Row` +
// `[dict(r) for r in ...]`: prepare -> bind -> step -> getAsObject, never
// `db.exec` (which does not support bind parameters).

import { getStatsData, getLabelsData, getFragmentTypesData } from "./stats.js";
import { listDocuments, getDocumentsOrder, getDocumentDetail, getDocumentRendered, getDocumentAnnotations } from "./documents.js";
import { getUnitsData, getUnitAlignment } from "./units.js";
import { listAnnotations, getAnnotationDetail } from "./annotations.js";
import { globalSearch } from "./search.js";
import { parseUnitParams } from "./filters.js";

export function query(db, sql, params = []) {
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

function coerceInt(v, def) {
  if (v === undefined || v === null || v === "") return def;
  return Number(v);
}

// Facade over the ported services. Each method takes the same values that
// arrive on the URL query string (strings + typecasts) so the parity harness
// can hand the raw fixture manifest params straight in.
export function createQuery(db) {
  return {
    // Raw row primitive, exported for convenience (covers any ad-hoc SQL).
    query: (sql, params) => query(db, sql, params),
    stats: (raw = {}) => getStatsData(db, {
      evidenceThreshold: coerceInt(raw.evidence_threshold, 1),
      ranumbs: raw.ranumbs === undefined ? null : String(raw.ranumbs),
    }),
    labels: () => getLabelsData(db),
    fragmentTypes: () => getFragmentTypesData(db),
    documents: (raw = {}) => listDocuments(db, {
      subset: raw.subset || null,
      q: raw.q || null,
      sort: raw.sort || null,
      order: raw.order || "asc",
      limit: coerceInt(raw.limit, 50),
      offset: coerceInt(raw.offset, 0),
    }),
    documentsOrder: () => getDocumentsOrder(db),
    documentDetail: (docId) => getDocumentDetail(db, docId),
    documentRendered: (docId) => getDocumentRendered(db, docId),
    documentAnnotations: (docId) => getDocumentAnnotations(db, docId),
    units: (raw = {}) => {
      const limit = coerceInt(raw.limit, 50);
      const offset = coerceInt(raw.offset, 0);
      return getUnitsData(db, parseUnitParams(raw), limit, offset);
    },
    alignment: (unitId) => getUnitAlignment(db, unitId),
    annotations: (raw = {}) => listAnnotations(db, {
      docId: raw.doc_id || null,
      ranumb: raw.ranumb || null,
      label: raw.label || null,
      labels: raw.labels || null,
      excludeLabels: raw.exclude_labels || null,
      status: raw.status || null,
      limit: coerceInt(raw.limit, 100),
      offset: coerceInt(raw.offset, 0),
    }),
    annotationDetail: (annotationId) => getAnnotationDetail(db, Number(annotationId)),
    search: (raw = {}) => globalSearch(db, raw.q || ""),
  };
}
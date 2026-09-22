// Port of backend/services/unit_service.py (+ db.unit_support is imported from
// filters.js). SQL is copied verbatim (identical aliases -> identical JSON
// keys); dict-construction order matches the Python exactly so Starlette's
// json.dumps ordering is reproduced by JSON.stringify.

import { query } from "./sqlite-bridge.js";
import { UNIT_SELECT, buildUnitFilter, unitSupport } from "./filters.js";

// backend/services/unit_service.py:decorate_unit
export function decorateUnit(r) {
  const out = { ...r };
  if ("unit_text" in out && !("text" in out)) out.text = out.unit_text;
  const labels = out.verbatim_labels ? out.verbatim_labels.split(";").filter((l) => l) : [];
  if (out.label_category === "single_label" && labels.length === 1) {
    out.verbatim_label = labels[0];
  } else if (out.label_category === "multi_label") {
    out.verbatim_label = "MULTI_LABEL";
  } else {
    out.verbatim_label = "";
  }
  return out;
}

// backend/services/unit_service.py:unit_rows
export function unitRows(db, params, limit = null, offset = 0) {
  const [where, args] = buildUnitFilter(params);
  const countSql = "SELECT COUNT(*) AS n FROM text_units u JOIN documents d ON d.doc_id = u.doc_id" + where;
  const total = query(db, countSql, args)[0].n;

  let sql = UNIT_SELECT + where + " ORDER BY u.doc_id, u.position";
  let bind = args;
  if (limit !== null) {
    sql += " LIMIT ? OFFSET ?";
    bind = [...args, limit, offset];
  }
  const rows = query(db, sql, bind).map(decorateUnit);
  return [rows, total];
}

// backend/services/unit_service.py:get_units_data
export function getUnitsData(db, params, limit = 50, offset = 0) {
  const evidenceThreshold = params.evidence_threshold ?? 1;
  const support = unitSupport(db, evidenceThreshold);
  const [rows, total] = unitRows(db, params, limit, offset);
  for (const r of rows) r.support = support.get(r.unit_id) ?? [];
  return { total, rows };
}

// backend/services/unit_service.py:get_unit_alignment
export function getUnitAlignment(db, unitId) {
  const rows = query(
    db,
    `SELECT a.annotation_id, a.ranumb, a.text, a.label, g.alignment_type
       FROM alignment g JOIN annotations a ON a.annotation_id = g.annotation_id
       WHERE g.unit_id=? ORDER BY a.ranumb, g.alignment_type`,
    [unitId]
  );
  return { unit_id: unitId, rows };
}
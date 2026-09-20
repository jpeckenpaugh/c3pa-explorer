// Port of backend/services/annotation_service.py. SQL verbatim.

import { query } from "./sqlite-bridge.js";
import { parseLabels } from "./filters.js";

// backend/services/annotation_service.py:list_annotations
export function listAnnotations(db, { docId = null, ranumb = null, label = null, labels = null, excludeLabels = null, status = null, limit = 100, offset = 0 } = {}) {
  const where = [];
  const args = [];
  for (const [col, val] of [
    ["doc_id", docId],
    ["ranumb", ranumb !== "all" ? ranumb : null],
    ["status", status],
  ]) {
    if (val) {
      where.push(`${col} = ?`);
      args.push(val);
    }
  }
  if (label) {
    where.push("label = ?");
    args.push(label);
  }
  const labelsList = parseLabels(labels);
  if (labelsList.length) {
    const placeholders = labelsList.map(() => "?").join(",");
    where.push(`label IN (${placeholders})`);
    args.push(...labelsList);
  }
  const excluded = parseLabels(excludeLabels);
  if (excluded.length) {
    const placeholders = excluded.map(() => "?").join(",");
    where.push(`label NOT IN (${placeholders})`);
    args.push(...excluded);
  }
  const w = where.length ? " WHERE " + where.join(" AND ") : "";
  const total = query(db, `SELECT COUNT(*) n FROM annotations a${w}`, args)[0].n;
  const rows = query(
    db,
    `SELECT * FROM annotations a${w} ORDER BY a.doc_id, a.src_row LIMIT ? OFFSET ?`,
    [...args, limit, offset]
  );
  return { total, rows };
}

// backend/services/annotation_service.py:get_annotation_detail
export function getAnnotationDetail(db, annotationId) {
  const ann = query(db, "SELECT * FROM annotations WHERE annotation_id=?", [annotationId])[0];
  if (!ann) throw new Error(`unknown annotation ${annotationId}`);
  const d = { ...ann };
  const units = query(
    db,
    `SELECT u.unit_id, u.unit_text, u.unit_kind, u.fragment_type, u.label_category, g.alignment_type
       FROM alignment g JOIN text_units u ON u.unit_id = g.unit_id
       WHERE g.annotation_id=? ORDER BY u.position`,
    [annotationId]
  );
  d.aligned_units = units;
  return d;
}
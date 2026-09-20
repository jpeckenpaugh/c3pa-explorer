// Port of backend/services/search_service.py. SQL verbatim; search does NOT
// escape % / _ in q (detail 11 — user % behaves as a wildcard on both sides).

import { query } from "./sqlite-bridge.js";
import { decorateUnit } from "./units.js";

// backend/services/search_service.py:global_search
export function globalSearch(db, q = "") {
  // Python uses len(query) (code points); JS .length is UTF-16 units. Keep
  // the parity fixtures free of astral characters (detail 18). Same semantics
  // for everything else: empty/whitespace/short queries short out.
  const queryStr = q.trim();
  if (!queryStr || queryStr.length < 2) {
    return { q: queryStr, documents: [], provisions: [], annotators: [], units: [] };
  }

  const param = `%${queryStr}%`;

  const documents = query(
    db,
    `SELECT doc_id, title, link
     FROM documents
     WHERE doc_id LIKE ? OR title LIKE ? OR link LIKE ?
     LIMIT 5`,
    [param, param, param]
  );

  const provisions = query(
    db,
    `SELECT label, COUNT(*) as count
     FROM annotations
     WHERE label LIKE ?
     GROUP BY label
     ORDER BY count DESC
     LIMIT 5`,
    [param]
  );

  const annotators = query(
    db,
    `SELECT ranumb, COUNT(*) as count, COUNT(DISTINCT doc_id) as docs
     FROM annotations
     WHERE ranumb LIKE ?
     GROUP BY ranumb
     LIMIT 5`,
    [param]
  );

  const units = query(
    db,
    `SELECT u.unit_id, u.doc_id, u.unit_text, u.unit_kind, u.fragment_type, u.label_category, u.position, u.block_kind,
            (SELECT group_concat(sl.label, ';') FROM unit_labels sl WHERE sl.unit_id = u.unit_id ORDER BY sl.label) AS verbatim_labels
     FROM text_units u
     JOIN documents d ON d.doc_id = u.doc_id
     WHERE u.unit_text LIKE ?
     LIMIT 6`,
    [param]
  ).map(decorateUnit);

  return {
    q: queryStr,
    documents,
    provisions,
    annotators,
    units,
  };
}
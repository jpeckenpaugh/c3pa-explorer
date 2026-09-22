// Port of backend/services/document_service.py. SQL verbatim. get_document_html
// is intentionally NOT ported (the SPA never consumes /html; §4 table).

import { query } from "./sqlite-bridge.js";

// backend/services/document_service.py:list_documents
export function listDocuments(db, { subset = null, q = null, sort = null, order = "asc", limit = 50, offset = 0 } = {}) {
  const where = [];
  const args = [];
  if (subset) {
    where.push("d.subset = ?");
    args.push(subset);
  }
  if (q) {
    where.push("(d.link LIKE ? OR d.doc_id LIKE ?)");
    args.push(`%${q}%`, `%${q}%`);
  }
  const w = where.length ? " WHERE " + where.join(" AND ") : "";
  const total = query(db, `SELECT COUNT(*) n FROM documents d${w}`, args)[0].n;

  const orderDir = order.toLowerCase() === "desc" ? "DESC" : "ASC";
  let orderClause;
  if (sort === "sentence_count" || sort === "sentences") {
    orderClause = `ORDER BY sentence_count ${orderDir}, d.subset, d.num`;
  } else if (sort === "fragment_count" || sort === "fragments") {
    orderClause = `ORDER BY fragment_count ${orderDir}, d.subset, d.num`;
  } else if (sort === "annotation_count" || sort === "annotations") {
    orderClause = `ORDER BY annotation_count ${orderDir}, d.subset, d.num`;
  } else if (sort === "doc_id" || sort === "id") {
    orderClause = `ORDER BY d.subset ${orderDir}, d.num ${orderDir}`;
  } else {
    orderClause = "ORDER BY d.subset, d.num";
  }

  const sql =
    `SELECT d.doc_id, d.subset, d.num, d.title, d.link, d.is_homepage,
            (SELECT COUNT(*) FROM text_units u WHERE u.doc_id = d.doc_id AND u.unit_kind = 'sentence') AS sentence_count,
            (SELECT COUNT(*) FROM text_units u WHERE u.doc_id = d.doc_id AND u.unit_kind = 'fragment') AS fragment_count,
            (SELECT COUNT(*) FROM annotations a WHERE a.doc_id = d.doc_id) AS annotation_count,
            (SELECT COUNT(DISTINCT a.label) FROM annotations a WHERE a.doc_id = d.doc_id) AS label_count,
            (SELECT COUNT(*) FROM annotations a WHERE a.doc_id = d.doc_id AND a.status = 'aligned') AS aligned_count
     FROM documents d${w} ${orderClause} LIMIT ? OFFSET ?`;
  const rows = query(db, sql, [...args, limit, offset]);
  return { total, rows };
}

// backend/services/document_service.py:get_documents_order
export function getDocumentsOrder(db) {
  const rows = query(db, "SELECT doc_id FROM documents ORDER BY subset, num");
  return { order: rows.map((r) => r.doc_id) };
}

// backend/services/document_service.py:get_document_detail
export function getDocumentDetail(db, docId) {
  const doc = query(db, "SELECT * FROM documents WHERE doc_id=?", [docId])[0];
  if (!doc) throw new Error(`unknown document ${docId}`);
  const annotations = query(db, "SELECT * FROM annotations WHERE doc_id=? ORDER BY src_row", [docId]);
  const units = query(
    db,
    `SELECT u.*,
             (SELECT group_concat(sl.label, ';') FROM unit_labels sl
               WHERE sl.unit_id = u.unit_id ORDER BY sl.label) AS verbatim_labels
      FROM text_units u WHERE u.doc_id=? ORDER BY u.position`,
    [docId]
  );
  for (const u of units) u.labels = (u.verbatim_labels || "").split(";").filter((l) => l);
  return { document: doc, annotations, units };
}

// backend/services/document_service.py:get_document_rendered
export function getDocumentRendered(db, docId) {
  const doc = query(db, "SELECT * FROM documents WHERE doc_id=?", [docId])[0];
  if (!doc) throw new Error(`unknown document ${docId}`);
  const rows = query(
    db,
    `SELECT u.unit_id, u.position, u.block_seq, u.block_kind, u.unit_text,
            u.unit_kind, u.fragment_type, u.label_category, u.annotator_count,
            (SELECT group_concat(sl.label, ';') FROM unit_labels sl
              WHERE sl.unit_id = u.unit_id ORDER BY sl.label) AS verbatim_labels
     FROM text_units u WHERE u.doc_id=? ORDER BY u.block_seq, u.position`,
    [docId]
  );
  const blocks = [];
  for (const r of rows) {
    if (!blocks.length || blocks[blocks.length - 1].seq !== r.block_seq) {
      blocks.push({ seq: r.block_seq, kind: r.block_kind, units: [] });
    }
    const u = { ...r };
    u.labels = (u.verbatim_labels || "").split(";").filter((l) => l);
    blocks[blocks.length - 1].units.push(u);
  }
  return { doc_id: docId, document: doc, blocks };
}

// backend/services/document_service.py:get_document_annotations
export function getDocumentAnnotations(db, docId) {
  const rows = query(
    db,
    `SELECT a.annotation_id, a.src_row, a.ranumb, a.text, a.label, a.status,
            (SELECT group_concat(g.unit_id, ';') FROM alignment g
              WHERE g.annotation_id = a.annotation_id) AS unit_ids
     FROM annotations a WHERE a.doc_id=? ORDER BY a.src_row`,
    [docId]
  );
  const anns = [];
  for (const r of rows) {
    const d = { ...r };
    d.unit_ids = (d.unit_ids || "").split(";").filter((u) => u);
    anns.push(d);
  }
  return { doc_id: docId, annotations: anns };
}
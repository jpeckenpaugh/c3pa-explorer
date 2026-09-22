// Ports of the shared SQL builders / helpers from backend/db.py and
// backend/schemas/units.py, plus the schema-to-dict converter
// (UnitFilterParams.to_dict). Pure of IO: every function takes the database
// result primitive via sqlite-bridge's query(); this module must stay free of
// any window/document/fs references so it imports cleanly under node --test
// and inside the html Worker.

import { query } from "./sqlite-bridge.js";

// backend/schemas/units.py:parse_labels — comma-split with strip, dropping
// empty pieces. Port verbatim: the split must not be "improved" (a label that
// ever gains a literal comma would break, same as Python).
export function parseLabels(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    const out = [];
    for (const item of raw) {
      for (const piece of item.split(",")) {
        const l = piece.trim();
        if (l) out.push(l);
      }
    }
    return out;
  }
  const out = [];
  for (const piece of raw.split(",")) {
    const l = piece.trim();
    if (l) out.push(l);
  }
  return out;
}

// backend/db.py:support_tier_cond
export function supportTierCond(mode, tier) {
  const ceil = "CAST((pl.n + 1) / 2 AS INTEGER)";
  const byTier = mode === "exact"
    ? {
        1: `x.mk >= 1 AND x.mk < ${ceil}`,
        2: `x.mk >= ${ceil} AND x.mk < pl.n`,
        3: "x.mk = pl.n",
      }
    : {
        1: "x.mk >= 1",
        2: `x.mk >= ${ceil}`,
        3: "x.mk = pl.n",
      };
  const cond = byTier[tier];
  return cond !== undefined ? cond : "x.mk >= 1";
}

// backend/db.py:unit_support — returns a Map<unit_id, pair[]> (Python dict).
// Port notes:
//  - `math.ceil(p / 2)` -> Math.ceil(p / 2)
//  - per-unit pair order follows the votes iteration order (Python dict order);
//    irrelevant to parity because `support` arrays are canonically compared
//    (§5a.B3: sorted before diff), and single_label units have exactly one pair
//    (detail 14).
export function unitSupport(db, threshold = 1) {
  const pool = {};
  for (const r of query(db, "SELECT doc_id, COUNT(DISTINCT ranumb) n FROM annotations GROUP BY doc_id")) {
    pool[r.doc_id] = r.n;
  }
  const votes = new Map();
  for (const r of query(
    db,
    `SELECT g.unit_id, u.doc_id, sl.label, a.ranumb, COUNT(*) c
       FROM unit_labels sl
       JOIN alignment g ON g.unit_id = sl.unit_id
       JOIN text_units u ON u.unit_id = g.unit_id
       JOIN annotations a ON a.annotation_id = g.annotation_id AND a.label = sl.label
       GROUP BY g.unit_id, u.doc_id, sl.label, a.ranumb`
  )) {
    if (r.c >= threshold) {
      const key = `${r.unit_id}\u0000${r.label}`;
      let v = votes.get(key);
      if (!v) {
        v = { unit_id: r.unit_id, label: r.label, doc: r.doc_id, n: 0 };
        votes.set(key, v);
      }
      v.n += 1;
    }
  }
  const out = new Map();
  for (const v of votes.values()) {
    const p = pool[v.doc] || 0;
    const k = v.n;
    const stars = k === p ? 3 : k >= Math.ceil(p / 2) ? 2 : 1;
    const pair = { label: v.label, k, pool: p, stars };
    const list = out.get(v.unit_id);
    if (list) list.push(pair);
    else out.set(v.unit_id, [pair]);
  }
  return out;
}

// backend/db.py:UNIT_SELECT (verbatim column list + aliases -> JSON keys)
export const UNIT_SELECT = `
    SELECT u.unit_id, u.doc_id, d.subset, u.position, u.block_kind, u.unit_text,
           u.unit_kind, u.fragment_type, u.label_category,
           u.annotator_count, u.source_annotation_count, u.alignment_types,
           (SELECT group_concat(sl.label, ';') FROM unit_labels sl
             WHERE sl.unit_id = u.unit_id ORDER BY sl.label) AS verbatim_labels,
           (SELECT group_concat(ranumb, ';') FROM
             (SELECT DISTINCT a.ranumb FROM alignment g
               JOIN annotations a ON a.annotation_id = g.annotation_id
               WHERE g.unit_id = u.unit_id ORDER BY a.ranumb)) AS annotators
    FROM text_units u
    JOIN documents d ON d.doc_id = u.doc_id`;

// backend/schemas/units.py:UnitFilterParams.to_dict() replayed over the raw
// query-string params the way FastAPI/pydantic binds them. Values are strings
// (+ typecast), matching what the /api/units URL carries.
export function parseUnitParams(raw) {
  const str = (k) => {
    const v = raw[k];
    if (v === undefined || v === null) return null;
    if (typeof v === "string" && v === "") return null;
    return String(v);
  };
  const intOr = (k, def) => {
    const v = raw[k];
    if (v === undefined || v === null || v === "") return def;
    return Number(v);
  };
  const boolOr = (k, def) => {
    const v = raw[k];
    if (v === undefined || v === null || v === "") return def;
    return ["1", "true", "yes", "on", "t", "y"].includes(String(v).trim().toLowerCase());
  };
  return {
    subset: str("subset"),
    doc_id: str("doc_id"),
    category: str("category"),
    unit_kind: str("unit_kind"),
    fragment_type: str("fragment_type"),
    labels: parseLabels(raw.labels),
    exclude_labels: parseLabels(raw.exclude_labels),
    min_annotators: intOr("min_annotators", null),
    high_confidence: boolOr("high_confidence", false),
    q: str("q"),
    sample_view: parseLabels(raw.sample_view),
    evidence_threshold: intOr("evidence_threshold", 1),
    min_support: intOr("min_support", 1),
    support_mode: str("support_mode") ?? "at_least",
  };
}

// backend/db.py:build_unit_filter — returns [whereClause, bindArgs].
// The LIKE escape mirrors Python str.replace(..., all) via GLOBAL regex
// replaces, in the same order (backslash, then %, then _); the SQL literal is
// still `ESCAPE '\'`.
export function buildUnitFilter(params) {
  const where = [];
  const args = [];

  if (params.subset) {
    where.push("d.subset = ?");
    args.push(params.subset);
  }
  if (params.doc_id) {
    where.push("u.doc_id = ?");
    args.push(params.doc_id);
  }
  if (params.category) {
    where.push("u.label_category = ?");
    args.push(params.category);
  }
  if (params.unit_kind) {
    where.push("u.unit_kind = ?");
    args.push(params.unit_kind);
  }
  if (params.fragment_type) {
    where.push("u.fragment_type = ?");
    args.push(params.fragment_type);
  }
  if (params.min_annotators) {
    where.push("u.annotator_count >= ?");
    args.push(Number(params.min_annotators));
  }
  if (params.high_confidence) {
    where.push("u.label_category = 'single_label' AND u.annotator_count >= 2");
  }
  if (params.q) {
    where.push("u.unit_text LIKE ? ESCAPE '\\'");
    const q = params.q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    args.push(`%${q}%`);
  }
  if (params.labels && params.labels.length) {
    const placeholders = params.labels.map(() => "?").join(",");
    where.push(`u.unit_id IN (SELECT unit_id FROM unit_labels WHERE label IN (${placeholders}))`);
    args.push(...params.labels);
  }
  if (params.exclude_labels && params.exclude_labels.length) {
    const placeholders = params.exclude_labels.map(() => "?").join(",");
    where.push(`u.unit_id NOT IN (SELECT unit_id FROM unit_labels WHERE label IN (${placeholders}))`);
    args.push(...params.exclude_labels);
  }

  const t = Number(params.evidence_threshold || 1);
  let ms = Number(params.min_support || 1);
  if (!(ms === 1 || ms === 2 || ms === 3)) ms = 1;
  const mode = params.support_mode || "at_least";
  const tierCond = supportTierCond(mode, ms);
  const supported = (
    "u.unit_id IN (SELECT x.unit_id FROM (" +
    "SELECT p.unit_id, p.doc_id, MAX(p.k) mk FROM (" +
    "SELECT q.unit_id, q.doc_id, q.label, COUNT(*) k FROM (" +
    "SELECT g.unit_id, u.doc_id, sl.label, a.ranumb FROM unit_labels sl " +
    "JOIN alignment g ON g.unit_id = sl.unit_id " +
    "JOIN text_units u ON u.unit_id = g.unit_id " +
    "JOIN annotations a ON a.annotation_id = g.annotation_id AND a.label = sl.label " +
    "GROUP BY g.unit_id, u.doc_id, sl.label, a.ranumb HAVING COUNT(*) >= ?) q " +
    "GROUP BY q.unit_id, q.doc_id, q.label) p " +
    "GROUP BY p.unit_id, p.doc_id) x " +
    "JOIN (SELECT doc_id, COUNT(DISTINCT ranumb) n FROM annotations GROUP BY doc_id) pl " +
    "ON pl.doc_id = x.doc_id " +
    `WHERE ${tierCond})`
  );
  if (params.sample_view && params.sample_view.length) {
    const views = params.sample_view.filter((v) => v === "single" || v === "multi" || v === "null" || v === "fragments");
    if (views.length) {
      const quality = Boolean(
        (ms > 1 || mode === "exact") || t > 1
        || (params.labels && params.labels.length) || (params.exclude_labels && params.exclude_labels.length)
      );
      const conds = {
        single: `(u.unit_kind = 'sentence' AND u.label_category = 'single_label' AND ${supported})`,
        multi: `(u.unit_kind = 'sentence' AND u.label_category = 'multi_label' AND ${supported})`,
        null: quality ? "(0)" : "(u.unit_kind = 'sentence' AND u.label_category = 'unlabeled')",
        fragments: quality ? "(0)" : "(u.unit_kind = 'fragment')",
      };
      where.push("(" + views.map((v) => conds[v]).join(" OR ") + ")");
      for (const v of views) {
        if (v === "single" || v === "multi") args.push(t);
      }
    }
  } else if (
    ms > 1 || t > 1 || mode === "exact"
    || (params.labels && params.labels.length) || (params.exclude_labels && params.exclude_labels.length)
  ) {
    where.push(`(u.label_category IN ('single_label', 'multi_label') AND ${supported})`);
    args.push(t);
  }

  if (where.length) return [" WHERE " + where.join(" AND "), args];
  return ["", args];
}
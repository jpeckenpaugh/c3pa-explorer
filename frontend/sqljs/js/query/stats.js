// Port of backend/services/stats_service.py. SQL verbatim; dict key-insertion
// order mirrors Python exactly (counts first, then the label-distribution
// block, then the per-label hashes, stars, annotators).

import { query } from "./sqlite-bridge.js";
import { unitSupport } from "./filters.js";

// backend/services/stats_service.py:get_stats_data
export function getStatsData(db, { evidenceThreshold = 1, ranumbs = null } = {}) {
  const one = (sql, params = []) => {
    const row = query(db, sql, params)[0];
    return row[Object.keys(row)[0]];
  };

  const raList = ranumbs != null ? ranumbs.split(",").map((s) => s.trim()).filter((s) => s) : null;
  let whereAnn = "";
  let andAnn = "";
  let annArgs = [];
  if (raList != null) {
    if (raList.length) {
      const ph = raList.map(() => "?").join(",");
      whereAnn = `WHERE ranumb IN (${ph})`;
      andAnn = `AND ranumb IN (${ph})`;
      annArgs = [...raList];
    } else {
      whereAnn = "WHERE 1=0";
      andAnn = "AND 1=0";
      annArgs = [];
    }
  }

  const cats = {};
  for (const r of query(db, "SELECT label_category, COUNT(*) n FROM text_units WHERE unit_kind='sentence' GROUP BY label_category")) {
    cats[r.label_category] = r.n;
  }
  const kinds = {};
  for (const r of query(db, "SELECT unit_kind, COUNT(*) n FROM text_units GROUP BY unit_kind")) {
    kinds[r.unit_kind] = r.n;
  }
  const frags = {};
  for (const r of query(db, "SELECT fragment_type, COUNT(*) n FROM text_units WHERE unit_kind='fragment' GROUP BY fragment_type")) {
    frags[r.fragment_type] = r.n;
  }
  const labelDist = [];
  for (const r of query(
    db,
    `SELECT ul.label, COUNT(DISTINCT ul.unit_id) n, SUM(CASE WHEN u.label_category='single_label' THEN 1 ELSE 0 END) s
             FROM unit_labels ul JOIN text_units u ON u.unit_id = ul.unit_id
             GROUP BY ul.label ORDER BY n DESC`
  )) {
    labelDist.push({ label: r.label, count: r.n, single_label_count: r.s });
  }
  const annotators = query(
    db,
    `SELECT ranumb, COUNT(*) n,
            COUNT(DISTINCT doc_id) docs,
            COUNT(DISTINCT label) labels
     FROM annotations GROUP BY ranumb ORDER BY ranumb`
  );
  const subsets = {};
  for (const r of query(db, "SELECT subset, COUNT(*) n FROM documents GROUP BY subset")) {
    subsets[r.subset] = r.n;
  }
  const counts = {
    documents: one("SELECT COUNT(*) FROM documents"),
    units: one("SELECT COUNT(*) FROM text_units"),
    sentences: kinds.sentence ?? 0,
    unique_sentences: one("SELECT COUNT(DISTINCT unit_text) FROM text_units WHERE unit_kind='sentence'"),
    fragments: kinds.fragment ?? 0,
    unique_fragments: one("SELECT COUNT(DISTINCT unit_text) FROM text_units WHERE unit_kind='fragment'"),
    annotations: one(`SELECT COUNT(*) FROM annotations ${whereAnn}`, annArgs),
    unique_annotations: one(`SELECT COUNT(DISTINCT text) FROM annotations ${whereAnn}`, annArgs),
    aligned: one(`SELECT COUNT(*) FROM annotations WHERE status='aligned' ${andAnn}`, annArgs),
    unmatched: one(`SELECT COUNT(*) FROM annotations WHERE status='unmatched' ${andAnn}`, annArgs),
    ambiguous: one(`SELECT COUNT(*) FROM annotations WHERE status='ambiguous' ${andAnn}`, annArgs),
    single_label_sentences: cats.single_label ?? 0,
    unique_single_label_sentences: one(
      "SELECT COUNT(DISTINCT unit_text) FROM text_units WHERE unit_kind='sentence' AND label_category='single_label'"
    ),
    multi_label_sentences: cats.multi_label ?? 0,
    unique_multi_label_sentences: one(
      "SELECT COUNT(DISTINCT unit_text) FROM text_units WHERE unit_kind='sentence' AND label_category='multi_label'"
    ),
    unlabeled_sentences: cats.unlabeled ?? 0,
    unique_unlabeled_sentences: one(
      "SELECT COUNT(DISTINCT unit_text) FROM text_units WHERE unit_kind='sentence' AND label_category='unlabeled'"
    ),
    unique_defined_samples: one(
      "SELECT COUNT(DISTINCT unit_text) FROM text_units WHERE unit_kind='sentence' "
      + "AND label_category IN ('single_label','multi_label')"
    ),
    high_confidence_single: one(
      "SELECT COUNT(*) FROM text_units WHERE label_category='single_label' AND annotator_count>=2"
    ),
    subsets,
    fragment_distribution: frags,
  };
  const annLabelDist = [];
  for (const r of query(
    db,
    `SELECT label, COUNT(*) n FROM annotations ${whereAnn} GROUP BY label ORDER BY label`,
    annArgs
  )) {
    annLabelDist.push({ label: r.label, count: r.n });
  }

  const support = unitSupport(db, evidenceThreshold);
  const cat = new Map();
  for (const r of query(
    db,
    "SELECT unit_id, label_category FROM text_units WHERE label_category IN ('single_label', 'multi_label')"
  )) {
    cat.set(r.unit_id, r.label_category);
  }
  const singleStars = { 1: 0, 2: 0, 3: 0 };
  const multiStars = { 1: 0, 2: 0, 3: 0 };
  const singleStarTexts = { 1: new Set(), 2: new Set(), 3: new Set() };
  const multiStarTexts = { 1: new Set(), 2: new Set(), 3: new Set() };
  const textMap = new Map();
  for (const r of query(db, "SELECT unit_id, unit_text FROM text_units")) textMap.set(r.unit_id, r.unit_text);
  for (const [unitId, pairs] of support) {
    const c = cat.get(unitId);
    if (c === "single_label") {
      const st = pairs[0].stars;
      singleStars[st] += 1;
      singleStarTexts[st].add(textMap.get(unitId));
    } else if (c === "multi_label") {
      const st = Math.max(...pairs.map((p) => p.stars));
      multiStars[st] += 1;
      multiStarTexts[st].add(textMap.get(unitId));
    }
  }
  const singleStarsUnique = { 1: singleStarTexts[1].size, 2: singleStarTexts[2].size, 3: singleStarTexts[3].size };
  const multiStarsUnique = { 1: multiStarTexts[1].size, 2: multiStarTexts[2].size, 3: multiStarTexts[3].size };

  const alignedByLabel = {};
  for (const r of query(db, `SELECT label, COUNT(*) n FROM annotations WHERE status='aligned' ${andAnn} GROUP BY label`, annArgs)) {
    alignedByLabel[r.label] = r.n;
  }
  const unmatchedByLabel = {};
  for (const r of query(db, `SELECT label, COUNT(*) n FROM annotations WHERE status='unmatched' ${andAnn} GROUP BY label`, annArgs)) {
    unmatchedByLabel[r.label] = r.n;
  }
  const ambiguousByLabel = {};
  for (const r of query(db, `SELECT label, COUNT(*) n FROM annotations WHERE status='ambiguous' ${andAnn} GROUP BY label`, annArgs)) {
    ambiguousByLabel[r.label] = r.n;
  }
  const hitsByLabel = {};
  for (const r of query(
    db,
    "SELECT ul.label, COUNT(DISTINCT ul.unit_id) n FROM unit_labels ul JOIN text_units u ON u.unit_id = ul.unit_id WHERE u.label_category IN ('single_label', 'multi_label') GROUP BY ul.label"
  )) {
    hitsByLabel[r.label] = r.n;
  }

  return {
    ...counts,
    label_distribution: labelDist,
    annotation_label_distribution: annLabelDist,
    aligned_by_label: alignedByLabel,
    unmatched_by_label: unmatchedByLabel,
    ambiguous_by_label: ambiguousByLabel,
    hits_by_label: hitsByLabel,
    single_label_stars: singleStars,
    single_label_stars_unique: singleStarsUnique,
    multi_label_stars: multiStars,
    multi_label_stars_unique: multiStarsUnique,
    annotators,
  };
}

// backend/services/stats_service.py:get_labels_data
export function getLabelsData(db) {
  return query(
    db,
    `SELECT label, COUNT(DISTINCT unit_id) unit_count
       FROM unit_labels GROUP BY label ORDER BY unit_count DESC`
  );
}

// backend/services/stats_service.py:get_fragment_types_data
export function getFragmentTypesData(db) {
  return query(
    db,
    `SELECT fragment_type, COUNT(*) n FROM text_units
       WHERE unit_kind='fragment' AND fragment_type IS NOT NULL
       GROUP BY fragment_type ORDER BY n DESC`
  );
}
// Port of backend/export.py + backend/services/export_service.py → JS.
//
// Pure deterministic export logic (partition / stratify / csv / json /
// label-support analysis), ported verbatim so the browser edition produces the
// same files the FastAPI /api/export endpoint did. The db access goes through
// the injected createQuery facade (unitRows + unitSupport) — everything else is
// pure and testable under Node without a browser.
//
// File/JSON shapes mirror the Python exactly: same meta keys, same field
// ordering, same CSV via a small RFC4180 writer, same JSON.stringify(detail).

"use strict";

import { unitRows, decorateUnit } from "./units.js";
import { unitSupport, parseUnitParams } from "./filters.js";

// backend/db.py:UNIT_FIELDS (the subset export knows as selectable fields)
export const UNIT_FIELDS = [
  "id", "doc_id", "group", "text", "label", "label_name",
  "subset", "position", "unit_kind", "fragment_type", "label_category",
  "verbatim_labels", "annotator_count", "annotators",
  "source_annotation_count", "alignment_types",
];

const LABEL_TOKEN_MAP = {
  "Categories of Personal Information Collected": "CATEGORIES_OF_PERSONAL_INFORMATION_COLLECTED",
  "Categories of Personal Information Shared / Disclosed": "CATEGORIES_OF_PERSONAL_INFORMATION_SHARED_OR_DISCLOSED",
  "Categories of Personal Information Sold": "CATEGORIES_OF_PERSONAL_INFORMATION_SOLD",
  "Description of Right to Correct Information": "DESCRIPTION_OF_RIGHT_TO_CORRECT_INFORMATION",
  "Description of Right to Delete": "DESCRIPTION_OF_RIGHT_TO_DELETE",
  "Description of Right to Know PI Collected": "DESCRIPTION_OF_RIGHT_TO_KNOW_PI_COLLECTED",
  "Description of Right to Know PI sold / shared": "DESCRIPTION_OF_RIGHT_TO_KNOW_PI_SOLD_OR_SHARED",
  "Description of Right to Limit use of PI": "DESCRIPTION_OF_RIGHT_TO_LIMIT_USE_OF_PI",
  "Description of Right to Non-discrimination on exercising rights": "DESCRIPTION_OF_RIGHT_TO_NON_DISCRIMINATION",
  "Description of Right to Opt-out of sale of PI": "DESCRIPTION_OF_RIGHT_TO_OPT_OUT_OF_SALE_OF_PI",
  "Methods to exercise rights": "METHODS_TO_EXERCISE_RIGHTS",
  "Others": "OTHERS",
  "Updated Privacy Policy": "UPDATED_PRIVACY_POLICY",
};

export function tokenizeLabel(labelStr) {
  if (LABEL_TOKEN_MAP[labelStr]) return LABEL_TOKEN_MAP[labelStr];
  let s = labelStr.replace("/", " OR ").replaceAll("-", "_").replaceAll(" ", "_");
  s = [...s].filter((c) => c.match(/[A-Za-z0-9_]/)).join("");
  return s.toUpperCase();
}

// backend/export.py:apply_max_doc_label_cap
export function applyMaxDocLabelCap(rows, maxPct) {
  if (maxPct <= 0 || !rows.length) return [rows, 0];

  const docUnits = {};
  for (const r of rows) {
    const docId = r.doc_id ?? "unknown";
    (docUnits[docId] ??= []).push(r);
  }

  const keptRows = [];
  let removedCount = 0;

  for (const docId in docUnits) {
    const uList = docUnits[docId];
    const docTotal = uList.length;
    const maxAllowed = Math.max(1, Math.ceil((docTotal * maxPct) / 100.0));
    const labelCounts = {};

    for (const r of uList) {
      let labels = [];
      if (Array.isArray(r.label)) labels = r.label;
      else if (r.label) labels = String(r.label).split(";").map((l) => l.trim()).filter((l) => l);
      if (!labels.length) labels = [r.verbatim_label || "unlabeled"];

      const exceeded = labels.some((l) => labelCounts[l] ?? 0 >= maxAllowed);
      if (!exceeded) {
        keptRows.push(r);
        for (const l of labels) labelCounts[l] = (labelCounts[l] ?? 0) + 1;
      } else {
        removedCount += 1;
      }
    }
  }
  return [keptRows, removedCount];
}

// backend/export.py:compute_label_distribution
export function computeLabelDistribution(rows) {
  const dist = {};
  for (const r of rows) {
    let labels;
    if (Array.isArray(r.label)) labels = r.label;
    else if (r.label) labels = String(r.label).split(";").map((l) => l.trim()).filter((l) => l);
    else labels = ["UNLABELED"];
    for (const l of labels) dist[l] = (dist[l] ?? 0) + 1;
  }
  const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries);
}

// backend/export.py:check_cross_split_text_overlap
export function checkCrossSplitTextOverlap(rows) {
  const textSplits = {};
  for (const r of rows) {
    const txt = (r.text || r.unit_text || "").trim();
    if (!txt) continue;
    const split = r.split ?? "train";
    textSplits[txt] ??= new Set();
    textSplits[txt].add(split);
  }
  const overlapping = Object.entries(textSplits).filter(([, splits]) => splits.size > 1).map(([txt, splits]) => [txt, [...splits]]);
  return { overlapping_texts_count: overlapping.length, has_overlap: overlapping.length > 0 };
}

// backend/export.py:_assign_doc_splits
function assignDocSplits(docUnits, trainPct, evalPct, testPct, rng) {
  const totalUnits = Object.values(docUnits).reduce((s, u) => s + u.length, 0);
  if (totalUnits === 0) return {};

  const docIds = [...Object.keys(docUnits)];
  // Fisher–Yates with the same seeded RNG semantics: Python random.shuffle.
  for (let i = docIds.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i + 1);
    const tmp = docIds[i]; docIds[i] = docIds[j]; docIds[j] = tmp;
  }

  const trainTarget = Math.round((totalUnits * trainPct) / 100);
  const evalTarget = Math.round((totalUnits * evalPct) / 100);
  const activeEval = evalPct > 0;
  const activeTest = testPct > 0;

  const docSplits = {};
  let currTrain = 0;
  let currEval = 0;

  for (const docId of docIds) {
    const uLen = docUnits[docId].length;
    if (currTrain < trainTarget || (!activeEval && !activeTest)) {
      docSplits[docId] = "train";
      currTrain += uLen;
    } else if (activeEval && currEval < evalTarget) {
      docSplits[docId] = "eval";
      currEval += uLen;
    } else {
      docSplits[docId] = activeTest ? "test" : "train";
    }
  }

  const activeSplits = ["train"];
  if (activeEval) activeSplits.push("eval");
  if (activeTest) activeSplits.push("test");

  const assignedSplits = new Set(Object.values(docSplits));
  const missingSplits = activeSplits.filter((s) => !assignedSplits.has(s));

  if (missingSplits.length && docIds.length >= activeSplits.length) {
    for (const missing of missingSplits) {
      const splitCounts = {};
      for (const s of Object.values(docSplits)) splitCounts[s] = (splitCounts[s] ?? 0) + 1;
      const donorSplit = Object.entries(splitCounts).sort((a, b) => b[1] - a[1])[0][0];
      if (splitCounts[donorSplit] > 1) {
        for (const d in docSplits) {
          if (docSplits[d] === donorSplit) { docSplits[d] = missing; break; }
        }
      }
    }
  }
  return docSplits;
}

// Seeded PRNG matching Python's random.Random(seed) sequence for the purposes
// of shuffle-driven partitioning. This is NOT byte-identical to CPython's Mersenne
// Twister; it is a deterministic splitter with the same API surface. Switch to a
// MT19937 implementation if exact cross-engine parity with the Python exports is
// ever required for a given seed.
class SeededRng {
  constructor(seed) {
    let x = seed & 0xffffffff;
    let y = 362436069;
    let z = 521288629;
    let w = 88675123;
    this._s = [x, y, z, w];
    this._next = null;
  }
  nextU32() {
    const t = this._s[0] ^ (this._s[0] << 11 & 0xffffffff);
    this._s[0] = this._s[1];
    this._s[1] = this._s[2];
    this._s[2] = this._s[3];
    this._s[3] = (this._s[3] ^ (this._s[3] >> 19) ^ t ^ (t >> 8)) & 0xffffffff;
    return this._s[3];
  }
  /** Java-style nextInt(origin, bound) — uniform in [origin, bound). */
  nextInt(origin, bound) {
    const range = bound - origin;
    if (range <= 0) return origin;
    // 32-bit multiply-high-ish: keep it simple with a bitmask for powers of two.
    const r = this.nextU32();
    return origin + (r % range);
  }
  shuffle(arr) {
    // same Fisher–Yates as assignDocSplits above
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i + 1);
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
  }
}

// backend/export.py:partition
export function partition(rows, train, evalV, test, seed, stratify) {
  const total = train + evalV + test;
  if (total !== 100) throw new Error("train/eval/test percentages must sum to 100");
  if (!rows.length) return rows;

  const rng = new SeededRng(seed);

  const docUnits = {};
  for (const r of rows) {
    const docId = r.doc_id ?? "unknown";
    (docUnits[docId] ??= []).push(r);
  }

  const docSplits = {};
  if (stratify) {
    const docLabelMap = {};
    const globalLabelDocCounts = {};
    for (const docId in docUnits) {
      const labels = new Set();
      for (const u of docUnits[docId]) {
        if (u.verbatim_labels) {
          for (const l of u.verbatim_labels.split(";")) if (l) labels.add(l);
        } else if (u.verbatim_label) {
          labels.add(u.verbatim_label);
        }
      }
      docLabelMap[docId] = labels;
      for (const l of labels) globalLabelDocCounts[l] = (globalLabelDocCounts[l] ?? 0) + 1;
    }

    const labelBins = {};
    for (const docId in docUnits) {
      const labels = docLabelMap[docId];
      let primaryLabel;
      if (labels.size) {
        primaryLabel = [...labels].sort(
          (a, b) => {
            const ca = globalLabelDocCounts[a] ?? 0, cb = globalLabelDocCounts[b] ?? 0;
            return ca !== cb ? ca - cb : (a < b ? -1 : a > b ? 1 : 0);
          }
        )[0];
      } else {
        primaryLabel = "__unlabeled__";
      }
      labelBins[primaryLabel] ??= {};
      labelBins[primaryLabel][docId] = docUnits[docId];
    }

    for (const primaryLabel in labelBins) {
      const binSplits = assignDocSplits(labelBins[primaryLabel], train, evalV, test, rng);
      Object.assign(docSplits, binSplits);
    }
  } else {
    Object.assign(docSplits, assignDocSplits(docUnits, train, evalV, test, rng));
  }

  for (const r of rows) r.split = docSplits[r.doc_id ?? "unknown"] ?? "train";
  return rows;
}

// RFC4180 CSV writer (no external dep). Mirrors python csv.DictWriter for the
// value types we emit: strings, lists->"; ", numbers, booleans, null->"".
function csvField(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return csvField(value.join("; "));
  let s = String(value);
  if (/[",\r\n]/.test(s)) s = '"' + s.replaceAll('"', '""') + '"';
  return s;
}

export function rowsToCsv(rows, fieldnames) {
  const header = fieldnames.map(csvField).join(",") + "\r\n";
  const body = rows.map((r) => fieldnames.map((k) => csvField(r[k])).join(",") + "\r\n").join("");
  return header + body;
}

export function rowsToJson(rows) {
  const splits = { train: [], eval: [], test: [] };
  for (const r of rows) {
    const s = r.split ?? "train";
    splits[s] ??= [];
    splits[s].push(r);
  }
  return {
    splits,
    counts: { train: splits.train.length, eval: splits.eval.length, test: splits.test.length },
  };
}

// backend/services/export_service.py:compute_label_support_analysis
export function computeLabelSupportAnalysis(rows) {
  const totalRows = rows.length;
  if (!totalRows) return {};

  const stats = {};
  for (const r of rows) {
    const docId = r.doc_id ?? "unknown";
    const supportList = r.support ?? [];

    let tokens;
    if (Array.isArray(r.label)) tokens = r.label;
    else if (r.label) tokens = String(r.label).split(";").map((t) => t.trim()).filter((t) => t);
    else tokens = ["UNLABELED"];

    const supportByToken = {};
    for (const s of supportList) {
      const tLabel = tokenizeLabel(s.label ?? "");
      supportByToken[tLabel] = s;
    }

    for (const t of tokens) {
      const st = (stats[t] ??= {
        count: 0, docs: new Set(), k_sum: 0, ratio_sum: 0.0,
        has_support_info_count: 0, unanimous_count: 0, disputed_count: 0,
      });
      st.count += 1;
      st.docs.add(docId);
      const sInfo = supportByToken[t];
      if (sInfo) {
        const k = sInfo.k ?? 0;
        const p = sInfo.pool ?? 0;
        const stars = sInfo.stars ?? 1;
        st.k_sum += k;
        if (p > 0) {
          st.ratio_sum += k / p;
          st.has_support_info_count += 1;
        }
        if (stars === 3) st.unanimous_count += 1;
        else if (stars === 1) st.disputed_count += 1;
      }
    }
  }

  const out = {};
  for (const token of Object.keys(stats).sort((a, b) => stats[b].count - stats[a].count)) {
    const st = stats[token];
    const cnt = st.count;
    const pct = Number(((cnt / totalRows) * 100).toFixed(2));
    const infoCnt = st.has_support_info_count;
    const avgK = infoCnt > 0 ? Number((st.k_sum / infoCnt).toFixed(2)) : 0;
    const meanRatio = infoCnt > 0 ? Number((st.ratio_sum / infoCnt).toFixed(4)) : 0;
    out[token] = {
      raw_count: cnt,
      percentage_of_corpus: pct,
      distinct_documents: st.docs.size,
      avg_supporting_annotators: avgK,
      mean_agreement_rate: meanRatio,
      unanimous_count: st.unanimous_count,
      disputed_count: st.disputed_count,
    };
  }
  return out;
}
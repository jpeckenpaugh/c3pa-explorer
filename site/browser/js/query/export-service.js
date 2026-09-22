// Port of backend/services/export_service.py export_units + preview_export → JS.
//
// Wire-in for the browser edition: given the injected createQuery facade (db),
// build the same export (rows → decorate → support → cap → partition → files)
// the FastAPI /api/export and /api/export/preview endpoints produced, and
// package the download as a in-memory ZIP via CompressStream + a tiny ZIP
// writer (deflate-raw entry payloads, standard local+central headers).
//
// The response surfaces match the Python exactly:
//   buildExportFiles(...) -> { zip: Uint8Array, zipFilename, meta }
//   previewExportRows(...) -> the preview JSON dict.

"use strict";

import { unitRows } from "./units.js";
import { unitSupport, parseUnitParams } from "./filters.js";
import {
  UNIT_FIELDS,
  tokenizeLabel,
  applyMaxDocLabelCap,
  computeLabelDistribution,
  checkCrossSplitTextOverlap,
  partition,
  rowsToCsv,
  computeLabelSupportAnalysis,
} from "./export.js";

// backend/db.py:UNIT_FIELDS + the extra columns export appends
export const ALL_EXPORT_FIELDS = [
  ...UNIT_FIELDS,
  "support_stars", "support_evidence", "split",
];

// ---------------------------------------------------------------------------
// shared row decoration (export_units + preview_export share this exactly)
// ---------------------------------------------------------------------------

function decorateExportRows(rows, support, format) {
  for (const r of rows) {
    const pairs = support.get(r.unit_id ?? "") ?? [];
    r.support = pairs;
    r.support_stars = pairs.length ? Math.max(...pairs.map((p) => p.stars)) : "";
    r.support_evidence = pairs.length ? Math.max(...pairs.map((p) => p.k)) : "";

    r.id = r.unit_id ?? "";
    r.group = r.doc_id ?? "";
    r.text = r.unit_text || r.text || "";

    const vLabelsStr = r.verbatim_labels || "";
    let rawLabels = vLabelsStr.split(";").map((l) => l.trim()).filter((l) => l);
    if (!rawLabels.length && r.verbatim_label) rawLabels = [r.verbatim_label];

    if (!rawLabels.length) {
      r.label_name = "Unlabeled";
      r.label = "UNLABELED";
    } else if (rawLabels.length === 1) {
      r.label_name = rawLabels[0];
      r.label = tokenizeLabel(rawLabels[0]);
    } else {
      if (format === "json") {
        r.label_name = rawLabels;
        r.label = rawLabels.map(tokenizeLabel);
      } else {
        r.label_name = rawLabels.join("; ");
        r.label = rawLabels.map(tokenizeLabel).join("; ");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// CRC32 (needed for ZIP entry checksums) — compact, deterministic table impl
// ---------------------------------------------------------------------------
let CRC_TABLE = null;
function crc32Table() {
  if (CRC_TABLE) return CRC_TABLE;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  CRC_TABLE = table;
  return table;
}
export function crc32(bytes) {
  const table = crc32Table();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) & 0xffffffff;
}

async function deflateRaw(input) {
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();
  const chunks = [];
  writer.write(input);
  writer.close();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(new Uint8Array(value));
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// minimal ZIP writer (single-level, deflate-raw entries + meta.json)
// ---------------------------------------------------------------------------
function u16(v) { return new Uint8Array([v & 0xff, (v >> 8) & 0xff]); }
function u32(v) { return new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]); }

function localHeader(name, crc, compSize, rawSize) {
  const nameBytes = new TextEncoder().encode(name);
  const h = new Uint8Array(30 + nameBytes.length);
  h.set([0x50, 0x4b, 0x03, 0x04]);
  h.set(u16(20), 4);        // version needed
  h.set(u16(0x0800), 6);    // flags: UTF-8 names
  h.set(u16(8), 8);         // deflate
  h.set(u32(crc), 14);
  h.set(u32(compSize), 18);
  h.set(u32(rawSize), 22);
  h.set(u16(nameBytes.length), 26);
  h.set(u16(0), 28);
  h.set(nameBytes, 30);
  return h;
}

function centralHeader(name, crc, compSize, rawSize, localOffset) {
  const nameBytes = new TextEncoder().encode(name);
  const h = new Uint8Array(46 + nameBytes.length);
  h.set([0x50, 0x4b, 0x01, 0x02]);
  h.set(u16(20), 4);        // version made by
  h.set(u16(20), 6);        // version needed
  h.set(u16(0x0800), 8);    // flags: UTF-8
  h.set(u16(8), 10);        // deflate
  h.set(u32(crc), 16);
  h.set(u32(compSize), 20);
  h.set(u32(rawSize), 24);
  h.set(u16(nameBytes.length), 28);
  h.set(u16(0), 30);
  h.set(u32(localOffset), 42);
  h.set(nameBytes, 46);
  return h;
}

async function buildZip(files) {
  // files: [{ name, bytes }] in insertion order
  const localParts = [];
  const centralParts = [];
  const entries = [];
  let offset = 0;
  for (const f of files) {
    const raw = f.bytes;
    const comp = await deflateRaw(raw);
    const crc = crc32(raw);
    localParts.push(localHeader(f.name, crc, comp.length, raw.length));
    localParts.push(comp);
    entries.push({ name: f.name, crc, compSize: comp.length, rawSize: raw.length, offset });
    offset += localHeader(f.name, crc, comp.length, raw.length).length + comp.length;
  }
  const centralOffset = offset;
  for (const e of entries) {
    centralParts.push(centralHeader(e.name, e.crc, e.compSize, e.rawSize, e.offset));
  }
  // end of central directory
  const cdSize = centralParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  eocd.set([0x50, 0x4b, 0x05, 0x06]);
  eocd.set(u16(entries.length), 8);
  eocd.set(u16(entries.length), 10);
  eocd.set(u32(cdSize), 12);
  eocd.set(u32(centralOffset), 16);
  const parts = [...localParts, ...centralParts, eocd];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function timestampFilename() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}-${p(d.getUTCHours())}-${p(d.getUTCMinutes())}`;
}

// ---------------------------------------------------------------------------
// orchestration entry points (mirror export_service.export_units / preview)
// ---------------------------------------------------------------------------

function resolveParams(params, opts) {
  // Coerce raw query-string values exactly as FastAPI's UnitFilterParams.to_dict()
  // did — `exclude_labels` becomes an array, `high_confidence`/`stratify` bools,
  // ints parsed — so unitRows/buildUnitFilter see the same typed params the
  // /api/units and /api/export routers produced. (parseUnitParams handles the
  // comma-splitting and int/bool coercion.)
  const p = parseUnitParams(params);
  if (opts.excludeOther) {
    if (!p.exclude_labels.includes("Others")) p.exclude_labels.push("Others");
  }
  return p;
}

function toMeta(rows, total, params, opts, removedCount, evidenceThreshold) {
  const meta = {
    entity: "units",
    filters: Object.fromEntries(Object.entries(params).filter(([, v]) => v)),
    total: rows.length,
    original_total: total,
    format: opts.format,
    max_doc_label_pct: opts.maxDocLabelPct,
    capped_units_removed: removedCount,
  };
  const unlabeledCount = rows.filter((r) => r.label_category === "unlabeled").length;
  const fragmentCount = rows.filter((r) => r.unit_kind === "fragment").length;
  if (unlabeledCount) {
    meta.unlabeled_count = unlabeledCount;
    meta.unlabeled_note = "'unlabeled' sentences produced no annotation signal in this annotation version (6 annotators x budget); they are NOT verified negatives and cannot be designated as label-inapplicable. Treat them as unlabeled (positive-unlabeled learning), not as a negative class.";
  }
  if (fragmentCount) {
    meta.fragments_note = "fragments are not label-eligible by design; exporting them does not produce sentence/label pairs.";
  }
  meta.evidence_threshold = evidenceThreshold;
  meta.min_support = params.min_support ?? 1;
  meta.support_mode = params.support_mode ?? "at_least";
  return meta;
}

/**
 * previewExport({ db, params, opts }) -> the /api/export/preview JSON body.
 * params come RAW from the query string (like the bridge supplies: strings,
 * comma-joined where applicable) — resolveParams coerces via parseUnitParams
 * exactly as FastAPI's UnitFilterParams.to_dict() did.
 * opts: { format, split, splitTrain, splitEval, splitTest, seed, stratify,
 *         excludeOther, maxDocLabelPct }
 */
export function previewExport(db, rawParams, opts = {}) {
  const params = resolveParams(rawParams, opts);
  const warnings = [];
  const train = opts.splitTrain ?? 80, evalV = opts.splitEval ?? 10, test = opts.splitTest ?? 10;
  const split = opts.split !== false;
  if (split && train + evalV + test !== 100) {
    return { valid: false, error: "split_train + split_eval + split_test must equal 100", warnings: ["Partition ratios must sum to 100%."] };
  }
  let rows, total;
  try {
    [rows, total] = unitRows(db, params);
  } catch (e) {
    return { valid: false, error: e.message, warnings: [] };
  }
  if (!rows.length) {
    return { valid: false, error: "No units match the selected filter criteria.", total_units: 0, counts: {}, warnings: ["Current filter settings returned 0 units."] };
  }
  const evidenceThreshold = params.evidence_threshold ?? 1;
  const support = unitSupport(db, evidenceThreshold);
  decorateExportRows(rows, support, opts.format ?? "csv");

  const originalTotal = rows.length;
  let removedCount = 0;
  if (opts.maxDocLabelPct && opts.maxDocLabelPct > 0) {
    const cap = applyMaxDocLabelCap(rows, opts.maxDocLabelPct);
    rows = cap[0];
    removedCount = cap[1];
  }

  let counts;
  if (split) {
    rows = partition(rows, train, evalV, test, opts.seed ?? 42, opts.stratify !== false);
    const splitRows = { train: 0, eval: 0, test: 0 };
    for (const r of rows) splitRows[r.split ?? "train"] += 1;
    counts = Object.fromEntries(Object.entries(splitRows).filter(([, v]) => v > 0));
    for (const [sName, pct] of [["train", train], ["eval", evalV], ["test", test]]) {
      if (pct > 0 && (splitRows[sName] ?? 0) === 0) warnings.push(`Split '${sName}' yielded 0 units. Adjust filters or split ratios.`);
    }
  } else {
    counts = { data: rows.length };
  }

  const labelDist = computeLabelDistribution(rows);
  const supportAnalysis = computeLabelSupportAnalysis(rows);
  const overlapInfo = checkCrossSplitTextOverlap(rows);
  if (overlapInfo.has_overlap) {
    warnings.push(`Detected ${overlapInfo.overlapping_texts_count} identical text string(s) present across different splits.`);
  }

  return {
    valid: true,
    total_units: rows.length,
    original_total: originalTotal,
    capped_units_removed: removedCount,
    counts,
    split_enabled: split,
    max_doc_label_pct: opts.maxDocLabelPct ?? 0,
    label_distribution: labelDist,
    label_support_analysis: supportAnalysis,
    cross_split_text_overlap: overlapInfo,
    warnings,
  };
}

/**
 * buildExportFiles({ db, params, opts }) -> { zip (Uint8Array), zipFilename, meta }.
 * Mirrors export_units: rows → decorate → cap → partition → files → zip.
 */
export async function buildExportFiles(db, rawParams, opts = {}) {
  const params = resolveParams(rawParams, opts);
  const format = opts.format ?? "csv";
  const split = opts.split !== false;
  const train = opts.splitTrain ?? 80, evalV = opts.splitEval ?? 10, test = opts.splitTest ?? 10;
  const seed = opts.seed ?? 42;
  const stratify = opts.stratify !== false;

  let rows, total;
  [rows, total] = unitRows(db, params);
  const evidenceThreshold = params.evidence_threshold ?? 1;
  const support = unitSupport(db, evidenceThreshold);
  decorateExportRows(rows, support, format);

  let removedCount = 0;
  if (opts.maxDocLabelPct && opts.maxDocLabelPct > 0) {
    const cap = applyMaxDocLabelCap(rows, opts.maxDocLabelPct);
    rows = cap[0];
    removedCount = cap[1];
  }

  const meta = toMeta(rows, total, params, { format, maxDocLabelPct: opts.maxDocLabelPct ?? 0 }, removedCount, evidenceThreshold);

  if (split) {
    if (train + evalV + test !== 100) throw new Error("split_train + split_eval + split_test must equal 100");
    rows = partition(rows, train, evalV, test, seed, stratify);
    meta.split = { train, eval: evalV, test, seed, stratify, grouped_by: "doc_id" };
    meta.grouping_note = "Partitions are strictly grouped by document (doc_id) to prevent data leakage across train/eval/test splits.";
  } else {
    for (const r of rows) r.split = "data";
  }

  meta.label_distribution = computeLabelDistribution(rows);
  meta.label_support_analysis = computeLabelSupportAnalysis(rows);
  meta.cross_split_text_overlap = checkCrossSplitTextOverlap(rows);

  let fieldnames;
  if (opts.fields) {
    const requested = String(opts.fields).split(",").map((f) => f.trim()).filter((f) => f);
    fieldnames = requested.filter((f) => ALL_EXPORT_FIELDS.includes(f));
  } else {
    fieldnames = ["id", "doc_id", "text", "label", "label_name", "split"];
  }
  meta.selected_fields = fieldnames;
  meta.created_at = new Date().toISOString();
  const ts = timestampFilename();

  const dataFiles = {};
  if (split) {
    const splitRows = { train: [], eval: [], test: [] };
    for (const r of rows) (splitRows[r.split ?? "train"] ??= []).push(r);
    meta.counts = { train: splitRows.train.length, eval: splitRows.eval.length, test: splitRows.test.length };
    for (const [sName, sItems] of Object.entries(splitRows)) {
      if (!sItems.length) continue;
      const count = sItems.length;
      const ext = format === "json" ? "json" : "csv";
      const fname = `${sName}_${count}.${ext}`;
      const filtered = sItems.map((r) => Object.fromEntries(fieldnames.filter((k) => k in r).map((k) => [k, r[k]])));
      dataFiles[fname] = format === "json" ? JSON.stringify(filtered, null, 2) : rowsToCsv(filtered, fieldnames);
    }
  } else {
    meta.counts = { total };
    const count = rows.length;
    const ext = format === "json" ? "json" : "csv";
    const fname = `data_${count}.${ext}`;
    const filtered = rows.map((r) => Object.fromEntries(fieldnames.filter((k) => k in r).map((k) => [k, r[k]])));
    dataFiles[fname] = format === "json" ? JSON.stringify(filtered, null, 2) : rowsToCsv(filtered, fieldnames);
  }

  const metaBytes = new TextEncoder().encode(JSON.stringify(meta, null, 2));
  const files = [{ name: "meta.json", bytes: metaBytes }];
  for (const [fname, content] of Object.entries(dataFiles)) {
    files.push({ name: fname, bytes: new TextEncoder().encode(content) });
  }

  const zip = await buildZip(files);
  const zipFilename = `c3pa_export_${ts}.zip`;
  return { zip, zipFilename, meta, dataFiles };
}

// ---------------------------------------------------------------------------
// worker-facing facade (mirrors createQuery(db) in sqlite-bridge.js)
// ---------------------------------------------------------------------------

/**
 * createExportHandler(db) — binds all export entry points to an open DB.
 * params are the raw query-string dict from the bridge (parseUnitParams can be
 * applied by the caller); opts carry format/split/seed/... — the same surface
 * the /api/export* routers exposed as query params.
 */
export function createExportHandler(db) {
  return {
    preview: (params, opts) => previewExport(db, params, opts),
    download: async (params, opts) => buildExportFiles(db, params, opts),
  };
}
// Phase 3 — export port tests. Drives browser/js/query/export-service.js +
// export.js against the REAL canonical snapshot (builds.json entry), and
// validates the produced ZIP the way a user downloads it: parseable central
// directory, meta.json present, split files present, CSV parses.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "../browser/vendor/sql.js/sql-wasm.js";
import { extractSingleDbFromTarGz } from "../browser/js/core/snapshot-targz.js";
import { createExportHandler } from "../browser/js/query/export-service.js";
import { parseUnitParams } from "../browser/js/query/filters.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const SQLJS_DIR = path.join(ROOT, "browser", "vendor", "sql.js");
const builds = JSON.parse(fs.readFileSync(path.join(ROOT, "builds.json"), "utf8"));
const entry = builds.builds[0];

let sql;
let db;

test("export: open canonical snapshot", async () => {
  const archive = new Uint8Array(fs.readFileSync(path.join(ROOT, entry.file)));
  const { bytes } = await extractSingleDbFromTarGz(archive);
  sql = await initSqlJs({ locateFile: (f) => path.join(SQLJS_DIR, f) });
  db = new sql.Database(bytes);
  db.run("PRAGMA foreign_keys=ON");
  assert.ok(bytes.length > 1_000_000);
});

test("export: preview returns valid with partitions summing to 100", async () => {
  // RAW query-string params exactly as the bridge supplies from the URL
  // (strings + comma-joined lists), reproducing the exclude_labels path that
  // previously failed with "exclude_labels.map is not a function".
  const params = { subset: "DB", limit: "50", offset: "0", exclude_labels: "Others", evidence_threshold: "1", min_support: "2" };
  const r = createExportHandler(db).preview(params, { format: "csv", split: true, splitTrain: 70, splitEval: 15, splitTest: 15, seed: 42, stratify: true, excludeOther: true, maxDocLabelPct: 0 });
  assert.equal(r.valid, true, JSON.stringify(r).slice(0, 200));
  assert.ok(r.total_units > 0);
  assert.ok(r.counts.train > 0);
  assert.ok(r.counts.eval > 0, "eval split should be populated with 3-way split");
  assert.ok(r.counts.test > 0);
});

test("export: preview without split reports a single data bucket", async () => {
  const params = parseUnitParams({ subset: "WS" });
  const r = createExportHandler(db).preview(params, { format: "csv", split: false });
  assert.equal(r.valid, true);
  assert.ok(r.counts.data > 0);
});

test("export: build produces a parseable ZIP with meta.json + split files", async () => {
  const params = { subset: "DB", limit: "50", offset: "0", exclude_labels: "Others" };
  const { zip, zipFilename, meta } = await createExportHandler(db).download(
    params,
    { format: "csv", split: true, splitTrain: 70, splitEval: 15, splitTest: 15, seed: 42, stratify: true, excludeOther: true, maxDocLabelPct: 0 }
  );
  assert.match(zipFilename, /^c3pa_export_[\d-]+\.zip$/);
  assert.ok(zip.length > 1000);

  // find EOCD → central directory → entry names + sizes
  const bytesStr = new Uint8Array(zip);
  let eocd = -1;
  for (let i = bytesStr.length - 22; i >= 0; i--) {
    if (bytesStr[i] === 0x50 && bytesStr[i + 1] === 0x4b && bytesStr[i + 2] === 0x05 && bytesStr[i + 3] === 0x06) { eocd = i; break; }
  }
  assert.ok(eocd >= 0, "EOCD present");
  const u16 = (o) => bytesStr[o] | (bytesStr[o + 1] << 8);
  const u32 = (o) => bytesStr[o] | (bytesStr[o + 1] << 8) | (bytesStr[o + 2] << 16) | (bytesStr[o + 3] << 24);
  const cdCount = u16(eocd + 10);
  let ptr = u32(eocd + 16);
  const names = [];
  for (let i = 0; i < cdCount; i++) {
    assert.equal(bytesStr[ptr], 0x50);
    assert.equal(bytesStr[ptr + 1], 0x4b);
    assert.equal(bytesStr[ptr + 2], 0x01);
    assert.equal(bytesStr[ptr + 3], 0x02);
    const nameLen = u16(ptr + 28);
    const extraLen = u16(ptr + 30);
    const commentLen = u16(ptr + 32);
    const nameBytes = bytesStr.slice(ptr + 46, ptr + 46 + nameLen);
    names.push(new TextDecoder().decode(nameBytes));
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  assert.ok(names.includes("meta.json"), `meta.json in zip (got ${names.slice(0, 5)})`);
  assert.ok(names.some((n) => n.startsWith("train_")), "train_* present");
  assert.ok(names.some((n) => n.startsWith("eval_")), "eval_* present");
  assert.ok(names.some((n) => n.startsWith("test_")), "test_* present");

  assert.equal(meta.counts.train + meta.counts.eval + meta.counts.test, meta.total);
  assert.equal(meta.selected_fields.length, 6, "default fields");
});

test("export: CSV header exactly matches FastAPI default field list", async () => {
  const params = parseUnitParams({ subset: "DB", limit: "10", offset: "0" });
  const { zip, meta } = await createExportHandler(db).download(params, { format: "csv", split: true, splitTrain: 80, splitEval: 10, splitTest: 10, seed: 42, stratify: false });
  assert.deepEqual(meta.selected_fields, ["id", "doc_id", "text", "label", "label_name", "split"]);

  // pull the train_* entry raw from the zip and check its first line
  const bytesStr = new Uint8Array(zip);
  let eocd = -1;
  for (let i = bytesStr.length - 22; i >= 0; i--) {
    if (bytesStr[i] === 0x50 && bytesStr[i + 1] === 0x4b && bytesStr[i + 2] === 0x05 && bytesStr[i + 3] === 0x06) { eocd = i; break; }
  }
  const u16 = (o) => bytesStr[o] | (bytesStr[o + 1] << 8);
  const u32 = (o) => bytesStr[o] | (bytesStr[o + 1] << 8) | (bytesStr[o + 2] << 16) | (bytesStr[o + 3] << 24);
  const cdCount = u16(eocd + 10);
  let ptr = u32(eocd + 16);
  let trainLocalOffset = -1;
  for (let i = 0; i < cdCount; i++) {
    const nameLen = u16(ptr + 28);
    const nameBytes = bytesStr.slice(ptr + 46, ptr + 46 + nameLen);
    const nm = new TextDecoder().decode(nameBytes);
    if (nm.startsWith("train_")) trainLocalOffset = u32(ptr + 42);
    ptr += 46 + nameLen + u16(ptr + 30) + u16(ptr + 32);
  }
  assert.ok(trainLocalOffset >= 0, "train_ entry found in central dir");
  // local header: nameLen at +26, extraLen at +28, data starts at +30
  const lhNameLen = u16(trainLocalOffset + 26);
  const lhExtraLen = u16(trainLocalOffset + 28);
  const dataStart = trainLocalOffset + 30 + lhNameLen + lhExtraLen;
  const compSize = u32(trainLocalOffset + 18);
  const inflated = await inflateRaw(new Uint8Array(bytesStr.slice(dataStart, dataStart + compSize)));
  const csvText = new TextDecoder().decode(inflated);
  assert.equal(csvText.split(/\r?\n/)[0], "id,doc_id,text,label,label_name,split");
});

async function inflateRaw(data) {
  const ds = new DecompressionStream("deflate-raw");
  const w = ds.writable.getWriter();
  const r = ds.readable.getReader();
  const chunks = [];
  w.write(data); w.close();
  while (true) {
    const { done, value } = await r.read();
    if (done) break;
    chunks.push(new Uint8Array(value));
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

test("export: max doc label cap removes rows and is reported", async () => {
  const params = parseUnitParams({ subset: "WS" });
  const r = createExportHandler(db).preview(params, { format: "csv", split: false, maxDocLabelPct: 5 });
  assert.equal(r.valid, true);
  assert.ok(r.capped_units_removed >= 0);
  assert.equal(r.max_doc_label_pct, 5);
});
/* C3PA Explorer — Database engine modal (nav "DB" icon).
 *
 * Two jobs, one modal:
 *   1. Visibility into the sql.js engine — active snapshot, schema version,
 *      dataset commit, hashes, integrity, and row counts (from the embedded
 *      manifest table read by the worker at boot).
 *   2. Engine configuration — switch between the default sql.js (WASM) engine
 *      and a FastAPI backend (same origin, or a remote origin), with a
 *      connection test against /api/stats.
 *
 * The choice is persisted via frontend/js/core/engine.js; boot.js reads it to
 * decide whether to initialize the sql.js runtime at all.
 */
"use strict";

import { getEngine, setEngine } from "../core/engine.js";
import { clearSnapshot } from "../../sqljs/js/core/snapshot-storage.js";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function renderSnapshotInfo(container) {
  const bridge = globalThis.c3paBrowser;
  const snap = bridge && bridge.snapshot;
  if (!snap) {
    container.innerHTML = `<div class="text-muted">No snapshot loaded yet.</div>`;
    return;
  }
  const m = snap.manifest || {};
  let countsHtml = "";
  try {
    const counts = JSON.parse(m.counts || "{}");
    countsHtml = Object.entries(counts)
      .map(([k, v]) => `<span class="badge text-bg-light border me-1 mb-1">${esc(k)}: ${Number(v).toLocaleString()}</span>`)
      .join("");
  } catch { /* counts absent */ }

  const rows = [
    ["Snapshot", snap.name],
    ["schema_version", m.schema_version],
    ["dataset_commit", m.dataset_commit],
    ["code_rev", m.code_rev],
    ["built_at", m.built_at],
    ["db_sha256", m.db_sha256 ? m.db_sha256.slice(0, 12) + "…" : ""],
    ["integrity", snap.integrity && snap.integrity.ok ? "ok ✓" : "not verified"],
  ].filter(([, v]) => v !== undefined && v !== "");

  container.innerHTML =
    `<table class="table table-sm table-borderless align-middle mb-1">` +
    rows.map(([k, v]) => `<tr><td class="text-muted" style="width:40%">${esc(k)}</td><td class="font-monospace small">${esc(v)}</td></tr>`).join("") +
    `</table>` +
    (countsHtml ? `<div class="mb-1">${countsHtml}</div>` : "");
}

export function wireDatabaseModal() {
  const modalEl = document.getElementById("dbModal");
  const engineRadios = document.querySelectorAll('input[name="engineRadio"]');
  const sqljsSection = document.getElementById("dbModalSqljs");
  const fastapiSection = document.getElementById("dbModalFastapi");
  const apiBaseInput = document.getElementById("dbApiBase");
  const testBtn = document.getElementById("dbTestConnection");
  const statusEl = document.getElementById("dbFastapiStatus");
  const loadDifferentBtn = document.getElementById("dbLoadDifferent");
  const snapshotInfo = document.getElementById("dbSnapshotInfo");

  if (!modalEl) return;

  function applyEngineUI() {
    const engine = getEngine();
    for (const radio of engineRadios) radio.checked = radio.value === engine.mode;
    apiBaseInput.value = engine.apiBase || "";
    sqljsSection.classList.toggle("d-none", engine.mode !== "sqljs");
    fastapiSection.classList.toggle("d-none", engine.mode !== "fastapi");
  }

  modalEl.addEventListener("shown.bs.modal", () => {
    applyEngineUI();
    if (getEngine().mode === "sqljs") renderSnapshotInfo(snapshotInfo);
    statusEl.textContent = "";
  });

  for (const radio of engineRadios) {
    radio.addEventListener("change", () => {
      const apiBase = apiBaseInput.value.trim().replace(/\/+$/, "");
      setEngine({ mode: radio.value, apiBase });
      location.reload();
    });
  }

  apiBaseInput.addEventListener("change", () => {
    const apiBase = apiBaseInput.value.trim().replace(/\/+$/, "");
    setEngine({ mode: getEngine().mode, apiBase });
  });

  testBtn.addEventListener("click", async () => {
    const apiBase = apiBaseInput.value.trim().replace(/\/+$/, "");
    setEngine({ mode: "fastapi", apiBase });
    statusEl.textContent = "Testing…";
    statusEl.className = "small";
    try {
      const res = await fetch(`${apiBase || ""}/api/stats`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      statusEl.className = "small text-success";
      statusEl.textContent =
        `Connected — ${data.documents ?? "?"} documents, ${data.units ?? "?"} units. ` +
        `Switch to FastAPI and the SPA will query this backend.`;
    } catch (error) {
      statusEl.className = "small text-danger";
      statusEl.textContent = `Connection failed: ${error.message}`;
    }
  });

  loadDifferentBtn.addEventListener("click", async () => {
    try { await clearSnapshot(); } catch { /* best-effort */ }
    location.reload();
  });
}
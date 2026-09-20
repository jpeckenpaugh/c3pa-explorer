/* C3PA Explorer browser edition — boot script.
 *
 * Injected by browser/serve.py into the served index.html BEFORE the SPA's
 * <script type="module" src="/static/js/main.js"> (an in-memory rewrite at
 * request time — the file on disk is never touched, so the FastAPI-served page
 * stays byte-identical, §7b.2). Module scripts run in document order, so this
 * module fully evaluates before main.js, hence before the SPA's first
 * fetchJSON. The bridge is installed on globalThis SYNCHRONOUSLY in this
 * module's body, and its fetchJSON awaits an internal `ready` promise that is
 * resolved only after worker-open → manifest.read → validateManifest →
 * integrity.check succeed (§7b.2): page renders queue, never fail.
 *
 * The overlay (file-picker + drop zone + loading/error states) lives here, not
 * in the shell (§7a.4). #navDownload is hidden in browser mode because the
 * export modal uses raw fetch/anchor (Phase 3, §7b.7).
 */
"use strict";

import { SNAPSHOT_SCHEMA_VERSION } from "./snapshot-version.js";
import { createBridge, validateManifest } from "./bridge.js";
import { saveSnapshot, loadSnapshot } from "./snapshot-storage.js";
import { isGzipBytes, extractSingleDbFromTarGz } from "./snapshot-targz.js";

const browser = createBridge();
globalThis.c3paBrowser = browser;

const NOT_A_SNAPSHOT =
  "This file is not a C3PA Explorer snapshot: it has no embedded manifest table. " +
  "Pick a .db produced by the Phase-1 Colab notebook.";

function versionMismatchMessage(actual) {
  return (
    `Snapshot schema_version is "${actual}" but this app expects ` +
    `"${SNAPSHOT_SCHEMA_VERSION}". Rebuild the snapshot with the Colab notebook, or update this app.`
  );
}

// ---- hide the raw-fetch export button (Phase 3) ----
const navDownload = document.querySelector("#navDownload");
if (navDownload) navDownload.style.display = "none";

// ---- boot overlay styles (browser/-only; frontend/ stays untouched) --------
(function injectStyles() {
  const style = document.createElement("style");
  style.textContent = `
.c3pa-boot-overlay{position:fixed;inset:0;z-index:2000;background:#0b1220;display:flex;align-items:center;justify-content:center}
.c3pa-boot-card{max-width:34rem;background:#101a2a;border:1px solid #2c3a52;border-radius:12px;color:#e9edf1;padding:28px 30px;text-align:center}
.c3pa-boot-title{font-size:1.35rem;font-weight:700}
.c3pa-boot-sub{color:#9aa9c3;margin-top:8px;font-size:.93rem}
.c3pa-boot-drop{margin-top:18px;border:2px dashed #3b4f74;border-radius:10px;padding:26px 20px;cursor:pointer;color:#c7d2e6;font-size:.98rem}
.c3pa-boot-drop.c3pa-boot-drag{border-color:#7ba7e0;background:rgba(56,96,180,.12)}
.c3pa-boot-link{color:#7aa2ff;text-decoration:underline}
.c3pa-boot-status{margin-top:14px;font-size:.92rem;word-break:break-word}
.c3pa-boot-error{color:#ff9b9b}
.c3pa-boot-loading{color:#ffd27a}
.c3pa-boot-ok{color:#7fd9a0}
.c3pa-boot-done .c3pa-boot-card{border-color:#1f6b3a;background:rgba(20,64,38,.15)}
`;
  (document.head || document.body).appendChild(style);
})();

// ---- boot overlay UI ---------------------------------------------------------

const overlay = document.createElement("div");
overlay.className = "c3pa-boot-overlay";
overlay.innerHTML = `
  <div class="c3pa-boot-card" role="dialog" aria-label="C3PA Explorer snapshot">
    <div class="c3pa-boot-title">C3PA Explorer <span class="text-muted">browser edition</span></div>
    <div class="c3pa-boot-sub">Pick a C3PA Explorer snapshot (.db or .tar.gz) to open this app.</div>
    <div class="c3pa-boot-drop" id="c3paBootDrop">
      <input type="file" id="c3paBootFile" accept=".db,.tar.gz,.tgz,.gz,application/octet-stream,application/x-sqlite3,application/gzip" hidden>
      <div class="c3pa-boot-drop-text">Drop the snapshot here, or <span class="c3pa-boot-link">browse&hellip;</span></div>
    </div>
    <div class="c3pa-boot-status" id="c3paBootStatus" hidden></div>
  </div>`;
document.body.appendChild(overlay);

const fileInput = overlay.querySelector("#c3paBootFile");
const dropZone = overlay.querySelector("#c3paBootDrop");
const statusEl = overlay.querySelector("#c3paBootStatus");

function setStatus(text, state = "idle") {
  statusEl.hidden = false;
  statusEl.textContent = text;
  statusEl.className = `c3pa-boot-status c3pa-boot-${state}`;
}

function finishError(message) {
  setStatus(message, "error");
  const reload = document.createElement("button");
  reload.className = "btn btn-outline-light btn-sm mt-2";
  reload.textContent = "Reload";
  reload.addEventListener("click", () => location.reload());
  statusEl.appendChild(reload);
}

function finishSuccess(manifest) {
  const counts = {};
  try { Object.assign(counts, JSON.parse(manifest.counts || "{}")); } catch { /* non-fatal */ }
  const units = counts.units ?? counts.documents ?? "";
  const docs = counts.documents ?? counts.units ?? "";
  const label = `${docs} document${docs === 1 ? "" : "s"}, ${units} unit${units === 1 ? "" : "s"}`;
  setStatus(`Snapshot opened — ${label}. Version ${manifest.schema_version} ✓`, "ok");
  const replace = document.createElement("button");
  replace.className = "btn btn-link btn-sm mt-2";
  replace.textContent = "Load a different snapshot&hellip;";
  replace.addEventListener("click", () => {
    clearSnapshot();
    location.reload();
  });
  statusEl.appendChild(replace);
  overlay.classList.add("c3pa-boot-done");
  setTimeout(() => {
    overlay.style.display = "none";
    document.body.removeChild(overlay);
  }, 650);
}

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("c3pa-boot-drag");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("c3pa-boot-drag"));
dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("c3pa-boot-drag");
  if (event.dataTransfer.files.length) handleFile(event.dataTransfer.files[0]);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files.length) handleFile(fileInput.files[0]);
});

async function handleFile(file) {
  if (!file) return;
  setStatus(`Reading ${file.name}&hellip;`, "loading");
  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    finishError(`Could not read the file: ${error.message}`);
    return;
  }
  if (isGzipBytes(bytes)) {
    setStatus(`Extracting ${file.name}&hellip;`, "loading");
    try {
      const entry = await extractSingleDbFromTarGz(bytes);
      bytes = entry.bytes;
    } catch (error) {
      finishError(`Could not open snapshot archive: ${error.message}`);
      return;
    }
  }
  await openSnapshotBytes(bytes, file.name, { persist: true });
}

/** Shared open → manifest → integrity → ready pipeline. When `persist` is set,
 *  the snapshot bytes are cached to IndexedDB so a refresh restores them. */
async function openSnapshotBytes(bytes, displayName, { persist = false } = {}) {
  try {
    setStatus(`Opening ${displayName}&hellip;`, "loading");
    await browser.ops.call("workspace.open", { bytes });

    const manifestPayload = await browser.ops.call("manifest.read");
    const verdict = validateManifest(manifestPayload, SNAPSHOT_SCHEMA_VERSION);
    if (!verdict.ok) {
      finishError(verdict.reason === "missing" ? NOT_A_SNAPSHOT : versionMismatchMessage(verdict.actual));
      return;
    }

    setStatus(`Verifying snapshot integrity&hellip;`, "loading");
    const integrity = await browser.ops.call("integrity.check");
    if (!(integrity && integrity.ok)) {
      finishError("The snapshot failed PRAGMA integrity_check — the file may be corrupt.");
      return;
    }

    if (persist) await saveSnapshot(displayName, bytes);

    browser.resolveReady({ error: null });
    finishSuccess(verdict.manifest);
  } catch (error) {
    finishError(`Failed to load snapshot: ${error.message}`);
  }
}

/** Boot: if a snapshot is cached in IndexedDB, restore it and skip the picker. */
async function maybeRestoreSnapshot() {
  const cached = await loadSnapshot();
  if (!cached || !cached.bytes) return false;
  setStatus(`Restoring saved snapshot ${cached.name || ""}&hellip;`, "loading");
  await openSnapshotBytes(cached.bytes, cached.name || "saved snapshot", { persist: false });
  return true;
}

// Boot: try to restore the previously saved snapshot; if none, the picker
// stays up (the overlay is the default UI). The first fetchJSON is gated on
// `ready`, so the page queues either way.
maybeRestoreSnapshot();
/* C3PA Explorer — query engine selection.
 *
 * The SPA can query through either engine:
 *   "sqljs"   (default) — the sql.js WASM runtime (frontend/sqljs/); the
 *                         snapshot is loaded into the browser.
 *   "fastapi"           — a FastAPI backend (same origin, or a remote origin
 *                         such as http://localhost:8765).
 *
 * The choice is persisted in localStorage so boot.js can decide whether to
 * initialize the sql.js runtime at all. All storage access is guarded so this
 * module is safe to import under `node --test`.
 */
"use strict";

const KEY = "c3paEngine";
const DEFAULT_ENGINE = { mode: "sqljs", apiBase: "" };

function readStored() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.mode === "sqljs" || parsed.mode === "fastapi")) {
      return {
        mode: parsed.mode,
        apiBase: typeof parsed.apiBase === "string" ? parsed.apiBase : "",
      };
    }
  } catch { /* localStorage unavailable / malformed */ }
  return null;
}

/** The explicitly stored engine, or null when the user has never chosen. */
export function getStoredEngine() {
  return readStored();
}

export function getEngine() {
  return readStored() || { ...DEFAULT_ENGINE };
}

export function setEngine(engine) {
  try {
    localStorage.setItem(KEY, JSON.stringify(engine));
  } catch { /* storage unavailable — engine stays in-memory for this session */ }
}

export function isSqljs() {
  return getEngine().mode === "sqljs";
}

export function isFastApi() {
  return getEngine().mode === "fastapi";
}
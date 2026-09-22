/* C3PA Explorer - API Client */
"use strict";

import { getEngine } from "./engine.js";

export async function fetchJSON(url, opts) {
  // sql.js engine: the boot script installs the WASM bridge on globalThis.
  if (globalThis.c3paBrowser) {
    return globalThis.c3paBrowser.fetchJSON(url, opts);
  }
  // FastAPI engine: real fetch, prefixed with the configured API base.
  const { apiBase } = getEngine();
  const res = await fetch((apiBase || "") + url, opts);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}
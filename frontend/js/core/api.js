/* C3PA Explorer - API Client */
"use strict";

export async function fetchJSON(url, opts) {
  if (globalThis.c3paBrowser) {
    return globalThis.c3paBrowser.fetchJSON(url, opts);
  }
  const res = await fetch(url, opts);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

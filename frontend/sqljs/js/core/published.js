/* C3PA Explorer browser edition — published snapshot auto-load.
 *
 * Now that the demo AND the snapshot live on the same origin (GitHub Pages),
 * the boot flow can offer "load the published snapshot" instead of making the
 * user download a tar.gz and re-upload it. This module is the pure counterpart
 * of that flow:
 *
 *   fetchCatalog()      GET builds.json (same origin — the published registry,
 *                       the trust anchor). Returns { builds: [...] } or null.
 *   pickLatest(builds)  newest entry (version-ordered).
 *   fetchArchiveBytes() GET the snapshot tar.gz (relative: snapshots/<file>).
 *   sha256Hex(bytes)    hex sha-256 of arbitrary bytes (crypto.subtle).
 *   verifyEnvelope()    sha256(archive bytes) === entry.envelope_hash
 *   verifyDb()          sha256(extracted .db bytes) === entry.db_sha256
 *
 * The DB-level hash is the true content signature; the envelope hash proves the
 * transferred archive matches the recorded one. Both are recorded together in
 * builds.json, so a match = "known good published build".
 *
 * Same-origin only (no CORS machinery): URLs resolve relative to the page.
 */
"use strict";

const CATALOG_URL = "builds.json";

/** Fetch the published registry. Returns the parsed object or null on failure. */
export async function fetchCatalog() {
  try {
    const res = await fetch(CATALOG_URL, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Return the newest build entry, or null when the list is empty/unparseable. */
export function pickLatest(catalog) {
  const builds = catalog && Array.isArray(catalog.builds) ? catalog.builds : null;
  if (!builds || !builds.length) return null;
  return [...builds].sort((a, b) => String(b.version || "").localeCompare(String(a.version || "")))[0];
}

/** Download the snapshot archive (relative path → same origin). Throws on error. */
export async function fetchArchiveBytes(entry, { prefix = "snapshots/" } = {}) {
  if (!entry || !entry.file) throw new Error("published build entry has no file");
  const res = await fetch(prefix + entry.file, { cache: "no-store" });
  if (!res.ok) throw new Error(`snapshot download failed (HTTP ${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Hex sha-256 of arbitrary bytes (WebCrypto — works in browser and Node). */
export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const out = [];
  for (const b of new Uint8Array(digest)) out.push(b.toString(16).padStart(2, "0"));
  return out.join("");
}

/** Verify the archive-level (envelope) hash against the recorded build. */
export async function verifyEnvelope(archiveBytes, entry) {
  if (!entry?.envelope_hash) return false;
  const got = await sha256Hex(archiveBytes);
  return got === entry.envelope_hash;
}

/** Verify the content-level (db) hash against the recorded build. */
export async function verifyDb(dbBytes, entry) {
  if (!entry?.db_sha256) return false;
  const got = await sha256Hex(dbBytes);
  return got === entry.db_sha256;
}
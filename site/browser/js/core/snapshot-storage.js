/* C3PA Explorer browser edition — snapshot persistence (IndexedDB).
 *
 * Phase 2 v1 ships file-picker → in-memory only (docs/browser-edition.md §11),
 * which discards the DB on every reload. This module adds the quick fix: the
 * picked snapshot bytes are cached in IndexedDB under the page's origin, so a
 * refresh (or browser restart) can restore the last snapshot and skip the
 * picker. A 153 MB snapshot fits IndexedDB's blob storage without fuss and it
 * works over plain http://localhost — no OPFS secure-context requirement.
 *
 * Deliberately graceful: if `indexedDB` is unavailable (non-Chromium, or
 * blocked), every function returns null / no-ops and the app falls back to the
 * existing picker-only behavior.
 */

"use strict";

const DB_NAME = "c3pa-explorer";
const STORE_NAME = "snapshots";
const KEY = "current";

function storageAvailable() {
  return typeof indexedDB !== "undefined" && typeof indexedDB.open === "function";
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

/** Persist `bytes` (ArrayBuffer/Uint8Array) under KEY with `name`. */
export async function saveSnapshot(name, bytes) {
  if (!storageAvailable() || !bytes) return null;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const put = store.put({ name, bytes, savedAt: Date.now() }, KEY);
    await new Promise((resolve, reject) => {
      put.onsuccess = resolve;
      put.onerror = () => reject(put.error);
    });
    tx.commit();
    return { name, savedAt: Date.now() };
  } catch {
    return null;
  }
}

/** Load the cached snapshot, or null when none / unavailable. */
export async function loadSnapshot() {
  if (!storageAvailable()) return null;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const get = store.get(KEY);
    await new Promise((resolve, reject) => {
      get.onsuccess = resolve;
      get.onerror = () => reject(get.error);
    });
    const value = get.result;
    if (!value || !value.bytes) return null;
    return { name: value.name, bytes: value.bytes, savedAt: value.savedAt };
  } catch {
    return null;
  }
}

/** Forget the cached snapshot (returns true when something was removed). */
export async function clearSnapshot() {
  if (!storageAvailable()) return false;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const del = store.delete(KEY);
    await new Promise((resolve, reject) => {
      del.onsuccess = resolve;
      del.onerror = () => reject(del.error);
    });
    tx.commit();
    return true;
  } catch {
    return false;
  }
}
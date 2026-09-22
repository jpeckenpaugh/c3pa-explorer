/* C3PA Explorer - DOM and String Utilities */
"use strict";

export const $ = (sel, root) => (root || document).querySelector(sel);
export const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

export const app = new Proxy({}, {
  get(target, prop) {
    if (typeof document === "undefined") return undefined;
    const el = document.querySelector("#app");
    if (!el) return undefined;
    const val = el[prop];
    return typeof val === "function" ? val.bind(el) : val;
  },
  set(target, prop, value) {
    if (typeof document === "undefined") return true;
    const el = document.querySelector("#app");
    if (el) el[prop] = value;
    return true;
  }
});

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function highlightMatch(text, query) {
  if (!text || !query) return esc(text || "");
  const escapedText = esc(text);
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return escapedText.replace(regex, '<mark class="bg-warning-subtle text-dark px-1 rounded">$1</mark>');
}

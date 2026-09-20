/* C3PA Explorer - Pagination & Layout Helpers */
"use strict";

import { $$ } from "../core/utils.js";

export function fadeOutRows(tbodyEl) {
  return new Promise((resolve) => {
    if (!tbodyEl) { resolve(); return; }
    const trs = Array.from(tbodyEl.children);
    if (!trs.length) { tbodyEl.innerHTML = ""; resolve(); return; }
    const limit = Math.min(trs.length, 30);
    trs.slice(0, limit).forEach((tr, i) => {
      tr.style.setProperty("--row-index", i % 30);
      tr.classList.add("row-fade-out");
    });
    setTimeout(() => {
      tbodyEl.innerHTML = "";
      resolve();
    }, 160);
  });
}

export function card(title, body, cls = "") {
  return `<div class="card mb-3 ${cls}">
    <div class="card-header py-2"><strong>${title}</strong></div>
    <div class="card-body py-2">${body}</div></div>`;
}

export function paginationBar(total, limit, offset, onNav) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const cur = Math.floor(offset / limit) + 1;
  const wrap = document.createElement("div");
  wrap.className = "d-flex justify-content-between align-items-center mt-2";
  wrap.innerHTML = `
    <span class="text-muted small">${total.toLocaleString()} rows &middot; page ${cur} of ${pages}</span>
    <div class="btn-group btn-group-sm">
      <button class="btn btn-outline-secondary" data-d="-1" ${cur <= 1 ? "disabled" : ""}>Prev</button>
      <button class="btn btn-outline-secondary" data-d="1" ${cur >= pages ? "disabled" : ""}>Next</button>
    </div>`;
  $$("button", wrap).forEach((b) => b.addEventListener("click", () => {
    const np = cur + parseInt(b.dataset.d, 10);
    onNav(Math.max(0, np - 1) * limit);
  }));
  return wrap;
}

export function emptyRow(colspan, msg = "No rows.") {
  return `<tr><td colspan="${colspan}" class="text-center text-muted py-4">${msg}</td></tr>`;
}

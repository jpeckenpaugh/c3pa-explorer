/* C3PA Explorer - Global Search Spotlight Modal Component */
"use strict";

import { $, $$, esc, highlightMatch } from "../core/utils.js";
import { fetchJSON } from "../core/api.js";
import { LABEL_COLORS } from "./badges.js";
import { openUnitModal } from "./unitModal.js";

let searchDebounceTimer = null;

export function openGlobalSearchModal() {
  const searchInput = $("#globalSearchInput");
  const modal = bootstrap.Modal.getOrCreateInstance($("#globalSearchModal"));
  modal.show();
  setTimeout(() => searchInput?.focus(), 200);
}

export async function handleGlobalSearch() {
  const searchInput = $("#globalSearchInput");
  const searchResults = $("#globalSearchResults");
  const q = searchInput?.value.trim() || "";
  if (!searchResults) return;

  if (q.length < 2) {
    searchResults.innerHTML = `
      <div class="text-center py-4 text-muted">
        <div class="fw-semibold mb-1">Spotlight Search</div>
        <div class="small">Type keywords above to search documents, annotators, legal provisions, and text units.</div>
      </div>`;
    return;
  }

  searchResults.innerHTML = '<div class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Searching...</div>';

  const data = await fetchJSON(`/api/search?q=${encodeURIComponent(q)}`);
  
  const hasDocs = data.documents && data.documents.length > 0;
  const hasProvs = data.provisions && data.provisions.length > 0;
  const hasAnns = data.annotators && data.annotators.length > 0;
  const hasUnits = data.units && data.units.length > 0;

  if (!hasDocs && !hasProvs && !hasAnns && !hasUnits) {
    searchResults.innerHTML = `
      <div class="text-center py-4 text-muted">
        <div class="fw-semibold mb-1">No results found</div>
        <div class="small">No matching documents, provisions, annotators, or text units for "${esc(q)}".</div>
      </div>`;
    return;
  }

  const sections = [];

  // Documents
  if (hasDocs) {
    const docItems = data.documents.map((d) => `
      <a href="#/library/${esc(d.doc_id)}" class="list-group-item list-group-item-action d-flex align-items-center justify-content-between search-result-item" data-bs-dismiss="modal">
        <div class="text-truncate me-2">
          <span class="fw-bold me-2 text-primary">${esc(d.doc_id)}</span>
          <span class="text-body">${highlightMatch(d.title || d.link || "-", q)}</span>
        </div>
        <span class="badge text-bg-light border text-muted small">Document</span>
      </a>`).join("");
    sections.push(`
      <div class="mb-3">
        <div class="small fw-bold text-muted text-uppercase mb-1 px-1" style="font-size:11px;letter-spacing:.05em">Documents</div>
        <div class="list-group list-group-flush border rounded">${docItems}</div>
      </div>`);
  }

  // Legal Provisions
  if (hasProvs) {
    const provItems = data.provisions.map((p) => {
      const color = LABEL_COLORS[p.label] || "#6c757d";
      return `
        <a href="#/samples?label=${encodeURIComponent(p.label)}" class="list-group-item list-group-item-action d-flex align-items-center justify-content-between search-result-item" data-bs-dismiss="modal">
          <div class="d-flex align-items-center gap-2 me-2">
            <span class="badge" style="background:${color}">${esc(p.label)}</span>
            <span class="small text-muted">${p.count.toLocaleString()} annotations</span>
          </div>
          <span class="badge text-bg-light border text-muted small">Provision</span>
        </a>`;
    }).join("");
    sections.push(`
      <div class="mb-3">
        <div class="small fw-bold text-muted text-uppercase mb-1 px-1" style="font-size:11px;letter-spacing:.05em">Legal Provisions</div>
        <div class="list-group list-group-flush border rounded">${provItems}</div>
      </div>`);
  }

  // Annotators
  if (hasAnns) {
    const annItems = data.annotators.map((a) => `
      <a href="#/annotators/${esc(a.ranumb)}" class="list-group-item list-group-item-action d-flex align-items-center justify-content-between search-result-item" data-bs-dismiss="modal">
        <div>
          <span class="fw-bold me-2 text-primary">${esc(a.ranumb)}</span>
          <span class="small text-muted">${a.count.toLocaleString()} annotations across ${a.docs} documents</span>
        </div>
        <span class="badge text-bg-light border text-muted small">Annotator</span>
      </a>`).join("");
    sections.push(`
      <div class="mb-3">
        <div class="small fw-bold text-muted text-uppercase mb-1 px-1" style="font-size:11px;letter-spacing:.05em">Annotators</div>
        <div class="list-group list-group-flush border rounded">${annItems}</div>
      </div>`);
  }

  // Text Units & Samples
  if (hasUnits) {
    const unitItems = data.units.map((u) => {
      const isSent = u.unit_kind === "sentence";
      const badgeCls = isSent ? "text-bg-success" : "text-bg-secondary";
      return `
        <div class="list-group-item list-group-item-action search-result-item search-unit-item" data-unit-json="${esc(JSON.stringify(u))}">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <span class="fw-semibold small text-primary">${esc(u.unit_id)} &middot; <a href="#/library/${esc(u.doc_id)}" class="text-muted text-decoration-none" data-bs-dismiss="modal">${esc(u.doc_id)}</a></span>
            <span class="badge ${badgeCls} small">${esc(u.unit_kind)}</span>
          </div>
          <div class="small text-body">${highlightMatch(u.text, q)}</div>
        </div>`;
    }).join("");
    sections.push(`
      <div class="mb-3">
        <div class="small fw-bold text-muted text-uppercase mb-1 px-1" style="font-size:11px;letter-spacing:.05em">Text Units & Samples</div>
        <div class="list-group list-group-flush border rounded">${unitItems}</div>
      </div>`);
  }

  searchResults.innerHTML = sections.join("");

  // Attach click handlers for all search result items
  $$(".search-result-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (el.classList.contains("search-unit-item")) {
        try {
          const unitData = JSON.parse(el.dataset.unitJson);
          const modal = bootstrap.Modal.getInstance($("#globalSearchModal"));
          modal?.hide();
          openUnitModal(unitData);
        } catch (err) {
          console.error(err);
        }
      } else {
        const href = el.getAttribute("href");
        if (href) {
          e.preventDefault();
          const modal = bootstrap.Modal.getInstance($("#globalSearchModal"));
          modal?.hide();
          location.hash = href;
        }
      }
    });
  });
}

export function initGlobalSearch() {
  const searchInput = $("#globalSearchInput");

  $("#navGlobalSearch")?.addEventListener("click", (e) => {
    e.preventDefault();
    openGlobalSearchModal();
  });

  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openGlobalSearchModal();
    } else if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      openGlobalSearchModal();
    }
  });

  searchInput?.addEventListener("input", () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(handleGlobalSearch, 500);
  });
}

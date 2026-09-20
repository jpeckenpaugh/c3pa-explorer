/* C3PA Explorer - Annotation Detail Modal Component */
"use strict";

import { $, esc } from "../core/utils.js";
import { fetchJSON } from "../core/api.js";
import { badge } from "./badges.js";

export async function openAnnotationModal(annotationId) {
  const modalEl = $("#annotationModal");
  const bodyEl = $("#annotationModalBody");
  if (!modalEl || !bodyEl) return;

  bodyEl.innerHTML = '<div class="text-center py-4"><span class="spinner-border spinner-border-sm me-1"></span> Loading annotation details&hellip;</div>';
  bootstrap.Modal.getOrCreateInstance(modalEl).show();

  const a = await fetchJSON(`/api/annotations/${annotationId}`);

  const statusBadge = a.status === "aligned"
    ? '<span class="badge text-bg-success">aligned</span>'
    : a.status === "unmatched"
      ? '<span class="badge text-bg-danger">unmatched</span>'
      : '<span class="badge text-bg-warning">ambiguous</span>';

  const headerMeta = `
    <div class="d-flex align-items-center justify-content-between mb-3 border-bottom pb-2">
      <div class="d-flex align-items-center gap-2">
        <span class="badge text-bg-dark" style="font-size:0.95em">${esc(a.ranumb)}</span>
        ${badge(a.label)}
        ${statusBadge}
      </div>
      <div class="small text-muted">
        Document: <a href="#/library/${esc(a.doc_id)}" class="fw-semibold">${esc(a.doc_id)}</a> &middot; CSV Row #${a.src_row}
      </div>
    </div>`;

  const spanQuote = `
    <div class="small text-muted fw-semibold mb-1">Verbatim Annotation Span</div>
    <blockquote class="border-start border-3 border-primary ps-3 py-2 mb-3 bg-light rounded-end" style="font-family:Georgia, serif; font-size:1.05rem;">
      ${esc(a.text)}
    </blockquote>`;

  const metadataTable = `
    <div class="card mb-3">
      <div class="card-header py-1 bg-light small fw-semibold">Annotation Metadata</div>
      <div class="card-body p-2 small">
        <div class="row g-2">
          <div class="col-6"><strong>Annotation ID:</strong> <code>${a.annotation_id}</code></div>
          <div class="col-6"><strong>Annotator ID:</strong> <span class="badge text-bg-dark">${esc(a.ranumb)}</span></div>
          <div class="col-6"><strong>Document:</strong> <a href="#/library/${esc(a.doc_id)}">${esc(a.doc_id)}</a></div>
          <div class="col-6"><strong>Source File:</strong> <code>${esc(a.source_csv)}</code></div>
          <div class="col-6"><strong>Status:</strong> ${esc(a.status)}</div>
          <div class="col-6"><strong>Source Row:</strong> #${a.src_row}</div>
        </div>
      </div>
    </div>`;

  const alignedUnits = a.aligned_units || [];
  const alignTip = {
    "annotation_in_sentence": "The annotation span is contained within this unit (direct evidence).",
    "sentence_in_annotation_paragraph": "This unit is contained within the annotation's paragraph span (inherited evidence).",
    "partial_overlap": "Matched by partial token overlap across a boundary.",
  };

  const unitsHtml = alignedUnits.length
    ? `<div class="small fw-semibold mb-2">Matched Text Units (${alignedUnits.length})</div>` +
      alignedUnits.map((u) => `
        <div class="border rounded p-2 mb-2 bg-white">
          <div class="d-flex align-items-center justify-content-between gap-2 mb-1">
            <div>
              <code>${esc(u.unit_id)}</code>
              <span class="badge ${u.unit_kind === 'sentence' ? 'text-bg-success' : 'text-bg-secondary'} ms-1">${esc(u.unit_kind)}</span>
            </div>
            <span class="badge text-bg-light text-dark border" title="${esc(alignTip[u.alignment_type] || '')}" style="cursor:help">${esc(u.alignment_type || '')}</span>
          </div>
          <div class="small text-muted" style="font-family:Georgia, serif">${esc(u.unit_text)}</div>
        </div>`).join("")
    : '<div class="text-muted small">No aligned text units for this annotation span.</div>';

  bodyEl.innerHTML = headerMeta + spanQuote + metadataTable + unitsHtml;
}

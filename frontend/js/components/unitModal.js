/* C3PA Explorer - Unit Detail Modal Component */
"use strict";

import { $, esc } from "../core/utils.js";
import { fetchJSON } from "../core/api.js";
import { badge, catBadge } from "./badges.js";

let unitNav = null;

export function setUnitNav(nav) {
  unitNav = nav;
}

export function initUnitNavControls() {
  $("#unitPrev")?.addEventListener("click", () => unitNav && unitNav.prev && unitNav.prev());
  $("#unitNext")?.addEventListener("click", () => unitNav && unitNav.next && unitNav.next());
}

export async function openUnitModal(u) {
  const modalEl = $("#unitModal");
  const bodyEl = $("#unitModalBody");
  const isAlreadyOpen = modalEl && modalEl.classList.contains("show");
  if (isAlreadyOpen) {
    bodyEl.classList.add("fade-out");
    await new Promise((r) => setTimeout(r, 140));
  }
  const res = await fetchJSON(`/api/alignment?unit_id=${encodeURIComponent(u.unit_id)}`);
  const isSent = u.unit_kind === "sentence";
  const typeBadge = isSent
    ? '<span class="badge text-bg-success">sentence</span>'
    : `<span class="badge text-bg-secondary">fragment &middot; ${esc(u.fragment_type || "fragment")}</span>`;
  const quote = `
    <div class="d-flex align-items-center justify-content-between mb-2">
      <div>${typeBadge}</div>
      <div class="small text-muted"><code>${esc(u.unit_id)}</code> &middot; position ${u.position}${u.block_kind ? ` &middot; ${esc(u.block_kind)} block` : ""}</div>
    </div>
    <blockquote class="border-start border-3 ps-3 mb-3" style="font-family:Georgia, serif">${esc(u.unit_text)}</blockquote>`;
  const alignTip = {
    "annotation_in_sentence": "The annotation span is contained within this unit (direct evidence).",
    "sentence_in_annotation_paragraph": "This unit is contained within the annotation's paragraph span (inherited evidence).",
    "partial_overlap": "Matched by partial token overlap across a boundary.",
  };
  const labels = (u.verbatim_labels || "").split(";").filter(Boolean);
  let info;
  if (isSent) {
    const labelsHtml = u.label_category === "single_label" && labels.length === 1
      ? badge(labels[0])
      : u.label_category === "multi_label"
        ? labels.map(badge).join(" ")
        : '<span class="text-muted">unlabeled (no annotation signal for this version &mdash; not label-inapplicable)</span>';
    const supBlock = (u.support && u.support.length)
      ? `<div class="mb-1">Support: ${u.support.map((p) =>
          `<span class="me-2"><span class="support-stars">${"★".repeat(p.stars)}${"☆".repeat(3 - p.stars)}</span>
           <span class="small text-muted">${p.k}/${p.pool} annotators &middot; ${esc(p.label)}</span></span>`).join("")}</div>`
      : "";
    info = `
      <div class="mb-2">${catBadge(u.label_category)} ${labelsHtml}</div>
      ${supBlock}
      <div class="small text-muted mb-3">
        ${res.rows.length} supporting annotation${res.rows.length === 1 ? "" : "s"} &middot;
        ${u.annotator_count} distinct annotator${u.annotator_count === 1 ? "" : "s"}
        ${u.annotator_count >= 2 ? '&middot; <span class="text-success fw-semibold">high-confidence (\u22652 annotators)</span>' : ""}
      </div>`;
  } else {
    info = `
      <div class="small text-muted mb-3">
        Fragments are not label-eligible by design &mdash; a label on a non-sentence is noise for the
        sentence/label-pairs goal. The annotation evidence below is <em>provenance</em> (which spans touched
        this text), not a label.
      </div>`;
  }
  const evidence = res.rows.length
    ? `<div class="small fw-semibold mb-1">Annotation evidence</div>` + res.rows.map((a) => `
      <div class="border rounded p-2 mb-1 bg-light">
        <div class="d-flex gap-2 align-items-center mb-1">
          <span class="badge text-bg-dark">${esc(a.ranumb)}</span>${badge(a.label)}
          <span class="badge text-bg-light text-dark border" title="${esc(alignTip[a.alignment_type] || "")}" style="cursor:help">${esc(a.alignment_type)}</span>
        </div>
        <div class="small">${esc(a.text)}</div>
      </div>`).join("")
    : '<div class="text-muted small">No annotation evidence for this unit.</div>';
  bodyEl.innerHTML = quote + info + evidence;
  bodyEl.classList.remove("fade-out");
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

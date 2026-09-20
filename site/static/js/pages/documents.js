/* C3PA Explorer - Documents List & Detail Views */
"use strict";

import { $, $$, app, esc } from "../core/utils.js";
import { fetchJSON } from "../core/api.js";
import { badge, labelColor } from "../components/badges.js";
import { fadeOutRows } from "../components/pagination.js";
import { openUnitModal, setUnitNav } from "../components/unitModal.js";

export async function pageDocuments() {
  const state = { sort: "", order: "desc", limit: 50, offset: 0, total: 0, loading: false };

  app.innerHTML = `
    <table class="table table-striped table-hover table-sm align-middle doc-table stagger-table">
      <thead id="docHead"><tr>
        <th data-sort="id" style="cursor:pointer" title="Click to sort">ID <span class="sort-arrow"></span></th>
        <th>Title</th>
        <th>Crawled URL</th>
        <th class="text-center" data-sort="sentences" style="cursor:pointer" title="Click to sort">Sentences <span class="sort-arrow"></span></th>
        <th class="text-center" data-sort="fragments" style="cursor:pointer" title="Click to sort">Fragments <span class="sort-arrow"></span></th>
        <th class="text-center" data-sort="annotations" style="cursor:pointer" title="Click to sort">Annotations <span class="sort-arrow"></span></th>
      </tr></thead>
      <tbody id="docRows"></tbody>
    </table>
    <div id="docSentinel" class="text-center py-3 text-muted small"></div>`;

  $$("#docHead [data-sort]").forEach((th) => new bootstrap.Tooltip(th, { title: "Click to sort" }));

  function updateSortHeaders() {
    $$("#docHead [data-sort]").forEach((th) => {
      const isSorted = state.sort === th.dataset.sort;
      th.querySelector(".sort-arrow").innerHTML = isSorted ? (state.order === "asc" ? "&#9650;" : "&#9660;") : "";
    });
  }

  const row = (d, i) => `
    <tr style="--row-index:${i}">
      <td><a href="#/library/${esc(d.doc_id)}" class="fw-semibold">${esc(d.doc_id)}</a></td>
      <td class="text-truncate" style="max-width:320px" title="${esc(d.title || "")}">${esc(d.title || "-")}</td>
      <td class="text-truncate" style="max-width:360px"><a class="small text-muted" href="${esc(d.link)}" target="_blank">${esc(d.link || "-")}</a></td>
      <td class="text-center">${d.sentence_count.toLocaleString()}</td>
      <td class="text-center">${d.fragment_count.toLocaleString()}</td>
      <td class="text-center">${d.annotation_count.toLocaleString()}</td>
    </tr>`;

  async function loadMore() {
    if (state.loading || (state.total && state.offset >= state.total)) return;
    state.loading = true;
    const sentinel = $("#docSentinel");
    sentinel.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> loading&hellip;';
    const params = new URLSearchParams({ limit: state.limit, offset: state.offset });
    if (state.sort) {
      params.set("sort", state.sort);
      params.set("order", state.order);
    }
    const data = await fetchJSON(`/api/documents?${params}`);
    state.total = data.total;
    $("#docRows").insertAdjacentHTML("beforeend", data.rows.map((d, i) => row(d, i % 50)).join(""));
    state.offset += data.rows.length;
    state.loading = false;
    if (state.offset >= state.total) {
      sentinel.textContent = `All ${state.total.toLocaleString()} documents`;
    } else {
      sentinel.innerHTML = `${state.offset.toLocaleString()} of ${state.total.toLocaleString()}`;
    }
  }

  const sentinel = $("#docSentinel");
  const io = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) loadMore();
  }, { rootMargin: "400px" });
  io.observe(sentinel);

  async function reset() {
    state.offset = 0;
    state.total = 0;
    await fadeOutRows($("#docRows"));
    $("#docSentinel").innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    loadMore();
  }

  $$("#docHead [data-sort]").forEach((th) => th.addEventListener("click", () => {
    const col = th.dataset.sort;
    if (state.sort === col) {
      state.order = state.order === "asc" ? "desc" : "asc";
    } else {
      state.sort = col;
      state.order = col === "id" ? "asc" : "desc";
    }
    updateSortHeaders();
    reset();
  }));

  loadMore();
}

export async function pageDocument([docId]) {
  app.innerHTML = '<div class="text-center py-5"><span class="spinner-border"></span></div>';
  const [data, orderRes] = await Promise.all([
    fetchJSON(`/api/documents/${encodeURIComponent(docId)}/rendered`),
    fetchJSON("/api/documents/order"),
  ]);
  const doc = data.document;
  const unitMap = {};
  data.blocks.forEach((b) => b.units.forEach((u) => (unitMap[u.unit_id] = u)));

  const idx = orderRes.order.indexOf(docId);
  const prevId = idx > 0 ? orderRes.order[idx - 1] : null;
  const nextId = (idx >= 0 && idx < orderRes.order.length - 1) ? orderRes.order[idx + 1] : null;
  const arrow = (target, dir) => {
    const glyph = dir === "prev" ? "&#8592;" : "&#8594;";
    const label = dir === "prev" ? "Previous document" : "Next document";
    return target
      ? `<a class="doc-arrow" href="#/library/${esc(target)}" title="${label}">${glyph}</a>`
      : `<span class="doc-arrow disabled" title="No ${dir === "prev" ? "previous" : "next"} document">${glyph}</span>`;
  };

  function tooltip(u) {
    const id = `<code class="small text-white-50">${esc(u.unit_id)}</code>`;
    if (u.unit_kind === "sentence") {
      const badgeTxt = '<span class="badge text-bg-success">sentence</span>';
      if (u.label_category === "single_label" && u.labels.length === 1)
        return `${id} ${badgeTxt} &mdash; ${badge(u.labels[0])}`;
      if (u.label_category === "multi_label")
        return `${id} ${badgeTxt} &mdash; multi-label: ${u.labels.map(badge).join(" ")}`;
      return `${id} ${badgeTxt} &mdash; unlabeled (no annotation signal)`;
    }
    return `${id} <span class="badge text-bg-secondary">fragment</span> &mdash; ${esc(u.fragment_type || "fragment")}`;
  }

  const blocksHtml = data.blocks.map((b, bIdx) => {
    const inner = b.units.map((u) =>
      `<span class="unit ${u.unit_kind}" data-unit-id="${esc(u.unit_id)}">${esc(u.unit_text)}</span> `).join("");
    if (b.kind === "heading") return `<h6 class="doc-block doc-heading" style="--block-index:${bIdx}">${inner}</h6>`;
    if (b.kind === "list") return `<p class="doc-block doc-list" style="--block-index:${bIdx}">${inner}</p>`;
    return `<p class="doc-block" style="--block-index:${bIdx}">${inner}</p>`;
  }).join("");

  app.innerHTML = `
    <div class="doc-browser">
      <div class="doc-browser-bar">
        <span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span>
        <a class="btn btn-sm btn-outline-dark doc-back" href="#/library" title="Back to Library">&#8592; Back</a>
        <div class="doc-nav-group">
          ${arrow(prevId, "prev")}
          <span class="doc-id-box">ID: <strong>${esc(doc.doc_id)}</strong></span>
          <span class="doc-browser-url">
            <span class="doc-title" title="${esc(doc.title || "")}">${esc(doc.title || "")}</span>
            ${doc.link ? `<span class="doc-url">${esc(doc.link)}</span>` : ""}
            <span class="doc-info" id="docInfoBtn" title="Document details" role="button">&#9432;</span>
          </span>
          ${arrow(nextId, "next")}
        </div>
        <button class="btn btn-sm btn-outline-secondary mode-btn" id="modeSent" title="Emphasize sentences, wash out fragments">Sentences</button>
        <button class="btn btn-sm btn-outline-secondary mode-btn" id="modeFrag" title="Emphasize fragments, wash out sentences">Fragments</button>
        <button class="btn btn-sm btn-outline-secondary" id="toggleAnn" title="Inspect this document's annotations">Annotations</button>
      </div>
      <div class="doc-browser-body">
        <div class="doc-page">${blocksHtml}</div>
        <div class="doc-inspector d-none" id="docInspector">
          <div class="doc-inspector-head">
            <strong class="small">Annotations Inspector</strong>
            <button class="btn-close btn-sm" id="closeInspector" aria-label="Close inspector"></button>
          </div>
          <div class="doc-inspector-filters">
            <select class="form-select form-select-sm" id="inspAnnot"><option value="">All annotators</option></select>
            <select class="form-select form-select-sm" id="inspLabel"><option value="">All labels</option></select>
          </div>
          <div class="doc-inspector-list" id="inspList"></div>
        </div>
      </div>
    </div>
    <div class="doc-provenance">
      <strong>Snapshot of the crawled page.</strong> Rendered from the original crawled HTML as it existed at
      crawl time &mdash; this is not the live site's current content.
    </div>`;

  function setMode(mode) {
    $(".doc-page").classList.toggle("mode-sentence", mode === "sentence");
    $(".doc-page").classList.toggle("mode-fragment", mode === "fragment");
    $("#modeSent").classList.toggle("active", mode === "sentence");
    $("#modeFrag").classList.toggle("active", mode === "fragment");
  }
  $("#modeSent").addEventListener("click", () =>
    setMode($(".doc-page").classList.contains("mode-sentence") ? null : "sentence"));
  $("#modeFrag").addEventListener("click", () =>
    setMode($(".doc-page").classList.contains("mode-fragment") ? null : "fragment"));

  let annData = null;
  let inspectorOpen = false;
  let annByUnit = {};
  let unitsByAnn = {};

  const pageEl = $(".doc-page");
  const inspectorList = $("#inspList");

  function buildMaps() {
    annByUnit = {};
    unitsByAnn = {};
    annData.annotations.forEach((a) => {
      unitsByAnn[a.annotation_id] = a.unit_ids;
      a.unit_ids.forEach((uid) => (annByUnit[uid] = annByUnit[uid] || []).push(a));
    });
  }
  function populateInspectorFilters() {
    const annotators = [...new Set(annData.annotations.map((a) => a.ranumb))].sort();
    const labels = [...new Set(annData.annotations.map((a) => a.label))].sort();
    $("#inspAnnot").innerHTML = '<option value="">All annotators</option>' +
      annotators.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join("");
    $("#inspLabel").innerHTML = '<option value="">All labels</option>' +
      labels.map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join("");
  }
  function renderInspector() {
    const ann = $("#inspAnnot").value;
    const lbl = $("#inspLabel").value;
    const rows = annData.annotations.filter((a) =>
      (!ann || a.ranumb === ann) && (!lbl || a.label === lbl));
    inspectorList.innerHTML = rows.map((a) => `
      <div class="insp-row" data-ann-id="${a.annotation_id}">
        <div class="insp-row-top">
          <span class="badge text-bg-dark">${esc(a.ranumb)}</span>${badge(a.label)}
          <span class="insp-status">${esc(a.status)}</span>
        </div>
        <div class="insp-text" title="${esc(a.text)}">${esc(a.text)}</div>
      </div>`).join("") || '<div class="text-muted small p-2">No annotations match.</div>';
  }
  function clearUnitTargets() {
    $$(".unit.ann-target", pageEl).forEach((el) => el.classList.remove("ann-target"));
  }
  async function openInspector() {
    if (!annData) {
      annData = await fetchJSON(`/api/documents/${encodeURIComponent(docId)}/annotations`);
      buildMaps();
      populateInspectorFilters();
    }
    inspectorOpen = true;
    const insp = $("#docInspector");
    insp.classList.remove("closing");
    insp.classList.remove("d-none");
    $("#toggleAnn").classList.add("active");
    renderInspector();
  }
  function closeInspector() {
    inspectorOpen = false;
    $("#toggleAnn").classList.remove("active");
    clearUnitTargets();
    const insp = $("#docInspector");
    if (!insp || insp.classList.contains("d-none")) return;
    insp.classList.add("closing");
    setTimeout(() => {
      insp.classList.add("d-none");
      insp.classList.remove("closing");
    }, 300);
  }
  $("#toggleAnn").addEventListener("click", () => (inspectorOpen ? closeInspector() : openInspector()));
  $("#closeInspector").addEventListener("click", closeInspector);
  $("#inspAnnot").addEventListener("change", renderInspector);
  $("#inspLabel").addEventListener("change", renderInspector);

  inspectorList.addEventListener("click", (e) => {
    const row = e.target.closest(".insp-row");
    if (!row) return;
    clearUnitTargets();
    (unitsByAnn[+row.dataset.annId] || []).forEach((uid) => {
      const el = $(`.unit[data-unit-id="${CSS.escape(uid)}"]`, pageEl);
      if (el) el.classList.add("ann-target");
    });
    const first = unitsByAnn[+row.dataset.annId] && $(`.unit[data-unit-id="${CSS.escape(unitsByAnn[+row.dataset.annId][0])}"]`, pageEl);
    if (first) first.scrollIntoView({ block: "center" });
  });

  inspectorList.addEventListener("mouseover", (e) => {
    const row = e.target.closest(".insp-row");
    if (!row) return;
    $$(".unit.ann-hover", pageEl).forEach((el) => el.classList.remove("ann-hover"));
    (unitsByAnn[+row.dataset.annId] || []).forEach((uid) => {
      const el = $(`.unit[data-unit-id="${CSS.escape(uid)}"]`, pageEl);
      if (el) el.classList.add("ann-hover");
    });
  });
  inspectorList.addEventListener("mouseleave", () => {
    $$(".unit.ann-hover", pageEl).forEach((el) => el.classList.remove("ann-hover"));
  });

  const tip = document.createElement("div");
  tip.id = "hoverTip";
  tip.className = "hover-tip";
  document.body.appendChild(tip);
  let activeUnit = null;
  let hoverActivateTimer = null;
  let hoverDeactivateTimer = null;

  function clearActive() {
    if (activeUnit) {
      const prev = activeUnit;
      activeUnit = null;
      prev.classList.remove("active");
    }
  }

  function hideTip() {
    tip.classList.remove("visible");
  }

  function showTip(u, unitEl) {
    tip.dataset.kind = u.unit_kind;
    const activeMode = $(".doc-page").classList.contains("mode-sentence") ? "sentence"
      : $(".doc-page").classList.contains("mode-fragment") ? "fragment" : null;
    if (activeMode && activeMode !== u.unit_kind) {
      hideTip();
      return;
    }
    tip.innerHTML = tooltip(u);
    tip.classList.add("visible");
    const r = unitEl.getBoundingClientRect();
    const tw = tip.offsetWidth || 280;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    let top = r.top - (tip.offsetHeight || 40) - 8;
    if (top < 8) top = r.bottom + 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  pageEl.addEventListener("mouseover", (e) => {
    const unit = e.target.closest(".unit[data-unit-id]");
    if (!unit) return;
    const u = unitMap[unit.dataset.unitId];
    if (!u) return;

    if (hoverDeactivateTimer) {
      clearTimeout(hoverDeactivateTimer);
      hoverDeactivateTimer = null;
    }

    if (unit !== activeUnit) {
      if (hoverActivateTimer) clearTimeout(hoverActivateTimer);
      hoverActivateTimer = setTimeout(() => {
        clearActive();
        unit.classList.add("active");
        activeUnit = unit;
        if (inspectorOpen) {
          $$(".insp-row.row-linked", inspectorList).forEach((r) => r.classList.remove("row-linked"));
          (annByUnit[u.unit_id] || []).forEach((a) => {
            const r = $(`.insp-row[data-ann-id="${a.annotation_id}"]`, inspectorList);
            if (r) r.classList.add("row-linked");
          });
        }
        showTip(u, unit);
      }, 50);
    } else {
      showTip(u, unit);
    }
  });

  pageEl.addEventListener("mouseleave", () => {
    if (hoverActivateTimer) { clearTimeout(hoverActivateTimer); hoverActivateTimer = null; }
    hideTip();
    hoverDeactivateTimer = setTimeout(() => {
      clearActive();
      $$(".insp-row.row-linked", inspectorList).forEach((r) => r.classList.remove("row-linked"));
    }, 120);
  });

  const allUnits = data.blocks.flatMap((b) => b.units);
  let unitIdx = 0;
  async function showUnitDetail(u, idx) {
    unitIdx = idx;
    await openUnitModal(u);
    navObj.setCounter(idx);
  }

  const navObj = {
    prev: () => { if (unitIdx > 0) showUnitDetail(allUnits[unitIdx - 1], unitIdx - 1); },
    next: () => { if (unitIdx < allUnits.length - 1) showUnitDetail(allUnits[unitIdx + 1], unitIdx + 1); },
    setCounter: (idx) => {
      $("#unitCounter").textContent = `${idx + 1} of ${allUnits.length}`;
      $("#unitPrev").disabled = idx === 0;
      $("#unitNext").disabled = idx === allUnits.length - 1;
    },
  };
  setUnitNav(navObj);

  async function openDocDetails() {
    const anns = (await fetchJSON(`/api/documents/${encodeURIComponent(docId)}/annotations`)).annotations;
    const aligned = anns.filter((a) => a.status === "aligned").length;
    const unmatched = anns.filter((a) => a.status === "unmatched").length;
    const ambiguous = anns.filter((a) => a.status === "ambiguous").length;
    const labelCount = new Set(anns.map((a) => a.label)).size;

    const units = data.blocks.flatMap((b) => b.units);
    const sentences = units.filter((u) => u.unit_kind === "sentence");
    const fragments = units.length - sentences.length;
    const single = sentences.filter((u) => u.label_category === "single_label").length;
    const multi = sentences.filter((u) => u.label_category === "multi_label").length;
    const unlabeled = sentences.length - single - multi;

    const labelCounts = {};
    sentences.forEach((s) => (s.labels || []).forEach((l) => (labelCounts[l] = (labelCounts[l] || 0) + 1)));
    const topLabels = Object.entries(labelCounts).sort((a, b) => b[1] - a[1]);
    const labelMax = Math.max(1, ...topLabels.map(([, n]) => n));
    const labelBars = topLabels.map(([l, n]) => `
      <div class="d-flex align-items-center my-1">
        <div class="small text-truncate" style="width:42%">${badge(l)}</div>
        <div class="flex-grow-1 mx-2"><div class="progress" style="height:12px">
          <div class="progress-bar" style="width:${(100 * n / labelMax).toFixed(0)}%;background:${labelColor(l)}"></div>
        </div></div>
        <div class="small text-muted" style="width:18%;text-align:right">${n.toLocaleString()}</div>
      </div>`).join("");

    const miniStat = (label, value, cls = "") => `
      <div class="col-6 col-md-3">
        <div class="border rounded p-2 text-center h-100 ${cls}">
          <div class="fw-bold">${typeof value === "number" ? value.toLocaleString() : value}</div>
          <div class="small text-muted">${label}</div>
        </div>
      </div>`;
    const subsetLabel = doc.subset === "DB" ? "Data Brokers" : doc.subset === "WS" ? "Websites" : doc.subset;
    const sourced = doc.subset === "DB"
      ? "California AG data-broker registry &mdash; March 2023"
      : "Van Nortwick &amp; Wilson (2022) &mdash; popular California websites";
    const published = "September 2024";

    $("#docModalTitle").innerHTML = `${esc(doc.doc_id)} <span class="badge text-bg-secondary">${esc(subsetLabel)}</span>`;
    $("#docModalBody").innerHTML = `
      <table class="table table-sm align-middle mb-2">
        <tbody>
          <tr><th style="width:170px">Title</th><td>${esc(doc.title || "-")}</td></tr>
          <tr><th>Crawled URL</th><td>${doc.link ? `<a href="${esc(doc.link)}" target="_blank">${esc(doc.link)}</a>` : "-"}</td></tr>
          <tr><th>Sourced</th><td>${sourced}</td></tr>
          <tr><th>Published</th><td>${published}</td></tr>
          <tr><th>Homepage?</th><td>${esc(doc.is_homepage || "-")}</td></tr>
          <tr><th>Textmatch &mdash; regulation (primary)</th><td>${esc(doc.textmatch_p || "-")}</td></tr>
          <tr><th>Textmatch &mdash; regulation (secondary)</th><td>${esc(doc.textmatch_s || "-")}</td></tr>
          <tr><th>Textmatch &mdash; generic (primary)</th><td>${esc(doc.textmatch_pp || "-")}</td></tr>
          <tr><th>URL keyword matches</th><td>${esc(doc.link_match || "-")}</td></tr>
          <tr><th>HTML source</th><td><code>${esc(doc.html_path)}</code></td></tr>
          <tr><th>Crawl source</th><td><code>${esc(doc.crawl_path || "-")}</code></td></tr>
        </tbody>
      </table>
      <div class="text-center" style="position:relative;z-index:10;margin-bottom:-10px">
        <div class="badge text-bg-dark d-block rounded-0" style="font-size:1em;padding:.5em 1em">Source Data</div>
      </div>
      <div class="row g-2 mb-3">
        ${miniStat("Sentences", sentences.length, "border-2 border-dark")}
        ${miniStat("Fragments", fragments, "border-2 border-dark")}
        ${miniStat("Annotations", anns.length, "border-2 border-dark")}
        ${miniStat("Labels", labelCount, "border-2 border-dark")}
      </div>
      <div class="text-center" style="position:relative;z-index:10;margin-bottom:-10px">
        <div class="badge text-bg-primary d-block rounded-0" style="font-size:1em;padding:.5em 1em">Derived Samples</div>
      </div>
      <div class="row g-2 mb-2">
        ${miniStat("Single-label", single, "border-2 border-primary")}
        ${miniStat("Multi-label", multi, "border-2 border-primary")}
        ${miniStat("Underdefined", 0, "border-2 border-primary")}
        ${miniStat("Orphaned", unlabeled, "border-2 border-primary")}
      </div>
      <div class="small fw-semibold mb-1">Label distribution within this document (sentences)</div>
      ${labelBars || '<div class="text-muted small">No labeled sentences in this document.</div>'}
    `;
    bootstrap.Modal.getOrCreateInstance($("#docModal")).show();
  }
  $("#docInfoBtn").addEventListener("click", openDocDetails);

  pageEl.addEventListener("click", (e) => {
    const unit = e.target.closest(".unit[data-unit-id]");
    if (!unit) return;
    const u = unitMap[unit.dataset.unitId];
    if (u) showUnitDetail(u, allUnits.indexOf(u));
  });
}

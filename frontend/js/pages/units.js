/* C3PA Explorer - Samples / Units View */
"use strict";

import { $, $$, app, esc } from "../core/utils.js";
import { fetchJSON } from "../core/api.js";
import { badge, catBadge, kindBadge } from "../components/badges.js";
import { fadeOutRows } from "../components/pagination.js";
import { openUnitModal, setUnitNav } from "../components/unitModal.js";
import { setExportParamsBuilder, setResetSampleConfig } from "../components/exportModal.js";

let openSampleConfigFn = null;
let openExportModalFn = null;
let pendingConfigure = false;
let pendingExport = false;

export function setOpenSampleConfig(fn) {
  openSampleConfigFn = fn;
}

export function handleNavConfigureClick() {
  if (location.hash.startsWith("#/samples")) {
    if (openSampleConfigFn) openSampleConfigFn();
  } else {
    pendingConfigure = true;
    location.hash = "#/samples";
  }
}

export function handleNavDownloadClick() {
  if (location.hash.startsWith("#/samples")) {
    if (openExportModalFn) openExportModalFn();
  } else {
    pendingExport = true;
    location.hash = "#/samples";
  }
}

export async function pageUnits(initialView) {
  const qs = new URLSearchParams(location.hash.split("?")[1] || "");
  const active = new Set();
  if (qs.get("view")) {
    qs.get("view").split(",").forEach((v) => active.add(v));
  } else if (initialView && initialView.length) {
    initialView.forEach((v) => active.add(v));
  } else {
    active.add("single");
  }
  const VALID = new Set(["single", "multi", "null", "fragments"]);
  [...active].forEach((v) => { if (!VALID.has(v)) active.delete(v); });
  if (active.size === 0) active.add("single");

  const state = { limit: 50, offset: 0, total: 0, loading: false };
  const rowData = {};
  const orderedUnits = [];
  let sampleIdx = 0;
  const filters = { subset: "", filterLabels: false, include: new Set(), evidenceThreshold: 1, minSupport: 1, supportMode: "at_least" };
  if (qs.get("label")) {
    filters.filterLabels = true;
    filters.include.add(qs.get("label"));
  }
  const LABEL_ORDER = [];

  app.innerHTML = `
    <div class="samples-subnav d-flex flex-wrap align-items-center gap-2">
      <span class="fw-semibold text-muted small me-1">Sample Types:</span>
      <div class="d-flex flex-wrap gap-1" id="samplesNav"></div>
      <span class="ms-auto text-muted small" id="sliceInfo"></span>
    </div>
    <table class="table table-striped table-hover table-sm align-middle samples-table stagger-table">
      <thead><tr><th>ID</th><th>Doc</th><th>Text</th><th>Kind</th><th>Labels</th><th>Category</th><th>Support</th></tr></thead>
      <tbody id="unitRows"></tbody>
    </table>
    <div id="unitSentinel" class="text-center py-3 text-muted small"></div>
    <div class="modal fade" id="samplesFilterModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-lg">
        <div class="modal-content">
          <div class="modal-header py-2">
            <h5 class="modal-title">Configure samples</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label small fw-semibold mb-1">Sample Type</label>
              <div class="d-flex flex-wrap gap-1" id="sfTypes"></div>
            </div>
            <div class="mb-3">
              <label class="form-label small fw-semibold mb-1">Parent Document Type</label>
              <div class="btn-group btn-group-sm w-100" role="group" aria-label="Parent document type">
                <input type="radio" class="btn-check" name="sfSubset" id="sfSubAll" value="" checked>
                <label class="btn btn-outline-secondary" for="sfSubAll">All</label>
                <input type="radio" class="btn-check" name="sfSubset" id="sfSubDB" value="DB">
                <label class="btn btn-outline-secondary" for="sfSubDB">Data Brokers</label>
                <input type="radio" class="btn-check" name="sfSubset" id="sfSubWS" value="WS">
                <label class="btn btn-outline-secondary" for="sfSubWS">Websites</label>
              </div>
            </div>
            <div class="mb-3">
              <label class="form-label small fw-semibold mb-1" for="sfThreshold">Evidence Threshold</label>
              <div class="d-flex align-items-center gap-3">
                <input type="range" class="form-range flex-grow-1" id="sfThreshold" min="1" max="5" step="1" value="1">
                <span class="badge text-bg-secondary fs-6" id="sfThresholdVal">1</span>
              </div>
              <div class="small text-muted mt-1">
                Signals per distinct annotator required to count as a &ldquo;yes&rdquo; vote for label attribution.
                Raising it prunes underdefined samples and tightens support (at 3, each of 3 annotators needs 3
                aligned annotations to reach unanimous).
              </div>
            </div>
            <div class="mb-3">
              <label class="form-label small fw-semibold mb-1">Support Configuration</label>
              <div class="btn-group btn-group-sm w-100 mb-1" role="group" aria-label="Support mode">
                <input type="radio" class="btn-check" name="sfSupportMode" id="sfSupAtLeast" value="at_least" checked>
                <label class="btn btn-outline-secondary" for="sfSupAtLeast">At Least</label>
                <input type="radio" class="btn-check" name="sfSupportMode" id="sfSupExact" value="exact">
                <label class="btn btn-outline-secondary" for="sfSupExact">Exact</label>
              </div>
              <div class="btn-group btn-group-sm w-100" role="group" aria-label="Support tier">
                <input type="radio" class="btn-check" name="sfSupport" id="sfSupMin" value="1" checked>
                <label class="btn btn-outline-secondary" for="sfSupMin">Minimal &star;</label>
                <input type="radio" class="btn-check" name="sfSupport" id="sfSupMaj" value="2">
                <label class="btn btn-outline-secondary" for="sfSupMaj">Majority &star;&star;</label>
                <input type="radio" class="btn-check" name="sfSupport" id="sfSupUna" value="3">
                <label class="btn btn-outline-secondary" for="sfSupUna">Unanimous &star;&star;&star;</label>
              </div>
              <div class="small text-muted mt-1" id="sfSupportNote">Any level of support; no support restriction applied.</div>
            </div>
            <div>
              <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" id="sfFilterLabels">
                <label class="form-check-label fw-semibold" for="sfFilterLabels">Filter Labels</label>
              </div>
              <div id="sfLabelBoxes" class="row g-2 filter-label-boxes">
                <div class="col-5">
                  <label class="form-label small mb-1" for="sfInclude">Included Labels</label>
                  <select id="sfInclude" multiple size="9" class="form-select form-select-sm"></select>
                  <div class="small text-muted mt-1">Click to select (shift/ctrl for many), double-click to move</div>
                </div>
                <div class="col-2 d-flex flex-column justify-content-center gap-1">
                  <button class="btn btn-sm btn-outline-primary" id="sfInc2Exc" title="Move selected to Excluded">&rsaquo;</button>
                  <button class="btn btn-sm btn-outline-secondary" id="sfExc2Inc" title="Move selected to Included">&lsaquo;</button>
                  <div class="border-top my-1"></div>
                  <button class="btn btn-outline-primary" id="sfInc2ExcAll" title="Move all to Excluded">&raquo;</button>
                  <button class="btn btn-outline-secondary" id="sfExc2IncAll" title="Move all to Included">&laquo;</button>
                </div>
                <div class="col-5">
                  <label class="form-label small mb-1" for="sfExclude">Excluded Labels</label>
                  <select id="sfExclude" multiple size="9" class="form-select form-select-sm"></select>
                  <div class="small text-muted mt-1">Click to select (shift/ctrl for many), double-click to move</div>
                </div>
              </div>
            </div>
          </div>
          <div class="modal-footer py-1">
            <span class="me-auto small text-muted" id="sfTotal"></span>
            <button class="btn btn-sm btn-outline-secondary" id="sfOptimized" title="Set optimized defaults: Single Label, All doc types, threshold 1, At Least/Minimal support, no label filters">Optimized Defaults</button>
            <button class="btn btn-sm btn-outline-secondary" id="sfReset">Reset</button>
            <button class="btn btn-sm btn-primary" id="sfApply">Apply filters</button>
          </div>
        </div>
      </div>
    </div>`;

  const CHIPS = [
    ["single", "Single Label"],
    ["multi", "Multi-Label"],
    ["null", "Null Label"],
    ["fragments", "Fragments"],
  ];

  async function resetList() {
    state.offset = 0; state.total = 0; state.loading = false;
    orderedUnits.length = 0;
    Object.keys(rowData).forEach((k) => delete rowData[k]);
    await fadeOutRows($("#unitRows"));
  }

  function renderNav() {
    $("#samplesNav").innerHTML = CHIPS.map(([v, label]) => {
      const on = active.has(v);
      const cls = on ? "btn-primary" : "btn-outline-primary";
      return `<button class="btn btn-sm ${cls}" data-view="${v}">${label}</button>`;
    }).join("");
    $$("#samplesNav button").forEach((b) => b.addEventListener("click", async () => {
      const v = b.dataset.view;
      if (active.has(v)) {
        if (active.size > 1) active.delete(v);
      } else {
        active.add(v);
      }
      if (active.size === 0) active.add("single");
      await resetList();
      renderNav();
      loadMore();
    }));
  }

  function currentParams() {
    const p = new URLSearchParams({ limit: state.limit, offset: state.offset });
    if (active.size) p.set("sample_view", [...active].join(","));
    if (filters.subset) p.set("subset", filters.subset);
    if (filters.filterLabels) {
      if (qs.get("label") && filters.include.has(qs.get("label"))) {
        p.set("labels", qs.get("label"));
      } else {
        const excluded = LABEL_ORDER.length
          ? LABEL_ORDER.filter((l) => !filters.include.has(l))
          : [];
        if (excluded.length) p.set("exclude_labels", excluded.join(","));
      }
    }
    if (filters.evidenceThreshold && filters.evidenceThreshold !== 1) {
      p.set("evidence_threshold", String(filters.evidenceThreshold));
    }
    if (filters.minSupport > 1 || filters.supportMode === "exact") {
      if (filters.supportMode === "exact") p.set("support_mode", "exact");
      p.set("min_support", String(filters.minSupport));
    }
    return p;
  }

  const sentinel = $("#unitSentinel");
  const row = (u, i) => `
    <tr data-unit-id="${esc(u.unit_id)}" style="cursor:pointer;--row-index:${i}">
      <td class="text-muted small text-nowrap">${esc(u.unit_id)}</td>
      <td class="text-muted small">${esc(u.doc_id)}</td>
      <td class="text-truncate" style="max-width:480px" title="${esc(u.unit_text)}">${esc(u.unit_text)}</td>
      <td>${kindBadge(u)}</td>
      <td>${u.verbatim_labels ? u.verbatim_labels.split(";").map(badge).join(" ") : '<span class="text-muted">-</span>'}</td>
      <td>${catBadge(u.label_category)}</td>
      <td>${supportCell(u)}</td>
    </tr>`;

  const supportCell = (u) => {
    if (!u.support || !u.support.length) return '<span class="text-muted">-</span>';
    const pairs = u.support.map((p) =>
      `${esc(p.label)}: ${"★".repeat(p.stars)}${"☆".repeat(3 - p.stars)} (${p.k}/${p.pool})`);
    const max = Math.max(...u.support.map((p) => p.stars));
    return `<span class="support-stars" title="${esc(pairs.join(" · "))}">${"★".repeat(max)}${"☆".repeat(3 - max)}</span>`;
  };

  async function loadMore() {
    if (state.loading || (state.total && state.offset >= state.total)) return;
    state.loading = true;
    sentinel.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> loading&hellip;';
    const data = await fetchJSON(`/api/units?${currentParams()}`);
    state.total = data.total;
    data.rows.forEach((u) => { rowData[u.unit_id] = u; orderedUnits.push(u); });
    $("#unitRows").insertAdjacentHTML("beforeend", data.rows.map((u, i) => row(u, i % 50)).join(""));
    state.offset += data.rows.length;
    state.loading = false;
    $("#sliceInfo").textContent = `${state.total.toLocaleString()} Candidate Samples`;
    if (state.offset >= state.total) sentinel.textContent = `All ${state.total.toLocaleString()} units`;
    else sentinel.innerHTML = `${state.offset.toLocaleString()} of ${state.total.toLocaleString()}`;
  }

  const io = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) loadMore();
  }, { rootMargin: "400px" });
  io.observe(sentinel);

  async function openSampleDetail(idx) {
    if (idx < 0 || idx >= orderedUnits.length) return;
    sampleIdx = idx;
    await openUnitModal(orderedUnits[idx]);
    sampleNav.setCounter(idx);
  }

  const sampleNav = {
    prev: () => openSampleDetail(sampleIdx - 1),
    next: async () => {
      if (sampleIdx + 1 >= orderedUnits.length) await loadMore();
      openSampleDetail(sampleIdx + 1);
    },
    setCounter: (idx) => {
      $("#unitCounter").textContent = `${idx + 1} of ${orderedUnits.length}`;
      $("#unitPrev").disabled = idx === 0;
      $("#unitNext").disabled = idx + 1 >= orderedUnits.length && (state.total === 0 || orderedUnits.length >= state.total);
    },
  };
  setUnitNav(sampleNav);

  $("#unitRows").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-unit-id]");
    if (!tr) return;
    const u = rowData[tr.dataset.unitId];
    if (u) openSampleDetail(orderedUnits.indexOf(u));
  });

  let draftActive = new Set();
  let draftSubset = "";
  let draftFilterLabels = false;
  let draftInclude = new Set();
  let draftThreshold = 1;
  let draftSupport = 1;
  let draftSupportMode = "at_least";
  let liveSeq = 0;

  const SUPPORT_COPY = {
    at_least: {
      1: "Any level of support; no support restriction applied.",
      2: "More than half of annotators for the given document must provide evidentiary support.",
      3: "100% of annotators must converge on supporting evidence to assign a label to a given sentence.",
    },
    exact: {
      1: "Only samples whose best support is exactly Minimal &mdash; a single annotator&rsquo;s evidence, below the majority bar.",
      2: "Only samples whose best support is exactly Majority &mdash; more than half of annotators, but not unanimous.",
      3: "Only samples whose best support is exactly Unanimous &mdash; 100% of annotators must converge.",
    },
  };

  function updateSupportNote() {
    $("#sfSupportNote").innerHTML = SUPPORT_COPY[draftSupportMode][draftSupport];
  }

  function renderModalTypes() {
    $("#sfTypes").innerHTML = CHIPS.map(([v, label]) => {
      const on = v === "" ? draftActive.size === 0 : draftActive.has(v);
      const cls = v === "" ? (on ? "btn-dark" : "btn-outline-dark") : (on ? "btn-primary" : "btn-outline-primary");
      return `<button type="button" class="btn btn-sm ${cls}" data-view="${v}">${label}</button>`;
    }).join("");
    $$("#sfTypes button").forEach((b) => b.addEventListener("click", () => {
      const v = b.dataset.view;
      if (v === "") draftActive.clear();
      else if (draftActive.has(v)) draftActive.delete(v);
      else draftActive.add(v);
      renderModalTypes();
      scheduleLiveCount();
    }));
  }

  function renderModalLabels() {
    $("#sfInclude").innerHTML = LABEL_ORDER
      .filter((l) => draftInclude.has(l))
      .map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join("");
    $("#sfExclude").innerHTML = LABEL_ORDER
      .filter((l) => !draftInclude.has(l))
      .map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join("");
  }

  async function scheduleLiveCount() {
    const seq = ++liveSeq;
    const p = new URLSearchParams();
    if (draftActive.size) p.set("sample_view", [...draftActive].join(","));
    if (draftSubset) p.set("subset", draftSubset);
    const excluded = LABEL_ORDER.length ? LABEL_ORDER.filter((l) => !draftInclude.has(l)) : [];
    if (draftFilterLabels && excluded.length) p.set("exclude_labels", excluded.join(","));
    if (draftThreshold !== 1) p.set("evidence_threshold", String(draftThreshold));
    if (draftSupport > 1 || draftSupportMode === "exact") {
      if (draftSupportMode === "exact") p.set("support_mode", "exact");
      p.set("min_support", String(draftSupport));
    }
    const data = await fetchJSON(`/api/units?limit=1&${p}`);
    if (seq !== liveSeq) return;
    $("#sfTotal").textContent = `${data.total.toLocaleString()} Candidate Samples`;
  }

  async function openFilterModal() {
    if (!LABEL_ORDER.length) {
      const labels = await fetchJSON("/api/labels");
      LABEL_ORDER.push(...labels.map((l) => l.label));
    }
    draftActive = new Set(active);
    draftSubset = filters.subset;
    draftFilterLabels = filters.filterLabels;
    draftInclude = new Set(filters.include.size ? filters.include : LABEL_ORDER);
    draftThreshold = filters.evidenceThreshold;
    draftSupport = filters.minSupport;
    draftSupportMode = filters.supportMode;
    $("#sfFilterLabels").checked = draftFilterLabels;
    $("#sfLabelBoxes").classList.toggle("open", draftFilterLabels);
    const radio = document.querySelector(`input[name="sfSubset"][value="${draftSubset}"]`)
      || document.querySelector('input[name="sfSubset"][value=""]');
    if (radio) radio.checked = true;
    const modeRadio = document.querySelector(`input[name="sfSupportMode"][value="${draftSupportMode}"]`);
    if (modeRadio) modeRadio.checked = true;
    const supRadio = document.querySelector(`input[name="sfSupport"][value="${draftSupport}"]`);
    if (supRadio) supRadio.checked = true;
    updateSupportNote();
    $("#sfThreshold").value = draftThreshold;
    $("#sfThresholdVal").textContent = draftThreshold;
    renderModalTypes();
    renderModalLabels();
    bootstrap.Modal.getOrCreateInstance($("#samplesFilterModal")).show();
    scheduleLiveCount();
  }

  function commitFilters() {
    active.clear();
    draftActive.forEach((v) => active.add(v));
    filters.subset = draftSubset;
    filters.filterLabels = draftFilterLabels;
    filters.include = new Set(draftInclude);
    filters.evidenceThreshold = draftThreshold;
    filters.minSupport = draftSupport;
    filters.supportMode = draftSupportMode;
  }

  function reloadSlice() {
    resetList();
    renderNav();
    loadMore();
  }

  setOpenSampleConfig(openFilterModal);
  if (pendingConfigure) {
    pendingConfigure = false;
    openFilterModal();
  }
  $("#sfThreshold").addEventListener("input", () => {
    draftThreshold = Number($("#sfThreshold").value);
    $("#sfThresholdVal").textContent = draftThreshold;
    scheduleLiveCount();
  });
  document.querySelectorAll('input[name="sfSupport"]').forEach((r) => {
    r.addEventListener("change", () => {
      if (!r.checked) return;
      draftSupport = Number(r.value);
      updateSupportNote();
      scheduleLiveCount();
    });
  });
  document.querySelectorAll('input[name="sfSupportMode"]').forEach((r) => {
    r.addEventListener("change", () => {
      if (!r.checked) return;
      draftSupportMode = r.value;
      updateSupportNote();
      scheduleLiveCount();
    });
  });
  $("#sfFilterLabels").addEventListener("change", () => {
    draftFilterLabels = $("#sfFilterLabels").checked;
    $("#sfLabelBoxes").classList.toggle("open", draftFilterLabels);
    scheduleLiveCount();
  });
  document.querySelectorAll('input[name="sfSubset"]').forEach((r) => {
    r.addEventListener("change", () => { if (r.checked) { draftSubset = r.value; scheduleLiveCount(); } });
  });
  $("#sfInc2Exc").addEventListener("click", () => {
    [...$("#sfInclude").selectedOptions].forEach((o) => draftInclude.delete(o.value));
    renderModalLabels();
    scheduleLiveCount();
  });
  $("#sfExc2Inc").addEventListener("click", () => {
    [...$("#sfExclude").selectedOptions].forEach((o) => draftInclude.add(o.value));
    renderModalLabels();
    scheduleLiveCount();
  });
  $("#sfInc2ExcAll").addEventListener("click", () => {
    draftInclude.clear();
    renderModalLabels();
    scheduleLiveCount();
  });
  $("#sfExc2IncAll").addEventListener("click", () => {
    draftInclude = new Set(LABEL_ORDER);
    renderModalLabels();
    scheduleLiveCount();
  });
  $("#sfInclude").addEventListener("dblclick", (e) => {
    const o = e.target.closest("option");
    if (!o) return;
    draftInclude.delete(o.value);
    renderModalLabels();
    scheduleLiveCount();
  });
  $("#sfExclude").addEventListener("dblclick", (e) => {
    const o = e.target.closest("option");
    if (!o) return;
    draftInclude.add(o.value);
    renderModalLabels();
    scheduleLiveCount();
  });
  $("#sfApply").addEventListener("click", () => {
    commitFilters();
    bootstrap.Modal.getOrCreateInstance($("#samplesFilterModal")).hide();
    reloadSlice();
  });
  $("#sfOptimized").addEventListener("click", () => {
    draftActive.clear();
    draftActive.add("single");
    draftSubset = "";
    draftFilterLabels = false;
    draftInclude = new Set(LABEL_ORDER);
    draftThreshold = 1;
    draftSupport = 1;
    draftSupportMode = "at_least";
    $("#sfFilterLabels").checked = false;
    $("#sfLabelBoxes").classList.toggle("open", false);
    const subAll = document.querySelector('input[name="sfSubset"][value=""]');
    if (subAll) subAll.checked = true;
    const supModeAtLeast = document.querySelector('input[name="sfSupportMode"][value="at_least"]');
    if (supModeAtLeast) supModeAtLeast.checked = true;
    const supVal1 = document.querySelector('input[name="sfSupport"][value="1"]');
    if (supVal1) supVal1.checked = true;
    updateSupportNote();
    $("#sfThreshold").value = 1;
    $("#sfThresholdVal").textContent = 1;
    renderModalTypes();
    renderModalLabels();
    scheduleLiveCount();
  });
  $("#sfReset").addEventListener("click", () => {
    draftActive.clear();
    draftSubset = "";
    draftFilterLabels = false;
    draftInclude = new Set(LABEL_ORDER);
    draftThreshold = 1;
    draftSupport = 1;
    draftSupportMode = "at_least";
    $("#sfFilterLabels").checked = false;
    $("#sfLabelBoxes").classList.toggle("open", false);
    const subAll = document.querySelector('input[name="sfSubset"][value=""]');
    if (subAll) subAll.checked = true;
    const supModeAtLeast = document.querySelector('input[name="sfSupportMode"][value="at_least"]');
    if (supModeAtLeast) supModeAtLeast.checked = true;
    const supVal1 = document.querySelector('input[name="sfSupport"][value="1"]');
    if (supVal1) supVal1.checked = true;
    updateSupportNote();
    $("#sfThreshold").value = 1;
    $("#sfThresholdVal").textContent = 1;
    renderModalTypes();
    renderModalLabels();
    scheduleLiveCount();
  });

  renderNav();

  setExportParamsBuilder(() => currentParams());

  setResetSampleConfig(() => {
    active.clear();
    active.add("single");
    filters.subset = "";
    filters.filterLabels = false;
    filters.include = new Set(LABEL_ORDER);
    filters.evidenceThreshold = 1;
    filters.minSupport = 1;
    filters.supportMode = "at_least";
    reloadSlice();
  });

  openExportModalFn = () => {
    bootstrap.Modal.getOrCreateInstance($("#exportModal")).show();
  };

  if (pendingExport) {
    pendingExport = false;
    setTimeout(() => {
      if (openExportModalFn) openExportModalFn();
    }, 100);
  }

  loadMore();
}

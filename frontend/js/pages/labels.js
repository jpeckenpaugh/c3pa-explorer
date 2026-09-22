/* C3PA Explorer - Labels & Annotators Page Views */
"use strict";

import { $, $$, app, esc } from "../core/utils.js";
import { fetchJSON } from "../core/api.js";
import { badge, labelColor, labelDescription } from "../components/badges.js";
import { fadeOutRows } from "../components/pagination.js";
import { openAnnotationModal } from "../components/annotationModal.js";

export async function pageLabels() {
  app.innerHTML = '<div class="text-center py-5"><span class="spinner-border"></span></div>';
  const s = await fetchJSON("/api/stats");

  const sentenceHits = s.single_label_sentences + s.multi_label_sentences;

  // Extract distributions for the 4 states
  const annByLabel = {};
  s.annotation_label_distribution.forEach((x) => (annByLabel[x.label] = x.count));
  const sentByLabel = {};
  s.label_distribution.forEach((x) => (sentByLabel[x.label] = x.count));

  const alignedByLabel = Object.assign({}, s.aligned_by_label || {});
  const unmatchedByLabel = Object.assign({}, s.unmatched_by_label || {});
  const ambiguousByLabel = Object.assign({}, s.ambiguous_by_label || {});
  const hitsByLabel = Object.assign({}, s.hits_by_label || {});

  const labels = [...new Set([
    ...Object.keys(annByLabel), ...Object.keys(sentByLabel),
    ...Object.keys(alignedByLabel), ...Object.keys(unmatchedByLabel), ...Object.keys(ambiguousByLabel),
    ...Object.keys(hitsByLabel)
  ])].sort((a, b) => a.localeCompare(b));

  const annRows = s.annotators.map((a) => `
    <tr>
      <td><a href="#/annotators/${esc(a.ranumb)}" class="fw-semibold">${esc(a.ranumb)}</a></td>
      <td class="text-center">
        <input class="form-check-input annotator-include-chk" type="checkbox" data-ranumb="${esc(a.ranumb)}" checked>
      </td>
      <td>${a.n.toLocaleString()}</td>
      <td>${a.docs.toLocaleString()}</td>
      <td>${a.labels}</td>
    </tr>`).join("");

  const bar = (count, max, color) => `
    <div class="progress" style="height:14px">
      <div class="progress-bar" style="width:${max > 0 ? (100 * count / max).toFixed(1) : 0}%;background:${color}"></div>
    </div>`;

  const STATES = {
    raw: {
      id: "raw",
      name: "Raw (Page Load)",
      leftBadge: "Annotations",
      leftBadgeCls: "text-bg-dark",
      middleBadge: "Labels",
      middleBadgeCls: "text-bg-dark",
      rightBadge: "Documents",
      rightBadgeCls: "text-bg-dark",
      leftHeader: "Total",
      middleHeader: "Legal Provisions",
      rightHeader: "Total Sentences",
      leftData: annByLabel,
      leftTotal: s.annotations,
      rightData: sentByLabel,
      rightTotal: s.sentences
    },
    overlap: {
      id: "overlap",
      name: "Overlap",
      leftBadge: "Annotations",
      leftBadgeCls: "text-bg-success",
      middleBadge: "Labels",
      middleBadgeCls: "text-bg-dark",
      rightBadge: "Documents",
      rightBadgeCls: "text-bg-success",
      leftHeader: "Aligned",
      middleHeader: "Legal Provisions",
      rightHeader: "Matched Sentences",
      leftData: alignedByLabel,
      leftTotal: s.aligned,
      rightData: hitsByLabel,
      rightTotal: sentenceHits
    },
    exclusion: {
      id: "exclusion",
      name: "Exclusion",
      leftBadge: "Annotations",
      leftBadgeCls: "text-bg-warning text-dark",
      middleBadge: "Labels",
      middleBadgeCls: "text-bg-dark",
      rightBadge: "Documents",
      rightBadgeCls: "text-bg-warning text-dark",
      leftHeader: "Unmatched",
      middleHeader: "Legal Provisions",
      rightHeader: "Unmatched Sentences",
      leftData: unmatchedByLabel,
      leftTotal: s.unmatched,
      rightData: null,
      rightTotal: s.unlabeled_sentences
    },
    inconclusive: {
      id: "inconclusive",
      name: "Inconclusive",
      leftBadge: "Annotations",
      leftBadgeCls: "text-bg-danger",
      middleBadge: "Labels",
      middleBadgeCls: "text-bg-dark",
      rightBadge: "Documents",
      rightBadgeCls: "text-bg-danger",
      leftHeader: "Ambiguous",
      middleHeader: "Legal Provisions",
      rightHeader: "Fragments",
      leftData: ambiguousByLabel,
      leftTotal: s.ambiguous,
      rightData: null,
      rightTotal: s.fragments
    }
  };

  let pctMode = false;
  let sortKey = "label";
  let sortDir = 1;
  let lockedState = "raw";
  let activeState = "raw";

  const getActiveState = () => STATES[activeState] || STATES.raw;

  const fmt = (v, total) => (pctMode ? `${total > 0 ? (100 * v / total).toFixed(1) : 0}%` : v.toLocaleString());
  const cmp = (a, b) => {
    const st = getActiveState();
    const valA_left = (st.leftData && st.leftData[a]) || 0;
    const valB_left = (st.leftData && st.leftData[b]) || 0;
    const valA_right = (st.rightData && st.rightData[a]) || 0;
    const valB_right = (st.rightData && st.rightData[b]) || 0;
    return sortKey === "label" ? a.localeCompare(b)
      : sortKey === "ann" ? valA_left - valB_left
      : valA_right - valB_right;
  };
  const sortedLabels = () => [...labels].sort((a, b) => cmp(a, b) * sortDir);

  const distRows = () => {
    const st = getActiveState();
    const leftMax = Math.max(1, ...Object.values(st.leftData || {}));
    const rightMax = st.rightData ? Math.max(1, ...Object.values(st.rightData)) : 0;

    return sortedLabels().map((l, i) => {
      const leftVal = (st.leftData && st.leftData[l]) || 0;
      const hasRight = st.rightData !== null && st.rightData !== undefined;
      const rightVal = hasRight ? (st.rightData[l] || 0) : null;

      const diceRoll = Math.floor(Math.random() * 10) + 1;
      const dicePct = diceRoll * 10;
      const greyColor = `hsl(0, 0%, ${Math.round(90 - (diceRoll - 1) * 9)}%)`;

      const rightBarHtml = hasRight
        ? bar(rightVal, rightMax, labelColor(l))
        : `<div class="progress" style="height:14px" title="Lottery Roll: ${diceRoll}/10 (Unlabeled units carry no label)">
            <div class="progress-bar progress-bar-striped progress-bar-animated" style="width:${dicePct}%;background:${greyColor}"></div>
           </div>`;

      const rightValHtml = hasRight
        ? fmt(rightVal, st.rightTotal)
        : `<span class="text-muted fw-bold" title="Random Lottery Roll: ${diceRoll}/10">???</span>`;

      return `
        <tr style="--row-index:${i}">
          <td style="min-width:120px">${bar(leftVal, leftMax, labelColor(l))}</td>
          <td class="text-nowrap pct-toggle" data-ann="${leftVal}">${fmt(leftVal, st.leftTotal)}</td>
          <td class="text-nowrap text-center" data-label="${l}">${badge(l)}</td>
          <td style="min-width:120px">${rightBarHtml}</td>
          <td class="text-nowrap ${hasRight ? 'pct-toggle' : ''}">${rightValHtml}</td>
        </tr>`;
    }).join("");
  };

  app.innerHTML = `
    <div class="labels-page">
      <div class="card mb-3">
        <div class="card-body py-2 d-flex flex-wrap align-items-center justify-content-between gap-3">
          <div class="d-flex flex-wrap align-items-center gap-2 small">
            <span class="stat-pill" id="statPillSpans" data-state="raw" title="Total Annotation Spans (Raw / State 1)">${s.annotations.toLocaleString()} Spans</span>
            <span class="stat-pill border-end pe-2" id="statPillAligned" data-state="overlap" title="Aligned Spans (Overlap / State 2)">${s.aligned.toLocaleString()} Aligned</span>
            <span class="stat-pill border-end pe-2" id="statPillUnmatched" data-state="exclusion" title="Unmatched Spans (Exclusion / State 3)">${s.unmatched.toLocaleString()} Unmatched</span>
            <span class="stat-pill" id="statPillAmbiguous" data-state="inconclusive" title="Ambiguous Spans (Inconclusive / State 4)">${s.ambiguous.toLocaleString()} Ambiguous</span>
          </div>

          <div class="text-center">
            <button class="btn btn-sm btn-outline-primary fw-semibold px-3" id="btnAnnotators" title="View Annotators breakdown">
              Annotators
            </button>
          </div>

          <div class="d-flex flex-wrap align-items-center gap-2 small">
            <span class="stat-pill" data-state="inconclusive" title="Total Non-Sentence Fragments (Inconclusive / State 4)">${s.fragments.toLocaleString()} Fragments</span>
            <span class="stat-pill border-start ps-2" data-state="exclusion" title="Misses (Exclusion / State 3)">${s.unlabeled_sentences.toLocaleString()} Misses</span>
            <span class="stat-pill border-start ps-2" data-state="overlap" title="Hits (Overlap / State 2)">${sentenceHits.toLocaleString()} Hits</span>
            <span class="stat-pill border-start ps-2" data-state="raw" title="Total Sentences (Raw / State 1)">${s.sentences.toLocaleString()} Sentences</span>
          </div>
        </div>
      </div>
      <div class="card mb-3" id="labelDistCard">
        <div class="card-body py-2">
          <table class="table table-sm table-striped align-middle mb-0 stagger-table" id="distTable">
            <colgroup>
              <col style="width:22%">
              <col style="width:8%">
              <col style="width:40%">
              <col style="width:22%">
              <col style="width:8%">
            </colgroup>
            <thead id="distHead">
              <tr>
                <th colspan="2" class="text-center p-1"><span class="badge text-bg-dark d-block" id="leftBadgeHeader" style="font-size:1.1em">Annotations</span></th>
                <th class="text-center p-1"><span class="badge text-bg-dark d-block" id="middleBadgeHeader" style="font-size:1.1em">Labels</span></th>
                <th colspan="2" class="text-center p-1"><span class="badge text-bg-dark d-block" id="rightBadgeHeader" style="font-size:1.1em">Documents</span></th>
              </tr>
              <tr class="dist-cols">
                <th colspan="2" class="text-center" data-sort="ann" style="cursor:pointer" title="Click to sort"><span id="leftHeaderTitle">Total</span> <span class="sort-arrow"></span></th>
                <th class="text-center" data-sort="label" style="cursor:pointer" title="Click to sort"><span id="middleHeaderTitle">Legal Provisions</span> <span class="sort-arrow"></span></th>
                <th colspan="2" class="text-center" data-sort="sent" style="cursor:pointer" title="Click to sort"><span id="rightHeaderTitle">Total Sentences</span> <span class="sort-arrow"></span></th>
              </tr>
            </thead>
            <tbody id="distBody"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Annotators Modal -->
    <div class="modal fade" id="annotatorsModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-lg modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header py-2">
            <h5 class="modal-title">Filter by Annotator</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body p-0">
            <table class="table table-sm table-striped table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Annotator</th>
                  <th class="text-center">Included <button type="button" class="btn btn-sm text-danger p-0 border-0 ms-1 fw-bold" id="btnClearAnnotators" title="Uncheck all annotators" style="font-size:1.05rem; line-height:1;">&#10006;</button></th>
                  <th>Total Spans</th>
                  <th>Covered Docs</th>
                  <th>Covered Labels</th>
                </tr>
              </thead>
              <tbody>${annRows}</tbody>
            </table>
          </div>
          <div class="modal-footer py-2">
            <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-sm btn-primary" id="btnApplyAnnotatorFilter">Apply</button>
          </div>
        </div>
      </div>
    </div>`;

  $$("#distHead [data-sort]").forEach((th) => new bootstrap.Tooltip(th, { title: "Click to sort" }));

  function attachLabelTips() {
    $$("#distBody tr td[data-label]").forEach((td) => {
      new bootstrap.Tooltip(td.querySelector(".badge"), { title: labelDescription(td.dataset.label), placement: "right" });
    });
  }

  function renderDist() {
    $("#distBody").innerHTML = distRows();
    $$("#distHead [data-sort]").forEach((th) => {
      th.querySelector(".sort-arrow").innerHTML =
        sortKey === th.dataset.sort ? (sortDir === 1 ? "&#9650;" : "&#9660;") : "";
    });
    attachLabelTips();
  }

  let renderedState = null;

  function updateStateUI() {
    const st = getActiveState();
    const leftBadge = $("#leftBadgeHeader");
    const middleBadge = $("#middleBadgeHeader");
    const rightBadge = $("#rightBadgeHeader");
    const leftHeader = $("#leftHeaderTitle");
    const middleHeader = $("#middleHeaderTitle");
    const rightHeader = $("#rightHeaderTitle");

    if (leftBadge) {
      leftBadge.className = `badge ${st.leftBadgeCls} d-block`;
      leftBadge.textContent = st.leftBadge;
    }
    if (middleBadge) {
      middleBadge.className = `badge ${st.middleBadgeCls || "text-bg-dark"} d-block`;
      middleBadge.textContent = st.middleBadge || "Labels";
    }
    if (rightBadge) {
      rightBadge.className = `badge ${st.rightBadgeCls} d-block`;
      rightBadge.textContent = st.rightBadge;
    }
    if (leftHeader) leftHeader.textContent = st.leftHeader;
    if (middleHeader) middleHeader.textContent = st.middleHeader || "Legal Provisions";
    if (rightHeader) rightHeader.textContent = st.rightHeader;

    $$(".stat-pill").forEach((pill) => {
      const pState = pill.dataset.state;
      pill.classList.toggle("locked", pState === lockedState);
      pill.classList.toggle("active", pState === activeState && pState !== lockedState);
    });

    if (renderedState !== activeState) {
      renderedState = activeState;
      renderDist();
    }
  }

  $$("#distHead [data-sort]").forEach((th) => th.addEventListener("click", () => {
    if (sortKey === th.dataset.sort) sortDir = -sortDir;
    else { sortKey = th.dataset.sort; sortDir = 1; }
    renderDist();
  }));

  $("#distTable").addEventListener("click", (e) => {
    if (e.target.closest(".pct-toggle")) {
      pctMode = !pctMode;
      renderDist();
    }
  });

  $$(".stat-pill").forEach((pill) => {
    const pState = pill.dataset.state;
    let buttonTimer = null;

    pill.addEventListener("mouseenter", () => {
      if (buttonTimer) clearTimeout(buttonTimer);
      buttonTimer = setTimeout(() => {
        buttonTimer = null;
        lockedState = pState;
        activeState = pState;
        updateStateUI();
      }, 2000);
    });

    pill.addEventListener("mouseleave", () => {
      if (buttonTimer) {
        clearTimeout(buttonTimer);
        buttonTimer = null;
      }
      if (activeState !== lockedState) {
        activeState = lockedState;
        updateStateUI();
      }
    });

    pill.addEventListener("click", () => {
      if (buttonTimer) {
        clearTimeout(buttonTimer);
        buttonTimer = null;
      }
      lockedState = pState;
      activeState = pState;
      updateStateUI();
    });
  });

  let appliedRanumbs = new Set(s.annotators.map((a) => a.ranumb));

  $("#btnClearAnnotators")?.addEventListener("click", () => {
    $$('#annotatorsModal .annotator-include-chk').forEach((chk) => {
      chk.checked = false;
    });
  });

  $("#btnAnnotators")?.addEventListener("click", () => {
    $$('#annotatorsModal .annotator-include-chk').forEach((chk) => {
      chk.checked = appliedRanumbs.has(chk.dataset.ranumb);
    });

    const modal = bootstrap.Modal.getOrCreateInstance($("#annotatorsModal"));
    modal.show();

    $$('#annotatorsModal a[href^="#/annotators/"]').forEach((a) => {
      a.addEventListener("click", () => modal.hide());
    });
  });

  $("#btnApplyAnnotatorFilter")?.addEventListener("click", async () => {
    const checked = $$('#annotatorsModal .annotator-include-chk:checked').map((c) => c.dataset.ranumb);
    appliedRanumbs = new Set(checked);

    const allCount = s.annotators.length;
    const query = (checked.length < allCount) ? `?ranumbs=${encodeURIComponent(checked.join(','))}` : '';
    const newStats = await fetchJSON('/api/stats' + query);

    s.annotations = newStats.annotations;
    s.aligned = newStats.aligned;
    s.unmatched = newStats.unmatched;
    s.ambiguous = newStats.ambiguous;

    const pillSpans = $("#statPillSpans");
    if (pillSpans) pillSpans.textContent = `${s.annotations.toLocaleString()} Spans`;
    const pillAligned = $("#statPillAligned");
    if (pillAligned) pillAligned.textContent = `${s.aligned.toLocaleString()} Aligned`;
    const pillUnmatched = $("#statPillUnmatched");
    if (pillUnmatched) pillUnmatched.textContent = `${s.unmatched.toLocaleString()} Unmatched`;
    const pillAmbiguous = $("#statPillAmbiguous");
    if (pillAmbiguous) pillAmbiguous.textContent = `${s.ambiguous.toLocaleString()} Ambiguous`;

    for (const key in annByLabel) delete annByLabel[key];
    (newStats.annotation_label_distribution || []).forEach((x) => (annByLabel[x.label] = x.count));

    for (const key in alignedByLabel) delete alignedByLabel[key];
    Object.assign(alignedByLabel, newStats.aligned_by_label || {});

    for (const key in unmatchedByLabel) delete unmatchedByLabel[key];
    Object.assign(unmatchedByLabel, newStats.unmatched_by_label || {});

    for (const key in ambiguousByLabel) delete ambiguousByLabel[key];
    Object.assign(ambiguousByLabel, newStats.ambiguous_by_label || {});

    STATES.raw.leftTotal = s.annotations;
    STATES.overlap.leftTotal = s.aligned;
    STATES.exclusion.leftTotal = s.unmatched;
    STATES.inconclusive.leftTotal = s.ambiguous;

    renderedState = null;
    updateStateUI();

    const modal = bootstrap.Modal.getInstance($("#annotatorsModal"));
    if (modal) modal.hide();
  });

  updateStateUI();
}

export async function pageAnnotatorDetail([ranumb]) {
  const state = { limit: 100, offset: 0, total: 0, loading: false, status: "", filterLabels: false, include: new Set() };
  const AF_LABEL_ORDER = [];
  let draftStatus = "";
  let draftFilterLabels = false;
  let draftInclude = new Set();
  let liveSeq = 0;

  app.innerHTML = `
    <div class="samples-subnav d-flex flex-wrap align-items-center gap-2">
      <a href="#/classification" class="btn btn-sm btn-outline-secondary text-nowrap" title="Back to Classification">&#8592;</a>
      <div class="d-flex align-items-center gap-1">
        <span class="fw-semibold text-nowrap" style="font-size:0.95rem;">Annotator:</span>
        <select class="form-select form-select-sm fw-bold border-secondary-subtle px-2 py-1" id="annSelect" style="width: auto; font-size:0.95rem;">
          <option value="all" ${ranumb === 'all' ? 'selected' : ''}>(all)</option>
          ${['ra1','ra2','ra3','ra4','ra5','ra6'].map(r => `<option value="${r}" ${r === ranumb ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
      </div>
      <span class="ms-auto text-muted small" id="annCount"></span>
      <button class="btn btn-outline-secondary btn-sm" id="annGear" title="Filter annotations">&#9881; Filter</button>
    </div>
    <table class="table table-striped table-hover table-sm align-middle samples-table stagger-table">
      <thead><tr><th>#</th><th>Doc</th>${ranumb === 'all' ? '<th>Annotator</th>' : ''}<th>Span</th><th>Label</th><th>Status</th></tr></thead>
      <tbody id="annRows"></tbody>
    </table>
    <div id="annSentinel" class="text-center py-3 text-muted small"></div>
    <div class="modal fade" id="annFilterModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-lg">
        <div class="modal-content">
          <div class="modal-header py-2">
            <h5 class="modal-title">Filter annotations</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label small fw-semibold mb-1" for="afStatus">Status</label>
              <select class="form-select form-select-sm" id="afStatus">
                <option value="">All statuses</option>
                <option value="aligned">Aligned</option>
                <option value="unmatched">Unmatched</option>
                <option value="ambiguous">Ambiguous</option>
              </select>
            </div>
            <div>
              <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" id="afFilterLabels">
                <label class="form-check-label fw-semibold" for="afFilterLabels">Filter Labels</label>
              </div>
              <div id="afLabelBoxes" class="row g-2 filter-label-boxes">
                <div class="col-5">
                  <label class="form-label small mb-1" for="afInclude">Included Labels</label>
                  <select id="afInclude" multiple size="7" class="form-select form-select-sm"></select>
                  <div class="small text-muted mt-1">Click to select, double-click to move</div>
                </div>
                <div class="col-2 d-flex flex-column justify-content-center gap-1">
                  <button class="btn btn-sm btn-outline-primary" id="afInc2Exc" title="Move selected to Excluded">&rsaquo;</button>
                  <button class="btn btn-sm btn-outline-secondary" id="afExc2Inc" title="Move selected to Included">&lsaquo;</button>
                  <div class="border-top my-1"></div>
                  <button class="btn btn-outline-primary" id="afInc2ExcAll" title="Move all to Excluded">&raquo;</button>
                  <button class="btn btn-outline-secondary" id="afExc2IncAll" title="Move all to Included">&laquo;</button>
                </div>
                <div class="col-5">
                  <label class="form-label small mb-1" for="afExclude">Excluded Labels</label>
                  <select id="afExclude" multiple size="7" class="form-select form-select-sm"></select>
                  <div class="small text-muted mt-1">Click to select, double-click to move</div>
                </div>
              </div>
            </div>
          </div>
          <div class="modal-footer py-1">
            <span class="me-auto small text-muted" id="afTotal"></span>
            <button class="btn btn-sm btn-outline-secondary" id="afReset">Reset</button>
            <button class="btn btn-sm btn-primary" id="afApply">Apply filters</button>
          </div>
        </div>
      </div>
    </div>`;

  $("#annSelect")?.addEventListener("change", (e) => {
    location.hash = `#/annotators/${e.target.value}`;
  });

  $("#annRows")?.addEventListener("click", (e) => {
    const spanTd = e.target.closest(".annotation-span-click");
    if (spanTd) {
      const annId = spanTd.dataset.id;
      if (annId) openAnnotationModal(annId);
    }
  });

  const sentinel = $("#annSentinel");
  const row = (a, i) => `
    <tr style="--row-index:${i}">
      <td class="text-muted small text-nowrap">${esc(a.src_row)}</td>
      <td class="text-nowrap"><a href="#/library/${esc(a.doc_id)}">${esc(a.doc_id)}</a></td>
      ${ranumb === 'all' ? `<td><span class="badge text-bg-dark">${esc(a.ranumb)}</span></td>` : ''}
      <td class="text-truncate annotation-span-click text-primary" style="max-width:520px; cursor:pointer" data-id="${a.annotation_id}" title="Click to view Annotation Details">${esc(a.text)}</td>
      <td>${badge(a.label)}</td>
      <td><span class="badge ${a.status === "aligned" ? "text-bg-success" : a.status === "unmatched" ? "text-bg-danger" : "text-bg-warning"}">${esc(a.status)}</span></td>
    </tr>`;

  async function loadMore() {
    if (state.loading || (state.total && state.offset >= state.total)) return;
    state.loading = true;
    sentinel.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> loading&hellip;';
    const params = new URLSearchParams({ limit: state.limit, offset: state.offset });
    if (ranumb && ranumb !== "all") params.set("ranumb", ranumb);
    if (state.status) params.set("status", state.status);
    if (state.filterLabels) {
      const excluded = AF_LABEL_ORDER.length ? AF_LABEL_ORDER.filter((l) => !state.include.has(l)) : [];
      if (excluded.length) params.set("exclude_labels", excluded.join(","));
    }
    const data = await fetchJSON(`/api/annotations?${params}`);
    state.total = data.total;
    $("#annRows").insertAdjacentHTML("beforeend", data.rows.map((a, i) => row(a, i % 50)).join(""));
    state.offset += data.rows.length;
    state.loading = false;
    $("#annCount").textContent = `${state.total.toLocaleString()} annotation spans`;
    if (state.offset >= state.total) sentinel.textContent = `All ${state.total.toLocaleString()} spans`;
    else sentinel.innerHTML = `${state.offset.toLocaleString()} of ${state.total.toLocaleString()}`;
  }

  const io = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) loadMore();
  }, { rootMargin: "400px" });
  io.observe(sentinel);

  function renderModalLabels() {
    $("#afInclude").innerHTML = AF_LABEL_ORDER
      .filter((l) => draftInclude.has(l))
      .map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join("");
    $("#afExclude").innerHTML = AF_LABEL_ORDER
      .filter((l) => !draftInclude.has(l))
      .map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join("");
  }

  async function scheduleCount() {
    const seq = ++liveSeq;
    const params = new URLSearchParams({ limit: 1 });
    if (ranumb && ranumb !== "all") params.set("ranumb", ranumb);
    if (draftStatus) params.set("status", draftStatus);
    if (draftFilterLabels) {
      const excluded = AF_LABEL_ORDER.length ? AF_LABEL_ORDER.filter((l) => !draftInclude.has(l)) : [];
      if (excluded.length) params.set("exclude_labels", excluded.join(","));
    }
    const data = await fetchJSON(`/api/annotations?${params}`);
    if (seq !== liveSeq) return;
    $("#afTotal").textContent = `${data.total.toLocaleString()} spans`;
  }

  async function openFilterModal() {
    if (!AF_LABEL_ORDER.length) {
      const labels = await fetchJSON("/api/labels");
      AF_LABEL_ORDER.push(...labels.map((l) => l.label));
    }
    draftStatus = state.status;
    draftFilterLabels = state.filterLabels;
    draftInclude = new Set(state.include.size ? state.include : AF_LABEL_ORDER);
    $("#afStatus").value = draftStatus;
    $("#afFilterLabels").checked = draftFilterLabels;
    $("#afLabelBoxes").classList.toggle("open", draftFilterLabels);
    renderModalLabels();
    bootstrap.Modal.getOrCreateInstance($("#annFilterModal")).show();
    scheduleCount();
  }

  async function commitFilters() {
    state.status = draftStatus;
    state.filterLabels = draftFilterLabels;
    state.include = new Set(draftInclude);
    state.offset = 0; state.total = 0; state.loading = false;
    await fadeOutRows($("#annRows"));
  }

  $("#annGear").addEventListener("click", openFilterModal);
  $("#afStatus").addEventListener("change", () => { draftStatus = $("#afStatus").value; scheduleCount(); });
  $("#afFilterLabels").addEventListener("change", () => {
    draftFilterLabels = $("#afFilterLabels").checked;
    $("#afLabelBoxes").classList.toggle("open", draftFilterLabels);
    scheduleCount();
  });
  $("#afInc2Exc").addEventListener("click", () => {
    [...$("#afInclude").selectedOptions].forEach((o) => draftInclude.delete(o.value));
    renderModalLabels();
    scheduleCount();
  });
  $("#afExc2Inc").addEventListener("click", () => {
    [...$("#afExclude").selectedOptions].forEach((o) => draftInclude.add(o.value));
    renderModalLabels();
    scheduleCount();
  });
  $("#afInc2ExcAll").addEventListener("click", () => {
    draftInclude.clear();
    renderModalLabels();
    scheduleCount();
  });
  $("#afExc2IncAll").addEventListener("click", () => {
    draftInclude = new Set(AF_LABEL_ORDER);
    renderModalLabels();
    scheduleCount();
  });
  $("#afInclude").addEventListener("dblclick", (e) => {
    const o = e.target.closest("option");
    if (!o) return;
    draftInclude.delete(o.value);
    renderModalLabels();
    scheduleCount();
  });
  $("#afExclude").addEventListener("dblclick", (e) => {
    const o = e.target.closest("option");
    if (!o) return;
    draftInclude.add(o.value);
    renderModalLabels();
    scheduleCount();
  });
  $("#afApply").addEventListener("click", () => {
    commitFilters();
    bootstrap.Modal.getOrCreateInstance($("#annFilterModal")).hide();
    loadMore();
  });
  $("#afReset").addEventListener("click", () => {
    draftStatus = "";
    draftFilterLabels = false;
    draftInclude = new Set(AF_LABEL_ORDER);
    $("#afStatus").value = "";
    $("#afFilterLabels").checked = false;
    $("#afLabelBoxes").classList.toggle("open", false);
    renderModalLabels();
    scheduleCount();
  });

  loadMore();
}

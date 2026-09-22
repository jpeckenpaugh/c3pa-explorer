/* C3PA Explorer - Export Dataset Modal Component */
"use strict";

import { $ } from "../core/utils.js";
import { fetchJSON } from "../core/api.js";

let exportParamsBuilder = () => new URLSearchParams();
let resetSampleConfig = null;

export function setExportParamsBuilder(fn) {
  exportParamsBuilder = fn;
}

export function setResetSampleConfig(fn) {
  resetSampleConfig = fn;
}

export function validatePartitions(train, evalVal, test) {
  const t = Number(train) || 0;
  const e = Number(evalVal) || 0;
  const te = Number(test) || 0;
  const sum = t + e + te;
  if (sum !== 100) {
    return { valid: false, sum, message: `Partition percentages must sum to 100 (currently ${t} + ${e} + ${te} = ${sum}).` };
  }
  return { valid: true, sum, message: "" };
}

export const ALL_EXPORT_FIELDS = [
  "id", "doc_id", "group", "text", "label", "label_name",
  "subset", "position", "unit_kind", "fragment_type",
  "label_category", "verbatim_labels", "annotator_count",
  "annotators", "source_annotation_count", "alignment_types",
  "support_stars", "support_evidence", "split"
];

export const DEFAULT_INCLUDED_FIELDS = [
  "id", "doc_id", "text", "label", "label_name", "split"
];


let includedFields = [...DEFAULT_INCLUDED_FIELDS];
let excludedFields = ALL_EXPORT_FIELDS.filter((f) => !DEFAULT_INCLUDED_FIELDS.includes(f));

export function moveFieldItem(fromArray, toArray, value) {
  const idx = fromArray.indexOf(value);
  if (idx !== -1) {
    fromArray.splice(idx, 1);
    if (!toArray.includes(value)) toArray.push(value);
  }
}

export function moveAllFieldItems(fromArray, toArray) {
  while (fromArray.length > 0) {
    const val = fromArray.shift();
    if (!toArray.includes(val)) toArray.push(val);
  }
}

export function wireExportModal() {
  let isValidated = false;
  let reEnableTimer = null;

  /** Download the export: bridge Blob in browser mode, /api/export anchor in
   *  server mode. Mirrors the original anchor-download UX either way. */
  async function triggerExportDownload(p) {
    try {
      const url = String(p);
      let anchorHref;
      let anchorName;
      if (globalThis.c3paBrowser && globalThis.c3paBrowser.exportDownload) {
        const res = await globalThis.c3paBrowser.exportDownload(`/api/export?${url}`);
        if (!res || !res.bytes) throw new Error("export returned no file");
        const blob = new Blob([res.bytes], { type: "application/zip" });
        anchorHref = URL.createObjectURL(blob);
        anchorName = res.file || "c3pa_export.zip";
      } else {
        anchorHref = `/api/export?${url}`;
      }
      const a = document.createElement("a");
      a.href = anchorHref;
      if (anchorName) a.download = anchorName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (anchorHref && anchorHref.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(anchorHref), 1000);
      bootstrap.Modal.getOrCreateInstance($("#exportModal")).hide();
    } catch (err) {
      const fb = $("#exportValidationFeedback");
      if (fb) {
        fb.style.display = "block";
        fb.className = "my-2 p-2 rounded small bg-danger-subtle text-danger border border-danger-subtle";
        fb.textContent = `❌ Download Error: ${err.message}`;
      }
    }
  }

  function setButtonState(state) {
    const btn = $("#exportValidate");
    if (!btn) return;
    if (state === "validate") {
      btn.textContent = "Validate";
      btn.className = "btn btn-outline-success";
      btn.disabled = false;
    } else if (state === "validating") {
      btn.textContent = "Validating...";
      btn.className = "btn btn-outline-success";
      btn.disabled = true;
    } else if (state === "download") {
      btn.textContent = "Download";
      btn.className = "btn btn-primary";
      btn.disabled = false;
    }
  }

  function invalidateValidation() {
    isValidated = false;
    if (reEnableTimer) {
      clearTimeout(reEnableTimer);
      reEnableTimer = null;
    }
    setButtonState("validate");
    const fb = $("#exportValidationFeedback");
    if (fb) {
      fb.style.display = "none";
      fb.className = "my-2 p-2 rounded small";
      fb.innerHTML = "";
    }
    if ($("#exportError")) $("#exportError").classList.add("d-none");
  }

  function getSplitMode() {
    const radio = document.querySelector('input[name="exportSplitRadio"]:checked');
    return radio ? radio.value : "2";
  }

  function isSplitEnabled() {
    return getSplitMode() !== "off";
  }

  function isTwoWay() {
    return getSplitMode() === "2";
  }

  document.querySelectorAll('input[name="exportSplitRadio"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      setPartitionLayout();
      $("#exportError")?.classList.add("d-none");
      invalidateValidation();
    });
  });

  $("#exportMaxDocCapToggle")?.addEventListener("change", (e) => {
    const container = $("#exportMaxDocCapContainer");
    if (container) container.style.display = e.target.checked ? "block" : "none";
    invalidateValidation();
  });

  $("#exportMaxDocCapNum")?.addEventListener("input", invalidateValidation);

  document.querySelectorAll('input[name="exportFormatRadio"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      if ($("#exportFormat")) $("#exportFormat").value = e.target.value;
      invalidateValidation();
    });
  });

  function renderFieldSelects() {
    const incSelect = $("#exportIncludedFields");
    const excSelect = $("#exportExcludedFields");
    if (!incSelect || !excSelect) return;

    incSelect.innerHTML = includedFields.map((f) => `<option value="${f}">${f}</option>`).join("");
    excSelect.innerHTML = excludedFields.map((f) => `<option value="${f}">${f}</option>`).join("");
  }

  function moveSelectedFromSelect(fromArray, toArray, selectEl) {
    if (!selectEl) return;
    const selectedVals = Array.from(selectEl.selectedOptions).map((opt) => opt.value);
    if (!selectedVals.length) return;
    for (const val of selectedVals) {
      moveFieldItem(fromArray, toArray, val);
    }
    renderFieldSelects();
    invalidateValidation();
  }

  function moveAllFromSelect(fromArray, toArray) {
    moveAllFieldItems(fromArray, toArray);
    renderFieldSelects();
    invalidateValidation();
  }

  $("#exportCustomFieldsToggle")?.addEventListener("change", (e) => {
    const container = $("#exportCustomFieldsContainer");
    if (container) {
      container.style.display = e.target.checked ? "block" : "none";
    }
    invalidateValidation();
  });

  $("#fieldExclude")?.addEventListener("click", () => moveSelectedFromSelect(includedFields, excludedFields, $("#exportIncludedFields")));
  $("#fieldExcludeAll")?.addEventListener("click", () => moveAllFromSelect(includedFields, excludedFields));
  $("#fieldInclude")?.addEventListener("click", () => moveSelectedFromSelect(excludedFields, includedFields, $("#exportExcludedFields")));
  $("#fieldIncludeAll")?.addEventListener("click", () => moveAllFromSelect(excludedFields, includedFields));

  $("#exportIncludedFields")?.addEventListener("dblclick", () => moveSelectedFromSelect(includedFields, excludedFields, $("#exportIncludedFields")));
  $("#exportExcludedFields")?.addEventListener("dblclick", () => moveSelectedFromSelect(excludedFields, includedFields, $("#exportExcludedFields")));

  renderFieldSelects();

  function adjustSplitNumbers(changedId, valStr) {
    let newVal = Math.max(0, Math.min(100, Math.round(Number(valStr) || 0)));
    const trainEl = $("#exportTrainNum");
    const evalEl = $("#exportEvalNum");
    const testEl = $("#exportTestNum");

    let t = Number(trainEl?.value) || 0;
    let e = Number(evalEl?.value) || 0;
    let s = Number(testEl?.value) || 0;

    if (isTwoWay()) {
      e = 0;
      if (evalEl) evalEl.value = 0;
      if (changedId === "exportTrainNum") {
        t = newVal;
        s = 100 - t;
      } else if (changedId === "exportTestNum") {
        s = newVal;
        t = 100 - s;
      }
    } else {
      if (changedId === "exportTrainNum") {
        const diff = newVal - t;
        t = newVal;
        let delta = -diff;
        let shareE = Math.trunc(delta / 2);
        let shareS = delta - shareE;
        e += shareE;
        s += shareS;
      } else if (changedId === "exportEvalNum") {
        const diff = newVal - e;
        e = newVal;
        let delta = -diff;
        let shareT = Math.trunc(delta / 2);
        let shareS = delta - shareT;
        t += shareT;
        s += shareS;
      } else if (changedId === "exportTestNum") {
        const diff = newVal - s;
        s = newVal;
        let delta = -diff;
        let shareT = Math.trunc(delta / 2);
        let shareE = delta - shareT;
        t += shareT;
        e += shareE;
      }

      t = Math.max(0, Math.min(100, t));
      e = Math.max(0, Math.min(100, e));
      s = Math.max(0, Math.min(100, s));
      const currentSum = t + e + s;
      if (currentSum !== 100) {
        if (changedId !== "exportTrainNum") {
          t = Math.max(0, 100 - e - s);
        } else if (changedId !== "exportTestNum") {
          s = Math.max(0, 100 - t - e);
        } else {
          e = Math.max(0, 100 - t - s);
        }
      }
    }

    if (trainEl) trainEl.value = t;
    if (evalEl) evalEl.value = e;
    if (testEl) testEl.value = s;

    invalidateValidation();
  }

  $("#exportTrainNum")?.addEventListener("input", (e) => adjustSplitNumbers("exportTrainNum", e.target.value));
  $("#exportEvalNum")?.addEventListener("input", (e) => adjustSplitNumbers("exportEvalNum", e.target.value));
  $("#exportTestNum")?.addEventListener("input", (e) => adjustSplitNumbers("exportTestNum", e.target.value));

  $("#exportSeed")?.addEventListener("input", invalidateValidation);
  $("#exportStratify")?.addEventListener("change", invalidateValidation);
  $("#exportExcludeOther")?.addEventListener("change", invalidateValidation);

  function resetPartitionRatios() {
    if (isTwoWay()) {
      if ($("#exportTrainNum")) $("#exportTrainNum").value = 80;
      if ($("#exportEvalNum")) $("#exportEvalNum").value = 0;
      if ($("#exportTestNum")) $("#exportTestNum").value = 20;
    } else {
      if ($("#exportTrainNum")) $("#exportTrainNum").value = 70;
      if ($("#exportEvalNum")) $("#exportEvalNum").value = 15;
      if ($("#exportTestNum")) $("#exportTestNum").value = 15;
    }
    invalidateValidation();
  }

  $("#exportPartitionReset")?.addEventListener("click", (e) => {
    e.preventDefault();
    resetPartitionRatios();
  });

  function getExportQueryParams() {
    const p = exportParamsBuilder();
    p.delete("limit"); p.delete("offset");
    p.set("format", $("#exportFormat")?.value || "csv");
    p.set("split", isSplitEnabled() ? "true" : "false");
    p.set("split_train", $("#exportTrainNum")?.value || "80");
    p.set("split_eval", $("#exportEvalNum")?.value || "0");
    p.set("split_test", $("#exportTestNum")?.value || "20");
    p.set("seed", $("#exportSeed")?.value || "42");
    p.set("stratify", $("#exportStratify")?.checked ? "true" : "false");

    if ($("#exportExcludeOther")?.checked) {
      p.set("exclude_other", "true");
      const existingEx = p.get("exclude_labels") || "";
      const exList = existingEx ? existingEx.split(",").map((s) => s.trim()).filter(Boolean) : [];
      if (!exList.includes("Others")) {
        exList.push("Others");
        p.set("exclude_labels", exList.join(","));
      }
    } else {
      p.set("exclude_other", "false");
    }

    const maxCapActive = $("#exportMaxDocCapToggle")?.checked;
    p.set("max_doc_label_pct", maxCapActive ? ($("#exportMaxDocCapNum")?.value || "20") : "0");

    if ($("#exportCustomFieldsToggle")?.checked && includedFields.length) {
      p.set("fields", includedFields.join(","));
    }
    return p;
  }

  $("#exportValidate")?.addEventListener("click", async () => {
    if (isValidated) {
      if (isSplitEnabled()) {
        const validation = validatePartitions($("#exportTrainNum")?.value, $("#exportEvalNum")?.value, $("#exportTestNum")?.value);
        if (!validation.valid) {
          $("#exportError").textContent = validation.message;
          $("#exportError").classList.remove("d-none");
          return;
        }
      }
      $("#exportError").classList.add("d-none");
      const p = getExportQueryParams();

      await triggerExportDownload(p);
      return;
    }

    if (isSplitEnabled()) {
      const validation = validatePartitions($("#exportTrainNum")?.value, $("#exportEvalNum")?.value, $("#exportTestNum")?.value);

      if (!validation.valid) {
        const fb = $("#exportValidationFeedback");
        if (fb) {
          fb.style.display = "block";
          fb.className = "my-2 p-2 rounded small bg-danger-subtle text-danger border border-danger-subtle";
          fb.textContent = `❌ Validation Failed: ${validation.message}`;
        }
        isValidated = false;
        setButtonState("validate");
        return;
      }
    }

    setButtonState("validating");
    if (reEnableTimer) clearTimeout(reEnableTimer);
    reEnableTimer = setTimeout(() => {
      const btn = $("#exportValidate");
      if (btn && btn.disabled && !isValidated) {
        btn.disabled = false;
      }
    }, 5000);

    const p = getExportQueryParams();

    try {
      const data = await fetchJSON(`/api/export/preview?${p}`);
      const fb = $("#exportValidationFeedback");

      if (data.valid) {
        isValidated = true;
        setButtonState("download");

        if (fb) {
          fb.style.display = "block";
          fb.className = "my-2 p-2 rounded small bg-success-subtle text-success border border-success-subtle";

          let msg = `✅ Validation Passed: ${data.total_units} total units`;
          if (data.split_enabled && data.counts) {
            const countsStr = Object.entries(data.counts)
              .filter(([_, v]) => v > 0)
              .map(([k, v]) => `${k.toUpperCase()}: ${v}`)
              .join(" | ");
            if (countsStr) msg += ` (${countsStr})`;
          }

          if (data.capped_units_removed > 0) {
            msg += ` — ${data.capped_units_removed} units capped by Max Rep Cap.`;
          }
          if (data.warnings && data.warnings.length) {
            msg += ` ⚠️ ${data.warnings.join(" ")}`;
          }
          fb.textContent = msg;
        }
      } else {
        isValidated = false;
        setButtonState("validate");
        if (fb) {
          fb.style.display = "block";
          fb.className = "my-2 p-2 rounded small bg-danger-subtle text-danger border border-danger-subtle";
          fb.textContent = `❌ Validation Failed: ${data.error || "Invalid configuration"}`;
        }
      }
    } catch (err) {
      isValidated = false;
      setButtonState("validate");
      const fb = $("#exportValidationFeedback");
      if (fb) {
        fb.style.display = "block";
        fb.className = "my-2 p-2 rounded small bg-danger-subtle text-danger border border-danger-subtle";
        fb.textContent = `❌ Preview Error: ${err.message}`;
      }
    }
  });

  function setPartitionLayout() {
    const mode = getSplitMode();
    const opts = $("#exportSplitOptions");
    if (opts) opts.style.display = mode === "off" ? "none" : "";

    const twoWay = mode === "2";
    const evalCol = $("#exportEvalCol");
    if (evalCol) {
      evalCol.style.display = twoWay ? "none" : "";
    }
    if (twoWay) {
      if ($("#exportEvalNum")) $("#exportEvalNum").value = 0;
      let t = Number($("#exportTrainNum")?.value) || 80;
      if ($("#exportTestNum")) $("#exportTestNum").value = 100 - t;
    } else {
      let e = Number($("#exportEvalNum")?.value) || 0;
      if (e === 0) {
        if ($("#exportTrainNum")) $("#exportTrainNum").value = 70;
        if ($("#exportEvalNum")) $("#exportEvalNum").value = 15;
        if ($("#exportTestNum")) $("#exportTestNum").value = 15;
      }
    }
    invalidateValidation();
  }

  setPartitionLayout();

  $("#exportReset")?.addEventListener("click", () => {
    const formatCsvRadio = $("#exportFormatCSV");
    if (formatCsvRadio) formatCsvRadio.checked = true;
    if ($("#exportFormat")) $("#exportFormat").value = "csv";

    const split2Radio = $("#exportSplit2");
    if (split2Radio) split2Radio.checked = true;

    if ($("#exportTrainNum")) $("#exportTrainNum").value = 80;
    if ($("#exportEvalNum")) $("#exportEvalNum").value = 0;
    if ($("#exportTestNum")) $("#exportTestNum").value = 20;
    if ($("#exportSeed")) $("#exportSeed").value = 42;
    if ($("#exportStratify")) $("#exportStratify").checked = true;
    if ($("#exportExcludeOther")) $("#exportExcludeOther").checked = true;

    if ($("#exportMaxDocCapToggle")) $("#exportMaxDocCapToggle").checked = false;
    if ($("#exportMaxDocCapContainer")) $("#exportMaxDocCapContainer").style.display = "none";
    if ($("#exportMaxDocCapNum")) $("#exportMaxDocCapNum").value = 20;

    includedFields = [...DEFAULT_INCLUDED_FIELDS];
    excludedFields = ALL_EXPORT_FIELDS.filter((f) => !DEFAULT_INCLUDED_FIELDS.includes(f));
    if ($("#exportCustomFieldsToggle")) $("#exportCustomFieldsToggle").checked = false;
    if ($("#exportCustomFieldsContainer")) $("#exportCustomFieldsContainer").style.display = "none";
    renderFieldSelects();

    setPartitionLayout();
    invalidateValidation();
    if (resetSampleConfig) resetSampleConfig();
  });

  document.querySelectorAll('#exportModal [data-bs-toggle="tooltip"]').forEach((el) => {
    new bootstrap.Tooltip(el);
  });
}


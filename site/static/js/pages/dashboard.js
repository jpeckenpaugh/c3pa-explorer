/* C3PA Explorer - Dashboard View */
"use strict";

import { $, app } from "../core/utils.js";
import { fetchJSON } from "../core/api.js";
import { LABEL_COLORS } from "../components/badges.js";

export async function pageDashboard() {
  window._dashPulseParams = null;
  app.innerHTML = '<div class="text-center py-5"><span class="spinner-border"></span></div>';
  app.classList.add("dash-bg");
  const s = await fetchJSON("/api/stats");

  // A family card: a top-level count with sub-cards.
  const starsHtml = (s) => `
    <div class="small mt-1">
      <span class="text-warning">&#9733;</span>&nbsp;${s[1].toLocaleString()}
      &nbsp;<span class="text-warning">&#9733;&#9733;</span>&nbsp;${s[2].toLocaleString()}
      &nbsp;<span class="text-warning">&#9733;&#9733;&#9733;</span>&nbsp;${s[3].toLocaleString()}
    </div>`;
  const familySub = (label, value, sub, extra) => `
    <div class="col-6">
      <div class="border rounded p-2 text-center h-100 family-tile">
        <div class="fw-bold">${value.toLocaleString()}</div>
        <div class="small text-muted">${label}</div>
        ${sub ? `<div class="small text-muted">${sub}</div>` : ""}
        ${extra || ""}
      </div>
    </div>`;
  const familyCard = (title, count, subs, sub, id, href, variant = "", align = "center") => {
    const justifyCls = align === "left" ? "justify-content-start ps-3" : align === "right" ? "justify-content-end pe-3" : "justify-content-center";
    const card = `
      <div class="card h-100 ${variant}">
        <div class="card-header py-2 d-flex align-items-center ${justifyCls} gap-2">
          <strong>${title}</strong>
          <span class="fs-5 fw-bold">${count.toLocaleString()}</span>
        </div>
        <div class="card-body py-2">
          <div class="row g-2">${subs.map((x) => familySub(x.label, x.value, x.sub, x.extra)).join("")}</div>
          ${sub ? `<div class="small text-muted mt-2">${sub}</div>` : ""}
        </div>
      </div>`;
    return `<div class="col-md-6" ${id ? `id="${id}"` : ""}>
      ${href ? `<a class="family-link text-decoration-none text-reset d-block h-100" href="${href}" title="Open ${title}">${card}</a>` : card}
    </div>`;
  };

  const sourceHtml = `
    <div class="text-center mt-1" style="position:relative;z-index:10;margin-bottom:-52px;pointer-events:none">
      <span class="badge text-bg-dark dash-badge-source" id="dashBadgeSource" style="font-size:1.5em;padding:.55em 1.1em;box-shadow:0 .25rem .5rem rgba(0,0,0,.3)">
        <span class="dash-badge-text">Incoming Truths</span>
      </span>
    </div>
    <div class="row g-3 mb-5">
      ${familyCard("Documents", s.documents, [
        { label: "Complete Sentences", value: s.sentences,
          sub: "A single complete thought." },
        { label: "Fragments", value: s.fragments,
          sub: "Incomplete thoughts or interjected words." },
      ], "An archive of 400 privacy policy pages from companies operating in California, captured in 2023/2024. Each page is parsed into complete sentences; the remaining text is preserved as fragments.", "docCard", "#/library", "dash-card-source", "left")}
      ${familyCard("Labels", s.label_distribution.length, [
        { label: "Human Annotators", value: s.annotators.length,
          sub: "Privacy Subject Matter Experts" },
        { label: "Contextual Annotations", value: s.annotations,
          sub: "Proposed labels with justifying evidence." },
      ], "Humans review the documents, proposing labels for relevant spans of text as they relate to provisions of the California Consumer Privacy Act (CCPA) and its successor, the California Privacy Rights Act (CPRA).", "labelsCard", "#/classification", "dash-card-source", "right")}
    </div>`;

  const samplesHtml = `
    <div class="text-center" style="position:relative;z-index:10;margin-top:48px;margin-bottom:-54px;pointer-events:none">
      <span class="badge text-bg-primary dash-badge-derived" id="dashBadgeDerived" style="font-size:1.5em;padding:.55em 1.1em;box-shadow:0 .25rem .5rem rgba(0,0,0,.3)">
        <span class="dash-badge-text">Outgoing Correlations</span>
      </span>
    </div>
    <div class="row g-3 mb-2">
      ${familyCard("Defined Samples", s.single_label_sentences + s.multi_label_sentences, [
        { label: "Single-label Sentences", value: s.single_label_sentences,
          extra: starsHtml(s.single_label_stars) },
        { label: "Multi-label Sentences", value: s.multi_label_sentences,
          extra: starsHtml(s.multi_label_stars) },
      ], "Sentences with direct evidence for label attribution are grouped by how many labels apply to each sentence and by the share of annotators who agree on that evidence.", "definedCard", "#/samples", "dash-card-derived", "left")}
      ${familyCard("Undefined Samples", s.unlabeled_sentences + s.fragments, [
        { label: "Null-label Sentences", value: s.unlabeled_sentences,
          sub: "Annotations yielded weak labeling evidence." },
        { label: "Fragments", value: s.fragments,
          sub: "Incomplete sentences skip labeling analysis." },
      ], "Failing to find evidence for label attribution does not mean no label can apply. Absence of evidence is not guilt &mdash; it simply means the supplied evidence does not suggest a correlation.", "undefinedCard", "#/samples?view=fragments", "dash-card-derived", "right")}
    </div>
    <div class="bg-white rounded py-2 px-3 text-muted mb-3 shadow dash-underdefined-note" style="font-size:16px">
      Depending on the configured evidence threshold and support configurations, some defined
      samples may be set aside into a third <strong class="text-decoration-underline">Underdefined</strong> group. Underdefined Samples
      can be used for testing in situations where human annotators do not reach consensus on
      appropriate labels or disagree on evidential claims.
    </div>`;

  app.innerHTML = `
    <div class="dash-flow" id="dashFlow">
      ${sourceHtml}
      <div class="text-center py-1 mb-3">
        <div class="mx-auto dash-center-box" style="position:relative;z-index:10;max-width:520px;background:rgba(255,255,255,0.9);padding:.45rem .75rem;border-radius:.3rem;border:2px solid #dee2e6;box-shadow:0 .5rem 1.25rem rgba(0,0,0,.45);font-size:16px">
          Each sentence is evaluated against the supplied annotations, seeking specific evidence to point it at one or more labels.
        </div>
      </div>
      ${samplesHtml}
      <svg id="flowArrows" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"></svg>
    </div>`;

  function drawFlowArrows() {
    const flow = $("#dashFlow");
    if (!flow) return;
    const svg = $("#flowArrows");
    const fr = flow.getBoundingClientRect();
    const box = (sel) => {
      const r = $(sel).getBoundingClientRect();
      return { left: r.left - fr.left, right: r.left - fr.left + r.width,
               top: r.top - fr.top, bottom: r.top - fr.top + r.height };
    };
    const doc = box("#docCard");
    const lbl = box("#labelsCard");
    const def = box("#definedCard");
    const und = box("#undefinedCard");

    const N = 13;
    const stagger = (b) =>
      Array.from({ length: N }, (_, i) => b.left + (b.right - b.left) * (i + 0.5) / N);

    const docXs = stagger(doc);
    const undXs = stagger(und);
    const lblXs = stagger(lbl);
    const defXs = stagger(def);

    const lblColors = s.label_distribution.map((l) => LABEL_COLORS[l.label]);
    const colorOpacity = (i) => {
      const t = 1 - Math.abs(i - (N - 1) / 2) / ((N - 1) / 2);
      return 0.5 + 0.4 * t;
    };

    const greyRamp = (i) => {
      const t = 1 - Math.abs(i - (N - 1) / 2) / ((N - 1) / 2);
      const c = () => Math.round(255 + (26 - 255) * t);
      return `rgb(${c()}, ${c()}, ${c()})`;
    };

    const curve = (x1, y1, x2, y2, color = "#adb5bd", opacity = 1, delayMs = 0) => {
      const mid = (y1 + y2) / 2;
      return `<path class="flow-line" d="M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${x1.toFixed(1)} ${mid.toFixed(1)}, ${x2.toFixed(1)} ${mid.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}"
        fill="none" stroke="${color}" stroke-width="1.5" filter="url(#lineShadow)"${opacity < 1 ? ` stroke-opacity="${opacity.toFixed(2)}"` : ""}${delayMs ? ` style="animation-delay:${delayMs}ms;"` : ""}/>`;
    };

    const pulseCurve = (x1, y1, x2, y2, color = "#ffffff", delayMs = 1000, durSec = "2.0", iters = 4) => {
      const mid = (y1 + y2) / 2;
      const d = `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${x1.toFixed(1)} ${mid.toFixed(1)}, ${x2.toFixed(1)} ${mid.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
      return `<path class="flow-pulse-line" d="${d}" fill="none" stroke="${color}" stroke-width="2.5" filter="url(#pulseGlow)" style="--pulse-delay:${delayMs}ms; --pulse-dur:${durSec}s; --pulse-iters:${iters};"/>`;
    };

    if (!window._dashPulseParams) {
      const shuffled = Array.from({ length: 26 }, (_, k) => k).sort(() => Math.random() - 0.5);
      window._dashPulseParams = Array.from({ length: 26 }, (_, k) => {
        const rank = shuffled.indexOf(k);
        const delayMs = Math.round(1000 + (rank / 25) * 9000 + (Math.random() - 0.5) * 350);
        const durSec = (1.6 + Math.random() * 4.4).toFixed(2);
        const targetEndMs = 13500 + Math.random() * 3000;
        const durMs = parseFloat(durSec) * 1000;
        const iters = Math.max(1, Math.round((targetEndMs - delayMs) / durMs));
        return { delayMs: Math.max(1000, delayMs), durSec, iters };
      });
    }

    const lines = [];
    const isFirstDraw = !window._dashFlowAnimated;
    window._dashFlowAnimated = true;

    for (let i = 0; i < N; i++) {
      const delay = isFirstDraw ? (120 + i * 90) : 0;
      lines.push(curve(docXs[i], doc.bottom, undXs[i], und.top, greyRamp(i), 1, delay));
      const p = window._dashPulseParams[i];
      lines.push(pulseCurve(docXs[i], doc.bottom, undXs[i], und.top, "#ffffff", p.delayMs, p.durSec, p.iters));
    }
    for (let i = 0; i < N; i++) {
      const reverseIdx = (N - 1) - i;
      const delay = isFirstDraw ? (165 + reverseIdx * 90) : 0;
      lines.push(curve(lblXs[i], lbl.bottom, defXs[i], def.top, lblColors[i] || "#adb5bd", colorOpacity(i), delay));
      const p = window._dashPulseParams[13 + i];
      lines.push(pulseCurve(lblXs[i], lbl.bottom, defXs[i], def.top, lblColors[i] || "#ffffff", p.delayMs, p.durSec, p.iters));
    }
    svg.setAttribute("viewBox", `0 0 ${fr.width} ${fr.height}`);
    svg.innerHTML = `<defs>
  <filter id="lineShadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-color="rgba(0, 0, 0, .35)"/>
  </filter>
  <filter id="pulseGlow" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur stdDeviation="2" result="blur"/>
    <feMerge>
      <feMergeNode in="blur"/>
      <feMergeNode in="SourceGraphic"/>
    </feMerge>
  </filter>
</defs>` + lines.join("");
  }
  window._dashFlowAnimated = false;
  drawFlowArrows();
  window.addEventListener("resize", drawFlowArrows);

  const transitionBadge = (badgeId, newText) => {
    const badgeEl = document.getElementById(badgeId);
    if (!badgeEl) return;
    const textEl = badgeEl.querySelector(".dash-badge-text") || badgeEl;
    textEl.classList.add("badge-fading");
    setTimeout(() => {
      if (document.body.contains(textEl)) {
        textEl.textContent = newText;
        textEl.classList.remove("badge-fading");
      }
    }, 400);
  };

  setTimeout(() => {
    transitionBadge("dashBadgeSource", "Upstream Observations");
  }, 6000);

  setTimeout(() => {
    transitionBadge("dashBadgeSource", "Incoming Truths");
  }, 11000);

  setTimeout(() => {
    transitionBadge("dashBadgeDerived", "Downstream Samples");
  }, 7000);

  setTimeout(() => {
    transitionBadge("dashBadgeDerived", "Outgoing Correlations");
  }, 12000);
}

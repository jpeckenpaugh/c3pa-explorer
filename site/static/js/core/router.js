/* C3PA Explorer - Hash Router */
"use strict";

import { $, $$, app } from "./utils.js";
import { pageDashboard } from "../pages/dashboard.js";
import { pageLabels, pageAnnotatorDetail } from "../pages/labels.js";
import { pageDocuments, pageDocument } from "../pages/documents.js";
import { pageUnits } from "../pages/units.js";

const routes = [
  { re: /^#\/$/, page: pageDashboard },
  { re: /^#\/classification$/, page: pageLabels },
  { re: /^#\/library\/([^/]+)$/, page: pageDocument },
  { re: /^#\/library$/, page: pageDocuments },
  { re: /^#\/annotators\/([^/]+)$/, page: pageAnnotatorDetail },
  { re: /^#\/annotators$/, page: () => { location.hash = "#/classification"; } },
  { re: /^#\/annotations$/, page: () => { location.hash = "#/classification"; } },
  { re: /^#\/samples(?:\?.*)?$/, page: () => pageUnits([]) },
  { re: /^#\/(fragments|sentences)$/, page: (m) => { location.hash = m[1] === "fragments" ? "#/samples?view=fragments" : "#/samples"; } },
  { re: /^#\/documents(?:\/([^/]+))?$/, page: (a) => { location.hash = a[0] ? `#/library/${a[0]}` : "#/library"; } },
  { re: /^#\/labels$/, page: () => { location.hash = "#/classification"; } },
];

export async function fadeOutDashboard() {
  const flow = $("#dashFlow");
  if (!flow) return;
  const svg = $("#flowArrows");
  if (svg) {
    const paths = $$(".flow-line", svg);
    for (let i = 0; i < 13; i++) {
      const leftPath = paths[12 - i];
      const rightPath = paths[13 + i];
      if (leftPath) leftPath.style.animation = `flowLineFadeOut 0.35s cubic-bezier(0.4, 0, 1, 1) ${i * 40}ms forwards`;
      if (rightPath) rightPath.style.animation = `flowLineFadeOut 0.35s cubic-bezier(0.4, 0, 1, 1) ${20 + i * 40}ms forwards`;
    }
  }
  flow.classList.add("dash-unload");
  await new Promise((r) => setTimeout(r, 600));
}

const NAV_SECTIONS = [
  { prefix: "#/library", id: 'a[href="#/library"]' },
  { prefix: "#/classification", id: 'a[href="#/classification"]' },
  { prefix: "#/samples", id: 'a[href="#/samples"]' },
];

export function setActiveNav(hash) {
  const links = $$(".navbar-nav .nav-link");
  links.forEach((l) => l.classList.remove("active"));
  for (const s of NAV_SECTIONS) {
    if (hash.startsWith(s.prefix)) {
      const el = $(s.id);
      if (el) el.classList.add("active");
      break;
    }
  }
  const navEl = $(".navbar");
  if (navEl) {
    if (hash.startsWith("#/samples")) {
      navEl.classList.add("nav-downstream");
    } else {
      navEl.classList.remove("nav-downstream");
    }
  }
}

export async function router() {
  const hash = location.hash || "#/";
  const match = routes.find((r) => r.re.test(hash));
  if (!match) { location.hash = "#/"; return; }
  if ($("#dashFlow")) {
    await fadeOutDashboard();
  }
  const update = () => {
    setActiveNav(hash);
    if (app) app.classList.remove("dash-bg");
    const m = match.re.exec(hash);
    match.page(m ? m.slice(1) : []);
    window.scrollTo(0, 0);
  };
  if (document.startViewTransition) {
    document.startViewTransition(() => update());
  } else {
    update();
  }
}

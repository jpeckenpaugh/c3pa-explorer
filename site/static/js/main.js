/* C3PA Explorer - Application Entry Point */
"use strict";

import { $ } from "./core/utils.js";
import { router } from "./core/router.js";
import { wireExportModal } from "./components/exportModal.js";
import { initUnitNavControls } from "./components/unitModal.js";
import { initGlobalSearch } from "./components/searchModal.js";
import { handleNavConfigureClick, handleNavDownloadClick } from "./pages/units.js";

function initApp() {
  wireExportModal();
  initUnitNavControls();
  initGlobalSearch();

  $("#navConfigure")?.addEventListener("click", handleNavConfigureClick);
  $("#navDownload")?.addEventListener("click", handleNavDownloadClick);
  window.addEventListener("hashchange", router);

  router();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}

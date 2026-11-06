/* Register before CAF and the deferred root router so parse/load failures are visible. */
(function () {
  "use strict";
  const report = (phase, outcome, details = {}) => {
    try {
      console.error("[CAST_BOOT_DIAGNOSTIC]", JSON.stringify({
        type: "CAST_BOOT_DIAGNOSTIC", phase, outcome, details,
      }));
    } catch (_) {}
  };
  const status = document.getElementById("receiver-startup-status");
  const updateStatus = (message) => { if (status) status.textContent = message; };
  const startupWatchdog = setTimeout(() => {
    if (document.body?.classList.contains("app-loading")) {
      updateStatus("Studio receiver is still starting. Check the Cast connection or stop and retry.");
      report("startup_watchdog", "ui_not_revealed");
    }
  }, 15000);
  window.addEventListener("cast-receiver-ui-revealed", () => {
    clearTimeout(startupWatchdog);
    if (status) status.hidden = true;
  }, { once: true });
  window.addEventListener("error", (event) => {
    const target = event.target;
    if (target && target.tagName === "SCRIPT") {
      const src = String(target.src || "");
      const asset = src.includes("cast_receiver_framework")
        ? "caf"
        : src.includes("receiver-entry.js")
          ? "receiver_entry"
          : "other_script";
      report("script_load", "failed", { asset });
      updateStatus("Studio receiver could not load a required script. Stop and retry the Cast session.");
    } else if (!target) {
      const file = String(event.filename || "").split("/").pop().split("?")[0].slice(0, 64);
      report("script_runtime", "failed", {
        file,
        errorName: String(event.error?.name || "Error").slice(0, 48),
      });
      updateStatus("Studio receiver encountered a startup error. Stop and retry the Cast session.");
    }
  }, true);
  window.addEventListener("unhandledrejection", (event) => {
    report("script_rejection", "unhandled", {
      errorName: String(event.reason?.name || "Error").slice(0, 48),
    });
    updateStatus("Studio receiver encountered a startup error. Stop and retry the Cast session.");
  });
})();

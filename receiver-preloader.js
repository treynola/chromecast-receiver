/* Register before CAF and the deferred root router so parse/load failures are visible. */
(function () {
  "use strict";
  const report = (phase, outcome, details = {}, startupFailure = true, level = "error") => {
    try {
      const log = console[level] || console.error;
      log.call(console, "[CAST_BOOT_DIAGNOSTIC]", JSON.stringify({
        type: "CAST_BOOT_DIAGNOSTIC", phase, outcome, details,
      }));
    } catch (_) {}
    if (startupFailure) {
      window.dispatchEvent(new CustomEvent("cast-receiver-startup-failure", { detail: { phase, outcome } }));
    }
  };
  window.addEventListener("error", (event) => {
    const target = event.target;
    if (target && ["SCRIPT", "LINK"].includes(target.tagName)) {
      const src = String(target.src || target.href || "");
      const asset = src.includes("cast_receiver_framework")
        ? "caf"
        : src.includes("receiver-entry.js")
          ? "receiver_entry"
          : "other_script";
      report("asset_load", "failed", { asset });
    } else if (!target || target === window) {
      const message = String(event.message || "");
      const filename = String(event.filename || "");
      const opaque = !filename && !event.error && /^\s*Script error\.?\s*$/i.test(message);
      if (opaque) {
        report("script_runtime_opaque", "unattributed", {
          sourceResolution: "browser_opaque",
          errorName: "Error",
        }, false, "warn");
        return;
      }
      const file = filename.split("/").pop().split("?")[0].slice(0, 64);
      report("script_runtime", "failed", {
        file,
        errorName: String(event.error?.name || "Error").slice(0, 48),
      });
    }
  }, true);
  window.addEventListener("unhandledrejection", (event) => {
    report("script_rejection", "unhandled", {
      errorName: String(event.reason?.name || "Error").slice(0, 48),
    });
  });
})();

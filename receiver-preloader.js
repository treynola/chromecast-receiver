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
    } else if (!target) {
      const file = String(event.filename || "").split("/").pop().split("?")[0].slice(0, 64);
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

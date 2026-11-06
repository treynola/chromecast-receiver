/* Small, redacted root-to-branch startup phase reporter. */
(function () {
  "use strict";
  const branch = window.MXS_RECEIVER_BRANCH || {};
  const namespace = "urn:x-cast:com.nowmultimedia.mxs004";
  let rootId = "branch-root-unavailable";
  let generation = null;
  try {
    rootId = sessionStorage.getItem("mxs.cast.boot.rootId") || rootId;
    const value = Number(sessionStorage.getItem("mxs.cast.boot.generation"));
    generation = Number.isSafeInteger(value) ? value : null;
  } catch (_) {}
  const event = {
    type: "CAST_BOOT_DIAGNOSTIC",
    eventId: `${rootId}:branch:1`,
    rootId,
    phase: "branch_entered",
    outcome: "ok",
    mode: ["D18A9B3A", "MIRROR_CAST"].includes(branch.mode) ? branch.mode : null,
    generation,
    buildVersion: window.MXS_BUILD_IDENTITY?.version ?? null,
    receiverHtmlIdentity: window.MXS_BUILD_IDENTITY?.artifacts?.receiverHtml ?? null,
    details: {},
  };
  try {
    const framework = window.cast?.framework;
    if (framework && typeof framework.CastReceiverContext?.getInstance === "function") {
      const context = framework.CastReceiverContext.getInstance();
      if (typeof context.sendCustomMessage === "function") {
        context.sendCustomMessage(namespace, "sender-0", event);
      }
    }
  } catch (error) {
    try { console.warn("[CAST_BOOT_DIAGNOSTIC] branch report failed", String(error?.name || "Error").slice(0, 48)); } catch (_) {}
  }
  try { console.info("[CAST_BOOT_DIAGNOSTIC]", JSON.stringify(event)); } catch (_) {}
})();

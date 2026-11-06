/* Registered Cast URL: route only. No audio, Studio DOM, or WebRTC owner here. */
(function () {
  "use strict";
  const routes = Object.freeze({
    D18A9B3A: "chromecast/index.html",
    MIRROR_CAST: "mirror/index.html",
    CC1AD845: "default/index.html",
  });
  const namespace = "urn:x-cast:com.nowmultimedia.mxs004";
  const rootId = typeof window.crypto?.randomUUID === "function"
    ? window.crypto.randomUUID()
    : `root-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const emitted = new Set();
  const pendingReports = [];
  let sequence = 0;
  let routing = false;
  let context = null;
  let selectedMode = null;
  let launchGeneration = null;
  let lastConfigGeneration = null;
  let cafStartPending = false;
  let receiverStarted = false;

  function report(phase, outcome = "ok", details = {}) {
    const safeGeneration = Number.isSafeInteger(launchGeneration) ? launchGeneration : null;
    const event = {
      type: "CAST_BOOT_DIAGNOSTIC",
      eventId: `${rootId}:${++sequence}`,
      rootId,
      phase,
      outcome,
      mode: selectedMode,
      generation: safeGeneration,
      buildVersion: window.MXS_BUILD_IDENTITY?.version ?? null,
      receiverHtmlIdentity: window.MXS_BUILD_IDENTITY?.artifacts?.receiverHtml ?? null,
      details,
    };
    const key = event.eventId;
    if (emitted.has(key)) return;
    emitted.add(key);
    if (emitted.size > 64) emitted.delete(emitted.values().next().value);
    try { console.info("[CAST_BOOT_DIAGNOSTIC]", JSON.stringify(event)); } catch (_) {}
    if (pendingReports.length >= 16) pendingReports.shift();
    pendingReports.push({ event, attempts: 0 });
    flushReports();
  }

  function flushReports() {
    if (!context || typeof context.sendCustomMessage !== "function") return;
    for (const item of pendingReports) {
      if (item.attempts >= 3 || item.inFlight || item.delivered) continue;
      item.attempts += 1;
      try {
        item.inFlight = true;
        Promise.resolve(context.sendCustomMessage(namespace, "sender-0", item.event))
          .then(() => { item.delivered = true; })
          .catch(() => {})
          .finally(() => { item.inFlight = false; });
      } catch (_) { item.inFlight = false; }
    }
    for (let i = pendingReports.length - 1; i >= 0; i -= 1) {
      if (pendingReports[i].delivered) pendingReports.splice(i, 1);
    }
    if (pendingReports.some((item) => item.attempts < 3) && !reportRetryTimer && typeof setTimeout === "function") {
      reportRetryTimer = setTimeout(() => {
        reportRetryTimer = null;
        flushReports();
      }, 500);
    }
  }
  let reportRetryTimer = null;

  function setStatus(message) {
    if (typeof document === "undefined") return;
    const status = document.getElementById("receiver-entry-status");
    if (status) {
      status.hidden = false;
      status.textContent = String(message).slice(0, 200);
    }
  }

  function route(mode, fragment = "") {
    if (routing) {
      report("navigation", "duplicate_ignored", { requestedMode: mode });
      return false;
    }
    if (!Object.prototype.hasOwnProperty.call(routes, mode)) {
      report("mode_selected", "invalid_mode", { requestedMode: String(mode).slice(0, 32) });
      setStatus("Cast mode was not recognized.");
      return false;
    }
    selectedMode = mode;
    report("mode_selected");
    const target = new URL(routes[mode], window.location.href);
    target.hash = fragment ? fragment.slice(1) : "";
    const destination = target.href;
    try {
      sessionStorage.setItem("mxs.cast.boot.rootId", rootId);
      sessionStorage.setItem("mxs.cast.boot.mode", mode);
      sessionStorage.setItem("mxs.cast.boot.generation", launchGeneration === null ? "" : String(launchGeneration));
    } catch (_) {}
    report("navigation", "requested", { branch: routes[mode] });
    try {
      window.location.replace(destination);
      routing = true;
      return true;
    } catch (error) {
      report("navigation", "failed", { errorName: String(error?.name || "Error").slice(0, 48) });
      setStatus("Receiver mode could not be opened. Waiting for Cast retry.");
      return false;
    }
  }

  report("root_script", "entered");

  // LAN browser launches retain their peer-bound, one-use bootstrap fragment.
  if (new URLSearchParams(window.location.hash.slice(1)).has("bootstrap")) {
    route("D18A9B3A", window.location.hash);
    return;
  }

  function receive(event) {
    if (typeof event.data === "string" && event.data.length > 65536) {
      report("config", "rejected_oversize");
      return;
    }
    let data;
    try {
      data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
    } catch (_) {
      report("config", "rejected_malformed");
      return;
    }
    if (data?.type !== "BRIDGE_CONFIG") return;
    const incomingGeneration = Number.isSafeInteger(data.credentialGeneration)
      ? data.credentialGeneration
      : null;
    if (incomingGeneration !== null && lastConfigGeneration !== null && incomingGeneration < lastConfigGeneration) {
      report("config", "rejected_stale_generation", { receivedGeneration: incomingGeneration });
      return;
    }
    if (incomingGeneration !== null) lastConfigGeneration = incomingGeneration;
    launchGeneration = incomingGeneration;
    report("config", "received");
    // This selects a page, never authenticates a bridge. The selected page
    // validates a fresh retried configuration using the existing fail-closed core.
    route(data.castMode || "D18A9B3A");
  }

  function startReceiver(attempt = 0) {
    if (receiverStarted || cafStartPending) return;
    const framework = window.cast?.framework;
    if (!framework || typeof framework.CastReceiverContext?.getInstance !== "function") {
      if (attempt === 0) report("caf", "missing");
      if (attempt >= 20) {
        report("caf", "unavailable_after_bounded_wait");
        setStatus("Google Cast receiver framework did not load.");
        return;
      }
      cafStartPending = true;
      setTimeout(() => {
        cafStartPending = false;
        startReceiver(attempt + 1);
      }, 250);
      return;
    }
    try {
      context = framework.CastReceiverContext.getInstance();
      report("caf", "available");
      context.addCustomMessageListener(namespace, receive);
      context.addCustomMessageListener("urn:x-cast:com.nowmultimedia.mxs.mirror", receive);
      report("caf", "starting");
      const options = new framework.CastReceiverOptions();
      options.disableIdleTimeout = true;
      context.start(options);
      receiverStarted = true;
      report("caf", "started");
    } catch (error) {
      report("root_startup", "failed", { errorName: String(error?.name || "Error").slice(0, 48) });
      setStatus("Receiver could not start. Waiting for Cast retry.");
    }
  }

  startReceiver();
})();

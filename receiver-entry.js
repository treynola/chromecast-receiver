/* Registered Cast URL: route only. No audio, Studio DOM, or WebRTC owner here. */
(function () {
  "use strict";
  const ROUTE_BY_APP_ID = Object.freeze({
    "82714EF7": "chromecast/index.html",
    D18A9B3A: "chromecast/index.html",
    F918A6E8: "mirror/index.html",
    MIRROR_CAST: "mirror/index.html",
  });
  const routes = ROUTE_BY_APP_ID;
  const MAX_BRIDGE_CONFIG_BYTES = 16384;

  function safeJsonReviver(key, value) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      return undefined;
    }
    return value;
  }

  function isNonEmptyString(val) {
    return typeof val === "string" && val.trim().length > 0;
  }

  function verifyBuildIdentity(receivedIdentity) {
    if (typeof window.MXS_BUILD_IDENTITY === "undefined" || window.MXS_BUILD_IDENTITY === null) {
      return true;
    }
    if (receivedIdentity === window.MXS_BUILD_IDENTITY) {
      return true;
    }
    if (typeof window.MXS_BUILD_IDENTITY === "string") {
      return receivedIdentity === window.MXS_BUILD_IDENTITY;
    }
    if (typeof window.MXS_BUILD_IDENTITY === "object" && typeof receivedIdentity === "object" && receivedIdentity !== null) {
      if (window.MXS_BUILD_IDENTITY.version && receivedIdentity.version) {
        if (window.MXS_BUILD_IDENTITY.version !== receivedIdentity.version) return false;
      }
      try {
        return JSON.stringify(window.MXS_BUILD_IDENTITY) === JSON.stringify(receivedIdentity);
      } catch (_) {
        return false;
      }
    }
    return false;
  }
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

  function route(mode, fragment = "", acceptedGeneration = launchGeneration) {
    if (routing) {
      report("navigation", "duplicate_ignored", { requestedMode: mode });
      return false;
    }
    if (!Object.prototype.hasOwnProperty.call(routes, mode)) {
      report("mode_selected", "invalid_mode", { requestedMode: String(mode).slice(0, 32) });
      setStatus("Cast mode was not recognized.");
      return false;
    }
    const target = new URL(routes[mode], window.location.href);
    target.hash = fragment ? fragment.slice(1) : "";
    const destination = target.href;
    report("navigation", "requested", { branch: routes[mode] });
    try {
      window.location.replace(destination);
      routing = true;
      selectedMode = mode;
      launchGeneration = acceptedGeneration;
      try {
        sessionStorage.setItem("mxs.cast.boot.rootId", rootId);
        sessionStorage.setItem("mxs.cast.boot.mode", mode);
        sessionStorage.setItem("mxs.cast.boot.generation", acceptedGeneration === null ? "" : String(acceptedGeneration));
      } catch (_) {}
      report("mode_selected");
      return true;
    } catch (error) {
      report("navigation", "failed", { errorName: String(error?.name || "Error").slice(0, 48) });
      setStatus("Receiver mode could not be opened. Waiting for Cast retry.");
      return false;
    }
  }

  report("root_script", "entered");

  // LAN browser launches retain their peer-bound, one-use bootstrap fragment.
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const queryParams = new URLSearchParams(window.location.search);
  const initialMode = queryParams.get("mode") || hashParams.get("mode");
  if (initialMode === "CC1AD845") {
    try {
      window.location.replace(new URL("default/index.html", window.location.href).href);
      return;
    } catch (_) {}
  }
  if (hashParams.has("bootstrap")) {
    route("D18A9B3A", window.location.hash);
    return;
  }

  function receive(event) {
    if (typeof event.data === "string" && event.data.length > MAX_BRIDGE_CONFIG_BYTES) {
      report("config", "rejected_oversize");
      return;
    }
    let data;
    try {
      if (typeof event.data === "string") {
        data = JSON.parse(event.data, safeJsonReviver);
      } else if (event.data && typeof event.data === "object") {
        const raw = JSON.stringify(event.data);
        if (raw.length > MAX_BRIDGE_CONFIG_BYTES) {
          report("config", "rejected_oversize");
          return;
        }
        data = JSON.parse(raw, safeJsonReviver);
      } else {
        data = event.data;
      }
      if (data && typeof data === "object") {
        delete data.__proto__;
        delete data.constructor;
        delete data.prototype;
      }
    } catch (_) {
      report("config", "rejected_malformed");
      return;
    }
    if (data?.type !== "BRIDGE_CONFIG") return;

    if (!isNonEmptyString(data.ip) || !isNonEmptyString(data.token) || !isNonEmptyString(data.guiSessionNonce)) {
      report("config", "rejected_missing_credentials");
      return;
    }

    if (!verifyBuildIdentity(data.buildIdentity)) {
      report("config", "rejected_build_identity");
      return;
    }

    const incomingGeneration = Number.isSafeInteger(data.credentialGeneration)
      ? data.credentialGeneration
      : null;
    if (incomingGeneration !== null && lastConfigGeneration !== null && incomingGeneration < lastConfigGeneration) {
      report("config", "rejected_stale_generation", { receivedGeneration: incomingGeneration });
      return;
    }
    // This selects a page, never authenticates a bridge. The selected page
    // validates a fresh retried configuration using the existing fail-closed core.
    const requestedMode = data.castMode || "D18A9B3A";
    if (!Object.prototype.hasOwnProperty.call(routes, requestedMode)) {
      report("config", "rejected_invalid_mode", { requestedMode: String(requestedMode).slice(0, 32) });
      report("mode_selected", "invalid_mode", { requestedMode: String(requestedMode).slice(0, 32) });
      setStatus("Cast mode was not recognized.");
      return;
    }
    if (!route(requestedMode, "", incomingGeneration)) return;
    if (incomingGeneration !== null) lastConfigGeneration = incomingGeneration;
    report("config", "received");
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

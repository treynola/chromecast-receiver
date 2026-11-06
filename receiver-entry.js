/* Registered Cast URL: route only. No audio, Studio DOM, or WebRTC owner here. */
(function () {
  "use strict";
  const routes = Object.freeze({
    D18A9B3A: "chromecast/index.html",
    MIRROR_CAST: "mirror/index.html",
    CC1AD845: "default/index.html",
  });
  let routing = false;
  function route(mode, fragment = "") {
    if (routing || !Object.hasOwn(routes, mode)) return false;
    routing = true;
    window.location.replace(new URL(routes[mode], window.location.href).href + fragment);
    return true;
  }
  // LAN browser launches retain their peer-bound, one-use bootstrap fragment.
  if (new URLSearchParams(window.location.hash.slice(1)).has("bootstrap")) {
    route("D18A9B3A", window.location.hash);
    return;
  }
  if (!window.cast?.framework) return;
  const context = window.cast.framework.CastReceiverContext.getInstance();
  function receive(event) {
    try {
      if (typeof event.data === "string" && event.data.length > 65536) return;
      const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      if (data?.type !== "BRIDGE_CONFIG") return;
      // This selects a page, never authenticates a bridge. The selected page
      // validates a fresh retried configuration using the existing fail-closed core.
      route(data.castMode || "D18A9B3A");
    } catch (_) { /* Ignore malformed route requests; keep waiting. */ }
  }
  context.addCustomMessageListener("urn:x-cast:com.nowmultimedia.mxs004", receive);
  context.addCustomMessageListener("urn:x-cast:com.nowmultimedia.mxs.mirror", receive);
  const options = new window.cast.framework.CastReceiverOptions();
  options.disableIdleTimeout = true;
  context.start(options);
})();

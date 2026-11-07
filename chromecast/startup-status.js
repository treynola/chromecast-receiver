/* Studio presentation only. No CAF, credentials, sockets or media ownership. */
(function () {
  "use strict";
  if (window.MXS_RECEIVER_BRANCH?.gui !== true || window.MXSStudioStartupStatus) return;
  let revealed = window._receiverUiRevealed === true;
  let disposed = false;
  let message = "Starting Studio receiver…";
  let watchdog = null;

  function render() {
    if (disposed) return;
    const node = document.getElementById("receiver-startup-status");
    if (!node) return;
    // Remove the surface, including inline display and pointer interception.
    if (revealed) node.remove();
    else node.textContent = message;
  }
  function fail(event) {
    if (disposed || revealed) return;
    message = event.detail?.phase === "asset_load"
      ? "Studio receiver could not load a required asset. Stop and retry the Cast session."
      : "Studio receiver encountered a startup error. Stop and retry the Cast session.";
    render();
  }
  function reveal() {
    if (disposed) return;
    revealed = true;
    clearTimeout(watchdog);
    watchdog = null;
    window.removeEventListener("cast-receiver-startup-failure", fail);
    render();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(watchdog);
    watchdog = null;
    document.removeEventListener("DOMContentLoaded", render);
    window.removeEventListener("cast-receiver-ui-revealed", reveal);
    window.removeEventListener("cast-receiver-startup-failure", fail);
    if (window.MXSStudioStartupStatus === owner) delete window.MXSStudioStartupStatus;
  }
  const owner = Object.freeze({ dispose });
  window.MXSStudioStartupStatus = owner;
  // Keep the DOM listener through early reveal: a later parsed status node
  // must also be removed even if the reveal event arrived before the body.
  document.addEventListener("DOMContentLoaded", render, { once: true });
  window.addEventListener("cast-receiver-ui-revealed", reveal, { once: true });
  if (!revealed) {
    window.addEventListener("cast-receiver-startup-failure", fail);
    watchdog = setTimeout(() => {
      watchdog = null;
      if (disposed || revealed) return;
      message = "Studio receiver is still starting. Check the Cast connection or stop and retry.";
      render();
    }, 15000);
  }
  render();
})();

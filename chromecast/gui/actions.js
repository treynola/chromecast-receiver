(function installStudioGuiActions(window) {
  "use strict";

  window.MXSCreateStudioGuiActions = function createStudioGuiActions({
    document,
    protocolVersion,
    getSessionNonce,
    confirmInteraction,
    clearInteractionFeedback,
    emitTelemetry,
    relayLog,
  }) {
    let disposed = false;
    return Object.freeze({
      handleResult(message) {
        if (disposed || !message || message.type !== "GUI_ACTION_RESULT") return false;
        if (
          message.transport !== "gui" ||
          Number(message.guiProtocolVersion) !== protocolVersion ||
          message.guiSessionNonce !== getSessionNonce()
        ) {
          emitTelemetry("rejected", {
            reason: "unsupported_action_result_envelope",
            actionId: message.actionId || null,
          });
          return true;
        }
        const status = String(message.status || "failed");
        if (status === "applied" || status === "duplicate") {
          confirmInteraction(message.guiInteractionRevision);
        } else {
          document.querySelectorAll("[data-cast-interaction-revision]").forEach((element) => {
            if (Number(element.dataset.castInteractionRevision) !== Number(message.guiInteractionRevision)) return;
            clearInteractionFeedback(element);
            element.dataset.castInteractionState = status;
          });
        }
        emitTelemetry("action_result", {
          actionId: message.actionId || null,
          status,
          reason: message.reason || null,
          revision: Number(message.guiInteractionRevision ?? -1),
        });
        relayLog(
          "🖥️ Receiver: GUI action " + String(message.actionId || "legacy") +
            " -> " + status + (message.reason ? " (" + message.reason + ")" : ""),
        );
        return true;
      },
      dispose() { disposed = true; },
    });
  };
})(window);

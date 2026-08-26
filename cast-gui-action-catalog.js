/*
 * CastGuiActionCatalog.js
 *
 * The receiver and Studio use the same command/target vocabulary while the
 * legacy DOM adapter is being retired. Keep this file dependency-free so it
 * can be served in both the Studio page and the hosted receiver page.
 */
(function () {
  const commandNames = Object.freeze([
    "control.activate",
    "control.set",
    "registry.invoke",
  ]);
  const registryActionIds = Object.freeze([
    "open-track-effect-dialog",
    "open-sample-pad-settings",
    "open-sample-editor",
    "open-sample-pad-effect",
    "open-sample-station",
  ]);
  const targetIdPattern = /^(t-(rec|stop|play|rev|slice)-\d+|t-(pitch|vol|pan|treble|mid_freq|mid_gain|bass|gain|ls|le)-sl-\d+|t-input-\d+|t-effect-select-\d+|t-fx-(left|right)-\d+|t-fx-chk-\d+-\d+|t-lfo[12]-chk-\d+-(pitch|vol|pan|treble|mid_freq|mid_gain|bass)|master-record-button|lfo-toggle|lfo2-toggle|master-volume|loop-length|lfo-time|lfo2-time|record-as-select|import-files-button|show-docs-button|sample-station-button|settings-button|sample-\d+)$/;
  const commandNameSet = new Set(commandNames);
  const registryActionIdSet = new Set(registryActionIds);

  const catalog = {
    protocolVersion: 1,
    commandNames,
    registryActionIds,
    targetIdPattern: targetIdPattern.source,
    isSupportedCommandName(value) {
      return typeof value === "string" && commandNameSet.has(value);
    },
    isSupportedRegistryActionId(value) {
      return typeof value === "string" && registryActionIdSet.has(value);
    },
    isSupportedTargetId(value) {
      return typeof value === "string" && targetIdPattern.test(value);
    },
  };

  Object.defineProperty(window, "MXSCastGuiActionCatalog", {
    value: Object.freeze(catalog),
    writable: false,
    configurable: false,
  });
})();

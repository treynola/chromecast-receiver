(function installCastSessionBinding(window) {
  "use strict";

  class CastSessionBinding {
    static canCommit({ socketOpen, handshakeAcked, bridgeConfigReady, buildIdentityAccepted, nonce }) {
      return Boolean(
        socketOpen && handshakeAcked && bridgeConfigReady && buildIdentityAccepted &&
        CastSessionBinding.validNonce(nonce),
      );
    }

    static networkEpoch(currentValue, value) {
      const current = Number(currentValue) || 0;
      const next = Number(value);
      const legacy = value === undefined || value === null || next === 0;
      if (legacy && current === 0) return { accepted: true, current, next: current, changed: false, legacy: true };
      if (!Number.isSafeInteger(next) || next <= 0 || (current > 0 && next < current)) {
        return { accepted: false, current, next, changed: false, legacy: false };
      }
      return { accepted: true, current, next, changed: next > current, legacy: false };
    }

    static validNonce(value) {
      return typeof value === "string" && value.length >= 8 && value.length <= 128;
    }

    static revision(config, nonce, sampleRate) {
      if (typeof config?.bridgeConfigRevision === "string" && config.bridgeConfigRevision.length > 0) {
        return config.bridgeConfigRevision;
      }
      return [
        nonce,
        config?.credentialGeneration || 0,
        config?.networkEpoch || 0,
        sampleRate || 48000,
        config?.pcmProtocol?.sessionId || "legacy",
      ].join(":");
    }

    static evaluate(config, previousNonce, previousRevision, fallbackRate) {
      const nonce = config?.guiSessionNonce;
      if (!CastSessionBinding.validNonce(nonce)) return { valid: false };
      const revision = CastSessionBinding.revision(
        config,
        nonce,
        config?.config?.sampleRate || fallbackRate,
      );
      const sessionChanged = previousNonce !== nonce;
      return {
        valid: true,
        nonce,
        revision,
        sessionChanged,
        duplicate: !sessionChanged && previousRevision === revision,
      };
    }
  }

  window.MXSCastSessionBinding = CastSessionBinding;
})(window);

// Minimal same-origin AudioWorklet capability probe.
// The production receiver loads this before the PCM player so unsupported
// Chromecast runtimes can select native playout without repeated retries.
class MXSReceiverCapabilityProbe extends AudioWorkletProcessor {
  process() {
    return false;
  }
}

registerProcessor("mxs-receiver-capability-probe", MXSReceiverCapabilityProbe);

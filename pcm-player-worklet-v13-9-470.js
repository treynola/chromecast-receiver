/* global AudioWorkletProcessor, registerProcessor */
/**
 * PCM Player AudioWorkletProcessor - TV-Side Resampling [v13-9-470]
 *
 * [v13-9-470] APORv2 Stability Overhaul:
 *  - Reduced _TARGET_BUFFER to 24000 (250ms) for lower perceptible lag.
 *  - Reduced _FLUSH_THRESHOLD to 48000 (500ms) to aggressively prevent lag buildup.
 *  - Reduced P-controller gain (kp) to 5e-7 for smoother, non-warbling pitch correction.
 *  - Capped rate adjustment to +/- 0.8% (was 4%) to make clock-sync inaudible.
 *  - Increased rate smoothing (0.98/0.02) to eliminate "drunk" pitch hunting.
 */
class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // 8 seconds of stereo @ 48kHz = 768,000 samples — generous ring buffer
    this._ringLen = 48000 * 2 * 8;
    this._ringBuffer = new Int16Array(this._ringLen);
    this._writePtr = 0;
    this._readFrameIdx = 0;  // integer frame index (each frame = 2 Int16 samples: L+R)
    this._readFrac = 0;      // sub-frame interpolation fraction [0, 1)
    this._totalWritten = 0;
    this._totalRead = 0;

    this._studioRate = options.processorOptions?.studioRate || 48000;
    this._baseRate = options.processorOptions?.baseRateRatio || 1.0;
    this._playbackRate = this._baseRate;

    // Jitter-Buffer Targets (sample counts, stereo pairs = frames*2)
    // [v13-9-470] Tightened for lower latency
    this._TARGET_BUFFER = 24000; // 250ms operating target
    this._MIN_BUFFER = 4800;     // 50ms stall threshold
    this._PREBUFFER = 19200;     // 200ms warm-up before first play
    this._FLUSH_THRESHOLD = 48000; // 500ms — aggressive safety flush

    this._isBuffering = true;
    this._stallCount = 0;
    this._sampleCount = 0;
    this._currentPeak = 0;
    this._fade = 1.0;
    this._bitDepth = options.processorOptions?.bitDepth || 16;
    this._smoothedError = 0;

    // Telemetry
    this._callbackCount = 0;
    this._lastCallbackTime = 0;
    this._framesProcessed = 0;

    this._testBeepActive = false;
    this._testBeepPhase = 0;

    this.port.onmessage = (e) => {
      try {
        if (e.data && e.data.type === "RESET") {
          this._ringBuffer.fill(0);
          this._writePtr = 0;
          this._readFrameIdx = 0;
          this._readFrac = 0;
          this._totalWritten = 0;
          this._totalRead = 0;
          this._isBuffering = true;
          this._stallCount = 0;
          this._sampleCount = 0;
          this._currentPeak = 0;
          this._fade = 1.0;
          this._smoothedError = 0;
          this._testBeepActive = false;
          this._testBeepPhase = 0;
          this.port.postMessage({ type: "LOG", msg: "🔄 Worklet: State reset complete." });
          return;
        }

        if (e.data && e.data.type === "TEST_BEEP") {
          this._testBeepActive = true;
          this._testBeepPhase = 0;
          this._testBeepFramesLeft = Math.round(48000 * 0.5); // 500ms
          this.port.postMessage({ type: "LOG", msg: "🔊 Worklet: TEST_BEEP started (1kHz, 500ms)." });
          return;
        }

        if (e.data && e.data.type === "CONFIG") {
          if (e.data.bitDepth) {
            this._bitDepth = e.data.bitDepth;
            this.port.postMessage({ type: "LOG", msg: `🔧 Worklet: Bit depth set to ${this._bitDepth}-bit` });
          }
          if (e.data.baseRateRatio) {
            this._baseRate = e.data.baseRateRatio;
            this._playbackRate = this._baseRate;
            this.port.postMessage({ type: "LOG", msg: `🔄 Worklet: Base rate ratio set to ${this._baseRate.toFixed(4)}` });
          }
          return;
        }

        const arrayBuffer = e.data instanceof ArrayBuffer ? e.data : e.data.buffer;
        if (!arrayBuffer) return;

        const ringLen = this._ringLen;
        let writePtr = this._writePtr;
        let samplesDecoded = 0;

        if (this._bitDepth === 24) {
          const bytes = new Uint8Array(arrayBuffer);
          const numSamples = Math.floor(bytes.length / 3);
          for (let i = 0; i < numSamples; i++) {
            const offset = i * 3;
            let val = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
            if (val & 0x800000) val |= 0xff000000;
            this._ringBuffer[writePtr] = val >> 8;
            writePtr++;
            if (writePtr >= ringLen) writePtr = 0;
          }
          samplesDecoded = numSamples;
        } else {
          const pcm16 = new Int16Array(arrayBuffer);
          const len = pcm16.length;
          if (writePtr + len <= ringLen) {
            this._ringBuffer.set(pcm16, writePtr);
            writePtr += len;
          } else {
            const firstPart = ringLen - writePtr;
            this._ringBuffer.set(pcm16.subarray(0, firstPart), writePtr);
            this._ringBuffer.set(pcm16.subarray(firstPart), 0);
            writePtr = len - firstPart;
          }
          samplesDecoded = len;
        }
        this._writePtr = writePtr;
        this._totalWritten += samplesDecoded;
      } catch (err) {
        this.port.postMessage({ type: "LOG", msg: `❌ Worklet Error: ${err.message}` });
      }
    };
  }

  process(inputs, outputs) {
    try {
      const output = outputs[0];
      if (!output || output.length === 0) return true;
      const channel0 = output[0];
      const channel1 = output[1] || channel0;

      if (!channel0) return true;

      const ringLen = this._ringLen;
      const ringLenFrames = ringLen >> 1; 
      const now = currentTime;

      this._callbackCount++;
      if (!this._lastCallbackTime) this._lastCallbackTime = now;
      this._framesProcessed += channel0.length;

      // TEST_BEEP handler
      if (this._testBeepActive) {
        const freq = 1000;
        const phaseInc = (2 * Math.PI * freq) / 48000;
        for (let i = 0; i < channel0.length; i++) {
          const s = Math.sin(this._testBeepPhase) * 0.25;
          channel0[i] = s;
          channel1[i] = s;
          this._testBeepPhase += phaseInc;
          if (this._testBeepPhase > 2 * Math.PI) this._testBeepPhase -= 2 * Math.PI;
          this._testBeepFramesLeft--;
          if (this._testBeepFramesLeft <= 0) {
            this._testBeepActive = false;
            this.port.postMessage({ type: "LOG", msg: "🔊 Worklet: TEST_BEEP complete." });
            for (let j = i + 1; j < channel0.length; j++) { channel0[j] = 0; channel1[j] = 0; }
            break;
          }
        }
        return true;
      }

      let available = Math.round(this._totalWritten - this._totalRead);

      // RING OVERRUN
      if (available > ringLen) {
        const skip = available - this._TARGET_BUFFER;
        this._totalRead += skip;
        this._readFrameIdx = ((this._writePtr >> 1) - (this._TARGET_BUFFER >> 1) + ringLenFrames) % ringLenFrames;
        this._readFrac = 0;
        available = this._TARGET_BUFFER;
        this._smoothedError = 0;
        this.port.postMessage({ type: "LOG", msg: "⚠️ Ring Overrun: Recovered." });
      }

      // LATENCY CATCH-UP: flush excess above FLUSH_THRESHOLD
      // [v13-9-470] Flush threshold lowered to 500ms to aggressively prevent lag.
      if (available > this._FLUSH_THRESHOLD) {
        const flushTarget = this._TARGET_BUFFER;
        const excess = available - flushTarget;
        this._totalRead += excess;
        const excessFrames = excess >> 1;
        this._readFrameIdx = (this._readFrameIdx + excessFrames) % ringLenFrames;
        this._readFrac = 0;
        available = flushTarget;
        this._smoothedError = 0;
        this.port.postMessage({ type: "LOG", msg: `⚠️ Latency Catch-up: Flushed ${excess} excess samples.` });
      }

      // PRE-BUFFER
      if (this._isBuffering) {
        if (available >= this._PREBUFFER) {
          this._isBuffering = false;
          this._smoothedError = 0;
          if (available > this._TARGET_BUFFER) {
            const excess = available - this._TARGET_BUFFER;
            this._totalRead += excess;
            const excessFrames = excess >> 1;
            this._readFrameIdx = (this._readFrameIdx + excessFrames) % ringLenFrames;
            this._readFrac = 0;
            available = this._TARGET_BUFFER;
            this.port.postMessage({ type: "LOG", msg: `⚡ Startup: Trimmed ${excess} samples.` });
          }
        } else {
          channel0.fill(0);
          channel1.fill(0);
          return true;
        }
      }

      // STALL DETECTION
      if (available < this._MIN_BUFFER) {
        this._stallCount++;
        this._isBuffering = true;
        this._smoothedError = 0;
        this._fade = 0;
        channel0.fill(0);
        channel1.fill(0);
        this.port.postMessage({ type: "LOG", msg: "⚠️ TV Stall: Buffering started." });
        return true;
      }

      // P-CONTROLLER
      // [v13-9-470] kp reduced to 5e-7 for gentler, non-warbling pitch adjustment.
      const rawError = available - this._TARGET_BUFFER;
      this._smoothedError = this._smoothedError * 0.98 + rawError * 0.02;
      
      const kp = 0.0000005;
      const adjustment = this._smoothedError * kp;
      // [v13-9-470] Adjustment cap reduced to 0.8% (from 4%) to make shifts sub-audible.
      const targetRate = this._baseRate * (1.0 + Math.max(-0.008, Math.min(0.008, adjustment)));
      
      // [v13-9-470] Smoothing increased to 0.98 to eliminate pitch hunting ("drunk" sound).
      this._playbackRate = this._playbackRate * 0.98 + targetRate * 0.02;
      this._playbackRate = Math.max(this._baseRate * 0.99, Math.min(this._baseRate * 1.01, this._playbackRate));

      // RENDER LOOP
      let frameIdx = this._readFrameIdx;
      let frac = this._readFrac;
      const playbackRate = this._playbackRate;
      let fade = this._fade;
      const INV_32768 = 3.0517578125e-5;
      const is1x = Math.abs(playbackRate - 1.0) < 0.0001;

      let samplesConsumedExact = 0;

      for (let i = 0; i < channel0.length; i++) {
        if (available - (samplesConsumedExact >> 1) * 2 >= 4) {
          const idxL1 = frameIdx * 2;

          if (is1x) {
            channel0[i] = this._ringBuffer[idxL1]     * INV_32768 * fade;
            channel1[i] = this._ringBuffer[idxL1 + 1] * INV_32768 * fade;
            frac += 1.0;
          } else {
            let idxL2 = idxL1 + 2;
            if (idxL2 >= ringLen) idxL2 -= ringLen;

            const vL1 = this._ringBuffer[idxL1];
            const vR1 = this._ringBuffer[idxL1 + 1];
            const scale = INV_32768 * fade;

            channel0[i] = (vL1 + (this._ringBuffer[idxL2]     - vL1) * frac) * scale;
            channel1[i] = (vR1 + (this._ringBuffer[idxL2 + 1] - vR1) * frac) * scale;
            frac += playbackRate;
          }

          const wholeFrac = frac | 0;
          if (wholeFrac > 0) {
            frameIdx = (frameIdx + wholeFrac) % ringLenFrames;
            frac -= wholeFrac;
            samplesConsumedExact += wholeFrac * 2;
          }

          if (fade < 1.0) fade = Math.min(1.0, fade + 0.02);

          if (i === 0) {
            const p = Math.abs(channel0[i]);
            if (p > this._currentPeak) this._currentPeak = p;
          }
        } else {
          if (fade > 0) fade = Math.max(0, fade - 0.05);
          channel0[i] = 0;
          channel1[i] = 0;
        }
      }

      this._readFrameIdx = frameIdx;
      this._readFrac = frac;
      this._totalRead += samplesConsumedExact;
      this._fade = fade;

      // TELEMETRY
      if (this._framesProcessed >= 144000) {
        const currentAvailable = Math.round(this._totalWritten - this._totalRead);
        const elapsed = now - this._lastCallbackTime;
        const measuredHz = elapsed > 0 ? this._callbackCount / elapsed : 375;
        const rateDev = ((this._playbackRate / this._baseRate) - 1.0) * 100;

        this.port.postMessage({
          type: "DIAG",
          available: currentAvailable,
          stalled: this._stallCount,
          peak: this._currentPeak,
          rate: this._playbackRate,
          rateDev: parseFloat(rateDev.toFixed(4)), 
          locked: Math.abs(this._smoothedError) < 12000,
          measuredHz: Math.round(measuredHz),
        });
        this._currentPeak = 0;
        this._framesProcessed = 0;
        this._callbackCount = 0;
        this._lastCallbackTime = now;
      }

      return true;
    } catch (err) {
      this.port.postMessage({
        type: "LOG",
        msg: `❌ Worklet process() Exception: ${err.message} \n ${err.stack}`
      });
      return false; 
    }
  }
}

registerProcessor("pcm-player-worklet", PCMPlayerProcessor);
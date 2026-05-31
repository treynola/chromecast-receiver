/* global AudioWorkletProcessor, registerProcessor */
/**
 * PCM Player AudioWorkletProcessor - TV-Side Resampling [v13-9-472]
 *
 * [v13-9-472] APORv2.1 "Analog Sync" Overhaul:
 *  - Increased _TARGET_BUFFER to 48000 (500ms) for high-latency stability on jittery WiFi.
 *  - Increased _FLUSH_THRESHOLD to 96000 (1000ms) to allow more breathing room.
 *  - Reduced P-gain (kp) to 2e-7 for extremely gentle, "analog-feel" clock recovery.
 *  - Increased Smoothing to 0.995: pitch changes now take ~5 seconds, making them inaudible.
 *  - Removed Rate-Reset on Flush: Maintains clock velocity to stop the "pendulum" effect.
 *  - Optimized Linear Interpolator: Pure unity-gain pass-through when rate is exactly 1.0.
 */
class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // 10 seconds of stereo @ 48kHz = 960,000 samples
    this._ringLen = 48000 * 2 * 10;
    this._ringBuffer = new Int16Array(this._ringLen);
    this._writePtr = 0;
    this._readFrameIdx = 0;
    this._readFrac = 0;
    this._totalWritten = 0;
    this._totalRead = 0;

    this._studioRate = options.processorOptions?.studioRate || 48000;
    this._baseRate = options.processorOptions?.baseRateRatio || 1.0;
    this._playbackRate = this._baseRate;

    // Jitter-Buffer Targets (sample counts, stereo pairs = frames*2)
    // [v13-9-472] High-Stability Targets
    this._TARGET_BUFFER = 48000; // 500ms operating target (Safe for WiFi)
    this._MIN_BUFFER = 9600;     // 100ms stall threshold
    this._PREBUFFER = 38400;     // 400ms warm-up before first play
    this._FLUSH_THRESHOLD = 96000; // 1000ms — safety flush

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
          this._playbackRate = this._baseRate;
          this._testBeepActive = false;
          this._testBeepPhase = 0;
          this.port.postMessage({ type: "LOG", msg: "🔄 Worklet: State reset complete." });
          return;
        }

        if (e.data && e.data.type === "TEST_BEEP") {
          this._testBeepActive = true;
          this._testBeepPhase = 0;
          this._testBeepFramesLeft = Math.round(48000 * 0.5); // 500ms
          return;
        }

        if (e.data && e.data.type === "CONFIG") {
          if (e.data.bitDepth) {
            this._bitDepth = e.data.bitDepth;
          }
          if (e.data.baseRateRatio) {
            this._baseRate = e.data.baseRateRatio;
            this._playbackRate = this._baseRate;
            this._smoothedError = 0;
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

      // LATENCY CATCH-UP
      if (available > this._FLUSH_THRESHOLD) {
        const flushTarget = this._TARGET_BUFFER;
        const excess = available - flushTarget;
        this._totalRead += excess;
        const excessFrames = excess >> 1;
        this._readFrameIdx = (this._readFrameIdx + excessFrames) % ringLenFrames;
        this._readFrac = 0;
        available = flushTarget;
        // [v13-9-472] RESET error but KEEP playbackRate to maintain velocity
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
      // [v13-9-472] deadzone + ultra-low gain
      const DEADZONE = 2400; // ~50ms
      const rawError = available - this._TARGET_BUFFER;
      this._smoothedError = this._smoothedError * 0.99 + rawError * 0.01;
      
      let error = this._smoothedError;
      if (Math.abs(error) < DEADZONE) error = 0;

      const kp = 0.0000002; // [v13-9-472] Analog gain (2e-7)
      const adjustment = error * kp;
      // +/- 0.4% cap for extreme transparency
      const targetRate = this._baseRate * (1.0 + Math.max(-0.004, Math.min(0.004, adjustment)));
      
      // [v13-9-472] Ultra-slow smoothing (0.995)
      this._playbackRate = this._playbackRate * 0.995 + targetRate * 0.005;
      this._playbackRate = Math.max(this._baseRate * 0.992, Math.min(this._baseRate * 1.008, this._playbackRate));

      // RENDER LOOP
      let frameIdx = this._readFrameIdx;
      let frac = this._readFrac;
      const playbackRate = this._playbackRate;
      let fade = this._fade;
      const INV_32768 = 3.0517578125e-5;
      const is1x = Math.abs(playbackRate - 1.0) < 0.00001;

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

        this.port.postMessage({
          type: "DIAG",
          available: currentAvailable,
          stalled: this._stallCount,
          peak: this._currentPeak,
          rate: this._playbackRate,
          locked: Math.abs(this._smoothedError) < 24000,
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
        msg: `❌ Worklet process() Exception: ${err.message}`
      });
      return false; 
    }
  }
}

registerProcessor("pcm-player-worklet", PCMPlayerProcessor);
/* global AudioWorkletProcessor, registerProcessor, currentTime */
/**
 * PCM Player AudioWorkletProcessor - TV-Side Resampling [v13-9-476]
 *
 * [v13-9-476] APORv2.4 "Concrete Sync" Overhaul:
 *  - INCREASED: _TARGET_BUFFER to 48000 (500ms) for rock-solid stability on jittery WiFi.
 *  - INCREASED: _FLUSH_THRESHOLD to 72000 (750ms).
 *  - ULTRA-SLOW Correction: Increased smoothing to 0.999. Pitch changes take ~10 seconds.
 *  - REDUCED: Max correction cap to +/- 0.4% (was 0.5%) for near-perfect pitch transparency.
 *  - OPTIMIZED: Pure unity-gain pass-through when rate is exactly 1.0.
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
    this._playbackRate = 1.0;

    // v13-9-476: Concrete Stability Targets
    this._TARGET_BUFFER = 48000; // 500ms target (Safe Mode)
    this._MIN_BUFFER = 9600;      // 100ms stall threshold
    this._PREBUFFER = 38400;      // 400ms pre-fill
    this._FLUSH_THRESHOLD = 72000; // 750ms hard limit

    this._isBuffering = true;
    this._stallCount = 0;
    this._currentPeak = 0;
    this._fade = 1.0;
    this._bitDepth = options.processorOptions?.bitDepth || 16;
    this._smoothedError = 0;

    this._framesProcessed = 0;
    this._callbackCount = 0;
    this._lastCallbackTime = 0;

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
          this._smoothedError = 0;
          this._playbackRate = 1.0;
          this.port.postMessage({ type: "LOG", msg: "🔄 Worklet: Concrete Reset." });
          return;
        }

        const arrayBuffer = e.data instanceof ArrayBuffer ? e.data : e.data.buffer;
        if (!arrayBuffer) return;

        const pcm16 = new Int16Array(arrayBuffer);
        const len = pcm16.length;
        const ringLen = this._ringLen;
        let writePtr = this._writePtr;

        if (writePtr + len <= ringLen) {
          this._ringBuffer.set(pcm16, writePtr);
          writePtr += len;
        } else {
          const firstPart = ringLen - writePtr;
          this._ringBuffer.set(pcm16.subarray(0, firstPart), writePtr);
          this._ringBuffer.set(pcm16.subarray(firstPart), 0);
          writePtr = len - firstPart;
        }
        this._writePtr = writePtr;
        this._totalWritten += len;
      } catch (err) {
        this.port.postMessage({ type: "LOG", msg: `❌ Worklet Error: ${err.message}` });
      }
    };
  }

  process(inputs, outputs) {
    try {
      const output = outputs[0];
      const channel0 = output?.[0];
      const channel1 = output?.[1] || channel0;
      if (!channel0) return true;

      const ringLen = this._ringLen;
      const ringLenFrames = ringLen >> 1; 
      const framesInBlock = channel0.length;
      const now = currentTime;

      if (!this._lastCallbackTime) this._lastCallbackTime = now;
      this._callbackCount++;

      let available = Math.round(this._totalWritten - this._totalRead);

      // 1. HARD OVERRUN PROTECTION
      if (available > ringLen) {
        const skip = available - this._TARGET_BUFFER;
        this._totalRead += skip;
        this._readFrameIdx = ((this._writePtr >> 1) - (this._TARGET_BUFFER >> 1) + ringLenFrames) % ringLenFrames;
        available = this._TARGET_BUFFER;
        this._smoothedError = 0;
      }

      // 2. AGGRESSIVE FLUSH
      if (available > this._FLUSH_THRESHOLD) {
        const excess = available - this._TARGET_BUFFER;
        this._totalRead += excess;
        this._readFrameIdx = (this._readFrameIdx + (excess >> 1)) % ringLenFrames;
        available = this._TARGET_BUFFER;
        this._smoothedError = 0;
        this._playbackRate = 1.0; 
        this.port.postMessage({ type: "LOG", msg: `⚠️ Quartz: Lag-Flush (${excess} samples).` });
      }

      // 3. PRE-BUFFERING
      if (this._isBuffering) {
        if (available >= this._PREBUFFER) {
          this._isBuffering = false;
          this._smoothedError = 0;
        } else {
          channel0.fill(0);
          channel1.fill(0);
          return true;
        }
      }

      // 4. STALL PROTECTION
      if (available < this._MIN_BUFFER) {
        this._isBuffering = true;
        this._smoothedError = 0;
        this._fade = 0;
        this._stallCount++;
        channel0.fill(0);
        channel1.fill(0);
        return true;
      }

      // 5. CONCRETE-LOCK P-CONTROLLER
      const rawError = available - this._TARGET_BUFFER;
      this._smoothedError = this._smoothedError * 0.99 + rawError * 0.01;
      
      const QUARTZ_DEADZONE = 4800; // 100ms tolerance (Concrete Mode)
      const kp = 0.0000001; 
      
      let targetRate = 1.0;
      if (Math.abs(this._smoothedError) > QUARTZ_DEADZONE) {
         // Ultra-sub-audible pitch correction (+/- 0.4% cap)
         targetRate = 1.0 + Math.max(-0.004, Math.min(0.004, this._smoothedError * kp));
      }
      
      // [v13-9-476] Ultra-Smoothing (0.999): Correction takes 10+ seconds
      this._playbackRate = this._playbackRate * 0.999 + targetRate * 0.001;
      
      const playbackRate = this._playbackRate;
      let frameIdx = this._readFrameIdx;
      let frac = this._readFrac;
      let fade = this._fade;
      const INV_32768 = 3.0517578125e-5;

      // 6. HIGH-EFFICIENCY RENDERER
      const isUnity = Math.abs(playbackRate - 1.0) < 0.00001;
      let consumed = 0;

      for (let i = 0; i < framesInBlock; i++) {
        if (available - consumed >= 4) {
          const idxL1 = frameIdx * 2;
          const scale = INV_32768 * fade;

          if (isUnity) {
            channel0[i] = this._ringBuffer[idxL1]     * scale;
            channel1[i] = this._ringBuffer[idxL1 + 1] * scale;
            frameIdx = (frameIdx + 1) % ringLenFrames;
            consumed += 2;
          } else {
            let idxL2 = idxL1 + 2;
            if (idxL2 >= ringLen) idxL2 -= ringLen;
            const vL1 = this._ringBuffer[idxL1];
            const vR1 = this._ringBuffer[idxL1 + 1];
            channel0[i] = (vL1 + (this._ringBuffer[idxL2]     - vL1) * frac) * scale;
            channel1[i] = (vR1 + (this._ringBuffer[idxL2 + 1] - vR1) * frac) * scale;
            
            frac += playbackRate;
            const advance = frac | 0;
            if (advance > 0) {
              frameIdx = (frameIdx + advance) % ringLenFrames;
              frac -= advance;
              consumed += advance * 2;
            }
          }
          if (fade < 1.0) fade = Math.min(1.0, fade + 0.01);
          if (i === 0) this._currentPeak = Math.max(this._currentPeak, Math.abs(channel0[i]));
        } else {
          channel0[i] = 0;
          channel1[i] = 0;
        }
      }

      this._readFrameIdx = frameIdx;
      this._readFrac = frac;
      this._totalRead += consumed;
      this._fade = fade;

      // 7. TELEMETRY (2-second interval)
      this._framesProcessed += framesInBlock;
      if (this._framesProcessed >= 96000) { 
        const currentAvailable = Math.round(this._totalWritten - this._totalRead);
        const elapsed = now - this._lastCallbackTime;
        const measuredHz = elapsed > 0 ? this._callbackCount / elapsed : 375;

        this.port.postMessage({
          type: "DIAG",
          available: currentAvailable,
          stalled: this._stallCount,
          peak: this._currentPeak,
          rate: playbackRate,
          locked: isUnity,
          measuredHz: Math.round(measuredHz),
        });
        this._currentPeak = 0;
        this._framesProcessed = 0;
        this._callbackCount = 0;
        this._lastCallbackTime = now;
      }

      return true;
    } catch (err) {
      this.port.postMessage({ type: "LOG", msg: `❌ Worklet Exception: ${err.message}` });
      return false; 
    }
  }
}
registerProcessor("pcm-player-worklet", PCMPlayerProcessor);
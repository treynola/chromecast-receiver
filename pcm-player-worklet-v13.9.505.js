/* global AudioWorkletProcessor, registerProcessor, currentTime, sampleRate */
/**
 * pcm-player-worklet.js
 * [v13.9.504] CONCRETE SYNC - High-Stability PCM Playout
 */

class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._ringLen = 192000; // 2 seconds of stereo 48kHz
    this._ringBuffer = new Int16Array(this._ringLen);
    this._writePtr = 0;
    this._readFrameIdx = 0;
    this._readFrac = 0;
    this._totalWritten = 0;
    this._totalRead = 0;

    this._studioRate = options.processorOptions?.studioRate || 48000;
    this._baseRate = options.processorOptions?.baseRateRatio || 1.0;

    // Jitter-Adaptive buffer parameters for ultra-low latency playout
    this._TARGET_BUFFER = 7680;      // Start at 80ms target (3840 frames)
    this._MIN_BUFFER = 1920;        // ~20ms stall threshold (960 frames)
    this._PREBUFFER = 3840;         // ~40ms pre-fill cushion (1920 frames)
    this._FLUSH_THRESHOLD = 19200;  // Trim severe backlog (>200ms) instantly

    this._isBuffering = true;
    this._stallCount = 0;
    this._currentPeak = 0;
    this._fade = 1.0;
    this._bitDepth = options.processorOptions?.bitDepth || 16;

    this._framesProcessed = 0;
    this._callbackCount = 0;
    this._startTime = 0; // [v13.9.504] Local worklet timer for accurate Hz reporting
    this._realStartTime = 0; // [v13.9.507] Wall-clock timer using real-world milliseconds
    this._stableCallbackCount = 0;
    this._smoothedRate = this._baseRate;

    this.port.onmessage = (e) => {
      try {
        if (e.data && typeof e.data.type === "string") {
          this.port.postMessage({ type: "LOG", msg: `📥 Worklet message: ${e.data.type}` });
        } else {
          if (!this._binLogCount) this._binLogCount = 0;
          if (this._binLogCount < 10) {
            this._binLogCount++;
            this.port.postMessage({
              type: "LOG",
              msg: `📥 Worklet binary recv: type=${typeof e.data} constr=${e.data && e.data.constructor ? e.data.constructor.name : "null"} byteLen=${e.data ? e.data.byteLength : "n/a"}`
            });
          }
        }

        if (e.data && e.data.type === "RESET") {
          this._ringBuffer.fill(0);
          this._writePtr = 0;
          this._readFrameIdx = 0;
          this._readFrac = 0;
          this._totalWritten = 0;
          this._totalRead = 0;
          this._isBuffering = true;
          this._framesProcessed = 0;
          this._startTime = 0;
          this._realStartTime = 0;
          this._stableCallbackCount = 0;
          this._TARGET_BUFFER = 7680;
          this._MIN_BUFFER = 1920;
          this._PREBUFFER = 3840;
          this._FLUSH_THRESHOLD = 19200;
          this._smoothedRate = this._baseRate;
          this.port.postMessage({ type: "LOG", msg: "🔄 Worklet: State reset complete." });
          return;
        }
        if (e.data && e.data.type === "CONFIG") {
          if (e.data.bitDepth) this._bitDepth = e.data.bitDepth;
          if (e.data.baseRateRatio) this._baseRate = e.data.baseRateRatio;
          return;
        }

        let arrayBuffer = null;
        if (e.data) {
          if (e.data instanceof ArrayBuffer || typeof e.data.byteLength === "number") {
            arrayBuffer = e.data;
          } else if (e.data.buffer && (e.data.buffer instanceof ArrayBuffer || typeof e.data.buffer.byteLength === "number")) {
            arrayBuffer = e.data.buffer;
          }
        }
        if (!arrayBuffer) return;

        if (this._bitDepth === 24) {
          const bytes = new Uint8Array(arrayBuffer);
          const numSamples = Math.floor(bytes.length / 3);
          for (let i = 0; i < numSamples; i++) {
            const offset = i * 3;
            let val = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
            if (val & 0x800000) val |= 0xFF000000;
            this._ringBuffer[this._writePtr] = val >> 8;
            this._writePtr = (this._writePtr + 1) % this._ringLen;
            this._totalWritten++;
          }
        } else {
          const pcm16 = new Int16Array(arrayBuffer);
          const len = pcm16.length;
          if (this._writePtr + len <= this._ringLen) {
            this._ringBuffer.set(pcm16, this._writePtr);
            this._writePtr = (this._writePtr + len) % this._ringLen;
          } else {
            const firstPart = this._ringLen - this._writePtr;
            this._ringBuffer.set(pcm16.subarray(0, firstPart), this._writePtr);
            this._ringBuffer.set(pcm16.subarray(firstPart), 0);
            this._writePtr = len - firstPart;
          }
          this._totalWritten += len;
        }
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

      if (this._startTime === 0) {
        this._startTime = now;
        this._realStartTime = Date.now();
      }
      this._callbackCount++;

      let available = Math.round(this._totalWritten - this._totalRead);
      let consumed = 0;

      // 1. HARD OVERRUN PROTECTION
      if (available > ringLen) {
        const skip = available - this._TARGET_BUFFER;
        this._totalRead += skip;
        this._readFrameIdx = ((this._writePtr >> 1) - (this._TARGET_BUFFER >> 1) + ringLenFrames) % ringLenFrames;
        available = this._TARGET_BUFFER;
      }

      // 2. AGGRESSIVE FLUSH
      if (available > this._FLUSH_THRESHOLD) {
        const excess = available - this._TARGET_BUFFER;
        this._totalRead += excess;
        this._readFrameIdx = (this._readFrameIdx + (excess >> 1)) % ringLenFrames;
        available = this._TARGET_BUFFER;
        this._fade = 0; // Quick fade-in after the jump to eliminate transient clicks/pops
        this.port.postMessage({ type: "LOG", msg: `⚠️ Quartz: Lag-Flush (${excess} samples).` });
      }

      // Soft drift correction: speed adjustments proportional to buffer error.
      const bufferError = available - this._TARGET_BUFFER;
      let correction = 0;
      if (Math.abs(bufferError) > 960) { // 10ms dead-zone to prevent constant rate updates
        // Proportional speed correction: max 1.5% speed adjustment for faster convergence
        const errorRatio = bufferError / this._TARGET_BUFFER;
        correction = Math.max(-0.015, Math.min(0.015, errorRatio * 0.05));
      }
      // Smooth the playback rate transitions (0.995 / 0.005) for glitch-free pitching (~500ms time constant)
      this._smoothedRate = (this._smoothedRate * 0.995) + ((this._baseRate + correction) * 0.005);

      // Snap to exactly 1.0 if very close to minimize floating point interpolation CPU overhead
      if (Math.abs(this._smoothedRate - 1.0) < 0.0005) {
        this._smoothedRate = 1.0;
      }
      const playbackRate = Math.max(0.95, Math.min(1.05, this._smoothedRate));

      let renderSilence = false;

      // 3. PRE-BUFFERING
      if (this._isBuffering) {
        if (available >= this._PREBUFFER) {
          this._isBuffering = false;
          this._startTime = now;
          this._realStartTime = Date.now();
          this._framesProcessed = 0;
        } else {
          renderSilence = true;
        }
      }

      // 4. STALL PROTECTION
      if (!renderSilence && available < this._MIN_BUFFER) {
        this._isBuffering = true;
        this._fade = 0;
        this._stallCount++;

        // Adaptive Buffer Scale Up: Increase target buffer by 20ms (1920 samples), max 250ms (24000 samples)
        this._TARGET_BUFFER = Math.min(24000, this._TARGET_BUFFER + 1920);
        this._MIN_BUFFER = Math.max(1920, this._TARGET_BUFFER >> 2); // 25% of target
        this._PREBUFFER = Math.max(2880, this._TARGET_BUFFER >> 1); // 50% of target
        this._FLUSH_THRESHOLD = Math.min(76800, this._TARGET_BUFFER * 2.5); // 2.5x target

        this.port.postMessage({
          type: "LOG",
          msg: `⚠️ TV Stall detected! Scaling target buffer to ${Math.round(this._TARGET_BUFFER / 96)}ms.`
        });

        renderSilence = true;
      }

      if (renderSilence) {
        channel0.fill(0);
        channel1.fill(0);
        this._stableCallbackCount = 0;
      } else {
        let frameIdx = this._readFrameIdx;
        let frac = this._readFrac;
        let fade = this._fade;
        const INV_32768 = 3.0517578125e-5;
        const INV_8388608 = 1.1920928955078125e-7;

        if (playbackRate === 1.0 && frac === 0) {
          // Optimized fast-path: direct samples lookup
          const scale = INV_32768 * fade;
          for (let i = 0; i < framesInBlock; i++) {
            if (available - consumed >= 2) {
              const idxL = frameIdx * 2;
              channel0[i] = this._ringBuffer[idxL] * scale;
              channel1[i] = this._ringBuffer[idxL + 1] * scale;
              frameIdx = (frameIdx + 1) % ringLenFrames;
              consumed += 2;
              if (fade < 1.0) {
                fade += 0.01;
                if (fade > 1.0) fade = 1.0;
              }
            } else {
              channel0[i] = 0;
              channel1[i] = 0;
            }
          }
          if (framesInBlock > 0) {
            this._currentPeak = Math.abs(channel0[0]);
          }
        } else {
          // Standard linear interpolation fallback
          for (let i = 0; i < framesInBlock; i++) {
            if (available - consumed >= 2) {
              const idxL1 = frameIdx * 2;
              const nextFrameIdx = (frameIdx + 1) % ringLenFrames;
              const idxL2 = nextFrameIdx * 2;
              const scale = INV_32768 * fade;
              channel0[i] = (this._ringBuffer[idxL1] + ((this._ringBuffer[idxL2] - this._ringBuffer[idxL1]) * frac)) * scale;
              channel1[i] = (this._ringBuffer[idxL1 + 1] + ((this._ringBuffer[idxL2 + 1] - this._ringBuffer[idxL1 + 1]) * frac)) * scale;
              frac += playbackRate;
              while (frac >= 1.0) {
                frac -= 1.0;
                frameIdx = (frameIdx + 1) % ringLenFrames;
                consumed += 2;
              }
              if (fade < 1.0) {
                fade += 0.01;
                if (fade > 1.0) fade = 1.0;
              }
              if (i === 0) this._currentPeak = Math.abs(channel0[i]);
            } else {
              channel0[i] = 0;
              channel1[i] = 0;
            }
          }
        }

        this._readFrameIdx = frameIdx;
        this._readFrac = frac;
        this._totalRead += consumed;
        this._fade = fade;
        this._framesProcessed += framesInBlock;

        // Adaptive Buffer Scale Down on Stability
        this._stableCallbackCount++;
        if (this._stableCallbackCount > 5000) {
          this._stableCallbackCount = 0;
          if (this._TARGET_BUFFER > 4800) { // minimum 50ms (4800 samples)
            this._TARGET_BUFFER = Math.max(4800, this._TARGET_BUFFER - 960); // decay by 10ms (960 samples)
            this._MIN_BUFFER = Math.max(1920, this._TARGET_BUFFER >> 2);
            this._PREBUFFER = Math.max(2880, this._TARGET_BUFFER >> 1);
            this._FLUSH_THRESHOLD = Math.min(76800, this._TARGET_BUFFER * 2.5);
            this.port.postMessage({
              type: "LOG",
              msg: `📉 TV Buffer stable. Decaying target buffer to ${Math.round(this._TARGET_BUFFER / 96)}ms.`
            });
          }
        }
      }

      if (this._callbackCount % 120 === 0) {
        const elapsed = Math.max(0.1, now - this._startTime);
        const realElapsed = Math.max(0.1, (Date.now() - this._realStartTime) / 1000);
        const lockWindow = Math.max(6000, this._TARGET_BUFFER >> 2);
        this.port.postMessage({
          type: "DIAG",
          available: available,
          stalled: this._stallCount,
          rate: playbackRate,
          measuredHz: Math.round(this._framesProcessed / realElapsed), // [v13.9.507] Wall-clock tracking
          peak: this._currentPeak,
          locked: !renderSilence && Math.abs(available - this._TARGET_BUFFER) <= lockWindow
        });
        this._currentPeak = 0;
      }
    } catch (err) {
      this.port.postMessage({ type: "LOG", msg: `❌ Process Error: ${err.message}` });
    }
    return true;
  }
}

registerProcessor("pcm-player-worklet", PCMPlayerProcessor);

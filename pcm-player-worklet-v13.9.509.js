/* global AudioWorkletProcessor, registerProcessor, currentTime, sampleRate */
/**
 * pcm-player-worklet.js
 * [v13.9.505] CONCRETE SYNC - High-Stability PCM Playout
 */

class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    this._ringLen = 192000; // 2 seconds of stereo 48kHz
    this._ringBuffer = new Int16Array(this._ringLen);
    this._writePtr = 0;
    this._readFrameIdx = 0;
    this._readFrac = 0;
    this._totalWritten = 0;
    this._totalRead = 0;

    this._studioRate = options.processorOptions?.studioRate || 48000;

    // Keep the queue centered around a few hundred milliseconds of headroom.
    // Stereo sample counts:
    // - 16384 = 8192 frames (~171ms)
    // - 20480 = 10240 frames (~213ms)
    // - 32768 = 16384 frames (~341ms)
    // - 49152 = 24576 frames (~512ms)
    // - 65536 = 32768 frames (~683ms)
    // This keeps the receiver stable on Chromecast-class devices without
    // letting the queue drift back into multi-second backlog.
    this._TARGET_BUFFER = 32768;
    this._MIN_BUFFER = 16384;
    this._PREBUFFER = 32768;
    this._FLUSH_THRESHOLD = 122880;
    this._DIAG_INTERVAL_CALLBACKS = 60; // ~160ms intervals (60 * 128 / 48000)
    this._lastPacketWallMs = 0;

    this._isBuffering = true;
    this._stallCount = 0;
    this._currentPeak = 0;
    this._fade = 1.0;
    this._bitDepth = options.processorOptions?.bitDepth === 24 ? 24 : 16;

    this._framesProcessed = 0;
    this._callbackCount = 0;
    this._startTime = 0; // [v13.9.504] Local worklet timer for accurate Hz reporting
    this._wallStartMs = 0;
    this._lastDiagWallMs = 0;
    this._lastDiagFramesProcessed = 0;

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
          this._callbackCount = 0;
          this._startTime = 0;
          this._wallStartMs = 0;
          this._lastDiagWallMs = 0;
          this._lastDiagFramesProcessed = 0;
          this._TARGET_BUFFER = 32768;
          this._MIN_BUFFER = 16384;
          this._PREBUFFER = 32768;
          this._FLUSH_THRESHOLD = 122880;
          this._DIAG_INTERVAL_CALLBACKS = 60;
          this._stallCount = 0;
          this._currentPeak = 0;
          this._fade = 1.0;
          this._lastPacketWallMs = 0;
          this.port.postMessage({ type: "LOG", msg: "🔄 Worklet: State reset complete." });
          return;
        }
        if (e.data && e.data.type === "CONFIG") {
          if (e.data.bitDepth) this._bitDepth = e.data.bitDepth === 24 ? 24 : 16;
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

        const packetWallMs = typeof Date !== "undefined" ? Date.now() : 0;
        this._lastPacketWallMs = packetWallMs || this._lastPacketWallMs;

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

  _reanchorReadCursor(targetSamples = this._TARGET_BUFFER) {
    const ringLenFrames = this._ringLen >> 1;
    const target = Math.max(0, Math.min(targetSamples & ~1, this._ringLen));
    const targetFrames = target >> 1;
    this._totalRead = Math.max(0, this._totalWritten - target);
    this._readFrameIdx = ((this._writePtr >> 1) - targetFrames + ringLenFrames) % ringLenFrames;
    this._readFrac = 0;
    return target;
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
      const wallNow = typeof Date !== "undefined" ? Date.now() : 0;

      if (this._startTime === 0) {
        this._startTime = now;
      }
      if (this._wallStartMs === 0 && wallNow) {
        this._wallStartMs = wallNow;
        this._lastDiagWallMs = wallNow;
        this._lastDiagFramesProcessed = 0;
      }
      this._callbackCount++;

      let frameIdx = this._readFrameIdx;
      let frac = this._readFrac;
      let available = Math.round(this._totalWritten - this._totalRead);
      let consumed = 0;

      // 1. HARD OVERRUN PROTECTION
      if (available > ringLen) {
        available = this._reanchorReadCursor(this._TARGET_BUFFER);
        frameIdx = this._readFrameIdx;
        frac = this._readFrac;
      }

      // 2. SEVERE BACKLOG GUARD
      if (available > this._FLUSH_THRESHOLD) {
        const beforeFlush = available;
        const dropped = available - this._TARGET_BUFFER;
        available = this._reanchorReadCursor(this._TARGET_BUFFER);
        frameIdx = this._readFrameIdx;
        frac = this._readFrac;
        this._fade = 0; // Quick fade-in after the jump to eliminate transient clicks/pops
        
        // Keep telemetry time running across lag flushes. The backend needs a
        // continuous wall-clock drain estimate to lock its resampler target.

        this.port.postMessage({
          type: "LOG",
          msg: `⚠️ Quartz: Lag-Flush available=${beforeFlush} target=${this._TARGET_BUFFER} threshold=${this._FLUSH_THRESHOLD} dropped=${dropped}`
        });
      }

      let renderSilence = false;

      // 3. PRE-BUFFERING
      if (this._isBuffering) {
        if (available >= this._PREBUFFER) {
          this._isBuffering = false;
        } else {
          renderSilence = true;
        }
      }

      // 4. STALL PROTECTION
      if (!renderSilence && available < this._MIN_BUFFER) {
        this._isBuffering = true;
        this._fade = 0;
        this._stallCount++;

        this.port.postMessage({
          type: "LOG",
          msg: `⚠️ Receiver Stall detected! Rebuffering at ${Math.round((this._TARGET_BUFFER / 2) / this._studioRate * 1000)}ms target.`
        });

        renderSilence = true;
      }

      // Use a small catch-up rate when the live queue is high. This keeps the
      // buffer from drifting into lag-flush territory without audible warble.
      const backlogSamples = Math.max(0, available - this._TARGET_BUFFER);
      const playbackRate = backlogSamples >= 65536
        ? 1.005
        : backlogSamples >= 49152
          ? 1.003
          : 1.0;

      if (renderSilence) {
        channel0.fill(0);
        channel1.fill(0);
      } else {
        let fade = this._fade;
        const INV_32768 = 3.0517578125e-5;

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
        // Keep the receiver target fixed. The previous adaptive shrink/expand loop
        // created audible oscillation on Chromecast-class receivers.
      }

      this._framesProcessed += framesInBlock;

      if (this._callbackCount % this._DIAG_INTERVAL_CALLBACKS === 0) {
        const elapsed = Math.max(0.1, now - this._startTime);
        const wallElapsed = this._wallStartMs && wallNow ? Math.max(0.1, (wallNow - this._wallStartMs) / 1000) : 0;
        const lockWindow = Math.max(4096, this._TARGET_BUFFER >> 1);
        // Report drain rate from the most recent DIAG interval so the backend can
        // lock quickly even while the buffer is oscillating around lag flushes.
        let wallHzReported = 0;
        if (this._lastDiagWallMs && wallNow) {
          const deltaWallMs = wallNow - this._lastDiagWallMs;
          const deltaFrames = this._framesProcessed - this._lastDiagFramesProcessed;
          if (deltaWallMs >= 250 && deltaFrames > 0) {
            wallHzReported = Math.round((deltaFrames * 1000) / deltaWallMs);
            this._lastDiagWallMs = wallNow;
            this._lastDiagFramesProcessed = this._framesProcessed;
          }
        } else {
          this._lastDiagWallMs = wallNow;
          this._lastDiagFramesProcessed = this._framesProcessed;
        }
        const hzReported = wallHzReported;
        this.port.postMessage({
          type: "DIAG",
          available: available,
          stalled: this._stallCount,
          rate: playbackRate,
          measuredHz: hzReported,
          wallHz: wallHzReported,
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

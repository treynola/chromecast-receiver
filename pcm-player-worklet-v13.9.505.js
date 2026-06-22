/* global AudioWorkletProcessor, registerProcessor, currentTime, sampleRate */
/**
 * pcm-player-worklet.js
 * [v13.9.504] CONCRETE SYNC - High-Stability PCM Playout
 */

class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._ringLen = 192000; // 2 seconds of stereo 48kHz
    this._ringBuffer = new Float32Array(this._ringLen);
    this._writePtr = 0;
    this._readFrameIdx = 0;
    this._readFrac = 0;
    this._totalWritten = 0;
    this._totalRead = 0;

    this._studioRate = options.processorOptions?.studioRate || 48000;
    this._baseRate = options.processorOptions?.baseRateRatio || 1.0;

    // Keep the receiver close to a modest fixed latency without continuously
    // warping playback speed, which creates audible wobble on long sessions.
    this._TARGET_BUFFER = 36000;   // ~375ms target: lower latency without forcing rate warble
    this._MIN_BUFFER = 8000;       // ~83ms stall threshold
    this._PREBUFFER = 12000;       // ~125ms pre-fill for faster startup
    this._FLUSH_THRESHOLD = 96000;  // ~1.0s guard rail

    this._isBuffering = true;
    this._stallCount = 0;
    this._currentPeak = 0;
    this._fade = 1.0;
    this._bitDepth = options.processorOptions?.bitDepth || 16;

    this._framesProcessed = 0;
    this._callbackCount = 0;
    this._startTime = 0; // [v13.9.504] Local worklet timer for accurate Hz reporting

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
            this._ringBuffer[this._writePtr] = val;
            this._writePtr = (this._writePtr + 1) % this._ringLen;
            this._totalWritten++;
          }
        } else {
          const pcm16 = new Int16Array(arrayBuffer);
          for (let i = 0; i < pcm16.length; i++) {
            this._ringBuffer[this._writePtr] = pcm16[i];
            this._writePtr = (this._writePtr + 1) % this._ringLen;
            this._totalWritten++;
          }
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
      const playbackRate = this._baseRate;

      const ringLen = this._ringLen;
      const ringLenFrames = ringLen >> 1; 
      const framesInBlock = channel0.length;
      const now = currentTime;

      if (this._startTime === 0) this._startTime = now;
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
        this.port.postMessage({ type: "LOG", msg: `⚠️ Quartz: Lag-Flush (${excess} samples).` });
      }

      let renderSilence = false;

      // 3. PRE-BUFFERING
      if (this._isBuffering) {
        if (available >= this._PREBUFFER) {
          this._isBuffering = false;
          this._startTime = now;
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
        renderSilence = true;
      }

      if (renderSilence) {
        channel0.fill(0);
        channel1.fill(0);
      } else {
        let frameIdx = this._readFrameIdx;
        let fade = this._fade;
        const INV_32768 = 3.0517578125e-5;
        const INV_8388608 = 1.1920928955078125e-7;

        for (let i = 0; i < framesInBlock; i++) {
          if (available - consumed >= 2) {
            const idxL1 = frameIdx * 2;
            const scale = (this._bitDepth === 24 ? INV_8388608 : INV_32768) * fade;
            channel0[i] = this._ringBuffer[idxL1]     * scale;
            channel1[i] = this._ringBuffer[idxL1 + 1] * scale;
            frameIdx = (frameIdx + 1) % ringLenFrames;
            consumed += 2;
            if (fade < 1.0) fade = Math.min(1.0, fade + 0.01);
            if (i === 0) this._currentPeak = Math.max(this._currentPeak, Math.abs(channel0[i]));
          } else {
            channel0[i] = 0;
            channel1[i] = 0;
          }
        }

        this._readFrameIdx = frameIdx;
        this._totalRead += consumed;
        this._fade = fade;
        this._framesProcessed += framesInBlock;
      }

      if (this._callbackCount % 120 === 0) {
        const elapsed = Math.max(0.1, now - this._startTime);
        const lockWindow = Math.max(12000, this._TARGET_BUFFER >> 2);
        this.port.postMessage({
          type: "DIAG",
          available: available,
          stalled: this._stallCount,
          rate: playbackRate,
          measuredHz: Math.round(this._framesProcessed / elapsed), // [v13.9.504] Real clock tracking
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

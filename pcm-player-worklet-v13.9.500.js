/* global AudioWorkletProcessor, registerProcessor, currentTime, sampleRate */
/**
 * pcm-player-worklet.js
 * [v13.9.500] CONCRETE SYNC - High-Stability PCM Playout
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
    this._playbackRate = 1.0;

    // [v13.9.500] CONCRETE SYNC: Jitter-Resilient Targets
    this._TARGET_BUFFER = 38400; // 400ms target
    this._MIN_BUFFER = 9600;      // 100ms stall threshold
    this._PREBUFFER = 28800;      // 300ms pre-fill
    this._FLUSH_THRESHOLD = 67200; // 700ms limit

    this._isBuffering = true;
    this._stallCount = 0;
    this._currentPeak = 0;
    this._fade = 1.0;
    this._bitDepth = options.processorOptions?.bitDepth || 16;
    this._smoothedError = 0;

    this._framesProcessed = 0;
    this._callbackCount = 0;
    this._startTime = 0; // [v13.9.500] Local worklet timer for accurate Hz reporting

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

        const arrayBuffer = e.data instanceof ArrayBuffer ? e.data : e.data.buffer;
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

      const ringLen = this._ringLen;
      const ringLenFrames = ringLen >> 1; 
      const framesInBlock = channel0.length;
      const now = currentTime;

      if (this._startTime === 0) this._startTime = now;
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

      // 5. QUARTZ-LOCK P-CONTROLLER (Aggressive Sync 13.9.495)
      const rawError = available - this._TARGET_BUFFER;
      this._smoothedError = this._smoothedError * 0.99 + rawError * 0.01;
      
      const QUARTZ_DEADZONE = 4800; // 100ms tolerance
      const kp = 0.000005; // [v13.9.500] 25x stronger gain than v494
      
      let targetRate = 1.0;
      if (Math.abs(this._smoothedError) > QUARTZ_DEADZONE) {
         // Sub-audible pitch correction (+/- 1.0% cap)
         targetRate = 1.0 + Math.max(-0.01, Math.min(0.01, this._smoothedError * kp));
      }
      
      // Smooth transition
      this._playbackRate = this._playbackRate * 0.995 + (targetRate * this._baseRate) * 0.005;
      
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
      this._framesProcessed += framesInBlock;

      if (this._callbackCount % 120 === 0) {
        const elapsed = Math.max(0.1, now - this._startTime);
        this.port.postMessage({
          type: "DIAG",
          available: available,
          stalled: this._stallCount,
          rate: playbackRate,
          measuredHz: Math.round(this._framesProcessed / elapsed), // [v13.9.500] Real clock tracking
          peak: this._currentPeak,
          locked: Math.abs(this._smoothedError) < QUARTZ_DEADZONE
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

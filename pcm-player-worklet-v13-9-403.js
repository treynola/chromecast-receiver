/* global AudioWorkletProcessor, registerProcessor */
/**
 * PCM Player AudioWorkletProcessor - TV-Side Resampling [v13.9.404]
 * High-Performance direct-copy ring buffer with dynamic local playbackRate adjustment.
 * High-Fidelity Proportional-Integral (PI) clock synchronization loop with strict bounds.
 * [v13.9.404] Tuned for Chromecast: reduced flush threshold, more aggressive PI controller.
 */
class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // 8 seconds of stereo @ 48kHz = 768,000 samples — generous ring buffer
    this._ringLen = 48000 * 2 * 8;
    this._ringBuffer = new Float32Array(this._ringLen);
    this._writePtr = 0;
    this._readPtr = 0;
    this._totalWritten = 0;
    this._totalRead = 0;

    this._studioRate = options.processorOptions?.studioRate || 48000;
    this._baseRate = options.processorOptions?.baseRateRatio || 1.0;
    this._playbackRate = this._baseRate;

    // Jitter-Buffer Targets (sample counts, 48kHz stereo)
    this._TARGET_BUFFER = 28800; // 300ms operating target
    this._MIN_BUFFER = 4800; // 50ms stall threshold
    this._PREBUFFER = 24000; // 250ms warm-up before first play
    this._FLUSH_THRESHOLD = 57600; // [v13.9.404] 600ms — reduced from 800ms to catch overruns earlier

    this._isBuffering = true;
    this._stallCount = 0;
    this._sampleCount = 0;
    this._currentPeak = 0;
    this._fade = 1.0;
    this._bitDepth = options.processorOptions?.bitDepth || 16;

    // Jitter-Buffer error tracking and PI Loop
    this._smoothedError = 0;
    this._integral = 0;

    // Telemetry trackers
    this._callbackCount = 0;
    this._lastCallbackTime = 0;

    this.port.onmessage = (e) => {
      try {
        if (e.data && e.data.type === "RESET") {
          this._ringBuffer.fill(0);
          this._writePtr = 0;
          this._readPtr = 0;
          this._totalWritten = 0;
          this._totalRead = 0;
          this._isBuffering = true;
          this._stallCount = 0;
          this._sampleCount = 0;
          this._currentPeak = 0;
          this._fade = 1.0;
          this._smoothedError = 0;
          this._integral = 0;
          this.port.postMessage({
            type: "LOG",
            msg: `🔄 Worklet: State reset complete.`,
          });
          return;
        }
        if (e.data && e.data.type === "CONFIG") {
          if (e.data.bitDepth) {
            this._bitDepth = e.data.bitDepth;
            this.port.postMessage({
              type: "LOG",
              msg: `🔧 Worklet: Bit depth set to ${this._bitDepth}-bit`,
            });
          }
          if (e.data.baseRateRatio) {
            this._baseRate = e.data.baseRateRatio;
            this._playbackRate = this._baseRate;
            this.port.postMessage({
              type: "LOG",
              msg: `🔄 Worklet: Base rate ratio set to ${this._baseRate.toFixed(4)}`,
            });
          }
          return;
        }

        const arrayBuffer =
          e.data instanceof ArrayBuffer ? e.data : e.data.buffer;
        if (!arrayBuffer) return;

        const ringLen = this._ringLen;
        let writePtr = this._writePtr;
        let samplesDecoded = 0;
        const INV_32768 = 3.0517578125e-5;

        if (this._bitDepth === 24) {
          const bytes = new Uint8Array(arrayBuffer);
          const numSamples = Math.floor(bytes.length / 3);
          for (let i = 0; i < numSamples; i++) {
            const offset = i * 3;
            let val =
              bytes[offset] |
              (bytes[offset + 1] << 8) |
              (bytes[offset + 2] << 16);
            if (val & 0x800000) val |= 0xff000000;
            this._ringBuffer[writePtr] = (val >> 8) * INV_32768;
            writePtr++;
            if (writePtr >= ringLen) writePtr = 0;
          }
          samplesDecoded = numSamples;
        } else {
          const pcm16 = new Int16Array(arrayBuffer);
          const len = pcm16.length;
          for (let i = 0; i < len; i++) {
            this._ringBuffer[writePtr] = pcm16[i] * INV_32768;
            writePtr++;
            if (writePtr >= ringLen) writePtr = 0;
          }
          samplesDecoded = len;
        }
        this._writePtr = writePtr;
        this._totalWritten += samplesDecoded;
      } catch (err) {
        this.port.postMessage({
          type: "LOG",
          msg: `❌ Worklet Error: ${err.message}`,
        });
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const channel0 = output[0];
    const channel1 = output[1];

    if (!channel0 || !channel1) return true;

    const ringLen = this._ringLen;
    const now = Date.now();

    this._callbackCount++;
    if (!this._lastCallbackTime) this._lastCallbackTime = now;

    // POINTER-BASED buffer size
    let available = this._totalWritten - this._totalRead;

    // Clamp to ring buffer size
    if (available > ringLen) {
      const skip = available - this._TARGET_BUFFER;
      this._totalRead += skip;
      this._readPtr = this._writePtr - this._TARGET_BUFFER;
      while (this._readPtr < 0) this._readPtr += ringLen;
      available = this._TARGET_BUFFER;
      this._smoothedError = 0;
      this.port.postMessage({
        type: "LOG",
        msg: `⚠️ Ring Overrun: Recovered.`,
      });
    }

    // LATENCY CATCH-UP [v13.9.404] Flush to TARGET + 25% headroom, not exactly TARGET
    if (available > this._FLUSH_THRESHOLD) {
      const flushTarget = Math.floor(this._TARGET_BUFFER * 1.25);
      const excess = available - flushTarget;
      this._totalRead += excess;
      this._readPtr += excess;
      while (this._readPtr >= ringLen) this._readPtr -= ringLen;
      available = flushTarget;
      this._smoothedError = 0;
      this.port.postMessage({
        type: "LOG",
        msg: `⚠️ Latency Catch-up: Flushed ${excess} excess.`,
      });
    }

    // PRE-BUFFER
    if (this._isBuffering) {
      if (available >= this._PREBUFFER) {
        this._isBuffering = false;
        this._smoothedError = 0;
        if (available > this._TARGET_BUFFER) {
          const excess = available - this._TARGET_BUFFER;
          this._totalRead += excess;
          this._readPtr += excess;
          while (this._readPtr >= ringLen) this._readPtr -= ringLen;
          available = this._TARGET_BUFFER;
          this.port.postMessage({
            type: "LOG",
            msg: `⚡ Startup: Trimmed ${excess} samples.`,
          });
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
      this._fade = 0;
      channel0.fill(0);
      channel1.fill(0);
      this.port.postMessage({
        type: "LOG",
        msg: `⚠️ TV Stall: Buffering started.`,
      });
      return true;
    }

    // [v13.9.410] ROBUST RESAMPLING ENGINE: Use a low-pass filter (0.95/0.05) on the
    // measuredHz telemetry to prevent transient spikes from causing the 'yo-yo' pitch effect.
    const rawHz = this._framesProcessed / ((now - this._lastCallbackTime) / 1000);
    this._measuredHzFilter = (this._measuredHzFilter || 48000) * 0.95 + rawHz * 0.05;
    
    // Recalculate playbackRate based on the smoothed Hz
    const effectiveHz = Math.max(10000, Math.min(100000, this._measuredHzFilter));
    const targetPlaybackRate = this._studioRate / effectiveHz;
    
    // Very slow adaptation to maintain pitch stability
    this._playbackRate = this._playbackRate * 0.999 + targetPlaybackRate * 0.001;

    // RENDER LOOP (Nearest-Neighbor interpolation for maximum performance)
    let readPtrFrames = this._readPtr / 2;
    let samplesConsumed = 0;
    const playbackRate = this._playbackRate;
    let fade = this._fade;
    const ringLenFrames = ringLen / 2;
    const INV_32768 = 3.0517578125e-5;

    for (let i = 0; i < channel0.length; i++) {
      if (available - samplesConsumed >= 4) {
        // Nearest-Neighbor interpolation
        const frameIndex = Math.round(readPtrFrames) | 0;
        const idxL1 = (frameIndex * 2) % ringLen;

        channel0[i] = this._ringBuffer[idxL1] * INV_32768 * fade;
        channel1[i] = this._ringBuffer[idxL1 + 1] * INV_32768 * fade;

        readPtrFrames += playbackRate;
        if (readPtrFrames >= ringLenFrames) readPtrFrames -= ringLenFrames;
        samplesConsumed += 2 * playbackRate;

        if (fade < 1.0) fade += 0.02;

        if (i === 0) {
           const peak = Math.abs(channel0[i]);
           if (peak > this._currentPeak) this._currentPeak = peak;
        }
      } else {
        if (fade > 0) fade -= 0.05;
        channel0[i] = 0;
        channel1[i] = 0;
      }
    }

    this._readPtr = readPtrFrames * 2;
    this._totalRead += samplesConsumed;
    this._fade = fade;
    this._framesProcessed = (this._framesProcessed || 0) + channel0.length;

    // Reporting and Diag-Timer
    if (this._framesProcessed >= 24000) {
      const currentAvailable = this._totalWritten - this._totalRead;
      this.port.postMessage({
        type: "DIAG",
        available: Math.floor(currentAvailable),
        stalled: this._stallCount,
        peak: this._currentPeak,
        rate: this._playbackRate,
        locked: Math.abs(currentAvailable - this._TARGET_BUFFER) < 5000,
        measuredHz: Math.round(this._measuredHzFilter),
      });
      this._currentPeak = 0;
      this._framesProcessed = 0;
      this._lastCallbackTime = now;
    }

    return true;

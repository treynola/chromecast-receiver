/* global AudioWorkletProcessor, registerProcessor */
/**
 * PCM Player AudioWorkletProcessor - TV-Side Resampling [v13.9.403]
 * High-Performance direct-copy ring buffer with dynamic local playbackRate adjustment.
 * High-Fidelity Proportional-Integral (PI) clock synchronization loop with strict bounds.
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
    this._TARGET_BUFFER = 19200; // 200ms operating target
    this._MIN_BUFFER = 4800; // 50ms stall threshold
    this._PREBUFFER = 14400; // 150ms warm-up before first play
    this._FLUSH_THRESHOLD = 57600; // 600ms — hard flush ceiling

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

    // LATENCY CATCH-UP
    if (available > this._FLUSH_THRESHOLD) {
      const excess = available - this._TARGET_BUFFER;
      this._totalRead += excess;
      this._readPtr += excess;
      while (this._readPtr >= ringLen) this._readPtr -= ringLen;
      available = this._TARGET_BUFFER;
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

    // High-Fidelity Clock-Drift PI Controller with Strict Safety Bounds
    const rawError = available - this._TARGET_BUFFER;
    // Slow error filter (99.5% old, 0.5% new) to eliminate short-term network jitter from rate adjustments
    this._smoothedError = this._smoothedError * 0.995 + rawError * 0.005;

    let pAdj = 0;
    let iAdj = 0;

    const DEADBAND = 960; // ±10ms deadband @ 48kHz stereo to prevent micro-adjustments
    if (Math.abs(this._smoothedError) > DEADBAND) {
      const overage =
        this._smoothedError > 0
          ? this._smoothedError - DEADBAND
          : this._smoothedError + DEADBAND;

      // Conservative Proportional Gain (1.5e-7)
      pAdj = overage * 0.00000015;

      // Gentle Integral accumulation
      this._integral += overage * 0.0000000001; // extremely slow drift tracking
    } else {
      // Decay integral slowly inside deadband to prevent drift buildup
      this._integral *= 0.99;
    }

    // Clamp integral and proportional terms to prevent audible pitch offsets
    const MAX_I_ADJ = 0.0015; // Max 0.15% pitch correction from long-term drift
    const MAX_P_ADJ = 0.0015; // Max 0.15% pitch correction from short-term errors
    this._integral = Math.max(-MAX_I_ADJ, Math.min(MAX_I_ADJ, this._integral));
    pAdj = Math.max(-MAX_P_ADJ, Math.min(MAX_P_ADJ, pAdj));
    iAdj = this._integral;

    // targetRate is baseRate plus PI adjustments
    const targetRate = this._baseRate + pAdj + iAdj;

    // Tight hard ceiling: Never allow rate to swing beyond ±0.5% (inaudible 8 cents threshold)
    const absoluteMinRate = this._baseRate * 0.995;
    const absoluteMaxRate = this._baseRate * 1.005;
    const safeTargetRate = Math.max(absoluteMinRate, Math.min(absoluteMaxRate, targetRate));

    // Smooth playback rate transition to prevent phase shifts or audio clicking
    this._playbackRate = this._playbackRate * 0.99 + safeTargetRate * 0.01;

    // RENDER LOOP (Linear Interpolation)
    let readPtrFrames = this._readPtr / 2;
    let samplesConsumed = 0;
    const playbackRate = this._playbackRate;
    let fade = this._fade;
    const ringLenFrames = ringLen / 2;

    for (let i = 0; i < channel0.length; i++) {
      if (available - samplesConsumed >= 4) {
        const frameIndex = readPtrFrames | 0;
        const frac = readPtrFrames - frameIndex;

        const idxL1 = frameIndex * 2;
        let idxL2 = idxL1 + 2;
        if (idxL2 >= ringLen) idxL2 -= ringLen;

        const valL =
          this._ringBuffer[idxL1] * (1 - frac) + this._ringBuffer[idxL2] * frac;
        const valR =
          this._ringBuffer[idxL1 + 1] * (1 - frac) +
          this._ringBuffer[idxL2 + 1] * frac;

        readPtrFrames += playbackRate;
        if (readPtrFrames >= ringLenFrames) readPtrFrames -= ringLenFrames;

        samplesConsumed += 2 * playbackRate;

        if (fade < 1.0) fade += 0.02;

        channel0[i] = valL * fade;
        channel1[i] = valR * fade;

        const absL = valL < 0 ? -valL : valL;
        const absR = valR < 0 ? -valR : valR;
        const peak = absL > absR ? absL : absR;
        if (peak > this._currentPeak) this._currentPeak = peak;
      } else {
        if (fade > 0) fade -= 0.05;
        channel0[i] = 0;
        channel1[i] = 0;
      }
    }

    this._readPtr = readPtrFrames * 2;
    this._totalRead += samplesConsumed;
    this._fade = fade;

    this._sampleCount += 128;
    if (this._sampleCount >= 48000) {
      const currentAvailable = this._totalWritten - this._totalRead;
      const elapsed = (now - this._lastCallbackTime) / 1000;
      const measuredHz =
        elapsed > 0 ? (this._callbackCount * 128) / elapsed : 48000;

      this.port.postMessage({
        type: "DIAG",
        available: Math.floor(currentAvailable),
        stalled: this._stallCount,
        peak: this._currentPeak,
        rate: this._playbackRate,
        locked: Math.abs(this._smoothedError) < 12000,
        measuredHz: Math.round(measuredHz),
      });
      this._currentPeak = 0;
      this._sampleCount = 0;
      this._callbackCount = 0;
      this._lastCallbackTime = now;
    }

    return true;
  }
}

registerProcessor("pcm-player-worklet", PCMPlayerProcessor);

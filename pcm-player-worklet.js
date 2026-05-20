/* global AudioWorkletProcessor, registerProcessor, sampleRate */
/**
 * PCM Player AudioWorkletProcessor - Direct Handshake Engine [v13.9.360]
 * [v13.9.360] POINTER-BASED RING BUFFER — eliminates thread-race buffer drift.
 * Optimized render loop using division-free frame-based indexing.
 * Stable 5s-window base rate calibration — immune to per-callback jitter.
 */
class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // 8 seconds of stereo @ 48kHz = 768,000 samples — generous ring buffer
    this._ringBuffer = new Float32Array(48000 * 2 * 8);
    this._writePtr = 0;  // Sample index (written by onmessage)
    this._readPtr = 0;   // Sample index (advanced by process)
    this._totalWritten = 0; // Monotonic write counter (never wraps)
    this._totalRead = 0;    // Monotonic read counter (never wraps)
    
    // [v13.9.27] DYNAMIC RATE ALIGNMENT
    this._studioRate = options.processorOptions?.studioRate || 48000;
    this._baseRate = options.processorOptions?.baseRateRatio || 1.0;
    this._playbackRate = this._baseRate;
    
    // Jitter-Buffer Targets (sample counts, 48kHz stereo)
    this._TARGET_BUFFER = 19200;   // 200ms operating target
    this._MIN_BUFFER = 4800;       // 50ms stall threshold
    this._PREBUFFER = 14400;       // 150ms warm-up before first play
    this._FLUSH_THRESHOLD = 57600;  // 600ms — hard flush ceiling (clears main-thread decoding backlogs instantly)
    
    this._isBuffering = true;
    this._stallCount = 0;
    this._sampleCount = 0;
    this._currentPeak = 0;
    this._fade = 1.0;
    
    // PI Controller
    this._smoothedError = 0;
    this._integralError = 0;

    // Telemetry and Calibration trackers
    this._callbackCount = 0;
    this._lastCallbackTime = 0;
    // Clamp calibration to ±20% around the initial ratio — never let it go off-rails
    this._baseRateInitial = this._baseRate;
    this._baseRateMin = this._baseRate * 0.80;
    this._baseRateMax = this._baseRate * 1.20;
    this._calibrationCount = 0; // how many 5s windows have calibrated

    this.port.onmessage = (e) => {
      try {
        const arrayBuffer = (e.data instanceof ArrayBuffer) ? e.data : e.data.buffer;
        if (!arrayBuffer) return;
        
        const pcm16 = new Int16Array(arrayBuffer);
        const ringLen = this._ringBuffer.length;
        
        let writePtr = this._writePtr;
        const INV_32768 = 0.000030517578125;
        for (let i = 0; i < pcm16.length; i++) {
          this._ringBuffer[writePtr] = pcm16[i] * INV_32768;
          writePtr++;
          if (writePtr >= ringLen) writePtr = 0;
        }
        this._writePtr = writePtr;
        this._totalWritten += pcm16.length;
      } catch (err) {
        this.port.postMessage({ type: 'LOG', msg: `❌ Worklet Error: ${err.message}` });
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const channel0 = output[0];
    const channel1 = output[1];

    if (!channel0 || !channel1) return true;

    const ringLen = this._ringBuffer.length;
    const now = Date.now();

    // 1. Callback Rate Telemetry & Stable-Window Calibration
    // Count callbacks per 5-second window — far more stable than per-callback deltas
    // which are wildly jittery on resource-constrained Chromecast CPUs.
    this._callbackCount++;
    if (!this._lastCallbackTime) this._lastCallbackTime = now;
    if (now - this._lastCallbackTime >= 5000) {
      const elapsed = (now - this._lastCallbackTime) / 1000;
      const measuredHz = this._callbackCount / elapsed;

      // Compute a new candidate baseRate from the stable window
      // actualSampleRate = how many samples the TV actually consumed in this window
      const actualSampleRate = measuredHz * 128;
      const candidateRate = this._studioRate / actualSampleRate;

      // Clamp candidate to safe band — never let it spiral outside ±20% of initial
      const clampedRate = Math.max(this._baseRateMin, Math.min(this._baseRateMax, candidateRate));

      // Only apply after first window (first measurement may be stale startup counts)
      if (this._calibrationCount > 0) {
        // Blend 80% old, 20% new — smooth adaptation, robust against one-off bad windows
        this._baseRate = this._baseRate * 0.8 + clampedRate * 0.2;
        // Also re-clamp after blend
        this._baseRate = Math.max(this._baseRateMin, Math.min(this._baseRateMax, this._baseRate));
      }
      this._calibrationCount++;

      this.port.postMessage({ type: 'LOG', msg: `📊 Callback Rate: ${measuredHz.toFixed(1)} Hz (expected: ${(sampleRate / 128).toFixed(1)} Hz) | BaseRate: ${this._baseRate.toFixed(4)} (candidate: ${candidateRate.toFixed(4)})` });
      this._callbackCount = 0;
      this._lastCallbackTime = now;
    }

    // POINTER-BASED buffer size: immune to thread race conditions
    let available = this._totalWritten - this._totalRead;
    // Clamp to ring buffer size (if write lapped read, we lost data)
    if (available > ringLen) {
      // Write pointer lapped read pointer — skip ahead to avoid garbled playback
      const skip = available - this._TARGET_BUFFER;
      this._totalRead += skip;
      this._readPtr = this._writePtr;
      // Walk readPtr back by TARGET_BUFFER samples
      this._readPtr -= this._TARGET_BUFFER;
      if (this._readPtr < 0) this._readPtr += ringLen;
      available = this._TARGET_BUFFER;
      this._smoothedError = 0;
      this._integralError = 0;
      this.port.postMessage({ type: 'LOG', msg: `⚠️ Ring Overrun: Recovered. Available reset to ${available}.` });
    }

    // LATENCY CATCH-UP
    if (available > this._FLUSH_THRESHOLD) {
      const excess = available - this._TARGET_BUFFER;
      this._totalRead += excess;
      this._readPtr += excess;
      while (this._readPtr >= ringLen) this._readPtr -= ringLen;
      available = this._TARGET_BUFFER;
      this._smoothedError = 0;
      this._integralError = 0;
      this.port.postMessage({ type: 'LOG', msg: `⚠️ Latency Catch-up: Flushed ${excess} excess. Integral reset.` });
    }

    // PRE-BUFFER
    if (this._isBuffering) {
      if (available >= this._PREBUFFER) {
        this._isBuffering = false;
        this._smoothedError = 0;
        this._integralError = 0;
        // Trim excess above target on startup
        if (available > this._TARGET_BUFFER) {
          const excess = available - this._TARGET_BUFFER;
          this._totalRead += excess;
          this._readPtr += excess;
          while (this._readPtr >= ringLen) this._readPtr -= ringLen;
          available = this._TARGET_BUFFER;
          this.port.postMessage({ type: 'LOG', msg: `⚡ Startup: Trimmed ${excess} samples.` });
        }
      } else {
        return true;
      }
    }

    // STALL DETECTION
    if (available < this._MIN_BUFFER) {
      this._stallCount++;
      this._isBuffering = true;
      this._fade = 0;
      this._integralError = 0;
      return true;
    }

    // PI CONTROLLER — continuous, active drift tracking [v13.9.380]
    const rawError = available - this._TARGET_BUFFER;
    // Moderate error smoothing to prevent reaction to micro-jitter
    this._smoothedError = (this._smoothedError * 0.99) + (rawError * 0.01);

    // Strict limits for high-fidelity audio: max 1.5% adjustment to prevent audible pitch shifts
    const MAX_ADJUST = 0.015;
    
    // P gain: 1.5e-6 (at 10,000 error, proportional correction is 0.015, which hits the clamp)
    let pAdj = this._smoothedError * 0.0000015;
    
    // I gain: 1.5e-9 to integrate out steady-state clock drift
    this._integralError += this._smoothedError * 0.0000000015;
    
    // Anti-windup leakage
    this._integralError *= 0.9995;
    
    // Clamp component adjustments to MAX_ADJUST
    this._integralError = Math.max(-MAX_ADJUST, Math.min(MAX_ADJUST, this._integralError));
    pAdj = Math.max(-MAX_ADJUST, Math.min(MAX_ADJUST, pAdj));
    
    const targetRate = this._baseRate + pAdj + this._integralError;
    const clampedTargetRate = Math.max(this._baseRate - MAX_ADJUST, Math.min(this._baseRate + MAX_ADJUST, targetRate));

    // Heavy low-pass filter on playbackRate to make all adjustments completely inaudible
    this._playbackRate = (this._playbackRate * 0.995) + (clampedTargetRate * 0.005);

    // RENDER LOOP
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

        const valL = this._ringBuffer[idxL1] * (1 - frac) + this._ringBuffer[idxL2] * frac;
        const valR = this._ringBuffer[idxL1 + 1] * (1 - frac) + this._ringBuffer[idxL2 + 1] * frac;

        readPtrFrames += playbackRate;
        if (readPtrFrames >= ringLenFrames) readPtrFrames -= ringLenFrames;
        
        samplesConsumed += 2 * playbackRate;

        if (fade < 1.0) fade += 0.02;
        
        channel0[i] = valL * fade;
        channel1[i] = valR * fade;

        // Peak detection (branchless-friendly)
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
    if (this._sampleCount >= 10000) { 
      const currentAvailable = this._totalWritten - this._totalRead;
      this.port.postMessage({ 
        type: 'DIAG', 
        available: Math.floor(currentAvailable), 
        stalled: this._stallCount,
        peak: this._currentPeak,
        rate: this._playbackRate,
        locked: (Math.abs(this._smoothedError) < 12000)
      });
      this._currentPeak = 0;
      this._sampleCount = 0;
    }

    return true;
  }
}

registerProcessor('pcm-player-worklet', PCMPlayerProcessor);

/* global AudioWorkletProcessor, registerProcessor, sampleRate */
/**
 * PCM Player AudioWorkletProcessor - Direct Handshake Engine [v13.9.330]
 * [v13.9.330] POINTER-BASED RING BUFFER — eliminates thread-race buffer drift.
 * The old separate _bufferSize counter drifted because onmessage (message thread)
 * and process() (audio thread) both mutated it without atomics.
 * Now we compute available data directly from (writePtr - readPtr) mod ringLen.
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
    this._baseRate = options.processorOptions?.baseRateRatio || 1.0;
    this._playbackRate = this._baseRate;
    
    // Jitter-Buffer Targets (sample counts, 48kHz stereo)
    this._TARGET_BUFFER = 19200;   // 200ms operating target
    this._MIN_BUFFER = 4800;       // 50ms stall threshold
    this._PREBUFFER = 14400;       // 150ms warm-up before first play
    this._FLUSH_THRESHOLD = 48000;  // 500ms — hard flush ceiling
    
    this._isBuffering = true;
    this._stallCount = 0;
    this._sampleCount = 0;
    this._currentPeak = 0;
    this._fade = 1.0;
    
    // PI Controller
    this._smoothedError = 0;
    this._integralError = 0;

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
    const ringLen = this._ringBuffer.length;

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

    // PI CONTROLLER — continuous, ultra-smooth
    const rawError = available - this._TARGET_BUFFER;
    this._smoothedError = (this._smoothedError * 0.998) + (rawError * 0.002);

    let pAdj = this._smoothedError * 0.00000002;
    this._integralError += this._smoothedError * 0.00000000005;
    
    this._integralError *= 0.9999;
    this._integralError = Math.max(-0.001, Math.min(0.001, this._integralError));
    pAdj = Math.max(-0.0005, Math.min(0.0005, pAdj));
    
    this._playbackRate = this._baseRate + pAdj + this._integralError;

    // RENDER LOOP
    let readPtr = this._readPtr;
    let samplesConsumed = 0;
    const playbackRate = this._playbackRate;
    let fade = this._fade;
    // How many samples per output frame we consume (stereo pairs × rate)
    const samplesPerFrame = 2 * playbackRate;

    for (let i = 0; i < channel0.length; i++) {
      if (available - samplesConsumed >= 4) {
        // Linear Interpolation
        const frameFloat = readPtr / 2;
        const frameIndex = frameFloat | 0;
        const frac = frameFloat - frameIndex;
        
        const iL1 = frameIndex * 2;
        const iR1 = iL1 + 1;
        
        let iL2 = iL1 + 2;
        if (iL2 >= ringLen) iL2 -= ringLen;
        const iR2 = iL2 + 1;

        const valL = this._ringBuffer[iL1] * (1 - frac) + this._ringBuffer[iL2] * frac;
        const valR = this._ringBuffer[iR1] * (1 - frac) + this._ringBuffer[iR2] * frac;

        // Advance read pointer by playbackRate frames (× 2 for stereo samples)
        readPtr += samplesPerFrame;
        if (readPtr >= ringLen) readPtr -= ringLen;
        
        samplesConsumed += samplesPerFrame;

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

    this._readPtr = readPtr;
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

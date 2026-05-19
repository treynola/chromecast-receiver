/* global AudioWorkletProcessor, registerProcessor */
/**
 * PCM Player AudioWorkletProcessor - Direct Handshake Engine [v13.9.330]
 * Optimized for zero-jitter, zero-allocation Direct Binary Bridge (WebSocket).
 * [v13.9.330] Balanced PI controller after fixing duplicate WS data source.
 */
class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._ringBuffer = new Float32Array(48000 * 4); // 4 seconds at 48kHz
    this._readPtr = 0.0;
    this._writePtr = 0;
    this._bufferSize = 0;
    
    // [v13.9.27] DYNAMIC RATE ALIGNMENT
    this._baseRate = options.processorOptions?.baseRateRatio || 1.0;
    this._playbackRate = this._baseRate;
    
    // [v13.9.330] Robust Jitter-Buffer Targets (500ms target for TV stability)
    this._TARGET_BUFFER = 48000;   // 500ms @ 48kHz stereo — operating target
    this._MIN_BUFFER = 9600;       // 100ms (stall threshold)
    this._PREBUFFER = 48000;       // 500ms (warm-up)
    this._DEAD_ZONE = 4800;        // 100ms (PI dead zone)
    this._FLUSH_THRESHOLD = 96000; // 1000ms (1.0s) — generous headroom for PI convergence
    
    this._isBuffering = true;
    this._stallCount = 0;
    this._sampleCount = 0;
    this._currentPeak = 0;
    this._fade = 1.0; 
    
    // Controller Variables (Smoothed Error for Proportional Control)
    this._smoothedError = 0;
    this._integralError = 0; // [v13.9.107] Integral accumulator for hardware drift discovery

    this.port.onmessage = (e) => {
      try {
        const arrayBuffer = (e.data instanceof ArrayBuffer) ? e.data : e.data.buffer;
        if (!arrayBuffer) return;
        
        const pcm16 = new Int16Array(arrayBuffer);
        const ringLen = this._ringBuffer.length;
        
        let writePtr = this._writePtr;
        for (let i = 0; i < pcm16.length; i++) {
          this._ringBuffer[writePtr] = pcm16[i] / 32768;
          writePtr++;
          if (writePtr >= ringLen) writePtr = 0;
        }
        this._writePtr = writePtr;
        this._bufferSize = Math.min(ringLen, this._bufferSize + pcm16.length);
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

    // [v13.9.330] LATENCY CATCH-UP (FAST-FLUSH OPTIMIZED)
    // If the buffer exceeds 1 second, instantly discard old samples.
    if (this._bufferSize > this._FLUSH_THRESHOLD) {
      const excess = this._bufferSize - this._TARGET_BUFFER;
      let readPtr = this._readPtr + excess;
      while (readPtr >= ringLen) readPtr -= ringLen;
      this._readPtr = readPtr;
      this._bufferSize = this._TARGET_BUFFER;
      this._smoothedError = 0;
      this._integralError = 0; // Reset integral on hard flush to prevent speed pegging
      this.port.postMessage({ type: 'LOG', msg: `⚠️ Latency Catch-up: Flushed ${Math.round(excess)} excess. Integral reset.` });
    }

    if (this._isBuffering) {
      if (this._bufferSize >= this._PREBUFFER) {
        this._isBuffering = false;
        this._smoothedError = 0;
        this._integralError = 0; // Reset integral on startup for a clean slate
        // Trim any excess above target
        if (this._bufferSize > this._TARGET_BUFFER) {
          const excess = this._bufferSize - this._TARGET_BUFFER;
          let readPtr = this._readPtr + excess;
          while (readPtr >= ringLen) readPtr -= ringLen;
          this._readPtr = readPtr;
          this._bufferSize = this._TARGET_BUFFER;
          this.port.postMessage({ type: 'LOG', msg: `⚡ Startup: Trimmed ${Math.round(excess)} samples. Integral reset.` });
        }
      } else {
        return true;
      }
    }

    if (this._bufferSize < this._MIN_BUFFER) {
      this._stallCount++;
      this._isBuffering = true;
      this._fade = 0;
      this._integralError = 0; // Reset integral on stall to allow fresh drift measurement
      return true;
    }

    // [v13.9.330] Ultra-Smooth PI Playback Rate Controller (Max +/- 1.0% speed warp)
    const rawError = this._bufferSize - this._TARGET_BUFFER;
    this._smoothedError = (this._smoothedError * 0.99) + (rawError * 0.01);

    let pAdj = 0;
    const absError = Math.abs(this._smoothedError);
    if (absError > this._DEAD_ZONE) {
      // Proportional: Gentle response (max +/- 0.4% speed adjustment at 40000 error)
      pAdj = this._smoothedError * 0.0000001;
      
      // Integral: Extremely slow accumulation for clock drift (max +/- 0.6% speed adjustment)
      this._integralError += this._smoothedError * 0.0000000001;
    }
    
    // Slow integral decay to prevent windup
    this._integralError *= 0.99999;
    
    // Strict clamps: Proportional +/- 0.4%, Integral +/- 0.6% -> max +/- 1.0% speed adjustment
    this._integralError = Math.max(-0.006, Math.min(0.006, this._integralError));
    pAdj = Math.max(-0.004, Math.min(0.004, pAdj));
    
    this._playbackRate = this._baseRate + pAdj + this._integralError;

    // Cache properties in local variables for hot loop optimization
    let readPtr = this._readPtr;
    let bufferSize = this._bufferSize;
    const playbackRate = this._playbackRate;
    let fade = this._fade;

    for (let i = 0; i < channel0.length; i++) {
      if (bufferSize >= 4) {
        // Linear Interpolation (Optimized - No division/modulo)
        const frameIndex = Math.floor(readPtr / 2);
        const iL = frameIndex * 2;
        
        let nextIL = iL + 2;
        if (nextIL >= ringLen) nextIL -= ringLen;
        
        const fract = (readPtr / 2) - frameIndex;

        const vL1 = this._ringBuffer[iL];
        const vL2 = this._ringBuffer[nextIL];
        const valL = vL1 + fract * (vL2 - vL1);

        const iR = iL + 1;
        let nextIR = iL + 3;
        if (nextIR >= ringLen) nextIR -= ringLen;
        
        const vR1 = this._ringBuffer[iR];
        const vR2 = this._ringBuffer[nextIR];
        const valR = vR1 + fract * (vR2 - vR1);

        readPtr += 2 * playbackRate;
        if (readPtr >= ringLen) readPtr -= ringLen;
        
        bufferSize = Math.max(0, bufferSize - (2 * playbackRate));

        if (fade < 1.0) fade += 0.02;
        
        channel0[i] = valL * fade;
        channel1[i] = valR * fade;

        const p = Math.max(Math.abs(valL), Math.abs(valR));
        if (p > this._currentPeak) this._currentPeak = p;
      } else {
        if (fade > 0) fade -= 0.05;
        channel0[i] = 0;
        channel1[i] = 0;
      }
    }

    // Sync back cached local variables
    this._readPtr = readPtr;
    this._bufferSize = bufferSize;
    this._fade = fade;

    this._sampleCount += 128;
    if (this._sampleCount >= 10000) { 
      this.port.postMessage({ 
        type: 'DIAG', 
        available: Math.floor(this._bufferSize), 
        stalled: this._stallCount,
        peak: this._currentPeak,
        rate: this._playbackRate,
        locked: (Math.abs(this._smoothedError) < this._DEAD_ZONE)
      });
      this._currentPeak = 0;
      this._sampleCount = 0;
    }

    return true;
  }
}

registerProcessor('pcm-player-worklet', PCMPlayerProcessor);

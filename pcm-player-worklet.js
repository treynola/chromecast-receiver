/* global AudioWorkletProcessor, registerProcessor */
/**
 * PCM Player AudioWorkletProcessor - Direct Handshake Engine [v13.9.330]
 * Optimized for zero-jitter, zero-allocation Direct Binary Bridge (WebSocket).
 * [v13.9.330] Balanced PI controller after fixing duplicate WS data source.
 */
class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._ringBuffer = new Float32Array(48000 * 2 * 4); // 4 seconds of stereo (384000 samples)
    this._readPtr = 0.0; // Frame-based read pointer (0.0 to 192000.0)
    this._writePtr = 0;  // Sample-based write pointer (0 to 384000)
    this._bufferSize = 0; // Sample-based buffer size
    
    // [v13.9.27] DYNAMIC RATE ALIGNMENT
    this._baseRate = options.processorOptions?.baseRateRatio || 1.0;
    this._playbackRate = this._baseRate;
    
    // [v13.9.330] Robust Jitter-Buffer Targets (Accommodating 1.0s network bursts)
    this._TARGET_BUFFER = 96000;   // 1.0s @ 48kHz stereo — operating target to absorb bursts
    this._MIN_BUFFER = 9600;       // 100ms (stall threshold)
    this._PREBUFFER = 96000;       // 1.0s (warm-up)
    this._DEAD_ZONE = 24000;       // 250ms (PI dead zone)
    this._FLUSH_THRESHOLD = 288000; // 3.0s — generous headroom for PI convergence and 1.0s network bursts
    
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
        const INV_32768 = 0.000030517578125; // Pre-calculated inverse for fast multiplication
        for (let i = 0; i < pcm16.length; i++) {
          this._ringBuffer[writePtr] = pcm16[i] * INV_32768;
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
    const ringFrames = ringLen / 2;

    // [v13.9.330] LATENCY CATCH-UP (FAST-FLUSH OPTIMIZED)
    // If the buffer exceeds 1.5 seconds, instantly discard old samples.
    if (this._bufferSize > this._FLUSH_THRESHOLD) {
      const excess = this._bufferSize - this._TARGET_BUFFER;
      const excessFrames = excess / 2;
      let readPtr = this._readPtr + excessFrames;
      while (readPtr >= ringFrames) readPtr -= ringFrames;
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
          const excessFrames = excess / 2;
          let readPtr = this._readPtr + excessFrames;
          while (readPtr >= ringFrames) readPtr -= ringFrames;
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
        // Nearest Neighbor (Ultra-Optimized for Weak Chromecast CPUs)
        const frameIndex = readPtr | 0; // Fast integer cast
        const iL = frameIndex * 2;
        
        const valL = this._ringBuffer[iL];
        const valR = this._ringBuffer[iL + 1];

        readPtr += playbackRate;
        if (readPtr >= ringFrames) readPtr -= ringFrames;
        
        bufferSize = Math.max(0, bufferSize - (2 * playbackRate));

        if (fade < 1.0) fade += 0.02;
        
        channel0[i] = valL * fade;
        channel1[i] = valR * fade;

        // Optimized Peak Finder (Avoids expensive Math.max and Math.abs calls in hot path)
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

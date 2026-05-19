/* global AudioWorkletProcessor, registerProcessor */
/**
 * PCM Player AudioWorkletProcessor - Direct Handshake Engine [v13.9.310]
 * Optimized for zero-jitter, zero-allocation Direct Binary Bridge (WebSocket).
 * [v13.9.310] Balanced PI controller after fixing duplicate WS data source.
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
    
    // [v13.9.320] Robust Jitter-Buffer Targets (500ms target for TV stability)
    this._TARGET_BUFFER = 48000;   // 500ms @ 48kHz stereo — operating target
    this._MIN_BUFFER = 9600;       // 100ms (stall threshold)
    this._PREBUFFER = 48000;       // 500ms (warm-up)
    this._DEAD_ZONE = 1920;        // 20ms (PI dead zone)
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
        
        // [v13.9.100] Zero-Allocation Direct Ingestion
        // Copy and decode 16-bit PCM directly into Float32 ring buffer to avoid GC churn entirely
        for (let i = 0; i < pcm16.length; i++) {
          this._ringBuffer[this._writePtr] = pcm16[i] / 32768;
          this._writePtr = (this._writePtr + 1) % ringLen;
        }
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

    // [v13.9.300] LATENCY CATCH-UP (FAST-FLUSH)
    // If the buffer exceeds 1 second, instantly discard old samples.
    // DO NOT reset PI integral — it contains valuable hardware drift info.
    // Instead, only reset the smoothed error so proportional responds to new state.
    if (this._bufferSize > this._FLUSH_THRESHOLD) {
      const ringLen = this._ringBuffer.length;
      const excess = this._bufferSize - this._TARGET_BUFFER;
      this._readPtr = (this._readPtr + excess) % ringLen;
      this._bufferSize = this._TARGET_BUFFER;
      // Reset proportional state but KEEP integral (hardware drift knowledge)
      this._smoothedError = 0;
      this.port.postMessage({ type: 'LOG', msg: `⚠️ Latency Catch-up: Flushed ${Math.round(excess)} excess. Integral preserved @ ${this._integralError.toFixed(5)}` });
    }

    if (this._isBuffering) {
      if (this._bufferSize >= this._PREBUFFER) {
        this._isBuffering = false;
        // [v13.9.300] On exit from buffering, reset proportional but keep integral.
        // Also pre-seed playback rate slightly above 1.0 to compensate for the
        // empirically observed Chromecast audio thread slowdown.
        this._smoothedError = 0;
        // [v13.9.310] No integral seed — with the duplicate WS fix,
        // data arrives at 1x rate and PI converges naturally.
        // Trim any excess above target
        if (this._bufferSize > this._TARGET_BUFFER) {
          const ringLen = this._ringBuffer.length;
          const excess = this._bufferSize - this._TARGET_BUFFER;
          this._readPtr = (this._readPtr + excess) % ringLen;
          this._bufferSize = this._TARGET_BUFFER;
          this.port.postMessage({ type: 'LOG', msg: `⚡ Startup: Trimmed ${Math.round(excess)} samples. Integral seed: ${this._integralError.toFixed(5)}` });
        }
      } else {
        return true;
      }
    }

    if (this._bufferSize < this._MIN_BUFFER) {
      this._stallCount++;
      this._isBuffering = true;
      this._fade = 0;
      // [v13.9.300] On stall (underrun), the integral was TOO HIGH (consuming too fast).
      // Reduce it to allow buffer to refill more quickly next time.
      this._integralError = Math.max(0, this._integralError - 0.005);
      return true;
    }

    // [v13.9.310] Balanced PI Playback Rate Controller
    // With duplicate WS fix in place, data arrives at true 1x rate.
    // The PI only needs to correct for minor clock drift and network jitter.
    const rawError = this._bufferSize - this._TARGET_BUFFER;
    this._smoothedError = (this._smoothedError * 0.98) + (rawError * 0.02);

    let pAdj = 0;
    const absError = Math.abs(this._smoothedError);
    if (absError > this._DEAD_ZONE) {
      // Proportional: Moderate correction (+/- 3% max)
      pAdj = this._smoothedError * 0.000012;
      
      // Integral: Slow accumulation for persistent clock drift
      this._integralError += this._smoothedError * 0.0000002;
    }
    
    // Gentle integral decay to prevent permanent rate warp
    this._integralError *= 0.999998;
    
    // Clamp integral: ±30% covers severe CPU starvation on Chromecast
    this._integralError = Math.max(-0.30, Math.min(0.30, this._integralError));
    // Clamp proportional: ±10% for immediate jitter response
    pAdj = Math.max(-0.10, Math.min(0.10, pAdj));
    
    this._playbackRate = this._baseRate + pAdj + this._integralError;

    const ringLen = this._ringBuffer.length;

    for (let i = 0; i < channel0.length; i++) {
      if (this._bufferSize >= 4) {
        // Linear Interpolation
        // iL MUST be an even number because the buffer is interleaved stereo
        let frameIndex = Math.floor(this._readPtr / 2);
        const iL = (frameIndex * 2) % ringLen;
        const nextIL = (iL + 2) % ringLen;
        const fract = (this._readPtr / 2) - frameIndex;

        const vL1 = this._ringBuffer[iL];
        const vL2 = this._ringBuffer[nextIL];
        const valL = vL1 + fract * (vL2 - vL1);

        const iR = (iL + 1) % ringLen;
        const nextIR = (iR + 2) % ringLen;
        const vR1 = this._ringBuffer[iR];
        const vR2 = this._ringBuffer[nextIR];
        const valR = vR1 + fract * (vR2 - vR1);

        this._readPtr = (this._readPtr + (2 * this._playbackRate)) % ringLen;
        this._bufferSize = Math.max(0, this._bufferSize - (2 * this._playbackRate));

        if (this._fade < 1.0) this._fade += 0.02;
        
        channel0[i] = valL * this._fade;
        channel1[i] = valR * this._fade;

        const p = Math.max(Math.abs(valL), Math.abs(valR));
        if (p > this._currentPeak) this._currentPeak = p;
      } else {
        if (this._fade > 0) this._fade -= 0.05;
        channel0[i] = 0;
        channel1[i] = 0;
      }
    }

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

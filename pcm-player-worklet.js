/* global AudioWorkletProcessor, registerProcessor */
/**
 * PCM Player AudioWorkletProcessor - Direct Handshake Engine [v13.9.300]
 * Optimized for zero-jitter, zero-allocation Direct Binary Bridge (WebSocket).
 * [v13.9.300] Aggressive PI controller tuned for Chromecast hardware where
 * the audio thread runs slower than nominal 48kHz due to CPU load.
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
    
    // [v13.9.300] BUFFER TARGETS tuned for Chromecast (CPU-constrained hardware)
    // The Chromecast audio thread often runs at ~73-90% of nominal rate due to
    // CPU competition with UI rendering and WebSocket I/O. We need generous
    // headroom so the PI controller can stabilize before hitting the flush limit.
    this._TARGET_BUFFER = 14400;   // 150ms @ 48kHz stereo — operating target
    this._MIN_BUFFER = 2400;       // 25ms (stall threshold)
    this._PREBUFFER = 14400;       // 150ms (warm-up — matches target for clean start)
    this._DEAD_ZONE = 960;         // 10ms (PI dead zone)
    this._FLUSH_THRESHOLD = 96000; // 1 second — gives PI time to stabilize
    
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
        if (this._integralError === 0) {
          // First time: seed integral to compensate for typical CC hardware deficit
          this._integralError = 0.01;
        }
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

    // [v13.9.300] Aggressive PI Playback Rate Controller
    // On Chromecast, the audio thread runs slower than 48kHz nominal due to CPU
    // competition. The PI must discover the ACTUAL consumption deficit and apply
    // a permanent rate offset (via integral) to match the real hardware rate.
    const rawError = this._bufferSize - this._TARGET_BUFFER;
    // Fast smoothing (alpha=0.02) to quickly track buffer level changes
    this._smoothedError = (this._smoothedError * 0.98) + (rawError * 0.02);

    let pAdj = 0;
    const absError = Math.abs(this._smoothedError);
    if (absError > this._DEAD_ZONE) {
      // Proportional: Strong, immediate correction for jitter (+/- 5% max)
      pAdj = this._smoothedError * 0.000020;
      
      // Integral: Moderately fast accumulation to discover real hardware rate.
      // On a CC that runs ~25% slow, this needs to climb to ~0.04 within ~10s.
      this._integralError += this._smoothedError * 0.0000005;
    }
    
    // [v13.9.300] Gentle integral decay: prevents runaway but retains 99.999% of
    // discovered hardware drift per 128-sample block (~3ms). Over 10 seconds this
    // decays ~1.2%, which is negligible vs the accumulation rate.
    this._integralError *= 0.999996;
    
    // Clamp integral: allows up to ±15% permanent rate offset to handle
    // severely CPU-starved embedded devices
    this._integralError = Math.max(-0.15, Math.min(0.15, this._integralError));
    // Clamp proportional: allows ±5% for immediate jitter response
    pAdj = Math.max(-0.05, Math.min(0.05, pAdj));
    
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

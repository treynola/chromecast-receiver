/* global AudioWorkletProcessor, registerProcessor */
/**
 * PCM Player AudioWorkletProcessor - Direct Handshake Engine [v13.9.200]
 * Optimized for zero-jitter, zero-allocation Direct Binary Bridge (WebSocket).
 * [v13.9.200] Fixed PI controller integral drift that caused permanent pitch shifting.
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
    
    // [v13.9.200] TUNED BUFFER TARGETS (100ms target, 100ms prebuffer)
    this._TARGET_BUFFER = 9600;   // 100ms @ 48kHz stereo
    this._MIN_BUFFER = 2880;      // 30ms (Direct Safety Limit)
    this._PREBUFFER = 9600;       // 100ms (Warm-up threshold)
    this._DEAD_ZONE = 480;        // 5ms (Dead-Zone for PI controller)
    this._FLUSH_THRESHOLD = 48000; // 500ms — trigger emergency flush
    
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

    // [v13.9.200] LATENCY CATCH-UP (FAST-FLUSH)
    // If the buffer exceeds 500ms, instantly discard old samples and reset controller state.
    // This prevents the PI controller from accumulating permanent drift during overflow events.
    if (this._bufferSize > this._FLUSH_THRESHOLD) {
      const ringLen = this._ringBuffer.length;
      const excess = this._bufferSize - this._TARGET_BUFFER;
      this._readPtr = (this._readPtr + excess) % ringLen;
      this._bufferSize = this._TARGET_BUFFER;
      // [v13.9.200] CRITICAL: Reset PI state after flush to prevent permanent rate warp
      this._smoothedError = 0;
      this._integralError = 0;
      this.port.postMessage({ type: 'LOG', msg: `⚠️ Latency Catch-up: Flushed ${Math.round(excess)} excess samples. PI controller reset.` });
    }

    if (this._isBuffering) {
      if (this._bufferSize >= this._PREBUFFER) {
        this._isBuffering = false;
        // [v13.9.200] Reset PI state on every rebuffer exit for clean start
        this._smoothedError = 0;
        this._integralError = 0;
        // If there was a buildup during the buffering phase, align to target.
        if (this._bufferSize > this._TARGET_BUFFER) {
          const ringLen = this._ringBuffer.length;
          const excess = this._bufferSize - this._TARGET_BUFFER;
          this._readPtr = (this._readPtr + excess) % ringLen;
          this._bufferSize = this._TARGET_BUFFER;
          this.port.postMessage({ type: 'LOG', msg: `⚡ Startup Align: Trimmed ${Math.round(excess)} samples to target buffer.` });
        }
      } else {
        return true; 
      }
    }

    if (this._bufferSize < this._MIN_BUFFER) {
      this._stallCount++;
      this._isBuffering = true;
      this._fade = 0; // [v13.9.200] Hard mute on stall to prevent click
      return true;
    }

    // [v13.9.200] Continuous PI Playback Rate Controller (with integral decay)
    // The baseRate already compensates for hardware clock differences (e.g. 44.1k vs 48k).
    // The PI controller ONLY corrects for minor network jitter and drift — NOT hardware mismatch.
    const rawError = this._bufferSize - this._TARGET_BUFFER;
    this._smoothedError = (this._smoothedError * 0.99) + (rawError * 0.01);

    let pAdj = 0;
    const absError = Math.abs(this._smoothedError);
    if (absError > this._DEAD_ZONE) {
      // Proportional: Responsive correction (+/- 3% max)
      pAdj = this._smoothedError * 0.000008;
      
      // Integral: Very slow accumulation for persistent drift, WITH DECAY
      this._integralError += this._smoothedError * 0.00000005;
    }
    
    // [v13.9.200] INTEGRAL DECAY: Prevents permanent rate warp.
    // Without this, the integral drifts to 0.5+ and never returns.
    this._integralError *= 0.99999;
    
    // [v13.9.200] Tight clamps: baseRate handles hardware; PI handles jitter only
    this._integralError = Math.max(-0.08, Math.min(0.08, this._integralError));
    pAdj = Math.max(-0.03, Math.min(0.03, pAdj));
    
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

/* global AudioWorkletProcessor, registerProcessor */
/**
 * PCM Player AudioWorkletProcessor - Direct Handshake Engine [v13.9.100]
 * Optimized for zero-jitter, zero-allocation Direct Binary Bridge (WebSocket).
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
    
    // [v13.9.101] JITTER-PROOF BUFFER TARGETS (150ms cushion, 200ms prebuffer)
    this._TARGET_BUFFER = 14400;  // 150ms @ 48kHz stereo
    this._MIN_BUFFER = 2880;      // 30ms (Direct Safety Limit)
    this._PREBUFFER = 19200;      // 200ms (Warm-up threshold)
    this._DEAD_ZONE = 960;       // 10ms (Dead-Zone for PI controller)
    
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

    // [v13.9.101] LATENCY CATCH-UP (FAST-FLUSH)
    // If the buffer size ever balloons past 1.5 seconds (144,000 samples) due to prolonged
    // browser suspension or major network recovery lag, instantly discard old samples and align to prebuffer.
    // This high limit prevents false flushes from normal TCP network bursts.
    if (this._bufferSize > 144000) {
      const ringLen = this._ringBuffer.length;
      const excess = this._bufferSize - this._PREBUFFER;
      this._readPtr = (this._readPtr + excess) % ringLen;
      this._bufferSize = this._PREBUFFER;
      this.port.postMessage({ type: 'LOG', msg: `⚠️ Latency Catch-up: Flushed ${Math.round(excess)} excess samples to restore target 200ms latency.` });
    }

    if (this._isBuffering) {
      if (this._bufferSize >= this._PREBUFFER) {
        this._isBuffering = false;
        // [v13.9.60] INSTANT STARTUP ALIGNMENT
        // If there was a buildup during the buffering phase (e.g. browser context waking up),
        // instantly align buffer size to _PREBUFFER to guarantee zero startup lag!
        if (this._bufferSize > this._PREBUFFER) {
          const ringLen = this._ringBuffer.length;
          const excess = this._bufferSize - this._PREBUFFER;
          this._readPtr = (this._readPtr + excess) % ringLen;
          this._bufferSize = this._PREBUFFER;
          this.port.postMessage({ type: 'LOG', msg: `⚡ Startup Align: Sliced ${Math.round(excess)} backlog samples to start exactly at target prebuffer.` });
        }
      } else {
        return true; 
      }
    }

    if (this._bufferSize < this._MIN_BUFFER) {
      this._stallCount++;
      this._isBuffering = true;
      return true;
    }

    // [v13.9.100] Continuous Proportional Playback Rate Controller
    // Pitch adjusts smoothly, silently, and dynamically to lock perfectly with the sender's stream.
    const rawError = this._bufferSize - this._TARGET_BUFFER;
    // [v13.9.107] Faster smoothing to quickly measure drift trend
    this._smoothedError = (this._smoothedError * 0.995) + (rawError * 0.005);

    let pAdj = 0;
    const absError = Math.abs(this._smoothedError);
    if (absError > this._DEAD_ZONE) {
      // Proportional: Gentle correction for immediate jitter (+/- 2% max)
      pAdj = this._smoothedError * 0.0000050;
      
      // Integral Anti-Windup: Only accumulate if Proportional isn't fully saturated
      const isClamped = (pAdj + this._integralError > 1.0) || (pAdj + this._integralError < -0.5);
      if (!isClamped) {
          // Integral: Extremely slow accumulation to discover true hardware sample rate (e.g., 32kHz, 44.1kHz)
          this._integralError += this._smoothedError * 0.0000001; 
      }
    }
    
    // The Integral is allowed to compensate for extreme hardware lies (e.g. up to 1.6x for 30kHz clocks)
    // The Proportional is clamped tightly (+/- 0.02) to prevent audible wobbling.
    this._integralError = Math.max(-0.5, Math.min(0.6, this._integralError));
    pAdj = Math.max(-0.02, Math.min(0.02, pAdj));
    
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

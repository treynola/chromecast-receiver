/* global AudioWorkletProcessor, registerProcessor */
/**
 * PCM Player AudioWorkletProcessor - Direct Handshake Engine [v13.8.200]
 * Optimized for zero-jitter Direct Binary Bridge (WebSocket).
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
    
    // [v13.9.60] ULTRA-LOW-LATENCY TARGETS (50ms target, 75ms prebuffer)
    this._TARGET_BUFFER = 4800;  // 50ms @ 48kHz stereo
    this._MIN_BUFFER = 960;      // 10ms (Direct Safety Limit)
    this._PREBUFFER = 7200;      // 75ms (Warm-up threshold - Low-Latency Synchronization)
    this._DEAD_ZONE = 480;       // 5ms (Dead-Zone for PI controller)
    
    this._isBuffering = true;
    this._stallCount = 0;
    this._sampleCount = 0;
    this._currentPeak = 0;
    this._fade = 1.0; 
    
    // PI Sync Controller Variables (Aggressive tuning)
    this._errorSum = 0;
    this._smoothedError = 0;
    this._kp = 0.0001; 
    this._ki = 0.00001;

    this.port.onmessage = (e) => {
      try {
        const arrayBuffer = (e.data instanceof ArrayBuffer) ? e.data : e.data.buffer;
        if (!arrayBuffer) return;
        
        const pcm16 = new Int16Array(arrayBuffer);
        const float32 = new Float32Array(pcm16.length);
        
        for (let i = 0; i < pcm16.length; i++) {
          float32[i] = pcm16[i] / 32768;
        }
        
        this._writeToBuffer(float32);
      } catch (err) {
        this.port.postMessage({ type: 'LOG', msg: `❌ Worklet Error: ${err.message}` });
      }
    };
  }

  _writeToBuffer(pcm) {
    const ringLen = this._ringBuffer.length;
    for (let i = 0; i < pcm.length; i++) {
      this._ringBuffer[this._writePtr] = pcm[i];
      this._writePtr = (this._writePtr + 1) % ringLen;
      this._bufferSize = Math.min(ringLen, this._bufferSize + 1);
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const channel0 = output[0];
    const channel1 = output[1];

    // [v13.9.60] LATENCY CATCH-UP (FAST-FLUSH)
    // If the buffer size ever balloons past 400ms (38,400 samples) due to prolonged
    // browser suspension or network recovery lag, instantly discard old samples and align to 75ms.
    if (this._bufferSize > 38400) {
      const ringLen = this._ringBuffer.length;
      const excess = this._bufferSize - this._PREBUFFER;
      this._readPtr = (this._readPtr + excess) % ringLen;
      this._bufferSize = this._PREBUFFER;
      this.port.postMessage({ type: 'LOG', msg: `⚠️ Latency Catch-up: Flushed ${Math.round(excess)} excess samples to restore target 75ms latency.` });
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

    // [v13.9.50] Low-Latency Stable Sync & Dynamic Rate Scaling
    // Uses a dual-stage controller: 0.1% adjustment for micro-drifts (under 100ms) to preserve
    // absolute pitch purity, and 1.0% adjustment for larger deviations (over 100ms) to safely
    // pull down buffered network bursts without triggering an abrupt drop/flush.
    const rawError = this._bufferSize - this._TARGET_BUFFER;
    this._smoothedError = (this._smoothedError * 0.99) + (rawError * 0.01);

    let adj = 0;
    const absError = Math.abs(this._smoothedError);
    if (absError > this._DEAD_ZONE) {
      if (absError > 9600) { // > 100ms deviation
        adj = Math.sign(this._smoothedError) * 0.01; // Moderate 1% rate correction for fast recovery
      } else {
        adj = Math.sign(this._smoothedError) * 0.001; // Ultra-fine 0.1% correction for pitch purity
      }
    }
    this._playbackRate = this._baseRate + adj;

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

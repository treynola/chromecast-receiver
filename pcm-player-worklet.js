/* global AudioWorkletProcessor, registerProcessor */
/**
 * PCM Player AudioWorkletProcessor - Direct Handshake Engine [v13.8.200]
 * Optimized for zero-jitter Direct Binary Bridge (WebSocket).
 */
class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ringBuffer = new Float32Array(48000 * 4); // 4 seconds at 48kHz
    this._readPtr = 0.0;
    this._writePtr = 0;
    this._bufferSize = 0;
    
    // [v13.8.200] Direct Handshake Config
    this._TARGET_BUFFER = 72000; // 750ms @ 48kHz stereo (Drunk-Proof Target)
    this._MIN_BUFFER = 36000;    // 375ms (Increased Safety Margin)
    this._PREBUFFER = 96000;     // 1000ms (Warm-up threshold)
    this._DEAD_ZONE = 2400;      // 25ms (Tighter Precision Dead-Zone)
    
    this._isBuffering = true;
    this._stallCount = 0;
    this._sampleCount = 0;
    this._currentPeak = 0;
    this._fade = 1.0; 
    
    // PI Sync Controller Variables
    this._playbackRate = 1.0;
    this._targetPlaybackRate = 1.0;
    this._errorSum = 0;
    this._smoothedError = 0;
    
    // PI Gains (Optimized for 48kHz drift)
    this._kp = 0.000005; 
    this._ki = 0.0000005;

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
    for (let i = 0; i < pcm.length; i++) {
      this._ringBuffer[this._writePtr] = pcm[i];
      this._writePtr = (this._writePtr + 1) % this._ringBuffer.length;
      this._bufferSize++;
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const channel0 = output[0];
    const channel1 = output[1];

    if (this._isBuffering) {
      if (this._bufferSize >= this._PREBUFFER) {
        this._isBuffering = false;
      } else {
        return true; 
      }
    }

    if (this._bufferSize < this._MIN_BUFFER) {
      this._stallCount++;
      this._isBuffering = true;
      return true;
    }

    // [v13.9.0] SMOOTHED DRUNK-PROOF SYNC
    const rawError = this._bufferSize - this._TARGET_BUFFER;
    this._smoothedError = (this._smoothedError * 0.99) + (rawError * 0.01); 

    if (Math.abs(this._smoothedError) < this._DEAD_ZONE) {
        this._targetPlaybackRate = 1.0;
        this._errorSum *= 0.999; 
    } else {
        this._errorSum += this._smoothedError;
        const adj = (this._smoothedError * this._kp) + (this._errorSum * this._ki);
        this._targetPlaybackRate = Math.max(0.99, Math.min(1.01, 1.0 + adj));
    }
    
    // Fast but smooth ramp to target rate (Eliminates 'drunk' pitch jumps)
    this._playbackRate = (this._playbackRate * 0.995) + (this._targetPlaybackRate * 0.005);

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
        this._bufferSize -= (2 * this._playbackRate);

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

/* global AudioWorkletProcessor, registerProcessor */
/**
 * PCM Player AudioWorkletProcessor - Ultra-Smooth High-Fidelity [v13.8.150]
 * Uses Linear Resampling Interpolation (ASRC) for click-free playback.
 */
class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ringBuffer = new Float32Array(48000 * 4); // 4 seconds at 48kHz
    this._readPtr = 0.0;  // FRACTIONAL read pointer
    this._writePtr = 0;
    this._bufferSize = 0;
    
    // Safety Thresholds (Deep Buffer for 48kHz stability)
    this._MIN_BUFFER = 4800;  // 100ms
    this._PREBUFFER = 24000;  // 500ms
    this._TARGET_BUFFER = 19200; // 400ms target
    
    this._isBuffering = true;
    this._stallCount = 0;
    this._sampleCount = 0;
    this._currentPeak = 0;
    this._fade = 1.0; 
    this._playbackRate = 1.0; // Dynamic speed

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

    // [v13.8.150] ASYNC SAMPLE RATE CONVERTER (ASRC)
    // Adjust playback rate subtly to maintain target buffer level
    if (this._bufferSize > this._TARGET_BUFFER * 1.5) {
        this._playbackRate = 1.001; // Speed up
    } else if (this._bufferSize < this._TARGET_BUFFER * 0.5) {
        this._playbackRate = 0.999; // Slow down
    } else {
        this._playbackRate = 1.0;   // Perfect match
    }

    const ringLen = this._ringBuffer.length;

    for (let i = 0; i < channel0.length; i++) {
      if (this._bufferSize >= 4) {
        // LINEAR INTERPOLATION (L + R interleaved)
        // L Channel
        const iL = Math.floor(this._readPtr);
        const nextIL = (iL + 2) % ringLen;
        const fract = (this._readPtr - iL) / 2;
        
        const vL1 = this._ringBuffer[iL];
        const vL2 = this._ringBuffer[nextIL];
        const valL = vL1 + fract * (vL2 - vL1);

        // R Channel
        const iR = (iL + 1) % ringLen;
        const nextIR = (iR + 2) % ringLen;
        const vR1 = this._ringBuffer[iR];
        const vR2 = this._ringBuffer[nextIR];
        const valR = vR1 + fract * (vR2 - vR1);

        // Advance fractional pointer
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
        rate: this._playbackRate
      });
      this._currentPeak = 0;
      this._sampleCount = 0;
    }

    return true;
  }
}

registerProcessor('pcm-player-worklet', PCMPlayerProcessor);

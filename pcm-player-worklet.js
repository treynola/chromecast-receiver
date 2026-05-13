/* global AudioWorkletProcessor, registerProcessor */
/**
 * PCM Player AudioWorkletProcessor
 * Decodes and plays raw PCM float32 data from the ring buffer.
 */
class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ringBuffer = new Float32Array(44100 * 2); // 2 seconds at 44.1kHz
    this._readPtr = 0;
    this._writePtr = 0;
    this._bufferSize = 0;
    
    this._MIN_BUFFER = 4096; 
    this._PREBUFFER = 8192; // [V13.8.150] Increased for high-fidelity stability
    this._isBuffering = true;
    this._stallCount = 0;
    this._sampleCount = 0;
    this._currentPeak = 0;
    this._fade = 1.0; 
    this._targetBuffer = 16384; // ~340ms at 48kHz
    this._driftCounter = 0;

    this.port.onmessage = (e) => {
      try {
        const arrayBuffer = (e.data instanceof ArrayBuffer) ? e.data : e.data.buffer;
        if (!arrayBuffer) return;
        
        // High-Fi: 16-bit Int16 PCM
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

    // [v13.8.150] Adaptive Drift Control (High-Fi Tuning)
    this._driftCounter++;
    let skipSample = false;
    let repeatSample = false;
    
    if (this._driftCounter >= 10) {
        this._driftCounter = 0;
        if (this._bufferSize > this._targetBuffer * 1.5) skipSample = true; 
        if (this._bufferSize < this._targetBuffer / 1.5) repeatSample = true; 
    }

    for (let i = 0; i < channel0.length; i++) {
      let valL = 0;
      let valR = 0;

      if (this._bufferSize >= 2) {
        valL = this._ringBuffer[this._readPtr];
        valR = this._ringBuffer[(this._readPtr + 1) % this._ringBuffer.length];
        
        if (!repeatSample) {
            this._readPtr = (this._readPtr + (skipSample ? 4 : 2)) % this._ringBuffer.length;
            this._bufferSize -= (skipSample ? 4 : 2);
        }
        
        if (this._fade < 1.0) this._fade += 0.02;
      } else {
        if (this._fade > 0) this._fade -= 0.05;
        if (this._fade < 0) this._fade = 0;
      }

      channel0[i] = (valL * this._fade) + (Math.random() - 0.5) * 1e-6;
      channel1[i] = (valR * this._fade) + (Math.random() - 0.5) * 1e-6;

      const p = Math.max(Math.abs(valL), Math.abs(valR));
      if (p > this._currentPeak) this._currentPeak = p;
    }

    this._sampleCount = (this._sampleCount || 0) + 128;
    if (this._sampleCount >= 10000) { 
      this.port.postMessage({ 
        type: 'DIAG', 
        available: this._bufferSize, 
        stalled: this._stallCount,
        peak: this._currentPeak
      });
      this._currentPeak = 0;
      this._sampleCount = 0;
    }

    return true;
  }
}

registerProcessor('pcm-player-worklet', PCMPlayerProcessor);

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
    this._targetBuffer = 8192; // 22050Hz * 0.4s
    this._driftCounter = 0;

    // [v13.8.150] Mu-Law Decode Table
    this._decodeTable = new Float32Array(256);
    const BIAS = 0x84;
    for (let i = 0; i < 256; i++) {
        let mu = ~i & 0xFF;
        let sign = (mu & 0x80);
        let exponent = (mu & 0x70) >> 4;
        let mantissa = (mu & 0x0F);
        let sample = (mantissa << (exponent + 3)) + BIAS;
        sample <<= 2;
        if (sign !== 0) sample = -sample;
        this._decodeTable[i] = sample / 32768;
    }

    this.port.onmessage = (e) => {
      try {
        const arrayBuffer = (e.data instanceof ArrayBuffer) ? e.data : e.data.buffer;
        if (!arrayBuffer) return;
        
        // APOR V2: Input is now 8-bit Mu-Law
        const muLaw = new Uint8Array(arrayBuffer);
        const float32 = new Float32Array(muLaw.length);
        
        for (let i = 0; i < muLaw.length; i++) {
          float32[i] = this._decodeTable[muLaw[i]];
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

    // [v13.8.150] Adaptive Drift Control
    // Every 10th sample, we decide to skip or repeat based on buffer health
    this._driftCounter++;
    let skipSample = false;
    let repeatSample = false;
    
    if (this._driftCounter >= 10) {
        this._driftCounter = 0;
        if (this._bufferSize > this._targetBuffer * 2) skipSample = true; // Buffer too big, speed up
        if (this._bufferSize < this._targetBuffer / 2) repeatSample = true; // Buffer too small, slow down
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
        // if repeatSample, we don't advance the read pointer, effectively playing the same sample again
        
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

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
    
    this._MIN_BUFFER = 2048; // Increased for stability
    this._PREBUFFER = 8192;  // Increased to prevent early stalling
    this._isBuffering = true;
    this._stallCount = 0;

    this.port.onmessage = (e) => {
      const arrayBuffer = e.data;
      const int16 = new Int16Array(arrayBuffer);
      const float32 = new Float32Array(int16.length);
      
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
      }
      
      this._writeToBuffer(float32);
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
        return true; // Keep alive but silent
      }
    }

    if (this._bufferSize < this._MIN_BUFFER) {
      if (!this._isBuffering) {
        this._stallCount++;
        this.port.postMessage({ type: 'stall', count: this._stallCount, size: this._bufferSize });
      }
      this._isBuffering = true;
      return true;
    }

    for (let i = 0; i < channel0.length; i++) {
      if (this._bufferSize >= 2) {
        const valL = this._ringBuffer[this._readPtr];
        this._readPtr = (this._readPtr + 1) % this._ringBuffer.length;
        this._bufferSize--;
        
        const valR = this._ringBuffer[this._readPtr];
        this._readPtr = (this._readPtr + 1) % this._ringBuffer.length;
        this._bufferSize--;

        channel0[i] = valL;
        channel1[i] = valR;
      } else {
        channel0[i] = 0;
        channel1[i] = 0;
      }
    }

    return true;
  }
}

registerProcessor('pcm-player-worklet', PCMPlayerProcessor);

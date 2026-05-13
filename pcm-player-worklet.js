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
    this._fade = 1.0; // Smoothing gain

    this.port.onmessage = (e) => {
      try {
        if (e.data.type === 'TEST_BEEP') {
          this._testBeepSamples = sampleRate; // 1 second of beep
          this._isBuffering = false; // Force playback start
          console.log('🔈 Receiver: Worklet Beep Triggered');
          return;
        }
        const arrayBuffer = (e.data instanceof ArrayBuffer) ? e.data : e.data.buffer;
        if (!arrayBuffer) return;
        
        const int16 = new Int16Array(arrayBuffer);
        const float32 = new Float32Array(int16.length);
        
        for (let i = 0; i < int16.length; i++) {
          float32[i] = int16[i] / 32768;
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
    const blockSize = output[0].length;
    
    // Heartbeat for diagnostic verification
    if (Math.random() < 0.02) {
      this.port.postMessage({ type: 'DIAG', available: this._bufferSize, stalled: this._stallCount, peak: this._currentPeak, rate: sampleRate });
      this._currentPeak = 0; // Reset peak after sending
    }
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
      let valL = 0;
      let valR = 0;

      if (this._bufferSize >= 2) {
        valL = this._ringBuffer[this._readPtr];
        this._readPtr = (this._readPtr + 1) % this._ringBuffer.length;
        this._bufferSize--;
        
        valR = this._ringBuffer[this._readPtr];
        this._readPtr = (this._readPtr + 1) % this._ringBuffer.length;
        this._bufferSize--;
        
        // Smoothly fade back in
        if (this._fade < 1.0) this._fade += 0.02;
      } else {
        // Smoothly fade out to prevent pop
        if (this._fade > 0) this._fade -= 0.05;
        if (this._fade < 0) this._fade = 0;
      }

      // Add test beep if active
      if (this._testBeepSamples > 0) {
        const beep = Math.sin(6.28 * 440 * (this._testBeepSamples / 44100)) * 0.1;
        valL += beep;
        valR += beep;
        this._testBeepSamples--;
      }

      channel0[i] = (valL * this._fade) + (Math.random() - 0.5) * 1e-6;
      channel1[i] = (valR * this._fade) + (Math.random() - 0.5) * 1e-6;

      // Update Peak
      const pL = Math.abs(valL);
      const pR = Math.abs(valR);
      if (pL > this._currentPeak) this._currentPeak = pL;
      if (pR > this._currentPeak) this._currentPeak = pR;
    }

    this._sampleCount = (this._sampleCount || 0) + 128;
    if (this._sampleCount >= 11025) { 
      this.port.postMessage({ 
        type: 'DIAG', 
        available: this._bufferSize, 
        stalled: this._stallCount,
        rate: sampleRate 
      });
      this._sampleCount = 0;
    }

    return true;
  }
}

registerProcessor('pcm-player-worklet', PCMPlayerProcessor);

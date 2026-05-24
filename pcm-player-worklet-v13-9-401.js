/* global AudioWorkletProcessor, registerProcessor */
/**
 * PCM Player AudioWorkletProcessor - Backend Resampled [v13.9.401]
 * High-Performance direct-copy buffer with host-driven rate adaptation feedback.
 */
class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._ringLen = 48000 * 2 * 8; // 768,000 samples
    this._ringBuffer = new Int16Array(this._ringLen + 4);
    this._writePtr = 0;
    this._readPtr = 0;
    this._totalWritten = 0;
    this._totalRead = 0;
    this._playbackRate = 1.0;
    this._TARGET_BUFFER = 19200;
    this._MIN_BUFFER = 4800;
    this._PREBUFFER = 14400;
    this._FLUSH_THRESHOLD = 38400;
    this._isBuffering = true;
    this._stallCount = 0;
    this._sampleCount = 0;
    this._currentPeak = 0;
    this._fade = 1.0;
    this._callbackCount = 0;
    this._lastCallbackTime = 0;
    this._bitDepth = options.processorOptions?.bitDepth || 16;
    
    this.port.onmessage = (e) => {
      try {
        if (e.data && e.data.type === 'RESET') {
          this._ringBuffer.fill(0);
          this._writePtr = 0;
          this._readPtr = 0;
          this._totalWritten = 0;
          this._totalRead = 0;
          this._isBuffering = true;
          this._stallCount = 0;
          this._sampleCount = 0;
          this._currentPeak = 0;
          this._fade = 1.0;
          this._callbackCount = 0;
          this._lastCallbackTime = 0;
          this.port.postMessage({ type: 'LOG', msg: `🔄 Worklet: State reset complete.` });
          return;
        }
        if (e.data && e.data.type === 'CONFIG') {
          if (e.data.bitDepth) {
            this._bitDepth = e.data.bitDepth;
            this.port.postMessage({ type: 'LOG', msg: `🔧 Worklet: Bit depth set to ${this._bitDepth}-bit` });
          }
          return;
        }
        if (e.data && e.data.type === 'TEST_BEEP') return;
        const arrayBuffer = (e.data instanceof ArrayBuffer) ? e.data : e.data.buffer;
        if (!arrayBuffer) return;
        const ringLen = this._ringLen;
        let writePtr = this._writePtr;
        let samplesDecoded = 0;

        if (this._bitDepth === 24) {
          const bytes = new Uint8Array(arrayBuffer);
          const numSamples = Math.floor(bytes.length / 3);
          for (let i = 0; i < numSamples; i++) {
            const offset = i * 3;
            let val = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
            if (val & 0x800000) val |= 0xFF000000;
            this._ringBuffer[writePtr] = val >> 8;
            writePtr++;
            if (writePtr >= ringLen) writePtr = 0;
          }
          samplesDecoded = numSamples;
        } else {
          const pcm16 = new Int16Array(arrayBuffer);
          const len = pcm16.length;
          if (writePtr + len <= ringLen) {
            this._ringBuffer.set(pcm16, writePtr);
            writePtr += len;
          } else {
            const firstPart = ringLen - writePtr;
            this._ringBuffer.set(pcm16.subarray(0, firstPart), writePtr);
            this._ringBuffer.set(pcm16.subarray(firstPart), 0);
            writePtr = len - firstPart;
          }
          samplesDecoded = len;
        }

        this._writePtr = writePtr;
        this._totalWritten += samplesDecoded;
        this._ringBuffer[ringLen] = this._ringBuffer[0];
        this._ringBuffer[ringLen + 1] = this._ringBuffer[1];
        this._ringBuffer[ringLen + 2] = this._ringBuffer[2];
        this._ringBuffer[ringLen + 3] = this._ringBuffer[3];
      } catch (err) {
        this.port.postMessage({ type: 'LOG', msg: `❌ Worklet Error: ${err.message}` });
      }
    };
  }
  
  process(inputs, outputs) {
    const output = outputs[0];
    const channel0 = output[0];
    const channel1 = output[1];
    if (!channel0 || !channel1) return true;
    const ringLen = this._ringLen;
    const now = Date.now();
    
    this._callbackCount++;
    if (!this._lastCallbackTime) this._lastCallbackTime = now;
    
    // Telemetry and dynamic rate feedback loop (every 1000 callbacks, ~2.6-3.4s)
    if (this._callbackCount >= 1000) {
      const elapsed = (now - this._lastCallbackTime) / 1000;
      if (elapsed > 0.5) {
        const measuredHz = this._callbackCount / elapsed;
        const estimatedRate = Math.round(measuredHz * 128);
        
        // Relay dynamic sample rate to index.html to forward to Rust backend
        this.port.postMessage({ 
          type: 'RATE_UPDATE', 
          sampleRate: estimatedRate 
        });
        
        this.port.postMessage({ 
          type: 'LOG', 
          msg: `📊 TV Callback Rate: ${measuredHz.toFixed(1)} Hz | Target Rate: ${estimatedRate} Hz | Buffer: ${Math.floor(this._totalWritten - this._totalRead)}` 
        });
      }
      this._callbackCount = 0;
      this._lastCallbackTime = now;
    }

    let available = this._totalWritten - this._totalRead;
    
    // Ring Buffer Overrun
    if (available > ringLen) {
      const skip = available - this._TARGET_BUFFER;
      this._totalRead += skip;
      this._readPtr = this._writePtr - this._TARGET_BUFFER;
      while (this._readPtr < 0) this._readPtr += ringLen;
      available = this._TARGET_BUFFER;
      this.port.postMessage({ type: 'LOG', msg: `⚠️ Ring Overrun: Recovered.` });
    }
    
    // Buffer Health / Latency Flush
    if (available > this._FLUSH_THRESHOLD) {
      const excess = available - this._TARGET_BUFFER;
      this._totalRead += excess;
      this._readPtr += excess;
      while (this._readPtr >= ringLen) this._readPtr -= ringLen;
      available = this._TARGET_BUFFER;
      this.port.postMessage({ type: 'LOG', msg: `⚠️ Latency Flush: Flushed ${excess} excess.` });
    }
    
    // Buffering State
    if (this._isBuffering) {
      if (available >= this._PREBUFFER) {
        this._isBuffering = false;
        if (available > this._TARGET_BUFFER) {
          const excess = available - this._TARGET_BUFFER;
          this._totalRead += excess;
          this._readPtr += excess;
          while (this._readPtr >= ringLen) this._readPtr -= ringLen;
          available = this._TARGET_BUFFER;
          this.port.postMessage({ type: 'LOG', msg: `⚡ Startup: Trimmed ${excess} samples.` });
        }
      } else {
        channel0.fill(0);
        channel1.fill(0);
        return true;
      }
    }
    
    // Buffer Starvation / Stall
    if (available < this._MIN_BUFFER) {
      this._stallCount++;
      this._isBuffering = true;
      this._fade = 0;
      channel0.fill(0);
      channel1.fill(0);
      this.port.postMessage({ type: 'LOG', msg: `⚠️ TV Stall: Buffering started.` });
      return true;
    }

    let readPtrFrames = this._readPtr / 2;
    const ringLenFrames = ringLen / 2;
    const INV_32768 = 3.0517578125e-5;
    const framesToProcess = channel0.length; // 128
    
    let i = 0;
    let fade = this._fade;
    
    // Direct Copy (Zero interpolation overhead since playbackRate is locked to 1.0)
    if (fade >= 1.0) {
      for (; i < framesToProcess; i++) {
        const idx = readPtrFrames * 2;
        channel0[i] = this._ringBuffer[idx] * INV_32768;
        channel1[i] = this._ringBuffer[idx + 1] * INV_32768;
        readPtrFrames++;
        if (readPtrFrames >= ringLenFrames) readPtrFrames -= ringLenFrames;
      }
    } else {
      for (; i < framesToProcess; i++) {
        const idx = readPtrFrames * 2;
        fade += 0.02;
        if (fade > 1.0) fade = 1.0;
        channel0[i] = this._ringBuffer[idx] * INV_32768 * fade;
        channel1[i] = this._ringBuffer[idx + 1] * INV_32768 * fade;
        readPtrFrames++;
        if (readPtrFrames >= ringLenFrames) readPtrFrames -= ringLenFrames;
      }
    }

    // Peak detection
    if (framesToProcess > 0) {
      const valL = channel0[0];
      const valR = channel1[0];
      const absL = valL < 0 ? -valL : valL;
      const absR = valR < 0 ? -valR : valR;
      const peak = absL > absR ? absL : absR;
      if (peak > this._currentPeak) this._currentPeak = peak;
    }

    const samplesConsumed = framesToProcess * 2;
    this._readPtr = readPtrFrames * 2;
    this._totalRead += samplesConsumed;
    this._fade = fade;
    this._sampleCount += 128;
    
    if (this._sampleCount >= 96000) {
      const currentAvailable = this._totalWritten - this._totalRead;
      this.port.postMessage({ 
        type: 'DIAG', 
        available: Math.floor(currentAvailable), 
        stalled: this._stallCount, 
        peak: this._currentPeak, 
        rate: 1.0, 
        locked: true 
      });
      this._currentPeak = 0;
      this._sampleCount = 0;
    }
    return true;
  }
}
registerProcessor('pcm-player-worklet', PCMPlayerProcessor);

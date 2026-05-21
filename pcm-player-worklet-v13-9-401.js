/* global AudioWorkletProcessor, registerProcessor, sampleRate */
/**
 * PCM Player AudioWorkletProcessor - Direct Handshake Engine [v13.9.401]
 */
class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._ringBuffer = new Int16Array(48000 * 2 * 8);
    this._writePtr = 0;
    this._readPtr = 0;
    this._totalWritten = 0;
    this._totalRead = 0;
    this._studioRate = options.processorOptions?.studioRate || 48000;
    this._baseRate = options.processorOptions?.baseRateRatio || 1.0;
    this._playbackRate = this._baseRate;
    this._TARGET_BUFFER = 19200;
    this._MIN_BUFFER = 4800;
    this._PREBUFFER = 14400;
    this._FLUSH_THRESHOLD = 57600;
    this._isBuffering = true;
    this._stallCount = 0;
    this._sampleCount = 0;
    this._currentPeak = 0;
    this._fade = 1.0;
    this._smoothedError = 0;
    this._callbackCount = 0;
    this._lastCallbackTime = 0;
    this._baseRateInitial = this._baseRate;
    this._baseRateMin = this._baseRate * 0.60;
    this._baseRateMax = this._baseRate * 1.40;
    this._calibrationCount = 0;
    // [v13.9.402] Bit depth config — 16 or 24, switchable via CONFIG message
    this._bitDepth = options.processorOptions?.bitDepth || 16;
    this.port.onmessage = (e) => {
      try {
        // Handle config messages (bit depth switching)
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
        const ringLen = this._ringBuffer.length;
        let writePtr = this._writePtr;
        let samplesDecoded = 0;

        if (this._bitDepth === 24) {
          // [v13.9.402] 24-bit PCM: 3 bytes per sample, little-endian, signed
          const bytes = new Uint8Array(arrayBuffer);
          const numSamples = Math.floor(bytes.length / 3);
          for (let i = 0; i < numSamples; i++) {
            const offset = i * 3;
            // Read 3 bytes little-endian → sign-extend to 32-bit
            let val = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
            if (val & 0x800000) val |= 0xFF000000; // sign extension
            // Convert 24-bit to 16-bit signed integer by shifting right by 8 bits
            this._ringBuffer[writePtr] = val >> 8;
            writePtr++;
            if (writePtr >= ringLen) writePtr = 0;
          }
          samplesDecoded = numSamples;
        } else {
          // 16-bit PCM: 2 bytes per sample, native Int16. Copy using fast native TypedArray set
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
    const ringLen = this._ringBuffer.length;
    const now = Date.now();
    this._callbackCount++;
    if (!this._lastCallbackTime) this._lastCallbackTime = now;
    if (this._calibrationCount === 0 && this._callbackCount === 150) {
      const elapsed = (now - this._lastCallbackTime) / 1000;
      if (elapsed > 0.1) {
        const measuredHz = this._callbackCount / elapsed;
        this._calibrationCount = 1;
        this.port.postMessage({ type: 'LOG', msg: `📊 Startup Fast Telemetry: ${measuredHz.toFixed(1)} Hz | Nominal BaseRate: ${this._baseRate.toFixed(4)}` });
      }
      this._callbackCount = 0;
      this._lastCallbackTime = now;
    } else if (this._calibrationCount > 0 && now - this._lastCallbackTime >= 5000) {
      const elapsed = (now - this._lastCallbackTime) / 1000;
      const measuredHz = this._callbackCount / elapsed;
      this._calibrationCount++;
      this.port.postMessage({ type: 'LOG', msg: `📊 Callback Rate: ${measuredHz.toFixed(1)} Hz | Nominal BaseRate: ${this._baseRate.toFixed(4)}` });
      this._callbackCount = 0;
      this._lastCallbackTime = now;
    }
    let available = this._totalWritten - this._totalRead;
    if (available > ringLen) {
      const skip = available - this._TARGET_BUFFER;
      this._totalRead += skip;
      this._readPtr = this._writePtr;
      this._readPtr -= this._TARGET_BUFFER;
      if (this._readPtr < 0) this._readPtr += ringLen;
      available = this._TARGET_BUFFER;
      this._smoothedError = 0;
      this.port.postMessage({ type: 'LOG', msg: `⚠️ Ring Overrun: Recovered. Available reset to ${available}.` });
    }
    if (available > this._FLUSH_THRESHOLD) {
      const excess = available - this._TARGET_BUFFER;
      this._totalRead += excess;
      this._readPtr += excess;
      while (this._readPtr >= ringLen) this._readPtr -= ringLen;
      available = this._TARGET_BUFFER;
      this._smoothedError = 0;
      this.port.postMessage({ type: 'LOG', msg: `⚠️ Latency Catch-up: Flushed ${excess} excess.` });
    }
    if (this._isBuffering) {
      if (available >= this._PREBUFFER) {
        this._isBuffering = false;
        this._smoothedError = 0;
        if (available > this._TARGET_BUFFER) {
          const excess = available - this._TARGET_BUFFER;
          this._totalRead += excess;
          this._readPtr += excess;
          while (this._readPtr >= ringLen) this._readPtr -= ringLen;
          available = this._TARGET_BUFFER;
          this.port.postMessage({ type: 'LOG', msg: `⚡ Startup: Trimmed ${excess} samples.` });
        }
      } else {
        return true;
      }
    }
    if (available < this._MIN_BUFFER) {
      this._stallCount++;
      this._isBuffering = true;
      this._fade = 0;
      return true;
    }
    const rawError = available - this._TARGET_BUFFER;
    this._smoothedError = (this._smoothedError * 0.98) + (rawError * 0.02);
    let pAdj = 0;
    const DEADBAND = 2000;
    if (Math.abs(this._smoothedError) > DEADBAND) {
      const overage = this._smoothedError > 0 ? this._smoothedError - DEADBAND : this._smoothedError + DEADBAND;
      pAdj = overage * 0.000001;
    }
    const MAX_ADJUST = 0.015;
    pAdj = Math.max(-MAX_ADJUST, Math.min(MAX_ADJUST, pAdj));
    const targetRate = this._baseRate + pAdj;
    this._playbackRate = (this._playbackRate * 0.99) + (targetRate * 0.01);
    let readPtrFrames = this._readPtr / 2;
    let samplesConsumed = 0;
    const playbackRate = this._playbackRate;
    let fade = this._fade;
    const ringLenFrames = ringLen / 2;
    const INV_32768 = 3.0517578125e-5;
    for (let i = 0; i < channel0.length; i++) {
      if (available - samplesConsumed >= 4) {
        const frameIndex = readPtrFrames | 0;
        const frac = readPtrFrames - frameIndex;
        const idxL1 = frameIndex * 2;
        let idxL2 = idxL1 + 2;
        if (idxL2 >= ringLen) idxL2 -= ringLen;
        const valL = (this._ringBuffer[idxL1] * (1 - frac) + this._ringBuffer[idxL2] * frac) * INV_32768;
        const valR = (this._ringBuffer[idxL1 + 1] * (1 - frac) + this._ringBuffer[idxL2 + 1] * frac) * INV_32768;
        readPtrFrames += playbackRate;
        if (readPtrFrames >= ringLenFrames) readPtrFrames -= ringLenFrames;
        samplesConsumed += 2 * playbackRate;
        if (fade < 1.0) fade += 0.02;
        channel0[i] = valL * fade;
        channel1[i] = valR * fade;
        const absL = valL < 0 ? -valL : valL;
        const absR = valR < 0 ? -valR : valR;
        const peak = absL > absR ? absL : absR;
        if (peak > this._currentPeak) this._currentPeak = peak;
      } else {
        if (fade > 0) fade -= 0.05;
        channel0[i] = 0;
        channel1[i] = 0;
      }
    }
    this._readPtr = readPtrFrames * 2;
    this._totalRead += samplesConsumed;
    this._fade = fade;
    this._sampleCount += 128;
    if (this._sampleCount >= 10000) {
      const currentAvailable = this._totalWritten - this._totalRead;
      this.port.postMessage({ type: 'DIAG', available: Math.floor(currentAvailable), stalled: this._stallCount, peak: this._currentPeak, rate: this._playbackRate, locked: (Math.abs(this._smoothedError) < 12000) });
      this._currentPeak = 0;
      this._sampleCount = 0;
    }
    return true;
  }
}
registerProcessor('pcm-player-worklet', PCMPlayerProcessor);

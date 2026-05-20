/* global AudioWorkletProcessor, registerProcessor, sampleRate */
/**
 * PCM Player AudioWorkletProcessor - Direct Handshake Engine [v13.9.401]
 */
class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._ringBuffer = new Float32Array(48000 * 2 * 8);
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
    this.port.onmessage = (e) => {
      try {
        const arrayBuffer = (e.data instanceof ArrayBuffer) ? e.data : e.data.buffer;
        if (!arrayBuffer) return;
        const pcm16 = new Int16Array(arrayBuffer);
        const ringLen = this._ringBuffer.length;
        let writePtr = this._writePtr;
        const INV_32768 = 0.000030517578125;
        for (let i = 0; i < pcm16.length; i++) {
          this._ringBuffer[writePtr] = pcm16[i] * INV_32768;
          writePtr++;
          if (writePtr >= ringLen) writePtr = 0;
        }
        this._writePtr = writePtr;
        this._totalWritten += pcm16.length;
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
    for (let i = 0; i < channel0.length; i++) {
      if (available - samplesConsumed >= 4) {
        const frameIndex = readPtrFrames | 0;
        const frac = readPtrFrames - frameIndex;
        const idxL1 = frameIndex * 2;
        let idxL2 = idxL1 + 2;
        if (idxL2 >= ringLen) idxL2 -= ringLen;
        const valL = this._ringBuffer[idxL1] * (1 - frac) + this._ringBuffer[idxL2] * frac;
        const valR = this._ringBuffer[idxL1 + 1] * (1 - frac) + this._ringBuffer[idxL2 + 1] * frac;
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

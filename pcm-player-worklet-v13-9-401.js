/* global AudioWorkletProcessor, registerProcessor, sampleRate */
/**
 * PCM Player AudioWorkletProcessor - Direct Handshake Engine [v13.9.401]
 * High-Performance Int16 resampler with fast native copy and adaptive hardware base-rate calibration.
 */
class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._ringLen = 48000 * 2 * 8;
    this._ringBuffer = new Int16Array(this._ringLen + 4);
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
    this._FLUSH_THRESHOLD = 38400;
    this._isBuffering = true;
    this._stallCount = 0;
    this._sampleCount = 0;
    this._currentPeak = 0;
    this._fade = 1.0;
    this._smoothedError = 0;
    this._callbackCount = 0;
    this._lastCallbackTime = 0;
    this._baseRateInitial = this._baseRate;
    this._baseRateMin = this._baseRate - 0.015;
    this._baseRateMax = this._baseRate + 0.015;
    this._calibrationCount = 0;
    this._integral = 0;
    this._bitDepth = options.processorOptions?.bitDepth || 16;
    
    this.port.onmessage = (e) => {
      try {
        // Handle RESET command
        if (e.data && e.data.type === 'RESET') {
          this._ringBuffer.fill(0);
          this._writePtr = 0;
          this._readPtr = 0;
          this._totalWritten = 0;
          this._totalRead = 0;
          this._playbackRate = this._baseRate;
          this._isBuffering = true;
          this._stallCount = 0;
          this._sampleCount = 0;
          this._currentPeak = 0;
          this._fade = 1.0;
          this._smoothedError = 0;
          this._callbackCount = 0;
          this._lastCallbackTime = 0;
          this._calibrationCount = 0;
          this._integral = 0;
          this.port.postMessage({ type: 'LOG', msg: `🔄 Worklet: State reset complete.` });
          return;
        }
        // Handle config messages (bit depth switching)
        if (e.data && e.data.type === 'CONFIG') {
          if (e.data.bitDepth) {
            this._bitDepth = e.data.bitDepth;
            this.port.postMessage({ type: 'LOG', msg: `🔧 Worklet: Bit depth set to ${this._bitDepth}-bit` });
          }
          if (e.data.baseRateRatio !== undefined) {
            this._baseRate = e.data.baseRateRatio;
            this._playbackRate = this._baseRate;
            this._baseRateInitial = this._baseRate;
            this._baseRateMin = this._baseRate - 0.015;
            this._baseRateMax = this._baseRate + 0.015;
            this.port.postMessage({ type: 'LOG', msg: `🔧 Worklet: Base rate ratio updated to ${this._baseRate.toFixed(4)}x` });
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
          // 24-bit PCM: 3 bytes per sample, little-endian, signed
          const bytes = new Uint8Array(arrayBuffer);
          const numSamples = Math.floor(bytes.length / 3);
          for (let i = 0; i < numSamples; i++) {
            const offset = i * 3;
            let val = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
            if (val & 0x800000) val |= 0xFF000000; // sign extension
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
    
    // Telemetry - purely informational, does NOT modify _baseRate
    if (this._calibrationCount === 0 && this._callbackCount === 150) {
      const elapsed = (now - this._lastCallbackTime) / 1000;
      if (elapsed > 0.1) {
        const measuredHz = this._callbackCount / elapsed;
        this._calibrationCount = 1;
        this.port.postMessage({ type: 'LOG', msg: `📊 Startup Fast Telemetry: ${measuredHz.toFixed(1)} Hz | Nominal BaseRate: ${this._baseRate.toFixed(4)}x` });
      }
      this._callbackCount = 0;
      this._lastCallbackTime = now;
    } else if (this._calibrationCount > 0 && now - this._lastCallbackTime >= 5000) {
      const elapsed = (now - this._lastCallbackTime) / 1000;
      const measuredHz = this._callbackCount / elapsed;
      this.port.postMessage({ type: 'LOG', msg: `📊 Callback Rate: ${measuredHz.toFixed(1)} Hz | Nominal BaseRate: ${this._baseRate.toFixed(4)}x` });
      this._calibrationCount++;
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
      this._integral = 0;
      this.port.postMessage({ type: 'LOG', msg: `⚠️ Ring Overrun: Recovered. Available reset to ${available}.` });
    }
    if (available > this._FLUSH_THRESHOLD) {
      const excess = available - this._TARGET_BUFFER;
      this._totalRead += excess;
      this._readPtr += excess;
      while (this._readPtr >= ringLen) this._readPtr -= ringLen;
      available = this._TARGET_BUFFER;
      this._smoothedError = 0;
      this._integral = 0;
      this.port.postMessage({ type: 'LOG', msg: `⚠️ Latency Catch-up: Flushed ${excess} excess.` });
    }
    if (this._isBuffering) {
      if (available >= this._PREBUFFER) {
        this._isBuffering = false;
        this._smoothedError = 0;
        this._integral = 0;
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
    
    // Accumulate integral slowly for drift correction (tight limit of ±0.003)
    this._integral += this._smoothedError * 0.0000000002;
    this._integral = Math.max(-0.003, Math.min(0.003, this._integral));
    
    // Proportional correction with deadband (tight limit of ±0.008)
    let pAdj = 0;
    const DEADBAND = 1000; // ±10ms at 48kHz stereo
    if (Math.abs(this._smoothedError) > DEADBAND) {
      const overage = this._smoothedError > 0 ? this._smoothedError - DEADBAND : this._smoothedError + DEADBAND;
      pAdj = overage * 0.000002;
    }
    const MAX_ADJUST = 0.008;
    const clampedPAdj = Math.max(-MAX_ADJUST, Math.min(MAX_ADJUST, pAdj));
    
    const targetRate = this._baseRate + clampedPAdj + this._integral;
    this._playbackRate = (this._playbackRate * 0.98) + (targetRate * 0.02);
    this._playbackRate = Math.max(this._baseRateMin, Math.min(this._baseRateMax, this._playbackRate));
    
    let readPtrFrames = this._readPtr / 2;
    let samplesConsumed = 0;
    const playbackRate = this._playbackRate;
    let fade = this._fade;
    const ringLenFrames = ringLen / 2;
    const INV_32768 = 3.0517578125e-5;
    
    let i = 0;
    let framesToProcess = Math.floor((available - 4) / (2 * playbackRate));
    if (framesToProcess < 0) {
      framesToProcess = 0;
    } else if (framesToProcess > channel0.length) {
      framesToProcess = channel0.length;
    }

    const isUnity = Math.abs(playbackRate - 1.0) < 0.0001;
    
    if (isUnity && fade >= 1.0) {
      // Optimized direct copy (no interpolation, no fraction arithmetic)
      for (; i < framesToProcess; i++) {
        const frameIndex = readPtrFrames | 0;
        const idx = frameIndex * 2;
        channel0[i] = this._ringBuffer[idx] * INV_32768;
        channel1[i] = this._ringBuffer[idx + 1] * INV_32768;
        readPtrFrames++;
        if (readPtrFrames >= ringLenFrames) readPtrFrames -= ringLenFrames;
      }
    } else if (fade >= 1.0) {
      // Normal interpolation
      for (; i < framesToProcess; i++) {
        const frameIndex = readPtrFrames | 0;
        const frac = readPtrFrames - frameIndex;
        const idxL1 = frameIndex * 2;
        const idxL2 = idxL1 + 2;
        const vL1 = this._ringBuffer[idxL1];
        const vR1 = this._ringBuffer[idxL1 + 1];
        channel0[i] = (vL1 + (this._ringBuffer[idxL2] - vL1) * frac) * INV_32768;
        channel1[i] = (vR1 + (this._ringBuffer[idxL2 + 1] - vR1) * frac) * INV_32768;
        readPtrFrames += playbackRate;
        if (readPtrFrames >= ringLenFrames) readPtrFrames -= ringLenFrames;
      }
    } else {
      // Normal interpolation with fade-in
      for (; i < framesToProcess; i++) {
        const frameIndex = readPtrFrames | 0;
        const frac = readPtrFrames - frameIndex;
        const idxL1 = frameIndex * 2;
        const idxL2 = idxL1 + 2;
        const vL1 = this._ringBuffer[idxL1];
        const vR1 = this._ringBuffer[idxL1 + 1];
        const valL = (vL1 + (this._ringBuffer[idxL2] - vL1) * frac) * INV_32768;
        const valR = (vR1 + (this._ringBuffer[idxL2 + 1] - vR1) * frac) * INV_32768;
        readPtrFrames += playbackRate;
        if (readPtrFrames >= ringLenFrames) readPtrFrames -= ringLenFrames;
        fade += 0.02;
        if (fade > 1.0) fade = 1.0;
        channel0[i] = valL * fade;
        channel1[i] = valR * fade;
      }
    }

    // Perform peak detection only once per block to save CPU
    if (framesToProcess > 0) {
      const valL = channel0[0];
      const valR = channel1[0];
      const absL = valL < 0 ? -valL : valL;
      const absR = valR < 0 ? -valR : valR;
      const peak = absL > absR ? absL : absR;
      if (peak > this._currentPeak) this._currentPeak = peak;
    }

    samplesConsumed = i * 2 * playbackRate;
    
    // Fill the rest with silence/fade-out
    if (i < channel0.length) {
      for (; i < channel0.length; i++) {
        if (fade > 0) fade -= 0.05;
        if (fade < 0) fade = 0;
        channel0[i] = 0;
        channel1[i] = 0;
      }
    }
    this._readPtr = readPtrFrames * 2;
    this._totalRead += samplesConsumed;
    this._fade = fade;
    this._sampleCount += 128;
    if (this._sampleCount >= 96000) {
      const currentAvailable = this._totalWritten - this._totalRead;
      this.port.postMessage({ type: 'DIAG', available: Math.floor(currentAvailable), stalled: this._stallCount, peak: this._currentPeak, rate: this._playbackRate, locked: (Math.abs(this._smoothedError) < 12000) });
      this._currentPeak = 0;
      this._sampleCount = 0;
    }
    return true;
  }
}
registerProcessor('pcm-player-worklet', PCMPlayerProcessor);

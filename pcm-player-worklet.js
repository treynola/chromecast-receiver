/* global AudioWorkletProcessor, registerProcessor */
/**
 * PCM Player AudioWorkletProcessor - Direct Handshake Engine [v13.9.17]
 * Optimized for zero-jitter Direct Binary Bridge (WebSocket).
 * ES5 COMPATIBILITY MODE: Removed const/let/arrow functions.
 */
class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ringBuffer = new Float32Array(48000 * 8); 
    this._readPtr = 0.0;
    this._writePtr = 0;
    this._bufferSize = 0;
    
    this._TARGET_BUFFER = 48000;
    this._MIN_BUFFER = 12000;    
    this._PREBUFFER = 24000;     
    this._DEAD_ZONE = 2400;      
    
    this._isBuffering = true;
    this._stallCount = 0;
    this._sampleCount = 0;
    this._currentPeak = 0;
    this._fade = 1.0; 
    
    this._playbackRate = 1.0;
    this._targetPlaybackRate = 1.0;
    this._errorSum = 0;
    this._smoothedError = 0;
    
    this._kp = 0.000005; 
    this._ki = 0.00000002;
    this._diagCount = 0;

    var self = this;
    this.port.onmessage = function(e) {
      try {
        var arrayBuffer = (e.data instanceof ArrayBuffer) ? e.data : e.data.buffer;
        if (!arrayBuffer) return;
        
        var pcm16 = new Int16Array(arrayBuffer);
        var float32 = new Float32Array(pcm16.length);
        
        for (var i = 0; i < pcm16.length; i++) {
          float32[i] = pcm16[i] / 32768.0;
        }
        
        self._writeToBuffer(float32);
      } catch (err) {
        self.port.postMessage({ type: 'LOG', msg: '❌ Worklet Error: ' + err.message });
      }
    };
  }

  _writeToBuffer(pcm) {
    for (var i = 0; i < pcm.length; i++) {
      // [v13.9.17] FIXED: No more double-division. Signal is already normalized.
      this._ringBuffer[this._writePtr] = pcm[i];
      this._writePtr = (this._writePtr + 1) % this._ringBuffer.length;
      this._bufferSize++;
    }
    
    if (this._bufferSize > 144000) {
      this._readPtr = this._writePtr - this._TARGET_BUFFER;
      if (this._readPtr < 0) this._readPtr += this._ringBuffer.length;
      this._bufferSize = this._TARGET_BUFFER;
      this._errorSum = 0;
    }
  }

  process(inputs, outputs) {
    var output = outputs[0];
    var channel0 = output[0];
    var channel1 = output[1];

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

    var rawError = this._bufferSize - this._TARGET_BUFFER;
    this._smoothedError = (this._smoothedError * 0.99) + (rawError * 0.01); 

    if (Math.abs(this._smoothedError) < this._DEAD_ZONE) {
        this._targetPlaybackRate = 1.0 + (this._errorSum * this._ki); 
        this._errorSum *= 0.999; 
    } else {
        this._errorSum += this._smoothedError;
        var adj = (this._smoothedError * this._kp) + (this._errorSum * this._ki);
        this._targetPlaybackRate = Math.max(0.8, Math.min(1.2, 1.0 + adj));
    }
    
    this._playbackRate = (this._playbackRate * 0.995) + (this._targetPlaybackRate * 0.005);
    var ringLen = this._ringBuffer.length;

    for (var i = 0; i < channel0.length; i++) {
      if (this._bufferSize >= 4) {
        var frameIndex = Math.floor(this._readPtr / 2);
        var iL = (frameIndex * 2) % ringLen;
        var nextIL = (iL + 2) % ringLen;
        var fract = (this._readPtr / 2) - frameIndex;

        var vL1 = this._ringBuffer[iL];
        var vL2 = this._ringBuffer[nextIL];
        var valL = vL1 + fract * (vL2 - vL1);

        var iR = (iL + 1) % ringLen;
        var nextIR = (iR + 2) % ringLen;
        var vR1 = this._ringBuffer[iR];
        var vR2 = this._ringBuffer[nextIR];
        var valR = vR1 + fract * (vR2 - vR1);

        this._readPtr = (this._readPtr + (2 * this._playbackRate)) % ringLen;
        this._bufferSize -= (2 * this._playbackRate);

        if (this._fade < 1.0) this._fade += 0.02;
        
        channel0[i] = valL * this._fade;
        channel1[i] = valR * this._fade;

        var p = Math.max(Math.abs(valL), Math.abs(valR));
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

    this._diagCount++;
    if (this._diagCount % 150 === 0) {
        this.port.postMessage({
            type: 'DIAG',
            rate: this._playbackRate,
            buf: this._bufferSize,
            locked: !this._isBuffering
        });
    }

    return true;
  }
}

registerProcessor('pcm-player-worklet', PCMPlayerProcessor);

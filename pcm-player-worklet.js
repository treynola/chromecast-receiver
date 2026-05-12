/* global AudioWorkletProcessor, registerProcessor */
/**
 * pcm-player-worklet.js
 * [V13.8.135] HIGH-STABILITY PCM PLAYER
 * Hardened with robust buffer detection and detailed diagnostic telemetry.
 */

class PCMPlayerProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._BUFFER_SIZE = 128000;
        this._ringBuffer = new Float32Array(this._BUFFER_SIZE);
        this._wPtr = 0;
        this._rPtr = 0;
        this._isStalled = true;
        this._playbackRate = 1.0;
        this._phase = 0;
        
        // Jitter / Stability Thresholds
        this._MIN_BUFFER = 4000;  // Minimum samples before we consider stalling
        this._PREBUFFER = 12000;  // Samples needed to recover from stall
        
        // Telemetry
        this._totalSamplesReceived = 0;
        this._msgCount = 0;
        this._lastMsgSize = 0;
        this._lastDiagTime = 0;

        this.port.onmessage = (e) => {
            try {
                const buf = e.data;
                // [V13.8.135] Robust Buffer Detection
                if (buf && (buf instanceof ArrayBuffer || buf.byteLength !== undefined)) {
                    this._msgCount++;
                    this._lastMsgSize = buf.byteLength;
                    
                    // Assume Int16 PCM (2 bytes per sample)
                    const i16 = new Int16Array(buf);
                    const count = i16.length;
                    
                    for (let i = 0; i < count; i++) {
                        this._ringBuffer[this._wPtr] = i16[i] / 32768.0;
                        this._wPtr = (this._wPtr + 1) % this._BUFFER_SIZE;
                        this._totalSamplesReceived++;
                    }
                }
            } catch (err) {
                // Silently handle errors to avoid process crashes
            }
        };
    }

    get available() {
        if (this._wPtr >= this._rPtr) {
            return this._wPtr - this._rPtr;
        }
        return this._BUFFER_SIZE - (this._rPtr - this._wPtr);
    }

    process(inputs, outputs) {
        const output = outputs[0];
        const outL = output[0];
        const outR = output[1];
        if (!outL || !outR) return true;

        const currentAvailable = this.available;

        // Stall Logic: Fill with silence if we don't have enough data
        if (currentAvailable < this._MIN_BUFFER && !this._isStalled) {
            this._isStalled = true;
        }
        if (currentAvailable > this._PREBUFFER && this._isStalled) {
            this._isStalled = false;
        }

        if (this._isStalled) {
            outL.fill(0);
            outR.fill(0);
        } else {
            // High-fidelity resampling loop
            for (let i = 0; i < outL.length; i++) {
                const idx1L = this._rPtr;
                const idx1R = (this._rPtr + 1) % this._BUFFER_SIZE;
                const idx2L = (this._rPtr + 2) % this._BUFFER_SIZE;
                const idx2R = (this._rPtr + 3) % this._BUFFER_SIZE;
                const frac = this._phase;

                const sampleL = this._ringBuffer[idx1L] * (1 - frac) + this._ringBuffer[idx2L] * frac;
                const sampleR = this._ringBuffer[idx1R] * (1 - frac) + this._ringBuffer[idx2R] * frac;

                outL[i] = sampleL;
                outR[i] = sampleR;

                this._phase += this._playbackRate;
                if (this._phase >= 1.0) {
                    const advance = Math.floor(this._phase);
                    this._rPtr = (this._rPtr + advance * 2) % this._BUFFER_SIZE;
                    this._phase -= advance;
                }
            }
            
            // Dynamic Clock Sync (Gentle drift correction)
            if (currentAvailable > 48000) this._playbackRate = 1.001;
            else if (currentAvailable < 24000) this._playbackRate = 0.999;
            else this._playbackRate = 1.0;
        }

        // Diagnostic Relay (Non-blocking)
        // [V13.8.135] Expanded telemetry
        if (typeof currentTime !== 'undefined' && currentTime > (this._lastDiagTime + 0.5)) {
            this.port.postMessage({
                type: 'DIAG',
                available: currentAvailable,
                stalled: this._isStalled,
                rate: this._playbackRate.toFixed(4),
                totalSamples: this._totalSamplesReceived,
                msgCount: this._msgCount,
                lastMsgSize: this._lastMsgSize
            });
            this._lastDiagTime = currentTime;
        }

        return true;
    }
}

registerProcessor('pcm-player-processor', PCMPlayerProcessor);

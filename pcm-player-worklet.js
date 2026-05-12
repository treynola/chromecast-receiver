/* global AudioWorkletProcessor, registerProcessor */
/**
 * PCMPlayerProcessor
 * [V13.8.130] High-Performance Jitter-Buffer & Resampler
 * Handles real-time PCM playback with clock drift correction.
 */
class PCMPlayerProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._BUFFER_SIZE = 128000;
        this._ringBuffer = new Float32Array(this._BUFFER_SIZE);
        this._wPtr = 0;
        this._rPtr = 0;
        this._playbackRate = 1.0;
        this._phase = 0;
        this._isStalled = true; 
        this._diagCounter = 0; // [V13.8.134] Diagnostic rate limiter
        this._stalledLogTrigger = false;

        this.port.onmessage = (e) => {
            if (e.data instanceof ArrayBuffer) {
                const i16 = new Int16Array(e.data);
                for (let i = 0; i < i16.length; i++) {
                    this._ringBuffer[this._wPtr] = i16[i] / 32768.0;
                    this._wPtr = (this._wPtr + 1) % this._BUFFER_SIZE;
                }
            }
        };
    }

    process(inputs, outputs) {
        const output = outputs[0];
        const outL = output[0];
        const outR = output[1];
        if (!outL || !outR) return true;

        const available = (this._wPtr - this._rPtr + this._BUFFER_SIZE) % this._BUFFER_SIZE;

        // [V13.8.134] Periodic Diagnostics (Relayed to Studio)
        this._diagCounter++;
        if (this._diagCounter % 128 === 0) {
            this.port.postMessage({
                type: 'DIAG',
                available: available,
                stalled: this._isStalled,
                rate: this._playbackRate.toFixed(3)
            });
        }

        // [V13.8.130] Dynamic Jitter Buffer Management
        if (available > 16000) this._playbackRate = 1.02;      
        else if (available < 4096) this._playbackRate = 0.98;  
        else this._playbackRate = 1.0;

        // [V13.8.134] Robust Underflow / Pre-buffering Logic
        if (this._isStalled) {
            if (available > 4096) { // Increased threshold for stability
                this._isStalled = false;
                this.port.postMessage({ type: 'LOG', msg: '🔊 Jitter Buffer Primed - Playback Resumed' });
            } else {
                outL.fill(0);
                outR.fill(0);
                return true;
            }
        }

        if (available < 512) {
            this._isStalled = true;
            this.port.postMessage({ type: 'LOG', msg: '⚠️ Audio Underflow - Re-buffering...' });
            outL.fill(0);
            outR.fill(0);
            return true;
        }

        for (let i = 0; i < outL.length; i++) {
            // [V13.8.134] SAFE INDEXING FOR STEREO INTERLEAVING
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

        return true;
    }
}

registerProcessor('pcm-player-processor', PCMPlayerProcessor);

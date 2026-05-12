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
        this._isStalled = true; // [V13.8.130] Start stalled to pre-buffer

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

        // [V13.8.130] Dynamic Jitter Buffer Management
        // Target: 4096 samples (~85ms) for stability over Wi-Fi
        if (available > 12000) this._playbackRate = 1.02;      // Drain faster
        else if (available < 2048) this._playbackRate = 0.98;  // Slow down
        else this._playbackRate = 1.0;

        // [V13.8.130] Underflow / Pre-buffering Logic
        if (this._isStalled) {
            if (available > 2048) {
                this._isStalled = false;
                console.log('🔊 Jitter Buffer Primed - Starting Playback');
            } else {
                outL.fill(0);
                outR.fill(0);
                return true;
            }
        }

        if (available < 256) {
            this._isStalled = true;
            console.warn('⚠️ Audio Underflow - Re-buffering...');
            outL.fill(0);
            outR.fill(0);
            return true;
        }

        for (let i = 0; i < outL.length; i++) {
            // Linear Interpolation Resampling
            const idx1 = (this._rPtr) % this._BUFFER_SIZE;
            const idx2 = (this._rPtr + 2) % this._BUFFER_SIZE;
            const frac = this._phase;

            const sampleL = this._ringBuffer[idx1] * (1 - frac) + this._ringBuffer[idx2] * frac;
            const sampleR = this._ringBuffer[idx1 + 1] * (1 - frac) + this._ringBuffer[idx2 + 1] * frac;

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

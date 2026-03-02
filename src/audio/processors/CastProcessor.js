/**
 * CastProcessor.js
 * AudioWorklet for high-priority audio capture.
 * Ensures the cast stream doesn't "garble" when the main thread is busy.
 */
class CastProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 4096; // V114.10: 4096 samples (~85ms) to stop IPC stuttering (was 1024)
        this.bufferIndex = 0;
        this.leftBuffer = new Float32Array(this.bufferSize);
        this.rightBuffer = new Float32Array(this.bufferSize);
    }

    process(inputs) {
        const input = inputs[0];
        if (!input || input.length === 0) return true;

        const leftInput = input[0];
        const rightInput = input[1] || input[0]; // Fallback to mono if needed

        // Fill internal buffer
        for (let i = 0; i < leftInput.length; i++) {
            this.leftBuffer[this.bufferIndex] = leftInput[i];
            this.rightBuffer[this.bufferIndex] = rightInput[i];
            this.bufferIndex++;

            if (this.bufferIndex >= this.bufferSize) {
                // Buffer full, send to main thread
                this.port.postMessage({
                    left: this.leftBuffer.slice(),
                    right: this.rightBuffer.slice()
                });
                this.bufferIndex = 0;
            }
        }

        return true;
    }
}

try {
    registerProcessor('cast-processor', CastProcessor);
} catch {
    // Already registered in this context
}


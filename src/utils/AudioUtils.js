/**
 * Audio Utility Functions
 * Namespaced to window.AudioUtils to match existing project structure.
 */

window.AudioUtils = window.AudioUtils || {};

(function (exports) {

    function interleave(leftChannel, rightChannel) {
        const length = leftChannel.length + rightChannel.length;
        const result = new Float32Array(length);
        let inputIndex = 0;
        for (let index = 0; index < length;) {
            result[index++] = leftChannel[inputIndex];
            result[index++] = rightChannel[inputIndex];
            inputIndex++;
        }
        return result;
    }

    function writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
    }

    function floatTo16BitPCM(output, offset, input) {
        for (let i = 0; i < input.length; i++, offset += 2) {
            const s = Math.max(-1, Math.min(1, input[i]));
            output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
    }

    function encodeWAV(audioBuffer) {
        const left = audioBuffer.getChannelData(0);
        const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;
        const interleaved = interleave(left, right);
        const buffer = new ArrayBuffer(44 + interleaved.length * 2);
        const view = new DataView(buffer);
        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + interleaved.length * 2, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, audioBuffer.numberOfChannels, true);
        view.setUint32(24, audioBuffer.sampleRate, true);
        view.setUint32(28, audioBuffer.sampleRate * 4, true);
        view.setUint16(32, 4, true);
        view.setUint16(34, 16, true);
        writeString(view, 36, 'data');
        view.setUint32(40, interleaved.length * 2, true);
        floatTo16BitPCM(view, 44, interleaved);
        return new Blob([view], { type: 'audio/wav' });
    }

    async function blobToWav(blob) {
        const arrayBuffer = await blob.arrayBuffer();
        // Assuming Tone is available globally as it is in the main app
        const originalBuffer = await window.Tone.context.decodeAudioData(arrayBuffer);

        let targetBuffer = originalBuffer;

        const targetSR = window.Tone.context.sampleRate;
        // Force Resample if mismatched
        if (originalBuffer.sampleRate !== targetSR) {
            console.log(`AudioUtils: Resampling from ${originalBuffer.sampleRate} to ${targetSR}Hz...`);
            try {
                // Detect available OfflineAudioContext
                const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
                if (OfflineContext) {
                    const newLength = Math.ceil(originalBuffer.duration * targetSR);
                    const offline = new OfflineContext(
                        originalBuffer.numberOfChannels,
                        newLength,
                        targetSR
                    );
                    const source = offline.createBufferSource();
                    source.buffer = originalBuffer;
                    source.connect(offline.destination);
                    source.start();
                    targetBuffer = await offline.startRendering();
                    console.log("AudioUtils: Resampled successfully.");
                }
            } catch (err) {
                console.warn("AudioUtils: Resampling failed. Using original rate.", err);
            }
        }

        return encodeWAV(targetBuffer);
    }

    // --- PCM Recorder (AudioWorklet Version) ---
    // Single static property to track module registration per context
    const registeredContexts = new WeakSet();

    class PCMRecorder {
        constructor(context) {
            // Use Tone's context directly for the input node
            this.toneContext = context || window.Tone.context;

            // v10.13c: Lock the NATIVE context at construction.
            // Two tiers: rawContext for node creation, deeper native for AudioWorkletNode.
            try {
                let rawCtx;
                if (window.audioService && window.audioService.contextManager) {
                    rawCtx = window.audioService.contextManager.getNativeContext();
                } else {
                    rawCtx = this.toneContext.rawContext || this.toneContext;
                }
                this._lockedNativeContext = rawCtx;

                // AudioWorkletNode in Safari requires the ACTUAL BaseAudioContext,
                // not Tone's wrapper. Unwrap one deeper level.
                this._baseAudioContext = rawCtx._nativeAudioContext || rawCtx;
            } catch (e) {
                console.warn("PCMRecorder: Context resolution error, using Tone fallback.", e);
                const fallback = Tone.context.rawContext || Tone.context;
                this._lockedNativeContext = fallback;
                this._baseAudioContext = fallback._nativeAudioContext || fallback;
            }

            if (!this._lockedNativeContext) {
                console.error("PCMRecorder: FATAL - No native context found. Recording will fail.");
                const fallback = Tone.context.rawContext || Tone.context;
                this._lockedNativeContext = fallback;
                this._baseAudioContext = fallback._nativeAudioContext || fallback;
            }

            this._inputNode = null;
            this._nativeInputNode = null; // v10.10 Native path

            this.leftBuffers = [];
            this.rightBuffers = [];
            this.recordingLength = 0;
            this.isRecording = false;
        }

        get context() {
            // v10.13c: Return the BASE audio context (deepest native).
            // AudioWorkletNode, nativeInput GainNode, and silentGain must ALL
            // be on the exact same context object = _baseAudioContext.
            return this._baseAudioContext;
        }

        /**
         * v10.13c: Native entry point for recording.
         * Creates nodes on _baseAudioContext to match AudioWorkletNode.
         */
        get nativeInput() {
            if (!this._nativeInputNode) {
                this._nativeInputNode = this._baseAudioContext.createGain();
                this._nativeInputNode.gain.value = 1.0;
                console.log(`PCMRecorder: Created Native Input Node on BASE context`);
            }
            return this._nativeInputNode;
        }

        get input() {
            if (!this._inputNode) {
                this._inputNode = new window.Tone.Gain({ context: this.toneContext });
            }
            return this._inputNode;
        }

        async start() {
            if (!this._baseAudioContext) throw new Error("PCMRecorder: No AudioContext available");

            if (this._baseAudioContext.state !== 'running') await this._baseAudioContext.resume();

            this.leftBuffers = [];
            this.rightBuffers = [];
            this.recordingLength = 0;

            // V12.98: Pre-registered module check
            if (!registeredContexts.has(this._baseAudioContext)) {
                await PCMRecorder.registerModule(this._baseAudioContext);
            }

            // V13.1: Calculate full Round-Trip Latency (RTL)
            const baseLatency = this._baseAudioContext.baseLatency || 0.01; // Input latency
            const outputLatency = this._baseAudioContext.outputLatency || 0.02; // Output latency
            const totalLatency = baseLatency + outputLatency;

            this.latencySamples = Math.floor(totalLatency * this._baseAudioContext.sampleRate);
            console.log(`PCMRecorder: Compensating for ${(totalLatency * 1000).toFixed(1)}ms Round-Trip Latency (${this.latencySamples} samples)`);

            // 2. Create Node — on _baseAudioContext (true BaseAudioContext for Safari)
            this.workletNode = new AudioWorkletNode(this._baseAudioContext, 'recorder-processor', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [2],
                processorOptions: {
                    latencySamples: this.latencySamples
                }
            });

            // 3. Listen for Data
            this.workletNode.port.onmessage = (e) => {
                if (e.data.type === 'alive') return;
                if (e.data.type === 'peak') {
                    if (this.isRecording) {
                        if (e.data.value > 0.000001) {
                            if (Math.random() < 0.1) {
                                console.log(`PCMRecorder: Signal detected. Peak: ${e.data.value.toFixed(4)} | Channels: ${e.data.channels}`);
                            }
                        } else if (Math.random() < 0.05) {
                            console.warn(`PCMRecorder: ⚠️ SILENT INPUT (Peak: ${e.data.value}, Ch: ${e.data.channels})`);
                        }
                    }
                    return;
                }
                if (!this.isRecording) return;

                if (e.data.type === 'data') {
                    this.leftBuffers.push(e.data.left);
                    this.rightBuffers.push(e.data.right);
                    this.recordingLength += e.data.left.length;

                    // Sample-Accurate Auto-Stop Logic
                    if (this.targetSampleCount && this.recordingLength >= this.targetSampleCount) {
                        console.log(`PCMRecorder: Target ${this.targetSampleCount} reached. Stopping.`);
                        this.isRecording = false;
                        if (this.onComplete) this.onComplete();
                    }
                }
            };

            // 4. Bridge — nativeInput and workletNode are BOTH on _baseAudioContext
            try {
                this.nativeInput.connect(this.workletNode);
                console.log(`PCMRecorder: ✅ Internal bridge established [nativeInput -> worklet]`);
            } catch (bridgeErr) {
                console.error(`PCMRecorder: Internal bridge failure:`, bridgeErr);
            }

            // Keep-alive connect (Muted) — also on _baseAudioContext
            try {
                this.silentGain = this._baseAudioContext.createGain();
                this.silentGain.gain.value = 0;
                this.workletNode.connect(this.silentGain);
                this.silentGain.connect(this._baseAudioContext.destination);
            } catch (e) { }

            this.isRecording = true;
            console.log("🔴 PCMRecorder: Recording started.");
        }

        static async registerModule(context) {
            if (registeredContexts.has(context)) return;
            console.log("PCMRecorder: Registering AudioWorklet Code...");
            const workletCode = `
                class RecorderProcessor extends AudioWorkletProcessor {
                    constructor(options) {
                        super();
                        this.bufferSize = 2048; // Lowered from 8192 for lower chunk latency
                        this.bufferL = new Float32Array(this.bufferSize);
                        this.bufferR = new Float32Array(this.bufferSize);
                        this.index = 0;
                        this._peak = 0;
                        this._peakCount = 0;
                        this.samplesToSkip = options.processorOptions?.latencySamples || 0;
                        this.skippedSamples = 0;
                        this.port.postMessage({ type: 'alive', skipping: this.samplesToSkip });
                    }
                    process(inputs) {
                        const input = inputs[0];
                        if (!input || input.length === 0) return true;
                        const leftIn = input[0];
                        const rightIn = input.length > 1 ? input[1] : leftIn;
                        if (!leftIn) return true;

                        for (let i = 0; i < leftIn.length; i++) {
                            // V13.0 Latency Compensation: Discard initial hardware buffer silence
                            if (this.skippedSamples < this.samplesToSkip) {
                                this.skippedSamples++;
                                continue;
                            }

                            const valL = leftIn[i];
                            const valR = rightIn[i];

                            const abs = Math.max(Math.abs(valL), Math.abs(valR));
                            if (abs > this._peak) this._peak = abs;

                            this.bufferL[this.index] = valL;
                            this.bufferR[this.index] = valR;
                            this.index++;
                            if (this.index >= this.bufferSize) {
                                this.port.postMessage({ type: 'data', left: this.bufferL.slice(), right: this.bufferR.slice() });
                                this.index = 0;
                            }
                        }

                        // Periodic Peak Reporting
                        this._peakCount++;
                        if (this._peakCount > 30) {
                            if (this._peak > 0 && this._peak < 0.0001) {
                                // Potentially ultra-low signal
                            }
                            this.port.postMessage({ type: 'peak', value: this._peak, channels: input.length });
                            this._peak = 0;
                            this._peakCount = 0;
                        }

                        return true;
                    }
                }
                registerProcessor('recorder-processor', RecorderProcessor);
            `;
            const blob = new Blob([workletCode], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            await context.audioWorklet.addModule(url);
            registeredContexts.add(context);
        }

        async stop() {
            this.isRecording = false;
            this.onComplete = null;

            if (this.workletNode) {
                this.workletNode.disconnect();
                this.workletNode = null;
            }

            // V12.98: Bit-Perfect Sample Clipping
            // Ensure we only return EXACTLY what was requested
            const finalLength = this.targetSampleCount ? Math.min(this.recordingLength, this.targetSampleCount) : this.recordingLength;

            let leftBuffer = this._mergeBuffers(this.leftBuffers, finalLength);
            let rightBuffer = this._mergeBuffers(this.rightBuffers, finalLength);

            console.log(`PCMRecorder: Final Truncated Samples: ${finalLength} (Target: ${this.targetSampleCount || 'N/A'})`);

            // Safety: Return minimal silence if no data recorded (v10.09: Increase to 128 samples for decoder stability)
            if (finalLength === 0) {
                const dummyBuffer = this.context.createBuffer(2, 128, this.context.sampleRate);
                return encodeWAV(dummyBuffer);
            }

            // Mono-to-Stereo Duplication
            let rightIsSilent = true;
            for (let i = 0; i < Math.min(rightBuffer.length, 1000); i++) {
                if (Math.abs(rightBuffer[i]) > 0.0001) {
                    rightIsSilent = false;
                    break;
                }
            }
            if (rightIsSilent) {
                rightBuffer.set(leftBuffer);
            }

            // V13.2: 5ms Micro-Fade purely for Loop Zero-Crossing Smoothing (No clicks!)
            const fadeSamples = Math.min(Math.floor(finalLength / 2), Math.floor(this.context.sampleRate * 0.005));
            for (let i = 0; i < fadeSamples; i++) {
                const fadeMultiplier = i / fadeSamples;
                // Fade In head
                leftBuffer[i] *= fadeMultiplier;
                rightBuffer[i] *= fadeMultiplier;
                // Fade Out tail
                const tailIndex = finalLength - 1 - i;
                leftBuffer[tailIndex] *= fadeMultiplier;
                rightBuffer[tailIndex] *= fadeMultiplier;
            }

            // Create AudioBuffer
            const audioBuffer = this.context.createBuffer(2, finalLength, this.context.sampleRate);
            audioBuffer.copyToChannel(leftBuffer, 0);
            audioBuffer.copyToChannel(rightBuffer, 1);

            return encodeWAV(audioBuffer);
        }

        _mergeBuffers(buffers, totalTargetLength) {
            const result = new Float32Array(totalTargetLength);
            let offset = 0;
            for (let i = 0; i < buffers.length; i++) {
                const chunk = buffers[i];
                const spaceLeft = totalTargetLength - offset;
                if (spaceLeft <= 0) break;

                const toCopy = Math.min(chunk.length, spaceLeft);
                result.set(chunk.subarray(0, toCopy), offset);
                offset += toCopy;
            }
            return result;
        }

        dispose() {
            this.isRecording = false;
            // Disconnect and cleanup to prevent engine slowdown
            if (this._inputNode) {
                try {
                    this._inputNode.disconnect();
                    this._inputNode.dispose();
                } catch (e) { }
                this._inputNode = null;
            }
            if (this.workletNode) {
                try {
                    this.workletNode.disconnect();
                } catch (e) { }
                this.workletNode = null;
            }
            if (this.silentGain) {
                try {
                    this.silentGain.disconnect();
                } catch (e) { }
                this.silentGain = null;
            }
            this.leftBuffers = null;
            this.rightBuffers = null;
        }
    }

    // Export functions
    exports.interleave = interleave;
    exports.writeString = writeString;
    exports.floatTo16BitPCM = floatTo16BitPCM;
    exports.encodeWAV = encodeWAV;
    exports.blobToWav = blobToWav;
    exports.PCMRecorder = PCMRecorder;

})(window.AudioUtils);

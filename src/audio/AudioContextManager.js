/**
 * AudioContextManager
 * Handles the global audio context, master output chain, and global sources like LFOs.
 */
(function () {
    // V114.6: Force hardware-aligned 48kHz context before ANY nodes are created.
    // This MUST happen at script load to prevent context mismatches with deferred scripts.
    // V114.20: Strictly Force hardware-aligned 48kHz context.
    try {
        if (window.Tone && (!window._mxsAudioInited || Tone.context.sampleRate !== 48000)) {
            console.log("🔊 AudioContextManager (V114.20): Forcing hardware alignment (48kHz)...");
            const rawCtx = new (window.AudioContext || window.webkitAudioContext)({ 
                sampleRate: 48000,
                latencyHint: 'playback' // Higher stability for casting
            });
            Tone.setContext(new Tone.Context(rawCtx));
            window._mxsAudioInited = true;
        }
    } catch (e) {
        console.error("❌ AudioContextManager: Hardware alignment failed:", e);
    }

    class AudioContextManager {
        constructor() {
            // V12.75: Minimalist Constructor (Lazy Build)

            // --- Clock Drift Logic (V12.75: Focus Verified) ---
            const runVerifiedDriftCheck = () => {
                if (Tone.context.state !== 'running') {
                    requestAnimationFrame(runVerifiedDriftCheck);
                    return;
                }

                // Wait for the window to have focus (macOS Power Management)
                if (!document.hasFocus()) {
                    setTimeout(runVerifiedDriftCheck, 1000);
                    return;
                }

                setTimeout(() => {
                    const startReal = performance.now();
                    const startTone = Tone.now();

                    setTimeout(() => {
                        const elapsedReal = (performance.now() - startReal) / 1000;
                        const elapsedTone = (Tone.now() - startTone);
                        const ratio = elapsedTone / elapsedReal;
                        console.log(`🕒 Audio Sync: ${(ratio * 100).toFixed(2)}% speed (SR=${Tone.context.sampleRate}).`);
                        if (ratio < 0.75) {
                            console.error(`🚨 CRITICAL ENGINE SLOWDOWN: Audio is running at ${(ratio * 100).toFixed(1)}% speed! Check CPU usage.`);
                        }
                    }, 5000);
                }, 8000);
            };
            runVerifiedDriftCheck();

            this.isInitialized = false;
            this.masterBus = null;
            this.masterVolume = null;
            this.masterLimiter = null;
            this.masterWaveform = null;

            this.lfo = null;
            this.lfo2 = null;
            this.lfoMeter = null;
            this.lfo2Meter = null;

            this.mic = new Tone.UserMedia();
            this.samplerService = null;
            this.router = null;
            this.deviceManager = new window.DeviceManager();
            this.audioRouter = null;
            this.inputStreams = new Map(); // V12.98 Cache deviceId -> MediaStream
        }

        async init() {
            if (this.isInitialized) return;

            // In modern browsers, AudioContext needs a user gesture to start.
            // Awaiting Tone.start() here will cause the track initialization to hang forever until clicked!
            // We just log it. The UI click handlers in scripts.js will call Tone.start() when the user clicks.
            if (Tone.context.state !== 'running') {
                console.log("AudioContextManager: Tone.js Context is suspended. It will be started upon user interaction.");
            }

            // --- V22: Hardware Alignment ---
            // Force latencyHint and channel count
            if (Tone.context.rawContext) {
                Tone.context.rawContext.latencyHint = 'interactive';
            }
            // Ensure context is 48k (Tone.setContext in scripts.js should have handled this, but we double check)
            if (Tone.context.sampleRate !== 48000) {
                console.warn(`🔊 AudioContextManager: Unexpected sample rate ${Tone.context.sampleRate}. Expected 48000.`);
            }
            Tone.context.lookAhead = 0.1;   // Reduced for better recording timing (v10.13h)
            Tone.context.updateInterval = 0.06; // Reduced to match lookAhead
            Tone.context.destination.channelCount = 2;
            Tone.context.destination.volume.value = 0; // Ensure not muted

            // Build Master Chain
            this.masterBus = new Tone.Gain(1);
            this.masterVolume = new Tone.Volume(0);
            this.masterLimiter = new Tone.Limiter(-4); // Slightly more headroom
            this.masterWaveform = [new Tone.Waveform(256), new Tone.Waveform(256)];

            this.masterBus.chain(this.masterVolume, this.masterLimiter);
            this.masterLimiter.toDestination();
            this.masterLimiter.connect(this.masterWaveform[0]);
            this.masterLimiter.connect(this.masterWaveform[1]);

            // Warmup Tone.js to wake up graph
            const silent = new Tone.Oscillator(1, "sine").set({ volume: -Infinity });
            silent.connect(this.masterBus);
            silent.start().stop("+0.1");

            // LFOs (Only created when context is ready)
            this.lfo = new Tone.LFO(1 / 1.8, -1, 1);
            this.lfo2 = new Tone.LFO(1 / 1.8, -1, 1);
            this.lfoMeter = new Tone.Meter({ smoothing: 0.1 });
            this.lfo2Meter = new Tone.Meter({ smoothing: 0.1 });
            this.lfo.connect(this.lfoMeter);
            this.lfo2.connect(this.lfo2Meter);
            // V12.98: LFOs explicitly stopped and muted on launch
            this.lfo.amplitude.value = 0;
            this.lfo2.amplitude.value = 0;
            this.lfo.stop();
            this.lfo2.stop();

            // Sampler
            if (window.SamplerService) {
                this.samplerService = new window.SamplerService(this);
            }

            // Router (Lazy)
            if (window.ToneSimulcastRouter && !this.router) {
                this.router = window.simulcastRouter || new window.ToneSimulcastRouter();
                this.router.connectSource(this.masterLimiter);
            }

            // v4.0 Unified Audio Router
            if (window.AudioRouter) {
                this.audioRouter = new window.AudioRouter(this);
            }

            // V12.98: Pre-register PCMRecorder AudioWorklet to eliminate startup latency
            if (window.AudioUtils && window.AudioUtils.PCMRecorder) {
                try {
                    const rawCtx = Tone.context.rawContext || Tone.context;
                    const baseCtx = rawCtx._nativeAudioContext || rawCtx;
                    window.AudioUtils.PCMRecorder.registerModule(baseCtx);
                    console.log("AudioContextManager: PCMRecorder module pre-registered.");
                } catch (e) {
                    console.warn("AudioContextManager: PCMRecorder pre-registration failed:", e);
                }
            }

            this.isInitialized = true;
            console.log("🔊 AudioContextManager: Stabilized Init Ready (v12.99).");
        }

        // --- Casting Support ---
        getCastStream() {
            if (this.router) return this.router.getCastStream();
            return null;
        }

        startCastCapture() {
            if (this.router) this.router.enableCast();
        }

        stopCastCapture() {
            if (this.router) this.router.disableCast();
        }

        /**
         * Returns the raw hardware AudioContext. 
         * Critical for ensuring PCMRecorder and Tone.js share the same device.
         */
        getNativeContext() {
            // v10.13c: Return Tone's own raw context — NOT _nativeAudioContext.
            // On Safari/WebKit, _nativeAudioContext is a DIFFERENT object than rawContext,
            // and connecting nodes across them causes TypeError.
            // Tone creates all its internal nodes on rawContext, so we must too.
            const native = Tone.context.rawContext || Tone.context;

            if (!native) {
                console.error("AudioContextManager: FATAL - No native context found!");
                return null;
            }

            // Tag for telemetry
            if (!native._ctxId) {
                native._ctxId = `CTX_${Math.floor(Math.random() * 10000)}`;
                console.log(`🔊 AudioContextManager: Tagged Native Context ${native._ctxId} [SR: ${native.sampleRate}]`);
            }
            return native;
        }

        // --- Master Controls ---
        setMasterVolume(dbValue) {
            if (this.masterVolume) {
                const clamped = Math.max(-80, Math.min(20, dbValue));
                this.masterVolume.volume.value = clamped;
            }
        }

        getMasterWaveformNodes() {
            return this.masterWaveform;
        }

        getLfo(index) {
            return index === 1 ? this.lfo : this.lfo2;
        }

        getLfoMeter(index) {
            return index === 1 ? this.lfoMeter : this.lfo2Meter;
        }

        async warmUpMic() {
            // Manual Triggered Warmup
            try {
                await this.getSharedInputStream(null);
                console.log("AudioContextManager: Microphone warmed up.");
            } catch (e) {
                console.warn("AudioContextManager: Mic warm up failed:", e);
            }
        }

        async getSharedInputStream(deviceId) {
            const key = deviceId || 'default';
            if (this.inputStreams.has(key)) {
                const stream = this.inputStreams.get(key);
                if (stream.active) return stream;
                this.inputStreams.delete(key);
            }

            const constraints = {
                audio: {
                    deviceId: deviceId ? { exact: deviceId } : undefined,
                    channelCount: { ideal: 16 },
                    echoCancellation: false,
                    autoGainControl: false,
                    noiseSuppression: false,
                    sampleRate: { ideal: 48000 }
                }
            };

            console.log(`AudioContextManager: Negotiating new stream for ${key}...`);
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.inputStreams.set(key, stream);
            return stream;
        }
    }

    window.AudioContextManager = AudioContextManager;
})();

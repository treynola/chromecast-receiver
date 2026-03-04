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
            console.log("🔊 AudioContextManager (V12.101): Forcing hardware alignment (48kHz)...");
            const rawCtx = new (window.AudioContext || window.webkitAudioContext)({ 
                sampleRate: 48000,
                latencyHint: 'interactive'
            });
            window._mxsRawAudioContext = rawCtx;
            window._mxsRawInitTime = performance.now();
            window._mxsRawAudioInitTime = rawCtx.currentTime;
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
            const runContinuousDriftCheck = () => {
                if (Tone.context.state !== 'running') {
                    requestAnimationFrame(runContinuousDriftCheck);
                    return;
                }

                // Wait for the window to have focus (macOS Power Management)
                if (!document.hasFocus()) {
                    setTimeout(runContinuousDriftCheck, 1000);
                    return;
                }

                this._checkClockDrift();
                setTimeout(runContinuousDriftCheck, 1000); // Check every second
            };
            runContinuousDriftCheck();

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
            this.inputSourceNodes = new Map(); // Cache deviceId -> MediaStreamAudioSourceNode
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
            // V12.98: LFOs created but NOT started (user must toggle ON)
            this.lfo.amplitude.value = 1;
            this.lfo2.amplitude.value = 1;
            // LFOs are stopped by default — user starts them via Sweep toggle buttons

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
                    window.AudioUtils.PCMRecorder.registerModule(rawCtx);
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
            // V115: Prefer the STORED raw AudioContext from module init.
            // This bypasses Tone.js wrapper entirely, ensuring WebKit gets the
            // true native AudioContext for createMediaStreamSource calls.
            const native = window._mxsRawAudioContext || Tone.context.rawContext || Tone.context;

            if (!native) {
                console.error("AudioContextManager: FATAL - No native context found!");
                return null;
            }

            // Tag for telemetry
            if (!native._ctxId) {
                native._ctxId = `CTX_${Math.floor(Math.random() * 10000)}`;
                console.log(`🔊 AudioContextManager: Tagged Native Context ${native._ctxId} [SR: ${native.sampleRate}] [Type: ${native.constructor.name}]`);
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

        _checkClockDrift() {
            const rawCtx = window._mxsRawAudioContext;
            if (!rawCtx || rawCtx.state !== 'running') return;

            // One-time re-baseline: reset reference timestamps when context first runs.
            // This eliminates the gap from suspended time between script load and user gesture.
            if (!this._driftBaselined) {
                window._mxsRawInitTime = performance.now();
                window._mxsRawAudioInitTime = rawCtx.currentTime;
                this._driftBaselined = true;
                return; // Skip this check, start fresh next tick
            }

            const now = performance.now();
            const wallElapsed = (now - window._mxsRawInitTime) / 1000;
            const audioElapsed = rawCtx.currentTime - window._mxsRawAudioInitTime;

            if (wallElapsed < 5) return; // Wait 5s for stabilization

            const diff = Math.abs(audioElapsed - wallElapsed);
            const speed = (audioElapsed / wallElapsed) * 100;
            const driftThreshold = 0.5; // 500ms drift before any alert (was 50ms — too sensitive)
            
            const uptime = performance.now() - window._mxsRawInitTime;
            const isWarmup = uptime < 15000; // 15s warmup (was 10s)

            // Throttle: only log drift errors every 10 seconds to prevent console flooding
            if (diff > driftThreshold) {
                const logNow = performance.now();
                if (this._lastDriftLog && (logNow - this._lastDriftLog) < 10000) return;

                if (isWarmup) {
                    console.warn(`🔊 Engine Warmup: Audio Sync at ${speed.toFixed(1)}%`);
                } else if (speed < 80) {
                    // Only truly critical if running at less than 80% speed
                    console.error(`🔴 CRITICAL ENGINE SLOWDOWN: Audio is running at ${speed.toFixed(1)}% speed!`);
                } else if (speed < 90) {
                    console.warn(`⚠️ Audio drift detected: running at ${speed.toFixed(1)}% speed`);
                } else {
                    // 90-100% is normal system variation — log at info level only
                    console.log(`🔊 Audio Sync: ${speed.toFixed(1)}% (minor drift, ${diff.toFixed(2)}s)`);
                }
                
                // Only suggest Safe Mode for truly severe drift (>20%)
                if (!isWarmup && Math.abs(100 - speed) > 20) {
                    this._safeModeTriggered = true;
                    console.error("⚠️ ENGINE STABILITY ADVISORY: System-wide sample rate mismatch (BlackHole/Aggregate?). Please set all devices to 48kHz in Audio MIDI Setup.");
                }
                this._lastDriftLog = logNow;
            } else if (wallElapsed % 60 < 1) { 
                // Healthy heartbeat every ~60s instead of every 20s
                console.log(`🔊 Audio Sync: ${speed.toFixed(1)}% (${rawCtx.sampleRate}Hz)`);
            }
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
            // DEPRECATED: Use getSharedInputNode for WebKit safety
            const key = deviceId || 'default';
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
            return await navigator.mediaDevices.getUserMedia(constraints);
        }

        /**
         * Returns a shared MediaStreamAudioSourceNode for a given device.
         * Resolves the WebKit 'InvalidAccessError' by ensuring 1 source node per stream.
         */
        async getSharedInputNode(deviceId) {
            const key = deviceId || 'default';
            
            // Return cached node if active
            if (this.inputSourceNodes.has(key)) {
                const existing = this.inputSourceNodes.get(key);
                if (existing.mediaStream && existing.mediaStream.active) {
                    return { node: existing.node, stream: existing.mediaStream };
                }
                this.inputSourceNodes.delete(key);
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

            console.log(`AudioContextManager: Creating NEW shared source node for ${key}...`);
            const stream = await navigator.mediaDevices.getUserMedia(constraints);

            // V115: Validate stream has active audio tracks (WebKit InvalidAccessError guard)
            const audioTracks = stream.getAudioTracks();
            if (!audioTracks || audioTracks.length === 0) {
                throw new Error(`No audio tracks in stream for device ${key}`);
            }
            console.log(`AudioContextManager: Stream acquired. Tracks: ${audioTracks.length}, Active: ${stream.active}, Label: ${audioTracks[0].label}`);

            // V115: Get the TRUE native context and ensure it's running
            const nativeCtx = this.getNativeContext();
            if (nativeCtx.state !== 'running') {
                console.log(`AudioContextManager: Resuming native context (state: ${nativeCtx.state})...`);
                await nativeCtx.resume();
            }
            
            console.log(`AudioContextManager: Creating source node on context [${nativeCtx._ctxId || 'unknown'}] (state: ${nativeCtx.state}, type: ${nativeCtx.constructor.name})`);
            const node = nativeCtx.createMediaStreamSource(stream);
            
            this.inputSourceNodes.set(key, { node, mediaStream: stream });
            return { node, stream };
        }
    }

    window.AudioContextManager = AudioContextManager;
})();

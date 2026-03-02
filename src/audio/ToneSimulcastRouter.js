// ToneSimulcastRouter.js - V126 LAZY CONTEXT & SAFETY
// Timestamp: 8:00 PM
// 
// V126 ChangeLog:
// - Restored missing _startDebugMonitor (Fixes TypeError).
// - Implemented LAZY initialization. The router now initializes its graph
//   using the context of the first source that connects, or explicitly via getCastStream.
// - Auto-reinitialization if a context mismatch is detected (handles Tone.js context swapping).

console.log('✅ Loading ToneSimulcastRouter.js V126 [Lazy Context]...');

class ToneSimulcastRouter {
    constructor() {
        console.log("🔊 ToneSimulcastRouter V126: Instantiated (Lazy Init)...");
        this.initialized = false;
        this.nativeCtx = null;
        this.inputBus = null;
        this.castGain = null;
        this.castDestination = null;
        this._probe = null;
        this._probeData = new Float32Array(32);
        this._videoTrack = this._createDummyVideoTrack();

        // Expose globally
        window.simulcastRouter = this;
    }

    /**
     * Ensures the internal graph is initialized and matches the provided context.
     * If no context is provided, tries to use Tone.context.
     * @param {AudioContext} targetNativeCtx - The native context to match.
     */
    _ensureContext(targetNativeCtx = null) {
        // Resolve target context
        if (!targetNativeCtx) {
            const ctx = Tone.context;
            targetNativeCtx = ctx.rawContext?._nativeAudioContext || ctx.rawContext || ctx;
        }

        if (!targetNativeCtx) {
            console.error("❌ ToneSimulcastRouter V126: Cannot resolve valid AudioContext.");
            return false;
        }

        // If already initialized and context matches, we're good.
        if (this.initialized && this.nativeCtx === targetNativeCtx) {
            return true;
        }

        // If initialized but context mismatched, we must reset.
        if (this.initialized && this.nativeCtx !== targetNativeCtx) {
            console.warn("⚠️ ToneSimulcastRouter V126: Context changed! Re-initializing graph on new context.", this.nativeCtx, "->", targetNativeCtx);
            // We can't easily dispose native nodes, but we drop references.
            this.initialized = false;
        }

        // Initialize (or Re-Initialize)
        try {
            console.log("🔊 ToneSimulcastRouter V126: Initializing Graph on:", targetNativeCtx);
            this.nativeCtx = targetNativeCtx;

            // 1. Create Destination
            this.castDestination = this.nativeCtx.createMediaStreamDestination();

            // 2. create Bus
            this.inputBus = this.nativeCtx.createGain();
            this.castGain = this.nativeCtx.createGain();

            this.inputBus.gain.value = 1.0;
            this.castGain.gain.value = 1.0;

            // 3. Connect Chain
            this.inputBus.connect(this.castGain);
            this.castGain.connect(this.castDestination);

            // 4. Keep-Alive
            try {
                const noise = this.nativeCtx.createOscillator();
                const noiseGain = this.nativeCtx.createGain();
                noise.type = 'sine';
                noise.frequency.value = 1.0;
                noiseGain.gain.value = 0.00001; // V114.26: -100dB (prevent gating)
                noise.connect(noiseGain);
                noiseGain.connect(this.inputBus);
                noise.start();
            } catch (e) {
                console.warn("⚠️ Keep-alive init failed:", e);
            }

            // 5. Probe
            try {
                this._probe = this.nativeCtx.createAnalyser();
                this.inputBus.connect(this._probe);
            } catch (e) { console.warn("Probe init failed:", e); }

            this.initialized = true;
            this._startDebugMonitor();
            console.log("✅ ToneSimulcastRouter V126: Graph Ready.");
            return true;

        } catch (e) {
            console.error("❌ ToneSimulcastRouter V126: Initialization Failed:", e);
            this.initialized = false;
            return false;
        }
    }

    _startDebugMonitor() {
        // V12.80: Disabled to save main-thread CPU cycles.
        return;
    }

    /**
     * Connect a node to this router.
     * Automatically handles context matching.
     */
    connectSource(sourceNode) {
        if (!sourceNode) return;

        try {
            // Unwrap
            const nativeSource = sourceNode._gainNode || sourceNode.output || sourceNode;

            // Check viability
            if (!nativeSource || typeof nativeSource.connect !== 'function') return;

            // Ensure our graph exists and is on the source's context
            if (!this._ensureContext(nativeSource.context)) {
                console.error("❌ ToneSimulcastRouter V126: Failed to match context for source.");
                return;
            }

            // Connect
            try {
                nativeSource.connect(this.inputBus);
                console.log("✅ ToneSimulcastRouter V126: Source connected successfully.");
            } catch (connErr) {
                console.error("❌ ToneSimulcastRouter V126: Connection failed despite context match:", connErr);
            }

        } catch (e) {
            console.error("❌ ToneSimulcastRouter V126: connectSource fatal error:", e);
        }
    }

    enableCast() {
        console.log("ToneSimulcastRouter: Cast Enabled (noop wrapper)");
    }

    disableCast() {
        console.log("ToneSimulcastRouter: Cast Disabled (noop wrapper)");
    }

    jolt() {
        console.log("⚡ ToneSimulcastRouter V126: Refreshing links...");
        if (!this.initialized) return;
        try {
            this.castGain.disconnect();
            setTimeout(() => {
                try {
                    if (this.castDestination) {
                        this.castGain.connect(this.castDestination);
                        console.log("✅ ToneSimulcastRouter V126: Links refreshed.");
                    }
                } catch (e) { console.error("Jolt reconnect failed", e); }
            }, 50);
        } catch (e) { }
    }

    /**
     * V114.26: Diagnostic Test Tone (440Hz Sine)
     * Useful to prove the router -> stream -> receiver path is working.
     */
    testTone(on = true) {
        if (!this.initialized) this._ensureContext();
        if (on) {
            console.log("🎵 Router: Starting test tone...");
            if (this._testOsc) return;
            this._testOsc = this.nativeCtx.createOscillator();
            this._testOsc.frequency.value = 440;
            this._testOsc.connect(this.inputBus);
            this._testOsc.start();
        } else {
            console.log("🎵 Router: Stopping test tone.");
            if (this._testOsc) {
                try { this._testOsc.stop(); this._testOsc.disconnect(); } catch(e){}
                this._testOsc = null;
            }
        }
    }

    getCastStream() {
        // Ensure initialized (using current Tone context if not yet done)
        if (!this.initialized) {
            this._ensureContext();
        }

        if (!this.initialized || !this.castDestination) {
            console.error("❌ ToneSimulcastRouter V126: Cannot get stream - Not initialized.");
            return null;
        }

        const tracks = [...this.castDestination.stream.getTracks(), this._videoTrack];
        return new MediaStream(tracks);
    }

    _createDummyVideoTrack() {
        const canvas = document.createElement('canvas');
        canvas.width = 2; canvas.height = 2;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'black'; ctx.fillRect(0, 0, 2, 2);
        const stream = canvas.captureStream(1);
        return stream.getVideoTracks()[0];
    }
}

window.ToneSimulcastRouter = ToneSimulcastRouter;

// Auto-instantiate singleton
if (!window.simulcastRouter) {
    window.simulcastRouter = new ToneSimulcastRouter();
}

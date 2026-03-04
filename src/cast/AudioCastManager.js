/**
 * AudioCastManager.js
 * Handles capturing Tone.js audio output and streaming it to the Rust backend
 * for Chromecast playback.
 */

console.log("🔊 AudioCastManager: V106 [Integrated] Loading...");

class AudioCastManager {
    constructor() {
        this.mediaRecorder = null;
        this.isCasting = false;
        this.chunkInterval = 100; // ms (Reverted to 100ms for sync)
        this.destinationNode = null;
    }

    /**
     * Initialize audio capture from Tone.js
     * Must be called after Tone.start()
     */
    initialize() {
        console.log("AudioCastManager: Initializing (Integrated Mode)...");
        if (!window.Tone || !window.Tone.context) {
            console.error("Tone.js not found or not initialized");
            return false;
        }

        // V106: Check if we can just use the centralized stream from ACM
        if (window.audioEngine && window.audioEngine.contextManager) {
            const stream = window.audioEngine.contextManager.getCastStream();
            if (stream) {
                console.log("AudioCastManager: Found integrated Cast Stream from ACM.");
                this.integratedStream = stream;
                return true;
            }
        }

        // Fallback: Create a MediaStreamDestination (if ACM is unavailable)
        // V106: Use safer Context Access
        const rawCtx = window.Tone.context.rawContext || window.Tone.context;
        // not Tone's wrapper. Unwrap one deeper level if present.
        const baseCtx = rawCtx;

        if (!this.destinationNode) {
            try {
                this.destinationNode = baseCtx.createMediaStreamDestination();
                
                // CRITICAL: Connect to the master LIMITER in AudioContextManager to get the full mix
                if (window.audioEngine && window.audioEngine.contextManager && window.audioEngine.contextManager.masterLimiter) {
                    window.audioEngine.contextManager.masterLimiter.connect(this.destinationNode);
                    console.log("AudioCastManager: Connected to AudioContextManager.masterLimiter.");
                } else {
                    window.Tone.getDestination().connect(this.destinationNode);
                    console.log("AudioCastManager: Created fallback capture node from Tone.Destination.");
                }
            } catch (e) {
                console.error("AudioCastManager: Failed to create destination node", e);
                return false;
            }
        }

        return true;
    }

    /**
     * Discover Chromecast devices
     * Returns a promise that resolves to a list of devices
     */
    async discoverDevices() {
        try {
            // V102: Cross-Compatibility for Tauri V2
            // window.__TAURI__.invoke (V1) vs window.__TAURI__.core.invoke (V2)
            const invoke = window.__TAURI__?.invoke || window.__TAURI__?.core?.invoke;

            if (!invoke) {
                console.error("AudioCastManager: Tauri invoke function not found!");
                return [];
            }

            const devices = await invoke('discover_chromecast_devices');
            console.log("AudioCastManager: Discovered devices:", devices);
            return devices;
        } catch (err) {
            console.error("AudioCastManager: Discovery failed", err);
            return [];
        }
    }

    /**
     * Start capturing audio and streaming to Rust backend.
     * Returns the Stream URL securely.
     * Does NOT launch the app on the Chromecast (handled by scripts.js/HybridCast).
     * @param {string} ip - IP address of the Chromecast (used for logging/tagging)
     */
    async startStreamingOnly(ip) {
        if (this.isCasting) {
            console.warn("AudioCastManager: Already streaming.");
            return this.currentStreamUrl;
        }

        console.log(`AudioCastManager: Starting audio stream for ${ip}...`);

        try {
            // V105: Ensure Tone Context is fully running
            if (Tone.context.state !== 'running') {
                console.log("AudioCastManager: Context suspended. Attempting resume...");
                await Tone.context.resume();
            }
            console.log(`AudioCastManager: Tone Context State: ${Tone.context.state}, Sample Rate: ${Tone.context.sampleRate}`);

            // Initialize backend stream server
            // NOW RETURNS THE STREAM URL
            const invoke = window.__TAURI__?.invoke || window.__TAURI__?.core?.invoke;
            if (!invoke) throw new Error("Tauri invoke not found");

            const streamUrl = await invoke('init_cast_stream', {
                chromecastIp: ip,
                sampleRate: Tone.context.sampleRate,
                channels: 2
            });

            console.log("AudioCastManager: Stream Server ready at:", streamUrl);
            this.currentStreamUrl = streamUrl;

            // V106: Use Integrated Stream or Fallback
            if (!this.integratedStream && !this.destinationNode) {
                console.log("AudioCastManager: Stream source missing. Initializing...");
                this.initialize();
            }

            const stream = this.integratedStream || (this.destinationNode ? this.destinationNode.stream : null);

            if (!stream) throw new Error("Could not acquire MediaStream (Integrated or Fallback)");
            
            const tracks = stream.getAudioTracks();
            console.log(`AudioCastManager: Stream tracks found: ${tracks.length}`);
            tracks.forEach((t, i) => {
                console.log(`   Track ${i}: label="${t.label}", enabled=${t.enabled}, readyState="${t.readyState}"`);
            });

            if (tracks.length === 0) {
                console.warn("AudioCastManager: No audio tracks found. Stream might be empty.");
            }

            // --- V104: Robust MimeType Selection ---
            let mimeType = 'audio/webm;codecs=opus';
            if (typeof MediaRecorder !== 'undefined') {
                if (MediaRecorder.isTypeSupported(mimeType)) {
                    // Good
                } else if (MediaRecorder.isTypeSupported("audio/webm")) {
                    mimeType = "audio/webm";
                } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
                    mimeType = "audio/mp4";
                } else if (MediaRecorder.isTypeSupported("audio/mpeg")) {
                    mimeType = "audio/mpeg";
                }
            }
            console.log(`AudioCastManager: Selected MimeType: ${mimeType}`);

            // V105: Stabilization delay (macOS/Safari can be finicky about immediate recording)
            await new Promise(r => setTimeout(r, 100));

            const updateInterval = 2000; // Print stats every 2s
            let lastStats = Date.now();
            let bytesSent = 0;

            console.log("AudioCastManager: Constructing MediaRecorder...");
            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: mimeType,
                audioBitsPerSecond: 320000 // High Quality 320k
            });

            this.mediaRecorder.ondataavailable = async (e) => {
                if (e.data.size > 0) {
                    // Optimized: Only convert if size > 0
                    const buffer = await e.data.arrayBuffer();
                    const uint8Array = new Uint8Array(buffer);
                    
                    if (uint8Array.length === 0) return;

                    // V114.3: PASS RAW BINARY (No Array.from churn)
                    try {
                        const invoke = window.__TAURI__?.invoke || window.__TAURI__?.core?.invoke;
                        if (invoke) {
                            // Rust side expect Vec<u8> which accepts Uint8Array
                            await invoke('stream_audio_chunk', { data: uint8Array });
                        }
                        bytesSent += uint8Array.length;
                    } catch (err) {
                        console.error("AudioCastManager: Failed to send chunk", err);
                    }

                    if (Date.now() - lastStats > updateInterval) {
                        console.log(`AudioCastManager: Stream active. Sent ${bytesSent} bytes.`);
                        lastStats = Date.now();
                    }
                }
            };

            console.log(`AudioCastManager: Starting MediaRecorder (interval=${this.chunkInterval}ms)...`);
            this.mediaRecorder.start(this.chunkInterval);
            this.isCasting = true;
            console.log("AudioCastManager: Capture SUCCESSFULLY started");

            return streamUrl;

        } catch (err) {
            console.error("AudioCastManager: FATAL Stream Start Failure:", err);
            console.error("Stack:", err.stack);
            this.stopCasting(); // Cleanup
            throw err;
        }
    }

    /**
     * Legacy wrapper or full start
     */
    async startCasting(ip) {
        return this.startStreamingOnly(ip);
    }

    /**
     * Stop casting
     */
    async stopCasting() {
        if (!this.isCasting) return;

        console.log("AudioCastManager: Stopping cast...");

        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }

        try {
            const invoke = window.__TAURI__?.invoke || window.__TAURI__?.core?.invoke;
            if (invoke) {
                await invoke('stop_cast_stream');
            }
        } catch (err) {
            console.warn("AudioCastManager: Error stopping backend stream", err);
        }

        // Cleanup Audio Graph
        if (this.destinationNode && Tone) {
            try {
                // Disconnect Tone from our node to free resources
                Tone.getDestination().disconnect(this.destinationNode);
                console.log("AudioCastManager: Disconnected from Tone.js destination");
                this.destinationNode = null;
            } catch (e) {
                console.warn("AudioCastManager: Error disconnecting audio node", e);
            }
        }

        this.isCasting = false;
        this.mediaRecorder = null;
        console.log("AudioCastManager: Cast stopped");
    }
}

// Export singleton
try {
    window.AudioCastManager = new AudioCastManager();
    console.log("🔊 AudioCastManager: Instance created and attached to window.");
} catch (e) {
    console.error("🔊 AudioCastManager: Failed to instantiate!", e);
}

// ToneCastManager.js
// 
// Manages WebRTC PeerConnections for high-fidelity audio casting.
// Uses existing WebSocket connection for signaling (SDP/ICE exchange).

console.log('✅ Loading ToneCastManager.js...');

class ToneCastManager {
    constructor(router) {
        this.router = router;
        this.peerConnection = null;
        this.deviceId = null;
        this.invoke = window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke;
        this.listen = window.__TAURI__?.event?.listen;
        this.unlistenFn = null;

        // Use Google STUN servers (free, reliable)
        this.rtcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
    }

    async initialize() {
        // subscribe to signaling events from Backend (Rust)
        if (this.listen) {
            console.log("📡 ToneCastManager: Listening for WebRTC signals...");
            this.unlistenFn = await this.listen('webrtc_signal', (event) => {
                try {
                    const signal = JSON.parse(event.payload);
                    this.handleSignal(signal);
                } catch (e) {
                    console.error("❌ ToneCastManager: Bad signal payload", e);
                }
            });
        } else {
            console.error("❌ ToneCastManager: Tauri Event API not available");
        }
    }

    async startCasting(deviceId) {
        console.log(`🚀 ToneCastManager: Starting cast to ${deviceId}`);
        this.deviceId = deviceId;

        const stream = this.router.getCastStream();
        if (!stream) {
            console.error("❌ ToneCastManager: No cast stream available");
            return;
        }

        // Create PeerConnection
        this.peerConnection = new RTCPeerConnection(this.rtcConfig);

        // Add Tracks (Audio + potential Video)
        stream.getTracks().forEach(track => {
            console.log(`🎤 Adding track to PeerConnection: ${track.label} (${track.kind})`);

            if (track.kind === 'audio') {
                try {
                    track.applyConstraints({
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false,
                        channelCount: 2
                    }).catch(e => console.warn("Track constraints failed:", e));
                } catch (e) { }
            }

            this.peerConnection.addTrack(track, stream);
        });

        // Optimize Codecs (Opus Stereo)
        this._optimizeCodecs();

        // Handle ICE Candidates
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this._sendSignal({
                    type: 'ice-candidate',
                    candidate: event.candidate
                });
            }
        };

        // Create Offer
        try {
            const offer = await this.peerConnection.createOffer({
                offerToReceiveAudio: false,
                offerToReceiveVideo: false,
                voiceActivityDetection: false // Music optimization
            });

            await this.peerConnection.setLocalDescription(offer);

            // CRITICAL FIX: Wait for at least one WebSocket client before sending offer
            // Chromecast takes 3-10 seconds to load the receiver and connect
            console.log("⏳ Waiting for receiver to connect via WebSocket...");
            let maxWait = 10000; // 10 seconds max (was 15)
            let waited = 0;
            const pollInterval = 1000;

            const waitForClient = async () => {
                while (waited < maxWait) {
                    try {
                        const status = await this.invoke('get_ws_cast_status');
                        console.log(`📡 WS Status: ${status.clientCount} clients, Streaming: ${status.isStreaming}`);
                        if (status && status.clientCount > 0) {
                            console.log(`✅ Receiver connected! (${status.clientCount} client(s))`);
                            return true;
                        }
                    } catch (e) { }
                    await new Promise(r => setTimeout(r, pollInterval));
                    waited += pollInterval;
                    if (waited % 2000 === 0) {
                        console.log(`⏳ Still waiting for receiver... (${waited / 1000}s/10s)`);
                    }
                }
                console.warn("⚠️ Timeout waiting for receiver, sending offer anyway (signaling might fail)");
                return false;
            };

            await waitForClient();

            // Mangle Offer SDP to force Opus Music Mode
            const mangledSDP = this._mangleSDP(offer.sdp);

            console.log("📤 Sending WebRTC Offer...");
            this._sendSignal({
                type: 'offer',
                sdp: mangledSDP
            });

        } catch (e) {
            console.error("❌ ToneCastManager: Offer creation failed", e);
        }
    }

    _mangleSDP(sdp) {
        // Force Opus to use stereo and high quality
        let lines = sdp.split('\r\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('a=fmtp') && (lines[i].includes('opus') || lines[i].includes('96') || lines[i].includes('111'))) {
                // Remove existing params and force high quality stereo
                // 'stereo=1' is the most critical for Chromecast music
                lines[i] = lines[i].split(' ')[0] + ' ' + 'stereo=1;sprop-stereo=1;maxaveragebitrate=320000';
                console.log("🔧 Mangled Opus Line V124:", lines[i]);
            }
        }
        return lines.join('\r\n');
    }

    async handleSignal(signal) {
        if (!this.peerConnection) return;

        console.log(`📩 ToneCastManager: Received ${signal.type}`);

        try {
            if (signal.type === 'answer') {
                const desc = new RTCSessionDescription({ type: 'answer', sdp: signal.sdp });
                await this.peerConnection.setRemoteDescription(desc);
                console.log("✅ WebRTC Connection Established!");

                // Wait 3 seconds before stopping PCM fallback to ensure smooth transition
                // V114.24: DISABLED - Keep PCM running as a persistent parallel fallback.
                // The receiver handles the muxing/priority.
                /*
                setTimeout(() => {
                    console.log("🚀 WebRTC Active: Stopping PCM Fallback (Crossfade Complete)");
                    if (window.stopAudioPiping) window.stopAudioPiping();
                }, 3000);
                */

                // Jolt router to wake up encoder
                if (this.router && this.router.jolt) {
                    setTimeout(() => this.router.jolt(), 500);
                }

                // Optimize senders after connection
                setTimeout(() => {
                    this._optimizeCodecs();
                    this._ensureTracksActive();
                    this._startStatsMonitoring();
                }, 1000);

            } else if (signal.type === 'ice-candidate') {
                const candidate = new RTCIceCandidate(signal.candidate);
                await this.peerConnection.addIceCandidate(candidate);
            }
        } catch (e) {
            console.error("❌ ToneCastManager: Signal handling failed", e);
        }
    }

    _startStatsMonitoring() {
        let statsCount = 0;
        this._statsInterval = setInterval(async () => {
            if (!this.peerConnection) {
                clearInterval(this._statsInterval);
                return;
            }

            try {
                const stats = await this.peerConnection.getStats();
                stats.forEach(report => {
                    if (report.type === 'outbound-rtp' && report.kind === 'audio') {
                        const bytesSent = report.bytesSent || 0;
                        const packetsSent = report.packetsSent || 0;
                        statsCount++;

                        if (statsCount <= 5 || statsCount % 10 === 0) {
                            console.log(`📊 WebRTC Audio Stats: ${packetsSent} packets, ${(bytesSent / 1024).toFixed(1)} KB sent`);
                        }

                        // Alert if no audio is being sent after 5 seconds
                        if (statsCount === 5 && bytesSent === 0) {
                            console.warn("⚠️ WARNING: WebRTC connected but NO audio being sent!");
                        }
                    }
                });
            } catch (e) { }
        }, 1000);
    }

    _sendSignal(data) {
        // Send via Rust WebSocket (push_ws_json)
        // This broadcasts to all connected clients (Receiver)
        if (this.invoke) {
            this.invoke('push_ws_json', { data: data }).catch(e => {
                // Silently ignore. If WebRTC signaling isn't implemented in the backend, 
                // the primary WebM CastStream will handle the audio instead.
                console.debug("ToneCastManager: Signaling not supported on this backend (using WebM stream fallback).");
            });
        }
    }

    _optimizeCodecs() {
        const senders = this.peerConnection.getSenders();
        console.log(`📊 ToneCastManager: Optimizing ${senders.length} senders...`);
        senders.forEach(sender => {
            if (sender.track && sender.track.kind === 'audio') {
                try {
                    const params = sender.getParameters();
                    if (!params.encodings || params.encodings.length === 0) {
                        params.encodings = [{}];
                    }

                    // Prioritize High-Fidelity Music (Safe 128k for stability)
                    params.encodings[0].priority = 'high';
                    params.encodings[0].networkPriority = 'high';
                    params.encodings[0].maxBitrate = 320000;

                    sender.setParameters(params).then(() => {
                        console.log("✅ WebRTC: Codec parameters optimized (320kbps)");
                    }).catch(e => {
                        console.warn("⚠️ WebRTC: Param update skipped:", e.message);
                    });
                } catch (e) {
                    console.warn("⚠️ WebRTC: Could not get/set sender parameters", e);
                }
            }
        });
    }

    _ensureTracksActive() {
        const senders = this.peerConnection.getSenders();
        senders.forEach(sender => {
            if (sender.track) {
                console.log(`🎤 WebRTC: Ensuring track '${sender.track.label}' is ENABLED`);
                sender.track.enabled = true;
            }
        });
    }

    stopCasting() {
        if (this._statsInterval) {
            clearInterval(this._statsInterval);
            this._statsInterval = null;
        }
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        if (this.unlistenFn) {
            this.unlistenFn();
            this.unlistenFn = null;
        }
        console.log("🛑 ToneCastManager: Casting stopped");
    }
}

window.ToneCastManager = ToneCastManager;

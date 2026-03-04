/**
 * FCastHybridSender.js
 * Version: 1.0
 * 
 * Sends UI state to FCast receiver via Tauri backend
 * Ultra-low bandwidth: JSON state + cursor position
 * Works with FCast-compatible devices (Roku, Fire TV, Smart TVs, etc.)
 * 
 * FCast Protocol: https://docs.fcast.org
 */

class FCastHybridSender {
    constructor() {
        this.isConnected = false;
        this.deviceId = null;
        this.updateInterval = null;
        this.lastStateHash = null;

        // Cursor tracking
        this.cursor = { x: 0, y: 0, visible: false, clicking: false };

        // Stats
        this.messagesSent = 0;
        this.bytesSent = 0;
        this.startTime = Date.now();

        // Tauri invoke function
        this.invoke = null;

        // Message types for FCast custom data
        this.MSG_TYPE_UI_STATE = 'mxs004_ui_state';
        this.MSG_TYPE_CURSOR = 'mxs004_cursor';
        this.MSG_TYPE_AUDIO_URL = 'mxs004_audio';

        this._setupCursorTracking();
        this._setupTauri();
    }

    /**
     * Set up Tauri integration
     */
    async _setupTauri() {
        // Check if running in Tauri
        if (window.__TAURI__) {
            // Use the global Tauri object provided by tauri.conf.json withGlobalTauri: true
            this.invoke = window.__TAURI__.core?.invoke || window.__TAURI__.invoke;
            if (this.invoke) {
                console.log('[FCastHybrid] Tauri API available (Global)');
            } else {
                console.warn('[FCastHybrid] window.__TAURI__ found but invoke is missing');
            }
        } else if (window.tauriInvoke) {
            this.invoke = window.tauriInvoke;
            console.log('[FCastHybrid] Using window.tauriInvoke');
        } else {
            console.warn('[FCastHybrid] Tauri not available - running in browser mode');
        }
    }


    /**
     * Set up mouse/cursor tracking
     */
    _setupCursorTracking() {
        document.addEventListener('mousemove', (e) => {
            this.cursor.x = e.clientX / window.innerWidth;
            this.cursor.y = e.clientY / window.innerHeight;
            this.cursor.visible = true;
        });

        document.addEventListener('mousedown', () => {
            this.cursor.clicking = true;
        });

        document.addEventListener('mouseup', () => {
            this.cursor.clicking = false;
        });

        document.addEventListener('mouseleave', () => {
            this.cursor.visible = false;
        });

        document.addEventListener('mouseenter', () => {
            this.cursor.visible = true;
        });
    }

    /**
     * Connect to FCast device
     * @param {string} deviceId - FCast device ID
     */
    async connect(deviceId) {
        if (!this.invoke) {
            console.error('[FCastHybrid] Tauri not available');
            return false;
        }

        try {
            await this.invoke('fcast_connect', { deviceId });
            this.deviceId = deviceId;
            this.isConnected = true;
            this.startTime = Date.now();
            console.log('[FCastHybrid] Connected to device:', deviceId);

            // Start broadcasting - DISABLED for State Mirroring Architecture
            // this.startBroadcasting();
            console.log('[FCastHybrid] Auto-broadcast DISABLED (State Mirroring active)');
            return true;
        } catch (e) {
            console.error('[FCastHybrid] Connection failed:', e);
            return false;
        }
    }

    /**
     * Disconnect from FCast device
     */
    async disconnect() {
        this.stopBroadcasting();

        if (this.invoke && this.isConnected) {
            try {
                await this.invoke('fcast_disconnect');
            } catch (e) {
                console.warn('[FCastHybrid] Disconnect error:', e);
            }
        }

        this.isConnected = false;
        this.deviceId = null;
        console.log('[FCastHybrid] Disconnected');
    }

    /**
     * Capture current application state
     * @returns {Object} Application state
     */
    captureState() {
        const audioEngine = window.audioEngine;
        const state = {
            type: this.MSG_TYPE_UI_STATE,
            cursor: { ...this.cursor },
            timestamp: Date.now(),
            tracks: [],
            master: {},
            transport: {}
        };

        // Capture track states from window.tracks (TrackView instances)
        if (window.tracks && window.tracks.length > 0) {
            state.tracks = window.tracks.map((trackView, i) => {
                const s = trackView.state || {};
                const audio = trackView.trackAudio;

                // Convert dB to gain for volume display if needed (receiver expects 0..1 roughly)
                const volDb = audio ? (audio.volume?.volume?.value || 0) : 0;
                const volume = Math.pow(10, volDb / 20); // Basic dB to Gain

                const pan = audio ? (audio.panner?.pan?.value || 0) : 0;

                // Get audio URL and playback state
                let audioUrl = null;
                let playing = false;
                let position = 0;

                if (audio?.player) {
                    // Use castAudioUrl (network-accessible) for Chromecast, fallback to local URL
                    audioUrl = audio.castAudioUrl || audio.loadedAudioUrl || null;
                    playing = audio.player.state === 'started';
                    position = audio.getCurrentPosition?.() || 0;

                    // Log when we have an audio URL (once per track)
                    if (audioUrl && !this._audioUrlLogged?.[i]) {
                        console.log(`[FCastHybrid] Track ${i} audioUrl: ${audioUrl.substring(0, 50)}...`);
                        this._audioUrlLogged = this._audioUrlLogged || {};
                        this._audioUrlLogged[i] = true;
                    }
                }

                return {
                    volume: volume,
                    pan: pan,
                    mute: s.mute || false,
                    solo: s.solo || false,
                    armed: s.armed || false,
                    recording: s.isRecording || false,
                    looping: s.looping || false,
                    playing: playing,
                    position: position,
                    audioUrl: audioUrl,
                    meterL: this._getMeterValue(i, 'L'),
                    meterR: this._getMeterValue(i, 'R'),
                    effects: this._getTrackEffects(i)
                };
            });
        } else {
            // Fallback: generate empty track states
            for (let i = 0; i < 4; i++) {
                state.tracks.push({
                    volume: 0.7,
                    pan: 0,
                    mute: false,
                    solo: false,
                    armed: false,
                    recording: false,
                    looping: false,
                    meterL: 0,
                    meterR: 0,
                    effects: []
                });
            }
        }

        // Capture master state
        if (audioEngine && audioEngine.contextManager) {
            const cm = audioEngine.contextManager;
            const volDb = cm.masterVolume?.volume?.value || 0;
            const volume = Math.pow(10, volDb / 20);

            state.master = {
                volume: volume,
                meterL: this._getMasterMeter('L'),
                meterR: this._getMasterMeter('R'),
                lfo1Active: audioEngine.getLfo(1)?.state === 'started',
                lfo2Active: audioEngine.getLfo(2)?.state === 'started'
            };
        } else {
            state.master = {
                volume: 0.7,
                meterL: 0,
                meterR: 0,
                lfo1Active: false,
                lfo2Active: false
            };
        }

        // Transport state
        state.transport = {
            playing: audioEngine?.isMasterRecording || false,
            recording: audioEngine?.isMasterRecording || false,
            loopTime: window.AppConfig?.LOOP_LENGTH || 0
        };

        return state;
    }

    /**
     * Get meter value for a track
     */
    _getMeterValue(trackIndex, channel) {
        if (window.tracks && window.tracks[trackIndex]) {
            const track = window.tracks[trackIndex].trackAudio;
            if (track && track.inputMeter) {
                const val = track.inputMeter.getValue();
                // Tone.Meter.getValue() can be a number (dB) or an array if channels > 1
                // TrackAudio.inputMeter is mono-summed or stereo depending on config.
                // For now we treat it as a single value converted to 0..1
                const linear = Math.pow(10, val / 20);
                return Math.max(0, Math.min(1, linear));
            }
        }
        return 0;
    }

    /**
     * Get master meter value
     */
    _getMasterMeter(channel) {
        const audioEngine = window.audioEngine;
        if (audioEngine && audioEngine.contextManager) {
            const cm = audioEngine.contextManager;
            if (cm.masterWaveform) {
                // Waveform nodes instead of meters for better visual responsiveness
                const node = channel === 'L' ? cm.masterWaveform[0] : cm.masterWaveform[1];
                if (node) {
                    const val = node.getValue();
                    let max = 0;
                    for (let i = 0; i < val.length; i += 32) {
                        if (Math.abs(val[i]) > max) max = Math.abs(val[i]);
                    }
                    return max;
                }
            }
        }
        return 0;
    }

    /**
     * Get track effects list
     */
    _getTrackEffects(trackIndex) {
        let effects = [];

        if (window.tracks && window.tracks[trackIndex]) {
            const track = window.tracks[trackIndex].trackAudio;
            if (track && track.effects) {
                track.effects.forEach((slot) => {
                    effects.push({
                        name: slot?.name || null,
                        active: slot?.enabled || false
                    });
                });
            }
        }

        // Limit or pad to exactly 7 slots
        if (effects.length > 7) effects = effects.slice(0, 7);
        while (effects.length < 7) {
            effects.push({ name: null, active: false });
        }

        return effects;
    }

    /**
     * Send state to FCast receiver via WebSocket stream
     */
    async asyncSendState(state) {
        if (!this.isConnected || !this.invoke) {
            return false;
        }

        try {
            // Priority 1: High-performance WebSocket stream
            const stateStr = JSON.stringify(state);
            await this.invoke('push_ws_json', {
                data: state
            });
            this.messagesSent++;
            this.bytesSent += stateStr.length;
            return true;
        } catch (e) {
            // Fallback: Custom FCast message
            try {
                const stateStr = JSON.stringify(state);
                await this.invoke('fcast_send_custom_data', {
                    data: stateStr,
                    messageType: this.MSG_TYPE_UI_STATE
                });
                this.messagesSent++;
                this.bytesSent += stateStr.length;
                return true;
            } catch (e2) {
                if (this.messagesSent === 0) {
                    console.warn('[FCastHybrid] Failed to send UI state via WS or FCast');
                }
                return false;
            }
        }
    }

    /**
     * Send state synchronously (Legacy wrapper)
     */
    sendState(state) {
        this.asyncSendState(state).catch(e => { });
    }


    /**
     * Start broadcasting state updates
     */
    startBroadcasting() {
        console.log('[FCastHybrid] Starting broadcast');

        // UI state updates: 20 Hz (every 50ms)
        this.updateInterval = setInterval(() => {
            const state = this.captureState();
            this.sendState(state);
        }, 50);

        // Log stats every 10 seconds
        this.statsInterval = setInterval(() => {
            const elapsed = (Date.now() - this.startTime) / 1000;
            const kbSent = (this.bytesSent / 1024).toFixed(2);
            const rate = (this.bytesSent / elapsed / 1024).toFixed(2);
            console.log(`[FCastHybrid] Stats: ${this.messagesSent} msgs, ${kbSent} KB total, ${rate} KB/s`);
        }, 10000);
    }

    /**
     * Stop broadcasting
     */
    stopBroadcasting() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
            this.statsInterval = null;
        }
        console.log('[FCastHybrid] Broadcast stopped');
    }

    /**
     * Send audio stream URL to FCast receiver
     * @param {string} url - Audio stream URL (HLS, MP3, etc.)
     */
    async sendAudioUrl(url) {
        if (!this.isConnected || !this.invoke) {
            console.warn('[FCastHybrid] Cannot send audio URL - not connected');
            return false;
        }

        try {
            // Cast media via FCast
            await this.invoke('fcast_cast_media', {
                url: url,
                mimeType: url.includes('.m3u8') ? 'application/x-mpegURL' : 'audio/mpeg',
                title: 'MXS-004 Audio Stream'
            });
            console.log('[FCastHybrid] Audio URL sent:', url);
            return true;
        } catch (e) {
            console.error('[FCastHybrid] Audio URL send error:', e);
            return false;
        }
    }

    /**
     * Cast HLS stream (video + audio)
     * @param {string} hlsUrl - HLS playlist URL
     */
    async castHLS(hlsUrl) {
        if (!this.invoke) {
            console.warn('[FCastHybrid] Tauri not available');
            return false;
        }

        try {
            await this.invoke('fcast_set_hls_url', { url: hlsUrl });
            await this.invoke('fcast_cast_hls');
            console.log('[FCastHybrid] HLS stream started:', hlsUrl);
            return true;
        } catch (e) {
            console.error('[FCastHybrid] HLS cast error:', e);
            return false;
        }
    }

    /**
     * Get current stats
     */
    getStats() {
        const elapsed = (Date.now() - this.startTime) / 1000;
        return {
            connected: this.isConnected,
            deviceId: this.deviceId,
            messagesSent: this.messagesSent,
            bytesSent: this.bytesSent,
            bytesPerSecond: elapsed > 0 ? this.bytesSent / elapsed : 0,
            kbPerSecond: elapsed > 0 ? (this.bytesSent / elapsed / 1024).toFixed(2) : '0'
        };
    }
}

// Global instance
window.FCastHybridSender = FCastHybridSender;

// Create singleton instance
window.fcastHybrid = new FCastHybridSender();

console.log('[FCastHybrid] Module loaded - use window.fcastHybrid.connect(deviceId) to start');

/**
 * CastStateBroadcaster.js
 * State Mirroring Cast Architecture - Sender Component
 * 
 * Captures UI state and broadcasts as JSON to receiver.
 * Replaces video frame streaming with lightweight state updates.
 */

(function () {
    'use strict';


    const BROADCAST_INTERVAL = 50; // 50ms = 20 updates/sec

    class CastStateBroadcaster {
        constructor() {
            this.isActive = false;
            this.intervalId = null;
            this.lastState = null;
            this.frameCount = 0;
            this.cursor = { x: 0, y: 0 };

            this._setupCursorTracking();
            console.log('📡 CastStateBroadcaster initialized');
        }

        /**
         * Set up mouse/cursor tracking
         */
        _setupCursorTracking() {
            document.addEventListener('mousemove', (e) => {
                this.cursor.x = e.clientX / window.innerWidth;
                this.cursor.y = e.clientY / window.innerHeight;
            });
        }

        /**
         * Start broadcasting state to receiver
         */
        start() {
            if (this.isActive) return;
            this.isActive = true;
            this.frameCount = 0;

            console.log('📡 State broadcasting started (100ms optimized interval)');

            // Cache common elements for the loop to avoid querySelector churn
            this._cachedElements = {
                masterRecBtn: document.getElementById('master-record-button'),
                loopLenSlider: document.getElementById('loop-length'),
                masterVolSlider: document.getElementById('master-volume'),
                lfo1Meter: document.getElementById('lfo-meter-bar'),
                lfo2Meter: document.getElementById('lfo2-meter-bar'),
                samplerBtns: Array.from(document.querySelectorAll('.sample-btn'))
            };

            this.intervalId = setInterval(() => {
                this.broadcastState();
            }, 100); // 100ms is sufficient for UI mirroring

            this.broadcastState();
        }

        /**
         * Stop broadcasting
         */
        stop() {
            if (!this.isActive) return;
            this.isActive = false;
            if (this.intervalId) {
                clearInterval(this.intervalId);
                this.intervalId = null;
            }
            this._cachedElements = null;
            console.log('📡 State broadcasting stopped');
        }

        /**
         * Capture current UI state and broadcast
         */
        broadcastState() {
            try {
                const state = this.captureState();
                if (!state) return;

                this.frameCount++;

                const stateJson = JSON.stringify(state);
                if (stateJson === this.lastState && this.frameCount % 5 !== 0) {
                    return;
                }
                this.lastState = stateJson;

                const invoke = window.__TAURI__?.core?.invoke || window.__TAURI__.invoke;
                if (invoke) {
                    invoke('push_ws_json', { data: state }).catch(e => { });
                }

            } catch (e) {
                if (this.frameCount % 100 === 0) console.error('State capture error:', e);
            }
        }

        /**
         * Capture complete UI state
         */
        captureState() {
            const audioService = window.audioService;
            const tracksVis = window.tracks;
            if (!audioService || !tracksVis || tracksVis.length === 0 || !this._cachedElements) return null;

            const state = {
                type: 'state',
                timestamp: Date.now(),
                tracks: [],
                transport: {},
                master: {},
                cursor: { ...this.cursor }
            };

            for (let i = 0; i < tracksVis.length; i++) {
                const trackView = tracksVis[i];
                const audioTrack = audioService.tracks.get(i);
                if (trackView && trackView.elements.trackEl) {
                    const el = trackView.elements.trackEl;

                    // Optimization: Use direct element references from trackView instead of querySelector
                    const volInput = trackView.elements.knobs?.['vol'];
                    const panInput = trackView.elements.knobs?.['pan'];
                    const pitchInput = trackView.elements.knobs?.['pitch'];
                    const trebleInput = trackView.elements.knobs?.['treble'];
                    const midGainInput = trackView.elements.knobs?.['mid_gain'];
                    const bassInput = trackView.elements.knobs?.['bass'];

                    state.tracks.push({
                        id: i,
                        volume: volInput ? parseFloat(volInput.value) : 0,
                        pan: panInput ? parseFloat(panInput.value) : 0,
                        pitch: pitchInput ? parseFloat(pitchInput.value) : 0,
                        treble: trebleInput ? parseFloat(trebleInput.value) : 0,
                        midGain: midGainInput ? parseFloat(midGainInput.value) : 0,
                        bass: bassInput ? parseFloat(bassInput.value) : 0,
                        muted: trackView.state?.mute || false,
                        armed: trackView.state?.isRecording || false,
                        hasContent: !!audioTrack?.player?.loaded,
                        isPlaying: audioTrack?.player?.state === 'started',
                        meters: this._captureTrackMeters(audioTrack),
                        effects: this.captureEffects(trackView)
                    });
                }
            }

            state.transport = {
                isPlaying: audioService.isPlaying || false,
                bpm: (window.Tone && Tone.Transport) ? Tone.Transport.bpm.value : 120,
                position: (window.Tone && Tone.Transport) ? Tone.Transport.position : '0:0:0',
                loopTime: audioService.loopTime || 4.0,
                sampleRate: (window.Tone && Tone.context) ? Tone.context.sampleRate : 48000
            };

            const ce = this._cachedElements;
            state.master = {
                volume: ce.masterVolSlider ? parseFloat(ce.masterVolSlider.value) : 1.0,
                muted: audioService.contextManager?.masterVolume?.mute || false,
                lfo1Active: audioService.contextManager?.lfo?.state === 'started',
                lfo2Active: audioService.contextManager?.lfo2?.state === 'started',
                isRecording: ce.masterRecBtn?.classList.contains('recording') || false,
                loopLength: ce.loopLenSlider ? parseFloat(ce.loopLenSlider.value) : 4.0
            };

            state.sampler = this.captureSampler();
            return state;
        }

        _getSlider(parent, param) {
            // Minimal lookup for track specific sliders
            const el = parent.querySelector(`input[data-param="${param}"]`);
            return el ? parseFloat(el.value) : 0;
        }

        _captureTrackMeters(audioTrack) {
            if (!audioTrack) return { l: 0, r: 0 };
            if (audioTrack.waveformNodes && audioTrack.waveformNodes.length >= 2) {
                const l = audioTrack.waveformNodes[0].getValue();
                const r = audioTrack.waveformNodes[1].getValue();
                let maxL = 0; for (let i = 0; i < l.length; i += 64) { if (Math.abs(l[i]) > maxL) maxL = Math.abs(l[i]); }
                let maxR = 0; for (let i = 0; i < r.length; i += 64) { if (Math.abs(r[i]) > maxR) maxR = Math.abs(r[i]); }
                return { l: maxL, r: maxR };
            }
            const monoVal = (audioTrack.inputMeter) ? Tone.dbToGain(audioTrack.inputMeter.getValue()) : 0;
            return { l: monoVal, r: monoVal };
        }

        captureSampler() {
            const pads = [];
            if (!this._cachedElements?.samplerBtns) return pads;
            this._cachedElements.samplerBtns.forEach(btn => {
                pads.push({
                    id: btn.dataset.sample,
                    label: btn.textContent,
                    active: btn.classList.contains('active'),
                    loaded: btn.classList.contains('loaded'),
                    dragOver: btn.classList.contains('drag-over')
                });
            });
            return pads;
        }

        captureEffects(trackView) {
            const effects = [];
            if (!trackView || !trackView.elements.trackEl) return effects;
            for (let slot = 0; slot < 7; slot++) {
                const checkbox = trackView.elements.trackEl.querySelector(`#fx-slot-${trackView.index}-${slot}`);
                const label = trackView.elements.trackEl.querySelector(`label[data-slot-label-index="${slot}"]`);
                effects.push({
                    slot: slot,
                    enabled: checkbox?.checked || false,
                    name: label?.textContent || (slot + 1).toString()
                });
            }
            return effects;
        }

        getMeterLevel(id) {
            const el = document.getElementById(id);
            if (!el) return 0;
            const style = el.style.width || el.style.height || "0%";
            return parseFloat(style) / 100;
        }
    }

    // Create global instance
    window.castStateBroadcaster = new CastStateBroadcaster();

    console.log('✅ CastStateBroadcaster.js: Cursor and UI state capture optimized.');
})();

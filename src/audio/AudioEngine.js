/**
 * AudioEngine.js
 * Central hub for the audio graph, tracks, routing, and master recording.
 * Replaces the old audio_service_v52.js Façade.
 */
(function() {
    class AudioEngine {
        constructor() {
            this.contextManager = new window.AudioContextManager();
            this.isMasterRecording = false;
            this.masterRecordStartTime = 0;
            this.stemRecorders = new Map();
        }

        async init() {
            await this.contextManager.init();
        }

        async createTrack(trackId) {
            const track = new window.TrackAudio(trackId, this.contextManager);
            return track;
        }

        // --- Master Routing Properties ---
        get masterLimiter() { return this.contextManager.masterLimiter; }
        get masterVolume() { return this.contextManager.masterVolume; }
        get masterBus() { return this.contextManager.masterBus; }
        get audioRouter() { return this.contextManager.audioRouter; }
        get samplerService() { return this.contextManager.samplerService; }

        setMasterVolume(db) {
            this.contextManager.setMasterVolume(db);
        }

        // --- Master Recording ---
        async startMasterRecording(format = 'wav') {
            if (!window.AudioUtils || !window.AudioUtils.PCMRecorder) {
                console.error("AudioEngine: PCMRecorder not found!");
                return;
            }

            // Create PCMRecorder utilizingTone's graph
            this.masterRecorder = new window.AudioUtils.PCMRecorder();
            
            // Connect to master limiter via Tone.js
            window.Tone.connect(this.contextManager.masterLimiter, this.masterRecorder.input);

            this.masterRecordStartTime = window.Tone.now();
            await this.masterRecorder.start();
            this.isMasterRecording = true;
            console.log(`AudioEngine: Started master recording (${format})`);
        }

        async stopMasterRecording() {
            if (!this.masterRecorder || !this.isMasterRecording) return null;
            
            this.contextManager.masterLimiter.disconnect(this.masterRecorder.input);
            const blob = await this.masterRecorder.stop();
            this.isMasterRecording = false;
            this.masterRecorder = null;
            console.log("AudioEngine: Stopped master recording.");
            return blob;
        }

        // --- Stems Recording ---
        async startStemsRecording() {
            this.stemRecorders = new Map();

            let mimeType;
            if (typeof MediaRecorder !== 'undefined') {
                if (MediaRecorder.isTypeSupported("audio/mp4")) mimeType = "audio/mp4";
                else if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) mimeType = "audio/webm;codecs=opus";
                else if (MediaRecorder.isTypeSupported("audio/webm")) mimeType = "audio/webm";
            }

            if (!window.tracks) return;

            window.tracks.forEach((trackView, id) => {
                if (!trackView || !trackView.trackAudio) return;
                const stemRecorder = new window.Tone.Recorder({ mimeType });
                trackView.trackAudio.volume.connect(stemRecorder);
                stemRecorder.start();
                this.stemRecorders.set(id, stemRecorder);
            });
            this.isStemsRecording = true;
        }

        async stopStemsRecording() {
            const stems = [];
            if (!this.stemRecorders) return stems;

            for (const [id, recorder] of this.stemRecorders.entries()) {
                const blob = await recorder.stop();
                stems.push({ id, blob });
                recorder.dispose();
            }
            this.stemRecorders.clear();
            this.isStemsRecording = false;
            return stems;
        }

        // --- LFO Management ---
        getLfo(index) {
            return this.contextManager.getLfo(index);
        }

        toggleLfo(index) {
            const lfo = this.getLfo(index);
            if (!lfo) return false;
            
            if (lfo.state === 'started') {
                lfo.stop(window.Tone.now());
                return false;
            } else {
                lfo.amplitude.value = 1;
                lfo.start(window.Tone.now());
                return true;
            }
        }
    }

    window.AudioEngine = AudioEngine;
    window.audioEngine = new AudioEngine();
})();

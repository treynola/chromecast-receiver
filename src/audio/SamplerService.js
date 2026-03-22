/**
 * SamplerService
 * Manages 20 SamplerVoices, choke groups, and global sampler settings.
 */
(function () {
    class SamplerService {
        constructor(audioContextManager) {
            if (!audioContextManager) {
                console.error("SamplerService: AudioContextManager is required");
                return;
            }

            this.acm = audioContextManager;
            this.voices = [];
            this.output = new Tone.Gain(1); // Master Sampler Volume

            // Connect to Master Bus
            if (this.acm.masterBus) {
                this.output.connect(this.acm.masterBus);
            } else {
                console.error("SamplerService: AudioContextManager.masterBus not found");
            }

            // Initialize 20 voices
            for (let i = 0; i < 20; i++) {
                const voice = new SamplerVoice(i + 1, this.acm);
                voice.connect(this.output);
                this.voices.push(voice);
            }

            console.log("SamplerService: Initialized 20 voices");
        }

        triggerPad(padId) {
            const voice = this.voices[padId - 1];
            if (!voice) return;

            // Handle Choke Groups
            if (voice.chokeGroup !== null) {
                this.silenceChokeGroup(voice.chokeGroup, voice.id);
            }

            voice.trigger();
        }

        releasePad(padId) {
            const voice = this.voices[padId - 1];
            if (voice) {
                voice.release();
            }
        }

        silenceChokeGroup(groupId, excludePadId) {
            this.voices.forEach(v => {
                if (v.chokeGroup === groupId && v.id !== excludePadId) {
                    v.stop();
                }
            });
        }

        stopAll() {
            this.voices.forEach(v => v.stop());
        }

        getVoice(padId) {
            return this.voices[padId - 1];
        }

        // Configuration Methods

        assignSample(padId, url, name) {
            const voice = this.getVoice(padId);
            if (voice) {
                // --- 1. Set Default Mode based on Row ---
                let defaultMode = 'oneshot';
                if (padId >= 1 && padId <= 4) defaultMode = 'oneshot';      // Row 1
                else if (padId >= 5 && padId <= 8) defaultMode = 'gate';    // Row 2
                else if (padId >= 9 && padId <= 12) defaultMode = 'toggle'; // Row 3
                else if (padId >= 13 && padId <= 16) defaultMode = 'gate';  // Row 4 (Custom/Gate)
                else if (padId >= 17 && padId <= 20) defaultMode = 'gate';  // Row 5

                voice.setMode(defaultMode);
                console.log(`SamplerService: Pad ${padId} default mode set to ${defaultMode}`);

                // --- 2. Handle Routing for Row 5 (Pads 17-20) ---
                if (padId >= 17 && padId <= 20) {
                    // Disconnect from Master Sampler Output
                    voice.player.disconnect();

                    // Determine Target Track
                    let trackIndex = -1;
                    if (padId === 17) trackIndex = 0; // Track 1
                    else if (padId === 18) trackIndex = 1; // Track 2
                    else if (padId === 19) trackIndex = 2; // Track 3
                    else if (padId === 20) trackIndex = 3; // Track 4

                    // Connect to Track Chain Input
                    if (window.tracks && window.tracks[trackIndex]) {
                        const track = window.tracks[trackIndex].trackAudio;
                        if (track && track.chainInput) {
                            voice.connect(track.chainInput);
                            console.log(`SamplerService: Pad ${padId} routed to Track ${trackIndex + 1} FX Chain.`);
                        } else {
                            console.warn(`SamplerService: Track ${trackIndex + 1} not ready for routing. Reverting to Master.`);
                            voice.connect(this.output);
                        }
                    } else {
                        console.warn(`SamplerService: Track ${trackIndex + 1} not found. Reverting to Master.`);
                        voice.connect(this.output);
                    }
                } else {
                    // Standard Routing (Ensure connected to Master Sampler Output if it was moved)
                    // We can just forcefully reconnect to be safe
                    voice.connect(this.output);
                }

                return voice.load(url, name);
            }
            return Promise.reject("Invalid Pad ID");
        }

        setPadMode(padId, mode) {
            const voice = this.getVoice(padId);
            if (voice) voice.setMode(mode);
        }

        setPadChokeGroup(padId, group) {
            const voice = this.getVoice(padId);
            if (voice) voice.chokeGroup = group;
        }

        setPadGrit(padId, enabled) {
            const voice = this.getVoice(padId);
            if (voice) voice.setGrit(enabled);
        }

        setPadTranswave(padId, enabled, rate) {
            const voice = this.getVoice(padId);
            if (voice) voice.setTranswave(enabled, rate);
        }

        setPadMicProfile(padId, profile) {
            const voice = this.getVoice(padId);
            if (voice) voice.setMicProfile(profile);
        }

        setPadSynthProfile(padId, profile) {
            const voice = this.getVoice(padId);
            if (voice) voice.setSynthProfile(profile);
        }

        // Persistence (Future)
        toJSON() {
            return this.voices.map(v => ({
                id: v.id,
                url: v.assignedUrl,
                mode: v.mode,
                chokeGroup: v.chokeGroup,
                name: v.name,
                loop: v.player.loop
            }));
        }

        loadState(state) {
            if (!Array.isArray(state)) return;
            state.forEach(s => {
                const voice = this.getVoice(s.id);
                if (voice && s.url) {
                    voice.load(s.url, s.name);
                    voice.setMode(s.mode);
                    voice.chokeGroup = s.chokeGroup;
                    voice.setLoop(!!s.loop);
                }
            });
        }
    }

    window.SamplerService = SamplerService;
})();

/**
 * SamplerVoice
 * Represents a single voice/pad in the sampler.
 * Wraps Tone.Player to handle different trigger modes.
 */
(function () {
    class SamplerVoice {
        constructor(id, audioContextManager) {
            this.id = id;
            this.acm = audioContextManager;

            this.player = new Tone.Player({
                url: "",
                loop: false,
                autostart: false,
                fadeIn: 0,
                fadeOut: 0.01,
            }); // Properly routed via .chain below

            // Default settings
            this.mode = 'oneshot'; // 'oneshot', 'gate', 'toggle'
            this.gritEnabled = false; // ASR-10 12-bit mode
            this.micProfile = 'none'; // 'none', 're15', 'rca44', 'sm57'
            this.synthProfile = 'none';
            this.transwaveEnabled = false;
            this.chokeGroup = null;
            this.name = `Pad ${id}`;
            this.assignedUrl = null;

            // V12.75: LAZY SIGNAL CHAIN (CPU RECOVERY)
            // By default, route directly to output to save 100+ active node calculations.
            // Nodes (BitCrusher, Chorus, Filter, etc.) will be created only on-demand.
            this.nodes = null;

            // Final Output
            this.outputBus = new Tone.Gain(1);
            this.player.connect(this.outputBus);

            // Logical state tracking to handle scheduling lag
            this._isPlaying = false;

            this.player.onstop = () => {
                this._isPlaying = false;
            };
        }

        _ensureNodes() {
            if (this.nodes) return;
            console.log(`SamplerVoice ${this.id}: Instantiating vintage signal chain...`);
            this.player.disconnect();

            this.nodes = {};
            this.nodes.bitCrusher = new Tone.BitCrusher(12);
            this.nodes.bitCrusher.wet.value = 0;

            this.nodes.chorus = new Tone.Chorus(2, 2, 0.5).start();
            this.nodes.chorus.wet.value = 0;

            this.nodes.filter = new Tone.Filter({
                frequency: 20000,
                type: "lowpass",
                rolloff: -12
            });

            this.nodes.filter2 = new Tone.Filter({
                frequency: 20,
                type: "highpass",
                rolloff: -12
            });

            this.nodes.saturator = new Tone.Distortion(0);
            this.nodes.limiter = new Tone.Limiter(-1);

            // Routing: Player -> BitCrusher -> Chorus -> Filter1 -> Filter2 -> Saturator -> Limiter -> Output
            this.player.chain(
                this.nodes.bitCrusher,
                this.nodes.chorus,
                this.nodes.filter,
                this.nodes.filter2,
                this.nodes.saturator,
                this.nodes.limiter,
                this.outputBus
            );
        }

        load(url, name) {
            return new Promise((resolve, reject) => {
                this.assignedUrl = url;
                if (name) this.name = name;

                this.player.load(url).then(() => {
                    const bufferSR = this.player.buffer ? this.player.buffer.sampleRate : 'unknown';
                    console.log(`SamplerVoice ${this.id}: Loaded ${url} (BufferSR=${bufferSR}. ContextSR=${Tone.context.sampleRate})`);
                    resolve();
                }).catch(err => {
                    console.error(`SamplerVoice ${this.id}: Failed to load ${url}`, err);
                    reject(err);
                });
            });
        }

        async trigger(time) {
            if (!this.player.loaded) return;

            // Ensure Context is Running
            if (Tone.context.state !== 'running') {
                try {
                    await Tone.start();
                } catch (e) {
                    console.error("Failed to resume AudioContext", e);
                }
            }

            const safeTime = (time !== undefined) ? time : (Tone.now() + 0.05);

            if (this.mode === 'toggle') {
                if (this._isPlaying) {
                    this.stop(safeTime);
                    this.player.loop = false;
                } else {
                    this.player.loop = true;
                    this.play(safeTime);
                }
            }
            else if (this.mode === 'gate') {
                this.player.loop = false;
                // If re-triggering while holding, restart
                if (this._isPlaying) {
                    this.player.stop(safeTime);
                }
                this.play(safeTime);
            }
            else {
                // ONE SHOT
                this.player.loop = this.transwaveEnabled; // Transwaves usually loop
                // Always restart for one shot
                if (this._isPlaying) {
                    this.player.stop(safeTime);
                }
                this.play(safeTime);
            }
        }

        release(time) {
            const safeTime = (time !== undefined) ? time : (Tone.now() + 0.05);

            if (this.mode === 'gate') {
                this.stop(safeTime);
            }
            // Toggle & OneShot ignore release
        }

        play(time) {
            try {
                this.player.start(time, 0);
                this._isPlaying = true;
            } catch (e) {
                console.error(`SamplerVoice ${this.id}: Play Error`, e);
            }
        }

        stop(time) {
            try {
                this.player.stop(time);
                // onstop will handle flag, but we can optimistically set it to prevent double-trigger
                // But wait, if scheduled for future, setting false now might be wrong?
                // For 'toggle' logic, we interpret 'trigger' as 'intent to stop'.
                // So setting it false immediately for logic checks is okay.
                // However, Tone.Player's onstop might fire later.
                // Let's rely on _isPlaying for the TOGGLE check.
            } catch (e) {
                console.error(`SamplerVoice ${this.id}: Stop Error`, e);
            }
        }

        setMode(mode) {
            const validModes = ['oneshot', 'gate', 'toggle'];
            if (validModes.includes(mode)) {
                this.mode = mode;
                console.log(`SamplerVoice ${this.id}: Mode set to ${mode}`);
                this.stop();
            }
        }

        setGrit(enabled) {
            this._ensureNodes();
            this.gritEnabled = !!enabled;
            this.nodes.bitCrusher.wet.setTargetAtTime(enabled ? 1 : 0, Tone.now(), 0.1);
            // If grit is on, apply the "ASR-10" tone (slight HF loss)
            this.nodes.filter.frequency.setTargetAtTime(enabled ? 12000 : 20000, Tone.now(), 0.1);
            console.log(`SamplerVoice ${this.id}: Grit ${enabled ? 'ON' : 'OFF'}`);
        }

        setTranswave(enabled, rate = 0.5) {
            this.transwaveEnabled = !!enabled;
            if (enabled) {
                this.nodes.transwaveLFO.frequency.value = rate;
                this.nodes.transwaveLFO.resume();

                // Transwave scans the sample. We map LFO to loop duration.
                // This is a simplified "scanning" that modulates loopStart/End
                // We'll need to link the LFO output to the player parameters
                // Tone.Player loopStart/loopEnd aren't directly addressable by LFO in a simple way
                // So we'll use a draw loop or internal scheduling.
                // For now, we'll use the LFO to modulate filter cutoff as a placeholder for the "texture"
                // until we implement the frame-skipping logic.
                this.nodes.transwaveLFO.connect(this.nodes.filter.frequency);
                this.player.loop = true;
            } else {
                this.nodes.transwaveLFO.pause();
                this.nodes.transwaveLFO.disconnect();
                this.player.loop = false;
                this.nodes.filter.frequency.value = 20000;
            }
            console.log(`SamplerVoice ${this.id}: Transwave ${enabled ? 'ON' : 'OFF'}`);
        }

        setMicProfile(profile) {
            this._ensureNodes();
            this.micProfile = profile;
            const now = Tone.now();
            // Reset filters to safe state before applying profile
            this.nodes.filter.type = 'lowpass';
            this.nodes.filter.frequency.value = 20000;
            this.nodes.filter.gain.value = 0;

            switch (profile) {
                case 'rca44':
                    this.nodes.filter.frequency.setTargetAtTime(12000, now, 0.1);
                    break;
                case 'sm57':
                    this.nodes.filter.type = 'peaking';
                    this.nodes.filter.frequency.setTargetAtTime(4000, now, 0.1);
                    this.nodes.filter.gain.setTargetAtTime(4, now, 0.1);
                    break;
                case 're15':
                    this.nodes.filter.frequency.setTargetAtTime(15000, now, 0.1);
                    break;
            }
        }

        setSynthProfile(profile) {
            this._ensureNodes();
            this.synthProfile = profile;
            const now = Tone.now();

            // Reset signal chain
            this.nodes.bitCrusher.wet.value = 0;
            this.nodes.chorus.wet.value = 0;
            this.nodes.saturator.distortion = 0;
            this.nodes.filter.type = "lowpass";
            this.nodes.filter.rolloff = -12;
            this.nodes.filter2.type = "highpass";
            this.nodes.filter2.frequency.value = 20;

            switch (profile) {
                case 'moog':
                    // 24dB Ladder + Saturation
                    this.nodes.filter.rolloff = -24;
                    this.nodes.filter.frequency.value = 2000; // Classic warm cutoff
                    this.nodes.saturator.distortion = 0.4;
                    break;
                case 'jupiter':
                    // 4-pole + Ensemble Chorus
                    this.nodes.filter.rolloff = -24;
                    this.nodes.chorus.wet.value = 0.6;
                    break;
                case 'cs80':
                    // Dual filter (LPF/HPF)
                    this.nodes.filter.frequency.value = 5000;
                    this.nodes.filter2.frequency.value = 400;
                    break;
                case 'fairlight':
                    // 8-bit + reconstruction filter
                    this.nodes.bitCrusher.bits.value = 8;
                    this.nodes.bitCrusher.wet.value = 1;
                    this.nodes.filter.frequency.value = 8000;
                    break;
            }
            console.log(`SamplerVoice ${this.id}: Synth Profile set to ${profile}`);
        }

        // ... helpers ...
        connect(dest) {
            this.outputBus.disconnect();
            this.outputBus.connect(dest);
        }

        dispose() {
            this.player.dispose();
        }
    }

    // Export globally
    window.SamplerVoice = SamplerVoice;
})();

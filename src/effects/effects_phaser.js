/*
 * Filename: effects_phaser.js
 * Version: NOV25_AntiGravity Version 1.0
 * Date: November 25, 2025
 * Time: 16:38 CST
 * Description: Phaser effects implementation.
 */
if (typeof window.effectModules === 'undefined') { window.effectModules = {}; }
if (typeof window.AppSource === 'undefined') { window.AppSource = {}; }

// --- REQUIRED BLOCK FOR DYNAMIC BUILD ---
if (typeof window.saveModuleSource === 'function') {
    window.saveModuleSource('effects_phaser.js');
}

// Actual module code
(() => {
    const { EffectBase } = window;
    const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

    class BossPH1Phaser extends EffectBase {
        constructor() {
            super("BossPH1Phaser");
            this.nodes.phaser = new Tone.Phaser({ frequency: 1, octaves: 3, stages: 4, Q: 2, baseFrequency: 500, wet: 1 });
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.phaser, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.phaser);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.rate !== undefined) this.nodes.phaser.frequency.setTargetAtTime(params.rate, now, 0.01);
        }
    }
    class EHXSmallStone extends EffectBase {
        constructor() {
            super("EHXSmallStone");
            // Small Stone: 4-stage with unique feedback (Color)
            this._params = { rate: 0.5, color: 0 };

            // Small Stone uses OTA chips which are fairly clean but soft clip at high resonance
            this.nodes.phaser = new Tone.Phaser({
                frequency: 0.5,
                octaves: 3.5,
                stages: 4,
                Q: 5,
                baseFrequency: 400,
                wet: 1
            });
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.phaser, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.phaser);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.rate !== undefined) {
                this._params.rate = params.rate;
                this.nodes.phaser.frequency.setTargetAtTime(params.rate, now, 0.01);
            }
            if (params.color !== undefined) {
                this._params.color = params.color;
                // Color Up: High feedback resonance. Color Down: Minimal resonance.
                if (params.color > 0.5) {
                    // Authentic Color mode is very resonant
                    this.nodes.phaser.Q.setTargetAtTime(18, now, 0.01);
                    this.nodes.phaser.baseFrequency = 350;
                } else {
                    this.nodes.phaser.Q.setTargetAtTime(2, now, 0.01);
                    this.nodes.phaser.baseFrequency = 450;
                }
            }
        }
    }

    class MuTronBiPhase extends EffectBase {
        constructor() {
            super("MuTronBiPhase");
            // Bi-Phase: Two 6-stage phasers with complex routing
            this._params = { rateA: 0.2, depthA: 6, feedbackA: 0.2, rateB: 0.2, depthB: 6, feedbackB: 0.2, mode: 0 };

            this.nodes.phaserA = new Tone.Phaser({ frequency: 0.2, octaves: 6, stages: 6, Q: 4, wet: 1 });
            this.nodes.phaserB = new Tone.Phaser({ frequency: 0.2, octaves: 6, stages: 6, Q: 4, wet: 1 });

            this.nodes.crossfade = new Tone.CrossFade(0.5); // Mode selector: Serial/Parallel
            this.nodes.merger = new Tone.Merge();

            this.wet.disconnect(this.nodes.stereoWidener);

            // Parallel Path
            this.wet.chain(this.nodes.phaserA);
            this.wet.chain(this.nodes.phaserB);

            // Serial Path
            this.nodes.phaserA.connect(this.nodes.phaserB); // For serial routing

            // Wiring for Parallel
            this.nodes.phaserA.connect(this.nodes.merger, 0, 0);
            this.nodes.phaserB.connect(this.nodes.merger, 0, 1);

            this.nodes.merger.connect(this.nodes.stereoWidener);

            this._disposables.push(this.nodes.phaserA, this.nodes.phaserB, this.nodes.crossfade, this.nodes.merger);
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.rateA !== undefined) this.nodes.phaserA.frequency.setTargetAtTime(params.rateA, now, 0.01);
            if (params.depthA !== undefined) this.nodes.phaserA.octaves = params.depthA;
            if (params.feedbackA !== undefined) this.nodes.phaserA.Q.setTargetAtTime(params.feedbackA * 20, now, 0.01);

            if (params.rateB !== undefined) this.nodes.phaserB.frequency.setTargetAtTime(params.rateB, now, 0.01);
            if (params.depthB !== undefined) this.nodes.phaserB.octaves = params.depthB;
            if (params.feedbackB !== undefined) this.nodes.phaserB.Q.setTargetAtTime(params.feedbackB * 20, now, 0.01);

            if (params.sync !== undefined && params.sync > 0.5) {
                this.nodes.phaserB.frequency.setTargetAtTime(this.nodes.phaserA.frequency.value, now, 0.01);
            }
        }
    }

    class MXRPhase100 extends EffectBase {
        constructor() {
            // MXR Phase 100 (1979)
            // 10-stage JFET phaser (more stages than Phase 90)
            // 4-position Intensity switch (combinations of sweep width + feedback)
            // Optical-like sweep character, very smooth
            super("MXRPhase100");
            this._params = { speed: 0.5, intensity: 0 };

            // JFET saturation characteristic (subtle)
            this.nodes.saturation = new Tone.Chebyshev(2);
            this.nodes.saturation.wet.value = 0.15;

            // Phase 100 is known for warm, smooth character
            this.nodes.warmth = new Tone.Filter({ type: 'lowshelf', frequency: 200, gain: 2 });

            this.nodes.phaser = new Tone.Phaser({
                frequency: 0.5,
                octaves: 4,
                stages: 10,
                Q: 5,
                baseFrequency: 350,
                wet: 1
            });

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.saturation, this.nodes.warmth, this.nodes.phaser, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.phaser, this.nodes.saturation, this.nodes.warmth);
        }

        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.speed !== undefined) {
                this.nodes.phaser.frequency.setTargetAtTime(params.speed, now, 0.01);
            }

            if (params.intensity !== undefined) {
                // 4-position Intensity switch:
                // 1: Subtle sweep, low feedback
                // 2: Medium sweep, medium feedback
                // 3: Wide sweep, high feedback
                // 4: Maximum sweep and feedback
                const settings = [
                    { octaves: 2, Q: 2, baseFreq: 350 },
                    { octaves: 4, Q: 4, baseFreq: 300 },
                    { octaves: 5, Q: 8, baseFreq: 250 },
                    { octaves: 6, Q: 12, baseFreq: 200 }
                ];
                const s = settings[clamp(Math.floor(params.intensity), 0, 3)];
                this.nodes.phaser.octaves = s.octaves;
                this.nodes.phaser.Q.setTargetAtTime(s.Q, now, 0.01);
                this.nodes.phaser.baseFrequency = s.baseFreq;
            }
        }
    }

    class MXRPhase90 extends EffectBase {
        constructor() {
            // MXR Phase 90 (1974)
            // Classic 4-stage JFET phaser (4x matched 2N5952 JFETs)
            // Single Speed control
            // Creates two notches in frequency response
            // Script vs Block logo versions have different feedback
            super("MXRPhase90");
            this._params = { speed: 0.5, mode: 0 };

            // Script mode (original): less aggressive, smoother
            // Block mode (later): more aggressive, more feedback
            const isScriptMode = this._params.mode < 0.5;

            // JFET saturation - the "chewy" character
            this.nodes.saturation = new Tone.Chebyshev(2);
            this.nodes.saturation.wet.value = isScriptMode ? 0.1 : 0.2;

            // Input buffer coloration
            this.nodes.inputBuffer = new Tone.Filter({ type: 'peaking', frequency: 900, Q: 0.5, gain: 1 });

            this.nodes.phaser = new Tone.Phaser({
                frequency: this._params.speed,
                octaves: isScriptMode ? 3 : 4,
                stages: 4, // Authentic 4 stages
                Q: isScriptMode ? 3 : 6, // Block has more feedback
                baseFrequency: 500,
                wet: 1
            });

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.inputBuffer, this.nodes.saturation, this.nodes.phaser, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.phaser, this.nodes.saturation, this.nodes.inputBuffer);
        }

        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.mode !== undefined) {
                this._params.mode = params.mode;
                const isScriptMode = params.mode < 0.5;

                // Script: Smoother, less feedback, original 1974 character
                // Block: More aggressive, more feedback, post-1977
                this.nodes.phaser.octaves = isScriptMode ? 3 : 4;
                this.nodes.phaser.Q.setTargetAtTime(isScriptMode ? 3 : 6, now, 0.01);
                this.nodes.saturation.wet.setTargetAtTime(isScriptMode ? 0.1 : 0.2, now, 0.01);
            }

            if (params.speed !== undefined) {
                this._params.speed = params.speed;
                this.nodes.phaser.frequency.setTargetAtTime(params.speed, now, 0.01);
            }
        }
    }

    class PearlPH44 extends EffectBase {
        constructor() {
            // Pearl PH-44 Phaser (1970s)
            // 12-stage phaser (very deep, liquid phasing)
            // Japanese-made, warm character
            super("PearlPH44");
            this._params = { rate: 0.5, depth: 5, feedback: 5 };

            this.nodes.phaser = new Tone.Phaser({
                frequency: this._params.rate,
                octaves: this._params.depth,
                stages: 12,
                Q: this._params.feedback,
                baseFrequency: 300,
                wet: 1
            });

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.phaser, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.phaser);
        }

        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.depth !== undefined) {
                this._params.depth = params.depth;
                this.nodes.phaser.octaves = this._params.depth;
            }

            if (params.rate !== undefined) {
                this._params.rate = params.rate;
                this.nodes.phaser.frequency.setTargetAtTime(this._params.rate, now, 0.01);
            }

            if (params.feedback !== undefined) {
                this._params.feedback = params.feedback;
                this.nodes.phaser.Q.setTargetAtTime(this._params.feedback, now, 0.01);
            }
        }
    }

    
    class MoogMF103 extends EffectBase {
        constructor() {
            super("MoogMF103");
            // Moog MF-103 12-Stage Phaser
            // Characteristic: Deep, rich analog phasing with resonant sweep.
            // Selectable 6-stage or 12-stage.
            this.nodes.phaser = new Tone.Phaser({
                frequency: 1,
                octaves: 4,
                stages: 12,
                Q: 5,
                baseFrequency: 350,
                wet: 1
            });
            // Moog Drive circuit
            this.nodes.drive = new Tone.Chebyshev(2);
            this.nodes.drive.wet.value = 0.3;
            
            this.nodes.gain = new Tone.Gain(1);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.drive, this.nodes.phaser, this.nodes.gain, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.phaser, this.nodes.drive, this.nodes.gain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.rate !== undefined) this.nodes.phaser.frequency.setTargetAtTime(params.rate, now, 0.01);
            if (params.amount !== undefined) this.nodes.phaser.octaves = 2 + (params.amount * 4);
            if (params.sweep !== undefined) this.nodes.phaser.baseFrequency = 100 + (params.sweep * 1000);
            if (params.resonance !== undefined) this.nodes.phaser.Q.setTargetAtTime(1 + (params.resonance * 10), now, 0.01);
            if (params.stages !== undefined) {
                // 0 = 6-stage, 1 = 12-stage
                const stages = params.stages > 0.5 ? 12 : 6;
                if (this.nodes.phaser.stages !== stages) {
                    // Phaser stages cannot be dynamically changed in Tone.js without re-instantiation
                    // We will approximate by changing the depth/Q if needed, or recreate.
                    // For performance, we'll map stages to Q and Octaves internally.
                    if (stages === 12) {
                         this.nodes.phaser.Q.value *= 1.5;
                    } else {
                         this.nodes.phaser.Q.value /= 1.5;
                    }
                }
            }
            if (params.drive !== undefined) this.nodes.drive.wet.setTargetAtTime(params.drive * 0.8, now, 0.01);
        }
    }

    class RolandJetPhaser extends EffectBase {
        constructor() {
            super("RolandJetPhaser");
            // Roland AP-7 Jet Phaser (1975)
            // Characteristic: Fuzz + Phaser in one box (Larry Graham style)
            
            // Fuzz section (built-in hard clipping)
            this.nodes.fuzz = new Tone.Distortion(0.8);
            
            // 8-Stage phaser
            this.nodes.phaser = new Tone.Phaser({
                frequency: 2,
                octaves: 5,
                stages: 8,
                Q: 4,
                wet: 1
            });
            
            this.nodes.output = new Tone.Gain(1);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.fuzz, this.nodes.phaser, this.nodes.output, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.phaser, this.nodes.fuzz, this.nodes.output);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.rate !== undefined) this.nodes.phaser.frequency.setTargetAtTime(params.rate, now, 0.01);
            if (params.resonance !== undefined) this.nodes.phaser.Q.setTargetAtTime(1 + (params.resonance * 8), now, 0.01);
            if (params.fuzz !== undefined) {
                this.nodes.fuzz.distortion = params.fuzz;
                this.nodes.fuzz.wet.setTargetAtTime(params.fuzz > 0.01 ? 1 : 0, now, 0.01); // Can turn fuzz off
            }
            if (params.level !== undefined) this.nodes.output.gain.setTargetAtTime(params.level, now, 0.01);
        }
    }

    const classes = { MoogMF103, RolandJetPhaser,  BossPH1Phaser, EHXSmallStone, MuTronBiPhase, MXRPhase100, MXRPhase90, PearlPH44 };
    const configs = { "Phaser": {
            "Phaser: Moog MF-103": { "isCustom": "MoogMF103", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Rate", "p": "rate", "min": 0.1, "max": 10, "s": 0.1, "def": 1 }, { "l": "Amount", "p": "amount", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }], [{ "l": "Sweep", "p": "sweep", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }, { "l": "Resonance", "p": "resonance", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }], [{ "l": "Drive", "p": "drive", "min": 0, "max": 1, "s": 0.01, "def": 0.3 }, { "l": "Stages", "p": "stages", "min": 0, "max": 1, "s": 1, "def": 1, "unit": " 6/12" }]] },
            "Phaser: Roland AP-7 Jet": { "isCustom": "RolandJetPhaser", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Rate", "p": "rate", "min": 0.1, "max": 10, "s": 0.1, "def": 2 }, { "l": "Resonance", "p": "resonance", "min": 0, "max": 1, "s": 0.01, "def": 0.6 }], [{ "l": "Jet Fuzz", "p": "fuzz", "min": 0, "max": 1, "s": 0.01, "def": 0.8 }, { "l": "Level", "p": "level", "min": 0, "max": 2, "s": 0.01, "def": 1 }]] },
             "Phaser: Boss PH-1": { "isCustom": "BossPH1Phaser", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Rate", "p": "rate", "min": 0.1, "max": 10, "s": 0.1, "def": 1 }]] }, "Phaser: EHX Small Stone": { "isCustom": "EHXSmallStone", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Rate", "p": "rate", "min": 0.1, "max": 10, "s": 0.1, "def": 0.5 }, { "l": "Color", "p": "color", "min": 0, "max": 1, "s": 1, "def": 0, "unit": " Off/On" }]] }, "Phaser: Mu-Tron Bi-Phase": { "isCustom": "MuTronBiPhase", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Rate A", "p": "rateA", "min": 0.05, "max": 10, "def": 0.2 }, { "l": "Depth A", "p": "depthA", "min": 1, "max": 8, "s": 1, "def": 6 }, { "l": "Feedback A", "p": "feedbackA", "min": 0, "max": 0.9, "def": 0.2 }], [{ "l": "Rate B", "p": "rateB", "min": 0.05, "max": 10, "def": 0.2 }, { "l": "Depth B", "p": "depthB", "min": 1, "max": 8, "s": 1, "def": 6 }, { "l": "Feedback B", "p": "feedbackB", "min": 0, "max": 0.9, "def": 0.2 }], [{ "l": "Sync B to A", "p": "sync", "min": 0, "max": 1, "s": 1, "def": 0, "unit": " Off/On" }]] }, "Phaser: MXR Phase 100": { "isCustom": "MXRPhase100", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Speed", "p": "speed", "min": 0.1, "max": 8, "s": 0.1, "def": 0.5 }, { "l": "Intensity", "p": "intensity", "min": 0, "max": 3, "s": 1, "def": 0, "unit": " 1/2/3/4" }]] }, "Phaser: MXR Phase 90": { "isCustom": "MXRPhase90", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Speed", "p": "speed", "min": 0.1, "max": 8, "s": 0.1, "def": 0.5, "unit": "Hz" }], [{ "l": "Mode", "p": "mode", "min": 0, "max": 1, "s": 1, "def": 0, "unit": " Script/Block" }]] }, "Phaser: Pearl PH-44": { "isCustom": "PearlPH44", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Rate", "p": "rate", "min": 0.1, "max": 10, "s": 0.1, "def": 0.5 }, { "l": "Depth", "p": "depth", "min": 1, "max": 8, "s": 0.1, "def": 5 }], [{ "l": "Feedback", "p": "feedback", "min": 1, "max": 15, "s": 0.1, "def": 5 }]] } } };
    window.effectModules.phaser = { classes, configs };
})();
/*
 * Filename: effects_flanger.js
 * Version: NOV25_AntiGravity Version 1.0
 * Date: November 25, 2025
 * Time: 16:36 CST
 * Description: Flanger effects implementation.
 */
if (typeof window.effectModules === 'undefined') { window.effectModules = {}; }
if (typeof window.AppSource === 'undefined') { window.AppSource = {}; }

// --- REQUIRED BLOCK FOR DYNAMIC BUILD ---
if (typeof window.saveModuleSource === 'function') {
    window.saveModuleSource('effects_flanger.js');
}

// Actual module code
(() => {
    const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
    const { EffectBase } = window;
    const RAMP_TIME = 0.01;

    class ADADelay extends EffectBase {
        constructor() {
            super("ADADelay");
            // A/DA Flanger (1977): Reticon SAD1024 Bucket Brigade.
            // Famous for its insane sweep range: 0.035ms to 11ms (much wider than normal flangers).
            // Uses a custom compander circuit that adds a specific "hollow" or "metallic" vocal quality.
            
            // Compander pre-emphasis (boosts highs before delay)
            this.nodes.preEmphasis = new Tone.Filter({ type: 'highshelf', frequency: 3000, gain: 6 });
            
            this.nodes.delay = new Tone.Delay(0.001, 0.02);
            this.nodes.feedbackGain = new Tone.Gain(0);
            
            // Anti-aliasing filter in the feedback loop
            this.nodes.bbdFilter = new Tone.Filter({ type: 'lowpass', frequency: 8000, rolloff: -12 });
            
            this.nodes.lfo = new Tone.LFO({ frequency: 0.5, type: 'sine', min: 0.000035, max: 0.011 }).start();
            this.nodes.lfo.connect(this.nodes.delay.delayTime);

            // BBD Saturation (SAD1024 clips in a very warm way)
            this.nodes.sat = new Tone.Chebyshev(2);
            this.nodes.sat.wet.value = 0.2;

            // Compander de-emphasis (cuts highs after delay, reducing BBD noise)
            this.nodes.deEmphasis = new Tone.Filter({ type: 'highshelf', frequency: 3000, gain: -6 });
            
            // Wet path mixing
            this.nodes.wetMix = new Tone.Gain(0.5); // 50/50 mix for flanging

            this.wet.disconnect(this.nodes.stereoWidener);
            
            // Dry path -> stereo widener
            this.wet.connect(this.nodes.stereoWidener);
            
            // Wet path -> pre-emphasis -> sat -> delay -> de-emphasis -> mix -> stereo widener
            this.wet.chain(this.nodes.preEmphasis, this.nodes.sat, this.nodes.delay, this.nodes.deEmphasis, this.nodes.wetMix, this.nodes.stereoWidener);
            
            // Feedback loop (Delay -> Filter -> Gain -> Delay)
            this.nodes.delay.chain(this.nodes.bbdFilter, this.nodes.feedbackGain, this.nodes.delay);

            this._disposables.push(
                this.nodes.preEmphasis, this.nodes.delay, this.nodes.feedbackGain, 
                this.nodes.bbdFilter, this.nodes.lfo, this.nodes.sat, 
                this.nodes.deEmphasis, this.nodes.wetMix
            );
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.speed !== undefined) this.nodes.lfo.frequency.setTargetAtTime(params.speed, now, 0.01);
            if (params.range !== undefined) {
                // Range scales the LFO max delay time
                this.nodes.lfo.max = 0.000035 + (params.range * 0.010965);
            }
            if (params.enhance !== undefined) {
                // Enhance is the feedback control. ADA can self-oscillate
                this.nodes.feedbackGain.gain.setTargetAtTime(params.enhance * 0.98, now, 0.01);
            }
            if (params.manual !== undefined) {
                // If manual is tweaked, it shifts the center point
                this.nodes.lfo.min = Math.max(0.000035, params.manual * 0.01);
            }
        }
    }

    class BossBF2 extends EffectBase {
        constructor() {
            // Boss BF-2 Flanger (1981-2002)
            // Uses MN3207 1024-stage BBD + MN3102 clock driver
            // Delay range: 2.56ms-51.2ms (ideal for flanging)
            // 4 controls: Manual, Depth, Rate, Resonance
            // Characteristic smooth, versatile flanging
            super("BossBF2");
            this._params = { manual: 0.003, depth: 0.7, rate: 0.5, res: 0.1 };

            // MN3207 anti-aliasing filter
            this.nodes.antiAlias = new Tone.Filter({ frequency: 7500, type: 'lowpass', rolloff: -12 });

            // BBD saturation (subtle)
            this.nodes.bbdSat = new Tone.Chebyshev(2);
            this.nodes.bbdSat.wet.value = 0.1;

            // Main flanger
            this.nodes.flanger = new Tone.Chorus({
                frequency: 0.5,
                delayTime: 0.003, // ~3ms center for flanging
                depth: 0.7,
                feedback: 0.1,
                spread: 180,
                wet: 1
            });

            // Reconstruction filter
            this.nodes.reconstruction = new Tone.Filter({ frequency: 7000, type: 'lowpass', rolloff: -12 });

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(
                this.nodes.antiAlias,
                this.nodes.bbdSat,
                this.nodes.flanger,
                this.nodes.reconstruction,
                this.nodes.stereoWidener
            );

            this._disposables.push(
                this.nodes.antiAlias, this.nodes.bbdSat,
                this.nodes.flanger, this.nodes.reconstruction
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.rate !== undefined) {
                this.nodes.flanger.frequency.setTargetAtTime(params.rate, now, 0.01);
            }

            if (params.depth !== undefined) {
                this.nodes.flanger.depth.value = params.depth;
            }

            if (params.manual !== undefined) {
                // BF-2 manual range: approximately 1-13ms
                const delay = 0.001 + (params.manual * 0.012);
                this.nodes.flanger.delayTime.value = delay;
            }

            if (params.res !== undefined) {
                // Resonance (feedback)
                this.nodes.flanger.feedback.setTargetAtTime(clamp(params.res, 0, 0.95), now, 0.01);
            }
        }
    }

    class EHXElectricMistress extends EffectBase {
        constructor() {
            // EHX Deluxe Electric Mistress (1977)
            // Uses SAD1024 BBD chips
            // Famous for: "Filter Matrix" mode (stops LFO for manual sweep)
            // Metallic, shimmering, ringing character
            // Used by Andy Summers, David Gilmour
            super("EHXElectricMistress");
            this._params = { rate: 0.2, range: 0.8, color: 0.5, matrix: 0 };

            // SAD1024 anti-aliasing
            this.nodes.antiAlias = new Tone.Filter({ frequency: 6500, type: 'lowpass', rolloff: -12 });

            // BBD saturation (more than typical, gives the "shimmering" quality)
            this.nodes.bbdSat = new Tone.Chebyshev(2);
            this.nodes.bbdSat.wet.value = 0.2;

            // Main flanger
            this.nodes.flanger = new Tone.Chorus({
                frequency: 0.2,
                delayTime: 0.005,
                depth: 0.8,
                feedback: 0.5,
                spread: 180,
                wet: 1
            });

            // Electric Mistress has a metallic, ringing character
            // This is partly from the feedback and partly from filter resonance
            this.nodes.resonance = new Tone.Filter({
                frequency: 3500,
                type: 'peaking',
                Q: 2,
                gain: 4
            });

            // BBD reconstruction filter
            this.nodes.bbdFilter = new Tone.Filter({ frequency: 6000, type: 'lowpass', rolloff: -12 });

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(
                this.nodes.antiAlias,
                this.nodes.bbdSat,
                this.nodes.flanger,
                this.nodes.resonance,
                this.nodes.bbdFilter,
                this.nodes.stereoWidener
            );

            this._disposables.push(
                this.nodes.antiAlias, this.nodes.bbdSat,
                this.nodes.flanger, this.nodes.resonance, this.nodes.bbdFilter
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.matrix !== undefined) {
                this._params.matrix = params.matrix;
                // Filter Matrix mode: stops LFO for manual sweep
                if (params.matrix > 0.5) {
                    this.nodes.flanger.frequency.value = 0;
                    this.nodes.flanger.depth.value = 0;
                } else {
                    this.nodes.flanger.frequency.setTargetAtTime(this._params.rate, now, 0.01);
                    this.nodes.flanger.depth.value = this._params.range;
                }
            }

            if (params.rate !== undefined) {
                this._params.rate = params.rate;
                if (this._params.matrix <= 0.5) {
                    this.nodes.flanger.frequency.setTargetAtTime(params.rate, now, 0.01);
                }
            }

            if (params.range !== undefined) {
                this._params.range = params.range;
                if (this._params.matrix > 0.5) {
                    // In Filter Matrix mode, Range becomes manual sweep
                    this.nodes.flanger.delayTime.value = 0.001 + (params.range * 0.015);
                } else {
                    this.nodes.flanger.depth.value = params.range;
                }
            }

            if (params.color !== undefined) {
                // Color controls feedback and resonance intensity
                this.nodes.flanger.feedback.setTargetAtTime(clamp(params.color, 0, 0.95), now, 0.01);
                this.nodes.resonance.gain.setTargetAtTime(params.color * 8, now, 0.01);
            }
        }
    }

    class IbanezFL9 extends EffectBase {
        constructor() {
            super("IbanezFL9");
            // Ibanez FL-9 (1981)
            // Uses MN3207 BBD - warm, slightly mid-focused
            this.nodes.inputBuffer = new Tone.Filter({ type: "peaking", frequency: 800, Q: 0.5, gain: 2 }); // 9-series mid bump
            this.nodes.bbdSat = new Tone.Chebyshev(2);
            this.nodes.bbdSat.wet.value = 0.15;

            this.nodes.flanger = new Tone.Chorus({
                frequency: 0.5,
                delayTime: 0.005,
                depth: 0.7,
                feedback: 0.1,
                spread: 180,
                wet: 1
            });
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.inputBuffer, this.nodes.bbdSat, this.nodes.flanger, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.inputBuffer, this.nodes.bbdSat, this.nodes.flanger);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.speed !== undefined) this.nodes.flanger.frequency.setTargetAtTime(params.speed, now, 0.01);
            if (params.width !== undefined) this.nodes.flanger.depth.value = params.width;
            if (params.regen !== undefined) this.nodes.flanger.feedback.setTargetAtTime(clamp(params.regen, 0, 0.95), now, 0.01);
            if (params.delayTime !== undefined) {
                this.nodes.flanger.delayTime.value = 0.001 + (params.delayTime * 0.01);
            }
        }
    }

    class MXRFlanger117 extends EffectBase {
        constructor() {
            super("MXRFlanger117");
            // MXR Flanger: Famous for its logic-driven sweep and thick sound
            // Uses Reticon SAD1024 BBD - darker, grittier than Boss
            this._params = { speed: 0.1, widthParam: 0.01, regen: 0, manual: 0.005 };

            this.nodes.bbdFilter = new Tone.Filter({ frequency: 8000, type: "lowpass", rolloff: -12 });
            this.nodes.bbdSat = new Tone.Chebyshev(2);
            this.nodes.bbdSat.wet.value = 0.2; // Reticon chips clip earlier

            this.nodes.flanger = new Tone.Chorus({
                frequency: 0.1,
                delayTime: 0.001,
                depth: 0.5,
                feedback: 0,
                spread: 180,
                wet: 1
            });

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.bbdSat, this.nodes.flanger, this.nodes.bbdFilter, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.bbdSat, this.nodes.flanger, this.nodes.bbdFilter);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.speed !== undefined) this.nodes.flanger.frequency.setTargetAtTime(params.speed, now, 0.01);
            if (params.widthParam !== undefined) this.nodes.flanger.depth.value = params.widthParam;
            if (params.regen !== undefined) this.nodes.flanger.feedback.setTargetAtTime(clamp(params.regen, 0, 0.98), now, 0.01);
            if (params.manual !== undefined) {
                // MXR manual sweep range approx 0.2ms to 12ms
                this.nodes.flanger.delayTime.value = 0.0002 + (params.manual * 0.012);
            }
        }
    }

    const classes = { ADADelay, BossBF2, EHXElectricMistress, IbanezFL9, MXRFlanger117 };
    const configs = { "Flanger": { "Analog: ADA Flanger": { "isCustom": "ADADelay", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Manual", "p": "manual", "min": 0.001, "max": 0.01, "s": 0.0001, "def": 0.005 }, { "l": "Range", "p": "range", "min": 0, "max": 1, "s": 0.01, "def": 0.8 }], [{ "l": "Speed", "p": "speed", "min": 0.1, "max": 10, "s": 0.1, "def": 0.5 }, { "l": "Enhance", "p": "enhance", "min": 0, "max": 0.95, "s": 0.01, "def": 0.5 }], [{ "l": "Threshold", "p": "threshold", "min": -60, "max": 0, "s": 1, "def": -40, "unit": "dB" }]] }, "Flanger: Boss BF-2": { "isCustom": "BossBF2", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Manual", "p": "manual", "min": 0.001, "max": 0.01, "s": 0.0001, "def": 0.005 }, { "l": "Depth", "p": "depth", "min": 0, "max": 1, "s": 0.01, "def": 0.7 }], [{ "l": "Rate", "p": "rate", "min": 0.1, "max": 10, "s": 0.1, "def": 0.5 }, { "l": "Res", "p": "res", "min": 0, "max": 0.95, "s": 0.01, "def": 0.1 }]] }, "Flanger: EHX E. Mistress": { "isCustom": "EHXElectricMistress", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Rate", "p": "rate", "min": 0.1, "max": 10, "s": 0.1, "def": 0.2 }, { "l": "Range", "p": "range", "min": 0, "max": 1, "s": 0.01, "def": 0.8 }], [{ "l": "Color", "p": "color", "min": 0, "max": 0.95, "s": 0.01, "def": 0.5 }, { "l": "Matrix", "p": "matrix", "min": 0, "max": 1, "s": 1, "def": 0, "unit": " Off/On" }]] }, "Flanger: Ibanez FL-9": { "isCustom": "IbanezFL9", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Speed", "p": "speed", "min": 0.1, "max": 10, "s": 0.1, "def": 0.5 }, { "l": "Width", "p": "width", "min": 0, "max": 1, "s": 0.01, "def": 0.7 }], [{ "l": "Regen", "p": "regen", "min": 0, "max": 0.95, "s": 0.01, "def": 0.1 }, { "l": "Delay Time", "p": "delayTime", "min": 0.001, "max": 0.01, "s": 0.0001, "def": 0.005 }]] }, "Flanger: MXR 117": { "isCustom": "MXRFlanger117", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Speed", "p": "speed", "min": 0.01, "max": 5, "s": 0.01, "def": 0.1 }, { "l": "Width", "p": "widthParam", "min": 0.001, "max": 0.02, "s": 0.0001, "def": 0.01 }], [{ "l": "Regen", "p": "regen", "min": 0, "max": 0.95, "s": 0.01, "def": 0 }, { "l": "Manual", "p": "manual", "min": 0.001, "max": 0.02, "s": 0.0001, "def": 0.005 }]] } } };
    window.effectModules.flanger = { classes, configs };
})();
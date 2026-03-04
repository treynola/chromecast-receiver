/*
 * Filename: effects_reverb.js
 * Version: NOV25_AntiGravity Version 1.0
 * Date: November 25, 2025
 * Time: 16:39 CST
 * Description: Reverb effects implementation.
 */
if (typeof window.effectModules === 'undefined') { window.effectModules = {}; }
if (typeof window.AppSource === 'undefined') { window.AppSource = {}; }

// --- REQUIRED BLOCK FOR DYNAMIC BUILD ---
if (typeof window.saveModuleSource === 'function') {
    window.saveModuleSource('effects_reverb.js');
}

// Define the source string for caching (omitted for brevity, assume full string)
window.AppSource['effects_reverb.js'] = `// [Full source code string for effects_reverb.js v43.2]`;
// Actual module code
(() => {
    const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
    const { EffectBase } = window;
    const RAMP_TIME = 0.01;

    class Lexicon224 extends EffectBase {
        constructor() {
            super("Lexicon224");
            // Lexicon 224: Revolutionary digital reverb (1978)
            // Features: Bass/Mid split decay, diffusion, pre-delay, mode enhancement

            this._params = { decay: 4, preDelay: 0.02, bass: 0, treble: 0, diffusion: 0.5 };

            // Pre-delay up to 200ms
            this.nodes.preDelay = new Tone.Delay(0.02, 0.255);

            // Diffusion network - 4 all-pass filters for density buildup
            // Creates the characteristic "cloudy" Lexicon sound
            this.nodes.diff1 = new Tone.Filter({ type: "allpass", frequency: 150, Q: 0.7 });
            this.nodes.diff2 = new Tone.Filter({ type: "allpass", frequency: 380, Q: 0.65 });
            this.nodes.diff3 = new Tone.Filter({ type: "allpass", frequency: 720, Q: 0.6 });
            this.nodes.diff4 = new Tone.Filter({ type: "allpass", frequency: 1200, Q: 0.55 });

            // Crossover for bass/mid split decay
            this.nodes.lowSplit = new Tone.Filter({ type: 'lowpass', frequency: 400, rolloff: -24 });
            this.nodes.highSplit = new Tone.Filter({ type: 'highpass', frequency: 400, rolloff: -24 });

            // Separate reverbs for bass and mid/treble (simulates split decay)
            this.nodes.bassVerb = new Tone.Freeverb({ roomSize: 0.85, dampening: 1000, wet: 1 });
            this.nodes.midVerb = new Tone.Freeverb({ roomSize: 0.8, dampening: 4000, wet: 1 });

            // Mode enhancement - subtle pitch modulation to reduce metallic ringing
            this.nodes.modulation = new Tone.Vibrato({ frequency: 0.3, depth: 0.02, wet: 0 });

            // Treble decay control (high-frequency damping)
            this.nodes.trebleDecay = new Tone.Filter({ type: 'lowshelf', frequency: 3500, gain: 0 });

            // Output EQ
            this.nodes.bassShelf = new Tone.Filter({ type: 'lowshelf', frequency: 250, gain: 0 });
            this.nodes.trebleShelf = new Tone.Filter({ type: 'highshelf', frequency: 4000, gain: 0 });

            // Signal path
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.preDelay, this.nodes.diff1, this.nodes.diff2, this.nodes.diff3, this.nodes.diff4);

            // Split for bass/mid decay
            this.nodes.diff4.fan(this.nodes.lowSplit, this.nodes.highSplit);
            this.nodes.lowSplit.connect(this.nodes.bassVerb);
            this.nodes.highSplit.connect(this.nodes.midVerb);

            // Merge paths with mode enhancement
            this.nodes.merger = new Tone.Gain();
            this.nodes.bassVerb.connect(this.nodes.merger);
            this.nodes.midVerb.connect(this.nodes.merger);

            this.nodes.merger.chain(this.nodes.modulation, this.nodes.trebleDecay, this.nodes.bassShelf, this.nodes.trebleShelf, this.nodes.stereoWidener);

            this._disposables.push(
                this.nodes.preDelay, this.nodes.diff1, this.nodes.diff2, this.nodes.diff3, this.nodes.diff4,
                this.nodes.lowSplit, this.nodes.highSplit, this.nodes.bassVerb, this.nodes.midVerb,
                this.nodes.modulation, this.nodes.trebleDecay, this.nodes.bassShelf, this.nodes.trebleShelf, this.nodes.merger
            );
        }
        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.decay !== undefined) {
                // Decay 0.6s to 70s - map 0-10 range to roomSize 0.5-0.99
                const roomSize = clamp(0.5 + (params.decay * 0.049), 0.5, 0.99);
                this.nodes.midVerb.roomSize.setTargetAtTime(roomSize, now, 0.05);
                // Bass decay can be longer
                this.nodes.bassVerb.roomSize.setTargetAtTime(Math.min(roomSize + 0.05, 0.99), now, 0.05);
            }

            if (params.preDelay !== undefined) {
                this.nodes.preDelay.delayTime.setTargetAtTime(params.preDelay, now, 0.01);
            }

            if (params.bass !== undefined) {
                this.nodes.bassShelf.gain.setTargetAtTime(params.bass, now, 0.01);
            }

            if (params.treble !== undefined) {
                this.nodes.trebleShelf.gain.setTargetAtTime(params.treble, now, 0.01);
                // Also affects treble decay
                this.nodes.trebleDecay.gain.setTargetAtTime(params.treble * -0.5, now, 0.01);
            }

            if (params.diffusion !== undefined) {
                // Diffusion affects all-pass Q values (0 = sparse, 1 = dense)
                const baseQ = 0.3 + (params.diffusion * 1.0);
                this.nodes.diff1.Q.value = baseQ;
                this.nodes.diff2.Q.value = baseQ * 0.9;
                this.nodes.diff3.Q.value = baseQ * 0.8;
                this.nodes.diff4.Q.value = baseQ * 0.7;
                // Mode enhancement increases with diffusion
                this.nodes.modulation.wet.setTargetAtTime(params.diffusion * 0.4, now, 0.01);
            }
        }
    }

    class RolandRV5Mod extends EffectBase {
        constructor() {
            // Boss RV-5 Digital Reverb - "Modulate" Mode
            // 6 algorithms: Spring, Plate, Hall, Room, Gate, Modulate
            // Modulate mode: Hall reverb with subtle chorus for lush, ambient character
            // 24-bit DSP processing
            super("RolandRV5Mod");
            this._params = { decay: 4, mod: 0.3, tone: 2000 };

            // Pre-delay for hall character
            this.nodes.preDelay = new Tone.Delay(0.025, 0.1);

            // Main reverb (hall algorithm base)
            this.nodes.reverb = new Tone.Freeverb({ roomSize: 0.8, dampening: 2000, wet: 1 });

            // Modulation chorus (the "Modulate" algorithm adds subtle chorus to reverb)
            this.nodes.chorus = new Tone.Chorus({
                frequency: 0.5,
                depth: 0.3,
                delayTime: 3.5,
                wet: 0.5
            }).start();

            // High-pass to prevent mud
            this.nodes.lowCut = new Tone.Filter({ frequency: 150, type: 'highpass' });

            // Tone control (damping)
            this.nodes.toneFilter = new Tone.Filter({ frequency: 4000, type: 'lowpass', rolloff: -12 });

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(
                this.nodes.preDelay,
                this.nodes.reverb,
                this.nodes.chorus,
                this.nodes.lowCut,
                this.nodes.toneFilter,
                this.nodes.stereoWidener
            );
            this._disposables.push(
                this.nodes.preDelay, this.nodes.reverb, this.nodes.chorus,
                this.nodes.lowCut, this.nodes.toneFilter
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.decay !== undefined) {
                // Decay maps to room size (0-8 seconds range)
                this.nodes.reverb.roomSize.setTargetAtTime(clamp(params.decay / 8, 0, 0.95), now, 0.01);
            }

            if (params.mod !== undefined) {
                // Modulation depth and rate
                this.nodes.chorus.wet.setTargetAtTime(params.mod, now, 0.01);
                this.nodes.chorus.depth.value = params.mod * 0.5;
            }

            if (params.tone !== undefined) {
                // Tone controls both damping and output filter
                this.nodes.reverb.dampening.value = params.tone;
                this.nodes.toneFilter.frequency.setTargetAtTime(params.tone * 2, now, 0.01);
            }
        }
    }

    class FenderReverb6G15 extends EffectBase {
        constructor() {
            // Fender 6G15 Spring Reverb Unit (1961)
            // Standalone tube-driven spring reverb
            // Tubes: 12AT7 preamp, 6K6 driver, 12AX7 recovery
            // Controls: Dwell, Mix, Tone
            // Classic "surf" drip sound
            super("FenderReverb6G15");
            this._params = { dwell: 0.5, tone: 0.5 };

            // Tube preamp stage (dwell controls drive)
            this.nodes.driveGain = new Tone.Gain(1);

            // High-pass pre-filter (removes low-end rumble before tank)
            this.nodes.preFilter = new Tone.Filter({ frequency: 400, type: 'highpass', rolloff: -12 });

            // Tube saturation from 12AT7/6K6 stages
            this.nodes.tubeSat = new Tone.Chebyshev(2);
            this.nodes.tubeSat.wet.value = 0.2;

            // The "drip" resonance (characteristic spring tank sound)
            this.nodes.drip = new Tone.Filter({ frequency: 2200, type: 'peaking', Q: 4, gain: 6 });

            // Spring tank simulation using comb filters for metallic character
            this.nodes.comb1 = new Tone.FeedbackCombFilter({ delayTime: 0.031, resonance: 0.6 });
            this.nodes.comb2 = new Tone.FeedbackCombFilter({ delayTime: 0.037, resonance: 0.5 });
            this.nodes.comb3 = new Tone.FeedbackCombFilter({ delayTime: 0.041, resonance: 0.4 });

            // Recovery stage EQ
            this.nodes.recoveryEQ = new Tone.Filter({ frequency: 3500, type: 'lowpass', rolloff: -12 });

            // Merge the comb filters
            this.nodes.merger = new Tone.Merge();

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.driveGain, this.nodes.preFilter, this.nodes.tubeSat, this.nodes.drip);

            // Split to comb filters then merge
            this.nodes.drip.fan(this.nodes.comb1, this.nodes.comb2, this.nodes.comb3);
            this.nodes.comb1.connect(this.nodes.merger, 0, 0);
            this.nodes.comb2.connect(this.nodes.merger, 0, 1);
            this.nodes.comb3.connect(this.nodes.merger, 0, 0);
            this.nodes.merger.chain(this.nodes.recoveryEQ, this.nodes.stereoWidener);

            this._disposables.push(
                this.nodes.driveGain, this.nodes.preFilter, this.nodes.tubeSat, this.nodes.drip,
                this.nodes.comb1, this.nodes.comb2, this.nodes.comb3,
                this.nodes.merger, this.nodes.recoveryEQ
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.dwell !== undefined) {
                // Dwell controls input drive (more dwell = more reverb + saturation)
                this.nodes.driveGain.gain.setTargetAtTime(0.5 + (params.dwell * 1.5), now, 0.01);
                this.nodes.tubeSat.wet.setTargetAtTime(params.dwell * 0.4, now, 0.01);
                // Higher dwell increases resonance
                this.nodes.comb1.resonance.setTargetAtTime(0.4 + (params.dwell * 0.4), now, 0.01);
                this.nodes.comb2.resonance.setTargetAtTime(0.3 + (params.dwell * 0.4), now, 0.01);
            }

            if (params.tone !== undefined) {
                // Tone controls brightness of reverb
                const freq = 2000 + (params.tone * 4000);
                this.nodes.recoveryEQ.frequency.setTargetAtTime(freq, now, 0.01);
                this.nodes.drip.frequency.setTargetAtTime(1800 + (params.tone * 800), now, 0.01);
            }
        }
    }

    class FenderTwinReverb extends EffectBase {
        constructor() {
            // Fender Twin Reverb Amp (1963+)
            // Built-in 2-spring Accutronics tank
            // Tube-driven: 12AT7 driver, 12AX7 recovery
            // Shorter, tighter reverb than standalone 6G15
            super("FenderTwinReverb");
            this._params = { reverb: 5 };

            // High-pass pre-filter (amp circuit characteristic)
            this.nodes.preFilter = new Tone.Filter({ frequency: 300, type: 'highpass', rolloff: -12 });

            // Tube warmth
            this.nodes.tubeSat = new Tone.Chebyshev(2);
            this.nodes.tubeSat.wet.value = 0.15;

            // Spring tank (shorter decay than 6G15)
            this.nodes.reverb = new Tone.Freeverb({ roomSize: 0.55, dampening: 3500, wet: 1 });

            // Spring resonance character
            this.nodes.springRes = new Tone.Filter({ frequency: 2000, type: 'peaking', Q: 2, gain: 3 });

            // Post-filter (tames harsh highs)
            this.nodes.postFilter = new Tone.Filter({ frequency: 5000, type: 'lowpass', rolloff: -12 });

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(
                this.nodes.preFilter,
                this.nodes.tubeSat,
                this.nodes.reverb,
                this.nodes.springRes,
                this.nodes.postFilter,
                this.nodes.stereoWidener
            );
            this._disposables.push(
                this.nodes.preFilter, this.nodes.tubeSat, this.nodes.reverb,
                this.nodes.springRes, this.nodes.postFilter
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.reverb !== undefined) {
                // Single reverb control (0-10 range typical)
                this.nodes.reverb.roomSize.setTargetAtTime(clamp(params.reverb / 12, 0, 0.85), now, 0.01);
                // More reverb = slightly more tube saturation
                this.nodes.tubeSat.wet.setTargetAtTime(0.1 + (params.reverb * 0.02), now, 0.01);
            }
        }
    }

    class DigitalReverbHolyGrail extends EffectBase {
        constructor() {
            super("DigitalReverbHolyGrail");
            this._params = { decay: 3.5, preDelay: 0.01, bits: 10, flerb: 0 };
            this.nodes.preDelayNode = new Tone.Delay(this._params.preDelay, 0.1);
            this.nodes.reverb = new Tone.Freeverb({ roomSize: clamp(this._params.decay / 7, 0, 1), dampening: 2000, wet: 1 });
            this.nodes.bitcrusher = new Tone.BitCrusher({ bits: this._params.bits });
            this.nodes.flanger = new Tone.Chorus({
                delayTime: 0.005,
                depth: 0.5,
                feedback: 0.1,
                frequency: 0.5,
                spread: 180,
                wet: this._params.flerb
            }).start();
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.preDelayNode, this.nodes.flanger, this.nodes.reverb, this.nodes.bitcrusher, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.preDelayNode, this.nodes.reverb, this.nodes.bitcrusher, this.nodes.flanger);
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.flerb !== undefined) {
                this._params.flerb = params.flerb;
                this.nodes.flanger.wet.setTargetAtTime(this._params.flerb, now, 0.01);
            }
            if (params.decay !== undefined) {
                this._params.decay = params.decay;
                const roomSize = clamp(this._params.decay / 7, 0, 1);
                this.nodes.reverb.roomSize.setTargetAtTime(roomSize, now, 0.01);
            }
            if (params.preDelay !== undefined) {
                this._params.preDelay = params.preDelay;
                this.nodes.preDelayNode.delayTime.setTargetAtTime(this._params.preDelay, now, 0.01);
            }
            if (params.bits !== undefined) {
                this._params.bits = params.bits;
                this.nodes.bitcrusher.bits.value = this._params.bits;
            }
        }
    }
    class EMT250Reverb extends EffectBase {
        constructor() {
            super("EMT250Reverb");
            this.nodes.drive = new Tone.Distortion(0.05);
            this.nodes.preDelay = new Tone.Delay(0.02, 0.1);
            this.nodes.chorus = new Tone.Chorus({ frequency: 0.5, depth: 0.2, delayTime: 0.0025, wet: 0.3 }).start();
            this.nodes.reverb = new Tone.Freeverb({ roomSize: 0.9, dampening: 6000, wet: 1 });
            this.nodes.lowCut = new Tone.Filter({ frequency: 200, type: 'highpass' });
            this.nodes.highCut = new Tone.Filter({ frequency: 10000, type: 'lowpass' });
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.drive, this.nodes.preDelay, this.nodes.chorus, this.nodes.lowCut, this.nodes.highCut, this.nodes.reverb, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.drive, this.nodes.preDelay, this.nodes.chorus, this.nodes.reverb, this.nodes.lowCut, this.nodes.highCut);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.decay !== undefined) this.nodes.reverb.roomSize.setTargetAtTime(clamp(params.decay / 8, 0, 1), now, 0.01);
            if (params.preDelay !== undefined) this.nodes.preDelay.delayTime.setTargetAtTime(params.preDelay, now, 0.01);
            if (params.lowCut !== undefined) this.nodes.lowCut.frequency.setTargetAtTime(params.lowCut, now, 0.01);
            if (params.highCut !== undefined) this.nodes.highCut.frequency.setTargetAtTime(params.highCut, now, 0.01);
        }
    }
    class EarlyMechanicalReverb extends EffectBase {
        constructor() {
            super("EarlyMechanicalReverb");
            this.nodes.drive = new Tone.Distortion(0.6);
            this.nodes.reverb = new Tone.Freeverb({ roomSize: 0.8, dampening: 5000, wet: 1 });
            this.nodes.highCut = new Tone.Filter({ frequency: 5000, type: 'lowpass' });
            this.nodes.lowCut = new Tone.Filter({ frequency: 200, type: 'highpass' });
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.drive, this.nodes.lowCut, this.nodes.highCut, this.nodes.reverb, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.drive, this.nodes.reverb, this.nodes.highCut, this.nodes.lowCut);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.intensity !== undefined) this.nodes.drive.distortion = params.intensity;
            if (params.tone !== undefined) this.nodes.highCut.frequency.setTargetAtTime(params.tone, now, 0.01);
            if (params.decay !== undefined) this.nodes.reverb.roomSize.setTargetAtTime(clamp(params.decay, 0.1, 0.98), now, 0.01);
        }
    }
    class PlateReverb extends EffectBase {
        constructor() {
            super("PlateReverb");
            // EMT 140 Plate Reverb: Steel plate 1m x 2m x 0.5mm
            // Decay: 0.8s to 5s at 500Hz (controlled by damping plate distance)
            // Characteristic bright, dense reverb with natural EQ

            // Pre-delay (0-100ms typical)
            this.nodes.preDelay = new Tone.Delay(0.01, 0.1);

            // Input high-pass filter (removes rumble, standard on EMT 140)
            this.nodes.inputHP = new Tone.Filter({ type: 'highpass', frequency: 100, rolloff: -12 });

            // Exciter transducer + tube amplifier simulation
            // The EMT V54 tube amp adds warmth
            this.nodes.tubeExciter = new Tone.Chebyshev(2);
            this.nodes.tubeExciter.wet.value = 0.2;

            // Plate resonances - characteristic frequencies of steel plate
            // Multiple comb filters simulate plate modes
            this.nodes.plate1 = new Tone.FeedbackCombFilter({ delayTime: 0.029, resonance: 0.88, wet: 1 });
            this.nodes.plate2 = new Tone.FeedbackCombFilter({ delayTime: 0.037, resonance: 0.86, wet: 1 });
            this.nodes.plate3 = new Tone.FeedbackCombFilter({ delayTime: 0.041, resonance: 0.84, wet: 1 });

            // Core reverb processor
            this.nodes.reverb = new Tone.Freeverb({ roomSize: 0.85, dampening: 3000, wet: 1 });

            // Damping simulation - longer decay at low frequencies (like real plate)
            this.nodes.dampingLF = new Tone.Filter({ type: 'lowshelf', frequency: 500, gain: 3 });
            this.nodes.dampingHF = new Tone.Filter({ type: 'highshelf', frequency: 4000, gain: -2 });

            // 3-band EQ (Low, Mid, High)
            this.nodes.low = new Tone.Filter({ type: 'lowshelf', frequency: 200, gain: 0 });
            this.nodes.mid = new Tone.Filter({ type: 'peaking', frequency: 1200, Q: 0.7, gain: 0 });
            this.nodes.high = new Tone.Filter({ type: 'highshelf', frequency: 5000, gain: 0 });

            // Stereo output (two offset pickups on plate)
            this.nodes.merger = new Tone.Merge();

            // Signal path
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.preDelay, this.nodes.inputHP, this.nodes.tubeExciter);

            // Fan into plate modes
            this.nodes.tubeExciter.fan(this.nodes.plate1, this.nodes.plate2, this.nodes.plate3);

            // Collect plate modes into reverb
            this.nodes.plateMix = new Tone.Gain(0.33);
            this.nodes.plate1.connect(this.nodes.plateMix);
            this.nodes.plate2.connect(this.nodes.plateMix);
            this.nodes.plate3.connect(this.nodes.plateMix);

            this.nodes.plateMix.chain(this.nodes.reverb, this.nodes.dampingLF, this.nodes.dampingHF, this.nodes.low, this.nodes.mid, this.nodes.high, this.nodes.stereoWidener);

            this._disposables.push(
                this.nodes.preDelay, this.nodes.inputHP, this.nodes.tubeExciter,
                this.nodes.plate1, this.nodes.plate2, this.nodes.plate3, this.nodes.plateMix,
                this.nodes.reverb, this.nodes.dampingLF, this.nodes.dampingHF,
                this.nodes.low, this.nodes.mid, this.nodes.high
            );
        }
        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.decay !== undefined) {
                // Map decay (0-1 or 1-5 from config) to plate characteristics
                const roomSize = clamp(params.decay, 0.3, 0.98);
                this.nodes.reverb.roomSize.setTargetAtTime(roomSize, now, 0.05);
                // Adjust plate comb resonances with decay
                const res = 0.75 + (roomSize * 0.15);
                this.nodes.plate1.resonance.setTargetAtTime(res, now, 0.02);
                this.nodes.plate2.resonance.setTargetAtTime(res * 0.98, now, 0.02);
                this.nodes.plate3.resonance.setTargetAtTime(res * 0.96, now, 0.02);
            }

            if (params.preDelay !== undefined) {
                this.nodes.preDelay.delayTime.setTargetAtTime(params.preDelay, now, 0.01);
            }

            if (params.low !== undefined) this.nodes.low.gain.setTargetAtTime(params.low, now, 0.01);
            if (params.mid !== undefined) this.nodes.mid.gain.setTargetAtTime(params.mid, now, 0.01);
            if (params.high !== undefined) this.nodes.high.gain.setTargetAtTime(params.high, now, 0.01);
        }
    }
    class LamingtonReverb extends EffectBase {
        constructor() {
            super("LamingtonReverb");
            this.nodes.drive = new Tone.Distortion(0.3);
            this.nodes.tone = new Tone.Filter({ type: 'lowshelf', frequency: 500, gain: -8 });
            this.nodes.comb1 = new Tone.FeedbackCombFilter({ delayTime: 0.026, resonance: 0.85, wet: 1 });
            this.nodes.comb2 = new Tone.FeedbackCombFilter({ delayTime: 0.039, resonance: 0.8, wet: 1 });
            this.nodes.merger = new Tone.Merge();
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.drive, this.nodes.tone);
            this.nodes.tone.fan(this.nodes.comb1, this.nodes.comb2);
            this.nodes.comb1.connect(this.nodes.merger, 0, 0);
            this.nodes.comb2.connect(this.nodes.merger, 0, 1);
            this.nodes.merger.connect(this.nodes.stereoWidener);
            this._disposables.push(this.nodes.drive, this.nodes.tone, this.nodes.comb1, this.nodes.comb2, this.nodes.merger);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.dwell !== undefined) this.nodes.drive.distortion = params.dwell;
            if (params.decay !== undefined) {
                const res = clamp(params.decay, 0, 1) * 0.2 + 0.75;
                this.nodes.comb1.resonance.setTargetAtTime(res, now, 0.02);
                this.nodes.comb2.resonance.setTargetAtTime(res * 0.9, now, 0.02);
            }
            if (params.tone !== undefined) this.nodes.tone.gain.setTargetAtTime(params.tone, now, 0.01);
        }
    }
    class Grampian636Reverb extends EffectBase {
        constructor() {
            super("Grampian636Reverb");
            // Grampian Type 636 (1960s) - Famous for its Germanium transistor preamp
            // Pete Townshend used it just for the distortion!
            
            // Germanium Asymmetric Clipping Preamp
            const curve = new Float32Array(4096);
            for (let i = 0; i < 4096; i++) {
                let x = (i / 2048) - 1;
                // Asymmetric germanium clip: clips harder on the negative swing
                if (x < 0) {
                    curve[i] = Math.tanh(x * 3) * 0.8;
                } else {
                    curve[i] = Math.tanh(x * 1.5);
                }
            }
            this.nodes.preampGain = new Tone.Gain(1);
            this.nodes.geClipper = new Tone.WaveShaper(curve);
            
            // Spring tank characteristics
            this.nodes.comb1 = new Tone.FeedbackCombFilter({ delayTime: 0.02, resonance: 0.8, wet: 1 });
            this.nodes.comb2 = new Tone.FeedbackCombFilter({ delayTime: 0.031, resonance: 0.75, wet: 1 });
            
            // Grampian is very dark and murky
            this.nodes.lowpass = new Tone.Filter({ frequency: 3000, type: 'lowpass', rolloff: -12 });
            this.nodes.merger = new Tone.Merge();

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.preampGain, this.nodes.geClipper, this.nodes.lowpass);
            
            this.nodes.lowpass.fan(this.nodes.comb1, this.nodes.comb2);
            this.nodes.comb1.connect(this.nodes.merger, 0, 0);
            this.nodes.comb2.connect(this.nodes.merger, 0, 1);
            
            this.nodes.merger.connect(this.nodes.stereoWidener);
            
            this._disposables.push(this.nodes.preampGain, this.nodes.geClipper, this.nodes.comb1, this.nodes.comb2, this.nodes.lowpass, this.nodes.merger);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.drive !== undefined) {
                // Drive pushes signal into Germanium clipper
                this.nodes.preampGain.gain.setTargetAtTime(1 + (params.drive * 15), now, 0.01);
            }
        }
    }
    class HammondSpringReverb extends EffectBase {
        constructor() {
            super("HammondSpringReverb");
            // Hammond Spring Tank (the original Type 4)
            // Lush, thick, multi-spring design with a specific "boing" transient
            
            // Hammond tube drive characteristic
            this.nodes.tubeDrive = new Tone.Chebyshev(3);
            this.nodes.tubeDrive.wet.value = 0.2;
            
            this.nodes.preampGain = new Tone.Gain(1);

            this.nodes.tone = new Tone.Filter({ frequency: 6000, type: 'lowpass', rolloff: -12 });
            
            // Hammond Type 4 tanks use 4 springs with slightly detuned lengths to smooth out flutter
            this.nodes.comb1 = new Tone.FeedbackCombFilter({ delayTime: 0.033, resonance: 0.82, wet: 1 });
            this.nodes.comb2 = new Tone.FeedbackCombFilter({ delayTime: 0.041, resonance: 0.80, wet: 1 });
            this.nodes.comb3 = new Tone.FeedbackCombFilter({ delayTime: 0.046, resonance: 0.78, wet: 1 });
            
            // Post EQ to simulate the tank's recovery amp
            this.nodes.recoveryEQ = new Tone.Filter({ frequency: 4000, type: 'lowshelf', gain: -3 });
            
            this.nodes.merger = new Tone.Merge();
            
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.preampGain, this.nodes.tubeDrive, this.nodes.tone);
            
            this.nodes.tone.fan(this.nodes.comb1, this.nodes.comb2, this.nodes.comb3);
            this.nodes.comb1.connect(this.nodes.merger, 0, 0);
            this.nodes.comb2.connect(this.nodes.merger, 0, 1);
            this.nodes.comb3.connect(this.nodes.merger, 0, 0); // Mix to L to simulate density
            
            this.nodes.merger.chain(this.nodes.recoveryEQ, this.nodes.stereoWidener);
            
            this._disposables.push(this.nodes.preampGain, this.nodes.tubeDrive, this.nodes.tone, this.nodes.comb1, this.nodes.comb2, this.nodes.comb3, this.nodes.recoveryEQ, this.nodes.merger);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.intensity !== undefined) {
                // Intensity drives the tube and resonance
                this.nodes.preampGain.gain.setTargetAtTime(1 + params.intensity * 3, now, 0.01);
                this.nodes.tubeDrive.wet.setTargetAtTime(0.1 + params.intensity * 0.3, now, 0.01);
                
                const resBase = 0.7 + (params.intensity * 0.2);
                this.nodes.comb1.resonance.setTargetAtTime(resBase, now, 0.01);
                this.nodes.comb2.resonance.setTargetAtTime(resBase * 0.95, now, 0.01);
                this.nodes.comb3.resonance.setTargetAtTime(resBase * 0.9, now, 0.01);
            }
            if (params.tone !== undefined) {
                this.nodes.tone.frequency.setTargetAtTime(params.tone, now, 0.01);
            }
        }
    }
    class Premier90Reverb extends EffectBase {
        constructor() {
            super("Premier90Reverb");
            this.nodes.preDelay = new Tone.Delay(0.01, 0.1);
            this.nodes.combFilter1 = new Tone.FeedbackCombFilter({ delayTime: 0.015, resonance: 0.7, wet: 1 });
            this.nodes.combFilter2 = new Tone.FeedbackCombFilter({ delayTime: 0.022, resonance: 0.65, wet: 1 });
            this.nodes.lowpass = new Tone.Filter({ frequency: 3000, type: 'lowpass' });
            this.nodes.highpass = new Tone.Filter({ frequency: 400, type: 'highpass' });
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.preDelay, this.nodes.highpass, this.nodes.lowpass, this.nodes.combFilter1, this.nodes.combFilter2, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.preDelay, this.nodes.combFilter1, this.nodes.combFilter2, this.nodes.lowpass, this.nodes.highpass);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.preDelay !== undefined) this.nodes.preDelay.delayTime.setTargetAtTime(params.preDelay, now, 0.01);
            if (params.decay !== undefined) {
                const res = clamp(params.decay, 0, 0.95);
                this.nodes.combFilter1.resonance.setTargetAtTime(res, now, 0.01);
                this.nodes.combFilter2.resonance.setTargetAtTime(res * 0.9, now, 0.01);
            }
            if (params.tone !== undefined) this.nodes.lowpass.frequency.setTargetAtTime(params.tone, now, 0.01);
        }
    }
    class MatchlessRV1Reverb extends EffectBase {
        constructor() {
            super("MatchlessRV1Reverb");
            this.nodes.drive = new Tone.Distortion(0.6);
            this.nodes.tone = new Tone.Filter({ frequency: 6000, type: 'lowpass' });
            this.nodes.comb1 = new Tone.FeedbackCombFilter({ delayTime: 0.033, resonance: 0.85, wet: 1 });
            this.nodes.comb2 = new Tone.FeedbackCombFilter({ delayTime: 0.041, resonance: 0.8, wet: 1 });
            this.nodes.merger = new Tone.Merge();
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.drive, this.nodes.tone);
            this.nodes.tone.fan(this.nodes.comb1, this.nodes.comb2);
            this.nodes.comb1.connect(this.nodes.merger, 0, 0);
            this.nodes.comb2.connect(this.nodes.merger, 0, 1);
            this.nodes.merger.connect(this.nodes.stereoWidener);
            this._disposables.push(this.nodes.drive, this.nodes.tone, this.nodes.comb1, this.nodes.comb2, this.nodes.merger);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.tone !== undefined) this.nodes.tone.frequency.setTargetAtTime(params.tone, now, 0.01);
        }
    }

    const classes = { DigitalReverbHolyGrail, EMT250Reverb, EarlyMechanicalReverb, PlateReverb, LamingtonReverb, FenderReverb6G15, Grampian636Reverb, HammondSpringReverb, Premier90Reverb, MatchlessRV1Reverb, Lexicon224, RolandRV5Mod, FenderTwinReverb };
    const configs = {
        "Reverb": {
            "Digital: EHX Holy Grail": { "isCustom": "DigitalReverbHolyGrail", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Decay", "p": "decay", "min": 0.5, "max": 7, "s": 0.1, "def": 3.5 }, { "l": "PreDelay", "p": "preDelay", "min": 0, "max": 0.1, "s": 0.001, "def": 0.01 }], [{ "l": "Bits", "p": "bits", "min": 4, "max": 16, "s": 1, "def": 10 }, { "l": "Flerb", "p": "flerb", "min": 0, "max": 1, "s": 0.01, "def": 0 }]] },
            "Digital: EMT 250": {
                "isCustom": "EMT250Reverb",
                "columns": [
                    [{ "l": "Decay", "p": "decay", "min": 0.5, "max": 8, "s": 0.1, "def": 3.5 }, { "l": "PreDelay", "p": "preDelay", "min": 0, "max": 0.1, "s": 0.001, "def": 0.02 }],
                    [{ "l": "Low Cut", "p": "lowCut", "min": 20, "max": 500, "def": 200 }, { "l": "High Cut", "p": "highCut", "min": 1000, "max": 12000, "def": 8000 }]
                ]
            },
            "Digital: Lexicon 224": {
                "isCustom": "Lexicon224",
                "columns": [
                    [{ "l": "Decay", "p": "decay", "min": 0.1, "max": 10, "s": 0.1, "def": 4 }, { "l": "PreDelay", "p": "preDelay", "min": 0, "max": 0.2, "s": 0.001, "def": 0.02 }],
                    [{ "l": "Bass", "p": "bass", "min": -12, "max": 12, "s": 0.1, "def": 0 }, { "l": "Treble", "p": "treble", "min": -12, "max": 12, "s": 0.1, "def": 0 }],
                    [{ "l": "Diffusion", "p": "diffusion", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]
                ]
            },
            "Digital: Roland RV-5 Mod": {
                "isCustom": "RolandRV5Mod",
                "columns": [
                    [{ "l": "Decay", "p": "decay", "min": 0.1, "max": 8, "s": 0.1, "def": 4 }, { "l": "Mod", "p": "mod", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }],
                    [{ "l": "Tone", "p": "tone", "min": 500, "max": 8000, "s": 100, "def": 2000 }]
                ]
            },
            "Mechanical: Fairchild": { "isCustom": "EarlyMechanicalReverb", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Intensity", "p": "intensity", "min": 0.1, "max": 0.7, "s": 0.01, "def": 0.4 }, { "l": "Tone", "p": "tone", "min": 3000, "max": 10000, "s": 100, "def": 10000 }], [{ "l": "Decay", "p": "decay", "min": 1, "max": 3, "s": 0.1, "def": 1.5 }]] },
            "Plate: EMT 140": { "isCustom": "PlateReverb", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "decay", "min": 1, "max": 5, "s": 0.1, "def": 4.5, "unit": "s" }, { "l": "PreDelay", "p": "preDelay", "min": 0, "max": 0.1, "s": 0.001, "def": 0.01, "unit": "s" }], [{ "l": "Low", "p": "low", "min": -12, "max": 12, "s": 0.1, "def": 2 }, { "l": "Mid", "p": "mid", "min": -12, "max": 12, "s": 0.1, "def": -3 }], [{ "l": "High Gain", "p": "high", "min": -24, "max": 12, "s": 0.1, "def": 0 }]] },
            "Spring: Fender 6G15": {
                "isCustom": "FenderReverb6G15",
                "columns": [
                    [{ "l": "Dwell", "p": "dwell", "min": 0, "max": 1, "s": 0.01, "def": 0.4 }, { "l": "Tone", "p": "tone", "min": 1000, "max": 8000, "s": 100, "def": 5000 }],
                    [{ "l": "Mix", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]
                ]
            },
            "Spring: Fender Twin": {
                "isCustom": "FenderTwinReverb",
                "columns": [
                    [{ "l": "Reverb", "p": "reverb", "min": 0, "max": 10, "s": 0.1, "def": 6 }]
                ]
            },
            "Spring: Grampian 636": {
                "isCustom": "Grampian636Reverb",
                "columns": [
                    [{ "l": "Drive", "p": "drive", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]
                ]
            },
            "Spring: Hammond": { "isCustom": "HammondSpringReverb", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Intensity", "p": "intensity", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }, { "l": "Tone", "p": "tone", "min": 1000, "max": 8000, "s": 100, "def": 7000 }]] },
            "Spring: Matchless RV-1": {
                "isCustom": "MatchlessRV1Reverb",
                "columns": [
                    [{ "l": "Tone", "p": "tone", "min": 1000, "max": 8000, "s": 100, "def": 6000 }]
                ]
            },
            "Spring: Premier 90": { "isCustom": "Premier90Reverb", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "PreDelay", "p": "preDelay", "min": 0, "max": 0.1, "s": 0.001, "def": 0.01 }, { "l": "Decay", "p": "decay", "min": 0.1, "max": 0.95, "s": 0.01, "def": 0.7 }], [{ "l": "Tone", "p": "tone", "min": 1000, "max": 5000, "s": 100, "def": 3000 }]] },
            "Reverb: Lamington Spring": { "isCustom": "LamingtonReverb", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Dwell", "p": "dwell", "min": 0, "max": 0.5, "s": 0.01, "def": 0.1 }, { "l": "Decay", "p": "decay", "min": 1, "max": 5, "s": 0.1, "def": 2.5 }], [{ "l": "Tone", "p": "tone", "min": -24, "max": 0, "s": 0.1, "def": -8 }]] }
        }
    };
    window.effectModules.reverb = { classes, configs };
})();
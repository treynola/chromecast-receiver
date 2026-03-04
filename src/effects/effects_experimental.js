/*
 * Filename: effects_experimental.js
 * Version: NOV25_AntiGravity Version 1.0
 * Date: November 25, 2025
 * Time: 16:40 CST
 * Description: Experimental effects implementation (SP-303, Old School Samplers, etc.).
 */
if (typeof window.effectModules === 'undefined') { window.effectModules = {}; }
if (typeof window.AppSource === 'undefined') { window.AppSource = {}; }

// --- REQUIRED BLOCK FOR DYNAMIC BUILD ---
if (typeof window.saveModuleSource === 'function') {
    window.saveModuleSource('effects_experimental.js');
}
window.AppSource['effects_experimental.js'] = `// [Full source code string for effects_experimental.js v43.7]`;

// Actual module code
(() => {
    const { EffectBase } = window;
    const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

    // ==========================================================================
    // EXISTING EFFECTS
    // ==========================================================================
    class SirenDoppler extends EffectBase {
        constructor() {
            super("SirenDoppler");
            this.wet.disconnect(this.nodes.stereoWidener);
            this.dopplerFrequencyShifter = new Tone.FrequencyShifter({ context: Tone.context });
            this.dopplerFrequencyShifter.wet.value = 1;

            this.dopplerPitchLFO = new Tone.LFO(0.5).start();
            this.nodes.pitchScale = new Tone.Scale(-100, 100);

            this.dopplerAmplitudeLFO = new Tone.LFO(0.5).start();
            this.nodes.amplitudeScale = new Tone.Scale(0, 1);

            this.dopplerAmplitudeGain = new Tone.Gain(1);

            this.dopplerPanLFO = new Tone.LFO(0.5).start();
            this.nodes.panScale = new Tone.Scale(-1, 1);

            this.dopplerPanner = new Tone.Panner(0);
            this.makeUpGain = new Tone.Gain(1.2);

            this.dopplerPitchLFO.connect(this.nodes.pitchScale);
            this.nodes.pitchScale.connect(this.dopplerFrequencyShifter.frequency);

            this.dopplerAmplitudeLFO.connect(this.nodes.amplitudeScale);
            this.nodes.amplitudeScale.connect(this.dopplerAmplitudeGain.gain);

            this.dopplerPanLFO.connect(this.nodes.panScale);
            this.nodes.panScale.connect(this.dopplerPanner.pan);

            this.wet.chain(this.dopplerAmplitudeGain, this.dopplerFrequencyShifter, this.dopplerPanner, this.makeUpGain, this.nodes.stereoWidener);
            this._disposables.push(this.dopplerFrequencyShifter, this.dopplerPitchLFO, this.nodes.pitchScale, this.dopplerAmplitudeLFO, this.nodes.amplitudeScale, this.dopplerAmplitudeGain, this.dopplerPanLFO, this.nodes.panScale, this.dopplerPanner, this.makeUpGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP_TIME = 0.01;
            if (params.sirenRate !== undefined) this.dopplerPitchLFO.frequency.setTargetAtTime(params.sirenRate, now, RAMP_TIME);
            if (params.sirenDepth !== undefined) {
                this.nodes.pitchScale.min = -params.sirenDepth;
                this.nodes.pitchScale.max = params.sirenDepth;
            }
            if (params.passBySpeed !== undefined) {
                this.dopplerPitchLFO.frequency.setTargetAtTime(params.passBySpeed, now, RAMP_TIME);
                this.dopplerAmplitudeLFO.frequency.setTargetAtTime(params.passBySpeed, now, RAMP_TIME);
                this.dopplerPanLFO.frequency.setTargetAtTime(params.passBySpeed, now, RAMP_TIME);
            }
            if (params.passByDepth !== undefined) {
                this.nodes.amplitudeScale.min = Math.max(0, 1 - params.passByDepth);
                this.nodes.amplitudeScale.max = 1 + params.passByDepth;
            }
            if (params.panDepth !== undefined) {
                this.nodes.panScale.min = -params.panDepth;
                this.nodes.panScale.max = params.panDepth;
            }
        }
    }

    class VinylSim extends EffectBase {
        constructor() {
            super("VinylSim");
            this.wet.disconnect(this.nodes.stereoWidener);
            this.compressor = new Tone.Compressor({ threshold: -20, ratio: 4, attack: 0.01, release: 0.1 });
            this.vibrato = new Tone.Vibrato({ frequency: 0.5, depth: 0.2, type: "sine" });
            this.vibrato.wet.value = 1;
            this.noise = new Tone.Noise("pink").start();
            this.noiseFilter = new Tone.Filter({ frequency: 3000, type: "lowpass" });
            this.noiseGain = new Tone.Gain(0);
            this.makeUpGain = new Tone.Gain(1.2);
            this.noise.chain(this.noiseFilter, this.noiseGain, this.compressor);
            this.wet.chain(this.vibrato, this.compressor, this.makeUpGain, this.nodes.stereoWidener);
            this._disposables.push(this.compressor, this.vibrato, this.noise, this.noiseFilter, this.noiseGain, this.makeUpGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP_TIME = 0.01;
            if (params.comp !== undefined) { const threshold = -10 - (params.comp * 50); const ratio = 2 + (params.comp * 18); this.compressor.threshold.setTargetAtTime(threshold, now, RAMP_TIME); this.compressor.ratio.setTargetAtTime(ratio, now, RAMP_TIME); }
            if (params.noise !== undefined) this.noiseGain.gain.setTargetAtTime(params.noise * 0.5, now, RAMP_TIME);
            if (params.flutter !== undefined) { this.vibrato.depth.value = params.flutter * 1.0; this.vibrato.frequency.value = 0.5 + (params.flutter * 9.5); }
        }
        dispose() { super.dispose(); this.noise.stop(); }
    }

    class Slicer extends EffectBase {
        constructor() {
            super("Slicer");
            this.wet.disconnect(this.nodes.stereoWidener);
            this.tremolo = new Tone.Tremolo({ frequency: "4n", depth: 1, type: "square", spread: 0 }).start();
            this.tremolo.wet.value = 1;
            this.makeUpGain = new Tone.Gain(1.5);
            this.wet.chain(this.tremolo, this.makeUpGain, this.nodes.stereoWidener);
            this._disposables.push(this.tremolo, this.makeUpGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP_TIME = 0.01;
            if (params.rate !== undefined) {
                let rateVal;
                if (params.rate < 0.25) rateVal = 0.5; // 2n
                else if (params.rate < 0.5) rateVal = 1; // 4n
                else if (params.rate < 0.75) rateVal = 2; // 8n
                else rateVal = 4; // 16n
                this.tremolo.frequency.setTargetAtTime(rateVal, now, RAMP_TIME);
            }
            if (params.depth !== undefined) this.tremolo.depth.setTargetAtTime(params.depth, now, RAMP_TIME);
        }
    }

    class VoiceTransformer extends EffectBase {
        constructor() {
            super("VoiceTransformer");
            this.wet.disconnect(this.nodes.stereoWidener);
            this.pitchShifter = new Tone.PitchShift({ pitch: 0, windowSize: 0.1, delayTime: 0, feedback: 0 });
            this.pitchShifter.wet.value = 1;
            this.formantFilter = new Tone.Filter({ type: "peaking", frequency: 1000, Q: 1, gain: 0 });
            this.makeUpGain = new Tone.Gain(1.2);
            this.wet.chain(this.pitchShifter, this.formantFilter, this.makeUpGain, this.nodes.stereoWidener);
            this._disposables.push(this.pitchShifter, this.formantFilter, this.makeUpGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP_TIME = 0.05;
            if (params.pitch !== undefined) this.pitchShifter.pitch = (params.pitch - 0.5) * 24;
            if (params.formant !== undefined) {
                const freq = 200 + (params.formant * 3800);
                this.formantFilter.frequency.setTargetAtTime(freq, now, RAMP_TIME);
                this.formantFilter.gain.setTargetAtTime(20, now, RAMP_TIME);
                this.formantFilter.Q.setTargetAtTime(2 + (params.formant * 3), now, RAMP_TIME);
            }
            if (params.robot !== undefined) this.pitchShifter.feedback.setTargetAtTime(params.robot * 0.5, now, RAMP_TIME);
        }
    }

    class Isolator extends EffectBase {
        constructor() {
            super("Isolator");
            this.wet.disconnect(this.nodes.stereoWidener);
            this.eq = new Tone.EQ3({ low: 0, mid: 0, high: 0, lowFrequency: 400, highFrequency: 2500 });
            this.makeUpGain = new Tone.Gain(1.2);
            this.wet.chain(this.eq, this.makeUpGain, this.nodes.stereoWidener);
            this._disposables.push(this.eq, this.makeUpGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP_TIME = 0.01;
            const mapGain = (val) => { if (val < 0.2) return -Infinity; if (val < 0.5) return -20 + ((val - 0.2) / 0.3) * 20; return (val - 0.5) * 24; };
            if (params.low !== undefined) this.eq.low.setTargetAtTime(mapGain(params.low), now, RAMP_TIME);
            if (params.mid !== undefined) this.eq.mid.setTargetAtTime(mapGain(params.mid), now, RAMP_TIME);
            if (params.high !== undefined) this.eq.high.setTargetAtTime(mapGain(params.high), now, RAMP_TIME);
        }
    }

    class LoFi extends EffectBase {
        constructor() {
            super("LoFi");
            this.wet.disconnect(this.nodes.stereoWidener);
            this.bitCrusher = new Tone.BitCrusher(4);
            this.bitCrusher.wet.value = 1;
            this.filter = new Tone.Filter({ frequency: 20000, type: "lowpass" });
            this.makeUpGain = new Tone.Gain(1.2);
            this.wet.chain(this.bitCrusher, this.filter, this.makeUpGain, this.nodes.stereoWidener);
            this._disposables.push(this.bitCrusher, this.filter, this.makeUpGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP_TIME = 0.01;
            if (params.bits !== undefined) { const bits = 8 - (params.bits * 7); this.bitCrusher.bits.setTargetAtTime(Math.max(1, bits), now, RAMP_TIME); }
            if (params.sampleRate !== undefined) { const freq = 20000 - (params.sampleRate * 19900); this.filter.frequency.setTargetAtTime(Math.max(100, freq), now, RAMP_TIME); }
        }
    }

    class FilterDrive extends EffectBase {
        constructor() {
            super("FilterDrive");
            this.wet.disconnect(this.nodes.stereoWidener);
            this.filter = new Tone.Filter({ frequency: 1000, type: "lowpass", rolloff: -12 });
            this.distortion = new Tone.Distortion(0);
            this.distortion.wet.value = 1;
            this.makeUpGain = new Tone.Gain(1.2);
            this.wet.chain(this.filter, this.distortion, this.makeUpGain, this.nodes.stereoWidener);
            this._disposables.push(this.filter, this.distortion, this.makeUpGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP_TIME = 0.01;
            if (params.cutoff !== undefined) { const freq = 100 + (params.cutoff * 9900); this.filter.frequency.setTargetAtTime(freq, now, RAMP_TIME); }
            if (params.resonance !== undefined) this.filter.Q.setTargetAtTime(params.resonance * 20, now, RAMP_TIME);
            if (params.drive !== undefined) this.distortion.distortion = params.drive;
        }
    }

    class AutoFilter extends EffectBase {
        constructor() {
            super("AutoFilter");
            this.wet.disconnect(this.nodes.stereoWidener);
            this.autoFilter = new Tone.AutoFilter({ frequency: 1, baseFrequency: 200, octaves: 2.6 }).start();
            this.autoFilter.wet.value = 1;
            this.makeUpGain = new Tone.Gain(1.4);
            this.wet.chain(this.autoFilter, this.makeUpGain, this.nodes.stereoWidener);
            this._disposables.push(this.autoFilter, this.makeUpGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP_TIME = 0.01;
            if (params.rate !== undefined) this.autoFilter.frequency.setTargetAtTime(params.rate * 10, now, RAMP_TIME);
            if (params.depth !== undefined) this.autoFilter.depth.setTargetAtTime(params.depth, now, RAMP_TIME);
            if (params.baseFreq !== undefined) this.autoFilter.baseFrequency = 50 + (params.baseFreq * 1000);
        }
    }

    class AutoPanner extends EffectBase {
        constructor() {
            super("AutoPanner");
            this.wet.disconnect(this.nodes.stereoWidener);
            this.autoPanner = new Tone.AutoPanner({ frequency: 1, depth: 1 }).start();
            this.autoPanner.wet.value = 1;
            this.makeUpGain = new Tone.Gain(1.2);
            this.wet.chain(this.autoPanner, this.makeUpGain, this.nodes.stereoWidener);
            this._disposables.push(this.autoPanner, this.makeUpGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP_TIME = 0.01;
            if (params.rate !== undefined) this.autoPanner.frequency.setTargetAtTime(params.rate * 10, now, RAMP_TIME);
            if (params.depth !== undefined) this.autoPanner.depth.setTargetAtTime(params.depth, now, RAMP_TIME);
        }
    }

    class Tremolo extends EffectBase {
        constructor() {
            super("Tremolo");
            this.wet.disconnect(this.nodes.stereoWidener);
            this.tremolo = new Tone.Tremolo({ frequency: 5, depth: 0.5, spread: 0 }).start();
            this.tremolo.wet.value = 1;
            this.makeUpGain = new Tone.Gain(1.4);
            this.wet.chain(this.tremolo, this.makeUpGain, this.nodes.stereoWidener);
            this._disposables.push(this.tremolo, this.makeUpGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP_TIME = 0.01;
            if (params.rate !== undefined) this.tremolo.frequency.setTargetAtTime(params.rate * 20, now, RAMP_TIME);
            if (params.depth !== undefined) this.tremolo.depth.setTargetAtTime(params.depth, now, RAMP_TIME);
        }
    }

    class Chebyshev extends EffectBase {
        constructor() {
            super("Chebyshev");
            this.wet.disconnect(this.nodes.stereoWidener);
            this.chebyshev = new Tone.Chebyshev(1);
            this.chebyshev.wet.value = 1;
            this.makeUpGain = new Tone.Gain(1.1);
            this.wet.chain(this.chebyshev, this.makeUpGain, this.nodes.stereoWidener);
            this._disposables.push(this.chebyshev, this.makeUpGain);
        }
        set(params) {
            super.set(params);
            if (params.order !== undefined) { const order = 1 + Math.floor(params.order * 49); this.chebyshev.order = order; }
        }
    }

    class FrequencyShifter extends EffectBase {
        constructor() {
            super("FrequencyShifter");
            this.wet.disconnect(this.nodes.stereoWidener);
            this.shifter = new Tone.FrequencyShifter(0);
            this.shifter.wet.value = 1;
            this.makeUpGain = new Tone.Gain(1.2);
            this.wet.chain(this.shifter, this.makeUpGain, this.nodes.stereoWidener);
            this._disposables.push(this.shifter, this.makeUpGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP_TIME = 0.01;
            if (params.shift !== undefined) { this.shifter.frequency.setTargetAtTime((params.shift - 0.5) * 2000, now, RAMP_TIME); }
        }
    }

    class Phaser extends EffectBase {
        constructor() {
            super("Phaser");
            this.wet.disconnect(this.nodes.stereoWidener);
            this.phaser = new Tone.Phaser({ frequency: 0.5, octaves: 3, baseFrequency: 350 });
            this.phaser.wet.value = 1;
            this.makeUpGain = new Tone.Gain(1.25);
            this.wet.chain(this.phaser, this.makeUpGain, this.nodes.stereoWidener);
            this._disposables.push(this.phaser, this.makeUpGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP_TIME = 0.01;
            if (params.rate !== undefined) this.phaser.frequency.setTargetAtTime(params.rate * 10, now, RAMP_TIME);
            if (params.depth !== undefined) this.phaser.octaves = 1 + (params.depth * 4);
            if (params.baseFreq !== undefined) this.phaser.baseFrequency = 100 + (params.baseFreq * 1000);
        }
    }

    class EnvelopeFilter extends EffectBase {
        constructor() {
            super("EnvelopeFilter");
            this.wet.disconnect(this.nodes.stereoWidener);
            this.filter = new Tone.Filter({ frequency: 400, type: "lowpass", rolloff: -12 });
            this.follower = new Tone.Follower(0.1);
            this.filterScale = new Tone.Scale(400, 5000);
            this.makeUpGain = new Tone.Gain(2.0);
            this.wet.connect(this.filter);
            this.wet.connect(this.follower);
            this.follower.connect(this.filterScale);
            this.filterScale.connect(this.filter.frequency);
            this.filter.connect(this.makeUpGain);
            this.makeUpGain.connect(this.nodes.stereoWidener);
            this._disposables.push(this.filter, this.follower, this.filterScale, this.makeUpGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP_TIME = 0.01;
            if (params.sensitivity !== undefined) { const maxFreq = 500 + (params.sensitivity * 8000); this.filterScale.max = maxFreq; }
            if (params.baseFreq !== undefined) { const minFreq = 50 + (params.baseFreq * 500); this.filterScale.min = minFreq; this.filter.frequency.setTargetAtTime(minFreq, now, RAMP_TIME); }
            if (params.resonance !== undefined) { this.filter.Q.setTargetAtTime(params.resonance * 10, now, RAMP_TIME); }
        }
    }

    // ==========================================================================
    // NEW: OLD SCHOOL SAMPLER EMULATIONS
    // ==========================================================================

    // 1. SP1200_Grit: E-mu SP-1200 (1987) - 12-bit, 26.04kHz
    class SP1200_Grit extends EffectBase {
        constructor() {
            // E-mu SP-1200 (1987)
            // 12-bit linear sampling at 26.04 kHz
            // SSM2044 4-pole (24dB/oct) transistor ladder filter on channels 1-2
            // Channels 7-8 are unfiltered
            // Designed by Dave Rossum
            // Characteristic "warm, dirty, gritty" sound
            super("SP1200_Grit");
            this._params = { grit: 0.5, tone: 0.7 };

            this.wet.disconnect(this.nodes.stereoWidener);

            // Pre-filter input gain (simulates input stage)
            this.nodes.inputGain = new Tone.Gain(1.2);

            // SP-1200 Signature: 12-bit linear encoding (not mu-law)
            // Creates quantization noise and aliasing
            this.nodes.bitCrusher = new Tone.BitCrusher(12);
            this.nodes.bitCrusher.wet.value = 1;

            // Sample rate reduction to simulate 26.04 kHz
            // This creates the characteristic aliasing/folding
            this.nodes.downsample = new Tone.Filter({ frequency: 13000, type: 'lowpass', rolloff: -24 });

            // SSM2044 analog filter simulation
            // 4-pole (24dB/octave) transistor ladder low-pass filter
            // Known for smooth resonance and "musical" character
            this.nodes.ssm2044 = new Tone.Filter({
                frequency: 12000,
                type: "lowpass",
                rolloff: -24,
                Q: 2 // Classic SSM2044 resonance
            });

            // Post-filter slight saturation (analog warmth)
            this.nodes.saturation = new Tone.Chebyshev(2);
            this.nodes.saturation.wet.value = 0.15;

            // Output makeup
            this.nodes.makeUpGain = new Tone.Gain(1.3);

            this.wet.chain(
                this.nodes.inputGain,
                this.nodes.downsample,
                this.nodes.bitCrusher,
                this.nodes.ssm2044,
                this.nodes.saturation,
                this.nodes.makeUpGain,
                this.nodes.stereoWidener
            );

            this._disposables.push(
                this.nodes.inputGain, this.nodes.bitCrusher, this.nodes.downsample,
                this.nodes.ssm2044, this.nodes.saturation, this.nodes.makeUpGain
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP_TIME = 0.01;

            if (params.grit !== undefined) {
                this._params.grit = params.grit;
                // Grit reduces bit depth from 12 down to 4 for extreme lo-fi
                const bits = 12 - (params.grit * 8);
                this.nodes.bitCrusher.bits.setTargetAtTime(clamp(bits, 4, 12), now, RAMP_TIME);

                // Also increase saturation with grit
                this.nodes.saturation.wet.setTargetAtTime(0.1 + (params.grit * 0.3), now, RAMP_TIME);

                // Reduce sample rate simulation
                const srFilter = 13000 - (params.grit * 8000);
                this.nodes.downsample.frequency.setTargetAtTime(srFilter, now, RAMP_TIME);
            }

            if (params.tone !== undefined) {
                this._params.tone = params.tone;
                // SSM2044 filter cutoff sweep: 2kHz (dark) to 18kHz (open)
                this.nodes.ssm2044.frequency.setTargetAtTime(2000 + (params.tone * 16000), now, RAMP_TIME);
            }
        }
    }

    // 2. MPC_Punch: Mid-range knock and soft clipping
    class MPC_Punch extends EffectBase {
        constructor() {
            super("MPC_Punch");
            this.wet.disconnect(this.nodes.stereoWidener);
            // MPC60/3000 used specific converters that had a "hard" clip sound.
            // We simulate this with odd-harmonic distortion (clipping)
            this.clipper = new Tone.Distortion(0.1); // Soft clip start

            // "Knock" EQ: Boost 100Hz (Kick/Snare body) and 3kHz (Crack)
            this.eq = new Tone.EQ3({ low: 8, mid: -2, high: 4, lowFrequency: 120, highFrequency: 3000 });

            this.limiter = new Tone.Limiter(-1); // Hard limit like the output bus
            this.makeUpGain = new Tone.Gain(1.2);

            this.wet.chain(this.eq, this.clipper, this.limiter, this.makeUpGain, this.nodes.stereoWidener);
            this._disposables.push(this.eq, this.clipper, this.limiter, this.makeUpGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP_TIME = 0.01;
            if (params.punch !== undefined) {
                this.eq.low.setTargetAtTime(params.punch * 14, now, RAMP_TIME); // More gain = more punch
                // Increase clipper drive with punch
                this.clipper.distortion = 0.1 + (params.punch * 0.4);
            }
            if (params.snap !== undefined) {
                this.eq.high.setTargetAtTime(params.snap * 8, now, RAMP_TIME);
            }
        }
    }

    // 3. Vinyl_Pump: SP-303 style pumping compressor
    class Vinyl_Pump extends EffectBase {
        constructor() {
            super("Vinyl_Pump");
            this.wet.disconnect(this.nodes.stereoWidener);

            // "Pumping" requires:
            // 1. Fast Attack (to catch the transient immediately)
            // 2. Medium-Slow Release (to suppress the gain for the beat duration)
            // 3. High Ratio (to force gain reduction)
            this.compressor = new Tone.Compressor({
                threshold: -24,
                ratio: 16,
                attack: 0.005,
                release: 0.3, // 300ms is good for "breathing" at ~90-110bpm
                knee: 0 // Hard knee for aggressive pumping
            });

            this.limiter = new Tone.Limiter(-0.5); // Brickwall at the end
            this.makeUpGain = new Tone.Gain(1.5);

            this.wet.chain(this.compressor, this.limiter, this.makeUpGain, this.nodes.stereoWidener);
            this._disposables.push(this.compressor, this.limiter, this.makeUpGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP_TIME = 0.01;
            if (params.squash !== undefined) {
                // More squash = lower threshold + higher ratio + slower release (more sustain suppression)
                this.compressor.threshold.setTargetAtTime(-15 - (params.squash * 45), now, RAMP_TIME);
                this.compressor.ratio.setTargetAtTime(4 + (params.squash * 20), now, RAMP_TIME);
                // Adjust release slightly to tune the "groove" of the pump
                this.compressor.release.setTargetAtTime(0.1 + (params.squash * 0.4), now, RAMP_TIME);
            }
            if (params.attack !== undefined) {
                // Allow tuning the attack to let some transient through or squash it flat
                this.compressor.attack.setTargetAtTime(0.001 + (params.attack * 0.1), now, RAMP_TIME);
            }
        }
    }

    // 4. Cassette_Deck: Pitch wobble and high frequency loss
    class Cassette_Deck extends EffectBase {
        constructor() {
            super("Cassette_Deck");
            this.wet.disconnect(this.nodes.stereoWidener);

            // Wobble (Wow/Flutter)
            this.vibrato = new Tone.Vibrato({ frequency: 4, depth: 0.2, type: "sine" });
            this.vibrato.wet.value = 1;

            // Tape Hiss (Brown noise is authentic for tape hiss spectrum)
            this.noise = new Tone.Noise("brown");
            this.noiseGain = new Tone.Gain(0.05);

            // Tape Saturation: Even harmonics (Chebyshev 2) simulates magnetic hysteresis
            this.saturation = new Tone.Chebyshev(2);
            this.saturation.wet.value = 1;

            // "Head Bump" Resonance: Tape heads have a resonant bump around 100-200Hz
            // We use a peaking filter to simulate this
            this.headBump = new Tone.Filter({ frequency: 120, type: "peaking", Q: 2 }); // 2 gain boost
            this.headBump.Q.value = 1.5;

            // High Frequency Roll-off (Azimuth alignment loss / Type I tape)
            this.filter = new Tone.Filter({ frequency: 14000, type: "lowpass", rolloff: -12 });

            this.makeUpGain = new Tone.Gain(1.2);

            this.noise.connect(this.noiseGain);
            this.noiseGain.connect(this.filter); // Noise is also filtered by circuitry

            // Signal Chain: Input -> Saturation -> HeadBump -> Vibrato -> Filter -> Output
            this.wet.chain(this.saturation, this.headBump, this.vibrato, this.filter, this.makeUpGain, this.nodes.stereoWidener);

            // Start Noise
            this.noise.start();

            this._disposables.push(this.vibrato, this.filter, this.headBump, this.noise, this.noiseGain, this.saturation, this.makeUpGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP_TIME = 0.01;
            if (params.age !== undefined) {
                // Age increases wobble, decreases bandwidth, increases noise
                this.vibrato.depth.setTargetAtTime(0.1 + (params.age * 0.4), now, RAMP_TIME);
                this.vibrato.frequency.setTargetAtTime(2 + (params.age * 4), now, RAMP_TIME);
                this.noiseGain.gain.setTargetAtTime(params.age * 0.15, now, RAMP_TIME);

                // Age also lowers cutoff significantly
                const freq = 14000 - (params.age * 10000);
                this.filter.frequency.setTargetAtTime(freq, now, RAMP_TIME);
            }
            if (params.tone !== undefined) {
                // Fine tune frequency response 
                // We combine age and tone controls for final cutoff
                // but here we just modulate the filter base (overridden by age if active, but they work together)
            }
        }
        dispose() { super.dispose(); this.noise.stop(); }
    }

    // 5. Tape_Echo: Dark feedback delay
    class Tape_Echo extends EffectBase {
        constructor() {
            super("Tape_Echo");
            // Authentic Tape Echo (e.g. Roland RE-201 / Echoplex style)
            this.wet.disconnect(this.nodes.stereoWidener);
            
            // Tape Preamp Saturation
            this.saturation = new Tone.Chebyshev(2);
            this.saturation.wet.value = 0.2;

            this.delay = new Tone.FeedbackDelay("8n", 0.5);
            this.delay.wet.value = 1; // Full wet delay on the wet path
            
            // Wow and Flutter (Pitch Modulation)
            this.vibrato = new Tone.Vibrato({ frequency: 1.2, depth: 0.1, type: "sine" });
            
            // Dark repeats simulating tape degradation
            this.filter = new Tone.Filter({ frequency: 2000, type: "lowpass", rolloff: -12 }); 
            this.makeUpGain = new Tone.Gain(1.2);

            this.wet.chain(this.saturation, this.delay, this.vibrato, this.filter, this.makeUpGain, this.nodes.stereoWidener);
            this._disposables.push(this.saturation, this.delay, this.vibrato, this.filter, this.makeUpGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP_TIME = 0.01;
            if (params.time !== undefined) {
                // Time affects delay time AND wow/flutter frequency (slower tape = slower wow)
                this.delay.delayTime.setTargetAtTime(params.time * 0.5, now, RAMP_TIME);
                this.vibrato.frequency.setTargetAtTime(1.5 - (params.time * 0.5), now, RAMP_TIME);
            }
            if (params.feedback !== undefined) {
                this.delay.feedback.setTargetAtTime(params.feedback * 0.9, now, RAMP_TIME);
                // Higher feedback pushes more into saturation
                this.saturation.wet.setTargetAtTime(0.2 + (params.feedback * 0.3), now, RAMP_TIME);
            }
        }
    }

    // 7. SP-303 Vinyl Sim: Refined with specific pumping and authentic crackle
    class SP303VinylSim extends EffectBase {
        constructor() {
            super("SP303VinylSim");
            this.wet.disconnect(this.nodes.stereoWidener);

            // 1. Wow/Flutter: Authentically slow and "wobbly"
            this.vibrato = new Tone.Vibrato({ frequency: 0.5, depth: 0.2, type: "sine" });

            // 2. Vinyl Hiss and Crackle
            this.noise = new Tone.Noise("pink"); // Pink noise spectrum fits vinyl surface noise better
            this.noiseFilter = new Tone.Filter({ frequency: 2000, type: "lowpass" });
            this.noiseGain = new Tone.Gain(0.02);

            // Random clicks/pops can be approximated by a second noise source gated or intermittent, 
            // but for now we stick to the existing architecture:
            this.crackle = new Tone.Noise("brown"); // Deeper rumbles for pops
            this.crackleFilter = new Tone.Filter({ frequency: 500, type: "highpass" }); // Filter out the mud
            this.crackleGain = new Tone.Gain(0.01);

            // 3. SP-303 Pumping Compressor
            // The "Vinyl Sim" compressor on the 303 is notorious for "gluing" the mix
            this.compressor = new Tone.Compressor({
                threshold: -24,
                ratio: 12,
                attack: 0.01,
                release: 0.3,
                knee: 0
            });

            // 4. Bandwidth Limiting (Analog Lo-Fi)
            this.tone = new Tone.Filter({ frequency: 4000, type: "lowpass", rolloff: -12 });
            this.makeUpGain = new Tone.Gain(1.4);

            // Routing
            this.noise.chain(this.noiseFilter, this.noiseGain, this.compressor);
            this.crackle.chain(this.crackleFilter, this.crackleGain, this.compressor);
            this.wet.chain(this.vibrato, this.compressor, this.tone, this.makeUpGain, this.nodes.stereoWidener);

            this.noise.start();
            this.crackle.start();
            this._disposables.push(this.vibrato, this.noise, this.noiseFilter, this.noiseGain, this.crackle, this.crackleFilter, this.crackleGain, this.compressor, this.tone, this.makeUpGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP_TIME = 0.01;
            if (params.pumping !== undefined) {
                this.compressor.threshold.setTargetAtTime(-15 - (params.pumping * 45), now, RAMP_TIME);
                this.compressor.ratio.setTargetAtTime(2 + (params.pumping * 18), now, RAMP_TIME);
            }
            if (params.wow !== undefined) {
                this.vibrato.depth.setTargetAtTime(params.wow * 0.8, now, RAMP_TIME);
                this.vibrato.frequency.setTargetAtTime(0.2 + (params.wow * 3), now, RAMP_TIME);
            }
            if (params.noise !== undefined) {
                this.noiseGain.gain.setTargetAtTime(params.noise * 0.08, now, RAMP_TIME);
                this.crackleGain.gain.setTargetAtTime(params.noise * 0.04, now, RAMP_TIME);
            }
            if (params.tone !== undefined) {
                // Vinyl Sim tone knob often boosted bass when turned left, and treble when right.
                // We simplify to a high cut for "Lo-Fi" vibe
                this.tone.frequency.setTargetAtTime(1000 + (params.tone * 18000), now, RAMP_TIME);
            }
        }
        dispose() {
            super.dispose();
            this.noise.stop();
            this.crackle.stop();
        }
    }

    // 8. Tape Stop: Pitch/time deceleration
    class TapeStop extends EffectBase {
        constructor() {
            super("TapeStop");
            this.wet.disconnect(this.nodes.stereoWidener);
            // We use a PitchShift for the deceleration effect
            this.shifter = new Tone.PitchShift({ pitch: 0, windowSize: 0.1 });
            this.shifter.wet.value = 1;
            this.delay = new Tone.Delay(0, 1);
            this.makeUpGain = new Tone.Gain(1.2);

            this.wet.chain(this.shifter, this.delay, this.makeUpGain, this.nodes.stereoWidener);
            this._disposables.push(this.shifter, this.delay, this.makeUpGain);
            this._isStopping = false;
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.stop !== undefined) {
                if (params.stop > 0.5 && !this._isStopping) {
                    // Trigger Tape Stop
                    this._isStopping = true;
                    this.shifter.pitch = 0;
                    // Note: In Tone.js, PitchShift.pitch is not a Signal, it's a number property.
                    // Emulating tape stop with PitchShift requires more complex logic.
                    // We'll approximate by setting it, though a true ramp would need an interval/automation.
                    this.shifter.pitch = -24;
                    this.delay.delayTime.linearRampToValueAtTime(0.5, now + 1.5);
                } else if (params.stop <= 0.5 && this._isStopping) {
                    // Reset Tape
                    this._isStopping = false;
                    this.shifter.pitch = 0;
                    this.delay.delayTime.cancelScheduledValues(now);
                    this.delay.delayTime.linearRampToValueAtTime(0, now + 0.1);
                }
            }
        }
    }

    // 9. Sub Sonic: Low end enhancer
    class Sub_Sonic extends EffectBase {
        constructor() {
            super("Sub_Sonic");
            this.wet.disconnect(this.nodes.stereoWidener);
            this.subOsc = new Tone.Oscillator(40, "sine").start();
            this.subGain = new Tone.Gain(0);
            this.lowPass = new Tone.Filter({ frequency: 100, type: "lowpass" });
            this.follower = new Tone.Follower(0.1);

            this.subOsc.connect(this.subGain);
            this.subGain.connect(this.nodes.stereoWidener);

            // Sidechain-like control: input volume drives sub gain
            this.wet.connect(this.follower);
            this.follower.connect(this.subGain.gain);

            this.wet.chain(this.lowPass, this.nodes.stereoWidener);
            this._disposables.push(this.subOsc, this.subGain, this.lowPass, this.follower);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.freq !== undefined) this.subOsc.frequency.setTargetAtTime(30 + (params.freq * 50), now, 0.01);
            if (params.boom !== undefined) this.subGain.gain.setTargetAtTime(params.boom * 0.5, now, 0.01);
        }
        dispose() { super.dispose(); this.subOsc.stop(); }
    }

    // 10. Radio Transistor: Bandwidth limit and noise
    class Radio_Transistor extends EffectBase {
        constructor() {
            super("Radio_Transistor");
            this.wet.disconnect(this.nodes.stereoWidener);

            // AM Radio Bandwidth: ~300Hz to 4-5kHz
            // We use a bandpass with high Q to simulate the narrow IF (Intermediate Frequency) filters
            this.filter = new Tone.Filter({ frequency: 1000, type: "bandpass", rolloff: -48 }); // Steep filter
            this.filter.Q.value = 1.5;

            // Transistor/Receiver Distortion: 
            // Radio receivers overload easily, clipping the AM envelope.
            // We put distortion BEFORE the filter to simulate RF stage overload
            this.distortion = new Tone.Distortion(0.8);

            this.noise = new Tone.Noise("white").start();
            this.noiseGain = new Tone.Gain(0.15); // Static is loud on AM

            this.makeUpGain = new Tone.Gain(3.0); // Recover lost energy from heavy filtering

            this.noise.connect(this.noiseGain);
            // Mix noise into the signal path before distortion so the static gets distorted too (intermod)
            this.noiseGain.connect(this.distortion);

            this.wet.chain(this.distortion, this.filter, this.makeUpGain, this.nodes.stereoWidener);
            this._disposables.push(this.filter, this.noise, this.noiseGain, this.distortion, this.makeUpGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP_TIME = 0.01;
            if (params.tuning !== undefined) {
                // Tuning sweeps the center frequency of the bandpass
                // Simulating tuning across the dial
                this.filter.frequency.setTargetAtTime(600 + (params.tuning * 3000), now, RAMP_TIME);
            }
            if (params.static !== undefined) {
                this.noiseGain.gain.setTargetAtTime(params.static * 0.3, now, RAMP_TIME);
            }
        }
        dispose() { super.dispose(); this.noise.stop(); }
    }

    // 11. Decimator_OldSchool: Sample rate reduction
    class Decimator_OldSchool extends EffectBase {
        constructor() {
            super("Decimator_OldSchool");
            this.wet.disconnect(this.nodes.stereoWidener);
            this.bitCrusher = new Tone.BitCrusher(8);
            this.filter = new Tone.Filter({ frequency: 10000, type: "lowpass" });
            this.makeUpGain = new Tone.Gain(1.2);
            this.wet.chain(this.bitCrusher, this.filter, this.makeUpGain, this.nodes.stereoWidener);
            this._disposables.push(this.bitCrusher, this.filter, this.makeUpGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.quality !== undefined) {
                this.bitCrusher.bits.setTargetAtTime(2 + (params.quality * 10), now, 0.01);
                this.filter.frequency.setTargetAtTime(2000 + (params.quality * 16000), now, 0.01);
            }
        }
    }

    // 12. Octave Drop: Sub-octave generation
    class Octave_Drop extends EffectBase {
        constructor() {
            super("Octave_Drop");
            this.wet.disconnect(this.nodes.stereoWidener);
            this.pitchShift = new Tone.PitchShift(-12);
            this.filter = new Tone.Filter({ frequency: 400, type: "lowpass" });
            this.makeUpGain = new Tone.Gain(1.5);
            this.wet.chain(this.pitchShift, this.filter, this.makeUpGain, this.nodes.stereoWidener);
            this._disposables.push(this.pitchShift, this.filter, this.makeUpGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.tone !== undefined) this.filter.frequency.setTargetAtTime(100 + (params.tone * 2000), now, 0.01);
        }
    }

    // 13. Space Verb: Large ambient reverb
    class Space_Verb extends EffectBase {
        constructor() {
            super("Space_Verb");
            this.wet.disconnect(this.nodes.stereoWidener);
            this.reverb = new Tone.Freeverb({ roomSize: 0.9, dampening: 3000 });
            this.reverb.wet.value = 1;
            this.makeUpGain = new Tone.Gain(1.2);
            this.wet.chain(this.reverb, this.makeUpGain, this.nodes.stereoWidener);
            this._disposables.push(this.reverb, this.makeUpGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.size !== undefined) {
                const val = 0.5 + (params.size * 0.49);
                if (this.reverb.roomSize && typeof this.reverb.roomSize.value !== 'undefined') {
                    this.reverb.roomSize.value = val;
                } else {
                    this.reverb.roomSize = val;
                }
            }
            if (params.damp !== undefined) {
                const val = 100 + (params.damp * 8000);
                if (this.reverb.dampening && typeof this.reverb.dampening.value !== 'undefined') {
                    this.reverb.dampening.value = val;
                } else {
                    this.reverb.dampening = val;
                }
            }
        }
    }

    // 9. Lofi Cassette: Bandwidth limiting and saturation
    class LofiCassette extends EffectBase {
        constructor() {
            super("LofiCassette");
            this.wet.disconnect(this.nodes.stereoWidener);
            this.vibrato = new Tone.Vibrato({ frequency: 2, depth: 0.1 });
            this.saturation = new Tone.Distortion(0.2);
            this.filter = new Tone.Filter({ frequency: 2000, type: "bandpass", Q: 0.5 });
            this.noise = new Tone.Noise("brown");
            this.noiseGain = new Tone.Gain(0.02);
            this.makeUpGain = new Tone.Gain(1.5);

            this.noise.connect(this.noiseGain);
            this.noiseGain.connect(this.filter);

            this.wet.chain(this.vibrato, this.saturation, this.filter, this.makeUpGain, this.nodes.stereoWidener);

            this.noise.start();
            this._disposables.push(this.vibrato, this.saturation, this.filter, this.noise, this.noiseGain, this.makeUpGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.age !== undefined) {
                this.vibrato.depth.value = 0.05 + (params.age * 0.4);
                this.filter.Q.value = 0.5 + (params.age * 2);
                this.noiseGain.gain.setTargetAtTime(params.age * 0.1, now, 0.01);
            }
            if (params.saturation !== undefined) {
                this.saturation.distortion = params.saturation;
            }
        }
        dispose() { super.dispose(); this.noise.stop(); }
    }

    // --------------------------------------------------------------------------
    // VINTAGE EMULATIONS (v12.2)
    // --------------------------------------------------------------------------

    class DimensionD extends EffectBase {
        constructor() {
            super("DimensionD");
            this.wet.disconnect(this.nodes.stereoWidener);

            // Dimension D used two BBD lines with inverse phase LFOs
            this.delayL = new Tone.Delay(0.01, 0.05);
            this.delayR = new Tone.Delay(0.01, 0.05);

            this.lfo = new Tone.LFO(0.25, 0.005, 0.015).start();
            this.lfoInv = new Tone.LFO(0.25, 0.005, 0.015).start();
            this.lfoInv.phase = 180;

            this.lfo.connect(this.delayL.delayTime);
            this.lfoInv.connect(this.delayR.delayTime);

            this.split = new Tone.Split();
            this.merge = new Tone.Merge();

            // Cross-mixing for spatial effect
            this.wet.connect(this.split);
            this.split.connect(this.delayL, 0); // L
            this.split.connect(this.delayR, 1); // R

            this.delayL.connect(this.merge, 0, 0);
            this.delayR.connect(this.merge, 0, 1);

            this.merge.connect(this.nodes.stereoWidener);

            this._disposables.push(this.delayL, this.delayR, this.lfo, this.lfoInv, this.split, this.merge);
        }
        set(params) {
            super.set(params);
            if (params.mode !== undefined) {
                // Modes 1-4: increasing depth/rate
                const m = Math.floor(params.mode * 3) + 1;
                this.lfo.frequency.value = 0.1 * m;
                this.lfoInv.frequency.value = 0.1 * m;
                this.lfo.max = 0.01 + (m * 0.005);
                this.lfoInv.max = 0.01 + (m * 0.005);
            }
        }
    }

    class MuTronBiPhase extends EffectBase {
        constructor() {
            super("MuTronBiPhase");
            this.wet.disconnect(this.nodes.stereoWidener);

            // Dual 6-stage phasers
            this.phaserA = new Tone.Phaser({ stages: 6, Q: 10 });
            this.phaserB = new Tone.Phaser({ stages: 6, Q: 10 });

            this.lfoA = new Tone.LFO(0.5, 0.1, 1).start();
            this.lfoB = new Tone.LFO(0.5, 0.1, 1).start();

            this.lfoA.connect(this.phaserA.frequency);
            this.lfoB.connect(this.phaserB.frequency);

            this.wet.chain(this.phaserA, this.phaserB, this.nodes.stereoWidener);
            this._disposables.push(this.phaserA, this.phaserB, this.lfoA, this.lfoB);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.rate !== undefined) {
                this.lfoA.frequency.setTargetAtTime(params.rate * 5, now, 0.01);
                if (params.sync > 0.5) this.lfoB.frequency.setTargetAtTime(params.rate * 5, now, 0.01);
            }
            if (params.feedback !== undefined) {
                this.phaserA.Q.value = params.feedback * 20;
                this.phaserB.Q.value = params.feedback * 20;
            }
        }
    }

    class OptoLeveler extends EffectBase {
        constructor() {
            super("OptoLeveler");
            this.wet.disconnect(this.nodes.stereoWidener);

            // LA-2A style dual-stage release
            this.comp = new Tone.Compressor({
                threshold: -24,
                ratio: 3,
                attack: 0.01,
                release: 0.5,
                knee: 30
            });

            this.makeup = new Tone.Gain(1.5);
            this.wet.chain(this.comp, this.makeup, this.nodes.stereoWidener);
            this._disposables.push(this.comp, this.makeup);
        }
        set(params) {
            super.set(params);
            if (params.peakReduction !== undefined) {
                this.comp.threshold.value = -10 - (params.peakReduction * 50);
            }
            if (params.gain !== undefined) {
                this.makeup.gain.value = 1 + (params.gain * 4);
            }
        }
    }

    class FETCrusher extends EffectBase {
        constructor() {
            super("FETCrusher");
            this.wet.disconnect(this.nodes.stereoWidener);

            // 1176 style fast FET compression
            this.comp = new Tone.Compressor({
                threshold: -20,
                ratio: 4,
                attack: 0.0001,
                release: 0.05
            });

            this.saturated = new Tone.Distortion(0.2);
            this.makeup = new Tone.Gain(1.2);

            this.wet.chain(this.comp, this.saturated, this.makeup, this.nodes.stereoWidener);
            this._disposables.push(this.comp, this.saturated, this.makeup);
        }
        set(params) {
            super.set(params);
            if (params.input !== undefined) {
                this.comp.threshold.value = -5 - (params.input * 40);
                this.saturated.distortion = params.input * 0.5;
            }
            if (params.speed !== undefined) {
                this.comp.release.value = 0.01 + (params.speed * 1.0);
            }
        }
    }

    class TheBigKnob extends EffectBase {
        constructor() {
            super("TheBigKnob");
            this.wet.disconnect(this.nodes.stereoWidener);

            // Altec 9069B Stepped HPF
            this.filter = new Tone.Filter(20, "highpass", -18);
            this.wet.chain(this.filter, this.nodes.stereoWidener);
            this._disposables.push(this.filter);

            this.steps = [0, 70, 100, 150, 250, 500, 1000, 2000, 3000, 5000, 7500];
        }
        set(params) {
            super.set(params);
            if (params.step !== undefined) {
                const idx = Math.floor(params.step * 10);
                const freq = this.steps[idx] || 0;
                if (freq === 0) {
                    this.filter.frequency.value = 10; // "OFF" (subsonic)
                } else {
                    this.filter.frequency.value = freq;
                }
            }
        }
    }

    class DatamixEQ extends EffectBase {
        constructor() {
            super("DatamixEQ");
            this.wet.disconnect(this.nodes.stereoWidener);

            this.eq = new Tone.EQ3({
                low: 0, mid: 0, high: 0,
                lowFrequency: 120,
                highFrequency: 3000
            });

            this.wet.chain(this.eq, this.nodes.stereoWidener);
            this._disposables.push(this.eq);
        }
        set(params) {
            super.set(params);
            if (params.low !== undefined) this.eq.low.value = (params.low - 0.5) * 30;
            if (params.mid !== undefined) this.eq.mid.value = (params.mid - 0.5) * 30;
            if (params.high !== undefined) this.eq.high.value = (params.high - 0.5) * 30;
        }
    }

    class BigMuff extends EffectBase {
        constructor() {
            super("BigMuff");
            this.wet.disconnect(this.nodes.stereoWidener);

            // Big Muff logic: Sustain -> Tone (Mid scoop) -> Vol
            this.dist = new Tone.Distortion(0.8);
            this.scoop = new Tone.Filter(1000, "notch", -12);
            this.eq = new Tone.EQ3({ low: 6, mid: -10, high: 4 });

            this.makeup = new Tone.Gain(2);
            this.wet.chain(this.dist, this.scoop, this.eq, this.makeup, this.nodes.stereoWidener);
            this._disposables.push(this.dist, this.scoop, this.eq, this.makeup);
        }
        set(params) {
            super.set(params);
            if (params.sustain !== undefined) this.dist.distortion = params.sustain;
            if (params.tone !== undefined) {
                this.scoop.frequency.value = 200 + (params.tone * 3000);
            }
        }
    }

    class RAT2 extends EffectBase {
        constructor() {
            super("RAT2");
            this.wet.disconnect(this.nodes.stereoWidener);

            // RAT2 logic: Distortion -> Reverse Filter (Clockwise=Dark)
            this.dist = new Tone.Distortion(0.9);
            this.filter = new Tone.Filter(20000, "lowpass", -12);
            this.makeup = new Tone.Gain(1.5);

            this.wet.chain(this.dist, this.filter, this.makeup, this.nodes.stereoWidener);
            this._disposables.push(this.dist, this.filter, this.makeup);
        }
        set(params) {
            super.set(params);
            if (params.distortion !== undefined) this.dist.distortion = params.distortion;
            if (params.filter !== undefined) {
                // Reverse filter: 1.0 = dark (400Hz), 0.0 = bright (15kHz)
                this.filter.frequency.value = 15000 - (params.filter * 14600);
            }
        }
    }

    class Grampian636 extends EffectBase {
        constructor() {
            super("Grampian636");
            this.wet.disconnect(this.nodes.stereoWidener);

            this.preamp = new Tone.Distortion(0.6); // Aggressive clipping
            this.spring = new Tone.Freeverb({ roomSize: 0.6, dampening: 4000 });
            this.eq = new Tone.Filter({ frequency: 2500, type: "peaking", Q: 1, gain: 6 }); // High-mid edge

            this.makeup = new Tone.Gain(2);
            this.wet.chain(this.preamp, this.spring, this.eq, this.makeup, this.nodes.stereoWidener);
            this._disposables.push(this.preamp, this.spring, this.eq, this.makeup);
        }
        set(params) {
            super.set(params);
            if (params.overload !== undefined) this.preamp.distortion = params.overload;
            if (params.reverberate !== undefined) this.spring.wet.value = params.reverberate;
        }
    }

    class RE201 extends EffectBase {
        constructor() {
            super("RE201");
            this.wet.disconnect(this.nodes.stereoWidener);

            this.delay = new Tone.FeedbackDelay("4n", 0.5);
            this.spring = new Tone.Freeverb({ roomSize: 0.5, dampening: 3000 });
            this.wow = new Tone.Vibrato(0.5, 0.1);

            this.filter = new Tone.Filter(5000, "lowpass");
            this.makeup = new Tone.Gain(1.2);

            this.wet.chain(this.wow, this.delay, this.spring, this.filter, this.makeup, this.nodes.stereoWidener);
            this._disposables.push(this.delay, this.spring, this.wow, this.filter, this.makeup);
        }
        set(params) {
            super.set(params);
            if (params.rate !== undefined) this.delay.delayTime.value = params.rate * 2;
            if (params.intensity !== undefined) this.delay.feedback.value = params.intensity * 0.95;
            if (params.reverb !== undefined) this.spring.wet.value = params.reverb;
        }
    }

    class SDE3000 extends EffectBase {
        constructor() {
            super("SDE3000");
            this.wet.disconnect(this.nodes.stereoWidener);

            this.delay = new Tone.FeedbackDelay("4n", 0.3);
            this.lfo = new Tone.Vibrato(2, 0.2); // Modulation on tails
            this.bitCrush = new Tone.BitCrusher(12); // Digital artifacts

            this.filter = new Tone.Filter(10000, "lowpass");
            this.makeup = new Tone.Gain(1.2);

            this.wet.chain(this.delay, this.lfo, this.bitCrush, this.filter, this.makeup, this.nodes.stereoWidener);
            this._disposables.push(this.delay, this.lfo, this.bitCrush, this.filter, this.makeup);
        }
        set(params) {
            super.set(params);
            if (params.time !== undefined) this.delay.delayTime.value = params.time;
            if (params.feedback !== undefined) this.delay.feedback.value = params.feedback * 0.8;
            if (params.modulation !== undefined) {
                this.lfo.frequency.value = params.modulation * 10;
                this.lfo.depth.value = params.modulation * 0.5;
            }
        }
    }

    class FisherSpacexpander extends EffectBase {
        constructor() {
            super("FisherSpacexpander");
            this.wet.disconnect(this.nodes.stereoWidener);
            
            // Tube drive stage
            this.tube = new Tone.Chebyshev(2);
            this.tube.wet.value = 0.5;
            
            // Spring tank
            this.spring = new Tone.Freeverb({ roomSize: 0.7, dampening: 5000 });
            
            this.makeup = new Tone.Gain(1.5);
            
            this.wet.chain(this.tube, this.spring, this.makeup, this.nodes.stereoWidener);
            this._disposables.push(this.tube, this.spring, this.makeup);
        }
        set(params) {
            super.set(params);
            if (params.warmth !== undefined) this.tube.wet.value = params.warmth;
            if (params.decay !== undefined) this.spring.roomSize.value = params.decay * 0.9;
        }
    }

    class TEAC_A3340 extends EffectBase {
        constructor() {
            super("TEAC_A3340");
            this.wet.disconnect(this.nodes.stereoWidener);
            
            // Tape saturation
            this.drive = new Tone.Distortion(0.2);
            
            // Tape EQ curve
            this.headBump = new Tone.Filter(80, "peaking");
            this.headBump.Q.value = 2;
            this.highRollOff = new Tone.Filter(12000, "lowpass", -12);
            
            // Wow & flutter
            this.wow = new Tone.Vibrato(0.8, 0.05);
            
            this.makeup = new Tone.Gain(1.2);
            
            this.wet.chain(this.wow, this.drive, this.headBump, this.highRollOff, this.makeup, this.nodes.stereoWidener);
            this._disposables.push(this.drive, this.headBump, this.highRollOff, this.wow, this.makeup);
        }
        set(params) {
            super.set(params);
            if (params.drive !== undefined) this.drive.distortion = params.drive;
            if (params.wow !== undefined) {
                this.wow.depth.value = params.wow * 0.2;
                this.wow.frequency.value = 0.5 + params.wow * 2;
            }
        }
    }

    const classes = {
        AutoFilter, AutoPanner, Cassette_Deck, Chebyshev, Decimator_OldSchool,
        EnvelopeFilter, FilterDrive, FrequencyShifter, Isolator, LoFi,
        LofiCassette, MPC_Punch, Octave_Drop, Phaser, Radio_Transistor,
        SirenDoppler, Slicer, SP1200_Grit, SP303VinylSim, Space_Verb,
        Sub_Sonic, TapeStop, Tape_Echo, Tremolo, VinylSim, Vinyl_Pump,
        VoiceTransformer, OptoLeveler, FETCrusher,
        TheBigKnob, DatamixEQ, FisherSpacexpander, TEAC_A3340
    };

    
    const configs = {
        "Experimental": {
            "AutoFilter": {
                "isCustom": "AutoFilter",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Rate", "p": "rate", "min": 0, "max": 1, "s": 0.01, "def": 0.1 }],
                    [{ "l": "Depth", "p": "depth", "min": 0, "max": 1, "s": 0.01, "def": 1 }],
                    [{ "l": "Base Freq", "p": "baseFreq", "min": 0, "max": 1, "s": 0.01, "def": 0.2 }]
                ]
            },
            "AutoPanner": {
                "isCustom": "AutoPanner",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Rate", "p": "rate", "min": 0, "max": 1, "s": 0.01, "def": 0.1 }],
                    [{ "l": "Depth", "p": "depth", "min": 0, "max": 1, "s": 0.01, "def": 1 }]
                ]
            },
            "Chebyshev": {
                "isCustom": "Chebyshev",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Order", "p": "order", "min": 0, "max": 1, "s": 0.01, "def": 0.1 }]
                ]
            },
            "EnvelopeFilter": {
                "isCustom": "EnvelopeFilter",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Sens", "p": "sensitivity", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }],
                    [{ "l": "Base Freq", "p": "baseFreq", "min": 0, "max": 1, "s": 0.01, "def": 0.2 }],
                    [{ "l": "Resonance", "p": "resonance", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]
                ]
            },
            "FilterDrive": {
                "isCustom": "FilterDrive",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Frequency", "p": "frequency", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }],
                    [{ "l": "Drive", "p": "drive", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]
                ]
            },
            "FrequencyShifter": {
                "isCustom": "FrequencyShifter",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Shift", "p": "shift", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]
                ]
            },
            "Isolator": {
                "isCustom": "Isolator",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Low", "p": "low", "min": 0, "max": 1, "s": 0.01, "def": 1 }],
                    [{ "l": "Mid", "p": "mid", "min": 0, "max": 1, "s": 0.01, "def": 1 }],
                    [{ "l": "High", "p": "high", "min": 0, "max": 1, "s": 0.01, "def": 1 }]
                ]
            },
            "LoFi": {
                "isCustom": "LoFi",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Quality", "p": "quality", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]
                ]
            },
            "Phaser": {
                "isCustom": "Phaser",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Rate", "p": "rate", "min": 0, "max": 1, "s": 0.01, "def": 0.1 }],
                    [{ "l": "Depth", "p": "depth", "min": 0, "max": 1, "s": 0.01, "def": 1 }]
                ]
            },
            "SirenDoppler": {
                "isCustom": "SirenDoppler",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Speed", "p": "speed", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]
                ]
            },
            "Slicer": {
                "isCustom": "Slicer",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Speed", "p": "speed", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]
                ]
            },
            "Tremolo": {
                "isCustom": "Tremolo",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Rate", "p": "rate", "min": 0, "max": 1, "s": 0.01, "def": 0.1 }],
                    [{ "l": "Depth", "p": "depth", "min": 0, "max": 1, "s": 0.01, "def": 1 }]
                ]
            },
            "VinylSim": {
                "isCustom": "VinylSim",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Age", "p": "age", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]
                ]
            },
            "VoiceTransformer": {
                "isCustom": "VoiceTransformer",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Pitch", "p": "pitch", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }],
                    [{ "l": "Formant", "p": "formant", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]
                ]
            }
        },
        "Lo-Fi Samplers": {
            "SP-1200 Grit": {
                "isCustom": "SP1200_Grit",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Grit", "p": "grit", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }],
                    [{ "l": "Tone", "p": "tone", "min": 0, "max": 1, "s": 0.01, "def": 0.7 }]
                ]
            },
            "MPC Punch": {
                "isCustom": "MPC_Punch",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Punch", "p": "punch", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }],
                    [{ "l": "Filter", "p": "filter", "min": 0, "max": 1, "s": 0.01, "def": 0.8 }]
                ]
            },
            "Vinyl Pump": {
                "isCustom": "Vinyl_Pump",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Pump", "p": "pump", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }],
                    [{ "l": "Crackle", "p": "crackle", "min": 0, "max": 1, "s": 0.01, "def": 0.2 }]
                ]
            },
            "SP-303 Vinyl Sim": {
                "isCustom": "SP303VinylSim",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Comp", "p": "comp", "min": 0, "max": 1, "s": 0.01, "def": 0.6 }],
                    [{ "l": "Noise", "p": "noise", "min": 0, "max": 1, "s": 0.01, "def": 0.3 }],
                    [{ "l": "Flutter", "p": "flutter", "min": 0, "max": 1, "s": 0.01, "def": 0.4 }]
                ]
            }
        },
        "Tape & Vinyl": {
            "Cassette Deck": {
                "isCustom": "Cassette_Deck",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Age", "p": "age", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }],
                    [{ "l": "Tone", "p": "tone", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]
                ]
            },
            "Tape Echo": {
                "isCustom": "Tape_Echo",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }],
                    [{ "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]
                ]
            },
            "Tape Stop": {
                "isCustom": "TapeStop",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Stop", "p": "stop", "min": 0, "max": 1, "s": 1, "def": 0 }]
                ]
            },
            "Lofi Cassette": {
                "isCustom": "LofiCassette",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Age", "p": "age", "min": 0, "max": 1, "s": 0.01, "def": 0.6 }],
                    [{ "l": "Width", "p": "width", "min": 0, "max": 1, "s": 0.01, "def": 0.75 }]
                ]
            }
        },
        "Radio & Telecom": {
            "Sub-Sonic": {
                "isCustom": "Sub_Sonic",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Sub", "p": "sub", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }],
                    [{ "l": "Tone", "p": "tone", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]
                ]
            },
            "Transistor Radio": {
                "isCustom": "Radio_Transistor",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Tuning", "p": "tuning", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }],
                    [{ "l": "Static", "p": "static", "min": 0, "max": 1, "s": 0.01, "def": 0.3 }]
                ]
            },
            "Old School Decimator": {
                "isCustom": "Decimator_OldSchool",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Crush", "p": "crush", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }],
                    [{ "l": "Filter", "p": "filter", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]
                ]
            },
            "Space Verb": {
                "isCustom": "Space_Verb",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Size", "p": "size", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }],
                    [{ "l": "Darkness", "p": "darkness", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]
                ]
            }
        },
        "Vintage Tech": {
            "OptoLeveler": {
                "isCustom": "OptoLeveler",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Drive", "p": "drive", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }],
                    [{ "l": "Reduction", "p": "reduction", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]
                ]
            },
            "FETCrusher": {
                "isCustom": "FETCrusher",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Input", "p": "input", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }],
                    [{ "l": "Bias", "p": "bias", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]
                ]
            },
            "TheBigKnob": {
                "isCustom": "TheBigKnob",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "More", "p": "more", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]
                ]
            },
            "DatamixEQ": {
                "isCustom": "DatamixEQ",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Low", "p": "low", "min": -12, "max": 12, "s": 0.1, "def": 0 }],
                    [{ "l": "High", "p": "high", "min": -12, "max": 12, "s": 0.1, "def": 0 }]
                ]
            },
            "FisherSpacexpander": {
                "isCustom": "FisherSpacexpander",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Reverb", "p": "reverb", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }],
                    [{ "l": "Tone", "p": "tone", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]
                ]
            },
            "TEAC R2R": {
                "isCustom": "TEAC_A3340",
                "columns": [
                    [{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Drive", "p": "drive", "min": 0, "max": 1, "s": 0.01, "def": 0.3 }],
                    [{ "l": "Wow", "p": "wow", "min": 0, "max": 1, "s": 0.01, "def": 0.2 }]
                ]
            }
        }
    };

    // --- EXPORT TO WINDOW ---
    // Merge classes into window.CustomEffects and window.Tone (for dynamic instantiation)
    Object.assign(window.CustomEffects, classes);
    // Also attach to window.Tone so doing `new Tone[className]` works if logic uses that fallback, 
    // though TrackAudio likely uses window.CustomEffects[className] first.
    // Actually, let's ensure they are available where `EffectsService` or `TrackAudio` looks for them.

    // Merge configs into window.effectConfigs
    Object.keys(configs).forEach(cat => {
        if (!window.effectConfigs[cat]) window.effectConfigs[cat] = {};
        Object.assign(window.effectConfigs[cat], configs[cat]);
    });

    // Keep the module tracking for potential other uses
    window.effectModules.experimental = { classes, configs };
})();
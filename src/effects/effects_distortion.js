/*
 * Filename: effects_distortion.js
 * Version: NOV25_AntiGravity Version 1.0
 * Date: November 25, 2025
 * Time: 16:34 CST
 * Description: Distortion effects implementation.
 */
if (typeof window.effectModules === 'undefined') { window.effectModules = {}; }
if (typeof window.AppSource === 'undefined') { window.AppSource = {}; }

// --- REQUIRED BLOCK FOR DYNAMIC BUILD ---
if (typeof window.saveModuleSource === 'function') {
    window.saveModuleSource('effects_distortion.js');
}
window.AppSource['effects_distortion.js'] = `// [Full source code string for effects_distortion.js v43.4]`;

// Actual module code
(() => {
    const { EffectBase } = window;
    const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

    class DallasRangemaster extends EffectBase {
        constructor() {
            super("DallasRangemaster");
            // Authentic Rangemaster: HP filter at ~2.6kHz, peaking boost at 3.5kHz
            // Germanium OC44 transistor adds even harmonics (warmth)
            this.nodes.inputFilter = new Tone.Filter({ frequency: 2600, type: 'highpass', rolloff: -12 });
            this.nodes.boost = new Tone.Filter({ type: 'peaking', frequency: 3500, Q: 0.7, gain: 10 });
            // Germanium transistor warmth - adds 2nd order harmonics
            this.nodes.warmth = new Tone.Chebyshev(2);
            this.nodes.warmth.wet.value = 0.3; // Subtle warmth, not harsh
            // Slight low-end presence (Rangemaster doesn't completely cut bass)
            this.nodes.presenceBoost = new Tone.Filter({ type: 'lowshelf', frequency: 400, gain: 2 });

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.inputFilter, this.nodes.warmth, this.nodes.boost, this.nodes.presenceBoost, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.inputFilter, this.nodes.boost, this.nodes.warmth, this.nodes.presenceBoost);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.boost !== undefined) {
                // Boost affects both the peaking gain and harmonic content
                this.nodes.boost.gain.setTargetAtTime(params.boost, now, 0.01);
                // Higher boost = more germanium saturation
                this.nodes.warmth.wet.setTargetAtTime(Math.min(0.1 + (params.boost / 20) * 0.4, 0.5), now, 0.01);
            }
            if (params.range !== undefined) {
                // Range control shifts the HP filter frequency (treble to full-range)
                // Original 5nF = 2.6kHz, 22nF = ~600Hz (full range)
                const freq = 2600 - (params.range * 2000);
                this.nodes.inputFilter.frequency.setTargetAtTime(Math.max(600, freq), now, 0.01);
            }
            if (params.level !== undefined) this.wet.gain.setTargetAtTime(params.level, now, 0.01);
        }
    }
    class BossDS1 extends EffectBase {
        constructor() {
            super("BossDS1");
            // Boss DS-1: Transistor boost -> Op-amp gain -> Hard clipping diodes -> Tone stack
            // Pre-boost stage attenuates below 33Hz
            this.nodes.preBoost = new Tone.Filter({ frequency: 33, type: 'highpass' });
            this.nodes.distortion = new Tone.Distortion({ distortion: 0.9 }); // Hard clipping

            // DS-1 Tone Stack is a blend between LP and HP filters with an inherent mid-scoop at 500Hz
            this.nodes.lowpass = new Tone.Filter({ frequency: 234, type: 'lowpass' });
            this.nodes.highpass = new Tone.Filter({ frequency: 1064, type: 'highpass' });
            this.nodes.midScoop = new Tone.Filter({ frequency: 500, Q: 0.4, type: 'peaking', gain: -8 });
            this.nodes.toneBlend = new Tone.CrossFade(0.5);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.preBoost, this.nodes.distortion, this.nodes.midScoop);
            this.nodes.midScoop.fan(this.nodes.lowpass, this.nodes.highpass);
            this.nodes.lowpass.connect(this.nodes.toneBlend.a);
            this.nodes.highpass.connect(this.nodes.toneBlend.b);
            this.nodes.toneBlend.connect(this.nodes.stereoWidener);

            this._disposables.push(this.nodes.preBoost, this.nodes.distortion, this.nodes.lowpass, this.nodes.highpass, this.nodes.midScoop, this.nodes.toneBlend);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.tone !== undefined) {
                // Map tone parameter to the crossfade between LP and HP paths
                // In our config it's 200 to 4000, but the blend is 0 to 1
                const blend = (params.tone - 200) / 3800;
                this.nodes.toneBlend.fade.setTargetAtTime(blend, now, 0.01);
                // The mid-scoop depth varies slightly with tone focus
                const scoopDepth = -8 - (Math.abs(blend - 0.5) * 4);
                this.nodes.midScoop.gain.setTargetAtTime(scoopDepth, now, 0.01);
            }
            if (params.dist !== undefined) this.nodes.distortion.distortion = params.dist;
            if (params.level !== undefined) this.wet.gain.setTargetAtTime(params.level, now, 0.01);
        }
    }
    class MarshallGuvnor extends EffectBase {
        constructor() {
            super("MarshallGuvnor");
            this.nodes.dist = new Tone.Distortion({ distortion: 0.4 });
            this.nodes.bass = new Tone.Filter({ type: 'lowshelf', frequency: 200 });
            this.nodes.mid = new Tone.Filter({ frequency: 1000, Q: 1, type: 'peaking' });
            this.nodes.treble = new Tone.Filter({ type: 'highshelf', frequency: 4000 });
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.dist, this.nodes.bass, this.nodes.mid, this.nodes.treble, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.dist, this.nodes.bass, this.nodes.mid, this.nodes.treble);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.gain !== undefined) this.nodes.dist.distortion = params.gain;
            if (params.bass !== undefined) this.nodes.bass.gain.setTargetAtTime(params.bass, now, 0.01);
            if (params.mid !== undefined) this.nodes.mid.gain.setTargetAtTime(params.mid, now, 0.01);
            if (params.treble !== undefined) this.nodes.treble.gain.setTargetAtTime(params.treble, now, 0.01);
            if (params.level !== undefined) this.wet.gain.setTargetAtTime(params.level, now, 0.01);
        }
    }
    class MXRDistortionPlus extends EffectBase {
        constructor() {
            super("MXRDistortionPlus");
            // Authentic MXR Distortion+ (1973): LM741 Op-Amp -> 1N270 Germanium diodes to ground.
            // Characteristics: low output volume due to Ge diodes (clip at ~0.3V), 
            // fuzzy/hard-clipping at high gain, bass roll-off as gain increases.
            
            this.nodes.inputGain = new Tone.Gain(1);
            
            // Low frequencies are progressively cut at higher gains in the original circuit
            this.nodes.preFilter = new Tone.Filter({ frequency: 100, type: 'highpass' });

            const curveLength = 4096;
            const curve = new Float32Array(curveLength);
            for (let i = 0; i < curveLength; i++) {
                let x = (i / 2048) - 1;
                // Germanium hard clipping to ground (~0.3V)
                // It clips hard, but the knee is slightly softer than silicon
                let sign = Math.sign(x);
                let absX = Math.abs(x);
                // Hard wall at 0.4, soft knee leading up to it
                if (absX > 0.4) {
                    curve[i] = sign * (0.4 + (absX - 0.4) * 0.1); 
                } else {
                    curve[i] = x;
                }
            }
            this.nodes.clipper = new Tone.WaveShaper(curve);
            this.nodes.postFilter = new Tone.Filter({ frequency: 6000, type: 'lowpass', rolloff: -12 }); // tame highs
            this.nodes.output = new Tone.Gain(2); // Make up for Ge diode volume loss

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.preFilter, this.nodes.inputGain, this.nodes.clipper, this.nodes.postFilter, this.nodes.output, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.preFilter, this.nodes.inputGain, this.nodes.clipper, this.nodes.postFilter, this.nodes.output);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.distortion !== undefined) {
                // Distortion knob adjusts op-amp gain (up to ~200x in original, we'll scale it)
                this.nodes.inputGain.gain.setTargetAtTime(1 + (params.distortion * 50), now, 0.01);
                // Pre-filter shifts up slightly at higher gain
                this.nodes.preFilter.frequency.setTargetAtTime(100 + (params.distortion * 200), now, 0.01);
            }
            if (params.output !== undefined) {
                // Output knob
                this.nodes.output.gain.setTargetAtTime(params.output * 3, now, 0.01);
            }
        }
    }
    class ProCoRAT extends EffectBase {
        constructor() {
            super("ProCoRAT");
            // ProCo RAT: Op-amp gain -> Slew-rate limiting -> Hard clipping diodes -> Passive filter
            // Key character: The LM308 op-amp has poor slew rate, acting as a dynamic low-pass at high gain.

            this.nodes.preGain = new Tone.Gain(1);

            // Slew Rate Limiter: Simulating the inability to track high freqs at high gain
            this.nodes.slewLimiter = new Tone.Filter({ frequency: 20000, type: 'lowpass', rolloff: -12 });

            // RAT Clipping: Hard clipping to ground, but smooths out into fuzz at max
            // We'll use a WaveShaper for more control than Tone.Distortion
            const curve = new Float32Array(4096);
            for (let i = 0; i < 4096; i++) {
                const x = (i / 2048) - 1;
                // Hard clipping with slightly soft corners
                curve[i] = Math.tanh(x * 10);
            }
            this.nodes.clipper = new Tone.WaveShaper(curve);

            this.nodes.filter = new Tone.Filter({ frequency: 2000, type: 'lowpass', rolloff: -12 }); // Passive tone filter

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.preGain, this.nodes.slewLimiter, this.nodes.clipper, this.nodes.filter, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.preGain, this.nodes.slewLimiter, this.nodes.clipper, this.nodes.filter);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.distortion !== undefined) {
                const drive = params.distortion; // 0 to 1
                // Drive increases input gain into the clipper
                this.nodes.preGain.gain.setTargetAtTime(1 + (drive * 50), now, 0.01);

                // Emulate slew rate limiting: Filter closes down as gain increases
                const slewFreq = 20000 / (1 + (drive * 8)); // drops to ~2kHz at max drive
                this.nodes.slewLimiter.frequency.setTargetAtTime(slewFreq, now, 0.01);
            }
            if (params.filter !== undefined) {
                // Filter knob is a reverse-acting low-pass filter
                // 0 = Bright (Max Freq), 1 = Dark (Min Freq)
                // RAT Filter is ~100kHz down to ~500Hz
                const val = 1 - params.filter; // 1 = Bright
                // Logarithmic-ish sweep
                const filterFreq = 500 + (Math.pow(val, 2) * 15000);
                this.nodes.filter.frequency.setTargetAtTime(filterFreq, now, 0.01);
            }
            if (params.volume !== undefined) this.wet.gain.setTargetAtTime(params.volume, now, 0.01);
        }
    }
    class BaldwinBurnsBuzzaround extends EffectBase {
        constructor() {
            super("BaldwinBurnsBuzzaround");
            this.nodes.fuzz = new Tone.Distortion(0.85);
            this.nodes.timbre = new Tone.Filter({ frequency: 1200, type: 'peaking' });
            this.nodes.balance = new Tone.Gain(1);
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.fuzz, this.nodes.timbre, this.nodes.balance, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.fuzz, this.nodes.timbre, this.nodes.balance);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.sustain !== undefined) this.nodes.fuzz.distortion = params.sustain;
            if (params.timbre !== undefined) this.nodes.timbre.frequency.setTargetAtTime(params.timbre, now, 0.01);
            if (params.balance !== undefined) this.wet.gain.setTargetAtTime(params.balance, now, 0.01);
        }
    }
    class BigMuffPi extends EffectBase {
        constructor() {
            super("BigMuffPi");
            // EHX Big Muff Pi: Authentic 4-stage transistor architecture
            // Stage 1: Input booster (common emitter with negative feedback)
            // Stage 2 & 3: Double clipping stages with back-to-back diodes
            // Stage 4: Output booster + Passive tone control

            // Input Boost Stage (Q1) - adds initial gain and warmth
            this.nodes.inputBoost = new Tone.Gain(2);
            this.nodes.inputSat = new Tone.Chebyshev(2);
            this.nodes.inputSat.wet.value = 0.3;

            // Clipping Stage 1 (Q2) - soft clip with feedback diodes
            // Big Muff uses back-to-back silicon diodes (1N914) ~0.6V threshold
            const clipCurve1 = new Float32Array(4096);
            for (let i = 0; i < 4096; i++) {
                const x = (i / 2048) - 1;
                // Soft clipping characteristic of diodes in feedback loop
                clipCurve1[i] = Math.tanh(x * 3) * 0.9;
            }
            this.nodes.clip1 = new Tone.WaveShaper(clipCurve1);
            this.nodes.clip1Filter = new Tone.Filter({ frequency: 1200, type: 'lowpass', rolloff: -12 }); // Bandwidth limiting

            // Clipping Stage 2 (Q3) - cascaded for harder clipping
            const clipCurve2 = new Float32Array(4096);
            for (let i = 0; i < 4096; i++) {
                const x = (i / 2048) - 1;
                // Second stage clips harder, creating more sustain
                clipCurve2[i] = Math.tanh(x * 5) * 0.85;
            }
            this.nodes.clip2 = new Tone.WaveShaper(clipCurve2);
            this.nodes.clip2Filter = new Tone.Filter({ frequency: 1000, type: 'lowpass', rolloff: -12 });

            // Passive Tone Control - iconic mid-scoop at ~1kHz
            // Low path and high path blended by tone pot
            this.nodes.lowpath = new Tone.Filter({ frequency: 400, type: 'lowpass', rolloff: -24 });
            this.nodes.highpath = new Tone.Filter({ frequency: 2500, type: 'highpass', rolloff: -24 });
            this.nodes.toneBlend = new Tone.CrossFade(0.5);

            // Output stage bandwidth limiting (authentic 90Hz-1.2kHz)
            this.nodes.outputHP = new Tone.Filter({ frequency: 90, type: 'highpass', rolloff: -12 });
            this.nodes.outputLP = new Tone.Filter({ frequency: 3500, type: 'lowpass', rolloff: -12 });

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(
                this.nodes.inputBoost,
                this.nodes.inputSat,
                this.nodes.clip1,
                this.nodes.clip1Filter,
                this.nodes.clip2,
                this.nodes.clip2Filter,
                this.nodes.outputHP
            );

            // Tone stack blend
            this.nodes.outputHP.fan(this.nodes.lowpath, this.nodes.highpath);
            this.nodes.lowpath.connect(this.nodes.toneBlend.a);
            this.nodes.highpath.connect(this.nodes.toneBlend.b);
            this.nodes.toneBlend.chain(this.nodes.outputLP, this.nodes.stereoWidener);

            this._disposables.push(
                this.nodes.inputBoost, this.nodes.inputSat,
                this.nodes.clip1, this.nodes.clip1Filter,
                this.nodes.clip2, this.nodes.clip2Filter,
                this.nodes.lowpath, this.nodes.highpath, this.nodes.toneBlend,
                this.nodes.outputHP, this.nodes.outputLP
            );
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.sustain !== undefined) {
                // Sustain controls input gain into clipping stages
                const gain = 1 + (params.sustain * 8);
                this.nodes.inputBoost.gain.setTargetAtTime(gain, now, 0.01);
                // Also increases saturation blend
                this.nodes.inputSat.wet.setTargetAtTime(0.2 + params.sustain * 0.4, now, 0.01);
            }
            if (params.tone !== undefined) {
                // Tone: map frequency value to blend position
                // Config uses 200-2000, normalize to 0-1
                const blend = Math.max(0, Math.min(1, (params.tone - 200) / 1800));
                this.nodes.toneBlend.fade.setTargetAtTime(blend, now, 0.01);
            }
            if (params.volume !== undefined) {
                this.wet.gain.setTargetAtTime(params.volume, now, 0.01);
            }
        }
    }
    class FuzzFace extends EffectBase {
        constructor() {
            super("FuzzFace");
            // Authentic Fuzz Face: Two-stage germanium PNP transistor circuit
            // Creates asymmetric soft clipping (more compression on one half-cycle)

            // Create asymmetric soft-clipping curve (germanium characteristic)
            const curveLength = 4096;
            const asymCurve = new Float32Array(curveLength);
            for (let i = 0; i < curveLength; i++) {
                const x = (i / (curveLength / 2)) - 1; // -1 to 1
                // Asymmetric soft clipping: negative side clips harder
                if (x < 0) {
                    // Sharper negative clipping (simulates biased transistor)
                    asymCurve[i] = Math.tanh(x * 2.5) * 0.85;
                } else {
                    // Softer positive clipping with more headroom
                    asymCurve[i] = Math.tanh(x * 1.5);
                }
            }

            this.nodes.inputGain = new Tone.Gain(1.5); // Input stage boost
            this.nodes.asymClipper = new Tone.WaveShaper(asymCurve);
            // Germanium transistors add even harmonics (warmth)
            this.nodes.geWarmth = new Tone.Chebyshev(2);
            this.nodes.geWarmth.wet.value = 0.4;
            // Output is softened by rolling off extreme highs
            this.nodes.outputFilter = new Tone.Filter({ frequency: 4500, type: 'lowpass', rolloff: -12 });
            // Slight mid boost (Fuzz Face character)
            this.nodes.midBoost = new Tone.Filter({ type: 'peaking', frequency: 800, Q: 0.8, gain: 3 });

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.inputGain, this.nodes.asymClipper, this.nodes.geWarmth, this.nodes.outputFilter, this.nodes.midBoost, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.inputGain, this.nodes.asymClipper, this.nodes.geWarmth, this.nodes.outputFilter, this.nodes.midBoost);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.fuzz !== undefined) {
                // Fuzz control affects input gain (gain stage) and harmonic saturation
                const fuzzGain = 0.5 + (params.fuzz * 3); // 0.5x to 3.5x gain
                this.nodes.inputGain.gain.setTargetAtTime(fuzzGain, now, 0.01);
                // More fuzz = more germanium character
                this.nodes.geWarmth.wet.setTargetAtTime(0.2 + (params.fuzz * 0.5), now, 0.01);
            }
            if (params.volume !== undefined) this.wet.gain.setTargetAtTime(params.volume, now, 0.01);
            if (params.bias !== undefined) {
                // Bias affects the mid boost frequency (simulates transistor bias point)
                const biasFreq = 600 + (params.bias * 600); // 600Hz to 1200Hz
                this.nodes.midBoost.frequency.setTargetAtTime(biasFreq, now, 0.01);
            }
        }
    }
    class MaestroFuzzToneFZ1 extends EffectBase {
        constructor() {
            super("MaestroFuzzToneFZ1");
            // Authentic FZ-1: 1.5V battery, 3 Germanium transistors.
            // Characteristics: Bias-starved, heavily gated, spitty decay, thin bass.
            
            this.nodes.inputFilter = new Tone.Filter({ frequency: 400, type: 'highpass', rolloff: -12 });
            this.nodes.gain = new Tone.Gain(10);
            
            const curveLength = 4096;
            const curve = new Float32Array(curveLength);
            for (let i = 0; i < curveLength; i++) {
                let x = (i / 2048) - 1;
                // Bias starvation / Gating: signals close to 0 don't pass
                if (Math.abs(x) < 0.03) {
                    curve[i] = 0;
                } else {
                    // Extreme asymmetric hard clipping (Germanium 1.5V limits)
                    if (x > 0) {
                        curve[i] = Math.min(x * 5, 0.6); // Hard clip at low voltage
                    } else {
                        curve[i] = Math.max(x * 2, -0.2); // Very asymmetric
                    }
                }
            }
            this.nodes.clipper = new Tone.WaveShaper(curve);
            this.nodes.toneFilter = new Tone.Filter({ frequency: 2000, type: 'lowpass' });
            this.nodes.output = new Tone.Gain(1);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.inputFilter, this.nodes.gain, this.nodes.clipper, this.nodes.toneFilter, this.nodes.output, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.inputFilter, this.nodes.gain, this.nodes.clipper, this.nodes.toneFilter, this.nodes.output);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.attack !== undefined) {
                // Attack controls the fuzz depth
                this.nodes.gain.gain.setTargetAtTime(1 + (params.attack * 20), now, 0.01);
            }
            if (params.volume !== undefined) this.nodes.output.gain.setTargetAtTime(params.volume, now, 0.01);
            if (params.toneMode !== undefined) {
                // FZ-1 was very trebly, later versions had more bass
                this.nodes.inputFilter.frequency.setTargetAtTime(params.toneMode > 0.5 ? 200 : 600, now, 0.01);
            }
        }
    }
    class OpAmpMuff extends BigMuffPi { constructor() { super(); this.name = "OpAmpMuff"; } }
    class RamsHeadMuff extends BigMuffPi { constructor() { super(); this.name = "RamsHeadMuff"; } }
    class RussianMuff extends BigMuffPi { constructor() { super(); this.name = "RussianMuff"; } }
    class ToneBender extends FuzzFace { constructor() { super(); this.name = "ToneBender"; } }
    class SolaSoundToneBenderMKI extends EffectBase {
        constructor() {
            super("SolaSoundToneBenderMKI");
            this.nodes.fuzz = new Tone.Distortion({ distortion: 0.9 });
            this.nodes.filter = new Tone.Filter({ frequency: 800, type: 'lowpass' });
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.fuzz, this.nodes.filter, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.fuzz, this.nodes.filter);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.attack !== undefined) this.nodes.fuzz.distortion = params.attack;
            if (params.level !== undefined) this.wet.gain.setTargetAtTime(params.level, now, 0.01);
        }
    }
    class SolaSoundToneBenderMK15 extends FuzzFace { constructor() { super(); this.name = "SolaSoundToneBenderMK15"; } }
    class AmpegScrambler extends EffectBase {
        constructor() {
            super("AmpegScrambler");
            // Authentic Ampeg Scrambler (1969): Full-wave rectification for octave-up fuzz.
            // No digital pitch shifting! It uses a phase splitter and differential amp to rectify the signal.
            this.nodes.inputBoost = new Tone.Gain(5);
            
            const curve = new Float32Array(4096);
            for (let i = 0; i < 4096; i++) {
                let x = (i / 2048) - 1;
                // Full wave rectification: folding the negative half up
                // Then clipping it heavily for the Scrambler's harsh fuzz tone
                let rectified = Math.abs(x);
                // Scrambler has a gating effect on the decay
                if (rectified < 0.05) rectified = 0; 
                curve[i] = Math.tanh(rectified * 5) * 2 - 1; // Center it back
            }
            this.nodes.rectifier = new Tone.WaveShaper(curve);
            
            // Texture acts as a filter/fuzz mix in some clones, but originally it controls the octave intensity
            this.nodes.textureFilter = new Tone.Filter({ frequency: 2000, type: 'lowpass' });
            
            this.nodes.blend = new Tone.CrossFade(0.5);
            this.nodes.outputLevel = new Tone.Gain(1);

            this.wet.disconnect(this.nodes.stereoWidener);
            
            // Dry path (clean) -> Blend A
            this.wet.connect(this.nodes.blend.a);
            
            // Wet path -> Rectifier -> Filter -> Blend B
            this.wet.chain(this.nodes.inputBoost, this.nodes.rectifier, this.nodes.textureFilter, this.nodes.blend.b);
            
            this.nodes.blend.chain(this.nodes.outputLevel, this.nodes.stereoWidener);
            
            this._disposables.push(this.nodes.inputBoost, this.nodes.rectifier, this.nodes.textureFilter, this.nodes.blend, this.nodes.outputLevel);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.texture !== undefined) {
                // Texture drives the rectifier harder and opens up highs
                this.nodes.inputBoost.gain.setTargetAtTime(1 + (params.texture * 10), now, 0.01);
                this.nodes.textureFilter.frequency.setTargetAtTime(500 + (params.texture * 4000), now, 0.01);
            }
            if (params.blend !== undefined) this.nodes.blend.fade.setTargetAtTime(params.blend, now, 0.01);
            if (params.level !== undefined) this.nodes.outputLevel.gain.setTargetAtTime(params.level, now, 0.01);
        }
    }
    class BossSD1 extends EffectBase {
        constructor() {
            super("BossSD1");
            // SD-1: Asymmetric Soft Clipping
            // This creates a "tube-like" response with even order harmonics.

            const curve = new Float32Array(4096);
            for (let i = 0; i < 4096; i++) {
                const x = (i / 2048) - 1;
                if (x > 0) {
                    // Positive side: Soft clipping
                    curve[i] = Math.tanh(x * 2);
                } else {
                    // Negative side: Harder/Different clipping (Asymmetry)
                    curve[i] = Math.tanh(x * 4) * 0.8;
                }
            }
            this.nodes.clipper = new Tone.WaveShaper(curve);
            this.nodes.preGain = new Tone.Gain(1);

            this.nodes.tone = new Tone.Filter({ frequency: 3200, type: 'lowpass' });

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.preGain, this.nodes.clipper, this.nodes.tone, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.preGain, this.nodes.clipper, this.nodes.tone);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.drive !== undefined) {
                // Drive pushes signal into the fixed asymmetric curve
                this.nodes.preGain.gain.setTargetAtTime(1 + (params.drive * 10), now, 0.01);
            }
            if (params.tone !== undefined) {
                // Tone control (Lowpass)
                this.nodes.tone.frequency.setTargetAtTime(params.tone, now, 0.01);
            }
            if (params.level !== undefined) this.wet.gain.setTargetAtTime(params.level * 2, now, 0.01); // Boost level
        }
    }
    class FulltoneOCD extends EffectBase {
        constructor() {
            super("FulltoneOCD");
            this.nodes.dist = new Tone.Distortion({ distortion: 0.5 });
            this.nodes.tone = new Tone.Filter({ frequency: 5000, type: 'lowpass' });
            this.nodes.hpFilter = new Tone.Filter({ frequency: 100, type: 'highpass' });
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.hpFilter, this.nodes.dist, this.nodes.tone, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.dist, this.nodes.tone, this.nodes.hpFilter);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.drive !== undefined) this.nodes.dist.distortion = params.drive;
            if (params.tone !== undefined) this.nodes.tone.frequency.setTargetAtTime(params.tone, now, 0.01);
            if (params.level !== undefined) this.wet.gain.setTargetAtTime(params.level, now, 0.01);
            if (params.hp !== undefined) this.nodes.hpFilter.frequency.setTargetAtTime(params.hp > 0.5 ? 300 : 100, now, 0.01);
        }
    }
    class IbanezTS808 extends EffectBase {
        constructor() {
            // Ibanez TS-808 Tube Screamer (1979-1982)
            // JRC4558D op-amp (dual, industry standard)
            // 1N914 silicon clipping diodes in feedback loop (symmetric)
            // Famous "mid-hump" at ~720Hz from highpass in feedback
            // Controls: Drive, Tone, Level
            super("IbanezTS808");
            this._params = { drive: 0.4, tone: 3000, level: 1 };

            // Input buffer (2SC1815 transistor in original)
            this.nodes.inputBuffer = new Tone.Gain(1);

            // The famous mid-hump: Highpass in feedback causes bass attenuation
            // This creates the characteristic "pushed mids" sound
            this.nodes.midHump = new Tone.Filter({ frequency: 720, type: 'peaking', Q: 1, gain: 0 });

            // Pre-gain stage (JRC4558 gain)
            this.nodes.preGain = new Tone.Gain(1);

            // Symmetric soft clipping (1N914 diodes, ~0.5-0.6V forward voltage)
            // Creates smooth, compressed clipping
            const curve = new Float32Array(4096);
            for (let i = 0; i < 4096; i++) {
                const x = (i / 2048) - 1;
                // Smooth tanh curve (approximates diode soft clip)
                curve[i] = Math.tanh(x * 1.5);
            }
            this.nodes.clipper = new Tone.WaveShaper(curve);

            // Output lowpass filter (tone control)
            // TS-808 has a simple passive RC lowpass
            this.nodes.tone = new Tone.Filter({ frequency: 3000, type: 'lowpass', rolloff: -12 });

            // Output high-pass (removes DC offset and ultra-lows)
            this.nodes.outputHP = new Tone.Filter({ frequency: 100, type: 'highpass', rolloff: -12 });

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(
                this.nodes.inputBuffer,
                this.nodes.midHump,
                this.nodes.preGain,
                this.nodes.clipper,
                this.nodes.tone,
                this.nodes.outputHP,
                this.nodes.stereoWidener
            );
            this._disposables.push(
                this.nodes.inputBuffer, this.nodes.midHump, this.nodes.preGain,
                this.nodes.clipper, this.nodes.tone, this.nodes.outputHP
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.drive !== undefined) {
                this._params.drive = params.drive;
                // Drive increases gain into clipper
                this.nodes.preGain.gain.setTargetAtTime(1 + (params.drive * 10), now, 0.01);
                // Also increases mid-hump intensity (more mids being driven)
                this.nodes.midHump.gain.setTargetAtTime(params.drive * 12, now, 0.01);
            }

            if (params.tone !== undefined) {
                this._params.tone = params.tone;
                this.nodes.tone.frequency.setTargetAtTime(params.tone, now, 0.01);
            }

            if (params.level !== undefined) {
                this._params.level = params.level;
                this.wet.gain.setTargetAtTime(params.level, now, 0.01);
            }
        }
    }

    class IbanezTS808FlyingFingers extends IbanezTS808 { constructor() { super(); this.name = "IbanezTS808FlyingFingers"; } }
    class IbanezTS808NarrowBox extends IbanezTS808 { constructor() { super(); this.name = "IbanezTS808NarrowBox"; } }

    class KlonCentaur extends EffectBase {
        constructor() {
            // Klon Centaur (1994)
            // Bill Finnegan's legendary "transparent" overdrive
            // 1N34A germanium diodes (~0.35V forward voltage, soft clipping)
            // ICL7660/MAX1044 charge pump (9V to 18V) for high headroom
            // Dual-gang pot: Clean signal decreases as dirty increases
            // Signature 1kHz mid-boost at higher gain settings
            super("KlonCentaur");
            this._params = { gain: 0.3, treble: 1000, output: 1 };

            // Input buffer (high impedance)
            this.nodes.inputBuffer = new Tone.Gain(1);

            // Clean path (stays full at low gain, decreases at high gain)
            this.nodes.cleanGain = new Tone.Gain(1);

            // Dirty path
            // Pre-gain with mid-boost (the Klon's "magic")
            this.nodes.midBoost = new Tone.Filter({ frequency: 1000, Q: 0.8, type: 'peaking', gain: 0 });

            // Germanium diode soft clipping (very soft, gradual onset)
            // Lower forward voltage = earlier clipping at lower voltages
            const geCurve = new Float32Array(4096);
            for (let i = 0; i < 4096; i++) {
                const x = (i / 2048) - 1;
                // Soft germanium curve (softer than silicon)
                geCurve[i] = Math.tanh(x * 0.8) * 0.9;
            }
            this.nodes.geClipper = new Tone.WaveShaper(geCurve);

            // Tone control (treble shelf)
            this.nodes.tone = new Tone.Filter({ type: 'highshelf', frequency: 1000, gain: 0 });

            // Blend crossfade (the dual-gang pot behavior)
            this.nodes.blend = new Tone.CrossFade(0.5);

            // Output level
            this.nodes.outputLevel = new Tone.Gain(1);

            this.wet.disconnect(this.nodes.stereoWidener);

            // Signal splits to clean and dirty paths
            this.wet.chain(this.nodes.inputBuffer);
            this.nodes.inputBuffer.fan(this.nodes.cleanGain, this.nodes.midBoost);

            // Clean path -> blend A
            this.nodes.cleanGain.connect(this.nodes.blend.a);

            // Dirty path: midBoost -> clipper -> blend B
            this.nodes.midBoost.chain(this.nodes.geClipper, this.nodes.blend.b);

            // Blend -> tone -> output
            this.nodes.blend.chain(this.nodes.tone, this.nodes.outputLevel, this.nodes.stereoWidener);

            this._disposables.push(
                this.nodes.inputBuffer, this.nodes.cleanGain, this.nodes.midBoost,
                this.nodes.geClipper, this.nodes.tone, this.nodes.blend, this.nodes.outputLevel
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.gain !== undefined) {
                this._params.gain = params.gain;

                // Dual-gang behavior:
                // 1. Blend shifts from clean to dirty
                this.nodes.blend.fade.setTargetAtTime(params.gain, now, 0.01);

                // 2. Mid-boost increases with gain (the Klon "magic")
                this.nodes.midBoost.gain.setTargetAtTime(params.gain * 12, now, 0.01);

                // 3. Clean gain decreases as dirty increases
                this.nodes.cleanGain.gain.setTargetAtTime(1 - (params.gain * 0.3), now, 0.01);
            }

            if (params.treble !== undefined) {
                this._params.treble = params.treble;
                // Treble control is a high shelf centered around 1kHz
                const relativeTreble = (params.treble - 1000) / 9000;
                this.nodes.tone.gain.setTargetAtTime(relativeTreble * 15, now, 0.01);
            }

            if (params.output !== undefined) {
                this._params.output = params.output;
                this.nodes.outputLevel.gain.setTargetAtTime(params.output, now, 0.01);
            }
        }
    }

    const classes = { DallasRangemaster, BossDS1, MarshallGuvnor, MXRDistortionPlus, ProCoRAT, BaldwinBurnsBuzzaround, BigMuffPi, FuzzFace, MaestroFuzzToneFZ1, OpAmpMuff, RamsHeadMuff, RussianMuff, ToneBender, SolaSoundToneBenderMKI, SolaSoundToneBenderMK15, AmpegScrambler, BossSD1, FulltoneOCD, IbanezTS808, IbanezTS808FlyingFingers, IbanezTS808NarrowBox, KlonCentaur };
    const configs = { "Distortion": { "Boost: Dallas Rangemaster": { "isCustom": "DallasRangemaster", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Boost", "p": "boost", "min": 0, "max": 20, "s": 0.1, "def": 10 }, { "l": "Level", "p": "level", "min": 0, "max": 2, "s": 0.01, "def": 1 }]] }, "Distortion: Boss DS-1": { "isCustom": "BossDS1", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Tone", "p": "tone", "min": 200, "max": 4000, "s": 10, "def": 1500 }, { "l": "Dist", "p": "dist", "min": 0.1, "max": 1, "s": 0.01, "def": 0.9 }], [{ "l": "Level", "p": "level", "min": 0, "max": 2, "s": 0.01, "def": 1 }]] }, "Distortion: Marshall Guv'nor": { "isCustom": "MarshallGuvnor", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Gain", "p": "gain", "min": 0, "max": 1, "s": 0.01, "def": 0.4 }, { "l": "Bass", "p": "bass", "min": -10, "max": 10, "s": 0.1, "def": 0 }], [{ "l": "Mid", "p": "mid", "min": -10, "max": 10, "s": 0.1, "def": 0 }, { "l": "Treble", "p": "treble", "min": -10, "max": 10, "s": 0.1, "def": 0 }], [{ "l": "Level", "p": "level", "min": 0, "max": 2, "s": 0.01, "def": 1 }]] }, "Distortion: MXR D+": { "isCustom": "MXRDistortionPlus", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Distortion", "p": "distortion", "min": 0, "max": 1, "def": 0.6 }, { "l": "Output", "p": "output", "min": 0, "max": 2, "def": 1 }]] }, "Distortion: ProCo RAT": { "isCustom": "ProCoRAT", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Distortion", "p": "distortion", "min": 0, "max": 1, "s": 0.01, "def": 0.8 }, { "l": "Filter (Inv)", "p": "filter", "min": 0, "max": 1, "s": 0.01, "def": 0.8 }], [{ "l": "Volume", "p": "volume", "min": 0, "max": 2, "s": 0.01, "def": 1 }]] }, "Fuzz: Baldwin Burns Buzzaround": { "isCustom": "BaldwinBurnsBuzzaround", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Sustain", "p": "sustain", "min": 0.1, "max": 1, "def": 0.85 }, { "l": "Timbre", "p": "timbre", "min": 200, "max": 3000, "def": 1200 }], [{ "l": "Balance", "p": "balance", "min": 0, "max": 2, "def": 1 }]] }, "Fuzz: Big Muff Pi": { "isCustom": "BigMuffPi", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Sustain", "p": "sustain", "min": 0.1, "max": 1, "s": 0.01, "def": 0.6 }, { "l": "Tone", "p": "tone", "min": 200, "max": 2000, "def": 800 }], [{ "l": "Volume", "p": "volume", "min": 0, "max": 2, "def": 1 }]] }, "Fuzz: Fuzz Face": { "isCustom": "FuzzFace", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Fuzz", "p": "fuzz", "min": 0.5, "max": 1, "def": 0.8 }, { "l": "Volume", "p": "volume", "min": 0, "max": 2, "def": 1 }]] }, "Fuzz: Maestro FZ-1": { "isCustom": "MaestroFuzzToneFZ1", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Attack", "p": "attack", "min": 0.1, "max": 1, "def": 0.9 }, { "l": "Volume", "p": "volume", "min": 0, "max": 2, "def": 1 }], [{ "l": "Tone Mode", "p": "toneMode", "min": 0, "max": 1, "s": 1, "def": 0, "unit": " N/B" }]] }, "Fuzz: Op-Amp Muff": { "isCustom": "OpAmpMuff", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Sustain", "p": "sustain", "min": 0.1, "max": 1, "def": 0.6 }, { "l": "Tone", "p": "tone", "min": 200, "max": 2000, "def": 800 }], [{ "l": "Volume", "p": "volume", "min": 0, "max": 2, "def": 1 }]] }, "Fuzz: Ram's Head Muff": { "isCustom": "RamsHeadMuff", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Sustain", "p": "sustain", "min": 0.1, "max": 1, "def": 0.6 }, { "l": "Tone", "p": "tone", "min": 200, "max": 2000, "def": 800 }], [{ "l": "Volume", "p": "volume", "min": 0, "max": 2, "def": 1 }]] }, "Fuzz: Russian Muff": { "isCustom": "RussianMuff", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Sustain", "p": "sustain", "min": 0.1, "max": 1, "def": 0.6 }, { "l": "Tone", "p": "tone", "min": 200, "max": 2000, "def": 800 }], [{ "l": "Volume", "p": "volume", "min": 0, "max": 2, "def": 1 }]] }, "Fuzz: Sola Sound Tone Bender": { "isCustom": "ToneBender", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Fuzz", "p": "fuzz", "min": 0.5, "max": 1, "def": 0.8 }, { "l": "Volume", "p": "volume", "min": 0, "max": 2, "def": 1 }]] }, "Fuzz: Sola Sound Tone Bender MkI": { "isCustom": "SolaSoundToneBenderMKI", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Attack", "p": "attack", "min": 0.1, "max": 1, "def": 0.9 }, { "l": "Level", "p": "level", "min": 0, "max": 2, "def": 1 }]] }, "Fuzz: Sola Sound Tone Bender Mk1.5": { "isCustom": "SolaSoundToneBenderMK15", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Fuzz", "p": "fuzz", "min": 0.5, "max": 1, "def": 0.8 }, { "l": "Volume", "p": "volume", "min": 0, "max": 2, "def": 1 }]] }, "Octave: Ampeg Scrambler": { "isCustom": "AmpegScrambler", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Texture", "p": "texture", "min": 0.1, "max": 1, "def": 0.9 }, { "l": "Blend", "p": "blend", "min": 0, "max": 1, "def": 0.5 }], [{ "l": "Level", "p": "level", "min": 0, "max": 2, "def": 1 }]] }, "Overdrive: Boss SD-1": { "isCustom": "BossSD1", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Drive", "p": "drive", "min": 0, "max": 1, "def": 0.5 }, { "l": "Tone", "p": "tone", "min": 200, "max": 5000, "def": 3200 }], [{ "l": "Level", "p": "level", "min": 0, "max": 2, "def": 1 }]] }, "Overdrive: Fulltone OCD": { "isCustom": "FulltoneOCD", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Drive", "p": "drive", "min": 0, "max": 1, "def": 0.5 }, { "l": "Tone", "p": "tone", "min": 200, "max": 8000, "def": 5000 }], [{ "l": "Level", "p": "level", "min": 0, "max": 2, "def": 1 }, { "l": "HP", "p": "hp", "min": 0, "max": 1, "s": 1, "def": 0, "unit": " 100/300" }]] }, "Overdrive: Ibanez TS-808": { "isCustom": "IbanezTS808", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Drive", "p": "drive", "min": 0, "max": 1, "def": 0.4 }, { "l": "Tone", "p": "tone", "min": 200, "max": 5000, "def": 3000 }], [{ "l": "Level", "p": "level", "min": 0, "max": 2, "def": 1 }]] }, "Overdrive: Ibanez TS-808 (Flying Fingers)": { "isCustom": "IbanezTS808FlyingFingers", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Drive", "p": "drive", "min": 0, "max": 1, "def": 0.4 }, { "l": "Tone", "p": "tone", "min": 200, "max": 5000, "def": 3000 }], [{ "l": "Level", "p": "level", "min": 0, "max": 2, "def": 1 }]] }, "Overdrive: Ibanez TS-808 (Narrow Box)": { "isCustom": "IbanezTS808NarrowBox", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Drive", "p": "drive", "min": 0, "max": 1, "def": 0.4 }, { "l": "Tone", "p": "tone", "min": 200, "max": 5000, "def": 3000 }], [{ "l": "Level", "p": "level", "min": 0, "max": 2, "def": 1 }]] }, "Overdrive: Klon Centaur": { "isCustom": "KlonCentaur", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Gain", "p": "gain", "min": 0, "max": 1, "def": 0.3 }, { "l": "Treble", "p": "treble", "min": 200, "max": 10000, "def": 1000 }], [{ "l": "Output", "p": "output", "min": 0, "max": 2, "def": 1 }]] } } };
    window.effectModules.distortion = { classes, configs };
})();
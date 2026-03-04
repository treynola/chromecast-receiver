/*
 * Filename: effects_compressor.js
 * Version: NOV25_AntiGravity Version 1.0
 * Date: November 25, 2025
 * Time: 16:32 CST
 * Description: Compressor effects implementation.
 */
if (typeof window.effectModules === 'undefined') { window.effectModules = {}; }
if (typeof window.AppSource === 'undefined') { window.AppSource = {}; }

// --- REQUIRED BLOCK FOR DYNAMIC BUILD ---
if (typeof window.saveModuleSource === 'function') {
    window.saveModuleSource('effects_compressor.js');
}
window.AppSource['effects_compressor.js'] = `// [Full source code string for effects_compressor.js v43.4]`;

// Actual module code
(() => {
    const { EffectBase } = window;
    const mapSustain = (val, min, max) => Math.max(min, Math.min(max - (val * (max - min)), max));

    class BossCS1 extends EffectBase {
        constructor() {
            super("BossCS1");
            this.nodes.comp = new Tone.Compressor({ threshold: -25, ratio: 6, attack: 0.02, release: 0.1 });
            this.nodes.treble = new Tone.Filter({ type: 'highshelf', frequency: 3000, gain: 0 });
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.comp, this.nodes.treble, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.comp, this.nodes.treble);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.sustain !== undefined) {
                this.nodes.comp.threshold.setTargetAtTime(mapSustain(params.sustain, -40, 0), now, 0.01);
            }
            if (params.level !== undefined) this.wet.gain.setTargetAtTime(params.level, now, 0.01);
            if (params.mode !== undefined) {
                this.nodes.treble.gain.setTargetAtTime(params.mode > 0.5 ? 10 : 0, now, 0.01);
            }
        }
    }
    class MXRDynaComp extends EffectBase {
        constructor() {
            super("MXRDynaComp");
            // Dyna Comp (1976): CA3080 OTA chip.
            // Known for squashy attack, rolled-off highs, and thick mids.
            
            // Bandwidth limiting (classic Dyna Comp character)
            this.nodes.preFilter = new Tone.Filter({ type: 'highpass', frequency: 60, rolloff: -12 });
            
            // Core compression (squashy, fast attack, slow release ~1s)
            this.nodes.comp = new Tone.Compressor({ threshold: -28, ratio: 12, attack: 0.005, release: 0.5 });
            
            // CA3080 OTA Saturation (adds warmth and slight distortion on transients)
            this.nodes.otaSat = new Tone.Chebyshev(3);
            this.nodes.otaSat.wet.value = 0.15;
            
            this.nodes.postFilter = new Tone.Filter({ type: 'lowpass', frequency: 6000, rolloff: -12 });
            this.nodes.output = new Tone.Gain(1);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.preFilter, this.nodes.comp, this.nodes.otaSat, this.nodes.postFilter, this.nodes.output, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.preFilter, this.nodes.comp, this.nodes.otaSat, this.nodes.postFilter, this.nodes.output);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.sensitivity !== undefined) {
                // Sensitivity lowers threshold AND pushes into the OTA harder
                this.nodes.comp.threshold.setTargetAtTime(-params.sensitivity, now, 0.01);
                this.nodes.otaSat.wet.setTargetAtTime(0.05 + (params.sensitivity / 80), now, 0.01);
            }
            if (params.output !== undefined) {
                this.nodes.output.gain.setTargetAtTime(params.output, now, 0.01);
            }
        }
    }
    class RossCompressor extends EffectBase {
        constructor() {
            super("RossCompressor");
            // Ross Compressor (Late 70s): Built on the Dyna Comp OTA circuit but with better power filtering
            // Characteristics: Warmer, more low-end retention, slightly smoother attack than Dyna Comp
            
            this.nodes.preFilter = new Tone.Filter({ type: 'highpass', frequency: 40, rolloff: -12 }); // More lows than Dyna
            this.nodes.comp = new Tone.Compressor({ threshold: -28, ratio: 12, attack: 0.008, release: 0.4 }); // Slightly slower attack
            this.nodes.otaSat = new Tone.Chebyshev(3);
            this.nodes.otaSat.wet.value = 0.1; // Smoother saturation
            this.nodes.postFilter = new Tone.Filter({ type: 'lowpass', frequency: 7000, rolloff: -12 });
            this.nodes.output = new Tone.Gain(1);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.preFilter, this.nodes.comp, this.nodes.otaSat, this.nodes.postFilter, this.nodes.output, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.preFilter, this.nodes.comp, this.nodes.otaSat, this.nodes.postFilter, this.nodes.output);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.sustain !== undefined) {
                // Sustain 0-1 maps to threshold
                this.nodes.comp.threshold.setTargetAtTime(mapSustain(params.sustain, -40, 0), now, 0.01);
                this.nodes.otaSat.wet.setTargetAtTime(0.05 + (params.sustain * 0.1), now, 0.01);
            }
            if (params.level !== undefined) {
                this.nodes.output.gain.setTargetAtTime(params.level, now, 0.01);
            }
        }
    }
    class DBX160ACompressor extends EffectBase {
        constructor() {
            super("DBX160ACompressor");
            // DBX 160 (1976) - "VCA" style, famous for "hard knee" and "thwack" on drums
            // Fixed Attack/Release (dependent on envelope), Hard Knee
            this.nodes.compressor = new Tone.Compressor({
                threshold: -20,
                ratio: 4,
                attack: 0.005, // Fast VCA attack (~5-15ms dependent)
                release: 0.1,  // Fast release (~8-10dB/ms)
                knee: 0        // Hard knee (DBX signature)
            });
            this.nodes.outputGain = new Tone.Gain(1.2);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.compressor, this.nodes.outputGain, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.compressor, this.nodes.outputGain);
        }
        set(params) {
            super.set(params); // Handles Mix/Width
            const now = Tone.now();
            const RAMP = 0.01;
            if (params.threshold !== undefined) this.nodes.compressor.threshold.setTargetAtTime(params.threshold, now, RAMP);
            if (params.ratio !== undefined) this.nodes.compressor.ratio.setTargetAtTime(params.ratio, now, RAMP);
            if (params.gain !== undefined) {
                // DBX 160 has up to 20dB makeup gain
                const gainVal = Math.pow(10, params.gain / 20);
                this.nodes.outputGain.gain.setTargetAtTime(gainVal, now, RAMP);
            }
        }
    }
    class IbanezCP9Compressor extends EffectBase {
        constructor() {
            super("IbanezCP9Compressor");
            this.nodes.comp = new Tone.Compressor({ threshold: -25, ratio: 10, attack: 0.01, release: 0.2 });
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.comp, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.comp);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.sustain !== undefined) {
                this.nodes.comp.threshold.setTargetAtTime(mapSustain(params.sustain, -40, 0), now, 0.01);
            }
            if (params.level !== undefined) this.wet.gain.setTargetAtTime(params.level, now, 0.01);
            if (params.attack !== undefined) this.nodes.comp.attack.setTargetAtTime(params.attack, now, 0.01);
        }
    }

    class DiamondCompressor extends EffectBase {
        constructor() {
            super("DiamondCompressor");
            this.nodes.comp = new Tone.Compressor({ threshold: -18, ratio: 4, attack: 0.025, release: 0.25 });
            // Tilt EQ centered at 900Hz: Boost Highs = Cut Lows, and vice versa.
            this.nodes.lowShelf = new Tone.Filter({ type: 'lowshelf', frequency: 900, gain: 0 });
            this.nodes.highShelf = new Tone.Filter({ type: 'highshelf', frequency: 900, gain: 0 });
            // "Mids" control on some Diamond pedals? Standard Diamond Comp only has EQ (Tilt) and Vol/Comp.
            // The config has "Mids". Keep it if user added it, but Tilt is the signature.
            this.nodes.mids = new Tone.Filter({ type: 'peaking', frequency: 800, Q: 1, gain: 0 });

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.comp, this.nodes.lowShelf, this.nodes.highShelf, this.nodes.mids, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.comp, this.nodes.lowShelf, this.nodes.highShelf, this.nodes.mids);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.comp !== undefined) {
                this.nodes.comp.threshold.setTargetAtTime(mapSustain(params.comp, -40, 0), now, 0.01);
            }
            if (params.volume !== undefined) this.wet.gain.setTargetAtTime(params.volume, now, 0.01);
            if (params.eq !== undefined) {
                // Tilt Logic:
                // eq > 0: High Boost / Low Cut
                // eq < 0: High Cut / Low Boost
                this.nodes.highShelf.gain.setTargetAtTime(params.eq, now, 0.01);
                this.nodes.lowShelf.gain.setTargetAtTime(-params.eq, now, 0.01);
            }
            if (params.mids !== undefined) this.nodes.mids.gain.setTargetAtTime(params.mids, now, 0.01);
            if (params.attack !== undefined) {
                this.nodes.comp.attack.setTargetAtTime(params.attack > 0.5 ? 0.005 : 0.025, now, 0.01);
            }
        }
    }
    class MultivoxBigJamSE3 extends EffectBase {
        constructor() {
            super("MultivoxBigJamSE3");
            this.nodes.comp = new Tone.Compressor({ threshold: -30, ratio: 10, attack: 0.005, release: 0.2 });
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.comp, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.comp);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.sensitivity !== undefined) {
                this.nodes.comp.threshold.setTargetAtTime(-params.sensitivity, now, 0.01);
            }
            if (params.output !== undefined) this.wet.gain.setTargetAtTime(params.output, now, 0.01);
        }
    }
    class UreiLA3APedal extends EffectBase {
        constructor() {
            super("UreiLA3APedal");
            // LA-3A: Solid-state version of LA-2A, faster FET response but same optical logic
            this.nodes.comp = new Tone.Compressor({ threshold: -20, ratio: 3, attack: 0.005, release: 0.05 });
            this.nodes.outputGain = new Tone.Gain(1);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.comp, this.nodes.outputGain, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.comp, this.nodes.outputGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.peakReduction !== undefined) {
                this.nodes.comp.threshold.setTargetAtTime(mapSustain(params.peakReduction, -40, 0), now, 0.01);
            }
            if (params.gain !== undefined) this.nodes.outputGain.gain.setTargetAtTime(params.gain, now, 0.01);
            if (params.mode !== undefined) {
                this.nodes.comp.ratio.setTargetAtTime(params.mode > 0.5 ? 10 : 3, now, 0.01);
            }
        }
    }
    class TeletronixLA2A extends EffectBase {
        constructor() {
            super("TeletronixLA2A");
            // Teletronix LA-2A: Legendary Optical Leveling Amplifier
            // T4 Electro-optical attenuator behavior
            // Famous for smooth, musical compression

            // Tube input stage warmth (12AX7, 12BH7 tubes)
            this.nodes.tubeInput = new Tone.Distortion(0.1);

            // Core compressor - T4 optical cell characteristics
            this.nodes.comp = new Tone.Compressor({
                threshold: -20,
                ratio: 3,        // Compress mode (soft knee behavior)
                attack: 0.010,   // ~10ms fixed attack
                release: 0.5     // Smooth optical release
            });

            // Output tube stage (6AQ5 tubes) - even harmonics
            this.nodes.tubeOutput = new Tone.Chebyshev(2);
            this.nodes.tubeOutput.wet.value = 0.2;

            // Makeup gain
            this.nodes.makeup = new Tone.Gain(1);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(
                this.nodes.tubeInput,
                this.nodes.comp,
                this.nodes.tubeOutput,
                this.nodes.makeup,
                this.nodes.stereoWidener
            );
            this._disposables.push(this.nodes.tubeInput, this.nodes.comp, this.nodes.tubeOutput, this.nodes.makeup);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.peakReduction !== undefined) {
                // Peak Reduction drives compressor threshold
                const threshold = -40 + (1 - params.peakReduction) * 40; // -40 to 0
                this.nodes.comp.threshold.setTargetAtTime(threshold, now, 0.01);
                // More reduction = more tube input drive
                this.nodes.tubeInput.distortion = 0.05 + params.peakReduction * 0.2;
            }

            if (params.gain !== undefined) {
                this.nodes.makeup.gain.setTargetAtTime(params.gain, now, 0.01);
            }

            if (params.limitMode !== undefined) {
                // Compress mode (0): Soft ~3:1 ratio
                // Limit mode (1): Harder ~10:1+ ratio
                const isLimit = params.limitMode > 0.5;
                this.nodes.comp.ratio.setTargetAtTime(isLimit ? 12 : 3, now, 0.01);
                this.nodes.comp.attack.setTargetAtTime(isLimit ? 0.005 : 0.010, now, 0.01);
            }
        }
    }

    class Fairchild670 extends EffectBase {
        constructor() {
            super("Fairchild670");
            // Fairchild 670 (1959) - Variable-Mu Tube Limiter
            // Very soft knee, program dependent, heavy tube coloration

            // 1. Tube Saturation (Input Stage)
            this.nodes.preamp = new Tone.Chebyshev(2);
            this.nodes.preamp.wet.value = 0.2; // Warm tube character

            // 2. Vari-Mu Compressor
            this.nodes.compressor = new Tone.Compressor({
                threshold: -15,
                ratio: 2,     // Generally lower ratios for Fairchildren
                attack: 0.0002, // Very fast attack (0.2ms)
                release: 0.3,   // Variable
                knee: 40        // Extremely soft knee
            });

            // 3. Output Stage
            this.nodes.makeup = new Tone.Gain(1.0);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.preamp, this.nodes.compressor, this.nodes.makeup, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.preamp, this.nodes.compressor, this.nodes.makeup);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP = 0.01;

            if (params.threshold !== undefined) this.nodes.compressor.threshold.setTargetAtTime(params.threshold, now, RAMP);

            // Time Constant (1-6)
            if (params.timeConstant !== undefined) {
                // Fairchild Time Constants:
                // 1: 0.2ms / 0.3s
                // 2: 0.2ms / 0.8s
                // 3: 0.4ms / 2s
                // 4: 0.4ms / 5s
                // 5: 0.4ms / 2s (auto)
                // 6: 0.2ms / 0.3s-10s (auto) - simplified here
                const tc = Math.floor(params.timeConstant);
                let atk = 0.0002;
                let rel = 0.3;

                switch (tc) {
                    case 1: rel = 0.3; break;
                    case 2: rel = 0.8; break;
                    case 3: atk = 0.0004; rel = 2.0; break;
                    case 4: atk = 0.0004; rel = 5.0; break;
                    case 5: atk = 0.0004; rel = 2.0; break; // Simplified auto
                    case 6: rel = 2.5; break; // Average for auto
                }
                this.nodes.compressor.attack.setTargetAtTime(atk, now, RAMP);
                this.nodes.compressor.release.setTargetAtTime(rel, now, RAMP);
            }

            if (params.inputGain !== undefined) {
                // Driving input adds tube saturation
                const drive = Math.max(0, params.inputGain);
                this.nodes.preamp.wet.setTargetAtTime(0.1 + (drive * 0.1), now, RAMP);
            }

            if (params.makeupGain !== undefined) {
                const gain = Math.pow(10, params.makeupGain / 20);
                this.nodes.makeup.gain.setTargetAtTime(gain, now, RAMP);
            }
        }
    }

    class UA1176 extends EffectBase {
        constructor() {
            super("UA1176");
            // UA 1176LN: Legendary FET Limiting Amplifier
            // Attack: 20µs to 800µs | Release: 50ms to 1.1s
            // Ratios: 4:1, 8:1, 12:1, 20:1, All-Buttons (variable 12-20:1)

            this._allButtonsMode = false;

            // FET coloration - adds harmonic character
            this.nodes.fetColor = new Tone.Chebyshev(2);
            this.nodes.fetColor.wet.value = 0.15;

            // Input drives the compressor harder (like real 1176)
            this.nodes.inputGain = new Tone.Gain(1);

            // Core compressor with authentic defaults
            this.nodes.comp = new Tone.Compressor({
                threshold: -24,
                ratio: 4,
                attack: 0.0002, // ~200µs (middle of range)
                release: 0.3    // ~300ms (middle of range)
            });

            // All Buttons mode adds aggressive pumping/distortion
            this.nodes.allButtonsSat = new Tone.Distortion(0);

            // Output gain (makeup)
            this.nodes.outputGain = new Tone.Gain(1);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(
                this.nodes.inputGain,
                this.nodes.fetColor,
                this.nodes.comp,
                this.nodes.allButtonsSat,
                this.nodes.outputGain,
                this.nodes.stereoWidener
            );
            this._disposables.push(this.nodes.comp, this.nodes.inputGain, this.nodes.fetColor, this.nodes.allButtonsSat, this.nodes.outputGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.input !== undefined) {
                // Input gain drives threshold harder (authentic 1176 behavior)
                const inputLevel = params.input; // 1-10 range from config
                this.nodes.inputGain.gain.setTargetAtTime(inputLevel / 5, now, 0.01);
                // Higher input = lower effective threshold
                const threshold = -12 - (inputLevel * 3);
                this.nodes.comp.threshold.setTargetAtTime(threshold, now, 0.01);
            }

            if (params.output !== undefined) {
                this.nodes.outputGain.gain.setTargetAtTime(params.output, now, 0.01);
            }

            if (params.ratio !== undefined) {
                const ratioIndex = Math.floor(params.ratio);
                const ratios = [4, 8, 12, 20];

                if (ratioIndex >= 4) {
                    // ALL BUTTONS IN MODE (British Mode / Nuke Mode)
                    // Variable ratio between 12:1 and 20:1, aggressive pumping
                    this._allButtonsMode = true;
                    this.nodes.comp.ratio.setTargetAtTime(16, now, 0.01); // Effective ~16:1
                    this.nodes.allButtonsSat.distortion = 0.35;
                    // ABI mode has altered attack/release - initial transient lag
                    this.nodes.comp.attack.setTargetAtTime(0.00008, now, 0.01); // Very fast
                    this.nodes.comp.release.setTargetAtTime(0.15, now, 0.01);
                    this.nodes.fetColor.wet.setTargetAtTime(0.3, now, 0.01);
                } else {
                    this._allButtonsMode = false;
                    this.nodes.comp.ratio.setTargetAtTime(ratios[ratioIndex], now, 0.01);
                    this.nodes.allButtonsSat.distortion = 0;
                    this.nodes.fetColor.wet.setTargetAtTime(0.15, now, 0.01);
                }
            }

            // Attack: 0 = Slow (800µs), 1 = Fast (20µs) - NOTE: 1176 knobs are reversed!
            if (params.attack !== undefined && !this._allButtonsMode) {
                // Map 0-1 to 0.0008s (slow) to 0.00002s (fast)
                const attackTime = 0.0008 - (params.attack * 0.00078);
                this.nodes.comp.attack.setTargetAtTime(Math.max(0.00002, attackTime), now, 0.01);
            }

            // Release: 0 = Slow (1.1s), 1 = Fast (50ms) - Also reversed
            if (params.release !== undefined && !this._allButtonsMode) {
                // Map 0-1 to 1.1s (slow) to 0.05s (fast)
                const releaseTime = 1.1 - (params.release * 1.05);
                this.nodes.comp.release.setTargetAtTime(Math.max(0.05, releaseTime), now, 0.01);
            }
        }
    }

    class OrangeSqueezer extends EffectBase {
        constructor() {
            super("OrangeSqueezer");
            // Dan Armstrong Orange Squeezer (1976): JFET compression (1N100 diodes & JFET op-amps)
            // Characteristics: Lower ratio (~3:1 to 5:1), very fast attack, saggy "bloom" release.
            // Adds distinct second-order (tube-like) harmonic distortion from the JFET.
            
            this.nodes.comp = new Tone.Compressor({ threshold: -25, ratio: 4, attack: 0.002, release: 0.3 });
            this.nodes.jfetWarmth = new Tone.Chebyshev(2); // JFETs yield predominantly 2nd order harmonics
            this.nodes.jfetWarmth.wet.value = 0.2;
            this.nodes.outputGain = new Tone.Gain(1);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.comp, this.nodes.jfetWarmth, this.nodes.outputGain, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.comp, this.nodes.jfetWarmth, this.nodes.outputGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.bias !== undefined) {
                // Bias controls the JFET operating point (threshold + distortion amount)
                this.nodes.comp.threshold.setTargetAtTime(-35 + (params.bias * 20), now, 0.01);
                this.nodes.jfetWarmth.wet.setTargetAtTime(0.1 + (params.bias * 0.3), now, 0.01);
            }
            if (params.level !== undefined) this.nodes.outputGain.gain.setTargetAtTime(params.level, now, 0.01);
        }
    }

    
    class SSLGMasterBuss extends EffectBase {
        constructor() {
            super("SSLGMasterBuss");
            // SSL G-Master Buss Compressor (1980s)
            // The ultimate VCA "glue" compressor.
            // Characteristics: Snappy auto-release, subtle VCA harmonic distortion when pushed.
            
            this.nodes.comp = new Tone.Compressor({
                threshold: -20,
                ratio: 4,
                attack: 0.003, // 3ms
                release: 0.3   // 300ms
            });
            
            // Subtle VCA Saturation
            this.nodes.vcaDist = new Tone.Chebyshev(3);
            this.nodes.vcaDist.wet.value = 0.05;
            
            this.nodes.makeup = new Tone.Gain(1);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.comp, this.nodes.vcaDist, this.nodes.makeup, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.comp, this.nodes.vcaDist, this.nodes.makeup);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.threshold !== undefined) this.nodes.comp.threshold.setTargetAtTime(params.threshold, now, 0.01);
            if (params.ratio !== undefined) this.nodes.comp.ratio.setTargetAtTime(params.ratio, now, 0.01);
            if (params.makeup !== undefined) this.nodes.makeup.gain.setTargetAtTime(params.makeup, now, 0.01);
            
            if (params.attack !== undefined) {
                // Map 0-1 to SSL attack times (0.1, 0.3, 1, 3, 10, 30 ms)
                const attacks = [0.0001, 0.0003, 0.001, 0.003, 0.01, 0.03];
                this.nodes.comp.attack.setTargetAtTime(attacks[Math.floor(params.attack * 5.99)], now, 0.01);
            }
            if (params.release !== undefined) {
                // Map 0-1 to SSL release times (0.1, 0.3, 0.6, 1.2, Auto)
                const releases = [0.1, 0.3, 0.6, 1.2, 0.3]; // Using 0.3 as auto approximation for now
                this.nodes.comp.release.setTargetAtTime(releases[Math.floor(params.release * 4.99)], now, 0.01);
            }
        }
    }

    const classes = { SSLGMasterBuss,  BossCS1, MXRDynaComp, RossCompressor, IbanezCP9Compressor, DiamondCompressor, MultivoxBigJamSE3, DBX160ACompressor, UreiLA3APedal, TeletronixLA2A, Fairchild670, UA1176, OrangeSqueezer };
    const configs = {
        "Compressor": {
            "Comp: Boss CS-1": { "isCustom": "BossCS1", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Sustain", "p": "sustain", "min": 0, "max": 1, "s": 0.01, "def": 0.625 }, { "l": "Level", "p": "level", "min": 0, "max": 4, "s": 0.01, "def": 1 }], [{ "l": "Mode", "p": "mode", "min": 0, "max": 1, "s": 1, "def": 0, "unit": " N/T" }]] },
            "Comp: MXR Dyna Comp ('70s)": { "isCustom": "MXRDynaComp", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Sensitivity", "p": "sensitivity", "min": 1, "max": 40, "s": 0.1, "def": 28 }], [{ "l": "Output", "p": "output", "min": 0, "max": 4, "s": 0.01, "def": 1 }]] },
            "Comp: Ross": { "isCustom": "RossCompressor", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Sustain", "p": "sustain", "min": 0, "max": 1, "s": 0.01, "def": 0.625 }], [{ "l": "Level", "p": "level", "min": 0, "max": 4, "s": 0.01, "def": 1 }], [{ "l": "Mode", "p": "mode", "min": 0, "max": 1, "s": 1, "def": 0, "unit": " N/B" }]] },
            "Comp: Ibanez CP-9": { "isCustom": "IbanezCP9Compressor", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Sustain", "p": "sustain", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }, { "l": "Level", "p": "level", "min": 0, "max": 4, "s": 0.01, "def": 1 }], [{ "l": "Attack", "p": "attack", "min": 0.001, "max": 0.5, "s": 0.001, "def": 0.01 }]] },
            "Comp: Diamond Optical": { "isCustom": "DiamondCompressor", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Comp", "p": "comp", "min": 0, "max": 1, "s": 0.01, "def": 0.55 }, { "l": "Volume", "p": "volume", "min": 0, "max": 4, "s": 0.01, "def": 1 }], [{ "l": "EQ (Tilt)", "p": "eq", "min": -10, "max": 10, "s": 0.1, "def": 0 }, { "l": "Mids", "p": "mids", "min": -10, "max": 10, "s": 0.1, "def": 0 }], [{ "l": "Attack", "p": "attack", "min": 0, "max": 1, "s": 1, "def": 0, "unit": " Slow/Fast" }]] },
            "Comp: Multivox Big Jam SE-3": { "isCustom": "MultivoxBigJamSE3", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Sensitivity", "p": "sensitivity", "min": 1, "max": 50, "s": 0.1, "def": 30 }], [{ "l": "Output", "p": "output", "min": 0, "max": 5, "s": 0.01, "def": 1 }]] },
            "Comp: DBX 160": { "isCustom": "DBX160ACompressor", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Threshold", "p": "threshold", "min": -40, "max": 0, "s": 1, "def": -20 }, { "l": "Ratio", "p": "ratio", "min": 1, "max": 10, "s": 0.5, "def": 4 }], [{ "l": "Gain", "p": "gain", "min": 0, "max": 20, "s": 0.5, "def": 0 }]] },
            "Comp: Urei LA-3A": { "isCustom": "UreiLA3APedal", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Peak Reduction", "p": "peakReduction", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }, { "l": "Gain", "p": "gain", "min": 0, "max": 4, "s": 0.01, "def": 1 }], [{ "l": "Mode", "p": "mode", "min": 0, "max": 1, "s": 1, "def": 0, "unit": " Comp/Lim" }]] },
            "Comp: Teletronix LA-2A": { "isCustom": "TeletronixLA2A", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Peak Reduction", "p": "peakReduction", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }, { "l": "Gain", "p": "gain", "min": 0, "max": 4, "s": 0.01, "def": 1 }], [{ "l": "Mode", "p": "limitMode", "min": 0, "max": 1, "s": 1, "def": 0, "unit": " Comp/Lim" }]] },
            "Comp: Fairchild 670": { "isCustom": "Fairchild670", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Threshold", "p": "threshold", "min": -40, "max": 0, "s": 0.5, "def": -15 }, { "l": "Input Gain", "p": "inputGain", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }], [{ "l": "Time Cons", "p": "timeConstant", "min": 1, "max": 6, "s": 1, "def": 1, "unit": " 1-6" }], [{ "l": "Makeup", "p": "makeupGain", "min": 0, "max": 20, "s": 0.5, "def": 0 }]] },
            "Comp: UA 1176": { "isCustom": "UA1176", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Input", "p": "input", "min": 1, "max": 10, "s": 0.1, "def": 5 }, { "l": "Output", "p": "output", "min": 0, "max": 4, "s": 0.01, "def": 1 }], [{ "l": "Attack", "p": "attack", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }, { "l": "Release", "p": "release", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }], [{ "l": "Ratio", "p": "ratio", "min": 0, "max": 4, "s": 1, "def": 0, "unit": " 4/8/12/20/ABI" }]] },
            "Comp: Orange Squeezer": { "isCustom": "OrangeSqueezer", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Bias", "p": "bias", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }], [{ "l": "Level", "p": "level", "min": 0, "max": 4, "s": 0.01, "def": 1 }]] }
        }
    };
    window.effectModules.compressor = { classes, configs };
})();
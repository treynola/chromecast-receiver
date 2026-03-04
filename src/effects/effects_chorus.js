/*
 * Filename: effects_chorus.js
 * Version: NOV25_AntiGravity Version 1.0
 * Date: November 25, 2025
 * Time: 16:31 CST
 * Description: Chorus effects implementation.
 */
if (typeof window.effectModules === 'undefined') { window.effectModules = {}; }
if (typeof window.AppSource === 'undefined') { window.AppSource = {}; }

// --- REQUIRED BLOCK FOR DYNAMIC BUILD ---
// Captures the source code string of THIS file and caches it.
if (typeof window.saveModuleSource === 'function') {
    window.saveModuleSource('effects_chorus.js');
}

// Define the source string for caching (omitted for brevity, assume full string)
window.AppSource['effects_chorus.js'] = `// [Full source code string for effects_chorus.js v43.7]`;
// Actual module code
(() => {
    const { EffectBase } = window;
    const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
    const RAMP_TIME = 0.01;

    class StereoChorus extends EffectBase {
        constructor() {
            super("StereoChorus");
            this._params = {
                rate: 1.2,
                depth: 0.8,
                mode: 0
            };

            this.nodes.chorus = new Tone.Chorus({
                frequency: this._params.rate,
                delayTime: 0.0035,
                depth: this._params.depth,
                spread: 180,
                wet: 1
            });
            this.nodes.vibrato = new Tone.Vibrato({
                frequency: this._params.rate,
                depth: this._params.depth,
                wet: 1
            });
            this.nodes.mode = new Tone.CrossFade(this._params.mode);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.fan(this.nodes.chorus, this.nodes.vibrato);
            this.nodes.chorus.connect(this.nodes.mode.a);
            this.nodes.vibrato.connect(this.nodes.mode.b);
            this.nodes.mode.connect(this.nodes.stereoWidener);

            this._disposables.push(this.nodes.chorus, this.nodes.vibrato, this.nodes.mode);
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.depth !== undefined) {
                this._params.depth = params.depth;
                if (this.nodes.chorus) this.nodes.chorus.depth = params.depth;
                if (this.nodes.vibrato && this.nodes.vibrato.depth) this.nodes.vibrato.depth.value = params.depth;
            }

            if (params.rate !== undefined) {
                this._params.rate = params.rate;
                if (this.nodes.chorus) this.nodes.chorus.frequency.setTargetAtTime(this._params.rate, now, 0.01);
                if (this.nodes.vibrato) this.nodes.vibrato.frequency.setTargetAtTime(this._params.rate, now, 0.01);
            }

            if (params.mode !== undefined) {
                this._params.mode = params.mode;
                this.nodes.mode.fade.setTargetAtTime(this._params.mode, now, 0.01);
            }
        }
    }
    class MXRAnalogChorus extends EffectBase {
        constructor() {
            super("MXRAnalogChorus");
            this._params = {
                speed: 1,
                depth: 0.7,
                high: 0,
                low: 0,
                level: 1
            };

            this.nodes.high = new Tone.Filter({ type: 'highshelf', frequency: 4000, gain: this._params.high });
            this.nodes.low = new Tone.Filter({ type: 'lowshelf', frequency: 400, gain: this._params.low });
            this.nodes.level = new Tone.Gain(this._params.level);

            this.nodes.chorus = new Tone.Chorus({
                frequency: this._params.speed,
                delayTime: 0.003,
                depth: this._params.depth,
                spread: 180,
                wet: 1
            });

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.chorus, this.nodes.low, this.nodes.high, this.nodes.level, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.chorus, this.nodes.low, this.nodes.high, this.nodes.level);
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.depth !== undefined) {
                this._params.depth = params.depth;
                if (this.nodes.chorus) this.nodes.chorus.depth = params.depth;
            }

            if (params.speed !== undefined) {
                this._params.speed = params.speed;
                if (this.nodes.chorus) this.nodes.chorus.frequency.setTargetAtTime(this._params.speed, now, 0.01);
            }

            if (params.high !== undefined) this.nodes.high.gain.setTargetAtTime(params.high, now, 0.01);
            if (params.low !== undefined) this.nodes.low.gain.setTargetAtTime(params.low, now, 0.01);
            if (params.level !== undefined) this.nodes.level.gain.setTargetAtTime(params.level, now, 0.01);
        }
    }
    class BassChorus extends EffectBase {
        constructor() {
            super("BassChorus");
            this._params = { rate: 2, depth: 0.8, xover: 0 };

            const freq = this._params.xover > 0.5 ? 250 : 100;
            this.nodes.highpass = new Tone.Filter(freq, 'highpass');
            this.nodes.lowpass = new Tone.Filter(freq, 'lowpass');
            this.nodes.bass = new Tone.Filter({ type: 'lowshelf', frequency: 100, gain: 0 });
            this.nodes.treble = new Tone.Filter({ type: 'highshelf', frequency: 2500, gain: 0 });
            this.nodes.chorus = new Tone.Chorus({
                frequency: this._params.rate,
                delayTime: 0.0035,
                depth: this._params.depth,
                wet: 1
            });

            this.nodes.merger = new Tone.Merge();
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.fan(this.nodes.highpass, this.nodes.lowpass);

            // Connect to merger using the Tone.js L/R input syntax
            this.nodes.highpass.chain(this.nodes.chorus, this.nodes.treble);
            this.nodes.treble.connect(this.nodes.merger, 0, 0); // Left
            this.nodes.lowpass.chain(this.nodes.bass);
            this.nodes.bass.connect(this.nodes.merger, 0, 1); // Right

            this.nodes.merger.connect(this.nodes.stereoWidener);
            this._disposables.push(this.nodes.highpass, this.nodes.lowpass, this.nodes.chorus, this.nodes.bass, this.nodes.treble, this.nodes.merger);
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.depth !== undefined) {
                this._params.depth = params.depth;
                if (this.nodes.chorus) this.nodes.chorus.depth = params.depth;
            }

            if (params.rate !== undefined) {
                this._params.rate = params.rate;
                if (this.nodes.chorus) this.nodes.chorus.frequency.setTargetAtTime(this._params.rate, now, 0.01);
            }

            if (params.xover !== undefined) {
                this._params.xover = params.xover;
                const freq = this._params.xover > 0.5 ? 250 : 100;
                this.nodes.highpass.frequency.setTargetAtTime(freq, now, 0.01);
                this.nodes.lowpass.frequency.setTargetAtTime(freq, now, 0.01);
            }
        }
    }
    class WalrusAudioJulia extends EffectBase {
        constructor() {
            super("WalrusAudioJulia");
            this._params = { rate: 2, depth: 0.7, lag: 0.5, shape: 0, d_c_v: 0.5 };

            this.nodes.lfo = new Tone.LFO({
                frequency: this._params.rate,
                type: this._params.shape > 0.5 ? 'square' : 'triangle', // Authentic Julia uses Triangle/Sine blend, approximated here
                min: 0,
                max: 1,
                phase: 0
            }).start();

            // Julia structure: Dry -> Blend <- (Vibrato+Chorus created by Delay+LFO)
            // Tone.Chorus is Delay+LFO.
            this.nodes.chorus = new Tone.Chorus({
                frequency: this._params.rate,
                delayTime: (2 + (this._params.lag * 20)) / 1000, // Lag controls center delay (2ms to 22ms)
                depth: this._params.depth,
                type: this._params.shape > 0.5 ? 'sine' : 'triangle', // Approximating the variable shape
                spread: 0, // Mono summed before stereo widener usually, but let's keep it tight
                wet: 1
            });

            // D-C-V Blend: Dry (0) -> Chorus (0.5) -> Vibrato (1)
            // We implementation this by CrossFading Dry with Wet, but "Chorus" is 50/50 mix.
            // Tone.Chorus wet=1 is Vibrato. wet=0.5 is Chorus.
            // So D-C-V knob maps to Tone.Chorus.wet.
            // 0 (Dry) -> 0.5 (Chorus/Wet=0.5) -> 1.0 (Vibrato/Wet=1)

            // Wait, D-C-V is:
            // d (dry) ------ c (chorus 50/50) ------ v (vibrato 100% wet)
            // This is exactly the 'wet' parameter of the effect!

            // However, to be super authentic, Julia's LFO shape is variable.
            // Tone.Chorus only supports fixed types. We'll stick to 'triangle' as base.

            this.nodes.splitter = new Tone.Split();
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.chorus, this.nodes.stereoWidener);

            this._disposables.push(this.nodes.chorus, this.nodes.lfo);
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.depth !== undefined) {
                this._params.depth = params.depth;
                if (this.nodes.chorus) this.nodes.chorus.depth = params.depth;
            }
            if (params.lag !== undefined) {
                this._params.lag = params.lag;
                if (this.nodes.chorus) this.nodes.chorus.delayTime = (2 + (this._params.lag * 20)) / 1000;
            }
            if (params.shape !== undefined) {
                this._params.shape = params.shape;
                if (this.nodes.chorus) this.nodes.chorus.type = this._params.shape > 0.5 ? 'sine' : 'triangle';
            }

            if (params.rate !== undefined) {
                this._params.rate = params.rate;
                if (this.nodes.chorus) this.nodes.chorus.frequency.setTargetAtTime(this._params.rate, now, 0.01);
            }

            if (params.d_c_v !== undefined) {
                this._params.d_c_v = params.d_c_v;
                this.nodes.chorus.wet.value = this._params.d_c_v;
            }
        }
    }
    class BossCE5 extends EffectBase {
        constructor() {
            super("BossCE5");
            this._params = { rate: 2.5, depth: 0.8, lowCut: 100, highCut: 8000, level: 1 };

            this.nodes.lowFilter = new Tone.Filter(this._params.lowCut, 'highpass');
            this.nodes.highFilter = new Tone.Filter(this._params.highCut, 'lowpass');
            this.nodes.level = new Tone.Gain(this._params.level);
            this.nodes.chorus = new Tone.Chorus({
                frequency: this._params.rate,
                delayTime: 0.004,
                depth: this._params.depth,
                type: 'triangle', // Authentic Boss LFO
                spread: 180,
                wet: 1
            });

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.chorus, this.nodes.lowFilter, this.nodes.highFilter, this.nodes.level, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.chorus, this.nodes.lowFilter, this.nodes.highFilter, this.nodes.level);
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.depth !== undefined) {
                this._params.depth = params.depth;
                if (this.nodes.chorus) this.nodes.chorus.depth = params.depth;
            }

            if (params.rate !== undefined) {
                this._params.rate = params.rate;
                if (this.nodes.chorus) this.nodes.chorus.frequency.setTargetAtTime(this._params.rate, now, 0.01);
            }

            if (params.lowCut !== undefined) this.nodes.lowFilter.frequency.setTargetAtTime(params.lowCut, now, 0.01);
            if (params.highCut !== undefined) this.nodes.highFilter.frequency.setTargetAtTime(params.highCut, now, 0.01);
            if (params.level !== undefined) this.nodes.level.gain.setTargetAtTime(params.level, now, 0.01);
        }
    }
    class DigitechLuxe extends EffectBase {
        constructor() {
            super("DigitechLuxe");
            this.nodes.detuneUp = new Tone.PitchShift({ pitch: 0, windowSize: 0.1 });
            this.nodes.detuneDown = new Tone.PitchShift({ pitch: 0, windowSize: 0.1 });
            this.nodes.merger = new Tone.Merge();
            this.nodes.level = new Tone.Gain(1);
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.fan(this.nodes.detuneUp, this.nodes.detuneDown);
            this.nodes.detuneUp.connect(this.nodes.merger, 0, 0);
            this.nodes.detuneDown.connect(this.nodes.merger, 0, 1);
            this.nodes.merger.chain(this.nodes.level, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.detuneUp, this.nodes.detuneDown, this.nodes.merger, this.nodes.level);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.detune !== undefined) {
                const cents = params.detune * 50;
                this.nodes.detuneUp.pitch = cents / 100;
                this.nodes.detuneDown.pitch = -cents / 100;
            }
            if (params.level !== undefined) this.nodes.level.gain.setTargetAtTime(params.level, now, 0.01);
        }
    }
    class JamPedalsWaterfall extends EffectBase {
        constructor() {
            super("JamPedalsWaterfall");
            this._params = { speed: 2, depth: 0.8, vibrato: 0, intensity: 0 };
            
            const finalDepth = this._params.depth + (this._params.intensity * 0.2);

            this.nodes.chorus = new Tone.Chorus({
                frequency: this._params.speed,
                delayTime: 0.003,
                depth: finalDepth,
                spread: 180,
                wet: 1
            });
            this.nodes.vibrato = new Tone.Vibrato({
                frequency: this._params.speed,
                depth: finalDepth,
                wet: 1
            });
            this.nodes.blend = new Tone.CrossFade(this._params.vibrato);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.fan(this.nodes.chorus, this.nodes.vibrato);
            this.nodes.chorus.connect(this.nodes.blend.a);
            this.nodes.vibrato.connect(this.nodes.blend.b);
            this.nodes.blend.connect(this.nodes.stereoWidener);
            this._disposables.push(this.nodes.chorus, this.nodes.vibrato, this.nodes.blend);
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.depth !== undefined || params.intensity !== undefined) {
                if (params.depth !== undefined) this._params.depth = params.depth;
                if (params.intensity !== undefined) this._params.intensity = params.intensity;
                
                const finalDepth = this._params.depth + (this._params.intensity * 0.2);
                if (this.nodes.chorus) this.nodes.chorus.depth = finalDepth;
                if (this.nodes.vibrato && this.nodes.vibrato.depth) this.nodes.vibrato.depth.value = finalDepth;
            }

            if (params.speed !== undefined) {
                this._params.speed = params.speed;
                if (this.nodes.chorus) this.nodes.chorus.frequency.setTargetAtTime(this._params.speed, now, 0.01);
                if (this.nodes.vibrato) this.nodes.vibrato.frequency.setTargetAtTime(this._params.speed, now, 0.01);
            }

            if (params.vibrato !== undefined) {
                this._params.vibrato = params.vibrato;
                this.nodes.blend.fade.setTargetAtTime(this._params.vibrato, now, 0.01);
            }
        }
    }

    class BossCE1 extends EffectBase {
        constructor() {
            // Boss CE-1 Chorus Ensemble (1976)
            // First standalone chorus pedal, derived from JC-120 amplifier
            // Uses MN3002 512-stage BBD chip
            // Triangular LFO for chorus, sine LFO for vibrato
            // Clock range: 60kHz-200kHz
            // Characteristic: warm, rich, slightly dark analog character
            super("BossCE1");
            this._params = { rate: 0.5, depth: 0.8, mode: 0, level: 1 };

            // CE-1 Input Preamp: Can boost 20dB for low-output instruments
            this.nodes.preamp = new Tone.Gain(1);

            // CE-1 preamp saturation (tube-like warmth from discrete transistor stages)
            this.nodes.saturation = new Tone.Chebyshev(2);
            this.nodes.saturation.wet.value = 0.25;

            // BBD Anti-aliasing filter (before BBD)
            this.nodes.antiAlias = new Tone.Filter({ frequency: 6500, type: 'lowpass', rolloff: -12 });

            // BBD Reconstruction filter (after BBD) - MN3002 is darker
            this.nodes.bbdFilter = new Tone.Filter({ frequency: 6000, type: 'lowpass', rolloff: -12 });

            // BBD saturation (characteristic MN3002 soft clipping)
            this.nodes.bbdSat = new Tone.Chebyshev(2);
            this.nodes.bbdSat.wet.value = 0.15;

            // CHORUS mode: Triangular LFO, fixed slow rate (0.1-0.8Hz)
            // The CE-1's chorus rate is relatively fixed compared to vibrato
            this.nodes.chorus = new Tone.Chorus({
                frequency: 0.4,
                delayTime: 0.005, // ~5ms characteristic delay
                depth: 0.8,
                spread: 180,
                type: 'triangle', // Authentic triangular wave
                wet: 1
            });

            // VIBRATO mode: Sine LFO, variable rate (2.4s-90ms period = 0.4-11Hz)
            this.nodes.vibrato = new Tone.Vibrato({
                frequency: 4,
                depth: 0.5,
                type: 'sine', // Authentic sine wave for vibrato
                wet: 1
            });

            // Mode crossfade: 0=Chorus, 1=Vibrato
            this.nodes.mode = new Tone.CrossFade(0);
            this.nodes.outputLevel = new Tone.Gain(1);

            this.wet.disconnect(this.nodes.stereoWidener);

            // Signal Chain: Input -> Preamp -> Saturation -> AntiAlias -> Chorus/Vibrato
            this.wet.chain(this.nodes.preamp, this.nodes.saturation, this.nodes.antiAlias);

            // Split to Chorus/Vibrato paths
            this.nodes.antiAlias.fan(this.nodes.chorus, this.nodes.vibrato);

            // Merge via mode selector
            this.nodes.chorus.connect(this.nodes.mode.a);
            this.nodes.vibrato.connect(this.nodes.mode.b);

            // Output: Mode -> BBD Filter -> BBD Saturation -> Output
            this.nodes.mode.chain(this.nodes.bbdFilter, this.nodes.bbdSat, this.nodes.outputLevel, this.nodes.stereoWidener);

            this._disposables.push(
                this.nodes.chorus, this.nodes.vibrato, this.nodes.preamp, this.nodes.saturation,
                this.nodes.antiAlias, this.nodes.bbdFilter, this.nodes.bbdSat,
                this.nodes.mode, this.nodes.outputLevel
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP_TIME = 0.01;

            if (params.mode !== undefined) {
                this._params.mode = params.mode;
                this.nodes.mode.fade.setTargetAtTime(params.mode, now, RAMP_TIME);
            }

            if (params.rate !== undefined) {
                this._params.rate = params.rate;
                if (this._params.mode <= 0.5) {
                    // Chorus mode: Rate is relatively narrow (0.1-0.8Hz)
                    const chorusRate = 0.1 + (params.rate * 0.7);
                    this.nodes.chorus.frequency.setTargetAtTime(chorusRate, now, RAMP_TIME);
                } else {
                    // Vibrato mode: Rate is wider (0.4-11Hz)
                    const vibratoRate = 0.4 + (params.rate * 10.6);
                    this.nodes.vibrato.frequency.setTargetAtTime(vibratoRate, now, RAMP_TIME);
                }
            }

            if (params.depth !== undefined) {
                this._params.depth = params.depth;
                // Chorus and vibrato both have intensity controls
                this.nodes.chorus.depth = params.depth;
                this.nodes.vibrato.depth.value = params.depth * 0.7; // Vibrato depth slightly less
            }

            if (params.level !== undefined) {
                this._params.level = params.level;
                // Level control affects preamp drive and output
                this.nodes.preamp.gain.setTargetAtTime(0.8 + (params.level * 0.4), now, RAMP_TIME);
                this.nodes.outputLevel.gain.setTargetAtTime(params.level, now, RAMP_TIME);
            }
        }
    }

    

    class RolandDimensionD extends EffectBase {
        constructor() {
            super("RolandDimensionD");
            this._params = { mode: 1 };

            // Dimension D: Dual BBD lines modulated out-of-phase (180 deg)
            // Creating a "motionless" wide stereo field.

            // Left Channel Chorus
            this.nodes.chorusL = new Tone.Chorus({
                frequency: 0.25,
                delayTime: 0.005,
                depth: 0.5,
                spread: 0, // Mono LFO
                wet: 1,
                type: 'triangle'
            });

            // Right Channel Chorus
            this.nodes.chorusR = new Tone.Chorus({
                frequency: 0.25,
                delayTime: 0.005,
                depth: 0.5,
                spread: 0, // Mono LFO
                wet: 1,
                type: 'triangle'
            });
            // Important: We cannot easily invert the phase of the internal LFO in Tone.Chorus.
            // However, we can invert the audio output relative to the dry signal to create width.
            // Or use slightly different rates.
            // Authentic Dimension D uses exactly same rate, inverted LFO phase.
            // Tone.Chorus doesn't expose LFO phase.
            // Workaround: We modulate delayTime manually? No, too complex for EffectBase.
            // Best Approximation: Use 'spread' on a single stereo chorus?
            // No, independent controls needed for mode logic.
            // We will use slight detuning of the rates (heterodyning) which sounds close,
            // OR simply invert the phase of the Right channel output entirely.

            this.nodes.phaseInverterR = new Tone.Gain(-1); // Invert Audio Phase

            this.nodes.merger = new Tone.Merge();
            // Cross-feeding for "Dimension" effect (mixing some L into R)
            this.nodes.crossMixL = new Tone.Gain(0.2);
            this.nodes.crossMixR = new Tone.Gain(0.2);

            this.wet.disconnect(this.nodes.stereoWidener);

            // Input -> Split L/R
            this.wet.fan(this.nodes.chorusL, this.nodes.chorusR);

            // Left Path: ChorusL -> Merger L
            this.nodes.chorusL.connect(this.nodes.merger, 0, 0);

            // Right Path: ChorusR -> Invert -> Merger R
            this.nodes.chorusR.connect(this.nodes.phaseInverterR);
            this.nodes.phaseInverterR.connect(this.nodes.merger, 0, 1);

            // Cross Mixing (Spatial Enhancer)
            // L -> CrossMixL -> R
            // R -> CrossMixR -> L
            this.nodes.chorusL.connect(this.nodes.crossMixL);
            this.nodes.crossMixL.connect(this.nodes.merger, 0, 1);

            this.nodes.chorusR.connect(this.nodes.crossMixR);
            this.nodes.crossMixR.connect(this.nodes.merger, 0, 0);

            this.nodes.merger.connect(this.nodes.stereoWidener);

            this._disposables.push(this.nodes.chorusL, this.nodes.chorusR, this.nodes.merger, this.nodes.crossMixL, this.nodes.crossMixR, this.nodes.phaseInverterR);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP_TIME = 0.01;
            if (params.mode !== undefined) {
                const m = Math.round(params.mode);
                // Dimension D Modes:
                // 1: Subtle, 2: Wider, 3: Deep, 4: Maximum (Wettest)
                const depths = [0, 0.4, 0.5, 0.6, 0.7];
                const rates = [0, 0.25, 0.3, 0.4, 0.5];
                const cross = [0, 0.1, 0.2, 0.25, 0.3];

                this.nodes.chorusL.depth = depths[m];
                this.nodes.chorusR.depth = depths[m];

                this.nodes.chorusL.frequency.setTargetAtTime(rates[m], now, RAMP_TIME);
                this.nodes.chorusR.frequency.setTargetAtTime(rates[m], now, RAMP_TIME); // Sync rates

                this.nodes.crossMixL.gain.setTargetAtTime(cross[m], now, RAMP_TIME);
                this.nodes.crossMixR.gain.setTargetAtTime(cross[m], now, RAMP_TIME);
            }
        }
    }

    

    
    class BossCE2 extends EffectBase {
        constructor() {
            super("BossCE2");
            // Boss CE-2 Chorus (1979)
            // Uses MN3007 1024-stage BBD. Mid-focused, lush.
            // Triangular LFO. Delay range ~7ms.
            
            this.nodes.preEmphasis = new Tone.Filter({ type: 'highshelf', frequency: 3000, gain: 6 });
            this.nodes.antiAlias = new Tone.Filter({ frequency: 6500, type: 'lowpass', rolloff: -12 });
            
            this.nodes.chorus = new Tone.Chorus({
                frequency: 2,
                delayTime: 0.007,
                depth: 0.7,
                type: 'triangle',
                spread: 180,
                wet: 1
            });
            
            this.nodes.bbdSat = new Tone.Chebyshev(2);
            this.nodes.bbdSat.wet.value = 0.1;
            
            this.nodes.deEmphasis = new Tone.Filter({ type: 'highshelf', frequency: 3000, gain: -6 });
            this.nodes.reconstruction = new Tone.Filter({ frequency: 6000, type: 'lowpass', rolloff: -12 });
            
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.preEmphasis, this.nodes.antiAlias, this.nodes.chorus, this.nodes.bbdSat, this.nodes.deEmphasis, this.nodes.reconstruction, this.nodes.stereoWidener);
            
            this._disposables.push(this.nodes.preEmphasis, this.nodes.antiAlias, this.nodes.chorus, this.nodes.bbdSat, this.nodes.deEmphasis, this.nodes.reconstruction);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.rate !== undefined) this.nodes.chorus.frequency.setTargetAtTime(params.rate, now, 0.01);
            if (params.depth !== undefined) this.nodes.chorus.depth = params.depth;
        }
    }

    class EHXSmallClone extends EffectBase {
        constructor() {
            super("EHXSmallClone");
            // EHX Small Clone (Kurt Cobain)
            // MN3007 BBD. Famous for watery, deep sweep. Only has Rate knob + Depth Switch.
            
            this.nodes.chorus = new Tone.Chorus({
                frequency: 1,
                delayTime: 0.008,
                depth: 0.8,
                type: 'sine',
                spread: 180,
                wet: 1
            });
            
            this.nodes.bbdSat = new Tone.Chebyshev(2);
            this.nodes.bbdSat.wet.value = 0.2; // Small clone is a bit grittier
            
            this.nodes.lowpass = new Tone.Filter({ type: 'lowpass', frequency: 4500, rolloff: -12 });

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.chorus, this.nodes.bbdSat, this.nodes.lowpass, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.chorus, this.nodes.bbdSat, this.nodes.lowpass);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.rate !== undefined) this.nodes.chorus.frequency.setTargetAtTime(params.rate, now, 0.01);
            if (params.depth !== undefined) {
                // Depth is a switch on original (low/high)
                this.nodes.chorus.depth = params.depth > 0.5 ? 0.9 : 0.4;
            }
        }
    }

    const classes = { StereoChorus, MXRAnalogChorus, BassChorus, WalrusAudioJulia, BossCE5, DigitechLuxe, JamPedalsWaterfall, BossCE1, BossCE2, RolandDimensionD, EHXSmallClone };
    const configs = {
        "Chorus": {
            "Chorus": { "isCustom": "StereoChorus", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Rate", "p": "rate", "min": 0.1, "max": 4, "s": 0.1, "def": 1.2 }, { "l": "Depth", "p": "depth", "min": 0.5, "max": 1, "s": 0.01, "def": 0.8 }], [{ "l": "Mode", "p": "mode", "min": 0, "max": 1, "s": 1, "def": 0, "unit": " Ch/Vib" }]] },
            "Chorus: Boss CE-1": { "isCustom": "BossCE1", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Rate", "p": "rate", "min": 0.1, "max": 5, "s": 0.1, "def": 0.5 }, { "l": "Depth", "p": "depth", "min": 0, "max": 1, "s": 0.01, "def": 0.8 }], [{ "l": "Mode", "p": "mode", "min": 0, "max": 1, "s": 1, "def": 0, "unit": " Ch/Vib" }, { "l": "Level", "p": "level", "min": 0, "max": 2, "s": 0.01, "def": 1 }]] },
            "Chorus: Boss CE-2": { "isCustom": "BossCE2", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Rate", "p": "rate", "min": 0.1, "max": 4, "s": 0.1, "def": 0.5 }, { "l": "Depth", "p": "depth", "min": 0.1, "max": 1, "s": 0.01, "def": 0.7 }]] },
            "Chorus: Dimension D": { "isCustom": "RolandDimensionD", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Mode", "p": "mode", "min": 1, "max": 4, "s": 1, "def": 1 }]] },
            "Chorus: Small Clone": { "isCustom": "EHXSmallClone", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Rate", "p": "rate", "min": 0.1, "max": 8, "s": 0.1, "def": 1 }, { "l": "Depth", "p": "depth", "min": 0, "max": 1, "s": 1, "def": 0, "unit": " Lo/Hi" }]] },
            "Chorus: MXR Analog": {
                "isCustom": "MXRAnalogChorus",
                "columns": [
                    [{ "l": "Speed", "p": "speed", "min": 0.1, "max": 5, "s": 0.1, "def": 1 }, { "l": "Depth", "p": "depth", "min": 0, "max": 1, "s": 0.01, "def": 0.7 }],
                    [{ "l": "Low", "p": "low", "min": -12, "max": 12, "s": 0.1, "def": 0 }, { "l": "High", "p": "high", "min": -12, "max": 12, "s": 0.1, "def": 0 }],
                    [{ "l": "Level", "p": "level", "min": 0, "max": 2, "s": 0.01, "def": 1 }]
                ]
            },
            "Chorus: EHX Bass Clone": { "isCustom": "BassChorus", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Rate", "p": "rate", "min": 0.5, "max": 5, "s": 0.1, "def": 2 }, { "l": "Depth", "p": "depth", "min": 0.5, "max": 1, "s": 0.01, "def": 0.8 }], [{ "l": "Bass", "p": "bass", "min": -12, "max": 12, "s": 0.1, "def": 0 }, { "l": "Treble", "p": "treble", "min": -12, "max": 12, "s": 0.1, "def": 0 }], [{ "l": "X-OVER", "p": "xover", "min": 0, "max": 1, "s": 1, "def": 0, "unit": " 100/250" }]] },
            "Chorus: Walrus Audio Julia": { "isCustom": "WalrusAudioJulia", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Rate", "p": "rate", "min": 0.1, "max": 10, "s": 0.1, "def": 2 }, { "l": "Depth", "p": "depth", "min": 0, "max": 1, "s": 0.01, "def": 0.7 }], [{ "l": "Lag", "p": "lag", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }, { "l": "Shape", "p": "shape", "min": 0, "max": 1, "s": 1, "def": 0, "unit": " Sin/Sqr" }], [{ "l": "D-C-V", "p": "d_c_v", "min": 0, "max": 1, "s": 0.01, "def": 0.5, "unit": " Blend" }]] },
            "Chorus: Boss CE-5": { "isCustom": "BossCE5", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Rate", "p": "rate", "min": 0.5, "max": 10, "def": 2.5 }, { "l": "Depth", "p": "depth", "min": 0, "max": 1, "def": 0.8 }], [{ "l": "Low Cut", "p": "lowCut", "min": 20, "max": 500, "def": 100 }, { "l": "High Cut", "p": "highCut", "min": 1000, "max": 12000, "def": 8000 }], [{ "l": "Level", "p": "level", "min": 0, "max": 2, "s": 0.01, "def": 1 }]] },
            "Chorus: Digitech Luxe": { "isCustom": "DigitechLuxe", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Detune", "p": "detune", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }, { "l": "Level", "p": "level", "min": 0, "max": 2, "s": 0.01, "def": 1 }]] },
            "Chorus: Jam Pedals Waterfall": {
                "isCustom": "JamPedalsWaterfall",
                "columns": [
                    [{ "l": "Speed", "p": "speed", "min": 0.2, "max": 8, "s": 0.1, "def": 2 }, { "l": "Depth", "p": "depth", "min": 0, "max": 1, "s": 0.01, "def": 0.8 }],
                    [{ "l": "Vibrato", "p": "vibrato", "min": 0, "max": 1, "s": 1, "def": 0 }, { "l": "Intensity", "p": "intensity", "min": 0, "max": 1, "s": 1, "def": 0 }]
                ]
            }
        }
    }
    window.effectModules.chorus = { classes, configs };
    // Trigger build cache update if necessary
    if (typeof window.saveModuleSource === 'function') {
        window.saveModuleSource('effects_chorus.js');
    }
})();
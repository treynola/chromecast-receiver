/*
 * Filename: effects_eq.js
 * Version: NOV25_AntiGravity Version 1.0
 * Date: November 25, 2025
 * Time: 16:35 CST
 * Description: Equalizer effects implementation.
 */
if (typeof window.effectModules === 'undefined') { window.effectModules = {}; }
if (typeof window.AppSource === 'undefined') { window.AppSource = {}; }

// --- REQUIRED BLOCK FOR DYNAMIC BUILD ---
if (typeof window.saveModuleSource === 'function') {
    window.saveModuleSource('effects_eq.js');
}
window.AppSource['effects_eq.js'] = `// [Full source code string for effects_eq.js v43.5]`;

(() => {
    const { EffectBase } = window;

    class GraphicEQ extends EffectBase {
        constructor(name, freqs, bandParams) {
            super(name);
            this.nodes.bands = freqs.map(f => new Tone.Filter({ type: 'peaking', frequency: f, Q: 1.41 }));
            this.nodes.level = new Tone.Gain(1);
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(...this.nodes.bands, this.nodes.level, this.nodes.stereoWidener);
            this._disposables.push(...this.nodes.bands, this.nodes.level);
            this.bandParams = bandParams;
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            this.bandParams.forEach((param, i) => {
                if (params[param] !== undefined) {
                    this.nodes.bands[i].gain.setTargetAtTime(params[param], now, 0.01);
                }
            });
            if (params.level !== undefined) this.nodes.level.gain.setTargetAtTime(Math.pow(10, params.level / 20), now, 0.01);
        }
    }

    class API550AEQ extends EffectBase {
        constructor() {
            super("API550AEQ");
            this.nodes.low = new Tone.Filter({ type: 'peaking', frequency: 200, Q: 1 });
            this.nodes.mid = new Tone.Filter({ type: 'peaking', frequency: 1500, Q: 1 });
            this.nodes.high = new Tone.Filter({ type: 'peaking', frequency: 7000, Q: 1 });

            // API 2520 Op-Amp characteristics (discrete op-amp saturation)
            this.nodes.opAmp = new Tone.Chebyshev(2);
            this.nodes.opAmp.wet.value = 0.1; // Subtle color by default

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.low, this.nodes.mid, this.nodes.high, this.nodes.opAmp, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.low, this.nodes.mid, this.nodes.high, this.nodes.opAmp);
        }
        _setProportionalQ(filterNode, gain, now) {
            const absGain = Math.abs(gain);
            filterNode.Q.setTargetAtTime(1 + (absGain / 12) * 4, now, 0.01);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.low !== undefined) {
                this.nodes.low.gain.setTargetAtTime(params.low, now, 0.01);
                this._setProportionalQ(this.nodes.low, params.low, now);
            }
            if (params.mid !== undefined) {
                this.nodes.mid.gain.setTargetAtTime(params.mid, now, 0.01);
                this._setProportionalQ(this.nodes.mid, params.mid, now);
            }
            if (params.high !== undefined) {
                this.nodes.high.gain.setTargetAtTime(params.high, now, 0.01);
                this._setProportionalQ(this.nodes.high, params.high, now);
            }
            if (params.lowFreq !== undefined) this.nodes.low.frequency.setTargetAtTime(params.lowFreq, now, 0.01);
            if (params.midFreq !== undefined) this.nodes.mid.frequency.setTargetAtTime(params.midFreq, now, 0.01);
            if (params.highFreq !== undefined) this.nodes.high.frequency.setTargetAtTime(params.highFreq, now, 0.01);

            if (params.drive !== undefined) {
                // Discrete Op-Amp Saturation
                this.nodes.opAmp.wet.setTargetAtTime(params.drive * 0.5, now, 0.01);
            }
        }
    }
    class BossGE7EQ extends GraphicEQ {
        constructor() {
            super("BossGE7EQ", [100, 200, 400, 800, 1600, 3200, 6400], ['b100', 'b200', 'b400', 'b800', 'b1k6', 'b3k2', 'b6k4']);
        }
    }
    class DODFX40BEqualizer extends GraphicEQ {
        constructor() {
            super("DODFX40BEqualizer", [100, 200, 400, 800, 1600, 3200, 6400], ['b100', 'b200', 'b400', 'b800', 'b1k6', 'b3k2', 'b6k4']);
        }
    }
    class EHXKnockout extends EffectBase {
        constructor() {
            super("EHXKnockout");
            this.nodes.lowPass = new Tone.Filter({ type: 'lowpass', frequency: 6000 });
            this.nodes.highPass = new Tone.Filter({ type: 'highpass', frequency: 100 });
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.lowPass, this.nodes.highPass, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.lowPass, this.nodes.highPass);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.low !== undefined) this.nodes.lowPass.frequency.setTargetAtTime(params.low, now, 0.01);
            if (params.high !== undefined) this.nodes.highPass.frequency.setTargetAtTime(params.high, now, 0.01);
        }
    }
    class EmpressParaEQ extends EffectBase {
        constructor() {
            super("EmpressParaEQ");
            this.nodes.low = new Tone.Filter({ type: 'peaking', frequency: 100, Q: 1 });
            this.nodes.mid = new Tone.Filter({ type: 'peaking', frequency: 1000, Q: 1 });
            this.nodes.high = new Tone.Filter({ type: 'peaking', frequency: 5000, Q: 1 });
            this.nodes.boost = new Tone.Gain(1);
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.low, this.nodes.mid, this.nodes.high, this.nodes.boost, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.low, this.nodes.mid, this.nodes.high, this.nodes.boost);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.lowFreq !== undefined) this.nodes.low.frequency.setTargetAtTime(params.lowFreq, now, 0.01);
            if (params.lowQ !== undefined) this.nodes.low.Q.setTargetAtTime(params.lowQ, now, 0.01);
            if (params.lowGain !== undefined) this.nodes.low.gain.setTargetAtTime(params.lowGain, now, 0.01);
            if (params.midFreq !== undefined) this.nodes.mid.frequency.setTargetAtTime(params.midFreq, now, 0.01);
            if (params.midQ !== undefined) this.nodes.mid.Q.setTargetAtTime(params.midQ, now, 0.01);
            if (params.midGain !== undefined) this.nodes.mid.gain.setTargetAtTime(params.midGain, now, 0.01);
            if (params.highFreq !== undefined) this.nodes.high.frequency.setTargetAtTime(params.highFreq, now, 0.01);
            if (params.highQ !== undefined) this.nodes.high.Q.setTargetAtTime(params.highQ, now, 0.01);
            if (params.highGain !== undefined) this.nodes.high.gain.setTargetAtTime(params.highGain, now, 0.01);
            if (params.boost !== undefined) this.nodes.boost.gain.setTargetAtTime(params.boost, now, 0.01);
        }
    }
    class IbanezPQ9 extends EffectBase {
        constructor() {
            super("IbanezPQ9");
            this.nodes.filter = new Tone.Filter({ type: 'peaking', frequency: 1000, Q: 1 });
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.filter, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.filter);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.frequency !== undefined) this.nodes.filter.frequency.setTargetAtTime(params.frequency, now, 0.01);
            if (params.q !== undefined) this.nodes.filter.Q.setTargetAtTime(params.q, now, 0.01);
            if (params.boostCut !== undefined) this.nodes.filter.gain.setTargetAtTime(params.boostCut, now, 0.01);
        }
    }
    class LangPEQ1 extends EffectBase {
        constructor() {
            super("LangPEQ1");
            this.nodes.low = new Tone.Filter({ type: 'lowshelf', frequency: 100 });
            this.nodes.mid = new Tone.Filter({ type: 'peaking', frequency: 1000, Q: 0.7 });
            this.nodes.high = new Tone.Filter({ type: 'highshelf', frequency: 10000 });
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.low, this.nodes.mid, this.nodes.high, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.low, this.nodes.mid, this.nodes.high);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.low !== undefined) this.nodes.low.gain.setTargetAtTime(params.low, now, 0.01);
            if (params.mid !== undefined) this.nodes.mid.gain.setTargetAtTime(params.mid, now, 0.01);
            if (params.high !== undefined) this.nodes.high.gain.setTargetAtTime(params.high, now, 0.01);
        }
    }
    class MaestroMPF extends EffectBase {
        constructor() {
            super("MaestroMPF");
            this.nodes.filter = new Tone.Filter({ type: 'peaking', frequency: 1000, Q: 1, gain: 15 });
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.filter, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.filter);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.frequency !== undefined) this.nodes.filter.frequency.setTargetAtTime(params.frequency, now, 0.01);
            if (params.bandwidth !== undefined) this.nodes.filter.Q.setTargetAtTime(params.bandwidth, now, 0.01);
            if (params.boostCut !== undefined) this.nodes.filter.gain.setTargetAtTime(params.boostCut, now, 0.01);
        }
    }
    class MXR10BandEQ extends EffectBase {
        constructor() {
            super("MXR10BandEQ");
            const freqs = [31.25, 62.5, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
            this.nodes.bands = freqs.map(f => new Tone.Filter({ type: 'peaking', frequency: f, Q: 1.41 }));
            this.nodes.volume = new Tone.Gain(1);
            this.nodes.gain = new Tone.Gain(1);
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.gain, ...this.nodes.bands, this.nodes.volume, this.nodes.stereoWidener);
            this._disposables.push(...this.nodes.bands, this.nodes.volume, this.nodes.gain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            const gains = [params.b31, params.b62, params.b125, params.b250, params.b500, params.b1k, params.b2k, params.b4k, params.b8k, params.b16k];
            gains.forEach((gain, i) => { if (gain !== undefined) this.nodes.bands[i].gain.setTargetAtTime(gain, now, 0.01); });
            if (params.volume !== undefined) this.nodes.volume.gain.setTargetAtTime(params.volume, now, 0.01);
            if (params.gain !== undefined) this.nodes.gain.gain.setTargetAtTime(params.gain, now, 0.01);
        }
    }
    class MXRSixBandEQ extends EffectBase {
        constructor() {
            super();
            const freqs = [100, 200, 400, 800, 1600, 3200];
            this.nodes.bands = freqs.map(f => new Tone.Filter({ type: 'peaking', frequency: f, Q: 1.41 }));
            this.nodes.level = new Tone.Gain(1);
            this.wet.chain(...this.nodes.bands, this.nodes.level, this.nodes.stereoWidener);
            this._disposables.push(...this.nodes.bands, this.nodes.level);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            const gains = [params.b100, params.b200, params.b400, params.b800, params.b1k6, params.b3k2];
            gains.forEach((gain, i) => { if (gain !== undefined) this.nodes.bands[i].gain.setTargetAtTime(gain, now, 0.01); });
            if (params.level !== undefined) this.nodes.level.gain.setTargetAtTime(Math.pow(10, params.level / 20), now, 0.01);
        }
    }
    class Neve1073EQ extends EffectBase {
        constructor() {
            // Neve 1073 (1970)
            // Designed by Rupert Neve
            // Class A discrete transistor design
            // Handcrafted UK inductors, Marinair transformers
            // HF: 12kHz shelf (+/-16dB)
            // MF: 360/700/1.6k/3.2k/4.8k/7.2kHz peaking (+/-18dB)
            // LF: 35/60/110/220Hz shelf (+/-16dB)
            // HPF: Off/50/80/160/300Hz (18dB/oct)
            super("Neve1073EQ");
            this._params = { high: 0, mid: 0, midFreq: 0.5, low: 0, lowFreq: 0.5, highPass: 0, drive: 0.1 };

            // High frequency shelf at 12kHz
            this.nodes.high = new Tone.Filter({ type: 'highshelf', frequency: 12000, gain: 0 });

            // Mid frequency peaking (inductor-based, musical character)
            this.nodes.mid = new Tone.Filter({ type: 'peaking', frequency: 1600, Q: 1.2, gain: 0 });

            // Low frequency shelf
            this.nodes.low = new Tone.Filter({ type: 'lowshelf', frequency: 110, gain: 0 });

            // High-pass filter (18dB/oct)
            this.nodes.highPass = new Tone.Filter({ type: 'highpass', frequency: 10, rolloff: -12 });

            // Transformer coloration (Marinair transformer character)
            this.nodes.transformer = new Tone.Filter({ type: 'peaking', frequency: 80, Q: 0.5, gain: 1 });

            // Class A preamp saturation (inductor/transformer warmth)
            this.nodes.preamp = new Tone.Chebyshev(2);
            this.nodes.preamp.wet.value = 0.15;

            // Output makeup gain
            this.nodes.makeup = new Tone.Gain(1.2);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(
                this.nodes.preamp,
                this.nodes.highPass,
                this.nodes.transformer,
                this.nodes.low,
                this.nodes.mid,
                this.nodes.high,
                this.nodes.makeup,
                this.nodes.stereoWidener
            );

            this._disposables.push(
                this.nodes.high, this.nodes.mid, this.nodes.low,
                this.nodes.highPass, this.nodes.transformer,
                this.nodes.preamp, this.nodes.makeup
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP_TIME = 0.05;

            if (params.high !== undefined) {
                // HF shelf: +/-16dB at 12kHz
                this.nodes.high.gain.setTargetAtTime(params.high, now, RAMP_TIME);
            }

            if (params.midFreq !== undefined) {
                // MF frequency selector: 360, 700, 1600, 3200, 4800, 7200 Hz
                const freqs = [360, 700, 1600, 3200, 4800, 7200];
                const freq = freqs[Math.floor(params.midFreq * (freqs.length - 0.1))];
                this.nodes.mid.frequency.setTargetAtTime(freq, now, RAMP_TIME);
            }

            if (params.mid !== undefined) {
                // MF gain: +/-18dB
                this.nodes.mid.gain.setTargetAtTime(params.mid, now, RAMP_TIME);
            }

            if (params.lowFreq !== undefined) {
                // LF frequency selector: 35, 60, 110, 220 Hz
                const freqs = [35, 60, 110, 220];
                const freq = freqs[Math.floor(params.lowFreq * (freqs.length - 0.1))];
                this.nodes.low.frequency.setTargetAtTime(freq, now, RAMP_TIME);
            }

            if (params.low !== undefined) {
                // LF gain: +/-16dB
                this.nodes.low.gain.setTargetAtTime(params.low, now, RAMP_TIME);
            }

            if (params.highPass !== undefined) {
                // HPF frequency: Off (10Hz), 50, 80, 160, 300 Hz
                const freqs = [10, 50, 80, 160, 300];
                const freq = freqs[Math.floor(params.highPass * (freqs.length - 0.1))];
                this.nodes.highPass.frequency.setTargetAtTime(freq, now, RAMP_TIME);
            }

            if (params.drive !== undefined) {
                // Preamp saturation amount
                this.nodes.preamp.wet.setTargetAtTime(params.drive * 0.4, now, RAMP_TIME);
            }
        }
    }
    class NobelsODR1Spectrum extends EffectBase {
        constructor() {
            super("NobelsODR1Spectrum");
            this.nodes.drive = new Tone.Distortion({ distortion: 0.5 });
            this.nodes.low = new Tone.Filter({ type: 'lowshelf', frequency: 200 });
            this.nodes.high = new Tone.Filter({ type: 'highshelf', frequency: 2000 });
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.drive, this.nodes.low, this.nodes.high, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.drive, this.nodes.low, this.nodes.high);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.drive !== undefined) this.nodes.drive.distortion = params.drive;
            if (params.spectrum !== undefined) {
                this.nodes.low.gain.setTargetAtTime(params.spectrum * 10, now, 0.01);
                this.nodes.high.gain.setTargetAtTime(params.spectrum * 10, now, 0.01);
            }
            if (params.level !== undefined) this.wet.gain.setTargetAtTime(params.level, now, 0.01);
        }
    }
    class PultecEQP1A extends EffectBase {
        constructor() {
            // Pultec EQP-1A (1950s)
            // Passive tube equalizer design
            // Famous "Pultec trick": Simultaneous boost and cut at same LF
            // Low boost: 20/30/60/100Hz shelf (+13.5dB max)
            // Low atten: Same frequencies (-17.5dB max, narrower Q)
            // High boost: 3/4/5/8/10/12/16kHz peak (+18dB, variable bandwidth)
            // High atten: 5/10/20kHz shelf (-16dB max)
            super("PultecEQP1A");
            this._params = {
                lowFreq: 0.5, lowBoost: 0, lowAtten: 0,
                highFreq: 0.5, highBoost: 0, bandwidth: 0.5,
                attenFreq: 0.5, highAtten: 0, drive: 0.2
            };

            // Low frequency shelf boost (wider Q)
            this.nodes.lowBoost = new Tone.Filter({ type: 'lowshelf', frequency: 60, gain: 0 });

            // Low frequency shelf attenuate (narrower Q, slightly higher corner)
            // This offset creates the resonant "bump" when both are used
            this.nodes.lowAtten = new Tone.Filter({ type: 'lowshelf', frequency: 66, gain: 0 });

            // High frequency peak boost with variable bandwidth (Q)
            this.nodes.highBoost = new Tone.Filter({ type: 'peaking', frequency: 8000, Q: 1, gain: 0 });

            // High frequency shelf attenuate
            this.nodes.highAtten = new Tone.Filter({ type: 'highshelf', frequency: 10000, gain: 0 });

            // Tube gain stage saturation (even harmonics)
            this.nodes.tube = new Tone.Chebyshev(2);
            this.nodes.tube.wet.value = 0.15;

            // Output transformer coloration
            this.nodes.transformer = new Tone.Filter({ type: 'lowshelf', frequency: 60, gain: 0.5 });

            // Makeup gain
            this.nodes.makeup = new Tone.Gain(1.2);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(
                this.nodes.lowBoost,
                this.nodes.lowAtten,
                this.nodes.highBoost,
                this.nodes.highAtten,
                this.nodes.tube,
                this.nodes.transformer,
                this.nodes.makeup,
                this.nodes.stereoWidener
            );

            this._disposables.push(
                this.nodes.lowBoost, this.nodes.lowAtten,
                this.nodes.highBoost, this.nodes.highAtten,
                this.nodes.tube, this.nodes.transformer, this.nodes.makeup
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP_TIME = 0.05;

            if (params.lowFreq !== undefined) {
                // Low frequency selector: 20, 30, 60, 100 Hz
                const freqs = [20, 30, 60, 100];
                const freq = freqs[Math.floor(params.lowFreq * (freqs.length - 0.1))];
                this.nodes.lowBoost.frequency.setTargetAtTime(freq, now, RAMP_TIME);
                // Atten corner is ~half octave higher (Pultec trick characteristic)
                this.nodes.lowAtten.frequency.setTargetAtTime(freq * 1.1, now, RAMP_TIME);
            }

            if (params.lowBoost !== undefined) {
                // Low boost: 0 to +13.5dB
                this.nodes.lowBoost.gain.setTargetAtTime(params.lowBoost, now, RAMP_TIME);
            }

            if (params.lowAtten !== undefined) {
                // Low atten: 0 to -17.5dB
                this.nodes.lowAtten.gain.setTargetAtTime(-params.lowAtten, now, RAMP_TIME);
            }

            if (params.highFreq !== undefined) {
                // High boost frequency: 3, 4, 5, 8, 10, 12, 16 kHz
                const freqs = [3000, 4000, 5000, 8000, 10000, 12000, 16000];
                const freq = freqs[Math.floor(params.highFreq * (freqs.length - 0.1))];
                this.nodes.highBoost.frequency.setTargetAtTime(freq, now, RAMP_TIME);
            }

            if (params.highBoost !== undefined) {
                // High boost: 0 to +18dB
                this.nodes.highBoost.gain.setTargetAtTime(params.highBoost, now, RAMP_TIME);
            }

            if (params.bandwidth !== undefined) {
                // Bandwidth control: Broad (Q 0.5) to Sharp (Q 3.5)
                this.nodes.highBoost.Q.setTargetAtTime(0.5 + (params.bandwidth * 3), now, RAMP_TIME);
            }

            if (params.attenFreq !== undefined) {
                // High atten frequency: 5, 10, 20 kHz
                const freqs = [5000, 10000, 20000];
                const freq = freqs[Math.floor(params.attenFreq * (freqs.length - 0.1))];
                this.nodes.highAtten.frequency.setTargetAtTime(freq, now, RAMP_TIME);
            }

            if (params.highAtten !== undefined) {
                // High atten: 0 to -16dB
                this.nodes.highAtten.gain.setTargetAtTime(-params.highAtten, now, RAMP_TIME);
            }

            if (params.drive !== undefined) {
                // Tube saturation amount
                this.nodes.tube.wet.setTargetAtTime(params.drive, now, RAMP_TIME);
            }
        }
    }
    class RolandBeeBaaFuzz extends EffectBase {
        constructor() {
            super("RolandBeeBaaFuzz");
            this.nodes.fuzz = new Tone.Distortion({ distortion: 0.8 });
            this.nodes.trebleBoost = new Tone.Filter({ type: 'highshelf', frequency: 2000, gain: 10 });
            this.nodes.fuzzTone = new Tone.Filter({ type: 'peaking', frequency: 1000, Q: 1 });
            this.nodes.fuzzBlend = new Tone.CrossFade(0);
            this.nodes.modeSwitch = new Tone.CrossFade(0);

            // Fuzz path
            this.wet.chain(this.nodes.fuzz, this.nodes.fuzzTone, this.nodes.fuzzBlend.a);

            // Treble Booster path
            this.wet.chain(this.nodes.trebleBoost, this.nodes.fuzzBlend.b);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.nodes.fuzzBlend.connect(this.nodes.stereoWidener);
            this._disposables.push(this.nodes.fuzz, this.nodes.trebleBoost, this.nodes.fuzzTone, this.nodes.fuzzBlend, this.nodes.modeSwitch);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.fuzz !== undefined) this.nodes.fuzz.distortion = params.fuzz;
            if (params.fuzzTone !== undefined) this.nodes.fuzzTone.frequency.setTargetAtTime(params.fuzzTone, now, 0.01);

            if (params.boosterAdj !== undefined) this.nodes.trebleBoost.gain.setTargetAtTime(params.boosterAdj, now, 0.01);
            if (params.mode !== undefined) this.nodes.fuzzBlend.fade.setTargetAtTime(params.mode, now, 0.01); // 0 = Fuzz, 1 = Treble Boost
            if (params.fuzzToneMode !== undefined) this.nodes.fuzzTone.type = params.fuzzToneMode > 0.5 ? 'highpass' : 'peaking';
        }
    }
    class SSLEChannelEQ extends EffectBase {
        constructor() {
            super("SSLEChannelEQ");
            this.nodes.highPass = new Tone.Filter({ type: 'highpass', frequency: 16 });
            this.nodes.lowPass = new Tone.Filter({ type: 'lowpass', frequency: 22000 });
            this.nodes.high = new Tone.Filter({ type: 'highshelf', frequency: 8000 });
            this.nodes.highMid = new Tone.Filter({ type: 'peaking', frequency: 3000, Q: 1.5 });
            this.nodes.lowMid = new Tone.Filter({ type: 'peaking', frequency: 500, Q: 1.5 });
            this.nodes.low = new Tone.Filter({ type: 'lowshelf', frequency: 200 });

            // SSL Console Saturation (Clean but punchy)
            this.nodes.preamp = new Tone.Chebyshev(2);
            this.nodes.preamp.wet.value = 0.05;

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.preamp, this.nodes.highPass, this.nodes.lowPass, this.nodes.high, this.nodes.highMid, this.nodes.lowMid, this.nodes.low, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.highPass, this.nodes.lowPass, this.nodes.high, this.nodes.highMid, this.nodes.lowMid, this.nodes.low, this.nodes.preamp);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.high !== undefined) this.nodes.high.gain.setTargetAtTime(params.high, now, 0.01);
            if (params.highMid !== undefined) this.nodes.highMid.gain.setTargetAtTime(params.highMid, now, 0.01);
            if (params.lowMid !== undefined) this.nodes.lowMid.gain.setTargetAtTime(params.lowMid, now, 0.01);
            if (params.low !== undefined) this.nodes.low.gain.setTargetAtTime(params.low, now, 0.01);
            if (params.highMidFreq !== undefined) this.nodes.highMid.frequency.setTargetAtTime(params.highMidFreq, now, 0.01);
            if (params.lowMidFreq !== undefined) this.nodes.lowMid.frequency.setTargetAtTime(params.lowMidFreq, now, 0.01);
            if (params.highPass !== undefined) this.nodes.highPass.frequency.setTargetAtTime(params.highPass, now, 0.01);
            if (params.lowPass !== undefined) this.nodes.lowPass.frequency.setTargetAtTime(params.lowPass, now, 0.01);

            if (params.drive !== undefined) {
                // Console Drive
                this.nodes.preamp.wet.setTargetAtTime(params.drive * 0.3, now, 0.01);
            }
        }
    }
    class SystechHarmonicEnergizer extends EffectBase {
        constructor() {
            super("SystechHarmonicEnergizer");
            this.nodes.filter = new Tone.Filter({ type: 'peaking', frequency: 500, Q: 10, gain: 15 });
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.filter, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.filter);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.frequency !== undefined) this.nodes.filter.frequency.setTargetAtTime(params.frequency, now, 0.01);
            if (params.peak !== undefined) this.nodes.filter.gain.setTargetAtTime(params.peak, now, 0.01);
            if (params.bandwidth !== undefined) this.nodes.filter.Q.setTargetAtTime(params.bandwidth, now, 0.01);
        }
    }


    class Urei546ParametricEQ extends EffectBase {
        constructor() {
            super("Urei546ParametricEQ");
            this.nodes.highPass = new Tone.Filter({ type: 'highpass', frequency: 20 });
            this.nodes.lowPass = new Tone.Filter({ type: 'lowpass', frequency: 20000 });
            this.nodes.band1 = new Tone.Filter({ type: 'peaking' });
            this.nodes.band2 = new Tone.Filter({ type: 'peaking' });
            this.nodes.band3 = new Tone.Filter({ type: 'peaking' });
            this.nodes.band4 = new Tone.Filter({ type: 'peaking' });
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.highPass, this.nodes.lowPass, this.nodes.band1, this.nodes.band2, this.nodes.band3, this.nodes.band4, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.highPass, this.nodes.lowPass, this.nodes.band1, this.nodes.band2, this.nodes.band3, this.nodes.band4);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.freq1 !== undefined) this.nodes.band1.frequency.setTargetAtTime(params.freq1, now, 0.01);
            if (params.q1 !== undefined) this.nodes.band1.Q.setTargetAtTime(params.q1, now, 0.01);
            if (params.gain1 !== undefined) this.nodes.band1.gain.setTargetAtTime(params.gain1, now, 0.01);
            if (params.freq2 !== undefined) this.nodes.band2.frequency.setTargetAtTime(params.freq2, now, 0.01);
            if (params.q2 !== undefined) this.nodes.band2.Q.setTargetAtTime(params.q2, now, 0.01);
            if (params.gain2 !== undefined) this.nodes.band2.gain.setTargetAtTime(params.gain2, now, 0.01);
            if (params.freq3 !== undefined) this.nodes.band3.frequency.setTargetAtTime(params.freq3, now, 0.01);
            if (params.q3 !== undefined) this.nodes.band3.Q.setTargetAtTime(params.q3, now, 0.01);
            if (params.gain3 !== undefined) this.nodes.band3.gain.setTargetAtTime(params.gain3, now, 0.01);
            if (params.freq4 !== undefined) this.nodes.band4.frequency.setTargetAtTime(params.freq4, now, 0.01);
            if (params.q4 !== undefined) this.nodes.band4.Q.setTargetAtTime(params.q4, now, 0.01);
            if (params.gain4 !== undefined) this.nodes.band4.gain.setTargetAtTime(params.gain4, now, 0.01);
            if (params.highPass !== undefined) this.nodes.highPass.frequency.setTargetAtTime(params.highPass, now, 0.01);
            if (params.lowPass !== undefined) this.nodes.lowPass.frequency.setTargetAtTime(params.lowPass, now, 0.01);
        }
    }
    class GML8200EQ extends EffectBase {
        constructor() {
            super("GML8200EQ");
            this.nodes.band1 = new Tone.Filter({ type: 'peaking', frequency: 100, Q: 1, gain: 0 });
            this.nodes.band2 = new Tone.Filter({ type: 'peaking', frequency: 500, Q: 1, gain: 0 });
            this.nodes.band3 = new Tone.Filter({ type: 'peaking', frequency: 2000, Q: 1, gain: 0 });
            this.nodes.band4 = new Tone.Filter({ type: 'peaking', frequency: 8000, Q: 1, gain: 0 });
            this.nodes.band5 = new Tone.Filter({ type: 'peaking', frequency: 15000, Q: 1, gain: 0 });

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(
                this.nodes.band1,
                this.nodes.band2,
                this.nodes.band3,
                this.nodes.band4,
                this.nodes.band5,
                this.nodes.stereoWidener
            );

            this._disposables.push(
                this.nodes.band1,
                this.nodes.band2,
                this.nodes.band3,
                this.nodes.band4,
                this.nodes.band5
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            const RAMP_TIME = 0.01;

            // Band 1
            if (params.b1Freq !== undefined) this.nodes.band1.frequency.setTargetAtTime(params.b1Freq, now, RAMP_TIME);
            if (params.b1Q !== undefined) this.nodes.band1.Q.setTargetAtTime(params.b1Q, now, RAMP_TIME);
            if (params.b1Gain !== undefined) this.nodes.band1.gain.setTargetAtTime(params.b1Gain, now, RAMP_TIME);

            // Band 2
            if (params.b2Freq !== undefined) this.nodes.band2.frequency.setTargetAtTime(params.b2Freq, now, RAMP_TIME);
            if (params.b2Q !== undefined) this.nodes.band2.Q.setTargetAtTime(params.b2Q, now, RAMP_TIME);
            if (params.b2Gain !== undefined) this.nodes.band2.gain.setTargetAtTime(params.b2Gain, now, RAMP_TIME);

            // Band 3
            if (params.b3Freq !== undefined) this.nodes.band3.frequency.setTargetAtTime(params.b3Freq, now, RAMP_TIME);
            if (params.b3Q !== undefined) this.nodes.band3.Q.setTargetAtTime(params.b3Q, now, RAMP_TIME);
            if (params.b3Gain !== undefined) this.nodes.band3.gain.setTargetAtTime(params.b3Gain, now, RAMP_TIME);

            // Band 4
            if (params.b4Freq !== undefined) this.nodes.band4.frequency.setTargetAtTime(params.b4Freq, now, RAMP_TIME);
            if (params.b4Q !== undefined) this.nodes.band4.Q.setTargetAtTime(params.b4Q, now, RAMP_TIME);
            if (params.b4Gain !== undefined) this.nodes.band4.gain.setTargetAtTime(params.b4Gain, now, RAMP_TIME);

            // Band 5
            if (params.b5Freq !== undefined) this.nodes.band5.frequency.setTargetAtTime(params.b5Freq, now, RAMP_TIME);
            if (params.b5Q !== undefined) this.nodes.band5.Q.setTargetAtTime(params.b5Q, now, RAMP_TIME);
            if (params.b5Gain !== undefined) this.nodes.band5.gain.setTargetAtTime(params.b5Gain, now, RAMP_TIME);
        }
    }
    class AlesisMEQ230 extends GraphicEQ {
        constructor() {
            super("AlesisMEQ230", [25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000], ['b25', 'b31', 'b40', 'b50', 'b63', 'b80', 'b100', 'b125', 'b160', 'b200', 'b250', 'b315', 'b400', 'b500', 'b630', 'b800', 'b1k', 'b1k2', 'b1k6', 'b2k', 'b2k5', 'b3k1', 'b4k', 'b5k', 'b6k3', 'b8k', 'b10k', 'b12k', 'b16k', 'b20k']);
        }
    }
    class DBX15BandEQ extends EffectBase {
        constructor() {
            super("DBX15BandEQ");
            const freqs = [25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000];
            this.nodes.bands = freqs.map(f => new Tone.Filter({ type: 'peaking', frequency: f, Q: 2.87 }));
            this.nodes.inputGain = new Tone.Gain(1);
            this.nodes.lowCut = new Tone.Filter({ type: 'highpass', frequency: 50 });
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.inputGain, this.nodes.lowCut, ...this.nodes.bands, this.nodes.stereoWidener);
            this._disposables.push(...this.nodes.bands, this.nodes.inputGain, this.nodes.lowCut);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            const bandKeys = ['b25', 'b40', 'b63', 'b100', 'b160', 'b250', 'b400', 'b630', 'b1k', 'b1k6', 'b2k5', 'b4k', 'b6k3', 'b10k', 'b16k'];
            const range = params.range === 0 ? 6 : 12; // 0 = +/-6dB, 1 = +/-12dB
            bandKeys.forEach((key, i) => {
                if (params[key] !== undefined) this.nodes.bands[i].gain.setTargetAtTime(params[key] * range / 12, now, 0.01);
            });
            if (params.inputGain !== undefined) this.wet.gain.setTargetAtTime(Math.pow(10, params.inputGain / 20), now, 0.01);
            if (params.lowCut !== undefined) this.nodes.lowCut.frequency.setTargetAtTime(params.lowCut > 0.5 ? 50 : 20, now, 0.01);
        }
    }
    class DBX2231 extends EffectBase {
        constructor() {
            super("DBX2231");
            const freqs = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000];
            this.nodes.bands = freqs.map(f => new Tone.Filter({ type: 'peaking', frequency: f, Q: 4.3 }));
            this.nodes.inputGain = new Tone.Gain(1);
            this.nodes.outputGain = new Tone.Gain(1);
            this.nodes.limiter = new Tone.Limiter(-10);
            this.nodes.lowCut = new Tone.Filter({ type: 'highpass', frequency: 40 });
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.inputGain, this.nodes.lowCut, ...this.nodes.bands, this.nodes.limiter, this.nodes.outputGain, this.nodes.stereoWidener);
            this._disposables.push(...this.nodes.bands, this.nodes.inputGain, this.nodes.outputGain, this.nodes.limiter, this.nodes.lowCut);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            const bandKeys = ['b20', 'b25', 'b31', 'b40', 'b50', 'b63', 'b80', 'b100', 'b125', 'b160', 'b200', 'b250', 'b315', 'b400', 'b500', 'b630', 'b800', 'b1k', 'b1k2', 'b1k6', 'b2k', 'b2k5', 'b3k1', 'b4k', 'b5k', 'b6k3', 'b8k', 'b10k', 'b12k', 'b16k', 'b20k'];
            const range = params.range === 0 ? 6 : 15; // 0 = +/-6dB, 1 = +/-15dB
            bandKeys.forEach((key, i) => {
                if (params[key] !== undefined && this.nodes.bands[i]) {
                    this.nodes.bands[i].gain.setTargetAtTime(params[key] * range / 15, now, 0.01);
                }
            });
            if (params.inputGain !== undefined) this.wet.gain.setTargetAtTime(Math.pow(10, params.inputGain / 20), now, 0.01);
            if (params.outputGain !== undefined) this.wet.gain.setTargetAtTime(Math.pow(10, params.outputGain / 20), now, 0.01);
            if (params.lowCut !== undefined) this.nodes.lowCut.frequency.setTargetAtTime(params.lowCut > 0.5 ? 40 : 20, now, 0.01);
            if (params.limiterThreshold !== undefined) this.nodes.limiter.threshold.setTargetAtTime(params.limiterThreshold, now, 0.01);
        }
    }
    class DrawmerDL241Compressor extends EffectBase {
        constructor() {
            super("DrawmerDL241Compressor");
            this.nodes.gate = new Tone.Gate({ threshold: -40 });
            this.nodes.comp = new Tone.Compressor({ threshold: -20, ratio: 2, attack: 0.01, release: 0.1 });
            this.nodes.limiter = new Tone.Limiter(-6);
            this.nodes.inputGain = new Tone.Gain(1);
            this.nodes.outputGain = new Tone.Gain(1);
            this.nodes.lowCut = new Tone.Filter({ type: 'highpass', frequency: 50 });

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.inputGain, this.nodes.lowCut, this.nodes.gate, this.nodes.comp, this.nodes.limiter, this.nodes.outputGain, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.gate, this.nodes.comp, this.nodes.limiter, this.nodes.inputGain, this.nodes.outputGain, this.nodes.lowCut);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.gateThreshold !== undefined) this.nodes.gate.threshold.value = params.gateThreshold;
            if (params.compThreshold !== undefined) this.nodes.comp.threshold.setTargetAtTime(params.compThreshold, now, 0.01);
            if (params.ratio !== undefined) this.nodes.comp.ratio.setTargetAtTime(params.ratio, now, 0.01);

            if (params.autoMode !== undefined && params.autoMode > 0.5) {
                this.nodes.comp.attack.value = 0.02; // Default auto attack
                this.nodes.comp.release.value = 0.2; // Default auto release
            } else {
                if (params.attack !== undefined) this.nodes.comp.attack.setTargetAtTime(params.attack, now, 0.01);
                if (params.release !== undefined) this.nodes.comp.release.setTargetAtTime(params.release, now, 0.01);
            }

            if (params.inputGain !== undefined) this.wet.gain.setTargetAtTime(Math.pow(10, params.inputGain / 20), now, 0.01);
            if (params.outputGain !== undefined) this.wet.gain.setTargetAtTime(Math.pow(10, params.outputGain / 20), now, 0.01);
            if (params.limiterThreshold !== undefined) this.nodes.limiter.threshold.setTargetAtTime(params.limiterThreshold, now, 0.01);
            if (params.lowCut !== undefined) this.nodes.lowCut.frequency.setTargetAtTime(params.lowCut > 0.5 ? 50 : 20, now, 0.01);
        }
    }

    const classes = { API550AEQ, BossGE7EQ, DODFX40BEqualizer, EHXKnockout, EmpressParaEQ, IbanezPQ9, LangPEQ1, MaestroMPF, MXR10BandEQ, MXRSixBandEQ, Neve1073EQ, NobelsODR1Spectrum, PultecEQP1A, RolandBeeBaaFuzz, SSLEChannelEQ, SystechHarmonicEnergizer, Urei546ParametricEQ, GML8200EQ, AlesisMEQ230, DBX15BandEQ, DBX2231, DrawmerDL241Compressor };
    const configs = {
        "EQ": {
            "EQ: API 550A": { "isCustom": "API550AEQ", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Low", "p": "low", "min": -12, "max": 12, "s": 0.1, "def": 0 }, { "l": "Low Freq", "p": "lowFreq", "min": 50, "max": 400, "s": 1, "def": 200 }], [{ "l": "Mid", "p": "mid", "min": -12, "max": 12, "s": 0.1, "def": 0 }, { "l": "Mid Freq", "p": "midFreq", "min": 400, "max": 5000, "s": 1, "def": 1500 }], [{ "l": "High", "p": "high", "min": -12, "max": 12, "s": 0.1, "def": 0 }, { "l": "High Freq", "p": "highFreq", "min": 5000, "max": 15000, "s": 1, "def": 7000 }, { "l": "Drive", "p": "drive", "min": 0, "max": 1, "s": 0.01, "def": 0.1 }]] }, "EQ: GML 8200": { "isCustom": "GML8200EQ", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "B1 Freq", "p": "b1Freq", "min": 20, "max": 300, "s": 1, "def": 100 }, { "l": "B1 Q", "p": "b1Q", "min": 0.4, "max": 15, "s": 0.1, "def": 1 }, { "l": "B1 Gain", "p": "b1Gain", "min": -15, "max": 15, "s": 0.1, "def": 0 }], [{ "l": "B2 Freq", "p": "b2Freq", "min": 100, "max": 1500, "s": 1, "def": 500 }, { "l": "B2 Q", "p": "b2Q", "min": 0.4, "max": 15, "s": 0.1, "def": 1 }, { "l": "B2 Gain", "p": "b2Gain", "min": -15, "max": 15, "s": 0.1, "def": 0 }], [{ "l": "B3 Freq", "p": "b3Freq", "min": 400, "max": 6000, "s": 1, "def": 2000 }, { "l": "B3 Q", "p": "b3Q", "min": 0.4, "max": 15, "s": 0.1, "def": 1 }, { "l": "B3 Gain", "p": "b3Gain", "min": -15, "max": 15, "s": 0.1, "def": 0 }], [{ "l": "B4 Freq", "p": "b4Freq", "min": 1500, "max": 18000, "s": 1, "def": 8000 }, { "l": "B4 Q", "p": "b4Q", "min": 0.4, "max": 15, "s": 0.1, "def": 1 }, { "l": "B4 Gain", "p": "b4Gain", "min": -15, "max": 15, "s": 0.1, "def": 0 }], [{ "l": "B5 Freq", "p": "b5Freq", "min": 4000, "max": 27000, "s": 1, "def": 15000 }, { "l": "B5 Q", "p": "b5Q", "min": 0.4, "max": 15, "s": 0.1, "def": 1 }, { "l": "B5 Gain", "p": "b5Gain", "min": -15, "max": 15, "s": 0.1, "def": 0 }]] }, "EQ: Boss GE-7": { "isCustom": "BossGE7EQ", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "100", "p": "b100", "min": -15, "max": 15, "s": 0.1, "def": 0 }, { "l": "200", "p": "b200", "min": -15, "max": 15, "s": 0.1, "def": 0 }], [{ "l": "400", "p": "b400", "min": -15, "max": 15, "s": 0.1, "def": 0 }, { "l": "800", "p": "b800", "min": -15, "max": 15, "s": 0.1, "def": 0 }], [{ "l": "1.6k", "p": "b1k6", "min": -15, "max": 15, "s": 0.1, "def": 0 }, { "l": "3.2k", "p": "b3k2", "min": -15, "max": 15, "s": 0.1, "def": 0 }], [{ "l": "6.4k", "p": "b6k4", "min": -15, "max": 15, "s": 0.1, "def": 0 }, { "l": "Level", "p": "level", "min": -15, "max": 15, "s": 0.1, "def": 0, "unit": "dB" }]] }, "EQ: DOD FX40B": { "isCustom": "DODFX40BEqualizer", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "100", "p": "b100", "min": -15, "max": 15, "s": 0.1, "def": 0 }, { "l": "200", "p": "b200", "min": -15, "max": 15, "s": 0.1, "def": 0 }], [{ "l": "400", "p": "b400", "min": -15, "max": 15, "s": 0.1, "def": 0 }, { "l": "800", "p": "b800", "min": -15, "max": 15, "s": 0.1, "def": 0 }], [{ "l": "1.6k", "p": "b1k6", "min": -15, "max": 15, "s": 0.1, "def": 0 }, { "l": "3.2k", "p": "b3k2", "min": -15, "max": 15, "s": 0.1, "def": 0 }], [{ "l": "6.4k", "p": "b6k4", "min": -15, "max": 15, "s": 0.1, "def": 0 }, { "l": "Level", "p": "level", "min": -15, "max": 15, "s": 0.1, "def": 0, "unit": "dB" }]] }, "EQ: EHX Knockout": { "isCustom": "EHXKnockout", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Low", "p": "low", "min": 1000, "max": 10000, "def": 6000 }, { "l": "High", "p": "high", "min": 50, "max": 500, "def": 100 }]] }, "EQ: Empress ParaEQ": { "isCustom": "EmpressParaEQ", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Low Freq", "p": "lowFreq", "min": 35, "max": 500, "def": 100 }, { "l": "Low Q", "p": "lowQ", "min": 0.5, "max": 10, "def": 1 }, { "l": "Low Gain", "p": "lowGain", "min": -15, "max": 15, "def": 0 }], [{ "l": "Mid Freq", "p": "midFreq", "min": 250, "max": 5000, "def": 1000 }, { "l": "Mid Q", "p": "midQ", "min": 0.5, "max": 10, "def": 1 }, { "l": "Mid Gain", "p": "midGain", "min": -15, "max": 15, "def": 0 }], [{ "l": "High Freq", "p": "highFreq", "min": 1000, "max": 20000, "def": 5000 }, { "l": "High Q", "p": "highQ", "min": 0.5, "max": 10, "def": 1 }, { "l": "High Gain", "p": "highGain", "min": -15, "max": 15, "def": 0 }], [{ "l": "Boost", "p": "boost", "min": 1, "max": 10, "def": 1 }]] }, "EQ: Ibanez PQ-9": { "isCustom": "IbanezPQ9", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Frequency", "p": "frequency", "min": 100, "max": 6400, "def": 1000 }, { "l": "Q", "p": "q", "min": 0.5, "max": 10, "def": 1 }], [{ "l": "Boost/Cut", "p": "boostCut", "min": -15, "max": 15, "def": 0 }]] }, "EQ: Lang PEQ-1": { "isCustom": "LangPEQ1", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Low", "p": "low", "min": -12, "max": 12, "def": 0 }, { "l": "Mid", "p": "mid", "min": -12, "max": 12, "def": 0 }], [{ "l": "High", "p": "high", "min": -12, "max": 12, "def": 0 }]] }, "EQ: Maestro MPF": { "isCustom": "MaestroMPF", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Frequency", "p": "frequency", "min": 100, "max": 10000, "def": 1000 }, { "l": "Bandwidth", "p": "bandwidth", "min": 0.5, "max": 10, "def": 1 }], [{ "l": "Boost/Cut", "p": "boostCut", "min": -15, "max": 15, "def": 15 }]] }, "EQ: MXR 10-Band": { "isCustom": "MXR10BandEQ", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "31", "p": "b31", "min": -12, "max": 12, "def": 0 }, { "l": "62", "p": "b62", "min": -12, "max": 12, "def": 0 }], [{ "l": "125", "p": "b125", "min": -12, "max": 12, "def": 0 }, { "l": "250", "p": "b250", "min": -12, "max": 12, "def": 0 }], [{ "l": "500", "p": "b500", "min": -12, "max": 12, "def": 0 }, { "l": "1k", "p": "b1k", "min": -12, "max": 12, "def": 0 }], [{ "l": "2k", "p": "b2k", "min": -12, "max": 12, "def": 0 }, { "l": "4k", "p": "b4k", "min": -12, "max": 12, "def": 0 }], [{ "l": "8k", "p": "b8k", "min": -12, "max": 12, "def": 0 }, { "l": "16k", "p": "b16k", "min": -12, "max": 12, "def": 0 }], [{ "l": "Volume", "p": "volume", "min": 0, "max": 2, "def": 1 }, { "l": "Gain", "p": "gain", "min": 0, "max": 2, "def": 1 }]] }, "EQ: MXR 6-Band": { "isCustom": "MXRSixBandEQ", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "100", "p": "b100", "min": -18, "max": 18, "def": 0 }, { "l": "200", "p": "b200", "min": -18, "max": 18, "def": 0 }], [{ "l": "400", "p": "b400", "min": -18, "max": 18, "def": 0 }, { "l": "800", "p": "b800", "min": -18, "max": 18, "def": 0 }], [{ "l": "1.6k", "p": "b1k6", "min": -18, "max": 18, "def": 0 }, { "l": "3.2k", "p": "b3k2", "min": -18, "max": 18, "def": 0 }], [{ "l": "Level", "p": "level", "min": -18, "max": 18, "def": 0, "unit": "dB" }]] }, "EQ: Neve 1073": {
                "isCustom": "Neve1073EQ",
                "columns": [
                    [{ "l": "High Shelf", "p": "high", "min": -16, "max": 16, "s": 0.1, "def": 0 }, { "l": "Drive", "p": "drive", "min": 0, "max": 1, "s": 0.01, "def": 0.1 }],
                    [{ "l": "Mid Gain", "p": "mid", "min": -18, "max": 18, "s": 0.1, "def": 0 }, { "l": "Mid Freq", "p": "midFreq", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }],
                    [{ "l": "Low Gain", "p": "low", "min": -16, "max": 16, "s": 0.1, "def": 0 }, { "l": "Low Freq", "p": "lowFreq", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }],
                    [{ "l": "HPF Freq", "p": "highPass", "min": 0, "max": 1, "s": 0.01, "def": 0 }]
                ]
            },
            "EQ: Nobels ODR-1 Spectrum": { "isCustom": "NobelsODR1Spectrum", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Drive", "p": "drive", "min": 0, "max": 1, "def": 0.5 }, { "l": "Spectrum", "p": "spectrum", "min": -1, "max": 1, "def": 0 }], [{ "l": "Level", "p": "level", "min": 0, "max": 2, "def": 1 }]] }, "EQ: Pultec EQP-1A": {
                "isCustom": "PultecEQP1A",
                "columns": [
                    [{ "l": "Low Boost", "p": "lowBoost", "min": 0, "max": 12, "s": 0.1, "def": 0 }, { "l": "Low Atten", "p": "lowAtten", "min": 0, "max": 12, "s": 0.1, "def": 0 }, { "l": "Low Freq", "p": "lowFreq", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }],
                    [{ "l": "Hi Boost", "p": "highBoost", "min": 0, "max": 12, "s": 0.1, "def": 0 }, { "l": "Hi Freq", "p": "highFreq", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }, { "l": "B-Width", "p": "bandwidth", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }],
                    [{ "l": "Hi Atten", "p": "highAtten", "min": 0, "max": 12, "s": 0.1, "def": 0 }, { "l": "Atten Freq", "p": "attenFreq", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }, { "l": "Tube Drive", "p": "drive", "min": 0, "max": 1, "s": 0.01, "def": 0.1 }]
                ]
            },
            "Fuzz: Roland BeeBaa": { "isCustom": "RolandBeeBaaFuzz", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Fuzz", "p": "fuzz", "min": 0, "max": 1, "def": 0.8 }, { "l": "Fuzz Tone", "p": "fuzzTone", "min": 200, "max": 3000, "def": 1000 }], [{ "l": "Sustain", "p": "sustain", "min": 0, "max": 1, "s": 1, "def": 0 }, { "l": "Booster Adj", "p": "boosterAdj", "min": 0, "max": 20, "def": 10 }], [{ "l": "Mode", "p": "mode", "min": 0, "max": 1, "s": 1, "def": 0 }, { "l": "Fuzz Tone Mode", "p": "fuzzToneMode", "min": 0, "max": 1, "s": 1, "def": 0 }]] }, "EQ: SSL E-Channel": { "isCustom": "SSLEChannelEQ", "columns": [[{ "l": "High", "p": "high", "min": -15, "max": 15, "def": 0 }, { "l": "High Mid", "p": "highMid", "min": -15, "max": 15, "def": 0 }], [{ "l": "Low Mid", "p": "lowMid", "min": -15, "max": 15, "def": 0 }, { "l": "Low", "p": "low", "min": -15, "max": 15, "def": 0 }], [{ "l": "High Mid Freq", "p": "highMidFreq", "min": 600, "max": 7000, "def": 3000 }, { "l": "Low Mid Freq", "p": "lowMidFreq", "min": 200, "max": 2500, "def": 500 }], [{ "l": "High Pass", "p": "highPass", "min": 16, "max": 350, "def": 16 }, { "l": "Low Pass", "p": "lowPass", "min": 3000, "max": 22000, "def": 22000 }, { "l": "Drive", "p": "drive", "min": 0, "max": 1, "s": 0.01, "def": 0 }],] }, "EQ: Systech Harmonic Energizer": { "isCustom": "SystechHarmonicEnergizer", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Frequency", "p": "frequency", "min": 100, "max": 10000, "def": 500 }, { "l": "Peak", "p": "peak", "min": 0, "max": 30, "def": 15 }], [{ "l": "Bandwidth", "p": "bandwidth", "min": 1, "max": 20, "def": 10 }]] }, "EQ: Urei 546 Parametric": { "isCustom": "Urei546ParametricEQ", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Freq 1", "p": "freq1", "min": 20, "max": 200, "def": 100 }, { "l": "Q 1", "p": "q1", "min": 0.5, "max": 10, "def": 1 }, { "l": "Gain 1", "p": "gain1", "min": -15, "max": 15, "def": 0 }], [{ "l": "Freq 2", "p": "freq2", "min": 100, "max": 1000, "def": 500 }, { "l": "Q 2", "p": "q2", "min": 0.5, "max": 10, "def": 1 }, { "l": "Gain 2", "p": "gain2", "min": -15, "max": 15, "def": 0 }], [{ "l": "Freq 3", "p": "freq3", "min": 500, "max": 5000, "def": 2500 }, { "l": "Q 3", "p": "q3", "min": 0.5, "max": 10, "def": 1 }, { "l": "Gain 3", "p": "gain3", "min": -15, "max": 15, "def": 0 }], [{ "l": "Freq 4", "p": "freq4", "min": 2000, "max": 20000, "def": 10000 }, { "l": "Q 4", "p": "q4", "min": 0.5, "max": 10, "def": 1 }, { "l": "Gain 4", "p": "gain4", "min": -15, "max": 15, "def": 0 }], [{ "l": "High Pass", "p": "highPass", "min": 20, "max": 500, "def": 20 }, { "l": "Low Pass", "p": "lowPass", "min": 2000, "max": 20000, "def": 20000 }]] }, "Graphic EQ: Alesis MEQ-230": { "isCustom": "AlesisMEQ230", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "25", "p": "b25", "min": -12, "max": 12, "def": 0 }, { "l": "31", "p": "b31", "min": -12, "max": 12, "def": 0 }], [{ "l": "40", "p": "b40", "min": -12, "max": 12, "def": 0 }, { "l": "50", "p": "b50", "min": -12, "max": 12, "def": 0 }], [{ "l": "63", "p": "b63", "min": -12, "max": 12, "def": 0 }, { "l": "80", "p": "b80", "min": -12, "max": 12, "def": 0 }], [{ "l": "100", "p": "b100", "min": -12, "max": 12, "def": 0 }, { "l": "125", "p": "b125", "min": -12, "max": 12, "def": 0 }], [{ "l": "160", "p": "b160", "min": -12, "max": 12, "def": 0 }, { "l": "200", "p": "b200", "min": -12, "max": 12, "def": 0 }], [{ "l": "250", "p": "b250", "min": -12, "max": 12, "def": 0 }, { "l": "315", "p": "b315", "min": -12, "max": 12, "def": 0 }], [{ "l": "400", "p": "b400", "min": -12, "max": 12, "def": 0 }, { "l": "500", "p": "b500", "min": -12, "max": 12, "def": 0 }], [{ "l": "630", "p": "b630", "min": -12, "max": 12, "def": 0 }, { "l": "800", "p": "b800", "min": -12, "max": 12, "def": 0 }], [{ "l": "1k", "p": "b1k", "min": -12, "max": 12, "def": 0 }, { "l": "1.2k", "p": "b1k2", "min": -12, "max": 12, "def": 0 }], [{ "l": "1.6k", "p": "b1k6", "min": -12, "max": 12, "def": 0 }, { "l": "2k", "p": "b2k", "min": -12, "max": 12, "def": 0 }], [{ "l": "2.5k", "p": "b2k5", "min": -12, "max": 12, "def": 0 }, { "l": "3.1k", "p": "b3k1", "min": -12, "max": 12, "def": 0 }], [{ "l": "4k", "p": "b4k", "min": -12, "max": 12, "def": 0 }, { "l": "5k", "p": "b5k", "min": -12, "max": 12, "def": 0 }], [{ "l": "6.3k", "p": "b6k3", "min": -12, "max": 12, "def": 0 }, { "l": "8k", "p": "b8k", "min": -12, "max": 12, "def": 0 }], [{ "l": "10k", "p": "b10k", "min": -12, "max": 12, "def": 0 }, { "l": "12k", "p": "b12k", "min": -12, "max": 12, "def": 0 }], [{ "l": "16k", "p": "b16k", "min": -12, "max": 12, "def": 0 }, { "l": "20k", "p": "b20k", "min": -12, "max": 12, "def": 0 }], [{ "l": "Level", "p": "level", "min": -12, "max": 12, "def": 0, "unit": "dB" }]] }, "Graphic EQ: DBX 15-Band": { "isCustom": "DBX15BandEQ", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "25", "p": "b25", "min": -12, "max": 12, "def": 0 }, { "l": "40", "p": "b40", "min": -12, "max": 12, "def": 0 }], [{ "l": "63", "p": "b63", "min": -12, "max": 12, "def": 0 }, { "l": "100", "p": "b100", "min": -12, "max": 12, "def": 0 }], [{ "l": "160", "p": "b160", "min": -12, "max": 12, "def": 0 }, { "l": "250", "p": "b250", "min": -12, "max": 12, "def": 0 }], [{ "l": "400", "p": "b400", "min": -12, "max": 12, "def": 0 }, { "l": "630", "p": "b630", "min": -12, "max": 12, "def": 0 }], [{ "l": "1k", "p": "b1k", "min": -12, "max": 12, "def": 0 }, { "l": "1.6k", "p": "b1k6", "min": -12, "max": 12, "def": 0 }], [{ "l": "2.5k", "p": "b2k5", "min": -12, "max": 12, "def": 0 }, { "l": "4k", "p": "b4k", "min": -12, "max": 12, "def": 0 }], [{ "l": "6.3k", "p": "b6k3", "min": -12, "max": 12, "def": 0 }, { "l": "10k", "p": "b10k", "min": -12, "max": 12, "def": 0 }], [{ "l": "16k", "p": "b16k", "min": -12, "max": 12, "def": 0 }, { "l": "Input Gain", "p": "inputGain", "min": -12, "max": 12, "def": 0 }], [{ "l": "Range", "p": "range", "min": 0, "max": 1, "s": 1, "def": 0 }, { "l": "Low Cut", "p": "lowCut", "min": 0, "max": 1, "s": 1, "def": 0 }]] }, "Graphic EQ: DBX 2231": { "isCustom": "DBX2231", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "20", "p": "b20", "min": -15, "max": 15, "def": 0 }, { "l": "25", "p": "b25", "min": -15, "max": 15, "def": 0 }], [{ "l": "31", "p": "b31", "min": -15, "max": 15, "def": 0 }, { "l": "40", "p": "b40", "min": -15, "max": 15, "def": 0 }], [{ "l": "50", "p": "b50", "min": -15, "max": 15, "def": 0 }, { "l": "63", "p": "b63", "min": -15, "max": 15, "def": 0 }], [{ "l": "80", "p": "b80", "min": -15, "max": 15, "def": 0 }, { "l": "100", "p": "b100", "min": -15, "max": 15, "def": 0 }], [{ "l": "125", "p": "b125", "min": -15, "max": 15, "def": 0 }, { "l": "160", "p": "b160", "min": -15, "max": 15, "def": 0 }], [{ "l": "200", "p": "b200", "min": -15, "max": 15, "def": 0 }, { "l": "250", "p": "b250", "min": -15, "max": 15, "def": 0 }], [{ "l": "315", "p": "b315", "min": -15, "max": 15, "def": 0 }, { "l": "400", "p": "b400", "min": -15, "max": 15, "def": 0 }], [{ "l": "500", "p": "b500", "min": -15, "max": 15, "def": 0 }, { "l": "630", "p": "b630", "min": -15, "max": 15, "def": 0 }], [{ "l": "800", "p": "b800", "min": -15, "max": 15, "def": 0 }, { "l": "1k", "p": "b1k", "min": -15, "max": 15, "def": 0 }], [{ "l": "1.2k", "p": "b1k2", "min": -15, "max": 15, "def": 0 }, { "l": "1.6k", "p": "b1k6", "min": -15, "max": 15, "def": 0 }], [{ "l": "2k", "p": "b2k", "min": -15, "max": 15, "def": 0 }, { "l": "2.5k", "p": "b2k5", "min": -15, "max": 15, "def": 0 }], [{ "l": "3.1k", "p": "b3k1", "min": -15, "max": 15, "def": 0 }, { "l": "4k", "p": "b4k", "min": -15, "max": 15, "def": 0 }], [{ "l": "5k", "p": "b5k", "min": -15, "max": 15, "def": 0 }, { "l": "6.3k", "p": "b6k3", "min": -15, "max": 15, "def": 0 }], [{ "l": "8k", "p": "b8k", "min": -15, "max": 15, "def": 0 }, { "l": "10k", "p": "b10k", "min": -15, "max": 15, "def": 0 }], [{ "l": "12k", "p": "b12k", "min": -15, "max": 15, "def": 0 }, { "l": "16k", "p": "b16k", "min": -15, "max": 15, "def": 0 }], [{ "l": "20k", "p": "b20k", "min": -15, "max": 15, "def": 0 }, { "l": "Input Gain", "p": "inputGain", "min": -12, "max": 12, "def": 0 }], [{ "l": "Output Gain", "p": "outputGain", "min": -12, "max": 12, "def": 0 }, { "l": "Range", "p": "range", "min": 0, "max": 1, "s": 1, "def": 0 }], [{ "l": "Low Cut", "p": "lowCut", "min": 0, "max": 1, "s": 1, "def": 0 }, { "l": "Limiter Thresh", "p": "limiterThreshold", "min": -20, "max": 20, "def": 0 }]] }, "Comp: Drawmer DL241": { "isCustom": "DrawmerDL241Compressor", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Gate Thresh", "p": "gateThreshold", "min": -70, "max": 0, "def": -40 }, { "l": "Comp Thresh", "p": "compThreshold", "min": -40, "max": 20, "def": -20 }], [{ "l": "Ratio", "p": "ratio", "min": 1, "max": 20, "def": 2 }, { "l": "Attack", "p": "attack", "min": 0.001, "max": 0.1, "def": 0.01 }], [{ "l": "Release", "p": "release", "min": 0.05, "max": 2, "def": 0.1 }, { "l": "Auto Mode", "p": "autoMode", "min": 0, "max": 1, "s": 1, "def": 0 }], [{ "l": "Input Gain", "p": "inputGain", "min": -20, "max": 20, "def": 0 }, { "l": "Output Gain", "p": "outputGain", "min": -20, "max": 20, "def": 0 }], [{ "l": "Limiter Thresh", "p": "limiterThreshold", "min": -10, "max": 20, "def": -6 }, { "l": "Low Cut", "p": "lowCut", "min": 0, "max": 1, "s": 1, "def": 0 }]] }
        }
    }
    window.effectModules.eq = { classes, configs };
})();
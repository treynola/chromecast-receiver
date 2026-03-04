/*
 * Filename: effects_tremolo.js
 * Version: NOV25_AntiGravity Version 1.0
 * Date: November 25, 2025
 * Time: 17:00 CST
 * Description: Tremolo effects implementation.
 */
if (typeof window.effectModules === 'undefined') { window.effectModules = {}; }
if (typeof window.AppSource === 'undefined') { window.AppSource = {}; }

// --- REQUIRED BLOCK FOR DYNAMIC BUILD ---
if (typeof window.saveModuleSource === 'function') {
    window.saveModuleSource('effects_tremolo.js');
}
window.AppSource['effects_tremolo.js'] = `// [Full source code string for effects_tremolo.js]`;

(() => {
    const { EffectBase } = window;

    class FenderOptoTremolo extends EffectBase {
        constructor() {
            super("FenderOptoTremolo");
            // Emulates the "Roach" optocoupler of Blackface Fender amps.
            // Characteristic: Asymmetric rise/fall, "throb" rather than clean sine.
            // LFO drives a light bulb which changes resistance of LDR.

            this.nodes.lfo = new Tone.LFO({ frequency: 5, min: 0, max: 1 });
            // Roach physics: The light bulb has thermal lag. 
            // We simulate this by shaping the LFO wave to be slightly lop-sided.
            // A sine wave raised to a power creates a sharper peak and wider trough (or vice versa).
            // "The Roach" is known for a 'choppy' but smooth character.

            this.nodes.shaper = new Tone.WaveShaper((x) => {
                // Input x is -1 to 1 (sine). Map to 0-1 brightness curve with lag.
                const norm = (x + 1) / 2;
                // Opto response: nonlinear. deeply dips volume.
                return 1 - (Math.pow(norm, 1.5));
            });

            this.nodes.gain = new Tone.Gain(1);

            // Tube Recovery Stage (Make-up gain + warmth)
            this.nodes.tube = new Tone.Chebyshev(2);
            this.nodes.tube.wet.value = 0.15;

            this.nodes.lfo.start();
            this.nodes.lfo.connect(this.nodes.shaper);
            this.nodes.shaper.connect(this.nodes.gain.gain);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.gain, this.nodes.tube, this.nodes.stereoWidener);

            this._disposables.push(this.nodes.lfo, this.nodes.shaper, this.nodes.gain, this.nodes.tube);
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.speed !== undefined) this.nodes.lfo.frequency.setTargetAtTime(params.speed, now, 0.01);
            if (params.intensity !== undefined) {
                // Intensity controls how deep the bulb dims
                this.nodes.lfo.amplitude.setTargetAtTime(params.intensity, now, 0.01);
            }
        }
    }

    class HarmonicTremolo extends EffectBase {
        constructor() {
            super("HarmonicTremolo");
            // Emulates Fender Brownface (early 60s) Harmonic Vibrato/Tremolo.
            // Splits signal into High and Low bands.
            // Modulates them 180 degrees out of phase.
            // Result: A swirling, phaser-like tremolo, not just volume ducking.

            this.nodes.split = new Tone.Split();

            // Crossover at ~800Hz
            this.nodes.lowFilter = new Tone.Filter({ type: 'lowpass', frequency: 800, rolloff: -12 });
            this.nodes.highFilter = new Tone.Filter({ type: 'highpass', frequency: 800, rolloff: -12 });

            this.nodes.lowGain = new Tone.Gain(1);
            this.nodes.highGain = new Tone.Gain(1);

            this.nodes.lfo = new Tone.LFO({ frequency: 5, min: 0, max: 1 });
            this.nodes.lfo.start();

            // Invert LFO for High band
            this.nodes.invert = new Tone.Gain(-1);
            this.nodes.offset = new Tone.Signal(1); // To shift back to 0-1 range after inversion if needed
            // Actually simpler: LFO goes 0-1.
            // Low Gain takes LFO directly.
            // High Gain takes (1 - LFO).

            this.nodes.lfo.connect(this.nodes.lowGain.gain);

            // Create "1 - LFO" signal
            this.nodes.negate = new Tone.Gain(-1);
            this.nodes.constOne = new Tone.Signal(1);
            this.nodes.sum = new Tone.Add();

            this.nodes.lfo.connect(this.nodes.negate);
            this.nodes.negate.connect(this.nodes.sum, 0, 0);
            this.nodes.constOne.connect(this.nodes.sum, 0, 1);
            this.nodes.sum.connect(this.nodes.highGain.gain);

            this.nodes.merger = new Tone.Merge();

            this.wet.disconnect(this.nodes.stereoWidener);

            // Signal flow
            this.wet.fan(this.nodes.lowFilter, this.nodes.highFilter);
            this.nodes.lowFilter.connect(this.nodes.lowGain);
            this.nodes.highFilter.connect(this.nodes.highGain);

            this.nodes.lowGain.connect(this.nodes.merger, 0, 0); // Mono sum or keep stereo? vintage units were mono.
            this.nodes.highGain.connect(this.nodes.merger, 0, 0);

            // To output
            this.nodes.merger.connect(this.nodes.stereoWidener);

            this._disposables.push(
                this.nodes.lfo, this.nodes.lowFilter, this.nodes.highFilter,
                this.nodes.lowGain, this.nodes.highGain,
                this.nodes.negate, this.nodes.constOne, this.nodes.sum, this.nodes.merger
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.speed !== undefined) this.nodes.lfo.frequency.setTargetAtTime(params.speed, now, 0.01);
            if (params.intensity !== undefined) this.nodes.lfo.amplitude.setTargetAtTime(params.intensity, now, 0.01);
        }
    }

    class BossTR2 extends EffectBase {
        constructor() {
            super("BossTR2");
            // Boss TR-2: Classic VCA Tremolo.
            // Key Feature: Waveform knob (Triangle to Square).

            this.nodes.lfo = new Tone.LFO({ frequency: 5, min: 0, max: 1 });
            this.nodes.lfo.start();

            this.nodes.gain = new Tone.Gain(1);
            this.nodes.lfo.connect(this.nodes.gain.gain);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.gain, this.nodes.stereoWidener);

            this._disposables.push(this.nodes.lfo, this.nodes.gain);
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.rate !== undefined) this.nodes.lfo.frequency.setTargetAtTime(params.rate, now, 0.01);
            if (params.depth !== undefined) {
                // Map depth to LFO amplitude/min/max
                // 0 depth = gain 1 constant
                // 1 depth = gain fluctuates 0-1
                const d = params.depth;
                this.nodes.lfo.min = 1 - d;
                this.nodes.lfo.max = 1;
            }
            if (params.wave !== undefined) {
                // 0 = Triangle, 1 = Square
                // Tone.LFO type can be blended if using custom shaper, but direct type switching is easier.
                // TR-2 knob blends. We can approximate with type switching or shaper.
                // Authenticity: TR-2 blends.
                if (params.wave < 0.3) this.nodes.lfo.type = 'triangle';
                else if (params.wave > 0.7) this.nodes.lfo.type = 'square';
                else this.nodes.lfo.type = 'sine'; // Middle ground
            }
        }
    }

    class BiasTremolo extends EffectBase {
        constructor() {
            super("BiasTremolo");
            // Emulates "Princeton" style output tube bias modulation.
            // As volume dips, the tone gets cleaner. As volume peaks, it saturates slightly.
            // Very swampy, organic feel.

            this.nodes.lfo = new Tone.LFO({ frequency: 4, min: 0.2, max: 1, type: 'sine' }).start();
            this.nodes.gain = new Tone.Gain(1);

            // Saturation that tracks with the LFO
            this.nodes.saturator = new Tone.Chebyshev(2);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.saturator, this.nodes.gain, this.nodes.stereoWidener);

            this.nodes.lfo.connect(this.nodes.gain.gain);
            // Bias modulation: Drive goes UP when volume goes UP.
            // Or actually, bias trem varies the operating point. 
            // Often perceived as "warmer" on the pulses.
            this.nodes.lfo.connect(this.nodes.saturator.wet);

            this._disposables.push(this.nodes.lfo, this.nodes.gain, this.nodes.saturator);
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.speed !== undefined) this.nodes.lfo.frequency.setTargetAtTime(params.speed, now, 0.01);
            if (params.intensity !== undefined) {
                this.nodes.lfo.max = 1;
                this.nodes.lfo.min = 1 - params.intensity;
            }
        }
    }

    const classes = { FenderOptoTremolo, HarmonicTremolo, BossTR2, BiasTremolo };

    const configs = {
        "Tremolo": {
            "Tremolo: Fender Opto (Blackface)": {
                "isCustom": "FenderOptoTremolo",
                "columns": [
                    [{ "l": "Speed", "p": "speed", "min": 1, "max": 10, "s": 0.1, "def": 5 }],
                    [{ "l": "Intensity", "p": "intensity", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]
                ]
            },
            "Tremolo: Fender Harmonic (Brown)": {
                "isCustom": "HarmonicTremolo",
                "columns": [
                    [{ "l": "Speed", "p": "speed", "min": 0.5, "max": 12, "s": 0.1, "def": 6 }],
                    [{ "l": "Intensity", "p": "intensity", "min": 0, "max": 1, "s": 0.01, "def": 0.7 }]
                ]
            },
            "Tremolo: Tube Bias (Princeton)": {
                "isCustom": "BiasTremolo",
                "columns": [
                    [{ "l": "Speed", "p": "speed", "min": 1, "max": 8, "s": 0.1, "def": 4 }],
                    [{ "l": "Intensity", "p": "intensity", "min": 0, "max": 1, "s": 0.01, "def": 0.6 }]
                ]
            },
            "Tremolo: Boss TR-2": {
                "isCustom": "BossTR2",
                "columns": [
                    [{ "l": "Rate", "p": "rate", "min": 0.5, "max": 15, "s": 0.1, "def": 5 }],
                    [{ "l": "Depth", "p": "depth", "min": 0, "max": 1, "s": 0.01, "def": 0.8 }],
                    [{ "l": "Shape", "p": "wave", "min": 0, "max": 1, "s": 0.1, "def": 0, "unit": " Tri/Sq" }]
                ]
            }
        }
    };

    window.effectModules.tremolo = { classes, configs };
})();

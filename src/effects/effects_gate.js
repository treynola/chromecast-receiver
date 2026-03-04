/*
 * Filename: effects_gate.js
 * Version: NOV25_AntiGravity Version 1.0
 * Date: November 25, 2025
 * Time: 17:05 CST
 * Description: Noise Gate and Suppressor implementation.
 */
if (typeof window.effectModules === 'undefined') { window.effectModules = {}; }
if (typeof window.AppSource === 'undefined') { window.AppSource = {}; }

// --- REQUIRED BLOCK FOR DYNAMIC BUILD ---
if (typeof window.saveModuleSource === 'function') {
    window.saveModuleSource('effects_gate.js');
}
window.AppSource['effects_gate.js'] = `// [Full source code string for effects_gate.js]`;

(() => {
    const { EffectBase } = window;

    class BossNS2 extends EffectBase {
        constructor() {
            super("BossNS2");
            // Boss NS-2 Noise Suppressor
            // Uses a VCA controlled by envelope detection logic.
            // Controls: Threshold, Decay.

            this.nodes.gate = new Tone.Gate({
                threshold: -40,
                smoothing: 0.1 // Attack/Release smoothing
            });
            // The NS-2 isn't a hard chop; it has a release curve (Decay).

            // Mute logic: Tone.Gate doesn't truly "mute" to -Infinity sometimes, or acts as a ducker. 
            // Actually Tone.Gate acts as a simple gate.

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.gate, this.nodes.stereoWidener);

            this._disposables.push(this.nodes.gate);
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.threshold !== undefined) {
                // NS-2 Threshold: 0 (Min) to Max. Maps to dB.
                // Typical range -60dB to 0dB.
                this.nodes.gate.threshold.value = params.threshold;
            }
            if (params.decay !== undefined) {
                // Decay: Short to Long.
                // Maps to `release` time.
                this.nodes.gate.smoothing = params.decay;
            }
        }
    }

    class ISPDecimator extends EffectBase {
        constructor() {
            super("ISPDecimator");
            // ISP Decimator: Known for "Linearized Time Vector Processing".
            // Extremely transparent, tracks very fast.
            // Single knob: Threshold.

            this.nodes.gate = new Tone.Gate({
                threshold: -30,
                smoothing: 0.01 // Very fast smoothing for tight metal chugs
            });

            // Decimator holds the gate open slightly smarter, but for emulation 
            // we use a very fast attack/release Gate.

            this.wet.disconnect(this.nodes.stereoWidener);
            // Input buffer clean
            this.nodes.buffer = new Tone.Gain(1);

            this.wet.chain(this.nodes.buffer, this.nodes.gate, this.nodes.stereoWidener);

            this._disposables.push(this.nodes.gate, this.nodes.buffer);
        }

        set(params) {
            super.set(params);
            if (params.threshold !== undefined) {
                this.nodes.gate.threshold.value = params.threshold;
            }
        }
    }

    const classes = { BossNS2, ISPDecimator };

    const configs = {
        "Dynamics": {
            "Gate: Boss NS-2": {
                "isCustom": "BossNS2",
                "columns": [
                    [{ "l": "Threshold", "p": "threshold", "min": -60, "max": 0, "s": 1, "def": -40, "unit": "dB" }],
                    [{ "l": "Decay", "p": "decay", "min": 0.01, "max": 1, "s": 0.01, "def": 0.1 }]
                ]
            },
            "Gate: ISP Decimator": {
                "isCustom": "ISPDecimator",
                "columns": [
                    [{ "l": "Threshold", "p": "threshold", "min": -70, "max": 0, "s": 1, "def": -35, "unit": "dB" }]
                ]
            }
        }
    };

    window.effectModules.gate = { classes, configs };
})();

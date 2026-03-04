/*
 * Filename: effects_mod_pitch_filter.js
 * Version: NOV25_AntiGravity Version 1.0
 * Date: November 25, 2025
 * Time: 16:37 CST
 * Description: Modulation, Pitch, and Filter effects implementation.
 */
if (typeof window.effectModules === 'undefined') { window.effectModules = {}; }
if (typeof window.AppSource === 'undefined') { window.AppSource = {}; }

// --- REQUIRED BLOCK FOR DYNAMIC BUILD ---
if (typeof window.saveModuleSource === 'function') {
    window.saveModuleSource('effects_mod_pitch_filter.js');
}
window.AppSource['effects_mod_pitch_filter.js'] = `// [Full source code string for effects_mod_pitch_filter.js v43.6]`;

// Actual module code
(() => {
    const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
    const { EffectBase } = window;

    class DigitechWhammy extends EffectBase {
        constructor() {
            super("DigitechWhammy");
            // Digitech Whammy WH-1 (1989)
            // Early digital pitch shifting using IVL Technologies processing.
            // Characteristic: Not perfectly clean! Has distinct aliasing, "glitchy" tracking, 
            // and a slight high-end roll-off due to early AD/DA converters.
            this._params = { pedal: 0, mode: 0 }; // 0: 1 Oct Up, 1: 2 Oct Up, 2: 1 Oct Down, 3: 2 Oct Down, 4: Dive Bomb
            
            // Early digital converter emulation (12-bit / slightly reduced sample rate sound)
            this.nodes.bitcrusher = new Tone.BitCrusher(12);
            
            // The pitch shifter itself
            this.nodes.pitchShift = new Tone.PitchShift({ pitch: 0, windowSize: 0.05 });
            
            // Anti-aliasing filter (the WH-1 rolls off around 12kHz)
            this.nodes.filter = new Tone.Filter({ type: 'lowpass', frequency: 12000, rolloff: -24 });

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.bitcrusher, this.nodes.pitchShift, this.nodes.filter, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.pitchShift, this.nodes.bitcrusher, this.nodes.filter);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.mode !== undefined) this._params.mode = params.mode;
            if (params.pedal !== undefined || params.mode !== undefined) {
                const pedal = params.pedal !== undefined ? params.pedal : this._params.pedal;
                this._params.pedal = pedal;
                let maxShift = 12;
                switch (Math.floor(this._params.mode)) {
                    case 0: maxShift = 12; break; // 1 Oct Up
                    case 1: maxShift = 24; break; // 2 Oct Up
                    case 2: maxShift = -12; break; // 1 Oct Down
                    case 3: maxShift = -24; break; // 2 Oct Down
                    case 4: maxShift = -36; break; // Dive Bomb
                }
                this.nodes.pitchShift.pitch = maxShift * pedal;
            }
        }
    }

    class MuTronIII extends EffectBase {
        constructor() {
            // Mu-Tron III (1972)
            // Designed by Mike Beigel, Musitronics
            // Envelope-controlled filter with O805 optocoupler
            // Controls: Gain, Peak (Q), Mode (LP/BP/HP), Range (Hi/Lo), Drive (Up/Down)
            // Output impedance: 600 ohms
            super("MuTronIII");
            this._params = { gain: 0.5, peak: 5, mode: 0, range: 0, drive: 0 };

            // Envelope follower (simulates O805 optocoupler response)
            // LDR response: Slow attack, slower release (thermal lag)
            this.nodes.follower = new Tone.Follower({ attack: 0.02, release: 0.15 });

            // State-variable filter (can be LP, BP, or HP)
            this.nodes.filter = new Tone.Filter({ type: 'lowpass', Q: 5, rolloff: -24 });

            // Frequency scaling (envelope drives filter frequency)
            // Hi range: 400-4000Hz, Lo range: 100-1500Hz
            this.nodes.scale = new Tone.Scale(200, 4000);

            // Input gain stage (affects envelope sensitivity)
            this.nodes.inputGain = new Tone.Gain(1);

            // Preamp coloration (slight warmth)
            this.nodes.preamp = new Tone.Chebyshev(2);
            this.nodes.preamp.wet.value = 0.1;

            // Envelope follower chain
            this.wet.connect(this.nodes.inputGain);
            this.nodes.inputGain.connect(this.nodes.follower);
            this.nodes.follower.connect(this.nodes.scale);
            this.nodes.scale.connect(this.nodes.filter.frequency);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.preamp, this.nodes.filter, this.nodes.stereoWidener);

            this._disposables.push(
                this.nodes.follower, this.nodes.filter, this.nodes.scale,
                this.nodes.inputGain, this.nodes.preamp
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.gain !== undefined) {
                // Gain affects envelope sensitivity (how wide the filter opens)
                // Variable 0.1 to 40 in original
                this.nodes.inputGain.gain.setTargetAtTime(0.5 + (params.gain * 4), now, 0.01);
                this.nodes.scale.max = 500 + (params.gain * 5000);
            }

            if (params.peak !== undefined) {
                // Peak (Q) control - counter-clockwise = sharper, clockwise = mellower
                this.nodes.filter.Q.setTargetAtTime(params.peak, now, 0.01);
            }

            if (params.mode !== undefined) {
                // Mode switch: LP (0), BP (1), HP (2)
                const modes = ['lowpass', 'bandpass', 'highpass'];
                this.nodes.filter.type = modes[clamp(Math.floor(params.mode), 0, 2)];
            }

            if (params.range !== undefined) {
                // Range switch: Lo (0) or Hi (1)
                // Lo: 100-1500Hz, Hi: 400-4000Hz
                if (params.range > 0.5) {
                    this.nodes.scale.min = 400;
                    this.nodes.scale.max = 4000;
                } else {
                    this.nodes.scale.min = 100;
                    this.nodes.scale.max = 1500;
                }
            }

            if (params.drive !== undefined) {
                // Drive switch: Up (0) or Down (1)
                // Up = filter opens with attack, Down = filter closes with attack
                // Note: Swapping min/max for envelope direction
                if (params.drive > 0.5) {
                    // Down mode - swap min and max
                    const tempMin = this.nodes.scale.min;
                    this.nodes.scale.min = this.nodes.scale.max;
                    this.nodes.scale.max = tempMin;
                }
            }
        }
    }

    class BossOC2 extends EffectBase {
        constructor() {
            super("BossOC2");
            // OC-2: Analog Monophonic Octave (-1 and -2 octaves)
            // It uses a flip-flop circuit to divide the input frequency, resulting in a synth-like square wave.
            
            // We approximate the analog flip-flop by heavily clipping the pitch-shifted signal
            // and filtering it to get that dark, synthy square-wave character.
            this.nodes.octave1Shift = new Tone.PitchShift(-12);
            this.nodes.octave2Shift = new Tone.PitchShift(-24);
            
            const squareCurve = new Float32Array(4096);
            for (let i = 0; i < 4096; i++) {
                let x = (i / 2048) - 1;
                // Hard square clipping
                squareCurve[i] = x > 0.05 ? 0.8 : (x < -0.05 ? -0.8 : 0); 
            }
            
            this.nodes.oct1Squarer = new Tone.WaveShaper(squareCurve);
            this.nodes.oct2Squarer = new Tone.WaveShaper(squareCurve);
            
            // The OC-2 has a distinct low-pass character on the octaves
            this.nodes.oct1Filter = new Tone.Filter({ type: 'lowpass', frequency: 600, rolloff: -24 });
            this.nodes.oct2Filter = new Tone.Filter({ type: 'lowpass', frequency: 300, rolloff: -24 });

            this.nodes.dryGain = new Tone.Gain(1);
            this.nodes.oct1Gain = new Tone.Gain(0.5);
            this.nodes.oct2Gain = new Tone.Gain(0.2);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.fan(this.nodes.dryGain, this.nodes.octave1Shift, this.nodes.octave2Shift);
            
            this.nodes.octave1Shift.chain(this.nodes.oct1Squarer, this.nodes.oct1Filter, this.nodes.oct1Gain);
            this.nodes.octave2Shift.chain(this.nodes.oct2Squarer, this.nodes.oct2Filter, this.nodes.oct2Gain);

            this.nodes.dryGain.connect(this.nodes.stereoWidener);
            this.nodes.oct1Gain.connect(this.nodes.stereoWidener);
            this.nodes.oct2Gain.connect(this.nodes.stereoWidener);

            this._disposables.push(
                this.nodes.octave1Shift, this.nodes.octave2Shift, 
                this.nodes.oct1Squarer, this.nodes.oct2Squarer, 
                this.nodes.oct1Filter, this.nodes.oct2Filter,
                this.nodes.dryGain, this.nodes.oct1Gain, this.nodes.oct2Gain
            );
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.oct1 !== undefined) this.nodes.oct1Gain.gain.setTargetAtTime(params.oct1, now, 0.01);
            if (params.oct2 !== undefined) this.nodes.oct2Gain.gain.setTargetAtTime(params.oct2, now, 0.01);
            if (params.direct !== undefined) this.nodes.dryGain.gain.setTargetAtTime(params.direct, now, 0.01);
        }
    }

    class WalrusAudioDefcon4 extends EffectBase {
        constructor() {
            super("WalrusAudioDefcon4");
            this.nodes.low = new Tone.Filter({ type: 'lowshelf', frequency: 200 });
            this.nodes.high = new Tone.Filter({ type: 'highshelf', frequency: 3000 });
            this.nodes.boost = new Tone.Gain(1);
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.low, this.nodes.high, this.nodes.boost, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.low, this.nodes.high, this.nodes.boost);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.low !== undefined) this.nodes.low.gain.setTargetAtTime(params.low, now, 0.01);
            if (params.high !== undefined) this.nodes.high.gain.setTargetAtTime(params.high, now, 0.01);
            if (params.boost !== undefined) this.nodes.boost.gain.setTargetAtTime(params.boost, now, 0.01);
        }
    }
    class MaestroFSH1 extends EffectBase {
        constructor() {
            super("MaestroFSH1");
            this.nodes.lfo = new Tone.LFO({ frequency: 2, type: 'sine' }).start();
            this.nodes.lfoScale = new Tone.Scale(400, 2000);
            this.nodes.filter = new Tone.Filter({ type: 'bandpass', Q: 5 });
            this.nodes.lfo.connect(this.nodes.lfoScale);
            this.nodes.lfoScale.connect(this.nodes.filter.frequency);
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.filter, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.lfo, this.nodes.lfoScale, this.nodes.filter);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.speed !== undefined) this.nodes.lfo.frequency.setTargetAtTime(params.speed, now, 0.01);
            if (params.shape !== undefined) {
                const types = ['sine', 'square', 'triangle', 'sawtooth'];
                this.nodes.lfo.type = types[Math.floor(params.shape)];
            }
        }
    }
    class SebatronDDF100 extends EffectBase {
        constructor() {
            super("SebatronDDF100");
            this.nodes.follower = new Tone.Follower({ attack: 0.01, release: 0.1 });
            this.nodes.filter = new Tone.Filter({ type: 'lowpass', Q: 2 });
            this.nodes.scale = new Tone.Scale(100, 4000);
            this.wet.connect(this.nodes.follower);
            this.nodes.follower.connect(this.nodes.scale);
            this.nodes.scale.connect(this.nodes.filter.frequency);
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.filter, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.follower, this.nodes.filter, this.nodes.scale);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.sensitivity !== undefined) {
                const releaseTime = 0.5 - ((params.sensitivity - -40) / 40) * 0.48;
                this.nodes.follower.release = clamp(releaseTime, 0.02, 0.5);
            }
            if (params.q !== undefined) this.nodes.filter.Q.setTargetAtTime(params.q, now, 0.01);
            if (params.octaves !== undefined) this.nodes.scale.max = 100 + (params.octaves * 800);
        }
    }
    class OctaveFuzz extends EffectBase {
        constructor() {
            super("OctaveFuzz");
            // Octave Fuzz (e.g. EHX Octavix / Octavia clones)
            // Uses full-wave rectification for analog octave up, not digital pitch shift.
            this.nodes.preGain = new Tone.Gain(1);
            
            const curve = new Float32Array(4096);
            for (let i = 0; i < 4096; i++) {
                let x = (i / 2048) - 1;
                // Rectification (octave up) mixed with standard hard clipping (fuzz)
                // We'll calculate both and blend them based on the 'octave' param
                let rectified = Math.abs(x);
                curve[i] = Math.tanh(rectified * 5) * 2 - 1; // Pure octave up
            }
            this.nodes.octaveRectifier = new Tone.WaveShaper(curve);
            this.nodes.fuzzDistortion = new Tone.Distortion(0.7);
            
            this.nodes.blend = new Tone.CrossFade(0.5); // Fuzz vs Octave-Fuzz blend
            this.nodes.toneFilter = new Tone.Filter({ type: 'lowpass', frequency: 5000 });

            this.wet.disconnect(this.nodes.stereoWidener);
            
            this.wet.connect(this.nodes.preGain);
            this.nodes.preGain.fan(this.nodes.fuzzDistortion, this.nodes.octaveRectifier);
            
            this.nodes.fuzzDistortion.connect(this.nodes.blend.a);
            this.nodes.octaveRectifier.connect(this.nodes.blend.b);
            
            this.nodes.blend.chain(this.nodes.toneFilter, this.nodes.stereoWidener);

            this._disposables.push(this.nodes.preGain, this.nodes.octaveRectifier, this.nodes.fuzzDistortion, this.nodes.blend, this.nodes.toneFilter);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.fuzz !== undefined) {
                this.nodes.fuzzDistortion.distortion = params.fuzz;
                this.nodes.preGain.gain.setTargetAtTime(1 + (params.fuzz * 10), now, 0.01);
            }
            if (params.octave !== undefined) {
                // Blend between standard fuzz and octave-up fuzz
                this.nodes.blend.fade.setTargetAtTime(params.octave, now, 0.01);
            }
        }
    }
    class TycobraheOctavia extends EffectBase {
        constructor() {
            super("TycobraheOctavia");
            // Tycobrahe Octavia (Late 60s) - Used by Jimi Hendrix.
            // This is an ANALOG octave fuzz. It does not use digital pitch shifting!
            // It uses an audio transformer and a pair of germanium diodes to create full-wave rectification,
            // folding the wave over itself to double the frequency (Octave Up).
            
            this.nodes.preGain = new Tone.Gain(5); // Pushes into the rectifier
            
            // Full-wave rectifier (analog octave up)
            const curve = new Float32Array(4096);
            for (let i = 0; i < 4096; i++) {
                let x = (i / 2048) - 1;
                // Rectify and add asymmetric fuzz
                let rectified = Math.abs(x);
                curve[i] = Math.tanh(rectified * 5) * 2 - 1; // Center it and clip
            }
            this.nodes.rectifier = new Tone.WaveShaper(curve);
            
            // Post-fuzz tone shaping (Octavia has a pronounced mid-range bark)
            this.nodes.bandpass = new Tone.Filter({ type: 'bandpass', frequency: 1500, Q: 0.8 });
            
            this.nodes.output = new Tone.Gain(1);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.preGain, this.nodes.rectifier, this.nodes.bandpass, this.nodes.output, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.preGain, this.nodes.rectifier, this.nodes.bandpass, this.nodes.output);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.boost !== undefined) {
                // Boost drives the rectifier harder, increasing fuzz and the octave prominence
                this.nodes.preGain.gain.setTargetAtTime(1 + (params.boost * 20), now, 0.01);
            }
            if (params.volume !== undefined) {
                this.nodes.output.gain.setTargetAtTime(params.volume, now, 0.01);
            }
        }
    }
    class EHXPOG2 extends EffectBase {
        constructor() {
            super("EHXPOG2");
            this.nodes.octaveUp1 = new Tone.PitchShift(12);
            this.nodes.octaveUp2 = new Tone.PitchShift(24);
            this.nodes.octaveDown1 = new Tone.PitchShift(-12);
            this.nodes.octaveDown2 = new Tone.PitchShift(-24);
            this.nodes.up1Gain = new Tone.Gain(0);
            this.nodes.up2Gain = new Tone.Gain(0);
            this.nodes.down1Gain = new Tone.Gain(0);
            this.nodes.down2Gain = new Tone.Gain(0);
            this.wet.fan(this.nodes.octaveUp1, this.nodes.octaveUp2, this.nodes.octaveDown1, this.nodes.octaveDown2);
            this.nodes.octaveUp1.connect(this.nodes.up1Gain);
            this.nodes.octaveUp2.connect(this.nodes.up2Gain);
            this.nodes.octaveDown1.connect(this.nodes.down1Gain);
            this.nodes.octaveDown2.connect(this.nodes.down2Gain);
            this.nodes.up1Gain.connect(this.nodes.stereoWidener);
            this.nodes.up2Gain.connect(this.nodes.stereoWidener);
            this.nodes.down1Gain.connect(this.nodes.stereoWidener);
            this.nodes.down2Gain.connect(this.nodes.stereoWidener);
            this.wet.disconnect(this.nodes.stereoWidener);
            this._disposables.push(this.nodes.octaveUp1, this.nodes.octaveUp2, this.nodes.octaveDown1, this.nodes.octaveDown2, this.nodes.up1Gain, this.nodes.up2Gain, this.nodes.down1Gain, this.nodes.down2Gain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.up1 !== undefined) this.nodes.up1Gain.gain.setTargetAtTime(params.up1, now, 0.01);
            if (params.up2 !== undefined) this.nodes.up2Gain.gain.setTargetAtTime(params.up2, now, 0.01);
            if (params.down1 !== undefined) this.nodes.down1Gain.gain.setTargetAtTime(params.down1, now, 0.01);
            if (params.down2 !== undefined) this.nodes.down2Gain.gain.setTargetAtTime(params.down2, now, 0.01);
        }
    }
    // NOTE: FenderVibratone, LeslieSpeaker, and MaestroRover have been moved to 
    // effects_lespeakers.js with more accurate emulations based on researched specifications

    class JaxVibraChorus extends EffectBase {
        constructor() {
            super("JaxVibraChorus");
            this._params = { speed: 1.5, intensity: 0.7 };
            this.nodes.vibrato = new Tone.Vibrato({
                frequency: this._params.speed,
                depth: this._params.intensity,
                wet: 1
            });
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.vibrato, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.vibrato);
        }

        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.intensity !== undefined) {
                this._params.intensity = params.intensity;
                this.nodes.vibrato.depth.setTargetAtTime(this._params.intensity, now, 0.01);
            }

            if (params.speed !== undefined) {
                this._params.speed = params.speed;
                this.nodes.vibrato.frequency.setTargetAtTime(this._params.speed, now, 0.01);
            }
        }
    }
    class UniVibe extends EffectBase {
        constructor() {
            super("UniVibe");
            // Mode: Chorus (Dry+Wet, swirling) vs Vibrato (Wet only, pitchy)
            this._params = { speed: 1.5, intensity: 0.8, mode: 0 };

            const vibeCurve = new Float32Array(256);
            for (let i = 0; i < 256; i++) {
                const x = i / 255;
                vibeCurve[i] = Math.pow(Math.sin(x * Math.PI), 1.6) * 0.5 + 0.5;
            }
            this.nodes.lfo = new Tone.LFO({ frequency: 1.5, amplitude: 1 }).start();
            this.nodes.shaper = new Tone.WaveShaper(vibeCurve);
            this.nodes.lfoScale = new Tone.Scale(0, 1);
            this.nodes.lfo.connect(this.nodes.lfoScale);
            this.nodes.lfoScale.connect(this.nodes.shaper);

            this.nodes.phaser = new Tone.Phaser({ frequency: 0, octaves: 3, stages: 4, Q: 2.5, wet: 1 });

            // Uni-Vibe Preamp warmth
            this.nodes.preamp = new Tone.Chebyshev(2);
            this.nodes.preamp.wet.value = 0.5;

            // In typical use, UniVibe drives the phaser frequency
            this.nodes.shaper.connect(this.nodes.phaser.frequency);

            this.nodes.dryGain = new Tone.Gain(1);
            this.nodes.wetGain = new Tone.Gain(1);

            // Signal flow:
            // Input -> Preamp -> [DryGain, Phaser -> WetGain] -> Output

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.connect(this.nodes.preamp);

            this.nodes.preamp.fan(this.nodes.dryGain, this.nodes.phaser);
            this.nodes.phaser.connect(this.nodes.wetGain);

            this.nodes.dryGain.connect(this.nodes.stereoWidener);
            this.nodes.wetGain.connect(this.nodes.stereoWidener);

            this._disposables.push(this.nodes.lfo, this.nodes.shaper, this.nodes.phaser, this.nodes.lfoScale, this.nodes.preamp, this.nodes.dryGain, this.nodes.wetGain);
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.speed !== undefined) {
                this._params.speed = params.speed;
                this.nodes.lfo.frequency.setTargetAtTime(this._params.speed, now, 0.01);
            }
            if (params.intensity !== undefined) {
                this._params.intensity = params.intensity;
                this.nodes.phaser.octaves = this._params.intensity * 4 + 1;
            }
            if (params.mode !== undefined) {
                this._params.mode = params.mode;
                // 0 = Chorus (Dry + Wet), 1 = Vibrato (Wet only)
                const isVibrato = params.mode > 0.5;
                this.nodes.dryGain.gain.setTargetAtTime(isVibrato ? 0 : 1, now, 0.01);
            }
            if (params.volume !== undefined) this.wet.gain.setTargetAtTime(params.volume, now, 0.01);
        }
    }
    class WahPedal extends EffectBase {
        constructor() {
            super("WahPedal");
            this.nodes.exciter = new Tone.Chebyshev(1);
            this.nodes.filter = new Tone.Filter({ type: 'peaking', frequency: 100, Q: 6, gain: 20 });
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.exciter, this.nodes.filter, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.exciter, this.nodes.filter);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.pedal !== undefined) {
                const minFreq = 250;
                const maxFreq = 2500;
                const freq = minFreq * Math.pow(maxFreq / minFreq, params.pedal);
                this.nodes.filter.frequency.setTargetAtTime(freq, now, 0.01);
            }
            if (params.q !== undefined) this.nodes.filter.Q.setTargetAtTime(params.q, now, 0.01);
        }
    }
    class WMDGeigerCounter extends EffectBase {
        constructor() {
            super("WMDGeigerCounter");
            this.nodes.gain = new Tone.Gain(1);
            this.nodes.crusher = new Tone.BitCrusher(8);
            this._currentTable = 4;
            this._currentSampleRate = 8;
            this.nodes.shaper = new Tone.WaveShaper(this._getTable(this._currentTable, this._currentSampleRate));
            this.nodes.limiter = new Tone.Limiter(-1);
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.gain, this.nodes.crusher, this.nodes.shaper, this.nodes.limiter, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.gain, this.nodes.crusher, this.nodes.shaper, this.nodes.limiter);
        }
        _getTable(index, sampleRate = 8) {
            const size = 4096;
            const table = new Float32Array(size);
            const multiplier = 1 + (sampleRate - 1) * 0.5;
            for (let i = 0; i < size; i++) {
                let x = (i / (size / 2)) - 1;
                let y = x * multiplier;
                y = y - 2 * Math.floor((y + 1) / 2);
                switch (Math.floor(index)) {
                    case 0: table[i] = Math.sin(y * Math.PI * 4); break;
                    case 1: table[i] = y > 0 ? 1 : -1; break;
                    case 2: table[i] = 1 - Math.abs(y); break;
                    case 3: table[i] = Math.pow(y, 3); break;
                    default: table[i] = y;
                }
            }
            return table;
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            let tableNeedsUpdate = false;
            if (params.gain !== undefined) this.nodes.gain.gain.setTargetAtTime(params.gain, now, 0.01);
            if (params.bitDepth !== undefined) this.nodes.crusher.bits.value = params.bitDepth;
            if (params.sampleRate !== undefined) {
                this._currentSampleRate = params.sampleRate;
                tableNeedsUpdate = true;
            }
            if (params.table !== undefined) {
                this._currentTable = params.table;
                tableNeedsUpdate = true;
            }
            if (tableNeedsUpdate) {
                this.nodes.shaper.curve = this._getTable(this._currentTable, this._currentSampleRate);
            }
        }
    }

    const classes = { WalrusAudioDefcon4, MaestroFSH1, SebatronDDF100, OctaveFuzz, TycobraheOctavia, EHXPOG2, JaxVibraChorus, UniVibe, WahPedal, WMDGeigerCounter, DigitechWhammy, MuTronIII, BossOC2 };
    // NOTE: Rotary speaker effects (FenderVibratone, LeslieSpeaker, MaestroRover) now registered in effects_lespeakers.js
    const configs = { "Modulation, Pitch & Filter": { "Boost: Walrus Audio Defcon 4": { "isCustom": "WalrusAudioDefcon4", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Low", "p": "low", "min": -12, "max": 12, "s": 0.1, "def": 0 }, { "l": "High", "p": "high", "min": -12, "max": 12, "s": 0.1, "def": 0 }], [{ "l": "Boost", "p": "boost", "min": 1, "max": 10, "s": 0.1, "def": 1 }]] }, "Filter: Maestro FSH-1": { "isCustom": "MaestroFSH1", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Speed", "p": "speed", "min": 0.1, "max": 20, "s": 0.1, "def": 2 }, { "l": "Shape", "p": "shape", "min": 0, "max": 3, "s": 1, "def": 2 }]] }, "Filter: Mu-Tron III": { "isCustom": "MuTronIII", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Gain", "p": "gain", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }, { "l": "Peak", "p": "peak", "min": 1, "max": 20, "s": 0.1, "def": 5 }], [{ "l": "Mode", "p": "mode", "min": 0, "max": 2, "s": 1, "def": 0, "unit": " LP/BP/HP" }, { "l": "Range", "p": "range", "min": 0, "max": 1, "s": 1, "def": 0, "unit": " Low/Hi" }], [{ "l": "Drive", "p": "drive", "min": 0, "max": 1, "s": 1, "def": 0, "unit": " Up/Dn" }]] }, "Filter: Sebatron DDF-100": { "isCustom": "SebatronDDF100", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Sensitivity", "p": "sensitivity", "min": -40, "max": 0, "s": 1, "def": -10 }, { "l": "Q", "p": "q", "min": 1, "max": 20, "s": 0.1, "def": 2 }], [{ "l": "Octaves", "p": "octaves", "min": 1, "max": 8, "s": 0.1, "def": 5 }]] }, "Fuzz-Octave: EHX Octavix": { "isCustom": "OctaveFuzz", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Fuzz", "p": "fuzz", "min": 0.5, "max": 1, "s": 0.01, "def": 0.7 }, { "l": "Octave", "p": "octave", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]] }, "Fuzz-Octave: Roger Mayer Octavia": { "isCustom": "OctaveFuzz", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Fuzz", "p": "fuzz", "min": 0.6, "max": 1, "s": 0.01, "def": 0.8 }, { "l": "Octave", "p": "octave", "min": 0, "max": 1, "s": 0.01, "def": 0.6 }]] }, "Fuzz-Octave: Tycobrahe Octavia": { "isCustom": "TycobraheOctavia", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Boost", "p": "boost", "min": 0.5, "max": 1, "def": 0.8 }, { "l": "Volume", "p": "volume", "min": 0, "max": 2, "def": 1 }]] }, "Pitch: Boss OC-2": { "isCustom": "BossOC2", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Oct 1", "p": "oct1", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }, { "l": "Oct 2", "p": "oct2", "min": 0, "max": 1, "s": 0.01, "def": 0.2 }], [{ "l": "Direct", "p": "direct", "min": 0, "max": 1, "s": 0.01, "def": 1 }]] }, "Pitch: Digitech Whammy": { "isCustom": "DigitechWhammy", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Pedal", "p": "pedal", "min": 0, "max": 1, "s": 0.01, "def": 0 }], [{ "l": "Mode", "p": "mode", "min": 0, "max": 4, "s": 1, "def": 0, "unit": " +1/2/-1/-2/DV" }]] }, "Pitch: EHX POG2": { "isCustom": "EHXPOG2", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "-2 Oct", "p": "down2", "min": 0, "max": 1, "def": 0 }, { "l": "-1 Oct", "p": "down1", "min": 0, "max": 1, "def": 0 }], [{ "l": "+1 Oct", "p": "up1", "min": 0, "max": 1, "def": 0 }, { "l": "+2 Oct", "p": "up2", "min": 0, "max": 1, "def": 0 }]] }, "PitchShift": { "class": "PitchShift", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Pitch", "p": "pitch", "min": -12, "max": 12, "s": 1, "def": 0 }]] }, "Vibrato-Chorus: Jax Vibra-Chorus": { "isCustom": "JaxVibraChorus", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Speed", "p": "speed", "min": 0.5, "max": 5, "def": 1.5 }, { "l": "Intensity", "p": "intensity", "min": 0, "max": 1, "def": 0.7 }]] }, "Vibrato-Chorus: Uni-Vibe": { "isCustom": "UniVibe", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Speed", "p": "speed", "min": 0.5, "max": 5, "def": 1.5 }, { "l": "Intensity", "p": "intensity", "min": 0, "max": 1, "def": 0.8 }], [{ "l": "Volume", "p": "volume", "min": 0, "max": 2, "def": 1 }]] }, "Wah: Crybaby": { "isCustom": "WahPedal", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Pedal", "p": "pedal", "min": 0, "max": 1, "s": 0.01, "def": 0 }, { "l": "Q", "p": "q", "min": 1, "max": 12, "s": 0.1, "def": 6 }]] }, "Bitcrusher: WMD Geiger Counter": { "isCustom": "WMDGeigerCounter", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Gain", "p": "gain", "min": 1, "max": 50, "def": 1 }, { "l": "Bit Depth", "p": "bitDepth", "min": 1, "max": 16, "s": 1, "def": 8 }], [{ "l": "Sample Rate", "p": "sampleRate", "min": 1, "max": 16, "s": 1, "def": 8 }, { "l": "Table", "p": "table", "min": 0, "max": 4.9, "s": 1, "def": 4 }]] } } };
    window.effectModules.mod_pitch_filter = { classes, configs };
})();
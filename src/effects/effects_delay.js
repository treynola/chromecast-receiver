/*
 * Filename: effects_delay.js
 * Version: NOV25_AntiGravity Version 1.0
 * Date: November 25, 2025
 * Time: 16:33 CST
 * Description: Delay effects implementation.
 */
if (typeof window.effectModules === 'undefined') { window.effectModules = {}; }
if (typeof window.AppSource === 'undefined') { window.AppSource = {}; }

// --- REQUIRED BLOCK FOR DYNAMIC BUILD ---
if (typeof window.saveModuleSource === 'function') {
    window.saveModuleSource('effects_delay.js');
}

// Define the source string for caching (omitted for brevity, assume full string)
window.AppSource['effects_delay.js'] = `// [Full source code string for effects_delay.js v43.8]`;

// Actual module code
(() => {
    const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
    const { EffectBase } = window;
    const RAMP_TIME = 0.01;

    // --- Base Delay Class (uses explicit gain for feedback) ---
    class BaseDelay extends EffectBase {
        constructor(name, time, feedback, maxDelay) {
            super(name);
            this.maxDelay = maxDelay;
            this.nodes.delay = new Tone.Delay(time, maxDelay);
            this.nodes.feedbackGain = new Tone.Gain(feedback);
            this.nodes.limiter = new Tone.Limiter(-3);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.connect(this.nodes.delay);
            this.nodes.delay.connect(this.nodes.limiter);
            this.nodes.limiter.connect(this.nodes.stereoWidener);

            // Feedback loop: limiter -> feedbackGain -> delay
            this.nodes.limiter.connect(this.nodes.feedbackGain);
            this.nodes.feedbackGain.connect(this.nodes.delay);
            this._disposables.push(this.nodes.delay, this.nodes.limiter, this.nodes.feedbackGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.time !== undefined) this.nodes.delay.delayTime.setTargetAtTime(clamp(params.time, 0, this.maxDelay), now, 0.01);
            if (params.feedback !== undefined) this.nodes.feedbackGain.gain.setTargetAtTime(clamp(params.feedback, 0, 1), now, 0.01);
            if (params.repeats !== undefined) this.nodes.feedbackGain.gain.setTargetAtTime(clamp(params.repeats, 0, 1), now, 0.01);
        }
    }

    // --- Tape Delay Base Class ---
    class TapeDelayBase extends BaseDelay {
        constructor(name, time, feedback, maxDelay, filterFreq, wowFlutterDepth, driveAmount, noiseAmount, noiseType = "brown") {
            super(name, time, feedback, maxDelay);

            // Disconnect the default BaseDelay feedback chain to insert tape characteristics
            this.nodes.limiter.disconnect(this.nodes.feedbackGain);

            this.nodes.tapeFilter = new Tone.Filter({ frequency: filterFreq, type: 'lowpass', rolloff: -12 });
            this.nodes.wowFlutterLFO = new Tone.LFO({ frequency: 4, type: 'sine' }).start();
            this.nodes.wowFlutterScale = new Tone.Multiply(wowFlutterDepth); // Changed to Multiply for smoother control
            this.nodes.baseDelayTime = new Tone.Signal(time);
            this.nodes.delayTimeAdder = new Tone.Add();
            this.nodes.tapeDrive = new Tone.Distortion({ distortion: driveAmount });
            this.nodes.tapeNoise = new Tone.Noise(noiseType).start();
            this.nodes.tapeNoiseGain = new Tone.Gain(noiseAmount);

            // New feedback loop: limiter -> tapeFilter -> tapeDrive -> feedbackGain -> delay
            this.nodes.limiter.connect(this.nodes.tapeFilter);
            this.nodes.tapeFilter.connect(this.nodes.tapeDrive);
            this.nodes.tapeDrive.connect(this.nodes.feedbackGain);
            this.nodes.feedbackGain.connect(this.nodes.delay);

            // Noise is mixed into the feedback path at feedbackGain
            this.nodes.tapeNoise.connect(this.nodes.tapeNoiseGain);
            this.nodes.tapeNoiseGain.connect(this.nodes.feedbackGain);

            this.nodes.wowFlutterLFO.connect(this.nodes.wowFlutterScale);
            this.nodes.wowFlutterScale.connect(this.nodes.delayTimeAdder.addend);
            this.nodes.baseDelayTime.connect(this.nodes.delayTimeAdder);
            this.nodes.delayTimeAdder.connect(this.nodes.delay.delayTime);

            this._disposables.push(
                this.nodes.tapeFilter,
                this.nodes.wowFlutterLFO,
                this.nodes.wowFlutterScale,
                this.nodes.baseDelayTime,
                this.nodes.delayTimeAdder,
                this.nodes.tapeDrive,
                this.nodes.tapeNoise,
                this.nodes.tapeNoiseGain
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.time !== undefined) this.nodes.baseDelayTime.setTargetAtTime(params.time, now, 0.01);
            if (params.filterFreq !== undefined) this.nodes.tapeFilter.frequency.setTargetAtTime(params.filterFreq, now, RAMP_TIME);
            if (params.wowFlutterDepth !== undefined) {
                this.nodes.wowFlutterScale.factor.setTargetAtTime(params.wowFlutterDepth, now, RAMP_TIME);
            }
            if (params.driveAmount !== undefined) this.nodes.tapeDrive.distortion = params.driveAmount;
            if (params.noiseAmount !== undefined) this.nodes.tapeNoiseGain.gain.setTargetAtTime(params.noiseAmount, now, RAMP_TIME);
        }
    }

    class AnalogDelayStereo extends EffectBase {
        constructor() {
            super("AnalogDelayStereo");
            this._time = 1.0;
            this._modDepth = 0;

            // Disconnect default wet path to avoid double signal and allow custom routing
            this.wet.disconnect(this.nodes.stereoWidener);

            // Increased maxDelay to prevent buffer overrun with modulation
            this.nodes.delayL = new Tone.FeedbackDelay({ delayTime: this._time, maxDelay: 1.5 });
            this.nodes.delayR = new Tone.FeedbackDelay({ delayTime: this._time, maxDelay: 1.5 });
            this.nodes.filterL = new Tone.Filter({ frequency: 6000, type: 'lowpass' });
            this.nodes.filterR = new Tone.Filter({ frequency: 6000, type: 'lowpass' });

            this.nodes.lfo = new Tone.LFO({ frequency: 1, amplitude: 1 }).start();
            this.nodes.lfoScale = new Tone.Multiply(this._modDepth);

            this.nodes.baseDelayTimeL = new Tone.Signal(this._time);
            this.nodes.delayTimeAdderL = new Tone.Add();
            this.nodes.baseDelayTimeR = new Tone.Signal(this._time);
            this.nodes.delayTimeAdderR = new Tone.Add();

            const splitter = new Tone.Split(2);
            this.nodes.merger = new Tone.Merge();
            this.wet.connect(splitter);

            // Left chain
            splitter.connect(this.nodes.delayL, 0);
            this.nodes.delayL.connect(this.nodes.filterL);
            this.nodes.filterL.connect(this.nodes.merger, 0, 0);

            // Right chain
            splitter.connect(this.nodes.delayR, 1);
            this.nodes.delayR.connect(this.nodes.filterR);
            this.nodes.filterR.connect(this.nodes.merger, 0, 1);

            // Connect merged stereo signal to stereoWidener
            this.nodes.merger.connect(this.nodes.stereoWidener);

            // Connect the modulation chain for left
            this.nodes.lfo.connect(this.nodes.lfoScale);
            this.nodes.lfoScale.connect(this.nodes.delayTimeAdderL.addend);
            this.nodes.baseDelayTimeL.connect(this.nodes.delayTimeAdderL);
            this.nodes.delayTimeAdderL.connect(this.nodes.delayL.delayTime);

            // Connect the modulation chain for right (with inverted LFO)
            const lfoInvert = new Tone.Multiply(-1);
            this.nodes.lfoScale.connect(lfoInvert);
            lfoInvert.connect(this.nodes.delayTimeAdderR.addend);
            this.nodes.baseDelayTimeR.connect(this.nodes.delayTimeAdderR);
            this.nodes.delayTimeAdderR.connect(this.nodes.delayR.delayTime);

            this._disposables.push(
                this.nodes.delayL, this.nodes.delayR, this.nodes.filterL, this.nodes.filterR,
                this.nodes.lfo, this.nodes.lfoScale, this.nodes.baseDelayTimeL, this.nodes.delayTimeAdderL,
                this.nodes.baseDelayTimeR, this.nodes.delayTimeAdderR, splitter, this.nodes.merger, lfoInvert
            );
        }

        set(params) {
            super.set(params); // handles mix, width
            const now = Tone.now();

            if (params.time !== undefined) {
                this._time = params.time;
            }
            if (params.modDepth !== undefined) {
                this._modDepth = params.modDepth;
            }

            // Recalculate and apply time/depth safely
            const safeDepth = Math.min(this._modDepth, this._time * 0.95);
            this.nodes.lfoScale.factor.setTargetAtTime(safeDepth, now, 0.01);
            this.nodes.baseDelayTimeL.setTargetAtTime(this._time, now, 0.01);
            this.nodes.baseDelayTimeR.setTargetAtTime(this._time, now, 0.01);

            // Handle other params
            if (params.feedback !== undefined) {
                this.nodes.delayL.feedback.setTargetAtTime(clamp(params.feedback, 0, 1), now, 0.01);
                this.nodes.delayR.feedback.setTargetAtTime(clamp(params.feedback, 0, 1), now, 0.01);
            }
            if (params.tone !== undefined) {
                this.nodes.filterL.frequency.setTargetAtTime(params.tone, now, 0.01);
                this.nodes.filterR.frequency.setTargetAtTime(params.tone, now, 0.01);
            }
            if (params.modRate !== undefined) {
                this.nodes.lfo.frequency.setTargetAtTime(params.modRate, now, 0.01);
            }
        }
    } class ArionSAD1 extends BaseDelay {
        constructor() {
            // Arion SAD-1 Stereo Analog Delay
            // Uses single MN3205 BBD (4096 stage) + MN3102 clock driver
            // 50ms-300ms delay range
            // Mono input, Stereo output (one wet, one dry or phase inverted)
            super("ArionSAD1", 0.3, 0.4, 0.3);

            // MN3205 BBD characteristics
            this.nodes.inputFilter = new Tone.Filter({ frequency: 4500, type: 'lowpass', rolloff: -12 });
            this.nodes.bbdSat = new Tone.Chebyshev(2);
            this.nodes.bbdSat.wet.value = 0.15;
            this.nodes.outputFilter = new Tone.Filter({ frequency: 3500, type: 'lowpass', rolloff: -12 });

            // Mode switch: Mono (0) or Pseudo-Stereo (1)
            this.nodes.phaseInverter = new Tone.Multiply(-1);
            this.nodes.modeFade = new Tone.CrossFade(0);

            // Re-route signal with BBD processing
            this.wet.disconnect(this.nodes.delay);
            this.wet.chain(this.nodes.inputFilter, this.nodes.bbdSat, this.nodes.delay);

            this.nodes.delay.disconnect();
            this.nodes.delay.chain(this.nodes.outputFilter, this.nodes.limiter);

            // Stereo output routing
            this.nodes.limiter.connect(this.nodes.modeFade.a);
            this.nodes.limiter.connect(this.nodes.phaseInverter);
            this.nodes.phaseInverter.connect(this.nodes.modeFade.b);
            this.nodes.modeFade.connect(this.nodes.stereoWidener);

            this._disposables.push(
                this.nodes.inputFilter, this.nodes.bbdSat, this.nodes.outputFilter,
                this.nodes.phaseInverter, this.nodes.modeFade
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.mode !== undefined) {
                this.nodes.modeFade.fade.setTargetAtTime(params.mode, now, 0.01);
            }

            if (params.time !== undefined) {
                // BBD filter tracks delay time
                const filterFreq = 4500 - (params.time * 5000);
                this.nodes.inputFilter.frequency.setTargetAtTime(Math.max(2000, filterFreq), now, 0.01);
            }
        }
    }
    class BackTalkReverseDelay extends EffectBase {
        constructor() {
            super("BackTalkReverseDelay");
            this._buffer = new Tone.ToneAudioBuffer();
            this.nodes.recorder = new Tone.Recorder();
            this.nodes.player = new Tone.Player(this._buffer).connect(this.wet);
            this.nodes.player.reverse = true;

            this.input.connect(this.nodes.recorder);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.nodes.player.connect(this.nodes.stereoWidener);

            this._isRecording = false;
            this._isProcessing = false; // Add a lock

            this._loop = new Tone.Loop(async (time) => {
                if (this._isProcessing) return; // Don't do anything if the last one is still processing

                if (this._isRecording) {
                    this._isProcessing = true;
                    try {
                        const recording = await this.nodes.recorder.stop();
                        const url = URL.createObjectURL(recording);
                        await this._buffer.load(url);
                        URL.revokeObjectURL(url); // Clean up memory
                        this.nodes.player.start(time);
                    } catch (e) {
                        console.error("Error processing recording:", e);
                    }
                    this._isProcessing = false;
                }

                this._isRecording = !this._isRecording;

                if (this._isRecording) {
                    this.nodes.recorder.start();
                }
            }, "1m").start(0);

            this._disposables.push(this.nodes.recorder, this.nodes.player, this._loop);
        }
        set(params) {
            super.set(params);
            if (params.time !== undefined) {
                this._loop.interval = params.time;
            }
            // 'repeats' is not used in this corrected version as player doesn't loop by default
        }
    }

    class BossDD2 extends BaseDelay {
        constructor() {
            // Boss DD-2: World's first compact digital delay (1983)
            // 12-bit logarithmic compression, 40Hz-7kHz response
            // Custom IC from Roland SDE-3000 rack unit
            super("BossDD2", 0.8, 0.5, 0.8);
            this._time = 1;
            this._mode = 2;

            // 3 delay modes: S(12.5-50ms), M(50-200ms), L(200-800ms)
            this.delayRanges = [
                { min: 0.0125, max: 0.050 },   // Short: 12.5-50ms
                { min: 0.050, max: 0.200 },    // Medium: 50-200ms
                { min: 0.200, max: 0.800 }     // Long: 200-800ms
            ];

            // 12-bit digital simulation: slight bandwidth limiting and quantization
            // Pre-emphasis to maintain presence (like analog tape)
            this.nodes.inputFilter = new Tone.Filter({ frequency: 7000, type: 'lowpass', rolloff: -12 });
            // Authentic 12-bit resolution
            this.nodes.bitCrusher = new Tone.BitCrusher(12);

            // Bucket-brigade simulation using slight bit reduction for vintage digital character
            // The DD-2's logarithmic compression gives it a unique compression quality
            this.nodes.digitalCompression = new Tone.Compressor({
                threshold: -24,
                ratio: 4,
                attack: 0.003,
                release: 0.25
            });

            // Anti-aliasing filter (necessary for early digital)
            this.nodes.antiAlias = new Tone.Filter({ frequency: 6500, type: 'lowpass', rolloff: -24 });

            // De-emphasis in feedback loop - digital delays have less cumulative darkening
            this.nodes.feedbackFilter = new Tone.Filter({ frequency: 7000, type: 'lowpass', rolloff: -12 });

            // Route signal
            this.wet.disconnect(this.nodes.delay);
            this.wet.chain(this.nodes.inputFilter, this.nodes.bitCrusher, this.nodes.digitalCompression, this.nodes.delay);

            this.nodes.delay.disconnect();
            this.nodes.delay.chain(this.nodes.antiAlias, this.nodes.limiter, this.nodes.stereoWidener);

            // Feedback loop with slight filtering
            this.nodes.limiter.disconnect(this.nodes.feedbackGain);
            this.nodes.limiter.chain(this.nodes.feedbackFilter, this.nodes.feedbackGain, this.nodes.delay);

            this._disposables.push(this.nodes.inputFilter, this.nodes.bitCrusher, this.nodes.digitalCompression, this.nodes.antiAlias, this.nodes.feedbackFilter);
        }

        _calculateTime() {
            const range = this.delayRanges[this._mode] || this.delayRanges[2];
            return range.min + (range.max - range.min) * this._time;
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            let needsUpdate = false;
            if (params.time !== undefined) { this._time = params.time; needsUpdate = true; }
            if (params.mode !== undefined) { this._mode = clamp(Math.floor(params.mode), 0, 2); needsUpdate = true; }
            if (needsUpdate) { this.nodes.delay.delayTime.setTargetAtTime(this._calculateTime(), now, 0.01); }
        }
    }

    class BossDD3Delay extends BossDD2 {
        constructor() {
            // Boss DD-3: Updated DD-2 with slight spec improvements (1986)
            // Same circuit, 4 modes: S, M, L, and H (Hold for sampling)
            super();
            this.name = "BossDD3Delay";

            // DD-3 has 4 modes including Hold (H mode is same timing as L)
            this.delayRanges = [
                { min: 0.0125, max: 0.050 },   // Short: 12.5-50ms
                { min: 0.050, max: 0.200 },    // Medium: 50-200ms  
                { min: 0.200, max: 0.800 },    // Long: 200-800ms
                { min: 0.200, max: 0.800 }     // Hold: 200-800ms (same as L)
            ];

            // Slightly improved filtering on DD-3
            this.nodes.inputFilter.frequency.value = 7500;
            this.nodes.antiAlias.frequency.value = 7000;
        }

        set(params) {
            // Handle 4 modes (0-3)
            if (params.mode !== undefined) {
                this._mode = clamp(Math.floor(params.mode), 0, 3);
            }
            super.set(params);
        }
    }
    class BossDM2Delay extends BaseDelay {
        constructor() {
            // Boss DM-2: MN3005/MN3205 4096-stage BBD
            // Max delay: 300ms @ ~6.8kHz clock frequency
            // Characteristic warm, dark sound with cumulative HF roll-off
            super("BossDM2Delay", 0.3, 0.4, 0.3);

            // BBD input anti-aliasing filter (pre-emphasis)
            this.nodes.inputFilter = new Tone.Filter({ frequency: 4500, type: 'lowpass', rolloff: -12 });

            // BBD bucket-passing creates soft saturation
            // MN3005 at 15V has cleaner headroom, MN3205 at 9V clips more readily
            this.nodes.bbdSaturation = new Tone.Chebyshev(2);
            this.nodes.bbdSaturation.wet.value = 0.2;

            // Output reconstruction filter (de-emphasis)
            // This is clock-frequency dependent - lower at longer delays
            this.nodes.bbdFilter = new Tone.Filter({ frequency: 2800, type: 'lowpass', rolloff: -12 });

            // Additional feedback darkening - cumulative per repeat
            this.nodes.feedbackTone = new Tone.Filter({ frequency: 2200, type: 'lowpass', rolloff: -12 });

            // Re-route: wet -> inputFilter -> saturation -> delay -> bbdFilter -> output
            this.wet.disconnect(this.nodes.delay);
            this.wet.chain(this.nodes.inputFilter, this.nodes.bbdSaturation, this.nodes.delay);

            // Disconnect default feedback loop
            this.nodes.limiter.disconnect(this.nodes.feedbackGain);

            // New signal path: delay -> bbdFilter -> limiter -> output
            this.nodes.delay.disconnect();
            this.nodes.delay.chain(this.nodes.bbdFilter, this.nodes.limiter, this.nodes.stereoWidener);

            // Feedback loop with additional darkening
            this.nodes.limiter.chain(this.nodes.feedbackTone, this.nodes.feedbackGain, this.nodes.delay);

            this._disposables.push(this.nodes.inputFilter, this.nodes.bbdSaturation, this.nodes.bbdFilter, this.nodes.feedbackTone);
        }

        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.time !== undefined) {
                // BBD filter frequency is inversely proportional to delay time
                // Longer delay = lower clock frequency = lower filter cutoff
                const filterFreq = 4500 - (params.time * 6000); // ~2800Hz at 300ms
                this.nodes.bbdFilter.frequency.setTargetAtTime(Math.max(1500, filterFreq), now, 0.01);
            }

            if (params.tone !== undefined) {
                this.nodes.feedbackTone.frequency.setTargetAtTime(params.tone, now, 0.01);
            }

            if (params.drive !== undefined) {
                // More drive = more BBD saturation (like MN3205 running hot)
                this.nodes.bbdSaturation.wet.setTargetAtTime(0.1 + params.drive * 0.6, now, 0.01);
            }
        }
    }
    class CatalinbreadEchorec extends EffectBase {
        constructor() {
            super("CatalinbreadEchorec");
            // Binson Echorec: 4 playback heads on rotating magnetic drum
            // Head positions: 75ms, 150ms, 225ms, 300ms (1:2:3:4 ratio)
            // 12 switch positions select different head combinations

            this._time = 0.3; // Base time multiplier (300ms = position 1)
            this._program = 0;

            // Magnetic drum heads with proportional timing
            this.nodes.delay1 = new Tone.Delay(0.075, 1.0); // Head 1: 75ms base
            this.nodes.delay2 = new Tone.Delay(0.15, 1.0);  // Head 2: 150ms base
            this.nodes.delay3 = new Tone.Delay(0.225, 1.0); // Head 3: 225ms base
            this.nodes.delay4 = new Tone.Delay(0.3, 1.0);   // Head 4: 300ms base

            // Individual head gain controls
            this.nodes.gains = [
                new Tone.Gain(0), new Tone.Gain(0), new Tone.Gain(0), new Tone.Gain(0)
            ];

            // Feedback (Swell control)
            this.nodes.feedbackGain = new Tone.Gain(0.5);

            // Tube circuit simulation (5x 12AX7 tubes)
            this.nodes.tubeWarmth = new Tone.Chebyshev(2);
            this.nodes.tubeWarmth.wet.value = 0.25;

            // Magnetic drum frequency response (limited bandwidth ~4kHz)
            this.nodes.drumFilter = new Tone.Filter({ frequency: 4000, type: 'lowpass', rolloff: -12 });

            // High-pass to remove rumble
            this.nodes.rumbleFilter = new Tone.Filter({ frequency: 80, type: 'highpass' });

            // Signal routing
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.tubeWarmth);
            this.nodes.tubeWarmth.fan(this.nodes.delay1, this.nodes.delay2, this.nodes.delay3, this.nodes.delay4);

            this.nodes.delay1.connect(this.nodes.gains[0]);
            this.nodes.delay2.connect(this.nodes.gains[1]);
            this.nodes.delay3.connect(this.nodes.gains[2]);
            this.nodes.delay4.connect(this.nodes.gains[3]);

            // Sum all heads through drum filter
            this.nodes.headSum = new Tone.Gain();
            this.nodes.gains.forEach(g => g.connect(this.nodes.headSum));

            this.nodes.headSum.chain(this.nodes.drumFilter, this.nodes.rumbleFilter, this.nodes.stereoWidener);

            // Feedback from sum back to head 1 (like original drum)
            this.nodes.headSum.chain(this.nodes.feedbackGain, this.nodes.delay1);

            this._disposables.push(
                this.nodes.delay1, this.nodes.delay2, this.nodes.delay3, this.nodes.delay4,
                ...this.nodes.gains, this.nodes.feedbackGain, this.nodes.tubeWarmth,
                this.nodes.drumFilter, this.nodes.rumbleFilter, this.nodes.headSum
            );
        }

        _updatePrograms() {
            const now = Tone.now();
            const p = Math.floor(this._program);

            // 12 authentic Binson head selection patterns
            // Patterns: 1=Head1, 2=Head2, 3=Head3, 4=Head4, various combinations
            const patterns = [
                [1, 0, 0, 0], // 1: Head 1 only
                [0, 1, 0, 0], // 2: Head 2 only
                [0, 0, 1, 0], // 3: Head 3 only
                [0, 0, 0, 1], // 4: Head 4 only
                [1, 1, 0, 0], // 5: Heads 1+2
                [0, 1, 1, 0], // 6: Heads 2+3
                [0, 0, 1, 1], // 7: Heads 3+4
                [1, 1, 1, 0], // 8: Heads 1+2+3
                [0, 1, 1, 1], // 9: Heads 2+3+4
                [1, 0, 1, 0], // 10: Heads 1+3
                [0, 1, 0, 1], // 11: Heads 2+4
                [1, 1, 1, 1]  // 12: All heads (Swell)
            ];
            const pattern = patterns[p % 12];
            pattern.forEach((val, i) => this.nodes.gains[i].gain.setTargetAtTime(val, now, 0.01));

            // Update delay times based on time control (proportional scaling)
            const baseTime = this._time;
            this.nodes.delay1.delayTime.setTargetAtTime(baseTime * 0.25, now, 0.01); // Head 1: 1/4
            this.nodes.delay2.delayTime.setTargetAtTime(baseTime * 0.50, now, 0.01); // Head 2: 2/4
            this.nodes.delay3.delayTime.setTargetAtTime(baseTime * 0.75, now, 0.01); // Head 3: 3/4
            this.nodes.delay4.delayTime.setTargetAtTime(baseTime, now, 0.01);        // Head 4: 4/4
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.time !== undefined) { this._time = params.time; this._updatePrograms(); }
            if (params.program !== undefined) { this._program = params.program; this._updatePrograms(); }
            if (params.swell !== undefined) this.nodes.feedbackGain.gain.setTargetAtTime(params.swell, now, 0.01);
            if (params.tone !== undefined) this.nodes.drumFilter.frequency.setTargetAtTime(params.tone, now, 0.01);
        }
    }
    class DOD680AnalogDelay extends BaseDelay {
        constructor() {
            // DOD 680 Analog Delay (1979-1982)
            // Reticon SAD4096 BBD chip - dark, lush, warm organic tone
            // 3kHz filter stifles clock noise but creates characteristic darkness
            // 300ms max delay
            super("DOD680AnalogDelay", 0.3, 0.4, 0.3);

            // SAD4096 BBD input filter
            this.nodes.inputFilter = new Tone.Filter({ frequency: 4000, type: 'lowpass', rolloff: -12 });

            // SAD4096 characteristic - darker than MN3005
            this.nodes.bbdFilter = new Tone.Filter({ frequency: 3000, type: 'lowpass', rolloff: -12 });

            // BBD saturation (warm, organic character)
            this.nodes.bbdSat = new Tone.Chebyshev(2);
            this.nodes.bbdSat.wet.value = 0.2;

            // Cumulative darkening in feedback loop
            this.nodes.feedbackFilter = new Tone.Filter({ frequency: 2500, type: 'lowpass', rolloff: -12 });

            // Re-route signal
            this.wet.disconnect(this.nodes.delay);
            this.wet.chain(this.nodes.inputFilter, this.nodes.bbdSat, this.nodes.delay);

            this.nodes.delay.disconnect();
            this.nodes.delay.chain(this.nodes.bbdFilter, this.nodes.limiter, this.nodes.stereoWidener);

            this.nodes.limiter.disconnect(this.nodes.feedbackGain);
            this.nodes.limiter.chain(this.nodes.feedbackFilter, this.nodes.feedbackGain, this.nodes.delay);

            this._disposables.push(this.nodes.inputFilter, this.nodes.bbdFilter, this.nodes.bbdSat, this.nodes.feedbackFilter);
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.tone !== undefined) {
                this.nodes.bbdFilter.frequency.setTargetAtTime(params.tone, now, 0.01);
                this.nodes.feedbackFilter.frequency.setTargetAtTime(params.tone * 0.8, now, 0.01);
            }
        }
    }

    class DeltalabEffectronJr extends BaseDelay {
        constructor() {
            // Deltalab Effectron Jr (ADM-256)
            // Adaptive Delta Modulation technology (different from PCM)
            // Up to 1024ms delay with unique "quirky" character
            // Creates chorus, flange, and bizarre effects
            super("DeltalabEffectronJr", 0.256, 0.3, 1.024);

            // ADM has unique character - slightly lo-fi compared to PCM
            this.nodes.admFilter = new Tone.Filter({ frequency: 6000, type: 'lowpass', rolloff: -12 });
            // ADM delta modulation artifacts (rougher than standard PCM)
            this.nodes.admCrusher = new Tone.BitCrusher(10);

            // ADM modulation for chorus/flange effects
            this.nodes.lfo = new Tone.LFO({ frequency: 0.5, type: 'sine' }).start();
            this.nodes.lfoScale = new Tone.Multiply(0);
            this.nodes.baseDelayTime = new Tone.Signal(0.256);
            this.nodes.delayTimeAdder = new Tone.Add();

            this.nodes.delay.disconnect();
            this.nodes.delay.chain(this.nodes.admFilter, this.nodes.admCrusher, this.nodes.limiter, this.nodes.stereoWidener);

            // Modulation routing
            this.nodes.lfo.connect(this.nodes.lfoScale);
            this.nodes.lfoScale.connect(this.nodes.delayTimeAdder.addend);
            this.nodes.baseDelayTime.connect(this.nodes.delayTimeAdder);
            this.nodes.delayTimeAdder.connect(this.nodes.delay.delayTime);

            this._disposables.push(
                this.nodes.admFilter, this.nodes.admCrusher, this.nodes.lfo, this.nodes.lfoScale,
                this.nodes.baseDelayTime, this.nodes.delayTimeAdder
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.time !== undefined) {
                this.nodes.baseDelayTime.setTargetAtTime(clamp(params.time, 0, 1.024), now, 0.01);
            }
            if (params.modDepth !== undefined) {
                this.nodes.lfoScale.factor.setTargetAtTime(params.modDepth * 0.01, now, 0.01);
            }
            if (params.modRate !== undefined) {
                this.nodes.lfo.frequency.setTargetAtTime(params.modRate, now, 0.01);
            }
        }
    }

    class DigitechPDS1002 extends BaseDelay {
        constructor() {
            // Digitech PDS-1002 Two Second Digital Delay (mid-1980s)
            // 2 seconds max delay with Hold/Infinite Repeat (looper function)
            // Digital sampler/delay pedal
            super("DigitechPDS1002", 1.0, 0.5, 2.0);

            // Digital character - slight bandwidth limiting
            this.nodes.digitalFilter = new Tone.Filter({ frequency: 8000, type: 'lowpass', rolloff: -12 });

            this.nodes.delay.disconnect();
            this.nodes.delay.chain(this.nodes.digitalFilter, this.nodes.limiter, this.nodes.stereoWidener);

            this._disposables.push(this.nodes.digitalFilter);
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            // Hold mode: set feedback to 1 for infinite repeat
            if (params.hold !== undefined && params.hold > 0.5) {
                this.nodes.feedbackGain.gain.setTargetAtTime(1.0, now, 0.01);
            }
        }
    }

    class DigitechPDS2020 extends BaseDelay {
        constructor() {
            // Digitech PDS-2020 Multiplay (late 1980s)
            // 2+ seconds delay, combines delay/chorus/flanger
            // Modifiable to extend to 8-13 seconds via trim pot
            // Infinite repeat function
            super("DigitechPDS2020", 1.0, 0.5, 2.0);

            // Digital filter
            this.nodes.digitalFilter = new Tone.Filter({ frequency: 7500, type: 'lowpass', rolloff: -12 });

            // Chorus/Flange modulation
            this.nodes.lfo = new Tone.LFO({ frequency: 1, type: 'sine' }).start();
            this.nodes.lfoScale = new Tone.Multiply(0);
            this.nodes.baseDelayTime = new Tone.Signal(0.5);
            this.nodes.delayTimeAdder = new Tone.Add();

            this.nodes.delay.disconnect();
            this.nodes.delay.chain(this.nodes.digitalFilter, this.nodes.limiter, this.nodes.stereoWidener);

            // Modulation routing
            this.nodes.lfo.connect(this.nodes.lfoScale);
            this.nodes.lfoScale.connect(this.nodes.delayTimeAdder.addend);
            this.nodes.baseDelayTime.connect(this.nodes.delayTimeAdder);
            this.nodes.delayTimeAdder.connect(this.nodes.delay.delayTime);

            this._disposables.push(
                this.nodes.digitalFilter, this.nodes.lfo, this.nodes.lfoScale,
                this.nodes.baseDelayTime, this.nodes.delayTimeAdder
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.time !== undefined) {
                this.nodes.baseDelayTime.setTargetAtTime(clamp(params.time, 0, 2.0), now, 0.01);
            }
            if (params.modDepth !== undefined) {
                this.nodes.lfoScale.factor.setTargetAtTime(params.modDepth * 0.015, now, 0.01);
            }
            if (params.modRate !== undefined) {
                this.nodes.lfo.frequency.setTargetAtTime(params.modRate, now, 0.01);
            }
            // Infinite repeat
            if (params.hold !== undefined && params.hold > 0.5) {
                this.nodes.feedbackGain.gain.setTargetAtTime(1.0, now, 0.01);
            }
        }
    }

    class EchoplexEP2 extends TapeDelayBase {
        constructor() {
            // Echoplex EP-2 (1963-1969): Tube-based preamp
            // Known for: Warm, dark, murky character with rich repeats
            // Vacuum tube preamp adds warmth and "tactile boost"
            // Uses 12AX7 tubes for preamp stage
            super("EchoplexEP2", 0.75, 0.5, 0.75, 2500, 0.003, 0.2, 0.1, "brown");

            // Tube preamp simulation with higher harmonic content
            this.nodes.tubePreamp = new Tone.Chebyshev(3);
            this.nodes.tubePreamp.wet.value = 0.35; // More tube coloration than EP-3

            // EP-2 tube warmth adds slight mid boost and bass
            this.nodes.tubeEQ = new Tone.Filter({ type: 'peaking', frequency: 400, Q: 0.8, gain: 3 });

            // Darker tape characteristics than EP-3
            this.nodes.tapeRolloff = new Tone.Filter({ frequency: 3500, type: 'lowpass', rolloff: -12 });

            // Re-route: preamp -> EQ -> tape -> delay
            this.wet.disconnect(this.nodes.delay);
            this.wet.chain(this.nodes.tubePreamp, this.nodes.tubeEQ, this.nodes.tapeRolloff, this.nodes.tapeDrive, this.nodes.delay);

            this._disposables.push(this.nodes.tubePreamp, this.nodes.tubeEQ, this.nodes.tapeRolloff);
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.drive !== undefined) {
                this.nodes.tubePreamp.wet.setTargetAtTime(0.2 + params.drive * 0.4, now, 0.01);
            }
        }
    }

    class EchoplexEP3 extends TapeDelayBase {
        constructor() {
            // Echoplex EP-3 (1970+): "Magic" FET solid-state preamp
            // Known for: Brighter, clearer, more defined sound
            // JFET preamp sweetens treble and fattens mids
            // Nonlinear phase response makes harmonics stand out
            super("EchoplexEP3", 0.75, 0.5, 0.75, 4500, 0.002, 0.15, 0.05, "pink");

            // FET preamp: less harmonics than tube but unique character
            this.nodes.fetPreamp = new Tone.Chebyshev(2);
            this.nodes.fetPreamp.wet.value = 0.15;

            // EP-3 "magic" preamp: subtle bass roll-off + upper-mid presence
            // This is key to the EP-3's "sweetening" effect
            this.nodes.preampHPF = new Tone.Filter({ type: 'highpass', frequency: 120, rolloff: -12 });
            this.nodes.preampPresence = new Tone.Filter({ type: 'peaking', frequency: 2500, Q: 0.6, gain: 4 });

            // Brighter tape than EP-2
            this.nodes.tapeCharacter = new Tone.Filter({ frequency: 5000, type: 'lowpass', rolloff: -12 });

            // Re-route with EP-3 preamp characteristics
            this.wet.disconnect(this.nodes.delay);
            this.wet.chain(
                this.nodes.fetPreamp,
                this.nodes.preampHPF,
                this.nodes.preampPresence,
                this.nodes.tapeCharacter,
                this.nodes.tapeDrive,
                this.nodes.delay
            );

            this._disposables.push(this.nodes.fetPreamp, this.nodes.preampHPF, this.nodes.preampPresence, this.nodes.tapeCharacter);
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.drive !== undefined) {
                this.nodes.fetPreamp.wet.setTargetAtTime(0.1 + params.drive * 0.25, now, 0.01);
            }
            if (params.brightness !== undefined) {
                this.nodes.preampPresence.gain.setTargetAtTime(params.brightness * 8, now, 0.01);
            }
        }
    }
    class EHXDeluxeMemoryMan extends BaseDelay {
        constructor() {
            super("EHXDeluxeMemoryMan", 0.55, 0.5, 0.55);
            this._time = 0.55;
            this._modDepth = 0;
            // DMM: Filter is in the feedback loop, creating cumulative darkening
            this.nodes.bbdFilter = new Tone.Filter({ frequency: 2800, type: 'lowpass', rolloff: -12 });

            // DMM Preamp: Known for its specific saturation (overload protection + warmth)
            // Using Chebyshev for smooth analog clipping
            this.nodes.preamp = new Tone.Chebyshev(2);
            this.nodes.preampGain = new Tone.Gain(1.1); // Drive control

            this.nodes.lfo = new Tone.LFO({ frequency: 1, type: 'sine' }).start();
            this.nodes.lfoScale = new Tone.Multiply(0);
            this.nodes.baseDelayTime = new Tone.Signal(this._time);
            this.nodes.delayTimeAdder = new Tone.Add();

            // Re-wiring for DMM characteristics
            // Signal Chain: Input -> Preamp -> Delay -> BBD Filter -> Output/Feedback
            this.wet.disconnect(this.nodes.delay);
            this.wet.chain(this.nodes.preampGain, this.nodes.preamp, this.nodes.delay);

            this.nodes.delay.disconnect();
            this.nodes.delay.chain(this.nodes.bbdFilter, this.nodes.limiter, this.nodes.stereoWidener);

            // Feedback loop: Limiter -> FeedbackGain -> BBD Filter -> Delay
            // Actually, DMM feedback comes AFTER the BBD and BBD Filter.
            // Since limiter is after BBD Filter, we tap from limiter.
            this.nodes.limiter.disconnect(this.nodes.feedbackGain);
            // DMM Feedback can self-oscillate aggressively. 
            // We'll trust the Limiter (-3dB) to keep it from exploding, 
            // but DMM usually clips softly in the feedback loop too.
            this.nodes.limiter.connect(this.nodes.feedbackGain);
            this.nodes.feedbackGain.connect(this.nodes.delay);

            this.nodes.lfo.connect(this.nodes.lfoScale);
            this.nodes.lfoScale.connect(this.nodes.delayTimeAdder.addend);
            this.nodes.baseDelayTime.connect(this.nodes.delayTimeAdder);
            this.nodes.delayTimeAdder.connect(this.nodes.delay.delayTime);

            this._disposables.push(this.nodes.preamp, this.nodes.preampGain, this.nodes.bbdFilter, this.nodes.lfo, this.nodes.lfoScale, this.nodes.baseDelayTime, this.nodes.delayTimeAdder);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.time !== undefined) {
                this._time = params.time;
                this.nodes.baseDelayTime.setTargetAtTime(this._time, now, 0.01);
            }
            if (params.modDepth !== undefined) this._modDepth = clamp(params.modDepth, 0, 0.05);

            const safeDepth = Math.min(this._modDepth, this._time * 0.1);
            this.nodes.lfoScale.setTargetAtTime(safeDepth, now, 0.01);

            if (params.modRate !== undefined) this.nodes.lfo.frequency.setTargetAtTime(params.modRate, now, 0.01);
            if (params.drive !== undefined) {
                // Preamp drive
                this.nodes.preampGain.gain.setTargetAtTime(1 + (params.drive * 2), now, 0.01);
            }
        }
    }
    class EHXMemoryBoy extends BaseDelay {
        constructor() {
            super("EHXMemoryBoy", 0.55, 0.4, 0.55);
            this.nodes.filter = new Tone.Filter({ frequency: 3500, type: 'lowpass', rolloff: -12 });
            this.nodes.lfo = new Tone.LFO({ frequency: 2 }).start();
            this.nodes.lfoScale = new Tone.Multiply(0);
            this.nodes.baseDelayTime = new Tone.Signal(0.55);
            this.nodes.delayTimeAdder = new Tone.Add();

            this.wet.chain(this.nodes.delay, this.nodes.filter, this.nodes.limiter, this.nodes.stereoWidener);
            this.nodes.limiter.chain(this.nodes.feedbackGain, this.nodes.delay);

            this.nodes.lfo.connect(this.nodes.lfoScale);
            this.nodes.lfoScale.connect(this.nodes.delayTimeAdder.addend);
            this.nodes.baseDelayTime.connect(this.nodes.delayTimeAdder);
            this.nodes.delayTimeAdder.connect(this.nodes.delay.delayTime);
            this._disposables.push(this.nodes.filter, this.nodes.lfo, this.nodes.lfoScale, this.nodes.baseDelayTime, this.nodes.delayTimeAdder);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.time !== undefined) this.nodes.baseDelayTime.setTargetAtTime(params.time, now, 0.01);
            if (params.depth !== undefined) {
                this.nodes.lfoScale.setTargetAtTime(params.depth, now, 0.01);
            }
            if (params.rate !== undefined) this.nodes.lfo.frequency.setTargetAtTime(params.rate, now, 0.01);
            if (params.shape !== undefined) this.nodes.lfo.type = params.shape > 0.5 ? 'square' : 'triangle';
        }
    }
    class EHXMemoryToy extends BaseDelay {
        constructor() {
            // EHX Memory Toy: Simple analog delay with modulation
            // 550ms max delay, mod switch adds chorus-like effect
            // True bypass, warm analog character
            super("EHXMemoryToy", 0.55, 0.4, 0.55);

            // Analog delay filter characteristics
            this.nodes.inputFilter = new Tone.Filter({ frequency: 4500, type: 'lowpass', rolloff: -12 });
            this.nodes.outputFilter = new Tone.Filter({ frequency: 3100, type: 'lowpass', rolloff: -12 });

            // Mod switch: adds slow modulation to delay time (chorus effect)
            this.nodes.modLfo = new Tone.LFO({ frequency: 0.5, type: 'triangle' }).start();
            this.nodes.modScale = new Tone.Multiply(0);
            this.nodes.baseDelayTime = new Tone.Signal(0.3);
            this.nodes.delayTimeAdder = new Tone.Add();

            // Re-route signal
            this.wet.disconnect(this.nodes.delay);
            this.wet.chain(this.nodes.inputFilter, this.nodes.delay);

            this.nodes.delay.disconnect();
            this.nodes.delay.chain(this.nodes.outputFilter, this.nodes.limiter, this.nodes.stereoWidener);

            this.nodes.limiter.chain(this.nodes.feedbackGain, this.nodes.delay);

            // Modulation routing
            this.nodes.modLfo.connect(this.nodes.modScale);
            this.nodes.modScale.connect(this.nodes.delayTimeAdder.addend);
            this.nodes.baseDelayTime.connect(this.nodes.delayTimeAdder);
            this.nodes.delayTimeAdder.connect(this.nodes.delay.delayTime);

            this._disposables.push(
                this.nodes.inputFilter, this.nodes.outputFilter,
                this.nodes.modLfo, this.nodes.modScale, this.nodes.baseDelayTime, this.nodes.delayTimeAdder
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.time !== undefined) {
                this.nodes.baseDelayTime.setTargetAtTime(clamp(params.time, 0, 0.55), now, 0.01);
            }

            if (params.tone !== undefined) {
                this.nodes.outputFilter.frequency.setTargetAtTime(params.tone, now, 0.01);
            }

            // Mod switch (on/off)
            if (params.mod !== undefined) {
                const modAmount = params.mod > 0.5 ? 0.008 : 0;
                this.nodes.modScale.setTargetAtTime(modAmount, now, 0.01);
            }
        }
    }
    class IbanezAD9 extends BaseDelay {
        constructor() {
            // Ibanez AD-9: Classic Japanese analog delay (1982-1984)
            // Uses MN3205 BBD + MN3102 clock driver
            // Compander circuit for clean delay signal
            // Delay range: 10ms-300ms
            super("IbanezAD9", 0.3, 0.4, 0.3);

            // Pre-emphasis (compander input stage)
            this.nodes.preEmphasis = new Tone.Filter({ type: 'highshelf', frequency: 2000, gain: 6 });

            // MN3205 BBD characteristics
            this.nodes.inputFilter = new Tone.Filter({ frequency: 5000, type: 'lowpass', rolloff: -12 });

            // BBD soft clipping
            this.nodes.bbdSaturation = new Tone.Chebyshev(2);
            this.nodes.bbdSaturation.wet.value = 0.15;

            // Output reconstruction filter (de-emphasis + anti-aliasing)
            this.nodes.bbdFilter = new Tone.Filter({ frequency: 3200, type: 'lowpass', rolloff: -12 });

            // De-emphasis (compander output stage)
            this.nodes.deEmphasis = new Tone.Filter({ type: 'highshelf', frequency: 2000, gain: -6 });

            // Cumulative darkening in feedback
            this.nodes.feedbackTone = new Tone.Filter({ frequency: 2500, type: 'lowpass', rolloff: -12 });

            // Re-route signal chain
            this.wet.disconnect(this.nodes.delay);
            this.wet.chain(this.nodes.preEmphasis, this.nodes.inputFilter, this.nodes.bbdSaturation, this.nodes.delay);

            this.nodes.delay.disconnect();
            this.nodes.delay.chain(this.nodes.bbdFilter, this.nodes.deEmphasis, this.nodes.limiter, this.nodes.stereoWidener);

            // Feedback with additional darkening
            this.nodes.limiter.disconnect(this.nodes.feedbackGain);
            this.nodes.limiter.chain(this.nodes.feedbackTone, this.nodes.feedbackGain, this.nodes.delay);

            this._disposables.push(
                this.nodes.preEmphasis, this.nodes.inputFilter, this.nodes.bbdSaturation,
                this.nodes.bbdFilter, this.nodes.deEmphasis, this.nodes.feedbackTone
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.tone !== undefined) {
                this.nodes.bbdFilter.frequency.setTargetAtTime(params.tone, now, 0.01);
                this.nodes.feedbackTone.frequency.setTargetAtTime(params.tone * 0.8, now, 0.01);
            }

            if (params.time !== undefined) {
                // BBD filter tracks clock frequency
                const filterFreq = 5000 - (params.time * 6000);
                this.nodes.inputFilter.frequency.setTargetAtTime(Math.max(2000, filterFreq), now, 0.01);
            }
        }
    }
    class IbanezDE7 extends BaseDelay {
        constructor() {
            // Ibanez DE7 Delay/Echo (1999)
            // Digital delay with two modes:
            // - Delay: Clean, bright digital repeats
            // - Echo: Warm, darker repeats simulating analog/tape
            // Up to 2600ms delay time
            super("IbanezDE7", 0.5, 0.4, 2.6);

            this._mode = 0; // 0 = Delay (digital), 1 = Echo (analog sim)

            // Digital mode: clean
            this.nodes.digitalFilter = new Tone.Filter({ frequency: 8000, type: 'lowpass', rolloff: -12 });

            // Echo mode: analog simulation with darker character
            this.nodes.analogFilter = new Tone.Filter({ frequency: 2500, type: 'lowpass', rolloff: -12 });
            this.nodes.analogSat = new Tone.Chebyshev(2);
            this.nodes.analogSat.wet.value = 0;

            // Mode crossfade
            this.nodes.modeFade = new Tone.CrossFade(0);

            // Signal routing
            this.wet.disconnect(this.nodes.delay);
            this.wet.connect(this.nodes.delay);

            this.nodes.delay.disconnect();

            // Clean path
            this.nodes.delay.chain(this.nodes.digitalFilter, this.nodes.modeFade.a);

            // Echo path
            this.nodes.delay.chain(this.nodes.analogSat, this.nodes.analogFilter, this.nodes.modeFade.b);

            this.nodes.modeFade.chain(this.nodes.limiter, this.nodes.stereoWidener);
            this.nodes.limiter.chain(this.nodes.feedbackGain, this.nodes.delay);

            this._disposables.push(
                this.nodes.digitalFilter, this.nodes.analogFilter, this.nodes.analogSat, this.nodes.modeFade
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.mode !== undefined) {
                this._mode = params.mode > 0.5 ? 1 : 0;
                this.nodes.modeFade.fade.setTargetAtTime(this._mode, now, 0.01);
                // In Echo mode, add saturation
                this.nodes.analogSat.wet.setTargetAtTime(this._mode * 0.2, now, 0.01);
            }

            if (params.tone !== undefined) {
                this.nodes.analogFilter.frequency.setTargetAtTime(params.tone, now, 0.01);
            }
        }
    }
    class JHSPantherCub extends BaseDelay {
        constructor() {
            // JHS Panther Cub: Modern BBD analog delay with tap tempo
            // Impressive 1000ms max delay (rare for all-analog)
            // Tap tempo with 4 subdivisions: 1/4, 1/8, dotted 1/8, triplet
            // ROAR switch controls oscillation sensitivity
            // Effects loop on repeats
            super("JHSPantherCub", 1.0, 0.4, 1.0);

            this._time = 0.5;
            this._ratio = 0; // 0=1/4, 1=1/8, 2=dotted 1/8, 3=triplet
            this._roar = false;

            // BBD characteristics
            this.nodes.inputFilter = new Tone.Filter({ frequency: 5000, type: 'lowpass', rolloff: -12 });
            this.nodes.bbdSat = new Tone.Chebyshev(2);
            this.nodes.bbdSat.wet.value = 0.18;
            this.nodes.outputFilter = new Tone.Filter({ frequency: 4500, type: 'lowpass', rolloff: -12 });

            // Feedback tone control (EQ on repeats)
            this.nodes.feedbackTone = new Tone.Filter({ frequency: 3500, type: 'lowpass', rolloff: -12 });

            // Modulation section
            this.nodes.lfo = new Tone.LFO({ frequency: 1, type: 'sine' }).start();
            this.nodes.lfoScale = new Tone.Multiply(0);
            this.nodes.baseDelayTime = new Tone.Signal(this._time);
            this.nodes.delayTimeAdder = new Tone.Add();

            // Signal chain
            this.wet.disconnect(this.nodes.delay);
            this.wet.chain(this.nodes.inputFilter, this.nodes.bbdSat, this.nodes.delay);

            this.nodes.delay.disconnect();
            this.nodes.delay.chain(this.nodes.outputFilter, this.nodes.limiter, this.nodes.stereoWidener);

            // Feedback loop with tone control
            this.nodes.limiter.disconnect(this.nodes.feedbackGain);
            this.nodes.limiter.chain(this.nodes.feedbackTone, this.nodes.feedbackGain, this.nodes.delay);

            // Modulation routing
            this.nodes.lfo.connect(this.nodes.lfoScale);
            this.nodes.lfoScale.connect(this.nodes.delayTimeAdder.addend);
            this.nodes.baseDelayTime.connect(this.nodes.delayTimeAdder);
            this.nodes.delayTimeAdder.connect(this.nodes.delay.delayTime);

            this._disposables.push(
                this.nodes.inputFilter, this.nodes.bbdSat, this.nodes.outputFilter, this.nodes.feedbackTone,
                this.nodes.lfo, this.nodes.lfoScale, this.nodes.baseDelayTime, this.nodes.delayTimeAdder
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.time !== undefined) {
                this._time = clamp(params.time, 0, 1.0);
                this._updateDelayTime(now);
            }

            // Ratio affects how tap tempo is interpreted
            if (params.ratio !== undefined) {
                this._ratio = Math.floor(params.ratio);
                this._updateDelayTime(now);
            }

            if (params.speed !== undefined) {
                this.nodes.lfo.frequency.setTargetAtTime(params.speed, now, 0.01);
            }

            if (params.depth !== undefined) {
                const depth = clamp(params.depth, 0, 0.02);
                const safeDepth = Math.min(depth, this._time * 0.08);
                this.nodes.lfoScale.setTargetAtTime(safeDepth, now, 0.01);
            }

            if (params.eq !== undefined) {
                this.nodes.outputFilter.frequency.setTargetAtTime(params.eq, now, 0.01);
                this.nodes.feedbackTone.frequency.setTargetAtTime(params.eq * 0.75, now, 0.01);
            }

            // ROAR switch: increases feedback for easier oscillation
            if (params.roar !== undefined) {
                this._roar = params.roar > 0.5;
                // In ROAR mode, feedback can go higher
                const maxFeedback = this._roar ? 1.1 : 0.95;
                this.nodes.feedbackGain.gain.setTargetAtTime(
                    Math.min(this.nodes.feedbackGain.gain.value, maxFeedback), now, 0.01
                );
            }
        }

        _updateDelayTime(now) {
            // Apply ratio subdivision
            const ratioMultipliers = [1, 0.5, 0.75, 0.667]; // 1/4, 1/8, dotted 1/8, triplet
            const actualTime = this._time * (ratioMultipliers[this._ratio] || 1);
            this.nodes.baseDelayTime.setTargetAtTime(actualTime, now, 0.01);
        }
    } class KeeleyMagneticEcho extends TapeDelayBase {
        constructor() {
            // Initial values for TapeDelayBase: name, time, feedback, maxDelay, filterFreq, wowFlutterDepth, driveAmount, noiseAmount, noiseType
            super("KeeleyMagneticEcho", 1.0, 0.5, 1.0, 5000, 0, 0, 0, "brown");
            this._params = { tone: 5000, depth: 0 }; // Keep for chorus depth

            // Disconnect the default TapeDelayBase feedback chain to insert the chorus
            this.nodes.limiter.disconnect(this.nodes.tapeFilter);
            this.nodes.tapeDrive.disconnect(this.nodes.feedbackGain);

            this._recreateChorusNode(); // Creates this.nodes.chorus

            // New feedback loop: limiter -> chorus -> tapeFilter -> tapeDrive -> feedbackGain -> delay
            this.nodes.limiter.connect(this.nodes.chorus);
            this.nodes.chorus.connect(this.nodes.tapeFilter);
            this.nodes.tapeFilter.connect(this.nodes.tapeDrive);
            this.nodes.tapeDrive.connect(this.nodes.feedbackGain);
            this.nodes.feedbackGain.connect(this.nodes.delay);

            // Remove redundant filter as it's now part of TapeDelayBase
            // this._disposables = this._disposables.filter(node => node !== this.nodes.filter); // This line is no longer needed
        }

        _recreateChorusNode() {
            if (this.nodes.chorus) {
                // Disconnect from the old chain before disposing
                if (this.nodes.limiter && this.nodes.tapeFilter) {
                    this.nodes.limiter.disconnect(this.nodes.chorus);
                }
                this.nodes.chorus.dispose();
                // Remove the old chorus node from disposables before adding the new one
                this._disposables = this._disposables.filter(node => node !== this.nodes.chorus);
            }
            this.nodes.chorus = new Tone.Chorus({
                frequency: 1,
                delayTime: 2,
                depth: this._params.depth,
                wet: 1
            }).start();
            this.nodes.chorus.overlap = 0; // Prevent phasing against delay lines if possible
            // Append to the existing disposables array
            this._disposables.push(this.nodes.chorus);
            // Reconnect the chorus into the feedback path if the main chain is established
            if (this.nodes.limiter && this.nodes.tapeFilter && this.nodes.tapeDrive && this.nodes.tapeNoiseGain && this.nodes.feedbackGain && this.nodes.delay) {
                this.nodes.limiter.chain(this.nodes.chorus, this.nodes.tapeFilter, this.nodes.tapeDrive, this.nodes.tapeNoiseGain, this.nodes.feedbackGain, this.nodes.delay);
            }
        }

        set(params) {
            super.set(params); // Handles time, feedback, filterFreq, wowFlutterDepth, driveAmount, noiseAmount
            const now = Tone.now();
            // The tone parameter now maps to tapeFilter.frequency
            if (params.tone !== undefined) {
                this._params.tone = params.tone;
                this.nodes.tapeFilter.frequency.setTargetAtTime(this._params.tone, now, RAMP_TIME);
            }
            if (params.depth !== undefined && this._params.depth !== params.depth) {
                this._params.depth = params.depth;
                this._recreateChorusNode();
            }
        }
    }
    class KorgSDD3000 extends EffectBase {
        constructor() {
            // Korg SDD-3000: Legendary rack delay (1982) - The Edge's signature sound
            // Signature preamp with JRC op-amps, up to 1023ms delay
            // Famous for its coloration even when used just as a preamp
            super("KorgSDD3000");

            this._time = 0.4;
            this._modDepth = 0;

            // Max delay 1023ms
            this.nodes.delay = new Tone.Delay(0.4, 1.023);
            this.nodes.feedbackGain = new Tone.Gain(0.5);

            // Signature SDD-3000 preamp: JRC op-amp coloration
            // -30dB input mode adds extra gain stage with characteristic color
            this.nodes.preampDrive = new Tone.Gain(1.5);
            this.nodes.preampColor = new Tone.Chebyshev(2);
            this.nodes.preampColor.wet.value = 0.15;

            // Slight high-end boost characteristic of the preamp
            this.nodes.preampEQ = new Tone.Filter({ type: 'highshelf', frequency: 3000, gain: 2 });

            // Lo/Hi filter controls (characteristic of SDD-3000)
            this.nodes.loFilter = new Tone.Filter({ type: 'highpass', frequency: 100, rolloff: -12 });
            this.nodes.hiFilter = new Tone.Filter({ type: 'lowpass', frequency: 12000, rolloff: -12 });

            // Modulation section
            this.nodes.lfo = new Tone.LFO({ frequency: 0.5, type: 'sine' }).start();
            this.nodes.lfoScale = new Tone.Multiply(0);
            this.nodes.baseDelayTime = new Tone.Signal(this._time);
            this.nodes.delayTimeAdder = new Tone.Add();

            // Limiter for safety
            this.nodes.limiter = new Tone.Limiter(-3);

            // Signal chain
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(
                this.nodes.preampDrive,
                this.nodes.preampColor,
                this.nodes.preampEQ,
                this.nodes.loFilter,
                this.nodes.delay,
                this.nodes.hiFilter,
                this.nodes.limiter,
                this.nodes.stereoWidener
            );

            // Feedback loop (also goes through filters)
            this.nodes.limiter.chain(this.nodes.feedbackGain, this.nodes.delay);

            // Modulation to delay time
            this.nodes.lfo.connect(this.nodes.lfoScale);
            this.nodes.lfoScale.connect(this.nodes.delayTimeAdder.addend);
            this.nodes.baseDelayTime.connect(this.nodes.delayTimeAdder);
            this.nodes.delayTimeAdder.connect(this.nodes.delay.delayTime);

            this._disposables.push(
                this.nodes.delay, this.nodes.feedbackGain,
                this.nodes.preampDrive, this.nodes.preampColor, this.nodes.preampEQ,
                this.nodes.loFilter, this.nodes.hiFilter, this.nodes.limiter,
                this.nodes.lfo, this.nodes.lfoScale, this.nodes.baseDelayTime, this.nodes.delayTimeAdder
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.time !== undefined) {
                this._time = clamp(params.time, 0, 1.023);
                this.nodes.baseDelayTime.setTargetAtTime(this._time, now, 0.01);
            }

            if (params.feedback !== undefined) {
                this.nodes.feedbackGain.gain.setTargetAtTime(clamp(params.feedback, 0, 1), now, 0.01);
            }

            if (params.drive !== undefined) {
                // Preamp drive (simulates -30dB vs -10dB input setting)
                this.nodes.preampDrive.gain.setTargetAtTime(1 + params.drive * 2, now, 0.01);
                this.nodes.preampColor.wet.setTargetAtTime(0.1 + params.drive * 0.3, now, 0.01);
            }

            if (params.loFilter !== undefined) {
                this.nodes.loFilter.frequency.setTargetAtTime(params.loFilter, now, 0.01);
            }

            if (params.hiFilter !== undefined) {
                this.nodes.hiFilter.frequency.setTargetAtTime(params.hiFilter, now, 0.01);
            }

            if (params.modDepth !== undefined) {
                this._modDepth = clamp(params.modDepth, 0, 0.02);
                const safeDepth = Math.min(this._modDepth, this._time * 0.1);
                this.nodes.lfoScale.setTargetAtTime(safeDepth, now, 0.01);
            }

            if (params.modRate !== undefined) {
                this.nodes.lfo.frequency.setTargetAtTime(params.modRate, now, 0.01);
            }
        }
    }
    class LexiconPCM42 extends EffectBase {
        constructor() {
            // Lexicon PCM-42: Classic digital delay (1981)
            // Known for: Pitch modulation via sample rate changes
            // Creates lush, tape-like delays and unpredictable effects
            // Up to 2 seconds delay, VCO modulation
            super("LexiconPCM42");

            this._time = 2.0;
            this._modDepth = 0;

            this.nodes.delay = new Tone.Delay(2.0, 2.0);
            this.nodes.feedbackGain = new Tone.Gain(0.5);
            this.nodes.limiter = new Tone.Limiter(-3);

            // PCM-42 has limited bandwidth (vintage digital character)
            this.nodes.inputFilter = new Tone.Filter({ frequency: 8000, type: 'lowpass', rolloff: -12 });

            // Modulation section - simulates VCO sample rate variation
            // Creates pitch modulation effect when modulating delay time
            this.nodes.lfo = new Tone.LFO({ frequency: 0.5, type: 'sine', amplitude: 1 }).start();
            this.nodes.lfoScale = new Tone.Multiply(0);
            this.nodes.baseDelayTime = new Tone.Signal(this._time);
            this.nodes.delayTimeAdder = new Tone.Add();

            // Random modulation (characteristic of PCM-42)
            this.nodes.noiseSource = new Tone.Noise('white');
            this.nodes.noiseLPF = new Tone.Filter({ frequency: 2, type: 'lowpass' }); // Very slow random
            this.nodes.noiseScale = new Tone.Multiply(0);
            this.nodes.noiseSource.connect(this.nodes.noiseLPF);
            this.nodes.noiseLPF.connect(this.nodes.noiseScale);
            this.nodes.noiseSource.start();

            // Feedback filter - slight darkening per repeat
            this.nodes.feedbackFilter = new Tone.Filter({ frequency: 6000, type: 'lowpass', rolloff: -12 });

            // Signal chain
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.inputFilter, this.nodes.delay, this.nodes.limiter, this.nodes.stereoWidener);

            // Feedback loop
            this.nodes.limiter.chain(this.nodes.feedbackFilter, this.nodes.feedbackGain, this.nodes.delay);

            // Modulation: both LFO and random combined
            this.nodes.lfo.connect(this.nodes.lfoScale);
            this.nodes.lfoScale.connect(this.nodes.delayTimeAdder.addend);
            this.nodes.noiseScale.connect(this.nodes.delayTimeAdder.addend);
            this.nodes.baseDelayTime.connect(this.nodes.delayTimeAdder);
            this.nodes.delayTimeAdder.connect(this.nodes.delay.delayTime);

            this._disposables.push(
                this.nodes.delay, this.nodes.feedbackGain, this.nodes.limiter,
                this.nodes.inputFilter, this.nodes.feedbackFilter,
                this.nodes.lfo, this.nodes.lfoScale, this.nodes.baseDelayTime, this.nodes.delayTimeAdder,
                this.nodes.noiseSource, this.nodes.noiseLPF, this.nodes.noiseScale
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.time !== undefined) {
                this._time = clamp(params.time, 0, 2.0);
                this.nodes.baseDelayTime.setTargetAtTime(this._time, now, 0.01);
            }

            if (params.feedback !== undefined) {
                this.nodes.feedbackGain.gain.setTargetAtTime(clamp(params.feedback, 0, 1), now, 0.01);
            }

            if (params.modRate !== undefined) {
                this.nodes.lfo.frequency.setTargetAtTime(params.modRate, now, 0.01);
            }

            if (params.modDepth !== undefined) {
                this._modDepth = clamp(params.modDepth, 0, 0.1);
                const safeDepth = Math.min(this._modDepth, this._time * 0.15);
                this.nodes.lfoScale.setTargetAtTime(safeDepth, now, 0.01);
            }

            if (params.randomMod !== undefined) {
                // Random modulation amount
                const randomAmount = clamp(params.randomMod, 0, 0.05);
                this.nodes.noiseScale.setTargetAtTime(randomAmount, now, 0.01);
            }
        }
    }
    class Line6DL4 extends EffectBase {
        constructor() {
            // Line 6 DL4 Delay Modeler (1999)
            // 15+ delay algorithms including Tube Echo, Tape, Analog, Digital, Lo-Fi
            // Up to 4 seconds delay, 14 seconds looping
            // Tweak/Tweez controls vary by algorithm
            super("Line6DL4");

            this._time = 0.5;
            this._mode = 0; // 0=Digital, 1=Analog, 2=Tape, 3=Tube

            // Primary stereo delay lines (ping-pong capable)
            this.nodes.delayL = new Tone.Delay({ delayTime: 0.5, maxDelay: 4.0 });
            this.nodes.delayR = new Tone.Delay({ delayTime: 0.5, maxDelay: 4.0 });
            this.nodes.feedbackGain = new Tone.Gain(0.5);
            this.nodes.crossFeedback = new Tone.Gain(0); // For ping-pong

            // Input splitter
            this.nodes.splitter = new Tone.Split(2);
            this.nodes.merger = new Tone.Merge();

            // Algorithm-specific processing:

            // Tube Echo mode: Chebyshev tube saturation
            this.nodes.tubeSat = new Tone.Chebyshev(3);
            this.nodes.tubeSat.wet.value = 0;

            // Analog mode: BBD-style darkening
            this.nodes.analogFilter = new Tone.Filter({ frequency: 3500, type: 'lowpass', rolloff: -12 });

            // Tape mode: Wow/flutter + tape hiss
            this.nodes.tapeWow = new Tone.Vibrato({ frequency: 4, depth: 0 });

            // Lo-fi mode: Bit crusher
            this.nodes.loFi = new Tone.BitCrusher({ bits: 16 });

            // Modulation (Tweak control often modulates delay time)
            this.nodes.lfo = new Tone.LFO({ frequency: 1, type: 'sine' }).start();
            this.nodes.lfoScaleL = new Tone.Multiply(0);
            this.nodes.lfoScaleR = new Tone.Multiply(0);
            this.nodes.lfoInvert = new Tone.Multiply(-1);

            this.nodes.baseDelayTimeL = new Tone.Signal(this._time);
            this.nodes.baseDelayTimeR = new Tone.Signal(this._time);
            this.nodes.delayTimeAdderL = new Tone.Add();
            this.nodes.delayTimeAdderR = new Tone.Add();

            // Limiter for safety
            this.nodes.limiter = new Tone.Limiter(-3);

            // Signal chain
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.connect(this.nodes.splitter);

            // Left channel
            this.nodes.splitter.connect(this.nodes.tubeSat, 0);
            this.nodes.tubeSat.chain(this.nodes.analogFilter, this.nodes.tapeWow, this.nodes.delayL, this.nodes.loFi);
            this.nodes.loFi.connect(this.nodes.merger, 0, 0);

            // Right channel (different processing for stereo image)
            this.nodes.splitter.connect(this.nodes.delayR, 1);
            this.nodes.delayR.connect(this.nodes.merger, 0, 1);

            // Merge to output
            this.nodes.merger.chain(this.nodes.limiter, this.nodes.stereoWidener);

            // Feedback loops
            this.nodes.loFi.connect(this.nodes.feedbackGain);
            this.nodes.feedbackGain.connect(this.nodes.delayL);
            this.nodes.delayR.connect(this.nodes.crossFeedback);
            this.nodes.crossFeedback.connect(this.nodes.delayL); // Ping-pong

            // Modulation routing
            this.nodes.lfo.connect(this.nodes.lfoScaleL);
            this.nodes.lfoScaleL.connect(this.nodes.lfoInvert);
            this.nodes.lfoInvert.connect(this.nodes.lfoScaleR);

            this.nodes.lfoScaleL.connect(this.nodes.delayTimeAdderL.addend);
            this.nodes.baseDelayTimeL.connect(this.nodes.delayTimeAdderL);
            this.nodes.delayTimeAdderL.connect(this.nodes.delayL.delayTime);

            this.nodes.lfoScaleR.connect(this.nodes.delayTimeAdderR.addend);
            this.nodes.baseDelayTimeR.connect(this.nodes.delayTimeAdderR);
            this.nodes.delayTimeAdderR.connect(this.nodes.delayR.delayTime);

            this._disposables.push(
                this.nodes.delayL, this.nodes.delayR, this.nodes.feedbackGain, this.nodes.crossFeedback,
                this.nodes.splitter, this.nodes.merger, this.nodes.tubeSat, this.nodes.analogFilter,
                this.nodes.tapeWow, this.nodes.loFi, this.nodes.limiter,
                this.nodes.lfo, this.nodes.lfoScaleL, this.nodes.lfoScaleR, this.nodes.lfoInvert,
                this.nodes.baseDelayTimeL, this.nodes.baseDelayTimeR,
                this.nodes.delayTimeAdderL, this.nodes.delayTimeAdderR
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.time !== undefined) {
                this._time = clamp(params.time, 0, 4.0);
                this.nodes.baseDelayTimeL.setTargetAtTime(this._time, now, 0.01);
                this.nodes.baseDelayTimeR.setTargetAtTime(this._time * 1.03, now, 0.01); // Slight offset for stereo
            }

            if (params.repeats !== undefined) {
                const safeFeedback = clamp(params.repeats, 0, 0.95);
                this.nodes.feedbackGain.gain.setTargetAtTime(safeFeedback, now, 0.01);
            }

            if (params.pingPong !== undefined) {
                this.nodes.crossFeedback.gain.setTargetAtTime(params.pingPong * 0.5, now, 0.01);
            }

            if (params.mode !== undefined) {
                // Switch between algorithm modes
                this._mode = Math.floor(params.mode);

                // Digital mode: clean, full bandwidth
                if (this._mode === 0) {
                    this.nodes.tubeSat.wet.setTargetAtTime(0, now, 0.01);
                    this.nodes.analogFilter.frequency.setTargetAtTime(12000, now, 0.01);
                    this.nodes.tapeWow.depth.setTargetAtTime(0, now, 0.01);
                    this.nodes.loFi.bits.value = 16;
                }
                // Analog mode: BBD darkening
                else if (this._mode === 1) {
                    this.nodes.tubeSat.wet.setTargetAtTime(0, now, 0.01);
                    this.nodes.analogFilter.frequency.setTargetAtTime(3500, now, 0.01);
                    this.nodes.tapeWow.depth.setTargetAtTime(0, now, 0.01);
                    this.nodes.loFi.bits.value = 16;
                }
                // Tape mode: wow/flutter
                else if (this._mode === 2) {
                    this.nodes.tubeSat.wet.setTargetAtTime(0.15, now, 0.01);
                    this.nodes.analogFilter.frequency.setTargetAtTime(5000, now, 0.01);
                    this.nodes.tapeWow.depth.setTargetAtTime(0.15, now, 0.01);
                    this.nodes.loFi.bits.value = 16;
                }
                // Tube mode: saturation
                else if (this._mode === 3) {
                    this.nodes.tubeSat.wet.setTargetAtTime(0.4, now, 0.01);
                    this.nodes.analogFilter.frequency.setTargetAtTime(6000, now, 0.01);
                    this.nodes.tapeWow.depth.setTargetAtTime(0, now, 0.01);
                    this.nodes.loFi.bits.value = 16;
                }
                // Lo-Fi mode: bit crush
                else if (this._mode === 4) {
                    this.nodes.tubeSat.wet.setTargetAtTime(0, now, 0.01);
                    this.nodes.analogFilter.frequency.setTargetAtTime(8000, now, 0.01);
                    this.nodes.tapeWow.depth.setTargetAtTime(0, now, 0.01);
                    this.nodes.loFi.bits.value = 8;
                }
            }

            if (params.tweak !== undefined) {
                // Tweak often controls tone/filter
                this.nodes.analogFilter.frequency.setTargetAtTime(500 + params.tweak * 7500, now, 0.01);
            }

            if (params.modDepth !== undefined) {
                const depth = clamp(params.modDepth, 0, 0.02);
                this.nodes.lfoScaleL.setTargetAtTime(depth, now, 0.01);
            }
        }
    }

    class MaxonAD9 extends BaseDelay {
        constructor() {
            // Maxon AD-9 Analog Delay (reissue 2002+)
            // Uses MN3205 BBD + Signetics NE570 compander
            // True bypass, cleaner than Ibanez version
            // More readily achieves self-oscillation
            super("MaxonAD9", 0.3, 0.4, 0.3);

            // Compander input (NE570)
            this.nodes.compandIn = new Tone.Filter({ type: 'highshelf', frequency: 2500, gain: 5 });

            // MN3205 BBD
            this.nodes.inputFilter = new Tone.Filter({ frequency: 5000, type: 'lowpass', rolloff: -12 });
            this.nodes.bbdSat = new Tone.Chebyshev(2);
            this.nodes.bbdSat.wet.value = 0.12; // Cleaner than Ibanez version
            this.nodes.bbdFilter = new Tone.Filter({ frequency: 3200, type: 'lowpass', rolloff: -12 });

            // Compander output
            this.nodes.compandOut = new Tone.Filter({ type: 'highshelf', frequency: 2500, gain: -5 });

            // Self-oscillation friendly feedback
            this.nodes.feedbackFilter = new Tone.Filter({ frequency: 2800, type: 'lowpass', rolloff: -12 });

            // Re-route signal
            this.wet.disconnect(this.nodes.delay);
            this.wet.chain(this.nodes.compandIn, this.nodes.inputFilter, this.nodes.bbdSat, this.nodes.delay);

            this.nodes.delay.disconnect();
            this.nodes.delay.chain(this.nodes.bbdFilter, this.nodes.compandOut, this.nodes.limiter, this.nodes.stereoWidener);

            this.nodes.limiter.disconnect(this.nodes.feedbackGain);
            this.nodes.limiter.chain(this.nodes.feedbackFilter, this.nodes.feedbackGain, this.nodes.delay);

            this._disposables.push(
                this.nodes.compandIn, this.nodes.inputFilter, this.nodes.bbdSat,
                this.nodes.bbdFilter, this.nodes.compandOut, this.nodes.feedbackFilter
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.tone !== undefined) {
                this.nodes.bbdFilter.frequency.setTargetAtTime(params.tone, now, 0.01);
            }
        }
    }

    class MorleyAnalogDelay extends BaseDelay {
        constructor() {
            // Morley Analog Delay
            // Same parent company as Tel-Ray (oil can heritage)
            // Darker character, warm BBD sound
            super("MorleyAnalogDelay", 0.3, 0.4, 0.3);

            // BBD characteristics with Morley's darker voicing
            this.nodes.inputFilter = new Tone.Filter({ frequency: 4000, type: 'lowpass', rolloff: -12 });
            this.nodes.bbdSat = new Tone.Chebyshev(2);
            this.nodes.bbdSat.wet.value = 0.18;
            this.nodes.bbdFilter = new Tone.Filter({ frequency: 2800, type: 'lowpass', rolloff: -12 });

            // Darker feedback
            this.nodes.feedbackFilter = new Tone.Filter({ frequency: 2200, type: 'lowpass', rolloff: -12 });

            // Re-route signal
            this.wet.disconnect(this.nodes.delay);
            this.wet.chain(this.nodes.inputFilter, this.nodes.bbdSat, this.nodes.delay);

            this.nodes.delay.disconnect();
            this.nodes.delay.chain(this.nodes.bbdFilter, this.nodes.limiter, this.nodes.stereoWidener);

            this.nodes.limiter.disconnect(this.nodes.feedbackGain);
            this.nodes.limiter.chain(this.nodes.feedbackFilter, this.nodes.feedbackGain, this.nodes.delay);

            this._disposables.push(
                this.nodes.inputFilter, this.nodes.bbdSat, this.nodes.bbdFilter, this.nodes.feedbackFilter
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.tone !== undefined) {
                this.nodes.bbdFilter.frequency.setTargetAtTime(params.tone, now, 0.01);
                this.nodes.feedbackFilter.frequency.setTargetAtTime(params.tone * 0.8, now, 0.01);
            }
        }
    }
    class MXRCarbonCopy extends BaseDelay {
        constructor() {
            // MXR Carbon Copy: Modern classic analog delay (2008)
            // BBD technology with up to 600ms delay
            // Internal Width and Rate trimmers for modulation
            // Key feature: Modulation only affects delay repeats, not dry
            super("MXRCarbonCopy", 0.6, 0.4, 0.6);

            this._time = 0.3;
            this._modWidth = 0;   // Internal trimmer
            this._modRate = 0.5;  // Internal trimmer

            // BBD input anti-aliasing
            this.nodes.inputFilter = new Tone.Filter({ frequency: 4000, type: 'lowpass', rolloff: -12 });

            // BBD saturation (warm analog character)
            this.nodes.bbdSat = new Tone.Chebyshev(2);
            this.nodes.bbdSat.wet.value = 0.2;

            // BBD output reconstruction filter (warm, dark repeats)
            this.nodes.bbdFilter = new Tone.Filter({ frequency: 2500, type: 'lowpass', rolloff: -12 });

            // Additional feedback darkening (cumulative per repeat)
            this.nodes.feedbackTone = new Tone.Filter({ frequency: 2200, type: 'lowpass', rolloff: -12 });

            // Modulation: Applied ONLY to delay line (not dry signal)
            // This is key to Carbon Copy's character
            this.nodes.lfo = new Tone.LFO({ frequency: 0.5, type: 'sine' }).start();
            this.nodes.lfoScale = new Tone.Multiply(0);
            this.nodes.baseDelayTime = new Tone.Signal(this._time);
            this.nodes.delayTimeAdder = new Tone.Add();

            // Re-route signal chain
            this.wet.disconnect(this.nodes.delay);
            this.wet.chain(this.nodes.inputFilter, this.nodes.bbdSat, this.nodes.delay);

            this.nodes.delay.disconnect();
            this.nodes.delay.chain(this.nodes.bbdFilter, this.nodes.limiter, this.nodes.stereoWidener);

            // Feedback loop with additional darkening
            this.nodes.limiter.disconnect(this.nodes.feedbackGain);
            this.nodes.limiter.chain(this.nodes.feedbackTone, this.nodes.feedbackGain, this.nodes.delay);

            // Modulation routing
            this.nodes.lfo.connect(this.nodes.lfoScale);
            this.nodes.lfoScale.connect(this.nodes.delayTimeAdder.addend);
            this.nodes.baseDelayTime.connect(this.nodes.delayTimeAdder);
            this.nodes.delayTimeAdder.connect(this.nodes.delay.delayTime);

            this._disposables.push(
                this.nodes.inputFilter, this.nodes.bbdSat, this.nodes.bbdFilter, this.nodes.feedbackTone,
                this.nodes.lfo, this.nodes.lfoScale, this.nodes.baseDelayTime, this.nodes.delayTimeAdder
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.time !== undefined) {
                this._time = clamp(params.time, 0, 0.6);
                this.nodes.baseDelayTime.setTargetAtTime(this._time, now, 0.01);

                // BBD filter tracks delay time (longer = darker)
                const filterFreq = 4000 - (this._time * 2500);
                this.nodes.bbdFilter.frequency.setTargetAtTime(Math.max(1500, filterFreq), now, 0.01);
            }

            if (params.feedback !== undefined || params.repeats !== undefined) {
                const fb = params.feedback !== undefined ? params.feedback : params.repeats;
                this.nodes.feedbackGain.gain.setTargetAtTime(clamp(fb, 0, 0.98), now, 0.01);
            }

            // Internal modulation trimmers
            if (params.modWidth !== undefined) {
                this._modWidth = clamp(params.modWidth, 0, 0.03);
                const safeWidth = Math.min(this._modWidth, this._time * 0.08);
                this.nodes.lfoScale.setTargetAtTime(safeWidth, now, 0.01);
            }

            if (params.modRate !== undefined) {
                this._modRate = clamp(params.modRate, 0.1, 8);
                this.nodes.lfo.frequency.setTargetAtTime(this._modRate, now, 0.01);
            }

            // Mod button toggle (enables/disables modulation)
            if (params.mod !== undefined) {
                const modEnabled = params.mod > 0.5 ? 1 : 0;
                if (modEnabled) {
                    const safeWidth = Math.min(this._modWidth, this._time * 0.08);
                    this.nodes.lfoScale.setTargetAtTime(safeWidth, now, 0.01);
                } else {
                    this.nodes.lfoScale.setTargetAtTime(0, now, 0.01);
                }
            }
        }
    }
    class RolandSpaceEcho extends TapeDelayBase {
        constructor() {
            // Initial values for TapeDelayBase: name, time, feedback, maxDelay, filterFreq, wowFlutterDepth, driveAmount, noiseAmount, noiseType
            super("RolandSpaceEcho", 0.5, 0.5, 2.0, 3500, 0.001, 0.1, 0.01, "brown");

            // Re-head logic: RE-201 has 3 playback heads
            this.nodes.delay1 = new Tone.Delay(0, 2.0);
            this.nodes.delay2 = new Tone.Delay(0, 2.0);
            this.nodes.delay3 = new Tone.Delay(0, 2.0);

            this.nodes.head1Gain = new Tone.Gain(1);
            this.nodes.head2Gain = new Tone.Gain(0);
            this.nodes.head3Gain = new Tone.Gain(0);

            // Authentic RE-201 Spring Reverb Simulation (Z-3F Tank)
            // Replaces generic Freeverb with multi-spring simulation
            this.nodes.reverbInput = new Tone.Gain(1);
            this.nodes.springPreFilter = new Tone.Filter({ frequency: 200, type: 'highpass' });

            // Two springs with slightly different decay times for "boing"
            // Z-3F tank decay is approx 1.5s - 2.5s
            this.nodes.spring1 = new Tone.FeedbackCombFilter({ delayTime: 0.029, resonance: 0.84 });
            this.nodes.spring2 = new Tone.FeedbackCombFilter({ delayTime: 0.037, resonance: 0.82 });

            this.nodes.springTone = new Tone.Filter({ frequency: 3500, type: 'lowpass', rolloff: -12 });

            this.nodes.reverbMerge = new Tone.Merge();
            this.nodes.reverbVolume = new Tone.Gain(0);
            this.nodes.echoVolume = new Tone.Gain(0.8);

            this.nodes.bass = new Tone.Filter({ type: 'lowshelf', frequency: 200, gain: 0 });
            this.nodes.treble = new Tone.Filter({ type: 'highshelf', frequency: 4000, gain: 0 });

            // Space Echo Signal Path:
            // Input -> Preamp (tapeDrive) ->
            this.wet.disconnect();
            this.wet.chain(this.nodes.tapeDrive);

            this.nodes.tapeDrive.fan(this.nodes.delay1, this.nodes.delay2, this.nodes.delay3, this.nodes.reverbInput);

            // Reverb Path: PreFilter -> Springs -> Merge -> Tone -> Vol -> EQ
            this.nodes.reverbInput.connect(this.nodes.springPreFilter);
            this.nodes.springPreFilter.fan(this.nodes.spring1, this.nodes.spring2);
            this.nodes.spring1.connect(this.nodes.reverbMerge, 0, 0);
            this.nodes.spring2.connect(this.nodes.reverbMerge, 0, 1);

            this.nodes.reverbMerge.chain(this.nodes.springTone, this.nodes.reverbVolume, this.nodes.bass, this.nodes.treble, this.nodes.stereoWidener);

            this.nodes.delay1.connect(this.nodes.head1Gain);
            this.nodes.delay2.connect(this.nodes.head2Gain);
            this.nodes.delay3.connect(this.nodes.head3Gain);

            this.nodes.headSum = new Tone.Gain();
            this.nodes.head1Gain.connect(this.nodes.headSum);
            this.nodes.head2Gain.connect(this.nodes.headSum);
            this.nodes.head3Gain.connect(this.nodes.headSum);

            this.nodes.headSum.chain(this.nodes.echoVolume, this.nodes.bass, this.nodes.treble, this.nodes.stereoWidener);

            // Feedback: Sum of active heads -> Filter -> TapeDrive -> FeedbackGain -> Input of all delays
            this.nodes.headSum.chain(this.nodes.tapeFilter, this.nodes.feedbackGain);
            this.nodes.feedbackGain.fan(this.nodes.delay1, this.nodes.delay2, this.nodes.delay3);

            // WOW/FLUTTER: Connect to all heads
            // TapeDelayBase.constructor already created wowFlutterScale, etc.
            // We need to route it to all 3 delays.
            this.nodes.wowFlutterScale.disconnect(); // Disconnect from default delay

            this.nodes.head1Freq = new Tone.Multiply(1.0);
            this.nodes.head2Freq = new Tone.Multiply(1.95);
            this.nodes.head3Freq = new Tone.Multiply(3.15);

            this.nodes.baseDelayTime.fan(this.nodes.head1Freq, this.nodes.head2Freq, this.nodes.head3Freq);

            // Individual delay time adders for each head to include flutter
            this.nodes.add1 = new Tone.Add();
            this.nodes.add2 = new Tone.Add();
            this.nodes.add3 = new Tone.Add();

            this.nodes.head1Freq.connect(this.nodes.add1);
            this.nodes.head2Freq.connect(this.nodes.add2);
            this.nodes.head3Freq.connect(this.nodes.add3);

            this.nodes.wowFlutterScale.fan(this.nodes.add1.addend, this.nodes.add2.addend, this.nodes.add3.addend);

            this.nodes.add1.connect(this.nodes.delay1.delayTime);
            this.nodes.add2.connect(this.nodes.delay2.delayTime);
            this.nodes.add3.connect(this.nodes.delay3.delayTime);

            this._disposables.push(
                this.nodes.delay1, this.nodes.delay2, this.nodes.delay3,
                this.nodes.head1Gain, this.nodes.head2Gain, this.nodes.head3Gain,
                this.nodes.headSum, this.nodes.reverbVolume, this.nodes.echoVolume,
                this.nodes.bass, this.nodes.treble,
                this.nodes.head1Freq, this.nodes.head2Freq, this.nodes.head3Freq,
                this.nodes.add1, this.nodes.add2, this.nodes.add3,
                this.nodes.reverbInput, this.nodes.springPreFilter, this.nodes.spring1, this.nodes.spring2,
                this.nodes.reverbMerge, this.nodes.springTone
            );
        }
        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.mode !== undefined) {
                const m = Math.round(params.mode);
                // 12-Position Mode Selector
                const heads = [
                    [1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 1, 1], [1, 1, 0], [1, 0, 1], [1, 1, 1], // 1-7 Echo only
                    [1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 1, 1], [1, 1, 1]                    // 8-12 Echo + Reverb
                ];
                const active = heads[clamp(m - 1, 0, 11)];
                this.nodes.head1Gain.gain.setTargetAtTime(active[0], now, 0.01);
                this.nodes.head2Gain.gain.setTargetAtTime(active[1], now, 0.01);
                this.nodes.head3Gain.gain.setTargetAtTime(active[2], now, 0.01);

                // Reverb is active for modes 8-12
                const reverbWet = m >= 8 ? 1 : 0;
                this.nodes.reverbVolume.gain.setTargetAtTime(reverbWet * (this._reverbVol || 0.5), now, 0.01);
            }

            if (params.echoVolume !== undefined) this.nodes.echoVolume.gain.setTargetAtTime(params.echoVolume, now, 0.01);
            if (params.reverbVolume !== undefined) {
                this._reverbVol = params.reverbVolume;
                this.nodes.reverbVolume.gain.setTargetAtTime(params.reverbVolume, now, 0.01);
            }
            if (params.bass !== undefined) this.nodes.bass.gain.setTargetAtTime(params.bass, now, 0.01);
            if (params.treble !== undefined) this.nodes.treble.gain.setTargetAtTime(params.treble, now, 0.01);
            if (params.intensity !== undefined) this.nodes.feedbackGain.gain.setTargetAtTime(clamp(params.intensity, 0, 1.1), now, 0.01);
        }
    }
    class TC2290Delay extends BaseDelay {
        constructor() {
            super("TC2290Delay", 2.0, 0.6, 2.0);
            this.nodes.highCut = new Tone.Filter({ type: 'lowpass', frequency: 20000 });
            this.nodes.lfo = new Tone.LFO({ frequency: 0.2, amplitude: 1 }).start();
            this.nodes.lfoScale = new Tone.Multiply(0);
            this.nodes.baseDelayTime = new Tone.Signal(2.0);
            this.nodes.delayTimeAdder = new Tone.Add();
            this.nodes.compressor = new Tone.Compressor({ threshold: -60, ratio: 4 });
            this.nodes.sidechain = new Tone.Gain();

            // Clear all BaseDelay default routing to avoid confusion/redundancy
            this.wet.disconnect();
            this.nodes.delay.disconnect();
            this.nodes.limiter.disconnect();

            // TC2290 Routing:
            // 1. Input path: signal goes to sidechain gain and delay line
            this.wet.connect(this.nodes.sidechain);
            this.wet.connect(this.nodes.delay);

            // 2. Audio Processing path: Delay -> HighCut -> Compressor -> StereoWidener
            this.nodes.delay.connect(this.nodes.highCut);
            this.nodes.highCut.connect(this.nodes.compressor);
            this.nodes.compressor.connect(this.nodes.stereoWidener);

            // 3. Sidechain / Control path: Send signal to compressor input for ducking calculation
            this.nodes.sidechain.connect(this.nodes.compressor);

            // 4. Feedback loop: Compressor output goes back to delay input
            this.nodes.compressor.connect(this.nodes.feedbackGain);
            this.nodes.feedbackGain.connect(this.nodes.delay);

            this.nodes.lfo.connect(this.nodes.lfoScale);
            this.nodes.lfoScale.connect(this.nodes.delayTimeAdder.addend);
            this.nodes.baseDelayTime.connect(this.nodes.delayTimeAdder);
            this.nodes.delayTimeAdder.connect(this.nodes.delay.delayTime);
            this._disposables.push(this.nodes.highCut, this.nodes.lfo, this.nodes.lfoScale, this.nodes.baseDelayTime, this.nodes.delayTimeAdder, this.nodes.compressor, this.nodes.sidechain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.delay !== undefined) this.nodes.baseDelayTime.setTargetAtTime(params.delay, now, 0.01);
            if (params.highCut !== undefined) this.nodes.highCut.frequency.setTargetAtTime(params.highCut, now, 0.01);
            if (params.modSpeed !== undefined) this.nodes.lfo.frequency.setTargetAtTime(params.modSpeed, now, 0.01);
            if (params.modDepth !== undefined) this.nodes.lfoScale.setTargetAtTime(params.modDepth, now, 0.01);
            if (params.ducking !== undefined) this.nodes.compressor.threshold.setTargetAtTime(params.ducking, now, 0.01);
        }
    }
    class TelRayMorleyOilCanDelay extends EffectBase {
        constructor() {
            // Tel-Ray/Morley Oil Can Delay (1959 patent, production through 1970s)
            // Unique electrostatic delay using anodized aluminum disc in fluid
            // Characteristic: dark, watery, warbly sound with natural pitch vibrato
            // 60-300ms delay, unpredictable gorgeous repeats
            super("TelRayMorleyOilCanDelay");

            this._time = 0.15;
            this._variation = 0.5;

            // Core delay
            this.nodes.delay = new Tone.FeedbackDelay({
                delayTime: 0.15,
                feedback: 0.5,
                maxDelay: 0.5
            });

            // Oil can characteristic: very dark, watery
            this.nodes.oilFilter = new Tone.Filter({ frequency: 2500, type: 'lowpass', rolloff: -12 });
            this.nodes.oilDarkening = new Tone.Filter({ type: 'highshelf', frequency: 2000, gain: -4 });

            // Vibrato for wow/flutter (oil can warble - Pitch Modulation)
            this.nodes.vibrato = new Tone.Vibrato({ frequency: 0.5, depth: 0.02 });

            // Tremolo (Amplitude Modulation) simulates the spinning disc's uneven pickup
            this.nodes.tremolo = new Tone.Tremolo({ frequency: 0.5, depth: 0.4, type: 'sine' }).start();

            // Subtle saturation from the electrostatic process
            this.nodes.saturation = new Tone.Distortion(0.1);

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(
                this.nodes.vibrato,
                this.nodes.tremolo,
                this.nodes.oilFilter,
                this.nodes.delay,
                this.nodes.oilDarkening,
                this.nodes.saturation,
                this.nodes.stereoWidener
            );

            this._disposables.push(
                this.nodes.delay, this.nodes.oilFilter, this.nodes.oilDarkening,
                this.nodes.vibrato, this.nodes.tremolo, this.nodes.saturation
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.time !== undefined) {
                this._time = clamp(params.time, 0.06, 0.3);
                this.nodes.delay.delayTime.setTargetAtTime(this._time, now, 0.01);
            }

            if (params.variation !== undefined) {
                this._variation = params.variation;
                // More variation = more warble (FM) and throb (AM)
                // Variation scaling
                const vibDepth = 0.01 + this._variation * 0.05;
                const vibFreq = 0.3 + this._variation * 0.7; // Spinning speed

                this.nodes.vibrato.depth.setTargetAtTime(vibDepth, now, 0.01);
                this.nodes.vibrato.frequency.setTargetAtTime(vibFreq, now, 0.01);

                // Tremolo syncs with Vibrato speed
                this.nodes.tremolo.frequency.setTargetAtTime(vibFreq, now, 0.01);
                this.nodes.tremolo.depth.setTargetAtTime(0.2 + this._variation * 0.4, now, 0.01);
            }

            if (params.tone !== undefined) {
                this.nodes.oilFilter.frequency.setTargetAtTime(params.tone, now, 0.01);
            }

            if (params.repeats !== undefined) {
                this.nodes.delay.feedback.setTargetAtTime(clamp(params.repeats, 0, 0.9), now, 0.01);
            }
        }
    }
    class WatkinsCopicat extends EffectBase { // Overriding base constructor
        constructor() {
            super("WatkinsCopicat");
            this.nodes.sum = new Tone.Gain();
            this.nodes.delay1 = new Tone.Delay(0.5, 1.5); // maxDelay changed to 1.5
            this.nodes.delay2 = new Tone.Delay(1.0, 1.5); // maxDelay changed to 1.5
            this.nodes.delay3 = new Tone.Delay(1.5, 1.5); // maxDelay changed to 1.5
            this.nodes.gain1 = new Tone.Gain(1);
            this.nodes.gain2 = new Tone.Gain(0);
            this.nodes.gain3 = new Tone.Gain(0);
            this.nodes.feedback = new Tone.Gain(0.6);
            this.nodes.filter = new Tone.Filter({ frequency: 3000, type: 'lowpass' });

            // Add tape characteristics
            this.nodes.wowFlutterLFO = new Tone.LFO({ frequency: 4, type: 'sine' }).start(); // Subtle wow/flutter
            this.nodes.wowFlutterScale = new Tone.Multiply(0.001);
            this.nodes.baseDelayTime1 = new Tone.Signal(0.5);
            this.nodes.delayTimeAdder1 = new Tone.Add();
            this.nodes.baseDelayTime2 = new Tone.Signal(1.0);
            this.nodes.delayTimeAdder2 = new Tone.Add();
            this.nodes.baseDelayTime3 = new Tone.Signal(1.5);
            this.nodes.delayTimeAdder3 = new Tone.Add();
            this.nodes.tapeDrive = new Tone.Distortion({ distortion: 0 });
            this.nodes.tapeNoise = new Tone.Noise("brown").start();
            this.nodes.tapeNoiseGain = new Tone.Gain(0.01); // Default tape hiss amount

            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.connect(this.nodes.sum);
            this.nodes.sum.fan(this.nodes.delay1, this.nodes.delay2, this.nodes.delay3);

            this.nodes.delay1.connect(this.nodes.gain1);
            this.nodes.delay2.connect(this.nodes.gain2);
            this.nodes.delay3.connect(this.nodes.gain3);
            this.nodes.gain1.connect(this.nodes.filter);
            this.nodes.gain2.connect(this.nodes.filter);
            this.nodes.gain3.connect(this.nodes.filter);

            this.nodes.filter.connect(this.nodes.stereoWidener);

            // Integrate tape characteristics into the feedback chain
            this.nodes.filter.chain(this.nodes.tapeDrive, this.nodes.feedback, this.nodes.sum);
            this.nodes.tapeNoise.connect(this.nodes.tapeNoiseGain);
            this.nodes.tapeNoiseGain.connect(this.nodes.feedback);

            // Modulate delay times for wow/flutter
            this.nodes.wowFlutterLFO.connect(this.nodes.wowFlutterScale);
            this.nodes.wowFlutterScale.connect(this.nodes.delayTimeAdder1.addend);
            this.nodes.baseDelayTime1.connect(this.nodes.delayTimeAdder1);
            this.nodes.delayTimeAdder1.connect(this.nodes.delay1.delayTime);
            this.nodes.wowFlutterScale.connect(this.nodes.delayTimeAdder2.addend);
            this.nodes.baseDelayTime2.connect(this.nodes.delayTimeAdder2);
            this.nodes.delayTimeAdder2.connect(this.nodes.delay2.delayTime);
            this.nodes.wowFlutterScale.connect(this.nodes.delayTimeAdder3.addend);
            this.nodes.baseDelayTime3.connect(this.nodes.delayTimeAdder3);
            this.nodes.delayTimeAdder3.connect(this.nodes.delay3.delayTime);

            this._disposables.push(this.nodes.sum, this.nodes.delay1, this.nodes.delay2, this.nodes.delay3, this.nodes.gain1, this.nodes.gain2, this.nodes.gain3, this.nodes.feedback, this.nodes.filter, this.nodes.wowFlutterLFO, this.nodes.wowFlutterScale, this.nodes.baseDelayTime1, this.nodes.delayTimeAdder1, this.nodes.baseDelayTime2, this.nodes.delayTimeAdder2, this.nodes.baseDelayTime3, this.nodes.delayTimeAdder3, this.nodes.tapeDrive, this.nodes.tapeNoise, this.nodes.tapeNoiseGain);
        }
        set(params) {
            super.set(params);
            const now = Tone.now();
            if (params.time !== undefined) {
                this.nodes.baseDelayTime1.setTargetAtTime(params.time, now, RAMP_TIME);
                this.nodes.baseDelayTime2.setTargetAtTime(params.time * 2, now, RAMP_TIME);
                this.nodes.baseDelayTime3.setTargetAtTime(params.time * 3, now, RAMP_TIME);
            }
            if (params.swell !== undefined) this.nodes.feedback.gain.setTargetAtTime(clamp(params.swell, 0, 1), now, RAMP_TIME);
            if (params.head1 !== undefined) this.nodes.gain1.gain.setTargetAtTime(params.head1, now, RAMP_TIME);
            if (params.head2 !== undefined) this.nodes.gain2.gain.setTargetAtTime(params.head2, now, RAMP_TIME);
            if (params.head3 !== undefined) this.nodes.gain3.gain.setTargetAtTime(params.head3, now, RAMP_TIME);
            // New tape parameters
            if (params.wowFlutterDepth !== undefined) {
                this.nodes.wowFlutterScale.factor.setTargetAtTime(params.wowFlutterDepth, now, RAMP_TIME);
            }
            if (params.driveAmount !== undefined) this.nodes.tapeDrive.distortion = params.driveAmount;
            if (params.noiseAmount !== undefined) this.nodes.tapeNoiseGain.gain.setTargetAtTime(params.noiseAmount, now, RAMP_TIME);
            if (params.filterFreq !== undefined) this.nodes.filter.frequency.setTargetAtTime(params.filterFreq, now, RAMP_TIME);
        }
    }
    class WayHugeAquaPuss extends BaseDelay {
        constructor() {
            // Way Huge Aqua Puss MkII (original used MN3005 BBD)
            // 300ms max delay, warm analog character
            // Simple 3-knob design: Delay, Feedback, Blend
            super("WayHugeAquaPuss", 0.3, 0.4, 0.3);

            // MN3005 BBD characteristics
            this.nodes.inputFilter = new Tone.Filter({ frequency: 4500, type: 'lowpass', rolloff: -12 });
            this.nodes.bbdSat = new Tone.Chebyshev(2);
            this.nodes.bbdSat.wet.value = 0.18;
            this.nodes.outputFilter = new Tone.Filter({ frequency: 2900, type: 'lowpass', rolloff: -12 });

            // Feedback darkening
            this.nodes.feedbackFilter = new Tone.Filter({ frequency: 2400, type: 'lowpass', rolloff: -12 });

            // Re-route signal
            this.wet.disconnect(this.nodes.delay);
            this.wet.chain(this.nodes.inputFilter, this.nodes.bbdSat, this.nodes.delay);

            this.nodes.delay.disconnect();
            this.nodes.delay.chain(this.nodes.outputFilter, this.nodes.limiter, this.nodes.stereoWidener);

            this.nodes.limiter.disconnect(this.nodes.feedbackGain);
            this.nodes.limiter.chain(this.nodes.feedbackFilter, this.nodes.feedbackGain, this.nodes.delay);

            this._disposables.push(
                this.nodes.inputFilter, this.nodes.bbdSat, this.nodes.outputFilter, this.nodes.feedbackFilter
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.tone !== undefined) {
                this.nodes.outputFilter.frequency.setTargetAtTime(params.tone, now, 0.01);
                this.nodes.feedbackFilter.frequency.setTargetAtTime(params.tone * 0.8, now, 0.01);
            }

            if (params.time !== undefined) {
                // BBD filter tracks delay time
                const filterFreq = 4500 - (params.time * 5000);
                this.nodes.inputFilter.frequency.setTargetAtTime(Math.max(2000, filterFreq), now, 0.01);
            }
        }
    }

    class YamahaE1010 extends BaseDelay {
        constructor() {
            // Yamaha E1010 Analog Delay (late 1970s-early 1980s)
            // Multiple BBD ICs: MN3004 (10ms range) + MN3005 (longer ranges)
            // 5 delay ranges: 10, 75, 150, 225, 300ms
            // Modulation for chorus/flange/vibrato
            // Compander circuit for clean signal
            // Bass/Treble shelving EQ on delayed signal
            super("YamahaE1010", 0.15, 0.4, 0.3);

            this._time = 0.15;
            this._range = 75; // Current delay range (10, 75, 150, 225, 300)

            // Compander input stage (pre-emphasis)
            this.nodes.compandIn = new Tone.Filter({ type: 'highshelf', frequency: 2500, gain: 4 });

            // BBD chips output filter (varies with delay time)
            this.nodes.bbdFilter = new Tone.Filter({ frequency: 8000, type: 'lowpass', rolloff: -12 });

            // Compander output stage (de-emphasis)
            this.nodes.compandOut = new Tone.Filter({ type: 'highshelf', frequency: 2500, gain: -4 });

            // Bass/Treble EQ (±12dB shelving at 70Hz and 7kHz)
            this.nodes.bassEQ = new Tone.Filter({ type: 'lowshelf', frequency: 70, gain: 0 });
            this.nodes.trebleEQ = new Tone.Filter({ type: 'highshelf', frequency: 7000, gain: 0 });

            // Modulation for chorus/flange
            this.nodes.lfo = new Tone.LFO({ frequency: 0.5, type: 'sine' }).start();
            this.nodes.lfoScale = new Tone.Multiply(0);
            this.nodes.baseDelayTime = new Tone.Signal(this._time);
            this.nodes.delayTimeAdder = new Tone.Add();

            // Re-route signal
            this.wet.disconnect(this.nodes.delay);
            this.wet.chain(this.nodes.compandIn, this.nodes.delay);

            this.nodes.delay.disconnect();
            this.nodes.delay.chain(
                this.nodes.bbdFilter,
                this.nodes.compandOut,
                this.nodes.bassEQ,
                this.nodes.trebleEQ,
                this.nodes.limiter,
                this.nodes.stereoWidener
            );

            // Modulation routing
            this.nodes.lfo.connect(this.nodes.lfoScale);
            this.nodes.lfoScale.connect(this.nodes.delayTimeAdder.addend);
            this.nodes.baseDelayTime.connect(this.nodes.delayTimeAdder);
            this.nodes.delayTimeAdder.connect(this.nodes.delay.delayTime);

            this._disposables.push(
                this.nodes.compandIn, this.nodes.bbdFilter, this.nodes.compandOut,
                this.nodes.bassEQ, this.nodes.trebleEQ,
                this.nodes.lfo, this.nodes.lfoScale, this.nodes.baseDelayTime, this.nodes.delayTimeAdder
            );
        }

        set(params) {
            super.set(params);
            const now = Tone.now();

            if (params.time !== undefined) {
                this._time = clamp(params.time, 0, 0.3);
                this.nodes.baseDelayTime.setTargetAtTime(this._time, now, 0.01);

                // BBD filter frequency decreases with delay time
                // 8kHz at 10ms, 2kHz at 300ms
                const filterFreq = 8000 - (this._time * 20000);
                this.nodes.bbdFilter.frequency.setTargetAtTime(Math.max(2000, filterFreq), now, 0.01);
            }

            if (params.bass !== undefined) {
                this.nodes.bassEQ.gain.setTargetAtTime((params.bass - 0.5) * 24, now, 0.01); // ±12dB
            }

            if (params.treble !== undefined) {
                this.nodes.trebleEQ.gain.setTargetAtTime((params.treble - 0.5) * 24, now, 0.01); // ±12dB
            }

            if (params.modSpeed !== undefined) {
                this.nodes.lfo.frequency.setTargetAtTime(clamp(params.modSpeed, 0.5, 10), now, 0.01);
            }

            if (params.modDepth !== undefined) {
                // Depth varies with delay time: ±10% at 10ms, ±30% at 300ms
                const maxDepth = 0.1 + (this._time * 0.67);
                const depth = clamp(params.modDepth, 0, maxDepth) * this._time;
                this.nodes.lfoScale.setTargetAtTime(depth, now, 0.01);
            }
        }
    }
    class TapeEcho extends TapeDelayBase {
        constructor() {
            // Initial values for TapeDelayBase: name, time, feedback, maxDelay, filterFreq, wowFlutterDepth, driveAmount, noiseAmount, noiseType
            super("TapeEcho", 0.8, 0.4, 0.8, 4000, 0, 0, 0.01, "brown"); // Default wowFlutterDepth and noiseAmount

            // Disconnect the default wet.chain from TapeDelayBase and re-chain it to include the drive before the delay.
            this.wet.disconnect(this.nodes.delay);
            this.wet.chain(this.nodes.tapeDrive, this.nodes.delay);

            // Remove redundant disposables as they are now part of TapeDelayBase
            this._disposables = this._disposables.filter(node =>
                node !== this.nodes.filter &&
                node !== this.nodes.drive &&
                node !== this.nodes.lfo
            );
        }
        set(params) {
            super.set(params); // Handles time, feedback, filterFreq, wowFlutterDepth, driveAmount, noiseAmount
            const now = Tone.now();

            // Map parameters to TapeDelayBase
            if (params.drive !== undefined) this.nodes.tapeDrive.distortion = params.drive;
            if (params.age !== undefined) this.nodes.tapeFilter.frequency.setTargetAtTime(4000 - (params.age * 2000), now, RAMP_TIME);
            if (params.wowFlutter !== undefined) {
                this.nodes.wowFlutterScale.factor.setTargetAtTime(params.wowFlutter, now, RAMP_TIME);
            }
        }
    }

    const classes = { AnalogDelayStereo, ArionSAD1, BackTalkReverseDelay, BossDD2, BossDD3Delay, BossDM2Delay, CatalinbreadEchorec, DOD680AnalogDelay, DeltalabEffectronJr, DigitechPDS1002, DigitechPDS2020, EchoplexEP2, EchoplexEP3, EHXDeluxeMemoryMan, EHXMemoryBoy, EHXMemoryToy, IbanezAD9, IbanezDE7, JHSPantherCub, KeeleyMagneticEcho, KorgSDD3000, LexiconPCM42, Line6DL4, MaxonAD9, MorleyAnalogDelay, MXRCarbonCopy, RolandSpaceEcho, TC2290Delay, TapeEcho, TelRayMorleyOilCanDelay, WatkinsCopicat, WayHugeAquaPuss, YamahaE1010 };
    const configs = { "Delay": { "Analog: Stereo BBD": { "isCustom": "AnalogDelayStereo", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.02, "max": 1.0, "s": 0.001, "def": 1.0 }, { "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }], [{ "l": "Tone", "p": "tone", "min": 500, "max": 6000, "s": 10, "def": 6000 }], [{ "l": "Mod Rate", "p": "modRate", "min": 0.1, "max": 4, "s": 0.01, "def": 1 }, { "l": "Mod Depth", "p": "modDepth", "min": 0, "max": 0.02, "s": 0.001, "def": 0 }]] }, "Analog: Arion SAD-1": { "isCustom": "ArionSAD1", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.02, "max": 0.4, "def": 0.4 }, { "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "def": 0.4 }], [{ "l": "Mode", "p": "mode", "min": 0, "max": 1, "s": 1, "def": 0, "unit": " M/S" }]] }, "Analog: Boss DM-2": { "isCustom": "BossDM2Delay", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.02, "max": 0.3, "s": 0.001, "def": 0.3 }, { "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "s": 0.01, "def": 0.4 }], [{ "l": "Tone", "p": "tone", "min": 1000, "max": 4000, "s": 10, "def": 2800 }, { "l": "Drive", "p": "drive", "min": 0, "max": 0.5, "s": 0.01, "def": 0.2 }]] }, "Analog: DOD 680": { "isCustom": "DOD680AnalogDelay", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.02, "max": 0.4, "def": 0.4 }, { "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "def": 0.4 }], [{ "l": "Tone", "p": "tone", "min": 1000, "max": 5000, "s": 10, "def": 3000 }]] }, "Analog: EHX Dlx Memory Man": { "isCustom": "EHXDeluxeMemoryMan", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Drive", "p": "drive", "min": 0, "max": 1, "def": 0 }, { "l": "Time", "p": "time", "min": 0.02, "max": 0.55, "s": 0.001, "def": 0.55 }], [{ "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }, { "l": "Mod Depth", "p": "modDepth", "min": 0, "max": 0.05, "s": 0.001, "def": 0 }], [{ "l": "Mod Rate", "p": "modRate", "min": 0.1, "max": 4, "s": 0.01, "def": 1 }]] }, "Analog: EHX Memory Boy": { "isCustom": "EHXMemoryBoy", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.03, "max": 0.55, "def": 0.55 }, { "l": "Repeats", "p": "repeats", "min": 0, "max": 1, "def": 0.4 }], [{ "l": "Depth", "p": "depth", "min": 0, "max": 0.02, "s": 0.001, "def": 0 }, { "l": "Rate", "p": "rate", "min": 0.1, "max": 5, "s": 0.1, "def": 2 }], [{ "l": "Shape", "p": "shape", "min": 0, "max": 1, "s": 1, "def": 0, "unit": " Tri/Sqr" }]] }, "Analog: EHX Memory Toy": { "isCustom": "EHXMemoryToy", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.03, "max": 0.4, "def": 0.4 }, { "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "def": 0.4 }], [{ "l": "Tone", "p": "tone", "min": 1000, "max": 5000, "s": 10, "def": 3100 }]] }, "Analog: Ibanez AD-9": { "isCustom": "IbanezAD9", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.02, "max": 0.4, "def": 0.4 }, { "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "def": 0.4 }], [{ "l": "Tone", "p": "tone", "min": 1000, "max": 5000, "s": 10, "def": 3200 }]] }, "Analog: JHS Panther Cub": { "isCustom": "JHSPantherCub", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.02, "max": 1, "s": 0.001, "def": 1.0 }, { "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "s": 0.01, "def": 0.4 }], [{ "l": "Speed", "p": "speed", "min": 0.1, "max": 10, "s": 0.1, "def": 2 }, { "l": "Depth", "p": "depth", "min": 0, "max": 0.02, "s": 0.001, "def": 0 }], [{ "l": "EQ", "p": "eq", "min": 500, "max": 5000, "s": 10, "def": 5000 }]] }, "Analog: Maxon AD-9": { "isCustom": "MaxonAD9", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.02, "max": 0.4, "def": 0.4 }, { "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "def": 0.4 }], [{ "l": "Tone", "p": "tone", "min": 1000, "max": 5000, "s": 10, "def": 3000 }]] }, "Analog: Morley": { "isCustom": "MorleyAnalogDelay", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.02, "max": 0.4, "def": 0.4 }, { "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "def": 0.4 }], [{ "l": "Tone", "p": "tone", "min": 1000, "max": 5000, "s": 10, "def": 2800 }]] }, "Analog: MXR Carbon Copy": { "isCustom": "MXRCarbonCopy", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.02, "max": 0.6, "s": 0.001, "def": 0.6 }, { "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "s": 0.01, "def": 0.4 }], [{ "l": "Mod", "p": "mod", "min": 0, "max": 1, "s": 1, "def": 0 }, { "l": "Mod Rate", "p": "modRate", "min": 0.1, "max": 4, "s": 0.01, "def": 1 }, { "l": "Mod Width", "p": "modWidth", "min": 0, "max": 0.01, "s": 0.001, "def": 0 }]] }, "Analog: Way Huge Aqua Puss": { "isCustom": "WayHugeAquaPuss", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.02, "max": 0.4, "def": 0.4 }, { "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "def": 0.4 }], [{ "l": "Tone", "p": "tone", "min": 1000, "max": 5000, "s": 10, "def": 2900 }]] }, "Analog: Yamaha E1010": { "isCustom": "YamahaE1010", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.02, "max": 0.4, "def": 0.4 }, { "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "def": 0.4 }], [{ "l": "Mod Speed", "p": "modSpeed", "min": 0.1, "max": 10, "def": 4 }, { "l": "Mod Depth", "p": "modDepth", "min": 0, "max": 0.01, "def": 0 }], [{ "l": "Tone", "p": "tone", "min": 1000, "max": 5000, "s": 10, "def": 3000 }]] }, "Digital: ADA Flanger": { "isCustom": "ADADelay", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Manual", "p": "manual", "min": 0.001, "max": 0.02, "s": 0.0001, "def": 0.02 }, { "l": "Range", "p": "range", "min": 0, "max": 1, "s": 0.01, "def": 0 }], [{ "l": "Speed", "p": "speed", "min": 0.1, "max": 10, "s": 0.1, "def": 0.5 }, { "l": "Enhance", "p": "enhance", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }], [{ "l": "Threshold", "p": "threshold", "min": -60, "max": 0, "s": 1, "def": -40 }]] }, "Digital: Boss DD-2": { "isCustom": "BossDD2", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }], [{ "l": "Mode", "p": "mode", "min": 0, "max": 2.9, "s": 1, "def": 2, "unit": " S/M/L" }]] }, "Digital: Boss DD-3": { "isCustom": "BossDD3Delay", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }], [{ "l": "Mode", "p": "mode", "min": 0, "max": 3.9, "s": 1, "def": 2, "unit": " S/M/L/H" }]] }, "Digital: Deltalab Effectron Jr": { "isCustom": "DeltalabEffectronJr", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.001, "max": 1.024, "s": 0.001, "def": 1.024 }, { "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "s": 0.01, "def": 0.3 }]] }, "Digital: Digitech PDS 1002": { "isCustom": "DigitechPDS1002", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.001, "max": 2, "s": 0.001, "def": 2.0 }, { "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]] }, "Digital: Digitech PDS 20/20": { "isCustom": "DigitechPDS2020", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.001, "max": 2, "s": 0.001, "def": 2.0 }, { "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]] }, "Digital: Ibanez DE-7": { "isCustom": "IbanezDE7", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.03, "max": 2.6, "s": 0.001, "def": 2.6 }, { "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "s": 0.01, "def": 0.4 }], [{ "l": "Tone", "p": "tone", "min": 1000, "max": 5000, "s": 10, "def": 2500 }]] }, "Digital: Korg SDD-3000": { "isCustom": "KorgSDD3000", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }], [{ "l": "Drive", "p": "drive", "min": 0, "max": 0.2, "s": 0.01, "def": 0 }]] }, "Digital: Lexicon PCM-42": { "isCustom": "LexiconPCM42", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.001, "max": 2, "s": 0.001, "def": 2.0 }, { "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }], [{ "l": "Mod Rate", "p": "modRate", "min": 0.1, "max": 5, "s": 0.1, "def": 1 }, { "l": "Mod Depth", "p": "modDepth", "min": 0, "max": 0.02, "s": 0.001, "def": 0 }]] }, "Digital: Line 6 DL4": { "isCustom": "Line6DL4", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.001, "max": 2, "s": 0.001, "def": 2.0 }, { "l": "Repeats", "p": "repeats", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]] }, "Digital: TC 2290": { "isCustom": "TC2290Delay", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Delay", "p": "delay", "min": 0.001, "max": 2, "s": 0.001, "def": 2.0 }, { "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "s": 0.01, "def": 0.6 }], [{ "l": "High Cut", "p": "highCut", "min": 1000, "max": 20000, "s": 100, "def": 20000 }, { "l": "Ducking", "p": "ducking", "min": -60, "max": 0, "s": 1, "def": -60 }], [{ "l": "Mod Speed", "p": "modSpeed", "min": 0.1, "max": 5, "s": 0.1, "def": 0.2 }, { "l": "Mod Depth", "p": "modDepth", "min": 0, "max": 0.01, "s": 0.001, "def": 0 }]] }, "Reverse: Danelectro Back Talk": { "isCustom": "BackTalkReverseDelay", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.1, "max": 1, "s": 0.01, "def": 1.0 }, { "l": "Repeats", "p": "repeats", "min": 0, "max": 1, "s": 0.01, "def": 0 }]] }, "Tape: Catalinbread Echorec": { "isCustom": "CatalinbreadEchorec", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Swell", "p": "swell", "min": 0, "max": 1, "s": 0.01, "def": 0.6 }, { "l": "Program", "p": "program", "min": 0, "max": 11.9, "s": 1, "def": 0 }], [{ "l": "Time", "p": "time", "min": 0.04, "max": 1.0, "s": 0.01, "def": 1.0 }, { "l": "Tone", "p": "tone", "min": 500, "max": 5000, "s": 10, "def": 5000 }]] }, "Tape: Echoplex EP-2": { "isCustom": "EchoplexEP2", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.06, "max": 0.75, "s": 0.001, "def": 0.75 }, { "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }], [{ "l": "Drive", "p": "drive", "min": 0, "max": 1, "s": 0.01, "def": 0 }], [{ "l": "Wow/Flutter", "p": "wowFlutterDepth", "min": 0, "max": 0.01, "s": 0.001, "def": 0.002 }, { "l": "Noise", "p": "noiseAmount", "min": 0, "max": 0.2, "s": 0.01, "def": 0.08 }]] }, "Tape: Echoplex EP-3": { "isCustom": "EchoplexEP3", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.06, "max": 0.75, "s": 0.001, "def": 0.75 }, { "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }], [{ "l": "Drive", "p": "drive", "min": 0, "max": 0.5, "s": 0.01, "def": 0 }, { "l": "Tone", "p": "filterFreq", "min": 1000, "max": 5000, "s": 10, "def": 4000 }], [{ "l": "Wow/Flutter", "p": "wowFlutterDepth", "min": 0, "max": 0.01, "s": 0.001, "def": 0.0015 }, { "l": "Noise", "p": "noiseAmount", "min": 0, "max": 0.2, "s": 0.01, "def": 0.05 }]] }, "Tape: Keeley Magnetic Echo": { "isCustom": "KeeleyMagneticEcho", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.04, "max": 1, "s": 0.01, "def": 1.0 }, { "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }], [{ "l": "Tone", "p": "tone", "min": 1000, "max": 5000, "s": 10, "def": 5000 }, { "l": "Depth", "p": "depth", "min": 0, "max": 1, "s": 0.01, "def": 0 }]] }, "Tape: Roland Space Echo": { "isCustom": "RolandSpaceEcho", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Mode", "p": "mode", "min": 1, "max": 12, "s": 1, "def": 1 }, { "l": "Repeat Rate", "p": "repeatRate", "min": 0.05, "max": 1, "s": 0.01, "def": 0.5 }], [{ "l": "Intensity", "p": "intensity", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }, { "l": "Echo Vol", "p": "echoVolume", "min": 0, "max": 1, "s": 0.01, "def": 0.8 }], [{ "l": "Reverb Vol", "p": "reverbVolume", "min": 0, "max": 1, "s": 0.01, "def": 0 }, { "l": "Drive", "p": "drive", "min": 0, "max": 1, "s": 0.01, "def": 0.1 }], [{ "l": "Bass", "p": "bass", "min": -10, "max": 10, "s": 0.1, "def": 0 }, { "l": "Treble", "p": "treble", "min": -10, "max": 10, "s": 0.1, "def": 0 }]] }, "Tape: Tel-Ray Oil Can": { "isCustom": "TelRayMorleyOilCanDelay", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.02, "max": 0.4, "s": 0.001, "def": 0.4 }, { "l": "Repeats", "p": "repeats", "min": 0, "max": 1, "s": 0.01, "def": 0.4 }], [{ "l": "Intensity", "p": "intensity", "min": 0, "max": 1, "s": 0.01, "def": 0 }, { "l": "Tone", "p": "tone", "min": 1000, "max": 4000, "s": 10, "def": 4000 }]] }, "Tape: Watkins Copicat": { "isCustom": "WatkinsCopicat", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.05, "max": 0.5, "s": 0.01, "def": 0.5 }, { "l": "Swell", "p": "swell", "min": 0, "max": 1, "s": 0.01, "def": 0.6 }], [{ "l": "Head 1", "p": "head1", "min": 0, "max": 1, "s": 1, "def": 1 }, { "l": "Head 2", "p": "head2", "min": 0, "max": 1, "s": 1, "def": 0 }, { "l": "Head 3", "p": "head3", "min": 0, "max": 1, "s": 1, "def": 0 }], [{ "l": "Wow/Flutter", "p": "wowFlutterDepth", "min": 0, "max": 0.01, "s": 0.001, "def": 0.001 }, { "l": "Drive", "p": "driveAmount", "min": 0, "max": 0.5, "s": 0.01, "def": 0 }], [{ "l": "Noise", "p": "noiseAmount", "min": 0, "max": 0.1, "s": 0.01, "def": 0.01 }, { "l": "Filter", "p": "filterFreq", "min": 1000, "max": 5000, "s": 10, "def": 3000 }]] }, "Tape Echo": { "isCustom": "TapeEcho", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Time", "p": "time", "min": 0.02, "max": 0.8, "s": 0.01, "def": 0.8 }, { "l": "Feedback", "p": "feedback", "min": 0, "max": 1, "s": 0.01, "def": 0.4 }], [{ "l": "Drive", "p": "drive", "min": 0, "max": 0.5, "s": 0.01, "def": 0 }, { "l": "Age", "p": "age", "min": 0, "max": 1, "s": 0.01, "def": 0 }], [{ "l": "Wow/Flutter", "p": "wowFlutter", "min": 0, "max": 0.02, "s": 0.001, "def": 0 }, { "l": "Noise", "p": "noiseAmount", "min": 0, "max": 0.1, "s": 0.01, "def": 0.01 }]] } } };
    window.effectModules.delay = { classes, configs };
})();
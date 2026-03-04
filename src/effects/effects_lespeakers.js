/*
 * Filename: effects_lespeakers.js
 * Version: 1.0
 * Date: January 16, 2026
 * Description: Authentic rotating speaker emulations for Tone.js 15.3.5
 * 
 * Implements accurate emulations of:
 * 1. Leslie 122/147 - Industry standard with rotating horn + bass drum
 * 2. Fender Vibratone - Single 10" speaker with styrofoam drum
 * 3. Wurlitzer Spectratone - Rotating speakers (not horns) from 1950s
 * 4. Yamaha RA-200 - Vertical rotating speakers (David Gilmour)
 * 5. Maestro Rover RO-1 - UFO-shaped portable unit (0-20 RPS variable)
 * 6. Allen Gyrophonic Projector - Vertical rotating baffle design
 * 7. Mesa Boogie Revolver - Entire 12" speaker rotates
 * 8. Motion Sound Pro-3 - Real rotating horn + digital bass simulation
 */

if (typeof window.recordModuleSource === 'function') {
    window.recordModuleSource('effects_lespeakers.js');
}
if (typeof window.saveModuleSource === 'function') {
    window.saveModuleSource('effects_lespeakers.js');
}

(() => {
    const { EffectBase } = window;

    // Helper: Convert RPM to Hz
    const rpmToHz = (rpm) => rpm / 60;

    // Helper: Clamp value
    const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

    // ==========================================================================
    // LESLIE 122/147 - The Industry Standard
    // ==========================================================================
    // Specs:
    // - Crossover: 800 Hz (16-ohm passive)
    // - Treble Horn: 40W tube amp, compression driver into rotating twin-bell horn
    // - Bass Rotor: 15" woofer into rotating drum
    // - Chorale (slow): Horn ~48-50 RPM (0.8 Hz), Bass ~38-40 RPM (0.65 Hz)
    // - Tremolo (fast): Horn ~400 RPM (6.7 Hz), Bass ~340 RPM (5.7 Hz)
    // - Different acceleration/deceleration times (horn faster than bass)
    // ==========================================================================
    class Leslie122 extends EffectBase {
        constructor() {
            super("Leslie122");
            this.wet.disconnect(this.nodes.stereoWidener);

            // Crossover at 800 Hz
            this.lowpass = new Tone.Filter({ frequency: 800, type: "lowpass", rolloff: -12 });
            this.highpass = new Tone.Filter({ frequency: 800, type: "highpass", rolloff: -12 });

            // Bass rotor - slower acceleration, deeper modulation
            this.bassLFO = new Tone.LFO({ frequency: 0.65, min: -3, max: 3, type: "sine" });
            this.bassVibrato = new Tone.Vibrato({ frequency: 0.65, depth: 0.15, type: "sine" });
            this.bassTremolo = new Tone.Tremolo({ frequency: 0.65, depth: 0.3, type: "sine", spread: 180 }).start();

            // Treble horn - faster response, more pronounced Doppler
            this.trebleLFO = new Tone.LFO({ frequency: 0.8, min: -6, max: 6, type: "sine" });
            this.trebleVibrato = new Tone.Vibrato({ frequency: 0.8, depth: 0.25, type: "sine" });
            this.trebleTremolo = new Tone.Tremolo({ frequency: 0.8, depth: 0.5, type: "sine", spread: 180 }).start();

            // Tube amp saturation (40W tube characteristic)
            this.tubeSat = new Tone.Distortion({ distortion: 0.08, oversample: "2x" });

            // Cabinet simulation
            this.cabinetLP = new Tone.Filter({ frequency: 5000, type: "lowpass", rolloff: -12 });
            this.cabinetHP = new Tone.Filter({ frequency: 80, type: "highpass", rolloff: -12 });

            // Stereo width from dual rotors
            this.stereoWidener = new Tone.StereoWidener({ width: 0.8 });

            // Mix
            this.bassMerge = new Tone.Gain(0.6);
            this.trebleMerge = new Tone.Gain(0.6);
            this.outputMix = new Tone.Gain(1.0);

            // Signal routing
            // Bass path
            this.wet.connect(this.lowpass);
            this.lowpass.chain(this.bassVibrato, this.bassTremolo, this.bassMerge);

            // Treble path
            this.wet.connect(this.highpass);
            this.highpass.chain(this.trebleVibrato, this.trebleTremolo, this.tubeSat, this.trebleMerge);

            // Combine
            this.bassMerge.connect(this.outputMix);
            this.trebleMerge.connect(this.outputMix);
            this.outputMix.chain(this.cabinetHP, this.cabinetLP, this.stereoWidener, this.nodes.stereoWidener);

            // Start LFOs
            this.bassLFO.start();
            this.trebleLFO.start();

            // Speed state
            this._speed = "slow"; // slow, fast, stop
            this._hornHz = 0.8;
            this._bassHz = 0.65;

            this._disposables.push(
                this.lowpass, this.highpass, this.bassLFO, this.bassVibrato, this.bassTremolo,
                this.trebleLFO, this.trebleVibrato, this.trebleTremolo, this.tubeSat,
                this.cabinetLP, this.cabinetHP, this.stereoWidener, this.bassMerge,
                this.trebleMerge, this.outputMix
            );
        }

        set(params) {
            // Speed: 0=stop, 0.5=slow(chorale), 1=fast(tremolo)
            if (params.speed !== undefined) {
                const speed = clamp(params.speed, 0, 1);
                if (speed < 0.25) {
                    // Stop
                    this._hornHz = 0.01;
                    this._bassHz = 0.01;
                } else if (speed < 0.75) {
                    // Slow/Chorale
                    this._hornHz = 0.8;  // ~48 RPM
                    this._bassHz = 0.65; // ~39 RPM
                } else {
                    // Fast/Tremolo
                    this._hornHz = 6.7;  // ~402 RPM
                    this._bassHz = 5.7;  // ~342 RPM
                }

                // Ramp to target (horn accelerates faster)
                const now = Tone.now();
                this.trebleVibrato.frequency.rampTo(this._hornHz, 0.8, now);
                this.trebleTremolo.frequency.rampTo(this._hornHz, 0.8, now);
                this.bassVibrato.frequency.rampTo(this._bassHz, 1.5, now);
                this.bassTremolo.frequency.rampTo(this._bassHz, 1.5, now);
            }

            // Drive (tube saturation)
            if (params.drive !== undefined) {
                this.tubeSat.distortion = clamp(params.drive, 0, 0.5);
            }

            // Width
            if (params.width !== undefined) {
                this.stereoWidener.width.value = clamp(params.width, 0, 1);
            }

            // Horn depth
            if (params.hornDepth !== undefined) {
                this.trebleVibrato.depth.value = clamp(params.hornDepth, 0, 0.5);
                this.trebleTremolo.depth.value = clamp(params.hornDepth, 0, 0.8);
            }

            // Bass depth
            if (params.bassDepth !== undefined) {
                this.bassVibrato.depth.value = clamp(params.bassDepth, 0, 0.3);
                this.bassTremolo.depth.value = clamp(params.bassDepth, 0, 0.5);
            }

            super.set(params);
        }
    }

    // ==========================================================================
    // FENDER VIBRATONE - Single 10" with Styrofoam Drum
    // ==========================================================================
    // Specs:
    // - Single 10" Jensen speaker (100W, 4-ohm)
    // - 15" rotating styrofoam plate/baffle
    // - Chorale: ~40 RPM (0.67 Hz)
    // - Tremolo: ~340 RPM (5.67 Hz)
    // - No crossover - full range through single rotating element
    // - More focused, guitar-oriented sound
    // ==========================================================================
    class FenderVibratone extends EffectBase {
        constructor() {
            super("FenderVibratone");
            this.wet.disconnect(this.nodes.stereoWidener);

            // Single channel - no crossover
            this.vibrato = new Tone.Vibrato({ frequency: 0.67, depth: 0.2, type: "sine" });
            this.tremolo = new Tone.Tremolo({ frequency: 0.67, depth: 0.6, type: "sine", spread: 120 }).start();

            // 10" speaker character - slightly brighter than Leslie
            this.speakerLP = new Tone.Filter({ frequency: 6000, type: "lowpass", rolloff: -12 });
            this.speakerHP = new Tone.Filter({ frequency: 100, type: "highpass", rolloff: -12 });

            // Slight mid-range emphasis (10" speaker cone)
            this.midPeak = new Tone.Filter({ frequency: 1200, type: "peaking", Q: 1.5, gain: 3 });

            this.outputGain = new Tone.Gain(1.0);
            this.stereoWidener = new Tone.StereoWidener({ width: 0.6 });

            this.wet.chain(
                this.vibrato, this.tremolo, this.midPeak,
                this.speakerHP, this.speakerLP, this.outputGain,
                this.stereoWidener, this.nodes.stereoWidener
            );

            this._disposables.push(
                this.vibrato, this.tremolo, this.speakerLP, this.speakerHP,
                this.midPeak, this.outputGain, this.stereoWidener
            );
        }

        set(params) {
            if (params.speed !== undefined) {
                const speed = clamp(params.speed, 0, 1);
                let freq;
                if (speed < 0.25) {
                    freq = 0.05; // Near stop
                } else if (speed < 0.75) {
                    freq = 0.67; // Chorale ~40 RPM
                } else {
                    freq = 5.67; // Tremolo ~340 RPM
                }
                this.vibrato.frequency.rampTo(freq, 0.6);
                this.tremolo.frequency.rampTo(freq, 0.6);
            }

            if (params.depth !== undefined) {
                const d = clamp(params.depth, 0, 1);
                this.vibrato.depth.value = d * 0.3;
                this.tremolo.depth.value = d * 0.8;
            }

            if (params.width !== undefined) {
                this.stereoWidener.width.value = clamp(params.width, 0, 1);
            }

            super.set(params);
        }
    }

    // ==========================================================================
    // WURLITZER SPECTRATONE - 1950s Rotating Speakers
    // ==========================================================================
    // Specs:
    // - Two 4" rotating speakers (some models had 6")
    // - Speakers themselves rotate (not horns/baffles) - unique Doppler
    // - Lower power, suited for organ/studio use
    // - Two speeds (slow/fast) - gentler than Leslie
    // - Preloaded cones for centrifugal force resistance
    // ==========================================================================
    class WurlitzerSpectratone extends EffectBase {
        constructor() {
            super("WurlitzerSpectratone");
            this.wet.disconnect(this.nodes.stereoWidener);

            // Dual small speakers - more phase modulation, less amplitude
            this.vibratoL = new Tone.Vibrato({ frequency: 0.8, depth: 0.35, type: "sine" });
            this.vibratoR = new Tone.Vibrato({ frequency: 0.82, depth: 0.35, type: "sine" }); // Slight offset

            // Lighter tremolo (speakers moving, not baffles)
            this.tremolo = new Tone.Tremolo({ frequency: 0.8, depth: 0.25, type: "sine", spread: 180 }).start();

            // Small speaker character (4-6")
            this.speakerLP = new Tone.Filter({ frequency: 4500, type: "lowpass", rolloff: -12 });
            this.speakerHP = new Tone.Filter({ frequency: 150, type: "highpass", rolloff: -12 });

            // Vintage transformer coloration
            this.saturation = new Tone.Distortion({ distortion: 0.03, oversample: "2x" });

            this.stereoSplit = new Tone.Split();
            this.stereoMerge = new Tone.Merge();
            this.outputGain = new Tone.Gain(1.0);

            // Stereo processing for dual speakers
            this.wet.connect(this.stereoSplit);
            this.stereoSplit.left.connect(this.vibratoL);
            this.stereoSplit.right.connect(this.vibratoR);
            this.vibratoL.connect(this.stereoMerge.left);
            this.vibratoR.connect(this.stereoMerge.right);
            this.stereoMerge.chain(this.tremolo, this.saturation, this.speakerHP, this.speakerLP, this.outputGain, this.nodes.stereoWidener);

            this._disposables.push(
                this.vibratoL, this.vibratoR, this.tremolo, this.speakerLP, this.speakerHP,
                this.saturation, this.stereoSplit, this.stereoMerge, this.outputGain
            );
        }

        set(params) {
            if (params.speed !== undefined) {
                const speed = clamp(params.speed, 0, 1);
                const freq = speed < 0.5 ? 0.8 : 5.0; // Gentler speeds
                this.vibratoL.frequency.rampTo(freq, 0.7);
                this.vibratoR.frequency.rampTo(freq * 1.02, 0.7); // Slight detuning
                this.tremolo.frequency.rampTo(freq, 0.7);
            }

            if (params.depth !== undefined) {
                const d = clamp(params.depth, 0, 1);
                this.vibratoL.depth.value = d * 0.5;
                this.vibratoR.depth.value = d * 0.5;
                this.tremolo.depth.value = d * 0.35;
            }

            super.set(params);
        }
    }

    // ==========================================================================
    // YAMAHA RA-200 - Vertical Rotating Speakers (David Gilmour)
    // ==========================================================================
    // Specs:
    // - Three rotating horn speakers (vertical axis)
    // - Four stationary 12" speakers for bass
    // - 200W solid-state amplifier
    // - Variable slow speed, fixed fast speed
    // - All horns (no bass rotor) - different character than Leslie
    // - Built-in reverb
    // ==========================================================================
    class YamahaRA200 extends EffectBase {
        constructor() {
            super("YamahaRA200");
            this.wet.disconnect(this.nodes.stereoWidener);

            // Crossover - treble to rotating horns, bass to stationary speakers
            this.lowpass = new Tone.Filter({ frequency: 600, type: "lowpass", rolloff: -12 });
            this.highpass = new Tone.Filter({ frequency: 600, type: "highpass", rolloff: -12 });

            // Three rotating horns with slight phase differences
            this.hornVibrato1 = new Tone.Vibrato({ frequency: 1.2, depth: 0.25, type: "sine" });
            this.hornVibrato2 = new Tone.Vibrato({ frequency: 1.2, depth: 0.25, type: "sine" });
            this.hornVibrato3 = new Tone.Vibrato({ frequency: 1.2, depth: 0.25, type: "sine" });

            this.hornTremolo = new Tone.Tremolo({ frequency: 1.2, depth: 0.55, type: "sine", spread: 180 }).start();

            // Stationary bass (no modulation, just EQ)
            this.bassEQ = new Tone.EQ3({ low: 2, mid: 0, high: -2, lowFrequency: 200, highFrequency: 2000 });

            // Built-in reverb
            this.reverb = new Tone.Reverb({ decay: 1.5, wet: 0.15, preDelay: 0.01 });

            // Solid-state clean character
            this.solidStateLP = new Tone.Filter({ frequency: 8000, type: "lowpass", rolloff: -12 });

            this.bassPath = new Tone.Gain(0.5);
            this.treblePath = new Tone.Gain(0.6);
            this.outputMix = new Tone.Gain(1.0);

            // Signal routing
            this.wet.connect(this.lowpass);
            this.wet.connect(this.highpass);

            // Bass path (stationary speakers)
            this.lowpass.chain(this.bassEQ, this.bassPath);

            // Treble path (rotating horns)
            this.highpass.chain(this.hornVibrato1, this.hornVibrato2, this.hornTremolo, this.treblePath);

            this.bassPath.connect(this.outputMix);
            this.treblePath.connect(this.outputMix);
            this.outputMix.chain(this.reverb, this.solidStateLP, this.nodes.stereoWidener);

            this._disposables.push(
                this.lowpass, this.highpass, this.hornVibrato1, this.hornVibrato2, this.hornVibrato3,
                this.hornTremolo, this.bassEQ, this.reverb, this.solidStateLP,
                this.bassPath, this.treblePath, this.outputMix
            );
        }

        set(params) {
            // Variable slow speed (Gilmour's preferred setting)
            if (params.speed !== undefined) {
                const speed = clamp(params.speed, 0, 1);
                let freq;
                if (speed < 0.1) {
                    freq = 0.1; // Near stop
                } else if (speed < 0.7) {
                    // Variable slow - maps 0.1-0.7 to 0.3-2.0 Hz
                    freq = 0.3 + (speed - 0.1) * 2.8;
                } else {
                    freq = 6.0; // Fixed fast
                }
                this.hornVibrato1.frequency.rampTo(freq, 0.5);
                this.hornVibrato2.frequency.rampTo(freq * 1.01, 0.5);
                this.hornTremolo.frequency.rampTo(freq, 0.5);
            }

            if (params.depth !== undefined) {
                const d = clamp(params.depth, 0, 1);
                this.hornVibrato1.depth.value = d * 0.35;
                this.hornVibrato2.depth.value = d * 0.35;
                this.hornTremolo.depth.value = d * 0.7;
            }

            if (params.reverb !== undefined) {
                this.reverb.wet.value = clamp(params.reverb, 0, 0.5);
            }

            super.set(params);
        }
    }

    // ==========================================================================
    // MAESTRO ROVER RO-1 - UFO Portable Unit (1972)
    // ==========================================================================
    // Specs:
    // - Single 6" speaker, 35W solid-state amp
    // - Variable speed 0-20 RPS (0-1200 RPM!) - continuous control
    // - UFO/disc shape, portable (20 lbs)
    // - Foot pedal control for expression
    // - Bass frequencies can be split to external amp
    // ==========================================================================
    class MaestroRover extends EffectBase {
        constructor() {
            super("MaestroRover");
            this.wet.disconnect(this.nodes.stereoWidener);

            // Extreme speed range (0-20 RPS = 0-20 Hz!)
            this.vibrato = new Tone.Vibrato({ frequency: 3, depth: 0.3, type: "sine" });
            this.tremolo = new Tone.Tremolo({ frequency: 3, depth: 0.6, type: "sine", spread: 160 }).start();

            // 6" speaker character
            this.speakerLP = new Tone.Filter({ frequency: 5000, type: "lowpass", rolloff: -12 });
            this.speakerHP = new Tone.Filter({ frequency: 120, type: "highpass", rolloff: -12 });

            // Mid-range focused (small speaker)
            this.midFocus = new Tone.Filter({ frequency: 1500, type: "peaking", Q: 1, gain: 4 });

            // Bass split output simulation
            this.bassSplit = new Tone.Filter({ frequency: 300, type: "lowpass", rolloff: -12 });
            this.bassGain = new Tone.Gain(0.3);

            this.outputGain = new Tone.Gain(1.0);

            this.wet.chain(
                this.vibrato, this.tremolo, this.midFocus,
                this.speakerHP, this.speakerLP, this.outputGain, this.nodes.stereoWidener
            );

            // Bass blend (simulates external amp hookup)
            this.wet.chain(this.bassSplit, this.bassGain, this.outputGain);

            this._currentRPS = 3;

            this._disposables.push(
                this.vibrato, this.tremolo, this.speakerLP, this.speakerHP,
                this.midFocus, this.bassSplit, this.bassGain, this.outputGain
            );
        }

        set(params) {
            // Continuous speed 0-20 RPS (mapped from 0-1)
            if (params.speed !== undefined) {
                const rps = clamp(params.speed, 0, 1) * 20;
                this._currentRPS = rps;
                this.vibrato.frequency.rampTo(rps, 0.3);
                this.tremolo.frequency.rampTo(rps, 0.3);
            }

            // Preset low/high speeds (like the original pedal)
            if (params.preset !== undefined) {
                const preset = params.preset;
                if (preset === "low") {
                    this.vibrato.frequency.rampTo(2, 0.3);
                    this.tremolo.frequency.rampTo(2, 0.3);
                } else if (preset === "high") {
                    this.vibrato.frequency.rampTo(12, 0.3);
                    this.tremolo.frequency.rampTo(12, 0.3);
                }
            }

            if (params.depth !== undefined) {
                const d = clamp(params.depth, 0, 1);
                this.vibrato.depth.value = d * 0.4;
                this.tremolo.depth.value = d * 0.8;
            }

            // Bass blend (how much bass goes to the rover vs external)
            if (params.bassBlend !== undefined) {
                this.bassGain.gain.value = clamp(params.bassBlend, 0, 0.5);
            }

            super.set(params);
        }
    }

    // ==========================================================================
    // ALLEN GYROPHONIC PROJECTOR - Vertical Rotating Baffle
    // ==========================================================================
    // Specs:
    // - Two 8" speakers + tweeters on vertical rotating baffle
    // - "Lazy Susan" design - spins vertically
    // - Three speeds: Gyrophonic (slowest), Chorus, Tremolo (fastest)
    // - Tube amplifier versions and solid-state versions
    // - Wood panel behind grille for asymmetric projection
    // ==========================================================================
    class AllenGyrophonic extends EffectBase {
        constructor() {
            super("AllenGyrophonic");
            this.wet.disconnect(this.nodes.stereoWidener);

            // Dual speaker paths (8" + tweeter)
            this.lowpass = new Tone.Filter({ frequency: 3000, type: "lowpass", rolloff: -12 });
            this.highpass = new Tone.Filter({ frequency: 3000, type: "highpass", rolloff: -12 });

            // Main speakers vibrato
            this.mainVibrato = new Tone.Vibrato({ frequency: 0.5, depth: 0.2, type: "sine" });
            this.mainTremolo = new Tone.Tremolo({ frequency: 0.5, depth: 0.4, type: "sine", spread: 140 }).start();

            // Tweeters - same rotation but different character
            this.tweeterVibrato = new Tone.Vibrato({ frequency: 0.5, depth: 0.25, type: "sine" });
            this.tweeterTremolo = new Tone.Tremolo({ frequency: 0.5, depth: 0.5, type: "sine", spread: 160 }).start();

            // Tube amp for some models
            this.tubeSat = new Tone.Distortion({ distortion: 0.04, oversample: "2x" });

            // Asymmetric baffle effect (wood panel)
            this.asymFilter = new Tone.Filter({ frequency: 2000, type: "peaking", Q: 0.7, gain: 2 });

            this.mainPath = new Tone.Gain(0.6);
            this.tweeterPath = new Tone.Gain(0.4);
            this.outputMix = new Tone.Gain(1.0);

            // Signal routing
            this.wet.connect(this.lowpass);
            this.wet.connect(this.highpass);

            this.lowpass.chain(this.mainVibrato, this.mainTremolo, this.mainPath);
            this.highpass.chain(this.tweeterVibrato, this.tweeterTremolo, this.tweeterPath);

            this.mainPath.connect(this.outputMix);
            this.tweeterPath.connect(this.outputMix);
            this.outputMix.chain(this.tubeSat, this.asymFilter, this.nodes.stereoWidener);

            this._disposables.push(
                this.lowpass, this.highpass, this.mainVibrato, this.mainTremolo,
                this.tweeterVibrato, this.tweeterTremolo, this.tubeSat, this.asymFilter,
                this.mainPath, this.tweeterPath, this.outputMix
            );
        }

        set(params) {
            // Three-speed mode
            if (params.speed !== undefined) {
                const speed = clamp(params.speed, 0, 1);
                let freq;
                if (speed < 0.33) {
                    freq = 0.3; // Gyrophonic (slowest)
                } else if (speed < 0.66) {
                    freq = 1.5; // Chorus
                } else {
                    freq = 5.5; // Tremolo (fastest)
                }
                this.mainVibrato.frequency.rampTo(freq, 0.8);
                this.mainTremolo.frequency.rampTo(freq, 0.8);
                this.tweeterVibrato.frequency.rampTo(freq, 0.8);
                this.tweeterTremolo.frequency.rampTo(freq, 0.8);
            }

            if (params.depth !== undefined) {
                const d = clamp(params.depth, 0, 1);
                this.mainVibrato.depth.value = d * 0.3;
                this.mainTremolo.depth.value = d * 0.5;
                this.tweeterVibrato.depth.value = d * 0.35;
                this.tweeterTremolo.depth.value = d * 0.6;
            }

            if (params.drive !== undefined) {
                this.tubeSat.distortion = clamp(params.drive, 0, 0.2);
            }

            super.set(params);
        }
    }

    // ==========================================================================
    // MESA BOOGIE REVOLVER - Entire 12" Speaker Rotates
    // ==========================================================================
    // Specs:
    // - Single 12" speaker rotates (not baffle/horn)
    // - 90W, 8-ohm, unpowered cabinet
    // - Full-range rotation - very different from Leslie
    // - Natural chorus and vibrato from physical speaker movement
    // - Heavy (95 lbs) - substantial mass affects modulation
    // ==========================================================================
    class MesaRevolver extends EffectBase {
        constructor() {
            super("MesaRevolver");
            this.wet.disconnect(this.nodes.stereoWidener);

            // Full-range modulation (no crossover - entire speaker rotates)
            this.vibrato = new Tone.Vibrato({ frequency: 1.0, depth: 0.3, type: "sine" });
            this.tremolo = new Tone.Tremolo({ frequency: 1.0, depth: 0.55, type: "sine", spread: 180 }).start();

            // Heavy mass = slower acceleration
            // 12" speaker character
            this.speakerLP = new Tone.Filter({ frequency: 5500, type: "lowpass", rolloff: -12 });
            this.speakerHP = new Tone.Filter({ frequency: 70, type: "highpass", rolloff: -12 });

            // Full, rich 12" tone
            this.bassBoost = new Tone.Filter({ frequency: 150, type: "peaking", Q: 0.8, gain: 3 });

            // Stereo spread from rotation
            this.stereoWidener = new Tone.StereoWidener({ width: 0.7 });

            this.outputGain = new Tone.Gain(1.0);

            this.wet.chain(
                this.vibrato, this.tremolo, this.bassBoost,
                this.speakerHP, this.speakerLP, this.outputGain,
                this.stereoWidener, this.nodes.stereoWidener
            );

            this._disposables.push(
                this.vibrato, this.tremolo, this.speakerLP, this.speakerHP,
                this.bassBoost, this.stereoWidener, this.outputGain
            );
        }

        set(params) {
            if (params.speed !== undefined) {
                const speed = clamp(params.speed, 0, 1);
                // Slower acceleration due to mass
                const freq = speed < 0.5 ? 0.8 : 5.0;
                this.vibrato.frequency.rampTo(freq, 1.2); // Slow ramp
                this.tremolo.frequency.rampTo(freq, 1.2);
            }

            if (params.depth !== undefined) {
                const d = clamp(params.depth, 0, 1);
                this.vibrato.depth.value = d * 0.4;
                this.tremolo.depth.value = d * 0.7;
            }

            if (params.width !== undefined) {
                this.stereoWidener.width.value = clamp(params.width, 0, 1);
            }

            super.set(params);
        }
    }

    // ==========================================================================
    // MOTION SOUND PRO-3 - Real Horn + Digital Bass Simulation
    // ==========================================================================
    // Specs:
    // - Real rotating treble horn with compression driver (45W)
    // - Crossover at 700-800 Hz
    // - Digital/electronic bass rotor simulation
    // - Class A/AB/B variable FET preamp with overdrive
    // - Built-in mic on horn for PA use
    // - Adjustable acceleration/deceleration times
    // ==========================================================================
    class MotionSoundPro3 extends EffectBase {
        constructor() {
            super("MotionSoundPro3");
            this.wet.disconnect(this.nodes.stereoWidener);

            // Crossover at 800 Hz (Pro-3X spec)
            this.lowpass = new Tone.Filter({ frequency: 800, type: "lowpass", rolloff: -18 });
            this.highpass = new Tone.Filter({ frequency: 800, type: "highpass", rolloff: -18 });

            // Real rotating horn (treble)
            this.hornVibrato = new Tone.Vibrato({ frequency: 0.8, depth: 0.28, type: "sine" });
            this.hornTremolo = new Tone.Tremolo({ frequency: 0.8, depth: 0.6, type: "sine", spread: 180 }).start();

            // Electronic bass rotor simulation
            this.bassChorus = new Tone.Chorus({ frequency: 0.65, delayTime: 3.5, depth: 0.4, wet: 0.7, spread: 180 }).start();
            this.bassTremolo = new Tone.Tremolo({ frequency: 0.65, depth: 0.35, type: "sine", spread: 180 }).start();

            // FET preamp with adjustable overdrive
            this.preamp = new Tone.Distortion({ distortion: 0.05, oversample: "2x" });

            // EQ controls
            this.trebleEQ = new Tone.Filter({ frequency: 4000, type: "peaking", Q: 0.7, gain: 0 });
            this.midEQ = new Tone.Filter({ frequency: 1000, type: "peaking", Q: 0.7, gain: 0 });

            this.bassPath = new Tone.Gain(0.5);
            this.hornPath = new Tone.Gain(0.6);
            this.outputMix = new Tone.Gain(1.0);

            // Signal routing
            this.wet.connect(this.preamp);
            this.preamp.connect(this.lowpass);
            this.preamp.connect(this.highpass);

            // Bass path (electronic simulation)
            this.lowpass.chain(this.bassChorus, this.bassTremolo, this.bassPath);

            // Treble path (real horn)
            this.highpass.chain(this.hornVibrato, this.hornTremolo, this.trebleEQ, this.midEQ, this.hornPath);

            this.bassPath.connect(this.outputMix);
            this.hornPath.connect(this.outputMix);
            this.outputMix.connect(this.nodes.stereoWidener);

            this._disposables.push(
                this.lowpass, this.highpass, this.hornVibrato, this.hornTremolo,
                this.bassChorus, this.bassTremolo, this.preamp, this.trebleEQ, this.midEQ,
                this.bassPath, this.hornPath, this.outputMix
            );
        }

        set(params) {
            if (params.speed !== undefined) {
                const speed = clamp(params.speed, 0, 1);
                let freq;
                if (speed < 0.2) {
                    freq = 0.05; // Stop
                } else if (speed < 0.6) {
                    freq = 0.8; // Slow
                } else {
                    freq = 6.5; // Fast
                }

                // Different ramp times for horn vs digital bass
                this.hornVibrato.frequency.rampTo(freq, 0.6);
                this.hornTremolo.frequency.rampTo(freq, 0.6);
                this.bassChorus.frequency.rampTo(freq * 0.8, 0.8);
                this.bassTremolo.frequency.rampTo(freq * 0.8, 0.8);
            }

            if (params.drive !== undefined) {
                this.preamp.distortion = clamp(params.drive, 0, 0.4);
            }

            if (params.hornDepth !== undefined) {
                const d = clamp(params.hornDepth, 0, 1);
                this.hornVibrato.depth.value = d * 0.4;
                this.hornTremolo.depth.value = d * 0.8;
            }

            if (params.bassDepth !== undefined) {
                const d = clamp(params.bassDepth, 0, 1);
                this.bassChorus.depth = d * 0.6;
                this.bassTremolo.depth.value = d * 0.5;
            }

            if (params.treble !== undefined) {
                this.trebleEQ.gain.value = clamp(params.treble, -12, 12);
            }

            if (params.mid !== undefined) {
                this.midEQ.gain.value = clamp(params.mid, -12, 12);
            }

            super.set(params);
        }
    }

    // ==========================================================================
    // REGISTER ALL EFFECTS
    // ==========================================================================
    window.rotarySpeakers = {
        Leslie122,
        FenderVibratone,
        WurlitzerSpectratone,
        YamahaRA200,
        MaestroRover,
        AllenGyrophonic,
        MesaRevolver,
        MotionSoundPro3
    };

    // Register with global effects registry
    if (window.effectsRegistry) {
        window.effectsRegistry.set('Rotary: Leslie 122', Leslie122);
        window.effectsRegistry.set('Rotary: Fender Vibratone', FenderVibratone);
        window.effectsRegistry.set('Rotary: Wurlitzer Spectratone', WurlitzerSpectratone);
        window.effectsRegistry.set('Rotary: Yamaha RA-200', YamahaRA200);
        window.effectsRegistry.set('Rotary: Maestro Rover', MaestroRover);
        window.effectsRegistry.set('Rotary: Allen Gyrophonic', AllenGyrophonic);
        window.effectsRegistry.set('Rotary: Mesa Revolver', MesaRevolver);
        window.effectsRegistry.set('Rotary: Motion Sound Pro-3', MotionSoundPro3);
    }

    // Register with effectModules for app integration
    if (!window.effectModules) window.effectModules = {};
    const classes = { Leslie122, FenderVibratone, WurlitzerSpectratone, YamahaRA200, MaestroRover, AllenGyrophonic, MesaRevolver, MotionSoundPro3 };
    const configs = {
        "Rotary Speakers": {
            "Rotary: Leslie 122": { "isCustom": "Leslie122", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Speed", "p": "speed", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }, { "l": "Drive", "p": "drive", "min": 0, "max": 0.5, "s": 0.01, "def": 0.08 }], [{ "l": "Horn", "p": "hornDepth", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }, { "l": "Bass", "p": "bassDepth", "min": 0, "max": 1, "s": 0.01, "def": 0.3 }], [{ "l": "Width", "p": "width", "min": 0, "max": 1, "s": 0.01, "def": 0.8 }]] },
            "Rotary: Fender Vibratone": { "isCustom": "FenderVibratone", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Speed", "p": "speed", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }, { "l": "Depth", "p": "depth", "min": 0, "max": 1, "s": 0.01, "def": 0.7 }], [{ "l": "Width", "p": "width", "min": 0, "max": 1, "s": 0.01, "def": 0.6 }]] },
            "Rotary: Wurlitzer Spectratone": { "isCustom": "WurlitzerSpectratone", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Speed", "p": "speed", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }, { "l": "Depth", "p": "depth", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]] },
            "Rotary: Yamaha RA-200": { "isCustom": "YamahaRA200", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Speed", "p": "speed", "min": 0, "max": 1, "s": 0.01, "def": 0.4 }, { "l": "Depth", "p": "depth", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }], [{ "l": "Reverb", "p": "reverb", "min": 0, "max": 0.5, "s": 0.01, "def": 0.15 }]] },
            "Rotary: Maestro Rover": { "isCustom": "MaestroRover", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Speed", "p": "speed", "min": 0, "max": 1, "s": 0.01, "def": 0.15 }, { "l": "Depth", "p": "depth", "min": 0, "max": 1, "s": 0.01, "def": 0.6 }], [{ "l": "Bass", "p": "bassBlend", "min": 0, "max": 0.5, "s": 0.01, "def": 0.3 }]] },
            "Rotary: Allen Gyrophonic": { "isCustom": "AllenGyrophonic", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Speed", "p": "speed", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }, { "l": "Depth", "p": "depth", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }], [{ "l": "Drive", "p": "drive", "min": 0, "max": 0.2, "s": 0.01, "def": 0.04 }]] },
            "Rotary: Mesa Revolver": { "isCustom": "MesaRevolver", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Speed", "p": "speed", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }, { "l": "Depth", "p": "depth", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }], [{ "l": "Width", "p": "width", "min": 0, "max": 1, "s": 0.01, "def": 0.7 }]] },
            "Rotary: Motion Sound Pro-3": { "isCustom": "MotionSoundPro3", "columns": [[{ "l": "Effect Level", "p": "mix", "min": 0, "max": 1, "s": 0.01, "def": 1 }, { "l": "Speed", "p": "speed", "min": 0, "max": 1, "s": 0.01, "def": 0.4 }, { "l": "Drive", "p": "drive", "min": 0, "max": 0.4, "s": 0.01, "def": 0.05 }], [{ "l": "Horn", "p": "hornDepth", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }, { "l": "Bass", "p": "bassDepth", "min": 0, "max": 1, "s": 0.01, "def": 0.4 }], [{ "l": "Treble", "p": "treble", "min": -12, "max": 12, "s": 0.5, "def": 0 }, { "l": "Mid", "p": "mid", "min": -12, "max": 12, "s": 0.5, "def": 0 }]] }
        }
    };
    window.effectModules.lespeakers = { classes, configs };

    console.log('✅ effects_lespeakers.js loaded - 8 authentic rotating speaker emulations');
})();

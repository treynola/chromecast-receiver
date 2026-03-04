/*
 * Filename: effects_microphone.js
 * Version: NOV25_AntiGravity Version 2.0
 * Date: January 15, 2026
 * Description: Comprehensive microphone emulations - 15 classic microphones
 * Categories: Condenser, Dynamic, Ribbon
 */
(function () {
    if (typeof window.effectModules === 'undefined') { window.effectModules = {}; }
    if (typeof window.AppSource === 'undefined') { window.AppSource = {}; }
    if (typeof window.saveModuleSource === 'function') { window.saveModuleSource('effects_microphone.js'); }

    // =========================================================================
    // I. CONDENSER MICROPHONES (5)
    // =========================================================================

    // Neumann U47 (1947) - The Legend
    class NeumannU47 extends EffectBase {
        constructor() {
            super("NeumannU47");
            this._params = { warmth: 0.3, presence: 0.5, proximity: 0.2, pattern: 0 };
            // M7 capsule: Near-flat 20Hz-20kHz, +4dB presence peak at 5kHz
            // +3dB low lift at 80-120Hz, gradual -3dB drop from 10kHz
            this.nodes.lowLift = new Tone.Filter({ type: 'lowshelf', frequency: 100, gain: 3 });
            this.nodes.presence = new Tone.Filter({ type: 'peaking', frequency: 5000, Q: 0.8, gain: 4 });
            this.nodes.hfRolloff = new Tone.Filter({ type: 'highshelf', frequency: 10000, gain: -3 });
            this.nodes.proximity = new Tone.Filter({ type: 'lowshelf', frequency: 200, gain: 0 });
            // VF14 tube saturation - rich even harmonics
            this.nodes.tube = new Tone.Chebyshev(2);
            this.nodes.tube.wet.value = 0.25;
            this.nodes.makeup = new Tone.Gain(1.2);
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.proximity, this.nodes.lowLift, this.nodes.presence, this.nodes.hfRolloff, this.nodes.tube, this.nodes.makeup, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.lowLift, this.nodes.presence, this.nodes.hfRolloff, this.nodes.proximity, this.nodes.tube, this.nodes.makeup);
        }
        set(params) {
            super.set(params); const now = Tone.now();
            if (params.warmth !== undefined) { this.nodes.tube.wet.setTargetAtTime(params.warmth * 0.5, now, 0.01); this.nodes.lowLift.gain.setTargetAtTime(params.warmth * 6, now, 0.01); }
            if (params.presence !== undefined) this.nodes.presence.gain.setTargetAtTime(params.presence * 8, now, 0.01);
            if (params.proximity !== undefined) this.nodes.proximity.gain.setTargetAtTime(params.proximity * 10, now, 0.01);
        }
    }

    // AKG C12 (1953) - The Air King
    class AKGC12 extends EffectBase {
        constructor() {
            super("AKGC12");
            this._params = { air: 0.5, presence: 0.4, warmth: 0.2, pattern: 0 };
            // CK12 capsule: 30Hz-20kHz, gentle lift at 10-12kHz for "air"
            this.nodes.airShelf = new Tone.Filter({ type: 'highshelf', frequency: 10000, gain: 4 });
            this.nodes.ultraAir = new Tone.Filter({ type: 'highshelf', frequency: 14000, gain: 2 });
            this.nodes.presenceRise = new Tone.Filter({ type: 'peaking', frequency: 8000, Q: 0.7, gain: 2 });
            this.nodes.lowCut = new Tone.Filter({ type: 'highpass', frequency: 30, rolloff: -12 });
            this.nodes.warmth = new Tone.Filter({ type: 'lowshelf', frequency: 150, gain: 1 });
            // 6072 tube - silky harmonics
            this.nodes.tube = new Tone.Chebyshev(2);
            this.nodes.tube.wet.value = 0.15;
            this.nodes.makeup = new Tone.Gain(1.1);
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.lowCut, this.nodes.warmth, this.nodes.presenceRise, this.nodes.airShelf, this.nodes.ultraAir, this.nodes.tube, this.nodes.makeup, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.airShelf, this.nodes.ultraAir, this.nodes.presenceRise, this.nodes.lowCut, this.nodes.warmth, this.nodes.tube, this.nodes.makeup);
        }
        set(params) {
            super.set(params); const now = Tone.now();
            if (params.air !== undefined) { this.nodes.airShelf.gain.setTargetAtTime(params.air * 8, now, 0.01); this.nodes.ultraAir.gain.setTargetAtTime(params.air * 4, now, 0.01); }
            if (params.presence !== undefined) this.nodes.presenceRise.gain.setTargetAtTime(params.presence * 6, now, 0.01);
            if (params.warmth !== undefined) { this.nodes.warmth.gain.setTargetAtTime(params.warmth * 6, now, 0.01); this.nodes.tube.wet.setTargetAtTime(params.warmth * 0.4, now, 0.01); }
        }
    }

    // Neumann U87 (1967) - The Studio Standard
    class NeumannU87 extends EffectBase {
        constructor() {
            super("NeumannU87");
            this._params = { air: 0.3, warmth: 0.1, lowCut: 0, pad: 0 };
            // K67 capsule: 20Hz-20kHz flat, slight dip at 2-3kHz, HF air
            this.nodes.lowCut = new Tone.Filter({ type: 'highpass', frequency: 40, rolloff: -12 });
            this.nodes.midDip = new Tone.Filter({ type: 'peaking', frequency: 2500, Q: 0.5, gain: -1 });
            this.nodes.hfLift = new Tone.Filter({ type: 'highshelf', frequency: 10000, gain: 2 });
            this.nodes.ultraHighAir = new Tone.Filter({ type: 'highshelf', frequency: 15000, gain: 1 });
            this.nodes.transformer = new Tone.Chebyshev(2);
            this.nodes.transformer.wet.value = 0.15;
            this.nodes.fetWarmth = new Tone.Filter({ type: 'lowshelf', frequency: 100, gain: 1 });
            this.nodes.makeup = new Tone.Gain(1.2);
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.lowCut, this.nodes.midDip, this.nodes.hfLift, this.nodes.ultraHighAir, this.nodes.fetWarmth, this.nodes.transformer, this.nodes.makeup, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.hfLift, this.nodes.lowCut, this.nodes.midDip, this.nodes.ultraHighAir, this.nodes.transformer, this.nodes.fetWarmth, this.nodes.makeup);
        }
        set(params) {
            super.set(params); const now = Tone.now();
            if (params.air !== undefined) { this.nodes.hfLift.gain.setTargetAtTime(params.air * 6, now, 0.01); this.nodes.ultraHighAir.gain.setTargetAtTime(params.air * 3, now, 0.01); }
            if (params.lowCut !== undefined) this.nodes.lowCut.frequency.setTargetAtTime(params.lowCut > 0.5 ? 100 : 40, now, 0.01);
            if (params.warmth !== undefined) { this.nodes.transformer.wet.setTargetAtTime(0.1 + (params.warmth * 0.3), now, 0.01); this.nodes.fetWarmth.gain.setTargetAtTime(params.warmth * 4, now, 0.01); }
        }
    }

    // AKG C414 (1971) - The Utility Workhorse
    class AKGC414 extends EffectBase {
        constructor() {
            super("AKGC414");
            this._params = { presence: 0.3, lowCut: 0, pad: 0, pattern: 0 };
            // 20Hz-20kHz extremely flat, 9 polar patterns, bass cut at 40/80/160Hz
            this.nodes.lowCut = new Tone.Filter({ type: 'highpass', frequency: 20, rolloff: -12 });
            this.nodes.presenceBoost = new Tone.Filter({ type: 'peaking', frequency: 3000, Q: 0.5, gain: 0 });
            this.nodes.airShelf = new Tone.Filter({ type: 'highshelf', frequency: 12000, gain: 1 });
            this.nodes.warmth = new Tone.Filter({ type: 'lowshelf', frequency: 100, gain: 0 });
            this.nodes.makeup = new Tone.Gain(1.0);
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.lowCut, this.nodes.warmth, this.nodes.presenceBoost, this.nodes.airShelf, this.nodes.makeup, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.lowCut, this.nodes.presenceBoost, this.nodes.airShelf, this.nodes.warmth, this.nodes.makeup);
        }
        set(params) {
            super.set(params); const now = Tone.now();
            if (params.presence !== undefined) this.nodes.presenceBoost.gain.setTargetAtTime(params.presence * 6, now, 0.01);
            if (params.lowCut !== undefined) { const freqs = [20, 40, 80, 160]; this.nodes.lowCut.frequency.setTargetAtTime(freqs[Math.floor(params.lowCut * 3.9)], now, 0.01); }
            if (params.warmth !== undefined) this.nodes.warmth.gain.setTargetAtTime(params.warmth * 4, now, 0.01);
        }
    }

    // Sony C-800G (1992) - The Modern Pop Icon
    class SonyC800G extends EffectBase {
        constructor() {
            super("SonyC800G");
            this._params = { brightness: 0.5, warmth: 0.3, presence: 0.4, pattern: 0 };
            // 6AU6A tube with Peltier cooling: 20Hz-18kHz, ultra-low noise
            // Modern, detailed, slightly bright character
            this.nodes.lowCut = new Tone.Filter({ type: 'highpass', frequency: 20, rolloff: -12 });
            this.nodes.brilliance = new Tone.Filter({ type: 'highshelf', frequency: 8000, gain: 3 });
            this.nodes.presence = new Tone.Filter({ type: 'peaking', frequency: 4000, Q: 0.6, gain: 2 });
            this.nodes.airBoost = new Tone.Filter({ type: 'highshelf', frequency: 14000, gain: 2 });
            this.nodes.warmth = new Tone.Filter({ type: 'lowshelf', frequency: 200, gain: 1 });
            // Clean tube - minimal saturation due to cooling
            this.nodes.tube = new Tone.Chebyshev(2);
            this.nodes.tube.wet.value = 0.1;
            this.nodes.makeup = new Tone.Gain(1.15);
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.lowCut, this.nodes.warmth, this.nodes.presence, this.nodes.brilliance, this.nodes.airBoost, this.nodes.tube, this.nodes.makeup, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.lowCut, this.nodes.brilliance, this.nodes.presence, this.nodes.airBoost, this.nodes.warmth, this.nodes.tube, this.nodes.makeup);
        }
        set(params) {
            super.set(params); const now = Tone.now();
            if (params.brightness !== undefined) { this.nodes.brilliance.gain.setTargetAtTime(params.brightness * 6, now, 0.01); this.nodes.airBoost.gain.setTargetAtTime(params.brightness * 4, now, 0.01); }
            if (params.presence !== undefined) this.nodes.presence.gain.setTargetAtTime(params.presence * 6, now, 0.01);
            if (params.warmth !== undefined) { this.nodes.warmth.gain.setTargetAtTime(params.warmth * 6, now, 0.01); this.nodes.tube.wet.setTargetAtTime(params.warmth * 0.3, now, 0.01); }
        }
    }

    // =========================================================================
    // II. DYNAMIC MICROPHONES (5)
    // =========================================================================

    // Sennheiser MD 421 (1960) - The Tom & Cab King
    class SennheiserMD421 extends EffectBase {
        constructor() {
            super("SennheiserMD421");
            this._params = { bassSwitch: 0.5, proximity: 0.2, presence: 0.3 };
            // 30Hz-17kHz, 5-position bass roll-off switch (M to S)
            this.nodes.bassRolloff = new Tone.Filter({ type: 'highpass', frequency: 50, rolloff: -12 });
            this.nodes.proximity = new Tone.Filter({ type: 'lowshelf', frequency: 200, gain: 0 });
            this.nodes.presenceBoost = new Tone.Filter({ type: 'peaking', frequency: 5000, Q: 0.8, gain: 2 });
            this.nodes.hfShelf = new Tone.Filter({ type: 'highshelf', frequency: 10000, gain: 0 });
            this.nodes.makeup = new Tone.Gain(1.5);
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.bassRolloff, this.nodes.proximity, this.nodes.presenceBoost, this.nodes.hfShelf, this.nodes.makeup, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.bassRolloff, this.nodes.proximity, this.nodes.presenceBoost, this.nodes.hfShelf, this.nodes.makeup);
        }
        set(params) {
            super.set(params); const now = Tone.now();
            if (params.bassSwitch !== undefined) { const freq = 50 + (params.bassSwitch * 450); this.nodes.bassRolloff.frequency.setTargetAtTime(freq, now, 0.01); }
            if (params.proximity !== undefined) this.nodes.proximity.gain.setTargetAtTime(params.proximity * 10, now, 0.01);
            if (params.presence !== undefined) this.nodes.presenceBoost.gain.setTargetAtTime(params.presence * 6, now, 0.01);
        }
    }

    // Shure SM57 (1965) - The Essential
    class ShureSM57 extends EffectBase {
        constructor() {
            super("ShureSM57");
            this._params = { presence: 0.5, proximity: 0.3, brightness: 0.4 };
            // 40Hz-15kHz, presence peak at 5-8kHz
            this.nodes.lowCut = new Tone.Filter({ type: 'highpass', frequency: 40, rolloff: -12 });
            this.nodes.proximity = new Tone.Filter({ type: 'lowshelf', frequency: 200, gain: 0 });
            this.nodes.presencePeak = new Tone.Filter({ type: 'peaking', frequency: 6000, Q: 0.7, gain: 5 });
            this.nodes.hfRolloff = new Tone.Filter({ type: 'lowpass', frequency: 15000, rolloff: -12 });
            this.nodes.makeup = new Tone.Gain(2);
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.lowCut, this.nodes.proximity, this.nodes.presencePeak, this.nodes.hfRolloff, this.nodes.makeup, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.lowCut, this.nodes.proximity, this.nodes.presencePeak, this.nodes.hfRolloff, this.nodes.makeup);
        }
        set(params) {
            super.set(params); const now = Tone.now();
            if (params.presence !== undefined) this.nodes.presencePeak.gain.setTargetAtTime(params.presence * 10, now, 0.01);
            if (params.proximity !== undefined) this.nodes.proximity.gain.setTargetAtTime(params.proximity * 12, now, 0.01);
            if (params.brightness !== undefined) this.nodes.hfRolloff.frequency.setTargetAtTime(10000 + (params.brightness * 5000), now, 0.01);
        }
    }

    // Electro-Voice RE20 (1968) - The Broadcast Standard
    class ElectroVoiceRE20 extends EffectBase {
        constructor() {
            super("ElectroVoiceRE20");
            this._params = { bassRolloff: 0, presence: 0.3, proximity: 0 };
            // Variable-D: 45Hz-18kHz, NO proximity effect, flat response
            this.nodes.bassSwitch = new Tone.Filter({ type: 'highpass', frequency: 45, rolloff: -12 });
            // Variable-D eliminates proximity - minimal low boost
            this.nodes.flatResponse = new Tone.Filter({ type: 'lowshelf', frequency: 200, gain: 0 });
            this.nodes.presenceHump = new Tone.Filter({ type: 'peaking', frequency: 9000, Q: 0.5, gain: 2 });
            this.nodes.hfShelf = new Tone.Filter({ type: 'highshelf', frequency: 12000, gain: 1 });
            this.nodes.makeup = new Tone.Gain(1.5);
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.bassSwitch, this.nodes.flatResponse, this.nodes.presenceHump, this.nodes.hfShelf, this.nodes.makeup, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.bassSwitch, this.nodes.flatResponse, this.nodes.presenceHump, this.nodes.hfShelf, this.nodes.makeup);
        }
        set(params) {
            super.set(params); const now = Tone.now();
            if (params.bassRolloff !== undefined) this.nodes.bassSwitch.frequency.setTargetAtTime(45 + (params.bassRolloff * 355), now, 0.01);
            if (params.presence !== undefined) this.nodes.presenceHump.gain.setTargetAtTime(params.presence * 6, now, 0.01);
            // RE20 has minimal proximity effect due to Variable-D
            if (params.proximity !== undefined) this.nodes.flatResponse.gain.setTargetAtTime(params.proximity * 3, now, 0.01);
        }
    }

    // Sennheiser MD 441 (1971) - The Hi-Fi Dynamic
    class SennheiserMD441 extends EffectBase {
        constructor() {
            super("SennheiserMD441");
            this._params = { bassContour: 0.5, trebleBoost: 0, presence: 0.4, proximity: 0.2 };
            // 30Hz-20kHz (condenser-like), 5-position bass, 2-position treble
            this.nodes.bassContour = new Tone.Filter({ type: 'highpass', frequency: 30, rolloff: -12 });
            this.nodes.proximity = new Tone.Filter({ type: 'lowshelf', frequency: 200, gain: 0 });
            this.nodes.presence = new Tone.Filter({ type: 'peaking', frequency: 5000, Q: 0.6, gain: 2 });
            this.nodes.trebleBoost = new Tone.Filter({ type: 'highshelf', frequency: 8000, gain: 0 });
            this.nodes.hfExtension = new Tone.Filter({ type: 'highshelf', frequency: 15000, gain: 1 });
            this.nodes.makeup = new Tone.Gain(1.3);
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.bassContour, this.nodes.proximity, this.nodes.presence, this.nodes.trebleBoost, this.nodes.hfExtension, this.nodes.makeup, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.bassContour, this.nodes.proximity, this.nodes.presence, this.nodes.trebleBoost, this.nodes.hfExtension, this.nodes.makeup);
        }
        set(params) {
            super.set(params); const now = Tone.now();
            if (params.bassContour !== undefined) this.nodes.bassContour.frequency.setTargetAtTime(30 + (params.bassContour * 200), now, 0.01);
            if (params.trebleBoost !== undefined) this.nodes.trebleBoost.gain.setTargetAtTime(params.trebleBoost * 6, now, 0.01);
            if (params.presence !== undefined) this.nodes.presence.gain.setTargetAtTime(params.presence * 6, now, 0.01);
            if (params.proximity !== undefined) this.nodes.proximity.gain.setTargetAtTime(params.proximity * 10, now, 0.01);
        }
    }

    // Shure SM7B (1973) - The Vocal Icon
    class ShureSM7B extends EffectBase {
        constructor() {
            super("ShureSM7B");
            this._params = { proximity: 0.2, presence: 0, bassCut: 0, drive: 0.05 };
            // 50Hz-20kHz, bass rolloff 80/200Hz, presence peak 6kHz (+5dB)
            this.nodes.bassCut = new Tone.Filter({ type: 'highpass', frequency: 80, rolloff: -12 });
            this.nodes.proximity = new Tone.Filter({ type: 'lowshelf', frequency: 150, gain: 0 });
            this.nodes.presenceBoost = new Tone.Filter({ type: 'peaking', frequency: 6000, Q: 0.7, gain: 0 });
            this.nodes.airShelf = new Tone.Filter({ type: 'highshelf', frequency: 10000, gain: 1 });
            this.nodes.preamp = new Tone.Gain(4);
            this.nodes.saturation = new Tone.Chebyshev(2);
            this.nodes.saturation.wet.value = 0.1;
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.bassCut, this.nodes.proximity, this.nodes.presenceBoost, this.nodes.airShelf, this.nodes.saturation, this.nodes.preamp, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.bassCut, this.nodes.proximity, this.nodes.presenceBoost, this.nodes.airShelf, this.nodes.preamp, this.nodes.saturation);
        }
        set(params) {
            super.set(params); const now = Tone.now();
            if (params.proximity !== undefined) this.nodes.proximity.gain.setTargetAtTime(params.proximity * 10, now, 0.01);
            if (params.presence !== undefined) this.nodes.presenceBoost.gain.setTargetAtTime(params.presence * 5, now, 0.01);
            if (params.bassCut !== undefined) this.nodes.bassCut.frequency.setTargetAtTime(params.bassCut > 0.5 ? 200 : 80, now, 0.01);
            if (params.drive !== undefined) this.nodes.saturation.wet.setTargetAtTime(params.drive * 0.4, now, 0.01);
        }
    }

    // =========================================================================
    // III. RIBBON MICROPHONES (5)
    // =========================================================================

    // RCA 44-BX (1932) - The Vintage Soul
    class RCA44BX extends EffectBase {
        constructor() {
            super("RCA44BX");
            this._params = { proximity: 0.3, warmth: 0.4, voiceMode: 0, age: 0.2 };
            // 50Hz-15kHz, strong proximity, M/V1/V2 voice switches
            this.nodes.lowCut = new Tone.Filter({ type: 'highpass', frequency: 50, rolloff: -12 });
            this.nodes.proximity = new Tone.Filter({ type: 'lowshelf', frequency: 300, gain: 0 });
            this.nodes.midWarmth = new Tone.Filter({ type: 'peaking', frequency: 600, Q: 0.8, gain: 2 });
            this.nodes.hfRolloff = new Tone.Filter({ type: 'lowpass', frequency: 15000, rolloff: -12 });
            this.nodes.transformer = new Tone.Chebyshev(2);
            this.nodes.transformer.wet.value = 0.2;
            this.nodes.makeup = new Tone.Gain(2.5);
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.lowCut, this.nodes.proximity, this.nodes.midWarmth, this.nodes.hfRolloff, this.nodes.transformer, this.nodes.makeup, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.lowCut, this.nodes.proximity, this.nodes.midWarmth, this.nodes.hfRolloff, this.nodes.transformer, this.nodes.makeup);
        }
        set(params) {
            super.set(params); const now = Tone.now();
            if (params.proximity !== undefined) this.nodes.proximity.gain.setTargetAtTime(params.proximity * 15, now, 0.01);
            if (params.warmth !== undefined) { this.nodes.midWarmth.gain.setTargetAtTime(params.warmth * 6, now, 0.01); this.nodes.transformer.wet.setTargetAtTime(params.warmth * 0.5, now, 0.01); }
            if (params.voiceMode !== undefined) this.nodes.lowCut.frequency.setTargetAtTime(50 + (params.voiceMode * 150), now, 0.01);
            if (params.age !== undefined) this.nodes.hfRolloff.frequency.setTargetAtTime(15000 - (params.age * 10000), now, 0.01);
        }
    }

    // Coles 4038 (1953) - The BBC Classic
    class Coles4038 extends EffectBase {
        constructor() {
            super("Coles4038");
            this._params = { proximity: 0.2, smoothness: 0.5, brightness: 0.3 };
            // 30Hz-15kHz BBC spec, exceptionally flat, natural sound
            this.nodes.lowCut = new Tone.Filter({ type: 'highpass', frequency: 30, rolloff: -12 });
            this.nodes.proximity = new Tone.Filter({ type: 'lowshelf', frequency: 250, gain: 0 });
            this.nodes.midSmooth = new Tone.Filter({ type: 'peaking', frequency: 3000, Q: 0.5, gain: -1 });
            this.nodes.hfNatural = new Tone.Filter({ type: 'lowpass', frequency: 15000, rolloff: -12 });
            this.nodes.transformer = new Tone.Chebyshev(2);
            this.nodes.transformer.wet.value = 0.15;
            this.nodes.makeup = new Tone.Gain(2);
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.lowCut, this.nodes.proximity, this.nodes.midSmooth, this.nodes.hfNatural, this.nodes.transformer, this.nodes.makeup, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.lowCut, this.nodes.proximity, this.nodes.midSmooth, this.nodes.hfNatural, this.nodes.transformer, this.nodes.makeup);
        }
        set(params) {
            super.set(params); const now = Tone.now();
            if (params.proximity !== undefined) this.nodes.proximity.gain.setTargetAtTime(params.proximity * 12, now, 0.01);
            if (params.smoothness !== undefined) this.nodes.midSmooth.gain.setTargetAtTime(-params.smoothness * 3, now, 0.01);
            if (params.brightness !== undefined) this.nodes.hfNatural.frequency.setTargetAtTime(12000 + (params.brightness * 6000), now, 0.01);
        }
    }

    // Beyerdynamic M160 (1957) - The Rock Ribbon
    class BeyerdynamicM160 extends EffectBase {
        constructor() {
            super("BeyerdynamicM160");
            this._params = { proximity: 0.2, warmth: 0.3, brightness: 0.4 };
            // 40Hz-18kHz, hypercardioid (unique for ribbon), double-ribbon
            this.nodes.lowCut = new Tone.Filter({ type: 'highpass', frequency: 40, rolloff: -12 });
            this.nodes.proximity = new Tone.Filter({ type: 'lowshelf', frequency: 200, gain: 0 });
            this.nodes.midWarmth = new Tone.Filter({ type: 'peaking', frequency: 800, Q: 0.7, gain: 1 });
            this.nodes.silkyHigh = new Tone.Filter({ type: 'highshelf', frequency: 8000, gain: 1 });
            this.nodes.hfLimit = new Tone.Filter({ type: 'lowpass', frequency: 18000, rolloff: -12 });
            this.nodes.makeup = new Tone.Gain(2);
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.lowCut, this.nodes.proximity, this.nodes.midWarmth, this.nodes.silkyHigh, this.nodes.hfLimit, this.nodes.makeup, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.lowCut, this.nodes.proximity, this.nodes.midWarmth, this.nodes.silkyHigh, this.nodes.hfLimit, this.nodes.makeup);
        }
        set(params) {
            super.set(params); const now = Tone.now();
            if (params.proximity !== undefined) this.nodes.proximity.gain.setTargetAtTime(params.proximity * 10, now, 0.01);
            if (params.warmth !== undefined) this.nodes.midWarmth.gain.setTargetAtTime(params.warmth * 6, now, 0.01);
            if (params.brightness !== undefined) this.nodes.silkyHigh.gain.setTargetAtTime(params.brightness * 6, now, 0.01);
        }
    }

    // Royer R-121 (1998) - The Modern Revival
    class RoyerR121 extends EffectBase {
        constructor() {
            super("RoyerR121");
            this._params = { proximity: 0.2, warmth: 0.3, brightness: 0.4, spl: 0.5 };
            // 30Hz-15kHz, 2.5-micron aluminum ribbon, handles 135dB+ SPL
            this.nodes.lowCut = new Tone.Filter({ type: 'highpass', frequency: 30, rolloff: -12 });
            this.nodes.proximity = new Tone.Filter({ type: 'lowshelf', frequency: 250, gain: 0 });
            this.nodes.warmMids = new Tone.Filter({ type: 'peaking', frequency: 600, Q: 0.6, gain: 1 });
            this.nodes.smoothHigh = new Tone.Filter({ type: 'highshelf', frequency: 6000, gain: -1 });
            this.nodes.hfRolloff = new Tone.Filter({ type: 'lowpass', frequency: 15000, rolloff: -12 });
            this.nodes.transformer = new Tone.Chebyshev(2);
            this.nodes.transformer.wet.value = 0.12;
            this.nodes.makeup = new Tone.Gain(2);
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.lowCut, this.nodes.proximity, this.nodes.warmMids, this.nodes.smoothHigh, this.nodes.hfRolloff, this.nodes.transformer, this.nodes.makeup, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.lowCut, this.nodes.proximity, this.nodes.warmMids, this.nodes.smoothHigh, this.nodes.hfRolloff, this.nodes.transformer, this.nodes.makeup);
        }
        set(params) {
            super.set(params); const now = Tone.now();
            if (params.proximity !== undefined) this.nodes.proximity.gain.setTargetAtTime(params.proximity * 12, now, 0.01);
            if (params.warmth !== undefined) { this.nodes.warmMids.gain.setTargetAtTime(params.warmth * 6, now, 0.01); this.nodes.transformer.wet.setTargetAtTime(params.warmth * 0.3, now, 0.01); }
            if (params.brightness !== undefined) this.nodes.smoothHigh.gain.setTargetAtTime(-2 + (params.brightness * 4), now, 0.01);
        }
    }

    // AEA R84 (2002) - The Big Ribbon
    class AEAR84 extends EffectBase {
        constructor() {
            super("AEAR84");
            this._params = { proximity: 0.3, warmth: 0.4, lowEnd: 0.5, age: 0 };
            // 20Hz-20kHz, big ribbon element, low-end "hug", peak at 150Hz
            this.nodes.lowCut = new Tone.Filter({ type: 'highpass', frequency: 20, rolloff: -12 });
            this.nodes.proximity = new Tone.Filter({ type: 'lowshelf', frequency: 300, gain: 0 });
            this.nodes.bassHump = new Tone.Filter({ type: 'peaking', frequency: 150, Q: 0.8, gain: 3 });
            this.nodes.warmMids = new Tone.Filter({ type: 'peaking', frequency: 600, Q: 0.5, gain: 1 });
            this.nodes.hfRolloff = new Tone.Filter({ type: 'lowpass', frequency: 18000, rolloff: -12 });
            this.nodes.transformer = new Tone.Chebyshev(2);
            this.nodes.transformer.wet.value = 0.15;
            this.nodes.makeup = new Tone.Gain(2.5);
            this.wet.disconnect(this.nodes.stereoWidener);
            this.wet.chain(this.nodes.lowCut, this.nodes.proximity, this.nodes.bassHump, this.nodes.warmMids, this.nodes.hfRolloff, this.nodes.transformer, this.nodes.makeup, this.nodes.stereoWidener);
            this._disposables.push(this.nodes.lowCut, this.nodes.proximity, this.nodes.bassHump, this.nodes.warmMids, this.nodes.hfRolloff, this.nodes.transformer, this.nodes.makeup);
        }
        set(params) {
            super.set(params); const now = Tone.now();
            if (params.proximity !== undefined) this.nodes.proximity.gain.setTargetAtTime(params.proximity * 15, now, 0.01);
            if (params.warmth !== undefined) { this.nodes.warmMids.gain.setTargetAtTime(params.warmth * 6, now, 0.01); this.nodes.transformer.wet.setTargetAtTime(params.warmth * 0.4, now, 0.01); }
            if (params.lowEnd !== undefined) this.nodes.bassHump.gain.setTargetAtTime(params.lowEnd * 8, now, 0.01);
            if (params.age !== undefined) this.nodes.hfRolloff.frequency.setTargetAtTime(18000 - (params.age * 10000), now, 0.01);
        }
    }

    // =========================================================================
    // EXPORT CLASSES AND CONFIGURATIONS
    // =========================================================================

    const classes = {
        // Condensers
        NeumannU47, AKGC12, NeumannU87, AKGC414, SonyC800G,
        // Dynamics
        SennheiserMD421, ShureSM57, ElectroVoiceRE20, SennheiserMD441, ShureSM7B,
        // Ribbons
        RCA44BX, Coles4038, BeyerdynamicM160, RoyerR121, AEAR84
    };

    const configs = {
        "Microphone": {
            // === CONDENSER ===
            "Neumann U47 (1947)": {
                "isCustom": "NeumannU47", "columns": [
                    [{ "l": "Warmth", "p": "warmth", "min": 0, "max": 1, "s": 0.01, "def": 0.3 }],
                    [{ "l": "Presence", "p": "presence", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }],
                    [{ "l": "Proximity", "p": "proximity", "min": 0, "max": 1, "s": 0.01, "def": 0.2 }]
                ]
            },
            "AKG C12 (1953)": {
                "isCustom": "AKGC12", "columns": [
                    [{ "l": "Air", "p": "air", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }],
                    [{ "l": "Presence", "p": "presence", "min": 0, "max": 1, "s": 0.01, "def": 0.4 }],
                    [{ "l": "Warmth", "p": "warmth", "min": 0, "max": 1, "s": 0.01, "def": 0.2 }]
                ]
            },
            "Neumann U87 (1967)": {
                "isCustom": "NeumannU87", "columns": [
                    [{ "l": "Air", "p": "air", "min": 0, "max": 1, "s": 0.01, "def": 0.3 }],
                    [{ "l": "Warmth", "p": "warmth", "min": 0, "max": 1, "s": 0.01, "def": 0.1 }],
                    [{ "l": "Low Cut", "p": "lowCut", "min": 0, "max": 1, "s": 1, "def": 0 }]
                ]
            },
            "AKG C414 (1971)": {
                "isCustom": "AKGC414", "columns": [
                    [{ "l": "Presence", "p": "presence", "min": 0, "max": 1, "s": 0.01, "def": 0.3 }],
                    [{ "l": "Low Cut", "p": "lowCut", "min": 0, "max": 1, "s": 0.33, "def": 0 }],
                    [{ "l": "Warmth", "p": "warmth", "min": 0, "max": 1, "s": 0.01, "def": 0.2 }]
                ]
            },
            "Sony C-800G (1992)": {
                "isCustom": "SonyC800G", "columns": [
                    [{ "l": "Brightness", "p": "brightness", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }],
                    [{ "l": "Presence", "p": "presence", "min": 0, "max": 1, "s": 0.01, "def": 0.4 }],
                    [{ "l": "Warmth", "p": "warmth", "min": 0, "max": 1, "s": 0.01, "def": 0.3 }]
                ]
            },
            // === DYNAMIC ===
            "Sennheiser MD 421 (1960)": {
                "isCustom": "SennheiserMD421", "columns": [
                    [{ "l": "Bass Switch", "p": "bassSwitch", "min": 0, "max": 1, "s": 0.2, "def": 0.5 }],
                    [{ "l": "Proximity", "p": "proximity", "min": 0, "max": 1, "s": 0.01, "def": 0.2 }],
                    [{ "l": "Presence", "p": "presence", "min": 0, "max": 1, "s": 0.01, "def": 0.3 }]
                ]
            },
            "Shure SM57 (1965)": {
                "isCustom": "ShureSM57", "columns": [
                    [{ "l": "Presence", "p": "presence", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }],
                    [{ "l": "Proximity", "p": "proximity", "min": 0, "max": 1, "s": 0.01, "def": 0.3 }],
                    [{ "l": "Brightness", "p": "brightness", "min": 0, "max": 1, "s": 0.01, "def": 0.4 }]
                ]
            },
            "Electro-Voice RE20 (1968)": {
                "isCustom": "ElectroVoiceRE20", "columns": [
                    [{ "l": "Bass Roll", "p": "bassRolloff", "min": 0, "max": 1, "s": 0.01, "def": 0 }],
                    [{ "l": "Presence", "p": "presence", "min": 0, "max": 1, "s": 0.01, "def": 0.3 }],
                    [{ "l": "Proximity", "p": "proximity", "min": 0, "max": 1, "s": 0.01, "def": 0 }]
                ]
            },
            "Sennheiser MD 441 (1971)": {
                "isCustom": "SennheiserMD441", "columns": [
                    [{ "l": "Bass", "p": "bassContour", "min": 0, "max": 1, "s": 0.2, "def": 0.5 }],
                    [{ "l": "Treble", "p": "trebleBoost", "min": 0, "max": 1, "s": 0.5, "def": 0 }],
                    [{ "l": "Presence", "p": "presence", "min": 0, "max": 1, "s": 0.01, "def": 0.4 }]
                ]
            },
            "Shure SM7B (1973)": {
                "isCustom": "ShureSM7B", "columns": [
                    [{ "l": "Proximity", "p": "proximity", "min": 0, "max": 1, "s": 0.01, "def": 0.2 }],
                    [{ "l": "Presence", "p": "presence", "min": 0, "max": 1, "s": 0.01, "def": 0 }],
                    [{ "l": "Bass Cut", "p": "bassCut", "min": 0, "max": 1, "s": 1, "def": 0 }]
                ]
            },
            // === RIBBON ===
            "RCA 44-BX (1932)": {
                "isCustom": "RCA44BX", "columns": [
                    [{ "l": "Proximity", "p": "proximity", "min": 0, "max": 1, "s": 0.01, "def": 0.3 }],
                    [{ "l": "Warmth", "p": "warmth", "min": 0, "max": 1, "s": 0.01, "def": 0.4 }],
                    [{ "l": "Voice Mode", "p": "voiceMode", "min": 0, "max": 1, "s": 0.5, "def": 0 }]
                ]
            },
            "Coles 4038 (1953)": {
                "isCustom": "Coles4038", "columns": [
                    [{ "l": "Proximity", "p": "proximity", "min": 0, "max": 1, "s": 0.01, "def": 0.2 }],
                    [{ "l": "Smoothness", "p": "smoothness", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }],
                    [{ "l": "Brightness", "p": "brightness", "min": 0, "max": 1, "s": 0.01, "def": 0.3 }]
                ]
            },
            "Beyerdynamic M160 (1957)": {
                "isCustom": "BeyerdynamicM160", "columns": [
                    [{ "l": "Proximity", "p": "proximity", "min": 0, "max": 1, "s": 0.01, "def": 0.2 }],
                    [{ "l": "Warmth", "p": "warmth", "min": 0, "max": 1, "s": 0.01, "def": 0.3 }],
                    [{ "l": "Brightness", "p": "brightness", "min": 0, "max": 1, "s": 0.01, "def": 0.4 }]
                ]
            },
            "Royer R-121 (1998)": {
                "isCustom": "RoyerR121", "columns": [
                    [{ "l": "Proximity", "p": "proximity", "min": 0, "max": 1, "s": 0.01, "def": 0.2 }],
                    [{ "l": "Warmth", "p": "warmth", "min": 0, "max": 1, "s": 0.01, "def": 0.3 }],
                    [{ "l": "Brightness", "p": "brightness", "min": 0, "max": 1, "s": 0.01, "def": 0.4 }]
                ]
            },
            "AEA R84 (2002)": {
                "isCustom": "AEAR84", "columns": [
                    [{ "l": "Proximity", "p": "proximity", "min": 0, "max": 1, "s": 0.01, "def": 0.3 }],
                    [{ "l": "Warmth", "p": "warmth", "min": 0, "max": 1, "s": 0.01, "def": 0.4 }],
                    [{ "l": "Low End", "p": "lowEnd", "min": 0, "max": 1, "s": 0.01, "def": 0.5 }]
                ]
            }
        }
    };

    window.effectModules.microphone = { classes, configs };
})();
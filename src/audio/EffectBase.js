/**
 * EffectBase.js
 * Base classes for audio effects and custom effect module integration.
 */

(function () {
    const { Tone } = window;

    // --- GLOBAL INITIALIZATION & SOURCE UTILITY ---
    if (typeof window.AppSource === 'undefined') {
        window.AppSource = {};
    }
    
    window.saveModuleSource = (fileName) => {
        const script = document.querySelector(`script[src="${fileName}"]`);
        if (script && script.text) {
            window.AppSource[fileName] = script.text;
            return script.text;
        }

        if (window.buildSource && window.buildSource[fileName]) {
            window.AppSource[fileName] = window.buildSource[fileName];
            return window.buildSource[fileName];
        }
        return null;
    };

    if (typeof window.effectModules === 'undefined') window.effectModules = {};
    if (typeof window.CustomEffects === 'undefined') window.CustomEffects = {};
    if (typeof window.effectConfigs === 'undefined') window.effectConfigs = {};

    window.saveModuleSource('src/audio/EffectBase.js');

    // --- UTILITY & BASE CLASSES ---
    if (typeof window.EffectBase === 'undefined') {

        window.clamp = (value, min, max) => {
            if (typeof value !== 'number' || isNaN(value)) return min;
            return Math.max(min, Math.min(value, max));
        };
        const clamp = window.clamp;

        class HaasWidener extends Tone.Gain {
            constructor() {
                super();
                this.name = "HaasWidener";
                this.input = new Tone.Gain();
                this.output = new Tone.Merge();
                this._split = new Tone.Split();
                this._delay = new Tone.Delay(0, 0.036);
                this._direct = new Tone.Gain();
                this._outputGain = new Tone.Gain(1);
                this._merge = new Tone.Merge(); 
                this._disposables = [];

                this.input.connect(this._split);
                this._split.connect(this._direct, 0);
                this._split.connect(this._delay, 1);

                this._direct.connect(this._merge, 0, 0);
                this._delay.connect(this._merge, 0, 1);
                this._merge.connect(this._outputGain);
                this._outputGain.connect(this.output);

                this._disposables.push(this.input, this.output, this._split, this._delay, this._direct, this._outputGain, this._merge);
            }

            setWidth(width) {
                const w = clamp(width, 0, 1);
                this._delay.delayTime.rampTo(w * 0.036, 0.01);
                this._outputGain.gain.rampTo(1 + (w * 0.5), 0.01);
            }

            dispose() {
                super.dispose();
                this._disposables.forEach(node => node.dispose());
                this._disposables = [];
                return this;
            }
        }

        class EffectBase {
            constructor(name = "EffectBase") {
                this.name = name;
                this.nodes = {};
                this._disposables = [];

                this.input = new Tone.Gain();
                this.output = new Tone.Gain();
                this.dry = new Tone.Gain();
                this.wet = new Tone.Gain();

                this.nodes.stereoWidener = new HaasWidener();
                this.mixNode = new Tone.CrossFade(0.5);

                this.input.fan(this.dry, this.wet);
                this.dry.connect(this.mixNode.a);
                this.wet.chain(this.nodes.stereoWidener, this.mixNode.b);
                this.mixNode.connect(this.output);

                this._disposables.push(this.input, this.output, this.dry, this.wet, this.nodes.stereoWidener, this.mixNode);
            }

            set(params) {
                if (params.mix !== undefined) {
                    const mixVal = clamp(params.mix, 0, 1);
                    console.log(`[EffectBase] Setting Mix for ${this.name}: ${mixVal} (Raw: ${params.mix})`);
                    this.mixNode.fade.rampTo(mixVal, 0.01);
                }
                if (params.width !== undefined) {
                    const effectiveMix = (params.mix !== undefined) ? params.mix : this.mixNode.fade.value;
                    const effectiveWidth = params.width * effectiveMix;
                    this.nodes.stereoWidener.setWidth(effectiveWidth);
                }
            }

            connect(dest) { this.output.connect(dest); }
            disconnect() { this.output.disconnect(); }

            dispose() {
                const toDispose = this._disposables;
                this._disposables = [];

                toDispose.forEach(node => {
                    if (node) {
                        if (node instanceof Tone.LFO || node instanceof Tone.Loop || node instanceof Tone.Noise) {
                            if (node.state === "started") node.stop();
                        }
                        if (typeof node.dispose === 'function') {
                            node.dispose();
                        }
                    }
                });
                this.nodes = {};
            }
        }
        window.EffectBase = EffectBase;

        class NativeWrapper extends EffectBase {
            constructor(className, config) {
                super(`NativeWrapper<${className}>`);
                const initialParams = {};
                if (config && config.columns) {
                    config.columns.flat().forEach(p => {
                        if (p.p !== 'mix' && p.p !== 'width') initialParams[p.p] = p.def;
                    });
                }
                initialParams.wet = 1;
                this.nodes.core = new Tone[className](initialParams);
                this.wet.chain(this.nodes.core, this.nodes.stereoWidener);
                this._disposables.push(this.nodes.core);
            }
            set(params) {
                super.set(params);
                if (!this.nodes.core) return;

                const coreParams = { ...params };
                delete coreParams.mix;
                delete coreParams.width;

                if (params.width !== undefined && this.nodes.core.spread !== undefined) {
                    this.nodes.core.spread = params.width * 180;
                }

                if (typeof this.nodes.core.set === 'function') {
                    this.nodes.core.set(coreParams);
                } else {
                    for (const key in coreParams) {
                        if (this.nodes.core[key] instanceof Tone.Param) {
                            this.nodes.core[key].rampTo(coreParams[key], 0.01);
                        } else if (this.nodes.core[key] !== undefined) {
                            this.nodes.core[key] = coreParams[key];
                        }
                    }
                }
            }
        }
        window.NativeWrapper = NativeWrapper;
    }
})();

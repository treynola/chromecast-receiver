/**
 * EffectsService
 * Central registry and factory for audio effects.
 */
(function () {
    class EffectsService {
        constructor() {
            // Check if global configs are loaded
            // Configs are checked lazily
        }

        getEffectConfig(effectName) {
            if (!window.effectConfigs) return null;

            for (const category in window.effectConfigs) {
                if (window.effectConfigs[category][effectName]) {
                    return window.effectConfigs[category][effectName];
                }
            }
            return null;
        }

        createEffect(effectName, params) {
            const config = this.getEffectConfig(effectName);
            if (!config) return null;

            if (config.isCustom) {
                // 1. Check window.CustomEffects first
                let EffectClass = window.CustomEffects?.[config.isCustom];

                // 2. Fallback: search window.effectModules for the class
                if (!EffectClass && window.effectModules) {
                    for (const mod of Object.values(window.effectModules)) {
                        if (mod.classes && mod.classes[config.isCustom]) {
                            EffectClass = mod.classes[config.isCustom];
                            break;
                        }
                    }
                }

                if (EffectClass) {
                    try {
                        const instance = new EffectClass();
                        if (params) instance.set(params);
                        instance.name = effectName;
                        instance.enabled = true;
                        return instance;
                    } catch (e) {
                        console.error(`EffectsService: Failed to create effect ${effectName}`, e);
                    }
                } else {
                    console.warn(`EffectsService: No class found for '${config.isCustom}' (effect: ${effectName})`);
                }
            }

            // Fallback: Native Tone.js wrapper (config has "class" field)
            if (config.class && window.NativeWrapper) {
                try {
                    const instance = new window.NativeWrapper(config.class, config);
                    if (params) instance.set(params);
                    instance.name = effectName;
                    instance.enabled = true;
                    return instance;
                } catch (e) {
                    console.error(`EffectsService: Failed to create native effect ${effectName}`, e);
                }
            }

            return null;
        }
    }

    // Export singleton
    window.effectsService = new EffectsService();
})();

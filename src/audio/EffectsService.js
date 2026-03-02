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

            if (config.isCustom && window.CustomEffects) {
                const EffectClass = window.CustomEffects[config.isCustom];
                if (EffectClass) {
                    try {
                        const instance = new EffectClass();
                        if (params) instance.set(params);
                        instance.name = effectName; // Store name for UI
                        instance.enabled = true;
                        return instance;
                    } catch (e) {
                        console.error(`EffectsService: Failed to create custom effect ${effectName}`, e);
                    }
                }
            }
            return null;
        }
    }

    // Export singleton
    window.effectsService = new EffectsService();
})();

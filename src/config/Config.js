/**
 * Application Configuration
 * Namespaced to window.AppConfig
 */

window.AppConfig = window.AppConfig || {};

(function (exports) {

    exports.NUM_TRACKS = 4;

    // Default LFO Parameter Map
    exports.LFO_PARAM_MAP = {
        'vol': 'volume',
        'pan': 'pan',
        'pitch': 'pitch',
        'filter': 'filter', // If filter is added later
        'speed': 'playbackRate'
    };

    // Polyfill for LFO Min/Max Presets if we want defaults
    exports.LFO_MIN_PRESETS_DEFAULT = {};
    exports.LFO_MAX_PRESETS_DEFAULT = {};

})(window.AppConfig);

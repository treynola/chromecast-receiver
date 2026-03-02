/**
 * DeviceManager.js
 * 
 * Responsibilities:
 *  1. Enumerate all audio input devices
 *  2. Detect BlackHole (and equivalents on other platforms)
 *  3. Watch for device connect/disconnect events
 *  4. Provide deviceId for getUserMedia calls
 */
(function () {
    class DeviceManager {
        constructor() {
            this._devices = [];
            this._changeCallbacks = [];
            this._permissionGranted = false;
        }

        /**
         * Request microphone permission. Must be called from a user gesture.
         */
        async requestPermission() {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(t => t.stop());
                this._permissionGranted = true;
                console.log('[DeviceManager] Microphone permission granted');
                return true;
            } catch (e) {
                console.error('[DeviceManager] Microphone permission denied:', e);
                return false;
            }
        }

        /**
         * Enumerate and return all audioinput devices.
         * Returns extended objects with isBlackHole, isVirtualCable flags.
         */
        async enumerate() {
            try {
                const raw = await navigator.mediaDevices.enumerateDevices();

                // If labels are empty, we need to request permission first
                const hasLabels = raw.some(d => d.kind === 'audioinput' && d.label !== '');
                if (!hasLabels && !this._permissionGranted) {
                    // Note: We don't auto-request here as it needs a user gesture usually
                    console.warn('[DeviceManager] Device labels are missing. Call requestPermission() from a button click.');
                }

                this._devices = raw
                    .filter(d => d.kind === 'audioinput')
                    .map(d => ({
                        deviceId: d.deviceId,
                        groupId: d.groupId,
                        label: d.label || `Unknown Device (${d.deviceId.slice(0, 5)}...)`,
                        // Detection heuristics
                        isBlackHole: this._isBlackHole(d.label),
                        isVirtualCable: this._isVirtualCable(d.label),
                        isMicrophone: !this._isBlackHole(d.label) && !this._isVirtualCable(d.label),
                    }));

                console.log(`[DeviceManager] Enumerated ${this._devices.length} audio inputs.`);
                return this._devices;
            } catch (e) {
                console.error('[DeviceManager] Enumeration failed:', e);
                return [];
            }
        }

        getLoopbackDevice() {
            return this._devices.find(d => d.isBlackHole || d.isVirtualCable) ?? null;
        }

        getMicrophoneDevices() {
            return this._devices.filter(d => d.isMicrophone);
        }

        onDeviceChange(callback) {
            this._changeCallbacks.push(callback);
            if (this._changeCallbacks.length === 1) {
                navigator.mediaDevices.addEventListener('devicechange', this._handleChange.bind(this));
            }
        }

        async _handleChange() {
            console.log('[DeviceManager] devices changed, re-enumerating...');
            const updated = await this.enumerate();
            this._changeCallbacks.forEach(cb => cb(updated));
        }

        _isBlackHole(label = '') {
            const l = label.toLowerCase();
            return l.includes('blackhole') || l.includes('black hole');
        }

        _isVirtualCable(label = '') {
            const l = label.toLowerCase();
            return (
                l.includes('vb-audio') ||
                l.includes('virtual audio cable') ||
                l.includes('vac') ||
                l.includes('cable output') ||
                l.includes('jack') ||
                l.includes('pipewire') ||
                l.includes('soundflower')
            );
        }

        destroy() {
            navigator.mediaDevices.removeEventListener('devicechange', this._handleChange);
            this._changeCallbacks = [];
        }
    }

    window.DeviceManager = DeviceManager;
})();

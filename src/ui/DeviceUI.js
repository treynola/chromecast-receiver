/**
 * DeviceUI.js
 * Manages the UI for audio device selection and permissions.
 */
(function () {

    /**
     * Permission Check (Legacy/Safety)
     */
    async function check_permissions() {
        try {
            console.log("DeviceUI: Checking microphone permissions...");
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(t => t.stop());
            console.log("DeviceUI: Microphone permission verified.");
            window.isMicPermissionGranted = true;
            return true;
        } catch (err) {
            console.error("DeviceUI: Mic check failed", err);
            window.isMicPermissionGranted = false;
            return false;
        }
    }

    /**
     * Populates all audio input source selectors.
     */
    async function populateDeviceSelectors() {
        try {
            const manager = window.audioService.deviceManager;
            const devices = await manager.enumerate();

            const savedDeviceId = window.PersistenceService.getInputDeviceId();
            const selectors = document.querySelectorAll('.input-source');

            selectors.forEach(select => {
                const currentVal = select.value;
                select.innerHTML = '';

                const addOpt = (val, text, forceSelected = false) => {
                    const opt = document.createElement('option');
                    opt.value = val;
                    opt.text = text;
                    if (forceSelected) opt.selected = true;
                    select.appendChild(opt);
                };

                // 1. Physical Microphones
                devices.filter(d => d.isMicrophone).forEach(d => {
                    addOpt(d.deviceId, d.label, d.deviceId === savedDeviceId);
                });

                // 2. Virtual/Loopback Inputs
                devices.filter(d => !d.isMicrophone).forEach(d => {
                    const prefix = d.isBlackHole ? '🔁 ' : '🔌 ';
                    addOpt(d.deviceId, prefix + d.label, d.deviceId === savedDeviceId);
                });

                // 3. MC PA Mode (Legacy)
                addOpt('mc-pa', '🎤 MC PA Mode', currentVal === 'mc-pa');

                // 4. Virtual/Import Options
                addOpt('file', '📂 Import File...', currentVal === 'file');
                addOpt('directory', '📁 Import Directory...', currentVal === 'directory');
                addOpt('system', '📷 System Audio / Loopback', currentVal === 'system');

                if (currentVal && ![...select.options].some(o => o.value === currentVal)) {
                    // Fallback handled by previous selection
                } else if (!select.value && savedDeviceId) {
                    select.value = savedDeviceId;
                }
            });

            // Update Loopback Status UI
            const bhStatus = document.getElementById('bh-status');
            if (bhStatus) {
                const loopback = manager.getLoopbackDevice();
                bhStatus.textContent = loopback ? `✅ ${loopback.label} detected` : '⚠️ No loopback device found';
            }

        } catch (err) {
            console.error("DeviceUI: Failed to populate device selectors:", err);
        }
    }

    // Export to window
    window.check_permissions = check_permissions;
    window.populateDeviceSelectors = populateDeviceSelectors;

})();

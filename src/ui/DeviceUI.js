/**
 * DeviceUI.js
 * Manages the UI for audio device selection and permissions.
 */
(function () {

    /**
     * Populates all audio input source selectors.
     */
    async function populateDeviceSelectors() {
        try {
            const manager = window.audioEngine.contextManager.deviceManager;
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
    window.populateDeviceSelectors = populateDeviceSelectors;

})();

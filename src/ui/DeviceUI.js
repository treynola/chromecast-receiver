/**
 * DeviceUI.js
 * Handles Audio Input/Output device picking and permissions.
 */
(function () {

    /**
     * Checks for microphone permissions and starts the stream if needed.
     */
    async function check_permissions() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.log("DeviceUI: Microphone permissions granted.");
            // We don't need to keep the stream open here, just verify access
            stream.getTracks().forEach(t => t.stop());
            return true;
        } catch (err) {
            console.error("DeviceUI: Permission Denied", err);
            alert("Microphone access is required for recording. Please enable it in browser settings.");
            return false;
        }
    }

    /**
     * Populates all .input-source-select dropdowns with available devices.
     */
    async function populateDeviceSelectors() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(d => d.kind === 'audioinput');

            const selectors = document.querySelectorAll('.input-source-select');
            selectors.forEach(sel => {
                // Keep initial "Mic (Default)", "File", "Directory" etc.
                const existingLabels = Array.from(sel.options).map(o => o.textContent);
                
                audioInputs.forEach(dev => {
                    const label = dev.label || `In: ${dev.deviceId.substring(0, 5)}...`;
                    if (!existingLabels.includes(label)) {
                        const opt = document.createElement('option');
                        opt.value = dev.deviceId;
                        opt.textContent = label;
                        sel.appendChild(opt);
                    }
                });
            });

            console.log(`DeviceUI: Populated selectors with ${audioInputs.length} inputs.`);
        } catch (err) {
            console.error("DeviceUI: Failed to enumerate devices", err);
        }
    }

    // Listen for device changes
    navigator.mediaDevices.ondevicechange = populateDeviceSelectors;

    // Export
    window.check_permissions = check_permissions;
    window.populateDeviceSelectors = populateDeviceSelectors;

    // Initial population
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', populateDeviceSelectors);
    } else {
        populateDeviceSelectors();
    }

})();

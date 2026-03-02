/**
 * SamplerUI.js
 * Manages the UI for the 20-pad "Sample Station".
 */
(function () {

    /**
     * Shows a modal for per-pad settings (Trigger Mode, Vintage Character).
     */
    function showPadSettings(padId, btn) {
        const acm = window.audioService?.contextManager;
        if (!acm || !acm.samplerService) return;

        const voice = acm.samplerService.getVoice(padId);
        if (!voice) return;

        // Remove existing dialog if any
        const existing = document.querySelector('.pad-settings-dialog');
        if (existing) existing.remove();

        const dialog = document.createElement('dialog');
        dialog.className = 'pad-settings-dialog';
        dialog.style.padding = '20px';
        dialog.style.background = '#222';
        dialog.style.border = '2px solid var(--gold)';
        dialog.style.color = '#fff';
        dialog.style.borderRadius = '8px';
        dialog.style.position = 'fixed';
        dialog.style.top = '50%';
        dialog.style.left = '50%';
        dialog.style.transform = 'translate(-50%, -50%)';
        dialog.style.zIndex = '10000';

        const title = document.createElement('h3');
        title.textContent = `Pad ${padId} Settings`;
        title.style.color = 'var(--gold)';
        title.style.marginBottom = '10px';
        title.style.marginTop = '0';
        dialog.appendChild(title);

        const currentMode = voice.mode; // 'oneshot', 'gate', 'toggle'

        const modeLabel = document.createElement('div');
        modeLabel.textContent = "Trigger Mode:";
        modeLabel.style.marginBottom = '5px';
        modeLabel.style.fontSize = '0.9em';
        dialog.appendChild(modeLabel);

        const modes = [
            { id: 'oneshot', label: 'One-Shot (Trigger)', desc: 'Plays to end on tap.' },
            { id: 'gate', label: 'Gate (Momentary)', desc: 'Plays only while held.' },
            { id: 'toggle', label: 'Toggle (Latch)', desc: 'Tap start / Tap stop.' }
        ];

        modes.forEach(mode => {
            const row = document.createElement('div');
            row.style.marginBottom = '8px';
            row.style.display = 'flex';
            row.style.alignItems = 'center';

            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'pad-mode';
            radio.value = mode.id;
            radio.checked = (currentMode === mode.id);
            radio.style.marginRight = '10px';

            radio.onchange = () => {
                acm.samplerService.setPadMode(padId, mode.id);
                console.log(`Pad ${padId} mode set to ${mode.id}`);
            };

            const labelDiv = document.createElement('div');
            labelDiv.innerHTML = `<span style="color: white; font-weight: bold;">${mode.label}</span><br><span style="color: #aaa; font-size: 0.8em;">${mode.desc}</span>`;

            // Allow clicking label to select
            labelDiv.style.cursor = 'pointer';
            labelDiv.onclick = () => { radio.checked = true; radio.dispatchEvent(new Event('change')); };

            row.appendChild(radio);
            row.appendChild(labelDiv);
            dialog.appendChild(row);
        });

        // Vintage Character Controls
        const spacer = document.createElement('hr');
        spacer.style.border = '0';
        spacer.style.borderTop = '1px solid #444';
        spacer.style.margin = '15px 0';
        dialog.appendChild(spacer);

        const vintageTitle = document.createElement('div');
        vintageTitle.textContent = "Vintage Character";
        vintageTitle.style.color = 'var(--gold)';
        vintageTitle.style.marginBottom = '10px';
        vintageTitle.style.fontWeight = 'bold';
        dialog.appendChild(vintageTitle);

        // 1. Grit (ASR-10)
        const gritRow = document.createElement('div');
        gritRow.style.marginBottom = '10px';
        gritRow.style.display = 'flex';
        gritRow.style.alignItems = 'center';

        const gritCheck = document.createElement('input');
        gritCheck.type = 'checkbox';
        gritCheck.checked = voice.gritEnabled;
        gritCheck.style.marginRight = '10px';
        gritCheck.onchange = (e) => acm.samplerService.setPadGrit(padId, e.target.checked);

        const gritLabel = document.createElement('label');
        gritLabel.textContent = "ASR-10 'Grit' (12-bit)";
        gritLabel.style.fontSize = '0.9em';

        gritRow.append(gritCheck, gritLabel);
        dialog.appendChild(gritRow);

        // 2. Transwave
        const transRow = document.createElement('div');
        transRow.style.marginBottom = '10px';
        transRow.style.display = 'flex';
        transRow.style.alignItems = 'center';

        const transCheck = document.createElement('input');
        transCheck.type = 'checkbox';
        transCheck.checked = voice.transwaveEnabled;
        transCheck.style.marginRight = '10px';
        transCheck.onchange = (e) => acm.samplerService.setPadTranswave(padId, e.target.checked);

        const transLabel = document.createElement('label');
        transLabel.textContent = "Transwave Scanning";
        transLabel.style.fontSize = '0.9em';

        transRow.append(transCheck, transLabel);
        dialog.appendChild(transRow);

        // 3. Mic Profile
        const micRow = document.createElement('div');
        micRow.style.marginBottom = '10px';

        const micLabel = document.createElement('div');
        micLabel.textContent = "Microphone Profile:";
        micLabel.style.fontSize = '0.8em';
        micLabel.style.marginBottom = '3px';

        const micSelect = document.createElement('select');
        micSelect.style.width = '100%';
        micSelect.style.background = '#333';
        micSelect.style.color = 'white';
        micSelect.style.border = '1px solid #555';

        const profiles = [
            { id: 'none', label: 'Direct (No Profile)' },
            { id: 're15', label: 'EV RE-15 (Flat/D)' },
            { id: 'rca44', label: 'RCA 44 (Ribbon Warmth)' },
            { id: 'sm57', label: 'SM57 (Mid Presence)' }
        ];

        profiles.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.label;
            if (voice.micProfile === p.id) opt.selected = true;
            micSelect.appendChild(opt);
        });

        micSelect.onchange = (e) => acm.samplerService.setPadMicProfile(padId, e.target.value);

        micRow.append(micLabel, micSelect);
        dialog.appendChild(micRow);

        // 4. Synth Engine Profile
        const synthRow = document.createElement('div');
        synthRow.style.marginBottom = '10px';

        const synthLabel = document.createElement('div');
        synthLabel.textContent = "Synth Engine Profile:";
        synthLabel.style.fontSize = '0.8em';
        synthLabel.style.marginBottom = '3px';

        const synthSelect = document.createElement('select');
        synthSelect.style.width = '100%';
        synthSelect.style.background = '#333';
        synthSelect.style.color = 'white';
        synthSelect.style.border = '1px solid #555';

        const synthProfiles = [
            { id: 'none', label: 'Clean (Standard)' },
            { id: 'moog', label: 'Moog Modular (Ladder/Drive)' },
            { id: 'jupiter', label: 'Jupiter-8 (Ensemble Pads)' },
            { id: 'cs80', label: 'Yamaha CS-80 (Dual Filter)' },
            { id: 'fairlight', label: 'Fairlight CMI (8-bit Aliasing)' }
        ];

        synthProfiles.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.label;
            if (voice.synthProfile === p.id) opt.selected = true;
            synthSelect.appendChild(opt);
        });

        synthSelect.onchange = (e) => acm.samplerService.setPadSynthProfile(padId, e.target.value);

        synthRow.append(synthLabel, synthSelect);
        dialog.appendChild(synthRow);

        const closeBtn = document.createElement('button');
        closeBtn.textContent = "Close";
        closeBtn.style.marginTop = '15px';
        closeBtn.style.width = '100%';
        closeBtn.style.padding = '8px';
        closeBtn.style.background = '#444';
        closeBtn.style.color = 'white';
        closeBtn.style.border = 'none';
        closeBtn.style.cursor = 'pointer';
        closeBtn.onclick = () => dialog.remove();

        dialog.appendChild(closeBtn);
        document.body.appendChild(dialog);
        dialog.showModal();

        // Close on backdrop click
        dialog.addEventListener('click', (e) => {
            const rect = dialog.getBoundingClientRect();
            if (e.target === dialog) {
                dialog.remove();
            }
        });
    }

    /**
     * Sampler UI Initialization
     */
    function initSamplerUI() {
        const samplerBtns = document.querySelectorAll('.sample-btn');
        if (samplerBtns.length === 0) return;

        // Poll for AudioService and ACM availability
        const checkInterval = setInterval(() => {
            const acm = window.audioService?.contextManager;
            if (acm && acm.samplerService) {
                clearInterval(checkInterval);
                console.log("SamplerUI: Connecting to SamplerService...");

                samplerBtns.forEach(btn => {
                    const id = parseInt(btn.dataset.sample);
                    if (!id) return;

                    const trigger = (e) => {
                        // Shift + Click/Touch = Settings
                        if (e && (e.shiftKey || (e.touches && e.touches.length > 1))) {
                            if (e.shiftKey) {
                                showPadSettings(id, btn);
                                return;
                            }
                        }

                        acm.samplerService.triggerPad(id);
                        btn.classList.add('active');
                    };
                    const release = () => {
                        acm.samplerService.releasePad(id);
                        btn.classList.remove('active');
                    };

                    btn.addEventListener('mousedown', trigger);
                    btn.addEventListener('mouseup', release);
                    btn.addEventListener('mouseleave', release);

                    btn.addEventListener('touchstart', (e) => {
                        if (!e.shiftKey) {
                            e.preventDefault();
                            trigger(e);
                        }
                    });
                    btn.addEventListener('touchend', (e) => { e.preventDefault(); release(); });

                    btn.addEventListener('dragover', (e) => {
                        e.preventDefault();
                        btn.classList.add('drag-over');
                    });

                    btn.addEventListener('dragleave', () => {
                        btn.classList.remove('drag-over');
                    });

                    btn.addEventListener('drop', async (e) => {
                        e.preventDefault();
                        btn.classList.remove('drag-over');

                        let url, name;
                        try {
                            const jsonData = e.dataTransfer.getData('application/json');
                            if (jsonData) {
                                const data = JSON.parse(jsonData);
                                url = data.url;
                                name = data.filename;
                            }
                        } catch (err) { }

                        if (!url && e.dataTransfer.files.length > 0) {
                            const file = e.dataTransfer.files[0];
                            name = file.name;
                            url = URL.createObjectURL(file);
                        }

                        if (url) {
                            try {
                                await acm.samplerService.assignSample(id, url, name);
                                btn.title = name;
                                btn.classList.add('loaded');
                                btn.textContent = name.substring(0, 3).toUpperCase();
                                console.log(`Sampler: Assigned ${name} to Pad ${id}`);
                            } catch (err) {
                                console.error("Sampler Drop Error", err);
                            }
                        }
                    });
                });
            }
        }, 500);
    }

    // Export to window
    window.initSamplerUI = initSamplerUI;

    // Start Sampler Init on DOMReady
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSamplerUI);
    } else {
        initSamplerUI();
    }

})();

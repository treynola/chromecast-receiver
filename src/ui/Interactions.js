/**
 * Interactions.js
 * Handlers for UI interactions like Click, Input, Drag & Drop, and custom events.
 */
(function () {

    /**
     * Drag & Drop Logic for Tracks
     */
    function addDragDropListeners() {
        const trackElements = document.querySelectorAll('.track');
        trackElements.forEach(trackEl => {
            trackEl.addEventListener('dragover', e => {
                e.preventDefault();
                trackEl.classList.add('drag-over');
            });

            trackEl.addEventListener('dragleave', e => {
                trackEl.classList.remove('drag-over');
            });

            trackEl.addEventListener('drop', async e => {
                e.preventDefault();
                trackEl.classList.remove('drag-over');
                const trackId = parseInt(trackEl.dataset.trackIndex, 10);
                const track = window.tracks[trackId];

                if (!track) return;

                // 1. Internal JSON (from RecordingUI / Sidebar)
                try {
                    const jsonData = e.dataTransfer.getData('application/json');
                    if (jsonData) {
                        const data = JSON.parse(jsonData);
                        if (data.url) {
                            track.setStatus('Loading...');
                            try {
                                await track.trackAudio.loadUrl(data.url);
                                track.setStatus('Ready', 'ready');
                                track.updateFileLabel(data.filename);
                                track.state.hasContent = true;
                                track.elements.playBtn.disabled = false;
                                track.resetLoopPoints();
                            } catch (error) {
                                console.error('Error importing file:', error);
                                track.setStatus('Error', 'error');
                            }
                        }
                        return;
                    }
                } catch (error) { /* ignore */ }

                // 2. External Files / Directories
                const items = e.dataTransfer.items;
                if (items && items.length > 0) {
                    const item = items[0];
                    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : (item.getAsEntry ? item.getAsEntry() : null);

                    if (entry) {
                        if (entry.isFile) {
                            const file = e.dataTransfer.files[0];
                            track.setStatus('Loading...');
                            try {
                                const url = URL.createObjectURL(file);
                                await track.trackAudio.loadUrl(url);
                                track.setStatus('Ready', 'ready');
                                track.updateFileLabel(file.name);
                                track.state.hasContent = true;
                                track.elements.playBtn.disabled = false;
                                track.resetLoopPoints();
                            } catch (error) {
                                track.setStatus('Error', 'error');
                            }
                        } else if (entry.isDirectory) {
                            track.setStatus('Scanning...', 'warn');
                            try {
                                const files = [];
                                await window.scanDirectoryWeb(entry, '', files);
                                if (files.length > 0) {
                                    window.showAudioFilesModal(files, track);
                                    track.setStatus('Select File', 'ready');
                                } else {
                                    alert("No audio files found in directory.");
                                    track.setStatus('Empty Dir', 'error');
                                }
                            } catch (error) {
                                track.setStatus('Scan Error', 'error');
                            }
                        }
                    }
                }
            });
        });
    }

    /**
     * Main Click Listener for Track Actions
     */
    document.addEventListener('DOMContentLoaded', () => {
        const container = document.querySelector('.container');
        if (!container) return;

        container.addEventListener('click', async (e) => {
            const target = e.target;
            
            // --- GLOBAL HEADER BUTTONS EXEMPTION ---
            const headerBtn = target.closest('#show-sessions-button, #import-files-button, #show-docs-button, #cast-btn');
            if (headerBtn) {
                console.log(`Interactions: Global header button clicked: ${headerBtn.id}`);
                // Docs Button Fallback (if DocsUI.js isn't ready)
                if (headerBtn.id === 'show-docs-button') {
                    const docsDialog = document.getElementById('docs-dialog');
                    if (docsDialog && !docsDialog.open) {
                        docsDialog.showModal();
                        if (window.docsContent) {
                            const pre = docsDialog.querySelector('pre');
                            if (pre) pre.innerHTML = window.docsContent;
                        }
                    }
                }
                return; // Let other listeners handle it, but don't return early and stop bubbles
            }

            const trackDiv = target.closest('.track');
            if (!trackDiv) return;

            const trackId = parseInt(trackDiv.dataset.trackIndex, 10);
            const track = window.tracks[trackId];
            if (!track) return;

            if (target.dataset.action) {
                const action = target.dataset.action;

                if (action === 'play') {
                    if (track.state.isPlaying) {
                        // PAUSE logic
                        const now = Tone.now();
                        const loopStart = track.trackAudio.player.loopStart || 0;
                        const loopEnd = track.trackAudio.player.loopEnd || track.trackAudio.player.buffer?.duration || 0;
                        const loopDuration = loopEnd - loopStart;

                        if (loopDuration > 0) {
                            const rate = track.trackAudio.player.playbackRate;
                            const startTime = track.playStartTime || 0;
                            const startOffset = track.state.pausePosition || loopStart;
                            const elapsed = (now - startTime) * rate;
                            const relStart = startOffset - loopStart;
                            let relPos = (relStart + elapsed) % loopDuration;
                            track.state.pausePosition = loopStart + relPos;
                        } else {
                            track.state.pausePosition = track.trackAudio.getCurrentPosition();
                        }

                        track.trackAudio.stopPlayback();
                        track.state.isPlaying = false;
                        target.classList.remove('playing');
                    } else {
                        // START logic
                        if (Tone.context.state !== 'running') await Tone.start();
                        const offset = track.state.pausePosition;
                        track.trackAudio.startPlayback(offset);
                        track.playStartTime = Tone.now();
                        track.state.isPlaying = true;
                        target.classList.add('playing');
                    }
                }
                else if (action === 'stop') {
                    // Triple stop detect for clear
                    const now = Date.now();
                    track.state.stopClickCount = (track.state.stopClickCount || 0);
                    if (now - (track.state.lastStopClickTime || 0) < 400) {
                        track.state.stopClickCount++;
                    } else {
                        track.state.stopClickCount = 1;
                    }
                    track.state.lastStopClickTime = now;

                    if (track.state.stopClickCount >= 4) {
                        if (confirm(`Clear Track ${trackId + 1}?`)) {
                            if (track.trackAudio && track.trackAudio.player) track.trackAudio.player.buffer = null;
                            track.updateFileLabel('');
                            track.resetLoopPoints();
                            track.state.hasContent = false;
                            track.state.isPlaying = false;
                            track.state.isRecording = false;
                            track.elements.playBtn.disabled = true;
                            track.elements.playBtn.classList.remove('playing');
                            track.elements.recBtn.classList.remove('recording');
                        }
                        track.state.stopClickCount = 0;
                        return;
                    }

                    track.trackAudio.stopPlayback();
                    track.state.isPlaying = false;
                    track.state.pausePosition = 0;
                    track.elements.playBtn.classList.remove('playing');
                }
                else if (action === 'record') {
                    if (track.state.isRecording) {
                        await stopTrackRecording(trackId, target);
                    } else {
                        await startTrackRecording(trackId, target);
                    }
                }
                else if (action === 'reverse') {
                    const isReverse = !target.classList.contains('active');
                    if (isReverse) target.classList.add('active');
                    else target.classList.remove('active');
                    if (track.trackAudio && track.trackAudio.player) {
                        track.trackAudio.player.reverse = isReverse;
                    }
                }
                else if (action === 'toggle-monitor') {
                    if (track.trackAudio) track.trackAudio.setMonitor(target.checked);
                }
                else if (action === 'close-effect-dialog' || action === 'close-audition-dialog') {
                    const dialog = target.closest('dialog');
                    if (dialog) dialog.close();
                }
            }

            // Label clicks for FX
            if (target.classList.contains('fx-chain-slot-label')) {
                const slotIndex = parseInt(target.dataset.slotLabelIndex, 10);
                const checkbox = trackDiv.querySelector(`#fx-slot-${trackId}-${slotIndex}`);

                if (e.detail === 4) {
                    track.trackAudio.removeEffect(slotIndex);
                    if (checkbox) checkbox.checked = false;
                    target.textContent = (slotIndex + 1).toString();
                    if (track.state.effectsChain) track.state.effectsChain[slotIndex] = null;
                    return;
                }

                if (checkbox && checkbox.checked) {
                    const dialog = trackDiv.querySelector(`#effect-dialog-${trackId}-${slotIndex}`);
                    if (dialog) {
                        if (!dialog.open) dialog.showModal();
                    }
                } else if (track.state.auditioningEffect) {
                    window.assignEffectToSlot(trackId, slotIndex, track.state.auditioningEffect, trackDiv, track, false);
                }
            }

            // LFO assignment
            if (target.classList.contains('lfo-assign')) {
                const isChecked = target.checked;
                const paramName = target.dataset.lfoAssign;
                const lfoIndex = parseInt(target.dataset.lfoIndex, 10);
                const track = window.tracks[trackId];
                if (!track) return;

                if (isChecked) {
                    const otherIndex = lfoIndex === 1 ? 2 : 1;
                    const existing = track.trackAudio.lfoConnections.get(paramName);
                    if (existing) {
                        track.trackAudio.disconnectLFO(paramName);
                        const otherCb = trackDiv.querySelector(`.lfo-assign[data-lfo-assign="${paramName}"][data-lfo-index="${otherIndex}"]`);
                        if (otherCb) { otherCb.checked = false; otherCb.classList.remove('reversed'); }
                    }

                    const slider = trackDiv.querySelector(`input[data-param="${paramName}"]`);
                    const min = slider ? parseFloat(slider.min) : 0;
                    const max = slider ? parseFloat(slider.max) : 1;
                    const presetsMin = lfoIndex === 1 ? track.state.lfo1MinPresets : track.state.lfo2MinPresets;
                    const presetsMax = lfoIndex === 1 ? track.state.lfo1MaxPresets : track.state.lfo2MaxPresets;
                    const pMin = presetsMin[paramName] ?? min;
                    const pMax = presetsMax[paramName] ?? max;

                    if (track.elements.minMarkers[paramName]) {
                        track.elements.minMarkers[paramName].style.display = 'block';
                        track.elements.minMarkers[paramName].style.left = ((pMin - min) / (max - min) * 100) + '%';
                    }
                    if (track.elements.maxMarkers[paramName]) {
                        track.elements.maxMarkers[paramName].style.display = 'block';
                        track.elements.maxMarkers[paramName].style.left = ((pMax - min) / (max - min) * 100) + '%';
                    }
                    track.trackAudio.connectLFO(paramName, pMin, pMax, lfoIndex);
                } else {
                    track.trackAudio.disconnectLFO(paramName);
                    if (track.elements.minMarkers[paramName]) track.elements.minMarkers[paramName].style.display = 'none';
                    if (track.elements.maxMarkers[paramName]) track.elements.maxMarkers[paramName].style.display = 'none';
                }
            }
        });

        // Double click for LFO reverse
        container.addEventListener('dblclick', (e) => {
            const target = e.target;
            if (target.classList.contains('lfo-assign')) {
                const trackDiv = target.closest('.track');
                const trackId = parseInt(trackDiv.dataset.trackIndex, 10);
                const paramName = target.dataset.lfoAssign;
                const lfoIndex = parseInt(target.dataset.lfoIndex, 10);
                const track = window.tracks[trackId];
                if (!track) return;

                const conn = track.trackAudio.lfoConnections.get(paramName);
                if (conn) {
                    const oldMin = conn.scale.min;
                    const oldMax = conn.scale.max;
                    conn.scale.min = oldMax;
                    conn.scale.max = oldMin;
                    conn.min = oldMax;
                    conn.max = oldMin;

                    const mapName = lfoIndex === 1 ? 'lfo1' : 'lfo2';
                    track.state[`${mapName}MinPresets`][paramName] = oldMax;
                    track.state[`${mapName}MaxPresets`][paramName] = oldMin;
                    target.classList.toggle('reversed');
                }
            }
        });

        // Input handling
        window.addEventListener('input', (e) => {
            const target = e.target;
            const trackDiv = target.closest('.track');
            if (!trackDiv) return;
            const trackId = parseInt(trackDiv.dataset.trackIndex, 10);
            const track = window.tracks[trackId];

            if (target.dataset.param) {
                const param = target.dataset.param;
                const val = parseFloat(target.value);
                
                if (param === 'loopStart' || param === 'loopEnd') {
                    if (param === 'loopStart') track.trackAudio.setLoopStart(val);
                    else track.trackAudio.setLoopEnd(val);
                } else if (param === 'playbackRate' || param === 'pitch') {
                    track.trackAudio.setPitch(val);
                } else if (param === 'volume' || param === 'vol') {
                    track.trackAudio.setVolume(val);
                } else if (param === 'pan') {
                    track.trackAudio.setPan(val);
                } else if (param === 'treble') {
                    track.trackAudio.setEQ({ treble: val });
                } else if (param === 'mid_gain') {
                    track.trackAudio.setEQ({ mid: val });
                } else if (param === 'mid_freq') {
                    track.trackAudio.setEQ({ midFreq: val });
                } else if (param === 'bass') {
                    track.trackAudio.setEQ({ bass: val });
                } else {
                    console.warn(`Unknown parameter update: ${param}`);
                }

                if (track.elements.valueDisplays[param]) {
                    const unit = (param === 'loopStart' || param === 'loopEnd') ? 's' : '';
                    track.elements.valueDisplays[param].textContent = val.toFixed(2) + unit;
                }
            }
        });

        // Change handling (Source Select & Effects)
        container.addEventListener('change', async (e) => {
            const target = e.target;
            const trackDiv = target.closest('.track');
            if (!trackDiv) return;
            const trackId = parseInt(trackDiv.dataset.trackIndex, 10);
            const track = window.tracks[trackId];

            if (target.dataset.action === 'select-input') {
                const value = target.value;

                if (value === 'file') {
                    target.value = 'mic';
                    setTimeout(() => window.handleFileImport(track), 100);
                } else if (value === 'directory') {
                    target.value = 'mic';
                    window.handleDirectorySelect(track);
                } else if (value === 'system') {
                    // System audio capture logic...
                } else {
                    // Standard device selection (Microphone, BlackHole, Aggregate, etc.)
                    const isStereo = value !== 'default' && value !== 'mic';
                    try {
                        console.log(`Interactions: Switching Track ${trackId} input to device: ${value}`);
                        await track.trackAudio.connectInput('mic', value, { isStereo });
                        track.setStatus('Input Connected', 'ready');
                        if (window.PersistenceService && window.PersistenceService.setInputDeviceId) {
                            window.PersistenceService.setInputDeviceId(value);
                        }
                    } catch (err) {
                        console.error(`Interactions: Failed to connect device ${value}:`, err);
                        track.setStatus('Input Error', 'error');
                    }
                }
            }

            // --- Effect Selection (Audition-First Workflow) ---
            if (target.classList.contains('effect-type-select')) {
                const effectName = target.value;

                if (effectName === 'none') {
                    track.trackAudio.removeAuditioningEffect();
                    if (track.elements.auditionDialog) {
                        track.elements.auditionDialog.close();
                    }
                    track.state.auditioningEffect = null;
                    return;
                }

                let config = null;
                if (window.effectConfigs) {
                    for (const cat in window.effectConfigs) {
                        if (window.effectConfigs[cat][effectName]) {
                            config = window.effectConfigs[cat][effectName];
                            break;
                        }
                    }
                }

                if (!config) {
                    console.error(`No config found for effect: ${effectName}`);
                    target.value = 'none';
                    return;
                }

                try {
                    const paramValues = {};
                    config.columns.flat().forEach(p => {
                        paramValues[p.p] = p.def;
                    });
                    if (paramValues.mix === undefined) paramValues.mix = 0.5;

                    const instance = track.trackAudio.setAuditioningEffect(effectName, paramValues);
                    if (!instance) {
                        target.value = 'none';
                        return;
                    }

                    track.state.auditioningEffect = {
                        name: effectName,
                        config,
                        instance,
                        paramValues,
                        enabled: true
                    };

                    const dialogContent = track.elements.auditionDialog.querySelector('.audition-dialog-content');
                    // Set title to "AUDITION: Effect Name"
                    const headerTitle = track.elements.auditionDialog.querySelector('.dialog-header span');
                    if (headerTitle) headerTitle.textContent = `AUDITION: ${effectName}`;
                    if (dialogContent) {
                        dialogContent.innerHTML = '';

                        // Slot assignment buttons
                        const slotArea = document.createElement('div');
                        slotArea.className = 'audition-slot-selector';
                        slotArea.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 0 10px 0;grid-column:1/-1;';
                        const label = document.createElement('span');
                        label.textContent = 'Assign to Slot:';
                        label.style.cssText = 'font-size:0.85em;font-weight:bold;color:var(--gold);';
                        slotArea.appendChild(label);
                        const slotGroup = document.createElement('div');
                        slotGroup.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
                        for (let s = 0; s < 7; s++) {
                            const btn = document.createElement('button');
                            btn.textContent = (s + 1).toString();
                            btn.style.cssText = 'padding:4px 8px;cursor:pointer;background:#444;border:1px solid var(--gold);color:var(--gold);border-radius:3px;';
                            btn.addEventListener('click', () => {
                                if (window.assignEffectToSlot) {
                                    const trackId = parseInt(trackDiv.dataset.trackIndex, 10);
                                    window.assignEffectToSlot(trackId, s, track.state.auditioningEffect, trackDiv, track, true);
                                }
                            });
                            slotGroup.appendChild(btn);
                        }
                        slotArea.appendChild(slotGroup);
                        dialogContent.appendChild(slotArea);

                        // Render effect params
                        if (window.renderEffectParams) {
                            window.renderEffectParams(dialogContent, config, paramValues, (pName, val) => {
                                track.trackAudio.updateEffect(-1, { [pName]: val });
                                if (track.state.auditioningEffect) {
                                    track.state.auditioningEffect.paramValues[pName] = val;
                                }
                            });
                        }
                        track.elements.auditionDialog.showModal();
                        // Reset dropdown with slight delay to prevent re-triggering 'none' logic immediately
                        setTimeout(() => { target.value = 'none'; }, 50);
                    }
                } catch (error) {
                    console.error(`Failed to create audition effect: ${effectName}`, error);
                    target.value = 'none';
                }
            }
        });
    });

    // Global Loopback Gain
    document.addEventListener('DOMContentLoaded', () => {
        const gainSlider = document.getElementById('global-bh-gain');
        const gainLabel = document.getElementById('global-bh-gain-label');
        if (gainSlider) {
            gainSlider.addEventListener('input', function () {
                const gain = parseFloat(this.value);
                if (window.audioEngine?.audioRouter) {
                    window.audioEngine.audioRouter.setLoopbackGain(gain);
                }
                if (gainLabel) gainLabel.textContent = `${gain} dB`;
            });
        }
    });

    /**
     * Recording Functions
     */
    async function startTrackRecording(trackId, btn) {
        const track = window.tracks[trackId];
        try {
            if (Tone.context.state !== 'running') await Tone.start();
            const durationInput = document.getElementById('loop-length');
            const duration = durationInput ? parseFloat(durationInput.value) : 3.6;

            await track.trackAudio.startRecording(duration);
            track.state.isRecording = true;
            btn.classList.add('recording');
            track.setStatus('Recording...', 'recording');

            if (track.trackAudio.recorder) {
                track.trackAudio.recorder.onComplete = () => {
                    if (track.state.isRecording) stopTrackRecording(trackId, btn);
                };
            }
        } catch (error) {
            console.error("Recording failed", error);
        }
    }

    async function stopTrackRecording(trackId, btn) {
        const track = window.tracks[trackId];
        try {
            const blob = await track.trackAudio.stopRecording();
            track.state.isRecording = false;
            btn.classList.remove('recording');

            if (blob && blob.size > 0) {
                const now = new Date();
                const name = `loop_${now.getHours()}-${now.getMinutes()}-${now.getSeconds()}.wav`;
                if (window.recordingUI) window.recordingUI.addRecording(blob, name);

                const url = URL.createObjectURL(blob);
                await track.trackAudio.loadUrl(url);
                track.state.hasContent = true;
                track.elements.playBtn.disabled = false;
                track.setStatus('Ready', 'ready');
                track.updateFileLabel(name);
            }
        } catch (error) {
            console.error('Stop recording failed:', error);
        }
    }

    // --- Custom LOOP SLICING Handling ---
    window.addEventListener('slice-loop-request', async (e) => {
        // ... (existing implementation)
    });

    // --- Master Recording Logic ---
    document.addEventListener('DOMContentLoaded', () => {
        const masterRecBtn = document.getElementById('master-record-button');
        const recordFormatSelect = document.getElementById('record-as-select');
        window.isMasterMeditation = false;

        if (masterRecBtn) {
            masterRecBtn.addEventListener('click', async () => {
                const mode = recordFormatSelect.value;
                const option = recordFormatSelect.options[recordFormatSelect.selectedIndex];
                const format = option.dataset.format || 'wav';

                if (!window.isMasterMeditation) {
                    if (Tone.context.state !== 'running') await Tone.start();
                    if (mode === 'stems') {
                        if (window.audioEngine) window.audioEngine.startStemsRecording();
                    } else {
                        if (window.audioEngine) window.audioEngine.startMasterRecording(format);
                    }
                    window.isMasterMeditation = true;
                    masterRecBtn.textContent = "STOP";
                    masterRecBtn.classList.add('recording');
                    masterRecBtn.style.backgroundColor = "white";
                    masterRecBtn.style.color = "red";
                } else {
                    masterRecBtn.textContent = "Processing...";
                    if (mode === 'stems') {
                        const stems = await window.audioEngine?.stopStemsRecording() || [];
                        for (const stem of stems) {
                            if (stem.blob) {
                                let blob = stem.blob;
                                let ext = 'webm';
                                if (format === 'wav' && window.AudioUtils?.blobToWav) {
                                    blob = await window.AudioUtils.blobToWav(blob);
                                    ext = 'wav';
                                }
                                downloadBlob(blob, `Stem_Track_${stem.id + 1}_${Date.now()}.${ext}`);
                            }
                        }
                    } else {
                        let blob = await window.audioEngine?.stopMasterRecording();
                        if (!blob) return;
                        let ext = 'webm';
                        if (format === 'wav' && window.AudioUtils?.blobToWav) {
                            blob = await window.AudioUtils.blobToWav(blob);
                            ext = 'wav';
                        } else if (format === 'mp4') ext = 'mp4';
                        else if (format === 'alac') ext = 'm4a';

                        const filename = `Master_Mix_${Date.now()}.${ext}`;
                        if (window.recordingUI) {
                            window.recordingUI.addRecording(blob, filename);
                        } else {
                            downloadBlob(blob, filename);
                        }
                    }
                    window.isMasterMeditation = false;
                    masterRecBtn.textContent = "REC";
                    masterRecBtn.classList.remove('recording');
                    masterRecBtn.style.backgroundColor = "var(--red)";
                    masterRecBtn.style.color = "white";
                }
            });
        }

        // Global LFO Controls
        const lfo1Slider = document.getElementById('lfo-time');
        const lfo1Val = document.getElementById('lfo-time-value');
        if (lfo1Slider) {
            lfo1Slider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                if (lfo1Val) lfo1Val.textContent = `${val}s`;
                const lfo = window.audioEngine?.getLfo(1);
                if (lfo) lfo.frequency.value = 1 / val;
            });
        }

        const lfo2Slider = document.getElementById('lfo2-time');
        const lfo2Val = document.getElementById('lfo2-time-value');
        if (lfo2Slider) {
            lfo2Slider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                if (lfo2Val) lfo2Val.textContent = `${val}s`;
                const lfo = window.audioEngine?.getLfo(2);
                if (lfo) lfo.frequency.value = 1 / val;
            });
        }

        const lfo1Toggle = document.getElementById('lfo-toggle');
        if (lfo1Toggle) {
            // Sync initial state — LFOs are started in AudioContextManager.init()
            const lfo1State = window.audioEngine?.getLfo(1);
            if (lfo1State && lfo1State.state === 'started') lfo1Toggle.classList.add('active');
            lfo1Toggle.onclick = () => {
                const active = window.audioEngine?.toggleLfo(1);
                lfo1Toggle.classList.toggle('active', active);
            };
        }

        const lfo2Toggle = document.getElementById('lfo2-toggle');
        if (lfo2Toggle) {
            const lfo2State = window.audioEngine?.getLfo(2);
            if (lfo2State && lfo2State.state === 'started') lfo2Toggle.classList.add('active');
            lfo2Toggle.onclick = () => {
                const active = window.audioEngine?.toggleLfo(2);
                lfo2Toggle.classList.toggle('active', active);
            };
        }

    });
    
    // Global Header Buttons (Media, Import, Docs)
    document.addEventListener('DOMContentLoaded', () => {
        const mediaBtn = document.getElementById('show-sessions-button');
        const importBtn = document.getElementById('import-files-button');
        const docsBtn = document.getElementById('show-docs-button');
        
        const sessionsDialog = document.getElementById('sessions-dialog');
        const docsDialog = document.getElementById('docs-dialog');
        
        if (mediaBtn && sessionsDialog) {
            mediaBtn.addEventListener('click', () => {
                if (typeof sessionsDialog.showModal === 'function') {
                    sessionsDialog.showModal();
                } else {
                    sessionsDialog.setAttribute('open', '');
                }
            });
        }

        // Close button for sessions dialog
        const closeSessionsBtn = document.getElementById('close-sessions-button');
        if (closeSessionsBtn && sessionsDialog) {
            closeSessionsBtn.addEventListener('click', () => {
                if (typeof sessionsDialog.close === 'function') {
                    sessionsDialog.close();
                } else {
                    sessionsDialog.removeAttribute('open');
                }
            });
        }
        
        if (importBtn) {
            importBtn.addEventListener('click', async () => {
                if (window.__TAURI__) {
                    try {
                        const selected = await window.__TAURI__.dialog.open({
                            multiple: false,
                            filters: [{
                                name: 'Audio',
                                extensions: ['wav', 'mp3', 'flac', 'ogg', 'aac', 'm4a', 'mp4']
                            }]
                        });
                        if (selected) {
                            const name = selected.split(/[\\/]/).pop();
                            // Add to Sessions & Media list
                            if (window.recordingUI) {
                                const assetUrl = window.__TAURI__.core?.convertFileSrc
                                    ? window.__TAURI__.core.convertFileSrc(selected)
                                    : `asset://localhost/${encodeURIComponent(selected)}`;
                                window.recordingUI.addRecording(assetUrl, name, selected);
                            }
                            // Also open Sessions dialog so user sees the import
                            const sd = document.getElementById('sessions-dialog');
                            if (sd && typeof sd.showModal === 'function' && !sd.open) sd.showModal();
                        }
                    } catch (e) {
                        console.error('Import error:', e);
                    }
                } else if (window.handleFileImport) {
                    const globalInput = document.getElementById('global-file-input');
                    if (globalInput) globalInput.click();
                }
            });
        }

        // Failsafe for docs backdrop (if DocsUI.js missed it)
        if (docsDialog) {
            docsDialog.addEventListener('click', (e) => {
                const rect = docsDialog.getBoundingClientRect();
                const isInDialog = (rect.top <= e.clientY && e.clientY <= rect.top + rect.height && rect.left <= e.clientX && e.clientX <= rect.left + rect.width);
                if (!isInDialog) docsDialog.close();
            });
        }
    });

    document.addEventListener('DOMContentLoaded', () => {
        const masterVol = document.getElementById('master-volume');
        const masterVolVal = document.getElementById('master-volume-value');
        if (masterVol) {
            masterVol.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                if (masterVolVal) masterVolVal.textContent = `${val.toFixed(1)} dB`;
                if (window.audioEngine) {
                    window.audioEngine.setMasterVolume(val);
                }
            });
        }
    });

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // Export
    window.addDragDropListeners = addDragDropListeners;
    window.startTrackRecording = startTrackRecording;
    window.stopTrackRecording = stopTrackRecording;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(addDragDropListeners, 500));
    } else {
        setTimeout(addDragDropListeners, 500);
    }

})();

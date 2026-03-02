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
                                await window.audioService.loadFileToTrack(trackId, data.url);
                                track.setStatus('Ready', 'ready');
                                track.updateFileLabel(data.filename);
                                track.state.hasContent = true;
                                track.elements.playBtn.disabled = false;
                                track.resetLoopPoints();
                            } catch (err) {
                                console.error("Drop Load Error", err);
                                track.setStatus('Error', 'error');
                            }
                        }
                        return;
                    }
                } catch (e) { /* ignore */ }

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
                                await window.audioService.loadFileToTrack(trackId, url);
                                track.setStatus('Ready', 'ready');
                                track.updateFileLabel(file.name);
                                track.state.hasContent = true;
                                track.elements.playBtn.disabled = false;
                                track.resetLoopPoints();
                            } catch (err) {
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
                            } catch (err) {
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
                        const loopStart = window.audioService.getTrackLoopStart(trackId);
                        const loopEnd = window.audioService.getTrackLoopEnd(trackId);
                        const loopDuration = loopEnd - loopStart;

                        if (loopDuration > 0) {
                            const rate = window.audioService.getTrackPlaybackRate(trackId);
                            const startTime = window.audioService.getTrackPlayStartTime(trackId);
                            const startOffset = track.state.pausePosition || loopStart;
                            const elapsed = (now - startTime) * rate;
                            const relStart = startOffset - loopStart;
                            let relPos = (relStart + elapsed) % loopDuration;
                            track.state.pausePosition = loopStart + relPos;
                        } else {
                            track.state.pausePosition = window.audioService.getTrackPosition(trackId);
                        }

                        window.audioService.stopPlayback(trackId);
                        track.state.isPlaying = false;
                        target.classList.remove('playing');
                    } else {
                        // START logic
                        if (Tone.context.state !== 'running') await Tone.start();
                        const offset = track.state.pausePosition;
                        window.audioService.startPlayback(trackId, offset);
                        window.audioService.setTrackPlayStartTime(trackId, Tone.now());
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
                            await window.audioService.clearTrack(trackId);
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

                    window.audioService.stopPlayback(trackId);
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
                    window.audioService.setTrackReverse(trackId, isReverse);
                }
                else if (action === 'toggle-monitor') {
                    const audioTrack = window.audioService.tracks.get(trackId);
                    if (audioTrack) audioTrack.setMonitor(target.checked);
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
                    window.audioService.removeEffect(trackId, slotIndex);
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
                const audioTrack = window.audioService.tracks.get(trackId);
                if (!audioTrack) return;

                if (isChecked) {
                    const otherIndex = lfoIndex === 1 ? 2 : 1;
                    const existing = audioTrack.lfoConnections.get(paramName);
                    if (existing) {
                        window.audioService.removeLfoFromParameter(trackId, paramName);
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
                    window.audioService.assignLfoToParameter(trackId, paramName, pMin, pMax, lfoIndex);
                } else {
                    window.audioService.removeLfoFromParameter(trackId, paramName);
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
                const audioTrack = window.audioService.tracks.get(trackId);
                if (!audioTrack) return;

                const conn = audioTrack.lfoConnections.get(paramName);
                if (conn) {
                    const oldMin = conn.lfoScale.min;
                    const oldMax = conn.lfoScale.max;
                    conn.lfoScale.min = oldMax;
                    conn.lfoScale.max = oldMin;
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
        container.addEventListener('input', (e) => {
            const target = e.target;
            const trackDiv = target.closest('.track');
            if (!trackDiv) return;
            const trackId = parseInt(trackDiv.dataset.trackIndex, 10);
            const track = window.tracks[trackId];

            if (target.dataset.param) {
                const param = target.dataset.param;
                const val = parseFloat(target.value);
                
                if (param === 'loopStart' || param === 'loopEnd') {
                    const dur = window.audioService.getTrackDuration(trackId);
                    if (param === 'loopStart') window.audioService.setTrackLoopStart(trackId, val);
                    else window.audioService.setTrackLoopEnd(trackId, val);
                } else if (param === 'playbackRate' || param === 'pitch') {
                    window.audioService.setTrackPlaybackRate(trackId, val);
                } else if (param === 'volume' || param === 'vol') {
                    window.audioService.setTrackVolume(trackId, val);
                } else if (param === 'pan') {
                    window.audioService.setTrackPan(trackId, val);
                } else {
                    console.warn(`Unknown parameter update: ${param}`);
                }

                if (track.elements.valueDisplays[param]) {
                    const unit = (param === 'loopStart' || param === 'loopEnd') ? 's' : '';
                    track.elements.valueDisplays[param].textContent = val.toFixed(2) + unit;
                }
            }
        });

        // Change handling (Source Select)
        container.addEventListener('change', (e) => {
            if (e.target.dataset.action === 'select-input') {
                const trackDiv = e.target.closest('.track');
                const trackId = parseInt(trackDiv.dataset.trackIndex, 10);
                const track = window.tracks[trackId];
                const value = e.target.value;

                if (value === 'file') {
                    e.target.value = 'mic';
                    setTimeout(() => window.handleFileImport(track), 100);
                } else if (value === 'directory') {
                    e.target.value = 'mic';
                    window.handleDirectorySelect(track);
                } else if (value === 'system') {
                    // System audio capture logic...
                } else {
                    // Standard device selection logic...
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
                if (window.audioService?.audioRouter) {
                    window.audioService.audioRouter.setLoopbackGain(gain);
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

            await window.audioService.startRecording(trackId, duration);
            track.state.isRecording = true;
            btn.classList.add('recording');
            track.setStatus('Recording...', 'recording');

            const audioTrack = window.audioService.tracks.get(trackId);
            if (audioTrack?.recorder) {
                audioTrack.recorder.onComplete = () => {
                    if (track.state.isRecording) stopTrackRecording(trackId, btn);
                };
            }
        } catch (err) {
            console.error("Recording failed", err);
        }
    }

    async function stopTrackRecording(trackId, btn) {
        const track = window.tracks[trackId];
        try {
            const blob = await window.audioService.stopRecording(trackId);
            track.state.isRecording = false;
            btn.classList.remove('recording');

            if (blob && blob.size > 0) {
                const now = new Date();
                const name = `loop_${now.getHours()}-${now.getMinutes()}-${now.getSeconds()}.wav`;
                if (window.recordingUI) window.recordingUI.addRecording(blob, name);

                const url = URL.createObjectURL(blob);
                await window.audioService.loadFileToTrack(trackId, url);
                track.state.hasContent = true;
                track.elements.playBtn.disabled = false;
                track.setStatus('Ready', 'ready');
                track.updateFileLabel(name);
            }
        } catch (err) {
            console.error("Stop recording failed", err);
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
                        await window.audioService.startStemsRecording();
                    } else {
                        await window.audioService.startMasterRecording(format);
                    }
                    window.isMasterMeditation = true;
                    masterRecBtn.textContent = "STOP";
                    masterRecBtn.classList.add('recording');
                    masterRecBtn.style.backgroundColor = "white";
                    masterRecBtn.style.color = "red";
                } else {
                    masterRecBtn.textContent = "Processing...";
                    if (mode === 'stems') {
                        const stems = await window.audioService.stopStemsRecording();
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
                        let blob = await window.audioService.stopMasterRecording();
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
                const lfo = window.audioService.getLfo(1);
                if (lfo) lfo.frequency.value = 1 / val;
            });
        }

        const lfo2Slider = document.getElementById('lfo2-time');
        const lfo2Val = document.getElementById('lfo2-time-value');
        if (lfo2Slider) {
            lfo2Slider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                if (lfo2Val) lfo2Val.textContent = `${val}s`;
                const lfo = window.audioService.getLfo(2);
                if (lfo) lfo.frequency.value = 1 / val;
            });
        }

        const lfo1Toggle = document.getElementById('lfo-toggle');
        if (lfo1Toggle) {
            lfo1Toggle.onclick = () => {
                const active = window.audioService.toggleLfo(1);
                lfo1Toggle.classList.toggle('active', active);
            };
        }

        const lfo2Toggle = document.getElementById('lfo2-toggle');
        if (lfo2Toggle) {
            lfo2Toggle.onclick = () => {
                const active = window.audioService.toggleLfo(2);
                lfo2Toggle.classList.toggle('active', active);
            };
        }

        const masterVol = document.getElementById('master-volume');
        const masterVolVal = document.getElementById('master-volume-value');
        if (masterVol) {
            masterVol.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                if (masterVolVal) masterVolVal.textContent = `${val.toFixed(1)} dB`;
                window.audioService.setMasterVolume(val);
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

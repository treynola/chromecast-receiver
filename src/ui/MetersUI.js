/**
 * MetersUI.js
 * Manages master and track meters, waveforms, and time displays.
 * Includes LFO marker dragging logic.
 */
(function () {

    let lastLfoFrameTime = 0;
    let lfoPhase1 = 0;
    let lfoPhase2 = 0;
    let activeDrag = { marker: null, track: null, param: null, type: null };

    /**
     * Main animation loop for updating meters and waveforms.
     */
    function updateMeters() {
        // --- Context Reliability ---
        if (Tone.context.state !== 'running' && (Tone.now() > 0)) {
            const resumeOverlay = document.getElementById('resume-audio-overlay');
            if (resumeOverlay) {
                resumeOverlay.style.display = (Tone.context.state === 'suspended') ? 'flex' : 'none';
            }
        } else {
            const resumeOverlay = document.getElementById('resume-audio-overlay');
            if (resumeOverlay) resumeOverlay.style.display = 'none';
        }

        // --- Visual Hibernation ---
        if (!document.hasFocus()) {
            requestAnimationFrame(updateMeters);
            return;
        }

        // --- Throttling (~15fps for UI) ---
        window.meterFrameCount = (window.meterFrameCount || 0) + 1;
        if (window.meterFrameCount % 4 !== 0) {
            requestAnimationFrame(updateMeters);
            return;
        }

        const now = Tone.now();
        const deltaTime = lastLfoFrameTime === 0 ? 0 : now - lastLfoFrameTime;
        lastLfoFrameTime = now;

        const lfo1Enabled = window.audioService.isLfoEnabled(1);
        const lfo2Enabled = window.audioService.isLfoEnabled(2);

        let visualLfo1 = 0;
        let visualLfo2 = 0;

        if (lfo1Enabled) {
            const lfoNode = window.audioService.getLfo(1);
            if (lfoNode) {
                const freq = lfoNode.frequency.value;
                lfoPhase1 += 2 * Math.PI * freq * deltaTime;
                if (lfoPhase1 > 2 * Math.PI) lfoPhase1 -= 2 * Math.PI;
                visualLfo1 = Math.sin(lfoPhase1);
            }
        } else {
            lfoPhase1 = 0;
        }

        if (lfo2Enabled) {
            const lfoNode = window.audioService.getLfo(2);
            if (lfoNode) {
                const freq = lfoNode.frequency.value;
                lfoPhase2 += 2 * Math.PI * freq * deltaTime;
                if (lfoPhase2 > 2 * Math.PI) lfoPhase2 -= 2 * Math.PI;
                visualLfo2 = Math.sin(lfoPhase2);
            }
        } else {
            lfoPhase2 = 0;
        }

        // --- Apply to Knobs ---
        if (window.tracks) {
            window.tracks.forEach(track => {
                if (!track) return;
                const audioTrack = window.audioService.tracks.get(track.id);
                if (!audioTrack || !audioTrack.lfoConnections) return;

                audioTrack.lfoConnections.forEach((conn, param) => {
                    if (track.state.manualKnobInteraction[param]) return;

                    const lfoIndex = conn.lfoIndex;
                    const isEnabled = (lfoIndex === 2) ? lfo2Enabled : lfo1Enabled;
                    if (!isEnabled) return;

                    let rawVal = (lfoIndex === 2) ? visualLfo2 : visualLfo1;
                    const revState = (lfoIndex === 2) ? track.state.lfo2Reverse : track.state.lfoReverse;
                    if (revState && revState[param]) rawVal = -rawVal;

                    const scaled = ((rawVal + 1) / 2) * (conn.max - conn.min) + conn.min;
                    const knob = track.elements.knobs[param];
                    if (knob) {
                        knob.value = scaled;
                        if (track.elements.valueDisplays[param]) {
                            const unit = (param === 'loopStart' || param === 'loopEnd') ? 's' : '';
                            track.elements.valueDisplays[param].textContent = scaled.toFixed(2) + unit;
                        }
                    }
                });
            });
        }

        // --- Master Waveforms ---
        const masterNodes = window.audioService.getMasterWaveformNodes();
        if (masterNodes) {
            const canvasL = document.getElementById('master-waveform-L');
            const canvasR = document.getElementById('master-waveform-R');
            if (canvasL && canvasR) {
                drawWaveform(canvasL, masterNodes[0]);
                drawWaveform(canvasR, masterNodes[1]);
            }
        }

        const fmt = (n) => n.toString().padStart(2, '0');

        // --- Track Waveforms & Time Display ---
        if (window.tracks) {
            window.tracks.forEach(track => {
                if (!track) return;
                const audioTrack = window.audioService.tracks.get(track.id);
                if (!audioTrack) return;

                const trackNodes = audioTrack.getWaveforms();
                if (trackNodes) {
                    const cvL = track.elements.waveformCanvasL;
                    const cvR = track.elements.waveformCanvasR;
                    const isActive = track.state.isRecording || (track.state.isPlaying && window.audioService.isTrackLoaded(track.id)) || (audioTrack.monitorGate && audioTrack.monitorGate.gain.value > 0.01);

                    if (cvL && cvL.offsetParent !== null) drawWaveform(cvL, trackNodes[0], isActive);
                    if (cvR && cvR.offsetParent !== null) drawWaveform(cvR, trackNodes[1], isActive);
                }

                if (track.elements.trackTimeDisplay) {
                    let position = 0;
                    if (track.state.isRecording || track.state.isPlaying) {
                        position = window.audioService.getTrackPosition(track.id);
                    } else {
                        position = track.state.pausePosition || 0;
                    }
                    const mins = Math.floor(position / 60);
                    const secs = Math.floor(position % 60);
                    const huns = Math.floor((position % 1) * 100);
                    track.elements.trackTimeDisplay.textContent = `${fmt(mins)}:${fmt(secs)}:${fmt(huns)}`;
                }
            });
        }

        // --- Master Recording Time Display ---
        const masterTimeDisplay = document.getElementById('recording-time-display');
        if (masterTimeDisplay) {
            const isRecording = window.isMasterMeditation || window.audioService.isMasterRecording;
            if (isRecording) {
                const position = window.audioService.getMasterRecordPosition();
                const mins = Math.floor(position / 60);
                const secs = Math.floor(position % 60);
                const huns = Math.floor((position % 1) * 100);
                masterTimeDisplay.textContent = `${fmt(mins)}:${fmt(secs)}:${fmt(huns)}`;
            } else {
                if (masterTimeDisplay.textContent !== "00:00:00") {
                    masterTimeDisplay.textContent = "00:00:00";
                }
            }
        }

        // --- LFO Meters ---
        const bars = [
            { id: 'lfo-meter-bar', index: 1 },
            { id: 'lfo2-meter-bar', index: 2 }
        ];
        bars.forEach(b => {
            const bar = document.getElementById(b.id);
            if (bar) {
                const rawVal = b.index === 1 ? visualLfo1 : visualLfo2;
                bar.style.width = `${Math.abs(rawVal) * 100}%`;
            }
        });

        requestAnimationFrame(updateMeters);
    }

    /**
     * Draws a waveform onto a canvas from an AnalyserNode.
     */
    function drawWaveform(canvas, waveformNode, isActive = true) {
        if (!canvas || !waveformNode) return;
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        if (canvas.clientWidth !== width || canvas.clientHeight !== height) {
            canvas.width = canvas.clientWidth;
            canvas.height = canvas.clientHeight;
        }

        const data = waveformNode.getValue();
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (!isActive) {
            ctx.beginPath();
            ctx.strokeStyle = '#d4af37';
            ctx.lineWidth = 1;
            ctx.moveTo(0, canvas.height / 2);
            ctx.lineTo(canvas.width, canvas.height / 2);
            ctx.stroke();
            return;
        }

        ctx.beginPath();
        ctx.strokeStyle = '#d4af37';
        ctx.lineWidth = 2;

        const sliceWidth = canvas.width / data.length;
        let x = 0;
        for (let i = 0; i < data.length; i++) {
            const v = data[i];
            const y = (v + 1) / 2 * canvas.height;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
            x += sliceWidth;
        }
        ctx.stroke();
    }

    /**
     * LFO Marker Drag Handlers
     */
    function handleMarkerDrag(e) {
        if (!activeDrag.marker) return;

        const slider = activeDrag.track.elements.knobs[activeDrag.param];
        if (!slider) return;

        const rect = slider.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const val = parseFloat(slider.min) + percent * (parseFloat(slider.max) - parseFloat(slider.min));
        const step = parseFloat(slider.step) || 0.01;
        const snappedVal = Math.round(val / step) * step;
        const constrainedVal = Math.max(parseFloat(slider.min), Math.min(parseFloat(slider.max), snappedVal));

        const range = parseFloat(slider.max) - parseFloat(slider.min);
        const visualPercent = (constrainedVal - parseFloat(slider.min)) / range;

        activeDrag.marker.style.left = `${visualPercent * 100}%`;

        activeDrag.track.state[`lfo${activeDrag.type === 'min' ? 'Min' : 'Max'}Presets`] =
            activeDrag.track.state[`lfo${activeDrag.type === 'min' ? 'Min' : 'Max'}Presets`] || {};
        activeDrag.track.state[`lfo${activeDrag.type === 'min' ? 'Min' : 'Max'}Presets`][activeDrag.param] = constrainedVal;

        const currentMin = activeDrag.track.state.lfoMinPresets?.[activeDrag.param] ?? parseFloat(slider.min);
        const currentMax = activeDrag.track.state.lfoMaxPresets?.[activeDrag.param] ?? parseFloat(slider.max);

        window.audioService.updateLfoParameterRange(activeDrag.track.id, activeDrag.param, currentMin, currentMax);
    }

    function stopMarkerDrag() {
        activeDrag.marker = null;
        document.removeEventListener('mousemove', handleMarkerDrag);
        document.removeEventListener('mouseup', stopMarkerDrag);
    }

    /**
     * Initializes all marker movement listeners for a track.
     * Includes play markers and LFO min/max markers.
     */
    function initMarkerListeners(track) {
        if (!track) return;

        // 1. Play/Loop Markers
        if (track.elements.waveformCanvasL) {
            const updatePlayMarkers = () => {
                const audioTrack = window.audioService.tracks.get(track.id);
                if (!audioTrack) return;

                const progress = window.audioService.getTrackPosition(track.id);
                const duration = window.audioService.getTrackDuration(track.id);
                const loopStart = audioTrack.loopStart || 0;
                const loopEnd = audioTrack.loopEnd || duration;

                if (duration > 0) {
                    if (track.elements.playMarker) track.elements.playMarker.style.left = (progress / duration * 100) + '%';
                    if (track.elements.loopStartMarker) track.elements.loopStartMarker.style.left = (loopStart / duration * 100) + '%';
                    if (track.elements.loopEndMarker) track.elements.loopEndMarker.style.left = (loopEnd / duration * 100) + '%';
                }
                requestAnimationFrame(updatePlayMarkers);
            };
            requestAnimationFrame(updatePlayMarkers);
        }

        // 2. LFO Markers
        if (track.elements.minMarkers) {
            Object.keys(track.elements.minMarkers).forEach(param => {
                const minM = track.elements.minMarkers[param];
                const maxM = track.elements.maxMarkers[param];

                minM.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    activeDrag = { marker: minM, track: track, param: param, type: 'min' };
                    document.addEventListener('mousemove', handleMarkerDrag);
                    document.addEventListener('mouseup', stopMarkerDrag);
                });

                maxM.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    activeDrag = { marker: maxM, track: track, param: param, type: 'max' };
                    document.addEventListener('mousemove', handleMarkerDrag);
                    document.addEventListener('mouseup', stopMarkerDrag);
                });
            });
        }
    }

    // Export to window
    window.updateMeters = updateMeters;
    window.drawWaveform = drawWaveform;
    window.initMarkerListeners = initMarkerListeners;

    // Start Meter Loop
    requestAnimationFrame(updateMeters);

})();

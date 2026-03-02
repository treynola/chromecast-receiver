/**
 * PersistenceService
 * Handles saving and loading of application state and preferences (Settings Only).
 */
(function () {
    class PersistenceService {
        constructor() {
            this.STORAGE_KEY = 'mxs004_project_data';
            this.PREFS_KEY = 'mxs004_user_prefs';
        }

        // --- Preferences (Device IDs, UI settings) ---

        savePreferences(prefs) {
            try {
                const current = this.getPreferences();
                const updated = { ...current, ...prefs };
                localStorage.setItem(this.PREFS_KEY, JSON.stringify(updated));
                console.log("PersistenceService: Preferences saved", updated);
            } catch (e) {
                console.error("PersistenceService: Error saving preferences", e);
            }
        }

        getPreferences() {
            try {
                const data = localStorage.getItem(this.PREFS_KEY);
                return data ? JSON.parse(data) : {};
            } catch (e) {
                console.error("PersistenceService: Error loading preferences", e);
                return {};
            }
        }

        saveInputDeviceId(deviceId) {
            this.savePreferences({ inputDeviceId: deviceId });
        }

        getInputDeviceId() {
            return this.getPreferences().inputDeviceId;
        }

        // --- Project State (Tracks Controls, Effects, LFOs) ---
        // Does NOT save Audio Blobs (User requested to remove JSZip bundling)

        async saveProject(audioService) {
            console.log("PersistenceService: Saving project settings...");
            const projectData = {
                version: "1.0",
                timestamp: Date.now(),
                master: {
                    volume: (audioService.contextManager.masterVolume && audioService.contextManager.masterVolume.volume)
                        ? audioService.contextManager.masterVolume.volume.value : 0,
                    lfo1: { frequency: audioService.contextManager.lfo.frequency.value },
                    lfo2: { frequency: audioService.contextManager.lfo2.frequency.value }
                },
                recordings: window.recordingUI ? window.recordingUI.getRecordingState() : [],
                tracks: []
            };

            for (const [id, track] of audioService.tracks.entries()) {
                const trackData = {
                    id: id,
                    volume: track.volume.volume.value,
                    pan: track.panner.pan.value,
                    playbackRate: (track.player.playbackRate && typeof track.player.playbackRate.value === 'number') ? track.player.playbackRate.value : track.player.playbackRate,
                    loopStart: track.player.loopStart,
                    loopEnd: track.player.loopEnd,
                    playStartTime: track.playStartTime,
                    reverse: track.player.reverse,
                    eq: {
                        bass: track.eq.bass.gain.value,
                        mid_freq: track.eq.mid.frequency.value,
                        mid_gain: track.eq.mid.gain.value,
                        treble: track.eq.treble.gain.value
                    },
                    lfoPresets: {
                        lfo1Min: track.state.lfo1MinPresets || {},
                        lfo1Max: track.state.lfo1MaxPresets || {},
                        lfo2Min: track.state.lfo2MinPresets || {},
                        lfo2Max: track.state.lfo2MaxPresets || {}
                    },
                    lfoConnections: []
                };

                // LFOs
                track.lfoConnections.forEach((conn, paramName) => {
                    trackData.lfoConnections.push({
                        param: paramName,
                        lfoIndex: conn.lfoIndex,
                        min: conn.min,
                        max: conn.max
                    });
                });

                projectData.tracks.push(trackData);
            }

            // Save to LocalStorage
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(projectData));
            console.log("PersistenceService: Project settings saved.");
            return projectData;
        }

        async loadProject(audioService) {
            console.log("PersistenceService: Loading project settings...");
            const json = localStorage.getItem(this.STORAGE_KEY);
            if (!json) {
                console.warn("PersistenceService: No saved project found.");
                return;
            }

            try {
                const data = JSON.parse(json);

                // Master
                if (data.master) {
                    if (audioService.contextManager.masterVolume)
                        audioService.contextManager.masterVolume.volume.value = data.master.volume || 0;

                    if (data.master.lfo1) audioService.contextManager.lfo.frequency.value = data.master.lfo1.frequency;
                    if (data.master.lfo2) audioService.contextManager.lfo2.frequency.value = data.master.lfo2.frequency;

                    // Update UI Sliders
                    this.updateGlobalSliders(data.master);
                }

                // Tracks
                for (const trackData of data.tracks) {
                    const trackId = trackData.id;
                    const track = audioService.tracks.get(trackId);
                    if (!track) continue;

                    // 1. Mixer
                    track.setVolume(trackData.volume);
                    track.setPan(trackData.pan);
                    track.setEQ(trackData.eq);

                    // 2. Transport
                    if (trackData.loopStart) track.player.loopStart = trackData.loopStart;
                    if (trackData.loopEnd) track.player.loopEnd = trackData.loopEnd;
                    if (trackData.reverse !== undefined) track.player.reverse = trackData.reverse;

                    if (trackData.playbackRate !== undefined) {
                        if (track.player.playbackRate.setValueAtTime) {
                            track.player.playbackRate.setValueAtTime(trackData.playbackRate, 0);
                        } else {
                            track.player.playbackRate = trackData.playbackRate;
                        }
                    }

                    // 2.b Presets
                    if (trackData.lfoPresets) {
                        track.state.lfo1MinPresets = trackData.lfoPresets.lfo1Min || {};
                        track.state.lfo1MaxPresets = trackData.lfoPresets.lfo1Max || {};
                        track.state.lfo2MinPresets = trackData.lfoPresets.lfo2Min || {};
                        track.state.lfo2MaxPresets = trackData.lfoPresets.lfo2Max || {};
                    }

                    // 3. LFOs
                    if (trackData.lfoConnections) {
                        trackData.lfoConnections.forEach(conn => {
                            audioService.assignLfoToParameter(trackId, conn.param, conn.min, conn.max, conn.lfoIndex);
                            this.updateLfoCheckbox(trackId, conn);
                        });
                    }
                }

                // 4. Recording List
                if (data.recordings && window.recordingUI) {
                    await window.recordingUI.loadRecordingState(data.recordings);
                }

                console.log("PersistenceService: Project settings loaded.");

            } catch (e) {
                console.error("PersistenceService: Error loading project", e);
            }
        }

        updateGlobalSliders(masterData) {
            const lfo1Slider = document.getElementById('lfo-time');
            if (lfo1Slider && masterData.lfo1) {
                lfo1Slider.value = (1 / masterData.lfo1.frequency).toFixed(1);
                lfo1Slider.dispatchEvent(new Event('input'));
            }
            const lfo2Slider = document.getElementById('lfo2-time');
            if (lfo2Slider && masterData.lfo2) {
                lfo2Slider.value = (1 / masterData.lfo2.frequency).toFixed(1);
                lfo2Slider.dispatchEvent(new Event('input'));
            }
        }

        updateLfoCheckbox(trackId, conn) {
            const trackDiv = document.querySelector(`.track[data-track-index="${trackId}"]`);
            if (trackDiv) {
                const checkbox = trackDiv.querySelector(`.lfo-assign[data-lfo-assign="${conn.param}"][data-lfo-index="${conn.lfoIndex}"]`);
                if (checkbox) {
                    checkbox.checked = true;
                    if (conn.min > conn.max) {
                        checkbox.classList.add('reversed');
                    }
                }
            }
        }
    }

    // Expose as global instance
    window.PersistenceService = new PersistenceService();
})();

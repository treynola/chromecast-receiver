/**
 * Orchestrator.js
 * Manages the high-level initialization flow and lifecycle of the application.
 */
(function () {

    class Orchestrator {
        constructor() {
            this.initialized = false;
        }

        async init() {
            if (this.initialized) return;
            console.log("Orchestrator: Beginning Initialization...");

            // Initialize track count
            window.numTracks = window.AppConfig?.NUM_TRACKS || 4;
            window.tracks = [];

            try {
                // 1. Audio Service Init
                await window.audioService.init();

                // 2. Create Tracks
                await this.createTracks();

                // 3. Permissions & Device Enumeration
                await window.check_permissions();
                await window.populateDeviceSelectors();
                
                // 4. Effects Population
                if (window.populateEffectSelectors) {
                    window.populateEffectSelectors();
                }

                // 5. Recording UI
                if (window.RecordingUI) {
                    window.recordingUI = new window.RecordingUI('recordings-list', window.audioService);
                }

                // 6. UI Reveal
                document.querySelector('.container').classList.remove('hidden');
                if (window.removeCurtain) window.removeCurtain();

                this.initialized = true;
                console.log("Orchestrator: Initialization Complete.");

            } catch (err) {
                console.error("Orchestrator: Initialization Failed:", err);
                // Reveal UI anyway so user isn't stuck
                document.querySelector('.container').classList.remove('hidden');
                if (window.removeCurtain) window.removeCurtain();
                alert(`Initialization error: ${err.message || err}\n\nThe app may have limited functionality.`);
            }
        }

        async createTracks() {
            const tracksContainer = document.querySelector('.tracks-container');
            if (!tracksContainer) return;

            tracksContainer.innerHTML = ''; // Clear existing
            window.tracks = window.tracks || [];
            const numTracks = window.numTracks || 4;

            for (let i = 0; i < numTracks; i++) {
                try {
                    // Create UI View
                    const trackView = new window.TrackView(i, window.audioService);

                    // Initialize UI State
                    trackView.state = {
                        manualKnobInteraction: {},
                        keyboardInteractionTimer: null,
                        currentInput: 'mic',
                        hasContent: false,
                        isRecording: false,
                        isPlaying: false,
                        effectsChain: new Array(7).fill(null),
                        lfoConnections: new Map(),
                        lfo1MinPresets: {},
                        lfo1MaxPresets: {},
                        lfo2MinPresets: {},
                        lfo2MaxPresets: {},
                        lfoReverse: {},
                        lfo2Reverse: {}
                    };

                    const trackElement = trackView.buildElement();
                    tracksContainer.appendChild(trackElement);

                    // Dialog Setup
                    this.setupTrackDialogs(trackView, i);

                    // Create Audio Engine Track
                    trackView.trackAudio = await window.audioService.createTrack(i);

                    // Store Reference
                    window.tracks.push(trackView);

                    // Initialize Markers
                    if (window.initMarkerListeners) {
                        window.initMarkerListeners(trackView);
                    }

                } catch (trackErr) {
                    console.error(`Orchestrator: Track ${i} initialization failed:`, trackErr);
                    window.tracks.push(null);
                }
            }
        }

        setupTrackDialogs(trackView, trackId) {
            // Audition Dialog
            if (trackView.elements.auditionDialog) {
                const header = trackView.elements.auditionDialog.querySelector('.dialog-header');
                if (window.makeDraggable) {
                    window.makeDraggable(trackView.elements.auditionDialog, header);
                }

                trackView.elements.auditionDialog.addEventListener('close', () => {
                    if (trackView.state.auditioningEffect) {
                        console.log(`Audition Closed for Track ${trackId}. Cleaning up.`);
                        window.audioService.removeAuditioningEffect(trackId);
                        trackView.state.auditioningEffect = null;
                    }
                });
            }

            // Effect Slot Dialogs
            if (trackView.elements.effectDialogs) {
                trackView.elements.effectDialogs.forEach(dialog => {
                    const header = dialog.querySelector('.dialog-header');
                    if (window.makeDraggable) {
                        window.makeDraggable(dialog, header);
                    }
                });
            }
        }
    }

    window.orchestrator = new Orchestrator();

})();

/**
 * AudioRouter.js
 * 
 * Manages global audio input sources (Microphone, BlackHole Loopback)
 * and routes them into the Tone.js master bus for casting and local monitoring.
 */
(function () {
    class AudioRouter {
        constructor(manager) {
            this.manager = manager;
            this.masterBus = manager.masterBus; // The global mix point

            // Channel gain nodes
            this._micGain = null;
            this._bhGain = null;

            // Tone.UserMedia instances
            this._micInput = null;
            this._bhInput = null;

            // State
            this._micActive = false;
            this._bhActive = false;
            this._micMuted = false;
            this._bhMuted = false;
        }

        /**
         * Open microphone and route to master bus.
         */
        async openMicrophone(deviceId = null, gainDb = 0) {
            if (this._micActive) await this.closeMicrophone();

            this._micGain = new Tone.Gain(Tone.dbToGain(gainDb));
            this._micGain.label = "Global Mic Gain";

            // Connect to master bus so it's part of the final mix/cast
            if (this.masterBus) {
                this._micGain.connect(this.masterBus);
            }

            this._micInput = new Tone.UserMedia();

            try {
                // v12.98 Use shared stream from manager if possible
                const stream = await this.manager.getSharedInputStream(deviceId);
                await this._micInput.open(stream);
                // Note: Tone.UserMedia.open(stream) is supported in newer Tone versions
                // If not, we might need to use a native MediaStreamSource
            } catch (e) {
                console.warn("[AudioRouter] Mic open failed, trying default enumeration path...", e);
                try {
                    await this._micInput.open(deviceId);
                } catch (e2) {
                    this._micGain.dispose();
                    this._micInput.dispose();
                    this._micGain = null;
                    this._micInput = null;
                    throw e2;
                }
            }

            this._micInput.connect(this._micGain);
            this._micActive = true;
            console.log('[AudioRouter] Microphone mixed into Master Bus.');
        }

        async closeMicrophone() {
            if (!this._micActive) return;
            this._micInput?.close();
            this._micInput?.dispose();
            this._micGain?.dispose();
            this._micInput = null;
            this._micGain = null;
            this._micActive = false;
            console.log('[AudioRouter] Microphone closed.');
        }

        setMicGain(gainDb) {
            if (this._micGain) {
                this._micGain.gain.rampTo(Tone.dbToGain(gainDb), 0.05);
            }
        }

        setMicMute(muted) {
            this._micMuted = muted;
            if (this._micGain) {
                this._micGain.gain.rampTo(muted ? 0 : Tone.dbToGain(0), 0.05);
            }
        }

        /**
         * Open BlackHole/Loopback and route to master bus.
         */
        async openLoopback(deviceId, gainDb = 0) {
            if (!deviceId) throw new Error('No loopback device ID provided.');
            if (this._bhActive) await this.closeLoopback();

            this._bhGain = new Tone.Gain(Tone.dbToGain(gainDb));
            this._bhGain.label = "Global Loopback Gain";

            if (this.masterBus) {
                this._bhGain.connect(this.masterBus);
            }

            this._bhInput = new Tone.UserMedia();

            try {
                const stream = await this.manager.getSharedInputStream(deviceId);
                await this._bhInput.open(stream);
            } catch (e) {
                try {
                    await this._bhInput.open(deviceId);
                } catch (e2) {
                    this._bhGain.dispose();
                    this._bhInput.dispose();
                    this._bhGain = null;
                    this._bhInput = null;
                    throw e2;
                }
            }

            this._bhInput.connect(this._bhGain);
            this._bhActive = true;
            console.log('[AudioRouter] BlackHole Loopback mixed into Master Bus.');
        }

        async closeLoopback() {
            if (!this._bhActive) return;
            this._bhInput?.close();
            this._bhInput?.dispose();
            this._bhGain?.dispose();
            this._bhInput = null;
            this._bhGain = null;
            this._bhActive = false;
            console.log('[AudioRouter] Loopback closed.');
        }

        setLoopbackGain(gainDb) {
            if (this._bhGain) {
                this._bhGain.gain.rampTo(Tone.dbToGain(gainDb), 0.05);
            }
        }

        setLoopbackMute(muted) {
            this._bhMuted = muted;
            if (this._bhGain) {
                this._bhGain.gain.rampTo(muted ? 0 : Tone.dbToGain(0), 0.05);
            }
        }

        get status() {
            return {
                micActive: this._micActive,
                micMuted: this._micMuted,
                micLabel: this._micInput?.label ?? null,
                bhActive: this._bhActive,
                bhMuted: this._bhMuted,
                bhLabel: this._bhInput?.label ?? null,
            };
        }

        async destroy() {
            await this.closeMicrophone();
            await this.closeLoopback();
        }
    }

    window.AudioRouter = AudioRouter;
})();

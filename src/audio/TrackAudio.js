/**
 * TrackAudio.js
 * Manages the audio signal chain for a single track.
 */
(function () {
    class TrackAudio {
        constructor(id, manager) {
            this.id = id;
            this.manager = manager;
            this.masterBus = manager.masterBus;

            // --- Source Nodes ---
            this.player = new Tone.Player().set({
                fadeIn: 0.01,
                fadeOut: 0.01,
                loop: true
            });

            // --- Input Handling ---
            this.trackInput = new Tone.Gain(1); // Virtual input node
            this.inputGainNode = new Tone.Gain(1);
            this.monitorGate = new Tone.Gain(0); // For monitoring
            this.recorder = new window.AudioUtils.PCMRecorder(window.Tone.context);

            // --- Effects Chain ---
            this.eq = {
                bass: new Tone.Filter(200, "lowshelf"),
                mid: new Tone.Filter(1200, "peaking"),
                treble: new Tone.Filter(5000, "highshelf")
            };
            this.chainInput = new Tone.Gain(1);
            this.chainOutput = new Tone.Gain(1);

            // --- Output Nodes ---
            this.inputMeter = new Tone.Meter({ smoothing: 0.2 }); // This is actually track output meter
            this.rawInputMeter = new Tone.Meter({ smoothing: 0.2 }); // Real input signal detector
            this.panner = new Tone.Panner(0);
            this.volume = new Tone.Volume(0);

            // --- State ---
            this.effects = new Array(7).fill(null);
            this.auditioningEffect = null;
            this.playStartTime = 0;
            this.recordStartTime = 0;
            this.loopStart = 0;
            this.loopEnd = 0;

            // --- Input State ---
            this.inputStream = null;
            this.inputConnection = null;
            this.monoToStereoConverter = null;
            this.inputBoostGain = null;
            this.lastDeviceId = null; // Store for persistent reconnection

            // --- LFO State ---
            this.lfoConnections = new Map();
            this.lfoReverseState = {};

            // --- Build Initial Graph ---
            this.player = new Tone.Player().set({
                fadeIn: 0,
                fadeOut: 0,
                loop: true,
                volume: 0 // Reset to 0dB to prevent clipping. User can adjust Track Volume. (v13.0)
            });

            this._buildGraph();
        }

        _buildGraph() {
            // Path 1: Player -> EQ -> Chain
            Tone.connect(this.player, this.eq.bass);
            Tone.connect(this.eq.bass, this.eq.mid);
            Tone.connect(this.eq.mid, this.eq.treble);
            Tone.connect(this.eq.treble, this.chainInput);

            // Path 2: Input -> Gain -> Monitor -> EQ -> Chain (Monitoring)
            this.trackInput.connect(this.inputGainNode);
            this.trackInput.connect(this.rawInputMeter);

            // recorder.input will be connected only during recording to save resources
            /* 
            if (this.recorder.input) {
                this.trackInput.connect(this.recorder.input);
            }
            */

            this.inputGainNode.connect(this.monitorGate);
            this.monitorGate.chain(this.eq.bass, this.eq.mid, this.eq.treble, this.chainInput);

            // Path 3: Chain -> Analysis -> Panner -> Volume -> Master
            this.reconnectEffectChain(); // Instead of direct connect

            this.waveformNodes = [new Tone.Waveform(1024), new Tone.Waveform(1024)];
            this.waveformSplitter = new Tone.Split();

            // V12.33c - Visualizer Optimization
            // Relax channel constraints to avoid expensive resampling/upmixing with tiny buffer (0.001 lookAhead).
            this.visualizerStereoEnforcer = new Tone.Gain();
            this.visualizerStereoEnforcer.channelCount = 2;
            this.visualizerStereoEnforcer.channelCountMode = 'max'; // Was 'explicit'
            this.visualizerStereoEnforcer.channelInterpretation = 'speakers';

            this.visualizerStereoEnforcer.connect(this.waveformSplitter);

            this.setVisualizerMode('output'); // Connects to Enforcer
            this.waveformSplitter.connect(this.waveformNodes[0], 0);
            this.waveformSplitter.connect(this.waveformNodes[1], 1);

            this.chainOutput.connect(this.inputMeter);
            this.chainOutput.connect(this.panner);
            this.panner.connect(this.volume);

            if (this.masterBus) {
                this.volume.connect(this.masterBus);
            } else {
                console.warn(`TrackAudio ${this.id}: Master Bus not found!`);
            }
        }

        // --- Basic Controls ---
        setVolume(db) { this.volume.volume.value = db; }
        setPan(val) { this.panner.pan.value = val; }
        setPitch(value) {
            this._syncHead();
            // Value is -100 to 100. Map to -12 to +12 semitones (1 octave range).
            const semitones = (value / 100) * 12;
            const rate = Math.pow(2, semitones / 12);

            // Robust setter for playbackRate (Signal/AudioParam vs Primitive Number)
            const pbr = this.player.playbackRate;
            if (pbr && typeof pbr === 'object' && 'value' in pbr) {
                if (pbr.value !== rate) pbr.value = rate;
            } else if (this.player.playbackRate !== rate) {
                // If it's a number/property, try setting it directly
                try {
                    this.player.playbackRate = rate;
                } catch (e) {
                    console.warn(`TrackAudio ${this.id}: Could not set playbackRate property.`, e);
                }
            }
        }
        setInputGain(db) { this.inputGainNode.gain.value = Tone.dbToGain(db); }

        setEQ(params) {
            if (params.bass !== undefined) this.eq.bass.gain.value = params.bass;
            if (params.mid !== undefined) this.eq.mid.gain.value = params.mid;
            if (params.midFreq !== undefined) this.eq.mid.frequency.value = params.midFreq;
            if (params.treble !== undefined) this.eq.treble.gain.value = params.treble;
        }

        setMonitor(enabled) {
            this.monitorGate.gain.rampTo(enabled ? 1 : 0, 0.1);
        }

        // --- Playback ---
        async loadData(arrayBuffer, filename) {
            this.loadedAudioUrl = filename;
            this.castAudioUrl = null;

            try {
                // Decode directly using the native context to bypass fetch/CORS entirely
                const ctx = Tone.context.rawContext || Tone.context;
                const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

                // Assign directly to player, overriding any fetch request
                this.player.buffer = new Tone.ToneAudioBuffer(audioBuffer);

                const duration = this.player.buffer.duration;
                const bufferSR = this.player.buffer.sampleRate;
                this.loopStart = 0;
                this.loopEnd = duration;
                this.player.loopStart = 0;
                this.player.loopEnd = duration;
                this.player.loop = true; // Force Loop Enabled
                console.log(`TrackAudio ${this.id}: Decoded ArrayBuffer ${filename} (${duration.toFixed(2)}s). BufferSR=${bufferSR}. ContextSR=${Tone.context.sampleRate}`);
                this.setVisualizerMode('output');
            } catch (err) {
                console.error(`TrackAudio ${this.id} Decode Error:`, err);
                throw err;
            }
        }

        async loadUrl(url) {
            this.loadedAudioUrl = url;  // Store local URL
            this.castAudioUrl = null;   // Will be set if upload succeeds

            await this.player.load(url);
            const duration = this.player.buffer.duration;
            const bufferSR = this.player.buffer.sampleRate;
            this.loopStart = 0;
            this.loopEnd = duration;
            this.player.loopStart = 0;
            this.player.loopEnd = duration;
            this.player.loop = true; // Force Loop Enabled
            console.log(`TrackAudio ${this.id}: Loaded ${url} (${duration.toFixed(2)}s). BufferSR=${bufferSR}. ContextSR=${Tone.context.sampleRate}`);
            this.setVisualizerMode('output');
        }

        async _uploadForCasting(url) {
            // LEGACY CASTING DISABLED (v12.50)
            // We now stream the full Tone.js mix via AudioCastManager.
            // This prevents the track from hijacking the cast session.
            console.log(`TrackAudio ${this.id}: Legacy cast upload skipped (using AudioCastManager stream)`);
            return;
        }

        /**
         * Snap internal tracking state to current logical position.
         */
        _syncHead() {
            if (this.player.state === 'started') {
                const now = Tone.now();
                const currentPos = this.getCurrentPosition();
                this.playStartOffset = currentPos;
                this.playStartTime = now;
            }
        }

        getCurrentPosition() {
            if (this.recorder && this.recorder.isRecording) {
                return Tone.now() - this.recordStartTime;
            }

            if (this.player.state === 'started') {
                const duration = this.player.buffer.duration;
                if (duration === 0) return 0;

                const now = Tone.now();
                const rate = (this.player.playbackRate && typeof this.player.playbackRate === 'object') ? this.player.playbackRate.value : (this.player.playbackRate || 1);
                const elapsed = (now - this.playStartTime) * rate;

                const loopStart = this.loopStart || 0;
                const loopEnd = this.loopEnd || duration;
                const loopLen = loopEnd - loopStart;

                if (this.player.loop && loopLen > 0) {
                    const startOffset = this.playStartOffset || loopStart;
                    const relStart = startOffset - loopStart;
                    let relPos;

                    if (this.player.reverse) {
                        relPos = (relStart - elapsed) % loopLen;
                        if (relPos < 0) relPos += loopLen;
                    } else {
                        relPos = (relStart + elapsed) % loopLen;
                    }
                    return loopStart + relPos;
                } else {
                    if (this.player.reverse) {
                        return Math.max(0, (this.playStartOffset || duration) - elapsed);
                    } else {
                        return Math.min(duration, (this.playStartOffset || 0) + elapsed);
                    }
                }
            }
            return this.pausePosition || 0;
        }

        startPlayback(offset) {
            if (!this.player.loaded) return;
            let startPos = (offset !== undefined) ? offset : this.loopStart;
            const bufferDur = this.player.buffer ? this.player.buffer.duration : 0;
            if (startPos >= bufferDur) startPos = 0;

            this.playStartOffset = startPos;
            this.playStartTime = Tone.now();

            if (Tone.context.state !== 'running') {
                Tone.context.resume().catch(e => console.warn("Context resume failed:", e));
            }

            this.player.start(undefined, startPos);
            // Robustly extract rate for logging (handles both Signal and number types)
            const rate = (this.player.playbackRate && typeof this.player.playbackRate === 'object') ? (this.player.playbackRate.value ?? 1) : (this.player.playbackRate || 1);
            console.log(`TrackAudio ${this.id}: startPlayback at ${startPos.toFixed(3)}s. Rate=${rate.toFixed(2)}x. ContextSR=${Tone.context.sampleRate}`);
        }

        // --- Slicing & Looping ---
        setLoopStart(time) {
            const newStart = parseFloat(time);
            if (isNaN(newStart)) return;

            this.loopStart = newStart;

            if (this.player.loaded) {
                this.player.loop = true;
                this.player.loopStart = this.loopStart;
                console.log(`TrackAudio ${this.id}: loopStart set to ${this.loopStart}s`);
            }
        }

        setLoopEnd(time) {
            const newEnd = parseFloat(time);
            if (isNaN(newEnd)) return;

            this.loopEnd = newEnd;

            if (this.player.loaded) {
                this.player.loop = true;
                this.player.loopEnd = this.loopEnd;
                console.log(`TrackAudio ${this.id}: loopEnd set to ${this.loopEnd}s`);
            }
        }

        // --- Slicing ---
        async sliceSelection() {
            if (!this.player.loaded || !this.player.buffer) {
                console.warn(`TrackAudio ${this.id}: No audio loaded to slice.`);
                return null;
            }

            const startTime = this.loopStart || 0;
            const endTime = this.loopEnd || this.player.buffer.duration;
            const duration = endTime - startTime;

            if (duration <= 0.01) {
                console.warn(`TrackAudio ${this.id}: Invalid slice duration (${duration}s).`);
                return null;
            }

            console.log(`TrackAudio ${this.id}: Slicing from ${startTime.toFixed(3)}s to ${endTime.toFixed(3)}s (${duration.toFixed(3)}s)`);

            if (!this.player.buffer || !this.player.buffer.get()) {
                console.error(`TrackAudio ${this.id}: Internal player buffer missing!`);
                return null;
            }

            const audioBuffer = this.player.buffer.get();
            const sampleRate = audioBuffer.sampleRate;
            const startSample = Math.floor(startTime * sampleRate);
            const endSample = Math.floor(endTime * sampleRate);
            const frameCount = endSample - startSample;

            if (frameCount <= 0) return null;

            const newBuffer = Tone.context.createBuffer(
                audioBuffer.numberOfChannels,
                frameCount,
                sampleRate
            );

            for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
                const oldData = audioBuffer.getChannelData(channel);
                const newData = newBuffer.getChannelData(channel);
                newData.set(oldData.subarray(startSample, endSample));
            }

            if (window.AudioUtils && window.AudioUtils.encodeWAV) {
                return window.AudioUtils.encodeWAV(newBuffer);
            } else {
                console.error("AudioUtils.encodeWAV not found!");
                return null;
            }
        }

        stopPlayback() {
            this.player.stop();
        }

        // --- Recording ---
        async startRecording(duration = null) {
            console.log(`🎙️ TrackAudio ${this.id}: === START RECORDING SEQUENCE ===`);

            // ... (permission checks same)
            if (Tone.context.state !== 'running') {
                try { await Tone.context.resume(); } catch (e) {
                    console.error(`TrackAudio ${this.id}: Context resume failed:`, e);
                }
            }

            if (!this.inputConnection || !this.inputStream || !this.inputStream.active) {
                try {
                    await this.connectInput('mic', this.lastDeviceId);
                } catch (e) {
                    console.error(`TrackAudio ${this.id}: ❌ Mic reconnect failed:`, e);
                    throw new Error(`Failed to connect microphone: ${e.message}`);
                }
            }

            if (this.recorder) this.recorder.dispose();
            const nativeCtx = this.manager.getNativeContext();
            this.recorder = new window.AudioUtils.PCMRecorder(window.Tone.context);
            console.log(`TrackAudio ${this.id}: New recorder instantiated on Wrapper Context [Shared Tone Context]`);

            // Set Target Sample Count if provided
            if (duration) {
                const sr = Tone.context.sampleRate || 48000;
                this.recorder.targetSampleCount = Math.floor(duration * sr);
                console.log(`TrackAudio ${this.id}: Set recorder target to ${this.recorder.targetSampleCount} samples (${duration}s)`);
            }

            // V12.99 Bridge Stabilization Delay
            // A tiny pause ensures the recording worklet is ALIVE before it receives signal.
            await new Promise(r => setTimeout(r, 100));

            try {
                // Correctly identify contexts
                const rawCtx = this.manager.getNativeContext();
                const recBaseCtx = this.recorder._baseAudioContext;

                // V10.13h: DIRECT PATH OPTIMIZATION
                // If the track source and recorder are on the identical native context,
                // connect them directly to avoid MediaStream destination/source overhead.
                if (rawCtx === recBaseCtx) {
                    this.trackInput.connect(this.recorder.nativeInput);
                    console.log(`TrackAudio ${this.id}: ✅ DIRECT native bridge established [trackInput -> nativeInput]`);
                    this._recordingBridge = { direct: true };
                } else {
                    // Fallsback to MediaStream bridge for cross-context recording (e.g. some Safari cases)
                    const destNode = rawCtx.createMediaStreamDestination();
                    this.trackInput.connect(destNode);
                    const recSource = recBaseCtx.createMediaStreamSource(destNode.stream);
                    recSource.connect(this.recorder.nativeInput);
                    this._recordingBridge = { destNode, recSource };
                    console.log(`TrackAudio ${this.id}: ✅ MediaStream bridge established [Source -> Recorder]`);
                }
            } catch (e) {
                console.warn(`TrackAudio ${this.id}: Bridge fail (silent recording likely):`, e);
                // Fallback: try Tone-layer connection
                try {
                    this.trackInput.connect(this.recorder.input);
                    console.log(`TrackAudio ${this.id}: Wrapper bridge fallback established`);
                } catch (e2) {
                    console.error(`TrackAudio ${this.id}: All bridges failed:`, e2);
                }
            }

            this.recordStartTime = Tone.now();
            await this.recorder.start();

            this.setVisualizerMode('input');
            console.log(`🎙️ TrackAudio ${this.id}: === RECORDING ACTIVE ===`);
        }

        async stopRecording() {
            const blob = await this.recorder.stop();
            return blob;
        }

        // --- Effects ---
        reconnectEffectChain() {
            this.chainInput.disconnect();
            let lastNode = this.chainInput;

            for (const effect of this.effects) {
                if (effect && effect.enabled) {
                    try {
                        lastNode.connect(effect.input || effect);
                        lastNode = effect.output || effect;
                    } catch (e) {
                        console.error(`TrackAudio ${this.id}: Failed to connect effect`, effect.name, e);
                    }
                }
            }

            if (this.auditioningEffect) {
                try {
                    lastNode.connect(this.auditioningEffect.input || this.auditioningEffect);
                    lastNode = this.auditioningEffect.output || this.auditioningEffect;
                } catch (e) {
                    console.error(`TrackAudio ${this.id}: Failed to connect audition effect`, this.auditioningEffect.name, e);
                }
            }

            lastNode.connect(this.chainOutput);
        }

        swapEffects(slotA, slotB) {
            if (slotA < 0 || slotA >= 7 || slotB < 0 || slotB >= 7) return;
            const temp = this.effects[slotA];
            this.effects[slotA] = this.effects[slotB];
            this.effects[slotB] = temp;
            this.reconnectEffectChain();
        }

        setEffect(slotIndex, effectName, params, config) {
            const effect = window.effectsService.createEffect(effectName, params);
            if (effect) {
                if (this.effects[slotIndex]) {
                    this.effects[slotIndex].dispose();
                }
                this.effects[slotIndex] = effect;
                this.reconnectEffectChain();
            }
            return effect;
        }

        getEffectState(slotIndex) {
            return this.effects[slotIndex] || null;
        }

        transferAuditionToSlot(slotIndex) {
            if (!this.auditioningEffect) return null;

            if (this.effects[slotIndex]) {
                this.effects[slotIndex].dispose();
            }

            const instance = this.auditioningEffect;
            this.effects[slotIndex] = instance;
            this.auditioningEffect = null;

            this.reconnectEffectChain();
            return instance;
        }

        getWaveforms() {
            return this.waveformNodes;
        }

        setVisualizerMode(mode) {
            if (this.visualizerSource) {
                try {
                    this.visualizerSource.disconnect(this.visualizerStereoEnforcer);
                } catch (e) {
                }
            }

            let newSource;
            if (mode === 'input') {
                newSource = this.trackInput;
            } else {
                newSource = this.chainOutput;
            }

            if (newSource) {
                newSource.connect(this.visualizerStereoEnforcer);
                this.visualizerSource = newSource;
            }
        }

        // --- Inputs ---
        async connectInput(type, deviceId = null, options = {}) {
            this.disconnectInput();

            if (type === 'mic') {
                let targetDeviceId = deviceId;
                if (!deviceId || deviceId === 'default') {
                    try {
                        const devices = await navigator.mediaDevices.enumerateDevices();
                        const audioInputs = devices.filter(d => d.kind === 'audioinput');
                        const builtInMic = audioInputs.find(d =>
                            d.label.toLowerCase().includes('macbook') ||
                            d.label.toLowerCase().includes('built-in') ||
                            d.label.toLowerCase().includes('internal')
                        );
                        if (builtInMic) {
                            targetDeviceId = builtInMic.deviceId;
                        }
                    } catch (e) {
                        console.warn(`TrackAudio ${this.id}: Could not enumerate devices:`, e);
                    }
                }

                const constraints = {
                    audio: {
                        deviceId: targetDeviceId ? { exact: targetDeviceId } : undefined,
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false
                    }
                };

                if (options.isStereo) {
                    constraints.audio = {
                        deviceId: deviceId ? { exact: deviceId } : undefined,
                        channelCount: { ideal: 16 },
                        echoCancellation: false,
                        autoGainControl: false,
                        noiseSuppression: false,
                        googEchoCancellation: false,
                        googAutoGainControl: false,
                        googNoiseSuppression: false,
                        googHighpassFilter: false
                    };
                }

                if (Tone.context.state !== 'running') {
                    try { await Tone.context.resume(); } catch (e) { console.warn('Could not resume context', e); }
                }

                let stream;
                try {
                    // Try to use shared stream from manager (caching)
                    if (this.manager && this.manager.getSharedInputStream) {
                        stream = await this.manager.getSharedInputStream(deviceId);
                    } else {
                        stream = await navigator.mediaDevices.getUserMedia(constraints);
                    }

                    if (!stream || !stream.active) {
                        throw new Error("Stream obtained but inactive");
                    }
                    this.lastDeviceId = deviceId; // Success

                } catch (err) {
                    console.warn(`TrackAudio ${this.id}: Specific constraints failed. Trying robust fallback.`);
                    const fallbackConstraints = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } };
                    if (deviceId && deviceId !== 'default') fallbackConstraints.audio.deviceId = { exact: deviceId };

                    try {
                        stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
                    } catch (err2) {
                        const minConstraints = { audio: true };
                        if (deviceId && deviceId !== 'default') minConstraints.audio = { deviceId: { exact: deviceId } };
                        stream = await navigator.mediaDevices.getUserMedia(minConstraints);
                    }
                }

                const trackSettings = stream.getAudioTracks()[0].getSettings();
                const channelCount = trackSettings.channelCount || 1;
                const label = stream.getAudioTracks()[0].label.toLowerCase();
                const isMultiChannelDevice = label.includes('blackhole') || label.includes('aggregate') || channelCount > 2;
                const useStereoPath = options.isStereo || isMultiChannelDevice || channelCount >= 2;

                // Native MediaStream Source (Unified v10.12)
                const nativeCtx = this.manager.getNativeContext();
                const source = nativeCtx.createMediaStreamSource(stream);

                if (useStereoPath) {
                    const targetChannels = options.inputChannels || [0, 1];
                    const chL = targetChannels[0];
                    const chR = targetChannels[1];

                    // --- V13.0: Hardware-specific Boost for Virtual Drivers Removed ---
                    // Massive boosts cause severe clipping and feedback stuttering. Default to 1 (0dB).
                    const boost = new Tone.Gain(1);
                    this.inputBoostGain = boost;

                    // If it's a multi-channel device, we use a splitter to grab exactly what we need
                    if (isMultiChannelDevice || channelCount > 2) {
                        const actualChannels = Math.max(channelCount, 2);
                        // v10.13: Force split/merge on the SAME native context as source
                        const split = nativeCtx.createChannelSplitter(actualChannels);
                        const merge = nativeCtx.createChannelMerger(2);

                        source.connect(split);
                        split.connect(merge, chL % actualChannels, 0);
                        split.connect(merge, chR % actualChannels, 1);

                        // v10.13c: Use Tone.connect for native→Tone bridging
                        Tone.connect(merge, boost);
                        boost.connect(this.trackInput);
                        this.monoToStereoConverter = { split, merge };
                    } else {
                        Tone.connect(source, boost);
                        boost.connect(this.trackInput);
                    }
                } else {
                    if (Tone.context.state !== 'running') {
                        try { await Tone.start(); await Tone.context.resume(); } catch (e) { }
                    }

                    // v10.13c: Use native merger to match native source
                    const merger = nativeCtx.createChannelMerger(2);
                    source.connect(merger, 0, 0);
                    source.connect(merger, 0, 1);

                    // Mic boost removed (was 5x). Massive gain caused severe clipping/stutter noise.
                    const boost = new Tone.Gain(1);
                    this.inputBoostGain = boost;
                    Tone.connect(merger, boost);
                    boost.connect(this.trackInput);
                    this.monoToStereoConverter = merger;

                    // Keepalive hack
                    setTimeout(() => {
                        if (this.rawInputMeter && this.rawInputMeter.getValue() < -60) {
                            console.warn("Input silent?");
                        }
                    }, 1500);
                }

                this.inputStream = stream;
                this.inputConnection = source;

                if (!this.keepAliveAudio) {
                    this.keepAliveAudio = document.createElement('audio');
                    this.keepAliveAudio.muted = true;
                    this.keepAliveAudio.autoplay = true;
                    this.keepAliveAudio.style.display = 'none';
                    document.body.appendChild(this.keepAliveAudio);
                }
                this.keepAliveAudio.srcObject = stream;
                this.keepAliveAudio.play().catch(e => { });

                this.setMonitor(false);
                this.setVisualizerMode('input');
            }
        }
        disconnectInput() {
            if (this.recorder && this.recorder.input) {
                try { this.trackInput.disconnect(this.recorder.input); } catch (e) { }
            }
            if (this.inputConnection) {
                this.inputConnection.disconnect();
                this.inputConnection = null;
            }
            if (this.monoToStereoConverter) {
                try {
                    if (this.monoToStereoConverter.disconnect) {
                        this.monoToStereoConverter.disconnect();
                    } else {
                        this.monoToStereoConverter.split?.disconnect();
                        this.monoToStereoConverter.merge?.disconnect();
                    }
                } catch (e) { }
                this.monoToStereoConverter = null;
            }
            if (this.inputStream) {
                // DON'T stop shared streams!
                // Shared streams are managed by AudioContextManager now.
                this.inputStream = null;
            }
            if (this.keepAliveAudio) {
                this.keepAliveAudio.pause();
                this.keepAliveAudio.srcObject = null;
            }
            if (this.inputBoostGain) {
                this.inputBoostGain.disconnect();
                this.inputBoostGain.dispose();
                this.inputBoostGain = null;
            }
        }

        // --- LFO Management ---
        getAudioParamByName(paramName) {
            switch (paramName) {
                case 'volume': return this.volume.volume;
                case 'pan': return this.panner.pan;
                case 'pitch': return this.player.playbackRate;
                case 'bass': return this.eq.bass.gain;
                case 'mid': return this.eq.mid.gain;
                case 'treble': return this.eq.treble.gain;
            }

            // check slot properties `slotX.propertyName`
            if (paramName.startsWith('slot')) {
                const parts = paramName.split('.');
                if (parts.length === 2) {
                    const slotIndex = parseInt(parts[0].replace('slot', ''), 10);
                    const prop = parts[1];
                    const effect = this.effects[slotIndex];
                    if (effect) {
                        return this.getAudioParamFromEffect(effect, prop);
                    }
                }
            }
            return null;
        }

        getAudioParamFromEffect(effect, paramName) {
            // Traverse effect wrapper to find Tone parameter
            if (effect[paramName] && effect[paramName] instanceof Tone.Param) {
                return effect[paramName];
            } else if (effect.effect && effect.effect[paramName] && effect.effect[paramName] instanceof Tone.Param) {
                return effect.effect[paramName];
            } else if (effect.core && effect.core[paramName] && effect.core[paramName] instanceof Tone.Param) {
                return effect.core[paramName];
            }
            return null;
        }

        connectLFO(paramName, min, max, lfoIndex = 1) {
            this.disconnectLFO(paramName);

            const param = this.getAudioParamByName(paramName);
            if (!param) {
                console.warn(`TrackAudio ${this.id}: Cannot connect LFO to unknown parameter '${paramName}'`);
                return;
            }

            const lfoNode = this.manager.getLfo(lfoIndex);
            if (!lfoNode) {
                console.warn(`TrackAudio ${this.id}: LFO ${lfoIndex} not found via AudioContextManager`);
                return;
            }

            const scale = new Tone.Scale(min, max);
            const isReversed = this.lfoReverseState[paramName] || false;

            if (isReversed) {
                const negate = new Tone.Multiply(-1);
                const addMax = new Tone.Add(max);
                lfoNode.connect(scale);
                scale.connect(negate);
                negate.connect(addMax);
                addMax.connect(param);
                this.lfoConnections.set(paramName, { scale, negate, addMax, param, source: lfoNode });
            } else {
                lfoNode.connect(scale);
                scale.connect(param);
                this.lfoConnections.set(paramName, { scale, negate: null, addMax: null, param, source: lfoNode });
            }

            console.log(`TrackAudio ${this.id}: LFO ${lfoIndex} connected to ${paramName} (min: ${min}, max: ${max}, reversed: ${isReversed})`);
        }

        disconnectLFO(paramName) {
            const conn = this.lfoConnections.get(paramName);
            if (conn) {
                try {
                    conn.source.disconnect(conn.scale);
                    if (conn.negate) {
                        conn.scale.disconnect(conn.negate);
                        conn.negate.disconnect(conn.addMax);
                        conn.addMax.disconnect(conn.param);
                        conn.negate.dispose();
                        conn.addMax.dispose();
                    } else {
                        conn.scale.disconnect(conn.param);
                    }
                    conn.scale.dispose();
                } catch (e) {
                    console.warn(`TrackAudio ${this.id}: Error disconnecting LFO from ${paramName}`, e);
                }
                this.lfoConnections.delete(paramName);
                console.log(`TrackAudio ${this.id}: LFO disconnected from ${paramName}`);
            }
        }

        updateLfoRange(paramName, min, max) {
            const conn = this.lfoConnections.get(paramName);
            if (conn && conn.scale) {
                conn.scale.min = min;
                conn.scale.max = max;
                if (conn.negate) {
                    conn.addMax.addend.value = max;
                }
            }
        }

        setLfoReversal(paramName, reversed) {
            const changed = (this.lfoReverseState[paramName] || false) !== reversed;
            if (changed) {
                this.lfoReverseState[paramName] = reversed;
                
                // If it is currently connected, rebuild the link
                const conn = this.lfoConnections.get(paramName);
                if (conn && conn.scale) {
                    const min = conn.scale.min;
                    const max = conn.scale.max;
                    let lfoIndex = 1; // Default assumption if we need to reconnect
                    if (conn.source === this.manager.getLfo(2)) lfoIndex = 2; // Crude lookup
                    
                    this.disconnectLFO(paramName);
                    this.connectLFO(paramName, min, max, lfoIndex);
                }
            }
        }
    }

    window.TrackAudio = TrackAudio;
})();

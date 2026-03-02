/**
 * CastManager.js
 * Manages Chromecast, FCast, and WebRTC casting functionality.
 */
(function () {

    /**
     * WebRTCCastSender
     * Handles streaming of application visuals and audio via WebM/Tauri chunks.
     */
    class WebRTCCastSender {
        constructor() {
            this.peerConnection = null;
            this.mediaStream = null;
            this.captureCanvas = null;
            this.captureContext = null;
            this.captureInterval = null;
            this.isStreaming = false;

            this.rtcConfig = {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            };

            console.log('🎬 WebRTCCastSender initialized');
        }

        async startCasting(deviceId) {
            console.log('🚀 Starting MediaRecorder casting...');

            try {
                // Step 1: Capture app visuals + audio
                await this.captureAppStream();

                // Step 2: Start MediaRecorder to encode as WebM
                this.startMediaRecorder();

                // Step 3: Launch Cast receiver via Tauri
                const invoke = window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke;
                if (invoke) {
                    await invoke('cast_to_device', {
                        deviceId: deviceId,
                        protocol: 'chromecast'
                    });
                    console.log('✅ Cast receiver launched');
                }

                this.isStreaming = true;
                return true;

            } catch (e) {
                console.error('❌ Casting failed:', e);
                this.stopCasting();
                throw e;
            }
        }

        startMediaRecorder() {
            if (!this.mediaStream) {
                console.error('No media stream available');
                return;
            }

            const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
                ? 'video/webm;codecs=vp8,opus'
                : 'video/webm';

            console.log('📹 Starting MediaRecorder with:', mimeType);

            try {
                this.mediaRecorder = new MediaRecorder(this.mediaStream, {
                    mimeType: mimeType,
                    videoBitsPerSecond: 2500000,
                    audioBitsPerSecond: 320000
                });

                this.mediaRecorder.ondataavailable = async (event) => {
                    if (event.data.size > 0) {
                        await this.sendChunk(event.data);
                    }
                };

                this.mediaRecorder.onerror = (e) => {
                    console.error('MediaRecorder error:', e);
                };

                this.mediaRecorder.start(100);
                console.log('✅ MediaRecorder started');

            } catch (e) {
                console.error('Failed to start MediaRecorder:', e);
            }
        }

        async sendChunk(blob) {
            const arrayBuffer = await blob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            const base64 = btoa(String.fromCharCode.apply(null, uint8Array));

            const invoke = window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke;
            if (invoke) {
                try {
                    await invoke('cast_media_chunk', { chunk: base64 });
                } catch (e) { }
            }
        }

        async captureAppStream() {
            console.log('📸 Capturing app stream...');

            this.captureCanvas = document.createElement('canvas');
            this.captureCanvas.width = 1920;
            this.captureCanvas.height = 1080;
            this.captureContext = this.captureCanvas.getContext('2d');

            const videoStream = this.captureCanvas.captureStream(30);
            this.startAppCapture();

            let audioStream = null;
            try {
                if (window.Tone && Tone.Destination.context) {
                    const audioContext = Tone.Destination.context.rawContext || Tone.Destination.context;
                    const destination = audioContext.createMediaStreamDestination();

                    if (Tone.Destination.output) {
                        Tone.Destination.output.connect(destination);
                        audioStream = destination.stream;
                        console.log('🔊 Audio stream created:', audioStream.getAudioTracks().length, 'tracks');
                    }
                }
            } catch (e) {
                console.warn('⚠️ Could not capture Tone.js audio:', e);
            }

            this.mediaStream = new MediaStream();
            videoStream.getVideoTracks().forEach(track => this.mediaStream.addTrack(track));
            if (audioStream) {
                audioStream.getAudioTracks().forEach(track => this.mediaStream.addTrack(track));
            }

            console.log('📦 Combined MediaStream:', this.mediaStream.getTracks().length, 'total tracks');
        }

        startAppCapture() {
            const appContainer = document.querySelector('.container');
            if (!appContainer) {
                console.error('❌ App container not found');
                return;
            }

            const captureFrame = async () => {
                try {
                    if (window.html2canvas) {
                        const canvas = await window.html2canvas(appContainer, {
                            useCORS: true,
                            scale: 0.5,
                            logging: false
                        });
                        this.captureContext.drawImage(canvas, 0, 0, 1920, 1080);
                    } else {
                        this.captureContext.fillStyle = '#1a1a1a';
                        this.captureContext.fillRect(0, 0, 1920, 1080);
                        this.captureContext.fillStyle = '#FAD78E';
                        this.captureContext.font = 'bold 48px Arial';
                        this.captureContext.textAlign = 'center';
                        this.captureContext.fillText('MXS-004 LIVE', 960, 540);
                    }
                } catch (e) {
                    console.error('Capture error:', e);
                }
            };

            this.captureInterval = setInterval(captureFrame, 67);
            captureFrame();
        }

        setupPeerConnection() {
            this.peerConnection = new RTCPeerConnection(this.rtcConfig);
            this.peerConnection.onicecandidate = async (event) => {
                if (event.candidate) {
                    const invoke = window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke;
                    if (invoke) {
                        try {
                            await invoke('cast_webrtc_ice', {
                                candidate: JSON.stringify(event.candidate)
                            });
                        } catch (e) { }
                    }
                }
            };
        }

        async handleAnswer(answerJson) {
            try {
                const answer = JSON.parse(answerJson);
                await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            } catch (e) {
                console.error('❌ Failed to set remote description:', e);
            }
        }

        async handleIceCandidate(candidateJson) {
            try {
                const candidate = JSON.parse(candidateJson);
                await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
                console.error('❌ Failed to add ICE candidate:', e);
            }
        }

        stopCasting() {
            console.log('🛑 Stopping casting...');
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop();
                this.mediaRecorder = null;
            }
            if (this.captureInterval) {
                clearInterval(this.captureInterval);
                this.captureInterval = null;
            }
            if (this.mediaStream) {
                this.mediaStream.getTracks().forEach(track => track.stop());
                this.mediaStream = null;
            }
            this.isStreaming = false;
        }
    }

    // Initialize Global Cast Sender
    window.webrtcCastSender = new WebRTCCastSender();

    // Listen for WebRTC messages from Tauri backend
    if (window.__TAURI__?.event?.listen) {
        window.__TAURI__.event.listen('webrtc-answer', (event) => {
            window.webrtcCastSender?.handleAnswer(event.payload);
        });

        window.__TAURI__.event.listen('webrtc-ice-candidate', (event) => {
            window.webrtcCastSender?.handleIceCandidate(event.payload);
        });
    }

    // Device Discovery Logic
    window._foundDevices = window._foundDevices || [];
    window._fcastConnected = false;

    async function startChromecastDiscovery() {
        if (!window.__TAURI__) {
            const castDeviceList = document.getElementById('cast-device-list');
            if (castDeviceList) {
                castDeviceList.innerHTML = '<p class="text-center" style="color: orange;">Casting requires the Tauri desktop app.</p>';
            }
            return;
        }

        const invoke = window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke;
        const listen = window.__TAURI__?.event?.listen || window.__TAURI__?.listen;

        const castDeviceList = document.getElementById('cast-device-list');
        if (castDeviceList) {
            castDeviceList.innerHTML = '<p class="text-center">🔍 Scanning for Cast devices...</p>';
        }

        if (!window._fcastListenerInitialized) {
            window._fcastListenerInitialized = true;
            window._foundDevices = [];

            await listen('fcast-device-found', (event) => {
                const device = event.payload;
                if (!window._foundDevices.some(d => d.id === device.id)) {
                    window._foundDevices.push(device);
                }
                addDeviceToList(device);
            });

            await listen('fcast-connection-state', (event) => {
                window._fcastConnected = (event.payload === 'connected');
            });
            
            // Legacy discovery fallback
            await listen('cast-device-found', (event) => {
                const device = event.payload;
                const fcastDevice = {
                    id: device.id || `chromecast-${device.ip.replace(/\./g, '-')}`,
                    name: device.name?.startsWith('fn=') ? device.name.slice(3) : device.name,
                    protocol: (device.protocol || 'chromecast').toLowerCase(),
                    ip: device.ip,
                    port: device.port || 8009
                };
                if (!window._foundDevices.some(d => d.ip === fcastDevice.ip)) {
                    window._foundDevices.push(fcastDevice);
                    addDeviceToList(fcastDevice);
                }
            });
        }

        // Start discovery on backend
        try {
            await invoke('start_stream_server');
            await invoke('fcast_start_discovery');
            await invoke('start_discovery');
        } catch (e) {
            console.warn('Discovery initialization warning:', e);
        }

        // Timeout fallback
        setTimeout(async () => {
            if (castDeviceList && castDeviceList.innerHTML.includes('Scanning')) {
                try {
                    const devices = await invoke('fcast_get_devices');
                    if (devices && devices.length > 0) {
                        castDeviceList.innerHTML = '';
                        devices.forEach(addDeviceToList);
                    } else {
                        castDeviceList.innerHTML = '<p class="text-center">No Cast devices found.</p>';
                    }
                } catch (e) {
                    castDeviceList.innerHTML = '<p class="text-center">No Cast devices found.</p>';
                }
            }
        }, 15000);
    }

    function addDeviceToList(device) {
        const deviceListEl = document.getElementById('cast-device-list');
        if (!deviceListEl) return;

        if (deviceListEl.innerHTML.includes('Scanning') || deviceListEl.innerHTML.includes('No devices')) {
            deviceListEl.innerHTML = '';
        }

        const deviceIdSafe = device.id.replace(/[^a-zA-Z0-9]/g, '_');
        if (document.getElementById(`fcast-${deviceIdSafe}`)) return;

        let protocolColor = '#ff5722';
        let protocolIcon = '<i class="fa-solid fa-chromecast"></i>';
        let protocolLabel = 'Chromecast';
        const pLower = (device.protocol || '').toLowerCase();

        if (pLower === 'airplay') {
            protocolIcon = '<i class="fa-brands fa-apple"></i>';
            protocolColor = '#999';
            protocolLabel = 'AirPlay';
        } else if (pLower === 'fcast') {
            protocolIcon = '<i class="fa-solid fa-broadcast-tower"></i>';
            protocolColor = '#4CAF50';
            protocolLabel = 'FCast';
        }

        const item = document.createElement('div');
        item.id = `fcast-${deviceIdSafe}`;
        item.className = 'cast-device-item';
        item.style.cssText = 'padding: 12px; margin: 8px 0; border: 1px solid #555; border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; background: #2a2a2a; transition: all 0.2s ease-in-out;';
        item.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px;">
                <div style="font-size: 1.5em; opacity: 0.8; color: ${protocolColor}">${protocolIcon}</div>
                <div>
                    <div style="font-weight: bold; font-size: 1.1em;">${device.name} <span style="font-size:0.7em; opacity:0.6;">(${protocolLabel})</span></div>
                    <div style="font-size: 0.8em; opacity: 0.6; font-family: monospace;">${device.ip}</div>
                </div>
            </div>
            <i class="fa-solid fa-chevron-right" style="opacity: 0.3;"></i>
        `;

        item.onclick = async () => {
            const invokeCmd = window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke;
            item.style.background = '#444';
            item.innerHTML = `<span><i class="fa-solid fa-spinner fa-spin"></i> Connecting...</span>`;

            try {
                if (pLower === 'fcast') {
                    await invokeCmd('fcast_connect', { deviceId: device.id });
                }

                let audioUrl = null;
                if (window.AudioCastManager) {
                    audioUrl = await window.AudioCastManager.startStreamingOnly(device.ip);
                }

                if (audioUrl && (audioUrl.includes('127.0.0.1') || audioUrl.includes('localhost')) && window._localIp) {
                    audioUrl = audioUrl.replace('127.0.0.1', window._localIp).replace('localhost', window._localIp);
                }

                if (pLower === 'chromecast' || pLower === 'chrome') {
                    const finalWsUrl = `?audio_stream=${encodeURIComponent(audioUrl)}`;
                    await invokeCmd('chromecast_launch_hybrid', { deviceId: device.id, wsUrl: finalWsUrl });
                } else if (pLower === 'fcast') {
                    await invokeCmd('fcast_cast_media', { url: audioUrl, content_type: 'audio/webm' });
                } else {
                    await invokeCmd('universal_cast_url', { ip: device.ip, port: device.port || 8001, url: audioUrl, protocol: pLower });
                }

                if (window.castStateBroadcaster) window.castStateBroadcaster.start();

                // RESTORED: Actually start the audio piping for WebRTC/PCM Fallback
                console.log("🔊 POST-CAST: Starting Tone.js -> Rust Audio Pipe (WEBRTC mode)...");
                if (typeof startAudioPiping === 'function') {
                    await startAudioPiping('webrtc', true);
                }

                item.style.background = '#2d5a2d';
                item.innerHTML = `<span><i class="fa-solid fa-check"></i> CASTING TO ${device.name.toUpperCase()}</span>`;
                setTimeout(() => { document.getElementById('cast-dialog')?.close(); }, 2000);
            } catch (err) {
                console.error('Cast Error:', err);
                item.style.background = '#5a2d2d';
                item.innerHTML = `<span><i class="fa-solid fa-warning"></i> Error</span>`;
            }
        };

        deviceListEl.appendChild(item);
    }

    window.stopAllCasting = async function () {
        // ... (existing code)
    };

    let audioPipeNode = null;
    let audioPipeActive = false;
    let testToneOsc = null;
    let testToneGain = null;
    window._castMode = 'webrtc'; // Initialize global cast mode

    async function startAudioPiping(mode = 'webrtc', forceRestart = false) {
        if (audioPipeActive && !forceRestart) return;
        audioPipeActive = true;
        window._castMode = mode; // Update global cast mode

        if (Tone.context.state !== 'running') await Tone.start();

        const cm = window.audioService?.contextManager;
        const router = cm?.router;

        if (router && cm?.masterLimiter) {
            router.connectSource(cm.masterLimiter);
        }

        if (mode === 'webrtc' && window.ToneCastManager && router?.initialized) {
            try {
                if (!window.castManager) {
                    window.castManager = new window.ToneCastManager(router);
                    await window.castManager.initialize();
                }
                await window.castManager.startCasting('broadcast');
            } catch (e) { }
        }

        try {
            const nativeCtx = Tone.context.rawContext._nativeAudioContext || Tone.context.rawContext;
            
            const setupAudioPipe = async () => {
                if (!nativeCtx.audioWorklet) return;
                try {
                    await nativeCtx.audioWorklet.addModule('src/audio/processors/CastProcessor.js');
                    const castWorkletNode = new AudioWorkletNode(nativeCtx, 'cast-processor');
                    window.castWorkletNode = castWorkletNode;

                    if (nativeCtx.state !== 'running') await nativeCtx.resume();

                    // PCM Batching State
                    const BATCH_SIZE = 4096;
                    let floatBatchBuffer = new Float32Array(BATCH_SIZE * 2);
                    let pcm24Buffer = new Uint8Array(BATCH_SIZE * 2 * 3);
                    let frameCount = 0;

                    castWorkletNode.port.onmessage = (event) => {
                        const { left: leftData, right: rightData } = event.data;
                        if (!leftData || !rightData) return;

                        frameCount++;
                        const bufferLen = leftData.length;

                        // Resize if needed
                        if (pcm24Buffer.length !== bufferLen * 2 * 3) pcm24Buffer = new Uint8Array(bufferLen * 2 * 3);
                        if (floatBatchBuffer.length !== bufferLen * 2) floatBatchBuffer = new Float32Array(bufferLen * 2);

                        for (let i = 0; i < bufferLen; i++) {
                            let l = leftData[i] * 0.95;
                            let r = rightData[i] * 0.95;

                            if (l > 1) l = 1; else if (l < -1) l = -1;
                            if (r > 1) r = 1; else if (r < -1) r = -1;

                            if (window._castMode === 'hls') {
                                floatBatchBuffer[i * 2] = l;
                                floatBatchBuffer[i * 2 + 1] = r;
                            } else {
                                const l_int = Math.floor(l * 8388607);
                                const r_int = Math.floor(r * 8388607);
                                pcm24Buffer[i * 6] = l_int & 0xFF;
                                pcm24Buffer[i * 6 + 1] = (l_int >> 8) & 0xFF;
                                pcm24Buffer[i * 6 + 2] = (l_int >> 16) & 0xFF;
                                pcm24Buffer[i * 6 + 3] = r_int & 0xFF;
                                pcm24Buffer[i * 6 + 4] = (r_int >> 8) & 0xFF;
                                pcm24Buffer[i * 6 + 5] = (r_int >> 16) & 0xFF;
                            }
                        }

                        const invoke = window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke;
                        if (invoke) {
                            if (window._castMode === 'hls') {
                                const base64 = btoa(String.fromCharCode.apply(null, new Uint8Array(floatBatchBuffer.buffer)));
                                invoke('push_cast_audio', { data: base64 }).catch(() => { });
                            } else {
                                const base64 = btoa(String.fromCharCode.apply(null, pcm24Buffer));
                                invoke('push_ws_audio', { data: base64 }).catch(() => { });
                            }
                        }
                    };

                    // Connect the worklet to the source
                    let castStream = null;
                    if (cm?.getCastStream) {
                        castStream = cm.getCastStream();
                    }

                    if (castStream) {
                        const source = nativeCtx.createMediaStreamSource(castStream);
                        source.connect(castWorkletNode);
                        console.log("🔗 Cast Worklet connected to DEDICATED stream");
                    } else if (cm?.masterLimiter) {
                        // Direct connection if MediaStream is not available
                        // We need a bridge since Tone.Limiter is not a native AudioNode
                        // But Tone.js nodes have an 'output' property which is a native node
                        if (cm.masterLimiter.output) {
                            cm.masterLimiter.output.connect(castWorkletNode);
                            console.log("🔗 Cast Worklet connected directly to masterLimiter.output");
                        }
                    }

                    console.log(`✅ Audio Pipeline ACTIVE (${window._castMode.toUpperCase()} @ ${nativeCtx.sampleRate}Hz)`);
                } catch (e) {
                    console.error("❌ Failed to setup audio pipe worklet:", e);
                }
            };

            await setupAudioPipe();
        } catch (e) {
            audioPipeActive = false;
        }
    }

    window.stopAudioPiping = function () {
        if (audioPipeNode) {
            audioPipeNode.disconnect();
            audioPipeNode = null;
        }
        audioPipeActive = false;
        if (window.stopTestTone) window.stopTestTone();
    }

    /**
     * Play a test tone to verify audio capture is working
     */
    function playTestTone(durationSec = 2) {
        if (testToneOsc) return;
        try {
            testToneOsc = new Tone.Oscillator(440, 'sine');
            testToneGain = new Tone.Gain(-12);
            const cm = window.audioService?.contextManager;
            if (cm?.masterLimiter) {
                testToneOsc.connect(testToneGain);
                testToneGain.connect(cm.masterLimiter);
            } else {
                testToneOsc.connect(testToneGain);
                testToneGain.toDestination();
            }
            testToneOsc.start();
            setTimeout(() => {
                stopTestTone();
            }, durationSec * 1000);
        } catch (e) {
            console.error('❌ Test tone failed:', e);
        }
    }

    /**
     * Stop the test tone
     */
    function stopTestTone() {
        if (testToneOsc) {
            testToneOsc.stop();
            testToneOsc.dispose();
            testToneOsc = null;
        }
        if (testToneGain) {
            testToneGain.dispose();
            testToneGain = null;
        }
    }

    window.startChromecastDiscovery = startChromecastDiscovery;
    window.startAudioPiping = startAudioPiping;
    window.playTestTone = playTestTone;
    window.stopTestTone = stopTestTone;

    // Cast button click - open dialog and start discovery
    document.addEventListener('DOMContentLoaded', () => {
        const castBtn = document.getElementById('cast-btn');
        const castDialog = document.getElementById('cast-dialog');
        const closeCastBtn = document.getElementById('close-cast-button');
        const refreshCastBtn = document.getElementById('refresh-cast-btn');

        if (castBtn && castDialog) {
            castBtn.addEventListener('click', async () => {
                console.log('🎬 Cast button clicked - starting discovery');
                if (window.Tone && Tone.context.state !== 'running') {
                    await Tone.start();
                }
                castDialog.showModal();
                startChromecastDiscovery();
            });
        }

        if (closeCastBtn && castDialog) {
            closeCastBtn.addEventListener('click', () => castDialog.close());
        }

        if (refreshCastBtn) {
            refreshCastBtn.addEventListener('click', () => startChromecastDiscovery());
        }
        
        // Manual IP Entry
        const manualCastBtn = document.getElementById('manual-cast-btn');
        const manualCastIp = document.getElementById('manual-cast-ip');
        if (manualCastBtn && manualCastIp) {
            manualCastBtn.addEventListener('click', () => {
                const ip = manualCastIp.value.trim();
                if (ip) {
                    const device = {
                        id: `manual-${ip.replace(/\./g, '_')}`,
                        name: `Manual IP: ${ip}`,
                        ip: ip,
                        port: 8009,
                        protocol: 'chromecast'
                    };
                    addDeviceToList(device);
                }
            });
        }
    });

})();

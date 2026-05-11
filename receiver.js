/**
 * MXS-004 Studio Receiver Logic
 * v13.8.76 - High-Fidelity Mirroring + PCM Streaming
 */

(function() {
    var ws = null;
    var lastState = null;
    var audioCtx = null;
    var pcmPlayer = null;
    var lastFrameTime = performance.now();
    var lfoPhase1 = 0;
    var lfoPhase2 = 0;

    var debugEl = document.getElementById('debug-log');
    var statusEl = document.getElementById('init-status');
    var overlay = document.getElementById('init-overlay');
    var studioRoot = document.getElementById('studio-root');
    var cursorEl = document.getElementById('ghost-cursor');

    function remoteLog(msg) {
        console.log(msg);
        if (debugEl) {
            debugEl.innerHTML += '<br>' + msg;
            debugEl.scrollTop = debugEl.scrollHeight;
        }
    }

    // ============================================================
    // UI CONSTRUCTION (MIRRORING APP STRUCTURE)
    // ============================================================
    function initUI() {
        var container = document.getElementById('tracks-container');
        container.innerHTML = '';
        for (var i = 0; i < 4; i++) {
            var track = document.createElement('div');
            track.className = 'track';
            track.id = 'track-' + i;
            track.innerHTML = `
                <div class="track-header">TRACK ${i+1}</div>
                <div class="track-time-display">00:00:00</div>
                <div class="status-indicator status-ready">Ready</div>
                <div class="waveform-box">
                    <div class="waveform-labels">
                        <div class="waveform-label-external">L</div>
                        <div class="waveform-label-external">R</div>
                    </div>
                    <div class="waveform-canvas-container">
                        <canvas class="waveform-canvas" width="242" height="26"></canvas>
                        <canvas class="waveform-canvas" width="242" height="26"></canvas>
                        <div class="loop-marker loop-start-marker"></div>
                        <div class="loop-marker loop-end-marker"></div>
                    </div>
                </div>
                <div class="control-group pa-mic-adjustment" style="display:flex;">
                    <label style="font-size:0.72em;">Input Gain</label>
                    <input type="range" class="pa-mic-slider" min="-48" max="48" step="0.1" value="0">
                    <span class="pa-mic-value" style="font-size:0.72em;">0.0 dB</span>
                </div>
                <div class="track-buttons">
                    <button class="rec-btn">REC</button>
                    <button>STOP</button>
                    <button>PLAY</button>
                    <button>REV</button>
                </div>
                <div class="main-controls">
                    <div class="knob-container"><label>Pitch</label><input type="range" min="-100" max="100" value="0"><span class="param-value">0%</span></div>
                    <div class="knob-container"><label>Vol</label><input type="range" min="-48" max="6" value="0"><span class="param-value">0dB</span></div>
                    <div class="knob-container"><label>Pan</label><input type="range" min="-1" max="1" step="0.01" value="0"><span class="param-value">0</span></div>
                </div>
            `;
            container.appendChild(track);
        }
    }

    // ============================================================
    // PCM AUDIO STREAMING (BINARY OVER WS)
    // ============================================================
    function initAudio() {
        if (audioCtx) return;
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
        
        // Simple Buffer Queue Player
        var bufferQueue = [];
        var scriptNode = audioCtx.createScriptProcessor(4096, 0, 2);
        
        scriptNode.onaudioprocess = function(e) {
            var outL = e.outputBuffer.getChannelData(0);
            var outR = e.outputBuffer.getChannelData(1);
            
            if (bufferQueue.length > 0) {
                var chunk = bufferQueue.shift();
                // chunk is Int16Array (L, R, L, R...)
                for (var i = 0; i < outL.length; i++) {
                    if (i * 2 < chunk.length) {
                        outL[i] = chunk[i * 2] / 32768;
                        outR[i] = chunk[i * 2 + 1] / 32768;
                    }
                }
            } else {
                outL.fill(0);
                outR.fill(0);
            }
        };
        
        scriptNode.connect(audioCtx.destination);
        pcmPlayer = {
            feed: function(data) {
                var int16 = new Int16Array(data);
                bufferQueue.push(int16);
                if (bufferQueue.length > 20) bufferQueue.shift(); // Keep latency low
            }
        };
        remoteLog("🔊 PCM Audio Engine Initialized.");
    }

    // ============================================================
    // STATE RENDERING
    // ============================================================
    function renderState(state) {
        if (!state) return;
        lastState = state;

        if (studioRoot.style.opacity === '0' || studioRoot.style.opacity === '') {
            studioRoot.style.opacity = '1';
            overlay.style.display = 'none';
        }

        // Cursor
        if (state.cursor && cursorEl) {
            cursorEl.style.display = 'block';
            cursorEl.style.left = (state.cursor.x * 100) + '%';
            cursorEl.style.top = (state.cursor.y * 100) + '%';
            cursorEl.className = state.cursor.isClicking ? 'clicking' : '';
        }

        // Master
        if (state.master) {
            var m = state.master;
            var mv = document.getElementById('master-volume');
            if (mv) mv.value = m.volume;
            var rb = document.getElementById('master-record-button');
            if (rb) rb.className = m.isRecording ? 'rec-btn recording' : 'rec-btn';
        }

        // Tracks
        if (state.tracks) {
            state.tracks.forEach(function(t, i) {
                var el = document.getElementById('track-' + i);
                if (!el) return;
                
                var si = el.querySelector('.status-indicator');
                if (si) {
                    si.textContent = t.statusText || 'Ready';
                    si.className = 'status-indicator status-' + (t.statusType || 'ready');
                }

                var rb = el.querySelector('.rec-btn');
                if (rb) rb.className = t.isRecording ? 'rec-btn recording' : 'rec-btn';

                // Update knobs if changed
                if (t.knobs) {
                    var sliders = el.querySelectorAll('input[type="range"]');
                    var values = el.querySelectorAll('.param-value');
                    // This is a bit brittle, better to target by index or data-param
                    // For now, just update the main ones
                    if (values[0]) values[0].textContent = t.knobs.pitch + '%';
                    if (values[1]) values[1].textContent = t.knobs.vol + 'dB';
                    if (values[2]) values[2].textContent = t.knobs.pan;
                }
            });
        }
    }

    // ============================================================
    // NETWORKING
    // ============================================================
    function connectWS(url) {
        remoteLog("🔌 Connecting to Studio: " + url);
        ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';

        ws.onopen = function() {
            remoteLog("✅ Connected to Studio Stream.");
            statusEl.textContent = "CONNECTED • STREAMING AUDIO";
            initAudio();
        };

        ws.onmessage = function(e) {
            if (e.data instanceof ArrayBuffer) {
                if (pcmPlayer) pcmPlayer.feed(e.data);
            } else {
                try {
                    var msg = JSON.parse(e.data);
                    if (msg.type === 'STATE_UPDATE') renderState(msg.state);
                } catch(err) {}
            }
        };

        ws.onclose = function() {
            remoteLog("🛑 Connection Lost. Retrying...");
            setTimeout(function() { connectWS(url); }, 2000);
        };
    }

    // ============================================================
    // CAST SDK INTEGRATION
    // ============================================================
    window.onload = function() {
        initUI();
        
        var context = cast.framework.CastReceiverContext.getInstance();
        var playerManager = context.getPlayerManager();

        playerManager.setMessageInterceptor(cast.framework.messages.MessageType.LOAD, function(request) {
            remoteLog("📥 LOAD Intercepted");
            if (request.media && request.media.contentId) {
                try {
                    var url = new URL(request.media.contentId);
                    var machineIp = url.hostname;
                    var wsUrl = "ws://" + machineIp + ":8080";
                    connectWS(wsUrl);

                    // Map fonts
                    var style = document.createElement('style');
                    style.innerHTML = `
                        @font-face { font-family: 'Mexcellent'; src: url('http://${machineIp}:8080/fonts/MexcellentRg.otf'); }
                        @font-face { font-family: 'Mexcellent 3D'; src: url('http://${machineIp}:8080/fonts/Mexcellent3d.otf'); }
                    `;
                    document.head.appendChild(style);
                } catch(e) { remoteLog("❌ LOAD parse err: " + e.message); }
            }
            return null;
        });

        context.addCustomMessageListener('urn:x-cast:com.nowmultimedia.webrtc', function(event) {
            var data = event.data;
            if (data && typeof data.payload === 'string') {
                try { data = JSON.parse(data.payload); } catch(e){}
            }
            if (data.type === 'STATE_UPDATE') renderState(data.state);
        });

        context.start({ disableIdleTimeout: true });
        remoteLog("📡 Cast SDK Ready.");
    };

    // Animation Loop
    function animate() {
        var now = performance.now();
        var dt = (now - lastFrameTime) / 1000;
        lastFrameTime = now;
        if (lastState && lastState.master) {
            var m = lastState.master;
            if (m.lfo1Active) {
                lfoPhase1 += 2 * Math.PI * (m.lfo1Freq || 0.5) * dt;
                var b1 = document.getElementById('lfo-meter-bar');
                if (b1) b1.style.width = (Math.abs(Math.sin(lfoPhase1)) * 100) + '%';
            }
            if (m.lfo2Active) {
                lfoPhase2 += 2 * Math.PI * (m.lfo2Freq || 0.5) * dt;
                var b2 = document.getElementById('lfo2-meter-bar');
                if (b2) b2.style.width = (Math.abs(Math.sin(lfoPhase2)) * 100) + '%';
            }
        }
        requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);

    // Tap to enable audio context
    document.addEventListener('click', function() {
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
            remoteLog("🔊 AudioContext Resumed.");
        }
    }, { once: false });

})();

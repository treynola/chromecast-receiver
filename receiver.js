/**
 * MXS-004 Studio Receiver Logic [High-Fidelity Mirror]
 * v13.8.83 - Exact GUI Mapping + Ring Buffer Audio
 */

(function() {
    var ws = null;
    var lastState = null;
    var audioCtx = null;
    var lastFrameTime = window.performance.now();
    var lfoPhase1 = 0;
    var lfoPhase2 = 0;

    var debugEl = document.getElementById('debug-log');
    var overlay = document.getElementById('failsafe-reveal');
    var studioRoot = document.getElementById('studio-root');
    var cursorEl = document.getElementById('ghost-cursor');

    function log(m) {
        console.log(m);
        if (debugEl) {
            debugEl.innerHTML += '<br>' + m;
            debugEl.scrollTop = debugEl.scrollHeight;
        }
    }

    // --- EXACT TRACK UI FACTORY ---
    function buildTracks() {
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
                    <div class="waveform-labels"><div class="waveform-label-external">L</div><div class="waveform-label-external">R</div></div>
                    <div class="waveform-canvas-container"><canvas class="waveform-canvas"></canvas><canvas class="waveform-canvas"></canvas></div>
                </div>
                <div class="control-group pa-mic-adjustment">
                    <label style="font-size:0.72em;">Input Gain</label>
                    <input type="range" class="pa-mic-slider" min="-48" max="48" step="0.1" value="0">
                    <span class="pa-mic-value">0.0 dB</span>
                </div>
                <div class="track-buttons">
                    <button class="rec-btn">REC</button>
                    <button>STOP</button>
                    <button class="play-btn">PLAY</button>
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
        
        // Sample Pads
        var grid = document.getElementById('sample-grid');
        grid.innerHTML = '';
        for (var p = 1; p <= 20; p++) {
            var btn = document.createElement('button');
            btn.className = 'sample-btn';
            btn.id = 'sample-' + p;
            btn.textContent = p;
            grid.appendChild(btn);
        }
    }

    // --- ROBUST PCM RING BUFFER ---
    var MAX_BUFFER = 48000 * 4; // 2 seconds of stereo
    var pcmBuffer = new Float32Array(MAX_BUFFER);
    var writePtr = 0; var readPtr = 0;
    var rxCount = 0;

    function feedPCM(data) {
        var int16 = new Int16Array(data);
        for (var i = 0; i < int16.length; i++) {
            pcmBuffer[writePtr] = int16[i] / 32768;
            writePtr = (writePtr + 1) % MAX_BUFFER;
        }
        rxCount++;
        if (rxCount % 500 === 0) log("🔊 Audio Stream: Active (" + rxCount + " chunks)");
    }

    function initAudio() {
        if (audioCtx) return;
        log("🔊 Initializing High-Fidelity PCM Engine...");
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
        var node = audioCtx.createScriptProcessor(4096, 0, 2);
        node.onaudioprocess = function(e) {
            var outL = e.outputBuffer.getChannelData(0);
            var outR = e.outputBuffer.getChannelData(1);
            var avail = (writePtr - readPtr + MAX_BUFFER) % MAX_BUFFER;
            if (avail < 8192) { outL.fill(0); outR.fill(0); return; }
            for (var i = 0; i < 4096; i++) {
                outL[i] = pcmBuffer[readPtr]; readPtr = (readPtr + 1) % MAX_BUFFER;
                outR[i] = pcmBuffer[readPtr]; readPtr = (readPtr + 1) % MAX_BUFFER;
            }
        };
        node.connect(audioCtx.destination);
    }

    // --- STATE RENDERING ---
    function renderState(state) {
        if (!state) return;
        lastState = state;
        
        // Hide Failsafe Overlay
        if (overlay && overlay.style.display !== 'none') {
            overlay.style.display = 'none';
            if (studioRoot) studioRoot.style.opacity = '1';
            log("🎬 GUI REVEALED: Signal Lock Established.");
        }

        // Cursor
        if (state.cursor && cursorEl) {
            cursorEl.style.display = 'block';
            cursorEl.style.left = (state.cursor.x * 100) + '%';
            cursorEl.style.top = (state.cursor.y * 100) + '%';
            cursorEl.style.background = state.cursor.isClicking ? 'rgba(255,0,0,0.6)' : 'rgba(250,215,142,0.4)';
        }

        // Master
        if (state.master) {
            var m = state.master;
            var mt = document.getElementById('recording-time-display');
            if (mt && state.transport) mt.textContent = state.transport.position;
            var mv = document.getElementById('master-volume');
            if (mv) mv.value = m.volume;
            var mvv = document.getElementById('master-volume-value');
            if (mvv) mvv.textContent = m.volume.toFixed(1) + ' dB';
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
                var tt = el.querySelector('.track-time-display');
                if (tt) tt.textContent = t.time || '00:00:00';
                var rb = el.querySelector('.rec-btn');
                if (rb) rb.className = t.isRecording ? 'rec-btn recording' : 'rec-btn';
            });
        }
        
        // Samples
        if (state.samples) {
            state.samples.forEach(function(s, i) {
                var btn = document.getElementById('sample-' + (i+1));
                if (btn) btn.className = s.isPlaying ? 'sample-btn active' : 'sample-btn';
            });
        }
    }

    function connect(url) {
        log("🔌 Connecting to Studio: " + url);
        ws = new WebSocket(url); ws.binaryType = 'arraybuffer';
        ws.onopen = function() { log("✅ Handshake Success!"); initAudio(); };
        ws.onmessage = function(e) {
            if (e.data instanceof ArrayBuffer) { feedPCM(e.data); }
            else { try { var m = JSON.parse(e.data); if (m.type==='STATE_UPDATE') renderState(m.state); } catch {} }
        };
        ws.onclose = function() { log("🛑 Connection Lost. Retrying..."); setTimeout(function(){ connect(url); }, 2000); };
    }

    window.onload = function() {
        buildTracks();
        var ctx = cast.framework.CastReceiverContext.getInstance();
        ctx.getPlayerManager().setMessageInterceptor(cast.framework.messages.MessageType.LOAD, function(req) {
            if (req.media && req.media.contentId) {
                try {
                    var u = new URL(req.media.contentId);
                    connect("ws://" + u.hostname + ":8080");
                    var style = document.createElement('style');
                    style.innerHTML = `
                        @font-face { font-family: 'Mexcellent'; src: url('http://${u.hostname}:8080/fonts/MexcellentRg.otf'); }
                        @font-face { font-family: 'Mexcellent 3D'; src: url('http://${u.hostname}:8080/fonts/Mexcellent3d.otf'); }
                    `;
                    document.head.appendChild(style);
                } catch {}
            }
            return null;
        });
        ctx.addCustomMessageListener('urn:x-cast:com.nowmultimedia.webrtc', function(e) {
            var d = e.data; if (typeof d.payload === 'string') try { d = JSON.parse(d.payload); } catch {}
            if (d.type === 'STATE_UPDATE') renderState(d.state);
        });
        ctx.start({ disableIdleTimeout: true });
        log("📡 Receiver Suite Active.");
    };

    function animate() {
        var now = window.performance.now(); var dt = (now - lastFrameTime) / 1000; lastFrameTime = now;
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
    document.addEventListener('click', function() { if (audioCtx) audioCtx.resume(); }, { once: false });
})();

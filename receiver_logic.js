

      window.SERVER_PORT = "{{SERVER_PORT}}";
      window.SECURITY_TOKEN = "{{SECURITY_TOKEN}}";

      // [v13.9.505] AUTO CACHE-BUST: If no ?cb= param, redirect to self with one.
      // Fires exactly once per cast session — no loop because redirect URL already has cb=.
      (function () {
        if (window.location.search.indexOf('cb=') === -1) {
          var freshUrl = window.location.href.split('?')[0] + '?cb=' + Date.now();
          window.location.replace(freshUrl);
          // Execution stops here — the browser navigates away immediately.
        }
      })();

      (function () {
        var audioCtx = null;
        var masterGain = null;
        var workletNode = null;
        var peerConnection = null;
        window._useWebRTC = false; // [v13.9.504] APOR V2 Primary (LOCK)
        var configReceived = false;
        var targetRate = 48000;
        window._studioRate = 48000;
        window._hwRate = 48000;
        var autoDiscoveryFallbackTimeoutId = null;
        var autoUnlockIntervalId = null;
        var pendingBinaryFrames = [];
        const VERSION_TAG = "v13.9.505-APORv2";
        const CUSTOM_NAMESPACE = "urn:x-cast:com.nowmultimedia.mxs004";

        // [v13.9.504] Dynamically build a valid 2-second silent WAV loop for TV OS media wake-lock
        function createSilentWavUrl() {
          const sampleRate = 8000;
          const numSamples = sampleRate * 2; // 2 seconds
          const blockAlign = 2; // 16-bit Mono
          const byteRate = sampleRate * blockAlign;
          const subChunk2Size = numSamples * blockAlign;
          const chunkSize = 36 + subChunk2Size;
          
          const buffer = new ArrayBuffer(44 + subChunk2Size);
          const view = new DataView(buffer);
          
          // RIFF identifier
          view.setUint32(0, 0x52494646, false); // "RIFF"
          view.setUint32(4, chunkSize, true);
          view.setUint32(8, 0x57415645, false); // "WAVE"
          view.setUint32(12, 0x666d7420, false); // "fmt "
          view.setUint32(16, 16, true);
          view.setUint16(20, 1, true);
          view.setUint16(22, 1, true);
          view.setUint32(24, sampleRate, true);
          view.setUint32(28, byteRate, true);
          view.setUint16(32, blockAlign, true);
          view.setUint16(34, 16, true);
          view.setUint32(36, 0x64617461, false); // "data"
          view.setUint32(40, subChunk2Size, true);
          
          // [v13.9.504] Write alternating 1 and -1 to render an inaudible dither signal (-90.3 dBFS)
          // to bypass Chromium background tab silence optimization.
          for (let i = 0; i < numSamples; i++) {
            const val = (i % 2 === 0) ? 1 : -1;
            view.setInt16(44 + i * 2, val, true);
          }
          
          const blob = new Blob([buffer], { type: 'audio/wav' });
          return URL.createObjectURL(blob);
        }

        function queueBinaryFrame(buffer) {
          if (!(buffer instanceof ArrayBuffer)) return;
          if (workletNode) {
            try {
              workletNode.port.postMessage(buffer, [buffer]);
            } catch (e) {
              workletNode.port.postMessage(buffer);
            }
            return;
          }

          if (pendingBinaryFrames.length > 240) {
            pendingBinaryFrames.shift();
          }
          pendingBinaryFrames.push(buffer);
        }

        function flushPendingBinaryFrames() {
          if (!workletNode || pendingBinaryFrames.length === 0) return;
          const queued = pendingBinaryFrames.splice(0, pendingBinaryFrames.length);
          queued.forEach((buffer) => queueBinaryFrame(buffer));
        }

        function teardownWebRtcFallback() {
          const audioUnlocker = document.getElementById("audio-unlocker");
          if (audioUnlocker) {
            try {
              audioUnlocker.muted = true;
              audioUnlocker.pause();
            } catch (e) {}
            audioUnlocker.srcObject = null;
          }

          if (peerConnection) {
            try {
              peerConnection.onicecandidate = null;
              peerConnection.ontrack = null;
              peerConnection.onconnectionstatechange = null;
              peerConnection.close();
            } catch (e) {}
            peerConnection = null;
          }
        }
        const KNOB_CONFIGS = [
          { l: "Pitch", p: "pitch" },
          { l: "Volume", p: "vol" },
          { l: "Pan", p: "pan" },
          { l: "Treble", p: "treble" },
          { l: "Mid Freq", p: "mid_freq" },
          { l: "Mid Gain", p: "mid_gain" },
          { l: "Bass", p: "bass" },
        ];

        function buildGUI() {
          var g = document.getElementById("sample-grid");
          if (g) {
            g.innerHTML = "";
            for (var p = 1; p <= 20; p++) {
              var b = document.createElement("button");
              b.className = "sample-btn";
              b.id = "sample-" + p;
              b.textContent = p;
              g.appendChild(b);
            }
          }
          var grid = document.getElementById("main-grid");
          for (var i = 0; i < 4; i++) {
            if (document.getElementById("track-" + i)) continue;
            var t = document.createElement("div");
            t.className = "track";
            t.id = "track-" + i;
            t.innerHTML = `
                        <div class="track-header">TRACK ${i + 1}</div>
                        <div class="track-time-display" id="t-time-${i}">00:00:00</div>
                        <div class="status-indicator status-ready" id="t-st-${i}"><div class="scrolling-text-wrapper"><span class="scrolling-text" id="t-scroll-${i}">Ready</span></div></div>
                        <div class="waveform-box"><div class="waveform-labels"><div class="waveform-label-external">L</div><div class="waveform-label-external">R</div></div><div class="waveform-canvas-container"><canvas class="waveform-canvas track-waveform-canvas-L" id="t-wf-l-${i}" width="238" height="26"></canvas><canvas class="waveform-canvas track-waveform-canvas-R" id="t-wf-r-${i}" width="238" height="26"></canvas><div class="loop-marker loop-start-marker" id="t-ls-m-${i}"></div><div class="loop-marker loop-end-marker" id="t-le-m-${i}"></div></div></div>
                        <div class="control-group"><div class="track-input-layout"><label style="font-size: 0.72em;">Input</label><select class="input-source"><option>Microphone</option></select></div><span class="file-name-display" id="t-file-${i}"></span></div>
                        <div class="control-group pa-mic-adjustment" id="t-gain-grp-${i}" style="display: flex;"><label style="font-size: 0.72em;">Input Gain</label><input type="range" class="pa-mic-slider" id="t-gain-sl-${i}" min="-48" max="48" step="0.1"><span class="pa-mic-value" id="t-gain-val-${i}" style="font-size: 0.72em;">0.0 dB</span></div>
                        <div class="track-buttons"><button id="t-rec-${i}">REC</button><button id="t-stop-${i}">STOP</button><button id="t-play-${i}">PLAY</button><button id="t-rev-${i}">REV</button></div>
                        <div class="loop-controls active" id="t-loop-ctrl-${i}" style="display: flex; opacity: 1;"><div class="loop-grid-layout"><div class="loop-line-1" style="display: flex; width: 100%; gap: 4px;"><div style="flex: 1; display: flex; align-items: center; justify-content: flex-start;"><label style="font-size: 0.72em;">Loop Start</label></div><div style="flex: 1; display: flex; align-items: center; justify-content: space-between;"><label style="font-size: 0.72em;">Loop End</label><button class="slice-trigger-btn"><i class="fa-solid fa-scissors"></i></button></div></div><div class="loop-line-2 slider-wrapper"><input type="range" class="loop-start-slider" id="t-ls-sl-${i}" min="0" max="1" step="0.01"><input type="range" class="loop-end-slider" id="t-le-sl-${i}" min="0" max="1" step="0.01"></div><div class="loop-line-3"><span class="param-value" id="t-ls-val-${i}">0.00s</span><span class="param-value" id="t-le-val-${i}">1.00s</span></div></div></div>
                        <div class="fx-chain-container"><div class="fx-chain-title">Effects Chain:</div><div class="fx-chain-controls"><button class="fx-chain-arrow">&lt;</button>${[0, 1, 2, 3, 4, 5, 6].map((idx) => `<div class="fx-chain-slot"><input type="checkbox" id="t-fx-chk-${i}-${idx}"><label class="fx-chain-slot-label" id="t-fx-lbl-${i}-${idx}">${idx + 1}</label></div>`).join("")}<button class="fx-chain-arrow">&gt;</button></div></div>
                        <div class="control-group track-bottom-layout"><label class="margin-0">Effects:</label><select class="effect-type-select flex-1-no-margin"></select></div>
                        <div class="main-controls">${KNOB_CONFIGS.map((cfg) => `<div class="knob-container"><div class="knob-label-group"><label>${cfg.l}</label><span class="param-value" id="t-${cfg.p}-val-${i}">0</span><input type="checkbox" class="lfo-assign" id="t-lfo1-chk-${i}-${cfg.p}" data-lfo-assign="${cfg.p}" data-lfo-index="1"><input type="checkbox" class="lfo-assign lfo2-assign" id="t-lfo2-chk-${i}-${cfg.p}" data-lfo-assign="${cfg.p}" data-lfo-index="2"></div><div class="slider-wrapper"><input type="range" id="t-${cfg.p}-sl-${i}" class="pa-mic-slider"></div></div>`).join("")}</div><div class="meter-container" style="margin-top:auto; height:6px;"><div id="t-mtr-${i}" class="meter-bar"></div></div>`;
            grid.appendChild(t);
          }
          updateScale();
        }

        function updateScale() {
          const winW = window.innerWidth;
          const winH = window.innerHeight;
          document.documentElement.style.setProperty(
            "--scale",
            Math.min(winW / 1440, winH / 810) * 0.96,
          );
        }

        function preInitAudioContext() {
          const HARDWARE_RATE = window._hwRate || 48000;
          relayLogToStudio("🛠️ TV: preInitAudioContext called. audioCtx=" + !!audioCtx);
          if (!audioCtx || window._lastHwRate !== HARDWARE_RATE) {
            window._lastHwRate = HARDWARE_RATE;
            if (audioCtx) {
              relayLogToStudio(
                `📡 TV: Reseting AudioContext for Hardware Rate: ${HARDWARE_RATE}Hz`,
              );
              try {
                audioCtx.close();
              } catch (e) {}
              audioCtx = null;
              masterGain = null;
              workletNode = null;
            }
            try {
              relayLogToStudio("🛠️ TV: Creating new AudioContext...");
              audioCtx = new window.AudioContext({ latencyHint: "playback" });
              relayLogToStudio("🛠️ TV: AudioContext created. State: " + audioCtx.state);

              masterGain = audioCtx.createGain();
              masterGain.gain.value = 1.0;
              masterGain.connect(audioCtx.destination);
              relayLogToStudio("🛠️ TV: masterGain connected.");

              const keepAlive = audioCtx.createOscillator();
              keepAlive.frequency.value = 20000;
              const g = audioCtx.createGain();
              g.gain.value = 0.002;
              keepAlive.connect(g);
              g.connect(audioCtx.destination);
              keepAlive.start();
              relayLogToStudio("🛠️ TV: keepAlive oscillator started.");

              const audioUnlocker = document.getElementById("audio-unlocker");
              relayLogToStudio("🛠️ TV: audioUnlocker found: " + !!audioUnlocker);
              if (audioUnlocker) {
                try {
                  const mediaSource = audioCtx.createMediaElementSource(audioUnlocker);
                  window._mediaSourceNode = mediaSource;
                  mediaSource.connect(masterGain);
                  relayLogToStudio("✅ TV: MediaElementSource connected to AudioContext early.");
                } catch (e) {
                  relayLogToStudio("⚠️ TV: MediaElementSource failed: " + e.message);
                }
                
                if (!audioUnlocker._hasUnlockListeners) {
                  audioUnlocker._hasUnlockListeners = true;
                  audioUnlocker.addEventListener("play", function() {
                    // relayLogToStudio("🎵 TV: audio-unlocker 'play' event detected.");
                    resumeAudio();
                  });
                  audioUnlocker.addEventListener("playing", function() {
                    // relayLogToStudio("🎵 TV: audio-unlocker 'playing' event detected.");
                    resumeAudio();
                  });
                }

                // [v13.9.505] Run the programmatic silent WAV fallback conditionally
                // (only in non-Cast mode) to prevent conflict with Cast SDK PlayerManager.
                const isCastSupported = typeof cast !== "undefined" && cast.framework;
                if (!isCastSupported) {
                  if (!audioUnlocker.src) {
                    audioUnlocker.src = createSilentWavUrl();
                  }
                  audioUnlocker.play().catch(function(e) {
                    relayLogToStudio("⚠️ TV: play silent WAV failed - " + e.message);
                  });
                } else {
                  relayLogToStudio("📡 TV: Skipping audioUnlocker play in Cast mode (using PlayerManager wake-lock instead).");
                }
              }

              const castMedia = document.getElementById("cast-media-element");
              if (castMedia) {
                try {
                  const castSource = audioCtx.createMediaElementSource(castMedia);
                  castSource.connect(masterGain);
                  castMedia._connectedToAudioCtx = true;
                  relayLogToStudio("✅ TV: Dedicated Cast SDK Media Element connected to AudioContext early.");
                } catch (e) {
                  relayLogToStudio("⚠️ TV: Dedicated Cast Media Element connection failed: " + e.message);
                }
              }
              
              resumeAudio();
            } catch (e) {
              relayLogToStudio(`❌ TV ERROR: preInitAudioContext failed - ${e.message}`);
            }
          }
        }

        let lastInitAttempt = 0;
        async function initAudio() {
          // [v13.9.504] WebRTC TRANSITION: Disable legacy PCM worklet if WebRTC is the goal
          if (window._useWebRTC) {
            relayLogToStudio("📡 TV: initAudio (Legacy) skipped because WebRTC is primary.");
            preInitAudioContext(); // Still ensure native context is warmed up
            return;
          }

          // [v13.9.504] HARDWARE LOCK: Never initialize until we have a verified sample rate from the Studio.
          if (!configReceived) {
            relayLogToStudio("⏳ TV: Waiting for BRIDGE_CONFIG handshake...");
            return;
          }

          // [v13.9.504] THROTTLE: Prevent tight-loop retries if init fails (e.g. 404 or SyntaxError)
          const now = Date.now();
          if (now - lastInitAttempt < 5000) return;
          lastInitAttempt = now;
          
          preInitAudioContext();

          if (!audioCtx) {
            relayLogToStudio("❌ TV ERROR: initAudio failed - audioCtx is null");
            return;
          }

          if (workletNode) {
            return;
          }

          try {
            let workletUrl = `pcm-player-worklet-v13.9.505.js?cb=${Date.now()}`;
            if (currentBridgeIp && currentBridgePort) {
              const port = currentBridgePort || "8080";
              workletUrl = `http://${currentBridgeIp}:${port}/receiver/${workletUrl}`;
              relayLogToStudio(`📡 TV: Loading Worklet from Studio: ${workletUrl}`);
            }

            await audioCtx.audioWorklet.addModule(workletUrl);

            // [v13.9.504] DYNAMIC RATE TRANSFORMATION
            // Since the Rust backend now handles authoritative resampling (Studio -> TV),
            // the receiver worklet should operate at unity rate (1.0).
            const studioRate = window._studioRate || 48000;
            const actualRate = audioCtx.sampleRate;
            const baseRateRatio = 1.0; // Backend Resampled Alignment

            console.log(
              `📏 TV Clock: requested=${window._hwRate || 48000}Hz actual=${actualRate}Hz | Studio: ${studioRate}Hz | Unity Sync Active`,
            );
            relayLogToStudio(
              `📏 TV Clock: ${actualRate}Hz | Studio: ${studioRate}Hz | Sync: APORv2 Unity`,
            );

            workletNode = new AudioWorkletNode(
              audioCtx,
              "pcm-player-worklet",
              {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [2],
                processorOptions: {
                  baseRateRatio: baseRateRatio,
                  studioRate: studioRate,
                },
              },
            );
            workletNode.connect(masterGain);
            flushPendingBinaryFrames();

            // [v13.9.505] Reveal UI — single authoritative point, fires once via workletNode guard above
            document.body.classList.remove("app-loading");
            relayLogToStudio("✅ TV: Receiver UI revealed (app-loading removed).");

            relayLogToStudio(`✅ TV: APOR V2 Sink Active @ ${actualRate}Hz`);

            workletNode.port.onmessage = (e) => {
              if (e.data.type === "DIAG") {
                window._lastWorkletDiagTime = Date.now();
                if (binaryWS && binaryWS.readyState === WebSocket.OPEN) {
                  binaryWS.send(
                    JSON.stringify({
                      type: "DIAG",
                      available: e.data.available,
                      stalled: e.data.stalled,
                      measuredHz: e.data.measuredHz,
                      rate: e.data.rate,
                      peak: e.data.peak,
                      locked: e.data.locked,
                    }),
                  );
                }
                const diagEl = document.getElementById("bridge-diag-text");
                if (diagEl) {
                  const wsStatus =
                    binaryWS && binaryWS.readyState === WebSocket.OPEN
                      ? "CONNECTED"
                      : "DISCONNECTED";
                  const peakPercent = Math.round((e.data.peak || 0) * 100);
                  const rate = e.data.rate
                    ? e.data.rate.toFixed(4)
                    : "1.0000";
                  const lockStatus = e.data.locked ? "LOCKED" : "SYNCING";
                  const relayInfo =
                    window._relayPkts > 0
                      ? `RELAY: ${window._relayPkts} | `
                      : "";
                  const hzInfo = e.data.measuredHz
                    ? ` | HZ: ${e.data.measuredHz}`
                    : "";
                  diagEl.textContent = `${relayInfo}BUF: ${e.data.available}${hzInfo} | RATE: ${rate}x | ${lockStatus} | WS: ${wsStatus} [DIRECT BRIDGE]`;
                }

                // [v13.9.504] TRIPLE CHECK: Relay lock status to Studio every ~10s
                if (
                  !window._lastDiagSent ||
                  Date.now() - window._lastDiagSent > 10000
                ) {
                  const lockStatus = e.data.locked ? "LOCKED" : "SYNCING";
                  const rate = e.data.rate
                    ? e.data.rate.toFixed(4)
                    : "1.0000";
                  const peakPercent = Math.round((e.data.peak || 0) * 100);
                  const hzInfo = e.data.measuredHz
                    ? ` | HZ: ${e.data.measuredHz}`
                    : "";
                  relayLogToStudio(
                    `📊 TV STATUS: ${lockStatus} @ ${rate}x (BUF: ${e.data.available}${hzInfo} | PEAK: ${peakPercent}% | STALLS: ${e.data.stalled})`,
                  );
                  window._lastDiagSent = Date.now();
                }
              } else if (e.data.type === "LOG") {
                relayLogToStudio(e.data.msg);
              }
            };
            resumeAudio();
          } catch (e) {
            relayLogToStudio(`❌ TV ERROR: initAudio failed - ${e.message}`);
          }
        }

        function showUnlockOverlay() {
          // [v13.9.505] Disabled visual overlay so the GUI is never blocked.
          // Suspended context auto-unlock runs in the background.
        }

        function hideUnlockOverlay() {
          const overlay = document.getElementById("audio-unlock-overlay");
          if (overlay && overlay.classList.contains("visible")) {
            overlay.classList.remove("visible");
            relayLogToStudio("🖥️ TV: Audio Unlock Overlay hidden.");
          }
        }

        function findMediaElement(root = document) {
          // Check video
          const video = root.querySelector("video");
          if (video) return video;
          
          // Check audio (except audio-unlocker)
          const audios = root.querySelectorAll("audio");
          for (const a of audios) {
            if (a.id !== "audio-unlocker") {
              return a;
            }
          }
          
          // Traverse Shadow DOMs
          const all = root.querySelectorAll("*");
          for (const el of all) {
            if (el.shadowRoot) {
              const found = findMediaElement(el.shadowRoot);
              if (found) return found;
            }
          }
          return null;
        }

        function connectCastMediaElement() {
          if (!audioCtx || !masterGain) return;
          try {
            // Check for statically declared Cast media element first
            let castMediaElement = document.getElementById("cast-media-element");
            
            // Fallback: check Cast SDK PlayerManager
            if (!castMediaElement && typeof cast !== "undefined" && cast.framework) {
              try {
                const context = cast.framework.CastReceiverContext.getInstance();
                if (context) {
                  const pm = context.getPlayerManager();
                  if (pm && typeof pm.getMediaElement === "function") {
                    castMediaElement = pm.getMediaElement();
                  }
                }
              } catch (sdkErr) {
                // Non-fatal fallback
              }
            }
            
            // Fallback: use recursive shadow root traverser
            if (!castMediaElement) {
              castMediaElement = findMediaElement(document);
            }

            if (castMediaElement && !castMediaElement._connectedToAudioCtx) {
              relayLogToStudio("🛠️ TV: Found Cast media element: " + castMediaElement.tagName + " (id=" + castMediaElement.id + ", class=" + castMediaElement.className + ")");
              
              // Set crossOrigin to anonymous to avoid CORS SecurityError on Tauri local stream
              if (castMediaElement.crossOrigin !== "anonymous") {
                castMediaElement.crossOrigin = "anonymous";
                relayLogToStudio("🔧 TV: Set crossOrigin='anonymous' on Cast media element.");
              }

              // Create MediaElementSource and connect
              const mediaSource = audioCtx.createMediaElementSource(castMediaElement);
              mediaSource.connect(masterGain);
              castMediaElement._connectedToAudioCtx = true;
              relayLogToStudio("✅ TV: Cast SDK Media Element connected to AudioContext successfully.");
            }
          } catch (e) {
            relayLogToStudio("⚠️ TV: connectCastMediaElement error: " + e.message);
          }
        }

        async function resumeAudio() {
          if (audioCtx) {
            connectCastMediaElement();
            const prevState = audioCtx.state;
            try {
              relayLogToStudio("🔊 TV: resumeAudio() calling audioCtx.resume(). State: " + prevState);
              await audioCtx.resume();
              relayLogToStudio("🔊 TV: resumeAudio() resolved. State: " + audioCtx.state);
              if (audioCtx.state === "running") {
                hideUnlockOverlay();
              } else {
                showUnlockOverlay();
              }
            } catch (e) {
              console.warn("⚠️ TV: Resume failed", e);
              relayLogToStudio("⚠️ TV: resumeAudio() failed: " + e.message);
              showUnlockOverlay();
            }
          }
        }

        async function playSineTest() {
          if (!audioCtx) {
            await initAudio();
          }
          if (!audioCtx) {
            relayLogToStudio("⚠️ TV: Sine test skipped; audio context not ready.");
            return;
          }
          await resumeAudio();
          if (workletNode) {
            workletNode.port.postMessage({ type: "TEST_BEEP" });
            relayLogToStudio("🔊 Sine Test Sent to Worklet");
          } else {
            // Fallback to native if worklet not loaded
            const osc = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            osc.connect(g);
            g.connect(audioCtx.destination);
            g.gain.setValueAtTime(0.1, audioCtx.currentTime);
            g.gain.exponentialRampToValueAtTime(
              0.0001,
              audioCtx.currentTime + 1,
            );
            osc.start();
            osc.stop(audioCtx.currentTime + 1);
            relayLogToStudio(
              "🔊 Sine Test Played on Native Context (Worklet Null)",
            );
          }
        }

        var logQueue = [];
        let lastHighFreqLogTime = 0;
        function relayLogToStudio(msg) {
          const isHighFreq =
            msg.indexOf("Latency Catch-up") !== -1 ||
            msg.indexOf("Callback Rate") !== -1;
          if (isHighFreq) {
            const now = Date.now();
            if (now - lastHighFreqLogTime < 10000) {
              return; // Throttle: Skip both DOM rendering and WS broadcasting
            }
            lastHighFreqLogTime = now;
          }
          // [v13.9.504] Suppress DOM updates during active streaming to reduce TV CPU overhead
          if (!isHighFreq && !workletNode) {
            const inner = document.getElementById("tv-console-inner");
            if (inner) {
              const line = document.createElement("div");
              line.textContent = `> ${msg}`;
              inner.appendChild(line);
              if (inner.childNodes.length > 15)
                inner.removeChild(inner.firstChild);
            }
          }
          let sent = false;
          // [v13.9.504] PREFER BINARY WS: Fastest and most reliable path
          if (binaryWS && binaryWS.readyState === WebSocket.OPEN) {
            try {
              binaryWS.send(JSON.stringify({ type: "LOG", msg: msg }));
              sent = true;
            } catch (e) {}
          }
          
          // [v13.9.504] FALLBACK: Google Cast SDK Namespace
          if (!sent && typeof cast !== "undefined" && cast.framework) {
            try {
              const context = cast.framework.CastReceiverContext.getInstance();
              const senders = context.getSenders();
              if (senders.length > 0) {
                context.sendCustomMessage(CUSTOM_NAMESPACE, senders[0].id, {
                  type: "LOG",
                  msg: msg,
                });
                sent = true;
              }
            } catch (e) {}
          }
          
          // [v13.9.504] ULTIMATE FALLBACK: HTTP Beacon (Log Server)
          if (!sent && !isHighFreq) {
            logQueue.push(msg);
            if (logQueue.length > 100) logQueue.shift();
            const targetIp = currentBridgeIp || (window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1" && window.location.hostname !== "" ? window.location.hostname : null);
            if (targetIp) {
              const port = currentBridgePort || (window.SERVER_PORT && !window.SERVER_PORT.startsWith("{{") ? window.SERVER_PORT : "8080");
              const url = "http://" + targetIp + ":" + port + "/log?m=" + encodeURIComponent(msg);
              if (navigator.sendBeacon) {
                navigator.sendBeacon(url);
              } else {
                fetch(url).catch(() => {});
              }
            }
          }
        }

        const elCache = {};
        const valCache = {};
        function getEl(id) {
          if (!elCache[id]) {
            elCache[id] = document.getElementById(id);
          }
          return elCache[id];
        }
        function updateText(id, text) {
          const el = getEl(id);
          if (el && valCache[id] !== text) {
            el.textContent = text;
            valCache[id] = text;
          }
        }
        function updateValue(id, val) {
          const el = getEl(id);
          if (el && valCache[id] !== val) {
            el.value = val;
            valCache[id] = val;
          }
        }
        function updateClass(id, className) {
          const el = getEl(id);
          if (el && valCache[id] !== className) {
            el.className = className;
            valCache[id] = className;
          }
        }
        function updateStyleWidth(id, width) {
          const el = getEl(id);
          if (el && valCache[id] !== width) {
            el.style.width = width;
            valCache[id] = width;
          }
        }
        function updateStyleLeft(id, left) {
          const el = getEl(id);
          if (el && valCache[id] !== left) {
            el.style.left = left;
            valCache[id] = left;
          }
        }

        let lastRenderTime = 0;
        const RENDER_THROTTLE_MS = 2000; // [v13.9.504] Throttle to 0.5 FPS — UI is decorative, audio is critical

        const _lastParamsCache = [];
        const _lastFxCache = [];
        let _lastSamplerCache = "";

        function renderState(s) {
          if (!s) return;
          const now = Date.now();
          if (now - lastRenderTime < RENDER_THROTTLE_MS) return;
          lastRenderTime = now;
          try {
            if (s.transport) {
              updateText("recording-time-display", s.transport.position);
              for (var i = 0; i < 4; i++) {
                updateText("t-time-" + i, s.transport.position);
              }
            }
            if (s.cursor) {
              var cur = getEl("cursor-mirror");
              if (cur) {
                const curKey = `${s.cursor.x}_${s.cursor.y}_${s.cursor.isClicking}`;
                if (valCache["cursor"] !== curKey) {
                  cur.style.display = "block";
                  var px = s.cursor.x * 1440;
                  var py = s.cursor.y * 810 + 13;
                  cur.style.transform = `translate3d(${px}px, ${py}px, 0) translate3d(-50%, -50%, 0)`;
                  cur.style.background = s.cursor.isClicking
                    ? "rgba(255, 255, 0, 0.9)"
                    : "rgba(255, 0, 0, 0.9)";
                  valCache["cursor"] = curKey;
                }
              }
            }
            if (s.master) {
              updateValue("master-volume", s.master.volume || 0);
              updateText(
                "master-volume-value",
                (s.master.volume || 0).toFixed(1) + " dB",
              );
              updateStyleWidth(
                "master-meter-bar",
                ((s.master.meters && s.master.meters.l) * 100 || 0) + "%",
              );
              updateValue("loop-length", s.master.loopLength || 4);
              updateText(
                "loop-length-value",
                (s.master.loopLength || 4).toFixed(1) + "s",
              );
              updateClass(
                "master-record-button",
                s.master.isRecording ? "rec-btn recording" : "rec-btn",
              );
              updateClass(
                "lfo-toggle",
                s.master.lfo1 && s.master.lfo1.active ? "active" : "",
              );
              updateStyleWidth(
                "lfo-meter-bar",
                ((s.master.lfo1 && s.master.lfo1.value) * 100 || 0) + "%",
              );
              updateValue(
                "lfo-time",
                (s.master.lfo1 && s.master.lfo1.time) || 1.8,
              );
              updateText(
                "lfo-time-value",
                ((s.master.lfo1 && s.master.lfo1.time) || 1.8).toFixed(1) + "s",
              );
              updateClass(
                "lfo2-toggle",
                s.master.lfo2 && s.master.lfo2.active ? "active" : "",
              );
              updateStyleWidth(
                "lfo2-meter-bar",
                ((s.master.lfo2 && s.master.lfo2.value) * 100 || 0) + "%",
              );
              updateValue(
                "lfo2-time",
                (s.master.lfo2 && s.master.lfo2.time) || 1.8,
              );
              updateText(
                "lfo2-time-value",
                ((s.master.lfo2 && s.master.lfo2.time) || 1.8).toFixed(1) + "s",
              );
            }
            if (s.sampler) {
              const samplerStr = JSON.stringify(s.sampler);
              if (_lastSamplerCache !== samplerStr) {
                _lastSamplerCache = samplerStr;
                s.sampler.forEach((p, i) => {
                  const btnId = "sample-" + (i + 1);
                  const cls = p.active
                    ? "sample-btn active"
                    : p.loaded
                      ? "sample-btn loaded"
                      : "sample-btn";
                  updateClass(btnId, cls);
                  if (p.loaded && p.name) {
                    updateText(btnId, p.name.substring(0, 6));
                  }
                });
              }
            }
            if (s.tracks)
              s.tracks.forEach((t, i) => {
                const trackName = t.fileName || "Ready";
                updateText("t-scroll-" + i, trackName);
                updateClass(
                  "t-scroll-" + i,
                  trackName.length > 15
                    ? "scrolling-text active-scrolling"
                    : "scrolling-text",
                );
                updateStyleWidth(
                  "t-mtr-" + i,
                  ((t.meters && t.meters.l) * 100 || 0) + "%",
                );
                updateClass(
                  "t-st-" + i,
                  "status-indicator " +
                    (t.isRecording
                      ? "status-recording"
                      : t.isPlaying
                        ? "status-playing"
                        : "status-ready"),
                );
                updateStyleLeft("t-ls-m-" + i, t.loopStart * 100 + "%");
                updateStyleLeft("t-le-m-" + i, t.loopEnd * 100 + "%");

                if (t.params) {
                  const paramsStr = JSON.stringify(t.params);
                  const lfoAssignsStr = JSON.stringify(t.lfoAssigns);
                  const trackCacheKey = paramsStr + "_" + lfoAssignsStr;
                  if (_lastParamsCache[i] !== trackCacheKey) {
                    _lastParamsCache[i] = trackCacheKey;
                    KNOB_CONFIGS.forEach((cfg) => {
                      updateValue(`t-${cfg.p}-sl-${i}`, t.params[cfg.p] || 0);
                      updateText(`t-${cfg.p}-val-${i}`, t.params[cfg.p] || 0);

                      const l1 = getEl(`t-lfo1-chk-${i}-${cfg.p}`);
                      const l1Checked = !!(
                        t.lfoAssigns &&
                        t.lfoAssigns[1] &&
                        t.lfoAssigns[1].includes(cfg.p)
                      );
                      if (l1 && l1.checked !== l1Checked) {
                        l1.checked = l1Checked;
                      }
                      const l2 = getEl(`t-lfo2-chk-${i}-${cfg.p}`);
                      const l2Checked = !!(
                        t.lfoAssigns &&
                        t.lfoAssigns[2] &&
                        t.lfoAssigns[2].includes(cfg.p)
                      );
                      if (l2 && l2.checked !== l2Checked) {
                        l2.checked = l2Checked;
                      }
                    });
                    updateValue(`t-gain-sl-${i}`, t.params.inputGain || 0);
                    updateText(
                      `t-gain-val-${i}`,
                      (t.params.inputGain || 0).toFixed(1) + " dB",
                    );
                  }
                }
                if (t.fxSlots) {
                  const fxStr =
                    JSON.stringify(t.fxSlots) +
                    "_" +
                    (t.fxNames ? JSON.stringify(t.fxNames) : "");
                  if (_lastFxCache[i] !== fxStr) {
                    _lastFxCache[i] = fxStr;
                    t.fxSlots.forEach((active, idx) => {
                      const chk = getEl(`t-fx-chk-${i}-${idx}`);
                      if (chk && chk.checked !== active) {
                        chk.checked = active;
                      }
                      const lbl = getEl(`t-fx-lbl-${i}-${idx}`);
                      if (lbl && t.fxNames && t.fxNames[idx] !== undefined) {
                        const name = t.fxNames[idx];
                        if (lbl.textContent !== name) {
                          lbl.textContent = name;
                        }
                      }
                      const bg = active ? "var(--gold)" : "transparent";
                      const bgKey = `t-fx-lbl-bg-${i}-${idx}`;
                      if (lbl && valCache[bgKey] !== bg) {
                        lbl.style.backgroundColor = bg;
                        valCache[bgKey] = bg;
                      }
                    });
                  }
                }
                updateClass(`t-rec-${i}`, t.isRecording ? "recording" : "");
              });
          } catch (e) {
            console.error("❌ TV Render Error:", e);
          }
        }

        let currentBridgeIp = null;
        let currentBridgePort = null;
        let currentBridgeToken = null;
        let binaryWS = null;
        let wsConnectTimeout = null;
        let isSenderConnected = false;
        let wakeLockLoadingOrLoaded = false;
        let suppressBinaryReconnect = false;
        let binaryConnectionGeneration = 0;

        function clearBinaryReconnectTimer() {
          if (wsConnectTimeout) {
            clearTimeout(wsConnectTimeout);
            wsConnectTimeout = null;
          }
        }

        function scheduleBinaryReconnect(ip, customPort, customToken, delayMs) {
          clearBinaryReconnectTimer();
          wsConnectTimeout = setTimeout(() => {
            connectBinaryBridge(ip, customPort, customToken);
          }, delayMs);
        }

        function triggerWakeLockLoad() {
          if (typeof cast === "undefined" || !cast.framework) return;
          const context = cast.framework.CastReceiverContext.getInstance();
          if (!context) return;

          // Check if there are active senders
          const senders = context.getSenders();
          const hasSender = senders && senders.length > 0;
          if (!hasSender && !isSenderConnected) {
            return;
          }
          isSenderConnected = true;

          if (wakeLockLoadingOrLoaded) {
            return;
          }

          try {
            const pm = context.getPlayerManager();

            if (pm && !pm._hasAudioListeners) {
              pm._hasAudioListeners = true;
              try {
                const evType = (cast && cast.framework && cast.framework.events && cast.framework.events.EventType) 
                               ? cast.framework.events.EventType.PLAYER_STATE_CHANGED 
                               : "PLAYER_STATE_CHANGED";
                
                if (evType) {
                  pm.addEventListener(evType, function(e) {
                    relayLogToStudio("📱 TV: PLAYER_STATE_CHANGED event detected: " + (e ? e.value : "unknown"));
                    resumeAudio();
                  });
                }
              } catch (e) {
                relayLogToStudio("⚠️ TV: Failed to add PlayerManager listener: " + e.message);
              }
            }

            const state = pm.getPlayerState();
            if (
              state === cast.framework.messages.PlayerState.PLAYING ||
              state === cast.framework.messages.PlayerState.BUFFERING
            ) {
              relayLogToStudio("✅ TV: PlayerManager already in " + state + " state.");
              wakeLockLoadingOrLoaded = true;
              return;
            }

            // Build the silence URL from the bridge IP (Tauri server)
            let silenceUrl = null;
            if (currentBridgeIp) {
              const port = currentBridgePort || (window.SERVER_PORT && !window.SERVER_PORT.startsWith("{{") ? window.SERVER_PORT : "8080");
              silenceUrl = "http://" + currentBridgeIp + ":" + port + "/silence.wav";
            } else {
              // Fallback: try to extract IP from current WebSocket URL
              const wsUrl = binaryWS ? binaryWS.url : null;
              if (wsUrl) {
                const match = wsUrl.match(/ws:\/\/([^:]+):(\d+)/);
                if (match) {
                  silenceUrl = "http://" + match[1] + ":" + match[2] + "/silence.wav";
                }
              }
            }

            if (!silenceUrl) {
              return;
            }

            wakeLockLoadingOrLoaded = true;
            relayLogToStudio("📡 TV: Loading wake-lock media from " + silenceUrl);

            const loadRequestData = new cast.framework.messages.LoadRequestData();
            loadRequestData.media = new cast.framework.messages.MediaInformation();
            loadRequestData.media.contentId = silenceUrl;
            loadRequestData.media.contentType = "audio/wav";
            loadRequestData.media.streamType = cast.framework.messages.StreamType.BUFFERED;
            loadRequestData.autoplay = true;
            loadRequestData.queueData = new cast.framework.messages.QueueData();
            loadRequestData.queueData.repeatMode = cast.framework.messages.RepeatMode.REPEAT_SINGLE;

            pm.load(loadRequestData)
              .then(function() {
                relayLogToStudio("✅ TV: Programmatic wake-lock load successful!");
                resumeAudio();
              })
              .catch(function(e) {
                wakeLockLoadingOrLoaded = false; // Allow retrying
                relayLogToStudio("⚠️ TV: Programmatic wake-lock load failed: " + (e && e.message ? e.message : e));
              });
          } catch (err) {
            wakeLockLoadingOrLoaded = false;
            relayLogToStudio("❌ TV: Wake-lock load setup failed: " + err.message);
          }
        }


        function connectBinaryBridge(ip, customPort, customToken) {
          const generation = ++binaryConnectionGeneration;
          suppressBinaryReconnect = false;
          clearBinaryReconnectTimer();
          if (
            binaryWS &&
            binaryWS.readyState === WebSocket.OPEN &&
            currentBridgeIp === ip &&
            currentBridgePort === customPort &&
            currentBridgeToken === customToken
          ) {
            // [v13.9.504] Already connected to this Studio IP. Ignore heartbeat redundancy.
            return;
          }
          // [v13.9.504] Guard against connecting while another connect is in progress
          if (binaryWS && binaryWS.readyState === WebSocket.CONNECTING) {
            return;
          }

          currentBridgeIp = ip;
          currentBridgePort = customPort;
          currentBridgeToken = customToken;
          if (binaryWS) {
            try {
              binaryWS.onopen = null;
              binaryWS.onmessage = null;
              binaryWS.onclose = null;
              binaryWS.onerror = null;
              binaryWS.close();
            } catch (e) {}
            binaryWS = null;
          }

          const targetPort = customPort || (window.SERVER_PORT && !window.SERVER_PORT.startsWith("{{") ? window.SERVER_PORT : "8080");
          const targetToken = customToken || (window.SECURITY_TOKEN && !window.SECURITY_TOKEN.startsWith("{{") ? window.SECURITY_TOKEN : "");
          const url = `ws://${ip}:${targetPort}/?role=receiver&token=${encodeURIComponent(targetToken)}`;
          try {
            relayLogToStudio(`📡 TV: Attempting to connect to ${url}`);
            binaryWS = new WebSocket(url);
            binaryWS.binaryType = "arraybuffer";
          } catch (err) {
            relayLogToStudio(
              `❌ TV: WebSocket Constructor Failed: ${err.message}`,
            );
            wsConnectTimeout = setTimeout(() => connectBinaryBridge(ip, customPort, customToken), 5000);
            return;
          }

          binaryWS.onopen = async () => {
            if (generation !== binaryConnectionGeneration) return;
            console.log("✅ Binary Bridge Connected");
            relayLogToStudio(`✅ TV: WebSocket Connected to ${url}`);
            // [v13.9.504] Reset reconnect backoff counter on success
            window._wsReconnectAttempts = 0;
            clearBinaryReconnectTimer();
            // Flush buffered logs
            while (logQueue.length > 0) {
              const msg = logQueue.shift();
              try {
                binaryWS.send(JSON.stringify({ type: "LOG", msg: msg }));
              } catch (e) {}
            }
            const diagEl = document.getElementById("bridge-diag-text");
            if (diagEl) {
              diagEl.textContent = diagEl.textContent.replace(
                /WS: (CONNECTED|DISCONNECTED|ERROR.*)/,
                "WS: CONNECTED",
              );
              diagEl.style.color = "#0f0";
              diagEl.style.borderColor = "#0f0";
            }
            const conn = document.getElementById("bridge-status-dot");
            if (conn) {
              conn.style.backgroundColor = "var(--green)";
              conn.classList.add("bridge-connected-pulse");
            }

            // [v13.9.504] HARDWARE PROBE: Detect actual device sample rate natively
            let hwRate = 48000;
            try {
              const probe = new window.AudioContext();
              hwRate = probe.sampleRate; // May be 24000, 44100, 48000 etc.
              window._hwRate = hwRate;
              relayLogToStudio(
                `🔍 TV: Hardware probe → actual rate = ${hwRate}Hz`,
              );
              probe.close();
            } catch (e) {
              relayLogToStudio(
                `⚠️ TV: Hardware probe failed, defaulting to ${hwRate}Hz`,
              );
              window._hwRate = hwRate;
            }

            // Send actual hardware capabilities
            preInitAudioContext();
            
            function sendHandshake() {
              if (!binaryWS || binaryWS.readyState !== WebSocket.OPEN) return;
              const rate = window._hwRate || hwRate || 48000;
              const handshake = {
                type: "HANDSHAKE",
                config: {
                  sampleRate: rate,
                  bitDepth: 16, // Request 16-bit pipeline for lower CPU overhead
                  maxChannels: 2,
                },
              };
              try {
                binaryWS.send(JSON.stringify(handshake));
                relayLogToStudio(`🤝 TV: Handshake sent → ${rate}Hz / 16-bit`);
              } catch (e) {
                relayLogToStudio(`⚠️ TV: Failed to send handshake: ${e.message}`);
              }
            }

            window._handshakeAcked = false;
            sendHandshake();

            // Set up a retry interval in case the initial handshake is lost/dropped by sender
            const handshakeRetryInterval = setInterval(() => {
              if (generation !== binaryConnectionGeneration || !binaryWS || binaryWS.readyState !== WebSocket.OPEN || window._handshakeAcked) {
                clearInterval(handshakeRetryInterval);
                return;
              }
              relayLogToStudio("⏳ TV: Retrying Handshake (no ACK received yet)...");
              sendHandshake();
            }, 1500);

            // Audio init is deferred until HANDSHAKE_ACK arrives
            triggerWakeLockLoad();
          };
          binaryWS.onmessage = (event) => {
            if (generation !== binaryConnectionGeneration) return;
            // [v13.9.504] PRIORITY: Binary audio data gets the fastest path
            if (event.data instanceof ArrayBuffer) {
              if (workletNode) {
                // [v13.9.504] BINARY SUPERIORITY LOCK
                // We have a direct high-fidelity bridge. Kill all fallback paths to save TV CPU.
                window._lastBinaryTime = Date.now();
                window._binaryActive = true;

                // Terminate WebRTC stream entirely to save TV CPU
                const audioUnlocker = document.getElementById("audio-unlocker");
                if (audioUnlocker && audioUnlocker.srcObject) {
                  audioUnlocker.srcObject = null;
                  relayLogToStudio(
                    "🛡️ TV: Binary Bridge Active. Terminated redundant WebRTC decoder.",
                  );
                }

                if (audioCtx && audioCtx.state === "suspended") resumeAudio();
                queueBinaryFrame(event.data);
              } else {
                if (audioCtx && audioCtx.state === "suspended") resumeAudio();
                queueBinaryFrame(event.data);
              }
              return;
            } else if (event.data instanceof Blob) {
              // [v13.9.504] Fallback: TV browser ignored binaryType="arraybuffer"
              window._lastBinaryTime = Date.now();
              if (!window._binaryActive) {
                window._binaryActive = true;
                const audioUnlocker = document.getElementById("audio-unlocker");
                if (audioUnlocker && audioUnlocker.srcObject) {
                  audioUnlocker.srcObject = null;
                  relayLogToStudio("🛡️ TV: Binary Bridge Active (Blob). Terminated redundant WebRTC decoder.");
                }
              }

              if (audioCtx && audioCtx.state === "suspended") resumeAudio();
              var reader = new FileReader();
              reader.onload = function() {
                queueBinaryFrame(this.result);
              };
              reader.onerror = function() {
                relayLogToStudio("⚠️ TV: FileReader failed to read Blob.");
              };
              reader.readAsArrayBuffer(event.data);
              return;
            } else if (typeof event.data === "string") {
              try {
                const d = JSON.parse(event.data);
                if (d.type === "STATE_UPDATE") {
                  renderState(d.state);
                } else if (d.type === "PCM_RELAY") {
                   // [v13.9.504] Binary Superiority: Ignore relay if binary is active
                   if (window._binaryActive) return;

                   let buffer = d.binary || d.data;
                   if (buffer && typeof buffer === "string") {
                     try {
                       const binary = window.atob(buffer);
                       const len = binary.length;
                       const bytes = new Uint8Array(len);
                       for (let i = 0; i < len; i++) {
                         bytes[i] = binary.charCodeAt(i);
                       }
                       buffer = bytes.buffer;
                     } catch (e) {
                       return;
                     }
                   }

                   if (buffer) {
                     if (audioCtx && audioCtx.state === "suspended") resumeAudio();
                     try {
                       queueBinaryFrame(buffer);
                     } catch (e) {
                       queueBinaryFrame(buffer);
                     }
                   }
                } else if (d.type === "RELOAD") {
                  relayLogToStudio("🔄 TV: RELOAD command received. Reloading page with cache-buster...");
                  setTimeout(() => {
                    const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
                    window.location.href = cleanUrl + "?cb=" + Date.now();
                  }, 500);
                } else if (d.type === "HANDSHAKE_ACK") {
                  // [v13.9.504] Server confirmed handshake — init audio with negotiated config
                  const ackRate = d.config ? d.config.sampleRate : 48000;
                  const ackBitDepth = d.config ? d.config.bitDepth : 16;
                  relayLogToStudio(
                    `✅ TV: HANDSHAKE_ACK received → ${ackRate}Hz / ${ackBitDepth}-bit`,
                  );
                  window._negotiatedBitDepth = ackBitDepth;
                  if (ackRate) {
                    window._hwRate = ackRate;
                  }
                  configReceived = true;
                  window._handshakeAcked = true;
                  initAudio();
                  // Configure worklet bit depth after init
                  setTimeout(() => {
                    if (workletNode) {
                      workletNode.port.postMessage({
                        type: "CONFIG",
                        bitDepth: ackBitDepth,
                      });
                      relayLogToStudio(
                        `🔧 TV: Worklet configured for ${ackBitDepth}-bit decode`,
                      );
                    }
                  }, 500);
                } else if (d.type === "BRIDGE_CONFIG") {
                  if (d.config && d.config.sampleRate) {
                    const newStudioRate = d.config.sampleRate;
                    configReceived = true;
                    
                    // Proactive fallback: If we haven't received HANDSHAKE_ACK yet, resend HANDSHAKE
                    if (!window._handshakeAcked && typeof sendHandshake === "function") {
                      sendHandshake();
                    }

                    if (window._studioRate !== newStudioRate) {
                      window._studioRate = newStudioRate;
                      relayLogToStudio(
                        `🔄 TV: Studio rate updated to ${newStudioRate}Hz`,
                      );
                      if (workletNode && audioCtx) {
                        const newBaseRateRatio = audioCtx.sampleRate
                          ? newStudioRate / audioCtx.sampleRate
                          : 1.0;
                        workletNode.port.postMessage({
                          type: "CONFIG",
                          baseRateRatio: newBaseRateRatio,
                        });
                      } else {
                        initAudio();
                      }
                    } else {
                      if (!audioCtx || !workletNode) {
                        initAudio();
                      }
                    }
                  }
                } else if (d.type === "WEBRTC_OFFER") {
                  handleWebRTCOffer(d.sdp);
                } else if (d.type === "WEBRTC_CANDIDATE") {
                  if (peerConnection && d.candidate) {
                    peerConnection.addIceCandidate(new RTCIceCandidate(d.candidate)).catch(e => {
                      relayLogToStudio("⚠️ TV WebRTC: Failed to add ICE candidate - " + e.message);
                    });
                  }
                }
              } catch (e) {}
            }
          };

          binaryWS.onclose = () => {
            if (generation !== binaryConnectionGeneration) return;
            window._binaryActive = false;
            configReceived = false;
            wakeLockLoadingOrLoaded = false;
            pendingBinaryFrames = [];
            window._lastBinaryTime = 0;
            teardownWebRtcFallback();
            const conn = document.getElementById("bridge-status-dot");
            if (conn) {
              conn.style.backgroundColor = "var(--red)";
              conn.classList.remove("bridge-connected-pulse");
            }
            if (suppressBinaryReconnect) {
              suppressBinaryReconnect = false;
              clearBinaryReconnectTimer();
              return;
            }
            // [v13.9.504] Reconnect with exponential backoff instead of full page reload
            // Preserves AudioContext, ring buffer, and worklet state across reconnections
            if (!window._wsReconnectAttempts) window._wsReconnectAttempts = 0;
            window._wsReconnectAttempts++;
            const maxRetries = 5;
            if (window._wsReconnectAttempts <= maxRetries) {
              const delay = Math.min(1000 * Math.pow(2, window._wsReconnectAttempts - 1), 16000);
              relayLogToStudio(`🔄 TV: WS closed. Reconnect attempt ${window._wsReconnectAttempts}/${maxRetries} in ${delay}ms...`);
              scheduleBinaryReconnect(currentBridgeIp, currentBridgePort, currentBridgeToken, delay);
            } else {
              relayLogToStudio("🛑 TV: All reconnect attempts exhausted. Reloading page...");
              window._wsReconnectAttempts = 0;
              setTimeout(() => {
                const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
                window.location.href = cleanUrl + "?cb=" + Date.now();
              }, 1000);
            }
          };

          binaryWS.onerror = (e) => {
            if (generation !== binaryConnectionGeneration) return;
            console.error("❌ Binary Bridge Error:", e);
            relayLogToStudio(`❌ TV: WebSocket Error on ${url}`);
            const diagEl = document.getElementById("bridge-diag-text");
            if (diagEl) {
              diagEl.textContent = `BUF: 0 | STALLS: 0 | WS: ERROR [${url}]`;
              diagEl.style.color = "var(--red)";
              diagEl.style.borderColor = "var(--red)";
            }
            // [v13.9.504] Retry with full connection params (port + token preserved)
            scheduleBinaryReconnect(ip, customPort, customToken, 5000);
          };
        }

        async function handleWebRTCOffer(sdp) {
          try {
            relayLogToStudio("📡 TV WebRTC: Received Offer. Initializing...");
            
            if (peerConnection) {
              peerConnection.close();
            }

            const config = {
              iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
                { urls: "stun:stun1.l.google.com:19302" }
              ]
            };

            peerConnection = new RTCPeerConnection(config);

            peerConnection.onicecandidate = (event) => {
              if (event.candidate && binaryWS && binaryWS.readyState === WebSocket.OPEN) {
                binaryWS.send(JSON.stringify({
                  type: "WEBRTC_CANDIDATE",
                  candidate: event.candidate
                }));
              }
            };

            peerConnection.ontrack = (event) => {
              relayLogToStudio("✅ TV WebRTC: Track received! Kind: " + event.track.kind);
              const audioUnlocker = document.getElementById("audio-unlocker");
              if (audioUnlocker) {
                audioUnlocker.srcObject = event.streams[0];
                audioUnlocker.play().catch(e => {
                  relayLogToStudio("⚠️ TV WebRTC: Play failed - " + e.message);
                });
                resumeAudio();
              }
            };

            await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            if (binaryWS && binaryWS.readyState === WebSocket.OPEN) {
              binaryWS.send(JSON.stringify({
                type: "WEBRTC_ANSWER",
                sdp: answer
              }));
              relayLogToStudio("📡 TV WebRTC: Answer sent to Studio.");
            }
          } catch (e) {
            relayLogToStudio("❌ TV WebRTC Error: " + e.message);
          }
        }

        function handleInboundData(data) {
          try {
            const d = typeof data === "string" ? JSON.parse(data) : data;
            if (!d) return;

            // 1. Hardware Alignment
            if (d.type === "BRIDGE_CONFIG") {
              const newRate = d.config ? d.config.sampleRate : null;
              configReceived = true;
              if (newRate) {
                if (window._studioRate !== newRate) {
                  window._studioRate = newRate;
                  relayLogToStudio(
                    `🔄 TV: Studio rate updated via signaling to ${newRate}Hz`,
                  );
                  if (workletNode && audioCtx) {
                    const newBaseRateRatio = audioCtx.sampleRate
                      ? newRate / audioCtx.sampleRate
                      : 1.0;
                    workletNode.port.postMessage({
                      type: "CONFIG",
                      baseRateRatio: newBaseRateRatio,
                    });
                  } else {
                    initAudio();
                  }
                } else {
                  if (!audioCtx || !workletNode) {
                    initAudio();
                  }
                }
              } else {
                if (!audioCtx || !workletNode) {
                  initAudio();
                }
              }
              if (d.ip) {
                connectBinaryBridge(d.ip, d.port, d.token);
                triggerWakeLockLoad();
              }
              return;
            }

            // 3. Command Relay
            if (d.type === "RELOAD") {
              relayLogToStudio("🔄 TV: RELOAD command received via Cast SDK. Reloading page...");
              setTimeout(() => {
                const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
                window.location.href = cleanUrl + "?cb=" + Date.now();
              }, 500);
              return;
            }

            if (d.type === "SINE_TEST") {
              playSineTest().catch((e) => {
                relayLogToStudio("⚠️ TV: Sine test failed: " + e.message);
              });
              return;
            }

            if (d.type === "WEBRTC_OFFER") {
              handleWebRTCOffer(d.sdp);
              return;
            }

            if (d.type === "WEBRTC_CANDIDATE") {
              if (peerConnection && d.candidate) {
                peerConnection.addIceCandidate(new RTCIceCandidate(d.candidate)).catch(e => {
                  relayLogToStudio("⚠️ TV WebRTC: Failed to add ICE candidate (SDK) - " + e.message);
                });
              }
              return;
            }

            // 2. High-Fidelity Audio Relay (Fallback Path)
            if (d.type === "PCM_RELAY") {
              // If Binary WS is active, IGNORE Relay to prevent doubling/echo
              if (window._binaryActive) return;

              let buffer = d.binary || d.data;
              if (buffer && typeof buffer === "string") {
                try {
                  const binary = window.atob(buffer);
                  const len = binary.length;
                  const bytes = new Uint8Array(len);
                  for (let i = 0; i < len; i++) {
                    bytes[i] = binary.charCodeAt(i);
                  }
                  buffer = bytes.buffer;
                } catch (e) {
                  return;
                }
              }

              if (buffer && workletNode) {
                if (audioCtx && audioCtx.state === "suspended") resumeAudio();
                try {
                  workletNode.port.postMessage(buffer, [buffer]);
                } catch (e) {
                  workletNode.port.postMessage(buffer);
                }
                window._relayPkts = (window._relayPkts || 0) + 1;
              }
            }

            // 3. Diagnostics & Testing
            if (d.type === "SINE_TEST") {
              playSineTest().catch((e) => {
                relayLogToStudio("⚠️ TV: Sine test failed: " + e.message);
              });
            }

            // 4. GUI Mirroring
            if (d.type === "STATE_UPDATE") {
              if (window._binaryActive) return;
              renderState(d.state);
            }
          } catch (e) {}
        }

        window.onload = function () {
          buildGUI();

          // [V13.9.40] Aggressive Startup Trace
          console.log("🎬 TV: Startup sequence initiated.");
          console.log("🔗 URL: " + window.location.href);

          if (typeof cast !== "undefined" && cast.framework) {
            try {
              window.castReceiverContext =
                cast.framework.CastReceiverContext.getInstance();
              const context = window.castReceiverContext;

              relayLogToStudio("🎬 TV: Startup - URL: " + window.location.href);

              // [v13.9.504] SENDER_CONNECTED/DISCONNECTED listeners
              context.addEventListener(
                cast.framework.events.EventType.SENDER_CONNECTED,
                () => {
                  console.log("📡 Sender connected.");
                  isSenderConnected = true;
                  preInitAudioContext();
                  resumeAudio();
                  triggerWakeLockLoad();
                },
              );

              context.addEventListener(
                cast.framework.events.EventType.SENDER_DISCONNECTED,
                () => {
                  isSenderConnected = false;
                  wakeLockLoadingOrLoaded = false;
                  window._binaryActive = false; 
                  window._lastBinaryTime = 0;
                  teardownWebRtcFallback();
                  suppressBinaryReconnect = true;
                  binaryConnectionGeneration++;
                  clearBinaryReconnectTimer();
                  if (binaryWS) {
                    binaryWS.close();
                    binaryWS = null;
                  }
                },
              );

              context.addCustomMessageListener(CUSTOM_NAMESPACE, (event) => {
                if (event.data) {
                  let msgData = event.data;
                  // Support both raw JSON and nested data object from SDK
                  if (typeof msgData === "string") {
                    try {
                      msgData = JSON.parse(msgData);
                    } catch (e) {}
                  } else if (msgData && typeof msgData.data === "string") {
                    try {
                      msgData = JSON.parse(msgData.data);
                    } catch (e) {}
                  }
                  handleInboundData(msgData);
                }
              });

              context.start({ disableIdleTimeout: true });
            } catch (e) {
              relayLogToStudio("❌ TV: Cast framework start failed: " + e.message);
              console.error("❌ TV: Cast framework start failed:", e);
            }
          } else {
            relayLogToStudio(
              "🎬 TV: Startup - Running in standard browser (non-cast)",
            );
          }

          // [v13.8.150] Auto-Discovery Fallback
          autoDiscoveryFallbackTimeoutId = setTimeout(() => {
            if (
              !binaryWS ||
              (binaryWS.readyState !== WebSocket.OPEN &&
                binaryWS.readyState !== WebSocket.CONNECTING)
            ) {
              console.log("📡 TV: Auto-Discovery Fallback triggered...");
              const hostname = window.location.hostname;
              const isLocal =
                hostname === "localhost" ||
                hostname === "127.0.0.1" ||
                /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
              if (isLocal) {
                connectBinaryBridge(hostname);
              } else {
                console.log(
                  "📡 TV: Public hosting detected. Staying silent until BRIDGE_CONFIG.",
                );
              }
            }
          }, 3000);

          // [V13.8.150] RECURSIVE AUTO-RESUME
          autoUnlockIntervalId = setInterval(() => {
            connectCastMediaElement();

            if (audioCtx) {
              const now = Date.now();
              const isWorkletStalled = workletNode && (!window._lastWorkletDiagTime || (now - window._lastWorkletDiagTime > 4000));
              
              if (audioCtx.state === "suspended" || isWorkletStalled) {
                if (isWorkletStalled && workletNode) {
                  relayLogToStudio("⚠️ TV: Worklet process() stalled/not started. Attempting resume...");
                }
                showUnlockOverlay();
                resumeAudio();
              } else if (audioCtx.state === "running") {
                hideUnlockOverlay();
              }
            } else {
              // Only auto-init if we already have the config
              if (configReceived) initAudio();
            }

            // [v13.9.504] APOR-WebRTC FAILOVER
            // If binary PCM has stopped for > 2s, un-mute WebRTC track as a fallback.
            if (window._lastBinaryTime && Date.now() - window._lastBinaryTime > 2000) {
               const audioUnlocker = document.getElementById("audio-unlocker");
               if (audioUnlocker && audioUnlocker.srcObject && audioUnlocker.muted) {
                  audioUnlocker.muted = false;
                  relayLogToStudio("⚠️ TV: APOR V2 Timed out. Restoring WebRTC fallback audio.");
                  window._lastBinaryTime = 0; // Prevent loop
               }
            }

            // [v13.9.504] Non-Cast fallback only — keep HTML5 audio element alive
            // In Cast mode, the PlayerManager wake-lock with REPEAT_SINGLE handles this.
            const isCastSupported = typeof cast !== "undefined" && cast.framework;
            if (!isCastSupported) {
              const audioUnlocker = document.getElementById("audio-unlocker");
              if (audioUnlocker) {
                if (!audioUnlocker.src) {
                  audioUnlocker.src = createSilentWavUrl();
                }
                if (audioUnlocker.paused) {
                  audioUnlocker.play().catch(function() {});
                }
              }
            }
          }, 2000);

          window.addEventListener("beforeunload", function() {
            if (autoDiscoveryFallbackTimeoutId) {
              clearTimeout(autoDiscoveryFallbackTimeoutId);
              autoDiscoveryFallbackTimeoutId = null;
            }
            if (autoUnlockIntervalId) {
              clearInterval(autoUnlockIntervalId);
              autoUnlockIntervalId = null;
            }
          });

          // [v13.9.504] Global interaction listeners to catch TV remote keys and clicks for AudioContext unlock
          window.addEventListener("keydown", function(e) {
            // relayLogToStudio("🎹 TV: keydown event: " + e.key + " (code: " + e.keyCode + ")");
            resumeAudio();
          });

          window.addEventListener("click", function() {
            // relayLogToStudio("🖱️ TV: click event detected.");
            resumeAudio();
          });

          window.addEventListener("pointerdown", function() {
            // relayLogToStudio("🖱️ TV: pointerdown event detected.");
            resumeAudio();
          });

          const btnUnlock = document.getElementById("btn-unlock-audio");
          if (btnUnlock) {
            btnUnlock.addEventListener("click", function(e) {
              e.stopPropagation();
              relayLogToStudio("🖱️ TV: Unlock button clicked.");
              resumeAudio();
            });
          }

          window.addEventListener("resize", updateScale);
          relayLogToStudio("🎬 TV: Startup Complete [" + VERSION_TAG + "].");
        };
      })();
    

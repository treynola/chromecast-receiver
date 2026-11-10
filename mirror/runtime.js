/* Mirror video only. Authenticated audio and lifecycle remain in the shared core. */
const createMirrorReceiver = function (shared) {
  "use strict";
  const { getLfoVisualNow, sendReceiverBridgeMessage, readNativeResumeMediaState, relayLogToStudio, identityAllowsGui } = shared;
        let mirrorDiagnosticsState = null;
        let lastMirrorPresentationState = null;
        function applyMirrorPresentationState(presentationState) {
          if (!/^(waiting_for_track|track_attached_no_decoded_frames|hardware_mse_attached_no_decoded_frames|decoded_no_presented_frames|frames_advancing|frames_stale|video_play_rejected|track_ended|connection_unavailable)$/.test(String(presentationState))) {
            presentationState = "waiting_for_track";
          }
          if (lastMirrorPresentationState === presentationState) return;
          lastMirrorPresentationState = presentationState;
          const wrapper = document.getElementById("screen-mirror-wrapper");
          const status = document.getElementById("mirror-status");
          if (wrapper) wrapper.dataset.presentationState = presentationState;
          if (status) {
            const label = window.MXSMirrorDiagnostics?.presentationStatusLabel?.(presentationState) || "Mirror status unavailable.";
            status.textContent = label;
            status.hidden = label.length === 0;
          }
        }
        function reportMirrorPresentationState(sessionId, sessionSequence, presentationState, videoTransport, details = {}) {
          applyMirrorPresentationState(presentationState);
          sendReceiverBridgeMessage({
            type: "GUI_CHANNEL_TELEMETRY", transport: "gui", event: "mirror_presentation_state", version: 1,
            guiProtocolVersion: shared.CAST_GUI_PROTOCOL_VERSION, guiSessionNonce: shared.guiSessionNonce,
            side: "receiver", mode: "MIRROR_CAST",
            buildIdentity: { version: window.MXS_BUILD_IDENTITY?.version ?? null,
              receiverHtml: window.MXS_BUILD_IDENTITY?.artifacts?.receiverHtml ?? null },
            sessionId, sessionSequence, monotonicMs: getLfoVisualNow(),
            presentationState, videoTransport,
            details: { trackReadyState: details.trackReadyState || null,
              videoReadyState: Number.isFinite(details.videoReadyState) ? details.videoReadyState : null,
              playStatus: details.playStatus || null,
              connectionState: typeof details.connectionState === "string" ? details.connectionState.slice(0, 32) : null,
              iceConnectionState: typeof details.iceConnectionState === "string" ? details.iceConnectionState.slice(0, 32) : null },
            physicalTimingValidated: false,
          }, "gui", true);
        }
        function stopMirrorDiagnostics() {
          const state = mirrorDiagnosticsState;
          mirrorDiagnosticsState = null;
          if (!state) return;
          clearInterval(state.timer);
          if (state.frameHandle !== null && typeof state.video.cancelVideoFrameCallback === "function") {
            try { state.video.cancelVideoFrameCallback(state.frameHandle); } catch (_) {}
          }
        }

        function startMirrorDiagnostics(pc, video, sessionId, sessionSequence, initialTransport = "webrtc") {
          stopMirrorDiagnostics();
          const helper = window.MXSMirrorDiagnostics;
          const state = { pc, video, sampler: helper ? new helper.Sampler() : null,
            presentationSampler: helper ? new helper.PresentationSampler() : null,
            timer: null, frameHandle: null, frame: null, frameCallbacks: 0, lastReportedFrameCallbacks: 0,
            trackAttached: initialTransport === "webrtc", track: null, playStatus: "starting", inFlight: false };
          mirrorDiagnosticsState = state;
          const current = () => mirrorDiagnosticsState === state && mirrorPeerConnection === pc &&
            activeMirrorSessionId === sessionId && activeMirrorSessionSequence === sessionSequence;
          const presented = (now, metadata) => {
            if (!current()) return;
            state.frameCallbacks++;
            state.frame = helper?.frameObservation(now, metadata) ?? null;
            applyMirrorPresentationState("frames_advancing");
            try { state.frameHandle = video.requestVideoFrameCallback(presented); }
            catch (_) { state.frameHandle = null; }
          };
          if (typeof video.requestVideoFrameCallback === "function") {
            try { state.frameHandle = video.requestVideoFrameCallback(presented); } catch (_) {}
          }
          state.timer = setInterval(async () => {
            if (!current() || state.inFlight) return;
            state.inFlight = true;
            try {
              let stats = { status: "getStats_unavailable", video: null, network: null };
              if (state.sampler && typeof pc?.getStats === "function") {
                try { stats = state.sampler.sample(await pc.getStats(), "inbound-rtp"); }
                catch (error) { stats.status = "getStats_rejected"; stats.errorName = String(error?.name || "Error").slice(0, 64); }
              }
              if (!current()) return;
              let quality = null;
              try {
                const q = video.getVideoPlaybackQuality?.();
                if (q) quality = { totalVideoFrames: q.totalVideoFrames ?? null, droppedVideoFrames: q.droppedVideoFrames ?? null };
              } catch (_) {}
              const now = getLfoVisualNow();
              const presentation = state.presentationSampler?.sample(now, state.frameCallbacks, quality, state.frame) ?? null;
              const presentedFramesDelta = state.frameCallbacks - state.lastReportedFrameCallbacks;
              state.lastReportedFrameCallbacks = state.frameCallbacks;
              const latestFrameObservationAgeMs = state.frame ? now - state.frame.observedAtMonotonicMs : null;
              const transport = video.srcObject ? "webrtc" : video.src ? "hardware_mse" : "unbound";
              const connectionState = pc?.connectionState || "not_applicable";
              const presentationState = helper?.presentationState?.({
                connectionState, trackAttached: state.trackAttached,
                trackReadyState: state.track?.readyState, playStatus: state.playStatus,
                decodedFrames: stats.video?.framesDecoded,
                decodedFramesAdvanced: stats.video?.framesAdvanced === true,
                presentedFramesDelta, latestFrameAgeMs: latestFrameObservationAgeMs, videoTransport: transport,
              }) ?? (state.trackAttached ? "track_attached_no_decoded_frames" : "waiting_for_track");
              applyMirrorPresentationState(presentationState);
              let pcmRuntimeQualified = null;
              try { pcmRuntimeQualified = localStorage.getItem(shared.PCM_RUNTIME_QUALIFICATION_KEY) === "true"; } catch (_) {}
              sendReceiverBridgeMessage({
                type: "GUI_CHANNEL_TELEMETRY", transport: "gui", event: "mirror_video_diagnostics", version: 1,
                guiProtocolVersion: shared.CAST_GUI_PROTOCOL_VERSION, guiSessionNonce: shared.guiSessionNonce, side: "receiver",
                mode: "MIRROR_CAST",
                buildIdentity: { version: window.MXS_BUILD_IDENTITY?.version ?? null,
                  receiverHtml: window.MXS_BUILD_IDENTITY?.artifacts?.receiverHtml ?? null },
                sessionId, sessionSequence, monotonicMs: now, connectionState,
                capabilities: helper?.capabilities(window.RTCRtpReceiver, "receive") ?? [],
                ...stats, playbackQuality: quality,
                presentation,
                presentationState, videoTransport: transport, trackReadyState: state.track?.readyState || null,
                videoReadyState: Number.isFinite(video.readyState) ? video.readyState : null,
                videoPlayStatus: state.playStatus,
                frameCallbackSupported: typeof video.requestVideoFrameCallback === "function",
                frameCallbacks: state.frameCallbacks, latestFrame: state.frame,
                latestFrameObservationAgeMs,
                display: { videoWidth: video.videoWidth || null, videoHeight: video.videoHeight || null,
                  viewportWidth: window.innerWidth || null, viewportHeight: window.innerHeight || null,
                  devicePixelRatio: window.devicePixelRatio || null },
                audio: { playbackMode: window._playbackMode || "unknown", pathOwner: shared.activeAudioPathOwner,
                  media: readNativeResumeMediaState(), nativeStreamActive: Boolean(shared.nativeStreamActive),
                  readiness: shared.activeAudioPathOwner === "pcm_v2" ? "pcm_requires_audible_verification" :
                    !shared.nativeStreamActive ? "inactive_or_starting" : shared.nativeStreamPaused ? "paused" : "playing_requires_audible_verification",
                  playbackEpoch: shared.lastPlaybackEpoch, playbackRevision: shared.lastPlaybackRevision,
                  preference: shared.receiverPlayoutPreference, pcmDegraded: window._pcmDegraded === true,
                  pcmRuntimeQualified, workletConstructorAvailable: typeof AudioWorkletNode === "function",
                  workletModuleApiAvailable: shared.audioCtx ? typeof shared.audioCtx.audioWorklet?.addModule === "function" : null },
                acousticOffsetMs: null,
                timingLimit: "composition_metadata_is_not_physical_display_or_acoustic_alignment",
              }, "gui", true);
              if (connectionState === "closed" || connectionState === "failed") stopMirrorDiagnostics();
            } catch (_) {
              // Optional observations must never interrupt playout or video.
            } finally { state.inFlight = false; }
          }, 5000);
          return state;
        }
        if (typeof window.addEventListener === "function") window.addEventListener("pagehide", stopMirrorDiagnostics);

        let mirrorPeerConnection = null;
        let activeMirrorSessionId = null;
        let activeMirrorSessionSequence = 0;
        const MAX_MIRROR_PENDING_ICE_CANDIDATES = 64;
        const MAX_MIRROR_PENDING_ICE_SESSIONS = 4;
        let mirrorRemoteDescriptionReady = false;
        let mirrorPendingIceCandidatesBySession = new Map();

        function mirrorSessionKey(sessionId, sessionSequence) {
          return JSON.stringify([sessionId, sessionSequence]);
        }

        function isMirrorSessionSignalNotStale(sessionId, sessionSequence) {
          if (typeof sessionId !== "string" || !sessionId || typeof sessionSequence !== "number" ||
              !Number.isSafeInteger(sessionSequence) || sessionSequence <= 0 || sessionSequence > Date.now() + 86400000) return false;
          let storedSequence = 0;
          let storedSessionId = null;
          try {
            const saved = String(window.localStorage.getItem("mxs004.receiverMirrorSession") || "");
            const separator = saved.indexOf(":");
            if (separator > 0) {
              storedSequence = Number(saved.slice(0, separator)) || 0;
              if (!Number.isSafeInteger(storedSequence) || storedSequence > Date.now() + 86400000) storedSequence = 0;
              storedSessionId = saved.slice(separator + 1) || null;
            }
          } catch (_) {}
          const latestSequence = Math.max(activeMirrorSessionSequence, storedSequence);
          const latestSessionId = activeMirrorSessionSequence >= storedSequence
            ? activeMirrorSessionId
            : storedSessionId;
          return sessionSequence > latestSequence ||
            (sessionSequence === latestSequence && latestSessionId === sessionId);
        }

        function queueMirrorIceCandidate(sessionId, sessionSequence, candidate) {
          const key = mirrorSessionKey(sessionId, sessionSequence);
          let queue = mirrorPendingIceCandidatesBySession.get(key);
          if (!queue) {
            if (mirrorPendingIceCandidatesBySession.size >= MAX_MIRROR_PENDING_ICE_SESSIONS) {
              const oldestKey = mirrorPendingIceCandidatesBySession.keys().next().value;
              mirrorPendingIceCandidatesBySession.delete(oldestKey);
            }
            queue = [];
            mirrorPendingIceCandidatesBySession.set(key, queue);
          }
          if (queue.length >= MAX_MIRROR_PENDING_ICE_CANDIDATES) return false;
          queue.push(candidate);
          return true;
        }

        function acceptMirrorSession(sessionId, sessionSequence) {
          const sequence = sessionSequence;
          if (!isMirrorSessionSignalNotStale(sessionId, sequence)) return false;
          try { window.localStorage.setItem("mxs004.receiverMirrorSession", sequence + ":" + sessionId); } catch (_) {}
          return true;
        }

        function activatePureScreenMirrorViewport() {
          try {
            if (document.body) {
              document.body.classList.add("pure-screen-mirror-mode");
            }
            const wrapper = document.getElementById("screen-mirror-wrapper");
            if (wrapper) {
              wrapper.style.display = "flex";
              wrapper.style.position = "fixed";
              wrapper.style.inset = "0";
              wrapper.style.width = "100vw";
              wrapper.style.height = "100vh";
              wrapper.style.setProperty("z-index", "2147483647", "important");
              wrapper.style.background = "#000";
            }
            const video = document.getElementById("mirror-video");
            if (video) {
              video.style.display = "block";
              video.style.position = "fixed";
              video.style.inset = "0";
              video.style.width = "100vw";
              video.style.height = "100vh";
              video.style.objectFit = "contain";
              video.style.background = "#000";
              // Keep pixels neutral until a controlled device calibration
              // establishes a measured color correction.
              video.style.filter = "none";
            }
            const hideIds = ["tv-console", "studio-root", "audio-unlock-overlay", "qa-overlay-root", "cursor-mirror", "gui-dialog-mirror-root", "gui-dialog-registry-root"];
            hideIds.forEach(function(id) {
              const el = document.getElementById(id);
              if (el) {
                el.style.setProperty("display", "none", "important");
                el.style.setProperty("visibility", "hidden", "important");
                el.style.setProperty("opacity", "0", "important");
              }
            });
          } catch (e) {
            console.warn("Could not activate pure screen mirror viewport:", e);
          }
        }

        let hardwareMediaSource = null;
        let hardwareSourceBuffer = null;
        let hardwareChunkQueue = [];
        let hardwareInFlightEntry = null;
        let hardwareMediaSourceUrl = null;
        let hardwareMediaSourceGeneration = 0;
        let hardwareInitSegment = null;
        let hardwareInitSegmentSessionSequence = null;
        let hardwareVideoFailedSessionSequence = null;
        const MAX_HARDWARE_CHUNK_BYTES = 8 * 1024 * 1024;

        function resetHardwareMirrorMediaSource(clearInitSegment) {
          hardwareMediaSourceGeneration += 1;
          const previousMediaSource = hardwareMediaSource;
          const previousUrl = hardwareMediaSourceUrl;
          hardwareMediaSource = null;
          hardwareSourceBuffer = null;
          hardwareChunkQueue = [];
          hardwareInFlightEntry = null;
          hardwareMediaSourceUrl = null;
          if (clearInitSegment) {
            hardwareInitSegment = null;
            hardwareInitSegmentSessionSequence = null;
          }
          const video = document.getElementById("mirror-video");
          if (video) {
            try { video.pause(); } catch (_) {}
            try { video.srcObject = null; } catch (_) {}
            try { video.removeAttribute("src"); } catch (_) {}
            try { video.load(); } catch (_) {}
          }
          if (previousMediaSource?.readyState === "open") {
            try { previousMediaSource.endOfStream(); } catch (_) {}
          }
          if (previousUrl) {
            try { URL.revokeObjectURL(previousUrl); } catch (_) {}
          }
        }

        function queueHardwareChunk(bytes, isInit) {
          hardwareChunkQueue.push({ bytes: bytes, isInit: isInit === true });
          while (hardwareChunkQueue.length > 3) {
            const discardIndex = hardwareChunkQueue.findIndex(function (entry) { return !entry.isInit; });
            hardwareChunkQueue.splice(discardIndex >= 0 ? discardIndex : 0, 1);
          }
        }

        function recoverHardwareAppendFailure(mediaSource, generation, failedEntry) {
          if (generation !== hardwareMediaSourceGeneration || hardwareMediaSource !== mediaSource) return;
          const failedAppend = failedEntry || hardwareInFlightEntry;
          if (failedAppend?.isInit) {
            // A deterministic init parse failure cannot recover by rebuilding
            // the same MSE and replaying the same bytes. Quarantine this
            // session until a newly accepted mirror session arrives.
            hardwareVideoFailedSessionSequence = activeMirrorSessionSequence;
            resetHardwareMirrorMediaSource(false);
            return;
          }
          const queued = hardwareChunkQueue.slice();
          const queuedInit = queued.find(function (entry) { return entry.isInit; });
          const retainedInitIsCurrent = hardwareInitSegment &&
            hardwareInitSegmentSessionSequence === activeMirrorSessionSequence;
          const initEntry = failedEntry?.isInit
            ? failedEntry
            : queuedInit || (retainedInitIsCurrent
              ? { bytes: hardwareInitSegment.slice(), isInit: true }
              : null);

          resetHardwareMirrorMediaSource(false);
          const recovered = [];
          if (initEntry) recovered.push(initEntry);
          // Drop the failed media fragment. Replaying a deterministic parse
          // failure only recreates the same broken SourceBuffer indefinitely.
          queued.forEach(function (entry) {
            if (!entry.isInit) recovered.push(entry);
          });
          // Preserve chronological order among retained entries and discard
          // the newest excess queued media under pressure.
          hardwareChunkQueue = recovered.slice(0, 3);
        }

        function handleHardwareVideoChunk(chunk) {
          const video = document.getElementById("mirror-video");
          if (!video) return;
          if (mirrorPeerConnection && mirrorPeerConnection.connectionState === "connected" && video.srcObject) return;
          if (hardwareVideoFailedSessionSequence === activeMirrorSessionSequence) return;
          if (!chunk || !Array.isArray(chunk.bytes) || chunk.bytes.length === 0 ||
              chunk.bytes.length > MAX_HARDWARE_CHUNK_BYTES) return;
          const uint8 = new Uint8Array(chunk.bytes);
          const isInit = chunk.isInit === true;
          if (isInit) {
            hardwareInitSegment = uint8.slice();
            hardwareInitSegmentSessionSequence = activeMirrorSessionSequence;
          }

          const needsMediaSource = !hardwareMediaSource;
          if (!hardwareMediaSource) {
            try {
              if ("MediaSource" in window && MediaSource.isTypeSupported('video/mp4; codecs="avc1.42e01f"')) {
                const generation = ++hardwareMediaSourceGeneration;
                const mediaSource = new MediaSource();
                hardwareMediaSource = mediaSource;
                hardwareMediaSourceUrl = URL.createObjectURL(mediaSource);
                video.src = hardwareMediaSourceUrl;
                const presentation = startMirrorDiagnostics(mirrorPeerConnection, video, activeMirrorSessionId,
                  activeMirrorSessionSequence, "hardware_mse");
                reportMirrorPresentationState(activeMirrorSessionId, activeMirrorSessionSequence,
                  "hardware_mse_attached_no_decoded_frames", "hardware_mse", { videoReadyState: video.readyState, playStatus: "starting" });
                if ("playoutDelayHint" in video) video.playoutDelayHint = 0.0;
                // Mirror video never owns audio; the authenticated PCM/CAF path does.
                video.muted = true;
                video.volume = 0.0;

                mediaSource.addEventListener("sourceopen", function() {
                  if (generation !== hardwareMediaSourceGeneration || hardwareMediaSource !== mediaSource) return;
                  let attemptedEntry = null;
                  try {
                    const sourceBuffer = mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42e01f"');
                    hardwareSourceBuffer = sourceBuffer;
                    sourceBuffer.mode = "sequence";
                    sourceBuffer.addEventListener("error", function (event) {
                      if (generation !== hardwareMediaSourceGeneration || hardwareMediaSource !== mediaSource ||
                          hardwareSourceBuffer !== sourceBuffer) return;
                      console.warn("⚠️ Receiver: SourceBuffer error:", event);
                      recoverHardwareAppendFailure(mediaSource, generation, hardwareInFlightEntry);
                    });
                    sourceBuffer.addEventListener("abort", function (event) {
                      if (generation !== hardwareMediaSourceGeneration || hardwareMediaSource !== mediaSource ||
                          hardwareSourceBuffer !== sourceBuffer) return;
                      console.warn("⚠️ Receiver: SourceBuffer append aborted:", event);
                      recoverHardwareAppendFailure(mediaSource, generation, hardwareInFlightEntry);
                    });
                    sourceBuffer.addEventListener("updateend", function() {
                      if (generation !== hardwareMediaSourceGeneration || hardwareMediaSource !== mediaSource ||
                          hardwareSourceBuffer !== sourceBuffer) return;
                      hardwareInFlightEntry = null;
                      if (hardwareChunkQueue.length > 0 && !sourceBuffer.updating) {
                        const next = hardwareChunkQueue.shift();
                        hardwareInFlightEntry = next;
                        try {
                          sourceBuffer.appendBuffer(next.bytes);
                        } catch (appendError) {
                          console.warn("⚠️ Receiver: queued media append failed:", appendError);
                          recoverHardwareAppendFailure(mediaSource, generation, next);
                        }
                      }
                    });
                    if (hardwareChunkQueue.length > 0) {
                      attemptedEntry = hardwareChunkQueue.shift();
                      hardwareInFlightEntry = attemptedEntry;
                      sourceBuffer.appendBuffer(attemptedEntry.bytes);
                    }
                    Promise.resolve(video.play()).then(function() {
                      if (mirrorDiagnosticsState === presentation) presentation.playStatus = "playing";
                    }).catch(function(error) {
                      if (mirrorDiagnosticsState === presentation) presentation.playStatus = "rejected";
                      reportMirrorPresentationState(activeMirrorSessionId, activeMirrorSessionSequence,
                        "video_play_rejected", "hardware_mse", { videoReadyState: video.readyState, playStatus: "rejected" });
                      relayLogToStudio("⚠️ Receiver: mirror-video.play deferred: " + String(error?.message || "play_rejected"));
                    });
                  } catch (sbErr) {
                    console.warn("⚠️ Receiver: addSourceBuffer error:", sbErr);
                    // Tear down only this failed generation. A later chunk can
                    // then create a fresh MediaSource; stale sourceopen
                    // callbacks cannot clear a replacement session's source.
                    if (generation === hardwareMediaSourceGeneration && hardwareMediaSource === mediaSource) {
                      if (attemptedEntry) {
                        recoverHardwareAppendFailure(mediaSource, generation, attemptedEntry);
                      } else {
                        recoverHardwareAppendFailure(mediaSource, generation, null);
                      }
                    }
                  }
                });
              }
            } catch (msErr) {
              console.warn("⚠️ Receiver: MediaSource error:", msErr);
            }
          }

          // A failed MSE generation drops its pending chunks. Seed a fresh
          // generation with the retained init segment before the next media
          // fragment, while preserving the three-entry queue bound.
          if (needsMediaSource && !isInit && hardwareInitSegment &&
              hardwareInitSegmentSessionSequence === activeMirrorSessionSequence &&
              !hardwareChunkQueue.some(function (entry) { return entry.isInit; })) {
            queueHardwareChunk(hardwareInitSegment.slice(), true);
          }

          if (hardwareSourceBuffer && hardwareMediaSource && !hardwareSourceBuffer.updating && hardwareChunkQueue.length === 0) {
            const entry = { bytes: uint8, isInit };
            hardwareInFlightEntry = entry;
            try {
              hardwareSourceBuffer.appendBuffer(uint8);
            } catch (appendError) {
              console.warn("⚠️ Receiver: direct media append failed:", appendError);
              recoverHardwareAppendFailure(
                hardwareMediaSource,
                hardwareMediaSourceGeneration,
                entry,
              );
            }
          } else {
            queueHardwareChunk(uint8, isInit);
          }
        }

        async function answerMirrorOffer(pc, sessionId, sessionSequence, offer, replyFn, sessionKey, closeOnFailure) {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            if (mirrorPeerConnection !== pc || activeMirrorSessionId !== sessionId ||
                activeMirrorSessionSequence !== sessionSequence) return false;
            const sessionCandidates = mirrorPendingIceCandidatesBySession.get(sessionKey) || [];
            while (sessionCandidates.length > 0) {
              if (mirrorPeerConnection !== pc || activeMirrorSessionId !== sessionId ||
                  activeMirrorSessionSequence !== sessionSequence) return false;
              const queuedCandidate = sessionCandidates.shift();
              try { await pc.addIceCandidate(new RTCIceCandidate(queuedCandidate)); }
              catch (candidateError) { relayLogToStudio("⚠️ Receiver: Error adding queued ICE candidate: " + candidateError.message); }
            }
            if (mirrorPeerConnection !== pc || activeMirrorSessionId !== sessionId ||
                activeMirrorSessionSequence !== sessionSequence) return false;
            mirrorPendingIceCandidatesBySession.delete(sessionKey);
            mirrorRemoteDescriptionReady = true;
            let answer = await pc.createAnswer();
            if (mirrorPeerConnection !== pc || activeMirrorSessionId !== sessionId ||
                activeMirrorSessionSequence !== sessionSequence) return false;
            if (answer && answer.sdp) {
              let sdp = answer.sdp;
              const opusRtpMap = sdp.match(/a=rtpmap:(\d+)\s+opus\/48000\/2[^\r\n]*/i);
              if (opusRtpMap) {
                const payloadType = opusRtpMap[1];
                const opusFmtp = new RegExp("^a=fmtp:" + payloadType + "[ \\t]+([^\\r\\n]*)", "im");
                const requiredParams = ["stereo=1", "sprop-stereo=1", "maxaveragebitrate=510000", "cbr=1", "usedtx=0"];
                const existingFmtp = sdp.match(opusFmtp);
                if (existingFmtp) {
                  const params = existingFmtp[1].split(";").map(function (value) { return value.trim(); }).filter(Boolean);
                  requiredParams.forEach(function (required) {
                    const key = required.slice(0, required.indexOf("=")).toLowerCase();
                    let replaced = false;
                    const merged = [];
                    params.forEach(function (param) {
                      if (param.split("=", 1)[0].trim().toLowerCase() !== key) merged.push(param);
                      else if (!replaced) { merged.push(required); replaced = true; }
                    });
                    if (!replaced) merged.push(required);
                    params.length = 0;
                    Array.prototype.push.apply(params, merged);
                  });
                  sdp = sdp.replace(opusFmtp, "a=fmtp:" + payloadType + " " + params.join(";"));
                } else {
                  sdp = sdp.replace(opusRtpMap[0], opusRtpMap[0] + "\r\na=fmtp:" + payloadType + " " + requiredParams.join(";"));
                }
              }
              answer = { type: answer.type, sdp };
            }
            await pc.setLocalDescription(answer);
            if (mirrorPeerConnection === pc && activeMirrorSessionId === sessionId &&
                activeMirrorSessionSequence === sessionSequence && typeof replyFn === "function") {
              replyFn({ type: "SCREEN_MIRROR_SIGNAL", signal: { type: "answer", answer, sessionId, sessionSequence } });
            }
            return true;
          } catch (error) {
            relayLogToStudio("❌ Receiver: Error handling screen mirror offer: " + error.message);
            if (mirrorPeerConnection === pc && activeMirrorSessionId === sessionId &&
                activeMirrorSessionSequence === sessionSequence) {
              mirrorRemoteDescriptionReady = false;
              mirrorPendingIceCandidatesBySession.delete(sessionKey);
              if (closeOnFailure) {
                stopMirrorDiagnostics();
                try { pc.close(); } catch (_) {}
                mirrorPeerConnection = null;
              }
            }
            return false;
          }
        }

        const mirrorOfferTransactions = new Map();
        async function handleScreenMirrorSignal(data, replyFn) {
          const isMirrorBranch = (typeof shared !== "undefined" && shared?.RECEIVER_BRANCH && shared.RECEIVER_BRANCH.mirror) ||
            (typeof window !== "undefined" && window.MXS_RECEIVER_BRANCH && window.MXS_RECEIVER_BRANCH.mirror) ||
            (typeof shared === "undefined" && typeof window === "undefined");
          if (!isMirrorBranch) return false;
          if (!data) return false;
          if (typeof identityAllowsGui === "function" && !identityAllowsGui()) return false;
          if (typeof shared !== "undefined" && shared?.receiverBridgeConfigReady === false) return false;
          if (typeof window !== "undefined" && window._handshakeAcked === false) return false;

          const signal = data?.signal || data;
          if (signal?.type !== "offer") return processScreenMirrorSignal(data, replyFn);

          const sdp = signal.offer?.sdp;
          if (typeof sdp !== "string" || sdp.length > 131072) {
            return false;
          }

          const key = mirrorSessionKey(signal.sessionId, signal.sessionSequence);
          let queue = mirrorOfferTransactions.get(key);
          if (!queue) {
            if (mirrorOfferTransactions.size >= MAX_MIRROR_PENDING_ICE_SESSIONS) return false;
            queue = { tail: Promise.resolve(), offers: new Map() };
            mirrorOfferTransactions.set(key, queue);
          }
          if (queue.offers.has(sdp)) return queue.offers.get(sdp);
          if (queue.offers.size >= 4) return false;
          const task = queue.tail.catch(() => {}).then(() => processScreenMirrorSignal(data, replyFn));
          queue.tail = task;
          queue.offers.set(sdp, task);
          try { return await task; }
          finally {
            queue.offers.delete(sdp);
            if (!queue.offers.size && mirrorOfferTransactions.get(key) === queue) mirrorOfferTransactions.delete(key);
          }
        }

        async function processScreenMirrorSignal(data, replyFn) {
          if (shared.RECEIVER_BRANCH && !shared.RECEIVER_BRANCH.mirror) return;
          if (!data || !identityAllowsGui() || !shared.receiverBridgeConfigReady || !window._handshakeAcked) return;
          activatePureScreenMirrorViewport();
          const signal = data.signal || data;
          if (signal.type === "HARDWARE_VIDEO_CHUNK" && signal.chunk &&
              signal.sessionId === activeMirrorSessionId &&
              signal.sessionSequence === activeMirrorSessionSequence) {
            handleHardwareVideoChunk(signal.chunk);
            return;
          }
          if (signal.type === "offer" && signal.offer) {
            if (!acceptMirrorSession(signal.sessionId, signal.sessionSequence)) return;
            const sessionId = signal.sessionId;
            const sessionSequence = signal.sessionSequence;
            if (mirrorPeerConnection && activeMirrorSessionId === sessionId &&
                activeMirrorSessionSequence === sessionSequence) {
              if (mirrorPeerConnection.remoteDescription?.sdp === signal.offer.sdp &&
                  mirrorPeerConnection.localDescription?.type === "answer" && typeof replyFn === "function") {
                replyFn({ type: "SCREEN_MIRROR_SIGNAL", signal: {
                  type: "answer", answer: mirrorPeerConnection.localDescription, sessionId, sessionSequence,
                } });
              } else if (mirrorPeerConnection.signalingState === "stable") {
                mirrorRemoteDescriptionReady = false;
                reportMirrorPresentationState(sessionId, sessionSequence, "connection_unavailable", "webrtc",
                  { connectionState: mirrorPeerConnection.connectionState, iceConnectionState: mirrorPeerConnection.iceConnectionState });
                await answerMirrorOffer(mirrorPeerConnection, sessionId, sessionSequence, signal.offer,
                  replyFn, mirrorSessionKey(sessionId, sessionSequence), false);
              }
              return;
            }
            activeMirrorSessionId = sessionId;
            activeMirrorSessionSequence = sessionSequence;
            reportMirrorPresentationState(sessionId, sessionSequence, "waiting_for_track", "webrtc");
            hardwareVideoFailedSessionSequence = null;
            mirrorRemoteDescriptionReady = false;
            const sessionKey = mirrorSessionKey(sessionId, sessionSequence);
            const queuedCandidates = mirrorPendingIceCandidatesBySession.get(sessionKey) || [];
            mirrorPendingIceCandidatesBySession.clear();
            if (queuedCandidates.length) mirrorPendingIceCandidatesBySession.set(sessionKey, queuedCandidates);
            stopMirrorDiagnostics();
            resetHardwareMirrorMediaSource(true);
            if (mirrorPeerConnection) {
              try { mirrorPeerConnection.close(); } catch (_) {}
              mirrorPeerConnection = null;
            }
            const pc = new RTCPeerConnection({
              iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
            });
            mirrorPeerConnection = pc;
            const reportTransportState = () => {
              if (mirrorPeerConnection !== pc || activeMirrorSessionId !== sessionId ||
                  activeMirrorSessionSequence !== sessionSequence) return;
              const video = document.getElementById("mirror-video");
              const videoTransport = video?.srcObject ? "webrtc" : video?.src ? "hardware_mse" : "unbound";
              const presentationState = window.MXSMirrorDiagnostics?.presentationState?.({
                connectionState: pc.connectionState, trackAttached: Boolean(video?.srcObject),
                trackReadyState: video?.srcObject?.getVideoTracks?.()[0]?.readyState,
                playStatus: mirrorDiagnosticsState?.playStatus,
                decodedFrames: null, videoTransport,
              }) ?? (pc.connectionState === "connected" ? "waiting_for_track" : "connection_unavailable");
              reportMirrorPresentationState(sessionId, sessionSequence, presentationState, videoTransport, {
                trackReadyState: video?.srcObject?.getVideoTracks?.()[0]?.readyState,
                videoReadyState: video?.readyState, playStatus: mirrorDiagnosticsState?.playStatus,
                connectionState: pc.connectionState, iceConnectionState: pc.iceConnectionState,
              });
            };
            pc.onconnectionstatechange = reportTransportState;
            pc.oniceconnectionstatechange = reportTransportState;
            try {
              const capabilities = RTCRtpReceiver.getCapabilities?.("video")?.codecs || [];
              if (capabilities.some((codec) => /video\/h264/i.test(codec.mimeType || ""))) {
                const transceiver = pc.addTransceiver("video", { direction: "recvonly" });
                const ordered = ["video/h264", "video/vp8", "video/vp9"]
                  .flatMap((mime) => capabilities.filter((codec) => String(codec.mimeType).toLowerCase() === mime));
                const repair = capabilities.filter((codec) => /video\/(?:rtx|red|ulpfec|flexfec-03)/i.test(codec.mimeType || ""));
                if (ordered.length) transceiver.setCodecPreferences([...ordered, ...repair]);
              }
            } catch (codecPreferenceError) {
              console.warn("Receiver could not set mirror codec preference:", codecPreferenceError);
            }

            pc.ontrack = function (event) {
              if (mirrorPeerConnection !== pc || activeMirrorSessionId !== sessionId) return;
              relayLogToStudio("🎥 Receiver: Screen mirror video track received (" + event.track.kind + ")");
              activatePureScreenMirrorViewport();
              if (event.receiver) {
                try {
                  if ("playoutDelayHint" in event.receiver) event.receiver.playoutDelayHint = 0.0;
                  if ("jitterBufferDelayHint" in event.receiver) event.receiver.jitterBufferDelayHint = 0.0;
                } catch (_) {}
              }
              const video = document.getElementById("mirror-video");
              if (video && event.streams && event.streams[0]) {
                try {
                  if ("playoutDelayHint" in video) video.playoutDelayHint = 0.0;
                } catch (_) {}
                video.srcObject = event.streams[0];
                const state = startMirrorDiagnostics(pc, video, sessionId, sessionSequence);
                state.track = event.track || null;
                // Mirror video never owns audio; the authenticated PCM/CAF path does.
                video.muted = true;
                video.volume = 0.0;
                state.playStatus = "starting";
                reportMirrorPresentationState(sessionId, sessionSequence, "track_attached_no_decoded_frames", "webrtc",
                  { trackReadyState: event.track?.readyState, videoReadyState: video.readyState, playStatus: state.playStatus });
                let playPromise;
                try { playPromise = video.play(); }
                catch (err) { playPromise = Promise.reject(err); }
                Promise.resolve(playPromise).then(function() {
                  if (mirrorDiagnosticsState !== state || !state.trackAttached) return;
                  state.playStatus = "playing";
                }).catch(function(err) {
                  if (mirrorDiagnosticsState === state) state.playStatus = "rejected";
                  reportMirrorPresentationState(sessionId, sessionSequence, "video_play_rejected", "webrtc",
                    { trackReadyState: event.track?.readyState, videoReadyState: video.readyState, playStatus: "rejected" });
                  relayLogToStudio("⚠️ Receiver: mirror-video.play deferred: " + err.message);
                });
              }
            };

            pc.onicecandidate = function (event) {
              if (mirrorPeerConnection === pc && activeMirrorSessionId === sessionId &&
                  activeMirrorSessionSequence === sessionSequence && event.candidate &&
                  typeof replyFn === "function") {
                replyFn({
                  type: "SCREEN_MIRROR_SIGNAL",
                  signal: {
                    type: "candidate",
                    candidate: event.candidate,
                    sessionId: sessionId,
                    sessionSequence: sessionSequence
                  }
                });
              }
            };

            await answerMirrorOffer(pc, sessionId, sessionSequence, signal.offer, replyFn, sessionKey, true);
          } else if (signal.type === "candidate" && signal.candidate &&
              isMirrorSessionSignalNotStale(signal.sessionId, signal.sessionSequence)) {
            const matchesActiveSession = signal.sessionId === activeMirrorSessionId &&
              signal.sessionSequence === activeMirrorSessionSequence;
            if (!matchesActiveSession) {
              if (!queueMirrorIceCandidate(signal.sessionId, signal.sessionSequence, signal.candidate)) {
                relayLogToStudio("⚠️ Receiver: Dropped mirror ICE candidate because its pending session queue is full.");
              }
              return;
            }
            if (!mirrorPeerConnection) return;
            if (!mirrorRemoteDescriptionReady) {
              if (!queueMirrorIceCandidate(signal.sessionId, signal.sessionSequence, signal.candidate)) {
                relayLogToStudio("⚠️ Receiver: Dropped mirror ICE candidate because its pending session queue is full.");
              }
              return;
            }
            const pc = mirrorPeerConnection;
            const sessionId = activeMirrorSessionId;
            const sessionSequence = activeMirrorSessionSequence;
            try {
              await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
            } catch (err) {
              if (mirrorPeerConnection === pc && activeMirrorSessionId === sessionId &&
                  activeMirrorSessionSequence === sessionSequence) {
                relayLogToStudio("⚠️ Receiver: Error adding ICE candidate: " + err.message);
              }
            }
          }
        }


  return Object.freeze({ handleScreenMirrorSignal, activatePureScreenMirrorViewport,
    applyMirrorPresentationState, stopMirrorDiagnostics });
};

Object.defineProperty(window, "MXSCreateMirrorReceiver", {
  value: Object.freeze(createMirrorReceiver),
  writable: false,
  configurable: false,
  enumerable: true,
});



      window.SERVER_PORT = "{{SERVER_PORT}}";
      window.SECURITY_TOKEN = "{{SECURITY_TOKEN}}";

        // [v13.9.509] Do not redirect during Cast bootstrap. A launch-time
        // self-redirect can leave a custom receiver on a blank page before
        // CAF initializes. Asset URLs are versioned, and explicit receiver
        // reloads add their own cache-buster after the app is running.
        try {
          localStorage.removeItem("mxs_pcm_degraded");
        } catch (e) {}

      (function () {
        var audioCtx = null;
        var masterGain = null;
        var workletNode = null;
        window._receiverShutdownInProgress = false;
        window._isFreshSession = true;
        try {
          window._pcmDegraded = localStorage.getItem("mxs_pcm_degraded") === "true";
        } catch (e) {
          window._pcmDegraded = false;
        }
        var configReceived = false;
        window._studioRate = 48000;
        window._hwRate = 48000;
        var autoDiscoveryFallbackTimeoutId = null;
        var autoUnlockIntervalId = null;
        var noSenderShutdownTimeoutId = null;
        var pendingBinaryFrames = [];
        var workletReady = false;
        var pendingStartupTrimLogged = false;
        var workletInitPromise = null;
        var workletCapabilityPromise = null;
        var workletCapabilityResult = null;
        var workletCapabilityContext = null;
        var workletLifecycleGeneration = 0;
        var workletInitializationCount = 0;
        var workletHardTeardownCount = 0;
        var workletQueueResetCount = 0;
        var lastPcmQueueResetAt = 0;
        var lastBinaryResetReason = "";
        var lastBinaryResetAt = 0;
        var lastNativeStopReason = "";
        var lastNativeStopAt = 0;
        const BUILD_IDENTITY_SCHEMA = "mxs-004.clock-sync-pcm.build-identity";
        const BUILD_IDENTITY_COMPONENTS = [
          "senderCritical",
          "tauriCastingBackend",
          "receiverHtml",
          "receiverLogic",
          "receiverPcmWorklet",
        ];
        var buildIdentityAccepted = false;
        var buildIdentityRejected = false;
        var pendingBuildIdentityRejection = null;
        const BUILD_IDENTITY_RELOAD_SESSION_KEY = "mxs_build_identity_reload_attempt";
        // The identity-reload marker is deliberately not a session cache:
        // it must survive the cache-busted reload so a persistent mismatch
        // remains one-shot instead of becoming an infinite reload loop.
        const RECEIVER_SESSION_CACHE_KEYS = [
          "mxs_pcm_degraded",
        ];
        window._buildIdentityAccepted = false;
        // Keep at most about one second of packets while the worklet or its
        // nominal target is not ready. Normal startup publishes the target
        // before the first packet; exceeding this bound is an explicit native
        // fallback, never silent packet deletion.
        const PENDING_BINARY_FRAMES_MAX = 48;
        const VERSION_TAG = "v13.9.509-APORv2";
        const CUSTOM_NAMESPACE = "urn:x-cast:com.nowmultimedia.mxs004";
        const CAST_GUI_PROTOCOL_VERSION = 1;
        let guiInteractionRevision = 0;
        const ENABLE_NATIVE_STREAM_PLAYOUT = true;
        var nativeStreamActive = false;
        var nativeStreamStarting = false;
        var nativeStreamUrl = "";
        var nativeStreamPaused = false;
        var nativeStreamPrewarmBeforePlayback = false;
        var nativeStreamPrewarmReady = false;
        var nativeStreamCompanionForPcm = false;
        var nativeFailureRetryAttempted = false;
        var playbackPaused = false;
        var nativeStartupAttemptId = 0;
        var nativeStreamReloadTimerId = null;
        var nativeStartupTrimPending = false;
        var nativeStartupWatchdogId = null;
        var lowLatencyStartupWatchdogId = null;
        var pcmStartupRetryTimerId = null;
        // CAF normally reaches PLAYING in well under one second after the
        // ordered Play boundary. Keep the native fallback bounded so a
        // decoder that never becomes audible cannot hold the session silent.
        const NATIVE_STARTUP_TIMEOUT_MS = 2000;
        const NATIVE_STARTUP_FADE_MS = 12;
        const PCM_STARTUP_HARD_TIMEOUT_MS = 10000;
        const WORKLET_CAPABILITY_TIMEOUT_MS = 1000;
        const WORKLET_PRODUCTION_TIMEOUT_MS = 1500;
        const WORKLET_CAPABILITY_CACHE_KEY = "mxs_audio_worklet_capability_v1";
        // Bump this only when the receiver changes its AudioWorklet loading
        // compatibility strategy. A proven production AbortError is a device
        // capability result, not a source-build result, and must survive normal
        // receiver deployments or every new QA build pays the same dead path.
        const WORKLET_CAPABILITY_GENERATION = "cobalt-production-worklet-v1";
        // A fresh native stream must not replay the buffered tail of a prior
        // idle session. Correct an oversized live buffer once at startup;
        // steady-state playback remains at rate 1.0 with no clock chasing.
        const NATIVE_STARTUP_TRIM_THRESHOLD_SEC = 1.25;
        // Keep a fresh native stream close to the live edge. A larger startup
        // target creates a conspicuous first-play pause before file audio.
        const NATIVE_STARTUP_TARGET_SEC = 0.08;
        // A Chromecast can abort AudioWorklet module/context startup even when
        // the source fetch is valid. Preload owns the normal path; this bounded
        // fallback is only a safety net for a genuinely hung or failed load.
        const PCM_STARTUP_MAX_RETRIES_BEFORE_NATIVE = 1;
        const PCM_QUEUE_RESET_DEDUPE_MS = 250;
        window._nativeStreamActive = false;
        window._playbackMode = "unknown";
        var playbackModeSocketGeneration = 0;
        var pcmV2Validator = null;
        var pcmV2AllowInitialOffset = true;

        function clearReceiverSessionCaches(reason) {
          const cacheReason = reason || "receiver_session";
          try {
            RECEIVER_SESSION_CACHE_KEYS.forEach((key) => {
              sessionStorage.removeItem(key);
              localStorage.removeItem(key);
            });
          } catch (e) {}
          window._buildIdentityReloadAttempted = false;
          try {
            if (window.caches?.keys) {
              void window.caches.keys().then((names) => Promise.all(
                names
                  .filter((name) => /mxs|receiver/i.test(String(name)))
                  .map((name) => window.caches.delete(name)),
              )).catch(() => {});
            }
          } catch (e) {}
          relayLogToStudio(`🧹 Receiver session cache cleared (${cacheReason}).`);
        }
        // Playback commands can arrive twice because the sender deliberately
        // mirrors control messages over both the Cast namespace and the bridge
        // WebSocket. Keep command and GUI-state ordering separate: equal
        // command revisions are duplicates; GUI snapshots use their own
        // revision stream and can never control audio playout.
        var lastPlaybackEpoch = -1;
        var lastPlaybackRevision = -1;
        var allowSamePlaybackRevisionReplay = false;
        var lastOrderedPlaybackAction = "";
        var lastOrderedPlaybackAt = 0;
        const PLAYER_MANAGER_ORDER_GUARD_MS = 5000;
        var lastGuiRevision = -1;
        var lastCursorRevision = -1;
        var guiReceivedCount = 0;
        const PCM_RUNTIME_HIGH_WATERMARK_DIAGS = 3;
        var pcmRuntimeHighWatermarkDiagnostics = 0;
        var pcmRuntimeNativeFallbacks = 0;
        var expectedPcmSessionId = null;
        var frozenJitterTarget = null;

        function createPcmV2Telemetry() {
          return {
            binaryPackets: 0,
            receivedPackets: 0,
            inputFrames: 0,
            rejectedPackets: 0,
            sequenceGapEvents: 0,
            missingPackets: 0,
            sourceFrameGapEvents: 0,
            missingSourceFrames: 0,
            duplicates: 0,
            outOfOrder: 0,
            sourceFrameRegressions: 0,
            staleSession: 0,
            sampleRateChanges: 0,
            receiverRateMismatches: 0,
            queueDroppedPackets: 0,
            queueDroppedFrames: 0,
            lastQueueDropReason: null,
            emergencyFailures: 0,
            startupFallbacks: 0,
            startupFallbackDroppedFrames: 0,
            pcmAudioPriorityActive: false,
            pcmAudioPriorityGuiSkips: 0,
            pcmAudioPrioritySuppressedLogs: 0,
            sessionStarts: 0,
            sessionChanges: 0,
            baselineSequence: null,
            baselineSourceFrame: null,
          };
        }

        var pcmV2Telemetry = createPcmV2Telemetry();
        var playbackModeLastSentGeneration = -1;
        var playbackModeLastSent = "";
        var playbackModeLastSentReady = null;
        var pendingPlaybackMode = null;
        var pendingPlayoutSelection = null;
        var lastPlaybackStartSignalAt = 0;
        var playbackRecoveryRetryTimer = null;
        var playbackRecoveryRetryAttempted = false;
        var receiverStartupTimingStartAt = Date.now();
        var receiverStartupTimingMarks = {};
        var receiverHandshakeTelemetryReady = false;
        var receiverBridgeConfigReady = false;
        var pcmAudioPriorityActive = false;
        var deferredGuiState = null;
        var deferredReceiverTelemetry = [];
        const MAX_DEFERRED_RECEIVER_TELEMETRY = 128;

        function emitReceiverTelemetry(message) {
          if (receiverHandshakeTelemetryReady) {
            relayLogToStudio(message);
            return;
          }
          if (deferredReceiverTelemetry.length >= MAX_DEFERRED_RECEIVER_TELEMETRY) {
            deferredReceiverTelemetry.shift();
          }
          deferredReceiverTelemetry.push(message);
        }

        function flushDeferredReceiverTelemetry() {
          if (!receiverHandshakeTelemetryReady || !deferredReceiverTelemetry.length) {
            return;
          }
          const pending = deferredReceiverTelemetry.splice(0);
          pending.forEach(function (message) {
            relayLogToStudio(message);
          });
        }

        function maybeEnableReceiverHandshakeTelemetry() {
          if (
            receiverHandshakeTelemetryReady ||
            !window._handshakeAcked ||
            !receiverBridgeConfigReady
          ) {
            return;
          }
          receiverHandshakeTelemetryReady = true;
          flushDeferredReceiverTelemetry();
          flushPendingStudioLogs();
          // The bridge-open GUI_READY is intentionally independent of audio,
          // but it can arrive before the authenticated command gate is ready.
          // Send a second readiness edge so the sender can replay its latest
          // GUI snapshot after HANDSHAKE_ACK and BRIDGE_CONFIG are both live.
          if (binaryWS && binaryWS.readyState === WebSocket.OPEN) {
            try {
              binaryWS.send(JSON.stringify({
                type: "GUI_READY",
                transport: "gui",
                guiProtocolVersion: CAST_GUI_PROTOCOL_VERSION,
                guiRevision: lastGuiRevision,
                bootStage: "bridge_authenticated",
              }));
              relayLogToStudio("✅ Receiver: Authenticated GUI_READY sent; GUI snapshot replay is now safe.");
            } catch (e) {
              relayLogToStudio("⚠️ Receiver: Authenticated GUI_READY send failed: " + e.message);
            }
          }
        }

        function resetPcmContinuityForMode(mode, reason) {
          if (mode !== "pcm_fallback" && mode !== "native") {
            return;
          }
          // Native takeover intentionally creates a transport gap. When PCM
          // resumes, the backend starts a fresh ASRC/output sequence even
          // though the Cast session id remains stable. Rebase the receiver
          // validator so that intentional handoff gaps are not reported as
          // packet loss or stale-session failures.
          pcmV2Validator = null;
          pcmV2AllowInitialOffset = true;
          pcmV2Telemetry.baselineSequence = null;
          pcmV2Telemetry.baselineSourceFrame = null;
        }
        const PLAYBACK_START_GRACE_MS = 2500;
        var cafLoadInterceptorConfigured = false;
        var suppressedPlayerManagerStopCount = 0;
        var suppressedPlayerManagerStopTimerId = null;
        var suppressedPlayerManagerStopAttemptId = -1;
        var castDebugLogger = null;
        var castDebugLoggerConfigured = false;
        const CAST_DEBUG_TAG = "MXS004.RECEIVER";

        function isBuildIdentity(value) {
          return !!(
            value &&
            typeof value === "object" &&
            value.schema === BUILD_IDENTITY_SCHEMA &&
            value.version === 1 &&
            value.algorithm === "sha256" &&
            Object.keys(value).length === 4 &&
            value.components &&
            typeof value.components === "object" &&
            Object.keys(value.components).length === BUILD_IDENTITY_COMPONENTS.length &&
            BUILD_IDENTITY_COMPONENTS.every(function (key) {
              return /^[a-f0-9]{64}$/.test(value.components[key]);
            })
          );
        }

        function buildIdentitiesMatch(expected, received) {
          return (
            isBuildIdentity(expected) &&
            isBuildIdentity(received) &&
            BUILD_IDENTITY_COMPONENTS.every(function (key) {
              return expected.components[key] === received.components[key];
            })
          );
        }

        function logReceiverStartupTiming(stage, details) {
          if (!stage || receiverStartupTimingMarks[stage]) {
            return;
          }
          const now = Date.now();
          receiverStartupTimingMarks[stage] = now;
          emitReceiverTelemetry(
            "🧭 Receiver startup timing: " +
              JSON.stringify(
                Object.assign(
                  {
                    event: "receiver_startup_timing",
                    stage: stage,
                    elapsedMs: now - receiverStartupTimingStartAt,
                    atMs: now,
                    playbackMode: window._playbackMode || "unknown",
                  },
                  details || {},
                ),
              ),
          );
        }

        function markReceiverBoot(stage, details) {
          if (!stage) return;
          window._receiverBootStage = stage;
          logReceiverStartupTiming(stage, details);
        }

        function reportReceiverRuntimeCapabilities() {
          const runtime = {
            userAgent: navigator.userAgent || "unknown",
            protocol: window.location.protocol || "unknown",
            bigint: typeof BigInt === "function",
            websocket: typeof WebSocket === "function",
            audioContext: !!(window.AudioContext || window.webkitAudioContext),
            audioWorklet: !!(
              (window.AudioContext || window.webkitAudioContext) &&
              window.AudioWorkletNode
            ),
            castFramework: !!(window.cast && window.cast.framework),
          };
          window._receiverRuntimeCapabilities = runtime;
          emitReceiverTelemetry("📋 Receiver runtime capabilities: " + JSON.stringify(runtime));
          return runtime;
        }

        function reportBuildIdentityRejection(reason, received) {
          if (buildIdentityRejected) return;
          const details = {
            type: "BUILD_IDENTITY_REJECTED",
            event: "build_identity_rejected",
            role: "receiver",
            reason: reason,
            match: false,
            expected: window.MXS_BUILD_IDENTITY || null,
            received: received || null,
          };
          buildIdentityAccepted = false;
          buildIdentityRejected = true;
          window._buildIdentityAccepted = false;
          pendingBuildIdentityRejection = details;
          console.error("❌ Receiver: Build identity rejected", details);
          relayLogToStudio("❌ Receiver build identity rejected: " + JSON.stringify(details));
          if (binaryWS && binaryWS.readyState === WebSocket.OPEN) {
            try {
              binaryWS.send(JSON.stringify(details));
              pendingBuildIdentityRejection = null;
            } catch (e) {}
          }

          // A receiver page can outlive the deployment that launched it. If
          // the sender presents a newer identity, refresh once with a
          // document-level cache buster so the updated index can select the
          // matching versioned build_identity.js asset. Keep this one-shot per
          // receiver page session; persistent mismatches remain fail-closed.
          if (received && !buildIdentitiesMatch(window.MXS_BUILD_IDENTITY, received)) {
            let reloadAllowed = true;
            const receivedKey = JSON.stringify(received);
            try {
              if (sessionStorage.getItem(BUILD_IDENTITY_RELOAD_SESSION_KEY) === receivedKey) {
                reloadAllowed = false;
              } else {
                sessionStorage.setItem(BUILD_IDENTITY_RELOAD_SESSION_KEY, receivedKey);
              }
            } catch (e) {
              reloadAllowed = !window._buildIdentityReloadAttempted;
              window._buildIdentityReloadAttempted = true;
            }
            if (reloadAllowed) {
              reloadReceiver(
                "🔄 Receiver: Build identity mismatch; requesting one cache-busted receiver reload.",
                250,
              );
            }
          }
        }

        function acceptBuildIdentity(received, source) {
          if (!buildIdentitiesMatch(window.MXS_BUILD_IDENTITY, received)) {
            reportBuildIdentityRejection(source + "_identity_missing_malformed_or_mismatched", received);
            return false;
          }
          if (buildIdentityRejected) return false;
          const wasAccepted = buildIdentityAccepted;
          buildIdentityAccepted = true;
          window._buildIdentityAccepted = true;
          if (!wasAccepted) {
            try {
              sessionStorage.removeItem(BUILD_IDENTITY_RELOAD_SESSION_KEY);
            } catch (e) {}
            emitReceiverTelemetry(
              "✅ Receiver build identity verified: " +
                JSON.stringify({
                  event: "build_identity_verified",
                  role: "receiver",
                  match: true,
                  expected: window.MXS_BUILD_IDENTITY,
                  received: received,
                }),
            );
          }
          return true;
        }

        function identityAllowsAudio() {
          return buildIdentityAccepted && !buildIdentityRejected;
        }

        function getCastReceiverContext() {
          if (typeof cast === "undefined" || !cast.framework) {
            return null;
          }
          if (window.castReceiverContext) {
            return window.castReceiverContext;
          }
          try {
            window.castReceiverContext = cast.framework.CastReceiverContext.getInstance();
            return window.castReceiverContext;
          } catch (e) {
            console.warn("⚠️ Receiver: Cast context unavailable:", e);
            return null;
          }
        }

        function getCastPlayerManager() {
          const context = getCastReceiverContext();
          if (!context || typeof context.getPlayerManager !== "function") {
            return null;
          }
          return context.getPlayerManager();
        }

        function publishMxsPlaybackStatus(playbackState, reason) {
          const pm = getCastPlayerManager();
          if (!pm) return;
          const playoutPath = nativeStreamActive
            ? (nativeStreamPaused ? "native_paused" : "native")
            : (window._binaryActive || window._playbackMode === "pcm_fallback" ? "pcm_fallback" : "idle");
          const customState = {
            source: "mxs004",
            authoritative: "mxs_playback",
            playbackState: playbackState || "IDLE",
            playoutPath,
            paused: playbackState === "PAUSED",
            reason: reason || "",
            timestampMs: Date.now(),
          };
          try {
            if (typeof pm.sendCustomState === "function") {
              pm.sendCustomState(customState);
            }
          } catch (e) {}
          try {
            if (typeof pm.broadcastStatus === "function") {
              pm.broadcastStatus(false, undefined, customState);
            }
          } catch (e) {}
        }

        let deviceCapabilitiesLogged = false;
        let pendingStudioLogQueue = [];
        let flushingPendingStudioLogs = false;
        let hardwareTelemetryRetryId = null;
        let hardwareTelemetryRetryCount = 0;
        let receiverPlayoutPreference = "pcm_fallback";
        let lowLatencyStartupRetryCount = 0;
        let activeAudioPathOwner = "none";
        window._receiverPlayoutPreference = receiverPlayoutPreference;

        function setActiveAudioPathOwner(path, reason) {
          const nextPath = path || "none";
          if (activeAudioPathOwner === nextPath) return;
          const previousPath = activeAudioPathOwner;
          activeAudioPathOwner = nextPath;
          window._activeAudioPathOwner = nextPath;
          relayLogToStudio(
            "🎚️ Receiver audio path owner: " + previousPath + " -> " + nextPath +
              (reason ? " (" + reason + ")" : "") + ".",
          );
        }

        function setPcmAudioPriority(active, reason) {
          const nextActive = active === true;
          if (pcmAudioPriorityActive === nextActive) {
            pcmV2Telemetry.pcmAudioPriorityActive = nextActive;
            return;
          }
          pcmAudioPriorityActive = nextActive;
          pcmV2Telemetry.pcmAudioPriorityActive = nextActive;
          if (nextActive) {
            relayLogToStudio(
              "🎛️ Receiver PCM audio priority enabled" +
                (reason ? " (" + reason + ")" : "") + ".",
            );
            return;
          }
          if (deferredGuiState) {
            const state = deferredGuiState;
            deferredGuiState = null;
            renderState(state, true);
            lastMirroredState = state;
          }
          relayLogToStudio(
            "🎛️ Receiver PCM audio priority released" +
              (reason ? " (" + reason + ")" : "") + ".",
          );
        }

        function pcmPathOwnsAudio() {
          return (
            activeAudioPathOwner === "pcm_v2" &&
            receiverPlayoutPreference === "pcm_fallback" &&
            !window._pcmDegraded &&
            !nativeStreamStarting &&
            !nativeStreamActive
          );
        }

        function formatTelemetryValue(value) {
          if (value === null) {
            return "null";
          }
          if (value === undefined) {
            return "undefined";
          }
          if (typeof value === "string") {
            return value;
          }
          if (typeof value === "number" || typeof value === "boolean") {
            return String(value);
          }
          try {
            return JSON.stringify(value);
          } catch (e) {
            return "[unserializable]";
          }
        }

        function summarizeTelemetryValue(value, depth) {
          const currentDepth = depth || 0;
          if (value === null || value === undefined) {
            return value;
          }
          if (typeof value !== "object") {
            return value;
          }
          if (Array.isArray(value)) {
            return value.map(function (item) {
              return summarizeTelemetryValue(item, currentDepth + 1);
            });
          }
          if (currentDepth >= 2) {
            return "[object]";
          }

          const summary = {};
          Object.keys(value)
            .sort()
            .forEach(function (key) {
              const entry = value[key];
              if (
                entry === null ||
                entry === undefined ||
                typeof entry === "string" ||
                typeof entry === "number" ||
                typeof entry === "boolean"
              ) {
                summary[key] = entry;
              } else if (Array.isArray(entry)) {
                summary[key] = summarizeTelemetryValue(entry, currentDepth + 1);
              } else {
                summary[key] = summarizeTelemetryValue(entry, currentDepth + 1);
              }
          });
          return summary;
        }

        function collectReceiverHardwareTelemetry(context) {
          const telemetry = {
            capabilities: null,
            deviceInformation: null,
            mediaSupport: [],
            playbackPreference: receiverPlayoutPreference,
            host: {
              userAgent: navigator.userAgent,
              platform: navigator.platform || "unknown",
              screen: window.screen.width + "x" + window.screen.height + "@" + window.devicePixelRatio,
            },
          };

          if (context && typeof context.getDeviceCapabilities === "function") {
            try {
              telemetry.capabilities = context.getDeviceCapabilities();
            } catch (e) {
              telemetry.capabilities = { error: "getDeviceCapabilities failed: " + e.message };
            }
          }

          if (context && typeof context.getDeviceInformation === "function") {
            try {
              telemetry.deviceInformation = context.getDeviceInformation();
            } catch (e) {
              telemetry.deviceInformation = { error: "getDeviceInformation failed: " + e.message };
            }
          }

          if (context && typeof context.canDisplayType === "function") {
            const probes = [
              {
                label: "pcm16_wav_48k",
                mimeType: "audio/wav",
                codecs: "",
              },
              {
                label: "aac_lc_mp4_48k",
                mimeType: "audio/mp4",
                codecs: 'mp4a.40.2',
              },
              {
                label: "opus_webm_48k",
                mimeType: "audio/webm",
                codecs: 'opus',
              },
              {
                label: "h264_mp4_720p30",
                mimeType: "video/mp4",
                codecs: 'avc1.42E01E, mp4a.40.2',
                width: 1280,
                height: 720,
                framerate: 30,
              },
              {
                label: "vp9_webm_720p30",
                mimeType: "video/webm",
                codecs: 'vp9, opus',
                width: 1280,
                height: 720,
                framerate: 30,
              },
            ];
            probes.forEach(function (probe) {
              try {
                telemetry.mediaSupport.push({
                  label: probe.label,
                  mimeType: probe.mimeType,
                  codecs: probe.codecs,
                  width: probe.width,
                  height: probe.height,
                  framerate: probe.framerate,
                  supported: context.canDisplayType(
                    probe.mimeType,
                    probe.codecs,
                    probe.width,
                    probe.height,
                    probe.framerate,
                  ),
                });
              } catch (e) {
                telemetry.mediaSupport.push({
                  label: probe.label,
                  error: e.message,
                });
              }
            });
          }

          return telemetry;
        }

        function determineReceiverPlayoutPreference(context, telemetry) {
          return "pcm_fallback";
        }

        function setReceiverPlayoutPreference(mode, reason) {
          if (!mode || receiverPlayoutPreference === mode) {
            return;
          }
          receiverPlayoutPreference = mode;
          window._receiverPlayoutPreference = mode;
          emitReceiverTelemetry(
            "📟 Receiver: Playback preference set to " +
              mode +
              (reason ? " (" + reason + ")" : "") +
              ".",
          );
        }

        function clearReceiverHardwareTelemetryRetry() {
          if (hardwareTelemetryRetryId) {
            clearTimeout(hardwareTelemetryRetryId);
            hardwareTelemetryRetryId = null;
          }
          hardwareTelemetryRetryCount = 0;
        }

        function emitReceiverHardwareTelemetry(context) {
          if (deviceCapabilitiesLogged || !context) {
            return false;
          }

          const telemetry = collectReceiverHardwareTelemetry(context);
          const hasTelemetry =
            telemetry.capabilities !== null ||
            telemetry.deviceInformation !== null ||
            telemetry.mediaSupport.length > 0;

          if (!hasTelemetry) {
            return false;
          }

          deviceCapabilitiesLogged = true;
          clearReceiverHardwareTelemetryRetry();
          telemetry.playbackPreference = determineReceiverPlayoutPreference(context, telemetry);
          window._receiverHardwareTelemetry = telemetry;
          setReceiverPlayoutPreference(telemetry.playbackPreference, "hardware_telemetry");
          emitReceiverTelemetry("📟 Receiver: Hardware telemetry snapshot begin.");
          emitReceiverTelemetry(
            "📟 Receiver Hardware Capabilities: " +
              formatTelemetryValue(summarizeTelemetryValue(telemetry.capabilities)),
          );
          emitReceiverTelemetry(
            "📟 Receiver Device Information: " +
              formatTelemetryValue(summarizeTelemetryValue(telemetry.deviceInformation)),
          );
          emitReceiverTelemetry(
            "📟 Receiver Media Support Matrix: " +
              formatTelemetryValue(summarizeTelemetryValue(telemetry.mediaSupport)),
          );
          emitReceiverTelemetry(
            "📟 Receiver: Hardware telemetry snapshot end; userAgent=" +
              telemetry.host.userAgent +
              " | platform=" +
              telemetry.host.platform +
              " | screen=" +
              telemetry.host.screen +
              " | playbackPreference=" +
              telemetry.playbackPreference,
          );
          return true;
        }

        function logReceiverHardwareTelemetry(context) {
          if (deviceCapabilitiesLogged || !context) {
            return;
          }

          if (emitReceiverHardwareTelemetry(context)) {
            return;
          }

          if (hardwareTelemetryRetryId || hardwareTelemetryRetryCount >= 5) {
            return;
          }

          const retryDelaysMs = [100, 400, 1000, 2000, 4000];
          const delayMs = retryDelaysMs[hardwareTelemetryRetryCount];
          hardwareTelemetryRetryCount += 1;
          hardwareTelemetryRetryId = setTimeout(() => {
            hardwareTelemetryRetryId = null;
            if (!deviceCapabilitiesLogged) {
              if (!emitReceiverHardwareTelemetry(context) && hardwareTelemetryRetryCount >= retryDelaysMs.length) {
                emitReceiverTelemetry("⚠️ Receiver: Hardware telemetry unavailable after startup retries.");
                clearReceiverHardwareTelemetryRetry();
                return;
              }
              if (!deviceCapabilitiesLogged) {
                logReceiverHardwareTelemetry(context);
              }
            }
          }, delayMs);
        }

        function isCastDebugOverlayRequested() {
          return /(?:^|[?&])castDebugOverlay=1(?:&|$)/.test(window.location.search);
        }

        function getCastDebugLogger() {
          if (castDebugLogger) {
            return castDebugLogger;
          }
          if (typeof cast === "undefined" || !cast.debug || !cast.debug.CastDebugLogger) {
            return null;
          }
          try {
            castDebugLogger = cast.debug.CastDebugLogger.getInstance();
            return castDebugLogger;
          } catch (e) {
            return null;
          }
        }

        function writeCastDebug(level, msg) {
          const logger = getCastDebugLogger();
          if (!logger || typeof msg !== "string") {
            return;
          }
          try {
            const fn =
              level === "error" && typeof logger.error === "function"
                ? logger.error
                : level === "warn" && typeof logger.warn === "function"
                  ? logger.warn
                  : level === "info" && typeof logger.info === "function"
                    ? logger.info
                    : logger.debug;
            if (typeof fn === "function") {
              fn.call(logger, CAST_DEBUG_TAG, msg);
            }
          } catch (e) {}
        }

        function configureCastDebugLogger(context) {
          if (castDebugLoggerConfigured || !context) {
            return;
          }
          const logger = getCastDebugLogger();
          if (!logger || !cast.framework) {
            return;
          }
          try {
            if (cast.framework.LoggerLevel) {
              logger.loggerLevelByEvents = {
                "cast.framework.events.category.CORE": cast.framework.LoggerLevel.INFO,
                "cast.framework.events.EventType.MEDIA_STATUS": cast.framework.LoggerLevel.DEBUG,
              };
              logger.loggerLevelByTags = {
                [CAST_DEBUG_TAG]: cast.framework.LoggerLevel.DEBUG,
              };
            }
            if (cast.framework.system && cast.framework.system.EventType && cast.framework.system.EventType.READY) {
              context.addEventListener(cast.framework.system.EventType.READY, function () {
                try {
                  logger.setEnabled(true);
                  if (typeof logger.showDebugLogs === "function") {
                    logger.showDebugLogs(isCastDebugOverlayRequested());
                  }
                  if (isCastDebugOverlayRequested() && typeof logger.clearDebugLogs === "function") {
                    logger.clearDebugLogs();
                  }
                  writeCastDebug("info", "Cast debug logger ready; overlay=" + isCastDebugOverlayRequested());
                  // Hardware probing is deliberately deferred until the
                  // Studio bridge handshake ACK so capability queries cannot
                  // compete with receiver bootstrap on low-power Cast hosts.
                } catch (e) {}
              });
            }
            castDebugLoggerConfigured = true;
          } catch (e) {
            console.warn("⚠️ Receiver: CastDebugLogger setup failed:", e);
          }
        }

        function isReceiverUiStructurallyComplete() {
          const root = document.getElementById("studio-root");
          const grid = document.getElementById("main-grid");
          const sampleGrid = document.getElementById("sample-grid");
          if (!root || !grid || !sampleGrid || sampleGrid.children.length !== 20) {
            return false;
          }
          for (let index = 0; index < 4; index++) {
            const track = document.getElementById("track-" + index);
            if (!track || track.parentNode !== grid) {
              return false;
            }
          }
          return true;
        }

        function revealReceiverUi(reason) {
          if (!document.body || window._receiverUiRevealed) {
            return false;
          }
          if (!isReceiverUiStructurallyComplete()) {
            relayLogToStudio(
              "⚠️ Receiver: Deferred UI reveal because the complete five-column layout is not ready.",
            );
            return false;
          }
          window._receiverUiRevealed = true;
          const root = document.getElementById("studio-root");
          document.body.setAttribute("aria-busy", "false");
          if (root) {
            root.removeAttribute("aria-hidden");
          }
          document.body.classList.remove("app-loading");
          markReceiverBoot("gui_revealed", { reason: reason || "unspecified" });
          relayLogToStudio(
            "✅ Receiver: Receiver UI revealed (app-loading removed" +
              (reason ? " / " + reason : "") +
              ").",
          );
          return true;
        }

        function notifyPlaybackMode(mode, reason, ready = true) {
          if (!mode) {
            return;
          }
          setPcmAudioPriority(mode === "pcm_fallback", reason || "playback_mode");
          const duplicateOnCurrentSocket =
            window._playbackMode === mode &&
            playbackModeLastSent === mode &&
            playbackModeLastSentReady === (ready !== false) &&
            playbackModeLastSentGeneration === playbackModeSocketGeneration;
          const previousMode = window._playbackMode;
          if (previousMode !== mode) {
            resetPcmContinuityForMode(mode, reason || "playback_mode");
          }
          window._playbackMode = mode;
          if (
            !binaryWS ||
            binaryWS.readyState !== WebSocket.OPEN ||
            !window._handshakeAcked
          ) {
            pendingPlaybackMode = { mode: mode, reason: reason || "", ready: ready !== false };
            return;
          }
          if (duplicateOnCurrentSocket) {
            return;
          }
          try {
            const readiness = {
              mode: mode,
              reason: reason || "",
              ready: ready !== false,
              lifecycleGeneration: workletLifecycleGeneration,
            };
            binaryWS.send(JSON.stringify({ type: "PLAYBACK_MODE", ...readiness }));
            binaryWS.send(JSON.stringify({
              type: "PLAYOUT_STATE",
              state: readiness.ready ? "ready" : "selecting",
              ...readiness,
            }));
            playbackModeLastSent = mode;
            playbackModeLastSentReady = ready !== false;
            playbackModeLastSentGeneration = playbackModeSocketGeneration;
          } catch (e) {}
        }

        function notifyPlayoutSelecting(stage, reason) {
          if (
            !binaryWS ||
            binaryWS.readyState !== WebSocket.OPEN ||
            !window._handshakeAcked
          ) {
            pendingPlayoutSelection = {
              stage: stage || "unknown",
              reason: reason || "",
            };
            return;
          }
          try {
            binaryWS.send(JSON.stringify({
              type: "PLAYOUT_STATE",
              state: "selecting",
              stage: stage || "unknown",
              mode: "unknown",
              reason: reason || "",
              ready: false,
              lifecycleGeneration: workletLifecycleGeneration,
            }));
          } catch (e) {}
        }

        function flushPendingPlayoutState() {
          if (
            !window._handshakeAcked ||
            !receiverBridgeConfigReady ||
            !binaryWS ||
            binaryWS.readyState !== WebSocket.OPEN
          ) {
            return;
          }
          const pendingSelection = pendingPlayoutSelection;
          pendingPlayoutSelection = null;
          if (pendingSelection) {
            notifyPlayoutSelecting(pendingSelection.stage, pendingSelection.reason);
          }
          const pendingMode = pendingPlaybackMode;
          pendingPlaybackMode = null;
          if (pendingMode) {
            notifyPlaybackMode(pendingMode.mode, pendingMode.reason, pendingMode.ready);
          }
        }

        function withWorkletTimeout(promise, timeoutMs, stage) {
          return new Promise(function settleWorkletOperation(resolve, reject) {
            let settled = false;
            const timeoutId = setTimeout(function workletOperationTimedOut() {
              if (settled) return;
              settled = true;
              const error = new Error(stage + " timed out after " + timeoutMs + "ms");
              error.name = "AudioWorkletTimeoutError";
              reject(error);
            }, timeoutMs);
            Promise.resolve(promise).then(
              function workletOperationResolved(value) {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                resolve(value);
              },
              function workletOperationRejected(error) {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                reject(error);
              },
            );
          });
        }

        function getWorkletCapabilityBuildKey() {
          const components = window.MXS_BUILD_IDENTITY && window.MXS_BUILD_IDENTITY.components;
          if (!components || !components.receiverLogic || !components.receiverPcmWorklet) {
            return "";
          }
          return components.receiverLogic + ":" + components.receiverPcmWorklet;
        }

        function isReusableHardWorkletFailure(entry) {
          if (!entry || entry.supported !== false) return false;
          const details = [
            entry.stage,
            entry.reason,
            entry.error && entry.error.name,
            entry.error && entry.error.message,
          ].filter(Boolean).join(" ");
          return (
            entry.stage === "production_same_origin_module" &&
            /abort|not.?supported|unavailable/i.test(details)
          );
        }

        function isPcmWorkletKnownUnavailable() {
          return !!(
            workletCapabilityResult &&
            workletCapabilityResult.supported === false
          );
        }

        function readCachedWorkletCapability() {
          const buildKey = getWorkletCapabilityBuildKey();
          if (!buildKey) return null;
          try {
            const parsed = JSON.parse(localStorage.getItem(WORKLET_CAPABILITY_CACHE_KEY) || "null");
            if (
              !parsed ||
              parsed.schema !== 1 ||
              typeof parsed.supported !== "boolean"
            ) {
              return null;
            }
            const sameBuild = parsed.buildKey === buildKey;
            const hardDeviceFailure = isReusableHardWorkletFailure(parsed);
            const compatibleGeneration =
              parsed.capabilityGeneration === WORKLET_CAPABILITY_GENERATION;
            const migratableLegacyHardFailure =
              hardDeviceFailure && !parsed.capabilityGeneration;
            if (
              !sameBuild &&
              !(hardDeviceFailure && (compatibleGeneration || migratableLegacyHardFailure))
            ) {
              return null;
            }
            if (migratableLegacyHardFailure || (!sameBuild && compatibleGeneration)) {
              parsed.buildKey = buildKey;
              parsed.capabilityGeneration = WORKLET_CAPABILITY_GENERATION;
              parsed.migratedAcrossBuildAt = Date.now();
              localStorage.setItem(WORKLET_CAPABILITY_CACHE_KEY, JSON.stringify(parsed));
            }
            return {
              supported: parsed.supported,
              stage: parsed.stage || "cached_per_build",
              reason: parsed.reason || "cached_result",
              error: parsed.error || undefined,
              cached: true,
              cachedAt: parsed.cachedAt || null,
              buildKey: buildKey,
              cacheScope: sameBuild ? "build" : "device_compatibility_generation",
              capabilityGeneration: WORKLET_CAPABILITY_GENERATION,
            };
          } catch (e) {
            return null;
          }
        }

        function cacheWorkletCapability(result) {
          const buildKey = getWorkletCapabilityBuildKey();
          if (!buildKey || !result || typeof result.supported !== "boolean" || result.cached) {
            return;
          }
          try {
            localStorage.setItem(WORKLET_CAPABILITY_CACHE_KEY, JSON.stringify({
              schema: 1,
              buildKey: buildKey,
              capabilityGeneration: WORKLET_CAPABILITY_GENERATION,
              supported: result.supported,
              stage: result.stage || "unknown",
              reason: result.reason || "unknown",
              error: result.error || null,
              cachedAt: Date.now(),
            }));
          } catch (e) {}
        }

        function reportWorkletCapability(result) {
          workletCapabilityResult = result;
          window._workletCapabilityResult = result;
          cacheWorkletCapability(result);
          emitReceiverTelemetry("AUDIO_WORKLET_CAPABILITY " + JSON.stringify(result));
          if (binaryWS && binaryWS.readyState === WebSocket.OPEN && window._handshakeAcked) {
            try {
              binaryWS.send(JSON.stringify({
                type: "AUDIO_PATH_CAPABILITY",
                pcm: { ...result },
                selectedPath: result.supported ? "pcm_v2" : "native_caf",
                authoritative: true,
              }));
            } catch (e) {}
          }
          return result;
        }

        function describeWorkletError(error) {
          return {
            name: error && error.name ? String(error.name) : "Error",
            message: error && error.message ? String(error.message) : String(error || "unknown"),
            code: error && error.code !== undefined ? String(error.code) : "",
          };
        }

        function probeAudioWorkletCapability(context) {
          if (workletCapabilityContext === context && workletCapabilityPromise) {
            return workletCapabilityPromise;
          }
          workletCapabilityContext = context;
          workletCapabilityResult = null;
          const cachedCapability = readCachedWorkletCapability();
          if (cachedCapability) {
            workletCapabilityPromise = Promise.resolve(
              reportWorkletCapability(cachedCapability),
            );
            return workletCapabilityPromise;
          }
          // Cobalt rejects query parameters on AudioWorklet.addModule(). The
          // probe is intentionally tiny and immutable; use its plain
          // same-origin path and keep the capability result keyed by the
          // receiver build/generation in localStorage instead of URL-busting
          // the AudioWorklet request.
          const probeUrl = new URL(
            "pcm-capability-probe.js",
            window.location.href,
          ).href;
          workletCapabilityPromise = (async function runCapabilityProbe() {
            if (!context || !context.audioWorklet || typeof context.audioWorklet.addModule !== "function") {
              return reportWorkletCapability({
                supported: false,
                stage: "api",
                reason: "audio_worklet_api_unavailable",
                url: probeUrl,
              });
            }
            const startedAt = Date.now();
            try {
              notifyPlayoutSelecting("capability_probe", "minimal_same_origin_module");
              await withWorkletTimeout(
                context.audioWorklet.addModule(probeUrl),
                WORKLET_CAPABILITY_TIMEOUT_MS,
                "AudioWorklet capability probe",
              );
              return reportWorkletCapability({
                supported: true,
                stage: "minimal_same_origin_module",
                reason: "probe_loaded",
                elapsedMs: Date.now() - startedAt,
                url: probeUrl,
              });
            } catch (error) {
              return reportWorkletCapability({
                supported: false,
                stage: "minimal_same_origin_module",
                reason: "probe_rejected",
                elapsedMs: Date.now() - startedAt,
                error: describeWorkletError(error),
                url: probeUrl,
              });
            }
          })();
          return workletCapabilityPromise;
        }

        function isPlaybackActiveState(state) {
          if (!state || typeof state !== "object") {
            return false;
          }
          const tracks = Array.isArray(state.tracks) ? state.tracks : [];
          const trackActive = tracks.some(function (track) {
            return !!(track && (track.isPlaying || track.isRecording));
          });
          const masterActive = !!(state.master && state.master.isRecording);
          const sampler = Array.isArray(state.sampler) ? state.sampler : [];
          const samplerActive = sampler.some(function (pad) {
            return !!(pad && pad.active);
          });
          return trackActive || masterActive || samplerActive;
        }

        function isPcmStartupAbortError(error) {
          const errorText = String(
            error
              ? [error.name, error.message, error.code].filter(Boolean).join(" ")
              : "",
          );
          return /abort|aborted|user aborted/i.test(errorText);
        }

        function shouldFastFallbackPcmStartup(error, preserveNativeMode) {
          if (preserveNativeMode || window._receiverShutdownInProgress) {
            return false;
          }
          if (!isPcmStartupAbortError(error)) {
            return false;
          }
          if (window._pcmDegraded || receiverPlayoutPreference !== "pcm_fallback") {
            return false;
          }
          // Set retry count to max so the catch block immediately falls back to native
          lowLatencyStartupRetryCount = PCM_STARTUP_MAX_RETRIES_BEFORE_NATIVE;
          window._pcmDegraded = true;
          try {
            localStorage.setItem("mxs_pcm_degraded", "true");
          } catch (e) {}
          return !nativeStreamActive && !nativeStreamStarting;
        }

        function maybeStartLowLatencyPlayout(reason) {
          if (!identityAllowsAudio()) return false;
          if (window._receiverShutdownInProgress) {
            return false;
          }
          if (!lastPlaybackStartSignalAt) {
            relayLogToStudio(
              "⏸️ Receiver: PCM startup is armed but waiting for PLAYBACK_START.",
            );
            return false;
          }
          if (window._pcmDegraded) {
            return false;
          }
          if (receiverPlayoutPreference !== "pcm_fallback") {
            return false;
          }
          if (nativeStreamActive) {
            return true;
          }
          if (audioInitializing || workletInitPromise) {
            // An active addModule()/AudioWorklet initialization owns startup.
            // Do not promote to native while that promise is still resolving.
            armLowLatencyStartupWatchdog();
            return true;
          }
          if (workletNode && workletReady) {
            // PCM v2 is the live path: advertise readiness at the ordered Play
            // boundary so the sender can release frames without waiting for a
            // redundant native-mode transition.
            notifyPlaybackMode("pcm_fallback", "playback_start_pcm_ready");
            return true;
          }
          if (!configReceived || !currentBridgeIp) {
            return false;
          }
          if (!binaryWS || binaryWS.readyState !== WebSocket.OPEN || !window._handshakeAcked) {
            return false;
          }
          const preserveNativeMode = nativeStreamStarting || window._playbackMode === "native";
          const initPromise = initAudio(false, preserveNativeMode);
          if (!initPromise) {
            return false;
          }
          if (reason) {
            relayLogToStudio(
              "▶️ Receiver: Starting PCM worklet on " +
                reason +
                (preserveNativeMode ? " (native boot bridge)." : "."),
            );
          }
          initPromise.catch((e) => {
            relayLogToStudio("⚠️ Receiver: initAudio failed: " + (e && e.message ? e.message : e));
          });
          armLowLatencyStartupWatchdog();
          return true;
        }

        function preloadPcmWorklet(reason) {
          if (!identityAllowsAudio()) return false;
          if (window._receiverShutdownInProgress) {
            return false;
          }
          if (window._pcmDegraded || receiverPlayoutPreference !== "pcm_fallback") {
            return false;
          }
          if (!configReceived || !currentBridgeIp) {
            return false;
          }
          if (!binaryWS || binaryWS.readyState !== WebSocket.OPEN || !window._handshakeAcked) {
            return false;
          }
          const cachedCapability = readCachedWorkletCapability();
          if (cachedCapability && !cachedCapability.supported) {
            reportWorkletCapability(cachedCapability);
            relayLogToStudio(
              "⚡ Receiver: AudioWorklet hard-failure cache selects native before playback (" +
                (cachedCapability.cacheScope || "build") + ").",
            );
            return degradePcmStartupToNative("audio_worklet_capability_cached_unavailable");
          }
          if (workletNode || workletInitPromise || audioInitializing) {
            return true;
          }
          // Native CAF owns the receiver while its prewarm attempt is in
          // flight. Keep PCM as a cold fallback; initializing the full
          // AudioContext/worklet here would otherwise publish pcm_fallback
          // before native readiness is known.
          if (nativeStreamActive || nativeStreamStarting) {
            return false;
          }
          const initPromise = initAudio(false, false);
          if (!initPromise) {
            return false;
          }
          relayLogToStudio(
            "⏱️ Receiver: Preloading PCM worklet before playback (" +
              (reason || "handshake") +
              ").",
          );
          initPromise.catch((e) => {
            relayLogToStudio("⚠️ Receiver: PCM preload failed: " + (e && e.message ? e.message : e));
          });
          return true;
        }

        function maybeStartNativeStream(reason, allowPriming = false, allowPcmCompanion = false) {
          if (!identityAllowsAudio()) return false;
          if (window._receiverShutdownInProgress) {
            return false;
          }
          if (!lastPlaybackStartSignalAt && !allowPriming) {
            relayLogToStudio(
              "⏸️ Receiver: Native fallback is armed but waiting for PLAYBACK_START.",
            );
            return false;
          }
          if (
            receiverPlayoutPreference === "pcm_fallback" &&
            !window._pcmDegraded &&
            !allowPcmCompanion
          ) {
            return false;
          }
          if (nativeStreamActive || nativeStreamStarting) {
            return true;
          }
          if (!configReceived || !currentBridgeIp) {
            return false;
          }
          if (!allowPcmCompanion && (workletNode || audioInitializing || window._binaryActive)) {
            resetBinaryPlayoutState("native_takeover");
          }
          if (reason) {
            relayLogToStudio(
              (allowPriming ? "⏱️ Receiver: Priming" : "▶️ Receiver: Starting") +
                " native stream on " + reason + ".",
            );
          }
          setActiveAudioPathOwner("native_caf_starting", reason || "native_stream_starting");
          setPcmAudioPriority(false, reason || "native_stream_starting");
          // A native attempt is an ownership decision, even while CAF is
          // still buffering. This gates sender/backend PCM admission until
          // native either becomes ready or explicitly fails.
          notifyPlaybackMode(
            "native",
            reason || "native_stream_starting",
            false,
          );
          const shouldPrewarm = allowPriming && (!lastPlaybackStartSignalAt || allowPcmCompanion);
          if (shouldPrewarm) {
            nativeStreamPrewarmBeforePlayback = true;
            nativeStreamPrewarmReady = false;
            nativeStreamCompanionForPcm = allowPcmCompanion;
          }
          const started = startNativeStreamPlayout(
            currentBridgeIp,
            currentBridgePort,
            allowPcmCompanion,
          );
          if (!started) {
            setActiveAudioPathOwner("none", reason || "native_stream_start_failed");
            if (shouldPrewarm) {
              nativeStreamPrewarmBeforePlayback = false;
              nativeStreamPrewarmReady = false;
              nativeStreamCompanionForPcm = false;
            }
          }
          return started;
        }

        function prepareNativePcmHandoff(reason) {
          if (
            nativeStreamActive ||
            nativeStreamStarting ||
            window._receiverShutdownInProgress ||
            window._pcmDegraded
          ) {
            return nativeStreamActive || nativeStreamStarting;
          }
          return maybeStartNativeStream(reason || "pcm_handoff_prepare", true, true);
        }

        function markPlaybackStartSignal() {
          lastPcmQueueResetAt = 0;
          // Give each ordered Play one guarded native recovery attempt. A
          // second failure must settle instead of creating a restart loop.
          nativeFailureRetryAttempted = false;
          playbackRecoveryRetryAttempted = false;
          // Every ordered PLAYBACK_START reopens the short stale-inactive-state
          // grace window. This matters for rapid stop/play and reconnect replay.
          lastPlaybackStartSignalAt = Date.now();
          logReceiverStartupTiming("playback_start_signal", {
            nativeAttemptId: nativeStartupAttemptId,
            nativeStreamStarting,
            nativeStreamActive,
            prewarmBeforePlayback: nativeStreamPrewarmBeforePlayback,
          });
        }

        function clearPlaybackRecoveryRetry() {
          if (playbackRecoveryRetryTimer) {
            clearTimeout(playbackRecoveryRetryTimer);
            playbackRecoveryRetryTimer = null;
          }
        }

        function schedulePlaybackRecoveryRetry() {
          clearPlaybackRecoveryRetry();
          if (playbackRecoveryRetryAttempted || !lastPlaybackStartSignalAt) return;
          playbackRecoveryRetryTimer = setTimeout(() => {
            playbackRecoveryRetryTimer = null;
            if (
              playbackRecoveryRetryAttempted ||
              playbackPaused ||
              !lastPlaybackStartSignalAt ||
              nativeStreamActive ||
              !(nativeStreamStarting || window._playbackMode === "native") ||
              !binaryWS ||
              binaryWS.readyState !== WebSocket.OPEN
            ) {
              return;
            }
            playbackRecoveryRetryAttempted = true;
            // The sender's replay has the same epoch/revision. Re-arm the
            // receiver's one-shot reconnect allowance so a lost first replay
            // cannot strand CAF in pre-Play silence indefinitely.
            resetPlaybackRevisionGate("native_recovery_retry");
            try {
              binaryWS.send(JSON.stringify({
                type: "RECEIVER_READY",
                reason: "native_recovery_retry",
              }));
              relayLogToStudio(
                "🔁 Receiver: Native Play recovery retry requested after bounded startup silence.",
              );
            } catch (e) {}
          }, 3000);
        }

        function noteOrderedPlaybackAction(action) {
          lastOrderedPlaybackAction = action || "";
          lastOrderedPlaybackAt = Date.now();
        }

        function shouldIgnorePlayerManagerCommand(command) {
          if (!lastOrderedPlaybackAt || !lastOrderedPlaybackAction) {
            return false;
          }
          const ageMs = Date.now() - lastOrderedPlaybackAt;
          if (ageMs < 0 || ageMs > PLAYER_MANAGER_ORDER_GUARD_MS) {
            return false;
          }
          return true;
        }

        function resetPlaybackRevisionGate(reason) {
          // Keep the last command as the replay anchor. A bridge reconnect
          // needs to accept that exact command once, but must continue to
          // reject delayed commands from before it.
          allowSamePlaybackRevisionReplay = lastPlaybackEpoch >= 0;
          lastGuiRevision = -1;
          if (reason) {
            writeCastDebug("debug", "Playback revision gate reset (" + reason + ").");
          }
        }

        function isRevisionOlder(epoch, revision, previousEpoch, previousRevision) {
          return (
            previousEpoch >= 0 &&
            (epoch < previousEpoch ||
              (epoch === previousEpoch && revision < previousRevision))
          );
        }

        function acceptPlaybackRevision(message, source) {
          const epoch = Number(message && message.playbackEpoch);
          const revision = Number(message && message.playbackRevision);
          if (!Number.isSafeInteger(epoch) || epoch < 0 || !Number.isSafeInteger(revision) || revision < 0) {
            // Preserve compatibility with older signaling frames while all
            // current sender frames carry an ordered epoch/revision pair.
            return true;
          }
          const previousEpoch = lastPlaybackEpoch;
          const previousRevision = lastPlaybackRevision;
          if (isRevisionOlder(epoch, revision, previousEpoch, previousRevision)) {
            relayLogToStudio(
              "⏭️ Receiver: Ignored stale " +
                (source || "playback") +
                " command epoch=" +
                epoch +
                " revision=" +
                revision +
                "; applied epoch=" +
                previousEpoch +
                " revision=" +
                previousRevision +
                ".",
            );
            return false;
          }
          // All current callers are ordered playback commands. Do not depend
          // on an undeclared state-update flag here: a runtime ReferenceError
          // would drop PLAY, PAUSE, and STOP messages before they reach audio.
          if (epoch === lastPlaybackEpoch && revision === lastPlaybackRevision) {
            if (allowSamePlaybackRevisionReplay) {
              allowSamePlaybackRevisionReplay = false;
              relayLogToStudio(
                "🔁 Receiver: Accepted same-revision playback replay after bridge reconnect " +
                  "epoch=" + epoch + " revision=" + revision + ".",
              );
              return true;
            }
            relayLogToStudio(
              "⏭️ Receiver: Ignored duplicate " +
                (source || "playback") +
                " command epoch=" + epoch +
                " revision=" + revision + ".",
            );
            return false;
          }
          lastPlaybackEpoch = epoch;
          lastPlaybackRevision = revision;
          allowSamePlaybackRevisionReplay = false;
          return true;
        }

        function acceptGuiRevision(message) {
          const revision = Number(message && message.guiRevision);
          if (!Number.isSafeInteger(revision) || revision < 0) {
            return true;
          }
          if (revision <= lastGuiRevision) {
            return false;
          }
          lastGuiRevision = revision;
          return true;
        }

        function resetGuiRevisionGate(reason) {
          lastGuiRevision = -1;
          lastCursorRevision = -1;
          lastDialogMirrorState = "";
          if (reason) {
            writeCastDebug("debug", "GUI revision gate reset (" + reason + ").");
          }
        }

        function isReceiverInteractiveControl(element) {
          if (!element) return false;
          if (
            element.dataset.dialogId &&
            (element.dataset.controlIndex !== undefined ||
              element.dataset.actionIndex !== undefined ||
              element.dataset.actionId)
          ) return true;
          if (!element.id) return false;
          return /^(t-(rec|stop|play|rev|slice)-\d+|t-(pitch|vol|pan|treble|mid_freq|mid_gain|bass|gain|ls|le)-sl-\d+|t-input-\d+|t-effect-select-\d+|t-fx-(left|right)-\d+|t-fx-chk-\d+-\d+|t-lfo[12]-chk-\d+-(pitch|vol|pan|treble|mid_freq|mid_gain|bass)|master-record-button|lfo-toggle|lfo2-toggle|master-volume|loop-length|lfo-time|lfo2-time|record-as-select|import-files-button|show-docs-button|sample-station-button|settings-button|sample-\d+)$/.test(element.id);
        }

        function sendGuiInteraction(element, kind) {
          if (!isReceiverInteractiveControl(element)) return;
          if (!binaryWS || binaryWS.readyState !== WebSocket.OPEN) return;
          guiInteractionRevision += 1;
          const message = {
            type: "GUI_INTERACTION_EVENT",
            transport: "gui",
            guiProtocolVersion: CAST_GUI_PROTOCOL_VERSION,
            guiInteractionRevision,
            kind,
            targetId: element.id,
            dialogId: element.dataset.dialogId || undefined,
            controlIndex: element.dataset.controlIndex === undefined ? undefined : Number(element.dataset.controlIndex),
            actionIndex: element.dataset.actionIndex === undefined ? undefined : Number(element.dataset.actionIndex),
            actionId: element.dataset.actionId || undefined,
            value: element.type === "checkbox" ? undefined : element.value,
            checked: element.type === "checkbox" ? element.checked : undefined,
          };
          try {
            binaryWS.send(JSON.stringify(message));
            relayLogToStudio("📡 Receiver: GUI interaction sent → " + element.id + " (" + kind + ")");
          } catch (e) {}
        }

        function bindReceiverGuiInteractions() {
          document.addEventListener("click", (event) => {
            const target = event.target && event.target.closest ? event.target.closest("button") : null;
            if (target) sendGuiInteraction(target, "click");
          });
          document.addEventListener("dblclick", (event) => {
            const target = event.target && event.target.closest ? event.target.closest("button") : null;
            if (target && /^sample-\d+$/.test(target.id)) sendGuiInteraction(target, "settings");
          });
          document.addEventListener("input", (event) => {
            const target = event.target;
            if (target && (target.matches("input[type=range], input[type=checkbox]") || target.tagName === "SELECT")) {
              const output = target.parentElement?.querySelector(".gui-dialog-mirror-value");
              if (output) output.textContent = target.value;
              sendGuiInteraction(target, "input");
            }
          });
          document.addEventListener("change", (event) => {
            const target = event.target;
            if (target && target.tagName === "SELECT") sendGuiInteraction(target, "change");
          });
        }

        function acknowledgePlaybackRevision(message, action) {
          if (!binaryWS || binaryWS.readyState !== WebSocket.OPEN) {
            return;
          }
          const ackAction = action || "applied";
          const messageEpoch = Number(message && message.playbackEpoch);
          const messageRevision = Number(message && message.playbackRevision);
          const playbackEpoch = Number.isSafeInteger(messageEpoch)
            ? messageEpoch
            : lastPlaybackEpoch;
          const playbackRevision = Number.isSafeInteger(messageRevision)
            ? messageRevision
            : lastPlaybackRevision;
          // GUI snapshots do not use playback ACKs. Only playback commands
          // reach this function, keeping ACK traffic off the GUI path.
          try {
            binaryWS.send(
              JSON.stringify({
                type: "PLAYBACK_COMMAND_ACK",
                action: ackAction,
                playbackEpoch,
                playbackRevision,
              }),
            );
          } catch (e) {}
        }

        function startNativeLatencyMonitor() {
          if (window._nativeLatencyIntervalId) {
            clearInterval(window._nativeLatencyIntervalId);
          }
          window._nativeLatencyIntervalId = setInterval(() => {
            if (!nativeStreamActive && window._playbackMode !== "native") {
              return;
            }
            const htmlAudio = document.getElementById("native-stream-audio");
            const cafAudio = document.getElementById("cast-media-element");
            let activeAudio = null;
            if (htmlAudio && htmlAudio.src && !htmlAudio.paused) {
              activeAudio = htmlAudio;
            } else if (cafAudio && !cafAudio.paused) {
              activeAudio = cafAudio;
            }

            if (!activeAudio) {
              return;
            }

            if (activeAudio.playbackRate !== 1.0) {
              activeAudio.playbackRate = 1.0;
            }

            if (activeAudio.readyState < 3 || activeAudio.buffered.length === 0) {
              return;
            }

            const liveEdge = activeAudio.buffered.end(activeAudio.buffered.length - 1);
            const playhead = activeAudio.currentTime;
            // Report the observed transport buffer only. Seeking the live media
            // element to chase a moving latency target creates an audible jump,
            // breaks source-frame continuity, and makes the sender's local delay
            // chase the receiver. Native playback remains at playbackRate 1.0;
            // the sender applies only bounded, stable alignment updates.
            let latency = liveEdge - playhead;

            // This is telemetry only. The one permitted startup trim is made
            // at the ordered Play boundary while the prewarm output is muted;
            // never seek here during audible playback.
            const reportedLiveEdge = activeAudio.buffered.end(activeAudio.buffered.length - 1);
            const reportedPlayhead = activeAudio.currentTime;
            const reportedBufferedStart = activeAudio.buffered.start(activeAudio.buffered.length - 1);
            const reportedBufferedDuration = Math.max(
              0,
              reportedLiveEdge - reportedBufferedStart,
            );

            if (binaryWS && binaryWS.readyState === WebSocket.OPEN) {
              binaryWS.send(
                JSON.stringify({
                  type: "NATIVE_LATENCY_REPORT",
                  latency: latency,
                  syncComponents: {
                    source: "native_media_buffer",
                    pathOwner: nativeStreamActive ? "native_caf" : "native_starting",
                    playbackMode: window._playbackMode || "unknown",
                    liveEdgeSeconds: reportedLiveEdge,
                    playheadSeconds: reportedPlayhead,
                    bufferedStartSeconds: reportedBufferedStart,
                    bufferedEndSeconds: reportedLiveEdge,
                    bufferedDurationSeconds: reportedBufferedDuration,
                    mediaReadyState: activeAudio.readyState,
                    mediaNetworkState: activeAudio.networkState,
                    startupAttemptId: nativeStartupAttemptId,
                  },
                }),
              );
            }
          }, 500);
        }

        function clearPlaybackStartSignal() {
          lastPlaybackStartSignalAt = 0;
        }

        function releasePendingNativeStartupTrim() {
          if (!nativeStartupTrimPending || !lastPlaybackStartSignalAt) {
            return false;
          }
          const activeAudio = [
            document.getElementById("cast-media-element"),
            document.getElementById("native-stream-audio"),
          ].find(function findPreparedNativeElement(element) {
            return !!(
              element &&
              !element.paused &&
              element.readyState >= 3 &&
              element.buffered &&
              element.buffered.length > 0
            );
          });
          if (!activeAudio) {
            return false;
          }
          // A startup trim is safe only before the prewarm is released. Do
          // not turn a late/failed preparation into an audible live seek.
          const mutedForPrewarm = activeAudio._mxsPrewarmMuted === true ||
            activeAudio.muted === true || Number(activeAudio.volume) <= 0.001;
          nativeStartupTrimPending = false;
          if (!mutedForPrewarm) {
            relayLogToStudio("⏭️ Receiver: Skipped native startup trim because output was already audible.");
            return false;
          }
          try {
            const liveEdge = activeAudio.buffered.end(activeAudio.buffered.length - 1);
            const playhead = activeAudio.currentTime;
            const latency = liveEdge - playhead;
            if (latency <= NATIVE_STARTUP_TRIM_THRESHOLD_SEC) {
              return false;
            }
            const bufferedStart = activeAudio.buffered.start(activeAudio.buffered.length - 1);
            const trimTarget = Math.max(bufferedStart, liveEdge - NATIVE_STARTUP_TARGET_SEC);
            if (trimTarget <= playhead + 0.25) {
              return false;
            }
            activeAudio.currentTime = trimTarget;
            const trimmedLatency = Math.max(0, liveEdge - trimTarget);
            relayLogToStudio(
              "✂️ Receiver: Ordered PLAYBACK_START released native buffer at " +
                trimmedLatency.toFixed(3) +
                "s from live edge before unmute.",
            );
            logReceiverStartupTiming("native_startup_trim_at_play", {
              nativeAttemptId: nativeStartupAttemptId,
              latencyBeforeSec: latency,
              latencyAfterSec: trimmedLatency,
            });
            return true;
          } catch (trimError) {
            relayLogToStudio(
              "⚠️ Receiver: Ordered native startup trim failed: " +
                (trimError && trimError.message ? trimError.message : trimError),
            );
            return false;
          }
        }

        function shouldIgnoreStaleInactiveState() {
          if (!lastPlaybackStartSignalAt) {
            return false;
          }
          if (Date.now() - lastPlaybackStartSignalAt > PLAYBACK_START_GRACE_MS) {
            return false;
          }
          return (
            nativeStreamActive ||
            nativeStreamStarting ||
            window._binaryActive ||
            pendingBinaryFrames.length > 0 ||
            audioInitializing ||
            !!workletNode
          );
        }

        function requestNativeMediaElementPlay(reason) {
          let requested = false;
          [
            document.getElementById("cast-media-element"),
            document.getElementById("native-stream-audio"),
          ].forEach(function requestElementPlay(element) {
            if (!element || typeof element.play !== "function" || element.paused !== true) {
              return;
            }
            if (element.id === "native-stream-audio" && !element.src) {
              return;
            }
            requested = true;
            try {
              const playPromise = element.play();
              logReceiverStartupTiming("caf_play_requested_at_play", {
                nativeAttemptId: nativeStartupAttemptId,
                reason: reason || "playback_start",
                mediaElementId: element.id || "unknown",
                readyState: element.readyState,
              });
              relayLogToStudio(
                "▶️ Receiver: Native media element play requested at PLAYBACK_START (" +
                  (reason || "playback_start") + ").",
              );
              if (playPromise && typeof playPromise.catch === "function") {
                playPromise.catch(function (error) {
                  relayLogToStudio(
                    "⚠️ Receiver: Native media element play request rejected: " +
                      (error && error.message ? error.message : error),
                  );
                });
              }
            } catch (error) {
              relayLogToStudio(
                "⚠️ Receiver: Native media element play request failed: " +
                  (error && error.message ? error.message : error),
              );
            }
          });
          return requested;
        }

        function requestNativePlaybackStart(reason) {
          if (!identityAllowsAudio()) return false;
          if (playbackPaused) return true;
          if (!lastPlaybackStartSignalAt) {
            relayLogToStudio(
              "⏸️ Receiver: Ignored playout start without PLAYBACK_START.",
            );
            return false;
          }
          if (
            reason === "bridge_config" &&
            !nativeStreamActive &&
            !nativeStreamStarting
          ) {
            resetBinaryPlayoutState("native_takeover");
          }
          if (nativeStreamActive) {
            if (nativeStreamPaused) {
              resumeNativeStreamPlayout(reason || "playback_start");
            }
            return true;
          }
          if (nativeStreamStarting) {
            // Idle pre-prime intentionally has no destructive watchdog. Arm
            // the full timeout budget only after ordered playback is active.
            if (nativeStreamPrewarmReady) {
              activateNativeStream(
                "caf_preplay_ready",
                "✅ Receiver: Bounded native CAF prewarm released at PLAYBACK_START.",
                nativeStartupAttemptId,
              );
              return true;
            }
            if (nativeStreamPrewarmBeforePlayback) {
              // Keep the prewarm output muted until the media element reports
              // PLAYING. CAF can accept LOAD/play before its decoder has
              // produced live audio; unmuting at the ordered Play boundary
              // exposes that decoder throat-clearing interval.
              nativeStreamCompanionForPcm = false;
              requestNativeMediaElementPlay(reason || "playback_start");
              logReceiverStartupTiming("native_prewarm_play_requested_waiting", {
                nativeAttemptId: nativeStartupAttemptId,
                prewarmReady: nativeStreamPrewarmReady,
                playbackRequested: true,
              });
              relayLogToStudio(
                "⏳ Receiver: Native prewarm remains muted at PLAYBACK_START; awaiting native PLAYING confirmation.",
              );
            }
            if (!nativeStartupWatchdogId) {
              armNativeStartupWatchdog();
            }
            return true;
          }
          if (receiverPlayoutPreference === "pcm_fallback" && !window._pcmDegraded) {
            if (maybeStartLowLatencyPlayout(reason)) {
              return true;
            }
            // If the WebSocket is connecting or handshaking, wait for the socket
            // connection and handshake ACK handlers to trigger it, rather than falling back to native stream immediately.
            if (binaryWS && (binaryWS.readyState === WebSocket.CONNECTING || (binaryWS.readyState === WebSocket.OPEN && !window._handshakeAcked))) {
              return true;
            }
            // PCM fallback is the low-latency live path. If startup is throttled,
            // retrying, or waiting on an AudioWorklet callback, do not let routine
            // STATE_UPDATE traffic promote the receiver back to native /stream.wav.
            relayLogToStudio("⏳ Receiver: PCM fallback preferred; native stream start suppressed (" + reason + ").");
            return true;
          }
          if (maybeStartNativeStream(reason)) {
            return true;
          }
          return false;
        }

        function configureCafPlaybackHandlers() {
          if (cafLoadInterceptorConfigured) {
            return;
          }
          const pm = getCastPlayerManager();
          if (!pm || !cast.framework.messages) {
            return;
          }
          const messageType = cast.framework.messages.MessageType;

          // Give CAF the exact media element that owns the native stream. The
          // PlayerManager API exposes setMediaElement(), but not the
          // getMediaElement() probe this receiver used previously. Explicitly
          // binding the element keeps CAF load/play/pause state on the same
          // element that the native latency monitor observes.
          const cafMediaElement = document.getElementById("cast-media-element");
          if (cafMediaElement && typeof pm.setMediaElement === "function") {
            try {
              cafMediaElement.crossOrigin = "anonymous";
              pm.setMediaElement(cafMediaElement);
              cafMediaElement._mxsCafMediaElementBound = true;
              relayLogToStudio("✅ Receiver: CAF PlayerManager bound to #cast-media-element.");
            } catch (e) {
              relayLogToStudio("⚠️ Receiver: CAF setMediaElement failed: " + e.message);
            }
          }

          // Publish only controls implemented by this receiver. PLAY and STOP
          // are mandatory request types; PAUSE/volume are the corresponding
          // MediaStatus command bits. SEEK is intentionally omitted because
          // the PCM/native live bridge has no seekable media timeline.
          const command = cast.framework.messages.Command || {};
          const supportedCommands =
            (Number(command.PAUSE) || 0) |
            (Number(command.STREAM_VOLUME) || 0) |
            (Number(command.STREAM_MUTE) || 0);
          if (supportedCommands && typeof pm.setSupportedMediaCommands === "function") {
            try {
              pm.setSupportedMediaCommands(supportedCommands, true);
              relayLogToStudio("✅ Receiver: CAF supported media commands set to PAUSE/VOLUME/MUTE.");
            } catch (e) {
              relayLogToStudio("⚠️ Receiver: CAF supported-command setup failed: " + e.message);
            }
          }

          if (typeof pm.setMediaUrlResolver === "function") {
            pm.setMediaUrlResolver(function (request) {
              const media = request && request.media ? request.media : null;
              const streamUrl =
                media && media.customData && typeof media.customData.streamUrl === "string"
                  ? media.customData.streamUrl
                  : media && typeof media.contentUrl === "string" && media.contentUrl
                    ? media.contentUrl
                  : "";
              if (streamUrl) {
                return streamUrl;
              }
              if (media && typeof media.contentUrl === "string" && media.contentUrl) {
                return media.contentUrl;
              }
              return media && typeof media.contentId === "string" ? media.contentId : null;
            });
          }

          if (typeof pm.setMediaPlaybackInfoHandler === "function") {
            pm.setMediaPlaybackInfoHandler(function (loadRequest, defaultPlaybackConfig) {
              const media = loadRequest && loadRequest.media ? loadRequest.media : null;
              const isNativeStream =
                !!media &&
                ((typeof media.contentId === "string" && media.contentId.indexOf("mxs-native-stream") === 0) ||
                  (media.customData && media.customData.source === "mxs004-native-stream"));
              if (!isNativeStream) {
                return defaultPlaybackConfig;
              }
              const playbackConfig =
                defaultPlaybackConfig || new cast.framework.PlaybackConfig();
              playbackConfig.autoPauseDuration = 0;
              playbackConfig.autoResumeDuration = 0;
              return playbackConfig;
            });
          }

          if (typeof pm.setMessageInterceptor === "function" && messageType && messageType.LOAD) {
            pm.setMessageInterceptor(messageType.LOAD, function (request) {
              writeCastDebug("info", "Intercepting LOAD request");
              if (!request || !request.media) {
                const error = new cast.framework.messages.ErrorData(
                  cast.framework.messages.ErrorType.LOAD_FAILED,
                );
                error.reason = cast.framework.messages.ErrorReason.INVALID_REQUEST;
                writeCastDebug("error", "Rejected malformed LOAD request with no media payload.");
                return error;
              }
              if (typeof request.media.contentId === "string" && request.media.contentId.indexOf("mxs-native-stream") === 0) {
                const streamUrl =
                  (request.media.customData && request.media.customData.streamUrl) ||
                  request.media.contentUrl;
                if (!streamUrl) {
                  const error = new cast.framework.messages.ErrorData(
                    cast.framework.messages.ErrorType.LOAD_FAILED,
                  );
                  error.reason = cast.framework.messages.ErrorReason.INVALID_REQUEST;
                  writeCastDebug("error", "Rejected mxs-native-stream LOAD request with no streamUrl.");
                  return error;
                }
                request.media.contentType = "audio/wav";
                request.media.streamType = cast.framework.messages.StreamType.LIVE;
                request.media.duration = null;
                request.media.contentUrl = streamUrl;
                if (!request.media.customData) {
                  request.media.customData = {};
                }
                request.media.customData.streamUrl = streamUrl;
                writeCastDebug("warn", "Mapped mxs-native-stream LOAD to " + streamUrl);
              } else {
                const contentId = request && request.media ? request.media.contentId : "unknown";
                writeCastDebug("debug", "Passing through LOAD request contentId=" + contentId);
              }
              return request;
            });

            // Standard Cast transport controls must use the same lifecycle as
            // the MXS custom channel. Let CAF finish its normal request first,
            // then reconcile the MXS path on the next task: PAUSE keeps the
            // active playout path warm, while an external PlayerManager STOP
            // remains destructive. Ordered MXS STOP retains a muted native
            // prewarm for the next replay.
            const deferPlayerManagerCommand = function (command, request) {
              const commandAttemptId = nativeStartupAttemptId;
              setTimeout(function () {
                if (window._receiverShutdownInProgress) {
                  return;
                }
                const internalStopRequest =
                  command === "STOP" &&
                  Number(request && request.requestId) === 0;
                const staleStopRequest =
                  command === "STOP" &&
                  commandAttemptId !== nativeStartupAttemptId;
                const armedStopAttemptId = suppressedPlayerManagerStopAttemptId;
                const armedStopSuppression =
                  command === "STOP" &&
                  consumePlayerManagerStopSuppression(request);
                if (internalStopRequest || staleStopRequest || armedStopSuppression) {
                  relayLogToStudio(
                    "⏭️ Receiver: Suppressed internal/stale PlayerManager STOP " +
                      "(requestId=" +
                      (request && request.requestId !== undefined ? request.requestId : "n/a") +
                      ", commandAttempt=" + commandAttemptId +
                      ", armedAttempt=" + armedStopAttemptId +
                      ", currentAttempt=" + nativeStartupAttemptId + ").",
                  );
                  return;
                }
                if (shouldIgnorePlayerManagerCommand(command)) {
                  relayLogToStudio(
                    "⏭️ Receiver: Ignored CAF PlayerManager " + command +
                      " during ordered MXS " + lastOrderedPlaybackAction +
                      " reconciliation.",
                  );
                  return;
                }
                relayLogToStudio(
                  "🎛️ Receiver: PlayerManager " + command +
                    " request routed to MXS playout (requestId=" +
                    (request && request.requestId !== undefined ? request.requestId : "n/a") +
                    ").",
                );
                if (command === "PLAY") {
                  markPlaybackStartSignal();
                  playbackPaused = false;
                  if (nativeStreamActive && nativeStreamPaused) {
                    resumeNativeStreamPlayout("player_manager_play", true);
                  } else {
                    requestNativePlaybackStart("player_manager_play");
                    publishMxsPlaybackStatus("STARTING", "player_manager_play");
                  }
                } else if (command === "PAUSE") {
                  playbackPaused = true;
                  if (!pauseNativeStreamPlayout("player_manager_pause", true)) {
                    pauseAllPlayout("player_manager_pause");
                  }
                } else if (command === "STOP") {
                  stopAllPlayout("player_manager_stop", undefined, true);
                }
              }, 0);
              return request;
            };

            [
              [messageType.PLAY, "PLAY"],
              [messageType.PAUSE, "PAUSE"],
              [messageType.STOP, "STOP"],
            ].forEach(function (entry) {
              if (!entry[0]) {
                return;
              }
              pm.setMessageInterceptor(entry[0], function (request) {
                return deferPlayerManagerCommand(entry[1], request);
              });
            });
          }
          cafLoadInterceptorConfigured = true;
          relayLogToStudio("✅ Receiver: CAF playback handlers configured for native stream.");
        }

        function configureCafPlayerDebugEvents() {
          const pm = getCastPlayerManager();
          if (!pm || pm._mxsDebugEventsConfigured || typeof pm.addEventListener !== "function") {
            return;
          }
          const events = cast.framework.events && cast.framework.events.EventType ? cast.framework.events.EventType : {};
          const messages = cast.framework.messages || {};
          [
            // PLAYING is the documented CAF event forwarded from the bound
            // HTMLMediaElement. PLAYER_STATE_CHANGED is a sender-side event,
            // not a Web Receiver PlayerManager event.
            events.PLAYING,
            events.PAUSE,
            events.MEDIA_STATUS,
            events.ERROR,
          ].forEach(function (eventType) {
            if (!eventType) return;
            try {
              pm.addEventListener(eventType, function (event) {
                const mediaStatus = event && event.mediaStatus ? event.mediaStatus : null;
                const playerState = mediaStatus && mediaStatus.playerState
                  ? mediaStatus.playerState
                  : event && event.playerState
                    ? event.playerState
                    : "";
                const value =
                  event && event.value !== undefined
                    ? event.value
                    : event && event.errorCode !== undefined
                      ? event.errorCode
                      : playerState;
                const msg = "CAF event " + eventType + (value !== "" ? ": " + value : "");
                writeCastDebug(eventType === events.ERROR ? "error" : "debug", msg);
                if (eventType === events.ERROR || eventType === events.PLAYING || eventType === events.PAUSE) {
                  relayLogToStudio("📺 Receiver: " + msg);
                }

                if (
                  eventType === events.PLAYING &&
                  nativeStreamStarting &&
                  nativeStreamUrl
                ) {
                  const cafWasPreplay = !lastPlaybackStartSignalAt;
                  logReceiverStartupTiming("caf_playing", {
                    nativeAttemptId: nativeStartupAttemptId,
                    prewarmBeforePlayback: nativeStreamPrewarmBeforePlayback,
                    playbackRequested: !cafWasPreplay,
                    mediaReadyState: document.getElementById("cast-media-element")
                      ? document.getElementById("cast-media-element").readyState
                      : null,
                  });
                  logReceiverStartupTiming("native_playing", {
                    nativeAttemptId: nativeStartupAttemptId,
                    playbackRequested: !cafWasPreplay,
                    prewarmBeforePlayback: nativeStreamPrewarmBeforePlayback,
                  });
                  if (
                    nativeStreamPrewarmBeforePlayback &&
                    (!lastPlaybackStartSignalAt || nativeStreamCompanionForPcm)
                  ) {
                    nativeStreamPrewarmReady = true;
                    logReceiverStartupTiming("caf_prewarm_ready", {
                      nativeAttemptId: nativeStartupAttemptId,
                      playbackRequested: !!lastPlaybackStartSignalAt,
                      mediaReadyState: document.getElementById("cast-media-element")
                        ? document.getElementById("cast-media-element").readyState
                        : null,
                    });
                    muteNativeStreamPrewarmOutput(document.getElementById("cast-media-element"));
                    if (lastPlaybackStartSignalAt && nativeStreamCompanionForPcm) {
                      activateNativeStream(
                        "caf_preplay_ready_after_play",
                        "✅ Receiver: CAF native /stream.wav prewarm became ready after PLAYBACK_START.",
                        nativeStartupAttemptId,
                      );
                    } else {
                      relayLogToStudio(
                        "✅ Receiver: CAF native /stream.wav prewarm ready; waiting for PLAYBACK_START.",
                      );
                    }
                  } else {
                    activateNativeStream(
                      "caf_playing",
                      "✅ Receiver: CAF native LAN stream PLAYING via /stream.wav.",
                      nativeStartupAttemptId,
                    );
                  }
                }

                // MEDIA_STATUS is the documented PlayerManager status event.
                // Keep the existing live-stream reload guard on this event so
                // CAF finishing a progressive WAV does not strand the session.
                if (
                  eventType === events.MEDIA_STATUS &&
                  messages.PlayerState &&
                  messages.IdleReason &&
                  playerState === messages.PlayerState.IDLE &&
                  mediaStatus &&
                  mediaStatus.idleReason === messages.IdleReason.FINISHED &&
                  nativeStreamActive &&
                  nativeStreamUrl
                ) {
                  relayLogToStudio("🔄 Receiver: Native stream finished; reloading /stream.wav...");
                  clearNativeStreamReloadTimer();
                  const reloadAttemptId = nativeStartupAttemptId;
                  nativeStreamReloadTimerId = setTimeout(() => {
                    nativeStreamReloadTimerId = null;
                    if (nativeStreamActive && nativeStreamUrl) {
                      startCafStreamPlayout(nativeStreamUrl, reloadAttemptId);
                    }
                  }, 100);
                }
              });
            } catch (e) {}
          });
          pm._mxsDebugEventsConfigured = true;
        }

        function clearNoSenderShutdownTimer() {
          if (noSenderShutdownTimeoutId) {
            clearTimeout(noSenderShutdownTimeoutId);
            noSenderShutdownTimeoutId = null;
          }
        }

        function clearNativeStartupWatchdog() {
          if (nativeStartupWatchdogId) {
            clearTimeout(nativeStartupWatchdogId);
            nativeStartupWatchdogId = null;
          }
        }

        function clearNativeStreamReloadTimer() {
          if (nativeStreamReloadTimerId) {
            clearTimeout(nativeStreamReloadTimerId);
            nativeStreamReloadTimerId = null;
          }
        }

        function clearLowLatencyStartupWatchdog() {
          if (lowLatencyStartupWatchdogId) {
            clearTimeout(lowLatencyStartupWatchdogId);
            lowLatencyStartupWatchdogId = null;
          }
        }

        function clearPcmStartupRetryTimer() {
          if (pcmStartupRetryTimerId) {
            clearTimeout(pcmStartupRetryTimerId);
            pcmStartupRetryTimerId = null;
          }
        }

        function releaseNativePcmCompanion(reason) {
          if (!nativeStreamStarting || !nativeStreamCompanionForPcm) {
            return false;
          }
          nativeStreamCompanionForPcm = false;
          if (nativeStreamPrewarmReady) {
            return activateNativeStream(
              "pcm_native_handoff",
              "✅ Receiver: Prepared native stream released for PCM handoff.",
              nativeStartupAttemptId,
            );
          }
          relayLogToStudio(
            "⏱️ Receiver: Prepared native stream is still booting; handoff will activate on PLAYING (" +
              (reason || "pcm_native_handoff") +").",
          );
          return true;
        }

        function degradePcmStartupToNative(reason) {
          if (window._receiverShutdownInProgress || nativeStreamActive) {
            return false;
          }
          if (nativeStreamStarting) {
            return lastPlaybackStartSignalAt
              ? releaseNativePcmCompanion(reason)
              : false;
          }
          clearLowLatencyStartupWatchdog();
          lowLatencyStartupRetryCount = PCM_STARTUP_MAX_RETRIES_BEFORE_NATIVE;
          window._pcmDegraded = true;
          try {
            localStorage.setItem("mxs_pcm_degraded", "true");
          } catch (e) {}
          setReceiverPlayoutPreference("native", reason || "pcm_startup_degraded");
          notifyPlayoutSelecting("native_stream", reason || "pcm_startup_degraded");
          relayLogToStudio(
            "⚠️ Receiver: PCM worklet startup failed; falling back to native stream (" +
              (reason || "pcm_startup_degraded") +
              ").",
          );
          invalidateWorkletInitialization();
          audioInitializing = false;
          workletInitPromise = null;
          pcmV2Telemetry.startupFallbacks++;
          if (pendingBinaryFrames.length > 0) {
            const pendingFrames = pendingBinaryFrames.reduce(
              (total, queued) => total + Number(queued && queued.metadata && queued.metadata.frameCount || 0),
              0,
            );
            pcmV2Telemetry.startupFallbackDroppedFrames += pendingFrames;
            relayLogToStudio(
              `⚠️ Receiver: native startup fallback discarded ${pendingFrames} queued PCM frames explicitly; no silent queue trim.`,
            );
          }
          pendingBinaryFrames = [];
          if (!lastPlaybackStartSignalAt) {
            const boundedCapabilityPrewarm =
              reason === "audio_worklet_capability_cached_unavailable";
            if (boundedCapabilityPrewarm) {
              relayLogToStudio(
                "🛡️ Receiver: Bounded native /stream.wav prewarm before PLAYBACK_START; CAF output remains muted until Play.",
              );
              return maybeStartNativeStream(reason, true);
            }
            // Generic startup failures remain selection-only. A native
            // progressive stream buffers from the moment it is opened, so
            // only the durable hard capability result is allowed to prewarm.
            relayLogToStudio(
              "⏸️ Receiver: Native fallback selected; waiting for PLAYBACK_START.",
            );
            return false;
          }
          return maybeStartNativeStream(reason || "pcm_startup_degraded");
        }

        function escalatePcmRuntimeToNative(reason) {
          if (
            window._receiverShutdownInProgress ||
            nativeStreamActive ||
            window._playbackMode === "native"
          ) {
            return false;
          }
          clearLowLatencyStartupWatchdog();
          setReceiverPlayoutPreference("native", reason || "pcm_runtime_unsustainable");
          resetBinaryPlayoutState("native_runtime_fallback");
          // Publish the ownership change before attempting CAF startup. The
          // Rust writer uses PLAYBACK_MODE as its PCM admission gate; a mere
          // selecting state leaves the backend emitting packets while this
          // receiver is already abandoning the PCM queue.
          notifyPlaybackMode("native", reason || "pcm_runtime_unsustainable", false);
          notifyPlayoutSelecting("native_runtime_fallback", reason || "pcm_runtime_unsustainable");
          relayLogToStudio(
            "⚠️ Receiver: PCM runtime queue exceeded the safe watermark; switching to native stream (" +
              (reason || "pcm_runtime_unsustainable") +
              ").",
          );
          if (nativeStreamStarting && nativeStreamCompanionForPcm) {
            return releaseNativePcmCompanion(reason || "pcm_runtime_unsustainable");
          }
          if (nativeStreamStarting) {
            return false;
          }
          return maybeStartNativeStream(reason || "pcm_runtime_unsustainable");
        }

        function monitorPcmRuntimeHealth(diag) {
          if (
            !diag ||
            !workletNode ||
            !workletReady ||
            nativeStreamActive ||
            window._playbackMode !== "pcm_fallback" ||
            diag.targetLocked !== true
          ) {
            return;
          }
          const rawQueueWallMs = Number(diag.rawQueueWallMs);
          const highWatermark =
            diag.queueHighWatermarkActive === true ||
            (Number.isFinite(rawQueueWallMs) && rawQueueWallMs >= 900);
          const lowWatermark =
            Number.isFinite(rawQueueWallMs) && rawQueueWallMs <= 300;
          if (highWatermark) {
            pcmRuntimeHighWatermarkDiagnostics += 1;
          } else if (lowWatermark || diag.buffering === true) {
            pcmRuntimeHighWatermarkDiagnostics = 0;
            return;
          } else {
            return;
          }
          if (
            pcmRuntimeHighWatermarkDiagnostics < PCM_RUNTIME_HIGH_WATERMARK_DIAGS ||
            pcmRuntimeNativeFallbacks > 0
          ) {
            return;
          }
          pcmRuntimeNativeFallbacks += 1;
          const reason =
            "pcm_runtime_queue_high_" +
            (Number.isFinite(rawQueueWallMs) ? Math.round(rawQueueWallMs) : "unknown") +
            "ms";
          const started = escalatePcmRuntimeToNative(reason);
          if (!started && binaryWS && binaryWS.readyState === WebSocket.OPEN) {
            try {
              binaryWS.send(JSON.stringify({
                type: "PCM_RUNTIME_UNSUSTAINABLE",
                reason,
                rawQueueWallMs: Number.isFinite(rawQueueWallMs) ? rawQueueWallMs : null,
                highWatermarkMs: 900,
                diagnostics: pcmRuntimeHighWatermarkDiagnostics,
              }));
            } catch (e) {}
            relayLogToStudio(
              "❌ Receiver: Native runtime fallback could not start; PCM session is unsustainable.",
            );
          }
        }

        function armLowLatencyStartupWatchdog(startedAt) {
          clearLowLatencyStartupWatchdog();
          const watchdogStartedAt = Number.isFinite(startedAt) ? startedAt : Date.now();
          const watchdogGeneration = workletLifecycleGeneration;
          lowLatencyStartupWatchdogId = setTimeout(() => {
            lowLatencyStartupWatchdogId = null;
            if (
              window._receiverShutdownInProgress ||
              watchdogGeneration !== workletLifecycleGeneration
            ) {
              return;
            }
            if (workletNode && workletReady) {
              lowLatencyStartupRetryCount = 0;
              return;
            }
            if (nativeStreamActive || nativeStreamStarting) {
              return;
            }
            if (workletInitPromise || audioInitializing) {
              const elapsedMs = Date.now() - watchdogStartedAt;
              if (elapsedMs < PCM_STARTUP_HARD_TIMEOUT_MS) {
                relayLogToStudio(
                  "⏳ Receiver: PCM worklet module is still loading; waiting for the active startup promise (" +
                    elapsedMs +
                    "ms).",
                );
                armLowLatencyStartupWatchdog(watchdogStartedAt);
                return;
              }
              relayLogToStudio(
                "⚠️ Receiver: PCM worklet startup exceeded the hard load limit; switching to native.",
              );
              degradePcmStartupToNative("pcm_startup_hard_timeout");
              return;
            }
            if (!configReceived || !currentBridgeIp) {
              return;
            }
            if (window._pcmDegraded) {
              relayLogToStudio("⚠️ Receiver: PCM worklet startup timed out during PCM recovery; keeping playback on the worklet path.");
              return;
            }
            lowLatencyStartupRetryCount += 1;
            if (lowLatencyStartupRetryCount >= PCM_STARTUP_MAX_RETRIES_BEFORE_NATIVE) {
              degradePcmStartupToNative("pcm_startup_timeout");
              return;
            }
            relayLogToStudio(
              "⚠️ Receiver: PCM worklet startup timed out; retrying PCM path (" +
                lowLatencyStartupRetryCount +
                ").",
            );
            invalidateWorkletInitialization();
            audioInitializing = false;
            workletInitPromise = null;
            schedulePcmStartupRetry("pcm_startup_retry");
          }, Math.min(
            PCM_STARTUP_HARD_TIMEOUT_MS,
            Math.max(250, PCM_STARTUP_HARD_TIMEOUT_MS - (Date.now() - watchdogStartedAt)),
          ));
        }

        function isCurrentNativeAttempt(attemptId) {
          return attemptId === nativeStartupAttemptId;
        }

        function stopHtmlAudioNativeCompanion() {
          const nativeAudio = document.getElementById("native-stream-audio");
          if (!nativeAudio) return;
          try {
            nativeAudio.pause();
            try {
              nativeAudio.currentTime = 0;
            } catch (e) {}
            nativeAudio.removeAttribute("src");
            nativeAudio.load();
          } catch (e) {}
        }

        function stopCafNativeCompanion() {
          const pm = getCastPlayerManager();
          if (pm) {
            // Use the documented PlayerManager stop() API first. Clearing the
            // bound media element below removes any progressive-WAV buffer so
            // the next PLAYBACK_START cannot inherit an idle tail. Keep the
            // older unload() fallback for CAF builds that expose it.
            try {
              if (typeof pm.stop === "function") {
                // pm.stop() re-enters the STOP interceptor asynchronously.
                // Tag every receiver-owned stop at the current native attempt
                // so its callback cannot tear down a newer stream generation.
                armPlayerManagerStopSuppression(nativeStartupAttemptId);
                pm.stop();
              } else if (typeof pm.unload === "function") {
                const unloadResult = pm.unload();
                if (unloadResult && typeof unloadResult.catch === "function") {
                  unloadResult.catch(() => {});
                }
              }
            } catch (e) {}
          }
          const cafAudio = document.getElementById("cast-media-element");
          if (cafAudio) {
            try {
              cafAudio.pause();
              try {
                cafAudio.currentTime = 0;
              } catch (e) {}
              cafAudio.removeAttribute("src");
              cafAudio.load();
            } catch (e) {}
          }
        }

        function armPlayerManagerStopSuppression(attemptId) {
          suppressedPlayerManagerStopCount += 1;
          suppressedPlayerManagerStopAttemptId = Number.isFinite(attemptId)
            ? attemptId
            : nativeStartupAttemptId;
          if (suppressedPlayerManagerStopTimerId) {
            clearTimeout(suppressedPlayerManagerStopTimerId);
          }
          suppressedPlayerManagerStopTimerId = setTimeout(() => {
            suppressedPlayerManagerStopTimerId = null;
            suppressedPlayerManagerStopCount = 0;
            suppressedPlayerManagerStopAttemptId = -1;
          }, 5000);
        }

        function consumePlayerManagerStopSuppression(request) {
          // CAF uses requestId=0 for receiver-owned pm.stop() callbacks. Cast
          // sender/user STOP requests carry their own request IDs and must
          // remain authoritative even while an internal stop is outstanding.
          if (Number(request && request.requestId) !== 0) {
            return false;
          }
          if (suppressedPlayerManagerStopCount <= 0) {
            return false;
          }
          suppressedPlayerManagerStopCount -= 1;
          if (suppressedPlayerManagerStopCount === 0 && suppressedPlayerManagerStopTimerId) {
            clearTimeout(suppressedPlayerManagerStopTimerId);
            suppressedPlayerManagerStopTimerId = null;
            suppressedPlayerManagerStopAttemptId = -1;
          }
          return true;
        }

        function invalidateWorkletInitialization() {
          workletLifecycleGeneration += 1;
          lastInitAttempt = 0;
          clearPcmStartupRetryTimer();
        }

        function schedulePcmStartupRetry(reason) {
          if (
            window._receiverShutdownInProgress ||
            nativeStreamActive ||
            nativeStreamStarting ||
            receiverPlayoutPreference !== "pcm_fallback" ||
            window._pcmDegraded
          ) {
            return false;
          }
          clearPcmStartupRetryTimer();
          const retryGeneration = workletLifecycleGeneration;
          pcmStartupRetryTimerId = setTimeout(() => {
            pcmStartupRetryTimerId = null;
            if (
              window._receiverShutdownInProgress ||
              retryGeneration !== workletLifecycleGeneration ||
              playbackPaused ||
              nativeStreamActive ||
              nativeStreamStarting ||
              receiverPlayoutPreference !== "pcm_fallback" ||
              window._pcmDegraded
            ) {
              return;
            }
            maybeStartLowLatencyPlayout(reason || "pcm_startup_retry");
          }, 250);
          return true;
        }

        function teardownPcmPlayout(reason, closeAudioContext) {
          if (workletNode || workletInitPromise) {
            workletHardTeardownCount += 1;
          }
          invalidateWorkletInitialization();
          workletInitPromise = null;
          pendingBinaryFrames = [];
          workletReady = false;
          window._isDrainingStartup = false;
          window._binaryActive = false;
          window._lastBinaryTime = 0;
          window._lastWorkletDiagTime = 0;
          audioInitializing = false;
          if (workletNode) {
            try {
              if (workletNode.port) {
                workletNode.port.postMessage({ type: "RESET" });
                workletNode.port.onmessage = null;
              }
            } catch (e) {}
            try {
              workletNode.disconnect();
            } catch (e) {}
            workletNode = null;
          }
          if (closeAudioContext) {
            audioResumePromise = null;
            if (masterGain) {
              try {
                masterGain.disconnect();
              } catch (e) {}
              masterGain = null;
            }
            if (audioCtx) {
              try {
                audioCtx.close();
              } catch (e) {}
              audioCtx = null;
            }
          }
          if (reason) {
            relayLogToStudio("🛑 Receiver: PCM fallback path torn down (" + reason + ").");
          }
        }

        function armNativeStartupWatchdog() {
          clearNativeStartupWatchdog();
          // Native pre-prime may begin several seconds before the owner presses
          // Play. That idle preparation time must never consume the audible
          // startup budget or trigger a destructive fallback before live PCM.
          if (!lastPlaybackStartSignalAt) {
            return false;
          }
          const watchdogAttemptId = nativeStartupAttemptId;
          nativeStartupWatchdogId = setTimeout(() => {
            nativeStartupWatchdogId = null;
            if (window._receiverShutdownInProgress) {
              return;
            }
            if (watchdogAttemptId !== nativeStartupAttemptId) {
              relayLogToStudio(
                "⏭️ Receiver: Ignored stale native startup watchdog " +
                  "(attempt=" + watchdogAttemptId +
                  ", current=" + nativeStartupAttemptId + ").",
              );
              return;
            }
            if (window._playbackMode === "native" || nativeStreamActive || workletNode || audioInitializing) {
              return;
            }
            if (isPcmWorkletKnownUnavailable()) {
              // This receiver has already proven that PCM AudioWorklet cannot
              // initialize. Keep the in-flight native attempt alive; cycling
              // through an impossible PCM path only restarts CAF and adds lag.
              relayLogToStudio(
                "⏳ Receiver: Native startup exceeded 5 seconds after Play; " +
                  "PCM is known unavailable, so the current native attempt remains authoritative.",
              );
              notifyPlayoutSelecting(
                "native_stream",
                "native_extended_startup_pcm_unavailable",
              );
              return;
            }
            logReceiverStartupTiming("native_startup_timeout", {
              nativeAttemptId: watchdogAttemptId,
              timeoutMs: NATIVE_STARTUP_TIMEOUT_MS,
              prewarmBeforePlayback: nativeStreamPrewarmBeforePlayback,
              prewarmReady: nativeStreamPrewarmReady,
              playbackRequested: !!lastPlaybackStartSignalAt,
            });
            relayLogToStudio(
              "⚠️ Receiver: Native stream startup timed out after " +
                NATIVE_STARTUP_TIMEOUT_MS +
                "ms; switching to PCM fallback.",
            );
            // The native attempt failed, but the ordered PLAYBACK_START is
            // still active. Preserve that intent so the recovery path can
            // start native immediately instead of waiting for another Play.
            stopNativeStreamPlayout("startup_timeout", true);
            setReceiverPlayoutPreference("pcm_fallback", "native_startup_timeout");
            if (configReceived) {
              initAudio(true, false);
            }
          }, NATIVE_STARTUP_TIMEOUT_MS);
          return true;
        }

        function muteNativeStreamPrewarmOutput(element) {
          if (!element) {
            return;
          }
          try {
            if (element._mxsPrewarmFadeTimerId) {
              clearTimeout(element._mxsPrewarmFadeTimerId);
              delete element._mxsPrewarmFadeTimerId;
            }
            if (element._mxsVolumeBeforePrewarm === undefined) {
              element._mxsVolumeBeforePrewarm = Number.isFinite(element.volume)
                ? element.volume
                : 1;
            }
            element.muted = true;
            element.volume = 0;
            element._mxsPrewarmMuted = true;
          } catch (e) {}
        }

        function releaseNativeStreamPrewarmMute() {
          [
            document.getElementById("cast-media-element"),
            document.getElementById("native-stream-audio"),
          ].forEach(function (element) {
            if (!element || !element._mxsPrewarmMuted) {
              return;
            }
            try {
              const targetVolume = element._mxsVolumeBeforePrewarm === undefined
                ? 1
                : element._mxsVolumeBeforePrewarm;
              element.muted = false;
              element.volume = 0;
              delete element._mxsVolumeBeforePrewarm;
              delete element._mxsPrewarmMuted;
              const fadeStartedAt = typeof performance !== "undefined" && performance.now
                ? performance.now()
                : Date.now();
              const fadeIn = function () {
                const now = typeof performance !== "undefined" && performance.now
                  ? performance.now()
                  : Date.now();
                const progress = Math.min(
                  1,
                  Math.max(0, (now - fadeStartedAt) / NATIVE_STARTUP_FADE_MS),
                );
                try {
                  element.volume = targetVolume * progress;
                } catch (e) {
                  return;
                }
                if (progress < 1) {
                  element._mxsPrewarmFadeTimerId = setTimeout(fadeIn, 4);
                } else {
                  delete element._mxsPrewarmFadeTimerId;
                }
              };
              fadeIn();
            } catch (e) {}
          });
          logReceiverStartupTiming("native_prewarm_unmuted", {
            nativeAttemptId: nativeStartupAttemptId,
            playbackRequested: !!lastPlaybackStartSignalAt,
            prewarmReady: nativeStreamPrewarmReady,
          });
        }

        function activateNativeStream(modeReason, logMessage, attemptId) {
          if (attemptId && !isCurrentNativeAttempt(attemptId)) {
            return false;
          }
          nativeStreamStarting = false;
          nativeStreamActive = true;
          nativeStreamPaused = false;
          nativeFailureRetryAttempted = false;
          releasePendingNativeStartupTrim();
          releaseNativeStreamPrewarmMute();
          nativeStreamPrewarmBeforePlayback = false;
          nativeStreamPrewarmReady = false;
          nativeStreamCompanionForPcm = false;
          window._nativeStreamActive = true;
          setActiveAudioPathOwner("native_caf", modeReason || "native_active");
          clearNativeStartupWatchdog();
          logReceiverStartupTiming("receiver_ready", {
            modeReason: modeReason || "",
            nativeStreamActive: true,
            nativeStreamStarting: false,
          });
          logReceiverStartupTiming("native_audio_owner_active", {
            nativeAttemptId: nativeStartupAttemptId,
            modeReason: modeReason || "",
            playbackRequested: !!lastPlaybackStartSignalAt,
          });
          if (modeReason.indexOf("caf_") === 0) {
            stopHtmlAudioNativeCompanion();
          } else {
            stopCafNativeCompanion();
          }
          notifyPlaybackMode("native", modeReason);
          revealReceiverUi("native_active");
          teardownPcmPlayout("native_active", true);
          publishMxsPlaybackStatus(
            lastPlaybackStartSignalAt ? "PLAYING" : "READY",
            modeReason || "native_active",
          );
          if (logMessage) {
            relayLogToStudio(logMessage);
          }
          return true;
        }

        function scheduleNoSenderShutdown(reason) {
          if (window._receiverShutdownInProgress) {
            return;
          }
          clearNoSenderShutdownTimer();
          noSenderShutdownTimeoutId = setTimeout(() => {
            noSenderShutdownTimeoutId = null;
            if (window._receiverShutdownInProgress) {
              return;
            }
            const context = getCastReceiverContext();
            const senders = context && typeof context.getSenders === "function" ? context.getSenders() : [];
            if (!senders || senders.length === 0) {
              shutdownReceiver(reason);
            }
          }, 3000);
        }

        function parseCastPayload(raw) {
          if (!raw) {
            return null;
          }
          if (typeof raw === "string") {
            try {
              return JSON.parse(raw);
            } catch (e) {
              relayLogToStudio("⚠️ Receiver: Ignored malformed Cast message JSON.");
              return null;
            }
          }
          if (raw && typeof raw.data === "string") {
            try {
              return JSON.parse(raw.data);
            } catch (e) {
              relayLogToStudio("⚠️ Receiver: Ignored malformed nested Cast message JSON.");
              return null;
            }
          }
          return raw;
        }

        // [v13.9.504] Dynamically build a valid 2-second silent WAV loop for non-Cast audio unlock fallback.
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

        function stopNativeStreamPlayout(reason, preservePlaybackIntent = false) {
          const hadNativePlayout =
            nativeStreamActive ||
            nativeStreamStarting ||
            !!nativeStreamUrl ||
            window._nativeStreamActive ||
            window._playbackMode === "native";
          const now = Date.now();
          const duplicateStop =
            reason &&
            reason === lastNativeStopReason &&
            now - lastNativeStopAt <= PCM_QUEUE_RESET_DEDUPE_MS;
          nativeStartupAttemptId++;
          clearNativeStreamReloadTimer();
          nativeStartupTrimPending = false;
          if (!preservePlaybackIntent) {
            clearPlaybackStartSignal();
          }
          clearNativeStartupWatchdog();
          clearLowLatencyStartupWatchdog();
          nativeStreamStarting = false;
          nativeStreamActive = false;
          nativeStreamPaused = false;
          nativeStreamPrewarmBeforePlayback = false;
          nativeStreamPrewarmReady = false;
          nativeStreamCompanionForPcm = false;
          nativeStreamUrl = "";
          window._nativeStreamActive = false;
          window._playbackMode = "unknown";
          try {
            window._pcmDegraded = localStorage.getItem("mxs_pcm_degraded") === "true";
          } catch (e) {
            window._pcmDegraded = false;
          }
          playbackModeLastSent = "";
          playbackModeLastSentReady = null;
          playbackModeLastSentGeneration = -1;
          stopCafNativeCompanion();
          stopHtmlAudioNativeCompanion();
          
          const htmlAudio = document.getElementById("native-stream-audio");
          const cafAudio = document.getElementById("cast-media-element");
          [htmlAudio, cafAudio].forEach(function resetNativeElement(element) {
            if (!element) return;
            try {
              if (element._mxsPrewarmMuted) {
                element.volume = element._mxsVolumeBeforePrewarm === undefined
                  ? 1
                  : element._mxsVolumeBeforePrewarm;
                delete element._mxsVolumeBeforePrewarm;
                delete element._mxsPrewarmMuted;
              }
              element.playbackRate = 1.0;
              element.muted = false;
              if (element._mxsVolumeBeforePause !== undefined) {
                element.volume = element._mxsVolumeBeforePause;
                delete element._mxsVolumeBeforePause;
              }
            } catch (e) {}
          });

          if (reason && hadNativePlayout && !duplicateStop) {
            relayLogToStudio("🛑 Receiver: Native stream stopped (" + reason + ").");
          }
          if (reason) {
            lastNativeStopReason = reason;
            lastNativeStopAt = now;
          }
        }

        function holdNativeStreamForReplay(reason) {
          if (!nativeStreamActive && !nativeStreamStarting) {
            return false;
          }
          const cafAudio = document.getElementById("cast-media-element");
          const htmlAudio = document.getElementById("native-stream-audio");
          [cafAudio, htmlAudio].forEach(function muteReplayNativeElement(element) {
            if (!element) return;
            try {
              if (element._mxsVolumeBeforePause === undefined) {
                element._mxsVolumeBeforePause = Number.isFinite(element.volume)
                  ? element.volume
                  : 1;
              }
              element.muted = true;
              element.volume = 0;
            } catch (e) {}
          });
          nativeStreamPaused = nativeStreamActive;
          if (nativeStreamStarting) {
            muteNativeStreamPrewarmOutput(cafAudio);
            muteNativeStreamPrewarmOutput(htmlAudio);
          }
          relayLogToStudio(
            "⏸️ Receiver: Native CAF retained muted and primed for ordered replay (" +
              (reason || "playback_stop") + ").",
          );
          return true;
        }

        function pauseNativeStreamPlayout(reason, cafRequestAlreadyApplied) {
          if (!nativeStreamActive && !nativeStreamStarting) return false;
          nativeStreamPaused = true;
          const cafAudio = document.getElementById("cast-media-element");
          const htmlAudio = document.getElementById("native-stream-audio");
          [cafAudio, htmlAudio].forEach(function muteNativeElement(element) {
            if (!element) return;
            try {
              if (element._mxsVolumeBeforePause === undefined) {
                element._mxsVolumeBeforePause = Number.isFinite(element.volume) ? element.volume : 1;
              }
              element.muted = true;
              element.volume = 0;
            } catch (e) {}
          });
          // Keep the live media clock advancing while muted. Pausing the HTTP
          // stream lets a stale progressive-WAV tail accumulate and causes a
          // multi-second delay when Play follows Pause.
          relayLogToStudio("⏸️ Receiver: Native output muted while live transport stays primed (" + (reason || "playback_pause") + ").");
          publishMxsPlaybackStatus("PAUSED", reason || "playback_pause");
          return true;
        }

        function resumeNativeStreamPlayout(reason, cafRequestAlreadyApplied) {
          if (!nativeStreamActive || !nativeStreamPaused) return false;
          nativeStreamPaused = false;
          const cafAudio = document.getElementById("cast-media-element");
          const htmlAudio = document.getElementById("native-stream-audio");
          [cafAudio, htmlAudio].forEach(function unmuteNativeElement(element) {
            if (!element) return;
            try {
              element.muted = false;
              element.volume = element._mxsVolumeBeforePause === undefined
                ? 1
                : element._mxsVolumeBeforePause;
              delete element._mxsVolumeBeforePause;
            } catch (e) {}
          });
          // Pause is implemented as a mute so the live progressive-WAV clock
          // stays warm. Do not call play() on an element that is already
          // running: that can force CAF to re-prime the decoder and creates a
          // short click/stutter on rapid Pause -> Play. Only honor an actual
          // CAF-applied pause when the media element reports itself paused.
          if (cafRequestAlreadyApplied === true) {
            [cafAudio, htmlAudio].forEach(function resumePausedNativeElement(element) {
              if (!element || element.paused !== true || typeof element.play !== "function") return;
              try {
                const result = element.play();
                if (result && typeof result.catch === "function") result.catch(() => {});
              } catch (e) {}
            });
          }
          relayLogToStudio(
            "▶️ Receiver: Native output unmuted at the live edge (" +
              (cafRequestAlreadyApplied === true ? "CAF resume; " : "live clock preserved; ") +
              (reason || "playback_start") +
              ").",
          );
          publishMxsPlaybackStatus("PLAYING", reason || "playback_start");
          return true;
        }

        function destroyAudioWorklet() {
          if (workletNode || workletInitPromise) {
            workletHardTeardownCount += 1;
          }
          invalidateWorkletInitialization();
          clearLowLatencyStartupWatchdog();
          workletInitPromise = null;
          audioInitializing = false;
          if (workletNode) {
            try {
              if (workletNode.port) {
                workletNode.port.postMessage({ type: "RESET" });
                workletNode.port.onmessage = null;
              }
            } catch (e) {}
            try {
              workletNode.disconnect();
            } catch (e) {}
            workletNode = null;
          }
          workletReady = false;
        }

        function resetBinaryPlayoutState(reason) {
          const preserveNativeMode = nativeStreamActive || nativeStreamStarting || window._playbackMode === "native";
          const hadBinaryPlayout =
            pendingBinaryFrames.length > 0 ||
            window._isDrainingStartup ||
            window._binaryActive ||
            !!workletNode ||
            !!workletInitPromise ||
            audioInitializing ||
            workletReady;
          const now = Date.now();
          const duplicateReset =
            reason &&
            reason === lastBinaryResetReason &&
            now - lastBinaryResetAt <= PCM_QUEUE_RESET_DEDUPE_MS;
          pendingBinaryFrames = [];
          window._isDrainingStartup = false;
          window._binaryActive = false;
          window._lastBinaryTime = 0;
          if (!preserveNativeMode) {
            window._playbackMode = "unknown";
            playbackModeLastSent = "";
            playbackModeLastSentReady = null;
            playbackModeLastSentGeneration = -1;
          }
          
          destroyAudioWorklet();
          
          clearLowLatencyStartupWatchdog();
          if (reason && hadBinaryPlayout && !duplicateReset) {
            relayLogToStudio("🛑 Receiver: Binary playout reset (" + reason + ").");
          }
          if (reason) {
            lastBinaryResetReason = reason;
            lastBinaryResetAt = now;
          }
        }

        function stopAllPlayout(
          reason,
          statusState,
          fromPlayerManager,
          preserveNativeForReplay = false,
          preservePlaybackIntent = false,
        ) {
          playbackPaused = false;
          setPcmAudioPriority(false, reason || "playback_stop");
          pendingPlaybackMode = null;
          pendingPlayoutSelection = null;
          const stopReason = String(reason || "playback_stop");
          const hadPublishedAudioMode =
            window._playbackMode !== "unknown" ||
            playbackModeLastSent !== "";
          clearPlaybackRecoveryRetry();
          if (!preservePlaybackIntent) {
            clearPlaybackStartSignal();
          }
          // Close backend PCM admission and reset its direct-session/ASRC
          // state before resetting receiver playout. Destructive callers also
          // tear down the native item; ordered replay callers retain it muted
          // so rapid STOP -> PLAY does not reopen PCM or reload CAF.
          if (hadPublishedAudioMode && preserveNativeForReplay) {
            // Keep native selected while stopped so the next ordered Play can
            // unmute/resume the existing CAF item instead of booting PCM and
            // starting a second native prewarm behind it.
            notifyPlaybackMode("native", stopReason, false);
          } else if (hadPublishedAudioMode) {
            notifyPlaybackMode("unknown", stopReason, false);
          }
          resetBinaryPlayoutState(stopReason);
          if (preserveNativeForReplay) {
            const retainedNative = holdNativeStreamForReplay(stopReason);
            if (!retainedNative) {
              // If the previous path was PCM, begin the native prewarm now,
              // while stopped and muted, so the next Play has a ready CAF
              // owner instead of waiting for a replay-time load.
              maybeStartNativeStream("stop_replay_prewarm", true, true);
            }
          } else {
            stopNativeStreamPlayout(stopReason);
            setActiveAudioPathOwner("none", stopReason);
          }
          publishMxsPlaybackStatus(statusState || "STOPPED", stopReason);
        }

        function pauseAllPlayout(reason) {
          playbackPaused = true;
          clearLowLatencyStartupWatchdog();
          clearPcmStartupRetryTimer();

          // Pause is reversible for native CAF playout. Keep the loaded
          // progressive-WAV item and its live clock warm, but mute the output;
          // STOP remains the destructive boundary that clears the stream and
          // prevents an old buffered tail from surviving a later session.
          if (pauseNativeStreamPlayout(reason || "playback_pause", true)) {
            relayLogToStudio(
              "⏸️ Receiver: Playback paused; native CAF media item preserved.",
            );
            publishMxsPlaybackStatus("PAUSED", reason || "playback_pause");
            return;
          }
          if (workletNode && workletReady) {
            resetRealtimePlayoutKeepPcmReady(reason || "playback_pause");
            publishMxsPlaybackStatus("PAUSED", reason || "playback_pause");
            relayLogToStudio(
              "⏸️ Receiver: Playback paused; PCM worklet retained with queue reset.",
            );
            return;
          }
          publishMxsPlaybackStatus("PAUSED", reason || "playback_pause");
          relayLogToStudio("⏸️ Receiver: Playback paused; no active playout teardown required.");
        }

        function resetRealtimePlayoutKeepPcmReady(reason) {
          // Pause is a reversible hold for PCM too. Clear queued audio and
          // reset the processor timeline, but retain the initialized worklet
          // so the next PLAYBACK_START can resume without a second module
          // load or an implicit Stop-style teardown.
          clearPlaybackStartSignal();
          pendingBinaryFrames = [];
          window._isDrainingStartup = false;
          window._binaryActive = false;
          window._lastBinaryTime = 0;
          try {
            window._pcmDegraded = localStorage.getItem("mxs_pcm_degraded") === "true";
          } catch (e) {
            window._pcmDegraded = false;
          }
          clearLowLatencyStartupWatchdog();
          const now = Date.now();
          const duplicateReset =
            lastPcmQueueResetAt > 0 &&
            now - lastPcmQueueResetAt <= PCM_QUEUE_RESET_DEDUPE_MS;
          if (workletNode && workletNode.port && !duplicateReset) {
            try {
              workletNode.port.postMessage({ type: "RESET" });
              workletQueueResetCount += 1;
              lastPcmQueueResetAt = now;
            } catch (e) {}
            workletReady = true;
          }
          if (workletNode && workletReady) {
            notifyPlaybackMode("pcm_fallback", (reason || "playback_idle") + "_pcm_ready");
          }
          if (reason && !duplicateReset) {
            relayLogToStudio("⏸️ Receiver: PCM playout paused; worklet retained and queue reset (" + reason + ").");
          }
        }

        function stopRealtimePlayoutKeepNativePrimed(reason) {
          // Pause/idle is a hard playout boundary. Keeping either native
          // /stream.wav or the PCM worklet alive lets silence and late packets
          // accumulate, making the next resume inherit avoidable latency.
          stopAllPlayout(reason || "playback_stop");
        }

        function startPcmFallbackAfterNativeFailure(reason) {
          const failureReason = reason || "native_playback_failure";
          if (isPcmWorkletKnownUnavailable()) {
            // AudioWorklet is known unavailable, so native remains authoritative.
            // Retry directly while the ordered Play is active; GUI snapshots
            // are intentionally audio-neutral and cannot trigger recovery.
            setReceiverPlayoutPreference(
              "native",
              failureReason + "_pcm_known_unavailable",
            );
            notifyPlayoutSelecting(
              "native_stream",
              failureReason + "_native_retry",
            );
            if (
              lastPlaybackStartSignalAt &&
              !nativeStreamActive &&
              !nativeStreamStarting &&
              !nativeFailureRetryAttempted
            ) {
              nativeFailureRetryAttempted = true;
              relayLogToStudio(
                "🔁 Receiver: Retrying native stream once after " +
                  failureReason + " while playback remains active.",
              );
              return maybeStartNativeStream(failureReason);
            }
            relayLogToStudio(
              "⏭️ Receiver: PCM fallback skipped after " + failureReason +
                "; AudioWorklet is known unavailable and native remains authoritative.",
            );
            return false;
          }
          setReceiverPlayoutPreference("pcm_fallback", failureReason);
          if (configReceived) {
            initAudio(true, false);
            return true;
          }
          return false;
        }

        function startHtmlAudioStreamPlayout(streamUrl, attemptId) {
          const nativeAudio = document.getElementById("native-stream-audio");
          if (!nativeAudio) {
            clearNativeStartupWatchdog();
            relayLogToStudio("⚠️ Receiver: Native HTML stream element missing.");
            nativeStreamStarting = false;
            nativeStreamActive = false;
            window._nativeStreamActive = false;
            startPcmFallbackAfterNativeFailure("html_audio_element_missing");
            return false;
          }
          try {
            const onNativeAudioPlaying = function onNativeAudioPlaying() {
              if (!isCurrentNativeAttempt(attemptId)) return;
              nativeAudio.removeEventListener("playing", onNativeAudioPlaying);
              if (
                nativeStreamPrewarmBeforePlayback &&
                (!lastPlaybackStartSignalAt || nativeStreamCompanionForPcm)
              ) {
                nativeStreamPrewarmReady = true;
                muteNativeStreamPrewarmOutput(nativeAudio);
                if (lastPlaybackStartSignalAt && nativeStreamCompanionForPcm) {
                  activateNativeStream(
                    "html_preplay_ready_after_play",
                    "✅ Receiver: HTML native /stream.wav prewarm became ready after PLAYBACK_START.",
                    attemptId,
                  );
                } else {
                  relayLogToStudio(
                    "✅ Receiver: HTML native /stream.wav prewarm ready; waiting for PLAYBACK_START.",
                  );
                }
              } else {
                activateNativeStream(
                  "html_audio_playing",
                  "✅ Receiver: HTML audio stream fallback playing via /stream.wav.",
                  attemptId,
                );
              }
            };
            nativeAudio.pause();
            nativeAudio.muted = false;
            nativeAudio.loop = false;
            nativeAudio.preload = "auto";
            nativeAudio.crossOrigin = "anonymous";
            if (nativeStreamPrewarmBeforePlayback) {
              muteNativeStreamPrewarmOutput(nativeAudio);
            }
            nativeAudio.src = streamUrl;
            nativeAudio.addEventListener("playing", onNativeAudioPlaying, { once: true });
            nativeAudio.onerror = function () {
              if (!isCurrentNativeAttempt(attemptId)) return;
              if (!nativeStreamActive && !nativeStreamStarting) return;
              nativeAudio.removeEventListener("playing", onNativeAudioPlaying);
              nativeStreamStarting = false;
              nativeStreamActive = false;
              window._nativeStreamActive = false;
              clearNativeStartupWatchdog();
              relayLogToStudio("⚠️ Receiver: HTML audio stream media error.");
              startPcmFallbackAfterNativeFailure("html_audio_media_error");
            };
            const playPromise = nativeAudio.play();
            if (playPromise && typeof playPromise.then === "function") {
              playPromise
                .then(function () {
                  relayLogToStudio("✅ Receiver: HTML audio stream fallback load accepted via /stream.wav.");
                })
                .catch(function (e) {
                  if (!isCurrentNativeAttempt(attemptId)) return;
                  nativeAudio.removeEventListener("playing", onNativeAudioPlaying);
                  nativeStreamStarting = false;
                  nativeStreamActive = false;
                  window._nativeStreamActive = false;
                  clearNativeStartupWatchdog();
                  relayLogToStudio("⚠️ Receiver: HTML audio stream play failed: " + (e && e.message ? e.message : e));
                  startPcmFallbackAfterNativeFailure("html_audio_play_rejected");
                });
            } else {
              if (
                nativeStreamPrewarmBeforePlayback &&
                (!lastPlaybackStartSignalAt || nativeStreamCompanionForPcm)
              ) {
                nativeStreamPrewarmReady = true;
                if (lastPlaybackStartSignalAt && nativeStreamCompanionForPcm) {
                  activateNativeStream(
                    "html_preplay_ready_after_play",
                    "✅ Receiver: HTML native /stream.wav prewarm became ready after PLAYBACK_START.",
                    attemptId,
                  );
                } else {
                  relayLogToStudio(
                    "✅ Receiver: HTML native /stream.wav prewarm accepted; waiting for PLAYBACK_START.",
                  );
                }
              } else {
                activateNativeStream(
                  "html_audio_started",
                  "✅ Receiver: HTML audio stream fallback started via /stream.wav.",
                  attemptId,
                );
              }
            }
            return true;
          } catch (e) {
            nativeStreamStarting = false;
            nativeStreamActive = false;
            window._nativeStreamActive = false;
            clearNativeStartupWatchdog();
            relayLogToStudio("⚠️ Receiver: HTML audio stream setup failed: " + e.message);
            startPcmFallbackAfterNativeFailure("html_audio_setup_failed");
            return false;
          }
        }

        function startCafStreamPlayout(streamUrl, attemptId) {
          if (typeof cast === "undefined" || !cast.framework || !cast.framework.messages) {
            return false;
          }
          configureCafPlaybackHandlers();
          const context = getCastReceiverContext();
          if (context && typeof context.canDisplayType === "function") {
            try {
              const supported = context.canDisplayType("audio/wav");
              if (supported === false) {
                writeCastDebug("warn", "CastReceiverContext.canDisplayType rejected audio/wav; falling back.");
                return false;
              }
            } catch (e) {}
          }
          const pm = getCastPlayerManager();
          if (!pm || typeof pm.load !== "function") {
            writeCastDebug("warn", "CAF PlayerManager unavailable; falling back to HTML audio stream.");
            return false;
          }
          if (nativeStreamPrewarmBeforePlayback) {
            muteNativeStreamPrewarmOutput(document.getElementById("cast-media-element"));
          }
          try {
            const messages = cast.framework.messages;
            const loadRequestData = new messages.LoadRequestData();
            const media = new messages.MediaInformation();
            media.contentId = "mxs-native-stream-" + (attemptId !== undefined ? attemptId : Date.now());
            media.contentType = "audio/wav";
            media.streamType = messages.StreamType.LIVE;
            media.duration = null;
            // CAF uses this live anchor to avoid replaying an older buffered
            // position when it attaches to the progressive LAN stream.
            media.startAbsoluteTime = Date.now() / 1000;
            media.contentUrl = streamUrl;
            media.customData = { streamUrl: streamUrl, source: "mxs004-native-stream" };
            if (typeof messages.GenericMediaMetadata === "function") {
              const metadata = new messages.GenericMediaMetadata();
              metadata.title = "MXS-004 Studio";
              metadata.subtitle = "Native LAN audio stream";
              media.metadata = metadata;
            }
            loadRequestData.media = media;
            loadRequestData.autoplay = true;
            notifyPlayoutSelecting("native_stream", "caf_load_requested");
            logReceiverStartupTiming("caf_load_requested", {
              nativeAttemptId: attemptId,
              prewarmBeforePlayback: nativeStreamPrewarmBeforePlayback,
              playbackRequested: !!lastPlaybackStartSignalAt,
              autoplay: true,
            });
            relayLogToStudio("🧭 Receiver: Native playback preferred; PCM bridge stays idle until fallback is required.");

            writeCastDebug("info", "Calling PlayerManager.load for " + streamUrl);
            const result = pm.load(loadRequestData);
            if (result && typeof result.then === "function") {
              result
                .then(function () {
                  logReceiverStartupTiming("caf_load_accepted", {
                    nativeAttemptId: attemptId,
                    prewarmBeforePlayback: nativeStreamPrewarmBeforePlayback,
                    playbackRequested: !!lastPlaybackStartSignalAt,
                  });
                  writeCastDebug("info", "CAF native stream LOAD accepted.");
                })
                .catch(function (e) {
                  if (!isCurrentNativeAttempt(attemptId)) return;
                  writeCastDebug("error", "CAF native stream LOAD failed: " + (e && e.message ? e.message : e));
                  relayLogToStudio("⚠️ Receiver: CAF native stream LOAD failed: " + (e && e.message ? e.message : e));
                  startHtmlAudioStreamPlayout(streamUrl, attemptId);
                });
            } else {
              logReceiverStartupTiming("caf_load_accepted", {
                nativeAttemptId: attemptId,
                prewarmBeforePlayback: nativeStreamPrewarmBeforePlayback,
                playbackRequested: !!lastPlaybackStartSignalAt,
                synchronous: true,
              });
              writeCastDebug("info", "CAF native stream LOAD started.");
            }
            return true;
          } catch (e) {
            clearNativeStartupWatchdog();
            writeCastDebug("error", "CAF native stream setup failed: " + e.message);
            relayLogToStudio("⚠️ Receiver: CAF native stream setup failed: " + e.message);
            return false;
          }
        }

        function startNativeStreamPlayout(ip, customPort, allowPcmCompanion = false) {
          if (!ENABLE_NATIVE_STREAM_PLAYOUT || window._receiverShutdownInProgress) {
            return false;
          }
          // [v13.9.506] SINGLE PATH: Don't start native stream if worklet is already
          // handling playout — dual paths cause wobble from competing clock recovery.
          if (
            !allowPcmCompanion &&
            workletNode &&
            workletReady &&
            window._playbackMode === "pcm_fallback"
          ) {
            relayLogToStudio("📡 Receiver: Native stream skipped; AudioWorklet already active.");
            return false;
          }
          if (!ip) {
            relayLogToStudio("⚠️ Receiver: Native stream skipped; bridge IP unavailable.");
            return false;
          }

          const targetPort = customPort || (window.SERVER_PORT && !window.SERVER_PORT.startsWith("{{") ? window.SERVER_PORT : "8080");
          const streamUrl = "http://" + ip + ":" + targetPort + "/stream.wav?cb=" + Date.now();
          if ((nativeStreamActive || nativeStreamStarting) && nativeStreamUrl && nativeStreamUrl.indexOf("http://" + ip + ":" + targetPort + "/stream.wav") === 0) {
            return true;
          }

          const attemptId = ++nativeStartupAttemptId;
          clearNativeStreamReloadTimer();
          nativeStreamStarting = true;
          nativeStreamActive = false;
          nativeStreamUrl = streamUrl;
          nativeStartupTrimPending = true;
          window._nativeStreamActive = false;
          armNativeStartupWatchdog();

          if (startCafStreamPlayout(streamUrl, attemptId)) {
            return true;
          }
          const htmlStarted = startHtmlAudioStreamPlayout(streamUrl, attemptId);
          if (!htmlStarted) {
            clearNativeStartupWatchdog();
          }
          return htmlStarted;
        }

        function shutdownReceiver(reason) {
          if (window._receiverShutdownInProgress) {
            return;
          }
          window._receiverShutdownInProgress = true;
          clearReceiverSessionCaches("cast_stopped");
          suppressBinaryReconnect = true;
          clearBinaryReconnectTimer();
          clearLowLatencyStartupWatchdog();
          window._wsReconnectAttempts = 0;
          window._handshakeAcked = false;
          receiverHandshakeTelemetryReady = false;
          receiverBridgeConfigReady = false;
          pendingPlaybackMode = null;
          pendingPlayoutSelection = null;
          window._sendHandshake = null;
          window._binaryActive = false;
          window._isDrainingStartup = false;
          configReceived = false;
          expectedPcmSessionId = null;
          frozenJitterTarget = null;
          pcmV2Validator = null;
          pcmV2AllowInitialOffset = true;
          playoutPathLogged = false;
          pendingBinaryFrames = [];
          window._playbackMode = "unknown";
          playbackModeLastSent = "";
          playbackModeLastSentReady = null;
          playbackModeLastSentGeneration = -1;
          workletReady = false;
          window._lastBinaryTime = 0;
          window._lastWorkletDiagTime = 0;
          stopNativeStreamPlayout(reason || "shutdown");
          if (window._nativeLatencyIntervalId) {
            clearInterval(window._nativeLatencyIntervalId);
            window._nativeLatencyIntervalId = null;
          }
          if (autoDiscoveryFallbackTimeoutId) {
            clearTimeout(autoDiscoveryFallbackTimeoutId);
            autoDiscoveryFallbackTimeoutId = null;
          }
          if (autoUnlockIntervalId) {
            clearInterval(autoUnlockIntervalId);
            autoUnlockIntervalId = null;
          }
          clearNoSenderShutdownTimer();
          relayLogToStudio(`🛑 Receiver: Shutdown requested${reason ? ` (${reason})` : ""}`);
          clearLegacyMediaStream();
          destroyAudioWorklet();
          if (masterGain) {
            try {
              masterGain.disconnect();
            } catch (e) {}
            masterGain = null;
          }
          if (audioCtx) {
            audioResumePromise = null;
            try {
              audioCtx.close();
            } catch (e) {}
            audioCtx = null;
          }
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
          try {
            const context = getCastReceiverContext();
            if (context && typeof context.stop === "function") {
              context.stop();
            }
          } catch (e) {
            relayLogToStudio(`⚠️ Receiver: Cast receiver stop failed: ${e.message}`);
          }
          currentBridgeIp = null;
          currentBridgePort = null;
          currentBridgeToken = null;
        }

        function queueBinaryFrame(packet) {
          if (!identityAllowsAudio()) return;
          if (window._receiverShutdownInProgress) {
            return;
          }
          const buffer = packet && packet.payload ? packet.payload : packet;
          if (!(buffer instanceof ArrayBuffer) && (!buffer || typeof buffer.byteLength !== "number")) {
            relayLogToStudio("⚠️ Receiver queueBinaryFrame: Rejected buffer (not ArrayBuffer / no byteLength)");
            return;
          }
          const targetReady =
            typeof frozenJitterTarget === "undefined" || !!frozenJitterTarget;
          if (workletNode && workletReady && targetReady) {
            const message = packet && packet.payload
              ? { type: "PCM_PACKET", payload: buffer, metadata: packet.metadata }
              : buffer;
            try {
              workletNode.port.postMessage(message, [buffer]);
            } catch (e) {
              workletNode.port.postMessage(message);
            }
            return;
          }

          if (pendingBinaryFrames.length >= PENDING_BINARY_FRAMES_MAX) {
            const queued = pendingBinaryFrames.splice(0);
            queued.push(packet);
            const droppedFrames = queued.reduce(
              (total, item) => total + Number(item && item.metadata && item.metadata.frameCount || 0),
              0,
            );
            pcmV2Telemetry.queueDroppedPackets += queued.length;
            pcmV2Telemetry.queueDroppedFrames += droppedFrames;
            pcmV2Telemetry.startupFallbackDroppedFrames += droppedFrames;
            pcmV2Telemetry.lastQueueDropReason = "pcm_startup_pending_overrun";
            relayLogToStudio(
              `⛔ Receiver: PCM startup gate exceeded ${PENDING_BINARY_FRAMES_MAX} packets; switching to native without silent PCM trimming.`,
            );
            const started = degradePcmStartupToNative("pcm_startup_pending_overrun");
            if (!started && binaryWS && binaryWS.readyState === WebSocket.OPEN) {
              try {
                binaryWS.send(JSON.stringify({
                  type: "PCM_RUNTIME_UNSUSTAINABLE",
                  reason: "pcm_startup_pending_overrun",
                  droppedFrames,
                  pendingPackets: queued.length,
                }));
              } catch (e) {}
            }
            return;
          }

          pendingBinaryFrames.push(packet);
        }

        function acceptFrozenJitterTarget(message) {
          const sessionId = String(message && message.sessionId || "");
          const targetFrames = Number(message && message.targetFrames);
          const targetWallMs = Number(message && message.targetWallMs);
          const drainHz = Number(message && message.drainHz);
          const estimatorLockedWhenFrozen = message && message.estimatorLockedWhenFrozen;
          if (
            !message ||
            message.type !== "PCM_V2_JITTER_TARGET" ||
            Object.keys(message).length !== 8 ||
            message.protocolVersion !== window.MXSPcmV2.VERSION ||
            message.frozen !== true ||
            sessionId.length === 0 ||
            !Number.isInteger(targetFrames) ||
            targetFrames <= 0 ||
            targetWallMs !== 450 ||
            !Number.isFinite(drainHz) ||
            drainHz < 16000 ||
            drainHz > 96000 ||
            typeof estimatorLockedWhenFrozen !== "boolean" ||
            Math.abs((targetFrames * 1000) / drainHz - targetWallMs) > 0.1
          ) {
            relayLogToStudio("Receiver rejected malformed PCM v2 jitter target.");
            return false;
          }
          // `wallHz` is a diagnostic AudioWorklet callback rate and may be
          // throttled on Chromecast/Cobalt. A frozen queue target must stay
          // in the authenticated AudioContext sample-rate domain so it cannot
          // accidentally turn a 48 kHz PCM session into a 31 kHz clock.
          // The validator is also exercised as a standalone protocol helper in
          // Node, outside the receiver IIFE where `audioCtx` is declared.
          // Keep that harness path safe while still preferring the live context
          // whenever the receiver runtime provides it.
          const liveAudioContext = typeof audioCtx !== "undefined" ? audioCtx : null;
          const receiverRate = Number(liveAudioContext && liveAudioContext.sampleRate || window._hwRate || 0);
          if (
            receiverRate > 0 &&
            Math.abs(drainHz - receiverRate) > 0.5
          ) {
            relayLogToStudio(
              `Receiver rejected non-nominal PCM v2 jitter target: ${drainHz}Hz; expected ${receiverRate}Hz.`,
            );
            return false;
          }
          if (
            expectedPcmSessionId !== null &&
            expectedPcmSessionId !== 0n &&
            sessionId !== expectedPcmSessionId.toString()
          ) {
            relayLogToStudio("Receiver rejected stale PCM v2 jitter target session.");
            return false;
          }
          if (frozenJitterTarget && frozenJitterTarget.sessionId === sessionId) {
            const unchanged =
              frozenJitterTarget.targetFrames === targetFrames &&
              frozenJitterTarget.targetWallMs === targetWallMs &&
              frozenJitterTarget.drainHz === drainHz &&
              frozenJitterTarget.estimatorLockedWhenFrozen === estimatorLockedWhenFrozen;
            if (!unchanged) {
              relayLogToStudio("Receiver rejected an audible PCM v2 jitter target change.");
            }
            return unchanged;
          }
          frozenJitterTarget = {
            type: "JITTER_TARGET",
            sessionId,
            targetFrames,
            targetWallMs,
            drainHz,
            estimatorLockedWhenFrozen,
          };
          if (workletNode && workletNode.port) {
            workletNode.port.postMessage(frozenJitterTarget);
          }
          if (typeof flushPendingBinaryFrames === "function") {
            flushPendingBinaryFrames();
          }
          relayLogToStudio(
            `PCM v2 jitter target frozen: ${targetWallMs}ms / ${targetFrames} frames @ ${drainHz.toFixed(2)}Hz.`,
          );
          return true;
        }

        function recordPcmV2QueueDrop(packet, reason) {
          pcmV2Telemetry.queueDroppedPackets++;
          pcmV2Telemetry.queueDroppedFrames += Number(
            packet && packet.metadata && packet.metadata.frameCount || 0,
          );
          pcmV2Telemetry.lastQueueDropReason = reason;
        }

        function flushPendingBinaryFrames() {
          if (!workletNode || !workletReady || pendingBinaryFrames.length === 0) return;
          const queued = pendingBinaryFrames.slice();
          pendingBinaryFrames.length = 0;
          queued.forEach((packet) => queueBinaryFrame(packet));
        }

        function validatePcmV2Packet(buffer) {
          pcmV2Telemetry.binaryPackets++;
          try {
            if (!window.MXSPcmV2) throw new Error("protocol_unavailable");
            const decoded = window.MXSPcmV2.decode(buffer);
            const header = decoded.header;
            window.MXSPcmV2.assertFormat(header, window.MXSPcmV2.OUTPUT_FORMAT);

            if (expectedPcmSessionId !== null && header.sessionId !== expectedPcmSessionId) {
              const staleError = new Error("stale_session");
              staleError.code = "stale_session";
              throw staleError;
            }

            if (pcmV2Validator && pcmV2Validator.sessionId !== header.sessionId) {
              if (header.sequence !== 0n || header.sourceFrame !== 0n) {
                const staleError = new Error("stale_session");
                staleError.code = "stale_session";
                throw staleError;
              }
              pcmV2Validator = null;
              pcmV2AllowInitialOffset = false;
              pcmV2Telemetry.sessionChanges++;
            }

            if (!pcmV2Validator) {
              pcmV2Validator = new window.MXSPcmV2.SequenceValidator(header.sessionId, {
                allowInitialOffset: pcmV2AllowInitialOffset,
              });
              pcmV2AllowInitialOffset = false;
              pcmV2Telemetry.sessionStarts++;
            }

            const receiverRate = audioCtx && audioCtx.sampleRate
              ? audioCtx.sampleRate
              : Number(window._hwRate || 0);
            if (receiverRate && header.sampleRate !== receiverRate) {
              const rateError = new Error("receiver_sample_rate_mismatch");
              rateError.code = "receiver_sample_rate_mismatch";
              throw rateError;
            }

            const continuity = pcmV2Validator.accept(header);
            if (continuity.baseline) {
              pcmV2Telemetry.baselineSequence = continuity.baselineSequence.toString();
              pcmV2Telemetry.baselineSourceFrame = continuity.baselineSourceFrame.toString();
            }
            if (continuity.sequenceGap > 0n) {
              pcmV2Telemetry.sequenceGapEvents++;
              pcmV2Telemetry.missingPackets += Number(continuity.sequenceGap);
            }
            if (continuity.sourceFrameGap > 0n) {
              pcmV2Telemetry.sourceFrameGapEvents++;
              pcmV2Telemetry.missingSourceFrames += Number(continuity.sourceFrameGap);
            }
            pcmV2Telemetry.receivedPackets++;
            pcmV2Telemetry.inputFrames += header.frameCount;
            return {
              payload: decoded.payload,
              metadata: {
                protocolVersion: header.version,
                sessionId: header.sessionId.toString(),
                sequence: header.sequence.toString(),
                sourceFrame: header.sourceFrame.toString(),
                frameCount: header.frameCount,
                sampleRate: header.sampleRate,
                captureTimeUs: header.captureTimeUs.toString(),
              },
            };
          } catch (error) {
            pcmV2Telemetry.rejectedPackets++;
            const code = error && error.code || error && error.message || "malformed";
            if (code === "duplicate_packet") pcmV2Telemetry.duplicates++;
            if (code === "out_of_order_packet") pcmV2Telemetry.outOfOrder++;
            if (code === "source_frame_regression") pcmV2Telemetry.sourceFrameRegressions++;
            if (code === "stale_session") pcmV2Telemetry.staleSession++;
            if (code === "sample_rate_change") pcmV2Telemetry.sampleRateChanges++;
            if (code === "receiver_sample_rate_mismatch") pcmV2Telemetry.receiverRateMismatches++;
            return null;
          }
        }

        function acceptPcmV2ProtocolConfig(config, source) {
          try {
            if (
              !config ||
              typeof config !== "object" ||
              Array.isArray(config) ||
              Object.keys(config).length !== 7 ||
              config.version !== window.MXSPcmV2.VERSION ||
              config.channels !== window.MXSPcmV2.CHANNELS ||
              config.ingressBitDepth !== window.MXSPcmV2.INPUT_FORMAT.bitDepth ||
              config.ingressFormat !== window.MXSPcmV2.INPUT_FORMAT.name ||
              config.outputBitDepth !== window.MXSPcmV2.OUTPUT_FORMAT.bitDepth ||
              config.outputFormat !== window.MXSPcmV2.OUTPUT_FORMAT.name
            ) {
              throw new Error("unsupported_protocol_config");
            }
            const sessionId = BigInt(config.sessionId);
            if (sessionId <= 0n) throw new Error("invalid_session");
            if (expectedPcmSessionId !== sessionId) {
              if (expectedPcmSessionId !== null && expectedPcmSessionId !== 0n) {
                pcmV2Telemetry.sessionChanges++;
              }
              expectedPcmSessionId = sessionId;
              frozenJitterTarget = null;
              pcmV2Validator = null;
              // The backend validates the sender from sequence zero, but the
              // direct receiver may join later after native-mode gating.
              pcmV2AllowInitialOffset = true;
              relayLogToStudio(
                `PCM v2 session configured: source=${source} session=${sessionId.toString()} version=${config.version}`,
              );
            }
            return true;
          } catch (error) {
            expectedPcmSessionId = 0n;
            pcmV2Validator = null;
            pcmV2AllowInitialOffset = false;
            relayLogToStudio(
              `Receiver rejected PCM v2 protocol config from ${source}: ${error.message}`,
            );
            return false;
          }
        }

        function getAudioContextTelemetry() {
          if (!audioCtx) return null;
          const outputTimestampSupported = typeof audioCtx.getOutputTimestamp === "function";
          let outputTimestamp = null;
          if (outputTimestampSupported) {
            try {
              const timestamp = audioCtx.getOutputTimestamp();
              if (timestamp) {
                outputTimestamp = {
                  contextTime: Number.isFinite(timestamp.contextTime)
                    ? timestamp.contextTime
                    : null,
                  performanceTime: Number.isFinite(timestamp.performanceTime)
                    ? timestamp.performanceTime
                    : null,
                };
              }
            } catch (error) {}
          }
          return {
            sampleRate: audioCtx.sampleRate,
            state: audioCtx.state,
            baseLatency: Number.isFinite(audioCtx.baseLatency) ? audioCtx.baseLatency : null,
            outputLatency: Number.isFinite(audioCtx.outputLatency) ? audioCtx.outputLatency : null,
            outputTimestampSupported,
            outputTimestamp,
            receiverPerformanceNowMs:
              typeof performance !== "undefined" && typeof performance.now === "function"
                ? performance.now()
                : null,
            receiverWallClockMs: Date.now(),
          };
        }

        function clearLegacyMediaStream() {
          const audioUnlocker = document.getElementById("audio-unlocker");
          if (audioUnlocker) {
            try {
              audioUnlocker.muted = true;
              audioUnlocker.pause();
            } catch (e) {}
            audioUnlocker.srcObject = null;
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
          if (!document.getElementById("gui-dialog-mirror-root")) {
            const dialogRoot = document.createElement("div");
            dialogRoot.id = "gui-dialog-mirror-root";
            dialogRoot.setAttribute("aria-hidden", "true");
            const studioRoot = document.getElementById("studio-root");
            if (studioRoot) studioRoot.appendChild(dialogRoot);
          }
          var g = document.getElementById("sample-grid");
          if (g) {
            g.innerHTML = "";
            for (var p = 1; p <= 20; p++) {
              var b = document.createElement("button");
              b.className = "sample-btn";
              b.id = "sample-" + p;
              b.dataset.sample = String(p);
              b.type = "button";
              b.setAttribute("aria-label", "Sample Pad " + p);
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
            t.dataset.trackIndex = String(i);
            t.innerHTML = `
                        <div class="track-header">TRACK ${i + 1}</div>
                        <div class="track-time-display" id="t-time-${i}">00:00:00</div>
                        <div class="status-indicator status-ready" id="t-st-${i}"><div class="scrolling-text-wrapper"><span class="scrolling-text" id="t-scroll-${i}">Ready</span></div></div>
                        <div class="waveform-box"><div class="waveform-labels"><div class="waveform-label-external">L</div><div class="waveform-label-external">R</div></div><div class="waveform-canvas-container"><canvas class="waveform-canvas track-waveform-canvas-L" id="t-wf-l-${i}" width="238" height="26"></canvas><canvas class="waveform-canvas track-waveform-canvas-R" id="t-wf-r-${i}" width="238" height="26"></canvas><div class="loop-marker loop-start-marker" id="t-ls-m-${i}"></div><div class="loop-marker loop-end-marker" id="t-le-m-${i}"></div><div class="play-marker" id="t-playhead-${i}"></div></div></div>
                        <div class="control-group"><div class="track-input-layout"><label style="font-size: 0.72em;">Input</label><select id="t-input-${i}" class="input-source app-select"><option value="mic">Microphone</option><option value="file">Import File</option><option value="system">System Loopback</option></select></div><span class="file-name-display" id="t-file-${i}"></span></div>
                        <div class="control-group pa-mic-adjustment" id="t-gain-grp-${i}" style="display: flex;"><label style="font-size: 0.72em;">Input Gain</label><input type="range" class="pa-mic-slider" id="t-gain-sl-${i}" min="-48" max="48" step="0.1"><span class="pa-mic-value" id="t-gain-val-${i}" style="font-size: 0.72em;">0.0 dB</span></div>
                        <div class="track-buttons"><button id="t-rec-${i}">REC</button><button id="t-stop-${i}">STOP</button><button id="t-play-${i}">PLAY</button><button id="t-rev-${i}">REV</button></div>
                        <div class="loop-controls active" id="t-loop-ctrl-${i}" style="display: flex; opacity: 1;"><div class="loop-grid-layout"><div class="loop-line-1" style="display: flex; width: 100%; gap: 4px;"><div style="flex: 1; display: flex; align-items: center; justify-content: flex-start;"><label style="font-size: 0.72em;">Loop Start</label></div><div style="flex: 1; display: flex; align-items: center; justify-content: space-between;"><label style="font-size: 0.72em;">Loop End</label><button class="slice-trigger-btn"><i class="fa-solid fa-scissors"></i></button></div></div><div class="loop-line-2 slider-wrapper"><input type="range" class="loop-start-slider" id="t-ls-sl-${i}" min="0" max="1" step="0.01"><input type="range" class="loop-end-slider" id="t-le-sl-${i}" min="0" max="1" step="0.01"></div><div class="loop-line-3"><span class="param-value" id="t-ls-val-${i}">0.00s</span><span class="param-value" id="t-le-val-${i}">1.00s</span></div></div></div>
                        <div class="fx-chain-container"><div class="fx-chain-title">Effects Chain:</div><div class="fx-chain-controls"><button id="t-fx-left-${i}" class="fx-chain-arrow">&lt;</button>${[0, 1, 2, 3, 4, 5, 6].map((idx) => `<div class="fx-chain-slot"><input type="checkbox" id="t-fx-chk-${i}-${idx}"><label class="fx-chain-slot-label" id="t-fx-lbl-${i}-${idx}">${idx + 1}</label></div>`).join("")}<button id="t-fx-right-${i}" class="fx-chain-arrow">&gt;</button></div></div>
                        <div class="control-group track-bottom-layout"><label class="margin-0">Effects:</label><select id="t-effect-select-${i}" class="effect-type-select app-select flex-1-no-margin"></select></div>
                        <div class="main-controls">${KNOB_CONFIGS.map((cfg) => `<div class="knob-container"><div class="knob-label-group"><label>${cfg.l}</label><span class="param-value" id="t-${cfg.p}-val-${i}">0</span><input type="checkbox" class="lfo-assign" id="t-lfo1-chk-${i}-${cfg.p}" data-lfo-assign="${cfg.p}" data-lfo-index="1"><input type="checkbox" class="lfo-assign lfo2-assign" id="t-lfo2-chk-${i}-${cfg.p}" data-lfo-assign="${cfg.p}" data-lfo-index="2"></div><div class="slider-wrapper"><input type="range" id="t-${cfg.p}-sl-${i}" class="pa-mic-slider"></div></div>`).join("")}</div>`;
            grid.appendChild(t);
          }
          updateScale();
        }

        function prepareReceiverUi() {
          markReceiverBoot("receiver_script_loaded");
          reportReceiverRuntimeCapabilities();
          const studioRoot = document.getElementById("studio-root");
          if (studioRoot) {
            studioRoot.dataset.guiContractVersion = "2";
            studioRoot.dataset.guiAudioPath = "pcm-native-locked";
          }
          bindReceiverGuiInteractions();
          markReceiverBoot("gui_structurally_ready");
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
          // Keep the audio graph lazy until we actually need PCM fallback.
          // Native-first sessions should not force a low-rate context probe.
          if (window._receiverShutdownInProgress) return;

          relayLogToStudio("🛠️ Receiver: preInitAudioContext called. audioCtx=" + !!audioCtx);
          if (audioCtx && audioCtx.state === "closed") {
            // A failed AudioWorklet startup can leave a closed context behind.
            // Never let the next bounded retry reuse that dead context: Chromium
            // reports the resulting addModule failure as a misleading AbortError.
            relayLogToStudio("⚠️ Receiver: Discarding closed AudioContext before PCM startup retry.");
            audioCtx = null;
            masterGain = null;
          }
          if (!audioCtx) {
            try {
              relayLogToStudio("🛠️ Receiver: Creating new AudioContext (hardware fast-path)...");
              audioCtx = new (window.AudioContext || window.webkitAudioContext)();
              window._hwRate = audioCtx.sampleRate || 48000;
              window._lastHwRate = window._hwRate;
              relayLogToStudio("🛠️ Receiver: AudioContext created. State: " + audioCtx.state + " | Rate: " + window._hwRate);
              relayLogToStudio(
                "✅ Receiver hardware fast-path active: " +
                  JSON.stringify({
                    event: "receiver_hardware_fast_path_active",
                    audioContextOptions: "none",
                    sampleRate: window._hwRate,
                    buildIdentity: window.MXS_BUILD_IDENTITY || null,
                  }),
              );
            } catch (e) {
              relayLogToStudio(`❌ Receiver ERROR: Failed to create AudioContext - ${e.message}`);
              return;
            }
          }

          if (audioCtx && !masterGain) {
            try {
              masterGain = audioCtx.createGain();
              masterGain.gain.value = 1.0;
              masterGain.connect(audioCtx.destination);
              relayLogToStudio("🛠️ Receiver: masterGain connected.");

              const keepAlive = audioCtx.createOscillator();
              keepAlive.frequency.value = Math.min(12000, Math.floor((audioCtx.sampleRate || 48000) * 0.25));
              const g = audioCtx.createGain();
              g.gain.value = 0.00001;
              keepAlive.connect(g);
              g.connect(audioCtx.destination);
              keepAlive.start();
              relayLogToStudio("🛠️ Receiver: keepAlive oscillator started.");
            } catch (e) {
              relayLogToStudio(`❌ Receiver ERROR: Failed to configure audio graph - ${e.message}`);
            }
          }

          const audioUnlocker = document.getElementById("audio-unlocker");
          relayLogToStudio("🛠️ Receiver: audioUnlocker found: " + !!audioUnlocker);
          if (audioUnlocker) {
            if (!audioUnlocker._hasUnlockListeners) {
              audioUnlocker._hasUnlockListeners = true;
              audioUnlocker.addEventListener("play", function () {
                resumeAudio();
              });
              audioUnlocker.addEventListener("playing", function () {
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
              audioUnlocker.play().catch(function (e) {
                relayLogToStudio("⚠️ Receiver: play silent WAV failed - " + e.message);
              });
            } else {
              relayLogToStudio("📡 Receiver: Skipping audioUnlocker play in Cast mode; custom PCM AudioWorklet owns playout.");
            }
          }

          resumeAudio();
        }

        let lastInitAttempt = 0;
        let lastFailedInitAttemptAt = 0;
        let audioInitializing = false;
        // Cast lifecycle, unlock, and PCM startup can all request resume at
        // once. Share one promise per AudioContext so addModule never races
        // several resume calls during receiver startup.
        let audioResumePromise = null;
        function initAudio(force = false, preserveNativeMode = false) {
          if (!identityAllowsAudio()) {
            relayLogToStudio("⛔ Receiver: Audio startup blocked until build identity is verified.");
            return null;
          }
          if (window._receiverShutdownInProgress) return null;
          if (workletInitPromise) return workletInitPromise;
          if (nativeStreamActive || workletNode) {
            return null;
          }
          if (!preserveNativeMode && (nativeStreamStarting || window._playbackMode === "native")) {
            return null;
          }
          // The PCM AudioWorklet is the primary live-sync playout path.
          // Native /stream.wav remains available as a fallback if PCM cannot
          // initialize or later degrades.
          // [v13.9.504] HARDWARE LOCK: Never initialize until we have a verified sample rate from the Studio.
          if (!configReceived) {
            relayLogToStudio("⏳ Receiver: Waiting for BRIDGE_CONFIG handshake...");
            return null;
          }

          // [v13.9.504] THROTTLE: Prevent tight-loop retries if init fails (e.g. 404 or SyntaxError)
          const now = Date.now();
          if (!force && now - lastFailedInitAttemptAt < 5000) return null;
          lastInitAttempt = now;

          const initGeneration = workletLifecycleGeneration;
          audioInitializing = true;
          const initPromise = (async function initializeWorklet() {
            try {
              if (!preserveNativeMode) {
                relayLogToStudio("🛠️ Receiver: PCM bridge initializing; playback mode will advertise after worklet CONFIG.");
              } else {
                relayLogToStudio("🛠️ Receiver: PCM bridge initializing while native stream boots.");
              }
              preInitAudioContext();

              if (!audioCtx) {
                relayLogToStudio("❌ Receiver ERROR: initAudio failed - audioCtx is null");
                lastFailedInitAttemptAt = Date.now();
                return false;
              }

              if (!audioCtx.audioWorklet || typeof audioCtx.audioWorklet.addModule !== "function") {
                throw new Error("AudioWorklet API unavailable");
              }
              if (!masterGain) {
                throw new Error("PCM audio graph sink unavailable");
              }

              if (workletNode) {
                return true;
              }

            let workletUrl = "pcm-player-worklet-v13.9.509.js";
            // The hosted receiver is HTTPS, so an HTTP Studio bridge is mixed
            // content and Chromecast/Cobalt reports its AudioWorklet rejection
            // as the misleading `AbortError`. Only use the bridge on local HTTP
            // receiver sessions; hosted receivers must load the same-origin,
            // versioned worklet over HTTPS.
            const receiverProtocol = String(window.location && window.location.protocol || "").toLowerCase();
            const canUseHttpBridge = receiverProtocol === "http:";
            if (canUseHttpBridge && currentBridgeIp && currentBridgePort) {
              const port = currentBridgePort || "8080";
              workletUrl = `http://${currentBridgeIp}:${port}/receiver/${workletUrl}`;
              relayLogToStudio(`📡 Receiver: Loading Worklet from Studio: ${workletUrl}`);
            } else {
              if (currentBridgeIp && currentBridgePort && !canUseHttpBridge) {
                relayLogToStudio(
                  `🔒 Receiver: Ignoring HTTP Studio worklet bridge on ${receiverProtocol || "unknown"} page; using same-origin worklet.`,
                );
              }
              relayLogToStudio(`📡 Receiver: Loading Worklet relatively: ${workletUrl}`);
            }

            // Decide AudioWorklet support once per AudioContext using a tiny,
            // same-origin module. A failed capability probe selects native
            // playout immediately; retrying Blob/versioned/unversioned copies
            // of the same production code only lengthens the Play critical path.
            await resumeAudio();
            if (audioCtx.state !== "running") {
              throw new Error("AudioContext did not reach running state before PCM module load");
            }

            const capability = await probeAudioWorkletCapability(audioCtx);
            if (!capability || !capability.supported) {
              const capabilityError = new Error(
                "AudioWorklet capability probe failed: " +
                  (capability && capability.reason ? capability.reason : "unknown"),
              );
              capabilityError.name = "AudioWorkletCapabilityError";
              throw capabilityError;
            }

            // Always resolve to an absolute URL because some TV/embedded browsers (Cobalt)
            // fail/abort if the URL passed to addModule() is relative.
            const absWorkletUrl = new URL(workletUrl, window.location.href).href;
            async function preflightWorkletModule(url, label) {
              if (typeof fetch !== "function") {
                relayLogToStudio(`⚠️ Receiver: Worklet preflight unavailable; continuing with ${label} addModule().`);
                return;
              }
              try {
                const response = await fetch(url, {
                  cache: "no-store",
                  credentials: "same-origin",
                });
                const contentType = String(response.headers && response.headers.get
                  ? response.headers.get("content-type") || ""
                  : "").toLowerCase();
                const bytes = await response.arrayBuffer();
                relayLogToStudio(
                  `🧪 Receiver: Worklet preflight ${label}: status=${response.status} ok=${response.ok} contentType=${contentType || "unknown"} bytes=${bytes.byteLength} url=${url}`,
                );
                if (!response.ok) {
                  throw new Error(`${label} HTTP ${response.status}`);
                }
                if (/text\/html/i.test(contentType)) {
                  throw new Error(`${label} returned HTML instead of JavaScript`);
                }
              } catch (preflightError) {
                relayLogToStudio(
                  `❌ Receiver: Worklet preflight failed for ${label}: ${preflightError && preflightError.message ? preflightError.message : preflightError}`,
                );
                throw preflightError;
              }
            }

            relayLogToStudio(`📡 Receiver: Preflighting PCM worklet module: ${absWorkletUrl}`);
            await preflightWorkletModule(absWorkletUrl, "versioned");
            const productionStartedAt = Date.now();
            try {
              notifyPlayoutSelecting("production_module", "capability_probe_passed");
              relayLogToStudio(`📡 Receiver: Adding verified versioned PCM worklet directly: ${absWorkletUrl}`);
              await withWorkletTimeout(
                audioCtx.audioWorklet.addModule(absWorkletUrl),
                WORKLET_PRODUCTION_TIMEOUT_MS,
                "PCM production worklet",
              );
              reportWorkletCapability({
                supported: true,
                stage: "production_same_origin_module",
                reason: "production_loaded",
                elapsedMs: Date.now() - productionStartedAt,
                url: absWorkletUrl,
              });
            } catch (productionError) {
              reportWorkletCapability({
                supported: false,
                stage: "production_same_origin_module",
                reason: "production_rejected",
                elapsedMs: Date.now() - productionStartedAt,
                error: describeWorkletError(productionError),
                url: absWorkletUrl,
              });
              throw productionError;
            }

            if (
              initGeneration !== workletLifecycleGeneration ||
              window._receiverShutdownInProgress
            ) {
              return false;
            }

            // The Rust backend handles authoritative resampling (Studio -> TV);
            // the receiver worklet operates at unity rate.
            const studioRate = window._studioRate || 48000;
            const actualRate = audioCtx.sampleRate;
            const requestedRate = window._lastHwRate || window._hwRate || 48000;
            const negotiatedBitDepth = 16;

            console.log(
              `📏 Receiver Clock: receiverRate=${requestedRate}Hz actual=${actualRate}Hz | Studio: ${studioRate}Hz | Unity Sync Active`,
            );
            relayLogToStudio(
              `📏 Receiver Clock: ${actualRate}Hz | Studio: ${studioRate}Hz | Sync: APORv2 Unity`,
            );

            workletNode = new AudioWorkletNode(
              audioCtx,
              "pcm-player-worklet",
              {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [2],
                processorOptions: {
                  studioRate: studioRate,
                  bitDepth: negotiatedBitDepth,
                },
              },
            );
            workletInitializationCount += 1;
            workletNode.onprocessorerror = (e) => {
              console.error("❌ Receiver: workletNode processor error:", e);
              relayLogToStudio(`❌ Receiver: workletNode processor error: ${e.message || e}`);
            };
            workletNode.connect(masterGain);
            window._lastWorkletDiagTime = Date.now(); // Prevent premature watchdog triggers during startup

            revealReceiverUi("worklet_ready");

            relayLogToStudio(`✅ Receiver sink active @ ${actualRate}Hz`);

            workletNode.port.onmessage = (e) => {
              if (e.data.type === "DIAG") {
                window._lastWorkletDiagTime = Date.now();
                monitorPcmRuntimeHealth(e.data);

                if (binaryWS && binaryWS.readyState === WebSocket.OPEN) {
                  binaryWS.send(
                    JSON.stringify({
                      type: "DIAG",
                      available: e.data.available,
                      stalled: e.data.stalled,
                        measuredHz: e.data.measuredHz,
                        wallHz: e.data.wallHz,
                        callbackWallMs: e.data.callbackWallMs,
                        callbackFrames: e.data.callbackFrames,
                        callbackWallHz: e.data.callbackWallHz,
                        audioClockSampleRate: e.data.audioClockSampleRate,
                        audioClockFrames: e.data.audioClockFrames,
                        audioClockTimeSeconds: e.data.audioClockTimeSeconds,
                        audioClockDeltaMs: e.data.audioClockDeltaMs,
                        queueDeltaFrames: e.data.queueDeltaFrames,
                        queueGrowthFramesPerSecond: e.data.queueGrowthFramesPerSecond,
                        rate: e.data.rate,
                      peak: e.data.peak,
                      locked: e.data.locked,
                      protocolVersion: window.MXSPcmV2 ? window.MXSPcmV2.VERSION : null,
                      sessionId: e.data.lastPacket && e.data.lastPacket.sessionId || null,
                      receiver: { ...pcmV2Telemetry },
                      worklet: {
                        outputFrames: e.data.outputFrames,
                        renderedFrames: e.data.renderedFrames,
                        silenceFrames: e.data.silenceFrames,
                        droppedFrames: e.data.droppedFrames,
                        queuedFrames: e.data.queuedFrames,
                        controlQueuedFrames: e.data.controlQueuedFrames,
                        rawQueuedFrames: e.data.rawQueuedFrames,
                        buffering: e.data.buffering,
                        targetSessionId: e.data.targetSessionId,
                        targetLocked: e.data.targetLocked,
                        targetWallMs: e.data.targetWallMs,
                        targetToleranceMs: e.data.targetToleranceMs,
                        targetFrames: e.data.targetFrames,
                        targetDrainHz: e.data.targetDrainHz,
                        targetEstimatorLockedWhenFrozen: e.data.targetEstimatorLockedWhenFrozen,
                        crossfadeLengthFrames: e.data.crossfadeLengthFrames,
                        crossfadeWallMs: e.data.crossfadeWallMs,
                        queueWallMs: e.data.queueWallMs,
                        queueErrorMs: e.data.queueErrorMs,
                        rawQueueWallMs: e.data.rawQueueWallMs,
                        rawQueueErrorMs: e.data.rawQueueErrorMs,
                        queueControlFilterMs: e.data.queueControlFilterMs,
                        targetAcquired: e.data.targetAcquired,
                        targetAdherenceSamples: e.data.targetAdherenceSamples,
                        targetWithinToleranceSamples: e.data.targetWithinToleranceSamples,
                        targetAdherencePercent: e.data.targetAdherencePercent,
                        rawTargetAdherenceSamples: e.data.rawTargetAdherenceSamples,
                        rawTargetWithinToleranceSamples: e.data.rawTargetWithinToleranceSamples,
                        rawTargetAdherencePercent: e.data.rawTargetAdherencePercent,
                        targetConfigAccepts: e.data.targetConfigAccepts,
                        targetConfigRejects: e.data.targetConfigRejects,
                        startupPrebuffers: e.data.startupPrebuffers,
                        startupSettleMs: e.data.startupSettleMs,
                        startupAlignmentRequired: e.data.startupAlignmentRequired,
                        startupSettleFramesRemaining: e.data.startupSettleFramesRemaining,
                        startupAlignments: e.data.startupAlignments,
                        startupAlignmentDroppedFrames: e.data.startupAlignmentDroppedFrames,
                        startupWatermarkLowMs: e.data.startupWatermarkLowMs,
                        startupWatermarkHighMs: e.data.startupWatermarkHighMs,
                        startupWatermarkTrims: e.data.startupWatermarkTrims,
                        startupWatermarkDroppedFrames: e.data.startupWatermarkDroppedFrames,
                        queueLowWatermarkMs: e.data.queueLowWatermarkMs,
                        queueHighWatermarkMs: e.data.queueHighWatermarkMs,
                        queueHighWatermarkActive: e.data.queueHighWatermarkActive,
                        queueHighWatermarkEvents: e.data.queueHighWatermarkEvents,
                        intentionalResets: e.data.intentionalResets,
                        intentionalResetDroppedFrames: e.data.intentionalResetDroppedFrames,
                        underruns: e.data.underruns,
                        emergencyOverruns: e.data.emergencyOverruns,
                        emergencyFailures: e.data.emergencyFailures,
                        emergencyRecoveries: e.data.emergencyRecoveries,
                        emergencyCursorJumps: e.data.emergencyCursorJumps,
                        emergencyDroppedFrames: e.data.emergencyDroppedFrames,
                        qualityRunFailed: e.data.qualityRunFailed,
                        lastEmergencyReason: e.data.lastEmergencyReason,
                        crossfadeKind: e.data.crossfadeKind,
                        crossfadesStarted: e.data.crossfadesStarted,
                        crossfadesCompleted: e.data.crossfadesCompleted,
                        crossfadeFrames: e.data.crossfadeFrames,
                        crossfadeMaxSampleStep: e.data.crossfadeMaxSampleStep,
                        resets: e.data.resets,
                        lifecycleGeneration: workletLifecycleGeneration,
                        initializations: workletInitializationCount,
                        hardTeardowns: workletHardTeardownCount,
                        queueResets: workletQueueResetCount,
                        currentFrame: e.data.currentFrame,
                        audioCurrentTimeSeconds: e.data.audioCurrentTimeSeconds,
                        wallClockMs: e.data.wallClockMs,
                      },
                      audioContext: getAudioContextTelemetry(),
                    }),
                  );
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
                    `📊 Receiver STATUS: ${lockStatus} @ ${rate}x (BUF: ${e.data.available}${hzInfo} | PEAK: ${peakPercent}% | STALLS: ${e.data.stalled})`,
                  );
                  window._lastDiagSent = Date.now();
                }
              } else if (e.data.type === "TARGET_CONFIGURED") {
                relayLogToStudio(
                  `Worklet confirmed frozen jitter target: ${e.data.targetWallMs}ms / ${e.data.targetFrames} frames.`,
                );
              } else if (e.data.type === "LOG") {
                if (
                  typeof e.data.msg === "string" &&
                  e.data.msg.indexOf("Worklet message: CONFIG") !== -1 &&
                  !workletReady
                ) {
                  window._isDrainingStartup = false;
                  workletReady = true;
                  pendingStartupTrimLogged = false;
                  lowLatencyStartupRetryCount = 0;
                  pcmRuntimeHighWatermarkDiagnostics = 0;
                  pcmRuntimeNativeFallbacks = 0;
                  clearLowLatencyStartupWatchdog();
                  const pcmMayOwnAudio =
                    !nativeStreamActive &&
                    !nativeStreamStarting &&
                    window._playbackMode !== "native";
                  if (pcmMayOwnAudio) {
                    flushPendingBinaryFrames();
                    setActiveAudioPathOwner("pcm_v2", "worklet_ready");
                    notifyPlaybackMode("pcm_fallback", "worklet_ready");
                    relayLogToStudio("✅ Receiver: Live PCM playout active.");
                  } else {
                    relayLogToStudio(
                      "✅ Receiver: PCM worklet ready as standby; native playout retains ownership.",
                    );
                  }
                }
                relayLogToStudio(e.data.msg);
              }
            };
            if (frozenJitterTarget) {
              workletNode.port.postMessage(frozenJitterTarget);
            }
            workletNode.port.postMessage({
              type: "CONFIG",
              bitDepth: negotiatedBitDepth,
            });
            relayLogToStudio(
              `🔧 Receiver: Worklet configured for ${negotiatedBitDepth}-bit decode`,
            );
            resumeAudio();
            return true;
            } catch (e) {
              const staleInitialization =
                initGeneration !== workletLifecycleGeneration ||
                window._receiverShutdownInProgress;
              if (workletNode) {
                try {
                  workletNode.disconnect();
                } catch (disconnectError) {}
                workletNode = null;
              }
              workletReady = false;
              if (staleInitialization) {
                relayLogToStudio(
                  "⚠️ Receiver: Ignored stale PCM startup failure after teardown.",
                );
                return false;
              }
              lastFailedInitAttemptAt = Date.now();
              relayLogToStudio(`❌ Receiver ERROR: initAudio failed - ${e.message}`);
              if (!preserveNativeMode && receiverPlayoutPreference === "pcm_fallback") {
                const fallbackReason =
                  e && e.name === "AudioWorkletCapabilityError"
                    ? "audio_worklet_capability_unavailable"
                    : isPcmStartupAbortError(e)
                      ? "pcm_worklet_abort"
                      : "pcm_worklet_initialization_failed";
                teardownPcmPlayout(fallbackReason, true);
                workletInitPromise = null;
                relayLogToStudio(
                  "⚠️ Receiver: PCM capability decision is final for this session; selecting native without module retries.",
                );
                degradePcmStartupToNative(fallbackReason);
              }
              return false;
            }
          })();
          workletInitPromise = initPromise;
          const clearInitState = function clearInitState() {
            if (workletInitPromise === initPromise) {
              workletInitPromise = null;
              audioInitializing = false;
            }
          };
          initPromise.then(clearInitState, clearInitState);
          return initPromise;
        }

        function showUnlockOverlay() {
          // [v13.9.505] Disabled visual overlay so the GUI is never blocked.
          // Suspended context auto-unlock runs in the background.
        }

        function hideUnlockOverlay() {
          const overlay = document.getElementById("audio-unlock-overlay");
          if (overlay && overlay.classList.contains("visible")) {
            overlay.classList.remove("visible");
            relayLogToStudio("🖥️ Receiver: Audio Unlock Overlay hidden.");
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
          try {
            // Check for statically declared Cast media element first
            let castMediaElement = document.getElementById("cast-media-element");
            
            // Fallback: use recursive shadow root traverser
            if (!castMediaElement) {
              castMediaElement = findMediaElement(document);
            }

            if (castMediaElement) {
              // Keep the CAF media element out of the Web Audio graph.
              // Connecting media elements to the graph forced Chromium to sync
              // decoding and audio rendering, which throttled the worklet thread.
              if (!castMediaElement._cafMediaElementLogged) {
                castMediaElement._cafMediaElementLogged = true;
                relayLogToStudio("🛠️ Receiver: Cast media element present; keeping CAF playback offline from Web Audio.");
              }
              if (castMediaElement.crossOrigin !== "anonymous") {
                castMediaElement.crossOrigin = "anonymous";
              }
            }
          } catch (e) {
            relayLogToStudio("⚠️ Receiver: connectCastMediaElement error: " + e.message);
          }
        }

        async function resumeAudio() {
          if (window._receiverShutdownInProgress) return;
          const context = audioCtx;
          if (!context) return;
          if (context.state === "running") {
            hideUnlockOverlay();
            return;
          }
          if (audioResumePromise) {
            return audioResumePromise;
          }

          connectCastMediaElement();
          const resumePromise = (async function resumeCurrentAudioContext() {
            const prevState = context.state;
            try {
              relayLogToStudio("🔊 Receiver: resumeAudio() calling audioCtx.resume(). State: " + prevState);
              await context.resume();
              relayLogToStudio("🔊 Receiver: resumeAudio() resolved. State: " + context.state);
              if (audioCtx === context && context.state === "running") {
                hideUnlockOverlay();
              } else {
                showUnlockOverlay();
              }
            } catch (e) {
              console.warn("⚠️ Receiver: Resume failed", e);
              relayLogToStudio("⚠️ Receiver: resumeAudio() failed: " + e.message);
              showUnlockOverlay();
            }
          })();
          audioResumePromise = resumePromise;
          try {
            return await resumePromise;
          } finally {
            if (audioResumePromise === resumePromise) {
              audioResumePromise = null;
            }
          }
        }

        async function playSineTest() {
          if (window._receiverShutdownInProgress) return;
          if (!audioCtx) {
            await initAudio();
          }
          if (!audioCtx) {
            relayLogToStudio("⚠️ Receiver: Sine test skipped; audio context not ready.");
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

        let lastHighFreqLogTime = 0;
        function relayLogToStudio(msg) {
          const isHighFreq =
            msg.indexOf("Latency Catch-up") !== -1 ||
            msg.indexOf("Callback Rate") !== -1 ||
            msg.indexOf("Receiver Feedback") !== -1 ||
            msg.indexOf("Receiver STATUS") !== -1;
          if (isHighFreq) {
            const now = Date.now();
            if (now - lastHighFreqLogTime < 10000) {
              return; // Throttle: Skip both DOM rendering and WS broadcasting
            }
            lastHighFreqLogTime = now;
          }
          const isCriticalDuringPcm =
            msg.indexOf("❌") !== -1 ||
            msg.indexOf("⚠️") !== -1 ||
            msg.indexOf("⛔") !== -1 ||
            msg.indexOf("jitter target") !== -1 ||
            msg.indexOf("fallback") !== -1 ||
            msg.indexOf("PLAYBACK") !== -1 ||
            msg.indexOf("PCM") !== -1;
          if (pcmAudioPriorityActive && !isHighFreq && !isCriticalDuringPcm) {
            pcmV2Telemetry.pcmAudioPrioritySuppressedLogs++;
            return;
          }
          if (!isHighFreq) {
            const debugLevel =
              msg.indexOf("❌") !== -1
                ? "error"
                : msg.indexOf("⚠️") !== -1
                  ? "warn"
                  : msg.indexOf("✅") !== -1 || msg.indexOf("📡") !== -1 || msg.indexOf("🤝") !== -1
                    ? "info"
                    : "debug";
              writeCastDebug(debugLevel, msg);
          }
          // [v13.9.504] Suppress DOM updates during active streaming to reduce Receiver CPU overhead
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
          let sent = trySendLogToStudio(msg);
          if (!sent && !isHighFreq) {
            pendingStudioLogQueue.push(msg);
            if (pendingStudioLogQueue.length > 100) {
              pendingStudioLogQueue.shift();
            }
          }
          if (sent) {
            flushPendingStudioLogs();
          }
        }

        function trySendLogToStudio(msg) {
          if (!receiverHandshakeTelemetryReady) {
            return false;
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
              const context = getCastReceiverContext();
              if (context) {
                const senders = context.getSenders();
                if (senders.length > 0) {
                  context.sendCustomMessage(CUSTOM_NAMESPACE, senders[0].id, {
                    type: "LOG",
                    msg: msg,
                  });
                  sent = true;
                }
              }
            } catch (e) {}
          }

          // [v13.9.504] ULTIMATE FALLBACK: HTTP Beacon (Log Server)
          if (!sent) {
            const pageHost = window.location.hostname;
            const pageHostIsStudio =
              pageHost === "localhost" ||
              pageHost === "127.0.0.1" ||
              /^\d{1,3}(?:\.\d{1,3}){3}$/.test(pageHost);
            const targetIp =
              currentBridgeIp ||
              (pageHostIsStudio ? pageHost : null);
            if (targetIp) {
              const port =
                currentBridgePort ||
                (window.SERVER_PORT && !window.SERVER_PORT.startsWith("{{")
                  ? window.SERVER_PORT
                  : "8080");
              const url = "http://" + targetIp + ":" + port + "/log?m=" + encodeURIComponent(msg);
              try {
                if (navigator.sendBeacon) {
                  sent = navigator.sendBeacon(url);
                } else {
                  fetch(url).catch(() => {});
                  sent = true;
                }
              } catch (e) {}
            }
          }

          return sent;
        }

        function flushPendingStudioLogs() {
          if (flushingPendingStudioLogs || pendingStudioLogQueue.length === 0) {
            return;
          }
          flushingPendingStudioLogs = true;
          try {
            const queuedLogs = pendingStudioLogQueue.slice();
            pendingStudioLogQueue = [];
            queuedLogs.forEach(function (msg) {
              if (!trySendLogToStudio(msg)) {
                pendingStudioLogQueue.push(msg);
              }
            });
            if (pendingStudioLogQueue.length > 100) {
              pendingStudioLogQueue = pendingStudioLogQueue.slice(-100);
            }
          } finally {
            flushingPendingStudioLogs = false;
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
        function updateButtonState(id, buttonState) {
          const el = getEl(id);
          if (!el || !buttonState) return;
          const cacheKey = "button:" + id;
          const stateKey = JSON.stringify(buttonState);
          if (valCache[cacheKey] !== stateKey) {
            el.classList.toggle("active", !!buttonState.active);
            el.classList.toggle("playing", !!buttonState.active);
            el.classList.toggle(
              "recording",
              !!buttonState.active && id.indexOf("rec") >= 0,
            );
            el.classList.toggle("mirrored-active", !!buttonState.active);
            el.dataset.mirroredState = buttonState.active ? "active" : "idle";
            el.setAttribute("aria-pressed", buttonState.pressed ? "true" : "false");
            valCache[cacheKey] = stateKey;
          }
          el.disabled = !!buttonState.disabled;
          el.setAttribute("aria-disabled", buttonState.disabled ? "true" : "false");
        }

        function drawMirroredWaveform(id, waveform) {
          const canvas = getEl(id);
          if (!canvas || !waveform || !Array.isArray(waveform.points)) return;
          const signature = JSON.stringify(waveform);
          const cacheKey = "waveform:" + id;
          if (valCache[cacheKey] === signature) return;
          valCache[cacheKey] = signature;
          const width = canvas.clientWidth || Number(canvas.getAttribute("width")) || 238;
          const height = canvas.clientHeight || Number(canvas.getAttribute("height")) || 26;
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
          }
          const context = canvas.getContext("2d");
          if (!context) return;
          context.clearRect(0, 0, width, height);
          context.strokeStyle = waveform.active ? "#d4af37" : "rgba(68, 68, 68, 0.5)";
          context.fillStyle = waveform.active ? "rgba(212, 175, 55, 0.14)" : "transparent";
          context.lineWidth = 1.25;
          if (!waveform.points.length) {
            context.beginPath();
            context.moveTo(0, height / 2);
            context.lineTo(width, height / 2);
            context.stroke();
            return;
          }
          context.beginPath();
          waveform.points.forEach((point, index) => {
            const x = (index / Math.max(1, waveform.points.length - 1)) * width;
            const min = Math.max(-1, Math.min(1, Number(point?.[0]) || 0));
            const max = Math.max(-1, Math.min(1, Number(point?.[1]) || 0));
            const yTop = ((1 - max) * height) / 2;
            const yBottom = ((1 - min) * height) / 2;
            context.moveTo(x, yTop);
            context.lineTo(x, yBottom);
          });
          context.stroke();
          if (waveform.active) {
            context.globalAlpha = 0.7;
            context.fill();
            context.globalAlpha = 1;
          }
        }

        function updateMirroredPlayhead(id, position) {
          const value = `${Math.max(0, Math.min(1, Number(position) || 0)) * 100}%`;
          updateStyleLeft(id, value);
        }

        function updateEffectOptions(id, options, selected) {
          const select = getEl(id);
          if (!select || !Array.isArray(options) || !options.length) return;
          const signature = JSON.stringify(options);
          const cacheKey = "effect-options:" + id;
          if (valCache[cacheKey] !== signature) {
            select.replaceChildren();
            options.forEach((option) => {
              const item = document.createElement("option");
              item.value = String(option);
              item.textContent = String(option) === "none" ? "None" : String(option);
              select.appendChild(item);
            });
            valCache[cacheKey] = signature;
          }
          if (selected !== undefined && selected !== null && select.value !== String(selected)) {
            select.value = String(selected);
          }
        }

        let lastDialogMirrorState = "";
        function renderDialogMirrors(dialogs) {
          const root = getEl("gui-dialog-mirror-root");
          if (!root) return;
          const list = Array.isArray(dialogs) ? dialogs : [];
          const signature = JSON.stringify(list);
          if (signature === lastDialogMirrorState) return;
          lastDialogMirrorState = signature;
          root.replaceChildren();
          root.hidden = list.length === 0;
          list.forEach((dialog) => {
            const panel = document.createElement("section");
            panel.className = `gui-dialog-mirror gui-dialog-${dialog.kind || "generic"}`;
            panel.dataset.dialogId = dialog.id || "";
            panel.dataset.dialogKind = dialog.kind || "generic";
            if (dialog.padId) panel.dataset.padId = String(dialog.padId);
            panel.style.left = `${Math.max(0, Math.min(0.85, Number(dialog.left) || 0.2)) * 100}%`;
            panel.style.top = `${Math.max(0, Math.min(0.85, Number(dialog.top) || 0.2)) * 100}%`;
            panel.style.width = `${Math.max(0.2, Math.min(0.8, Number(dialog.width) || 0.5)) * 100}%`;
            panel.style.maxHeight = `${Math.max(0.25, Math.min(0.8, Number(dialog.height) || 0.5)) * 100}%`;
            const heading = document.createElement("h3");
            heading.textContent = dialog.title || "MXS-004";
            panel.appendChild(heading);
            (dialog.text || []).forEach((text) => {
              const help = document.createElement("p");
              help.textContent = text;
              panel.appendChild(help);
            });
            (dialog.controls || []).forEach((control) => {
              const row = document.createElement("label");
              row.className = "gui-dialog-mirror-control";
              row.dataset.controlType = control.type || "text";
              row.dataset.dialogId = dialog.id || "";
              row.dataset.controlIndex = String(dialog.controls.indexOf(control));
              const label = document.createElement("span");
              label.textContent = control.label || "Parameter";
              row.appendChild(label);
              if (control.type === "checkbox") {
                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.checked = !!control.checked;
                checkbox.disabled = false;
                checkbox.dataset.dialogId = dialog.id || "";
                checkbox.dataset.controlIndex = String(dialog.controls.indexOf(control));
                row.appendChild(checkbox);
              } else {
                const value = document.createElement("input");
                value.type = control.type === "select-one" ? "text" : (control.type || "text");
                value.value = control.value === null || control.value === undefined ? "" : control.value;
                value.min = control.min || "";
                value.max = control.max || "";
                value.step = control.step || "";
                value.disabled = false;
                value.setAttribute("aria-label", control.label || "Parameter");
                value.dataset.dialogId = dialog.id || "";
                value.dataset.controlIndex = String(dialog.controls.indexOf(control));
                row.appendChild(value);
                const output = document.createElement("output");
                output.textContent = value.value;
                output.className = "gui-dialog-mirror-value";
                row.appendChild(output);
              }
              panel.appendChild(row);
            });
            (dialog.actions || []).forEach((action, actionIndex) => {
              const button = document.createElement("button");
              button.type = "button";
              button.className = "gui-dialog-action-btn";
              button.textContent = action.label || "Action";
              button.disabled = Boolean(action.disabled);
              button.dataset.dialogId = dialog.id || "";
              button.dataset.actionIndex = String(action.actionIndex ?? actionIndex);
              button.dataset.actionId = action.actionId || `button-${actionIndex}`;
              button.setAttribute("aria-pressed", action.pressed ? "true" : "false");
              panel.appendChild(button);
            });
            root.appendChild(panel);
          });
        }

        let lastRenderTime = 0;
        const RENDER_THROTTLE_MS = 50; // Keep mirrored controls interactive without visible catch-up.
        const PCM_RENDER_THROTTLE_MS = 250; // Protect the audio callback from GUI repaint work.

        const _lastParamsCache = [];
        const _lastFxCache = [];
        let _lastSamplerCache = "";
        let lastMirroredState = null;

        function renderCursorState(cursor) {
          const cur = getEl("cursor-mirror");
          if (!cur || !cursor || typeof cursor !== "object") return;
          const revision = Number(cursor.revision);
          if (Number.isSafeInteger(revision) && revision < lastCursorRevision) return;
          if (Number.isSafeInteger(revision)) lastCursorRevision = revision;
          if (cursor.visible === false) {
            cur.classList.remove("is-visible", "is-clicking");
            return;
          }
          const x = Number(cursor.x);
          const y = Number(cursor.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;
          const root = getEl("studio-root");
          const rootWidth = root ? root.clientWidth : 1440;
          const rootHeight = root ? root.clientHeight : 810;
          const px = Math.max(0, Math.min(rootWidth - 1, x * rootWidth));
          const py = Math.max(0, Math.min(rootHeight - 1, y * rootHeight));
          const curKey = `${x}_${y}_${cursor.isClicking}_${cursor.visible}_${revision}`;
          if (valCache["cursor"] === curKey) return;
          cur.classList.add("is-visible");
          cur.style.transform = `translate3d(${px}px, ${py}px, 0)`;
          cur.classList.toggle("is-clicking", !!cursor.isClicking);
          valCache["cursor"] = curKey;
        }

        function cloneMirroredState(state) {
          if (!state || typeof state !== "object") {
            return null;
          }
          try {
            return JSON.parse(JSON.stringify(state));
          } catch (e) {
            const copy = { ...state };
            if (Array.isArray(state.tracks)) {
              copy.tracks = state.tracks.map((track) =>
                track && typeof track === "object" ? { ...track } : track,
              );
            }
            return copy;
          }
        }

        function buildImmediatePlaybackState(trackId) {
          if (lastMirroredState == null) {
            return null;
          }
          const nextState = cloneMirroredState(lastMirroredState);
          if (!nextState || !Array.isArray(nextState.tracks)) {
            return null;
          }
          const index = Number(trackId);
          if (!Number.isInteger(index) || index < 0 || index >= nextState.tracks.length) {
            return null;
          }
          const track = nextState.tracks[index];
          if (!track || typeof track !== "object") {
            return null;
          }
          track.isPlaying = true;
          track.isRecording = false;
          return nextState;
        }

        function renderState(s, force = false) {
          if (!s) return;
          // Cursor updates are isolated from the full GUI render budget so
          // PCM playout can defer control repainting without freezing the TV
          // pointer. Ordering is guarded by cursor.revision.
          renderCursorState(s.cursor);
          if (pcmAudioPriorityActive && !force) {
            pcmV2Telemetry.pcmAudioPriorityGuiSkips++;
            deferredGuiState = s;
            return;
          }
          const now = Date.now();
          const renderThrottleMs =
            window._binaryActive || window._playbackMode === "pcm_fallback"
              ? PCM_RENDER_THROTTLE_MS
              : RENDER_THROTTLE_MS;
          if (!force && now - lastRenderTime < renderThrottleMs) return;
          lastRenderTime = now;
          try {
            if (s.transport) {
              updateText("recording-time-display", s.transport.position);
              for (var i = 0; i < 4; i++) {
                updateText("t-time-" + i, s.transport.position);
              }
            }
            if (s.master) {
              if (s.master.waveform) {
                drawMirroredWaveform("master-waveform-L", s.master.waveform.left);
                drawMirroredWaveform("master-waveform-R", s.master.waveform.right);
              }
              updateValue("master-volume", s.master.volume || 0);
              updateText(
                "master-volume-value",
                (s.master.volume || 0).toFixed(1) + " dB",
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
              updateButtonState(
                "master-record-button",
                s.master.buttons && s.master.buttons.record,
              );
              updateButtonState(
                "lfo-toggle",
                s.master.buttons && s.master.buttons.lfo1,
              );
              updateButtonState(
                "lfo2-toggle",
                s.master.buttons && s.master.buttons.lfo2,
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
            renderDialogMirrors(s.dialogs);
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
                  const pad = getEl(btnId);
                  if (pad) {
                    pad.dataset.padId = String(p.id || i + 1);
                    pad.dataset.padName = String(p.name || "");
                    pad.dataset.padMode = String(p.mode || "oneshot");
                    pad.dataset.padLoaded = p.loaded ? "true" : "false";
                    pad.dataset.padMuted = p.muted ? "true" : "false";
                    pad.dataset.padReverse = p.reverse ? "true" : "false";
                    pad.title = p.loaded && p.name
                      ? `${p.name} — double-click for settings`
                      : `Pad ${p.id || i + 1} — double-click for settings`;
                    pad.setAttribute("aria-label", pad.title);
                  }
                });
              }
            }
            if (s.tracks)
              s.tracks.forEach((t, i) => {
                const trackName = t.fileName || "Ready";
                updateText("t-scroll-" + i, trackName);
                updateText("t-file-" + i, t.fileName || "");
                updateClass(
                  "t-scroll-" + i,
                  trackName.length > 15
                    ? "scrolling-text active-scrolling"
                    : "scrolling-text",
                );
                const trackLabel = getEl("t-scroll-" + i);
                if (trackLabel) {
                  trackLabel.setAttribute("title", trackName);
                  trackLabel.dataset.trackState = t.isPlaying ? "playing" : t.isPaused ? "paused" : "stopped";
                }
                const fileLabel = getEl("t-file-" + i);
                if (fileLabel) fileLabel.setAttribute("title", t.fileName || "");
                updateClass(
                  "t-st-" + i,
                  "status-indicator " +
                    (t.isRecording
                      ? "status-recording"
                      : t.isPlaying
                        ? "status-playing"
                    : "status-ready"),
                );
                updateButtonState(`t-rec-${i}`, t.buttons && t.buttons.record);
                updateButtonState(`t-stop-${i}`, t.buttons && t.buttons.stop);
                updateButtonState(`t-play-${i}`, t.buttons && t.buttons.play);
                updateButtonState(`t-rev-${i}`, t.buttons && t.buttons.reverse);
                updateEffectOptions(`t-effect-select-${i}`, s.effectOptions, t.effectSelection);
                updateStyleLeft("t-ls-m-" + i, t.loopStart * 100 + "%");
                updateStyleLeft("t-le-m-" + i, t.loopEnd * 100 + "%");
                if (t.waveform) {
                  drawMirroredWaveform("t-wf-l-" + i, t.waveform.left);
                  drawMirroredWaveform("t-wf-r-" + i, t.waveform.right);
                  updateMirroredPlayhead("t-playhead-" + i, t.waveform.playhead);
                }

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
            if (s.qa) {
              const qaRoot = getEl("qa-overlay-root");
              if (qaRoot) {
                const qaSignature = JSON.stringify(s.qa);
                if (valCache.qaMirror !== qaSignature) {
                  valCache.qaMirror = qaSignature;
                  qaRoot.replaceChildren();
                  qaRoot.dataset.source = "studio";
                  qaRoot.dataset.revision = String(Number(s.qa.revision) || 0);
                  qaRoot.hidden = !s.qa.visible;
                  if (s.qa.visible && s.qa.text) {
                    const panel = document.createElement("section");
                    panel.className = "receiver-qa-mirror qa-console-independent";
                    panel.setAttribute("role", "status");
                    const heading = document.createElement("h3");
                    heading.textContent = "QA";
                    panel.appendChild(heading);
                    const body = document.createElement("pre");
                    body.textContent = s.qa.text;
                    body.setAttribute("aria-live", "polite");
                    panel.appendChild(body);
                    qaRoot.appendChild(panel);
                  }
                }
              }
            }
          } catch (e) {
            console.error("❌ Receiver Render Error:", e);
          }
        }

        let currentBridgeIp = null;
        let currentBridgePort = null;
        let currentBridgeToken = null;
        let binaryWS = null;
        let wsConnectTimeout = null;
        let playoutPathLogged = false;
        let suppressBinaryReconnect = false;
        let binaryConnectionGeneration = 0;

        function clearBinaryReconnectTimer() {
          if (wsConnectTimeout) {
            clearTimeout(wsConnectTimeout);
            wsConnectTimeout = null;
          }
        }

        function scheduleBinaryReconnect(ip, customPort, customToken, delayMs) {
          if (window._receiverShutdownInProgress) {
            return;
          }
          clearBinaryReconnectTimer();
          wsConnectTimeout = setTimeout(() => {
            connectBinaryBridge(ip, customPort, customToken);
          }, delayMs);
        }

        function markReceiverPlayoutPathReady() {
          if (window._receiverShutdownInProgress) return;
          if (!playoutPathLogged) {
            playoutPathLogged = true;
            relayLogToStudio("📡 Receiver: native stream/worklet path owns audio output.");
          }
        }

        function reloadReceiver(logMessage, delayMs) {
          relayLogToStudio(logMessage || "🔄 Receiver: RELOAD command received. Reloading page...");
          setTimeout(() => {
            const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
            window.location.href = cleanUrl + "?cb=" + Date.now();
          }, delayMs || 500);
        }

        function handlePlaybackStartCommand(d, reason) {
          if (!acceptPlaybackRevision(d, "PLAYBACK_START")) {
            return;
          }
          noteOrderedPlaybackAction("PLAYBACK_START");
          markPlaybackStartSignal();
          playbackPaused = false;
          setPcmAudioPriority(
            pcmPathOwnsAudio(),
            reason || "playback_start",
          );
          if (workletNode && workletNode.port) {
            try { workletNode.port.postMessage({ type: "RESUME" }); } catch (e) {}
          }
          const immediateState = buildImmediatePlaybackState(d.trackId);
          if (immediateState) {
            renderState(immediateState, true);
            lastMirroredState = immediateState;
          }
          const resumingNative = nativeStreamActive && nativeStreamPaused;
          requestNativePlaybackStart(reason || "playback_start");
          if (nativeStreamActive) {
            publishMxsPlaybackStatus("PLAYING", reason || "playback_start");
          } else if (!resumingNative) {
            publishMxsPlaybackStatus("STARTING", reason || "playback_start");
          }
          acknowledgePlaybackRevision(d, "playback_start");
          schedulePlaybackRecoveryRetry();
        }

        function handleGuiStateUpdateCommand(state, envelope) {
          if (!acceptGuiRevision(envelope)) {
            return;
          }
          const normalizedState = normalizeGuiState(state);
          if (!normalizedState) {
            writeCastDebug("warn", "Receiver rejected GUI_STATE_UPDATE with an unsupported state schema.");
            return;
          }
          if (pcmAudioPriorityActive) {
            pcmV2Telemetry.pcmAudioPriorityGuiSkips++;
            deferredGuiState = normalizedState;
            return;
          }
          guiReceivedCount += 1;
          if (guiReceivedCount === 1 || guiReceivedCount % 20 === 0) {
            relayLogToStudio(
              "🖥️ Receiver GUI telemetry: received=" + guiReceivedCount +
              " revision=" + Number(envelope.guiRevision || -1),
            );
          }
          renderState(normalizedState);
          lastMirroredState = normalizedState;
          if (binaryWS && binaryWS.readyState === WebSocket.OPEN) {
            try {
              binaryWS.send(JSON.stringify({
                type: "GUI_STATE_ACK",
                transport: "gui",
                guiProtocolVersion: CAST_GUI_PROTOCOL_VERSION,
                guiRevision: Number(envelope.guiRevision || -1),
                receivedCount: guiReceivedCount,
              }));
            } catch (e) {}
          }
        }

        function handleCursorUpdateCommand(cursor) {
          renderCursorState(cursor);
        }

        function normalizeGuiState(state) {
          if (!state || state.schema !== "mxs-004.gui-state" || Number(state.schemaVersion) !== 1) {
            return null;
          }
          if (!Array.isArray(state.tracks) || !state.master || !state.master.meters || !state.qa) {
            return null;
          }
          const finite = (value, fallback = 0) => {
            const number = Number(value);
            return Number.isFinite(number) ? number : fallback;
          };
          const meters = (value) => ({
            l: Math.max(0, Math.min(1, finite(value?.l))),
            r: value?.r == null ? null : Math.max(0, Math.min(1, finite(value.r))),
          });
          const normalized = {
            ...state,
            guiContractVersion: Number(state.guiContractVersion) || 1,
            transport: {
              position: String(state.transport?.position || "00:00:00"),
            },
            master: {
              ...state.master,
              volume: finite(state.master.volume),
              loopLength: Math.max(0, finite(state.master.loopLength, 4)),
              meters: meters(state.master.meters),
            },
            tracks: state.tracks.slice(0, 4).map((track, index) => ({
              ...track,
              index,
              fileName: String(track?.fileName || ""),
              meters: meters(track?.meters),
              buttons: track?.buttons && typeof track.buttons === "object" ? track.buttons : {},
              params: track?.params && typeof track.params === "object" ? track.params : {},
            })),
            dialogs: Array.isArray(state.dialogs) ? state.dialogs : [],
            qa: {
              visible: Boolean(state.qa.visible),
              text: String(state.qa.text || "").slice(0, 4000),
            },
          };
          return normalized;
        }

        function handlePlaybackStopCommand(d) {
          if (!acceptPlaybackRevision(d, "PLAYBACK_STOP")) {
            return;
          }
          noteOrderedPlaybackAction("PLAYBACK_STOP");
          clearPlaybackRecoveryRetry();
          stopAllPlayout(d.reason || "playback_stop", undefined, false, true);
          acknowledgePlaybackRevision(d, "playback_stop");
        }

        function handlePlaybackPauseCommand(d) {
          if (!acceptPlaybackRevision(d, "PLAYBACK_PAUSE")) {
            return;
          }
          noteOrderedPlaybackAction("PLAYBACK_PAUSE");
          clearPlaybackRecoveryRetry();
          pauseAllPlayout(d.reason || "playback_pause");
          acknowledgePlaybackRevision(d, "playback_pause");
        }

        function decodePcmRelayBuffer(d) {
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
              return null;
            }
          }
          return buffer || null;
        }

        function handlePcmRelayCommand(d, options) {
          if (
            !identityAllowsAudio() ||
            !window._handshakeAcked ||
            !receiverBridgeConfigReady
          ) {
            relayLogToStudio(
              "⏸️ Receiver: Ignored PCM relay before authenticated HANDSHAKE_ACK/config readiness.",
            );
            return;
          }
          if (
            playbackPaused ||
            window._binaryActive ||
            nativeStreamActive ||
            receiverPlayoutPreference !== "pcm_fallback" ||
            window._playbackMode !== "pcm_fallback"
          ) return;
          const buffer = decodePcmRelayBuffer(d);
          if (!buffer) return;
          if (options && options.requireWorklet && !workletNode) return;
          if (audioCtx && audioCtx.state === "suspended") resumeAudio();
          const packet = validatePcmV2Packet(buffer);
          if (packet) {
            queueBinaryFrame(packet);
            if (options && options.countRelayPacket) {
              window._relayPkts = (window._relayPkts || 0) + 1;
            }
          }
        }

        function handleReceiverCommand(d, source) {
          const requiresAuthenticatedBridge = [
            "GUI_STATE_UPDATE",
            "CURSOR_UPDATE",
            "PLAYBACK_START",
            "PLAYBACK_STOP",
            "PLAYBACK_PAUSE",
            "PCM_RELAY",
          ].includes(d.type);
          if (
            requiresAuthenticatedBridge &&
            (!identityAllowsAudio() ||
              !window._handshakeAcked ||
              !receiverBridgeConfigReady)
          ) {
            relayLogToStudio(
              "⏸️ Receiver: Ignored " +
                d.type +
                " before authenticated HANDSHAKE_ACK/config readiness.",
            );
            return true;
          }
          switch (d.type) {
            case "RECEIVER_SHUTDOWN":
              shutdownReceiver(d.reason || "signal");
              return true;
            case "GUI_STATE_UPDATE":
              if (
                d.transport !== "gui" ||
                Number(d.guiProtocolVersion) !== CAST_GUI_PROTOCOL_VERSION
              ) {
                writeCastDebug("warn", "Receiver rejected GUI_STATE_UPDATE with an unsupported protocol envelope.");
                return true;
              }
              handleGuiStateUpdateCommand(d.state, d);
              return true;
            case "CURSOR_UPDATE":
              if (
                d.transport !== "gui_cursor" ||
                Number(d.guiProtocolVersion) !== CAST_GUI_PROTOCOL_VERSION
              ) {
                writeCastDebug("warn", "Receiver rejected CURSOR_UPDATE with an unsupported protocol envelope.");
                return true;
              }
              handleCursorUpdateCommand(d.cursor);
              return true;
            case "PLAYBACK_START":
              handlePlaybackStartCommand(d, "playback_start");
              return true;
            case "PLAYBACK_STOP":
              handlePlaybackStopCommand(d);
              return true;
            case "PLAYBACK_PAUSE":
              handlePlaybackPauseCommand(d);
              return true;
            case "PCM_RELAY":
              handlePcmRelayCommand(d, {
                requireWorklet: source === "Cast channel",
                countRelayPacket: source === "Cast channel",
              });
              return true;
            case "RELOAD":
              reloadReceiver(
                source === "Cast channel"
                  ? "🔄 Receiver: RELOAD command received via Cast SDK. Reloading page..."
                  : "🔄 Receiver: RELOAD command received. Reloading page with cache-buster...",
              );
              return true;
            case "PCM_V2_JITTER_TARGET":
              acceptFrozenJitterTarget(d);
              return true;
            case "SINE_TEST":
              playSineTest().catch((e) => {
                relayLogToStudio("⚠️ Receiver: Sine test failed: " + e.message);
              });
              return true;
            case "BUILD_IDENTITY_REJECTED":
              reportBuildIdentityRejection(
                d.reason || (source === "Cast channel" ? "cast_sender_rejected" : "backend_rejected"),
                d.received,
              );
              return true;
            case "WEBRTC_OFFER":
              relayLogToStudio(`📡 Receiver: Ignored WEBRTC_OFFER on ${source}.`);
              return true;
            case "WEBRTC_CANDIDATE":
              relayLogToStudio(`📡 Receiver: Ignored WEBRTC_CANDIDATE on ${source}.`);
              return true;
            default:
              return false;
          }
        }


        function connectBinaryBridge(ip, customPort, customToken) {
          if (window._receiverShutdownInProgress) {
            return;
          }
          suppressBinaryReconnect = false;
          clearBinaryReconnectTimer();
          const targetPort = customPort || (window.SERVER_PORT && !window.SERVER_PORT.startsWith("{{") ? window.SERVER_PORT : "8080");
          const targetToken = customToken || (window.SECURITY_TOKEN && !window.SECURITY_TOKEN.startsWith("{{") ? window.SECURITY_TOKEN : "");
          if (
            binaryWS &&
            (binaryWS.readyState === WebSocket.OPEN || binaryWS.readyState === WebSocket.CONNECTING) &&
            currentBridgeIp === ip &&
            currentBridgePort === targetPort &&
            currentBridgeToken === targetToken
          ) {
            // [v13.9.504] Already connected or connecting to this Studio IP. Ignore heartbeat redundancy.
            return;
          }

          const generation = ++binaryConnectionGeneration;

          currentBridgeIp = ip;
          currentBridgePort = targetPort;
          currentBridgeToken = targetToken;
          if (binaryWS) {
            try {
              binaryWS.onopen = null;
              binaryWS.onmessage = null;
              binaryWS.onclose = null;
              binaryWS.onerror = null;
              binaryWS.close();
            } catch (e) {}
            binaryWS = null;
            window._sendHandshake = null;
          }

          const url = `ws://${ip}:${targetPort}/?role=receiver&token=${encodeURIComponent(targetToken)}`;
          try {
            relayLogToStudio(`📡 Receiver: Attempting to connect to ${url}`);
            binaryWS = new WebSocket(url);
            binaryWS.binaryType = "arraybuffer";
          } catch (err) {
            relayLogToStudio(
              `❌ Receiver: WebSocket Constructor Failed: ${err.message}`,
            );
            wsConnectTimeout = setTimeout(() => connectBinaryBridge(ip, customPort, customToken), 5000);
            return;
          }

          binaryWS.onopen = async () => {
            if (generation !== binaryConnectionGeneration) return;
            if (window._receiverShutdownInProgress) return;
            clearReceiverSessionCaches("new_cast_handshake");
            pcmV2Validator = null;
            pcmV2AllowInitialOffset = true;
            pcmV2Telemetry = createPcmV2Telemetry();
            playbackModeSocketGeneration++;
            resetGuiRevisionGate("bridge_open");
            console.log("✅ Binary Bridge Connected");
            markReceiverBoot("bridge_connected", { url: url });
            relayLogToStudio(`✅ Receiver: WebSocket Connected to ${url}`);
            if (window._receiverUiRevealed) {
              try {
                binaryWS.send(JSON.stringify({
                  type: "GUI_READY",
                  transport: "gui",
                  guiProtocolVersion: CAST_GUI_PROTOCOL_VERSION,
                  guiRevision: lastGuiRevision,
                  bootStage: window._receiverBootStage || "gui_revealed",
                }));
                relayLogToStudio("✅ Receiver: GUI_READY sent independently of audio handshake.");
              } catch (e) {
                relayLogToStudio("⚠️ Receiver: GUI_READY send failed: " + e.message);
              }
            }
            // [v13.9.504] Reset reconnect backoff counter on success
            window._wsReconnectAttempts = 0;
            // [v13.9.506] Reset stale bypass flag so fresh sessions don't carry old state
            window._nativeStreamBypassLogged = false;
            try {
              if (window._isFreshSession) {
                localStorage.removeItem("mxs_pcm_degraded");
                window._isFreshSession = false;
              }
              window._pcmDegraded = localStorage.getItem("mxs_pcm_degraded") === "true";
            } catch (e) {
              window._pcmDegraded = false;
            }
            clearBinaryReconnectTimer();
            buildIdentityAccepted = false;
            buildIdentityRejected = false;
            window._buildIdentityAccepted = false;
            pendingBuildIdentityRejection = null;
            receiverHandshakeTelemetryReady = false;
            receiverBridgeConfigReady = false;
            deferredReceiverTelemetry = [];
            pendingPlaybackMode = null;
            pendingPlayoutSelection = null;
            // Flush startup/UI logs that were queued before the Studio LAN
            // address and receiver WebSocket became available.
            flushPendingStudioLogs();
            const conn = document.getElementById("bridge-status-dot");
            if (conn) {
              conn.style.backgroundColor = "var(--green)";
              conn.classList.add("bridge-connected-pulse");
            }

            // [v13.9.504] HARDWARE PROBE: Record the active audio clock when one already exists.
            // Do not force AudioContext creation here; native-first sessions should stay native-first.
            let hwRate = 48000;
            try {
              hwRate = audioCtx ? audioCtx.sampleRate : 48000;
              window._hwRate = hwRate;
              relayLogToStudio(
                `🔍 Receiver: Hardware probe → actual rate = ${hwRate}Hz`,
              );
            } catch (e) {
              relayLogToStudio(
                `⚠️ Receiver: Hardware probe failed, defaulting to ${hwRate}Hz`,
              );
              window._hwRate = hwRate;
            }

            function sendHandshake() {
              if (window._receiverShutdownInProgress) return;
              if (!binaryWS || binaryWS.readyState !== WebSocket.OPEN) return;
              if (pendingBuildIdentityRejection) {
                binaryWS.send(JSON.stringify(pendingBuildIdentityRejection));
                pendingBuildIdentityRejection = null;
                return;
              }
              if (!isBuildIdentity(window.MXS_BUILD_IDENTITY)) {
                reportBuildIdentityRejection("receiver_identity_missing_or_malformed", null);
                return;
              }
              if (buildIdentityRejected) return;
              // Use the live AudioContext rate, not the probe rate, so the
              // backend resamples to the actual Cast playout clock.
              const rate = (audioCtx && audioCtx.sampleRate) || window._hwRate || hwRate || 48000;
              const handshake = {
                type: "HANDSHAKE",
                config: {
                  sampleRate: rate,
                  bitDepth: 16,
                  maxChannels: 2,
                },
                buildIdentity: window.MXS_BUILD_IDENTITY,
              };
              try {
                binaryWS.send(JSON.stringify(handshake));
                relayLogToStudio(`🤝 Receiver: Handshake sent → ${rate}Hz / 16-bit`);
              } catch (e) {
                relayLogToStudio(`⚠️ Receiver: Failed to send handshake: ${e.message}`);
              }
            }

            window._sendHandshake = sendHandshake;
            window._handshakeAcked = false;
            sendHandshake();
            markReceiverBoot("handshake_sent", {
              sampleRate: (audioCtx && audioCtx.sampleRate) || window._hwRate || hwRate || 48000,
            });

            // Set up a retry interval in case the initial handshake is lost/dropped by sender
            const handshakeRetryInterval = setInterval(() => {
              if (generation !== binaryConnectionGeneration || !binaryWS || binaryWS.readyState !== WebSocket.OPEN || window._handshakeAcked) {
                clearInterval(handshakeRetryInterval);
                return;
              }
              relayLogToStudio("⏳ Receiver: Retrying Handshake (no ACK received yet)...");
              sendHandshake();
            }, 1500);

            // Record that the receiver audio path is ready; low-latency PCM startup begins only
            // once the handshake/configuration path is ready.
            markReceiverPlayoutPathReady();
            if (nativeStreamActive || nativeStreamStarting) {
              notifyPlaybackMode("native", "socket_reconnected");
            } else if (
              receiverPlayoutPreference === "pcm_fallback" &&
              !window._pcmDegraded
            ) {
              // A reconnect can retain a standby worklet from the prior
              // generation. Its existence is not an ownership decision: the
              // authenticated BRIDGE_CONFIG path still starts native-first
              // preparation. Publish native selecting here so PCM cannot
              // briefly become audible before that preparation runs.
              notifyPlaybackMode("native", "socket_reconnected", false);
              notifyPlayoutSelecting("native_preparation", "socket_reconnected");
            } else if (workletNode || workletReady || window._binaryActive) {
              notifyPlaybackMode("pcm_fallback", "socket_reconnected");
            }
          };
          binaryWS.onmessage = (event) => {
            if (generation !== binaryConnectionGeneration) return;
            if (window._receiverShutdownInProgress) return;

            // [v13.9.504] PRIORITY: Binary audio data gets the fastest path
            const isArrayBuffer = event.data instanceof ArrayBuffer || (event.data && typeof event.data.byteLength === "number");
            const isBlob = event.data instanceof Blob || (event.data && typeof event.data.size === "number" && typeof event.data.slice === "function");
            
            if (isArrayBuffer) {
              if (
                playbackPaused ||
                window._playbackMode === "native" ||
                nativeStreamActive ||
                (nativeStreamStarting && !nativeStreamCompanionForPcm)
              ) {
                return;
              }
              if (workletNode) {
                // [v13.9.504] PCM BRIDGE LOCK
                // Keep the direct PCM bridge as the only live audio path to save Receiver CPU.
                window._lastBinaryTime = Date.now();
                window._binaryActive = true;

                // Clear any legacy media-stream source so PCM remains the only live audio path.
                const audioUnlocker = document.getElementById("audio-unlocker");
                if (audioUnlocker && audioUnlocker.srcObject) {
                  audioUnlocker.srcObject = null;
                  relayLogToStudio(
                    "🛡️ Receiver: Binary Bridge Active. Cleared redundant media-stream source.",
                  );
                }

                if (audioCtx && audioCtx.state === "suspended") resumeAudio();
                const packet = validatePcmV2Packet(event.data);
                if (packet) queueBinaryFrame(packet);
              } else {
                if (audioCtx && audioCtx.state === "suspended") resumeAudio();
                const packet = validatePcmV2Packet(event.data);
                if (packet) queueBinaryFrame(packet);
              }
              return;
            } else if (isBlob) {
              if (
                playbackPaused ||
                window._playbackMode === "native" ||
                nativeStreamActive ||
                (nativeStreamStarting && !nativeStreamCompanionForPcm)
              ) {
                return;
              }
              // [v13.9.504] Fallback: Receiver browser ignored binaryType="arraybuffer"
              window._lastBinaryTime = Date.now();
              if (!window._binaryActive) {
                window._binaryActive = true;
                const audioUnlocker = document.getElementById("audio-unlocker");
                  if (audioUnlocker && audioUnlocker.srcObject) {
                    audioUnlocker.srcObject = null;
                    relayLogToStudio("🛡️ Receiver: Binary Bridge Active (Blob). Cleared redundant media-stream source.");
                  }
              }

              if (audioCtx && audioCtx.state === "suspended") resumeAudio();
              var reader = new FileReader();
              reader.onload = function() {
                if (playbackPaused) return;
                const packet = validatePcmV2Packet(this.result);
                if (packet) queueBinaryFrame(packet);
              };
              reader.onerror = function() {
                relayLogToStudio("⚠️ Receiver: FileReader failed to read Blob.");
              };
              reader.readAsArrayBuffer(event.data);
              return;
            } else if (typeof event.data === "string") {
              try {
                const d = JSON.parse(event.data);
                if (d.type === "HANDSHAKE_ACK") {
                  if (!acceptBuildIdentity(d.buildIdentity, "handshake_ack")) {
                    return;
                  }
                  // Server confirmed handshake. Low-latency PCM starts only when
                  // the receiver is explicitly in PCM fallback mode.
                  const ackRate = d.config ? d.config.sampleRate : 48000;
                  const ackBitDepth = d.config ? d.config.bitDepth : 16;
                  relayLogToStudio(
                    `✅ Receiver: HANDSHAKE_ACK received → ${ackRate}Hz / ${ackBitDepth}-bit`,
                  );
                  window._negotiatedBitDepth = ackBitDepth;
                  if (ackRate) {
                    window._hwRate = ackRate;
                  }
                  configReceived = true;
                  window._handshakeAcked = true;
                  markReceiverBoot("handshake_ack", { sampleRate: ackRate, bitDepth: ackBitDepth });
                  maybeEnableReceiverHandshakeTelemetry();
                  flushPendingPlayoutState();
                  logReceiverHardwareTelemetry(getCastReceiverContext());

                  // The receiver clears playout on a bridge reconnect. Tell the
                  // sender explicitly so it can replay the last ordered command
                  // (including an active PLAYBACK_START) without inventing a new
                  // playback revision.
                  if (window._receiverReadyGeneration !== playbackModeSocketGeneration) {
                    window._receiverReadyGeneration = playbackModeSocketGeneration;
                    try {
                      binaryWS.send(JSON.stringify({ type: "RECEIVER_READY" }));
                    } catch (e) {}
                  }

                  // Native prewarm is started from the bridge-open/config path
                  // below. HANDSHAKE_ACK only authenticates the PCM fallback
                  // boundary; restarting native here adds avoidable startup
                  // latency and can race the first ordered PLAYBACK_START.
                  if (
                    receiverPlayoutPreference === "pcm_fallback" &&
                    !nativeStreamStarting &&
                    !nativeStreamActive
                  ) {
                    preloadPcmWorklet("native_preparation_unavailable");
                  }
                } else if (d.type === "BRIDGE_CONFIG") {
                  if (!acceptBuildIdentity(d.buildIdentity, "bridge_config")) {
                    return;
                  }
                  if (d.pcmProtocol && !acceptPcmV2ProtocolConfig(d.pcmProtocol, "websocket")) {
                    return;
                  }
                  receiverBridgeConfigReady = true;
                  maybeEnableReceiverHandshakeTelemetry();
                  flushPendingPlayoutState();
                  if (d.config && d.config.sampleRate) {
                    const newStudioRate = d.config.sampleRate;
                    configReceived = true;

                    // Proactive fallback: If we haven't received HANDSHAKE_ACK yet, resend HANDSHAKE
                    if (!window._handshakeAcked && typeof window._sendHandshake === "function") {
                      window._sendHandshake();
                    }

                    if (window._studioRate !== newStudioRate) {
                      window._studioRate = newStudioRate;
                      relayLogToStudio(
                        `🔄 Receiver: Studio rate updated to ${newStudioRate}Hz`,
                      );
                    }
                  }
                  if (d.ip) {
                    markReceiverPlayoutPathReady();
                    // Begin the native CAF progressive-WAV prewarm as soon as
                    // the authenticated bridge advertises its LAN endpoint.
                    // The stream remains muted until the ordered Play command;
                    // PCM stays closed while native owns preparation.
                    if (receiverPlayoutPreference === "pcm_fallback") {
                      prepareNativePcmHandoff("websocket_open");
                    }
                  }
                } else {
                  handleReceiverCommand(d, "binary bridge");
                }
              } catch (e) {}
            }
          };

          binaryWS.onclose = () => {
            if (generation !== binaryConnectionGeneration) return;
            buildIdentityAccepted = false;
            window._buildIdentityAccepted = false;
            receiverHandshakeTelemetryReady = false;
            receiverBridgeConfigReady = false;
            clearLowLatencyStartupWatchdog();
            window._binaryActive = false;
            configReceived = false;
            playoutPathLogged = false;
            pendingBinaryFrames = [];
            workletReady = false;
            window._isDrainingStartup = false;
            // The bridge close tears down receiver playout. Allow the sender's
            // same-revision RECEIVER_READY replay to re-arm that fresh session,
            // while equal revisions remain suppressed during one connection.
            resetPlaybackRevisionGate("bridge_closed");
            resetGuiRevisionGate("bridge_closed");
            const reconnectPlaybackActive = Boolean(
              lastPlaybackStartSignalAt && !playbackPaused
            );
            stopAllPlayout(
              "websocket_closed",
              undefined,
              false,
              reconnectPlaybackActive,
              reconnectPlaybackActive,
            );
            if (reconnectPlaybackActive) {
              relayLogToStudio(
                "🔁 Receiver: Active PLAYBACK_START intent retained across bridge reconnect; awaiting ordered replay.",
              );
            }
            if (workletNode) {
              try {
                workletNode.port.postMessage({ type: "RESET" });
              } catch (e) {}
            }
            window._lastBinaryTime = 0;
            window._lastWorkletDiagTime = 0;
            clearLegacyMediaStream();
            const conn = document.getElementById("bridge-status-dot");
            if (conn) {
              conn.style.backgroundColor = "var(--red)";
              conn.classList.remove("bridge-connected-pulse");
            }
            if (window._receiverShutdownInProgress) {
              suppressBinaryReconnect = false;
              clearBinaryReconnectTimer();
              return;
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
              relayLogToStudio(`🔄 Receiver: WS closed. Reconnect attempt ${window._wsReconnectAttempts}/${maxRetries} in ${delay}ms...`);
              scheduleBinaryReconnect(currentBridgeIp, currentBridgePort, currentBridgeToken, delay);
            } else {
              relayLogToStudio("🛑 Receiver: All reconnect attempts exhausted. Reloading page...");
              window._wsReconnectAttempts = 0;
              setTimeout(() => {
                const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
                window.location.href = cleanUrl + "?cb=" + Date.now();
              }, 1000);
            }
          };

          binaryWS.onerror = (e) => {
            if (generation !== binaryConnectionGeneration) return;
            if (window._receiverShutdownInProgress) return;
            console.error("❌ Binary Bridge Error:", e);
            relayLogToStudio(`❌ Receiver: WebSocket Error on ${url}`);
            // [v13.9.504] Retry with full connection params (port + token preserved)
            scheduleBinaryReconnect(ip, customPort, customToken, 5000);
          };
        }

        function handleInboundData(data) {
          if (window._receiverShutdownInProgress) return;
          try {
            const d = parseCastPayload(data);
            if (!d) return;

            // 1. Hardware Alignment
            if (d.type === "BRIDGE_CONFIG") {
              if (!acceptBuildIdentity(d.buildIdentity, "cast_bridge_config")) {
                // Connect only to report the rejection through the authoritative
                // sender/backend path; no handshake or audio startup is allowed.
                if (d.ip) connectBinaryBridge(d.ip, d.port, d.token);
                return;
              }
              if (
                d.pcmProtocol &&
                !acceptPcmV2ProtocolConfig(d.pcmProtocol, "cast_control")
              ) {
                return;
              }
              const newRate = d.config ? d.config.sampleRate : null;
              configReceived = true;
              if (newRate && window._studioRate !== newRate) {
                window._studioRate = newRate;
                relayLogToStudio(
                  `🔄 Receiver: Studio rate updated via signaling to ${newRate}Hz`,
                );
              }
              if (d.ip) {
                connectBinaryBridge(d.ip, d.port, d.token);
                markReceiverPlayoutPathReady();
              }
              return;
            }

            if (d.type === "BUILD_IDENTITY_REJECTED") {
              handleReceiverCommand(d, "Cast channel");
              return;
            }

            handleReceiverCommand(d, "Cast channel");
          } catch (e) {
            relayLogToStudio("⚠️ Receiver: Inbound Cast message failed: " + e.message);
          }
        }

        // Keep the milestone's direct browser load lifecycle. The current
        // audio and handshake implementation remains unchanged inside it.
        window.onload = function () {
          // Preserve the known-good receiver order: construct the complete
          // static/dynamic GUI first, then start the native latency monitor.
          // New GUI telemetry and bindings are deliberately layered after
          // those original startup steps.
          buildGUI();
          startNativeLatencyMonitor();
          prepareReceiverUi();
          markReceiverBoot("window_loaded");

          // [V13.9.40] Aggressive Startup Trace
          console.log("🎬 Receiver: Startup sequence initiated.");
          console.log("🔗 URL: " + window.location.href);

          if (typeof cast !== "undefined" && cast.framework) {
            try {
              const context = getCastReceiverContext();
              if (!context) {
                throw new Error("CastReceiverContext unavailable");
              }

              relayLogToStudio("🎬 Receiver: Startup - URL: " + window.location.href);

              // [v13.9.504] SENDER_CONNECTED/DISCONNECTED listeners
              context.addEventListener(
                cast.framework.events.EventType.SENDER_CONNECTED,
                () => {
                if (window._receiverShutdownInProgress) return;
                console.log("📡 Sender connected.");
                markReceiverBoot("sender_connected");
                clearNoSenderShutdownTimer();
                flushPendingStudioLogs();
                logReceiverHardwareTelemetry(context);
                resumeAudio();
                markReceiverPlayoutPathReady();
              },
            );

              context.addEventListener(
                cast.framework.events.EventType.SENDER_DISCONNECTED,
                () => {
                  if (window._receiverShutdownInProgress) return;
                  buildIdentityAccepted = false;
                  window._buildIdentityAccepted = false;
                  playoutPathLogged = false;
                  window._binaryActive = false; 
                  window._lastBinaryTime = 0;
                  window._playbackMode = "unknown";
                  stopNativeStreamPlayout("sender_disconnected");
                  clearLegacyMediaStream();
                  suppressBinaryReconnect = true;
                  binaryConnectionGeneration++;
                  clearBinaryReconnectTimer();
                  if (binaryWS) {
                    binaryWS.close();
                    binaryWS = null;
                  }
                  scheduleNoSenderShutdown("sender_disconnected");
                },
              );

              context.addCustomMessageListener(CUSTOM_NAMESPACE, (event) => {
                if (window._receiverShutdownInProgress) return;
                if (event.data) {
                  const msgData = parseCastPayload(event.data);
                  handleInboundData(msgData);
                }
              });

              configureCastDebugLogger(context);
              clearReceiverHardwareTelemetryRetry();
              configureCafPlaybackHandlers();
              configureCafPlayerDebugEvents();
              const options = new cast.framework.CastReceiverOptions();
              const playbackConfig = new cast.framework.PlaybackConfig();
              playbackConfig.autoPauseDuration = 0;
              playbackConfig.autoResumeDuration = 0;
              options.playbackConfig = playbackConfig;
              options.disableIdleTimeout = true;
              context.start(options);
              markReceiverBoot("caf_started");
              setTimeout(function () {
                logReceiverHardwareTelemetry(context);
              }, 250);
            } catch (e) {
              relayLogToStudio("❌ Receiver: Cast framework start failed: " + e.message);
              console.error("❌ Receiver: Cast framework start failed:", e);
            }
          } else {
            relayLogToStudio(
              "🎬 Receiver: Startup - Running in standard browser (non-cast)",
            );
          }

          // [v13.8.150] Auto-Discovery Fallback
          autoDiscoveryFallbackTimeoutId = setTimeout(() => {
            if (window._receiverShutdownInProgress) {
              return;
            }
            if (
              !binaryWS ||
              (binaryWS.readyState !== WebSocket.OPEN &&
                binaryWS.readyState !== WebSocket.CONNECTING)
            ) {
              console.log("📡 Receiver: Auto-Discovery Fallback triggered...");
              const hostname = window.location.hostname;
              const isLocal =
                hostname === "localhost" ||
                hostname === "127.0.0.1" ||
                /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
              if (isLocal) {
                connectBinaryBridge(hostname);
              } else {
                console.log(
                  "📡 Receiver: Public hosting detected. Staying silent until BRIDGE_CONFIG.",
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
                  relayLogToStudio("⚠️ Receiver: Worklet process() stalled/not started. Attempting resume...");
                }
                showUnlockOverlay();
                resumeAudio();
              } else if (audioCtx.state === "running") {
                hideUnlockOverlay();
              }
            } else {
              // Only auto-init PCM fallback when we are not already in a cast session.
              // Native /stream.wav should get the first chance to come up cleanly.
              if (
                configReceived &&
                !currentBridgeIp &&
                !nativeStreamActive &&
                !nativeStreamStarting
              ) {
                initAudio();
              }
            }

            // [v13.9.504] Non-Cast fallback only — keep HTML5 audio element alive.
            // Cast mode uses explicit native stream or PCM fallback startup paths.
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
            shutdownReceiver("beforeunload");
          });

          window.addEventListener("pagehide", function() {
            shutdownReceiver("pagehide");
          });

          // [v13.9.504] Global interaction listeners to catch Receiver remote keys and clicks for AudioContext unlock
          window.addEventListener("keydown", function(e) {
            // relayLogToStudio("🎹 Receiver: keydown event: " + e.key + " (code: " + e.keyCode + ")");
            resumeAudio();
          });

          window.addEventListener("click", function() {
            // relayLogToStudio("🖱️ Receiver: click event detected.");
            resumeAudio();
          });

          window.addEventListener("pointerdown", function() {
            // relayLogToStudio("🖱️ Receiver: pointerdown event detected.");
            resumeAudio();
          });

          const btnUnlock = document.getElementById("btn-unlock-audio");
          if (btnUnlock) {
            btnUnlock.addEventListener("click", function(e) {
              e.stopPropagation();
              relayLogToStudio("🖱️ Receiver: Unlock button clicked.");
              resumeAudio();
            });
          }

          window.addEventListener("resize", updateScale);
          // The new atomic reveal remains the final step, after the complete
          // milestone lifecycle and all GUI bindings have finished.
          revealReceiverUi("complete_layout_ready");
          relayLogToStudio("🎬 Receiver: Startup Complete [" + VERSION_TAG + "].");
        };

      })();
    

// Shared authenticated audio/session core; mode ownership is fixed by each entry page.
const RECEIVER_BRANCH = window.MXS_RECEIVER_BRANCH || null;
if (typeof window.MXSCastAudioOwnerArbiter !== "function") {
  throw new Error("The shared Cast audio owner module did not load");
}
if (typeof window.MXSCastSessionBinding !== "function") {
  throw new Error("The shared Cast session binding module did not load");
}
if (RECEIVER_BRANCH?.gui && (
  typeof window.MXSStudioStartupStatus?.dispose !== "function" ||
  typeof window.MXSCreateStudioStructure !== "function" ||
  typeof window.MXSStudioParameterDisplay?.format !== "function" ||
  typeof window.MXSCreateStudioDialogs !== "function" ||
  typeof window.MXSCreateStudioGuiActions !== "function" ||
  typeof window.MXSCreateStudioLfoWaveforms !== "function"
)) {
  throw new Error("A required Studio presentation module did not load");
}


      window.SERVER_PORT = String(window.location.port || "");
      window.RECEIVER_TOKEN = "";
      window.STREAM_TOKEN = "";
      window.LOG_TOKEN = "";
      const LOCAL_BOOTSTRAP_TOKEN = new URLSearchParams(window.location.hash.slice(1)).get("bootstrap");
      if (LOCAL_BOOTSTRAP_TOKEN) {
        try {
          window.history.replaceState(
            window.history.state,
            "",
            window.location.pathname + window.location.search,
          );
        } catch (_error) {}
      }

      (function () {
        function redactBridgeUrl(value) {
          return String(value || "")
            .replace(/([?&]token=)[^&]+/i, "$1<redacted>");
        }



        const castAudioOwnerArbiter = new window.MXSCastAudioOwnerArbiter();
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
        const COMPATIBILITY_IDENTITY_SCHEMA = "mxs-004.cast-compatibility";
        const COMPATIBILITY_IDENTITY_VERSION = 2;
        const BUILD_IDENTITY_COMPONENTS = [
          "senderCritical",
          "tauriCastingBackend",
          "receiverHtml",
          "receiverLogic",
          "receiverPcmWorklet",
        ];
        const COMPATIBILITY_PROTOCOL_KEYS = ["audio", "gui", "session"];
        const COMPATIBILITY_SCHEMA_KEYS = ["pcm", "gui", "actions"];
        var buildIdentityAccepted = false;
        var buildIdentityRejected = false;
        var pendingBuildIdentityRejection = null;
        const BUILD_IDENTITY_RELOAD_SESSION_KEY = "mxs_build_identity_reload_attempt";
        // Capability/runtime route results are deliberately durable per
        // receiver. Do not clear mxs_pcm_degraded during a bridge reconnect:
        // it is what prevents a known legacy AudioWorklet failure from
        // repeating the PCM→native startup churn on every Cast session.
        const RECEIVER_SESSION_CACHE_KEYS = [];
        window._buildIdentityAccepted = false;
        // Keep at most about one second of packets while the worklet or its
        // nominal target is not ready. Normal startup publishes the target
        // before the first packet; exceeding this bound is an explicit native
        // fallback, never silent packet deletion.
        const PENDING_BINARY_FRAMES_MAX = 48;
        const VERSION_TAG = "v13.9.509-APORv2";
        const CUSTOM_NAMESPACE = "urn:x-cast:com.nowmultimedia.mxs004";
        const CAST_GUI_PROTOCOL_VERSION = 3;
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
        var nativeResumeProbeTimerId = null;
        var nativeResumeProbe = null;
        var nativeResumeReloadRevision = -1;
        var nativeResumeReloadEpoch = -1;
        var nativeOrderedResumeRecovery = null;
        var nativeOrderedResumeRecoveryTimerId = null;
        // Preserve the last audible gain across the pause mute (volume=0).
        // CAF can report that muted zero before ordered resume restores audio.
        var nativeLastAudibleVolume = 1;
        var nativeStartupTrimPending = false;
        var nativeStartupTrimState = "idle";
        var nativeStartupTrimRetryTimerId = null;
        var nativeStartupTrimRetryStartedAt = 0;
        // A seekable live edge is required before a prewarmed native stream
        // can become audible. If the first prewarm cannot be trimmed, allow
        // one fresh stream attempt for this ordered Play before settling on
        // the explicit PCM fallback. Without this guard a stale prewarm can
        // be released repeatedly and make Stop -> Play appear to repair audio.
        var nativeStartupTrimRecoveryAttempted = false;
        var nativeStartupWatchdogId = null;
        var lowLatencyStartupWatchdogId = null;
        var pcmStartupRetryTimerId = null;
        // CAF normally reaches PLAYING within a few seconds after the
        // ordered Play boundary over LAN. Keep the native fallback bounded so a
        // decoder that never becomes audible cannot hold the session silent.
        const NATIVE_STARTUP_TIMEOUT_MS = 5000;
        const CAF_NATIVE_RESUME_PROBE_TIMEOUT_MS = 2500;
        const CAF_NATIVE_RESUME_RELOAD_TIMEOUT_MS = 5000;
        const CAF_NATIVE_RESUME_PROBE_INTERVAL_MS = 250;
        const CAF_NATIVE_RESUME_PROGRESS_EPSILON_SEC = 0.05;
        const NATIVE_STARTUP_TRIM_RETRY_MS = 25;
        const NATIVE_STARTUP_TRIM_RETRY_TIMEOUT_MS = 1000;
        const NATIVE_LATENCY_SAMPLE_INTERVAL_MS = 200;
        const NATIVE_LATENCY_REPORT_INTERVAL_MS = 1000;
        const NATIVE_LATENCY_FAST_REPORT_INTERVAL_MS = 400;
        const NATIVE_LATENCY_FAST_REPORT_WINDOW_MS = 4000;
        const NATIVE_LATENCY_ROLLING_WINDOW_MS = 1600;
        const NATIVE_LATENCY_MIN_REPORT_SAMPLES = 3;
        const CAF_TELEMETRY_MEDIA_EVENT_THROTTLE_MS = 250;
        const PCM_STARTUP_HARD_TIMEOUT_MS = 10000;
        const WORKLET_CAPABILITY_TIMEOUT_MS = 1000;
        const WORKLET_PRODUCTION_TIMEOUT_MS = 1500;
        const WORKLET_CAPABILITY_CACHE_KEY = "mxs_audio_worklet_capability_v1";
        const PCM_RUNTIME_QUALIFICATION_KEY = "mxs_pcm_runtime_qualified_v1";
        const PCM_RUNTIME_QUALIFICATION_WINDOWS_REQUIRED = 4;
        const PCM_RUNTIME_MIN_WALL_HZ = 44000;
        // Bump this only when the receiver changes its AudioWorklet loading
        // compatibility strategy. A proven production AbortError is a device
        // capability result, not a source-build result, and must survive normal
        // receiver deployments or every new QA build pays the same dead path.
        const WORKLET_CAPABILITY_GENERATION = "cobalt-production-worklet-v1";
        // A fresh native stream must not replay the buffered tail of a prior
        // idle session. Correct an oversized live buffer once at startup;
        // steady-state playback remains at rate 1.0 with no clock chasing.
        const NATIVE_STARTUP_TRIM_THRESHOLD_SEC = 1.75;
        // Keep a fresh native stream close to the live edge. A larger startup
        // target creates a conspicuous first-play pause before file audio.
        const NATIVE_STARTUP_TARGET_SEC = 0.08;
        // Chromium's media pipeline underruns and enters an unrecoverable
        // BUFFERING stall if sought closer than ~750ms to the live stream
        // edge. Bound the effective startup trim target so CAF retains enough
        // decode buffer to play out without stalling.
        const NATIVE_SAFE_DECODE_BUFFER_SEC = 0.85;
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
        var desiredPlaybackState = "idle";
        const PLAYER_MANAGER_ORDER_GUARD_MS = 5000;
        var lastGuiRevision = -1;
        var guiSessionNonce = null;
        var lastGuiReadyNonce = null;
        var lastCursorRevision = -1;
        var guiReceivedCount = 0;
        var guiRawMessageCount = 0;
        var guiRejectedCount = 0;
        var guiLastRejectReason = null;
        var guiLastRawRevision = -1;
        var guiDeferredCount = 0;
        var guiRenderedCount = 0;
        var guiAckCount = 0;
        var guiLastAckErrorAt = 0;
        var guiRenderThrottleSkips = 0;
        var guiLastReceivedRevision = -1;
        var guiLastDeferredRevision = -1;
        var guiLastRenderedRevision = -1;
        var guiLastAckRevision = -1;
        var guiLastRenderTimeMs = 0;
        var guiLastPayloadBytes = 0;
        const GUI_CHANNEL_TELEMETRY_INTERVAL_MS = 5000;
        const GUI_WAVEFORM_PROOF_INTERVAL_MS = 30000;
        const GUI_LFO_VISUAL_PROOF_INTERVAL_MS = 1000;
        const GUI_LFO_RENDER_TELEMETRY_INTERVAL_MS = 250;
        const GUI_LFO_TELEMETRY_REPORT_INTERVAL_MS = 1000;
        const GUI_CLOCK_SYNC_INTERVAL_MS = 2000;
        const GUI_CLOCK_SYNC_MAX_RTT_MS = 250;
        var guiChannelTelemetryTimer = null;
        var guiChannelTelemetryEventCounts = {};
        var guiChannelTelemetryLastDetails = {};
        var guiLastWaveformProofAt = 0;
        var guiLastLfoVisualProofAt = 0;
        var guiLastLfoVisualProofSignature = "";
        var lastLfoVisualTelemetryAtMs = 0;
        var lfoVisualFrameSequence = 0;
        var guiClockSyncInterval = null;
        var guiClockSyncSequence = 0;
        var pendingGuiClockSyncProbes = new Map();
        var guiClockSyncSamples = [];
        var guiClockSyncEstimate = null;
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
        var receiverBootDiagnosticCount = 0;
        var receiverHandshakeTelemetryReady = false;
        var receiverBridgeConfigReady = false;
        var receiverBridgeConfigRevision = null;
        var receiverHandshakeCommitSignature = null;
        var pcmAudioPriorityActive = false;
        var playbackControlGuiHoldUntil = 0;
        var playbackControlGuiHoldTimerId = null;
        const PLAYBACK_CONTROL_GUI_HOLD_MS = 300;
        var deferredGuiState = null;
        var deferredGuiRevision = -1;
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
          sendAuthenticatedGuiReady("bridge_authenticated");
          sendReceiverHandshakeCommit("bridge_authenticated");
          if (guiControlWS && guiControlWS.readyState === WebSocket.OPEN) {
            startGuiClockSync();
          }
        }

        // HANDSHAKE_ACK is the backend's authenticated response. This
        // receiver-applied edge is the sender's release boundary: both the
        // ACK and the current BRIDGE_CONFIG must be live on this socket before
        // queued playback or post-handshake work can be released.
        function sendReceiverHandshakeCommit(reason) {
          if (!window.MXSCastSessionBinding.canCommit({
            socketOpen: !!binaryWS && binaryWS.readyState === WebSocket.OPEN,
            handshakeAcked: !!window._handshakeAcked,
            bridgeConfigReady: receiverBridgeConfigReady,
            buildIdentityAccepted,
            nonce: guiSessionNonce,
          })) {
            return false;
          }
          const signature = [
            guiSessionNonce,
            playbackModeSocketGeneration,
            receiverBridgeConfigRevision ?? "unknown",
          ].join(":");
          if (receiverHandshakeCommitSignature === signature) {
            return true;
          }
          try {
            binaryWS.send(JSON.stringify({
              type: "RECEIVER_HANDSHAKE_COMMITTED",
              castMode: RECEIVER_BRANCH.mode,
              playbackCommands: ["PLAYBACK_START", "PLAYBACK_PAUSE", "PLAYBACK_STOP", "PLAYBACK_RESUME"],
              handshakeCommitVersion: 2,
              guiSessionNonce,
              socketGeneration: playbackModeSocketGeneration,
              lifecycleGeneration: workletLifecycleGeneration,
              bridgeConfigRevision: receiverBridgeConfigRevision,
              config: {
                sampleRate: window._hwRate || window._studioRate || 48000,
                bitDepth: 16,
              },
              buildIdentity: window.MXS_BUILD_IDENTITY,
              reason: reason || "bridge_authenticated",
            }));
            receiverHandshakeCommitSignature = signature;
            relayLogToStudio(
              "🤝 Receiver: Handshake committed after authenticated ACK + BRIDGE_CONFIG" +
                (reason ? " (" + reason + ")" : "") + ".",
            );
            selectPlaybackRoute("handshake_commit");
            return true;
          } catch (e) {
            relayLogToStudio("⚠️ Receiver: Handshake commit send failed: " + e.message);
            return false;
          }
        }

        function sendAuthenticatedGuiReady(bootStage) {
          if (
            !binaryWS ||
            binaryWS.readyState !== WebSocket.OPEN ||
            typeof guiSessionNonce !== "string" ||
            guiSessionNonce.length < 8
          ) return false;
          const stage = String(bootStage || "gui_revealed");
          const signature = guiSessionNonce + ":" + stage;
          if (lastGuiReadyNonce === signature) return true;
          try {
            sendReceiverBridgeMessage({
              type: "GUI_READY",
              transport: "gui",
              guiProtocolVersion: CAST_GUI_PROTOCOL_VERSION,
              guiSessionNonce,
              socketGeneration: playbackModeSocketGeneration,
              guiRevision: lastGuiRevision,
              latestSnapshotReplay: true,
              bootStage: stage,
            }, "gui");
            lastGuiReadyNonce = signature;
            relayLogToStudio("✅ Receiver: Authenticated GUI_READY sent; GUI snapshot replay is now safe.");
            return true;
          } catch (e) {
            relayLogToStudio("⚠️ Receiver: Authenticated GUI_READY send failed: " + e.message);
            return false;
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
        const cafTelemetryLastSentAt = Object.create(null);
        var lastNativePlayoutProofAt = 0;
        var lastNativePlayoutProofTime = null;

        function isBuildIdentity(value) {
          const legacy = !!(
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
          const compatible = !!(
            value &&
            typeof value === "object" &&
            value.schema === COMPATIBILITY_IDENTITY_SCHEMA &&
            value.version === COMPATIBILITY_IDENTITY_VERSION &&
            value.algorithm === "sha256" &&
            Object.keys(value).length === 7 &&
            value.artifacts &&
            typeof value.artifacts === "object" &&
            Object.keys(value.artifacts).length === BUILD_IDENTITY_COMPONENTS.length &&
            BUILD_IDENTITY_COMPONENTS.every(function (key) {
              return /^[a-f0-9]{64}$/.test(value.artifacts[key]);
            }) &&
            value.protocols &&
            typeof value.protocols === "object" &&
            Object.keys(value.protocols).length === COMPATIBILITY_PROTOCOL_KEYS.length &&
            COMPATIBILITY_PROTOCOL_KEYS.every(function (key) {
              return typeof value.protocols[key] === "string";
            }) &&
            value.schemas &&
            typeof value.schemas === "object" &&
            Object.keys(value.schemas).length === COMPATIBILITY_SCHEMA_KEYS.length &&
            COMPATIBILITY_SCHEMA_KEYS.every(function (key) {
              return typeof value.schemas[key] === "string";
            }) &&
            Array.isArray(value.capabilities) &&
            value.capabilities.length > 0 &&
            value.capabilities.every(function (capability) {
              return typeof capability === "string";
            }) &&
            new Set(value.capabilities).size === value.capabilities.length
          );
          return legacy || compatible;
        }

        function buildIdentitiesMatch(expected, received) {
          if (
            isBuildIdentity(expected) &&
            isBuildIdentity(received) &&
            expected.schema === COMPATIBILITY_IDENTITY_SCHEMA &&
            received.schema === COMPATIBILITY_IDENTITY_SCHEMA
          ) {
            return (
              COMPATIBILITY_PROTOCOL_KEYS.every(function (key) {
                return expected.protocols[key] === received.protocols[key];
              }) &&
              COMPATIBILITY_SCHEMA_KEYS.every(function (key) {
                return expected.schemas[key] === received.schemas[key];
              }) &&
              expected.capabilities.length === received.capabilities.length &&
              expected.capabilities.every(function (capability) {
                return received.capabilities.indexOf(capability) >= 0;
              })
            );
          }
          return (
            isBuildIdentity(expected) &&
            isBuildIdentity(received) &&
            expected.schema === BUILD_IDENTITY_SCHEMA &&
            received.schema === BUILD_IDENTITY_SCHEMA &&
            BUILD_IDENTITY_COMPONENTS.every(function (key) {
              return expected.components[key] === received.components[key];
            })
          );
        }

        function buildIdentityArtifactStatus(expected, received) {
          const expectedArtifacts = expected && (expected.artifacts || expected.components);
          const receivedArtifacts = received && (received.artifacts || received.components);
          const artifactMismatches = BUILD_IDENTITY_COMPONENTS.filter(function (key) {
            return !expectedArtifacts ||
              !receivedArtifacts ||
              expectedArtifacts[key] !== receivedArtifacts[key];
          });
          return {
            artifactParity: artifactMismatches.length === 0,
            artifactMismatches: artifactMismatches,
          };
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
            const artifactStatus = buildIdentityArtifactStatus(
              window.MXS_BUILD_IDENTITY,
              received,
            );
            try {
              sessionStorage.removeItem(BUILD_IDENTITY_RELOAD_SESSION_KEY);
            } catch (e) {}
            emitReceiverTelemetry(
              "✅ Receiver build identity verified: " +
                JSON.stringify({
                  event: "build_identity_verified",
                  role: "receiver",
                  match: true,
                  compatible: true,
                  artifactParity: artifactStatus.artifactParity,
                  artifactMismatches: artifactStatus.artifactMismatches,
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

        function identityAllowsGui() {
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

        // Track labels are copied from the sender's authenticated GUI snapshot.
        // They are optional Cast metadata only; the receiver never derives audio
        // identity from the media element or changes the native/PCM path here.
        function getSenderAuthoritativeTrackMetadata() {
          if (!lastMirroredState || !Array.isArray(lastMirroredState.tracks)) {
            return null;
          }
          const tracks = lastMirroredState.tracks
            .slice(0, 2)
            .map(function (track, index) {
              if (!track || typeof track !== "object") return null;
              const fileName = String(track.fileName || "").trim();
              if (!fileName) return null;
              return {
                trackId: String(track.trackId || index + 1),
                fileName,
                title: fileName,
              };
            })
            .filter(Boolean);
          if (tracks.length === 0) return null;
          const activeTrack = lastMirroredState.tracks.find(function (track) {
            return track && (track.isPlaying || track.isRecording);
          });
          return {
            tracks,
            activeTrackId: activeTrack ? String(activeTrack.trackId || "") : null,
          };
        }

        let remotePlaybackIntentRevision = 0;
        function requestSenderRemotePlayback(action) {
          if (!window._handshakeAcked || !receiverBridgeConfigReady || !guiSessionNonce) return false;
          const sent = sendReceiverBridgeMessage({
            type: "RECEIVER_REMOTE_PLAYBACK_INTENT", action,
            guiSessionNonce, playbackEpoch: lastPlaybackEpoch, playbackRevision: lastPlaybackRevision,
            remoteRevision: ++remotePlaybackIntentRevision,
          }, "gui", true);
          if (!sent) relayLogToStudio("Receiver remote control unavailable until the authenticated control bridge is ready.");
          return sent;
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
            audioPathOwner: activeAudioPathOwner,
            audioPathOwnerGeneration: castAudioOwnerArbiter.snapshot().generation,
            paused: playbackState === "PAUSED",
            reason: reason || "",
            timestampMs: Date.now(),
          };
          const trackMetadata = getSenderAuthoritativeTrackMetadata();
          if (trackMetadata) {
            customState.trackMetadata = trackMetadata;
          }
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
        // Native is the conservative first-session route. PCM becomes
        // eligible only after this receiver has demonstrated sustained
        // runtime timing, not merely that AudioWorklet.addModule succeeded.
        let receiverPlayoutPreference = "native";
        // Keep one route authoritative for each ordered Play. This prevents
        // a failed native recovery from bouncing back to PCM after PCM has
        // already declared its queue unsustainable.
        let playbackRouteDecision = null;
        // A route being selected/ready is not proof that speakers are receiving
        // audio. Keep an exactly-once audible edge for the current ordered Play
        // revision; the sender uses this edge to leave its starting state.
        let receiverPlayoutAudibleSignature = null;
        let pcmRenderedFramesAtPlaybackStart = 0;
        let lastPcmDiagRenderedFrames = 0;
        let nativeFallbackLockedForPlayback = false;
        let nativeStartupTimeoutObserved = false;
        let lowLatencyStartupRetryCount = 0;
        let pcmRuntimeQualificationWindows = 0;
        let activeAudioPathOwner = "none";
        window._activeAudioPathOwner = "none";
        window._receiverPlayoutPreference = receiverPlayoutPreference;

        function setActiveAudioPathOwner(path, reason) {
          const nextPath = path || "none";
          const socketGeneration = Number(playbackModeSocketGeneration);
          const ownerGeneration = Number.isSafeInteger(socketGeneration)
            ? socketGeneration
            : castAudioOwnerArbiter.snapshot().generation;
          const accepted = nextPath === "none"
            ? castAudioOwnerArbiter.release(activeAudioPathOwner === "none" ? "" : activeAudioPathOwner, ownerGeneration, reason || "owner_release")
            : activeAudioPathOwner === "native_caf_starting" && nextPath === "native_caf"
              ? castAudioOwnerArbiter.promote(
                  "native_caf_starting",
                  "native_caf",
                  ownerGeneration,
                  reason || "owner_promote",
                )
              : castAudioOwnerArbiter.claim(nextPath, ownerGeneration, reason || "owner_claim");
          if (!accepted) {
            const snapshot = castAudioOwnerArbiter.snapshot();
            relayLogToStudio(
              "⛔ Receiver: Rejected audio path owner transition " +
                activeAudioPathOwner + " -> " + nextPath +
                " (generation=" + ownerGeneration +
                ", active=" + snapshot.owner +
                ", activeGeneration=" + snapshot.generation +
                (reason ? ", reason=" + reason : "") + ").",
            );
            return false;
          }
          if (activeAudioPathOwner === nextPath) return true;
          const previousPath = activeAudioPathOwner;
          activeAudioPathOwner = nextPath;
          window._activeAudioPathOwner = nextPath;
          relayLogToStudio(
            "🎚️ Receiver audio path owner: " + previousPath + " -> " + nextPath +
              (reason ? " (" + reason + ")" : "") + ".",
          );
          return true;
        }

        function flushDeferredGuiState(reason) {
          if (
            pcmAudioPriorityActive ||
            Date.now() < playbackControlGuiHoldUntil ||
            !deferredGuiState
          ) {
            return false;
          }
          const state = deferredGuiState;
          const revision = deferredGuiRevision;
          deferredGuiState = null;
          deferredGuiRevision = -1;
          if (renderState(state, true)) {
            guiRenderedCount += 1;
            guiLastRenderedRevision = revision;
          }
          lastMirroredState = state;
          relayLogToStudio(
            "🎛️ Deferred GUI telemetry " + JSON.stringify({
              reason: reason || "priority_released",
              received: guiReceivedCount,
              deferred: guiDeferredCount,
              rendered: guiRenderedCount,
              acknowledged: guiAckCount,
              lastReceivedRevision: guiLastReceivedRevision,
              lastDeferredRevision: guiLastDeferredRevision,
              lastRenderedRevision: guiLastRenderedRevision,
              lastAckRevision: guiLastAckRevision,
            }),
          );
          return true;
        }

        function holdPlaybackControlGuiPriority(reason) {
          playbackControlGuiHoldUntil = Math.max(
            playbackControlGuiHoldUntil,
            Date.now() + PLAYBACK_CONTROL_GUI_HOLD_MS,
          );
          if (playbackControlGuiHoldTimerId) {
            clearTimeout(playbackControlGuiHoldTimerId);
          }
          playbackControlGuiHoldTimerId = setTimeout(() => {
            playbackControlGuiHoldTimerId = null;
            flushDeferredGuiState(reason || "playback_control_released");
          }, PLAYBACK_CONTROL_GUI_HOLD_MS);
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
          flushDeferredGuiState("pcm_priority_released");
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
          // A prior explicit AudioWorklet capability/runtime failure is a
          // device-level result (including legacy CAF receivers). Persist it
          // so reconnects do not repeat PCM startup churn.
          if (window._pcmDegraded) return "native";
          try {
            return localStorage.getItem(PCM_RUNTIME_QUALIFICATION_KEY) === "true"
              ? "pcm_fallback"
              : "native";
          } catch (e) {
            return "native";
          }
        }

        function setReceiverPlayoutPreference(mode, reason) {
          if (!mode || receiverPlayoutPreference === mode) {
            return;
          }
          if (playbackRouteDecision && playbackRouteDecision !== mode) {
            emitReceiverTelemetry(
              "⏭️ Receiver: Ignored route preference change after route selection " +
                playbackRouteDecision + " -> " + mode +
                (reason ? " (" + reason + ")" : "") + ".",
            );
            return;
          }
          receiverPlayoutPreference = mode;
          if (lastPlaybackStartSignalAt && !playbackRouteDecision) {
            playbackRouteDecision = mode;
          }
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

        function describeCafError(error) {
          if (error === null || error === undefined) {
            return { value: null };
          }
          if (typeof error !== "object") {
            return { value: String(error) };
          }
          const details = {};
          [
            "name",
            "message",
            "code",
            "errorCode",
            "detailedErrorCode",
            "reason",
            "type",
            "severity",
            "description",
            "status",
          ].forEach(function (key) {
            if (error[key] !== undefined && error[key] !== null) {
              details[key] = error[key];
            }
          });
          try {
            details.raw = JSON.parse(JSON.stringify(error));
          } catch (e) {
            details.raw = String(error);
          }
          if (!Object.keys(details).length) {
            details.value = String(error);
          }
          return details;
        }

        function formatCafError(error) {
          try {
            return JSON.stringify(describeCafError(error));
          } catch (e) {
            return String(error);
          }
        }

        function sendGuiChannelTelemetry(event, details = {}) {
          if (!guiControlWS || guiControlWS.readyState !== WebSocket.OPEN) return false;
          const payload = {
            type: "GUI_CHANNEL_TELEMETRY",
            transport: "gui",
            guiProtocolVersion: CAST_GUI_PROTOCOL_VERSION,
            guiSessionNonce,
            event,
            rawCount: guiRawMessageCount,
            receivedCount: guiReceivedCount,
            rejectedCount: guiRejectedCount,
            renderedCount: guiRenderedCount,
            acknowledgedCount: guiAckCount,
            lastRawRevision: guiLastRawRevision,
            lastReceivedRevision: guiLastReceivedRevision,
            lastRenderedRevision: guiLastRenderedRevision,
            lastAckRevision: guiLastAckRevision,
            lastRenderTimeMs: guiLastRenderTimeMs,
            lastPayloadBytes: guiLastPayloadBytes,
            lastRejectReason: guiLastRejectReason,
            ...details,
          };
          try {
            return sendReceiverBridgeMessage(payload, "gui");
          } catch (_error) {
            return false;
          }
        }

        function flushGuiChannelTelemetry() {
          if (guiChannelTelemetryTimer) {
            clearTimeout(guiChannelTelemetryTimer);
            guiChannelTelemetryTimer = null;
          }
          const eventCounts = guiChannelTelemetryEventCounts;
          const details = guiChannelTelemetryLastDetails;
          guiChannelTelemetryEventCounts = {};
          guiChannelTelemetryLastDetails = {};
          if (!Object.keys(eventCounts).length) return false;
          return sendGuiChannelTelemetry("summary", {
            intervalMs: GUI_CHANNEL_TELEMETRY_INTERVAL_MS,
            eventCounts,
            ...details,
          });
        }

        function emitGuiChannelTelemetry(event, details = {}) {
          const compactDetails = { ...details };
          delete compactDetails.surfaces;
          guiChannelTelemetryEventCounts[event] =
            (guiChannelTelemetryEventCounts[event] || 0) + 1;
          guiChannelTelemetryLastDetails = {
            ...guiChannelTelemetryLastDetails,
            ...compactDetails,
            lastEvent: event,
          };
          if (event === "rejected" || event === "action_result") {
            return flushGuiChannelTelemetry();
          }
          if (!guiChannelTelemetryTimer) {
            guiChannelTelemetryTimer = setTimeout(
              flushGuiChannelTelemetry,
              GUI_CHANNEL_TELEMETRY_INTERVAL_MS,
            );
          }
          return true;
        }

        function emitGuiChannelError(reason, details = {}) {
          if (!guiControlWS || guiControlWS.readyState !== WebSocket.OPEN) return false;
          const payload = {
            type: "GUI_ERROR",
            transport: "gui",
            guiProtocolVersion: CAST_GUI_PROTOCOL_VERSION,
            guiSessionNonce,
            reason: String(reason || "unknown_gui_error"),
            ...details,
          };
          try {
            return sendReceiverBridgeMessage(payload, "gui");
          } catch (_error) {
            return false;
          }
        }

        function emitCafTelemetry(event, details = {}) {
          if (!binaryWS || binaryWS.readyState !== WebSocket.OPEN) return false;
          const now = Date.now();
          const throttleMs = event === "MEDIA_STATUS" || event === "BUFFERING"
            ? CAF_TELEMETRY_MEDIA_EVENT_THROTTLE_MS
            : 0;
          if (throttleMs && now - Number(cafTelemetryLastSentAt[event] || 0) < throttleMs) return false;
          cafTelemetryLastSentAt[event] = now;
          const payload = {
            type: "CAF_TELEMETRY",
            transport: "cast_telemetry",
            protocolVersion: 1,
            guiSessionNonce,
            event: String(event || "unknown"),
            timestampMs: now,
            playbackMode: window._playbackMode || "unknown",
            nativeStreamActive: Boolean(nativeStreamActive),
            nativeStreamPaused: Boolean(nativeStreamPaused),
            ...details,
          };
          try {
            return sendReceiverBridgeMessage(payload);
          } catch (_error) {
            return false;
          }
        }

        function readNativeResumeMediaState() {
          const cafAudio = document.getElementById("cast-media-element");
          const htmlAudio = document.getElementById("native-stream-audio");
          const mediaElement = htmlAudio && htmlAudio.src && !htmlAudio.paused
            ? htmlAudio
            : cafAudio || htmlAudio;
          let playerState = "";
          try {
            const playerManager = getCastPlayerManager();
            if (playerManager && typeof playerManager.getPlayerState === "function") {
              playerState = String(playerManager.getPlayerState() || "");
            }
          } catch (_error) {}
          return {
            mediaElementId: mediaElement?.id || "native-media",
            currentTime: Number.isFinite(Number(mediaElement?.currentTime))
              ? Number(mediaElement.currentTime)
              : null,
            readyState: Number.isFinite(Number(mediaElement?.readyState))
              ? Number(mediaElement.readyState)
              : null,
            networkState: Number.isFinite(Number(mediaElement?.networkState))
              ? Number(mediaElement.networkState)
              : null,
            paused: mediaElement?.paused === true,
            muted: typeof mediaElement?.muted === "boolean" ? mediaElement.muted : null,
            volume: Number.isFinite(mediaElement?.volume) ? mediaElement.volume : null,
            playerState,
            nativeAttemptId: nativeStartupAttemptId,
          };
        }

        function classifyNativeResumeMediaState(mediaState) {
          const state = mediaState || {};
          const playerState = String(state.playerState || "").toUpperCase();
          const cafOwnsState = state.mediaElementId !== "native-stream-audio";
          if (cafOwnsState && /(^|[^A-Z])(IDLE|ERROR)([^A-Z]|$)/.test(playerState)) {
            return {
              resumable: false,
              reason: /ERROR/.test(playerState)
                ? "caf_player_error"
                : "caf_player_idle",
            };
          }
          if (Number(state.networkState) === 3) {
            return { resumable: false, reason: "native_media_no_source" };
          }
          if (
            state.paused === true &&
            Number.isFinite(Number(state.readyState)) &&
            Number(state.readyState) <= 1
          ) {
            return { resumable: false, reason: "native_media_empty_or_metadata_only" };
          }
          return { resumable: true, reason: "native_media_warm" };
        }

        function clearNativeOrderedResumeRecovery(reason) {
          if (nativeOrderedResumeRecoveryTimerId) {
            clearTimeout(nativeOrderedResumeRecoveryTimerId);
            nativeOrderedResumeRecoveryTimerId = null;
          }
          const recovery = nativeOrderedResumeRecovery;
          nativeOrderedResumeRecovery = null;
          if (recovery && reason) {
            writeCastDebug(
              "debug",
              "Cleared ordered native resume recovery revision=" +
                recovery.playbackRevision + " (" + reason + ").",
            );
          }
          return recovery;
        }

        function armNativeOrderedResumeRecoveryFallback() {
          if (!nativeOrderedResumeRecovery || nativeOrderedResumeRecoveryTimerId) {
            return false;
          }
          const recoveryEpoch = nativeOrderedResumeRecovery.playbackEpoch;
          const recoveryRevision = nativeOrderedResumeRecovery.playbackRevision;
          nativeOrderedResumeRecoveryTimerId = setTimeout(function () {
            nativeOrderedResumeRecoveryTimerId = null;
            if (
              !nativeOrderedResumeRecovery ||
              nativeOrderedResumeRecovery.playbackEpoch !== recoveryEpoch ||
              nativeOrderedResumeRecovery.playbackRevision !== recoveryRevision ||
              recoveryEpoch !== lastPlaybackEpoch ||
              recoveryRevision !== lastPlaybackRevision
            ) {
              return;
            }
            if (nativeStreamActive || nativeStreamStarting) {
              return;
            }
            const recovery = clearNativeOrderedResumeRecovery(
              "native_restart_unavailable_timeout",
            );
            emitCafTelemetry("CAF_RESUME_RESTART_FALLBACK", {
              playbackEpoch: recoveryEpoch,
              playbackRevision: recoveryRevision,
              reason: "fresh_native_start_unavailable",
              recoveryReason: recovery?.reason || null,
              timeoutMs: NATIVE_STARTUP_TIMEOUT_MS,
            });
            relayLogToStudio(
              "⚠️ Receiver: Fresh native resume could not start within the bounded budget; " +
                "opening prebuffered PCM fallback.",
            );
            setReceiverPlayoutPreference(
              "pcm_fallback",
              "ordered_native_resume_unavailable",
            );
            maybeStartLowLatencyPlayout("ordered_native_resume_fallback");
          }, NATIVE_STARTUP_TIMEOUT_MS);
          return true;
        }

        function restartUnavailableNativeResume(reason, playbackRevision) {
          if (!nativeStreamActive || !nativeStreamPaused) return false;
          const mediaState = readNativeResumeMediaState();
          const classification = nativeStreamUrl
            ? classifyNativeResumeMediaState(mediaState)
            : { resumable: false, reason: "native_stream_url_missing" };
          if (classification.resumable) return false;
          const revision = Number(playbackRevision);
          emitCafTelemetry("CAF_RESUME_RESTART", {
            playbackEpoch: lastPlaybackEpoch,
            playbackRevision: Number.isSafeInteger(revision) ? revision : null,
            reason: classification.reason,
            ...mediaState,
          });
          relayLogToStudio(
            "🔄 Receiver: Native resume media is unavailable (" +
              classification.reason +
              "); starting a fresh cache-busted /stream.wav immediately.",
          );
          // The ordered playback intent remains active. Clearing the stale
          // CAF item here makes requestNativePlaybackStart() take the proven
          // fresh-start path instead of waiting through the resume probe and
          // one-shot reload while the receiver is silent.
          stopNativeStreamPlayout("caf_resume_media_unavailable", true);
          nativeOrderedResumeRecovery = {
            playbackEpoch: lastPlaybackEpoch,
            playbackRevision: Number.isSafeInteger(revision)
              ? revision
              : lastPlaybackRevision,
            reason: classification.reason,
            startedAt: Date.now(),
          };
          const nativeRestartStarted = maybeStartNativeStream(
            "ordered_native_resume_recovery",
            false,
            false,
            true,
            true,
          );
          if (!nativeRestartStarted) {
            armNativeOrderedResumeRecoveryFallback();
          }
          return true;
        }

        function cancelNativeResumeProgressProbe(reason) {
          if (nativeResumeProbeTimerId) {
            clearTimeout(nativeResumeProbeTimerId);
            nativeResumeProbeTimerId = null;
          }
          if (nativeResumeProbe && reason) {
            writeCastDebug(
              "debug",
              "Cancelled ordered native resume probe revision=" +
                nativeResumeProbe.playbackRevision + " (" + reason + ").",
            );
          }
          nativeResumeProbe = null;
        }

        function failNativeResumeProgressProbe(reason, mediaState) {
          const probe = nativeResumeProbe;
          if (!probe) return false;
          const elapsedMs = Date.now() - probe.probeStartedAt;
          emitCafTelemetry("CAF_RESUME_FAILED", {
            playbackEpoch: probe.playbackEpoch,
            playbackRevision: probe.playbackRevision,
            elapsedMs,
            reloaded: Boolean(probe.reloaded),
            reason: reason || "native_resume_no_progress",
            ...(mediaState || readNativeResumeMediaState()),
          });
          relayLogToStudio(
            "❌ Receiver: Ordered native resume failed after bounded CAF recovery " +
              "(revision=" + probe.playbackRevision + ", reason=" +
              (reason || "native_resume_no_progress") + ").",
          );
          cancelNativeResumeProgressProbe("failed");
          stopNativeStreamPlayout("caf_resume_failed", true);
          return startPcmFallbackAfterNativeFailure("caf_resume_failed");
        }

        function noteNativeResumeProgress(currentTime, mediaState) {
          const probe = nativeResumeProbe;
          const nextTime = Number(currentTime);
          if (!probe || !Number.isFinite(nextTime)) return false;
          if (!Number.isFinite(probe.baselineTime)) {
            probe.baselineTime = nextTime;
            return false;
          }
          const advancedSeconds = nextTime - probe.baselineTime;
          if (advancedSeconds < CAF_NATIVE_RESUME_PROGRESS_EPSILON_SEC) return false;
          emitCafTelemetry("CAF_RESUME_RECOVERED", {
            playbackEpoch: probe.playbackEpoch,
            playbackRevision: probe.playbackRevision,
            elapsedMs: Date.now() - probe.probeStartedAt,
            reloaded: Boolean(probe.reloaded),
            advancedSeconds,
            ...(mediaState || readNativeResumeMediaState()),
          });
          relayLogToStudio(
            "✅ Receiver: Ordered native resume media clock recovered " +
              "(revision=" + probe.playbackRevision +
              ", reloaded=" + Boolean(probe.reloaded) + ").",
          );
          cancelNativeResumeProgressProbe("playout_progress");
          return true;
        }

        function reloadNativeStreamAfterOrderedResumeStall(playbackRevision, mediaState) {
          const probe = nativeResumeProbe;
          if (
            !probe ||
            probe.playbackRevision !== playbackRevision ||
            probe.playbackEpoch !== lastPlaybackEpoch ||
            playbackRevision !== lastPlaybackRevision ||
            lastOrderedPlaybackAction !== "PLAYBACK_START" ||
            playbackPaused ||
            nativeStreamPaused ||
            !nativeStreamActive ||
            !nativeStreamUrl
          ) {
            return false;
          }
          if (
            playbackRevision === nativeResumeReloadRevision &&
            probe.playbackEpoch === nativeResumeReloadEpoch
          ) {
            return false;
          }
          nativeResumeReloadRevision = playbackRevision;
          nativeResumeReloadEpoch = probe.playbackEpoch;
          const resumeCacheKey = Date.now() + "-" + playbackRevision;
          const cleanStreamUrl = nativeStreamUrl
            .replace(/([?&])resumeCb=[^&]*/g, "$1")
            .replace(/[?&]$/, "");
          const reloadStreamUrl = cleanStreamUrl +
            (cleanStreamUrl.indexOf("?") === -1 ? "?" : "&") +
            "resumeCb=" + resumeCacheKey;
          const reloadAttemptId = ++nativeStartupAttemptId;
          nativeStreamUrl = reloadStreamUrl;
          nativeStreamStarting = true;
          nativeStartupTrimPending = false;
          nativeStartupTrimState = "resume_reload";
          probe.reloaded = true;
          probe.phaseStartedAt = Date.now();
          probe.baselineTime = null;
          probe.nativeAttemptId = reloadAttemptId;
          emitCafTelemetry("CAF_RESUME_RELOAD", {
            playbackEpoch: probe.playbackEpoch,
            playbackRevision,
            elapsedMs: Date.now() - probe.probeStartedAt,
            reloadAttemptId,
            streamCacheKey: resumeCacheKey,
            ...(mediaState || readNativeResumeMediaState()),
          });
          relayLogToStudio(
            "🔄 Receiver: Ordered native resume clock stalled; reloading CAF once " +
              "(revision=" + playbackRevision + ", attempt=" + reloadAttemptId + ").",
          );
          if (!startCafStreamPlayout(reloadStreamUrl, reloadAttemptId)) {
            return failNativeResumeProgressProbe("caf_resume_reload_unavailable", mediaState);
          }
          return true;
        }

        function pollNativeResumeProgressProbe() {
          nativeResumeProbeTimerId = null;
          const probe = nativeResumeProbe;
          if (!probe) return;
          if (
            probe.playbackEpoch !== lastPlaybackEpoch ||
            probe.playbackRevision !== lastPlaybackRevision ||
            lastOrderedPlaybackAction !== "PLAYBACK_START" ||
            playbackPaused ||
            nativeStreamPaused ||
            !nativeStreamActive
          ) {
            cancelNativeResumeProgressProbe("ordered_resume_no_longer_active");
            return;
          }
          const mediaState = readNativeResumeMediaState();
          if (noteNativeResumeProgress(mediaState.currentTime, mediaState)) return;
          const phaseElapsedMs = Date.now() - probe.phaseStartedAt;
          const phaseTimeoutMs = probe.reloaded
            ? CAF_NATIVE_RESUME_RELOAD_TIMEOUT_MS
            : CAF_NATIVE_RESUME_PROBE_TIMEOUT_MS;
          if (phaseElapsedMs >= phaseTimeoutMs) {
            const fixedClock =
              !Number.isFinite(mediaState.currentTime) ||
              !Number.isFinite(probe.baselineTime) ||
              Math.abs(mediaState.currentTime - probe.baselineTime) <
                CAF_NATIVE_RESUME_PROGRESS_EPSILON_SEC;
            const buffering =
              mediaState.readyState === null ||
              mediaState.readyState <= 2 ||
              /BUFFERING/i.test(mediaState.playerState);
            if (!probe.reloaded && fixedClock && buffering) {
              reloadNativeStreamAfterOrderedResumeStall(
                probe.playbackRevision,
                mediaState,
              );
            } else {
              failNativeResumeProgressProbe(
                probe.reloaded ? "caf_resume_reload_no_progress" : "caf_resume_stalled_not_buffering",
                mediaState,
              );
              return;
            }
          }
          if (nativeResumeProbe) {
            nativeResumeProbeTimerId = setTimeout(
              pollNativeResumeProgressProbe,
              CAF_NATIVE_RESUME_PROBE_INTERVAL_MS,
            );
          }
        }

        function startNativeResumeProgressProbe(playbackRevision) {
          const revision = Number(playbackRevision);
          if (
            !Number.isSafeInteger(revision) ||
            revision < 0 ||
            revision !== lastPlaybackRevision ||
            lastOrderedPlaybackAction !== "PLAYBACK_START" ||
            !nativeStreamActive ||
            nativeStreamPaused ||
            playbackPaused
          ) {
            return false;
          }
          cancelNativeResumeProgressProbe("superseded_ordered_resume");
          const mediaState = readNativeResumeMediaState();
          const now = Date.now();
          nativeResumeProbe = {
            playbackEpoch: lastPlaybackEpoch,
            playbackRevision: revision,
            probeStartedAt: now,
            phaseStartedAt: now,
            baselineTime: mediaState.currentTime,
            nativeAttemptId: nativeStartupAttemptId,
            reloaded: false,
          };
          emitCafTelemetry("CAF_RESUME_PROBE", {
            playbackEpoch: lastPlaybackEpoch,
            playbackRevision: revision,
            timeoutMs: CAF_NATIVE_RESUME_PROBE_TIMEOUT_MS,
            ...mediaState,
          });
          nativeResumeProbeTimerId = setTimeout(
            pollNativeResumeProgressProbe,
            CAF_NATIVE_RESUME_PROBE_INTERVAL_MS,
          );
          return true;
        }

        function rejectGuiChannelMessage(reason, details = {}) {
          guiRejectedCount += 1;
          guiLastRejectReason = reason;
          emitGuiChannelTelemetry("rejected", { reason, ...details });
          emitGuiChannelError(reason, details);
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

        const RECEIVER_SAMPLER_COLUMNS = 5;
        const RECEIVER_SAMPLER_ROWS = 4;
        const RECEIVER_SAMPLER_PAD_COUNT =
          RECEIVER_SAMPLER_COLUMNS * RECEIVER_SAMPLER_ROWS;

        function lockReceiverSamplerGridLayout(sampleGrid) {
          return studioStructure?.lockSamplerGrid(sampleGrid) || false;
        }

        function isReceiverUiStructurallyComplete() {
          const root = document.getElementById("studio-root");
          const grid = document.getElementById("main-grid");
          const sampleGrid = document.getElementById("sample-grid");
          if (
            !root ||
            !grid ||
            !sampleGrid ||
            !lockReceiverSamplerGridLayout(sampleGrid)
          ) {
            return false;
          }
          const expectedTrackCount = Math.max(1, mirroredTrackCount || 4);
          for (let index = 0; index < expectedTrackCount; index++) {
            const track = document.getElementById("track-" + index);
            if (!track || track.parentNode !== grid) {
              return false;
            }
          }
          return true;
        }

        function revealReceiverUi(reason) {
          if (!document.body || window._receiverUiRevealed ||
              document.body.classList.contains("pure-screen-mirror-mode")) return false;
          if (window._receiverCastMode == null || window._receiverCastMode === "MIRROR_CAST") return false;
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
          window.dispatchEvent(new Event("cast-receiver-ui-revealed"));
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
            receiverPlayoutAudibleSignature = null;
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
              audioPathOwner: activeAudioPathOwner,
              audioPathOwnerGeneration: castAudioOwnerArbiter.snapshot().generation,
              socketGeneration: playbackModeSocketGeneration,
              lifecycleGeneration: workletLifecycleGeneration,
            };
            sendReceiverBridgeMessage({ type: "PLAYBACK_MODE", ...readiness });
            sendReceiverBridgeMessage({
              type: "PLAYOUT_STATE",
              state: readiness.ready ? "ready" : "selecting",
              ...readiness,
            });
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
            sendReceiverBridgeMessage({
              type: "PLAYOUT_STATE",
              state: "selecting",
              stage: stage || "unknown",
              mode: "unknown",
              reason: reason || "",
              ready: false,
              audioPathOwner: activeAudioPathOwner,
              audioPathOwnerGeneration: castAudioOwnerArbiter.snapshot().generation,
              socketGeneration: playbackModeSocketGeneration,
              lifecycleGeneration: workletLifecycleGeneration,
            });
          } catch (e) {}
        }

        function notifyPlayoutAudible(mode, reason, proof = {}) {
          if (
            !lastPlaybackStartSignalAt ||
            !binaryWS ||
            binaryWS.readyState !== WebSocket.OPEN ||
            !window._handshakeAcked ||
            !receiverBridgeConfigReady
          ) {
            return false;
          }
          const selectedMode = mode || window._playbackMode || "unknown";
          if (selectedMode === "unknown") return false;
          const signature = [
            selectedMode,
            lastPlaybackEpoch,
            lastPlaybackRevision,
            playbackModeSocketGeneration,
            workletLifecycleGeneration,
          ].join(":");
          if (receiverPlayoutAudibleSignature === signature) return false;
          const readiness = {
            type: "PLAYOUT_STATE",
            state: "audible",
            audible: true,
            mode: selectedMode,
            ready: true,
            reason: reason || "audible_proof",
            audioPathOwner: activeAudioPathOwner,
            audioPathOwnerGeneration: castAudioOwnerArbiter.snapshot().generation,
            socketGeneration: playbackModeSocketGeneration,
            lifecycleGeneration: workletLifecycleGeneration,
            playbackEpoch: lastPlaybackEpoch,
            playbackRevision: lastPlaybackRevision,
            proof: proof && typeof proof === "object" ? proof : {},
          };
          try {
            sendReceiverBridgeMessage(readiness);
            receiverPlayoutAudibleSignature = signature;
            relayLogToStudio(
              "🔊 Receiver: Audibility proven for " + selectedMode +
                (reason ? " (" + reason + ")" : "."),
            );
            return true;
          } catch (e) {
            return false;
          }
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
          const components =
            window.MXS_BUILD_IDENTITY &&
            (window.MXS_BUILD_IDENTITY.artifacts || window.MXS_BUILD_IDENTITY.components);
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
          if (result && result.supported === false) {
            pcmRuntimeQualificationWindows = 0;
            try {
              localStorage.removeItem(PCM_RUNTIME_QUALIFICATION_KEY);
            } catch (e) {}
          }
          emitReceiverTelemetry("AUDIO_WORKLET_CAPABILITY " + JSON.stringify(result));
          if (binaryWS && binaryWS.readyState === WebSocket.OPEN && window._handshakeAcked) {
            try {
              sendReceiverBridgeMessage({
                type: "AUDIO_PATH_CAPABILITY",
                pcm: { ...result },
                selectedPath: result.supported ? "pcm_v2" : "native_caf",
                authoritative: true,
              });
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
          // probe uses a content-addressed same-origin path because Cobalt
          // rejects query strings on AudioWorklet.addModule(). Keep the
          // capability result keyed by receiver build/generation in localStorage.
          const probeUrl = new URL(
            "pcm-capability-probe-b1d8e1d8fe17fa27f26034d7bbccc6cfa7ff0b6e7367d0042bcc02e45edb3601.js",
            (document.baseURI || window.location.href),
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
          pcmRuntimeQualificationWindows = 0;
          playbackRouteDecision = "native";
          nativeFallbackLockedForPlayback = true;
          try {
            localStorage.setItem("mxs_pcm_degraded", "true");
            localStorage.removeItem(PCM_RUNTIME_QUALIFICATION_KEY);
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
            const readyReason = reason || "playback_start_pcm_ready";
            if (
              activeAudioPathOwner !== "pcm_v2" &&
              !setActiveAudioPathOwner("pcm_v2", readyReason)
            ) {
              relayLogToStudio(
                "⛔ Receiver: PCM fallback is ready but could not claim audio ownership (" +
                  readyReason + ").",
              );
              return false;
            }
            notifyPlaybackMode("pcm_fallback", readyReason);
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
          // PCM is the primary live-sync path. Preload its AudioWorklet while
          // stopped so ordered PLAY can claim ownership without paying the
          // module-load cost. Native CAF remains fallback-only and must never
          // win ownership merely because PCM is still initializing.
          if (nativeStreamActive || nativeStreamStarting) {
            return false;
          }
          // A socket may still carry a non-ready native selection label from
          // an older generation even though no native node owns output. The
          // preload is standby-only, so preserve that label while allowing
          // AudioContext/worklet initialization to finish before Play.
          const initPromise = initAudio(false, true);
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

        function maybeStartNativeStream(
          reason,
          allowPriming = false,
          allowPcmCompanion = false,
          forcePrewarm = false,
          forceNativeOwnership = false,
        ) {
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
            !allowPcmCompanion &&
            !forceNativeOwnership
          ) {
            return false;
          }
          if (nativeStreamActive || nativeStreamStarting) {
            return true;
          }
          if (!configReceived || !currentBridgeIp) {
            return false;
          }
          if (activeAudioPathOwner !== "none" && activeAudioPathOwner !== "native_caf") {
            if (!setActiveAudioPathOwner("none", reason || "native_takeover")) {
              return false;
            }
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
          if (!setActiveAudioPathOwner("native_caf_starting", reason || "native_stream_starting")) {
            return false;
          }
          setPcmAudioPriority(false, reason || "native_stream_starting");
          // A native attempt is an ownership decision, even while CAF is
          // still buffering. This gates sender/backend PCM admission until
          // native either becomes ready or explicitly fails.
          notifyPlaybackMode(
            "native",
            reason || "native_stream_starting",
            false,
          );
          const shouldPrewarm =
            forcePrewarm ||
            (allowPriming && (!lastPlaybackStartSignalAt || allowPcmCompanion));
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
          receiverPlayoutAudibleSignature = null;
          pcmRenderedFramesAtPlaybackStart = lastPcmDiagRenderedFrames;
          if (!lastPlaybackStartSignalAt) {
            selectPlaybackRoute("playback_start");
            nativeStartupTimeoutObserved = false;
          }
          // Give each ordered Play one guarded native recovery attempt. A
          // second failure must settle instead of creating a restart loop.
          nativeFailureRetryAttempted = false;
          nativeStartupTrimRecoveryAttempted = false;
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

        function selectPlaybackRoute(reason) {
          if (playbackRouteDecision) return playbackRouteDecision;
          const selectedRoute =
            receiverPlayoutPreference === "pcm_fallback" && !window._pcmDegraded
              ? "pcm_fallback"
              : "native";
          playbackRouteDecision = selectedRoute;
          nativeFallbackLockedForPlayback = selectedRoute === "native";
          notifyPlayoutSelecting("route_selected", reason || "route_selection");
          relayLogToStudio(
            "🧭 Receiver: Playback route selected before Play: " + selectedRoute +
              (reason ? " (" + reason + ")" : "."),
          );
          if (selectedRoute === "native") {
            // Keep CAF muted while stopped; ordered PLAYBACK_START only
            // releases the already-prepared native item.
            maybeStartNativeStream("route_prepare_native", true, false, true);
          } else {
            preloadPcmWorklet("route_prepare_pcm");
          }
          return selectedRoute;
        }

        function notePcmRuntimeQualification(diag) {
          if (!diag || window._pcmDegraded || window._playbackMode !== "pcm_fallback") {
            return;
          }
          const measuredHz = Number(diag.measuredHz || diag.wallHz || 0);
          const healthy =
            diag.targetAcquired === true &&
            diag.qualityRunFailed !== true &&
            Number(diag.underruns || 0) === 0 &&
            Number(diag.emergencyFailures || 0) === 0 &&
            measuredHz >= PCM_RUNTIME_MIN_WALL_HZ;
          if (!healthy) {
            pcmRuntimeQualificationWindows = 0;
            return;
          }
          pcmRuntimeQualificationWindows += 1;
          if (pcmRuntimeQualificationWindows < PCM_RUNTIME_QUALIFICATION_WINDOWS_REQUIRED) {
            return;
          }
          try {
            localStorage.setItem(PCM_RUNTIME_QUALIFICATION_KEY, "true");
          } catch (e) {}
          if (pcmRuntimeQualificationWindows === PCM_RUNTIME_QUALIFICATION_WINDOWS_REQUIRED) {
            relayLogToStudio(
              "✅ Receiver: PCM runtime qualification stored after sustained healthy timing.",
            );
          }
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
              sendReceiverBridgeMessage({
                type: "RECEIVER_READY",
                castMode: RECEIVER_BRANCH.mode,
                guiSessionNonce,
                bridgeConfigRevision: receiverBridgeConfigRevision,
                reason: "native_recovery_retry",
                socketGeneration: playbackModeSocketGeneration,
                lifecycleGeneration: workletLifecycleGeneration,
              });
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

        function shouldIgnorePlayerManagerCommand(command, requestId) {
          if (Number.isSafeInteger(Number(requestId)) && Number(requestId) > 0) return false;
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
          return true;
        }

        function commitGuiRevision(message) {
          const revision = Number(message && message.guiRevision);
          if (Number.isSafeInteger(revision) && revision >= 0) {
            lastGuiRevision = revision;
          }
        }

        function resetGuiRevisionGate(reason) {
          lastGuiRevision = -1;
          guiRevisionStates.clear();
          if (pendingGuiRenderTimer !== null) clearTimeout(pendingGuiRenderTimer);
          pendingGuiRenderTimer = null;
          pendingGuiRenderState = null;
          lastCursorRevision = -1;
          studioDialogs?.reset();
          resetSmoothLfoVisuals();
          resetGuiClockSync(reason || "gui_revision_gate_reset");
          resetMirroredWaveformVisuals();
          resetMirroredTimelineState();
          if (reason) {
            writeCastDebug("debug", "GUI revision gate reset (" + reason + ").");
          }
        }

        function isReceiverInteractiveControl(element) {
          if (!element) return false;
          if (
            element.dataset.registryActionId &&
            element.dataset.registryDialogId &&
            window.MXSCastGuiActionCatalog?.isSupportedRegistryActionId?.(
              element.dataset.registryActionId,
            ) === true
          ) return true;
          if (
            element.dataset.dialogId &&
            (element.dataset.controlIndex !== undefined ||
              element.dataset.actionIndex !== undefined ||
              element.dataset.actionId)
          ) return true;
          if (!element.id) return false;
          return window.MXSCastGuiActionCatalog?.isSupportedTargetId?.(element.id) === true;
        }

        const pendingGuiInputTimers = new WeakMap();
        const lastGuiInputDispatch = new WeakMap();

        function readGuiInteractionValue(element) {
          if (!element) return "";
          if (element.type === "checkbox") return `checked:${element.checked ? "1" : "0"}`;
          return `value:${String(element.value ?? "")}`;
        }

        function sendGuiInteraction(element, kind, flushInput = false) {
          if (!isReceiverInteractiveControl(element)) return;
          if (!binaryWS || binaryWS.readyState !== WebSocket.OPEN) return;
          const interactionValue = readGuiInteractionValue(element);
          if (kind === "change") {
            const pending = pendingGuiInputTimers.get(element);
            if (pending) {
              clearTimeout(pending.timer);
              pendingGuiInputTimers.delete(element);
              sendGuiInteraction(element, "input", true);
              emitGuiChannelTelemetry("interaction_coalesced", {
                reason: "pending_input_before_change",
                targetId: element.id,
              });
              return;
            }
            const previous = lastGuiInputDispatch.get(element);
            if (previous?.kind === "input" && previous.value === interactionValue) {
              emitGuiChannelTelemetry("interaction_coalesced", {
                reason: "input_change_duplicate",
                targetId: element.id,
              });
              return;
            }
          }
          if (
            kind === "input" &&
            !flushInput &&
            element.matches?.("input[type=range]")
          ) {
            const previous = pendingGuiInputTimers.get(element);
            if (previous) clearTimeout(previous.timer);
            const timer = setTimeout(() => {
              pendingGuiInputTimers.delete(element);
              sendGuiInteraction(element, kind, true);
            }, 50);
            pendingGuiInputTimers.set(element, { timer, value: interactionValue });
            return;
          }
          guiInteractionRevision += 1;
          const guiActionProtocolVersion = 1;
          const actionId = `${guiSessionNonce}:${guiInteractionRevision}`;
          const targetKey =
            element.dataset.castTargetKey ||
            element.dataset.registryActionId ||
            element.id ||
            "registry-action";
          const commandName = element.dataset.registryActionId
            ? "registry.invoke"
            : kind === "click"
              ? "control.activate"
              : "control.set";
          const message = {
            type: "GUI_ACTION",
            transport: "gui",
            guiProtocolVersion: CAST_GUI_PROTOCOL_VERSION,
            guiSessionNonce,
            guiActionProtocolVersion,
            actionId,
            commandName,
            targetKey,
            senderGuiRevision: guiLastReceivedRevision,
            actionType: element.dataset.registryActionId ? "registry" : "interaction",
            guiInteractionRevision,
            kind,
            targetId: element.id || "registry-action",
            dialogId: element.dataset.dialogId || undefined,
            controlIndex: element.dataset.controlIndex === undefined ? undefined : Number(element.dataset.controlIndex),
            actionIndex: element.dataset.actionIndex === undefined ? undefined : Number(element.dataset.actionIndex),
            legacyActionId: element.dataset.actionId || undefined,
            value: element.type === "checkbox" ? undefined : element.value,
            checked: element.type === "checkbox" ? element.checked : undefined,
            parameterKey: element.dataset.parameterKey || element.dataset.param || undefined,
            optimisticDisplay: element.dataset.optimisticDisplay || undefined,
            confirmedDisplay: element.dataset.confirmedDisplay || undefined,
          };
          if (element.dataset.registryActionId) {
            message.registryActionId = element.dataset.registryActionId;
            message.registryDialogId = element.dataset.registryDialogId;
            const panel = element.closest("[data-registry-dialog-id]");
            const context = {};
            panel?.querySelectorAll("select[data-registry-context]").forEach((select) => {
              const key = select.dataset.registryContext;
              if (key) context[key] = Number(select.value);
            });
            message.registryContext = context;
          }
          try {
            markReceiverGuiInteractionPending(element, guiInteractionRevision, kind);
            if (!sendReceiverBridgeMessage(message, "gui")) {
              clearReceiverGuiInteractionFeedback(element);
              element.dataset.castInteractionState = "failed";
              emitGuiChannelTelemetry("action_queue_overflow", {
                revision: guiInteractionRevision,
                targetId: element.id,
                parameterKey: message.parameterKey || null,
              });
              return;
            }
            lastGuiInputDispatch.set(element, {
              kind,
              value: interactionValue,
            });
            emitGuiChannelTelemetry("interaction_sent", {
              revision: guiInteractionRevision,
              targetId: element.id,
              kind,
              parameterKey: message.parameterKey,
              rawValue: message.value,
              optimisticDisplay: message.optimisticDisplay,
              confirmedDisplay: message.confirmedDisplay,
            });
            relayLogToStudio("📡 Receiver: GUI interaction sent → " + element.id + " (" + kind + ")");
          } catch (e) {}
        }

        function clearReceiverGuiInteractionFeedback(element) {
          if (!element) return;
          const previousTimer = Number(element.dataset.castInteractionTimer || 0);
          if (previousTimer) clearTimeout(previousTimer);
          element.classList.remove("cast-interaction-pending", "cast-interaction-confirmed");
          element.style.outline = element.dataset.castPreviousOutline || "";
          element.style.outlineOffset = element.dataset.castPreviousOutlineOffset || "";
          element.style.boxShadow = element.dataset.castPreviousBoxShadow || "";
          delete element.dataset.castInteractionTimer;
          delete element.dataset.castPreviousOutline;
          delete element.dataset.castPreviousOutlineOffset;
          delete element.dataset.castPreviousBoxShadow;
          element.removeAttribute("aria-busy");
        }

        function markReceiverGuiInteractionPending(element, revision, kind) {
          if (!element) return;
          clearReceiverGuiInteractionFeedback(element);
          const exactDialog = element.closest?.(
            '.pad-settings-dialog[data-dialog-dom-schema="mxs-004.cast-dialog-dom.v1"]',
          );
          if (exactDialog) {
            element.dataset.castInteractionRevision = String(revision);
            element.dataset.castInteractionState = "pending";
            element.setAttribute("aria-busy", "true");
            return;
          }
          element.dataset.castPreviousOutline = element.style.outline || "";
          element.dataset.castPreviousOutlineOffset = element.style.outlineOffset || "";
          element.dataset.castPreviousBoxShadow = element.style.boxShadow || "";
          element.classList.add("cast-interaction-pending");
          element.dataset.castInteractionRevision = String(revision);
          element.dataset.castInteractionState = "pending";
          element.setAttribute("aria-busy", "true");
          element.style.outline = "2px solid #d4af37";
          element.style.outlineOffset = "2px";
          element.style.boxShadow = "0 0 12px rgba(212, 175, 55, 0.75)";
          const timer = setTimeout(() => {
            clearReceiverGuiInteractionFeedback(element);
            element.dataset.castInteractionState = "sent";
          }, kind === "input" ? 450 : 900);
          element.dataset.castInteractionTimer = String(timer);
        }

        function confirmReceiverGuiInteraction(revision) {
          const value = Number(revision);
          if (!Number.isSafeInteger(value) || value < 0) return;
          document.querySelectorAll("[data-cast-interaction-revision]").forEach((element) => {
            if (Number(element.dataset.castInteractionRevision) !== value) return;
            const previousTimer = Number(element.dataset.castInteractionTimer || 0);
            if (previousTimer) clearTimeout(previousTimer);
            const exactDialog = element.closest?.(
              '.pad-settings-dialog[data-dialog-dom-schema="mxs-004.cast-dialog-dom.v1"]',
            );
            if (exactDialog) {
              element.dataset.castInteractionState = "confirmed";
              element.removeAttribute("aria-busy");
              delete element.dataset.castInteractionTimer;
              return;
            }
            element.classList.remove("cast-interaction-pending");
            element.classList.add("cast-interaction-confirmed");
            element.dataset.castInteractionState = "confirmed";
            element.removeAttribute("aria-busy");
            element.style.outline = "2px solid #63d471";
            element.style.boxShadow = "0 0 12px rgba(99, 212, 113, 0.75)";
            delete element.dataset.castInteractionTimer;
            setTimeout(() => {
              clearReceiverGuiInteractionFeedback(element);
              element.dataset.castInteractionState = "confirmed";
            }, 650);
          });
        }

        function bindReceiverGuiInteractions() {
          const hydrateEffectSelect = (event) => {
            const target = event.target?.closest?.("select.effect-type-select");
            if (target) hydrateEffectOptionsSelect(target);
          };
          document.addEventListener("pointerdown", hydrateEffectSelect);
          document.addEventListener("focusin", hydrateEffectSelect);
          let lastSamplePadClick = 0;
          let lastSamplePadTarget = null;
          document.addEventListener("pointerdown", (event) => {
            const target = event.target && event.target.closest ? event.target.closest("button.sample-btn") : null;
            if (target && /^sample-\d+$/.test(target.id)) {
              if (target.dataset.padMode === "gate" || target.dataset.padMode === "release_loop") {
                sendGuiInteraction(target, "pad.down");
              }
            }
          });
          const handlePadRelease = (event) => {
            const target = event.target && event.target.closest ? event.target.closest("button.sample-btn") : null;
            if (target && /^sample-\d+$/.test(target.id)) {
              if (target.dataset.padMode === "gate" || target.dataset.padMode === "release_loop") {
                sendGuiInteraction(target, "pad.up");
              }
            }
          };
          document.addEventListener("pointerup", handlePadRelease);
          document.addEventListener("pointercancel", handlePadRelease);
          document.addEventListener("click", (event) => {
            const target = event.target && event.target.closest
              ? event.target.closest('button, label[data-dialog-id][data-action-index]')
              : null;
            if (target) {
              if (target.tagName === "LABEL") event.preventDefault();
              if (/^sample-\d+$/.test(target.id)) {
                if (target.dataset.padMode === "gate" || target.dataset.padMode === "release_loop") {
                  return; // Handled by pointerdown/pointerup
                }
                const now = Date.now();
                if (lastSamplePadTarget === target && now - lastSamplePadClick < 350) {
                  lastSamplePadClick = 0;
                  lastSamplePadTarget = null;
                  return;
                }
                lastSamplePadClick = now;
                lastSamplePadTarget = target;
              }
              sendGuiInteraction(target, "click");
            }
          });
          document.addEventListener("dblclick", (event) => {
            const target = event.target && event.target.closest ? event.target.closest("button") : null;
            if (target && /^sample-\d+$/.test(target.id)) {
              lastSamplePadClick = 0;
              lastSamplePadTarget = null;
              sendGuiInteraction(target, "settings");
            }
          });
          document.addEventListener("input", (event) => {
            const target = event.target;
            if (target && target.matches("input[type=range], input[type=checkbox]")) {
              if (target.type !== "checkbox") {
                applyOptimisticMirroredParameterDisplay(target);
                updateMirroredLoopMarker(target);
              }
              sendGuiInteraction(target, "input");
            }
          });
          document.addEventListener("change", (event) => {
            const target = event.target;
            if (
              target &&
              (target.tagName === "SELECT" ||
                target.tagName === "TEXTAREA" ||
                target.matches?.("input[type=range], input[type=checkbox], input[type=text]"))
            ) {
              sendGuiInteraction(target, "change");
            }
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
          const appliedAtEpochMs = Date.now();
          const appliedAtMonotonicMs = getLfoVisualNow();
          const receivedAtMonotonicMs = Number(message && message._receiverReceivedAtMonotonicMs);
          const receivedAtEpochMs = Number(message && message._receiverReceivedAtEpochMs);
          const issuedAtEpochMs = Number(message && message.issuedAtEpochMs);
          const receiverAudioClock = activeAudioPathOwner === "pcm_v2" && audioCtx
            ? {
                kind: "audio_context_frame",
                owner: activeAudioPathOwner,
                frame: Number.isFinite(Number(audioCtx.currentTime)) &&
                  Number.isFinite(Number(audioCtx.sampleRate))
                  ? Math.floor(Number(audioCtx.currentTime) * Number(audioCtx.sampleRate))
                  : null,
                timeSeconds: Number.isFinite(Number(audioCtx.currentTime))
                  ? Number(audioCtx.currentTime)
                  : null,
                sampleRate: Number.isFinite(Number(audioCtx.sampleRate))
                  ? Number(audioCtx.sampleRate)
                  : null,
              }
            : window._playbackMode === "native"
              ? {
                  kind: "native_media_playhead",
                  owner: "native_caf",
                  timeSeconds: readNativeResumeMediaState().currentTime,
                  frame: null,
                  sampleRate: null,
                }
              : { kind: "not_audible", owner: activeAudioPathOwner || "none", frame: null };
          // Ordered command acknowledgements share the independent control
          // lane with GUI ACKs and never queue behind PCM media.
          try {
            sendReceiverBridgeMessage({
                type: "PLAYBACK_COMMAND_ACK",
                action: ackAction,
                playbackEpoch,
                playbackRevision,
                desiredPlaybackState,
                receivedAtMonotonicMs: Number.isFinite(receivedAtMonotonicMs)
                  ? receivedAtMonotonicMs
                  : null,
                appliedAtMonotonicMs,
                receiverMonotonicQueueMs: Number.isFinite(receivedAtMonotonicMs)
                  ? Math.max(0, appliedAtMonotonicMs - receivedAtMonotonicMs)
                  : null,
                receiverAudioClock,
                requestedSourcePositionSec: Number.isFinite(message?.sourcePositionSec)
                  ? message.sourcePositionSec : Number.isFinite(message?.offset) ? message.offset : null,
                retainedAudioOwner: activeAudioPathOwner || "none",
                nativeAttemptId: nativeStartupAttemptId,
                workletReady: Boolean(workletReady),
                outputEvidence: "control_applied_only",
                receivedAtEpochMs: Number.isFinite(receivedAtEpochMs)
                  ? receivedAtEpochMs
                  : null,
                appliedAtEpochMs,
                receiverQueueMs: Number.isFinite(receivedAtEpochMs)
                  ? Math.max(0, appliedAtEpochMs - receivedAtEpochMs)
                  : null,
                senderToReceiverWallMs:
                  Number.isFinite(receivedAtEpochMs) && Number.isFinite(issuedAtEpochMs)
                    ? receivedAtEpochMs - issuedAtEpochMs
                    : null,
              });
          } catch (e) {}
        }

        function startNativeLatencyMonitor() {
          if (window._nativeLatencyIntervalId) {
            clearInterval(window._nativeLatencyIntervalId);
          }
          let latencySamples = [];
          let measurementKey = "";
          let lastSamplePlayhead = null;
          let lastSampleAt = 0;
          let lastReportAt = 0;
          let fastReportWindowUntilMs = 0;
          let continuousAudibleStartedAt = 0;
          let latencyReportTransportDropCount = 0;
          let lastLatencyReportDropDiagnosticAt = 0;
          window._nativeLatencyIntervalId = setInterval(() => {
            // Prewarm and paused media can have a large progressive-WAV tail,
            // but neither path is audible. Reporting either one as receiver
            // latency seeds the sender with a delay that never reached the TV
            // speakers. Only active, audible native playout is a valid sync
            // sample.
            if (
              !nativeStreamActive ||
              nativeStreamPaused ||
              window._playbackMode !== "native"
            ) {
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

            const reportedLiveEdge = activeAudio.buffered.end(activeAudio.buffered.length - 1);
            const reportedPlayhead = activeAudio.currentTime;
            const reportedBufferedStart = activeAudio.buffered.start(activeAudio.buffered.length - 1);
            const progressNow = Date.now();
            const nextMeasurementKey = [
              lastPlaybackEpoch,
              lastPlaybackRevision,
              nativeStartupAttemptId,
              activeAudio.id || "native-media",
            ].join(":");
            if (measurementKey !== nextMeasurementKey) {
              measurementKey = nextMeasurementKey;
              latencySamples = [];
              lastSamplePlayhead = null;
              lastSampleAt = 0;
              lastReportAt = 0;
              fastReportWindowUntilMs = progressNow + NATIVE_LATENCY_FAST_REPORT_WINDOW_MS;
              continuousAudibleStartedAt = progressNow;
              latencyReportTransportDropCount = 0;
              lastLatencyReportDropDiagnosticAt = 0;
            }
            // Report the observed transport buffer only. Seeking the live media
            // element to chase a moving latency target creates an audible jump,
            // breaks source-frame continuity, and makes the sender's local delay
            // chase the receiver. Native playback remains at playbackRate 1.0;
            // the sender applies only bounded alignment updates. Sample faster
            // than the reporting cadence so progressive-media refill edges are
            // summarized rather than mistaken for presentation-clock jumps.
            const rawLatency = reportedLiveEdge - reportedPlayhead;
            const reportedBufferedDuration = Math.max(
              0,
              reportedLiveEdge - reportedBufferedStart,
            );
            const outputAudible =
              activeAudio.muted !== true &&
              Number(activeAudio.volume) > 0.001;
            if (!Number.isFinite(rawLatency) || rawLatency < 0 || !outputAudible) {
              continuousAudibleStartedAt = 0;
              return;
            }
            const samplePlayheadAdvance = Number.isFinite(lastSamplePlayhead)
              ? reportedPlayhead - lastSamplePlayhead
              : null;
            const sampleWallIntervalMs = lastSampleAt > 0
              ? progressNow - lastSampleAt
              : null;
            if (Number.isFinite(samplePlayheadAdvance) && samplePlayheadAdvance < 0.01) {
              continuousAudibleStartedAt = 0;
              return;
            }
            if (continuousAudibleStartedAt <= 0) {
              continuousAudibleStartedAt = progressNow;
            }
            lastSamplePlayhead = reportedPlayhead;
            lastSampleAt = progressNow;
            latencySamples.push({
              at: progressNow,
              latency: rawLatency,
              liveEdge: reportedLiveEdge,
              playhead: reportedPlayhead,
            });
            latencySamples = latencySamples.filter(
              (sample) => progressNow - sample.at <= NATIVE_LATENCY_ROLLING_WINDOW_MS,
            );
            if (
              Number.isFinite(lastNativePlayoutProofTime) &&
              reportedPlayhead + 0.05 < lastNativePlayoutProofTime
            ) {
              lastNativePlayoutProofTime = null;
            }
            const playoutAdvanced =
              !Number.isFinite(lastNativePlayoutProofTime) ||
              reportedPlayhead - lastNativePlayoutProofTime >= 0.05;
            // A ready, unmuted media element at time=0 is not proof that the
            // receiver has rendered real audio. Require a post-boundary clock
            // advance before announcing audibility so a silent prewarm cannot
            // unlock sender sync or UI state.
            const startupPlaybackAdvanced =
              Number.isFinite(samplePlayheadAdvance) &&
              samplePlayheadAdvance >= 0.05;
            if (
              outputAudible &&
              startupPlaybackAdvanced &&
              playoutAdvanced &&
              progressNow - lastNativePlayoutProofAt >= 1000
            ) {
              notifyPlayoutAudible("native", "native_progress", {
                mediaElementId: activeAudio.id || "native-media",
                currentTime: reportedPlayhead,
                previousTime: lastNativePlayoutProofTime,
                advancedSeconds: Number.isFinite(lastNativePlayoutProofTime)
                  ? Math.max(0, reportedPlayhead - lastNativePlayoutProofTime)
                  : null,
                startupAdvanceSeconds: samplePlayheadAdvance,
                readyState: activeAudio.readyState,
                muted: activeAudio.muted === true,
                volume: Number(activeAudio.volume),
                nativeAttemptId: nativeStartupAttemptId,
              });
              noteNativeResumeProgress(reportedPlayhead, {
                mediaElementId: activeAudio.id || "native-media",
                currentTime: reportedPlayhead,
                readyState: activeAudio.readyState,
                networkState: activeAudio.networkState,
                paused: activeAudio.paused === true,
                playerState: "PLAYING",
                nativeAttemptId: nativeStartupAttemptId,
              });
              emitCafTelemetry("PLAYOUT_PROGRESS", {
                mediaElementId: activeAudio.id || "native-media",
                currentTime: reportedPlayhead,
                previousTime: lastNativePlayoutProofTime,
                advancedSeconds: Number.isFinite(lastNativePlayoutProofTime)
                  ? Math.max(0, reportedPlayhead - lastNativePlayoutProofTime)
                  : null,
                readyState: activeAudio.readyState,
                networkState: activeAudio.networkState,
                muted: activeAudio.muted === true,
                volume: Number(activeAudio.volume),
                bufferedEnd: reportedLiveEdge,
              });
              lastNativePlayoutProofAt = progressNow;
              lastNativePlayoutProofTime = reportedPlayhead;
            }

            const reportIntervalMs = progressNow < fastReportWindowUntilMs
              ? NATIVE_LATENCY_FAST_REPORT_INTERVAL_MS
              : NATIVE_LATENCY_REPORT_INTERVAL_MS;
            if (
              progressNow - lastReportAt < reportIntervalMs ||
              latencySamples.length < NATIVE_LATENCY_MIN_REPORT_SAMPLES
            ) {
              return;
            }
            const sortedLatencies = latencySamples
              .map((sample) => sample.latency)
              .sort((a, b) => a - b);
            const medianLatency = sortedLatencies[Math.floor(sortedLatencies.length / 2)];
            const deviations = sortedLatencies
              .map((sample) => Math.abs(sample - medianLatency))
              .sort((a, b) => a - b);
            const medianAbsoluteDeviation = deviations[Math.floor(deviations.length / 2)];
            const rawMinLatency = sortedLatencies[0];
            const rawMaxLatency = sortedLatencies[sortedLatencies.length - 1];
            const rawSpan = rawMaxLatency - rawMinLatency;
            lastReportAt = progressNow;

            if (binaryWS && binaryWS.readyState === WebSocket.OPEN) {
              // Latency is a sampled observation, not replayable control state.
              // A queued report would retain its old sampleAgeMs across a GUI
              // outage and appear fresh when flushed after reconnect.
              const reportSent = sendReceiverBridgeMessage({
                  type: "NATIVE_LATENCY_REPORT",
                  latency: medianLatency,
                  syncComponents: {
                    source: "native_media_buffer",
                    pathOwner: "native_caf",
                    playbackMode: window._playbackMode || "unknown",
                    estimator: "rolling_median_v1",
                    measurementConfidence:
                      rawSpan <= 0.35 && medianAbsoluteDeviation <= 0.18
                        ? "bootstrap_coherent"
                        : "rolling_noisy",
                    reportIntervalMs,
                    reportAtEpochMs: progressNow,
                    sampleAgeMs: Math.max(0, progressNow - latencySamples[latencySamples.length - 1].at),
                    sampleCount: latencySamples.length,
                    sampleWindowMs: progressNow - latencySamples[0].at,
                    rawLatencySeconds: rawLatency,
                    rawMinLatencySeconds: rawMinLatency,
                    rawMaxLatencySeconds: rawMaxLatency,
                    rawSpanSeconds: rawSpan,
                    medianAbsoluteDeviationSeconds: medianAbsoluteDeviation,
                    continuousAudibleMs: Math.max(0, progressNow - continuousAudibleStartedAt),
                    samplePlayheadAdvanceSeconds: samplePlayheadAdvance,
                    sampleWallIntervalMs,
                    liveEdgeSeconds: reportedLiveEdge,
                    playheadSeconds: reportedPlayhead,
                    bufferedStartSeconds: reportedBufferedStart,
                    bufferedEndSeconds: reportedLiveEdge,
                    bufferedDurationSeconds: reportedBufferedDuration,
                    mediaReadyState: activeAudio.readyState,
                    mediaNetworkState: activeAudio.networkState,
                    outputAudible,
                    playoutAdvanced,
                    playbackEpoch: lastPlaybackEpoch,
                    playbackRevision: lastPlaybackRevision,
                    startupAttemptId: nativeStartupAttemptId,
                  },
                }, "gui", true);
              if (!reportSent) {
                latencyReportTransportDropCount += 1;
                if (
                  latencyReportTransportDropCount === 1 ||
                  progressNow - lastLatencyReportDropDiagnosticAt >= 5000
                ) {
                  lastLatencyReportDropDiagnosticAt = progressNow;
                  console.warn(JSON.stringify({
                    type: "NATIVE_LATENCY_REPORT_TRANSPORT",
                    action: "dropped",
                    reason: !guiControlWS || guiControlWS.readyState !== WebSocket.OPEN
                      ? "gui_control_unavailable"
                      : "gui_control_send_failed",
                    consecutiveDrops: latencyReportTransportDropCount,
                    mediaSocketState: binaryWS?.readyState ?? null,
                    guiSocketState: guiControlWS?.readyState ?? null,
                    reportAtEpochMs: progressNow,
                  }));
                }
              } else if (latencyReportTransportDropCount > 0) {
                console.info(JSON.stringify({
                  type: "NATIVE_LATENCY_REPORT_TRANSPORT",
                  action: "recovered",
                  consecutiveDrops: latencyReportTransportDropCount,
                  reportAtEpochMs: progressNow,
                }));
                latencyReportTransportDropCount = 0;
                lastLatencyReportDropDiagnosticAt = 0;
              }
            }
          }, NATIVE_LATENCY_SAMPLE_INTERVAL_MS);
        }

        function clearPlaybackStartSignal() {
          lastPlaybackStartSignalAt = 0;
          receiverPlayoutAudibleSignature = null;
        }

        function clearNativeStartupTrimRetry() {
          if (nativeStartupTrimRetryTimerId) {
            clearTimeout(nativeStartupTrimRetryTimerId);
            nativeStartupTrimRetryTimerId = null;
          }
          nativeStartupTrimRetryStartedAt = 0;
        }

        function releasePendingNativeStartupTrim() {
          if (!nativeStartupTrimPending || !lastPlaybackStartSignalAt) {
            return false;
          }
          const activeAudio = getNativeStreamElements().find(function findPreparedNativeElement(element) {
            return !!(
              element &&
              (!element.paused || element.readyState >= 2) &&
              element.readyState >= 2 &&
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
          if (!mutedForPrewarm) {
            nativeStartupTrimPending = false;
            nativeStartupTrimState = "skipped_audible";
            relayLogToStudio("⏭️ Receiver: Skipped native startup trim because output was already audible.");
            logReceiverStartupTiming("native_startup_trim_skipped_audible", {
              nativeAttemptId: nativeStartupAttemptId,
            });
            return true;
          }
          try {
            const liveEdge = activeAudio.buffered.end(activeAudio.buffered.length - 1);
            const playhead = activeAudio.currentTime;
            const latency = liveEdge - playhead;
            if (latency <= NATIVE_STARTUP_TRIM_THRESHOLD_SEC) {
              nativeStartupTrimPending = false;
              nativeStartupTrimState = "not_needed";
              logReceiverStartupTiming("native_startup_trim_not_needed", {
                nativeAttemptId: nativeStartupAttemptId,
                latencyBeforeSec: latency,
              });
              return true;
            }
            const bufferedStart = activeAudio.buffered.start(activeAudio.buffered.length - 1);
            const effectiveTargetSec = Math.max(NATIVE_STARTUP_TARGET_SEC, NATIVE_SAFE_DECODE_BUFFER_SEC);
            const trimTarget = Math.max(bufferedStart, liveEdge - effectiveTargetSec);
            if (trimTarget <= playhead + 0.25) {
              nativeStartupTrimPending = false;
              nativeStartupTrimState = "not_needed";
              logReceiverStartupTiming("native_startup_trim_not_needed", {
                nativeAttemptId: nativeStartupAttemptId,
                latencyBeforeSec: latency,
              });
              return true;
            }
            activeAudio.currentTime = trimTarget;
            nativeStartupTrimPending = false;
            nativeStartupTrimState = "trimmed";
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
            nativeStartupTrimState = "retrying";
            logReceiverStartupTiming("native_startup_trim_retryable_error", {
              nativeAttemptId: nativeStartupAttemptId,
              error: String(trimError && trimError.message ? trimError.message : trimError),
            });
            return false;
          }
        }

        function scheduleNativeStartupTrimRetry(modeReason, logMessage, attemptId) {
          if (!nativeStartupTrimPending || !lastPlaybackStartSignalAt) {
            return false;
          }
          if (!nativeStartupTrimRetryStartedAt) {
            nativeStartupTrimRetryStartedAt = Date.now();
            nativeStartupTrimState = "retrying";
            logReceiverStartupTiming("native_startup_trim_waiting", {
              nativeAttemptId: nativeStartupAttemptId,
              retryMs: NATIVE_STARTUP_TRIM_RETRY_MS,
              timeoutMs: NATIVE_STARTUP_TRIM_RETRY_TIMEOUT_MS,
            });
          }
          if (Date.now() - nativeStartupTrimRetryStartedAt >= NATIVE_STARTUP_TRIM_RETRY_TIMEOUT_MS) {
            clearNativeStartupTrimRetry();
            if (!nativeStartupTrimRecoveryAttempted) {
              nativeStartupTrimRecoveryAttempted = true;
              nativeStartupTrimPending = false;
              nativeStartupTrimState = "restart_requested";
              emitCafTelemetry("CAF_NATIVE_STARTUP_RELOAD", {
                playbackEpoch: lastPlaybackEpoch,
                playbackRevision: lastPlaybackRevision,
                nativeAttemptId: nativeStartupAttemptId,
                timeoutMs: NATIVE_STARTUP_TRIM_RETRY_TIMEOUT_MS,
                reason: "native_startup_trim_unseekable",
              });
              relayLogToStudio(
                "⚠️ Receiver: Native live-edge trim was not seekable within " +
                  NATIVE_STARTUP_TRIM_RETRY_TIMEOUT_MS +
                  "ms; replacing the stale prewarm stream before unmute.",
              );
              logReceiverStartupTiming("native_startup_trim_timeout", {
                nativeAttemptId: nativeStartupAttemptId,
                timeoutMs: NATIVE_STARTUP_TRIM_RETRY_TIMEOUT_MS,
                action: "fresh_native_stream",
              });
              // Keep the ordered Play intent active while discarding the
              // unseekable progressive-WAV tail. The fresh stream is opened
              // after the Play boundary, so its bounded preroll cannot hide
              // real PCM behind seconds of stale prewarm silence.
              stopNativeStreamPlayout("native_startup_trim_unseekable", true);
              const restarted = maybeStartNativeStream(
                "native_startup_trim_restart",
                false,
                false,
                false,
                true,
              );
              if (restarted) {
                relayLogToStudio(
                  "🔄 Receiver: Fresh native stream requested after unseekable prewarm trim.",
                );
                return true;
              }
              relayLogToStudio(
                "⚠️ Receiver: Fresh native stream could not start after trim failure; opening PCM fallback.",
              );
              return startPcmFallbackAfterNativeFailure(
                "native_startup_trim_restart_unavailable",
              );
            }
            nativeStartupTrimPending = false;
            nativeStartupTrimState = "timeout";
            relayLogToStudio(
              "⚠️ Receiver: Native startup trim recovery was already attempted; opening PCM fallback.",
            );
            logReceiverStartupTiming("native_startup_trim_timeout", {
              nativeAttemptId: nativeStartupAttemptId,
              timeoutMs: NATIVE_STARTUP_TRIM_RETRY_TIMEOUT_MS,
              action: "pcm_fallback",
            });
            return startPcmFallbackAfterNativeFailure(
              "native_startup_trim_recovery_exhausted",
            );
          }
          if (nativeStartupTrimRetryTimerId) {
            return true;
          }
          nativeStartupTrimRetryTimerId = setTimeout(() => {
            nativeStartupTrimRetryTimerId = null;
            if (!isCurrentNativeAttempt(attemptId) || !nativeStreamStarting) {
              clearNativeStartupTrimRetry();
              return;
            }
            activateNativeStream(modeReason, logMessage, attemptId);
          }, NATIVE_STARTUP_TRIM_RETRY_MS);
          return true;
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
          getNativeStreamElements().forEach(function requestElementPlay(element) {
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
          if (nativeOrderedResumeRecovery) {
            const nativeRestartStarted = maybeStartNativeStream(
              "ordered_native_resume_recovery",
              false,
              false,
              true,
              true,
            );
            if (!nativeRestartStarted) {
              armNativeOrderedResumeRecoveryFallback();
            }
            // This ordered revision owns a bounded fresh native attempt. PCM
            // must not cold-start in the same command turn and race CAF.
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
          const installMessageInterceptor = function (type, handler, label) {
            if (!type || typeof pm.setMessageInterceptor !== "function") {
              return false;
            }
            try {
              pm.setMessageInterceptor(type, handler);
              return true;
            } catch (error) {
              // CAF versions on physical Chromecast devices do not expose the
              // same queue message aliases. An unsupported alias must not
              // abort the entire receiver startup (notably "QUE").
              relayLogToStudio(
                "⚠️ Receiver: CAF ignored unsupported " +
                  (label || String(type)) +
                  " interceptor: " +
                  (error && error.message ? error.message : String(error)),
              );
              return false;
            }
          };

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

          // CAF's supported-command mask is the primary policy boundary. The
          // explicit interceptors below also return an error for remote/voice
          // requests that CAF exposes as message types, while preserving the
          // internal requestId=0 STOP lifecycle used by the native prewarm path.
          const rejectUnsupportedRemoteCommand = function (commandName, request) {
            const messages = cast.framework.messages;
            const errorTypes = messages.ErrorType || {};
            const errorReasons = messages.ErrorReason || {};
            const error = new messages.ErrorData(
              errorTypes.INVALID_REQUEST || errorTypes.LOAD_FAILED,
            );
            error.reason = errorReasons.INVALID_REQUEST;
            relayLogToStudio(
              "⛔ Receiver: rejected unsupported remote command " +
                commandName +
                " (requestId=" +
                (request && request.requestId !== undefined ? request.requestId : "n/a") +
                ").",
            );
            return error;
          };

          const unsupportedRemoteMessageTypes = [
            [messageType.SEEK, "SEEK"],
            [messageType.NEXT, "NEXT"],
            [messageType.PREVIOUS, "PREVIOUS"],
            [messageType.SET_PLAYBACK_RATE, "PLAYBACK_RATE"],
            [messageType.PLAYBACK_RATE, "PLAYBACK_RATE"],
          ];
          const installedUnsupportedMessageTypes = new Set();
          unsupportedRemoteMessageTypes.forEach(function (entry) {
            const type = entry[0];
            if (!type || installedUnsupportedMessageTypes.has(type)) return;
            installedUnsupportedMessageTypes.add(type);
            installMessageInterceptor(
              type,
              function (request) {
                return rejectUnsupportedRemoteCommand(entry[1], request);
              },
              entry[1],
            );
          });

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

          if (messageType && messageType.LOAD) {
            installMessageInterceptor(messageType.LOAD, function (request) {
              writeCastDebug("info", "Intercepting LOAD request");
              emitCafTelemetry("LOAD", {
                contentId: request?.media?.contentId || null,
                contentUrl: request?.media?.contentUrl
                  ? redactBridgeUrl(request.media.contentUrl)
                  : null,
                source: request?.media?.customData?.source || null,
              });
              if (!request || !request.media || !identityAllowsAudio()) {
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
                let validStream = false;
                try {
                  const target = new URL(streamUrl);
                  const expected = new URL(`http://${currentBridgeIp}:${currentBridgePort}/stream.wav`);
                  validStream = target.origin === expected.origin && target.pathname === "/stream.wav" &&
                    !target.username && !target.password && !target.hash &&
                    target.searchParams.get("token") === currentBridgeStreamToken && !!currentBridgeStreamToken;
                } catch (_) {}
                if (!validStream) {
                  const error = new cast.framework.messages.ErrorData(
                    cast.framework.messages.ErrorType.LOAD_FAILED,
                  );
                  error.reason = cast.framework.messages.ErrorReason.INVALID_REQUEST;
                  writeCastDebug("error", "Rejected mxs-native-stream LOAD request with no streamUrl.");
                  return error;
                }
                request.media.contentType = "audio/wav";
                request.media.streamType = cast.framework.messages.StreamType.LIVE;
                // CAF Live API audit target: duration=-1. Keep the current
                // native stream contract unchanged until physical Chromecast
                // QA validates that switch; production currently uses null.
                request.media.duration = null;
                request.media.contentUrl = streamUrl;
                if (!request.media.customData) {
                  request.media.customData = {};
                }
                request.media.customData.streamUrl = streamUrl;
                const trackMetadata = getSenderAuthoritativeTrackMetadata();
                if (trackMetadata) {
                  request.media.customData.trackMetadata = trackMetadata;
                }
                writeCastDebug("warn", "Mapped mxs-native-stream LOAD to " + redactBridgeUrl(streamUrl));
              } else {
                const error = new cast.framework.messages.ErrorData(cast.framework.messages.ErrorType.LOAD_FAILED);
                error.reason = cast.framework.messages.ErrorReason.INVALID_REQUEST;
                return error;
              }
              return request;
            }, "LOAD");

            // Hardware Play/Pause requests belong to the sender's source
            // arbiter. Suppress CAF's independent state change, then apply
            // the resulting ordered control to the retained receiver owner.
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
                if (shouldIgnorePlayerManagerCommand(command, request && request.requestId)) {
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
                if (command === "PLAY" || command === "PAUSE") {
                  requestSenderRemotePlayback(command === "PAUSE" ? "pause" : "play");
                } else if (command === "STOP") {
                  stopAllPlayout("player_manager_stop", undefined, true);
                }
              }, 0);
              return command === "PLAY" || command === "PAUSE" ? null : request;
            };

            [
              [messageType.PLAY, "PLAY"],
              [messageType.PAUSE, "PAUSE"],
              [messageType.STOP, "STOP"],
            ].forEach(function (entry) {
              if (!entry[0]) {
                return;
              }
              installMessageInterceptor(
                entry[0],
                function (request) {
                  if (entry[1] === "STOP" && Number(request && request.requestId) !== 0) {
                    return rejectUnsupportedRemoteCommand("STOP", request);
                  }
                  return deferPlayerManagerCommand(entry[1], request);
                },
                entry[1],
              );
            });
          }
          cafLoadInterceptorConfigured = true;
          relayLogToStudio("✅ Receiver: CAF playback handlers configured for native stream.");
        }

        function acceptCafPrewarmReady(attemptId) {
          if (!isCurrentNativeAttempt(attemptId) || !nativeStreamStarting || !nativeStreamUrl) return false;
          nativeStreamPrewarmReady = true;
          muteNativeStreamPrewarmOutput(document.getElementById("cast-media-element"));
          if (lastPlaybackStartSignalAt && nativeStreamCompanionForPcm) {
            activateNativeStream("caf_preplay_ready_after_play",
              "✅ Receiver: CAF native /stream.wav prewarm became ready after PLAYBACK_START.", attemptId);
          } else if (nativePrewarmReadyAnnouncedForAttempt !== attemptId) {
            nativePrewarmReadyAnnouncedForAttempt = attemptId;
            relayLogToStudio("✅ Receiver: CAF native /stream.wav prewarm ready; waiting for PLAYBACK_START.");
          }
          return true;
        }

        function configureCafPlayerDebugEvents() {
          const pm = getCastPlayerManager();
          if (!pm || pm._mxsDebugEventsConfigured || typeof pm.addEventListener !== "function") {
            return;
          }
          const events = cast.framework.events && cast.framework.events.EventType ? cast.framework.events.EventType : {};
          const messages = cast.framework.messages || {};
          [
            events.BUFFERING,
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
                try {
                const mediaStatus = event && event.mediaStatus ? event.mediaStatus : null;
                const eventContentId = mediaStatus?.media?.contentId || pm.getMediaInformation?.()?.contentId;
                const eventAttemptMatch = /^mxs-native-stream-(\d+)$/.exec(String(eventContentId || ""));
                const eventAttemptId = eventAttemptMatch ? Number(eventAttemptMatch[1]) : nativeStartupAttemptId;
                if (!isCurrentNativeAttempt(eventAttemptId)) return;
                const mediaVolume = mediaStatus && mediaStatus.volume
                  ? mediaStatus.volume
                  : event && event.volume
                    ? event.volume
                    : null;
                const volumeLevel = mediaVolume && Number.isFinite(Number(mediaVolume.level))
                  ? Number(mediaVolume.level)
                  : null;
                const isMuted = mediaVolume && typeof mediaVolume.muted === "boolean"
                  ? mediaVolume.muted
                  : null;
                const playerState = mediaStatus && mediaStatus.playerState
                  ? mediaStatus.playerState
                  : event && event.playerState
                    ? event.playerState
                    : "";
                const mediaElement = document.getElementById("cast-media-element");
                const mediaDuration = mediaStatus && Number.isFinite(Number(mediaStatus.streamDuration))
                  ? Number(mediaStatus.streamDuration)
                  : (mediaElement && Number.isFinite(Number(mediaElement.duration)) ? Number(mediaElement.duration) : null);
                const mediaCurrentTime = Number.isFinite(Number(event?.currentMediaTime))
                  ? Number(event.currentMediaTime)
                  : (mediaElement && Number.isFinite(Number(mediaElement.currentTime)) ? Number(mediaElement.currentTime) : null);
                const value =
                  event && event.value !== undefined
                    ? event.value
                    : event && event.errorCode !== undefined
                      ? event.errorCode
                      : playerState;
                const msg = "CAF event " + eventType + (value !== "" ? ": " + value : "");
                writeCastDebug(eventType === events.ERROR ? "error" : "debug", msg);
                const cafTelemetryDetails = {
                  playerState,
                  value,
                  errorCode: event && event.errorCode !== undefined
                    ? event.errorCode
                    : event && event.detailedErrorCode !== undefined
                      ? event.detailedErrorCode
                      : null,
                  mediaTime: mediaCurrentTime,
                  currentTime: mediaCurrentTime,
                  duration: mediaDuration,
                  playbackRate: mediaElement && Number.isFinite(Number(mediaElement.playbackRate))
                    ? Number(mediaElement.playbackRate)
                    : null,
                  mediaSessionId: mediaStatus && mediaStatus.mediaSessionId !== undefined
                    ? mediaStatus.mediaSessionId
                    : null,
                  volumeLevel,
                  isMuted,
                  readyState: document.getElementById("cast-media-element")?.readyState ?? null,
                };
                if (eventType === events.ERROR) {
                  cafTelemetryDetails.errorDetails = describeCafError(event);
                }
                emitCafTelemetry(eventType, cafTelemetryDetails);
                if (eventType === events.ERROR || eventType === events.PLAYING || eventType === events.PAUSE) {
                  relayLogToStudio("📺 Receiver: " + msg);
                }
                if (
                  eventType === events.PAUSE &&
                  lastPlaybackStartSignalAt &&
                  !playbackPaused &&
                  nativeStreamActive
                ) {
                  relayLogToStudio(
                    "⚠️ Receiver: Spontaneous CAF pause during active playback; auto-resuming native playout.",
                  );
                  setTimeout(function () {
                    if (
                      lastPlaybackStartSignalAt &&
                      !playbackPaused &&
                      nativeStreamActive
                    ) {
                      const pm = getCastPlayerManager();
                      if (pm && typeof pm.play === "function") {
                        try {
                          pm.play();
                        } catch (e) {}
                      }
                      const cafAudio = document.getElementById("cast-media-element");
                      if (
                        cafAudio &&
                        cafAudio.paused &&
                        typeof cafAudio.play === "function"
                      ) {
                        try {
                          const p = cafAudio.play();
                          if (p && typeof p.catch === "function") p.catch(() => {});
                        } catch (e) {}
                      }
                    }
                  }, 150);
                }

                // Physical Chromecast firmware can report the transition to
                // PLAYING only through the documented MEDIA_STATUS event and
                // omit the convenience PLAYING event entirely. Treat both as
                // the same native readiness proof so the prewarm mute is
                // released instead of timing out into PCM while CAF is already
                // playing the live stream.
                const nativePlayingConfirmed =
                  eventType === events.PLAYING ||
                  (
                    eventType === events.MEDIA_STATUS &&
                    playerState === (
                      messages.PlayerState && messages.PlayerState.PLAYING
                        ? messages.PlayerState.PLAYING
                        : "PLAYING"
                    )
                  );

                if (
                  nativePlayingConfirmed &&
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
                    logReceiverStartupTiming("caf_prewarm_ready", {
                      nativeAttemptId: nativeStartupAttemptId,
                      playbackRequested: !!lastPlaybackStartSignalAt,
                      mediaReadyState: document.getElementById("cast-media-element")
                        ? document.getElementById("cast-media-element").readyState
                        : null,
                    });
                    acceptCafPrewarmReady(eventAttemptId);
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
                } catch (handlerError) {
                  const error = handlerError && typeof handlerError === "object" ? handlerError : null;
                  sendReceiverBootDiagnostic("caf_event_handler_throw", {
                    eventType: String(eventType || "unknown").slice(0, 96),
                    errorName: String(error?.name || "Error").slice(0, 48),
                    message: String(error?.message || handlerError || "caf_event_handler_throw").slice(0, 512),
                    stack: String(error?.stack || "").slice(0, 2048) || null,
                    playbackMode: window._playbackMode || "unknown",
                    nativeStreamActive: Boolean(nativeStreamActive),
                    nativeStartupAttemptId: nativeStartupAttemptId || null,
                  });
                  // Preserve CAF's existing failure behavior while attaching a
                  // receiver-side stack and event identity before CAF wraps it
                  // into its generic APP/900 report.
                  throw handlerError;
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
          playbackRouteDecision = "native";
          nativeFallbackLockedForPlayback = true;
          pcmRuntimeQualificationWindows = 0;
          try {
            localStorage.setItem("mxs_pcm_degraded", "true");
            localStorage.removeItem(PCM_RUNTIME_QUALIFICATION_KEY);
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
          playbackRouteDecision = "native";
          nativeFallbackLockedForPlayback = true;
          pcmRuntimeQualificationWindows = 0;
          try {
            localStorage.removeItem(PCM_RUNTIME_QUALIFICATION_KEY);
          } catch (e) {}
          setReceiverPlayoutPreference("native", reason || "pcm_runtime_unsustainable");
          resetBinaryPlayoutState("native_runtime_fallback");
          setActiveAudioPathOwner("none", reason || "pcm_runtime_unsustainable");
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
              sendReceiverBridgeMessage({
                type: "PCM_RUNTIME_UNSUSTAINABLE",
                reason,
                rawQueueWallMs: Number.isFinite(rawQueueWallMs) ? rawQueueWallMs : null,
                highWatermarkMs: 900,
                diagnostics: pcmRuntimeHighWatermarkDiagnostics,
              });
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

        function getNativeStreamElements() {
          return [
            document.getElementById("cast-media-element"),
            document.getElementById("native-stream-audio"),
          ].filter(Boolean);
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
                workletNode.port.postMessage({ type: "RESET", playbackEpoch: lastPlaybackEpoch, playbackRevision: lastPlaybackRevision });
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
            if (
              nativeStreamActive ||
              (workletNode && pcmPathOwnsAudio()) ||
              (audioInitializing &&
                receiverPlayoutPreference === "pcm_fallback" &&
                !nativeStreamStarting)
            ) {
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
            if (nativeFallbackLockedForPlayback) {
              // PCM has already crossed its runtime/startup failure boundary
              // for this Play. Keep CAF authoritative and do not tear it down
              // just to restart the same failing PCM route, which caused the
              // observed native→PCM→native churn and audible lag.
              if (!nativeStartupTimeoutObserved) {
                nativeStartupTimeoutObserved = true;
                relayLogToStudio(
                  "⏳ Receiver: Native startup remains authoritative after the PCM route failed; retaining the current CAF attempt.",
                );
                notifyPlayoutSelecting(
                  "native_stream",
                  "native_extended_startup_pcm_route_locked",
                );
              }
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
            if (nativeOrderedResumeRecovery) {
              emitCafTelemetry("CAF_RESUME_RESTART_FALLBACK", {
                playbackEpoch: nativeOrderedResumeRecovery.playbackEpoch,
                playbackRevision: nativeOrderedResumeRecovery.playbackRevision,
                reason: "fresh_native_start_timeout",
                recoveryReason: nativeOrderedResumeRecovery.reason,
                timeoutMs: NATIVE_STARTUP_TIMEOUT_MS,
                nativeAttemptId: watchdogAttemptId,
              });
            }
            // The native attempt failed, but the ordered PLAYBACK_START is
            // still active. Preserve that intent so the recovery path can
            // start native immediately instead of waiting for another Play.
            stopNativeStreamPlayout("startup_timeout", true);
            setReceiverPlayoutPreference("pcm_fallback", "native_startup_timeout");
            if (configReceived) {
              maybeStartLowLatencyPlayout("native_startup_timeout");
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
              const currentVol = Number.isFinite(element.volume) ? Number(element.volume) : 1;
              element._mxsVolumeBeforePrewarm = currentVol > 0.001 ? currentVol : 1;
            }
            element.muted = true;
            element.volume = 0;
            element._mxsPrewarmMuted = true;
          } catch (e) {}
        }

        function rememberNativeAudibleVolume(element, candidate) {
          const volume = Number(candidate);
          if (!Number.isFinite(volume) || volume <= 0.001) return;
          nativeLastAudibleVolume = volume;
          if (element) element._mxsLastAudibleVolume = volume;
        }

        function getNativeResumeVolume(element) {
          const candidates = [
            element && element._mxsVolumeBeforePause,
            element && element._mxsLastAudibleVolume,
            nativeLastAudibleVolume,
          ];
          const volume = candidates.find((candidate) => {
            const value = Number(candidate);
            return Number.isFinite(value) && value > 0.001;
          });
          return volume === undefined ? 1 : Number(volume);
        }

        function releaseNativeStreamPrewarmMute() {
          let unmutedAny = false;
          getNativeStreamElements().forEach(function (element) {
            if (!element || !element._mxsPrewarmMuted) {
              return;
            }
            try {
              const candidate = element._mxsVolumeBeforePrewarm !== undefined
                ? Number(element._mxsVolumeBeforePrewarm)
                : getNativeResumeVolume(element);
              const targetVolume = Number.isFinite(candidate) && candidate > 0.001
                ? Math.max(0, Math.min(1, candidate))
                : 1;
              rememberNativeAudibleVolume(element, targetVolume);
              // Set the requested gain while the element is still muted, then
              // release mute in the same task. Fading from volume=0 made CAF
              // publish a transient ~0.0575 level and allowed the first real
              // PCM to be perceived as silence on physical receivers.
              element.volume = targetVolume;
              element.muted = false;
              delete element._mxsVolumeBeforePrewarm;
              delete element._mxsPrewarmMuted;
              unmutedAny = true;
            } catch (e) {}
          });
          if (unmutedAny) {
            logReceiverStartupTiming("native_prewarm_unmuted", {
              nativeAttemptId: nativeStartupAttemptId,
              playbackRequested: !!lastPlaybackStartSignalAt,
              prewarmReady: nativeStreamPrewarmReady,
              volumeRestoreMode: "atomic",
              fadeMs: 0,
            });
          }
        }

        function activateNativeStream(modeReason, logMessage, attemptId) {
          if (attemptId && !isCurrentNativeAttempt(attemptId)) {
            return false;
          }
          if (nativeStartupTrimRetryTimerId) {
            clearTimeout(nativeStartupTrimRetryTimerId);
            nativeStartupTrimRetryTimerId = null;
          }
          if (
            lastPlaybackStartSignalAt &&
            nativeStartupTrimPending &&
            !releasePendingNativeStartupTrim()
          ) {
            scheduleNativeStartupTrimRetry(modeReason, logMessage, attemptId);
            return true;
          }
          nativeStartupTrimRetryStartedAt = 0;
          if (!setActiveAudioPathOwner("native_caf", modeReason || "native_active")) {
            stopNativeStreamPlayout("native_owner_promotion_failed");
            return false;
          }
          nativeStreamStarting = false;
          nativeStreamActive = true;
          nativeStreamPaused = false;
          nativeFailureRetryAttempted = false;
          if (nativeOrderedResumeRecovery) {
            emitCafTelemetry("CAF_RESUME_RESTART_READY", {
              playbackEpoch: nativeOrderedResumeRecovery.playbackEpoch,
              playbackRevision: nativeOrderedResumeRecovery.playbackRevision,
              recoveryReason: nativeOrderedResumeRecovery.reason,
              elapsedMs: Date.now() - nativeOrderedResumeRecovery.startedAt,
              nativeAttemptId: nativeStartupAttemptId,
            });
            clearNativeOrderedResumeRecovery("native_restart_ready");
          }
          releaseNativeStreamPrewarmMute();
          if (nativeStartupTrimState !== "idle" && nativeStartupTrimState !== "cancelled") {
            nativeStartupTrimState = "released";
          }
          nativeStreamPrewarmBeforePlayback = false;
          nativeStreamPrewarmReady = false;
          nativeStreamCompanionForPcm = false;
          window._nativeStreamActive = true;
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

        const MAX_RECEIVER_PAYLOAD_BYTES = 256 * 1024;
        function safeReceiverJsonParse(text) {
          if (typeof text !== "string" || text.length > MAX_RECEIVER_PAYLOAD_BYTES) {
            return null;
          }
          try {
            return JSON.parse(text, (key, value) => {
              if (key === "__proto__" || key === "constructor" || key === "prototype") {
                return undefined;
              }
              return value;
            });
          } catch (_e) {
            return null;
          }
        }

        function parseCastPayload(raw) {
          if (!raw) {
            return null;
          }
          if (typeof raw === "string") {
            const parsed = safeReceiverJsonParse(raw);
            if (!parsed) {
              relayLogToStudio("⚠️ Receiver: Ignored malformed or oversized Cast message JSON.");
            }
            return parsed;
          }
          if (raw && typeof raw.data === "string") {
            const parsed = safeReceiverJsonParse(raw.data);
            if (!parsed) {
              relayLogToStudio("⚠️ Receiver: Ignored malformed or oversized nested Cast message JSON.");
            }
            return parsed;
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
          cancelNativeResumeProgressProbe(reason || "native_stream_stop");
          clearNativeOrderedResumeRecovery(reason || "native_stream_stop");
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
          clearNativeStartupTrimRetry();
          nativeStartupTrimPending = false;
          nativeStartupTrimState = "cancelled";
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
          if (
            activeAudioPathOwner === "native_caf" ||
            activeAudioPathOwner === "native_caf_starting"
          ) {
            setActiveAudioPathOwner("none", reason || "native_stream_stop");
          }
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
          cancelNativeResumeProgressProbe(reason || "native_stream_replay_hold");
          if (!nativeStreamActive && !nativeStreamStarting) {
            return false;
          }
          const cafAudio = document.getElementById("cast-media-element");
          const htmlAudio = document.getElementById("native-stream-audio");
          getNativeStreamElements().forEach(function muteReplayNativeElement(element) {
            if (!element) return;
            try {
              if (element._mxsVolumeBeforePause === undefined) {
                element._mxsVolumeBeforePause = getNativeResumeVolume(element);
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
          cancelNativeResumeProgressProbe(reason || "native_stream_pause");
          if (!nativeStreamActive && !nativeStreamStarting) return false;
          nativeStreamPaused = true;
          const cafAudio = document.getElementById("cast-media-element");
          const htmlAudio = document.getElementById("native-stream-audio");
          getNativeStreamElements().forEach(function muteNativeElement(element) {
            if (!element) return;
            try {
              if (element._mxsVolumeBeforePause === undefined) {
                element._mxsVolumeBeforePause = getNativeResumeVolume(element);
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
          // New source audio may already be in flight for this revision.
          // Seeking to a generic live edge here can discard its first attack.
          // Healthy Resume retains the media item and never seeks or loads.
          emitCafTelemetry("CAF_WARM_RESUME_HOLD_RELEASE", {
            reason: reason || "playback_resume",
            playbackEpoch: lastPlaybackEpoch,
            playbackRevision: lastPlaybackRevision,
            mediaState: readNativeResumeMediaState(),
          });
          nativeStreamPaused = false;
          const cafAudio = document.getElementById("cast-media-element");
          const htmlAudio = document.getElementById("native-stream-audio");
          getNativeStreamElements().forEach(function unmuteNativeElement(element) {
            if (!element) return;
            try {
              const targetVolume = getNativeResumeVolume(element);
              rememberNativeAudibleVolume(element, targetVolume);
              element.muted = false;
              element.volume = targetVolume;
              delete element._mxsVolumeBeforePause;
            } catch (e) {}
          });
          // Pause is implemented as a mute so the live progressive-WAV clock
          // stays warm. Do not call play() on an element that is already
          // running: that can force CAF to re-prime the decoder and creates a
          // short click/stutter. An actual CAF remote Pause can leave the same
          // element paused; app Resume must release that hold too.
          {
            getNativeStreamElements().forEach(function resumePausedNativeElement(element) {
              if (!element || element.paused !== true || typeof element.play !== "function") return;
              try {
                const result = element.play();
                if (result && typeof result.catch === "function") result.catch(() => {});
              } catch (e) {}
            });
          }
          relayLogToStudio(
            "▶️ Receiver: Native output unmuted on the retained media item (" +
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
                workletNode.port.postMessage({ type: "RESET", playbackEpoch: lastPlaybackEpoch, playbackRevision: lastPlaybackRevision });
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
            setActiveAudioPathOwner("none", stopReason);
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

          // Pause preserves the audio owner and prepared transport. Explicit
          // Stop and Cast shutdown retain their separate teardown semantics.
          if (pauseNativeStreamPlayout(reason || "playback_pause", true)) {
            relayLogToStudio(
              "⏸️ Receiver: Playback paused; native CAF media item preserved.",
            );
            publishMxsPlaybackStatus("PAUSED", reason || "playback_pause");
            return;
          }
          if (workletNode && workletReady) {
            holdRealtimePlayoutKeepPcmReady(reason || "playback_pause");
            publishMxsPlaybackStatus("PAUSED", reason || "playback_pause");
            relayLogToStudio(
              "⏸️ Receiver: Playback paused; PCM worklet and rendered-frame cursor retained.",
            );
            return;
          }
          publishMxsPlaybackStatus("PAUSED", reason || "playback_pause");
          relayLogToStudio("⏸️ Receiver: Playback paused; no active playout teardown required.");
        }

        function holdRealtimePlayoutKeepPcmReady(reason) {
          // Hold the worklet read cursor and existing bounded queue. Every
          // Pause revision must reach it, even inside a rapid toggle burst.
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
          if (workletNode && workletNode.port) {
            try {
              workletNode.port.postMessage({ type: "PAUSE", playbackEpoch: lastPlaybackEpoch, playbackRevision: lastPlaybackRevision });
              workletQueueResetCount += 1;
              lastPcmQueueResetAt = now;
            } catch (e) {}
            workletReady = true;
          }
          if (workletNode && workletReady) {
            notifyPlaybackMode("pcm_fallback", (reason || "playback_idle") + "_pcm_ready");
          }
          if (reason && !duplicateReset) {
            relayLogToStudio("⏸️ Receiver: PCM playout paused; worklet retained and queue held (" + reason + ").");
          }
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
              if (nativeStreamActive && window._playbackMode === "native") {
                relayLogToStudio(
                  "⏭️ Receiver: Ignored HTML companion media error after CAF native takeover.",
                );
                return;
              }
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
                  if (nativeStreamActive && window._playbackMode === "native") {
                    relayLogToStudio(
                      "⏭️ Receiver: Ignored HTML companion play rejection after CAF native takeover.",
                    );
                    return;
                  }
                  if (
                    e &&
                    (e.name === "AbortError" ||
                      (e.message && e.message.indexOf("interrupted by a call to pause") !== -1))
                  ) {
                    relayLogToStudio(
                      "⏸️ Receiver: HTML audio play interrupted by pause or mode transition; retaining stream state.",
                    );
                    return;
                  }
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

        let nativePrewarmReadyAnnouncedForAttempt = null;
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
            // See the LOAD interceptor above: duration=-1 remains an isolated
            // audit target until Chromecast QA approves changing this path.
            media.duration = null;
            // CAF uses this live anchor to avoid replaying an older buffered
            // position when it attaches to the progressive LAN stream.
            media.startAbsoluteTime = Date.now() / 1000;
            media.contentUrl = streamUrl;
            media.customData = { streamUrl: streamUrl, source: "mxs004-native-stream" };
            const trackMetadata = getSenderAuthoritativeTrackMetadata();
            if (trackMetadata) {
              media.customData.trackMetadata = trackMetadata;
            }
            if (typeof messages.GenericMediaMetadata === "function") {
              const metadata = new messages.GenericMediaMetadata();
              metadata.title = "MXS-004 Studio";
              metadata.subtitle = "Native LAN audio stream";
              const activeTrack = trackMetadata && trackMetadata.tracks.find(function (track) {
                return track.trackId === trackMetadata.activeTrackId;
              });
              if (activeTrack) {
                metadata.title = activeTrack.title;
                metadata.subtitle = "MXS-004 — " + activeTrack.fileName;
              }
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

            writeCastDebug("info", "Calling PlayerManager.load for " + redactBridgeUrl(streamUrl));
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
                  const errorDetails = formatCafError(e);
                  writeCastDebug("error", "CAF native stream LOAD failed: " + errorDetails);
                  relayLogToStudio("⚠️ Receiver: CAF native stream LOAD failed: " + errorDetails);
                  // A progressive live LOAD can reject its promise while CAF
                  // continues attaching the bound media element. During a
                  // muted prewarm, starting HTML audio here races that late
                  // CAF attach; CAF then stops the companion and its AbortError
                  // incorrectly demotes the native path to PCM fallback.
                  // Keep CAF authoritative and let the ordered Play boundary
                  // or the bounded startup watchdog settle the attempt.
                  if (nativeStreamPrewarmBeforePlayback) {
                    relayLogToStudio(
                      "⏳ Receiver: Retaining CAF native prewarm after LOAD rejection; awaiting ordered PLAYBACK_START.",
                    );
                    return;
                  }
                  if (nativeStreamActive && window._playbackMode === "native") {
                    relayLogToStudio(
                      "⏭️ Receiver: Ignored CAF LOAD rejection after native takeover.",
                    );
                    return;
                  }
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
          const streamToken = currentBridgeStreamToken ||
            (window.STREAM_TOKEN && !window.STREAM_TOKEN.startsWith("{{")
              ? window.STREAM_TOKEN
              : "");
          if ((nativeStreamActive || nativeStreamStarting) && nativeStreamUrl && nativeStreamUrl.indexOf("http://" + ip + ":" + targetPort + "/stream.wav") === 0) {
            return true;
          }

          const attemptId = ++nativeStartupAttemptId;
          const streamUrl = "http://" + ip + ":" + targetPort +
            "/stream.wav?token=" + encodeURIComponent(streamToken) + "&cb=" + Date.now() + "&attempt=" + attemptId;
          clearNativeStreamReloadTimer();
          nativeStreamStarting = true;
          nativeStreamActive = false;
          nativeStreamUrl = streamUrl;
          nativeStartupTrimPending = true;
          nativeStartupTrimState = "pending";
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
          studioDialogs?.dispose();
          studioGuiActions?.dispose();
          if (window._receiverShutdownInProgress) {
            return;
          }
          window._receiverShutdownInProgress = true;
          stopMirrorDiagnostics();
          clearReceiverSessionCaches("cast_stopped");
          suppressBinaryReconnect = true;
          clearBinaryReconnectTimer();
          clearLowLatencyStartupWatchdog();
          if (handshakeRetryInterval) {
            clearInterval(handshakeRetryInterval);
            handshakeRetryInterval = null;
          }
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
          currentBridgeStreamToken = null;
          currentBridgeLogToken = null;
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
              ? {
                  type: "PCM_PACKET",
                  payload: buffer,
                  byteOffset: packet.byteOffset || 0,
                  byteLength: packet.byteLength || buffer.byteLength,
                  metadata: packet.metadata,
                }
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
                sendReceiverBridgeMessage({
                  type: "PCM_RUNTIME_UNSUSTAINABLE",
                  reason: "pcm_startup_pending_overrun",
                  droppedFrames,
                  pendingPackets: queued.length,
                });
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
            const decoded = window.MXSPcmV2.decode(buffer, { zeroCopy: true });
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
              byteOffset: decoded.payloadByteOffset || 0,
              byteLength: decoded.payloadByteLength || decoded.payload.byteLength,
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
          { l: "PITCH", p: "pitch", min: -100, max: 100, val: 0, u: "%", s: 0.1 },
          { l: "VOLUME", p: "vol", min: -48, max: 6, val: 0, u: "dB", s: 0.1 },
          { l: "PAN", p: "pan", min: -1, max: 1, val: 0, u: "", s: 0.05 },
          { l: "TREBLE", p: "treble", min: -12, max: 12, val: 0, u: "dB", s: 0.1 },
          { l: "MID FREQ", p: "mid_freq", min: 400, max: 2000, val: 1200, u: "Hz", s: 10 },
          { l: "MID GAIN", p: "mid_gain", min: -12, max: 12, val: 0, u: "dB", s: 0.1 },
          { l: "BASS", p: "bass", min: -12, max: 12, val: 0, u: "dB", s: 0.1 },
        ];

        function formatMirroredParameterDisplay(descriptor, rawValue) {
          return window.MXSStudioParameterDisplay?.format(descriptor, rawValue) ?? "";
        }

        function readMirroredDisplayDescriptor(element) {
          const source = element?.dataset?.castDisplayDescriptor;
          if (!source) return null;
          try {
            const descriptor = JSON.parse(source);
            return descriptor && typeof descriptor === "object" ? descriptor : null;
          } catch (_error) {
            return null;
          }
        }

        function writeMirroredDisplayDescriptor(element, descriptor, confirmedDisplay) {
          if (!element) return;
          if (descriptor && typeof descriptor === "object") {
            const serialized = JSON.stringify(descriptor);
            if (element.dataset.castDisplayDescriptor !== serialized) element.dataset.castDisplayDescriptor = serialized;
            const key = String(descriptor.parameterKey || "");
            if (element.dataset.parameterKey !== key) element.dataset.parameterKey = key;
          }
          if (confirmedDisplay !== undefined) {
            const display = String(confirmedDisplay);
            if (element.dataset.confirmedDisplay !== display) element.dataset.confirmedDisplay = display;
          }
          if (element.dataset.optimisticDisplay !== undefined) delete element.dataset.optimisticDisplay;
        }

        function applyMirroredParameterDisplay(controlId, outputId, descriptor, rawValue) {
          const control = getEl(controlId);
          const output = getEl(outputId);
          if (!control || !output) return false;
          if (control.dataset.castInteractionState === "pending") return false;
          const meta = descriptor && typeof descriptor === "object"
            ? descriptor
            : readMirroredDisplayDescriptor(control) || {};
          const confirmedDisplay = meta.displayValue !== undefined
            ? String(meta.displayValue)
            : formatMirroredParameterDisplay(meta, rawValue);
          updateValue(controlId, rawValue);
          updateText(outputId, confirmedDisplay);
          writeMirroredDisplayDescriptor(control, meta, confirmedDisplay);
          writeMirroredDisplayDescriptor(output, meta, confirmedDisplay);
          return true;
        }

        function resolveMirroredParameterBinding(element) {
          const dialogRoot = element.closest(
            ".effect-control-group, .gui-dialog-mirror-control, .pad-setting-field",
          );
          if (dialogRoot) {
            return {
              descriptor: readMirroredDisplayDescriptor(element),
              output: dialogRoot.querySelector(
                ".effect-param-value .param-value, .gui-dialog-mirror-value, .pad-setting-value",
              ),
            };
          }
          const trackElement = element.closest(".track");
          if (trackElement) {
            const trackIndex = Number(trackElement.dataset.trackIndex);
            const parameterKey = String(element.dataset.param || "");
            const outputId = parameterKey === "inputGain"
              ? `t-gain-val-${trackIndex}`
              : parameterKey === "loopStart"
                ? `t-ls-val-${trackIndex}`
                : parameterKey === "loopEnd"
                  ? `t-le-val-${trackIndex}`
                  : `t-${parameterKey}-val-${trackIndex}`;
            return {
              descriptor:
                lastMirroredState?.tracks?.[trackIndex]?.paramDisplays?.[parameterKey] ||
                readMirroredDisplayDescriptor(element),
              output: getEl(outputId),
            };
          }
          const masterBindings = {
            "master-volume": ["volume", "master-volume-value"],
            "loop-length": ["loopLength", "loop-length-value"],
            "lfo-time": ["lfo1Time", "lfo-time-value"],
            "lfo2-time": ["lfo2Time", "lfo2-time-value"],
          };
          const binding = masterBindings[element.id];
          if (!binding) return { descriptor: readMirroredDisplayDescriptor(element), output: null };
          return {
            descriptor:
              lastMirroredState?.master?.paramDisplays?.[binding[0]] ||
              readMirroredDisplayDescriptor(element),
            output: getEl(binding[1]),
          };
        }

        function applyOptimisticMirroredParameterDisplay(element) {
          const binding = resolveMirroredParameterBinding(element);
          if (!binding.output) return false;
          const descriptor = binding.descriptor || {};
          const optimisticDisplay = formatMirroredParameterDisplay(
            descriptor,
            element.value,
          );
          binding.output.textContent = optimisticDisplay;
          binding.output.dataset.optimisticDisplay = optimisticDisplay;
          element.dataset.optimisticDisplay = optimisticDisplay;
          if (descriptor.parameterKey) {
            element.dataset.parameterKey = String(descriptor.parameterKey);
          }
          if (binding.output.id) delete valCache[binding.output.id];
          return true;
        }

        let mirroredTrackCount = 0;

        const studioStructure = (!RECEIVER_BRANCH || RECEIVER_BRANCH.gui) && window.MXSCreateStudioStructure
          ? window.MXSCreateStudioStructure({
              document, knobConfigs: KNOB_CONFIGS,
              samplerColumns: RECEIVER_SAMPLER_COLUMNS, samplerRows: RECEIVER_SAMPLER_ROWS,
              onRemoveElement(id) { delete elCache[id]; delete valCache[id]; },
            }) : null;

        function buildGUI(trackCount = 4) {
          if (!studioStructure) throw new Error("Studio structure module is unavailable");
          lastQueuedPresentationVisualKey = null;
          _lastAssignmentCache.length = 0;
          _lastParamsCache.length = 0;
          _lastFxCache.length = 0;
          Object.keys(valCache).forEach((key) => {
            if (key.startsWith("track-metadata:")) delete valCache[key];
          });
          mirroredTrackCount = studioStructure.build(trackCount);
          updateScale();
          initReceiverLfoWaveforms();
        }

        function prepareReceiverUi() {
          markReceiverBoot("receiver_script_loaded");
          reportReceiverRuntimeCapabilities();
          const studioRoot = document.getElementById("studio-root");
          if (studioRoot) {
            studioRoot.dataset.guiContractVersion = "3";
            studioRoot.dataset.guiAudioPath = "pcm-native-locked";
          }
          bindReceiverGuiInteractions();
          initReceiverLfoWaveforms();
          markReceiverBoot("gui_structurally_ready");
        }

        function updateScale() {
          if (window.MXS_RECEIVER_BRANCH && !RECEIVER_BRANCH.gui) return;
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

            let workletUrl = "pcm-player-worklet-c11d7ffed48783882236886963dbb6496a3ba3b32d0b7db34aca7f58035a73bd.js";
            // Executable modules always belong to the receiver origin.
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
            const absWorkletUrl = new URL(workletUrl, (document.baseURI || window.location.href)).href;
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
            await preflightWorkletModule(absWorkletUrl, "content-addressed");
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
            lastPcmDiagRenderedFrames = 0;
            pcmRenderedFramesAtPlaybackStart = 0;
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
              if (e.data.type === "PRESENTATION_POSITION") {
                if (Number.isSafeInteger(e.data.mediaFrame) && Number.isFinite(e.data.audioTime) &&
                    e.data.playbackEpoch === lastPlaybackEpoch && e.data.playbackRevision === lastPlaybackRevision) pcmPresentationPosition = e.data;
                return;
              }
              if (e.data.type === "DIAG") {
                window._lastWorkletDiagTime = Date.now();
                const renderedFrames = Number(e.data.renderedFrames);
                const renderedFramesDelta = Number.isFinite(renderedFrames)
                  ? Math.max(0, renderedFrames - lastPcmDiagRenderedFrames)
                  : 0;
                if (Number.isFinite(renderedFrames)) {
                  lastPcmDiagRenderedFrames = renderedFrames;
                }
                if (
                  lastPlaybackStartSignalAt &&
                  window._playbackMode === "pcm_fallback" &&
                  activeAudioPathOwner === "pcm_v2" &&
                  workletReady &&
                  e.data.targetAcquired === true &&
                  renderedFrames > pcmRenderedFramesAtPlaybackStart &&
                  renderedFramesDelta > 0 &&
                  Number(e.data.peak) > 0.0001
                ) {
                  notifyPlayoutAudible("pcm_fallback", "pcm_render_progress", {
                    renderedFramesDelta,
                    renderedFrames,
                    outputFrames: Number(e.data.outputFrames) || 0,
                    targetAcquired: true,
                    targetWallMs: Number(e.data.targetWallMs) || null,
                    targetWithinToleranceSamples: Number(e.data.targetWithinToleranceSamples) || 0,
                    peak: Number(e.data.peak) || 0,
                    lifecycleGeneration: workletLifecycleGeneration,
                  });
                }
                notePcmRuntimeQualification(e.data);
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
                    !playbackPaused &&
                    !nativeStreamActive &&
                    !nativeStreamStarting &&
                    window._playbackMode !== "native";
                  if (pcmMayOwnAudio && lastPlaybackStartSignalAt) {
                    const pcmClaimed =
                      activeAudioPathOwner === "pcm_v2" ||
                      setActiveAudioPathOwner("pcm_v2", "worklet_ready");
                    if (pcmClaimed) {
                      flushPendingBinaryFrames();
                      notifyPlaybackMode("pcm_fallback", "worklet_ready");
                      relayLogToStudio("✅ Receiver: Live PCM playout active.");
                    } else {
                      relayLogToStudio(
                        "⛔ Receiver: PCM worklet became ready without audio ownership; pending frames remain gated.",
                      );
                    }
                  } else if (
                    !nativeStreamActive &&
                    !nativeStreamStarting &&
                    window._playbackMode !== "native"
                  ) {
                    relayLogToStudio(
                      "✅ Receiver: PCM worklet ready as standby; waiting for ordered PLAYBACK_START to claim ownership.",
                    );
                  } else {
                    relayLogToStudio(
                      "✅ Receiver: PCM worklet ready while native playout retains ownership.",
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
              playbackEpoch: lastPlaybackEpoch,
              playbackRevision: lastPlaybackRevision,
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

        let lastHighFreqLogTime = 0;
        function relayLogToStudio(msg) {
          // Receiver diagnostics can originate from Cast payloads and browser
          // exceptions. Normalize and bound them before DOM, console, queue,
          // or LAN transport use so malformed values cannot throw here or
          // amplify memory/network work during a reconnect storm.
          if (typeof msg !== "string") {
            try {
              msg = JSON.stringify(msg);
            } catch (_error) {
              msg = String(msg || "");
            }
          }
          msg = String(msg || "").slice(0, 2048);
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
              sent = sendReceiverBridgeMessage({ type: "LOG", msg: msg });
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
              const logToken = currentBridgeLogToken ||
                (window.LOG_TOKEN && !window.LOG_TOKEN.startsWith("{{")
                  ? window.LOG_TOKEN
                  : "");
              const url = "http://" + targetIp + ":" + port + "/log?m=" +
                encodeURIComponent(msg) + "&token=" + encodeURIComponent(logToken);
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
        function updateMirroredLoopMarker(control) {
          const parameter = control?.dataset?.param;
          if (parameter !== "loopStart" && parameter !== "loopEnd") return;
          const trackIndex = Number(control.closest(".track")?.dataset.trackIndex);
          if (!Number.isInteger(trackIndex)) return;
          const markerId = parameter === "loopStart"
            ? `t-ls-m-${trackIndex}`
            : `t-le-m-${trackIndex}`;
          const marker = getEl(markerId);
          if (!marker) return;
          const duration = Number(control.max);
          const value = Number(control.value);
          const valid = Number.isFinite(duration) && duration > 0 && Number.isFinite(value);
          const position = valid ? Math.max(0, Math.min(value, duration)) : 0;
          marker.classList.toggle(
            "is-visible",
            valid && (parameter === "loopStart" ? position > 0 : position < duration - 0.001),
          );
          if (valid) updateStyleLeft(markerId, `${(position / duration) * 100}%`);
        }
        function updateButtonState(id, buttonState) {
          const el = getEl(id);
          if (!el || !buttonState) return;
          const cacheKey = "button:" + id;
          const stateKey = JSON.stringify(buttonState);
          if (valCache[cacheKey] !== stateKey) {
            const action = buttonState.action ||
              (id.indexOf("t-rec-") === 0 ? "record" :
                id.indexOf("t-stop-") === 0 ? "stop" :
                  id.indexOf("t-play-") === 0 ? "play" :
                    id.indexOf("t-rev-") === 0 ? "reverse" :
                      id === "master-record-button" ? "master-record" :
                        id === "lfo-toggle" ? "lfo1" :
                          id === "lfo2-toggle" ? "lfo2" : "unknown");
            const operationState = buttonState.operationState ||
              buttonState.state ||
              (buttonState.active ? "active" : "inactive");
            const active = buttonState.active === true;
            const isRecord = action === "record" || action === "master-record";
            const isPlay = action === "play";
            const isStop = action === "stop";
            const isReverse = action === "reverse";
            const isLfo = action === "lfo1" || action === "lfo2";
            el.dataset.action = action;
            el.classList.toggle("active", active);
            el.classList.toggle("mirrored-active", active);
            el.classList.toggle("playing", isPlay && operationState === "playing");
            el.classList.toggle("paused", isPlay && operationState === "paused");
            el.classList.toggle("stopped", isStop && operationState === "stopped");
            el.classList.toggle("recording", isRecord && operationState === "recording");
            el.classList.toggle("reversed", isReverse && operationState === "active");
            el.classList.toggle("reverse-preparing", isReverse && operationState === "preparing");
            el.classList.toggle("reverse-failed", isReverse && operationState === "failed");
            el.classList.toggle("sweeping", isLfo && active);
            el.dataset.mirroredState = operationState;
            if (isReverse) el.dataset.reverseState = operationState;
            el.dataset.reverseProgress = Number.isFinite(buttonState.progress)
              ? String(buttonState.progress)
              : "";
            el.dataset.reverseError = buttonState.error?.code || buttonState.errorCode || "";
            el.setAttribute("aria-pressed", buttonState.pressed === true ? "true" : "false");
            el.setAttribute("aria-busy", isReverse && operationState === "preparing" ? "true" : "false");
            if (isReverse) {
              el.title = operationState === "preparing"
                ? `Preparing reverse${Number.isFinite(buttonState.progress) ? ` ${Math.round(buttonState.progress * 100)}%` : ""}`
                : buttonState.error?.message || "Reverse playback";
            }
            valCache[cacheKey] = stateKey;
          }
          el.disabled = !!buttonState.disabled;
          el.setAttribute("aria-disabled", buttonState.disabled ? "true" : "false");
        }

        function calculateMirroredWaveformVisualGain(peak) {
          const value = Math.max(0, Number(peak) || 0);
          if (value <= 0.000001 || value >= 0.75) return 1;
          const targetPeak = Math.min(
            0.75,
            Math.max(value, Math.pow(value / 0.75, 0.55) * 0.75),
          );
          return Math.min(8, Math.max(1, targetPeak / value));
        }

        function interpolateMirroredWaveform(previous, next, progress) {
          if (!previous || !next) return next || previous || null;
          const amount = Math.max(0, Math.min(1, Number(progress) || 0));
          const interpolateNumber = (from, to) =>
            (Number(from) || 0) + ((Number(to) || 0) - (Number(from) || 0)) * amount;
          const interpolateList = (from, to, pairValues = false) => {
            if (!Array.isArray(to)) return [];
            if (!Array.isArray(from) || from.length !== to.length) return to;
            return to.map((value, index) => {
              if (!pairValues) return interpolateNumber(from[index], value);
              return [
                interpolateNumber(from[index]?.[0], value?.[0]),
                interpolateNumber(from[index]?.[1], value?.[1]),
              ];
            });
          };
          return {
            ...next,
            points: interpolateList(previous.points, next.points, true),
            line: interpolateList(previous.line, next.line, false),
            peak: interpolateNumber(previous.peak, next.peak),
            nonFlat: Boolean(previous.nonFlat || next.nonFlat),
          };
        }

        function drawMirroredWaveform(id, waveform, source, cacheResult = true, signatureOverride = null) {
          const canvas = getEl(id);
          if (!canvas || !waveform || !Array.isArray(waveform.points)) return false;
          const cacheKey = "waveform:" + id;
          const signature = cacheResult
            ? (signatureOverride || JSON.stringify(waveform))
            : null;
          if (cacheResult && valCache[cacheKey] === signature) return true;
          const hasData = waveform.hasData !== false;
          const active = waveform.active !== false;
          const resolvedSource = waveform.source || source || "unknown";
          const paintMode = waveform.paintMode || (
            resolvedSource === "decoded_buffer"
              ? "decoded_envelope"
              : resolvedSource === "live_analyser"
                ? "live_line"
                : "master_envelope"
          );
          const peak = Math.max(0, Number(waveform.peak) || 0);
          const nonFlat = Boolean(waveform.nonFlat ?? peak > 0.000001);
          canvas.dataset.waveformState = hasData ? "ready" : "pending";
          canvas.dataset.waveformSource = resolvedSource;
          canvas.dataset.waveformAnalysisSource = waveform.analysisSource || "unknown";
          canvas.dataset.waveformSampleCount = String(Number(waveform.sampleCount) || 0);
          canvas.dataset.waveformActive = active ? "true" : "false";
          canvas.dataset.waveformPeak = peak.toFixed(6);
          canvas.dataset.waveformNonFlat = nonFlat ? "true" : "false";
          canvas.dataset.waveformPaintMode = paintMode;
          const width = canvas.clientWidth || Number(canvas.getAttribute("width")) || 238;
          const height = canvas.clientHeight || Number(canvas.getAttribute("height")) || 26;
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
          }
          let context = null;
          try {
            context = canvas.getContext("2d");
          } catch (_error) {
            context = null;
          }
          if (!context) return false;
          // Only cache after a drawable canvas/context is available. A GUI
          // snapshot can arrive during shell construction; that first paint
          // must remain retryable instead of becoming a permanent cache hit.
          if (cacheResult) valCache[cacheKey] = signature;
          context.imageSmoothingEnabled = false;

          // 1. Hardware LCD background & zero-crossing centerline
          context.clearRect(0, 0, width, height);
          context.fillStyle = "#132227";
          context.fillRect(0, 0, width, height);

          const centerY = Math.floor(height / 2);
          context.fillStyle = "#223a43";
          context.fillRect(0, centerY, width, 1);

          if (!active || !hasData || (!waveform.points.length && !waveform.line?.length)) {
            return true;
          }

          // 2. Discrete Lofi MPC Vertical Column Bars with True-dBFS Green -> Yellow -> Red Palette
          const visualGain = calculateMirroredWaveformVisualGain(peak);
          const grad = context.createLinearGradient(0, 0, 0, height);
          if (peak >= 0.89) {
            grad.addColorStop(0.00, "#ff3333"); // True clipping red (>= -1 dBFS)
            grad.addColorStop(0.08, "#ffea00"); // High yellow
            grad.addColorStop(0.20, "#00e676"); // Safe green
            grad.addColorStop(0.50, "#00e676"); // Centerline green
            grad.addColorStop(0.80, "#00e676"); // Safe green
            grad.addColorStop(0.92, "#ffea00"); // High yellow
            grad.addColorStop(1.00, "#ff3333"); // True clipping red
          } else if (peak >= 0.50) {
            grad.addColorStop(0.00, "#ffea00"); // Headroom warning yellow (-6..-1 dBFS)
            grad.addColorStop(0.16, "#00e676"); // Safe green
            grad.addColorStop(0.50, "#00e676"); // Centerline green
            grad.addColorStop(0.84, "#00e676"); // Safe green
            grad.addColorStop(1.00, "#ffea00"); // Headroom warning yellow
          } else {
            grad.addColorStop(0.00, "#00e676"); // Nominal green (< -6 dBFS, never false red/yellow)
            grad.addColorStop(0.50, "#00e676");
            grad.addColorStop(1.00, "#00e676");
          }

          context.fillStyle = grad;

          const pointCount = (waveform.points && waveform.points.length) || (waveform.line && waveform.line.length) || 0;
          if (pointCount > 0) {
            const stepX = width / pointCount;
            const colWidth = Math.max(1, Math.ceil(stepX));

            for (let i = 0; i < pointCount; i++) {
              let minVal = 0;
              let maxVal = 0;
              if (waveform.points && waveform.points[i]) {
                minVal = Math.min(0, (Number(waveform.points[i][0]) || 0) * visualGain);
                maxVal = Math.max(0, (Number(waveform.points[i][1]) || 0) * visualGain);
              } else if (waveform.line && waveform.line[i] !== undefined) {
                const v = Math.abs(Number(waveform.line[i]) || 0) * visualGain;
                minVal = -v;
                maxVal = v;
              }

              const clampedMin = Math.max(-1, Math.min(1, minVal));
              const clampedMax = Math.max(-1, Math.min(1, maxVal));

              const yTop = Math.floor(((1 - clampedMax) * height) / 2);
              const yBottom = Math.ceil(((1 - clampedMin) * height) / 2);
              const barHeight = Math.max(1, yBottom - yTop);
              const x = Math.floor(i * stepX);
              if (x >= width) continue;

              context.fillRect(x, yTop, Math.min(colWidth, width - x), barHeight);
            }
          }
          return true;
        }

        function updateMirroredPlayhead(id, position) {
          const ratio = Math.max(0, Math.min(1, Number(position) || 0));
          updateStyleLeft(id, `${ratio * 100}%`);
          const marker = getEl(id);
          if (marker) {
            marker.classList.toggle("is-at-start", ratio <= 0.02);
            marker.classList.toggle("is-at-end", ratio >= 0.98);
          }
        }

        let effectOptionsCatalog = ["none"];
        function effectOptionsSignature(options) {
          const serialized = JSON.stringify(options);
          let hash = 0x811c9dc5;
          for (let index = 0; index < serialized.length; index += 1) {
            hash = Math.imul(hash ^ serialized.charCodeAt(index), 0x01000193) >>> 0;
          }
          return `mxs.effect-options.v1:${options.length}:${hash.toString(16).padStart(8, "0")}`;
        }
        let effectOptionsCatalogSignature = effectOptionsSignature(effectOptionsCatalog);
        const effectOptionsArrayCache = new WeakMap();

        function createEffectOption(value) {
          const normalized = String(value);
          const item = document.createElement("option");
          item.value = normalized;
          item.textContent = normalized === "none" ? "None" : normalized;
          return item;
        }

        function rememberEffectOptions(options, declaredSignature) {
          let signature = effectOptionsCatalogSignature;
          let normalized = effectOptionsCatalog;
          if (Array.isArray(options)) {
            let cached = effectOptionsArrayCache.get(options);
            if (!cached) {
              const values = options.map((option) => String(option)).filter(Boolean);
              normalized = ["none", ...Array.from(new Set(values.filter((option) => option !== "none")))];
              cached = {
                normalized,
                signature: effectOptionsSignature(normalized),
              };
              effectOptionsArrayCache.set(options, cached);
            }
            normalized = cached.normalized;
            signature = cached.signature;
          }
          if (
            declaredSignature !== undefined &&
            declaredSignature !== null &&
            String(declaredSignature) !== signature
          ) {
            return null;
          }
          if (Array.isArray(options) && signature !== effectOptionsCatalogSignature) {
            effectOptionsCatalog = normalized;
            effectOptionsCatalogSignature = signature;
          }
          return signature;
        }

        function hydrateEffectOptionsSelect(select) {
          if (!select || !select.matches("select.effect-type-select")) return false;
          const cacheKey = "effect-options:" + select.id;
          if (
            select.dataset.effectOptionsHydrated === "true" &&
            valCache[cacheKey] === effectOptionsCatalogSignature
          ) {
            return false;
          }
          const selected = String(select.dataset.effectOptionsSelected || select.value || "none");
          const fragment = document.createDocumentFragment();
          let includesSelected = false;
          effectOptionsCatalog.forEach((option) => {
            const item = createEffectOption(option);
            if (item.value === selected) includesSelected = true;
            fragment.appendChild(item);
          });
          if (!includesSelected) fragment.appendChild(createEffectOption(selected));
          select.replaceChildren(fragment);
          select.value = selected;
          select.dataset.effectOptionsHydrated = "true";
          valCache[cacheKey] = effectOptionsCatalogSignature;
          return true;
        }

        function updateEffectOptions(id, options, selected, declaredSignature) {
          const select = getEl(id);
          if (!select) return;
          const signature = rememberEffectOptions(options, declaredSignature);
          if (!signature) return;
          const cacheKey = "effect-options:" + id;
          const selectedValue = String(selected ?? "none");
          const catalogChanged = valCache[cacheKey] !== signature;
          if (catalogChanged) {
            // The mirrored select is interactive, but constructing every effect
            // option for every Track delayed the first GUI ACK. Render the exact
            // selection immediately and hydrate the full catalog on interaction.
            select.replaceChildren(createEffectOption(selectedValue));
            select.dataset.effectOptionsHydrated = "false";
            valCache[cacheKey] = signature;
          } else if (
            select.dataset.effectOptionsHydrated !== "true" &&
            select.value !== selectedValue
          ) {
            select.replaceChildren(createEffectOption(selectedValue));
          }
          select.dataset.effectOptionsSelected = selectedValue;
          if (select.value !== selectedValue) select.value = selectedValue;
        }

        function summarizeEffectOptionRendering() {
          const selects = Array.from(document.querySelectorAll("select.effect-type-select"));
          return {
            catalogCount: effectOptionsCatalog.length,
            catalogSignature: effectOptionsCatalogSignature,
            selectCount: selects.length,
            deferredSelectCount: selects.filter(
              (select) => select.dataset.effectOptionsHydrated !== "true",
            ).length,
          };
        }

        let lastGuiRenderPhaseStats = {
          throttled: false,
          buildMs: 0,
          preludeMs: 0,
          masterMs: 0,
          dialogsMs: 0,
          samplerMs: 0,
          tracksMs: 0,
          qaMs: 0,
          totalMs: 0,
          effectOptions: {
            catalogCount: 0,
            selectCount: 0,
            deferredSelectCount: 0,
          },
        };
        const studioDialogs = (!RECEIVER_BRANCH || RECEIVER_BRANCH.gui) && window.MXSCreateStudioDialogs
          ? window.MXSCreateStudioDialogs({
              document, getEl, getEffectOptions: () => effectOptionsCatalog,
              formatMirroredParameterDisplay, readMirroredDisplayDescriptor, writeMirroredDisplayDescriptor,
            }) : null;
        const studioGuiActions = (!RECEIVER_BRANCH || RECEIVER_BRANCH.gui) && window.MXSCreateStudioGuiActions
          ? window.MXSCreateStudioGuiActions({
              document,
              protocolVersion: CAST_GUI_PROTOCOL_VERSION,
              getSessionNonce: () => guiSessionNonce,
              confirmInteraction: (revision) => confirmReceiverGuiInteraction(revision),
              clearInteractionFeedback: (element) => clearReceiverGuiInteractionFeedback(element),
              emitTelemetry: (type, data) => emitGuiChannelTelemetry(type, data),
              relayLog: (message) => relayLogToStudio(message),
            })
          : null;

        let lastRenderTime = 0;
        const RENDER_THROTTLE_MS = 1000 / 30; // Studio GUI updates target 30 Hz; sender ACK backpressure bounds load.
        const PCM_RENDER_THROTTLE_MS = 1000 / 30; // PCM audio callbacks run in the worklet; keep Studio's visual lane at 30 Hz.
        const WAVEFORM_RENDER_THROTTLE_MS = 100; // Expensive new geometry is 10 Hz; visual interpolation remains 30 Hz.
        const WAVEFORM_VISUAL_FRAME_INTERVAL_MS = 1000 / 30;
        const WAVEFORM_INTERPOLATION_MS = WAVEFORM_RENDER_THROTTLE_MS;
        const mirroredWaveformVisuals = new Map();
        let mirroredWaveformFrameHandle = null;
        let mirroredWaveformFrameUsesTimeout = false;
        let lastWaveformRenderTime = 0;
        let pendingWaveformState = null;
        let pendingWaveformRevision = -1;
        let waveformRenderTimer = null;
        let lastWaveformRenderRevision = -1;
        let lastWaveformRenderStats = { expected: 0, drawn: 0, surfaces: [] };

        function getMirroredWaveformNow() {
          return typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : Date.now();
        }

        function scheduleMirroredWaveformFrame() {
          if (mirroredWaveformFrameHandle !== null) return;
          if (typeof window.requestAnimationFrame === "function") {
            mirroredWaveformFrameUsesTimeout = false;
            mirroredWaveformFrameHandle = window.requestAnimationFrame(
              paintMirroredWaveformFrame,
            );
          } else {
            mirroredWaveformFrameUsesTimeout = true;
            mirroredWaveformFrameHandle = window.setTimeout(
              () => paintMirroredWaveformFrame(getMirroredWaveformNow()),
              WAVEFORM_VISUAL_FRAME_INTERVAL_MS,
            );
          }
        }

        function paintMirroredWaveformFrame(frameTime) {
          mirroredWaveformFrameHandle = null;
          const nowMs = Number.isFinite(Number(frameTime))
            ? Number(frameTime)
            : getMirroredWaveformNow();
          let needsAnotherFrame = false;
          mirroredWaveformVisuals.forEach((state, id) => {
            if (!state?.target) return;
            const elapsed = Math.max(0, nowMs - state.startedAt);
            const progress = state.interpolate
              ? Math.min(1, elapsed / WAVEFORM_INTERPOLATION_MS)
              : 1;
            const frame = progress >= 1
              ? state.target
              : interpolateMirroredWaveform(state.from, state.target, progress);
            state.displayed = frame;
            drawMirroredWaveform(
              id,
              frame,
              state.source,
              progress >= 1,
              progress >= 1 ? state.signature : null,
            );
            if (progress < 1) needsAnotherFrame = true;
          });
          if (needsAnotherFrame) scheduleMirroredWaveformFrame();
        }

        function queueMirroredWaveform(id, waveform, source) {
          if (!waveform) return false;
          const resolvedSource = waveform.source || source || "unknown";
          const signature = JSON.stringify(waveform);
          const previous = mirroredWaveformVisuals.get(id);
          if (previous?.signature === signature) {
            return drawMirroredWaveform(id, waveform, resolvedSource, true, signature);
          }
          // Source inactivity is authoritative. Never interpolate a stale
          // analyser frame toward silence because that keeps a visibly moving
          // waveform alive after Pause. Replace the per-surface cache and
          // paint the explicit centerline immediately.
          if (waveform.active === false) {
            const inactiveState = {
              source: resolvedSource,
              signature,
              from: waveform,
              target: waveform,
              displayed: waveform,
              interpolate: false,
              startedAt: getMirroredWaveformNow(),
            };
            mirroredWaveformVisuals.set(id, inactiveState);
            delete valCache["waveform:" + id];
            return drawMirroredWaveform(id, waveform, resolvedSource, true, signature);
          }
          const sourceChanged = previous && previous.source !== resolvedSource;
          const canInterpolate = Boolean(
            previous?.displayed &&
              previous.displayed.active !== false &&
              !sourceChanged &&
              resolvedSource !== "decoded_buffer" &&
              Array.isArray(previous.displayed.points) &&
              previous.displayed.points.length === waveform.points?.length,
          );
          const nextState = {
            source: resolvedSource,
            signature,
            from: canInterpolate ? previous.displayed : waveform,
            target: waveform,
            displayed: canInterpolate ? previous.displayed : waveform,
            interpolate: canInterpolate,
            startedAt: getMirroredWaveformNow(),
          };
          mirroredWaveformVisuals.set(id, nextState);
          const didDraw = drawMirroredWaveform(
            id,
            nextState.displayed,
            resolvedSource,
            !canInterpolate,
            !canInterpolate ? signature : null,
          );
          if (canInterpolate) scheduleMirroredWaveformFrame();
          return didDraw;
        }

        function resetMirroredWaveformVisuals() {
          if (mirroredWaveformFrameHandle !== null) {
            if (mirroredWaveformFrameUsesTimeout) {
              window.clearTimeout(mirroredWaveformFrameHandle);
            } else if (typeof window.cancelAnimationFrame === "function") {
              window.cancelAnimationFrame(mirroredWaveformFrameHandle);
            }
          }
          mirroredWaveformFrameHandle = null;
          mirroredWaveformVisuals.clear();
          Object.keys(valCache).forEach((key) => {
            if (key.startsWith("waveform:")) delete valCache[key];
          });
        }

        function renderWaveformState(s, guiRevision = -1) {
          if (!s) return false;
          const waveformStartedAt = typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : Date.now();
          try {
            let expected = 0;
            let drawn = 0;
            let missing = 0;
            const surfaces = [];
            const renderSurface = (id, waveform, owner, source) => {
              if (!waveform) return;
              expected += 1;
              const hasData = waveform.hasData !== false;
              if (!hasData) missing += 1;
              const didDraw = queueMirroredWaveform(id, waveform, source);
              if (didDraw) drawn += 1;
              const peak = Math.max(0, Number(waveform.peak) || 0);
              const nonFlat = Boolean(waveform.nonFlat ?? peak > 0.000001);
              surfaces.push({
                id,
                owner,
                source: waveform.source || source || "unknown",
                hasData,
                active: waveform.active !== false,
                peak,
                nonFlat,
                paintMode: waveform.paintMode || "unknown",
                sampleCount: Number(waveform.sampleCount) || 0,
                drawn: didDraw,
              });
            };
            if (s.master && s.master.waveform) {
              [
                ["master-waveform-L", s.master.waveform.left],
                ["master-waveform-R", s.master.waveform.right],
              ].forEach(([id, waveform]) => {
                renderSurface(
                  id,
                  waveform,
                  "master",
                  s.master.waveform.source || "master_live_envelope",
                );
              });
            }
            if (Array.isArray(s.tracks)) {
              s.tracks.forEach((t, i) => {
                if (!t || !t.waveform) return;
                [
                  ["t-wf-l-" + i, t.waveform.left],
                  ["t-wf-r-" + i, t.waveform.right],
                ].forEach(([id, waveform]) => {
                  renderSurface(id, waveform, `track-${i + 1}`, t.waveform.source);
                });
                if (!t.timeline) {
                  updateMirroredPlayhead("t-playhead-" + i, t.waveform.playhead);
                }
              });
            }
            lastWaveformRenderStats = {
              guiRevision,
              expected,
              drawn,
              missing,
              dataAvailable: Math.max(0, expected - missing),
              renderTimeMs: Math.max(
                0,
                (typeof performance !== "undefined" && typeof performance.now === "function"
                  ? performance.now()
                  : Date.now()) - waveformStartedAt,
              ),
              surfaces,
            };
            const status = getEl("waveform-render-status");
            if (status) {
              status.hidden = expected === 0;
              status.textContent = expected === 0
                ? "Waveforms awaiting sender data"
                : `Waveforms rendered ${drawn}/${expected}` + (missing ? ` · data pending ${missing}` : "");
              status.dataset.expected = String(expected);
              status.dataset.drawn = String(drawn);
              status.dataset.missing = String(missing);
            }
            emitGuiChannelTelemetry("waveform_render", lastWaveformRenderStats);
            return drawn === expected;
          } catch (e) {
            console.error("❌ Receiver Waveform Render Error:", e);
            lastWaveformRenderStats = {
              guiRevision,
              expected: 0,
              drawn: 0,
              missing: 0,
              dataAvailable: 0,
              surfaces: [],
            };
            return false;
          }
        }

        function flushScheduledWaveformRender() {
          waveformRenderTimer = null;
          const state = pendingWaveformState;
          const revision = pendingWaveformRevision;
          pendingWaveformState = null;
          pendingWaveformRevision = -1;
          if (!state) return;
          if (revision >= 0 && revision < lastWaveformRenderRevision) return;
          lastWaveformRenderTime = Date.now();
          if (revision >= 0) lastWaveformRenderRevision = revision;
          renderWaveformState(state, revision);
        }

        function scheduleWaveformRender(s, force = false, revision = -1) {
          if (!s) return;
          const nextRevision = Number.isSafeInteger(Number(revision))
            ? Number(revision)
            : -1;
          if (nextRevision >= 0 && nextRevision < pendingWaveformRevision) return;
          pendingWaveformState = s;
          pendingWaveformRevision = nextRevision;
          if (force || lastWaveformRenderRevision === -1) {
            if (waveformRenderTimer) {
              clearTimeout(waveformRenderTimer);
            }
            // The first snapshot can contain ten waveform surfaces. Painting
            // them synchronously delayed the receiver GUI ACK by roughly
            // 770 ms on the QA device; controls and dialog actions are
            // authoritative now, while these latest-value canvases can paint
            // on the next task without blocking that interaction boundary.
            waveformRenderTimer = setTimeout(flushScheduledWaveformRender, 0);
            return;
          }
          const elapsedSinceLastRenderMs = Math.max(
            0,
            Date.now() - lastWaveformRenderTime,
          );
          if (elapsedSinceLastRenderMs >= WAVEFORM_RENDER_THROTTLE_MS) {
            if (waveformRenderTimer) {
              clearTimeout(waveformRenderTimer);
            }
            waveformRenderTimer = setTimeout(flushScheduledWaveformRender, 0);
            return;
          }
          if (!waveformRenderTimer) {
            waveformRenderTimer = setTimeout(
              flushScheduledWaveformRender,
              Math.max(
                0,
                WAVEFORM_RENDER_THROTTLE_MS - elapsedSinceLastRenderMs,
              ),
            );
          }
        }

        function getTrackAssignmentCacheKey(t, s) {
          const la = t.lfoAssigns;
          const li = t.lfoIndicators;
          let liKey = "";
          if (li) {
            for (let k = 0; k < KNOB_CONFIGS.length; k++) {
              const ind = li[KNOB_CONFIGS[k].p];
              if (ind) {
                liKey += `${ind.lfo1?.checked ? 1 : 0}${ind.lfo1?.reversed ? 1 : 0}${ind.lfo2?.checked ? 1 : 0}${ind.lfo2?.reversed ? 1 : 0}${ind.minMarker?.active ? 1 : 0}:${ind.minMarker?.left || 0}:${ind.maxMarker?.active ? 1 : 0}:${ind.maxMarker?.left || 0};`;
              } else {
                liKey += "0;";
              }
            }
          }
          return `${la ? `${(la[1] || []).join(",")}|${(la[2] || []).join(",")}` : ""}_${liKey}`;
        }

        function getTrackParamsCacheKey(t, s) {
          const p = t.params;
          if (!p) return "";
          const pd = t.paramDisplays;
          return `${p.pitch}:${p.vol}:${p.pan}:${p.treble}:${p.mid_freq}:${p.mid_gain}:${p.bass}:${p.inputGain}:${p.loopStart}:${p.loopEnd}_` +
            `${pd ? `${pd.pitch?.displayValue || ""}:${pd.vol?.displayValue || ""}:${pd.pan?.displayValue || ""}:${pd.treble?.displayValue || ""}:${pd.mid_freq?.displayValue || ""}:${pd.mid_gain?.displayValue || ""}:${pd.bass?.displayValue || ""}:${pd.inputGain?.displayValue || ""}:${pd.loopStart?.displayValue || ""}:${pd.loopEnd?.displayValue || ""}` : ""}`;
        }

        function getSamplerPadVisualSignature(p) {
          // Only the receiver pad surface is relevant here. Envelopes, FX,
          // assets and layer graphs remain in the immutable structural state.
          return JSON.stringify([p.id, p.loaded, p.active, p.repeat?.enabled, p.reverse, p.name,
            p.selected, p.mode, p.muted, p.tune, p.baseBpm, p.effectiveBpm, p.syncAll, p.syncTrack, p.color]);
        }

        const _lastAssignmentCache = [];
        const _lastParamsCache = [];
        const _lastFxCache = [];
        let lastMirroredState = null;
        let guiLastVisualProofAt = 0;
        let pendingGuiRenderTimer = null;
        let pendingGuiRenderState = null;
        let pendingGuiRenderRevision = -1;
        let pendingGuiPaintRevision = -1;
        let pendingGuiPaintHandle = null;
        let pendingGuiPaintSubmittedAtMs = 0;
        function scheduleGuiPaintOpportunity(revision, submittedAtMs = getLfoVisualNow()) {
          if (revision >= pendingGuiPaintRevision) {
            pendingGuiPaintRevision = revision;
            pendingGuiPaintSubmittedAtMs = submittedAtMs;
          }
          if (pendingGuiPaintHandle !== null || typeof window.requestAnimationFrame !== "function") return;
          window.requestAnimationFrame(() => {
            const proofRevision = pendingGuiPaintRevision;
            const proofSubmittedAtMs = pendingGuiPaintSubmittedAtMs;
            pendingGuiPaintHandle = window.requestAnimationFrame(() => {
              pendingGuiPaintHandle = null;
              sendGuiChannelTelemetry("gui_paint_opportunity", { guiRevision: proofRevision,
                submittedAtMonotonicMs: proofSubmittedAtMs,
                evidenceStage: "two_animation_frames_after_dom_submission", physicalPaintVerified: false,
                elapsedMs: getLfoVisualNow() - proofSubmittedAtMs, presentation: getPresentedSourceAudioTime() });
              if (pendingGuiPaintRevision > proofRevision) scheduleGuiPaintOpportunity(pendingGuiPaintRevision, pendingGuiPaintSubmittedAtMs);
            });
          });
          pendingGuiPaintHandle = -1;
        }
        const guiRevisionStates = new Map();
        const MIRRORED_TIMELINE_FRAME_INTERVAL_MS = 1000 / 30;
        const MIRRORED_TIMELINE_DISCONTINUITY_SEC = 0.75;
        const MIRRORED_TIMELINE_MAX_SOFT_CORRECTION_SEC = 0.05;
        let mirroredTimelineState = {
          captureSequence: -1,
          playbackEpoch: null,
          playbackRevision: null,
          master: null,
          tracks: [],
        };
        let mirroredTimelineFrameHandle = null;
        let mirroredTimelineFrameUsesTimeout = false;
        let lastMirroredTimelinePaintMs = 0;

        function formatMirroredClockTimecode(seconds) {
          const totalCentiseconds = Math.max(
            0,
            Math.round((Number(seconds) || 0) * 100),
          );
          const centiseconds = totalCentiseconds % 100;
          const totalSeconds = Math.floor(totalCentiseconds / 100);
          const secs = totalSeconds % 60;
          const totalMinutes = Math.floor(totalSeconds / 60);
          const mins = totalMinutes % 60;
          const hours = Math.floor(totalMinutes / 60);
          const pad = (value) => String(value).padStart(2, "0");
          return `${pad(hours)}:${pad(mins)}:${pad(secs)}:${pad(centiseconds)}`;
        }

        function getMirroredTimelineNow() {
          return typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : Date.now();
        }

        function clampMirroredTimelinePosition(value, timeline) {
          const duration = Math.max(0, Number(timeline?.durationSeconds) || 0);
          const position = Math.max(0, Number(value) || 0);
          if (!(duration > 0)) return position;
          if (timeline?.loopEnabled === true) {
            const start = Math.max(
              0,
              Math.min(duration, Number(timeline.loopStartSeconds) || 0),
            );
            const end = Math.max(
              start,
              Math.min(duration, Number(timeline.loopEndSeconds) || duration),
            );
            const span = end - start;
            if (span > 0) {
              return start + ((((position - start) % span) + span) % span);
            }
          }
          if (timeline?.positionBounded === false) return position;
          return Math.max(0, Math.min(duration, position));
        }

        function calculateMirroredTimelinePosition(anchor, nowMs) {
          if (!anchor?.timeline) return 0;
          const timeline = anchor.timeline;
          const presented = typeof getPresentedSourceAudioTime === "function" ? getPresentedSourceAudioTime(nowMs) : null;
          if (presented && Number.isFinite(anchor.capturedAtAudioSec)) {
            const elapsed = timeline.running === true ? presented.audioSec - anchor.capturedAtAudioSec : 0;
            anchor.lastPresentedPosition = clampMirroredTimelinePosition(Number(anchor.positionSeconds) + elapsed *
              Math.max(0.01, Number(timeline.playbackRate) || 1) * (Number(timeline.direction) < 0 ? -1 : 1), timeline);
            return anchor.lastPresentedPosition;
          }
          if (Number.isFinite(anchor.capturedAtAudioSec) &&
              (window._playbackMode === "native" || window._playbackMode === "pcm_fallback")) {
            return anchor.lastPresentedPosition ?? anchor.positionSeconds;
          }
          const elapsedSeconds = timeline.running === true
            ? Math.max(0, Number(nowMs) - Number(anchor.receivedAtMs || nowMs)) / 1000
            : 0;
          const direction = Number(timeline.direction) < 0 ? -1 : 1;
          const rate = Math.max(0.01, Number(timeline.playbackRate) || 1);
          return clampMirroredTimelinePosition(
            Number(anchor.positionSeconds) + elapsedSeconds * rate * direction,
            timeline,
          );
        }

        function shortestMirroredTimelineDelta(from, to, timeline) {
          let delta = Number(to) - Number(from);
          if (timeline?.loopEnabled !== true) return delta;
          const start = Math.max(0, Number(timeline.loopStartSeconds) || 0);
          const end = Math.max(start, Number(timeline.loopEndSeconds) || 0);
          const span = end - start;
          if (!(span > 0)) return delta;
          if (delta > span / 2) delta -= span;
          if (delta < -span / 2) delta += span;
          return delta;
        }

        function isMirroredTimelineIdentityCurrent(
          transport,
          receiverPlaybackEpoch,
          receiverPlaybackRevision,
        ) {
          const snapshotEpoch = transport?.playbackEpoch == null ? NaN : Number(transport.playbackEpoch);
          const snapshotRevision = transport?.playbackRevision == null ? NaN : Number(transport.playbackRevision);
          const receiverEpoch = receiverPlaybackEpoch == null ? NaN : Number(receiverPlaybackEpoch);
          const receiverRevision = receiverPlaybackRevision == null ? NaN : Number(receiverPlaybackRevision);
          const snapshotIdentityKnown = Number.isSafeInteger(snapshotEpoch) && snapshotEpoch >= 0 &&
            Number.isSafeInteger(snapshotRevision) && snapshotRevision >= 0;
          const receiverIdentityKnown = Number.isSafeInteger(receiverEpoch) && receiverEpoch >= 0 &&
            Number.isSafeInteger(receiverRevision) && receiverRevision >= 0;
          if (!snapshotIdentityKnown) return true;
          if (!receiverIdentityKnown) return snapshotRevision === 0;
          return snapshotEpoch === receiverEpoch && snapshotRevision === receiverRevision;
        }

        function createMirroredTimelineAnchor(previous, rawTimeline, nowMs) {
          if (!rawTimeline || typeof rawTimeline !== "object") return null;
          const durationSeconds = Math.max(0, Number(rawTimeline.durationSeconds) || 0);
          const timeline = {
            ...rawTimeline,
            positionSeconds: Math.max(0, Number(rawTimeline.positionSeconds) || 0),
            durationSeconds,
            playbackRate: Math.max(0.01, Number(rawTimeline.playbackRate) || 1),
            direction: Number(rawTimeline.direction) < 0 ? -1 : 1,
            running: rawTimeline.running === true,
            loopEnabled: rawTimeline.loopEnabled === true,
          };
          const authoritative = clampMirroredTimelinePosition(
            timeline.positionSeconds,
            timeline,
          );
          let anchoredPosition = authoritative;
          if (previous?.timeline) {
            const predicted = calculateMirroredTimelinePosition(previous, nowMs);
            const sameMotion =
              previous.timeline.running === timeline.running &&
              Number(previous.timeline.direction) === Number(timeline.direction) &&
              Math.abs(
                Number(previous.timeline.playbackRate || 1) - Number(timeline.playbackRate || 1),
              ) < 0.0001 &&
              previous.timeline.loopEnabled === timeline.loopEnabled;
            const delta = shortestMirroredTimelineDelta(predicted, authoritative, timeline);
            if (
              sameMotion &&
              timeline.running === true &&
              Math.abs(delta) <= MIRRORED_TIMELINE_DISCONTINUITY_SEC
            ) {
              anchoredPosition = clampMirroredTimelinePosition(
                predicted + Math.max(
                  -MIRRORED_TIMELINE_MAX_SOFT_CORRECTION_SEC,
                  Math.min(MIRRORED_TIMELINE_MAX_SOFT_CORRECTION_SEC, delta),
                ),
                timeline,
              );
            }
          }
          return {
            timeline,
            capturedAtAudioSec: rawTimeline.capturedAtAudioSec,
            positionSeconds: timeline.running === true ? anchoredPosition : authoritative,
            receivedAtMs: nowMs,
          };
        }

        function scheduleMirroredTimelineFrame() {
          if (mirroredTimelineFrameHandle !== null) return;
          if (typeof window.requestAnimationFrame === "function") {
            mirroredTimelineFrameUsesTimeout = false;
            mirroredTimelineFrameHandle = window.requestAnimationFrame(
              paintMirroredTimelineFrame,
            );
          } else {
            mirroredTimelineFrameUsesTimeout = true;
            mirroredTimelineFrameHandle = window.setTimeout(
              () => paintMirroredTimelineFrame(getMirroredTimelineNow()),
              MIRRORED_TIMELINE_FRAME_INTERVAL_MS,
            );
          }
        }

        function paintMirroredTimelineFrame(frameTime) {
          mirroredTimelineFrameHandle = null;
          const nowMs = Number.isFinite(Number(frameTime))
            ? Number(frameTime)
            : getMirroredTimelineNow();
          if (
            lastMirroredTimelinePaintMs > 0 &&
            nowMs - lastMirroredTimelinePaintMs < MIRRORED_TIMELINE_FRAME_INTERVAL_MS
          ) {
            scheduleMirroredTimelineFrame();
            return;
          }
          lastMirroredTimelinePaintMs = nowMs;
          let hasRunningTimeline = false;
          const masterAnchor = mirroredTimelineState.master;
          if (masterAnchor?.timeline) {
            const masterPosition = calculateMirroredTimelinePosition(masterAnchor, nowMs);
            updateText("recording-time-display", formatMirroredClockTimecode(masterPosition));
            const masterDuration = Math.max(
              0,
              Number(masterAnchor.timeline.durationSeconds) || 0,
            );
            const masterPlayhead = masterAnchor.timeline.isRecording === true && masterDuration > 0
              ? ((masterPosition % masterDuration) + masterDuration) % masterDuration / masterDuration
              : 0;
            updateMirroredPlayhead("master-play-marker", masterPlayhead);
            updateStyleLeft("master-loop-start-marker", "0%");
            updateStyleLeft("master-loop-end-marker", "100%");
            hasRunningTimeline =
              hasRunningTimeline || masterAnchor.timeline.running === true;
          }
          mirroredTimelineState.tracks.forEach((anchor, index) => {
            if (!anchor?.timeline) return;
            const position = calculateMirroredTimelinePosition(anchor, nowMs);
            updateText("t-time-" + index, formatMirroredClockTimecode(position));
            const duration = Math.max(0, Number(anchor.timeline.durationSeconds) || 0);
            updateMirroredPlayhead(
              "t-playhead-" + index,
              duration > 0 ? position / duration : 0,
            );
            hasRunningTimeline = hasRunningTimeline || anchor.timeline.running === true;
          });
          if (hasRunningTimeline) scheduleMirroredTimelineFrame();
        }

        function updateMirroredTimelineState(state, frameNowMs = getMirroredTimelineNow()) {
          if (typeof getPresentationVisualState === "function") {
            const presented = getPresentationVisualState(state, frameNowMs);
            if (presented) state = presented;
            else if (window._playbackMode === "native" || window._playbackMode === "pcm_fallback") return true;
          }
          if (!state || typeof state !== "object") return false;
          const transport = state.transport && typeof state.transport === "object"
            ? state.transport
            : {};
          if (!isMirroredTimelineIdentityCurrent(transport, lastPlaybackEpoch, lastPlaybackRevision)) {
            return true;
          }
          const rawMaster = transport.master || state.master?.timeline;
          const rawTracks = Array.isArray(state.tracks)
            ? state.tracks.map((track) => track?.timeline || null)
            : [];
          if (!rawMaster && !rawTracks.some(Boolean)) return false;
          const captureSequence = transport.captureSequence == null ? NaN : Number(transport.captureSequence);
          const playbackEpoch = transport.playbackEpoch == null ? NaN : Number(transport.playbackEpoch);
          const playbackRevision = transport.playbackRevision == null ? NaN : Number(transport.playbackRevision);
          const hasPlaybackIdentity = Number.isSafeInteger(playbackEpoch) && playbackEpoch >= 0 &&
            Number.isSafeInteger(playbackRevision) && playbackRevision >= 0;
          const playbackIdentityChanged = hasPlaybackIdentity && (
            playbackEpoch !== mirroredTimelineState.playbackEpoch ||
            playbackRevision !== mirroredTimelineState.playbackRevision
          );
          if (
            Number.isSafeInteger(captureSequence) &&
            captureSequence >= 0 &&
            captureSequence < mirroredTimelineState.captureSequence
          ) {
            return true;
          }
          // Anchor interpolation to the receiver's monotonic clock at receipt.
          // transport.capturedAtMs is sender-epoch telemetry and must not be
          // subtracted from this receiver clock without an offset calibration.
          const nowMs = frameNowMs;
          mirroredTimelineState = {
            captureSequence: Number.isSafeInteger(captureSequence)
              ? captureSequence
              : mirroredTimelineState.captureSequence,
            playbackEpoch: hasPlaybackIdentity
              ? playbackEpoch
              : mirroredTimelineState.playbackEpoch,
            playbackRevision: hasPlaybackIdentity
              ? playbackRevision
              : mirroredTimelineState.playbackRevision,
            master: createMirroredTimelineAnchor(
              playbackIdentityChanged ? null : mirroredTimelineState.master,
              rawMaster ? { ...rawMaster, capturedAtAudioSec: transport.capturedAtAudioSec } : null,
              nowMs,
            ),
            tracks: rawTracks.map((timeline, index) =>
              createMirroredTimelineAnchor(
                playbackIdentityChanged ? null : mirroredTimelineState.tracks[index],
                timeline ? { ...timeline, capturedAtAudioSec: transport.capturedAtAudioSec } : null,
                nowMs,
              ),
            ),
          };
          paintMirroredTimelineFrame(nowMs);
          return true;
        }

        function resetMirroredTimelineState() {
          if (mirroredTimelineFrameHandle !== null) {
            if (mirroredTimelineFrameUsesTimeout) {
              window.clearTimeout(mirroredTimelineFrameHandle);
            } else if (typeof window.cancelAnimationFrame === "function") {
              window.cancelAnimationFrame(mirroredTimelineFrameHandle);
            }
          }
          mirroredTimelineFrameHandle = null;
          lastMirroredTimelinePaintMs = 0;
          mirroredTimelineState = {
            captureSequence: -1,
            playbackEpoch: null,
            playbackRevision: null,
            master: null,
            tracks: [],
          };
        }

        const LFO_VISUAL_FRAME_INTERVAL_MS = 1000 / 30;
        const LFO_VISUAL_PHASE_CORRECTION_MS = 180;
        const LFO_VISUAL_TWO_PI = Math.PI * 2;
        const smoothLfoClocks = {
          1: { active: false, phase: null, correction: 0, period: 1.8, lastFrameMs: 0, waveformType: "sine", dutyCycle: 0.5 },
          2: { active: false, phase: null, correction: 0, period: 1.8, lastFrameMs: 0, waveformType: "sine", dutyCycle: 0.5 },
        };
        let smoothLfoFrameHandle = null;
        let smoothLfoFrameUsesTimeout = false;
        let lastSmoothLfoPaintMs = 0;
        let presentationSpans = [];

        function computeReceiverLfoWaveformValue(phase, waveformType = "sine", dutyCycle = 0.5) {
          if (phase === null || !Number.isFinite(phase)) return 0;
          const p = ((phase / LFO_VISUAL_TWO_PI) % 1 + 1) % 1;
          // Audio evaluates a repeating buffer over one cycle, including the
          // fractional-frequency beat envelope. Keep every trig term in that cycle.
          phase = p * LFO_VISUAL_TWO_PI;
          dutyCycle = dutyCycle != null && Number.isFinite(Number(dutyCycle))
            ? Math.max(0.001, Math.min(0.999, Number(dutyCycle))) : 0.5;
          if (!waveformType || waveformType === "sine") return Math.sin(phase);
          switch (waveformType) {
            // --- Golden 10 Core Waveforms ---
            case "sine":
              return Math.sin(phase);
            case "triangle":
              return 1 - 4 * Math.abs(p - 0.5);
            case "square":
              return p < dutyCycle ? 1 : -1;
            case "pulse":
              return p < (dutyCycle !== 0.5 ? dutyCycle : 0.25) ? 1 : -1;
            case "sawtooth_up":
            case "sawtooth":
            case "rising_ramp":
            case "ramp_up":
              return p * 2 - 1;
            case "sawtooth_down":
            case "falling_ramp":
            case "ramp_down":
            case "ramp":
              return 1 - p * 2;
            case "exponential_rise":
            case "expo_rise":
              return ((Math.exp(3 * p) - 1) / (Math.exp(3) - 1)) * 2 - 1;
            case "exponential_decay":
            case "expo_decay":
              return ((Math.exp(-3 * p) - Math.exp(-3)) / (1 - Math.exp(-3))) * 2 - 1;
            case "damped_ring":
            case "damped_oscillation":
            case "damped_osc":
              return Math.exp(-3.5 * p) * Math.cos(p * LFO_VISUAL_TWO_PI * 4);
            case "sample_hold":
            case "random_sh": {
              const step = Math.floor(p * 16);
              const val = (((Math.sin(step * 12.9898 + 78.233) * 43758.5453) % 1) + 1) % 1;
              return val * 2 - 1;
            }

            // --- The New Seven Advanced Modulation Suite ---
            case "sine_beats":
            case "acoustic_beats":
              return Math.sin(phase) * Math.cos(phase * 0.0625);
            case "am_flutter":
              return Math.sin(phase * 8) * (0.5 + 0.5 * Math.sin(phase));
            case "fm_chirp":
              return Math.sin(LFO_VISUAL_TWO_PI * (p + 1.5 * p * p));
            case "noisy_sine": {
              const prng = (((Math.sin(p * 9381.123 + 43.12) * 43758.5453) % 1) + 1) % 1 * 2 - 1;
              return 0.8 * Math.sin(phase) + 0.2 * prng;
            }
            case "ringing_pulse": {
              const basePulse = p < 0.5 ? 1 : -1;
              const edgePhase = (p % 0.5) / 0.5;
              const ring = Math.exp(-10 * edgePhase) * Math.sin(edgePhase * Math.PI * 16);
              return Math.max(-1, Math.min(1, basePulse * 0.8 + ring * 0.35));
            }
            case "damped_pluck": {
              const decay = Math.exp(-4 * p);
              const ring = Math.cos(p * LFO_VISUAL_TWO_PI * 5);
              const pluckNoise = (((Math.sin(p * 4827.1 + 12.3) * 43758.5453) % 1) + 1) % 1 * 2 - 1;
              return Math.max(-1, Math.min(1, decay * (ring * 0.85 + pluckNoise * 0.15)));
            }
            case "poly_pulse": {
              const pulse1 = p < 0.5 ? 1 : -1;
              const p2 = ((p * 1.375) % 1 + 1) % 1;
              const pulse2 = p2 < 0.5 ? 1 : -1;
              return pulse1 * 0.5 + pulse2 * 0.5;
            }

            // --- Compatibility Aliases ---
            case "cosine":
              return Math.cos(phase);
            case "rectangular":
              return p < (dutyCycle !== 0.5 ? dutyCycle : 0.75) ? 1 : -1;
            case "step": {
              const steps = 4;
              return (Math.floor(p * steps) / (steps - 1)) * 2 - 1;
            }
            case "staircase": {
              const steps = 8;
              return (Math.floor(p * steps) / (steps - 1)) * 2 - 1;
            }
            case "noise": {
              const seed = Math.floor(p * 64);
              const val = (((Math.sin(seed * 12.9898 + 78.233) * 43758.5453) % 1) + 1) % 1;
              return val * 2 - 1;
            }
            case "random_smooth":
            case "drift": {
              const t = p * 16;
              const i0 = Math.floor(t);
              const frac = t - i0;
              const getVal = (s) => ((((Math.sin(((s % 16 + 16) % 16) * 12.9898 + 78.233) * 43758.5453) % 1) + 1) % 1) * 2 - 1;
              const v0 = getVal(i0);
              const v1 = getVal(i0 + 1);
              const smooth = (1 - Math.cos(frac * Math.PI)) * 0.5;
              return v0 + (v1 - v0) * smooth;
            }
            default:
              return Math.sin(phase);
          }
        }

        function normalizeReceiverLfoGateValue(value) {
          if (value === null || value === undefined) return 1;
          const numeric = Number(value);
          if (!Number.isFinite(numeric)) return 1;
          return Math.max(0, Math.min(1, numeric));
        }

        const studioLfoWaveforms = (!RECEIVER_BRANCH || RECEIVER_BRANCH.gui) && window.MXSCreateStudioLfoWaveforms
          ? window.MXSCreateStudioLfoWaveforms({
              ResizeObserver: typeof ResizeObserver === "function" ? ResizeObserver : undefined,
              computeReceiverLfoWaveformValue,
              normalizeReceiverLfoGateValue,
            }) : null;

        function drawReceiverLfoWaveform(canvas, lfoIndex, clock) {
          return studioLfoWaveforms?.draw(canvas, lfoIndex, clock) || false;
        }

        function initReceiverLfoWaveforms() {
          const canvas1 = getEl("lfo-waveform-1");
          const canvas2 = getEl("lfo-waveform-2");
          if (canvas1) {
            drawReceiverLfoWaveform(canvas1, 1, smoothLfoClocks[1]);
          }
          if (canvas2) {
            drawReceiverLfoWaveform(canvas2, 2, smoothLfoClocks[2]);
          }
        }
        let lastSubmittedLfoProof = null;
        let lastLfoTelemetryReportAtMs = 0;
        let lfoFrameMeasurements = { lastAt: null, lastSource: null, frames: 0, gaps: 0,
          bins: [0, 0, 0, 0, 0, 0, 0], maxGapMs: 0, held: 0, backwards: 0, maxStepErrorMs: 0,
          unavailable: 0, workSamplesMs: [] };
        let cachedLfoVisualState = null;
        let cachedLfoVisualBindings = [];

        function recordLfoFrameMeasurement(nowMs) {
          const clocks = [smoothLfoClocks[1], smoothLfoClocks[2]];
          const clock = clocks.find((item) => item.active && item.phase !== null);
          if (!clock) { lfoFrameMeasurements.lastAt = null; lfoFrameMeasurements.lastSource = null; return; }
          const m = lfoFrameMeasurements;
          m.frames++;
          const source = Number.isFinite(clock.sourceAudioSec) && clock.presentationAvailable ? clock.sourceAudioSec : null;
          if (source === null) m.unavailable++;
          if (m.lastAt !== null) {
            const gap = Math.max(0, nowMs - m.lastAt);
            const bounds = [16.67, 33.34, 50, 100, 250, 500, Infinity];
            m.bins[bounds.findIndex((bound) => gap <= bound)]++;
            m.gaps++;
            m.maxGapMs = Math.max(m.maxGapMs, gap);
            if (source !== null && m.lastSource !== null) {
              const step = (source - m.lastSource) * 1000;
              if (Math.abs(step) < 0.001) m.held++;
              if (step < -0.001) m.backwards++;
              m.maxStepErrorMs = Math.max(m.maxStepErrorMs, Math.abs(step - gap));
            }
          }
          m.lastAt = nowMs;
          m.lastSource = source;
        }

        function recordLfoFrameWork(startedAtMs) {
          const endedAtMs = typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : Date.now();
          const duration = Math.max(0, endedAtMs - startedAtMs);
          const samples = lfoFrameMeasurements.workSamplesMs;
          samples.push(duration);
          if (samples.length > 128) samples.shift();
        }

        function takeLfoFrameMeasurements() {
          const m = lfoFrameMeasurements;
          const work = m.workSamplesMs.slice().sort((left, right) => left - right);
          const workP95Index = work.length ? Math.min(work.length - 1, Math.ceil(work.length * 0.95) - 1) : -1;
          const result = { schema: "mxs.cast.frame-stats.v1", frames: m.frames, gaps: m.gaps,
            gapBoundsMs: [16.67, 33.34, 50, 100, 250, 500, null], gapCounts: m.bins,
            maxGapMs: m.maxGapMs, heldSourceSteps: m.held, backwardSourceSteps: m.backwards,
            maxSourceStepErrorMs: m.maxStepErrorMs, unavailableFrames: m.unavailable,
            frameCallbackWorkSamples: work.length,
            frameCallbackWorkP95Ms: workP95Index >= 0 ? Number(work[workP95Index].toFixed(3)) : null,
            frameCallbackWorkMaxMs: work.length ? Number(work[work.length - 1].toFixed(3)) : null };
          lfoFrameMeasurements = { lastAt: m.lastAt, lastSource: m.lastSource, frames: 0, gaps: 0,
            bins: [0, 0, 0, 0, 0, 0, 0], maxGapMs: 0, held: 0, backwards: 0, maxStepErrorMs: 0,
            unavailable: 0, workSamplesMs: [] };
          return result;
        }
        let nativePresentationGeneration = -1;
        // Media currentTime may advance in coarse steps. Project between fresh
        // readings, with bounded correction and a hard stall horizon. This is a
        // media estimate; it does not measure the speaker/display offset.
        const NATIVE_PRESENTATION_STALE_MS = 350;
        let nativePresentationClock = null;

        function projectNativePresentationClock(audio, identity, nowMs) {
          const raw = audio.currentTime;
          const rate = Number.isFinite(audio.playbackRate) && audio.playbackRate > 0 ? audio.playbackRate : 1;
          if (!Number.isFinite(raw) || audio.paused || audio.seeking || audio.readyState < 3) {
            nativePresentationClock = null;
            return null;
          }
          let c = nativePresentationClock;
          const reset = (reason) => {
            c = { identity, audio, raw, projected: raw, atMs: nowMs, changedAtMs: nowMs,
              quantumMs: 0, repeated: 0, observations: 1, resets: (c?.resets || 0) + 1, reason, errorMs: 0 };
            nativePresentationClock = c;
          };
          if (!c || c.identity !== identity || c.audio !== audio) reset("identity");
          nowMs = Math.max(c.atMs, nowMs);
          const dt = Math.max(0, nowMs - c.atMs);
          const delta = raw - c.raw;
          if (delta < -0.001 || Math.abs(delta - dt * rate / 1000) > 0.75) reset("discontinuity");
          else if (delta > 0) {
            if (nowMs - c.changedAtMs > NATIVE_PRESENTATION_STALE_MS) reset("resume_after_stall");
            else {
              // A repeated reading followed by a step reveals clock quantum;
              // continuous observations must not be confused with RAF cadence.
              if (c.repeated > 0 || (dt > 0 && Math.abs(delta * 1000 - dt * rate) > 2)) {
                c.quantumMs = Math.min(250, Math.max(c.quantumMs, delta * 1000));
              }
              c.observations++;
              c.changedAtMs = nowMs;
              c.repeated = 0;
              c.reason = "tracking";
            }
          } else if (dt > 0) c.repeated++;
          const ageMs = Math.max(0, nowMs - c.changedAtMs);
          if (ageMs > NATIVE_PRESENTATION_STALE_MS) return null;
          const elapsed = Math.max(0, nowMs - c.atMs);
          const predicted = c.projected + elapsed * rate / 1000;
          const error = raw - predicted;
          const tolerance = Math.max(0.002, c.quantumMs / 1000);
          const outside = Math.sign(error) * Math.max(0, Math.abs(error) - tolerance);
          const correction = delta > 0 ? Math.max(-elapsed * 0.00005, Math.min(elapsed * 0.00005, outside)) : 0;
          c.projected = Math.max(c.projected, predicted + correction);
          c.errorMs = error * 1000;
          c.raw = raw;
          c.atMs = nowMs;
          return { mediaSec: c.projected, mediaClockResolutionMs: c.quantumMs || null,
            mediaClockUncertaintyMs: c.quantumMs || (c.observations >= 3 ? 2 : NATIVE_PRESENTATION_STALE_MS), observationAgeMs: ageMs,
            clockCorrectionMs: correction * 1000, clockErrorMs: c.errorMs,
            clockStatus: c.reason, clockObservations: c.observations, clockResets: c.resets };
        }
        let pcmPresentationPosition = null;
        let presentationVisualHistory = [];
        let lastPresentationVisualSequence = -1;
        let presentationClockLookupGeneration = 0;
        let presentationSourceTimeCache = null;
        let presentationVisualStateCache = null;
        let activeRenderLookupStats = null;

        function recordPresentationLookupStat(key, amount = 1) {
          if (!activeRenderLookupStats) return;
          activeRenderLookupStats[key] = (activeRenderLookupStats[key] || 0) + amount;
        }

        function samePresentationClockLookupKey(left, right) {
          return Boolean(left && right &&
            left.nowMs === right.nowMs &&
            left.route === right.route &&
            left.playbackEpoch === right.playbackEpoch &&
            left.playbackRevision === right.playbackRevision &&
            left.generation === right.generation &&
            left.nativeGeneration === right.nativeGeneration &&
            left.nativeAttempt === right.nativeAttempt &&
            left.nativeActive === right.nativeActive &&
            left.nativePaused === right.nativePaused &&
            left.mediaElement === right.mediaElement &&
            left.mediaTime === right.mediaTime &&
            left.mediaPaused === right.mediaPaused &&
            left.mediaSeeking === right.mediaSeeking &&
            left.mediaReadyState === right.mediaReadyState &&
            left.sourceSessionId === right.sourceSessionId &&
            left.sourceCaptureSequence === right.sourceCaptureSequence &&
            left.pcmMediaFrame === right.pcmMediaFrame &&
            left.pcmAudioTime === right.pcmAudioTime &&
            left.pcmPlaying === right.pcmPlaying &&
            left.pcmPlaybackEpoch === right.pcmPlaybackEpoch &&
            left.pcmPlaybackRevision === right.pcmPlaybackRevision &&
            left.pcmSessionId === right.pcmSessionId &&
            left.audioContextState === right.audioContextState &&
            left.audioContextSampleRate === right.audioContextSampleRate &&
            left.audioContextBaseLatency === right.audioContextBaseLatency &&
            left.audioContextOutputLatency === right.audioContextOutputLatency &&
            left.sourceClock === right.sourceClock);
        }

        function rememberPresentationVisualState(state) {
          const transport = state?.transport;
          if (!transport || !Number.isFinite(transport.capturedAtAudioSec)) return;
          let previous = presentationVisualHistory[presentationVisualHistory.length - 1];
          if (previous && (previous.transport.playbackEpoch !== transport.playbackEpoch ||
              previous.transport.playbackRevision !== transport.playbackRevision ||
              previous.transport.sourceAudioClock?.sessionId !== transport.sourceAudioClock?.sessionId)) {
            presentationVisualHistory = [];
            lastPresentationVisualSequence = -1;
            previous = null;
          }
          if (previous && previous.transport.captureSequence >= transport.captureSequence) return;
          presentationVisualHistory.push({ transport, master: { waveform: state.master.waveform, meters: state.master.meters,
            timeline: state.master.timeline }, tracks: state.tracks.map((track) => ({ waveform: track.waveform,
              meters: track.meters, timeline: track.timeline, lfoBindings: track.lfoBindings,
              manualKnobInteraction: track.manualKnobInteraction, lfoIndicators: track.lfoIndicators,
              lfoAssigns: track.lfoAssigns, paramDisplays: track.paramDisplays })),
            sampler: Array.isArray(state.sampler)
              ? state.sampler.map((pad) => ({ id: pad.id, active: pad.active, selected: pad.selected, repeat: pad.repeat }))
              : null });
          if (presentationVisualHistory.length > 256) {
            presentationVisualHistory.splice(0, presentationVisualHistory.length - 256);
          }
          presentationClockLookupGeneration += 1;
          presentationSourceTimeCache = null;
          presentationVisualStateCache = null;
        }

        function getPresentationVisualState(fallback, nowMs = getLfoVisualNow()) {
          recordPresentationLookupStat("presentationStateCalls");
          const presented = getPresentedSourceAudioTime(nowMs);
          const fallbackTransport = fallback?.transport;
          const fallbackKey = {
            nowMs,
            generation: presentationClockLookupGeneration,
            presentedAudioSec: presented?.audioSec ?? null,
            presentedSourceFrame: presented?.sourceFrame ?? null,
            captureSequence: fallbackTransport?.captureSequence ?? null,
            playbackEpoch: fallbackTransport?.playbackEpoch ?? null,
            playbackRevision: fallbackTransport?.playbackRevision ?? null,
            sessionId: fallbackTransport?.sourceAudioClock?.sessionId ?? null,
          };
          const cachedState = presentationVisualStateCache;
          if (cachedState && cachedState.nowMs === fallbackKey.nowMs &&
              cachedState.generation === fallbackKey.generation &&
              cachedState.captureSequence === fallbackKey.captureSequence &&
              cachedState.playbackEpoch === fallbackKey.playbackEpoch &&
              cachedState.playbackRevision === fallbackKey.playbackRevision &&
              cachedState.sessionId === fallbackKey.sessionId &&
              cachedState.presentedAudioSec === fallbackKey.presentedAudioSec &&
              cachedState.presentedSourceFrame === fallbackKey.presentedSourceFrame) {
            recordPresentationLookupStat("presentationStateCacheHits");
            return cachedState.state;
          }
          if (!presented) {
            presentationVisualStateCache = { ...fallbackKey, state: null };
            return null;
          }
          for (let i = presentationVisualHistory.length - 1; i >= 0; i--) {
            recordPresentationLookupStat("presentationHistoryEntriesScanned");
            const state = presentationVisualHistory[i];
            if (state.transport.playbackEpoch !== presented.playbackEpoch || state.transport.playbackRevision !== presented.playbackRevision) continue;
            if (state.transport.capturedAtAudioSec <= presented.audioSec) {
              presentationVisualStateCache = { ...fallbackKey, state };
              return state;
            }
          }
          presentationVisualStateCache = { ...fallbackKey, state: null };
          return null;
        }

        let lastQueuedPresentationVisualKey = null;
        let lastQueuedPresentationHasTimeline = false;
        function queuePresentationVisuals(state, nowMs = getLfoVisualNow(), force = false, revision = -1) {
          const presented = getPresentationVisualState(state, nowMs);
          if (!presented && (window._playbackMode === "native" || window._playbackMode === "pcm_fallback")) {
            if (state?.transport?.visualClockMode !== "idle_preview") return true;
            // Decoded-file geometry is static content, not a claim about
            // audible position. Paint it while CAF is prewarmed, but omit
            // live analyser/master surfaces and timelines until media mapping
            // can anchor those visuals to actual presentation.
            const staticTracks = (state.tracks || []).map((track) => {
              const waveform = track?.waveform;
              const isStaticFile = waveform && ["decoded_buffer", "streaming_cue"].includes(waveform.source);
              return isStaticFile ? { waveform, timeline: null } : null;
            });
            const staticVisual = { transport: state.transport, master: {}, tracks: staticTracks };
            const transport = state.transport;
            const key = Number.isSafeInteger(transport.captureSequence)
              ? `${transport.sourceAudioClock?.sessionId}:${transport.playbackEpoch}:${transport.playbackRevision}:${transport.captureSequence}:static`
              : null;
            if (key !== null && key === lastQueuedPresentationVisualKey) return lastQueuedPresentationHasTimeline;
            lastQueuedPresentationVisualKey = key;
            scheduleWaveformRender(staticVisual, force, revision);
            lastQueuedPresentationHasTimeline = false;
            return false;
          }
          const visual = presented || state;
          const t = visual?.transport;
          const key = Number.isSafeInteger(t?.captureSequence)
            ? `${t.sourceAudioClock?.sessionId}:${t.playbackEpoch}:${t.playbackRevision}:${t.captureSequence}:${presented
              ? `mapped:${presented.transport?.playbackEpoch}:${presented.transport?.playbackRevision}` : "unmapped"}` : null;
          if (key !== null && key === lastQueuedPresentationVisualKey) return lastQueuedPresentationHasTimeline;
          lastQueuedPresentationVisualKey = key;
          scheduleWaveformRender(visual, force, revision);
          lastQueuedPresentationHasTimeline = updateMirroredTimelineState(visual, nowMs);
          return lastQueuedPresentationHasTimeline;
        }

        function acceptPresentationSpans(message) {
          if (message.playbackEpoch !== lastPlaybackEpoch || message.playbackRevision !== lastPlaybackRevision) return false;
          const native = message.type === "NATIVE_PRESENTATION_SPANS";
          if (native && (message.attemptId !== nativeStartupAttemptId ||
              !Number.isSafeInteger(message.streamGeneration) || message.streamGeneration < nativePresentationGeneration)) return false;
          if (native && message.streamGeneration !== nativePresentationGeneration) {
            presentationSpans = [];
            nativePresentationGeneration = message.streamGeneration;
            nativePresentationClock = null;
          }
          if (!Number.isFinite(message.mediaRate) || message.mediaRate <= 0 || !Array.isArray(message.spans)) return false;
          for (const span of message.spans.slice(0, 32)) {
            const keys = ["sourceFrameStart", "sourceFrameEnd", "mediaFrameStart", "mediaFrameEnd"];
            if (!keys.every((key) => span[key] != null && Number.isSafeInteger(Number(span[key])) && Number(span[key]) >= 0) ||
                Number(span.sourceFrameEnd) <= Number(span.sourceFrameStart) || Number(span.mediaFrameEnd) <= Number(span.mediaFrameStart) ||
                !Number.isFinite(span.sourceRate) || span.sourceRate <= 0 || !/^\d+$/.test(span.sessionId || "")) continue;
            presentationSpans.push({ ...span, mediaRate: message.mediaRate,
              route: native ? "native" : "pcm_fallback", playbackEpoch: message.playbackEpoch,
              playbackRevision: message.playbackRevision });
          }
          if (presentationSpans.length > 2048) {
            presentationSpans.splice(0, presentationSpans.length - 2048);
          }
          presentationClockLookupGeneration += 1;
          presentationSourceTimeCache = null;
          presentationVisualStateCache = null;
          return true;
        }

        function sourceFrameToAudioTime(clock, sourceFrame) {
          if (!clock || !Number.isFinite(clock.sampleRate) || clock.sampleRate <= 0 || !Array.isArray(clock.segments)) return null;
          for (let i = Math.min(clock.segments.length, 128) - 1; i >= 0; i--) {
            recordPresentationLookupStat("sourceClockSegmentsScanned");
            const segment = clock.segments[i];
            if (!segment || ![segment.sourceFrameStart, segment.sourceFrameEnd, segment.audioFrameStart, segment.audioFrameEnd]
                .every((value) => Number.isSafeInteger(value) && value >= 0)) continue;
            if (segment.sourceFrameEnd - segment.sourceFrameStart !== segment.audioFrameEnd - segment.audioFrameStart) continue;
            if (sourceFrame >= segment.sourceFrameStart && sourceFrame <= segment.sourceFrameEnd) {
              return (segment.audioFrameStart + sourceFrame - segment.sourceFrameStart) / clock.sampleRate;
            }
          }
          return null;
        }

        function getPresentedSourceAudioTime(nowMs = getLfoVisualNow()) {
          const route = window._playbackMode;
          const sourceClock = lastMirroredState?.transport?.sourceAudioClock;
          const nativeAudio = route === "native"
            ? document.getElementById("native-stream-audio") || document.getElementById("cast-media-element")
            : null;
          const activeAudio = nativeAudio && !nativeAudio.paused && !nativeAudio.seeking && nativeAudio.readyState >= 3
            ? nativeAudio
            : route === "native"
              ? document.getElementById("cast-media-element")
              : null;
          const pcmAnchor = route === "pcm_fallback" ? pcmPresentationPosition : null;
          const lookupKey = {
            nowMs,
            route,
            playbackEpoch: lastPlaybackEpoch,
            playbackRevision: lastPlaybackRevision,
            generation: presentationClockLookupGeneration,
            nativeGeneration: nativePresentationGeneration,
            nativeAttempt: nativeStartupAttemptId,
            nativeActive: nativeStreamActive,
            nativePaused: nativeStreamPaused,
            mediaElement: activeAudio,
            mediaTime: Number.isFinite(activeAudio?.currentTime) ? activeAudio.currentTime : null,
            mediaPaused: activeAudio ? activeAudio.paused : null,
            mediaSeeking: activeAudio ? activeAudio.seeking : null,
            mediaReadyState: activeAudio ? activeAudio.readyState : null,
            sourceSessionId: sourceClock?.sessionId ?? null,
            sourceCaptureSequence: lastMirroredState?.transport?.captureSequence ?? null,
            pcmMediaFrame: pcmAnchor?.mediaFrame ?? null,
            pcmAudioTime: pcmAnchor?.audioTime ?? null,
            pcmPlaying: pcmAnchor?.playing ?? null,
            pcmPlaybackEpoch: pcmAnchor?.playbackEpoch ?? null,
            pcmPlaybackRevision: pcmAnchor?.playbackRevision ?? null,
            pcmSessionId: pcmAnchor?.sessionId ?? null,
            audioContextState: route === "pcm_fallback" ? audioCtx?.state ?? null : null,
            audioContextSampleRate: route === "pcm_fallback" ? audioCtx?.sampleRate ?? null : null,
            audioContextBaseLatency: route === "pcm_fallback" ? audioCtx?.baseLatency ?? null : null,
            audioContextOutputLatency: route === "pcm_fallback" ? audioCtx?.outputLatency ?? null : null,
            sourceClock,
          };
          recordPresentationLookupStat("sourceTimeCalls");
          if (samePresentationClockLookupKey(presentationSourceTimeCache?.key, lookupKey)) {
            recordPresentationLookupStat("sourceTimeCacheHits");
            return presentationSourceTimeCache.value;
          }
          recordPresentationLookupStat("sourceTimeResolutions");
          const cacheResult = (value) => {
            presentationSourceTimeCache = { key: lookupKey, value };
            return value;
          };
          const outputTimestamp = route === "pcm_fallback" ? audioCtx?.getOutputTimestamp?.() : null;
          let mediaFrame = null;
          let mediaEstimate = null;
          if (route === "native" && nativeStreamActive && !nativeStreamPaused) {
            if (activeAudio && !activeAudio.paused && !activeAudio.seeking && activeAudio.readyState >= 3 && Number.isFinite(activeAudio.currentTime)) {
              let span = null;
              for (let i = presentationSpans.length - 1; i >= 0; i--) {
                recordPresentationLookupStat("presentationSpanEntriesScanned");
                const item = presentationSpans[i];
                if (item.route === "native" && item.playbackEpoch === lastPlaybackEpoch && item.playbackRevision === lastPlaybackRevision) {
                  span = item;
                  break;
                }
              }
              if (span) {
                const identity = `${nativeStartupAttemptId}:${nativePresentationGeneration}:${lastPlaybackEpoch}:${lastPlaybackRevision}:${sourceClock?.sessionId}:${span.mediaRate}`;
                mediaEstimate = projectNativePresentationClock(activeAudio, identity, nowMs);
                if (mediaEstimate) mediaFrame = mediaEstimate.mediaSec * span.mediaRate;
              }
            } else {
              nativePresentationClock = null;
            }
          } else if (route === "pcm_fallback" && pcmPresentationPosition && audioCtx?.state === "running") {
            const anchor = pcmPresentationPosition;
            const audible = outputTimestamp && outputTimestamp.contextTime > 0 && outputTimestamp.performanceTime > 0
              ? outputTimestamp.contextTime + (nowMs - outputTimestamp.performanceTime) / 1000
              : audioCtx.currentTime - (audioCtx.baseLatency || 0) - (audioCtx.outputLatency || 0);
            const elapsed = audible - anchor.audioTime;
            if (elapsed >= -0.25 && elapsed <= 0.25 && anchor.playing &&
                anchor.playbackEpoch === lastPlaybackEpoch && anchor.playbackRevision === lastPlaybackRevision &&
                anchor.sessionId === sourceClock?.sessionId) mediaFrame = anchor.mediaFrame + elapsed * audioCtx.sampleRate;
          }
          if (mediaFrame === null) {
            if (route !== "native" || nativeStreamPaused || !nativeStreamActive) nativePresentationClock = null;
            return cacheResult(null);
          }
          for (let i = presentationSpans.length - 1; i >= 0; i--) {
            recordPresentationLookupStat("presentationSpanEntriesScanned");
            const span = presentationSpans[i];
            if (span.route !== route || span.playbackEpoch !== lastPlaybackEpoch || span.playbackRevision !== lastPlaybackRevision ||
                span.sessionId !== sourceClock?.sessionId || mediaFrame < Number(span.mediaFrameStart) || mediaFrame > Number(span.mediaFrameEnd)) continue;
            const ratio = (mediaFrame - Number(span.mediaFrameStart)) / (Number(span.mediaFrameEnd) - Number(span.mediaFrameStart));
            const sourceFrame = Number(span.sourceFrameStart) + ratio * (Number(span.sourceFrameEnd) - Number(span.sourceFrameStart));
            const audioSec = sourceFrameToAudioTime(sourceClock, sourceFrame);
            if (audioSec === null) return cacheResult(null);
            return cacheResult({ audioSec, sourceFrame, route, uncertaintyMs: (Number(span.uncertaintyFrames) || 0) * 1000 / span.sourceRate,
              uncertaintyBasis: "source_frame_mapping_only", acousticOffsetMs: null, mediaClockResolutionMs: null,
              ...mediaEstimate,
              playbackEpoch: lastPlaybackEpoch, playbackRevision: lastPlaybackRevision });
          }
          if (route === "native") nativePresentationClock = null;
          return cacheResult(null);
        }

        function sampleLfoTimeline(model, audioSec) {
          const segmentAt = (segments) => {
            if (!Array.isArray(segments)) return null;
            for (let i = segments.length - 1; i >= 0; i--) {
              const segment = segments[i];
              if (Array.isArray(segment) && segment.every(Number.isFinite) && segment[0] <= audioSec) return segment;
            }
            return null;
          };
          const rate = segmentAt(model.rateTimeline);
          if (!rate || rate.length < 5 || rate[2] <= 0 || rate[3] <= 0 || rate[4] < 0) return null;
          const elapsed = Math.max(0, audioSec - rate[0]);
          const ramp = Math.min(elapsed, rate[4]);
          const cycles = rate[4] > 0
            ? rate[2] * ramp + (rate[3] - rate[2]) * ramp * ramp / (2 * rate[4]) + rate[3] * (elapsed - ramp)
            : rate[3] * elapsed;
          const gate = segmentAt(model.gateTimeline);
          const gateValue = gate && gate.length >= 4 ? gate[1] + (gate[2] - gate[1]) *
            (gate[3] > 0 ? Math.min(1, Math.max(0, audioSec - gate[0]) / gate[3]) : 1) : 0;
          return { phase: normalizeLfoPhase(rate[1] + LFO_VISUAL_TWO_PI * cycles),
            gateValue: Math.max(0, Math.min(1, gateValue)), active: Boolean(gate && gate[2] > 0) };
        }

        function normalizeLfoPhase(value) {
          if (value == null) return null;
          const phase = Number(value);
          if (!Number.isFinite(phase)) return null;
          return ((phase % LFO_VISUAL_TWO_PI) + LFO_VISUAL_TWO_PI) % LFO_VISUAL_TWO_PI;
        }

        function shortestLfoPhaseDelta(from, to) {
          let delta = to - from;
          while (delta > Math.PI) delta -= LFO_VISUAL_TWO_PI;
          while (delta < -Math.PI) delta += LFO_VISUAL_TWO_PI;
          return delta;
        }

        function getLfoVisualNow() {
          return typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : Date.now();
        }

        function estimateGuiClockMapping(samples) {
          const valid = (Array.isArray(samples) ? samples : [])
            .filter((sample) => sample?.receiverMidMs != null && sample?.senderMidMs != null && sample?.rttMs != null &&
              Number.isFinite(Number(sample.receiverMidMs)) &&
              Number.isFinite(Number(sample?.senderMidMs)) &&
              Number.isFinite(Number(sample?.rttMs)) && Number(sample.rttMs) >= 0)
            .sort((a, b) => Number(a.rttMs) - Number(b.rttMs));
          if (!valid.length) return null;
          const bestRttMs = Number(valid[0].rttMs);
          const fitSamples = valid
            .filter((sample) => Number(sample.rttMs) <= bestRttMs + Math.max(10, bestRttMs * 0.5))
            .slice(0, 6);
          const receiverReferenceMs = fitSamples.reduce(
            (sum, sample) => sum + Number(sample.receiverMidMs), 0,
          ) / fitSamples.length;
          const senderReferenceMs = fitSamples.reduce(
            (sum, sample) => sum + Number(sample.senderMidMs), 0,
          ) / fitSamples.length;
          let slope = 1;
          if (fitSamples.length >= 3) {
            let numerator = 0;
            let denominator = 0;
            fitSamples.forEach((sample) => {
              const receiverDelta = Number(sample.receiverMidMs) - receiverReferenceMs;
              const senderDelta = Number(sample.senderMidMs) - senderReferenceMs;
              numerator += receiverDelta * senderDelta;
              denominator += receiverDelta * receiverDelta;
            });
            if (denominator > 0) slope = numerator / denominator;
          }
          if (!Number.isFinite(slope) || Math.abs(slope - 1) > 0.001) slope = 1;
          return {
            slope,
            receiverReferenceMs,
            senderReferenceMs,
            driftPpm: (slope - 1) * 1_000_000,
            bestRttMs,
            uncertaintyMs: bestRttMs / 2,
            sampleCount: fitSamples.length,
            lastSampleReceiverMs: Math.max(...valid.map((sample) => Number(sample.receiverMidMs))),
          };
        }

        function mapReceiverToSenderMonotonic(receiverMonotonicMs, mapping = guiClockSyncEstimate) {
          const receiverMs = Number(receiverMonotonicMs);
          if (!mapping || !Number.isFinite(receiverMs)) return null;
          const lastSampleMs = Number(mapping.lastSampleReceiverMs ?? mapping.receiverReferenceMs);
          if (!Number.isFinite(lastSampleMs) || receiverMs - lastSampleMs > 10_000) return null;
          return Number(mapping.senderReferenceMs) +
            Number(mapping.slope || 1) * (receiverMs - Number(mapping.receiverReferenceMs));
        }

        function resetGuiClockSync(reason) {
          pendingGuiClockSyncProbes.clear();
          guiClockSyncSamples = [];
          guiClockSyncEstimate = null;
          lastLfoVisualTelemetryAtMs = 0;
          if (reason) {
            emitGuiChannelTelemetry("clock_sync_reset", { reason });
          }
        }

        function sendGuiClockSyncProbe() {
          if (
            !guiControlWS || guiControlWS.readyState !== WebSocket.OPEN ||
            !window._handshakeAcked || !receiverBridgeConfigReady ||
            typeof guiSessionNonce !== "string" || guiSessionNonce.length < 8
          ) return false;
          const receiverMonotonicSentAtMs = getLfoVisualNow();
          const probeId = `${playbackModeSocketGeneration}:${++guiClockSyncSequence}`;
          pendingGuiClockSyncProbes.set(probeId, {
            receiverMonotonicSentAtMs,
            playbackEpoch: lastPlaybackEpoch,
            playbackRevision: lastPlaybackRevision,
          });
          while (pendingGuiClockSyncProbes.size > 8) {
            pendingGuiClockSyncProbes.delete(pendingGuiClockSyncProbes.keys().next().value);
          }
          const accepted = sendReceiverBridgeMessage({
            type: "GUI_CLOCK_SYNC_PING",
            transport: "gui",
            guiProtocolVersion: CAST_GUI_PROTOCOL_VERSION,
            guiSessionNonce,
            probeId,
            receiverMonotonicSentAtMs,
            playbackEpoch: lastPlaybackEpoch,
            playbackRevision: lastPlaybackRevision,
          }, "gui");
          if (!accepted) pendingGuiClockSyncProbes.delete(probeId);
          return accepted;
        }

        function startGuiClockSync() {
          if (guiClockSyncInterval) clearInterval(guiClockSyncInterval);
          guiClockSyncInterval = null;
          sendGuiClockSyncProbe();
          guiClockSyncInterval = setInterval(sendGuiClockSyncProbe, GUI_CLOCK_SYNC_INTERVAL_MS);
        }

        function stopGuiClockSync() {
          if (guiClockSyncInterval) clearInterval(guiClockSyncInterval);
          guiClockSyncInterval = null;
          pendingGuiClockSyncProbes.clear();
        }

        function acceptGuiClockSyncPong(message) {
          const probeId = String(message?.probeId || "");
          const pending = pendingGuiClockSyncProbes.get(probeId);
          if (!pending) return false;
          pendingGuiClockSyncProbes.delete(probeId);
          const receiverMonotonicSentAtMs = Number(pending.receiverMonotonicSentAtMs);
          const senderMonotonicReceivedAtMs = Number(message.senderMonotonicReceivedAtMs);
          const senderMonotonicSentAtMs = Number(message.senderMonotonicSentAtMs);
          const receiverMonotonicReceivedAtMs = getLfoVisualNow();
          if (
            !Number.isFinite(receiverMonotonicSentAtMs) ||
            !Number.isFinite(senderMonotonicReceivedAtMs) ||
            !Number.isFinite(senderMonotonicSentAtMs) ||
            Math.abs(Number(message.receiverMonotonicSentAtMs) - receiverMonotonicSentAtMs) > 0.01 ||
            Number(message.playbackEpoch) !== Number(pending.playbackEpoch) ||
            Number(message.playbackRevision) !== Number(pending.playbackRevision) ||
            pending.playbackEpoch !== lastPlaybackEpoch ||
            pending.playbackRevision !== lastPlaybackRevision
          ) return false;
          const rttMs = (receiverMonotonicReceivedAtMs - receiverMonotonicSentAtMs) -
            (senderMonotonicSentAtMs - senderMonotonicReceivedAtMs);
          const maxRttMs = guiClockSyncSamples.length < 4 ? 400 : GUI_CLOCK_SYNC_MAX_RTT_MS;
          if (!Number.isFinite(rttMs) || rttMs < 0 || rttMs > maxRttMs) {
            emitGuiChannelTelemetry("clock_sync_rejected", {
              reason: "round_trip_out_of_bounds",
              rttMs: Number.isFinite(rttMs) ? rttMs : null,
              probeId,
            });
            return false;
          }
          guiClockSyncSamples.push({
            receiverMidMs: (receiverMonotonicSentAtMs + receiverMonotonicReceivedAtMs) / 2,
            senderMidMs: (senderMonotonicReceivedAtMs + senderMonotonicSentAtMs) / 2,
            rttMs,
          });
          guiClockSyncSamples = guiClockSyncSamples.slice(-8);
          guiClockSyncEstimate = estimateGuiClockMapping(guiClockSyncSamples);
          emitGuiChannelTelemetry("clock_sync_sample", {
            probeId,
            roundTripMs: Number(rttMs.toFixed(3)),
            offsetMs: Number((guiClockSyncEstimate.senderReferenceMs -
              guiClockSyncEstimate.receiverReferenceMs).toFixed(3)),
            driftPpm: Number(guiClockSyncEstimate.driftPpm.toFixed(2)),
            uncertaintyMs: Number(guiClockSyncEstimate.uncertaintyMs.toFixed(3)),
            sampleCount: guiClockSyncEstimate.sampleCount,
            playbackEpoch: lastPlaybackEpoch,
            playbackRevision: lastPlaybackRevision,
          });
          return true;
        }

        function mirroredCaptureAgeMs(transport, receiverMonotonicNowMs = getLfoVisualNow()) {
          if (transport?.captureTimestampClock !== "sender_performance_ms") return null;
          if (transport?.capturedAtMonotonicMs == null) return null;
          const capturedAtMonotonicMs = Number(transport.capturedAtMonotonicMs);
          if (!Number.isFinite(capturedAtMonotonicMs) || !guiClockSyncEstimate) return null;
          const estimatedSenderNowMs = mapReceiverToSenderMonotonic(receiverMonotonicNowMs);
          if (!Number.isFinite(estimatedSenderNowMs)) return null;
          const ageMs = estimatedSenderNowMs - capturedAtMonotonicMs;
          if (!Number.isFinite(ageMs) || ageMs < -50 || ageMs > 10_000) return null;
          return Math.max(0, ageMs);
        }

        function advanceSmoothLfoClock(clock, nowMs) {
          if (clock?.model) {
            const presented = getPresentedSourceAudioTime(nowMs);
            const mediaOwned = window._playbackMode === "native" || window._playbackMode === "pcm_fallback";
            const elapsed = clock.model.clockRunning === true ? Math.max(0, nowMs - clock.modelReceivedAtMs) / 1000 : 0;
            const previewAgeMs = nowMs - clock.modelReceivedAtMs;
            const previewAvailable = lastMirroredState?.transport?.visualClockMode === "idle_preview" &&
              previewAgeMs >= 0 && previewAgeMs <= 1500 && Number.isFinite(clock.model.sampledAtAudioSec);
            const audioSec = presented?.audioSec ?? (previewAvailable || !mediaOwned
              ? clock.model.sampledAtAudioSec + elapsed + clock.modelCaptureAgeSec
              : null);
            const sample = audioSec === null ? null : sampleLfoTimeline(clock.model, audioSec);
            clock.presentation = presented;
            clock.presentationAvailable = Boolean(sample && (presented || !mediaOwned));
            clock.previewAvailable = Boolean(!presented && previewAvailable && sample);
            if (sample) Object.assign(clock, sample, {
              sourceAudioSec: presented || !mediaOwned ? audioSec : null,
              correction: 0,
              lastFrameMs: nowMs,
            });
            return;
          }
          if (!clock || !clock.active || clock.phase === null) {
            if (clock) clock.lastFrameMs = nowMs;
            return;
          }
          if (!clock.lastFrameMs) {
            clock.lastFrameMs = nowMs;
            return;
          }
          const deltaSeconds = Math.max(0, (nowMs - clock.lastFrameMs) / 1000);
          clock.lastFrameMs = nowMs;
          clock.phase = normalizeLfoPhase(
            clock.phase + (LFO_VISUAL_TWO_PI * deltaSeconds) / Math.max(0.1, clock.period),
          );
          if (Math.abs(clock.correction) > 0.0001 && deltaSeconds > 0) {
            const correctionRatio = Math.min(
              1,
              (deltaSeconds * 1000) / LFO_VISUAL_PHASE_CORRECTION_MS,
            );
            const correctionStep = clock.correction * correctionRatio;
            clock.phase = normalizeLfoPhase(clock.phase + correctionStep);
            clock.correction -= correctionStep;
          }
        }

        function syncSmoothLfoClock(index, state, nowMs, captureAgeMs = null) {
          const clock = smoothLfoClocks[index];
          if (!clock) return;
          const sampledAtMs = state?.sampledAtMonotonicMs == null ? null : Number(state.sampledAtMonotonicMs);
          if (Number.isFinite(sampledAtMs) && Number.isFinite(clock.lastSampledAtMonotonicMs) &&
              sampledAtMs < clock.lastSampledAtMonotonicMs) return;
          if (Number.isFinite(sampledAtMs)) clock.lastSampledAtMonotonicMs = sampledAtMs;
          // Timeline models take the early return below, so waveform metadata
          // must be applied before selecting the clock source.
          clock.waveformType = state?.waveformType || state?.type || "sine";
          clock.dutyCycle = state?.dutyCycle != null && Number.isFinite(Number(state.dutyCycle))
            ? Math.max(0.001, Math.min(0.999, Number(state.dutyCycle))) : 0.5;
          if (Array.isArray(state?.rateTimeline) && Number.isFinite(state.sampledAtAudioSec)) {
            clock.model = { ...state, rateTimeline: state.rateTimeline.slice(-512), gateTimeline: state.gateTimeline?.slice(-128) || [] };
            clock.modelReceivedAtMs = nowMs;
            clock.modelCaptureAgeSec = Math.max(0, captureAgeMs || 0) / 1000;
            advanceSmoothLfoClock(clock, nowMs);
            return;
          }
          clock.model = null;
          clock.presentationAvailable = false;
          clock.previewAvailable = false;
          advanceSmoothLfoClock(clock, nowMs);
          const wasActive = clock.active;
          const nextActive = Boolean(state?.active);
          const nextPeriod = Number(state?.time);
          if (Number.isFinite(nextPeriod) && nextPeriod > 0) {
            clock.period = Math.max(0.1, Math.min(60, nextPeriod));
          }
          let sampledPhase = normalizeLfoPhase(state?.phase);
          if (sampledPhase !== null && captureAgeMs !== null && Number.isFinite(captureAgeMs)) {
            sampledPhase = normalizeLfoPhase(
              sampledPhase + (LFO_VISUAL_TWO_PI * Math.max(0, captureAgeMs)) /
                (clock.period * 1000),
            );
          }
          clock.active = nextActive;
          clock.gateValue = nextActive ? 1 : 0;
          if (!nextActive) {
            clock.correction = 0;
            if (sampledPhase !== null) clock.phase = sampledPhase;
            clock.lastFrameMs = nowMs;
            return;
          }
          if (!wasActive || clock.phase === null) {
            clock.phase = sampledPhase;
            clock.correction = 0;
          } else if (sampledPhase !== null) {
            clock.correction = shortestLfoPhaseDelta(clock.phase, sampledPhase);
          }
          clock.lastFrameMs = nowMs;
        }

        function canRenderSmoothLfo(index) {
          const clock = smoothLfoClocks[index];
          const mediaOwned = window._playbackMode === "native" || window._playbackMode === "pcm_fallback";
          return Boolean(clock && clock.phase !== null && (clock.active || clock.model) &&
            (!clock.model || !mediaOwned || clock.presentationAvailable || clock.previewAvailable));
        }

        function getTrackLfoVisualBinding(track, parameter) {
          if (!track || !parameter) return null;
          if (track.lfoBindings && Object.prototype.hasOwnProperty.call(track.lfoBindings, parameter)) {
            const binding = track.lfoBindings[parameter];
            return binding && [1, 2].includes(binding.index) ? { ...binding, authoritative: true } : null;
          }
          const indicator = track.lfoIndicators?.[parameter];
          for (const index of [1, 2]) {
            const visual = indicator?.[`lfo${index}`];
            const assigned = Boolean(
              visual && typeof visual === "object"
                ? visual.checked
                : visual ?? track.lfoAssigns?.[index]?.includes?.(parameter),
            );
            if (!assigned) continue;
            return {
              index,
              reversed: Boolean(visual && typeof visual === "object" && visual.reversed),
              minMarker: indicator?.minMarker,
              maxMarker: indicator?.maxMarker,
            };
          }
          return null;
        }

        function getCachedLfoVisualBindings(visualState) {
          if (visualState === cachedLfoVisualState) return cachedLfoVisualBindings;
          cachedLfoVisualState = visualState;
          cachedLfoVisualBindings = [];
          (visualState?.tracks || []).forEach((track, trackIndex) => {
            KNOB_CONFIGS.forEach((config) => {
              const binding = getTrackLfoVisualBinding(track, config.p);
              if (!binding) return;
              cachedLfoVisualBindings.push({
                track,
                trackIndex,
                config,
                binding,
                sliderId: `t-${config.p}-sl-${trackIndex}`,
                labelId: `t-${config.p}-val-${trackIndex}`,
              });
            });
          });
          return cachedLfoVisualBindings;
        }

        function samplePresentedControlValue(binding, trackIndex, parameter, audioSec) {
          if (binding?.controlClockMode !== "media_element_control_rate") return null;
          const latest = lastMirroredState?.tracks?.[trackIndex]?.lfoBindings?.[parameter];
          const timeline = latest?.connectedAtAudioSec === binding.connectedAtAudioSec && latest?.index === binding.index
            ? latest.controlTimeline : binding.controlTimeline;
          if (!Array.isArray(timeline) || !Number.isFinite(audioSec)) return null;
          for (let i = Math.min(512, timeline.length) - 1; i >= 0; i--) {
            const point = timeline[i];
            if (Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]) && point[0] <= audioSec) return point[1];
          }
          return null;
        }

        function renderMirroredTrackLfoAssignments(track, trackIndex) {
          cachedLfoVisualState = null;
          cachedLfoVisualBindings = [];
          KNOB_CONFIGS.forEach((config) => {
            const indicator = track?.lfoIndicators?.[config.p];
            [1, 2].forEach((lfoIndex) => {
              const checkbox = getEl(`t-lfo${lfoIndex}-chk-${trackIndex}-${config.p}`);
              if (!checkbox) return;
              const visual = indicator?.[`lfo${lfoIndex}`];
              const assigned = visual && typeof visual === "object"
                ? visual.checked === true
                : Boolean(visual ?? track?.lfoAssigns?.[lfoIndex]?.includes?.(config.p));
              if (checkbox.checked !== assigned) checkbox.checked = assigned;
              checkbox.classList.toggle(
                "reversed",
                Boolean(visual && typeof visual === "object" && visual.reversed),
              );
            });
            [
              ["min", indicator?.minMarker],
              ["max", indicator?.maxMarker],
            ].forEach(([kind, markerState]) => {
              const marker = getEl(`t-${kind}-marker-${trackIndex}-${config.p}`);
              if (!marker) return;
              marker.classList.toggle("active", Boolean(markerState?.active));
              const left = `${Math.max(0, Math.min(100, Number(markerState?.left) || 0))}%`;
              if (marker.style.left !== left) marker.style.left = left;
            });
          });
        }

        function markerValueFromPercent(marker, minimum, maximum, fallback) {
          if (!marker?.active) return fallback;
          const left = Number(marker.left);
          if (!Number.isFinite(left)) return fallback;
          return minimum + (Math.max(0, Math.min(100, left)) / 100) * (maximum - minimum);
        }

        function scheduleSmoothLfoRender() {
          if (smoothLfoFrameHandle !== null) return;
          if (typeof window.requestAnimationFrame === "function") {
            smoothLfoFrameUsesTimeout = false;
            smoothLfoFrameHandle = window.requestAnimationFrame(renderSmoothLfoFrame);
          } else {
            smoothLfoFrameUsesTimeout = true;
            smoothLfoFrameHandle = window.setTimeout(
              () => renderSmoothLfoFrame(getLfoVisualNow()),
              LFO_VISUAL_FRAME_INTERVAL_MS,
            );
          }
        }

        function resetSmoothLfoVisuals() {
          lastSubmittedLfoProof = null;
          lastLfoTelemetryReportAtMs = 0;
          cachedLfoVisualState = null;
          cachedLfoVisualBindings = [];
          lfoFrameMeasurements.lastAt = null;
          lfoFrameMeasurements.lastSource = null;
          takeLfoFrameMeasurements();
          if (smoothLfoFrameHandle !== null) {
            if (smoothLfoFrameUsesTimeout) window.clearTimeout(smoothLfoFrameHandle);
            else if (typeof window.cancelAnimationFrame === "function") {
              window.cancelAnimationFrame(smoothLfoFrameHandle);
            }
          }
          smoothLfoFrameHandle = null;
          lastSmoothLfoPaintMs = 0;
          [1, 2].forEach((index) => {
            Object.assign(smoothLfoClocks[index], {
              active: false,
              phase: null,
              correction: 0,
              period: 1.8,
              waveformType: "sine",
              dutyCycle: 0.5,
              gateValue: 0,
              lastFrameMs: 0,
              lastSampledAtMonotonicMs: null,
              model: null,
              presentationAvailable: false,
              previewAvailable: false,
            });
          });
        }

        function renderSmoothLfoFrame(frameTime) {
          smoothLfoFrameHandle = null;
          const frameWorkStartedAt = typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : Date.now();
          const nowMs = Number.isFinite(Number(frameTime))
            ? Number(frameTime)
            : getLfoVisualNow();
          [1, 2].forEach((index) => advanceSmoothLfoClock(smoothLfoClocks[index], nowMs));
          const hasActiveClock = canRenderSmoothLfo(1) || canRenderSmoothLfo(2);
          if (!hasActiveClock) {
            if ([1, 2].some((index) => smoothLfoClocks[index].model?.rateTimeline?.length)) scheduleSmoothLfoRender();
            return;
          }
          if (nowMs - lastSmoothLfoPaintMs >= LFO_VISUAL_FRAME_INTERVAL_MS - 1) {
            lastSmoothLfoPaintMs = nowMs;
            recordLfoFrameMeasurement(nowMs);
            [1, 2].forEach((index) => {
              if (!canRenderSmoothLfo(index)) return;
              const signedValue = computeReceiverLfoWaveformValue(smoothLfoClocks[index].phase, smoothLfoClocks[index].waveformType, smoothLfoClocks[index].dutyCycle) * (smoothLfoClocks[index].gateValue ?? 1);
              updateStyleWidth(
                index === 1 ? "lfo-meter-bar" : "lfo2-meter-bar",
                `${Math.abs(signedValue) * 100}%`,
              );
              const canvas = getEl(index === 1 ? "lfo-waveform-1" : "lfo-waveform-2");
              if (canvas) {
                drawReceiverLfoWaveform(canvas, index, smoothLfoClocks[index]);
              }
            });
            const presentedVisual = getPresentationVisualState(lastMirroredState, nowMs);
            if (presentedVisual && presentedVisual.transport.captureSequence !== lastPresentationVisualSequence) {
              lastPresentationVisualSequence = presentedVisual.transport.captureSequence;
              queuePresentationVisuals(lastMirroredState, nowMs);
            }
            getCachedLfoVisualBindings(presentedVisual || lastMirroredState).forEach((entry) => {
              const { track, trackIndex, config, binding, sliderId, labelId } = entry;
              if (!canRenderSmoothLfo(binding.index)) return;
              if (binding.manualOwned || track.manualKnobInteraction?.[config.p]) return;
              const slider = getEl(sliderId);
              if (!slider || slider.dataset.castInteractionState === "pending") return;
              const minimum = Number.isFinite(Number(slider.min)) ? Number(slider.min) : config.min;
              const maximum = Number.isFinite(Number(slider.max)) ? Number(slider.max) : config.max;
              const rangeMinimum = binding.authoritative ? binding.min : markerValueFromPercent(
                binding.minMarker,
                minimum,
                maximum,
                minimum,
              );
              const rangeMaximum = binding.authoritative ? binding.max : markerValueFromPercent(
                binding.maxMarker,
                minimum,
                maximum,
                maximum,
              );
              let signedValue = smoothLfoClocks[binding.index].waveformType === "sine"
                ? Math.sin(smoothLfoClocks[binding.index].phase)
                : computeReceiverLfoWaveformValue(smoothLfoClocks[binding.index].phase, smoothLfoClocks[binding.index].waveformType, smoothLfoClocks[binding.index].dutyCycle);
              if (binding.reversed) signedValue = -signedValue;
              const modulated =
                ((signedValue + 1) / 2) * (rangeMaximum - rangeMinimum) + rangeMinimum;
              const gate = smoothLfoClocks[binding.index].gateValue ?? 1;
              const currentBinding = track.lfoBindings?.[config.p];
              const controlClockMode = currentBinding?.index === binding.index
                ? currentBinding.controlClockMode
                : binding.controlClockMode;
              const sampleBinding = currentBinding?.index === binding.index ? currentBinding : binding;
              const controlValue = samplePresentedControlValue(sampleBinding, trackIndex, config.p, smoothLfoClocks[binding.index].sourceAudioSec);
              if (controlClockMode === "media_element_control_rate" && controlValue === null) return;
              const scaled = controlValue ?? (binding.authoritative ? binding.baseValue + gate * (modulated - binding.baseValue) : modulated);
              updateValue(sliderId, scaled);
              updateText(
                labelId,
                formatMirroredParameterDisplay(
                  track.paramDisplays?.[config.p],
                  Number(slider.value),
                ),
              );
            });
            recordLfoFrameWork(frameWorkStartedAt);
            if (!lastSubmittedLfoProof || nowMs - lastLfoVisualTelemetryAtMs >= GUI_LFO_RENDER_TELEMETRY_INTERVAL_MS) {
              const samples = summarizeLfoVisualSamples(lastMirroredState, nowMs);
              lastLfoVisualTelemetryAtMs = nowMs;
              lfoVisualFrameSequence += 1;
              lastSubmittedLfoProof = { samples, sampledAtMs: Date.now(), receiverMonotonicMs: nowMs,
                frameSequence: lfoVisualFrameSequence, transport: lastMirroredState?.transport || {} };
              if (samples.some((sample) => sample.masterActive || sample.clockActive) &&
                  (!lastLfoTelemetryReportAtMs || nowMs - lastLfoTelemetryReportAtMs >= GUI_LFO_TELEMETRY_REPORT_INTERVAL_MS)) {
                lastLfoTelemetryReportAtMs = nowMs;
                const transport = lastMirroredState?.transport || {};
                const captureAgeMs = mirroredCaptureAgeMs(transport, nowMs);
                sendGuiChannelTelemetry("lfo_visual_frame", {
                  lfoVisualFrameSequence,
                  evidenceStage: "animation_frame_dom_submitted",
                  assignedControlCoverage: samples.length,
                  coverageTruncated: false,
                  receiverRenderMonotonicMs: Number(nowMs.toFixed(3)),
                  timelineCaptureSequence: Number.isSafeInteger(Number(transport.captureSequence))
                    ? Number(transport.captureSequence)
                    : null,
                  playbackEpoch: Number.isSafeInteger(Number(transport.playbackEpoch))
                    ? Number(transport.playbackEpoch)
                    : null,
                  playbackRevision: Number.isSafeInteger(Number(transport.playbackRevision))
                    ? Number(transport.playbackRevision)
                    : null,
                  senderCaptureMonotonicMs: Number.isFinite(Number(transport.capturedAtMonotonicMs))
                    ? Number(transport.capturedAtMonotonicMs)
                    : null,
                  captureAgeMs: captureAgeMs === null ? null : Number(captureAgeMs.toFixed(3)),
                  clockSync: guiClockSyncEstimate
                    ? {
                        sampleCount: guiClockSyncEstimate.sampleCount,
                        bestRttMs: Number(guiClockSyncEstimate.bestRttMs.toFixed(3)),
                        uncertaintyMs: Number(guiClockSyncEstimate.uncertaintyMs.toFixed(3)),
                        driftPpm: Number(guiClockSyncEstimate.driftPpm.toFixed(2)),
                      }
                    : null,
                  frameStats: takeLfoFrameMeasurements(),
                  presentation: getPresentedSourceAudioTime(nowMs),
                  ...packLfoVisualEvidence(samples),
                });
              }
            }
          }
          scheduleSmoothLfoRender();
        }

        function syncSmoothLfoVisuals(master, transport = null) {
          const epoch = transport?.playbackEpoch;
          const revision = transport?.playbackRevision;
          if (Number.isSafeInteger(epoch) && Number.isSafeInteger(revision) &&
              typeof lastPlaybackEpoch === "number" && typeof lastPlaybackRevision === "number" &&
              lastPlaybackEpoch >= 0 && lastPlaybackRevision >= 0 &&
              (epoch !== lastPlaybackEpoch || revision !== lastPlaybackRevision)) return;
          const nowMs = getLfoVisualNow();
          const captureAgeMs = mirroredCaptureAgeMs(transport, nowMs);
          [1, 2].forEach((index) => {
            const state = master?.[`lfo${index}`];
            const sampleAgeMs = state?.sampledAtMonotonicMs == null
              ? captureAgeMs
              : mirroredCaptureAgeMs({
                  captureTimestampClock: "sender_performance_ms",
                  capturedAtMonotonicMs: state.sampledAtMonotonicMs,
                }, nowMs);
            syncSmoothLfoClock(index, state, nowMs, sampleAgeMs);
          });
          if (canRenderSmoothLfo(1) || canRenderSmoothLfo(2) ||
              [1, 2].some((index) => smoothLfoClocks[index].model?.rateTimeline?.length)) {
            scheduleSmoothLfoRender();
          }
        }

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
          // Live GUI patches are merged immediately before the render gate.
          // A JSON deep clone here copied every dialog control and waveform on
          // every meter tick, turning latest-value traffic into a long main
          // thread task. Merge code below replaces each touched nested object;
          // shallow-copy the containers that immediate-playback and patch
          // paths mutate, while leaving immutable baseline data shared.
          const copy = { ...state };
          if (state.master && typeof state.master === "object") {
            copy.master = { ...state.master };
          }
          if (Array.isArray(state.tracks)) {
            copy.tracks = state.tracks.map((track) =>
              track && typeof track === "object" ? { ...track } : track,
            );
          }
          if (Array.isArray(state.sampler)) {
            copy.sampler = state.sampler.map((pad) =>
              pad && typeof pad === "object" ? { ...pad } : pad,
            );
          }
          if (Array.isArray(state.dialogs)) {
            copy.dialogs = state.dialogs.map((dialog) =>
              dialog && typeof dialog === "object" ? { ...dialog } : dialog,
            );
          }
          return copy;
        }

        function mergeGuiLivePatch(patch, baseState = lastMirroredState) {
          if (
            !baseState ||
            !patch ||
            typeof patch !== "object"
          ) {
            return null;
          }
          const nextState = cloneMirroredState(baseState);
          if (!nextState) return null;
          if (Number.isInteger(Number(patch.trackCount)) && Number(patch.trackCount) > 0) {
            nextState.trackCount = Number(patch.trackCount);
          }
          if (
            Number.isInteger(Number(patch.waveformSurfaceCount)) &&
            Number(patch.waveformSurfaceCount) > 0
          ) {
            nextState.waveformSurfaceCount = Number(patch.waveformSurfaceCount);
          }

          if (patch.transport && typeof patch.transport === "object") {
            nextState.transport = {
              ...(nextState.transport || {}),
              ...patch.transport,
            };
          }
          if (patch.master && typeof patch.master === "object") {
            const previousMaster = nextState.master || {};
            nextState.master = {
              ...previousMaster,
              ...patch.master,
              meters: {
                ...(previousMaster.meters || {}),
                ...(patch.master.meters || {}),
              },
              buttons: {
                ...(previousMaster.buttons || {}),
                ...(patch.master.buttons || {}),
              },
              lfo1: {
                ...(previousMaster.lfo1 || {}),
                ...(patch.master.lfo1 || {}),
              },
              lfo2: {
                ...(previousMaster.lfo2 || {}),
                ...(patch.master.lfo2 || {}),
              },
            };
          }
          if (patch.qa && typeof patch.qa === "object") {
            const qaRevision = Number(patch.qa.revision);
            nextState.qa = {
              ...(nextState.qa || {}),
              visible: Boolean(patch.qa.visible),
              text: String(patch.qa.text || "").slice(0, 4000),
              revision: Number.isSafeInteger(qaRevision) && qaRevision >= 0
                ? qaRevision
                : Number(nextState.qa?.revision) || 0,
            };
          }
          if (Array.isArray(patch.tracks) && Array.isArray(nextState.tracks)) {
            const trackPatchByIndex = new Map();
            const trackPatchById = new Map();
            for (let i = 0; i < patch.tracks.length; i++) {
              const candidate = patch.tracks[i];
              if (!candidate || typeof candidate !== "object") continue;
              if (Number.isInteger(Number(candidate.index))) {
                trackPatchByIndex.set(Number(candidate.index), candidate);
              }
              if (candidate.trackId != null) {
                trackPatchById.set(String(candidate.trackId), candidate);
              }
            }
            nextState.tracks = nextState.tracks.map((previousTrack, index) => {
              const trackPatch = trackPatchByIndex.get(index) ||
                (previousTrack?.trackId != null ? trackPatchById.get(String(previousTrack.trackId)) : null);
              if (!trackPatch) return previousTrack;
              return {
                ...previousTrack,
                ...trackPatch,
                meters: {
                  ...(previousTrack?.meters || {}),
                  ...(trackPatch.meters || {}),
                },
                waveform: {
                  ...(previousTrack?.waveform || {}),
                  ...(trackPatch.waveform || {}),
                },
                buttons: {
                  ...(previousTrack?.buttons || {}),
                  ...(trackPatch.buttons || {}),
                },
                params: {
                  ...(previousTrack?.params || {}),
                  ...(trackPatch.params || {}),
                  ...(trackPatch.params?.volume != null && trackPatch.params?.vol == null
                    ? { vol: trackPatch.params.volume } : {}),
                },
                paramDisplays: {
                  ...(previousTrack?.paramDisplays || {}),
                  ...(trackPatch.paramDisplays || {}),
                },
                lfo: {
                  ...(previousTrack?.lfo || {}),
                  ...(trackPatch.lfo || {}),
                },
                lfoIndicators: {
                  ...(previousTrack?.lfoIndicators || {}),
                  ...(trackPatch.lfoIndicators || {}),
                },
                lfoBindings: trackPatch.lfoBindings ? {
                  ...(previousTrack?.lfoBindings || {}),
                  ...trackPatch.lfoBindings,
                } : previousTrack?.lfoBindings,
              };
            });
          }
          if (Array.isArray(patch.sampler) && Array.isArray(nextState.sampler)) {
            const padPatchById = new Map();
            const padPatchByIndex = new Map();
            for (let i = 0; i < patch.sampler.length; i++) {
              const candidate = patch.sampler[i];
              if (!candidate || typeof candidate !== "object") continue;
              if (candidate.id != null) {
                padPatchById.set(String(candidate.id), candidate);
              }
              if (Number.isInteger(Number(candidate.index))) {
                padPatchByIndex.set(Number(candidate.index), candidate);
              }
            }
            nextState.sampler = nextState.sampler.map((previousPad, index) => {
              const padPatch = (previousPad?.id != null ? padPatchById.get(String(previousPad.id)) : null) ||
                padPatchByIndex.get(index);
              return padPatch ? { ...previousPad, ...padPatch } : previousPad;
            });
          }
          if (patch.samplerMeta && typeof patch.samplerMeta === "object") {
            nextState.samplerMeta = {
              ...(nextState.samplerMeta || {}),
              ...patch.samplerMeta,
            };
          }
          if (Array.isArray(patch.dialogStates) && Array.isArray(nextState.dialogs)) {
            const mergeControl = (previousControl, controlPatch) => {
              if (!controlPatch) return previousControl;
              return {
                ...previousControl,
                ...controlPatch,
                displayDescriptor: controlPatch.displayDescriptor
                  ? {
                      ...(previousControl?.displayDescriptor || {}),
                      ...controlPatch.displayDescriptor,
                    }
                  : previousControl?.displayDescriptor,
                options: Array.isArray(controlPatch.options)
                  ? controlPatch.options.map((optionPatch, optionIndex) => ({
                      ...(previousControl?.options?.[optionIndex] || {}),
                      ...optionPatch,
                    }))
                  : previousControl?.options,
              };
            };
            const dialogPatchMap = new Map();
            for (let i = 0; i < patch.dialogStates.length; i++) {
              const candidate = patch.dialogStates[i];
              if (candidate && candidate.id) {
                dialogPatchMap.set(String(candidate.id), candidate);
              }
            }
            nextState.dialogs = nextState.dialogs.map((previousDialog) => {
              const dialogPatch = dialogPatchMap.get(String(previousDialog?.id || ""));
              if (!dialogPatch) return previousDialog;
              const controlPatchMap = new Map();
              if (Array.isArray(dialogPatch.controls)) {
                for (let i = 0; i < dialogPatch.controls.length; i++) {
                  const candidate = dialogPatch.controls[i];
                  const idx = Number(candidate?.controlIndex ?? i);
                  controlPatchMap.set(idx, candidate);
                }
              }
              const actionPatchMap = new Map();
              if (Array.isArray(dialogPatch.actions)) {
                for (let i = 0; i < dialogPatch.actions.length; i++) {
                  const candidate = dialogPatch.actions[i];
                  const idx = Number(candidate?.actionIndex ?? i);
                  actionPatchMap.set(idx, candidate);
                }
              }
              const controls = (previousDialog.controls || []).map((previousControl, index) => {
                const idx = Number(previousControl?.controlIndex ?? index);
                const controlPatch = controlPatchMap.get(idx);
                return mergeControl(previousControl, controlPatch);
              });
              const actions = (previousDialog.actions || []).map((previousAction, index) => {
                const idx = Number(previousAction?.actionIndex ?? index);
                const actionPatch = actionPatchMap.get(idx);
                return actionPatch ? { ...previousAction, ...actionPatch } : previousAction;
              });
              const effectSlotTabs = previousDialog.effectSlotTabs && dialogPatch.effectSlotTabs
                ? {
                    ...previousDialog.effectSlotTabs,
                    ...dialogPatch.effectSlotTabs,
                    items: (previousDialog.effectSlotTabs.items || []).map(
                      (previousItem, index) => {
                        const itemPatch = dialogPatch.effectSlotTabs.items?.[index];
                        if (!itemPatch) return previousItem;
                        return {
                          ...previousItem,
                          ...itemPatch,
                          control: mergeControl(previousItem?.control, itemPatch.control),
                        };
                      },
                    ),
                  }
                : previousDialog.effectSlotTabs;
              return {
                ...previousDialog,
                ...dialogPatch,
                geometry: {
                  ...(previousDialog.geometry || {}),
                  ...(dialogPatch.geometry || {}),
                },
                header: {
                  ...(previousDialog.header || {}),
                  ...(dialogPatch.header || {}),
                },
                controls,
                actions,
                effectSlotTabs,
                samplePadLayout: previousDialog.samplePadLayout || dialogPatch.samplePadLayout
                  ? {
                      ...(previousDialog.samplePadLayout || {}),
                      ...(dialogPatch.samplePadLayout || {}),
                    }
                  : null,
                samplePadDomManifest: previousDialog.samplePadDomManifest,
                dialogDomManifest: previousDialog.dialogDomManifest || previousDialog.samplePadDomManifest,
              };
            });
          }
          return nextState;
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

        function renderState(s, force = false, guiRevision = -1) {
          if (!s) return false;
          if (rememberEffectOptions(s.effectOptions, s.effectOptionsCatalogSignature) === null) {
            return false;
          }
          const phaseClock = () =>
            typeof performance !== "undefined" && typeof performance.now === "function"
              ? performance.now()
              : Date.now();
          const phaseStartedAt = phaseClock();
          const presentationLookupStats = {
            sourceTimeCalls: 0,
            sourceTimeResolutions: 0,
            sourceTimeCacheHits: 0,
            presentationStateCalls: 0,
            presentationStateCacheHits: 0,
            presentationSpanEntriesScanned: 0,
            sourceClockSegmentsScanned: 0,
            presentationHistoryEntriesScanned: 0,
          };
          activeRenderLookupStats = presentationLookupStats;
          const stateTrackCount = Math.max(
            1,
            Math.floor(Number(s.trackCount) || s.tracks?.length || mirroredTrackCount || 4),
          );
          if (stateTrackCount !== mirroredTrackCount) buildGUI(stateTrackCount);
          const buildFinishedAt = phaseClock();
          // Cursor updates are isolated from the full GUI render budget so
          // PCM playout can keep the TV pointer responsive while the regular
          // GUI render remains throttled. Ordering is guarded by cursor.revision.
          const cursorPhaseStartedAt = phaseClock();
          renderCursorState(s.cursor);
          const cursorPhaseFinishedAt = phaseClock();
          const now = Date.now();
          const renderThrottleMs =
            window._binaryActive || window._playbackMode === "pcm_fallback"
              ? PCM_RENDER_THROTTLE_MS
              : RENDER_THROTTLE_MS;
          // Waveform state is latest-value data. Queue it before the broader
          // DOM throttle so a burst of GUI snapshots cannot leave the canvas
          // one or more revisions behind while controls remain throttled.
          const waveformPhaseStartedAt = phaseClock();
          const hasMirroredTimeline = queuePresentationVisuals(s, phaseClock(), force, guiRevision);
          const waveformPhaseFinishedAt = phaseClock();
          const timelinePhaseStartedAt = phaseClock();

          const timelinePhaseFinishedAt = phaseClock();
          const preludeFinishedAt = phaseClock();
          const preludePhases = {
            cursorMs: Math.max(0, cursorPhaseFinishedAt - cursorPhaseStartedAt),
            waveformScheduleMs: Math.max(0, waveformPhaseFinishedAt - waveformPhaseStartedAt),
            timelineMs: Math.max(0, timelinePhaseFinishedAt - timelinePhaseStartedAt),
          };
          if (!force && now - lastRenderTime < renderThrottleMs) {
            pendingGuiRenderState = s;
            pendingGuiRenderRevision = guiRevision;
            if (pendingGuiRenderTimer === null) pendingGuiRenderTimer = setTimeout(() => {
              pendingGuiRenderTimer = null;
              const state = pendingGuiRenderState;
              const revision = pendingGuiRenderRevision;
              pendingGuiRenderState = null;
              if (state && renderState(state, true, revision) === true) {
                guiRenderedCount += 1;
                guiLastRenderedRevision = revision;
                sendGuiChannelTelemetry("applied", { revision, renderResult: "rendered_after_throttle" });
              }
            }, Math.max(1, renderThrottleMs - (now - lastRenderTime)));
            guiRenderThrottleSkips += 1;
            lastGuiRenderPhaseStats = {
              throttled: true,
              buildMs: Math.max(0, buildFinishedAt - phaseStartedAt),
              preludeMs: Math.max(0, preludeFinishedAt - buildFinishedAt),
              preludePhases,
              masterMs: 0,
              dialogsMs: 0,
              samplerMs: 0,
              tracksMs: 0,
              qaMs: 0,
              totalMs: Math.max(0, phaseClock() - phaseStartedAt),
              effectOptions: summarizeEffectOptionRendering(),
              presentationLookups: { ...presentationLookupStats },
            };
            activeRenderLookupStats = null;
            return "throttled";
          }
          lastRenderTime = now;
          if (pendingGuiRenderState && guiRevision >= pendingGuiRenderRevision) {
            clearTimeout(pendingGuiRenderTimer);
            pendingGuiRenderTimer = null;
            pendingGuiRenderState = null;
          }
          try {
            if (!hasMirroredTimeline && s.transport?.position) {
              updateText("recording-time-display", s.transport.position);
            }
            if (s.master) {
              syncSmoothLfoVisuals(s.master, s.transport);
              applyMirroredParameterDisplay(
                "master-volume",
                "master-volume-value",
                s.master.paramDisplays?.volume || {
                  parameterKey: "volume",
                  decimals: 1,
                  unit: "dB",
                  unitSpacing: " ",
                },
                s.master.volume ?? 0,
              );
              applyMirroredParameterDisplay(
                "loop-length",
                "loop-length-value",
                s.master.paramDisplays?.loopLength || {
                  parameterKey: "loopLength",
                  formatterKind: "loop_timecode_v1",
                },
                s.master.loopLength ?? 4,
              );
              if (!canRenderSmoothLfo(1)) {
                updateStyleWidth(
                  "lfo-meter-bar",
                  `${Math.max(0, Math.min(1, Math.abs(Number(s.master.lfo1?.value) || 0))) * 100}%`,
                );
              }
              const canvas1 = getEl("lfo-waveform-1");
              if (canvas1 && !canRenderSmoothLfo(1)) {
                const clock1 = smoothLfoClocks[1];
                const state1 = {
                  active: s.master.lfo1?.active === true,
                  phase: clock1.phase !== null ? clock1.phase : Number(s.master.lfo1?.phase) || 0,
                  waveformType: s.master.lfo1?.waveformType || clock1.waveformType || "sine",
                  dutyCycle: s.master.lfo1?.dutyCycle ?? clock1.dutyCycle ?? 0.5,
                  gateValue: s.master.lfo1?.gateValue ?? clock1.gateValue ?? 1,
                  paused: s.master.lfo1?.paused ?? clock1.paused ?? false,
                };
                drawReceiverLfoWaveform(canvas1, 1, state1);
              }
              applyMirroredParameterDisplay(
                "lfo-time",
                "lfo-time-value",
                s.master.paramDisplays?.lfo1Time || {
                  parameterKey: "lfo1Time",
                  decimals: 1,
                  unit: "s",
                },
                (s.master.lfo1 && s.master.lfo1.time) ?? 1.8,
              );
              if (!canRenderSmoothLfo(2)) {
                updateStyleWidth(
                  "lfo2-meter-bar",
                  `${Math.max(0, Math.min(1, Math.abs(Number(s.master.lfo2?.value) || 0))) * 100}%`,
                );
              }
              const canvas2 = getEl("lfo-waveform-2");
              if (canvas2 && !canRenderSmoothLfo(2)) {
                const clock2 = smoothLfoClocks[2];
                const state2 = {
                  active: s.master.lfo2?.active === true,
                  phase: clock2.phase !== null ? clock2.phase : Number(s.master.lfo2?.phase) || 0,
                  waveformType: s.master.lfo2?.waveformType || clock2.waveformType || "sine",
                  dutyCycle: s.master.lfo2?.dutyCycle ?? clock2.dutyCycle ?? 0.5,
                  gateValue: s.master.lfo2?.gateValue ?? clock2.gateValue ?? 1,
                  paused: s.master.lfo2?.paused ?? clock2.paused ?? false,
                };
                drawReceiverLfoWaveform(canvas2, 2, state2);
              }
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
              applyMirroredParameterDisplay(
                "lfo2-time",
                "lfo2-time-value",
                s.master.paramDisplays?.lfo2Time || {
                  parameterKey: "lfo2Time",
                  decimals: 1,
                  unit: "s",
                },
                (s.master.lfo2 && s.master.lfo2.time) ?? 1.8,
              );
            }
            const masterFinishedAt = phaseClock();
            studioDialogs?.registry(s.dialogRegistry);
            const registryFinishedAt = phaseClock();
            studioDialogs?.render(s.dialogs);
            const dialogsFinishedAt = phaseClock();
            if (s.sampler) {
                const presentedVisual = (window._playbackMode === "native" || window._playbackMode === "pcm_fallback")
                  ? (typeof getPresentationVisualState === "function" ? getPresentationVisualState(s) : null)
                  : null;
                const visualPads = presentedVisual?.sampler || null;
                const visualPadMap = visualPads ? new Map(visualPads.map((vp) => [Number(vp.id), vp])) : null;

                s.sampler.forEach((p, i) => {
                  if (i >= RECEIVER_SAMPLER_PAD_COUNT) return;
                  const numericPadId = Number(p?.id);
                  const padId = Number.isInteger(numericPadId) && numericPadId >= 1 && numericPadId <= RECEIVER_SAMPLER_PAD_COUNT
                    ? numericPadId
                    : i + 1;
                  const btnId = "sample-" + padId;
                  const padCacheKey = `sampler-pad:${padId}`;
                  const vPad = visualPadMap?.get(padId);
                  const isPadActive = vPad ? Boolean(vPad.active) : Boolean(p.active);
                  const padSignature = JSON.stringify([
                    p.id, p.loaded, isPadActive, p.repeat?.enabled, p.reverse, p.name,
                    p.selected, p.mode, p.muted, p.tune, p.baseBpm, p.effectiveBpm, p.syncAll, p.syncTrack, p.color
                  ]);
                  if (valCache[padCacheKey] === padSignature) return;
                  valCache[padCacheKey] = padSignature;
                  const cls = [
                    "sample-btn",
                    p.loaded ? "loaded" : "",
                    isPadActive ? "active" : "",
                    isPadActive && p.repeat?.enabled ? "repeating" : "",
                    p.reverse ? "reverse" : "",
                    p.muted ? "muted" : "",
                    p.stutter?.enabled ? "stuttering" : "",
                  ].filter(Boolean).join(" ");
                  updateClass(btnId, cls);
                  if (p.loaded && p.name) {
                    updateText(btnId, String(p.name || "").substring(0, 3).toUpperCase());
                  } else if (p.loaded) {
                    updateText(btnId, "SMP");
                  } else {
                    updateText(btnId, String(padId));
                  }
                  const pad = getEl(btnId);
                  if (pad) {
                    pad.dataset.padId = String(padId);
                    pad.dataset.padSelected = p.selected ? "true" : "false";
                    pad.dataset.padName = String(p.name || "");
                    pad.dataset.padMode = String(p.mode || "oneshot");
                    pad.dataset.padLoaded = p.loaded ? "true" : "false";
                    pad.dataset.padMuted = p.muted ? "true" : "false";
                    pad.dataset.padReverse = p.reverse ? "true" : "false";
                    if (Number.isFinite(p.tune)) pad.dataset.padTune = String(p.tune);
                    if (Number.isFinite(p.baseBpm)) pad.dataset.padBaseBpm = String(p.baseBpm);
                    if (Number.isFinite(p.effectiveBpm)) pad.dataset.padEffectiveBpm = String(p.effectiveBpm);
                    if (p.syncAll !== undefined) pad.dataset.padSyncAll = p.syncAll ? "true" : "false";
                    if (p.syncTrack !== undefined && p.syncTrack !== null) pad.dataset.padSyncTrack = String(p.syncTrack);
                    else delete pad.dataset.padSyncTrack;
                    pad.classList.toggle("selected", Boolean(p.selected));
                    const padColor = typeof p.color === "string" && /^#[0-9a-f]{6}$/i.test(p.color)
                      ? p.color
                      : "";
                    pad.style.setProperty("--sampler-pad-color", padColor || "var(--yellow, #ffcc00)");
                    pad.style.borderColor = padColor || "";
                    pad.style.boxShadow = p.selected && padColor
                      ? `0 0 0 2px ${padColor}, 0 0 12px ${padColor}`
                      : p.selected
                        ? "0 0 0 2px var(--yellow, #ffcc00)"
                        : "";
                    const bpmInfo = Number.isFinite(p.effectiveBpm) ? ` [${p.effectiveBpm.toFixed(1)} BPM]` : "";
                    pad.title = p.loaded && p.name
                      ? `${p.name}${bpmInfo} — double-click for settings`
                      : `Pad ${p.id || i + 1} — double-click for settings`;
                    pad.setAttribute("aria-label", pad.title);
                  }
                });
            }
            if (s.samplerMeta) {
              const samplerMetaSig = JSON.stringify([
                s.samplerMeta.bankSelectorVisible,
                s.samplerMeta.hasAdditionalBanks,
                s.samplerMeta.activeBankIndex,
                s.samplerMeta.sixteenLevelsMode,
              ]);
              if (valCache["sampler-meta"] !== samplerMetaSig) {
                valCache["sampler-meta"] = samplerMetaSig;
                const bankSelector = getEl("sampler-bank-selector");
                if (bankSelector) {
                  const showBankSelector = Boolean(
                    s.samplerMeta.bankSelectorVisible ||
                    s.samplerMeta.hasAdditionalBanks ||
                    (Number.isInteger(s.samplerMeta.activeBankIndex) && s.samplerMeta.activeBankIndex > 0)
                  );
                  bankSelector.hidden = !showBankSelector;
                  const activeBank = Number(s.samplerMeta.activeBankIndex || 0);
                  const buttons = bankSelector.querySelectorAll(".sampler-bank-btn");
                  buttons.forEach((btn) => {
                    const b = Number(btn.dataset.bank);
                    btn.classList.toggle("active", b === activeBank);
                  });
                }
                const sampleGrid = getEl("sample-grid");
                if (sampleGrid) {
                  const sixteenMode = s.samplerMeta.sixteenLevelsMode;
                  const isSixteenActive = Boolean(sixteenMode && sixteenMode !== "off");
                  sampleGrid.classList.toggle("sixteen-levels-active", isSixteenActive);
                  for (let padIdx = 1; padIdx <= RECEIVER_SAMPLER_PAD_COUNT; padIdx++) {
                    const pBtn = getEl("sample-" + padIdx);
                    if (pBtn) {
                      if (isSixteenActive) {
                        if (padIdx <= 16) {
                          pBtn.classList.add("sixteen-levels-pad");
                          pBtn.classList.remove("aux-pad");
                        } else {
                          pBtn.classList.add("aux-pad");
                          pBtn.classList.remove("sixteen-levels-pad");
                        }
                      } else {
                        pBtn.classList.remove("sixteen-levels-pad", "aux-pad");
                      }
                    }
                  }
                }
              }
            }
            const samplerFinishedAt = phaseClock();
            if (s.tracks)
              s.tracks.forEach((t, i) => {
                const trackMetadataKey = `track-metadata:${i}`;
                const trackMetadataSignature = JSON.stringify([
                  t.trackId, t.fileName, t.isPlaying, t.isPaused, t.isRecording,
                  t.buttons?.record, t.buttons?.stop, t.buttons?.play, t.buttons?.reverse,
                  t.effectSelection, s.effectOptionsCatalogSignature, t.effectiveBpm ?? t.bpm, t.baseBpm,
                  t.bpmDetectionStatus, t.isMaster, t.isFollower, t.syncAll, t.syncButtons, t.syncWith, t.playlist,
                ]);
                if (valCache[trackMetadataKey] !== trackMetadataSignature) {
                  valCache[trackMetadataKey] = trackMetadataSignature;
                const trackName = t.fileName || "Ready";
                updateText("t-scroll-" + i, trackName);
                updateClass(
                  "t-scroll-" + i,
                  trackName.length > 15
                    ? "scrolling-text active-scrolling"
                    : "scrolling-text",
                );
                const trackLabel = getEl("t-scroll-" + i);
                if (trackLabel) {
                  trackLabel.setAttribute("title", trackName);
                  trackLabel.dataset.trackId = String(t.trackId || i + 1);
                  trackLabel.dataset.trackState = t.isPlaying ? "playing" : t.isPaused ? "paused" : "stopped";
                }
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
                updateEffectOptions(
                  `t-effect-select-${i}`,
                  s.effectOptions,
                  t.effectSelection,
                  s.effectOptionsCatalogSignature,
                );
                const bpmStatus = ["analyzing", "waiting", "unknown", "detected", "idle"]
                  .includes(t.bpmDetectionStatus) ? t.bpmDetectionStatus : null;
                const bpmStatusLabel = bpmStatus === "analyzing"
                  ? "Measuring BPM…"
                  : bpmStatus === "waiting"
                    ? "Play to measure BPM"
                    : bpmStatus === "unknown"
                      ? "No stable beat detected"
                      : "";
                const bpmPending = ["analyzing", "waiting", "unknown"].includes(bpmStatus);
                const readPositiveBpm = (value) => {
                  if ((typeof value !== "number" && typeof value !== "string") ||
                      String(value).trim() === "") return null;
                  const number = Number(value);
                  return Number.isFinite(number) && number > 0 ? number : null;
                };
                const bpmNumber = readPositiveBpm(t.effectiveBpm ?? t.bpm);
                const bpmVal = bpmNumber === null ? null : bpmNumber.toFixed(1);
                const counterInput = getEl(`t-bpm-counter-${i}`);
                if (counterInput) {
                  if (bpmPending) {
                    counterInput.value = "";
                    counterInput.placeholder = bpmStatus === "analyzing" ? "…" : "—";
                    counterInput.title = bpmStatusLabel;
                  } else if (bpmVal !== null) {
                    if (counterInput.value !== bpmVal) counterInput.value = bpmVal;
                    counterInput.placeholder = "";
                    counterInput.title = `Current track tempo: ${bpmVal} BPM`;
                  } else if (bpmStatusLabel) {
                    counterInput.title = bpmStatusLabel;
                  }
                }
                const baseBpmNumber = readPositiveBpm(t.baseBpm);
                const baseBpmVal = baseBpmNumber === null ? null : baseBpmNumber.toFixed(1);
                const baseBadge = getEl(`t-bpm-base-badge-${i}`);
                if (baseBadge) {
                  if (bpmPending) {
                    const badgeText = bpmStatus === "analyzing" ? "BPM …" : "BPM —";
                    if (baseBadge.textContent !== badgeText) baseBadge.textContent = badgeText;
                    baseBadge.title = bpmStatusLabel;
                    baseBadge.setAttribute("aria-label", `Base BPM: ${bpmStatusLabel}`);
                  } else if (baseBpmVal !== null) {
                    const badgeText = `Base: ${baseBpmVal}`;
                    if (baseBadge.textContent !== badgeText) baseBadge.textContent = badgeText;
                    baseBadge.title = "Original unpitched track tempo";
                    baseBadge.setAttribute("aria-label", badgeText);
                  }
                  baseBadge.setAttribute("aria-live", "polite");
                  baseBadge.setAttribute("aria-atomic", "true");
                  if (bpmStatus) baseBadge.dataset.bpmStatus = bpmStatus;
                  else delete baseBadge.dataset.bpmStatus;
                }
                const bpmModule = getEl(`t-bpm-module-${i}`);
                if (bpmModule) {
                  if (t.isMaster !== undefined) {
                    bpmModule.classList.toggle("is-master", Boolean(t.isMaster));
                  }
                  if (t.isFollower !== undefined) {
                    bpmModule.classList.toggle("is-follower", Boolean(t.isFollower));
                  }
                }
                const syncAllChk = getEl(`t-sync-all-${i}`);
                if (syncAllChk && syncAllChk.checked !== Boolean(t.syncAll)) {
                  syncAllChk.checked = Boolean(t.syncAll);
                }
                const syncButtons = Array.isArray(t.syncButtons) ? t.syncButtons : [];
                for (let targetIndex = 0; targetIndex < 4; targetIndex++) {
                  if (targetIndex === i) continue;
                  const btn = getEl(`t-bpm-sync-${i}-to-${targetIndex}`);
                  if (btn) {
                    const btnState = syncButtons.find((b) => Number(b.targetIndex) === targetIndex);
                    const isSelected = btnState
                      ? Boolean(btnState.selected)
                      : (t.syncWith !== null && t.syncWith !== undefined && Number(t.syncWith) === targetIndex);
                    btn.classList.toggle("is-selected", isSelected);
                    btn.setAttribute("aria-pressed", String(isSelected));
                    if (btnState && btnState.populated !== undefined) {
                      btn.classList.toggle("is-populated", Boolean(btnState.populated));
                    }
                  }
                }
                const plNav = getEl(`t-playlist-nav-${i}`);
                if (plNav) {
                  if (t.playlist?.active && t.playlist.totalItems >= 2) {
                    plNav.style.display = "flex";
                    const counter = getEl(`t-pl-counter-${i}`);
                    if (counter) {
                      counter.textContent = `${(t.playlist.currentIndex || 0) + 1}/${t.playlist.totalItems}`;
                    }
                  } else {
                    plNav.style.display = "none";
                  }
                }
                }
                const assignmentKey = getTrackAssignmentCacheKey(t, s);
                if (_lastAssignmentCache[i] !== assignmentKey) {
                  _lastAssignmentCache[i] = assignmentKey;
                  renderMirroredTrackLfoAssignments(t, i);
                }
                if (t.params) {
                  const trackCacheKey = getTrackParamsCacheKey(t, s);
                  if (_lastParamsCache[i] !== trackCacheKey) {
                    _lastParamsCache[i] = trackCacheKey;
                    KNOB_CONFIGS.forEach((cfg) => {
                      const smoothBinding = getTrackLfoVisualBinding(t, cfg.p);
                      const smoothOwned = Boolean(
                        smoothBinding && canRenderSmoothLfo(smoothBinding.index),
                      );
                      if (!smoothOwned) {
                        applyMirroredParameterDisplay(
                          `t-${cfg.p}-sl-${i}`,
                          `t-${cfg.p}-val-${i}`,
                          t.paramDisplays?.[cfg.p],
                          t.params[cfg.p] ?? 0,
                        );
                      }

                    });
                    applyMirroredParameterDisplay(
                      `t-gain-sl-${i}`,
                      `t-gain-val-${i}`,
                      t.paramDisplays?.inputGain,
                      t.params.inputGain ?? 0,
                    );
                    [
                      ["loopStart", `t-ls-sl-${i}`, `t-ls-val-${i}`, 0],
                      ["loopEnd", `t-le-sl-${i}`, `t-le-val-${i}`, 1],
                    ].forEach(([parameterKey, controlId, outputId, fallback]) => {
                      const descriptor = t.paramDisplays?.[parameterKey] || {
                        parameterKey,
                        formatterKind: "loop_timecode_v1",
                      };
                      const rawValue = t.params[parameterKey] ?? descriptor.rawValue ?? fallback;
                      const control = getEl(controlId);
                      if (control && descriptor.max !== undefined && descriptor.max !== null) {
                        control.max = String(descriptor.max);
                      }
                      applyMirroredParameterDisplay(
                        controlId,
                        outputId,
                        descriptor,
                        rawValue,
                      );
                      updateMirroredLoopMarker(control);
                    });
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
              });
            const tracksFinishedAt = phaseClock();
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
            const qaFinishedAt = phaseClock();
            lastGuiRenderPhaseStats = {
              throttled: false,
              buildMs: Math.max(0, buildFinishedAt - phaseStartedAt),
              preludeMs: Math.max(0, preludeFinishedAt - buildFinishedAt),
              preludePhases,
              masterMs: Math.max(0, masterFinishedAt - preludeFinishedAt),
              dialogsMs: Math.max(0, dialogsFinishedAt - masterFinishedAt),
              dialogPhases: {
                registryMs: Math.max(0, registryFinishedAt - masterFinishedAt),
                mirrorsMs: Math.max(0, dialogsFinishedAt - registryFinishedAt),
              },
              samplerMs: Math.max(0, samplerFinishedAt - dialogsFinishedAt),
              tracksMs: Math.max(0, tracksFinishedAt - samplerFinishedAt),
              qaMs: Math.max(0, qaFinishedAt - tracksFinishedAt),
              totalMs: Math.max(0, qaFinishedAt - phaseStartedAt),
              effectOptions: summarizeEffectOptionRendering(),
              presentationLookups: { ...presentationLookupStats },
            };
          } catch (e) {
            lastGuiRenderPhaseStats = {
              ...lastGuiRenderPhaseStats,
              failed: true,
              totalMs: Math.max(0, phaseClock() - phaseStartedAt),
              presentationLookups: { ...presentationLookupStats },
            };
            activeRenderLookupStats = null;
            console.error("❌ Receiver Render Error:", e);
            return false;
          }
          activeRenderLookupStats = null;
          if (typeof scheduleGuiPaintOpportunity === "function") scheduleGuiPaintOpportunity(guiRevision);
          return true;
        }

        let currentBridgeIp = null;
        let currentBridgePort = null;
        let currentBridgeToken = null;
        let currentBridgeStreamToken = null;
        let currentBridgeLogToken = null;
        let currentBridgeNetworkEpoch = 0;
        let binaryWS = null;
        var guiControlWS = null;
        let guiControlTargetKey = "";
        let guiControlConnectionGeneration = 0;
        let guiControlReconnectTimer = null;
        let pendingGuiControlMessages = new Map();
        let pendingGuiControlActions = [];
        const MAX_PENDING_GUI_ACTIONS = 64;
        let wsConnectTimeout = null;
        let handshakeRetryInterval = null;
        let playoutPathLogged = false;
        let suppressBinaryReconnect = false;
        let binaryConnectionGeneration = 0;
        const RECEIVER_BOOT_DIAGNOSTIC_PROTOCOL_VERSION = 1;
        const CAST_SESSION_HEARTBEAT_PROTOCOL_VERSION = 1;
        let lastCastSessionHeartbeatAt = 0;
        let lastCastSessionHeartbeatSequence = 0;

        const GUI_CONTROL_OUTBOUND_TYPES = new Set([
          "RECEIVER_REMOTE_PLAYBACK_INTENT",
          "PLAYBACK_MODE",
          "PLAYOUT_STATE",
          "RECEIVER_READY",
          "PLAYBACK_COMMAND_ACK",
          "NATIVE_LATENCY_REPORT",
          "PCM_RUNTIME_UNSUSTAINABLE",
          "DIAG",
          "AUDIO_PATH_CAPABILITY",
          "CAST_SESSION_HEARTBEAT",
          "CAST_SESSION_HEARTBEAT_ACK",
          "PCM_V2_JITTER_TARGET",
          "RELOAD",
          "RECEIVER_SHUTDOWN",
          "GUI_SNAPSHOT",
          "GUI_PATCH",
          "GUI_STATE_UPDATE",
          "CURSOR_UPDATE",
          "GUI_READY",
          "GUI_ACK",
          "GUI_STATE_ACK",
          "GUI_CHANNEL_TELEMETRY",
          "GUI_ERROR",
          "CAF_TELEMETRY",
          "GUI_ACTION",
          "GUI_INTERACTION_EVENT",
          "GUI_ACTION_RESULT",
          "GUI_ACTION_RESULT_DELIVERY",
          "GUI_CURSOR_ACK",
          "GUI_CLOCK_SYNC_PING",
          "LOG",
          "RECEIVER_BOOT_DIAGNOSTIC",
          "FORCE_CLOSE",
        ]);

        function sendReceiverBridgeMessage(payload, requestedChannel = "auto", requireImmediate = false) {
          let message = payload;
          if (typeof payload === "string") {
            try {
              message = JSON.parse(payload);
            } catch (_error) {
              message = null;
            }
          }
          const messageType = message && typeof message.type === "string" ? message.type : "";
          const useGuiControl = requestedChannel === "gui" ||
            (requestedChannel === "auto" && GUI_CONTROL_OUTBOUND_TYPES.has(messageType));
          const socket = useGuiControl ? guiControlWS : binaryWS;
          const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
          if (socket && socket.readyState === WebSocket.OPEN) {
            try {
              socket.send(serialized);
              return true;
            } catch (_error) {}
          }
          if (requireImmediate) return false;
          if (useGuiControl && messageType) {
            if (messageType === "GUI_ACTION") {
              if (pendingGuiControlActions.length >= MAX_PENDING_GUI_ACTIONS) {
                guiRejectedCount += 1;
                guiLastRejectReason = "gui_control_action_queue_full";
                return false;
              }
              pendingGuiControlActions.push(serialized);
              return true;
            }
            // Control/state is latest-value data. Keep one bounded pending
            // value per type so a reconnect cannot replay an obsolete burst.
            pendingGuiControlMessages.set(messageType, serialized);
            while (pendingGuiControlMessages.size > 32) {
              pendingGuiControlMessages.delete(pendingGuiControlMessages.keys().next().value);
            }
            return true;
          }
          return false;
        }

        function flushReceiverGuiControlMessages() {
          if (!guiControlWS || guiControlWS.readyState !== WebSocket.OPEN) return;
          for (const [messageType, serialized] of pendingGuiControlMessages) {
            try {
              guiControlWS.send(serialized);
              pendingGuiControlMessages.delete(messageType);
            } catch (_error) {
              break;
            }
          }
        }

        function flushPendingReceiverGuiActions() {
          if (
            !pendingGuiControlActions.length ||
            !guiControlWS || guiControlWS.readyState !== WebSocket.OPEN ||
            !Number.isSafeInteger(guiLastReceivedRevision) || guiLastReceivedRevision < 0
          ) return 0;
          const pending = pendingGuiControlActions.splice(0, MAX_PENDING_GUI_ACTIONS);
          let flushed = 0;
          for (let index = 0; index < pending.length; index += 1) {
            const serialized = pending[index];
            try {
              const action = JSON.parse(serialized);
              action.guiSessionNonce = guiSessionNonce;
              action.senderGuiRevision = guiLastReceivedRevision;
              guiControlWS.send(JSON.stringify(action));
              flushed += 1;
            } catch (_error) {
              pendingGuiControlActions.unshift(...pending.slice(index));
              break;
            }
          }
          if (flushed > 0) {
            emitGuiChannelTelemetry("queued_actions_replayed", {
              count: flushed,
              senderGuiRevision: guiLastReceivedRevision,
            });
          }
          return flushed;
        }

        function isValidBridgeCredential(value) {
          return typeof value === "string" &&
            value.length >= 20 &&
            value.length <= 256 &&
            !value.startsWith("{{");
        }

        function injectedBridgeCredential(name) {
          const value = window[name];
          return isValidBridgeCredential(value) ? value : "";
        }

        function acceptBridgeCredentials(data, source) {
          // A local launch must bootstrap through its one-use, peer-bound grant.
          if (LOCAL_BOOTSTRAP_TOKEN && source === "cast_control") return false;
          const receiverToken = data && isValidBridgeCredential(data.token)
            ? data.token
            : "";
          if (!receiverToken) {
            relayLogToStudio(
              "⚠️ Receiver: Rejected BRIDGE_CONFIG with an invalid receiver credential from " +
                (source || "unknown") + ".",
            );
            return false;
          }
          // Compatibility fallback is intentionally limited to descriptors
          // produced by an older Studio runtime. Current descriptors always
          // carry independent stream and log capabilities.
          const streamToken = isValidBridgeCredential(data.streamToken)
            ? data.streamToken
            : receiverToken;
          const logToken = isValidBridgeCredential(data.logToken)
            ? data.logToken
            : receiverToken;
          currentBridgeToken = receiverToken;
          currentBridgeStreamToken = streamToken;
          currentBridgeLogToken = logToken;
          return true;
        }

        function sendReceiverBootDiagnostic(stage, details) {
          if (!stage || receiverBootDiagnosticCount >= 32) return false;
          receiverBootDiagnosticCount += 1;
          const payload = {
            type: "RECEIVER_BOOT_DIAGNOSTIC",
            protocolVersion: RECEIVER_BOOT_DIAGNOSTIC_PROTOCOL_VERSION,
            stage: String(stage),
            elapsedMs: Math.max(0, Date.now() - receiverStartupTimingStartAt),
            receiverBootStage: window._receiverBootStage || null,
            details: details && typeof details === "object"
              ? details
              : { message: String(details || "") },
          };
          let sent = false;
          if (binaryWS && binaryWS.readyState === WebSocket.OPEN) {
            try {
              sent = sendReceiverBridgeMessage(payload, "gui");
            } catch (_error) {}
          }
          if (!sent && typeof cast !== "undefined" && cast.framework) {
            try {
              const context = getCastReceiverContext();
              const senders = context && context.getSenders ? context.getSenders() : [];
              if (context && senders.length > 0) {
                context.sendCustomMessage(CUSTOM_NAMESPACE, senders[0].id, payload);
                sent = true;
              }
            } catch (_error) {}
          }
          if (!sent) {
            const pageHost = window.location.hostname;
            const pageHostIsStudio =
              pageHost === "localhost" ||
              pageHost === "127.0.0.1" ||
              /^\d{1,3}(?:\.\d{1,3}){3}$/.test(pageHost);
            const targetIp = currentBridgeIp || (pageHostIsStudio ? pageHost : null);
            if (targetIp) {
              const targetPort = currentBridgePort ||
                (window.SERVER_PORT && !window.SERVER_PORT.startsWith("{{")
                  ? window.SERVER_PORT
                  : "8080");
              const logToken = currentBridgeLogToken ||
                (window.LOG_TOKEN && !window.LOG_TOKEN.startsWith("{{")
                  ? window.LOG_TOKEN
                  : "");
              const url = "http://" + targetIp + ":" + targetPort + "/log?m=" +
                encodeURIComponent(JSON.stringify(payload)) + "&token=" +
                encodeURIComponent(logToken);
              try {
                if (navigator.sendBeacon) {
                  sent = navigator.sendBeacon(url);
                } else {
                  fetch(url).catch(() => {});
                  sent = true;
                }
              } catch (_error) {}
            }
          }
          return sent;
        }

        function sendCastSessionHeartbeatAck(payload, source) {
          if (source === "binary bridge" || source === "GUI control WebSocket") {
            return sendReceiverBridgeMessage(payload, "gui");
          } else if (source === "Cast channel" && typeof cast !== "undefined" && cast.framework) {
            try {
              const context = getCastReceiverContext();
              const senders = context && context.getSenders ? context.getSenders() : [];
              if (context && senders.length > 0) {
                context.sendCustomMessage(CUSTOM_NAMESPACE, senders[0].id, payload);
                return true;
              }
            } catch (_error) {}
          }
          return false;
        }

        function acknowledgeCastSessionHeartbeat(message, source) {
          let rejectionReason = null;
          if (!identityAllowsGui()) rejectionReason = "identity_not_verified";
          else if (!receiverBridgeConfigReady) rejectionReason = "bridge_config_not_ready";
          else if (Number(message?.protocolVersion) !== CAST_SESSION_HEARTBEAT_PROTOCOL_VERSION) {
            rejectionReason = "protocol_version_mismatch";
          } else if (typeof guiSessionNonce !== "string" || message?.guiSessionNonce !== guiSessionNonce) {
            rejectionReason = "gui_session_nonce_mismatch";
          }
          if (rejectionReason) {
            console.warn(JSON.stringify({
              type: "CAST_SESSION_HEARTBEAT_RECEIVER",
              accepted: false,
              reason: rejectionReason,
              sequence: Number(message?.sequence) || 0,
              source: source || "unknown",
            }));
            return false;
          }
          const sequence = Number(message?.sequence);
          if (!Number.isSafeInteger(sequence) || sequence <= 0) {
            console.warn(JSON.stringify({
              type: "CAST_SESSION_HEARTBEAT_RECEIVER",
              accepted: false,
              reason: "invalid_sequence",
              sequence: Number.isFinite(sequence) ? sequence : null,
              source: source || "unknown",
            }));
            return false;
          }
          const firstHeartbeat = lastCastSessionHeartbeatAt === 0;
          lastCastSessionHeartbeatAt = Date.now();
          lastCastSessionHeartbeatSequence = Math.max(
            lastCastSessionHeartbeatSequence,
            sequence,
          );
          window._lastCastSessionHeartbeatAt = lastCastSessionHeartbeatAt;
          window._lastCastSessionHeartbeatSequence = lastCastSessionHeartbeatSequence;
          clearNoSenderShutdownTimer();
          revealReceiverUi("session_heartbeat");

          const acknowledged = sendCastSessionHeartbeatAck({
            type: "CAST_SESSION_HEARTBEAT_ACK",
            protocolVersion: CAST_SESSION_HEARTBEAT_PROTOCOL_VERSION,
            sequence,
            receivedAtMs: lastCastSessionHeartbeatAt,
            guiSessionNonce,
            source: source || "unknown",
            playbackMode: window._playbackMode || "unknown",
            audioPathOwner: activeAudioPathOwner,
            receiverUiRevealed: window._receiverUiRevealed === true,
          }, source);
          if (firstHeartbeat || sequence % 12 === 0) {
            relayLogToStudio(
              "💓 Receiver: Cast session heartbeat acknowledged " +
                "(sequence=" + sequence +
                ", source=" + (source || "unknown") +
                ", sent=" + acknowledged + ").",
            );
            console.log(JSON.stringify({
              type: "CAST_SESSION_HEARTBEAT_RECEIVER",
              accepted: true,
              sequence,
              source: source || "unknown",
              ackSent: acknowledged,
            }));
          }
          return true;
        }

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

        function acceptBridgeNetworkEpoch(value, source) {
          const result = window.MXSCastSessionBinding.networkEpoch(currentBridgeNetworkEpoch, value);
          if (!result.accepted) {
            relayLogToStudio(
              `⚠️ Receiver: Rejected BRIDGE_CONFIG network epoch ${String(value)} from ${source || "unknown"}.`,
            );
            return false;
          }
          if (result.changed) {
            relayLogToStudio(
              `🔄 Receiver: Bridge network epoch ${currentBridgeNetworkEpoch} → ${result.next}.`,
            );
            currentBridgeNetworkEpoch = result.next;
          }
          return true;
        }

        // Apply the shared, authenticated portion of BRIDGE_CONFIG exactly
        // once per session/signature. Both the Cast namespace and the bridge
        // WebSocket can mirror this message; repeating it must not clear GUI
        // readiness or manufacture another receiver generation.
        function applyReceiverBridgeConfig(data, source, options) {
          const config = data && typeof data === "object" ? data : {};
          const binding = window.MXSCastSessionBinding.evaluate(
            config,
            guiSessionNonce,
            receiverBridgeConfigRevision,
            window._studioRate,
          );
          if (!binding.valid) {
            relayLogToStudio(
              "⚠️ Receiver: " + (source || "unknown") +
                " BRIDGE_CONFIG missing a valid GUI session nonce.",
            );
            return false;
          }
          guiSessionNonce = binding.nonce;
          const sessionChanged = binding.sessionChanged;
          const newRate = config.config ? config.config.sampleRate : null;
          const configRevision = binding.revision;
          const duplicateConfig = binding.duplicate;
          receiverBridgeConfigRevision = configRevision;
          if (duplicateConfig) {
            configReceived = true;
            receiverBridgeConfigReady = true;
            maybeEnableReceiverHandshakeTelemetry();
            sendReceiverHandshakeCommit(source || "duplicate_bridge_config");
            relayLogToStudio(
              "⏭️ Receiver: Duplicate BRIDGE_CONFIG revision ignored after readiness was preserved.",
            );
            return false;
          }
          configReceived = true;
          receiverBridgeConfigReady = true;
          if (newRate && window._studioRate !== newRate) {
            window._studioRate = newRate;
            relayLogToStudio(
              "🔄 Receiver: Studio rate updated via signaling to " + newRate + "Hz",
            );
          }
          maybeEnableReceiverHandshakeTelemetry();
          flushPendingPlayoutState();
          if (options?.announceGuiReady !== false) {
            sendAuthenticatedGuiReady("bridge_config");
          }
          if (options?.markPathReady !== false && config.ip) {
            markReceiverPlayoutPathReady();
          }
          sendReceiverHandshakeCommit(source || "bridge_config");
          return sessionChanged;
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
          desiredPlaybackState = "playing";
          markPlaybackStartSignal();
          playbackPaused = false;
          setPcmAudioPriority(
            pcmPathOwnsAudio(),
            reason || "playback_start",
          );
          if (workletNode && workletNode.port) {
            try { workletNode.port.postMessage({ type: "RESUME", playbackEpoch: lastPlaybackEpoch, playbackRevision: lastPlaybackRevision }); } catch (e) {}
          }
          const playbackRevision = Number(d.playbackRevision);
          restartUnavailableNativeResume(
            reason || "playback_start",
            playbackRevision,
          );
          const resumingNative = nativeStreamActive && nativeStreamPaused;
          requestNativePlaybackStart(reason || "playback_start");
          if (resumingNative) {
            startNativeResumeProgressProbe(playbackRevision);
          }
          if (nativeStreamActive) {
            publishMxsPlaybackStatus("PLAYING", reason || "playback_start");
          } else if (!resumingNative) {
            publishMxsPlaybackStatus("STARTING", reason || "playback_start");
          }
          acknowledgePlaybackRevision(d, "playback_start");
          schedulePlaybackRecoveryRetry();
          const immediateState = buildImmediatePlaybackState(d.trackId);
          if (immediateState) {
            lastMirroredState = immediateState;
            if (typeof requestAnimationFrame === "function") {
              requestAnimationFrame(() => renderState(immediateState, true));
            } else {
              renderState(immediateState, true);
            }
          }
        }

        function handlePlaybackResumeCommand(d) {
          if (!acceptPlaybackRevision(d, "PLAYBACK_RESUME")) return;
          noteOrderedPlaybackAction("PLAYBACK_RESUME");
          if (desiredPlaybackState !== "paused") {
            relayLogToStudio("⚠️ Receiver: PLAYBACK_RESUME rejected because playback was not paused.");
            acknowledgePlaybackRevision(d, "playback_resume_rejected");
            return;
          }
          desiredPlaybackState = "playing";
          markPlaybackStartSignal();
          playbackPaused = false;
          setPcmAudioPriority(pcmPathOwnsAudio(), "playback_resume");
          if (workletNode?.port) {
            try { workletNode.port.postMessage({ type: "RESUME", playbackEpoch: lastPlaybackEpoch, playbackRevision: lastPlaybackRevision }); } catch (e) {}
          }
          const revision = Number(d.playbackRevision);
          restartUnavailableNativeResume("playback_resume", revision);
          const resumingNative = nativeStreamActive && nativeStreamPaused;
          requestNativePlaybackStart("playback_resume");
          if (resumingNative) startNativeResumeProgressProbe(revision);
          if (nativeStreamActive) publishMxsPlaybackStatus("PLAYING", "playback_resume");
          else if (!resumingNative) publishMxsPlaybackStatus("STARTING", "playback_resume");
          acknowledgePlaybackRevision(d, "playback_resume");
          schedulePlaybackRecoveryRetry();
          const immediateState = buildImmediatePlaybackState(d.trackId);
          if (immediateState) {
            lastMirroredState = immediateState;
            if (typeof requestAnimationFrame === "function") {
              requestAnimationFrame(() => renderState(immediateState, true));
            } else {
              renderState(immediateState, true);
            }
          }
        }

        function summarizeLfoVisualState(state) {
          const summary = {
            lfoAssignmentCount: 0,
            lfoReversedCount: 0,
            lfoMinMarkerCount: 0,
            lfoMaxMarkerCount: 0,
            lfoMaster1Active: state?.master?.lfo1?.active === true,
            lfoMaster2Active: state?.master?.lfo2?.active === true,
            lfoAssignmentsByTrack: [],
            lfoCheckboxMissingCount: 0,
            lfoCheckboxMismatchCount: 0,
            lfoSliderMissingCount: 0,
            lfoMeter1: Number(state?.master?.lfo1?.value) || 0,
            lfoMeter2: Number(state?.master?.lfo2?.value) || 0,
            track1Pan: null,
          };
          (state?.tracks || []).forEach((track, trackIndex) => {
            const trackAssignments = { trackIndex, lfo1: [], lfo2: [] };
            if (trackIndex === 0 && Number.isFinite(Number(track?.params?.pan))) {
              summary.track1Pan = Number(track.params.pan);
            }
            KNOB_CONFIGS.forEach((config) => {
              const indicator = track?.lfoIndicators?.[config.p];
              [1, 2].forEach((lfoIndex) => {
                const lfo = indicator?.[`lfo${lfoIndex}`];
                const assigned = lfo && typeof lfo === "object"
                  ? lfo.checked === true
                  : Boolean(lfo ?? track?.lfoAssigns?.[lfoIndex]?.includes?.(config.p));
                if (lfo && typeof lfo === "object") {
                  if (assigned && lfo.reversed) summary.lfoReversedCount += 1;
                }
                if (!assigned) return;
                summary.lfoAssignmentCount += 1;
                const parameterAssignments = trackAssignments[`lfo${lfoIndex}`];
                parameterAssignments.push(config.p);
                const checkbox = getEl(`t-lfo${lfoIndex}-chk-${trackIndex}-${config.p}`);
                if (!checkbox) summary.lfoCheckboxMissingCount += 1;
                else if (!checkbox.checked) summary.lfoCheckboxMismatchCount += 1;
                if (!getEl(`t-${config.p}-sl-${trackIndex}`)) {
                  summary.lfoSliderMissingCount += 1;
                }
              });
              if (indicator?.minMarker?.active) summary.lfoMinMarkerCount += 1;
              if (indicator?.maxMarker?.active) summary.lfoMaxMarkerCount += 1;
            });
            if (trackAssignments.lfo1.length || trackAssignments.lfo2.length) {
              summary.lfoAssignmentsByTrack.push(trackAssignments);
            }
          });
          return summary;
        }

        function summarizeLfoVisualSamples(state, nowMs = getLfoVisualNow()) {
          const samples = [];
          const visualState = getPresentationVisualState(state, nowMs) || state;
          (visualState?.tracks || []).slice(0, 4).forEach((track, trackIndex) => {
            KNOB_CONFIGS.forEach((config) => {
              const binding = getTrackLfoVisualBinding(track, config.p);
              if (!binding) return;
              const lfoIndex = binding.index;
              const clock = smoothLfoClocks[lfoIndex];
              const slider = getEl(`t-${config.p}-sl-${trackIndex}`);
              const valueDisplay = getEl(`t-${config.p}-val-${trackIndex}`);
              const minimum = Number.isFinite(Number(slider?.min)) ? Number(slider.min) : config.min;
              const maximum = Number.isFinite(Number(slider?.max)) ? Number(slider.max) : config.max;
              const rangeMinimum = binding.authoritative ? binding.min : markerValueFromPercent(binding.minMarker, minimum, maximum, minimum);
              const rangeMaximum = binding.authoritative ? binding.max : markerValueFromPercent(binding.maxMarker, minimum, maximum, maximum);
              const phaseAvailable = Number.isFinite(clock?.phase) && clock.phase !== null;
              let signedValue = phaseAvailable ? computeReceiverLfoWaveformValue(clock.phase, clock.waveformType, clock.dutyCycle) : null;
              if (binding.reversed && signedValue !== null) signedValue = -signedValue;
              const modulated = signedValue === null ? null : (signedValue + 1) * 0.5 * (rangeMaximum - rangeMinimum) + rangeMinimum;
              const gate = clock?.gateValue ?? 1;
              const controlValue = samplePresentedControlValue(binding, trackIndex, config.p, clock?.sourceAudioSec);
              const expected = binding.controlClockMode === "media_element_control_rate" ? controlValue :
                modulated === null ? null : binding.authoritative ? binding.baseValue + gate * (modulated - binding.baseValue) : modulated;
              const renderedValue = slider ? Number(slider.value) : null;
              samples.push({ trackIndex, parameter: config.p, lfoIndex, assigned: true,
                reversed: Boolean(binding.reversed), renderBindingLfoIndex: lfoIndex, renderBindingMatches: true,
                active: Boolean(clock?.active && phaseAvailable), masterActive: Boolean(state?.master?.[`lfo${lfoIndex}`]?.active),
                clockActive: Boolean(clock?.active), phaseAvailable, phaseRad: phaseAvailable ? clock.phase : null,
                signedValue, rangeMinimum, rangeMaximum, expectedValue: expected, renderedValue: renderedValue === null ? null : Number(renderedValue.toFixed(4)),
                renderedLabel: valueDisplay?.textContent ?? null, controlPresent: Boolean(slider),
                controlStep: Number(slider?.step) || config.s,
                manualOwned: Boolean(binding.manualOwned || track.manualKnobInteraction?.[config.p]),
                interactionPending: slider?.dataset.castInteractionState === "pending",
                sourceAudioSec: clock?.sourceAudioSec ?? null,
                presentation: clock?.presentation ?? null,
                presentationAvailable: clock?.presentationAvailable ?? false,
                idlePreview: clock?.previewAvailable ?? false,
                controlClockMode: binding.controlClockMode || "native_audio_param",
                controlRateError: binding.controlRateError === true,
                evidenceStage: "animation_frame_dom_submitted",
              });
            });
          });
          return samples;
        }

        function packLfoVisualEvidence(samples) {
          const columns = ["trackIndex", "parameter", "lfoIndex", "reversed", "active", "masterActive",
            "clockActive", "phaseAvailable", "phaseRad", "rangeMinimum", "rangeMaximum", "expectedValue", "renderedValue",
            "renderedLabel", "controlPresent", "controlStep", "manualOwned", "interactionPending",
            "sourceAudioSec", "presentationAvailable", "controlRateError", "controlClockMode", "idlePreview"];
          return { lfoVisualSchema: "mxs.cast.lfo-proof.v2", lfoVisualColumns: columns,
            lfoVisualRows: samples.slice(0, 28).map((sample) => columns.map((key) => {
              const value = sample[key];
              return typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(6)) :
                typeof value === "string" ? value.slice(0, 48) : value ?? null;
            })) };
        }

        function captureLfoVisualProof(state, nowMs = Date.now()) {
          const proof = lastSubmittedLfoProof;
          if (!proof) return null;
          if (Number.isSafeInteger(state?.transport?.playbackEpoch) && Number.isSafeInteger(proof.transport.playbackEpoch) &&
              (state.transport.playbackEpoch !== proof.transport.playbackEpoch || state.transport.playbackRevision !== proof.transport.playbackRevision)) return null;
          const samples = proof.samples;
          if (samples.length === 0) return null;
          const signature = JSON.stringify(samples.map((sample) => [
            sample.trackIndex,
            sample.parameter,
            sample.lfoIndex,
            sample.reversed,
            sample.renderBindingLfoIndex,
            sample.renderBindingMatches,
            sample.masterActive,
            sample.clockActive,
            sample.phaseAvailable,
          ]));
          const changed = signature !== guiLastLfoVisualProofSignature;
          const active = samples.some((sample) => sample.masterActive);
          if (!changed && !active) return null;
          if (
            !changed &&
            nowMs - guiLastLfoVisualProofAt < GUI_LFO_VISUAL_PROOF_INTERVAL_MS
          ) return null;

          guiLastLfoVisualProofAt = nowMs;
          guiLastLfoVisualProofSignature = signature;
          return {
            lfoVisualSampleAtMs: proof.sampledAtMs,
            lfoVisualReceiverMonotonicMs: proof.receiverMonotonicMs,
            lfoVisualProofCaptureSequence: proof.transport.captureSequence ?? null,
            lfoVisualProofFrameSequence: proof.frameSequence,
            lfoVisualEvidenceStage: "last_animation_frame_dom_submitted",
            ...packLfoVisualEvidence(samples),
          };
        }

        function summarizeMirroredButtonVisualState(state) {
          const expected = [];
          const add = (id, buttonState) => {
            if (!buttonState) return;
            expected.push({
              id,
              active: buttonState.active === true,
              phase: buttonState.operationState || buttonState.state ||
                (buttonState.active ? "active" : "inactive"),
            });
          };
          add("master-record-button", state?.master?.buttons?.record);
          add("lfo-toggle", state?.master?.buttons?.lfo1);
          add("lfo2-toggle", state?.master?.buttons?.lfo2);
          (state?.tracks || []).forEach((track, index) => {
            add(`t-rec-${index}`, track?.buttons?.record);
            add(`t-stop-${index}`, track?.buttons?.stop);
            add(`t-play-${index}`, track?.buttons?.play);
            add(`t-rev-${index}`, track?.buttons?.reverse);
          });
          const activeExpected = expected.filter((item) => item.active).map((item) => item.id);
          const activePainted = [];
          const mismatches = [];
          expected.forEach((item) => {
            const element = document.getElementById(item.id);
            const paintedActive = element?.classList.contains("mirrored-active") === true;
            const paintedPhase = element?.dataset?.mirroredState || "missing";
            if (paintedActive) activePainted.push(item.id);
            if (!element || paintedActive !== item.active || paintedPhase !== item.phase) {
              mismatches.push(item.id);
            }
          });
          return {
            buttonActiveExpected: activeExpected,
            buttonActivePainted: activePainted,
            buttonStateMismatchCount: mismatches.length,
            buttonStateMismatchIds: mismatches,
          };
        }

        let _cachedSamplerLayoutSummary = null;
        let _lastSamplerLayoutMeasureAt = 0;
        function summarizeSamplerVisualLayout() {
          const now = Date.now();
          if (_cachedSamplerLayoutSummary && now - _lastSamplerLayoutMeasureAt < 2000) {
            return _cachedSamplerLayoutSummary;
          }
          const grid = document.getElementById("sample-grid");
          const summary = {
            samplerExpected: RECEIVER_SAMPLER_PAD_COUNT,
            samplerRendered: 0,
            samplerVisible: 0,
            samplerColumns: 0,
            samplerRows: 0,
            samplerLayoutValid: false,
          };
          if (!grid) return summary;
          const pads = Array.from(grid.children).filter(function isSamplerPad(child) {
            return child.classList && child.classList.contains("sample-btn");
          });
          summary.samplerRendered = pads.length;
          const columnPositions = new Set();
          const rowPositions = new Set();
          let gridRect = null;
          try {
            gridRect = grid.getBoundingClientRect();
          } catch (_error) {}
          pads.forEach(function measureSamplerPad(pad) {
            let rect = null;
            try {
              rect = pad.getBoundingClientRect();
            } catch (_error) {}
            if (!rect || rect.width <= 0 || rect.height <= 0) return;
            const intersectsGrid =
              !gridRect ||
              (rect.right > gridRect.left &&
                rect.left < gridRect.right &&
                rect.bottom > gridRect.top &&
                rect.top < gridRect.bottom);
            if (!intersectsGrid) return;
            summary.samplerVisible += 1;
            columnPositions.add(Math.round(rect.left));
            rowPositions.add(Math.round(rect.top));
          });
          summary.samplerColumns = columnPositions.size;
          summary.samplerRows = rowPositions.size;
          summary.samplerLayoutValid =
            summary.samplerRendered === RECEIVER_SAMPLER_PAD_COUNT &&
            summary.samplerVisible === RECEIVER_SAMPLER_PAD_COUNT &&
            summary.samplerColumns === RECEIVER_SAMPLER_COLUMNS &&
            summary.samplerRows === RECEIVER_SAMPLER_ROWS;
          _cachedSamplerLayoutSummary = summary;
          _lastSamplerLayoutMeasureAt = now;
          return summary;
        }

        function reportGuiAckError(stage, error, details = {}) {
          const now = Date.now();
          if (guiLastAckErrorAt && now - guiLastAckErrorAt < 5000) return false;
          guiLastAckErrorAt = now;
          try {
            writeCastDebug("warn", "GUI_ACK_FAILED " + JSON.stringify({
              ...details,
              stage,
              message: String(error?.message || error).slice(0, 200),
            }));
          } catch (_logError) {}
          return true;
        }

        function reportGuiStateProcessingFailure(envelope, error, source = "binary bridge") {
          const reason = "receiver_processing_exception";
          const details = {
            stage: "binary_message_dispatch",
            revision: Number(envelope?.guiRevision ?? -1),
            messageType: String(envelope?.type || "unknown"),
            source,
            guiSessionNonceMatches: envelope?.guiSessionNonce === guiSessionNonce,
            bridgeConfigReady: receiverBridgeConfigReady === true,
            ackOutcome: "not_sent_processing_exception",
            message: String(error?.message || error).slice(0, 200),
          };
          guiRejectedCount += 1;
          guiLastRejectReason = reason;
          try {
            emitGuiChannelTelemetry("processing_error", { reason, ...details });
          } catch (_telemetryError) {}
          let shouldSendError = false;
          try {
            shouldSendError = reportGuiAckError(details.stage, error, details);
          } catch (_logError) {}
          if (shouldSendError) {
            try {
              emitGuiChannelError(reason, details);
            } catch (_sendError) {}
          }
        }

        function handleGuiStateUpdateCommand(state, envelope, ackType = "snapshot") {
          const revision = Number(envelope?.guiRevision ?? -1);
          const messageStartedAt = typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : Date.now();
          const timelineCaptureSequence = Number(envelope?.timelineCaptureSequence);
          const snapshotPlaybackEpoch = Number(envelope?.playbackEpoch);
          const snapshotPlaybackRevision = Number(envelope?.playbackRevision);
          const receiverPlaybackEpochAtAck = Number(lastPlaybackEpoch);
          const receiverPlaybackRevisionAtAck = Number(lastPlaybackRevision);
          const hasSnapshotPlaybackIdentity = Number.isSafeInteger(snapshotPlaybackEpoch) &&
            snapshotPlaybackEpoch >= 0 && Number.isSafeInteger(snapshotPlaybackRevision) &&
            snapshotPlaybackRevision >= 0;
          const hasReceiverPlaybackIdentity = Number.isSafeInteger(receiverPlaybackEpochAtAck) &&
            receiverPlaybackEpochAtAck >= 0 && Number.isSafeInteger(receiverPlaybackRevisionAtAck) &&
            receiverPlaybackRevisionAtAck >= 0;
          const timelineAckDetails = {
            ...(Number.isSafeInteger(timelineCaptureSequence) && timelineCaptureSequence >= 0
              ? { timelineCaptureSequence }
              : {}),
            ...(hasSnapshotPlaybackIdentity
              ? { playbackEpoch: snapshotPlaybackEpoch, playbackRevision: snapshotPlaybackRevision }
              : {}),
            ...(hasReceiverPlaybackIdentity
              ? { receiverPlaybackEpochAtAck, receiverPlaybackRevisionAtAck }
              : {}),
            playbackIdentityMatchedAtAck: hasSnapshotPlaybackIdentity && hasReceiverPlaybackIdentity
              ? snapshotPlaybackEpoch === receiverPlaybackEpochAtAck &&
                (envelope?.type === "GUI_PATCH"
                  ? snapshotPlaybackRevision <= receiverPlaybackRevisionAtAck
                  : snapshotPlaybackRevision === receiverPlaybackRevisionAtAck)
              : null,
          };
          if (Number.isSafeInteger(revision) && revision >= 0 && revision === lastGuiRevision) {
            // A bounded sender retry can arrive after the original render was
            // accepted. ACK the committed revision without rendering twice.
            if (guiControlWS && guiControlWS.readyState === WebSocket.OPEN) {
              try {
                const receiverAckSentAtMonotonicMs = getLfoVisualNow();
                const ackSent = sendReceiverBridgeMessage({
                  type: "GUI_ACK",
                  transport: "gui",
                  guiProtocolVersion: CAST_GUI_PROTOCOL_VERSION,
                  guiSessionNonce,
                  ackType,
                  channel: "gui",
                  guiRevision: revision,
                  ...timelineAckDetails,
                  receiverMessageStartedAtMonotonicMs: messageStartedAt,
                  receiverAckSentAtMonotonicMs,
                  senderMonotonicEstimateAtReceiverMessageStartMs:
                    mapReceiverToSenderMonotonic(messageStartedAt),
                  senderMonotonicEstimateAtReceiverAckSentMs:
                    mapReceiverToSenderMonotonic(receiverAckSentAtMonotonicMs),
                  senderMonotonicEstimateUncertaintyMs:
                    Number.isFinite(guiClockSyncEstimate?.uncertaintyMs)
                      ? guiClockSyncEstimate.uncertaintyMs
                      : null,
                  guiInteractionRevision: Number(envelope.guiInteractionRevision ?? -1),
                  rawCount: guiRawMessageCount,
                  rejectedCount: guiRejectedCount,
                  receivedCount: guiReceivedCount,
                  renderedCount: guiRenderedCount,
                  renderedRevision: guiLastRenderedRevision,
                  renderResult: "duplicate",
                  renderTimeMs: 0,
                  receiverProcessingMs: Math.max(0, receiverAckSentAtMonotonicMs - messageStartedAt),
                  payloadBytes: 0,
                }, "gui", true);
                if (!ackSent) throw new Error("GUI ACK socket write failed");
                guiAckCount += 1;
                guiLastAckRevision = revision;
                emitGuiChannelTelemetry("acknowledged", {
                  revision,
                  renderResult: "duplicate",
                  renderTimeMs: 0,
                  payloadBytes: 0,
                });
              } catch (error) {
                reportGuiAckError("duplicate_send", error, {
                  revision,
                  messageType: envelope?.type || "GUI_STATE_UPDATE",
                  guiSessionNonceMatches: envelope?.guiSessionNonce === guiSessionNonce,
                  ackOutcome: "duplicate_ack_send_failed",
                });
                try {
                  emitGuiChannelTelemetry("ack_send_failed", {
                    revision,
                    messageType: envelope?.type || "GUI_STATE_UPDATE",
                    ackOutcome: "duplicate_ack_send_failed",
                  });
                } catch (_telemetryError) {}
              }
            }
            flushPendingReceiverGuiActions();
            return;
          }
          if (!acceptGuiRevision(envelope)) {
            rejectGuiChannelMessage("stale_revision", {
              revision,
            });
            return;
          }
          const snapshotPlaybackIdentityIsOlder = ackType === "snapshot" &&
            hasSnapshotPlaybackIdentity && hasReceiverPlaybackIdentity &&
            isRevisionOlder(
              snapshotPlaybackEpoch,
              snapshotPlaybackRevision,
              receiverPlaybackEpochAtAck,
              receiverPlaybackRevisionAtAck,
            );
          if (snapshotPlaybackIdentityIsOlder) {
            const acceptedRevision = Number(envelope.guiRevision || -1);
            const payloadBytes = Number.isSafeInteger(envelope._receiverWireBytes)
              ? envelope._receiverWireBytes
              : null;
            // GUI revisions are consumed so a delayed retry cannot replay the
            // same obsolete snapshot, but it must not replace visible or
            // retained state after a newer playback command was accepted.
            commitGuiRevision(envelope);
            guiReceivedCount += 1;
            guiLastReceivedRevision = revision;
            flushPendingReceiverGuiActions();
            emitGuiChannelTelemetry("stale_playback_snapshot_skipped", {
              revision: acceptedRevision,
              snapshotPlaybackEpoch,
              snapshotPlaybackRevision,
              receiverPlaybackEpochAtAck,
              receiverPlaybackRevisionAtAck,
              payloadBytes,
            });
            if (guiControlWS && guiControlWS.readyState === WebSocket.OPEN) {
              try {
                const receiverAckSentAtMonotonicMs = getLfoVisualNow();
                const ackSent = sendReceiverBridgeMessage({
                  type: "GUI_ACK",
                  transport: "gui",
                  guiProtocolVersion: CAST_GUI_PROTOCOL_VERSION,
                  guiSessionNonce,
                  ackType,
                  channel: "gui",
                  guiRevision: acceptedRevision,
                  ...timelineAckDetails,
                  playbackIdentityOutcome: "stale_snapshot_skipped",
                  receiverMessageStartedAtMonotonicMs: messageStartedAt,
                  receiverAckSentAtMonotonicMs,
                  senderMonotonicEstimateAtReceiverMessageStartMs:
                    mapReceiverToSenderMonotonic(messageStartedAt),
                  senderMonotonicEstimateAtReceiverAckSentMs:
                    mapReceiverToSenderMonotonic(receiverAckSentAtMonotonicMs),
                  senderMonotonicEstimateUncertaintyMs:
                    Number.isFinite(guiClockSyncEstimate?.uncertaintyMs)
                      ? guiClockSyncEstimate.uncertaintyMs
                      : null,
                  guiInteractionRevision: Number(envelope.guiInteractionRevision ?? -1),
                  rawCount: guiRawMessageCount,
                  rejectedCount: guiRejectedCount,
                  receivedCount: guiReceivedCount,
                  renderedCount: guiRenderedCount,
                  renderedRevision: guiLastRenderedRevision,
                  renderResult: "stale_playback_snapshot",
                  renderTimeMs: 0,
                  receiverProcessingMs: Math.max(0, receiverAckSentAtMonotonicMs - messageStartedAt),
                  payloadBytes,
                }, "gui", true);
                if (!ackSent) throw new Error("stale GUI ACK socket write failed");
                guiAckCount += 1;
                guiLastAckRevision = revision;
              } catch (error) {
                reportGuiAckError("stale_snapshot_send", error, {
                  revision: acceptedRevision,
                  messageType: envelope?.type || "GUI_STATE_UPDATE",
                  ackOutcome: "stale_snapshot_ack_send_failed",
                });
              }
            }
            return;
          }
          const normalizedState = normalizeGuiState(state);
          if (!normalizedState) {
            rejectGuiChannelMessage("unsupported_state_schema", {
              revision: Number(envelope?.guiRevision ?? -1),
            });
            writeCastDebug("warn", "Receiver rejected GUI_STATE_UPDATE with an unsupported state schema.");
            return;
          }
          rememberPresentationVisualState(normalizedState);
          const acceptedRevision = Number(envelope.guiRevision || -1);
          const renderStartedAt = typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : Date.now();
          const shouldDeferGuiState =
            (pcmAudioPriorityActive || Date.now() < playbackControlGuiHoldUntil) &&
            ackType !== "interaction";
          let renderResult;
          if (shouldDeferGuiState) {
            // GUI state is latest-value data. Accept and acknowledge the
            // revision immediately, but keep expensive DOM/dialog/sampler/
            // waveform work off the PCM critical window. The release edge in
            // setPcmAudioPriority renders only the newest deferred state.
            deferredGuiState = normalizedState;
            deferredGuiRevision = acceptedRevision;
            guiDeferredCount += 1;
            guiLastDeferredRevision = revision;
            renderResult = "deferred";
          } else {
            renderResult = renderState(normalizedState, false, revision);
          }
          const renderFinishedAt = typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : Date.now();
          const renderTimeMs = Math.max(0, renderFinishedAt - renderStartedAt);
          const payloadBytes = Number.isSafeInteger(envelope._receiverWireBytes) ? envelope._receiverWireBytes : null;
          if (renderResult === false) {
            rejectGuiChannelMessage("render_failed", {
              revision: acceptedRevision,
            });
            writeCastDebug("warn", "Receiver failed to render GUI_STATE_UPDATE; revision remains replayable.");
            return;
          }
          // Release only the interaction revision this authoritative snapshot
          // confirms. Newer local drags remain pending and are not overwritten
          // by an older echoed value during render.
          confirmReceiverGuiInteraction(envelope.guiInteractionRevision);
          // Throttled renders still represent a valid accepted latest-value
          // state. Only a real render failure leaves the revision replayable.
          commitGuiRevision(envelope);
          guiReceivedCount += 1;
          guiLastReceivedRevision = revision;
          flushPendingReceiverGuiActions();
          // GUI state is latest-value control data. PCM owns the audio clock,
          // but it must not prevent the receiver from applying authenticated
          // controls, labels, dialogs, and interaction state.
          if (guiReceivedCount === 1 || guiReceivedCount % 20 === 0) {
            relayLogToStudio(
              "🖥️ Receiver GUI telemetry: received=" + guiReceivedCount +
              " revision=" + revision +
              " rendered=" + guiRenderedCount +
              " acknowledged=" + guiAckCount,
            );
          }
          emitGuiChannelTelemetry("received", { revision: acceptedRevision });
          if (renderResult === true) {
            guiRenderedCount += 1;
            guiLastRenderedRevision = acceptedRevision;
            emitGuiChannelTelemetry("rendered", { revision: acceptedRevision, renderTimeMs, payloadBytes });
          } else if (renderResult === "deferred") {
            emitGuiChannelTelemetry("deferred", { revision: acceptedRevision, payloadBytes });
          }
          guiLastRenderTimeMs = renderTimeMs;
          guiLastPayloadBytes = payloadBytes;
          lastMirroredState = normalizedState;
          if (envelope.patchType !== "volume_state") {
            guiRevisionStates.set(acceptedRevision, normalizedState);
            while (guiRevisionStates.size > 32) guiRevisionStates.delete(guiRevisionStates.keys().next().value);
          }
          if (guiControlWS && guiControlWS.readyState === WebSocket.OPEN) {
            try {
              let visualTelemetry = {};
              try {
                const visualProofDue = ackType !== "patch" || Date.now() - guiLastVisualProofAt >= 1000;
                if (renderResult !== "deferred" && visualProofDue) {
                  guiLastVisualProofAt = Date.now();
                  const waveformProofDue =
                    lastWaveformRenderStats.missing > 0 ||
                    Date.now() - guiLastWaveformProofAt >= GUI_WAVEFORM_PROOF_INTERVAL_MS;
                  const lastDialogRenderStats = studioDialogs?.getStats() || {};
                  visualTelemetry = {
                    mode: window._receiverCastMode || "D18A9B3A",
                    buildIdentity: { version: window.MXS_BUILD_IDENTITY?.version ?? null,
                      receiverHtml: window.MXS_BUILD_IDENTITY?.artifacts?.receiverHtml ?? null },
                    viewport: { innerWidth: Number(window.innerWidth) || null,
                      innerHeight: Number(window.innerHeight) || null,
                      screenWidth: Number(window.screen?.width) || null,
                      screenHeight: Number(window.screen?.height) || null,
                      devicePixelRatio: Number(window.devicePixelRatio) || null,
                      evidence: "browser_screen_api_not_physical_hdmi_proof" },
                    waveformExpected: lastWaveformRenderStats.expected,
                    waveformDrawn: lastWaveformRenderStats.drawn,
                    waveformMissing: lastWaveformRenderStats.missing,
                    waveformRenderTimeMs: Number.isFinite(Number(lastWaveformRenderStats.renderTimeMs))
                      ? Number(lastWaveformRenderStats.renderTimeMs)
                      : null,
                    waveformDataAvailable: lastWaveformRenderStats.dataAvailable,
                    waveformRenderPending: pendingWaveformState !== null,
                    waveformPendingRevision: pendingWaveformState !== null
                      ? pendingWaveformRevision
                      : null,
                    waveformRenderedRevision: lastWaveformRenderRevision,
                    waveformRenderRevision: lastWaveformRenderStats.guiRevision ?? -1,
                    ...(waveformProofDue ? { waveformSurfaces: lastWaveformRenderStats.surfaces } : {}),
                    dialogRenderMode: lastDialogRenderStats.mode,
                    dialogRenderTimeMs: lastDialogRenderStats.renderTimeMs,
                    dialogFirstPaintTimeMs: lastDialogRenderStats.firstPaintTimeMs ?? null,
                    dialogCount: lastDialogRenderStats.dialogCount,
                    dialogDomNodes: lastDialogRenderStats.domNodeCount,
                    ...(studioDialogs?.summarize() || {}),
                    renderPhases: lastGuiRenderPhaseStats,
                    ...summarizeLfoVisualState(normalizedState),
                    ...(captureLfoVisualProof(normalizedState) || {}),
                    ...summarizeMirroredButtonVisualState(normalizedState),
                    ...summarizeSamplerVisualLayout(),
                  };
                  // Validate optional evidence independently of the minimal ACK.
                  JSON.stringify(visualTelemetry);
                  if (waveformProofDue) guiLastWaveformProofAt = Date.now();
                }
              } catch (error) {
                visualTelemetry = {};
                if (renderResult !== "deferred") {
                  reportGuiAckError("optional_telemetry", error, {
                    revision: acceptedRevision,
                    messageType: envelope?.type || "GUI_STATE_UPDATE",
                    ackOutcome: "minimal_ack_retained",
                  });
                }
              }
              const receiverAckSentAtMonotonicMs = getLfoVisualNow();
              const receiverProcessingMs = Math.max(0, receiverAckSentAtMonotonicMs - messageStartedAt);
              const ackSent = sendReceiverBridgeMessage({
                type: "GUI_ACK",
                transport: "gui",
                guiProtocolVersion: CAST_GUI_PROTOCOL_VERSION,
                guiSessionNonce,
                ackType,
                channel: "gui",
                guiRevision: acceptedRevision,
                ...timelineAckDetails,
                receiverMessageStartedAtMonotonicMs: messageStartedAt,
                receiverAckSentAtMonotonicMs,
                senderMonotonicEstimateAtReceiverMessageStartMs:
                  mapReceiverToSenderMonotonic(messageStartedAt),
                senderMonotonicEstimateAtReceiverAckSentMs:
                  mapReceiverToSenderMonotonic(receiverAckSentAtMonotonicMs),
                senderMonotonicEstimateUncertaintyMs:
                  Number.isFinite(guiClockSyncEstimate?.uncertaintyMs)
                    ? guiClockSyncEstimate.uncertaintyMs
                    : null,
                guiInteractionRevision: Number(envelope.guiInteractionRevision ?? -1),
                rawCount: guiRawMessageCount,
                rejectedCount: guiRejectedCount,
                receivedCount: guiReceivedCount,
                renderedCount: guiRenderedCount,
                renderedRevision: guiLastRenderedRevision,
                renderResult,
                renderTimeMs,
                receiverProcessingMs,
                payloadBytes,
                ...visualTelemetry,
              }, "gui", true);
              if (!ackSent) throw new Error("GUI ACK socket write failed");
              guiAckCount += 1;
              guiLastAckRevision = revision;
              emitGuiChannelTelemetry("acknowledged", {
                revision: acceptedRevision,
                renderResult,
                renderTimeMs,
                payloadBytes,
                waveformDrawn: visualTelemetry.waveformDrawn ?? null,
                waveformMissing: visualTelemetry.waveformMissing ?? null,
              });
            } catch (error) {
              reportGuiAckError("send", error, {
                revision: acceptedRevision,
                messageType: envelope?.type || "GUI_STATE_UPDATE",
                guiSessionNonceMatches: envelope?.guiSessionNonce === guiSessionNonce,
                ackOutcome: "ack_send_failed",
              });
              try {
                emitGuiChannelTelemetry("ack_send_failed", {
                  revision: acceptedRevision,
                  messageType: envelope?.type || "GUI_STATE_UPDATE",
                  ackOutcome: "ack_send_failed",
                });
              } catch (_telemetryError) {}
            }
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
            if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return fallback;
            const number = Number(value);
            return Number.isFinite(number) ? number : fallback;
          };
          const nonnegative = (value) => {
            const number = finite(value, null);
            return number !== null && number >= 0 ? number : null;
          };
          const identity = (value) => {
            const number = nonnegative(value);
            return Number.isSafeInteger(number) ? number : null;
          };
          const transport = state.transport && typeof state.transport === "object"
            ? state.transport
            : {};
          const playbackEpoch = identity(transport.playbackEpoch);
          const playbackRevision = identity(transport.playbackRevision);
          const hasPlaybackIdentity = playbackEpoch !== null && playbackRevision !== null;
          const timeline = (raw) => raw && typeof raw === "object" && !Array.isArray(raw) ? {
            ...raw,
            positionSeconds: Math.max(0, finite(raw.positionSeconds)),
            durationSeconds: Math.max(0, finite(raw.durationSeconds)),
            playbackRate: Math.max(0.01, finite(raw.playbackRate, 1)),
            direction: finite(raw.direction, 1) < 0 ? -1 : 1,
            running: raw.running === true,
            loopEnabled: raw.loopEnabled === true,
            loopStartSeconds: Math.max(0, finite(raw.loopStartSeconds)),
            loopEndSeconds: Math.max(0, finite(raw.loopEndSeconds, finite(raw.durationSeconds))),
          } : null;
          const meters = (value) => ({
            l: Math.max(0, Math.min(1, finite(value?.l))),
            r: value?.r == null ? null : Math.max(0, Math.min(1, finite(value.r))),
          });
          const normalized = {
            ...state,
            guiContractVersion: Number(state.guiContractVersion) || 3,
            transport: {
              position: String(transport.position || "00:00:00"),
              formatterKind: typeof transport.formatterKind === "string" ? transport.formatterKind : null,
              captureSequence: identity(transport.captureSequence),
              capturedAtMs: nonnegative(transport.capturedAtMs),
              capturedAtMonotonicMs: nonnegative(transport.capturedAtMonotonicMs),
              captureTimestampClock: transport.captureTimestampClock === "sender_performance_ms"
                ? "sender_performance_ms" : null,
              visualClockMode: transport.visualClockMode === "idle_preview" || transport.visualClockMode === "audio_presentation"
                ? transport.visualClockMode : null,
              playbackEpoch: hasPlaybackIdentity ? playbackEpoch : null,
              playbackRevision: hasPlaybackIdentity ? playbackRevision : null,
              master: timeline(transport.master),
              capturedAtAudioSec: nonnegative(transport.capturedAtAudioSec),
              sourceAudioClock: transport.sourceAudioClock && typeof transport.sourceAudioClock === "object"
                ? transport.sourceAudioClock : null,
            },
            master: {
              ...state.master,
              volume: finite(state.master.volume),
              loopLength: Math.max(0, finite(state.master.loopLength, 4)),
              meters: meters(state.master.meters),
              timeline: timeline(state.master.timeline),
            },
            tracks: state.tracks.slice(0, 4).map((track, index) => ({
              ...track,
              index,
              fileName: String(track?.fileName || ""),
              meters: meters(track?.meters),
              buttons: track?.buttons && typeof track.buttons === "object" ? track.buttons : {},
              params: track?.params && typeof track.params === "object" ? track.params : {},
              timeline: timeline(track?.timeline),
            })),
            dialogs: Array.isArray(state.dialogs) ? state.dialogs : [],
            dialogRegistry: Array.isArray(state.dialogRegistry) ? state.dialogRegistry : [],
            qa: {
              revision: identity(state.qa.revision),
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
          desiredPlaybackState = "stopped";
          clearPlaybackRecoveryRetry();
          // STOP is a destructive boundary. Retaining a muted progressive
          // native item here lets the next Play inherit an unseekable/stale
          // live tail; Pause remains the reversible warm-stream operation.
          stopAllPlayout(d.reason || "playback_stop", undefined, false, false);
          acknowledgePlaybackRevision(d, "playback_stop");
        }

        function handlePlaybackPauseCommand(d) {
          if (!acceptPlaybackRevision(d, "PLAYBACK_PAUSE")) {
            return;
          }
          noteOrderedPlaybackAction("PLAYBACK_PAUSE");
          desiredPlaybackState = "paused";
          clearPlaybackRecoveryRetry();
          clearNativeOrderedResumeRecovery("playback_pause");
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
          if (
            d &&
            (d.type === "PLAYBACK_START" || d.type === "PLAYBACK_RESUME" || d.type === "PLAYBACK_PAUSE" || d.type === "PLAYBACK_STOP") &&
            !Number.isFinite(Number(d._receiverReceivedAtEpochMs))
          ) {
            d._receiverReceivedAtEpochMs = Date.now();
          }
          if (
            d &&
            (d.type === "PLAYBACK_START" || d.type === "PLAYBACK_RESUME" || d.type === "PLAYBACK_PAUSE" || d.type === "PLAYBACK_STOP") &&
            !Number.isFinite(Number(d._receiverReceivedAtMonotonicMs))
          ) {
            d._receiverReceivedAtMonotonicMs = getLfoVisualNow();
          }
          if (studioGuiActions?.handleResult(d)) return true;
          const rawGuiType = d && d.type;
          if (window.MXS_RECEIVER_BRANCH && !window.MXS_RECEIVER_BRANCH.gui && ["GUI_SNAPSHOT", "GUI_PATCH", "GUI_STATE_UPDATE", "GUI_STATE_PATCH", "CURSOR_UPDATE", "GUI_ACTION"].includes(rawGuiType)) return false;
          if (rawGuiType === "NATIVE_PRESENTATION_SPANS" || rawGuiType === "PCM_PRESENTATION_SPANS") {
            if (source === "GUI control WebSocket") acceptPresentationSpans(d);
            return true;
          }
          if (rawGuiType === "GUI_CLOCK_SYNC_PONG") {
            if (
              source !== "GUI control WebSocket" ||
              d.transport !== "gui" ||
              Number(d.guiProtocolVersion) !== CAST_GUI_PROTOCOL_VERSION ||
              d.guiSessionNonce !== guiSessionNonce
            ) {
              emitGuiChannelTelemetry("clock_sync_rejected", { reason: "invalid_pong_envelope" });
              return true;
            }
            acceptGuiClockSyncPong(d);
            return true;
          }
          if (rawGuiType === "GUI_SNAPSHOT") {
            d = { ...d, type: "GUI_STATE_UPDATE" };
          } else if (rawGuiType === "GUI_PATCH") {
            if (d.patchType === "live_state" || d.patchType === "volume_state") {
              d = { ...d, type: "GUI_STATE_PATCH" };
            } else {
              d = {
                ...d,
                type: "CURSOR_UPDATE",
                transport: "gui_cursor",
                cursor: d.cursor || d.patch?.cursor,
              };
            }
          }
          if (
            rawGuiType === "GUI_STATE_UPDATE" ||
            rawGuiType === "GUI_SNAPSHOT" ||
            (rawGuiType === "GUI_PATCH" && d.type === "GUI_STATE_PATCH")
          ) {
            guiRawMessageCount += 1;
            guiLastRawRevision = Number(d.guiRevision ?? -1);
            emitGuiChannelTelemetry("raw_received", {
              revision: guiLastRawRevision,
              messageType: rawGuiType,
              source: source || "unknown",
            });
          }
          const requiresAuthenticatedGui = [
            "GUI_STATE_UPDATE",
            "GUI_STATE_PATCH",
            "CURSOR_UPDATE",
          ].includes(d.type);
          const requiresAuthenticatedAudio = [
            "PLAYBACK_START",
            "PLAYBACK_RESUME",
            "PLAYBACK_STOP",
            "PLAYBACK_PAUSE",
            "PCM_RELAY",
            "RELOAD",
            "RECEIVER_SHUTDOWN",
            "PCM_V2_JITTER_TARGET",
            "BUILD_IDENTITY_REJECTED",
          ].includes(d.type);
          const guiIdentityReady = requiresAuthenticatedGui
            ? identityAllowsGui()
            : true;
          if (
            requiresAuthenticatedGui &&
            (!guiIdentityReady || !receiverBridgeConfigReady)
          ) {
            if (rawGuiType === "GUI_STATE_UPDATE" || rawGuiType === "GUI_SNAPSHOT" || rawGuiType === "GUI_PATCH") {
              emitGuiChannelTelemetry("blocked_not_ready", {
                revision: Number(d.guiRevision ?? -1),
                messageType: rawGuiType,
                guiIdentityReady,
                bridgeConfigReady: receiverBridgeConfigReady === true,
                guiSessionNonceMatches: d.guiSessionNonce === guiSessionNonce,
                ackOutcome: "not_sent_readiness_gate",
              });
            }
            relayLogToStudio(
              "⏸️ Receiver: Ignored " +
                d.type +
                " before verified GUI identity/config readiness.",
            );
            return true;
          }
          if (requiresAuthenticatedGui && d.guiSessionNonce !== guiSessionNonce) {
            rejectGuiChannelMessage("stale_gui_session", {
              revision: Number(d.guiRevision ?? -1),
            });
            return true;
          }
          if (
            requiresAuthenticatedAudio &&
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
          if (requiresAuthenticatedAudio && d.type !== "PCM_RELAY") {
            holdPlaybackControlGuiPriority(d.type.toLowerCase());
          }
          switch (d.type) {
            case "RECEIVER_SHUTDOWN":
              stopMirrorDiagnostics();
              shutdownReceiver(d.reason || "signal");
              return true;
            case "CAST_SESSION_HEARTBEAT":
              acknowledgeCastSessionHeartbeat(d, source);
              return true;
            case "GUI_STATE_UPDATE":
              if (
                d.transport !== "gui" ||
                Number(d.guiProtocolVersion) !== CAST_GUI_PROTOCOL_VERSION
              ) {
                rejectGuiChannelMessage("unsupported_protocol_envelope", {
                  revision: Number(d.guiRevision ?? -1),
                });
                writeCastDebug("warn", "Receiver rejected GUI_STATE_UPDATE with an unsupported protocol envelope.");
                return true;
              }
              handleGuiStateUpdateCommand(d.state, d);
              return true;
            case "GUI_STATE_PATCH": {
              if (
                d.transport !== "gui" ||
                Number(d.guiProtocolVersion) !== CAST_GUI_PROTOCOL_VERSION
              ) {
                rejectGuiChannelMessage("unsupported_protocol_envelope", {
                  revision: Number(d.guiRevision ?? -1),
                });
                writeCastDebug("warn", "Receiver rejected GUI_STATE_PATCH with an unsupported protocol envelope.");
                return true;
              }
              const explicitBase = d.patchType === "live_state" && Number.isSafeInteger(d.guiBaseRevision);
              const baseState = explicitBase ? guiRevisionStates.get(d.guiBaseRevision) : lastMirroredState;
              const mergedState = mergeGuiLivePatch(d.patch, baseState || null);
              if (!mergedState) {
                rejectGuiChannelMessage("missing_patch_base", {
                  revision: Number(d.guiRevision ?? -1),
                });
                writeCastDebug("warn", "Receiver rejected GUI_STATE_PATCH without a full snapshot base.");
                return true;
              }
              handleGuiStateUpdateCommand(mergedState, d, "patch");
              return true;
            }
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
            case "PLAYBACK_RESUME":
              handlePlaybackResumeCommand(d);
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


        function closeGuiControlBridge(reason) {
          if (guiControlReconnectTimer) {
            clearTimeout(guiControlReconnectTimer);
            guiControlReconnectTimer = null;
          }
          stopGuiClockSync();
          guiControlConnectionGeneration += 1;
          const socket = guiControlWS;
          guiControlWS = null;
          guiControlTargetKey = "";
          if (socket) {
            socket.onopen = null;
            socket.onmessage = null;
            socket.onclose = null;
            socket.onerror = null;
            try { socket.close(); } catch (_error) {}
          }
          if (reason) {
            sendReceiverBootDiagnostic("gui_control_channel_closed", { reason });
          }
        }

        function scheduleGuiControlReconnect() {
          if (
            window._receiverShutdownInProgress ||
            !binaryWS || binaryWS.readyState !== WebSocket.OPEN ||
            !currentBridgeIp || !currentBridgePort || !currentBridgeToken ||
            guiControlReconnectTimer
          ) return;
          guiControlReconnectTimer = setTimeout(() => {
            guiControlReconnectTimer = null;
            connectGuiControlBridge(currentBridgeIp, currentBridgePort, currentBridgeToken);
          }, 500);
        }

        function connectGuiControlBridge(ip, port, token) {
          if (window._receiverShutdownInProgress || !isValidBridgeCredential(token)) return false;
          const targetKey = `${ip}:${port}:${token}`;
          if (
            guiControlWS &&
            guiControlTargetKey === targetKey &&
            (guiControlWS.readyState === WebSocket.OPEN || guiControlWS.readyState === WebSocket.CONNECTING)
          ) return true;
          if (guiControlWS) closeGuiControlBridge("gui_control_target_changed");
          const generation = ++guiControlConnectionGeneration;
          const url = `ws://${ip}:${port}/?role=receiver&token=${encodeURIComponent(token)}&channel=gui`;
          let socket;
          try {
            socket = new WebSocket(url);
            guiControlWS = socket;
            guiControlTargetKey = targetKey;
          } catch (error) {
            relayLogToStudio("❌ Receiver: GUI/control WebSocket constructor failed: " + String(error?.message || error));
            scheduleGuiControlReconnect();
            return false;
          }
          socket.onopen = () => {
            if (generation !== guiControlConnectionGeneration || window._receiverShutdownInProgress) {
              try { socket.close(); } catch (_error) {}
              return;
            }
            flushReceiverGuiControlMessages();
            sendReceiverBootDiagnostic("gui_control_channel_open", {
              generation,
              mediaGeneration: binaryConnectionGeneration,
              socketGeneration: playbackModeSocketGeneration,
            });
            sendAuthenticatedGuiReady(window._receiverBootStage || "gui_control_connected");
            if (window._handshakeAcked && receiverBridgeConfigReady) {
              sendReceiverBridgeMessage({
                type: "RECEIVER_READY",
                castMode: RECEIVER_BRANCH.mode,
                guiSessionNonce,
                bridgeConfigRevision: receiverBridgeConfigRevision,
                reason: "gui_control_channel_connected",
                socketGeneration: playbackModeSocketGeneration,
                lifecycleGeneration: workletLifecycleGeneration,
              });
              startGuiClockSync();
            }
          };
          socket.onmessage = (event) => {
            if (generation !== guiControlConnectionGeneration || window._receiverShutdownInProgress) return;
            let data = null;
            try {
              data = safeReceiverJsonParse(event.data);
              if (!data || typeof data !== "object") return;
              data._receiverWireBytes = new TextEncoder().encode(event.data).byteLength;
              handleReceiverCommand(data, "GUI control WebSocket");
            } catch (error) {
              if (!(error instanceof SyntaxError)) {
                if (data && ["GUI_SNAPSHOT", "GUI_STATE_UPDATE", "GUI_PATCH"].includes(data.type)) {
                  reportGuiStateProcessingFailure(data, error, "GUI control WebSocket");
                }
                console.warn("Receiver GUI/control message handler error:", error);
              }
            }
          };
          socket.onerror = () => {
            if (generation !== guiControlConnectionGeneration) return;
            relayLogToStudio("⚠️ Receiver: GUI/control channel reported a transport error; media playout remains independent.");
          };
          socket.onclose = () => {
            if (generation !== guiControlConnectionGeneration) return;
            guiControlWS = null;
            stopGuiClockSync();
            lastGuiReadyNonce = null;
            relayLogToStudio("🔁 Receiver: GUI/control channel closed; keeping the selected media path active while reconnecting.");
            scheduleGuiControlReconnect();
          };
          return true;
        }

        function connectBinaryBridge(ip, customPort, customToken) {
          if (window._receiverShutdownInProgress) {
            return;
          }
          suppressBinaryReconnect = false;
          clearBinaryReconnectTimer();
          const targetPort = customPort || (window.SERVER_PORT && !window.SERVER_PORT.startsWith("{{") ? window.SERVER_PORT : "8080");
          const targetToken = customToken || currentBridgeToken ||
            injectedBridgeCredential("RECEIVER_TOKEN");
          if (!isValidBridgeCredential(targetToken)) {
            relayLogToStudio("⚠️ Receiver: Binary bridge connection deferred; receiver credential unavailable.");
            return;
          }
          if (!currentBridgeStreamToken) {
            currentBridgeStreamToken = injectedBridgeCredential("STREAM_TOKEN") || targetToken;
          }
          if (!currentBridgeLogToken) {
            currentBridgeLogToken = injectedBridgeCredential("LOG_TOKEN") || targetToken;
          }
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

          const url = `ws://${ip}:${targetPort}/?role=receiver&token=${encodeURIComponent(targetToken)}&channel=media`;
          try {
            relayLogToStudio(`📡 Receiver: Attempting to connect to ${redactBridgeUrl(url)}`);
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
            pendingGuiControlMessages.clear();
            pendingGuiControlActions = [];
            lastGuiReadyNonce = null;
            pcmV2Validator = null;
            pcmV2AllowInitialOffset = true;
            pcmV2Telemetry = createPcmV2Telemetry();
            playbackModeSocketGeneration++;
            const preserveAudioOwner =
              nativeStreamActive && activeAudioPathOwner === "native_caf";
            castAudioOwnerArbiter.begin(playbackModeSocketGeneration, "bridge_open", {
              preserveOwner: preserveAudioOwner,
            });
            if (!preserveAudioOwner && activeAudioPathOwner !== "none") {
              setActiveAudioPathOwner("none", "bridge_open_owner_reset");
            }
            resetGuiRevisionGate("bridge_open");
            guiSessionNonce = null;
            console.log("✅ Binary Bridge Connected");
            markReceiverBoot("bridge_connected", { url: redactBridgeUrl(url) });
            sendReceiverBootDiagnostic("bridge_connected", {
              generation,
              readyState: binaryWS.readyState,
              url: redactBridgeUrl(url),
            });
            connectGuiControlBridge(ip, targetPort, targetToken);
            relayLogToStudio(`✅ Receiver: WebSocket Connected to ${redactBridgeUrl(url)}`);
            if (window._receiverUiRevealed) {
              sendAuthenticatedGuiReady(window._receiverBootStage || "gui_revealed");
            }
            // [v13.9.504] Reset reconnect backoff counter on success
            window._wsReconnectAttempts = 0;
            // [v13.9.506] Reset stale bypass flag so fresh sessions don't carry old state
            window._nativeStreamBypassLogged = false;
            try {
              if (window._isFreshSession) {
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
            receiverBridgeConfigRevision = null;
            receiverHandshakeCommitSignature = null;
            receiverPlayoutAudibleSignature = null;
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
                castMode: RECEIVER_BRANCH.mode,
                playbackCommands: ["PLAYBACK_START", "PLAYBACK_PAUSE", "PLAYBACK_STOP", "PLAYBACK_RESUME"],
                config: {
                  sampleRate: rate,
                  bitDepth: 16,
                  maxChannels: 2,
                },
                buildIdentity: window.MXS_BUILD_IDENTITY,
              };
              try {
                sendReceiverBootDiagnostic("handshake_attempt", {
                  generation,
                  sampleRate: rate,
                  readyState: binaryWS.readyState,
                });
                binaryWS.send(JSON.stringify(handshake));
                sendReceiverBootDiagnostic("handshake_sent", {
                  generation,
                  sampleRate: rate,
                  readyState: binaryWS.readyState,
                });
                relayLogToStudio(`🤝 Receiver: Handshake sent → ${rate}Hz / 16-bit`);
              } catch (e) {
                sendReceiverBootDiagnostic("handshake_send_failed", {
                  generation,
                  sampleRate: rate,
                  error: e && e.message ? e.message : String(e),
                });
                relayLogToStudio(`⚠️ Receiver: Failed to send handshake: ${e.message}`);
              }
            }

            window._sendHandshake = sendHandshake;
            window._handshakeAcked = false;
            if (handshakeRetryInterval) {
              clearInterval(handshakeRetryInterval);
              handshakeRetryInterval = null;
            }
            sendHandshake();
            markReceiverBoot("handshake_sent", {
              sampleRate: (audioCtx && audioCtx.sampleRate) || window._hwRate || hwRate || 48000,
            });

            // Set up a retry interval in case the initial handshake is lost/dropped by sender
            const retryInterval = setInterval(() => {
              if (generation !== binaryConnectionGeneration || !binaryWS || binaryWS.readyState !== WebSocket.OPEN || window._handshakeAcked) {
                clearInterval(retryInterval);
                if (handshakeRetryInterval === retryInterval) handshakeRetryInterval = null;
                return;
              }
              relayLogToStudio("⏳ Receiver: Retrying Handshake (no ACK received yet)...");
              sendHandshake();
            }, 1500);
            handshakeRetryInterval = retryInterval;

            // Record that the receiver audio path is ready; low-latency PCM startup begins only
            // once the handshake/configuration path is ready.
            markReceiverPlayoutPathReady();
            if (nativeStreamActive) {
              // Only an actually active CAF path may reopen the ready gate.
              // A reconnect can observe nativeStreamStarting while CAF is
              // still buffering; publishing ready there makes the sender
              // release work to an inaudible path.
              notifyPlaybackMode("native", "socket_reconnected");
            } else if (nativeStreamStarting) {
              notifyPlaybackMode("native", "socket_reconnected_starting", false);
              notifyPlayoutSelecting("native_reconnect_starting", "socket_reconnected");
            } else if (workletNode && workletReady && window._binaryActive) {
              notifyPlaybackMode("pcm_fallback", "socket_reconnected");
            } else if (
              receiverPlayoutPreference === "pcm_fallback" &&
              !window._pcmDegraded
            ) {
              // No path owns output yet. Keep the receiver explicitly in an
              // ownerless selecting state while authenticated bridge config
              // preloads PCM. Advertising native here makes the PCM preload
              // guard reject its own standby initialization.
              notifyPlayoutSelecting("pcm_preload", "socket_reconnected");
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
                if (generation !== binaryConnectionGeneration) return;
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
              const d = safeReceiverJsonParse(event.data);
              if (!d || typeof d !== "object") {
                if (typeof event.data === "string" && event.data.length > 256 * 1024) {
                  relayLogToStudio("⚠️ Receiver: WebSocket text payload exceeded 256KB limit.");
                }
                return;
              }
              try {
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
                  if (handshakeRetryInterval) {
                    clearInterval(handshakeRetryInterval);
                    handshakeRetryInterval = null;
                  }
                  markReceiverBoot("handshake_ack", { sampleRate: ackRate, bitDepth: ackBitDepth });
                  maybeEnableReceiverHandshakeTelemetry();
                  sendReceiverHandshakeCommit("handshake_ack");
                  flushPendingPlayoutState();
                  logReceiverHardwareTelemetry(getCastReceiverContext());

                  // The receiver clears playout on a bridge reconnect. Tell the
                  // sender explicitly so it can replay the last ordered command
                  // (including an active PLAYBACK_START) without inventing a new
                  // playback revision.
                  if (window._receiverReadyGeneration !== playbackModeSocketGeneration) {
                    window._receiverReadyGeneration = playbackModeSocketGeneration;
                    try {
                      sendReceiverBridgeMessage({
                        type: "RECEIVER_READY",
                castMode: RECEIVER_BRANCH.mode,
                guiSessionNonce,
                bridgeConfigRevision: receiverBridgeConfigRevision,
                        socketGeneration: playbackModeSocketGeneration,
                        lifecycleGeneration: workletLifecycleGeneration,
                      });
                    } catch (e) {}
                  }

                  // HANDSHAKE_ACK authenticates the stopped-state PCM preload.
                  // Native CAF remains recovery-only after a real PCM failure.
                  if (
                    receiverPlayoutPreference === "pcm_fallback" &&
                    !nativeStreamStarting &&
                    !nativeStreamActive
                  ) {
                    preloadPcmWorklet("handshake_ack");
                  }
                } else if (d.type === "SCREEN_MIRROR_SIGNAL" || d.type === "offer" || d.type === "candidate") {
                  handleScreenMirrorSignal(d, function(reply) {
                    if (typeof cast !== "undefined" && cast.framework) {
                      try {
                        const ctx = getCastReceiverContext();
                        const senders = ctx?.getSenders ? ctx.getSenders() : [];
                        if (ctx && senders.length > 0) {
                          ctx.sendCustomMessage(CUSTOM_NAMESPACE, senders[0].id, reply);
                        }
                      } catch (_) {}
                    }
                    sendReceiverBridgeMessage(reply, "media");
                  });
                  return;
                } else if (d.type === "BRIDGE_CONFIG") {
                  sendReceiverBootDiagnostic("bridge_config_received", {
                    source: "websocket",
                    generation,
                    hasBuildIdentity: !!d.buildIdentity,
                    hasPcmProtocol: !!d.pcmProtocol,
                    hasGuiSessionNonce: typeof d.guiSessionNonce === "string",
                    hasEndpoint: !!(d.ip && d.port && d.token),
                    networkEpoch: Number(d.networkEpoch) || 0,
                  });
                  if (!acceptBuildIdentity(d.buildIdentity, "bridge_config")) {
                    return;
                  }
                  if (window.MXS_RECEIVER_BRANCH && window.MXS_RECEIVER_BRANCH.mode !== (d.castMode || "D18A9B3A")) return;
                  window._receiverCastMode = d.castMode || "D18A9B3A";
                  if (window._receiverCastMode === "MIRROR_CAST") activatePureScreenMirrorViewport();
                  if (d.pcmProtocol && !acceptPcmV2ProtocolConfig(d.pcmProtocol, "websocket")) {
                    return;
                  }
                  if (!acceptBridgeNetworkEpoch(d.networkEpoch, "websocket")) {
                    return;
                  }
                  if (!acceptBridgeCredentials(d, "websocket")) {
                    return;
                  }
                  if (typeof d.guiSessionNonce !== "string" || d.guiSessionNonce.length < 8 || d.guiSessionNonce.length > 128) {
                    relayLogToStudio("⚠️ Receiver: BRIDGE_CONFIG missing a valid GUI session nonce.");
                    return;
                  }
                  if (d.castMode === "MIRROR_CAST") {
                    relayLogToStudio("🪞 Receiver: Activating in-place Screen Mirror viewport with lossless audio bridge...");
                    activatePureScreenMirrorViewport();
                  }
                  applyReceiverBridgeConfig(d, "websocket", {
                    announceGuiReady: true,
                    markPathReady: false,
                  });
                  connectGuiControlBridge(
                    d.ip || currentBridgeIp,
                    Number(d.port) || currentBridgePort,
                    d.token || currentBridgeToken,
                  );
                  // Proactive fallback: If we haven't received HANDSHAKE_ACK yet, resend HANDSHAKE.
                  if (!window._handshakeAcked && typeof window._sendHandshake === "function") {
                    window._sendHandshake();
                  }
                  if (d.ip) {
                    markReceiverPlayoutPathReady();
                    // Preload the primary PCM worklet as soon as the
                    // authenticated bridge advertises its LAN endpoint. It
                    // remains ownerless until ordered Play claims the path.
                    // Do not disrupt active PCM fallback playout on periodic bridge refresh.
                    if (
                      receiverPlayoutPreference === "pcm_fallback" &&
                      !workletReady &&
                      !window._binaryActive &&
                      !pcmPathOwnsAudio() &&
                      activeAudioPathOwner !== "pcm_v2"
                    ) {
                      preloadPcmWorklet("websocket_open");
                    }
                  }
                } else {
                  handleReceiverCommand(d, "binary bridge");
                }
              } catch (e) {
                if (
                  d && (
                    d.type === "GUI_STATE_UPDATE" ||
                    d.type === "GUI_SNAPSHOT" ||
                    (d.type === "GUI_PATCH" &&
                      (d.patchType === "live_state" || d.patchType === "volume_state"))
                  )
                ) {
                  reportGuiStateProcessingFailure(d, e, "binary bridge");
                }
              }
            }
          };

          binaryWS.onclose = (event) => {
            if (generation !== binaryConnectionGeneration) return;
            closeGuiControlBridge("media_websocket_closed");
            const closeDetails = {
              generation,
              code: Number.isFinite(Number(event?.code)) ? Number(event.code) : null,
              reason: typeof event?.reason === "string" ? event.reason.slice(0, 256) : "",
              wasClean: event?.wasClean === true,
              readyState: binaryWS ? binaryWS.readyState : null,
              handshakeAcked: window._handshakeAcked === true,
              bridgeConfigReady: receiverBridgeConfigReady === true,
            };
            console.warn("🛑 Receiver: Binary bridge closed", closeDetails);
            sendReceiverBootDiagnostic("bridge_closed", closeDetails);
            if (handshakeRetryInterval) {
              clearInterval(handshakeRetryInterval);
              handshakeRetryInterval = null;
            }
            buildIdentityAccepted = false;
            window._buildIdentityAccepted = false;
            receiverHandshakeTelemetryReady = false;
            receiverBridgeConfigReady = false;
            receiverPlayoutAudibleSignature = null;
            clearLowLatencyStartupWatchdog();
            window._binaryActive = false;
            configReceived = false;
            playoutPathLogged = false;
            pendingBinaryFrames = [];
            workletReady = false;
            window._isDrainingStartup = false;
            // A bridge close creates a new control generation. Allow the
            // sender's same-revision RECEIVER_READY replay to re-arm control,
            // while equal revisions remain suppressed during one connection.
            resetPlaybackRevisionGate("bridge_closed");
            resetGuiRevisionGate("bridge_closed");
            lastGuiReadyNonce = null;
            const reconnectPlaybackActive = Boolean(
              lastPlaybackStartSignalAt && !playbackPaused
            );
            const preserveLiveNative =
              reconnectPlaybackActive && nativeStreamActive;
            const preserveNativeReplay =
              reconnectPlaybackActive &&
              (nativeStreamActive || nativeStreamStarting);
            if (preserveLiveNative) {
              // The native progressive-WAV request is independent from the
              // control WebSocket. Keep its CAF media clock and audible item
              // untouched through a transient bridge reconnect; reopening or
              // muting it here causes the exact cast-audio cancellation this
              // reconnect path is meant to recover from.
              resetBinaryPlayoutState("websocket_closed_native_continuity");
              setPcmAudioPriority(false, "websocket_closed_native_continuity");
              relayLogToStudio(
                "🔁 Receiver: Native CAF remained live across control bridge reconnect.",
              );
            } else {
              stopAllPlayout(
                "websocket_closed",
                undefined,
                false,
                preserveNativeReplay,
                reconnectPlaybackActive,
              );
            }
            if (reconnectPlaybackActive && !preserveNativeReplay) {
              relayLogToStudio(
                "🔁 Receiver: Active PLAYBACK_START intent retained across bridge reconnect; awaiting ordered replay.",
              );
            }
            if (workletNode) {
              try {
                workletNode.port.postMessage({ type: "RESET", playbackEpoch: lastPlaybackEpoch, playbackRevision: lastPlaybackRevision });
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
            sendReceiverBootDiagnostic("bridge_error", {
              generation,
              eventType: e && e.type ? e.type : "error",
              message: e && e.message ? e.message : null,
              readyState: binaryWS ? binaryWS.readyState : null,
            });
            console.error("❌ Binary Bridge Error:", e);
            relayLogToStudio(`❌ Receiver: WebSocket Error on ${url}`);
            // Reconnection is managed exclusively by binaryWS.onclose with exponential backoff
          };
        }

        async function connectLocalReceiverWithBootstrap(hostname) {
          const bootstrapToken = LOCAL_BOOTSTRAP_TOKEN;
          if (!isValidBridgeCredential(bootstrapToken)) return false;

          const endpoint = new URL("/receiver/bootstrap", window.location.href);
          try {
            const response = await fetch(endpoint.toString(), {
              method: "POST",
              cache: "no-store",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token: bootstrapToken }),
            });
            if (!response.ok) throw new Error("bootstrap_rejected_" + response.status);
            const credentials = await response.json();
            if (!acceptBridgeCredentials(credentials, "local_bootstrap")) {
              throw new Error("bootstrap_credentials_invalid");
            }
            connectBinaryBridge(hostname, window.SERVER_PORT, credentials.token);
            return true;
          } catch (error) {
            relayLogToStudio("❌ Receiver: Local bridge bootstrap failed: " + String(error));
            return false;
          }
        }

        const mirrorRuntime = window.MXSCreateMirrorReceiver && (!RECEIVER_BRANCH || RECEIVER_BRANCH.mirror)
          ? window.MXSCreateMirrorReceiver({
          get guiSessionNonce() { return guiSessionNonce; },
          get activeAudioPathOwner() { return activeAudioPathOwner; },
          get nativeStreamActive() { return nativeStreamActive; },
          get nativeStreamPaused() { return nativeStreamPaused; },
          get lastPlaybackEpoch() { return lastPlaybackEpoch; },
          get lastPlaybackRevision() { return lastPlaybackRevision; },
          get receiverPlayoutPreference() { return receiverPlayoutPreference; },
          get audioCtx() { return audioCtx; },
          get receiverBridgeConfigReady() { return receiverBridgeConfigReady; },
          get PCM_RUNTIME_QUALIFICATION_KEY() { return PCM_RUNTIME_QUALIFICATION_KEY; },
          get CAST_GUI_PROTOCOL_VERSION() { return CAST_GUI_PROTOCOL_VERSION; },
          get RECEIVER_BRANCH() { return RECEIVER_BRANCH; },
          getLfoVisualNow, sendReceiverBridgeMessage, readNativeResumeMediaState, relayLogToStudio, identityAllowsGui
        }) : null;
        function activatePureScreenMirrorViewport() { mirrorRuntime?.activatePureScreenMirrorViewport(); }
        function stopMirrorDiagnostics() { mirrorRuntime?.stopMirrorDiagnostics(); }
        function handleScreenMirrorSignal(data, replyFn) { return mirrorRuntime?.handleScreenMirrorSignal(data, replyFn); }

        function handleInboundData(data) {
          if (window._receiverShutdownInProgress) return;
          try {
            const d = parseCastPayload(data);
            if (!d) return;

            if (d.type === "SCREEN_MIRROR_SIGNAL" || d.type === "offer" || d.type === "candidate") {
              if (!identityAllowsGui() || !receiverBridgeConfigReady || !window._handshakeAcked) return;
              handleScreenMirrorSignal(d, function(reply) {
                if (typeof cast !== "undefined" && cast.framework) {
                  try {
                    const ctx = getCastReceiverContext();
                    const senders = ctx?.getSenders ? ctx.getSenders() : [];
                    if (ctx && senders.length > 0) {
                      ctx.sendCustomMessage(CUSTOM_NAMESPACE, senders[0].id, reply);
                    }
                  } catch (_) {}
                }
                sendReceiverBridgeMessage(reply, "media");
              });
              return;
            }

            // 1. Hardware Alignment
            if (d.type === "BRIDGE_CONFIG") {
              sendReceiverBootDiagnostic("bridge_config_received", {
                source: "cast_channel",
                hasBuildIdentity: !!d.buildIdentity,
                hasPcmProtocol: !!d.pcmProtocol,
                hasGuiSessionNonce: typeof d.guiSessionNonce === "string",
                hasEndpoint: !!(d.ip && d.port && d.token),
                networkEpoch: Number(d.networkEpoch) || 0,
              });
              if (LOCAL_BOOTSTRAP_TOKEN) return;
              if (!acceptBuildIdentity(d.buildIdentity, "cast_bridge_config")) return;
              if (window.MXS_RECEIVER_BRANCH && window.MXS_RECEIVER_BRANCH.mode !== (d.castMode || "D18A9B3A")) return;
                  window._receiverCastMode = d.castMode || "D18A9B3A";
              if (window._receiverCastMode === "MIRROR_CAST") activatePureScreenMirrorViewport();
              if (!acceptBridgeCredentials(d, "cast_control")) return;
              if (
                d.pcmProtocol &&
                !acceptPcmV2ProtocolConfig(d.pcmProtocol, "cast_control")
              ) {
                return;
              }
              if (!acceptBridgeNetworkEpoch(d.networkEpoch, "cast_control")) {
                return;
              }
              if (typeof d.guiSessionNonce !== "string" || d.guiSessionNonce.length < 8 || d.guiSessionNonce.length > 128) {
                relayLogToStudio("⚠️ Receiver: Cast BRIDGE_CONFIG missing a valid GUI session nonce.");
                return;
              }
              const applied = applyReceiverBridgeConfig(d, "cast_control", {
                announceGuiReady: false,
              });
              if (applied && d.ip) {
                if (d.castMode === "MIRROR_CAST" && identityAllowsGui()) activatePureScreenMirrorViewport();
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
        window.addEventListener("error", function (event) {
          const message = event && event.message ? String(event.message).slice(0, 512) : "window_error";
          const filename = event && event.filename ? String(event.filename).slice(-256) : null;
          const opaque = !filename && !event?.error && /^\s*Script error\.?\s*$/i.test(message);
          sendReceiverBootDiagnostic("runtime_error", {
            message,
            filename,
            line: Number.isFinite(Number(event?.lineno)) ? Number(event.lineno) : null,
            column: Number.isFinite(Number(event?.colno)) ? Number(event.colno) : null,
            sourceResolution: opaque ? "browser_opaque" : "available",
            errorName: String(event?.error?.name || "Error").slice(0, 48),
          });
        });
        window.addEventListener("unhandledrejection", function (event) {
          const reason = event && event.reason;
          sendReceiverBootDiagnostic("unhandled_rejection", {
            message: reason && reason.message
              ? String(reason.message).slice(0, 512)
              : String(reason || "unhandled_rejection").slice(0, 512),
          });
        });
        window.onload = function () {
          // Preserve the known-good receiver order: construct the complete
          // static/dynamic GUI first, then start the native latency monitor.
          // New GUI telemetry and bindings are deliberately layered after
          // those original startup steps.
          if (!RECEIVER_BRANCH || RECEIVER_BRANCH.gui) buildGUI();
          else activatePureScreenMirrorViewport();
          startNativeLatencyMonitor();
          if (!RECEIVER_BRANCH || RECEIVER_BRANCH.gui) prepareReceiverUi();
          markReceiverBoot("window_loaded");

          // [V13.9.40] Aggressive Startup Trace
          console.log("🎬 Receiver: Startup sequence initiated.");
          const receiverPageUrl = window.location.origin + window.location.pathname;
          console.log("🔗 URL: " + receiverPageUrl);

          if (typeof cast !== "undefined" && cast.framework) {
            try {
              const context = getCastReceiverContext();
              if (!context) {
                throw new Error("CastReceiverContext unavailable");
              }

              relayLogToStudio("🎬 Receiver: Startup - URL: " + receiverPageUrl);

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
                  stopMirrorDiagnostics();
                  buildIdentityAccepted = false;
                  window._buildIdentityAccepted = false;
                  playoutPathLogged = false;
                  window._binaryActive = false;
                  window._lastBinaryTime = 0;
                  window._playbackMode = "unknown";
                  stopNativeStreamPlayout("sender_disconnected");
                  setActiveAudioPathOwner("none", "sender_disconnected");
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

              [CUSTOM_NAMESPACE, "urn:x-cast:com.nowmultimedia.mxs.mirror"].forEach((ns) => {
                context.addCustomMessageListener(ns, (event) => {
                  if (window._receiverShutdownInProgress) return;
                  if (event.data) {
                    const msgData = parseCastPayload(event.data);
                    handleInboundData(msgData);
                  }
                });
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
              const supportedCommands =
                (Number(cast.framework.messages?.Command?.PAUSE) || 0) |
                (Number(cast.framework.messages?.Command?.STREAM_VOLUME) || 0) |
                (Number(cast.framework.messages?.Command?.STREAM_MUTE) || 0);
              options.supportedCommands = supportedCommands;
              options.enforceSupportedCommands = true;
              options.disableIdleTimeout = true;
              relayLogToStudio("✅ Receiver: CAF remote command policy enforced (PAUSE/VOLUME/MUTE only).");
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
                void connectLocalReceiverWithBootstrap(hostname).then((connected) => {
                  if (!connected) relayLogToStudio("❌ Receiver: No authorized local bridge connection was established.");
                });
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
              const isWorkletStalled =
                workletNode &&
                !playbackPaused &&
                activeAudioPathOwner === "pcm_v2" &&
                (!window._lastWorkletDiagTime || now - window._lastWorkletDiagTime > 4000);

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
          const tryResumeOnInteraction = function() {
            if (!audioCtx || audioCtx.state !== "running") {
              resumeAudio();
            }
          };

          window.addEventListener("keydown", tryResumeOnInteraction, { passive: true });
          window.addEventListener("click", tryResumeOnInteraction, { passive: true });
          window.addEventListener("pointerdown", tryResumeOnInteraction, { passive: true });

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

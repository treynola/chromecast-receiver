

      window.SERVER_PORT = "{{SERVER_PORT}}";
      window.SECURITY_TOKEN = "{{SECURITY_TOKEN}}";

      // [v13.9.505] AUTO CACHE-BUST: If no ?cb= param, redirect to self with one.
      // Fires exactly once per cast session — no loop because redirect URL already has cb=.
      (function () {
        if (window.location.search.indexOf('cb=') === -1) {
          try {
            localStorage.removeItem("mxs_pcm_degraded");
          } catch (e) {}
          var freshUrl = window.location.href.split('?')[0] + '?cb=' + Date.now();
          window.location.replace(freshUrl);
          // Execution stops here — the browser navigates away immediately.
        }
      })();

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
        window._buildIdentityAccepted = false;
        const PENDING_BINARY_FRAMES_MAX = 256; // Emergency startup guard, never routine queue control.
        const VERSION_TAG = "v13.9.509-APORv2";
        const CUSTOM_NAMESPACE = "urn:x-cast:com.nowmultimedia.mxs004";
        const ENABLE_NATIVE_STREAM_PLAYOUT = true;
        var nativeStreamActive = false;
        var nativeStreamStarting = false;
        var nativeStreamUrl = "";
        var nativeStreamPaused = false;
        var playbackPaused = false;
        var nativeStartupAttemptId = 0;
        var nativeStreamReloadTimerId = null;
        var nativeStartupTrimPending = false;
        var nativeStartupWatchdogId = null;
        var lowLatencyStartupWatchdogId = null;
        var pcmStartupRetryTimerId = null;
        const NATIVE_STARTUP_TIMEOUT_MS = 5000;
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
        const NATIVE_STARTUP_TARGET_SEC = 0.35;
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
        // Playback commands can arrive twice because the sender deliberately
        // mirrors control messages over both the Cast namespace and the bridge
        // WebSocket. Keep command and GUI-state ordering separate: equal
        // command revisions are duplicates, while equal STATE_UPDATE revisions
        // can contain legitimate GUI changes.
        var lastPlaybackEpoch = -1;
        var lastPlaybackRevision = -1;
        var allowSamePlaybackRevisionReplay = false;
        var lastStateEpoch = -1;
        var lastStateRevision = -1;
        var lastStateAckKey = "";
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
            sessionStarts: 0,
            sessionChanges: 0,
            baselineSequence: null,
            baselineSourceFrame: null,
          };
        }

        var pcmV2Telemetry = createPcmV2Telemetry();
        var playbackModeLastSentGeneration = -1;
        var playbackModeLastSent = "";
        var lastPlaybackStartSignalAt = 0;
        var receiverStartupTimingStartAt = Date.now();
        var receiverStartupTimingMarks = {};
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
          relayLogToStudio(
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
            relayLogToStudio(
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
        window._receiverPlayoutPreference = receiverPlayoutPreference;

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
          relayLogToStudio(
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
          relayLogToStudio("📟 Receiver: Hardware telemetry snapshot begin.");
          relayLogToStudio(
            "📟 Receiver Hardware Capabilities: " +
              formatTelemetryValue(summarizeTelemetryValue(telemetry.capabilities)),
          );
          relayLogToStudio(
            "📟 Receiver Device Information: " +
              formatTelemetryValue(summarizeTelemetryValue(telemetry.deviceInformation)),
          );
          relayLogToStudio(
            "📟 Receiver Media Support Matrix: " +
              formatTelemetryValue(summarizeTelemetryValue(telemetry.mediaSupport)),
          );
          relayLogToStudio(
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
                relayLogToStudio("⚠️ Receiver: Hardware telemetry unavailable after startup retries.");
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
                  logReceiverHardwareTelemetry(context);
                } catch (e) {}
              });
            }
            castDebugLoggerConfigured = true;
          } catch (e) {
            console.warn("⚠️ Receiver: CastDebugLogger setup failed:", e);
          }
        }

        function revealReceiverUi(reason) {
          if (!document.body || window._receiverUiRevealed) {
            return;
          }
          window._receiverUiRevealed = true;
          document.body.classList.remove("app-loading");
          relayLogToStudio(
            "✅ Receiver: Receiver UI revealed (app-loading removed" +
              (reason ? " / " + reason : "") +
              ").",
          );
        }

        function notifyPlaybackMode(mode, reason) {
          if (!mode) {
            return;
          }
          const duplicateOnCurrentSocket =
            window._playbackMode === mode &&
            playbackModeLastSent === mode &&
            playbackModeLastSentGeneration === playbackModeSocketGeneration;
          window._playbackMode = mode;
          if (!binaryWS || binaryWS.readyState !== WebSocket.OPEN) {
            return;
          }
          if (duplicateOnCurrentSocket) {
            return;
          }
          try {
            const readiness = {
              mode: mode,
              reason: reason || "",
              ready: true,
              lifecycleGeneration: workletLifecycleGeneration,
            };
            binaryWS.send(JSON.stringify({ type: "PLAYBACK_MODE", ...readiness }));
            binaryWS.send(JSON.stringify({
              type: "PLAYOUT_STATE",
              state: "ready",
              ...readiness,
            }));
            playbackModeLastSent = mode;
            playbackModeLastSentGeneration = playbackModeSocketGeneration;
          } catch (e) {}
        }

        function notifyPlayoutSelecting(stage, reason) {
          if (!binaryWS || binaryWS.readyState !== WebSocket.OPEN) return;
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
          relayLogToStudio("AUDIO_WORKLET_CAPABILITY " + JSON.stringify(result));
          if (binaryWS && binaryWS.readyState === WebSocket.OPEN) {
            try {
              binaryWS.send(JSON.stringify({ type: "AUDIO_WORKLET_CAPABILITY", ...result }));
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
          const probeHash = window.MXS_BUILD_IDENTITY &&
            window.MXS_BUILD_IDENTITY.components &&
            window.MXS_BUILD_IDENTITY.components.receiverLogic
              ? window.MXS_BUILD_IDENTITY.components.receiverLogic.slice(0, 16)
              : Date.now();
          const probeUrl = new URL(
            "pcm-capability-probe.js?v=" + probeHash,
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
          if (workletNode) {
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

        function maybeStartNativeStream(reason, allowPriming = false) {
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
          if (receiverPlayoutPreference === "pcm_fallback" && !window._pcmDegraded) {
            return false;
          }
          if (nativeStreamActive || nativeStreamStarting) {
            return true;
          }
          if (!configReceived || !currentBridgeIp) {
            return false;
          }
          if (workletNode || audioInitializing || window._binaryActive) {
            resetBinaryPlayoutState("native_takeover");
          }
          if (reason) {
            relayLogToStudio(
              (allowPriming ? "⏱️ Receiver: Priming" : "▶️ Receiver: Starting") +
                " native stream on " + reason + ".",
            );
          }
          return startNativeStreamPlayout(currentBridgeIp, currentBridgePort);
        }

        function markPlaybackStartSignal() {
          lastPcmQueueResetAt = 0;
          // Every ordered PLAYBACK_START reopens the short stale-inactive-state
          // grace window. This matters for rapid stop/play and reconnect replay.
          lastPlaybackStartSignalAt = Date.now();
        }

        function resetPlaybackRevisionGate(reason) {
          // Keep the last command as the replay anchor. A bridge reconnect
          // needs to accept that exact command once, but must continue to
          // reject delayed commands from before it.
          allowSamePlaybackRevisionReplay = lastPlaybackEpoch >= 0;
          lastStateEpoch = -1;
          lastStateRevision = -1;
          lastStateAckKey = "";
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
          const isStateUpdate = source === "STATE_UPDATE";
          const previousEpoch = isStateUpdate ? lastStateEpoch : lastPlaybackEpoch;
          const previousRevision = isStateUpdate ? lastStateRevision : lastPlaybackRevision;
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
          if (!isStateUpdate && epoch === lastPlaybackEpoch && revision === lastPlaybackRevision) {
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
          if (isStateUpdate) {
            // A state snapshot with the same playback revision is still valid:
            // effect, meter, and GUI fields may have changed without a new
            // transport command.
            if (isRevisionOlder(epoch, revision, lastPlaybackEpoch, lastPlaybackRevision)) {
              relayLogToStudio(
                "⏭️ Receiver: Ignored state behind the latest playback command " +
                  "epoch=" + epoch + " revision=" + revision + ".",
              );
              return false;
            }
            lastStateEpoch = epoch;
            lastStateRevision = revision;
          } else {
            lastPlaybackEpoch = epoch;
            lastPlaybackRevision = revision;
            allowSamePlaybackRevisionReplay = false;
          }
          return true;
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
          // STATE_UPDATE arrives on the 10 Hz mirror cadence. One ACK per
          // revision/action is sufficient; repeating the same ACK for every
          // GUI snapshot only creates control-channel churn and competes with
          // the actual playback commands.
          if (ackAction === "state_update" || ackAction === "state_update_paused") {
            const stateAckKey = ackAction + ":" + playbackEpoch + ":" + playbackRevision;
            if (stateAckKey === lastStateAckKey) {
              return;
            }
            lastStateAckKey = stateAckKey;
          }
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

            if (nativeStartupTrimPending) {
              nativeStartupTrimPending = false;
              if (latency > NATIVE_STARTUP_TRIM_THRESHOLD_SEC) {
                try {
                  const bufferedStart = activeAudio.buffered.start(activeAudio.buffered.length - 1);
                  const trimTarget = Math.max(
                    bufferedStart,
                    liveEdge - NATIVE_STARTUP_TARGET_SEC,
                  );
                  if (trimTarget > playhead + 0.25) {
                    activeAudio.currentTime = trimTarget;
                    latency = Math.max(0, liveEdge - trimTarget);
                    relayLogToStudio(
                      "✂️ Receiver: Fresh native stream buffer released; playhead aligned to " +
                        latency.toFixed(3) +
                        "s from live edge.",
                    );
                  }
                } catch (trimError) {
                  relayLogToStudio(
                    "⚠️ Receiver: Fresh native stream buffer reset failed: " +
                      (trimError && trimError.message ? trimError.message : trimError),
                  );
                }
              }
            }

            if (binaryWS && binaryWS.readyState === WebSocket.OPEN) {
              binaryWS.send(
                JSON.stringify({
                  type: "NATIVE_LATENCY_REPORT",
                  latency: latency,
                }),
              );
            }
          }, 500);
        }

        function clearPlaybackStartSignal() {
          lastPlaybackStartSignalAt = 0;
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
            // active playout path warm, while STOP remains the destructive
            // boundary for both CAF and PCM.
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
                  activateNativeStream(
                    "caf_playing",
                    "✅ Receiver: CAF native LAN stream PLAYING via /stream.wav.",
                    nativeStartupAttemptId,
                  );
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

        function degradePcmStartupToNative(reason) {
          if (window._receiverShutdownInProgress || nativeStreamActive || nativeStreamStarting) {
            return false;
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
          pendingBinaryFrames = [];
          if (!lastPlaybackStartSignalAt) {
            relayLogToStudio(
              "🛡️ Receiver: Priming native /stream.wav before PLAYBACK_START.",
            );
            return maybeStartNativeStream(reason || "pcm_startup_degraded", true);
          }
          return maybeStartNativeStream(reason || "pcm_startup_degraded");
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
            relayLogToStudio("⚠️ Receiver: Native stream startup timed out; switching to PCM fallback.");
            stopNativeStreamPlayout("startup_timeout");
            setReceiverPlayoutPreference("pcm_fallback", "native_startup_timeout");
            if (configReceived) {
              initAudio(true, false);
            }
          }, NATIVE_STARTUP_TIMEOUT_MS);
          return true;
        }

        function activateNativeStream(modeReason, logMessage, attemptId) {
          if (attemptId && !isCurrentNativeAttempt(attemptId)) {
            return false;
          }
          nativeStreamStarting = false;
          nativeStreamActive = true;
          nativeStreamPaused = false;
          window._nativeStreamActive = true;
          clearNativeStartupWatchdog();
          logReceiverStartupTiming("receiver_ready", {
            modeReason: modeReason || "",
            nativeStreamActive: true,
            nativeStreamStarting: false,
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

        function stopNativeStreamPlayout(reason) {
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
          clearPlaybackStartSignal();
          clearNativeStartupWatchdog();
          clearLowLatencyStartupWatchdog();
          nativeStreamStarting = false;
          nativeStreamActive = false;
          nativeStreamPaused = false;
          nativeStreamUrl = "";
          window._nativeStreamActive = false;
          window._playbackMode = "unknown";
          try {
            window._pcmDegraded = localStorage.getItem("mxs_pcm_degraded") === "true";
          } catch (e) {
            window._pcmDegraded = false;
          }
          playbackModeLastSent = "";
          playbackModeLastSentGeneration = -1;
          stopCafNativeCompanion();
          stopHtmlAudioNativeCompanion();
          
          const htmlAudio = document.getElementById("native-stream-audio");
          const cafAudio = document.getElementById("cast-media-element");
          [htmlAudio, cafAudio].forEach(function resetNativeElement(element) {
            if (!element) return;
            try {
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
          try {
            if (cafAudio && typeof cafAudio.play === "function") {
              const result = cafAudio.play();
              if (result && typeof result.catch === "function") result.catch(() => {});
            }
          } catch (e) {}
          try {
            if (htmlAudio && typeof htmlAudio.play === "function") {
              const result = htmlAudio.play();
              if (result && typeof result.catch === "function") result.catch(() => {});
            }
          } catch (e) {}
          relayLogToStudio("▶️ Receiver: Native output unmuted at the live edge (" + (reason || "playback_start") + ").");
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

        function stopAllPlayout(reason, statusState, fromPlayerManager) {
          playbackPaused = false;
          const stopReason = String(reason || "playback_stop");
          clearPlaybackStartSignal();
          resetBinaryPlayoutState(stopReason);
          stopNativeStreamPlayout(stopReason);
          publishMxsPlaybackStatus(statusState || "STOPPED", stopReason);
        }

        function pauseAllPlayout(reason) {
          playbackPaused = true;
          clearLowLatencyStartupWatchdog();
          clearPcmStartupRetryTimer();

          // Pause is reversible for every active playout path. Native CAF
          // keeps the loaded progressive-WAV item, so resume does not issue a
          // new LOAD or reopen /stream.wav. PCM keeps its AudioWorklet and
          // resets only the queued frames, preventing stale audio without
          // paying module/context startup cost on the next Play.
          if (pauseNativeStreamPlayout(reason || "playback_pause", true)) {
            relayLogToStudio(
              "⏸️ Receiver: Playback paused; native CAF media item preserved.",
            );
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
          stopNativeStreamPlayout(reason || "playback_idle");
          if (workletNode) {
            notifyPlaybackMode("pcm_fallback", (reason || "playback_idle") + "_pcm_ready");
          }
          if (reason && !duplicateReset) {
            relayLogToStudio("🛑 Receiver: Binary playout reset, PCM bridge kept ready (" + reason + ").");
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
            // STATE_UPDATE will retry the native path while playback remains
            // active. Never pay another known-dead AudioWorklet cycle.
            setReceiverPlayoutPreference(
              "native",
              failureReason + "_pcm_known_unavailable",
            );
            notifyPlayoutSelecting(
              "native_stream",
              failureReason + "_native_retry",
            );
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
              activateNativeStream(
                "html_audio_playing",
                "✅ Receiver: HTML audio stream fallback playing via /stream.wav.",
                attemptId,
              );
            };
            nativeAudio.pause();
            nativeAudio.muted = false;
            nativeAudio.loop = false;
            nativeAudio.preload = "auto";
            nativeAudio.crossOrigin = "anonymous";
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
              activateNativeStream(
                "html_audio_started",
                "✅ Receiver: HTML audio stream fallback started via /stream.wav.",
                attemptId,
              );
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
          try {
            const messages = cast.framework.messages;
            const loadRequestData = new messages.LoadRequestData();
            const media = new messages.MediaInformation();
            media.contentId = "mxs-native-stream-" + (attemptId !== undefined ? attemptId : Date.now());
            media.contentType = "audio/wav";
            media.streamType = messages.StreamType.LIVE;
            media.duration = null;
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
            relayLogToStudio("🧭 Receiver: Native playback preferred; PCM bridge stays idle until fallback is required.");

            writeCastDebug("info", "Calling PlayerManager.load for " + streamUrl);
            const result = pm.load(loadRequestData);
            if (result && typeof result.then === "function") {
              result
                .then(function () {
                  writeCastDebug("info", "CAF native stream LOAD accepted.");
                })
                .catch(function (e) {
                  if (!isCurrentNativeAttempt(attemptId)) return;
                  writeCastDebug("error", "CAF native stream LOAD failed: " + (e && e.message ? e.message : e));
                  relayLogToStudio("⚠️ Receiver: CAF native stream LOAD failed: " + (e && e.message ? e.message : e));
                  startHtmlAudioStreamPlayout(streamUrl, attemptId);
                });
            } else {
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

        function startNativeStreamPlayout(ip, customPort) {
          if (!ENABLE_NATIVE_STREAM_PLAYOUT || window._receiverShutdownInProgress) {
            return false;
          }
          // [v13.9.506] SINGLE PATH: Don't start native stream if worklet is already
          // handling playout — dual paths cause wobble from competing clock recovery.
          if (workletNode && workletReady && window._playbackMode === "pcm_fallback") {
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
          suppressBinaryReconnect = true;
          clearBinaryReconnectTimer();
          clearLowLatencyStartupWatchdog();
          window._wsReconnectAttempts = 0;
          window._handshakeAcked = false;
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
          if (workletNode && workletReady) {
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
            if (audioInitializing || workletInitPromise || workletNode) {
              const dropped = pendingBinaryFrames.shift();
              recordPcmV2QueueDrop(dropped, "startup_pending_trim");
              if (!pendingStartupTrimLogged) {
                pendingStartupTrimLogged = true;
                relayLogToStudio("⚠️ Receiver: trimming pre-ready PCM startup backlog while worklet initializes.");
              }
              pendingBinaryFrames.push(packet);
              return;
            }
            // This is a receiver startup failure, never routine queue control.
            recordPcmV2QueueDrop(packet, "emergency_pending_overrun");
            pcmV2Telemetry.emergencyFailures = (pcmV2Telemetry.emergencyFailures || 0) + 1;
            relayLogToStudio("⛔ Receiver: pending PCM queue overrun; failing closed instead of deleting continuity.");
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

                if (binaryWS && binaryWS.readyState === WebSocket.OPEN) {
                  binaryWS.send(
                    JSON.stringify({
                      type: "DIAG",
                      available: e.data.available,
                      stalled: e.data.stalled,
                      measuredHz: e.data.measuredHz,
                      wallHz: e.data.wallHz,
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
                  clearLowLatencyStartupWatchdog();
                  flushPendingBinaryFrames();
                  if (!nativeStreamActive) {
                    notifyPlaybackMode("pcm_fallback", "worklet_ready");
                  }
                  relayLogToStudio("✅ Receiver: Live PCM playout active.");
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

        var logQueue = [];
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
            const targetIp =
              currentBridgeIp ||
              (window.location.hostname !== "localhost" &&
              window.location.hostname !== "127.0.0.1" &&
              window.location.hostname !== ""
                ? window.location.hostname
                : null);
            if (targetIp) {
              const port =
                currentBridgePort ||
                (window.SERVER_PORT && !window.SERVER_PORT.startsWith("{{")
                  ? window.SERVER_PORT
                  : "8080");
              const url = "http://" + targetIp + ":" + port + "/log?m=" + encodeURIComponent(msg);
              try {
                if (navigator.sendBeacon) {
                  navigator.sendBeacon(url);
                } else {
                  fetch(url).catch(() => {});
                }
                sent = true;
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

        let lastRenderTime = 0;
        const RENDER_THROTTLE_MS = 50; // Keep mirrored controls interactive without visible catch-up.

        const _lastParamsCache = [];
        const _lastFxCache = [];
        let _lastSamplerCache = "";
        let lastMirroredState = null;

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
          const now = Date.now();
          if (!force && now - lastRenderTime < RENDER_THROTTLE_MS) return;
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
          markPlaybackStartSignal();
          playbackPaused = false;
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
        }

        function handleStateUpdateCommand(state, envelope) {
          if (!acceptPlaybackRevision(envelope, "STATE_UPDATE")) {
            return;
          }
          renderState(state);
          lastMirroredState = state;
          if (isPlaybackActiveState(state)) {
            markPlaybackStartSignal();
            requestNativePlaybackStart("state_update");
          } else if (playbackPaused) {
            acknowledgePlaybackRevision(envelope, "state_update_paused");
            return;
          } else if (shouldIgnoreStaleInactiveState()) {
            return;
          } else if (
            nativeStreamActive ||
            window._binaryActive ||
            pendingBinaryFrames.length > 0
          ) {
            stopRealtimePlayoutKeepNativePrimed("state_update_inactive");
          }
          acknowledgePlaybackRevision(envelope, "state_update");
        }

        function handlePlaybackStopCommand(d) {
          if (!acceptPlaybackRevision(d, "PLAYBACK_STOP")) {
            return;
          }
          stopAllPlayout(d.reason || "playback_stop");
          acknowledgePlaybackRevision(d, "playback_stop");
        }

        function handlePlaybackPauseCommand(d) {
          if (!acceptPlaybackRevision(d, "PLAYBACK_PAUSE")) {
            return;
          }
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
          if (playbackPaused || window._binaryActive || nativeStreamActive) return;
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
          switch (d.type) {
            case "RECEIVER_SHUTDOWN":
              shutdownReceiver(d.reason || "signal");
              return true;
            case "STATE_UPDATE":
              handleStateUpdateCommand(d.state, d);
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
            pcmV2Validator = null;
            pcmV2AllowInitialOffset = true;
            pcmV2Telemetry = createPcmV2Telemetry();
            playbackModeSocketGeneration++;
            console.log("✅ Binary Bridge Connected");
            relayLogToStudio(`✅ Receiver: WebSocket Connected to ${url}`);
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
              if (playbackPaused || window._playbackMode === "native" || nativeStreamActive || nativeStreamStarting) {
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
              if (playbackPaused || window._playbackMode === "native" || nativeStreamActive || nativeStreamStarting) {
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

                  // Preload the worklet while the cast session is idle. The
                  // first PLAYBACK_START then only resumes the ready node,
                  // keeping module compilation and AudioContext setup out of
                  // the user-visible Play critical path.
                  if (receiverPlayoutPreference === "pcm_fallback") {
                    preloadPcmWorklet("handshake_ack");
                  }
                } else if (d.type === "BRIDGE_CONFIG") {
                  if (!acceptBuildIdentity(d.buildIdentity, "bridge_config")) {
                    return;
                  }
                  if (d.pcmProtocol && !acceptPcmV2ProtocolConfig(d.pcmProtocol, "websocket")) {
                    return;
                  }
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
            stopAllPlayout("websocket_closed");
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

        window.onload = function () {
          buildGUI();
          startNativeLatencyMonitor();

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
              logReceiverHardwareTelemetry(context);
              configureCafPlaybackHandlers();
              configureCafPlayerDebugEvents();
              const options = new cast.framework.CastReceiverOptions();
              const playbackConfig = new cast.framework.PlaybackConfig();
              playbackConfig.autoPauseDuration = 0;
              playbackConfig.autoResumeDuration = 0;
              options.playbackConfig = playbackConfig;
              options.disableIdleTimeout = true;
              context.start(options);
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
          revealReceiverUi("startup_ready");
          relayLogToStudio("🎬 Receiver: Startup Complete [" + VERSION_TAG + "].");
        };
      })();
    

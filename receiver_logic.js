

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
        window._receiverShutdownInProgress = false;
        var configReceived = false;
        window._studioRate = 48000;
        window._hwRate = 48000;
        var autoDiscoveryFallbackTimeoutId = null;
        var autoUnlockIntervalId = null;
        var noSenderShutdownTimeoutId = null;
        var pendingBinaryFrames = [];
        var workletReady = false;
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
        const PENDING_BINARY_FRAMES_MAX = 1; // Keep only the newest startup packet; stale PCM increases cast latency.
        const VERSION_TAG = "v13.9.509-APORv2";
        const CUSTOM_NAMESPACE = "urn:x-cast:com.nowmultimedia.mxs004";
        const ENABLE_NATIVE_STREAM_PLAYOUT = true;
        // Do not run CAF PlayerManager media in parallel with the custom PCM
        // AudioWorklet path. On Chromecast-class devices that extra native
        // media pipeline contends with Web Audio and causes periodic lag flushes.
        const ENABLE_PLAYERMANAGER_WAKE_LOCK = false;
        var nativeStreamActive = false;
        var nativeStreamStarting = false;
        var nativeStreamUrl = "";
        var nativeStartupAttemptId = 0;
        var nativeStartupWatchdogId = null;
        var lowLatencyStartupWatchdogId = null;
        const NATIVE_STARTUP_TIMEOUT_MS = 3000;
        const DEGRADED_PLAYOUT_HZ_THRESHOLD = 40000;
        const DEGRADED_PLAYOUT_CONSECUTIVE_DIAG_COUNT = 3;
        window._nativeStreamActive = false;
        window._playbackMode = "unknown";
        var playbackModeSocketGeneration = 0;
        var playbackModeLastSentGeneration = -1;
        var playbackModeLastSent = "";
        var lastPlaybackStartSignalAt = 0;
        const PLAYBACK_START_GRACE_MS = 2500;
        var cafLoadInterceptorConfigured = false;
        var castDebugLogger = null;
        var castDebugLoggerConfigured = false;
        const CAST_DEBUG_TAG = "MXS004.RECEIVER";

        function isBuildIdentity(value) {
          return (
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

        function reportBuildIdentityRejection(reason, received) {
          if (buildIdentityRejected) return;
          const details = {
            type: "BUILD_IDENTITY_REJECTED",
            role: "receiver",
            reason: reason,
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
            relayLogToStudio("✅ Receiver build identity verified: " + JSON.stringify(window.MXS_BUILD_IDENTITY));
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

        let deviceCapabilitiesLogged = false;
        let pendingStudioLogQueue = [];
        let flushingPendingStudioLogs = false;
        let hardwareTelemetryRetryId = null;
        let hardwareTelemetryRetryCount = 0;
        let receiverPlayoutPreference = "pcm_fallback";
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
            binaryWS.send(
              JSON.stringify({
                type: "PLAYBACK_MODE",
                mode: mode,
                reason: reason || "",
              }),
            );
            playbackModeLastSent = mode;
            playbackModeLastSentGeneration = playbackModeSocketGeneration;
          } catch (e) {}
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

        function maybeStartLowLatencyPlayout(reason) {
          if (!identityAllowsAudio()) return false;
          if (window._receiverShutdownInProgress) {
            return false;
          }
          if (window._pcmDegraded) {
            return false;
          }
          if (receiverPlayoutPreference !== "pcm_fallback") {
            return false;
          }
          if (nativeStreamActive || audioInitializing || workletNode) {
            return true;
          }
          if (!configReceived || !currentBridgeIp) {
            return false;
          }
          if (!binaryWS || binaryWS.readyState !== WebSocket.OPEN || !window._handshakeAcked) {
            return false;
          }
          const preserveNativeMode = nativeStreamStarting || window._playbackMode === "native";
          if (reason) {
            relayLogToStudio(
              "▶️ Receiver: Starting PCM worklet on " +
                reason +
                (preserveNativeMode ? " (native boot bridge)." : "."),
            );
          }
          initAudio(false, preserveNativeMode).catch((e) => {
            relayLogToStudio("⚠️ Receiver: initAudio failed: " + (e && e.message ? e.message : e));
          });
          armLowLatencyStartupWatchdog();
          return true;
        }

        function maybeStartNativeStream(reason) {
          if (!identityAllowsAudio()) return false;
          if (window._receiverShutdownInProgress) {
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
            relayLogToStudio("▶️ Receiver: Starting native stream on " + reason + ".");
          }
          return startNativeStreamPlayout(currentBridgeIp, currentBridgePort);
        }

        function markPlaybackStartSignal() {
          if (!lastPlaybackStartSignalAt) {
            lastPlaybackStartSignalAt = Date.now();
          }
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
            const latency = liveEdge - playhead;

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

        function isWithinPlaybackStartGrace() {
          return (
            !!lastPlaybackStartSignalAt &&
            Date.now() - lastPlaybackStartSignalAt <= PLAYBACK_START_GRACE_MS
          );
        }

        function hasAudiblePlaybackSignal(diag) {
          if (!lastPlaybackStartSignalAt) {
            return false;
          }
          const peak = Number(diag && diag.peak ? diag.peak : 0);
          return (
            window._binaryActive ||
            pendingBinaryFrames.length > 0 ||
            peak > 0.0001
          );
        }

        function requestNativePlaybackStart(reason) {
          if (!identityAllowsAudio()) return false;
          if (
            reason === "bridge_config" &&
            !nativeStreamActive &&
            !nativeStreamStarting
          ) {
            resetBinaryPlayoutState("native_takeover");
          }
          if (nativeStreamActive) {
            return true;
          }
          if (nativeStreamStarting) {
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
          const messages = cast.framework.messages && cast.framework.messages.PlayerState ? cast.framework.messages : {};
          [
            events.PLAYER_STATE_CHANGED,
            events.MEDIA_STATUS,
            events.ERROR,
          ].forEach(function (eventType) {
            if (!eventType) return;
            try {
              pm.addEventListener(eventType, function (event) {
                const value =
                  event && event.value !== undefined
                    ? event.value
                    : event && event.errorCode !== undefined
                      ? event.errorCode
                      : "";
                const msg = "CAF event " + eventType + (value !== "" ? ": " + value : "");
                writeCastDebug(eventType === events.ERROR ? "error" : "debug", msg);
                if (eventType === events.ERROR || eventType === events.PLAYER_STATE_CHANGED) {
                  relayLogToStudio("📺 Receiver: " + msg);
                }

                if (
                  eventType === events.PLAYER_STATE_CHANGED &&
                  messages.PlayerState &&
                  event.playerState === messages.PlayerState.PLAYING &&
                  nativeStreamStarting &&
                  nativeStreamUrl
                ) {
                  activateNativeStream(
                    "caf_playing",
                    "✅ Receiver: CAF native 48k stream PLAYING via /stream.wav.",
                    nativeStartupAttemptId,
                  );
                }
                
                // [v13.9.506] Loop/Reload static wake-lock stream when finished
                if (
                  eventType === events.PLAYER_STATE_CHANGED &&
                  messages.PlayerState &&
                  event.playerState === messages.PlayerState.IDLE &&
                  event.idleReason === messages.IdleReason.FINISHED
                ) {
                  if (nativeStreamActive && nativeStreamUrl) {
                    relayLogToStudio("🔄 Receiver: Wake-lock finished playing; reloading silent stream...");
                    setTimeout(() => {
                      if (nativeStreamActive && nativeStreamUrl) {
                        startCafStreamPlayout(nativeStreamUrl);
                      }
                    }, 100);
                  }
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

        function clearLowLatencyStartupWatchdog() {
          if (lowLatencyStartupWatchdogId) {
            clearTimeout(lowLatencyStartupWatchdogId);
            lowLatencyStartupWatchdogId = null;
          }
        }

        function armLowLatencyStartupWatchdog() {
          clearLowLatencyStartupWatchdog();
          lowLatencyStartupWatchdogId = setTimeout(() => {
            lowLatencyStartupWatchdogId = null;
            if (window._receiverShutdownInProgress) {
              return;
            }
            if (workletNode && workletReady) {
              return;
            }
            if (nativeStreamActive || nativeStreamStarting) {
              return;
            }
            if (!configReceived || !currentBridgeIp) {
              return;
            }
            if (window._pcmDegraded) {
              relayLogToStudio("⚠️ Receiver: PCM worklet startup timed out during PCM recovery; keeping playback on the worklet path.");
              return;
            }
            relayLogToStudio("⚠️ Receiver: PCM worklet startup timed out; starting native stream fallback.");
            startNativeStreamPlayout(currentBridgeIp, currentBridgePort);
          }, NATIVE_STARTUP_TIMEOUT_MS);
        }

        function isCurrentNativeAttempt(attemptId) {
          return attemptId === nativeStartupAttemptId;
        }

        function stopHtmlAudioNativeCompanion() {
          const nativeAudio = document.getElementById("native-stream-audio");
          if (!nativeAudio) return;
          try {
            nativeAudio.pause();
            nativeAudio.removeAttribute("src");
            nativeAudio.load();
          } catch (e) {}
        }

        function stopCafNativeCompanion() {
          const pm = getCastPlayerManager();
          if (pm && typeof pm.stop === "function") {
            try {
              pm.stop();
            } catch (e) {}
          }
          const cafAudio = document.getElementById("cast-media-element");
          if (cafAudio) {
            try {
              cafAudio.removeAttribute("src");
              cafAudio.load();
            } catch (e) {}
          }
        }

        function teardownPcmPlayout(reason, closeAudioContext) {
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
          nativeStartupWatchdogId = setTimeout(() => {
            nativeStartupWatchdogId = null;
            if (window._receiverShutdownInProgress) {
              return;
            }
            if (window._playbackMode === "native" || nativeStreamActive || workletNode || audioInitializing) {
              return;
            }
            relayLogToStudio("⚠️ Receiver: Native stream startup timed out; switching to PCM fallback.");
            stopNativeStreamPlayout("startup_timeout");
            setReceiverPlayoutPreference("pcm_fallback", "native_startup_timeout");
            if (configReceived) {
              initAudio(true, false);
            }
          }, NATIVE_STARTUP_TIMEOUT_MS);
        }

        function activateNativeStream(modeReason, logMessage, attemptId) {
          if (attemptId && !isCurrentNativeAttempt(attemptId)) {
            return false;
          }
          nativeStreamStarting = false;
          nativeStreamActive = true;
          window._nativeStreamActive = true;
          clearNativeStartupWatchdog();
          if (modeReason.indexOf("caf_") === 0) {
            stopHtmlAudioNativeCompanion();
          } else {
            stopCafNativeCompanion();
          }
          notifyPlaybackMode("native", modeReason);
          revealReceiverUi("native_active");
          teardownPcmPlayout("native_active", true);
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

        // [v13.9.504] Dynamically build a valid 2-second silent WAV loop for Receiver OS media wake-lock
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
          nativeStartupAttemptId++;
          clearPlaybackStartSignal();
          clearNativeStartupWatchdog();
          clearLowLatencyStartupWatchdog();
          nativeStreamStarting = false;
          nativeStreamActive = false;
          nativeStreamUrl = "";
          window._nativeStreamActive = false;
          window._playbackMode = "unknown";
          window._pcmDegraded = false;
          playbackModeLastSent = "";
          playbackModeLastSentGeneration = -1;
          stopCafNativeCompanion();
          stopHtmlAudioNativeCompanion();
          
          const htmlAudio = document.getElementById("native-stream-audio");
          const cafAudio = document.getElementById("cast-media-element");
          if (htmlAudio) htmlAudio.playbackRate = 1.0;
          if (cafAudio) cafAudio.playbackRate = 1.0;

          if (reason) {
            relayLogToStudio("🛑 Receiver: Native stream stopped (" + reason + ").");
          }
        }

        function destroyAudioWorklet() {
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
          window._qCount = 0;
          window._binLogCount = 0;
          window._lowRateCount = 0;
          window._workletDiagCount = 0;
        }

        function resetBinaryPlayoutState(reason) {
          const preserveNativeMode = nativeStreamActive || nativeStreamStarting || window._playbackMode === "native";
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
          if (reason) {
            relayLogToStudio("🛑 Receiver: Binary playout reset (" + reason + ").");
          }
        }

        function stopAllPlayout(reason) {
          clearPlaybackStartSignal();
          resetBinaryPlayoutState(reason || "playback_stop");
          stopNativeStreamPlayout(reason || "playback_stop");
        }

        function resetRealtimePlayoutKeepPcmReady(reason) {
          clearPlaybackStartSignal();
          pendingBinaryFrames = [];
          window._isDrainingStartup = false;
          window._binaryActive = false;
          window._lastBinaryTime = 0;
          window._pcmDegraded = false;
          clearLowLatencyStartupWatchdog();
          if (workletNode && workletNode.port) {
            try {
              workletNode.port.postMessage({ type: "RESET" });
            } catch (e) {}
            workletReady = true;
          }
          stopNativeStreamPlayout(reason || "playback_idle");
          if (workletNode) {
            notifyPlaybackMode("pcm_fallback", (reason || "playback_idle") + "_pcm_ready");
          }
          if (reason) {
            relayLogToStudio("🛑 Receiver: Binary playout reset, PCM bridge kept ready (" + reason + ").");
          }
        }

        function stopRealtimePlayoutKeepNativePrimed(reason) {
          if (reason === "track_stop") {
            resetRealtimePlayoutKeepPcmReady(reason);
            return;
          }
          // Do not keep /stream.wav primed while idle. Chromecast can buffer
          // backend silence and replay it before the next audible packet.
          stopAllPlayout(reason || "playback_stop");
        }

        function startHtmlAudioStreamPlayout(streamUrl, attemptId) {
          const nativeAudio = document.getElementById("native-stream-audio");
          if (!nativeAudio) {
            clearNativeStartupWatchdog();
            relayLogToStudio("⚠️ Receiver: Native stream element missing; falling back to AudioWorklet.");
            nativeStreamStarting = false;
            nativeStreamActive = false;
            window._nativeStreamActive = false;
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
              relayLogToStudio("⚠️ Receiver: HTML audio stream media error; falling back to AudioWorklet.");
              if (configReceived) {
                initAudio(true);
              }
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
                  if (configReceived) {
                    initAudio(true);
                  }
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
              metadata.subtitle = "Native 48k LAN audio stream";
              media.metadata = metadata;
            }
            loadRequestData.media = media;
            loadRequestData.autoplay = true;
            notifyPlaybackMode("native", "caf_load_requested");
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
          nativeStreamStarting = true;
          nativeStreamActive = false;
          nativeStreamUrl = streamUrl;
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
          wakeLockLoadingOrLoaded = false;
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

        function queueBinaryFrame(buffer) {
          if (!identityAllowsAudio()) return;
          if (window._receiverShutdownInProgress) {
            return;
          }
          if (window._isDrainingStartup) {
            return; // Discard stale startup burst packets to prevent backlog build-up
          }
          if (!window._qCount) window._qCount = 0;
          if (window._qCount < 10) {
            window._qCount++;
            const isAB = buffer instanceof ArrayBuffer;
            const len = buffer ? buffer.byteLength : "n/a";
            const constr = buffer && buffer.constructor ? buffer.constructor.name : "null";
            relayLogToStudio(`🔍 Receiver queueBinaryFrame: isAB=${isAB} len=${len} constr=${constr}`);
          }
          if (!(buffer instanceof ArrayBuffer) && (!buffer || typeof buffer.byteLength !== "number")) {
            relayLogToStudio("⚠️ Receiver queueBinaryFrame: Rejected buffer (not ArrayBuffer / no byteLength)");
            return;
          }
          if (workletNode && workletReady) {
            try {
              workletNode.port.postMessage(buffer, [buffer]);
            } catch (e) {
              workletNode.port.postMessage(buffer);
            }
            return;
          }

          if (pendingBinaryFrames.length >= PENDING_BINARY_FRAMES_MAX) {
            pendingBinaryFrames.shift();
          }
          pendingBinaryFrames.push(buffer);
        }

        function flushPendingBinaryFrames() {
          if (!workletNode || !workletReady || pendingBinaryFrames.length === 0) return;
          // Drop stale startup PCM instead of replaying it all into the worklet.
          // The receiver should start with the freshest live packet, not a buffered tail.
          const queued = pendingBinaryFrames.slice(-1);
          pendingBinaryFrames.length = 0;
          queued.forEach((buffer) => queueBinaryFrame(buffer));
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
          if (!audioCtx) {
            try {
              relayLogToStudio("🛠️ Receiver: Creating new AudioContext (hardware fast-path)...");
              audioCtx = new (window.AudioContext || window.webkitAudioContext)();
              window._hwRate = audioCtx.sampleRate || 48000;
              window._lastHwRate = window._hwRate;
              relayLogToStudio("🛠️ Receiver: AudioContext created. State: " + audioCtx.state + " | Rate: " + window._hwRate);
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
        let audioInitializing = false;
        async function initAudio(force = false, preserveNativeMode = false) {
          if (!identityAllowsAudio()) {
            relayLogToStudio("⛔ Receiver: Audio startup blocked until build identity is verified.");
            return;
          }
          if (window._receiverShutdownInProgress) return;
          if (audioInitializing) return;
          if (nativeStreamActive || workletNode) {
            return;
          }
          if (!preserveNativeMode && (nativeStreamStarting || window._playbackMode === "native")) {
            return;
          }
          // The PCM AudioWorklet is the primary live-sync playout path.
          // Native /stream.wav remains available as a fallback if PCM cannot
          // initialize or later degrades.
          // [v13.9.504] HARDWARE LOCK: Never initialize until we have a verified sample rate from the Studio.
          if (!configReceived) {
            relayLogToStudio("⏳ Receiver: Waiting for BRIDGE_CONFIG handshake...");
            return;
          }

          // [v13.9.504] THROTTLE: Prevent tight-loop retries if init fails (e.g. 404 or SyntaxError)
          const now = Date.now();
          if (!force && now - lastInitAttempt < 5000) return;
          lastInitAttempt = now;
          
          audioInitializing = true;
          try {
            if (!preserveNativeMode) {
              notifyPlaybackMode("pcm_fallback", "native_stream_unavailable");
            } else {
              relayLogToStudio("🛠️ Receiver: PCM bridge initializing while native stream boots.");
            }
            preInitAudioContext();

            if (!audioCtx) {
              relayLogToStudio("❌ Receiver ERROR: initAudio failed - audioCtx is null");
              return;
            }

            if (workletNode) {
              return;
            }

            let workletUrl = `pcm-player-worklet-v13.9.509.js?cb=${Date.now()}`;
            if (currentBridgeIp && currentBridgePort) {
              const port = currentBridgePort || "8080";
              workletUrl = `http://${currentBridgeIp}:${port}/receiver/${workletUrl}`;
              relayLogToStudio(`📡 Receiver: Loading Worklet from Studio: ${workletUrl}`);
            }

            const workletResponse = await fetch(workletUrl, { cache: "no-store" });
            if (!workletResponse.ok) {
              throw new Error(`Worklet fetch failed (${workletResponse.status})`);
            }
            const workletSource = await workletResponse.text();
            const workletBlobUrl = URL.createObjectURL(
              new Blob([workletSource], { type: "application/javascript" }),
            );
            try {
              await audioCtx.audioWorklet.addModule(workletBlobUrl);
            } finally {
              URL.revokeObjectURL(workletBlobUrl);
            }

            // [v13.9.504] DYNAMIC RATE TRANSFORMATION
            // Since the Rust backend now handles authoritative resampling (Studio -> TV),
            // the receiver worklet should operate at unity rate (1.0).
            const studioRate = window._studioRate || 48000;
            const actualRate = audioCtx.sampleRate;
            const requestedRate = window._lastHwRate || window._hwRate || 48000;
            const baseRateRatio = 1.0; // Backend Resampled Alignment
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
                  baseRateRatio: baseRateRatio,
                  studioRate: studioRate,
                  bitDepth: negotiatedBitDepth,
                },
              },
            );
            workletNode.onprocessorerror = (e) => {
              console.error("❌ Receiver: workletNode processor error:", e);
              relayLogToStudio(`❌ Receiver: workletNode processor error: ${e.message || e}`);
            };
            workletNode.connect(masterGain);
            window._lastWorkletDiagTime = Date.now(); // Prevent premature watchdog triggers during startup
            window._lowRateCount = 0;
            window._workletDiagCount = 0;

            revealReceiverUi("worklet_ready");

            relayLogToStudio(`✅ Receiver sink active @ ${actualRate}Hz`);

            workletNode.port.onmessage = (e) => {
              if (e.data.type === "DIAG") {
                window._lastWorkletDiagTime = Date.now();
                window._workletDiagCount = (window._workletDiagCount || 0) + 1;

                // Treat low-rate DIAG as a signal, not an automatic failure.
                // Brief scheduler jitter can depress the reported drain rate
                // while the buffer is still healthy, so only reset the bridge
                // when the low-rate condition lines up with real buffer stress.
                if (e.data.measuredHz && e.data.measuredHz > 0) {
                  if (
                    !hasAudiblePlaybackSignal(e.data) ||
                    isWithinPlaybackStartGrace()
                  ) {
                    window._lowRateCount = 0;
                  } else if (nativeStreamStarting || nativeStreamActive) {
                    window._lowRateCount = 0;
                  } else if (e.data.measuredHz < DEGRADED_PLAYOUT_HZ_THRESHOLD) {
                    window._lowRateCount = (window._lowRateCount || 0) + 1;
                    if (window._lowRateCount >= DEGRADED_PLAYOUT_CONSECUTIVE_DIAG_COUNT) {
                      const stalled = Number(e.data.stalled || 0) > 0;
                      const lowBuffer = Number(e.data.available || 0) > 0 && Number(e.data.available || 0) < 16384;
                      if (stalled || lowBuffer) {
                        relayLogToStudio(
                          `⚠️ Receiver: Playout rate degraded (${Math.round(e.data.measuredHz)}Hz < ${DEGRADED_PLAYOUT_HZ_THRESHOLD}Hz for ${DEGRADED_PLAYOUT_CONSECUTIVE_DIAG_COUNT} DIAG cycles) and buffer health dropped (available=${Math.round(e.data.available || 0)}, stalled=${Number(e.data.stalled || 0)}). Resetting PCM bridge.`,
                        );
                        window._lowRateCount = 0;
                        window._pcmDegraded = true;
                        stopRealtimePlayoutKeepNativePrimed("pcm_degraded");
                        requestNativePlaybackStart("pcm_degraded_recover");
                        return;
                      }

                      relayLogToStudio(
                        `⚠️ Receiver: Low playout rate observed (${Math.round(e.data.measuredHz)}Hz) but buffer remains healthy (available=${Math.round(e.data.available || 0)}, stalled=${Number(e.data.stalled || 0)}). Keeping PCM bridge active.`,
                      );
                      window._lowRateCount = 0;
                    }
                  } else {
                    window._lowRateCount = 0;
                  }
                }

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
                    `📊 Receiver STATUS: ${lockStatus} @ ${rate}x (BUF: ${e.data.available}${hzInfo} | PEAK: ${peakPercent}% | STALLS: ${e.data.stalled})`,
                  );
                  window._lastDiagSent = Date.now();
                }
              } else if (e.data.type === "LOG") {
                if (
                  typeof e.data.msg === "string" &&
                  e.data.msg.indexOf("Worklet message: CONFIG") !== -1 &&
                  !workletReady
                ) {
                  pendingBinaryFrames = pendingBinaryFrames.slice(-1);
                  window._isDrainingStartup = false;
                  workletReady = true;
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
            workletNode.port.postMessage({
              type: "CONFIG",
              bitDepth: negotiatedBitDepth,
            });
            relayLogToStudio(
              `🔧 Receiver: Worklet configured for ${negotiatedBitDepth}-bit decode`,
            );
            resumeAudio();
          } catch (e) {
            relayLogToStudio(`❌ Receiver ERROR: initAudio failed - ${e.message}`);
          } finally {
            audioInitializing = false;
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
            
            // Fallback: check Cast SDK PlayerManager
            if (!castMediaElement && typeof cast !== "undefined" && cast.framework) {
              try {
                const pm = getCastPlayerManager();
                if (pm && typeof pm.getMediaElement === "function") {
                  castMediaElement = pm.getMediaElement();
                }
              } catch (sdkErr) {
                // Non-fatal fallback
              }
            }
            
            // Fallback: use recursive shadow root traverser
            if (!castMediaElement) {
              castMediaElement = findMediaElement(document);
            }

            if (castMediaElement) {
              // Keep the wake-lock element out of the Web Audio graph.
              // Connecting media elements to the graph forced Chromium to sync
              // decoding and audio rendering, which throttled the worklet thread.
              if (!castMediaElement._wakeLockLogged) {
                castMediaElement._wakeLockLogged = true;
                relayLogToStudio("🛠️ Receiver: Cast media element present; keeping wake-lock playback offline.");
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
          if (audioCtx) {
            connectCastMediaElement();
            const prevState = audioCtx.state;
            try {
              relayLogToStudio("🔊 Receiver: resumeAudio() calling audioCtx.resume(). State: " + prevState);
              await audioCtx.resume();
              relayLogToStudio("🔊 Receiver: resumeAudio() resolved. State: " + audioCtx.state);
              if (audioCtx.state === "running") {
                hideUnlockOverlay();
              } else {
                showUnlockOverlay();
              }
            } catch (e) {
              console.warn("⚠️ Receiver: Resume failed", e);
              relayLogToStudio("⚠️ Receiver: resumeAudio() failed: " + e.message);
              showUnlockOverlay();
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
        const RENDER_THROTTLE_MS = 250; // Keep UI near-live without hammering the DOM.

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
          if (window._receiverShutdownInProgress) {
            return;
          }
          clearBinaryReconnectTimer();
          wsConnectTimeout = setTimeout(() => {
            connectBinaryBridge(ip, customPort, customToken);
          }, delayMs);
        }

        function triggerWakeLockLoad() {
          if (window._receiverShutdownInProgress) return;
          if (!wakeLockLoadingOrLoaded) {
            wakeLockLoadingOrLoaded = true;
            relayLogToStudio("📡 Receiver: CAF PlayerManager wake-lock disabled; native stream/worklet path owns audio output.");
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
            playbackModeSocketGeneration++;
            console.log("✅ Binary Bridge Connected");
            relayLogToStudio(`✅ Receiver: WebSocket Connected to ${url}`);
            // [v13.9.504] Reset reconnect backoff counter on success
            window._wsReconnectAttempts = 0;
            // [v13.9.506] Reset stale bypass flag so fresh sessions don't carry old state
            window._nativeStreamBypassLogged = false;
            window._pcmDegraded = false;
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

            // Keep the wake-lock primed; low-latency PCM startup now begins only
            // once the handshake/configuration path is ready.
            triggerWakeLockLoad();
            if (nativeStreamActive || nativeStreamStarting) {
              notifyPlaybackMode("native", "socket_reconnected");
            } else if (workletNode || workletReady || window._binaryActive) {
              notifyPlaybackMode("pcm_fallback", "socket_reconnected");
            }
          };
          binaryWS.onmessage = (event) => {
            if (generation !== binaryConnectionGeneration) return;
            if (window._receiverShutdownInProgress) return;
            
            // Debug print for first few messages
            if (!window._msgCount) window._msgCount = 0;
            if (window._msgCount < 15) {
              window._msgCount++;
              const type = typeof event.data;
              const isAB = event.data instanceof ArrayBuffer;
              const isB = event.data instanceof Blob;
              const byteLen = event.data ? event.data.byteLength : undefined;
              const size = event.data ? event.data.size : undefined;
              const constr = event.data && event.data.constructor ? event.data.constructor.name : "null";
              relayLogToStudio(`🔍 Receiver MSG DEBUG: type=${type} constr=${constr} isAB=${isAB} isB=${isB} byteLen=${byteLen} size=${size}`);
            }

            // [v13.9.504] PRIORITY: Binary audio data gets the fastest path
            const isArrayBuffer = event.data instanceof ArrayBuffer || (event.data && typeof event.data.byteLength === "number");
            const isBlob = event.data instanceof Blob || (event.data && typeof event.data.size === "number" && typeof event.data.slice === "function");
            
            if (isArrayBuffer) {
              if (window._playbackMode === "native" || nativeStreamActive || nativeStreamStarting) {
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
                queueBinaryFrame(event.data);
              } else {
                if (audioCtx && audioCtx.state === "suspended") resumeAudio();
                queueBinaryFrame(event.data);
              }
              return;
            } else if (isBlob) {
              if (window._playbackMode === "native" || nativeStreamActive || nativeStreamStarting) {
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
                queueBinaryFrame(this.result);
              };
              reader.onerror = function() {
                relayLogToStudio("⚠️ Receiver: FileReader failed to read Blob.");
              };
              reader.readAsArrayBuffer(event.data);
              return;
            } else if (typeof event.data === "string") {
              try {
                const d = JSON.parse(event.data);
                if (d.type === "RECEIVER_SHUTDOWN") {
                  shutdownReceiver(d.reason || "signal");
                  return;
                }
                if (d.type === "STATE_UPDATE") {
                  renderState(d.state);
                  lastMirroredState = d.state;
                  if (isPlaybackActiveState(d.state)) {
                    markPlaybackStartSignal();
                    requestNativePlaybackStart("state_update");
                  } else if (
                    shouldIgnoreStaleInactiveState()
                  ) {
                    return;
                  } else if (
                    nativeStreamActive ||
                    window._binaryActive ||
                    pendingBinaryFrames.length > 0
                  ) {
                    stopRealtimePlayoutKeepNativePrimed("state_update_inactive");
                  }
                } else if (d.type === "PLAYBACK_STOP") {
                  stopRealtimePlayoutKeepNativePrimed(d.reason || "playback_stop");
                } else if (d.type === "PCM_RELAY") {
                   // [v13.9.504] Binary Superiority: Ignore relay if binary is active
                   if (window._binaryActive || nativeStreamActive) return;

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
                  relayLogToStudio("🔄 Receiver: RELOAD command received. Reloading page with cache-buster...");
                  setTimeout(() => {
                    const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
                    window.location.href = cleanUrl + "?cb=" + Date.now();
                  }, 500);
                } else if (d.type === "HANDSHAKE_ACK") {
                  if (!acceptBuildIdentity(d.buildIdentity, "handshake_ack")) {
                    return;
                  }
                  // Server confirmed handshake. Prime the native media path now so
                  // the TV player is already buffered before audible PCM arrives.
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

                  // [v13.9.510] Trigger low-latency playout immediately when handshake is confirmed
                  if (receiverPlayoutPreference === "pcm_fallback") {
                    maybeStartLowLatencyPlayout("handshake_ack");
                  }
                } else if (d.type === "PLAYBACK_START") {
                  markPlaybackStartSignal();
                  const immediateState = buildImmediatePlaybackState(d.trackId);
                  if (immediateState) {
                    renderState(immediateState, true);
                    lastMirroredState = immediateState;
                  }
                  requestNativePlaybackStart("playback_start");
                } else if (d.type === "BRIDGE_CONFIG") {
                  if (!acceptBuildIdentity(d.buildIdentity, "bridge_config")) {
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
                      if (workletNode && audioCtx) {
                        const newBaseRateRatio = 1.0;
                        workletNode.port.postMessage({
                          type: "CONFIG",
                          baseRateRatio: newBaseRateRatio,
                        });
                      }
                    }
                  }
                  if (d.ip) {
                    triggerWakeLockLoad();
                  }
                } else if (d.type === "BUILD_IDENTITY_REJECTED") {
                  reportBuildIdentityRejection(d.reason || "backend_rejected", d.received);
                } else if (d.type === "WEBRTC_OFFER") {
                  relayLogToStudio("📡 Receiver: Ignored WEBRTC_OFFER on binary bridge.");
                } else if (d.type === "WEBRTC_CANDIDATE") {
                  relayLogToStudio("📡 Receiver: Ignored WEBRTC_CANDIDATE on binary bridge.");
                }
              } catch (e) {}
            }
          };

          binaryWS.onclose = () => {
            if (generation !== binaryConnectionGeneration) return;
            clearLowLatencyStartupWatchdog();
            window._binaryActive = false;
            configReceived = false;
            wakeLockLoadingOrLoaded = false;
            pendingBinaryFrames = [];
            workletReady = false;
            window._isDrainingStartup = false;
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
              const newRate = d.config ? d.config.sampleRate : null;
              configReceived = true;
              if (newRate && window._studioRate !== newRate) {
                window._studioRate = newRate;
                relayLogToStudio(
                  `🔄 Receiver: Studio rate updated via signaling to ${newRate}Hz`,
                );
                if (workletNode && audioCtx && !nativeStreamActive && !nativeStreamStarting) {
                  workletNode.port.postMessage({
                    type: "CONFIG",
                    baseRateRatio: 1.0,
                  });
                }
              }
              if (d.ip) {
                connectBinaryBridge(d.ip, d.port, d.token);
                triggerWakeLockLoad();
              }
              return;
            }

            if (d.type === "BUILD_IDENTITY_REJECTED") {
              reportBuildIdentityRejection(d.reason || "cast_sender_rejected", d.received);
              return;
            }

            if (d.type === "RECEIVER_SHUTDOWN") {
              shutdownReceiver(d.reason || "signal");
              return;
            }

            // 3. Command Relay
            if (d.type === "RELOAD") {
              relayLogToStudio("🔄 Receiver: RELOAD command received via Cast SDK. Reloading page...");
              setTimeout(() => {
                const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
                window.location.href = cleanUrl + "?cb=" + Date.now();
              }, 500);
              return;
            }

            if (d.type === "SINE_TEST") {
              playSineTest().catch((e) => {
                relayLogToStudio("⚠️ Receiver: Sine test failed: " + e.message);
              });
              return;
            }

            if (d.type === "WEBRTC_OFFER") {
              relayLogToStudio("📡 Receiver: Ignored WEBRTC_OFFER on Cast channel.");
              return;
            }

            if (d.type === "WEBRTC_CANDIDATE") {
              relayLogToStudio("📡 Receiver: Ignored WEBRTC_CANDIDATE on Cast channel.");
              return;
            }

            if (d.type === "PLAYBACK_START") {
              markPlaybackStartSignal();
              const immediateState = buildImmediatePlaybackState(d.trackId);
              if (immediateState) {
                renderState(immediateState, true);
                lastMirroredState = immediateState;
              }
              requestNativePlaybackStart("playback_start");
              return;
            }

            if (d.type === "PLAYBACK_STOP") {
              stopRealtimePlayoutKeepNativePrimed(d.reason || "playback_stop");
              return;
            }

            // 2. High-Fidelity Audio Relay (Fallback Path)
            if (d.type === "PCM_RELAY") {
              // If Binary WS is active, IGNORE Relay to prevent doubling/echo
              if (window._binaryActive || nativeStreamActive) return;

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
                queueBinaryFrame(buffer);
                window._relayPkts = (window._relayPkts || 0) + 1;
              }
            }

            // 3. Diagnostics & Testing
            if (d.type === "SINE_TEST") {
              playSineTest().catch((e) => {
                relayLogToStudio("⚠️ Receiver: Sine test failed: " + e.message);
              });
            }

            // 4. GUI Mirroring
            if (d.type === "STATE_UPDATE") {
              renderState(d.state);
              lastMirroredState = d.state;
              if (isPlaybackActiveState(d.state)) {
                markPlaybackStartSignal();
                requestNativePlaybackStart("state_update");
              } else if (shouldIgnoreStaleInactiveState()) {
                return;
              } else if (
                nativeStreamActive ||
                window._binaryActive ||
                pendingBinaryFrames.length > 0
              ) {
                stopRealtimePlayoutKeepNativePrimed("state_update_inactive");
              }
            }
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
                isSenderConnected = true;
                resumeAudio();
                triggerWakeLockLoad();
              },
            );

              context.addEventListener(
                cast.framework.events.EventType.SENDER_DISCONNECTED,
                () => {
                  if (window._receiverShutdownInProgress) return;
                  isSenderConnected = false;
                  wakeLockLoadingOrLoaded = false;
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
    

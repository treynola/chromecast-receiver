/* Shared, bounded mirror observations. No SDP, addresses, credentials or media bytes. */
(function (root) {
  "use strict";
  const number = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
  const text = (value) => typeof value === "string" ? value.slice(0, 96) : null;
  const difference = (current, previous) => number(current) !== null && number(previous) !== null && current >= previous
    ? current - previous : null;
  const duration = (value) => number(value) === null ? null : value * 1000;

  class Sampler {
    constructor() { this.previous = new Map(); }
    sample(report, direction) {
      const rows = [];
      report.forEach((row) => rows.push(row));
      const video = rows.filter((row) => row.type === direction && (row.kind === "video" || row.mediaType === "video") && !row.isRemote)
        .sort((a, b) => (b.bytesSent ?? b.bytesReceived ?? 0) - (a.bytesSent ?? a.bytesReceived ?? 0))[0];
      if (!video) return { status: "video_stats_unavailable", video: null, network: null };
      const previous = this.previous.get(video.id);
      const counters = {};
      for (const key of ["timestamp", "bytesSent", "bytesReceived", "framesEncoded", "framesDecoded", "framesSent", "framesReceived", "qpSum", "totalEncodeTime", "totalDecodeTime", "jitterBufferDelay", "jitterBufferEmittedCount"]) counters[key] = number(video[key]);
      this.previous.set(video.id, counters);
      while (this.previous.size > 8) this.previous.delete(this.previous.keys().next().value);
      const intervalMs = previous ? difference(counters.timestamp, previous.timestamp) : null;
      const delta = (key) => previous ? difference(counters[key], previous[key]) : null;
      const rate = (key, scale) => intervalMs > 0 && delta(key) !== null ? delta(key) * scale / intervalMs : null;
      const perFrame = (sum, frames, scale) => delta(frames) > 0 && delta(sum) !== null ? delta(sum) * scale / delta(frames) : null;
      const codec = report.get?.(video.codecId);
      const transport = report.get?.(video.transportId);
      const pair = report.get?.(transport?.selectedCandidatePairId);
      const remote = report.get?.(video.remoteId);
      return {
        status: "observed", intervalMs,
        video: {
          direction, codec: text(codec?.mimeType), width: number(video.frameWidth), height: number(video.frameHeight),
          reportedFramesPerSecond: number(video.framesPerSecond),
          measuredEncodedFps: rate("framesEncoded", 1000), measuredDecodedFps: rate("framesDecoded", 1000),
          measuredSentFps: rate("framesSent", 1000), measuredReceivedFps: rate("framesReceived", 1000),
          bitrateBitsPerSecond: rate(direction === "outbound-rtp" ? "bytesSent" : "bytesReceived", 8000),
          encodeMsPerFrame: perFrame("totalEncodeTime", "framesEncoded", 1000),
          decodeMsPerFrame: perFrame("totalDecodeTime", "framesDecoded", 1000),
          qpPerEncodedFrame: perFrame("qpSum", "framesEncoded", 1),
          jitterBufferMsPerEmittedFrame: perFrame("jitterBufferDelay", "jitterBufferEmittedCount", 1000),
          framesEncoded: number(video.framesEncoded), framesDecoded: number(video.framesDecoded),
          framesDropped: number(video.framesDropped), freezeCount: number(video.freezeCount),
          totalFreezesDurationSec: number(video.totalFreezesDuration),
          packetsLost: number(video.packetsLost ?? remote?.packetsLost),
          jitterMs: duration(video.jitter ?? remote?.jitter),
          qualityLimitationReason: text(video.qualityLimitationReason),
        },
        network: {
          roundTripTimeMs: duration(pair?.currentRoundTripTime ?? remote?.roundTripTime),
          availableOutgoingBitrate: number(pair?.availableOutgoingBitrate),
          basis: pair ? "selected_candidate_pair" : remote ? "remote_inbound_rtp" : "unavailable",
        },
      };
    }
  }

  function senderParameters(sender) {
    if (typeof sender?.getParameters !== "function") return null;
    try {
      const p = sender.getParameters();
      return {
        degradationPreference: text(p.degradationPreference),
        encodings: Array.isArray(p.encodings) ? p.encodings.slice(0, 4).map((e) => ({
          maxBitrate: number(e.maxBitrate), maxFramerate: number(e.maxFramerate),
          scaleResolutionDownBy: number(e.scaleResolutionDownBy), active: typeof e.active === "boolean" ? e.active : null,
        })) : null,
      };
    } catch (_) { return null; }
  }

  function trackSettings(track) {
    try {
      const s = track?.getSettings?.();
      return { width: number(s?.width), height: number(s?.height), requestedFrameRate: number(s?.frameRate), contentHint: text(track?.contentHint) };
    } catch (_) { return null; }
  }

  function frameObservation(now, metadata) {
    const m = metadata || {};
    const capture = number(m.captureTime), presentation = number(m.presentationTime);
    const age = capture !== null && presentation !== null ? presentation - capture : null;
    return {
      observedAtMonotonicMs: number(now), width: number(m.width), height: number(m.height),
      mediaTimeSec: number(m.mediaTime), presentedFrames: number(m.presentedFrames), rtpTimestamp: number(m.rtpTimestamp),
      captureToCompositionEstimateMs: age,
      captureClockBasis: capture === null ? "unavailable" : "browser_estimated_remote_capture_in_receiver_clock",
      captureClockEstimateNonnegative: age === null ? null : age >= 0,
      receiveToCompositionMs: number(m.receiveTime) !== null && presentation !== null ? presentation - m.receiveTime : null,
      processingDurationMs: duration(m.processingDuration),
      expectedDisplayTimeMs: number(m.expectedDisplayTime),
      evidenceStage: "submitted_for_composition_not_physical_display_or_acoustic_sync",
    };
  }

  root.MXSMirrorDiagnostics = Object.freeze({ Sampler, senderParameters, trackSettings, frameObservation });
})(typeof window !== "undefined" ? window : globalThis);

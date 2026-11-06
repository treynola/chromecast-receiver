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
      const candidates = rows.filter((row) => row.type === direction && (row.kind === "video" || row.mediaType === "video") && !row.isRemote && row.active !== false);
      const advancing = (row) => {
        const old = this.previous.get(row.id);
        const field = direction === "outbound-rtp" ? "framesEncoded" : "framesDecoded";
        return old && difference(number(row[field]), old[field]) > 0 ? 1 : 0;
      };
      const video = candidates.sort((a, b) => advancing(b) - advancing(a) ||
        (b.bytesSent ?? b.bytesReceived ?? 0) - (a.bytesSent ?? a.bytesReceived ?? 0))[0];
      if (!video) return { status: "video_stats_unavailable", video: null, network: null };
      const previous = this.previous.get(video.id);
      const counters = {};
      for (const key of ["timestamp", "bytesSent", "bytesReceived", "framesEncoded", "framesDecoded", "framesSent", "framesReceived", "qpSum", "totalEncodeTime", "totalDecodeTime", "jitterBufferDelay", "jitterBufferEmittedCount"]) counters[key] = number(video[key]);
      for (const row of candidates.slice(0, 8)) {
        const values = { codecId: row.codecId };
        for (const key of Object.keys(counters)) values[key] = number(row[key]);
        this.previous.set(row.id, values);
      }
      while (this.previous.size > 8) this.previous.delete(this.previous.keys().next().value);
      const intervalMs = previous ? difference(counters.timestamp, previous.timestamp) : null;
      const delta = (key) => previous && previous.codecId === video.codecId ? difference(counters[key], previous[key]) : null;
      const rate = (key, scale) => intervalMs > 0 && delta(key) !== null ? delta(key) * scale / intervalMs : null;
      const perFrame = (sum, frames, scale) => delta(frames) > 0 && delta(sum) !== null ? delta(sum) * scale / delta(frames) : null;
      const codec = report.get?.(video.codecId);
      const transport = report.get?.(video.transportId);
      const pair = report.get?.(transport?.selectedCandidatePairId);
      const remote = report.get?.(video.remoteId);
      return {
        status: "observed", intervalMs,
        video: {
          direction, codec: codecName(codec?.mimeType) ? text(codec.mimeType) : null, profile: codecProfile(codec),
          framesAdvanced: delta(direction === "outbound-rtp" ? "framesEncoded" : "framesDecoded") === null ? null :
            delta(direction === "outbound-rtp" ? "framesEncoded" : "framesDecoded") > 0,
          encoderImplementation: text(video.encoderImplementation), decoderImplementation: text(video.decoderImplementation),
          powerEfficientEncoder: typeof video.powerEfficientEncoder === "boolean" ? video.powerEfficientEncoder : null,
          powerEfficientDecoder: typeof video.powerEfficientDecoder === "boolean" ? video.powerEfficientDecoder : null,
          hardwareAccelerated: null, hardwareEvidence: "not_exposed_by_portable_rtp_statistics",
          width: number(video.frameWidth), height: number(video.frameHeight),
          reportedFramesPerSecond: number(video.framesPerSecond),
          measuredEncodedFps: rate("framesEncoded", 1000), measuredDecodedFps: rate("framesDecoded", 1000),
          measuredSentFps: rate("framesSent", 1000), measuredReceivedFps: rate("framesReceived", 1000),
          bitrateBitsPerSecond: rate(direction === "outbound-rtp" ? "bytesSent" : "bytesReceived", 8000),
          encodeMsPerFrame: perFrame("totalEncodeTime", "framesEncoded", 1000),
          decodeMsPerFrame: perFrame("totalDecodeTime", "framesDecoded", 1000),
          qpPerEncodedFrame: perFrame("qpSum", "framesEncoded", 1),
          jitterBufferMsPerEmittedFrame: perFrame("jitterBufferDelay", "jitterBufferEmittedCount", 1000),
          framesEncoded: number(video.framesEncoded), framesDecoded: number(video.framesDecoded),
          framesReceived: number(video.framesReceived),
          framesPendingDecodeEstimate: [video.framesReceived, video.framesDecoded, video.framesDropped].every(v => number(v) !== null)
            ? Math.max(0, video.framesReceived - video.framesDecoded - video.framesDropped) : null,
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

  function codecName(value) {
    if (typeof value !== "string") return null;
    const name = value.replace(/^video\//i, "").toUpperCase();
    return ["VP9", "H264", "VP8", "AV1", "H265", "HEVC"].includes(name) ? name : null;
  }

  function codecProfile(codec) {
    const fmtp = typeof codec?.sdpFmtpLine === "string" ? codec.sdpFmtpLine : "";
    const h264 = /(?:^|;)\s*profile-level-id=([0-9a-f]{6})(?:;|$)/i.exec(fmtp);
    const vp9 = /(?:^|;)\s*profile-id=([0-3])(?:;|$)/i.exec(fmtp);
    return h264 ? h264[1].toLowerCase() : vp9 ? vp9[1] : null;
  }

  function capabilities(api, direction) {
    try {
      const rows = api?.getCapabilities?.("video")?.codecs;
      return Array.isArray(rows) ? rows.filter((c) => codecName(c.mimeType)).slice(0, 16)
        .map((c) => ({ codec: codecName(c.mimeType), profile: codecProfile(c), direction })) : [];
    } catch (_) { return []; }
  }

  function preferCodec(transceiver, api, profile = "auto") {
    const requested = profile === "h264" || profile === "auto" ? "H264" : "VP9";
    const required = profile === "vp9";
    let rows;
    try { rows = api?.getCapabilities?.("video")?.codecs; } catch (_) {}
    let selected = Array.isArray(rows) ? rows.filter((c) => codecName(c.mimeType) === requested) : [];
    const result = { requestedCodec: requested, testProfile: required ? "require_vp9" : profile === "h264" ? "h264_baseline" : "automatic_fallback",
      preferenceApplied: false, fallbackReason: null, capabilities: capabilities(api, "send") };
    if (!selected.length && !required && profile !== "h264" && Array.isArray(rows)) {
      result.fallbackReason = "requested_codec_not_advertised";
      const fallback = rows.find((c) => ["VP8", "VP9"].includes(codecName(c.mimeType)));
      if (fallback) selected = rows.filter((c) => codecName(c.mimeType) === codecName(fallback.mimeType));
    }
    if (!selected.length || typeof transceiver?.setCodecPreferences !== "function") {
      result.fallbackReason = !selected.length ? "requested_codec_not_advertised" : "codec_preference_api_unavailable";
      if (required || profile === "h264") throw Object.assign(new Error(result.fallbackReason), { codecPolicy: result });
      return result;
    }
    try {
      // Keep only API-provided objects, including associated repair codecs.
      // A required codec removes alternative primary codecs so it cannot silently fall back.
      const fallbackOrder = profile === "auto"
        ? requested === "H264" ? ["VP8", "VP9"] : ["H264", "VP8"] : [];
      const codecFallbacks = !required ? fallbackOrder.flatMap((name) => rows.filter((c) => codecName(c.mimeType) === name && !selected.includes(c))) : [];
      const remainder = rows.filter((c) => !selected.includes(c) && !codecFallbacks.includes(c) &&
        /^video\/(?:rtx|red|ulpfec|flexfec-03)$/i.test(c.mimeType));
      transceiver.setCodecPreferences([...selected, ...codecFallbacks, ...remainder]);
      result.preferenceApplied = true;
    } catch (_) {
      result.fallbackReason = "codec_preference_rejected";
      if (required || profile === "h264") throw Object.assign(new Error(result.fallbackReason), { codecPolicy: result });
    }
    return result;
  }

  class CodecTracker {
    constructor(policy = {}) {
      this.policy = policy; this.sender = null; this.receiver = null;
      this.segment = 0; this.signature = null; this.startedAtMs = null;
    }
    observe(side, sample, now) {
      if (!["sender", "receiver"].includes(side) || !Number.isFinite(now)) return false;
      const v = sample?.video;
      if (!v) { this[side] = null; return true; }
      if (side === "sender" ? v.direction !== "outbound-rtp" : v.direction !== "inbound-rtp") return false;
      this[side] = { codec: codecName(v.codec), profile: typeof v.profile === "string" ? v.profile.slice(0, 12) : null,
        framesAdvanced: v.framesAdvanced === true, atMs: now,
        implementation: text(side === "sender" ? v.encoderImplementation : v.decoderImplementation),
        hardwareAccelerated: null };
      return true;
    }
    snapshot(now) {
      const s = this.sender, r = this.receiver;
      const fresh = (row) => row && now >= row.atMs && now - row.atMs <= 15000;
      const sActive = fresh(s) && s.framesAdvanced && s.codec;
      const rActive = fresh(r) && r.framesAdvanced && r.codec;
      const profileMismatch = s?.profile !== null && r?.profile !== null && s?.profile !== undefined && r?.profile !== undefined &&
        (s?.codec === "H264" ? s.profile.slice(0, 4) !== r.profile.slice(0, 4) : s.profile !== r.profile);
      const mismatch = sActive && rActive && (s.codec !== r.codec || profileMismatch);
      const status = mismatch ? "mismatch" : sActive && rActive ? "confirmed" :
        s || r ? "unverified" : "pending";
      const actual = sActive ? s.codec : null;
      const fallback = this.policy.requestedCodec === "VP9" && actual && actual !== "VP9";
      const classification = status !== "confirmed" ? status : actual === "VP9" ? "vp9" :
        actual === "H264" ? fallback ? "h264_fallback" : "h264_baseline" : "other";
      const signature = JSON.stringify([s?.codec, s?.profile, r?.codec, r?.profile, classification]);
      if (signature !== this.signature) { this.segment++; this.signature = signature; this.startedAtMs = now; }
      return { requestedCodec: this.policy.requestedCodec || "VP9", testProfile: this.policy.testProfile || "automatic_fallback",
        senderCodec: sActive ? s.codec : null, receiverCodec: rActive ? r.codec : null,
        senderProfile: s?.profile ?? null, receiverProfile: r?.profile ?? null,
        encoderImplementation: s?.implementation ?? null, decoderImplementation: r?.implementation ?? null,
        hardwareAccelerated: null, hardwareEvidence: "not_exposed_by_portable_rtp_statistics",
        senderObservationAgeMs: s ? now - s.atMs : null, receiverObservationAgeMs: r ? now - r.atMs : null,
        senderFramesAdvanced: Boolean(sActive), receiverFramesAdvanced: Boolean(rActive),
        fallbackUsed: Boolean(fallback), fallbackReason: fallback ? this.policy.fallbackReason || "negotiation_selected_alternative" : null,
        verificationStatus: status, classification, segmentId: this.segment, segmentStartedAtMonotonicMs: this.startedAtMs,
        evidenceBasis: "active_rtp_codec_statistics_and_advancing_frames_on_both_peers" };
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
    const receiveToCompositionRaw = number(m.receiveTime) !== null && presentation !== null ? presentation - m.receiveTime : null;
    const receiveTimingStatus = receiveToCompositionRaw === null ? "unavailable" :
      receiveToCompositionRaw < 0 ? "negative_delta_unvalidated" :
      receiveToCompositionRaw > 10000 ? "unvalidated_large_delta" : "browser_reported_unvalidated";
    return {
      observedAtMonotonicMs: number(now), width: number(m.width), height: number(m.height),
      mediaTimeSec: number(m.mediaTime), presentedFrames: number(m.presentedFrames), rtpTimestamp: number(m.rtpTimestamp),
      captureToCompositionEstimateMs: age,
      captureClockBasis: capture === null ? "unavailable" : "browser_estimated_remote_capture_in_receiver_clock",
      captureClockEstimateNonnegative: age === null ? null : age >= 0,
      receiveToCompositionMs: receiveToCompositionRaw !== null && receiveToCompositionRaw >= 0 ? receiveToCompositionRaw : null,
      receiveToCompositionRawMs: receiveToCompositionRaw,
      receiveTimingStatus,
      receiveTimeMs: number(m.receiveTime), presentationTimeMs: presentation,
      captureTimeMs: capture, timingUnits: "receiver_browser_monotonic_milliseconds",
      physicalTimingValidated: false,
      processingDurationMs: duration(m.processingDuration),
      expectedDisplayTimeMs: number(m.expectedDisplayTime),
      evidenceStage: "submitted_for_composition_not_physical_display_or_acoustic_sync",
    };
  }

  class PresentationSampler {
    constructor() { this.previous = null; }
    sample(now, callbacks, quality, frame) {
      const old = this.previous;
      const intervalMs = old ? difference(now, old.now) : null;
      const composed = old ? difference(callbacks, old.callbacks) : null;
      const dropped = old ? difference(quality?.droppedVideoFrames, old.dropped) : null;
      const total = old ? difference(quality?.totalVideoFrames, old.total) : null;
      const raw = number(frame?.receiveToCompositionRawMs);
      const frameAgeMs = number(frame?.observedAtMonotonicMs) === null ? null : now - frame.observedAtMonotonicMs;
      const fresh = frameAgeMs !== null && frameAgeMs >= 0 && frameAgeMs <= 1500;
      this.previous = { now, callbacks, dropped: quality?.droppedVideoFrames, total: quality?.totalVideoFrames, raw: fresh ? raw : null };
      return { intervalMs, measuredComposedFps: intervalMs > 0 && composed !== null ? composed * 1000 / intervalMs : null,
        droppedFramesDelta: dropped, totalFramesDelta: total,
        droppedFrameRatio: total > 0 && dropped !== null ? dropped / total : null,
        receiveToCompositionTrendMs: fresh && raw !== null && number(old?.raw) !== null ? raw - old.raw : null,
        frameAgeMs, frameFresh: fresh, physicalTimingValidated: false };
    }
  }

  // One controller per video generation. Rates are interval measurements, never
  // capability advertisements. Large unvalidated timestamps cannot trigger action.
  class WorkloadController {
    constructor(profile = "motion720") { this.profile = ["motion720", "detail720", "detail1080"].includes(profile) ? profile : "motion720"; this.level = 0; this.bad = 0; this.good = 0; this.lastChange = -Infinity; this.lastObservation = -Infinity; }
    limits(track = {}) {
      const profiles = this.profile === "detail1080" ? [[1920, 1080, 30], [1600, 900, 24], [1440, 810, 20], [1280, 720, 15]] :
        this.profile === "detail720" ? [[1280, 720, 24], [1280, 720, 20], [1280, 720, 17], [1280, 720, 15]] :
        [[1280, 720, 30], [1280, 720, 24], [1280, 720, 20], [1280, 720, 15]];
      const [width, height, fps] = profiles[this.level];
      const known = number(track.width) > 0 && number(track.height) > 0;
      return { maxFramerate: fps, maxBitrate: 6000000,
        scaleResolutionDownBy: this.level === 0 ? 1 : known ? Math.max(1, track.width / width, track.height / height) : 1,
        dimensionsKnown: known, maxWidth: width, maxHeight: height, qualityProfile: this.profile };
    }
    observe(data, now) {
      const v = data?.video, interval = number(data?.intervalMs);
      const received = number(v?.measuredReceivedFps), decoded = number(v?.measuredDecodedFps);
      const elapsed = now - this.lastObservation;
      this.lastObservation = now;
      if (!Number.isFinite(now) || !interval || interval < 500 || interval > 10000 ||
          elapsed < 500 ||
          received === null || decoded === null || received < 5 || decoded < 0) {
        this.bad = 0; this.good = 0; return { action: "hold", status: "unknown" };
      }
      const pending = number(v?.framesPendingDecodeEstimate);
      const presentation = data?.presentation;
      const composed = number(presentation?.measuredComposedFps);
      const droppedRatio = number(presentation?.droppedFrameRatio);
      const levelRates = this.profile === "detail1080" ? [30, 24, 20, 15] :
        this.profile === "detail720" ? [24, 20, 17, 15] : [30, 24, 20, 15];
      const targetFps = levelRates[this.level] || 15;
      const decodeOverload = decoded < received * 0.8 || (pending !== null && pending > received * 0.5);
      const presentationOverload = (composed !== null && composed < targetFps * 0.8) ||
        (droppedRatio !== null && droppedRatio > 0.15);
      const overloaded = decodeOverload || presentationOverload;
      const decodeMs = number(v?.decodeMsPerFrame ?? presentation?.decodeMsPerFrame);
      const clean = number(presentation?.droppedFramesDelta) === 0 && decodeMs !== null && decodeMs < 15;
      this.bad = overloaded ? this.bad + 1 : 0;
      this.good = clean ? this.good + 1 : 0;
      if (!overloaded && this.level > 0 && this.good >= 3 && now - this.lastChange >= 10000) {
        return { action: "improve", status: "three_clean_windows" };
      }
      if (now - this.lastChange < 10000) return { action: "hold", status: overloaded ? "overloaded" : "observed" };
      if (this.bad >= 2) {
        this.bad = 0;
        return { action: this.level < 3 ? "reduce" : "recover", status: "receiver_decode_overload" };
      }
      return { action: "hold", status: overloaded ? "overloaded" : "observed" };
    }
    commit(now) { this.level = Math.min(3, this.level + 1); this.lastChange = now; this.bad = 0; }
    recover(now) { this.level = Math.max(0, this.level - 1); this.lastChange = now; this.good = 0; }
  }

  root.MXSMirrorDiagnostics = Object.freeze({ Sampler, senderParameters, trackSettings, frameObservation,
    codecName, codecProfile, capabilities, preferCodec, CodecTracker, PresentationSampler, WorkloadController });
})(typeof window !== "undefined" ? window : globalThis);

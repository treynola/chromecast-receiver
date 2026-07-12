/* PCM v2 framing shared by the Studio sender and Cast receiver. */
(function (root) {
  "use strict";

  const MAGIC = 0x3250584d; // "MXP2" as a little-endian u32.
  const VERSION = 2;
  const HEADER_BYTES = 64;
  const FORMAT_PCM_SIGNED = 1;
  const CHANNELS = 2;
  const BIT_DEPTH = 16;
  const BYTES_PER_FRAME = 4;
  const MAX_U64 = (1n << 64n) - 1n;

  function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  function asU64(value, field) {
    let parsed;
    try {
      parsed = BigInt(value);
    } catch {
      fail(`invalid_${field}`);
    }
    if (parsed < 0n || parsed > MAX_U64) fail(`invalid_${field}`);
    return parsed;
  }

  function asBytes(input) {
    if (!input || typeof input !== "object") fail("invalid_payload");
    try {
      if (ArrayBuffer.isView(input)) {
        return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      }
      return new Uint8Array(input);
    } catch {
      fail("invalid_payload");
    }
  }

  function validateSampleRate(sampleRate) {
    if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000) {
      fail("invalid_sample_rate");
    }
  }

  function validateHeader(header, payloadBytes) {
    if (
      header.magic !== MAGIC ||
      header.version !== VERSION ||
      header.headerBytes !== HEADER_BYTES
    ) {
      fail("unsupported_header");
    }
    if (header.flags !== 0 || header.reserved !== 0n) fail("unsupported_flags");
    if (
      header.channels !== CHANNELS ||
      header.format !== FORMAT_PCM_SIGNED ||
      header.bitDepth !== BIT_DEPTH
    ) {
      fail("unsupported_format");
    }
    if (header.sessionId === 0n) fail("invalid_session");
    validateSampleRate(header.sampleRate);
    if (
      !Number.isInteger(header.frameCount) ||
      header.frameCount < 1 ||
      header.frameCount > Math.floor(0xffffffff / BYTES_PER_FRAME) ||
      header.payloadBytes !== header.frameCount * BYTES_PER_FRAME
    ) {
      fail("inconsistent_frame_count");
    }
    if (payloadBytes !== header.payloadBytes) fail("payload_length_mismatch");
  }

  function encode({
    sessionId,
    sequence,
    sourceFrame,
    captureTimeUs,
    sampleRate,
    payload,
  }) {
    const bytes = asBytes(payload);
    if (
      bytes.byteLength === 0 ||
      bytes.byteLength > 0xffffffff ||
      bytes.byteLength % BYTES_PER_FRAME !== 0
    ) {
      fail("inconsistent_frame_count");
    }
    validateSampleRate(sampleRate);

    const normalizedSessionId = asU64(sessionId, "session_id");
    if (normalizedSessionId === 0n) fail("invalid_session");
    const normalizedSequence = asU64(sequence, "sequence");
    const normalizedSourceFrame = asU64(sourceFrame, "source_frame");
    const normalizedCaptureTimeUs = asU64(captureTimeUs, "capture_time");

    const output = new Uint8Array(HEADER_BYTES + bytes.byteLength);
    const view = new DataView(output.buffer);
    view.setUint32(0, MAGIC, true);
    view.setUint8(4, VERSION);
    view.setUint8(5, HEADER_BYTES);
    view.setUint16(6, 0, true);
    view.setBigUint64(8, normalizedSessionId, true);
    view.setBigUint64(16, normalizedSequence, true);
    view.setBigUint64(24, normalizedSourceFrame, true);
    view.setBigUint64(32, normalizedCaptureTimeUs, true);
    view.setUint32(40, sampleRate, true);
    view.setUint32(44, bytes.byteLength, true);
    view.setUint32(48, bytes.byteLength / BYTES_PER_FRAME, true);
    view.setUint16(52, CHANNELS, true);
    view.setUint8(54, FORMAT_PCM_SIGNED);
    view.setUint8(55, BIT_DEPTH);
    view.setBigUint64(56, 0n, true);
    output.set(bytes, HEADER_BYTES);
    return output.buffer;
  }

  function decode(input) {
    const bytes = asBytes(input);
    if (bytes.byteLength < HEADER_BYTES) fail("truncated_header");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const header = {
      magic: view.getUint32(0, true),
      version: view.getUint8(4),
      headerBytes: view.getUint8(5),
      flags: view.getUint16(6, true),
      sessionId: view.getBigUint64(8, true),
      sequence: view.getBigUint64(16, true),
      sourceFrame: view.getBigUint64(24, true),
      captureTimeUs: view.getBigUint64(32, true),
      sampleRate: view.getUint32(40, true),
      payloadBytes: view.getUint32(44, true),
      frameCount: view.getUint32(48, true),
      channels: view.getUint16(52, true),
      format: view.getUint8(54),
      bitDepth: view.getUint8(55),
      reserved: view.getBigUint64(56, true),
    };
    validateHeader(header, bytes.byteLength - HEADER_BYTES);
    return { header, payload: bytes.slice(HEADER_BYTES).buffer };
  }

  class SequenceValidator {
    constructor(sessionId, options = {}) {
      this.sessionId = asU64(sessionId, "session_id");
      if (this.sessionId === 0n) fail("invalid_session");
      this.allowInitialOffset = options.allowInitialOffset === true;
      this.initialized = false;
      this.nextSequence = 0n;
      this.nextSourceFrame = 0n;
      this.sampleRate = null;
    }

    accept(header) {
      if (!header || typeof header !== "object") fail("invalid_header");
      if (header.sessionId !== this.sessionId) fail("stale_session");

      if (!this.initialized) {
        if (!this.allowInitialOffset && header.sequence !== 0n) fail("sequence_gap");
        if (!this.allowInitialOffset && header.sourceFrame !== 0n) {
          fail("source_frame_discontinuity");
        }
        const nextSequence = header.sequence + 1n;
        const nextSourceFrame = header.sourceFrame + BigInt(header.frameCount);
        if (nextSequence > MAX_U64 || nextSourceFrame > MAX_U64) {
          fail("counter_overflow");
        }
        this.nextSequence = nextSequence;
        this.nextSourceFrame = nextSourceFrame;
        this.sampleRate = header.sampleRate;
        this.initialized = true;
        return Object.freeze({
          baseline: true,
          baselineSequence: header.sequence,
          baselineSourceFrame: header.sourceFrame,
          sequenceGap: 0n,
          sourceFrameGap: 0n,
        });
      }

      if (header.sampleRate !== this.sampleRate) fail("sample_rate_change");
      if (header.sequence < this.nextSequence) {
        fail(
          header.sequence === this.nextSequence - 1n
            ? "duplicate_packet"
            : "out_of_order_packet",
        );
      }
      if (header.sourceFrame < this.nextSourceFrame) fail("source_frame_regression");

      const observation = Object.freeze({
        baseline: false,
        baselineSequence: 0n,
        baselineSourceFrame: 0n,
        sequenceGap: header.sequence - this.nextSequence,
        sourceFrameGap: header.sourceFrame - this.nextSourceFrame,
      });
      const nextSequence = header.sequence + 1n;
      const nextSourceFrame = header.sourceFrame + BigInt(header.frameCount);
      if (nextSequence > MAX_U64 || nextSourceFrame > MAX_U64) {
        fail("counter_overflow");
      }
      this.nextSequence = nextSequence;
      this.nextSourceFrame = nextSourceFrame;
      return observation;
    }
  }

  root.MXSPcmV2 = Object.freeze({
    MAGIC,
    VERSION,
    HEADER_BYTES,
    FORMAT_PCM_SIGNED,
    CHANNELS,
    BIT_DEPTH,
    BYTES_PER_FRAME,
    encode,
    decode,
    SequenceValidator,
  });
})(typeof window !== "undefined" ? window : globalThis);

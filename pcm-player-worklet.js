/* global AudioWorkletProcessor, registerProcessor, currentFrame, currentTime, sampleRate */
/**
 * Clock-Sync PCM v2 fixed-target receiver jitter buffer.
 * Rust owns drift correction. This processor always dequeues at unity rate.
 */

class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    this._channels = 2;
    // The robust drain estimator needs at least three seconds before it can
    // freeze a target. Keep enough silent startup history to reach that lock
    // without misclassifying expected pre-target buildup as a ring emergency.
    this._ringLen = 768000; // 384,000 stereo frames, eight seconds at 48 kHz.
    this._ringBuffer = new Int16Array(this._ringLen);
    this._writePtr = 0;
    this._readFrameIdx = 0;
    this._totalWritten = 0;
    this._totalRead = 0;

    const processorOptions = options.processorOptions || {};
    this._studioRate = processorOptions.studioRate || 48000;
    this._bitDepth = processorOptions.bitDepth === 24 ? 24 : 16;

    // Rust sends one exact frame target before audible dequeue. The wall
    // target never changes during that PCM session.
    this._TARGET_WALL_MS = 450;
    this._TARGET_TOLERANCE_MS = 25;
    this._EMERGENCY_FLOOR_MS = 75;
    this._CROSSFADE_MS = 12;
    // Keep the clock-safe target acquisition window. This is queue settling,
    // not an audible fade; removing it lets the controller acquire on a
    // transient startup queue and destabilize playout.
    this._STARTUP_SETTLE_MS = 750;
    this._QUEUE_CONTROL_FILTER_MS = 1000;
    this._DIAG_INTERVAL_CALLBACKS = 120;
    this._targetSessionId = null;
    this._targetFrames = 0;
    this._targetSamples = 0;
    this._targetDrainHz = 0;
    this._targetEstimatorLockedWhenFrozen = null;
    this._targetLocked = false;
    this._targetConfigAccepts = 0;
    this._targetConfigRejects = 0;
    this._startupAlignmentRequired = false;
    this._startupSettleFramesRemaining = 0;
    this._queueFilterAlphaPerBlock = 0;
    this._queueControlFrames = null;
    this._emergencyFloorFrames = 0;
    this._crossfadeLengthFrames = Math.max(
      128,
      Math.round((this._studioRate * this._CROSSFADE_MS) / 1000),
    );

    this._isBuffering = true;
    this._playoutStarted = false;
    this._paused = false;
    this._emergencyAwaitingRecovery = false;
    this._crossfadeKind = null;
    this._crossfadeFramesRemaining = 0;
    this._crossfadeFramesTotal = 0;
    this._crossfadeFromL = 0;
    this._crossfadeFromR = 0;
    this._lastOutputL = 0;
    this._lastOutputR = 0;

    this._callbackCount = 0;
    this._framesProcessed = 0;
    this._outputFrames = 0;
    this._renderedFrames = 0;
    this._silenceFrames = 0;
    this._droppedFrames = 0;
    this._currentPeak = 0;
    this._wallStartMs = 0;
    this._lastDiagWallMs = 0;
    this._lastDiagFramesProcessed = 0;
    this._lastPacketWallMs = 0;
    this._lastPacketMetadata = null;

    this._startupPrebuffers = 0;
    this._startupAlignmentCount = 0;
    this._startupAlignmentDroppedFrames = 0;
    this._intentionalResetCount = 0;
    this._intentionalResetDroppedFrames = 0;
    this._underrunCount = 0;
    this._overrunCount = 0;
    this._emergencyFailureCount = 0;
    this._emergencyRecoveryCount = 0;
    this._emergencyCursorJumps = 0;
    this._emergencyDroppedFrames = 0;
    this._qualityRunFailed = false;
    this._lastEmergencyReason = null;
    this._crossfadesStarted = 0;
    this._crossfadesCompleted = 0;
    this._crossfadeFramesRendered = 0;
    this._crossfadeMaxSampleStep = 0;

    this._targetAcquired = false;
    this._targetAcquisitionFrames = 0;
    this._targetAdherenceSamples = 0;
    this._targetWithinToleranceSamples = 0;
    this._rawTargetAdherenceSamples = 0;
    this._rawTargetWithinToleranceSamples = 0;

    this.port.onmessage = (event) => {
      try {
        const message = event.data;
        if (message && message.type === "RESET") {
          this._intentionalReset();
          return;
        }
        if (message && message.type === "PAUSE") {
          this._paused = true;
          this.port.postMessage({ type: "LOG", msg: "Worklet playout PAUSED (hold)." });
          return;
        }
        if (message && message.type === "RESUME") {
          this._paused = false;
          this.port.postMessage({ type: "LOG", msg: "Worklet playout RESUMED (hold released)." });
          return;
        }
        if (message && message.type === "CONFIG") {
          if (message.bitDepth) this._bitDepth = message.bitDepth === 24 ? 24 : 16;
          this.port.postMessage({ type: "LOG", msg: "Worklet message: CONFIG" });
          return;
        }
        if (message && message.type === "JITTER_TARGET") {
          this._configureFrozenTarget(message);
          return;
        }

        let packetMetadata = null;
        let payload = message;
        if (message && message.type === "PCM_PACKET") {
          packetMetadata = message.metadata || null;
          payload = message.payload;
        }
        const arrayBuffer = this._extractArrayBuffer(payload);
        if (!arrayBuffer) return;

        this._lastPacketWallMs = typeof Date !== "undefined" ? Date.now() : 0;
        this._lastPacketMetadata = packetMetadata;
        this._writePcm(arrayBuffer);
      } catch (error) {
        this.port.postMessage({ type: "LOG", msg: `Worklet error: ${error.message}` });
      }
    };
  }

  _extractArrayBuffer(payload) {
    if (!payload) return null;
    if (payload instanceof ArrayBuffer || typeof payload.byteLength === "number") {
      return payload;
    }
    if (
      payload.buffer &&
      (payload.buffer instanceof ArrayBuffer || typeof payload.buffer.byteLength === "number")
    ) {
      return payload.buffer;
    }
    return null;
  }

  _writePcm(arrayBuffer) {
    if (this._bitDepth === 24) {
      const bytes = new Uint8Array(arrayBuffer);
      const numSamples = Math.floor(bytes.length / 3);
      for (let i = 0; i < numSamples; i++) {
        const offset = i * 3;
        let value = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
        if (value & 0x800000) value |= 0xff000000;
        this._ringBuffer[this._writePtr] = value >> 8;
        this._writePtr = (this._writePtr + 1) % this._ringLen;
        this._totalWritten++;
      }
      return;
    }

    const pcm16 = new Int16Array(arrayBuffer);
    const len = pcm16.length;
    if (this._writePtr + len <= this._ringLen) {
      this._ringBuffer.set(pcm16, this._writePtr);
      this._writePtr = (this._writePtr + len) % this._ringLen;
    } else {
      const firstPart = this._ringLen - this._writePtr;
      this._ringBuffer.set(pcm16.subarray(0, firstPart), this._writePtr);
      this._ringBuffer.set(pcm16.subarray(firstPart), 0);
      this._writePtr = len - firstPart;
    }
    this._totalWritten += len;
  }

  _configureFrozenTarget(message) {
    const sessionId = String(message.sessionId || "");
    const targetFrames = Number(message.targetFrames);
    const targetWallMs = Number(message.targetWallMs);
    const drainHz = Number(message.drainHz);
    const estimatorLockedWhenFrozen = message.estimatorLockedWhenFrozen;
    const valid =
      sessionId.length > 0 &&
      Number.isInteger(targetFrames) &&
      targetFrames > 0 &&
      targetFrames < this._ringLen / this._channels &&
      targetWallMs === this._TARGET_WALL_MS &&
      Number.isFinite(drainHz) &&
      drainHz >= 16000 &&
      drainHz <= 96000 &&
      typeof estimatorLockedWhenFrozen === "boolean" &&
      Math.abs((targetFrames * 1000) / drainHz - targetWallMs) <= 0.1;

    if (!valid) {
      this._targetConfigRejects++;
      this._qualityRunFailed = true;
      this._lastEmergencyReason = "invalid_target_config";
      this.port.postMessage({ type: "LOG", msg: "Jitter target rejected: invalid configuration." });
      return;
    }

    if (this._targetLocked && this._targetSessionId === sessionId) {
      const unchanged =
        this._targetFrames === targetFrames &&
        this._targetDrainHz === drainHz &&
        this._targetEstimatorLockedWhenFrozen === estimatorLockedWhenFrozen;
      if (unchanged) return;
      this._targetConfigRejects++;
      this._qualityRunFailed = true;
      this._lastEmergencyReason = "audible_target_change_rejected";
      this.port.postMessage({ type: "LOG", msg: "Jitter target change rejected for active session." });
      return;
    }

    if (this._playoutStarted && this._targetSessionId !== sessionId) {
      this._targetConfigRejects++;
      this._qualityRunFailed = true;
      this._lastEmergencyReason = "session_target_change_without_reset";
      this.port.postMessage({ type: "LOG", msg: "Jitter target rejected: active session was not reset." });
      return;
    }

    this._targetSessionId = sessionId;
    this._targetFrames = targetFrames;
    this._targetSamples = targetFrames * this._channels;
    this._targetDrainHz = drainHz;
    this._targetEstimatorLockedWhenFrozen = estimatorLockedWhenFrozen;
    this._crossfadeLengthFrames = Math.max(
      128,
      Math.round((drainHz * this._CROSSFADE_MS) / 1000),
    );
    this._emergencyFloorFrames = Math.max(
      this._crossfadeLengthFrames + 128,
      Math.round((drainHz * this._EMERGENCY_FLOOR_MS) / 1000),
    );
    this._queueFilterAlphaPerBlock = 1 - Math.exp(
      -(128 * 1000) / (drainHz * this._QUEUE_CONTROL_FILTER_MS),
    );
    this._targetLocked = true;
    this._targetConfigAccepts++;
    this._startupAlignmentRequired = true;
    this._startupSettleFramesRemaining = Math.round(
      (drainHz * this._STARTUP_SETTLE_MS) / 1000,
    );
    this.port.postMessage({
      type: "TARGET_CONFIGURED",
      sessionId,
      targetFrames,
      targetWallMs,
      drainHz,
      estimatorLockedWhenFrozen,
    });
  }

  _alignSilentStartupBacklog() {
    if (this._playoutStarted || !this._isBuffering || !this._targetLocked) return;
    const availableSamples = Math.max(0, this._totalWritten - this._totalRead);
    if (availableSamples <= this._targetSamples) return;

    const droppedFrames = Math.floor((availableSamples - this._targetSamples) / this._channels);
    this._reanchorReadCursor(this._targetSamples);
    this._droppedFrames += droppedFrames;
    this._startupAlignmentDroppedFrames += droppedFrames;
    this._startupAlignmentCount++;
    this._startupAlignmentRequired = false;
    this.port.postMessage({
      type: "LOG",
      msg: `Startup backlog aligned: discarded ${droppedFrames} pre-audible frames.`,
    });
  }

  _intentionalReset() {
    const hadStartedPlayout = this._playoutStarted;
    const queuedFrames = Math.floor(Math.max(0, this._totalWritten - this._totalRead) / 2);
    this._droppedFrames += queuedFrames;
    this._intentionalResetDroppedFrames += queuedFrames;
    this._intentionalResetCount++;
    this._ringBuffer.fill(0);
    this._writePtr = 0;
    this._readFrameIdx = 0;
    this._totalWritten = 0;
    this._totalRead = 0;
    this._isBuffering = true;
    this._playoutStarted = false;
    this._emergencyAwaitingRecovery = false;
    this._crossfadeKind = null;
    this._crossfadeFramesRemaining = 0;
    this._lastOutputL = 0;
    this._lastOutputR = 0;
    this._currentPeak = 0;
    this._lastPacketWallMs = 0;
    this._lastPacketMetadata = null;
    this._targetAcquired = false;
    this._targetAcquisitionFrames = 0;
    this._queueControlFrames = null;
    this._startupAlignmentRequired = this._targetLocked && !hadStartedPlayout;
    this._startupSettleFramesRemaining = this._startupAlignmentRequired
      ? Math.round((this._targetDrainHz * this._STARTUP_SETTLE_MS) / 1000)
      : 0;
    this.port.postMessage({ type: "LOG", msg: "Worklet intentional queue RESET complete." });
  }

  _markEmergency(reason) {
    this._emergencyFailureCount++;
    this._qualityRunFailed = true;
    this._lastEmergencyReason = reason;
  }

  _startCrossfade(kind, fromL, fromR) {
    this._crossfadeKind = kind;
    this._crossfadeFramesTotal = this._crossfadeLengthFrames;
    this._crossfadeFramesRemaining = this._crossfadeLengthFrames;
    this._crossfadeFromL = fromL;
    this._crossfadeFromR = fromR;
    this._crossfadesStarted++;
  }

  _finishCrossfade(kind) {
    this._crossfadesCompleted++;
    this._crossfadeKind = null;
    this._crossfadeFramesRemaining = 0;
    if (kind === "underrun_fade_out") {
      this._isBuffering = true;
      this._emergencyAwaitingRecovery = true;
    }
  }

  _reanchorReadCursor(targetSamples = this._targetSamples) {
    const ringLenFrames = this._ringLen >> 1;
    const target = Math.max(0, Math.min(targetSamples & ~1, this._ringLen));
    const targetFrames = target >> 1;
    this._totalRead = Math.max(0, this._totalWritten - target);
    this._readFrameIdx = ((this._writePtr >> 1) - targetFrames + ringLenFrames) % ringLenFrames;
    return target;
  }

  _handleOverrun(available) {
    this._overrunCount++;
    this._markEmergency("ring_overrun");
    const retainedSamples = this._targetLocked ? this._targetSamples : this._ringLen >> 1;
    const droppedFrames = Math.floor(Math.max(0, available - retainedSamples) / 2);
    this._droppedFrames += droppedFrames;
    this._emergencyDroppedFrames += droppedFrames;
    this._emergencyCursorJumps++;
    const reanchored = this._reanchorReadCursor(retainedSamples);
    if (!this._isBuffering) {
      this._emergencyRecoveryCount++;
      this._startCrossfade("overrun_reanchor", this._lastOutputL, this._lastOutputR);
    }
    this.port.postMessage({
      type: "LOG",
      msg: `Emergency ring overrun: dropped ${droppedFrames} frames; quality run failed.`,
    });
    return reanchored;
  }

  _startUnderrunRecovery() {
    this._underrunCount++;
    this._markEmergency("queue_underrun");
    this._startCrossfade("underrun_fade_out", 0, 0);
    this.port.postMessage({
      type: "LOG",
      msg: "Emergency queue underrun: fading out and rebuffering; quality run failed.",
    });
  }

  _startBufferedPlayout() {
    this._isBuffering = false;
    this._playoutStarted = true;
    this._targetAcquired = false;
    this._targetAcquisitionFrames = 0;
    this._queueControlFrames = null;
    if (this._emergencyAwaitingRecovery) {
      this._emergencyAwaitingRecovery = false;
      this._emergencyRecoveryCount++;
      this._startCrossfade("underrun_recovery", 0, 0);
      return;
    }
    this._startupPrebuffers++;
    // Startup is immediate once the target queue is ready. Crossfades remain
    // enabled for emergency underrun/overrun recovery only.
  }

  _queueErrorMs(queuedFrames) {
    if (!this._targetLocked || this._targetDrainHz <= 0) return null;
    return ((queuedFrames - this._targetFrames) * 1000) / this._targetDrainHz;
  }

  _recordTargetAdherence(queueErrorMs, rawQueueErrorMs, framesInBlock) {
    if (queueErrorMs === null || this._isBuffering || this._crossfadeKind) return;
    if (!this._targetAcquired) {
      if (Math.abs(queueErrorMs) <= this._TARGET_TOLERANCE_MS) {
        this._targetAcquisitionFrames += framesInBlock;
        if (this._targetAcquisitionFrames >= this._targetDrainHz) {
          this._targetAcquired = true;
        }
      } else {
        this._targetAcquisitionFrames = 0;
      }
      return;
    }
    this._targetAdherenceSamples++;
    if (Math.abs(queueErrorMs) <= this._TARGET_TOLERANCE_MS) {
      this._targetWithinToleranceSamples++;
    }
    this._rawTargetAdherenceSamples++;
    if (Math.abs(rawQueueErrorMs) <= this._TARGET_TOLERANCE_MS) {
      this._rawTargetWithinToleranceSamples++;
    }
  }

  _applyCrossfade(sampleL, sampleR) {
    const kind = this._crossfadeKind;
    if (!kind || this._crossfadeFramesRemaining <= 0) {
      return [sampleL, sampleR, false];
    }
    const progress =
      (this._crossfadeFramesTotal - this._crossfadeFramesRemaining + 1) /
      this._crossfadeFramesTotal;
    let outputL;
    let outputR;
    if (kind === "underrun_fade_out") {
      const gain = 1 - progress;
      outputL = sampleL * gain;
      outputR = sampleR * gain;
    } else {
      outputL = this._crossfadeFromL + (sampleL - this._crossfadeFromL) * progress;
      outputR = this._crossfadeFromR + (sampleR - this._crossfadeFromR) * progress;
    }
    this._crossfadeFramesRemaining--;
    this._crossfadeFramesRendered++;
    const finished = this._crossfadeFramesRemaining === 0;
    if (finished) this._finishCrossfade(kind);
    return [outputL, outputR, finished && kind === "underrun_fade_out"];
  }

  process(inputs, outputs) {
    try {
      const output = outputs[0];
      const channel0 = output && output[0];
      const channel1 = (output && output[1]) || channel0;
      if (!channel0) return true;

      if (this._paused) {
        channel0.fill(0);
        if (channel1 !== channel0) channel1.fill(0);
        return true;
      }

      const framesInBlock = channel0.length;
      const wallNow = typeof Date !== "undefined" ? Date.now() : 0;
      if (this._wallStartMs === 0 && wallNow) {
        this._wallStartMs = wallNow;
        this._lastDiagWallMs = wallNow;
      }
      this._callbackCount++;

      let available = Math.round(this._totalWritten - this._totalRead);
      if (available > this._ringLen) {
        available = this._handleOverrun(available);
      }

      if (
        this._isBuffering &&
        !this._playoutStarted &&
        this._targetLocked &&
        this._startupSettleFramesRemaining > 0
      ) {
        this._startupSettleFramesRemaining = Math.max(
          0,
          this._startupSettleFramesRemaining - framesInBlock,
        );
      }

      if (
        this._isBuffering &&
        !this._playoutStarted &&
        this._targetLocked &&
        this._startupAlignmentRequired &&
        this._startupSettleFramesRemaining === 0
      ) {
        this._alignSilentStartupBacklog();
        available = Math.round(this._totalWritten - this._totalRead);
      }

      if (
        this._isBuffering &&
        this._targetLocked &&
        this._startupSettleFramesRemaining === 0 &&
        available >= this._targetSamples
      ) {
        this._startBufferedPlayout();
      }

      if (
        !this._isBuffering &&
        this._crossfadeKind !== "underrun_fade_out" &&
        available / 2 < this._emergencyFloorFrames
      ) {
        this._startUnderrunRecovery();
      }

      let frameIdx = this._readFrameIdx;
      let consumed = 0;
      let rendered = 0;
      let renderSilence = this._isBuffering;
      const ringLenFrames = this._ringLen >> 1;
      const inversePcm16 = 1 / 32768;

      for (let i = 0; i < framesInBlock; i++) {
        let outputL = 0;
        let outputR = 0;
        const crossfadeWasActive = !!this._crossfadeKind;
        if (!renderSilence && available - consumed >= 2) {
          const sampleIndex = frameIdx * 2;
          const sampleL = this._ringBuffer[sampleIndex] * inversePcm16;
          const sampleR = this._ringBuffer[sampleIndex + 1] * inversePcm16;
          const crossfaded = this._applyCrossfade(sampleL, sampleR);
          outputL = crossfaded[0];
          outputR = crossfaded[1];
          renderSilence = crossfaded[2];
          frameIdx = (frameIdx + 1) % ringLenFrames;
          consumed += 2;
          rendered++;
        } else if (!renderSilence) {
          // The emergency floor should make this unreachable. Keep it explicit
          // so a scheduling failure cannot masquerade as normal silence.
          this._startUnderrunRecovery();
          this._finishCrossfade("underrun_fade_out");
          renderSilence = true;
        }

        if (crossfadeWasActive) {
          const step = Math.max(
            Math.abs(outputL - this._lastOutputL),
            Math.abs(outputR - this._lastOutputR),
          );
          this._crossfadeMaxSampleStep = Math.max(this._crossfadeMaxSampleStep, step);
        }
        channel0[i] = outputL;
        channel1[i] = outputR;
        this._lastOutputL = outputL;
        this._lastOutputR = outputR;
        this._currentPeak = Math.max(this._currentPeak, Math.abs(outputL), Math.abs(outputR));
      }

      this._readFrameIdx = frameIdx;
      this._totalRead += consumed;
      this._renderedFrames += rendered;
      this._silenceFrames += Math.max(0, framesInBlock - rendered);
      this._framesProcessed += framesInBlock;
      this._outputFrames += framesInBlock;

      const rawQueuedSamples = Math.max(0, this._totalWritten - this._totalRead);
      const rawQueuedFrames = Math.floor(rawQueuedSamples / 2);
      if (this._isBuffering || this._queueControlFrames === null) {
        this._queueControlFrames = rawQueuedFrames;
      } else {
        const alpha = Math.min(
          1,
          this._queueFilterAlphaPerBlock * (framesInBlock / 128),
        );
        this._queueControlFrames += alpha * (rawQueuedFrames - this._queueControlFrames);
      }
      const queuedFrames = Math.round(this._queueControlFrames);
      const queueErrorMs = this._queueErrorMs(queuedFrames);
      const rawQueueErrorMs = this._queueErrorMs(rawQueuedFrames);
      this._recordTargetAdherence(queueErrorMs, rawQueueErrorMs, framesInBlock);

      if (this._callbackCount % this._DIAG_INTERVAL_CALLBACKS === 0) {
        let wallHzReported = 0;
        if (this._lastDiagWallMs && wallNow) {
          const deltaWallMs = wallNow - this._lastDiagWallMs;
          const deltaFrames = this._framesProcessed - this._lastDiagFramesProcessed;
          if (deltaWallMs >= 250 && deltaFrames > 0) {
            wallHzReported = Math.round((deltaFrames * 1000) / deltaWallMs);
            this._lastDiagWallMs = wallNow;
            this._lastDiagFramesProcessed = this._framesProcessed;
          }
        }
        const adherencePercent = this._targetAdherenceSamples > 0
          ? (this._targetWithinToleranceSamples * 100) / this._targetAdherenceSamples
          : null;
        const rawAdherencePercent = this._rawTargetAdherenceSamples > 0
          ? (this._rawTargetWithinToleranceSamples * 100) / this._rawTargetAdherenceSamples
          : null;
        const queueWallMs = this._targetDrainHz > 0
          ? (queuedFrames * 1000) / this._targetDrainHz
          : null;
        const rawQueueWallMs = this._targetDrainHz > 0
          ? (rawQueuedFrames * 1000) / this._targetDrainHz
          : null;
        this.port.postMessage({
          type: "DIAG",
          available: rawQueuedSamples,
          stalled: this._underrunCount,
          rate: 1.0,
          measuredHz: wallHzReported,
          wallHz: wallHzReported,
          peak: this._currentPeak,
          locked:
            this._targetAcquired &&
            queueErrorMs !== null &&
            Math.abs(queueErrorMs) <= this._TARGET_TOLERANCE_MS,
          buffering: this._isBuffering,
          outputFrames: this._outputFrames,
          renderedFrames: this._renderedFrames,
          silenceFrames: this._silenceFrames,
          droppedFrames: this._droppedFrames,
          queuedFrames,
          controlQueuedFrames: queuedFrames,
          rawQueuedFrames,
          targetSessionId: this._targetSessionId,
          targetLocked: this._targetLocked,
          targetWallMs: this._TARGET_WALL_MS,
          targetToleranceMs: this._TARGET_TOLERANCE_MS,
          targetFrames: this._targetFrames,
          targetDrainHz: this._targetDrainHz,
          targetEstimatorLockedWhenFrozen: this._targetEstimatorLockedWhenFrozen,
          crossfadeLengthFrames: this._crossfadeLengthFrames,
          crossfadeWallMs: this._targetDrainHz > 0
            ? (this._crossfadeLengthFrames * 1000) / this._targetDrainHz
            : null,
          queueWallMs,
          queueErrorMs,
          rawQueueWallMs,
          rawQueueErrorMs,
          queueControlFilterMs: this._QUEUE_CONTROL_FILTER_MS,
          targetAcquired: this._targetAcquired,
          targetAdherenceSamples: this._targetAdherenceSamples,
          targetWithinToleranceSamples: this._targetWithinToleranceSamples,
          targetAdherencePercent: adherencePercent,
          rawTargetAdherenceSamples: this._rawTargetAdherenceSamples,
          rawTargetWithinToleranceSamples: this._rawTargetWithinToleranceSamples,
          rawTargetAdherencePercent: rawAdherencePercent,
          targetConfigAccepts: this._targetConfigAccepts,
          targetConfigRejects: this._targetConfigRejects,
          startupPrebuffers: this._startupPrebuffers,
          startupSettleMs: this._STARTUP_SETTLE_MS,
          startupAlignmentRequired: this._startupAlignmentRequired,
          startupSettleFramesRemaining: this._startupSettleFramesRemaining,
          startupAlignments: this._startupAlignmentCount,
          startupAlignmentDroppedFrames: this._startupAlignmentDroppedFrames,
          intentionalResets: this._intentionalResetCount,
          intentionalResetDroppedFrames: this._intentionalResetDroppedFrames,
          underruns: this._underrunCount,
          emergencyOverruns: this._overrunCount,
          emergencyFailures: this._emergencyFailureCount,
          emergencyRecoveries: this._emergencyRecoveryCount,
          emergencyCursorJumps: this._emergencyCursorJumps,
          emergencyDroppedFrames: this._emergencyDroppedFrames,
          qualityRunFailed: this._qualityRunFailed,
          lastEmergencyReason: this._lastEmergencyReason,
          crossfadeKind: this._crossfadeKind,
          crossfadesStarted: this._crossfadesStarted,
          crossfadesCompleted: this._crossfadesCompleted,
          crossfadeFrames: this._crossfadeFramesRendered,
          crossfadeMaxSampleStep: this._crossfadeMaxSampleStep,
          resets: this._intentionalResetCount,
          currentFrame: typeof currentFrame === "number" ? currentFrame : null,
          audioCurrentTimeSeconds: currentTime,
          wallClockMs: wallNow,
          lastPacket: this._lastPacketMetadata || null,
        });
        this._currentPeak = 0;
      }
    } catch (error) {
      this.port.postMessage({ type: "LOG", msg: `Process error: ${error.message}` });
    }
    return true;
  }
}

registerProcessor("pcm-player-worklet", PCMPlayerProcessor);

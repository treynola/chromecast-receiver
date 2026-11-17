(function installStudioLfoWaveforms(window) {
  "use strict";
  const createStudioLfoWaveforms = function createStudioLfoWaveforms({
    ResizeObserver = window.ResizeObserver,
    computeReceiverLfoWaveformValue,
    normalizeReceiverLfoGateValue,
  }) {
        const LFO_WAVEFORM_POINTS = 48;
        const traceYBuffer = new Float32Array(LFO_WAVEFORM_POINTS);
        function draw(canvas, lfoIndex, clock) {
          if (!canvas) return false;
          // Measure once; ResizeObserver supplies later geometry without forcing
          // layout after each control mutation or animation frame.
          if (!canvas._mxsLfoSizeObserved) {
            canvas._mxsLfoSizeObserved = true;
            canvas._mxsLfoLogicalWidth = canvas.clientWidth || 112;
            canvas._mxsLfoLogicalHeight = canvas.clientHeight || 26;
            if (typeof ResizeObserver === "function") {
              canvas._mxsLfoResizeObserver = new ResizeObserver((entries) => {
                const rect = entries[0]?.contentRect;
                if (rect?.width > 0 && rect?.height > 0) {
                  canvas._mxsLfoLogicalWidth = rect.width;
                  canvas._mxsLfoLogicalHeight = rect.height;
                  canvas._mxsLfoSizeDirty = true;
                }
              });
              canvas._mxsLfoResizeObserver.observe(canvas);
            }
          }
          const width = canvas._mxsLfoLogicalWidth || 112;
          const height = canvas._mxsLfoLogicalHeight || 26;
          canvas._mxsLfoLogicalWidth = width;
          canvas._mxsLfoLogicalHeight = height;
          const pixelRatio = Math.max(1, Math.min(4, Number(window.devicePixelRatio) || 1));
          const backingWidth = Math.max(1, Math.round(width * pixelRatio));
          const backingHeight = Math.max(1, Math.round(height * pixelRatio));
          if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
            canvas.width = backingWidth;
            canvas.height = backingHeight;
            canvas._mxsLfoRenderSignature = null;
          }
          const ctx = canvas.getContext("2d");
          if (!ctx) return false;

          const gate = normalizeReceiverLfoGateValue(clock?.gateValue);
          const active = Boolean(clock && clock.active && gate > 0.001);
          const isPaused = Boolean(clock && clock.paused);
          if (canvas.dataset.waveformActive !== (active ? "true" : "false")) {
            canvas.dataset.waveformActive = active ? "true" : "false";
          }
          if (canvas.dataset.waveformPaused !== (isPaused ? "true" : "false")) {
            canvas.dataset.waveformPaused = isPaused ? "true" : "false";
          }
          if (canvas.dataset.waveformPaintMode !== "lfo_traveling") {
            canvas.dataset.waveformPaintMode = "lfo_traveling";
          }
          if (canvas.dataset.waveformPixelRatio !== String(pixelRatio)) {
            canvas.dataset.waveformPixelRatio = String(pixelRatio);
          }
          if (canvas.dataset.waveformPainted !== "true") {
            canvas.dataset.waveformPainted = "true";
          }

          const waveformType = clock?.waveformType || "sine";
          const evalFn = computeReceiverLfoWaveformValue;
          const dutyCycle = Number.isFinite(clock?.dutyCycle) ? clock.dutyCycle : 0.5;
          const pointCount = LFO_WAVEFORM_POINTS;
          const stepX = width / pointCount;
          const colWidth = Math.max(1, Math.ceil(stepX) - 1);
          const basePhase = Number(clock?.phase) || 0;
          const renderSignature = !active && !isPaused
            ? `idle:${width}x${height}@${pixelRatio}:${waveformType}:${dutyCycle.toFixed(4)}`
            : `${active ? "act" : "psd"}:${width}x${height}@${pixelRatio}:${waveformType}:${dutyCycle.toFixed(4)}:${basePhase.toFixed(3)}:${gate.toFixed(3)}`;
          if (canvas._mxsLfoRenderSignature === renderSignature && !canvas._mxsLfoSizeDirty) {
            return true;
          }
          canvas._mxsLfoSizeDirty = false;
          canvas._mxsLfoRenderSignature = renderSignature;

          ctx.imageSmoothingEnabled = false;
          ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

          // 1. Hardware LCD dark teal background & zero-crossing centerline
          ctx.clearRect(0, 0, width, height);
          ctx.fillStyle = "#132227";
          ctx.fillRect(0, 0, width, height);

          const centerY = Math.floor(height / 2);
          ctx.fillStyle = "#223a43";
          ctx.fillRect(0, centerY, width, 1);

          // Subtle oscilloscope quarter-division grid marks
          ctx.fillStyle = "rgba(34, 58, 67, 0.4)";
          ctx.fillRect(0, Math.floor(height * 0.25), width, 1);
          ctx.fillRect(0, Math.floor(height * 0.75), width, 1);
          ctx.fillRect(Math.floor(width / 2), 0, 1, height);

          const canBatchRects = typeof ctx.beginPath === "function" &&
            typeof ctx.rect === "function" &&
            typeof ctx.fill === "function";

          if (!active && !isPaused) {
            // 2. Idle / Resting State: Vivid, crystal-clear oscilloscope trace previewing wave shape
            ctx.fillStyle = "rgba(0, 230, 118, 0.55)";
            if (canBatchRects) ctx.beginPath();

            for (let i = 0; i < pointCount; i++) {
              const pOffset = (i / pointCount) * (Math.PI * 2);
              const restingVal = Math.max(-1, Math.min(1, evalFn(pOffset, waveformType, dutyCycle) * 0.75));
              const clampedMax = Math.max(0, restingVal);
              const clampedMin = Math.min(0, restingVal);
              const yTop = Math.floor(((1 - clampedMax) * height) / 2);
              const yBottom = Math.ceil(((1 - clampedMin) * height) / 2);
              const barH = Math.max(1, yBottom - yTop);
              const x = Math.floor(i * stepX);
              traceYBuffer[i] = Math.floor(((1 - restingVal) * height) / 2);

              const barW = Math.min(colWidth, width - x);
              if (canBatchRects) ctx.rect(x, yTop, barW, barH);
              else ctx.fillRect(x, yTop, barW, barH);
            }
            if (canBatchRects) ctx.fill();

            ctx.strokeStyle = "#00e676";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let i = 0; i < pointCount; i++) {
              const x = Math.floor(i * stepX);
              const traceY = traceYBuffer[i];
              if (i === 0) ctx.moveTo(x + colWidth / 2, traceY);
              else ctx.lineTo(x + colWidth / 2, traceY);
            }
            ctx.stroke();
            return true;
          }

          // 3. Active / Paused Traveling Waveform with True-dBFS Gradient & Moving Oscilloscope Beam
          let gradCache = canvas._mxsLfoGradCache;
          if (!gradCache || gradCache.ctx !== ctx || gradCache.height !== height) {
            const grad = ctx.createLinearGradient(0, 0, 0, height);
            grad.addColorStop(0.00, "#ff3333");
            grad.addColorStop(0.12, "#ffea00");
            grad.addColorStop(0.28, "#00e676");
            grad.addColorStop(0.50, "#00e676");
            grad.addColorStop(0.72, "#00e676");
            grad.addColorStop(0.88, "#ffea00");
            grad.addColorStop(1.00, "#ff3333");
            gradCache = { ctx, height, grad };
            canvas._mxsLfoGradCache = gradCache;
          }
          ctx.fillStyle = gradCache.grad;
          if (canBatchRects) ctx.beginPath();

          const visualAmp = isPaused ? 0.85 : (active ? Math.max(0.75, gate) : 0.85);
          let latestVal = 0;
          for (let i = 0; i < pointCount; i++) {
            const pOffset = (i / pointCount) * (Math.PI * 2);
            const samplePhase = basePhase + pOffset;
            const val = Math.max(-1, Math.min(1, evalFn(samplePhase, waveformType, dutyCycle) * visualAmp));
            latestVal = val;

            const clampedMax = Math.max(0, val);
            const clampedMin = Math.min(0, val);
            const yTop = Math.floor(((1 - clampedMax) * height) / 2);
            const yBottom = Math.ceil(((1 - clampedMin) * height) / 2);
            const barH = Math.max(2, yBottom - yTop);
            const x = Math.floor(i * stepX);
            traceYBuffer[i] = Math.floor(((1 - val) * height) / 2);
            if (x >= width) continue;

            const barW = Math.min(colWidth, width - x);
            if (canBatchRects) ctx.rect(x, yTop, barW, barH);
            else ctx.fillRect(x, yTop, barW, barH);
          }
          if (canBatchRects) ctx.fill();

          ctx.strokeStyle = isPaused ? "#ffea00" : "#00ffff";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (let i = 0; i < pointCount; i++) {
            const x = Math.floor(i * stepX);
            if (x >= width) continue;
            const traceY = traceYBuffer[i];
            if (i === 0) ctx.moveTo(x + colWidth / 2, traceY);
            else ctx.lineTo(x + colWidth / 2, traceY);
          }
          ctx.stroke();

          // 4. Oscilloscope Leading-Edge Playhead Indicator
          const playheadY = Math.floor(((1 - latestVal) * height) / 2);
          ctx.fillStyle = isPaused ? "#ffea00" : "#ffffff";
          ctx.fillRect(width - 3, Math.max(1, playheadY - 2), 3, 5);

          return true;
        }
    return Object.freeze({ draw });
  };

  Object.defineProperty(window, "MXSCreateStudioLfoWaveforms", {
    value: Object.freeze(createStudioLfoWaveforms),
    writable: false,
    configurable: false,
    enumerable: true,
  });
})(window);

/* Studio parameter labels only. Pure formatting; no transport or media state. */
(function () {
  "use strict";
        function formatMirroredLoopTimecode(seconds) {
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

        function formatMirroredParameterDisplay(descriptor, rawValue) {
          const meta = descriptor && typeof descriptor === "object" ? descriptor : {};
          const value = Number(rawValue);
          if (!Number.isFinite(value)) return String(meta.displayValue ?? rawValue ?? "");
          const formatterKind = String(meta.formatterKind || "observed_numeric_v1");
          if (formatterKind === "loop_timecode_v1") {
            return formatMirroredLoopTimecode(value);
          }
          if (formatterKind === "effect_tone_v1") {
            const tone = meta.toneMapping || {};
            const position = Math.max(0, Math.min(1, value));
            const percent = `${Number((position * 100).toFixed(1))}%`;
            if (position === 0.5) return `${percent} · Neutral`;
            if (tone.kind === "shared") {
              const gain = (position - 0.5) * 12;
              return `${percent} · ${gain > 0 ? "+" : ""}${gain.toFixed(1)} dB`;
            }
            const minimum = Number(tone.min);
            const maximum = Number(tone.max);
            const neutral = Number(tone.neutral);
            if (![minimum, maximum, neutral].every(Number.isFinite)) return percent;
            let physical = position <= 0.5
              ? minimum + (neutral - minimum) * position * 2
              : neutral + (maximum - neutral) * (position - 0.5) * 2;
            if (tone.discrete) {
              const step = Number(tone.step) > 0 ? Number(tone.step) : 1;
              physical = Math.max(minimum, Math.min(maximum, Math.round(physical / step) * step));
            }
            const label = tone.discrete && tone.labels?.[Math.round(physical)];
            return `${percent} · ${label || Number(physical.toFixed(3))}${label ? "" : String(tone.nativeUnit || "")}`;
          }
          if (formatterKind === "exact_numeric_v1") {
            const normalized = Object.is(value, -0) ? 0 : value;
            if (normalized === 0 && meta.zeroDisplay !== null && meta.zeroDisplay !== undefined) {
              return String(meta.zeroDisplay);
            }
            const scaled = normalized * (Number(meta.scale) || 1);
            const numeric = meta.rounding === "round"
              ? String(Math.round(scaled))
              : scaled.toFixed(Math.max(0, Math.min(6, Number(meta.decimals) || 0)));
            const signed = meta.signPolicy === "always" && scaled > 0
              ? `+${numeric}`
              : numeric;
            return `${String(meta.prefix || "")}${signed}${String(meta.suffix || "")}`;
          }
          const parameterKey = String(meta.parameterKey || "").toLowerCase();
          const unit = String(meta.unit || "");
          let displayValue = Object.is(value, -0) ? 0 : value;
          let decimals = Math.max(0, Math.min(6, Number(meta.decimals) || 0));
          let unitSpacing = String(meta.unitSpacing || "");
          if (formatterKind === "effect_parameter_v1") {
            const absolute = Math.abs(displayValue);
            decimals = absolute < 10 && displayValue !== 0 ? 2 : 1;
            if (absolute < 1 && displayValue !== 0) decimals = 3;
            if (
              parameterKey.includes("freq") ||
              parameterKey === "pitch" ||
              Number(meta.step) === 1
            ) {
              decimals = 0;
            }
            if (unit === "%") {
              displayValue *= 100;
              decimals = 0;
            }
            unitSpacing = "";
          } else {
            displayValue *= Number(meta.displayScale) || 1;
          }
          return `${displayValue.toFixed(decimals)}${unit ? unitSpacing + unit : ""}`;
        }

  window.MXSStudioParameterDisplay = Object.freeze({
    format: formatMirroredParameterDisplay, loopTimecode: formatMirroredLoopTimecode,
  });
})();

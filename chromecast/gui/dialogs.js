/* Studio dialog presentation only. No credentials, sockets, audio or video. */
(function () {
  "use strict";
  const createStudioDialogs = function ({ document, getEl, getEffectOptions,
    formatMirroredParameterDisplay, readMirroredDisplayDescriptor, writeMirroredDisplayDescriptor }) {
    let disposed = false;
    let generation = 0;
    const frames = new Set(), timers = new Set();
    function queueRender(render) {
      if (disposed) return;
      const current = generation;
      if (typeof window.requestAnimationFrame === "function") {
        const id = window.requestAnimationFrame(() => {
          frames.delete(id);
          if (!disposed && current === generation) render();
        });
        frames.add(id);
      } else {
        const id = setTimeout(() => {
          timers.delete(id);
          if (!disposed && current === generation) render();
        }, 0);
        timers.add(id);
      }
    }
    function cancelPending() {
      generation++;
      for (const id of frames) window.cancelAnimationFrame?.(id);
      for (const id of timers) clearTimeout(id);
      frames.clear(); timers.clear();
    }
        let lastDialogMirrorState = "";
        let lastDialogMirrorLayoutState = "";
        let lastDialogRegistryState = "";
        let lastDialogRenderStats = {
          mode: "none",
          renderTimeMs: 0,
          dialogCount: 0,
          domNodeCount: 0,
        };
        const RECEIVER_EFFECT_DIALOG_ANCHOR_OFFSET_PX = 10;
        function normalizeMirroredDialogClassName(value, fallback = "") {
          const normalized = String(value || "")
            .split(/\s+/)
            .filter((token) => /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(token))
            .slice(0, 24)
            .join(" ");
          return normalized || fallback;
        }
        function syncMirroredElementDataset(element, data) {
          if (!element) return;
          let previousKeys = [];
          try {
            previousKeys = JSON.parse(element.dataset.castMirroredDataKeys || "[]");
          } catch (_error) {}
          previousKeys.forEach((key) => {
            if (/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(key)) delete element.dataset[key];
          });
          const nextKeys = [];
          Object.entries(data || {}).forEach(([key, value]) => {
            if (!/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(key)) return;
            if (value === undefined || value === null) return;
            element.dataset[key] = String(value).slice(0, 128);
            nextKeys.push(key);
          });
          element.dataset.castMirroredDataKeys = JSON.stringify(nextKeys);
        }
        function renderMirroredSamplerCanvases(panel, dialog) {
          if (!panel) return;
          const envelopeCanvas = panel.querySelector("[data-sampler-envelope]");
          if (envelopeCanvas) {
            const read = (label, fallback) => {
              const value = Number(panel.querySelector(`[aria-label="${label}"]`)?.value);
              return Number.isFinite(value) ? value : fallback;
            };
            const attack = Math.max(0.001, read("Amp Attack", Number(envelopeCanvas.dataset.envelopeAttack) || 0.002));
            const decay = Math.max(0.001, read("Amp Decay", Number(envelopeCanvas.dataset.envelopeDecay) || 0.1));
            const sustain = Math.max(0, Math.min(1, read("Amp Sustain", Number(envelopeCanvas.dataset.envelopeSustain) || 0)));
            const release = Math.max(0.001, read("Amp Release", Number(envelopeCanvas.dataset.envelopeRelease) || 0.01));
            const context = envelopeCanvas.getContext?.("2d");
            if (context) {
              const width = Math.max(1, Math.round(envelopeCanvas.clientWidth || 560));
              const height = Math.max(1, Math.round(envelopeCanvas.clientHeight || 88));
              if (envelopeCanvas.width !== width) envelopeCanvas.width = width;
              if (envelopeCanvas.height !== height) envelopeCanvas.height = height;
              const hold = Math.max(0.15, (attack + decay + release) * 0.22);
              const total = attack + decay + hold + release;
              const x = (time) => 8 + ((width - 16) * time / total);
              const y = (level) => 8 + ((height - 16) * (1 - level));
              context.clearRect(0, 0, width, height);
              context.fillStyle = "#111";
              context.fillRect(0, 0, width, height);
              context.strokeStyle = "#ffcc00";
              context.lineWidth = 2;
              context.beginPath();
              context.moveTo(x(0), y(0));
              context.lineTo(x(attack), y(1));
              context.lineTo(x(attack + decay), y(sustain));
              context.lineTo(x(attack + decay + hold), y(sustain));
              context.lineTo(x(total), y(0));
              context.stroke();
            }
          }

          const canvas = panel.querySelector("[data-sample-editor-waveform]");
          const waveform = dialog?.sampleEditorVisual?.waveform;
          if (!canvas || !waveform) return;
          const startInput = panel.querySelector("[data-sample-editor-start]");
          const endInput = panel.querySelector("[data-sample-editor-end]");
          const zoomInput = panel.querySelector("[data-sample-editor-zoom]");
          const duration = Math.max(0, Number(canvas.dataset.waveformDuration) || Number(endInput?.max) || 0);
          const start = Math.max(0, Math.min(duration, Number(startInput?.value) || 0));
          const end = Math.max(start, Math.min(duration, Number(endInput?.value) || duration));
          const zoom = Math.max(1, Math.min(8, Number(zoomInput?.value) || 1));
          const viewDuration = duration / zoom;
          const center = Math.max(viewDuration / 2, Math.min(duration - (viewDuration / 2), (start + end) / 2));
          const viewStart = Math.max(0, center - (viewDuration / 2));
          const viewEnd = Math.min(duration, center + (viewDuration / 2));
          const context = canvas.getContext?.("2d");
          if (context) {
            const width = Math.max(1, Math.round(canvas.clientWidth || 720));
            const height = Math.max(1, Math.round(canvas.clientHeight || 128));
            if (canvas.width !== width) canvas.width = width;
            if (canvas.height !== height) canvas.height = height;
            context.clearRect(0, 0, width, height);
            context.fillStyle = "#111";
            context.fillRect(0, 0, width, height);
            const centerY = height / 2;
            context.strokeStyle = "rgba(255, 204, 0, 0.22)";
            context.beginPath();
            context.moveTo(0, centerY);
            context.lineTo(width, centerY);
            context.stroke();
            const fullCount = Math.min(waveform.mins?.length || 0, waveform.maxs?.length || 0);
            const firstPeak = fullCount && duration ? Math.max(0, Math.min(fullCount - 1, Math.floor((viewStart / duration) * fullCount))) : 0;
            const lastPeak = fullCount && duration ? Math.max(firstPeak + 1, Math.min(fullCount, Math.ceil((viewEnd / duration) * fullCount))) : fullCount;
            const count = Math.max(0, lastPeak - firstPeak);
            if (count) {
              context.strokeStyle = "#00c853";
              context.lineWidth = 1;
              context.beginPath();
              for (let index = 0; index < count; index += 1) {
                const x = (index / Math.max(1, count - 1)) * width;
                const peakIndex = firstPeak + index;
                context.moveTo(x, centerY - (Number(waveform.maxs[peakIndex]) || 0) * centerY);
                context.lineTo(x, centerY - (Number(waveform.mins[peakIndex]) || 0) * centerY);
              }
              context.stroke();
            }
            const visibleDuration = Math.max(0.000001, viewEnd - viewStart || duration || 1);
            const startRatio = Math.max(0, Math.min(1, (start - viewStart) / visibleDuration));
            const endRatio = Math.max(startRatio, Math.min(1, (end - viewStart) / visibleDuration));
            context.fillStyle = "rgba(255, 204, 0, 0.09)";
            context.fillRect(startRatio * width, 0, Math.max(1, (endRatio - startRatio) * width), height);
            [[startRatio, "#00c853"], [endRatio, "#ff3b30"]].forEach(([ratio, color]) => {
              context.strokeStyle = color;
              context.lineWidth = 2;
              context.beginPath();
              context.moveTo(Number(ratio) * width, 0);
              context.lineTo(Number(ratio) * width, height);
              context.stroke();
            });
          }
          canvas.dataset.waveformViewStart = String(viewStart);
          canvas.dataset.waveformViewEnd = String(viewEnd);
          if (canvas.dataset.castWaveformBound === "true") return;
          canvas.dataset.castWaveformBound = "true";
          let activeMarker = null;
          const updateMarker = (event, final = false) => {
            if (!activeMarker) return;
            const rect = canvas.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (Number(event.clientX) - rect.left) / Math.max(1, rect.width)));
            const from = Number(canvas.dataset.waveformViewStart) || 0;
            const to = Number(canvas.dataset.waveformViewEnd) || duration;
            const input = activeMarker === "start" ? startInput : endInput;
            if (!input) return;
            input.value = String(from + (ratio * Math.max(0, to - from)));
            input.dispatchEvent(new Event(final ? "change" : "input", { bubbles: true }));
          };
          canvas.addEventListener("pointerdown", (event) => {
            const rect = canvas.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (Number(event.clientX) - rect.left) / Math.max(1, rect.width)));
            const from = Number(canvas.dataset.waveformViewStart) || 0;
            const to = Number(canvas.dataset.waveformViewEnd) || duration;
            const time = from + (ratio * Math.max(0, to - from));
            activeMarker = Math.abs(time - Number(startInput?.value)) <= Math.abs(time - Number(endInput?.value)) ? "start" : "end";
            canvas.setPointerCapture?.(event.pointerId);
            updateMarker(event);
          });
          canvas.addEventListener("pointermove", (event) => updateMarker(event));
          const finish = (event) => {
            if (!activeMarker) return;
            updateMarker(event, true);
            activeMarker = null;
            canvas.releasePointerCapture?.(event.pointerId);
          };
          canvas.addEventListener("pointerup", finish);
          canvas.addEventListener("pointercancel", finish);
        }

        function queueMirroredSamplerCanvasRender(panel, dialog) {
          const render = () => renderMirroredSamplerCanvases(panel, dialog);
          queueRender(render);
        }

        function queueMirroredEffectTitleMarquee(panel, senderOverflowing = false) {
          const render = () => {
            const viewport = panel?.querySelector?.(".effect-dialog-title-viewport");
            const title = viewport?.querySelector?.(".effect-dialog-title-text");
            if (!viewport || !title) return;
            const overflow = Math.max(0, title.scrollWidth - viewport.clientWidth);
            viewport.classList.toggle("is-overflowing", senderOverflowing || overflow > 1);
            viewport.style.setProperty("--effect-title-travel", `${overflow}px`);
            viewport.style.setProperty(
              "--effect-title-duration",
              `${Math.max(14, Math.min(36, overflow / 10 + 14)).toFixed(1)}s`,
            );
          };
          queueRender(render);
        }

        function applyMirroredDialogPosition(panel, dialog, exactEffectDialog = false) {
          const geometry = dialog?.geometry;
          if (geometry?.coordinateSpace === "viewport_css_pixels") {
            const viewportWidth = Math.max(
              1,
              Number(document.documentElement?.clientWidth) || Number(window.innerWidth) || 1,
            );
            const viewportHeight = Math.max(
              1,
              Number(document.documentElement?.clientHeight) || Number(window.innerHeight) || 1,
            );
            const width = Math.max(0, Number(geometry.widthPx) || 0);
            const height = Math.max(0, Number(geometry.heightPx) || 0);
            const maxLeft = Math.max(0, viewportWidth - Math.min(width, viewportWidth));
            const maxTop = Math.max(0, viewportHeight - Math.min(height, viewportHeight));
            const leftPx = Math.max(0, Math.min(maxLeft, Number(geometry.leftPx) || 0));
            const topPx = Math.max(0, Math.min(maxTop, Number(geometry.topPx) || 0));
            panel.style.left = exactEffectDialog
              ? `${Math.max(0, leftPx - RECEIVER_EFFECT_DIALOG_ANCHOR_OFFSET_PX)}px`
              : `${leftPx}px`;
            panel.style.top = exactEffectDialog
              ? `${Math.max(0, topPx - RECEIVER_EFFECT_DIALOG_ANCHOR_OFFSET_PX)}px`
              : `${topPx}px`;
            return;
          }
          const normalizeRatio = (value) => {
            const numeric = Number(value);
            return Math.max(0, Math.min(0.85, Number.isFinite(numeric) ? numeric : 0.2));
          };
          const left = `${normalizeRatio(dialog?.left) * 100}%`;
          const top = `${normalizeRatio(dialog?.top) * 100}%`;
          panel.style.left = exactEffectDialog
            ? `calc(${left} - ${RECEIVER_EFFECT_DIALOG_ANCHOR_OFFSET_PX}px)`
            : left;
          panel.style.top = exactEffectDialog
            ? `calc(${top} - ${RECEIVER_EFFECT_DIALOG_ANCHOR_OFFSET_PX}px)`
            : top;
        }
        function applyMirroredDialogLayoutSize(panel, dialog) {
          if (dialog?.kind !== "mediaSessions") return;
          const widthPx = Number(dialog.layoutSize?.widthPx);
          if (!Number.isFinite(widthPx) || widthPx <= 0) return;
          panel.style.width = `${Math.min(4096, widthPx)}px`;
          panel.style.maxWidth = "95vw";
        }
        function renderDialogRegistry(registry) {
          if (disposed) return;
          const root = getEl("gui-dialog-registry-root");
          if (!root) return;
          const list = Array.isArray(registry) ? registry : [];
          const signature = JSON.stringify(list);
          if (signature === lastDialogRegistryState) return;
          lastDialogRegistryState = signature;
          root.replaceChildren();
          // The registry is an action/schema catalog, not a visible dialog.
          // Active app dialogs are rendered exclusively by renderDialogMirrors;
          // painting this catalog made every sampler/effect menu appear at once.
          root.hidden = true;
          root.setAttribute("aria-hidden", "true");
          root.dataset.registry = signature;
        }

        const MIRRORED_DIALOG_DYNAMIC_CLASS_TOKENS = new Set([
          "active",
          "playing",
          "control-error",
          "cast-interaction-pending",
          "cast-interaction-confirmed",
          "is-overflowing",
          "is-populated",
          "is-selected",
          "is-stack-front",
        ]);
        const MIRRORED_DIALOG_DYNAMIC_DATA_KEYS = new Set([
          "actionResult",
          "actionRoute",
          "active",
          "envelopeAttack",
          "envelopeDecay",
          "envelopeSustain",
          "envelopeRelease",
          "sampleEditorStatus",
          "waveformDuration",
          "waveformEnd",
          "waveformStart",
          "waveformViewEnd",
          "waveformViewStart",
        ]);
        function normalizeMirroredDialogStructuralClassName(value) {
          return normalizeMirroredDialogClassName(value)
            .split(/\s+/)
            .filter((token) => token && !MIRRORED_DIALOG_DYNAMIC_CLASS_TOKENS.has(token))
            .join(" ");
        }
        function normalizeMirroredDialogStructuralData(data) {
          const structuralData = {};
          Object.entries(data || {}).forEach(([key, value]) => {
            if (!MIRRORED_DIALOG_DYNAMIC_DATA_KEYS.has(key)) structuralData[key] = value;
          });
          return structuralData;
        }
        function getMirroredDialogManifestLayout(manifest) {
          const normalizeNode = (node, dynamicText = false) => {
            if (!node || typeof node !== "object") return null;
            if (node.nodeType === "text") {
              return { nodeType: "text", text: dynamicText ? "<dynamic>" : node.text };
            }
            const attributes = node.attributes || {};
            const className = normalizeMirroredDialogStructuralClassName(attributes.className);
            const data = normalizeMirroredDialogStructuralData(node.data);
            const nodeHasDynamicText = dynamicText ||
              (
                node.actionIndex !== null &&
                node.actionIndex !== undefined &&
                Number.isInteger(Number(node.actionIndex))
              ) ||
              Object.prototype.hasOwnProperty.call(data, "padSampleName") ||
              Object.prototype.hasOwnProperty.call(data, "sampleEditorStatus") ||
              /(?:^|\s)dialog-header-status(?:\s|$)/.test(className) ||
              String(node.tagName || "") === "output" ||
              /(?:^|\s)pad-setting-value(?:\s|$)/.test(className);
            return {
              nodeType: "element",
              tagName: node.tagName,
              attributes: {
                id: attributes.id,
                className,
                role: attributes.role,
                for: attributes.for,
                "aria-labelledby": attributes["aria-labelledby"],
              },
              data,
              controlIndex: node.controlIndex,
              actionIndex: node.actionIndex,
              children: (node.children || [])
                .map((child) => normalizeNode(child, nodeHasDynamicText))
                .filter(Boolean),
            };
          };
          if (!manifest || typeof manifest !== "object") return null;
          return {
            schema: manifest.schema,
            version: manifest.version,
            nodeCount: manifest.nodeCount,
            truncated: manifest.truncated,
            omittedDirectChildren: manifest.omittedDirectChildren || 0,
            children: (manifest.children || []).map((node) => normalizeNode(node)).filter(Boolean),
          };
        }
        function getDialogMirrorLayoutSignature(dialogs) {
          const normalizeControl = (control) => ({
            ...control,
            value: undefined,
            rawValue: undefined,
            defaultValue: undefined,
            displayValue: undefined,
            checked: undefined,
            disabled: undefined,
            className: normalizeMirroredDialogStructuralClassName(control?.className),
            title: undefined,
            ariaLabel: undefined,
            ariaInvalid: undefined,
            data: normalizeMirroredDialogStructuralData(control?.data),
            displayDescriptor: control?.displayDescriptor
              ? {
                  ...control.displayDescriptor,
                  rawValue: undefined,
                  displayValue: undefined,
                  defaultValue: undefined,
                  disabled: undefined,
                }
              : undefined,
            options: (control?.options || []).map((option) => ({
              ...option,
              selected: undefined,
              disabled: undefined,
            })),
          });
          return JSON.stringify((dialogs || []).map((dialog) => {
            const manifest = (dialog.dialogDomManifest || dialog.samplePadDomManifest)
              ? getMirroredDialogManifestLayout(
                  dialog.dialogDomManifest || dialog.samplePadDomManifest,
                )
              : null;
            return {
              ...dialog,
              shellClassName: normalizeMirroredDialogStructuralClassName(dialog.shellClassName),
              title: undefined,
              geometry: undefined,
              left: undefined,
              top: undefined,
              width: undefined,
              height: undefined,
              header: dialog.header
                ? {
                    ...dialog.header,
                    title: undefined,
                    status: undefined,
                    titleOverflowing: undefined,
                    titleLines: (dialog.header.titleLines || []).map((line) => ({
                      ...line,
                      text: undefined,
                    })),
                  }
                : undefined,
              controls: (dialog.controls || []).map(normalizeControl),
              actions: (dialog.actions || []).map((action) => ({
                ...action,
                label: undefined,
                className: normalizeMirroredDialogStructuralClassName(action?.className),
                title: undefined,
                ariaLabel: undefined,
                ariaInvalid: undefined,
                ariaPressed: undefined,
                pressed: undefined,
                disabled: undefined,
                data: normalizeMirroredDialogStructuralData(action?.data),
              })),
              effectSlotTabs: dialog.effectSlotTabs
                ? {
                    ...dialog.effectSlotTabs,
                    items: (dialog.effectSlotTabs.items || []).map((item) => ({
                      ...item,
                      className: normalizeMirroredDialogStructuralClassName(item?.className),
                      control: item.control ? normalizeControl(item.control) : null,
                    })),
                  }
                : null,
              samplePadLayout: dialog.samplePadLayout
                ? { ...dialog.samplePadLayout, sampleNameText: undefined }
                : null,
              samplePadDomManifest: manifest,
              dialogDomManifest: manifest,
              sampleEditorVisual: dialog.sampleEditorVisual,
            };
          }));
        }

        function patchMirroredDialogState(root, dialogs) {
          const panels = Array.from(root.children);
          if (panels.length !== dialogs.length) return false;
          for (const dialog of dialogs) {
            const panel = panels.find(
              (candidate) => candidate.dataset.dialogId === String(dialog.id || ""),
            );
            if (!panel) return false;
            const exactEffectDialog = panel.matches(
              ".effect-params-dialog, .audition-params-dialog",
            ) && dialog.kind !== "sampleEditor";
            const exactSamplePadDialog = dialog.kind === "samplePadSettings" && panel.matches(".pad-settings-dialog");
            const exactSampleEditorDialog = dialog.kind === "sampleEditor" && panel.matches(".sample-editor-dialog");
            applyMirroredDialogPosition(panel, dialog, exactEffectDialog || exactSampleEditorDialog);
            applyMirroredDialogLayoutSize(panel, dialog);
            panel.className = [
              "gui-dialog-mirror",
              exactEffectDialog || exactSamplePadDialog || exactSampleEditorDialog ? "" : "mxs-dialog",
              normalizeMirroredDialogClassName(dialog.shellClassName),
              `gui-dialog-${dialog.kind || "generic"}`,
            ].filter(Boolean).join(" ");
            panel.dataset.effectName = String(dialog.identity?.effectName || "").slice(0, 128);
            panel.dataset.programId = String(dialog.identity?.programId || "").slice(0, 32);
            panel.dataset.programName = String(dialog.identity?.programName || "").slice(0, 128);
            panel.dataset.expectedControlCount = String(
              (dialog.controls || []).length +
              (dialog.effectSlotTabs?.items || []).filter((item) => item?.control).length,
            );
            if (!exactEffectDialog && !exactSamplePadDialog && !exactSampleEditorDialog && dialog.kind !== "mediaSessions") {
              panel.style.width = `${Math.max(0.2, Math.min(0.8, Number(dialog.width) || 0.5)) * 100}%`;
              panel.style.maxHeight = `${Math.max(0.25, Math.min(0.8, Number(dialog.height) || 0.5)) * 100}%`;
            }
            if (exactSamplePadDialog) {
              const activeTab = dialog.samplePadLayout?.activeTab;
              if (activeTab && panel.dataset.padTab !== activeTab) {
                panel.dataset.padTab = activeTab;
                panel.querySelectorAll(".pad-dialog-tab-btn").forEach((btn) => {
                  const isActive = btn.dataset.padTab === activeTab;
                  btn.classList.toggle("active", isActive);
                  btn.setAttribute("aria-selected", String(isActive));
                });
              }
              const padTitle = panel.querySelector(".pad-dialog-pad-title");
              const sampleName = panel.querySelector("[data-pad-sample-name]");
              if (padTitle && dialog.samplePadLayout?.padTitleText !== undefined) {
                padTitle.textContent = String(dialog.samplePadLayout.padTitleText);
              }
              if (sampleName && dialog.samplePadLayout?.sampleNameText !== undefined) {
                sampleName.textContent = String(dialog.samplePadLayout.sampleNameText);
              }
              const bpmSetting = (dialog.samplePadLayout?.settings || []).find((s) => s.kind === "bpmModule");
              if (bpmSetting) {
                const bpmModuleEl = panel.querySelector(".pad-bpm-module");
                if (bpmModuleEl) {
                  const baseBadge = bpmModuleEl.querySelector(".pad-bpm-base-badge");
                  if (baseBadge && bpmSetting.baseBpmText) {
                    baseBadge.textContent = bpmSetting.baseBpmText;
                    baseBadge.title = bpmSetting.baseBpmText;
                    baseBadge.setAttribute("aria-label", bpmSetting.baseBpmText);
                  }
                  (bpmSetting.syncButtons || []).forEach((sBtn) => {
                    if (typeof sBtn?.track === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(sBtn.track)) {
                      const btn = bpmModuleEl.querySelector(`.pad-bpm-sync-btn[data-track="${sBtn.track}"]`);
                      if (btn) {
                        btn.classList.toggle("is-selected", Boolean(sBtn.selected));
                        btn.classList.toggle("is-populated", Boolean(sBtn.populated));
                      }
                    }
                  });
                }
              }
            } else if (dialog.header) {
              const titleLines = Array.from(panel.querySelectorAll(
                ".dialog-effect-type,.effect-dialog-title-text,.dialog-title-top,.dialog-title-bottom",
              ));
              (dialog.header.titleLines || []).forEach((line, index) => {
                if (titleLines[index] && line?.text !== undefined) {
                  titleLines[index].textContent = String(line.text);
                }
              });
              if (titleLines.length === 0 && dialog.header.title !== undefined) {
                const title = panel.querySelector("h1,h2,h3,.dialog-title,.dialog-header-title");
                if (title) title.textContent = String(dialog.header.title);
              }
              const titleViewport = panel.querySelector(".effect-dialog-title-viewport");
              if (titleViewport) {
                titleViewport.classList.toggle(
                  "is-overflowing",
                  dialog.header.titleOverflowing === true,
                );
                queueMirroredEffectTitleMarquee(panel, dialog.header.titleOverflowing === true);
              }
              const status = panel.querySelector(
                ".dialog-header-status,[data-sample-editor-status]",
              );
              if (status && dialog.header.status !== undefined) {
                status.textContent = String(dialog.header.status);
              }
            }
            (dialog.controls || []).forEach((control, controlIndex) => {
              const resolvedIndex = Number(control.controlIndex ?? controlIndex);
              const value = panel.querySelector(
                `input[data-control-index="${resolvedIndex}"], ` +
                `select[data-control-index="${resolvedIndex}"], ` +
                `textarea[data-control-index="${resolvedIndex}"]`,
              );
              if (!value) return;
              const pending = value.dataset.castInteractionState === "pending";
              if (!pending) {
                if (control.type === "checkbox") value.checked = Boolean(control.checked);
                else value.value = control.value === null || control.value === undefined
                  ? ""
                  : String(control.value);
              }
              value.className = normalizeMirroredDialogClassName(control.className);
              value.disabled = Boolean(control.disabled);
              value.title = String(control.title || "").slice(0, 256);
              value.setAttribute("aria-label", control.ariaLabel || control.label || "Parameter");
              if (control.ariaInvalid === null || control.ariaInvalid === undefined) {
                value.removeAttribute("aria-invalid");
              } else {
                value.setAttribute("aria-invalid", String(control.ariaInvalid));
              }
              syncMirroredElementDataset(value, control.data);
              if (value.tagName === "SELECT" && Array.isArray(control.options)) {
                Array.from(value.options || []).forEach((option, optionIndex) => {
                  const optionState = control.options[optionIndex];
                  if (!optionState) return;
                  option.disabled = Boolean(optionState.disabled);
                  option.selected = Boolean(optionState.selected);
                });
              }
              const descriptor = control.displayDescriptor || readMirroredDisplayDescriptor(value);
              const confirmedDisplay = control.displayValue !== undefined
                ? String(control.displayValue)
                : formatMirroredParameterDisplay(descriptor, control.rawValue ?? control.value);
              if (!pending) {
                writeMirroredDisplayDescriptor(value, descriptor, confirmedDisplay);
                const output = value.closest(
                  ".effect-control-group, .gui-dialog-mirror-control, .pad-setting-field",
                )?.querySelector(
                  ".effect-param-value .param-value, .gui-dialog-mirror-value, .pad-setting-value",
                );
                if (output) {
                  output.textContent = confirmedDisplay;
                  writeMirroredDisplayDescriptor(output, descriptor, confirmedDisplay);
                }
              }
            });
            (dialog.effectSlotTabs?.items || []).forEach((item) => {
              if (!item?.control) return;
              const resolvedIndex = Number(item.control.controlIndex);
              const input = panel.querySelector(
                `input[data-control-index="${resolvedIndex}"]`,
              );
              if (!input) return;
              input.checked = Boolean(item.control.checked);
              input.disabled = Boolean(item.control.disabled);
            });
            (dialog.actions || []).forEach((action, actionIndex) => {
              const resolvedIndex = Number(action.actionIndex ?? actionIndex);
              const actionElement = panel.querySelector(`[data-action-index="${resolvedIndex}"]`);
              if (!actionElement) return;
              if (actionElement.tagName === "BUTTON") {
                actionElement.disabled = Boolean(action.disabled);
              }
              actionElement.className = normalizeMirroredDialogClassName(action.className);
              actionElement.title = String(action.title || "").slice(0, 256);
              if (action.ariaLabel) actionElement.setAttribute("aria-label", action.ariaLabel);
              else actionElement.removeAttribute("aria-label");
              if (action.ariaInvalid === null || action.ariaInvalid === undefined) {
                actionElement.removeAttribute("aria-invalid");
              } else {
                actionElement.setAttribute("aria-invalid", String(action.ariaInvalid));
              }
              syncMirroredElementDataset(actionElement, action.data);
              if (action.label !== undefined) {
                const contentClassName = normalizeMirroredDialogClassName(action.contentClassName);
                const content = contentClassName
                  ? actionElement.querySelector(`.${contentClassName.split(/\s+/)[0]}`)
                  : null;
                if (content) content.textContent = String(action.label);
                else actionElement.textContent = String(action.label);
              }
              if (action.ariaPressed === null || action.ariaPressed === undefined) {
                actionElement.removeAttribute("aria-pressed");
              } else {
                actionElement.setAttribute("aria-pressed", String(action.ariaPressed));
              }
            });
            queueMirroredSamplerCanvasRender(panel, dialog);
          }
          root.hidden = dialogs.length === 0;
          root.setAttribute("aria-hidden", dialogs.length === 0 ? "true" : "false");
          return true;
        }

        function getMirroredDialogElementKey(element) {
          if (!element) return "";
          const panel = element.closest?.("[data-dialog-id]");
          const dialogId = element.dataset?.dialogId || panel?.dataset?.dialogId || "";
          return [
            dialogId,
            element.dataset?.controlIndex ?? "",
            element.dataset?.actionIndex ?? "",
            element.id || "",
          ].join("|");
        }

        function getMirroredDialogScrollKey(element) {
          if (!element) return "";
          const panel = element.closest?.("[data-dialog-id]");
          if (!panel) return "";
          const dialogId = panel.dataset.dialogId || "";
          if (element === panel) return `${dialogId}|panel`;
          const scrollables = Array.from(panel.querySelectorAll(
            ".pad-dialog-scroll-content,.dialog-content,.media-dialog-view-container",
          ));
          const index = scrollables.indexOf(element);
          return index >= 0 ? `${dialogId}|content|${index}` : "";
        }

        function captureMirroredDialogInteractionState(root) {
          const active = document.activeElement;
          const focusedKey = root.contains?.(active)
            ? getMirroredDialogElementKey(active)
            : "";
          const pending = Array.from(root.querySelectorAll?.(
            "[data-cast-interaction-state], [data-cast-interaction-revision]",
          ) || []).map((element) => ({
            key: getMirroredDialogElementKey(element),
            state: element.dataset.castInteractionState || "",
            revision: element.dataset.castInteractionRevision || "",
            className: element.className || "",
            ariaBusy: element.getAttribute("aria-busy"),
            outline: element.style.outline || "",
            outlineOffset: element.style.outlineOffset || "",
            boxShadow: element.style.boxShadow || "",
            previousOutline: element.dataset.castPreviousOutline || "",
            previousOutlineOffset: element.dataset.castPreviousOutlineOffset || "",
            previousBoxShadow: element.dataset.castPreviousBoxShadow || "",
          }));
          const scrollElements = [
            ...Array.from(root.children),
            ...Array.from(root.querySelectorAll(
              ".pad-dialog-scroll-content,.dialog-content,.media-dialog-view-container",
            )),
          ];
          const scroll = scrollElements.map((element) => ({
            key: getMirroredDialogScrollKey(element),
            scrollTop: element.scrollTop || 0,
            scrollLeft: element.scrollLeft || 0,
          })).filter((state) => state.key);
          return {
            focusedKey,
            selectionStart: Number.isInteger(active?.selectionStart) ? active.selectionStart : null,
            selectionEnd: Number.isInteger(active?.selectionEnd) ? active.selectionEnd : null,
            pending,
            scroll,
          };
        }

        function restoreMirroredDialogInteractionState(root, saved) {
          if (!root || !saved) return;
          const elements = Array.from(root.querySelectorAll?.("*") || []);
          const findByKey = (key) => elements.find(
            (element) => getMirroredDialogElementKey(element) === key,
          );
          (saved.pending || []).forEach((state) => {
            const element = findByKey(state.key);
            if (!element) return;
            if (state.state) element.dataset.castInteractionState = state.state;
            if (state.revision) element.dataset.castInteractionRevision = state.revision;
            const exactDialog = element.closest?.(
              '.pad-settings-dialog[data-dialog-dom-schema="mxs-004.cast-dialog-dom.v1"]',
            );
            if (state.className && !exactDialog) element.className = state.className;
            if (state.ariaBusy === null) element.removeAttribute("aria-busy");
            else if (state.ariaBusy) element.setAttribute("aria-busy", state.ariaBusy);
            element.style.outline = state.outline;
            element.style.outlineOffset = state.outlineOffset;
            element.style.boxShadow = state.boxShadow;
            if (state.previousOutline) element.dataset.castPreviousOutline = state.previousOutline;
            if (state.previousOutlineOffset) element.dataset.castPreviousOutlineOffset = state.previousOutlineOffset;
            if (state.previousBoxShadow) element.dataset.castPreviousBoxShadow = state.previousBoxShadow;
          });
          (saved.scroll || []).forEach((state) => {
            const element = [root, ...elements].find(
              (candidate) => getMirroredDialogScrollKey(candidate) === state.key,
            );
            if (!element) return;
            element.scrollTop = state.scrollTop;
            element.scrollLeft = state.scrollLeft;
          });
          const focused = saved.focusedKey ? findByKey(saved.focusedKey) : null;
          if (!focused || typeof focused.focus !== "function") return;
          try {
            focused.focus({ preventScroll: true });
          } catch (_error) {
            focused.focus();
          }
          if (saved.selectionStart !== null && "selectionStart" in focused) {
            try {
              focused.selectionStart = saved.selectionStart;
              focused.selectionEnd = saved.selectionEnd;
            } catch (_error) {}
          }
        }

        function renderDialogMirrors(dialogs) {
          if (disposed) return;
          const root = getEl("gui-dialog-mirror-root");
          if (!root) return;
          const renderStartedAt = Date.now();
          let firstPaintTimeMs = null;
          const list = Array.isArray(dialogs) ? dialogs : [];
          if (document.body?.classList.contains("pure-screen-mirror-mode")) {
            const suppressedState = "__pure_screen_mirror_suppressed__";
            if (lastDialogMirrorState === suppressedState && root.hidden && root.children.length === 0) return;
            root.querySelectorAll("dialog[open]").forEach((dialog) => {
              try { dialog.close(); } catch (_) {}
            });
            cancelPending();
            root.replaceChildren();
            root.hidden = true;
            root.setAttribute("aria-hidden", "true");
            lastDialogMirrorState = suppressedState;
            lastDialogMirrorLayoutState = suppressedState;
            lastDialogRenderStats = {
              mode: "suppressed_for_pure_screen_mirror",
              renderTimeMs: Math.max(0, Date.now() - renderStartedAt),
              firstPaintTimeMs: null,
              dialogCount: 0,
              domNodeCount: 0,
            };
            return;
          }
          root.hidden = list.length === 0;
          root.setAttribute("aria-hidden", list.length === 0 ? "true" : "false");
          const finishDialogRender = (mode) => {
            lastDialogRenderStats = {
              mode,
              renderTimeMs: Math.max(0, Date.now() - renderStartedAt),
              firstPaintTimeMs,
              dialogCount: list.length,
              domNodeCount: root.querySelectorAll?.("*")?.length || 0,
            };
          };
          const signature = JSON.stringify(list);
          if (
            signature === lastDialogMirrorState &&
            root.children.length === list.length &&
            list.every((dialog) => Array.from(root.children).some(
              (panel) => panel.dataset.dialogId === String(dialog?.id || ""),
            ))
          ) {
            finishDialogRender("unchanged");
            return;
          }
          lastDialogMirrorState = signature;
          const layoutSignature = getDialogMirrorLayoutSignature(list);
          if (
            layoutSignature === lastDialogMirrorLayoutState &&
            patchMirroredDialogState(root, list)
          ) {
            finishDialogRender("patch");
            return;
          }
          lastDialogMirrorLayoutState = layoutSignature;
          cancelPending();
          const preservedInteractionState = captureMirroredDialogInteractionState(root);
          root.replaceChildren();
          const normalizeClassName = normalizeMirroredDialogClassName;
          const applyDataset = syncMirroredElementDataset;
          const appendMirroredPanel = (panel, useModalTopLayer = false) => {
            root.appendChild(panel);
            const recordFirstPaintCommit = () => {
              // This is the first open DOM commit. The ACK separately reports
              // computed visibility and viewport intersection; it is not a
              // compositor or TV panel scan-out measurement.
              const elapsedMs = Math.max(0, Date.now() - renderStartedAt);
              panel.dataset.dialogFirstPaintMs = String(elapsedMs);
              if (firstPaintTimeMs === null) firstPaintTimeMs = elapsedMs;
            };
            if (
              useModalTopLayer &&
              panel.tagName === "DIALOG" &&
              typeof panel.showModal === "function"
            ) {
              try {
                panel.showModal();
                recordFirstPaintCommit();
                return;
              } catch (_error) {}
            }
            panel.setAttribute("open", "");
            recordFirstPaintCommit();
          };
          const applyControlState = (value, control, dialog, controlIndex) => {
            const tagName = control.tagName || (control.type === "select-one" ? "select" : "input");
            if (tagName === "input") value.type = control.type || "text";
            value.className = normalizeClassName(control.className);
            if (/^[A-Za-z][A-Za-z0-9_:.-]{0,127}$/.test(String(control.id || ""))) {
              value.id = control.id;
            }
            value.name = String(control.name || "").slice(0, 128);
            value.value = control.value === null || control.value === undefined ? "" : control.value;
            if (control.type === "checkbox") value.checked = Boolean(control.checked);
            value.min = control.min ?? "";
            value.max = control.max ?? "";
            value.step = control.step ?? "";
            value.defaultValue = control.defaultValue ?? value.value;
            value.title = String(control.title || "").slice(0, 256);
            value.placeholder = String(control.placeholder || "").slice(0, 256);
            if (Number(control.maxLength) > 0 && "maxLength" in value) {
              value.maxLength = Number(control.maxLength);
            }
            value.disabled = Boolean(control.disabled);
            value.setAttribute("aria-label", control.ariaLabel || control.label || "Parameter");
            if (control.ariaInvalid !== null && control.ariaInvalid !== undefined) {
              value.setAttribute("aria-invalid", String(control.ariaInvalid));
            }
            value.dataset.dialogId = dialog.id || "";
            value.dataset.controlIndex = String(control.controlIndex ?? controlIndex);
            if (control.parameterKey && !control.id) {
              value.dataset.parameterKey = String(control.parameterKey);
            }
            const displayDescriptor = control.displayDescriptor || (
              control.formatterKind
                ? {
                    parameterKey: control.parameterKey,
                    displayValue: control.displayValue,
                    formatterKind: control.formatterKind,
                    unit: control.unit,
                    unitSpacing: control.unitSpacing || "",
                    displayScale: control.displayScale || 1,
                    decimals: control.decimals || 0,
                    min: control.min,
                    max: control.max,
                    step: control.step,
                  }
                : null
            );
            if (displayDescriptor) {
              writeMirroredDisplayDescriptor(
                value,
                displayDescriptor,
                displayDescriptor.displayValue ?? control.displayValue ?? "",
              );
            }
            applyDataset(value, control.data);
            if (tagName === "select") {
              const controlOptions = control.optionCatalogRef === "effectOptions"
                ? getEffectOptions().map((option) => ({
                    value: option,
                    label: option === "none" ? "None" : option,
                    selected: String(option) === String(control.value ?? "none"),
                    disabled: false,
                  }))
                : (control.options || []);
              controlOptions.forEach((option) => {
                const item = document.createElement("option");
                item.value = String(option.value ?? "");
                item.textContent = option.label || item.value;
                item.disabled = Boolean(option.disabled);
                item.selected = Boolean(option.selected);
                value.appendChild(item);
              });
              value.value = control.value === null || control.value === undefined ? "" : control.value;
            }
            return value;
          };
          list.forEach((dialog) => {
            const shellClassName = normalizeClassName(dialog.shellClassName);
            const exactEffectDialog = dialog.dialogLayoutVersion >= 1 &&
              dialog.kind !== "sampleEditor" &&
              /(?:^|\s)(?:effect-params-dialog|audition-params-dialog)(?:\s|$)/.test(shellClassName);
            const exactSamplePadDialog = dialog.dialogLayoutVersion >= 3 &&
              dialog.kind === "samplePadSettings" &&
              dialog.samplePadLayout;
            const exactSampleEditorDialog = dialog.dialogLayoutVersion >= 4 &&
              dialog.kind === "sampleEditor" &&
              dialog.samplePadDomManifest;
            const exactMediaSessionsDialog = dialog.dialogLayoutVersion >= 4 &&
              dialog.kind === "mediaSessions" &&
              dialog.samplePadDomManifest;
            const domManifest = dialog.dialogDomManifest || dialog.samplePadDomManifest;
            const samplePadManifest = (exactSampleEditorDialog || exactMediaSessionsDialog || (!exactEffectDialog && !exactSamplePadDialog && domManifest))
              ? domManifest
              : null;
            let panel = document.createElement(
              exactEffectDialog || exactSamplePadDialog || exactSampleEditorDialog || exactMediaSessionsDialog ? "dialog" : "section",
            );
            if (panel.tagName === "SECTION" && samplePadManifest) {
              panel = document.createElement("dialog");
            }
            panel.className = [
              "gui-dialog-mirror",
              exactEffectDialog || exactSamplePadDialog || exactSampleEditorDialog ? "" : "mxs-dialog",
              shellClassName,
              `gui-dialog-${dialog.kind || "generic"}`,
            ].filter(Boolean).join(" ");
            panel.setAttribute("role", dialog.role || "dialog");
            if (dialog.modal) panel.setAttribute("aria-modal", "true");
            if (dialog.ariaLabelledby) panel.setAttribute("aria-labelledby", dialog.ariaLabelledby);
            panel.dataset.dialogId = dialog.id || "";
            panel.dataset.dialogKind = dialog.kind || "generic";
            panel.dataset.effectName = String(dialog.identity?.effectName || "").slice(0, 128);
            panel.dataset.programId = String(dialog.identity?.programId || "").slice(0, 32);
            panel.dataset.programName = String(dialog.identity?.programName || "").slice(0, 128);
            panel.dataset.expectedControlCount = String(
              (dialog.controls || []).length +
              (dialog.effectSlotTabs?.items || []).filter((item) => item?.control).length,
            );
            if (dialog.padId) panel.dataset.padId = String(dialog.padId);
            applyMirroredDialogPosition(panel, dialog, exactEffectDialog || exactSampleEditorDialog);
            applyMirroredDialogLayoutSize(panel, dialog);
            if (!exactEffectDialog && !exactSamplePadDialog && !exactSampleEditorDialog && dialog.kind !== "mediaSessions") {
              panel.style.width = `${Math.max(0.2, Math.min(0.8, Number(dialog.width) || 0.5)) * 100}%`;
              panel.style.maxHeight = `${Math.max(0.25, Math.min(0.8, Number(dialog.height) || 0.5)) * 100}%`;
            }
            const actions = Array.isArray(dialog.actions) ? dialog.actions : [];
            const isHeaderAction = (action) => /close|pad-nav|fx-chain-arrow|previous|next/i.test(
              [action?.actionId, action?.className, action?.data?.padNav].filter(Boolean).join(" "),
            );
            const actionPlacement = (action) => action?.placement || (isHeaderAction(action) ? "header" : "footer");
            const renderAction = (action, actionIndex) => {
              const isLabel = action.tagName === "label";
              const button = document.createElement(isLabel ? "label" : "button");
              if (!isLabel) button.type = "button";
              button.className = normalizeClassName(action.className, "gui-dialog-action-btn");
              if (action.contentClassName) {
                const content = document.createElement("span");
                content.className = normalizeClassName(action.contentClassName);
                content.textContent = action.label || "Action";
                button.appendChild(content);
              } else {
                button.textContent = action.label || "Action";
              }
              button.title = action.title || "";
              if (!isLabel) button.disabled = Boolean(action.disabled);
              if (isLabel && action.htmlFor) button.htmlFor = String(action.htmlFor);
              button.dataset.dialogId = dialog.id || "";
              button.dataset.actionIndex = String(action.actionIndex ?? actionIndex);
              button.dataset.actionId = action.actionId || `button-${actionIndex}`;
              applyDataset(button, action.data);
              if (action.ariaLabel) button.setAttribute("aria-label", action.ariaLabel);
              if (action.ariaInvalid !== null && action.ariaInvalid !== undefined) {
                button.setAttribute("aria-invalid", String(action.ariaInvalid));
              }
              if (action.ariaPressed !== null && action.ariaPressed !== undefined) {
                button.setAttribute("aria-pressed", String(action.ariaPressed));
              }
              return button;
            };

            if (samplePadManifest) {
              panel.dataset.dialogDomTruncated = String(samplePadManifest.truncated === true);
              panel.dataset.dialogDomOmittedChildren = String(
                Math.max(0, Number(samplePadManifest.omittedDirectChildren) || 0),
              );
            }
            if (
              samplePadManifest?.schema === "mxs-004.cast-dialog-dom.v1" &&
              samplePadManifest.version === 1 &&
              (samplePadManifest.truncated !== true || exactMediaSessionsDialog || (Array.isArray(samplePadManifest.children) && samplePadManifest.children.length > 0)) &&
              Array.isArray(samplePadManifest.children)
            ) {
              const allowedTags = new Set([
                "a",
                "b",
                "button",
                "canvas",
                "code",
                "div",
                "em",
                "h1",
                "h2",
                "h3",
                "h4",
                "h5",
                "h6",
                "hr",
                "i",
                "input",
                "label",
                "li",
                "ol",
                "option",
                "output",
                "p",
                "pre",
                "select",
                "span",
                "strong",
                "table",
                "tbody",
                "td",
                "textarea",
                "th",
                "thead",
                "tr",
                "ul",
              ]);
              const controlsByIndex = new Map();
              (dialog.controls || []).forEach((control, index) => {
                const controlIndex = Number(control.controlIndex ?? index);
                if (Number.isInteger(controlIndex) && controlIndex >= 0 && !controlsByIndex.has(controlIndex)) {
                  controlsByIndex.set(controlIndex, control);
                }
              });
              const actionsByIndex = new Map();
              actions.forEach((action, index) => {
                const actionIndex = Number(action.actionIndex ?? index);
                if (Number.isInteger(actionIndex) && actionIndex >= 0 && !actionsByIndex.has(actionIndex)) {
                  actionsByIndex.set(actionIndex, action);
                }
              });
              let hydratedNodeCount = 0;
              const hydrateNode = (node, depth = 0) => {
                if (!node || depth > 24 || hydratedNodeCount >= 2048) return null;
                if (node.nodeType === "text") {
                  hydratedNodeCount += 1;
                  return document.createTextNode(String(node.text || "").slice(0, 512));
                }
                const tagName = String(node.tagName || "").toLowerCase();
                if (node.nodeType !== "element" || !allowedTags.has(tagName)) return null;
                hydratedNodeCount += 1;
                const element = document.createElement(tagName);
                const attributes = node.attributes || {};
                element.className = normalizeClassName(attributes.className);
                if (/^[A-Za-z][A-Za-z0-9_:.-]{0,127}$/.test(String(attributes.id || ""))) {
                  element.id = String(attributes.id);
                }
                Object.entries(attributes).forEach(([name, value]) => {
                  if (value === undefined || value === null) return;
                  if (
                    ((name.startsWith("data-") || name.startsWith("aria-")) && /^(data|aria)-[a-z0-9-]+$/.test(name)) ||
                    [
                      "type", "min", "max", "step", "value", "placeholder", "inputmode",
                      "name", "disabled", "checked", "selected", "width", "height",
                      "for", "role", "title"
                    ].includes(name)
                  ) {
                    element.setAttribute(name, String(value).slice(0, 256));
                  }
                });
                if (tagName === "input") {
                  if (attributes.type) element.type = String(attributes.type);
                  if (attributes.min !== undefined) element.min = String(attributes.min);
                  if (attributes.max !== undefined) element.max = String(attributes.max);
                  if (attributes.step !== undefined) element.step = String(attributes.step);
                  if (attributes.value !== undefined) element.value = String(attributes.value);
                  if (attributes.checked !== undefined) element.checked = Boolean(attributes.checked);
                }
                if (tagName === "option") {
                  if (attributes.value !== undefined) element.value = String(attributes.value);
                  if (attributes.selected) element.selected = true;
                  if (attributes.disabled) element.disabled = true;
                }
                applyDataset(element, node.data);

                const controlIndex = node.controlIndex;
                if (Number.isInteger(controlIndex) && controlIndex >= 0) {
                  const control = controlsByIndex.get(controlIndex);
                  if (control) applyControlState(element, control, dialog, controlIndex);
                }

                const actionIndex = node.actionIndex;
                if (Number.isInteger(actionIndex) && actionIndex >= 0) {
                  const action = actionsByIndex.get(actionIndex);
                  if (action) {
                    element.className = normalizeClassName(action.className, "gui-dialog-action-btn");
                    if (element.tagName === "BUTTON") {
                      element.type = "button";
                      element.disabled = Boolean(action.disabled);
                    }
                    if (element.tagName === "LABEL" && action.htmlFor) {
                      element.htmlFor = String(action.htmlFor);
                    }
                    element.dataset.dialogId = dialog.id || "";
                    element.dataset.actionIndex = String(actionIndex);
                    element.dataset.actionId = action.actionId || `button-${actionIndex}`;
                    applyDataset(element, action.data);
                    if (action.title) element.title = String(action.title);
                    if (action.ariaLabel) element.setAttribute("aria-label", action.ariaLabel);
                    if (action.ariaInvalid !== null && action.ariaInvalid !== undefined) {
                      element.setAttribute("aria-invalid", String(action.ariaInvalid));
                    }
                    if (action.ariaPressed !== null && action.ariaPressed !== undefined) {
                      element.setAttribute("aria-pressed", String(action.ariaPressed));
                    }
                  }
                }

                if (tagName !== "input") {
                  (node.children || []).forEach((child) => {
                    const hydrated = hydrateNode(child, depth + 1);
                    if (hydrated) element.appendChild(hydrated);
                  });
                }
                return element;
              };
              samplePadManifest.children.forEach((node) => {
                const hydrated = hydrateNode(node);
                if (hydrated) panel.appendChild(hydrated);
              });
              panel.dataset.dialogDomSchema = samplePadManifest.schema;
              panel.dataset.dialogDomNodes = String(hydratedNodeCount);
              appendMirroredPanel(panel, dialog.modal === true);
              queueMirroredSamplerCanvasRender(panel, dialog);
              return;
            }

            if (exactSamplePadDialog) {
              const layout = dialog.samplePadLayout;
              const actionByIndex = (index) => actions.find(
                (action) => Number(action.actionIndex) === Number(index),
              );
              const controls = Array.isArray(dialog.controls) ? dialog.controls : [];
              const controlByIndex = (index) => controls.find(
                (control, controlIndex) =>
                  Number(control.controlIndex ?? controlIndex) === Number(index),
              );
              const appendActionByIndex = (container, index) => {
                const action = actionByIndex(index);
                if (action) container.appendChild(renderAction(action, action.actionIndex));
              };
              const appendActionRows = (container, rows) => {
                (rows || []).forEach((rowState) => {
                  const row = document.createElement("div");
                  row.className = normalizeClassName(rowState.className, "pad-control-row");
                  (rowState.actionIndices || []).forEach((index) => {
                    appendActionByIndex(row, index);
                  });
                  container.appendChild(row);
                });
              };

              const headerState = dialog.header || {};
              const header = document.createElement("div");
              header.className = normalizeClassName(headerState.className, "dialog-header");
              if (layout.closeActionIndex !== undefined && layout.closeActionIndex >= 0) {
                const closeRow = document.createElement("div");
                closeRow.className = normalizeClassName(
                  layout.closeRowClassName,
                  "effect-dialog-close-row pad-dialog-close-row",
                );
                const typeBadge = document.createElement("span");
                typeBadge.className = "dialog-effect-type pad-dialog-type-badge";
                typeBadge.textContent = layout.dialogEffectType || "SAMPLE PAD:";
                closeRow.appendChild(typeBadge);
                appendActionByIndex(closeRow, layout.closeActionIndex);
                header.appendChild(closeRow);
              }
              const headerTop = document.createElement("div");
              headerTop.className = normalizeClassName(
                layout.headerTopClassName || headerState.topClassName,
                "dialog-header-top pad-dialog-title-row effect-dialog-title-row",
              );
              const navGroup = document.createElement("div");
              navGroup.className = normalizeClassName(
                layout.navGroupClassName,
                "pad-dialog-nav-group",
              );
              appendActionByIndex(navGroup, layout.previousActionIndex);
              const heading = document.createElement("span");
              heading.className = normalizeClassName(
                headerState.titleClassName,
                "dialog-title effect-dialog-title-text",
              );
              if (layout.titleId) heading.id = String(layout.titleId);
              const padTitle = document.createElement("span");
              padTitle.className = "pad-dialog-pad-title";
              padTitle.textContent = layout.padTitleText || `Pad ${dialog.padId || ""}:`;
              const sampleName = document.createElement("span");
              sampleName.dataset.padSampleName = "";
              sampleName.textContent = layout.sampleNameText || "No sample loaded";
              heading.append(padTitle, document.createTextNode(" "), sampleName);
              navGroup.appendChild(heading);
              appendActionByIndex(navGroup, layout.nextActionIndex);
              headerTop.appendChild(navGroup);
              if (header.children.length === 0) {
                appendActionByIndex(headerTop, layout.closeActionIndex);
              }
              header.appendChild(headerTop);
              panel.appendChild(header);

              panel.dataset.padTab = layout.activeTab || "main";
              const tabsContainer = document.createElement("div");
              tabsContainer.className = "pad-dialog-tabs";
              tabsContainer.setAttribute("role", "tablist");
              tabsContainer.setAttribute("aria-label", "Pad Settings Categories");
              const tabsList = Array.isArray(layout.tabs) && layout.tabs.length > 0 ? layout.tabs : [
                { id: "main", label: "MAIN" },
                { id: "envelope", label: "ENVELOPE" },
                { id: "tone-dac", label: "TONE & DAC" },
                { id: "playback", label: "PLAYBACK" },
                { id: "performance", label: "PERFORMANCE" },
                { id: "pad-fx", label: "PAD FX" },
              ];
              tabsList.forEach((tab) => {
                const tabBtn = document.createElement("button");
                tabBtn.type = "button";
                tabBtn.className = "pad-dialog-tab-btn";
                const isActive = tab.id === (panel.dataset.padTab || "main");
                if (isActive) tabBtn.classList.add("active");
                tabBtn.setAttribute("role", "tab");
                tabBtn.setAttribute("aria-selected", String(isActive));
                tabBtn.dataset.padTab = tab.id;
                const tabAction = actionByIndex(tab.actionIndex);
                if (tabAction) {
                  tabBtn.dataset.dialogId = dialog.id || "";
                  tabBtn.dataset.actionIndex = String(tab.actionIndex);
                  tabBtn.dataset.actionId = tabAction.actionId || `button-${tab.actionIndex}`;
                  applyDataset(tabBtn, tabAction.data);
                }
                tabBtn.textContent = tab.label;
                tabBtn.addEventListener("click", () => {
                  panel.dataset.padTab = tab.id;
                  tabsContainer.querySelectorAll(".pad-dialog-tab-btn").forEach((b) => {
                    const active = b.dataset.padTab === tab.id;
                    b.classList.toggle("active", active);
                    b.setAttribute("aria-selected", String(active));
                  });
                });
                tabsContainer.appendChild(tabBtn);
              });
              panel.appendChild(tabsContainer);

              const content = document.createElement("div");
              content.className = normalizeClassName(
                dialog.contentClassName,
                "dialog-content pad-dialog-content",
              );
              const scrollContent = document.createElement("div");
              scrollContent.className = normalizeClassName(
                layout.scrollClassName,
                "pad-dialog-scroll-content",
              );
              const primaryRows = document.createElement("div");
              primaryRows.className = normalizeClassName(
                layout.primaryRowsClassName,
                "pad-control-rows",
              );
              primaryRows.dataset.tab = "main performance";
              appendActionRows(primaryRows, layout.primaryRows);
              scrollContent.appendChild(primaryRows);
              const bottomControlRows = document.createElement("div");
              bottomControlRows.className = normalizeClassName(
                layout.bottomControlRowsClassName,
                "pad-dialog-bottom-control-rows",
              );
              bottomControlRows.dataset.tab = "main performance";
              appendActionRows(bottomControlRows, layout.bottomControlRows);
              scrollContent.appendChild(bottomControlRows);
              const settingsStrip = document.createElement("div");
              settingsStrip.className = normalizeClassName(
                layout.settingsStripClassName,
                "pad-settings-strip",
              );
              (layout.settings || []).forEach((item) => {
                if (item.kind === "bpmModule") {
                  const bpmField = document.createElement("div");
                  bpmField.className = normalizeClassName(item.className, "pad-setting-field pad-bpm-module");
                  bpmField.dataset.tab = "main";
                  const line1 = document.createElement("div");
                  line1.className = "pad-bpm-line1";
                  const title = document.createElement("div");
                  title.className = "pad-bpm-title";
                  title.textContent = "BPM";
                  const baseBadge = document.createElement("span");
                  baseBadge.className = "pad-bpm-base-badge";
                  baseBadge.textContent = item.baseBpmText || "Base: 120.0";
                  baseBadge.title = baseBadge.textContent;
                  baseBadge.setAttribute("aria-label", baseBadge.textContent);
                  baseBadge.setAttribute("aria-live", "polite");
                  baseBadge.setAttribute("aria-atomic", "true");
                  const counterContainer = document.createElement("div");
                  counterContainer.className = "pad-bpm-counter-container";
                  const counterCtrl = controlByIndex(item.counterControlIndex);
                  if (counterCtrl) {
                    const input = document.createElement("input");
                    input.type = "text";
                    applyControlState(input, counterCtrl, dialog, item.counterControlIndex);
                    input.className = normalizeClassName(counterCtrl.className, "pad-bpm-counter");
                    counterContainer.appendChild(input);
                  }
                  appendActionByIndex(counterContainer, item.halfActionIndex);
                  appendActionByIndex(counterContainer, item.doubleActionIndex);
                  line1.append(title, baseBadge, counterContainer);

                  const line2 = document.createElement("div");
                  line2.className = "pad-bpm-line2";
                  const syncAllLabel = document.createElement("label");
                  syncAllLabel.className = "pad-bpm-sync-all-label";
                  const syncAllCtrl = controlByIndex(item.syncAllControlIndex);
                  if (syncAllCtrl) {
                    const syncAllChk = document.createElement("input");
                    syncAllChk.type = "checkbox";
                    applyControlState(syncAllChk, syncAllCtrl, dialog, item.syncAllControlIndex);
                    syncAllChk.className = normalizeClassName(syncAllCtrl.className, "pad-bpm-sync-all-chk");
                    syncAllLabel.appendChild(syncAllChk);
                  }
                  const syncAllText = document.createElement("span");
                  syncAllText.className = "pad-bpm-sync-all-text";
                  syncAllText.textContent = "SYNC ALL";
                  syncAllLabel.appendChild(syncAllText);

                  const syncWithGroup = document.createElement("div");
                  syncWithGroup.className = "pad-bpm-sync-with-group";
                  const syncWithLabel = document.createElement("span");
                  syncWithLabel.className = "pad-bpm-sync-with-label";
                  syncWithLabel.textContent = "SYNC";
                  const syncButtons = document.createElement("div");
                  syncButtons.className = "pad-bpm-sync-buttons";
                  (item.syncButtons || []).forEach((sBtn) => {
                    const btn = document.createElement("button");
                    btn.type = "button";
                    btn.className = normalizeClassName(sBtn.className, "pad-bpm-sync-btn");
                    btn.textContent = String(sBtn.track || "");
                    btn.dataset.track = String(sBtn.track || "");
                    if (sBtn.selected) btn.classList.add("is-selected");
                    if (sBtn.populated) btn.classList.add("is-populated");
                    if (sBtn.actionIndex >= 0) {
                      const action = actionByIndex(sBtn.actionIndex);
                      if (action) {
                        btn.dataset.dialogId = dialog.id || "";
                        btn.dataset.actionIndex = String(sBtn.actionIndex);
                        btn.dataset.actionId = action.actionId || `button-${sBtn.actionIndex}`;
                        applyDataset(btn, action.data);
                        if (action.title) btn.title = String(action.title);
                        if (action.ariaLabel) btn.setAttribute("aria-label", action.ariaLabel);
                      }
                    }
                    syncButtons.appendChild(btn);
                  });
                  syncWithGroup.append(syncWithLabel, syncButtons);
                  line2.append(syncAllLabel, syncWithGroup);
                  bpmField.append(line1, line2);
                  settingsStrip.appendChild(bpmField);
                  return;
                }
                const isAction = item.kind === "action";
                const field = document.createElement(isAction ? "div" : "label");
                field.className = normalizeClassName(
                  item.className,
                  isAction ? "pad-setting-field pad-setting-action-field" : "pad-setting-field",
                );
                applyDataset(field, item.data);
                const caption = document.createElement("span");
                caption.textContent = item.caption || "Parameter";
                if (isAction) {
                  field.appendChild(caption);
                  appendActionByIndex(field, item.actionIndex);
                  settingsStrip.appendChild(field);
                  return;
                }
                const control = controlByIndex(item.controlIndex);
                if (!control) return;
                const tagName = control.tagName || (control.type === "select-one" ? "select" : "input");
                const value = document.createElement(
                  tagName === "textarea" ? "textarea" : tagName === "select" ? "select" : "input",
                );
                applyControlState(value, control, dialog, item.controlIndex);
                if (control.type === "checkbox") {
                  field.append(value, caption);
                } else if (control.type === "range") {
                  const wrapper = document.createElement("span");
                  wrapper.className = normalizeClassName(
                    control.controlWrapperClassName,
                    "pad-setting-range-control",
                  );
                  const output = document.createElement("output");
                  output.className = normalizeClassName(
                    control.settingValueClassName,
                    "pad-setting-value",
                  );
                  output.textContent = control.displayValue ?? formatMirroredParameterDisplay(
                    control.displayDescriptor,
                    control.rawValue ?? value.value,
                  );
                  writeMirroredDisplayDescriptor(output, control.displayDescriptor, output.textContent);
                  writeMirroredDisplayDescriptor(value, control.displayDescriptor, output.textContent);
                  wrapper.append(value, output);
                  field.append(caption, wrapper);
                } else {
                  field.append(caption, value);
                }
                settingsStrip.appendChild(field);
              });
              scrollContent.appendChild(settingsStrip);
              content.appendChild(scrollContent);
              panel.appendChild(content);

              const footer = document.createElement("div");
              footer.className = normalizeClassName(
                layout.footerClassName,
                "pad-dialog-bottom-actions",
              );
              (layout.footerActionIndices || []).forEach((index) => {
                appendActionByIndex(footer, index);
              });
              panel.appendChild(footer);
              appendMirroredPanel(panel, dialog.modal === true);
              return;
            }

            const headerState = dialog.header || {};
            const header = document.createElement("div");
            header.className = normalizeClassName(headerState.className, "dialog-header");
            const headerTop = document.createElement("div");
            headerTop.className = normalizeClassName(headerState.topClassName, "dialog-header-top");
            const titleLines = Array.isArray(headerState.titleLines) ? headerState.titleLines : [];
            const compactTrackHeader = exactEffectDialog &&
              dialog.dialogLayoutVersion >= 5 &&
              titleLines.some((line) => /(?:^|\s)dialog-effect-type(?:\s|$)/.test(line.className || ""));
            if (compactTrackHeader) {
              const effectTypeState = titleLines.find((line) =>
                /(?:^|\s)dialog-effect-type(?:\s|$)/.test(line.className || ""),
              );
              const effectTitleState = titleLines.find((line) =>
                /(?:^|\s)effect-dialog-title-text(?:\s|$)/.test(line.className || ""),
              );
              const effectType = document.createElement("span");
              effectType.className = normalizeClassName(effectTypeState?.className, "dialog-effect-type");
              effectType.textContent = effectTypeState?.text || "Effect:";
              const titleViewport = document.createElement("span");
              titleViewport.className = normalizeClassName(
                headerState.titleViewportClassName,
                "effect-dialog-title-viewport",
              );
              titleViewport.classList.toggle("is-overflowing", headerState.titleOverflowing === true);
              const heading = document.createElement("span");
              heading.className = normalizeClassName(
                effectTitleState?.className || headerState.titleClassName,
                "dialog-header-title dialog-title-bottom effect-dialog-title-text",
              );
              heading.textContent = effectTitleState?.text || headerState.title || dialog.title || "MXS-004";
              titleViewport.appendChild(heading);
              const balance = document.createElement("span");
              balance.className = normalizeClassName(
                headerState.titleBalanceClassName,
                "effect-dialog-title-balance",
              );
              balance.setAttribute("aria-hidden", "true");
              const closeRow = document.createElement("div");
              closeRow.className = "effect-dialog-close-row";
              closeRow.appendChild(effectType);
              actions.forEach((action, actionIndex) => {
                if (actionPlacement(action) === "header") closeRow.appendChild(renderAction(action, actionIndex));
              });
              header.appendChild(closeRow);
              headerTop.append(titleViewport, balance);
            } else {
              actions.forEach((action, actionIndex) => {
                if (actionPlacement(action) === "header") header.appendChild(renderAction(action, actionIndex));
              });
              const heading = document.createElement("span");
              heading.className = normalizeClassName(headerState.titleClassName, "dialog-header-title");
              if (titleLines.length) {
                titleLines.forEach((line) => {
                  const titleLine = document.createElement("span");
                  titleLine.className = normalizeClassName(line.className);
                  titleLine.textContent = line.text || "";
                  heading.appendChild(titleLine);
                });
              } else {
                heading.textContent = headerState.title || dialog.title || "MXS-004";
              }
              headerTop.appendChild(heading);
            }
            header.appendChild(headerTop);
            if (headerState.status) {
              const status = document.createElement("span");
              status.className = normalizeClassName(headerState.statusClassName, "dialog-header-status");
              status.textContent = headerState.status;
              header.appendChild(status);
            }
            const headerActions = actions.filter((action) => actionPlacement(action) === "headerActions");
            const trackSwitcherActions = actions.filter((action) => actionPlacement(action) === "trackSwitcher");
            if (compactTrackHeader && (trackSwitcherActions.length || headerActions.length)) {
              const toolbar = document.createElement("div");
              toolbar.className = normalizeClassName(
                headerState.toolbarClassName,
                "effect-dialog-toolbar-row",
              );
              if (trackSwitcherActions.length) {
                const trackSwitcher = document.createElement("div");
                trackSwitcher.className = normalizeClassName(
                  headerState.trackSwitcherClassName,
                  "dialog-track-switcher",
                );
                trackSwitcher.setAttribute("role", "group");
                trackSwitcher.setAttribute("aria-label", "Open track effect dialogs");
                const trackLabel = document.createElement("span");
                trackLabel.className = normalizeClassName(
                  headerState.trackLabelClassName,
                  "dialog-track-label",
                );
                trackLabel.textContent = headerState.trackLabelText || "Track:";
                trackSwitcher.appendChild(trackLabel);
                trackSwitcherActions.forEach((action) => {
                  trackSwitcher.appendChild(renderAction(action, action.actionIndex));
                });
                toolbar.appendChild(trackSwitcher);
              }
              if (headerActions.length) {
                const actionsBar = document.createElement("div");
                actionsBar.className = normalizeClassName(
                  headerState.actionsClassName,
                  "dialog-header-actions-bar",
                );
                headerActions.forEach((action) => {
                  actionsBar.appendChild(renderAction(action, action.actionIndex));
                });
                toolbar.appendChild(actionsBar);
              }
              header.appendChild(toolbar);
            } else if (headerActions.length) {
              const actionsBar = document.createElement("div");
              actionsBar.className = normalizeClassName(
                headerState.actionsClassName,
                "dialog-header-actions-bar",
              );
              headerActions.forEach((action) => {
                actionsBar.appendChild(renderAction(action, action.actionIndex));
              });
              header.appendChild(actionsBar);
            }
            panel.appendChild(header);

            const content = document.createElement("div");
            content.className = normalizeClassName(dialog.contentClassName, "dialog-content");
            (dialog.text || []).forEach((text) => {
              const help = document.createElement("p");
              help.textContent = text;
              content.appendChild(help);
            });
            const controls = Array.isArray(dialog.controls) ? dialog.controls : [];
            const exactEffectLayout = dialog.dialogLayoutVersion >= 1 &&
              dialog.kind === "effectAudition" && controls.some((control) => control.groupClassName);
            let controlsRoot = content;
            if (exactEffectLayout) {
              const grid = document.createElement("div");
              grid.className = normalizeClassName(
                controls.find((control) => control.gridClassName)?.gridClassName,
                "effect-params-wrapper effect-params-grid",
              );
              content.appendChild(grid);
              controlsRoot = grid;
            }
            controls.forEach((control, controlIndex) => {
              const tagName = control.tagName || (control.type === "select-one" ? "select" : "input");
              const value = document.createElement(
                tagName === "textarea" ? "textarea" : tagName === "select" ? "select" : "input",
              );
              applyControlState(value, control, dialog, controlIndex);
              if (exactEffectLayout) {
                const group = document.createElement("div");
                group.className = normalizeClassName(
                  control.groupClassName,
                  "control-group effect-control-group",
                );
                group.dataset.dialogId = dialog.id || "";
                group.dataset.controlIndex = String(control.controlIndex ?? controlIndex);
                const title = document.createElement("div");
                title.className = normalizeClassName(control.titleClassName, "effect-param-title");
                const label = document.createElement("label");
                label.textContent = control.label || control.parameterKey || "Parameter";
                title.appendChild(label);
                const sliderWrapper = document.createElement("div");
                sliderWrapper.className = normalizeClassName(
                  control.sliderWrapperClassName,
                  "slider-wrapper",
                );
                sliderWrapper.appendChild(value);
                const valueContainer = document.createElement("div");
                valueContainer.className = normalizeClassName(
                  control.valueContainerClassName,
                  "effect-param-value",
                );
                const output = document.createElement("span");
                output.className = normalizeClassName(control.valueClassName, "param-value");
                output.textContent = control.displayValue || `${control.rawValue ?? ""}${control.unit || ""}`;
                writeMirroredDisplayDescriptor(output, control.displayDescriptor, output.textContent);
                writeMirroredDisplayDescriptor(value, control.displayDescriptor, output.textContent);
                valueContainer.appendChild(output);
                group.append(title, sliderWrapper, valueContainer);
                controlsRoot.appendChild(group);
                return;
              }
              const row = document.createElement("label");
              row.className = ["gui-dialog-mirror-control", control.containerClassName || ""].filter(Boolean).join(" ");
              row.dataset.controlType = control.type || "text";
              row.dataset.dialogId = dialog.id || "";
              row.dataset.controlIndex = String(controlIndex);
              const label = document.createElement("span");
              label.textContent = control.label || "Parameter";
              row.appendChild(label);
              row.appendChild(value);
              if (["range", "number"].includes(control.type)) {
                const output = document.createElement("output");
                output.textContent = control.displayValue ?? formatMirroredParameterDisplay(
                  control.displayDescriptor,
                  control.rawValue ?? value.value,
                );
                output.className = "gui-dialog-mirror-value";
                writeMirroredDisplayDescriptor(output, control.displayDescriptor, output.textContent);
                writeMirroredDisplayDescriptor(value, control.displayDescriptor, output.textContent);
                row.appendChild(output);
              }
              controlsRoot.appendChild(row);
            });
            panel.appendChild(content);
            const effectSlotTabs = dialog.effectSlotTabs;
            if (
              exactEffectDialog &&
              effectSlotTabs &&
              Array.isArray(effectSlotTabs.items) &&
              effectSlotTabs.items.length
            ) {
              const tabs = document.createElement("div");
              tabs.className = normalizeClassName(
                effectSlotTabs.className,
                "vertical-slot-tabs",
              );
              effectSlotTabs.items.forEach((item) => {
                if (item?.kind === "action") {
                  const action = actions.find(
                    (candidate) => Number(candidate.actionIndex) === Number(item.actionIndex),
                  );
                  if (action) tabs.appendChild(renderAction(action, action.actionIndex));
                  return;
                }
                if (item?.kind !== "slot" || !item.control) return;
                const slot = document.createElement("div");
                slot.className = normalizeClassName(
                  item.className,
                  "fx-chain-slot vertical-tab-slot",
                );
                const input = document.createElement("input");
                applyControlState(
                  input,
                  item.control,
                  dialog,
                  item.control.controlIndex,
                );
                slot.appendChild(input);
                const labelAction = actions.find(
                  (candidate) =>
                    Number(candidate.actionIndex) === Number(item.labelActionIndex),
                );
                if (labelAction) slot.appendChild(renderAction(labelAction, labelAction.actionIndex));
                tabs.appendChild(slot);
              });
              panel.appendChild(tabs);
            }
            const footer = document.createElement("div");
            footer.className = "dialog-bottom-actions gui-dialog-actions";
            actions.forEach((action, actionIndex) => {
              if (["footer", "content"].includes(actionPlacement(action))) {
                footer.appendChild(renderAction(action, actionIndex));
              }
            });
            if (footer.childElementCount) panel.appendChild(footer);
            appendMirroredPanel(panel, false);
            if (compactTrackHeader) {
              queueMirroredEffectTitleMarquee(panel, headerState.titleOverflowing === true);
            }
          });
          restoreMirroredDialogInteractionState(root, preservedInteractionState);
          finishDialogRender("rebuild");
        }

        function summarizeMirroredDialogVisualState() {
          const root = getEl("gui-dialog-mirror-root");
          const viewportWidth = Math.max(1, Number(window.innerWidth) || 1);
          const viewportHeight = Math.max(1, Number(window.innerHeight) || 1);
          const panels = Array.from(root?.children || []).slice(0, 4).map((panel) => {
            const rect = panel.getBoundingClientRect();
            const style = window.getComputedStyle(panel);
            const mediaScroll = panel.dataset.dialogKind === "mediaSessions"
              ? panel.querySelector(".media-dialog-view-container")
              : null;
            const intersectionWidth = Math.max(0,
              Math.min(viewportWidth, rect.right) - Math.max(0, rect.left));
            const intersectionHeight = Math.max(0,
              Math.min(viewportHeight, rect.bottom) - Math.max(0, rect.top));
            let inModalTopLayer = false;
            try { inModalTopLayer = panel.matches(":modal"); } catch (_error) {}
            const open = panel.tagName !== "DIALOG" || panel.open === true;
            const visible = root?.hidden !== true && open &&
              style.display !== "none" && style.visibility !== "hidden" &&
              Number(style.opacity || 1) > 0 &&
              intersectionWidth > 0 && intersectionHeight > 0;
            return {
              id: String(panel.dataset.dialogId || "").slice(0, 128),
              kind: String(panel.dataset.dialogKind || "generic").slice(0, 48),
              effectName: String(panel.dataset.effectName || "").slice(0, 128) || null,
              programId: String(panel.dataset.programId || "").slice(0, 32) || null,
              programName: String(panel.dataset.programName || "").slice(0, 128) || null,
              firstPaintTimeMs: Number.isFinite(Number(panel.dataset.dialogFirstPaintMs))
                ? Number(panel.dataset.dialogFirstPaintMs)
                : null,
              tag: panel.tagName,
              open,
              inModalTopLayer,
              display: style.display,
              visibility: style.visibility,
              opacity: Number(style.opacity || 1),
              viewportLeftPx: Math.round(rect.left),
              viewportTopPx: Math.round(rect.top),
              viewportIntersectionWidthPx: Math.round(intersectionWidth),
              viewportIntersectionHeightPx: Math.round(intersectionHeight),
              ...(mediaScroll ? {
                scrollViewportHeightPx: mediaScroll.clientHeight,
                scrollContentHeightPx: mediaScroll.scrollHeight,
                scrollTopPx: mediaScroll.scrollTop,
              } : {}),
              contentNodeCount: panel.querySelector(".dialog-content")?.children.length ?? 0,
              expectedControlCount: Number(panel.dataset.expectedControlCount || 0),
              renderedControlCount: panel.querySelectorAll("input, select, textarea").length,
              controlCountMismatch: Math.max(0, Number(panel.dataset.expectedControlCount || 0)) !==
                panel.querySelectorAll("input, select, textarea").length,
              manifestNodeCount: Number(panel.dataset.dialogDomNodes || 0),
              actionCount: panel.querySelectorAll("button, label[data-action]").length,
              visible,
            };
          });
          return {
            dialogViewportWidthPx: viewportWidth,
            dialogViewportHeightPx: viewportHeight,
            dialogPanelCount: root?.children.length ?? 0,
            dialogRootHidden: root?.hidden ?? true,
            dialogVisiblePanelCount: panels.filter((panel) => panel.visible).length,
            dialogPanels: panels,
          };
        }


    function reset() {
      cancelPending();
      lastDialogMirrorState = "";
      lastDialogMirrorLayoutState = "";
      lastDialogRegistryState = "";
      lastDialogRenderStats = { mode:"none", renderTimeMs:0, dialogCount:0, domNodeCount:0 };
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      reset();
      const root = getEl("gui-dialog-mirror-root");
      if (root) {
        root.querySelectorAll("dialog[open]").forEach(panel => { try { panel.close?.(); } catch (_) {} });
        root.replaceChildren(); root.hidden = true;
      }
    }
    return Object.freeze({
      render: renderDialogMirrors, registry: renderDialogRegistry,
      summarize: summarizeMirroredDialogVisualState, reset, dispose,
      getStats: () => ({...lastDialogRenderStats}),
      layoutSignature: getDialogMirrorLayoutSignature,
      patch: (root, dialogs) => !disposed && patchMirroredDialogState(root, dialogs),
    });
  };

  Object.defineProperty(window, "MXSCreateStudioDialogs", {
    value: Object.freeze(createStudioDialogs),
    writable: false,
    configurable: false,
    enumerable: true,
  });
})();

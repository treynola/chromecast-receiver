/* Studio DOM structure only: no session, transport, audio or video owner. */
(function () {
  "use strict";
  const createStudioStructure = function ({ document, knobConfigs, samplerColumns = 5, samplerRows = 4, onRemoveElement = () => {} }) {
    const RECEIVER_SAMPLER_COLUMNS = samplerColumns;
    const RECEIVER_SAMPLER_ROWS = samplerRows;
    const RECEIVER_SAMPLER_PAD_COUNT = samplerColumns * samplerRows;
        function lockReceiverSamplerGridLayout(sampleGrid) {
          if (!sampleGrid) return false;
          sampleGrid.style.display = "grid";
          sampleGrid.style.gridTemplateColumns =
            "repeat(" + RECEIVER_SAMPLER_COLUMNS + ", minmax(0, 1fr))";
          sampleGrid.style.gridTemplateRows =
            "repeat(" + RECEIVER_SAMPLER_ROWS + ", minmax(0, 1fr))";
          sampleGrid.style.gridAutoFlow = "row";
          sampleGrid.style.gridAutoColumns = "minmax(0, 1fr)";
          sampleGrid.dataset.samplerColumns = String(RECEIVER_SAMPLER_COLUMNS);
          sampleGrid.dataset.samplerRows = String(RECEIVER_SAMPLER_ROWS);
          Array.from(sampleGrid.children).forEach(function positionSamplerPad(pad, index) {
            const column = (index % RECEIVER_SAMPLER_COLUMNS) + 1;
            const row = Math.floor(index / RECEIVER_SAMPLER_COLUMNS) + 1;
            pad.style.gridColumn = String(column);
            pad.style.gridRow = String(row);
            pad.dataset.samplerColumn = String(column);
            pad.dataset.samplerRow = String(row);
          });
          return sampleGrid.children.length === RECEIVER_SAMPLER_PAD_COUNT;
        }

    function build(trackCount = 4) {
          const normalizedTrackCount = Math.max(
            1,
            Math.min(32, Math.floor(Number(trackCount) || 4)),
          );
          if (!document.getElementById("gui-dialog-registry-root")) {
            const registryRoot = document.createElement("div");
            registryRoot.id = "gui-dialog-registry-root";
            registryRoot.setAttribute("aria-live", "polite");
            const studioRoot = document.getElementById("studio-root");
            if (studioRoot) studioRoot.appendChild(registryRoot);
          }
          if (!document.getElementById("gui-dialog-mirror-root")) {
            const dialogRoot = document.createElement("div");
            dialogRoot.id = "gui-dialog-mirror-root";
            dialogRoot.setAttribute("aria-hidden", "true");
            document.body.appendChild(dialogRoot);
          }
          if (!document.getElementById("waveform-render-status")) {
            const waveformStatus = document.createElement("div");
            waveformStatus.id = "waveform-render-status";
            waveformStatus.setAttribute("role", "status");
            waveformStatus.setAttribute("aria-live", "polite");
            const studioRoot = document.getElementById("studio-root");
            if (studioRoot) studioRoot.appendChild(waveformStatus);
          }
          var g = document.getElementById("sample-grid");
          if (g && g.children.length !== RECEIVER_SAMPLER_PAD_COUNT) {
            g.innerHTML = "";
            for (var p = 1; p <= RECEIVER_SAMPLER_PAD_COUNT; p++) {
              var b = document.createElement("button");
              b.className = "sample-btn";
              b.id = "sample-" + p;
              b.dataset.sample = String(p);
              b.type = "button";
              b.setAttribute("aria-label", "Sample Pad " + p);
              b.textContent = p;
              g.appendChild(b);
            }
          }
          lockReceiverSamplerGridLayout(g);
          var grid = document.getElementById("main-grid");
          if (grid) {
            grid.style.gridTemplateColumns = `repeat(${normalizedTrackCount + 1}, minmax(0, 1fr))`;
            Array.from(grid.querySelectorAll(".track[data-track-index]")).forEach(
              (trackNode) => {
                const index = Number(trackNode.dataset.trackIndex);
                if (Number.isInteger(index) && index >= normalizedTrackCount) {
                  [trackNode, ...trackNode.querySelectorAll("[id]")].forEach((element) => {
                    if (!element.id) return;
                    onRemoveElement(element.id);
                  });
                  trackNode.remove();
                }
              },
            );
          }
          for (var i = 0; i < normalizedTrackCount; i++) {
            var existingTrack = document.getElementById("track-" + i);
            if (existingTrack) {
              if (!existingTrack.querySelector(".track-bpm-module")) {
                const bpmModule = document.createElement("div");
                bpmModule.className = "track-bpm-module";
                bpmModule.dataset.trackIndex = String(i);
                bpmModule.id = `t-bpm-module-${i}`;
                bpmModule.innerHTML = `<div class="track-bpm-line1"><span class="track-bpm-title">BPM</span><span class="track-bpm-base-badge" id="t-bpm-base-badge-${i}">Base: 120.0</span><div class="track-bpm-counter-container"><input type="text" inputmode="decimal" class="track-bpm-counter" id="t-bpm-counter-${i}" data-action="edit-bpm-counter" data-track-index="${i}" value="120.0" title="Current track tempo in BPM. Enter target BPM to adjust Pitch, or Shift+Enter to calibrate base BPM."><button type="button" class="track-bpm-multiplier-btn track-bpm-half-btn" id="t-bpm-half-${i}" data-action="track-bpm-half" data-track-index="${i}" title="Half tempo (/2)">/2</button><button type="button" class="track-bpm-multiplier-btn track-bpm-double-btn" id="t-bpm-double-${i}" data-action="track-bpm-double" data-track-index="${i}" title="Double tempo (x2)">x2</button></div></div><div class="track-bpm-line2"><label class="track-bpm-sync-all-label"><input type="checkbox" id="t-sync-all-${i}" class="track-bpm-sync-all-chk" data-action="toggle-bpm-sync-all" data-track-index="${i}" title="Lock all tracks to follow this track's tempo."><span class="track-bpm-sync-all-text">SYNC ALL</span></label><div class="track-bpm-sync-with-group"><span class="track-bpm-sync-with-label">SYNC WITH:</span><div class="track-bpm-sync-buttons" role="group" aria-label="Sync Track ${i + 1} with other tracks">${[0, 1, 2, 3].filter((t) => t !== i).map((t) => `<button type="button" class="dialog-track-button track-bpm-sync-btn is-populated" id="t-bpm-sync-${i}-to-${t}" data-action="toggle-bpm-sync-target" data-track-index="${i}" data-target-track="${t}" aria-pressed="false" title="Toggle tempo sync with Track ${t + 1}">${t + 1}</button>`).join("")}</div></div></div>`;
                const loopControls = existingTrack.querySelector(".loop-controls");
                if (loopControls) {
                  existingTrack.insertBefore(bpmModule, loopControls);
                } else {
                  const wfBox = existingTrack.querySelector(".waveform-box");
                  if (wfBox && wfBox.nextSibling) existingTrack.insertBefore(bpmModule, wfBox.nextSibling);
                  else existingTrack.appendChild(bpmModule);
                }
              }
              continue;
            }
            var t = document.createElement("div");
            t.className = "track";
            t.id = "track-" + i;
            t.dataset.trackIndex = String(i);
            t.innerHTML = `
                        <button type="button" class="track-header track-header-btn" id="t-header-btn-${i}" data-action="open-track-playlist" data-track-index="${i}" title="Open Track ${i + 1} Playlist">TRACK ${i + 1}</button>
                        <div class="track-playlist-nav" id="t-playlist-nav-${i}" style="display: none;"><button id="t-pl-prev-${i}" class="fx-chain-arrow track-playlist-arrow track-playlist-prev" data-action="playlist-prev" data-track-index="${i}">&lt;</button><div class="track-playlist-info" id="t-pl-info-${i}"><span class="track-playlist-counter" id="t-pl-counter-${i}">1/1</span></div><button id="t-pl-next-${i}" class="fx-chain-arrow track-playlist-arrow track-playlist-next" data-action="playlist-next" data-track-index="${i}">&gt;</button></div>
                        <div class="track-time-display" id="t-time-${i}">00:00:00:00</div>
                        <div class="status-indicator status-ready" id="t-st-${i}"><div class="scrolling-text-wrapper"><span class="scrolling-text" id="t-scroll-${i}">Ready</span></div></div>
                        <div class="waveform-box"><div class="waveform-labels"><div class="waveform-label-external waveform-label-l">L</div><div class="waveform-label-external waveform-label-r">R</div></div><div class="waveform-canvas-container"><canvas class="waveform-canvas track-waveform-canvas-L" data-waveform-surface="track-${i + 1}-left" id="t-wf-l-${i}" width="238" height="26"></canvas><canvas class="waveform-canvas track-waveform-canvas-R" data-waveform-surface="track-${i + 1}-right" id="t-wf-r-${i}" width="238" height="26"></canvas><div class="loop-marker loop-start-marker" id="t-ls-m-${i}"></div><div class="loop-marker loop-end-marker" id="t-le-m-${i}"></div><div class="play-marker is-at-start" id="t-playhead-${i}"></div></div></div>
                        <div class="track-bpm-module" data-track-index="${i}" id="t-bpm-module-${i}"><div class="track-bpm-line1"><span class="track-bpm-title">BPM</span><span class="track-bpm-base-badge" id="t-bpm-base-badge-${i}">Base: 120.0</span><div class="track-bpm-counter-container"><input type="text" inputmode="decimal" class="track-bpm-counter" id="t-bpm-counter-${i}" data-action="edit-bpm-counter" data-track-index="${i}" value="120.0" title="Current track tempo in BPM. Enter target BPM to adjust Pitch, or Shift+Enter to calibrate base BPM."><button type="button" class="track-bpm-multiplier-btn track-bpm-half-btn" id="t-bpm-half-${i}" data-action="track-bpm-half" data-track-index="${i}" title="Half tempo (/2)">/2</button><button type="button" class="track-bpm-multiplier-btn track-bpm-double-btn" id="t-bpm-double-${i}" data-action="track-bpm-double" data-track-index="${i}" title="Double tempo (x2)">x2</button></div></div><div class="track-bpm-line2"><label class="track-bpm-sync-all-label"><input type="checkbox" id="t-sync-all-${i}" class="track-bpm-sync-all-chk" data-action="toggle-bpm-sync-all" data-track-index="${i}" title="Lock all tracks to follow this track's tempo."><span class="track-bpm-sync-all-text">SYNC ALL</span></label><div class="track-bpm-sync-with-group"><span class="track-bpm-sync-with-label">SYNC WITH:</span><div class="track-bpm-sync-buttons" role="group" aria-label="Sync Track ${i + 1} with other tracks">${[0, 1, 2, 3].filter((t) => t !== i).map((t) => `<button type="button" class="dialog-track-button track-bpm-sync-btn is-populated" id="t-bpm-sync-${i}-to-${t}" data-action="toggle-bpm-sync-target" data-track-index="${i}" data-target-track="${t}" aria-pressed="false" title="Toggle tempo sync with Track ${t + 1}">${t + 1}</button>`).join("")}</div></div></div></div>
                        <div class="loop-controls active" id="t-loop-ctrl-${i}" style="display: flex; opacity: 1;"><div class="loop-grid-layout"><div class="loop-line-1" style="display: flex; width: 100%; gap: 4px;"><div style="flex: 1; display: flex; align-items: center; justify-content: flex-start;"><label style="font-size: 11px;">Loop Start</label></div><div style="flex: 1; display: flex; align-items: center; justify-content: space-between;"><label style="font-size: 11px;">Loop End</label><button type="button" class="slice-trigger-btn" id="t-slice-${i}" title="Create sample from loop" aria-label="Create sample from loop"><i class="fa-solid fa-scissors" aria-hidden="true"></i></button></div></div><div class="loop-line-2 slider-wrapper"><input type="range" class="loop-start-slider" data-param="loopStart" id="t-ls-sl-${i}" min="0" max="1" step="0.01"><input type="range" class="loop-end-slider" data-param="loopEnd" id="t-le-sl-${i}" min="0" max="1" step="0.01"></div><div class="loop-line-3"><span class="param-value" data-value-for="loopStart" id="t-ls-val-${i}">00:00:00:00</span><span class="param-value" data-value-for="loopEnd" id="t-le-val-${i}">00:00:01:00</span></div></div></div>
                        <div class="track-buttons"><button id="t-rec-${i}">REC</button><button id="t-stop-${i}">STOP</button><button id="t-play-${i}">PLAY</button><button id="t-rev-${i}">REV</button></div>
                        <div class="control-group track-input-group"><div class="track-input-layout"><label>INPUT</label><select id="t-input-${i}" class="input-source app-select" data-action="select-input"><option value="mic" selected>Microphone</option><option value="file">Import File</option><option value="directory">Import Directory</option><option value="mc-pa">MC PA Mode</option><option value="system">System Loopback</option></select></div></div>
                        <div class="control-group track-input-gain-group master-row-layout pa-mic-adjustment" id="input-gain-group-${i}"><label class="master-label">INPUT GAIN</label><input type="range" class="pa-mic-slider" data-param="inputGain" id="t-gain-sl-${i}" min="-48" max="24" step="0.1" value="0" title="Increment: 0.1"><span class="pa-mic-value" id="t-gain-val-${i}">0.0 dB</span></div>
                        <div class="fx-chain-container"><div class="fx-chain-title">Effects Chain:</div><div class="fx-chain-controls"><button id="t-fx-left-${i}" class="fx-chain-arrow">&lt;</button>${[0, 1, 2, 3, 4, 5, 6].map((idx) => `<div class="fx-chain-slot"><input type="checkbox" id="t-fx-chk-${i}-${idx}"><label class="fx-chain-slot-label" id="t-fx-lbl-${i}-${idx}" for="t-fx-chk-${i}-${idx}">${idx + 1}</label></div>`).join("")}<button id="t-fx-right-${i}" class="fx-chain-arrow">&gt;</button></div></div>
                        <div class="control-group track-bottom-layout"><label class="margin-0">EFFECTS</label><select id="t-effect-select-${i}" class="effect-type-select app-select flex-1-no-margin"></select></div>
                        <div class="main-controls">${knobConfigs.map((cfg) => `<div class="knob-container"><div class="knob-label-group" data-param-label="${cfg.p}"><label>${cfg.l}</label><span class="param-value" id="t-${cfg.p}-val-${i}" data-value-for="${cfg.p}">${Number(cfg.val).toFixed(1)}${cfg.u}</span><input type="checkbox" class="lfo-assign" id="t-lfo1-chk-${i}-${cfg.p}" data-lfo-assign="${cfg.p}" data-lfo-index="1" title="Click to assign ${cfg.l} LFO 1. Double-click to reverse." aria-label="Assign LFO 1 to ${cfg.l}"><input type="checkbox" class="lfo-assign lfo2-assign" id="t-lfo2-chk-${i}-${cfg.p}" data-lfo-assign="${cfg.p}" data-lfo-index="2" title="Click to assign ${cfg.l} LFO 2. Double-click to reverse." aria-label="Assign LFO 2 to ${cfg.l}"></div><div class="slider-wrapper"><input type="range" id="t-${cfg.p}-sl-${i}" data-param="${cfg.p}" min="${cfg.min}" max="${cfg.max}" step="${cfg.s}" value="${cfg.val}" title="Increment: ${cfg.s}"><span class="preset-marker min-preset-marker" id="t-min-marker-${i}-${cfg.p}" data-min-marker-for="${cfg.p}"></span><span class="preset-marker max-preset-marker" id="t-max-marker-${i}-${cfg.p}" data-max-marker-for="${cfg.p}"></span></div></div>`).join("")}</div>`;
            grid.appendChild(t);
          }
          return normalizedTrackCount;
        }

    return Object.freeze({ build, lockSamplerGrid: lockReceiverSamplerGridLayout });
  };

  Object.defineProperty(window, "MXSCreateStudioStructure", {
    value: Object.freeze(createStudioStructure),
    writable: false,
    configurable: false,
    enumerable: true,
  });
})();

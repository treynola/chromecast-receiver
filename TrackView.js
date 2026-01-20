/**
 * TrackView
 * Handles the DOM creation and manipulation for a single Audio Track.
 * Namespaced to window.TrackView
 */

(function () {

    class TrackView {
        constructor(index) {
            this.index = index;
            this.id = index; // Match ID to index for now
            this.elements = {}; // Stores references to created DOM elements

            // State for priority status display
            this.currentStatusText = 'Ready';
            this.currentStatusType = 'ready';
            this.fileName = '';
        }

        /**
         * Builds the complete DOM structure for the track.
         * Returns the root generic DOM element and a dictionary of references (`elements`).
         */
        buildElement() {
            const trackDiv = document.createElement('div');
            trackDiv.className = 'track';
            trackDiv.dataset.trackIndex = this.index;
            trackDiv.id = `track-${this.index}`;
            this.elements.trackEl = trackDiv;

            // 1. Header
            const header = document.createElement('div');
            header.className = 'track-header';
            header.textContent = `TRACK ${this.index + 1}`;
            header.dataset.action = 'clear';
            trackDiv.appendChild(header);

            // 2. Time Display
            const timeDisplay = document.createElement('div');
            timeDisplay.className = 'track-time-display';
            timeDisplay.textContent = '00:00:00';
            this.elements.trackTimeDisplay = timeDisplay;
            trackDiv.appendChild(timeDisplay);

            // 3. Status
            const statusDiv = document.createElement('div');
            statusDiv.className = 'status-indicator status-ready';
            statusDiv.textContent = 'Ready';
            this.elements.status = statusDiv;
            trackDiv.appendChild(statusDiv);

            // 4. Waveform
            const waveformContainer = document.createElement('div');
            waveformContainer.className = 'track-waveform-container';

            const wfLabels = document.createElement('div');
            wfLabels.className = 'track-waveform-labels';
            wfLabels.innerHTML = '<div class="waveform-label-external">L</div><div class="waveform-label-external">R</div>';

            const wfCanvases = document.createElement('div');
            wfCanvases.className = 'track-waveform-canvases';

            const canvasL = document.createElement('canvas');
            canvasL.className = 'track-waveform-canvas-L';
            const canvasR = document.createElement('canvas');
            canvasR.className = 'track-waveform-canvas-R';

            this.elements.waveformCanvasL = canvasL;
            this.elements.waveformCanvasR = canvasR;

            wfCanvases.append(canvasL, canvasR);
            waveformContainer.append(wfLabels, wfCanvases);
            trackDiv.appendChild(waveformContainer);

            // 5. Input Control Group
            const inputGroup = document.createElement('div');
            inputGroup.className = 'control-group';

            const inputLabel = document.createElement('label');
            inputLabel.textContent = 'Input';

            const inputLayout = document.createElement('div');
            inputLayout.className = 'track-input-layout';

            const inputSelect = document.createElement('select');
            inputSelect.className = 'input-source';
            inputSelect.dataset.action = 'select-input';
            this.elements.inputSourceSelect = inputSelect;

            inputSelect.innerHTML = `
                <option value="mic" selected>Microphone</option>
                <option value="file">Import File</option>
                <option value="directory">Import Directory</option>
                <option value="mc-pa">MC PA Mode</option>
            `;

            inputLayout.appendChild(inputSelect);

            // Monitor Widget
            const monitorSpan = document.createElement('span');
            monitorSpan.style.display = 'flex';
            monitorSpan.style.alignItems = 'center';
            monitorSpan.style.marginLeft = '8px';

            // Monitor Checkbox removed as per user request
            // const monCheck = ... 

            inputGroup.append(inputLabel, inputLayout);

            // File Name Display (inside input group)
            const fileLabel = document.createElement('span');
            fileLabel.className = 'file-name-display';
            this.elements.fileDisplaySpan = fileLabel;
            inputGroup.appendChild(fileLabel);

            trackDiv.appendChild(inputGroup);

            // 6. PA/Mic Adjustment (Hidden default)
            const paMicGroup = document.createElement('div');
            paMicGroup.className = 'control-group pa-mic-adjustment';
            paMicGroup.style.display = 'none';

            const paLabel = document.createElement('label');
            paLabel.textContent = 'Input Gain';

            const paSlider = document.createElement('input');
            paSlider.type = 'range';
            paSlider.className = 'pa-mic-slider';
            paSlider.min = '-48';
            paSlider.max = '60';
            paSlider.step = '0.1';
            paSlider.value = '0';

            const paValue = document.createElement('span');
            paValue.className = 'pa-mic-value';
            paValue.textContent = '0.0 dB';

            this.elements.paMicSlider = paSlider;
            this.elements.paMicValue = paValue;

            paMicGroup.append(paLabel, paSlider, paValue);
            trackDiv.appendChild(paMicGroup);

            // 7. Loop Controls
            const loopControls = document.createElement('div');
            loopControls.className = 'loop-controls';
            loopControls.style.display = 'none';
            this.elements.loopControls = loopControls;

            const loopStartGroup = this._createKnobsShort('Loop Start', 'loopStart', 0, 1, 0, 's');
            const loopEndGroup = this._createKnobsShort('Loop End', 'loopEnd', 0, 1, 1, 's');

            [loopStartGroup, loopEndGroup].forEach(g => {
                this.elements.knobs = this.elements.knobs || {};
                this.elements.valueDisplays = this.elements.valueDisplays || {};
                this.elements.knobs[g.input.dataset.param] = g.input;
                this.elements.valueDisplays[g.input.dataset.param] = g.valueDisplay;
                loopControls.appendChild(g.container);
            });
            trackDiv.appendChild(loopControls);

            // 8. Buttons
            const btnRow = document.createElement('div');
            btnRow.className = 'track-buttons';

            const recBtn = this._createButton('REC', 'record');
            const stopBtn = this._createButton('STOP', 'stop');
            const playBtn = this._createButton('PLAY', 'play');
            playBtn.disabled = true;
            const revBtn = this._createButton('REV', 'reverse');

            this.elements.recBtn = recBtn;
            this.elements.stopBtn = stopBtn;
            this.elements.playBtn = playBtn;
            this.elements.revBtn = revBtn;

            btnRow.append(recBtn, stopBtn, playBtn, revBtn);
            trackDiv.appendChild(btnRow);

            // 9. FX Chain
            const fxContainer = document.createElement('div');
            fxContainer.className = 'fx-chain-container';
            this.elements.fxContainer = fxContainer;

            // Title
            const fxTitle = document.createElement('div');
            fxTitle.className = 'fx-chain-title';
            fxTitle.textContent = 'Effects Chain:';
            fxContainer.appendChild(fxTitle);

            // Wrapper
            const fxChainControls = document.createElement('div');
            fxChainControls.className = 'fx-chain-controls';

            const leftBtn = document.createElement('button');
            leftBtn.className = 'fx-chain-arrow';
            leftBtn.textContent = '<';
            leftBtn.dataset.action = 'chain-left';
            fxChainControls.appendChild(leftBtn);

            this.elements.fxChainSlots = [];

            for (let i = 0; i < 7; i++) {
                const slotDiv = document.createElement('div');
                slotDiv.className = 'fx-chain-slot';

                const checkId = `fx-slot-${this.index}-${i}`;
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = checkId;
                checkbox.dataset.action = 'toggle-fx';
                checkbox.dataset.slotIndex = i;

                const label = document.createElement('label');
                label.htmlFor = checkId;
                label.className = 'fx-chain-slot-label';
                label.textContent = (i + 1).toString();
                label.dataset.slotLabelIndex = i;

                slotDiv.append(checkbox, label);
                fxChainControls.appendChild(slotDiv);

                this.elements.fxChainSlots.push(label);
            }

            const rightBtn = document.createElement('button');
            rightBtn.className = 'fx-chain-arrow';
            rightBtn.textContent = '>';
            rightBtn.dataset.action = 'chain-right';

            fxChainControls.appendChild(rightBtn);
            fxContainer.appendChild(fxChainControls);
            trackDiv.appendChild(fxContainer);


            // 10. FX Selector (Bottom Layout)
            const bottomGroup = document.createElement('div');
            bottomGroup.className = 'control-group track-bottom-layout';

            const fxLabel = document.createElement('label');
            fxLabel.className = 'margin-0';
            fxLabel.textContent = 'Effects:';

            const fxSelect = document.createElement('select');
            fxSelect.className = 'effect-type-select flex-1-no-margin';
            fxSelect.dataset.action = 'select-effect';
            this.elements.effectTypeSelect = fxSelect;

            bottomGroup.append(fxLabel, fxSelect);
            trackDiv.appendChild(bottomGroup);

            // 10.b Audition Params Container (Legacy: Not Used - Kept for Future)
            // Legacy behavior uses slot dialogs, not this container
            const auditionParamsContainer = document.createElement('div');
            auditionParamsContainer.className = 'audition-params-container';
            auditionParamsContainer.style.display = 'none'; // Permanently hidden for legacy mode
            this.elements.auditionParamsContainer = auditionParamsContainer;
            trackDiv.appendChild(auditionParamsContainer);

            // 11. Dialogs
            const dialogsContainer = document.createElement('div');
            dialogsContainer.className = 'effect-dialogs-container';
            this.elements.effectDialogs = [];

            for (let i = 0; i < 7; i++) {
                const dialog = document.createElement('dialog');
                dialog.className = 'effect-params-dialog';
                dialog.id = `effect-dialog-${this.index}-${i}`;
                dialog.dataset.slotIndex = i;

                const header = document.createElement('div');
                header.className = 'dialog-header';
                header.innerHTML = `<span>Effect Slot ${i + 1}</span>`;

                const closeBtn = document.createElement('button');
                closeBtn.className = 'close-dialog-btn';
                closeBtn.dataset.action = 'close-effect-dialog';
                closeBtn.textContent = 'x';
                header.appendChild(closeBtn);

                const content = document.createElement('div');
                content.className = 'dialog-content';

                dialog.append(header, content);
                dialogsContainer.appendChild(dialog);
                this.elements.effectDialogs.push(dialog);
            }
            trackDiv.appendChild(dialogsContainer);

            // 11.b Audition Dialog (Floating Preview)
            const auditionDialog = document.createElement('dialog');
            auditionDialog.className = 'audition-params-dialog';
            auditionDialog.id = `audition-dialog-${this.index}`;

            const auditionHeader = document.createElement('div');
            auditionHeader.className = 'dialog-header';



            const auditionCloseBtn = document.createElement('button');
            auditionCloseBtn.className = 'close-dialog-btn';
            auditionCloseBtn.dataset.action = 'close-audition-dialog';
            auditionCloseBtn.textContent = 'x';
            auditionHeader.appendChild(auditionCloseBtn);

            const auditionContent = document.createElement('div');
            auditionContent.className = 'dialog-content audition-dialog-content';

            auditionDialog.append(auditionHeader, auditionContent);
            trackDiv.appendChild(auditionDialog);
            this.elements.auditionDialog = auditionDialog;

            // 12. Main Controls
            const mainControls = document.createElement('div');
            mainControls.className = 'main-controls';

            const knobConfigs = [
                { l: 'Pitch', p: 'pitch', min: -100, max: 100, val: 0, u: '%', s: 1 },
                { l: 'Volume', p: 'vol', min: -48, max: 6, val: 0, u: 'dB', s: 0.1 },
                { l: 'Pan', p: 'pan', min: -1, max: 1, val: 0, u: '', s: 0.05 },
                { l: 'Treble', p: 'treble', min: -12, max: 12, val: 0, u: 'dB', s: 0.1 },
                { l: 'Mid Freq', p: 'mid_freq', min: 400, max: 2000, val: 1200, u: 'Hz', s: 10 },
                { l: 'Mid Gain', p: 'mid_gain', min: -12, max: 12, val: 0, u: 'dB', s: 0.1 },
                { l: 'Bass', p: 'bass', min: -12, max: 12, val: 0, u: 'dB', s: 0.1 }
            ];

            knobConfigs.forEach(cfg => {
                const grp = this._createKnobGroup(cfg.l, cfg.p, cfg.min, cfg.max, cfg.val, cfg.u, cfg.s);
                this.elements.knobs = this.elements.knobs || {};
                this.elements.valueDisplays = this.elements.valueDisplays || {};

                this.elements.knobs[cfg.p] = grp.input;
                this.elements.valueDisplays[cfg.p] = grp.valueDisplay;
                mainControls.appendChild(grp.container);
            });

            trackDiv.appendChild(mainControls);

            return trackDiv;
        }

        _createKnobGroup(label, param, min, max, def, unit, step = 0.01) {
            const container = document.createElement('div');
            container.className = 'knob-container';

            const labelGroup = document.createElement('div');
            labelGroup.className = 'knob-label-group';
            labelGroup.dataset.paramLabel = param;

            const lbl = document.createElement('label');
            lbl.textContent = label;
            labelGroup.appendChild(lbl);

            // Value
            const val = document.createElement('span');
            val.className = 'param-value';
            val.textContent = parseFloat(def).toFixed(1) + unit;
            val.dataset.valueFor = param;
            labelGroup.appendChild(val);

            // LFOs
            const lfo1 = document.createElement('input');
            lfo1.type = 'checkbox';
            lfo1.className = 'lfo-assign';
            lfo1.dataset.lfoAssign = param;
            lfo1.dataset.lfoIndex = 1;

            const lfo2 = document.createElement('input');
            lfo2.type = 'checkbox';
            lfo2.className = 'lfo-assign lfo2-assign';
            lfo2.dataset.lfoAssign = param;
            lfo2.dataset.lfoIndex = 2;

            this.elements.lfoAssigns = this.elements.lfoAssigns || {};
            this.elements.lfo2Assigns = this.elements.lfo2Assigns || {};
            this.elements.lfoAssigns[param] = lfo1;
            this.elements.lfo2Assigns[param] = lfo2;

            labelGroup.appendChild(lfo1);
            labelGroup.appendChild(lfo2);
            container.appendChild(labelGroup);

            const sliderWrapper = document.createElement('div');
            sliderWrapper.className = 'slider-wrapper';

            const input = document.createElement('input');
            input.type = 'range';
            input.dataset.param = param;
            input.min = min;
            input.max = max;
            input.step = step;
            input.value = def;

            const minMarker = document.createElement('span');
            minMarker.className = 'preset-marker min-preset-marker';
            minMarker.dataset.minMarkerFor = param;

            const maxMarker = document.createElement('span');
            maxMarker.className = 'preset-marker max-preset-marker';
            maxMarker.dataset.maxMarkerFor = param;

            this.elements.minMarkers = this.elements.minMarkers || {};
            this.elements.maxMarkers = this.elements.maxMarkers || {};
            this.elements.minMarkers[param] = minMarker;
            this.elements.maxMarkers[param] = maxMarker;

            sliderWrapper.append(input, minMarker, maxMarker);
            container.appendChild(sliderWrapper);

            return { container, input, valueDisplay: val };
        }

        _createKnobsShort(label, param, min, max, def, unit) {
            const container = document.createElement('div');
            container.className = 'knob-container';

            const labelGroup = document.createElement('div');
            labelGroup.className = 'knob-label-group';
            labelGroup.dataset.paramLabel = param;

            const lbl = document.createElement('label');
            lbl.textContent = label;
            labelGroup.appendChild(lbl);

            const val = document.createElement('span');
            val.className = 'param-value';
            val.textContent = parseFloat(def).toFixed(2) + unit;
            val.dataset.valueFor = param;
            labelGroup.appendChild(val);
            container.appendChild(labelGroup);

            const sliderWrapper = document.createElement('div');
            sliderWrapper.className = 'slider-wrapper';

            const input = document.createElement('input');
            input.type = 'range';
            input.dataset.param = param;
            input.min = min;
            input.max = max;
            input.step = 0.01;
            input.value = def;

            sliderWrapper.appendChild(input);
            container.appendChild(sliderWrapper);

            return { container, input, valueDisplay: val };
        }

        _createButton(text, action) {
            const btn = document.createElement('button');
            btn.textContent = text;
            btn.dataset.action = action;
            return btn;
        }

        setStatus(text, type = 'ready') {
            this.currentStatusText = text;
            this.currentStatusType = type;
            this._updateStatusDisplay();
        }

        setFileLabel(text) {
            this.fileName = text;
            this._updateStatusDisplay();

            // Also update auxiliary label if needed, or clear it to avoid duplication
            if (this.elements.fileDisplaySpan) {
                this.elements.fileDisplaySpan.textContent = "";
            }
        }

        _updateStatusDisplay() {
            if (!this.elements.status) return;

            const text = this.currentStatusText;
            const type = this.currentStatusType;
            const fileName = this.fileName;

            // Priority Logic:
            // 1. If status is NOT 'ready' (e.g. 'recording', 'error', 'loading'), show that.
            // 2. If we have a filename and status IS 'ready', show the filename.
            // 3. Fallback to the status text (usually 'Ready' or mode names).

            let displayText = text;
            let displayType = type;

            if (type === 'ready' && fileName) {
                displayText = fileName;
            }

            // Apply to DOM
            const isLong = displayText.length > 10;
            if (isLong) {
                this.elements.status.innerHTML = `<div class="scrolling-text-wrapper"><span class="scrolling-text">${displayText}</span></div>`;
            } else {
                this.elements.status.textContent = displayText;
            }

            // Update classes
            this.elements.status.className = 'status-indicator';
            this.elements.status.classList.add(`status-${displayType}`);
        }

        showLoopControls(show = true) {
            if (this.elements.loopControls) {
                this.elements.loopControls.style.display = show ? 'flex' : 'none';
            }
        }

        updateLoopSliders(duration) {
            if (this.elements.knobs && this.elements.knobs.loopStart && this.elements.knobs.loopEnd) {
                this.elements.knobs.loopStart.max = duration;
                this.elements.knobs.loopEnd.max = duration;

                // Default to full loop if not set
                this.elements.knobs.loopStart.value = 0;
                this.elements.knobs.loopEnd.value = duration;

                // Update displays
                if (this.elements.valueDisplays.loopStart) this.elements.valueDisplays.loopStart.textContent = "0.00s";
                if (this.elements.valueDisplays.loopEnd) this.elements.valueDisplays.loopEnd.textContent = duration.toFixed(2) + "s";
            }
        }

    }

    // Export globally
    window.TrackView = TrackView;

})();

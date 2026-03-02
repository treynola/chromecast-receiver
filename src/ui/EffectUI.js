/**
 * EffectUI.js
 * Manages the UI for effect selection, assignment, and parameter rendering.
 */
(function () {

    /**
     * Assigns an auditioning effect to a specific slot on a track.
     */
    function assignEffectToSlot(trackId, slotIndex, auditionState, trackDiv, track, shouldClose = true) {
        if (!auditionState) return;
        const { name, config, paramValues } = auditionState;

        const instance = window.audioService.assignAuditionToSlot(trackId, slotIndex);

        track.state.effectsChain = track.state.effectsChain || [];
        track.state.effectsChain[slotIndex] = {
            name,
            config,
            instance,
            paramValues: { ...paramValues },
            enabled: true
        };

        const checkbox = trackDiv.querySelector(`#fx-slot-${trackId}-${slotIndex}`);
        const slotLabel = trackDiv.querySelector(`label[data-slot-label-index="${slotIndex}"]`);
        if (checkbox) checkbox.checked = true;
        if (slotLabel) slotLabel.textContent = name.substring(0, 3).toUpperCase();

        if (track.elements.effectDialogs[slotIndex]) {
            const slotDialog = track.elements.effectDialogs[slotIndex];
            const headerTitle = slotDialog.querySelector('.dialog-header span');
            if (headerTitle) {
                headerTitle.textContent = name;
                headerTitle.style.color = '#FFD700';
                headerTitle.style.fontWeight = 'bold';
            }

            const content = slotDialog.querySelector('.dialog-content');
            if (content) {
                content.innerHTML = '';
                content.style = '';

                const slotSelectArea = document.createElement('div');
                slotSelectArea.className = 'audition-slot-selector';
                slotSelectArea.style.display = 'flex';
                slotSelectArea.style.flexDirection = 'row';
                slotSelectArea.style.alignItems = 'center';
                slotSelectArea.style.justifyContent = 'flex-start';
                slotSelectArea.style.padding = '5px 0 15px 0';
                slotSelectArea.style.gap = '8px';

                const selectorLabel = document.createElement('span');
                selectorLabel.textContent = "Assign to Slot:";
                selectorLabel.style.fontSize = '0.85em';
                selectorLabel.style.fontWeight = 'bold';
                selectorLabel.style.color = '#ccc';
                slotSelectArea.appendChild(selectorLabel);

                const slotGroup = document.createElement('div');
                slotGroup.style.display = 'flex';
                slotGroup.style.flexWrap = 'wrap';
                slotGroup.style.gap = '6px';

                for (let i = 0; i < 7; i++) {
                    const btn = document.createElement('button');
                    btn.textContent = (i + 1).toString();
                    btn.style.padding = '4px 8px';
                    btn.style.cursor = 'pointer';
                    btn.style.background = '#444';
                    btn.style.border = '1px solid #666';
                    btn.style.color = 'white';
                    btn.style.borderRadius = '3px';
                    btn.dataset.action = 'assign-from-audition';
                    btn.dataset.assignSlot = i;
                    slotGroup.appendChild(btn);
                }
                slotSelectArea.appendChild(slotGroup);
                content.appendChild(slotSelectArea);

                const paramsWrapper = document.createElement('div');
                paramsWrapper.style.width = '100%';
                content.appendChild(paramsWrapper);

                renderEffectParams(paramsWrapper, config, paramValues, (pName, val) => {
                    window.audioService.updateEffect(trackId, slotIndex, { [pName]: val });
                    if (track.state.effectsChain[slotIndex]) {
                        track.state.effectsChain[slotIndex].paramValues[pName] = val;
                    }
                });
            }
        }

        if (shouldClose) {
            if (track.elements.auditionDialog) {
                track.elements.auditionDialog.close();
            }
            track.state.auditioningEffect = null;
        }

        if (track.elements.effectDialogs[slotIndex]) {
            const d = track.elements.effectDialogs[slotIndex];
            if (!d.open) d.showModal();
        }

        console.log(`Effect "${name}" assigned to slot ${slotIndex + 1} for track ${trackId}`);
    }

    /**
     * Renders parameter controls for an effect into a container.
     */
    function renderEffectParams(container, config, currentParams, onUpdate) {
        if (!config || !config.columns) return;
        const allParams = config.columns.flat();

        // Use Grid layout (Managed by CSS .effect-params-grid)
        container.classList.add('dialog-content'); // Keep generic logic
        container.classList.add('effect-params-grid');
        container.style.display = 'grid'; // Ensure explicit display
        // container.style.gridTemplateColumns handled by CSS now
        container.style.gap = '8px';

        allParams.forEach(p => {
            // Current Value
            const currentVal = (currentParams && currentParams[p.p] !== undefined) ? currentParams[p.p] : p.def;
            const unit = p.unit || '';

            // Decimals Logic
            let decimals = (Math.abs(currentVal) < 10 && currentVal !== 0) ? 2 : 1;
            if (Math.abs(currentVal) < 1 && currentVal !== 0) decimals = 3;
            const lower = p.p.toLowerCase();
            if (lower.includes('freq') || lower === 'pitch' || p.s === 1) decimals = 0;

            const displayVal = parseFloat(currentVal).toFixed(decimals);

            const grp = document.createElement('div');
            grp.className = 'control-group effect-control-group';
            grp.style.flex = '1 1 120px'; // Responsive sizing

            grp.innerHTML = `
                     <div class="knob-label-group">
                         <label>${p.l}</label>
                         <span class="param-value">${displayVal}${unit}</span>
                     </div>
                     <input type="range" class="effect-param-slider" 
                         min="${p.min}" max="${p.max}" step="${p.s || 0.01}" value="${currentVal}">
                 `;

            const slider = grp.querySelector('input');
            slider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                // Update Display
                const display = grp.querySelector('.param-value');
                if (display) {
                    // format again
                    let d = (Math.abs(val) < 10 && val !== 0) ? 2 : 1;
                    if (Math.abs(val) < 1 && val !== 0) d = 3;
                    if (lower.includes('freq') || lower === 'pitch' || p.s === 1) d = 0;
                    display.textContent = val.toFixed(d) + unit;
                }
                if (onUpdate) onUpdate(p.p, val);
            });

            container.appendChild(grp);
        });
    }

    /**
     * Populates the effect selectors in the UI.
     */
    function populateEffectSelectors() {
        const selectors = document.querySelectorAll('.effect-type-select');
        const categories = window.effectConfigs || {};
        console.log(`Populating Effect Selectors. Found ${selectors.length} selectors. Categories:`, Object.keys(categories));

        let optionsHtml = '<option value="none">None</option>';

        // Sort categories alphabetically
        const catNames = Object.keys(categories).sort((a, b) => a.localeCompare(b));

        catNames.forEach(catName => {
            optionsHtml += `<optgroup label="${catName}">`;
            // Sort effects within each category alphabetically
            const effectNames = Object.keys(categories[catName]).sort((a, b) => a.localeCompare(b));
            effectNames.forEach(effectName => {
                optionsHtml += `<option value="${effectName}">${effectName}</option>`;
            });
            optionsHtml += `</optgroup>`;
        });

        selectors.forEach(s => s.innerHTML = optionsHtml);
    }

    // Global Hotkeys for Effect Assignment
    window.addEventListener('keydown', (e) => {
        const key = e.key;
        if (!/^[1-7]$/.test(key)) return;
        if (e.target.tagName === 'INPUT' && (e.target.type === 'text' || e.target.type === 'number')) return;

        const slotIndex = parseInt(key, 10) - 1;
        for (let trackId in window.tracks) {
            const track = window.tracks[trackId];
            if (track && track.state.auditioningEffect && track.elements.auditionDialog && track.elements.auditionDialog.open) {
                const trackDiv = document.getElementById(`track-${trackId}`);
                if (trackDiv) {
                    assignEffectToSlot(parseInt(trackId, 10), slotIndex, track.state.auditioningEffect, trackDiv, track, true);
                    e.preventDefault();
                    e.stopPropagation();
                    break;
                }
            }
        }
    }, true);

    // Export utilities to window
    window.assignEffectToSlot = assignEffectToSlot;
    window.renderEffectParams = renderEffectParams;
    window.populateEffectSelectors = populateEffectSelectors;

})();

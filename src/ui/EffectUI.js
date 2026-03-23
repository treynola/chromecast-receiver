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

                // LINE 1: Title / Auditioning
                const titleLine = document.createElement('div');
                titleLine.className = 'audition-header-line';
                titleLine.style.textAlign = 'center';
                titleLine.style.marginBottom = '10px';
                titleLine.style.fontSize = '1.1em';
                titleLine.style.fontWeight = 'bold';
                
                const mainTitle = document.createElement('span');
                mainTitle.textContent = name;
                mainTitle.style.color = '#FFD700';

                const auditionSpan = document.createElement('span');
                auditionSpan.className = 'audition-status-text';
                auditionSpan.textContent = ' / Auditioning';
                auditionSpan.style.color = '#0f0';
                auditionSpan.style.opacity = '1';
                auditionSpan.style.transition = 'opacity 1s ease';

                titleLine.appendChild(mainTitle);
                titleLine.appendChild(auditionSpan);
                content.appendChild(titleLine);

                // LINE 2: 7-slot Audition Selector (Centered, No Arrows)
                const slotSelectWrap = document.createElement('div');
                slotSelectWrap.className = 'fx-chain-controls audition-slot-selector-wrap';
                slotSelectWrap.style.justifyContent = 'center';
                slotSelectWrap.style.marginBottom = '15px';

                for (let i = 0; i < 7; i++) {
                    const slotDiv = document.createElement('div');
                    slotDiv.className = 'fx-chain-slot';
                    
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    const cbId = `audition-fx-slot-${trackId}-${i}`;
                    cb.id = cbId;
                    cb.dataset.slotIndex = i;
                    if (i === slotIndex) cb.checked = true;

                    const lbl = document.createElement('label');
                    lbl.htmlFor = cbId;
                    lbl.className = 'fx-chain-slot-label';
                    lbl.textContent = i + 1;

                    slotDiv.appendChild(cb);
                    slotDiv.appendChild(lbl);
                    slotSelectWrap.appendChild(slotDiv);

                    // Click handler for assignment
                    lbl.addEventListener('click', (e) => {
                         e.preventDefault(); // Stop default checkbox behavior
                         assignEffectToSlot(trackId, i, auditionState, trackDiv, track, false);
                         // Fade out "Auditioning" text
                         auditionSpan.style.opacity = '0';
                    });
                }
                content.appendChild(slotSelectWrap);

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
        
        // Flatten parameters and ensure 'Effect Level' and 'Stereo Width' are at the top
        let allParams = config.columns.flat();
        
        // Re-order: Move 'Effect Level' and 'Stereo Width' to the front if they exist
        const levelIdx = allParams.findIndex(p => p.l === 'Effect Level' || p.p === 'level');
        if (levelIdx > -1) {
             const [levelP] = allParams.splice(levelIdx, 1);
             allParams.unshift(levelP);
        }
        const widthIdx = allParams.findIndex(p => p.l === 'Stereo Width' || p.p === 'width');
        if (widthIdx > -1) {
             // If level was moved to 0, width goes to 1
             const [widthP] = allParams.splice(widthIdx, 1);
             const targetIdx = allParams[0]?.l === 'Effect Level' ? 1 : 0;
             allParams.splice(targetIdx, 0, widthP);
        }

        // Use Grid layout (Managed by CSS .effect-params-grid)
        container.classList.add('dialog-content');
        container.classList.add('effect-params-grid');
        container.style.display = 'grid';
        container.style.gridTemplateColumns = 'repeat(3, 1fr)'; // FORCE 3 COLUMNS
        container.style.gap = '15px';
        container.style.padding = '10px 0';

        allParams.forEach(p => {
            const currentVal = (currentParams && currentParams[p.p] !== undefined) ? currentParams[p.p] : p.def;
            const unit = p.unit || '';

            let decimals = (Math.abs(currentVal) < 10 && currentVal !== 0) ? 2 : 1;
            if (Math.abs(currentVal) < 1 && currentVal !== 0) decimals = 3;
            const lower = p.p.toLowerCase();
            if (lower.includes('freq') || lower === 'pitch' || p.s === 1) decimals = 0;

            const displayVal = parseFloat(currentVal).toFixed(decimals);

            const grp = document.createElement('div');
            grp.className = 'control-group effect-control-group';
            grp.style.display = 'flex';
            grp.style.flexDirection = 'column';
            grp.style.alignItems = 'center'; // CENTERED LAYOUT
            grp.style.textAlign = 'center';

            grp.innerHTML = `
                     <div class="effect-param-title" style="margin-bottom: 8px; font-weight: bold; font-size: 0.85em; color: var(--gold);">
                         <label>${p.l}</label>
                     </div>
                     <div class="slider-wrapper" style="width: 100%; display: flex; justify-content: center; margin-bottom: 8px;">
                         <input type="range" class="effect-param-slider" 
                             style="width: 100%; max-width: 120px;"
                             min="${p.min}" max="${p.max}" step="${p.s || 0.01}" value="${currentVal}">
                     </div>
                     <div class="effect-param-value" style="font-family: monospace; font-size: 0.9em; color: #fff;">
                         <span class="param-value">${displayVal}${unit}</span>
                     </div>
                 `;

            const slider = grp.querySelector('input');
            slider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                const display = grp.querySelector('.param-value');
                if (display) {
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
        
        // Ensure effectConfigs is populated from registered modules
        window.effectConfigs = window.effectConfigs || {};
        if (window.effectModules) {
            for (const key in window.effectModules) {
                const module = window.effectModules[key];
                if (module && module.configs) {
                    // Deep merge or assign to prevent overwriting existing categories incorrectly
                    for (const cat in module.configs) {
                        if (!window.effectConfigs[cat]) {
                            window.effectConfigs[cat] = {};
                        }
                        Object.assign(window.effectConfigs[cat], module.configs[cat]);
                    }
                }
            }
        }

        const categories = window.effectConfigs;
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

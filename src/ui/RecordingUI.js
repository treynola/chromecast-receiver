/**
 * RecordingUI.js
 * Manages the list of master recordings, preview players, and file actions.
 */
(function () {
    class RecordingUI {
        constructor(listElementId, audioService) {
            this.listElement = document.getElementById(listElementId);
            this.audioService = audioService;
            this.createdObjectUrls = new Set();
            this.setlist = []; // URLs in continue order
            this.syncedRecordings = new Set(); // URLs to play in sync
            this.syncedPlayers = new Map(); // Map<Url, Tone.Player>

            if (!this.listElement) {
                console.warn(`RecordingUI: List element '${listElementId}' not found.`);
            }
        }

        addRecording(blobOrUrl, filename, path = null) {
            let url;
            let blob = null;

            if (typeof blobOrUrl === 'string') {
                // It's a URL (asset protocol)
                url = blobOrUrl;
                // Fake a Blob if needed for saving? Only if user tries to save.
                // We'll handle saving separately.
                console.log(`RecordingUI: Using Asset URL: ${url}`);
            } else {
                // It's a Blob
                blob = blobOrUrl;
                url = URL.createObjectURL(blob);
                this.createdObjectUrls.add(url);
            }

            if (path) console.log(`RecordingUI: Adding recording with path: ${path}`);

            // Legacy support: ensure options are in track inputs
            // ... (keep legacy logic if needed)

            const item = document.createElement('div');
            item.className = 'recording-item';
            item.dataset.url = url;
            item.dataset.filename = filename;
            if (path) item.dataset.path = path;
            item.dataset.isAssetUrl = typeof blobOrUrl === 'string'; // Flag for saving logic

            // Enable Dragging
            item.draggable = true;
            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', url);
                e.dataTransfer.setData('application/json', JSON.stringify({
                    url: url,
                    filename: filename,
                    path: path,
                    isAsset: typeof blobOrUrl === 'string'
                }));
                e.dataTransfer.effectAllowed = 'copy';
            });

            const playerDiv = this.createAudioPlayer(url, this.audioService.masterBus, item);
            const actionsDiv = this.createRecordingActions(blob, filename, item, url);
            // Info div logic remains mostly same, just size display might differ
            const infoDiv = this.createRecordingInfo(filename, blob, item, typeof blobOrUrl === 'string');

            // Queue/Sync Control Wrapper
            const cueingDiv = document.createElement('div');
            cueingDiv.className = 'recording-item-cue';

            // Sync Checkbox
            const syncCheckbox = document.createElement('input');
            syncCheckbox.type = 'checkbox';
            syncCheckbox.id = `sync-checkbox-${url.split('/').pop()}`;
            syncCheckbox.className = 'recording-item-sync-checkbox';

            const syncLabel = document.createElement('label');
            syncLabel.htmlFor = syncCheckbox.id;
            syncLabel.textContent = 'Sync';
            syncLabel.className = 'recording-item-checkbox-label';

            syncCheckbox.addEventListener('change', () => {
                if (syncCheckbox.checked) {
                    this.syncedRecordings.add(url);
                    const player = playerDiv._playerInstance;
                    if (player) this.syncedPlayers.set(url, player);
                    syncLabel.classList.add('active');
                } else {
                    this.syncedRecordings.delete(url);
                    this.syncedPlayers.delete(url);
                    syncLabel.classList.remove('active');
                }
            });

            // Arrow Controls
            const arrowControlsDiv = document.createElement('div');
            arrowControlsDiv.className = 'recording-item-arrow-controls';

            const upArrow = document.createElement('button');
            upArrow.innerHTML = '&uarr;';
            upArrow.className = 'recording-item-arrow';
            upArrow.onclick = () => this.moveItem(item, -1);

            const downArrow = document.createElement('button');
            downArrow.innerHTML = '&darr;';
            downArrow.className = 'recording-item-arrow';
            downArrow.onclick = () => this.moveItem(item, 1);

            arrowControlsDiv.append(upArrow, downArrow);
            cueingDiv.append(syncCheckbox, syncLabel, arrowControlsDiv);

            // Continue Checkbox
            const continueCheckbox = document.createElement('input');
            continueCheckbox.type = 'checkbox';
            continueCheckbox.id = `continue-checkbox-${url.split('/').pop()}`;
            continueCheckbox.className = 'recording-item-continue-checkbox';

            const continueLabel = document.createElement('label');
            continueLabel.htmlFor = continueCheckbox.id;
            continueLabel.textContent = 'Continue';
            continueLabel.className = 'recording-item-checkbox-label';

            continueCheckbox.addEventListener('change', () => {
                if (continueCheckbox.checked) {
                    this.setlist.push(url);
                    continueLabel.classList.add('active');
                    this.updateContinueLabels();
                } else {
                    const idx = this.setlist.indexOf(url);
                    if (idx !== -1) this.setlist.splice(idx, 1);
                    continueLabel.classList.remove('active');
                    this.updateContinueLabels();
                }
            });

            const topRow = document.createElement('div');
            topRow.className = 'recording-item-row';
            topRow.append(cueingDiv, playerDiv, continueCheckbox, continueLabel, actionsDiv);

            // Append Info to Actions (Legacy style)
            actionsDiv.appendChild(infoDiv);

            item.append(topRow);

            if (this.listElement) {
                this.listElement.prepend(item);
            }
        }

        moveItem(item, direction) {
            if (direction === -1 && item.previousElementSibling) {
                item.parentNode.insertBefore(item, item.previousElementSibling);
            } else if (direction === 1 && item.nextElementSibling) {
                item.parentNode.insertBefore(item.nextElementSibling, item);
            }
            this.updateContinueLabels();
        }

        updateContinueLabels() {
            // Re-build setlist from DOM order of checked items
            this.setlist = [];
            const checkedInputs = Array.from(this.listElement.querySelectorAll('.recording-item-continue-checkbox:checked'));

            // Sort checkedInputs by their order in the DOM
            const allItems = Array.from(this.listElement.querySelectorAll('.recording-item'));

            // RESET all continue labels BEFORE updating active ones
            allItems.forEach(item => {
                const label = item.querySelector('.recording-item-continue-checkbox + .recording-item-checkbox-label');
                if (label) label.textContent = 'Continue';
            });

            checkedInputs.sort((a, b) => {
                return allItems.indexOf(a.closest('.recording-item')) - allItems.indexOf(b.closest('.recording-item'));
            });

            checkedInputs.forEach((input, i) => {
                const item = input.closest('.recording-item');
                const url = item.dataset.url;
                this.setlist.push(url);
                const label = item.querySelector(`label[for="${input.id}"]`);
                if (label) label.textContent = `Continue (${i + 1})`;
            });
        }

        createAudioPlayer(url, outputNode, recordingItem) {
            const player = new Tone.Player(url);
            player.connect(outputNode || Tone.Destination);

            const playerDiv = document.createElement('div');
            playerDiv.className = 'custom-audio-player';
            playerDiv._playerInstance = player;

            const playBtn = document.createElement('button');
            playBtn.className = 'play-pause-btn play-icon-btn';
            playBtn.innerHTML = '<i class="fas fa-play"></i>';

            const pauseBtn = document.createElement('button');
            pauseBtn.className = 'play-pause-btn pause-icon-btn';
            pauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
            pauseBtn.style.display = 'none';

            const progressBarFill = document.createElement('div');
            progressBarFill.className = 'progress-bar-fill';
            const progressBar = document.createElement('div');
            progressBar.className = 'progress-bar-container';
            progressBar.appendChild(progressBarFill);

            const timeDisplay = document.createElement('span');
            timeDisplay.className = 'time-display';
            timeDisplay.textContent = '00:00 / 00:00';

            playerDiv.append(playBtn, pauseBtn, progressBar, timeDisplay);

            let startTime = 0;
            let pauseTime = 0;
            let animationFrame;

            const formatTime = (s) => {
                if (!Number.isFinite(s)) return '00:00';
                const m = Math.floor(s / 60).toString().padStart(2, '0');
                const sec = Math.floor(s % 60).toString().padStart(2, '0');
                return `${m}:${sec}`;
            }

            player.load(url).then(() => {
                timeDisplay.textContent = `00:00 / ${formatTime(player.buffer.duration)}`;
                playBtn.disabled = false;
            }).catch(err => console.error("Preview load failed", err));

            const updateUI = () => {
                if (player.state === 'started') {
                    const now = Tone.Transport.seconds;
                    const elapsed = now - startTime;
                    const dur = player.buffer.duration;
                    if (dur > 0) {
                        const progress = Math.min(1, elapsed / dur);
                        progressBarFill.style.width = `${progress * 100}%`;
                        timeDisplay.textContent = `${formatTime(elapsed)} / ${formatTime(dur)}`;
                    }
                    animationFrame = requestAnimationFrame(updateUI);
                }
            };

            playBtn.onclick = () => {
                if (Tone.context.state !== 'running') Tone.start();

                let startOffset = pauseTime;
                player.start(Tone.now(), startOffset);
                startTime = Tone.Transport.seconds - startOffset;

                playBtn.style.display = 'none';
                pauseBtn.style.display = 'flex';

                if (this.syncedRecordings.has(url)) {
                    this.syncedRecordings.forEach(syncUrl => {
                        if (syncUrl !== url) {
                            const other = this.syncedPlayers.get(syncUrl);
                            if (other && other.state !== 'started') {
                                other.start(Tone.now(), startOffset);
                            }
                        }
                    });
                }

                updateUI();
            };

            pauseBtn.onclick = () => {
                player.stop();
                cancelAnimationFrame(animationFrame);
                pauseTime = Tone.Transport.seconds - startTime;

                playBtn.style.display = 'flex';
                pauseBtn.style.display = 'none';
            };

            player.onstop = () => {
                playBtn.style.display = 'flex';
                pauseBtn.style.display = 'none';
                progressBarFill.style.width = '0%';

                const idx = this.setlist.indexOf(url);
                if (idx !== -1 && idx < this.setlist.length - 1) {
                    const nextUrl = this.setlist[idx + 1];
                    const nextItem = this.listElement.querySelector(`[data-url="${nextUrl}"]`);
                    if (nextItem) {
                        const btn = nextItem.querySelector('.play-pause-btn.play-icon-btn');
                        if (btn) btn.click();
                    }
                }
            };

            progressBar.onclick = (e) => {
                const rect = progressBar.getBoundingClientRect();
                const p = (e.clientX - rect.left) / rect.width;
                const time = p * player.buffer.duration;

                if (player.state === 'started') {
                    player.stop();
                    player.start(Tone.now(), time);
                    startTime = Tone.Transport.seconds - time;
                } else {
                    pauseTime = time;
                    progressBarFill.style.width = `${p * 100}%`;
                }
            };

            return playerDiv;
        }

        createRecordingActions(blob, filename, item, url) {
            const wrapper = document.createElement('div');
            wrapper.className = 'recording-actions';

            const select = document.createElement('select');
            select.className = 'input-source recording-action-select';
            select.innerHTML = `
                <option value="" disabled selected>Options</option>
                <option value="load">Load to Track</option>
                <option value="assign">Assign to Sampler</option>
                <option value="rename">Rename</option>
                <optgroup label="Download">
                    <option value="download-wav">WAV (Encoded)</option>
                    <option value="download-flac">FLAC</option>
                    <option value="download-mp4">MP4</option>
                    <option value="download">Raw (Auto)</option>
                </optgroup>
                <option value="delete">Delete</option>
            `;

            // Check format support
            ['flac', 'mp4'].forEach(fmt => {
                const mime = fmt === 'flac' ? 'audio/flac' : 'audio/mp4';
                if (!MediaRecorder.isTypeSupported(mime)) {
                    const opt = select.querySelector(`option[value="download-${fmt}"]`);
                    if (opt) {
                        opt.disabled = true;
                        opt.textContent += ' (Unsupported)';
                    }
                }
            });

            select.onchange = async (e) => {
                const val = select.value;
                select.selectedIndex = 0;

                if (val === 'delete') {
                    let confirmDelete = false;
                    if (window.__TAURI__ && window.__TAURI__.dialog) {
                        confirmDelete = await window.__TAURI__.dialog.ask('Delete this recording?');
                    } else {
                        confirmDelete = confirm('Delete this recording?');
                    }

                    if (confirmDelete) {
                        item.remove();
                        this.createdObjectUrls.delete(url);
                        try { URL.revokeObjectURL(url); } catch (e) { }

                        // Cleanup
                        this.syncedRecordings.delete(url);
                        this.syncedPlayers.delete(url);
                        const idx = this.setlist.indexOf(url);
                        if (idx !== -1) {
                            this.setlist.splice(idx, 1);
                            this.updateContinueLabels();
                        }
                    }
                } else if (val === 'download') {
                    this.downloadBlob(blob, filename); // Raw download
                } else if (val === 'download-wav') {
                    try {
                        // Transcode to WAV
                        if (window.AudioUtils && window.AudioUtils.blobToWav) {
                            const wavBlob = await window.AudioUtils.blobToWav(blob);
                            this.downloadBlob(wavBlob, filename.replace(/\.[^/.]+$/, "") + ".wav");
                        } else {
                            alert("WAV encoder not found!");
                        }
                    } catch (err) {
                        console.error("WAV Encoding failed", err);
                        alert("WAV Encoding failed: " + err);
                    }
                } else if (val === 'download-flac' || val === 'download-mp4') {
                    // Direct download if browser supported recording it natively
                    // Note: Transcoding WebM to FLAC/MP4 is not native. This legacy logic relied on the browser having recorded it in that format originally.
                    // Since we default to 'audio/webm', these are essentially just re-containers or raw downloads if the browser was forced to record MP4.
                    const ext = val === 'download-flac' ? '.flac' : '.mp4';
                    this.downloadBlob(blob, filename.replace(/\.[^/.]+$/, "") + ext);
                } else if (val === 'load') {
                    this.showLoadDialog(url, filename);
                } else if (val === 'assign') {
                    this.showAssignDialog(url, filename);
                } else if (val === 'rename') {
                    const text = item.querySelector('.filename-text');
                    const input = item.querySelector('.rename-input');
                    if (text && input) {
                        text.style.display = 'none';
                        input.style.display = 'inline-block';
                        input.focus();
                    }
                }
            };

            wrapper.appendChild(select);
            return wrapper;
        }

        createRecordingInfo(filename, blob, item, isAsset = false) {
            const div = document.createElement('div');
            div.className = 'info';

            let size = 'Unknown';
            if (blob) {
                size = (blob.size / 1024 / 1024).toFixed(2) + ' MB';
            } else if (isAsset) {
                // Could get size if we really wanted to, but irrelevant for streaming
                size = 'Local Asset';
            }

            const wrapper = document.createElement('div');
            wrapper.className = 'filename-display-wrapper';

            const text = document.createElement('span');
            text.className = 'filename-text';
            text.textContent = `${filename} (${size})`;

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'rename-input';
            input.style.display = 'none';
            input.value = filename;

            const finish = () => {
                const newName = input.value.trim();
                if (newName) {
                    text.textContent = `${newName} (${size})`;
                    item.dataset.filename = newName;
                }
                text.style.display = 'inline-block';
                input.style.display = 'none';
            }

            input.onblur = finish;
            input.onkeydown = (e) => { if (e.key === 'Enter') finish(); };

            wrapper.append(text, input);
            div.appendChild(wrapper);
            return div;
        }

        showLoadDialog(url, filename) {
            const dialog = document.createElement('dialog');
            dialog.className = 'load-to-track-dialog';
            dialog.style.padding = '20px';
            dialog.style.background = '#222';
            dialog.style.border = '1px solid gold';
            dialog.style.color = 'white';

            const h3 = document.createElement('h3');
            h3.textContent = `Load "${filename}" to:`;
            dialog.appendChild(h3);

            const list = document.createElement('div');
            list.style.display = 'flex';
            list.style.flexDirection = 'column';
            list.style.gap = '10px';

            window.audioService.tracks.forEach((track, id) => {
                const btn = document.createElement('button');
                btn.textContent = `Track ${id + 1}`;
                btn.style.padding = '10px';
                btn.onclick = async () => {
                    dialog.close();
                    await window.audioService.loadFileToTrack(id, url);
                    alert(`Loaded to Track ${id + 1}`);
                    // Reset loop points? Scripts.js handles this usually.
                };
                list.appendChild(btn);
            });

            const cancel = document.createElement('button');
            cancel.textContent = 'Cancel';
            cancel.style.marginTop = '10px';
            cancel.onclick = () => dialog.close();

            dialog.append(list, cancel);
            document.body.appendChild(dialog);
            dialog.showModal();
            dialog.addEventListener('close', () => dialog.remove());
        }

        showAssignDialog(url, filename) {
            const dialog = document.createElement('dialog');
            dialog.className = 'assign-to-sampler-dialog';
            dialog.style.padding = '20px';
            dialog.style.background = '#222';
            dialog.style.border = '1px solid var(--green)';
            dialog.style.color = 'white';
            dialog.style.maxWidth = '400px';

            const h3 = document.createElement('h3');
            h3.textContent = `Assign "${filename}" to Sampler Pad:`;
            h3.style.color = 'var(--gold)';
            dialog.appendChild(h3);

            const grid = document.createElement('div');
            grid.style.display = 'grid';
            grid.style.gridTemplateColumns = 'repeat(4, 1fr)'; // 4 columns x 5 rows = 20 pads
            grid.style.gap = '5px';
            grid.style.marginTop = '15px';

            for (let i = 1; i <= 20; i++) {
                const btn = document.createElement('button');
                btn.textContent = i;
                btn.style.padding = '10px';
                btn.style.backgroundColor = '#444';
                btn.style.color = 'white';
                btn.style.border = '1px solid #666';
                btn.style.borderRadius = '5px';
                btn.style.cursor = 'pointer';

                btn.onclick = async () => {
                    dialog.close();
                    try {
                        const service = window.audioService?.contextManager?.samplerService;
                        if (service) {
                            await service.assignSample(i, url, filename);
                            alert(`Assigned to Pad ${i}`);
                        } else {
                            alert("Sampler Service not available!");
                        }
                    } catch (e) {
                        console.error("Assignment failed", e);
                        alert("Failed to assign sample: " + e.message);
                    }
                };

                grid.appendChild(btn);
            }

            const cancel = document.createElement('button');
            cancel.textContent = 'Cancel';
            cancel.style.marginTop = '15px';
            cancel.style.width = '100%';
            cancel.style.padding = '8px';
            cancel.onclick = () => dialog.close();

            dialog.append(grid, cancel);
            document.body.appendChild(dialog);
            dialog.showModal();
            dialog.addEventListener('close', () => dialog.remove());
        }

        async downloadBlob(blob, filename) {
            // Try Tauri Save First
            if (window.TauriUtils && window.TauriUtils.saveToDownloads) {
                try {
                    const path = await window.TauriUtils.saveToDownloads(blob, filename);
                    if (path) {
                        alert(`File Saved to:\n${path}`);
                        return;
                    }
                } catch (e) {
                    console.error("Tauri save failed, falling back to browser download", e);
                }
            }

            // Browser Fallback
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        getRecordingState() {
            const items = Array.from(this.listElement.querySelectorAll('.recording-item'));
            return items.reverse().map(item => {
                const url = item.dataset.url;
                const path = item.dataset.path || null;
                const filename = item.dataset.filename;
                const sync = item.querySelector('.recording-item-sync-checkbox')?.checked || false;
                const cont = item.querySelector('.recording-item-continue-checkbox')?.checked || false;
                return { filename, path, sync, continue: cont };
            });
        }

        async loadRecordingState(data) {
            if (!data || !Array.isArray(data)) return;
            console.log("RecordingUI: Loading recordings state...", data);

            for (const rec of data) {
                try {
                    if (rec.path && window.TauriUtils) {
                        // Restore from local file path if using Tauri
                        const handle = await window.TauriUtils.createFileHandle(rec.path, rec.filename);
                        const blob = await handle.getFile();
                        this.addRecording(blob, rec.filename, rec.path);
                    } else {
                        // We can't restore web blobs easily unless we cached them in IndexedDB.
                        // For now, if no path, we just skip or log.
                        console.warn(`RecordingUI: Cannot restore item without path: ${rec.filename}`);
                        continue;
                    }

                    // Set sync/continue states
                    const item = this.listElement.firstChild; // Since addRecording prepends
                    if (item) {
                        if (rec.sync) {
                            const syncCb = item.querySelector('.recording-item-sync-checkbox');
                            if (syncCb) {
                                syncCb.checked = true;
                                syncCb.dispatchEvent(new Event('change'));
                            }
                        }
                        if (rec.continue) {
                            const contCb = item.querySelector('.recording-item-continue-checkbox');
                            if (contCb) {
                                contCb.checked = true;
                                contCb.dispatchEvent(new Event('change'));
                            }
                        }
                    }
                } catch (e) {
                    console.error("RecordingUI: Load failed for", rec.filename, e);
                }
            }
        }
    }

    window.RecordingUI = RecordingUI;
})();

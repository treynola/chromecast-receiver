/**
 * FileSelectionUI.js
 * Manages the modal for selecting audio files from a scanned directory.
 */
(function () {
    class FileSelectionUI {
        constructor() {
            // No initialization needed yet
        }

        showAudioFilesModal(files, track) {
            const existingModal = document.getElementById('audio-files-modal');
            if (existingModal) existingModal.remove();

            const modal = document.createElement('dialog');
            modal.id = 'audio-files-modal';
            modal.style.padding = '20px';
            modal.style.background = '#222';
            modal.style.color = 'gold';
            modal.style.border = '1px solid gold';
            modal.style.maxWidth = '80vw';
            modal.style.maxHeight = '80vh';
            modal.style.overflowY = 'auto';

            const modalContent = document.createElement('div');
            modalContent.className = 'audio-files-modal-content';
            modalContent.style.display = 'flex';
            modalContent.style.flexDirection = 'column';
            modalContent.style.gap = '10px';

            const title = document.createElement('h3');
            title.textContent = "Select Audio Files";
            modalContent.appendChild(title);

            const closeButton = document.createElement('button');
            closeButton.innerHTML = '&times;';
            closeButton.style.position = 'absolute';
            closeButton.style.top = '10px';
            closeButton.style.right = '10px';
            closeButton.addEventListener('click', () => modal.close());

            const rescanButton = document.createElement('button');
            rescanButton.textContent = 'Rescan';
            rescanButton.addEventListener('click', () => {
                modal.close();
                // Call global handler - simpler than passing callback hell
                if (window.handleDirectorySelect) {
                    window.handleDirectorySelect(track);
                }
            });

            const selectAllButton = document.createElement('button');
            selectAllButton.textContent = 'Select All';
            let allSelected = false;
            selectAllButton.addEventListener('click', () => {
                allSelected = !allSelected;
                const checkboxes = fileList.querySelectorAll('input[type="checkbox"]');
                checkboxes.forEach(checkbox => checkbox.checked = allSelected);
                selectAllButton.textContent = allSelected ? 'Deselect All' : 'Select All';
            });

            const loadSelectedButton = document.createElement('button');
            loadSelectedButton.textContent = 'Load Selected to List';
            loadSelectedButton.classList.add('button'); // Global style

            const fileList = document.createElement('ul');
            fileList.style.listStyle = 'none';
            fileList.style.padding = '0';
            fileList.style.maxHeight = '300px';
            fileList.style.overflowY = 'auto';
            fileList.style.background = '#333';
            fileList.style.border = '1px solid #444';

            if (files.length === 0) {
                fileList.innerHTML = '<p style="padding:10px">No audio files found.</p>';
            } else {
                files.forEach((file, index) => {
                    const listItem = document.createElement('li');
                    listItem.style.padding = '5px';
                    listItem.style.borderBottom = '1px solid #444';

                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.id = `file-checkbox-${index}`;
                    checkbox.dataset.index = index;

                    const label = document.createElement('label');
                    label.htmlFor = `file-checkbox-${index}`;
                    label.textContent = file.name;
                    label.style.marginLeft = '8px';
                    label.style.cursor = 'pointer';
                    label.style.color = '#fff';

                    listItem.appendChild(checkbox);
                    listItem.appendChild(label);
                    fileList.appendChild(listItem);
                });
            }

            loadSelectedButton.addEventListener('click', async () => {
                const selectedFiles = Array.from(fileList.querySelectorAll('input[type="checkbox"]:checked'))
                    .map(checkbox => files[checkbox.dataset.index]);

                if (selectedFiles.length === 0) {
                    alert('Please select at least one file.');
                    return;
                }

                loadSelectedButton.textContent = "Loading...";
                loadSelectedButton.disabled = true;

                for (const file of selectedFiles) {
                    console.log("Processing file:", file.name);
                    try {
                        let finalUrl = null;

                        if (window.__TAURI__) {
                            // V105 Fix: Use fs.readFile (ArrayBuffer -> Blob) to bypass asset:// fetch issues.
                            const fs = window.__TAURI__.fs || (window.__TAURI__.plugins && window.__TAURI__.plugins.fs);
                            if (fs && fs.readFile) {
                                console.log(`FileSelectionUI: Reading via fs: ${file.path}`);
                                const data = await fs.readFile(file.path);

                                // V12.85: Set explicit MIME type for decoding reliability (especially FLAC)
                                const mimeTypes = {
                                    'wav': 'audio/wav',
                                    'mp3': 'audio/mpeg',
                                    'flac': 'audio/flac',
                                    'ogg': 'audio/ogg',
                                    'm4a': 'audio/mp4',
                                    'mp4': 'audio/mp4',
                                    'aac': 'audio/aac'
                                };
                                const ext = file.name.split('.').pop().toLowerCase();
                                const blob = new Blob([data], { type: mimeTypes[ext] || 'audio/mpeg' });

                                finalUrl = URL.createObjectURL(blob);
                            }
                        }

                        // Fallback (if fs failed or not in Tauri)
                        if (!finalUrl) {
                            finalUrl = window.__TAURI__?.core?.convertFileSrc(file.path) || file.path;
                        }

                        console.log(`Final URL for Sampler/Session: ${finalUrl}`);

                        if (window.recordingUI && finalUrl) {
                            window.recordingUI.addRecording(finalUrl, file.name, file.path);
                        }
                    } catch (err) {
                        console.error("Failed to load file:", file.name, err);
                    }
                }

                alert(`${selectedFiles.length} file(s) loaded to Sessions & Media.`);
                modal.close();
            });

            modalContent.appendChild(rescanButton);
            modalContent.appendChild(selectAllButton);
            modalContent.appendChild(fileList);
            modalContent.appendChild(loadSelectedButton);
            modalContent.appendChild(closeButton);
            modal.appendChild(modalContent);
            document.body.appendChild(modal);
            modal.showModal();
            modal.addEventListener('close', () => modal.remove());
        }

        async scanDirectoryWeb(dirHandle, path = '') {
            const files = [];
            const audioExtensions = ['.wav', '.mp3', '.flac', '.mp4', '.ogg', '.aac', '.m4a'];
            for await (const entry of dirHandle.values()) {
                const newPath = path ? `${path}/${entry.name}` : entry.name;
                if (entry.kind === 'file') {
                    if (audioExtensions.some(ext => entry.name.toLowerCase().endsWith(ext))) {
                        files.push({ name: newPath, handle: entry });
                    }
                } else if (entry.kind === 'directory') {
                    files.push(...await this.scanDirectoryWeb(entry, newPath));
                }
            }
            return files;
        }

        async handleDirectorySelect(track) {
            try {
                if (window.__TAURI__) {
                    const selected = await window.TauriUtils.openDirectoryDialog();
                    if (selected) {
                        const files = await window.TauriUtils.scanDirectory(selected);
                        this.showAudioFilesModal(files, track);
                    }
                } else {
                    try {
                        const dirHandle = await window.showDirectoryPicker();
                        const files = await this.scanDirectoryWeb(dirHandle);
                        this.showAudioFilesModal(files, track);
                    } catch (e) {
                        console.error("Web Dir Picker failed", e);
                        alert("Web Directory Picker failed or cancelled: " + e.message);
                    }
                }
            } catch (e) {
                console.error("Directory Select Error", e);
                alert("Error selecting directory: " + e.message);
            }
        }

        async handleFileImport(track) {
            if (window.__TAURI__) {
                try {
                    const selected = await window.__TAURI__.dialog.open({
                        multiple: false,
                        filters: [{
                            name: 'Audio',
                            extensions: ['wav', 'mp3', 'flac', 'ogg', 'aac', 'm4a', 'mp4']
                        }]
                    });

                    if (selected) {
                        const name = selected.split(/[\\/]/).pop();
                        let url = null;
                        let arrayBuffer = null;

                        try {
                            const fs = window.__TAURI__.fs || (window.__TAURI__.plugins && window.__TAURI__.plugins.fs);
                            if (fs && fs.readFile) {
                                arrayBuffer = await fs.readFile(selected);
                            }
                        } catch (e) {
                            console.warn("handleFileImport: fs.readFile failed, trying logic fallback...");
                            try {
                                if (window.TauriUtils && window.TauriUtils.createFileHandle) {
                                    const handle = await window.TauriUtils.createFileHandle(selected, name);
                                    const blob = await handle.getFile();
                                    url = URL.createObjectURL(blob);
                                }
                            } catch (fallbackErr) {
                                console.error("handleFileImport: Fallback failed", fallbackErr);
                            }
                        }

                        if (arrayBuffer || url) {
                            track.setStatus('Loading...', 'playing');
                            if (arrayBuffer) {
                                await window.audioService.loadDataToTrack(track.id, arrayBuffer, name);
                            } else {
                                await window.audioService.loadFileToTrack(track.id, url);
                            }

                            track.setFileLabel(name);
                            track.setStatus('Ready', 'ready');
                            track.state.hasContent = true;

                            const duration = window.audioService.getTrackDuration(track.id);
                            window.audioService.setTrackLoopStart(track.id, 0);
                            window.audioService.setTrackLoopEnd(track.id, duration);

                            if (track.elements.playBtn) track.elements.playBtn.disabled = false;
                            if (track.updateLoopSliders) track.updateLoopSliders(duration);
                            if (typeof track.showLoopControls === 'function') track.showLoopControls(true);
                        }
                    }
                } catch (e) {
                    console.error("Tauri File Import Error:", e);
                    alert("File import failed: " + e.message);
                    track.setStatus('Error', 'error');
                }
            } else {
                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.accept = 'audio/*,video/mp4,audio/flac';
                fileInput.multiple = false;
                fileInput.style.display = 'none';
                fileInput.onchange = async (e) => {
                    if (e.target.files.length > 0) {
                        const file = e.target.files[0];
                        const url = URL.createObjectURL(file);
                        try {
                            track.setStatus('Loading...', 'playing');
                            await window.audioService.loadFileToTrack(track.id, url);
                            track.setFileLabel(file.name);
                            track.setStatus('Ready', 'ready');
                            track.state.hasContent = true;
                            if (track.showLoopControls) track.showLoopControls(true);

                            const duration = window.audioService.getTrackDuration(track.id);
                            window.audioService.setTrackLoopStart(track.id, 0);
                            window.audioService.setTrackLoopEnd(track.id, duration);

                            if (track.elements.playBtn) track.elements.playBtn.disabled = false;
                            if (track.updateLoopSliders) track.updateLoopSliders(duration);
                        } catch (err) {
                            console.error("Load failed:", err);
                            track.setStatus('Error', 'error');
                        }
                    }
                    fileInput.remove();
                };
                document.body.appendChild(fileInput);
                fileInput.click();
            }
        }
    }

    window.FileSelectionUI = new FileSelectionUI();
    window.handleDirectorySelect = (track) => window.FileSelectionUI.handleDirectorySelect(track);
    window.handleFileImport = (track) => window.FileSelectionUI.handleFileImport(track);
})();

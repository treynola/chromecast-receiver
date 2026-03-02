/**
 * Modals.js
 * Utility functions for UI dialogs and modal interactions.
 */
(function () {
    /**
     * Shows a simple message box with an OK button.
     */
    function showMessageBox(message, type = 'info') {
        const dialog = document.createElement('dialog');
        dialog.className = `message-box ${type}`;
        dialog.style.padding = '20px';
        dialog.style.background = '#222';
        dialog.style.border = `1px solid ${type === 'error' ? 'red' : 'var(--gold, gold)'}`;
        dialog.style.color = 'white';
        dialog.style.borderRadius = '8px';
        dialog.style.maxWidth = '400px';
        dialog.style.zIndex = '10000';

        const content = document.createElement('div');
        content.style.marginBottom = '15px';
        content.textContent = message;

        const btn = document.createElement('button');
        btn.textContent = 'OK';
        btn.style.width = '100%';
        btn.style.padding = '8px';
        btn.onclick = () => dialog.close();

        dialog.append(content, btn);
        document.body.appendChild(dialog);
        dialog.showModal();
        dialog.addEventListener('close', () => dialog.remove());
    }

    /**
     * Shows a prompt with multiple buttons and returns a promise resolving to the clicked option.
     */
    function showActionPrompt(title, options = {}) {
        return new Promise((resolve) => {
            const dialog = document.createElement('dialog');
            dialog.style.padding = '20px';
            dialog.style.background = '#222';
            dialog.style.border = '1px solid var(--gold, gold)';
            dialog.style.color = 'white';
            dialog.style.borderRadius = '8px';
            dialog.style.zIndex = '10000';

            const h3 = document.createElement('h3');
            h3.textContent = title;
            h3.style.marginTop = '0';
            dialog.appendChild(h3);

            const btnContainer = document.createElement('div');
            btnContainer.style.display = 'flex';
            btnContainer.style.gap = '10px';
            btnContainer.style.justifyContent = 'flex-end';

            Object.entries(options).forEach(([label, value]) => {
                const btn = document.createElement('button');
                btn.textContent = label;
                btn.style.padding = '8px 16px';
                btn.onclick = () => {
                    dialog.close();
                    resolve(value);
                };
                btnContainer.appendChild(btn);
            });

            dialog.appendChild(btnContainer);
            document.body.appendChild(dialog);
            dialog.showModal();
            dialog.addEventListener('close', () => {
                dialog.remove();
                resolve(null);
            });
        });
    }

    /**
     * Shows a modal for selecting a single file from a list (used for directory drops onto tracks).
     */
    function showAudioFilesModal(files, track) {
        const dialog = document.createElement('dialog');
        dialog.style.padding = '20px';
        dialog.style.background = '#222';
        dialog.style.color = '#fff';
        dialog.style.border = '1px solid var(--gold)';
        dialog.style.borderRadius = '8px';
        dialog.style.maxHeight = '80vh';
        dialog.style.overflowY = 'auto';
        dialog.style.zIndex = '10000';

        const h3 = document.createElement('h3');
        h3.textContent = `Select File (${files.length} found)`;
        h3.style.marginTop = '0';
        dialog.appendChild(h3);

        const list = document.createElement('div');
        list.style.display = 'flex';
        list.style.flexDirection = 'column';
        list.style.gap = '8px';

        files.forEach(f => {
            const btn = document.createElement('button');
            btn.textContent = f.path.replace(/\//g, ' / ');
            btn.style.textAlign = 'left';
            btn.style.padding = '8px';
            btn.style.background = '#333';
            btn.style.border = '1px solid #444';
            btn.style.color = '#eee';
            btn.style.cursor = 'pointer';

            btn.onclick = async () => {
                dialog.close();
                if (track) {
                    track.setStatus('Loading...');
                    try {
                        const url = URL.createObjectURL(f.file);
                        await window.audioService.loadFileToTrack(track.id, url);
                        track.setStatus('Ready', 'ready');
                        track.updateFileLabel(f.name);
                        track.state.hasContent = true;
                        track.elements.playBtn.disabled = false;
                        track.resetLoopPoints();
                    } catch (e) {
                        console.error("Load failed", e);
                        track.setStatus('Error', 'error');
                    }
                }
            };
            list.appendChild(btn);
        });

        dialog.appendChild(list);

        const closeBtn = document.createElement('button');
        closeBtn.textContent = "Cancel";
        closeBtn.style.marginTop = '15px';
        closeBtn.style.width = '100%';
        closeBtn.style.padding = '10px';
        closeBtn.onclick = () => dialog.close();
        dialog.appendChild(closeBtn);

        document.body.appendChild(dialog);
        dialog.showModal();
        dialog.addEventListener('close', () => dialog.remove());
    }

    /**
     * Recursive Directory Scanner for FileSystemEntry (WebKit Entry API).
     */
    async function scanDirectoryWeb(entry, path = '', results = []) {
        if (entry.isFile) {
            if (/\.(wav|mp3|ogg|flac|m4a|aac)$/i.test(entry.name)) {
                return new Promise((resolve, reject) => {
                    entry.file(file => {
                        results.push({
                            name: entry.name,
                            path: path + entry.name,
                            file: file
                        });
                        resolve();
                    }, reject);
                });
            }
        } else if (entry.isDirectory) {
            const reader = entry.createReader();
            const readEntries = async () => {
                const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
                if (batch.length === 0) return;
                for (const child of batch) {
                    await scanDirectoryWeb(child, path + entry.name + '/', results);
                }
                await readEntries();
            };
            await readEntries();
        }
    }

    // Export utilities to window
    window.showMessageBox = showMessageBox;
    window.showActionPrompt = showActionPrompt;
    window.showAudioFilesModal = showAudioFilesModal;
    window.scanDirectoryWeb = scanDirectoryWeb;

    /**
     * Makes an element draggable via a handle.
     */
    window.makeDraggable = function (element, handle) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        if (!handle) handle = element;

        handle.onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            e = e || window.event;
            if (e.button !== 0) return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON') return;

            e.preventDefault();

            const style = window.getComputedStyle(element);
            const transform = style.transform;

            if (transform !== 'none' && transform !== undefined) {
                const rect = element.getBoundingClientRect();
                element.style.transform = 'none';
                element.style.left = rect.left + 'px';
                element.style.top = rect.top + 'px';
                element.style.margin = '0';
            }

            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e = e || window.event;
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    };

    // Backdrop click closing for standard dialogs
    document.addEventListener('DOMContentLoaded', () => {
        const dialogs = ['sessions-dialog', 'audio-setup-dialog', 'cast-dialog', 'docs-dialog'];
        dialogs.forEach(id => {
            const dialog = document.getElementById(id);
            if (dialog) {
                dialog.addEventListener('click', (e) => {
                    const rect = dialog.getBoundingClientRect();
                    const isInDialog = (rect.top <= e.clientY && e.clientY <= rect.top + rect.height && rect.left <= e.clientX && e.clientX <= rect.left + rect.width);
                    if (!isInDialog) dialog.close();
                });
            }
        });
    });
})();

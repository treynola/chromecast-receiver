/**
 * RecordingUI.js
 * Manages the UI for recorded loops and master mixes.
 */
(function () {

    class RecordingUI {
        constructor() {
            this.container = document.getElementById('recordings-list');
            this.recordings = [];
            this.init();
        }

        init() {
            if (!this.container) {
                console.warn("RecordingUI: #recordings-list not found.");
                return;
            }
            console.log("RecordingUI: Initialized.");
        }

        /**
         * Adds a new recording to the sidebar.
         */
        addRecording(blob, filename) {
            const id = Date.now();
            const url = URL.createObjectURL(blob);
            const recording = { id, blob, filename, url };
            this.recordings.push(recording);

            const item = document.createElement('div');
            item.className = 'recording-item';
            item.dataset.id = id;
            item.draggable = true;

            // Drag support
            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('application/json', JSON.stringify({
                    url: recording.url,
                    filename: recording.filename
                }));
                item.classList.add('dragging');
            });
            item.addEventListener('dragend', () => item.classList.remove('dragging'));

            // UI Structure
            item.innerHTML = `
                <div class="recording-info">
                    <span class="recording-name" title="${filename}">${filename}</span>
                    <span class="recording-meta">${(blob.size / 1024 / 1024).toFixed(2)} MB</span>
                </div>
                <div class="recording-player">
                    <audio src="${url}" controls></audio>
                </div>
                <div class="recording-actions">
                    <button class="rec-action-btn load-track" title="Load to Track">T</button>
                    <button class="rec-action-btn load-pad" title="Load to Pad">P</button>
                    <button class="rec-action-btn rename-btn" title="Rename">R</button>
                    <button class="rec-action-btn download-btn" title="Download">D</button>
                    <button class="rec-action-btn delete-btn" title="Delete">X</button>
                </div>
            `;

            // Action Listeners
            item.querySelector('.load-track').onclick = () => this.promptLoadToTrack(recording);
            item.querySelector('.load-pad').onclick = () => this.promptLoadToPad(recording);
            item.querySelector('.rename-btn').onclick = () => this.renameRecording(id, item);
            item.querySelector('.download-btn').onclick = () => this.downloadRecording(recording);
            item.querySelector('.delete-btn').onclick = () => this.deleteRecording(id, item);

            this.container.prepend(item);
        }

        async promptLoadToTrack(recording) {
            const trackNum = prompt("Load to Track (1-8):", "1");
            if (!trackNum) return;
            const idx = parseInt(trackNum) - 1;
            if (idx >= 0 && idx < 8) {
                const track = window.tracks[idx];
                if (track) {
                    track.setStatus('Loading...');
                    await window.audioService.loadFileToTrack(idx, recording.url);
                    track.setStatus('Ready', 'ready');
                    track.updateFileLabel(recording.filename);
                    track.state.hasContent = true;
                    track.elements.playBtn.disabled = false;
                    if (track.resetLoopPoints) track.resetLoopPoints();
                }
            }
        }

        async promptLoadToPad(recording) {
            const padNum = prompt("Load to Pad (1-20):", "1");
            if (!padNum) return;
            const id = parseInt(padNum);
            const acm = window.audioService?.contextManager;
            if (acm?.samplerService) {
                await acm.samplerService.assignSample(id, recording.url, recording.filename);
                // Update Sampler UI if visible...
                const btn = document.querySelector(`.sample-btn[data-sample="${id}"]`);
                if (btn) {
                    btn.classList.add('loaded');
                    btn.title = recording.filename;
                    btn.textContent = recording.filename.substring(0, 3).toUpperCase();
                }
            }
        }

        renameRecording(id, item) {
            const rec = this.recordings.find(r => r.id === id);
            if (!rec) return;
            const newName = prompt("New filename:", rec.filename);
            if (newName) {
                rec.filename = newName;
                item.querySelector('.recording-name').textContent = newName;
                item.querySelector('.recording-name').title = newName;
            }
        }

        downloadRecording(recording) {
            const a = document.createElement('a');
            a.href = recording.url;
            a.download = recording.filename;
            a.click();
        }

        deleteRecording(id, item) {
            if (confirm("Delete this recording?")) {
                const idx = this.recordings.findIndex(r => r.id === id);
                if (idx !== -1) {
                    const rec = this.recordings[idx];
                    URL.revokeObjectURL(rec.url);
                    this.recordings.splice(idx, 1);
                    item.remove();
                }
            }
        }
    }

    // Instantiate and export
    window.addEventListener('DOMContentLoaded', () => {
        window.recordingUI = new RecordingUI();
    });

})();

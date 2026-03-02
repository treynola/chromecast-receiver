/**
 * Tauri Utility Functions
 * Namespaced to window.TauriUtils
 */

window.TauriUtils = window.TauriUtils || {};

(function (exports) {

    async function createFileHandle(path, name) {
        if (!window.__TAURI__) return null;

        return {
            name: name,
            getFile: async () => {
                const contents = await window.__TAURI__.fs.readFile(path);
                const data = new Uint8Array(contents); // Convert to Uint8Array
                let type = 'audio/wav';
                if (name.endsWith('.mp3')) type = 'audio/mpeg';
                else if (name.endsWith('.flac')) type = 'audio/flac';
                else if (name.endsWith('.mp4')) type = 'audio/mp4';
                else if (name.endsWith('.ogg')) type = 'audio/ogg';
                else if (name.endsWith('.aac')) type = 'audio/aac';
                return new Blob([data], { type: type });
            }
        };
    }

    async function scanDirectory(dirPath, relativePath = '') {
        if (!window.__TAURI__) return [];

        const entries = await window.__TAURI__.fs.readDir(dirPath);
        const files = [];
        const audioExtensions = ['.wav', '.mp3', '.flac', '.mp4', '.ogg', '.aac'];

        for (const entry of entries) {
            const entryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
            // Construct absolute path assuming unix-style separators for macOS
            const fullPath = `${dirPath}/${entry.name}`;

            if (entry.isFile) {
                const extension = entry.name.substring(entry.name.lastIndexOf('.')).toLowerCase();
                if (audioExtensions.includes(extension)) {
                    files.push({
                        name: entryPath, // Display name (relative)
                        path: fullPath,  // Absolute path for reading
                        handle: await createFileHandle(fullPath, entry.name)
                    });
                }
            } else if (entry.isDirectory) {
                files.push(...await scanDirectory(fullPath, entryPath));
            }
        }
        return files;
    }

    async function openDirectoryDialog() {
        if (!window.__TAURI__) {
            console.warn("Tauri not detected.");
            return null;
        }
        try {
            const selected = await window.__TAURI__.dialog.open({
                directory: true,
                multiple: false
            });
            return selected;
        } catch (err) {
            console.error("Tauri dialog error:", err);
            throw err;
        }
    }

    async function saveToDownloads(blob, filename) {
        if (!window.__TAURI__) {
            console.warn("Tauri not detected, falling back to browser download.");
            return null;
        }

        try {
            const downloadDir = await window.__TAURI__.path.downloadDir();
            // Sanitize filename
            const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
            const filePath = `${downloadDir}${safeName}`;

            // Convert Blob to Uint8Array
            const arrayBuffer = await new Response(blob).arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);

            await window.__TAURI__.fs.writeBinaryFile(filePath, uint8Array);
            console.log(`File saved to: ${filePath}`);
            return filePath;
        } catch (err) {
            console.error("Tauri saveToDownloads error:", err);
            throw err;
        }
    }

    // Export functions
    exports.createFileHandle = createFileHandle;
    exports.scanDirectory = scanDirectory;
    exports.openDirectoryDialog = openDirectoryDialog;
    exports.saveToDownloads = saveToDownloads;

})(window.TauriUtils);

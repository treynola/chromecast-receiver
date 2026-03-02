/**
 * General Application Helpers
 * Namespaced to window.AppHelpers
 */

window.AppHelpers = window.AppHelpers || {};

(function (exports) {

    function formatTime(s) {
        if (isNaN(s) || s === null || s === undefined) {
            return '00:00:00:00';
        }
        const totalSeconds = Math.floor(s);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const centiseconds = Math.floor((s - totalSeconds) * 100);

        const formattedMinutes = minutes.toString().padStart(2, '0');
        const formattedSeconds = seconds.toString().padStart(2, '0');
        const formattedCentiseconds = centiseconds.toString().padStart(2, '0');

        if (hours > 0) {
            const formattedHours = hours.toString().padStart(2, '0');
            return `${formattedHours}:${formattedMinutes}:${formattedSeconds}:${formattedCentiseconds}`;
        } else {
            return `${formattedMinutes}:${formattedSeconds}:${formattedCentiseconds}`;
        }
    }

    function formatTimeFull(s) {
        const hours = Math.floor(s / 3600).toString().padStart(2, '0');
        const minutes = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
        const seconds = Math.floor(s % 60).toString().padStart(2, '0');
        const milliseconds = Math.floor((s % 1) * 100).toString().padStart(2, '0');
        return `${hours}:${minutes}:${seconds}:${milliseconds}`;
    }

    function formatBytes(bytes, d = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024, dm = d < 0 ? 0 : d, s = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${s[i]}`;
    }

    function dbToPercent(db, minDb = -60, maxDb = 0) {
        return (Math.max(minDb, Math.min(db, maxDb)) - minDb) / (maxDb - minDb);
    }

    function getFormattedDateTime() {
        const now = new Date();
        const year = now.getFullYear();
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const day = now.getDate().toString().padStart(2, '0');
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const seconds = now.getSeconds().toString().padStart(2, '0');
        return `${year}_${month}_${day}_${hours}_${minutes}_${seconds}`;
    }

    // Export functions
    exports.formatTime = formatTime;
    exports.formatTimeFull = formatTimeFull;
    exports.formatBytes = formatBytes;
    exports.dbToPercent = dbToPercent;
    exports.getFormattedDateTime = getFormattedDateTime;

})(window.AppHelpers);

window.__original_connect__ = AudioNode.prototype.connect;
window.__original_disconnect__ = AudioNode.prototype.disconnect;
window.__mxsDebugAudio = window.__mxsDebugAudio || false;
window.persistentMicStream = window.persistentMicStream || null;

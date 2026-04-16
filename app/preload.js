/**
 * preload.js — contextIsolation bridge
 * Exposes a safe `window.api` object to the renderer.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // MIDI devices
  getDevices: () => ipcRenderer.invoke('get-devices'),
  connectDevice: (portIndex) => ipcRenderer.invoke('connect-device', portIndex),
  disconnectDevice: () => ipcRenderer.invoke('disconnect-device'),

  // Color settings
  getColorMap: () => ipcRenderer.invoke('get-color-map'),
  setColorMap: (colorMap) => ipcRenderer.invoke('set-color-map', colorMap),

  // Events from main process → renderer
  onNotesUpdate: (cb) => {
    ipcRenderer.on('notes-update', (_e, notes) => cb(notes));
  },
  onDeviceStatus: (cb) => {
    ipcRenderer.on('device-status', (_e, status) => cb(status));
  },

  // Cleanup
  removeListener: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
});

/**
 * main.js — Electron main process
 *
 * Responsibilities:
 *  - Create the dashboard window
 *  - Start a TCP server on 127.0.0.1:47890 for the Native Messaging host
 *  - Manage MIDI device connections and lighting via MidiManager
 *  - Bridge IPC between renderer (Dashboard) and MidiManager
 */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const net = require('net');
const path = require('path');
const MidiManager = require('./midi/midi-manager');

const TCP_HOST = '127.0.0.1';
const TCP_PORT = 47890;

let mainWindow = null;
const midiManager = new MidiManager();

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  startTcpServer();
  setupIpc();
});

app.on('window-all-closed', () => {
  midiManager.disconnect();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 660,
    minWidth: 900,
    minHeight: 520,
    backgroundColor: '#F9F5F0',
    title: 'PartyKeys MIDI Light',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── TCP server (receives MIDI from host.js) ──────────────────────────────────

function startTcpServer() {
  const server = net.createServer((socket) => {
    let buf = '';

    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop(); // keep incomplete line
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          handleHostMessage(JSON.parse(line));
        } catch (_) {}
      }
    });

    socket.on('error', () => {});
  });

  server.listen(TCP_PORT, TCP_HOST, () => {
    console.log(`[PKS] TCP server listening on ${TCP_HOST}:${TCP_PORT}`);
  });

  server.on('error', (err) => {
    console.error('[PKS] TCP server error:', err.message);
  });
}

function handleHostMessage(msg) {
  if (msg.type === 'MIDI_MESSAGE') {
    midiManager.handleMidiMessage(msg.data);
  }
}

// ─── IPC ─────────────────────────────────────────────────────────────────────

function setupIpc() {
  // Feed MIDI events to the renderer
  midiManager.onNoteChange = (activeNotes) => {
    mainWindow?.webContents.send('notes-update', activeNotes);
  };

  midiManager.onDeviceStatus = (status) => {
    mainWindow?.webContents.send('device-status', status);
  };

  // Renderer → main handlers
  ipcMain.handle('get-devices', () => midiManager.getDevices());

  ipcMain.handle('connect-device', (_e, portIndex) => {
    try {
      midiManager.connect(portIndex);
      return { ok: true, name: midiManager.deviceName };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('disconnect-device', () => {
    midiManager.disconnect();
    return { ok: true };
  });

  ipcMain.handle('set-color-map', (_e, colorMap) => {
    // colorMap: { "1": 1, "2": 9, ... }
    for (const [ch, color] of Object.entries(colorMap)) {
      midiManager.setChannelColor(Number(ch), Number(color));
    }
    midiManager.defaultColor = Number(colorMap.default ?? 5);
    return { ok: true };
  });

  ipcMain.handle('get-color-map', () => ({
    channelColors: midiManager.channelColorMap,
    defaultColor: midiManager.defaultColor,
  }));
}

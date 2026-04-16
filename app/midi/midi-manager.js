/**
 * midi-manager.js — USB MIDI device management + note state
 */

const midi = require('@julusian/midi');
const {
  buildInitCommand,
  buildLightCommand,
  buildNoteOffCommand,
} = require('./lighting');

// Default channel→color mapping
// Channel 1 = right hand (orange), Channel 2 = left hand (blue)
const DEFAULT_CHANNEL_COLORS = { 1: 3, 2: 9 };
const DEFAULT_COLOR = 3;

// Max ~25 SysEx updates per second
const THROTTLE_MS = 40;

class MidiManager {
  constructor() {
    this._output = new midi.Output();
    this.activeNotes = new Map();   // note → {color, channel}
    this._pendingNoteOffs = new Set(); // notes that turned off, need individual off cmd
    this.channelColorMap = { ...DEFAULT_CHANNEL_COLORS };
    this.defaultColor = DEFAULT_COLOR;
    this.connected = false;
    this.deviceName = null;
    this._pendingUpdate = false;
    this._throttleTimer = null;
    this.onNoteChange = null;
    this.onDeviceStatus = null;
  }

  getDevices() {
    const count = this._output.getPortCount();
    const list = [];
    for (let i = 0; i < count; i++) {
      list.push({ index: i, name: this._output.getPortName(i) });
    }
    return list;
  }

  connect(portIndex) {
    if (this.connected) this.disconnect();
    this._output.openPort(portIndex);
    this.deviceName = this._output.getPortName(portIndex);
    this.connected = true;
    this._send(buildInitCommand());
    this.onDeviceStatus?.({ connected: true, name: this.deviceName });
    console.log(`[PKS] Connected to: ${this.deviceName}`);
  }

  disconnect() {
    if (!this.connected) return;
    if (this._throttleTimer) {
      clearTimeout(this._throttleTimer);
      this._throttleTimer = null;
    }
    try {
      this._output.closePort();
    } catch (_) {}
    this.connected = false;
    this.deviceName = null;
    this.activeNotes.clear();
    this._pendingNoteOffs.clear();
    this._pendingUpdate = false;
    this.onDeviceStatus?.({ connected: false, name: null });
    console.log('[PKS] Disconnected');
  }

  handleMidiMessage(data) {
    if (!this.connected || !data || data.length < 2) return;

    const status = data[0];
    const note = data[1];
    const velocity = data.length > 2 ? data[2] : 0;
    const msgType = status & 0xf0;
    const channel = (status & 0x0f) + 1;

    if (channel === 10) return;
    if (msgType !== 0x80 && msgType !== 0x90) return;

    // Forward raw MIDI to PartyKeys so it still makes sound
    // this._send(Array.from(data));  // TEST: disabled to check if this causes crash

    const isNoteOn = msgType === 0x90 && velocity > 0;
    if (isNoteOn) {
      const color = this.channelColorMap[channel] ?? this.defaultColor;
      this.activeNotes.set(note, { color, channel });
      this._pendingNoteOffs.delete(note); // cancel pending off if retriggered
    } else {
      this.activeNotes.delete(note);
      this._pendingNoteOffs.add(note);
    }

    this._scheduleLightUpdate();
    this._emitNoteChange();
  }

  setChannelColor(channel, color) {
    this.channelColorMap[channel] = color;
  }

  _scheduleLightUpdate() {
    if (this._throttleTimer) {
      this._pendingUpdate = true;
      return;
    }
    this._sendFullState();
    this._pendingUpdate = false;
    this._throttleTimer = setTimeout(() => {
      this._throttleTimer = null;
      if (this._pendingUpdate) {
        this._sendFullState();
        this._pendingUpdate = false;
      }
    }, THROTTLE_MS);
  }

  _sendFullState() {
    if (!this.connected) return;

    // Always send explicit note-off for every released note first.
    // Do NOT rely on the batch light command's implicit auto-off behaviour —
    // when notes change faster than ~25/s (flowkey step mode), that implicit
    // off is unreliable and leaves keys stuck lit.
    for (const note of this._pendingNoteOffs) {
      this._send(buildNoteOffCommand(note));
    }
    this._pendingNoteOffs.clear();

    // Then send the current active notes (if any).
    if (this.activeNotes.size > 0) {
      const noteColors = [];
      for (const [note, { color }] of this.activeNotes) {
        noteColors.push({ note, color });
      }
      this._send(buildLightCommand(noteColors));
    }
  }

  _send(bytes) {
    if (!this.connected) return;
    try {
      this._output.sendMessage(bytes);
    } catch (err) {
      console.error('[PKS] MIDI send error:', err.message);
    }
  }

  _emitNoteChange() {
    if (!this.onNoteChange) return;
    const notes = [];
    for (const [note, info] of this.activeNotes) {
      notes.push({ note, ...info });
    }
    this.onNoteChange(notes);
  }
}

module.exports = MidiManager;

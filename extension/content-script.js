/**
 * content-script.js — runs in ISOLATED world
 *
 * Replaces the Electron app entirely. Responsibilities:
 *  - Request Web MIDI access (with sysex: true) and open the PartyKeys port
 *  - Receive MIDI note messages posted by injected.js (via window.postMessage)
 *  - Maintain note state (activeNotes) and send SysEx lighting commands
 *
 * Lighting strategy (optimised for dense passages):
 *  - note-on  → send immediately, no throttle delay
 *  - note-off → schedule a 16ms update; keyboard auto-turns-off absent notes
 *  - silence (300 ms after last note-off) → safe all-off cleanup
 *
 * Supports:
 *  - midiano.com  — notes from the Web MIDI hook in injected.js
 *  - flowkey.com  — notes from the DOM observer in injected.js
 */

'use strict';

// ─── SysEx protocol ───────────────────────────────────────────────────────────

const HEADER = [0xf0, 0x05, 0x30, 0x7f, 0x7f, 0x20, 0x00];

function buildInitCommand() {
  return [...HEADER, 0x0f, 0x01, 0xf7];
}
function buildAllOffCommand() {
  // Only safe immediately after buildInitCommand
  return [...HEADER, 0x71, 0x00, 0xf7];
}
function buildNoteOffCommand(note) {
  return [...HEADER, 0x71, 0x01, note, 0x00, 0xf7];
}
function buildLightCommand(noteColors) {
  const pairs = [];
  for (const { note, color } of noteColors) pairs.push(note, color);
  return [...HEADER, 0x71, noteColors.length, ...pairs, 0xf7];
}

// ─── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_CHANNEL_COLORS = { 1: 3, 2: 9 }; // Ch1 = orange, Ch2 = blue
const DEFAULT_COLOR  = 3;
const NOTE_OFF_MS    = 16;  // delay before sending updated state after a note-off (~60fps)
const SILENCE_MS     = 300; // after this long with no notes, do a full all-off cleanup

// ─── State ────────────────────────────────────────────────────────────────────

let isEnabled = false;
let midiAccess = null;
let partyKeysOutput = null;

const activeNotes = new Map(); // note (int) → { color, channel }
let noteOffTimer  = null;      // debounce timer for note-off updates
let silenceTimer  = null;      // cleanup timer when music stops

// ─── SysEx sending ────────────────────────────────────────────────────────────

function sendSysEx(data) {
  if (!partyKeysOutput) return;
  try {
    partyKeysOutput.send(data);
  } catch (e) {
    console.warn('[PKS] SysEx send error:', e.message);
  }
}

// Send the full current note state.
// The keyboard automatically turns off any key not present in the list.
function sendCurrentState() {
  if (activeNotes.size === 0) return;
  const noteColors = [];
  for (const [note, { color }] of activeNotes) noteColors.push({ note, color });
  sendSysEx(buildLightCommand(noteColors));
}

// All-off: safe to call during silence (re-sends init first as required)
function sendAllOff() {
  sendSysEx(buildInitCommand());
  setTimeout(() => sendSysEx(buildAllOffCommand()), 50);
}

// ─── MIDI message handler ─────────────────────────────────────────────────────

function handleMidiMessage(data) {
  if (!isEnabled || !partyKeysOutput) return;
  if (!data || data.length < 2) return;

  const status   = data[0];
  const note     = data[1];
  const velocity = data.length > 2 ? data[2] : 0;
  const msgType  = status & 0xf0;
  const channel  = (status & 0x0f) + 1;

  if (channel === 10) return; // skip drums
  if (msgType !== 0x80 && msgType !== 0x90) return;

  const isNoteOn = msgType === 0x90 && velocity > 0;
  const color    = DEFAULT_CHANNEL_COLORS[channel] || DEFAULT_COLOR;

  // Any activity cancels the silence cleanup
  clearTimeout(silenceTimer);
  silenceTimer = null;

  if (isNoteOn) {
    activeNotes.set(note, { color, channel });

    // Send immediately — cancel any pending note-off update first
    clearTimeout(noteOffTimer);
    noteOffTimer = null;
    sendCurrentState();

  } else {
    activeNotes.delete(note);

    if (activeNotes.size > 0) {
      // Still have active notes — schedule a short update so the keyboard
      // reflects the removal (it auto-turns-off keys absent from the list)
      if (!noteOffTimer) {
        noteOffTimer = setTimeout(() => {
          noteOffTimer = null;
          sendCurrentState();
        }, NOTE_OFF_MS);
      }
    } else {
      // All notes released — wait for silence before cleaning up,
      // in case the next note-on is just milliseconds away (fast runs)
      silenceTimer = setTimeout(() => {
        silenceTimer = null;
        sendAllOff();
        activeNotes.clear();
      }, SILENCE_MS);
    }
  }
}

// ─── PartyKeys connection ─────────────────────────────────────────────────────

function findPartyKeys() {
  if (!midiAccess) return;

  let found = null;
  for (const output of midiAccess.outputs.values()) {
    if (/partykeys/i.test(output.name || '')) { found = output; break; }
  }

  if (found === partyKeysOutput) return;

  if (found) {
    partyKeysOutput = found;
    partyKeysOutput.open().then(() => {
      sendSysEx(buildInitCommand());
      setTimeout(() => sendSysEx(buildAllOffCommand()), 50);
      reportStatus();
    }).catch(() => {});
  } else {
    partyKeysOutput = null;
    reportStatus();
  }
}

async function connectMidi() {
  if (midiAccess) { findPartyKeys(); return; }
  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: true });
    midiAccess.addEventListener('statechange', findPartyKeys);
    findPartyKeys();
  } catch (e) {
    console.warn('[PKS] MIDI access denied:', e.message);
    reportStatus();
  }
}

function disconnectMidi() {
  clearTimeout(noteOffTimer);
  clearTimeout(silenceTimer);
  noteOffTimer = null;
  silenceTimer = null;

  if (partyKeysOutput) sendAllOff();
  activeNotes.clear();
  partyKeysOutput = null;
  reportStatus();
}

// ─── Enable / disable ─────────────────────────────────────────────────────────

function setEnabled(value) {
  isEnabled = value;
  if (isEnabled) {
    connectMidi();
  } else {
    disconnectMidi();
  }
}

// ─── Report keyboard status to background (for popup display) ─────────────────

function reportStatus() {
  try {
    chrome.runtime.sendMessage({
      type: 'PKS_KEYBOARD_STATUS',
      connected: partyKeysOutput !== null,
    }).catch(() => {});
  } catch (_) {}
}

// ─── Listen for MIDI messages posted by injected.js ──────────────────────────

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (!event.data || !event.data.__pks) return;
  handleMidiMessage(event.data.data);
});

// ─── React to enable/disable toggle (via chrome.storage) ─────────────────────

chrome.storage.onChanged.addListener((changes) => {
  if ('enabled' in changes) {
    setEnabled(changes.enabled.newValue === true);
  }
});

// ─── Init: read enabled state from storage on page load ───────────────────────

chrome.storage.local.get('enabled', (result) => {
  setEnabled(result.enabled === true);
});

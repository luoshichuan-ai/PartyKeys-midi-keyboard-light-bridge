/**
 * lighting.js — PartyKeys SysEx lighting protocol builder
 *
 * Protocol summary:
 *   Enter light mode:  F0 05 30 7F 7F 20 00 0F 05 F7
 *   Light notes:       F0 05 30 7F 7F 20 00 71 [count] [note color ...] F7
 *   All lights off:    F0 05 30 7F 7F 20 00 71 00 F7
 *   Single note off:   F0 05 30 7F 7F 20 00 71 01 [note] 00 F7
 */

const HEADER = [0xf0, 0x05, 0x30, 0x7f, 0x7f, 0x20, 0x00];

/**
 * SysEx to put the keyboard into note-lighting mode.
 * Send this once after connecting.
 * @returns {number[]}
 */
function buildInitCommand() {
  return [...HEADER, 0x0f, 0x01, 0xf7];
}

/**
 * SysEx to light multiple notes at once.
 * @param {Array<{note: number, color: number}>} noteColors
 *   note:  MIDI note number (0–127)
 *   color: 1–12  (1=red … 12=purple)
 * @returns {number[]}
 */
function buildLightCommand(noteColors) {
  if (!noteColors || noteColors.length === 0) return buildAllOffCommand();

  const payload = [...HEADER, 0x71, noteColors.length & 0x7f];
  for (const { note, color } of noteColors) {
    payload.push(note & 0x7f);
    payload.push(Math.max(1, Math.min(12, color)) & 0x7f);
  }
  payload.push(0xf7);
  return payload;
}

/**
 * SysEx to turn off all lights.
 * @returns {number[]}
 */
function buildAllOffCommand() {
  return [...HEADER, 0x71, 0x00, 0xf7];
}

/**
 * SysEx to turn off a single note's light.
 * @param {number} note - MIDI note number
 * @returns {number[]}
 */
function buildNoteOffCommand(note) {
  return [...HEADER, 0x71, 0x01, note & 0x7f, 0x00, 0xf7];
}

module.exports = {
  buildInitCommand,
  buildLightCommand,
  buildAllOffCommand,
  buildNoteOffCommand,
};

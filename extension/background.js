/**
 * background.js — Manifest V3 service worker (simplified)
 *
 * Responsibilities:
 *  1. Persist enabled/disabled state in chrome.storage.local
 *  2. Track keyboard connection status reported by content scripts
 *  3. Respond to popup requests (GET_STATUS, SET_ENABLED)
 *  4. Broadcast status changes to popup
 *
 * No longer handles Native Messaging — the content script now
 * communicates directly with PartyKeys via Web MIDI API.
 */

let isEnabled = false;
let keyboardConnected = false;

// ─── Restore state on service worker startup ──────────────────────────────────
chrome.storage.local.get('enabled', (result) => {
  isEnabled = result.enabled === true;
});

// ─── Message handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {

    case 'GET_STATUS':
      sendResponse({ enabled: isEnabled, keyboardConnected });
      return false;

    case 'SET_ENABLED':
      isEnabled = msg.enabled;
      chrome.storage.local.set({ enabled: isEnabled });
      broadcastStatus();
      sendResponse({ ok: true, enabled: isEnabled, keyboardConnected });
      return false;

    case 'PKS_KEYBOARD_STATUS':
      // Sent by content-script whenever PartyKeys connects or disconnects
      keyboardConnected = msg.connected;
      broadcastStatus();
      return false;
  }
  return false;
});

// ─── Broadcast to popup (if open) ────────────────────────────────────────────
function broadcastStatus() {
  chrome.runtime.sendMessage({
    type: 'STATUS_UPDATE',
    enabled: isEnabled,
    keyboardConnected,
  }).catch(() => {}); // popup may not be open — ignore error
}

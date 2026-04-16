/**
 * background.js — Manifest V3 service worker
 *
 * Responsibilities:
 *  1. Maintain enabled/disabled state (persisted in chrome.storage.local)
 *  2. When enabled, open a Native Messaging connection to the desktop app
 *  3. Forward MIDI messages from content scripts to the desktop app
 *  4. Broadcast status changes back to popup
 */

const HOST_NAME = 'com.partykeys.midilight';

let nativePort = null;
let isEnabled = false;

// ─── Restore persisted state on startup ──────────────────────────────────────
chrome.storage.local.get('enabled', (result) => {
  isEnabled = result.enabled === true;
  if (isEnabled) connectNative();
});

// ─── Messages from content scripts & popup ───────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {
    case 'MIDI_MESSAGE':
      if (isEnabled && nativePort) {
        try {
          nativePort.postMessage(msg);
        } catch (_) {
          nativePort = null;
        }
      }
      break;

    case 'SET_ENABLED':
      setEnabled(msg.enabled);
      sendResponse({ ok: true, enabled: isEnabled });
      break;

    case 'GET_STATUS':
      sendResponse({
        enabled: isEnabled,
        nativeConnected: nativePort !== null,
      });
      break;
  }
  // Return true only when sendResponse will be called asynchronously
  return false;
});

// ─── Enable / disable ────────────────────────────────────────────────────────
function setEnabled(value) {
  isEnabled = value;
  chrome.storage.local.set({ enabled: value });

  if (isEnabled && !nativePort) {
    connectNative();
  } else if (!isEnabled && nativePort) {
    nativePort.disconnect();
    nativePort = null;
  }

  broadcastStatus();
}

// ─── Native Messaging ─────────────────────────────────────────────────────────
function connectNative() {
  try {
    nativePort = chrome.runtime.connectNative(HOST_NAME);

    nativePort.onMessage.addListener((msg) => {
      // Messages from desktop app (e.g. status updates) — broadcast to popup
      broadcastStatus();
    });

    nativePort.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError;
      console.warn('[PKS] Native host disconnected:', err?.message);
      nativePort = null;
      broadcastStatus();

      // Auto-reconnect while enabled
      if (isEnabled) {
        setTimeout(connectNative, 3000);
      }
    });

    broadcastStatus();
  } catch (e) {
    console.error('[PKS] connectNative failed:', e);
    nativePort = null;
  }
}

// ─── Broadcast current status to all extension views ─────────────────────────
function broadcastStatus() {
  const status = { enabled: isEnabled, nativeConnected: nativePort !== null };
  chrome.runtime
    .sendMessage({ type: 'STATUS_UPDATE', ...status })
    .catch(() => {}); // popup may not be open
}

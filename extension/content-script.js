/**
 * content-script.js — runs in ISOLATED world
 * Listens for MIDI messages posted by injected.js and forwards them
 * to the background service worker.
 */
window.addEventListener('message', function (event) {
  if (event.source !== window) return;
  if (!event.data || !event.data.__pks) return;

  try {
    chrome.runtime.sendMessage({
      type: 'MIDI_MESSAGE',
      data: event.data.data,
      ts: event.data.ts,
    }).catch(() => {});
  } catch (_) {
    // Extension context invalidated (e.g. after extension reload) — ignore
  }
});

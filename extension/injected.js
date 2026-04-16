/**
 * injected.js — runs in MAIN world (page's JS context)
 *
 * Two modes:
 *  1. midiano.com (and other Web MIDI sites): hooks navigator.requestMIDIAccess
 *     to intercept all output.send() calls.
 *  2. flowkey.com: Web Audio + WASM playback, no MIDI output at all.
 *     Instead, we observe the DOM's .note-names-container for the guide
 *     notes and synthesise fake MIDI messages from those DOM changes.
 *
 * Both modes post { __pks: true, data: [...], ts: ... } via window.postMessage,
 * which the content-script then forwards to background → Electron → PartyKeys.
 */
(function () {

  // ─── Shared helper ──────────────────────────────────────────────────────────

  function postMidi(data) {
    try {
      window.postMessage({ __pks: true, data: Array.from(data), ts: performance.now() }, '*');
    } catch (_) {}
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MODE 1 — Web MIDI hook (midiano and similar)
  // ════════════════════════════════════════════════════════════════════════════

  if (navigator.requestMIDIAccess) {
    const _originalRequestMIDIAccess = navigator.requestMIDIAccess.bind(navigator);

    navigator.requestMIDIAccess = async function (options) {
      const midiAccess = await _originalRequestMIDIAccess(options);

      midiAccess.outputs.forEach((output) => hookOutput(output));

      midiAccess.addEventListener('statechange', (event) => {
        if (event.port && event.port.type === 'output') {
          hookOutput(event.port);
        }
      });

      return midiAccess;
    };

    function hookOutput(output) {
      if (output.__pksHooked) return;
      output.__pksHooked = true;

      const _originalSend = output.send.bind(output);
      const isPartyKeys = /partykeys/i.test(output.name || '');

      if (isPartyKeys) {
        output.close().catch(() => {});
        output.open = () => Promise.resolve(output);
      }

      output.send = function (data, timestamp) {
        postMidi(data);
        if (!isPartyKeys) {
          return _originalSend(data, timestamp);
        }
      };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MODE 2 — flowkey.com DOM observer
  // ════════════════════════════════════════════════════════════════════════════

  if (!location.hostname.includes('flowkey.com')) return;

  // --- lightning-key observer ---
  // flowkey renders ~88 absolutely-positioned .lightning-key divs inside
  // .lightning-keys. When a key should be played, the class "show" is added.
  // Background color encodes the hand: R > B → orange → right hand (ch1),
  // R < B → blue → left hand (ch2).

  const NOTE_MAX_MS = 2000; // safety timeout: force NOTE_OFF after this many ms

  const activeNotes   = new Map(); // midi → { channel, timerId }

  function getChannel(el) {
    const bg = getComputedStyle(el).backgroundColor;
    const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) {
      return parseInt(m[1]) > parseInt(m[3]) ? 1 : 2; // R>B → orange(ch1), else blue(ch2)
    }
    return 1;
  }

  function noteOff(midi) {
    const entry = activeNotes.get(midi);
    if (!entry) return;
    clearTimeout(entry.timerId);
    postMidi([0x80 | (entry.channel - 1), midi, 0]);
    activeNotes.delete(midi);
  }

  function noteOn(midi, channel) {
    if (activeNotes.has(midi)) noteOff(midi); // re-trigger: clear old timer first
    const timerId = setTimeout(() => noteOff(midi), NOTE_MAX_MS);
    postMidi([0x90 | (channel - 1), midi, 64]);
    activeNotes.set(midi, { channel, timerId });
  }

  function onKeyClassChange(el, elToMidi) {
    const midi = elToMidi.get(el);
    if (midi === undefined) return;
    if (el.classList.contains('show')) {
      noteOn(midi, getChannel(el));
    } else {
      noteOff(midi);
    }
  }

  let currentObserver = null; // track so we can disconnect on re-init

  function startFlowkeyObserver() {
    // Disconnect previous observer if any
    if (currentObserver) {
      currentObserver.disconnect();
      currentObserver = null;
    }

    // Turn off any stuck notes from the previous page
    for (const midi of [...activeNotes.keys()]) noteOff(midi);

    const container = document.querySelector('.lightning-keys');
    if (!container) {
      setTimeout(startFlowkeyObserver, 500);
      return;
    }

    const keyEls = Array.from(container.querySelectorAll('.lightning-key'));
    if (keyEls.length < 80) {
      setTimeout(startFlowkeyObserver, 500);
      return;
    }

    const sorted = keyEls
      .map(el => ({ el, left: parseFloat(el.style.left) || 0 }))
      .sort((a, b) => a.left - b.left);

    const elToMidi = new Map(sorted.map(({ el }, i) => [el, 21 + i]));

    const observer = new MutationObserver(mutations => {
      for (const m of mutations) {
        if (m.attributeName === 'class') {
          onKeyClassChange(m.target, elToMidi);
        }
        m.removedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          const midi = elToMidi.get(node);
          if (midi !== undefined) noteOff(midi);
          node.querySelectorAll && node.querySelectorAll('.lightning-key').forEach(child => {
            const m2 = elToMidi.get(child);
            if (m2 !== undefined) noteOff(m2);
          });
        });
      }
    });

    keyEls.forEach(el => observer.observe(el, { attributes: true, attributeFilter: ['class'] }));
    observer.observe(container, { childList: true, subtree: true });
    currentObserver = observer;

    // Initial sync
    keyEls.forEach(el => { if (el.classList.contains('show')) noteOn(elToMidi.get(el), getChannel(el)); });
  }

  // ── SPA navigation detection ─────────────────────────────────────────────
  // React Router uses history.pushState — intercept it directly.
  // Also cover popstate (back/forward) and hashchange.

  function onNavigate() {
    setTimeout(startFlowkeyObserver, 800); // let React finish rendering
  }

  const _origPushState    = history.pushState.bind(history);
  const _origReplaceState = history.replaceState.bind(history);
  history.pushState = function (...args) {
    _origPushState(...args);
    onNavigate();
  };
  history.replaceState = function (...args) {
    _origReplaceState(...args);
    onNavigate();
  };
  window.addEventListener('popstate',   onNavigate);
  window.addEventListener('hashchange', onNavigate);

  // Initial start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startFlowkeyObserver);
  } else {
    startFlowkeyObserver();
  }

})();

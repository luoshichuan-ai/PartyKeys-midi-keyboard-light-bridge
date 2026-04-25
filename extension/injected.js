/**
 * injected.js — runs in MAIN world (page's JS context)
 *
 * Two modes:
 *  1. midiano.com (and other Web MIDI sites): hooks navigator.requestMIDIAccess
 *     to intercept all output.send() calls.
 *  2. flowkey.com: DOM observer — .lightning-key.show drives note on/off.
 *     Normal playback: event-driven + 100 ms auto-off timer per note.
 *     Practice mode:   continuous reconcile against DOM (no fixed timer).
 *
 * Both modes post { __pks: true, data: [...], ts: ... } via window.postMessage.
 */
(function () {

  // ─── Shared helper ───────────────────────────────────────────────────────────

  function postMidi(data) {
    try {
      window.postMessage({ __pks: true, data: Array.from(data), ts: performance.now() }, '*');
    } catch (_) {}
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MODE 1 — Web MIDI hook (midiano and similar)
  // ════════════════════════════════════════════════════════════════════════════

  if (navigator.requestMIDIAccess && !location.hostname.includes('flowkey.com')) {
    const _orig = navigator.requestMIDIAccess.bind(navigator);
    navigator.requestMIDIAccess = async function (options) {
      const midiAccess = await _orig(options);
      midiAccess.outputs.forEach(hookOutput);
      midiAccess.addEventListener('statechange', (e) => {
        if (e.port && e.port.type === 'output') hookOutput(e.port);
      });
      return midiAccess;
    };
    function hookOutput(output) {
      if (output.__pksHooked) return;
      output.__pksHooked = true;
      const _send = output.send.bind(output);
      const isPK  = /partykeys/i.test(output.name || '');
      if (isPK) { output.close().catch(() => {}); output.open = () => Promise.resolve(output); }
      output.send = function (data, ts) {
        postMidi(data);
        if (!isPK) return _send(data, ts);
      };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MODE 2 — flowkey.com DOM observer
  // ════════════════════════════════════════════════════════════════════════════

  if (!location.hostname.includes('flowkey.com')) return;

  const NOTE_AUTO_OFF_MS = 100; // normal playback: force off after this long

  // ── State ────────────────────────────────────────────────────────────────────

  const activeNotes = new Map(); // midi → { channel, el, timerId }
  let currentElToMidi    = null;
  let currentObserver    = null;
  let currentSafetyTimer = null;
  let reconcilePending   = false;

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function getChannel(el) {
    const bg = getComputedStyle(el).backgroundColor;
    const m  = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return (m && parseInt(m[1]) > parseInt(m[3])) ? 1 : 2; // orange=ch1, blue=ch2
  }

  // Practice mode: either hand button carries the "selected" class
  function isPracticeMode() {
    return !!document.querySelector('.hand-button.selected');
  }

  function noteOn(midi, channel, el) {
    if (activeNotes.has(midi)) return;
    postMidi([0x90 | (channel - 1), midi, 64]);

    // Normal playback: auto-off after 100 ms even if flowkey forgets to remove show.
    // Practice mode:   no timer — the reconcile loop keeps lights in sync with DOM.
    const timerId = isPracticeMode()
      ? null
      : setTimeout(() => noteOff(midi), NOTE_AUTO_OFF_MS);

    activeNotes.set(midi, { channel, el, timerId });
    console.log('[PKS] on', midi, 'ch', channel, timerId ? `(${NOTE_AUTO_OFF_MS}ms)` : '(practice)');
  }

  function noteOff(midi) {
    const entry = activeNotes.get(midi);
    if (!entry) return;
    if (entry.timerId) clearTimeout(entry.timerId);
    postMidi([0x80 | (entry.channel - 1), midi, 0]);
    activeNotes.delete(midi);
    console.log('[PKS] off', midi);
  }

  // ── Reconcile (practice mode) ─────────────────────────────────────────────────
  //
  // Ground truth: scan all .lightning-key elements and sync activeNotes to match.
  // Called on every relevant DOM mutation (debounced to one call per animation
  // frame) and by the 200 ms safety interval.

  function reconcile() {
    if (!currentElToMidi) return;

    const shouldBeOn = new Map();
    for (const [el, midi] of currentElToMidi) {
      if (el.classList.contains('show')) {
        shouldBeOn.set(midi, { channel: getChannel(el), el });
      }
    }

    // Turn off any note no longer visible
    for (const midi of [...activeNotes.keys()]) {
      if (!shouldBeOn.has(midi)) noteOff(midi);
    }

    // Turn on any newly visible note
    for (const [midi, { channel, el }] of shouldBeOn) {
      if (!activeNotes.has(midi)) noteOn(midi, channel, el);
    }
  }

  function scheduleReconcile() {
    if (reconcilePending) return;
    reconcilePending = true;
    requestAnimationFrame(() => { reconcilePending = false; reconcile(); });
  }

  // ── MutationObserver callback ─────────────────────────────────────────────────
  //
  // Practice mode → full reconcile on any DOM change (show class or note-name).
  // Normal mode   → react to each individual class change with a 100 ms timer.

  function handleMutations(mutations) {
    if (isPracticeMode()) {
      scheduleReconcile();
      return;
    }
    // Normal playback: per-element immediate handling
    for (const m of mutations) {
      if (m.type !== 'attributes') continue;
      const midi = currentElToMidi && currentElToMidi.get(m.target);
      if (midi === undefined) continue;
      if (m.target.classList.contains('show')) {
        noteOn(midi, getChannel(m.target), m.target);
      } else {
        noteOff(midi);
      }
    }
  }

  // ── Main setup ────────────────────────────────────────────────────────────────

  function startFlowkeyObserver() {
    if (currentObserver)    { currentObserver.disconnect();    currentObserver    = null; }
    if (currentSafetyTimer) { clearInterval(currentSafetyTimer); currentSafetyTimer = null; }
    for (const midi of [...activeNotes.keys()]) noteOff(midi);

    const container = document.querySelector('.lightning-keys');
    if (!container) { setTimeout(startFlowkeyObserver, 500); return; }

    const keyEls = Array.from(container.querySelectorAll('.lightning-key'));
    if (keyEls.length < 80) { setTimeout(startFlowkeyObserver, 500); return; }

    const sorted = keyEls
      .map(el => ({ el, left: parseFloat(el.style.left) || 0 }))
      .sort((a, b) => a.left - b.left);

    currentElToMidi = new Map(sorted.map(({ el }, i) => [el, 21 + i]));

    const observer = new MutationObserver(handleMutations);

    // Watch class changes on every key
    keyEls.forEach(el =>
      observer.observe(el, { attributes: true, attributeFilter: ['class'] })
    );

    // Watch container for .note-name additions/removals (second DOM signal)
    observer.observe(container, { childList: true, subtree: true });

    currentObserver = observer;

    // Safety interval: practice mode only — re-reconcile every 200 ms to catch
    // any mutations the observer might have missed (e.g. React element replacement)
    currentSafetyTimer = setInterval(() => {
      if (isPracticeMode()) reconcile();
    }, 200);

    reconcile(); // initial sync
    console.log('[PKS] started, keys:', currentElToMidi.size);
  }

  // ── SPA navigation (React Router) ────────────────────────────────────────────

  function onNavigate() { setTimeout(startFlowkeyObserver, 800); }
  const _push    = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);
  history.pushState    = function (...a) { _push(...a);    onNavigate(); };
  history.replaceState = function (...a) { _replace(...a); onNavigate(); };
  window.addEventListener('popstate',   onNavigate);
  window.addEventListener('hashchange', onNavigate);

  // ── Boot ─────────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startFlowkeyObserver);
  } else {
    startFlowkeyObserver();
  }

})();

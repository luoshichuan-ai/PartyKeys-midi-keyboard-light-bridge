const toggleEl = document.getElementById('toggleEnabled');
const dotEl = document.getElementById('dotNative');
const statusEl = document.getElementById('statusNative');

// ─── Load current status ──────────────────────────────────────────────────────
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
  if (chrome.runtime.lastError) return;
  applyStatus(res);
});

// ─── Toggle clicked ───────────────────────────────────────────────────────────
toggleEl.addEventListener('change', () => {
  chrome.runtime.sendMessage(
    { type: 'SET_ENABLED', enabled: toggleEl.checked },
    (res) => {
      if (chrome.runtime.lastError) return;
      applyStatus(res);
    }
  );
});

// ─── Live status updates from background ─────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATUS_UPDATE') {
    applyStatus(msg);
  }
});

// ─── Render ───────────────────────────────────────────────────────────────────
function applyStatus(status) {
  if (!status) return;
  toggleEl.checked = status.enabled;

  dotEl.className = 'dot';
  if (status.nativeConnected) {
    dotEl.classList.add('connected');
    statusEl.textContent = 'Desktop app connected';
  } else if (status.enabled) {
    dotEl.classList.add('connecting');
    statusEl.textContent = 'Connecting to desktop app…';
  } else {
    statusEl.textContent = 'Desktop app not connected';
  }
}

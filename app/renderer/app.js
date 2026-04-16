/**
 * app.js — Dashboard renderer
 *
 * Handles:
 *  - Piano keyboard rendering (88 keys, MIDI 21–108)
 *  - Device selection, connect/disconnect
 *  - Real-time note highlighting
 *  - Channel color mapping UI
 *  - Monitor toggle state
 */

'use strict';

// ─── PartyKeys 12 colors ──────────────────────────────────────────────────────
// Index 0 = "off", indices 1–12 map to PartyKeys color codes 01–12
const PK_COLORS = [
  null,
  '#FF2200', // 1  red
  '#FF5500', // 2  red-orange
  '#FF8800', // 3  orange
  '#FFBB00', // 4  yellow-orange
  '#CCDD00', // 5  yellow-green
  '#44CC00', // 6  green
  '#00CC88', // 7  teal
  '#00CCFF', // 8  cyan
  '#0077FF', // 9  blue
  '#4400FF', // 10 indigo
  '#8800FF', // 11 violet
  '#CC00FF', // 12 purple
];

// Default: ch1 → color 1 (right hand), ch2 → color 9 (left hand), rest → 5
const DEFAULT_CHANNEL_COLORS = {
  1: 1, 2: 9,
  3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 8: 3,
  9: 3, 11: 3, 12: 3, 13: 3, 14: 3, 15: 3, 16: 3,
  default: 5,
};

// ─── State ────────────────────────────────────────────────────────────────────

let colorMap = JSON.parse(JSON.stringify(DEFAULT_CHANNEL_COLORS));
let totalReceived = 0;
let isConnected = false;

// ─── Piano ────────────────────────────────────────────────────────────────────
// Build lookup table for all 88 keys (MIDI 21–108)

const WHITE_PITCH = new Set([0, 2, 4, 5, 7, 9, 11]); // C D E F G A B
const KEY_W = 14; // white key width (px)
const KEY_BW = 9;  // black key width (px)

// Pre-compute key data
const KEYS = buildKeyData();

function buildKeyData() {
  const keys = [];
  let whiteIdx = 0;

  // First pass: assign white indices
  for (let note = 21; note <= 108; note++) {
    const pc = note % 12;
    const isWhite = WHITE_PITCH.has(pc);
    keys.push({ note, pc, isWhite, whiteIdx: isWhite ? whiteIdx++ : null, leftPx: 0 });
  }

  // Second pass: compute pixel positions
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k.isWhite) {
      k.leftPx = k.whiteIdx * KEY_W;
    } else {
      // Center between prev and next white key
      const prev = keys.slice(0, i).reverse().find(x => x.isWhite);
      const next = keys.slice(i + 1).find(x => x.isWhite);
      const lw = prev ? prev.whiteIdx : 0;
      const rw = next ? next.whiteIdx : lw + 1;
      k.leftPx = (lw + rw) / 2 * KEY_W - KEY_BW / 2;
    }
  }

  const totalWhite = keys.filter(k => k.isWhite).length; // 52
  return { keys, totalWhite };
}

function renderPiano() {
  const wrap = document.getElementById('pianoWrap');
  const { keys, totalWhite } = KEYS;
  wrap.style.width = (totalWhite * KEY_W + 1) + 'px';

  // Render white keys first, then black (z-order)
  for (const k of [...keys.filter(x => x.isWhite), ...keys.filter(x => !x.isWhite)]) {
    const el = document.createElement('div');
    el.className = 'piano-key ' + (k.isWhite ? 'white' : 'black');
    el.dataset.note = k.note;
    el.style.left = k.leftPx + 'px';
    wrap.appendChild(el);
  }
}

function updatePiano(activeNotes) {
  // Clear all highlights
  document.querySelectorAll('.piano-key.active').forEach(el => {
    el.classList.remove('active');
    el.style.background = '';
  });

  // Apply new highlights
  for (const { note, color } of activeNotes) {
    const el = document.querySelector(`.piano-key[data-note="${note}"]`);
    if (!el) continue;
    const hex = PK_COLORS[color] || PK_COLORS[1];
    el.classList.add('active');
    el.style.background = hex;
  }

  document.getElementById('statNotes').textContent = activeNotes.length;
}

// ─── Device UI ────────────────────────────────────────────────────────────────

async function loadDevices() {
  const select = document.getElementById('deviceSelect');
  const devices = await window.api.getDevices();

  const prev = select.value;
  select.innerHTML = '<option value="">— Select MIDI output device —</option>';

  for (const d of devices) {
    const opt = document.createElement('option');
    opt.value = d.index;
    opt.textContent = d.name;
    select.appendChild(opt);
  }

  // Restore previous selection if still present
  if (prev && [...select.options].some(o => o.value === prev)) {
    select.value = prev;
  }

  updateConnectBtn();
}

function updateConnectBtn() {
  const sel = document.getElementById('deviceSelect');
  const btn = document.getElementById('connectBtn');
  btn.disabled = !sel.value || isConnected;
}

async function connectDevice() {
  const portIndex = parseInt(document.getElementById('deviceSelect').value, 10);
  if (isNaN(portIndex)) return;

  const res = await window.api.connectDevice(portIndex);
  if (res.ok) {
    setConnected(true, res.name);
    log(`Connected to ${res.name}`);
  } else {
    log(`Connection failed: ${res.error}`);
  }
}

async function disconnectDevice() {
  await window.api.disconnectDevice();
  setConnected(false, null);
  log('Disconnected');
}

function setConnected(connected, name) {
  isConnected = connected;

  const badge = document.getElementById('connBadge');
  const text = document.getElementById('connText');
  const connectBtn = document.getElementById('connectBtn');
  const disconnectBtn = document.getElementById('disconnectBtn');
  const select = document.getElementById('deviceSelect');

  if (connected) {
    badge.classList.add('connected');
    text.textContent = name || 'Connected';
    connectBtn.style.display = 'none';
    disconnectBtn.style.display = '';
    select.disabled = true;
  } else {
    badge.classList.remove('connected');
    text.textContent = 'No device';
    connectBtn.style.display = '';
    disconnectBtn.style.display = 'none';
    select.disabled = false;
    updatePiano([]);
    document.getElementById('statNotes').textContent = '0';
  }
  updateConnectBtn();
}

// ─── Color mapping UI ─────────────────────────────────────────────────────────

const COLOR_CHANNELS = [
  { ch: 1, label: 'Channel 1 (Right hand)' },
  { ch: 2, label: 'Channel 2 (Left hand)' },
  { ch: 3, label: 'Channel 3' },
  { ch: 'default', label: 'All other channels' },
];

function renderColorGrid() {
  const grid = document.getElementById('colorGrid');
  grid.innerHTML = '';

  for (const { ch, label } of COLOR_CHANNELS) {
    const row = document.createElement('div');
    row.className = 'color-row';

    const lbl = document.createElement('span');
    lbl.className = 'color-row-label';
    lbl.textContent = label;
    row.appendChild(lbl);

    const swatchRow = document.createElement('div');
    swatchRow.className = 'color-swatch-row';

    for (let i = 1; i <= 12; i++) {
      const sw = document.createElement('div');
      sw.className = 'swatch' + (colorMap[ch] === i ? ' selected' : '');
      sw.style.background = PK_COLORS[i];
      sw.title = `Color ${i}`;
      sw.dataset.ch = ch;
      sw.dataset.color = i;
      sw.addEventListener('click', () => selectColor(ch, i));
      swatchRow.appendChild(sw);
    }

    row.appendChild(swatchRow);
    grid.appendChild(row);
  }
}

function selectColor(ch, color) {
  colorMap[ch] = color;
  renderColorGrid();
  saveColorMap();
}

async function saveColorMap() {
  await window.api.setColorMap(colorMap);
}

function resetColors() {
  colorMap = JSON.parse(JSON.stringify(DEFAULT_CHANNEL_COLORS));
  renderColorGrid();
  saveColorMap();
}

// ─── Log / status ─────────────────────────────────────────────────────────────

function log(msg) {
  document.getElementById('logLine').textContent = msg;
}

// ─── Monitor toggle ───────────────────────────────────────────────────────────
// This toggle is visual only in the app — the real enable/disable lives in the
// Chrome extension. The footer shows whether the extension is sending data.

let lastMidiTime = 0;

function checkExtensionActivity() {
  const age = Date.now() - lastMidiTime;
  const el = document.getElementById('footerStatus');
  if (lastMidiTime === 0) {
    el.textContent = 'Extension: no data yet';
  } else if (age < 3000) {
    el.textContent = 'Extension: active';
  } else {
    el.textContent = `Extension: last signal ${Math.round(age / 1000)}s ago`;
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  // Build piano
  renderPiano();

  // Load saved color map
  const saved = await window.api.getColorMap();
  if (saved && saved.channelColors) {
    colorMap = { ...colorMap, ...saved.channelColors };
    if (saved.defaultColor) colorMap.default = saved.defaultColor;
  }
  renderColorGrid();

  // Load devices
  await loadDevices();

  // Wire buttons
  document.getElementById('refreshBtn').addEventListener('click', loadDevices);
  document.getElementById('connectBtn').addEventListener('click', connectDevice);
  document.getElementById('disconnectBtn').addEventListener('click', disconnectDevice);
  document.getElementById('deviceSelect').addEventListener('change', updateConnectBtn);
  document.getElementById('resetColorsBtn').addEventListener('click', resetColors);

  // Monitor toggle (visual only — decorative, extension state is in popup)
  const toggle = document.getElementById('monitorToggle');
  toggle.addEventListener('change', () => {
    log(toggle.checked ? 'Monitoring enabled (use Chrome extension to activate)' : 'Monitor toggle off');
  });

  // Events from main process
  window.api.onNotesUpdate((notes) => {
    updatePiano(notes);
    totalReceived += notes.length > 0 ? 1 : 0;
    document.getElementById('statTotal').textContent = totalReceived;
    lastMidiTime = Date.now();
  });

  window.api.onDeviceStatus((status) => {
    if (status.connected) {
      setConnected(true, status.name);
    } else {
      setConnected(false, null);
    }
  });

  // Poll extension activity indicator
  setInterval(checkExtensionActivity, 1000);
}

document.addEventListener('DOMContentLoaded', init);

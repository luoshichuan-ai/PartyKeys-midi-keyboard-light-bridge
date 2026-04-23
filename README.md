# PartyKeys MIDI Light Bridge

A Chrome Extension + Electron app that intercepts MIDI signals from web-based piano learning apps (e.g. midiano.com) and lights up the corresponding keys on a PartyKeys keyboard in real time.

![platform](https://img.shields.io/badge/platform-Windows%20%7C%20Mac-blue)
![electron](https://img.shields.io/badge/Electron-29-47848F?logo=electron)
![manifest](https://img.shields.io/badge/Chrome%20Extension-MV3-4285F4?logo=googlechrome)

---

## How It Works

1. Open [midiano.com](https://midiano.com) and play any sheet music
2. The Chrome extension intercepts the MIDI output in real time
3. The Electron app receives the notes and sends SysEx lighting commands to the PartyKeys keyboard
4. Keys light up — **right hand in orange**, **left hand in blue**
5. Follow the lights and play

> PartyKeys is a MIDI controller with no built-in sound engine. Sound comes from the physical keys when you press them.

### Signal Chain

```
Web page (midiano.com)
  ↓  output.send() intercepted by injected.js (MAIN world)
Chrome Extension (content-script → background service worker)
  ↓  Native Messaging (4-byte LE length + JSON)
host.js (Node.js process)
  ↓  TCP 127.0.0.1:47890
Electron App (main.js)
  ↓  SysEx lighting commands only — raw MIDI notes are NOT forwarded
PartyKeys keyboard (USB MIDI)
```

**Key technical decisions:**
- The content script runs in `world: "MAIN"` to hook `navigator.requestMIDIAccess` directly in the page's JS context
- On Windows, WinMM requires exclusive port ownership to send SysEx — the extension closes the browser's handle on the PartyKeys port so Electron owns it exclusively
- SysEx send rate is throttled to 25 commands/sec (40ms) to prevent keyboard firmware overflow

---

## Requirements

- Windows 10+ or macOS 11+
- Google Chrome
- PartyKeys keyboard connected via USB
- Node.js 18+ (required for running from source)

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/luoshichuan-ai/PartyKeys-midi-keyboard-light-bridge.git
cd PartyKeys-midi-keyboard-light-bridge/app
npm install
```

### 2. Register the Native Messaging Host

```bash
node install-host.js --extension-id fkljaajdiegnebbmoadnlooiknlpnfni
```

On Windows this writes a registry key under `HKCU\Software\Google\Chrome\NativeMessagingHosts\`.  
On Mac it writes a manifest to `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`.

### 3. Load the Chrome extension

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` folder from this repo

### 4. Start the app

```bash
npm start
```

Select your PartyKeys device in the dashboard and click **Connect**.

### 5. Configure midiano

1. Open [midiano.com](https://midiano.com)
2. Set the MIDI Output to **PartyKeys** in the site settings
3. Click the extension icon in Chrome and enable the toggle
4. Play a song — the lights will follow

---

## Project Structure

```
PartyKeys-midi-keyboard-light-bridge/
├── app/
│   ├── main.js               # Electron main process + TCP server (port 47890)
│   ├── preload.js            # contextBridge IPC
│   ├── host.js               # Native Messaging host process
│   ├── install-host.js       # Registers host with the OS
│   ├── generate-icons.js     # Generates app icons (pure Node.js, no canvas)
│   ├── package.json
│   ├── midi/
│   │   ├── lighting.js       # SysEx command builder
│   │   └── midi-manager.js   # MIDI device management + note state machine
│   └── renderer/
│       ├── index.html        # Dashboard
│       ├── app.js            # 88-key piano visualization + UI logic
│       └── styles.css
├── extension/
│   ├── manifest.json         # Chrome MV3 config
│   ├── injected.js           # Hooks Web MIDI API in MAIN world
│   ├── content-script.js     # Bridges page ↔ background
│   ├── background.js         # Service worker, manages Native Messaging
│   └── popup/
│       ├── popup.html
│       ├── popup.js
│       └── popup.css
└── test/
    └── test-midi.html        # End-to-end chain test page
```

---

## SysEx Lighting Protocol

The PartyKeys keyboard is controlled via SysEx messages over USB MIDI.

| Command | Bytes |
|---------|-------|
| Initialize (send on connect) | `F0 05 30 7F 7F 20 00 0F 01 F7` |
| Light up notes (batch) | `F0 05 30 7F 7F 20 00 71 [count] [note] [color] ... F7` |
| Turn off single note | `F0 05 30 7F 7F 20 00 71 01 [note] 00 F7` |
| Turn off all notes | `F0 05 30 7F 7F 20 00 71 00 F7` |

> ⚠️ Do not send the all-off command (`71 00`) without re-sending the init command first — it will crash the keyboard firmware during playback. Use single note-off commands instead.

**Color values (1–12):**

| Value | Color | Default use |
|-------|-------|-------------|
| 1 | Red | |
| 2 | Orange-red | |
| 3 | Orange | Channel 1 (right hand) |
| 4 | Yellow-orange | |
| 5 | Yellow | |
| 6 | Yellow-green | |
| 7 | Green | |
| 8 | Cyan-green | |
| 9 | Blue | Channel 2 (left hand) |
| 10 | Cyan-blue | |
| 11 | Purple-blue | |
| 12 | Purple | |

---

## Development

```bash
# Run in development mode
cd app && npm start

# Test the full signal chain (app must be running)
npx http-server test/
# Open http://localhost:8080/test-midi.html in Chrome
```

---

## Troubleshooting

**No lights after connecting**
- Make sure the app shows a green connected status
- Make sure the extension toggle is enabled
- Make sure midiano's MIDI Output is set to PartyKeys

**Extension can't connect to the app**
- Re-run `node install-host.js` and restart Chrome

**Extension not working in Incognito mode**
- Go to `chrome://extensions` → Details → enable "Allow in Incognito"

**`npm install` fails with node-gyp errors on Windows**
- This project uses `@julusian/midi` which ships prebuilt binaries — no Visual Studio Build Tools required. Make sure `package.json` does not reference the `midi` package.

---

## Roadmap

- [x] Web MIDI API interception via Chrome extension
- [x] Real-time SysEx lighting control
- [x] 88-key piano visualization dashboard
- [x] Per-channel color mapping (right hand / left hand)
- [ ] BLE MIDI support (Mac, Phase 2)
- [ ] Installer packages (Windows .exe / Mac .dmg)
- [ ] Chrome Web Store release

---

## License

MIT

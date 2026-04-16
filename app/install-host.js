/**
 * install-host.js
 *
 * Registers the Native Messaging host manifest with Chrome so the extension
 * can communicate with the desktop app.
 *
 * Run with:  node install-host.js [--extension-id <id>]
 *
 * On Windows: writes a registry key under HKCU.
 * On macOS:   writes a plist JSON to ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const HOST_NAME = 'com.partykeys.midilight';

// The extension ID is set during installation (passed as arg or env variable).
// During development, replace this with your unpacked extension ID.
const args = process.argv.slice(2);
const idIdx = args.indexOf('--extension-id');
const EXTENSION_ID = idIdx >= 0 ? args[idIdx + 1] : (process.env.PKS_EXTENSION_ID || 'YOUR_EXTENSION_ID');

const HOST_SCRIPT = path.resolve(__dirname, 'host.js');
const NODE_BIN = process.execPath; // path to node binary

// ─── Build manifest ───────────────────────────────────────────────────────────

function buildManifest(hostPath) {
  return {
    name: HOST_NAME,
    description: 'PartyKeys MIDI Light — Native Messaging Host',
    path: hostPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
  };
}

// ─── Windows ──────────────────────────────────────────────────────────────────

function installWindows() {
  // Create a .bat wrapper so Chrome can launch host.js via Node
  const batPath = path.join(__dirname, 'host.bat');
  fs.writeFileSync(batPath, `@echo off\r\n"${NODE_BIN}" "${HOST_SCRIPT}" %*\r\n`);

  const manifest = buildManifest(batPath);
  const manifestPath = path.join(__dirname, `${HOST_NAME}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  const regKey = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
  const escaped = manifestPath.replace(/\\/g, '\\\\');
  execSync(`reg add "${regKey}" /ve /t REG_SZ /d "${escaped}" /f`);

  console.log('[PKS] Native messaging host registered (Windows)');
  console.log(`      Manifest: ${manifestPath}`);
  console.log(`      Registry: ${regKey}`);
}

// ─── macOS ────────────────────────────────────────────────────────────────────

function installMac() {
  // Create a shell script wrapper
  const shPath = path.join(__dirname, 'host.sh');
  fs.writeFileSync(shPath, `#!/bin/bash\n"${NODE_BIN}" "${HOST_SCRIPT}" "$@"\n`);
  fs.chmodSync(shPath, '755');

  const manifest = buildManifest(shPath);

  // Chrome
  const chromeDir = path.join(
    os.homedir(),
    'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts'
  );
  writeManifest(chromeDir, manifest);

  // Chromium (optional)
  const chromiumDir = path.join(
    os.homedir(),
    'Library', 'Application Support', 'Chromium', 'NativeMessagingHosts'
  );
  writeManifest(chromiumDir, manifest);

  console.log('[PKS] Native messaging host registered (macOS)');
}

function writeManifest(dir, manifest) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${HOST_NAME}.json`);
    fs.writeFileSync(dest, JSON.stringify(manifest, null, 2), 'utf8');
    console.log(`      Written: ${dest}`);
  } catch (err) {
    console.warn(`      Skipped ${dir}: ${err.message}`);
  }
}

// ─── Uninstall ────────────────────────────────────────────────────────────────

function uninstall() {
  if (process.platform === 'win32') {
    try {
      execSync(`reg delete "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}" /f`);
      console.log('[PKS] Unregistered (Windows)');
    } catch (_) {}
  } else if (process.platform === 'darwin') {
    const dirs = [
      path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts'),
      path.join(os.homedir(), 'Library', 'Application Support', 'Chromium', 'NativeMessagingHosts'),
    ];
    for (const dir of dirs) {
      const f = path.join(dir, `${HOST_NAME}.json`);
      try { fs.unlinkSync(f); } catch (_) {}
    }
    console.log('[PKS] Unregistered (macOS)');
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

if (args.includes('--uninstall')) {
  uninstall();
} else if (process.platform === 'win32') {
  installWindows();
} else if (process.platform === 'darwin') {
  installMac();
} else {
  console.error('Unsupported platform:', process.platform);
  process.exit(1);
}

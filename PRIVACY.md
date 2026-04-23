# Privacy Policy

**PartyKeys MIDI Light Bridge**  
Last updated: April 2026

---

## Overview

PartyKeys MIDI Light Bridge is a Chrome extension that lights up keys on a PartyKeys MIDI keyboard in real time, based on notes from supported piano learning websites. This policy explains what data the extension does and does not collect.

---

## Data Collection

**This extension does not collect, store, transmit, or share any personal data.**

Specifically:
- No personal information is collected (name, email, location, etc.)
- No browsing history or page content is recorded
- No MIDI input or output data is sent to any server
- No analytics or tracking of any kind is used
- No third-party services are involved

---

## Local Storage

The extension stores a single value in your browser's local storage: your enabled/disabled toggle preference. This value never leaves your device.

---

## Permissions

| Permission | Why it is needed |
|------------|-----------------|
| `storage` | Save your on/off toggle preference locally in the browser |
| Host access to midiano.com and flowkey.com | Inject a script to read MIDI note events on these two sites only |
| Web MIDI API (requested at runtime) | Send SysEx lighting commands directly to your PartyKeys keyboard |

---

## Third Parties

This extension does not share any data with third parties. All processing happens locally in your browser.

---

## Changes

If this policy is updated, the "Last updated" date at the top of this page will be revised. Continued use of the extension after changes constitutes acceptance of the updated policy.

---

## Contact

If you have any questions about this privacy policy, please open an issue at:  
https://github.com/luoshichuan-ai/PartyKeys-midi-keyboard-light-bridge/issues

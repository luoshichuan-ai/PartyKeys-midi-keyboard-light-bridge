#!/usr/bin/env node
/**
 * host.js — Chrome Native Messaging Host
 *
 * Chrome spawns this process when the extension calls connectNative().
 * It bridges: Chrome extension ←→ Electron app (via TCP 127.0.0.1:47890).
 *
 * Native Messaging wire format (Chrome spec):
 *   Each message = 4-byte LE uint32 (length) + UTF-8 JSON string
 */

'use strict';

const net = require('net');

const TCP_HOST = '127.0.0.1';
const TCP_PORT = 47890;
const RECONNECT_DELAY = 2000;

let appSocket = null;
let stdinBuf = Buffer.alloc(0);
let reconnecting = false;

// ─── stdin → parse Chrome native messages ────────────────────────────────────

process.stdin.on('data', (chunk) => {
  stdinBuf = Buffer.concat([stdinBuf, chunk]);
  flushStdinBuffer();
});

process.stdin.on('end', () => process.exit(0));

function flushStdinBuffer() {
  while (stdinBuf.length >= 4) {
    const msgLen = stdinBuf.readUInt32LE(0);
    if (stdinBuf.length < 4 + msgLen) break;

    const jsonStr = stdinBuf.slice(4, 4 + msgLen).toString('utf8');
    stdinBuf = stdinBuf.slice(4 + msgLen);

    try {
      const msg = JSON.parse(jsonStr);
      forwardToApp(msg);
    } catch (_) {}
  }
}

// ─── Forward to Electron app ──────────────────────────────────────────────────

function forwardToApp(msg) {
  if (!appSocket) {
    connectToApp(() => forwardToApp(msg));
    return;
  }
  try {
    appSocket.write(JSON.stringify(msg) + '\n');
  } catch (_) {
    appSocket = null;
    connectToApp(() => forwardToApp(msg));
  }
}

// ─── TCP connection to Electron app ──────────────────────────────────────────

function connectToApp(onConnected) {
  if (reconnecting) {
    if (onConnected) setTimeout(() => forwardToApp, 100); // retry after connect
    return;
  }
  reconnecting = true;

  const socket = net.connect(TCP_PORT, TCP_HOST, () => {
    appSocket = socket;
    reconnecting = false;
    if (onConnected) onConnected();
  });

  let tcpBuf = '';

  socket.on('data', (chunk) => {
    // Messages from Electron → Chrome (e.g. status pings)
    tcpBuf += chunk.toString('utf8');
    const lines = tcpBuf.split('\n');
    tcpBuf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        sendToChrome(JSON.parse(line));
      } catch (_) {}
    }
  });

  socket.on('error', () => {});

  socket.on('close', () => {
    appSocket = null;
    reconnecting = false;
    setTimeout(connectToApp, RECONNECT_DELAY);
  });
}

// ─── stdout → Chrome native message ──────────────────────────────────────────

function sendToChrome(msg) {
  const json = JSON.stringify(msg);
  const jsonBuf = Buffer.from(json, 'utf8');
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32LE(jsonBuf.length, 0);
  process.stdout.write(Buffer.concat([lenBuf, jsonBuf]));
}

// ─── Start ────────────────────────────────────────────────────────────────────

connectToApp();

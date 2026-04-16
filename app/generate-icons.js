/**
 * generate-icons.js
 * Generates icon16.png, icon48.png, icon128.png for the Chrome extension.
 * No dependencies — uses only Node.js built-in zlib + fs.
 *
 * Usage:  node generate-icons.js
 * Output: ../extension/icons/icon16.png  icon48.png  icon128.png
 */

'use strict';

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'extension', 'icons');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ─── PNG writer ────────────────────────────────────────────────────────────────

// CRC-32 table
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const body    = Buffer.concat([typeBuf, data]);
  const lenBuf  = Buffer.allocUnsafe(4); lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf  = Buffer.allocUnsafe(4); crcBuf.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/**
 * Encode RGBA pixel array to a PNG Buffer.
 * @param {number} w
 * @param {number} h
 * @param {Uint8Array} rgba  - flat RGBA array, row-major
 */
function encodePNG(w, h, rgba) {
  // Build raw scanlines with filter byte 0 (None) prepended to each row
  const raw = Buffer.allocUnsafe(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter: None
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const di = y * (1 + w * 4) + 1 + x * 4;
      raw[di]     = rgba[si];
      raw[di + 1] = rgba[si + 1];
      raw[di + 2] = rgba[si + 2];
      raw[di + 3] = rgba[si + 3];
    }
  }

  const idat = zlib.deflateSync(raw, { level: 9 });

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8]  = 8; // bit depth
  ihdr[9]  = 6; // color type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Pixel drawing helpers ─────────────────────────────────────────────────────

function makeCanvas(w, h) {
  const data = new Uint8Array(w * h * 4); // all transparent
  return {
    data,
    setPixel(x, y, r, g, b, a = 255) {
      if (x < 0 || x >= w || y < 0 || y >= h) return;
      const i = (y * w + x) * 4;
      // Simple alpha blending over existing pixel
      const sa = a / 255;
      const da = data[i + 3] / 255;
      const oa = sa + da * (1 - sa);
      if (oa === 0) return;
      data[i]     = Math.round((r * sa + data[i]     * da * (1 - sa)) / oa);
      data[i + 1] = Math.round((g * sa + data[i + 1] * da * (1 - sa)) / oa);
      data[i + 2] = Math.round((b * sa + data[i + 2] * da * (1 - sa)) / oa);
      data[i + 3] = Math.round(oa * 255);
    },
  };
}

function fillRoundRect(canvas, w, x1, y1, x2, y2, radius, r, g, b, a = 255) {
  for (let py = y1; py < y2; py++) {
    for (let px = x1; px < x2; px++) {
      // Check each corner quadrant
      let inside = true;
      if (px < x1 + radius && py < y1 + radius) {
        const dx = px - (x1 + radius), dy = py - (y1 + radius);
        inside = dx * dx + dy * dy <= radius * radius;
      } else if (px >= x2 - radius && py < y1 + radius) {
        const dx = px - (x2 - 1 - radius), dy = py - (y1 + radius);
        inside = dx * dx + dy * dy <= radius * radius;
      } else if (px < x1 + radius && py >= y2 - radius) {
        const dx = px - (x1 + radius), dy = py - (y2 - 1 - radius);
        inside = dx * dx + dy * dy <= radius * radius;
      } else if (px >= x2 - radius && py >= y2 - radius) {
        const dx = px - (x2 - 1 - radius), dy = py - (y2 - 1 - radius);
        inside = dx * dx + dy * dy <= radius * radius;
      }
      if (inside) canvas.setPixel(px, py, r, g, b, a);
    }
  }
}

function fillRect(canvas, x1, y1, x2, y2, r, g, b, a = 255) {
  for (let py = y1; py < y2; py++)
    for (let px = x1; px < x2; px++)
      canvas.setPixel(px, py, r, g, b, a);
}

// ─── Icon drawing ──────────────────────────────────────────────────────────────

function drawIcon(size) {
  const cv = makeCanvas(size, size);
  const s  = size;

  // ── Orange rounded background ──
  const rad = Math.round(s * 0.20);
  fillRoundRect(cv, s, 0, 0, s, s, rad, 243, 101, 0);

  // ── Piano keys ──
  // We draw 4 white keys + 3 black keys between them
  const numW   = 4;
  const kW     = Math.max(2, Math.round(s * 0.125));
  const kGap   = Math.max(1, Math.round(s * 0.025));
  const kH     = Math.round(s * 0.52);
  const totalW = numW * kW + (numW - 1) * kGap;
  const kX0    = Math.round((s - totalW) / 2);
  const kY0    = Math.round(s * 0.26);

  // White keys (rounded bottom)
  for (let i = 0; i < numW; i++) {
    const x = kX0 + i * (kW + kGap);
    const br = Math.max(1, Math.round(kW * 0.25));
    fillRoundRect(cv, s, x, kY0, x + kW, kY0 + kH, br, 255, 255, 255);
  }

  // Black keys (drawn over white, orange-ish tone so they read as cut-outs)
  const bkW  = Math.max(2, Math.round(kW * 0.65));
  const bkH  = Math.round(kH * 0.58);
  const bkBR = Math.max(1, Math.round(bkW * 0.25));
  const BG_R = 220, BG_G = 88, BG_B = 0; // slightly darker orange

  for (let i = 0; i < numW - 1; i++) {
    const bkX = kX0 + i * (kW + kGap) + kW - Math.round(bkW / 2);
    fillRoundRect(cv, s, bkX, kY0, bkX + bkW, kY0 + bkH, bkBR, BG_R, BG_G, BG_B);
  }

  return cv;
}

// ─── Generate & save ──────────────────────────────────────────────────────────

for (const size of [16, 48, 128]) {
  const cv  = drawIcon(size);
  const png = encodePNG(size, size, cv.data);
  const out = path.join(OUT_DIR, `icon${size}.png`);
  fs.writeFileSync(out, png);
  console.log(`  Created: ${out}  (${png.length} bytes)`);
}

console.log('\nDone! Icons saved to extension/icons/');

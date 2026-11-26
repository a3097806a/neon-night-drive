'use strict';
// 產生自製 App 圖示（PNG）。不依賴外部套件：自行繪製像素並以 zlib 編碼 PNG。
// 用法：node tools/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public', 'icons');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
// 距離函式（座標以 0..1 正規化，原點左上）
const sdBox = (x, y, cx, cy, hw, hh, r) => {
  const dx = Math.abs(x - cx) - hw + r, dy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
};
const sdSeg = (x, y, ax, ay, bx, by) => {
  const px = x - ax, py = y - ay, dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - dx * t, py - dy * t);
};
// 車身（菱形楔形）：以多邊形內外判斷
function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function shade(x, y, maskable) {
  // 可遮罩圖示：內容縮在安全區（80%）內，背景鋪滿
  const s = maskable ? 0.78 : 1, ox = (1 - s) / 2;
  const u = (x - ox) / s, v = (y - ox) / s;
  const bgTop = hex('#1a0838'), bgBot = hex('#05030d');
  let col = mix(bgTop, bgBot, y), a = 1;
  if (!maskable && sdBox(x, y, 0.5, 0.5, 0.5, 0.5, 0.19) > 0) a = 0;
  // 霓虹路邊線
  const dl = Math.min(sdSeg(u, v, 0.23, 0.92, 0.45, 0.12), sdSeg(u, v, 0.77, 0.92, 0.55, 0.12));
  if (dl < 0.014) col = hex('#ff2fd6');
  else if (dl < 0.05) col = mix(col, hex('#ff2fd6'), (0.05 - dl) / 0.036 * 0.45);
  // 黃色中線
  for (const [y0, y1] of [[0.74, 0.86], [0.54, 0.64], [0.4, 0.46], [0.3, 0.33]]) if (sdSeg(u, v, 0.5, y0, 0.5, y1) < 0.01) col = hex('#ffe14a');
  // 車
  const car = [[0.5, 0.405], [0.586, 0.484], [0.598, 0.72], [0.574, 0.765], [0.426, 0.765], [0.402, 0.72], [0.414, 0.484]];
  const inCar = inPoly(u, v, car);
  let edge = Infinity;
  for (let i = 0; i < car.length; i++) { const p = car[i], q = car[(i + 1) % car.length]; edge = Math.min(edge, sdSeg(u, v, p[0], p[1], q[0], q[1])); }
  if (!inCar && edge < 0.05) col = mix(col, hex('#2ff3ff'), (0.05 - edge) / 0.05 * 0.5);
  if (inCar) {
    col = hex('#0b1a2e');
    if (sdBox(u, v, 0.5, 0.596, 0.05, 0.045, 0.01) < 0) col = hex('#ff2fd6');
    if (sdBox(u, v, 0.5, 0.52, 0.058, 0.014, 0.005) < 0) col = hex('#99ffff');
    if (sdBox(u, v, 0.437, 0.426, 0.018, 0.01, 0) < 0 || sdBox(u, v, 0.563, 0.426, 0.018, 0.01, 0) < 0) col = hex('#ffe14a');
    if (sdBox(u, v, 0.437, 0.748, 0.022, 0.008, 0) < 0 || sdBox(u, v, 0.563, 0.748, 0.022, 0.008, 0) < 0) col = hex('#ff2030');
  }
  if (edge < 0.01) col = mix(hex('#2ff3ff'), hex('#ff2fd6'), (u - 0.4) / 0.2);
  return [col[0], col[1], col[2], a];
}

function render(size, maskable) {
  const buf = Buffer.alloc(size * size * 4), SS = 3;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const c = shade((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, maskable);
      r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
    }
    const i = (py * size + px) * 4, n = SS * SS;
    buf[i] = a ? r / a : 0; buf[i + 1] = a ? g / a : 0; buf[i + 2] = a ? b / a : 0; buf[i + 3] = Math.round(a / n * 255);
  }
  return png(size, size, buf);
}

fs.mkdirSync(OUT, { recursive: true });
const jobs = [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true], ['icon-1024.png', 1024, true]];
for (const [name, size, mask] of jobs) {
  fs.writeFileSync(path.join(OUT, name), render(size, mask));
  console.log('已產生', name);
}

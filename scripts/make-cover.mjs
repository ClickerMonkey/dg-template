/**
 * Generates cover.png — the catalog tile — with no image deps.
 * Draws a small neon "reactor" scene (cores + charged coolant cells) using a
 * tiny software rasterizer and a hand-rolled PNG encoder (node zlib only).
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const W = 640, H = 400;
const buf = new Uint8Array(W * H * 3);

function set(x, y, r, g, b, a = 1) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = buf[i] * (1 - a) + r * a;
  buf[i + 1] = buf[i + 1] * (1 - a) + g * a;
  buf[i + 2] = buf[i + 2] * (1 - a) + b * a;
}
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

function fillRoundRect(x, y, w, h, rad, col, a = 1) {
  const [r, g, b] = hex(col);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const dx = Math.min(xx, w - 1 - xx), dy = Math.min(yy, h - 1 - yy);
    if (dx < rad && dy < rad) { const ex = rad - dx, ey = rad - dy; if (ex * ex + ey * ey > rad * rad) continue; }
    set(x + xx, y + yy, r, g, b, a);
  }
}
function strokeRoundRect(x, y, w, h, rad, col, t, a = 1) {
  for (let k = 0; k < t; k++) {
    const [r, g, b] = hex(col);
    const inset = k;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const onEdge = xx === inset || xx === w - 1 - inset || yy === inset || yy === h - 1 - inset;
      if (!onEdge) continue;
      const dx = Math.min(xx, w - 1 - xx), dy = Math.min(yy, h - 1 - yy);
      if (dx < rad && dy < rad) { const ex = rad - dx, ey = rad - dy; if (ex * ex + ey * ey > rad * rad) continue; }
      set(x + xx, y + yy, r, g, b, a);
    }
  }
}
function disc(cx, cy, rad, col, a = 1) {
  const [r, g, b] = hex(col);
  for (let yy = -rad; yy <= rad; yy++) for (let xx = -rad; xx <= rad; xx++)
    if (xx * xx + yy * yy <= rad * rad) set(cx + xx, cy + yy, r, g, b, a);
}
function ring(cx, cy, rad, col, t, a = 1) {
  const [r, g, b] = hex(col);
  for (let yy = -rad - t; yy <= rad + t; yy++) for (let xx = -rad - t; xx <= rad + t; xx++) {
    const d = Math.sqrt(xx * xx + yy * yy);
    if (d >= rad - t && d <= rad) set(cx + xx, cy + yy, r, g, b, a);
  }
}
function line(x1, y1, x2, y2, col, t, a = 1) {
  const [r, g, b] = hex(col);
  const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
  for (let i = 0; i <= n; i++) {
    const x = x1 + (x2 - x1) * i / n, y = y1 + (y2 - y1) * i / n;
    for (let oy = -t; oy <= t; oy++) for (let ox = -t; ox <= t; ox++) set(x + ox, y + oy, r, g, b, a);
  }
}

// --- background gradient -----------------------------------------------------
for (let y = 0; y < H; y++) {
  const t = y / H;
  const r = 5 + 5 * t, g = 7 + 12 * t, b = 13 + 22 * t;
  for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; }
}

const HOT = 0xff6a3d, COLD = 0x34c6ff;
const ACC = [0xff5d5d, 0xffd24d, 0x4dd2ff, 0xb779ff];

// faint conduit rails
for (let c = 0; c < 5; c++) {
  const x = 70 + c * 110;
  fillRoundRect(x - 6, 150, 92, 230, 14, 0x0a1322, 0.6);
}

function glyph(el, cx, cy, r, col) {
  if (el === 0) { disc(cx, cy + r * 0.2, r * 0.5, col, 0.95); line(cx, cy - r, cx - r * 0.6, cy + r * 0.4, col, 1, .9); line(cx, cy - r, cx + r * 0.6, cy + r * 0.4, col, 1, .9); }
  else if (el === 1) { disc(cx, cy, r * 0.5, col, 0.95); for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283; line(cx + Math.cos(a) * r * 0.65, cy + Math.sin(a) * r * 0.65, cx + Math.cos(a) * r, cy + Math.sin(a) * r, col, 1, .9); } }
  else if (el === 2) { for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283; line(cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r, col, 1, .9); } }
  else { for (let i = 0; i < 4; i++) { const a = i / 4 * 6.283; line(cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r, col, 1, .9); } }
}

// a charged cell
function cell(x, y, el, rank, hot) {
  const w = 76, h = 104, pol = hot ? HOT : COLD;
  fillRoundRect(x - 3, y - 3, w + 6, h + 6, 12, pol, 0.12);
  fillRoundRect(x, y, w, h, 10, 0x0b1a2e, 1);
  fillRoundRect(x, y, w, h, 10, hot ? 0x5a2418 : 0x123246, 0.35);
  strokeRoundRect(x, y, w, h, 10, pol, 3, 0.95);
  // charge bar
  const segs = 13, gh = h - 22, sh = gh / segs;
  for (let i = 0; i < segs; i++) fillRoundRect(x + 9, y + h - 11 - (i + 1) * sh + 2, 9, sh - 3, 2, i < rank ? pol : 0x14233b, i < rank ? 0.95 : 0.6);
  glyph(el, x + w * 0.66, y + h * 0.3, 13, ACC[el]);
}

// reactor cores along the top
const coreY = 78;
for (let i = 0; i < 4; i++) {
  const cx = 200 + i * 90;
  disc(cx, coreY, 30, ACC[i], 0.16);
  ring(cx, coreY, 26, ACC[i], 3, 0.9);
  glyph(i, cx, coreY, 14, ACC[i]);
}

// a cascade of coolant cells (descending charge, alternating polarity)
cell(70, 170, 0, 12, true);
cell(70, 210, 2, 11, false);
cell(70, 250, 1, 10, true);
cell(300, 200, 3, 8, false);
cell(300, 240, 0, 7, true);
cell(430, 230, 2, 6, false);
cell(180, 260, 1, 4, true);
cell(520, 180, 3, 13, false);

// --- encode PNG --------------------------------------------------------------
function crc32(b) { let c = ~0; for (let i = 0; i < b.length; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; for (let x = 0; x < W * 3; x++) raw[y * (W * 3 + 1) + 1 + x] = buf[y * W * 3 + x]; }
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../cover.png', import.meta.url), png);
console.log('wrote cover.png', png.length, 'bytes');

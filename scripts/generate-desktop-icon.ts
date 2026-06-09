import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { deflateSync } from "node:zlib";

const out = "src-tauri/icons/source-1024.png";
const size = 1024;
const data = Buffer.alloc((size * 4 + 1) * size);

function crc32(buf: Buffer): number {
  let crc = -1;
  for (const b of buf) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type: string, payload: Buffer): Buffer {
  const name = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(payload.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, payload])), 0);
  return Buffer.concat([len, name, payload, crc]);
}

function rgbaAt(x: number, y: number, rgba: [number, number, number, number]) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const row = y * (size * 4 + 1);
  const i = row + 1 + x * 4;
  data[i] = rgba[0];
  data[i + 1] = rgba[1];
  data[i + 2] = rgba[2];
  data[i + 3] = rgba[3];
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function roundedRectMask(x: number, y: number, w: number, h: number, r: number): boolean {
  const dx = Math.max(x - w / 2 + r, 0, w / 2 - r - x);
  const dy = Math.max(y - h / 2 + r, 0, h / 2 - r - y);
  return dx * dx + dy * dy <= r * r;
}

function polygonContains(px: number, py: number, pts: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    const crosses = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function drawRoundedRect(cx: number, cy: number, w: number, h: number, r: number, color: [number, number, number, number]) {
  const x0 = Math.floor(cx - w / 2);
  const x1 = Math.ceil(cx + w / 2);
  const y0 = Math.floor(cy - h / 2);
  const y1 = Math.ceil(cy + h / 2);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (roundedRectMask(x - cx, y - cy, w, h, r)) rgbaAt(x, y, color);
    }
  }
}

function drawPolygon(pts: Array<[number, number]>, color: [number, number, number, number]) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
    for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
      if (polygonContains(x + 0.5, y + 0.5, pts)) rgbaAt(x, y, color);
    }
  }
}

function drawLine(x0: number, y0: number, x1: number, y1: number, width: number, color: [number, number, number, number]) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const r = width / 2;
  const minX = Math.floor(Math.min(x0, x1) - r);
  const maxX = Math.ceil(Math.max(x0, x1) + r);
  const minY = Math.floor(Math.min(y0, y1) - r);
  const maxY = Math.ceil(Math.max(y0, y1) + r);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
      const px = x0 + t * dx;
      const py = y0 + t * dy;
      if ((x - px) ** 2 + (y - py) ** 2 <= r * r) rgbaAt(x, y, color);
    }
  }
}

for (let y = 0; y < size; y++) {
  data[y * (size * 4 + 1)] = 0;
  for (let x = 0; x < size; x++) {
    const nx = x / (size - 1);
    const ny = y / (size - 1);
    const dx = nx - 0.5;
    const dy = ny - 0.5;
    const radial = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 1.35);
    const base = mix([18, 31, 38], [38, 64, 69], radial);
    rgbaAt(x, y, [base[0], base[1], base[2], 255]);
  }
}

const gold: [number, number, number, number] = [221, 177, 85, 255];
const lightGold: [number, number, number, number] = [246, 220, 151, 255];
const ink: [number, number, number, number] = [20, 31, 36, 255];

drawRoundedRect(512, 512, 770, 770, 130, [8, 15, 19, 64]);
drawRoundedRect(512, 610, 590, 260, 58, [232, 226, 207, 255]);
drawRoundedRect(512, 620, 536, 202, 38, [36, 52, 57, 255]);
drawLine(512, 505, 512, 735, 18, gold);
drawLine(330, 570, 485, 530, 22, lightGold);
drawLine(694, 570, 539, 530, 22, lightGold);
drawLine(330, 650, 485, 612, 18, [213, 190, 128, 255]);
drawLine(694, 650, 539, 612, 18, [213, 190, 128, 255]);

drawPolygon(
  [
    [278, 394],
    [354, 236],
    [456, 358],
    [512, 196],
    [568, 358],
    [670, 236],
    [746, 394],
    [704, 452],
    [320, 452],
  ],
  gold,
);
drawPolygon(
  [
    [340, 416],
    [384, 322],
    [462, 416],
  ],
  lightGold,
);
drawPolygon(
  [
    [562, 416],
    [640, 322],
    [684, 416],
  ],
  lightGold,
);
drawRoundedRect(512, 468, 456, 70, 22, gold);
drawRoundedRect(512, 468, 370, 28, 14, lightGold);

drawLine(376, 788, 648, 788, 28, gold);
drawLine(420, 832, 604, 832, 18, [184, 144, 69, 255]);
drawRoundedRect(512, 612, 88, 166, 16, ink);
drawRoundedRect(512, 612, 44, 122, 9, gold);

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", (() => {
    const b = Buffer.alloc(13);
    b.writeUInt32BE(size, 0);
    b.writeUInt32BE(size, 4);
    b[8] = 8;
    b[9] = 6;
    return b;
  })()),
  chunk("IDAT", deflateSync(data, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`Generated ${out} (${size}x${size})`);

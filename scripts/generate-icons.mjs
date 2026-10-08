// Generates PWA PNG icons from the nexQ Deposit logo, zero dependencies (Node zlib).
// Decodes public/logo-nexq.png and composites it (scaled + centered) onto a
// square brand-dark tile. The favicon uses only the gradient Q (too small for the wordmark). Output: public/icon-192.png, icon-512.png,
// apple-touch-icon.png, favicon.png
import { deflateSync, inflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public");
const LOGO = join(OUT, "logo-nexq.png");
const BG = [0x16, 0x17, 0x1a, 0xff]; // brand-dark canvas, opaque

// --- minimal PNG decode (8-bit RGBA, non-interlaced) ---
function decodePNG(buf) {
  let pos = 8; // skip signature
  let width = 0, height = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (colorType !== 6) throw new Error("logo must be RGBA (color type 6)");
  const raw = inflateSync(Buffer.concat(idat));
  const channels = 4;
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const rowIn = y * (stride + 1) + 1;
    const rowOut = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[rowIn + i];
      const a = i >= channels ? out[rowOut + i - channels] : 0;
      const b = y > 0 ? out[rowOut - stride + i] : 0;
      const c = y > 0 && i >= channels ? out[rowOut - stride + i - channels] : 0;
      let val;
      switch (filter) {
        case 0: val = x; break;
        case 1: val = x + a; break;
        case 2: val = x + b; break;
        case 3: val = x + ((a + b) >> 1); break;
        case 4: val = x + paeth(a, b, c); break;
        default: val = x;
      }
      out[rowOut + i] = val & 0xff;
    }
  }
  return { width, height, rgba: out };
}

// --- crop a horizontal slice [x0, x1) of the logo ---
function cropX(img, x0, x1) {
  const w = x1 - x0;
  const rgba = Buffer.alloc(w * img.height * 4);
  for (let y = 0; y < img.height; y++) {
    img.rgba.copy(rgba, y * w * 4, (y * img.width + x0) * 4, (y * img.width + x1) * 4);
  }
  return { width: w, height: img.height, rgba };
}

// --- composite logo centered on a square tile, nearest-neighbor scaled ---
function makeIcon(logo, size, widthFraction = 0.78) {
  const canvas = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) canvas.set(BG, i * 4);

  const boxW = Math.round(size * widthFraction);
  const boxH = Math.round((boxW * logo.height) / logo.width);
  const offX = Math.floor((size - boxW) / 2);
  const offY = Math.floor((size - boxH) / 2);

  for (let dy = 0; dy < boxH; dy++) {
    const sy = Math.min(logo.height - 1, Math.floor((dy * logo.height) / boxH));
    for (let dx = 0; dx < boxW; dx++) {
      const sx = Math.min(logo.width - 1, Math.floor((dx * logo.width) / boxW));
      const s = (sy * logo.width + sx) * 4;
      const a = logo.rgba[s + 3] / 255;
      if (a === 0) continue;
      const di = ((offY + dy) * size + (offX + dx)) * 4;
      for (let ch = 0; ch < 3; ch++) {
        canvas[di + ch] = Math.round(logo.rgba[s + ch] * a + canvas[di + ch] * (1 - a));
      }
      canvas[di + 3] = 255;
    }
  }
  return canvas;
}

// --- PNG encode (RGBA) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = deflateSync(raw);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const logo = decodePNG(readFileSync(LOGO));
const qMark = cropX(logo, 1230, 1740); // the gradient Q in logo-nexq.png
const targets = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "apple-touch-icon.png", size: 180 },
  { file: "favicon.png", size: 32, widthFraction: 0.8, src: qMark },
];
for (const t of targets) {
  const png = encodePNG(t.size, makeIcon(t.src ?? logo, t.size, t.widthFraction));
  writeFileSync(join(OUT, t.file), png);
  console.log(`wrote public/${t.file} (${t.size}x${t.size}, ${png.length} bytes)`);
}

// Minimal PNG reader and writer for the asset pipeline (Node built-ins only: node:zlib). OWNER: Asset engineer.
//
// The build tool decodes the PNG files it ships to measure them (alpha bounding box, body circles, luminance), so it needs a decoder that
// does not depend on ffmpeg or on any npm package. The decoder handles every non-interlaced PNG colour type and bit depth of 8 or 16 and
// always returns straight (non-premultiplied) RGBA with 8 bits per channel. The encoder writes plain 8-bit RGBA (used only for the
// debug overlay sheets, never for a shipped file: shipped files are encoded by ffmpeg).

import zlib from 'node:zlib';

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Read only the IHDR of a PNG buffer. Throws a clear error for anything that is not a PNG. */
export function readPngHeader(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG file (bad signature)');
  if (buf.toString('ascii', 12, 16) !== 'IHDR') throw new Error('PNG without an IHDR chunk');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType: buf[25],
    interlace: buf[28],
  };
}

/** Read the width and height of a baseline or progressive JPEG (the SOF marker). */
export function readJpegSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG file (bad signature)');
  let p = 2;
  while (p + 9 < buf.length) {
    if (buf[p] !== 0xff) {
      p += 1;
      continue;
    }
    const marker = buf[p + 1];
    if (marker === 0xff) {
      p += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      p += 2;
      continue;
    }
    const len = buf.readUInt16BE(p + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { width: buf.readUInt16BE(p + 7), height: buf.readUInt16BE(p + 5), progressive: marker === 0xc2, components: buf[p + 9] };
    p += 2 + len;
  }
  throw new Error('JPEG without a start-of-frame marker');
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Decode a non-interlaced PNG to straight RGBA, 8 bits per channel.
 * @param {Buffer} buf
 * @returns {{width:number, height:number, data:Uint8Array, hasAlpha:boolean}} `data` is width * height * 4 bytes.
 */
export function decodePng(buf) {
  const head = readPngHeader(buf);
  const { width, height, bitDepth, colorType } = head;
  if (head.interlace !== 0) throw new Error('interlaced PNG files are not supported (re-export without Adam7 interlacing)');
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`unsupported PNG colour type ${colorType}`);
  if (![1, 2, 4, 8, 16].includes(bitDepth)) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  if (width < 1 || height < 1 || width * height > 200_000_000) throw new Error(`implausible PNG size ${width}x${height}`);

  const idat = [];
  let palette = null;
  let trns = null;
  let p = 8;
  while (p + 12 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IDAT') idat.push(body);
    else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (idat.length === 0) throw new Error('PNG without image data');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bitsPerPixel = channels * bitDepth;
  const bpp = Math.max(1, bitsPerPixel >> 3); // bytes per pixel for the filter (at least 1)
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  if (raw.length < (stride + 1) * height) throw new Error('PNG image data is truncated');

  // Unfilter in place into a compact buffer of rows.
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const up = dst - stride;
    if (filter === 0) {
      raw.copy(rows, dst, src, src + stride);
    } else if (filter === 1) {
      for (let x = 0; x < stride; x++) rows[dst + x] = (raw[src + x] + (x >= bpp ? rows[dst + x - bpp] : 0)) & 255;
    } else if (filter === 2) {
      for (let x = 0; x < stride; x++) rows[dst + x] = (raw[src + x] + (y > 0 ? rows[up + x] : 0)) & 255;
    } else if (filter === 3) {
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? rows[dst + x - bpp] : 0;
        const b = y > 0 ? rows[up + x] : 0;
        rows[dst + x] = (raw[src + x] + ((a + b) >> 1)) & 255;
      }
    } else if (filter === 4) {
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? rows[dst + x - bpp] : 0;
        const b = y > 0 ? rows[up + x] : 0;
        const c = x >= bpp && y > 0 ? rows[up + x - bpp] : 0;
        rows[dst + x] = (raw[src + x] + paeth(a, b, c)) & 255;
      }
    } else {
      throw new Error(`bad PNG filter type ${filter} on row ${y}`);
    }
  }

  const out = new Uint8Array(width * height * 4);
  if (bitDepth === 8 && colorType === 6) return { width, height, data: new Uint8Array(rows.buffer, rows.byteOffset, rows.length), hasAlpha: true }; // the shipped case
  if (bitDepth === 8 && colorType === 2 && trns === null) {
    for (let i = 0, j = 0; i < rows.length; i += 3, j += 4) {
      out[j] = rows[i];
      out[j + 1] = rows[i + 1];
      out[j + 2] = rows[i + 2];
      out[j + 3] = 255;
    }
    return { width, height, data: out, hasAlpha: false };
  }
  let hasAlpha =colorType === 4 || colorType === 6 || (colorType === 3 && trns !== null) || ((colorType === 0 || colorType === 2) && trns !== null);
  const sample = (rowStart, index) => {
    // The index-th sample (channel value) of the row, scaled to 8 bits (except palette indices, which stay raw).
    if (bitDepth === 8) return rows[rowStart + index];
    if (bitDepth === 16) return rows[rowStart + index * 2];
    const perByte = 8 / bitDepth;
    const byte = rows[rowStart + Math.floor(index / perByte)];
    const shift = 8 - bitDepth * ((index % perByte) + 1);
    return (byte >> shift) & ((1 << bitDepth) - 1);
  };
  const scaleUp = (v) => (bitDepth >= 8 ? v : Math.round((v * 255) / ((1 << bitDepth) - 1)));
  const trns16 = trns && trns.length >= 2 ? trns : null;
  for (let y = 0; y < height; y++) {
    const rs = y * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 6) {
        out[o] = sample(rs, x * 4);
        out[o + 1] = sample(rs, x * 4 + 1);
        out[o + 2] = sample(rs, x * 4 + 2);
        out[o + 3] = sample(rs, x * 4 + 3);
      } else if (colorType === 2) {
        out[o] = sample(rs, x * 3);
        out[o + 1] = sample(rs, x * 3 + 1);
        out[o + 2] = sample(rs, x * 3 + 2);
        out[o + 3] = 255;
        if (trns16 && bitDepth === 8 && trns16.length >= 6 && out[o] === trns16[1] && out[o + 1] === trns16[3] && out[o + 2] === trns16[5]) out[o + 3] = 0;
      } else if (colorType === 0) {
        const g = scaleUp(sample(rs, x));
        out[o] = g;
        out[o + 1] = g;
        out[o + 2] = g;
        out[o + 3] = 255;
      } else if (colorType === 4) {
        const g = sample(rs, x * 2);
        out[o] = g;
        out[o + 1] = g;
        out[o + 2] = g;
        out[o + 3] = sample(rs, x * 2 + 1);
      } else {
        const idx = sample(rs, x);
        if (!palette || idx * 3 + 2 >= palette.length) throw new Error('PNG palette index out of range');
        out[o] = palette[idx * 3];
        out[o + 1] = palette[idx * 3 + 1];
        out[o + 2] = palette[idx * 3 + 2];
        out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      }
    }
  }
  if (colorType === 0 && trns === null) hasAlpha = false;
  return { width, height, data: out, hasAlpha };
}

// CRC-32 (PNG chunks).
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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * Encode 8-bit RGBA to PNG (filter 0 rows, zlib level 6). Used for debug sheets only.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba width * height * 4 bytes
 */
export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

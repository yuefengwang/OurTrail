'use strict';
/**
 * Minimal PNG codec (decode + encode) built on Node's zlib.
 *
 * Why hand-rolled: the target repository forbids adding npm dependencies, and the
 * suite must stay portable. Supported on decode: bit depth 8 and 16, colour types
 * 0 (gray), 2 (RGB), 3 (palette), 4 (gray+alpha), 6 (RGBA), non-interlaced.
 * Output is always 8-bit RGBA. On encode: 8-bit RGBA, filter 0.
 *
 * Anything outside the supported subset throws a PfError with code PNG_UNSUPPORTED
 * — callers must surface that as BLOCKED, never guess pixels.
 */
const zlib = require('zlib');
const { PfError } = require('./util');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c >>> 0;
  }
  return CRC_TABLE;
}

function crc32(buf) {
  const table = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decode(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) {
    throw new PfError('PNG_INVALID', 'not a PNG (bad signature)');
  }
  let pos = 8;
  let ihdr = null;
  let palette = null;
  let trns = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (data.length !== len) throw new PfError('PNG_INVALID', 'truncated chunk ' + type);
    if (pos + 12 + len <= buf.length) {
      const want = buf.readUInt32BE(pos + 8 + len);
      const got = crc32(buf.subarray(pos + 4, pos + 8 + len));
      // A flipped byte inside a filtered row would otherwise decode into
      // plausible-looking pixels: evidence integrity depends on this check.
      if (want !== got) throw new PfError('PNG_INVALID', `bad CRC on chunk ${type}`);
    }
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === 'PLTE') {
      palette = Buffer.from(data);
    } else if (type === 'tRNS') {
      trns = Buffer.from(data);
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (!ihdr) throw new PfError('PNG_INVALID', 'missing IHDR');
  if (ihdr.interlace !== 0) throw new PfError('PNG_UNSUPPORTED', 'interlaced PNG is not supported');
  if (ihdr.compression !== 0 || ihdr.filter !== 0) throw new PfError('PNG_UNSUPPORTED', 'unknown compression/filter method');
  if (![8, 16].includes(ihdr.bitDepth)) throw new PfError('PNG_UNSUPPORTED', 'bit depth ' + ihdr.bitDepth + ' is not supported');
  if (ihdr.colorType === 3 && !palette) throw new PfError('PNG_INVALID', 'palette PNG without PLTE');

  const channelsOf = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelsOf[ihdr.colorType];
  if (!channels) throw new PfError('PNG_UNSUPPORTED', 'colour type ' + ihdr.colorType + ' is not supported');

  const { width, height, bitDepth } = ihdr;
  const bytesPerSample = bitDepth / 8;
  const bpp = channels * bytesPerSample;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const expected = (stride + 1) * height;
  if (raw.length < expected) throw new PfError('PNG_INVALID', 'IDAT shorter than expected');

  const out = new Uint8Array(width * height * 4);
  // Buffers, not Uint8Arrays: `sample()` reads 16-bit samples with
  // readUInt16BE, which a Uint8Array does not have.
  let prev = Buffer.alloc(stride);
  let cur = Buffer.alloc(stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    raw.copy(cur, 0, rp, rp + stride);
    rp += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = cur[i];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: v = (v + paeth(a, b, c)) & 0xff; break;
        default: throw new PfError('PNG_INVALID', 'bad filter type ' + filter + ' on row ' + y);
      }
      cur[i] = v;
    }
    // expand to RGBA
    let o = y * width * 4;
    for (let x = 0; x < width; x++) {
      let r, g, bl, al = 255;
      if (ihdr.colorType === 0) {
        const s = sample(cur, x, bitDepth, 1, 0);
        r = g = bl = s;
        if (trns && trns.length >= 2 && s === trns.readUInt16BE(0)) al = 0;
      } else if (ihdr.colorType === 4) {
        // gray+alpha is interleaved: both samples advance by 2 channels, not 1.
        r = g = bl = sample(cur, x, bitDepth, 2, 0);
        al = sample(cur, x, bitDepth, 2, 1);
      } else if (ihdr.colorType === 2) {
        r = sample(cur, x, bitDepth, 3, 0);
        g = sample(cur, x, bitDepth, 3, 1);
        bl = sample(cur, x, bitDepth, 3, 2);
        if (trns && trns.length >= 6) {
          const tr = trns.readUInt16BE(0), tg = trns.readUInt16BE(2), tb = trns.readUInt16BE(4);
          if (r === tr && g === tg && bl === tb) al = 0;
        }
      } else if (ihdr.colorType === 6) {
        r = sample(cur, x, bitDepth, 4, 0);
        g = sample(cur, x, bitDepth, 4, 1);
        bl = sample(cur, x, bitDepth, 4, 2);
        al = sample(cur, x, bitDepth, 4, 3);
      } else { // palette
        const idx = bitDepth === 8 ? cur[x] : cur[x];
        r = palette[idx * 3] || 0;
        g = palette[idx * 3 + 1] || 0;
        bl = palette[idx * 3 + 2] || 0;
        if (trns && idx < trns.length) al = trns[idx];
      }
      out[o++] = r; out[o++] = g; out[o++] = bl; out[o++] = al;
    }
    const tmp = prev; prev = cur; cur = tmp;
  }
  return { width, height, data: out };
}

function sample(row, x, bitDepth, channels, channel) {
  if (bitDepth === 8) return row[x * channels + channel];
  return row.readUInt16BE((x * channels + channel) * 2) >>> 8;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encode(width, height, rgba) {
  if (rgba.length !== width * height * 4) {
    throw new PfError('PNG_ENCODE', 'pixel buffer size mismatch');
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function writeFile(file, widthOrImage, height, rgba) {
  const img = typeof widthOrImage === 'object' && widthOrImage !== null
    ? widthOrImage
    : { width: widthOrImage, height, data: rgba };
  require('fs').writeFileSync(file, encode(img.width, img.height, img.data));
  return file;
}

function readFile(file) {
  return decode(require('fs').readFileSync(file));
}

module.exports = { decode, encode, writeFile, readFile, crc32, SIGNATURE };

'use strict';
/**
 * PNG codec tests.
 *
 * The decoder is the one component where a silent bug corrupts *evidence*
 * instead of throwing, so the cases here are chosen around what real capture
 * pipelines emit: all five filter types, 16-bit samples, palette + tRNS, and a
 * corrupted CRC (which must fail closed rather than decode plausible pixels).
 */
const zlib = require('zlib');
const fs = require('fs');
const os = require('os');
const path = require('path');
const png = require('../core/lib/png');
const image = require('../core/lib/image');
const { check, eq, section, finish } = require('./harness');

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(png.crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function buildPng({ width, height, colorType, bitDepth, rows, palette, trns, filterOfRow }) {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const bps = bitDepth / 8;
  const stride = width * channels * bps;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  const filtered = [];
  let prev = Buffer.alloc(stride);
  rows.forEach((row, y) => {
    const cur = Buffer.isBuffer(row) ? row : Buffer.from(row);
    const f = filterOfRow ? filterOfRow(y) : 0;
    const out = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels * bps ? cur[i - channels * bps] : 0;
      const b = prev[i];
      const c = i >= channels * bps ? prev[i - channels * bps] : 0;
      let v;
      if (f === 0) v = cur[i];
      else if (f === 1) v = cur[i] - a;
      else if (f === 2) v = cur[i] - b;
      else if (f === 3) v = cur[i] - ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = cur[i] - pred;
      }
      out[i] = v & 0xff;
    }
    filtered.push(Buffer.from([f]), out);
    prev = cur;
  });
  const parts = [
    png.SIGNATURE,
    chunk('IHDR', ihdr),
    ...(palette ? [chunk('PLTE', palette)] : []),
    ...(trns ? [chunk('tRNS', trns)] : []),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(filtered))),
    chunk('IEND', Buffer.alloc(0)),
  ];
  return Buffer.concat(parts);
}

section('round-trip through our own encoder');
{
  const img = image.create(3, 2);
  const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 128], [10, 20, 30, 255], [250, 240, 230, 255], [1, 2, 3, 0]];
  colors.forEach((c, i) => image.setPixel(img, i % 3, Math.floor(i / 3), c));
  const back = png.decode(png.encode(img.width, img.height, img.data));
  eq('size preserved', [back.width, back.height], [3, 2]);
  eq('pixels preserved byte-for-byte', [...back.data], [...img.data]);
  check('encoder emits filter 0 only', png.encode(3, 2, img.data)[0] === 0x89);
}

section('decoder accepts every PNG filter type');
{
  const width = 4, height = 3;
  // High-frequency content so filters 1..4 produce non-trivial predictions.
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width * 4);
    for (let x = 0; x < width; x++) {
      row[x * 4] = (x * 53 + y * 11) & 0xff;
      row[x * 4 + 1] = (x * 17 + y * 91) & 0xff;
      row[x * 4 + 2] = (x * 200 + y * 5) & 0xff;
      row[x * 4 + 3] = 255;
    }
    rows.push(row);
  }
  const want = [];
  for (const row of rows) want.push(...row);
  for (const filter of [0, 1, 2, 3, 4]) {
    const buf = buildPng({ width, height, colorType: 6, bitDepth: 8, rows, filterOfRow: () => filter });
    const got = png.decode(buf);
    check(`filter ${filter} decodes identically to the source`, JSON.stringify([...got.data]) === JSON.stringify(want),
      { filter, first: [...got.data.slice(0, 8)], firstWant: want.slice(0, 8) });
  }
}

section('16-bit samples are downscaled, not misread');
{
  const row = Buffer.alloc(4 * 2 * 2);
  const put = (x, ch, v) => row.writeUInt16BE(v, (x * 2 + ch) * 2);
  put(0, 0, 0x0000); put(0, 1, 0xffff);
  put(1, 0, 0x8000); put(1, 1, 0x00ff);
  const buf = buildPng({ width: 2, height: 1, colorType: 4, bitDepth: 16, rows: [row] });
  const got = png.decode(buf);
  eq('gray 0x0000 → 0, 0xffff → 255', [got.data[0], got.data[1], got.data[2], got.data[3]], [0, 0, 0, 255]);
  eq('gray 0x8000 → 128, alpha 0x00ff → 0', [got.data[4], got.data[7]], [128, 0]);
}

section('palette + tRNS honours transparency');
{
  const palette = Buffer.from([255, 0, 0, 0, 0, 255]);
  const trns = Buffer.from([0]); // index 0 transparent, index 1 opaque
  const buf = buildPng({ width: 2, height: 1, colorType: 3, bitDepth: 8, rows: [Buffer.from([0, 1])], palette, trns });
  const got = png.decode(buf);
  eq('index 0 → red but alpha 0', [got.data[0], got.data[1], got.data[2], got.data[3]], [255, 0, 0, 0]);
  eq('index 1 → blue, alpha 255', [got.data[4], got.data[5], got.data[6], got.data[7]], [0, 0, 255, 255]);
}

section('corrupt evidence fails closed');
{
  const img = image.solid(2, 2, [9, 9, 9, 255]);
  let args = null;
  try { image.fill(img, [9, 9, 9, 255]); } catch (e) { args = e.code; }
  check('a bounds-less fill is refused instead of painting nothing', args === 'IMAGE_FILL_ARGS', { args });
  const good = png.encode(2, 2, img.data);
  const bad = Buffer.from(good);
  // Flip one byte inside IDAT: CRC must catch it before it becomes a pixel.
  bad[bad.length - 16] ^= 0xff;
  let code = null;
  try { png.decode(bad); } catch (e) { code = e.code; }
  check('flipped IDAT byte → PNG_INVALID (not plausible pixels)', code === 'PNG_INVALID', { code });

  let sig = null;
  try { png.decode(Buffer.from('not a png at all')); } catch (e) { sig = e.code; }
  check('bad signature → PNG_INVALID', sig === 'PNG_INVALID', { sig });

  let trunc = null;
  try { png.decode(good.subarray(0, 20)); } catch (e) { trunc = e.code; }
  check('truncated file → PNG_INVALID', trunc === 'PNG_INVALID', { trunc });
}

section('writeFile accepts an image object');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-png-'));
  const file = path.join(dir, 'x.png');
  const img = image.create(2, 1);
  image.setPixel(img, 0, 0, [1, 2, 3, 255]);
  image.setPixel(img, 1, 0, [4, 5, 6, 255]);
  png.writeFile(file, img);
  const back = png.decode(fs.readFileSync(file));
  eq('round-trip through the filesystem', [...back.data], [...img.data]);
  fs.rmSync(dir, { recursive: true, force: true });
}

if (require.main === module) process.exit(finish('png.test'));
module.exports = {};

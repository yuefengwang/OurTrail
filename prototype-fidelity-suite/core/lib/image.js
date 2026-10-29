'use strict';
/**
 * Raster helpers on plain {width, height, data:Uint8Array RGBA} images.
 * All resampling premultiplies alpha so edges do not bleed dark fringes.
 */
const { PfError } = require('./util');

function create(width, height, rgba) {
  const data = new Uint8Array(width * height * 4);
  if (rgba) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = rgba[0]; data[i + 1] = rgba[1]; data[i + 2] = rgba[2]; data[i + 3] = rgba[3];
    }
  }
  return { width, height, data };
}

function clone(img) {
  return { width: img.width, height: img.height, data: new Uint8Array(img.data) };
}

function pixel(img, x, y) {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

function setPixel(img, x, y, rgba) {
  const i = (y * img.width + x) * 4;
  img.data[i] = rgba[0]; img.data[i + 1] = rgba[1];
  img.data[i + 2] = rgba[2]; img.data[i + 3] = rgba[3];
}

function crop(img, x, y, w, h) {
  const x0 = Math.max(0, Math.min(img.width, Math.round(x)));
  const y0 = Math.max(0, Math.min(img.height, Math.round(y)));
  const x1 = Math.max(x0, Math.min(img.width, Math.round(x + w)));
  const y1 = Math.max(y0, Math.min(img.height, Math.round(y + h)));
  const out = { width: x1 - x0, height: y1 - y0, data: new Uint8Array((x1 - x0) * (y1 - y0) * 4) };
  for (let row = 0; row < out.height; row++) {
    const src = ((y0 + row) * img.width + x0) * 4;
    out.data.set(img.data.subarray(src, src + out.width * 4), row * out.width * 4);
  }
  return out;
}

/** Area-average resample. Handles both up- and down-scaling. */
function resize(img, width, height) {
  if (img.width === width && img.height === height) return clone(img);
  if (width <= 0 || height <= 0) throw new PfError('IMAGE_RESIZE', 'invalid target size');
  const sx = img.width / width;
  const sy = img.height / height;
  const out = { width, height, data: new Uint8Array(width * height * 4) };
  // source coverage weights per destination column / row
  const wx = [];
  for (let x = 0; x < width; x++) {
    const a = x * sx, b = (x + 1) * sx;
    const list = [];
    for (let s = Math.floor(a); s < Math.ceil(b); s++) {
      const overlap = Math.min(b, s + 1) - Math.max(a, s);
      if (overlap > 0) list.push([Math.min(img.width - 1, s), overlap]);
    }
    const total = list.reduce((acc, e) => acc + e[1], 0) || 1;
    wx.push(list.map(([s, w]) => [s, w / total]));
  }
  const wy = [];
  for (let y = 0; y < height; y++) {
    const a = y * sy, b = (y + 1) * sy;
    const list = [];
    for (let s = Math.floor(a); s < Math.ceil(b); s++) {
      const overlap = Math.min(b, s + 1) - Math.max(a, s);
      if (overlap > 0) list.push([Math.min(img.height - 1, s), overlap]);
    }
    const total = list.reduce((acc, e) => acc + e[1], 0) || 1;
    wy.push(list.map(([s, w]) => [s, w / total]));
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const [yy, wyv] of wy[y]) {
        for (const [xx, wxv] of wx[x]) {
          const i = (yy * img.width + xx) * 4;
          const al = img.data[i + 3] / 255;
          const wgt = wxv * wyv * al;
          r += img.data[i] * wgt;
          g += img.data[i + 1] * wgt;
          b += img.data[i + 2] * wgt;
          a += wgt;
        }
      }
      const o = (y * width + x) * 4;
      if (a > 0) {
        out.data[o] = Math.round(r / a);
        out.data[o + 1] = Math.round(g / a);
        out.data[o + 2] = Math.round(b / a);
        out.data[o + 3] = Math.round(Math.min(1, a) * 255);
      }
    }
  }
  return out;
}

/** Linear blend of `top` over `base` with a constant alpha 0..1. */
function blend(base, top, alpha) {
  const out = clone(base);
  const A = alpha == null ? 1 : alpha;
  const n = Math.min(out.data.length, top.data.length);
  for (let i = 0; i < n; i += 4) {
    const ta = (top.data[i + 3] / 255) * A;
    const ba = out.data[i + 3] / 255;
    const oa = ta + ba * (1 - ta);
    if (oa <= 0) { out.data[i + 3] = 0; continue; }
    for (let k = 0; k < 3; k++) {
      out.data[i + k] = Math.round((top.data[i + k] * ta + out.data[i + k] * ba * (1 - ta)) / oa);
    }
    out.data[i + 3] = Math.round(oa * 255);
  }
  return out;
}

function fill(img, x, y, w, h, rgba) {
  // `fill(img, rgba)` would compute NaN bounds and silently paint nothing —
  // an all-transparent image is indistinguishable from a diff-free capture.
  if (Array.isArray(x)) throw new PfError('IMAGE_FILL_ARGS', 'fill(img, x, y, w, h, rgba) needs bounds; use solid(width, height, rgba) for a full canvas');
  const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(img.width, Math.round(x + w)), y1 = Math.min(img.height, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) setPixel(img, xx, yy, rgba);
  return img;
}

/** Solid colour canvas; useful for diff heatmaps. */
function solid(width, height, rgba) {
  const img = { width, height, data: new Uint8Array(width * height * 4) };
  return fill(img, 0, 0, width, height, rgba);
}

function drawRectOutline(img, x, y, w, h, rgba, thickness) {
  const t = Math.max(1, thickness || 1);
  fill(img, x, y, w, t, rgba);
  fill(img, x, y + h - t, w, t, rgba);
  fill(img, x, y, t, h, rgba);
  fill(img, x + w - t, y, t, h, rgba);
  return img;
}

/** Average colour of a rect, alpha-weighted (used for "dominant fill" checks). */
function average(img, x, y, w, h) {
  const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(img.width, Math.round(x + w)), y1 = Math.min(img.height, Math.round(y + h));
  let r = 0, g = 0, b = 0, a = 0, n = 0;
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * img.width + xx) * 4;
      const al = img.data[i + 3] / 255;
      r += img.data[i] * al; g += img.data[i + 1] * al; b += img.data[i + 2] * al;
      a += al; n++;
    }
  }
  if (!n || a === 0) return { r: 0, g: 0, b: 0, a: 0, n };
  return { r: Math.round(r / a), g: Math.round(g / a), b: Math.round(b / a), a: a / n, n };
}

module.exports = { create, clone, pixel, setPixel, crop, resize, blend, fill, solid, drawRectOutline, average };

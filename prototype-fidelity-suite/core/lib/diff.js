'use strict';
/**
 * Pixel comparison.
 *
 * The colour-distance model and the anti-alias heuristic follow **pixelmatch
 * classic (v5–v7)** (mapbox/pixelmatch, ISC): YIQ-weighted squared delta with
 * `MAX_YIQ_DELTA = 35215` and "flat-neighbour" anti-alias detection. This is
 * pinned deliberately — v8.0.0 abandoned YIQ for OKLab/HyAB and treats
 * `threshold` as an absolute distance, so the two generations are not
 * interchangeable and "pixelmatch-compatible" alone would be ambiguous.
 * It is re-implemented here (rather than vendored) because the suite also needs
 * connected-component regions and a classification layer, and because the
 * repository must stay dependency-free.
 *
 * Deliberate deviations from pixelmatch:
 *  - returns structured components (bbox + area + mean/max delta), not just a count
 *  - keeps an explicit `aaMask` so callers can report anti-aliasing separately
 *    instead of silently discarding it
 *  - never mutates the inputs
 */
const image = require('./image');

const MAX_YIQ_DELTA = 35215;

function blendChannel(c, a) {
  return 255 + (c - 255) * a;
}

/** Signed YIQ delta between a[i] and b[j]; negative means "a darker than b". */
function deltaBetween(a, i, b, j, yOnly) {
  let r1 = a[i], g1 = a[i + 1], b1 = a[i + 2], a1 = a[i + 3] / 255;
  let r2 = b[j], g2 = b[j + 1], b2 = b[j + 2], a2 = b[j + 3] / 255;
  if (r1 === r2 && g1 === g2 && b1 === b2 && a1 === a2) return 0;
  if (a1 < 1) { r1 = blendChannel(r1, a1); g1 = blendChannel(g1, a1); b1 = blendChannel(b1, a1); }
  if (a2 < 1) { r2 = blendChannel(r2, a2); g2 = blendChannel(g2, a2); b2 = blendChannel(b2, a2); }
  const y1 = r1 * 0.29889531 + g1 * 0.58662247 + b1 * 0.11448223;
  const y2 = r2 * 0.29889531 + g2 * 0.58662247 + b2 * 0.11448223;
  if (yOnly) return y1 - y2;
  const i1 = 0.59597799 * r1 - 0.2741761 * g1 - 0.32180189 * b1;
  const i2 = 0.59597799 * r2 - 0.2741761 * g2 - 0.32180189 * b2;
  const q1 = 0.21147017 * r1 - 0.52261711 * g1 + 0.31114694 * b1;
  const q2 = 0.21147017 * r2 - 0.52261711 * g2 + 0.31114694 * b2;
  const dy = y1 - y2, di = i1 - i2, dq = q1 - q2;
  const delta = 0.5053 * dy * dy + 0.299 * di * di + 0.1957 * dq * dq;
  return r1 > r2 ? -delta : delta;
}

/** Single-index form (same position in both images). */
function colorDelta(a, b, i, yOnly) {
  return deltaBetween(a, i, b, i, yOnly);
}

/**
 * Count neighbours of (x,y) in `img` that are byte-identical to it. Uses the
 * pixelmatch shape: identical neighbours, plus 1 if the pixel sits on the image
 * border. Comparing the centre with itself here would count every neighbour as
 * equal and turn the anti-alias test into a constant.
 */
function hasManySiblings(img, x, y, width, height) {
  const x0 = Math.max(x - 1, 0), y0 = Math.max(y - 1, 0);
  const x1 = Math.min(x + 1, width - 1), y1 = Math.min(y + 1, height - 1);
  let zeroes = x === x0 || x === x1 || y === y0 || y === y1 ? 1 : 0;
  const p = (y * width + x) * 4;
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      if (xx === x && yy === y) continue;
      const q = (yy * width + xx) * 4;
      if (img.data[p] === img.data[q] && img.data[p + 1] === img.data[q + 1] &&
        img.data[p + 2] === img.data[q + 2] && img.data[p + 3] === img.data[q + 3]) zeroes++;
    }
  }
  return zeroes > 2;
}

function antialiased(a, b, x, y, width, height) {
  const x0 = Math.max(x - 1, 0), y0 = Math.max(y - 1, 0);
  const x1 = Math.min(x + 1, width - 1), y1 = Math.min(y + 1, height - 1);
  let zeroes = x === x0 || x === x1 || y === y0 || y === y1 ? 1 : 0;
  let min = 0, max = 0, minX = 0, minY = 0, maxX = 0, maxY = 0;
  const centre = (y * width + x) * 4;
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      if (xx === x && yy === y) continue;
      // a[neighbour] vs b[centre] — the asymmetry is the point of the test.
      const delta = deltaBetween(a.data, (yy * width + xx) * 4, b.data, centre, true);
      if (delta === 0) {
        zeroes++;
        if (zeroes > 2) return false;
      } else if (delta < min) { min = delta; minX = xx; minY = yy; }
      else if (delta > max) { max = delta; maxX = xx; maxY = yy; }
    }
  }
  if (min === 0 || max === 0) return false;
  return (hasManySiblings(a, minX, minY, width, height) && hasManySiblings(b, minX, minY, width, height)) ||
    (hasManySiblings(a, maxX, maxY, width, height) && hasManySiblings(b, maxX, maxY, width, height));
}

/**
 * @param {{width:number,height:number,data:Uint8Array}} a
 * @param {{width:number,height:number,data:Uint8Array}} b
 * @param {{threshold?:number, includeAA?:boolean, yOnly?:boolean, alphaMask?:Uint8Array|null}} [opts]
 */
function compare(a, b, opts) {
  const o = Object.assign({
    threshold: 0.1,
    includeAA: false,
    yOnly: false,
    alphaMask: null, // Uint8Array width*height; 0 = ignore pixel
  }, opts || {});
  if (a.width !== b.width || a.height !== b.height) {
    const err = new Error('image size mismatch: ' + a.width + 'x' + a.height + ' vs ' + b.width + 'x' + b.height);
    err.code = 'IMAGE_SIZE_MISMATCH';
    throw err;
  }
  const { width, height } = a;
  const n = width * height;
  const maxDelta = MAX_YIQ_DELTA * o.threshold * o.threshold;
  const mask = new Uint8Array(n);
  const aaMask = new Uint8Array(n);
  const deltaBuf = new Float32Array(n);
  let diffCount = 0, aaCount = 0, sumDelta = 0, maxSeen = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (o.alphaMask && o.alphaMask[p] === 0) continue;
      const i = p * 4;
      let delta = colorDelta(a.data, b.data, i, o.yOnly);
      if (Math.abs(delta) > maxDelta) {
        const isAA = antialiased(a, b, x, y, width, height);
        if (isAA && !o.includeAA) {
          aaMask[p] = 255;
          aaCount++;
          continue;
        }
        mask[p] = 255;
        deltaBuf[p] = Math.abs(delta);
        diffCount++;
        sumDelta += Math.abs(delta);
        if (Math.abs(delta) > maxSeen) maxSeen = Math.abs(delta);
      }
    }
  }
  return {
    width, height, diffCount, aaCount,
    diffRatio: n ? diffCount / n : 0,
    meanDelta: diffCount ? sumDelta / diffCount : 0,
    maxDelta: maxSeen,
    mask, aaMask, deltaBuf,
    threshold: o.threshold,
  };
}

/** 8-connected components over a mask, with optional minimum area. */
function components(mask, width, height, minArea) {
  const seen = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  const out = [];
  const min = minArea == null ? 1 : minArea;
  for (let start = 0; start < width * height; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let area = 0, minX = width, minY = height, maxX = -1, maxY = -1;
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % width, y = (p - x) / width;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const np = ny * width + nx;
          if (mask[np] && !seen[np]) { seen[np] = 1; stack[sp++] = np; }
        }
      }
    }
    if (area >= min) {
      out.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area });
    }
  }
  out.sort((p, q) => q.area - p.area);
  return out;
}

/** Merge components whose bounding boxes are closer than `gap` pixels. */
function mergeComponents(list, gap) {
  const g = gap == null ? 3 : gap;
  const boxes = list.map(c => ({ ...c }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < boxes.length && !merged; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const near = a.x - g < b.x + b.w && b.x - g < a.x + a.w &&
          a.y - g < b.y + b.h && b.y - g < a.y + a.h;
        if (near) {
          const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
          const w = Math.max(a.x + a.w, b.x + b.w) - x;
          const h = Math.max(a.y + a.h, b.y + b.h) - y;
          boxes[i] = { x, y, w, h, area: a.area + b.area, merged: 2 + (a.merged || 0) + (b.merged || 0) };
          boxes.splice(j, 1);
          merged = true;
          break;
        }
      }
    }
  }
  boxes.sort((p, q) => q.area - p.area);
  return boxes;
}

/** Red-on-white diff image; AA pixels can be tinted yellow for transparency. */
function renderMask(mask, aaMask, width, height, opts) {
  const o = Object.assign({ diff: [255, 45, 85, 255], aa: [255, 214, 0, 180], bg: [255, 255, 255, 255] }, opts || {});
  const out = image.solid(width, height, o.bg);
  for (let p = 0; p < width * height; p++) {
    if (mask[p]) {
      const i = p * 4;
      out.data[i] = o.diff[0]; out.data[i + 1] = o.diff[1]; out.data[i + 2] = o.diff[2]; out.data[i + 3] = 255;
    } else if (aaMask && aaMask[p]) {
      const i = p * 4;
      out.data[i] = o.aa[0]; out.data[i + 1] = o.aa[1]; out.data[i + 2] = o.aa[2]; out.data[i + 3] = 255;
    }
  }
  return out;
}

/** Dimmed base image with diff pixels highlighted (heat map). */
function renderHeatmap(base, mask, width, height) {
  const out = image.clone(base);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    if (mask[p]) {
      out.data[i] = 255; out.data[i + 1] = 30; out.data[i + 2] = 60; out.data[i + 3] = 255;
    } else {
      out.data[i] = Math.round(out.data[i] * 0.35 + 255 * 0.65);
      out.data[i + 1] = Math.round(out.data[i + 1] * 0.35 + 255 * 0.65);
      out.data[i + 2] = Math.round(out.data[i + 2] * 0.35 + 255 * 0.65);
    }
  }
  return out;
}

/** 50/50 blend of the two images, plus diff outlines drawn on top. */
function renderOverlay(a, b, mask, width, height) {
  const out = image.blend(a, b, 0.5);
  for (let p = 0; p < width * height; p++) {
    if (!mask[p]) continue;
    const x = p % width, y = (p - x) / width;
    const edge = !(x > 0 && mask[p - 1]) || !(x < width - 1 && mask[p + 1]) ||
      !(y > 0 && mask[p - width]) || !(y < height - 1 && mask[p + width]);
    if (edge) {
      const i = p * 4;
      out.data[i] = 255; out.data[i + 1] = 45; out.data[i + 2] = 85; out.data[i + 3] = 255;
    }
  }
  return out;
}

/**
 * Rasterisation-independent signature of what is *visible* in a crop.
 *
 * Two renderers draw the same text with different glyph edges (browser at 1× vs
 * a downscaled device screenshot), so a per-pixel ratio is not comparable for
 * text. Ink extent and ink amount are: a different font size, a wrapped line, a
 * missing glyph run or a shifted block all move the bounding box or the count.
 * Background is estimated from the border pixels so a card's own fill does not
 * count as ink.
 */
function inkSignature(img, opts) {
  const o = opts || {};
  const thr = o.threshold == null ? 24 : o.threshold;
  const { width, height, data } = img;
  const bg = medianBorderColor(img);
  let minX = width, minY = height, maxX = -1, maxY = -1, count = 0, sum = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
      if (d <= thr) continue;
      count++;
      sum += d;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!count) return { count: 0, bbox: null, mean: 0, total: width * height };
  return {
    count,
    total: width * height,
    density: round(count / (width * height), 4),
    bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    mean: round(sum / count, 2),
  };
}

function medianBorderColor(img) {
  const { width, height, data } = img;
  const samples = [];
  const push = (x, y) => {
    const i = (y * width + x) * 4;
    samples.push([data[i], data[i + 1], data[i + 2]]);
  };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }
  samples.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
  return samples[Math.floor(samples.length / 2)];
}

/**
 * Compare two ink signatures. `tol` is in CSS px for the bbox and relative for
 * the ink amount. Returns PASS / FAIL with the reason, never a silent boolean.
 */
function compareInk(a, b, tol) {
  const t = tol || {};
  const bboxTol = t.bboxPx == null ? 2 : t.bboxPx;
  const amountTol = t.amountRatio == null ? 0.3 : t.amountRatio;
  if (!a.count && !b.count) return { status: 'PASS', reason: 'no ink on either side' };
  if (!a.count || !b.count) {
    return { status: 'FAIL', reason: `ink only on ${a.count ? 'prototype' : 'target'}` };
  }
  const reasons = [];
  for (const k of ['x', 'y', 'w', 'h']) {
    if (Math.abs(a.bbox[k] - b.bbox[k]) > bboxTol) reasons.push(`ink ${k} ${a.bbox[k]} vs ${b.bbox[k]}`);
  }
  const ratio = b.count / a.count;
  if (ratio < 1 - amountTol || ratio > 1 + amountTol) reasons.push(`ink amount ×${round(ratio, 2)}`);
  return reasons.length
    ? { status: 'FAIL', reasons }
    : { status: 'PASS', ratio: round(ratio, 3) };
}

function round(v, d) { const f = Math.pow(10, d); return Math.round(v * f) / f; }

module.exports = {
  compare, components, mergeComponents, colorDelta, antialiased,
  renderMask, renderHeatmap, renderOverlay, MAX_YIQ_DELTA,
  inkSignature, compareInk,
};

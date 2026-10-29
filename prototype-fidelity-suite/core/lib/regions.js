'use strict';
/**
 * Region-level comparison.
 *
 * Each side is cropped to *its own* node origin (in that side's screenshot
 * scale), so a global layout offset does not have to be subtracted first: the
 * region is aligned by construction.
 *
 * The crop WIDTH/HEIGHT, however, must be shared: cropping each side to its own
 * full rect compares different layout areas whenever the two rects differ in
 * size (a 240 px prototype text column vs a 350 px target one puts the target's
 * badge-free whitespace beside the prototype's text). So the compared area is
 * the smaller of the two rects' w/h, taken from each element's own origin; the
 * uncompared remainder is reported per side and is already covered by the
 * geometry deltas. Both crops are then normalised to the smaller of the two
 * pixel sizes so no side is upsampled beyond its own evidence resolution.
 *
 * The alternative — one global diff with an anchor translation — is what
 * `compareFull` is for, and it is explicitly reported as *informational*: a
 * global shift makes every pixel differ, which says nothing about which
 * component is wrong.
 */
const image = require('./image');
const diff = require('./diff');
const { round, clamp } = require('./util');

function rectInPixels(rect, scale) {
  const sx = scale && scale.x || 1;
  const sy = scale && scale.y || 1;
  return {
    x: rect.x * sx, y: rect.y * sy, w: rect.w * sx, h: rect.h * sy,
  };
}

/** Crop with integer bounds clamped to the image; returns null if empty. */
function cropRect(img, rectPx, pad) {
  const p = pad || 0;
  const x0 = clamp(Math.floor(rectPx.x - p), 0, img.width);
  const y0 = clamp(Math.floor(rectPx.y - p), 0, img.height);
  const x1 = clamp(Math.ceil(rectPx.x + rectPx.w + p), 0, img.width);
  const y1 = clamp(Math.ceil(rectPx.y + rectPx.h + p), 0, img.height);
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return { img: image.crop(img, x0, y0, x1 - x0, y1 - y0), origin: { x: x0, y: y0 } };
}

function compareRegion(imgA, rectA, scaleA, imgB, rectB, scaleB, opts) {
  const o = opts || {};
  // Common CSS sub-rect: same area of both layouts, anchored at each element's
  // own origin. Sizes differing is a geometry finding, not a reason to compare
  // two different regions.
  const shareW = Math.max(1, Math.min(rectA.w, rectB.w));
  const shareH = Math.max(1, Math.min(rectA.h, rectB.h));
  const a = cropRect(imgA, rectInPixels({ x: rectA.x, y: rectA.y, w: shareW, h: shareH }, scaleA), o.pad);
  const b = cropRect(imgB, rectInPixels({ x: rectB.x, y: rectB.y, w: shareW, h: shareH }, scaleB), o.pad);
  if (!a || !b) {
    return { status: 'UNVERIFIED', reason: !a ? 'prototype crop empty' : 'target crop empty' };
  }
  const w = Math.max(1, Math.min(a.img.width, b.img.width));
  const h = Math.max(1, Math.min(a.img.height, b.img.height));
  const A = a.img.width === w && a.img.height === h ? a.img : image.resize(a.img, w, h);
  const B = b.img.width === w && b.img.height === h ? b.img : image.resize(b.img, w, h);

  // `maskCss` rects are in CSS px relative to the pair's own origin. They mark
  // declared child regions (glyph-sensitive text, live copy) that are judged at
  // their own level; measuring them again here charges the container for a
  // difference it does not own. Masked pixels leave both numerator and
  // denominator, so a container with one live clock cannot be failed by the
  // clock's own changing digits.
  let alphaMask = null;
  let maskedPixels = 0;
  if (o.maskCss && o.maskCss.length) {
    alphaMask = new Uint8Array(w * h).fill(1);
    const fx = w / shareW;
    const fy = h / shareH;
    for (const m of o.maskCss) {
      const x0 = clamp(Math.floor(m.x * fx), 0, w);
      const y0 = clamp(Math.floor(m.y * fy), 0, h);
      const x1 = clamp(Math.ceil((m.x + m.w) * fx), 0, w);
      const y1 = clamp(Math.ceil((m.y + m.h) * fy), 0, h);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = y * w + x;
          if (alphaMask[p]) { alphaMask[p] = 0; maskedPixels++; }
        }
      }
    }
    if (maskedPixels >= w * h) {
      return {
        status: 'UNVERIFIED',
        reason: 'every compared pixel lies inside a declared child region',
        width: w, height: h,
        masked: { pixels: maskedPixels, ratio: 1 },
      };
    }
  }
  const comparedPixels = w * h - maskedPixels;

  const cmp = diff.compare(A, B, {
    threshold: o.threshold == null ? 0.1 : o.threshold,
    includeAA: !!o.includeAA,
    alphaMask,
  });
  const comps = diff.components(cmp.mask, w, h, o.minArea == null ? 8 : o.minArea);
  return {
    status: 'PASS',
    width: w,
    height: h,
    resampled: A !== a.img || B !== b.img,
    sharedCss: { w: round(shareW, 2), h: round(shareH, 2) },
    uncomparedCss: {
      prototype: { w: round(rectA.w - shareW, 2), h: round(rectA.h - shareH, 2) },
      target: { w: round(rectB.w - shareW, 2), h: round(rectB.h - shareH, 2) },
    },
    prototypePixels: { x: a.origin.x, y: a.origin.y, w: a.img.width, h: a.img.height },
    targetPixels: { x: b.origin.x, y: b.origin.y, w: b.img.width, h: b.img.height },
    diffCount: cmp.diffCount,
    aaCount: cmp.aaCount,
    diffRatio: comparedPixels ? round(cmp.diffCount / comparedPixels, 5) : 0,
    masked: maskedPixels ? { pixels: maskedPixels, ratio: round(maskedPixels / (w * h), 4) } : null,
    meanDelta: round(cmp.meanDelta, 2),
    maxDelta: round(cmp.maxDelta, 2),
    components: comps.map(c => ({
      x: c.x, y: c.y, w: c.w, h: c.h, area: c.area,
      meanDelta: round(c.meanDelta, 2), maxDelta: round(c.maxDelta, 2),
    })),
    // Both crops must be the *compared* (resized) pair: measuring an ink
    // signature on the raw prototype crop against a resized target reports a
    // size difference that is purely the capture scale.
    images: { prototype: A, target: B, diff: diff.renderMask(cmp.mask, cmp.aaMask, w, h) },
  };
}

/**
 * Full-page diff with an anchor translation. Informational only.
 * `anchor` = { prototype:{x,y}, target:{x,y} } in CSS px; applied as a shift of
 * the target image so a shared origin (e.g. the page frame) lands on the same spot.
 */
function compareFull(imgA, scaleA, imgB, scaleB, anchor, opts) {
  const o = opts || {};
  const w = Math.min(imgA.width, imgB.width);
  const h = Math.min(imgA.height, imgB.height);
  const A = image.resize(imgA, w, h);
  const B = image.resize(imgB, w, h);
  const shift = anchor ? {
    x: Math.round((anchor.prototype.x - anchor.target.x) * (scaleA.x || 1)),
    y: Math.round((anchor.prototype.y - anchor.target.y) * (scaleA.y || 1)),
  } : { x: 0, y: 0 };
  const shifted = shift.x || shift.y ? image.clone(B) : B;
  if (shift.x || shift.y) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const src = image.pixel(B, clamp(x - shift.x, 0, w - 1), clamp(y - shift.y, 0, h - 1));
        image.setPixel(shifted, x, y, src);
      }
    }
  }
  const cmp = diff.compare(A, shifted, { threshold: o.threshold == null ? 0.1 : o.threshold, includeAA: !!o.includeAA });
  return {
    informativeOnly: true,
    shift,
    width: w, height: h,
    diffCount: cmp.diffCount,
    diffRatio: round(cmp.diffRatio, 5),
    images: { diff: diff.renderMask(cmp.mask, cmp.aaMask, w, h) },
  };
}

/** Bounding box of a list of components, used to label "where" a diff cluster is. */
function clusterBounds(components) {
  if (!components || !components.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of components) {
    x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y);
    x1 = Math.max(x1, c.x + c.w); y1 = Math.max(y1, c.y + c.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

module.exports = { compareRegion, compareFull, rectInPixels, cropRect, clusterBounds };

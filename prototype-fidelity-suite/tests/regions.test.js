'use strict';
/**
 * Region comparison.
 *
 * The cases that matter here are the two ways a region diff silently lies:
 *  1. comparing each side's *own* full rect (different layout areas squeezed into
 *     one box) — a 240 px prototype text column vs a 350 px target one;
 *  2. measuring ink on the raw prototype crop while the target crop was resized,
 *     which reports the capture scale as a difference.
 * Both are pinned below with the exact geometry that produced them on the pilot
 * page, plus a positive control that a real in-region difference still fails.
 */
const image = require('../core/lib/image');
const diff = require('../core/lib/diff');
const regions = require('../core/lib/regions');
const { check, eq, near, section, finish } = require('./harness');

function page(w, h) {
  return image.create(w, h, [255, 255, 255, 255]);
}

function block(img, x, y, w, h, rgba) { image.fill(img, x, y, w, h, rgba); return img; }

section('shared sub-rect: a bigger target rect does not dilute the comparison');
{
  // Prototype: 240 CSS px text column with ink in the first 200 px.
  const a = page(400, 40);
  block(a, 0, 10, 200, 18, [20, 20, 20, 255]);
  // Target: the same rendering for the shared area, but the element is 350 px
  // wide (no demo badge in the prototype) — capture scale 0.7846 / 0.782.
  const b = image.resize(a, Math.round(400 * 0.7846), Math.round(40 * 0.782));

  const r = regions.compareRegion(
    a, { x: 0, y: 0, w: 240, h: 40 }, { x: 1, y: 1 },
    b, { x: 0, y: 0, w: 350, h: 40 }, { x: 0.7846, y: 0.782 },
    { threshold: 0.1 },
  );
  eq('status is measurable', r.status, 'PASS');
  eq('both compared crops have the same size', [r.images.prototype.width, r.images.target.width], [r.width, r.width]);
  eq('prototype side has nothing uncompared', [r.uncomparedCss.prototype.w, r.uncomparedCss.prototype.h], [0, 0]);
  near('target side remainder is reported, not compared', r.uncomparedCss.target.w, 110, 0.01);
  // The target raster is a box-downscale of the prototype, so block edges carry
  // resampling noise; what must not happen is a layout-area mismatch (the old
  // behaviour charged 30–40 % on identical text).
  check('shared content is essentially diff-free', r.diffRatio < 0.01, { diffRatio: r.diffRatio, diffCount: r.diffCount });

  const inkA = diff.inkSignature(r.images.prototype);
  const inkB = diff.inkSignature(r.images.target);
  check('ink bbox agrees within the gate tolerance', Math.abs(inkA.bbox.w - inkB.bbox.w) <= 2, { a: inkA.bbox, b: inkB.bbox });
  eq('ink comparison passes', diff.compareInk(inkA, inkB, { bboxPx: 2, amountRatio: 0.3 }).status, 'PASS');
}

section('positive control: a real difference inside the shared area still fails');
{
  const a = page(200, 40);
  block(a, 0, 10, 100, 18, [20, 20, 20, 255]);
  const b = image.clone(a);
  block(b, 100, 10, 60, 18, [20, 20, 20, 255]); // text continues 60 px further
  const r = regions.compareRegion(
    a, { x: 0, y: 0, w: 200, h: 40 }, { x: 1, y: 1 },
    b, { x: 0, y: 0, w: 200, h: 40 }, { x: 1, y: 1 },
    { threshold: 0.1, minArea: 8 },
  );
  check('difference is counted', r.diffCount > 0, { diffCount: r.diffCount });
  check('difference is localized to a component', r.components.length >= 1, r.components);
  check('component sits where the extra text is', r.components[0].x >= 95, r.components[0]);

  const inkA = diff.inkSignature(r.images.prototype);
  const inkB = diff.inkSignature(r.images.target);
  eq('ink gate also fails', diff.compareInk(inkA, inkB, { bboxPx: 2, amountRatio: 0.3 }).status, 'FAIL');
}

section('ink signature contract');
{
  const empty = page(40, 20);
  const r = regions.compareRegion(
    empty, { x: 0, y: 0, w: 40, h: 20 }, { x: 1, y: 1 },
    image.clone(empty), { x: 0, y: 0, w: 40, h: 20 }, { x: 1, y: 1 },
    { threshold: 0.1 },
  );
  const sig = diff.inkSignature(r.images.prototype);
  eq('blank region has no ink', sig.count, 0);
  eq('blank vs blank passes', diff.compareInk(sig, diff.inkSignature(r.images.target), {}).status, 'PASS');

  const inked = page(40, 20);
  block(inked, 5, 5, 10, 10, [0, 0, 0, 255]);
  const one = diff.inkSignature(inked);
  eq('ink bbox is tight around the block', [one.bbox.x, one.bbox.y, one.bbox.w, one.bbox.h], [5, 5, 10, 10]);
  eq('ink only on one side fails', diff.compareInk(one, sig, {}).status, 'FAIL');
  check('failure names the side', diff.compareInk(one, sig, {}).reason === 'ink only on prototype');

  const shifted = page(40, 20);
  block(shifted, 9, 5, 10, 10, [0, 0, 0, 255]); // 4 px right
  const moved = diff.compareInk(one, diff.inkSignature(shifted), { bboxPx: 2, amountRatio: 0.3 });
  eq('a 4 px shift exceeds the 2 px bbox tolerance', moved.status, 'FAIL');
  check('reason names x', /ink x/.test(moved.reasons.join(';')), moved.reasons);
}

section('unmeasurable rects are UNVERIFIED, never PASS');
{
  const a = page(50, 50);
  const r = regions.compareRegion(a, { x: 500, y: 500, w: 20, h: 20 }, { x: 1, y: 1 },
    a, { x: 0, y: 0, w: 10, h: 10 }, { x: 1, y: 1 }, {});
  eq('status', r.status, 'UNVERIFIED');
  check('reason is stated', typeof r.reason === 'string' && r.reason.length > 0, r.reason);
}

section('full-page comparison is informational and reports its shift');
{
  const a = page(100, 100);
  block(a, 10, 10, 20, 20, [0, 0, 0, 255]);
  const b = page(100, 100);
  block(b, 10, 40, 20, 20, [0, 0, 0, 255]); // same content, 30 px lower
  const full = regions.compareFull(a, { x: 1, y: 1 }, b, { x: 1, y: 1 },
    { prototype: { x: 0, y: 10 }, target: { x: 0, y: 40 } }, {});
  eq('marked informative', full.informativeOnly, true);
  eq('shift is the anchor difference', full.shift, { x: 0, y: -30 });
  eq('after the shift the pages agree', full.diffCount, 0);
}

section('masked child regions leave both the numerator and the denominator');
{
  const a = page(100, 40);
  block(a, 0, 0, 100, 40, [240, 240, 240, 255]); // card fill
  block(a, 10, 10, 20, 20, [0, 0, 0, 255]);      // one child, e.g. live digits
  const b = page(100, 40);
  block(b, 0, 0, 100, 40, [240, 240, 240, 255]);
  block(b, 10, 10, 20, 20, [200, 0, 0, 255]);    // the child changed, the card did not
  const rect = { x: 0, y: 0, w: 100, h: 40 };
  const s = { x: 1, y: 1 };

  const plain = regions.compareRegion(a, rect, s, b, rect, s, {});
  check('without a mask the child is charged to the card', plain.diffRatio > 0.02, plain.diffRatio);

  const mask = [{ x: 9, y: 9, w: 22, h: 22 }];
  const masked = regions.compareRegion(a, rect, s, b, rect, s, { maskCss: mask });
  eq('the masked child leaves nothing to fail', masked.diffCount, 0);
  check('the masked share is reported', masked.masked && masked.masked.ratio > 0.1, masked.masked);
  eq('the ratio is over the unmasked area', masked.diffRatio, 0);

  const changed = page(100, 40);
  block(changed, 0, 0, 100, 40, [0, 0, 0, 255]); // the card itself is wrong now
  const chrome = regions.compareRegion(a, rect, s, changed, rect, s, { maskCss: mask });
  check('masking a child does not excuse the card', chrome.diffRatio > 0.5, chrome.diffRatio);

  const covered = regions.compareRegion(a, rect, s, b, rect, s, { maskCss: [{ x: 0, y: 0, w: 100, h: 40 }] });
  eq('a fully masked crop is UNVERIFIED, not PASS', covered.status, 'UNVERIFIED');
  check('and says why', /child region/.test(covered.reason || ''), covered.reason);
}

if (require.main === module) process.exit(finish('regions.test'));
module.exports = {};

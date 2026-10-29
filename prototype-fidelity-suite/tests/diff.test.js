'use strict';
/**
 * Pixel-diff semantics.
 *
 * The assertions pin the *model*, not just "diff finds something": YIQ delta
 * magnitude, threshold scaling (maxDelta = 35215·t²), the AA partition, and the
 * components/minArea contract. The AA pair is the one that used to be a constant:
 * a pixel-blend difference must classify as AA, an isolated pixel must not.
 */
const image = require('../core/lib/image');
const diff = require('../core/lib/diff');
const { check, eq, near, section, finish } = require('./harness');

function solid(w, h, rgba) { return image.create(w, h, rgba); }

function put(img, x, y, rgba) { image.setPixel(img, x, y, rgba); }

section('colour distance model');
{
  const black = solid(1, 1, [0, 0, 0, 255]);
  const white = solid(1, 1, [255, 255, 255, 255]);
  near('black vs white = 0.5053·255² = 32857', Math.abs(diff.colorDelta(black.data, white.data, 0, false)), 32857, 1);
  check('MAX_YIQ_DELTA is the model constant', diff.MAX_YIQ_DELTA === 35215);

  const a = solid(1, 1, [100, 100, 100, 255]);
  const b = solid(1, 1, [106, 106, 106, 255]);
  const d = Math.abs(diff.colorDelta(a.data, b.data, 0, false));
  check('a 6-level grey step is ~18 (below the 0.1 threshold cut of 352)', d > 17 && d < 19, { d });
}

section('threshold scales as maxDelta = 35215·t²');
{
  const a = solid(2, 1, [100, 100, 100, 255]);
  const b = solid(2, 1, [100, 100, 100, 255]);
  put(b, 1, 0, [106, 106, 106, 255]);
  const loose = diff.compare(a, b, { threshold: 0.1 });
  const strict = diff.compare(a, b, { threshold: 0.01 });
  eq('6-level step ignored at t=0.1', loose.diffCount, 0);
  eq('6-level step counted at t=0.01', strict.diffCount, 1);
  near('ratio is diffCount / pixels', strict.diffRatio, 0.5, 1e-9);
}

section('anti-alias classification is a real decision, not a constant');
{
  // A hard-lit 5×5 neighbourhood around a blend pixel: three blacks on one side,
  // whites on the other, no neighbour equal to the target's centre value.
  const A = solid(5, 5, [255, 255, 255, 255]);
  const B = solid(5, 5, [255, 255, 255, 255]);
  const BLACK = [0, 0, 0, 255];
  for (const [x, y] of [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [2, 3]]) put(A, x, y, BLACK);
  for (const [x, y] of [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [2, 3]]) put(B, x, y, BLACK);
  put(A, 2, 2, [200, 200, 200, 255]); // the blend
  put(B, 2, 2, [128, 128, 128, 255]); // the hard edge

  const withoutAA = diff.compare(A, B, { threshold: 0.1, includeAA: false });
  const withAA = diff.compare(A, B, { threshold: 0.1, includeAA: true });
  eq('blend difference is excluded as AA', withoutAA.diffCount, 0);
  eq('…and reported in aaCount instead of vanishing', withoutAA.aaCount, 1);
  eq('includeAA:true counts it as a diff', withAA.diffCount, 1);
  eq('includeAA:true reports no AA', withAA.aaCount, 0);

  // Isolated pixel: neighbours match the *other* image's centre colour, so this
  // is a real single-pixel difference (pixelmatch's zeroes>2 early return).
  const C = solid(5, 5, [255, 255, 255, 255]);
  const D = solid(5, 5, [255, 255, 255, 255]);
  put(C, 2, 2, [0, 0, 0, 255]);
  const lone = diff.compare(C, D, { threshold: 0.1, includeAA: false });
  eq('isolated pixel is not excused as AA', lone.diffCount, 1);
  eq('…and is not counted as AA', lone.aaCount, 0);
}

section('alpha handling composites over white');
{
  const a = solid(1, 1, [0, 0, 0, 0]);       // fully transparent → white
  const b = solid(1, 1, [255, 255, 255, 255]);
  eq('transparent vs white = no difference', diff.compare(a, b, { threshold: 0.1 }).diffCount, 0);
  const c = solid(1, 1, [0, 0, 0, 128]);     // half black → mid grey
  check('half-alpha black differs from white', diff.compare(c, b, { threshold: 0.1 }).diffCount === 1);
}

section('components and merging');
{
  const mask = new Uint8Array(20 * 10);
  const set = (x, y) => { mask[y * 20 + x] = 255; };
  for (let x = 2; x < 5; x++) for (let y = 2; y < 4; y++) set(x, y);   // 6 px block
  set(15, 8);                                                          // 1 px speck
  const comps = diff.components(mask, 20, 10, 1);
  eq('two components found', comps.length, 2);
  eq('largest first', [comps[0].x, comps[0].y, comps[0].w, comps[0].h, comps[0].area], [2, 2, 3, 2, 6]);
  eq('minArea filters the speck', diff.components(mask, 20, 10, 2).length, 1);

  const merged = diff.mergeComponents([{ x: 0, y: 0, w: 4, h: 4, area: 16 }, { x: 5, y: 0, w: 4, h: 4, area: 16 }], 3);
  eq('nearby boxes merge into one', [merged.length, merged[0].w], [1, 9]);
  const apart = diff.mergeComponents([{ x: 0, y: 0, w: 4, h: 4, area: 16 }, { x: 30, y: 0, w: 4, h: 4, area: 16 }], 3);
  eq('distant boxes stay separate', apart.length, 2);
}

section('size mismatch is an error, not a silent crop');
{
  const a = solid(4, 4, [255, 255, 255, 255]);
  const b = solid(4, 5, [255, 255, 255, 255]);
  let code = null;
  try { diff.compare(a, b, {}); } catch (e) { code = e.code; }
  check('IMAGE_SIZE_MISMATCH raised', code === 'IMAGE_SIZE_MISMATCH', { code });
}

if (require.main === module) process.exit(finish('diff.test'));
module.exports = {};

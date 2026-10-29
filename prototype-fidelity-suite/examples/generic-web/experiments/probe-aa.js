'use strict';
/**
 * Probe — is any font anti-aliasing variance producible in this environment?
 *
 * Experiment B asks whether the suite tolerates AA differences (the "allowed
 * rendering difference" class). To answer that we first need a *producer*: two
 * renders of the same text at the same metrics that differ only in glyph edge
 * rasterisation. This probe looks for one and records what it found.
 *
 * A usable AA surrogate must move the pixels while leaving the ink signature
 * alone, i.e. pixel diffRatio > 0 with ink ratio inside the gate. A treatment
 * whose pixel diffRatio is 0.00 % changed nothing at all and proves nothing; a
 * treatment that moves the ink ratio is a weight/size change, not AA.
 *
 * Run: node examples/generic-web/experiments/probe-aa.js
 * Writes: examples/generic-web/experiments/aa-probe.json (readings, not claims)
 */
const fs = require('fs');
const path = require('path');
const png = require('../../../core/lib/png');
const image = require('../../../core/lib/image');
const diff = require('../../../core/lib/diff');
const regions = require('../../../core/lib/regions');
const env = require('../../../core/lib/env');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'aa-probe.json');
const URL = 'file:///' + path.resolve(ROOT, 'b/base.html').replace(/\\/g, '/');
const SELECTORS = ['#b-title', '#b-label', '#b-clock', '#b-desc', '#b-btn', '#b-note'];

const LAUNCH_FLAGS = [
  '--disable-font-subpixel-positioning',
  '--font-render-hinting=none',
];

const CSS_TREATMENTS = {
  layer: SELECTORS.join(',') + '{will-change:transform;transform:translateZ(0)}',
  geo: SELECTORS.join(',') + '{text-rendering:geometricPrecision}',
  smooth: SELECTORS.join(',') + '{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}',
  stroke: SELECTORS.join(',') + '{-webkit-text-stroke:0.3px currentColor}',
};

async function render(playwright, { launchArgs, css }) {
  const browser = await playwright.chromium.launch({ headless: true, args: launchArgs || [] });
  try {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      colorScheme: 'light',
      reducedMotion: 'reduce',
    });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    if (css) await page.addStyleTag({ content: css });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const shot = png.decode(await page.screenshot({ animations: 'disabled', caret: 'hide' }));
    const rects = {};
    for (const sel of SELECTORS) {
      const b = await page.locator(sel).boundingBox();
      rects[sel] = { x: b.x, y: b.y, w: b.width, h: b.height };
    }
    return { shot, rects };
  } finally {
    await browser.close().catch(() => {});
  }
}

function cropTo(img, rect) {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const w = Math.max(1, Math.ceil(rect.w));
  const h = Math.max(1, Math.ceil(rect.h));
  return image.crop(img, x0, y0, Math.min(w, img.width - x0), Math.min(h, img.height - y0));
}

function compare(base, other) {
  const rows = [];
  for (const sel of SELECTORS) {
    const a = base.rects[sel];
    const b = other.rects[sel];
    if (!a || !b) continue;
    const scale = { x: 1, y: 1 };
    const cmp = regions.compareRegion(base.shot, a, scale, other.shot, b, scale, { threshold: 0.1, minArea: 8 });
    const ink = diff.compareInk(
      diff.inkSignature(cropTo(base.shot, a)),
      diff.inkSignature(cropTo(other.shot, b)),
      { bboxPx: 2, amountRatio: 0.3 },
    );
    rows.push({
      selector: sel,
      geometryDelta: { dx: b.x - a.x, dy: b.y - a.y, dw: b.w - a.w, dh: b.h - a.h },
      pixelDiffRatio: cmp.diffRatio == null ? null : cmp.diffRatio,
      inkRatio: ink.ratio == null ? null : ink.ratio,
      inkStatus: ink.status,
    });
  }
  return rows;
}

(async () => {
  const found = env.detectPlaywright();
  if (found.status !== 'available') {
    console.error('playwright unavailable: ' + (found.path || (found.searched || []).join(' | ')));
    process.exit(2);
  }
  const playwright = require(found.path);
  const base = await render(playwright, {});
  const variants = [{ id: 'launch-flags', rows: compare(base, await render(playwright, { launchArgs: LAUNCH_FLAGS })) }];
  for (const [id, css] of Object.entries(CSS_TREATMENTS)) {
    variants.push({ id: 'css-' + id, rows: compare(base, await render(playwright, { css })) });
  }

  for (const v of variants) {
    // A variant that moved a box is not an AA candidate at all (metrics changed).
    v.identicalGeometry = v.rows.every(r => Object.values(r.geometryDelta).every(d => Math.abs(d) < 0.5));
    v.maxPixel = Math.max(...v.rows.map(r => r.pixelDiffRatio || 0));
    v.maxInkDeviation = Math.max(...v.rows.map(r => Math.abs((r.inkRatio || 1) - 1)));
    v.allInkPass = v.rows.every(r => r.inkStatus === 'PASS');
    v.producedAnyDifference = v.maxPixel > 0 || v.maxInkDeviation > 0.001;
    // Usable = the reader sees the same text (ink within its gate) drawn with
    // different pixels. Anything that trips the ink gate is a weight change.
    v.usableAsAaSurrogate = v.identicalGeometry && v.maxPixel > 0 && v.allInkPass;
  }

  const report = {
    schemaVersion: '1.0.0',
    probe: 'anti-aliasing surrogate search',
    environment: {
      browser: 'chromium (playwright)',
      platform: process.platform,
      deviceScaleFactor: 1,
      viewport: { width: 390, height: 844 },
    },
    question: 'Which treatment changes glyph edge rasterisation while leaving metrics and ink amount unchanged?',
    variants,
    conclusion: {
      usableSurrogates: variants.filter(v => v.usableAsAaSurrogate).map(v => v.id),
      treatmentsWithNoMeasurableEffect: variants.filter(v => !v.producedAnyDifference).map(v => v.id),
      metricsChangingTreatments: variants.filter(v => !v.identicalGeometry).map(v => v.id),
    },
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('variant            geomΔ  maxPixel%  maxInkΔ  inkPass  usableAA  noEffect');
  for (const v of variants) {
    console.log(
      v.id.padEnd(18) +
      (v.identicalGeometry ? 'none  ' : 'moved ') +
      (v.maxPixel * 100).toFixed(2).padStart(8) + '  ' +
      v.maxInkDeviation.toFixed(4).padStart(8) + '  ' +
      String(v.allInkPass).padEnd(8) + '  ' +
      String(v.usableAsAaSurrogate).padEnd(8) + '  ' +
      String(!v.producedAnyDifference),
    );
  }
  console.log('wrote ' + path.relative(process.cwd(), OUT));
})();

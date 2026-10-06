/**
 * Meteoblue meteogramweb POC — cloud-function simulation.
 *
 * Simulates what `cloudfunctions/trailApi` would do (zero dependencies, Node
 * https like `lib/weather.js`), WITHOUT touching production code:
 *
 *   input:  a meteogramweb page URL
 *           e.g. https://www.meteoblue.com/en/weather/forecast/meteogramweb/emeishan_china_1811732
 *   output: { pageUrl, imageUrl, imageType, width, height, sourceMethod, ... }
 *
 * Verified mechanism (2026-10-06, see technical-findings.md):
 *   1. GET the meteogramweb page  → 200 text/html, no cookie/referer/auth needed.
 *   2. The HTML contains ONE load-bearing element:
 *          <div class="image img-scrollable" data-href="//my.meteoblue.com/images/meteogram?...&apikey=..&ts=..&sig=..">
 *      The data-href is a FULLY SIGNED, lat/lon-parameterized image endpoint.
 *      sourceMethod = "html".
 *   3. That endpoint does NOT return an image — with format=highcharts it returns
 *      application/json (a Highcharts config + full forecast series). The page
 *      renders it client-side as SVG (Highcharts). There is no standalone PNG.
 *
 * IMPORTANT BOUNDARY: this POC only ever replays the signed URL exactly as the
 * public page hands it over. It does NOT attempt to derive the signing secret
 * or to forge signatures (the endpoint answers 403 without a valid sig).
 *
 * Run:  node fetch-meteogram.js                       # default 4 locations
 *       node fetch-meteogram.js <meteogramweb-url>    # single location
 */

'use strict';

const https = require('https');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/126.0.0.0 Safari/537.36';

/** Minimal https GET with timing; no redirects expected but handled once. */
function get(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const req = https.get(
      url,
      { headers: { 'User-Agent': UA, Accept: '*/*' } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            contentType: res.headers['content-type'] || '',
            body: Buffer.concat(chunks),
            ms: Date.now() - t0,
          })
        );
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout ' + timeoutMs + 'ms')));
  });
}

/** Extract the signed meteogram endpoint from the page HTML. */
function extractImageUrl(html) {
  const attrs = html.match(/data-href="([^"]+)"/g) || [];
  for (const a of attrs) {
    const href = a.slice(11, -1).replace(/&amp;/g, '&');
    if (/my\.meteoblue\.com\/images\/meteogram/.test(href)) {
      return href.startsWith('//') ? 'https:' + href : href;
    }
  }
  return null;
}

async function fetchMeteogram(pageUrl) {
  const out = {
    pageUrl,
    imageUrl: null,
    imageType: null,
    width: null,
    height: null,
    sourceMethod: null,
    ok: false,
    error: null,
  };
  const timings = {};

  const page = await get(pageUrl);
  timings.pageMs = page.ms;
  if (page.status !== 200) {
    out.error = 'page HTTP ' + page.status;
    out.timings = timings;
    return out;
  }
  out.pageHttpStatus = page.status;
  out.pageContentType = page.contentType;

  const imageUrl = extractImageUrl(page.body.toString('utf8'));
  if (!imageUrl) {
    out.error = 'no signed data-href found in HTML';
    out.timings = timings;
    return out;
  }
  out.imageUrl = imageUrl;
  out.sourceMethod = 'html';

  const img = await get(imageUrl);
  timings.imageMs = img.ms;
  out.imageHttpStatus = img.status;
  out.imageContentType = img.contentType;
  out.imageBytes = img.body.length;
  out.timings = timings;

  if (img.status !== 200) {
    out.error = 'image endpoint HTTP ' + img.status;
    return out;
  }

  // The "image" is actually a Highcharts config (format=highcharts).
  if (/json/.test(img.contentType)) {
    out.imageType = 'application/json (Highcharts config; rendered client-side as SVG)';
    try {
      const cfg = JSON.parse(img.body.toString('utf8'));
      out.ok = cfg.isMeteogram === true;
      out.chartTitle = cfg.title && cfg.title.text;
      out.chartSubtitle = cfg.subtitle && cfg.subtitle.text;
      out.seriesCount = Array.isArray(cfg.series) ? cfg.series.length : null;
      out.seriesNames = Array.isArray(cfg.series)
        ? cfg.series.map((s) => s.name + ':' + s.type + ':' + (Array.isArray(s.data) ? s.data.length : '?'))
        : undefined;
    } catch (e) {
      out.error = 'JSON parse failed: ' + e.message;
    }
  } else {
    out.imageType = img.contentType;
    out.ok = /^image\//.test(img.contentType);
  }
  return out;
}

const DEFAULT_LOCATIONS = [
  'https://www.meteoblue.com/en/weather/forecast/meteogramweb/emeishan_china_1811732',
  'https://www.meteoblue.com/en/weather/forecast/meteogramweb/chengdu_china_1815286',
  'https://www.meteoblue.com/en/weather/forecast/meteogramweb/gaocheng_china_1810604', // 理塘（理塘县城高城镇）
  'https://www.meteoblue.com/en/weather/forecast/meteogramweb/dao-cheng-xian_china_1813787', // 稻城县
];

(async () => {
  const targets = process.argv[2] ? [process.argv[2]] : DEFAULT_LOCATIONS;
  const results = [];
  for (const url of targets) {
    const t0 = Date.now();
    let r;
    try {
      r = await fetchMeteogram(url);
    } catch (e) {
      r = { pageUrl: url, ok: false, error: e.message, sourceMethod: null };
    }
    r.totalMs = Date.now() - t0;
    results.push(r);
    console.log(JSON.stringify(r, null, 2));
  }
  if (!process.argv[2]) {
    const okCount = results.filter((r) => r.ok).length;
    console.error(`\nfetchMeteogram: ${okCount}/${results.length} locations ok`);
  }
})();

/**
 * Meteoblue meteogramweb — Layer 4 browser network POC (committed copy).
 *
 * 原始运行位置：仓库外临时目录（本仓库零 npm 依赖是铁律）。
 * 复跑步骤：
 *   1. mkdir %TEMP%\mb-poc-browser && cd /d %TEMP%\mb-poc-browser
 *   2. npm init -y && npm install playwright-core   （用系统 Edge，免下载浏览器）
 *   3. 把本文件复制过去，运行：node browser-network-poc.js
 *   4. 产出：evidence/network-*.json（全部真实请求）、evidence/summary-*.json、
 *           screens/<loc>.png（Meteogram 元素截图）、screens/<loc>-fullpage.png
 *
 * 注意：goto 用 domcontentloaded + 等待 .img-scrollable svg 出现，
 * 不能等 load 事件——广告/追踪脚本会让 load 永不触发（60s 超时实测）。
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const LOCATIONS = [
  { out: 'emeishan', url: 'https://www.meteoblue.com/en/weather/forecast/meteogramweb/emeishan_china_1811732' },
  { out: 'chengdu',  url: 'https://www.meteoblue.com/en/weather/forecast/meteogramweb/chengdu_china_1815286' },
  { out: 'litang',   url: 'https://www.meteoblue.com/en/weather/forecast/meteogramweb/gaocheng_china_1810604' },
  { out: 'daocheng', url: 'https://www.meteoblue.com/en/weather/forecast/meteogramweb/dao-cheng-xian_china_1813787' },
];

const SCREEN_DIR = path.join(__dirname, '..', 'screens');
const EVID_DIR = path.join(__dirname, '..', 'evidence');

(async () => {
  fs.mkdirSync(SCREEN_DIR, { recursive: true });
  fs.mkdirSync(EVID_DIR, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  console.log('browser launched:', browser.version());

  for (const loc of LOCATIONS) {
    const t0 = Date.now();
    const page = await browser.newPage({ viewport: { width: 1400, height: 2000 }, deviceScaleFactor: 2 });
    const reqs = [];
    page.on('response', (res) => {
      const h = res.headers();
      reqs.push({
        url: res.url(),
        status: res.status(),
        resourceType: res.request().resourceType(),
        contentType: h['content-type'] || '',
        size: h['content-length'] ? Number(h['content-length']) : null,
      });
    });
    await page.goto(loc.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const tLoad = Date.now() - t0;
    await page.waitForSelector('.img-scrollable svg', { timeout: 30000 }).catch(() => {});
    const tIdle = Date.now() - t0;
    await page.waitForTimeout(2000);

    const info = await page.evaluate(() => {
      const el = document.querySelector('.img-scrollable');
      return {
        title: document.title,
        containerFound: !!el,
        containerChildren: el ? [...el.children].map(c => c.tagName + (c.className ? '.' + String(c.className).split(' ')[0] : '')).slice(0, 8) : null,
        canvasCount: document.querySelectorAll('canvas').length,
        svgCount: document.querySelectorAll('svg').length,
        chartSvgInContainer: !!document.querySelector('.img-scrollable svg'),
        highchartsGlobal: window.Highcharts ? window.Highcharts.version : null,
      };
    });

    fs.writeFileSync(path.join(EVID_DIR, `network-${loc.out}.json`),
      JSON.stringify({ location: loc, tLoadMs: tLoad, tIdleMs: tIdle, dom: info, requests: reqs }, null, 2));

    const imgs = reqs.filter(r => /^image\//.test(r.contentType) || /\.(png|webp|jpe?g)(\?|$)/i.test(r.url));
    const meteoJson = reqs.filter(r => /my\.meteoblue\.com\/images\/meteogram/.test(r.url));
    const summary = {
      location: loc.out, title: info.title, tLoadMs: tLoad, tIdleMs: tIdle,
      totalRequests: reqs.length,
      rasterImageRequests: imgs.map(r => ({ status: r.status, ct: r.contentType, url: r.url.slice(0, 180) })),
      meteogramEndpointRequests: meteoJson.map(r => ({ status: r.status, ct: r.contentType, size: r.size })),
      dom: info,
    };
    fs.writeFileSync(path.join(EVID_DIR, `summary-${loc.out}.json`), JSON.stringify(summary, null, 2));

    const el = await page.$('.img-scrollable');
    if (el) await el.screenshot({ path: path.join(SCREEN_DIR, `${loc.out}.png`) });
    await page.screenshot({ path: path.join(SCREEN_DIR, `${loc.out}-fullpage.png`), fullPage: true });

    console.log(`== ${loc.out} ==`);
    console.log(JSON.stringify(summary, null, 2));
    await page.close();
  }
  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('FATAL', e && e.message); process.exit(1); });

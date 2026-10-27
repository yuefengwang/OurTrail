const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const outputDirectory = process.env.WEATHER_QA_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'ourtrail-weather-qa-'));
fs.mkdirSync(outputDirectory, { recursive: true });
async function main() {
  const launchOptions = { headless: true };
  if (process.env.CHROME_EXECUTABLE_PATH) launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage({ viewport: { width: 736, height: 2500 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(__dirname, 'index.html')).href);
    const frame = page.frameLocator('iframe');
    const app = frame.locator('#ot-weather-app');
    await app.waitFor();
    const settle = () => page.waitForTimeout(220);
    const click = async selector => { await frame.locator(selector).first().click(); await settle(); };
    const state = () => app.evaluate(() => window.openai.widgetState?.privateContent?.state);
    let checkCount = 0;
    const check = (label, condition) => { assert.ok(condition, label); checkCount += 1; console.log('PASS', label); };
    const capture = async filename => {
      await page.setViewportSize({ width: 736, height: 2500 });
      await app.evaluate(() => window.scrollTo(0, 0));
      await page.evaluate(() => window.scrollTo(0, 0));
      await settle();
      await app.screenshot({ path: path.join(outputDirectory, filename) });
      await page.setViewportSize({ width: 736, height: 2500 });
      await settle();
    };
    check('route is default', await frame.locator('[data-tab="route"]').getAttribute('aria-selected') === 'true');
    await click('[data-action="day"][data-day="2"]');
    check('D2 has three arrival events', await frame.locator('.ot-stop').count() === 3);
    await click('[data-stop="s5"]');
    await frame.locator('#ot-chart svg').waitFor();
    await click('[data-tab="cloud"]');
    check('cloud detail selected', await frame.locator('[data-tab="cloud"]').getAttribute('aria-selected') === 'true');
    const before = await frame.locator('#ot-readout').innerText();
    await click('[data-action="next-hour"]');
    check('hour control updates linked readout', before !== await frame.locator('#ot-readout').innerText());
    for (const width of [320, 375, 390, 414]) {
      await app.evaluate((element, width) => element.style.maxWidth = width + 'px', width);
      await settle();
      const overflow = await app.evaluate(element => {
        const outer = element.getBoundingClientRect();
        return Array.from(element.querySelectorAll('button,input,select,h1,h2,h3,p,.ot-chart')).filter(node => {
          const bounds = node.getBoundingClientRect();
          return bounds.width > 0 && (bounds.left < outer.left - 1 || bounds.right > outer.right + 1);
        }).map(node => node.outerHTML.slice(0, 160));
      });
      check('cloud layout fits ' + width + 'px: ' + overflow.join(','), overflow.length === 0);
      const overlaps = await frame.locator('#ot-chart svg').evaluate(svg => {
        const labels = [...svg.querySelectorAll('text')].map(node => ({ text: node.textContent, box: node.getBoundingClientRect() }));
        const collisions = [];
        for (let first = 0; first < labels.length; first++) {
          for (let second = first + 1; second < labels.length; second++) {
            const left = labels[first], right = labels[second];
            if (Math.min(left.box.right, right.box.right) - Math.max(left.box.left, right.box.left) > 1 && Math.min(left.box.bottom, right.box.bottom) - Math.max(left.box.top, right.box.top) > 1) collisions.push([left.text, right.text]);
          }
        }
        return collisions;
      });
      check('chart labels do not overlap ' + width + 'px: ' + JSON.stringify(overlaps), overlaps.length === 0);
    }
    await click('[data-period="72"]');
    check('72-hour selector works', await frame.locator('#ot-hour').getAttribute('max') === '71');
    await frame.locator('#ot-query-date').fill('2026-12-01');
    await frame.locator('#ot-query-date').dispatchEvent('change');
    await settle();
    check('out-of-range hides forecast', await frame.locator('#ot-chart').count() === 0);
    await click('[data-action="available-date"]');
    await click('[data-action="edit-plan"]');
    await frame.locator('[data-edit-time="s2"]').fill('07:00');
    await frame.locator('[data-edit-time="s2"]').dispatchEvent('input');
    await click('[data-action="save-plan"]');
    check('out-of-order arrival rejected', (await frame.locator('#ot-plan-error').innerText()).includes('递增'));
    await click('[data-action="cancel-plan"]');
    check('cancel preserves original time', (await state()).stops.find(stop => stop.id === 's2').time === '13:30');
    await click('[data-action="copy-plan"]');
    await frame.locator('#ot-plan-name').fill('两日徒步 · 独立副本');
    await frame.locator('#ot-start-date').fill('2026-11-02');
    await frame.locator('#ot-start-date').dispatchEvent('input');
    await click('[data-action="save-plan"]');
    let current = await state();
    check('copy retains original and separate plan', current.planRecords.length === 2 && current.planRecords[0].startDate === '2026-10-31' && current.planRecords[1].startDate === '2026-11-02');
    await click('[data-action="home"]');
    await click('[data-action="open-plan"][data-plan="plan-base"]');
    check('original independently accessible', (await state()).startDate === '2026-10-31');
    await click('[data-action="home"]');
    await click('[data-action="coordinate"]');
    await frame.locator('input[name="name"]').fill('测试收藏地点');
    await click('[data-action="query-point"]');
    check('single point hides route tab', await frame.locator('[data-tab="route"]').count() === 0);
    check('missing elevation does not create reference line', await frame.locator('.ot-reference').count() === 0);
    await click('[data-action="favorite"]');
    await click('[data-action="favorites"]');
    check('favorite stored separately', await frame.locator('.ot-item-body').filter({ hasText: '测试收藏地点' }).count() === 1);
    await click('[data-action="home"]');
    await click('[data-action="import"]');
    await click('[data-action="sample-import"]');
    await click('[data-action="confirm-import"]');
    current = await state();
    check('import preserves plans and favorites', current.planRecords.length === 2 && current.favoritePlaces.some(place => place.name === '测试收藏地点'));
    check('new route has no invented arrival times', current.stops.every(stop => stop.time === ''));
    await click('[data-action="home"]');
    await click('[data-action="home-tab"][data-tab="routes"]');
    check('import and existing route both retained', await frame.locator('.ot-saved-item').count() === 2);
    await click('[data-action="home-tab"][data-tab="plans"]');
    await click('[data-action="open-plan"][data-plan="plan-base"]');
    await click('[data-stop="s2"]');
    await click('[data-tab="cloud"]');
    const inject = async scenario => {
      await app.evaluate((element, scenario) => {
        const saved = structuredClone(window.openai.widgetState);
        saved.privateContent.writerId = 'qa-external';
        saved.privateContent.state.scenario = scenario;
        return window.openai.setWidgetState(saved);
      }, scenario);
      await settle();
    };
    await inject('missing');
    check('missing cloud explicitly labeled', (await frame.locator('#ot-chart').textContent()).includes('云层数据缺失') && (await app.innerText()).includes('云层廓线缺失'));
    check('missing cloud does not draw contour fills', await frame.locator('#ot-chart path[fill^="var(--ot-cloud"]').count() === 0);
    await inject('offline');
    check('offline cache labeled', (await app.innerText()).includes('离线缓存演示'));
    await inject('normal');
    await page.setViewportSize({ width: 375, height: 900 });
    await settle();
    check('narrow host does not overflow', await app.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    await page.setViewportSize({ width: 736, height: 2500 });
    await capture('weather-cloud-final.png');
    await click('[data-tab="route"]');
    await capture('weather-route-final.png');
    await click('[data-action="home"]');
    await capture('weather-home-final.png');
    await click('[data-action="open-plan"][data-plan="plan-base"]');
    await click('[data-action="edit-plan"]');
    await capture('weather-plan-final.png');
    check('no browser runtime errors: ' + errors.join(','), errors.length === 0);
    console.log('ALL CHECKS PASSED (' + checkCount + ')');
    console.log('Screenshots: ' + outputDirectory);
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });

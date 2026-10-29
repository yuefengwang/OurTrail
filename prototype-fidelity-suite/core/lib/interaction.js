'use strict';
/**
 * Interaction checks.
 *
 * A check is only PASS when a real action ran AND its consequence was observed
 * (same rule as the host repository's UI E2E semantics). If the action ran but
 * the consequence could not be read, the check is UNVERIFIED, never PASS.
 *
 * Declarative shape (pf.config.json → pages[].interactions[]):
 *   {
 *     "id": "tab-points",
 *     "title": "switch to saved places",
 *     "do": [{ "tap": { "selector": ".wh-tab", "index": 1 } }, { "wait": 400 }],
 *     "expect": {
 *       "exists": ".wh-quiet",
 *       "textIncludes": { "selector": ".wh-quiet", "text": "还没有常用地点" },
 *       "dataEquals": { "homeTab": "points" }
 *     },
 *     "screenshot": true
 *   }
 */
const path = require('path');
const fs = require('fs');
const { PfError, ensureDir, isoNow, writeFileRetry } = require('./util');
const { detectAutomator } = require('./env');
const { createRequire } = require('module');

function sel(spec) {
  if (typeof spec === 'string') return { selector: spec, index: null };
  return { selector: spec.selector, index: spec.index == null ? null : spec.index };
}

function evaluate(expect, observed) {
  const results = [];
  for (const [key, want] of Object.entries(expect || {})) {
    if (key === 'exists') {
      results.push({ assertion: `exists ${want}`, pass: observed.exists(want) === true, observed: observed.exists(want) });
    } else if (key === 'notExists') {
      results.push({ assertion: `not exists ${want}`, pass: observed.exists(want) === false, observed: observed.exists(want) });
    } else if (key === 'textEquals') {
      const got = observed.text(want.selector);
      results.push({ assertion: `text(${want.selector}) === ${JSON.stringify(want.text)}`, pass: got === want.text, observed: got });
    } else if (key === 'textIncludes') {
      const got = observed.text(want.selector);
      results.push({
        assertion: `text(${want.selector}) includes ${JSON.stringify(want.text)}`,
        pass: typeof got === 'string' && got.includes(want.text), observed: got,
      });
    } else if (key === 'dataEquals') {
      const data = observed.data();
      if (!data) {
        results.push({ assertion: `data ${JSON.stringify(want)}`, pass: null, observed: 'page data unavailable' });
        continue;
      }
      for (const [k, v] of Object.entries(want)) {
        results.push({
          assertion: `data.${k} === ${JSON.stringify(v)}`,
          pass: JSON.stringify(data[k]) === JSON.stringify(v),
          observed: data[k],
        });
      }
    } else if (key === 'count') {
      const got = observed.count(want.selector);
      results.push({ assertion: `count(${want.selector}) === ${want.equals}`, pass: got === want.equals, observed: got });
    } else {
      results.push({ assertion: `unknown expectation ${key}`, pass: null, observed: 'unsupported' });
    }
  }
  return results;
}

function statusOf(results) {
  if (!results.length) return 'UNVERIFIED';
  if (results.some(r => r.pass === false)) return 'FAIL';
  if (results.some(r => r.pass == null)) return 'UNVERIFIED';
  return 'PASS';
}

async function runChecks(driver, checks, ctx) {
  const out = [];
  const dir = ctx && ctx.outDir;
  if (dir) ensureDir(dir);
  for (const check of checks) {
    const record = {
      id: check.id, title: check.title || '',
      status: 'UNVERIFIED',
      expected: check.expect || null,
      observed: null,
      assertions: [],
      startedAt: isoNow(),
      screenshotPath: null,
    };
    try {
      if (ctx && ctx.resetTo && check.reset !== false) await driver.open(ctx.resetTo);
      const actions = check.do || [];
      for (const step of actions) {
        if (step.tap) await driver.tap(sel(step.tap));
        else if (step.wait) await driver.wait(step.wait);
        else if (step.waitFor) await driver.waitFor(sel(step.waitFor), step.timeout);
        else if (step.input) await driver.input(sel(step.input), step.value);
      }
      const observed = await driver.observe(collectSelectors(check));
      const results = evaluate(check.expect, observed);
      record.assertions = results;
      record.status = statusOf(results);
      record.observed = results.map(r => `${r.pass === true ? 'ok' : r.pass === false ? 'FAIL' : '?'} ${r.assertion} → ${truncate(r.observed)}`).join(' | ');
      if (check.screenshot) {
        const file = path.join(dir || process.cwd(), check.id + '.png');
        await driver.screenshot(file);
        record.screenshotPath = fs.existsSync(file) ? file : null;
      }
      record.finishedAt = isoNow();
      record.durationMs = Date.parse(record.finishedAt) - Date.parse(record.startedAt);
      record.verification = 'real-action-and-observation';
    } catch (e) {
      record.status = e instanceof PfError && e.code === 'DRIVER_UNAVAILABLE' ? 'BLOCKED' : 'FAIL';
      record.error = e.message;
    }
    out.push(record);
  }
  return out;
}

function truncate(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s == null ? 'null' : s.length > 80 ? s.slice(0, 77) + '…' : s;
}

function collectSelectors(check) {
  const list = new Set();
  const add = s => { if (s) list.add(typeof s === 'string' ? s : s.selector); };
  for (const step of check.do || []) {
    add(step.tap); add(step.waitFor); add(step.input && step.input.selector);
  }
  const e = check.expect || {};
  add(e.exists); add(e.notExists); add(e.textEquals && e.textEquals.selector);
  add(e.textIncludes && e.textIncludes.selector); add(e.count && e.count.selector);
  return [...list];
}

// ------------------------------------------------------------------ drivers

async function openDriver(adapterId, cfg, opts) {
  const open = DRIVERS[adapterId];
  if (!open) throw new PfError('DRIVER_UNKNOWN', `no interaction driver for adapter "${adapterId}"`);
  return open(cfg, opts);
}

const DRIVERS = {
  'wechat-miniprogram': (cfg, opts) => openMpDriver(cfg, opts),
  web: (cfg, opts) => openWebDriver(cfg, opts),
};

/** Adapter ids that can perform a declared action, not just capture. */
function drivers() {
  return Object.keys(DRIVERS);
}

async function openMpDriver(cfg) {
  const found = detectAutomator();
  if (found.status !== 'available') {
    throw new PfError('DRIVER_UNAVAILABLE', 'miniprogram-automator not found (set NODE_PATH or MINIPROGRAM_AUTOMATOR_PATH)');
  }
  const req = createRequire(path.join(found.path, 'noop.js'));
  const automator = req(found.path);
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: cfg.wsEndpoint || 'ws://127.0.0.1:9421' });
  } catch (e) {
    throw new PfError('DRIVER_UNAVAILABLE', `cannot connect to ${cfg.wsEndpoint}: ${e.message}`);
  }
  let page = null;
  const cache = new Map();
  const element = async (spec) => {
    const { selector, index } = sel(spec);
    const els = await page.$$(selector);
    if (!els || !els.length) return null;
    return index == null ? els[0] : els[Math.min(index, els.length - 1)] || null;
  };
  return {
    kind: 'wechat-miniprogram',
    async open(pagePath) {
      page = await mp.reLaunch(pagePath || cfg.pagePath);
      if (!page) throw new PfError('DRIVER_OPEN', `reLaunch failed for ${pagePath}`);
      cache.clear();
      await page.waitFor(cfg.settleMs || 1200);
      return page;
    },
    async tap(spec) {
      const el = await element(spec);
      if (!el) throw new PfError('DRIVER_TARGET', `tap target not found: ${JSON.stringify(spec)}`);
      await el.tap();
      await page.waitFor(120);
    },
    async input(spec, value) {
      const el = await element(spec);
      if (!el) throw new PfError('DRIVER_TARGET', `input target not found: ${JSON.stringify(spec)}`);
      await el.input(value);
      await page.waitFor(120);
    },
    async wait(ms) { await page.waitFor(ms); },
    async waitFor(spec) {
      for (let i = 0; i < 20; i++) {
        if (await element(spec)) return true;
        await page.waitFor(100);
      }
      return false;
    },
    async observe(selectors) {
      const texts = new Map();
      const counts = new Map();
      for (const s of selectors) {
        let els = [];
        try { els = await page.$$(s); } catch (_) { els = []; }
        counts.set(s, els.length);
        if (els.length) {
          try { texts.set(s, String(await els[0].text())); } catch (_) { texts.set(s, null); }
        }
      }
      const data = await page.data().catch(() => null);
      return {
        exists: s => counts.has(s) ? counts.get(s) > 0 : false,
        text: s => texts.get(s) == null ? null : texts.get(s),
        count: s => counts.get(s) || 0,
        data: () => data,
      };
    },
    async screenshot(file) {
      const shot = await mp.screenshot();
      ensureDir(path.dirname(file));
      writeFileRetry(file, Buffer.from(String(shot), 'base64'));
      return file;
    },
    async close() { await mp.disconnect().catch(() => {}); },
  };
}

async function openWebDriver(cfg) {
  const { detectPlaywright } = require('./env');
  const found = detectPlaywright();
  if (found.status !== 'available') throw new PfError('DRIVER_UNAVAILABLE', 'playwright not found outside the repo');
  const playwright = require(found.path);
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: cfg.viewport || { width: 390, height: 844 }, deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const resolve = async (spec) => {
    const { selector, index } = sel(spec);
    const loc = page.locator(selector);
    return index == null ? loc.first() : loc.nth(index);
  };
  return {
    kind: 'web',
    async open(url) {
      await page.goto(url, { waitUntil: 'networkidle' });
      return page;
    },
    async tap(spec) {
      const loc = await resolve(spec);
      if (!(await loc.count())) throw new PfError('DRIVER_TARGET', `tap target not found: ${JSON.stringify(spec)}`);
      await loc.click();
    },
    async input(spec, value) {
      const loc = await resolve(spec);
      await loc.fill(String(value));
    },
    async wait(ms) { await page.waitForTimeout(ms); },
    async waitFor(spec) {
      const loc = await resolve(spec);
      await loc.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      return (await loc.count()) > 0;
    },
    async observe(selectors) {
      const counts = new Map();
      const texts = new Map();
      for (const s of selectors) {
        const loc = page.locator(s);
        const n = await loc.count();
        counts.set(s, n);
        if (n) texts.set(s, await loc.first().textContent().catch(() => null));
      }
      return {
        exists: s => counts.get(s) > 0,
        text: s => (texts.has(s) ? texts.get(s) : null),
        count: s => counts.get(s) || 0,
        data: () => null,
      };
    },
    async screenshot(file) {
      ensureDir(path.dirname(file));
      await page.screenshot({ path: file, animations: 'disabled', caret: 'hide', scale: 'css' });
      return file;
    },
    async close() { await browser.close().catch(() => {}); },
  };
}

module.exports = { runChecks, openDriver, openMpDriver, openWebDriver, drivers, evaluate, statusOf, collectSelectors };

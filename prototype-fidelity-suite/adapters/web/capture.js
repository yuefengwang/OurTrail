'use strict';
/**
 * Web adapter: Playwright (resolved from outside the repository).
 *
 * Determinism decisions (see docs/research-report.md §2):
 *  - deviceScaleFactor = 1 and element-clipped screenshots in CSS px, so the
 *    pixels a reviewer opens are the same numbers the geometry report prints
 *  - `animations: 'disabled'`, `caret: 'hide'`
 *  - fonts and images are awaited explicitly (Playwright's screenshotter does
 *    not do this for us)
 *  - rects are reported relative to the captured frame, never to the document,
 *    so a toolbar or preview chrome above the frame costs nothing
 */
const fs = require('fs');
const path = require('path');
const { ensureDir, PfError } = require('../../core/lib/util');
const { detectPlaywright } = require('../../core/lib/env');

const STYLE_PROPS = [
  'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align',
  'color', 'background-color', 'border-radius', 'border-top-width', 'border-top-color',
  'border-bottom-width', 'border-bottom-color', 'box-shadow', 'opacity', 'padding', 'margin', 'gap',
  'display', 'flex-direction', 'align-items', 'justify-content', 'overflow',
  'position', 'white-space', 'text-transform', 'width', 'height',
  'min-height', 'box-sizing',
];

function loadPlaywright() {
  const found = detectPlaywright();
  if (found.status !== 'available') {
    throw new PfError('PLAYWRIGHT_MISSING',
      'playwright not found outside the repo; set PLAYWRIGHT_MODULE_PATH', found);
  }
  try {
    return require(found.path);
  } catch (e) {
    throw new PfError('PLAYWRIGHT_LOAD', `cannot require ${found.path}: ${e.message}`);
  }
}

const SNAPSHOT_SCRIPT = (args) => {
  const { rootSelector, props, frame, probeSelectors } = args;
  const root = rootSelector ? document.querySelector(rootSelector) : document.body;
  if (!root) return { error: 'root not found: ' + rootSelector };
  const originX = frame ? frame.x : 0;
  const originY = frame ? frame.y : 0;

  const structuralPath = el => {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      const parent = cur.parentElement;
      let seg = cur.tagName.toLowerCase();
      if (cur.id) seg += '#' + cur.id;
      else if (cur.classList.length) seg += '.' + [...cur.classList].join('.');
      if (parent) {
        const same = [...parent.children].filter(c => c.tagName === cur.tagName);
        if (same.length > 1) seg += ':nth(' + same.indexOf(cur) + ')';
      }
      parts.unshift(seg);
      if (cur === root) break;
      cur = parent;
    }
    return parts.join('>');
  };

  const lineCountOf = el => {
    if (!el.firstChild) return null;
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter(r => r.width > 0.5 && r.height > 0.5);
    if (!rects.length) return null;
    const tops = new Set(rects.map(r => Math.round(r.top)));
    return tops.size;
  };

  const nodes = [];
  const index = new Map();
  const walk = (el, parentId) => {
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const styles = {};
    for (const p of props) {
      const camel = p.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const v = cs[camel];
      if (v != null && v !== '') styles[p] = v;
    }
    const classes = [...el.classList];
    const selectors = classes.map(c => '.' + c);
    if (el.id) selectors.unshift('#' + el.id);
    const visible = !!(rect.width > 0 && rect.height > 0 && cs.visibility !== 'hidden' &&
      cs.display !== 'none' && Number(cs.opacity) > 0);
    const node = {
      id: 'n' + nodes.length,
      parentId,
      children: [],
      path: structuralPath(el),
      tag: el.tagName.toLowerCase(),
      sel: el.id ? '#' + el.id : (classes[0] ? '.' + classes[0] : el.tagName.toLowerCase()),
      selectors,
      text: el.childElementCount === 0 ? (el.textContent || '').trim() : '',
      rect: {
        x: Math.round((rect.left + window.scrollX - originX) * 100) / 100,
        y: Math.round((rect.top + window.scrollY - originY) * 100) / 100,
        w: Math.round(rect.width * 100) / 100,
        h: Math.round(rect.height * 100) / 100,
      },
      styles,
      visible,
      lineCount: el.childElementCount === 0 ? lineCountOf(el) : null,
    };
    index.set(el, node.id);
    nodes.push(node);
    if (parentId) {
      const parent = nodes[Number(parentId.slice(1))];
      if (parent) parent.children.push(node.id);
    }
    for (const child of el.children) walk(child, node.id);
    return node.id;
  };
  walk(root, null);

  for (const sel of probeSelectors || []) {
    let hits;
    try { hits = [...document.querySelectorAll(sel)]; } catch (_) { continue; }
    for (const el of hits) {
      const id = index.get(el);
      if (id == null) continue;
      const node = nodes[Number(id.slice(1))];
      if (!node.selectors.includes(sel)) node.selectors.push(sel);
    }
  }

  return {
    nodes,
    rootSelector: rootSelector || 'body',
    rootId: 'n0',
    documentSize: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
    scroll: { x: window.scrollX, y: window.scrollY },
  };
};

async function capture(opts) {
  const o = opts || {};
  const playwright = loadPlaywright();
  const viewport = o.viewport || { width: 390, height: 844 };
  // deviceScaleFactor > 1 models a retina render: the screenshot is larger than
  // the CSS box and `screenshotScale` tells the region comparer to normalise it.
  // With dpr = 1 the capture stays in CSS px so numbers match the geometry report.
  const dpr = Number(o.dpr) > 0 ? Number(o.dpr) : 1;
  const browser = await playwright.chromium.launch({ headless: o.headless !== false });
  try {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: dpr,
      locale: o.locale || 'zh-CN',
      timezoneId: o.timezone || 'Asia/Shanghai',
      colorScheme: 'light',
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    if (o.url) await page.goto(o.url, { waitUntil: 'load', timeout: o.timeout || 30000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    if (o.inject) await page.evaluate(o.inject);
    if (o.waitForSelector) await page.waitForSelector(o.waitForSelector, { timeout: o.timeout || 15000 });
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      for (const img of document.images) {
        if (!img.complete) await new Promise(r => { img.onload = img.onerror = r; });
        if (img.decode) await img.decode().catch(() => {});
      }
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    if (o.waitMs) await page.waitForTimeout(o.waitMs);

    const frameSelector = o.frameSelector || null;
    let box = null;
    if (frameSelector) {
      box = await page.locator(frameSelector).boundingBox();
      if (!box) throw new PfError('FRAME_NOT_FOUND', `frame selector not visible: ${frameSelector}`);
    }

    const snapshot = await page.evaluate(SNAPSHOT_SCRIPT, {
      rootSelector: o.rootSelector || frameSelector || null,
      props: STYLE_PROPS,
      frame: box ? { x: box.x, y: box.y } : null,
      probeSelectors: o.probeSelectors || [],
    });
    if (snapshot.error) throw new PfError('SNAPSHOT_FAILED', snapshot.error);

    ensureDir(o.outDir);
    const shotPath = path.join(o.outDir, 'screenshot.png');
    await page.screenshot({
      path: shotPath,
      clip: box || undefined,
      animations: 'disabled',
      caret: 'hide',
      scale: dpr === 1 ? 'css' : 'device',
    });
    const scale = { x: dpr, y: dpr };

    return {
      screenshotPath: shotPath,
      snapshot,
      viewport: { width: snapshot.viewport.width, height: snapshot.viewport.height },
      dpr,
      screenshotScale: scale,
      screenshotSize: {
        width: Math.round((box ? box.width : viewport.width) * scale.x),
        height: Math.round((box ? box.height : viewport.height) * scale.y),
      },
      documentSize: snapshot.documentSize,
      platform: 'web',
      url: o.url,
      dataSource: o.inject ? 'injected' : 'real',
      injection: o.inject ? String(o.inject).slice(0, 500) : null,
      nodeCount: snapshot.nodes.length,
      rootId: snapshot.rootId,
      note: null,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { id: 'web', capture, STYLE_PROPS, SNAPSHOT_SCRIPT };

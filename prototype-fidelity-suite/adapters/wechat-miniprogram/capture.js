'use strict';
/**
 * WeChat mini program adapter: miniprogram-automator against a running
 * DevTools automation endpoint.
 *
 * Why not CDP: on the IDE build probed on 2026-10-28, `mp.CDP()` accepted the
 * connection but every `sendCommand` / DOM evaluation came back with
 * `appservice App.CDPEnable unimplemented` (three call shapes, same error; see
 * docs/research-report.md §5 for the raw reading), so DOM-wide
 * `getComputedStyle` is unavailable. The element API still returns real computed
 * styles and document-space offsets, which is what this adapter uses. This is a
 * reading from one build on one day, not a platform ceiling — re-probe before
 * assuming it still holds.
 *
 * Coordinate basis: offsets are document-space; `scrollTop` is subtracted so the
 * result is the same "viewport CSS px" basis the web adapter reports. Screenshots
 * come back at a scale that is NOT 1 (observed 306×660 for a 390×844 viewport), so
 * the scale is measured and recorded per capture rather than assumed.
 */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { ensureDir, PfError, round } = require('../../core/lib/util');
const { expandBox } = require('../../core/lib/geometry');
const { detectAutomator } = require('../../core/lib/env');

const STYLE_PROPS = [
  'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align',
  'color', 'background-color', 'border-radius', 'border-top-width', 'border-top-color',
  'border-bottom-width', 'border-bottom-color',
  'box-shadow', 'opacity', 'padding', 'margin', 'display', 'flex-direction',
  'align-items', 'justify-content', 'white-space', 'gap',
  'min-height', 'box-sizing', 'width', 'height',
];

function loadAutomator() {
  const found = detectAutomator();
  if (found.status !== 'available') {
    throw new PfError('AUTOMATOR_MISSING',
      'miniprogram-automator not found; set MINIPROGRAM_AUTOMATOR_PATH or NODE_PATH', found);
  }
  const req = createRequire(path.join(found.path, 'noop.js'));
  return req(found.path);
}

function num(v) {
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
}

async function readScrollTop(page) {
  try {
    const v = await page.scrollTop();
    return typeof v === 'number' ? v : null;
  } catch (_) {
    return null;
  }
}

async function probeSelector(page, selector, scrollTop) {
  let els;
  try {
    els = await page.$$(selector);
  } catch (e) {
    return [{ error: e.message, sel: selector }];
  }
  if (!els || !els.length) return [];
  const out = [];
  for (const el of els) {
    const rec = { sel: selector, selectors: [selector] };
    try { rec.offset = await el.offset(); } catch (e) { rec.offsetError = e.message; }
    try { rec.size = await el.size(); } catch (e) { rec.sizeError = e.message; }
    try { rec.text = String(await el.text()); } catch (e) { rec.textError = e.message; }
    const styles = {};
    for (const p of STYLE_PROPS) {
      try {
        const v = await el.style(p);
        if (v != null && v !== '') styles[p] = v;
      } catch (_) { /* property not supported on this element type */ }
    }
    rec.styles = styles;
    out.push(rec);
  }
  return out.map((r, i) => toNode(r, i, scrollTop));
}

function toNode(rec, i, scrollTop) {
  const offset = rec.offset || { left: 0, top: 0 };
  const size = rec.size || { width: 0, height: 0 };
  const top = offset.top - (scrollTop || 0);
  const lineHeight = num(rec.styles && rec.styles['line-height']);
  const fontSize = num(rec.styles && rec.styles['font-size']);
  // The reported box includes padding and borders; a line count computed from it
  // counts them too (a 50 px single-column card read as three lines). Use the
  // content box, which is what line boxes actually stack in.
  const pad = expandBox(rec.styles && rec.styles.padding);
  const borderY = (num(rec.styles && rec.styles['border-top-width']) || 0)
    + (num(rec.styles && rec.styles['border-bottom-width']) || 0);
  const contentH = size.height - (pad ? (pad[0] || 0) + (pad[2] || 0) : 0) - borderY;
  const inferredLines = lineHeight && lineHeight > 0 ? Math.max(1, Math.round(contentH / lineHeight)) : null;
  return {
    id: 's' + i,
    parentId: null,
    children: [],
    path: 'selector:' + rec.sel,
    tag: 'node',
    sel: rec.sel,
    selectors: rec.selectors || [rec.sel],
    text: rec.text || '',
    rect: { x: round(offset.left, 2), y: round(top, 2), w: round(size.width, 2), h: round(size.height, 2) },
    styles: rec.styles || {},
    visible: !!(size.width > 0 && size.height > 0),
    lineCount: inferredLines,
    lineCountSource: inferredLines == null ? 'unknown' : 'inferred',
    fontSize: fontSize,
    offsetRaw: { left: offset.left, top: offset.top },
    note: rec.error || null,
  };
}

/** Page-level facts that are cheap and often decide whether a capture is valid. */
async function probeEnvironment(page) {
  const data = await page.data().catch(() => null);
  const facts = {};
  if (data) {
    facts.keys = Object.keys(data);
    facts.screen = data.screen || null;
    facts.homeTab = data.homeTab || null;
    facts.plansState = data.plansState || null;
    facts.plans = Array.isArray(data.plans) ? data.plans.length : null;
    facts.sharedPlans = Array.isArray(data.sharedPlans) ? data.sharedPlans.length : null;
    facts.lastPlan = data.lastPlan ? (data.lastPlan.name || true) : null;
    facts.updatedAt = data.updatedAt || null;
  }
  return facts;
}

async function capture(opts) {
  const o = opts || {};
  const automator = loadAutomator();
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: o.wsEndpoint || 'ws://127.0.0.1:9421' });
  } catch (e) {
    throw new PfError('AUTOMATOR_CONNECT', `cannot connect to ${o.wsEndpoint}: ${e.message}`);
  }
  try {
    if (!o.pagePath) throw new PfError('CAPTURE_CONFIG', 'mini program capture requires pagePath');
    const page = await mp.reLaunch(o.pagePath);
    if (!page) throw new PfError('CAPTURE_ROUTE', `reLaunch returned no page for ${o.pagePath}`);
    await page.waitFor(o.settleMs || 2500);
    if (o.injectData) {
      await page.setData(o.injectData);
      await page.waitFor(o.injectSettleMs || 1200);
    }
    const scrollTop = await readScrollTop(page);
    const systemInfo = await mp.systemInfo().catch(() => null);
    const envFacts = await probeEnvironment(page);

    const nodes = [];
    for (const sel of o.selectors || []) {
      const list = await probeSelector(page, sel, scrollTop);
      for (const n of list) {
        if (n.error) { nodes.push({ id: 'err' + nodes.length, sel, error: n.error, visible: false, rect: null, styles: {}, text: '' }); continue; }
        n.id = 's' + nodes.length;
        nodes.push(n);
      }
    }

    ensureDir(o.outDir);
    const shotPath = path.join(o.outDir, 'screenshot.png');
    const shot = await mp.screenshot();
    const buf = Buffer.from(String(shot), 'base64');
    fs.writeFileSync(shotPath, buf);

    const width = readPngSize(buf).width;
    const height = readPngSize(buf).height;
    const viewport = systemInfo ? { width: systemInfo.windowWidth, height: systemInfo.windowHeight } : null;
    const scale = viewport && viewport.width ? { x: width / viewport.width, y: height / viewport.height } : null;

    return {
      screenshotPath: shotPath,
      snapshot: {
        nodes,
        rootId: nodes.length ? nodes[0].id : null,
        viewport: viewport ? { ...viewport, dpr: systemInfo.pixelRatio } : null,
        scroll: { x: 0, y: scrollTop == null ? null : scrollTop },
        documentSize: o.pagePath ? null : null,
        facts: envFacts,
      },
      viewport,
      dpr: systemInfo ? systemInfo.pixelRatio : null,
      screenshotScale: scale,
      screenshotSize: { width, height },
      platform: 'wechat-miniprogram',
      url: o.pagePath,
      dataSource: o.injectData ? 'injected' : 'real',
      injection: o.injectData ? summarizeInjection(o.injectData) : null,
      nodeCount: nodes.length,
      rootId: nodes.length ? nodes[0].id : null,
      device: systemInfo ? {
        model: systemInfo.model, platform: systemInfo.platform, system: systemInfo.system,
        SDKVersion: systemInfo.SDKVersion,
      } : null,
      note: scrollTop == null ? 'scrollTop unavailable; offsets treated as viewport coordinates' : null,
    };
  } finally {
    if (mp) await mp.disconnect().catch(() => {});
  }
}

function summarizeInjection(data) {
  const keys = Object.keys(data || {});
  const out = {};
  for (const k of keys.slice(0, 12)) {
    const v = data[k];
    out[k] = Array.isArray(v) ? `array(${v.length})` : typeof v;
  }
  return out;
}

function readPngSize(buf) {
  if (buf.length < 24) return { width: 0, height: 0 };
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

module.exports = { id: 'wechat-miniprogram', capture, STYLE_PROPS, readPngSize };

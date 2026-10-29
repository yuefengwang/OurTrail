'use strict';
/**
 * Design-DNA walker.
 *
 * One Playwright pass per *state* (a page frozen in a particular UI state) that
 * returns three things no fidelity snapshot needs but design extraction does:
 *
 *  1. `nodes`  — the rendered subtree with the style properties design decisions
 *     are made of, plus the affordance metadata (`role`, `aria-*`, `data-*`).
 *  2. `css`    — the *declared* CSSOM (selector → declarations, in cascade
 *     order, media queries kept). Computed styles can say "this is green" but
 *     never "green came from a token that a later sheet overrode".
 *  3. `vars`   — custom properties declared on `:root`, resolved and traced to
 *     the rules that consume them.
 *
 * Everything is a measurement. Deriving rules from it is `extract.js`'s job; the
 * walker never decides whether something is a design rule.
 */
const { detectPlaywright } = require('../../core/lib/env');
const { startServer } = require('./serve');

const PROPS = [
  // typography
  'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'text-transform',
  // surface
  'color', 'background-color', 'background-image',
  'border-top-width', 'border-top-color', 'border-top-style',
  'border-bottom-width', 'border-bottom-color', 'border-left-width', 'border-left-color',
  'border-radius', 'box-shadow', 'opacity', 'backdrop-filter',
  // box
  'display', 'position', 'width', 'height', 'min-width', 'min-height', 'max-height', 'box-sizing',
  'padding', 'margin', 'gap', 'row-gap', 'column-gap',
  'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'grid-template-columns',
  'overflow', 'overflow-x', 'white-space', 'text-overflow', 'z-index', 'transform',
  // inline SVG — icon language is a design decision, and computed style is the
  // only place it is observable (the fidelity snapshot treats icons as ink)
  'stroke', 'stroke-width', 'stroke-linecap', 'fill',
  'visibledummy',
];

// `visibledummy` above is filtered out in-page; it exists so the prop list stays a
// plain literal array with no trailing-comma ambiguity across engines.

const COLLECT = (args) => {
  const { rootSelector, props, frame } = args;
  const root = rootSelector ? document.querySelector(rootSelector) : document.body;
  if (!root) return { error: 'root not found: ' + rootSelector };
  const originX = frame ? frame.x : 0;
  const originY = frame ? frame.y : 0;
  const MAX_NODES = 6000;

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
    return new Set(rects.map(r => Math.round(r.top))).size;
  };

  const nodes = [];
  const byId = [];
  const walk = (el, parentId, depth) => {
    if (nodes.length >= MAX_NODES) return null;
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const styles = {};
    for (const p of props) {
      if (p === 'visibledummy') continue;
      const camel = p.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const v = cs[camel];
      if (v != null && v !== '') styles[p] = v;
    }
    const classes = [...el.classList];
    const selectors = classes.map(c => '.' + c);
    if (el.id) selectors.unshift('#' + el.id);
    const visible = !!(rect.width > 0 && rect.height > 0 && cs.visibility !== 'hidden' &&
      cs.display !== 'none' && Number(cs.opacity) > 0);
    const dataAttrs = {};
    for (const a of el.attributes) if (a.name.startsWith('data-')) dataAttrs[a.name] = a.value;
    const id = 'n' + nodes.length;
    const node = {
      id,
      parentId,
      depth,
      children: [],
      path: structuralPath(el),
      tag: el.tagName.toLowerCase(),
      classes,
      sel: el.id ? '#' + el.id : (classes[0] ? '.' + classes[0] : el.tagName.toLowerCase()),
      selectors,
      text: el.childElementCount === 0 ? (el.textContent || '').trim().replace(/\s+/g, ' ') : '',
      ownText: el.childElementCount === 0 ? (el.textContent || '').trim() : '',
      isLeaf: el.childElementCount === 0,
      childTags: [...el.children].map(c => c.tagName.toLowerCase()).join('+'),
      rect: {
        x: Math.round((rect.left + window.scrollX - originX) * 100) / 100,
        y: Math.round((rect.top + window.scrollY - originY) * 100) / 100,
        w: Math.round(rect.width * 100) / 100,
        h: Math.round(rect.height * 100) / 100,
      },
      styles,
      visible,
      lineCount: el.childElementCount === 0 ? lineCountOf(el) : null,
      flags: {
        role: el.getAttribute('role'),
        ariaSelected: el.getAttribute('aria-selected'),
        ariaPressed: el.getAttribute('aria-pressed'),
        ariaCurrent: el.getAttribute('aria-current'),
        ariaExpanded: el.getAttribute('aria-expanded'),
        ariaModal: el.getAttribute('aria-modal'),
        hiddenAttr: el.hasAttribute('hidden'),
        disabled: el.hasAttribute('disabled'),
        tabindex: el.getAttribute('tabindex'),
        tabindexNumeric: el.tabIndex,
      },
      dataAttrs,
    };
    nodes.push(node);
    byId.push(el);
    for (const child of el.children) {
      const cid = walk(child, id, depth + 1);
      if (cid) node.children.push(cid);
    }
    return id;
  };
  walk(root, null, 0);

  // ---- declared CSSOM -------------------------------------------------------
  const css = [];
  const sheets = [];
  const customProps = [];
  const keyframes = [];
  const varUsage = new Map();
  const literalColors = new Map();     // declared colour literals, not computed
  const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/g;

  const noteVars = (value, where) => {
    const re = /var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,\s*([^)]*))?\)/g;
    let m;
    while ((m = re.exec(value))) {
      const rec = varUsage.get(m[1]) || { name: m[1], count: 0, selectors: [] };
      rec.count++;
      if (where && rec.selectors.length < 10 && !rec.selectors.includes(where)) rec.selectors.push(where);
      varUsage.set(m[1], rec);
    }
  };
  const noteColors = (prop, value, where) => {
    if (!/color|shadow|background|border/.test(prop)) return;
    const hits = String(value).match(COLOR_RE);
    if (!hits) return;
    for (const raw of hits) {
      const v = raw.toLowerCase().replace(/\s+/g, '');
      const rec = literalColors.get(v) || { value: v, count: 0, props: {}, selectors: [] };
      rec.count++;
      rec.props[prop] = (rec.props[prop] || 0) + 1;
      if (where && rec.selectors.length < 10 && !rec.selectors.includes(where)) rec.selectors.push(where);
      literalColors.set(v, rec);
    }
  };

  const readRule = (rule, sheetName, order, media, depthGuard) => {
    if (!rule || depthGuard > 6) return;
    const type = rule.constructor && rule.constructor.name;
    if (type === 'CSSStyleRule' || (rule.selectorText && rule.style)) {
      // `style.getPropertyValue(prop)` returns '' for shorthands whose value
      // contains var() (Chromium expands them into empty longhands), which would
      // silently hide every `border-top: 1px solid var(--line)`. Re-parse the
      // authored cssText instead so declarations survive intact.
      const decls = {};
      const authored = rule.style ? rule.style.cssText : '';
      for (const part of authored.split(';')) {
        const i = part.indexOf(':');
        if (i <= 0) continue;
        const prop = part.slice(0, i).trim();
        const value = part.slice(i + 1).trim();
        if (prop && value) decls[prop] = value;
      }
      const rec = { sheet: sheetName, order: order.n++, media: media || null, selector: rule.selectorText, decls };
      css.push(rec);
      for (const prop of Object.keys(decls)) {
        noteVars(decls[prop], rule.selectorText);
        noteColors(prop, decls[prop], rule.selectorText);
      }
      if (/:root|^html$/.test(rule.selectorText || '')) {
        for (const prop of Object.keys(decls)) {
          if (prop.startsWith('--')) {
            customProps.push({ name: prop, value: decls[prop], sheet: sheetName, selector: rule.selectorText, media: media || null });
          }
        }
      }
      return;
    }
    if (type === 'CSSKeyframesRule' || rule.name && rule.cssRules && String(rule.type) === '7') {
      keyframes.push({ name: rule.name, sheet: sheetName });
      return;
    }
    if (rule.cssRules) {
      const sub = rule.conditionText ? `${rule.media ? '@media ' + rule.media.mediaText : '@supports ' + rule.conditionText}` : (rule.media ? '@media ' + rule.media.mediaText : null);
      for (const inner of rule.cssRules) readRule(inner, sheetName, order, sub || media, depthGuard + 1);
    }
  };

  for (let si = 0; si < document.styleSheets.length; si++) {
    const sheet = document.styleSheets[si];
    const name = (sheet.href || 'inline').split('/').pop();
    let rules = null;
    try { rules = sheet.cssRules; } catch (e) {
      sheets.push({ name, order: si, rules: 0, error: e.name });
      continue;
    }
    sheets.push({ name, order: si, rules: rules.length });
    const order = { n: 0 };
    for (const rule of rules) readRule(rule, name, order, null, 0);
  }

  // Resolved values for every declared custom property (cascade already applied).
  const rootStyle = getComputedStyle(document.documentElement);
  const seenVar = new Set();
  const vars = [];
  for (const cp of customProps) {
    if (seenVar.has(cp.name)) continue;
    seenVar.add(cp.name);
    vars.push({ ...cp, resolved: rootStyle.getPropertyValue(cp.name).trim() });
  }

  const hostClasses = [...document.documentElement.classList];

  return {
    rootSelector: rootSelector || 'body',
    hostClasses,
    nodes,
    css,
    sheets,
    keyframes,
    vars,
    varUsage: [...varUsage.values()].sort((a, b) => b.count - a.count),
    literalColors: [...literalColors.values()].sort((a, b) => b.count - a.count),
    viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
    documentSize: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    fontReady: !!(document.fonts && document.fonts.status !== 'loading'),
  };
};

function loadPlaywright() {
  const found = detectPlaywright();
  if (found.status !== 'available') {
    const err = new Error('playwright not found outside the repo; set PLAYWRIGHT_MODULE_PATH');
    err.code = 'PLAYWRIGHT_MISSING';
    throw err;
  }
  return require(found.path);
}

/**
 * Walk one state of one page.
 * `steps` is executed in order; each step is `{click}`, `{evaluate}` or `{wait}`.
 * The page is never reloaded between states of the same source, so state
 * transitions are the prototype's own (clicking a tab, opening a record).
 */
async function runWalk(spec) {
  const playwright = loadPlaywright();
  const viewport = spec.viewport || { width: 390, height: 844 };
  const browser = await playwright.chromium.launch({ headless: spec.headless !== false });
  let server = null;
  const results = [];
  try {
    if (spec.serveRoot) server = await startServer(spec.serveRoot, {});
    const origin = server ? server.origin : null;
    for (const pageDef of spec.pages) {
      const context = await browser.newContext({
        viewport,
        deviceScaleFactor: 1,
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
        colorScheme: 'light',
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      const pageResults = [];
      try {
        for (const state of pageDef.states) {
          const url = `${origin}/${pageDef.file}${state.query || ''}`;
          await page.goto(url, { waitUntil: 'load', timeout: spec.timeout || 30000 });
          await page.waitForLoadState('networkidle').catch(() => {});
          await page.evaluate(async () => {
            if (document.fonts && document.fonts.ready) await document.fonts.ready;
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          });
          for (const step of state.steps || []) {
            if (step.click) {
              await page.click(step.click, { timeout: 5000 });
            } else if (step.evaluate) {
              await page.evaluate(step.evaluate);
            } else if (step.wait) {
              await page.waitForTimeout(step.wait);
            }
            await page.waitForTimeout(step.settleMs || 120);
          }
          const frameSelector = pageDef.frameSelector || pageDef.root || null;
          let box = null;
          if (frameSelector) {
            box = await page.locator(frameSelector).first().boundingBox();
          }
          const snapshot = await page.evaluate(COLLECT, {
            rootSelector: pageDef.root || frameSelector || null,
            props: PROPS,
            frame: box ? { x: box.x, y: box.y } : null,
          });
          if (snapshot.error) throw new Error(snapshot.error);
          pageResults.push({
            id: state.id,
            query: state.query || '',
            steps: (state.steps || []).map(s => Object.keys(s).filter(k => k !== 'settleMs').map(k => `${k}:${s[k]}`).join('')),
            url,
            frame: box ? { x: box.x, y: box.y, w: box.width, h: box.height } : null,
            snapshot,
          });
        }
      } finally {
        await context.close().catch(() => {});
      }
      results.push({ id: pageDef.id, file: pageDef.file, root: pageDef.root || pageDef.frameSelector || null, family: pageDef.family || null, states: pageResults });
    }
  } finally {
    await browser.close().catch(() => {});
    if (server) await server.close();
  }
  return { walker: 'design-dna', viewport, pages: results };
}

module.exports = { runWalk, PROPS };

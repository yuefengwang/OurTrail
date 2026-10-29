'use strict';
/**
 * Design contract builder.
 *
 * Everything here is a *measurement*, not an opinion. Each record carries
 * `source.kind`:
 *   measured     read directly from the rendered page (computed style / rect)
 *   inferred     derived from measurements (e.g. gap between two rects)
 *   confirmed    supplied by a human in the project config (overrides)
 *   unknown      declared in config but not observable on this side
 *
 * Inferred values are never promoted to "measured" — the acceptance report shows
 * the provenance so a reviewer can tell what the tool actually saw.
 */
const { round, slug } = require('./util');

const TOKEN_GROUPS = {
  colors: ['color', 'background-color', 'border-top-color', 'border-color'],
  typography: ['font-size', 'font-weight', 'line-height', 'letter-spacing'],
  radius: ['border-radius'],
  shadows: ['box-shadow'],
};

function collectTokens(snapshot) {
  const buckets = { colors: new Map(), typography: new Map(), radius: new Map(), shadows: new Map(), spacing: new Map() };
  const add = (group, value, node) => {
    if (value == null || value === '' || value === 'none' || value === 'normal') return;
    const key = String(value);
    if (!buckets[group].has(key)) buckets[group].set(key, { value: key, count: 0, selectors: [] });
    const rec = buckets[group].get(key);
    rec.count++;
    if (node.sel && rec.selectors.length < 8 && !rec.selectors.includes(node.sel)) rec.selectors.push(node.sel);
  };
  for (const node of snapshot.nodes) {
    if (!node.visible) continue;
    const s = node.styles || {};
    for (const prop of TOKEN_GROUPS.colors) if (s[prop]) add('colors', s[prop], node);
    for (const prop of TOKEN_GROUPS.typography) if (s[prop]) add('typography', prop + ':' + s[prop], node);
    for (const prop of TOKEN_GROUPS.radius) if (s[prop]) add('radius', s[prop], node);
    for (const prop of TOKEN_GROUPS.shadows) if (s[prop] && s[prop] !== 'none') add('shadows', s[prop], node);
    for (const prop of ['padding', 'margin', 'gap']) {
      if (!s[prop]) continue;
      const parts = String(s[prop]).trim().split(/\s+/);
      for (const p of parts) {
        const n = parseFloat(p);
        if (!Number.isNaN(n) && n !== 0) add('spacing', n + 'px', node);
      }
    }
  }
  const out = {};
  for (const group of Object.keys(buckets)) {
    out[group] = [...buckets[group].values()]
      .map(r => ({ ...r, token: slug(group.slice(0, -1)) + '-' + slug(r.value), source: { kind: 'measured' } }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }
  return out;
}

/**
 * Component contracts: for each declared component, capture the box model and
 * the style properties that define it. `selectors` may list several instances.
 */
function buildComponents(snapshot, components) {
  const out = [];
  for (const c of components || []) {
    const nodes = c.selectors
      ? snapshot.nodes.filter(n => c.selectors.some(sel => n.sel === sel || (n.selectors || []).includes(sel)))
      : [];
    if (!nodes.length) {
      out.push({
        id: c.id, role: c.role, criticality: c.criticality || 'normal',
        status: 'UNVERIFIED', reason: 'selector not found in snapshot',
        selectors: c.selectors, source: { kind: 'unknown' },
      });
      continue;
    }
    const instances = nodes.map(n => ({
      selector: n.sel,
      path: n.path,
      rect: roundRect(n.rect),
      styles: pickStyles(n.styles, c.styleProps),
      text: n.text || '',
      lineCount: n.lineCount == null ? null : n.lineCount,
      source: { kind: 'measured', captureNode: n.id },
    }));
    out.push({
      id: c.id,
      role: c.role,
      criticality: c.criticality || 'normal',
      status: 'PASS',
      selectors: c.selectors,
      instances,
      source: { kind: 'measured' },
    });
  }
  return out;
}

function pickStyles(styles, props) {
  const keys = props || [
    'display', 'flex-direction', 'align-items', 'justify-content', 'gap',
    'padding', 'margin', 'width', 'height', 'font-size', 'font-weight',
    'line-height', 'letter-spacing', 'color', 'background-color',
    'border-radius', 'border-top-width', 'border-top-color', 'box-shadow', 'opacity',
  ];
  const out = {};
  for (const k of keys) if (styles && styles[k] != null) out[k] = styles[k];
  return out;
}

function roundRect(r) {
  return { x: round(r.x, 2), y: round(r.y, 2), w: round(r.w, 2), h: round(r.h, 2) };
}

/**
 * Page layout contract: ordered sections + measured rhythm. Gaps are `inferred`
 * because they are computed from two measured rects, not read as a CSS value.
 */
function buildPageLayout(snapshot, sections) {
  const found = [];
  for (const sec of sections || []) {
    const nodes = snapshot.nodes.filter(n => n.sel === sec.selector || (n.selectors || []).includes(sec.selector));
    if (!nodes.length) {
      found.push({ id: sec.id, role: sec.role, status: 'UNVERIFIED', selector: sec.selector, source: { kind: 'unknown' } });
      continue;
    }
    const n = nodes[0];
    found.push({
      id: sec.id,
      role: sec.role,
      selector: sec.selector,
      rect: roundRect(n.rect),
      text: n.text || '',
      styles: pickStyles(n.styles),
      status: 'PASS',
      source: { kind: 'measured', captureNode: n.id },
    });
  }
  const visible = found.filter(s => s.rect);
  const rhythm = [];
  for (let i = 1; i < visible.length; i++) {
    rhythm.push({
      from: visible[i - 1].id,
      to: visible[i].id,
      gap: round(visible[i].rect.y - (visible[i - 1].rect.y + visible[i - 1].rect.h), 2),
      source: { kind: 'inferred', from: [visible[i - 1].id, visible[i].id] },
    });
  }
  return { sections: found, rhythm };
}

/**
 * Token drift between prototype and target. Same value on both sides is a match;
 * values only on one side are surfaced (not automatically failures — a target may
 * legitimately use a subset).
 */
function diffTokens(tokensA, tokensB) {
  const out = {};
  for (const group of Object.keys(tokensA)) {
    const a = new Map(tokensA[group].map(t => [t.value, t]));
    const b = new Map((tokensB[group] || []).map(t => [t.value, t]));
    const onlyPrototype = [...a.keys()].filter(v => !b.has(v));
    const onlyTarget = [...b.keys()].filter(v => !a.has(v));
    const shared = [...a.keys()].filter(v => b.has(v));
    out[group] = { shared, onlyPrototype, onlyTarget };
  }
  return out;
}

module.exports = { collectTokens, buildComponents, buildPageLayout, diffTokens, pickStyles };

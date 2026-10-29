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
const geometry = require('./geometry');

const POSITION_TOL = geometry.POSITION_TOL;
const SIZE_TOL = geometry.SIZE_TOL;
const GAP_TOL = geometry.GAP_TOL;

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
 * Component contracts measured on BOTH sides.
 *
 * v0.1 wrote `PASS` as soon as the selector existed on the prototype, which
 * reads as "this component matches" while it only meant "I found a box"
 * (docs/audit-v0.1.md Q4/F4). The two facts are now separate fields:
 *   resolved   the declaration is measurable on the prototype
 *   status     PASS only when both sides were measured and agree
 * A missing target side is UNVERIFIED with a reason; a declared selector that
 * finds nothing on the target is FAIL, because the component was promised there.
 */
function buildComponents(prototypeSnapshot, targetSnapshot, components, tolerances) {
  const tol = tolerances || {};
  const out = [];
  for (const c of components || []) {
    const protoNodes = matchNodes(prototypeSnapshot, c.selectors);
    const targetNodes = matchNodes(targetSnapshot, c.selectors);
    const instancesOf = nodes => nodes.map(n => ({
      selector: n.sel,
      path: n.path,
      rect: roundRect(n.rect),
      styles: pickStyles(n.styles, c.styleProps),
      text: n.text || '',
      lineCount: n.lineCount == null ? null : n.lineCount,
      source: { kind: 'measured', captureNode: n.id },
    }));
    const base = {
      id: c.id,
      ...(c.role ? { role: c.role } : {}),
      criticality: c.criticality || 'normal',
      selectors: c.selectors || [],
      resolved: protoNodes.length > 0,
    };

    if (!protoNodes.length) {
      out.push({ ...base, status: 'UNVERIFIED', reason: 'selector not found in snapshot', source: { kind: 'unknown' } });
      continue;
    }
    if (!targetSnapshot) {
      out.push({
        ...base, status: 'UNVERIFIED', reason: 'target side not captured; only the prototype was measured',
        instances: instancesOf(protoNodes), prototype: { instances: instancesOf(protoNodes) }, target: null,
        source: { kind: 'measured' },
      });
      continue;
    }
    if (!targetNodes.length) {
      out.push({
        ...base, status: 'FAIL', reason: 'declared selector found nothing on the target side',
        differences: [{ kind: 'missing', target: null }],
        instances: instancesOf(protoNodes), prototype: { instances: instancesOf(protoNodes) }, target: { instances: [] },
        source: { kind: 'measured' },
      });
      continue;
    }

    const protoInstances = instancesOf(protoNodes);
    const targetInstances = instancesOf(targetNodes);
    const differences = [];
    if (protoInstances.length !== targetInstances.length) {
      differences.push({
        kind: 'count', prototype: protoInstances.length, target: targetInstances.length,
      });
    }
    const shared = Math.min(protoInstances.length, targetInstances.length);
    const props = c.styleProps || DEFAULT_COMPONENT_PROPS;
    let maxGeo = 0;
    for (let i = 0; i < shared; i++) {
      const a = protoInstances[i], b = targetInstances[i];
      for (const axis of ['x', 'y', 'w', 'h']) {
        const delta = round(b.rect[axis] - a.rect[axis], 2);
        const limit = axis === 'x' || axis === 'y'
          ? (tol.position == null ? POSITION_TOL : tol.position)
          : (tol.size == null ? SIZE_TOL : tol.size);
        maxGeo = Math.max(maxGeo, Math.abs(delta));
        if (Math.abs(delta) > limit) differences.push({ kind: 'geometry', axis, prototype: a.rect[axis], target: b.rect[axis], delta });
      }
      for (const prop of props) {
        const hasA = Object.prototype.hasOwnProperty.call(a.styles, prop);
        const hasB = Object.prototype.hasOwnProperty.call(b.styles, prop);
        if (!hasA && !hasB) continue;
        if (!hasA || !hasB) {
          differences.push({ kind: 'unverified', prop, prototype: hasA ? a.styles[prop] : null, target: hasB ? b.styles[prop] : null });
          continue;
        }
        const cmp = geometry.compareStyleProp(prop, a.styles[prop], b.styles[prop], tol);
        if (cmp.comparable === false) {
          differences.push({ kind: 'unverifiable', prop, prototype: cmp.a, target: cmp.b });
        } else if (!cmp.equal) {
          differences.push({ kind: 'style', prop, prototype: cmp.a, target: cmp.b, delta: cmp.delta == null ? null : cmp.delta });
        }
      }
    }

    const status = differences.some(d => d.kind !== 'unverified' && d.kind !== 'unverifiable')
      ? 'FAIL'
      : differences.length ? 'UNVERIFIED' : 'PASS';
    out.push({
      ...base,
      status,
      reason: status === 'PASS' ? null
        : status === 'FAIL' ? `${differences.filter(d => d.kind !== 'unverified' && d.kind !== 'unverifiable').length} 处两侧不一致`
          : '部分属性只有一侧报告，比较没有发生',
      instances: protoInstances,
      prototype: { instances: protoInstances },
      target: { instances: targetInstances },
      agreement: {
        instances: { prototype: protoInstances.length, target: targetInstances.length },
        compared: shared,
        maxGeometryDelta: round(maxGeo, 2),
        differences: differences.length,
      },
      differences,
      source: { kind: 'measured' },
    });
  }
  return out;
}

const DEFAULT_COMPONENT_PROPS = [
  'display', 'flex-direction', 'align-items', 'justify-content', 'gap',
  'padding', 'margin', 'width', 'height', 'font-size', 'font-weight',
  'line-height', 'letter-spacing', 'color', 'background-color',
  'border-radius', 'border-top-width', 'border-top-color', 'box-shadow', 'opacity',
];

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
 * Page layout contract: ordered sections + measured rhythm, on both sides.
 *
 * Same split as components: `resolved` says the section was measurable on the
 * prototype, `status` says the two sides agree. Gaps stay `inferred` because
 * they are computed from two measured rects, not read as a CSS value — and an
 * inferred gap is only comparable when both of its operands were measured on
 * the same side.
 */
function buildPageLayout(prototypeSnapshot, targetSnapshot, sections, tolerances) {
  const tol = tolerances || {};
  const gapTol = tol.gap == null ? GAP_TOL : tol.gap;
  const measured = [];

  for (const sec of sections || []) {
    const protoNode = nodesFor(prototypeSnapshot, sec.selector)[0] || null;
    const targetNode = targetSnapshot ? (nodesFor(targetSnapshot, sec.selector)[0] || null) : null;
    const view = n => (n ? {
      rect: roundRect(n.rect),
      text: n.text || '',
      styles: pickStyles(n.styles),
      captureNode: n.id,
    } : null);

    const base = {
      id: sec.id,
      ...(sec.role ? { role: sec.role } : {}),
      selector: sec.selector,
      resolved: !!protoNode,
    };

    if (!protoNode) {
      measured.push({ ...base, status: 'UNVERIFIED', reason: 'selector not found in snapshot', source: { kind: 'unknown' } });
      continue;
    }

    const prototype = view(protoNode);
    if (!targetSnapshot) {
      measured.push({
        ...base,
        rect: prototype.rect, text: prototype.text, styles: prototype.styles,
        status: 'UNVERIFIED',
        reason: 'target side not captured; only the prototype was measured',
        prototype, target: null,
        source: { kind: 'measured', captureNode: protoNode.id },
      });
      continue;
    }

    if (!targetNode) {
      measured.push({
        ...base,
        rect: prototype.rect, text: prototype.text, styles: prototype.styles,
        status: 'FAIL',
        reason: 'declared section found nothing on the target side',
        prototype, target: null,
        differences: [{ kind: 'missing', target: null }],
        source: { kind: 'measured', captureNode: protoNode.id },
      });
      continue;
    }

    const target = view(targetNode);
    const differences = [];
    let maxGeo = 0;
    for (const axis of ['x', 'y', 'w', 'h']) {
      const delta = round(target.rect[axis] - prototype.rect[axis], 2);
      const limit = axis === 'x' || axis === 'y'
        ? (tol.position == null ? POSITION_TOL : tol.position)
        : (tol.size == null ? SIZE_TOL : tol.size);
      maxGeo = Math.max(maxGeo, Math.abs(delta));
      if (Math.abs(delta) > limit) {
        differences.push({ kind: 'geometry', axis, prototype: prototype.rect[axis], target: target.rect[axis], delta });
      }
    }

    measured.push({
      ...base,
      rect: prototype.rect, text: prototype.text, styles: prototype.styles,
      status: differences.length ? 'FAIL' : 'PASS',
      reason: differences.length ? `${differences.length} 处几何不一致` : null,
      prototype,
      target,
      differences,
      agreement: { maxGeometryDelta: round(maxGeo, 2) },
      source: { kind: 'measured', captureNode: protoNode.id },
    });
  }

  const rhythm = [];
  const anchored = measured.filter(s => s.prototype);
  for (let i = 1; i < anchored.length; i++) {
    const prev = anchored[i - 1];
    const cur = anchored[i];
    const gap = round(cur.prototype.rect.y - (prev.prototype.rect.y + prev.prototype.rect.h), 2);
    const targetGap = cur.target && prev.target
      ? round(cur.target.rect.y - (prev.target.rect.y + prev.target.rect.h), 2)
      : null;
    const delta = targetGap == null ? null : round(targetGap - gap, 2);
    rhythm.push({
      from: prev.id,
      to: cur.id,
      gap,
      targetGap,
      delta,
      status: delta == null ? 'UNVERIFIED' : (Math.abs(delta) > gapTol ? 'FAIL' : 'PASS'),
      reason: delta == null ? 'both operands were not measured on the target side' : null,
      source: { kind: 'inferred', from: [prev.id, cur.id] },
    });
  }

  return {
    sections: measured,
    rhythm,
    coverage: {
      sectionsDeclared: (sections || []).length,
      resolved: measured.filter(s => s.resolved).length,
      compared: measured.filter(s => s.prototype && s.target).length,
    },
  };
}

function nodesFor(snapshot, selector) {
  return selector ? matchNodes(snapshot, [selector]) : [];
}

function matchNodes(snapshot, selectors) {
  if (!snapshot || !selectors) return [];
  return (snapshot.nodes || []).filter(n => selectors.some(sel => n.sel === sel || (n.selectors || []).includes(sel)));
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

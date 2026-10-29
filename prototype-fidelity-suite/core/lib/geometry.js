'use strict';
/**
 * Geometry / style comparison between two DOM snapshots.
 *
 * Snapshots are produced by the capture adapters:
 *   { platform, viewport:{width,height}, dpr, nodes:[Node], rootId }
 *   Node = {id, parentId, children:[id], tag, text, rect:{x,y,w,h}, styles:{}, visible, lineCount?}
 *
 * Design decision: pixel diff answers "what looks different", this module answers
 * "which box and which declaration are responsible". They are reported separately
 * and never substituted for one another.
 */
const { round } = require('./util');

const POSITION_TOL = 1.5;   // CSS px; calibrated in tests/experiment-a.js
const SIZE_TOL = 1.5;
const GAP_TOL = 1.0;
const FONT_TOL = 1.0;
const COLOR_TOL = 6;        // per-channel, after alpha compositing on white

const STYLE_PROPS = [
  'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align',
  'color', 'background-color', 'border-radius', 'border-top-width',
  'border-top-color', 'box-shadow', 'opacity', 'padding', 'margin', 'gap',
  'display', 'flex-direction', 'align-items', 'justify-content', 'overflow',
  'position', 'text-transform', 'white-space',
];

function parseColor(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (v === 'currentcolor') return null;
  if (v.startsWith('#')) {
    let hex = v.slice(1);
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    if (hex.length === 6) hex += 'ff';
    if (hex.length !== 8) return null;
    return {
      r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16), a: parseInt(hex.slice(6, 8), 16) / 255,
    };
  }
  const m = v.match(/^rgba?\(([^)]+)\)$/);
  if (!m) return null;
  const parts = m[1].split(/[,/]/).map(s => parseFloat(s.trim())).filter(n => !Number.isNaN(n));
  if (parts.length < 3) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

function compositeOverWhite(c) {
  if (!c) return null;
  return {
    r: Math.round(c.r * c.a + 255 * (1 - c.a)),
    g: Math.round(c.g * c.a + 255 * (1 - c.a)),
    b: Math.round(c.b * c.a + 255 * (1 - c.a)),
    a: 1,
  };
}

function parseLength(value) {
  if (value == null) return null;
  const v = String(value).trim();
  if (v === 'normal' || v === 'none' || v === 'auto') return null;
  const m = v.match(/^(-?[\d.]+)(px|rpx|em|rem|%|)$/);
  if (!m) return null;
  return parseFloat(m[1]);
}

function parseBox(value) {
  if (!value) return null;
  return String(value).trim().split(/\s+/).map(parseLength);
}

/** Shorthand → [top, right, bottom, left]. One place, so callers cannot each
 *  expand it differently (the mini-program adapter needs it to read the content
 *  height, comparison needs it to compare four sides). */
function expandBox(value) {
  const arr = Array.isArray(value) ? value : parseBox(value);
  if (!arr || !arr.length) return null;
  if (arr.length === 1) return [arr[0], arr[0], arr[0], arr[0]];
  if (arr.length === 2) return [arr[0], arr[1], arr[0], arr[1]];
  if (arr.length === 3) return [arr[0], arr[1], arr[2], arr[1]];
  return arr;
}

/**
 * `letter-spacing: normal` serialises as "normal" in Chromium but means 0.
 * Comparing it as a string against "0.9px" reports every default-tracked text
 * node as a typography failure — a false positive that has nothing to do with
 * the render. Only letter-spacing has this equivalence; `line-height: normal`
 * is genuinely font-dependent and must stay incomparable.
 */
function parseTracking(value) {
  if (value == null) return null;
  if (String(value).trim() === 'normal') return 0;
  return parseLength(value);
}

function normalizeShadow(value) {
  if (!value) return 'none';
  const v = String(value).replace(/\s+/g, ' ').trim();
  if (v === 'none' || v === '') return 'none';
  return v;
}

/**
 * Numeric comparison facts for one style property.
 * `tol` carries the project's configured tolerances; the module constants are
 * only the default. Passing config values in is what makes
 * `pf.config.json#tolerances` authoritative — otherwise a page that declares a
 * looser tolerance still fails at the hardcoded number.
 */
function compareStyleProp(prop, va, vb, tol) {
  const t = tol || {};
  if (prop.includes('color')) {
    const ca = parseColor(va), cb = parseColor(vb);
    if (!ca || !cb) return { comparable: false, a: va, b: vb };
    const A = compositeOverWhite(ca), B = compositeOverWhite(cb);
    const d = Math.max(Math.abs(A.r - B.r), Math.abs(A.g - B.g), Math.abs(A.b - B.b));
    return {
      comparable: true, a: fmtColor(ca), b: fmtColor(cb), delta: d,
      equal: d <= (t.color == null ? COLOR_TOL : t.color),
    };
  }
  if (prop === 'padding' || prop === 'margin') {
    const a4 = expandBox(va), b4 = expandBox(vb);
    if (!a4 || !b4) return { comparable: false, a: va, b: vb };
    const d = Math.max(...a4.map((v, i) => Math.abs(v - b4[i])));
    return { comparable: true, a: a4, b: b4, delta: round(d, 2), equal: d <= (t.gap == null ? GAP_TOL : t.gap) };
  }
  if (prop === 'border-radius') {
    const A = parseBox(va) || [], B = parseBox(vb) || [];
    const a0 = A.length ? Math.max(...A.filter(n => n != null)) : 0;
    const b0 = B.length ? Math.max(...B.filter(n => n != null)) : 0;
    return { comparable: true, a: a0, b: b0, delta: round(Math.abs(a0 - b0), 2), equal: Math.abs(a0 - b0) <= 0.5 };
  }
  if (prop === 'font-weight') {
    const A = va === 'bold' ? 700 : parseFloat(va), B = vb === 'bold' ? 700 : parseFloat(vb);
    if (Number.isNaN(A) || Number.isNaN(B)) return { comparable: false, a: va, b: vb };
    return { comparable: true, a: A, b: B, delta: Math.abs(A - B), equal: Math.abs(A - B) < 1 };
  }
  if (prop === 'box-shadow') {
    const A = normalizeShadow(va), B = normalizeShadow(vb);
    return { comparable: true, a: A, b: B, equal: A === B };
  }
  const A = prop === 'letter-spacing' ? parseTracking(va) : parseLength(va);
  const B = prop === 'letter-spacing' ? parseTracking(vb) : parseLength(vb);
  if (A == null || B == null) {
    return { comparable: true, a: va, b: vb, equal: String(va || '') === String(vb || '') };
  }
  const isType = prop === 'font-size' || prop === 'line-height' || prop === 'letter-spacing';
  const limit = isType ? (t.font == null ? FONT_TOL : t.font) : 1;
  return { comparable: true, a: round(A, 2), b: round(B, 2), delta: round(Math.abs(A - B), 2), equal: Math.abs(A - B) <= limit };
}

function fmtColor(c) {
  if (!c) return null;
  return c.a >= 1 ? `rgb(${c.r}, ${c.g}, ${c.b})` : `rgba(${c.r}, ${c.g}, ${c.b}, ${round(c.a, 2)})`;
}

function indexNodes(snapshot) {
  const byId = new Map();
  for (const n of snapshot.nodes) byId.set(n.id, n);
  return byId;
}

function childrenOf(snapshot, node) {
  const byId = indexNodes(snapshot);
  return (node.children || []).map(id => byId.get(id)).filter(Boolean);
}

/** Gaps between consecutive visible siblings (vertical then horizontal). */
function siblingGaps(snapshot, container) {
  const kids = childrenOf(snapshot, container).filter(n => n.visible && n.rect.w > 0 && n.rect.h > 0);
  if (kids.length < 2) return { vertical: [], horizontal: [] };
  const sortedY = kids.slice().sort((a, b) => a.rect.y - b.rect.y);
  const sortedX = kids.slice().sort((a, b) => a.rect.x - b.rect.x);
  const vertical = [];
  for (let i = 1; i < sortedY.length; i++) {
    vertical.push(round(sortedY[i].rect.y - (sortedY[i - 1].rect.y + sortedY[i - 1].rect.h), 2));
  }
  const horizontal = [];
  for (let i = 1; i < sortedX.length; i++) {
    horizontal.push(round(sortedX[i].rect.x - (sortedX[i - 1].rect.x + sortedX[i - 1].rect.w), 2));
  }
  return { vertical, horizontal };
}

function categorizeStyle(prop) {
  if (['font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'white-space'].includes(prop)) return 'typography';
  if (['color', 'background-color', 'border-radius', 'border-top-width', 'border-top-color', 'box-shadow', 'opacity'].includes(prop)) return 'appearance';
  if (['padding', 'margin', 'gap'].includes(prop)) return 'spacing';
  if (['display', 'flex-direction', 'align-items', 'justify-content', 'position', 'overflow'].includes(prop)) return 'layout';
  return 'other';
}

/**
 * Compare two nodes that are declared equivalent by the mapping.
 * Returns a record with per-axis geometry deltas and style deltas.
 *
 * Text is judged only when *both* sides are leaves. The web adapter records text
 * for leaf elements only, while the mini-program adapter records `el.text()`
 * for every node; comparing a container's "" against the other side's
 * concatenated child text reports every container as a copy mismatch. Line count
 * has the same requirement and is already null on containers.
 *
 * `pair.dynamicText` marks copy that changes on its own (a clock, a relative
 * timestamp). Such a pair still has to have text on both sides — an empty side is
 * a real defect — but the two strings are not required to match, and the record
 * says so (`volatile: true`) instead of quietly passing.
 */
function compareNode(a, b, pair, tolerances) {
  const tol = tolerances || {};
  const declared = !!(pair && pair.styleProps);
  const props = declared ? pair.styleProps : STYLE_PROPS;
  const rectA = a ? a.rect : null;
  const rectB = b ? b.rect : null;
  const record = {
    pairId: pair ? pair.id : null,
    role: pair ? pair.role : (a && a.role) || (b && b.role) || null,
    criticality: (pair && pair.criticality) || 'normal',
    status: 'PASS',
    presence: { prototype: !!a, target: !!b },
    geometry: null,
    styles: [],
    text: null,
    categories: [],
    evidence: {
      prototypeSelector: pair && pair.prototypeSelector,
      targetSelector: pair && pair.targetSelector,
      prototypePath: a && a.path,
      targetPath: b && b.path,
    },
  };
  if (!a || !b) {
    record.status = (pair && pair.optional) ? 'NOT_APPLICABLE' : 'FAIL';
    record.notes = !a ? 'node missing on prototype side' : 'node missing on target side';
    record.categories.push(!a ? 'prototype-missing' : 'target-missing');
    return record;
  }
  const d = {
    dx: round(rectB.x - rectA.x, 2),
    dy: round(rectB.y - rectA.y, 2),
    dw: round(rectB.w - rectA.w, 2),
    dh: round(rectB.h - rectA.h, 2),
    dwRatio: rectA.w ? round(rectB.w / rectA.w, 3) : null,
    dhRatio: rectA.h ? round(rectB.h / rectA.h, 3) : null,
  };
  const posTol = tol.position == null ? POSITION_TOL : tol.position;
  const sizeTol = tol.size == null ? SIZE_TOL : tol.size;
  const posFail = Math.abs(d.dx) > posTol || Math.abs(d.dy) > posTol;
  const sizeFail = Math.abs(d.dw) > sizeTol || Math.abs(d.dh) > sizeTol;
  record.geometry = {
    ...d,
    prototype: roundRect(rectA),
    target: roundRect(rectB),
    tolerances: { position: posTol, size: sizeTol },
    positionPass: !posFail,
    sizePass: !sizeFail,
  };
  if (posFail) record.categories.push('position');
  if (sizeFail) record.categories.push('size');

  const sa = a.styles || {}, sb = b.styles || {};
  for (const prop of props) {
    const inA = Object.prototype.hasOwnProperty.call(sa, prop);
    const inB = Object.prototype.hasOwnProperty.call(sb, prop);
    // The default list is a convenience; a prop neither adapter reports there has
    // nothing to compare. A *declared* prop is different: the config asked for it
    // by name, so silence would read as agreement. Missing on both sides is a
    // measurement gap and must be recorded as such.
    if (!inA && !inB) {
      if (!declared) continue;
      record.styles.push({
        prop, category: categorizeStyle(prop), status: 'UNVERIFIED',
        a: null, b: null, reason: 'not reported by either adapter',
      });
      record.unverified = true;
      continue;
    }
    // A declared property that only one side reports is a *measurement gap*, not a
    // visual difference. It must never be silently treated as a pass.
    if (!inA || !inB) {
      record.styles.push({
        prop, category: categorizeStyle(prop), status: 'UNVERIFIED',
        a: inA ? sa[prop] : null, b: inB ? sb[prop] : null,
        reason: inA ? 'not reported by target adapter' : 'not reported by prototype adapter',
      });
      record.unverified = true;
      continue;
    }
    // width/height/min-height are measured in the element's own box model. A
    // border-box 48 and a content-box 48 are different physical boxes, so the raw
    // numbers are not comparable — the geometry deltas already carry the box.
    const boxes = ['width', 'height', 'min-height', 'max-height'];
    if (boxes.includes(prop) && sa['box-sizing'] && sb['box-sizing'] && sa['box-sizing'] !== sb['box-sizing']) {
      record.styles.push({
        prop, category: categorizeStyle(prop), status: 'UNVERIFIED',
        a: sa[prop], b: sb[prop],
        reason: `box models differ (${sa['box-sizing']} vs ${sb['box-sizing']}); the geometry deltas carry the box`,
      });
      record.unverified = true;
      continue;
    }
    const cmp = compareStyleProp(prop, sa[prop], sb[prop], tol);
    if (!cmp.comparable) {
      record.styles.push({ prop, category: categorizeStyle(prop), status: 'UNVERIFIED', a: cmp.a, b: cmp.b });
      continue;
    }
    if (!cmp.equal) {
      record.categories.push(categorizeStyle(prop));
      record.styles.push({
        prop, category: categorizeStyle(prop), status: 'FAIL',
        a: cmp.a, b: cmp.b, delta: cmp.delta,
      });
    } else {
      record.styles.push({ prop, status: 'PASS', a: cmp.a, b: cmp.b, delta: cmp.delta });
    }
  }

  const textA = normalizeText(a.text);
  const textB = normalizeText(b.text);
  const lineA = a.lineCount == null ? null : a.lineCount;
  const lineB = b.lineCount == null ? null : b.lineCount;
  const leafBoth = !(a.children && a.children.length) && !(b.children && b.children.length);
  const dynamic = !!(pair && pair.dynamicText);
  record.text = {
    prototype: textA, target: textB,
    // `equal` is what was seen; `judged` is whether it counts. A container pair
    // and a declared-dynamic pair both keep the observation without failing.
    equal: leafBoth ? textA === textB : null,
    judged: leafBoth && !dynamic,
    comparable: leafBoth,
    volatile: dynamic || undefined,
    lines: { prototype: lineA, target: lineB },
    lineDelta: lineA != null && lineB != null ? lineB - lineA : null,
  };
  if (leafBoth) {
    if (dynamic) {
      // Dynamic copy is allowed to differ; it is not allowed to disappear.
      if ((textA === '') !== (textB === '')) record.categories.push('text');
    } else if (textA && textB && textA !== textB) {
      record.categories.push('text');
    }
    if (lineA != null && lineB != null && lineA !== lineB) record.categories.push('text-wrap');
  }

  if (record.categories.length) record.status = 'FAIL';
  return record;
}

function normalizeText(t) {
  if (t == null) return '';
  return String(t).replace(/\s+/g, ' ').trim();
}

function roundRect(r) {
  return { x: round(r.x, 2), y: round(r.y, 2), w: round(r.w, 2), h: round(r.h, 2) };
}

/**
 * Compare a node against its counterpart found by path (used when both sides
 * are the same document, e.g. the generic-web experiment).
 */
function findByPath(snapshot, path) {
  return snapshot.nodes.find(n => n.path === path) || null;
}

/**
 * Whole-mapping comparison. Pairs come from the project config (explicit) or are
 * derived by matching `path` across snapshots.
 */
function compareSnapshots(snapA, snapB, pairs, tolerances) {
  const results = [];
  for (const pair of pairs) {
    const a = resolveNode(snapA, pair.prototypeSelector, pair.prototypePath);
    const b = resolveNode(snapB, pair.targetSelector, pair.targetPath);
    results.push(compareNode(a, b, pair, tolerances));
  }
  return results;
}

function resolveNode(snapshot, selector, nodePath) {
  if (!snapshot) return null;
  if (selector) {
    const hit = snapshot.nodes.find(n => n.sel === selector || (n.selectors || []).includes(selector));
    if (hit) return hit;
  }
  if (nodePath) return findByPath(snapshot, nodePath);
  return null;
}

/**
 * Re-base position deltas onto a shared content anchor.
 *
 * Two shells legitimately start their content at different document offsets (a
 * browser prototype carries a simulated status bar, the mini program carries its
 * own custom navigation). Comparing absolute `dy` would charge that shell
 * difference to every component on the page. The anchor is one *mapped pair* that
 * both sides agree on: its own delta is treated as "origin", and every other
 * pair is measured against it. Sizes are never re-based — they are already local.
 *
 * The measured rects stay in the record untouched; only `geometry.dx/dy` and the
 * position pass/fail are recomputed, and the shift is reported so a reviewer can
 * see exactly what was subtracted.
 */
function realignToAnchor(records, anchorId, tolerances) {
  const anchor = records.find(r => r.pairId === anchorId || r.role === anchorId);
  if (!anchor || !anchor.geometry) {
    return { applied: false, reason: anchorId ? `anchor "${anchorId}" not measurable` : 'no anchor' };
  }
  const shift = { x: anchor.geometry.dx, y: anchor.geometry.dy };
  const tol = tolerances || {};
  const posTol = tol.position == null ? POSITION_TOL : tol.position;
  for (const rec of records) {
    if (!rec.geometry) continue;
    if (rec === anchor) {
      // The anchor is the origin, not a subject. Its residual is zero by
      // construction — leaving its own `position` category in place charges the
      // shell offset to the one pair that defined the shell offset, which made
      // every anchored run fail on the anchor alone. The measured delta is kept
      // as `rawDx/rawDy` so the movement stays visible, and `isAnchor` stops the
      // zeroes from reading as "this component matched".
      rec.geometry.rawDx = rec.geometry.dx;
      rec.geometry.rawDy = rec.geometry.dy;
      rec.geometry.dx = 0;
      rec.geometry.dy = 0;
      rec.geometry.positionPass = true;
      rec.geometry.alignedTo = anchorId;
      rec.geometry.isAnchor = true;
      rec.categories = rec.categories.filter(c => c !== 'position');
      rec.status = rec.categories.length ? 'FAIL' : (rec.unverified ? 'UNVERIFIED' : 'PASS');
      continue;
    }
    const dx = round(rec.geometry.dx - shift.x, 2);
    const dy = round(rec.geometry.dy - shift.y, 2);
    const positionPass = Math.abs(dx) <= posTol && Math.abs(dy) <= posTol;
    rec.geometry.dx = dx;
    rec.geometry.dy = dy;
    rec.geometry.positionPass = positionPass;
    rec.geometry.alignedTo = anchorId;
    rec.categories = rec.categories.filter(c => c !== 'position');
    if (!positionPass) rec.categories.push('position');
    rec.status = rec.categories.length ? 'FAIL' : (rec.unverified ? 'UNVERIFIED' : 'PASS');
  }
  return { applied: true, anchor: anchorId, shift };
}

/** Derive pairs from identical structural paths (same-document comparisons). */
function derivePairs(snapA, snapB) {
  const pairs = [];
  const bByPath = new Map(snapB.nodes.map(n => [n.path, n]));
  for (const a of snapA.nodes) {
    const b = bByPath.get(a.path);
    if (!b) continue;
    pairs.push({
      id: 'path:' + a.path,
      role: a.role || a.tag,
      prototypeSelector: null, targetSelector: null,
      prototypePath: a.path, targetPath: b.path,
      criticality: 'normal',
    });
  }
  return pairs;
}

/** Group failing records by category for the scorecard. */
function summarize(records) {
  const out = { total: records.length, PASS: 0, FAIL: 0, UNVERIFIED: 0, NOT_APPLICABLE: 0, byCategory: {} };
  for (const r of records) {
    out[r.status] = (out[r.status] || 0) + 1;
    if (r.status === 'FAIL') {
      for (const c of new Set(r.categories)) out.byCategory[c] = (out.byCategory[c] || 0) + 1;
    }
  }
  return out;
}

module.exports = {
  STYLE_PROPS, POSITION_TOL, SIZE_TOL, GAP_TOL, FONT_TOL, COLOR_TOL,
  parseColor, parseLength, parseBox, expandBox, compareStyleProp, compareNode, compareSnapshots,
  derivePairs, siblingGaps, summarize, resolveNode, findByPath, normalizeText, roundRect,
  realignToAnchor,
};

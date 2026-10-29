'use strict';
/**
 * Cascade attribution: when a region moved, how much of that movement is its
 * own change and how much is an ancestor's?
 *
 * v0.1 performed this decomposition by hand inside an experiment fixture
 * ("b-btn dy = -4 = +2 card growth - 6 own margin") and had no code for it.
 * This module is that code. It only *subdivides measured deltas*: every operand
 * comes from a resolved node's rect, so the arithmetic can be added back by
 * hand. It is reported next to the verdict and never decides one — a child moved
 * by its ancestor's growth is still a real difference at the child.
 *
 * Ancestry is declared, not guessed: a link exists only when one mapped pair
 * resolves to a DOM ancestor of another mapped pair, on the prototype side (the
 * declaration of intent), and the ancestor pair is itself measured.
 */
const geometry = require('./geometry');

const FLOW_TOL = 0.5;

function nodeChain(snapshot, node) {
  const byId = new Map((snapshot.nodes || []).map(n => [n.id, n]));
  const chain = [];
  let cur = node;
  while (cur && cur.parentId != null) {
    const parent = byId.get(cur.parentId);
    if (!parent) break;
    chain.push({ node: parent, child: cur });
    cur = parent;
  }
  return chain;
}

function declaredAncestors(pairId, recordsById, pairNodes, protoSnap) {
  const self = pairNodes.get(pairId);
  if (!self || !self.a || !self.a.rect) return [];
  const ownerA = new Map();
  for (const [id, nodes] of pairNodes) {
    if (id === pairId || !nodes.a) continue;
    ownerA.set(nodes.a.id, id);
  }
  const out = [];
  let depth = 1;
  for (const link of nodeChain(protoSnap, self.a)) {
    const hit = ownerA.get(link.node.id);
    if (hit == null) continue;
    const parentRect = link.node.rect;
    out.push({
      pairId: hit,
      depth: depth++,
      rec: recordsById.get(hit) || null,
      // The child sits below the ancestor's box in the prototype, so the
      // ancestor's height delta pushes it down by the same amount.
      flowsBelow: !!(parentRect && self.a.rect.y >= parentRect.y + parentRect.h - FLOW_TOL),
    });
  }
  return out;
}

/**
 * @param {Array} records diff records, each with `id` and `geometry`
 * @param {object} protoSnap prototype snapshot
 * @param {object} targetSnap target snapshot
 * @param {Array} pairs mapping declarations (id, prototypeSelector, targetSelector)
 * @returns {{ method:string, regions:object, attributed:number, independent:number }}
 */
function attribute(records, protoSnap, targetSnap, pairs) {
  const pairNodes = new Map();
  for (const p of pairs || []) {
    const a = geometry.resolveNode(protoSnap, p.prototypeSelector, p.prototypePath);
    const b = geometry.resolveNode(targetSnap, p.targetSelector, p.targetPath);
    if (a || b) pairNodes.set(p.id, { a, b });
  }
  const recordsById = new Map(records.map(r => [r.id, r]));
  const regions = {};
  let attributed = 0;
  let independent = 0;

  for (const rec of records) {
    if (!rec.geometry) continue;
    const nodes = pairNodes.get(rec.id);
    if (!nodes || !nodes.a || !nodes.b) {
      regions[rec.id] = { kind: 'independent', reason: 'pair not resolvable on both sides' };
      independent++;
      continue;
    }
    const ancestors = declaredAncestors(rec.id, recordsById, pairNodes, protoSnap);
    if (!ancestors.length) {
      regions[rec.id] = { kind: 'independent', reason: 'no mapped ancestor' };
      independent++;
      continue;
    }
    let inheritedX = 0;
    let inheritedY = 0;
    const chain = [];
    for (const a of ancestors) {
      const g = a.rec && a.rec.geometry;
      if (!g) {
        chain.push({ pairId: a.pairId, depth: a.depth, measured: false });
        continue;
      }
      const pushesY = a.flowsBelow ? (g.dh || 0) : 0;
      inheritedX += g.dx || 0;
      inheritedY += (g.dy || 0) + pushesY;
      chain.push({
        pairId: a.pairId, depth: a.depth, measured: true,
        dx: g.dx, dy: g.dy, dh: g.dh, pushesY: round2(pushesY),
      });
    }
    const inherited = { dx: round2(inheritedX), dy: round2(inheritedY) };
    const own = { dx: round2((rec.geometry.dx || 0) - inherited.dx), dy: round2((rec.geometry.dy || 0) - inherited.dy) };
    const ownMag = Math.abs(own.dx) + Math.abs(own.dy);
    const inhMag = Math.abs(inherited.dx) + Math.abs(inherited.dy);
    regions[rec.id] = {
      kind: 'measured-chain',
      chain,
      inherited,
      own,
      dominant: ownMag === 0 && inhMag === 0 ? 'none' : inhMag > ownMag ? 'inherited' : ownMag > inhMag ? 'own' : 'mixed',
      // Spelled out so the split can be re-added by hand instead of trusted.
      arithmetic: {
        dx: `${rec.geometry.dx} - (${inherited.dx}) = ${own.dx}`,
        dy: `${rec.geometry.dy} - (${inherited.dy}) = ${own.dy}`,
      },
    };
    attributed++;
  }
  return { method: 'measured-deltas-along-declared-ancestry', regions, attributed, independent };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { attribute };

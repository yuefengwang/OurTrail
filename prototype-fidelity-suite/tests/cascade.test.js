'use strict';
/**
 * F11 — structural cascade attribution.
 *
 * The experiment fixture used to do this arithmetic by hand ("b-btn dy = -4 =
 * +2 card growth - 6 own margin"). These assertions pin the code version of that
 * reasoning: inheritance comes only from *mapped* ancestors, a child sitting below
 * its ancestor's box also inherits the ancestor's height change, and the split is
 * always re-addable by hand (dx - inherited = own).
 */
const cascade = require('../core/lib/cascade');
const { check, eq, section, finish } = require('./harness');

function node(id, sel, rect, parentId) {
  return { id, sel, parentId: parentId || null, rect };
}

function snapshot(nodes) { return { nodes }; }

const proto = snapshot([
  node('p-root', '#root', { x: 0, y: 0, w: 390, h: 844 }),
  node('p-card', '#card', { x: 0, y: 100, w: 390, h: 200 }, 'p-root'),
  node('p-title', '#title', { x: 16, y: 116, w: 200, h: 24 }, 'p-card'),
  node('p-wrap', null, { x: 0, y: 300, w: 390, h: 80 }, 'p-card'),
  node('p-btn', '#btn', { x: 16, y: 320, w: 120, h: 48 }, 'p-wrap'),
  node('p-loose', '#loose', { x: 0, y: 600, w: 100, h: 40 }),
]);
const target = snapshot([
  node('t-root', '#root', { x: 0, y: 0, w: 390, h: 844 }),
  node('t-card', '#card', { x: 0, y: 102, w: 390, h: 204 }, 't-root'),
  node('t-title', '#title', { x: 16, y: 121, w: 200, h: 24 }, 't-card'),
  node('t-wrap', null, { x: 0, y: 306, w: 390, h: 80 }, 't-card'),
  node('t-btn', '#btn', { x: 26, y: 340, w: 120, h: 48 }, 't-wrap'),
  node('t-loose', '#loose', { x: 1, y: 601, w: 100, h: 40 }),
]);

const pairs = [
  { id: 'root', prototypeSelector: '#root', targetSelector: '#root' },
  { id: 'card', prototypeSelector: '#card', targetSelector: '#card' },
  { id: 'title', prototypeSelector: '#title', targetSelector: '#title' },
  { id: 'btn', prototypeSelector: '#btn', targetSelector: '#btn' },
  { id: 'loose', prototypeSelector: '#loose', targetSelector: '#loose' },
  { id: 'orphan', prototypeSelector: '#loose', targetSelector: '#missing' },
];

const baseRecords = [
  { id: 'root', geometry: { dx: 0, dy: 0, dw: 0, dh: 0 } },
  { id: 'card', geometry: { dx: 0, dy: 2, dw: 0, dh: 4 } },
  { id: 'title', geometry: { dx: 0, dy: 5, dw: 0, dh: 0 } },
  // 10 = a 10 px own shift, 20 = 2 (card moved) + 4 (card grew, button sits below it) + 14 own
  { id: 'btn', geometry: { dx: 10, dy: 20, dw: 0, dh: 0 } },
  { id: 'loose', geometry: { dx: 1, dy: 1, dw: 0, dh: 0 } },
  { id: 'orphan', geometry: { dx: 0, dy: 0, dw: 0, dh: 0 } },
  { id: 'not-mapped-geometry', geometry: null },
];

section('attribution covers every geometry record exactly once');
{
  const res = cascade.attribute(baseRecords, proto, target, pairs);
  eq('method is declared', res.method, 'measured-deltas-along-declared-ancestry');
  eq('records with a measured chain', res.attributed, 3);
  eq('records reported as independent (root, loose, orphan)', res.independent, 3);
  eq('attributed + independent = records with geometry',
    res.attributed + res.independent, baseRecords.filter(r => r.geometry).length);
  eq('a record without geometry gets no region', res.regions['not-mapped-geometry'], undefined);
  eq('an unmapped pair is independent', res.regions['loose'].kind, 'independent');
  eq('…and says why', res.regions['loose'].reason, 'no mapped ancestor');
  eq('a pair missing on one side is independent', res.regions['orphan'].kind, 'independent');
  eq('…and says which condition failed', res.regions['orphan'].reason, 'pair not resolvable on both sides');
}

section('the split is arithmetic a reviewer can re-add');
{
  const res = cascade.attribute(baseRecords, proto, target, pairs);
  const btn = res.regions['btn'];
  eq('btn is a measured chain', btn.kind, 'measured-chain');
  eq('btn inherited dx (ancestors did not move horizontally)', btn.inherited.dx, 0);
  eq('btn inherited dy = card.dy 2 + card.dh 4 (it sits below the card box)', btn.inherited.dy, 6);
  eq('btn own dx', btn.own.dx, 10);
  eq('btn own dy', btn.own.dy, 14);
  eq('dx split re-adds to the measured delta', btn.arithmetic.dx, '10 - (0) = 10');
  eq('dy split re-adds to the measured delta', btn.arithmetic.dy, '20 - (6) = 14');
  eq('dominant is own when the own part is larger', btn.dominant, 'own');

  eq('an unmapped wrapper is skipped, not invented as an ancestor',
    btn.chain.map(c => c.pairId), ['card', 'root']);
  eq('depths count declared ancestors, not DOM levels',
    btn.chain.map(c => c.depth), [1, 2]);
  eq('the height term is shown per link so it can be checked', btn.chain[0].pushesY, 4);

  const title = res.regions['title'];
  eq('a child inside the ancestor box inherits only the ancestor shift', title.inherited.dy, 2);
  eq('…so its own move is the rest', title.own.dy, 3);
  eq('title dominant is own', title.dominant, 'own');
  eq('title chain skips nothing (its parent is mapped)', title.chain.map(c => c.pairId), ['card', 'root']);

  const card = res.regions['card'];
  eq('card inherits from root only', card.inherited.dy, 0);
  eq('card own dy is its whole delta', card.own.dy, 2);
}

section('the height term is live, not a copied constant');
{
  const grown = baseRecords.map(r => (r.id === 'card' ? { id: 'card', geometry: { dx: 0, dy: 2, dw: 0, dh: 10 } } : r));
  const res = cascade.attribute(grown, proto, target, pairs);
  eq('growing the ancestor by 6 pushes the below-box child by 6 more', res.regions.btn.inherited.dy, 12);
  eq('…and its own part shrinks by the same 6', res.regions.btn.own.dy, 8);
  eq('a child inside the box is unaffected by the height change', res.regions.title.inherited.dy, 2);
}

section('attribution never turns a real difference into a pass');
{
  // Nothing in the module reports a verdict; a child moved purely by its ancestor
  // still has a measured delta of its own. This assertion pins that shape so a
  // future "smart" change cannot start excusing regions here.
  const res = cascade.attribute(baseRecords, proto, target, pairs);
  for (const [id, region] of Object.entries(res.regions)) {
    check(`${id}: attribution carries no verdict field`,
      !('status' in region) && !('verdict' in region), Object.keys(region));
  }
  const inheritedOnly = cascade.attribute(
    baseRecords.map(r => (r.id === 'title' ? { id: 'title', geometry: { dx: 0, dy: 4, dw: 0, dh: 4 } } : r)),
    proto, target, pairs).regions.title;
  eq('a pure inherited move still reports its measured delta', inheritedOnly.arithmetic.dy, '4 - (2) = 2');
  eq('…and the region remains a measured chain', inheritedOnly.kind, 'measured-chain');
  check('own is zero only when the deltas really cancel',
    cascade.attribute(baseRecords.map(r => (r.id === 'title' ? { id: 'title', geometry: { dx: 0, dy: 2, dw: 0, dh: 0 } } : r)),
      proto, target, pairs).regions.title.own.dy === 0);
  check('a pair missing on one side has no inherited arithmetic to borrow',
    !('arithmetic' in res.regions['orphan']), res.regions['orphan']);
}

process.exit(finish('cascade.test'));

'use strict';
/**
 * Geometry + style comparison: the localization layer.
 *
 * Pixel diff says *what* looks different; these records say *which box and which
 * declaration*. The cases below pin the three failure modes that make a
 * localization report untrustworthy: charging a shell offset to every component,
 * treating a missing measurement as agreement, and hiding a wrap change inside
 * a text-equality pass.
 */
const geometry = require('../core/lib/geometry');
const { check, eq, near, section, finish } = require('./harness');

function node(sel, rect, styles, extra) {
  return Object.assign({
    id: sel, parentId: null, children: [], tag: 'view', text: '',
    rect, styles: styles || {}, visible: true, sel, path: '/' + sel,
  }, extra || {});
}

function snap(nodes) {
  return { platform: 'test', viewport: { width: 390, height: 844 }, dpr: 1, nodes, rootId: nodes[0] && nodes[0].id };
}

function pair(id, a, b, extra) {
  return Object.assign({
    id, role: id, criticality: 'normal',
    prototypeSelector: a, targetSelector: b,
  }, extra || {});
}

section('rect deltas and tolerance boundaries');
{
  const A = snap([node('.x', { x: 10, y: 20, w: 100, h: 40 })]);
  const B = snap([node('.x', { x: 11.5, y: 21.5, w: 101.5, h: 38.5 })]);
  const [rec] = geometry.compareSnapshots(A, B, [pair('x', '.x', '.x')]);
  eq('dx/dy measured with sign', [rec.geometry.dx, rec.geometry.dy], [1.5, 1.5]);
  eq('dw/dh measured with sign', [rec.geometry.dw, rec.geometry.dh], [1.5, -1.5]);
  eq('exactly at tolerance passes', [rec.geometry.positionPass, rec.geometry.sizePass], [true, true]);
  eq('no category invented', rec.categories, []);

  const C = snap([node('.x', { x: 11.51, y: 20, w: 100, h: 40 })]);
  const [rec2] = geometry.compareSnapshots(A, C, [pair('x', '.x', '.x')]);
  eq('1.51 px exceeds the 1.5 px tolerance', rec2.geometry.positionPass, false);
  eq('category is position only', rec2.categories, ['position']);
  eq('record fails', rec2.status, 'FAIL');
}

section('style comparison by category');
{
  const A = snap([node('.t', { x: 0, y: 0, w: 100, h: 20 }, {
    'font-size': '25px', 'font-weight': '730', color: 'rgb(22, 62, 53)', 'border-radius': '12px',
  }, { text: '看清天气' })]);
  const B = snap([node('.t', { x: 0, y: 0, w: 100, h: 20 }, {
    'font-size': '25px', 'font-weight': '700', color: 'rgb(26, 63, 54)', 'border-radius': '12px',
  }, { text: '看清天气' })]);
  const [rec] = geometry.compareSnapshots(A, B, [pair('t', '.t', '.t')]);
  const byProp = Object.fromEntries(rec.styles.map(s => [s.prop, s]));
  eq('same font-size passes', byProp['font-size'].status, 'PASS');
  eq('weight 730 vs 700 fails', byProp['font-weight'].status, 'FAIL');
  eq('weight difference is typography', byProp['font-weight'].category, 'typography');
  eq('a 4/1/1 channel delta is inside the colour tolerance', byProp.color.status, 'PASS');
  eq('categories', rec.categories, ['typography']);

  const C = snap([node('.t', { x: 0, y: 0, w: 100, h: 20 }, { color: 'rgb(22, 62, 53)' })]);
  const D = snap([node('.t', { x: 0, y: 0, w: 100, h: 20 }, { color: 'rgb(200, 30, 30)' })]);
  const [rec2] = geometry.compareSnapshots(C, D, [pair('t', '.t', '.t')]);
  eq('a different hue fails', rec2.styles[0].status, 'FAIL');
  eq('…as appearance', rec2.styles[0].category, 'appearance');
}

section('a missing measurement is not agreement');
{
  const A = snap([node('.t', { x: 0, y: 0, w: 10, h: 10 }, { 'font-size': '12px' })]);
  const B = snap([node('.t', { x: 0, y: 0, w: 10, h: 10 }, {})]);
  const [rec] = geometry.compareSnapshots(A, B, [pair('t', '.t', '.t')]);
  eq('property missing on target → UNVERIFIED', rec.styles[0].status, 'UNVERIFIED');
  eq('record is flagged for the caller', rec.unverified, true);
  check('no category claims a difference', rec.categories.length === 0, rec.categories);
  check('reason names the side', /not reported by target/.test(rec.styles[0].reason), rec.styles[0].reason);

  // A prop the config asked for by name and neither adapter could read used to be
  // dropped by `if (!inA && !inB) continue` — the report then listed the pair as if
  // the prop had been checked. Silence is a measurement gap, not a match.
  const C = snap([node('.t', { x: 0, y: 0, w: 10, h: 10 }, { 'font-size': '12px' })]);
  const D = snap([node('.t', { x: 0, y: 0, w: 10, h: 10 }, { 'font-size': '12px' })]);
  const declared = pair('t', '.t', '.t', { styleProps: ['font-size', 'min-height'] });
  const [rec2] = geometry.compareSnapshots(C, D, [declared]);
  const minH = rec2.styles.find(s => s.prop === 'min-height');
  eq('declared prop missing on both sides is still listed', !!minH, true);
  eq('…as UNVERIFIED', minH && minH.status, 'UNVERIFIED');
  check('…and names the gap rather than a side', /either adapter/.test(minH.reason), minH.reason);
  eq('…without inventing a category', rec2.categories, []);
  eq('…and the readable prop still passes', rec2.styles.find(s => s.prop === 'font-size').status, 'PASS');

  // The default list is a convenience, not a declaration: a prop neither side
  // reports there carries no signal and must not pad the report.
  const [rec3] = geometry.compareSnapshots(C, D, [pair('t', '.t', '.t')]);
  eq('undeclared default prop absent on both sides is not listed', rec3.styles.some(s => s.prop === 'min-height'), false);

  // 60 in a border-box and 60 in a content-box are different heights. The raw
  // number agreeing is not evidence, so it must not read as PASS.
  const P = snap([node('.b', { x: 0, y: 0, w: 350, h: 60 }, { 'box-sizing': 'border-box', height: '60px' })]);
  const Q = snap([node('.b', { x: 0, y: 0, w: 350, h: 92 }, { 'box-sizing': 'content-box', height: '60px' })]);
  const [rec4] = geometry.compareSnapshots(P, Q, [pair('b', '.b', '.b', { styleProps: ['height'] })]);
  eq('same height in different box models → UNVERIFIED', rec4.styles[0].status, 'UNVERIFIED');
  check('reason names both box models', /border-box vs content-box/.test(rec4.styles[0].reason), rec4.styles[0].reason);
  eq('the geometry still carries the real box', rec4.categories, ['size']);

  const R = snap([node('.b', { x: 0, y: 0, w: 350, h: 60 }, { 'box-sizing': 'content-box', height: '60px' })]);
  const [rec5] = geometry.compareSnapshots(R, Q, [pair('b', '.b', '.b', { styleProps: ['height'] })]);
  eq('same box model is compared normally', rec5.styles[0].status, 'PASS');
}

section('missing nodes');
{
  const A = snap([node('.a', { x: 0, y: 0, w: 10, h: 10 })]);
  const B = snap([node('.unrelated', { x: 0, y: 0, w: 10, h: 10 })]);
  const [rec] = geometry.compareSnapshots(A, B, [pair('a', '.a', '.b')]);
  eq('missing on target → FAIL', rec.status, 'FAIL');
  eq('presence recorded', rec.presence, { prototype: true, target: false });
  eq('category', rec.categories, ['target-missing']);

  const [opt] = geometry.compareSnapshots(A, B, [pair('a', '.a', '.b', { optional: true })]);
  eq('optional absence is NOT_APPLICABLE', opt.status, 'NOT_APPLICABLE');
}

section('copy and wrap are separate findings');
{
  const A = snap([node('.p', { x: 0, y: 0, w: 240, h: 20 }, {}, { text: '一个地点，一段路线', lineCount: 1 })]);
  // Whitespace-only difference (leading/trailing/collapsible) must not read as copy drift.
  const B = snap([node('.p', { x: 0, y: 0, w: 240, h: 20 }, {}, { text: '  一个地点，一段路线  ', lineCount: 2 })]);
  const [rec] = geometry.compareSnapshots(A, B, [pair('p', '.p', '.p')]);
  eq('whitespace is normalized before comparing', rec.text.equal, true);
  eq('line delta is reported', rec.text.lineDelta, 1);
  eq('wrap is its own category', rec.categories, ['text-wrap']);

  const C = snap([node('.p', { x: 0, y: 0, w: 240, h: 20 }, {}, { text: '地图选点（交互模拟）' })]);
  const [rec2] = geometry.compareSnapshots(A, C, [pair('p', '.p', '.p')]);
  eq('a real copy difference fails as text', rec2.categories, ['text']);
}

section('anchor re-basing removes the shell offset, sizes are untouched');
{
  const A = snap([
    node('.header', { x: 0, y: 0, w: 390, h: 100 }),
    node('.title', { x: 20, y: 40, w: 240, h: 33 }),
    node('.row', { x: 20, y: 120, w: 350, h: 46 }),
  ]);
  const B = snap([
    node('.header', { x: 0, y: 15, w: 390, h: 100 }),
    node('.title', { x: 20, y: 55, w: 240, h: 33 }),
    node('.row', { x: 20, y: 139, w: 350, h: 46 }),
  ]);
  const pairs = [pair('header', '.header', '.header'), pair('title', '.title', '.title'), pair('row', '.row', '.row')];
  const records = geometry.compareSnapshots(A, B, pairs);
  const row = records.find(r => r.pairId === 'row');
  eq('before re-basing the row looks 19 px off', [row.geometry.dy, row.geometry.positionPass], [19, false]);

  const applied = geometry.realignToAnchor(records, 'header');
  eq('anchor found', applied.applied, true);
  eq('shift is the anchor delta', applied.shift, { x: 0, y: 15 });
  eq('row delta is now the residue', row.geometry.dy, 4);
  eq('still a real 4 px error', row.geometry.positionPass, false);
  eq('record says what it was aligned to', row.geometry.alignedTo, 'header');
  eq('anchor is marked', records[0].geometry.isAnchor, true);
  // The anchor defines the origin; charging the shell offset back to it made
  // every anchored run fail on the anchor alone (observed on b-statusbar: a
  // 24 px status bar, and the title — the anchor — was the one pair that failed).
  const header = records[0];
  eq('the anchor itself is not a position failure', header.categories, []);
  eq('the anchor residual is zero', [header.geometry.dx, header.geometry.dy], [0, 0]);
  eq('the anchor movement is still reported', header.geometry.rawDy, 15);
  eq('and its status follows', header.status, 'PASS');
  eq('the residual 4 px is still a position failure', row.categories, ['position']);

  const C = snap([node('.row', { x: 20, y: 136, w: 350, h: 46 })]);
  const recs2 = geometry.compareSnapshots(A, C, [pair('row', '.row', '.row')]);
  geometry.realignToAnchor(recs2, 'missing-anchor');
  eq('a missing anchor does not silently zero anything', recs2[0].geometry.dy, 16);
}

section('summarize reports counts, not vibes');
{
  const A = snap([node('.a', { x: 0, y: 0, w: 10, h: 10 }), node('.b', { x: 0, y: 0, w: 10, h: 10 })]);
  const B = snap([node('.a', { x: 0, y: 0, w: 10, h: 10 }), node('.b', { x: 0, y: 5, w: 10, h: 10 })]);
  const records = geometry.compareSnapshots(A, B, [pair('a', '.a', '.a'), pair('b', '.b', '.b')]);
  const sum = geometry.summarize(records);
  eq('total', sum.total, 2);
  eq('fail', sum.FAIL, 1);
  eq('pass', sum.PASS, 1);
}

if (require.main === module) process.exit(finish('geometry.test'));
module.exports = {};

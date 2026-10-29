'use strict';
/**
 * Contract builder: measurement, provenance, and the "missing is not a pass" rule.
 */
const contract = require('../core/lib/contract');
const { check, eq, section, finish } = require('./harness');

function node(sel, styles, extra) {
  return Object.assign({
    id: sel, sel, path: '/' + sel, visible: true, rect: { x: 0, y: 0, w: 10, h: 10 }, text: '',
  }, { styles: styles || {} }, extra || {});
}

function snap(nodes) {
  return { platform: 'test', viewport: { width: 390, height: 844 }, dpr: 1, nodes };
}

section('token collection measures what is rendered');
{
  const s = snap([
    node('.a', { color: 'rgb(22, 62, 53)', 'font-size': '25px', 'font-weight': '700', 'border-radius': '12px', padding: '15px 16px', gap: '13px' }),
    node('.b', { color: 'rgb(22, 62, 53)', 'font-size': '10px', 'border-radius': '12px', margin: '0 20px' }),
    node('.hidden', { color: 'rgb(255, 0, 0)' }, { visible: false }),
  ]);
  const t = contract.collectTokens(s);
  const color = t.colors.find(c => c.value === 'rgb(22, 62, 53)');
  eq('colour counted per occurrence', color.count, 2);
  eq('selectors sampled', color.selectors, ['.a', '.b']);
  eq('provenance is measured', color.source.kind, 'measured');
  check('invisible nodes contribute nothing', !t.colors.some(c => c.value === 'rgb(255, 0, 0)'));

  const weights = t.typography.filter(x => x.value.startsWith('font-weight'));
  eq('typography keys carry the property', weights.map(w => w.value).sort(), ['font-weight:700']);
  eq('radius deduplicated', t.radius.length, 1);
  eq('spacing splits shorthand into non-zero numbers', t.spacing.map(x => x.value).sort(), ['13px', '15px', '16px', '20px']);
}

section('token drift is a set difference, not a score');
{
  const a = { colors: [{ value: 'x' }, { value: 'y' }], typography: [], radius: [], shadows: [], spacing: [] };
  const b = { colors: [{ value: 'y' }, { value: 'z' }], typography: [], radius: [], shadows: [], spacing: [] };
  const d = contract.diffTokens(a, b);
  eq('shared', d.colors.shared, ['y']);
  eq('only prototype', d.colors.onlyPrototype, ['x']);
  eq('only target', d.colors.onlyTarget, ['z']);
}

section('component contracts cannot claim a pass without a measurement');
{
  const proto = snap([node('.primary', { 'min-height': '60px', padding: '15px 16px', 'background-color': 'rgb(255, 255, 255)' }, { text: '地图选点' })]);

  const [missing] = contract.buildComponents(proto, proto, [{ id: 'cta', role: 'cta', selectors: ['.nope'] }]);
  eq('missing selector is UNVERIFIED', missing.status, 'UNVERIFIED');
  eq('and says why', missing.reason, 'selector not found in snapshot');
  eq('provenance is unknown', missing.source.kind, 'unknown');
  eq('and is not called resolved', missing.resolved, false);

  // The audit's F4: "found a box" is not "the two sides match". `resolved`
  // carries the first fact; `status` may only say PASS about the second.
  const [protoOnly] = contract.buildComponents(proto, null, [{ id: 'cta', role: 'cta', selectors: ['.primary'], styleProps: ['padding'] }]);
  eq('a prototype-only measurement is resolved', protoOnly.resolved, true);
  eq('but it is not a pass', protoOnly.status, 'UNVERIFIED');
  eq('and the reason names the missing side', protoOnly.reason, 'target side not captured; only the prototype was measured');
  eq('the prototype measurement is still recorded', protoOnly.prototype.instances.length, 1);
  eq('the target side is explicitly null', protoOnly.target, null);
  eq('instance records the captured node', protoOnly.instances[0].source.captureNode, '.primary');
  eq('style projection is limited to what was asked', protoOnly.instances[0].styles, { padding: '15px 16px' });
  eq('text travels with the instance', protoOnly.instances[0].text, '地图选点');

  const same = snap([node('.primary', { 'min-height': '60px', padding: '15px 16px' }, { text: '地图选点' })]);
  const [agree] = contract.buildComponents(proto, same, [{ id: 'cta', role: 'cta', selectors: ['.primary'], styleProps: ['padding'] }]);
  eq('both sides measured and equal is a pass', agree.status, 'PASS');
  eq('and records how much was compared', agree.agreement.compared, 1);
  eq('with no differences', agree.differences, []);

  const [absent] = contract.buildComponents(proto, snap([node('.other')]), [{ id: 'cta', role: 'cta', selectors: ['.primary'] }]);
  eq('a promised selector missing on the target is FAIL', absent.status, 'FAIL');
  eq('and the difference is of kind missing', absent.differences[0].kind, 'missing');
  eq('and the reason says which side', absent.reason, 'declared selector found nothing on the target side');

  const shifted = snap([node('.primary', { 'min-height': '60px', padding: '15px 16px' }, { rect: { x: 0, y: 6, w: 10, h: 10 } })]);
  const [moved] = contract.buildComponents(proto, shifted, [{ id: 'cta', role: 'cta', selectors: ['.primary'], styleProps: [] }]);
  eq('geometry beyond tolerance is FAIL', moved.status, 'FAIL');
  eq('and names the axis', moved.differences[0].axis, 'y');
  eq('and carries both readings', [moved.differences[0].prototype, moved.differences[0].target], [0, 6]);

  const recoloured = snap([node('.primary', { 'min-height': '60px', padding: '15px 16px', 'background-color': 'rgb(0, 0, 0)' })]);
  const [styleDiff] = contract.buildComponents(proto, recoloured, [{ id: 'cta', role: 'cta', selectors: ['.primary'], styleProps: ['background-color'] }]);
  eq('a style that differs is FAIL', styleDiff.status, 'FAIL');
  eq('with the prop named', styleDiff.differences[0].prop, 'background-color');

  const partial = snap([node('.primary', { 'min-height': '60px' })]);
  const [unverifiable] = contract.buildComponents(proto, partial, [{ id: 'cta', role: 'cta', selectors: ['.primary'], styleProps: ['padding'] }]);
  eq('a prop only one side reports is UNVERIFIED, not FAIL', unverifiable.status, 'UNVERIFIED');
  eq('as kind unverified', unverifiable.differences[0].kind, 'unverified');

  const twice = snap([
    node('.primary', { 'min-height': '60px', padding: '15px 16px' }),
    node('.primary'),
  ]);
  const [counted] = contract.buildComponents(proto, twice, [{ id: 'cta', role: 'cta', selectors: ['.primary'], styleProps: [] }]);
  eq('an instance count mismatch is FAIL', counted.status, 'FAIL');
  eq('with both counts', counted.differences[0], { kind: 'count', prototype: 1, target: 2 });
}

section('page layout rhythm is inferred and labelled as such');
{
  const proto = snap([
    node('.header', {}, { rect: { x: 0, y: 0, w: 390, h: 90 } }),
    node('.actions', {}, { rect: { x: 0, y: 104, w: 390, h: 60 } }),
    node('.list', {}, { rect: { x: 0, y: 172, w: 390, h: 200 } }),
  ]);
  const sections = [
    { id: 'header', role: 'header', selector: '.header' },
    { id: 'actions', role: 'actions', selector: '.actions' },
    { id: 'list', role: 'list', selector: '.list' },
    { id: 'missing', role: 'footer', selector: '.nope' },
  ];

  const layout = contract.buildPageLayout(proto, null, sections);
  eq('unmeasured section is UNVERIFIED', layout.sections.find(x => x.id === 'missing').status, 'UNVERIFIED');
  eq('gaps computed from measured rects', layout.rhythm.map(r => r.gap), [14, 8]);
  eq('gap provenance is inferred', layout.rhythm[0].source.kind, 'inferred');
  eq('inferred value points at both operands', layout.rhythm[0].source.from, ['header', 'actions']);
  eq('without a target side a gap cannot be judged', layout.rhythm[0].status, 'UNVERIFIED');
  eq('and says so', layout.rhythm[0].targetGap, null);
  eq('a resolved section without a target side is UNVERIFIED', layout.sections[0].status, 'UNVERIFIED');
  eq('coverage counts what was actually compared', layout.coverage, { sectionsDeclared: 4, resolved: 3, compared: 0 });

  const target = snap([
    node('.header', {}, { rect: { x: 0, y: 0, w: 390, h: 90 } }),
    node('.actions', {}, { rect: { x: 0, y: 112, w: 390, h: 60 } }),
    node('.list', {}, { rect: { x: 0, y: 172, w: 390, h: 200 } }),
  ]);
  const both = contract.buildPageLayout(proto, target, sections);
  eq('both sides measured, matching boxes pass', both.sections[0].status, 'PASS');
  eq('target gap is measured too', both.rhythm.map(r => r.targetGap), [22, 0]);
  eq('gap delta is the difference of the two readings', both.rhythm.map(r => r.delta), [8, -8]);
  eq('a gap outside tolerance fails', both.rhythm.map(r => r.status), ['FAIL', 'FAIL']);
  eq('coverage records the comparison', both.coverage, { sectionsDeclared: 4, resolved: 3, compared: 3 });

  const absent = contract.buildPageLayout(proto, snap([node('.header'), node('.actions')]), sections);
  eq('a section promised on the target and missing is FAIL',
    absent.sections.find(x => x.id === 'list').status, 'FAIL');
  eq('and the difference says missing',
    absent.sections.find(x => x.id === 'list').differences[0].kind, 'missing');
  eq('a gap whose target operand is missing is UNVERIFIED, not a pass',
    absent.rhythm[1].status, 'UNVERIFIED');
}

if (require.main === module) process.exit(finish('contract.test'));
module.exports = {};

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
  const s = snap([node('.primary', { 'min-height': '60px', padding: '15px 16px' }, { text: '地图选点' })]);
  const [missing] = contract.buildComponents(s, [{ id: 'cta', role: 'cta', selectors: ['.nope'] }]);
  eq('missing selector is UNVERIFIED', missing.status, 'UNVERIFIED');
  eq('and says why', missing.reason, 'selector not found in snapshot');
  eq('provenance is unknown', missing.source.kind, 'unknown');

  const [found] = contract.buildComponents(s, [{ id: 'cta', role: 'cta', selectors: ['.primary'], styleProps: ['padding'] }]);
  eq('found selector is a measurement', found.status, 'PASS');
  eq('instance records the captured node', found.instances[0].source.captureNode, '.primary');
  eq('style projection is limited to what was asked', found.instances[0].styles, { padding: '15px 16px' });
  eq('text travels with the instance', found.instances[0].text, '地图选点');
}

section('page layout rhythm is inferred and labelled as such');
{
  const s = snap([
    node('.header', {}, { rect: { x: 0, y: 0, w: 390, h: 90 } }),
    node('.actions', {}, { rect: { x: 0, y: 104, w: 390, h: 60 } }),
    node('.list', {}, { rect: { x: 0, y: 172, w: 390, h: 200 } }),
  ]);
  const layout = contract.buildPageLayout(s, [
    { id: 'header', role: 'header', selector: '.header' },
    { id: 'actions', role: 'actions', selector: '.actions' },
    { id: 'list', role: 'list', selector: '.list' },
    { id: 'missing', role: 'footer', selector: '.nope' },
  ]);
  eq('unmeasured section is UNVERIFIED', layout.sections.find(x => x.id === 'missing').status, 'UNVERIFIED');
  eq('gaps computed from measured rects', layout.rhythm.map(r => r.gap), [14, 8]);
  eq('gap provenance is inferred', layout.rhythm[0].source.kind, 'inferred');
  eq('inferred value points at both operands', layout.rhythm[0].source.from, ['header', 'actions']);
}

if (require.main === module) process.exit(finish('contract.test'));
module.exports = {};

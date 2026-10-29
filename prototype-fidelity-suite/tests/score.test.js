'use strict';
/**
 * Scorecard: every dimension stands on its own, failures cannot be averaged
 * away, and missing evidence never aggregates to PASS.
 */
const { check, eq, section, totals, finish } = require('./harness');
const score = require('../core/lib/score');
const stateChecks = require('../core/lib/state-checks');

function pair(over) {
  const base = {
    pairId: 'p', role: 'row', criticality: 'normal', status: 'PASS',
    presence: { prototype: true, target: true },
    geometry: { dx: 0, dy: 0, dw: 0, dh: 0, positionPass: true, sizePass: true },
    styles: [],
    text: { prototype: 'x', target: 'x', equal: true },
    categories: [],
  };
  return Object.assign(base, over);
}

function withStyle(prop, status, extra) {
  return pair({ status: status === 'UNVERIFIED' ? 'UNVERIFIED' : 'PASS', styles: [Object.assign({ prop, status, a: '1', b: '1' }, extra)] });
}

function failingGeometry(over) {
  return pair(Object.assign({ status: 'FAIL', categories: ['position'], geometry: { dx: 4, dy: 0, dw: 0, dh: 0, positionPass: false, sizePass: true } }, over));
}

section('failures are traceable back to a region');
{
  const diffRegion = failingGeometry({ pairId: undefined, id: 'header' });
  const sc = score.buildScorecard({ pairs: [diffRegion] });
  eq('regions that use id are named', sc.nonCriticalFailures[0].pairId, 'header');
  const geoRecord = failingGeometry({ pairId: 'title' });
  const sc2 = score.buildScorecard({ pairs: [geoRecord] });
  eq('geometry records that use pairId are named', sc2.nonCriticalFailures[0].pairId, 'title');
}

section('a rendering difference is an appearance failure, not an orphan verdict');
{
  // Experiment B produced a FAIL verdict with every dimension PASS: an ink
  // difference reached the overall verdict through the region list but no
  // dimension owned it, so the report could not say what had failed.
  const ink = pair({ id: 'label', status: 'FAIL', categories: ['ink'], pixel: { status: 'FAIL', informativeOnly: true } });
  const px = pair({ id: 'crop', status: 'FAIL', categories: ['pixel'], pixel: { status: 'FAIL' } });
  const sc = score.buildScorecard({ pairs: [ink, px] });
  eq('appearance owns it', sc.dimensions.appearance.verdict, 'FAIL');
  eq('geometry stays clean', sc.dimensions.geometry.verdict, 'PASS');
  eq('the failing regions are named', sc.nonCriticalFailures.map(r => r.pairId).sort(), ['crop', 'label']);

  const criticalInk = pair({ id: 'hero', criticality: 'critical', status: 'FAIL', categories: ['ink'] });
  const sc2 = score.buildScorecard({ pairs: [criticalInk] });
  eq('a critical rendering failure is reported as critical',
    sc2.dimensions.appearance.checks.fail, 1);
}

section('each dimension reports its own verdict');
{
  const sc = score.buildScorecard({ pairs: [pair(), pair({ pairId: 'q' })] });
  eq('geometry measured and clean', sc.dimensions.geometry.verdict, 'PASS');
  eq('typography clean', sc.dimensions.typography.verdict, 'PASS');
  eq('appearance clean', sc.dimensions.appearance.verdict, 'PASS');
  eq('overall follows the dimensions', sc.verdict, 'PASS');
  check('there is no single similarity number', sc.similarity === undefined && sc.score === undefined, JSON.stringify(Object.keys(sc)));
  eq('geometry mean error is reported per axis', sc.dimensions.geometry.metrics.position.meanAbsPx, 0);
}

section('a critical failure cannot be bought back by budget');
{
  const sc = score.buildScorecard({
    pairs: [failingGeometry({ criticality: 'critical' }), pair({ pairId: 'q' }), pair({ pairId: 'r' })],
    thresholds: { budget: { criticalFailures: 0, nonCriticalFailures: 99 } },
  });
  eq('a generous non-critical budget does not excuse a critical failure', sc.verdict, 'FAIL');
  eq('the critical failure is named', sc.criticalFailures.length, 1);
  eq('its categories are preserved', sc.criticalFailures[0].categories, ['position']);
  eq('geometry itself is FAIL', sc.dimensions.geometry.verdict, 'FAIL');
}

section('non-critical failures respect the declared budget');
{
  const pairs = [failingGeometry({ pairId: 'a' }), pair({ pairId: 'b' })];
  const strict = score.buildScorecard({ pairs });
  eq('default budget is zero failures', strict.verdict, 'FAIL');
  const lenient = score.buildScorecard({ pairs, thresholds: { budget: { nonCriticalFailures: 1 } } });
  eq('declared allowance is honoured', lenient.verdict, 'PASS');
  eq('the failure is still listed, not hidden', lenient.nonCriticalFailures.length, 1);
}

section('missing evidence never aggregates to PASS');
{
  const empty = score.buildScorecard({ pairs: [] });
  eq('no pairs at all is UNVERIFIED', empty.verdict, 'UNVERIFIED');
  eq('geometry is UNVERIFIED', empty.dimensions.geometry.verdict, 'UNVERIFIED');
  eq('typography is UNVERIFIED', empty.dimensions.typography.verdict, 'UNVERIFIED');
  eq('appearance is UNVERIFIED', empty.dimensions.appearance.verdict, 'UNVERIFIED');

  const partial = score.buildScorecard({ pairs: [pair({ pairId: 'a' }), withStyle('color', 'UNVERIFIED')] });
  eq('a one-sided property makes the pair UNVERIFIED', partial.coverage.pairsUnverified, 1);
  eq('so the overall verdict cannot be PASS', partial.verdict, 'UNVERIFIED');
  eq('appearance carries the unverified count', partial.dimensions.appearance.checks.unverified, 1);
  eq('appearance does not claim PASS', partial.dimensions.appearance.verdict, 'UNVERIFIED');
  eq('geometry is still measured and clean', partial.dimensions.geometry.verdict, 'PASS');
  eq('a one-sided property is not a failure', partial.nonCriticalFailures.length, 0);
}

section('accepted absence is not a failure');
{
  const na = pair({
    pairId: 'recent', status: 'NOT_APPLICABLE', presence: { prototype: true, target: false },
    geometry: null, text: null, categories: ['target-missing'],
  });
  const sc = score.buildScorecard({ pairs: [pair({ pairId: 'a' }), na] });
  eq('NOT_APPLICABLE is counted as such', sc.coverage.notApplicable, 1);
  eq('it is not reported as missing on target', sc.coverage.missingOnTarget, 0);
  eq('appearance is not failed by an accepted difference', sc.dimensions.appearance.verdict, 'PASS');
  eq('the overall verdict is unaffected', sc.verdict, 'PASS');
  eq('only measured pairs enter the appearance denominator', sc.dimensions.appearance.checks.total, 1);
}

section('a missing required node is an appearance failure');
{
  const missing = pair({ pairId: 'hero', status: 'FAIL', presence: { prototype: true, target: false }, geometry: null, text: null, categories: ['target-missing'] });
  const sc = score.buildScorecard({ pairs: [missing] });
  eq('counted', sc.coverage.missingOnTarget, 1);
  eq('the dimension fails', sc.dimensions.appearance.verdict, 'FAIL');
  eq('overall fails', sc.verdict, 'FAIL');
}

section('typography collects styles, text and wrapping');
{
  const badWeight = withStyle('font-weight', 'FAIL', { a: '730', b: '700', delta: 30 });
  const badText = pair({ pairId: 't', text: { prototype: '一个地点', target: '一个地点，', equal: false } });
  const wrapped = pair({ pairId: 'w', text: { prototype: '一段路线', target: '一段\n路线', equal: true, lineDelta: 1 } });
  const sc = score.buildScorecard({ pairs: [badWeight, badText, wrapped] });
  eq('weight failure counted', sc.dimensions.typography.metrics.style.fail, 1);
  eq('text mismatch counted', sc.dimensions.typography.metrics.text.fail, 1);
  eq('line delta counted separately', sc.dimensions.typography.metrics.wrap.fail, 1);
  eq('typography fails', sc.dimensions.typography.verdict, 'FAIL');
  eq('appearance is untouched by typography props', sc.dimensions.appearance.checks.fail, 0);
}

section('the spacing dimension is opt-in and measured');
{
  const withSpacing = score.buildScorecard({ pairs: [pair()], spacing: { total: 3, fail: 1, maxAbsPx: 8 } });
  eq('spacing enters the geometry count', withSpacing.dimensions.geometry.metrics.spacing.total, 3);
  eq('geometry absorbs the spacing failure', withSpacing.dimensions.geometry.verdict, 'FAIL');
  const without = score.buildScorecard({ pairs: [pair()] });
  eq('absent spacing is not invented', without.dimensions.geometry.metrics.spacing, undefined);
}

section('state and interaction are their own dimensions');
{
  const sc = score.buildScorecard({
    pairs: [pair()],
    state: { total: 4, fail: 1, metrics: { declared: 4 } },
    interaction: { total: 2, fail: 0, metrics: { driver: 'miniprogram-automator' } },
  });
  eq('state failures surface', sc.dimensions.state.verdict, 'FAIL');
  eq('interaction passes on its own evidence', sc.dimensions.interaction.verdict, 'PASS');
  eq('a red state dimension fails the whole card', sc.verdict, 'FAIL');
}

section('interaction check records are accepted as evidence');
{
  const pass = score.buildScorecard({
    pairs: [pair()],
    interaction: [{ id: 'a', status: 'PASS' }, { id: 'b', status: 'PASS' }],
  });
  eq('two passing checks are a pass', pass.dimensions.interaction.verdict, 'PASS');
  eq('counts come from the records', pass.dimensions.interaction.checks.total, 2);
  eq('overall can pass when interactions really ran', pass.verdict, 'PASS');

  const blocked = score.buildScorecard({
    pairs: [pair()],
    interaction: [{ id: 'a', status: 'BLOCKED' }],
  });
  eq('a blocked driver is not a pass', blocked.dimensions.interaction.verdict, 'UNVERIFIED');
  eq('blocked is counted', blocked.dimensions.interaction.checks.blocked, 1);
  eq('overall becomes UNVERIFIED', blocked.verdict, 'UNVERIFIED');

  const none = score.buildScorecard({ pairs: [pair()], interaction: [] });
  eq('no declared checks is UNVERIFIED', none.dimensions.interaction.verdict, 'UNVERIFIED');
  eq('and drags the card to UNVERIFIED', none.verdict, 'UNVERIFIED');

  const failed = score.buildScorecard({ pairs: [pair()], interaction: [{ id: 'a', status: 'FAIL' }] });
  eq('a failed interaction fails the dimension', failed.dimensions.interaction.verdict, 'FAIL');
  eq('and the card', failed.verdict, 'FAIL');
}

section('verdictOf is the shared counting rule');
{
  eq('empty', score.verdictOf({ total: 0, fail: 0, pass: 0 }), 'UNVERIFIED');
  eq('clean', score.verdictOf({ total: 3, fail: 0, pass: 3 }), 'PASS');
  eq('budget respected', score.verdictOf({ total: 3, fail: 1, pass: 2 }, { nonCriticalFailures: 1 }), 'PASS');
  eq('over budget', score.verdictOf({ total: 3, fail: 2, pass: 1 }, { nonCriticalFailures: 1 }), 'FAIL');
  eq('all not applicable is not a pass',
    score.verdictOf({ total: 2, fail: 0, pass: 0, notApplicable: 2 }), 'UNVERIFIED');
}

section('coverage is reported, not inferred');
{
  const sc = score.buildScorecard({
    pairs: [pair({ pairId: 'a' }), failingGeometry({ pairId: 'b' }), pair({ pairId: 'c', criticality: 'critical' })],
    pixel: { regions: [{ id: 'a' }, { id: 'b' }] },
  });
  eq('declared', sc.coverage.pairsDeclared, 3);
  eq('critical count', sc.coverage.criticalPairs, 1);
  eq('measured count', sc.coverage.pairsMeasured, 3);
  eq('pixel regions counted', sc.coverage.pixelsCompared, 2);
  eq('schema version', sc.schemaVersion, '1.0.0');
  check('generatedAt is a timestamp', !Number.isNaN(Date.parse(sc.generatedAt)));
}

section('state checks compare artifacts with the declaration');
{
  const manifest = (dataSource) => ({ source: { dataSource } });
  const pageState = (declared, usable) => ({
    states: [{
      id: 'real',
      injection: { declared, dataSource: declared ? 'injected' : 'real', keys: [] },
      usableAsInteractionEvidence: usable,
    }],
  });

  const agree = stateChecks.buildStateChecks({
    state: { id: 'real' },
    pageState: pageState(false, true),
    prototype: manifest('real'),
    target: manifest('real'),
  });
  eq('agreement is four checks', agree.length, 4);
  eq('agreement passes the dimension', score.buildScorecard({ pairs: [pair()], state: agree }).dimensions.state.verdict, 'PASS');

  const undeclaredInjection = stateChecks.buildStateChecks({
    state: { id: 'real', injectData: { plans: [] } },
    pageState: pageState(false, true),
    prototype: manifest('real'),
    target: manifest('injected'),
  });
  eq('an injection the manifest does not declare fails', undeclaredInjection.find(c => c.id.endsWith(':declared')).status, 'FAIL');

  const inertInjection = stateChecks.buildStateChecks({
    state: { id: 'real', injectData: { plans: [] } },
    pageState: pageState(true, false),
    prototype: manifest('real'),
    target: manifest('real'),
  });
  eq('a declared injection that did not take effect fails the target side', inertInjection.find(c => c.id.endsWith(':data-source:target')).status, 'FAIL');

  const injectedStillUsable = stateChecks.buildStateChecks({
    state: { id: 'real', injectData: { plans: [] } },
    pageState: pageState(true, true),
    prototype: manifest('real'),
    target: manifest('injected'),
  });
  const usable = injectedStillUsable.find(c => c.id.endsWith(':interaction-evidence'));
  eq('an injected state claiming interaction eligibility fails', usable.status, 'FAIL');
  check('and says what was expected', /expected false/.test(usable.detail), usable.detail);

  const missing = stateChecks.buildStateChecks({
    state: { id: 'real' },
    pageState: null,
    prototype: manifest('real'),
    target: null,
  });
  eq('a missing side is unverified', missing.find(c => c.id.endsWith(':data-source:target')).status, 'UNVERIFIED');
  eq('a missing manifest is unverified, not a pass', missing.find(c => c.id.endsWith(':declared')).status, 'UNVERIFIED');
  eq('unverified state evidence keeps the card unverified', score.buildScorecard({ pairs: [pair()], state: missing }).verdict, 'UNVERIFIED');
}

finish('score.test');

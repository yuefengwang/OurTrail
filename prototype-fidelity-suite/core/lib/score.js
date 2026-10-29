'use strict';
/**
 * Multi-dimensional fidelity scorecard.
 *
 * Deliberately NOT a single number: each dimension reports its own checks and
 * verdict. Thresholds are tolerances calibrated in tests/experiment-a.js and
 * tests/experiment-b.js (see docs/architecture.md §6); the pass *criterion* is
 * "every critical pair passes and non-critical failures stay under the budget",
 * not an invented 95% similarity.
 */
const { round } = require('./util');

const DEFAULT_BUDGET = { criticalFailures: 0, nonCriticalFailures: 0 };

function counts(records, predicate) {
  let total = 0, pass = 0, fail = 0, unverified = 0, na = 0;
  for (const r of records) {
    if (predicate && !predicate(r)) continue;
    total++;
    if (r.status === 'PASS') pass++;
    else if (r.status === 'FAIL') fail++;
    else if (r.status === 'NOT_APPLICABLE') na++;
    else unverified++;
  }
  return { total, pass, fail, unverified, notApplicable: na };
}

function verdictOf(c, budget) {
  const b = Object.assign({}, DEFAULT_BUDGET, budget || {});
  if (c.total === 0) return 'UNVERIFIED';
  if (c.fail > b.nonCriticalFailures) return 'FAIL';
  if (c.fail === 0 && c.pass === 0) return 'UNVERIFIED';
  return 'PASS';
}

function hasCategory(r, category) {
  return (r.categories || []).includes(category);
}

function styleStatus(records, props) {
  let total = 0, fail = 0, unverified = 0, criticalFail = 0;
  for (const r of records) {
    for (const s of r.styles || []) {
      if (!props.includes(s.prop)) continue;
      // A style difference the region already accepted is not a dimension failure.
      if (s.accepted === true) continue;
      total++;
      if (s.status === 'FAIL') {
        fail++;
        if (r.criticality === 'critical') criticalFail++;
      } else if (s.status === 'UNVERIFIED') unverified++;
    }
  }
  return { total, fail, unverified, criticalFail };
}

/**
 * A dimension with no measurement is UNVERIFIED. Measured-but-partial evidence
 * is also UNVERIFIED: a property reported by only one side means the comparison
 * did not happen, and "not compared" must never read as "matches".
 * A critical pair's failure is not a budget line: `nonCriticalFailures` is the
 * allowance for ordinary pairs only.
 */
function dimensionVerdict(total, fail, budget, unverified, criticalFail) {
  if (criticalFail > 0) return 'FAIL';
  if (fail > budget.nonCriticalFailures) return 'FAIL';
  if (!total) return 'UNVERIFIED';
  if (unverified) return 'UNVERIFIED';
  return 'PASS';
}

/**
 * @param {object} input
 * @param {Array} input.pairs      records from geometry.compareSnapshots
 * @param {object} [input.pixel]   aggregate pixel diff stats per region
 * @param {object} [input.state]   state assertions
 * @param {object} [input.interaction]
 * @param {object} [input.thresholds]
 */
function buildScorecard(input) {
  const pairs = input.pairs || [];
  const th = input.thresholds || {};
  const budget = th.budget || DEFAULT_BUDGET;
  const critical = pairs.filter(p => p.criticality === 'critical');
  const nonCritical = pairs.filter(p => p.criticality !== 'critical');

  const geo = {
    position: { total: 0, fail: 0, criticalFail: 0, maxAbsPx: 0, meanAbsPx: 0 },
    size: { total: 0, fail: 0, criticalFail: 0, maxAbsPx: 0, meanAbsPx: 0 },
  };
  let posSum = 0, sizeSum = 0;
  for (const r of pairs) {
    if (!r.geometry) continue;
    const isCritical = r.criticality === 'critical';
    // Failure is read from the region's *remaining* categories when they exist:
    // a position delta that the region already accepted (acceptedDifferences)
    // must not fail geometry a second time. `positionPass` stays as the raw
    // measurement and is used only for records built without categories.
    const cats = Array.isArray(r.categories) ? r.categories : null;
    const posFailed = cats ? cats.includes('position') : !r.geometry.positionPass;
    const sizeFailed = cats ? cats.includes('size') : !r.geometry.sizePass;
    geo.position.total++;
    const posErr = Math.max(Math.abs(r.geometry.dx), Math.abs(r.geometry.dy));
    posSum += posErr;
    if (posErr > geo.position.maxAbsPx) geo.position.maxAbsPx = round(posErr, 2);
    if (posFailed) {
      geo.position.fail++;
      if (isCritical) geo.position.criticalFail++;
    }
    geo.size.total++;
    const sizeErr = Math.max(Math.abs(r.geometry.dw), Math.abs(r.geometry.dh));
    sizeSum += sizeErr;
    if (sizeErr > geo.size.maxAbsPx) geo.size.maxAbsPx = round(sizeErr, 2);
    if (sizeFailed) {
      geo.size.fail++;
      if (isCritical) geo.size.criticalFail++;
    }
  }
  geo.position.meanAbsPx = geo.position.total ? round(posSum / geo.position.total, 2) : 0;
  geo.size.meanAbsPx = geo.size.total ? round(sizeSum / geo.size.total, 2) : 0;
  if (input.spacing) {
    geo.spacing = {
      total: input.spacing.total || 0,
      fail: input.spacing.fail || 0,
      maxAbsPx: input.spacing.maxAbsPx || 0,
    };
  }

  const typo = styleStatus(pairs, ['font-size', 'font-weight', 'line-height', 'letter-spacing']);
  // A dimension must not fail on a difference its own region already accepted
  // (acceptedDifferences) or that was declared dynamic. Containers are not
  // copy comparisons at all — `judged:false`.
  const excused = (r, category) => (r.acceptedCategories || []).includes(category);
  const textChecks = pairs.filter(r => r.text && (r.text.prototype || r.text.target));
  const textJudged = textChecks.filter(r => r.text.judged !== false && r.text.comparable !== false);
  const textFail = textJudged.filter(r => r.text.equal === false && !r.text.volatile && !excused(r, 'text')).length;
  const textCriticalFail = textJudged.filter(r => r.text.equal === false && !r.text.volatile &&
    !excused(r, 'text') && r.criticality === 'critical').length;
  const wrapChecks = textJudged.filter(r => r.text.lineDelta != null);
  const wrapFail = wrapChecks.filter(r => r.text.lineDelta !== 0 && !excused(r, 'text-wrap')).length;
  const wrapCriticalFail = wrapChecks.filter(r => r.text.lineDelta !== 0 && !excused(r, 'text-wrap') &&
    r.criticality === 'critical').length;

  const appearance = styleStatus(pairs, ['color', 'background-color', 'border-radius', 'border-top-width', 'border-top-color', 'box-shadow', 'opacity']);
  // Pixel and ink differences are appearance evidence: the region rendered
  // differently (a cropped image, a heavier stroke) while no declaration moved.
  // Without this they reached only the overall verdict, producing a FAIL with
  // every dimension PASS — a report that cannot say what failed.
  const renderingFail = pairs.filter(r => (r.categories || []).some(c => c === 'pixel' || c === 'ink'));
  // An optional node accepted as absent is NOT_APPLICABLE, not a failure.
  // Counting it here would report an accepted difference as a defect.
  const missingTarget = pairs.filter(r => r.presence.target === false && r.status !== 'NOT_APPLICABLE');
  const missingPrototype = pairs.filter(r => r.presence.prototype === false && r.status !== 'NOT_APPLICABLE');
  const pairsMeasured = pairs.filter(r => r.geometry);
  const pairsUnverified = pairs.filter(r => r.status === 'UNVERIFIED');

  const geometryFail = geo.position.fail + geo.size.fail + (input.spacing ? input.spacing.fail : 0);
  const geometryTotal = geo.position.total + geo.size.total + (input.spacing ? input.spacing.total : 0);
  const geometryCriticalFail = geo.position.criticalFail + geo.size.criticalFail;
  const typographyFail = typo.fail + textFail + wrapFail;
  const typographyTotal = typo.total + textJudged.length + wrapChecks.length;
  const typographyCriticalFail = typo.criticalFail + textCriticalFail + wrapCriticalFail;
  const appearanceFail = appearance.fail + missingTarget.length + renderingFail.length;
  const appearanceTotal = appearance.total + pairsMeasured.length;
  const appearanceCriticalFail = appearance.criticalFail
    + missingTarget.filter(r => r.criticality === 'critical').length
    + renderingFail.filter(r => r.criticality === 'critical').length;

  const dims = {
    geometry: {
      checks: { total: geometryTotal, pass: geometryTotal - geometryFail, fail: geometryFail, unverified: 0 },
      metrics: geo,
      verdict: dimensionVerdict(geometryTotal, geometryFail, budget, 0, geometryCriticalFail),
    },
    typography: {
      checks: {
        total: typographyTotal, fail: typographyFail,
        pass: typographyTotal - typographyFail, unverified: typo.unverified,
      },
      metrics: {
        style: typo, text: { total: textChecks.length, fail: textFail },
        wrap: { total: wrapChecks.length, fail: wrapFail },
      },
      verdict: dimensionVerdict(typographyTotal, typographyFail, budget, typo.unverified, typographyCriticalFail),
    },
    appearance: {
      checks: {
        total: appearanceTotal, fail: appearanceFail,
        pass: appearanceTotal - appearanceFail, unverified: appearance.unverified,
      },
      metrics: {
        style: appearance,
        missingOnTarget: missingTarget.length,
        missingOnPrototype: missingPrototype.length,
        notApplicable: pairs.filter(r => r.status === 'NOT_APPLICABLE').length,
      },
      verdict: dimensionVerdict(appearanceTotal, appearanceFail, budget, appearance.unverified, appearanceCriticalFail),
    },
  };

  if (input.state) dims.state = checkDimension(input.state);
  if (input.interaction) dims.interaction = checkDimension(input.interaction);

  const criticalFailures = critical.filter(r => r.status === 'FAIL');
  const nonCriticalFailures = nonCritical.filter(r => r.status === 'FAIL');
  const dimVerdicts = Object.values(dims).map(d => d.verdict);
  let overall;
  if (criticalFailures.length > 0) overall = 'FAIL';
  else if (nonCriticalFailures.length > budget.nonCriticalFailures) overall = 'FAIL';
  else if (dimVerdicts.includes('FAIL')) overall = 'FAIL';
  // A dimension that could not be measured is missing evidence, and the brief
  // forbids letting that aggregate to PASS.
  else if (dimVerdicts.includes('UNVERIFIED')) overall = 'UNVERIFIED';
  else if (pairsUnverified.length > 0) overall = 'UNVERIFIED';
  else overall = 'PASS';

  return {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    dimensions: dims,
    criticalFailures: criticalFailures.map(brief),
    nonCriticalFailures: nonCriticalFailures.map(brief),
    budget,
    coverage: {
      pairsDeclared: pairs.length,
      criticalPairs: critical.length,
      pairsMeasured: pairsMeasured.length,
      pairsUnverified: pairsUnverified.length,
      notApplicable: pairs.filter(r => r.status === 'NOT_APPLICABLE').length,
      missingOnTarget: missingTarget.length,
      missingOnPrototype: missingPrototype.length,
      pixelsCompared: input.pixel && input.pixel.regions ? input.pixel.regions.length : 0,
    },
    verdict: overall,
  };
}

/**
 * State and interaction dimensions arrive either as counts or as the check
 * records themselves. Normalising here keeps the scorecard consistent with the
 * validation report, which receives the records.
 */
function checkDimension(spec) {
  if (Array.isArray(spec)) {
    let pass = 0, fail = 0, unverified = 0, blocked = 0;
    for (const c of spec) {
      if (c.status === 'PASS') pass++;
      else if (c.status === 'FAIL') fail++;
      else if (c.status === 'BLOCKED') blocked++;
      else unverified++;
    }
    return {
      checks: { total: spec.length, pass, fail, unverified: unverified + blocked, blocked },
      metrics: {},
      verdict: fail ? 'FAIL' : (spec.length && !unverified && !blocked ? 'PASS' : 'UNVERIFIED'),
    };
  }
  const total = spec.total || 0;
  const fail = spec.fail || 0;
  return {
    checks: { total, pass: total - fail, fail, unverified: spec.unverified || 0, blocked: spec.blocked || 0 },
    metrics: spec.metrics || {},
    verdict: fail ? 'FAIL' : (total && !spec.unverified && !spec.blocked ? 'PASS' : 'UNVERIFIED'),
  };
}

function brief(r) {
  return {
    // Diff-report regions carry `id`; geometry records carry `pairId`. A
    // scorecard that names neither cannot be traced back to a region.
    pairId: r.id != null ? r.id : (r.pairId != null ? r.pairId : null),
    role: r.role, criticality: r.criticality,
    categories: r.categories, geometry: r.geometry,
    failingStyles: (r.styles || []).filter(s => s.status === 'FAIL').map(s => ({ prop: s.prop, a: s.a, b: s.b, delta: s.delta })),
    notes: r.notes || null,
  };
}

module.exports = { buildScorecard, verdictOf, DEFAULT_BUDGET };

'use strict';
/**
 * Artifact builders. These carry the verdicts a reviewer reads, so the tests
 * focus on what may never happen: a report with no measurements claiming PASS,
 * a capture with no screenshot looking complete, an interaction section with no
 * checks reporting success.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const png = require('../core/lib/png');
const image = require('../core/lib/image');
const artifacts = require('../core/lib/artifacts');
const { check, eq, section, finish } = require('./harness');

section('capture manifest states what is missing');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-art-'));
  const shot = path.join(dir, 'shot.png');
  const img = image.create(4, 2, [1, 2, 3, 255]);
  png.writeFile(shot, img);

  const good = artifacts.buildCaptureManifest({
    pageId: 'p', stateId: 's', side: 'target', platform: 'wechat-miniprogram',
    screenshotPath: shot, screenshotSize: { width: 4, height: 2 },
    screenshotScale: { x: 0.78, y: 0.78 }, viewport: { width: 390, height: 844 }, dpr: 3,
    nodeCount: 12, dataSource: 'injected', injection: { plan: true },
  });
  eq('schema version is declared', good.schemaVersion, artifacts.SCHEMA_VERSION);
  eq('sha256 of the raw screenshot', good.screenshot.sha256.length, 64);
  eq('scale provenance', good.screenshot.normalizedFrom, 'device-pixels');
  eq('data source is carried, not inferred', good.source.dataSource, 'injected');
  eq('injection payload is recorded', good.source.injection, { plan: true });

  const missing = artifacts.buildCaptureManifest({ pageId: 'p', side: 'prototype', platform: 'web' });
  eq('no screenshot → path null', missing.screenshot.path, null);
  eq('…and hash not invented', missing.screenshot.sha256, null);
  check('…and the reason is written down', typeof missing.screenshot.missing === 'string', missing.screenshot);

  fs.rmSync(dir, { recursive: true, force: true });
}

section('visual diff report verdict follows measured regions');
{
  const empty = artifacts.buildVisualDiffReport({ pageId: 'p', stateId: 's', regions: [] });
  eq('no regions → UNVERIFIED', empty.verdict, 'UNVERIFIED');
  eq('kind', empty.kind, 'visual-diff-report');

  const passing = artifacts.buildVisualDiffReport({
    pageId: 'p', stateId: 's',
    regions: [{ id: 'a', status: 'PASS', pixel: { diffRatio: 0 } }, { id: 'b', status: 'PASS', pixel: { diffRatio: 0 } }],
  });
  eq('all pass → PASS', passing.verdict, 'PASS');
  eq('failing count', passing.measurement.regionsFailing, 0);

  const failing = artifacts.buildVisualDiffReport({
    pageId: 'p', stateId: 's',
    regions: [{ id: 'a', status: 'PASS', pixel: { diffRatio: 0 } }, { id: 'b', status: 'FAIL', pixel: { diffRatio: 0.2 } }],
  });
  eq('one failing region → FAIL', failing.verdict, 'FAIL');
  eq('counts add up', [failing.measurement.regionsCompared, failing.measurement.regionsFailing], [2, 1]);
}

section('validation report couples interaction status to actual checks');
{
  const none = artifacts.buildValidationReport({ pageId: 'p', stateId: 's', scorecard: { verdict: 'PASS' } });
  eq('no interaction checks → UNVERIFIED, not PASS', none.interaction.status, 'UNVERIFIED');
  eq('report status does not inherit a pass it did not measure', none.status, 'PASS');

  const mixed = artifacts.buildValidationReport({
    pageId: 'p', stateId: 's',
    scorecard: { verdict: 'PASS' },
    interaction: { checks: [
      { id: 'i1', status: 'PASS' },
      { id: 'i2', status: 'UNVERIFIED' },
      { id: 'i3', status: 'FAIL' },
    ] },
  });
  eq('fail wins over unverified', mixed.interaction.status, 'FAIL');
  eq('both are counted', [mixed.interaction.fail, mixed.interaction.unverified], [1, 1]);

  const blocked = artifacts.buildValidationReport({
    pageId: 'p', stateId: 's', scorecard: { verdict: 'FAIL' },
    interaction: { checks: [{ id: 'i1', status: 'BLOCKED' }] },
  });
  eq('blocked is not a pass', blocked.interaction.status, 'UNVERIFIED');
  eq('scorecard verdict is preserved as the report status', blocked.status, 'FAIL');
}

section('status rollup');
{
  eq('empty → UNVERIFIED', artifacts.statusRollup([]), 'UNVERIFIED');
  eq('PASS + NA → PASS', artifacts.statusRollup(['PASS', 'NOT_APPLICABLE']), 'PASS');
  eq('FAIL dominates', artifacts.statusRollup(['PASS', 'BLOCKED', 'FAIL']), 'FAIL');
  eq('BLOCKED dominates UNVERIFIED', artifacts.statusRollup(['BLOCKED', 'UNVERIFIED']), 'BLOCKED');
  eq('UNVERIFIED is not rounded up', artifacts.statusRollup(['PASS', 'UNVERIFIED']), 'UNVERIFIED');
}

section('the declared status vocabulary is the one used');
{
  eq('statuses', artifacts.STATUSES, ['PASS', 'FAIL', 'UNVERIFIED', 'BLOCKED', 'NOT_APPLICABLE']);
}

if (require.main === module) process.exit(finish('artifacts.test'));
module.exports = {};

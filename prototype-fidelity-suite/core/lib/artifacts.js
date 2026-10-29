'use strict';
/**
 * Builders for the versioned artifacts. One place decides what "a capture
 * manifest" contains, so the CLI, the adapters and the tests cannot drift.
 */
const path = require('path');
const { sha256File, exists, isoNow, round } = require('./util');

const SCHEMA_VERSION = '1.0.0';
const STATUSES = ['PASS', 'FAIL', 'UNVERIFIED', 'BLOCKED', 'NOT_APPLICABLE'];

function buildCaptureManifest(input) {
  const shot = input.screenshotPath;
  const hasShot = shot && exists(shot);
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'capture-manifest',
    pageId: input.pageId,
    stateId: input.stateId || 'default',
    side: input.side,
    platform: input.platform,
    capturedAt: input.capturedAt || isoNow(),
    source: {
      url: input.url || null,
      projectRoot: input.projectRoot || null,
      route: input.route || null,
      codeVersion: input.codeVersion || null,
      dataSource: input.dataSource || 'real',
      injection: input.injection || null,
      note: input.note || null,
    },
    viewport: input.viewport || null,
    dpr: input.dpr == null ? null : input.dpr,
    screenshot: hasShot ? {
      path: path.basename(shot),
      sha256: sha256File(shot),
      width: input.screenshotSize && input.screenshotSize.width,
      height: input.screenshotSize && input.screenshotSize.height,
      scale: input.screenshotScale || { x: 1, y: 1 },
      normalizedFrom: input.screenshotScale ? 'device-pixels' : 'css-pixels',
    } : {
      path: null, sha256: null, width: null, height: null,
      missing: 'no screenshot was written for this capture',
    },
    snapshot: {
      nodes: input.nodeCount == null ? 0 : input.nodeCount,
      rootId: input.rootId || null,
      dimensions: input.documentSize || null,
    },
    provenance: {
      capturedBy: 'prototype-fidelity-suite',
      adapter: input.adapter || input.platform,
      verification: input.verification || 'unverified',
    },
  };
}

function buildVisualDiffReport(input) {
  const regions = input.regions || [];
  const failing = regions.filter(r => r.status === 'FAIL');
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'visual-diff-report',
    pageId: input.pageId,
    stateId: input.stateId || 'default',
    generatedAt: isoNow(),
    prototype: input.provenance && input.provenance.prototype || null,
    target: input.provenance && input.provenance.target || null,
    tolerances: input.tolerances || null,
    measurement: {
      method: 'region-crop',
      note: 'Both sides are cropped to the shared CSS sub-rect of the two nodes (common width and height, each anchored at its own origin), so a component offset is not charged to every region and a size difference stays a geometry finding.',
      regionsCompared: regions.length,
      regionsFailing: failing.length,
      totalDiffRatio: round(regions.reduce((a, r) => a + (r.pixel && r.pixel.diffRatio || 0), 0) / Math.max(1, regions.length), 5),
    },
    regions,
    fullPage: input.full || null,
    acceptedDifferences: input.acceptedDifferences || [],
    verdict: regions.length === 0 ? 'UNVERIFIED' : failing.length ? 'FAIL' : 'PASS',
  };
}

function buildValidationReport(input) {
  const sc = input.scorecard || {};
  const checks = input.interaction && input.interaction.checks || [];
  const interactionFail = checks.filter(c => c.status === 'FAIL').length;
  const interactionUnverified = checks.filter(c => c.status === 'UNVERIFIED' || c.status === 'BLOCKED').length;
  const status = input.status || sc.verdict || 'UNVERIFIED';
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'fidelity-validation-report',
    pageId: input.pageId,
    stateId: input.stateId || 'default',
    generatedAt: isoNow(),
    status,
    reason: input.reason || null,
    scorecard: sc,
    interaction: {
      checks,
      fail: interactionFail,
      unverified: interactionUnverified,
      status: !checks.length ? 'UNVERIFIED' : interactionFail ? 'FAIL' : interactionUnverified ? 'UNVERIFIED' : 'PASS',
    },
    evidence: input.evidence || [],
    limitations: input.limitations || [],
  };
}

function statusRollup(statuses) {
  const list = statuses.filter(Boolean);
  if (!list.length) return 'UNVERIFIED';
  if (list.includes('FAIL')) return 'FAIL';
  if (list.includes('BLOCKED')) return 'BLOCKED';
  if (!list.every(s => s === 'PASS' || s === 'NOT_APPLICABLE')) return 'UNVERIFIED';
  return 'PASS';
}

module.exports = {
  SCHEMA_VERSION, STATUSES,
  buildCaptureManifest, buildVisualDiffReport, buildValidationReport, statusRollup,
};

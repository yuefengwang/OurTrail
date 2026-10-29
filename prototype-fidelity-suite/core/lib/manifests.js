'use strict';
/**
 * Builders for the *declared* side of the contracts: what the project says the
 * prototype is (prototype-manifest), which states exist and how each was
 * reached (page-state-manifest), how the two platforms map to each other
 * (platform-mappings) and what an interaction check is supposed to prove
 * (interaction-contract).
 *
 * These artifacts describe declarations, not conclusions. A declared state or
 * pair that has no capture is UNVERIFIED — the same rule the scorecard applies
 * to measurements, so a plan cannot read as evidence.
 */
const { isoNow } = require('./util');
const { resolveNode } = require('./geometry');

const SCHEMA_VERSION = '1.0.0';

function screenshotOf(manifest) {
  const shot = manifest && manifest.screenshot;
  if (!shot || !shot.sha256) return null;
  return {
    path: shot.path,
    sha256: shot.sha256,
    width: shot.width == null ? null : shot.width,
    height: shot.height == null ? null : shot.height,
    scale: shot.scale || null,
  };
}

function buildPrototypeManifest(input) {
  const protoCfg = input.prototype || {};
  const states = (input.states || []).map(state => {
    const m = (input.captures || {})[state.id] || null;
    const shot = screenshotOf(m);
    return {
      id: state.id,
      captured: !!m,
      dataSource: m ? m.source.dataSource : null,
      capturedAt: m ? m.capturedAt : null,
      codeVersion: m ? m.source.codeVersion : null,
      viewport: m ? m.viewport : null,
      dpr: m ? m.dpr == null ? null : m.dpr : null,
      nodes: m ? m.snapshot.nodes : 0,
      screenshot: shot,
      status: shot ? 'PASS' : 'UNVERIFIED',
    };
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'prototype-manifest',
    projectId: input.projectId || null,
    pageId: input.pageId,
    generatedAt: isoNow(),
    prototype: {
      platform: input.platform || 'web',
      source: 'html',
      entry: protoCfg.url || null,
      viewport: protoCfg.viewport || null,
      frameSelector: protoCfg.frameSelector || null,
      readOnly: true,
    },
    states,
    mappings: {
      declared: (input.mappings || []).length,
      selectors: input.selectors || [],
      source: 'pf.config.json#pages[].mappings',
    },
    provenance: { builtBy: 'pf contract', config: 'pf.config.json', side: 'prototype' },
  };
}

function sideSummary(m, side) {
  if (!m) {
    return {
      side, platform: null, captured: false, status: 'UNVERIFIED',
      dataSource: null, viewport: null, dpr: null, codeVersion: null,
      capturedAt: null, screenshot: null, nodes: 0,
    };
  }
  const shot = screenshotOf(m);
  return {
    side,
    platform: m.platform,
    captured: true,
    dataSource: m.source.dataSource,
    viewport: m.viewport,
    dpr: m.dpr == null ? null : m.dpr,
    codeVersion: m.source.codeVersion,
    capturedAt: m.capturedAt,
    nodes: m.snapshot.nodes,
    screenshot: shot,
    status: shot ? 'PASS' : 'UNVERIFIED',
  };
}

function buildPageStateManifest(input) {
  const states = (input.states || []).map(state => {
    const caps = (input.captures || {})[state.id] || {};
    const prototype = sideSummary(caps.prototype, 'prototype');
    const target = sideSummary(caps.target, 'target');
    const sides = { prototype, target };
    const declaredInjection = !!state.injectData;
    const injected = declaredInjection || [prototype, target].some(s => s.dataSource === 'injected');
    return {
      id: state.id,
      note: state.note || null,
      injection: declaredInjection
        ? { declared: true, dataSource: 'injected', keys: Object.keys(state.injectData) }
        : { declared: false, dataSource: 'real', keys: [] },
      sides,
      usableAsInteractionEvidence: !injected,
      status: prototype.status === 'PASS' && target.status === 'PASS' ? 'PASS' : 'UNVERIFIED',
    };
  });
  const counted = (pred) => states.filter(pred).length;
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'page-state-manifest',
    pageId: input.pageId,
    generatedAt: isoNow(),
    states,
    coverage: {
      declared: states.length,
      captured: counted(s => s.status === 'PASS'),
      injected: counted(s => s.injection.declared),
    },
    provenance: { builtBy: 'pf contract', config: 'pf.config.json' },
  };
}

function buildPlatformMappings(input) {
  const page = input.page || {};
  const pSnap = input.captures && input.captures.prototype ? input.captures.prototype.snapshot : null;
  const tSnap = input.captures && input.captures.target ? input.captures.target.snapshot : null;
  const pairs = (page.mappings || []).map((m, i) => {
    const id = m.id || 'pair-' + i;
    const prototypeSelector = m.prototypeSelector || null;
    const targetSelector = m.targetSelector || null;
    const pNode = pSnap ? resolveNode(pSnap, prototypeSelector, m.prototypePath) : null;
    const tNode = tSnap ? resolveNode(tSnap, targetSelector, m.targetPath) : null;
    const missing = [];
    if (pSnap && !pNode) missing.push('prototype');
    if (tSnap && !tNode) missing.push('target');
    let status = 'PASS';
    if (!pSnap || !tSnap) status = 'UNVERIFIED';
    else if (missing.length) status = m.optional ? 'NOT_APPLICABLE' : 'UNVERIFIED';
    return {
      id,
      role: m.role || id,
      criticality: m.criticality || 'normal',
      optional: !!m.optional,
      prototypeSelector,
      targetSelector,
      prototypePath: m.prototypePath || null,
      targetPath: m.targetPath || null,
      styleProps: m.styleProps || null,
      pixel: m.pixel !== false,
      pixelMode: m.pixelMode === 'informational' ? 'informational' : 'exact',
      note: m.note || null,
      resolved: { prototype: !!pNode, target: !!tNode },
      missing,
      status,
    };
  });
  const accepted = [];
  for (const a of page.acceptedDifferences || []) accepted.push({ ...a, scope: 'page' });
  for (const a of (input.state && input.state.acceptedDifferences) || []) accepted.push({ ...a, scope: 'state' });
  const counted = (pred) => pairs.filter(pred).length;
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'platform-mappings',
    pageId: page.id,
    stateId: input.state ? input.state.id : null,
    generatedAt: isoNow(),
    platforms: input.platforms || { prototype: 'web', target: null },
    adapters: input.adapters || { prototype: null, target: null },
    alignment: page.alignment || null,
    pairs,
    acceptedDifferences: accepted.map(a => ({
      pairId: a.pairId,
      categories: a.categories || [],
      reason: a.reason || null,
      scope: a.scope,
    })),
    coverage: {
      declared: pairs.length,
      resolved: counted(p => p.status === 'PASS'),
      unverified: counted(p => p.status === 'UNVERIFIED'),
      notApplicable: counted(p => p.status === 'NOT_APPLICABLE'),
      critical: counted(p => p.criticality === 'critical'),
    },
    provenance: { builtBy: 'pf contract', config: 'pf.config.json#pages[].mappings' },
  };
}

function buildInteractionContract(input) {
  const observations = input.observation || null;
  const byId = new Map(((observations && observations.checks) || []).map(c => [c.id, c]));
  const checks = (input.checks || []).map(c => {
    const obs = byId.get(c.id) || null;
    return {
      id: c.id,
      title: c.title || '',
      steps: c.do || [],
      expect: c.expect || {},
      screenshot: !!c.screenshot,
      status: obs ? obs.status : 'UNVERIFIED',
      observed: obs ? obs.observed || null : null,
      assertions: obs && obs.assertions ? obs.assertions : [],
      screenshotPath: obs && obs.screenshotPath ? obs.screenshotPath : null,
      error: obs && obs.error ? obs.error : null,
      verification: obs ? obs.verification || null : null,
    };
  });
  let status = 'UNVERIFIED';
  let reason = { code: 'NOT_RUN', message: 'interaction checks are declared but no run has recorded them' };
  if (observations) {
    status = observations.status || 'UNVERIFIED';
    reason = observations.reason ? { code: 'DRIVER_UNAVAILABLE', message: observations.reason } : null;
    if (status === 'UNVERIFIED' && !reason) reason = { code: 'NO_OBSERVATION', message: 'a run finished without a verdict' };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'interaction-contract',
    pageId: input.pageId,
    generatedAt: isoNow(),
    driver: input.driver || null,
    checks,
    status,
    reason,
    provenance: { builtBy: observations ? 'pf validate' : 'pf contract', config: 'pf.config.json#pages[].interactions' },
  };
}

module.exports = {
  SCHEMA_VERSION,
  buildPrototypeManifest,
  buildPageStateManifest,
  buildPlatformMappings,
  buildInteractionContract,
};

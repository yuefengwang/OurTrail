'use strict';
/**
 * Gate for the versioned data contracts.
 *
 * Two things are being pinned here, and only the second one is the interesting
 * part:
 *   1. every builder emits an artifact its own schema accepts (a schema nothing
 *      produces is a paper contract);
 *   2. the schema actually bites — a tampered status, a dropped required id or a
 *      bumped schemaVersion must be rejected. A gate that passes on any input
 *      proves nothing.
 *
 * The pilot artifacts on disk are validated too when present. They are skipped
 * (not passed) when the pilot has not been captured on this machine, because a
 * missing capture is UNVERIFIED, never green.
 */
const fs = require('fs');
const path = require('path');
const { check, eq, section, finish } = require('./harness');
const schema = require('../core/lib/schema');
const manifests = require('../core/lib/manifests');
const interaction = require('../core/lib/interaction');

const ROOT = path.join(__dirname, '..');
const SCHEMA_DIR = path.join(ROOT, 'schemas');
const ADAPTER_DIR = path.join(ROOT, 'adapters');
const PROJECT = path.join(ROOT, 'examples', 'ourtrail');

const STATUSES = ['PASS', 'FAIL', 'UNVERIFIED', 'BLOCKED', 'NOT_APPLICABLE'];
const CONTRACTS = [
  'project-config',
  'prototype-manifest',
  'page-state-manifest',
  'design-tokens',
  'component-contracts',
  'platform-mappings',
  'capture-manifest',
  'visual-diff-report',
  'interaction-contract',
  'fidelity-validation-report',
  'page-layout',
];
// Not page/state contracts, but the same versioned-and-gated treatment.
const SUPPORT_SCHEMAS = ['adapter', 'design-dna', 'design-dna-kb', 'design-plan', 'design-review-report', 'repair-report'];

function loadSchema(name) {
  return JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, name + '.schema.json'), 'utf8'));
}

const cache = new Map();
function schemaFor(name) {
  if (!cache.has(name)) cache.set(name, loadSchema(name));
  return cache.get(name);
}

function errorsFor(name, value) {
  return schema.validate(schemaFor(name), value).errors;
}

function valid(name, value) {
  const errs = errorsFor(name, value);
  return check(
    `${name}: artifact validates`,
    errs.length === 0,
    errs.slice(0, 4).map(e => `${e.path}: ${e.message}`).join(' | '),
  );
}

function invalid(name, value, why) {
  const errs = errorsFor(name, value);
  return check(`rejects ${why}`, errs.length > 0, 'schema accepted a value it must reject');
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function readIfJson(rel) {
  const file = path.join(PROJECT, rel);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ------------------------------------------------------------ schema files

section('schema inventory');
{
  const files = fs.readdirSync(SCHEMA_DIR).filter(f => f.endsWith('.schema.json')).sort();
  eq('one schema file per declared contract (plus page-layout, adapter, design-dna, its store, the design plan, its review report and the repair report)',
    files.length, CONTRACTS.length + SUPPORT_SCHEMAS.length);
  for (const name of [...CONTRACTS, ...SUPPORT_SCHEMAS]) {
    check(`${name}.schema.json exists`, files.includes(name + '.schema.json'));
  }
  for (const name of [...CONTRACTS, ...SUPPORT_SCHEMAS]) {
    const s = schemaFor(name);
    check(`${name} pins schemaVersion as a semver string`, !!(s.properties.schemaVersion
      && s.properties.schemaVersion.$ref === '#/definitions/schemaVersion'));
  }
}

// ------------------------------------------------------------ adapter descriptors

section('adapter descriptors describe the instrument');
{
  const dirs = fs.readdirSync(ADAPTER_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory()).map(d => d.name).sort();
  eq('bundled adapters', dirs, ['web', 'wechat-miniprogram']);
  const driverIds = interaction.drivers();

  for (const dir of dirs) {
    const base = path.join(ADAPTER_DIR, dir);
    const jsonFile = path.join(base, 'adapter.json');
    const mdFile = path.join(base, 'LIMITATIONS.md');
    const capFile = path.join(base, 'capture.js');
    check(`${dir}: adapter.json exists`, fs.existsSync(jsonFile));
    check(`${dir}: capture.js exists`, fs.existsSync(capFile));
    check(`${dir}: LIMITATIONS.md exists`, fs.existsSync(mdFile));
    if (!fs.existsSync(jsonFile) || !fs.existsSync(capFile) || !fs.existsSync(mdFile)) continue;

    const desc = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    valid('adapter', desc);
    const mod = require(capFile);
    eq(`${dir}: descriptor id matches its directory`, desc.id, dir);
    eq(`${dir}: captureModule is the module that loads`, desc.captureModule, path.basename(capFile));
    eq(`${dir}: module export id matches descriptor`, mod.id, desc.id);
    check(`${dir}: interaction driver "${desc.interactionDriver}" is implemented`, driverIds.includes(desc.interactionDriver), { driverIds });
    check(`${dir}: exports STYLE_PROPS`, Array.isArray(mod.STYLE_PROPS) && mod.STYLE_PROPS.length >= 10);
    check(`${dir}: STYLE_PROPS are kebab-case CSS names`, (mod.STYLE_PROPS || []).every(p => /^[a-z][a-z0-9-]*$/.test(p)));
    check(`${dir}: endpoint names the config key it reads`, typeof desc.endpoint.configKey === 'string' && desc.endpoint.configKey.length > 0);
    if (desc.endpoint.kind === 'websocket') {
      check(`${dir}: websocket endpoint default is a ws:// URL`, /^ws:\/\//.test(desc.endpoint.default || ''), desc.endpoint.default);
    }

    // The doc and the machine-readable list must be the same set: a limitation
    // nobody wrote down is not declared, and a documented one that is not listed
    // never reaches a consumer.
    const headings = [...fs.readFileSync(mdFile, 'utf8').matchAll(/^### ([A-Z]{2,4}-\d{2})\b/gm)].map(m => m[1]);
    eq(`${dir}: declared limitations == documented sections`, desc.limitations.slice().sort(), headings.sort());

    const tamper = patch => Object.assign(JSON.parse(JSON.stringify(desc)), patch);
    invalid('adapter', tamper({ id: 'Web Adapter' }), `${dir}: an id that is not a slug`);
    const badCap = JSON.parse(JSON.stringify(desc));
    badCap.capabilities.lineCount = 'guessed';
    invalid('adapter', badCap, `${dir}: a capability outside the closed vocabulary`);
    invalid('adapter', tamper({ limitations: [] }), `${dir}: an adapter claiming no limitations`);
    invalid('adapter', tamper({ limitations: ['not-an-id'] }), `${dir}: a malformed limitation id`);
    const noRuntime = JSON.parse(JSON.stringify(desc));
    delete noRuntime.runtime;
    invalid('adapter', noRuntime, `${dir}: a descriptor with no runtime`);
    const extraKey = JSON.parse(JSON.stringify(desc));
    extraKey.supportsMagic = true;
    invalid('adapter', extraKey, `${dir}: an undeclared descriptor field`);
  }
}

const SHOT = {
  path: 'screenshot.png',
  sha256: 'a'.repeat(64),
  width: 390,
  height: 844,
  scale: { x: 1, y: 1 },
  normalizedFrom: 'css-pixels',
};

function capture(over) {
  return Object.assign({
    schemaVersion: '1.0.0',
    kind: 'capture-manifest',
    pageId: 'fixture-page',
    stateId: 'default',
    side: 'prototype',
    platform: 'web',
    capturedAt: '2026-10-28T00:00:00.000Z',
    source: { url: 'file:///tmp/p.html', projectRoot: null, route: null, codeVersion: 'deadbeef', dataSource: 'real', injection: null, note: null },
    viewport: { width: 390, height: 844 },
    dpr: 1,
    screenshot: SHOT,
    snapshot: { nodes: 12, rootId: 'n0', dimensions: { width: 390, height: 844 } },
    provenance: { capturedBy: 'prototype-fidelity-suite', adapter: 'web', verification: 'captured' },
  }, over || {});
}

const NODE = {
  id: 'n3',
  sel: '.card',
  selectors: ['.card'],
  path: 'body > .card',
  rect: { x: 8, y: 8, w: 100, h: 40 },
  styles: { padding: '8px', 'font-size': '14px' },
  text: 'hello',
  lineCount: 1,
  visible: true,
};

const SNAPSHOT = {
  nodes: [
    Object.assign({ parentId: null, children: [], tag: 'div' }, NODE),
    Object.assign({ parentId: 'n3', children: [], tag: 'div' }, NODE, { id: 'n4', sel: '.ghost', selectors: ['.ghost'], path: 'body > .card > .ghost' }),
  ],
  rootSelector: '.card',
  rootId: 'n3',
  documentSize: { width: 390, height: 844 },
  viewport: { width: 390, height: 844 },
  scroll: { x: 0, y: 0 },
};
const SNAPSHOT_TARGET = {
  nodes: [Object.assign({ parentId: null, children: [], tag: 'view' }, NODE)],
  rootSelector: '.card',
  rootId: 'n3',
  documentSize: { width: 390, height: 844 },
  viewport: { width: 390, height: 844 },
  scroll: { x: 0, y: 0 },
};
const PAGE = {
  id: 'fixture-page',
  mappings: [
    { id: 'card', role: 'card', criticality: 'critical', prototypeSelector: '.card', targetSelector: '.card' },
    { id: 'ghost', role: 'only in prototype', prototypeSelector: '.ghost', optional: true },
  ],
  acceptedDifferences: [{ pairId: 'ghost', categories: ['size'], reason: 'fixture' }],
};

const protoCapture = capture();
const targetCapture = capture({ side: 'target', platform: 'wechat-miniprogram', source: { url: null, projectRoot: 'miniprogram', route: '/pages/x/x', codeVersion: 'cafe', dataSource: 'real', injection: null, note: null } });

const protoManifest = manifests.buildPrototypeManifest({
  projectId: 'fixture',
  pageId: PAGE.id,
  page: PAGE,
  states: [{ id: 'default' }, { id: 'injected' }],
  captures: { default: protoCapture, injected: null },
  prototype: { platform: 'web', source: 'html', entry: 'p.html', viewport: { width: 390, height: 844 }, frameSelector: '#device', readOnly: true },
  mappings: PAGE.mappings,
  selectors: ['.card', '.ghost'],
});

const stateManifest = manifests.buildPageStateManifest({
  pageId: PAGE.id,
  states: [{ id: 'default' }, { id: 'injected', injectData: { plan: 1 } }],
  captures: { default: { prototype: protoCapture, target: targetCapture }, injected: {} },
});

const platformMappings = manifests.buildPlatformMappings({
  page: PAGE,
  state: { id: 'default', acceptedDifferences: [{ pairId: 'card', categories: ['position'], reason: 'shell' }] },
  platforms: { prototype: 'web', target: 'wechat-miniprogram' },
  adapters: { prototype: 'web', target: 'wechat-miniprogram' },
  captures: { prototype: { snapshot: SNAPSHOT }, target: { snapshot: SNAPSHOT_TARGET } },
});

const interactionDeclared = manifests.buildInteractionContract({
  pageId: PAGE.id,
  checks: [{ id: 'tab-1', title: 'switch tab', do: [{ tap: '.tab' }], expect: { exists: '.pane' } }],
  driver: { adapter: 'web', endpoint: null, verification: 'real-action-and-observation' },
});

const interactionRun = manifests.buildInteractionContract({
  pageId: PAGE.id,
  checks: [{ id: 'tab-1', title: 'switch tab', do: [{ tap: '.tab' }], expect: { exists: '.pane' } }],
  observation: {
    status: 'PASS',
    checks: [{ id: 'tab-1', status: 'PASS', observed: 'ok exists .pane', assertions: [{ assertion: 'exists .pane', pass: true, observed: true }], verification: 'real-action-and-observation' }],
  },
});

section('builders emit schema-valid artifacts');
{
  valid('project-config', JSON.parse(fs.readFileSync(path.join(PROJECT, 'pf.config.json'), 'utf8')));
  // The generic-web example is the only config that uses named viewports and
  // `dynamicText`; validating it keeps the schema from describing a config
  // nobody writes (it had drifted by both fields before this line existed).
  valid('project-config', JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'generic-web', 'pf.config.json'), 'utf8')));
  valid('prototype-manifest', protoManifest);
  valid('page-state-manifest', stateManifest);
  valid('platform-mappings', platformMappings);
  valid('interaction-contract', interactionDeclared);
  valid('interaction-contract', interactionRun);
  valid('capture-manifest', protoCapture);
  valid('capture-manifest', targetCapture);
}

section('declarations never read as evidence');
{
  eq('uncaptured state is UNVERIFIED', protoManifest.states.find(s => s.id === 'injected').status, 'UNVERIFIED');
  eq('captured state is PASS', protoManifest.states.find(s => s.id === 'default').status, 'PASS');
  eq('prototype is read-only', protoManifest.prototype.readOnly, true);
  const injected = stateManifest.states.find(s => s.id === 'injected');
  eq('declared injection is recorded', injected.injection.declared, true);
  eq('injected state is not interaction evidence', injected.usableAsInteractionEvidence, false);
  eq('injected state without capture is UNVERIFIED', injected.status, 'UNVERIFIED');
  const real = stateManifest.states.find(s => s.id === 'default');
  eq('real captured pair is usable evidence', real.usableAsInteractionEvidence, true);
  eq('real captured pair is PASS', real.status, 'PASS');
  check('coverage adds up', stateManifest.coverage.captured + (stateManifest.coverage.declared - stateManifest.coverage.captured) === stateManifest.coverage.declared, stateManifest.coverage);
  eq('declared-but-unrun interaction is UNVERIFIED', interactionDeclared.status, 'UNVERIFIED');
  eq('with a NOT_RUN reason', interactionDeclared.reason.code, 'NOT_RUN');
  eq('unrun checks stay UNVERIFIED', interactionDeclared.checks[0].status, 'UNVERIFIED');
  eq('a recorded run is PASS', interactionRun.status, 'PASS');
  eq('a recorded run carries its assertions', interactionRun.checks[0].assertions.length, 1);
}

section('mapping status follows resolution, not optimism');
{
  const byId = new Map(platformMappings.pairs.map(p => [p.id, p]));
  eq('resolved pair is PASS', byId.get('card').status, 'PASS');
  eq('optional missing pair is NOT_APPLICABLE', byId.get('ghost').status, 'NOT_APPLICABLE');
  eq('its missing side is named', byId.get('ghost').missing, ['target']);
  eq('coverage counts resolved', platformMappings.coverage.resolved, 1);
  eq('coverage counts notApplicable', platformMappings.coverage.notApplicable, 1);
  eq('coverage counts critical', platformMappings.coverage.critical, 1);
  eq('page- and state-scope differences both survive', platformMappings.acceptedDifferences.map(a => a.pairId + ':' + a.scope), ['ghost:page', 'card:state']);
  const unresolvable = manifests.buildPlatformMappings({
    page: PAGE,
    state: { id: 'default' },
    platforms: { prototype: 'web', target: null },
    adapters: { prototype: 'web', target: null },
    captures: { prototype: { snapshot: SNAPSHOT }, target: null },
  });
  eq('a side that was never captured is UNVERIFIED', unresolvable.pairs[0].status, 'UNVERIFIED');
  const required = manifests.buildPlatformMappings({
    page: { id: 'p', mappings: [{ id: 'req', prototypeSelector: '.ghost' }] },
    state: { id: 's' },
    platforms: { prototype: 'web', target: 'web' },
    adapters: { prototype: 'web', target: 'web' },
    captures: { prototype: { snapshot: SNAPSHOT }, target: { snapshot: SNAPSHOT_TARGET } },
  });
  eq('a required missing selector is UNVERIFIED, not NOT_APPLICABLE', required.pairs[0].status, 'UNVERIFIED');
}

// ------------------------------------------------------------ gate teeth

section('the schema rejects what it must');
{
  const bad = clone(protoManifest);
  bad.states[0].status = 'PASSED';
  invalid('prototype-manifest', bad, 'an off-vocabulary status');

  const noPage = clone(protoManifest);
  delete noPage.pageId;
  invalid('prototype-manifest', noPage, 'a missing pageId');

  const badVersion = clone(protoManifest);
  badVersion.schemaVersion = '1.0';
  invalid('prototype-manifest', badVersion, 'a non-semver schemaVersion');

  const writable = clone(protoManifest);
  writable.prototype.readOnly = false;
  invalid('prototype-manifest', writable, 'a writable prototype (the inspector must stay read-only)');

  const extra = clone(protoManifest);
  extra.surprise = 1;
  invalid('prototype-manifest', extra, 'an undeclared top-level key');

  const evidence = clone(stateManifest);
  evidence.states[0].usableAsInteractionEvidence = 'yes';
  invalid('page-state-manifest', evidence, 'a non-boolean evidence flag');

  const noCoverage = clone(stateManifest);
  delete noCoverage.coverage;
  invalid('page-state-manifest', noCoverage, 'a missing coverage block');

  const mapped = clone(platformMappings);
  mapped.pairs[0].status = 'MATCHED';
  invalid('platform-mappings', mapped, 'an off-vocabulary pair status');

  const noScope = clone(platformMappings);
  delete noScope.acceptedDifferences[0].scope;
  invalid('platform-mappings', noScope, 'an accepted difference with no scope');

  const inter = clone(interactionRun);
  inter.reason = { code: 'WHATEVER', message: 'x' };
  invalid('interaction-contract', inter, 'an unknown reason code');

  const noChecks = clone(interactionRun);
  delete noChecks.checks;
  invalid('interaction-contract', noChecks, 'an interaction contract with no checks array');
}

section('status vocabulary is shared, not per-file folklore');
{
  for (const name of ['prototype-manifest', 'page-state-manifest', 'platform-mappings', 'visual-diff-report', 'fidelity-validation-report']) {
    const s = schemaFor(name);
    const def = s.definitions && s.definitions.status;
    check(`${name} declares the five-value status enum`, !!def && JSON.stringify(def.enum) === JSON.stringify(STATUSES), def);
  }
}

// ------------------------------------------------------------ on-disk pilot

section('pilot artifacts on disk (skipped when this machine has no capture)');
{
  const contractDir = path.join(PROJECT, 'contracts', 'weather-hub-home');
  const runDir = path.join(PROJECT, 'reports', 'weather-hub-home-real-2026-10-28T12-57-30');
  const targets = [
    ['prototype-manifest', path.join(contractDir, 'prototype-manifest.json')],
    ['page-state-manifest', path.join(contractDir, 'page-state-manifest.json')],
    ['platform-mappings', path.join(contractDir, 'platform-mappings.json')],
    ['interaction-contract', path.join(contractDir, 'interaction-contract.json')],
    ['design-tokens', path.join(contractDir, 'design-tokens.json')],
    ['component-contracts', path.join(contractDir, 'component-contracts.json')],
    ['page-layout', path.join(contractDir, 'page-layout.json')],
    ['capture-manifest', path.join(PROJECT, 'captures', 'weather-hub-home', 'real', 'prototype', 'capture-manifest.json')],
    ['capture-manifest', path.join(PROJECT, 'captures', 'weather-hub-home', 'real', 'target', 'capture-manifest.json')],
    ['visual-diff-report', path.join(runDir, 'visual-diff-report.json')],
    ['fidelity-validation-report', path.join(runDir, 'fidelity-validation-report.json')],
  ];
  let present = 0;
  for (const [name, file] of targets) {
    if (!fs.existsSync(file)) {
      console.log(`  … ${name}: no artifact at ${path.relative(ROOT, file)} (UNVERIFIED on this machine)`);
      continue;
    }
    present++;
    valid(name, JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  check('at least the contract set is present when the pilot has been captured', present === 0 || present === targets.length,
    { present, total: targets.length });
}

// ------------------------------------------------------------ cross-contract agreement

section('cross-contract agreement');
{
  const pm = readIfJson('contracts/weather-hub-home/platform-mappings.json');
  const dm = readIfJson('contracts/weather-hub-home/design-tokens.json');
  const diff = readIfJson('reports/weather-hub-home-real-2026-10-28T12-57-30/visual-diff-report.json');
  if (pm && diff) {
    eq('every diff region has a mapping pair', diff.regions.every(r => pm.pairs.some(p => p.id === r.id)), true);
    eq('mapping count equals declared pair count', pm.pairs.length, pm.coverage.declared);
    eq('coverage partitions the pairs', pm.coverage.resolved + pm.coverage.unverified + pm.coverage.notApplicable, pm.coverage.declared);
  } else {
    console.log('  … no pilot diff/mapping pair on this machine (UNVERIFIED)');
  }
  if (dm) {
    const drift = dm.drift || {};
    eq('token drift names both sides', Object.keys(drift).every(g => Array.isArray(drift[g].shared) && Array.isArray(drift[g].onlyPrototype) && Array.isArray(drift[g].onlyTarget)), true);
  }
}

process.exit(finish('contracts'));

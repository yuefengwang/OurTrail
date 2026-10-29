#!/usr/bin/env node
'use strict';
/**
 * pf — prototype fidelity CLI.
 *
 * Exit codes: 0 = PASS, 1 = FAIL (real differences), 2 = environment/config
 * error or UNVERIFIED run. A run that could not measure anything is never 0.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const util = require('../core/lib/util');
const geometry = require('../core/lib/geometry');
const contract = require('../core/lib/contract');
const regions = require('../core/lib/regions');
const diffLib = require('../core/lib/diff');
const score = require('../core/lib/score');
const png = require('../core/lib/png');
const report = require('../core/lib/report');
const schemaLib = require('../core/lib/schema');
const artifacts = require('../core/lib/artifacts');
const manifests = require('../core/lib/manifests');
const envLib = require('../core/lib/env');
const interactions = require('../core/lib/interaction');
const stateChecks = require('../core/lib/state-checks');
const bundleLib = require('../core/lib/bundle');
const cascade = require('../core/lib/cascade');
const repair = require('../core/lib/repair');
const acceptanceLib = require('../core/lib/acceptance');

const { ensureDir, readJson, writeJson, exists, isoNow, slug, round, PfError, relPosix } = util;

const DEFAULT_TOLERANCES = {
  position: 1.5,
  size: 1.5,
  gap: 1.0,
  font: 1.0,
  color: 6,
  pixelRatio: 0.02,
  criticalPixelRatio: 0.005,
};

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith('--')) { out[key] = next; i++; } else out[key] = true;
  }
  return out;
}

function loadConfig(projectDir) {
  const file = path.resolve(projectDir, 'pf.config.json');
  if (!exists(file)) throw new PfError('CONFIG_MISSING', `no pf.config.json in ${projectDir}`);
  const cfg = readJson(file);
  cfg.__dir = path.dirname(file);
  return cfg;
}

function resolveIn(base, p) {
  return path.isAbsolute(p) ? p : path.resolve(base, p);
}

/**
 * `--run` takes either a run id (as printed by `pf diff`) or a path. A bare id
 * that is not a path under the project is looked up in reports/ — otherwise the
 * documented id from the console hands back DIFF_MISSING for a run that exists.
 */
function resolveRun(cfg, run) {
  const direct = resolveIn(cfg.__dir, run);
  if (exists(path.join(direct, 'visual-diff-report.json'))) return direct;
  const inReports = path.join(cfg.__dir, 'reports', run);
  if (exists(inReports)) return inReports;
  return direct;
}

function findPage(cfg, pageId) {
  const pages = cfg.pages || [];
  const page = pageId ? pages.find(p => p.id === pageId) : pages[0];
  if (!page) throw new PfError('PAGE_UNKNOWN', `page "${pageId}" not in config (have: ${pages.map(p => p.id).join(', ')})`);
  return page;
}

function tolerancesOf(cfg, page) {
  return { ...DEFAULT_TOLERANCES, ...(cfg.tolerances || {}), ...(page.tolerances || {}) };
}

/**
 * A named viewport gets its own capture directory rather than overwriting the
 * default one: two widths are two measurements, not one measurement twice.
 */
function captureDir(cfg, pageId, stateId, side, viewportId) {
  const base = path.join(cfg.__dir, 'captures', slug(pageId), slug(stateId));
  return viewportId ? path.join(base, '@' + slug(viewportId), side) : path.join(base, side);
}

/** Same layout as captureDir, as a project-relative path for reports. */
function captureRel(pageId, stateId, side, viewportId) {
  return ['captures', slug(pageId), slug(stateId), ...(viewportId ? ['@' + slug(viewportId)] : []), side].join('/');
}

function viewportList(cfg, page) {
  const raw = (page && page.viewports) || cfg.viewports || [];
  return raw.map((v, i) => ({ ...v, id: v.id || 'vp' + (i + 1) }));
}

function pickViewport(cfg, page, id) {
  if (!id || id === 'default' || id === true) return null;
  const list = viewportList(cfg, page);
  const v = list.find(x => x.id === id);
  if (!v) {
    throw new PfError('VIEWPORT_UNKNOWN', `viewport "${id}" not declared (have: ${list.map(x => x.id).join(', ') || 'none'})`);
  }
  return v;
}

/** The viewport a call is working on, carried on the state object it already threads. */
function vpOf(state) {
  return (state && state.__viewport) || null;
}

function withViewport(state, viewportId) {
  if (!viewportId) return state;
  return Object.assign({}, state, { __viewport: viewportId });
}

/**
 * `--viewport <id>|all` → the list of measurements to run. `all` means every
 * declared viewport, never "the default plus the declared ones": a capture that
 * was taken without a viewport is a third measurement the caller did not ask for.
 */
function viewportsFor(cfg, page, arg) {
  if (!arg || arg === true || arg === 'default') return [null];
  if (arg === 'all') {
    const list = viewportList(cfg, page);
    if (!list.length) {
      throw new PfError('VIEWPORT_UNKNOWN', 'no viewports declared; add page.viewports or config.viewports');
    }
    return list.map(v => v.id);
  }
  pickViewport(cfg, page, arg);
  return [String(arg)];
}

/** FAIL beats UNVERIFIED beats PASS: one failing measurement must not be hidden behind a passing one. */
function worstExit(codes) {
  if (codes.some(c => c === 1)) return 1;
  if (codes.some(c => c !== 0)) return 2;
  return 0;
}

function vpLabel(viewportId) {
  return viewportId ? `@${viewportId}` : '';
}

// ---------------------------------------------------------------- capture

function loadAdapterDescriptor(dir, adapterId, captureFile, required) {
  const file = path.join(dir, 'adapter.json');
  if (!exists(file)) {
    if (!required) return null;
    throw new PfError('ADAPTER_DESCRIPTOR_MISSING',
      `${file} is missing; a bundled adapter must describe what it can measure (schemas/adapter.schema.json)`);
  }
  const desc = readJson(file);
  const schema = readJson(path.join(__dirname, '..', 'schemas', 'adapter.schema.json'));
  const res = schemaLib.validate(schema, desc);
  if (!res.valid) throw new PfError('ADAPTER_DESCRIPTOR_INVALID', `adapter.json under ${dir}:\n${schemaLib.formatErrors(res.errors)}`);
  if (desc.id !== adapterId) throw new PfError('ADAPTER_DESCRIPTOR_MISMATCH', `adapter.json id "${desc.id}" != configured adapter "${adapterId}"`);
  if (path.basename(captureFile) !== desc.captureModule) {
    throw new PfError('ADAPTER_DESCRIPTOR_MISMATCH', `adapter.json captureModule "${desc.captureModule}" != ${path.basename(captureFile)}`);
  }
  return desc;
}

function adapterFor(cfg, side) {
  const sideCfg = cfg[side] || {};
  const id = sideCfg.adapter;
  if (!id) throw new PfError('ADAPTER_MISSING', `config.${side}.adapter is required`);
  const bundled = path.join(__dirname, '..', 'adapters', id, 'capture.js');
  const external = sideCfg.module ? resolveIn(cfg.__dir, sideCfg.module) : null;
  const file = [bundled, external].filter(Boolean).find(exists);
  if (!file) throw new PfError('ADAPTER_UNKNOWN', `adapter "${id}" not found at ${[bundled, external].filter(Boolean).join(' | ')}`);
  const descriptor = loadAdapterDescriptor(path.dirname(file), id, file, file === bundled);
  const mod = require(file);
  if (mod.id !== id) throw new PfError('ADAPTER_ID_MISMATCH', `adapter module exports id "${mod.id}" but config says "${id}"`);
  return descriptor ? Object.assign({}, mod, { descriptor }) : mod;
}

async function doCapture(cfg, page, state, side, opts) {
  const adapter = adapterFor(cfg, side);
  const sideCfg = { ...(cfg[side] || {}), ...(page[side] || {}), ...(state[side] || {}) };
  const viewportId = vpOf(state);
  const namedVp = viewportId ? pickViewport(cfg, page, viewportId) : null;
  const outDir = captureDir(cfg, page.id, state.id, side, viewportId);
  ensureDir(outDir);

  const probeSelectors = [...new Set([
    ...(page.mappings || []).map(m => (side === 'prototype' ? m.prototypeSelector : m.targetSelector)).filter(Boolean),
    ...(side === 'prototype' ? (page.selectors || []) : (page.targetSelectors || [])),
  ])];

  const common = {
    outDir,
    // A declared readiness selector used to be dropped here: it was in the
    // schema and in the pilot config, and it never reached the adapter, so a
    // page that renders late was captured half-blank and "passed". Forward it.
    waitForSelector: sideCfg.waitForSelector,
    waitMs: opts.waitMs != null ? Number(opts.waitMs) : sideCfg.waitMs,
    settleMs: sideCfg.settleMs,
    inject: side === 'prototype' ? sideCfg.inject : undefined,
    injectData: side === 'target' ? (state.injectData || opts.injectData) : undefined,
    // A side may declare its own viewport (e.g. a target canvas that is 100 px
    // taller); the comparison still runs on measured rects, so a different
    // *width* is not normalised away — it fails geometry, as it should.
    // A named viewport (--viewport) overrides both, on purpose: that is the
    // whole point of capturing the same page at 375 and 414.
    viewport: namedVp
      ? { width: namedVp.width, height: namedVp.height }
      : (sideCfg.viewport || (cfg.prototype && cfg.prototype.viewport) || { width: 390, height: 844 }),
    dpr: sideCfg.dpr != null ? sideCfg.dpr : (namedVp && namedVp.dpr != null ? namedVp.dpr : undefined),
    device: sideCfg.device || (namedVp && namedVp.device) || undefined,
    frameSelector: sideCfg.frameSelector || (cfg[side] && cfg[side].frameSelector),
    rootSelector: sideCfg.rootSelector,
    probeSelectors,
    selectors: probeSelectors,
    wsEndpoint: sideCfg.wsEndpoint,
    pagePath: sideCfg.pagePath,
    url: sideCfg.url ? resolveUrl(cfg, sideCfg.url) : null,
  };

  // Taken before the render on purpose: a fingerprint recorded afterwards cannot
  // say which tree the screenshot showed.
  const bundle = sideCfg.bundle
    ? bundleLib.captureBundle(
      resolveIn(cfg.__dir, (sideCfg.bundle === true ? {} : sideCfg.bundle).root || '.'),
      sideCfg.bundle === true ? {} : sideCfg.bundle,
    )
    : null;

  const result = await adapter.capture(common);

  const manifest = artifacts.buildCaptureManifest({
    pageId: page.id,
    stateId: state.id,
    viewportId: viewportId || null,
    side,
    platform: result.platform,
    adapter: adapter.id,
    url: result.url,
    projectRoot: sideCfg.projectRoot || null,
    // `codeVersion` is what the caller declares the build to be. The suite's own
    // HEAD is recorded separately as `suiteHead` — it says when the capture was
    // made, never which bytes the simulator ran (audit Q7).
    codeVersion: opts.codeVersion || sideCfg.codeVersion || null,
    suiteHead: gitHead(cfg.__dir),
    bundle,
    dataSource: result.dataSource,
    injection: result.injection,
    viewport: result.viewport,
    dpr: result.dpr,
    screenshotPath: result.screenshotPath,
    screenshotSize: result.screenshotSize,
    screenshotScale: result.screenshotScale,
    nodeCount: result.nodeCount,
    rootId: result.rootId,
    documentSize: result.documentSize,
    note: result.note,
    verification: 'captured',
  });

  writeJson(path.join(outDir, 'snapshot.json'), result.snapshot);
  writeJson(path.join(outDir, 'capture-manifest.json'), manifest);
  return { result, manifest, outDir };
}

function resolveUrl(cfg, url) {
  if (/^https?:|^file:/.test(url)) return url;
  return 'file:///' + resolveIn(cfg.__dir, url).replace(/\\/g, '/');
}

function gitHead(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_) {
    return null;
  }
}

function readCapture(cfg, page, state, side) {
  const dir = captureDir(cfg, page.id, state.id, side, vpOf(state));
  const snapFile = path.join(dir, 'snapshot.json');
  const manFile = path.join(dir, 'capture-manifest.json');
  if (!exists(snapFile) || !exists(manFile)) {
    throw new PfError('CAPTURE_MISSING', `no capture for ${page.id}/${state.id}/${side}; run capture first (${relPosix(cfg.__dir, dir)})`);
  }
  return {
    dir,
    snapshot: readJson(snapFile),
    manifest: readJson(manFile),
    screenshot: exists(path.join(dir, 'screenshot.png')) ? png.readFile(path.join(dir, 'screenshot.png')) : null,
    screenshotPath: path.join(dir, 'screenshot.png'),
  };
}

// ---------------------------------------------------------------- contract

function doContract(cfg, page, state) {
  const proto = readCapture(cfg, page, state, 'prototype');
  const tokensProto = contract.collectTokens(proto.snapshot);

  let target = null;
  let tokensTarget = null;
  let tokensDiff = null;
  try {
    target = readCapture(cfg, page, state, 'target');
    tokensTarget = contract.collectTokens(target.snapshot);
    tokensDiff = contract.diffTokens(tokensProto, tokensTarget);
  } catch (e) {
    if (e.code !== 'CAPTURE_MISSING') throw e;
  }

  const tolerances = tolerancesOf(cfg, page);
  const components = contract.buildComponents(proto.snapshot, target ? target.snapshot : null, page.components || [], tolerances);
  const layout = contract.buildPageLayout(proto.snapshot, target ? target.snapshot : null, page.sections || [], tolerances);

  const outDir = contractDir(cfg, page, state);
  writeJson(path.join(outDir, 'design-tokens.json'), {
    schemaVersion: artifacts.SCHEMA_VERSION, kind: 'design-tokens',
    pageId: page.id, stateId: state.id, generatedAt: isoNow(),
    source: { side: 'prototype', manifest: captureRel(page.id, state.id, 'prototype', vpOf(state)) + '/capture-manifest.json' },
    tokens: tokensProto,
    targetTokens: tokensTarget,
    drift: tokensDiff,
  });
  writeJson(path.join(outDir, 'component-contracts.json'), {
    schemaVersion: artifacts.SCHEMA_VERSION, kind: 'component-contracts',
    pageId: page.id, stateId: state.id, generatedAt: isoNow(),
    components,
  });
  writeJson(path.join(outDir, 'page-layout.json'), {
    schemaVersion: artifacts.SCHEMA_VERSION, kind: 'page-layout',
    pageId: page.id, stateId: state.id, generatedAt: isoNow(),
    ...layout,
  });

  const states = page.states || [{ id: 'default' }];
  const protoManifests = {};
  const targetManifests = {};
  for (const s of states) {
    protoManifests[s.id] = captureManifestOrNull(cfg, page, s, 'prototype');
    targetManifests[s.id] = captureManifestOrNull(cfg, page, s, 'target');
  }
  const stateCaptures = {};
  for (const s of states) stateCaptures[s.id] = { prototype: protoManifests[s.id], target: targetManifests[s.id] };

  writeJson(path.join(outDir, 'prototype-manifest.json'), manifests.buildPrototypeManifest({
    projectId: cfg.project && cfg.project.id,
    pageId: page.id,
    prototype: { ...(cfg.prototype || {}), ...(page.prototype || {}) },
    states,
    captures: protoManifests,
    mappings: page.mappings || [],
    selectors: page.selectors || [],
    platform: proto.manifest.platform,
  }));
  writeJson(path.join(outDir, 'page-state-manifest.json'), manifests.buildPageStateManifest({
    pageId: page.id,
    states,
    captures: stateCaptures,
  }));
  writeJson(path.join(outDir, 'platform-mappings.json'), manifests.buildPlatformMappings({
    page,
    state,
    platforms: {
      prototype: proto.manifest.platform,
      target: target ? target.manifest.platform : null,
    },
    adapters: {
      prototype: cfg.prototype && cfg.prototype.adapter || null,
      target: cfg.target && cfg.target.adapter || null,
    },
    captures: { prototype: proto, target },
  }));

  const contractFile = path.join(outDir, 'interaction-contract.json');
  writeJson(contractFile, manifests.buildInteractionContract({
    pageId: page.id,
    checks: page.interactions || [],
    driver: driverInfo(cfg),
    observation: carriedObservation(contractFile, page.interactions || []),
  }));

  return { outDir, tokensProto, tokensTarget, tokensDiff, components, layout };
}

function captureManifestOrNull(cfg, page, state, side) {
  const file = path.join(captureDir(cfg, page.id, state.id, side, vpOf(state)), 'capture-manifest.json');
  return exists(file) ? readJson(file) : null;
}

/** Contracts are per measurement, so a named viewport gets its own directory. */
function contractDir(cfg, page, state) {
  const vp = vpOf(state);
  return path.join(cfg.__dir, 'contracts', slug(page.id) + (vp ? '@' + slug(vp) : ''));
}

function driverInfo(cfg) {
  const target = cfg.target || {};
  return {
    adapter: target.adapter || null,
    endpoint: target.wsEndpoint || null,
    verification: 'real-action-and-observation',
  };
}

/**
 * `pf contract` regenerates declarations, but a recorded interaction result is
 * evidence: it survives regeneration as long as the declared checks still match.
 * A run that is no longer declared is dropped rather than silently re-attributed.
 */
function carriedObservation(file, checks) {
  if (!checks.length || !exists(file)) return null;
  const prev = readJson(file);
  if (!prev || prev.kind !== 'interaction-contract') return null;
  const recorded = new Map((prev.checks || []).map(c => [c.id, c]));
  if (!checks.every(c => recorded.has(c.id))) return null;
  return {
    status: prev.status,
    reason: prev.reason && prev.reason.message ? prev.reason.message : null,
    checks: checks.map(c => {
      const r = recorded.get(c.id);
      return {
        id: r.id, status: r.status, observed: r.observed || null,
        assertions: r.assertions || [], screenshotPath: r.screenshotPath || null,
        error: r.error || null, verification: r.verification || null,
      };
    }),
  };
}

// ---------------------------------------------------------------- diff

function buildPairs(page) {
  return (page.mappings || []).map((m, i) => ({
    id: m.id || 'pair-' + i,
    role: m.role || m.id,
    criticality: m.criticality || 'normal',
    optional: !!m.optional,
    prototypeSelector: m.prototypeSelector || null,
    targetSelector: m.targetSelector || null,
    prototypePath: m.prototypePath || null,
    targetPath: m.targetPath || null,
    styleProps: m.styleProps || null,
    pixel: m.pixel !== false,
    pixelMode: m.pixelMode === 'informational' ? 'informational' : 'exact',
    dynamicText: !!m.dynamicText,
    note: m.note || null,
  }));
}

function pixelVerdict(cmp, tolerances, criticality) {
  if (!cmp || cmp.status === 'UNVERIFIED') return 'UNVERIFIED';
  const limit = criticality === 'critical' ? tolerances.criticalPixelRatio : tolerances.pixelRatio;
  return cmp.diffRatio > limit ? 'FAIL' : 'PASS';
}

const MASK_PAD_CSS = 2;

function descendantIds(snapshot, root) {
  const byId = new Map(snapshot.nodes.map(n => [n.id, n]));
  const out = new Set();
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    for (const childId of node.children || []) {
      const child = byId.get(childId);
      if (!child || out.has(child.id)) continue;
      out.add(child.id);
      stack.push(child);
    }
  }
  return out;
}

/**
 * Declared child regions to exclude from a container's per-pixel comparison.
 *
 * A container's crop covers its descendants too. Two kinds of descendant are
 * judged at their own level and must not be charged to the container as well:
 * text pairs (`pixelMode: "informational"`, judged by ink extent/amount) and
 * live copy (`dynamicText`). Measured evidence for why: a 2× capture downscaled
 * to CSS px moves 13 % of a text crop's pixels while its ink signature stays
 * within 11 %, and a live clock's digits move 11 % of the card — neither is a
 * defect of the card's own chrome.
 *
 * Both sides' relative rects are masked (union, padded for AA spill) so a
 * descendant that itself sits at a different offset cannot leak ink past the
 * mask on the other side.
 */
function maskChildRegions(pair, pairs, protoSnap, targetSnap) {
  const rootA = geometry.resolveNode(protoSnap, pair.prototypeSelector, pair.prototypePath);
  const rootB = geometry.resolveNode(targetSnap, pair.targetSelector, pair.targetPath);
  if (!rootA || !rootB) return { rects: [], ids: [] };
  const insideA = descendantIds(protoSnap, rootA);
  const insideB = descendantIds(targetSnap, rootB);
  const rects = [];
  const ids = [];
  for (const other of pairs) {
    if (other === pair) continue;
    if (other.pixelMode !== 'informational' && !other.dynamicText) continue;
    const qa = geometry.resolveNode(protoSnap, other.prototypeSelector, other.prototypePath);
    const qb = geometry.resolveNode(targetSnap, other.targetSelector, other.targetPath);
    if (!qa || !qb || !insideA.has(qa.id) || !insideB.has(qb.id)) continue;
    ids.push(other.id);
    rects.push({
      x: qa.rect.x - rootA.rect.x - MASK_PAD_CSS,
      y: qa.rect.y - rootA.rect.y - MASK_PAD_CSS,
      w: qa.rect.w + 2 * MASK_PAD_CSS,
      h: qa.rect.h + 2 * MASK_PAD_CSS,
    });
    rects.push({
      x: qb.rect.x - rootB.rect.x - MASK_PAD_CSS,
      y: qb.rect.y - rootB.rect.y - MASK_PAD_CSS,
      w: qb.rect.w + 2 * MASK_PAD_CSS,
      h: qb.rect.h + 2 * MASK_PAD_CSS,
    });
  }
  return { rects, ids };
}

function doDiff(cfg, page, state, runDir) {
  const proto = readCapture(cfg, page, state, 'prototype');
  const target = readCapture(cfg, page, state, 'target');
  const tolerances = tolerancesOf(cfg, page);
  const pairs = buildPairs(page);
  const geo = geometry.compareSnapshots(proto.snapshot, target.snapshot, pairs, tolerances);
  const aligned = page.alignment && page.alignment.anchor
    ? geometry.realignToAnchor(geo, page.alignment.anchor, tolerances)
    : { applied: false };

  const regionDir = path.join(runDir, 'regions');
  ensureDir(regionDir);

  const records = geo.map((rec, i) => {
    const pair = pairs[i];
    const a = geometry.resolveNode(proto.snapshot, pair.prototypeSelector, pair.prototypePath);
    const b = geometry.resolveNode(target.snapshot, pair.targetSelector, pair.targetPath);
    let pixel = null;
    if (pair.pixel !== false && a && b && a.rect && b.rect && proto.screenshot && target.screenshot) {
      const masks = maskChildRegions(pair, pairs, proto.snapshot, target.snapshot);
      const cmp = regions.compareRegion(
        proto.screenshot, a.rect, proto.manifest.screenshot.scale,
        target.screenshot, b.rect, target.manifest.screenshot.scale,
        { threshold: 0.1, minArea: 8, maskCss: masks.rects },
      );
      const informative = pair.pixelMode === 'informational';
      // Glyph rasterisation differs between a browser at 1× and a device
      // screenshot downscaled by the DevTools capture path, so text pairs are
      // gated on ink extent/amount instead of a per-pixel ratio.
      const ink = informative && cmp.images
        ? diffLib.compareInk(
          diffLib.inkSignature(cmp.images.prototype),
          diffLib.inkSignature(cmp.images.target),
          { bboxPx: 2, amountRatio: 0.3 },
        )
        : null;
      pixel = {
        status: cmp.status === 'UNVERIFIED' ? 'UNVERIFIED' : 'PASS',
        diffCount: cmp.diffCount, aaCount: cmp.aaCount, diffRatio: cmp.diffRatio,
        meanDelta: cmp.meanDelta, maxDelta: cmp.maxDelta,
        components: cmp.components, resampled: cmp.resampled,
        prototypePixels: cmp.prototypePixels, targetPixels: cmp.targetPixels,
        masked: cmp.masked || null,
        maskedBy: masks.ids,
        unmeasured: cmp.status === 'UNVERIFIED' ? cmp.reason : undefined,
        informativeOnly: informative,
        ink,
      };
      if (cmp.status !== 'UNVERIFIED') {
        pixel.status = informative
          ? (ink && ink.status === 'FAIL' ? 'FAIL' : 'PASS')
          : pixelVerdict(cmp, tolerances, pair.criticality);
      }
      if (cmp.images) {
        writeJson(path.join(regionDir, pair.id + '.json'), {
          diffCount: cmp.diffCount, diffRatio: cmp.diffRatio,
          prototypePixels: cmp.prototypePixels, targetPixels: cmp.targetPixels,
          components: cmp.components,
        });
        png.writeFile(path.join(regionDir, pair.id + '-prototype.png'), cmp.images.prototype);
        png.writeFile(path.join(regionDir, pair.id + '-target.png'), cmp.images.target);
        png.writeFile(path.join(regionDir, pair.id + '-diff.png'), cmp.images.diff);
      }
    }

    const accepted = acceptedFor(page, state, pair.id);
    const acceptance = acceptanceLib.resolveAcceptance(rec, accepted);
    const excused = acceptance.excused;
    const whole = accepted.find(x => !x.categories || !x.categories.length);
    const volatileCopy = pair.dynamicText;
    const remaining = [...new Set(rec.categories.filter(c => !excused.has(c)))];
    if (volatileCopy) {
      // Declared-volatile copy is volatile in every channel: the glyphs it draws
      // are the same observation as the string it spells. Text, ink and pixel
      // are therefore observed and reported but not judged. Presence, geometry
      // and style stay judged — a clock that disappears or moves is a defect.
      for (const c of ['text', 'ink', 'pixel']) {
        const i = remaining.indexOf(c);
        if (i >= 0) remaining.splice(i, 1);
      }
    }
    if (pixel) {
      pixel.judged = !volatileCopy;
      if (pixel.status === 'FAIL' && !volatileCopy) {
        const cat = pixel.informativeOnly ? 'ink' : 'pixel';
        if (!excused.has(cat) && !remaining.includes(cat)) remaining.push(cat);
      }
    }

    let status;
    if (whole) status = 'NOT_APPLICABLE';
    else if (remaining.length) status = 'FAIL';
    else if (rec.unverified) status = 'UNVERIFIED';
    else if (pixel && pixel.status === 'UNVERIFIED' && !volatileCopy) status = 'UNVERIFIED';
    else status = 'PASS';

    return {
      id: pair.id,
      role: pair.role,
      criticality: pair.criticality,
      status,
      categories: remaining,
      observedCategories: rec.categories,
      notes: rec.notes || null,
      presence: rec.presence,
      geometry: rec.geometry,
      note: pair.note,
      pixelCompared: pair.pixel !== false,
      pixelMode: pair.pixelMode,
      dynamicText: pair.dynamicText || undefined,
      styles: (rec.styles || []).map((s, i) => (excused.has(s.category) || acceptance.acceptedStyles.has(i)
        ? { ...s, accepted: true }
        : s)),
      text: rec.text,
      pixel,
      evidence: rec.evidence,
      acceptedDifference: accepted.length ? accepted.map(x => x.reason || 'accepted').join('; ') : null,
      acceptedCategories: [...excused],
      acceptanceBroken: acceptance.broken.length ? acceptance.broken : undefined,
      acceptanceInvalid: acceptance.invalid || undefined,
      attribution: null,
      images: {
        prototype: path.join(regionDir, pair.id + '-prototype.png'),
        target: path.join(regionDir, pair.id + '-target.png'),
        diff: path.join(regionDir, pair.id + '-diff.png'),
      },
    };
  });

  const cascadeResult = cascade.attribute(records, proto.snapshot, target.snapshot, pairs);
  for (const rec of records) rec.attribution = cascadeResult.regions[rec.id] || null;
  const invalidAcceptance = records.filter(r => r.acceptanceInvalid).map(r => r.id);

  const full = null;
  const diffReport = artifacts.buildVisualDiffReport({
    pageId: page.id,
    stateId: state.id,
    viewportId: vpOf(state),
    provenance: {
      prototype: provenanceOf(proto.manifest),
      target: provenanceOf(target.manifest),
    },
    tolerances,
    regions: records,
    full,
    acceptedDifferences: page.acceptedDifferences || [],
  });
  diffReport.mapping = {
    pairs: pairs.length,
    source: 'pf.config.json#pages[].mappings',
  };
  diffReport.alignment = aligned;
  diffReport.cascade = {
    method: cascadeResult.method,
    attributed: cascadeResult.attributed,
    independent: cascadeResult.independent,
  };
  diffReport.warnings = buildWarnings(cfg, page, state, proto, target, records);
  if (invalidAcceptance.length) {
    diffReport.warnings.push('ACCEPTANCE_INVALID: a maxAbsPx bound was declared on a difference that is not numeric ('
      + invalidAcceptance.join(', ') + '); it was not applied');
  }
  writeJson(path.join(runDir, 'visual-diff-report.json'), diffReport);
  return { diffReport, proto, target, pairs };
}

function acceptedFor(page, state, pairId) {
  const own = (page.acceptedDifferences || []).filter(a => a.pairId === pairId);
  const perState = ((state && state.acceptedDifferences) || []).filter(a => a.pairId === pairId);
  return own.concat(perState);
}

function provenanceOf(manifest) {
  return {
    platform: manifest.platform,
    url: manifest.source && manifest.source.url,
    viewport: manifest.viewport,
    dpr: manifest.dpr,
    codeVersion: manifest.source && manifest.source.codeVersion,
    suiteHead: manifest.source && manifest.source.suiteHead,
    bundle: manifest.bundle
      ? { fingerprint: manifest.bundle.fingerprint, files: manifest.bundle.files, fingerprintedAt: manifest.bundle.fingerprintedAt }
      : null,
    dataSource: manifest.source && manifest.source.dataSource,
    capturedAt: manifest.capturedAt,
    screenshotSha256: manifest.screenshot && manifest.screenshot.sha256,
    screenshotScale: manifest.screenshot && manifest.screenshot.scale,
    note: manifest.source && manifest.source.note,
  };
}

function buildWarnings(cfg, page, state, proto, target, records) {
  const warnings = [];
  if (proto.manifest.source.dataSource !== 'real') warnings.push('Prototype capture used injected data.');
  if (target.manifest.source.dataSource !== 'real') {
    warnings.push('Target capture used injected data: visual evidence only, not acceptable as interaction evidence.');
  }
  if (target.manifest.screenshot && target.manifest.screenshot.scale) {
    const s = target.manifest.screenshot.scale;
    if (Math.abs(s.x - 1) > 0.001 || Math.abs(s.y - 1) > 0.001) {
      warnings.push(`Target screenshot is ${s.x.toFixed(4)}×${s.y.toFixed(4)} of CSS px; region crops are normalised to the smaller side before diffing.`);
    }
  }
  const dynamic = records.filter(r => r.dynamicText).map(r => r.id);
  if (dynamic.length) warnings.push(`Dynamic text (declared; text, ink and pixel content observed but not judged, presence still required): ${dynamic.join(', ')}`);
  const masked = records
    .filter(r => r.pixel && r.pixel.masked && r.pixel.masked.pixels)
    .map(r => `${r.id} ← ${(r.pixel.maskedBy || []).join('/')}`);
  if (masked.length) {
    warnings.push(`Container pixel comparisons masked over declared child regions (each child is judged at its own level): ${masked.join('; ')}`);
  }
  const missing = records.filter(r => r.status === 'UNVERIFIED').map(r => r.id);
  if (missing.length) warnings.push(`UNVERIFIED regions: ${missing.join(', ')}`);
  const notApplicable = records.filter(r => r.status === 'NOT_APPLICABLE').map(r => r.id);
  if (notApplicable.length) warnings.push(`NOT_APPLICABLE regions: ${notApplicable.join(', ')}`);
  return warnings;
}

// ---------------------------------------------------------------- validate

/**
 * Dimension D reads artifacts, not pixels: the state manifest says how the
 * state was declared and what each side captured, and the capture manifests on
 * disk must agree with it. Missing artifacts are UNVERIFIED, never assumed.
 */
function stateDimension(cfg, page, state) {
  const manifestFile = path.join(contractDir(cfg, page, state), 'page-state-manifest.json');
  const captureManifest = side => {
    try {
      return readCapture(cfg, page, state, side).manifest;
    } catch (e) {
      if (e.code === 'CAPTURE_MISSING') return null;
      throw e;
    }
  };
  return stateChecks.buildStateChecks({
    state,
    pageState: exists(manifestFile) ? readJson(manifestFile) : null,
    prototype: captureManifest('prototype'),
    target: captureManifest('target'),
  });
}

/**
 * Which build the screenshots show. Only sides that declare `bundle` produce
 * checks; an undeclared side stays silent instead of inventing a measurement.
 */
function bundleChecks(cfg, page, state) {
  const out = [];
  for (const side of ['prototype', 'target']) {
    const sideCfg = { ...(cfg[side] || {}), ...(page[side] || {}), ...(state[side] || {}) };
    let manifest = null;
    try {
      manifest = readCapture(cfg, page, state, side).manifest;
    } catch (e) {
      if (e.code !== 'CAPTURE_MISSING') throw e;
    }
    out.push(...bundleLib.buildBundleChecks(side, sideCfg, manifest, { baseDir: cfg.__dir }));
  }
  return out;
}

async function doInteraction(cfg, page, state, runDir) {
  const spec = page.interactions || [];
  const result = spec.length ? await runInteractionSpec(cfg, page, spec, runDir) : {
    checks: [], status: 'UNVERIFIED', reason: 'no interaction checks declared',
  };
  const contractFile = path.join(contractDir(cfg, page, state), 'interaction-contract.json');
  writeJson(contractFile, manifests.buildInteractionContract({
    pageId: page.id,
    checks: spec,
    driver: driverInfo(cfg),
    observation: spec.length ? result : null,
  }));
  return result;
}

async function runInteractionSpec(cfg, page, spec, runDir) {
  const targetCfg = { ...(cfg.target || {}), ...(page.target || {}) };
  // A web target is opened by URL; a mini-program target by page path.
  targetCfg.viewport = targetCfg.viewport || (cfg.prototype && cfg.prototype.viewport) || undefined;
  const resetTo = targetCfg.url ? resolveUrl(cfg, targetCfg.url) : targetCfg.pagePath;
  let driver;
  try {
    driver = await interactions.openDriver(cfg.target.adapter, targetCfg, {
      automatorPath: targetCfg.automatorPath,
    });
  } catch (e) {
    return {
      checks: spec.map(c => ({ id: c.id, title: c.title, status: 'BLOCKED', observed: e.message })),
      status: 'BLOCKED',
      reason: e.message,
    };
  }
  try {
    const outDir = path.join(runDir, 'interaction');
    ensureDir(outDir);
    const checks = await interactions.runChecks(driver, spec, {
      resetTo,
      outDir,
    });
    for (const c of checks) {
      if (c.screenshotPath) {
        fs.copyFileSync(c.screenshotPath, path.join(outDir, c.id + '.png'));
        c.screenshotPath = path.join(outDir, c.id + '.png');
      }
    }
    return { checks, status: artifacts.statusRollup(checks.map(c => c.status)) };
  } finally {
    await driver.close().catch(() => {});
  }
}

async function doValidate(cfg, page, state, runDir, opts) {
  const diffFile = path.join(runDir, 'visual-diff-report.json');
  if (!exists(diffFile)) throw new PfError('DIFF_MISSING', 'run diff before validate');
  const diffReport = readJson(diffFile);
  const tolerances = tolerancesOf(cfg, page);
  const interaction = opts.skipInteractions ? { checks: [], status: 'UNVERIFIED' } : await doInteraction(cfg, page, state, runDir);

  const provenance = bundleChecks(cfg, page, state);
  const scorecard = score.buildScorecard({
    pairs: diffReport.regions,
    pixel: null,
    provenance,
    thresholds: {
      position: tolerances.position,
      size: tolerances.size,
      gap: tolerances.gap,
      font: tolerances.font,
      color: tolerances.color,
      pixelRatio: tolerances.pixelRatio,
      criticalPixelRatio: tolerances.criticalPixelRatio,
    },
    state: stateDimension(cfg, page, state),
    interaction: interaction.checks,
  });

  const interactionStatus = interaction.status;
  let overall = scorecard.verdict;
  if (overall === 'PASS' && interactionStatus === 'FAIL') overall = 'FAIL';
  if (overall === 'PASS' && interactionStatus !== 'PASS') overall = 'UNVERIFIED';

  const limitations = [...(diffReport.warnings || [])];
  if (interactionStatus === 'BLOCKED') limitations.push('Interaction checks were BLOCKED: ' + (interaction.reason || 'driver unavailable'));
  for (const c of provenance) {
    if (c.status !== 'PASS') limitations.push(`${c.id}: ${c.detail || c.status}`);
  }

  const validation = artifacts.buildValidationReport({
    pageId: page.id,
    stateId: state.id,
    viewportId: vpOf(state),
    status: overall,
    reason: overall === 'UNVERIFIED' ? 'some dimensions could not be measured' : null,
    scorecard,
    interaction,
    evidence: [
      'visual-diff-report.json',
      captureRel(page.id, state.id, 'prototype', vpOf(state)) + '/capture-manifest.json',
      captureRel(page.id, state.id, 'target', vpOf(state)) + '/capture-manifest.json',
    ],
    limitations,
  });
  writeJson(path.join(runDir, 'fidelity-validation-report.json'), validation);

  const manifest = {
    title: `${cfg.project && cfg.project.name || 'Project'} · ${page.id} / ${state.id}`,
    runId: path.basename(runDir),
    generatedAt: isoNow(),
    scope: `${diffReport.regions.length} mapped regions`,
    verdict: overall,
    scorecard,
    provenance: diffReport.provenance,
    warnings: limitations,
    regions: diffReport.regions,
    acceptedDifferences: diffReport.acceptedDifferences,
    interactions: { checks: interaction.checks },
    artifacts: collectArtifacts(runDir, diffReport),
  };
  const out = report.writeReport(path.join(runDir, 'report.html'), manifest);
  return { validation, scorecard, overall, report: out, interaction };
}

function collectArtifacts(runDir, diffReport) {
  const list = [
    { path: 'visual-diff-report.json' },
    { path: 'fidelity-validation-report.json' },
  ];
  for (const r of diffReport.regions || []) {
    for (const key of ['prototype', 'target', 'diff']) {
      const p = r.images && r.images[key];
      if (p && exists(p)) list.push({ path: relPosix(runDir, p) });
    }
  }
  return list;
}

// ---------------------------------------------------------------- commands

function adapterInventory() {
  const dir = path.join(__dirname, '..', 'adapters');
  const schema = readJson(path.join(__dirname, '..', 'schemas', 'adapter.schema.json'));
  const ids = exists(dir) ? fs.readdirSync(dir).filter(d => exists(path.join(dir, d, 'adapter.json'))).sort() : [];
  const valid = [];
  const invalid = [];
  for (const id of ids) {
    const res = schemaLib.validate(schema, readJson(path.join(dir, id, 'adapter.json')));
    if (res.valid) valid.push(id); else invalid.push({ id, errors: res.errors });
  }
  return {
    status: invalid.length ? 'unsupported' : (valid.length ? 'available' : 'unsupported'),
    ids: valid,
    invalid,
  };
}

async function cmdDoctor(args) {
  const ports = (args.ports ? String(args.ports) : '33278,9421').split(',').map(Number);
  const info = await envLib.detect({ ports, useNpm: args.npm !== 'false' });
  const cap = info.capabilities;
  info.adapters = adapterInventory();
  const rows = [
    ['node', info.node.status, info.node.version + ' (require ' + info.node.required + ')'],
    ['playwright', cap.playwright.status, cap.playwright.path || (cap.playwright.searched || []).join(' | ')],
    ['miniprogram-automator', cap.automator.status, cap.automator.path || (cap.automator.searched || []).join(' | ')],
    ['wechat devtools cli', cap.wechatCli.status, cap.wechatCli.path || ''],
    ['devtools ports', cap.devtoolsPorts.status, (cap.devtoolsPorts.ports || []).map(p => `${p.port}:${p.status}`).join(' ')],
    ['adapters', info.adapters.status, info.adapters.ids.join(', ') + (info.adapters.invalid.length ? ' · invalid: ' + info.adapters.invalid.map(a => a.id).join(', ') : '')],
  ];
  if (args.json) { console.log(JSON.stringify(info, null, 2)); return doctorExit(info); }
  for (const [name, status, detail] of rows) {
    console.log(`${status === 'available' ? 'OK  ' : status === 'unsupported' ? 'FAIL' : '--  '} ${name.padEnd(24)} ${status.padEnd(10)} ${detail}`);
  }
  return doctorExit(info);
}

/** An invalid adapter descriptor is a config error (2), not a green doctor. */
function doctorExit(info) {
  if (info.node.status !== 'available') return 2;
  return info.adapters && info.adapters.status !== 'available' ? 2 : 0;
}

function cmdInit(args) {
  const dir = path.resolve(args.dir || args._[1] || '.');
  const file = path.join(dir, 'pf.config.json');
  if (exists(file) && !args.force) throw new PfError('CONFIG_EXISTS', `${file} exists; pass --force to overwrite`);
  ensureDir(dir);
  const cfg = {
    schemaVersion: artifacts.SCHEMA_VERSION,
    project: { id: args.id || path.basename(dir), name: args.name || path.basename(dir) },
    prototype: { adapter: 'web', viewport: { width: 390, height: 844 }, frameSelector: '#device' },
    target: { adapter: 'wechat-miniprogram', wsEndpoint: 'ws://127.0.0.1:9421' },
    tolerances: DEFAULT_TOLERANCES,
    pages: [{
      id: 'page-1',
      prototype: { url: 'prototype/index.html' },
      target: { pagePath: '/pages/index/index' },
      selectors: [],
      mappings: [],
      states: [{ id: 'default' }],
      interactions: [],
      acceptedDifferences: [],
    }],
  };
  writeJson(file, cfg);
  for (const d of ['captures', 'contracts', 'reports']) ensureDir(path.join(dir, d));
  console.log('wrote ' + file);
  console.log('next: edit pages[].mappings, then `pf capture --project <dir> --page page-1 --side prototype`');
  return 0;
}

async function cmdCapture(args) {
  const cfg = loadConfig(args.project || '.');
  const page = findPage(cfg, args.page);
  const baseState = pickState(page, args.state);
  const sides = args.side ? [args.side] : ['prototype', 'target'];
  for (const side of sides) {
    if (!['prototype', 'target'].includes(side)) throw new PfError('SIDE_UNKNOWN', `unknown side ${side}`);
  }
  for (const viewportId of viewportsFor(cfg, page, args.viewport)) {
    const state = withViewport(baseState, viewportId);
    for (const side of sides) {
      const { result, manifest, outDir } = await doCapture(cfg, page, state, side, args);
      console.log(`${side}${vpLabel(viewportId)}: ${manifest.snapshot.nodes} nodes · ${manifest.screenshot.width}×${manifest.screenshot.height}px` +
        (manifest.screenshot.scale ? ` (scale ${round(manifest.screenshot.scale.x, 4)}×${round(manifest.screenshot.scale.y, 4)})` : '') +
        ` · ${relPosix(cfg.__dir, outDir)}`);
      if (!result.screenshotPath) throw new PfError('CAPTURE_NO_SCREENSHOT', `${side} produced no screenshot`);
    }
  }
  return 0;
}

function pickState(page, stateId) {
  const states = page.states || [{ id: 'default' }];
  const s = stateId ? states.find(s => s.id === stateId) : states[0];
  if (!s) throw new PfError('STATE_UNKNOWN', `state "${stateId}" not in page ${page.id}`);
  return s;
}

function cmdContract(args) {
  const cfg = loadConfig(args.project || '.');
  const page = findPage(cfg, args.page);
  const baseState = pickState(page, args.state);
  for (const viewportId of viewportsFor(cfg, page, args.viewport)) {
    const state = withViewport(baseState, viewportId);
    const res = doContract(cfg, page, state);
    console.log(`tokens${vpLabel(viewportId)}: ${Object.entries(res.tokensProto).map(([k, v]) => k + '=' + v.length).join(' ')}`);
    if (res.tokensDiff) {
      for (const [group, d] of Object.entries(res.tokensDiff)) {
        if (d.onlyPrototype.length || d.onlyTarget.length) {
          console.log(`drift ${group}: onlyPrototype=${d.onlyPrototype.length} onlyTarget=${d.onlyTarget.length}`);
        }
      }
    }
    console.log('contracts: ' + relPosix(cfg.__dir, res.outDir));
  }
  return 0;
}

function diffOne(cfg, page, state, args) {
  const runDir = runDirectory(cfg, page, state, args.run);
  const { diffReport } = doDiff(cfg, page, state, runDir);
  const fail = diffReport.regions.filter(r => r.status === 'FAIL');
  console.log(`diff${vpLabel(vpOf(state))}: ${diffReport.regions.length} regions · ${fail.length} failing · verdict ${diffReport.verdict}`);
  for (const r of fail.slice(0, 12)) {
    const g = r.geometry || {};
    const inkNote = r.pixel && r.pixel.ink && r.pixel.ink.status === 'FAIL'
      ? ` ink: ${(r.pixel.ink.reasons || [r.pixel.ink.reason]).join('; ')}` : '';
    console.log(`  FAIL ${r.id.padEnd(24)} Δx ${g.dx} Δy ${g.dy} Δw ${g.dw} Δh ${g.dh}` +
      (r.pixel ? ` pixel ${(r.pixel.diffRatio * 100).toFixed(2)}%${r.pixel.informativeOnly ? ' (info)' : ''}` : '') +
      inkNote +
      (r.categories.length ? ' [' + [...new Set(r.categories)].join(',') + ']' : ''));
  }
  console.log('report dir: ' + relPosix(cfg.__dir, runDir));
  return { code: diffReport.verdict === 'FAIL' ? 1 : diffReport.verdict === 'PASS' ? 0 : 2, diffReport, runDir };
}

function cmdDiff(args) {
  const cfg = loadConfig(args.project || '.');
  const page = findPage(cfg, args.page);
  const baseState = pickState(page, args.state);
  const vps = viewportsFor(cfg, page, args.viewport);
  if (vps.length > 1 && args.run) throw new PfError('RUN_CONFLICT', '--run names one report directory; drop --run when measuring every viewport');
  const codes = [];
  const summary = {};
  for (const viewportId of vps) {
    const res = diffOne(cfg, page, withViewport(baseState, viewportId), args);
    codes.push(res.code);
    summary[viewportId || 'default'] = res.diffReport.verdict;
  }
  if (vps.length > 1) console.log('viewports: ' + Object.entries(summary).map(([k, v]) => `${k}=${v}`).join(' '));
  return worstExit(codes);
}

function runPrefix(page, state) {
  return `${slug(page.id)}-${slug(state.id)}${vpOf(state) ? '@' + slug(vpOf(state)) : ''}-`;
}

function runDirectory(cfg, page, state, runId) {
  const id = runId || `${runPrefix(page, state)}${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  const dir = path.join(cfg.__dir, 'reports', id);
  ensureDir(dir);
  writeJson(path.join(dir, 'run.json'), {
    schemaVersion: artifacts.SCHEMA_VERSION,
    runId: id, pageId: page.id, stateId: state.id, viewportId: vpOf(state), startedAt: isoNow(),
    project: cfg.project || null,
  });
  return dir;
}

function latestRun(cfg, page, state) {
  const root = path.join(cfg.__dir, 'reports');
  if (!exists(root)) return null;
  const prefix = runPrefix(page, state);
  const dirs = fs.readdirSync(root).filter(d => d.startsWith(prefix)).sort();
  return dirs.length ? path.join(root, dirs[dirs.length - 1]) : null;
}

async function cmdValidate(args) {
  const cfg = loadConfig(args.project || '.');
  const page = findPage(cfg, args.page);
  const baseState = pickState(page, args.state);
  const vps = viewportsFor(cfg, page, args.viewport);
  if (vps.length > 1 && args.run) throw new PfError('RUN_CONFLICT', '--run names one report directory; drop --run when validating every viewport');
  const codes = [];
  const summary = {};
  for (const viewportId of vps) {
    const state = withViewport(baseState, viewportId);
    const runDir = args.run ? resolveRun(cfg, args.run) : latestRun(cfg, page, state);
    if (!runDir) throw new PfError('RUN_MISSING', 'no report run found; pass --run or run diff first');
    const res = await doValidate(cfg, page, state, runDir, args);
    console.log(`validate${vpLabel(viewportId)}: ${res.overall} · ` + Object.entries(res.scorecard.dimensions).map(([k, d]) => `${k}:${d.verdict}`).join(' '));
    console.log('html: ' + relPosix(cfg.__dir, res.report.file));
    if (res.validation.limitations.length) {
      for (const l of res.validation.limitations) console.log('  ! ' + l);
    }
    codes.push(res.overall === 'PASS' ? 0 : res.overall === 'FAIL' ? 1 : 2);
    summary[viewportId || 'default'] = res.overall;
  }
  if (vps.length > 1) console.log('viewports: ' + Object.entries(summary).map(([k, v]) => `${k}=${v}`).join(' '));
  return worstExit(codes);
}

/**
 * One full measurement of one (page, state, viewport). Shared by `pf verify` and
 * `pf repair` so the repair loop cannot drift into a different definition of
 * "verified" than the command a user runs by hand.
 */
async function verifyOnce(cfg, page, state, runDir, args) {
  const tag = vpLabel(vpOf(state));
  const steps = [];
  artifacts.clearRunArtifacts(runDir);
  for (const side of ['prototype', 'target']) {
    try {
      const { manifest } = await doCapture(cfg, page, state, side, args);
      steps.push({ step: 'capture:' + side, status: 'PASS', detail: `${manifest.snapshot.nodes} nodes` });
    } catch (e) {
      steps.push({ step: 'capture:' + side, status: 'BLOCKED', detail: e.message });
      writeJson(path.join(runDir, 'verify-steps.json'), { steps, verdict: 'BLOCKED', viewportId: vpOf(state) });
      console.error(`${side}${tag} capture BLOCKED: ${e.message}`);
      return { steps, verdict: 'BLOCKED', res: null };
    }
  }
  try {
    doContract(cfg, page, state);
    steps.push({ step: 'contract', status: 'PASS' });
  } catch (e) {
    steps.push({ step: 'contract', status: 'FAIL', detail: e.message });
  }
  const { diffReport } = doDiff(cfg, page, state, runDir);
  steps.push({ step: 'diff', status: diffReport.verdict, detail: `${diffReport.regions.filter(r => r.status === 'FAIL').length} failing` });
  const res = await doValidate(cfg, page, state, runDir, args);
  steps.push({ step: 'validate', status: res.overall });
  writeJson(path.join(runDir, 'verify-steps.json'), { steps, verdict: res.overall, viewportId: vpOf(state) });
  return { steps, verdict: res.overall, res };
}

async function cmdVerify(args) {
  const cfg = loadConfig(args.project || '.');
  const page = findPage(cfg, args.page);
  const baseState = pickState(page, args.state);
  const vps = viewportsFor(cfg, page, args.viewport);
  if (vps.length > 1 && args.run) throw new PfError('RUN_CONFLICT', '--run names one report directory; drop --run when verifying every viewport');
  const codes = [];
  const summary = {};
  for (const viewportId of vps) {
    const state = withViewport(baseState, viewportId);
    const runDir = runDirectory(cfg, page, state, args.run);
    const out = await verifyOnce(cfg, page, state, runDir, args);
    if (!out.res) { codes.push(2); summary[viewportId || 'default'] = 'BLOCKED'; continue; }
    for (const s of out.steps) console.log(`${s.status.padEnd(12)} ${s.step}${vpLabel(viewportId)}${s.detail ? ' · ' + s.detail : ''}`);
    console.log(`verdict${vpLabel(viewportId)} ${out.verdict} · html ${relPosix(cfg.__dir, out.res.report.file)}`);
    codes.push(out.verdict === 'PASS' ? 0 : out.verdict === 'FAIL' ? 1 : 2);
    summary[viewportId || 'default'] = out.verdict;
  }
  if (vps.length > 1) console.log('viewports: ' + Object.entries(summary).map(([k, v]) => `${k}=${v}`).join(' '));
  return worstExit(codes);
}

async function cmdInteractions(args) {
  const cfg = loadConfig(args.project || '.');
  const page = findPage(cfg, args.page);
  const baseState = pickState(page, args.state);
  const vps = viewportsFor(cfg, page, args.viewport);
  if (vps.length > 1 && args.run) throw new PfError('RUN_CONFLICT', '--run names one report directory; drop --run when checking every viewport');
  const codes = [];
  for (const viewportId of vps) {
    const state = withViewport(baseState, viewportId);
    const runDir = args.run ? resolveRun(cfg, args.run) : runDirectory(cfg, page, state);
    const result = await doInteraction(cfg, page, state, runDir);
    for (const c of result.checks) console.log(`${c.status.padEnd(12)} ${c.id}${vpLabel(viewportId)} ${c.title || ''}${c.observed ? ' · ' + c.observed : ''}`);
    console.log(`interaction${vpLabel(viewportId)} status ${result.status}${result.reason ? ' · ' + result.reason : ''}`);
    writeJson(path.join(runDir, 'interaction-report.json'), Object.assign({}, result, { viewportId: vpOf(state) }));
    codes.push(result.status === 'PASS' ? 0 : result.status === 'FAIL' ? 1 : 2);
  }
  return worstExit(codes);
}

/**
 * Bounded repair loop. The plan is data (anchor + replacement), never a script:
 * every edit is prechecked for a unique anchor, backed up with a sha256, and only
 * kept if the *same* verifier that a user runs by hand reports a better verdict.
 * A patch that does not pay off is rolled back and the rollback is proven by
 * re-hashing the restored file, not asserted in prose.
 */
async function cmdRepair(args) {
  const cfg = loadConfig(args.project || '.');
  const page = findPage(cfg, args.page);
  const baseState = pickState(page, args.state);
  if (args.viewport === 'all') throw new PfError('REPAIR_ONE_VIEWPORT', 'repair is measured one viewport at a time; pass a single --viewport id');
  const viewportId = viewportsFor(cfg, page, args.viewport)[0];
  const state = withViewport(baseState, viewportId);

  const planFile = resolveIn(cfg.__dir, args.plan || 'repair.json');
  if (!exists(planFile)) throw new PfError('REPAIR_PLAN_MISSING', `no repair plan at ${relPosix(cfg.__dir, planFile)}`);
  const plan = repair.normalizeSpec(readJson(planFile));

  const runDir = runDirectory(cfg, page, state, args.run);
  const reportFile = path.join(runDir, 'repair-report.json');
  const base = { schemaVersion: artifacts.SCHEMA_VERSION, kind: 'repair-report', generatedAt: isoNow(),
    pageId: page.id, stateId: state.id, viewportId: vpOf(state), plan: relPosix(cfg.__dir, planFile),
    edits: plan.edits.map(e => ({ id: e.id, file: e.file, why: e.why || null })) };

  const pre = repair.precheck(plan, cfg.__dir);
  if (!pre.ok) {
    writeJson(reportFile, Object.assign({}, base, { status: 'BLOCKED', precheck: pre,
      note: 'nothing was written: every anchor must occur exactly once before any edit is applied' }));
    console.error(`REPAIR_BLOCKED · ${pre.edits.filter(e => e.status !== 'PASS').map(e => `${e.id}: ${e.reason}`).join('; ')}`);
    console.error('report: ' + relPosix(cfg.__dir, reportFile));
    return 2;
  }

  const rank = { FAIL: 0, BLOCKED: 1, UNVERIFIED: 1, PASS: 2 };
  const before = await verifyOnce(cfg, page, state, ensureDir(path.join(runDir, 'before')), args);
  if (before.verdict === 'PASS') {
    throw new PfError('REPAIR_NOT_NEEDED', 'the before-verdict is already PASS; there is no defect for this patch to fix');
  }

  const bak = repair.backup(plan, cfg.__dir, runDir);
  const applied = repair.apply(plan, cfg.__dir);
  const after = await verifyOnce(cfg, page, state, ensureDir(path.join(runDir, 'after')), args);

  const improved = rank[after.verdict] > rank[before.verdict];
  let decision;
  let rollback = null;
  let restored = null;
  if (improved) {
    decision = { outcome: 'kept', reason: `${before.verdict} → ${after.verdict}`, applied };
  } else {
    rollback = repair.rollback(bak.entries, cfg.__dir);
    // Re-measure after the rollback so the captures on disk describe the restored
    // bytes. Skipping this would leave evidence for a tree that no longer exists.
    restored = await verifyOnce(cfg, page, state, ensureDir(path.join(runDir, 'restored')), args);
    decision = {
      outcome: 'rolled-back',
      reason: `no improvement (${before.verdict} → ${after.verdict}); restored the original bytes`,
      byteIdentical: rollback.every(r => r.byteIdentical),
      restoredVerdict: restored.verdict,
      restoredMatchesBefore: restored.verdict === before.verdict,
    };
  }

  const status = decision.outcome === 'rolled-back' ? 'FAIL' : after.verdict;
  const report = Object.assign({}, base, {
    status,
    precheck: pre,
    backup: bak.entries.map(e => ({ id: e.id, file: e.file, backup: e.backup, sha256Before: e.sha256Before, bytes: e.bytes })),
    applied,
    before: { verdict: before.verdict, report: 'before/fidelity-validation-report.json' },
    after: { verdict: after.verdict, report: 'after/fidelity-validation-report.json' },
    decision,
    rollback,
    restored: restored ? { verdict: restored.verdict, report: 'restored/fidelity-validation-report.json' } : null,
  });
  writeJson(reportFile, report);

  const schemaRes = schemaLib.validate(readJson(path.join(__dirname, '..', 'schemas', 'repair-report.schema.json')), report);
  if (!schemaRes.valid) {
    console.error(`repair-report violates schemas/repair-report.schema.json:\n${schemaLib.formatErrors(schemaRes.errors).slice(0, 2000)}`);
    return 2;
  }

  console.log(`repair${vpLabel(viewportId)}: ${before.verdict} → ${after.verdict} · ${decision.outcome}`);
  if (rollback) console.log(`  rollback byte-identical: ${decision.byteIdentical} · restored verdict ${restored.verdict}`);
  console.log('report: ' + relPosix(cfg.__dir, reportFile));
  return decision.outcome === 'rolled-back' ? 1 : status === 'PASS' ? 0 : 2;
}

async function cmdSchema(args) {
  const dir = resolveIn(loadConfig(args.project || '.').__dir, '..');
  const schemasDir = path.join(__dirname, '..', 'schemas');
  const files = exists(schemasDir) ? fs.readdirSync(schemasDir).filter(f => f.endsWith('.json')) : [];
  const target = args.file;
  if (!target) { console.log(files.join('\n')); return 0; }
  const sch = readJson(path.join(schemasDir, target));
  const doc = readJson(path.resolve(target));
  const res = schemaLib.validate(sch, doc);
  if (res.valid) { console.log('valid'); return 0; }
  console.error(schemaLib.formatErrors(res.errors));
  return 1;
}

async function cmdDna(args) {
  const extractor = require('../design/dna-extract/extract');
  const outDir = path.resolve(args.out || path.join(__dirname, '..', 'design', 'dna-extract', 'out'));
  const exec = await extractor.extract({ sources: args.sources });
  const schema = require('../schemas/design-dna.schema.json');
  const res = schemaLib.validate(schema, exec.dna);
  const inv = require('../design/lib/dna-invariants').checkDna(exec.dna);
  ensureDir(outDir);
  writeJson(path.join(outDir, 'dna.json'), exec.dna);
  fs.writeFileSync(path.join(outDir, 'dna-summary.md'), extractor.renderMarkdown(exec.dna), 'utf8');
  console.log(`design-dna ${res.valid && inv.ok ? 'VALID' : 'INVALID'} · ${exec.dna.summary.rules} rules → ${outDir}`);
  if (!res.valid) console.error(schemaLib.formatErrors(res.errors).slice(0, 2000));
  for (const v of inv.violations.slice(0, 10)) console.error(`  [${v.code}] ${v.ruleId || '-'} ${v.message}`);
  for (const w of exec.dna.warnings) console.log(`  ! ${w}`);
  return res.valid && inv.ok ? 0 : 1;
}

const KNOWLEDGE_DIR = path.join(__dirname, '..', 'design', 'knowledge', 'ourtrail');
const KB_FILE = path.join(KNOWLEDGE_DIR, 'design-dna.json');
const KB_SCHEMA = require('../schemas/design-dna-kb.schema.json');

function loadKb(file) {
  const target = path.resolve(file || KB_FILE);
  if (!exists(target)) throw new PfError('KB_MISSING', `no design-knowledge store at ${target} (run: pf kb seed)`);
  return { kb: readJson(target), file: target };
}

function checkKbOrThrow(kb, label) {
  const res = schemaLib.validate(KB_SCHEMA, kb);
  const inv = require('../design/knowledge/kb').verifyKb(kb);
  if (!res.valid) throw new PfError('KB_SCHEMA_INVALID', `${label || 'store'} does not satisfy its schema:\n${schemaLib.formatErrors(res.errors).slice(0, 1500)}`);
  if (!inv.ok) {
    throw new PfError('KB_INVARIANT_VIOLATION', `${label || 'store'} breaks its own invariants:\n` +
      inv.violations.slice(0, 10).map(v => `  [${v.code}] ${v.ruleId || '-'} ${v.message}`).join('\n'));
  }
  return { ok: true };
}

function formatRuleLine(r) {
  const scope = r.scope ? `${r.scope.level}${r.scope.pages.length > 1 ? `(${r.scope.pages.length}p)` : ''}` : '?';
  const status = r.confirmation ? r.confirmation.status : '?';
  return `${r.id.padEnd(38)} ${String(r.category).padEnd(11)} ${scope.padEnd(18)} ${String(r.confidence).padEnd(6)} ${status.padEnd(9)} ${r.statement}`;
}

async function cmdKb(args) {
  const kbLib = require('../design/knowledge/kb');
  const sub = args._[0] || 'verify';

  if (sub === 'seed') {
    const dnaFile = path.resolve(args.from || path.join(__dirname, '..', 'design', 'dna-extract', 'out', 'dna.json'));
    if (!exists(dnaFile)) throw new PfError('DNA_MISSING', `no extraction artifact at ${dnaFile} (run: pf dna)`);
    const out = path.resolve(args.out || KB_FILE);
    if (exists(out) && !args.force) {
      throw new PfError('KB_EXISTS', `${out} already exists — seeding would overwrite confirmations with candidates; pass --force only if that is intended`);
    }
    const dna = readJson(dnaFile);
    const kb = kbLib.seedFromDna(dna, {
      id: args.id || 'ourtrail-design-dna',
      title: args.title || 'OurTrail 已确认原型的设计知识（来源：activity-list / activity-detail / weather）',
      at: args.at || isoNow(),
      by: args.by && args.by !== true ? String(args.by) : null,
      note: 'seeded from pf dna',
    });
    checkKbOrThrow(kb, 'seeded store');
    ensureDir(path.dirname(out));
    writeJson(out, kb);
    console.log(`kb seeded · revision ${kb.revision} · ${kb.rules.length} rules · corpus ${kb.corpus.length} files → ${out}`);
    console.log(`  candidates ${kb.rules.filter(r => r.confirmation && r.confirmation.status === 'candidate').length} · confirmed ${kb.rules.filter(r => r.confirmation && r.confirmation.status === 'confirmed').length}`);
    return 0;
  }

  const { kb, file } = loadKb(args.file);

  if (sub === 'query') {
    const rules = kbLib.query(kb, {
      id: args.id, category: args.category, kind: args.kind, confidence: args.confidence,
      level: args.level, page: args.page, family: args.family, status: args.status,
      text: args.text && args.text !== true ? String(args.text) : null,
    });
    if (args.json) { console.log(JSON.stringify(rules, null, 2)); return 0; }
    if (!rules.length) {
      console.log(`no rule matches (store has ${kb.rules.length} rules, revision ${kb.revision})`);
      return 0;
    }
    for (const r of rules.sort((a, b) => a.id.localeCompare(b.id))) console.log(formatRuleLine(r));
    console.log(`\n${rules.length}/${kb.rules.length} rules · revision ${kb.revision} · ${file}`);
    return 0;
  }

  if (sub === 'conflicts') {
    const list = kbLib.findConflicts(kb);
    if (args.json) { console.log(JSON.stringify(list, null, 2)); return list.length ? 1 : 0; }
    if (!list.length) {
      console.log(`no conflicts among ${kb.rules.length} rules (revision ${kb.revision})`);
      return 0;
    }
    for (const c of list) console.log(`[${c.severity}] ${c.code} ${c.ruleIds.join(' vs ')}\n    ${c.detail}`);
    const errors = list.filter(c => c.severity === 'error').length;
    console.log(`\n${list.length} conflicts (${errors} inconsistent, ${list.length - errors} need a decision)`);
    return 1;
  }

  if (sub === 'impact') {
    if (!args.id || args.id === true) throw new PfError('USAGE', 'pf kb impact --id <ruleId>');
    const res = kbLib.impact(kb, String(args.id));
    if (!res.found) throw new PfError('RULE_NOT_FOUND', `no rule "${args.id}" in ${file}`);
    if (args.json) { console.log(JSON.stringify(res, null, 2)); return 0; }
    console.log(`rule      ${res.id}`);
    console.log(`subject   ${res.subject || '-'}`);
    console.log(`pages     ${res.pages.length ? res.pages.join('、') : '-'}`);
    console.log(`components ${res.components.length ? res.components.join('、') : '-'}`);
    if (!res.rules.length) console.log('dependent rules  none — nothing else in the store references this rule');
    else {
      console.log('dependent rules');
      for (const d of res.rules) console.log(`  ${d.id}  (${d.why.join('；')})`);
    }
    return 0;
  }

  if (sub === 'confirm') {
    if (!args.id || args.id === true) throw new PfError('USAGE', 'pf kb confirm --id <ruleId> --by <name>');
    if (!args.by || args.by === true) throw new PfError('USAGE', 'pf kb confirm needs --by <name> — an anonymous confirmation is not a confirmation');
    const current = kb.rules.find(r => r && r.id === args.id);
    if (!current) throw new PfError('RULE_NOT_FOUND', `no rule "${args.id}" in ${file}`);
    const at = args.at && args.at !== true ? String(args.at) : isoNow();
    const status = args.reject ? 'rejected' : 'confirmed';
    const next = Object.assign({}, current, {
      confirmation: { status, by: String(args.by), at },
    });
    const out = kbLib.upsert(kb, next, { at, by: String(args.by), note: args.note && args.note !== true ? String(args.note) : null });
    checkKbOrThrow(out.kb, 'updated store');
    writeJson(file, out.kb);
    console.log(`${status} ${args.id} · revision ${out.change.revision} · fields ${out.change.fields.join(', ')} → ${file}`);
    return 0;
  }

  if (sub === 'verify') {
    checkKbOrThrow(kb, file);
    const stats = kbLib.summarize(kb.rules);
    console.log(`kb VALID · revision ${kb.revision} · ${stats.rules} rules · confirmed ${stats.confirmed} · candidates ${stats.candidates} → ${file}`);
    console.log(`  scope ${JSON.stringify(stats.byScope)} · category ${JSON.stringify(stats.byCategory)}`);
    const dnaFile = args.corpus && args.corpus !== true
      ? path.resolve(String(args.corpus))
      : path.join(__dirname, '..', 'design', 'dna-extract', 'out', 'dna.json');
    if (exists(dnaFile)) {
      // Never compare a store against an extraction it did not come from: that
      // reports every file as added and removed, and reads like "your store is
      // stale" when the truth is "this is another project's corpus".
      const fresh = kbLib.corpusFreshness(kb, readJson(dnaFile));
      if (fresh.status === 'stale') {
        console.log(`  ! store and current extraction disagree on the corpus — changed ${fresh.changed.join('、') || '-'} · added ${fresh.added.join('、') || '-'} · removed ${fresh.removed.join('、') || '-'}`);
      } else if (fresh.status === 'matches') {
        console.log('  corpus matches the current extraction');
      } else if (fresh.status === 'foreign') {
        console.log(`  corpus freshness UNVERIFIED — this store was seeded from ${fresh.stored} file(s), ${dnaFile} shares none of them (pass --corpus <dna.json> from the same project)`);
      } else {
        console.log(`  corpus freshness UNVERIFIED — ${fresh.reason}`);
      }
    } else {
      console.log('  corpus freshness UNVERIFIED — no extraction artifact on disk to compare against');
    }
    const conflicts = kbLib.findConflicts(kb);
    if (conflicts.length) {
      for (const c of conflicts) console.log(`  ✗ [${c.severity}] ${c.code} ${c.ruleIds.join(' vs ')} — ${c.detail}`);
      return 1;
    }
    return 0;
  }

  throw new PfError('USAGE', `unknown kb subcommand "${sub}" (seed|query|conflicts|impact|confirm|verify)`);
}

async function cmdDesign(args) {
  const planLib = require('../design/generalize/plan');
  const render = require('../design/generalize/render');
  const { kb } = loadKb(args.kb);
  if (!args.brief || args.brief === true) {
    throw new PfError('USAGE', 'pf design --brief <brief.json> --out <dir>');
  }
  const briefFile = path.resolve(String(args.brief));
  if (!exists(briefFile)) throw new PfError('BRIEF_MISSING', `no brief at ${briefFile}`);
  const brief = readJson(briefFile);

  const briefErrors = planLib.validateBrief(brief);
  if (briefErrors.length) {
    throw new PfError('BRIEF_INVALID', `brief is not usable:\n  ${briefErrors.join('\n  ')}`, { errors: briefErrors });
  }

  const plan = planLib.buildPlan(kb, brief, { at: args.at && args.at !== true ? String(args.at) : isoNow() });
  const problems = planLib.validatePlan(plan, brief, kb);
  const schemaRes = schemaLib.validate(require('../schemas/design-plan.schema.json'), plan);

  const outDir = path.resolve(args.out || path.join(path.dirname(briefFile), 'design-out'));
  ensureDir(outDir);
  writeJson(path.join(outDir, 'design-plan.json'), plan);
  fs.writeFileSync(path.join(outDir, 'index.html'), render.renderHtml(plan), 'utf8');
  fs.writeFileSync(path.join(outDir, 'design-spec.md'), render.renderMarkdown(plan), 'utf8');
  writeJson(path.join(outDir, 'design-decisions.json'), render.renderDecisions(plan));

  const s = planLib.summarize(plan);
  const ok = schemaRes.valid && problems.length === 0;
  console.log(`design ${ok ? 'VALID' : 'INVALID'} · ${plan.id} · ${s.sections} 区块 / ${s.functions} 功能 · 已选型 ${s.resolved} · 未取证 ${s.unresolved} · 交互 ${s.interactions} → ${outDir}`);
  console.log(`  rules cited ${new Set(plan.decisions.flatMap(d => d.ruleRefs)).size} · rejected by scope ${s.rejectedRules} · gaps ${plan.gaps.length}`);
  if (!schemaRes.valid) console.error(schemaLib.formatErrors(schemaRes.errors).slice(0, 2000));
  for (const p of problems.slice(0, 10)) console.error(`  [${p.code}] ${p.where} ${p.message}`);
  for (const g of plan.gaps.slice(0, 10)) console.log(`  ! ${g.code} @ ${g.where}`);
  return ok ? 0 : 1;
}

async function cmdReview(args) {
  const reviewLib = require('../design/review/review');
  const { kb } = loadKb(args.kb);
  if (!args.plan || args.plan === true) {
    throw new PfError('USAGE', 'pf review --plan <design-plan.json> [--html <index.html>] [--actor <name> --designer <name>] [--out <dir>]');
  }
  const planFile = path.resolve(String(args.plan));
  if (!exists(planFile)) throw new PfError('PLAN_MISSING', `no design plan at ${planFile}`);
  const plan = readJson(planFile);

  const htmlFile = args.html && args.html !== true
    ? path.resolve(String(args.html))
    : path.join(path.dirname(planFile), 'index.html');
  // A missing artifact is a finding, not a crash: "we could not look" and
  // "we looked and it is fine" must never produce the same report.
  const html = exists(htmlFile) ? fs.readFileSync(htmlFile, 'utf8') : null;

  const str = v => (v && v !== true ? String(v) : null);
  const report = reviewLib.review({
    plan,
    html,
    kb,
    actor: str(args.actor),
    designer: str(args.designer),
    at: str(args.at) || isoNow(),
    htmlName: html ? path.basename(htmlFile) : null,
  });

  const schemaRes = schemaLib.validate(require('../schemas/design-review-report.schema.json'), report);
  const outDir = path.resolve(args.out || path.join(path.dirname(planFile), 'review'));
  ensureDir(outDir);
  writeJson(path.join(outDir, 'design-review-report.json'), report);
  fs.writeFileSync(path.join(outDir, 'review.md'), reviewLib.renderMarkdown(report), 'utf8');

  const s = reviewLib.summarize(report);
  console.log(`review ${s.line} → ${outDir}`);
  console.log(`  ${report.artifacts.html || 'no html'} · actor ${report.actor || '-'} / designer ${report.designer || '-'} · independent ${report.independent ? 'yes' : 'no'}`);
  console.log(`  findings ${report.counts.findings} (critical ${report.counts.critical} / major ${report.counts.major} / minor ${report.counts.minor})`);
  for (const b of s.blockers.slice(0, 10)) console.log(`  ✗ ${b}`);
  if (!schemaRes.valid) {
    console.error(`report violates schemas/design-review-report.schema.json:\n${schemaLib.formatErrors(schemaRes.errors).slice(0, 2000)}`);
    return 2;
  }
  if (report.overall === 'FAIL') return 1;
  return report.overall === 'PASS' ? 0 : 2;
}

function usage() {
  console.log(`pf — prototype fidelity suite

  pf doctor [--json] [--ports 33278,9421]
  pf init --dir <project> [--id yourtrail] [--force]
  pf capture --project <dir> [--page <id>] [--state <id>] [--side prototype|target] [--viewport <id>|all]
  pf contract --project <dir> [--page <id>] [--state <id>] [--viewport <id>|all]
  pf diff --project <dir> [--page <id>] [--state <id>] [--run <id>] [--viewport <id>|all]
  pf validate --project <dir> [--page <id>] [--state <id>] [--run <id>] [--skip-interactions] [--viewport <id>|all]
  pf interactions --project <dir> [--page <id>] [--state <id>] [--run <id>] [--viewport <id>|all]
  pf verify --project <dir> [--page <id>] [--state <id>] [--run <id>] [--viewport <id>|all]
  pf repair --project <dir> [--plan <repair.json>] [--page <id>] [--state <id>] [--viewport <id>]
                                                     有界修复：唯一锚点 → 备份 → 应用 → 复测 → 保留或逐字节回滚
  pf dna [--sources <sources.json>] [--out <dir>]     提取 Design DNA（只读原型）
  pf kb seed [--from <dna.json>] [--out <kb.json>] [--force]   把提取结果存入版本化知识库
  pf kb query [--category|--level|--page|--family|--kind|--status|--id|--text] [--json]
  pf kb conflicts [--json]                            同主题规则是否互相矛盾
  pf kb impact --id <ruleId> [--json]                 这条规则一改，哪些组件/页面要复看
  pf kb confirm --id <ruleId> --by <name> [--note <s>] [--reject]   由人确认/否决
  pf kb verify [--file <kb.json>] [--corpus <dna.json>]  schema + 不变量 + 语料新鲜度
                                                      （--corpus 缺省用本仓库的抽取产物；库与本仓库不同源时会明确说"无法比较"而不是假报陈旧）
  pf design --brief <brief.json> --out <dir> [--kb <kb.json>]   业务结构 → 页面设计（只用库允许的规则）
  pf review --plan <plan.json> [--html <index.html>] [--actor <n> --designer <n>] [--out <dir>]
                                                     独立评审：七维设计 + 评审独立性，逐条给证据与修复

Exit codes: 0 PASS · 1 FAIL · 2 environment/config error or UNVERIFIED.`);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));
  switch (cmd) {
    case 'doctor': return cmdDoctor(args);
    case 'init': return cmdInit(args);
    case 'capture': return cmdCapture(args);
    case 'contract': return cmdContract(args);
    case 'diff': return cmdDiff(args);
    case 'validate': return cmdValidate(args);
    case 'interactions': return cmdInteractions(args);
    case 'verify': return cmdVerify(args);
    case 'repair': return cmdRepair(args);
    case 'dna': return cmdDna(args);
    case 'kb': return cmdKb(args);
    case 'design': return cmdDesign(args);
    case 'review': return cmdReview(args);
    case 'schema': return cmdSchema(args);
    case 'help': case '--help': case '-h': case undefined: usage(); return 0;
    default: usage(); return 2;
  }
}

main().then(code => process.exit(code)).catch(e => {
  if (e instanceof PfError) {
    console.error(`[${e.code}] ${e.message}`);
    if (e.detail) console.error(JSON.stringify(e.detail, null, 2).slice(0, 2000));
    process.exit(2);
  }
  console.error(e && e.stack || e);
  process.exit(2);
});

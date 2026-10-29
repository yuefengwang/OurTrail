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

function captureDir(cfg, pageId, stateId, side) {
  return path.join(cfg.__dir, 'captures', slug(pageId), slug(stateId), side);
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
  const outDir = captureDir(cfg, page.id, state.id, side);
  ensureDir(outDir);

  const probeSelectors = [...new Set([
    ...(page.mappings || []).map(m => (side === 'prototype' ? m.prototypeSelector : m.targetSelector)).filter(Boolean),
    ...(side === 'prototype' ? (page.selectors || []) : (page.targetSelectors || [])),
  ])];

  const common = {
    outDir,
    waitMs: opts.waitMs != null ? Number(opts.waitMs) : sideCfg.waitMs,
    settleMs: sideCfg.settleMs,
    inject: side === 'prototype' ? sideCfg.inject : undefined,
    injectData: side === 'target' ? (state.injectData || opts.injectData) : undefined,
    // A side may declare its own viewport (e.g. a target canvas that is 100 px
    // taller); the comparison still runs on measured rects, so a different
    // *width* is not normalised away — it fails geometry, as it should.
    viewport: sideCfg.viewport || (cfg.prototype && cfg.prototype.viewport) || { width: 390, height: 844 },
    dpr: sideCfg.dpr,
    frameSelector: sideCfg.frameSelector || (cfg[side] && cfg[side].frameSelector),
    rootSelector: sideCfg.rootSelector,
    probeSelectors,
    selectors: probeSelectors,
    wsEndpoint: sideCfg.wsEndpoint,
    pagePath: sideCfg.pagePath,
    url: sideCfg.url ? resolveUrl(cfg, sideCfg.url) : null,
    device: sideCfg.device,
  };

  const result = await adapter.capture(common);

  const manifest = artifacts.buildCaptureManifest({
    pageId: page.id,
    stateId: state.id,
    side,
    platform: result.platform,
    adapter: adapter.id,
    url: result.url,
    projectRoot: sideCfg.projectRoot || null,
    codeVersion: opts.codeVersion || sideCfg.codeVersion || gitHead(cfg.__dir),
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
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 4000 }).trim();
  } catch (_) {
    return null;
  }
}

function readCapture(cfg, page, state, side) {
  const dir = captureDir(cfg, page.id, state.id, side);
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

  const components = contract.buildComponents(proto.snapshot, page.components || []);
  const layout = contract.buildPageLayout(proto.snapshot, page.sections || []);

  const outDir = path.join(cfg.__dir, 'contracts', slug(page.id));
  writeJson(path.join(outDir, 'design-tokens.json'), {
    schemaVersion: artifacts.SCHEMA_VERSION, kind: 'design-tokens',
    pageId: page.id, stateId: state.id, generatedAt: isoNow(),
    source: { side: 'prototype', manifest: 'captures/' + slug(page.id) + '/' + slug(state.id) + '/prototype/capture-manifest.json' },
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
  const file = path.join(captureDir(cfg, page.id, state.id, side), 'capture-manifest.json');
  return exists(file) ? readJson(file) : null;
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
    const excused = new Set(accepted.flatMap(x => x.categories || []));
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
      styles: (rec.styles || []).map(s => (excused.has(s.category) ? { ...s, accepted: true } : s)),
      text: rec.text,
      pixel,
      evidence: rec.evidence,
      acceptedDifference: accepted.length ? accepted.map(x => x.reason || 'accepted').join('; ') : null,
      acceptedCategories: [...excused],
      images: {
        prototype: path.join(regionDir, pair.id + '-prototype.png'),
        target: path.join(regionDir, pair.id + '-target.png'),
        diff: path.join(regionDir, pair.id + '-diff.png'),
      },
    };
  });

  const full = null;
  const diffReport = artifacts.buildVisualDiffReport({
    pageId: page.id,
    stateId: state.id,
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
  diffReport.warnings = buildWarnings(cfg, page, state, proto, target, records);
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
  const manifestFile = path.join(cfg.__dir, 'contracts', slug(page.id), 'page-state-manifest.json');
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

async function doInteraction(cfg, page, state, runDir) {
  const spec = page.interactions || [];
  const result = spec.length ? await runInteractionSpec(cfg, page, spec, runDir) : {
    checks: [], status: 'UNVERIFIED', reason: 'no interaction checks declared',
  };
  const contractFile = path.join(cfg.__dir, 'contracts', slug(page.id), 'interaction-contract.json');
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

  const scorecard = score.buildScorecard({
    pairs: diffReport.regions,
    pixel: null,
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

  const validation = artifacts.buildValidationReport({
    pageId: page.id,
    stateId: state.id,
    status: overall,
    reason: overall === 'UNVERIFIED' ? 'some dimensions could not be measured' : null,
    scorecard,
    interaction,
    evidence: [
      'visual-diff-report.json',
      'captures/' + slug(page.id) + '/' + slug(state.id) + '/prototype/capture-manifest.json',
      'captures/' + slug(page.id) + '/' + slug(state.id) + '/target/capture-manifest.json',
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
  const state = pickState(page, args.state);
  const sides = args.side ? [args.side] : ['prototype', 'target'];
  for (const side of sides) {
    if (!['prototype', 'target'].includes(side)) throw new PfError('SIDE_UNKNOWN', `unknown side ${side}`);
    const { result, manifest, outDir } = await doCapture(cfg, page, state, side, args);
    console.log(`${side}: ${manifest.snapshot.nodes} nodes · ${manifest.screenshot.width}×${manifest.screenshot.height}px` +
      (manifest.screenshot.scale ? ` (scale ${round(manifest.screenshot.scale.x, 4)}×${round(manifest.screenshot.scale.y, 4)})` : '') +
      ` · ${relPosix(cfg.__dir, outDir)}`);
    if (!result.screenshotPath) throw new PfError('CAPTURE_NO_SCREENSHOT', `${side} produced no screenshot`);
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
  const state = pickState(page, args.state);
  const res = doContract(cfg, page, state);
  console.log(`tokens: ${Object.entries(res.tokensProto).map(([k, v]) => k + '=' + v.length).join(' ')}`);
  if (res.tokensDiff) {
    for (const [group, d] of Object.entries(res.tokensDiff)) {
      if (d.onlyPrototype.length || d.onlyTarget.length) {
        console.log(`drift ${group}: onlyPrototype=${d.onlyPrototype.length} onlyTarget=${d.onlyTarget.length}`);
      }
    }
  }
  console.log('contracts: ' + relPosix(cfg.__dir, res.outDir));
  return 0;
}

function cmdDiff(args) {
  const cfg = loadConfig(args.project || '.');
  const page = findPage(cfg, args.page);
  const state = pickState(page, args.state);
  const runDir = runDirectory(cfg, page, state, args.run);
  const { diffReport } = doDiff(cfg, page, state, runDir);
  const fail = diffReport.regions.filter(r => r.status === 'FAIL');
  console.log(`${diffReport.regions.length} regions · ${fail.length} failing · verdict ${diffReport.verdict}`);
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
  return diffReport.verdict === 'FAIL' ? 1 : diffReport.verdict === 'PASS' ? 0 : 2;
}

function runDirectory(cfg, page, state, runId) {
  const id = runId || `${slug(page.id)}-${slug(state.id)}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  const dir = path.join(cfg.__dir, 'reports', id);
  ensureDir(dir);
  writeJson(path.join(dir, 'run.json'), {
    schemaVersion: artifacts.SCHEMA_VERSION,
    runId: id, pageId: page.id, stateId: state.id, startedAt: isoNow(),
    project: cfg.project || null,
  });
  return dir;
}

async function cmdValidate(args) {
  const cfg = loadConfig(args.project || '.');
  const page = findPage(cfg, args.page);
  const state = pickState(page, args.state);
  const runDir = args.run ? resolveRun(cfg, args.run) : latestRun(cfg, page, state);
  if (!runDir) throw new PfError('RUN_MISSING', 'no report run found; pass --run or run diff first');
  const res = await doValidate(cfg, page, state, runDir, args);
  console.log(`verdict ${res.overall} · ` + Object.entries(res.scorecard.dimensions).map(([k, d]) => `${k}:${d.verdict}`).join(' '));
  console.log('html: ' + relPosix(cfg.__dir, res.report.file));
  if (res.validation.limitations.length) {
    for (const l of res.validation.limitations) console.log('  ! ' + l);
  }
  return res.overall === 'PASS' ? 0 : res.overall === 'FAIL' ? 1 : 2;
}

function latestRun(cfg, page, state) {
  const root = path.join(cfg.__dir, 'reports');
  if (!exists(root)) return null;
  const dirs = fs.readdirSync(root).filter(d => d.startsWith(slug(page.id) + '-' + slug(state.id) + '-')).sort();
  return dirs.length ? path.join(root, dirs[dirs.length - 1]) : null;
}

async function cmdVerify(args) {
  const cfg = loadConfig(args.project || '.');
  const page = findPage(cfg, args.page);
  const state = pickState(page, args.state);
  const runDir = runDirectory(cfg, page, state, args.run);

  const steps = [];
  for (const side of ['prototype', 'target']) {
    try {
      const { manifest } = await doCapture(cfg, page, state, side, args);
      steps.push({ step: 'capture:' + side, status: 'PASS', detail: `${manifest.snapshot.nodes} nodes` });
    } catch (e) {
      steps.push({ step: 'capture:' + side, status: 'BLOCKED', detail: e.message });
      writeJson(path.join(runDir, 'verify-steps.json'), { steps, verdict: 'BLOCKED' });
      console.error(`${side} capture BLOCKED: ${e.message}`);
      return 2;
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
  writeJson(path.join(runDir, 'verify-steps.json'), { steps, verdict: res.overall });

  for (const s of steps) console.log(`${s.status.padEnd(12)} ${s.step}${s.detail ? ' · ' + s.detail : ''}`);
  console.log(`verdict ${res.overall} · html ${relPosix(cfg.__dir, res.report.file)}`);
  return res.overall === 'PASS' ? 0 : res.overall === 'FAIL' ? 1 : 2;
}

async function cmdInteractions(args) {
  const cfg = loadConfig(args.project || '.');
  const page = findPage(cfg, args.page);
  const state = pickState(page, args.state);
  const runDir = args.run ? resolveRun(cfg, args.run) : runDirectory(cfg, page, state);
  const result = await doInteraction(cfg, page, state, runDir);
  for (const c of result.checks) console.log(`${c.status.padEnd(12)} ${c.id} ${c.title || ''}${c.observed ? ' · ' + c.observed : ''}`);
  console.log(`interaction status ${result.status}${result.reason ? ' · ' + result.reason : ''}`);
  writeJson(path.join(runDir, 'interaction-report.json'), result);
  return result.status === 'PASS' ? 0 : result.status === 'FAIL' ? 1 : 2;
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

function usage() {
  console.log(`pf — prototype fidelity suite

  pf doctor [--json] [--ports 33278,9421]
  pf init --dir <project> [--id yourtrail] [--force]
  pf capture --project <dir> [--page <id>] [--state <id>] [--side prototype|target]
  pf contract --project <dir> [--page <id>] [--state <id>]
  pf diff --project <dir> [--page <id>] [--state <id>] [--run <id>]
  pf validate --project <dir> [--page <id>] [--state <id>] [--run <id>] [--skip-interactions]
  pf interactions --project <dir> [--page <id>] [--state <id>] [--run <id>]
  pf verify --project <dir> [--page <id>] [--state <id>] [--run <id>]

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

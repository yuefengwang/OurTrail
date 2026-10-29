'use strict';
/**
 * Which build did this screenshot show?
 *
 * The v0.1 answer was `gitHead(suiteDir)` — the HEAD of the *suite's* repository.
 * That proves when the capture was taken by a checkout, not which bytes the
 * simulator ran, and a devtools `reLaunch` does not recompile. This module
 * replaces it with content evidence:
 *
 *   fingerprint = sha256 over the sorted `relpath\0sha256` lines of the
 *                 compiled-source tree the capture is *supposed* to show.
 *
 * Two claims become checkable, and both are reported in five state verdicts:
 *   1. ordering    — the fingerprint was computed before the screenshot was taken;
 *   2. stability   — the same tree, hashed again at validate time, still matches.
 *
 * What is NOT claimed: that the simulator compiled this tree. Only a build id
 * emitted by the platform can prove that, and none is available here. A tree is
 * therefore not allowed to turn a comparison green on its own; a mismatch can
 * only ever hold a verdict back to UNVERIFIED.
 */
const fs = require('fs');
const path = require('path');
const { sha256, isoNow } = require('./util');

const DEFAULT_INCLUDE = [
  '.js', '.cjs', '.mjs', '.json', '.ts', '.wxml', '.wxss', '.wxs', '.axml', '.acss',
  '.html', '.css', '.svg', '.vue', '.jsx', '.tsx',
];
const DEFAULT_SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', 'dist', 'build', '.cache']);

function shouldSkipDir(name) {
  return DEFAULT_SKIP_DIRS.has(name);
}

function asList(v) {
  if (v == null) return null;
  return Array.isArray(v) ? v : [v];
}

function includeOf(opts) {
  const list = asList(opts && opts.include) || DEFAULT_INCLUDE;
  return list.map(e => (e.startsWith('.') ? e : '.' + e)).map(e => e.toLowerCase());
}

function walk(root, opts, acc, rel) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch (_) {
    return acc;
  }
  const include = includeOf(opts);
  const exclude = new Set((asList(opts && opts.exclude) || []).map(p => p.split('\\').join('/')));
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const relPath = rel ? rel + '/' + entry.name : entry.name;
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      if (exclude.has(relPath) || exclude.has(relPath + '/')) continue;
      walk(root, opts, acc, relPath);
      continue;
    }
    if (!entry.isFile()) continue;
    if (exclude.has(relPath)) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (include.length && !include.includes(ext)) continue;
    let buf;
    let stat;
    try {
      buf = fs.readFileSync(path.join(root, relPath));
      stat = fs.statSync(path.join(root, relPath));
    } catch (_) {
      continue;
    }
    acc.files.push({ path: relPath, sha256: sha256(buf), bytes: buf.length });
    acc.bytes += buf.length;
    const mtime = stat.mtime.toISOString();
    if (!acc.newestMtime || mtime > acc.newestMtime) acc.newestMtime = mtime;
  }
  return acc;
}

/**
 * Hash a source tree by content. Paths are relative and posix-normalised, so a
 * copy of the same tree in another checkout hashes identically — the fingerprint
 * identifies the build, not the machine.
 */
function fingerprintTree(root, opts) {
  if (!root) return { status: 'UNVERIFIED', reason: 'no root configured', fingerprint: null };
  let stat;
  try {
    stat = fs.statSync(root);
  } catch (_) {
    return { status: 'UNVERIFIED', reason: 'root not found: ' + root, fingerprint: null };
  }
  if (!stat.isDirectory()) return { status: 'UNVERIFIED', reason: 'root is not a directory: ' + root, fingerprint: null };
  const acc = walk(root, opts || {}, { files: [], bytes: 0, newestMtime: null }, '');
  acc.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const digestInput = acc.files.map(f => f.path + '\0' + f.sha256).join('\n');
  return {
    status: acc.files.length ? 'PASS' : 'UNVERIFIED',
    reason: acc.files.length ? null : 'no matching source files under ' + root,
    fingerprint: 'sha256:' + sha256(Buffer.from(digestInput, 'utf8')),
    files: acc.files.length,
    bytes: acc.bytes,
    newestMtime: acc.newestMtime,
    root: path.basename(path.resolve(root)),
    method: 'content-sha256',
  };
}

/**
 * Stored in the capture manifest when the side declares a bundle. It is taken
 * *before* the adapter renders, which is what makes the ordering check honest.
 */
function captureBundle(root, opts) {
  const fp = fingerprintTree(root, opts);
  return {
    fingerprint: fp.fingerprint,
    files: fp.files == null ? null : fp.files,
    bytes: fp.bytes == null ? null : fp.bytes,
    newestMtime: fp.newestMtime || null,
    fingerprintedAt: isoNow(),
    method: fp.method || 'content-sha256',
    root: fp.root || null,
    status: fp.status,
    reason: fp.reason || null,
  };
}

/**
 * Evidence checks for one side. Configured per side:
 *   { "bundle": { "root": "../miniprogram", "include": [".js", ".wxml", ".wxss"] } }
 *
 * Returns [] when the side declares nothing: an unasked question is not a
 * missing measurement, and existing projects must not acquire a new red.
 */
function buildBundleChecks(side, cfgSide, capture, opts) {
  if (!cfgSide || !cfgSide.bundle) return [];
  const decl = cfgSide.bundle === true ? {} : cfgSide.bundle;
  const root = decl.root ? path.resolve((opts && opts.baseDir) || process.cwd(), decl.root) : null;
  const captureBundleRecord = capture && capture.bundle ? capture.bundle : null;
  const checks = [];

  checks.push({
    id: 'bundle:' + side + ':declared',
    title: 'the side declares which source tree it is capturing',
    status: root ? 'PASS' : 'FAIL',
    observed: root ? { root: decl.root } : { root: null },
    detail: root ? 'root ' + decl.root : 'bundle is declared without a root',
  });

  const recorded = !!(captureBundleRecord && captureBundleRecord.fingerprint);
  checks.push({
    id: 'bundle:' + side + ':recorded',
    title: 'the capture records a content fingerprint of that tree',
    status: recorded ? 'PASS' : 'UNVERIFIED',
    observed: recorded ? { fingerprint: captureBundleRecord.fingerprint, files: captureBundleRecord.files } : null,
    detail: recorded ? null : 'the capture carries no fingerprint; nothing can be said about which build it shows',
  });

  // A fingerprint taken after the screenshot describes a tree that may already be
  // different from the one rendered. Order is the whole point, so an unknown
  // timestamp is UNVERIFIED rather than a pass.
  const printedAt = captureBundleRecord && captureBundleRecord.fingerprintedAt;
  const shotAt = capture && capture.capturedAt;
  let ordered = 'UNVERIFIED';
  let orderDetail = 'either the fingerprint or the screenshot has no timestamp';
  if (printedAt && shotAt) {
    const delta = Date.parse(shotAt) - Date.parse(printedAt);
    if (Number.isFinite(delta)) {
      ordered = delta >= 0 ? 'PASS' : 'FAIL';
      orderDetail = delta >= 0
        ? 'fingerprinted ' + delta + ' ms before the screenshot'
        : 'fingerprinted ' + (-delta) + ' ms after the screenshot';
    }
  }
  checks.push({
    id: 'bundle:' + side + ':ordered',
    title: 'the fingerprint existed before the screenshot',
    status: ordered,
    observed: { fingerprintedAt: printedAt || null, capturedAt: shotAt || null },
    detail: orderDetail,
  });

  if (!root) return checks;
  const now = fingerprintTree(root, decl);
  if (now.status !== 'PASS' || !recorded) {
    checks.push({
      id: 'bundle:' + side + ':stable',
      title: 'the declared tree still hashes to the captured fingerprint',
      status: 'UNVERIFIED',
      observed: { captured: captureBundleRecord && captureBundleRecord.fingerprint, current: now.fingerprint },
      detail: now.reason || 'no captured fingerprint to compare against',
    });
    return checks;
  }
  const same = now.fingerprint === captureBundleRecord.fingerprint;
  checks.push({
    id: 'bundle:' + side + ':stable',
    title: 'the declared tree still hashes to the captured fingerprint',
    status: same ? 'PASS' : 'UNVERIFIED',
    observed: {
      captured: captureBundleRecord.fingerprint,
      current: now.fingerprint,
      capturedFiles: captureBundleRecord.files == null ? null : captureBundleRecord.files,
      currentFiles: now.files,
    },
    detail: same
      ? 'tree unchanged since the capture (' + now.files + ' files)'
      : 'the tree changed after the capture; the screenshot may show an earlier build — re-capture before trusting this verdict',
  });
  return checks;
}

module.exports = { fingerprintTree, captureBundle, buildBundleChecks, DEFAULT_INCLUDE };

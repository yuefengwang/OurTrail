'use strict';
/**
 * Q7 — which build did the screenshot show?
 *
 * The point of these assertions is that a fingerprint is *content evidence*: the
 * same bytes in another directory hash the same, one changed byte changes it, and
 * a tree that changed after the capture can only ever hold a verdict back to
 * UNVERIFIED. The ordering check is the one v0.1 could not make at all: a
 * fingerprint taken after the screenshot describes a tree the renderer may never
 * have seen.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const bundle = require('../core/lib/bundle');
const { check, eq, section, finish } = require('./harness');

const roots = [];
function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-bundle-'));
  roots.push(dir);
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
  }
  return dir;
}
const FP = /^sha256:[0-9a-f]{64}$/;

try {
  section('fingerprint is over content, not over location');
  {
    const a = tree({ 'a.js': 'let a = 1;\n', 'b.css': '.b{}\n', 'sub/c.json': '{"c":1}\n', 'skip/x.txt': 'ignored ext\n' });
    // Same files, written in a different order into a different directory.
    const b = tree({ 'sub/c.json': '{"c":1}\n', 'b.css': '.b{}\n', 'a.js': 'let a = 1;\n' });

    const fa = bundle.fingerprintTree(a);
    const fb = bundle.fingerprintTree(b);
    check('a tree with matching source files hashes (PASS)', fa.status === 'PASS', fa);
    eq('files counted are the include-listed ones', fa.files, 3);
    check('fingerprint has the documented shape', FP.test(fa.fingerprint), fa.fingerprint);
    eq('the same bytes in another directory hash identically', fb.fingerprint, fa.fingerprint);
    eq('method is declared, not implied', fa.method, 'content-sha256');

    fs.writeFileSync(path.join(b, 'a.js'), 'let a = 2;\n', 'utf8');
    const changed = bundle.fingerprintTree(b);
    check('one changed byte changes the fingerprint', changed.fingerprint !== fa.fingerprint);
    fs.writeFileSync(path.join(b, 'a.js'), 'let a = 1;\n', 'utf8');
    eq('restoring the byte restores the fingerprint', bundle.fingerprintTree(b).fingerprint, fa.fingerprint);
  }

  section('include / exclude are honoured and expressed in the count');
  {
    const dir = tree({ 'a.js': '1', 'b.css': '2', 'c.html': '3', 'node_modules/dep/index.js': '4' });
    eq('include narrows the tree', bundle.fingerprintTree(dir, { include: ['.js'] }).files, 1);
    eq('node_modules is skipped by default', bundle.fingerprintTree(dir, { include: '.js' }).files, 1);
    eq('exclude removes one file', bundle.fingerprintTree(dir, { exclude: ['b.css'] }).files, 2);
    eq('exclude removes a whole directory', bundle.fingerprintTree(dir, { exclude: ['node_modules/'] }).files, 3);
  }

  section('a tree that cannot be read is UNVERIFIED, never PASS and never FAIL');
  {
    const missing = bundle.fingerprintTree(path.join(os.tmpdir(), 'pf-no-such-tree-xyz'));
    eq('missing root → UNVERIFIED', missing.status, 'UNVERIFIED');
    eq('missing root → no fingerprint', missing.fingerprint, null);
    const empty = tree({ 'notes.txt': 'no source files here' });
    const res = bundle.fingerprintTree(empty);
    eq('no matching files → UNVERIFIED', res.status, 'UNVERIFIED');
    check('…and says why', /no matching source files/.test(res.reason || ''), res.reason);
  }

  section('checks are absent unless the side asks for them');
  {
    eq('no bundle declared → no checks (existing projects gain no new red)',
      bundle.buildBundleChecks('target', {}, { capturedAt: '2026-01-01T00:00:00.000Z' }, {}), []);
    eq('bundle:false → no checks',
      bundle.buildBundleChecks('target', { bundle: false }, {}, {}), []);
  }

  section('declared / recorded / ordered / stable');
  {
    const dir = tree({ 'app.js': 'x', 'app.wxml': 'y' });
    const fp = bundle.captureBundle(dir);
    check('capture records a fingerprint', FP.test(fp.fingerprint || ''), fp.fingerprint);
    eq('capture reports PASS for a readable tree', fp.status, 'PASS');

    const capture = { capturedAt: '2026-01-01T00:00:10.000Z', bundle: fp };
    const checks = bundle.buildBundleChecks('target', { bundle: { root: dir } },
      Object.assign({}, capture, { bundle: Object.assign({}, fp, { fingerprintedAt: '2026-01-01T00:00:05.000Z' }) }), {});
    const by = id => checks.find(c => c.id === id);
    eq('four checks for one declared side', checks.length, 4);
    eq('declared PASS', by('bundle:target:declared').status, 'PASS');
    eq('recorded PASS', by('bundle:target:recorded').status, 'PASS');
    eq('fingerprinted before the screenshot → ordered PASS', by('bundle:target:ordered').status, 'PASS');
    eq('unchanged tree → stable PASS', by('bundle:target:stable').status, 'PASS');

    const late = Object.assign({}, capture, { bundle: Object.assign({}, fp, { fingerprintedAt: '2026-01-01T00:00:20.000Z' }) });
    eq('fingerprinted after the screenshot → ordered FAIL',
      bundle.buildBundleChecks('target', { bundle: { root: dir } }, late, {}).find(c => c.id === 'bundle:target:ordered').status, 'FAIL');

    const noStamp = Object.assign({}, capture, { bundle: Object.assign({}, fp, { fingerprintedAt: null }) });
    eq('no timestamp → ordered UNVERIFIED (an unknown order is not a pass)',
      bundle.buildBundleChecks('target', { bundle: { root: dir } }, noStamp, {}).find(c => c.id === 'bundle:target:ordered').status, 'UNVERIFIED');

    eq('a side that declares bundle without a root is a FAIL (it cannot be measured)',
      bundle.buildBundleChecks('target', { bundle: true }, capture, {}).find(c => c.id === 'bundle:target:declared').status, 'FAIL');
  }

  section('stability has teeth: the tree is re-hashed, not re-quoted');
  {
    const dir = tree({ 'app.js': 'x' });
    const fp = bundle.captureBundle(dir);
    const capture = { capturedAt: '2026-01-01T00:00:10.000Z', bundle: Object.assign({}, fp, { fingerprintedAt: '2026-01-01T00:00:05.000Z' }) };
    const before = bundle.buildBundleChecks('target', { bundle: { root: dir } }, capture, {}).find(c => c.id === 'bundle:target:stable');
    eq('unchanged → PASS', before.status, 'PASS');

    fs.writeFileSync(path.join(dir, 'app.js'), 'y', 'utf8');
    const after = bundle.buildBundleChecks('target', { bundle: { root: dir } }, capture, {}).find(c => c.id === 'bundle:target:stable');
    eq('changed after the capture → UNVERIFIED (never FAIL: a stale tree is missing evidence)', after.status, 'UNVERIFIED');
    check('…and the two fingerprints are both shown so a reviewer can see the drift',
      after.observed.captured !== after.observed.current, after.observed);
    // The related check must not silently pass while the tree is stale.
    const recorded = bundle.buildBundleChecks('target', { bundle: { root: dir } }, capture, {}).find(c => c.id === 'bundle:target:recorded');
    eq('recorded still describes the capture (it did record one)', recorded.status, 'PASS');
  }

  section('an unrecorded capture cannot pretend to be verified');
  {
    const dir = tree({ 'app.js': 'x' });
    const checks = bundle.buildBundleChecks('target', { bundle: { root: dir } },
      { capturedAt: '2026-01-01T00:00:10.000Z', bundle: null }, {});
    eq('recorded → UNVERIFIED', checks.find(c => c.id === 'bundle:target:recorded').status, 'UNVERIFIED');
    eq('stable → UNVERIFIED', checks.find(c => c.id === 'bundle:target:stable').status, 'UNVERIFIED');
  }
} finally {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
}

process.exit(finish('bundle.test'));

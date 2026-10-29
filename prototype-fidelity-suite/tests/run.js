#!/usr/bin/env node
'use strict';
/**
 * Runs every tests/*.test.js in its own process and aggregates the counts each
 * one prints. Child processes keep the suites isolated (one suite's global stub
 * cannot leak into another) and let `&&`-chaining work the same way the host
 * repository's gates do.
 *
 * Exit 0 only when every suite exits 0 AND at least MIN_SUITES ran — a glob that
 * silently matched nothing would otherwise report success.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MIN_SUITES = 11;
const dir = __dirname;

const files = fs.readdirSync(dir)
  .filter(f => f.endsWith('.test.js'))
  .sort();

if (files.length < MIN_SUITES) {
  console.error(`only ${files.length} suites found (expected >= ${MIN_SUITES}) — refusing to report success`);
  process.exit(1);
}

let passed = 0;
let failed = 0;
const rows = [];

for (const file of files) {
  const started = Date.now();
  const res = spawnSync(process.execPath, [path.join(dir, file)], { encoding: 'utf8' });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  const m = /passed=(\d+) failed=(\d+)/.exec(out);
  const summary = !!m;
  const p = m ? Number(m[1]) : 0;
  const f = m ? Number(m[2]) : 0;
  const ok = res.status === 0 && summary && f === 0;
  passed += p;
  // A suite that crashed before printing its counts contributes one failure;
  // otherwise its own count stands.
  failed += ok ? 0 : Math.max(f, 1);
  if (!ok) {
    console.log(`\n--- ${file} (exit ${res.status}) ---`);
    console.log(out.trim());
  }
  rows.push({ file, passed: p, failed: f, exit: res.status, ms: Date.now() - started, ok, summary });
}

console.log('\nsuites:');
for (const r of rows) {
  const status = r.ok ? 'ok  ' : 'FAIL';
  console.log(`  ${status} ${r.file.padEnd(24)} passed=${String(r.passed).padStart(4)} failed=${r.failed} ${String(r.ms).padStart(5)}ms`);
}

console.log(`\ntotal: ${rows.length} suites, passed=${passed} failed=${failed}`);
const broken = rows.filter(r => !r.ok);
if (broken.length) {
  console.log('failing suites: ' + broken.map(r => r.file).join(', '));
  process.exit(1);
}
process.exit(0);

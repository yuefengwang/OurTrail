'use strict';
/**
 * Two failure modes this suite had, both of which produced a verdict no reader
 * could reproduce:
 *
 *   1. a transient Windows lock (antivirus, an open viewer) turned a capture
 *      that could write its snapshot a moment later into "capture BLOCKED";
 *   2. a run directory reused by name kept the *previous* run's PASS report when
 *      the new run aborted before writing one, so the artifacts on disk said
 *      PASS while the process said 2.
 *
 * Neither is allowed to be papered over: a lock that never clears still fails,
 * and a permission error is never retried into a success.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { check, eq, throws, section, finish } = require('./harness');
const util = require('../core/lib/util');
const artifacts = require('../core/lib/artifacts');

function tmpDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pf-write-' + label + '-'));
}

function errno(code) {
  const e = new Error(code + ': simulated');
  e.code = code;
  return e;
}

section('transient write failures are retried, bounded');
{
  // attempt 1 EPERM, 2 UNKNOWN, 3 succeeds.
  const calls = [];
  const codes = ['EPERM', 'UNKNOWN'];
  const file = path.join(tmpDir('retry'), 'artifact.json');
  const res = util.writeFileRetry(file, 'payload', {
    wait: () => {},
    write: (f, d) => {
      calls.push(f);
      const code = codes.shift();
      if (code) throw errno(code);
      fs.writeFileSync(f, d);
    },
  });
  eq('two transient failures then a write succeed', calls.length, 3);
  eq('the number of attempts is reported', res.attempts, 3);
  eq('the bytes really landed on disk', fs.readFileSync(file, 'utf8'), 'payload');
  check('the retry targets the requested file', calls.every(f => f === file), calls);
}

{
  // A lock that never clears is still a failure, after the declared attempts.
  let count = 0;
  throws('a permanent lock fails after the last attempt (it is not swallowed)', () => {
    util.writeFileRetry(path.join(tmpDir('stuck'), 'x.json'), 'x', {
      attempts: 4,
      wait: () => {},
      write: () => { count++; throw errno('EBUSY'); },
    });
  }, 'EBUSY');
  eq('exactly the declared number of attempts were made', count, 4);
}

{
  let count = 0;
  throws('a non-transient error is not retried at all', () => {
    util.writeFileRetry(path.join(tmpDir('fatal'), 'x.json'), 'x', {
      attempts: 5,
      wait: () => {},
      write: () => { count++; throw errno('ENOSPC'); },
    });
  }, 'ENOSPC');
  eq('one attempt only for a permanent error', count, 1);
}

{
  // Backoff is bounded and grows; both are observable through wait().
  const waits = [];
  throws('the always-failing write still throws at the end', () => {
    util.writeFileRetry('ignored', 'x', {
      wait: ms => waits.push(ms),
      write: () => { throw errno('EACCES'); },
    });
  }, 'EACCES');
  check('the first backoff is short', waits[0] === 20, waits);
  check('backoff grows', waits.every((ms, i) => i === 0 || ms >= waits[i - 1]), waits);
  check('backoff stays bounded', waits.every(ms => ms <= 200), waits);
  eq('no wait after the final attempt', waits.length, 4);
}

{
  check('EPERM, EACCES, EBUSY, EAGAIN, UNKNOWN are the retried codes',
    ['EPERM', 'EACCES', 'EBUSY', 'EAGAIN', 'UNKNOWN'].every(c => util.TRANSIENT_WRITE_CODES.has(c)),
    [...util.TRANSIENT_WRITE_CODES]);
  check('ENOENT is not retried (a missing directory is a bug, not a race)',
    !util.TRANSIENT_WRITE_CODES.has('ENOENT'));
}

section('writeJson uses the same path and creates its directory');
{
  const dir = tmpDir('json');
  const file = path.join(dir, 'nested', 'deep', 'report.json');
  util.writeJson(file, { a: 1 });
  eq('writeJson creates missing parents', fs.existsSync(file), true);
  eq('writeJson round-trips', util.readJson(file), { a: 1 });
}

section('a reused run directory cannot inherit the previous verdict');
{
  const dir = tmpDir('run');
  // What a successful run leaves behind.
  for (const name of artifacts.RUN_VERDICT_ARTIFACTS) fs.writeFileSync(path.join(dir, name), 'old');
  // What a run that is not a verdict artifact (captures, notes) must keep.
  fs.writeFileSync(path.join(dir, 'keep-me.txt'), 'user notes');
  const removed = artifacts.clearRunArtifacts(dir);
  eq('every verdict artifact is removed', removed.slice().sort(), artifacts.RUN_VERDICT_ARTIFACTS.slice().sort());
  eq('no verdict artifact survives', artifacts.RUN_VERDICT_ARTIFACTS.filter(n => fs.existsSync(path.join(dir, n))), []);
  eq('unrelated files are untouched', fs.readFileSync(path.join(dir, 'keep-me.txt'), 'utf8'), 'user notes');
}

{
  const dir = tmpDir('empty');
  eq('clearing a directory with nothing in it is not an error', artifacts.clearRunArtifacts(dir), []);
  eq('clearing a directory that does not exist yet is not an error',
    artifacts.clearRunArtifacts(path.join(dir, 'not-created')), []);
}

{
  // The list is the contract: adding a report without adding it here would leave
  // a stale verdict behind, which is exactly the bug this section is about.
  eq('the verdict artifact list names the four reports a verify run writes',
    artifacts.RUN_VERDICT_ARTIFACTS.slice().sort(),
    ['fidelity-validation-report.json', 'report.html', 'verify-steps.json', 'visual-diff-report.json']);
}

process.exit(finish('write-safety.test'));

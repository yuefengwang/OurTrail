'use strict';
/**
 * Hand-rolled test harness, same shape as the host repository's suites: no
 * framework, each file prints its own `passed=N failed=N` and exits non-zero on
 * failure so `&&`-chaining works.
 */
let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) {
    passed++;
    return true;
  }
  failed++;
  const detail = extra === undefined ? '' : '\n      ' + (typeof extra === 'string' ? extra : JSON.stringify(extra));
  failures.push(name + detail);
  console.log(`  ✗ ${name}${detail}`);
  return false;
}

function eq(name, actual, expected) {
  return check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
}

function near(name, actual, expected, tol) {
  const t = tol == null ? 1e-6 : tol;
  return check(name, Math.abs(actual - expected) <= t, { actual, expected, tol: t });
}

function section(title) {
  console.log(`\n· ${title}`);
}

function throws(name, fn, code) {
  try {
    fn();
  } catch (e) {
    if (code && e.code !== code) return check(name, false, `threw ${e.code || e.name}: ${e.message}, expected ${code}`);
    passed++;
    return true;
  }
  return check(name, false, 'did not throw');
}

function totals() {
  return { passed, failed, failures: failures.slice() };
}

function exitCode() {
  return failed ? 1 : 0;
}

function finish(label) {
  console.log(`\n${label ? label + ': ' : ''}passed=${passed} failed=${failed}`);
  if (failed) {
    console.log('failures:');
    for (const f of failures) console.log('  - ' + f.split('\n')[0]);
  }
  return exitCode();
}

module.exports = { check, eq, near, throws, section, totals, finish, exitCode };

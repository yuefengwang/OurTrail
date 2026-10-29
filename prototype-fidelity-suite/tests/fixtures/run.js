'use strict';
/**
 * Independent-fixture runner.
 *
 * This file knows how to *execute* a fixture and how to compare a value with a
 * declared expectation. It deliberately knows nothing about any concrete
 * scenario: no scenario id, command name, field name or expected value appears
 * below except through the fixture files themselves.
 *
 * The suite-level rules it does enforce are structural:
 *   - at least MIN_SCENARIOS scenarios,
 *   - every scenario class covered at least once,
 *   - at least MIN_ADVERSARIAL adversarial scenarios,
 *   - every scenario declares at least one step and at least one check.
 * Those exist so the suite cannot shrink quietly — deleting a fixture, or
 * hollowing one out until it asserts nothing, must fail rather than pass.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SUITE = path.resolve(__dirname, '../..');
const PF = path.join(SUITE, 'cli', 'pf.js');
const FIXTURES = __dirname;

const CLASSES = [
  'rule-extraction',
  'kb-conflict',
  'component-variant',
  'unseen-page',
  'function-preservation',
  'visual-deviation',
  'interaction-state',
  'post-repair-regression',
  'missing-evidence',
];
const MIN_SCENARIOS = 9;
const MIN_ADVERSARIAL = 3;

let passed = 0;
const failures = [];
const notes = [];

function section(t) { console.log('\n## ' + t); }

function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); return true; }
  failures.push(name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail)));
  console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail)));
  return false;
}

// ---------------------------------------------------------------- paths

/** Split `$.a[0].b`, `$[*.x]`… into tokens: `a`, `[0]`, `b`. Returns null on unbalanced input. */
function tokenize(expr) {
  const body = String(expr).replace(/^\$/, '');
  const tokens = [];
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '.') { i++; continue; }
    if (ch === '[') {
      const end = body.indexOf(']', i);
      if (end < 0) return null;
      tokens.push(body.slice(i, end + 1));
      i = end + 1;
      continue;
    }
    let j = i;
    while (j < body.length && body[j] !== '.' && body[j] !== '[') j++;
    tokens.push(body.slice(i, j));
    i = j;
  }
  return tokens;
}

/**
 * JSON path subset: `$`, `$.a.b`, `$.a[0].b`, `$.a[*].b`, and the same forms
 * rooted at an array (`$[0].b`, `$[*].b`) — CLI outputs like `pf kb query
 * --json` are bare arrays, not objects. Returns every value the path selects.
 */
function pick(root, expr) {
  if (!expr || expr === '$') return [root];
  const tokens = tokenize(expr);
  if (!tokens) return [];
  let cur = [root];
  for (const tok of tokens) {
    const next = [];
    if (tok.startsWith('[')) {
      const inner = tok.slice(1, -1);
      for (const c of cur) {
        if (!Array.isArray(c)) continue;
        if (inner === '*') next.push(...c);
        else if (c[Number(inner)] !== undefined) next.push(c[Number(inner)]);
      }
    } else {
      for (const c of cur) {
        if (c !== null && typeof c === 'object' && Object.prototype.hasOwnProperty.call(c, tok)) next.push(c[tok]);
      }
    }
    cur = next;
  }
  return cur;
}

function readMaybeJson(file) {
  const txt = fs.readFileSync(file, 'utf8');
  if (!/\.json$/i.test(file)) return txt;
  return JSON.parse(txt);
}

function isEmpty(v) {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

const MATCHERS = ['equals', 'notEquals', 'exists', 'contains', 'matches', 'minLength', 'length', 'gte', 'lte'];

function evaluate(value, spec) {
  if ('exists' in spec) {
    const present = !isEmpty(value);
    return { ok: present === !!spec.exists, detail: { present, wanted: spec.exists } };
  }
  if ('equals' in spec) {
    const want = JSON.stringify(spec.equals);
    const ok = value.length > 0 && value.every(v => JSON.stringify(v) === want);
    return { ok, detail: { got: value, want: spec.equals } };
  }
  if ('notEquals' in spec) {
    const want = JSON.stringify(spec.notEquals);
    const ok = value.every(v => JSON.stringify(v) !== want);
    return { ok, detail: { got: value, forbidden: spec.notEquals } };
  }
  if ('contains' in spec) {
    const ok = value.some(v => (typeof v === 'string'
      ? v.includes(spec.contains)
      : Array.isArray(v) && v.some(x => JSON.stringify(x) === JSON.stringify(spec.contains))));
    return { ok, detail: { got: value, needle: spec.contains } };
  }
  if ('matches' in spec) {
    let re;
    try { re = new RegExp(spec.matches); } catch (e) { return { ok: false, detail: { badRegex: String(e && e.message) } }; }
    const ok = value.some(v => typeof v === 'string' && re.test(v));
    return { ok, detail: { got: value, pattern: spec.matches } };
  }
  if ('minLength' in spec) {
    const ok = value.some(v => (Array.isArray(v) || typeof v === 'string') && v.length >= spec.minLength);
    return { ok, detail: { got: value.map(v => (v && v.length)), min: spec.minLength } };
  }
  if ('length' in spec) {
    const ok = value.some(v => (Array.isArray(v) || typeof v === 'string') && v.length === spec.length);
    return { ok, detail: { got: value.map(v => (v && v.length)), want: spec.length } };
  }
  if ('gte' in spec) return { ok: value.some(v => typeof v === 'number' && v >= spec.gte), detail: { got: value, gte: spec.gte } };
  if ('lte' in spec) return { ok: value.some(v => typeof v === 'number' && v <= spec.lte), detail: { got: value, lte: spec.lte } };
  return { ok: false, detail: { error: 'check has no matcher', known: MATCHERS } };
}

// ---------------------------------------------------------------- execution

function discover(only) {
  if (!fs.existsSync(FIXTURES)) return [];
  return fs.readdirSync(FIXTURES, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name.startsWith('scenario-'))
    .map(e => ({ dir: path.join(FIXTURES, e.name), name: e.name }))
    .filter(s => !only || s.name.includes(only))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

// A scenario that needs a tool this machine does not have proves nothing here.
// It is recorded BLOCKED — never as a pass — and it does not count toward the
// suite-level coverage gates either, so a starved environment cannot look like a
// complete run. An unknown requirement name is a fixture bug, not a block.
const CAPABILITIES = {
  playwright: () => require('../../core/lib/env').detectPlaywright({ useNpm: false }).status,
  automator: () => require('../../core/lib/env').detectAutomator().status,
  'wechat-devtools': () => require('../../core/lib/env').detectWechatCli().status,
};

function runScenario(scenario, opts) {
  const spec = JSON.parse(fs.readFileSync(path.join(scenario.dir, 'fixture.json'), 'utf8'));
  section(scenario.name + (spec.adversarial ? '  [对抗样本]' : ''));
  if (spec.purpose) console.log('  · ' + spec.purpose);

  const result = { id: spec.id, class: spec.class, adversarial: !!spec.adversarial, steps: [], checks: 0, failed: 0, blocked: false };

  const unknown = (spec.requires || []).filter(name => !CAPABILITIES[name]);
  if (unknown.length) {
    if (!check(`${spec.id} · requires names only known capabilities`, false, { unknown, known: Object.keys(CAPABILITIES) })) result.failed++;
    return result;
  }
  const missing = (spec.requires || []).filter(name => CAPABILITIES[name]() !== 'available');
  if (missing.length) {
    result.blocked = true;
    console.log(`  ⊘ BLOCKED — ${missing.join(', ')} not available; this scenario proves nothing on this machine and is not a pass`);
    return result;
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-fixture-'));
  const root = path.join(work, 'scenario');
  copyTree(scenario.dir, root);

  try {
    (spec.steps || []).forEach((step, i) => {
      const cwd = step.cwd ? path.join(root, step.cwd) : root;
      const res = spawnSync(process.execPath, [PF, ...step.run], { cwd, encoding: 'utf8', timeout: 300000 });
      const out = (res.stdout || '') + (res.stderr || '');
      result.steps.push({ run: step.run, rc: res.status });
      const ok = check(`${spec.id} · step ${i + 1} \`pf ${step.run.join(' ')}\` exits ${step.expectExit}`,
        res.status === step.expectExit, { rc: res.status, tail: out.slice(-400) });
      if (!ok) result.failed++;
      if (step.captureStdout) fs.writeFileSync(path.join(root, step.captureStdout), out, 'utf8');
    });

    for (const c of (spec.checks || [])) {
      result.checks++;
      if ('fileMissing' in c) {
        const missing = !fs.existsSync(path.join(root, c.fileMissing));
        if (!check(`${spec.id} · ${c.fileMissing} is absent`, missing)) result.failed++;
        continue;
      }
      const file = path.join(root, c.file);
      if (!fs.existsSync(file)) {
        if (!check(`${spec.id} · ${c.file} exists`, false)) result.failed++;
        continue;
      }
      let value;
      try { value = pick(readMaybeJson(file), c.path); }
      catch (e) { if (!check(`${spec.id} · ${c.file} parses`, false, String(e && e.message))) result.failed++; continue; }
      const verdict = evaluate(value, c);
      if (!check(`${spec.id} · ${c.file} ${c.path || '$'} ${matcherOf(c)}`, verdict.ok, verdict.detail)) result.failed++;
    }
    return result;
  } finally {
    if (opts.keep) notes.push('kept: ' + work);
    else fs.rmSync(work, { recursive: true, force: true });
  }
}

function matcherOf(c) {
  const k = MATCHERS.find(m => m in c);
  return k ? `${k} ${JSON.stringify(c[k])}` : '(no matcher)';
}

// ---------------------------------------------------------------- main

(() => {
  const argv = process.argv.slice(2);
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
  const keep = argv.includes('--keep');
  const scenarios = discover(only);

  if (argv.includes('--list')) {
    for (const s of scenarios) {
      const spec = JSON.parse(fs.readFileSync(path.join(s.dir, 'fixture.json'), 'utf8'));
      console.log(`${spec.id.padEnd(34)} ${spec.class.padEnd(24)} ${spec.adversarial ? 'adversarial' : ''}`);
    }
    process.exit(0);
  }

  if (!scenarios.length) {
    console.error('no scenario-* directories found' + (only ? ' matching ' + only : ''));
    process.exit(1);
  }

  const results = scenarios.map(s => runScenario(s, { keep }));

  // Only scenarios that actually ran count toward coverage: a blocked scenario
  // proves nothing, so letting it stand in for a class would let an unfinished
  // environment read as a complete suite.
  const blocked = results.filter(r => r.blocked);
  const proof = results.filter(r => !r.blocked);

  section('套件级结构（防止夹具被悄悄删掉）');
  const ids = results.map(r => r.id);
  check(`${MIN_SCENARIOS}+ scenarios that actually ran`, proof.length >= MIN_SCENARIOS,
    { found: proof.length, blocked: blocked.map(r => r.id), need: MIN_SCENARIOS });
  const covered = new Set(proof.map(r => r.class));
  const gaps = CLASSES.filter(c => !covered.has(c));
  check('every scenario class is covered by a scenario that ran', gaps.length === 0, { gaps });
  const adversarial = proof.filter(r => r.adversarial).length;
  check(`${MIN_ADVERSARIAL}+ adversarial scenarios`, adversarial >= MIN_ADVERSARIAL, { found: adversarial, need: MIN_ADVERSARIAL });
  check('scenario ids are unique', new Set(ids).size === ids.length, ids);
  // A scenario that declares no steps proves nothing, and one that declares no
  // checks would pass by being empty — the class-coverage gate above cannot see
  // either, because both keep the scenario's directory and id intact.
  const thin = proof.filter(r => r.checks === 0 || r.steps.length === 0).map(r => r.id);
  check('every scenario declares at least one step and one check', thin.length === 0, { thin });

  const failedScenarios = results.filter(r => r.failed > 0).map(r => r.id);
  console.log(`\n${results.length} scenarios (${proof.length} ran, ${blocked.length} blocked) · ${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) {
    console.log(failedScenarios.length
      ? 'failing scenarios: ' + failedScenarios.join(', ')
      : 'no scenario failed its own checks — a suite-level gate above failed');
    for (const n of notes) console.log(n);
    process.exit(1);
  }
  if (blocked.length) {
    console.log('blocked scenarios: ' + blocked.map(r => r.id).join(', '));
    console.log('BLOCKED — the run is incomplete; a blocked scenario is not a pass');
    for (const n of notes) console.log(n);
    process.exit(2);
  }
  for (const n of notes) console.log(n);
})();

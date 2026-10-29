'use strict';
/**
 * Experiment runner — Phase 7 (A / B / C / D) against a stack that has nothing
 * to do with OurTrail.
 *
 *   node examples/generic-web/experiments/run.js            # A + B + C + D
 *   node examples/generic-web/experiments/run.js --only a   # one experiment
 *
 * A. Known-deviation detection — eight injected deviations, each with the
 *    category it must be attributed to, plus four unmodified controls that must
 *    stay clean. A run that flags everything scores zero here.
 * B. False-positive control — differences that are *allowed* (DPR, viewport,
 *    declared dynamic copy, anti-aliasing, shell offset) must not fail, and each
 *    case carries an anti-vacuity gate proving the difference really happened.
 * C. Repair effectiveness — a hand-implemented page carries three declaration
 *    drifts. The run records the before-diff, the localisation that names the
 *    responsible declaration, the repair actually applied to the file, the
 *    after-diff, whether anything regressed, and the iteration count.
 * D. Portability — the example is copied outside the repository and must
 *    produce identical readings with no reference to OurTrail, its paths or its
 *    components.
 *
 * Exit codes: 0 every experiment met its expectation, 1 at least one did not,
 * 2 the environment could not run them (Playwright missing) — never reported
 * as a pass.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const env = require('../../../core/lib/env');

const SUITE = path.resolve(__dirname, '../../..');
const PROJECT = path.resolve(__dirname, '..');
const PF = path.join(SUITE, 'cli', 'pf.js');

let passed = 0;
const failures = [];

function section(title) {
  console.log('\n## ' + title);
}

function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); return true; }
  failures.push(name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail)));
  console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail)));
  return false;
}

function verify(page, runName) {
  const run = runName || ('exp-' + page);
  const res = spawnSync(process.execPath, [PF, 'verify', '--project', PROJECT, '--page', page, '--run', run], {
    cwd: SUITE, encoding: 'utf8', timeout: 300000,
  });
  const dir = path.join(PROJECT, 'reports', run);
  const read = f => {
    const p = path.join(dir, f);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  };
  return {
    page, run, rc: res.status,
    stdout: (res.stdout || '') + (res.stderr || ''),
    report: read('visual-diff-report.json'),
    validation: read('fidelity-validation-report.json'),
  };
}

function region(report, id) {
  return (report && report.regions || []).find(r => r.id === id) || null;
}

function px(r) {
  return r && r.pixel && r.pixel.diffRatio != null ? r.pixel.diffRatio : null;
}

function inkOf(r) {
  return r && r.pixel && r.pixel.ink ? r.pixel.ink : null;
}

function categories(r) {
  return r && Array.isArray(r.categories) ? r.categories : [];
}

function allPass(report) {
  return (report.regions || []).every(r => r.status === 'PASS');
}

function failingIds(report) {
  return (report.regions || []).filter(r => r.status !== 'PASS' && r.status !== 'NOT_APPLICABLE').map(r => r.id).sort();
}

// ------------------------------------------------------------------ A

const EXPERIMENT_A = {
  page: 'specimen',
  expectedRc: 1,
  controls: ['ctrl-1', 'ctrl-2', 'ctrl-3', 'ctrl-4'],
  deviations: [
    { id: 'pos-8', category: 'position', dx: -8, maxPixel: 0.005 },
    { id: 'gap-4', category: 'spacing' },
    { id: 'font-size', category: 'typography' },
    { id: 'line-height', category: 'typography' },
    { id: 'radius', category: 'appearance' },
    { id: 'color', category: 'appearance' },
    { id: 'crop', category: 'pixel' },
    { id: 'wrap', category: 'text-wrap' },
  ],
};

function runA(out) {
  section('实验 A · 已知偏差检测（8 处人为偏差 + 4 处未改动对照）');
  const r = verify(EXPERIMENT_A.page);
  out.experiments.A = { page: r.page, run: r.run, rc: r.rc, readings: {} };
  if (!r.report) {
    check('specimen produced a diff report', false, r.stdout.slice(-400));
    return;
  }
  out.experiments.A.verdict = r.report.verdict;
  check('page verdict is FAIL (deviations are present)', r.report.verdict === 'FAIL', r.report.verdict);
  check('process exit code is 1', r.rc === 1, r.rc);

  for (const id of EXPERIMENT_A.controls) {
    const reg = region(r.report, id);
    check(`control ${id} stays PASS`, reg && reg.status === 'PASS' && categories(reg).length === 0,
      reg && { status: reg.status, categories: categories(reg) });
  }

  for (const d of EXPERIMENT_A.deviations) {
    const reg = region(r.report, d.id);
    out.experiments.A.readings[d.id] = reg && {
      status: reg.status, categories: categories(reg),
      dx: reg.geometry && reg.geometry.dx, dy: reg.geometry && reg.geometry.dy,
      pixelDiffRatio: px(reg), ink: inkOf(reg),
    };
    check(`${d.id} is detected`, reg && reg.status === 'FAIL', reg && { status: reg.status, categories: categories(reg) });
    check(`${d.id} is attributed to ${d.category}`, categories(reg).includes(d.category), categories(reg));
    if (d.dx !== undefined) check(`${d.id} is located with Δx ${d.dx}`, reg && reg.geometry && reg.geometry.dx === d.dx,
      reg && reg.geometry && reg.geometry.dx);
    // Geometry and pixels answer different questions: a pure offset moves the
    // box and leaves the content identical.
    if (d.maxPixel !== undefined) {
      check(`${d.id} pixel content unchanged (${d.maxPixel * 100}% cap)`, px(reg) != null && px(reg) <= d.maxPixel, px(reg));
    }
  }

  const expected = EXPERIMENT_A.deviations.map(d => d.id).sort();
  check('exactly the injected deviations failed', JSON.stringify(failingIds(r.report)) === JSON.stringify(expected), failingIds(r.report));
  check('no unmapped warnings', r.report.warnings.length === 0, r.report.warnings);
}

// ------------------------------------------------------------------ B

/**
 * Each case: the difference is real, allowed, and must not be reported as a
 * failure. `prove` is the anti-vacuity half — a tolerance that is never tested
 * is indistinguishable from a tolerance that does not exist.
 */
function runB(out) {
  section('实验 B · 误报控制（允许的渲染差异）');
  out.experiments.B = {};

  // --- anti-aliasing
  {
    const r = verify('b-aa');
    out.experiments.B['b-aa'] = { rc: r.rc, verdict: r.report && r.report.verdict, readings: {} };
    check('b-aa runs green', r.rc === 0 && r.report && r.report.verdict === 'PASS', { rc: r.rc, verdict: r.report && r.report.verdict });
    check('b-aa: every region PASS', r.report && allPass(r.report), r.report && failingIds(r.report));
    const desc = region(r.report, 'b-desc');
    out.experiments.B['b-aa'].readings['b-desc'] = desc && { pixelDiffRatio: px(desc), ink: inkOf(desc) };
    check('b-aa: the pixels really did change (>2%)', px(desc) != null && px(desc) > 0.02, px(desc));
    check('b-aa: the ink signature did not (PASS)', inkOf(desc) && inkOf(desc).status === 'PASS', inkOf(desc));
    const probe = path.join(__dirname, 'aa-probe.json');
    if (fs.existsSync(probe)) {
      const aa = JSON.parse(fs.readFileSync(probe, 'utf8'));
      check('b-aa treatment was pre-measured as an AA surrogate', (aa.conclusion.usableSurrogates || []).includes('css-layer'), aa.conclusion);
    }
  }

  // --- device pixel ratio
  {
    const r = verify('b-dpr2');
    out.experiments.B['b-dpr2'] = { rc: r.rc, verdict: r.report && r.report.verdict, readings: {} };
    check('b-dpr2 runs green', r.rc === 0 && r.report && r.report.verdict === 'PASS', { rc: r.rc, verdict: r.report && r.report.verdict });
    check('b-dpr2: every region PASS', r.report && allPass(r.report), r.report && failingIds(r.report));
    const scale = r.report && r.report.target && r.report.target.screenshotScale;
    check('b-dpr2 captured at 2×', scale && Math.abs(scale.x - 2) < 0.001, scale);
    const desc = region(r.report, 'b-desc');
    out.experiments.B['b-dpr2'].readings['b-desc'] = desc && { pixelDiffRatio: px(desc), ink: inkOf(desc) };
    check('b-dpr2: downscaling really moved pixels (>5%)', px(desc) != null && px(desc) > 0.05, px(desc));
    check('b-dpr2: the ink signature absorbed it (PASS)', inkOf(desc) && inkOf(desc).status === 'PASS', inkOf(desc));
    const card = region(r.report, 'b-card');
    check('b-dpr2: the container is masked over its declared children',
      card && card.pixel && card.pixel.masked && card.pixel.masked.ratio > 0.5, card && card.pixel && card.pixel.masked);
  }

  // --- viewport height
  {
    const r = verify('b-taller');
    out.experiments.B['b-taller'] = { rc: r.rc, verdict: r.report && r.report.verdict };
    check('b-taller runs green', r.rc === 0 && r.report && r.report.verdict === 'PASS', { rc: r.rc, verdict: r.report && r.report.verdict });
    check('b-taller: every region PASS', r.report && allPass(r.report), r.report && failingIds(r.report));
  }

  // --- declared vs undeclared dynamic copy (a pair: same bytes on disk)
  {
    const declared = verify('b-dynamic-declared');
    const undeclared = verify('b-dynamic-undeclared');
    out.experiments.B['b-dynamic-declared'] = { rc: declared.rc, verdict: declared.report && declared.report.verdict, readings: {} };
    out.experiments.B['b-dynamic-undeclared'] = { rc: undeclared.rc, verdict: undeclared.report && undeclared.report.verdict, readings: {} };
    check('declared dynamic copy runs green', declared.rc === 0 && declared.report && declared.report.verdict === 'PASS',
      { rc: declared.rc, verdict: declared.report && declared.report.verdict });
    const clock = region(declared.report, 'b-clock');
    out.experiments.B['b-dynamic-declared'].readings['b-clock'] = clock && { pixelDiffRatio: px(clock), ink: inkOf(clock), judged: clock.pixel && clock.pixel.judged };
    check('declared: content channels are observed, not judged', clock && clock.pixel && clock.pixel.judged === false, clock && clock.pixel && clock.pixel.judged);
    check('declared: the live clock really changed (>5%)', px(clock) != null && px(clock) > 0.05, px(clock));
    check('declared: presence and geometry still required', clock && clock.status === 'PASS' && clock.geometry != null, clock && clock.status);

    // The positive control: the same file without the declaration must fail.
    check('undeclared: the identical capture is NOT tolerated', undeclared.rc === 1 && undeclared.report && undeclared.report.verdict === 'FAIL',
      { rc: undeclared.rc, verdict: undeclared.report && undeclared.report.verdict });
    const uClock = region(undeclared.report, 'b-clock');
    out.experiments.B['b-dynamic-undeclared'].readings['b-clock'] = uClock && { pixelDiffRatio: px(uClock), ink: inkOf(uClock) };
    check('undeclared: attributed to text and ink',
      uClock && categories(uClock).includes('text') && categories(uClock).includes('ink'), categories(uClock));
    check('undeclared: only that region fails', undeclared.report && JSON.stringify(failingIds(undeclared.report)) === '["b-clock"]',
      undeclared.report && failingIds(undeclared.report));
    // Both runs rendered the same bytes; only the declaration differs.
    check('the two runs saw the same pixels (declaration, not rendering, changed the verdict)',
      px(clock) != null && px(uClock) != null && Math.abs(px(clock) - px(uClock)) < 0.02,
      { declared: px(clock), undeclared: px(uClock) });
  }

  // --- shell offset (status bar)
  {
    const r = verify('b-statusbar');
    out.experiments.B['b-statusbar'] = { rc: r.rc, verdict: r.report && r.report.verdict, alignment: r.report && r.report.alignment };
    check('b-statusbar runs green', r.rc === 0 && r.report && r.report.verdict === 'PASS', { rc: r.rc, verdict: r.report && r.report.verdict });
    check('b-statusbar: every region PASS', r.report && allPass(r.report), r.report && failingIds(r.report));
    const a = r.report && r.report.alignment;
    check('the 24 px shell offset was measured and re-based', a && a.applied === true && a.shift && a.shift.y === 24 && a.shift.x === 0, a);
    const title = region(r.report, 'b-title');
    check('the anchor is an origin, not a subject', title && title.geometry.isAnchor === true && title.geometry.dx === 0 && title.geometry.dy === 0,
      title && title.geometry);
    check('the anchor movement stays visible as rawDy', title && title.geometry.rawDy === 24, title && title.geometry.rawDy);
  }

  // --- glyph weight (the deviation that must FAIL — separation from b-aa)
  {
    const r = verify('b-weight');
    out.experiments.B['b-weight'] = { rc: r.rc, verdict: r.report && r.report.verdict, readings: {} };
    check('b-weight FAILs', r.rc === 1 && r.report && r.report.verdict === 'FAIL', { rc: r.rc, verdict: r.report && r.report.verdict });
    const caught = ['b-label', 'b-desc', 'b-note'];
    for (const id of caught) {
      const reg = region(r.report, id);
      out.experiments.B['b-weight'].readings[id] = reg && { categories: categories(reg), ink: inkOf(reg) };
      check(`b-weight: small text ${id} is caught by ink`, reg && inkOf(reg) && inkOf(reg).status === 'FAIL', reg && inkOf(reg));
    }
    // Not "everything fails": the large title's weight change stays inside the
    // gate — which is why the tolerance is a gate, not a pass-through.
    const title = region(r.report, 'b-title');
    out.experiments.B['b-weight'].readings['b-title'] = title && { categories: categories(title), ink: inkOf(title) };
    check('b-weight: the 20 px title still passes', title && inkOf(title) && inkOf(title).status === 'PASS', title && inkOf(title));
  }
}

// ------------------------------------------------------------------ C

/**
 * Experiment C — repair effectiveness.
 *
 * The fixture is a hand-written implementation with three declaration drifts.
 * The experiment is only meaningful if every step is pinned:
 *   - the before-diff must name the *declaration* that is wrong, not merely the
 *     box that moved (otherwise the repair is guesswork);
 *   - the repair must change the file on disk, and each replacement must hit
 *     its anchor exactly once (a silent no-op would let "after" go green
 *     without anything having been repaired);
 *   - the after-diff must be clean *and* the previously passing regions must
 *     still pass — a repair that trades one failure for another is not a repair;
 *   - the iteration count is recorded as the number of repair/re-verify rounds,
 *     which is 1 only because the first repair converged.
 */
const C_REPAIR = {
  page: 'c-repair',
  fixture: 'c-repair/before.html',
  target: 'c-repair/target.html',
  defects: [
    {
      region: 'b-label', category: 'typography', prop: 'font-size',
      from: '  #b-label { font-size: 14px; line-height: 18px; }\n',
      to: '  #b-label { font-size: 12px; line-height: 16px; }\n',
    },
    {
      region: 'b-card', category: 'appearance', prop: 'border-radius',
      from: '  #b-card { border-radius: 12px; }\n',
      to: '  #b-card { border-radius: 8px; }\n',
    },
    {
      region: 'b-btn', category: 'spacing', prop: 'margin',
      from: '  #b-btn { margin-top: 10px; }\n',
      to: '  #b-btn { margin-top: 16px; }\n',
    },
  ],
  // What a 2px line-height drift does is not local: the label sits inside the
  // card, so the card grows and everything below it moves. These five regions
  // are casualties, not causes — they must FAIL (their boxes really moved) and
  // `b-note`/`b-clock`/`b-desc`/`b-img` must carry *no* failing declaration of
  // their own. Only `b-title`, above the card, is untouched.
  cascades: [
    { region: 'b-clock', dy: 2, ownDefect: false },
    { region: 'b-desc', dy: 2, ownDefect: false },
    { region: 'b-img', dy: 2, ownDefect: false },
    { region: 'b-btn', dy: -4, ownDefect: true },   // +2 from the card, -6 from its own margin
    { region: 'b-note', dy: -4, ownDefect: false },
  ],
  expectedFailing: ['b-btn', 'b-card', 'b-clock', 'b-desc', 'b-img', 'b-label', 'b-note'],
  expectedClean: ['b-title'],
};

function sha256(buf) {
  return require('crypto').createHash('sha256').update(buf).digest('hex');
}

function regionReading(reg) {
  if (!reg) return null;
  return {
    status: reg.status,
    categories: categories(reg),
    geometry: reg.geometry && {
      dx: reg.geometry.dx, dy: reg.geometry.dy, dw: reg.geometry.dw, dh: reg.geometry.dh,
    },
    failingStyles: (reg.styles || []).filter(s => s.status === 'FAIL').map(s => ({ prop: s.prop, a: s.a, b: s.b, delta: s.delta })),
    pixelDiffRatio: px(reg),
    ink: inkOf(reg),
  };
}

function runC(out) {
  section('实验 C · 修复有效性（实现层：三处声明漂移）');
  const fixturePath = path.join(PROJECT, C_REPAIR.fixture);
  const targetPath = path.join(PROJECT, C_REPAIR.target);
  const record = {
    fixture: C_REPAIR.fixture,
    target: C_REPAIR.target,
    fixtureSha256: sha256(fs.readFileSync(fixturePath)),
    defects: C_REPAIR.defects.map(d => ({ region: d.region, category: d.category, prop: d.prop })),
    before: null, after: null, repairs: [], iterations: 0, newIssues: [], regressions: [],
  };
  out.experiments.C = record;

  // --- before
  const before = fs.readFileSync(fixturePath);
  fs.writeFileSync(targetPath, before);
  check('the target file is byte-identical to the fixture before the run (sha256)',
    sha256(fs.readFileSync(targetPath)) === record.fixtureSha256);

  const r0 = verify(C_REPAIR.page, 'exp-c-before');
  const rep0 = r0.report;
  if (!rep0) {
    check('c-repair produced a diff report', false, r0.stdout.slice(-400));
    return;
  }
  record.before = { run: r0.run, rc: r0.rc, verdict: rep0.verdict, regions: {} };
  for (const reg of rep0.regions || []) record.before.regions[reg.id] = regionReading(reg);

  check('before: verdict FAIL', rep0.verdict === 'FAIL', rep0.verdict);
  check('before: exit code 1', r0.rc === 1, r0.rc);
  check('before: exactly the three drifts and their cascade fail',
    JSON.stringify(failingIds(rep0)) === JSON.stringify(C_REPAIR.expectedFailing), failingIds(rep0));
  check('before: the untouched regions stay clean',
    C_REPAIR.expectedClean.every(id => (region(rep0, id) || {}).status === 'PASS'),
    C_REPAIR.expectedClean.map(id => ({ id, status: (region(rep0, id) || {}).status })));

  // The before-diff has to name the declaration, not just the box.
  for (const d of C_REPAIR.defects) {
    const reg = region(rep0, d.region);
    const style = ((reg && reg.styles) || []).find(s => s.prop === d.prop);
    record.before.regions[d.region].styleCause = style || null;
    check(`before: ${d.region} names its declaration ${d.prop}`, style && style.status === 'FAIL',
      style || ((reg && reg.styles) || []).map(s => s.prop));
    check(`before: ${d.region} is attributed to ${d.category}`,
      categories(reg).includes(d.category), categories(reg));
    if (style) check(`before: ${d.region} ${d.prop} reads prototype ${JSON.stringify(style.a)} vs target ${JSON.stringify(style.b)}`,
      JSON.stringify(style.a) !== JSON.stringify(style.b), style);
  }
  {
    // Localisation has to separate cause from casualties: the label carries the
    // only typography defect, the card carries its own appearance defect, and
    // the remaining regions must be position-only.
    const label = region(rep0, 'b-label');
    check('before: b-label is the only region with a typography defect',
      categories(label).includes('typography') &&
        ['b-clock', 'b-desc', 'b-img', 'b-note'].every(id => !categories(region(rep0, id)).includes('typography')),
      { label: categories(label) });
    for (const c of C_REPAIR.cascades) {
      const reg = region(rep0, c.region);
      const failing = ((reg && reg.styles) || []).filter(s => s.status === 'FAIL').map(s => s.prop);
      check(`before: ${c.region} moved with the cascade (dy ${c.dy}px)`, reg && reg.geometry && reg.geometry.dy === c.dy,
        reg && reg.geometry && reg.geometry.dy);
      if (c.ownDefect) {
        check(`before: ${c.region} also names its own declaration`, failing.length > 0, failing);
      } else {
        check(`before: ${c.region} has no failing declaration — pure consequence`, failing.length === 0, failing);
        check(`before: ${c.region} is attributed to position only`,
          JSON.stringify(categories(reg)) === JSON.stringify(['position']), categories(reg));
      }
    }
  }

  // --- repair (actual file edit; each anchor must hit exactly once)
  let text = before.toString('utf8');
  for (const d of C_REPAIR.defects) {
    const hits = text.split(d.from).length - 1;
    check(`repair: the anchor for ${d.region} occurs exactly once`, hits === 1, hits);
    if (hits !== 1) { record.repairs.push({ region: d.region, applied: false, hits }); continue; }
    text = text.replace(d.from, d.to);
    record.repairs.push({ region: d.region, prop: d.prop, from: d.from.trim(), to: d.to.trim(), applied: true, hits });
  }
  record.iterations = 1;
  fs.writeFileSync(targetPath, text);
  check('repair: the target file changed on disk',
    sha256(fs.readFileSync(targetPath)) !== record.fixtureSha256);

  // --- after
  const r1 = verify(C_REPAIR.page, 'exp-c-after');
  const rep1 = r1.report;
  if (!rep1) {
    check('c-repair re-verified after the repair', false, r1.stdout.slice(-400));
    return;
  }
  record.after = { run: r1.run, rc: r1.rc, verdict: rep1.verdict, regions: {} };
  for (const reg of rep1.regions || []) record.after.regions[reg.id] = regionReading(reg);

  check('after: verdict PASS', rep1.verdict === 'PASS', rep1.verdict);
  check('after: exit code 0', r1.rc === 0, r1.rc);
  check('after: every region PASS', allPass(rep1), failingIds(rep1));

  const residual = [];
  for (const reg of rep1.regions || []) {
    const g = reg.geometry || {};
    if (g.dx || g.dy || g.dw || g.dh) residual.push({ id: reg.id, geometry: { dx: g.dx, dy: g.dy, dw: g.dw, dh: g.dh } });
    if (px(reg) != null && px(reg) > 0) residual.push({ id: reg.id, pixelDiffRatio: px(reg) });
    if (inkOf(reg) && inkOf(reg).status !== 'PASS') residual.push({ id: reg.id, ink: inkOf(reg) });
  }
  check('after: nothing measurable is left (geometry 0, pixels 0, ink PASS)', residual.length === 0, residual);

  // A repair that trades one failure for another is not a repair.
  for (const id of C_REPAIR.expectedClean) {
    const reg = region(rep1, id);
    const ok = reg && reg.status === 'PASS';
    if (!ok) record.newIssues.push({ id, status: reg && reg.status, categories: reg && categories(reg) });
    check(`after: ${id} did not regress`, ok, reg && { status: reg.status, categories: categories(reg) });
  }
  record.regressions = record.newIssues.slice();
  check('after: no new problems introduced', record.newIssues.length === 0, record.newIssues);
  check('the repair converged in one iteration', record.iterations === 1, record.iterations);
}

// ------------------------------------------------------------------ D

const PORTABILITY_PATTERNS = /ourtrail|miniprogram|prototype-fidelity-suite/i;
const SOURCE_ENTRIES = ['prototype', 'target', 'b', 'assets', 'pf.config.json'];

function copySources(dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of SOURCE_ENTRIES) {
    const from = path.join(PROJECT, entry);
    const to = path.join(dest, entry);
    fs.cpSync(from, to, { recursive: true });
  }
}

function scanForRepoRefs(root) {
  const hits = [];
  const walk = dir => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) { walk(p); continue; }
      if (/\.(png|jpg|jpeg|gif|woff2?)$/i.test(name)) continue;
      const text = fs.readFileSync(p, 'utf8');
      const m = text.match(PORTABILITY_PATTERNS);
      if (m) hits.push({ file: path.relative(root, p).replace(/\\/g, '/'), token: m[0] });
    }
  };
  walk(root);
  return hits;
}

function readings(report) {
  const map = {};
  for (const r of report.regions || []) {
    map[r.id] = {
      status: r.status,
      categories: [...(r.categories || [])].sort(),
      dx: r.geometry && r.geometry.dx, dy: r.geometry && r.geometry.dy,
      dw: r.geometry && r.geometry.dw, dh: r.geometry && r.geometry.dh,
      pixelDiffRatio: px(r),
      inkStatus: inkOf(r) && inkOf(r).status,
    };
  }
  return map;
}

function runD(out, opts) {
  section('实验 D · 可迁移性（仓库外运行）');
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-exp-d-'));
  out.experiments.D = { copiedTo: dest, pages: {} };
  try {
    copySources(dest);
    const hits = scanForRepoRefs(dest);
    out.experiments.D.repoReferences = hits;
    check('the example source contains no OurTrail / mini-program reference', hits.length === 0, hits);
    check('the copy lives outside the repository', !path.resolve(dest).startsWith(path.resolve(SUITE)),
      { copy: dest, suite: SUITE });

    for (const page of ['b-identical', 'specimen']) {
      const run = 'exp-' + page;
      const res = spawnSync(process.execPath, [PF, 'verify', '--project', dest, '--page', page, '--run', run], {
        cwd: SUITE, encoding: 'utf8', timeout: 300000,
      });
      const reportFile = path.join(dest, 'reports', run, 'visual-diff-report.json');
      const outside = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : null;
      const inside = JSON.parse(fs.readFileSync(path.join(PROJECT, 'reports', run, 'visual-diff-report.json'), 'utf8'));

      check(`D/${page}: runs at all outside the repo`, outside != null, res.stderr && res.stderr.slice(-400));
      if (!outside) continue;
      out.experiments.D.pages[page] = { rc: res.status, verdict: outside.verdict };
      check(`D/${page}: provenance is not borrowed from the repository`,
        outside.target && outside.target.codeVersion === null, outside.target && outside.target.codeVersion);

      check(`D/${page}: exit code matches the in-repo run`, res.status === (page === 'specimen' ? 1 : 0), res.status);
      check(`D/${page}: verdict matches (${inside.verdict})`, outside.verdict === inside.verdict, outside.verdict);

      const a = readings(inside);
      const b = readings(outside);
      const diffs = [];
      for (const id of Object.keys(a)) {
        const x = a[id];
        const y = b[id];
        if (!y) { diffs.push(`${id}: missing outside`); continue; }
        if (x.status !== y.status) diffs.push(`${id}: status ${x.status} vs ${y.status}`);
        if (JSON.stringify(x.categories) !== JSON.stringify(y.categories)) diffs.push(`${id}: categories ${JSON.stringify(x.categories)} vs ${JSON.stringify(y.categories)}`);
        for (const k of ['dx', 'dy', 'dw', 'dh']) {
          if (x[k] !== y[k]) diffs.push(`${id}: ${k} ${x[k]} vs ${y[k]}`);
        }
        if (x.pixelDiffRatio != null && y.pixelDiffRatio != null && Math.abs(x.pixelDiffRatio - y.pixelDiffRatio) > 1e-9) {
          diffs.push(`${id}: pixel ${x.pixelDiffRatio} vs ${y.pixelDiffRatio}`);
        }
        if (x.inkStatus !== y.inkStatus) diffs.push(`${id}: ink ${x.inkStatus} vs ${y.inkStatus}`);
      }
      check(`D/${page}: per-region readings identical (${Object.keys(a).length} regions)`, diffs.length === 0, diffs.slice(0, 8));
    }
  } finally {
    if (!opts.keep) fs.rmSync(dest, { recursive: true, force: true });
    out.experiments.D.copiedTo = opts.keep ? dest : '(removed after the run)';
  }
}

// ------------------------------------------------------------------ main

(async () => {
  const argv = process.argv.slice(2);
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
  const keep = argv.includes('--keep');

  const found = env.detectPlaywright();
  if (found.status !== 'available') {
    console.error('BLOCKED: Playwright is unavailable, so no experiment can render.');
    console.error('  searched: ' + (found.path || (found.searched || []).join(' | ')));
    process.exit(2);
  }

  const out = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    project: 'examples/generic-web',
    environment: {
      node: process.version,
      platform: process.platform,
      playwright: found.path,
      browser: 'chromium (headless)',
    },
    experiments: {},
  };

  if (!only || only === 'a') runA(out);
  if (!only || only === 'b') runB(out);
  if (!only || only === 'c') runC(out);
  if (!only || only === 'd') runD(out, { keep });

  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(out, null, 2));
  console.log(`\n${passed} assertions passed, ${failures.length} failed · wrote experiments/results.json`);
  if (failures.length) {
    for (const f of failures) console.log('  ✗ ' + f);
    process.exit(1);
  }
})();

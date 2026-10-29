'use strict';
/**
 * Gate for the Design DNA extractor.
 *
 * The interesting half is not "does it produce 128 rules" — it is the set of
 * ways design knowledge can sound authoritative while being wrong, each pinned
 * by a synthetic negative control:
 *
 *   - scope promoted to `global` by counting pages inside a single family
 *     (the brief's explicit "weather-specific design must not become a house
 *     norm" rule),
 *   - a claim with no evidence,
 *   - a rule the extractor marked confirmed on its own,
 *   - a scope that names pages its evidence never touched.
 *
 * Those controls run offline. The live extraction block runs only when
 * Playwright is present; when it is not, its assertions are counted as
 * `skipped` and printed by name — never folded into `passed`.
 */
const fs = require('fs');
const path = require('path');
const { check, eq, section, finish } = require('./harness');
const schema = require('../core/lib/schema');
const { checkDna } = require('../design/lib/dna-invariants');
const extractor = require('../design/dna-extract/extract');
const { detectPlaywright } = require('../core/lib/env');

const ROOT = path.join(__dirname, '..');
const DNA_SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'design-dna.schema.json'), 'utf8'));

let skipped = 0;
const skippedNames = [];
function skip(name) {
  skipped++;
  skippedNames.push(name);
  console.log(`  ⟂ ${name} (skipped — UNVERIFIED, not counted as passed)`);
}

const ruleOf = (over) => Object.assign({
  id: 'demo.rule',
  category: 'token',
  kind: 'measured',
  statement: 'demo',
  value: {},
  evidence: [{ type: 'x', page: 'w1', state: 's1', source: 'rendered node', selector: '.a', prop: 'x', value: '1' }],
  support: { pages: ['w1'], instances: 1 },
  scope: { level: 'page', pages: ['w1'], families: ['weather'], rationale: 'only w1' },
  confidence: 'medium',
  confirmation: { status: 'candidate', by: null, at: null },
  exceptions: [],
}, over);

const artifactsWith = (rules, over) => Object.assign({
  schemaVersion: '0.2.0',
  kind: 'design-dna',
  generatedAt: '2026-10-29T00:00:00.000Z',
  generator: { name: 'design-dna-extractor', version: '0.2.0', sourcesPath: 'x.json' },
  viewport: { width: 390, height: 844 },
  sources: [
    { id: 'w1', family: 'weather', file: 'w.html', root: '#d', states: [{ id: 'a', nodeCount: 1 }], fingerprint: null },
    { id: 'w2', family: 'weather', file: 'w.html', root: '#d', states: [{ id: 'a', nodeCount: 1 }], fingerprint: null },
    { id: 'w3', family: 'weather', file: 'w.html', root: '#d', states: [{ id: 'a', nodeCount: 1 }], fingerprint: null },
    { id: 'a1', family: 'activity', file: 'a.html', root: '#d', states: [{ id: 'a', nodeCount: 1 }], fingerprint: null },
  ],
  fingerprints: { 'w.html': { sha256: '0'.repeat(64), bytes: 1 } },
  coverage: [{ page: 'w1', visibleNodes: 1, inRepeatedComponent: 0, share: 0, singletonSignatures: [], singletonTotal: 1 }],
  summary: { rules: rules.length, byCategory: {}, byScope: {}, byKind: {}, byConfidence: {}, confirmed: 0, candidates: rules.length },
  rules,
  warnings: [],
  boundaries: ['demo'],
}, over);

// ---------------------------------------------------------------------------
section('scope is counted, never judged');
{
  const all = ['p1', 'p2', 'p3'];
  const fams = { p1: 'weather', p2: 'weather', p3: 'weather' };
  const oneFamily = extractor.scopeOf(all, all, fams);
  eq('all pages in one family stay page-family, not global', oneFamily.level, 'page-family');
  check('the rationale says why', /不得据此声称是全局规范/.test(oneFamily.rationale), oneFamily.rationale);

  const twoFamilies = extractor.scopeOf(all, all, { p1: 'weather', p2: 'activity', p3: 'activity' });
  eq('all pages across two families is global', twoFamilies.level, 'global');
  eq('families are reported', twoFamilies.families.slice().sort(), ['activity', 'weather']);

  eq('two pages is page-family', extractor.scopeOf(['p1', 'p2'], all, fams).level, 'page-family');
  eq('one page is page', extractor.scopeOf(['p1'], all, fams).level, 'page');
  check('a single page says it must not be generalised', /不得当作全局规范/.test(extractor.scopeOf(['p1'], all, fams).rationale));

  // The "which pages are missing" sentence only exists on the partial
  // (page-family) branch. A single page is the `page` branch instead, and it
  // must warn about generalisation, not about coverage.
  const all4 = ['p1', 'p2', 'p3', 'p4'];
  const partial = extractor.scopeOf(['p1', 'p2'], all4, { p1: 'weather', p2: 'weather', p3: 'weather', p4: 'weather' });
  eq('partial coverage stays page-family', partial.level, 'page-family');
  check('pages not covered are named', /未覆盖 p3、p4/.test(partial.rationale), partial.rationale);
}

// ---------------------------------------------------------------------------
section('invariants reject the ways knowledge goes wrong');
{
  const clean = artifactsWith([ruleOf()]);
  eq('a well-formed artifact passes', checkDna(clean).violations, []);

  const promoted = artifactsWith([ruleOf({
    id: 'token.weather-only',
    scope: { level: 'global', pages: ['w1', 'w2', 'w3'], families: ['weather'], rationale: 'x' },
    evidence: [
      { type: 'x', page: 'w1', state: 's' }, { type: 'x', page: 'w2', state: 's' }, { type: 'x', page: 'w3', state: 's' },
    ],
  })]);
  const promotedCodes = checkDna(promoted).violations.map(v => v.code);
  check('weather-only rules cannot be global', promotedCodes.includes('GLOBAL_FROM_ONE_FAMILY'), promotedCodes);

  const noEvidence = artifactsWith([ruleOf({ evidence: [] })]);
  check('an evidence-free claim is rejected',
    checkDna(noEvidence).violations.some(v => v.code === 'NO_EVIDENCE'));

  const selfConfirmed = artifactsWith([ruleOf({ confirmation: { status: 'confirmed', by: null, at: null } })]);
  check('self-confirmation without a name is rejected',
    checkDna(selfConfirmed).violations.some(v => v.code === 'UNATTRIBUTED_CONFIRMATION'));

  const danglingScope = artifactsWith([ruleOf({
    scope: { level: 'page-family', pages: ['a1', 'ghost'], families: ['activity'], rationale: 'x' },
    evidence: [{ type: 'x', page: 'a1', state: 's' }],
  })]);
  check('a scope naming a page that was never captured is rejected',
    checkDna(danglingScope).violations.some(v => v.code === 'SCOPE_NAMES_UNKNOWN_PAGE'));

  const unsupportedScope = artifactsWith([ruleOf({
    scope: { level: 'page-family', pages: ['a1', 'w1'], families: ['activity', 'weather'], rationale: 'x' },
    evidence: [{ type: 'x', page: 'a1', state: 's' }],
  })]);
  check('a scope wider than its evidence is rejected',
    checkDna(unsupportedScope).violations.some(v => v.code === 'SCOPE_NOT_BACKED_BY_EVIDENCE'));

  const badSummary = artifactsWith([ruleOf()], { summary: { rules: 9, byCategory: {}, byScope: {}, byKind: {}, byConfidence: {}, confirmed: 0, candidates: 1 } });
  check('a summary that disagrees with the body is rejected',
    checkDna(badSummary).violations.some(v => v.code === 'SUMMARY_MISMATCH'));

  const notDna = artifactsWith([ruleOf()], { kind: 'design-tokens' });
  check('a non-DNA artifact is rejected',
    checkDna(notDna).violations.some(v => v.code === 'WRONG_KIND'));

  check('a null artifact does not throw', checkDna(null).ok === false);
  check('an empty rule list is rejected', checkDna(artifactsWith([])).violations.some(v => v.code === 'NO_RULES'));
}

// ---------------------------------------------------------------------------
section('colour comparison crosses notations');
{
  check('hex equals rgb', extractor.colorEquals('#16783e', 'rgb(22, 120, 62)'));
  check('rgb equals hex with different spacing', extractor.colorEquals('rgb(22,120,62)', '#16783E'));
  check('a different colour is not equal', !extractor.colorEquals('#16783e', 'rgb(22, 120, 63)'));
  check('null is not a colour match', !extractor.colorEquals(null, '#16783e'));
}

// ---------------------------------------------------------------------------
section('component signature ignores state classes');
{
  const byId = new Map();
  const node = (id, tag, classes) => ({ id, tag, classes, parentId: null, flags: {}, dataAttrs: {} });
  const parent = node('n0', 'div', ['activity-card', 'selected']);
  const child = node('n1', 'span', ['card-title', 'active']);
  const bare = node('n2', 'span', []);
  parent.children = ['n1', 'n2'];
  child.parentId = 'n0';
  bare.parentId = 'n0';
  byId.set('n0', parent);
  byId.set('n1', child);
  byId.set('n2', bare);
  eq('state classes are dropped from the signature', extractor.signatureOf(parent, byId), 'div.activity-card');
  // A child with its own class is a component in its own right — the parent is
  // not part of its identity (two cards share the same title part).
  eq('a classed child keeps its own signature', extractor.signatureOf(child, byId), 'span.card-title');
  // A classless child has no identity of its own, so it borrows the parent's
  // prefix; otherwise every bare <span> in the app would share one signature.
  eq('a classless child is qualified by its parent', extractor.signatureOf(bare, byId), 'div.activity-card > span');

  // A node whose only class is a state class has no identity, and with no
  // parent context there is nothing to borrow — it must not become `.active`.
  const lonely = node('n3', 'i', ['active']);
  eq('state classes alone are not an identity', extractor.signatureOf(lonely, new Map([['n3', lonely]])), null);

  // detail.js adds `on-detail` to `.device` while the overlay is open; if that
  // counted as part of the name, the same container would be two components.
  const shell = node('n4', 'div', ['device', 'on-detail']);
  eq('screen-state classes are dropped too', extractor.signatureOf(shell, new Map([['n4', shell]])), 'div.device');
}

// ---------------------------------------------------------------------------
section('markdown renderer states the counts it was given');
{
  const dna = artifactsWith([ruleOf({ id: 'token.demo', statement: '演示规则' })]);
  const md = extractor.renderMarkdown(dna);
  check('the rule id appears', md.includes('token.demo'));
  check('the statement appears', md.includes('演示规则'));
  check('coverage is printed', /w1: 可见节点 1/.test(md), md.slice(0, 400));
  check('the candidate caveat is printed', /候选/.test(md));
}

// ---------------------------------------------------------------------------
const live = detectPlaywright();
section('live extraction (needs Playwright outside the repo)');
if (live.status !== 'available') {
  for (const name of [
    'live: dna.json validates against its schema',
    'live: invariants hold',
    'live: every rule is a candidate',
    'live: no weather-only rule is global',
    'live: every scope page appears in that rule\'s evidence',
    'live: fingerprints are sha256 of every source file',
    'live: page patterns use screen states only and disambiguate repeated roles',
    'live: dialog and toast affordances are found even while hidden',
    'live: coverage share is a real ratio over visible nodes',
  ]) skip(name);
} else {
  const outDir = path.join(require('os').tmpdir(), 'pf-dna-test');
  const exec = require('child_process').spawnSync(process.execPath, [
    path.join(ROOT, 'design', 'dna-extract', 'extract.js'), '--out', outDir, '--quiet',
  ], { encoding: 'utf8' });
  const dnaFile = path.join(outDir, 'dna.json');
  const ok = exec.status === 0 && fs.existsSync(dnaFile);
  if (!check('live: extraction runs', ok, exec.stderr && exec.stderr.slice(0, 800))) {
    // everything below depends on the artifact; print them as skipped rather
    // than letting them fail for the same single reason
    for (const name of ['schema', 'invariants', 'candidate', 'family', 'evidence', 'fingerprints', 'screens', 'affordances', 'coverage']) skip('live: ' + name);
  } else {
    const dna = JSON.parse(fs.readFileSync(dnaFile, 'utf8'));

    const v = schema.validate(DNA_SCHEMA, dna);
    check('live: dna.json validates against its schema', v.valid, v.errors.slice(0, 5));

    const inv = checkDna(dna);
    check('live: invariants hold', inv.ok, inv.violations.slice(0, 5));

    eq('live: every rule is a candidate', dna.rules.filter(r => r.confirmation.status !== 'candidate').length, 0);
    eq('live: summary.confirmed is zero', dna.summary.confirmed, 0);

    const weatherOnlyGlobal = dna.rules.filter(r => r.scope.level === 'global' && r.scope.families.length < 2);
    eq('live: no weather-only rule is global', weatherOnlyGlobal.map(r => r.id), []);

    const unsupported = dna.rules.filter(r => {
      const evPages = new Set(r.evidence.map(e => e.page).filter(Boolean));
      return r.scope.pages.some(p => !evPages.has(p));
    });
    eq('live: every scope page appears in that rule\'s evidence', unsupported.map(r => r.id), []);

    const missingFp = dna.sources.filter(s => !s.fingerprint || !/^[0-9a-f]{64}$/.test(s.fingerprint.sha256));
    eq('live: fingerprints are sha256 of every source file', missingFp.map(s => s.file), []);

    // A page pattern must describe a whole screen; the weather page has two
    // stacked tablists, so repeated roles have to be disambiguated by selector
    // instead of printing "视图切换 → 视图切换".
    const pageRules = dna.rules.filter(r => r.category === 'page' && /个纵向区块/.test(r.statement));
    const ambiguous = pageRules.filter(r => {
      const labels = r.statement.split('，顺序 ')[1] || '';
      const parts = labels.split(' → ');
      return parts.some((p, i) => i > 0 && p === parts[i - 1]);
    });
    check('live: page patterns use screen states only and disambiguate repeated roles',
      pageRules.length > 0 && ambiguous.length === 0,
      { pages: pageRules.length, ambiguous: ambiguous.map(r => r.id) });

    const dialog = dna.rules.find(r => r.id === 'interaction.dialog-sheet');
    const toast = dna.rules.find(r => r.id === 'interaction.status-toast');
    check('live: dialog and toast affordances are found even while hidden',
      !!dialog && !!toast && dialog.evidence.some(e => /visible=false/.test(String(e.value))) === true,
      { dialog: !!dialog, toast: !!toast });

    const shares = dna.coverage.map(c => c.share);
    check('live: coverage share is a real ratio over visible nodes',
      shares.every(s => s > 0 && s <= 1) && dna.coverage.every(c => c.visibleNodes > 0 && c.inRepeatedComponent <= c.visibleNodes),
      dna.coverage.map(c => ({ page: c.page, share: c.share, visible: c.visibleNodes })));
  }
}

// ---------------------------------------------------------------------------
const code = finish('design-dna');
if (skipped) console.log(`skipped=${skipped} (${skippedNames.length} assertions not run — see ⟂ above)`);
process.exit(code);

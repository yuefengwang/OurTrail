'use strict';
/**
 * Gate for the versioned design-knowledge store.
 *
 * The store is the first artifact in this suite that people *edit*, so the
 * failure modes are different from the extractor's: a stale rule quietly
 * outliving its prototype, two rules about the same thing drifting apart, a
 * "confirmed" stamp nobody signed, an revision counter that stops meaning
 * anything, and impact reports that list the whole app because everything
 * shares `#content`.
 *
 * Every section pairs the failure it catches with a positive control — a store
 * that is fine must come back clean, otherwise "no conflicts" could just mean
 * the check never fires.
 */
const fs = require('fs');
const path = require('path');
const { check, eq, throws, section, finish } = require('./harness');
const schema = require('../core/lib/schema');
const kbLib = require('../design/knowledge/kb');

const ROOT = path.join(__dirname, '..');
const KB_SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'design-dna-kb.schema.json'), 'utf8'));
const LIVE_KB = path.join(ROOT, 'design', 'knowledge', 'ourtrail', 'design-dna.json');

const AT = '2026-10-29T00:00:00.000Z';
const SOURCES = [
  { id: 'w1', family: 'weather', file: 'w.html', states: [{ id: 'home' }] },
  { id: 'a1', family: 'activity', file: 'a.html', states: [{ id: 'discover' }] },
];

function rule(over) {
  return Object.assign({
    id: 'token.var.demo',
    category: 'token',
    kind: 'measured',
    statement: '--demo = #123456',
    value: { name: '--demo', resolved: ['#123456'], consumers: { count: 2, selectors: ['.card', '.row'] } },
    evidence: [{ type: 'custom-property', page: 'a1', state: 'discover', source: 'a.html · style.css', selector: ':root', prop: '--demo', value: '#123456' }],
    support: { pages: ['a1'], instances: 1 },
    scope: { level: 'page', pages: ['a1'], families: ['activity'], rationale: 'only a1' },
    confidence: 'high',
    confirmation: { status: 'candidate', by: null, at: null },
    exceptions: [],
  }, over);
}

function store(rules, over) {
  const kb = kbLib.emptyKb({ id: 'test-kb', sources: SOURCES, at: AT });
  for (const r of rules) {
    const res = kbLib.upsert(kb, r, { at: AT, by: 'seed' });
    kb.rules = res.kb.rules;
    kb.revision = res.kb.revision;
    kb.changelog = res.kb.changelog;
  }
  return Object.assign(kb, over || {});
}

const codes = list => list.map(c => c.code).sort();

// ---------------------------------------------------------------------------
section('seeding copies claims without confirming any of them');
{
  const dna = {
    kind: 'design-dna',
    generatedAt: AT,
    sources: SOURCES,
    fingerprints: { 'a.html': { sha256: 'a'.repeat(64), bytes: 10 }, 'w.html': { sha256: 'b'.repeat(64), bytes: 20 } },
    rules: [rule(), rule({ id: 'token.var.demo2', value: { name: '--demo2', resolved: ['#654321'] }, statement: '--demo2 = #654321' })],
  };
  const kb = kbLib.seedFromDna(dna, { at: AT });
  eq('every rule is stored', kb.rules.length, 2);
  eq('revision counts the imports', kb.revision, 2);
  eq('nothing arrives confirmed', kb.rules.filter(r => r.confirmation.status !== 'candidate').length, 0);
  eq('each rule carries provenance', kb.rules.every(r => r.kb && r.kb.updatedAt === AT), true);
  eq('corpus fingerprints are recorded', kb.corpus.map(c => c.file), ['a.html', 'w.html']);
  eq('seeded store verifies', kbLib.verifyKb(kb).violations, []);
  eq('seeded store satisfies its schema', schema.validate(KB_SCHEMA, kb).errors, []);

  const anonymousConfirm = rule({ id: 'token.var.sneaky', confirmation: { status: 'confirmed', by: null, at: AT } });
  throws('a confirmed rule without a name cannot even be seeded',
    () => kbLib.seedFromDna({ kind: 'design-dna', sources: SOURCES, fingerprints: {}, rules: [anonymousConfirm] }, { at: AT }));
}

// ---------------------------------------------------------------------------
section('query answers exactly the question it was asked');
{
  const kb = store([
    rule(),
    rule({ id: 'token.var.other', value: { name: '--other', resolved: ['#ffffff'] }, evidence: [{ type: 'custom-property', page: 'w1', state: 'home', source: 'w.html', selector: ':root' }], scope: { level: 'page', pages: ['w1'], families: ['weather'], rationale: 'w1' } }),
    rule({ id: 'principle.tap', category: 'principle', value: { median: 46 }, statement: '可点区中位数 46px' }),
  ]);
  eq('by id', kbLib.query(kb, { id: 'token.var.other' }).map(r => r.id), ['token.var.other']);
  eq('by page', kbLib.query(kb, { page: 'w1' }).map(r => r.id), ['token.var.other']);
  eq('by family', kbLib.query(kb, { family: 'weather' }).map(r => r.id), ['token.var.other']);
  eq('by category', kbLib.query(kb, { category: 'principle' }).map(r => r.id), ['principle.tap']);
  eq('by status', kbLib.query(kb, { status: 'confirmed' }).length, 0);
  eq('free text reaches the statement', kbLib.query(kb, { text: '46px' }).map(r => r.id), ['principle.tap']);
  eq('an unknown page returns nothing rather than everything', kbLib.query(kb, { page: 'nope' }).length, 0);
}

// ---------------------------------------------------------------------------
section('conflicts are found between claims about the same subject');
{
  const clean = store([rule(), rule({ id: 'token.var.other', value: { name: '--other', resolved: ['#ffffff'] } })]);
  eq('a consistent store reports no conflicts', kbLib.findConflicts(clean), []);

  const values = store([
    rule(),
    rule({ id: 'token.var.demo.again', value: { name: '--demo', resolved: ['#abcdef'] } }),
  ]);
  check('two values for one variable conflict',
    codes(kbLib.findConflicts(values)).includes('VALUE_CONFLICT'), kbLib.findConflicts(values));

  const confirmed = store([
    rule({ confirmation: { status: 'confirmed', by: 'designer', at: AT } }),
    rule({ id: 'token.var.demo.again', value: { name: '--demo', resolved: ['#abcdef'] } }),
  ]);
  check('a candidate contradicting a confirmed rule is called out',
    codes(kbLib.findConflicts(confirmed)).includes('CONTRADICTS_CONFIRMED'), kbLib.findConflicts(confirmed));

  const scope = store([
    rule(),
    rule({ id: 'token.var.demo.wide', scope: { level: 'page-family', pages: ['a1', 'w1'], families: ['activity', 'weather'], rationale: 'x' }, evidence: [{ type: 'x', page: 'a1', state: 's' }, { type: 'x', page: 'w1', state: 's' }] }),
  ]);
  check('the same value with two different scopes needs a decision',
    codes(kbLib.findConflicts(scope)).includes('SCOPE_DISAGREEMENT'), kbLib.findConflicts(scope));

  const dup = store([rule()]);
  dup.rules.push(JSON.parse(JSON.stringify(dup.rules[0])));
  check('the same id twice is an error', codes(kbLib.findConflicts(dup)).includes('DUPLICATE_ID'));

  const outside = store([rule({ evidence: [{ type: 'x', page: 'w1', state: 'home' }, { type: 'x', page: 'a1', state: 'discover' }] })]);
  check('evidence on a page the scope excludes is an error',
    codes(kbLib.findConflicts(outside)).includes('EVIDENCE_OUTSIDE_SCOPE'), kbLib.findConflicts(outside));

  const strayException = store([rule({
    id: 'exception.demo', category: 'exception',
    value: { overrides: [{ selector: '.card', prop: 'padding', pages: ['w1'], declarations: [], winner: { value: '0px' } }] },
    statement: '一条例外',
  })]);
  check('an exception claiming pages outside its own scope is an error',
    codes(kbLib.findConflicts(strayException)).includes('EXCEPTION_OUTSIDE_SCOPE'), kbLib.findConflicts(strayException));

  const scale = store([
    rule({ id: 'token.size.16px', value: { prop: 'font-size', value: '16px', nodes: 10 } }),
    rule({ id: 'token.size.17px', value: { prop: 'font-size', value: '17px', nodes: 3 } }),
  ]);
  eq('two entries of one scale are not a conflict', kbLib.findConflicts(scale), []);
}

// ---------------------------------------------------------------------------
section('updates are versioned and refuse to invent a confirmation');
{
  const kb = store([rule()]);
  const same = kbLib.upsert(kb, rule(), { at: '2026-10-30T00:00:00.000Z', by: 'someone' });
  eq('re-writing an unchanged rule does not bump the revision', same.change.changed, false);
  eq('…and leaves the revision alone', same.kb.revision, kb.revision);

  const changed = kbLib.upsert(kb, rule({ statement: '--demo = #123456（主色）' }), { at: '2026-10-30T00:00:00.000Z', by: 'someone' });
  eq('a real change bumps the revision', changed.change.revision, kb.revision + 1);
  eq('the changelog names the field', changed.change.fields, ['statement']);
  eq('the changelog records who and when', [changed.kb.changelog.at(-1).by, changed.kb.changelog.at(-1).at], ['someone', '2026-10-30T00:00:00.000Z']);

  throws('an update without a timestamp is refused', () => kbLib.upsert(kb, rule(), { by: 'someone' }));
  throws('a confirmation without a name is refused',
    () => kbLib.upsert(kb, rule({ confirmation: { status: 'confirmed', by: null, at: AT } }), { at: AT, by: 'x' }));

  const confirmed = kbLib.upsert(kb, rule({ confirmation: { status: 'confirmed', by: 'designer', at: AT } }), { at: AT, by: 'designer' });
  eq('a signed confirmation is accepted', confirmed.change.action, 'confirm');
  eq('…and lands in the rule', confirmed.kb.rules[0].confirmation.by, 'designer');

  // Pruning must keep the newest by timestamp; array position means nothing once
  // the store has been through a round trip.
  const entries = [
    { revision: 1, at: '2026-01-01T00:00:00.000Z' },
    { revision: 2, at: '2026-03-01T00:00:00.000Z' },
    { revision: 3, at: '2026-02-01T00:00:00.000Z' },
  ];
  eq('pruning keeps the newest by time, not by position',
    kbLib.pruneChangelog(entries, 2).map(e => e.revision), [2, 3]);
}

// ---------------------------------------------------------------------------
section('impact names the components a change actually moves');
{
  const kb = store([
    rule(),
    rule({
      id: 'component.div-card', category: 'component',
      value: { signature: 'div.card', consensus: { padding: '12px' } },
      evidence: [{ type: 'component-instance', page: 'a1', state: 'discover', selector: '.card', prop: 'rect' }],
      statement: 'div.card：padding 12px',
    }),
    rule({
      id: 'component.div-card-span', category: 'component',
      value: { signature: 'div.card > span', consensus: { 'font-size': '12px' } },
      evidence: [{ type: 'component-instance', page: 'a1', state: 'discover', selector: '', prop: 'rect', path: 'div.card>span' }],
      statement: 'div.card 的子部件',
    }),
    rule({
      id: 'component.p.unrelated', category: 'component',
      value: { signature: 'p.elsewhere', consensus: { margin: '0px' } },
      evidence: [{ type: 'component-instance', page: 'w1', state: 'home', selector: '.elsewhere', prop: 'rect' }],
      statement: 'p.elsewhere',
      scope: { level: 'page', pages: ['w1'], families: ['weather'], rationale: 'w1' },
    }),
    rule({
      id: 'exception.demo', category: 'exception',
      value: { overrides: [{ selector: '.card', prop: 'padding', pages: ['a1'], declarations: [], winner: { value: '8px' } }] },
      evidence: [{ type: 'declaration-override', page: 'a1', state: 'discover', selector: '.card', prop: 'padding' }],
      statement: '一条例外',
    }),
  ]);

  const varImpact = kbLib.impact(kb, 'token.var.demo');
  check('a variable names the component that consumes it',
    varImpact.rules.some(d => d.id === 'component.div-card' && /使用了 --demo/.test(d.why.join(''))), varImpact.rules);
  check('…and the exception that overrides a consumer',
    varImpact.rules.some(d => d.id === 'exception.demo'), varImpact.rules);
  check('…and does not drag in an unrelated component',
    !varImpact.rules.some(d => d.id === 'component.p.unrelated'), varImpact.rules);
  eq('affected pages come from the rule itself', varImpact.pages, ['a1']);

  const parent = kbLib.impact(kb, 'component.div-card');
  check('a parent component names its child part',
    parent.rules.some(d => d.id === 'component.div-card-span' && /子部件/.test(d.why.join(''))), parent.rules);
  check('…and the exception measured on the same selector',
    parent.rules.some(d => d.id === 'exception.demo'), parent.rules);

  const leaf = kbLib.impact(kb, 'component.div-card-span');
  check('a child part does not claim its parent depends on it',
    !leaf.rules.some(d => d.id === 'component.div-card'), leaf.rules);

  const missing = kbLib.impact(kb, 'token.var.nope');
  eq('an unknown rule is reported as not found', missing.found, false);

  const proposed = kbLib.impact(kb, 'token.var.demo', {
    scope: { level: 'page-family', pages: ['a1', 'w1'], families: ['activity', 'weather'], rationale: 'proposed' },
  });
  eq('a proposed scope is what gets summarised', proposed.pages, ['a1', 'w1']);
}

// ---------------------------------------------------------------------------
section('the store cannot lose its own bookkeeping');
{
  const kb = store([rule()]);
  eq('a fresh store verifies', kbLib.verifyKb(kb).violations, []);

  const bumped = JSON.parse(JSON.stringify(kb));
  bumped.revision = 99;
  check('a revision that no changelog entry backs is an error',
    kbLib.verifyKb(bumped).violations.some(v => v.code === 'REVISION_MISMATCH'));

  const anonymous = JSON.parse(JSON.stringify(kb));
  delete anonymous.rules[0].kb;
  check('a rule without provenance is an error',
    kbLib.verifyKb(anonymous).violations.some(v => v.code === 'RULE_WITHOUT_PROVENANCE'));

  const promoted = store([rule({
    scope: { level: 'global', pages: ['a1'], families: ['activity'], rationale: 'x' },
  })]);
  check('the store inherits the family guard: one family is never global',
    kbLib.verifyKb(promoted).violations.some(v => v.code === 'GLOBAL_FROM_ONE_FAMILY'), kbLib.verifyKb(promoted).violations);

  const noEvidence = store([rule({ evidence: [] })]);
  check('the store inherits the evidence gate',
    kbLib.verifyKb(noEvidence).violations.some(v => v.code === 'NO_EVIDENCE'));

  const wrong = JSON.parse(JSON.stringify(kb));
  wrong.kind = 'design-dna';
  check('a DNA artifact is not accepted as a store',
    kbLib.verifyKb(wrong).violations.some(v => v.code === 'WRONG_KIND'));
}

// ---------------------------------------------------------------------------
section('a store knows when its corpus moved on');
{
  const kb = store([rule()], { corpus: [{ file: 'a.html', sha256: 'a'.repeat(64), bytes: 10 }] });
  eq('an unchanged corpus is not stale',
    kbLib.staleness(kb, { fingerprints: { 'a.html': { sha256: 'a'.repeat(64) } } }).stale, false);
  const moved = kbLib.staleness(kb, { fingerprints: { 'a.html': { sha256: 'c'.repeat(64) }, 'w.html': { sha256: 'd'.repeat(64) } } });
  eq('a changed corpus is stale', moved.stale, true);
  eq('…an edited file is reported as changed', moved.changed, ['a.html']);
  eq('…a new file is reported as added', moved.added, ['w.html']);
  eq('…and nothing is called removed that is still there', moved.removed, []);
}

// staleness() alone cannot tell "this corpus moved" from "this is a different
// corpus", because both look like every file added and every file removed. A
// store from project A verified against project B's extraction must not be
// reported as stale — that sentence sends the reader to fix a corpus that is fine.
section('a different corpus is not a stale corpus');
{
  const kb = store([rule()], { corpus: [{ file: 'garden.html', sha256: 'a'.repeat(64), bytes: 10 }] });
  const other = { fingerprints: { 'weather.html': { sha256: 'b'.repeat(64) }, 'news.html': { sha256: 'c'.repeat(64) } } };
  eq('the raw comparison does look like a total rewrite', kbLib.staleness(kb, other).stale, true);
  const fresh = kbLib.corpusFreshness(kb, other);
  eq('…but it is reported as foreign, not stale', fresh.status, 'foreign');
  eq('…and it says how many files are on each side', [fresh.stored, fresh.current], [1, 2]);

  const same = kbLib.corpusFreshness(kb, { fingerprints: { 'garden.html': { sha256: 'a'.repeat(64) } } });
  eq('a real match is still a match', same.status, 'matches');
  const edited = kbLib.corpusFreshness(kb, { fingerprints: { 'garden.html': { sha256: 'z'.repeat(64) } } });
  eq('a real edit is still stale', edited.status, 'stale');
  eq('the shared file name proves it is the same corpus', edited.overlap, 1);

  eq('a store with no recorded corpus is not compared at all',
    kbLib.corpusFreshness(store([rule()]), other).status, 'uncompared');
  eq('an artifact with no fingerprints is not compared either',
    kbLib.corpusFreshness(kb, { fingerprints: {} }).status, 'uncompared');
}

// ---------------------------------------------------------------------------
section('the seeded store on disk tells the truth about itself');
if (!fs.existsSync(LIVE_KB)) {
  check('seeded store exists (run: pf kb seed)', false, LIVE_KB);
} else {
  const live = JSON.parse(fs.readFileSync(LIVE_KB, 'utf8'));
  const v = schema.validate(KB_SCHEMA, live);
  check('the store on disk satisfies its schema', v.valid, v.errors.slice(0, 5));
  eq('the store on disk verifies against every invariant', kbLib.verifyKb(live).violations, []);
  check('the store on disk has no conflicts', kbLib.findConflicts(live).length === 0, kbLib.findConflicts(live));
  eq('every stored rule still carries its own provenance', live.rules.every(r => r.kb && r.kb.updatedAt), true);
}

process.exit(finish('knowledge-base'));

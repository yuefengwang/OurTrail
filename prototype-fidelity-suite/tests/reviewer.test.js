'use strict';
/**
 * The reviewer exists because a design agent must not be the one who decides its
 * own design passed. That makes the interesting tests negative ones:
 *
 *  - a clean artifact is only PASS when somebody other than the designer signs,
 *  - anything the reviewer could not look at is UNVERIFIED, never PASS,
 *  - each defect the brief calls out is caught with evidence and a fix,
 *  - the report a reviewer hands over satisfies its own schema.
 *
 * Every injection below changes one thing in an artifact that otherwise passes,
 * so a green assertion means that check is alive rather than that the fixture is
 * lenient.
 */
const fs = require('fs');
const path = require('path');
const { check, eq, section, finish } = require('./harness');
const planLib = require('../design/generalize/plan');
const render = require('../design/generalize/render');
const reviewLib = require('../design/review/review');
const schema = require('../schemas/design-review-report.schema.json');
const schemaLib = require('../core/lib/schema');

const AT = '2026-10-29T00:00:00.000Z';

function rule(id, category, value, over) {
  return Object.assign({
    id,
    category,
    kind: 'measured',
    statement: id,
    value,
    evidence: [{ page: 'x', selector: '.s', prop: 'rect', value: 'x' }],
    support: { pages: ['x'], instances: 6 },
    scope: { level: 'global', pages: ['x'], families: ['library'], rationale: 'fixture' },
    confirmation: { status: 'confirmed', by: 'owner', at: AT },
    exceptions: [],
  }, over || {});
}

const BRIEF = {
  id: 'shelf',
  title: '书架',
  family: null,
  platform: {},
  sections: [
    { id: 'top', role: '页头', surface: 'header', functions: [{ id: 'title', label: '标题', kind: 'display', role: 'text', states: ['default'] }] },
    { id: 'main', role: '列表', surface: 'content', functions: [{ id: 'books', label: '图书', kind: 'list', role: 'list', states: ['default', 'empty'] }] },
    { id: 'act', role: '操作', surface: 'footer', functions: [{ id: 'go', label: '前往', kind: 'action', role: 'button', states: ['default', 'confirming'] }] },
  ],
  interactions: ['confirm-dialog'],
};

function store() {
  return {
    id: 'review-fixture',
    revision: 3,
    corpus: [{ file: 'x.html' }],
    rules: [
      rule('token.var.line', 'token', { name: '--line', resolved: ['#d1d5db'], group: 'color' }),
      rule('component.text-p', 'component', { signature: 'p' }),
      rule('component.button-span', 'component', { signature: 'button > span' }),
      rule('component.list-ul', 'component', { signature: 'ul' }),
      rule('interaction.dialog', 'interaction', {
        dialogs: [{ page: 'x', selector: '#sheet', modal: 'true', tabindex: '-1', visible: false }],
      }),
    ],
  };
}

const KB = store();

function build(kb) {
  const plan = planLib.buildPlan(kb || KB, BRIEF, { at: AT });
  return { plan, html: render.renderHtml(plan), kb: kb || KB };
}

const clone = x => JSON.parse(JSON.stringify(x));

function review(t, over) {
  return reviewLib.review(Object.assign({
    plan: t.plan,
    html: t.html,
    kb: t.kb,
    actor: 'auditor',
    designer: 'builder',
    at: AT,
    htmlName: 'index.html',
  }, over || {}));
}

const dim = (report, id) => report.dimensions.find(d => d.id === id);
const codes = list => list.map(f => f.code);

function validate(report) {
  return schemaLib.validate(schema, report);
}

// ---------------------------------------------------------------------------

section('a clean artifact passes, but only with an independent reviewer');
{
  const t = build();
  const report = review(t);

  const res = validate(report);
  check('the report satisfies its own schema', res.valid, schemaLib.formatErrors(res.errors));
  eq('an untouched fixture has no findings', report.counts.findings, 0);
  eq('and the overall verdict is PASS', report.overall, 'PASS');
  eq('seven design dimensions plus independence', report.dimensions.length, 8);
  eq('the token dimension passes', dim(report, 'tokens').verdict, 'PASS');
  eq('the exceptions dimension is NOT_APPLICABLE when no cited rule carries one', dim(report, 'exceptions').verdict, 'NOT_APPLICABLE');
  check('the reviewer records both people and their independence',
    report.actor === 'auditor' && report.designer === 'builder' && report.independent === true);

  // The one rule this skill exists for: a designer cannot sign its own design.
  const self = review(t, { actor: 'builder' });
  eq('self-review cannot reach PASS', self.overall, 'UNVERIFIED');
  check('self-review says why', /自审/.test(self.reason), self.reason);
  check('the process dimension names the problem', codes(dim(self, 'process').findings).includes('SELF_REVIEW'));
  eq('the process dimension is UNVERIFIED', dim(self, 'process').verdict, 'UNVERIFIED');

  const anon = review(t, { actor: null, designer: null });
  eq('a review with nobody named cannot reach PASS', anon.overall, 'UNVERIFIED');
  check('both missing names are reported', ['NO_REVIEWER', 'NO_DESIGNER'].every(c => codes(dim(anon, 'process').findings).includes(c)));

  // Looking nowhere is not passing.
  const blind = review(t, { html: null });
  eq('no rendered artifact means UNVERIFIED, not PASS', blind.overall, 'UNVERIFIED');
  eq('the artifact size is honest about it', blind.artifacts.bytes, 0);
  for (const id of ['tokens', 'components', 'structure', 'interactions', 'completeness']) {
    eq(`the ${id} dimension cannot be judged without the artifact`, dim(blind, id).verdict, 'UNVERIFIED');
    check(`the ${id} dimension says what it could not look at`, codes(dim(blind, id).findings).includes('NO_RENDERED_ARTIFACT'));
  }
  check('a blind report is still schema-valid', validate(blind).valid);
}

section('the schema rejects a report a reviewer should not hand over');
{
  const report = review(build());
  const noReason = clone(report);
  delete noReason.reason;
  check('a report without a stated reason is invalid', !validate(noReason).valid);

  const badSeverity = clone(report);
  badSeverity.dimensions[0].findings = [{ code: 'X_CODE', where: 'w', severity: 'blocker', evidence: ['e'], fix: 'do it' }];
  badSeverity.counts = { critical: 0, major: 0, minor: 0, findings: 1 };
  check('an unknown severity is invalid', !validate(badSeverity).valid);

  const short = clone(report);
  short.dimensions = short.dimensions.slice(0, 7);
  check('a report that silently drops a dimension is invalid', !validate(short).valid);

  const noEvidence = clone(report);
  noEvidence.dimensions[0].findings = [{ code: 'X_CODE', where: 'w', severity: 'major', evidence: [], fix: 'do it' }];
  noEvidence.counts = { critical: 0, major: 1, minor: 0, findings: 1 };
  check('a finding with no evidence is invalid', !validate(noEvidence).valid);

  const extra = clone(report);
  extra.score = 97;
  check('an aggregate score is not part of the contract', !validate(extra).valid);
}

section('token defects are caught with the name and the line');
{
  const t = build();

  const painted = Object.assign({}, t, { html: t.html.replace('</main>', '<div style="color:#ff0000">x</div>\n</main>') });
  const ungrounded = review(painted);
  check('an invented colour is reported', codes(dim(ungrounded, 'tokens').findings).includes('UNGROUNDED_COLOUR'));
  eq('tokens fail', dim(ungrounded, 'tokens').verdict, 'FAIL');
  eq('and so does the design', ungrounded.overall, 'FAIL');
  const colourFinding = dim(ungrounded, 'tokens').findings.find(f => f.code === 'UNGROUNDED_COLOUR');
  check('the finding points at a line in the artifact', /^html:\d+$/.test(colourFinding.where), colourFinding.where);
  check('the finding quotes the literal', colourFinding.evidence.some(e => e.includes('#ff0000')));

  const ghost = Object.assign({}, t, { html: t.html.replace('</main>', '<div style="color:var(--ghost)">x</div>\n</main>') });
  check('using an undeclared variable is reported', codes(dim(review(ghost), 'tokens').findings).includes('UNDECLARED_VAR'));

  const drifted = Object.assign({}, t, { html: t.html.replace('--line: #d1d5db;', '--line: #000000;') });
  const drift = review(drifted);
  check('a token whose page value differs from the store is reported', codes(dim(drift, 'tokens').findings).includes('TOKEN_VALUE_DRIFT'));
  check('the drift finding shows both values', dim(drift, 'tokens').findings.find(f => f.code === 'TOKEN_VALUE_DRIFT').evidence.some(e => e.includes('#000000')));

  // A hand-edited plan can name a token the page is not allowed to borrow.
  const kb = store();
  kb.rules.push(rule('token.var.accent', 'token', { name: '--accent', resolved: ['#123456'], group: 'color' },
    { scope: { level: 'page', pages: ['x'], families: ['library'], rationale: 'fixture' } }));
  const scoped = build(kb);
  scoped.plan.tokens.variables.push({ name: '--accent', value: '#123456', ruleId: 'token.var.accent', group: 'color', scope: 'page' });
  const illScoped = review(scoped);
  check('a token from a single-screen rule is refused', codes(dim(illScoped, 'tokens').findings).includes('TOKEN_RULE_ILL_SCOPED'));
  check('and the same reference is refused as a cited rule', codes(dim(illScoped, 'rules').findings).includes('RULE_REF_ILL_SCOPED'));
}

section('an unmeasured component may not look measured');
{
  const t = build();
  const silent = clone(t);
  silent.plan.sections[0].functions[0].component = { resolved: false, ruleId: null, signature: null, scope: null, basis: null };
  silent.plan.gaps = silent.plan.gaps.filter(g => !/^ROLE_UNRESOLVED@top\/title$/.test(`${g.code}@${g.where}`));
  const report = review(silent);
  check('a gap that was never recorded is reported', codes(dim(report, 'components').findings).includes('SILENT_UNMEASURED'));
  eq('and it is critical', dim(report, 'components').findings.find(f => f.code === 'SILENT_UNMEASURED').severity, 'critical');

  const kb = store();
  kb.rules.push(rule('component.row-li', 'component', { signature: 'li.book-row' }));
  const swapped = build(kb);
  swapped.plan.sections[1].functions[0].component = { resolved: true, ruleId: 'component.row-li', signature: 'li.book-row', scope: 'global', basis: 'fixture' };
  const notRendered = review(swapped);
  check('a component the page does not render is reported', codes(dim(notRendered, 'components').findings).includes('COMPONENT_NOT_RENDERED'));
  eq('components fail', dim(notRendered, 'components').verdict, 'FAIL');

  const fixed = clone(t);
  fixed.plan.sections[1].functions[0].component = { resolved: true, ruleId: 'component.row-li', signature: 'li.book-row', scope: 'global', basis: 'fixture' };
  check('a component whose rule is absent from the store is reported',
    codes(dim(review(fixed), 'components').findings).includes('COMPONENT_RULE_UNKNOWN'));
}

section('information order is the business order, not the source page order');
{
  const t = build();
  const reversed = clone(t);
  reversed.plan.sections = reversed.plan.sections.slice().reverse();
  const report = review(reversed);
  check('a reordered page is reported', codes(dim(report, 'structure').findings).includes('SECTION_ORDER_DRIFT'));
  eq('structure fails', dim(report, 'structure').verdict, 'FAIL');

  const extraSection = Object.assign({}, t, {
    html: t.html.replace('</main>', '    <section class="section" data-section="ghost" data-surface="content"></section>\n  </main>'),
  });
  check('an invented section is reported', codes(dim(review(extraSection), 'structure').findings).includes('SECTION_INVENTED'));

  const missing = Object.assign({}, t, { html: t.html.replace(/<section class="section" data-section="act"[\s\S]*?<\/section>/, '') });
  check('a missing section is reported', codes(dim(review(missing), 'structure').findings).includes('SECTION_MISSING'));
}

section('interaction contracts are checked on the rendered artifact');
{
  const t = build();

  const noRole = Object.assign({}, t, { html: t.html.replace('<div role="dialog"', '<div role="group"') });
  check('a contract role that is not rendered is reported', codes(dim(review(noRole), 'interactions').findings).includes('INTERACTION_NOT_RENDERED'));

  // The stylesheet may ask for `[role="dialog"]` all it likes; only an element
  // can satisfy the contract, so the reader must not count CSS as rendering.
  const cssOnly = Object.assign({}, t, { html: t.html.replace('<div role="dialog"', '<div role="group"') });
  check('a selector in the stylesheet does not satisfy the contract',
    reviewLib.markupOnly(cssOnly.html).includes('role="dialog"') === false);

  const open = Object.assign({}, t, { html: t.html.replace(' id="dna-confirm" hidden', ' id="dna-confirm"') });
  const openReport = review(open);
  check('a dialog that starts open is reported', codes(dim(openReport, 'interactions').findings).includes('DIALOG_OPEN_BY_DEFAULT'));

  const eatsClicks = Object.assign({}, t, { html: t.html.replace('.overlay[hidden] {\n  display: none;\n}', '') });
  const eatsReport = review(eatsClicks);
  check('a closed overlay that still hit-tests is reported', codes(dim(eatsReport, 'interactions').findings).includes('CLOSED_OVERLAY_HIT_TESTS'));

  const requested = clone(t);
  requested.plan.interactions.push({ name: 'status-feedback', requested: true, resolved: false, ruleId: null, contract: null, scope: null, basis: null });
  requested.plan.gaps.push({ code: 'INTERACTION_UNRESOLVED', where: 'status-feedback', detail: '全库没有可用于本页的 status-feedback 契约' });
  const unmet = review(requested);
  check('an interaction the business asked for and nobody measured is reported', codes(dim(unmet, 'interactions').findings).includes('INTERACTION_UNMET'));
  check('the finding quotes the gap', dim(unmet, 'interactions').findings.find(f => f.code === 'INTERACTION_UNMET').evidence.some(e => /status-feedback/.test(e)));
}

section('no business function may vanish, duplicate, move or appear');
{
  const t = build();

  const gone = Object.assign({}, t, { html: t.html.replace(/<p class="dna-text"[^>]*data-function="title"[^>]*>标题<\/p>\n?/, '') });
  const dropped = review(gone);
  check('a dropped function is reported', codes(dim(dropped, 'completeness').findings).includes('FUNCTION_MISSING'));
  eq('completeness fails', dim(dropped, 'completeness').verdict, 'FAIL');
  check('the finding says which function', dim(dropped, 'completeness').findings.find(f => f.code === 'FUNCTION_MISSING').evidence.some(e => /标题/.test(e)));

  const twice = Object.assign({}, t, { html: t.html.replace('</main>', '      <p class="dna-text" data-function="title" data-states="default">标题</p>\n    </main>') });
  check('a duplicated function is reported', codes(dim(review(twice), 'completeness').findings).includes('FUNCTION_DUPLICATED'));

  const ghostFn = Object.assign({}, t, { html: t.html.replace('</main>', '      <p data-function="not-in-brief">x</p>\n    </main>') });
  check('a function the business never asked for is reported', codes(dim(review(ghostFn), 'completeness').findings).includes('FUNCTION_INVENTED'));

  const stateLost = Object.assign({}, t, { html: t.html.replace('data-states="default empty"', 'data-states="default"') });
  check('a state the page no longer declares is reported', codes(dim(review(stateLost), 'completeness').findings).includes('STATE_NOT_DECLARED'));

  const moved = clone(t);
  moved.html = moved.html.replace('data-function="books"', 'data-function="books"');
  moved.html = moved.html
    .replace(/<ul class="dna-list[^"]*" data-function="books"[\s\S]*?<\/ul>/, '')
    .replace('</section>', '        <ul class="dna-list" data-function="books" data-states="default empty"><li>x</li></ul>\n    </section>');
  const movedReport = review(moved);
  check('a function rendered into another section is reported', codes(dim(movedReport, 'completeness').findings).includes('FUNCTION_MOVED_SECTION'));
}

section('exceptions and constraints are judged, not waved through');
{
  const kb = store();
  kb.rules.push(rule('token.var.ghost', 'token', { name: '--ghost-token', resolved: ['#ffffff'], group: 'color' }, {
    exceptions: [{ note: '该变量未被任何规则引用，只有声明' }],
  }));
  const dead = build(kb);
  dead.plan.tokens.variables.push({ name: '--ghost-token', value: '#ffffff', ruleId: 'token.var.ghost', group: 'color', scope: 'global' });
  const deadReport = review(dead);
  check('a token whose own exception says nothing consumes it is reported', codes(dim(deadReport, 'exceptions').findings).includes('DEAD_TOKEN_CITED'));
  eq('exceptions fail', dim(deadReport, 'exceptions').verdict, 'FAIL');

  const humanKb = store();
  humanKb.rules[1] = rule('component.text-p', 'component', { signature: 'p' }, {
    exceptions: [{ note: '列表页与详情页的行高差 2px，属两屏之间的差异' }],
  });
  const human = build(humanKb);
  const humanReport = review(human);
  check('an exception only a person can judge does not pass by default',
    codes(dim(humanReport, 'exceptions').findings).includes('EXCEPTION_NEEDS_HUMAN'));
  eq('the exceptions dimension is UNVERIFIED', dim(humanReport, 'exceptions').verdict, 'UNVERIFIED');
  eq('and the design cannot reach PASS', humanReport.overall, 'UNVERIFIED');
  check('the exception text is handed to the reader', (dim(humanReport, 'exceptions').items || []).some(i => /行高差/.test(i)));

  const constrained = build();
  constrained.plan.constraints = ['不引入新色值'];
  constrained.html = constrained.html.replace('</main>', '<div style="color:#ff0000">x</div>\n</main>');
  const violated = review(constrained);
  check('a stated business constraint is checked mechanically', codes(dim(violated, 'exceptions').findings).includes('CONSTRAINT_VIOLATED'));
  eq('violating it is critical', dim(violated, 'exceptions').findings.find(f => f.code === 'CONSTRAINT_VIOLATED').severity, 'critical');

  const unknown = build();
  unknown.plan.constraints = ['文案不超过三行'];
  const unknownReport = review(unknown);
  check('a constraint nobody can machine-check is handed to a person, not passed',
    codes(dim(unknownReport, 'exceptions').findings).includes('EXCEPTION_NEEDS_HUMAN'));
  eq('and it leaves the dimension UNVERIFIED', dim(unknownReport, 'exceptions').verdict, 'UNVERIFIED');
}

section('rules: unknown, out of scope, unconfirmed, contradictory');
{
  const t = build();

  const unknownRule = clone(t);
  unknownRule.plan.decisions[0].ruleRefs = ['token.not-in-the-store'];
  check('a decision citing a rule nobody can find is reported', codes(dim(review(unknownRule), 'rules').findings).includes('RULE_REF_UNKNOWN'));

  const kb = store();
  kb.rules[0] = rule('token.var.line', 'token', { name: '--line', resolved: ['#d1d5db'], group: 'color' },
    { confirmation: { status: 'candidate', by: null, at: null } });
  const candidateKb = build(kb);
  const candidate = review(candidateKb);
  check('an unconfirmed rule is named', codes(dim(candidate, 'rules').findings).includes('UNCONFIRMED_RULES'));
  eq('using candidates leaves the rules dimension UNVERIFIED', dim(candidate, 'rules').verdict, 'UNVERIFIED');
  eq('and the design cannot claim PASS', candidate.overall, 'UNVERIFIED');

  const conflicting = store();
  conflicting.rules.push(rule('token.var.tone-a', 'token', { name: '--tone', resolved: ['#111111'], group: 'color' }));
  conflicting.rules.push(rule('token.var.tone-b', 'token', { name: '--tone', resolved: ['#222222'], group: 'color' }));
  const contradiction = build(conflicting);
  contradiction.plan.tokens.variables.push({ name: '--tone', value: '#111111', ruleId: 'token.var.tone-a', group: 'color', scope: 'global' });
  contradiction.plan.tokens.variables.push({ name: '--tone', value: '#222222', ruleId: 'token.var.tone-b', group: 'color', scope: 'global' });
  const report = review(contradiction);
  check('two cited rules that contradict each other are reported',
    codes(dim(report, 'rules').findings).includes('CONFLICTING_RULES_CITED'));
  eq('the contradiction is critical', dim(report, 'rules').findings.find(f => f.code === 'CONFLICTING_RULES_CITED').severity, 'critical');
}

section('the report is the deliverable, not a log line');
{
  const report = review(build());
  const text = reviewLib.renderMarkdown(report);
  for (const id of ['tokens', 'components', 'structure', 'interactions', 'completeness', 'exceptions', 'rules', 'process']) {
    check(`the markdown covers ${id}`, text.includes(reviewLib.DIMENSIONS.find(d => d[0] === id)[1]));
  }
  check('the markdown states the independence of the review', /独立评审：是/.test(text));
  check('the markdown refuses to be a beauty verdict', /不评价好不好看/.test(text));

  const s = reviewLib.summarize(review(build()));
  eq('summarize carries the verdict', s.overall, 'PASS');
  check('summarize carries no score', !('score' in s));

  // Nothing on disk is trusted to exist: the CLI reads the plan, the html and
  // the store; the reviewer itself only ever sees what it was handed.
  const files = fs.readdirSync(path.join(__dirname, '..', 'design', 'review'));
  check('the reviewer is a library plus its fixtures, not a hidden state file',
    files.includes('review.js'), files);
}

process.exit(finish('reviewer.test'));

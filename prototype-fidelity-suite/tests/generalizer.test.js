'use strict';
/**
 * The generalizer is the part of this suite that is most likely to quietly turn
 * into a template engine, so every prohibition in the brief is a positive test
 * here rather than a comment in the implementation:
 *
 *  - no template from page names → the same brief with a different id produces
 *    the same plan,
 *  - no dropped business function → completeness is re-derived from the brief,
 *  - no mechanical copy → every cited rule must be admissible for this page,
 *  - no invented role → unresolved roles are recorded as gaps, not filled.
 */
const fs = require('fs');
const path = require('path');
const { check, eq, section, finish } = require('./harness');
const planLib = require('../design/generalize/plan');
const render = require('../design/generalize/render');
const schema = require('../schemas/design-plan.schema.json');
const schemaLib = require('../core/lib/schema');

const AT = '2026-10-29T00:00:00.000Z';
const KB = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'design', 'knowledge', 'ourtrail', 'design-dna.json'), 'utf8'));

function brief(over) {
  return Object.assign({
    id: 'fixture-shelf',
    title: '书架',
    family: null,
    platform: {},
    sections: [
      { id: 'top', role: '页头', surface: 'header', functions: [{ id: 'title', label: '标题', kind: 'display', role: 'text', states: ['default'] }] },
      { id: 'main', role: '列表', surface: 'content', functions: [{ id: 'rows', label: '图书', kind: 'list', role: 'list', states: ['default', 'empty'] }] },
      { id: 'act', role: '操作', surface: 'footer', functions: [{ id: 'go', label: '前往', kind: 'action', role: 'button', states: ['default', 'confirming'] }] },
    ],
    interactions: ['confirm-dialog'],
  }, over || {});
}

const build = (b, kb) => planLib.buildPlan(kb || KB, b, { at: AT });

// A two-page store: one global rule, one weather-family rule, one page rule.
function store() {
  return {
    id: 'test-store', revision: 7, corpus: [{ file: 'w.html' }, { file: 'a.html' }],
    rules: [
      { id: 'token.var.green', category: 'token', kind: 'measured', statement: '--green', value: { name: '--green', resolved: ['#16783e'], group: 'color' }, evidence: [{ page: 'w', selector: ':root', prop: '--green', value: '#16783e' }], support: { pages: ['w', 'a'], instances: 9 }, scope: { level: 'global', pages: ['w', 'a'], families: ['weather', 'activity'], rationale: 'x' }, confirmation: { status: 'candidate', by: null, at: null }, exceptions: [] },
      { id: 'component.button-span', category: 'component', kind: 'measured', statement: 'button > span', value: { signature: 'button > span' }, evidence: [{ page: 'w', selector: 'button', prop: 'rect', value: 'x' }], support: { pages: ['w', 'a'], instances: 12 }, scope: { level: 'global', pages: ['w', 'a'], families: ['weather', 'activity'], rationale: 'x' }, confirmation: { status: 'candidate', by: null, at: null }, exceptions: [] },
      { id: 'component.div-sky-item', category: 'component', kind: 'measured', statement: 'div.sky-item', value: { signature: 'div.sky-item' }, evidence: [{ page: 'w', selector: '.sky-item', prop: 'rect', value: 'x' }], support: { pages: ['w'], instances: 3 }, scope: { level: 'page', pages: ['w'], families: ['weather'], rationale: 'x' }, confirmation: { status: 'candidate', by: null, at: null }, exceptions: [] },
      { id: 'component.span-icon', category: 'component', kind: 'measured', statement: 'span.icon', value: { signature: 'span.icon' }, evidence: [{ page: 'w', selector: '.icon', prop: 'rect', value: 'x' }], support: { pages: ['w', 'a'], instances: 20 }, scope: { level: 'page-family', pages: ['w', 'a'], families: ['weather'], rationale: 'x' }, confirmation: { status: 'candidate', by: null, at: null }, exceptions: [] },
      { id: 'interaction.dialog-sheet', category: 'interaction', kind: 'measured', statement: 'role=dialog', value: { dialogs: [{ page: 'w', selector: '#sheet', modal: 'true', tabindex: '-1', visible: false }] }, evidence: [{ page: 'w', selector: '#sheet', prop: 'role', value: 'dialog' }], support: { pages: ['w', 'a'], instances: 2 }, scope: { level: 'global', pages: ['w', 'a'], families: ['weather', 'activity'], rationale: 'x' }, confirmation: { status: 'candidate', by: null, at: null }, exceptions: [] },
      { id: 'interaction.tablist', category: 'interaction', kind: 'measured', statement: 'role=tablist', value: { tablists: [{ page: 'w', selector: '.tabs', tabs: ['a'], stateAttr: 'aria-selected' }] }, evidence: [{ page: 'w', selector: '.tabs', prop: 'role', value: 'tablist' }], support: { pages: ['w'], instances: 1 }, scope: { level: 'page-family', pages: ['w'], families: ['weather'], rationale: 'x' }, confirmation: { status: 'candidate', by: null, at: null }, exceptions: [] },
      { id: 'principle.tap-target', category: 'principle', kind: 'measured', statement: '可点区高度中位数 46px', value: {}, evidence: [{ page: 'w', selector: 'button', prop: 'rect', value: '46' }], support: { pages: ['w', 'a'], instances: 40 }, scope: { level: 'global', pages: ['w', 'a'], families: ['weather', 'activity'], rationale: 'x' }, confirmation: { status: 'candidate', by: null, at: null }, exceptions: [] },
    ],
  };
}

const codes = list => list.map(e => e.code);

section('a brief is the page structure, and nothing else is');
{
  eq('a complete brief passes', planLib.validateBrief(brief()), []);
  check('a brief with no sections is refused',
    planLib.validateBrief({ title: 'x', sections: [] }).some(e => /页面结构必须由业务给出/.test(e)));
  check('a section with no function is refused',
    planLib.validateBrief(brief({ sections: [{ id: 'a', role: 'x', functions: [] }] })).some(e => /没有任何功能/.test(e)));
  check('an unknown role is refused',
    planLib.validateBrief(brief({ sections: [{ id: 'a', role: 'x', functions: [{ id: 'f', kind: 'display', role: 'whatever' }] }] })).some(e => /封闭词表/.test(e)));
  check('an unknown kind is refused',
    planLib.validateBrief(brief({ sections: [{ id: 'a', role: 'x', functions: [{ id: 'f', kind: 'magic', role: 'text' }] }] })).some(e => /不在 display/.test(e)));
  check('a duplicate function id is refused',
    planLib.validateBrief(brief({ sections: [
      { id: 'a', role: 'x', functions: [{ id: 'f', kind: 'display', role: 'text' }] },
      { id: 'b', role: 'y', functions: [{ id: 'f', kind: 'display', role: 'text' }] },
    ] })).some(e => /重复/.test(e)));
  check('an unknown interaction is refused',
    planLib.validateBrief(brief({ interactions: ['magic-link'] })).some(e => /不在 confirm-dialog|tab-switch/.test(e)));
}

section('scope decides what a new page may reuse');
{
  const kb = store();
  const none = planLib.admissible(kb, brief());
  eq('global rules are admissible for any page', none.components.map(r => r.id), ['component.button-span']);
  const weather = planLib.admissible(kb, brief({ family: 'weather' }));
  eq('family rules join only when the brief declares that family', weather.components.map(r => r.id).sort(), ['component.button-span', 'component.span-icon']);
  const pageRule = none.rejected.find(r => r.ruleId === 'component.div-sky-item');
  check('a single-screen rule is rejected with the screen named', /只在 w 上量到/.test(pageRule.why), pageRule.why);
  check('a family rule without a declared family says so',
    /未声明家族/.test(none.rejected.find(r => r.ruleId === 'component.span-icon').why));
  check('a family rule from another family says which', /本页声明的是 activity/.test(
    planLib.admissible(kb, brief({ family: 'activity' })).rejected.find(r => r.ruleId === 'component.span-icon').why));
  check('the globals survive in a differently-named family', planLib.admissible(kb, brief({ family: 'library' })).components.length === 1);
}

section('structure comes from the brief, not from a source screen');
{
  const b = brief();
  const plan = build(b);
  eq('sections keep the brief order', plan.sections.map(s => s.id), ['top', 'main', 'act']);
  eq('every section says where its order came from', plan.sections.every(s => /brief\.sections/.test(s.layout.basis)), true);

  const reversed = brief({ sections: brief().sections.slice().reverse() });
  eq('a reversed brief is rendered reversed', build(reversed).sections.map(s => s.id), ['act', 'main', 'top']);

  const tampered = JSON.parse(JSON.stringify(plan));
  tampered.sections.reverse();
  eq('a plan that reorders sections is caught', codes(planLib.validatePlan(tampered, b, KB)), ['SECTION_ORDER_NOT_FROM_BRIEF']);
}

section('no business function may disappear');
{
  const b = brief();
  const plan = build(b);
  const drop = JSON.parse(JSON.stringify(plan));
  drop.sections[1].functions = [];
  check('a dropped function is reported', codes(planLib.validatePlan(drop, b, KB)).includes('FUNCTION_DROPPED'));

  const invent = JSON.parse(JSON.stringify(plan));
  invent.sections[1].functions.push({ id: 'ghost', label: '幽灵', kind: 'display', role: 'text', states: ['default'], component: { resolved: false, ruleId: null, signature: null, scope: null, basis: null } });
  check('an invented function is reported', codes(planLib.validatePlan(invent, b, KB)).includes('FUNCTION_INVENTED'));

  const move = JSON.parse(JSON.stringify(plan));
  const [fn] = move.sections[1].functions.splice(0, 1);
  move.sections[2].functions.push(fn);
  check('a function moved to another section is reported', codes(planLib.validatePlan(move, b, KB)).includes('FUNCTION_MOVED_SECTION'));

  eq('the untouched plan is clean', codes(planLib.validatePlan(plan, b, KB)), []);
  eq('the plan counts what it covered', plan.coverage.functions, 3);
  eq('coverage closes', plan.coverage.resolved + plan.coverage.unresolved, plan.coverage.functions);
}

section('nothing is generated from the page name');
{
  const a = build(brief());
  const b = build(brief({ id: 'another-name', title: '另一个名字' }));
  const strip = p => JSON.stringify(Object.assign({}, p, { id: null, title: null, generatedAt: null }));
  eq('renaming the page changes nothing but its name', strip(a), strip(b));
  eq('the same brief twice is byte-identical', JSON.stringify(build(brief())), JSON.stringify(build(brief())));
  const kbRule = KB.rules.find(r => r.id === 'page.weather.home');
  check('a source screen layout cannot enter the plan', !JSON.stringify(build(brief())).includes(kbRule.id));
}

section('every claim carries a rule that is allowed here');
{
  const b = brief();
  const plan = build(b);
  eq('all citations resolve and are in scope', codes(planLib.validatePlan(plan, b, KB)), []);
  check('every decision cites at least one rule', plan.decisions.every(d => d.ruleRefs.length > 0));

  const bad = JSON.parse(JSON.stringify(plan));
  bad.decisions[0].ruleRefs.push('token.var.not-there');
  check('an unknown rule id is reported', codes(planLib.validatePlan(bad, b, KB)).includes('RULE_REF_UNKNOWN'));

  const ill = JSON.parse(JSON.stringify(plan));
  ill.decisions[0].ruleRefs.push('page.weather.home');
  check('a rule from one screen is not citable by a new page', codes(planLib.validatePlan(ill, b, KB)).includes('RULE_REF_ILL_SCOPED'));

  const bare = JSON.parse(JSON.stringify(plan));
  bare.sections[2].functions[0].component = { resolved: false, ruleId: null, signature: null, scope: null, basis: null };
  check('an unresolved role must be recorded as a gap', codes(planLib.validatePlan(bare, b, KB)).includes('SILENT_UNRESOLVED'));

  const claim = JSON.parse(JSON.stringify(plan));
  claim.sections[0].functions[0].component = { resolved: true, ruleId: null, signature: 'x', scope: 'global', basis: 'y' };
  check('a resolved role must name its rule', codes(planLib.validatePlan(claim, b, KB)).includes('RESOLVED_WITHOUT_RULE'));
}

section('reuse is bounded by the real corpus');
{
  const plan = build(brief());
  const cited = [...new Set(plan.decisions.flatMap(d => d.ruleRefs).concat(
    plan.sections.flatMap(s => s.functions.map(f => f.component && f.component.ruleId).filter(Boolean)),
    plan.interactions.map(i => i.ruleId).filter(Boolean)))];
  const byId = new Map(KB.rules.map(r => [r.id, r]));
  const nonGlobal = cited.filter(id => byId.get(id).scope.level !== 'global');
  eq('a page with no declared family cites only global rules', nonGlobal, []);
  eq('the button resolves to the one house-wide component', plan.sections[2].functions[0].component.ruleId, 'component.button-span');
  check('roles with no house-wide evidence stay unresolved and say why',
    plan.gaps.filter(g => g.code === 'ROLE_UNRESOLVED').every(g => g.detail.length > 20));
  check('gap details name the screen that owns the near-miss', plan.gaps.some(g => /只在 .* 上量到|未声明家族/.test(g.detail)));

  const fam = build(brief({ family: 'activity' }));
  const famRules = new Set(fam.sections.flatMap(s => s.functions.map(f => f.component.ruleId).filter(Boolean)));
  check('declaring a family borrows its rules', famRules.has('component.button-small') || famRules.has('component.span-icon'), [...famRules]);
  check('borrowed rules never reach into a single screen', fam.sections
    .flatMap(s => s.functions.map(f => f.component.ruleId).filter(Boolean))
    .every(id => KB.rules.find(r => r.id === id).scope.level !== 'page'));
}

section('the plan and the page it renders agree');
{
  const b = brief();
  const plan = build(b);
  const html = render.renderHtml(plan);
  const fnNodes = [...html.matchAll(/data-function="([^"]+)"/g)].map(m => m[1]);
  eq('every function appears exactly once', fnNodes, ['title', 'rows', 'go']);
  const unmeasured = (html.match(/data-grounding="unmeasured"/g) || []).length;
  eq('unmeasured nodes match the unresolved functions', unmeasured, plan.coverage.unresolved);
  check('measured nodes cite a rule id', /data-grounding="rule:component\.button-span"/.test(html));
  check('the dialog exists only because a contract resolved it', /role="dialog" aria-modal="true"/.test(html));
  check('the dialog is closed by default', /id="dna-confirm" hidden/.test(html));
  check('a function that can be confirming opens the dialog', /data-action="open-dialog"/.test(html));
  check('tap target comes from the measured principle', /min-height: 46px/.test(html));
  check('the page declares which store revision it was built from', html.includes('data-store-revision="128"'));
  check('no weather or activity class name leaks into an unrelated page', !/weather|activity/.test(html), html.slice(0, 200));

  const noDialog = render.renderHtml(build(brief({ interactions: [] })));
  check('without the contract there is no dialog element', !/id="dna-confirm"/.test(noDialog));

  const evil = build(brief({ title: 'x"><script>alert(1)</script>', sections: [
    { id: 'a', role: '页头', functions: [{ id: 'f', label: '<img src=x onerror=alert(1)>', kind: 'display', role: 'text' }] },
  ] }));
  const evilHtml = render.renderHtml(evil);
  check('brief text is escaped into the page', !/<img src=x/.test(evilHtml) && evilHtml.includes('&lt;img src=x'));
  check('the title is escaped too', !/<script>alert\(1\)/.test(evilHtml));

  const md = render.renderMarkdown(plan);
  check('the spec lists the information architecture', /## 1\. 信息架构/.test(md));
  check('the spec states where the order came from', /顺序取自业务给出的/.test(md));
  check('the spec lists gaps a human has to close', /## 6\. 缺口/.test(md) && /ROLE_UNRESOLVED/.test(md));
  check('the spec explains why layout numbers are relative', /没有测量证据/.test(md));
  check('the spec says which rules were blocked by scope', /## 7\. 被范围挡掉的规则/.test(md));
}

section('the real store produces a plan that passes both gates');
{
  const b = brief({ id: 'real-store-check' });
  const plan = build(b);
  const res = schemaLib.validate(schema, plan);
  check('the plan satisfies its schema', res.valid, schemaLib.formatErrors(res.errors));
  eq('the plan satisfies its invariants', codes(planLib.validatePlan(plan, b, KB)), []);

  // A schema that accepts everything is decoration, so it has to reject the two
  // shapes a hand-edited plan actually takes: a deleted required block and an
  // added field nobody consumes.
  const dropped = JSON.parse(JSON.stringify(plan));
  delete dropped.coverage;
  check('the schema rejects a plan without coverage accounting', !schemaLib.validate(schema, dropped).valid);
  const invented = JSON.parse(JSON.stringify(plan));
  invented.brandColor = '#000000';
  check('the schema rejects a field the contract does not declare', !schemaLib.validate(schema, invented).valid);
  // Rule provenance cannot live in the schema (it needs the store to resolve),
  // so the store check has to catch what the schema structurally cannot.
  const dangling = JSON.parse(JSON.stringify(plan));
  dangling.decisions[0].ruleRefs = ['token.not-in-the-store'];
  check('a decision citing an unknown rule is rejected by the store check',
    codes(planLib.validatePlan(dangling, b, KB)).includes('RULE_REF_UNKNOWN'));

  check('at least one role is grounded in the real corpus', plan.coverage.resolved > 0, plan.coverage);
  const summary = planLib.summarize(plan);
  eq('the summary adds up', summary.sections, 3);
  eq('the summary counts functions', summary.functions, 3);
}

process.exit(finish('generalizer.test'));

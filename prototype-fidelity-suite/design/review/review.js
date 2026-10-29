'use strict';
/**
 * Independent design review: judge a *finished* artifact against the knowledge
 * base, and say where it is wrong with evidence a person can act on.
 *
 * Three properties make this a reviewer rather than a second opinion:
 *
 *  1. **It reads artifacts, not intentions.** Every finding quotes something
 *     that exists — a token name, a colour literal with its line, a missing
 *     `data-function` id — so a reader can verify the claim without re-running
 *     the tool.
 *  2. **It reuses the store's own rules.** Scope admissibility and conflict
 *     detection come from `design/generalize/plan.js` and
 *     `design/knowledge/kb.js`; a reviewer that re-implements a rule can
 *     disagree with the generator without anyone being wrong.
 *  3. **It refuses to certify its own author.** `actor === designer` caps the
 *     verdict at UNVERIFIED, and a missing designer does too. The design agent
 *     does not get to decide that its own design passed.
 *
 * The verdict has no score: seven dimensions are judged separately, and one
 * critical finding is enough for FAIL no matter how many others passed.
 */

const planLib = require('../generalize/plan');
const kbLib = require('../knowledge/kb');
const { cssVarName } = require('../generalize/render');

const REVIEW_KIND = 'design-review-report';
const REVIEW_SCHEMA_VERSION = '0.2.0';

const DIMENSIONS = [
  ['tokens', '设计 token 一致性'],
  ['components', '组件使用合理性'],
  ['structure', '信息组织'],
  ['interactions', '交互逻辑'],
  ['completeness', '功能完整性'],
  ['exceptions', '业务例外合理性'],
  ['rules', '与新规则的冲突'],
  ['process', '评审独立性'],
];

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/g;
const RENDERER_VARS = /^--dna-/;

function finding(code, where, severity, evidence, fix) {
  return { code, where, severity, evidence: [].concat(evidence).filter(Boolean), fix };
}

// Some findings are not defects: they say "this reviewer could not look" or
// "the evidence is still candidate". Mixing them into FAIL would turn an honest
// gap into an accusation, and mixing them into PASS would turn it into a
// clearance — so they decide UNVERIFIED and nothing else.
const GAP_CODES = new Set(['NO_RENDERED_ARTIFACT', 'EXCEPTION_NEEDS_HUMAN', 'UNCONFIRMED_RULES', 'SELF_REVIEW', 'NO_REVIEWER', 'NO_DESIGNER']);

function verdictOf(findings) {
  if (findings.some(f => f.severity === 'critical')) return 'FAIL';
  if (findings.some(f => GAP_CODES.has(f.code))) return 'UNVERIFIED';
  return findings.length ? 'FAIL' : 'PASS';
}

function norm(text) {
  return String(text == null ? '' : text).toLowerCase().replace(/\s+/g, '');
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

// Selectors and scripts are not the artifact. A rule like `[role="dialog"]`
// in the stylesheet is a *request* for an element; only the markup can satisfy
// it. Reading the document whole would let a page pass a contract it never
// renders.
function markupOnly(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');
}

// ------------------------------------------------------------- html readers

function customProps(html) {
  const declared = new Map();
  for (const m of html.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}\n]+)/g)) {
    if (!declared.has(m[1])) declared.set(m[1], m[2].trim());
  }
  return declared;
}

function varUses(html) {
  const out = new Set();
  for (const m of html.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) out.add(m[1]);
  return [...out];
}

function colourLiterals(html) {
  const out = [];
  for (const m of html.matchAll(COLOUR)) out.push({ value: m[0], at: m.index });
  return out;
}

function sectionBlocks(html) {
  const marks = [];
  for (const m of html.matchAll(/data-section="([^"]+)"/g)) marks.push({ id: m[1], at: m.index });
  return marks.map((mark, i) => ({
    id: mark.id,
    body: html.slice(mark.at, i + 1 < marks.length ? marks[i + 1].at : html.length),
  }));
}

function functionNodes(html) {
  const out = new Map();
  for (const m of html.matchAll(/data-function="([^"]+)"([^>]*)>/g)) {
    const id = m[1];
    const rest = m[2] || '';
    const states = /data-states="([^"]*)"/.exec(rest);
    const entry = out.get(id) || { count: 0, states: null };
    entry.count++;
    if (states) entry.states = states[1].split(/\s+/).filter(Boolean);
    out.set(id, entry);
  }
  return out;
}

// ------------------------------------------------------------- plan readers

function citedRuleIds(plan) {
  const ids = new Set();
  for (const d of plan.decisions || []) for (const id of d.ruleRefs || []) ids.add(id);
  for (const v of (plan.tokens && plan.tokens.variables) || []) ids.add(v.ruleId);
  for (const s of (plan.tokens && plan.tokens.scale) || []) ids.add(s.ruleId);
  for (const sec of plan.sections || []) for (const f of sec.functions || []) if (f.component && f.component.ruleId) ids.add(f.component.ruleId);
  for (const i of plan.interactions || []) if (i.ruleId) ids.add(i.ruleId);
  for (const p of plan.principles || []) ids.add(p.id);
  return [...ids].filter(Boolean);
}

function briefOfPlan(plan) {
  return { family: plan.basis ? plan.basis.family : plan.family };
}

// ------------------------------------------------------------- dimensions

function reviewTokens(plan, html, kb) {
  const findings = [];
  if (!html) return { verdict: 'UNVERIFIED', findings: [finding('NO_RENDERED_ARTIFACT', 'tokens', 'major', '没有 index.html，配色与变量 declaration 无法核对', '把 --html 指向生成的原型文件')] };

  const declared = customProps(html);
  const planVars = new Map();
  for (const v of plan.tokens.variables) planVars.set(v.name, String(v.value).split(' | ')[0]);
  for (const s of plan.tokens.scale) planVars.set(cssVarName(s.prop, s.value), s.value);

  for (const name of varUses(html)) {
    if (!declared.has(name)) findings.push(finding('UNDECLARED_VAR', name, 'critical',
      `var(${name}) 被使用，但文件里没有任何地方声明 ${name}`,
      `声明 ${name} 并指向一条库里的 token，或去掉这处引用`));
  }

  for (const [name, value] of declared) {
    if (RENDERER_VARS.test(name)) continue;
    if (!planVars.has(name)) {
      findings.push(finding('TOKEN_NOT_IN_PLAN', name, 'major',
        `${name}: ${value} —— 页面上有，计划里没有出处`,
        '要么把它写进计划并指向规则，要么改用已有 token'));
      continue;
    }
    if (norm(planVars.get(name)) !== norm(value)) {
      findings.push(finding('TOKEN_VALUE_DRIFT', name, 'critical',
        `页面写 ${name}: ${value}；计划里是 ${planVars.get(name)}`,
        '以知识库的测量值为准；改页面，不要改记录'));
    }
  }

  // Any colour in the document must be a measured value. A literal that happens
  // to be "close" to a token is still an invented value with extra steps.
  const allowed = new Set();
  for (const value of planVars.values()) for (const m of String(value).matchAll(COLOUR)) allowed.add(norm(m[0]));
  for (const lit of colourLiterals(html)) {
    if (allowed.has(norm(lit.value))) continue;
    findings.push(finding('UNGROUNDED_COLOUR', `html:${lineOf(html, lit.at)}`, 'major',
      `${lit.value} 不是任何一条已测量 token 的值`,
      '换成计划里的 token；单值留给设计决定 → 先把它变成有出处的 token'));
  }

  // A plan may name a token the brief is not allowed to use (hand-edited plan).
  const adm = planLib.admissible(kb, briefOfPlan(plan));
  const usable = new Set(adm.tokens.map(r => r.id));
  for (const v of plan.tokens.variables) {
    if (!usable.has(v.ruleId)) findings.push(finding('TOKEN_RULE_ILL_SCOPED', v.name, 'critical',
      `${v.ruleId} 对本页不适用：${planLib.rejectionFor(kbRule(kb, v.ruleId) || { scope: {} }, briefOfPlan(plan)) || '规则不在库里'}`,
      '删掉这条 token，或先补足它的覆盖范围再声明为 global'));
  }

  const empty = plan.tokens.variables.length === 0 && plan.tokens.scale.length === 0;
  return { verdict: findings.length ? verdictOf(findings) : empty ? 'UNVERIFIED' : 'PASS', findings };
}

function kbRule(kb, id) {
  return (kb.rules || []).find(r => r && r.id === id) || null;
}

function reviewComponents(plan, html, kb) {
  const findings = [];
  if (!html) return { verdict: 'UNVERIFIED', findings: [finding('NO_RENDERED_ARTIFACT', 'components', 'major', '没有 index.html，组件是否真的渲染无法核对', '把 --html 指向生成的原型文件')] };

  const adm = planLib.admissible(kb, briefOfPlan(plan));
  const usable = new Set(adm.components.map(r => r.id));
  const gaps = new Set((plan.gaps || []).map(g => `${g.code}@${g.where}`));

  for (const sec of plan.sections) {
    for (const f of sec.functions) {
      const where = `${sec.id}/${f.id}`;
      const c = f.component || {};
      if (!c.resolved) {
        if (!gaps.has(`ROLE_UNRESOLVED@${where}`)) {
          findings.push(finding('SILENT_UNMEASURED', where, 'critical',
            `${f.role} 没有选到形态，也没有留下缺口记录`,
            '补一条 ROLE_UNRESOLVED 缺口，写明为什么选不到'));
        }
        continue;
      }
      const rule = kbRule(kb, c.ruleId);
      if (!rule) {
        findings.push(finding('COMPONENT_RULE_UNKNOWN', where, 'critical',
          `引用了库里不存在的规则 ${c.ruleId}`, '换成库里真实的 id，或补证据入库'));
        continue;
      }
      if (!usable.has(c.ruleId)) {
        findings.push(finding('COMPONENT_RULE_ILL_SCOPED', where, 'critical',
          `${c.ruleId} 对本页不适用：${planLib.rejectionFor(rule, briefOfPlan(plan))}`,
          '改用本页可用的规则；族/页范围的规则需要业务先声明家族'));
        continue;
      }
      const tag = planLib.tagOf(rule);
      const cls = planLib.classesOf(rule)[0] || null;
      const tagOk = tag ? new RegExp(`<${tag}[\\s>]`, 'i').test(html) : true;
      const clsOk = cls ? new RegExp(`class="[^"]*\\b${cls}\\b`).test(html) : true;
      if (!tagOk || !clsOk) {
        findings.push(finding('COMPONENT_NOT_RENDERED', where, 'major',
          `计划说形态是 ${c.signature}，页面里找不到 <${tag}${cls ? '.' + cls : ''}`,
          '按签名渲染；如果换了形态，计划也要换'));
      }
    }
  }

  const unresolved = plan.coverage ? plan.coverage.unresolved : 0;
  return {
    verdict: findings.length ? verdictOf(findings) : unresolved > 0 ? 'UNVERIFIED' : 'PASS',
    findings,
    note: unresolved > 0 ? `${unresolved} 项功能没有可用形态，页面只有占位结构；这不等于设计错了，但也不等于验过` : null,
  };
}

function reviewStructure(plan, html) {
  if (!html) return { verdict: 'UNVERIFIED', findings: [finding('NO_RENDERED_ARTIFACT', 'structure', 'major', '没有 index.html，区块顺序无法核对', '把 --html 指向生成的原型文件')] };
  const findings = [];
  const rendered = sectionBlocks(html).map(b => b.id);
  const planned = plan.sections.map(s => s.id);
  if (JSON.stringify(rendered) !== JSON.stringify(planned)) {
    findings.push(finding('SECTION_ORDER_DRIFT', 'sections', 'critical',
      `计划顺序 ${planned.join(' → ')}；页面顺序 ${rendered.join(' → ') || '（无）'}`,
      '区块顺序由业务给出，页面照计划渲染'));
  }
  for (const id of planned) {
    if (!rendered.includes(id)) findings.push(finding('SECTION_MISSING', id, 'critical',
      `计划里有 ${id}，页面上没有`, '补回这个区块，或把它从计划里删掉——两边必须一致'));
  }
  for (const id of rendered) {
    if (!planned.includes(id)) findings.push(finding('SECTION_INVENTED', id, 'major',
      `页面上多出计划里没有的区块 ${id}`, '删掉它，或先写进计划并说明它承载什么功能'));
  }
  return { verdict: verdictOf(findings), findings };
}

function reviewInteractions(plan, html) {
  if (!html) return { verdict: 'UNVERIFIED', findings: [finding('NO_RENDERED_ARTIFACT', 'interactions', 'major', '没有 index.html，交互契约无法核对', '把 --html 指向生成的原型文件')] };
  const markup = markupOnly(html);
  const findings = [];
  for (const i of plan.interactions || []) {
    if (!i.resolved) {
      if (i.requested === false) continue;
      const gap = (plan.gaps || []).find(g => g.code === 'INTERACTION_UNRESOLVED' && g.where.includes(i.name));
      findings.push(finding('INTERACTION_UNMET', i.name, 'critical',
        gap ? gap.detail : '业务要的交互没有契约',
        '补一条同类交互的证据再入库；或从业务需求里删掉它，而不是留一个点了没反应的控件'));
      continue;
    }
    const contract = i.contract || {};
    if (contract.role && !new RegExp(`role="${contract.role}"`).test(markup)) {
      findings.push(finding('INTERACTION_NOT_RENDERED', i.name, 'critical',
        `契约要求 role="${contract.role}"，页面里没有`,
        '按契约渲染出该角色，并让状态变化可被读到'));
    }
  }

  const dialog = /<div[^>]*id="dna-confirm"[^>]*>/.exec(markup);
  if (dialog && !/\bhidden\b/.test(dialog[0])) {
    findings.push(finding('DIALOG_OPEN_BY_DEFAULT', 'id="dna-confirm"', 'critical',
      '确认浮层默认是打开的', '关闭态由 overlay 的 hidden 控制'));
  }
  if (dialog && !/\.overlay\[hidden\]\s*\{\s*display:\s*none/.test(html)) {
    findings.push(finding('CLOSED_OVERLAY_HIT_TESTS', 'id="dna-confirm"', 'major',
      '缺 `.overlay[hidden] { display: none }`：关闭的浮层仍会吃掉页面点击',
      '补这条规则；只改 opacity 不够'));
  }
  return { verdict: verdictOf(findings), findings };
}

function reviewCompleteness(plan, html) {
  if (!html) return { verdict: 'UNVERIFIED', findings: [finding('NO_RENDERED_ARTIFACT', 'completeness', 'major', '没有 index.html，功能是否齐全无法核对', '把 --html 指向生成的原型文件')] };
  const findings = [];
  const nodes = functionNodes(html);
  const blocks = sectionBlocks(html);

  for (const planSection of plan.sections) {
    for (const f of planSection.functions) {
      const where = `${planSection.id}/${f.id}`;
      const node = nodes.get(f.id);
      if (!node) {
        findings.push(finding('FUNCTION_MISSING', where, 'critical',
          `业务要的「${f.label}」没有出现在页面上`, '补回这个功能；删功能不是设计选项'));
        continue;
      }
      if (node.count > 1) {
        findings.push(finding('FUNCTION_DUPLICATED', where, 'major',
          `「${f.label}」在页面上出现 ${node.count} 次`, '一个功能一个落点；重复的那处要说明它承载什么'));
      }
      const missing = (f.states || []).filter(s => !(node.states || []).includes(s));
      if (missing.length) {
        findings.push(finding('STATE_NOT_DECLARED', where, 'major',
          `功能声明支持 ${f.states.join('/')}，页面只声明了 ${(node.states || []).join('/') || '（无）'}`,
          '把缺的状态补进 data-states，并在实现里真的支持它们'));
      }
      const owner = blocks.find(b => b.body.includes(`data-function="${f.id}"`));
      if (owner && owner.id !== planSection.id) {
        findings.push(finding('FUNCTION_MOVED_SECTION', where, 'major',
          `「${f.label}」渲染在 ${owner.id} 区块里，计划说它在 ${planSection.id}`,
          '要么挪回计划指定的区块，要么更新计划里的信息架构'));
      }
    }
  }

  for (const [id, node] of nodes) {
    const known = plan.sections.some(s => s.functions.some(f => f.id === id));
    if (!known) findings.push(finding('FUNCTION_INVENTED', id, 'major',
      `页面上有 ${id}，业务没要求过它`, '删掉它，或把它写进 brief —— 设计不新增业务功能'));
  }

  return { verdict: verdictOf(findings), findings };
}

const CONSTRAINT_CHECKS = [
  {
    re: /(不|禁止|不得).{0,6}(引入|使用|新增).{0,6}色/,
    label: '不引入新色值',
    test: (findings, plan) => {
      const bad = findings.filter(f => ['UNGROUNDED_COLOUR', 'TOKEN_NOT_IN_PLAN'].includes(f.code));
      return bad.length
        ? { ok: false, evidence: `${bad.length} 处色值没有 token 出处：${bad.slice(0, 3).map(f => `${f.where} ${f.evidence[0]}`).join('；')}` }
        : { ok: true, evidence: '页面里的每个色值都等于某条已测量 token' };
    },
  },
];

function reviewExceptions(plan, html, kb, tokenFindings) {
  const findings = [];
  const humanItems = [];

  for (const constraint of plan.constraints || []) {
    const rule = CONSTRAINT_CHECKS.find(c => c.re.test(constraint));
    if (!rule) { humanItems.push(constraint); continue; }
    const res = rule.test(tokenFindings, plan);
    if (!res.ok) {
      findings.push(finding('CONSTRAINT_VIOLATED', 'constraints', 'critical',
        `业务约束「${constraint}」不成立：${res.evidence}`, '按约束改，不要改约束去迁就实现'));
    }
  }

  // Exceptions recorded in the store are conditions, not trivia: a design that
  // cites the rule inherits them. Only the ones with a mechanical reading are
  // decided here; the rest are listed for a human instead of being waved through.
  for (const id of citedRuleIds(plan)) {
    const rule = kbRule(kb, id);
    if (!rule || !Array.isArray(rule.exceptions)) continue;
    for (const ex of rule.exceptions) {
      const note = String(ex.note || '');
      if (/未被任何规则|没有消费者|未被.*引用/.test(note)) {
        const name = rule.value && rule.value.name;
        const used = name && html ? new RegExp(`var\\(\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[,)]`).test(html) : null;
        if (used === false) {
          findings.push(finding('DEAD_TOKEN_CITED', id, 'major',
            `${name} 在库里没有消费者，本页也只声明不使用`, '要么真的用它，要么别引用'));
        }
        continue;
      }
      humanItems.push(`${id}：${note}`);
    }
  }

  if (humanItems.length) {
    findings.push(finding('EXCEPTION_NEEDS_HUMAN', 'exceptions', 'major',
      `${humanItems.length} 条例外只有人能判：它们描述的是页间差异或边界条件`,
      '逐条确认本页是否落在例外里；确认结果写进评审记录，不要默认通过'));
  }
  if (!findings.length) return { verdict: 'NOT_APPLICABLE', findings: [] };
  return { verdict: verdictOf(findings), findings, humanItems: humanItems.slice(0, 12) };
}

function reviewRules(plan, kb) {
  const findings = [];
  const adm = planLib.admissible(kb, briefOfPlan(plan));
  const usable = new Set([...adm.tokens, ...adm.components, ...adm.interactions, ...adm.principles].map(r => r.id));
  const cited = citedRuleIds(plan);
  const unconfirmed = [];

  for (const id of cited) {
    const rule = kbRule(kb, id);
    if (!rule) {
      findings.push(finding('RULE_REF_UNKNOWN', id, 'critical',
        `引用了库里不存在的规则 ${id}`, '删掉这条引用，或先把它入库'));
      continue;
    }
    if (!usable.has(id)) {
      findings.push(finding('RULE_REF_ILL_SCOPED', id, 'critical',
        `${id} 对本页不适用：${planLib.rejectionFor(rule, briefOfPlan(plan))}`,
        '只引用本页可用的规则；被挡掉的规则在计划的 rejected 里就该有记录'));
    }
    const status = rule.confirmation && rule.confirmation.status;
    if (status !== 'confirmed') unconfirmed.push(id);
  }

  if (unconfirmed.length) {
    findings.push(finding('UNCONFIRMED_RULES', 'rules', 'major',
      `${unconfirmed.length} 条被引用的规则仍是 candidate，没有署名确认：${unconfirmed.slice(0, 5).join('、')}${unconfirmed.length > 5 ? ' …' : ''}`,
      '这些规则可以先用，但评审记录里要写明"依据未确认"；确认由人签字，不由工具代签'));
  }

  // Two cited rules that conflict with each other make the design contradict
  // itself — the store's own conflict detector is the single source for this.
  const citedSet = new Set(cited);
  for (const conflict of kbLib.findConflicts(kb)) {
    const hits = (conflict.ruleIds || []).filter(id => citedSet.has(id));
    if (hits.length < 2) continue;
    findings.push(finding('CONFLICTING_RULES_CITED', hits.join(' + '), 'critical',
      conflict.detail || '两条被引用的规则描述同一主题却给出不同值',
      '先解决库里这条冲突（pf kb conflicts），再重新生成设计'));
  }

  return { verdict: verdictOf(findings), findings };
}

function reviewProcess(actor, designer) {
  const findings = [];
  if (!actor) findings.push(finding('NO_REVIEWER', 'process', 'major', '没有记录评审人', '用 --actor 写下是谁做的这次评审'));
  if (!designer) findings.push(finding('NO_DESIGNER', 'process', 'major', '没有记录设计人', '用 --designer 写下是谁产出的这份设计'));
  if (actor && designer && actor === designer) {
    findings.push(finding('SELF_REVIEW', 'process', 'major',
      `设计者与评审者是同一个人（${actor}）`,
      '换一个执行者复审；同一人兼做时，结论最高只能是 UNVERIFIED'));
  }
  const independent = Boolean(actor && designer && actor !== designer);
  return { verdict: independent ? 'PASS' : 'UNVERIFIED', findings, independent };
}

// ------------------------------------------------------------- assembly

function review({ plan, html, kb, actor, designer, at, htmlName }) {
  if (!plan || plan.kind !== 'design-plan') throw new Error('review: 需要一份 design-plan（kind="design-plan"）');
  const tokenDim = reviewTokens(plan, html, kb);
  const dims = {
    tokens: tokenDim,
    components: reviewComponents(plan, html, kb),
    structure: reviewStructure(plan, html),
    interactions: reviewInteractions(plan, html),
    completeness: reviewCompleteness(plan, html),
    exceptions: reviewExceptions(plan, html, kb, tokenDim.findings),
    rules: reviewRules(plan, kb),
    process: reviewProcess(actor, designer),
  };

  const dimensions = DIMENSIONS.map(([id, title]) => {
    const d = dims[id];
    return { id, title, verdict: d.verdict, findings: d.findings, note: d.note || null, items: d.items || d.humanItems || null };
  });

  const all = dimensions.flatMap(d => d.findings);
  const critical = all.filter(f => f.severity === 'critical').length;
  const major = all.filter(f => f.severity === 'major').length;
  const minor = all.filter(f => f.severity === 'minor').length;

  const failed = dimensions.filter(d => d.verdict === 'FAIL').map(d => d.id);
  const unverifiedDims = dimensions.filter(d => d.verdict === 'UNVERIFIED').map(d => d.id);

  let overall;
  let reason;
  if (failed.length) {
    overall = 'FAIL';
    reason = `${all.length} 条发现（critical ${critical} / major ${major}）：${failed.join('、')} 未通过`;
  } else if (!dims.process.independent) {
    overall = 'UNVERIFIED';
    reason = dims.process.findings.some(f => f.code === 'SELF_REVIEW')
      ? '自审：设计者与评审者是同一人，不能由设计方自己验收'
      : '缺少评审人或设计人记录';
  } else if (unverifiedDims.length) {
    overall = 'UNVERIFIED';
    reason = `这些维度没有足够证据：${unverifiedDims.join('、')}`;
  } else {
    overall = 'PASS';
    reason = '七个设计维度与评审独立性均通过';
  }

  return {
    kind: REVIEW_KIND,
    schemaVersion: REVIEW_SCHEMA_VERSION,
    planId: plan.id,
    reviewedAt: at || new Date().toISOString(),
    actor: actor || null,
    designer: designer || null,
    independent: dims.process.independent,
    artifacts: { html: htmlName || null, bytes: html ? Buffer.byteLength(html, 'utf8') : 0 },
    store: { id: plan.basis && plan.basis.storeId, revision: plan.basis && plan.basis.storeRevision },
    dimensions,
    counts: { critical, major, minor, findings: all.length },
    overall,
    reason,
  };
}

function summarize(report) {
  const dims = report.dimensions.map(d => `${d.id} ${d.verdict}`).join(' · ');
  return {
    overall: report.overall,
    line: `${report.overall} · ${report.planId} · ${dims}`,
    counts: report.counts,
    blockers: report.dimensions.flatMap(d => d.findings
      .filter(f => f.severity === 'critical' || f.severity === 'major')
      .map(f => `${f.severity} ${f.code} @ ${f.where}`)),
  };
}

function renderMarkdown(report) {
  const c = report.counts;
  const lines = [];
  lines.push(`# ${report.planId} · 设计评审`);
  lines.push('');
  lines.push(`结论 **${report.overall}** —— ${report.reason}。`);
  lines.push('');
  lines.push(`- 评审人：${report.actor || '（未记录）'} · 设计人：${report.designer || '（未记录）'} · 独立评审：${report.independent ? '是' : '否'}`);
  lines.push(`- 知识库：\`${report.store.id || '-'}\` revision ${report.store.revision}`);
  lines.push(`- 被评审文件：\`${report.artifacts.html || '-'}\`（${report.artifacts.bytes} 字节）`);
  lines.push(`- 发现 ${c.findings} 条：critical ${c.critical} / major ${c.major} / minor ${c.minor}`);
  lines.push('');
  lines.push('## 八项结论（七个设计维度 + 评审独立性）');
  lines.push('');
  lines.push('| 维度 | 结论 | 发现 |');
  lines.push('|---|---|---|');
  for (const d of report.dimensions) lines.push(`| ${d.title} | ${d.verdict} | ${d.findings.length} |`);
  lines.push('');
  for (const d of report.dimensions) {
    lines.push(`## ${d.title} —— ${d.verdict}`);
    lines.push('');
    if (d.note) lines.push(`${d.note}。`);
    if (d.note) lines.push('');
    if (!d.findings.length) lines.push('- 没有发现问题。');
    for (const f of d.findings) {
      lines.push(`- **${f.severity} · ${f.code} @ ${f.where}**`);
      for (const e of f.evidence) lines.push(`  - 证据：${e}`);
      lines.push(`  - 修复：${f.fix}`);
    }
    if (Array.isArray(d.items) && d.items.length) {
      lines.push('');
      lines.push('需要人来判的项：');
      for (const item of d.items) lines.push(`- ${item}`);
    }
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('这份结论只回答「设计是否与知识库一致、业务功能是否齐备、执行与验收是否分离」。');
  lines.push('它不评价好不好看，也不替代真机渲染：某个维度 PASS 只表示这个维度上没找到有证据的错误。');
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  REVIEW_KIND, REVIEW_SCHEMA_VERSION, DIMENSIONS,
  review, summarize, renderMarkdown,
  // exported for tests: readers are the part most likely to drift silently
  customProps, varUses, colourLiterals, sectionBlocks, functionNodes, citedRuleIds, markupOnly,
};

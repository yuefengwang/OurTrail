'use strict';
/**
 * Turn a *business brief* into a page design plan, using the design knowledge
 * base as the only source of design decisions.
 *
 * Three boundaries are mechanical, because each one corresponds to a way a
 * "generalizer" turns into a template engine:
 *
 *  1. **Structure comes from the brief.** Sections and their order are the
 *     brief's; nothing here reads a source screen's section order. A page that
 *     reuses the weather screen's order must have been *asked* for that order.
 *  2. **Admissibility comes from scope.** `global` rules apply to any page;
 *     `page-family` rules apply only when the brief declares that family (and
 *     are labelled borrowed); `page` rules never apply to a new page — they are
 *     one screen's own layout, and copying them is what "no mechanical copy"
 *     forbids. Rejections are recorded with the scope that rejected them, so
 *     "the house has no evidence for this role" is a readable outcome instead
 *     of a silent guess.
 *  3. **No role is invented.** Every function names a role from a closed
 *     vocabulary; the role resolves to a rule or it does not. There is no
 *     fallback shape, no default spacing scale, no "looks about right".
 *
 * The plan is a document plus a machine-checkable contract: `validatePlan`
 * re-derives completeness and provenance from the brief and the KB, so a
 * caller cannot produce a plan that quietly drops a function or cites a rule
 * that does not exist.
 */

const PLAN_KIND = 'design-plan';
const PLAN_SCHEMA_VERSION = '0.2.0';

const FUNCTION_KINDS = new Set(['display', 'list', 'action', 'input', 'navigation', 'feedback']);
const SURFACES = new Set(['header', 'content', 'footer', 'overlay']);
const STATE_WORDS = new Set(['default', 'loading', 'empty', 'filled', 'error', 'disabled', 'selected', 'confirming']);

// A closed role vocabulary. Each entry is a predicate over a rule, not a page
// name: the same role can be satisfied by any rule whose signature or ARIA role
// has that meaning, which is why a role can legitimately be "unresolvable"
// when every matching rule belongs to a screen this page is not.
const ROLES = {
  // `button > span` describes a span inside a button: the house button is the
  // pair, so either end of the signature may identify the role.
  button: r => ['button', 'a'].includes(tagOf(r)) || ['button', 'a'].includes(rootTagOf(r)),
  nav: r => tagOf(r) === 'nav',
  icon: r => hasClass(r, /(^|-)icon$/),
  row: r => hasClass(r, /(^|-)row$/),
  'row-title': r => hasClass(r, /(^|-)row-body$/) || hasClass(r, /(^|-)title$/),
  'row-date': r => hasClass(r, /(^|-)date$/),
  'row-meta': r => hasClass(r, /(^|-)meta$/),
  'row-metrics': r => hasClass(r, /(^|-)metrics$/),
  status: r => hasClass(r, /status$/),
  chip: r => hasClass(r, /(^|-)chip$/),
  tab: r => hasClass(r, /tabs?$/) || attrOf(r, 'role') === 'tablist',
  section: r => hasClass(r, /(^|-)section$/) || tagOf(r) === 'section',
  list: r => hasClass(r, /(^|-)list$/) || ['ul', 'ol'].includes(tagOf(r)),
  note: r => hasClass(r, /(^|-)note$/) || hasClass(r, /(^|-)caption$/),
  metric: r => hasClass(r, /(^|-)metric/),
  text: r => ['h1', 'h2', 'h3', 'p', 'small', 'time'].includes(tagOf(r)) || hasClass(r, /(^|-)body$/),
};

const ROLE_NAMES = Object.keys(ROLES).sort();

// The ARIA role that identifies each interaction contract. Interaction rules
// keep their elements under a per-kind key, so the mapping is derived from the
// rule's value rather than from a selector name.
const INTERACTION_ARIA = {
  'tab-switch': 'tablist',
  'confirm-dialog': 'dialog',
  'status-feedback': 'status',
  'text-entry': 'field',
};

const INTERACTION_NAMES = Object.keys(INTERACTION_ARIA).sort();

// ---------------------------------------------------------------- rule access

function signatureOf(rule) {
  return (rule && rule.value && typeof rule.value.signature === 'string') ? rule.value.signature : '';
}

// `span.row-body > h3` — the element described is the last segment; the first
// segment is the container it was qualified by.
function lastSegment(rule) {
  const sig = signatureOf(rule);
  return sig ? sig.split('>').pop().trim().split('[')[0].trim() : '';
}

function tagOf(rule) {
  return (lastSegment(rule).split('.')[0] || '').toLowerCase();
}

function rootTagOf(rule) {
  const sig = signatureOf(rule);
  if (!sig) return '';
  const first = sig.split('>')[0].trim().split('[')[0].trim();
  return (first.split('.')[0] || '').toLowerCase();
}

function classesOf(rule) {
  const sig = signatureOf(rule);
  const out = [];
  for (const m of sig.matchAll(/\.([A-Za-z0-9_-]+)/g)) out.push(m[1].toLowerCase());
  return out;
}

function hasClass(rule, re) {
  return classesOf(rule).some(c => re.test(c));
}

function attrOf(rule, name) {
  const sig = signatureOf(rule);
  const m = new RegExp('\\[' + name + '=([^\\]]+)\\]').exec(sig);
  return m ? m[1].trim().toLowerCase() : null;
}

// What an interaction rule actually observed, as ARIA roles. `fields` is the
// one that is not an ARIA role but a control kind; it is kept under the same
// name so a brief can ask for "text-entry" without knowing the sample shape.
function interactionRoles(rule) {
  const value = (rule && rule.value) || {};
  const out = [];
  if (Array.isArray(value.tablists) && value.tablists.length) out.push('tablist');
  if (Array.isArray(value.dialogs) && value.dialogs.length) out.push('dialog');
  if (Array.isArray(value.status) && value.status.length) out.push('status');
  if (Array.isArray(value.fields) && value.fields.length) out.push('field');
  return out;
}

function satisfiesRole(rule, role) {
  if (!rule || rule.category !== 'component') return false;
  return Boolean(ROLES[role] && ROLES[role](rule));
}

function satisfiesInteraction(rule, name) {
  if (!rule || rule.category !== 'interaction') return false;
  return interactionRoles(rule).includes(INTERACTION_ARIA[name]);
}

// ---------------------------------------------------------------- admissibility

const LEVELS = ['global', 'page-family', 'page'];

function scopeOf(rule) {
  return (rule && rule.scope) || {};
}

/**
 * Why a rule does not apply to this brief, or null when it does.
 *
 * A new page has no history of its own, so a rule measured on exactly one
 * screen is that screen's layout, not a house convention. Family rules are
 * borrowable only when the brief says which family the page belongs to — which
 * is a statement the author has to make, not something inferred from the page.
 */
function rejectionFor(rule, brief) {
  const scope = scopeOf(rule);
  const level = scope.level;
  if (!LEVELS.includes(level)) return `规则没有可用的适用范围（${JSON.stringify(level)}）`;
  if (level === 'global') return null;
  if (level === 'page-family') {
    const families = Array.isArray(scope.families) ? scope.families : [];
    if (!brief.family) return `只属于 ${families.join('/')} 族；本页未声明家族，不按家族规则处理`;
    if (!families.includes(brief.family)) return `只属于 ${families.join('/')} 族，本页声明的是 ${brief.family}`;
    return null;
  }
  return `只在 ${(scope.pages || []).join('、') || '一个页面'} 上量到；那是那一屏自己的排版，不是可复用的约定`;
}

function admissible(kb, brief) {
  const out = { tokens: [], components: [], interactions: [], principles: [], rejected: [] };
  for (const rule of kb.rules || []) {
    const category = rule.category;
    if (!['token', 'component', 'interaction', 'principle'].includes(category)) continue;
    const why = rejectionFor(rule, brief);
    if (why) {
      out.rejected.push({
        ruleId: rule.id,
        category,
        scope: rule.scope && rule.scope.level,
        signature: signatureOf(rule) || null,
        roles: category === 'interaction' ? interactionRoles(rule) : null,
        why,
      });
      continue;
    }
    if (category === 'principle') out.principles.push(rule);
    else if (category === 'interaction') out.interactions.push(rule);
    else if (category === 'component') out.components.push(rule);
    else out.tokens.push(rule);
  }
  return out;
}

// ---------------------------------------------------------------- brief checks

function validateBrief(brief) {
  const errors = [];
  if (!brief || typeof brief !== 'object') return ['brief is not an object'];
  if (typeof brief.title !== 'string' || !brief.title.trim()) errors.push('brief.title 缺失');
  if (brief.family != null && typeof brief.family !== 'string') errors.push('brief.family 必须是字符串或省略');
  if (!Array.isArray(brief.sections) || brief.sections.length === 0) {
    errors.push('brief.sections 为空：页面结构必须由业务给出，不能由模板推导');
    return errors;
  }
  const seenSections = new Set();
  const seenFunctions = new Set();
  brief.sections.forEach((s, i) => {
    const at = `sections[${i}]`;
    if (!s || typeof s !== 'object') { errors.push(`${at} 不是对象`); return; }
    if (!s.id) errors.push(`${at} 缺少 id`);
    else if (seenSections.has(s.id)) errors.push(`${at} 的 id "${s.id}" 重复`);
    else seenSections.add(s.id);
    if (s.surface && !SURFACES.has(s.surface)) errors.push(`${at}.surface "${s.surface}" 不在 ${[...SURFACES].join('|')} 内`);
    if (!Array.isArray(s.functions) || !s.functions.length) { errors.push(`${at} 没有任何功能：一个区块存在就必须承载功能`); return; }
    s.functions.forEach((f, j) => {
      const fat = `${at}.functions[${j}]`;
      if (!f || typeof f !== 'object') { errors.push(`${fat} 不是对象`); return; }
      if (!f.id) errors.push(`${fat} 缺少 id`);
      else if (seenFunctions.has(f.id)) errors.push(`${fat} 的 id "${f.id}" 重复`);
      else seenFunctions.add(f.id);
      if (!FUNCTION_KINDS.has(f.kind)) errors.push(`${fat}.kind "${f.kind}" 不在 ${[...FUNCTION_KINDS].join('|')} 内`);
      if (!ROLE_NAMES.includes(f.role)) errors.push(`${fat}.role "${f.role}" 不在封闭词表内（${ROLE_NAMES.join(' / ')}）`);
      if (f.states && (!Array.isArray(f.states) || f.states.some(s2 => !STATE_WORDS.has(s2)))) {
        errors.push(`${fat}.states 含未知状态词（允许：${[...STATE_WORDS].join('/')}）`);
      }
    });
  });
  if (brief.interactions) {
    for (const name of brief.interactions) {
      if (!INTERACTION_NAMES.includes(name)) errors.push(`brief.interactions 里的 "${name}" 不在 ${INTERACTION_NAMES.join('|')} 内`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------- selection

function instancesOf(rule) {
  const s = rule.support || {};
  if (typeof s.instances === 'number') return s.instances;
  const value = rule.value || {};
  if (typeof value.instances === 'number') return value.instances;
  if (value.consumers && typeof value.consumers.count === 'number') return value.consumers.count;
  return 0;
}

/**
 * Pick the rule that best answers a predicate. Tie-break by measured frequency,
 * then by id so the result is stable across runs.
 */
function pick(rules, predicate) {
  const matches = rules.filter(predicate);
  if (!matches.length) return { rule: null };
  matches.sort((a, b) => (instancesOf(b) - instancesOf(a)) || a.id.localeCompare(b.id));
  return { rule: matches[0], basis: instancesOf(matches[0]) };
}

function componentFor(admissibility, role) {
  const hit = pick(admissibility.components, r => satisfiesRole(r, role));
  if (hit.rule) {
    return {
      resolved: true,
      ruleId: hit.rule.id,
      signature: hit.rule.value.signature,
      scope: hit.rule.scope.level,
      basis: `库里 ${hit.basis} 个实例里最常用的 "${role}" 角色形态`,
    };
  }
  return { resolved: false, ruleId: null, signature: null, scope: null, basis: null };
}

function interactionFor(admissibility, name) {
  const hit = pick(admissibility.interactions, r => satisfiesInteraction(r, name));
  if (hit.rule) {
    return {
      resolved: true,
      name,
      ruleId: hit.rule.id,
      scope: hit.rule.scope.level,
      contract: contractOf(hit.rule),
      basis: `库里 ${hit.basis} 处同类元素`,
    };
  }
  return { resolved: false, name, ruleId: null, scope: null, contract: null, basis: null };
}

/**
 * The contract a caller has to implement, read off the observed elements —
 * never the source selector, because reusing `#sheet` on another page is a copy,
 * not a convention.
 */
function contractOf(rule) {
  const value = rule.value || {};
  if (Array.isArray(value.dialogs) && value.dialogs.length) {
    return {
      role: 'dialog',
      ariaModal: 'true',
      focusable: value.dialogs.every(d => d.tabindex === '-1') ? 'tabindex="-1"' : null,
      hiddenBy: '由外层 overlay 的 hidden 控制显隐，关闭态不得命中点击',
      observed: value.dialogs.length,
    };
  }
  if (Array.isArray(value.tablists) && value.tablists.length) {
    return {
      role: 'tablist',
      itemRole: 'tab',
      stateAttr: value.tablists[0].stateAttr || 'aria-selected',
      observed: value.tablists.length,
    };
  }
  if (Array.isArray(value.status) && value.status.length) {
    return {
      role: 'status',
      live: 'polite',
      observed: value.status.length,
      note: '采集时全部不可见：契约存在，出现时机未被证明',
    };
  }
  if (Array.isArray(value.fields) && value.fields.length) {
    const minFont = Math.min(...value.fields.map(f => f.fontSize).filter(n => typeof n === 'number'));
    return {
      minFontSize: Number.isFinite(minFont) ? minFont : null,
      rule: '输入字号 ≥14px（移动端不触发自动缩放）',
      observed: value.fields.length,
    };
  }
  return null;
}

// ---------------------------------------------------------------- assembly

function tokenVars(tokens) {
  const vars = [];
  const scale = [];
  for (const rule of tokens) {
    const v = rule.value || {};
    if (typeof v.name === 'string' && v.name.startsWith('--')) {
      vars.push({ name: v.name, value: (v.resolved || []).join(' | '), ruleId: rule.id, group: v.group || 'other', scope: rule.scope.level });
    } else if (v.prop && v.value != null) {
      scale.push({ prop: v.prop, value: v.value, ruleId: rule.id, scope: rule.scope.level });
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  vars.sort(byName);
  scale.sort((a, b) => (a.prop + a.value).localeCompare(b.prop + b.value));
  return { vars, scale };
}

function buildPlan(kb, brief, opts) {
  const errors = validateBrief(brief);
  if (errors.length) {
    const err = new Error(`brief is not usable:\n  ${errors.join('\n  ')}`);
    err.code = 'BRIEF_INVALID';
    err.errors = errors;
    throw err;
  }
  const options = opts || {};
  const adm = admissible(kb, brief);
  const { vars, scale } = tokenVars(adm.tokens);

  const sections = [];
  const decisions = [];
  const gaps = [];
  let functionCount = 0;
  let resolvedCount = 0;

  const seenComponents = new Map();
  for (const s of brief.sections) {
    const functions = [];
    for (const f of s.functions) {
      functionCount++;
      const comp = componentFor(adm, f.role);
      if (comp.resolved) {
        resolvedCount++;
        seenComponents.set(comp.ruleId, (seenComponents.get(comp.ruleId) || 0) + 1);
      } else {
        gaps.push({
          code: 'ROLE_UNRESOLVED',
          where: `${s.id}/${f.id}`,
          detail: `全库没有可用于本页的 "${f.role}" 形态：${rejectedForRole(adm, f.role)}`,
        });
      }
      functions.push({
        id: f.id,
        label: f.label || f.id,
        kind: f.kind,
        role: f.role,
        states: Array.isArray(f.states) && f.states.length ? f.states.slice() : ['default'],
        component: comp,
      });
    }
    sections.push({
      id: s.id,
      role: s.role || s.id,
      surface: s.surface || 'content',
      layout: {
        order: sections.length + 1,
        basis: 'brief.sections —— 顺序由业务给出，不取自任何原型屏',
        stack: 'block',
      },
      functions,
    });
  }

  const requested = Array.isArray(brief.interactions) ? brief.interactions : [];
  const interactions = [];
  for (const name of requested) {
    const hit = interactionFor(adm, name);
    if (hit.resolved) interactions.push(hit);
    else {
      gaps.push({ code: 'INTERACTION_UNRESOLVED', where: `interactions/${name}`, detail: `全库没有可用于本页的 ${name} 契约` });
      interactions.push(Object.assign(hit, { requested: true }));
    }
  }

  if (vars.length) {
    decisions.push({
      id: 'D-color',
      statement: `色板只用库里的 ${vars.filter(v => v.group === 'color').length} 个全局颜色变量，不新造色值`,
      ruleRefs: vars.filter(v => v.group === 'color').map(v => v.ruleId),
    });
  }
  const typeRules = scale.filter(s => s.prop === 'font-size');
  if (typeRules.length) {
    decisions.push({
      id: 'D-type-scale',
      statement: `字号从既有阶里取（${typeRules.map(t => t.value).join(' / ')}），不新增字号`,
      ruleRefs: typeRules.map(t => t.ruleId),
    });
  }
  const radiusRules = scale.filter(s => s.prop === 'border-radius');
  if (radiusRules.length) {
    decisions.push({
      id: 'D-radius',
      statement: `圆角只用库里量到的 ${radiusRules.length} 个值（${radiusRules.map(r => r.value).join(' / ')}），不新造圆角`,
      ruleRefs: radiusRules.map(r => r.ruleId),
    });
  }
  for (const [ruleId, count] of [...seenComponents.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    const rule = adm.components.find(r => r.id === ruleId);
    decisions.push({
      id: `D-component-${String(decisions.length + 1).padStart(2, '0')}`,
      statement: `${count} 处功能沿用 \`${rule.value.signature}\``,
      ruleRefs: [ruleId],
    });
  }
  for (const hit of interactions.filter(i => i.resolved)) {
    decisions.push({
      id: `D-${hit.name}`,
      statement: `${hit.name} 按库里观测到的契约实现（${hit.ruleId}）`,
      ruleRefs: [hit.ruleId],
    });
  }
  for (const p of adm.principles) {
    decisions.push({ id: `D-${p.id.split('.').pop()}`, statement: p.statement, ruleRefs: [p.id] });
  }

  const plan = {
    kind: PLAN_KIND,
    schemaVersion: PLAN_SCHEMA_VERSION,
    id: brief.id || 'unnamed-page',
    title: brief.title,
    family: brief.family || null,
    platform: brief.platform || {},
    constraints: Array.isArray(brief.constraints) ? brief.constraints.slice() : [],
    generatedAt: options.at || new Date().toISOString(),
    basis: {
      storeId: kb.id || null,
      storeRevision: kb.revision,
      corpus: (kb.corpus || []).map(c => (typeof c === 'string' ? c : c.file)).filter(Boolean),
      family: brief.family || null,
    },
    tokens: { variables: vars, scale },
    sections,
    interactions,
    principles: adm.principles.map(p => ({ id: p.id, statement: p.statement, scope: p.scope.level })),
    decisions,
    gaps,
    rejected: adm.rejected,
    coverage: {
      functions: functionCount,
      resolved: resolvedCount,
      unresolved: functionCount - resolvedCount,
      interactionsRequested: requested.length,
      interactionsResolved: interactions.filter(i => i.resolved).length,
    },
  };
  return plan;
}

// The rejection record carries the signature and ARIA roles it would have
// matched, so "this role exists but only on a screen you are not building" is
// answerable without re-reading the store.
function rejectedForRole(adm, role) {
  const matching = adm.rejected.filter(r => r.category === 'component' && satisfiesRole({ category: 'component', value: { signature: r.signature || '' } }, role));
  if (!matching.length) {
    const anyRejected = adm.rejected.filter(r => r.category === 'component');
    if (!anyRejected.length) return '库里没有任何组件形态被范围挡住，也没有任何形态匹配这个角色';
    return `没有任何被挡掉的形态匹配这个角色（被挡掉的 ${anyRejected.length} 条都不含该角色）`;
  }
  return matching.map(m => `${m.ruleId}：${m.why}`).join('；');
}

// ---------------------------------------------------------------- validation

function validatePlan(plan, brief, kb) {
  const errors = [];
  const add = (code, where, message) => errors.push({ code, where, message });

  if (!plan || plan.kind !== PLAN_KIND) {
    add('WRONG_KIND', '$', `kind 是 ${JSON.stringify(plan && plan.kind)}`);
    return errors;
  }
  const rules = new Map((kb.rules || []).map(r => [r.id, r]));

  // Every function in the brief appears exactly once, in the brief's order.
  const briefFns = [];
  for (const s of brief.sections) for (const f of s.functions) briefFns.push({ id: f.id, section: s.id });
  const planFns = [];
  for (const s of plan.sections) for (const f of s.functions) planFns.push({ id: f.id, section: s.id });
  for (const b of briefFns) {
    const hits = planFns.filter(p => p.id === b.id);
    if (!hits.length) add('FUNCTION_DROPPED', b.section + '/' + b.id, '业务功能在设计里消失了');
    else if (hits.length > 1) add('FUNCTION_DUPLICATED', b.id, `在计划里出现 ${hits.length} 次`);
    else if (hits[0].section !== b.section) add('FUNCTION_MOVED_SECTION', b.id, `从 ${b.section} 移到了 ${hits[0].section}`);
  }
  for (const p of planFns) if (!briefFns.some(b => b.id === p.id)) add('FUNCTION_INVENTED', p.id, '计划里有业务没提过的功能');

  const briefOrder = brief.sections.map(s => s.id);
  const planOrder = plan.sections.map(s => s.id);
  if (JSON.stringify(briefOrder) !== JSON.stringify(planOrder)) {
    add('SECTION_ORDER_NOT_FROM_BRIEF', 'sections', `业务给的顺序是 ${briefOrder.join(' → ')}，计划里是 ${planOrder.join(' → ')}`);
  }

  // Every cited rule exists and is admissible for this brief.
  const cited = new Set();
  for (const d of plan.decisions || []) {
    if (!Array.isArray(d.ruleRefs) || !d.ruleRefs.length) add('DECISION_WITHOUT_RULE', d.id, '设计决策没有引用任何规则');
    for (const id of d.ruleRefs || []) cited.add(id);
  }
  for (const s of plan.sections || []) for (const f of s.functions || []) if (f.component && f.component.ruleId) cited.add(f.component.ruleId);
  for (const i of plan.interactions || []) if (i.ruleId) cited.add(i.ruleId);
  for (const id of cited) {
    const rule = rules.get(id);
    if (!rule) { add('RULE_REF_UNKNOWN', id, '引用了库里不存在的规则'); continue; }
    const why = rejectionFor(rule, brief);
    if (why) add('RULE_REF_ILL_SCOPED', id, `被引用但范围不允许：${why}`);
  }

  // A function that claims to be resolved must say which rule resolved it.
  for (const s of plan.sections || []) {
    for (const f of s.functions || []) {
      const c = f.component || {};
      if (c.resolved && !c.ruleId) add('RESOLVED_WITHOUT_RULE', `${s.id}/${f.id}`, '声称已选型却没有规则出处');
      if (!c.resolved) {
        const gap = (plan.gaps || []).find(g => g.code === 'ROLE_UNRESOLVED' && g.where === `${s.id}/${f.id}`);
        if (!gap) add('SILENT_UNRESOLVED', `${s.id}/${f.id}`, '没有选到形态却没有留下缺口记录');
      }
    }
  }

  // The plan must say how many functions it thinks it covered.
  const cov = plan.coverage || {};
  if (cov.functions !== briefFns.length) add('COVERAGE_MISMATCH', 'coverage.functions', `${cov.functions} != ${briefFns.length}`);
  if (cov.resolved + cov.unresolved !== cov.functions) add('COVERAGE_NOT_CLOSED', 'coverage', 'resolved + unresolved 不等于 functions');

  return errors;
}

function summarize(plan) {
  const byRole = {};
  for (const s of plan.sections) for (const f of s.functions) {
    byRole[f.role] = (byRole[f.role] || 0) + 1;
  }
  return {
    sections: plan.sections.length,
    functions: plan.coverage.functions,
    resolved: plan.coverage.resolved,
    unresolved: plan.coverage.unresolved,
    interactions: `${plan.coverage.interactionsResolved}/${plan.coverage.interactionsRequested}`,
    decisions: plan.decisions.length,
    rejectedRules: plan.rejected.length,
    byRole,
  };
}

module.exports = {
  PLAN_KIND,
  PLAN_SCHEMA_VERSION,
  FUNCTION_KINDS,
  SURFACES,
  STATE_WORDS,
  ROLES,
  ROLE_NAMES,
  INTERACTION_ARIA,
  INTERACTION_NAMES,
  validateBrief,
  admissible,
  rejectionFor,
  buildPlan,
  validatePlan,
  summarize,
  contractOf,
  interactionRoles,
  satisfiesRole,
  satisfiesInteraction,
  signatureOf,
  tagOf,
  rootTagOf,
  classesOf,
};

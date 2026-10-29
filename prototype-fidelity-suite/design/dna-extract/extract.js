#!/usr/bin/env node
'use strict';
/**
 * Design DNA extractor.
 *
 * Reads the confirmed HTML prototypes **read-only**, measures them through the
 * design walker, and derives rules. Every rule carries the seven fields the
 * product brief requires: 来源 / 证据 / 适用范围 / 可信度 / 是否经用户确认 / 例外情况
 * plus a `kind` that separates a measured fact from an observed regularity from
 * an inference.
 *
 * Two boundaries are enforced here, not left to reviewer discipline:
 *
 *  - **No automatic promotion.** Scope is derived by counting distinct pages,
 *    and every rule leaves this file with `confirmation.status = "candidate"`.
 *    Nothing reaches "global" as anything stronger than a candidate; only the
 *    knowledge base's `confirm` command (a human act) changes that.
 *  - **No vacuous claim.** A rule whose evidence list is empty is never emitted;
 *    counts printed in a statement come from the same array as the evidence.
 */
const fs = require('fs');
const path = require('path');
const { runWalk } = require('../lib/walker');
const { writeJson, ensureDir, isoNow, slug, round, sha256File } = require('../../core/lib/util');

// Classes that describe a *state* of a component, not a different component.
// `on-detail` is here because detail.js adds it to `.device` while the activity
// detail overlay is open — leaving it in the signature would split the same
// container into two components, one per screen state.
const STATE_CLASSES = new Set(['on', 'on-detail', 'active', 'selected', 'is-scrolled', 'show', 'open', 'is-paused', 'preview-width', 'has-error']);
const IGNORED_TAGS = new Set(['svg', 'path', 'circle', 'polyline', 'line', 'rect', 'g', 'i', 'b', 'br', 'img', 'script', 'style', 'defs', 'text']);
const CONSENSUS_PROPS = ['font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'background-color',
  'border-radius', 'padding', 'gap', 'display', 'flex-direction', 'align-items', 'justify-content',
  'height', 'min-height', 'border-top-width', 'box-shadow', 'white-space', 'text-overflow'];

function median(nums) {
  const a = nums.filter(n => Number.isFinite(n)).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function uniq(arr) { return [...new Set(arr)]; }

/** css colour literal → comparable form (lowercase, no spaces). */
function normColor(v) { return v == null ? v : String(v).toLowerCase().replace(/\s+/g, ''); }

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  if (h.length === 3) return [0, 1, 2].map(i => parseInt(h[i] + h[i], 16));
  if (h.length === 6) return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  return null;
}

/** `rgb(22, 120, 62)` and `#16783e` are the same colour; compare normalized. */
function colorEquals(a, b) {
  const na = normColor(a);
  const nb = normColor(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const toRgb = v => {
    const m = /^rgba?\((\d+),(\d+),(\d+)/.exec(v);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    if (v.startsWith('#')) return hexToRgb(v);
    return null;
  };
  const ra = toRgb(na);
  const rb = toRgb(nb);
  return !!(ra && rb && ra[0] === rb[0] && ra[1] === rb[1] && ra[2] === rb[2]);
}

function parsePx(v) {
  const m = /^(-?[\d.]+)px$/.exec(String(v || '').trim());
  return m ? Number(m[1]) : null;
}

/**
 * Scope is derived by counting, never by judging importance. Two mechanical
 * guards keep the counting from pretending to be a decision:
 *
 *  - `global` needs *every* source page **and at least two families**. Without
 *    the family clause, a weather idiom that happens to occur in three weather
 *    states would read as a house-wide rule — and the brief for this suite is
 *    explicit that weather-specific design must not be promoted automatically.
 *  - everything else is `page-family` or `page`, and the rationale says so in
 *    words, because the string is what a designer actually reads.
 */
let FAMILY_OF = null;

function scopeOf(pages, allPages, families) {
  const uniqPages = uniq(pages).filter(Boolean).sort();
  const total = allPages.length;
  const n = uniqPages.length;
  const famOf = families || FAMILY_OF || {};
  const fams = uniq(uniqPages.map(p => famOf[p]).filter(Boolean));
  const coversAll = n >= total;
  const crossesFamily = fams.length >= 2;
  let level;
  let rationale;
  if (coversAll && crossesFamily) {
    level = 'global';
    rationale = `在全部 ${total} 个已确认原型的页面中出现（${uniqPages.join('、')}，跨 ${fams.join('/')} 两族）——范围来自出现次数，不是设计判断`;
  } else if (coversAll) {
    level = 'page-family';
    rationale = `覆盖全部页面但只出现在 ${fams.join('/') || '同一'} 一族里（${uniqPages.join('、')}）：属于该族的做法，不得据此声称是全局规范`;
  } else if (n >= 2) {
    level = 'page-family';
    rationale = `在 ${n}/${total} 个页面中出现（${uniqPages.join('、')}），未覆盖 ${allPages.filter(p => !uniqPages.includes(p)).join('、')}`;
  } else {
    level = 'page';
    rationale = `只在 ${uniqPages.join('、')} 中出现；不得当作全局规范`;
  }
  return { level, pages: uniqPages, families: fams, rationale };
}

function confidenceOf(kind, instances, agrees) {
  if (kind === 'measured') {
    if (instances >= 3 && agrees) return 'high';
    if (instances >= 2) return 'medium';
    return 'low';
  }
  if (kind === 'observed') return instances >= 4 ? 'medium' : 'low';
  return 'low';
}

/**
 * Evidence arrays are capped so the artifact stays readable, but a cap must not
 * cut a page out of its own rule: `scope` says "this holds on weather too" and
 * a reader has to be able to see at least one weather instance. So the first
 * instance of every page is always kept, then the cap is filled in order.
 */
function capEvidence(list, max) {
  const kept = [];
  const seenPage = new Set();
  for (const e of list) {
    if (e && e.page && !seenPage.has(e.page)) { seenPage.add(e.page); kept.push(e); }
  }
  for (const e of list) {
    if (kept.length >= max) break;
    if (!kept.includes(e)) kept.push(e);
  }
  return kept.slice(0, Math.max(max, kept.length && seenPage.size));
}

function rule(parts) {
  if (!parts.evidence || !parts.evidence.length) {
    throw new Error(`rule ${parts.id} has no evidence — refusing to emit a claim without a source`);
  }
  const out = {
    id: parts.id,
    category: parts.category,
    kind: parts.kind,
    statement: parts.statement,
    value: parts.value === undefined ? null : parts.value,
    evidence: parts.evidence,
    support: {
      pages: uniq(parts.evidence.map(e => e.page).filter(Boolean)),
      states: uniq(parts.evidence.map(e => `${e.page}/${e.state}`).filter(s => s && !s.endsWith('/undefined'))),
      instances: parts.instances == null ? parts.evidence.length : parts.instances,
      selectors: uniq(parts.evidence.map(e => e.selector).filter(Boolean)).slice(0, 12),
    },
    scope: parts.scope,
    confidence: parts.confidence,
    confirmation: { status: 'candidate', by: null, at: null },
    exceptions: parts.exceptions || [],
  };
  // `notes: null` on every rule would be 120 lines of noise in the artifact and
  // a schema special case; the key simply does not exist when there is no note.
  if (parts.notes) out.notes = parts.notes;
  return out;
}

// ---------------------------------------------------------------------------
// extraction passes
// ---------------------------------------------------------------------------

function indexNodes(snapshot) {
  const byId = new Map();
  for (const n of snapshot.nodes) byId.set(n.id, n);
  return byId;
}

/**
 * Why an affordance is invisible matters: "inside [hidden] overlay" is a design
 * decision (it opens on demand), "opacity 0" is a transition state. Collapsing
 * both into "not visible" would make the DNA unable to say anything useful.
 */
function parentHidden(snapshot, node) {
  const byId = indexNodes(snapshot);
  let cur = node;
  while (cur) {
    if (cur !== node && cur.flags.hiddenAttr) return `${cur.sel}[hidden]`;
    if (cur !== node && cur.visible === false && String(cur.styles['opacity']) === '0') return `${cur.sel}[opacity:0]`;
    cur = cur.parentId ? byId.get(cur.parentId) : null;
  }
  return node.flags.hiddenAttr ? `${node.sel}[hidden]` : (String(node.styles['opacity']) === '0' ? `${node.sel}[opacity:0]` : null);
}

function signatureOf(node, byId) {
  if (IGNORED_TAGS.has(node.tag)) return null;
  const cls = node.classes.filter(c => !STATE_CLASSES.has(c));
  if (cls.length) return node.tag + '.' + cls.slice().sort().join('.');
  const parent = node.parentId ? byId.get(node.parentId) : null;
  if (!parent) return null;
  const pcls = parent.classes.filter(c => !STATE_CLASSES.has(c));
  const hasContext = pcls.length || parent.flags.role || Object.keys(parent.dataAttrs || {}).length;
  if (!hasContext) return null;
  const pSeg = parent.tag + (pcls.length ? '.' + pcls.slice().sort().join('.') : '') + (parent.flags.role ? `[role=${parent.flags.role}]` : '');
  return `${pSeg} > ${node.tag}`;
}

function extractTokens(walk, allPageIds) {
  const rules = [];

  // 1) declared custom properties, resolved, with consumers
  const varRecords = new Map(); // name → {name, values:Set, sheets:Set, pages:Set, consumers, selectors:Set}
  const consumersByVar = new Map();
  for (const page of walk.pages) {
    for (const st of page.states) {
      for (const v of st.snapshot.vars) {
        const rec = varRecords.get(v.name) || { name: v.name, values: new Set(), sheets: new Set(), pages: new Set() };
        rec.values.add(v.resolved || v.value);
        rec.sheets.add(v.sheet);
        rec.pages.add(page.id);
        varRecords.set(v.name, rec);
      }
      for (const u of st.snapshot.varUsage) {
        const rec = consumersByVar.get(u.name) || { count: 0, selectors: new Set(), pages: new Set(), states: new Set() };
        rec.count += u.count;
        u.selectors.forEach(s => rec.selectors.add(s));
        rec.pages.add(page.id);
        rec.states.add(st.id);
        consumersByVar.set(u.name, rec);
      }
    }
  }

  for (const [name, rec] of [...varRecords.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const consumer = consumersByVar.get(name);
    const resolved = [...rec.values];
    const evidence = [];
    for (const page of walk.pages) {
      for (const st of page.states) {
        const decl = st.snapshot.vars.find(v => v.name === name);
        if (!decl) continue;
        evidence.push({
          type: 'custom-property',
          page: page.id,
          state: st.id,
          source: `${page.file} · ${decl.sheet}`,
          selector: decl.selector,
          prop: name,
          value: decl.resolved || decl.value,
        });
      }
    }
    const kind = consumer && consumer.count > 0 ? 'measured' : 'observed';
    rules.push(rule({
      id: `token.var.${name.replace(/^--/, '')}`,
      category: 'token',
      kind,
      statement: `${name} = ${resolved.join(' / ')}` + (consumer ? `，被 ${consumer.count} 处声明引用（${[...consumer.selectors].slice(0, 3).join('、')}${consumer.selectors.size > 3 ? ' 等' : ''}）` : '，本轮未发现消费者'),
      value: {
        name,
        resolved,
        declaredIn: [...rec.sheets],
        consumers: consumer ? { count: consumer.count, selectors: [...consumer.selectors].slice(0, 12) } : { count: 0, selectors: [] },
        group: /(color|green|ink|muted|line|pale|soft)/.test(name) ? 'color'
          : /(width|height|radius|size|gap)/.test(name) ? 'size'
            : /(duration|delay|ease|transition)/.test(name) ? 'motion' : 'other',
      },
      evidence,
      instances: evidence.length,
      scope: scopeOf([...rec.pages], allPageIds),
      confidence: kind === 'measured' ? (consumer.count >= 3 ? 'high' : 'medium') : 'low',
      exceptions: consumer ? [] : [{ page: [...rec.pages].join(','), note: '声明但未被任何规则通过 var() 引用——可能是留给运行时的钩子，也可能是死 token' }],
    }));
  }

  // 2) literal colour inventory — honesty about what is NOT tokenised.
  // Counted once per *declaration* (sheet + rule order), not once per page: the
  // same stylesheet is loaded by more than one prototype, and counting per page
  // multiplied every literal by the number of pages that link it.
  const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/g;
  const literal = new Map();
  const seenDecl = new Set();
  for (const page of walk.pages) {
    for (const st of page.states) {
      for (const cssRule of st.snapshot.css) {
        if (!st.snapshot.sheets.some(s => s.name === cssRule.sheet)) continue;
        for (const prop of Object.keys(cssRule.decls)) {
          if (!/color|shadow|background|border/.test(prop)) continue;
          const hits = cssRule.decls[prop].match(COLOR_RE);
          if (!hits) continue;
          for (const raw of hits) {
            const v = normColor(raw);
            const dedupeKey = `${cssRule.sheet}|${cssRule.order}|${v}`;
            if (seenDecl.has(dedupeKey)) continue;
            seenDecl.add(dedupeKey);
            const rec = literal.get(v) || { value: v, count: 0, pages: new Set(), selectors: new Set(), props: {} };
            rec.count++;
            rec.pages.add(page.id);
            rec.selectors.add(cssRule.selector);
            rec.props[prop] = (rec.props[prop] || 0) + 1;
            literal.set(v, rec);
          }
        }
      }
      break;   // stylesheets are identical across states of a page
    }
  }
  const tokenValues = [...varRecords.values()].flatMap(r => [...r.values]).map(normColor);
  const untokenised = [...literal.values()].filter(c => !tokenValues.includes(normColor(c.value)));
  const repeated = untokenised.filter(c => c.count >= 3).sort((a, b) => b.count - a.count);
  if (repeated.length) {
    rules.push(rule({
      id: 'token.literal-colours',
      category: 'token',
      kind: 'measured',
      statement: `样式表里有 ${untokenised.length} 个未 token 化的色值，其中 ${repeated.length} 个重复出现 ≥3 次（最高 ${repeated[0].value} × ${repeated[0].count}）`,
      value: {
        untokenisedCount: untokenised.length,
        repeated: repeated.slice(0, 40).map(c => ({ value: c.value, count: c.count, pages: [...c.pages], selectors: [...c.selectors].slice(0, 4), props: c.props })),
      },
      evidence: repeated.slice(0, 15).map(c => ({
        type: 'css-literal-colour', page: [...c.pages][0], state: null,
        source: 'stylesheet declaration', selector: [...c.selectors][0] || null, prop: Object.keys(c.props)[0], value: c.value,
        count: c.count,
      })),
      instances: repeated.length,
      scope: scopeOf([...new Set(untokenised.flatMap(c => [...c.pages]))], allPageIds),
      confidence: 'medium',
      exceptions: [],
      notes: '这是缺陷证据，不是规范：这些字面量应逐步收敛到 --token；统计口径为“样式表声明里的颜色字面量”，不含计算值继承。',
    }));
  }

  // 3) type / radius / weight scales
  // Computed font-weight is 400 on almost every node because it is the default;
  // that is the initial value, not a design decision. Only weights the
  // stylesheets actually declare are reported as weight tokens.
  const declaredWeight = new Set();
  for (const page of walk.pages) {
    for (const cssRule of page.states[0].snapshot.css) {
      const v = cssRule.decls['font-weight'];
      if (!v) continue;
      declaredWeight.add(String(v).trim() === 'bold' ? '700' : String(v).trim());
    }
  }
  const scales = { 'font-size': new Map(), 'font-weight': new Map(), 'border-radius': new Map(), 'box-shadow': new Map() };
  for (const page of walk.pages) {
    for (const st of page.states) {
      for (const n of st.snapshot.nodes) {
        if (!n.visible) continue;
        for (const prop of Object.keys(scales)) {
          const v = n.styles[prop];
          if (!v || v === 'none' || v === 'normal' || v === '0px' || v === 'auto') continue;
          if (prop === 'font-weight' && !declaredWeight.has(v)) continue;
          // only text-bearing nodes contribute type; only surface nodes contribute radius/shadow
          if (prop === 'font-size' && !n.isLeaf && !n.children.length) continue;
          const key = `${prop}|${v}`;
          const rec = scales[prop].get(key) || { prop, value: v, nodes: 0, selectors: new Set(), pages: new Set(), states: new Set() };
          rec.nodes++;
          rec.selectors.add(n.sel);
          rec.pages.add(page.id);
          rec.states.add(st.id);
          scales[prop].set(key, rec);
        }
      }
    }
  }
  for (const [prop, map] of Object.entries(scales)) {
    for (const rec of [...map.values()].sort((a, b) => (parsePx(b.value) || 0) - (parsePx(a.value) || 0))) {
      const px = parsePx(rec.value);
      const sortKey = prop === 'font-size' ? 'size' : prop === 'font-weight' ? 'weight' : prop === 'border-radius' ? 'radius' : 'shadow';
      rules.push(rule({
        id: `token.${sortKey}.${slug(rec.value)}`,
        category: 'token',
        kind: 'measured',
        statement: `${prop} ${rec.value}：${rec.nodes} 个节点（${[...rec.pages].join('、')}）`,
        value: {
          prop,
          value: rec.value,
          px,
          nodes: rec.nodes,
          selectors: [...rec.selectors].slice(0, 12),
          displaySample: null,
        },
        evidence: [...rec.pages].slice(0, 6).map(p => ({
          type: 'computed-style', page: p, state: [...rec.states][0],
          source: 'computed style', selector: [...rec.selectors][0], prop, value: rec.value, nodes: rec.nodes,
        })),
        instances: rec.nodes,
        scope: scopeOf([...rec.pages], allPageIds),
        confidence: confidenceOf('measured', rec.nodes, true),
        exceptions: [],
      }));
    }
  }

  return rules;
}

function extractComponents(walk, allPageIds) {
  const groups = new Map();
  for (const page of walk.pages) {
    const perPagePaths = new Map(); // path → group record  (dedupe across states)
    for (const st of page.states) {
      const byId = indexNodes(st.snapshot);
      for (const n of st.snapshot.nodes) {
        if (!n.visible) continue;
        const sig = signatureOf(n, byId);
        if (!sig) continue;
        if (n.depth === 0) continue;
        const key = sig;
        const g = groups.get(key) || { signature: sig, instances: [], pages: new Set() };
        groups.set(key, g);
        g.pages.add(page.id);
        const pathKey = `${page.id}|${n.path}`;
        const seen = perPagePaths.get(pathKey);
        const inst = {
          page: page.id, state: st.id, selector: n.sel, path: n.path,
          ownClass: n.classes.some(c => !STATE_CLASSES.has(c)),
          rect: n.rect, styles: n.styles, childTags: n.childTags, text: (n.text || '').slice(0, 40),
        };
        if (seen) { seen.states.add(st.id); continue; }
        inst.states = new Set([st.id]);
        perPagePaths.set(pathKey, inst);
        g.instances.push(inst);
      }
    }
  }

  const out = [];
  for (const g of groups.values()) {
    if (g.instances.length < 2) continue;
    const byPage = new Map();
    for (const i of g.instances) byPage.set(i.page, (byPage.get(i.page) || 0) + 1);
    const pagesWith2 = [...byPage.entries()].filter(([, n]) => n >= 2).map(([p]) => p);
    if (!pagesWith2.length) continue;   // repetition has to be shown inside one page
    const ownClass = g.instances.some(i => i.ownClass);
    // A `parent > tag` signature is a sub-part (a tab inside a tablist), not a
    // named component; keep it only when repetition is strong enough to be a
    // pattern rather than an artifact of two siblings existing.
    if (!ownClass && g.instances.length < 4) continue;

    const consensus = {};
    const varies = {};
    for (const prop of CONSENSUS_PROPS) {
      const values = uniq(g.instances.map(i => i.styles[prop]).filter(v => v != null && v !== ''));
      if (!values.length) continue;
      if (values.length === 1) consensus[prop] = values[0];
      else varies[prop] = values.slice(0, 5);
    }
    const heights = g.instances.map(i => i.rect.h).filter(h => h > 0);
    const widths = g.instances.map(i => i.rect.w).filter(w => w > 0);
    const id = `component.${slug(g.signature)}`;
    // A median is a summary, not the height. Printing only the median next to
    // "N 个实例" reads as "the component is this tall" and hides the spread the
    // rule's own `varies`/exceptions already know about — so when the instances
    // disagree, say the range and keep the median as a parenthetical.
    const heightSpread = heights.length ? uniq(heights.map(h => round(h, 1))) : [];
    const heightTxt = !heights.length ? ''
      : heightSpread.length > 1
        ? `，高 ${Math.min(...heightSpread)}–${Math.max(...heightSpread)}px（中位 ${round(median(heights), 1)}px）`
        : `，高 ${heightSpread[0]}px`;
    const fontTxt = consensus['font-size'] ? ` · ${consensus['font-size']} 字号` : '';
    const radiusTxt = consensus['border-radius'] && consensus['border-radius'] !== '0px' ? ` · 圆角 ${consensus['border-radius']}` : '';
    // The values are what makes a variant usable; naming only the property
    // ("属性不一致：height") tells the reader to go dig in the JSON, which is
    // exactly the step a summary exists to save.
    const varyKeys = Object.keys(varies);
    const varyTxt = varyKeys.length;
    const shownVaries = varyKeys.slice(0, 4)
      .map(k => `${k}（${varies[k].join(' / ')}）`)
      .join('、') + (varyKeys.length > 4 ? ` 等 ${varyKeys.length} 项` : '');
    out.push(rule({
      id,
      category: 'component',
      kind: 'measured',
      statement: `${g.signature}：${g.instances.length} 个实例${heightTxt}${fontTxt}${radiusTxt}`,
      value: {
        level: ownClass ? 'component' : 'subpart',
        signature: g.signature,
        instancesPerPage: Object.fromEntries([...byPage.entries()]),
        box: { medianHeight: round(median(heights), 1), medianWidth: round(median(widths), 1), minHeight: heights.length ? round(Math.min(...heights), 1) : null },
        consensus,
        varies,
        childTags: uniq(g.instances.map(i => i.childTags).filter(Boolean)).slice(0, 6),
        sampleTexts: uniq(g.instances.map(i => i.text).filter(Boolean)).slice(0, 4),
      },
      evidence: capEvidence(g.instances.map(i => ({
        type: 'component-instance', page: i.page, state: [...i.states][0],
        source: 'rendered node', selector: i.selector, prop: 'rect', value: `${round(i.rect.w, 1)}×${round(i.rect.h, 1)}`,
        path: i.path,
      })), 10),
      instances: g.instances.length,
      scope: scopeOf([...g.pages], allPageIds),
      confidence: confidenceOf('measured', g.instances.length, Object.keys(varies).length === 0),
      exceptions: varyTxt
        ? [{ page: [...g.pages].join(','), note: `实例间不一致的属性：${shownVaries}（变体，不是规范）` }]
        : [],
    }));
  }
  return out.sort((a, b) => b.support.instances - a.support.instances);
}

/**
 * Ordered most-specific-first on purpose: `.list-end` used to be read as 内容区
 * because the generic `/list|content/` pattern matched before the footer one,
 * which made the activity list end with "内容区 → 内容区" — a wrong claim about
 * the page, not just an ugly label. Every hit records the pattern that produced
 * it so the evidence can explain why a block got its role.
 */
const SECTION_ROLES = [
  [/list-end|footnote|preview-footer/, '页脚说明'],
  [/bottom-nav|tabbar/, '主导航'],
  [/hero|cover|photo/, '主视觉'],
  [/stats|metrics/, '指标带'],
  [/(^|[^a-z])actions?([^a-z]|$)|toolbar|cta/, '操作区'],
  [/recent|history/, '最近记录'],
  [/tablist|tabs|browse-tabs/, '视图切换'],
  [/search/, '搜索'],
  [/filter/, '筛选'],
  [/(^|[^a-z])header([^a-z]|$)|page-header|explore-header|weather-header|activity-summary/, '页头'],
  [/content|body|rows|list/, '内容区'],
];

function roleOf(node) {
  const probe = `${node.classes.join(' ')} ${node.sel}`.toLowerCase();
  for (const [re, role] of SECTION_ROLES) if (re.test(probe)) return { role, pattern: String(re), basis: 'class-name' };
  if (node.flags.role === 'tablist') return { role: '视图切换', pattern: null, basis: 'aria-role' };
  return { role: '区块', pattern: null, basis: 'fallback' };
}

function extractPagePatterns(walk, allPageIds, sourcesByPage) {
  const rules = [];
  for (const page of walk.pages) {
    const def = sourcesByPage[page.id] || {};
    const screenStates = page.states.filter(st => {
      const stateDef = (def.states || []).find(s => s.id === st.id) || {};
      return stateDef.screen === true;
    });
    if (!screenStates.length) {
      rules.push(rule({
        id: `page.${page.id}`,
        category: 'page',
        kind: 'observed',
        statement: `${page.id}：sources.json 未把任何状态标记为独立屏，本页不产出结构规则`,
        value: { screens: [] },
        evidence: [{ type: 'extract-gap', page: page.id, state: page.states[0].id, source: 'sources.json', selector: null, prop: 'screen', value: false }],
        instances: 1,
        scope: scopeOf([page.id], allPageIds),
        confidence: 'low',
        exceptions: [{ page: page.id, note: '未标注是提取配置缺口，不代表页面没有结构' }],
      }));
      continue;
    }
    for (const st of screenStates) {
      const stateDef = (def.states || []).find(s => s.id === st.id) || {};
      const rootSel = stateDef.sectionRoot || def.sectionRoot || null;
      const snapshot = st.snapshot;
      const rootNode = rootSel
        ? snapshot.nodes.find(n => n.sel === rootSel || n.path === rootSel || (n.selectors || []).includes(rootSel))
        : null;
      const byId = indexNodes(snapshot);
      const sections = rootNode
        ? rootNode.children.map(id => byId.get(id)).filter(n => n && n.visible).sort((a, b) => a.rect.y - b.rect.y)
        : [];
      if (!sections.length) {
        rules.push(rule({
          id: `page.${page.id}.${st.id}`,
          category: 'page',
          kind: 'observed',
          statement: `${page.id}/${st.id}：未定位到 section 根（${rootSel || '未声明'}）或根下无可视子区块`,
          value: { sectionRoot: rootSel, sections: [] },
          evidence: [{ type: 'walker-miss', page: page.id, state: st.id, source: 'sources.json', selector: rootSel, prop: 'sectionRoot', value: rootNode ? 'root found / no visible children' : 'root not found' }],
          instances: 1,
          scope: scopeOf([page.id], allPageIds),
          confidence: 'low',
          exceptions: [{ page: page.id, note: '定位失败是提取缺陷，不代表页面没有结构' }],
        }));
        continue;
      }
      const marked = sections.map((n, i) => {
        const r = roleOf(n);
        const tabCount = n.flags.role === 'tablist'
          ? n.children.map(id => byId.get(id)).filter(k => k && k.flags.role === 'tab').length
          : null;
        return {
          order: i + 1,
          selector: n.sel,
          classes: n.classes,
          role: r.role,
          roleBasis: r.basis,
          rolePattern: r.pattern,
          tabCount,
          rect: n.rect,
          textSample: (n.text || '').slice(0, 30),
          keyStyles: ['padding', 'margin', 'gap', 'border-top-width', 'background-color', 'font-size']
            .reduce((acc, p) => { if (n.styles[p]) acc[p] = n.styles[p]; return acc; }, {}),
        };
      });
      // Two adjacent blocks can honestly share a role (the weather screen really
      // has a day selector and a view selector stacked). Saying "视图切换 → 视图切换"
      // hides that difference, so repeated roles get their own selector appended
      // and the statement stays readable without inventing a new role.
      const counts = new Map();
      for (const s of marked) counts.set(s.role, (counts.get(s.role) || 0) + 1);
      const mapped = marked.map(s => ({
        ...s,
        label: counts.get(s.role) > 1 ? `${s.role}(${s.selector})` : s.role,
      }));
      const rhythm = [];
      for (let i = 1; i < mapped.length; i++) {
        rhythm.push({ from: mapped[i - 1].selector, to: mapped[i].selector, gap: round(mapped[i].rect.y - (mapped[i - 1].rect.y + mapped[i - 1].rect.h), 2) });
      }
      rules.push(rule({
        id: `page.${page.id}.${st.id}`,
        category: 'page',
        kind: 'measured',
        statement: `${page.id}/${st.id}：${mapped.length} 个纵向区块，顺序 ${mapped.map(s => s.label).join(' → ')}`,
        value: { sectionRoot: rootSel, sections: mapped, rhythm },
        evidence: mapped.map(s => ({
          type: 'section', page: page.id, state: st.id, source: 'rendered section',
          selector: s.selector, prop: 'role',
          value: `${s.role}（依据：${s.roleBasis}${s.rolePattern ? ' ' + s.rolePattern : ''}）y=${s.rect.y} h=${s.rect.h}`,
        })),
        instances: mapped.length,
        scope: scopeOf([page.id], allPageIds),
        confidence: mapped.length >= 3 ? 'medium' : 'low',
        exceptions: mapped.filter(s => s.roleBasis === 'fallback')
          .map(s => ({ page: page.id, selector: s.selector, note: '按类名判不出语义角色，记为「区块」；这是提取器的上限，不是页面的结构' })),
      }));
    }
  }

  // shared phone frame — the one structure all three prototypes share
  const frameParts = ['statusbar', 'wechatbar', 'bottom-nav', 'home-indicator'];
  const frameEvidence = [];
  const frameValues = {};
  for (const page of walk.pages) {
    const st = page.states[0];
    const byId = indexNodes(st.snapshot);
    for (const cls of frameParts) {
      const n = st.snapshot.nodes.find(x => x.classes.includes(cls) && x.visible);
      if (!n) continue;
      frameEvidence.push({
        type: 'frame-part', page: page.id, state: st.id, source: 'rendered node',
        selector: n.sel, prop: 'rect', value: `${round(n.rect.w, 1)}×${round(n.rect.h, 1)}`,
      });
      const rec = frameValues[cls] || { heights: [], pages: new Set() };
      rec.heights.push(round(n.rect.h, 1));
      rec.pages.add(page.id);
      frameValues[cls] = rec;
    }
    void byId;
  }
  if (frameEvidence.length) {
    const summary = Object.entries(frameValues).map(([k, v]) => `${k} ${uniq(v.heights).join('/')}px`).join('，');
    rules.push(rule({
      id: 'page.phone-frame',
      category: 'page',
      kind: 'measured',
      statement: `三页共用手机外壳（${summary}）`,
      value: {
        parts: Object.fromEntries(Object.entries(frameValues).map(([k, v]) => [k, { heights: uniq(v.heights), pages: [...v.pages] }])),
      },
      evidence: frameEvidence,
      instances: frameEvidence.length,
      scope: scopeOf(frameEvidence.map(e => e.page), allPageIds),
      confidence: 'high',
      exceptions: [],
    }));
  }
  return rules;
}

function extractInteractions(walk, allPageIds) {
  const rules = [];
  const evidence = [];
  const tablists = new Map();
  const dialogs = [];
  const status = [];
  const fields = [];
  const toggles = new Map();

  for (const page of walk.pages) {
    const classStates = new Map(); // path → {classes:Set, page, states:Set}
    const seenDialog = new Set();
    const seenStatus = new Set();
    for (const st of page.states) {
      const snapshot = st.snapshot;
      for (const n of snapshot.nodes) {
        // Affordances are declared in the DOM whether or not this state shows
        // them: the sheet lives inside a hidden overlay and the toast sits at
        // opacity 0 until it says something. Skipping invisible nodes outright
        // made v0.1 report "no dialog, no toast" for a prototype that has both,
        // so these two are collected unconditionally and their visibility is
        // recorded as part of the evidence instead of used as a filter.
        if (n.flags.role === 'dialog') {
          const key = `${page.id}|${n.sel}`;
          if (!seenDialog.has(key)) {
            seenDialog.add(key);
            dialogs.push({ page: page.id, state: st.id, selector: n.sel, modal: n.flags.ariaModal, tabindex: n.flags.tabindex, visible: n.visible, hiddenBy: parentHidden(snapshot, n) });
          }
        }
        if (n.flags.role === 'status') {
          const key = `${page.id}|${n.sel}`;
          if (!seenStatus.has(key)) {
            seenStatus.add(key);
            status.push({ page: page.id, state: st.id, selector: n.sel, visible: n.visible, hiddenBy: parentHidden(snapshot, n) });
          }
        }
        if (!n.visible && !n.flags.hiddenAttr) continue;
        if (n.flags.role === 'tablist') {
          const kids = n.children.map(id => snapshot.nodes.find(x => x.id === id)).filter(Boolean);
          const tabs = kids.filter(k => k.flags.role === 'tab');
          if (tabs.length >= 2) {
            const key = `${page.id}|${n.sel}`;
            tablists.set(key, { page: page.id, selector: n.sel, tabs: tabs.map(t => t.sel), stateAttr: tabs.every(t => t.flags.ariaSelected != null) ? 'aria-selected' : null });
          }
        }
        if (n.tag === 'input' || n.tag === 'textarea') {
          fields.push({ page: page.id, state: st.id, selector: n.sel, type: n.dataAttrs && n.dataAttrs.type ? n.dataAttrs.type : null, style: n.styles });
        }
        if (!classStates.has(n.path)) classStates.set(n.path, { page: page.id, classes: new Set(n.classes), states: new Set() });
        classStates.get(n.path).states.add(st.id);
        classStates.get(n.path).lastClasses = new Set(n.classes);
        classStates.get(n.path).selector = n.sel;
      }
    }
    // toggles: same element path, different class sets across states of this page
    for (const rec of classStates.values()) {
      if (rec.states.size < 2) continue;
      const diff = [...rec.lastClasses].filter(c => STATE_CLASSES.has(c));
      if (!diff.length) continue;
      const key = `${rec.selector}|${diff.sort().join(',')}`;
      const t = toggles.get(key) || { page: page.id, selector: rec.selector, classes: diff.sort(), states: [...rec.states] };
      toggles.set(key, t);
    }
  }

  for (const [key, t] of tablists) {
    evidence.push({ type: 'tablist', page: t.page, state: null, source: 'ARIA role', selector: t.selector, prop: 'role', value: `tablist(${t.tabs.length})` });
    void key;
  }
  if (evidence.length) {
    rules.push(rule({
      id: 'interaction.tablist',
      category: 'interaction',
      kind: 'measured',
      statement: `视图切换使用 role=tablist/tab 与 aria-selected 表达选中，共 ${tablists.size} 处`,
      value: { tablists: [...tablists.values()] },
      evidence,
      instances: tablists.size,
      scope: scopeOf(evidence.map(e => e.page), allPageIds),
      confidence: tablists.size >= 3 ? 'high' : 'medium',
      exceptions: [],
    }));
  }

  if (dialogs.length) {
    const pages = uniq(dialogs.map(d => d.page));
    const hidden = dialogs.filter(d => !d.visible);
    rules.push(rule({
      id: 'interaction.dialog-sheet',
      category: 'interaction',
      kind: 'measured',
      statement: `浮层使用 role=dialog${dialogs.every(d => d.modal === 'true') ? ' + aria-modal=true' : ''}，共 ${dialogs.length} 个元素`
        + (hidden.length ? `（其中 ${hidden.length} 个在采集状态里是关闭的，只证明契约存在，不证明实际观感）` : ''),
      value: { dialogs },
      evidence: dialogs.map(d => ({
        type: 'dialog', page: d.page, state: d.state, source: 'ARIA role', selector: d.selector, prop: 'role',
        value: `dialog modal=${d.modal} visible=${d.visible}${d.hiddenBy ? ' hiddenBy ' + d.hiddenBy : ''}`,
      })),
      instances: dialogs.length,
      scope: scopeOf(pages, allPageIds),
      confidence: hidden.length === dialogs.length ? 'medium' : 'high',
      exceptions: [],
    }));
  }

  if (status.length) {
    const hiddenStatus = status.filter(s => !s.visible);
    rules.push(rule({
      id: 'interaction.status-toast',
      category: 'interaction',
      kind: 'measured',
      statement: `轻提示使用 role=status（${status.length} 处）`
        + (hiddenStatus.length ? `，采集时 ${hiddenStatus.length} 处处于不可见状态（${uniq(hiddenStatus.map(s => s.hiddenBy || 'unknown')).join('、')}）` : ''),
      value: { status },
      evidence: status.map(s => ({
        type: 'status-region', page: s.page, state: s.state, source: 'ARIA role', selector: s.selector, prop: 'role',
        value: `status visible=${s.visible}${s.hiddenBy ? ' hiddenBy ' + s.hiddenBy : ''}`,
      })),
      instances: status.length,
      scope: scopeOf(uniq(status.map(s => s.page)), allPageIds),
      confidence: hiddenStatus.length === status.length ? 'low' : 'medium',
      exceptions: hiddenStatus.map(s => ({ page: s.page, selector: s.selector, note: '提示只在触发时出现；本轮没有触发它，因此样式与时长均未测量' })),
    }));
  }

  if (fields.length) {
    rules.push(rule({
      id: 'interaction.text-field',
      category: 'interaction',
      kind: 'measured',
      statement: `输入控件 ${fields.length} 个，${fields.filter(f => f.style && parsePx(f.style['font-size']) >= 14).length} 个字号 ≥14px（移动端防缩放）`,
      value: {
        fields: fields.map(f => ({
          page: f.page, selector: f.selector,
          height: f.style ? parsePx(f.style.height) : null,
          fontSize: f.style ? parsePx(f.style['font-size']) : null,
          background: f.style ? f.style['background-color'] : null,
        })),
      },
      evidence: fields.map(f => ({ type: 'input', page: f.page, state: f.state, source: 'rendered node', selector: f.selector, prop: 'font-size', value: f.style ? f.style['font-size'] : null })),
      instances: fields.length,
      scope: scopeOf(uniq(fields.map(f => f.page)), allPageIds),
      confidence: 'medium',
      exceptions: [],
    }));
  }

  if (toggles.size) {
    rules.push(rule({
      id: 'interaction.state-class-toggles',
      category: 'interaction',
      kind: 'observed',
      statement: `状态切换通过类名表达（${[...toggles.values()].map(t => `${t.selector}↔${t.classes.join('/')}`).slice(0, 6).join('，')}）`,
      value: { toggles: [...toggles.values()] },
      evidence: [...toggles.values()].map(t => ({ type: 'class-toggle', page: t.page, state: t.states.join('|'), source: 'cross-state diff', selector: t.selector, prop: 'class', value: t.classes.join(' ') })),
      instances: toggles.size,
      scope: scopeOf(uniq([...toggles.values()].map(t => t.page)), allPageIds),
      confidence: 'medium',
      exceptions: [{ page: 'all', note: '类名开关本身不是可访问性保证：同一状态的 ARIA 属性必须同时更新才算达标' }],
    }));
  }
  return rules;
}

function extractPrinciples(walk, allPageIds) {
  const rules = [];
  const green = (() => {
    for (const page of walk.pages) {
      for (const st of page.states) {
        const v = st.snapshot.vars.find(x => x.name === '--green');
        if (v) return v.resolved;
      }
    }
    return null;
  })();
  const line = (() => {
    for (const page of walk.pages) {
      for (const st of page.states) {
        const v = st.snapshot.vars.find(x => x.name === '--line');
        if (v) return v.resolved;
      }
    }
    return null;
  })();

  // tap targets
  const interactive = [];
  for (const page of walk.pages) {
    const st = page.states[0];
    for (const n of st.snapshot.nodes) {
      if (!n.visible) continue;
      const isInteractive = n.tag === 'button' || n.tag === 'a' || n.tag === 'input' ||
        n.flags.role === 'tab' || n.flags.role === 'button';
      if (!isInteractive) continue;
      interactive.push({ page: page.id, selector: n.sel, h: n.rect.h, w: n.rect.w });
    }
  }
  if (interactive.length) {
    const heights = interactive.map(i => i.h);
    const small31 = interactive.filter(i => i.h < 31);
    const small44 = interactive.filter(i => i.h < 44);
    rules.push(rule({
      id: 'principle.tap-target',
      category: 'principle',
      kind: 'observed',
      statement: `可点区高度中位数 ${round(median(heights), 1)}px；${small31.length}/${interactive.length} 个 <31px，${small44.length}/${interactive.length} 个 <44px`,
      value: {
        count: interactive.length,
        median: round(median(heights), 1),
        min: round(Math.min(...heights), 1),
        max: round(Math.max(...heights), 1),
        under31: small31.map(i => ({ page: i.page, selector: i.selector, h: round(i.h, 1) })),
        under44: small44.map(i => ({ page: i.page, selector: i.selector, h: round(i.h, 1) })),
        target44Share: round((interactive.length - small44.length) / interactive.length, 3),
      },
      evidence: capEvidence(interactive.map(i => ({ type: 'tap-target', page: i.page, state: 'primary', source: 'rendered rect', selector: i.selector, prop: 'height', value: `${round(i.h, 1)}px` })), 20),
      instances: interactive.length,
      scope: scopeOf(uniq(interactive.map(i => i.page)), allPageIds),
      confidence: 'medium',
      exceptions: small44.slice(0, 10).map(i => ({ page: i.page, selector: i.selector, note: `高 ${round(i.h, 1)}px，低于 44px 触控建议` })),
      notes: '44px 是平台建议值，不是本原型的既有规范；这里只报告实测分布，不宣布达标或违规。',
    }));
  }

  // separation: hairline vs shadow
  const hairlines = [];
  const shadows = [];
  for (const page of walk.pages) {
    const st = page.states[0];
    for (const n of st.snapshot.nodes) {
      if (!n.visible) continue;
      if (n.styles['border-top-width'] === '1px' && line && colorEquals(n.styles['border-top-color'], line)) {
        hairlines.push({ page: page.id, selector: n.sel });
      }
      if (n.styles['box-shadow'] && n.styles['box-shadow'] !== 'none') shadows.push({ page: page.id, selector: n.sel, value: n.styles['box-shadow'] });
    }
  }
  if (hairlines.length) {
    rules.push(rule({
      id: 'principle.hairline-separation',
      category: 'principle',
      kind: 'observed',
      statement: `区块分隔主要靠 1px ${line} 上边框（${hairlines.length} 处），阴影 ${shadows.length} 处只用于外壳与浮层`,
      value: { hairlineCount: hairlines.length, shadowCount: shadows.length, hairlineSelectors: hairlines.slice(0, 20).map(h => h.selector), shadows: shadows.slice(0, 10) },
      evidence: capEvidence(hairlines.map(h => ({ type: 'hairline', page: h.page, state: 'primary', source: 'computed style', selector: h.selector, prop: 'border-top', value: `1px ${line}` })), 15),
      instances: hairlines.length,
      scope: scopeOf(uniq(hairlines.map(h => h.page)), allPageIds),
      confidence: 'medium',
      exceptions: shadows.length ? [{ page: uniq(shadows.map(s => s.page)).join(','), note: `另有 ${shadows.length} 处 box-shadow（见 value.shadows），与“无卡片阴影”的表述冲突` }] : [],
    }));
  }

  // text scale
  const sizes = new Map();       // px → { nodes, pages:Set, examples:[{page,selector,text}] }
  const tiny = [];
  for (const page of walk.pages) {
    const st = page.states[0];
    for (const n of st.snapshot.nodes) {
      if (!n.visible || !n.styles['font-size']) continue;
      if (!n.isLeaf && !(n.text || '').length) continue;
      const px = parsePx(n.styles['font-size']);
      if (px == null) continue;
      const rec = sizes.get(px) || { nodes: 0, pages: new Set(), examples: [] };
      rec.nodes++;
      rec.pages.add(page.id);
      if (!rec.examples.some(e => e.page === page.id)) {
        rec.examples.push({ page: page.id, selector: n.sel, text: (n.text || '').slice(0, 18) });
      }
      sizes.set(px, rec);
      if (px < 10) tiny.push({ page: page.id, selector: n.sel, px, text: (n.text || '').slice(0, 20) });
    }
  }
  const sizeList = [...sizes.entries()].sort((a, b) => b[0] - a[0]);
  if (sizeList.length) {
    const typeEvidence = [];
    for (const [px, rec] of sizeList.slice(0, 8)) {
      for (const ex of rec.examples) {
        typeEvidence.push({
          type: 'type-size', page: ex.page, state: 'primary', source: 'computed style',
          selector: ex.selector, prop: 'font-size', value: `${px}px（该字号共 ${rec.nodes} 个节点，分布在 ${[...rec.pages].join('/')}）`,
        });
      }
    }
    rules.push(rule({
      id: 'principle.type-hierarchy',
      category: 'principle',
      kind: 'measured',
      statement: `字号阶 ${sizeList.map(([px, rec]) => `${px}px×${rec.nodes}`).join(' / ')}；${tiny.length} 处 <10px`,
      value: { sizes: sizeList.map(([px, rec]) => ({ px, nodes: rec.nodes, pages: [...rec.pages] })), below10: tiny },
      evidence: capEvidence(typeEvidence, 24),
      instances: sizeList.reduce((a, [, rec]) => a + rec.nodes, 0),
      scope: scopeOf(uniq([...sizes.values()].flatMap(rec => [...rec.pages])), allPageIds),
      confidence: 'high',
      exceptions: tiny.slice(0, 10).map(t => ({ page: t.page, selector: t.selector, note: `${t.px}px 正文不可读风险（${t.text}）` })),
    }));
  }

  // primary action colour
  const greenUsers = [];
  for (const page of walk.pages) {
    for (const st of page.states) {
      for (const n of st.snapshot.nodes) {
        if (!n.visible) continue;
        if (green && colorEquals(n.styles['background-color'], green)) greenUsers.push({ page: page.id, state: st.id, selector: n.sel });
      }
    }
  }
  if (green) {
    const pagesWith = uniq(greenUsers.map(g => g.page));
    rules.push(rule({
      id: 'principle.primary-action-green',
      category: 'principle',
      kind: 'measured',
      statement: `${green} 作为主操作底色，出现在 ${greenUsers.length} 个节点 / ${pagesWith.length} 个页面`,
      value: { token: green, nodes: greenUsers.length, byPage: Object.fromEntries(allPageIds.map(p => [p, greenUsers.filter(g => g.page === p).length])), selectors: uniq(greenUsers.map(g => g.selector)).slice(0, 15) },
      evidence: capEvidence(greenUsers.map(g => ({ type: 'brand-fill', page: g.page, state: g.state, source: 'computed style', selector: g.selector, prop: 'background-color', value: green })), 15),
      instances: greenUsers.length,
      scope: scopeOf(pagesWith, allPageIds),
      confidence: 'high',
      exceptions: allPageIds.filter(p => !pagesWith.includes(p)).map(p => ({ page: p, note: '该页没有品牌绿实心底色的节点；可能是文字链或描边按钮' })),
    }));
  }

  // icon rendering — measured on each <svg> itself; the parent's `data-icon`
  // attribute is not on the svg, so the previous key read `data-icon` from the
  // wrong element and printed "dots=no:46" regardless of what the icons are.
  const strokes = new Map();
  const iconEvidence = [];
  const iconPages = new Set();
  let svgCount = 0;
  for (const page of walk.pages) {
    const st = page.states[0];
    for (const n of st.snapshot.nodes) {
      if (n.tag !== 'svg') continue;
      const w = parsePx(n.styles['stroke-width']);
      if (!Number.isFinite(w)) continue;   // svg present but no stroke model
      svgCount++;
      iconPages.add(page.id);
      const filled = n.styles.fill && n.styles.fill !== 'none';
      const key = `${round(w, 2)}px/${filled ? 'filled' : 'outline'}/${n.styles['stroke-linecap'] || 'default'}`;
      strokes.set(key, (strokes.get(key) || 0) + 1);
      iconEvidence.push({
        type: 'icon', page: page.id, state: st.id, source: 'computed style', selector: n.sel, prop: 'stroke-width',
        value: `${n.styles['stroke-width']} stroke=${n.styles.stroke || 'unset'} fill=${n.styles.fill || 'unset'} box=${round(n.rect.w, 1)}×${round(n.rect.h, 1)}`,
      });
    }
  }
  if (svgCount) {
    const dominant = [...strokes.entries()].sort((a, b) => b[1] - a[1])[0];
    rules.push(rule({
      id: 'principle.icon-stroke',
      category: 'principle',
      kind: 'measured',
      statement: `图标为内联 SVG 描边（${svgCount} 个），主流形态 ${dominant[0]}（${dominant[1]}/${svgCount}）`,
      value: { svgCount, distribution: Object.fromEntries(strokes) },
      evidence: capEvidence(iconEvidence, 24),
      instances: svgCount,
      scope: scopeOf([...iconPages], allPageIds),
      confidence: Object.keys(strokes).length === 1 ? 'high' : 'medium',
      exceptions: Object.keys(strokes).length > 1
        ? [{ page: 'all', note: `描边形态不止一种：${[...strokes.keys()].join('、')}` }]
        : [],
      notes: 'v0.1 已知：图标在保真比对里只被当作墨迹，无法区分“同一个盒子里的不同图标”。这里是测量记账，不改变那条限制。',
    }));
  }
  return rules;
}

function extractExceptions(walk, allPageIds) {
  const rules = [];
  // same selector + same property declared by two sheets in different order
  const declIndex = new Map(); // `${selector}|${prop}` → [{sheet, value, order}]
  for (const page of walk.pages) {
    const seenSheets = new Set();
    for (const st of page.states) {
      for (const cssRule of st.snapshot.css) {
        if (seenSheets.has(cssRule.sheet)) continue;   // one pass per sheet per page
        for (const prop of Object.keys(cssRule.decls)) {
          if (/^--/.test(prop)) continue;
          if (!/color|background|border|font-size|font-weight|padding|margin|height|display|opacity/.test(prop)) continue;
          const key = `${cssRule.selector}|${prop}`;
          const list = declIndex.get(key) || [];
          list.push({ page: page.id, sheet: cssRule.sheet, order: cssRule.order, value: cssRule.decls[prop] });
          declIndex.set(key, list);
        }
      }
      // mark sheets as scanned after the first state (they are identical across states)
      st.snapshot.sheets.forEach(s => seenSheets.add(s.name));
      break;
    }
  }
  const overrides = [];
  for (const [key, list] of declIndex.entries()) {
    const bySheet = new Map();
    for (const d of list) if (!bySheet.has(d.sheet)) bySheet.set(d.sheet, d);
    if (bySheet.size < 2) continue;
    const values = uniq([...bySheet.values()].map(v => v.value));
    if (values.length < 2) continue;
    const [selector, prop] = key.split('|');
    overrides.push({
      selector, prop,
      pages: uniq(list.map(d => d.page)).sort(),
      declarations: [...bySheet.values()].map(d => ({ sheet: d.sheet, order: d.order, value: d.value })),
      winner: [...bySheet.values()].sort((a, b) => b.order - a.order)[0],
    });
  }
  if (overrides.length) {
    // One evidence entry per override, on a real page — an override seen only
    // while rendering the weather page is not evidence about the activity list.
    const flat = [];
    for (const o of overrides) {
      for (const pg of o.pages) {
        flat.push({
          type: 'css-override', page: pg, state: null,
          source: o.declarations.map(d => `${d.sheet}#${d.order}`).join(' → '),
          selector: o.selector, prop: o.prop,
          value: `${o.declarations.map(d => d.value).join(' → ')}（生效 ${o.winner.value}）`,
        });
      }
    }
    rules.push(rule({
      id: 'exception.sheet-overrides',
      category: 'exception',
      kind: 'measured',
      statement: `${overrides.length} 条声明被后加载的样式表覆盖（同一选择器同一属性出现两个值）`,
      value: { overrides: overrides.slice(0, 60) },
      evidence: capEvidence(flat, 20),
      instances: overrides.length,
      scope: scopeOf(uniq(flat.map(e => e.page)), allPageIds),
      confidence: 'high',
      exceptions: [],
      notes: '覆盖不一定错误：refinement.css / weather.css 是第二层精修。列为例外是为了让“主按钮是什么颜色”这类问题有唯一答案——答案是最终生效值，不是第一处声明。',
    }));
  }
  return rules;
}

function computeCoverage(walk) {
  const out = [];
  for (const page of walk.pages) {
    const st = page.states[0];
    const byId = indexNodes(st.snapshot);
    const compSigs = new Map();
    for (const n of st.snapshot.nodes) {
      if (!n.visible) continue;
      const sig = signatureOf(n, byId);
      if (!sig) continue;
      compSigs.set(sig, (compSigs.get(sig) || 0) + 1);
    }
    const repeated = new Set([...compSigs.entries()].filter(([, n]) => n >= 2).map(([s]) => s));
    let visible = 0;
    let inComponent = 0;
    const uncovered = new Map();
    for (const n of st.snapshot.nodes) {
      if (!n.visible) continue;
      visible++;
      const sig = signatureOf(n, byId);
      if (sig && repeated.has(sig)) { inComponent++; continue; }
      if (!sig) continue;   // structural wrapper (svg path, bare div) — not a component candidate
      uncovered.set(sig, (uncovered.get(sig) || 0) + 1);
    }
    out.push({
      page: page.id,
      visibleNodes: visible,
      inRepeatedComponent: inComponent,
      share: visible ? round(inComponent / visible, 3) : 0,
      singletonSignatures: [...uncovered.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([sig, n]) => ({ signature: sig, nodes: n })),
      singletonTotal: [...uncovered.values()].reduce((a, b) => a + b, 0),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// orchestration
// ---------------------------------------------------------------------------

async function extract(opts) {
  const o = opts || {};
  const here = __dirname;
  const sourcesPath = o.sources || path.join(here, 'sources.json');
  const sources = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));
  const root = path.resolve(path.dirname(sourcesPath), sources.root);
  if (!fs.existsSync(root)) throw new Error(`prototype root not found: ${root}`);

  const walk = await runWalk({
    serveRoot: root,
    viewport: o.viewport || sources.viewport,
    pages: sources.pages,
  });

  const allPageIds = walk.pages.map(p => p.id);
  FAMILY_OF = Object.fromEntries(walk.pages.map(p => [p.id, p.family]));
  const sourcesByPage = Object.fromEntries(sources.pages.map(p => [p.id, p]));

  const rules = [
    ...extractTokens(walk, allPageIds),
    ...extractComponents(walk, allPageIds),
    ...extractPagePatterns(walk, allPageIds, sourcesByPage),
    ...extractInteractions(walk, allPageIds),
    ...extractPrinciples(walk, allPageIds),
    ...extractExceptions(walk, allPageIds),
  ];

  const byCategory = {};
  for (const r of rules) byCategory[r.category] = (byCategory[r.category] || 0) + 1;
  const byScope = {};
  for (const r of rules) byScope[r.scope.level] = (byScope[r.scope.level] || 0) + 1;
  const byKind = {};
  for (const r of rules) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  const byConfidence = {};
  for (const r of rules) byConfidence[r.confidence] = (byConfidence[r.confidence] || 0) + 1;

  const sourceFiles = uniq(sources.pages.map(p => p.file));
  const fingerprints = {};
  for (const f of sourceFiles) {
    const abs = path.join(root, f);
    if (fs.existsSync(abs)) fingerprints[f] = { sha256: sha256File(abs), bytes: fs.statSync(abs).size };
  }
  for (const f of fs.readdirSync(root)) {
    if (/\.(css|js)$/.test(f) && !sourceFiles.includes(f)) {
      fingerprints[f] = { sha256: sha256File(path.join(root, f)), bytes: fs.statSync(path.join(root, f)).size };
    }
  }

  const warnings = [];
  const literalRule = rules.find(r => r.id === 'token.literal-colours');
  if (literalRule) warnings.push(`${literalRule.value.untokenisedCount} 个色值未 token 化（${literalRule.value.repeated.length} 个重复 ≥3 次）`);
  for (const p of walk.pages) {
    for (const st of p.states) {
      const bad = st.snapshot.sheets.filter(s => s.error);
      if (bad.length) warnings.push(`${p.id}/${st.id}: 样式表不可读 ${bad.map(b => `${b.name}(${b.error})`).join(',')}`);
    }
  }
  const globalCandidates = rules.filter(r => r.scope.level === 'global' && r.category !== 'token' && r.category !== 'component');
  if (globalCandidates.length) {
    warnings.push(`${globalCandidates.length} 条结构性规则在全部页面上成立，但仍只是“全局候选”：未经用户确认不得当作全局规范（${globalCandidates.map(r => r.id).join('、')}）`);
  }

  const dna = {
    schemaVersion: '0.2.0',
    kind: 'design-dna',
    generatedAt: isoNow(),
    generator: { name: 'design-dna-extractor', version: '0.2.0', sourcesPath: path.relative(path.resolve(here, '../..'), sourcesPath).split(path.sep).join('/') },
    viewport: walk.viewport,
    sources: walk.pages.map(p => ({
      id: p.id,
      family: p.family,
      file: p.file,
      root: p.root,
      states: p.states.map(s => ({ id: s.id, query: s.query, steps: s.steps, nodeCount: s.snapshot.nodes.length })),
      fingerprint: fingerprints[p.file] || null,
    })),
    fingerprints,
    coverage: computeCoverage(walk),
    summary: {
      rules: rules.length,
      byCategory,
      byScope,
      byKind,
      byConfidence,
      confirmed: 0,
      candidates: rules.length,
    },
    rules,
    warnings,
    boundaries: [
      '所有规则以 candidate 出库；scope 只由“出现在几个页面”推导，不等于“应当全局使用”。',
      '测量口径为 390×844 视口、Chromium、dpr=1；375/414 断点与微信渲染层不在本轮证据内。',
      '原型是只读知识来源，提取过程不写入、不重排原型目录。',
      '没有用户确认的规则一律不得被下游实现当作规范引用。',
    ],
  };
  return { dna, walk };
}

function renderMarkdown(dna) {
  const lines = [];
  lines.push(`# Design DNA 草案（${dna.generatedAt}）`);
  lines.push('');
  lines.push(`规则 ${dna.summary.rules} 条：` + Object.entries(dna.summary.byCategory).map(([k, v]) => `${k} ${v}`).join(' · '));
  lines.push(`范围：` + Object.entries(dna.summary.byScope).map(([k, v]) => `${k} ${v}`).join(' · ') + `（全部为候选）`);
  lines.push('');
  for (const [cat, label] of [['token', '设计 token'], ['component', '组件模式'], ['page', '页面模式'], ['interaction', '交互模式'], ['principle', '设计原则'], ['exception', '例外']]) {
    const list = dna.rules.filter(r => r.category === cat);
    if (!list.length) continue;
    lines.push(`## ${label}（${list.length}）`);
    lines.push('');
    lines.push('| id | 范围 | 可信度 | 陈述 |');
    lines.push('|---|---|---|---|');
    for (const r of list.slice(0, 80)) lines.push(`| \`${r.id}\` | ${r.scope.level} | ${r.confidence} | ${String(r.statement).replace(/\|/g, '\\|')} |`);
    lines.push('');
  }
  lines.push('## 覆盖与缺口');
  lines.push('');
  for (const c of dna.coverage) lines.push(`- ${c.page}: 可见节点 ${c.visibleNodes}，其中落在重复组件签名内 ${c.inRepeatedComponent}（${Math.round(c.share * 100)}%），单例签名 ${c.singletonTotal}`);
  if (dna.warnings.length) {
    lines.push('');
    lines.push('## 告警');
    for (const w of dna.warnings) lines.push(`- ${w}`);
  }
  return lines.join('\n') + '\n';
}

async function main(argv) {
  const args = argv.slice(2);
  const get = flag => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const outDir = path.resolve(get('--out') || path.join(__dirname, 'out'));
  const exec = await extract({ sources: get('--sources') });
  ensureDir(outDir);
  const dnaFile = path.join(outDir, 'dna.json');
  writeJson(dnaFile, exec.dna);
  fs.writeFileSync(path.join(outDir, 'dna-summary.md'), renderMarkdown(exec.dna), 'utf8');
  if (!args.includes('--quiet')) {
    console.log(`design-dna: ${exec.dna.summary.rules} rules → ${dnaFile}`);
    console.log(`  by category: ` + Object.entries(exec.dna.summary.byCategory).map(([k, v]) => `${k}=${v}`).join(' '));
    console.log(`  by scope:    ` + Object.entries(exec.dna.summary.byScope).map(([k, v]) => `${k}=${v}`).join(' '));
    console.log(`  by kind:     ` + Object.entries(exec.dna.summary.byKind).map(([k, v]) => `${k}=${v}`).join(' '));
    for (const w of exec.dna.warnings) console.log(`  ! ${w}`);
  }
  return exec.dna;
}

module.exports = { extract, renderMarkdown, scopeOf, colorEquals, signatureOf };

if (require.main === module) {
  main(process.argv).catch(e => {
    console.error(`design-dna extract failed: ${e.message}`);
    if (e.stack) console.error(e.stack.split('\n').slice(1, 4).join('\n'));
    process.exit(2);
  });
}

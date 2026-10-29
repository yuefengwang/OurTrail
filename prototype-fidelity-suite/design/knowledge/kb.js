'use strict';
/**
 * Versioned design-knowledge base.
 *
 * The extractor (`design/dna-extract/extract.js`) answers "what does the corpus
 * look like right now". This module answers the three questions that come after
 * a corpus becomes something a team edits:
 *
 *   - **query** — which rules hold for this page / this component / this level,
 *   - **update** — record a change (including a human confirming a rule) with
 *     who made it and what it replaced,
 *   - **conflict** — where two rules in the same store disagree, and
 *   - **impact** — if this rule changes, which components and pages does a
 *     reviewer have to look at again.
 *
 * Two boundaries are deliberately mechanical, because a knowledge base that
 * drifts away from them is worse than no knowledge base:
 *
 *   1. A rule's *subject* is derived from its value, not from its id. Two rules
 *      can only contradict each other if they are about the same subject (the
 *      same CSS variable, the same component signature, the same screen), so
 *      "font-size 16px" and "font-size 17px" never count as a conflict — they
 *      are two entries of one scale.
 *   2. Impact is *derived* from evidence (shared selectors, token consumers,
 *      exception overrides), never guessed from page names. Every dependent
 *      carries the concrete basis that put it in the list, so an empty list can
 *      be read as "nothing in the corpus references it" instead of "we didn't
 *      check".
 *
 * Nothing here writes to the corpus before the caller asks; every mutating
 * function takes `at`/`by` from the caller and returns a change record.
 */

const { checkDna } = require('../lib/dna-invariants');

const KB_KIND = 'design-dna-kb';
const KB_SCHEMA_VERSION = '0.2.0';

// ---------------------------------------------------------------- basics

const uniq = list => [...new Set(list.filter(Boolean))];
const sortList = list => uniq(list).sort();

function emptyKb(opts) {
  const o = opts || {};
  return {
    schemaVersion: KB_SCHEMA_VERSION,
    kind: KB_KIND,
    id: o.id || 'design-dna-kb',
    title: o.title || null,
    corpus: o.corpus || [],       // {file, sha256, bytes, capturedAt}
    sources: o.sources || [],     // copied from the extractor so families stay checkable
    revision: 0,
    updatedAt: o.at || null,
    rules: [],
    changelog: [],
    decisions: [],                // design decision records, see recordDecision()
  };
}

/**
 * The subject a rule is about. Only rules with the same subject can contradict
 * each other; see the module comment for why this is derived rather than typed
 * by hand.
 */
function subjectOf(rule) {
  if (!rule || !rule.value) return null;
  const v = rule.value;
  switch (rule.category) {
    case 'token':
      if (typeof v.name === 'string' && v.name.startsWith('--')) return `css-var:${v.name}`;
      if (v.prop && v.value != null) return `scale:${v.prop}:${v.value}`;
      return null;
    case 'component':
      return v.signature ? `component:${v.signature}` : null;
    case 'page':
      // page rules describe one *screen state* (`page.<page>.<state>`). Two
      // states of the same screen legitimately have different section orders,
      // so the state is part of the subject; a true duplicate is caught by id.
      return rule.id.startsWith('page.') && rule.id.split('.').length >= 3
        ? `screen:${rule.id.slice('page.'.length)}`
        : null;
    default:
      // interaction / principle / exception are singular by construction — two
      // of them with the same id is a duplicate, which the id check catches.
      return null;
  }
}

/** A canonical string for the rule's claim, for same-subject comparison. */
function valueKeyOf(rule) {
  if (!rule || !rule.value) return null;
  const v = rule.value;
  if (rule.category === 'token' && Array.isArray(v.resolved)) return sortList(v.resolved).join('|').toLowerCase();
  if (rule.category === 'token' && v.value != null) return String(v.value).trim();
  if (rule.category === 'component' && v.consensus) {
    const keys = Object.keys(v.consensus).sort();
    return keys.map(k => `${k}=${String(v.consensus[k]).trim()}`).join(';').toLowerCase();
  }
  if (rule.category === 'page' && Array.isArray(v.sections)) {
    // `label` already carries the selector when a role repeats adjacently
    // ("视图切换(#weather-days)"), so it must not be prefixed with the role again.
    return v.sections.map(s => `${s.order}:${s.label || s.role}`).join('>');
  }
  if (rule.category === 'exception' && Array.isArray(v.overrides)) {
    return v.overrides.map(o => `${o.selector}[${o.prop}]=${o.winner && o.winner.value}`).sort().join(';');
  }
  return null;
}

/**
 * The selectors a rule is *about*: the element it was measured on, plus any
 * selector it declares in its own value. Ancestors from evidence paths are
 * deliberately excluded — two components sharing `.activity-row` as an ancestor
 * are siblings in one list, not dependents of each other, and treating them as
 * such turns every impact report into "the whole page".
 */
function ownSelectors(rule) {
  const out = [];
  for (const e of (rule.evidence || [])) if (e && e.selector) out.push(String(e.selector));
  const v = (rule && rule.value) || {};
  if (Array.isArray(v.selectors)) out.push(...v.selectors);
  if (Array.isArray(v.overrides)) out.push(...v.overrides.map(o => o.selector));
  if (v.consumers && Array.isArray(v.consumers.selectors)) out.push(...v.consumers.selectors);
  return sortList(out);
}

/** Kept for callers that want the ancestor context too (reports, debugging). */
function selectorsOf(rule) {
  const out = ownSelectors(rule);
  for (const e of (rule.evidence || [])) {
    if (!e || !e.path) continue;
    for (const seg of String(e.path).split('>')) {
      const m = /^(?:[a-z0-9-]+)?(#[a-z0-9-]+|\.[a-z0-9-]+)/i.exec(seg.trim());
      if (m) out.push(m[1]);
    }
  }
  return sortList(out);
}

function pagesOf(rule) {
  const pages = [];
  if (rule.scope && Array.isArray(rule.scope.pages)) pages.push(...rule.scope.pages);
  for (const e of (rule.evidence || [])) if (e && e.page) pages.push(e.page);
  const v = rule.value || {};
  if (v.instancesPerPage) pages.push(...Object.keys(v.instancesPerPage));
  if (Array.isArray(v.sections)) pages.push(...v.sections.map(s => s.page).filter(Boolean));
  return sortList(pages);
}

// ---------------------------------------------------------------- conflicts

/**
 * Every way two rules in one store can disagree. Each entry is
 * `{ code, ruleIds, subject, detail }`; `severity` distinguishes a store that
 * is merely inconsistent (`error`) from one that needs a human decision
 * (`decision`).
 */
function findConflicts(kb) {
  const rules = (kb && kb.rules) || [];
  const out = [];
  const bySubject = new Map();
  const byId = new Map();

  for (const r of rules) {
    if (!r || !r.id) continue;
    if (byId.has(r.id)) {
      out.push({
        code: 'DUPLICATE_ID', severity: 'error', ruleIds: [r.id],
        detail: `规则 id「${r.id}」在库里出现不止一次：同一句话有两个出处，改一处另一处就过期`,
      });
    } else byId.set(r.id, r);

    const subject = subjectOf(r);
    if (!subject) continue;
    if (!bySubject.has(subject)) bySubject.set(subject, []);
    bySubject.get(subject).push(r);
  }

  for (const [subject, list] of bySubject) {
    if (list.length < 2) continue;
    const keyed = list.map(r => ({ r, key: valueKeyOf(r) }));
    for (let i = 0; i < keyed.length; i++) {
      for (let j = i + 1; j < keyed.length; j++) {
        const a = keyed[i];
        const b = keyed[j];
        if (a.key == null || b.key == null) {
          out.push({
            code: 'DUPLICATE_SUBJECT', severity: 'error', subject,
            ruleIds: [a.r.id, b.r.id],
            detail: `两条规则都声称是「${subject}」，但至少一条没有可比对的值——同一主题只允许一条规则`,
          });
          continue;
        }
        if (a.key === b.key) {
          const aScope = sortList(a.r.scope && a.r.scope.pages).join(',');
          const bScope = sortList(b.r.scope && b.r.scope.pages).join(',');
          if (aScope !== bScope) {
            out.push({
              code: 'SCOPE_DISAGREEMENT', severity: 'decision', subject,
              ruleIds: [a.r.id, b.r.id],
              detail: `「${subject}」是同一个值，但两条规则的范围不同（${aScope || '-'} / ${bScope || '-'}）：` +
                '合并还是保留，得由人决定，不能自动取并集',
            });
          }
          continue;
        }
        const confirmed = [a.r, b.r].filter(r => r.confirmation && r.confirmation.status === 'confirmed');
        out.push({
          code: confirmed.length ? 'CONTRADICTS_CONFIRMED' : 'VALUE_CONFLICT',
          severity: 'decision', subject,
          ruleIds: [a.r.id, b.r.id],
          detail: `关于「${subject}」两条规则给出不同的值：「${a.r.id}」= ${a.key}，` +
            `「${b.r.id}」= ${b.key}` + (confirmed.length ? `（其中「${confirmed[0].id}」已被人确认）` : ''),
        });
      }
    }
  }

  // Scope vs evidence, both directions. The extractor already guarantees these;
  // a knowledge base is edited by people, so it has to be re-checked here.
  for (const r of rules) {
    if (!r || !r.scope || !Array.isArray(r.scope.pages)) continue;
    const scopePages = new Set(r.scope.pages);
    const evPages = new Set((r.evidence || []).map(e => e && e.page).filter(Boolean));
    const outside = [...evPages].filter(p => !scopePages.has(p));
    if (outside.length) {
      out.push({
        code: 'EVIDENCE_OUTSIDE_SCOPE', severity: 'error', ruleIds: [r.id],
        detail: `证据出现在 ${outside.join('、')}，但规则的范围里没有这些页面`,
      });
    }
    if (r.category === 'exception' && r.value && Array.isArray(r.value.overrides)) {
      const mentioned = uniq(r.value.overrides.flatMap(o => o.pages || []));
      const stray = mentioned.filter(p => !scopePages.has(p));
      if (stray.length) {
        out.push({
          code: 'EXCEPTION_OUTSIDE_SCOPE', severity: 'error', ruleIds: [r.id],
          detail: `例外的覆盖记录点名了 ${stray.join('、')}，而例外自己的范围不包含这些页面`,
        });
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------- query

/**
 * Filtering only — no ranking, no "best match". A reviewer must be able to
 * predict the result set from the arguments.
 */
function query(kb, filter) {
  const f = filter || {};
  const text = f.text ? String(f.text).toLowerCase() : null;
  return ((kb && kb.rules) || []).filter(r => {
    if (!r) return false;
    if (f.id && r.id !== f.id) return false;
    if (f.category && r.category !== f.category) return false;
    if (f.kind && r.kind !== f.kind) return false;
    if (f.confidence && r.confidence !== f.confidence) return false;
    if (f.level && (!r.scope || r.scope.level !== f.level)) return false;
    if (f.page && !(pagesOf(r).includes(f.page))) return false;
    if (f.family) {
      const famOf = {};
      for (const s of (kb && kb.sources) || []) famOf[s.id] = s.family;
      if (!pagesOf(r).some(p => famOf[p] === f.family)) return false;
    }
    if (f.status && (!r.confirmation || r.confirmation.status !== f.status)) return false;
    if (text) {
      const hay = `${r.id} ${r.statement || ''} ${JSON.stringify(r.value || {})}`.toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------- impact

/**
 * Selectors that appear on almost every rule of the corpus. Sharing them says
 * nothing about a dependency (`:root` carries every CSS variable; `#device` is
 * the phone frame), so they are excluded from the "same selector" relation.
 */
const GENERIC_SELECTORS = new Set([':root', 'html', 'body', '*', 'page', '#device', '#screen']);

/**
 * What a reviewer has to re-check if `id` changes.
 *
 * Only *structural* rules count as dependents — component rules and exception
 * rules. Two token rules sharing a selector do not depend on each other (an
 * 11px node happening to sit on `.mine-status` is an observation site, not a
 * consumer), and listing them would bury the three components that actually
 * have to be re-measured. Relations, each with the concrete basis attached:
 *
 *   uses-variable      this rule is a CSS variable and the other rule is
 *                      measured on one of its declared consumers,
 *   same-selector      both rules are measured on the same specific selector,
 *   exception-override an exception overrides a selector this rule governs.
 *
 * `pages` is the union the change is visible on; it never borrows pages from
 * dependents, because those are re-checked through their own rules.
 */
function impact(kb, id, next) {
  const rules = (kb && kb.rules) || [];
  const current = rules.find(r => r && r.id === id) || null;
  const subject = current ? { ...current, ...(next || {}) } : next;
  if (!subject) return { id, found: false, pages: [], components: [], rules: [] };

  const mySelectors = new Set(ownSelectors(subject).filter(s => !GENERIC_SELECTORS.has(s)));
  const mySignature = subject.category === 'component' && subject.value ? subject.value.signature : null;
  const isVar = subject.category === 'token' && subject.value && typeof subject.value.name === 'string'
    && subject.value.name.startsWith('--');
  const consumers = new Set(
    isVar && subject.value.consumers && Array.isArray(subject.value.consumers.selectors)
      ? subject.value.consumers.selectors.filter(s => !GENERIC_SELECTORS.has(s))
      : []
  );

  const dependents = [];
  const components = new Set();
  const note = (r, why) => {
    if (!why.length) return;
    dependents.push({ id: r.id, category: r.category, why: [...new Set(why)] });
    if (r.category === 'component' && r.value && r.value.signature) components.add(r.value.signature);
  };

  for (const r of rules) {
    if (!r || r.id === id) continue;
    if (r.category !== 'component' && r.category !== 'exception') continue;
    const theirs = ownSelectors(r).filter(s => !GENERIC_SELECTORS.has(s));
    const why = [];

    // A consumer selector is already a stronger statement than "same selector",
    // so it is not repeated as a second reason.
    const shared = theirs.filter(s => mySelectors.has(s) && !consumers.has(s));
    if (shared.length) {
      why.push(`${r.category === 'exception' ? '例外在' : '同一具体选择器'} ${shared.slice(0, 3).join('、')}`);
    }
    if (consumers.size) {
      const hit = theirs.filter(s => consumers.has(s));
      if (hit.length) why.push(`使用了 ${subject.value.name}（${hit.slice(0, 3).join('、')}）`);
    }
    // A part's geometry is a function of its parent's box, so every rule
    // measured on a child of this signature has to be re-read.
    if (mySignature && r.value && typeof r.value.signature === 'string'
      && r.value.signature.startsWith(mySignature + ' > ')) {
      why.push('它是这条组件签名的子部件（父级尺寸变化会带动它）');
    }
    note(r, why);
  }

  if (mySignature) components.add(mySignature);

  return {
    id,
    found: !!current,
    subject: subjectOf(subject),
    pages: sortList([...pagesOf(subject)]),
    components: sortList([...components]),
    rules: dependents.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

// ---------------------------------------------------------------- update

const CHANGELOG_CAP = 200;

/**
 * Add or replace one rule. Returns `{ kb, change }`; `change.changed === false`
 * means the store already held exactly this claim (idempotent re-import).
 *
 * A confirmation is an update like any other, except that `by` is mandatory —
 * a named human is the only thing that can move a rule out of `candidate`.
 */
function upsert(kb, rule, meta) {
  const m = meta || {};
  if (!rule || !rule.id) throw new Error('upsert: rule needs an id');
  if (!m.at) throw new Error('upsert: an update must carry the time it happened (at)');
  const conf = rule.confirmation || {};
  if (conf.status && conf.status !== 'candidate' && !conf.by) {
    throw new Error(`upsert: rule ${rule.id} is ${conf.status} but names nobody (confirmation.by) — ` +
      'only a named person can confirm or reject a rule');
  }

  const next = JSON.parse(JSON.stringify(kb));
  const idx = next.rules.findIndex(r => r && r.id === rule.id);
  const before = idx >= 0 ? next.rules[idx] : null;
  const record = {
    id: rule.id,
    category: rule.category,
    updatedAt: m.at,
    updatedBy: m.by || null,
    note: m.note || null,
  };
  const stored = Object.assign(JSON.parse(JSON.stringify(rule)), { kb: record });

  const same = before && JSON.stringify(stripKb(before)) === JSON.stringify(stripKb(stored));
  if (same) {
    // Re-importing an unchanged rule must not invent a revision: a changelog
    // that grows on every read makes "what changed" unanswerable.
    return { kb, change: { id: rule.id, changed: false, revision: next.revision } };
  }

  if (idx >= 0) next.rules[idx] = stored; else next.rules.push(stored);
  next.revision = (next.revision || 0) + 1;
  next.updatedAt = m.at;
  const action = !before ? 'add' : (conf.status && conf.status !== 'candidate' ? 'confirm' : 'update');
  next.changelog.push({
    revision: next.revision,
    at: m.at,
    by: m.by || null,
    action,
    id: rule.id,
    fields: before ? changedFields(before, stored) : ['*'],
    note: m.note || null,
  });
  next.changelog = pruneChangelog(next.changelog);
  return { kb: next, change: { id: rule.id, changed: true, action, revision: next.revision, fields: next.changelog[next.changelog.length - 1].fields } };
}

const stripKb = r => {
  const copy = JSON.parse(JSON.stringify(r));
  delete copy.kb;
  return copy;
};

function changedFields(before, after) {
  const fields = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (k === 'kb') continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) fields.push(k);
  }
  return fields.length ? fields : ['*'];
}

/** Keep the newest entries by timestamp — never by array position. */
function pruneChangelog(list, cap) {
  const limit = cap || CHANGELOG_CAP;
  if (list.length <= limit) return list;
  return list
    .slice()
    .sort((a, b) => String(b.at).localeCompare(String(a.at)) || String(b.revision).localeCompare(String(a.revision)))
    .slice(0, limit)
    .sort((a, b) => a.revision - b.revision);
}

/**
 * Record *why* something is the way it is. A decision is not a rule: it has no
 * scope and no evidence of its own, it explains a rule (or an exception to it).
 */
function recordDecision(kb, decision, meta) {
  const m = meta || {};
  if (!decision || !decision.id) throw new Error('recordDecision: needs an id');
  if (!m.at) throw new Error('recordDecision: needs the time it was recorded (at)');
  const next = JSON.parse(JSON.stringify(kb));
  const entry = Object.assign({}, decision, { at: m.at, by: m.by || null });
  const idx = next.decisions.findIndex(d => d && d.id === decision.id);
  if (idx >= 0) next.decisions[idx] = entry; else next.decisions.push(entry);
  next.revision = (next.revision || 0) + 1;
  next.updatedAt = m.at;
  next.changelog.push({
    revision: next.revision, at: m.at, by: m.by || null,
    action: idx >= 0 ? 'decision-update' : 'decision', id: decision.id, fields: ['*'], note: m.note || null,
  });
  next.changelog = pruneChangelog(next.changelog);
  return { kb: next, change: { id: decision.id, changed: true, action: idx >= 0 ? 'decision-update' : 'decision', revision: next.revision } };
}

// ---------------------------------------------------------------- seeding

/**
 * Turn an extraction artifact into a store revision 1.
 *
 * The seeder is intentionally a one-way door: it copies every rule *including*
 * its `candidate` status, because an extractor has no authority to confirm
 * anything. Re-seeding an empty store is the normal path; re-seeding a store
 * that already has rules is the caller's decision (the CLI refuses unless
 * `--force`), because it would overwrite human confirmations with candidates.
 */
function seedFromDna(dna, opts) {
  const o = opts || {};
  const at = o.at || new Date().toISOString();
  const kb = emptyKb({
    id: o.id || 'ourtrail-design-dna',
    title: o.title || null,
    at,
    sources: (dna.sources || []).map(s => ({ id: s.id, family: s.family, file: s.file, states: s.states })),
  });
  kb.corpus = Object.entries(dna.fingerprints || {}).map(([file, fp]) => ({
    file, sha256: fp.sha256, bytes: fp.bytes, capturedAt: dna.generatedAt || null,
  })).sort((a, b) => a.file.localeCompare(b.file));
  for (const r of dna.rules || []) {
    const { kb: _ignore, ...rest } = r;
    const res = upsert(kb, rest, { at, by: o.by || null, note: o.note || 'seeded from extraction' });
    // upsert is pure; keep accumulating into the result
    kb.rules = res.kb.rules;
    kb.revision = res.kb.revision;
    kb.changelog = res.kb.changelog;
    kb.updatedAt = res.kb.updatedAt;
  }
  if (!kb.rules.length) kb.revision = 0;
  return kb;
}

// ---------------------------------------------------------------- verify

function summarize(rules) {
  const byCategory = {};
  const byScope = {};
  const byKind = {};
  const byConfidence = {};
  let confirmed = 0;
  for (const r of rules) {
    byCategory[r.category] = (byCategory[r.category] || 0) + 1;
    byScope[(r.scope && r.scope.level) || '?'] = (byScope[(r.scope && r.scope.level) || '?'] || 0) + 1;
    byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    byConfidence[r.confidence] = (byConfidence[r.confidence] || 0) + 1;
    if (r.confirmation && r.confirmation.status === 'confirmed') confirmed++;
  }
  return {
    rules: rules.length, byCategory, byScope, byKind, byConfidence,
    confirmed, candidates: rules.length - confirmed,
  };
}

/** The DNA shape the rule invariants understand, so one gate covers both. */
function asDna(kb) {
  const rules = (kb && kb.rules) || [];
  return {
    kind: 'design-dna',
    sources: (kb && kb.sources) || [],
    summary: summarize(rules),
    rules,
  };
}

/**
 * Store-level invariants: the rules must still satisfy the DNA gate (people
 * edit stores), and the revision discipline must match the changelog.
 */
function verifyKb(kb) {
  const violations = [];
  if (!kb || typeof kb !== 'object') return { ok: false, violations: [{ code: 'NO_KB', message: 'not an object' }] };
  if (kb.kind !== KB_KIND) violations.push({ code: 'WRONG_KIND', message: `kind is ${JSON.stringify(kb.kind)}` });

  const dna = checkDna(asDna(kb));
  for (const v of dna.violations) violations.push({ code: v.code, ruleId: v.ruleId, message: v.message });

  const revision = kb.revision || 0;
  const log = Array.isArray(kb.changelog) ? kb.changelog : [];
  const maxRev = log.reduce((m, e) => Math.max(m, e.revision || 0), 0);
  if (revision !== maxRev) {
    violations.push({ code: 'REVISION_MISMATCH', message: `revision ${revision} but newest changelog entry is ${maxRev}` });
  }
  for (const e of log) {
    if (!e.at) violations.push({ code: 'CHANGELOG_WITHOUT_TIME', ruleId: e.id, message: `revision ${e.revision} has no timestamp` });
  }
  for (const r of kb.rules || []) {
    if (!r || !r.kb || !r.kb.updatedAt) {
      violations.push({ code: 'RULE_WITHOUT_PROVENANCE', ruleId: r && r.id, message: 'a rule in the store has no kb.updatedAt — nobody can tell when it entered' });
    }
  }
  return { ok: violations.length === 0, violations };
}

/**
 * Compare the store against the artifact it was seeded from. A store is a
 * snapshot of a corpus that keeps moving; silently reviewing yesterday's rules
 * against today's prototypes is the failure this check exists to prevent.
 */
function staleness(kb, corpus) {
  const have = new Map(((kb && kb.corpus) || []).map(c => [c.file, c.sha256]));
  const now = new Map(Object.entries((corpus && corpus.fingerprints) || {}).map(([file, fp]) => [file, fp.sha256]));
  const added = [...now.keys()].filter(f => !have.has(f));
  const removed = [...have.keys()].filter(f => !now.has(f));
  const changed = [...now.keys()].filter(f => have.has(f) && have.get(f) !== now.get(f));
  return {
    stale: added.length + removed.length + changed.length > 0,
    added: sortList(added), removed: sortList(removed), changed: sortList(changed),
  };
}

/**
 * `staleness()` matches by file name, so pointing it at an artifact from an
 * unrelated corpus reports every file as added AND removed — a busy diff that
 * means "these are different corpora", not "this corpus moved". Callers need to
 * tell those apart before telling the user their store is out of date.
 */
function corpusFreshness(kb, artifact) {
  const stored = ((kb && kb.corpus) || []).map(c => c.file);
  const current = Object.keys((artifact && artifact.fingerprints) || {});
  if (!stored.length || !current.length) {
    return { status: 'uncompared', reason: stored.length ? 'artifact records no source files' : 'store records no corpus' };
  }
  const overlap = current.filter(f => stored.includes(f)).length;
  if (!overlap) return { status: 'foreign', stored: stored.length, current: current.length };
  const st = staleness(kb, artifact);
  return Object.assign({ status: st.stale ? 'stale' : 'matches', overlap }, st);
}

module.exports = {
  KB_KIND, KB_SCHEMA_VERSION, CHANGELOG_CAP,
  emptyKb, subjectOf, valueKeyOf, selectorsOf, pagesOf,
  findConflicts, query, impact, upsert, recordDecision, seedFromDna,
  summarize, asDna, verifyKb, staleness, corpusFreshness, pruneChangelog,
};

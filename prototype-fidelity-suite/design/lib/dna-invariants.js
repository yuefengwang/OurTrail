'use strict';
/**
 * Invariants a Design DNA artifact must satisfy before anything downstream is
 * allowed to consume it.
 *
 * These are not style checks. Each one corresponds to a way a design-knowledge
 * artifact can sound authoritative while being wrong:
 *
 *  - a rule promoted to `global` without leaving its own family (a weather idiom
 *    presented as a house style),
 *  - a rule that is already marked `confirmed` although no human ever confirmed
 *    it (the extractor has no authority to do that),
 *  - an evidence-free claim (a statement with nothing behind it),
 *  - a scope that names pages the rule has no evidence on.
 *
 * Callers use it as a gate, so it returns plain data rather than throwing:
 * `{ ok, violations: [{ruleId, code, message}] }`.
 */

const LEVELS = new Set(['global', 'page-family', 'page']);
const KINDS = new Set(['measured', 'observed', 'inferred']);
const STATUSES = new Set(['candidate', 'confirmed', 'rejected']);

function checkDna(dna) {
  const v = [];
  const add = (ruleId, code, message) => v.push({ ruleId, code, message });

  if (!dna || typeof dna !== 'object') {
    add(null, 'NO_ARTIFACT', 'artifact is not an object');
    return { ok: false, violations: v };
  }
  if (dna.kind !== 'design-dna') add(null, 'WRONG_KIND', `kind is ${JSON.stringify(dna.kind)}, expected "design-dna"`);
  if (!Array.isArray(dna.rules) || !dna.rules.length) {
    add(null, 'NO_RULES', 'artifact carries no rules');
    return { ok: false, violations: v };
  }

  const famOf = {};
  for (const src of dna.sources || []) famOf[src.id] = src.family;
  const allPages = Object.keys(famOf);

  const seen = new Set();
  for (const r of dna.rules) {
    const id = r && r.id;
    if (!id) { add(null, 'RULE_WITHOUT_ID', 'a rule has no id'); continue; }
    if (seen.has(id)) add(id, 'DUPLICATE_ID', `rule id "${id}" appears more than once`);
    seen.add(id);

    if (!Array.isArray(r.evidence) || r.evidence.length === 0) {
      add(id, 'NO_EVIDENCE', 'rule carries no evidence — a claim without a source');
    }
    if (!KINDS.has(r.kind)) add(id, 'BAD_KIND', `kind ${JSON.stringify(r.kind)} is not measured|observed|inferred`);
    if (!r.scope || !LEVELS.has(r.scope.level)) {
      add(id, 'BAD_SCOPE', `scope.level ${JSON.stringify(r.scope && r.scope.level)} is not global|page-family|page`);
    }

    if (r.confirmation && r.confirmation.status !== 'candidate') {
      if (r.confirmation.status === 'confirmed' && !r.confirmation.by) {
        add(id, 'UNATTRIBUTED_CONFIRMATION', 'marked confirmed without naming who confirmed it');
      }
      if (!STATUSES.has(r.confirmation.status)) {
        add(id, 'BAD_STATUS', `confirmation.status ${JSON.stringify(r.confirmation.status)} is not candidate|confirmed|rejected`);
      }
    }

    if (r.scope && Array.isArray(r.scope.pages)) {
      const fams = [...new Set(r.scope.pages.map(p => famOf[p]).filter(Boolean))];
      if (r.scope.level === 'global' && fams.length < 2) {
        add(id, 'GLOBAL_FROM_ONE_FAMILY',
          `scope is global but every supporting page belongs to ${fams.join('/') || 'one unknown family'} — ` +
          'a family-specific pattern may not be promoted to a house-wide norm by counting alone');
      }
      if (r.scope.level === 'global' && r.scope.pages.length < allPages.length) {
        add(id, 'GLOBAL_WITHOUT_FULL_COVERAGE',
          `scope is global but covers ${r.scope.pages.length}/${allPages.length} pages`);
      }
      const dangling = r.scope.pages.filter(p => !allPages.includes(p));
      if (dangling.length) add(id, 'SCOPE_NAMES_UNKNOWN_PAGE', `scope names ${dangling.join(', ')} which is not a captured source`);
      if (Array.isArray(r.evidence)) {
        const evPages = new Set(r.evidence.map(e => e && e.page).filter(Boolean));
        const unsupported = r.scope.pages.filter(p => !evPages.has(p) && evPages.size > 0);
        if (unsupported.length) {
          add(id, 'SCOPE_NOT_BACKED_BY_EVIDENCE',
            `scope claims ${unsupported.join(', ')} but evidence only names ${[...evPages].join(', ')}`);
        }
      }
    }
  }

  if (typeof dna.summary === 'object' && dna.summary) {
    if (dna.summary.rules !== dna.rules.length) {
      add(null, 'SUMMARY_MISMATCH', `summary.rules ${dna.summary.rules} != ${dna.rules.length} actual rules`);
    }
    const confirmed = dna.rules.filter(r => r.confirmation && r.confirmation.status === 'confirmed').length;
    if (dna.summary.confirmed !== confirmed) {
      add(null, 'SUMMARY_MISMATCH', `summary.confirmed ${dna.summary.confirmed} != ${confirmed} rules actually confirmed`);
    }
  }

  return { ok: v.length === 0, violations: v };
}

module.exports = { checkDna };

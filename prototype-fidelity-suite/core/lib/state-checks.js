'use strict';
/**
 * Dimension D (state): did this state exist, was it produced the declared way,
 * and may its screenshot be quoted as interaction evidence?
 *
 * Appearance of a state is judged by A/B/C on that state's own capture. This
 * dimension answers the separate question the brief keeps apart from it: a
 * state that was reached by injecting data can be perfect visual evidence and
 * is still not evidence that a gesture produces it. The failure this catches is
 * not "the state was injected" but "the artifacts disagree with the
 * declaration" — a capture reporting `real` for a configured injection, or an
 * injected capture still claiming eligibility as interaction evidence.
 *
 * Injection is target-side by design (`states[].injectData` is applied through
 * the target adapter); the prototype side of a state is always the prototype's
 * own rendering.
 */

function record(id, status, detail) {
  return { id, status, detail };
}

function dataSourceOf(manifest) {
  if (!manifest || !manifest.source) return null;
  const v = manifest.source.dataSource;
  return v == null ? null : v;
}

/**
 * @param {object} input
 * @param {object} input.state        the pf.config.json state declaration
 * @param {object|null} input.pageState  contracts/<page>/page-state-manifest.json
 * @param {object|null} input.prototype  prototype capture-manifest
 * @param {object|null} input.target     target capture-manifest
 * @returns {Array<{id,status,detail}>} check records for `score.checkDimension`
 */
function buildStateChecks(input) {
  const state = input.state || {};
  const id = state.id || 'default';
  const declared = !!state.injectData;
  const entry = input.pageState && Array.isArray(input.pageState.states)
    ? input.pageState.states.find(s => s.id === id) || null
    : null;
  const out = [];

  out.push(entry
    ? record(
      `state:${id}:declared`,
      entry.injection && entry.injection.declared === declared ? 'PASS' : 'FAIL',
      `page-state-manifest declares injection=${!!(entry.injection && entry.injection.declared)}, config declares ${declared}`,
    )
    : record(
      `state:${id}:declared`,
      'UNVERIFIED',
      'page-state-manifest has no entry for this state (run pf contract)',
    ));

  for (const [side, manifest, expected] of [
    ['prototype', input.prototype, 'real'],
    ['target', input.target, declared ? 'injected' : 'real'],
  ]) {
    if (!manifest) {
      out.push(record(`state:${id}:data-source:${side}`, 'UNVERIFIED', `no ${side} capture`));
      continue;
    }
    const actual = dataSourceOf(manifest);
    out.push(record(
      `state:${id}:data-source:${side}`,
      actual === expected ? 'PASS' : 'FAIL',
      `${side} capture reports dataSource=${actual}, declaration expects ${expected}`,
    ));
  }

  out.push(entry
    ? record(
      `state:${id}:interaction-evidence`,
      entry.usableAsInteractionEvidence === !declared ? 'PASS' : 'FAIL',
      `usableAsInteractionEvidence=${entry.usableAsInteractionEvidence}, expected ${!declared}`,
    )
    : record(
      `state:${id}:interaction-evidence`,
      'UNVERIFIED',
      'page-state-manifest has no entry for this state',
    ));

  return out;
}

module.exports = { buildStateChecks };

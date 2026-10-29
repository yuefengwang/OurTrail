'use strict';
/**
 * Bounded repair: precheck → backup → write → retest → keep or roll back.
 *
 * The audit's F12 was blunt: v0.1 had no repairer, and what the experiment
 * called "reset" was overwriting the fixture — returning to the start, not
 * undoing one patch. Every property this module claims is therefore checkable
 * from its own evidence file:
 *
 *   bounded     — an edit is an exact anchor+replacement pair; the anchor must
 *                 occur exactly once, or nothing is written at all;
 *   reversible  — the original bytes are copied and their sha256 recorded before
 *                 the write, and a rollback is only reported after the restored
 *                 file hashes back to the recorded value;
 *   evidenced   — `repair-report.json` carries both verdicts, both hashes and the
 *                 rollback proof, so "it worked" is not a claim made in prose.
 *
 * It deliberately knows nothing about design. Choosing the replacement is the
 * caller's judgement; this file only refuses to guess, refuses to write twice
 * into one file ambiguously, and refuses to leave a patch that did not pay off.
 */
const fs = require('fs');
const path = require('path');
const { sha256, ensureDir } = require('./util');

function normalizeSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('repair spec must be an object');
  if (!Array.isArray(spec.edits) || !spec.edits.length) throw new Error('repair spec needs a non-empty edits[]');
  for (const e of spec.edits) {
    if (!e.id) throw new Error('every edit needs an id');
    if (!e.file) throw new Error(`edit ${e.id} needs a file`);
    if (typeof e.anchor !== 'string' || !e.anchor.length) throw new Error(`edit ${e.id} needs a non-empty anchor`);
    if (typeof e.replace !== 'string') throw new Error(`edit ${e.id} needs a replace string`);
  }
  return spec;
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    count++;
    from = at + needle.length;
  }
  return count;
}

/**
 * Nothing is written until every edit is unambiguous. A repair that silently
 * patches the second of two identical anchors is unreviewable, so a non-unique
 * anchor blocks the whole plan (not just that one edit).
 */
function precheck(spec, baseDir) {
  normalizeSpec(spec);
  const results = spec.edits.map(e => {
    const file = path.resolve(baseDir, e.file);
    const exists = fs.existsSync(file);
    if (!exists) return { id: e.id, file: e.file, status: 'BLOCKED', reason: 'file not found', occurrences: 0 };
    const text = fs.readFileSync(file, 'utf8');
    const occurrences = countOccurrences(text, e.anchor);
    if (occurrences === 0) return { id: e.id, file: e.file, status: 'BLOCKED', reason: 'anchor not found', occurrences };
    if (occurrences > 1) return { id: e.id, file: e.file, status: 'BLOCKED', reason: `anchor is not unique (${occurrences} occurrences)`, occurrences };
    return { id: e.id, file: e.file, status: 'PASS', reason: null, occurrences };
  });
  return { ok: results.every(r => r.status === 'PASS'), edits: results };
}

function backup(spec, baseDir, outDir) {
  const dir = ensureDir(path.join(outDir, 'backup'));
  const entries = [];
  for (const e of spec.edits) {
    const file = path.resolve(baseDir, e.file);
    if (!fs.existsSync(file)) throw new Error(`cannot back up missing file ${e.file}`);
    const bytes = fs.readFileSync(file);
    const safe = e.file.replace(/[\\/:]+/g, '__');
    const copy = path.join(dir, safe + '.orig');
    fs.writeFileSync(copy, bytes);
    entries.push({
      id: e.id,
      file: e.file,
      backup: path.relative(outDir, copy).split(path.sep).join('/'),
      backupPath: copy,
      sha256Before: sha256(bytes),
      bytes: bytes.length,
    });
  }
  return { dir, entries };
}

function apply(spec, baseDir) {
  const applied = [];
  for (const e of spec.edits) {
    const file = path.resolve(baseDir, e.file);
    const before = fs.readFileSync(file, 'utf8');
    const after = before.split(e.anchor).join(e.replace);
    if (after === before) throw new Error(`edit ${e.id} did not change ${e.file}`);
    fs.writeFileSync(file, after, 'utf8');
    applied.push({ id: e.id, file: e.file, sha256After: sha256(fs.readFileSync(file)) });
  }
  return applied;
}

/**
 * Restores the recorded bytes and proves the restoration: the reported sha256 is
 * recomputed from disk after writing, so a failed copy cannot read as a rollback.
 */
function rollback(backupEntries, baseDir) {
  const restored = [];
  for (const entry of backupEntries) {
    const file = path.resolve(baseDir, entry.file);
    const bytes = fs.readFileSync(entry.backupPath);
    fs.writeFileSync(file, bytes);
    const now = sha256(fs.readFileSync(file));
    restored.push({
      id: entry.id,
      file: entry.file,
      sha256Restored: now,
      byteIdentical: now === entry.sha256Before,
    });
  }
  return restored;
}

module.exports = { normalizeSpec, precheck, backup, apply, rollback, countOccurrences };

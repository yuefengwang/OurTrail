'use strict';
/**
 * F12 — bounded repair.
 *
 * Every property the module claims is checkable from its own output, so every
 * property gets an assertion: a non-unique anchor blocks the whole plan before
 * anything is written; the backup is the original bytes and their hash; an apply
 * changes the file; a rollback proves itself by re-hashing what is on disk rather
 * than echoing the value it intended to restore.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const repair = require('../core/lib/repair');
const { check, eq, throws, section, finish } = require('./harness');

const roots = [];
function project(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-repair-'));
  roots.push(dir);
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
  }
  return dir;
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

try {
  section('the spec is validated before anything is touched');
  {
    throws('no edits array', () => repair.normalizeSpec({}));
    throws('empty edits array', () => repair.normalizeSpec({ edits: [] }));
    throws('an edit without an id', () => repair.normalizeSpec({ edits: [{ file: 'a.css', anchor: 'a', replace: 'b' }] }));
    throws('an edit without an anchor', () => repair.normalizeSpec({ edits: [{ id: 'e1', file: 'a.css', replace: 'b' }] }));
    throws('an edit without a replacement', () => repair.normalizeSpec({ edits: [{ id: 'e1', file: 'a.css', anchor: 'a' }] }));
    check('a well-formed spec passes through', repair.normalizeSpec({ edits: [{ id: 'e1', file: 'a.css', anchor: 'a', replace: 'b' }] }).edits.length === 1);
  }

  section('a non-unique anchor blocks the whole plan');
  {
    const dir = project({ 'a.css': '.x { color: red; }\n.y { color: red; }\n' });
    const spec = { edits: [{ id: 'e1', file: 'a.css', anchor: 'color: red;', replace: 'color: blue;' }] };
    const pre = repair.precheck(spec, dir);
    eq('the plan is not ok', pre.ok, false);
    eq('the anchor is counted, not guessed', pre.edits[0].occurrences, 2);
    eq('reason names the ambiguity', pre.edits[0].reason, 'anchor is not unique (2 occurrences)');
    eq('nothing was written', read(dir, 'a.css'), '.x { color: red; }\n.y { color: red; }\n');
  }

  section('missing anchors and missing files are blocked, never created');
  {
    const dir = project({ 'a.css': '.x { color: red; }\n' });
    const notFound = repair.precheck({ edits: [{ id: 'e1', file: 'a.css', anchor: 'color: green;', replace: 'x' }] }, dir);
    eq('anchor not found', notFound.edits[0].reason, 'anchor not found');
    eq('not ok', notFound.ok, false);
    const noFile = repair.precheck({ edits: [{ id: 'e1', file: 'ghost.css', anchor: 'a', replace: 'b' }] }, dir);
    eq('missing file', noFile.edits[0].reason, 'file not found');
    eq('…and it was not created', fs.existsSync(path.join(dir, 'ghost.css')), false);
  }

  section('one bad edit blocks its siblings (the plan is all-or-nothing)');
  {
    const dir = project({ 'a.css': '.x { color: red; }\n', 'b.css': '.y { color: red; }\n.z { color: red; }\n' });
    const pre = repair.precheck({ edits: [
      { id: 'good', file: 'a.css', anchor: 'color: red;', replace: 'color: blue;' },
      { id: 'bad', file: 'b.css', anchor: 'color: red;', replace: 'color: blue;' },
    ] }, dir);
    eq('the plan is refused as a whole', pre.ok, false);
    eq('the per-edit status is still itemised', pre.edits.map(e => e.status), ['PASS', 'BLOCKED']);
  }

  section('backup records the original bytes and their hash');
  {
    const dir = project({ 'src/a.css': '.x { color: red; }\n' });
    const out = project({ 'keep.txt': 'x' });
    const spec = { edits: [{ id: 'e1', file: 'src/a.css', anchor: 'red', replace: 'blue' }] };
    const bak = repair.backup(spec, dir, out);
    const entry = bak.entries[0];
    eq('the backup path is project-relative and posix', entry.backup, 'backup/src__a.css.orig');
    eq('the backup holds the original bytes', fs.readFileSync(entry.backupPath, 'utf8'), '.x { color: red; }\n');
    eq('the hash describes those bytes', entry.sha256Before.length, 64);
    eq('the byte count is recorded', entry.bytes, '.x { color: red; }\n'.length);
  }

  section('apply changes exactly the anchored span');
  {
    const dir = project({ 'a.css': '.x { color: red; }\n.y { color: red; }\n' });
    const spec = { edits: [{ id: 'e1', file: 'a.css', anchor: '.x { color: red; }', replace: '.x { color: blue; }' }] };
    const applied = repair.apply(spec, dir);
    eq('the untouched line survives verbatim', read(dir, 'a.css'), '.x { color: blue; }\n.y { color: red; }\n');
    eq('an after-hash is reported', applied[0].sha256After.length, 64);
    check('the after-hash is of what is on disk',
      applied[0].sha256After === require('../core/lib/util').sha256(fs.readFileSync(path.join(dir, 'a.css'))));
    check('applying the same spec twice throws instead of writing again',
      (() => { try { repair.apply(spec, dir); return false; } catch (_) { return true; } })());
    eq('…and the file is unchanged by the failed second apply', read(dir, 'a.css'), '.x { color: blue; }\n.y { color: red; }\n');
  }

  section('rollback restores and proves it by re-reading the file');
  {
    const dir = project({ 'a.css': '.x { color: red; }\n' });
    const out = project({});
    const original = read(dir, 'a.css');
    const spec = { edits: [{ id: 'e1', file: 'a.css', anchor: 'red', replace: 'blue' }] };
    const pre = repair.precheck(spec, dir);
    check('the plan is applicable', pre.ok);
    const bak = repair.backup(spec, dir, out);
    repair.apply(spec, dir);
    check('the file really changed', read(dir, 'a.css') !== original);
    const restored = repair.rollback(bak.entries, dir);
    eq('the file is byte-identical again', read(dir, 'a.css'), original);
    eq('…and the rollback says so', restored[0].byteIdentical, true);
    eq('…with the original hash recomputed from disk', restored[0].sha256Restored, bak.entries[0].sha256Before);
  }

  section('a rollback claim is checked against disk, not against intent');
  {
    // Corrupt the backup on purpose: the "restored" bytes then differ from the
    // recorded hash, and the report must say byteIdentical:false. Without this the
    // rollback proof would be an echo of the value it meant to restore.
    const dir = project({ 'a.css': '.x { color: red; }\n' });
    const out = project({});
    const spec = { edits: [{ id: 'e1', file: 'a.css', anchor: 'red', replace: 'blue' }] };
    const bak = repair.backup(spec, dir, out);
    repair.apply(spec, dir);
    fs.writeFileSync(bak.entries[0].backupPath, '.x { color: green; }\n', 'utf8');
    const restored = repair.rollback(bak.entries, dir);
    eq('the corrupted backup is restored verbatim (so the mechanism is real)', read(dir, 'a.css'), '.x { color: green; }\n');
    eq('…and the proof reports the mismatch', restored[0].byteIdentical, false);
    check('…with a recomputed hash that is not the recorded one',
      restored[0].sha256Restored !== bak.entries[0].sha256Before);
  }

  section('multi-file plans are restored together');
  {
    const dir = project({ 'a.css': 'A1\n', 'b.css': 'B1\n' });
    const out = project({});
    const spec = { edits: [
      { id: 'e1', file: 'a.css', anchor: 'A1', replace: 'A2' },
      { id: 'e2', file: 'b.css', anchor: 'B1', replace: 'B2' },
    ] };
    const bak = repair.backup(spec, dir, out);
    repair.apply(spec, dir);
    eq('both files patched', [read(dir, 'a.css'), read(dir, 'b.css')], ['A2\n', 'B2\n']);
    const restored = repair.rollback(bak.entries, dir);
    eq('both restored', [read(dir, 'a.css'), read(dir, 'b.css')], ['A1\n', 'B1\n']);
    eq('both proven', restored.map(r => r.byteIdentical), [true, true]);
    eq('two distinct backups were written', new Set(bak.entries.map(e => e.backup)).size, 2);
  }

  section('countOccurrences counts non-overlapping hits');
  {
    eq('zero', repair.countOccurrences('abc', 'z'), 0);
    eq('one', repair.countOccurrences('abc', 'b'), 1);
    eq('two', repair.countOccurrences('abab', 'ab'), 2);
    eq('overlapping input is not double-counted', repair.countOccurrences('aaa', 'aa'), 1);
    eq('an empty needle counts nothing', repair.countOccurrences('abc', ''), 0);
  }
} finally {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
}

process.exit(finish('repair.test'));

'use strict';
/**
 * Gate for the skill documents themselves.
 *
 * A skill is only installable if its frontmatter is valid, its body stays under
 * the host limit, the reference files it points at exist, and it carries no
 * absolute path (those break on the next machine). Each rule is exercised by a
 * synthetic negative control here, because a gate that has never rejected
 * anything proves nothing about the real documents.
 */
const fs = require('fs');
const path = require('path');
const { check, eq, section, finish } = require('./harness');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'skills');
const REQUIRED_SECTIONS = ['何时用', '质量门', '失败处理', '示例', '与其他技能的关系'];
// A drive letter followed by a real path, a POSIX home directory, or a file URL
// that points somewhere. A bare scheme mention (`file://`) is not a path.
const ABS_PATH = /(^|[\s(`"'])(?:[A-Za-z]:[\\/][\w$.]|\/Users\/|\/home\/|file:\/\/[A-Za-z])/m;

function inspect(text, dirName, exists) {
  const errors = [];
  const refs = [];
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) {
    errors.push('no frontmatter');
  } else {
    const name = (/^name:\s*(.+)$/m.exec(fm[1]) || [])[1];
    const desc = (/^description:\s*([\s\S]*)$/m.exec(fm[1]) || [])[1];
    if (!name) errors.push('frontmatter has no name');
    else if (name.trim() !== dirName) errors.push(`name "${name.trim()}" does not match directory "${dirName}"`);
    else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name.trim())) errors.push('name is not lowercase-hyphen');
    const d = desc ? desc.trim() : '';
    if (!d) errors.push('frontmatter has no description');
    else if (d.length > 1024) errors.push(`description is ${d.length} chars (limit 1024)`);
  }

  const lines = text.split('\n').length;
  if (lines > 500) errors.push(`body is ${lines} lines (limit 500)`);

  const headings = text.split(/\r?\n/).filter(l => l.startsWith('## ')).map(l => l.slice(3).trim());
  for (const want of REQUIRED_SECTIONS) {
    if (!headings.some(h => h.startsWith(want))) errors.push(`missing section "## ${want}"`);
  }

  const abs = ABS_PATH.exec(text);
  if (abs) errors.push(`absolute path "${text.slice(abs.index, abs.index + 24).trim()}"`);

  // Only paths written as `references/x.md` are local to this skill; a path
  // under another skill's directory is somebody else's file.
  for (const m of text.matchAll(/(^|[^/\w-])references\/([A-Za-z0-9._-]+\.md)/gm)) {
    refs.push(m[2]);
    if (!exists(dirName, m[2])) errors.push(`references/${m[2]} does not exist`);
  }

  return { errors, refs };
}

const existsIn = (dir, file) => fs.existsSync(path.join(SKILLS, dir, 'references', file));

section('skill documents are installable');
{
  const dirs = fs.readdirSync(SKILLS, { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(path.join(SKILLS, d.name, 'SKILL.md')))
    .map(d => d.name).sort();
  eq('seven skills', dirs, [
    'design-contract-builder', 'fidelity-orchestrator', 'fidelity-repair-agent',
    'interaction-fidelity-validator', 'prototype-inspector',
    'target-platform-adapter', 'visual-fidelity-analyzer',
  ]);

  const readme = fs.readFileSync(path.join(SKILLS, 'README.md'), 'utf8');
  for (const dir of dirs) {
    const text = fs.readFileSync(path.join(SKILLS, dir, 'SKILL.md'), 'utf8');
    const res = inspect(text, dir, existsIn);
    check(`${dir}: SKILL.md passes the document rules`, res.errors.length === 0, res.errors);
    check(`${dir}: is listed in skills/README.md`, readme.includes('`' + dir + '`'));
    for (const ref of new Set(res.refs)) {
      const file = path.join(SKILLS, dir, 'references', ref);
      if (!fs.existsSync(file)) continue;
      const body = fs.readFileSync(file, 'utf8');
      check(`${dir}/${ref}: references stay one level deep`, !/references\/[A-Za-z0-9._-]+\//.test(body));
    }
  }
}

section('the document rules actually reject bad skills');
{
  const good = `---\nname: demo-skill\ndescription: 演示用\n---\n\n## 何时用\n\n## 质量门\n\n## 失败处理\n\n## 示例\n\n## 与其他技能的关系\n`;
  eq('a minimal well-formed skill passes', inspect(good, 'demo-skill', () => true).errors, []);
  check('a missing name is rejected', inspect(good.replace('name: demo-skill\n', ''), 'demo-skill', () => true).errors
    .some(e => /no name/.test(e)));
  check('a name that does not match its directory is rejected',
    inspect(good.replace('demo-skill', 'other-skill'), 'demo-skill', () => true).errors
      .some(e => /does not match directory/.test(e)));
  check('an absolute path is rejected',
    inspect(good + '\n见 C:/Users/someone/report.html\n', 'demo-skill', () => true).errors
      .some(e => /absolute path/.test(e)));
  check('a dangling reference is rejected',
    inspect(good + '\n详见 `references/missing.md`。\n', 'demo-skill', () => false).errors
      .some(e => /does not exist/.test(e)));
  check('a missing required section is rejected',
    inspect(good.replace('## 失败处理\n', ''), 'demo-skill', () => true).errors
      .some(e => /失败处理/.test(e)));
  check('an over-long description is rejected',
    inspect(good.replace('description: 演示用', 'description: ' + 'x'.repeat(1030)), 'demo-skill', () => true).errors
      .some(e => /limit 1024/.test(e)));
}

finish('skills.test');

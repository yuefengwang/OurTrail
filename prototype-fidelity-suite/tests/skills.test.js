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

// Skill rows are `| name | … |` or `| 1 | name | … |` with a backticked kebab id.
function rosterOf(readmeText) {
  return [...new Set(readmeText.split(/\r?\n/)
    .filter(line => line.startsWith('|'))
    .flatMap(line => [...line.matchAll(/^\|\s*(?:\d+\s*\|\s*)?`([a-z0-9]+(?:-[a-z0-9]+)*)`\s*\|/g)].map(m => m[1])))].sort();
}

// A project store is data, a skill is instructions. If a skill copies rule
// values, the two drift apart the moment either one changes — and the copy is
// the one nobody re-checks. So the separation is enforced, not documented.
function copiedFacts(text) {
  const errors = [];
  const decl = /^\s*--[a-z0-9-]+\s*:/m.exec(text);
  if (decl) errors.push(`re-declares a custom property: ${decl[0].trim()}`);
  const hex = /#[0-9a-fA-F]{3,8}\b/.exec(text);
  if (hex) errors.push(`embeds a colour literal: ${hex[0]}`);
  return errors;
}

section('skill documents are installable');
{
  const dirs = fs.readdirSync(SKILLS, { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(path.join(SKILLS, d.name, 'SKILL.md')))
    .map(d => d.name).sort();

  const readme = fs.readFileSync(path.join(SKILLS, 'README.md'), 'utf8');
  // The roster lives in the index, not in this test: a hardcoded list makes
  // "add a skill" itself a failing action (audit F1b). The comparison is
  // bidirectional instead, so an unindexed skill and an index row pointing at a
  // directory that does not exist both fail.
  const indexed = rosterOf(readme);
  check('the index names at least one skill', indexed.length > 0, indexed);
  eq('the index and the directories list the same skills', indexed, dirs);
  // Teeth: the parser must read the numbered table too, and a skill present only
  // in the directories must not sneak through as indexed.
  eq('the roster parser reads numbered and plain rows',
    rosterOf('| 1 | `a-b` | x |\n| `c-d` | y |\n| `PLAYWRIGHT_MODULE_PATH` | z |'), ['a-b', 'c-d']);
  check('an unindexed directory is a difference', JSON.stringify(rosterOf('| `a-b` | x |')) !== JSON.stringify(['a-b', 'c-d']));
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

section('the project store stays out of the general skill');
{
  const dir = path.join(SKILLS, 'ourtrail-design-dna');
  const extra = fs.readdirSync(dir, { withFileTypes: true })
    .filter(f => f.name !== 'SKILL.md' && !(f.isDirectory() && f.name === 'references'))
    .map(f => f.name);
  eq('the skill directory ships instructions only', extra, []);
  const body = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  eq('the body re-declares none of the stored values', copiedFacts(body), []);
  check('the copy check catches a pasted token table',
    copiedFacts('## 输出\n\n--radius: 18px;\n').length === 1,
    copiedFacts('## 输出\n\n--radius: 18px;\n'));
  check('the copy check catches an embedded colour', copiedFacts('边框用 #163E35。').length === 1);
  check('the copy check leaves a rule id alone', copiedFacts('见 `token.var.green` 与 `page.weather.home`。').length === 0);
}

// Both design skills hand the user diagnostic codes to act on and subcommands to
// type. A rename on either side turns the document into prose nobody can follow,
// so each doc is checked against the code that emits what it quotes. The reviewer
// also quotes plan gap codes: the plan it reads is written by the generalizer, so
// that module is part of what can invalidate its failure table.
section('the design skills only name things that exist');
{
  const docs = [
    ['design-dna-generalizer', ['design/generalize/plan.js']],
    ['design-consistency-reviewer', ['design/review/review.js', 'design/generalize/plan.js']],
  ];
  for (const [skill, extra] of docs) {
    const body = fs.readFileSync(path.join(SKILLS, skill, 'SKILL.md'), 'utf8');
    const source = ['cli/pf.js', ...extra]
      .map(p => fs.readFileSync(path.join(ROOT, p), 'utf8')).join('\n');
    const cmds = [...new Set([...body.matchAll(/pf ([a-z]+)/g)].map(m => m[1]))];
    check(`${skill}: the doc names at least one subcommand`, cmds.length > 0, cmds);
    for (const cmd of cmds) check(`${skill}: pf ${cmd} exists in the cli`, new RegExp(`case '${cmd}':`).test(source));
    // The failure-handling table quotes gate codes as things the user will see.
    const codes = [...new Set([...body.matchAll(/`([A-Z][A-Z_]{4,})`/g)].map(m => m[1]))];
    check(`${skill}: the doc quotes the gate codes it claims are observable`, codes.length > 0, codes);
    for (const c of codes) check(`${skill}: ${c} is a code the tool actually emits`, source.includes(`'${c}'`));
  }
}

// The vocabulary table exists because a brief author cannot guess these words:
// they wrote `role: "input"` (that is a `kind`) and got BRIEF_INVALID. A table
// that drifts from the code is worse than no table, so both directions are
// checked: every value the code accepts must be listed, and the doc may not
// list a value the code would reject.
section('the generalizer doc lists exactly the closed vocabularies');
{
  const plan = require('../design/generalize/plan');
  const body = fs.readFileSync(path.join(SKILLS, 'design-dna-generalizer', 'SKILL.md'), 'utf8');
  const rowOf = label => {
    const m = new RegExp('^\\|\\s*`' + label + '`\\s*\\|([^|]*)\\|', 'm').exec(body);
    return m ? [...m[1].matchAll(/`([^`]+)`/g)].map(x => x[1]) : null;
  };
  const pairs = [
    ['functions\\[\\]\\.kind', [...plan.FUNCTION_KINDS]],
    ['functions\\[\\]\\.role', plan.ROLE_NAMES],
    ['functions\\[\\]\\.states', [...plan.STATE_WORDS]],
    ['interactions\\[\\]', plan.INTERACTION_NAMES],
  ];
  for (const [label, code] of pairs) {
    const doc = rowOf(label);
    check(`${label}: the doc has a vocabulary row`, doc !== null);
    if (!doc) continue;
    const missing = code.filter(v => !doc.includes(v));
    const extra = doc.filter(v => !code.includes(v));
    check(`${label}: the doc lists every value the code accepts`, missing.length === 0, { missing });
    check(`${label}: the doc invents no value the code rejects`, extra.length === 0, { extra });
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

process.exit(finish('skills.test'));

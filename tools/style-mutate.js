'use strict'
// ST1-style 的判据有没有牙齿：复制 miniprogram 到临时目录，逐条把 app.wxss 的禁用族改回缺陷形，
// 要求 tools/style-semantics-test.js 在该副本上必须报「断言红」；仍然全绿 ⇒ 那条判据是假的。
//
// 与 fixround2-mutate.js 的三点差异（本轮特有的坑）：
// 1. 崩红不算抓到。样式判据是在解析源文件，注入若把文件弄成解析器读不懂的形态，子进程会以
//    异常退出（非 0 但没有 ✗ 行）。那种退出码不能被记成「变异被抓到」，单列 CRASH 并判失败。
// 2. 反向等价门（E1/E2/E3）不是回退缺陷，而是**合法重构**：合并选择器、拆开规则、调换书写次序
//    都不改变层叠终值 ⇒ 判据必须照样全绿。它们红了就说明门钉的是源码文本而不是行为（铁律 30）。
// 3. 同值不代表等价：M7（删掉 leaf 的禁用定义）终值与现状逐字相同，只有「词表闭合 + 赢家身份」
//    那两条门抓得住它 —— 这正是本轮把「按变体分定义」写进设计的理由（禁用态不许由顺带压制决定）。
//
// 锚点纪律：命中必须恰为 1 次，按目标文件自身的 EOL 拼接（CRLF 文件里写 \n 会命中 0 次 = 静默没注入）；
// 命中数不对就计漏网并 exit 1，不静默改错行充数。先跑「未变异副本全绿」的有效性门。
//
// 运行：node tools/style-mutate.js
// 退出码：0 = 每条回退都被抓到且每条等价重构都全绿；1 = 有漏网 / 有等价误伤 / 注入失败 / 崩红；2 = 前置门未过
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SUITE = 'style-semantics-test.js'
const REL = 'app.wxss'

const GENERIC = '.button.disabled, .button[disabled] { background: var(--line); border-color: var(--line); color: var(--muted); }'
const PRIMARY = '.button.primary.disabled, .button.primary[disabled] { background: var(--line); border-color: var(--line); color: var(--muted); }'
const SECONDARY = '.button.secondary.disabled, .button.secondary[disabled] { background: var(--line); border-color: var(--line); color: var(--muted); }'
const DANGER = '.button.danger.disabled, .button.danger[disabled] { background: var(--line); border-color: var(--line); color: var(--muted); }'
const LEAF = '.button.leaf.disabled, .button.leaf[disabled] { background: var(--line); border-color: var(--line); color: var(--muted); }'
const TEXT = '.button.text.disabled, .button.text[disabled] { background: transparent; border-color: transparent; color: var(--muted); }'
const HOVER = '.button-hover { opacity: 0.82; }'
const VARIANTS = [PRIMARY, SECONDARY, DANGER, LEAF, TEXT]

// ---- 文本原语（全部要求锚点命中恰 1 次）----
function eolOf(text) { return text.indexOf('\r\n') !== -1 ? '\r\n' : '\n' }
function mustOne(text, anchor) {
  const hits = text.split(anchor).length - 1
  if (hits !== 1) throw new Error('锚点命中 ' + hits + ' 次（要求恰 1 次）：' + anchor.slice(0, 72))
  return text
}
function repl(text, from, to) { mustOne(text, from); return text.split(from).join(to) }
function delLine(text, line) {
  mustOne(text, line)
  const eol = eolOf(text)
  return text.split(line + eol).join('')
}
function insertAfter(text, anchor, added) {
  mustOne(text, anchor)
  const eol = eolOf(text)
  return text.split(anchor).join(anchor + eol + added)
}
function insertBefore(text, anchor, added) {
  mustOne(text, anchor)
  const eol = eolOf(text)
  return text.split(anchor).join(added + eol + anchor)
}
function moveLineBefore(text, line, target) { return insertBefore(delLine(text, line), target, line) }

// ---- 回退类变异：判据必须红 ----
const MUTANTS = [
  ['M1 五条按变体的禁用定义全删（回到 app.wxss:L123 的 HEAD 原状）',
    t => VARIANTS.reduce((x, l) => delLine(x, l), t)],
  ['M2 只删 text 那条（B-11 本体复发：文字链禁用后又变灰块）', t => delLine(t, TEXT)],
  ['M3 text 禁用底色改回 var(--line)（规则留着、灰块也留着）',
    t => repl(t, TEXT, '.button.text.disabled, .button.text[disabled] { background: var(--line); border-color: transparent; color: var(--muted); }')],
  ['M4 text 禁用文字色退回 var(--forest)（禁用与可用同权重 = 倒挂没修）',
    t => repl(t, TEXT, '.button.text.disabled, .button.text[disabled] { background: transparent; border-color: transparent; color: var(--forest); }')],
  ['M5 text 禁用只声明 background（描边与文字退回被通用压制：长出可见灰环）',
    t => repl(t, TEXT, '.button.text.disabled, .button.text[disabled] { background: transparent; }')],
  ['M6 text 禁用丢掉 [disabled] 属性形态（原生 button 的禁用态与类形态给出两种灰）',
    t => repl(t, TEXT, '.button.text.disabled { background: transparent; border-color: transparent; color: var(--muted); }')],
  ['M7 删掉 leaf 的禁用定义（终值逐字不变，只有词表闭合与赢家身份抓得住 —— 顺带压制就是本轮要治的形态）',
    t => delLine(t, LEAF)],
  ['M8 primary 禁用底色换成 var(--leaf)（顺手改配色 / 实底族不再同一支禁用表达）',
    t => repl(t, PRIMARY, PRIMARY.replace('background: var(--line)', 'background: var(--leaf)'))],
  ['M9 兜底禁用文字色换成 var(--ink)（--muted 这支单源被拆掉，禁用比可用更黑）',
    t => repl(t, GENERIC, GENERIC.replace('color: var(--muted)', 'color: var(--ink)'))],
  ['M10 把 secondary 的 var(--line) 抄成字面量 #DEE3DB（终值不变，但影子改 token 追不上 = 假单源）',
    t => repl(t, SECONDARY, '.button.secondary.disabled, .button.secondary[disabled] { background: #DEE3DB; border-color: #DEE3DB; color: var(--muted); }')],
  ['M11 给兜底加 pointer-events: none（越界到 C-16 的按压反馈，还会废掉「点禁用按钮问原因」）',
    t => repl(t, GENERIC, GENERIC.replace('}', ' pointer-events: none; }'))],
  ['M12 给 text 加 opacity: .6（findings 原文那句写法：把 --muted 压到 3:1 以下并连带改掉按压反馈）',
    t => repl(t, TEXT, TEXT.replace('}', ' opacity: .6; }'))],
]

// ---- 等价类变异：判据必须全绿（红了就是门在钉源码文本）----
const EQUIVALENTS = [
  ['E1 把兜底通用规则挪到全部变体定义之后（变体靠 (0,3,0) 仍赢，六族终值与赢家一字不改）',
    t => insertAfter(delLine(t, GENERIC), HOVER, GENERIC)],
  ['E2 把 primary 的一条选择器列表拆成两条独立规则（同值拆开，层叠结果不变）',
    t => repl(t, PRIMARY, '.button.primary.disabled { background: var(--line); border-color: var(--line); color: var(--muted); }' +
      eolOf(t) + '.button.primary[disabled] { background: var(--line); border-color: var(--line); color: var(--muted); }')],
  ['E3 把 text 定义挪到兜底通用规则之前（书写次序换掉、特异度不变 ⇒ 赢家不得跟着换）',
    t => moveLineBefore(t, TEXT, GENERIC)],
  ['E4 五条变体定义整体逆序书写（族内次序与终值无关）',
    t => {
      const without = VARIANTS.reduce((x, l) => delLine(x, l), t)
      let out = without, anchor = GENERIC
      VARIANTS.slice().reverse().forEach(l => { out = insertAfter(out, anchor, l); anchor = l })
      return out
    }]
]

function sandbox(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutate-style-'))
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true })
  fs.cpSync(path.join(ROOT, 'miniprogram'), path.join(dir, 'miniprogram'), { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'tools', SUITE), path.join(dir, 'tools', SUITE))
  if (text !== undefined) fs.writeFileSync(path.join(dir, 'miniprogram', REL), text)
  return dir
}
// 三态读数：green / 断言红 red / 崩红 crash（崩红绝不记成「抓到」）
function runSuite(dir) {
  const r = cp.spawnSync(process.execPath, [path.join(dir, 'tools', SUITE)], { cwd: dir, encoding: 'utf8' })
  const out = String(r.stdout || '') + String(r.stderr || '')
  const reds = out.split(/\r?\n/).filter(l => l.trim().indexOf('✗') === 0)
  const tail = (out.match(/passed=\d+ failed=\d+/g) || []).pop() || ''
  if (r.error) return { kind: 'crash', detail: 'spawn 失败：' + r.error.message }
  if (reds.length && r.status !== 0) return { kind: 'red', detail: reds[0].trim().slice(0, 118) + ' ｜ ' + tail }
  if (r.status !== 0) return { kind: 'crash', detail: 'exit ' + r.status + ' 且无 ✗ 行（解析器或注入炸了，不算抓到）：' + out.split(/\r?\n/).filter(Boolean).slice(-1)[0] }
  if (reds.length) return { kind: 'crash', detail: 'exit 0 却有 ✗ 行（判据在说谎）' }
  return { kind: 'green', detail: tail }
}

const baseDir = sandbox()
const pre = runSuite(baseDir)
fs.rmSync(baseDir, { recursive: true, force: true })
if (pre.kind !== 'green') {
  console.error('前置门未过：未变异的临时副本不是全绿（' + pre.kind + '），后面所有「被抓到」都不作数\n  ' + pre.detail)
  process.exit(2)
}
console.log('有效性门：未变异副本全绿（' + pre.detail + '）\n')

const original = fs.readFileSync(path.join(ROOT, 'miniprogram', REL), 'utf8')
let leaked = 0, crashed = 0, equivalenceBroken = 0, injectionFailed = 0

MUTANTS.forEach(m => {
  let next
  try { next = m[1](original) } catch (e) {
    console.log('!! ' + m[0] + ' —— 注入失败：' + e.message)
    injectionFailed++
    return
  }
  const dir = sandbox(next)
  const r = runSuite(dir)
  fs.rmSync(dir, { recursive: true, force: true })
  if (r.kind === 'red') console.log('✓ ' + m[0] + '\n    被抓于 ' + r.detail)
  else if (r.kind === 'crash') { console.log('!! 崩红（不作数）：' + m[0] + '\n    ' + r.detail); crashed++ }
  else { console.log('✗ 漏网：' + m[0] + '（判据全绿 ⇒ 这条退化抓不住）'); leaked++ }
})

console.log('')
EQUIVALENTS.forEach(m => {
  let next
  try { next = m[1](original) } catch (e) {
    console.log('!! ' + m[0] + ' —— 注入失败：' + e.message)
    injectionFailed++
    return
  }
  if (next === original) { console.log('!! ' + m[0] + ' —— 注入后文本与原文相同（等价夹具空转）'); injectionFailed++; return }
  const dir = sandbox(next)
  const r = runSuite(dir)
  fs.rmSync(dir, { recursive: true, force: true })
  if (r.kind === 'green') console.log('✓ 等价重构未被误伤：' + m[0] + '\n    ' + r.detail)
  else if (r.kind === 'crash') { console.log('!! 崩红（等价夹具把文件弄炸了）：' + m[0] + '\n    ' + r.detail); crashed++ }
  else { console.log('✗ 等价误伤：' + m[0] + '\n    ' + r.detail + '\n    ⇒ 门在钉源码写法而不是层叠终值（铁律 30），合法重构会被当成改判据'); equivalenceBroken++ }
})

const bad = leaked + crashed + equivalenceBroken + injectionFailed
console.log('\n回退类 ' + MUTANTS.length + ' 条：抓到 ' + (MUTANTS.length - leaked - crashed) + '、漏网 ' + leaked + '、崩红 ' + crashed)
console.log('等价类 ' + EQUIVALENTS.length + ' 条：全绿 ' + (EQUIVALENTS.length - equivalenceBroken - crashed) + '、误伤 ' + equivalenceBroken)
console.log('注入失败 ' + injectionFailed + ' 条')
process.exit(bad ? 1 : 0)

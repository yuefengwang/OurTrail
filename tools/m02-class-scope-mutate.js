'use strict'
// M-02 判据有没有牙齿：把 miniprogram + 规范文档复制进 %TEMP% 沙盒，逐条注入回退/等价变异，
// 要求 tools/m02-class-scope-test.js 每次都报出指定类别的**新增**违例；等价控制必须违例集合零变化。
//
// 规矩（沿用本仓 b4-pad / swx1 先例，不新造框架；仓库零写入）：
//   ① 沙盒在 os.tmpdir()，判据用 M02_MP_ROOT / M02_DOC 指向副本；真实仓库只读，最后逐文件哈希自证。
//   ② 先跑**未变异副本**：不全绿就判「本次运行 INVALID」直接 exit 1，不在失效地基上数漏网。
//   ③ 每条变异要求锚点在该文件里**命中恰好 1 次**；wxss 锚点必须落在**真规则行**（落在注释里＝注入失败，
//      计漏网并 exit 1，不静默改错行充数）；追加型变异要求追加的那段本身是一条真声明、且原文件里还没有它。
//      ⚠ 本仓源码是 CRLF：跨行锚点会因 EOL 变体命中 0 次（＝变异没发生而套件照绿），所以锚点一律单行，
//        追加内容按目标文件自己的 EOL 拼。
//   ④ 期望红的：必须**新增**指定 code 的违例（相对基线判，不拿绝对红数充数）。
//   ⑤ 期望绿的等价控制：违例集合必须逐条相同，动了就算「误伤」（说明判据记的是文本不是终值）。
//   ⑥ 崩溃（子进程抛错／拿不到 passed= 读数）单列「崩红」，不与「抓到」混算。
//   ⑦ 末行闭合：红期待 = 抓到+漏网+崩红；绿期待 = 控制通过+误伤。
//
// 运行：node tools/m02-class-scope-mutate.js
// 退出码：0 = 0 漏网 0 崩红 0 误伤 0 注入失败；1 = 其余任何情况。
//
// 本沙盒打的是**判据**（M02_MP_ROOT 指向副本，真实仓库只读）。2026-10-17 起判据搬进
// tools/m02-class-scope-rules.js 并落进 tools/check.js，那一侧的接线由两条别的路证：
//   ① 套件 §8 接线检查（check.js 里 require 的是模块本身、命中/fatal/抛错三条都记红、哨兵在位）；
//   ② 真实树上的一次现场注入：往一个未改动的 wxml 追加 class="g10-bite-probe" ⇒ check.js exit=1 且
//      ✗ 行点名 [G10] 与该文件行号，随后 git checkout 还原（复验读数见 SYNC.md 2026-10-17 尾批条）。
// 这里不把 tools/ 整份复制进沙盒去跑副本 check.js——check.js 的 ROOT 按 __dirname 定位，
// 复制出来的那份测的是「另一棵仓库」，与真实预提交闸的接线不是一回事（测了也不算证据）。

const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '..')
const GATE = path.join(ROOT, 'tools', 'm02-class-scope-test.js')
const SRC_MP = path.join(ROOT, 'miniprogram')
const SRC_REFS = path.join(ROOT, '.agents', 'skills', 'ourtrail-ui', 'references')
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'm02-scope-mut-'))
const SB_MP = path.join(SANDBOX, 'miniprogram')
const SB_REFS = path.join(SANDBOX, 'refs')
function cpdir (from, to) {
  fs.mkdirSync(to, { recursive: true })
  fs.readdirSync(from, { withFileTypes: true }).forEach(e => {
    const a = path.join(from, e.name), b = path.join(to, e.name)
    if (e.isDirectory()) cpdir(a, b); else fs.copyFileSync(a, b)
  })
}
cpdir(SRC_MP, SB_MP)
cpdir(SRC_REFS, SB_REFS)

// 真实仓库零写入自证：开工前先哈希我方这批碰过的文件，收工后再哈希一次比对
const REAL_WATCH = ['miniprogram/app.wxss', 'miniprogram/pages/me/me.wxss', 'miniprogram/pages/privacy/privacy.wxml',
  'miniprogram/pages/privacy/privacy.wxss', '.agents/skills/ourtrail-ui/references/design-system.md',
  // 2026-10-17 落门时判据搬进了 tools/m02-class-scope-rules.js（套件与 check.js 共用那一份），
  // 零写入自证的哈希清单必须跟着搬，否则「闸门文件被改坏」这条路不在观察范围内。
  'tools/m02-class-scope-test.js', 'tools/m02-class-scope-rules.js']
function hashOf (rel) { return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, 12) }
const REAL_BEFORE = REAL_WATCH.map(p => p + '@' + hashOf(p))

const CL_RULE = '.card-label { display: block; font-size: 15px; font-weight: 600; margin-bottom: 12px; }'
const pf = d => 'pages/' + d + '/' + d + '.wxss'
const wf = d => 'pages/' + d + '/' + d + '.wxml'

/* ---------- 变异定义 ---------- */
const MUTS = [
  { id: 'R1 把 .card-label 从 app.wxss 摘掉（E-15 的缺陷本体回来：四页命不中任何选择器）',
    expect: 'red', need: x => x.code === 'E10' && /editor|weather-hub/.test(x.subject),
    ops: [{ file: 'app.wxss', from: CL_RULE, to: '' }] },
  { id: 'R2 在 me.wxss 留一份**同值**基础定义（两个真值源；终值恰好相同，只有出处判据抓得住）',
    expect: 'red', need: x => x.code === 'SRC' && x.subject === pf('me'),
    ops: [{ file: pf('me'), kind: 'append', text: '.card-label { display: block; font-size: 15px; font-weight: 600; margin-bottom: 12px; }' }] },
  /* 2026-10-17 合并修正：上游二阶段把 privacy.wxml 重排成 section-head/kicker/section-sub，
     下面 5 条变异/控制的锚点因此命中 0 次——注入失败按漏网计（本脚本正确地拒绝"结论成立"并 rc=1 退出）。
     逐条重钉到新形状，**每条的意图不变**（退回无定义类名 / 退回内联间距 / 部分插值不该被误报 / 类序无关）。 */
  { id: 'R3 privacy 主标题退回 h1（全仓零定义的类名 ⇒ 层级再次消失）',
    expect: 'red', need: x => x.code === 'E10' && /privacy/.test(x.subject) && /h1@/.test(x.detail),
    ops: [{ file: wf('privacy'), from: '<text class="page-title doc-title-block">隐私保护指引</text>', to: '<text class="h1">隐私保护指引</text>' }] },
  { id: 'R4 privacy 一个章节标题退回 h2 + 内联 margin-top（E-16 原形态）',
    expect: 'red', need: x => x.code === 'INLINE' || (x.code === 'PRIVACY' && /章节标题/.test(x.detail)),
    ops: [{ file: wf('privacy'), from: '<text class="section-title">一、我们收集的信息</text>',
      to: '<text class="h2" style="margin-top:36rpx">一、我们收集的信息</text>' }] },
  { id: 'R5 privacy 根节点退回 container（白卡再次贴屏幕四边；非 tab 页那条留白判据也要咬）',
    expect: 'red', need: x => (x.code === 'PRIVACY' && /内缩|留白/.test(x.detail)) || (x.code === 'E10' && /container@/.test(x.detail)),
    ops: [{ file: wf('privacy'), from: '<view class="page">', to: '<view class="container">' }] },
  { id: 'R6 privacy.wxss 私存一份 .page-title 字号（页内重印全局层级 = 第二个真值源）',
    expect: 'red', need: x => x.code === 'PRIVACY' && /主标题/.test(x.detail),
    ops: [{ file: pf('privacy'), kind: 'append', text: '.page-title { font-size: 20px; }' }] },
  { id: 'R7 把内联 style 加回更新日期那行（样式改由内联决定 = A-23/B-11 同族复发）',
    expect: 'red', need: x => x.code === 'INLINE' && /margin-top:8rpx/.test(x.detail),
    ops: [{ file: wf('privacy'), from: '<text class="section-sub">更新日期：2026-09-24</text>',
      to: '<text class="section-sub" style="margin-top:8rpx">更新日期：2026-09-24</text>' }] },
  { id: 'R8 代码把 15px 改成 17px 而文档不动（登记与终值分叉 = 文档开始说谎）',
    expect: 'red', need: x => x.code === 'REG' && /分叉/.test(x.detail),
    ops: [{ file: 'app.wxss', from: CL_RULE, to: '.card-label { display: block; font-size: 17px; font-weight: 600; margin-bottom: 12px; }' }] },
  { id: 'R9 探针不许被动态名骗：往 privacy 塞一个 class="m02-dyn-{{k}}"（部分插值不是「无定义」）',
    expect: 'green', ops: [{ file: wf('privacy'), from: '<text class="section-sub">', to: '<text class="m02-dyn-{{k}}"></text><text class="section-sub">' }] },

  /* ---- 等价控制：行为不变的重构必须照样全绿，红了就是误伤（说明判据记的是文本） ---- */
  { id: 'E1 改写 app.wxss 里 .card-label 那段注释的措辞（判据不读注释 ⇒ 必须绿）',
    expect: 'green', ops: [{ file: 'app.wxss', from: '/* 卡内小标题（E-15 / B-02 / M-02）：卡片内部「这一段是什么」的那一行，多页共用',
      to: '/* 卡内小标题（本轮记账号略调）：卡片里说明「这一段是什么」的那一行，多页共用', commentOnly: true }] },
  { id: 'E2 把 .card-label 拆成两条规则（display 一条、其余一条，同文件同值）⇒ 终值不变 ⇒ 必须绿',
    expect: 'green', ops: [{ file: 'app.wxss', from: CL_RULE, to: '.card-label { display: block; } .card-label { font-size: 15px; font-weight: 600; margin-bottom: 12px; }' }] },
  { id: 'E3 margin-bottom 的长写法换成 margin 简写（同四条终值；写法不该被钉）',
    expect: 'green', ops: [{ file: 'app.wxss', from: CL_RULE, to: '.card-label { display: block; font-size: 15px; font-weight: 600; margin: 0 0 12px 0; }' }] },
  { id: 'E4 把 .card-label 那条整行搬到 .muted 之后（同特异度同值，次序在该属性上无竞争者）⇒ 必须绿',
    expect: 'green', ops: [{ file: 'app.wxss', from: CL_RULE, to: '' },
      { file: 'app.wxss', kind: 'append', text: CL_RULE }] },
  { id: 'E5 privacy 主标题的两个类调换次序（class 是无序集合 ⇒ 终值不变，必须绿）',
    expect: 'green', ops: [{ file: wf('privacy'), from: '<text class="page-title doc-title-block">隐私保护指引</text>',
      to: '<text class="doc-title-block page-title">隐私保护指引</text>' }] },
  { id: 'E6 privacy.wxss 的段距规则改成多行写法（同一条声明、写法不该被钉 ⇒ 必须绿）',
    expect: 'green', ops: [{ file: pf('privacy'), from: '.doc-title-block { display: block; margin-top: 4px; }', to: '.doc-title-block {\n  display: block;\n  margin-top: 4px;\n}', eolJoin: true, commentOnly: true }] }
]

/* ---------- 落盘工具 ---------- */
function targetPath (rel) { return rel.indexOf('REFS:') === 0 ? path.join(SB_REFS, rel.slice(5)) : path.join(SB_MP, rel) }
function readTarget (rel) { return fs.readFileSync(targetPath(rel), 'utf8') }
function writeTarget (rel, text) { fs.writeFileSync(targetPath(rel), text) }
function eolOf (text) { return text.indexOf('\r\n') !== -1 ? '\r\n' : '\n' }
function commentState (text, index) {
  let inBlock = false, i = 0
  while (i < index && i < text.length) {
    if (!inBlock && text[i] === '/' && text[i + 1] === '*') { inBlock = true; i += 2; continue }
    if (inBlock && text[i] === '*' && text[i + 1] === '/') { inBlock = false; i += 2; continue }
    i++
  }
  return inBlock
}
function lineOf (text, index) {
  const s = text.lastIndexOf('\n', index) + 1
  const e = text.indexOf('\n', index)
  return text.slice(s, e < 0 ? text.length : e).trim()
}
function isWxss (rel) { return /\.wxss$/.test(rel) && rel.indexOf('REFS:') !== 0 }
function isWxml (rel) { return /\.wxml$/.test(rel) }
function applyOp (op) {
  const text = readTarget(op.file)
  if (op.kind === 'append') {
    const body = op.text.replace(/\n/g, eolOf(text)) + eolOf(text)
    const hits = text.split(op.text).length - 1
    if (hits !== 0) return { fail: '要追加的内容已在文件里（命中 ' + hits + ' 次）＝变异是空操作：' + op.file }
    if (!/^\s*\.[\w-]+[^{}]*\{[^{}]*[a-z-]+\s*:/.test(op.text)) return { fail: '注入的那段不是一条真声明：' + op.file }
    if (isWxss(op.file) && commentState(text, text.length)) return { fail: '追加落点落在注释里（判注入失败）：' + op.file }
    return { next: text + body }
  }
  const hits = text.split(op.from).length - 1
  if (hits !== 1) return { fail: '锚点命中 ' + hits + ' 次（要求恰好 1 次）：' + op.file }
  const at = text.indexOf(op.from)
  if (isWxss(op.file) && !op.commentOnly && commentState(text, at)) {
    return { fail: '锚点落在注释里（只剩注释＝注入失败）：' + op.file + ' → ' + lineOf(text, at).slice(0, 60) }
  }
  if (isWxss(op.file) && !op.commentOnly && lineOf(text, at).indexOf('{') === -1) {
    return { fail: '锚点不在规则行上（可能只命中了注释文字）：' + op.file + ' → ' + lineOf(text, at).slice(0, 60) }
  }
  if (isWxml(op.file) && !/<(view|text|button|scroll-view)[\s>]/.test(op.from) && op.to === '') {
    return { fail: '要删的不是标签行：' + op.file }
  }
  const to = op.eolJoin ? op.to.replace(/\n/g, eolOf(text)) : op.to
  return { next: text.replace(op.from, to) }
}

/* ---------- 跑判据 ---------- */
function runGate () {
  const r = cp.spawnSync(process.execPath, [GATE], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { M02_MP_ROOT: SB_MP, M02_DOC: path.join(SB_REFS, 'design-system.md') })
  })
  const out = String(r.stdout || '') + String(r.stderr || '')
  const m = /passed=(\d+) failed=(\d+)/.exec(out)
  const crashed = !m || !!r.error || !!r.signal
  const viol = new Set()
  const map = {}
  out.split(/\r?\n/).filter(l => l.indexOf('#V|') === 0).forEach(l => {
    viol.add(l.slice(3))
    const p = l.slice(3).split('|')
    map[l.slice(3)] = { code: p[0] || '', subject: p[1] || '', detail: p.slice(2).join('|') }
  })
  return { code: r.status, out, m, crashed, viol, map }
}

/* ---------- 有效性门 ---------- */
console.log('== 有效性门：未变异副本必须全绿 ==')
const baseRun = runGate()
if (baseRun.crashed) {
  console.log('崩红：判据在沙盒里跑不起来\n' + baseRun.out.slice(-1500))
  fs.rmSync(SANDBOX, { recursive: true, force: true }); process.exit(1)
}
if (baseRun.code !== 0 || Number(baseRun.m[1]) === 0 || Number(baseRun.m[2]) !== 0) {
  console.log('本次运行 INVALID：沙盒基线不干净（passed=' + baseRun.m[1] + ' failed=' + baseRun.m[2] + '）⇒ 不在失效地基上数漏网')
  console.log(baseRun.out.split(/\r?\n/).filter(l => /^  ✗/.test(l)).join('\n'))
  fs.rmSync(SANDBOX, { recursive: true, force: true }); process.exit(1)
}
const BASE_SET = baseRun.viol
console.log('  ✓ 未变异副本 passed=' + baseRun.m[1] + ' failed=' + baseRun.m[2] + '（沙盒 ' + SANDBOX + '，仓库零写入）')

let caught = 0, missed = 0, crashed = 0, friendly = 0, controls = 0
const injFail = []
const redExpect = MUTS.filter(x => x.expect === 'red').length
const greenExpect = MUTS.length - redExpect

MUTS.forEach(mo => {
  console.log('\n—— ' + mo.id)
  const snapshots = []
  let broken = null
  for (const op of mo.ops) {
    const res = applyOp(op)
    if (res.fail) { broken = res.fail; break }
    snapshots.push([op.file, readTarget(op.file)])
    writeTarget(op.file, res.next)
  }
  if (broken) {
    injFail.push(mo.id + ' → ' + broken)
    console.log('  注入失败：' + broken)
  } else {
    const run = runGate()
    if (run.crashed) {
      crashed++
      console.log('  崩红（不计入「抓到」）：' + run.out.split(/\r?\n/).slice(-3).join(' / '))
    } else {
      const added = Array.from(run.viol).filter(x => !BASE_SET.has(x))
      const removed = Array.from(BASE_SET).filter(x => !run.viol.has(x))
      if (mo.expect === 'red') {
        const hit = added.map(v => run.map[v]).some(mo.need)
        if (hit) {
          caught++
          console.log('  抓到（新增 ' + added.length + ' 条）：' + added.slice(0, 2).join(' ｜ '))
        } else {
          missed++
          console.log('  ✗ 漏网：新增 ' + added.length + ' 条但没有一条命中指定类别\n    ' + added.slice(0, 3).join(' ｜ '))
        }
        console.log('  读数：passed=' + run.m[1] + ' failed=' + run.m[2] + '，exit=' + run.code)
      } else if (run.code === 0 && added.length === 0 && removed.length === 0) {
        controls++
        console.log('  ✓ 控制通过：违例集合零变化（判据没记住文本/没被动态名骗）')
      } else {
        friendly++
        console.log('  ✗ 误伤：新增 ' + added.length + ' / 消失 ' + removed.length + '｜' + added.concat(removed).slice(0, 2).join(' ｜ '))
        console.log('  读数：passed=' + (run.m && run.m[1]) + ' failed=' + (run.m && run.m[2]) + '，exit=' + run.code)
      }
    }
  }
  snapshots.reverse().forEach(pair => writeTarget(pair[0], pair[1]))
})

console.log('\n== 闭合 ==')
console.log('红期待 ' + redExpect + ' 条：抓到=' + caught + ' 漏网=' + missed + ' 崩红=' + crashed +
  '（抓到+漏网+崩红=' + (caught + missed + crashed) + '）')
console.log('绿期待 ' + greenExpect + ' 条：控制通过=' + controls + ' 误伤=' + friendly +
  '（通过+误伤=' + (controls + friendly) + '）')
console.log('抓到/漏网/崩红/误伤 = ' + caught + '/' + missed + '/' + crashed + '/' + friendly)
if (injFail.length) {
  console.log('注入失败 ' + injFail.length + ' 条（判据没资格读数，另计漏网）')
  injFail.forEach(x => console.log('  · ' + x))
  missed += injFail.length
}
const realAfter = REAL_WATCH.map(p => p + '@' + hashOf(p))
const drift = realAfter.filter((h, i) => h !== REAL_BEFORE[i])
console.log('真实仓库零写入自证：' + REAL_WATCH.length + ' 个文件哈希逐条相同 ⇒ ' + (drift.length === 0 ? '通过' : '被破坏：' + drift.join(' | ')))
fs.rmSync(SANDBOX, { recursive: true, force: true })
const ok = injFail.length === 0 && missed === 0 && crashed === 0 && friendly === 0 && drift.length === 0 &&
  caught + missed + crashed === redExpect && controls + friendly === greenExpect
console.log(ok ? '结论：0 漏网 0 崩红 0 误伤 0 注入失败' : '结论：不成立')
process.exit(ok ? 0 : 1)

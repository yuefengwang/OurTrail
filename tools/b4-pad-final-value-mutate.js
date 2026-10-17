'use strict'
// B4-PAD — 变异自证：`tools/b4-pad-final-value-test.js` 的牙齿是真的吗？
//
// 做法（沿用本仓库 qa 先例，不新造框架；仓库零写入）：
//   ① 把 miniprogram 与规范文档整份复制到 %TEMP% 沙盒（禁 npm、禁开发者工具）；
//   ② 先跑一次**未变异副本**——不全绿就判「本次运行 INVALID」直接 exit 1，不在失效的地基上数漏网；
//   ③ 每条变异要求锚点在该文件里**命中恰好 1 次**，且落点**在注释之外**（只剩注释＝注入失败，计漏网并 exit 1）；
//      追加型变异要求追加的那段本身是一条真声明，并同样验注释状态；只有标 commentOnly 的等价控制允许动注释
//      （那几条存在的目的正是证明判据不读注释）；
//   ④ 期望红的：必须**新增**指定 code／页面的违例（拿「相对基线新增了什么」判，不拿绝对红数充数）；
//      期望绿的等价控制：违例集合必须零变化，红了计「误伤」（说明判据记的是文本不是终值）；
//   ⑤ 崩溃（子进程抛错／拿不到 passed= 读数）单列「崩红」，不与「抓到」混算；
//   ⑥ 末行闭合：抓到 + 漏网 + 崩红 = 红期待总数；控制通过 + 误伤 = 绿期待总数。
//
// 运行：node tools/b4-pad-final-value-mutate.js
// 退出码：0 = 0 漏网 0 崩红 0 误伤 0 注入失败；1 = 其余任何情况。

const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const GATE = path.join(ROOT, 'tools', 'b4-pad-final-value-test.js')
const SRC_MP = path.join(ROOT, 'miniprogram')
const SRC_REFS = path.join(ROOT, '.agents', 'skills', 'ourtrail-ui', 'references')
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'b4-pad-mut-'))
const SB_MP = path.join(SANDBOX, 'miniprogram')
const SB_REFS = path.join(SANDBOX, 'refs')
function cpdir (from, to) {
  fs.mkdirSync(to, { recursive: true })
  fs.readdirSync(from, { withFileTypes: true }).forEach(e => {
    const a = path.join(from, e.name); const b = path.join(to, e.name)
    if (e.isDirectory()) cpdir(a, b); else fs.copyFileSync(a, b)
  })
}
cpdir(SRC_MP, SB_MP)
cpdir(SRC_REFS, SB_REFS)

const TAB_DECL = '.page { padding-bottom: calc(32px + 84px + env(safe-area-inset-bottom)); }'
const DOC_LINE = '- **公式**：`padding-bottom: calc(32px + 84px + env(safe-area-inset-bottom))`'
const SKEL = '/* ---------- 页面骨架与节奏 ---------- */'
const pf = d => 'pages/' + d + '/' + d + '.wxss'

/* ---------- 变异定义 ---------- */
const MUTS = [
  { id: 'M1 非 tab 页抄走 tab 留白（给子页 route 追加那条声明＝M-18 的形态换个页面复发）',
    expect: 'red', need: x => x.code === 'T3' && x.dir === 'route',
    ops: [{ file: pf('route'), kind: 'append', text: '\n' + TAB_DECL + '\n' }] },
  { id: 'M2 把 M-18 的错抄塞回 anotices（历史现场：子页吃 84px 底栏位）',
    expect: 'red', need: x => x.code === 'T3' && x.dir === 'anotices',
    ops: [{ file: pf('anotices'), kind: 'append', text: '\n' + TAB_DECL + '\n' }] },
  { id: 'M3 tab 页载体整行删掉（home 尾行被 tabBar 截断，2026-09-30 那个事故回来）',
    expect: 'red', need: x => x.code === 'T2' && x.dir === 'home',
    ops: [{ file: pf('home'), from: TAB_DECL, to: '' }] },
  { id: 'M3b 四页载体一把删光（防「收成 0 份」的一刀切：必须逐页各报一条，不是只报一条）',
    expect: 'red', atLeast: 4, need: x => x.code === 'T2',
    ops: ['home', 'me', 'notices', 'weather-hub'].map(d => ({ file: pf(d), from: TAB_DECL, to: '' })) },
  { id: 'M4 留白改小到盖不住底栏（84→16：判据用的是遮挡物自己算出的 61px，不是抄来的 84）',
    expect: 'red', need: x => x.code === 'T2' && x.dir === 'me',
    ops: [{ file: pf('me'), from: TAB_DECL, to: '.page { padding-bottom: calc(16px + 16px + env(safe-area-inset-bottom)); }' }] },
  { id: 'M5 丢掉安全区项（数值够但没有 env() ⇒ 全面屏压尾行，platform-pitfalls §6）',
    expect: 'red', need: x => x.code === 'T2' && x.dir === 'notices' && /safe-area|安全区/.test(x.msg),
    ops: [{ file: pf('notices'), from: TAB_DECL, to: '.page { padding-bottom: 116px; }' }] },
  { id: 'M6 单页漂移（只把 weather-hub 换成 100px+安全区：四份复制开始各说一套）',
    expect: 'red', need: x => x.code === 'T2b' && x.dir === 'weather-hub',
    ops: [{ file: pf('weather-hub'), from: TAB_DECL, to: '.page { padding-bottom: calc(32px + 68px + env(safe-area-inset-bottom)); }' }] },
  { id: 'M7 注册表那一行的数被改（84→64 ⇒ 文档与代码终值分叉）',
    expect: 'red', need: x => x.code === 'T6',
    ops: [{ file: 'REFS:design-system.md', from: DOC_LINE,
      to: '- **公式**：`padding-bottom: calc(32px + 64px + env(safe-area-inset-bottom))`' }] },
  { id: 'M8 注册表锚点被改名（判据失去输入必须失败关闭，不能静默当成「没登记」放过）',
    expect: 'red', need: x => x.code === 'T0' || x.code === 'T6',
    ops: [{ file: 'REFS:design-system.md', from: DOC_LINE,
      to: DOC_LINE.replace('- **公式**：', '- **formula**：') }] },
  { id: 'M9 tab 名单换了个页（app.json 是分组唯一依据：新进名单的 route 没载体必须红）',
    expect: 'red', need: x => x.code === 'T2' && x.dir === 'route',
    ops: [{ file: 'app.json', from: '"pagePath": "pages/notices/notices"', to: '"pagePath": "pages/route/route"' }] },
  { id: 'M10 派单要求 1 那条路（把公式收进 .page.with-tabbar 并删页级载体）⇒ home 不带该类那一支必须报红',
    expect: 'red', need: x => x.code === 'T2' && x.dir === 'home' && x.branch.indexOf('with-tabbar') === -1,
    ops: [{ file: 'app.wxss', from: SKEL, to: SKEL + '\n' + '.page.with-tabbar { padding-bottom: calc(32px + 84px + env(safe-area-inset-bottom)); }' },
      { file: pf('home'), from: TAB_DECL, to: '' }] },
  { id: 'M11 把 app.wxss 的 .page 基线改成 tab 那份（全局表吃掉 16 个子页＝M-18 的放大版）',
    expect: 'red', need: x => x.code === 'T3' || x.code === 'T3b',
    ops: [{ file: 'app.wxss', from: 'padding: 24px 20px 32px;',
      to: 'padding: 24px 20px calc(32px + 84px + env(safe-area-inset-bottom));' }] },

  /* ---- 等价控制：行为不变的重构必须照样全绿，红了就是误伤（说明判据记的是文本） ---- */
  { id: 'E1 把 home 那一行从第 2 行搬到文件末尾（同值同特异度）⇒ 终值不变 ⇒ 必须绿',
    expect: 'green', ops: [{ file: pf('home'), from: TAB_DECL, to: '' }, { file: pf('home'), kind: 'append', text: '\n' + TAB_DECL + '\n' }] },
  { id: 'E2 改写 home.wxss 那段注释的措辞（判据不读注释 ⇒ 必须绿）',
    expect: 'green', ops: [{ file: pf('home'), from: '/* 首页：卡片信息区留白', to: '/* 首页说明换了一种写法：', commentOnly: true }] },
  { id: 'E3 在 home.wxss 末尾追加一条与留白无关的同选择器声明（box-sizing）⇒ 底部留白赢家不变 ⇒ 必须绿',
    expect: 'green', ops: [{ file: pf('home'), kind: 'append', text: '\n.page { box-sizing: border-box; }\n' }] }
]

/* ---------- 落盘工具 ---------- */
function targetPath (rel) {
  return rel.indexOf('REFS:') === 0 ? path.join(SB_REFS, rel.slice(5)) : path.join(SB_MP, rel)
}
function readTarget (rel) { return fs.readFileSync(targetPath(rel), 'utf8') }
function writeTarget (rel, text) { fs.writeFileSync(targetPath(rel), text) }
function commentState (text, index) {
  let inBlock = false
  let i = 0
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
function applyOp (op) {
  const text = readTarget(op.file)
  if (op.kind === 'append') {
    // 追加型变异没有「原有锚点」可改，牙齿换成三条：① 这条声明原本不在文件里（否则变异是空操作）；
    // ② 追加的落点不在块注释内（文件结尾若卡在注释里，注入等于只改了注释）；③ 追加的那段必须是一条真声明。
    const hits = text.split(op.text).length - 1
    if (hits !== 0) return { fail: '要追加的内容已在文件里（命中 ' + hits + ' 次）＝变异是空操作：' + op.file }
    if (!/^\s*\.[\w-]+[^{}]*\{[^{}]*[a-z-]+\s*:/.test(op.text)) return { fail: '注入的那段不是一条真声明：' + op.file }
    if (isWxss(op.file) && commentState(text, text.length)) return { fail: '追加落点落在注释里（判注入失败）：' + op.file }
    return { next: text + op.text }
  }
  const hits = text.split(op.from).length - 1
  if (hits !== 1) return { fail: '锚点命中 ' + hits + ' 次（要求恰好 1 次）：' + op.file }
  const at = text.indexOf(op.from)
  if (isWxss(op.file) && !op.commentOnly && commentState(text, at)) {
    return { fail: '锚点落在注释里（只剩注释＝注入失败）：' + op.file + ' → ' + lineOf(text, at).slice(0, 60) }
  }
  if (op.to === '' && lineOf(text, at).indexOf('{') === -1) {
    return { fail: '要删的那一行不是规则行（删的可能是注释）：' + op.file }
  }
  return { next: text.replace(op.from, op.to) }
}

/* ---------- 跑判据 ---------- */
function runGate () {
  const r = cp.spawnSync(process.execPath, [GATE], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      B4PAD_MP: SB_MP, B4PAD_DOC: path.join(SB_REFS, 'design-system.md'), B4PAD_REFS: SB_REFS
    })
  })
  const out = String(r.stdout || '') + String(r.stderr || '')
  const m = /passed=(\d+) failed=(\d+)/.exec(out)
  const crashed = !m || !!r.error || !!r.signal
  const viol = new Set()
  out.split(/\r?\n/).filter(l => l.indexOf('#V|') === 0).forEach(l => viol.add(l.slice(3)))
  return { code: r.status, out, m, crashed, viol }
}
const parseV = s => {
  const p = s.split('|')
  return { code: p[0] || '', dir: p[1] || '', branch: p[2] || '', msg: p.slice(3).join('|') }
}

/* ---------- 有效性门 ---------- */
console.log('== 有效性门：未变异副本必须全绿 ==')
const baseRun = runGate()
if (baseRun.crashed) {
  console.log('崩红：判据在沙盒里跑不起来\n' + baseRun.out.slice(-1200))
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
      console.log('  崩红（不计入「抓到」）：' + run.out.split(/\r?\n/).slice(-2).join(' / '))
    } else {
      const added = Array.from(run.viol).filter(x => !BASE_SET.has(x))
      const removed = Array.from(BASE_SET).filter(x => !run.viol.has(x))
      if (mo.expect === 'red') {
        const hit = added.map(parseV).some(mo.need)
        const enough = !mo.atLeast || added.length >= mo.atLeast
        if (hit && enough) {
          caught++
          console.log('  抓到（新增 ' + added.length + ' 条）：' + added.slice(0, 2).join(' ｜ '))
        } else {
          missed++
          console.log('  ✗ 漏网：新增 ' + added.length + ' 条，命中=' + hit + ' 数量够=' + enough +
            '\n    ' + added.slice(0, 3).join(' ｜ '))
        }
        console.log('  读数：passed=' + run.m[1] + ' failed=' + run.m[2] + '，exit=' + run.code)
      } else if (run.code === 0 && added.length === 0 && removed.length === 0) {
        controls++
        console.log('  ✓ 控制通过：违例集合零变化（判据没记住文本）')
      } else {
        friendly++
        console.log('  ✗ 误伤：新增 ' + added.length + ' / 消失 ' + removed.length +
          '｜' + added.concat(removed).slice(0, 2).join(' ｜ '))
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
fs.rmSync(SANDBOX, { recursive: true, force: true })
const ok = injFail.length === 0 && missed === 0 && crashed === 0 && friendly === 0 &&
  caught + missed + crashed === redExpect && controls + friendly === greenExpect
console.log(ok ? '结论：0 漏网 0 崩红 0 误伤' : '结论：不成立')
process.exit(ok ? 0 : 1)

'use strict'
// SWX1 判据有没有牙齿：把 miniprogram + design-system.md + 本套件复制进 %TEMP% 沙盒，逐条注入回退/等价变异，
// 在沙盒里跑 tools/swx1-style-gates-test.js，要求回退类**必须红在被保护的那条判据上**、等价类**必须绿**。
//
// 五条纪律（前四条实测踩过，第五条是本轮第一版的夹具自己翻出来的）：
// 1. 绝不修改真实仓库：所有写入只发生在 os.tmpdir() 下的副本里。
// 2. 锚点命中必须恰为 1 次且必须落在**真实代码行**上；命中数不对就判「注入失败」并 exit 1，
//    不静默改错行充数（第十轮 S5 的教训：偏移落在中文注释上，变异等于没发生而套件照绿）。
// 3. 崩红不算抓到。样式判据在解析源文件，注入若把文件弄成解析器读不懂的形态，子进程会异常退出；
//    那种退出码单列 CRASH 并判失败（「exit≠0」本身不是证据）。
// 4. **红了不等于抓对了**。每条写变异必须声明它要抓哪条判据；实际红的编号不在预期集合里 ⇒ 记「抓错」并判失败。
//    本轮第一版就是靠这条才发现自己的夹具在造假：写变异直接 return 改好的 app.wxss 文本，
//    Object.keys(字符串) 得到字符下标 ⇒ 一个字符一个字符地覆盖 design-system.md，
//    「18 条抓到」红的全是文档被毁（T3.7），没有一条落在被保护的判据上。
// 5. 夹具改动的**范围**也要记账：块级替换只许改声明体，选择器头一动整条规则就消失，
//    于是一条「只改 gap」的变异会连带把 T1.4（对比度）也判红 —— 那是假红，不是牙齿。
//    所以：锚点要求**行首唯一**，落盘后按行做多重集合差（+增/−删）并打印，改动面积超出预期即人工复核。
//
// 运行：node tools/swx1-style-gates-mutate.js
// 退出码：0 = 每条回退都抓对且每条等价重构都不误伤；1 = 漏网 / 抓错 / 等价误伤 / 注入失败 / 崩红；2 = 前置门未过
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SUITE = 'swx1-style-gates-test.js'
const REL_APP = path.join('miniprogram', 'app.wxss')
const REL_TAB = path.join('miniprogram', 'custom-tab-bar', 'index.wxss')
const REL_DOC = path.join('.agents', 'skills', 'ourtrail-ui', 'references', 'design-system.md')
const REL_BY_KEY = { app: REL_APP, tab: REL_TAB, doc: REL_DOC }

/* ---------------- 文本原语（命中必须恰 1 次；仓库是 CRLF ⇒ 不拿跨行 \n 字面量当锚点） ---------------- */
function eolOf (text) { return text.indexOf('\r\n') !== -1 ? '\r\n' : '\n' }
function hits (text, anchor) { return text.split(anchor).length - 1 }
function mustOne (text, anchor) {
  const n = hits(text, anchor)
  if (n !== 1) throw new Error('锚点命中 ' + n + ' 次（要求恰 1 次）：' + anchor.slice(0, 60))
}
function escRe (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function repl (text, from, to) { mustOne(text, from); return text.split(from).join(to) }
function delLine (text, line) {
  mustOne(text, line)
  const eol = eolOf(text)
  return text.split(text.indexOf(line + eol) !== -1 ? line + eol : eol + line).join('')
}
function insertAfter (text, anchor, added) { mustOne(text, anchor); return text.split(anchor).join(anchor + eolOf(text) + added) }
function insertBefore (text, anchor, added) { mustOne(text, anchor); return text.split(anchor).join(added + eolOf(text) + anchor) }
// 行首锚点：`.activity-card__title {` 作为普通子串会命中 2 次（featured 变体的选择器里含同一串），
// 但作为「行首」只命中 1 次 —— 这类「看起来唯一」的锚点是假绿的常见来源，所以判唯一性按行首算。
function lineStart (text, sel) {
  // flags 必须含 g：非全局正则的 exec 永远从 0 开始，lastIndex 赋不进去 ⇒ 匹配同一个位置无限循环
  const re = new RegExp('^' + escRe(sel), 'gm')
  const at = Array.from(text.matchAll(re), m => m.index)
  if (at.length !== 1) throw new Error('行首锚点命中 ' + at.length + ' 次（要求恰 1 次）：' + sel)
  return at[0]
}
// 整块定位：只定位「声明体」，选择器头永远留在原地（纪律 5）
function blockRange (text, sel) {
  const start = lineStart(text, sel)
  const bodyStart = text.indexOf('{', start)
  const bodyEnd = text.indexOf('}', bodyStart)
  if (bodyStart < 0 || bodyEnd < 0) throw new Error('块花括号不完整：' + sel)
  return { start, headEnd: bodyStart + 1, bodyStart: bodyStart + 1, bodyEnd, end: bodyEnd + 1, body: text.slice(bodyStart + 1, bodyEnd) }
}
function editBlock (text, sel, fn) {
  const r = blockRange(text, sel)
  const next = fn(r.body)
  if (next === r.body) throw new Error('块内替换未改动任何字节：' + sel)
  if (next.indexOf('{') !== -1 || next.indexOf('}') !== -1) throw new Error('块内替换引入了花括号（会破坏结构）：' + sel)
  return text.slice(0, r.bodyStart) + next + text.slice(r.bodyEnd)
}
function dropBlock (text, sel) { const r = blockRange(text, sel); return text.slice(0, r.start) + text.slice(r.end) }

const SEG_HEAD = '.segmented .seg {'
const TAB_HEAD = '.tab {'
const TAB_ON_HEAD = '.tab.on {'
const TITLE_HEAD = '.activity-card__title {'
const VALUE_HEAD = '.metric .metric-value {'
const NAME_HEAD = '.person-row__heading .person-name {'
const FEATURED_ROW = '.activity-card--featured .activity-card__title { font-size: 26px; line-height: 1.35; letter-spacing: -0.5px; }'
const METRICS_ROW = '| `.metrics/.metric` | 指标行，**默认三列**（activity/transport-panel/me/workspace 都是三列）；`pages/route` 详情头部是**四列**（公里/爬升米/节点/风险）——以实现为准登记（M-16）。hero 内自动反白；四列时每列约 67px，数字溢出由 `.metric-value` 的 `overflow-wrap: anywhere` 兜住（见下「长文本与数字的溢出策略」） |'
const LEAF_ROW = '| `--leaf-on-forest` | #2D533F | 森林底上的嫩叶底；亦为「星空」天相色 |'

/* ---------------- 回退类变异：必须红，且必须红在**声明的那条判据**上 ---------------- */
const MUTANTS = [
  ['M1 .seg 的 min-height 退回硬编码 36px（M-06 本体复发：规范 44 / 实现 36 重新分叉）',
    f => ({ app: editBlock(f.app, SEG_HEAD, b => b.replace('min-height: var(--touch-target)', 'min-height: 36px')) }), ['T1.1']],
  ['M2 .seg 的 min-height 写成 44px 字面量（终值一样，但影子调 --touch-target 追不上 = 假单源）',
    f => ({ app: editBlock(f.app, SEG_HEAD, b => b.replace('min-height: var(--touch-target)', 'min-height: 44px')) }), ['T1.3']],
  ['M3 未选中态字色退回 var(--muted)（#5F6E66 压在 --line 轨道上 = 4.12:1，未过仓库自家 4.5:1）',
    f => ({ app: editBlock(f.app, SEG_HEAD, b => b.replace('color: var(--ink)', 'color: var(--muted)')) }), ['T1.4']],
  ['M4 未选中态字色现场发明一个合格字面色 #44504A（绕过铁律 17：配色必须先登记 token）',
    f => ({ app: editBlock(f.app, SEG_HEAD, b => b.replace('color: var(--ink)', 'color: #44504A')) }), ['T1.10']],
  ['M5 把 app.wxss 那份 .tabbar 重复块原样请回来（取值与组件那份逐项相同 —— 只有「来源」判据抓得住）',
    f => ({ app: f.app + eolOf(f.app) + '.tabbar .tab { min-height: var(--touch-target); color: var(--muted); font-size: var(--text-caption); border-radius: var(--radius-button); }' }), ['T2.1', 'T2.3']],
  ['M6 反向收敛：删掉组件那份 .tab 定义（删错边：主导航规格从此没有来源，触控高度直接塌）',
    f => ({ tab: dropBlock(f.tab, TAB_HEAD) }), ['T2.5']],
  ['M7 组件那份的 min-height 从 44px 改成 30px（删重复块时把规格一起改坏，塌的是主导航触控高度）',
    f => ({ tab: editBlock(f.tab, TAB_HEAD, b => b.replace('min-height: 44px', 'min-height: 30px')) }), ['T2.5']],
  ['M8 组件那份把字面量改成 var()（E-12 的因果倒转又装回去：规格改由全局表决定，终值此刻还相同）',
    f => ({ tab: editBlock(f.tab, TAB_HEAD, b => b.replace('min-height: 44px', 'min-height: var(--touch-target)').replace('color: #5F6E66', 'color: var(--muted)')) }), ['T2.7']],
  ['M9 姓名兜底从 anywhere 退成 break-word（flex 项的 min-content 不含断点 ⇒ 写了等于没写）',
    f => ({ app: editBlock(f.app, NAME_HEAD, b => b.replace('overflow-wrap: anywhere', 'overflow-wrap: break-word')) }), ['T3.1']],
  ['M10 活动标题的断行声明整条擦掉（M-16 本体复发）',
    f => ({ app: editBlock(f.app, TITLE_HEAD, b => b.replace(' overflow-wrap: anywhere', '')) }), ['T3.1']],
  ['M11 featured 变体显式写回 overflow-wrap: normal（高特异度把兜底擦掉：只判基础规则查不出）',
    f => ({ app: insertAfter(f.app, FEATURED_ROW, '.activity-card--featured .activity-card__title { overflow-wrap: normal; }') }), ['T3.1']],
  ['M12 指标值改成 ellipsis 三件套（把 26px 大数字截成「125…」= 藏用户数据，不是兜底）',
    f => ({ app: editBlock(f.app, VALUE_HEAD, b => b.replace('overflow-wrap: anywhere', 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis')) }), ['T3.1', 'T3.4']],
  ['M13 删掉 .page.has-sticky（审计那笔旧账要是照做就红：route-edit 正在用，T4 的新门也依赖它）',
    f => ({ app: delLine(f.app, '.page.has-sticky { padding-bottom: 120px; }') }), ['T4.5']],
  ['M14 把 .tabbar-safe 的定义加回 app.wxss（B-14 清掉的死定义复活）',
    f => ({ app: insertBefore(f.app, '/* ---------- 其它 ---------- */', '.tabbar-safe { height: calc(84px + env(safe-area-inset-bottom)); }') }), ['T4.1', 'T2.8']],
  ['M15 把死 token「--focus」加回 page 定义区（实测引用 0 次，留着就是下一个维护者的误导）',
    f => ({ app: insertAfter(f.app, '  --control-line: #8C9791;     /* muted 72% + white 28% */', '  --focus: #346583;') }), ['T4.3']],
  ['M16 引入一个仓库里没有定义的 token 引用（B-14 根因：过去没有「var() 引用必须有定义」的门）',
    f => ({ app: editBlock(f.app, '.progress {', b => b.replace('background: var(--line)', 'background: var(--surface-alt)')) }), ['T4.4']],
  ['M17 注册表把 .metrics 行改回只写「三列」（实现是四列：文档与实现再度分叉）',
    f => ({ doc: repl(f.doc, METRICS_ROW, '| `.metrics/.metric` | 三列指标（hero 内自动反白） |') }), ['T3.7', 'T3.8']],
  ['M18 注册表把 --focus 的登记表行加回来（代码删了、表还留着 = 下一轮照表恢复）',
    f => ({ doc: repl(f.doc, LEAF_ROW, LEAF_ROW + eolOf(f.doc) + '| `--focus` | #346583 | 聚焦态描边（= `--info`） |') }), ['T4.9']],
  ['M19 顺手把分段间距从 4px 改成 8px（越界改动：相邻分段误触的间距取舍属 M-07，本轮没有裁量）',
    f => ({ app: editBlock(f.app, '.segmented {', b => b.replace('gap: 4px', 'gap: 8px')) }), ['T1.9']],
  ['M20 顺手把 .seg 行高从 18px 改成 20px（抬高可点区不该连带改掉全站纵向节奏）',
    f => ({ app: editBlock(f.app, SEG_HEAD, b => b.replace('line-height: 18px', 'line-height: 20px')) }), ['T1.8']]
]

/* ---------------- 等价类变异：判据必须绿（红了 = 门在钉源码文本，铁律 30） ---------------- */
const EQUIVALENTS = [
  ['E1 把 .segmented .seg 拆成两条同特异度、写在后面的规则（尺寸与配色分块写，层叠终值逐项不变）',
    f => {
      const r = blockRange(f.app, SEG_HEAD)
      const stripped = r.body.replace('min-height: var(--touch-target);', '').replace('color: var(--ink);', '')
      if (stripped === r.body) throw new Error('E1 没拆动任何声明')
      const extra = eolOf(f.app) + '.segmented .seg { min-height: var(--touch-target); }' +
        eolOf(f.app) + '.segmented .seg { color: var(--ink); }'
      return { app: f.app.slice(0, r.bodyStart) + stripped + f.app.slice(r.bodyEnd) + extra }
    }],
  ['E2 把 .page.has-sticky 挪到 .page 之前（特异度 (0,2,0) 仍赢 —— 顺序迷信不是判据）',
    f => ({ app: insertBefore(delLine(f.app, '.page.has-sticky { padding-bottom: 120px; }'), '.page {', '.page.has-sticky { padding-bottom: 120px; }') })],
  ['E3 组件那份的 .tab.on 再补一条同值的后代写法（来源仍是组件自己，终值逐项不变）',
    f => ({ tab: f.tab + eolOf(f.tab) + '.tabbar .tab.on {' + blockRange(f.tab, TAB_ON_HEAD).body + '}' })],
  ['E4 app.wxss 末尾加一条与四条判据无关的类（新增规则不应牵连任何终值）',
    f => ({ app: f.app + eolOf(f.app) + '.swx1-unrelated { margin: 0; }' })],
  ['E5 .metric .metric-value 与 .metric .metric-unit 两行调换书写次序（族内次序与终值无关）',
    f => {
      const valueLine = /^\.metric \.metric-value \{[^}]*\}/m.exec(f.app)
      const unitLine = /^\.metric \.metric-unit \{[^}]*\}/m.exec(f.app)
      if (!valueLine || !unitLine) throw new Error('E5 找不到两条 metric 规则')
      const out = f.app.replace(valueLine[0], '@@V@@').replace(unitLine[0], valueLine[0]).replace('@@V@@', unitLine[0])
      if (out === f.app) throw new Error('E5 调换次序后文本没变（两行相同？夹具无效）')
      return { app: out }
    }],
  ['E6 把两处断行策略从基础规则挪进同特异度的后置规则（判据读层叠结果，不读某一行）',
    f => {
      let app = f.app
      const moved = []
      ;[[TITLE_HEAD, '.activity-card__title'], [VALUE_HEAD, '.metric .metric-value']].forEach(pair => {
        app = editBlock(app, pair[0], b => {
          if (!/overflow-wrap: anywhere/.test(b)) throw new Error('块内没有断行声明：' + pair[1])
          moved.push(pair[1])
          return b.replace(/\s*overflow-wrap: anywhere/, '')
        })
      })
      if (moved.length !== 2) throw new Error('E6 只搬动了 ' + moved.length + ' 处（要求 2 处）')
      return { app: app + eolOf(app) + moved.map(sel => sel + ' { overflow-wrap: anywhere; }').join(eolOf(app)) }
    }]
]

/* ---------------- 沙盒 ---------------- */
function normalizePatch (out) {
  if (typeof out === 'string') throw new Error('补丁返回了裸字符串（必须返回 {app}/{tab}/{doc}）—— 否则字符串会被按下标当成多份文件写')
  if (!out || typeof out !== 'object') throw new Error('补丁必须返回对象，收到 ' + typeof out)
  if (!Object.keys(out).length) throw new Error('补丁返回空对象（等于什么都没改）')
  Object.keys(out).forEach(k => {
    if (!REL_BY_KEY[k]) throw new Error('未知目标文件键：' + k)
    if (typeof out[k] !== 'string') throw new Error('键 ' + k + ' 的新内容不是字符串')
  })
  return out
}
function sandbox (patch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swx1-mutate-'))
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true })
  fs.cpSync(path.join(ROOT, 'miniprogram'), path.join(dir, 'miniprogram'), { recursive: true })
  fs.mkdirSync(path.join(dir, '.agents', 'skills', 'ourtrail-ui', 'references'), { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'tools', SUITE), path.join(dir, 'tools', SUITE))
  fs.copyFileSync(path.join(ROOT, REL_DOC), path.join(dir, REL_DOC))
  if (patch) {
    const files = {
      app: fs.readFileSync(path.join(dir, REL_APP), 'utf8'),
      tab: fs.readFileSync(path.join(dir, REL_TAB), 'utf8'),
      doc: fs.readFileSync(path.join(dir, REL_DOC), 'utf8')
    }
    const out = normalizePatch(patch(files))
    Object.keys(out).forEach(k => fs.writeFileSync(path.join(dir, REL_BY_KEY[k]), out[k]))
  }
  return dir
}
// 改动面积记账：按行做多重集合差（插入使后续行整体位移，逐下标比会把 1 行改动算成几百行）。
// 「空跑」判据必须看**整份文本是否逐字节相同**，不能看行集合差异：等价重构 E2/E5 只是换次序，
// 行多重集合完全相同 ⇒ add/del 都是 0，但它确实改动了文件，用 add+del 判空跑会把合法夹具误判成没跑。
function deltaOf (dir, key) {
  const rel = REL_BY_KEY[key]
  const nowText = fs.readFileSync(path.join(dir, rel), 'utf8')
  const realText = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  const now = nowText.replace(/\r\n/g, '\n').split('\n')
  const real = realText.replace(/\r\n/g, '\n').split('\n')
  const bag = {}
  real.forEach(l => { bag[l] = (bag[l] || 0) + 1 })
  let add = 0
  now.forEach(l => { if (bag[l] > 0) bag[l]--; else add++ })
  let del = 0
  Object.keys(bag).forEach(l => { del += bag[l] })
  const reorder = nowText !== realText && add === 0 && del === 0
  return { add, del, differs: nowText !== realText, reorder }
}
function runSuite (dir) {
  const r = cp.spawnSync(process.execPath, [path.join(dir, 'tools', SUITE)], { cwd: dir, encoding: 'utf8' })
  const out = String(r.stdout || '') + String(r.stderr || '')
  const redLines = out.split(/\r?\n/).filter(l => l.trim().indexOf('✗') === 0)
  const redIds = Array.from(new Set(redLines.map(l => { const m = /\bT\d+\.\d+/.exec(l); return m ? m[0] : '' }).filter(Boolean)))
  const tail = (out.match(/passed=\d+ failed=\d+/g) || []).pop() || ''
  if (r.error) return { kind: 'crash', detail: 'spawn 失败：' + r.error.message, redIds, redLines }
  if (redLines.length && r.status !== 0) return { kind: 'red', detail: redLines[0].trim().slice(0, 130) + ' ｜ ' + tail, redIds, redLines }
  if (r.status !== 0) return { kind: 'crash', detail: 'exit ' + r.status + ' 且无 ✗ 行（解析器或注入炸了，不算抓到）：' + out.split(/\r?\n/).filter(Boolean).slice(-1)[0], redIds, redLines }
  if (redLines.length) return { kind: 'crash', detail: 'exit 0 却有 ✗ 行（判据在说谎）', redIds, redLines }
  return { kind: 'green', detail: tail, redIds, redLines }
}

/* ---------------- 前置：未变异副本必须全绿 ---------------- */
const baseDir = sandbox()
const pre = runSuite(baseDir)
fs.rmSync(baseDir, { recursive: true, force: true })
if (pre.kind !== 'green') {
  console.error('前置门未过：未变异的临时副本不是全绿（' + pre.kind + '），后面所有「抓到」都不作数\n  ' + pre.detail)
  process.exit(2)
}
console.log('有效性门：未变异副本全绿（' + pre.detail + '）\n')

let caught = 0, wrongTarget = 0, leaked = 0, crashed = 0, injectionFailed = 0
MUTANTS.forEach(m => {
  const title = m[0]
  const expect = m[2]
  let dir
  try { dir = sandbox(m[1]) } catch (e) {
    injectionFailed++
    console.log('✗ 注入失败 ' + title + '\n    ' + e.message)
    return
  }
  const deltas = {}
  Object.keys(REL_BY_KEY).forEach(k => { deltas[k] = deltaOf(dir, k) })
  const touched = Object.keys(REL_BY_KEY).filter(k => deltas[k].differs)
  if (!touched.length) {
    injectionFailed++
    fs.rmSync(dir, { recursive: true, force: true })
    console.log('✗ 注入失败（空跑）' + title + '\n    目标文件与真实仓库逐字节相同 ⇒ 这条变异等于没发生')
    return
  }
  const report = touched.map(k => k + ' +' + deltas[k].add + '/−' + deltas[k].del + (deltas[k].reorder ? '（仅次序）' : '')).join(' ｜ ')
  const r = runSuite(dir)
  fs.rmSync(dir, { recursive: true, force: true })
  if (r.kind === 'crash') { crashed++; console.log('! 崩红 ' + title + '\n    ' + r.detail + ' ｜ ' + report) } else if (r.kind === 'green') {
    leaked++; console.log('✗ 漏网 ' + title + '\n    判据仍全绿（' + r.detail + '）｜ ' + report)
  } else if (!r.redIds.some(id => expect.indexOf(id) !== -1)) {
    wrongTarget++; console.log('✗ 抓错 ' + title + '\n    期望红在 ' + expect.join('/') + '，实际红在 ' + r.redIds.join(',') + ' ｜ ' + report)
  } else {
    caught++; console.log('✓ 抓到 ' + title + '\n    红在 ' + r.redIds.join(',') + ' ｜ ' + report)
  }
})

let equivalenceBroken = 0, equivalenceKept = 0
EQUIVALENTS.forEach(e => {
  let dir
  try { dir = sandbox(e[1]) } catch (err) {
    injectionFailed++
    console.log('✗ 注入失败 ' + e[0] + '\n    ' + err.message)
    return
  }
  const deltas = {}
  Object.keys(REL_BY_KEY).forEach(k => { deltas[k] = deltaOf(dir, k) })
  const touched = Object.keys(REL_BY_KEY).filter(k => deltas[k].differs)
  if (!touched.length) {
    injectionFailed++
    fs.rmSync(dir, { recursive: true, force: true })
    console.log('✗ 注入失败（空跑）' + e[0] + '\n    等价重构没改动任何字节 ⇒ 这条控制是空的')
    return
  }
  const report = touched.map(k => k + ' +' + deltas[k].add + '/−' + deltas[k].del + (deltas[k].reorder ? '（仅次序）' : '')).join(' ｜ ')
  const r = runSuite(dir)
  fs.rmSync(dir, { recursive: true, force: true })
  if (r.kind === 'green') { equivalenceKept++; console.log('✓ 不误伤 ' + e[0] + '\n    ' + r.detail + ' ｜ ' + report) } else if (r.kind === 'crash') {
    crashed++; console.log('! 崩红（等价类）' + e[0] + '\n    ' + r.detail)
  } else { equivalenceBroken++; console.log('✗ 等价重构被误伤 ' + e[0] + '\n    ' + r.redLines.join(' ; ').slice(0, 240) + ' ｜ ' + report) }
})

const total = MUTANTS.length + EQUIVALENTS.length
// 等价类的「不误伤」也是一条已归账的变异（第一版把它漏在账外，闭合线于是报 20≠26）
const accounted = caught + wrongTarget + leaked + crashed + injectionFailed + equivalenceBroken + equivalenceKept
console.log('\n抓到=' + caught + ' 漏网=' + leaked + ' 崩红=' + crashed + ' 误伤=' + equivalenceBroken + ' 不误伤=' + equivalenceKept + ' 抓错=' + wrongTarget + ' 注入失败=' + injectionFailed)
console.log('闭合：变异总数 ' + total + ' = 已归账 ' + accounted + (total === accounted ? ' ✓' : ' ✗（有变异没被记账）'))
process.exit(caught === MUTANTS.length && equivalenceBroken === 0 && crashed === 0 &&
  leaked === 0 && wrongTarget === 0 && injectionFailed === 0 && total === accounted ? 0 : 1)

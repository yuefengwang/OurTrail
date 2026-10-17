// T5b/E-08 续批四条门 · 变异自证：node tools/e08-remaining-mutate.js
//
// 四条双向自证（口径沿用 tools/t4-e08-mutate.js，那个文件是别人的写入集，本批不改它，只抄形态）：
//  · 抓到 caught = check.js 退出码非 0 **且** ✗ 行里出现该条门的编号（[G3]/[G6]/[G7]/[G8]）；
//  · 崩红 crash = 抛错／找不到文件 ⇒ **不算抓到**，单独计数；
//  · 注入失败（锚点命中 ≠ 1、落点在注释行、或锚点里含换行而文件是 CRLF）计一条失败并 exit 1，
//    绝不静默换一行凑数——本轮已在两套已提交门里各实测到一次「跨行锚点在 CRLF 文件里命中 0 次＝
//    变异没发生而套件照绿」的空证（铁律 31⑥），所以这里把 EOL 检查写进注入函数本体；
//  · 等价变异体（真修法／合法写法）expectCaught:false ⇒ 必须保持绿，红了记「误伤」；
//  · 每条违例还额外跑一次「把本批这段门整段剥掉」的 check.js 副本 ⇒ 必须**绿**：
//    这一路证的是 finding E-08 的本体（旧闸门对这些平台坑一无所知），不是我的门在咬什么现成缺陷；
//  · 未变异的沙盒必须先过全绿有效性门，否则本轮所有读数作废（不拿它冒充「抓到」）。
// G11 的形态不同：**它没进门禁**（真实仓库命中 1 处活体 ⇒ 按派单纪律 BLOCKED，不加豁免）。
// 所以它的变异判据是「check.js 保持绿（门确实没落）而本批断言套件报红（台账跟着实测走）」，
// 记在 ledger 一栏；这条一旦反过来（check.js 因 G11 红）就是「把没收敛的门硬塞进闸」的形态，判漏网。
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SANDBOX = path.join(os.tmpdir(), 'e08-remaining-mutate-' + process.pid)
const BLIND = 'e08-remaining-blind-check.js'
const START = '// ==== T5b/E-08 新门开始'
const END = '// ==== T5b/E-08 新门结束'

const stats = {
  caught: 0, leaked: 0, crashed: 0, falseAlarm: 0, keptGreen: 0, crashedAsDesigned: 0,
  injectionFailed: 0, notBlindSpot: 0, ledgerOk: 0, ledgerBad: 0, injected: 0,
}

function copy(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const name of fs.readdirSync(from)) {
    if (name === 'node_modules' || name === '.git' || name === 'docs' || name === 'assets') continue
    const s = path.join(from, name), d = path.join(to, name)
    if (fs.statSync(s).isDirectory()) copy(s, d)
    else fs.copyFileSync(s, d)
  }
}

function prepare() {
  fs.rmSync(SANDBOX, { recursive: true, force: true })
  fs.mkdirSync(path.join(SANDBOX, 'tools'), { recursive: true })
  copy(path.join(ROOT, 'miniprogram'), path.join(SANDBOX, 'miniprogram'))
  for (const name of fs.readdirSync(path.join(ROOT, 'tools'))) {
    if (name.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'tools', name), path.join(SANDBOX, 'tools', name))
  }
}

const rd = rel => fs.readFileSync(path.join(SANDBOX, rel), 'utf8')
const wr = (rel, text) => fs.writeFileSync(path.join(SANDBOX, rel), text)

/** 行尾读数：本仓源码是 CRLF，跨行锚点按 LF 写就永远命中 0 次（＝变异没发生而套件照绿）。 */
function eolOf(text) { return text.indexOf('\r\n') >= 0 ? 'CRLF' : 'LF' }

/** 锚点替换：命中恰为 1、锚点不含换行、落点不在注释行。返回错误说明或 null。 */
function sub(rel, anchor, replacement) {
  let src
  try { src = rd(rel) } catch (e) { return '读不到 ' + rel }
  if (/\r?\n/.test(anchor)) return '锚点里含换行：CRLF 文件里跨行锚点会命中 0 次（变异没发生却照绿）。请逐行钉。'
  const hits = src.split(anchor).length - 1
  if (hits !== 1) return rel + ' 锚点命中 ' + hits + ' 次（要求恰为 1）｜文件 ' + eolOf(src)
  const at = src.indexOf(anchor)
  const line = src.slice(src.lastIndexOf('\n', at - 1) + 1, src.indexOf('\n', at) < 0 ? src.length : src.indexOf('\n', at)).trim()
  if (/^(\/\/|\*|\/\*|<!--)/.test(line)) return rel + ' 锚点落在注释行上（变异无效，需重钉到真实代码）：' + line.slice(0, 60)
  wr(rel, src.split(anchor).join(replacement))
  return null
}

function append(rel, text) {
  let src
  try { src = rd(rel) } catch (e) { return '读不到 ' + rel }
  const eol = eolOf(src) === 'CRLF' ? '\r\n' : '\n'
  wr(rel, src + (eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text))
  return null
}

/** 生成「旧闸门」对照组：只切哨兵之间的整段，判据一字不动。 */
function buildBlindCheck() {
  const src = rd('tools/check.js')
  const n1 = src.split(START).length - 1, n2 = src.split(END).length - 1
  if (n1 !== 1 || n2 !== 1) return '哨兵命中次数异常（开始 ' + n1 + '／结束 ' + n2 + '）⇒ 无法构造对照组'
  const a = src.indexOf(START), b = src.indexOf(END)
  if (b < a) return '哨兵顺序异常'
  const lineStart = src.lastIndexOf('\n', a - 1) + 1
  const lineEnd = src.indexOf('\n', b)
  wr('tools/' + BLIND, src.slice(0, lineStart) + src.slice(lineEnd + 1))
  return null
}

function run(script) {
  const r = spawnSync(process.execPath, [path.join(SANDBOX, 'tools', script)], { encoding: 'utf8', cwd: SANDBOX })
  const out = String(r.stdout || '') + String(r.stderr || '')
  // 只数行首的 ✗：check.js 的成功行本来就写着「如有 ✗ 见上」。
  const reds = (out.match(/^\s*✗/gm) || []).length
  const crashed = /TypeError:|ReferenceError:|SyntaxError:|Cannot find module/.test(out) || (out.trim().length === 0 && r.status !== 0)
  return { code: r.status, out, reds, crashed, red: !crashed && (r.status !== 0 || reds > 0) }
}

const HOME = 'miniprogram/pages/home/home.wxss'
const CHIP = '.chip { padding: 13px 14px; }'
const TAB_FORMULA = 'calc(32px + 84px + env(safe-area-inset-bottom))'

const CASES = [
  {
    id: 'V1 G3 本体：裸事件名 `tap="onTap"`（第 8 步的属性名正则要求连字符 ⇒ 此前无人管）⇒ 必红',
    rule: 'G3',
    files: ['miniprogram/pages/privacy/privacy.wxml'],
    // 锚点原钉 `<view class="card">`：合并上游二阶段后 privacy.wxml 重排成 section-head/stack-sections，
    // 该锚点命中 0 次 ⇒ 本条变异从未执行而闭合一度仍显示「闭合」（因为它只比注入成功数）。
    apply: () => sub('miniprogram/pages/privacy/privacy.wxml', '<view class="section-head">', '<view class="section-head" tap="onTap">'),
  },
  {
    id: 'V2 自定义组件事件名：<status-panel … tap="onTap">（该组件没声明过 tap 属性，且它本来就在本页注册着）⇒ 必红',
    rule: 'G3',
    files: ['miniprogram/pages/anotices/anotices.wxml'],
    apply: () => sub('miniprogram/pages/anotices/anotices.wxml', 'actionLabel="重试" bind:action="reload"',
      'actionLabel="重试" bind:action="reload" tap="onTap"'),
  },
  {
    id: 'V3【等价变异体】<form-field error="none"> —— error 是该组件**声明过的属性** ⇒ 必须保持绿（判据不是「名字撞上车表就红」）',
    rule: 'G3', expectCaught: false,
    files: ['miniprogram/pages/anotices/anotices.wxml'],
    apply: () => append('miniprogram/pages/anotices/anotices.wxml', '\n<form-field label="探针" error="none" hint="none" />\n'),
  },
  {
    id: 'V4 G6 方向 A：tab 页把自己的页尾留白从 116px 改小到 40px ⇒ 必红（遮挡物需要 61px+安全区）',
    rule: 'G6',
    files: [HOME],
    apply: () => sub(HOME, TAB_FORMULA, '40px'),
  },
  {
    id: 'V5 G6 方向 A′：整条留白声明删掉（只剩注释）⇒ 必红（丢了留白这一支要能抓到）',
    rule: 'G6',
    files: [HOME],
    apply: () => sub(HOME, '.page { padding-bottom: ' + TAB_FORMULA + '; }', '/* 变异：这一行被删 */'),
  },
  {
    id: 'V6 G6 方向 B：子页（不在 tabBar.list）无条件吃了 tab 专用那一截 ⇒ 必红（E-03/M-18 本体，两个方向都要能红）',
    rule: 'G6',
    files: ['miniprogram/pages/anotices/anotices.wxss'],
    apply: () => append('miniprogram/pages/anotices/anotices.wxss', '\n.page { padding-bottom: ' + TAB_FORMULA + '; }\n'),
  },
  {
    id: 'V7 阈值单源：把遮挡物自己的 .tab min-height 从 44px 提到 200px ⇒ tab 页的 116px 当场变红（门没把 84/61 写死）',
    rule: 'G6',
    files: ['miniprogram/custom-tab-bar/index.wxss'],
    apply: () => sub('miniprogram/custom-tab-bar/index.wxss', 'min-height: 44px;', 'min-height: 200px;'),
  },
  {
    id: 'V8【等价变异体】子页有 .sticky-action 要避让而留 140px ⇒ 必须保持绿（那份留白归 T4/R1 管，不是 tabBar 的额度）',
    rule: 'G6', expectCaught: false,
    files: ['miniprogram/pages/route-edit/route-edit.wxss'],
    apply: () => append('miniprogram/pages/route-edit/route-edit.wxss', '\n.page { padding-bottom: 140px; }\n'),
  },
  {
    id: 'V9 G7：真实代码里写 backdrop-filter ⇒ 必红',
    rule: 'G7',
    files: [HOME],
    apply: () => sub(HOME, '.activity-card--featured .activity-card__info {',
      '.activity-card--featured .activity-card__info { backdrop-filter: blur(2px);'),
  },
  {
    id: 'V10 G7：通配选择器 ⇒ 必红（黑名单里唯一走「选择器位」口径的一条）',
    rule: 'G7',
    files: [HOME],
    apply: () => sub(HOME, '.page { padding-bottom:', '* { box-sizing: border-box; }\n.page { padding-bottom:'),
  },
  {
    id: 'V11【等价变异体＝G7 的前提】同样的词只写进 /* */ 注释（app.wxss:2 的真实形态）⇒ 必须保持绿（不剥注释就是假红）',
    rule: 'G7', expectCaught: false,
    files: [HOME],
    apply: () => append(HOME, '\n/* 变异探针：不要用 color-mix()、:root、100dvh、backdrop-filter、:has() 与通配选择器 * */\n'),
  },
  {
    id: 'V12 G8：position:sticky 不带任何偏移（E-06 本体）⇒ 必红',
    rule: 'G8',
    files: ['miniprogram/pages/editor/editor.wxss'],
    apply: () => sub('miniprogram/pages/editor/editor.wxss', CHIP, '.chip { padding: 13px 14px; position: sticky; }'),
  },
  {
    id: 'V13 G8：偏移值是 auto ⇒ 必红（写了等于没写，形态不同但后果相同）',
    rule: 'G8',
    files: ['miniprogram/pages/editor/editor.wxss'],
    apply: () => sub('miniprogram/pages/editor/editor.wxss', CHIP, '.chip { padding: 13px 14px; position: sticky; top: auto; }'),
  },
  {
    id: 'V14【等价变异体＝真修法】sticky + top: 0 ⇒ 必须保持绿（门不是一刀切禁 sticky）',
    rule: 'G8', expectCaught: false,
    files: ['miniprogram/pages/editor/editor.wxss'],
    apply: () => sub('miniprogram/pages/editor/editor.wxss', CHIP, '.chip { padding: 13px 14px; position: sticky; top: 0; }'),
  },
  {
    id: 'V15 G8 的反向对照：偏移挂在**另一个选择器**上 ⇒ 必红（判据不是「全文件出现过 top」）',
    rule: 'G8',
    files: ['miniprogram/pages/editor/editor.wxss'],
    apply: () => sub('miniprogram/pages/editor/editor.wxss', CHIP,
      '.chip { padding: 13px 14px; position: sticky; }\n.other-probe { top: 0; }'),
  },
  {
    id: 'V16 G11（未进门的 BLOCKED 条）：新增一处关键布局属性双写 ⇒ check.js 必须仍绿（门没落），' +
      '而本批断言套件必须红（BLOCKED 台账跟着实测走，不许悄悄躺着）',
    rule: 'G11', expect: 'ledger',
    files: ['miniprogram/pages/editor/editor.wxss'],
    apply: () => append('miniprogram/pages/editor/editor.wxss', '\n.chip { padding: 4px; }\n'),
  },
  {
    id: 'V17【等价变异体】同选择器但关键属性不相交（padding 与 display）⇒ 台账不漂移、两边都保持绿',
    rule: 'G11', expectCaught: false,
    files: ['miniprogram/pages/editor/editor.wxss'],
    apply: () => append('miniprogram/pages/editor/editor.wxss', '\n.chip { display: flex; }\n'),
  },
  {
    id: 'V18 判据被摘空（GATED 导出空数组）⇒ 预提交闸必须红，不得因为「循环一次都没跑」而全绿',
    rule: null, expect: 'red',
    files: ['tools/e08-remaining-rules.js'],
    apply: () => {
      wr('tools/e08-remaining-rules.js', 'module.exports = { RULES: [], GATED: [], BLOCKED: [], SELF_CASES: [], ' +
        'selfProof: () => [], makeCtx: () => ({}), G11: { run: () => ({ hits: [], stat: \'\' }) } }\n')
      return null
    },
  },
  {
    id: 'V19 判据模块整个消失 ⇒ check.js 必须崩在 require 上（非 0 退出），而不是静默跳过这段门',
    rule: null, expect: 'crash',
    files: ['tools/e08-remaining-rules.js'],
    apply: () => {
      try { fs.rmSync(path.join(SANDBOX, 'tools', 'e08-remaining-rules.js')) } catch (e) { return '删不掉判据模块：' + e.message }
      return null
    },
  },
]

function main() {
  prepare()
  console.log('沙盒：' + SANDBOX)
  const probe = rd('tools/check.js')
  console.log('沙盒 check.js 行尾：' + eolOf(probe) + '（本仓源码是 CRLF ⇒ 锚点一律逐行钉，见脚本头）')
  const blindErr = buildBlindCheck()
  if (blindErr) { console.log('✗ 对照组构造失败：' + blindErr); cleanup(); process.exit(1) }

  console.log('\n== 0. 有效性门：未变异的沙盒里，带门的 check.js、剥掉门的对照组、断言套件都必须绿 ==')
  let bad = 0
  const base = [
    ['check.js', '四条门对真实代码为绿（A 组）'],
    [BLIND, '剥掉本批这段门的旧闸门也能跑通（对照组本身可用）'],
    ['e08-remaining-test.js', '断言套件基线绿'],
    ['t4-e08-test.js', '前棒 T4 的四条门未被本批碰坏'],
  ]
  for (const [s, why] of base) {
    const r = run(s)
    if (r.crashed || r.code !== 0) {
      bad++
      console.log('  ✗ 基线不干净：' + s + '（' + why + '）exit=' + r.code + (r.crashed ? ' CRASH' : ''))
      r.out.split(/\r?\n/).filter(l => /✗|Error/.test(l)).slice(0, 3).forEach(l => console.log('      ' + l.trim()))
    } else console.log('  ✓ ' + s + ' → ' + why)
  }
  if (bad) { console.log('\n有效性门失败 ⇒ 本轮变异读数全部作废（不拿它冒充「抓到」）。'); cleanup(); process.exit(1) }

  console.log('\n== 1. 逐条变异（每条同时跑「带门」与「剥门」两版，后者证盲区）==')
  for (const c of CASES) {
    const snap = {}
    for (const f of c.files) { try { snap[f] = rd(f) } catch (e) { /* V19 的目标文件已不在，恢复时跳过 */ } }
    const err = c.apply()
    if (err) { stats.injectionFailed++; console.log('✗ 注入失败：' + c.id + ' → ' + err); continue }
    stats.injected++
    const full = run('check.js')
    const crashish = c.expect === 'crash' || c.expect === 'red'
    const suite = crashish ? { code: 0, red: false, out: '（摘门类变异跳过套件，它测的是判据本体）' } : run('e08-remaining-test.js')
    const blind = crashish ? null : run(BLIND)
    const tagged = c.rule ? new RegExp('\\[' + c.rule + '\\]').test(full.out) : null
    let verdict
    if (c.expect === 'crash') {
      if (full.code !== 0 && full.reds === 0) { stats.crashedAsDesigned++; verdict = '按预期崩红（缺判据模块不许冒充通过）' }
      else if (full.code !== 0) { stats.caught++; verdict = '抓到（报红比崩红更清楚）' }
      else { stats.leaked++; verdict = '漏网（判据模块没了却全绿）' }
    } else if (c.expect === 'red') {
      if (full.code !== 0 && /静默空转|应为 4 条|SELF_CASES|本步会静默空转|本步未工作/.test(full.out)) { stats.caught++; verdict = '抓到（判据被摘空当场报红）' }
      else if (full.code !== 0) { stats.crashed++; verdict = '崩红（非 0 但不是那条判据）' }
      else { stats.leaked++; verdict = '漏网' }
    } else if (c.expect === 'ledger') {
      // G11 没进门禁：正确形态是「check.js 不因此红」+「套件红且红因就是那条台账」
      const suiteNamedG11 = /G11/.test(suite.out)
      if (!full.red && suite.red && suiteNamedG11) {
        stats.ledgerOk++; verdict = '台账正确（check.js 保持绿＝门确实没落；套件报红且点名 G11＝BLOCKED 读数没有悄悄躺着）'
      } else if (full.red && tagged) { stats.leaked++; verdict = '漏网形态异常：没进门的 G11 却让 check.js 红了（＝把没收敛的门硬塞进闸）' }
      else if (!suite.red || !suiteNamedG11) { stats.leaked++; verdict = '漏网（新增双写而台账没动/没点名）' }
      else { stats.crashed++; verdict = 'CRASH≠CAUGHT' }
    } else if (c.expectCaught !== false) {
      if (full.crashed) { stats.crashed++; verdict = 'CRASH≠CAUGHT' }
      else if (full.red && tagged && suite.red) { stats.caught++; verdict = '抓到（check.js 点名 [' + c.rule + ']，断言套件同步报红）' }
      else if (full.red && tagged) { stats.caught++; verdict = '抓到（[' + c.rule + ']，但套件没同步报红 ⇒ 断言待补）' }
      else { stats.leaked++; verdict = '漏网' }
      if (blind && blind.red) { stats.notBlindSpot++; verdict += ' ｜ 注：旧闸门也报红（这类的「盲区」说法不成立）' }
    } else {
      if (full.red || suite.red) { stats.falseAlarm++; verdict = '误伤（合法写法／真修法被判红）' }
      else { stats.keptGreen++; verdict = '按预期保持绿（门不是无条件判死）' }
    }
    const good = /^(按预期|抓到|台账正确)/.test(verdict)
    console.log((good ? '✓ ' : '✗ ') + c.id)
    console.log('    带门 check.js → exit=' + full.code + ' ✗行=' + full.reds + (tagged === null ? '' : ' 含[' + c.rule + ']=' + tagged) +
      ' ｜ 套件 → exit=' + suite.code + ' ｜ 剥门对照组 → ' + (blind ? 'exit=' + blind.code + ' ✗行=' + blind.reds : 'n/a') + ' ⇒ ' + verdict)
    if (!good) full.out.split(/\r?\n/).filter(l => /✗/.test(l)).slice(0, 4).forEach(l => console.log('      ' + l.trim()))
    for (const f of c.files) { if (snap[f] !== undefined) wr(f, snap[f]) }
  }

  cleanup()
  // 闭合式原先只比「注入成功数」，于是一条注入失败的用例可以既没算进账、又不破坏「闭合」二字
  // ——正是本轮反复抓到的「仪器把失败分支丢掉仍自称完整」。现在失败也进账。
  const planned = stats.injected + stats.injectionFailed
  const total = stats.caught + stats.leaked + stats.crashed + stats.falseAlarm + stats.keptGreen +
    stats.crashedAsDesigned + stats.ledgerOk + stats.ledgerBad + stats.injectionFailed
  console.log('\n==== 变异自证 ====')
  console.log('注入成功 ' + stats.injected + ' 条（注入失败 ' + stats.injectionFailed + ' 条）')
  console.log('抓到=' + stats.caught + ' 漏网=' + stats.leaked + ' 崩红=' + stats.crashed + ' 误伤=' + stats.falseAlarm)
  console.log('（另有：按预期保持绿=' + stats.keptGreen + '，按预期崩红=' + stats.crashedAsDesigned +
    '，台账正确=' + stats.ledgerOk + '，台账异常=' + stats.ledgerBad + '，旧门本也能抓=' + stats.notBlindSpot + '）')
  console.log('闭合检查：' + total + ' vs 计划 ' + planned + '（注入成功 ' + stats.injected + ' + 注入失败 ' + stats.injectionFailed + '）⇒ ' + (total === planned ? '闭合' : '不闭合（有分支没记账）'))
  const leaky = stats.leaked || stats.crashed || stats.injectionFailed || stats.falseAlarm ||
    stats.ledgerBad || total !== planned
  process.exit(leaky ? 1 : 0)
}

function cleanup() {
  fs.rmSync(SANDBOX, { recursive: true, force: true })
}

main()

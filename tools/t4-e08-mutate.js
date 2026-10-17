// E-08 四条平台门 · 变异自证：node tools/t4-e08-mutate.js
//
// 四条门的「双向自证」在这里闭合（A 绿 / B 红 / C 盲区 / D 本脚本），口径沿用仓库已有的
// tools/g2-gates-mutate.js（那个文件是别人的写入集，本批不改它，只把它的护栏**形态**抄进新文件）：
//  · 抓到 caught = check.js 退出码非 0 **且** ✗ 行里出现该条门的编号（[R1]…[R4]）；
//  · 崩红 crash = 抛错／找不到文件 ⇒ **不算抓到**，单独计数；
//  · 注入失败（锚点命中 ≠ 1，或落点在注释行上）计一条失败并 exit 1，绝不静默换一行凑数；
//  · 等价变异体（真修法／合法重构）expectCaught:false ⇒ 必须保持绿，红了记「误伤」；
//  · 每条违例还额外跑一次「把本批四条门整段剥掉」的 check.js 副本 ⇒ 必须**绿**。
//    这一路证的是 finding E-08 的本体（旧闸门对这些平台坑一无所知），不是我的门在咬什么现成缺陷。
// 四个数（抓到／漏网／崩红／误伤）加上按预期保持绿与按预期崩红，必须与注入总数闭合。
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SANDBOX = path.join(os.tmpdir(), 't4-e08-mutate-' + process.pid)
const BLIND = 't4-e08-blind-check.js'
const START = '// ==== T4/E-08 新门开始'
const END = '// ==== T4/E-08 新门结束'

const stats = { caught: 0, leaked: 0, crashed: 0, falseAlarm: 0, keptGreen: 0, crashedAsDesigned: 0, injectionFailed: 0, notBlindSpot: 0, injected: 0 }

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

/** 锚点替换：命中必须恰为 1，且落点不能在注释行（否则变异等于没发生，套件照绿是空证）。 */
function sub(rel, anchor, replacement) {
  let src
  try { src = rd(rel) } catch (e) { return '读不到 ' + rel }
  const hits = src.split(anchor).length - 1
  if (hits !== 1) return rel + ' 锚点命中 ' + hits + ' 次（要求恰为 1）'
  const at = src.indexOf(anchor)
  const line = src.slice(src.lastIndexOf('\n', at) + 1, src.lastIndexOf('\n', at) + 81).trimStart()
  if (line.indexOf('//') === 0 || line.indexOf('*') === 0 || line.indexOf('/*') === 0 || line.indexOf('<!--') === 0) {
    return rel + ' 锚点落在注释行上（变异无效，需重钉到真实代码）：' + line.slice(0, 60)
  }
  wr(rel, src.split(anchor).join(replacement))
  return null
}

function append(rel, text) {
  let src
  try { src = rd(rel) } catch (e) { return '读不到 ' + rel }
  wr(rel, src + text)
  return null
}

/** 生成「旧闸门」对照组：把本批四条门整段切掉（只切哨兵之间，判据一字不动）。 */
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
  // 只数**行首**的 ✗：check.js 的成功行里本来就写着「如有 ✗ 见上」，
  // 拿全局计数会把一条都不红的运行读成「红了三条」——本脚本第一版就是这么把三条等价变异体误判成误伤的。
  const reds = (out.match(/^\s*✗/gm) || []).length
  const crashed = /TypeError:|ReferenceError:|SyntaxError:|Cannot find module/.test(out) || (out.trim().length === 0 && r.status !== 0)
  return { code: r.status, out, reds, crashed, red: !crashed && (r.status !== 0 || reds > 0) }
}

const STICKY_ANCHOR = `class="page {{!denied && !loading ? 'has-sticky' : ''}}"`

const CASES = [
  {
    id: 'V1 E-02 本体：固定底栏照旧，根节点的 has-sticky 被摘掉 ⇒ R1 必红',
    rule: 'R1',
    files: ['miniprogram/pages/route-edit/route-edit.wxml'],
    apply: () => sub('miniprogram/pages/route-edit/route-edit.wxml', STICKY_ANCHOR, 'class="page"'),
  },
  {
    id: 'V2 R1 查的是终值不是「写没写」：摘掉 has-sticky 后补一条 40px（< 120px）⇒ 仍必红',
    rule: 'R1',
    files: ['miniprogram/pages/route-edit/route-edit.wxml', 'miniprogram/pages/route-edit/route-edit.wxss'],
    apply: () => {
      const e = sub('miniprogram/pages/route-edit/route-edit.wxml', STICKY_ANCHOR, 'class="page"')
      if (e) return e
      return append('miniprogram/pages/route-edit/route-edit.wxss', '\n.page { padding-bottom: 40px; }\n')
    },
  },
  {
    id: 'V3 铁律 1 的原形态（事故 daa0508）：第二个 options 键把 styleIsolation 挤掉 ⇒ R2 必红',
    rule: 'R2',
    files: ['miniprogram/components/status-panel/status-panel.js'],
    apply: () => sub('miniprogram/components/status-panel/status-panel.js',
      "options: { styleIsolation: 'apply-shared' },",
      "options: { styleIsolation: 'apply-shared' },\n  options: { addGlobalClass: true },"),
  },
  {
    id: 'V4 P4 真机 bug 的形态：给没有 multipleSlots 的组件加具名 slot ⇒ R3 必红',
    rule: 'R3',
    files: ['miniprogram/components/person-row/person-row.wxml'],
    apply: () => append('miniprogram/components/person-row/person-row.wxml', '\n<slot name="t4probe"></slot>\n'),
  },
  {
    id: 'V5 铁律 14 的形态：组件模板引用只有 app.wxss 定义的类、且没 opt-in ⇒ R4 必红',
    rule: 'R4',
    files: ['miniprogram/components/privacy-popup/privacy-popup.wxml'],
    apply: () => append('miniprogram/components/privacy-popup/privacy-popup.wxml',
      '\n<view class="card">引用全局类，本组件既无 options 也未定义 .card</view>\n'),
  },
  {
    id: 'V6【等价变异体＝派单裁量的另一半】不挂 has-sticky，但页面给根容器留够 140px ⇒ 必须保持绿',
    rule: 'R1',
    expectCaught: false,
    files: ['miniprogram/pages/route-edit/route-edit.wxml', 'miniprogram/pages/route-edit/route-edit.wxss'],
    apply: () => {
      const e = sub('miniprogram/pages/route-edit/route-edit.wxml', STICKY_ANCHOR, 'class="page"')
      if (e) return e
      return append('miniprogram/pages/route-edit/route-edit.wxss', '\n.page { padding-bottom: 140px; }\n')
    },
  },
  {
    id: 'V7【合法重构】has-sticky 的绑定表达式换一种写法（条件改名）⇒ 必须保持绿（铁律 30：门不钉源码文本）',
    rule: 'R1',
    expectCaught: false,
    files: ['miniprogram/pages/route-edit/route-edit.wxml'],
    apply: () => sub('miniprogram/pages/route-edit/route-edit.wxml', STICKY_ANCHOR,
      `class="page {{canEdit ? 'has-sticky' : ''}}"`),
  },
  {
    id: 'V8【真修法】具名 slot + 同时补 multipleSlots:true ⇒ 必须保持绿（门不是一刀切禁具名 slot）',
    rule: 'R3',
    expectCaught: false,
    files: ['miniprogram/components/person-row/person-row.wxml', 'miniprogram/components/person-row/person-row.js'],
    apply: () => {
      const e = append('miniprogram/components/person-row/person-row.wxml', '\n<slot name="t4probe"></slot>\n')
      if (e) return e
      return sub('miniprogram/components/person-row/person-row.js',
        "options: { styleIsolation: 'apply-shared' },",
        "options: { styleIsolation: 'apply-shared', multipleSlots: true },")
    },
  },
  {
    id: 'V9 判据被摘空（RULES 导出空数组）⇒ 预提交闸必须红，不得因为「循环一次都没跑」而全绿',
    rule: null,
    expect: 'red',
    files: ['tools/t4-e08-platform-rules.js'],
    apply: () => {
      wr('tools/t4-e08-platform-rules.js', 'module.exports = { RULES: [], SELF_CASES: [], selfProof: () => [], makeCtx: () => ({}), R1: {}, R2: {}, R3: {}, R4: {} }\n')
      return null
    },
  },
  {
    id: 'V10 判据模块整个消失 ⇒ check.js 必须崩在 require 上（非 0 退出），而不是静默跳过这段门',
    rule: null,
    expect: 'crash',
    files: ['tools/t4-e08-platform-rules.js'],
    apply: () => {
      try { fs.rmSync(path.join(SANDBOX, 'tools', 't4-e08-platform-rules.js')) } catch (e) { return '删不掉判据模块：' + e.message }
      return null
    },
  },
]

function main() {
  prepare()
  console.log('沙盒：' + SANDBOX)
  const blindErr = buildBlindCheck()
  if (blindErr) { console.log('✗ 对照组构造失败：' + blindErr); cleanup(); process.exit(1) }

  console.log('\n== 0. 有效性门：未变异的沙盒里，带门的 check.js、剥掉门的对照组、断言套件都必须绿 ==')
  let bad = 0
  const base = [['check.js', '四条门对真实代码为绿（A 组）'], [BLIND, '剥掉新门的旧闸门也能跑通（对照组本身可用）'], ['t4-e08-test.js', '断言套件基线绿']]
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
    for (const f of c.files) { try { snap[f] = rd(f) } catch (e) { /* V10 的目标文件已不在，恢复时跳过 */ } }
    const err = c.apply()
    if (err) {
      stats.injectionFailed++
      console.log('✗ 注入失败：' + c.id + ' → ' + err)
      continue
    }
    stats.injected++
    const full = run('check.js')
    const suite = (c.expect === 'crash' || c.expect === 'red') ? { code: 0, red: false, out: '（摘门类变异跳过套件，它测的是判据本体）' } : run('t4-e08-test.js')
    const blind = (c.expect === 'crash' || c.expect === 'red') ? null : run(BLIND)
    const tagged = c.rule ? new RegExp('\\[' + c.rule + '\\]').test(full.out) : null
    let verdict
    if (c.expect === 'crash') {
      if (full.code !== 0 && full.reds === 0) { stats.crashedAsDesigned++; verdict = '按预期崩红（缺判据模块不许冒充通过）' }
      else if (full.code !== 0) { stats.caught++; verdict = '抓到（报红比崩红更清楚）' }
      else { stats.leaked++; verdict = '漏网（判据模块没了却全绿）' }
    } else if (c.expect === 'red') {
      if (full.code !== 0 && /静默空转/.test(full.out)) { stats.caught++; verdict = '抓到（判据被摘空当场报红）' }
      else if (full.code !== 0) { stats.crashed++; verdict = '崩红（非 0 但不是那条判据）' }
      else { stats.leaked++; verdict = '漏网' }
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
    const good = verdict.indexOf('按预期') === 0 || verdict.indexOf('抓到') === 0
    console.log((good ? '✓ ' : '✗ ') + c.id)
    console.log('    带门 check.js → exit=' + full.code + ' ✗行=' + full.reds + (tagged === null ? '' : ' 含[' + c.rule + ']=' + tagged) +
      ' ｜ 套件 → exit=' + suite.code + ' ｜ 剥门对照组 → ' + (blind ? 'exit=' + blind.code + ' ✗行=' + blind.reds : 'n/a') + ' ⇒ ' + verdict)
    if (!good) full.out.split(/\r?\n/).filter(l => /✗/.test(l)).slice(0, 4).forEach(l => console.log('      ' + l.trim()))
    for (const f of c.files) { if (snap[f] !== undefined) wr(f, snap[f]) }
  }

  cleanup()
  const total = stats.caught + stats.leaked + stats.crashed + stats.falseAlarm + stats.keptGreen + stats.crashedAsDesigned
  console.log('\n==== 变异自证 ====')
  console.log('注入成功 ' + stats.injected + ' 条（注入失败 ' + stats.injectionFailed + ' 条）')
  console.log('抓到=' + stats.caught + ' 漏网=' + stats.leaked + ' 崩红=' + stats.crashed + ' 误伤=' + stats.falseAlarm +
    '（另有：按预期保持绿=' + stats.keptGreen + '，按预期崩红=' + stats.crashedAsDesigned + '，旧门本也能抓=' + stats.notBlindSpot + '）')
  console.log('闭合检查：' + stats.caught + '+' + stats.leaked + '+' + stats.crashed + '+' + stats.falseAlarm + '+' +
    stats.keptGreen + '+' + stats.crashedAsDesigned + ' = ' + total + ' ｜ 注入 ' + stats.injected + ' ⇒ ' + (total === stats.injected ? '闭合' : '不闭合（有分支没记账）'))
  const leaky = stats.leaked || stats.crashed || stats.injectionFailed || stats.falseAlarm || total !== stats.injected
  process.exit(leaky ? 1 : 0)
}

function cleanup() {
  fs.rmSync(SANDBOX, { recursive: true, force: true })
}

main()

'use strict'
// SWX2 判据有没有牙齿：把 miniprogram 的 .wxss/.wxml 复制到 %TEMP% 沙盒，逐条把修复改回缺陷形，
// 要求 tools/swx2-style-gates-test.js 在那份副本上必须报「断言红」；仍然全绿 ⇒ 那条判据是假的。
//
// 四条纪律（都是本仓实测踩过的坑，不是礼节）：
// 1. 沙盒只建在 %TEMP%（os.tmpdir()），绝不写真实仓库；跑完删掉。
// 2. 锚点命中必须恰为 1 次，且必须落在真实代码行上。本仓实测过两种「变异等于没发生而套件照绿」的假绿：
//    · CRLF 文件里用 \n 拼多行锚点 ⇒ 命中 0 次（静默没注入）；
//    · 偏移落在中文注释上 ⇒ 改的是注释，代码一个字没动。
//    所以这里按「选择器 + 声明块」定位（选择器在注释里出现不会命中，注释也原样保留），
//    命中数不对就记「注入失败」；每条变异还要求注入后文本确实变了，否则同样记注入失败。
// 3. 先跑「未变异副本全绿」的有效性门；不成立就整批作废（exit 2），那时读数说明不了任何事。
// 4. E 组是反向控制：等价重构（拆简写、换成同值字面量、挪位置、删与全局同值的声明）终值不变 ⇒
//    判据必须照样全绿。它们红了就说明门钉的是源码文本而不是行为（铁律 30），记「误伤」并 exit 1。
// 5. 崩红不算「抓到」：单列并判失败（样式判据在读源文件，注入把文件弄成解析器读不懂的形态时，
//    子进程异常退出而没有 ✗ 行，那种退出码不能记成抓到）。
//
// 运行：node tools/swx2-style-gates-mutate.js
// 退出码：0 = 每条回退都被抓到且每条等价控制都全绿；1 = 漏网 / 崩红 / 误伤 / 注入失败；2 = 前置有效性门未过
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SUITE = path.join(ROOT, 'tools', 'swx2-style-gates-test.js')
const SRC = path.join(ROOT, 'miniprogram')

/* ---------------- 沙盒：只复制判据会读的文件（.wxss + .wxml） ---------------- */
function copyHarness(to) {
  const walk = dir => {
    fs.readdirSync(dir).forEach(name => {
      const p = path.join(dir, name)
      const rel = path.relative(SRC, p).split(path.sep).join('/')
      if (fs.statSync(p).isDirectory()) { fs.mkdirSync(path.join(to, rel), { recursive: true }); walk(p); return }
      if (!/\.wxss$|\.wxml$/.test(name)) return
      const out = path.join(to, rel)
      fs.mkdirSync(path.dirname(out), { recursive: true })
      fs.copyFileSync(p, out)
    })
  }
  fs.mkdirSync(to, { recursive: true })
  walk(SRC)
}

/* ---------------- 变异原语：按「选择器的声明块」定位，命中必须恰 1 次 ---------------- */
function eolOf(text) { return text.indexOf('\r\n') !== -1 ? '\r\n' : '\n' }
function blankComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')) }
function findBlock(raw, sel) {
  // 在「注释已抹平但长度不变」的文本上定位，避免命中注释里提到的同名选择器
  const text = blankComments(raw)
  const needle = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{'
  const re = new RegExp(needle)
  const hits = []
  let i = 0
  let m
  while ((m = re.exec(text.slice(i)))) {
    hits.push(i + m.index)
    i = m.index + 1
  }
  if (hits.length !== 1) return { hits: hits.length }
  const start = text.indexOf('{', hits[0])
  let depth = 0, end = -1
  for (let j = start; j < text.length; j++) {
    if (text[j] === '{') depth++
    else if (text[j] === '}') { depth--; if (depth === 0) { end = j; break } }
  }
  if (end < 0) return { hits: 1, err: '声明块没有闭合' }
  return { hits: 1, from: hits[0], to: end + 1 }
}
function blockText(text, sel) {
  const b = findBlock(text, sel)
  if (b.hits !== 1) throw new Error('锚点（选择器声明块）命中 ' + b.hits + ' 次，要求恰 1 次：' + sel)
  if (b.err) throw new Error(sel + ' ' + b.err)
  return b
}
// 用新的声明体整块替换（保留选择器与块前的注释 ⇒ 改的一定是代码行，不是注释）
function setBlock(sel, body) {
  return text => {
    const b = blockText(text, sel)
    const eol = eolOf(text)
    return text.slice(0, b.from) + sel + ' {' + eol + body.map(d => '  ' + d + ';').join(eol) + eol + '}' + text.slice(b.to)
  }
}
function replOnce(from, to) {
  return text => {
    const hits = text.split(from).length - 1
    if (hits !== 1) throw new Error('锚点命中 ' + hits + ' 次，要求恰 1 次：' + from.slice(0, 60))
    return text.split(from).join(to)
  }
}
function insertAfterBlock(sel, added) {
  return text => {
    const b = blockText(text, sel)
    const eol = eolOf(text)
    return text.slice(0, b.to) + eol + added + text.slice(b.to)
  }
}

/* ---------------- 变异表 ---------------- */
const WX = 'pages/weather/weather.wxss'
const HM = 'pages/home/home.wxss'
const AC = 'pages/activity/activity.wxss'
const PR = 'pages/privacy/privacy.wxss'
const ED = 'pages/editor/editor.wxss'
const ME = 'pages/me/me.wxss'

const REGRESS = [
  ['M5 B-10 复发：「此刻处于云中」的读数色抄回字面量 #8C5A12', WX,
    setBlock('.cf-readout .ro-l3.in', ['color: #8C5A12'])],
  ['M6 B-10 复发：首页活动卡信息行抄回 #5F6E66', HM,
    setBlock('.activity-card .activity-card__info', ['font-size: 12px', 'color: #5F6E66'])],
  ['M7 B-10 复发：详情页 hero 指标单位抄回 #D0D8D7', AC,
    setBlock('.hero .metric-unit', ['color: #D0D8D7'])],
  ['M8 B-13 复发：时间轴评级星改回 --golden（白卡 2.29:1）', WX,
    setBlock('.ag-stars', ['color: var(--golden)', 'font-size: 12px', 'letter-spacing: 1px', 'white-space: nowrap'])],
  ['M9 B-13 复发：条件卡评级星改回 --golden', WX,
    setBlock('.cond-stars', ['color: var(--golden)', 'font-size: 13px', 'letter-spacing: 1px'])],
  ['M10 B-16 复发：.cond-label 字重回到 700（与 .ag-title 的 600 打架）', WX,
    setBlock('.cond-label', ['font-size: 15px', 'font-weight: 700', 'color: var(--ink)'])],
  ['M11 B-16 复发：privacy 项目符号字重回到 700', PR,
    setBlock('.li .dot', ['color: var(--forest)', 'font-weight: 700'])],
  ['M12 E-06 复发：.num-head 写回 position: sticky 却不带任何偏移（永不生效的死声明）', WX,
    setBlock('.num-head', ['background: var(--forest-soft)', 'position: sticky'])],
  ['M13 E-06 的另一种翻车：补了 sticky + top 却把底色删掉（表头列名的 --muted 弱化就糊在白底上）', WX,
    setBlock('.num-head', ['position: sticky', 'top: 0'])],
  ['M14 M-07 复发：24/48/72h 切窗按钮退回硬写的 26px', WX,
    replOnce('line-height: var(--touch-target); height: var(--touch-target);', 'line-height: 26px; height: 26px;')],
  ['M15 M-07 复发：证据面板的「看图 ↗」去掉纵向 padding，退回 22px 命中区', WX,
    setBlock('.reason-link', ['color: var(--info)', 'font-size: 11px', 'cursor: pointer', 'white-space: nowrap', 'flex: 0 0 auto', 'font-weight: 600'])],
  ['M16 M-07 复发：OI 列表的「看图」去掉纵向 padding', WX,
    setBlock('.oi-link', ['font-size: 10px', 'color: var(--forest)', 'opacity: 0.85', 'flex-shrink: 0'])],
  ['M17 M-07 复发：证据展开开关的纵向 padding 从 11px 退回 2px', WX,
    setBlock('.cond-why', ['font-size: var(--text-caption)', 'font-weight: 600', 'color: var(--forest)', 'padding: 2px 0'])],
  ['M18 M-07 复发：编辑器 chip 的纵向 padding 退回 6px（实算 30px）', ED,
    setBlock('.chip', ['padding: 6px 14px'])],
  ['M19 B-14 复发：把那条被覆盖的死句 .oi-ev{margin-top:4px} 再加回去（同选择器写两遍）', WX,
    insertAfterBlock('.oi-tier.fair', '.oi-ev { margin-top: 4px; padding-left: 104px; }')],
  ['M20 B-14 复发：me.wxss 的 .nick-wrap 再抄一行（逐字节相同的两遍）', ME,
    insertAfterBlock('.nick-wrap', '.nick-wrap { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }')],
  ['M21 B-14 合并时拿错基准：把真正生效过的 3px 改成死句里的 4px（合并是纯减法，不是重新取值）', WX,
    replOnce('.oi-ev { margin-top: 3px;', '.oi-ev { margin-top: 4px;')],
]

const EQUIVALENT = [
  ['E1 padding 简写拆成两个长写（终值不变）', WX,
    setBlock('.cond-why', ['font-size: var(--text-caption)', 'font-weight: 600', 'color: var(--forest)', 'padding-top: 11px', 'padding-bottom: 11px'])],
  ['E2 padding 四值写法（终值不变）', WX,
    setBlock('.oi-link', ['font-size: 10px', 'color: var(--forest)', 'opacity: 0.85', 'flex-shrink: 0', 'padding: 11px 0px 11px 0px'])],
  ['E3 尺寸取字面量 44px 而不是 var(--touch-target)：终值相同 ⇒ 门必须绿（钉的是终值，不是写法）', WX,
    replOnce('line-height: var(--touch-target); height: var(--touch-target);', 'line-height: 44px; height: 44px;')],
  ['E4 删掉 .section-title 覆盖里与 app.wxss 同值的 font-weight:600（覆盖仍由字号承重）', WX,
    setBlock('.section-title', ['font-size: var(--text-body)', 'color: var(--ink)'])],
  ['E5 把 .nick-wrap 移到文件末尾（仍是唯一一条，位置不改变终值）', ME,
    text => {
      const b = blockText(text, '.nick-wrap')
      const block = text.slice(b.from, b.to)
      const rest = (text.slice(0, b.from) + text.slice(b.to)).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n')
      return rest.replace(/\s*$/, '') + eolOf(text) + eolOf(text) + block
    }],
]

/* ---------------- 跑一轮 ---------------- */
function runSuite(dir) {
  const r = cp.spawnSync(process.execPath, [SUITE], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { SWX2_MP_ROOT: dir }),
    maxBuffer: 32 * 1024 * 1024,
  })
  return { out: (r.stdout || '') + (r.stderr || ''), code: r.status }
}
function verdict(res) {
  if (/✗/.test(res.out)) return '抓到'
  if (!/passed=\d+ failed=\d+/.test(res.out)) return '崩红'
  return res.code === 0 ? '全绿' : '崩红'
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'swx2-mutate-'))
let seq = 0
function sandboxFor(rel, fn) {
  const dir = path.join(base, 'case-' + (seq++))
  copyHarness(dir)
  const p = path.join(dir, rel)
  if (!fs.existsSync(p)) return { err: '目标文件在沙盒里不存在：' + rel }
  const text = fs.readFileSync(p, 'utf8')
  let next
  try { next = fn(text) } catch (e) { return { err: e.message } }
  if (next === text) return { err: '注入后文本逐字未变 = 这条变异等于没发生' }
  fs.writeFileSync(p, next)
  return { dir }
}

console.log('== 有效性门：未变异的沙盒副本必须全绿 ==')
copyHarness(path.join(base, 'pristine'))
const pre = runSuite(path.join(base, 'pristine'))
if (pre.code !== 0 || /✗/.test(pre.out)) {
  console.log(String(pre.out || '').split('\n').slice(-25).join('\n'))
  console.log('前置门未过：真实仓库上的判据本身不绿，本轮所有读数说明不了任何事')
  fs.rmSync(base, { recursive: true, force: true })
  process.exit(2)
}
console.log('  ✓ 未变异副本全绿（passed=' + (/passed=(\d+)/.exec(pre.out) || [, '?'])[1] + '）')

let caught = 0, missed = 0, crashed = 0, injectFail = 0
console.log('== 回退类变异（判据必须报红）==')
REGRESS.forEach(([name, rel, fn]) => {
  const s = sandboxFor(rel, fn)
  if (s.err) { injectFail++; console.log('  ! ' + name + ' ⇒ 注入失败：' + s.err); return }
  const res = verdict(runSuite(s.dir))
  if (res === '抓到') caught++
  else if (res === '崩红') crashed++
  else missed++
  console.log('  ' + (res === '抓到' ? '✓' : '✗') + ' ' + name + ' ⇒ ' + res)
  fs.rmSync(s.dir, { recursive: true, force: true })
})

let eqGreen = 0, harmed = 0, eqCrash = 0, eqInjectFail = 0
console.log('== 等价重构控制（终值不变 ⇒ 判据必须照样全绿；红了就是门在钉源码文本）==')
EQUIVALENT.forEach(([name, rel, fn]) => {
  const s = sandboxFor(rel, fn)
  if (s.err) { eqInjectFail++; injectFail++; console.log('  ! ' + name + ' ⇒ 注入失败：' + s.err); return }
  const res = verdict(runSuite(s.dir))
  if (res === '全绿') { eqGreen++; console.log('  ✓ ' + name + ' ⇒ 全绿（符合预期）') }
  else if (res === '抓到') { harmed++; console.log('  ✗ ' + name + ' ⇒ 误伤（合法等价重构被判红）') }
  else { eqCrash++; crashed++; console.log('  ✗ ' + name + ' ⇒ 崩红') }
  fs.rmSync(s.dir, { recursive: true, force: true })
})

fs.rmSync(base, { recursive: true, force: true })

const regressInject = injectFail - eqInjectFail
const regressClosed = caught + missed + crashed + regressInject
const eqClosed = eqGreen + harmed + eqCrash + eqInjectFail
console.log('')
console.log('抓到=' + caught + ' 漏网=' + missed + ' 崩红=' + crashed + ' 误伤=' + harmed + ' 注入失败=' + injectFail)
console.log('闭合：回退类 ' + REGRESS.length + ' 条 = 抓到 ' + caught + ' + 漏网 ' + missed + ' + 崩红 ' + crashed +
  ' + 注入失败（回退侧）' + regressInject + ' → ' + regressClosed)
console.log('闭合：等价控制 ' + EQUIVALENT.length + ' 条 = 全绿 ' + eqGreen + ' + 误伤 ' + harmed + ' + 崩红 ' + eqCrash +
  ' + 注入失败（控制侧）' + eqInjectFail + ' → ' + eqClosed)
if (regressClosed !== REGRESS.length || eqClosed !== EQUIVALENT.length) {
  console.log('判定：读数不闭合（有变异没被记账），本次运行作废')
  process.exit(1)
}
const bad = missed + crashed + harmed + injectFail
if (bad) { console.log('判定：不通过（判据有漏网 / 误伤 / 崩红 / 注入失败）'); process.exit(1) }
console.log('判定：通过 —— 每条回退都被抓到，每条等价重构都没被误伤')

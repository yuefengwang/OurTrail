// M-11 修复的判别力自证：node tools/t2-m11-mutate.js
//
// 目的不是「跑一遍看绿不绿」，而是证明 tools/t2-m11-test.js 真的会咬：
// 把这条门要防的每种缺陷形态注进一份沙盒副本（仓库文件一字不动），跑同一条门，要求它必须报红。
//
// 口径沿用 Wave 1′ 与 tools/g2-gates-mutate.js 已经定下的三条，不另立一套：
//  · 抓到 = 退出码非 0 **或** 输出里有 `✗` 断言行 **或** 账上 failed>0；
//  · 崩红（抛错撞停／没有账）≠ 抓到，单独计数并 exit 1；
//  · 注入失败（锚点命中次数不等于要求值）计一条失败并 exit 1，绝不静默改错行充数。
// 另加两条：
//  · **等价变异体必须保持绿**（铁律 30／铁律 32④）——改判据表顺序、给内部 helper 改名这类
//    不改行为的合法重构，若被判红说明门将源码形态误当成了行为，早晚会变成没人理的噪音；
//  · **greenSuites**：明确记录「同波次那道 g2 门在这个变异下保持绿」——这不是漏网，而是两条门
//    判据不重叠的证据（g2 拿实测预算比对新文案，实测值被调小时它测不出回归；下限判据归本门）。
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SANDBOX = path.join(os.tmpdir(), 't2-m11-mutate-' + process.pid)
const stats = { caught: 0, leaked: 0, crashed: 0, injectionFailed: 0, falseAlarm: 0, keptGreen: 0, greenBroken: 0 }

function copy(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const name of fs.readdirSync(from)) {
    if (name === 'node_modules' || name === '.git' || name === 'assets' || name === '.idea') continue
    const s = path.join(from, name), d = path.join(to, name)
    if (fs.statSync(s).isDirectory()) copy(s, d)
    else fs.copyFileSync(s, d)
  }
}
function prepare() {
  fs.rmSync(SANDBOX, { recursive: true, force: true })
  // cloudfunctions/ 也要复制：failure-semantics-test / journey-test 会 require 契约里的 ERROR_CODES，
  // 少了这棵树它们在沙盒里直接崩，而崩红会被下面的有效性门当成「基线不干净」——那是环境缺件，不是判据。
  for (const tree of ['miniprogram', 'tools', 'cloudfunctions']) copy(path.join(ROOT, tree), path.join(SANDBOX, tree))
}
const rd = rel => fs.readFileSync(path.join(SANDBOX, rel), 'utf8')
const wr = (rel, text) => fs.writeFileSync(path.join(SANDBOX, rel), text)

/** 锚点替换：命中次数必须恰为 expect（默认 1）。命中 0 次＝锚点已随重构搬家，注入失败而不是「没影响」。 */
function sub(rel, anchor, replacement, expect) {
  const want = expect === undefined ? 1 : expect
  let src
  try { src = rd(rel) } catch (e) { return '读不到 ' + rel }
  const hits = src.split(anchor).length - 1
  if (hits !== want) return rel + ' 锚点命中 ' + hits + ' 次（要求恰为 ' + want + '）'
  wr(rel, src.split(anchor).join(replacement))
  return null
}

function runSuite(suite) {
  const r = spawnSync(process.execPath, [path.join(SANDBOX, 'tools', suite)], { encoding: 'utf8', cwd: SANDBOX })
  const out = String(r.stdout || '') + String(r.stderr || '')
  const tally = out.match(/passed=(\d+)\s+failed=(\d+)/)
  const reds = (out.match(/✗/g) || []).length
  const crashed = /SUITE CRASHED|ReferenceError:|TypeError:|SyntaxError:/.test(out) || out.trim().length === 0
  const red = !crashed && (r.status !== 0 || reds > 0 || (tally ? Number(tally[2]) > 0 : false))
  return {
    code: r.status, tally: tally ? tally[0] : null, reds, crashed, red, out,
    tail: out.split(/\r?\n/).filter(l => /✗|异常中止/.test(l)).slice(0, 3),
  }
}

const SUITE = 't2-m11-test.js'
const API = 'miniprogram/utils/api.js'

const CASES = [
  {
    id: 'M1 缺陷本体回来：出口重新硬截 20 码点（M-11 / C-21 原形态）',
    apply: () => sub(API, 'wx.showToast({ title: shown.title,',
      "wx.showToast({ title: (title || '').slice(0, 20) || '完成',"),
    suites: [SUITE],
  },
  {
    id: 'M2 预算数字被调回 20（其余代码不动）——同波次 g2 那道门在此变异下保持绿，下限判据正是本门补的那一块',
    apply: () => sub(API, 'const TOAST_TEXT_BUDGET = 30', 'const TOAST_TEXT_BUDGET = 20'),
    suites: [SUITE],
    greenSuites: ['g2-toast-copy-test.js'],
  },
  {
    id: 'M3 单源被破：导出 20、函数仍按 30 收口（写了不生效的第二个数）',
    // 锚点不跨行：api.js 是 CRLF 文件，带 \n 的锚点命中 0 次（铁律 31⑥ 的同一个坑，本轮又踩一次）。
    apply: () => sub(API, '  TOAST_TEXT_BUDGET,', '  TOAST_TEXT_BUDGET: 20,'),
    suites: [SUITE],
  },
  {
    id: 'M4 截断改回静默：不再在控制台点名原文',
    apply: () => sub(API, '  if (shown.truncated) {', '  if (false && shown.truncated) {'),
    suites: [SUITE],
  },
  {
    id: 'M5 收口不补省略号（半句话看着就像文案本来就这么长）',
    apply: () => sub(API, "cps.slice(0, keepAt || keepMax).join('') + '…'",
      "cps.slice(0, keepAt || keepMax).join('')"),
    suites: [SUITE],
  },
  {
    id: 'M6 收口不看句读，一律按预算硬切（「…暂无法地」那种断句复活）',
    apply: () => sub(API, "if (TOAST_BREAK_AFTER.indexOf(cps[i]) === -1) continue", 'if (true) continue'),
    suites: [SUITE],
  },
  {
    id: 'M7 按 UTF-16 码元而不是码点计数切分（emoji 被劈成孤立代理对＝屏幕上一块豆腐）',
    apply: () => sub(API, "Array.from(input === null || input === undefined ? '' : String(input))",
      "String(input === null || input === undefined ? '' : input).split('')"),
    suites: [SUITE],
  },
  {
    id: 'M8 超长时降级成 wx.showModal（未经产品裁决的交互模式变更，本门的越界判据必须咬）',
    apply: () => sub(API, '  wx.showToast({ title: shown.title,',
      '  if (shown.truncated) { wx.showModal({ title: "提示", content: String(title) }); return }\n  wx.showToast({ title: shown.title,'),
    suites: [SUITE],
  },
  {
    id: 'M9【等价变异体】句读表重新排序：同一套判据、行为不变 ⇒ 本门必须保持绿',
    expectCaught: false,
    apply: () => sub(API,
      "const TOAST_BREAK_AFTER = ['。', '！', '？', '；', '，', '、', ' ', '）', '」', '】', '』']",
      "const TOAST_BREAK_AFTER = ['、', '』', '】', '」', ' ', '）', '，', '；', '？', '！', '。']"),
    suites: [SUITE],
  },
  {
    id: 'M10【等价变异体】内部 helper 改名（合法重构）⇒ 门钉的是行为不是源码文本，必须保持绿',
    expectCaught: false,
    apply: () => sub(API, 'fitToastText', 'fitToastTitle', 2),
    suites: [SUITE],
  },
]

const BASELINE = [SUITE, 'g2-toast-copy-test.js', 'scenario-api-test.js', 'failure-semantics-test.js',
  'journey-test.js']

function main() {
  prepare()
  console.log('沙盒：' + SANDBOX)

  console.log('\n== 0. 有效性门：未变异的沙盒必须全绿（否则后面每条读数都没有意义）==')
  let baseBad = 0
  for (const s of BASELINE) {
    const r = runSuite(s)
    const ok = !r.crashed && r.code === 0 && !r.red
    if (!ok) {
      baseBad++
      console.log('  ✗ 基线不干净：' + s + ' → exit=' + r.code + ' ' + (r.tally || '没有账'))
      r.tail.forEach(l => console.log('      ' + l.trim()))
    } else console.log('  ✓ ' + s + ' → ' + r.tally)
  }
  if (baseBad) {
    console.log('\n有效性门失败：沙盒基线自身有 ' + baseBad + ' 条红/崩 ⇒ 本轮变异读数全部作废（不拿它冒充「抓到」）。')
    fs.rmSync(SANDBOX, { recursive: true, force: true })
    process.exit(1)
  }

  console.log('\n== 1. 逐条变异 ==')
  for (const c of CASES) {
    const expect = c.expectCaught !== false
    const targets = [API]
    const snap = {}
    targets.forEach(f => { snap[f] = rd(f) })
    const err = c.apply()
    if (err) {
      stats.injectionFailed++
      console.log('✗ 注入失败：' + c.id + ' → ' + err)
    } else {
      for (const s of c.suites) {
        const r = runSuite(s)
        let verdict
        if (r.crashed) { stats.crashed++; verdict = 'CRASH≠CAUGHT' }
        else if (expect) {
          if (r.red) { stats.caught++; verdict = '抓到' } else { stats.leaked++; verdict = '漏网' }
        } else {
          if (r.red) { stats.falseAlarm++; verdict = '误伤（等价变异体被判红）' } else { stats.keptGreen++; verdict = '按预期保持绿' }
        }
        const okLine = verdict === '抓到' || verdict === '按预期保持绿'
        console.log((okLine ? '✓ ' : '✗ ') + c.id + ' ｜ ' + s + ' → exit=' + r.code + ' ' +
          (r.tally || '没有账') + ' 红行=' + r.reds + ' ⇒ ' + verdict)
        if (!okLine) r.tail.forEach(l => console.log('      ' + l.trim()))
      }
      for (const s of c.greenSuites || []) {
        const r = runSuite(s)
        if (r.red || r.crashed) {
          stats.greenBroken++
          console.log('  ✗ 不该红的门红了：' + s + ' → exit=' + r.code + ' ' + (r.tally || '没有账'))
          r.tail.forEach(l => console.log('      ' + l.trim()))
        } else console.log('  · 对照：' + s + ' 在此变异下保持绿（判据不重叠）→ ' + r.tally)
      }
    }
    targets.forEach(f => wr(f, snap[f]))
  }

  fs.rmSync(SANDBOX, { recursive: true, force: true })
  console.log('\n==== 变异自证：抓到 ' + stats.caught + ' ｜ 漏网 ' + stats.leaked + ' ｜ 崩红 ' + stats.crashed +
    ' ｜ 注入失败 ' + stats.injectionFailed + ' ｜ 误伤 ' + stats.falseAlarm +
    ' ｜ 等价变异保持绿 ' + stats.keptGreen + ' ｜ 对照门被误动 ' + stats.greenBroken + ' ====')
  process.exit(stats.leaked || stats.crashed || stats.injectionFailed || stats.falseAlarm || stats.greenBroken ? 1 : 0)
}

main()

'use strict'
// B4-E05 变异自证（E-05 的门有没有牙齿，由这个脚本判定，不靠人眼）
//
// 做法：把 miniprogram/pages/route/route.wxml **复制到 %TEMP% 沙盒**，在副本上注入单条变异，
// 再用真门 tools/b4-e05-checklabel-test.js（经 B4E05_WXML 接缝指向副本）打它。
// 仓库里的文件一个字节都不动；route.js / app.wxss 只读原文（变异只针对我有写入集的 wxml）。
//
// 三类判定，互不合并：
//   抓到 = 退出码非 0，**且**红的那条断言正是本条变异该打红的那条（红了但不对位 = 漏网，
//          因为承重的是「哪条判据在响」，不是「有没有响」——铁律 30/31）
//   崩红 = 子进程没打印 passed= 读数（抛异常），单独计数，绝不计入「抓到」
//   误伤 = 等价/无关的对照变异被门判红（门过度贴合某一种写法 ⇒ 合法重构会假红，铁律 30①）
//
// 注入前置：锚点在源文件里必须命中**恰好 1 次**，且落点不在 <!-- --> 注释内。
// 命中 0 次 / 多次 / 只剩注释 ⇒ 判**注入失败**，计一条漏网并让脚本 exit 1，不静默改错行充数。
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'miniprogram', 'pages', 'route', 'route.wxml')
const GATE = path.join(ROOT, 'tools', 'b4-e05-checklabel-test.js')
const original = fs.readFileSync(SRC, 'utf8')
const EOL = original.indexOf('\r\n') !== -1 ? '\r\n' : '\n'
function L(lines) { return lines.join(EOL) }

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'b4-e05-mutate-'))

// ---------- 锚点命中与注释落点 ----------
function commentRanges(src) {
  const out = []
  const re = /<!--[\s\S]*?-->/g
  let m
  while ((m = re.exec(src))) out.push([m.index, m.index + m[0].length])
  return out
}
/* 2026-10-17 合并后修：上游一次无关的缩进重排（route.wxml 整体 +2 空格）就把 3 条锚点打成「命中 0 次」，
 * 而全量复跑只跑 *-test.js、不跑 *-mutate.js ⇒ 这类仪器损坏不会被门禁发现（我已把「合并后必须复跑全部
 * *-mutate.js」记进流程）。根因：锚点把行首缩进当成了判据。现在匹配忽略每行行首空白；
 * 替换文本仍按脚本原样落盘——这些判据看的是结构与归属，格式变化本就不该影响它们。 */
function anchorRe(anchor) {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const lines = anchor.split(/\r?\n/).map(l => l.replace(/^[ \t]+/, ''))
  return new RegExp(lines.map(esc).map(l => '[ \\t]*' + l).join('\\r?\\n'), 'g')
}
function matchAnchor(src, anchor) {
  const re = anchorRe(anchor)
  const hits = []
  let m
  while ((m = re.exec(src))) {
    hits.push({ at: m.index, len: m[0].length })
    if (m.index === re.lastIndex) re.lastIndex++
  }
  return hits
}
function hitsOf(src, anchor) {
  return matchAnchor(src, anchor).length
}
function inComment(ranges, at) {
  for (const r of ranges) { if (at >= r[0] && at < r[1]) return true }
  return false
}
function inject(m) {
  const anchor = L(m.anchor)
  const src = original
  const found = matchAnchor(src, anchor)
  if (found.length !== 1) return { error: '锚点命中 ' + found.length + ' 次（要求恰好 1 次）' }
  const at = found[0].at
  const matchedLen = found[0].len
  // 变异（要求变红的那一类）落点必须在真实代码行；只剩注释 ⇒ 注入失败，不拿注释行充数。
  // 对照 K1 的**存在理由**就是「只改注释」，它的锚点必须在注释里 —— 由 inCommentOk 显式声明。
  if (inComment(commentRanges(src), at) && !m.inCommentOk) return { error: '锚点落在注释里（注入失败，不拿注释行充数）' }
  const file = path.join(SANDBOX, m.id + '.wxml')
  fs.writeFileSync(file, src.slice(0, at) + L(m.to) + src.slice(at + matchedLen), 'utf8')
  return { file: file }
}

// ---------- 跑门 ----------
function runGate(file) {
  const r = spawnSync(process.execPath, [GATE], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: Object.assign({}, process.env, { B4E05_WXML: file }),
  })
  const out = String(r.stdout || '') + String(r.stderr || '')
  const m = /passed=(\d+) failed=(\d+)/.exec(out)
  if (!m) return { kind: 'crash', out: out }
  const failed = parseInt(m[2], 10)
  const reds = out.split(/\r?\n/).filter(function (l) { return l.indexOf('  ✗ ') === 0 })
  return { kind: failed > 0 ? 'red' : 'green', passed: parseInt(m[1], 10), failed: failed, reds: reds, out: out }
}

// ---------- 变异清单（7 条要求变红） ----------
const MUTATIONS = [
  {
    id: 'M1', title: '退回缺陷本体：勾选框旁挂裸文本兄弟节点（去掉 label/text 结构）',
    expectRed: /裸文本/,
    anchor: [
      '          <label class="check-label">',
      '            <checkbox value="schedule" checked="{{scheduleMode}}" />',
      '            <text class="check-text">按出发时刻推算</text>',
      '          </label>',
    ],
    to: ['            <checkbox value="schedule" checked="{{scheduleMode}}" />按出发时刻推算'],
  },
  {
    id: 'M2', title: '把 bindchange 从 checkbox-group 挪到 label（改变 change 的发出位置）',
    expectRed: /bindchange 就在该 checkbox-group/,
    anchor: [
      '        <checkbox-group bindchange="onScheduleMode">',
      '          <label class="check-label">',
    ],
    to: ['        <checkbox-group>', '          <label class="check-label" bindchange="onScheduleMode">'],
  },
  {
    id: 'M3', title: '加回内联 style（roster-panel 那种 style="padding:0" 的同族形态）',
    expectRed: /style/,
    anchor: ['          <label class="check-label">'],
    to: ['          <label class="check-label" style="padding:0;">'],
  },
  {
    id: 'M4', title: '容器 label 换成 view（类名还在，但不再是可点容器）',
    expectRed: /可点容器是 <label>/,
    anchor: [
      '          <label class="check-label">',
      '            <checkbox value="schedule" checked="{{scheduleMode}}" />',
      '            <text class="check-text">按出发时刻推算</text>',
      '          </label>',
    ],
    to: [
      '          <view class="check-label">',
      '            <checkbox value="schedule" checked="{{scheduleMode}}" />',
      '            <text class="check-text">按出发时刻推算</text>',
      '          </view>',
    ],
  },
  {
    id: 'M5', title: '文案节点摘掉 check-text 类（flex:1 没了 ⇒ 触点撑不满整行）',
    expectRed: /check-text/,
    anchor: ['            <text class="check-text">按出发时刻推算</text>'],
    to: ['            <text>按出发时刻推算</text>'],
  },
  {
    id: 'M6', title: '新增第二处挂裸文本的 group（页面级泛化门必须响，不是一次性门）',
    expectRed: /都不许挂裸文本/,
    anchor: ['        </checkbox-group>'],
    to: ['        </checkbox-group>',
      '        <checkbox-group bindchange="onStartDate"><checkbox value="extra" />另一处裸文本开关</checkbox-group>'],
  },
  {
    id: 'M7', title: 'handler 改名成页面里不存在的 onScheduleModeX（悬空归属必须被抓）',
    expectRed: /都能在 route\.js 解析到/,
    anchor: ['        <checkbox-group bindchange="onScheduleMode">'],
    to: ['        <checkbox-group bindchange="onScheduleModeX">'],
  },
]

// ---------- 对照清单（4 条必须保持绿：门不许过度贴合写法） ----------
const CONTROLS = [
  {
    id: 'K1', title: '只改注释文字（判据不该听注释；锚点按设计落在注释行内）', inCommentOk: true,
    anchor: ['change 事件仍由 checkbox-group 承载，归属不许挪 —— 挪到 label 上取值语义会变（platform-pitfalls 的「checkbox-group / picker 的取值」条：group 的 detail.value 是全部选中值数组；此处刻意不写 §编号，该文档 2026-10-14 从 14 条扩到 17 条时编号整体后移，写编号的引用第二天就指错东西） -->'],
    to: ['             这行注释是被对照变异改过的，任何判据都不该因为它而变红 -->'],
  },
  {
    id: 'K2', title: '同一结构压成一行（roster-panel.wxml:49 的成行写法，语义等价）',
    anchor: [
      '          <label class="check-label">',
      '            <checkbox value="schedule" checked="{{scheduleMode}}" />',
      '            <text class="check-text">按出发时刻推算</text>',
      '          </label>',
    ],
    to: ['          <label class="check-label"><checkbox value="schedule" checked="{{scheduleMode}}" /><text class="check-text">按出发时刻推算</text></label>'],
  },
  {
    id: 'K3', title: '嵌套形态等价改写：label 包 group（roster-panel.wxml:31-34 形态，app.wxss:358 明确认可）',
    anchor: [
      '        <checkbox-group bindchange="onScheduleMode">',
      '          <label class="check-label">',
      '            <checkbox value="schedule" checked="{{scheduleMode}}" />',
      '            <text class="check-text">按出发时刻推算</text>',
      '          </label>',
      '        </checkbox-group>',
    ],
    to: [
      '        <label class="check-label">',
      '          <checkbox-group bindchange="onScheduleMode"><checkbox value="schedule" checked="{{scheduleMode}}" /></checkbox-group>',
      '          <text class="check-text">按出发时刻推算</text>',
      '        </label>',
    ],
  },
  {
    id: 'K4', title: '同卡片里加一句无关文案（非目标区域一动就红 = 门没有边界感）',
    anchor: ['      <text class="section-title">分段天气</text>'],
    to: ['      <text class="section-title">分段天气</text>', '      <text class="small muted">B4-E05 对照：这句与勾选行无关</text>'],
  },
]

function describe(r) {
  if (r.kind === 'crash') return '崩红（子进程未打印 passed= 读数）'
  return r.kind + ' passed=' + r.passed + ' failed=' + r.failed +
    (r.reds.length ? ' ｜ ' + r.reds.slice(0, 3).map(function (x) { return x.trim() }).join(' ／ ') : '')
}

function main() {
  console.log('沙盒：' + SANDBOX)
  console.log('源文件：' + SRC.replace(ROOT + path.sep, '') + '（EOL=' + (EOL === '\r\n' ? 'CRLF' : 'LF') + '）')

  // ===== 有效性门：未变异的沙盒副本必须全绿，否则后面每一条红都归因不到变异 =====
  const plain = path.join(SANDBOX, 'K0-plain.wxml')
  fs.writeFileSync(plain, original, 'utf8')
  const base = runGate(plain)
  if (base.kind !== 'green') {
    console.log('有效性门未过：未变异副本就不是全绿 ⇒ ' + describe(base))
    console.log('本轮不拿它当证据（铁律：先跑未变异全绿的有效性门）。')
    process.exit(1)
  }
  console.log('有效性门：未变异副本全绿 passed=' + base.passed + ' failed=0 ✓')
  console.log('')

  let caught = 0
  let missed = 0
  let crashed = 0
  let falsePositive = 0
  const notes = []

  console.log('== 变异（要求变红，且红在该当的那条判据上）==')
  for (const m of MUTATIONS) {
    const inj = inject(m)
    if (inj.error) {
      missed++
      notes.push(m.id + ' 注入失败：' + inj.error)
      console.log('  ' + m.id + ' 漏网（注入失败）— ' + m.title + '｜' + inj.error)
      continue
    }
    const r = runGate(inj.file)
    if (r.kind === 'crash') {
      crashed++
      notes.push(m.id + ' 崩红：' + r.out.split(/\r?\n/).slice(-6).join(' / '))
      console.log('  ' + m.id + ' 崩红 — ' + m.title)
      continue
    }
    const redLines = r.reds.join('\n')
    if (r.kind === 'red' && m.expectRed.test(redLines)) {
      caught++
      console.log('  ' + m.id + ' 抓到 — ' + m.title + '｜' + describe(r))
    } else if (r.kind === 'red') {
      missed++
      notes.push(m.id + ' 红了但不对位：期望 /' + m.expectRed.source + '/ 实际 ' + redLines.slice(0, 200))
      console.log('  ' + m.id + ' 漏网（红了但不是该响的那条）— ' + m.title + '｜' + describe(r))
    } else {
      missed++
      notes.push(m.id + ' 全绿：这条缺陷形态没有判据抓得到')
      console.log('  ' + m.id + ' 漏网（全绿）— ' + m.title)
    }
  }

  console.log('')
  console.log('== 对照（等价/无关改写，必须保持全绿；变红即误伤）==')
  let controlsOk = 0
  for (const k of CONTROLS) {
    const inj = inject(k)
    if (inj.error) {
      falsePositive++
      notes.push(k.id + ' 对照注入失败：' + inj.error)
      console.log('  ' + k.id + ' 误伤（对照注入失败）— ' + k.title + '｜' + inj.error)
      continue
    }
    const r = runGate(inj.file)
    if (r.kind === 'crash') {
      falsePositive++
      notes.push(k.id + ' 对照崩红')
      console.log('  ' + k.id + ' 误伤（崩红）— ' + k.title)
      continue
    }
    if (r.kind === 'green') {
      controlsOk++
      console.log('  ' + k.id + ' 通过（仍全绿）— ' + k.title)
    } else {
      falsePositive++
      notes.push(k.id + ' 误伤：' + r.reds.slice(0, 2).join(' ／ '))
      console.log('  ' + k.id + ' 误伤 — ' + k.title + '｜' + describe(r))
    }
  }

  console.log('')
  if (notes.length) {
    console.log('== 明细 ==')
    notes.forEach(function (n) { console.log('  · ' + n) })
  }
  console.log('')
  console.log('闭合：变异 ' + MUTATIONS.length + ' 条 = 抓到 ' + caught + ' + 漏网(变异) ' +
    (missed) + ' + 崩红 ' + crashed + ' ｜ 对照 ' + CONTROLS.length + ' 条 = 通过 ' + controlsOk + ' + 误伤 ' + falsePositive)
  console.log('抓到=' + caught + ' 漏网=' + missed + ' 崩红=' + crashed + ' 误伤=' + falsePositive)
  const closed = (caught + missed + crashed) === MUTATIONS.length && (controlsOk + falsePositive) === CONTROLS.length
  if (!closed) {
    console.log('闭合不成立 ⇒ 判定无效')
    process.exit(1)
  }
  process.exit(missed + crashed + falsePositive ? 1 : 0)
}
main()

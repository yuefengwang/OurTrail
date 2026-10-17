/* R-C 判别力自证：tools/rc-transport-mutate.js
 *
 * 对 tools/rc-transport-test.js（C-15 预览/编辑的进行时反馈 + A-04 待安排名单与候选分区）
 * 注入 12 条变异，要求：
 *   ① 10 条真回退全部变红（其中 M1 = 把「不置 busy」的改前形态请回来，正是派单书要求复现的那条改前红）；
 *   ② 2 条等价改写必须保持绿（证明门钉的是行为，不是源码文本 —— 铁律 30）；
 *   ③ 锚点在目标文件里命中必须恰为 1 次，且落在真实代码行（只剩注释 ⇒ 注入失败 ⇒ 计漏网并 exit 1）；
 *   ④ 先跑「未变异副本全绿」的有效性门，不过则后面所有读数不作数（exit 2）；
 *   ⑤ 崩红（抛异常 / 没有 passed= failed= tally）单列，不计入「抓到」。
 *
 * 沙盒纪律：只读 D:/OurTrail，注入全部发生在 %TEMP% 副本（miniprogram + 本套件）。
 * 运行：node tools/rc-transport-mutate.js
 * 退出码：0 = 每条读数都符合预期；1 = 有漏网 / 假绿外的不符 / 崩红 / 注入失败；2 = 前置门未过
 */
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')

const REPO = path.resolve(__dirname, '..')
const SUITE = 'rc-transport-test.js'
const JS = 'miniprogram/components/transport-panel/transport-panel.js'
const W = 'miniprogram/components/transport-panel/transport-panel.wxml'

const BASE = path.join(os.tmpdir(), 'rc-transport-' + process.pid)
function buildBase() {
  fs.rmSync(BASE, { recursive: true, force: true })
  fs.mkdirSync(path.join(BASE, 'tools'), { recursive: true })
  fs.cpSync(path.join(REPO, 'miniprogram'), path.join(BASE, 'miniprogram'), { recursive: true })
  fs.copyFileSync(path.join(REPO, 'tools', SUITE), path.join(BASE, 'tools', SUITE))
}
function mutate(rel, fromLines, toLines) {
  const p = path.join(BASE, rel)
  const text = fs.readFileSync(p, 'utf8')
  const eol = text.indexOf('\r\n') !== -1 ? '\r\n' : '\n'
  const from = fromLines.join(eol)
  const hits = text.split(from).length - 1
  if (hits !== 1) throw new Error('锚点在 ' + rel + ' 命中 ' + hits + ' 次（要求恰为 1）：' + from.slice(0, 80))
  const code = toLines.join(eol)
  // 锚点必须落在真实代码行：替换后若该处只剩注释，说明注入打在了说明文字上
  if (toLines.length && /^\s*\/\/|^\s*\/\*/.test(code.split(eol)[0])) {
    throw new Error('锚点落在注释行（要求真实代码行）：' + code.slice(0, 60))
  }
  fs.writeFileSync(p, text.split(from).join(code))
  return p
}
function runSuite() {
  const r = cp.spawnSync(process.execPath, [path.join(BASE, 'tools', SUITE)], { cwd: BASE, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const out = String(r.stdout || '').concat('\n', String(r.stderr || ''))
  const lines = out.split(/\r?\n/)
  const reds = lines.filter(l => l.trim().indexOf('✗') === 0).map(l => l.trim())
  const m = out.match(/passed=(\d+) failed=(\d+)/)
  const validityAbort = /有效性门未过/.test(out)
  const crashed = !m || /套件自身异常/.test(out)
  const cls = crashed ? 'CRASH' : (validityAbort ? 'INVALID' : (reds.length || Number(m[2]) > 0 ? 'red' : 'green'))
  return {
    code: r.status,
    tally: m ? m[0] : '(没有 tally ⇒ 中途中止)',
    reds: reds,
    crashed: crashed,
    validityAbort: validityAbort,
    crashLines: lines.filter(l => /TypeError|ReferenceError|套件自身异常/.test(l)).slice(0, 2),
    cls: cls,
  }
}

const CASES = [
  {
    id: 'M1 改前形态复现：onPreview 只检查 busy、从不置 busy（C-15 的原 bug）',
    expect: 'red',
    edits: [[JS, [
      "      this.setData({ busy: true, busyAt: Date.now(), error: '' })",
      '      api.previewAssignments(this.data.activityId).then(result => {',
    ], [
      '      api.previewAssignments(this.data.activityId).then(result => {',
    ]]],
  },
  {
    id: 'M2 预览成功分支不复位 busy（一次往返把面板锁死）',
    expect: 'red',
    edits: [[JS, [
      '        this.setData({',
      '          busy: false,',
      '          planOpen: true,',
    ], [
      '        this.setData({',
      '          planOpen: true,',
    ]]],
  },
  {
    id: 'M3 预览「服务端 Result 失败」分支不复位 busy',
    expect: 'red',
    edits: [[JS, [
      "          this.setData({ busy: false, error: result.error.message })",
      '          return',
      '        }',
      '        const plan = result.value',
    ], [
      "          this.setData({ error: result.error.message })",
      '          return',
      '        }',
      '        const plan = result.value',
    ]]],
  },
  {
    id: 'M4 预览失败后自动补发一次读（铁律 24：往返期间不得自己堆第二个方案）',
    expect: 'red',
    edits: [[JS, [
      "          this.setData({ busy: false, error: result.error.message })",
      '          return',
      '        }',
      '        const plan = result.value',
    ], [
      "          this.setData({ busy: false, error: result.error.message })",
      '          api.previewAssignments(this.data.activityId)',
      '          return',
      '        }',
      '        const plan = result.value',
    ]]],
  },
  {
    id: 'M5 名单判据改成从显示字段反推（!r.vehicle + tripMode 自算）—— 铁律 19 的复发点',
    expect: 'red',
    edits: [[JS, [
      "        const pending = v.rows.filter(r => r.status === 'confirmed' && r.needsSeatAssignment)",
    ], [
      "        const pending = v.rows.filter(r => r.status === 'confirmed' && r.tripMode === 'shared' && !r.vehicle && !r.seat)",
    ]]],
  },
  {
    id: 'M6 候选改成"排除已安排者"（把既有『把人移到空座位』的能力一起砍掉）',
    expect: 'red',
    edits: [[JS, [
      '        confirmedOptions: this.data.confirmed,',
      '        pendingOptions: this.data.pendingOptions,',
    ], [
      '        confirmedOptions: this.data.pendingOptions,',
      '        pendingOptions: this.data.pendingOptions,',
    ]]],
  },
  {
    id: 'M7 车辆编辑入口回到改前：readTransport 往返期间不置 busy',
    expect: 'red',
    edits: [[JS, [
      "      const id = e.currentTarget.dataset.id || ''",
      "      this.setData({ busy: true, busyAt: Date.now(), error: '' })",
      '      api.readTransport(this.data.activityId).then(result => {',
    ], [
      "      const id = e.currentTarget.dataset.id || ''",
      '      api.readTransport(this.data.activityId).then(result => {',
    ]]],
  },
  {
    id: 'M8 healBusy 一刀切：不看单源判据就复位 busy（真在跑的往返失去反馈）',
    expect: 'red',
    edits: [[JS, [
      '      if (this.data.busy && J.busyStale(this.data.busyAt, Date.now())) {',
    ], [
      '      if (this.data.busy) {',
    ]]],
  },
  {
    id: 'M9 两个滚轮不再互斥（屏幕上显示的人和真正安排的人可以不是同一个）',
    expect: 'red',
    edits: [[JS, [
      '    onAssignPick(e) { this.setData({ assignIndex: Number(e.detail.value), pendingIndex: -1 }) },',
    ], [
      '    onAssignPick(e) { this.setData({ assignIndex: Number(e.detail.value) }) },',
    ]]],
  },
  {
    id: 'M10 移除/交换回到"从候选下标反推现任"（改了滚轮就移除错的人）',
    expect: 'red',
    edits: [[JS, [
      '      const id = this.data.assignCurrentId',
      "      if (!id || this.data.busy) return",
    ], [
      "      const id = (this.data.confirmedOptions[this.data.assignIndex] || {}).signupId || ''",
      "      if (!id || this.data.busy) return",
    ]]],
  },
  {
    id: 'M11（等价改写，必须保持绿）待安排候选的 label 措辞纯改文案',
    expect: 'green',
    edits: [[JS, [
      "          label: r.name + ' · ' + (r.pickup || F.PICKUP_MISSING) + ' · 待安排',",
    ], [
      "          label: r.name + ' · ' + (r.pickup || F.PICKUP_MISSING) + ' · 尚未安排车辆',",
    ]]],
  },
  {
    id: 'M12（等价改写，必须保持绿）busyAt 取法重构成局部变量 + WXML 名单标题同义改写',
    expect: 'green',
    edits: [
      [JS, [
        "      this.setData({ busy: true, busyAt: Date.now(), error: '' })",
        '      api.previewAssignments(this.data.activityId).then(result => {',
      ], [
        '      const t0 = Date.now()',
        "      this.setData({ busy: true, busyAt: t0, error: '' })",
        '      api.previewAssignments(this.data.activityId).then(result => {',
      ]],
      [W, [
        '<text class="section-title">待安排名单 {{pendingList.length}} 人</text>',
      ], [
        '<text class="section-title">还没有车辆的人 {{pendingList.length}} 位</text>',
      ]],
    ],
  },
]

buildBase()
const pre = runSuite()
console.log('有效性门（未变异副本）：exit=' + pre.code + ' ' + pre.tally
  + (pre.reds.length ? '\n  ' + pre.reds.join('\n  ') : '')
  + (pre.cls === 'green' ? '' : '  ⇒ ' + pre.cls))
if (pre.cls !== 'green') {
  console.error('前置门未过 ⇒ 后面所有读数都不作数')
  fs.rmSync(BASE, { recursive: true, force: true })
  process.exit(2)
}

let leak = 0
let notRed = 0
let crashCount = 0
let injectFail = 0
let mismatch = 0
let invalid = 0
let restoreFail = 0
CASES.forEach(cs => {
  const touched = []
  let injectErr = null
  cs.edits.forEach(e => {
    if (injectErr) return
    try { touched.push(mutate(e[0], e[1], e[2])) } catch (err) { injectErr = err.message }
  })
  let r = null
  if (!injectErr) r = runSuite()
  // 每条变异跑完立刻用仓库里的真本还原：否则下一条变异打在"带伤"的副本上，
  // 读数会逐条累积（第一次跑就暴露过：红数 9→9→12→15→17→19→20 一路涨，其实是同一批伤在叠）。
  touched.forEach(q => {
    const rel = path.relative(BASE, q).split(path.sep).join('/')
    fs.copyFileSync(path.join(REPO, rel), q)
    if (fs.readFileSync(q, 'utf8') !== fs.readFileSync(path.join(REPO, rel), 'utf8')) {
      restoreFail++
      console.error('  还原失败：' + rel + '（这条之后的读数都不可信）')
    }
  })

  const actual = injectErr ? 'inject-fail' : r.cls
  const ok = cs.expect === actual
  if (actual === 'green' && cs.expect === 'red') leak++
  if (actual === 'red' && cs.expect === 'green') notRed++
  if (actual === 'CRASH') crashCount++
  if (actual === 'INVALID') invalid++
  if (injectErr) { leak++; injectFail++ }
  if (!ok && ['green', 'red', 'CRASH'].indexOf(actual) === -1) mismatch++
  console.log('\n[' + cs.id + ']')
  console.log('  预期=' + cs.expect + '  实测=' + actual + (ok ? '  （符合预期）' : '  ←←← 与预期不符'))
  if (injectErr) console.log('  注入失败读数：' + injectErr)
  if (r) {
    console.log('  exit=' + r.code + ' ' + r.tally + (r.crashed ? '  （CRASH≠CAUGHT：不计入抓到）' : ''))
    if (r.crashLines.length) console.log('  抛错处：' + r.crashLines.join(' / '))
    if (r.reds.length) console.log('  红：\n    ' + r.reds.slice(0, 6).join('\n    ') + (r.reds.length > 6 ? '\n    …共 ' + r.reds.length + ' 条' : ''))
  }
})
console.log('\n================ 汇总 ================')
const caught = CASES.length - leak - notRed - crashCount - invalid - mismatch
console.log('用例 ' + CASES.length + ' 条：抓到 ' + caught + ' 条 / 漏网(该红却绿，含注入失败 ' + injectFail + ' 条) '
  + leak + ' 条 / 等价改写被误判红 ' + notRed + ' 条 / 崩红 ' + crashCount + ' 条 / 有效性门中止 ' + invalid
  + ' 条 / 其它颜色不符 ' + mismatch + ' 条 / 还原失败 ' + restoreFail + ' 条')
console.log('闭合：抓到+漏网+误判红+崩红+有效性门中止+其它 = ' + caught + ' + ' + leak + ' + ' + notRed
  + ' + ' + crashCount + ' + ' + invalid + ' + ' + mismatch + ' = ' + (caught + leak + notRed + crashCount + invalid + mismatch))
fs.rmSync(BASE, { recursive: true, force: true })
process.exit(leak || notRed || crashCount || invalid || mismatch || restoreFail ? 1 : 0)

// 本轮 G2 四道新门的变异自证：node tools/g2-gates-mutate.js
//
// 目的不是「跑一遍看绿不绿」，而是**证明这几条门真的会咬**：把每条门要防的缺陷形态
// 注进一份沙盒副本，跑同一条门，要求它必须报红。仓库文件一字不动（沙盒在 %TEMP%）。
//
// 口径沿用 Wave 1′（out/G1/requests.md R-1）已经定下的三条，不另立一套：
//  · 抓到 caught = 退出码非 0 **且** 输出里有 `✗` 断言行 **且** 打印了 `passed=N failed=M` 的账；
//  · 崩红 CRASH = 没有账 / 抛错中止 ⇒ **不算抓到**（撞停不是判别力），单独计数并让本脚本 exit 1；
//  · 注入失败（锚点命中次数 ≠ 1，或前置读取失败）计一条失败并 exit 1，绝不静默改错行充数。
// 另有一条**等价变异体**（expectCaught:false）：把 handler 接上调用点后它就不该再是孤儿——
// 那条必须保持绿；它证明「全仓没有任何调用点」这半句判据真的在承重，而不是门在无条件把 onXxx 判死
// （铁律 32④：报「漏网」之前先确认变异体真的不等价）。
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SANDBOX = path.join(os.tmpdir(), 'g2-gates-mutate-' + process.pid)

const stats = { caught: 0, leaked: 0, crashed: 0, injectionFailed: 0, falseAlarm: 0, keptGreen: 0, noteMissing: 0 }

function copy(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const name of fs.readdirSync(from)) {
    if (name === 'node_modules' || name === '.git' || name === 'assets') continue
    const s = path.join(from, name), d = path.join(to, name)
    if (fs.statSync(s).isDirectory()) copy(s, d)
    else fs.copyFileSync(s, d)
  }
}

function prepare() {
  fs.rmSync(SANDBOX, { recursive: true, force: true })
  for (const tree of ['miniprogram', 'tools', 'cloudfunctions']) copy(path.join(ROOT, tree), path.join(SANDBOX, tree))
}

const rd = rel => fs.readFileSync(path.join(SANDBOX, rel), 'utf8')
const wr = (rel, text) => fs.writeFileSync(path.join(SANDBOX, rel), text)

/** 锚点替换：命中次数必须恰为 1。 */
function sub(rel, anchor, replacement) {
  let src
  try { src = rd(rel) } catch (e) { return '读不到 ' + rel }
  const hits = src.split(anchor).length - 1
  if (hits !== 1) return rel + ' 锚点命中 ' + hits + ' 次（要求恰为 1）'
  wr(rel, src.split(anchor).join(replacement))
  return null
}

/** 追加（wxss / wxml 这类「尾部加一条」的变异，不需要唯一锚点）。 */
function append(rel, text) {
  let src
  try { src = rd(rel) } catch (e) { return '读不到 ' + rel }
  wr(rel, src + text)
  return null
}

function runSuite(suite) {
  const r = spawnSync(process.execPath, [path.join(SANDBOX, 'tools', suite)], { encoding: 'utf8', cwd: SANDBOX })
  const out = String(r.stdout || '') + String(r.stderr || '')
  const tally = out.match(/passed=(\d+)\s+failed=(\d+)/)
  const reds = (out.match(/✗/g) || []).length
  // 崩红与「报红」必须分开：崩红（抛错撞停、或一条输出都没有）不算抓到——它只证明跑不起来。
  // check-handlers.js 这类预提交门不打印 passed= 账，它的正常形态就是 ✓/✗ 行 + 退出码，
  // 所以「有没有账」不能当成崩红条件，否则这条门会被自己的记法判死（本轮实测踩过）。
  const crashed = /SUITE CRASHED|ReferenceError:|TypeError:|SyntaxError:/.test(out) || out.trim().length === 0
  const red = !crashed && (r.status !== 0 || reds > 0 || (tally ? Number(tally[2]) > 0 : false))
  return {
    code: r.status,
    tally: tally ? tally[0] : null,
    failed: tally ? Number(tally[2]) : null,
    reds,
    crashed,
    red,
    out,
    tail: out.split(/\r?\n/).filter(l => /✗|⚠/.test(l)).slice(0, 3),
  }
}

const OLD_NETWORK = "else if (code === 'NETWORK' || code === 'OFFLINE') cause = '这一条没有发到云端，原安排没被改动。到信号好的地方再试一次。'"

const CASES = [
  {
    id: 'C1 传输层话术退回「原安排没被改动」（C-07 本体，违铁律 24）',
    files: ['miniprogram/utils/journey.js'],
    apply: () => sub('miniprogram/utils/journey.js',
      "else if (code === 'NETWORK' || code === 'OFFLINE') cause = '这一条没拿到云端的回话：可能没发出去，也可能已经生效、只是回应丢了。先按页面重读后的最新安排判断，确认这一步没做成才重做一次。'",
      OLD_NETWORK),
    suites: ['journey-test.js', 'failure-semantics-test.js'],
  },
  {
    id: 'C2 一刀切：服务端明确「没落库」那条也被改成结果未知话术（反向对照必须咬）',
    files: ['miniprogram/utils/journey.js'],
    apply: () => sub('miniprogram/utils/journey.js',
      "else if (code === 'STORAGE_UNAVAILABLE') cause = message || '这次修改没有保存，原安排未改变。'",
      "else if (code === 'STORAGE_UNAVAILABLE') cause = '这一条没拿到云端的回话：可能没发出去，也可能已经生效、只是回应丢了。'"),
    suites: ['failure-semantics-test.js'],
  },
  {
    id: 'C3 门槛说明不报人数（M19 前向契约「若非空必须可核对」必须咬）',
    files: ['miniprogram/utils/journey.js'],
    apply: () => sub('miniprogram/utils/journey.js',
      "    if (parts.length) return '还有 ' + parts.join('、') + '，逐人核实后才能出发。'",
      "    if (parts.length) return '还有人员没给出出发结论，逐人核实后才能出发。'"),
    suites: ['workspace-gate-test.js', 'journey-test.js'],
  },
  {
    id: 'C4 把投影里不存在的影子键 unresolved 请回 counters（C-05 本体）',
    files: ['miniprogram/utils/journey.js'],
    apply: () => sub('miniprogram/utils/journey.js',
      "    if (ctx.notVerified) parts.push(ctx.notVerified + ' 人没给出出发结论')",
      "    if (c.unresolved) parts.push(c.unresolved + ' 人没给出出发结论')"),
    suites: ['journey-test.js', 'journey-graph-test.js'],
  },
  {
    id: 'T1 新增一条超出预算的 toast 文案（M-11 / C-21 同型）',
    files: ['miniprogram/pages/discover/discover.js'],
    apply: () => sub('miniprogram/pages/discover/discover.js', '  onOpenCard(e) {',
      "  onG2LongToast() {\n    api.toast('这条是变异注入的超长话术，专门用来证明预算门真的在数码点而不是空转')\n  },\n\n  onOpenCard(e) {"),
    suites: ['g2-toast-copy-test.js'],
  },
  {
    id: 'T2 把预算从 20 抬到 26（M-11 的一种真修法：缺陷确实被修掉 ⇒ 门必须转绿，且必须点名要求清理登记）',
    files: ['miniprogram/utils/api.js'],
    expectCaught: false,
    expectNote: '请从 KNOWN_OVERBUDGET 删除',
    apply: () => sub('miniprogram/utils/api.js', 'slice(0, 20)', 'slice(0, 26)'),
    suites: ['g2-toast-copy-test.js'],
  },
  {
    id: 'B1 新加一个既没绑定也没任何调用点的 onXxx handler（门 B 本体，M-09 同型）',
    files: ['miniprogram/pages/discover/discover.js'],
    apply: () => sub('miniprogram/pages/discover/discover.js', '  onOpenCard(e) {',
      '  onG2ProbeDead() {\n    // 变异注入：谁也没引用它\n  },\n\n  onOpenCard(e) {'),
    suites: ['check-handlers.js'],
  },
  {
    id: 'B2 登记项被改空但 editor.onNumber 还在（清单不得被悄悄摘掉）',
    files: ['tools/check-handlers.js'],
    apply: () => sub('tools/check-handlers.js', "    file: 'pages/editor/editor.js', name: 'onNumber',",
      "    file: 'pages/nowhere/nowhere.js', name: 'onNothing',"),
    suites: ['check-handlers.js'],
  },
  {
    id: 'B3【等价变异体】同一个 handler 接上了 JS 调用点 ⇒ 不得再判成孤儿',
    files: ['miniprogram/pages/discover/discover.js'],
    expectCaught: false,
    apply: () => {
      const e1 = sub('miniprogram/pages/discover/discover.js', '  onOpenCard(e) {',
        '  onG2ProbeLive() {\n    // 定义了、模板没绑定，但被 JS 调用 ⇒ 不是孤儿\n  },\n\n  onOpenCard(e) {')
      if (e1) return e1
      return sub('miniprogram/pages/discover/discover.js', '  onLoad() {',
        '  onLoad() {\n    this.onG2ProbeLive()')
    },
    suites: ['check-handlers.js'],
  },
  {
    id: 'E1 WXSS 引入 color-mix()（渲染层不支持，platform-pitfalls §3）',
    files: ['miniprogram/pages/discover/discover.wxss'],
    apply: () => append('miniprogram/pages/discover/discover.wxss',
      '\n.g2mut { color: color-mix(in srgb, red 50%, blue); }\n'),
    suites: ['g2-platform-gate-test.js'],
  },
  {
    id: 'E2 组件里写第二个 options 键，把 styleIsolation 挤掉（AGENTS.md 铁律 1 的原形态）',
    files: ['miniprogram/components/status-panel/status-panel.js'],
    apply: () => sub('miniprogram/components/status-panel/status-panel.js',
      "options: { styleIsolation: 'apply-shared' },",
      "options: { styleIsolation: 'apply-shared' },\n  options: { multipleSlots: true },"),
    suites: ['g2-platform-gate-test.js'],
  },
  {
    id: 'E3 给没有 multipleSlots 的组件加具名 slot（P4 真机 bug 的形态）',
    files: ['miniprogram/components/person-row/person-row.wxml'],
    apply: () => append('miniprogram/components/person-row/person-row.wxml', '\n<slot name="g2slot"></slot>\n'),
    suites: ['g2-platform-gate-test.js'],
  },
  {
    id: 'E4 position:sticky 不带任何偏移（E-06 同型的新死声明）',
    files: ['miniprogram/pages/discover/discover.wxss'],
    apply: () => append('miniprogram/pages/discover/discover.wxss', '\n.g2mut2 { position: sticky; }\n'),
    suites: ['g2-platform-gate-test.js'],
  },
  {
    id: 'E5 固定底栏与 has-sticky 脱钩（E-02 的形态：底栏还在，页尾留白没了）',
    files: ['miniprogram/pages/route-edit/route-edit.wxml'],
    apply: () => sub('miniprogram/pages/route-edit/route-edit.wxml',
      `class="page {{!denied && !loading ? 'has-sticky' : ''}}"`,
      `class="page"`),
    suites: ['g2-platform-gate-test.js'],
  },
  {
    id: 'E6 非 tab 页抄走 tabBar 专用留白公式（E-03 的形态，新增一处）',
    files: ['miniprogram/pages/route/route.wxss'],
    apply: () => append('miniprogram/pages/route/route.wxss',
      '\n.g2mut3 { padding-bottom: calc(32px + 84px + env(safe-area-inset-bottom)); }\n'),
    suites: ['g2-platform-gate-test.js'],
  },
]

const BASELINE = ['journey-test.js', 'journey-graph-test.js', 'failure-semantics-test.js',
  'g2-toast-copy-test.js', 'g2-platform-gate-test.js', 'check-handlers.js', 'workspace-gate-test.js']

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
    console.log('常见原因：同波次别的 Agent 正在改 miniprogram/**，或某条登记项已被对方修好（那属于清单要清理，不是判据要放宽）。')
    fs.rmSync(SANDBOX, { recursive: true, force: true })
    process.exit(1)
  }

  console.log('\n== 1. 逐条变异 ==')
  for (const c of CASES) {
    const expect = c.expectCaught !== false
    const snap = {}
    c.files.forEach(f => { snap[f] = rd(f) })
    const err = c.apply()
    if (err) {
      stats.injectionFailed++
      console.log('✗ 注入失败：' + c.id + ' → ' + err)
    } else {
      for (const s of c.suites) {
        const r = runSuite(s)
        const red = r.red
        const noteOk = !c.expectNote || new RegExp(c.expectNote).test(r.out)
        let verdict
        if (r.crashed) { stats.crashed++; verdict = 'CRASH≠CAUGHT' }
        else if (expect) {
          if (red) { stats.caught++; verdict = '抓到' }
          else { stats.leaked++; verdict = '漏网' }
        } else {
          if (red) { stats.falseAlarm++; verdict = '误伤（等价变异体／真修法被判红）' }
          else if (!noteOk) { stats.noteMissing++; verdict = '转绿了但没点名要求清理登记' }
          else { stats.keptGreen++; verdict = c.expectNote ? '按预期保持绿（并点名清理登记）' : '按预期保持绿（等价变异体／真修法）' }
        }
        const okLine = verdict === '抓到' || verdict.indexOf('按预期保持绿') === 0
        console.log((okLine ? '✓ ' : '✗ ') + c.id + ' ｜ ' + s + ' → exit=' + r.code + ' ' + (r.tally || '没有账') +
          ' 红行=' + r.reds + ' ⇒ ' + verdict)
        if (!okLine) r.tail.forEach(l => console.log('      ' + l.trim()))
      }
    }
    c.files.forEach(f => wr(f, snap[f]))
  }

  fs.rmSync(SANDBOX, { recursive: true, force: true })
  console.log('\n==== 变异自证：抓到 ' + stats.caught + ' 条 ｜ 漏网 ' + stats.leaked +
    ' 条 ｜ 崩红 ' + stats.crashed + ' 条 ｜ 注入失败 ' + stats.injectionFailed +
    ' 条 ｜ 误伤 ' + stats.falseAlarm + ' 条 ｜ 转绿且点名清理 ' + stats.keptGreen +
    ' 条 ｜ 转绿但没点名 ' + stats.noteMissing + ' ====')
  process.exit(stats.leaked || stats.crashed || stats.injectionFailed || stats.falseAlarm || stats.noteMissing ? 1 : 0)
}

main()

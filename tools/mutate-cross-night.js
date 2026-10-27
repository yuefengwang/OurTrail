/* C7（F4 阶段二：跨夜日程 / OI 24h）的变异自证
 *
 * 对拍 `tools/ab-cross-night.js` 证明「c7 冻结快照 → 当前工作树」的差异只落在允许清单内；
 * 本脚本反过来问：把 C7 的每条口径分别拆掉，**至少有一个门禁必须变红**。全绿 = 门禁是假的。
 *
 * ── 改前 / 改后 ──────────────────────────────────────────────────────
 *   改前（有效期门）= 工作树 `miniprogram/` 的一份**未变异副本**（拷到 os.tmpdir）。
 *   改后（每条变异）= 同一份副本上只改**一个生产文件的一处**，然后跑
 *        `POST_ROOT=<temp> node tools/ab-cross-night.js`
 *   ——A/B 自己的「改前侧」仍是 `D:/ot-baselines/c7` 冻结快照，与本脚本的变异无关；
 *     本脚本只把它的「改后侧」（POST_ROOT）指向临时副本。
 *
 * ── 单元门禁接力（为什么 M2/M7/M8 还有第二道证据）──────────────────
 *   A/B 在业务 oracle 之前有一道**基线身份探针**：它要求「改后侧真的消费 nightHours」
 *   （agenda / OI 传与不传 nightHours 的输出必须不同）。把 C7 的消费口径整条拆掉
 *   （M2/M7/M8）时，变异体按设计会先撞上这道探针 ⇒ A/B **exit 2**。
 *   这里的 exit 2 是**变异本身**造成的（改后侧不再是 post-C7），不是基线/环境坏了；
 *   但它仍然**不是业务抓住**——业务断言一行都没跑到。所以另跑既有的单元套件接力：
 *     M2 → tools/weather-v2-test.js（§2d 跨夜日程）
 *     M7/M8 → tools/outdoor-intelligence-test.js（跨夜 OI 段）
 *   两个读数（A/B exit 2 与 unit failed=N）都打印，A/B 的 exit 2 永远不当成 A/B 业务断言。
 *   单元套件也在未变异副本上先跑一遍（有效期门），failed=0 才算环境可用。
 *
 * ── 约定（沿用 mutate-rainbow.js / mutate-silence.js 的变异框架）────────
 *   ① **有效期门**：未变异副本必须 A/B exit 0 且输出含「越界：0」，两个单元套件
 *      必须 exit 0 / failed=0，否则 exit 2（INVALID，不是通过）。没这一门，
 *      后面的红可能来自环境/基线而不是变异。
 *   ② **锚点唯一性**：每条变异的 from 必须**恰好命中一次**；0 次或多次 = 注入失败，
 *      计漏网并 exit 1（多次命中意味着改的不止一处，结果无法归因）。
 *   ③ **抓住的判据（两个门，任一即可）**：
 *      A/B —— **exit code === 1**，且输出里有一条越界/硬门失败信息（`✗` 或 `FAIL：`）；
 *      unit —— 套件 **exit code === 1**，且输出含 `failed=[1-9]` 与 `✗`。
 *      **A/B exit 2 不算 A/B 抓住**——那是 harness 自检（md5 / 基线身份探针 / 快照
 *      不可达）判了 INVALID，不是业务断言判了红；崩溃、超时、e.status == null 同样
 *      不算抓住（它只说明脚本没跑完）。A/B 已是 exit 1 时不重复跑 unit。
 *   ④ **每条之间重新复制**临时副本，不在已变异的文件上叠加（否则第二条变异测的是
 *      “两条变异之和”）。副本里除 `miniprogram/` 外，还按原仓库路径放好单元套件
 *      与它 require 的仓库文件（套件内部用 `require('../miniprogram/...')`）。
 *   ⑤ 仓库源文件是 CRLF；匹配前统一成 LF，写回保留 LF（Node 能读，A/B 只读不写）。
 *   ⑥ **漏网要归因**：A/B exit 0 = 没有断言/硬门发现差异；A/B exit 2 = 被前置身份探针
 *      拦下；带 unit 的变异还要看 unit 是否真的判红。都如实打印，不硬凑成抓住。
 *
 * ── 十八条变异（文件 · 口径）────────────────────────────────────────
 *   Agenda（utils/agenda.js）
 *     M1  去掉 day-aware 连续性 —— 跨零点簇在 23:00/00:00 断开；
 *     M2  夜簇改用当日 detail —— 跨零点/纯次日窗口丢失；
 *         A/B 会被前置探针拦成 exit 2，由 weather-v2-test §2d 接力判红；
 *     M3  不剔除前夜尾段 —— 早上的假窗口复活（同刻同题去重会折叠一部分，靠别的场景抓）；
 *     M4  排序退化 —— 「次日」事件排到今日事件之前；
 *     M5  不标次日 —— 纯次日事件失去 `次日 ` 前缀与 dayOffset 语义；
 *     M6  机会句问当日 detail —— 今晚的 galaxy 在后半夜，当日没有 ⇒ 该说的不说。
 *   OI（utils/outdoor-intelligence.js）
 *     M7  不剔除当日星象尾段 —— 同一现象出两次、早上那次是错的；
 *         A/B 会被前置探针拦成 exit 2，由 outdoor-intelligence-test 接力判红；
 *     M8  不消费 nightHours —— 跨零点窗口整体消失；
 *         A/B 会被前置探针拦成 exit 2，由 outdoor-intelligence-test 接力判红；
 *     M9  纯次日窗口泄漏 —— 24h 卡出现“明天的窗口”；
 *     M10 skyBlocked 跨零点不切段 —— 今晚段的头顶云漏查；
 *     M11 夜窗口 hours 用 detailHours —— 跨零点后半段被筛掉；
 *     M12 factsFor 不带 night —— 夜段证据退回自然日（13% → 90%）。
 *   呈现（utils/oi-presentation.js）
 *     M13 时间轴画次日段 —— 旧几何（left=0 的次日段）复活；
 *     M14 anchor 走非跨零点分支 —— endHour 不再是 24；
 *     M15 live 含次日段 —— 后半夜的窗口在今日图上被判“进行中”；
 *     M16 applySelection 跨零点含次日段 —— 点次日小时命中了今天的条目；
 *     M17 horizon 泄漏 fromMin/toMin —— 48/72h 阳性对照被污染；
 *     M18 itemsSorted 退回 timeText —— 跨零点条目的「今晚 … → 次日 …」反解成 -1 被排到最前。
 *
 * 运行：node tools/mutate-cross-night.js
 * 退出码：0 全部 18 条至少被一个门禁抓住 / 1 有真漏网、注入失败或崩溃
 *         / 2 有效期门失败（未变异副本的 A/B 或单元套件没通过，INVALID）。
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'miniprogram')
const AB = path.join(ROOT, 'tools', 'ab-cross-night.js')

const MUTATIONS = [
  /* ---------- Agenda ---------- */
  {
    id: 'M1',
    file: 'utils/agenda.js',
    name: '去掉 day-aware 连续性（跨零点簇在 23:00/00:00 断开）',
    from: 'const abs = originDate ? absMinutes(h, originDate) : sky.hourMin(h.t)',
    to: 'const abs = sky.hourMin(h.t)',
  },
  {
    id: 'M2',
    file: 'utils/agenda.js',
    name: '夜簇改用当日 detail（跨零点/纯次日窗口丢失）',
    from: 'clustersOf(nights, marks || {}, date)',
    to: 'clustersOf(detail, marks || {}, date)',
    /* A/B 的基线身份探针会先判「改后侧不消费 nightHours」⇒ exit 2；
       由 §2d 跨夜日程套件接力判红。 */
    unit: 'weather-v2-test.js',
  },
  {
    id: 'M3',
    file: 'utils/agenda.js',
    name: '不剔除前夜尾段（早上的假窗口复活）',
    from: 'if (nights && isNightKey(c.key)) return',
    to: 'if (false && nights && isNightKey(c.key)) return',
  },
  {
    id: 'M4',
    file: 'utils/agenda.js',
    name: '排序退化（次日事件排到今日事件之前）',
    from: 'return (next ? 1440 : 0) + (Number.isFinite(m) ? m : 0)',
    to: 'return Number.isFinite(m) ? m : 0',
  },
  {
    id: 'M5',
    file: 'utils/agenda.js',
    name: '不标次日（纯次日事件失去「次日」前缀）',
    from: "const t = startNextDay ? '次日 ' + c.from : c.from",
    to: 'const t = c.from',
  },
  {
    id: 'M6',
    file: 'utils/agenda.js',
    name: '机会句问当日 detail（今晚后半夜的 galaxy 被当成没有）',
    from: "hasMark(nights || detail, marks, 'galaxy')",
    to: "hasMark(detail, marks, 'galaxy')",
  },
  /* ---------- OI ---------- */
  {
    id: 'M7',
    file: 'utils/outdoor-intelligence.js',
    name: '不剔除当日星象尾段（同一现象出两次，早上那次是错的）',
    from: 'if (nights && agenda.isNightKey(c.key)) return',
    to: 'if (false && nights && agenda.isNightKey(c.key)) return',
    /* A/B 前置身份探针先拦（exit 2），由 OI 跨夜段接力判红。 */
    unit: 'outdoor-intelligence-test.js',
  },
  {
    id: 'M8',
    file: 'utils/outdoor-intelligence.js',
    name: '不消费 nightHours（跨零点窗口整体消失）',
    from: 'const nights = agenda.isNightSequence(ctx.nightHours) ? ctx.nightHours : null',
    to: 'const nights = null',
    /* A/B 前置身份探针先拦（exit 2），由 OI 跨夜段接力判红。 */
    unit: 'outdoor-intelligence-test.js',
  },
  {
    id: 'M9',
    file: 'utils/outdoor-intelligence.js',
    name: '纯次日窗口泄漏进 24h 卡',
    from: '      if (c.fromD !== ctx.date) return\n',
    to: '',
  },
  {
    id: 'M10',
    file: 'utils/outdoor-intelligence.js',
    name: 'skyBlocked 跨零点不切段（今晚段的头顶云漏查）',
    from: 'const end = t < f ? 1440 : t',
    to: 'const end = t',
    escapeNote: 'A/B §C6b 已带一条合成场景（今晚 22:00 IN_CLOUD、夜序列 21:00→次日 02:00）'
      + '并要求该跨零点窗口沉默（另有“无云时照常产出”的阳性对照）。'
      + '本轮它 exit 1 就是这条牙齿咬住的；若此处回到 exit 0，先检查 C6b 是否还在。',
  },
  {
    id: 'M11',
    file: 'utils/outdoor-intelligence.js',
    name: '夜窗口 hours 用 detailHours（跨零点后半段被筛掉）',
    from: 'makeWindow(type, from, to, ev, {}, c.hours, ctx)',
    to: 'makeWindow(type, from, to, ev, {}, detailHours(detail, from, to), ctx)',
  },
  {
    id: 'M12',
    file: 'utils/outdoor-intelligence.js',
    name: 'factsFor 不带 night（夜段证据退回自然日 90%）',
    from: '    night: full.nightHours || null,\n',
    to: '',
  },
  /* ---------- 呈现 ---------- */
  {
    id: 'M13',
    file: 'utils/oi-presentation.js',
    name: '时间轴画次日段（left=0 的旧几何复活）',
    from: '      if (cross && si > 0) return\n',
    to: '',
  },
  {
    id: 'M14',
    file: 'utils/oi-presentation.js',
    name: 'anchor 走非跨零点分支（endHour 不再是 24）',
    from: 'if (cross) {',
    to: 'if (false) {',
  },
  {
    id: 'M15',
    file: 'utils/oi-presentation.js',
    name: 'live 含次日段（后半夜在今日图上被判进行中）',
    from: 'const visible = cross ? segs.slice(0, 1) : segs',
    to: 'const visible = segs',
    escapeNote: 'A/B 现在用次日段**内部**时钟 nowMin=to-30 判 live=false（端点 to 不属于任何一段，'
      + '用 to+30 两边都会是 false，等于没测）。本轮它 exit 1 就是这条牙齿咬住的；'
      + '若此处回到 exit 0，先检查该判据是否被改回 to+30。',
  },
  {
    id: 'M16',
    file: 'utils/oi-presentation.js',
    name: 'applySelection 跨零点含次日段（点次日小时命中今天条目）',
    from: 'return it.toMin < it.fromMin ? segs.slice(0, 1) : segs',
    to: 'return segs',
    escapeNote: 'A/B 现在取次日段**内部**小时 floor((to-1)/60) 调 applySelection 并断言不命中'
      + '（终点小时是开区间端点，两侧都不命中，等于没测）。本轮它 exit 1 就是这条牙齿咬住的；'
      + '若此处回到 exit 0，先检查该判据是否被改回终点小时。',
  },
  {
    id: 'M17',
    file: 'utils/oi-presentation.js',
    name: 'horizon 泄漏 fromMin/toMin（48/72h 阳性对照被污染）',
    from: '      delete base.fromMin\n      delete base.toMin\n',
    to: '',
  },
  {
    id: 'M18',
    file: 'utils/oi-presentation.js',
    name: 'itemsSorted 退回 timeText（跨零点反解成 -1 排到最前）',
    from: '    const af = Number.isFinite(a.fromMin) ? a.fromMin : hmMin(a.timeText.split(\'–\')[0])\n'
      + '    const bf = Number.isFinite(b.fromMin) ? b.fromMin : hmMin(b.timeText.split(\'–\')[0])\n'
      + '    return af - bf\n',
    to: '    return hmMin(a.timeText.split(\'–\')[0]) - hmMin(b.timeText.split(\'–\')[0])\n',
  },
]

/* 单元门禁接力：从 MUTATIONS 的 unit 字段去重得到，避免"变异表"与"套件名单"两处漂移。
   套件运行时要按仓库同形解析 `require('../miniprogram/...')`，所以副本目录保持
   `<temp>/tools/<suite>` + `<temp>/miniprogram/...`；它额外 require 的仓库文件
   由 SUITE_DEPS 逐个搬过去（目前只有 weather-v2-test 需要云函数的 lib/weather.js）。 */
const SUITES = Array.from(new Set(MUTATIONS.map(m => m.unit).filter(Boolean)))
const SUITE_DEPS = {
  'weather-v2-test.js': ['cloudfunctions/trailApi/lib/weather.js'],
  'outdoor-intelligence-test.js': [],
}

function copyTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-crossnight-mut-'))
  fs.cpSync(SRC, path.join(dir, 'miniprogram'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true })
  SUITES.forEach(suite => {
    fs.copyFileSync(path.join(ROOT, 'tools', suite), path.join(dir, 'tools', suite))
    ;(SUITE_DEPS[suite] || []).forEach(rel => {
      const dst = path.join(dir, rel)
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      fs.copyFileSync(path.join(ROOT, rel), dst)
    })
  })
  return dir
}

function runAb(dir) {
  try {
    const out = execFileSync(process.execPath, [AB], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 180000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { POST_ROOT: dir }),
    })
    return { status: 0, timedOut: false, out }
  } catch (e) {
    const status = typeof e.status === 'number' ? e.status : null
    return {
      status,
      timedOut: !!(e.killed || e.signal),
      out: String(e.stdout || '') + String(e.stderr || ''),
    }
  }
}

/* 单元门禁：直接跑副本里的套件（`__dirname` 必须是 `<temp>/tools`）。
   cwd 也用副本根，避免套件里任何相对 cwd 的读取落回真实工作树。 */
function runUnit(dir, suite) {
  try {
    const out = execFileSync(process.execPath, [path.join(dir, 'tools', suite)], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 180000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env),
    })
    return { status: 0, timedOut: false, out }
  } catch (e) {
    const status = typeof e.status === 'number' ? e.status : null
    return {
      status,
      timedOut: !!(e.killed || e.signal),
      out: String(e.stdout || '') + String(e.stderr || ''),
    }
  }
}

function failureLines(out) {
  return String(out)
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.indexOf('✗') !== -1 || s.indexOf('FAIL：') !== -1)
}

function statsOf(out) {
  const m = String(out).match(/passed=(\d+) failed=(\d+)/)
  return m ? { passed: Number(m[1]), failed: Number(m[2]) } : null
}

/* ① 有效期门：未变异副本必须 A/B exit 0 +「越界：0」，且单元套件 failed=0。
      单元套件也要过这一门，否则后面「unit 抓住」可能只是副本环境坏了。 */
console.log('有效期门：未变异副本（POST_ROOT=<temp>）')
const validityDir = copyTree()
const validRun = runAb(validityDir)
const validStats = statsOf(validRun.out)
const validOk = !validRun.timedOut && validRun.status === 0
  && /越界：0(?:[；;\s]|$)/.test(validRun.out)
console.log('  ab-cross-night.js exit=' + validRun.status
  + (validStats ? ' passed=' + validStats.passed + ' failed=' + validStats.failed : '（无 passed/failed 读数）')
  + ' 越界：' + (/越界：(\d+)/.exec(validRun.out) ? /越界：(\d+)/.exec(validRun.out)[1] : '?'))

let unitValidOk = true
SUITES.forEach(suite => {
  const u = runUnit(validityDir, suite)
  const us = statsOf(u.out)
  const uOk = !u.timedOut && u.status === 0 && !!us && us.failed === 0
    && String(u.out).indexOf('✗') === -1
  if (!uOk) unitValidOk = false
  console.log('  ' + suite + ' exit=' + (u.status == null ? 'null' : u.status)
    + (us ? ' passed=' + us.passed + ' failed=' + us.failed : '（无 passed/failed 读数）')
    + (uOk ? '' : '  ✗ 未变异副本上单元门禁未全绿'))
  if (!uOk) failureLines(u.out).slice(0, 4).forEach(s => console.log('    ' + s))
})
fs.rmSync(validityDir, { recursive: true, force: true })
if (!validOk) {
  console.log(failureLines(validRun.out).slice(0, 6).join('\n'))
  console.log('INVALID：未变异副本没有通过（A/B exit 0 + 越界：0），变异结果无意义')
  process.exit(2)
}
if (!unitValidOk) {
  console.log('INVALID：未变异副本上的单元门禁没有全绿，unit 接力读数无意义')
  process.exit(2)
}

/* ② 逐条变异：每条都重新复制，绝不叠加 */
let escaped = 0
let injected = 0
const tally = {
  abCaught: 0,      // A/B exit 1：业务/硬门断言抓住
  precondUnit: 0,   // A/B exit 2（前置身份探针）+ unit exit 1：unit 接力抓住
  unitOnly: 0,      // A/B 非 exit 2 且未抓住 + unit exit 1（应不出现，出现也如实记）
  silent: 0,        // A/B exit 0 且 unit 未红（或无 unit）
  precondMiss: 0,   // A/B exit 2 且 unit 未红（或无 unit）——不是业务抓住，也不是 exit 0
  broken: 0,        // 崩溃 / 超时 / e.status == null
  injectFail: 0,
}

MUTATIONS.forEach(m => {
  const dir = copyTree()
  const file = path.join(dir, 'miniprogram', m.file)
  const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const hits = src.split(m.from).length - 1
  if (hits !== 1) {
    escaped += 1
    tally.injectFail += 1
    console.log(m.id + '  命中=' + hits + '（应为 1）；A/B exit=-；unit -；抓住来源=无（注入失败）—— ' + m.name)
    fs.rmSync(dir, { recursive: true, force: true })
    return
  }
  injected += 1
  fs.writeFileSync(file, src.replace(m.from, m.to))
  const r = runAb(dir)
  const fails = failureLines(r.out)
  const stats = statsOf(r.out)
  const invalidLines = String(r.out).split('\n')
    .filter(s => s.indexOf('INVALID') !== -1).map(s => s.trim())
  /* A/B 的抓住判据：exit 1 + 一条失败读数。
     exit 2 = harness 前置自检（md5 / 基线身份探针）判 INVALID，不是业务断言；
     崩溃/超时/status==null = 脚本没跑完。两者都不计 A/B 抓住。 */
  const abCaught = !r.timedOut && r.status === 1 && fails.length > 0

  /* A/B 已抓住就不重复跑 unit；否则（尤其 exit 2）由既有单元套件接力。
     unit 的抓住判据：exit 1 + 输出含 failed=[1-9] + 含 ✗（三者缺一不算）。 */
  let unitRun = null
  let unitStats = null
  let unitCaught = false
  if (!abCaught && m.unit) {
    unitRun = runUnit(dir, m.unit)
    unitStats = statsOf(unitRun.out)
    unitCaught = !unitRun.timedOut && unitRun.status === 1
      && /failed=[1-9]\d*/.test(String(unitRun.out))
      && String(unitRun.out).indexOf('✗') !== -1
  }
  const unitText = m.unit
    ? (unitRun
      ? 'unit ' + m.unit + ' exit=' + (unitRun.status == null ? 'null' : unitRun.status)
        + (unitStats ? ' failed=' + unitStats.failed : ' failed=（无读数）')
      : 'unit ' + m.unit + '（A/B 已抓住，未跑）')
    : 'unit -'

  let source = '无'
  let verdict
  if (abCaught) {
    source = 'A/B'
    verdict = '抓住 ✓（A/B 业务/硬门断言）'
    tally.abCaught += 1
  } else if (unitCaught) {
    source = 'unit'
    if (!r.timedOut && r.status === 2) {
      verdict = '抓住 ✓（A/B exit 2 是前置门，不算业务抓住；unit 接力判红）'
      tally.precondUnit += 1
    } else {
      verdict = '抓住 ✓（A/B 未红，unit 接力判红）'
      tally.unitOnly += 1
    }
  } else if (!r.timedOut && r.status === 2) {
    verdict = '漏网 ✗（A/B 前置门 exit 2，unit 未红）'
    tally.precondMiss += 1
  } else if (r.status === 0) {
    verdict = '漏网 ✗（exit 0，没有任何越界/硬门' + (m.unit ? '，unit 未红' : '') + '）'
    tally.silent += 1
  } else {
    verdict = '未抓住 ✗（' + (r.timedOut ? '超时' : r.status == null ? 'e.status == null / 崩溃' : 'exit ' + r.status) + '，unit 未红）'
    tally.broken += 1
  }
  const caught = abCaught || unitCaught
  if (!caught) escaped += 1
  console.log(m.id + '  命中=' + hits + '  A/B exit=' + (r.status == null ? 'null' : r.status)
    + '；' + unitText + '；抓住来源=' + source + ' —— ' + m.name
    + (stats ? '（A/B passed=' + stats.passed + ' failed=' + stats.failed + '）' : ''))

  if (abCaught) {
    fails.slice(0, 2).forEach(s => console.log('    ' + s))
  } else if (!r.timedOut && r.status === 2) {
    invalidLines.slice(0, 2).forEach(s => console.log('    A/B 前置门：' + s))
    console.log('    说明：A/B 的基线身份探针先于业务 oracle 触发，业务断言没有跑到——'
      + 'exit 2 不计 A/B 抓住，也不等于“A/B 看不见这条口径”。')
  } else if (r.status === 0) {
    const tail = String(r.out).trim().split('\n').filter(s => s.trim()).slice(-1)
    tail.forEach(s => console.log('    （A/B 输出末行：' + s.trim() + '）'))
    if (m.escapeNote) console.log('    归因：' + m.escapeNote)
  }
  if (unitRun) {
    if (unitCaught) {
      failureLines(unitRun.out).slice(0, 3).forEach(s => console.log('    ' + m.unit + '：' + s))
    } else {
      const tail = String(unitRun.out).trim().split('\n').filter(s => s.trim()).slice(-1)
      tail.forEach(s => console.log('    （' + m.unit + ' 末行：' + s.trim() + '）'))
    }
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

const caughtTotal = tally.abCaught + tally.precondUnit + tally.unitOnly
console.log('\n变异 ' + MUTATIONS.length + ' 条 / 注入成功 ' + injected
  + ' / A/B 抓住（exit 1） ' + tally.abCaught
  + ' / A/B 前置门拦下（exit 2，另有 unit 抓住） ' + tally.precondUnit
  + (tally.unitOnly ? ' / 仅 unit 抓住（A/B 非 exit 2） ' + tally.unitOnly : '')
  + ' / 真漏网（A/B exit 0 且 unit 未红，或无 unit） ' + tally.silent
  + (tally.precondMiss ? ' / A/B exit 2 但 unit 未红 ' + tally.precondMiss : '')
  + ' / 崩溃或超时 ' + tally.broken
  + ' / 注入失败 ' + tally.injectFail
  + ' / 未抓住合计 ' + escaped
  + ' / 至少一门抓住 ' + caughtTotal)
process.exit(escaped ? 1 : 0)

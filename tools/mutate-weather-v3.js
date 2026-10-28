// 天气页 V3 变异自证：把判据打在真实实现上，每条变异都必须让对应断言观察到差异。
// 运行：node tools/mutate-weather-v3.js
//
// 做法：把 miniprogram/utils 复制到仓库外的临时目录，按**唯一锚点**改写其中一份，
// 再从临时目录 require 出变异体，与原始模块在同一输入下对照。
// 铁律（本仓 §16.9）：锚点命中数必须 == 1；命中 0 计漏网并 exit 1，不静默跳过。
// 每条变异先跑「未变异副本与原始模块一致」的有效性门，防止测试自己空转。
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const UTILS = path.join(ROOT, 'miniprogram', 'utils')
const TMP = path.join(os.tmpdir(), 'ourtrail-v3-mutate')
const TMP_UTILS = path.join(TMP, 'utils')

let passed = 0, failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; return }
  failed++
  console.log('  ✗ ' + name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra)))
}
function section(t) { console.log('\n§ ' + t) }

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true })
  fs.readdirSync(from, { withFileTypes: true }).forEach(d => {
    const a = path.join(from, d.name)
    const b = path.join(to, d.name)
    if (d.isDirectory()) copyDir(a, b)
    else fs.copyFileSync(a, b)
  })
}
function load(file) {
  const p = path.join(TMP_UTILS, file)
  delete require.cache[p]
  ;(require.cache[p] ? [] : []).forEach(() => {})
  return require(p)
}
function fresh() {
  // 依赖链上的模块也要一起清（weather-v3 会 require ./format）
  Object.keys(require.cache).forEach(k => { if (k.indexOf(TMP) === 0) delete require.cache[k] })
}
/** 只改一处；锚点命中数不为 1 直接计漏网 */
function mutate(file, from, to) {
  const p = path.join(TMP_UTILS, file)
  const src = fs.readFileSync(p, 'utf8')
  const hits = src.split(from).length - 1
  if (hits !== 1) return { ok: false, hits }
  fs.writeFileSync(p, src.replace(from, to), 'utf8')
  fresh()
  return { ok: true, hits }
}
function restore(file) {
  fs.copyFileSync(path.join(UTILS, file), path.join(TMP_UTILS, file))
  fresh()
}

copyDir(UTILS, TMP_UTILS)

/* ---------- 观测器（与变异无关的最小读数） ---------- */
function series(n, patchAt) {
  const out = []
  for (let i = 0; i < n; i++) {
    const d = '2026-10-29'
    out.push(Object.assign({
      t: (i % 24 < 10 ? '0' : '') + (i % 24) + ':00', d,
      temp: 4 + (i % 5), feels: 2, precip: 0.4, pop: 20, wind: 9, gust: 16, windDir: 225,
      cloud: { high: 50, mid: 60, low: 40 },
    }, patchAt && patchAt[i]))
  }
  return out
}
function hourlyObserve() {
  const H = load('weather-v3-hourly-svg.js')
  const paint = list => {
    list.forEach((h, i) => { h.cloud = { high: (i * 13) % 101, mid: 60, low: 40 } })
    return list
  }
  const clean = paint(series(24))
  const withGap = paint(series(24))
  for (let i = 8; i <= 11; i++) withGap[i] = Object.assign({}, withGap[i], { cloud: { high: null, mid: 20, low: 30 } })
  const a = H.buildHourlySvg({ series: clean, cursor: 0, period: 24 })
  const b = H.buildHourlySvg({ series: withGap, cursor: 0, period: 24 })
  const seg = b.svg.slice(b.svg.indexOf('data-seg="cloud-high"'), b.svg.indexOf('data-seg="cloud-mid"'))
  const bandOf = id => {
    const at = b.svg.indexOf('id="' + id + '"')
    return at < 0 ? '' : b.svg.slice(at, b.svg.indexOf('</linearGradient>', at))
  }
  const stopColors = Array.from(new Set((bandOf('cb-high-0').match(/stop-color="#[0-9a-f]{6}"/g) || [])
    .map(s => s.slice(12, 20))))
  return {
    width24: a.width,
    cloudDashes: (seg.match(/height="1\.5"/g) || []).length,
    /* 连续色带：缺 4 小时 ⇒ 高云断成 2 条；整条已知 ⇒ 1 条（不是 24 个色块） */
    cloudBands: (seg.match(/height="17"/g) || []).length,
    cloudStops: stopColors.length,
    /* 带内整数：8 个标注位去掉缺读数那一列 ⇒ 7 个；深底上应出现白字 */
    cloudNums: (seg.match(/<text [^>]*>[^<]*<\/text>/g) || []).length,
    cloudWhite: (seg.match(/fill="#ffffff"/g) || []).length,
    boundsMid: H.cloudBounds().mid,
  }
}
function readoutObserve() {
  const V3 = load('weather-v3.js')
  const r = V3.readoutOf({ t: '08:00', d: '2026-10-29' }, { name: 'x', altitude: null })
  const normal = [ { nodeIndex: 0, day: 1, time: '08:00' }, { nodeIndex: 1, day: 1, time: '13:00' } ]
  return { temp: r.temp, precip: r.precip, violationOnNormal: !!V3.planTimeViolation(normal) }
}
function skyObserve() {
  const V3 = load('weather-v3.js')
  const items = [
    { key: 'star', title: '星空', verdict: 'unknown', score: 0, text: '缺暗夜' },
    { key: 'galaxy', title: '银河', verdict: 'possible', score: 70, text: '有窗口' },
  ]
  const cards = V3.skyCards({ items })
  return { night: cards.filter(c => c.key === 'night')[0].verdict }
}

/* ---------- 基线 ---------- */
section('§0 有效性与基线（未变异副本必须与原始模块一致）')
const baseHourly = hourlyObserve()
const baseReadout = readoutObserve()
const baseSky = skyObserve()
{
  const OrigH = require(path.join(UTILS, 'weather-v3-hourly-svg.js'))
  const OrigV = require(path.join(UTILS, 'weather-v3.js'))
  check('基线读数非空且可区分（24h 一屏宽、4 条缺测横线、高云断成 2 条带、8 个色标、7 个带内整数 + 白字、缺值印 —）',
    baseHourly.width24 === OrigH.cellFor(350) * 24 && baseHourly.width24 <= 350 - OrigH.AXIS_W &&
    baseHourly.cloudDashes === 4 && baseHourly.cloudBands === 2 && baseHourly.cloudStops === 8 &&
    baseHourly.cloudNums === 7 && baseHourly.cloudWhite > 0 && baseHourly.boundsMid === '3–8km' &&
    baseReadout.temp === '—',
    baseHourly)
  check('副本缓存清理生效：原始模块与副本是两份实例（否则变异改不到被测对象）',
    OrigH !== require(path.join(TMP_UTILS, 'weather-v3-hourly-svg.js')), '')
  check('原始模块读数与副本一致（有效性门）',
    OrigH.buildHourlySvg({ series: series(24), cursor: 0, period: 24 }).width === baseHourly.width24 &&
    OrigV.readoutOf({ t: '08:00', d: '2026-10-29' }, { name: 'x', altitude: null }).temp === baseReadout.temp, '')
}

/* ---------- 变异 ---------- */
const cases = [
  {
    id: 'M1',
    title: '列宽退回固定 42（24h 一屏变回横向滚动）',
    file: 'weather-v3-hourly-svg.js',
    from: 'return Math.max(MIN_CELL, Math.floor(usable / FIT_HOURS * 100) / 100)',
    to: 'return 42',
    observe: hourlyObserve,
    base: baseHourly,
    differ: o => o.width24 !== baseHourly.width24,
    desc: o => '宽度变成 ' + o.width24,
  },
  {
    id: 'M2',
    title: '把云带缺值当 0%（缺测画成晴空）',
    file: 'weather-v3-hourly-svg.js',
    from: 'if (!fin(list[i])) { body += cloudGap(i * cell, Math.max(1, cell - 1), y); i += 1; continue }',
    to: 'if (false) { body += cloudGap(i * cell, Math.max(1, cell - 1), y); i += 1; continue }',
    observe: hourlyObserve,
    base: baseHourly,
    differ: o => o.cloudDashes !== 4 || o.cloudBands !== 2,
    desc: o => '缺测横线 ' + o.cloudDashes + ' / 色带段 ' + o.cloudBands,
  },
  {
    id: 'M6',
    title: '云量深浅失效（色带全用同一档，看不出多少）',
    file: 'weather-v3-hourly-svg.js',
    from: 'const t = Math.max(0, Math.min(100, cover)) / 100 * (RAMP.length - 1)',
    to: 'const t = 1',
    observe: hourlyObserve,
    base: baseHourly,
    differ: o => o.cloudStops !== baseHourly.cloudStops,
    desc: o => '一段里的不同色标 ' + o.cloudStops,
  },
  {
    id: 'M7',
    title: '退回逐格色块（相邻小时不再过渡，连续带变回网格）',
    file: 'weather-v3-hourly-svg.js',
    from: 'while (j + 1 < columns && fin(list[j + 1])) j += 1',
    to: 'while (false) j += 1',
    observe: hourlyObserve,
    base: baseHourly,
    differ: o => o.cloudBands !== baseHourly.cloudBands || o.cloudStops !== baseHourly.cloudStops,
    desc: o => '色带段 ' + o.cloudBands + ' / 色标 ' + o.cloudStops,
  },
  {
    id: 'M8',
    title: '带内整数退回「每 6 小时一个」（节奏与上面四段不一致）',
    file: 'weather-v3-hourly-svg.js',
    from: 'for (let i = 0; i < columns; i += LABEL_EVERY) {',
    to: 'for (let i = 0; i < columns; i += LABEL_EVERY * 2) {',
    observe: hourlyObserve,
    base: baseHourly,
    differ: o => o.cloudNums !== baseHourly.cloudNums,
    desc: o => '带内整数 ' + o.cloudNums,
  },
  {
    id: 'M9',
    title: '带内数字写死墨绿（深带上不再换白字，100% 的带读不出来）',
    file: 'weather-v3-hourly-svg.js',
    from: 'return onWhite >= onDark ? C.cloudNumLight : C.ink',
    to: 'return C.ink',
    observe: hourlyObserve,
    base: baseHourly,
    differ: o => o.cloudWhite !== baseHourly.cloudWhite,
    desc: o => '白字 ' + o.cloudWhite,
  },
  {
    id: 'M10',
    title: '中云高度区间被改成低云那档（三条轴行只说一个区间）',
    file: 'weather-v3-hourly-svg.js',
    from: 'mid: { min: 3, max: 8 },',
    to: 'mid: { min: 0, max: 3 },',
    observe: hourlyObserve,
    base: baseHourly,
    differ: o => o.boundsMid !== baseHourly.boundsMid,
    desc: o => '中云区间 ' + o.boundsMid,
  },
  {
    id: 'M3',
    title: '读数缺值补 0（凭空造出有利/不利事实）',
    file: 'weather-v3.js',
    from: "if (!Number.isFinite(v)) return '—'",
    to: "if (!Number.isFinite(v)) return '0'",
    observe: readoutObserve,
    base: baseReadout,
    differ: o => o.temp === '0' || o.precip === '0',
    desc: o => '缺值读数变成 ' + o.temp,
  },
  {
    id: 'M4',
    title: '同日逆序放行（计划允许时间倒流）',
    file: 'weather-v3.js',
    from: 'if (prev != null && m < prev) return { day: d, index: i }',
    to: 'if (prev != null && m > prev) return { day: d, index: i }',
    observe: readoutObserve,
    base: baseReadout,
    differ: o => o.violationOnNormal !== baseReadout.violationOnNormal,
    desc: o => '正常升序计划被误判 = ' + o.violationOnNormal,
  },
  {
    id: 'M5',
    title: '把 possible 压成 unknown（有戏说成判不出）',
    file: 'weather-v3.js',
    from: "if (list.some(it => verdictOf(it) === 'possible')) verdict = 'possible'",
    to: "if (false) verdict = 'possible'",
    observe: skyObserve,
    base: baseSky,
    differ: o => o.night !== 'possible',
    desc: o => '星空/银河合并结论 = ' + o.night,
  },
]

section('§1 变异必须被观察到（0 条漏网）')
cases.forEach(c => {
  const m = mutate(c.file, c.from, c.to)
  if (!m.ok) {
    failed++
    console.log('  ✗ ' + c.id + ' 注入失败：锚点命中 ' + m.hits + ' 次（应为 1）⇒ 计漏网')
    restore(c.file)
    return
  }
  const got = c.observe()
  check(c.id + ' ' + c.title, c.differ(got), { base: c.base, got, expect: c.desc(got) })
  restore(c.file)
})

section('§2 还原后逐项相同（变异没把状态留在临时目录）')
{
  check('还原后逐时图基线一致', JSON.stringify(hourlyObserve()) === JSON.stringify(baseHourly),
    { now: hourlyObserve(), base: baseHourly })
  check('还原后读数基线一致', JSON.stringify(readoutObserve()) === JSON.stringify(baseReadout),
    { now: readoutObserve(), base: baseReadout })
  check('还原后天相基线一致', JSON.stringify(skyObserve()) === JSON.stringify(baseSky), {})
}

console.log('\n' + (failed ? 'FAILED ' : 'OK ') + 'passed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
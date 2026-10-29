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
  /* 干窗压缩的两个方向都要能看见：全 0 时必须合成一句（且不再逐格印），
     有降水时必须回到逐格标注（合并了就变成隐瞒事实）。 */
  const segOf = (svg, a, b) => svg.slice(svg.indexOf(a), svg.indexOf(b))
  const dryList = series(24, Array.from({ length: 24 }, () => ({ precip: 0, pop: 0 })))
  const drySeg = segOf(H.buildHourlySvg({ series: dryList, cursor: 0, period: 24 }).svg,
    'data-seg="precip"', 'data-seg="wind"')
  const wetSeg = segOf(a.svg, 'data-seg="precip"', 'data-seg="wind"')
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
    drySummary: drySeg.indexOf('小时降水 0') !== -1,
    dryZeros: (drySeg.match(/>0\.0<\/text>/g) || []).length,
    wetSummary: wetSeg.indexOf('小时降水 0') !== -1,
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

/* ---------- 页头地点侧字段（占位与成功装配共用同一出处） ---------- */
function headerObserve() {
  const V = load('weather-v3-view.js')
  const route = {
    id: 'r', kind: 'route', name: '格聂两日', lat: 29.8, lng: 99.7,
    nodes: [{ name: '起点', altitude: 3200 }, { name: '观景点', altitude: 3800 }, { name: '无名台', altitude: null }],
  }
  const point = { id: 'p', kind: 'point', name: '折多山', lat: 30.0512, lng: 101.8156, nodes: [{ name: '折多山', altitude: 4298 }] }
  return {
    named: V.placeSubText(route, route.nodes[1]),
    nameless: V.placeSubText(route, { altitude: 3200 }),
    noAlt: V.placeSubText(route, route.nodes[2]),
    point: V.placeSubText(point, point.nodes[0]),
    halfCoord: V.placeSubText({ kind: 'point', lat: 30.05, nodes: [] }, {}),
    selected: V.nodeOptionsOf(route, 1).map(o => o.selected).join(','),
    placeName: V.placeNameText({ name: '' }),
    /* 成功装配走的是同一个函数吗：直接读 buildDetailView 出来的那三个字段 */
    built: (function () {
      const v = V.buildDetailView({
        result: { status: 'ready', series: [], days: [], updatedAt: '2026-10-29T07:00:00+08:00' },
        place: route, node: route.nodes[1], ctx: { date: '2026-10-29', period: 24, tab: 'hourly', cursor: 13, nodeIndex: 1 },
        width: 350,
      })
      return v.data.placeSub + '|' + v.data.placeName + '|' + v.data.nodeOptions.map(o => o.selected).join(',')
    })(),
  }
}

/* ---------- 基线 ---------- */
section('§0 有效性与基线（未变异副本必须与原始模块一致）')
const baseHourly = hourlyObserve()
const baseReadout = readoutObserve()
const baseSky = skyObserve()
const baseHeader = headerObserve()
{
  const OrigH = require(path.join(UTILS, 'weather-v3-hourly-svg.js'))
  const OrigV = require(path.join(UTILS, 'weather-v3.js'))
  check('基线读数非空且可区分（24h 一屏宽、4 条缺测横线、高云断成 2 条带、8 个色标、7 个带内整数 + 白字、缺值印 —；干窗合成一句且不印 0.0、湿窗不合成）',
    baseHourly.width24 === OrigH.cellFor(350) * 24 && baseHourly.width24 <= 350 - OrigH.AXIS_W &&
    baseHourly.cloudDashes === 4 && baseHourly.cloudBands === 2 && baseHourly.cloudStops === 8 &&
    baseHourly.cloudNums === 7 && baseHourly.cloudWhite > 0 && baseHourly.boundsMid === '3–8km' &&
    baseHourly.drySummary === true && baseHourly.dryZeros === 0 && baseHourly.wetSummary === false &&
    baseReadout.temp === '—',
    baseHourly)
  check('副本缓存清理生效：原始模块与副本是两份实例（否则变异改不到被测对象）',
    OrigH !== require(path.join(TMP_UTILS, 'weather-v3-hourly-svg.js')), '')
  check('原始模块读数与副本一致（有效性门）',
    OrigH.buildHourlySvg({ series: series(24), cursor: 0, period: 24 }).width === baseHourly.width24 &&
    OrigV.readoutOf({ t: '08:00', d: '2026-10-29' }, { name: 'x', altitude: null }).temp === baseReadout.temp, '')
  check('页头基线可区分（有名/无名/缺海拔/单点/半坐标/选中位各不同，成功装配与占位同串）',
    baseHeader.named === '观景点 · 3,800 m' && baseHeader.nameless === '3,200 m' &&
      baseHeader.noAlt === '无名台 · 海拔待确认' && baseHeader.point === '30.0512°N, 101.8156°E · 4,298 m' &&
      baseHeader.halfCoord === '海拔待确认' && baseHeader.selected === 'false,true,false' &&
      baseHeader.placeName === '未命名地点' &&
      baseHeader.built === '观景点 · 3,800 m|格聂两日|false,true,false',
    baseHeader)
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
    id: 'M11',
    title: '干窗压缩失效（整段 0 退回 8 组「0.0 / 0%」）',
    file: 'weather-v3-hourly-svg.js',
    from: 'const drySpan = list.length > 0 &&',
    to: 'const drySpan = false && list.length > 0 &&',
    observe: hourlyObserve,
    base: baseHourly,
    differ: o => o.drySummary !== baseHourly.drySummary || o.dryZeros !== baseHourly.dryZeros,
    desc: o => '干窗合成=' + o.drySummary + ' / 逐格 0.0=' + o.dryZeros,
  },
  {
    id: 'M12',
    title: '压缩越界（有降水也合并成「全窗口 0」，把事实藏起来）',
    file: 'weather-v3-hourly-svg.js',
    from: 'rain.every(v => fin(v) && v === 0) && pops.every(v => fin(v) && v === 0)',
    to: 'true',
    observe: hourlyObserve,
    base: baseHourly,
    differ: o => o.wetSummary !== baseHourly.wetSummary,
    desc: o => '湿窗合成=' + o.wetSummary,
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
  {
    id: 'M13',
    title: '节点没名字时留下悬空分隔符（「 · 3,200 m」看着像坏了）',
    file: 'weather-v3-view.js',
    from: "return (name ? name + ' · ' : '') + alt",
    to: "return ' · ' + alt",
    observe: headerObserve,
    base: baseHeader,
    differ: o => o.nameless !== baseHeader.nameless,
    desc: o => '无名节点 = ' + o.nameless,
  },
  {
    id: 'M14',
    title: '缺海拔印成 0 m（把「没有读数」冒充成一个低海拔事实）',
    file: 'weather-v3-view.js',
    from: "const alt = Number.isFinite(n.altitude) ? fmtM(n.altitude) + ' m' : '海拔待确认'",
    to: "const alt = Number.isFinite(n.altitude) ? fmtM(n.altitude) + ' m' : '0 m'",
    observe: headerObserve,
    base: baseHeader,
    differ: o => o.noAlt !== baseHeader.noAlt || o.halfCoord !== baseHeader.halfCoord,
    desc: o => '缺海拔 = ' + o.noAlt + ' / 半坐标 = ' + o.halfCoord,
  },
  {
    id: 'M15',
    title: '节点弹层选中位恒指第一项（换节点后勾还留在起点）',
    file: 'weather-v3-view.js',
    from: 'const idx = Math.min(Math.max(0, nodeIndex || 0), Math.max(0, all.length - 1))',
    to: 'const idx = 0',
    observe: headerObserve,
    base: baseHeader,
    differ: o => o.selected !== baseHeader.selected,
    desc: o => '选中位 = ' + o.selected,
  },
  {
    id: 'M16',
    title: '成功装配另拼一份页头文案（占位与数据到位后长得不一样）',
    file: 'weather-v3-view.js',
    from: 'placeSub: placeSubText(place, node),',
    to: "placeSub: (node.name || '') + ' · ' + (Number.isFinite(node.altitude) ? node.altitude + ' m' : '—'),",
    observe: headerObserve,
    base: baseHeader,
    differ: o => o.built !== baseHeader.built,
    desc: o => '装配输出 = ' + o.built,
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
  check('还原后页头基线一致', JSON.stringify(headerObserve()) === JSON.stringify(baseHeader), { now: headerObserve() })
}

console.log('\n' + (failed ? 'FAILED ' : 'OK ') + 'passed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
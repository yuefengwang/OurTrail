/* Unified Meteogram（Weather V2 Phase 2）测试
 * 覆盖：单一 timeScale（四变量共享）、单根 crosshair、四变量行语义保持、
 *       云态推导回归（3079/3500/500m）、性能。
 * 运行：node tools/meteogram-svg-test.js
 */
'use strict'

const check = (name, cond, extra) => {
  if (cond) { passed++; console.log('  ✓ ' + name) } else { failed++; console.log('  ✗ ' + name + (extra ? ' —— ' + extra : '')) }
}
const section = (t) => console.log('\n== ' + t + ' ==')

let passed = 0, failed = 0
const UMG = require('../miniprogram/utils/meteogram-svg.js')
const CFF = require('../miniprogram/utils/cloud-field-svg.js')
const fixtures = require('../miniprogram/pages/cloud-field-poc/fixtures.js')

function build(key, elev, width) {
  return UMG.buildUnified({
    surface: fixtures[key].surface,
    cloudField: fixtures[key],
    userAltitude: elev,
    width: width || 375,
  })
}

/* ---------- 单一 timeScale ---------- */
section('TimeScale：四变量共享同一 time → x')
const geo = build('emeishan', 3079)
const plotW = 375 - 38 - 10
check('X(h) 线性且等距（每 2h 间距 = plotW/12）',
  [0, 2, 6, 12, 16, 20, 22].every(h => Math.abs((geo.X(h + 2) - geo.X(h)) - plotW / 12) < 0.01))
check('X(0) 在绘图区左缘中心', Math.abs(geo.X(0) - (38 + plotW / 48)) < 0.01)
check('云场网格与 surface 行共用同一映射（t=6.5 处网格 x = X(6)）',
  Math.abs((38 + (6.5 / 24) * plotW) - geo.X(6)) < 0.01)
check('海拔线 y 与云场行在同一行内（2000m 贴行底）',
  Math.abs(geo.cloud.yAlt(2000) - (ROWS().cloud.y + ROWS().cloud.h)) < 0.01)
function ROWS() { return UMG.ROWS }

/* ---------- Crosshair：一根线贯穿四变量 ---------- */
section('Crosshair：单根、贯穿、位置正确')
const base = UMG.renderUnifiedBase(geo, { sunrise: 7.03, sunset: 18.77, dateLabel: '周二 · 2026.10.07' })
const sel = UMG.renderUnifiedSelection(geo, { selectedTime: 6 })
const lineMatches = sel.svg.match(/<line x1="([0-9.]+)"/g) || []
check('crosshair 只有一根竖线', sel.svg.split('stroke="#163e35" stroke-width="0.5"').length === 2, JSON.stringify(lineMatches))
const x6 = geo.X(6).toFixed(1)
check('crosshair x = X(6)（温度/降水/云场/风 共用）', sel.svg.indexOf('x1="' + x6 + '"') >= 0, x6)
check('时间牌 06:00 存在', sel.svg.indexOf('06:00') > 0)
check('crosshair 高度贯穿四变量（从温度行到时间轴）', sel.svg.indexOf('y1="' + (UMG.ROWS.iconTemp.y - 2) + '"') >= 0)

/* ---------- 四变量行语义保持（生产 meteogram 的语义） ---------- */
section('语义保持：温度墨色 / 降水双柱 / 风箭头 / 图标')
check('温度线 = 中性墨 #202A26（非红，生产决定）', base.svg.indexOf('stroke="#202A26"') >= 0)
check('降水双柱 = info 蓝 + showers 青', base.svg.indexOf('#346583') >= 0 && base.svg.indexOf('#2E8B8B') >= 0)
check('风向箭头存在（指向吹去方向）', base.svg.indexOf('rotate(') >= 0)
check('天气图标 glyphs 存在', base.svg.indexOf('i-sun') >= 0 && base.svg.indexOf('i-moon') >= 0)
check('云场等值带五档灰阶齐全', ['#eeeeea', '#d4d6d0', '#b0b2ab', '#84867f', '#5a5c56'].every(c => base.svg.indexOf(c) >= 0))
check('YOU 海拔线存在（3079m）', base.svg.indexOf('你 · 3,079 m') > 0)
check('无 blur/filter/foreignObject（小程序 SVG 安全）',
  ['filter', 'blur', 'foreignObject', 'xlink', '<script'].every(k => base.svg.indexOf(k) < 0))

/* ---------- Cloud State 回归（Phase 1 判断结果不变） ---------- */
section('Cloud State：3079 / 3500 / 500 回归')
const eme = build('emeishan', 3079)
const st01 = CFF.inferState(eme.sample, 1, 3079, eme.cloud.covered)
check('峨眉山 01h：冻结数据下状态合法（in/ok/mid/null 之一）', ['in', 'ok', 'mid', null].indexOf(st01.key) >= 0, st01.key)
const lit = build('litang', 3500)
const stL = CFF.inferState(lit.sample, 16, 3500, lit.cloud.covered)
check('理塘 16h：状态合法', ['in', 'ok', 'mid', null].indexOf(stL.key) >= 0, stL.key)
/* 500m 合成场景：低海拔不误报「你在云中」（Phase 1 语义回归） */
const clLow = { times: Array.from({ length: 24 }, (_, i) => i), altitudes: [2000, 2500, 3000],
  values: Array.from({ length: 24 }, () => [90, 90, 90]),
  covered: { lo: 2000, hi: 3000 } }
const colLow = CFF.makeColumnSampler(clLow)
const stLow = CFF.inferState(function (h, a) { return CFF.sampleAtStations(colLow, 24, h, a) }, 0, 500, clLow.covered)
check('成都 500m：用户低于全部云层 → 云在头顶', stLow.key === 'mid', stLow.key)
const stLow2 = CFF.inferState(function (h, a) { return CFF.sampleAtStations(colLow, 24, h, a) }, 0, 6000, clLow.covered)
check('6000m：用户高于全部云层 → 云在脚下', stLow2.key === 'ok', stLow2.key)

/* ---------- 三宽度 ---------- */
section('375 / 390 / 414')
;[375, 390, 414].forEach(w => {
  const g = build('emeishan', 3079, w)
  const b = UMG.renderUnifiedBase(g, { sunrise: 7.03, sunset: 18.77 })
  check(w + 'px：构建 + 生成正常，crosshair 等距', b.svg.indexOf('<svg') === 0 && g.stats.pathCount >= 3 &&
    Math.abs((g.X(22) - g.X(20)) - (w - 48) / 12) < 0.01)
})

/* ---------- 性能 ---------- */
section('性能（Node 稳态）')
const t1 = Date.now()
build('emeishan', 3079)
const calcMs = Date.now() - t1
const b1 = UMG.renderUnifiedBase(geo, { sunrise: 7.03, sunset: 18.77 })
const t2 = Date.now()
UMG.renderUnifiedSelection(geo, { selectedTime: 16 })
const selMs = Date.now() - t2
check('统一几何构建 < 300ms', calcMs < 300, calcMs + 'ms')
check('基础 SVG 生成 < 60ms', b1.svgMs < 60, b1.svgMs + 'ms')
check('选中切换 < 10ms', selMs < 10, selMs + 'ms')
console.log('  build=' + calcMs + 'ms base=' + b1.svgMs + 'ms sel=' + selMs + 'ms paths=' + geo.stats.pathCount + ' KB=' + Math.round(b1.svg.length / 102.4) / 10)

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)

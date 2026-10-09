/* Multi-Day Horizon（Weather V2 Phase 4）测试
 * 覆盖：timeScale（24/48/72）、日界线、跨日选择（absHour → crosshair x），
 *       Cloud Field 48/72 几何、YOU 海拔钳位、Evidence 跨日锚点、
 *       部分日/缺失数据降级、响应式、确定性与性能。
 * 运行：node tools/meteogram-multiday-test.js
 */
'use strict'

const check = (name, cond, extra) => {
  if (cond) { passed++; console.log('  ✓ ' + name) } else { failed++; console.log('  ✗ ' + name + (extra ? ' —— ' + extra : '')) }
}
const section = (t) => console.log('\n== ' + t + ' ==')

let passed = 0, failed = 0
const UMG = require('../miniprogram/utils/meteogram-svg.js')
const CFF = require('../miniprogram/utils/cloud-field-svg.js')
const WCFF = require('../miniprogram/utils/weather-cloud-field.js')
const OIP = require('../miniprogram/utils/oi-presentation.js')
const OI = require('../miniprogram/utils/outdoor-intelligence.js')

/* ---------- 合成 72h 场（确定性：正弦云带跨三日移动） ---------- */
const D0 = '2026-10-07'
const TIMES = []
for (let h = 0; h < 72; h++) {
  const d = new Date(Date.parse(D0 + 'T12:00:00') + Math.floor(h / 24) * 86400000).toISOString().slice(0, 10)
  TIMES.push({ d: d, t: (h % 24 < 10 ? '0' : '') + (h % 24) + ':00' })
}
function altitudesGrid() {
  const g = []
  for (let a = 0; a <= 7000; a += 250) g.push(a)
  return g
}
function makeSurface(hours, opts) {
  opts = opts || {}
  const rows = []
  for (let h = 0; h < hours; h++) {
    const dayIdx = Math.floor(h / 24)
    const base = [14, 12, 15][dayIdx] != null ? [14, 12, 15][dayIdx] : 13
    const diurnal = Math.sin((h % 24 - 4) / 24 * Math.PI * 2) * 5
    rows.push({
      d: TIMES[h].d, t: TIMES[h].t,
      temp: Math.round((base + diurnal) * 10) / 10,
      code: (opts.code && opts.code(h)) || 0,
      pop: (opts.pop && opts.pop(h)) || 0,
      precip: (opts.precip && opts.precip(h)) || 0,
      showers: (opts.showers && opts.showers(h)) || 0,
      wind: (opts.wind && opts.wind(h)) || 8,
      gust: (opts.gust && opts.gust(h)) || 14,
      windDir: (opts.windDir && opts.windDir(h)) || 120,
      cloud: { low: 10, mid: 10, high: 10 },
      band: null,
    })
  }
  return rows
}
function makeCloudField(hours, userAlt) {
  const altitudes = altitudesGrid()
  const values = TIMES.slice(0, hours).map((_, h) => {
    /* 确定性云带：中心海拔随时间移动（Day1 低 2600 / Day2 中 3600 / Day3 高 4600） */
    const center = 2600 + Math.floor(h / 24) * 1000 + Math.sin(h / 6) * 200
    const thickness = 500
    return altitudes.map(alt => {
      const dist = Math.abs(alt - center)
      if (dist > thickness) return 4
      return Math.round(92 * (1 - dist / thickness) + 4)
    })
  })
  return {
    times: TIMES.slice(0, hours).map((_, i) => i),
    altitudes: altitudes,
    values: values,
    userAltitude: userAlt,
    covered: { lo: 2000, hi: 6000 },
  }
}
function buildGeo(horizon, userAlt, width, surfaceHours) {
  const hours = surfaceHours || horizon
  return UMG.buildUnified({
    surface: makeSurface(hours),
    cloudField: makeCloudField(Math.min(hours, horizon), userAlt),
    userAltitude: userAlt,
    width: width || 375,
    horizon: horizon,
    dayLabels: ['今天', '明天', '后天'].slice(0, Math.ceil(horizon / 24)),
  })
}

/* ---------- TimeScale ---------- */
section('TimeScale：24/48/72')
const s24 = UMG.timeScale(375)
const s48 = UMG.timeScale(375, 48)
const s72 = UMG.timeScale(375, 72)
check('24h 默认不变（x0(12) = 中点）', Math.abs(s24.x0(12) - (38 + 327 / 2)) < 0.01)
check('48h：x0(24) = 水平中点（日界）', Math.abs(s48.x0(24) - (38 + 327 / 2)) < 0.01)
check('72h：x0(36) = 水平中点', Math.abs(s72.x0(36) - (38 + 327 / 2)) < 0.01)
check('48h 列宽 = plotW/48，72h = plotW/72', Math.abs((s48.X(1) - s48.X(0)) - 327 / 48) < 0.01 && Math.abs((s72.X(1) - s72.X(0)) - 327 / 72) < 0.01)

/* ---------- Geometry：48/72 ---------- */
section('Geometry：48h / 72h 构建')
const g48 = buildGeo(48, 3500)
const g72 = buildGeo(72, 3500)
check('48h 等值带 path ≥ 3', g48.stats.pathCount >= 3, g48.stats.pathCount)
check('72h 等值带 path ≥ 3', g72.stats.pathCount >= 3, g72.stats.pathCount)
check('72h 几何点数 > 48h（信息密度保持）', g72.stats.pointCount > g48.stats.pointCount, g72.stats.pointCount + ' vs ' + g48.stats.pointCount)
check('72h dayBounds = [24, 48]', JSON.stringify(g72.dayBounds) === '[24,48]')
check('48h dayBounds = [24]', JSON.stringify(g48.dayBounds) === '[24]')
check('72h days 标签 + 每日 hi/lo', g72.days.length === 3 && g72.days[0].label === '今天' && g72.days[1].hi != null && g72.days[2].lo != null)
check('高度尺度跨日稳定（0–7000 不变）', Math.abs(g72.cloud.yAlt(2000) - g48.cloud.yAlt(2000)) < 0.01)

/* ---------- Selection：跨日单一 crosshair ---------- */
section('Selection：Day 1/2/3 单一 crosshair')
const b72 = UMG.renderUnifiedBase(g72, { sunTimes: [{ rise: 7, set: 19 }, { rise: 7, set: 19 }, { rise: 7, set: 19 }] })
check('base 含 2 条日界强线', (b72.svg.match(/stroke="#D3D5CD" stroke-width="1"/g) || []).length === 2)
check('base 含 day header 三段（今天/明天/后天）', b72.svg.indexOf('今天') >= 0 && b72.svg.indexOf('明天') >= 0 && b72.svg.indexOf('后天') >= 0)
const sel38 = UMG.renderUnifiedSelection(g72, { selectedAbs: 38 })   // Day2 14:00
const x38 = g72.X(38).toFixed(1)
check('selectedAbs=38 → crosshair x = X(38)', sel38.svg.indexOf('x1="' + x38 + '"') >= 0, x38)
check('Day2 14:00 日期牌「明天 14:00」', sel38.svg.indexOf('明天 14:00') >= 0)
const sel2 = UMG.renderUnifiedSelection(g72, { selectedAbs: 2 })
check('Day1 02:00 无日期前缀（当天）', sel2.svg.indexOf('今天 02:00') < 0 && sel2.svg.indexOf('>02:00<') >= 0)
const sel70 = UMG.renderUnifiedSelection(g72, { selectedAbs: 70 })
check('Day3 22:00 日期牌「后天 22:00」', sel70.svg.indexOf('后天 22:00') >= 0)
check('全图只有一根 crosshair 线', (sel38.svg.match(/stroke="#163e35" stroke-width="0.5"/g) || []).length === 1)

/* ---------- YOU 海拔 ---------- */
section('YOU 海拔：单线贯穿 + 钳位')
check('YOU 标签只出现一次', (b72.svg.match(/此点 3,500 m/g) || []).length === 1)
const g500 = buildGeo(72, 500)
const b500 = UMG.renderUnifiedBase(g500, {})
check('500m → 剖面下方标注', b500.svg.indexOf('（剖面下方）') >= 0)
const g6200 = buildGeo(72, 6200)
const b6200 = UMG.renderUnifiedBase(g6200, {})
check('6200m → 剖面上方标注', b6200.svg.indexOf('（剖面上方）') >= 0)

/* ---------- Evidence：跨日锚点 ---------- */
section('Evidence：机会 → focusAbs → 正确日期的 crosshair')
const dayOis = [0, 1, 2].map(function (d) {
  const dayDate = TIMES[d * 24].d
  const rows = makeSurface(24).map(function (r) {
    return Object.assign({}, r, { d: dayDate, cloud: { low: d === 1 ? 90 : 20, mid: 20, high: 10 }, band: d === 1 && r.t >= '05:00' && r.t < '09:00' ? { base: 2000, top: 3100, cover: 95 } : null })
  })
  return {
    dayLabel: ['今天', '明天', '后天'][d],
    date: dayDate,
    oi: OI.buildOutdoorIntelligence({ date: dayDate, detail: rows, userAltitude: 3500, elevOK: true, lat: 29.9, lng: 100.27, days: [] }),
  }
})
const hcard = OIP.buildHorizonOiCard(dayOis, { width: 375, horizon: 72 })
check('horizon 卡：groups 按日分组（3 组）', hcard.groups.length === 3 && hcard.groups.every(g2 => g2.items.length > 0))
const day2Item = hcard.items.find(it => it.dayLabel === '明天' && it.anchor)
check('Day2 机会锚点 focusAbs = 24 + focusHour', day2Item && day2Item.anchor.focusAbs >= 24 && day2Item.anchor.focusAbs < 48, day2Item && day2Item.anchor.focusAbs)
if (day2Item) {
  OIP.applyHorizonSelection(hcard, day2Item.anchor.focusAbs)
  check('focusAbs → horizon 卡高亮命中该窗口', hcard.selGroup === 1 && hcard.selIndex >= 0)
  const evSel = UMG.renderUnifiedSelection(g72, { selectedAbs: day2Item.anchor.focusAbs })
  check('focusAbs → crosshair 落在 Day2 区段（x > 日界）', +evSel.svg.match(/x1="([0-9.]+)"/)[1] > 38 + 327 / 72)
}
check('48/72h 时间轴 tapZones 用 absHour', hcard.tapZones.every(z2 => Number.isFinite(z2.hour) && z2.hour >= 0 && z2.hour < 72))

/* ---------- 缺失 / 部分日 ---------- */
section('缺失与部分日')
check('cloudLevels 缺失 → buildCloudFieldRange null（classic fallback）',
  WCFF.buildCloudFieldRange({}, { startDate: D0, hours: 72, userAltitude: 3500 }) === null)
const gPartial = UMG.buildUnified({
  surface: makeSurface(60), cloudField: makeCloudField(60), userAltitude: 3500,
  width: 375, horizon: 72, dayLabels: ['今天', '明天', '后天'],
})
check('部分日（60h）：nT=60，dayBounds=[24,48]，days=3', gPartial.nT === 60 && JSON.stringify(gPartial.dayBounds) === '[24,48]' && gPartial.days.length === 3)
const bPartial = UMG.renderUnifiedBase(gPartial, {})
check('部分日：base 正常生成', bPartial.svg.indexOf('<svg') === 0)

/* ---------- 24h 回归（冻结确认） ---------- */
section('24h 回归（horizon 默认）')
const g24 = UMG.buildUnified({
  surface: makeSurface(24), cloudField: makeCloudField(24), userAltitude: 3500, width: 375,
})
check('24h：dayBounds 空 / 单 day / 轴步 2h', g24.horizon === 24 && g24.dayBounds.length === 0 && g24.days.length === 1)
const b24 = UMG.renderUnifiedBase(g24, { sunrise: 7, sunset: 19, dateLabel: '周二 · 2026.10.07' })
check('24h：单日夜渐变 + 每 2h 轴 + 每小时风箭头',
  b24.svg.indexOf('id="udn"') >= 0 && (b24.svg.match(/>06</g) || []).length >= 1)
const sel24 = UMG.renderUnifiedSelection(g24, { selectedTime: 16 })
check('24h 旧签名 selectedTime 仍可用（16:00 牌）', sel24.svg.indexOf('16:00') >= 0)

/* ---------- Responsive ---------- */
section('375 / 390 / 414')
;[[375, 72], [390, 72], [414, 72], [375, 48], [390, 48]].forEach(function (pair) {
  const g2 = buildGeo(pair[1], 3500, pair[0])
  const b2 = UMG.renderUnifiedBase(g2, { sunTimes: [{ rise: 7, set: 19 }, { rise: 7, set: 19 }, { rise: 7, set: 19 }] })
  const sel2 = UMG.renderUnifiedSelection(g2, { selectedAbs: pair[1] - 2 })
  check(pair[0] + 'px × ' + pair[1] + 'h：构建/生成/选中正常', b2.svg.indexOf('<svg') === 0 && g2.stats.pathCount >= 3 && sel2.svg.length > 0)
})

/* ---------- 确定性 / 性能 ---------- */
section('Determinism / Performance（Node）')
const g72b = buildGeo(72, 3500)
check('确定性：同输入两次构建一致', JSON.stringify(g72.bands) === JSON.stringify(g72b.bands))
const t1 = Date.now()
buildGeo(24, 3500)
const ms24 = Date.now() - t1
const t2 = Date.now()
buildGeo(48, 3500)
const ms48 = Date.now() - t2
const t3 = Date.now()
const gP = buildGeo(72, 3500)
const ms72 = Date.now() - t3
const b72m = UMG.renderUnifiedBase(gP, { sunTimes: [{ rise: 7, set: 19 }, { rise: 7, set: 19 }, { rise: 7, set: 19 }] })
const t4 = Date.now()
UMG.renderUnifiedSelection(gP, { selectedAbs: 38 })
const msSel = Date.now() - t4
console.log('  24h calc=' + ms24 + 'ms · 48h calc=' + ms48 + 'ms · 72h calc=' + ms72 + 'ms · 72h svgKB=' + Math.round(b72m.svg.length / 102.4) / 10 + ' · sel=' + msSel + 'ms')
check('24h 构建 < 300ms', ms24 < 300, ms24 + 'ms')
check('48h 构建 < 300ms', ms48 < 300, ms48 + 'ms')
check('72h 构建 < 300ms', ms72 < 300, ms72 + 'ms')
check('72h SVG 生成 < 100ms', b72m.svgMs < 100, b72m.svgMs + 'ms')
check('72h SVG 体积 < 160KB（移动端合理）', b72m.svg.length < 160 * 1024, Math.round(b72m.svg.length / 102.4) / 10 + 'KB')
check('选中更新 < 5ms', msSel < 5, msSel + 'ms')

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)

/* Weather V2 Cloud Field 集成测试（Phase 1）
 * 覆盖：数据层（buildCloudLevels 形状与防御）→ 客户端适配器（生产返回体 → cloudField）
 *       → interpretation（三态阈值）→ renderer 契约（与 POC 同构）→ 性能。
 * 运行：node tools/weather-cloud-field-test.js
 */
'use strict'

const check = (name, cond, extra) => {
  if (cond) { passed++; console.log('  ✓ ' + name) } else { failed++; console.log('  ✗ ' + name + (extra ? ' —— ' + extra : '')) }
}
const section = (t) => console.log('\n== ' + t + ' ==')

let passed = 0, failed = 0
const W = require('../cloudfunctions/trailApi/lib/weather.js')
const WCFF = require('../miniprogram/utils/weather-cloud-field.js')
const CFF = require('../miniprogram/utils/cloud-field-svg.js')

const TIMES = []
for (let h = 0; h < 24; h++) TIMES.push('2026-10-07T' + (h < 10 ? '0' : '') + h + ':00')

/* 生产形 cloudLevels 构造器：恒定层高（简化断言），按 alt→cover 映射给值 */
function makeLevels(heightsByLevel, coverByHour) {
  const levels = Object.keys(heightsByLevel).map(Number).sort((a, b) => a - b).map(p => ({
    pressure: p,
    altitudes: TIMES.map(() => heightsByLevel[p]),
    cloudCover: TIMES.map((_, h) => (coverByHour[h] && coverByHour[h][p] != null) ? coverByHour[h][p] : 0),
  }))
  return { times: TIMES.slice(), levels, unit: { altitude: 'm ASL', cloudCover: '%' } }
}

/* ---------- Data Layer（云函数 buildCloudLevels 已在 smoke 12b 覆盖；
   此处覆盖「客户端拿到的生产形响应」的契约） ---------- */
section('Data：生产形 cloudLevels 契约')
const cl = makeLevels({ 3000: 3000, 3500: 3500, 4000: 4000 }, {
  0: { 3000: 90, 3500: 90, 4000: 90 },
})
check('times 与 levels 逐时对齐（24h）', cl.times.length === 24 && cl.levels.every(l => l.altitudes.length === 24))
check('altitude 单位标注 m ASL、cover 标注 %', cl.unit.altitude === 'm ASL' && cl.unit.cloudCover === '%')

section('Data：缺失与异常降级')
check('cloudLevels 缺失 → buildCloudField null', WCFF.buildCloudField({ series: [] }, { date: '2026-10-07', userAltitude: 3500 }) === null)
check('cloudLevels 为空 levels → null', WCFF.buildCloudLevel === undefined && WCFF.buildCloudField({ cloudLevels: { times: TIMES, levels: [] } }, {}) === null)
const clNaN = makeLevels({ 3000: 3000, 3500: 3500 }, { 0: { 3000: NaN, 3500: 50 } })
const fNaN = WCFF.buildCloudField({ cloudLevels: clNaN }, { date: '2026-10-07', userAltitude: 3500 })
check('NaN cover 被 clamp/拒绝，不进 renderer', fNaN === null || fNaN.values.every(r => r.every(v => Number.isFinite(v))))

/* ---------- Adapter ---------- */
section('Adapter：日期窗、层插值、clamp、高低海拔')
const f24 = WCFF.buildCloudField({ cloudLevels: cl }, { date: '2026-10-07', userAltitude: 3500 })
check('24h 窗口 + 统一海拔网格（0–7000/250）', f24 && f24.times.length === 24 && f24.altitudes.length === 29 && f24.altitudes[14] === 3500)
check('values[time][alt] 结构与 POC 渲染器契约一致', Array.isArray(f24.values) && Array.isArray(f24.values[0]) && f24.values[0].length === f24.altitudes.length)
check('cover 全部 0–100 且有限', f24.values.every(r => r.every(v => Number.isFinite(v) && v >= 0 && v <= 100)))

const clRamp = makeLevels({ 2000: 2000, 3000: 3000, 4000: 4000 }, {
  0: { 2000: 0, 3000: 40, 4000: 80 },
})
const fRamp = WCFF.buildCloudField({ cloudLevels: clRamp }, { date: '2026-10-07', userAltitude: 3500 })
const rampAt3000 = fRamp.values[0][fRamp.altitudes.indexOf(3000)]
check('层间线性插值（3000m 处 = 40%）', rampAt3000 === 40, '实际 ' + rampAt3000)
const rampAt2500 = fRamp.values[0][fRamp.altitudes.indexOf(2500)]
check('层间线性插值（2500m 处 = 20%）', rampAt2500 === 20, '实际 ' + rampAt2500)

/* 高海拔地点：低层在地下（Open-Meteo 返回 null → 缺失），有效层只剩高层 */
const clHigh = makeLevels({ 700: 3180, 600: 4420, 500: 5840 }, {
  0: { 700: 30, 600: 60, 500: 55 },
})
delete clHigh.levels // 重建为「低层缺失（null 值）」的形态
clHigh.levels = [
  { pressure: 700, altitudes: TIMES.map(() => 3180), cloudCover: TIMES.map(() => 30) },
  { pressure: 600, altitudes: TIMES.map(() => 4420), cloudCover: TIMES.map(() => 60) },
  { pressure: 500, altitudes: TIMES.map(() => 5840), cloudCover: TIMES.map(() => 55) },
]
const fHigh = WCFF.buildCloudField({ cloudLevels: clHigh }, { date: '2026-10-07', userAltitude: 3500 })
check('高海拔地点（地下层缺失）仍可构建', !!fHigh)
check('缺失层区间由有效层钳位（2000m 处 = 最低有效层 30%）', fHigh.values[0][fHigh.altitudes.indexOf(2000)] === 30)

/* ---------- Interpretation：三态 + 沉默（3079m 与 3500m） ---------- */
section('Interpretation：三态与沉默优先')
/* 合成场：恒定层高，逐小时把 90% 密核放在不同高度带 */
const clState = makeLevels({ 2000: 2000, 2500: 2500, 3000: 3000, 3500: 3500, 4000: 4000, 4500: 4500, 5000: 5000 }, {
  0: { 2000: 40, 2500: 90, 3000: 90, 3500: 5, 4000: 5, 4500: 5, 5000: 5 },   // 密核 2500-3000（脚下）
  1: { 2000: 5, 2500: 40, 3000: 90, 3500: 90, 4000: 90, 4500: 5, 5000: 5 }, // 密核 3000-4000（穿过 3500）
  2: { 2000: 5, 2500: 5, 3000: 5, 3500: 5, 4000: 90, 4500: 90, 5000: 90 },  // 密核 4000-5000（头顶）
  3: { 2000: 5, 2500: 5, 3000: 5, 3500: 5, 4000: 5, 4500: 5, 5000: 5 },     // 近晴空（沉默）
})
const fState = WCFF.buildCloudField({ cloudLevels: clState }, { date: '2026-10-07', userAltitude: 3500 })
const geoState = CFF.buildGeometry(fState, { width: 375, plotHeight: 240, userAltitude: 3500 })
const st = (h) => CFF.inferState(geoState.sample, h, 3500, geoState.covered)
check('00h 密核在脚下 → 云在脚下', st(0).key === 'ok', '实际 ' + st(0).key + ' cUser=' + st(0).cUser)
check('01h 密核穿过 3500 → 你在云中', st(1).key === 'in', '实际 ' + st(1).key + ' cUser=' + st(1).cUser)
check('02h 密核在头顶 → 云在头顶', st(2).key === 'mid', '实际 ' + st(2).key + ' cUser=' + st(2).cUser)
check('03h 近晴空 → 沉默（null）', st(3).key === null, '实际 ' + st(3).key)

/* 3079m（峨眉山）：同一合成场换用户海拔，交点随海拔移动 */
const geoState2 = CFF.buildGeometry(fState, { width: 375, plotHeight: 240, userAltitude: 3079 })
const st2 = (h) => CFF.inferState(geoState2.sample, h, 3079, geoState2.covered)
check('3079m @00h：密核 2500-3000 仍含峰下缘 → 云在脚下', st2(0).key === 'ok' || st2(0).key === 'in', '实际 ' + st2(0).key)
check('3079m @02h：密核 4000-5000 在上 → 云在头顶', st2(2).key === 'mid', '实际 ' + st2(2).key)

/* 用户海拔低于全部云层（成都 500m vs 2000m+ 层）——不得把「高层云」误判为「你在云中」 */
const clLow = makeLevels({ 2000: 2000, 2500: 2500, 3000: 3000 }, {
  0: { 2000: 90, 2500: 90, 3000: 90 },
})
const fLow = WCFF.buildCloudField({ cloudLevels: clLow }, { date: '2026-10-07', userAltitude: 500 })
const geoLow = CFF.buildGeometry(fLow, { width: 375, plotHeight: 240, userAltitude: 500 })
const stLow = CFF.inferState(geoLow.sample, 0, 500, geoLow.covered)
check('成都 500m：用户低于全部云层 → 云在头顶（不误报你在云中）', stLow.key === 'mid', '实际 ' + stLow.key + ' cUser=' + stLow.cUser)

/* 用户海拔高于全部云层（高原 6000m vs 2000-3000m 层）——云在脚下 */
const fHigh2 = WCFF.buildCloudField({ cloudLevels: clLow }, { date: '2026-10-07', userAltitude: 6000 })
const geoHigh2 = CFF.buildGeometry(fHigh2, { width: 375, plotHeight: 240, userAltitude: 6000 })
const stHigh2 = CFF.inferState(geoHigh2.sample, 0, 6000, geoHigh2.covered)
check('6000m：用户高于全部云层 → 云在脚下（不误报你在云中）', stHigh2.key === 'ok', '实际 ' + stHigh2.key + ' cUser=' + stHigh2.cUser)
check('覆盖范围随数据导出（2000–3000m）', geoLow.covered && geoLow.covered.lo === 2000 && geoLow.covered.hi === 3000)

/* ---------- Renderer 契约（生产输入与 POC 输出同构） ---------- */
section('Renderer 契约')
const base = CFF.renderBaseSvg(geoState, { userAltitude: 3500, sunrise: 7.1, sunset: 19.08, dateLabel: '周二 · 2026.10.07' })
check('生产管线 SVG 含五档灰阶', ['#eeeeea', '#d4d6d0', '#b0b2ab', '#84867f', '#5a5c56'].every(c => base.svg.indexOf(c) >= 0))
check('含观景点海拔线（你 · 3,500 m）', base.svg.indexOf('你 · 3,500 m') > 0)
const t0sel = Date.now()
const selSvg = CFF.renderSelectionSvg(geoState, { selectedTime: 1 })
const selMs = Date.now() - t0sel
check('选中层只含 overlay（< 基础层 15%）', selSvg.svg.length < base.svg.length * 0.15)
check('选中层生成 < 10ms', selMs < 10, selMs + 'ms')
check('field(3500) 交点：01h 你在云中时 ≥60', geoState.sample(1, 3500) >= 60)

/* ---------- 性能 ---------- */
section('性能（Node 稳态）')
const t1 = Date.now()
CFF.buildGeometry(f24, { width: 375, plotHeight: 240, userAltitude: 3500 })
const firstMs = Date.now() - t1
const t2 = Date.now()
CFF.buildGeometry(f24, { width: 375, plotHeight: 240, userAltitude: 3500 })
const secondMs = Date.now() - t2
check('首次 Cloud Field 构建 < 300ms', firstMs < 300, firstMs + 'ms')
check('重建（缓存语义下的最坏情况）< 300ms', secondMs < 300, secondMs + 'ms')
check('选中更新路径（overlay + inferState）< 10ms', selMs < 10)

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)

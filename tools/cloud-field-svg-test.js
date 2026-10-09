/* Cloud Field SVG renderer（小程序迁移 POC）测试
 * 覆盖：fixtures 三数据集的几何构建、等值带结构、云态推导、SVG 生成、
 *       选中层轻量更新、确定性、性能基准（Node 计时，预算宽松）。
 * 运行：node tools/cloud-field-svg-test.js
 */
'use strict'

const renderer = require('../miniprogram/utils/cloud-field-svg.js')
const fixtures = require('../miniprogram/pages/cloud-field-poc/fixtures.js')

let passed = 0, failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) } else { failed++; console.log('  ✗ ' + name + (extra ? ' —— ' + extra : '')) }
}
function section(title) { console.log('\n== ' + title + ' ==') }

/* ---------- Mock：几何与语义 ---------- */
section('Mock 场（格聂 3500m）')
const mockGeo = renderer.buildGeometry(fixtures.mock, { width: 375, plotHeight: 300, userAltitude: 3500 })
check('构建完成且 stats 齐全', mockGeo.stats && typeof mockGeo.stats.calcMs === 'number')
check('等值带 path 数在 3–8 之间（五档嵌套，允许某档为空）', mockGeo.stats.pathCount >= 3 && mockGeo.stats.pathCount <= 8, '实际 ' + mockGeo.stats.pathCount)
check('几何点数充足（>200，曲线非退化）', mockGeo.stats.pointCount > 200, '实际 ' + mockGeo.stats.pointCount)
check('计算耗时 < 300ms（Node 基准，预算宽松）', mockGeo.stats.calcMs < 300, '实际 ' + mockGeo.stats.calcMs + 'ms')

/* covered 必须传：三态判定的范围是「哪些高度有实测层」，不是显示窗。
   fixtures 是手工构造的全高度网格（0–7000m 都有测量），buildGeometry 会据 altitudes 兜底出 covered。 */
const mock16 = renderer.inferState(mockGeo.sample, 16, 3500, mockGeo.covered)
check('16h = 此点正处于云中（mock band 3150–3880 罩住 3500）', mock16.key === 'in' && mock16.word === '此点正处于云中', '实际 ' + mock16.key + '/' + mock16.word + ' cUser=' + mock16.cUser)
check('16h 云区含 3500', mock16.span && mock16.span.lo <= 3500 && mock16.span.hi >= 3500)
const mock07 = renderer.inferState(mockGeo.sample, 7, 3500, mockGeo.covered)
check('07h = 云带在此点下方（mock band 顶 2920 < 3500）', mock07.key === 'ok' && mock07.word === '云带在此点下方', '实际 ' + mock07.key + '/' + mock07.word + ' cUser=' + mock07.cUser)
const mock22 = renderer.inferState(mockGeo.sample, 22, 3500, mockGeo.covered)
check('22h 无成带（晴空）或云层在此点上方，不误报入云', mock22.key === null || mock22.key === 'mid', '实际 ' + mock22.key)
check('22h 若无结论，必须说明是「判过是晴」而不是证据不足', mock22.key !== null || mock22.reason === 'clear', '实际 reason=' + mock22.reason)

/* ---------- 峨眉山：真实冻结数据 ---------- */
section('峨眉山真实场（3079m，冻结 Open-Meteo）')
const emeGeo = renderer.buildGeometry(fixtures.emeishan, { width: 375, plotHeight: 300, userAltitude: 3079 })
check('构建完成', !!emeGeo.stats)
check('等值带 path 数在 2–8 之间', emeGeo.stats.pathCount >= 2 && emeGeo.stats.pathCount <= 8, '实际 ' + emeGeo.stats.pathCount)
const eme01 = renderer.inferState(emeGeo.sample, 1, 3079, emeGeo.covered)
check('01h = 此点正处于云中（冻结数据 96.5%@3500）', eme01.key === 'in', '实际 ' + eme01.key + ' cUser=' + eme01.cUser)
const eme12 = renderer.inferState(emeGeo.sample, 12, 3079, emeGeo.covered)
check('12h 不误报入云（午后转晴）', eme12.key !== 'in', '实际 ' + eme12.key)
const eme03 = renderer.inferState(emeGeo.sample, 3, 3079, emeGeo.covered)
check('03h key ∈ {in,ok,mid,null}（真实数据不预设方向）', ['mid', 'in', 'ok', null].indexOf(eme03.key) >= 0, '实际 ' + eme03.key)
check('03h 有结论必不带 reason、无结论必带 reason（两者不许同时出现）', (!!eme03.key) === (eme03.reason === null), JSON.stringify({ key: eme03.key, reason: eme03.reason }))

/* ---------- 理塘：真实冻结数据 ---------- */
section('理塘真实场（3500m，冻结 Open-Meteo）')
const litGeo = renderer.buildGeometry(fixtures.litang, { width: 375, plotHeight: 300, userAltitude: 3500 })
check('构建完成', !!litGeo.stats)
const lit17 = renderer.inferState(litGeo.sample, 17, 3500)
check('17h 5000m 处云量与冻结值一致（74.9% ± CR/平滑容差 8）', Math.abs(litGeo.sample(17, 5000) - 74.9) <= 8, '实际 ' + litGeo.sample(17, 5000).toFixed(1))

/* ---------- SVG 生成 ---------- */
section('SVG 生成')
const base = renderer.renderBaseSvg(mockGeo, {
  userAltitude: 3500, sunrise: 7.1, sunset: 19.08,
  dateLabel: '周二 · 2026.10.06',
  debugSamples: fixtures.mock.rawSamples && fixtures.mock.rawSamples.length ? fixtures.mock.rawSamples : null,
})
check('基础层含 <svg> 根', base.svg.indexOf('<svg') === 0)
check('含 clipPath（贴边云出血必需）', base.svg.indexOf('clipPath') > 0)
check('含五档灰阶填充色', ['#eeeeea', '#d4d6d0', '#b0b2ab', '#84867f', '#5a5c56'].every(c => base.svg.indexOf(c) >= 0))
check('含此点海拔参考线标签（主体不再是「你」）', base.svg.indexOf('此点 3,500 m') > 0)
check('无外来命名空间/脚本（data-URI 安全）', base.svg.indexOf('script') < 0 && base.svg.indexOf('xlink') < 0)
check('SVG 生成 < 50ms', base.svgMs < 50, '实际 ' + base.svgMs + 'ms')

const sel = renderer.renderSelectionSvg(mockGeo, { selectedTime: 16 })
check('选中层含时间牌 16:00', sel.svg.indexOf('16:00') > 0)
check('选中层体积远小于基础层（< 15%）', sel.svg.length < base.svg.length * 0.15, sel.svg.length + ' vs ' + base.svg.length)
check('选中层生成 < 10ms', sel.svgMs < 10, '实际 ' + sel.svgMs + 'ms')

/* ---------- 确定性 ---------- */
section('确定性')
const mockGeo2 = renderer.buildGeometry(fixtures.mock, { width: 375, plotHeight: 300, userAltitude: 3500 })
const base2 = renderer.renderBaseSvg(mockGeo2, { userAltitude: 3500, sunrise: 7.1, sunset: 19.08, dateLabel: '周二 · 2026.10.06' })
check('同输入两次构建，等值带几何逐字节一致', base2.svg === base.svg)

/* ---------- 390/414 宽度参数化 ---------- */
section('宽度参数化')
;[390, 414].forEach(w => {
  const g = renderer.buildGeometry(fixtures.emeishan, { width: w, plotHeight: 300, userAltitude: 3079 })
  const b = renderer.renderBaseSvg(g, { userAltitude: 3079 })
  check(w + 'px 构建与生成正常', b.svg.indexOf('<svg') === 0 && g.stats.pathCount >= 2, 'paths=' + g.stats.pathCount)
})

/* ---------- 性能汇总 ---------- */
section('性能基准（Node，预算宽松；小程序真机另测）')
console.log('  dataset     calcMs  isoMs  path  points  svgMs  svgKB')
;[['mock', mockGeo, base], ['emeishan', emeGeo, null], ['litang', litGeo, null]].forEach(([name, geo, b]) => {
  const svgKB = b ? (b.svg.length / 102.4 / 10).toFixed(1) : '—'
  console.log('  ' + name.padEnd(10) + String(geo.stats.calcMs).padStart(6) + 'ms' +
    String(geo.stats.isoMs).padStart(7) + 'ms' +
    String(geo.stats.pathCount).padStart(6) +
    String(geo.stats.pointCount).padStart(8) +
    (b ? String(b.svgMs).padStart(7) + 'ms' : '       —') +
    '  ' + String(svgKB).padStart(6))
})

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)

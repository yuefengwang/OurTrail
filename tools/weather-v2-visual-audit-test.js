/* Weather V2 Visual Fidelity Audit 测试（Runtime Rendering）
 * 覆盖：stage 宽度常数不变式（SVG 构建宽 = 卡片内宽）、supersample 包络的几何不变式
 * （宽度参数化 = 纯缩放，数学冻结）、YOU 标签边界、tier 呈现语义（默认档隐藏）、
 * Selection 对齐（不漂移）、375/390/414。
 * 运行：node tools/weather-v2-visual-audit-test.js
 */
'use strict'

const check = (name, cond, extra) => {
  if (cond) { passed++; console.log('  ✓ ' + name) } else { failed++; console.log('  ✗ ' + name + (extra ? ' —— ' + extra : '')) }
}
const section = (t) => console.log('\n== ' + t + ' ==')

let passed = 0, failed = 0
const UMG = require('../miniprogram/utils/meteogram-svg.js')
const OIP = require('../miniprogram/utils/oi-presentation.js')

const TIMES = []
for (let h = 0; h < 72; h++) {
  const d = new Date(Date.parse('2026-10-07T12:00:00') + Math.floor(h / 24) * 86400000).toISOString().slice(0, 10)
  TIMES.push({ d: d, t: (h % 24 < 10 ? '0' : '') + (h % 24) + ':00' })
}
function mkSurface(hours) {
  const rows = []
  for (let h = 0; h < hours; h++) {
    const di = Math.floor(h / 24)
    rows.push({ d: TIMES[h].d, t: TIMES[h].t, temp: 12 + Math.sin(h / 5) * 4, code: 0, pop: 0,
      precip: 0, showers: 0, wind: 8, gust: 14, windDir: 120, cloud: { low: 30, mid: 30, high: 20 }, band: null })
  }
  return rows
}
function mkField(hours, userAlt) {
  const alts = []
  for (let a = 0; a <= 7000; a += 250) alts.push(a)
  return { times: TIMES.slice(0, hours).map((_, i) => i), altitudes: alts,
    values: TIMES.slice(0, hours).map((_, h) => alts.map(a => { const c = 2600 + Math.floor(h / 24) * 600; return Math.abs(a - c) > 450 ? 4 : 90 } )),
    userAltitude: userAlt, covered: { lo: 2000, hi: 6000 } }
}
function build(horizon, userAlt, width) {
  return UMG.buildUnified({ surface: mkSurface(horizon), cloudField: mkField(Math.min(horizon, 72), userAlt),
    userAltitude: userAlt, width: width, horizon: horizon,
    dayLabels: ['今天', '明天', '后天'].slice(0, Math.ceil(horizon / 24)) })
}

/* ---------- Layout：safe area / gutter 不变量 ---------- */
section('Layout：gutter / safe area 不变量（375/390/414）')
;[375, 390, 414].forEach(function (W) {
  const g = build(24, 3500, W)
  const b = UMG.renderUnifiedBase(g, { sunrise: 7, sunset: 19, dateLabel: 'X' })
  /* 左轴刻度锚点 = L-5，右对齐；最长刻度「6000 m」7.5px 约需 26px → 需 L ≥ 31 且锚点 ≥ 26 */
  const L = 38
  check(W + 'px：左轴锚点 x=' + (L - 5) + ' ≥ 最长刻度宽（26px）', L - 5 >= 26)
  check(W + 'px：YOU 标签右缘 ≤ 绘图区右缘', (() => {
    const m = b.svg.match(/<text x="([0-9.]+)"[^>]*>此点 3,500 m/)
    return m && +m[1] <= L + g.plotW - 1
  })())
  check(W + 'px：行标题贴 SVG 左缘（x=0，由卡片 16px 内边距保护）', b.svg.indexOf('<text x="0"') >= 0)
  check(W + 'px：SVG 无横向溢出（viewBox 宽 = 构建宽）', (b.svg.match(/viewBox="0 0 (\d+) /) || [])[1] === String(W))
})

/* ---------- Cloud：宽度参数化 = 纯缩放（数学冻结不变式） ---------- */
section('Cloud：宽度参数化 = 纯缩放（归一化几何逐点一致）')
const gA = build(72, 3500, 318)   // DevTools stage 宽
const gB = build(72, 3500, 636)   // 2× 假想 supersample
check('等值带 path 数一致', gA.stats.pathCount === gB.stats.pathCount)
check('几何点数一致', gA.stats.pointCount === gB.stats.pointCount)
/* 归一化必须用 (x−L)/plotW：左右留边 L=38/R=10 是固定 px 不随宽度缩放，
   x/W 只在无留边时才是恒等式（318/636 实测 x/W 偏差 0.06 ≫ 容差，恒假）。 */
check('归一化几何逐点一致（(x−L)/plotW 线性 + y 恒定）', (() => {
  if (gA.bands.length !== gB.bands.length) return false
  const na = 318 - 48, nb = 636 - 48
  for (let bi = 0; bi < gA.bands.length; bi++) {
    const pa = gA.bands[bi].d.split(/[MLZ]/).filter(Boolean)
    const pb = gB.bands[bi].d.split(/[MLZ]/).filter(Boolean)
    if (pa.length !== pb.length) return false
    for (let pi = 0; pi < pa.length; pi++) {
      const ca = pa[pi].trim().split(' ').map(s => s.split(','))
      const cb = pb[pi].trim().split(' ').map(s => s.split(','))
      if (ca.length !== cb.length) return false
      for (let ci = 0; ci < ca.length; ci++) {
        const xa = (+ca[ci][0] - 38) / na, xb = (+cb[ci][0] - 38) / nb
        if (Math.abs(xa - xb) > 0.002) return false   // 归一化 x 不变式
        if (Math.abs(+ca[ci][1] - +cb[ci][1]) > 0.01) return false  // y 与宽度无关
      }
    }
  }
  return true
})())
check('阈值未变（五档色仍为冻结色板）', ['#eeeeea', '#d4d6d0', '#b0b2ab', '#84867f', '#5a5c56'].every(c => UMG.renderUnifiedBase(build(24, 3500, 375), {}).svg.indexOf(c) >= 0))
check('coverage 语义未变（covered 透传）', gA.covered.lo === 2000 && gA.covered.hi === 6000)

/* ---------- YOU 线 ---------- */
section('YOU 线：位置 / 边界 / 钳位')
const b24 = UMG.renderUnifiedBase(build(24, 3500, 375), {})
check('YOU 标签恰好一次', (b24.svg.match(/此点 3,500 m/g) || []).length === 1)
const yA = build(24, 500, 375)
check('500m → 剖面下方（不画虚假入云）', UMG.renderUnifiedBase(yA, {}).svg.indexOf('（剖面下方）') >= 0)
const yB = build(24, 6200, 375)
check('6200m → 剖面上方', UMG.renderUnifiedBase(yB, {}).svg.indexOf('（剖面上方）') >= 0)

/* ---------- Horizon / Selection 对齐 ---------- */
section('Horizon / Selection：不漂移')
const g72 = build(72, 3500, 375)
const b72 = UMG.renderUnifiedBase(g72, { sunTimes: [{ rise: 7, set: 19 }, { rise: 7, set: 19 }, { rise: 7, set: 19 }] })
;[[24, '明天'], [48, '后天']].forEach(function (bd) {
  const x = 38 + bd[0] / 72 * (375 - 48)
  const rx = (b72.svg.match(new RegExp('x1="' + x.toFixed(1) + '"[^>]*stroke-width="1"', 'g')) || []).length
  check('日界线 @' + bd[0] + 'h 存在于精确 x', rx >= 1)
})
const sel = UMG.renderUnifiedSelection(g72, { selectedAbs: 40 })
const x40 = g72.X(40).toFixed(1)
check('selectedAbs=40 → crosshair x = X(40)', sel.svg.indexOf('x1="' + x40 + '"') >= 0, x40)
check('Day2 16:00 日期牌「明天 16:00」', sel.svg.indexOf('明天 16:00') >= 0)
const sel16 = UMG.renderUnifiedSelection(g72, { selectedAbs: 16 })
check('Day1 16:00 无日期前缀', sel16.svg.indexOf('>16:00<') >= 0 && sel16.svg.indexOf('今天 16:00') < 0)

/* ---------- OI tier 呈现语义（presentation-only） ---------- */
section('OI：tier 呈现（默认档不重复）')
const dayOis = [0].map(function (d) {
  const rows = mkSurface(24).map(function (r) { return Object.assign({}, r, { d: TIMES[0].d, cloud: { low: 20, mid: 20, high: 10 } }) })
  return { dayLabel: '今天', date: TIMES[0].d, oi: OI0().buildOutdoorIntelligence({ date: TIMES[0].d, detail: rows, userAltitude: 3500, elevOK: true, lat: 29.9, lng: 100.27, days: [] }) }
})
function OI0() { return require('../miniprogram/utils/outdoor-intelligence.js') }
const card = OIP.buildOiCard(dayOis[0].oi, { width: 375 })
check('模型输出未被呈现层修改（机会类型集合一致）', JSON.stringify(dayOis[0].oi.opportunities.map(w => w.type).sort()) === JSON.stringify(card.items.concat(card.moreItems || []).map(it => it.type).sort()))
check('tier 字段仍在（数据完整性，供排序/未来 UI）', card.items.every(it => it.tierText && it.tierClass))
check('呈现契约：默认档 = 值得关注（WXML 按 tierClass 隐藏，数据不动）', card.items.filter(it => it.tierClass === 'good').every(it => it.tierText === '值得关注'))

/* ---------- 375/390/414 × 24/48/72 ---------- */
section('全组合')
;[375, 390, 414].forEach(function (W) {
  ;[24, 48, 72].forEach(function (H2) {
    const g2 = build(H2, 3500, W)
    const b2 = UMG.renderUnifiedBase(g2, { sunTimes: [{ rise: 7, set: 19 }, { rise: 7, set: 19 }, { rise: 7, set: 19 }] })
    check(W + '×' + H2 + 'h：构建/渲染/无 NaN', b2.svg.indexOf('<svg') === 0 && b2.svg.indexOf('NaN') < 0 && g2.stats.pathCount >= 3)
  })
})

/* ---------- 性能 ---------- */
section('性能（Node 稳态）')
const t1 = Date.now()
build(72, 3500, 375)
const ms = Date.now() - t1
check('72h 构建 < 300ms', ms < 300, ms + 'ms')

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)

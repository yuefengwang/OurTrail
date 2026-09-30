// 时空天相图 · 几何层回归测试：node tools/space-time-test.js
//
// 验证 components/space-time/layout.js 的几何不变量。
// 布局类测试用**合成 facts**（直接给 primary，保证确定性、不依赖天文阈值）；
// 与 weather-model 的真实链路另设一节，只断言结构自洽。
//
// 手法同 meteogram/layout.js：几何抽成纯模块，测试才有意义。
// 复刻页面计算会让测试为过期契约背书（AGENTS.md 反模式 11）。
'use strict'
const S = require('../miniprogram/components/space-time/layout')
const M = require('../miniprogram/utils/weather-model')
const MS = require('../miniprogram/components/meteogram/layout')
const SKY = require('../miniprogram/utils/sky')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const W = 340

// HH:mm -> 自 00:00 起的分钟数。复用 sky.hourMin，不另写解析
const toM = hhmm => SKY.hourMin(hhmm)

// 12 节点，形状对齐原型：05:40 出发 2860m -> 14:10 抵达 3900m
// 07:55-11:50 连续 **6** 节点云海（主窗口）；12:30/13:20 无天相；14:10 孤立云海
function makeFacts() {
  const base = [
    ['05:40', 2860, 'none'],
    ['06:25', 2950, 'none'],
    ['07:10', 3040, 'none'],
    ['07:55', 3120, 'cloudSea'],
    ['08:40', 3260, 'cloudSea'],
    ['09:30', 3380, 'cloudSea'],
    ['10:20', 3510, 'cloudSea'],
    ['11:15', 3640, 'cloudSea'],
    ['11:50', 3700, 'cloudSea'],
    ['12:30', 3760, 'none'],
    ['13:20', 3840, 'none'],
    ['14:10', 3900, 'cloudSea'],
  ]
  const kmTotal = 52.8
  const facts = base.map((b, i) => ({
    t: b[0], alt: b[1], km: Math.round(kmTotal * (i + 1) / base.length * 10) / 10,
    primary: b[2], marks: b[2] === 'none' ? [] : [b[2]], elevOK: true,
  }))
  return M.annotateRuns(facts)
}

function makePoints(facts) {
  const out = []
  for (let m = 5 * 60 + 40; m <= 14 * 60 + 10; m += 10) {
    let lo = facts[0], hi = facts[facts.length - 1]
    for (let i = 1; i < facts.length; i++) {
      if (m <= toM(facts[i].t)) { hi = facts[i]; lo = facts[i - 1]; break }
    }
    const a = toM(lo.t), b = toM(hi.t)
    const t = b > a ? (m - a) / (b - a) : 0
    out.push({
      minutes: m,
      alt: lo.alt + (hi.alt - lo.alt) * t,
      km: lo.km + (hi.km - lo.km) * t,
      // 清晨 07:00-10:00 有成层云带（底 2400 顶 3100），观景位在其上
      band: (m >= 7 * 60 && m <= 10 * 60) ? { base: 2400, top: 3100, cover: 88 } : null,
    })
  }
  return out
}

section('1. 空输入与退化输入')
{
  // 组件层会调 L.textWidth 判断标签放不放得下，漏导出就会在 drawRefs 里抛。
  // 这条断言是给「导出面完整性」兜底（几何测试只调 build()，测不到组件的用法）。
  check('textWidth 已导出（组件层 drawRefs 依赖）', typeof S.textWidth === 'function')
  check('withAlpha 已导出（组件层云带填充依赖）', typeof S.withAlpha === 'function')
  check('readoutAt 已导出（组件层读数依赖）', typeof S.readoutAt === 'function')
  check('textWidth 能算宽度', S.textWidth('观景位 3900m', 9) > 0)

  const e = S.build({ points: [], facts: [], width: W })
  check('空轨迹返回 empty', e.empty === true)
  check('空轨迹仍给出可用画布盒', e.box.plotW > 0 && e.box.plotH > 0)
  const noFacts = S.build({ points: [{ minutes: 60, alt: 100, km: 0, band: null }], facts: [], width: W })
  check('有点无节点不崩', noFacts.empty === false && noFacts.nodes.length === 0)
  check('无节点时主窗口为 null', noFacts.mainWindow === null)
  check('宽度为 0 时兜底', S.build({ points: [{ minutes: 0, alt: 1, band: null }], width: 0 }).box.w >= 1)
}

section('2. 坐标映射单调')
{
  const facts = makeFacts()
  const chart = S.build({ points: makePoints(facts), facts, width: W, obsAlt: 3900, arriveT: '14:10' })

  let monoX = true, monoY = true
  for (let i = 1; i < chart.points.length; i++) {
    if (chart.points[i].minutes <= chart.points[i - 1].minutes) monoX = false
  }
  for (let i = 1; i < chart.terrain.length; i++) {
    // toY 随海拔递减：海拔升 → y 必须**不升**，反之即为错
    if (chart.terrain[i].y > chart.terrain[i - 1].y + 1e-9) monoY = false
  }
  check('x 随时间单调递增', monoX)
  check('海拔上升时 y 单调下降', monoY)

  const first = chart.terrain[0], last = chart.terrain[chart.terrain.length - 1]
  check('首点贴左边界', Math.abs(first.x - chart.box.x0) < 1e-6)
  check('末点贴右边界', Math.abs(last.x - chart.box.x1) < 1e-6)
  check('观测位高于起点时 y 更小', chart.scale.toY(3900) < chart.scale.toY(2860))
  check('绘图区不超出画布', chart.box.x1 <= chart.box.w && chart.box.y1 <= chart.box.h)
}

section('3. 值域动态，不写死（原型早期硬编码轴范围的回归防线）')
{
  const facts = makeFacts()
  const a = S.build({ points: makePoints(facts), facts, width: W })
  const pts = makePoints(facts).filter(p => p.minutes >= 8 * 60 && p.minutes <= 9 * 60)
  const b = S.build({ points: pts, facts: facts.filter(f => f.t >= '08:00' && f.t <= '09:00'), width: W })
  check('全线值域覆盖 2860-3900', a.scale.aMin <= 2860 && a.scale.aMax >= 3900)
  check('截取后值域明显收缩', (b.scale.aMax - b.scale.aMin) < (a.scale.aMax - a.scale.aMin),
    b.scale.aMin.toFixed(0) + '-' + b.scale.aMax.toFixed(0))
  check('值域留了余量（轨迹不贴边）', a.scale.aMin < 2860 && a.scale.aMax > 3900)
}

section('4. 刻度')
{
  const facts = makeFacts()
  const chart = S.build({ points: makePoints(facts), facts, width: W, obsAlt: 3900 })
  check('Y 刻度非空', chart.scale.yTicks.length >= 2, String(chart.scale.yTicks.length))
  check('Y 刻度全在值域内', chart.scale.yTicks.every(t => t.v >= chart.scale.aMin && t.v <= chart.scale.aMax))
  check('Y 刻度递增', chart.scale.yTicks.every((t, i) => i === 0 || t.v > chart.scale.yTicks[i - 1].v))
  check('X 刻度非空', chart.scale.xTicks.length >= 2)
  check('X 刻度单调', chart.scale.xTicks.every((t, i) => i === 0 || t.x > chart.scale.xTicks[i - 1].x))
  check('步长取 1/2/5x10^n', [1, 2, 5, 10, 20, 50, 100, 200, 500].indexOf(S.niceStep(840, 4)) !== -1, String(S.niceStep(840, 4)))
  check('刻度标签是 HH:mm', /^\d{2}:\d{2}$/.test(chart.scale.xTicks[0].label))
}

section('5. 轨迹段：12 节点 = 11 段')
{
  const facts = makeFacts()
  const pts = makePoints(facts)
  const chart = S.build({ points: pts, facts, width: W })
  check('节点数 = 事实数', chart.nodes.length === facts.length, String(chart.nodes.length))
  check('段数 = 点数 - 1', chart.segments.length === pts.length - 1, String(chart.segments.length))
  check('每段都有起止色', chart.segments.every(s => /^#[0-9A-F]{6}$/.test(s.from) && /^#[0-9A-F]{6}$/.test(s.to)))
  check('段色随节点天相变化（存在非灰段）',
    chart.segments.some(s => s.from !== S.NO_COLOR || s.to !== S.NO_COLOR))
}

section('6. 配色复用 MARK_STYLE，不自建映射')
{
  const facts = makeFacts()
  const chart = S.build({ points: makePoints(facts), facts, width: W })
  check('云海取 meteogram 的 #346583', S.colorOf('cloudSea') === MS.MARK_STYLE.cloudSea.color, S.colorOf('cloudSea'))
  check('银河取 #163E35', S.colorOf('galaxy') === MS.MARK_STYLE.galaxy.color)
  check('无天相为中性灰', S.colorOf('none') === MS.MARK_STYLE.inCloud.color)
  check('未知 key 回落灰，不误报成云海', S.colorOf('brandNewKey') === S.NO_COLOR && S.colorOf('brandNewKey') !== S.colorOf('cloudSea'))
  check('文案也复用（未知 key 有兜底）', S.textOf('none') === '无显著天相' && !!S.textOf('cloudSea'))
  check('图上云海节点颜色与 MARK_STYLE 一致',
    chart.nodes.filter(n => n.key === 'cloudSea').every(n => n.color === MS.MARK_STYLE.cloudSea.color))
}

section('7. mixHex 端点与中点')
{
  check('t=0 取 a', S.mixHex('#000000', '#FFFFFF', 0) === '#000000')
  check('t=1 取 b', S.mixHex('#000000', '#FFFFFF', 1) === '#FFFFFF')
  check('t=0.5 为中灰', S.mixHex('#000000', '#FFFFFF', 0.5) === '#808080', S.mixHex('#000000', '#FFFFFF', 0.5))
  check('同色返回原值', S.mixHex('#346583', '#346583', 0.3) === '#346583')
  check('越界 t 被夹住', S.mixHex('#000000', '#FFFFFF', 5) === '#FFFFFF')
}

section('8. 主窗口 = 最长多节点段；孤立点不入主窗口')
{
  const facts = makeFacts()
  const chart = S.build({ points: makePoints(facts), facts, width: W })
  const mw = chart.mainWindow
  check('存在主窗口', !!mw)
  check('主窗口为 6 节点（07:55-11:50）', mw.count === 6, String(mw.count))
  check('主窗口起止正确', mw.from === '07:55' && mw.to === '11:50', mw.from + '-' + mw.to)
  check('12 节点 = 11 段', chart.segments.length === makePoints(facts).length - 1)
  check('主窗口 key 为云海', mw.key === 'cloudSea')
  check('主窗口括号 x 单调', mw.x2 > mw.x1)
  const head = facts.filter(f => f.t === mw.from)[0]
  check('括号节点数与注解一致', mw.count === facts.filter(f => f.runIndex === head.runIndex).length)
  const iso = facts.filter(f => f.isolated)
  check('14:10 孤立云海已识别', iso.length === 1 && iso[0].t === '14:10')
  check('孤立节点在图上有标 isolated', chart.nodes.filter(n => n.isolated).map(n => n.t).join() === '14:10')

  const flat = M.annotateRuns([
    { t: '06:00', alt: 2000, primary: 'none' },
    { t: '07:00', alt: 2100, primary: 'none' },
  ])
  check('全无天相时主窗口为 null', S.build({ points: makePoints(flat), facts: flat, width: W }).mainWindow === null)
}

section('9. 观景位线、抵达线与净空')
{
  const facts = makeFacts()
  const pts = makePoints(facts)
  const chart = S.build({ points: pts, facts, width: W, obsAlt: 3900, arriveT: '14:10' })
  check('观景位参考线已生成', !!chart.obs && chart.obs.alt === 3900)
  check('观景位线在绘图区内', chart.obs.y > chart.box.y0 && chart.obs.y < chart.box.y1)
  check('抵达竖线在右边界', Math.abs(chart.arrival.x - chart.box.x1) < 1e-6)
  check('抵达标签含时刻', chart.arrival.label.indexOf('14:10') !== -1)
  check('末点无云带时净空为 null', chart.arrival.clearance === null)
  check('净空文案相应为空', chart.arrival.clearanceText === '')

  // 净空 = 轨迹海拔 - 云顶
  const withBand = pts.slice()
  withBand[withBand.length - 1] = { minutes: 14 * 60 + 10, alt: 3900, km: 52.8, band: { base: 2400, top: 3100, cover: 88 } }
  const c2 = S.build({ points: withBand, facts, width: W, obsAlt: 3900, arriveT: '14:10' })
  check('净空 = 海拔 - 云顶 = 800', c2.arrival.clearance === 800, String(c2.arrival.clearance))
  check('净空文案已生成', c2.arrival.clearanceText === '净高 800m', c2.arrival.clearanceText)

  check('观景位标签不与抵达标签相撞', chart.obs.labelX + chart.obs.textW < chart.arrival.x,
    (chart.obs.labelX + chart.obs.textW).toFixed(1) + ' < ' + chart.arrival.x.toFixed(1))
}

section('10. 云带按连续区间合并（不产生每小时碎片）')
{
  const facts = makeFacts()
  const chart = S.build({ points: makePoints(facts), facts, width: W })
  check('云带被合并成 1 段（07:00-10:00 连续）', chart.clouds.length === 1, String(chart.clouds.length))
  const c = chart.clouds[0]
  check('云带 x 为正宽', c.x2 > c.x1)
  check('云顶高于云底（y 在上方）', c.yTop < c.yBase)
  check('云带记录了原始量级', c.base === 2400 && c.top === 3100 && c.cover === 88)
  const pts = makePoints(facts).map(p => (p.minutes === 8 * 60 + 30 ? Object.assign({}, p, { band: null }) : p))
  check('中间断开后仍至少有一段', S.build({ points: pts, facts, width: W }).clouds.length >= 1)
}

section('11. 播放头')
{
  const facts = makeFacts()
  const chart = S.build({ points: makePoints(facts), facts, width: W, obsAlt: 3900, scrub: 8 * 60 + 40 })
  check('播放头已生成', !!chart.playhead)
  check('播放头 x 对应该时刻', Math.abs(chart.playhead.x - chart.scale.toX(8 * 60 + 40)) < 1e-6)
  check('播放头带里程', chart.playhead.km != null && chart.playhead.km > 0)
  check('未越界时 past=false', chart.playhead.past === false)
  const after = S.build({ points: makePoints(facts), facts, width: W, scrub: 20 * 60 })
  check('越界时夹住并标 past', after.playhead.past === true && after.playhead.x <= chart.box.x1 + 1e-6)
  check('不给 scrub 时无播放头', S.build({ points: makePoints(facts), facts, width: W }).playhead === null)
}

section('12. readoutAt：漫游读数（时刻/海拔/天相/节点进度）')
{
  const facts = makeFacts()
  const chart = S.build({ points: makePoints(facts), facts, width: W, obsAlt: 3900, arriveT: '14:10' })

  // 08:00 落在 07:55(3120m) 与 08:40(3260m) 之间，海拔应在两者之间而非某个魔数
  const a = S.readoutAt(chart, 8 * 60)
  check('时刻格式为 HH:mm', a && /^\d{2}:\d{2}$/.test(a.t), a && a.t)
  check('海拔落在所夹的两节点之间', a && a.alt > 3120 && a.alt < 3260, a && String(a.alt && a.alt.toFixed(1)))
  check('报出天相 key', a && a.key === 'cloudSea', a && a.key)
  // 08:00 时最后一个 minutes<=480 的节点是 07:55（下标 3），不是 08:40
  check('报出节点进度', a && a.nodeCount === 12 && a.nodeIndex === 3, a && (a.nodeIndex + '/' + a.nodeCount))
  check('报出下一站时刻', a && a.nodeT === '07:55' && a.nextT === '08:40', a && (a.nodeT + '->' + a.nextT))

  // 行进中报**较早**节点的天相——说下一站的天相是误导
  const mid = S.readoutAt(chart, 9 * 60)
  check('两节点之间报较早节点', mid.nodeT === '08:40', mid.nodeT)
  const justBefore = S.readoutAt(chart, 9 * 60 + 25)
  check('逼近下一站仍报当前站', justBefore.nodeT === '08:40', justBefore.nodeT)
  const atNext = S.readoutAt(chart, 9 * 60 + 30)
  check('抵达即切换到下一站', atNext.nodeT === '09:30', atNext.nodeT)

  const start = S.readoutAt(chart, 0)
  check('早于起点时夹到起点节点', start.nodeIndex === 0, String(start.nodeIndex))

  const end = S.readoutAt(chart, 99 * 60)
  check('晚于终点时夹到末节点', end.nodeIndex === 11 && end.nodeT === '14:10', end.nodeT)
  check('晚于终点时标 past（已过路线终点）', end.past === true, String(end.past))

  // scrub 越界**不再撑大时间轴**：留宿由 stayEndH 表达，不该靠播放头把轴撑开
  // （真机验证抓到：播放头停在 21:30 后关掉留宿，轴收不回 14:10）
  const over = S.build({ points: makePoints(facts), facts, width: W, scrub: 99 * 60 })
  check('scrub 越界不撑大时间轴', over.scale.tMax === 14 * 60 + 10, String(over.scale.tMax))
  check('播放头被夹到轴内', over.playhead.minutes === 14 * 60 + 10, String(over.playhead.minutes))
  const overRead = S.readoutAt(over, 99 * 60)
  check('越界读数夹在轴内', overRead.minutes === 14 * 60 + 10, String(overRead.minutes))
  check('越界读数仍标 past', overRead.past === true)
  check('给出 routeEnd 供判断 past', over.scale.routeEnd === 14 * 60 + 10, String(over.scale.routeEnd))

  // 留宿：轴由 stayEndH 撑到 23:00；播放头停在「已抵达、仍在山里」这一段也算 past
  const stayPts = makePoints(facts).concat([{ minutes: 23 * 60, alt: 3900, km: null, band: null }])
  const stay = S.build({ points: stayPts, facts, width: W, scrub: 21 * 60 + 30 })
  check('留宿轴末端为 23:00', stay.scale.tMax === 23 * 60, String(stay.scale.tMax))
  check('留宿段内 past 为真（已抵达仍在山里）', stay.playhead.past === true)
  check('留宿段读数报末节点', S.readoutAt(stay, 21 * 60 + 30).nodeT === '14:10')

  check('无数据时返回 null', S.readoutAt(S.build({ points: [], facts: [], width: W }), 600) === null)
  check('fixture 提供了 km 时能读出', typeof end.km === 'number', String(end.km))
  // 预格式化文本：省得 wxml 挂 WXS 过滤器，也避免各端各写一份取整
  check('altText 已取整并带单位', a.altText === Math.round(a.alt) + ' m', a.altText)
  check('有 km 时 kmText 带一位小数', a.kmText === a.km.toFixed(1) + ' km', a.kmText)
  const noAltFacts = M.annotateRuns([{ t: '01:00', alt: null, km: null, primary: 'none' }])
  const noAlt = S.build({
    points: [{ minutes: 60, alt: null, km: null, band: null }], facts: noAltFacts, width: W,
  })
  check('海拔缺失时 altText 明说未知', S.readoutAt(noAlt, 60).altText === '海拔未知')
  check('km 缺失时 kmText 为空串（不显示 0 km）', S.readoutAt(noAlt, 60).kmText === '')
  check('无节点时 readoutAt 返回 null（无法报节点进度）',
    S.readoutAt(S.build({ points: [{ minutes: 60, alt: 100, band: null }], facts: [], width: W }), 60) === null)
}

section('13. 与 weather-model 的真实链路')
{
  const LAT = 30.67, LNG = 104.07, DATE = '2026-07-28'
  const series = []
  for (let h = 0; h < 24; h++) {
    series.push({
      d: DATE, t: (h < 10 ? '0' : '') + h + ':00',
      temp: 14, precip: 0, showers: 0, pop: 0, code: 2, wind: 12, rh: 60,
      cloud: { low: 60, mid: 20, high: 10 },
      band: h >= 7 && h <= 10 ? { base: 2400, top: 3100, cover: 88 } : null,
    })
  }
  // 刻意不给 km —— 真实链路里页面的 spaceNodes 就不带这个字段
  const nodes = [
    { t: '05:40', d: DATE, alt: 2860 },
    { t: '08:00', d: DATE, alt: 3300 },
    { t: '11:15', d: DATE, alt: 3640 },
    { t: '14:10', d: DATE, alt: 3900 },
  ]
  const facts = M.annotateRuns(M.nodeFacts({ series, days: [], nodes, lat: LAT, lng: LNG }))
  const pts = M.trackPoints({ series, nodes, stayEndH: '23:00' }, 10)
  const chart = S.build({ points: pts, facts, width: W, obsAlt: 3900, arriveT: '14:10', scrub: 8 * 60 })

  check('链路跑通不抛错', chart.empty === false)
  check('节点数与输入一致', chart.nodes.length === nodes.length)
  check('留宿使时间轴延到 23:00', chart.scale.tMax === 23 * 60, String(chart.scale.tMax))
  check('主窗口 key 合法或是 null', chart.mainWindow === null || !!MS.MARK_STYLE[chart.mainWindow.key])
  check('所有段色都是合法 hex', chart.segments.every(s => /^#[0-9A-F]{6}$/.test(s.from) && /^#[0-9A-F]{6}$/.test(s.to)))
  check('3900m 观景位在云带之上判云海（清晨带顶 3100）',
    facts.some(f => f.t === '08:00' && f.primary === 'cloudSea'),
    facts.map(f => f.t + ':' + f.primary).join(' '))
  // 真实链路里页面不传 km（GPX 路线点没有该字段），读数必须缺这一项而不是显示 0
  const rd = S.readoutAt(chart, 8 * 60)
  check('未提供 km 时读数为 null（不显示 0 km）', rd.km === null, String(rd.km))
  check('未提供 km 时节点进度仍可用', rd.nodeCount === 4 && rd.nodeT === '08:00', rd.nodeT)
}

section('13. wx-free：几何层不得触碰 wx / canvas')
{
  const src = require('fs').readFileSync(require.resolve('../miniprogram/components/space-time/layout'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  check('注释外无 wx. 调用', !/\bwx\./.test(code))
  check('不直接画 canvas（只出几何）', !/createCanvasContext|getContext|canvasId/.test(code))
  // 依赖白名单：配色单一来源（meteogram/layout）+ 时间格式化归 format.js。
  // 刻意不含 utils/sky 或 utils/weather-model——几何层不该掺判定或编排。
  const requires = (code.match(/require\(['"]([^'"]+)['"]\)/g) || []).join(' ')
  check('只依赖 meteogram/layout 与 utils/format',
    (code.match(/require\(/g) || []).length === 2
    && /meteogram\/layout/.test(requires) && /utils\/format/.test(requires), requires)
  check('不依赖 sky/weather-model（判定与编排不进几何层）',
    !/utils\/sky|utils\/weather-model/.test(requires), requires)
  check('时间格式化复用 format.minutesLabel（不自己拼 HH:mm）',
    /minutesLabel/.test(code) && !/padStart/.test(code))
}

console.log('')
console.log('passed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)

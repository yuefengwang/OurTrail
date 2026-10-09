/* 海拔语义回归门（2026-10-09 Weather V2 审计 §五）
 *
 * 钉住四件事：
 *  1. 出处判定只有一个出处（format.resolveElev）：GPX / 地图选点 / 手填 / 模型地形高度 / 未知。
 *  2. 图上那条参考线的主体是「此点」，不是「你」——本项目没有任何 wx.getLocation 路径，
 *     永远不知道用户脚下在哪儿，所以任何以「你」为主语的海拔断言都是无据的。
 *  3. 数值来自模型降尺度（±300–600 m）时必须显式标注，不许以测量值的口气出现在决策界面。
 *  4. 判读范围取实测数据范围，不取剖面显示窗：整层云在 2000m 以下时，
 *     高台站点应当答「云在脚下」，而不是因为图上看不见就沉默。
 * 运行：node tools/elevation-semantics-test.js
 */
'use strict'

const fs = require('fs')
const path = require('path')
const F = require('../miniprogram/utils/format.js')
const UMG = require('../miniprogram/utils/meteogram-svg.js')
const CFF = require('../miniprogram/utils/cloud-field-svg.js')
const ADP = require('../miniprogram/utils/weather-cloud-field.js')
const OI = require('../miniprogram/utils/outdoor-intelligence.js')

let passed = 0, failed = 0
function check (name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) } else { failed++; console.log('  ✗ ' + name + (extra ? ' —— ' + extra : '')) }
}
function section (t) { console.log('\n== ' + t + ' ==') }

/* ---------- 1. 出处判定 ---------- */
section('1 resolveElev：四种查询模式各自的海拔语义')
const cases = [
  ['路线 GPX 节点', [3820, 'gpx', 489], { elevation: 3820, source: 'gpx', ok: true }],
  ['地图选点', [2150, 'picked', 489], { elevation: 2150, source: 'picked', ok: true }],
  ['手动坐标（手填高程）', [1500, 'manual', 489], { elevation: 1500, source: 'manual', ok: true }],
  ['手动坐标（只有经纬度）', [null, null, 489], { elevation: 489, source: 'model', ok: false }],
  ['模型值也没有', [null, null, null], { elevation: null, source: null, ok: false }],
  ['海平面 0 m 是合法值，不被当成缺失', [0, 'picked', 489], { elevation: 0, source: 'picked', ok: true }],
  ['NaN / 字符串高程视同缺失', [NaN, 'gpx', 489], { elevation: 489, source: 'model', ok: false }],
]
cases.forEach(([nm, args, want]) => {
  const got = F.resolveElev.apply(null, args)
  check(nm + ' → ' + JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got))
})
check('模型来源的中文标签独立可辨（「模型地形估算」≠「地图选点」）',
  F.elevSourceLabel('model') === '模型地形估算' && F.elevSourceLabel('picked') === '地图选点')

/* ---------- 2. 图上的主体 ---------- */
section('2 剖面参考线：主体是「此点」，模型来源必须标注')
function mkCF () {
  const altitudes = []
  for (let a = 0; a <= 7000; a += 250) altitudes.push(a)
  const times = []
  for (let h = 0; h < 24; h++) times.push(h)
  return {
    times, altitudes, covered: { lo: 250, hi: 6750 },
    values: times.map(() => altitudes.map(a => (a >= 3000 && a <= 3800) ? 90 : 5)),
  }
}
function surface () {
  return [...Array(24).keys()].map(h => ({
    t: '00', d: '2026-10-09', temp: 12 - h * 0.2, precip: 0, showers: 0,
    wind: 6, gust: 12, windDir: 90, code: 1, cloud: { low: 10, mid: 10, high: 10 },
  }))
}
;[['gpx', 'GPX'], ['picked', '地图选点'], ['manual', '手填'], ['model', '模型']].forEach(([src]) => {
  const geo = UMG.buildUnified({
    surface: surface(), cloudField: mkCF(), userAltitude: 3079, elevSource: src, width: 375, horizon: 24,
  })
  const svg = UMG.renderUnifiedBase(geo, {}).svg
  const label = (svg.match(/此点[^<]*/) || [])[0] || ''
  check(src + '：线上标签以「此点」为主语并带数值', /^此点 3,079 m/.test(label), '实际标签「' + label + '」')
  check(src + '：图上不再出现「你 · 」这种以用户为主体的海拔断言', svg.indexOf('你 · ') < 0)
  if (src === 'model') check('model：估算值被显式标注（不是测量值的口气）', label.indexOf('模型估算') > 0, '实际「' + label + '」')
  else check(src + '：真实来源不加「模型估算」字样', label.indexOf('模型估算') < 0)
})
/* POC 渲染器共用同一份文案（两处必须同步，否则又是一个第二出处） */
const pocGeo = CFF.buildGeometry(mkCF(), { width: 375, userAltitude: 3500, elevSource: 'picked' })
const pocSvg = CFF.renderBaseSvg(pocGeo, {}).svg
check('POC 渲染器与统一 Meteogram 用同一个标签出处', pocSvg.indexOf('此点 3,500 m') > 0 && pocSvg.indexOf('你 ·') < 0)

/* ---------- 3. OI 证据句的主语 ---------- */
section('3 Outdoor Intelligence 证据句不许替用户断言位置')
/* 与页面同一条入口（buildOutdoorIntelligence 自己会算 marks/sun/moon），
   这样测的是真链路而不是我把句子抄一遍。云系在 1400–1900m、此点在 3400m ⇒ 云海类证据。 */
const lowDeckForOI = ADP.buildCloudFieldRange({
  cloudLevels: (() => {
    const times = []
    for (let h = 0; h < 24; h++) times.push('2026-10-09T' + (h < 10 ? '0' : '') + h + ':00')
    const lv = (p, alt, cc) => ({ pressure: p, altitudes: times.map(() => alt), cloudCover: times.map(() => cc) })
    return { times, levels: [lv(925, 3100, 90), lv(900, 3350, 95), lv(875, 3600, 92), lv(800, 4200, 6), lv(700, 5000, 3)] }
  })(),
}, { hours: 24, userAltitude: 3400 })
const oiDetail = [...Array(24).keys()].map(h => ({
  t: (h < 10 ? '0' : '') + h + ':00', d: '2026-10-09',
  temp: 6 - Math.cos(h / 24 * 2 * Math.PI) * 4, feels: 3, pop: 0, precip: 0, showers: 0,
  code: h < 9 || h > 18 ? 2 : 1, wind: 3, gust: 7, windDir: 45, rh: h < 10 ? 92 : 60,
  cloud: { low: h < 11 ? 95 : 8, mid: 4, high: 2 }, uv: 0, visibility: 20, freezing: 4200,
}))
const oi = OI.buildOutdoorIntelligence({
  date: '2026-10-09', detail: oiDetail, userAltitude: 3400, elevOK: true,
  lat: 30.0, lng: 100.27, cloudField: lowDeckForOI, days: [],
})
const facts = []
;(oi.opportunities || []).forEach(o => (o.evidence || []).forEach(e => facts.push(String(e.fact || e))))
;(oi.conditions || []).forEach(c => (c.evidence || []).forEach(e => facts.push(String(e.fact || e))))
check('穿过此点海拔的证据句确实生成了（否则本节是空断言，必须显式失败而不是静默通过）',
  facts.some(t => /此点海拔/.test(t)), '证据句 ' + facts.length + ' 条：' + facts.slice(0, 3).join(' / '))
check('没有任何证据句以「你的海拔」表述（同一处文案的旧写法）',
  !facts.some(t => /你的海拔/.test(t)), facts.filter(t => /你的海拔/.test(t)).join(' / '))
const bad = facts.filter(t => /你(的海拔|脚下|在云层上方|上方|下方)/.test(t))
check('证据句里不再出现以「你」为主语的海拔断言', bad.length === 0, bad.slice(0, 3).join(' / '))
check('机会清单本身不为空（本场景应有日出/云海类窗口）', (oi.opportunities || []).length > 0,
  '机会 ' + (oi.opportunities || []).length + ' 个')

/* ---------- 4. 判读范围 = 实测数据范围，不是显示窗 ---------- */
section('4 判读不受剖面窗（2000–6000m）限制')
const lowDeck = ADP.buildCloudFieldRange({
  cloudLevels: (() => {
    const times = []
    for (let h = 0; h < 24; h++) times.push('2026-10-09T' + (h < 10 ? '0' : '') + h + ':00')
    const lv = (p, alt, cc) => ({ pressure: p, altitudes: times.map(() => alt), cloudCover: times.map(() => cc) })
    // 一整层浓云，完全在剖面显示窗以下；层间隙取真实数据的量级
    // （三地点 24h 全量实测相邻层最大间隙只有 489m，不制造 1km 的人工空洞）
    return { times, levels: [lv(1000, 1400, 96), lv(975, 1650, 94), lv(950, 1900, 90), lv(925, 2150, 26), lv(900, 2400, 4), lv(850, 2900, 2)] }
  })(),
}, { hours: 24, userAltitude: 3400 })
const column = CFF.makeColumnSampler(lowDeck)
const sample = (t, alt) => CFF.sampleAtStations(column, lowDeck.times.length, t, alt)
const st = CFF.inferState(sample, 10, 3400, lowDeck.covered)
check('云系全部低于 2000m 时，3400m 的此点仍判为「云在脚下」（旧实现受显示窗钳制会沉默）',
  st.key === 'ok', JSON.stringify(st))
check('云团区间落在实测包络之内（1400–2400m，误差 ≤ 一个层步长）',
  st.span && st.span.lo >= 1350 && st.span.hi <= 2450, JSON.stringify(st.span))
check('区间不超过 covered.hi（判读与页面文案共用同一个实测上界）',
  st.span && st.span.hi <= lowDeck.covered.hi + 50, JSON.stringify(lowDeck.covered) + ' vs ' + JSON.stringify(st.span))
/* 「晴空」判定同样不许只看显示窗：1500m 有一层 96% 的浓云时，3400m 处不能报「晴空」 */
const deck = ADP.buildCloudFieldRange({
  cloudLevels: (() => {
    const times = []
    for (let h = 0; h < 24; h++) times.push('2026-10-09T' + (h < 10 ? '0' : '') + h + ':00')
    const lv = (p, alt, cc) => ({ pressure: p, altitudes: times.map(() => alt), cloudCover: times.map(() => cc) })
    return { times, levels: [lv(1000, 1300, 96), lv(975, 1500, 94), lv(950, 1700, 90), lv(925, 1900, 20), lv(900, 2100, 2), lv(850, 2600, 2), lv(800, 2900, 1), lv(700, 3400, 1)] }
  })(),
}, { hours: 24, userAltitude: 3400 })
const colD = CFF.makeColumnSampler(deck)
const sampD = (t, alt) => CFF.sampleAtStations(colD, deck.times.length, t, alt)
const stD = CFF.inferState(sampD, 10, 3400, deck.covered)
check('显示窗之外（1300–1700m）有浓云时不报晴空，且给出「云在脚下」',
  stD.key === 'ok', JSON.stringify(stD))
const above = CFF.inferState(sample, 10, 800, lowDeck.covered)
check('同一份数据，800m 的此点判为「头顶有云层」而不是「云在脚下」',
  above.key === 'mid', JSON.stringify(above))
check('实测范围之外不补云：0–1350m 区间云量为 0（无测量=不画），不是最低层 96% 的平推',
  lowDeck.values[10][lowDeck.altitudes.indexOf(1000)] === 0 &&
  lowDeck.values[10][lowDeck.altitudes.indexOf(250)] === 0,
  '1000m=' + lowDeck.values[10][lowDeck.altitudes.indexOf(1000)])

/* ---------- 5. 静态门：不许出现第二个出处 / 无据的用户主体文案 ---------- */
section('5 静态门：文案单源 + 无据主体')
const MG = path.join(__dirname, '..', 'miniprogram')
function walk (dir, out) {
  fs.readdirSync(dir).forEach(n => {
    const p = path.join(dir, n)
    const st2 = fs.statSync(p)
    if (st2.isDirectory()) { if (n !== 'node_modules') walk(p, out) } else if (/\.(js|wxml)$/.test(n)) out.push(p)
  })
  return out
}
const files = walk(MG, [])
const offenders = []
files.forEach(p => {
  const txt = fs.readFileSync(p, 'utf8')
  if (/你(现在|脚下)海拔|你现在海拔|你所在海拔/.test(txt)) offenders.push(p + '：以「你」为主语的海拔文案')
  if (p.indexOf('format.js') < 0 && /=== 'gpx' \? 'GPX 记录'/.test(txt)) offenders.push(p + '：又写了一份海拔来源标签（应走 format.elevSourceLabel）')
})
check('客户端不存在「你现在海拔」类无据断言（本项目没有定位海拔来源）', offenders.length === 0, offenders.join(' | '))
check('海拔来源标签只在 format.js 定义一次',
  files.filter(p => /ELEV_SOURCE_LABELS = /.test(fs.readFileSync(p, 'utf8'))).length === 1)
const page = fs.readFileSync(path.join(MG, 'pages/weather/weather.js'), 'utf8')
check('天气页把出处传给图上（buildUnified 带 elevSource），并且不再自己判出处',
  /elevSource: this\.elevSource/.test(page) && /F\.resolveElev\(/.test(page) && !/function elevLabel/.test(page))

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)

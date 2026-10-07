/* OI Presentation + Weather Page 集成（OI Phase 2）测试
 * 覆盖：presentation adapter（tier/排序/摘要/tapZones/时间轴）、selectHour 联动、
 *       三海拔差异、沉默、降级（缺 cloudLevels/OI 异常）、确定性、性能。
 * 运行：node tools/outdoor-intelligence-ui-test.js
 */
'use strict'

const check = (name, cond, extra) => {
  if (cond) { passed++; console.log('  ✓ ' + name) } else { failed++; console.log('  ✗ ' + name + (extra ? ' —— ' + extra : '')) }
}
const section = (t) => console.log('\n== ' + t + ' ==')

let passed = 0, failed = 0
const OI = require('../miniprogram/utils/outdoor-intelligence.js')
const OIP = require('../miniprogram/utils/oi-presentation.js')
const UMG = require('../miniprogram/utils/meteogram-svg.js')
const WCFF = require('../miniprogram/utils/weather-cloud-field.js')
const W = require('../cloudfunctions/trailApi/lib/weather.js')

const TIMES = []
for (let h = 0; h < 24; h++) TIMES.push('2026-10-07T' + (h < 10 ? '0' : '') + h + ':00')

/* 生产形响应构造器：真实气压层数据（实时抓取一次，进程内复用） */
const https = require('https')
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)) }
      let buf = ''
      res.on('data', d => { buf += d })
      res.on('end', () => resolve(JSON.parse(buf)))
    }).on('error', reject)
  })
}
const LEVELS = [1000, 975, 950, 925, 900, 875, 850, 825, 800, 775, 750, 725, 700, 675, 650, 625, 600, 575, 550, 525, 500, 475, 450]
const HOURLY = ['temperature_2m', 'precipitation_probability', 'precipitation', 'showers', 'weather_code', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'relative_humidity_2m', 'visibility']
LEVELS.forEach(lv => { HOURLY.push('cloud_cover_' + lv + 'hPa', 'geopotential_height_' + lv + 'hPa') })

const LOCS = [
  { key: 'emeishan', label: '峨眉山', lat: 29.53, lng: 103.39, elev: 3079 },
  { key: 'litang', label: '理塘·格聂一带', lat: 29.9, lng: 100.27, elev: 3500 },
  { key: 'chengdu', label: '成都', lat: 30.66, lng: 104.07, elev: 500 },
]

async function main() {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const real = {}

  section('生产数据抓取（REAL FORECAST）')
  for (const loc of LOCS) {
    const j = await fetchJson('https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat +
      '&longitude=' + loc.lng + '&hourly=' + HOURLY.join(',') +
      '&daily=sunrise,sunset&timezone=Asia%2FShanghai&forecast_days=1')
    const times = j.hourly.time
    const start = Math.max(0, times.findIndex(t => t.slice(0, 10) === today))
    const cloudLevels = W.buildCloudLevels(times, j.hourly, start, Math.min(24, times.length - start))
    const detail = times.slice(start, start + 24).map((t, i) => ({
      d: today, t: t.slice(11, 16),
      temp: j.hourly.temperature_2m[start + i],
      pop: j.hourly.precipitation_probability ? j.hourly.precipitation_probability[start + i] : 0,
      precip: j.hourly.precipitation[start + i] || 0,
      showers: j.hourly.showers[start + i] || 0,
      code: j.hourly.weather_code[start + i],
      wind: j.hourly.wind_speed_10m[start + i],
      gust: j.hourly.wind_gusts_10m[start + i],
      windDir: j.hourly.wind_direction_10m[start + i],
      rh: j.hourly.relative_humidity_2m ? j.hourly.relative_humidity_2m[start + i] : null,
      visibility: j.hourly.visibility ? Math.round(j.hourly.visibility[start + i] / 100) / 10 : null,
      cloud: { low: 0, mid: 0, high: 0 }, band: null,
    }))
    real[loc.key] = {
      label: loc.label, elev: loc.elev, lat: loc.lat, lng: loc.lng,
      response: {
        status: 'ready', updatedAt: new Date().toISOString(),
        cloudLevels: cloudLevels || null, pointElevation: Math.round(j.elevation),
        series: [], days: [{ date: today, precipSum: 0 }],
      },
      detail: detail,
    }
    check(loc.label + '：生产形响应就绪（24h × cloudLevels ' + (cloudLevels ? cloudLevels.levels.length : 0) + ' 层）', detail.length === 24)
  }

  /* ---------- Presentation adapter ---------- */
  section('Presentation adapter：tier / 排序 / 摘要 / tapZones')
  const emeOi = OI.buildOutdoorIntelligence({
    date: today, detail: real.emeishan.detail, userAltitude: 3079, elevOK: true,
    lat: real.emeishan.lat, lng: real.emeishan.lng,
    cloudField: WCFF.buildCloudField(real.emeishan.response, { date: today, userAltitude: 3079 }),
    days: real.emeishan.response.days,
  })
  const emeCard = OIP.buildOiCard(emeOi, { width: 375 })
  check('items 非空且字段齐全', emeCard.items.length > 0 && emeCard.items.every(it =>
    it.timeText && it.title && it.tierText && it.tierClass && it.summaryText !== undefined && Number.isFinite(it.hour)))
  check('tier ∈ {确定, 很值得关注, 值得关注, 条件一般}', emeCard.items.every(it =>
    ['确定', '很值得关注', '值得关注', '条件一般'].indexOf(it.tierText) >= 0))
  check('列表排序：primary 在前', (() => {
    for (let i = 1; i < emeCard.items.length; i++) {
      if (emeCard.items[i - 1].rank === 'primary' && emeCard.items[i].rank !== 'primary') continue
      if (emeCard.items[i - 1].rank !== 'primary' && emeCard.items[i].rank === 'primary') return false
    }
    return true
  })())
  check('tapZones 百分比合法且 hour 映射正确', emeCard.tapZones.length > 0 && emeCard.tapZones.every(z =>
    +z.left >= 0 && +z.left <= 100 && +z.width > 0 && Number.isFinite(z.hour) && z.hour >= 0 && z.hour <= 23))
  check('时间轴 SVG 含刻度 00/06/12/18/24', ['>00<', '>06<', '>12<', '>18<', '>24<'].every(k => emeCard.timelineSvg.indexOf(k) >= 0))
  check('时间轴 SVG 与 Meteogram 共用 timeScale（X(6) 一致）', (() => {
    const m = /<text x="([0-9.]+)" y="[0-9.]+" text-anchor="middle" font-size="8" fill="#8a8f8a">06</.exec(emeCard.timelineSvg)
    if (!m) return false
    const scale = UMG.timeScale(375)
    return Math.abs(+m[1] - scale.X(6)) < 0.5
  })())

  /* ---------- selectHour 联动 ---------- */
  section('selectHour 联动：applySelection')
  const target = emeCard.items.find(it => it.type === 'IN_CLOUD')
  if (target) {
    OIP.applySelection(emeCard, target.hour)
    check('applySelection 命中 IN_CLOUD 窗口', emeCard.selIndex >= 0 && emeCard.items[emeCard.selIndex].type === 'IN_CLOUD')
    check('证据展开 = 该窗口 summaryText', emeCard.selSummary === emeCard.items[emeCard.selIndex].summaryText)
  } else {
    check('峨眉山今日无 IN_CLOUD 窗口（数据相关，跳过联动断言）', true)
  }
  const anyItem = emeCard.items[0]
  OIP.applySelection(emeCard, anyItem.hour)
  check('任意条目可选（selIndex 指向含该小时的窗口）', emeCard.selIndex >= 0)

  /* ---------- 三海拔差异 ---------- */
  section('三海拔：同一管线不同解读')
  const byLoc = {}
  for (const loc of LOCS) {
    const oi = OI.buildOutdoorIntelligence({
      date: today, detail: real[loc.key].detail, userAltitude: loc.elev, elevOK: true,
      lat: loc.lat, lng: loc.lng,
      cloudField: WCFF.buildCloudField(real[loc.key].response, { date: today, userAltitude: loc.elev }),
      days: real[loc.key].response.days,
    })
    const card = OIP.buildOiCard(oi, { width: 375 })
    byLoc[loc.key] = {
      inCloud: oi.opportunities.some(w2 => w2.type === 'IN_CLOUD'),
      allTypes: oi.opportunities.map(w2 => w2.type),
      condKeys: oi.conditions.filter(c2 => c2.key).map(c2 => c2.key).join(','),
      card: card,
    }
  }
  check('峨眉山 3079m：真实数据下产出机会（astro 或条件类）', byLoc.emeishan.allTypes.length > 0)
  check('理塘 3500m：真实数据下产出机会', byLoc.litang.allTypes.length > 0)
  check('成都 500m：低海拔不误报「你在云中」', !byLoc.chengdu.inCloud)
  /* Phase 3：差异在模型层比较（top3 折叠会把差异藏进「还有 N 个时段」——这是产品语义，
     断言必须看全量机会 + 条件态，而不是被折叠的卡面） */
  check('三海拔条件态存在差异（峨眉山 vs 成都）',
    byLoc.emeishan.condKeys !== byLoc.chengdu.condKeys,
    byLoc.emeishan.condKeys.slice(0, 40) + ' vs ' + byLoc.chengdu.condKeys.slice(0, 40))
  check('峨眉山全量机会含 IN_CLOUD 或 VIEW_WINDOW（低层云爬坡的真实解读）',
    byLoc.emeishan.allTypes.indexOf('IN_CLOUD') >= 0 || byLoc.emeishan.allTypes.indexOf('VIEW_WINDOW') >= 0,
    byLoc.emeishan.allTypes.join(','))
  /* Phase 3 §四：top3 折叠 */
  check('卡面最多 3 个主要机会 + moreCount 折叠', byLoc.emeishan.card.items.length <= 3 &&
    byLoc.emeishan.card.moreCount === Math.max(0, byLoc.emeishan.allTypes.length - 3),
    'items ' + byLoc.emeishan.card.items.length + ' more ' + byLoc.emeishan.card.moreCount + ' all ' + byLoc.emeishan.allTypes.length)

  /* ---------- 降级路径 ---------- */
  section('降级：缺失 / 异常')
  const oiNoCL = OI.buildOutdoorIntelligence({
    date: today, detail: real.emeishan.detail, userAltitude: 3079, elevOK: true,
    lat: 29.53, lng: 103.39, cloudField: null, days: [],
  })
  const cardNoCL = OIP.buildOiCard(oiNoCL, { width: 375 })
  check('cloudLevels 缺失 → OI 仍产出（band/hour-view 回退 + astro）', cardNoCL.items.length > 0)
  const oiEmpty = OI.buildOutdoorIntelligence({ date: today, detail: [], userAltitude: 3079 })
  const cardEmpty = OIP.buildOiCard(oiEmpty, { width: 375 })
  check('detail 为空 → 沉默卡（silenceNote）', cardEmpty.silenceNote !== null && cardEmpty.items.length === 0)
  check('OI 异常形态（null opportunities）→ 卡不抛错且为空', (() => {
    const card = OIP.buildOiCard({ conditions: [], opportunities: null, meta: {} }, { width: 375 })
    return card.items.length === 0 && card.silenceNote !== null
  })())
  check('畸形 window（缺 from/to）被适配器安全跳过', (() => {
    const card = OIP.buildOiCard({ conditions: [], opportunities: [{ type: 'CLOUD_SEA' }, { type: 'MILKY_WAY', from: '21:00', to: '23:00', confidence: '中', rank: 'primary', evidence: [] }], meta: {} }, { width: 375 })
    return card.items.length === 1
  })())

  /* ---------- Phase 3：tier / 跨零点 / now / 折叠提升 ---------- */
  section('Phase 3：tier 连续化 / 跨零点 / 进行中 / 折叠提升')
  check('tier 全集 ∈ {确定, 重点关注, 值得关注, 条件一般}', (() => {
    const tiers = new Set()
    ;[emeCard].forEach(c2 => c2.items.concat(c2.moreItems || []).forEach(it => tiers.add(it.tierText)))
    return ['确定', '重点关注', '值得关注', '条件一般'].some(t2 => tiers.has(t2)) &&
      [...tiers].every(t2 => ['确定', '重点关注', '值得关注', '条件一般'].indexOf(t2) >= 0)
  })(), [...new Set(emeCard.items.concat(emeCard.moreItems || []).map(it => it.tierText))].join('/'))
  check('跨零点：timeLabel 产生「今晚 HH:mm → 次日 HH:mm」', (() => {
    const label = OIP.timeLabel('22:30', '02:40')
    return label === '今晚 22:30 → 次日 02:40'
  })(), OIP.timeLabel('22:30', '02:40'))
  check('跨零点：splitSegments 拆两段且都在 [0,1440]', (() => {
    const segs = OIP.splitSegments('22:30', '02:40')
    return segs.length === 2 && segs[0].fromMin === 22 * 60 + 30 && segs[0].toMin === 1440 &&
      segs[1].fromMin === 0 && segs[1].toMin === 2 * 60 + 40
  })())
  check('非跨零点：timeLabel 保持 05:00–10:00 形式', OIP.timeLabel('05:00', '10:00') === '05:00–10:00')
  check('timeLabel 出现在卡面（跨零点窗口不显示 22:30–02:40 歧义形式）', (() => {
    const mk = OIP.buildOiCard({ conditions: [], opportunities: [{ type: 'MILKY_WAY', from: '22:30', to: '02:40', confidence: '中', rank: 'primary', evidence: [] }], meta: {} }, { width: 375 })
    return mk.items.length === 1 && mk.items[0].timeText === '今晚 22:30 → 次日 02:40'
  })())
  check('跨零点窗口在时间轴上画两段（今晚段 + 次日段）', (() => {
    const mk = OIP.buildOiCard({ conditions: [], opportunities: [{ type: 'MILKY_WAY', from: '22:30', to: '02:40', confidence: '中', rank: 'primary', evidence: [] }], meta: {} }, { width: 375 })
    return mk.tapZones.length === 2
  })())
  check('nowMin 提供时，「进行中」标记落在包含 now 的窗口', (() => {
    const mk = OIP.buildOiCard({ conditions: [], opportunities: [{ type: 'IN_CLOUD', from: '15:00', to: '18:00', confidence: '高', rank: 'secondary', evidence: [] }], meta: {} }, { width: 375, nowMin: 16 * 60 })
    return mk.items[0].live === true
  })())
  check('nowMin 不在窗口内 → 无进行中标记', (() => {
    const mk = OIP.buildOiCard({ conditions: [], opportunities: [{ type: 'IN_CLOUD', from: '15:00', to: '18:00', confidence: '高', rank: 'secondary', evidence: [] }], meta: {} }, { width: 375, nowMin: 20 * 60 })
    return mk.items[0].live === false
  })())
  check('折叠提升：选中折叠区窗口 → 自动出现在卡面', (() => {
    const mk = OIP.buildOiCard({ conditions: [], opportunities: [
      { type: 'MILKY_WAY', from: '00:00', to: '04:00', confidence: '中', rank: 'primary', evidence: [] },
      { type: 'MILKY_WAY', from: '21:00', to: '23:00', confidence: '中', rank: 'primary', evidence: [] },
      { type: 'RAINBOW', from: '08:00', to: '09:00', confidence: '中', rank: 'secondary', evidence: [] },
      { type: 'VIEW_WINDOW', from: '10:00', to: '13:00', confidence: '高', rank: 'secondary', evidence: [] },
    ], meta: {} }, { width: 375 })
    OIP.applySelection(mk, 11)   // 选中折叠区里的 VIEW_WINDOW
    return mk.items.some(it => it.type === 'VIEW_WINDOW')
  })())

  /* ---------- Evidence「看图 ↗」Anchor ---------- */
  section('Evidence Anchor：focusHour 规则 / 跨零点 / 复用 selectHour')
  check('每个 item 均有合法 anchor（kind/focusHour 0-23/label）',
    emeCard.items.every(it => it.anchor && it.anchor.kind === 'meteogram' &&
      Number.isFinite(it.anchor.focusHour) && it.anchor.focusHour >= 0 && it.anchor.focusHour <= 23 &&
      it.anchor.label === '看图'))
  const mk = (from, to, at) => OIP.buildOiCard({ conditions: [], opportunities: [{ type: 'MILKY_WAY', from: from, to: to, confidence: '中', rank: 'primary', evidence: at ? [{ fact: 'x', at: at }] : [] }], meta: {} }, { width: 375 })
  check('银河 00–05 → focus 02:00（中点）', mk('00:00', '05:00').items[0].anchor.focusLabel === '02:00')
  check('云海 05–09 → focus 07:00（中点）', mk('05:00', '09:00').items[0].anchor.focusLabel === '07:00')
  check('跨零点 23–01 → focus 00:00（不得出现负时间/24:00）', (() => {
    const a = mk('23:00', '01:00').items[0].anchor
    return a.focusHour === 0 && a.startHour === 23 && a.endHour === 1
  })())
  check('跨零点 23–05 + 证据 at 02:00 → focus 02:00（证据优先于中点）',
    mk('23:00', '05:00', '02:00').items[0].anchor.focusHour === 2)
  check('证据 at 在窗外 → 回退中点', (() => {
    const a = mk('05:00', '09:00', '13:00').items[0].anchor
    return a.focusHour === 7
  })())
  check('无 evidence → 中点兜底（不 crash）', (() => {
    const a = mk('06:00', '08:00').items[0].anchor
    return a.focusHour === 7
  })())
  check('anchor.focusHour 喂 applySelection 命中自身窗口', (() => {
    const c2 = mk('05:00', '09:00')
    OIP.applySelection(c2, c2.items[0].anchor.focusHour)
    return c2.selIndex === 0
  })())
  check('真实峨眉山 IN_CLOUD 窗口 anchor 指向窗口内时刻（条件态证据 at 优先）', (() => {
    const target = emeCard.items.find(it => it.type === 'IN_CLOUD')
    if (!target) return true
    return target.anchor.focusHour >= 0 && target.anchor.focusHour <= 23
  })())

  /* ---------- 多日摘要（48/72h 视图） ---------- */
  section('Phase 3：多日摘要')
  const litOiD0 = OI.buildOutdoorIntelligence({
    date: today, detail: real.litang.detail, userAltitude: 3500, elevOK: true,
    lat: 29.9, lng: 100.27,
    cloudField: WCFF.buildCloudField(real.litang.response, { date: today, userAltitude: 3500 }),
    days: real.litang.response.days,
  })
  const day0Card = OIP.summarizeDay(litOiD0, today, '今天')
  check('summarizeDay：count/top 结构齐全', Number.isFinite(day0Card.count) && (day0Card.silence === (day0Card.count === 0)))
  const multi = OIP.buildMultiDay(
    [0, 1, 2].map(off => ({
      date: new Date(Date.parse(today + 'T12:00:00') + off * 86400000).toISOString().slice(0, 10),
      label: ['今天', '明天', '后天'][off],
    })),
    function (dateVal) {
      const dayDetail = dateVal === today ? real.litang.detail : []
      const dayField = dateVal === today ? WCFF.buildCloudField(real.litang.response, { date: dateVal, userAltitude: 3500 }) : null
      return OI.buildOutdoorIntelligence({ date: dateVal, detail: dayDetail, userAltitude: 3500, elevOK: true, lat: 29.9, lng: 100.27, cloudField: dayField, days: [] })
    })
  check('buildMultiDay：三日各具 label 与 silence 语义', multi.length === 3 && multi[0].label === '今天' && multi.every(d2 => typeof d2.silence === 'boolean'))

  /* ---------- 确定性 ---------- */
  section('确定性')
  const card2 = OIP.buildOiCard(emeOi, { width: 375 })
  check('同输入两次构建一致（items 逐字节）', JSON.stringify(card2.items) === JSON.stringify(emeCard.items))

  /* ---------- 375/390/414 ---------- */
  section('375 / 390 / 414')
  ;[375, 390, 414].forEach(w => {
    const c = OIP.buildOiCard(emeOi, { width: w })
    check(w + 'px：tapZones/timeline 正常', c.tapZones.length > 0 && c.timelineSvg.indexOf('<svg') === 0)
  })

  /* ---------- 性能 ---------- */
  section('性能（Node）')
  const t1 = Date.now()
  for (let i = 0; i < 50; i++) OIP.buildOiCard(emeOi, { width: 375 })
  const ms = (Date.now() - t1) / 50
  check('单次 OI 卡构建 < 25ms', ms < 25, ms.toFixed(2) + 'ms')

  console.log('\npassed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })

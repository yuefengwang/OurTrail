// 天气页集成冒烟：node tools/weather-page-test.js
// 目的：真机跑不到的地方先用脚本兜住——把"云函数返回体 → 页面数据装配 → 组件入参"这条链
// 在 node 下走一遍，确认 meteogram 与天相结论拿到的数据结构对得上、且不抛异常。
//
// 覆盖：lib/weather 的 series 形状、页面 buildChartSeries/buildNightMap/buildChartMarks、
// sky.summarize 结论、route-schedule 与节点的衔接。
'use strict'
const { hourView, cloudBandAt, gcjToWgs } = require('../cloudfunctions/trailApi/lib/weather')
const { gcjToWgs: gcjToWcsHelper } = require('../miniprogram/utils/gpx')
const sky = require('../miniprogram/utils/sky')
const A = require('../miniprogram/utils/astro')
const RS = require('../miniprogram/utils/route-schedule')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const DATE = '2026-09-28'
const COORD = { lat: 30.9394, lng: 103.4901 } // 青城后山（WGS-84）
const GCJ = { lat: 30.9458, lng: 103.4769 }

// 构造 lib/weather 的 hourly 原始形状（与 Open-Meteo 返回一致），再经 hourView 投影
function fakeHourly(days) {
  const times = []
  const h = {}
  const push = (name, fn) => { h[name] = [] }
  const names = ['temperature_2m', 'apparent_temperature', 'precipitation_probability', 'precipitation',
    'showers', 'weather_code', 'wind_speed_10m', 'wind_gusts_10m', 'relative_humidity_2m',
    'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'uv_index', 'visibility', 'freezing_level_height',
    'uv_index', 'cloud_cover_1000hPa', 'geopotential_height_1000hPa', 'cloud_cover_925hPa', 'geopotential_height_925hPa',
    'cloud_cover_850hPa', 'geopotential_height_850hPa']
  names.forEach(push)
  for (let d = 0; d < days; d++) {
    for (let hh = 0; hh < 24; hh++) {
      times.push(DATE + 'T' + String(hh).padStart(2, '0') + ':00')
      const night = hh >= 20 || hh <= 5
      const morning = hh >= 6 && hh <= 9
      h.temperature_2m.push(12 + Math.round(6 * Math.sin((hh - 6) / 24 * 2 * Math.PI)))
      h.apparent_temperature.push(12)
      h.precipitation_probability.push(morning ? 40 : 10)
      h.precipitation.push(morning ? 0.3 : 0)
      h.showers.push(0)
      h.weather_code.push(morning ? 61 : night ? 0 : 2)
      h.wind_speed_10m.push(7)
      h.wind_gusts_10m.push(12)
      h.relative_humidity_2m.push(night ? 80 : 55)
      h.cloud_cover_low.push(morning ? 30 : night ? 10 : 20)
      h.cloud_cover_mid.push(morning ? 60 : night ? 10 : 40)
      h.cloud_cover_high.push(night ? 10 : morning ? 20 : 40)
      h.uv_index.push(4)
      h.visibility.push(20000)
      h.freezing_level_height.push(4000)
      // 清晨成层云带：底 ~1100 m 顶 ~1700 m
      const band = morning
      h.cloud_cover_1000hPa.push(band ? 95 : 10)
      h.geopotential_height_1000hPa.push(200)
      h.cloud_cover_925hPa.push(band ? 92 : 10)
      h.geopotential_height_925hPa.push(800)
      h.cloud_cover_850hPa.push(band ? 88 : 10)
      h.geopotential_height_850hPa.push(1500)
    }
  }
  return { times, h }
}

section('1. lib/weather → series 形状')
{
  const { times, h } = fakeHourly(3)
  const series = times.map((_, i) => hourView(times, h, i))
  check('hourView 产出 72 小时', series.length === 72, String(series.length))
  check('每项含 d/t/temp/precip/showers/code/wind/rh/cloud/band',
    series[0].d === DATE && series[0].t === '00:00' && Number.isFinite(series[0].temp)
    && Number.isFinite(series[0].precip) && Number.isFinite(series[0].showers)
    && Number.isFinite(series[0].code) && Number.isFinite(series[0].wind) && Number.isFinite(series[0].rh)
    && !!series[0].cloud && series[0].band !== undefined, JSON.stringify(series[0]).slice(0, 160))
  check('云层带被重建（清晨成层）', series.some(x => x.band && x.band.cover >= 80),
    JSON.stringify(series[7].band))
  check('无云时 band 为 null', series[0].band === null, JSON.stringify(series[0].band))
  check('gcjToWgs 把 GCJ 点移到 WGS（位移数百米量级）', (() => {
    const w = gcjToWgs(GCJ.lat, GCJ.lng)
    const dLat = (w.lat - GCJ.lat) * 111000
    const dLng = (w.lng - GCJ.lng) * 96000
    return Math.sqrt(dLat * dLat + dLng * dLng) > 200 && Math.sqrt(dLat * dLat + dLng * dLng) < 900
  })())
  check('两端实现一致（差异仅来自 gpx.js 的 1e-6 取整）', (() => {
    const mine = gcjToWcsHelper(GCJ.lat, GCJ.lng)
    return Math.abs(mine.lat - gcjToWgs(GCJ.lat, GCJ.lng).lat) <= 1e-6
      && Math.abs(mine.lng - gcjToWgs(GCJ.lat, GCJ.lng).lng) <= 1e-6
  })())
  check('cloudBandAt 薄云不入带', cloudBandAt({
    cloud_cover_1000hPa: [60], geopotential_height_1000hPa: [200],
    cloud_cover_925hPa: [50], geopotential_height_925hPa: [800],
  }, 0) === null)
}

section('2. 页面装配：meteogram 序列与夜间底色')
{
  const { times, h } = fakeHourly(3)
  const series = times.map((_, i) => hourView(times, h, i))
  // 页面 buildChartSeries：从所选日起取 7 天
  const start = series.findIndex(x => x.d === DATE)
  const chart = series.slice(start, start + 24 * 7)
  check('图表窗口从所选日起', chart[0].d === DATE, chart[0].d)
  check('数据不足时至少给 24 小时', chart.length >= 24, String(chart.length))

  // 页面 buildNightMap：逐日算天文暮光
  const night = {}
  const byDate = {}
  series.forEach(x => (byDate[x.d] = byDate[x.d] || []).push(x))
  Object.keys(byDate).forEach(d => {
    const sun = A.sunTimes(d, COORD.lat, COORD.lng, 1200)
    const dawn = sky.hourMin(sun.astroDawn)
    const dusk = sky.hourMin(sun.astroDusk)
    byDate[d].forEach(x => {
      const m = sky.hourMin(x.t)
      if (m < dawn || m > dusk) night[d + 'T' + x.t] = true
    })
  })
  const nightKeys = Object.keys(night)
  check('夜间小时被标出（' + nightKeys.length + ' 个）', nightKeys.length >= 8, String(nightKeys.length))
  check('夜间不含正午', nightKeys.every(k => Number(k.slice(11, 13)) <= 6 || Number(k.slice(11, 13)) >= 20), nightKeys.slice(0, 4).join(','))
  check('组件入参形状正确（YYYY-MM-DDTHH:mm 键）', nightKeys.every(k => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(k)), nightKeys[0])
}

section('3. 页面装配：图表天相标记（逐日 hourMarks）')
{
  const { times, h } = fakeHourly(2)
  const series = times.map((_, i) => hourView(times, h, i))
  const marks = {}
  const byDate = {}
  series.forEach(x => (byDate[x.d] = byDate[x.d] || []).push(x))
  Object.keys(byDate).forEach(d => {
    const m = sky.hourMarks({ date: d, lat: COORD.lat, lng: COORD.lng, elevation: 2000, elevOK: true, detail: byDate[d], days: [] })
    Object.keys(m).forEach(t => { marks[d + 'T' + t] = m[t] })
  })
  const keys = Object.keys(marks)
  check('标记非空（' + keys.length + ' 个小时）', keys.length > 0)
  check('观察点 2000m 高于云带顶（1700m）→ 出现云海标记',
    keys.some(k => marks[k].indexOf('cloudSea') !== -1), keys.filter(k => marks[k].indexOf('cloudSea') !== -1).join(','))
  check('云海标记只在清晨（≤09 时）',
    keys.filter(k => marks[k].indexOf('cloudSea') !== -1).every(k => Number(k.slice(11, 13)) <= 9))
  check('夜间晴朗 → 出现星空标记', keys.some(k => marks[k].indexOf('star') !== -1))
  check('9 月非银心季 → 无银河标记（10 月起才有）',
    !keys.some(k => marks[k].indexOf('galaxy') !== -1), keys.filter(k => marks[k].indexOf('galaxy') !== -1).join(','))
  check('标记值都是 meteogram 认识的 key', keys.every(k => marks[k].every(v =>
    ['inCloud', 'cloudSea', 'alpenglow', 'golden', 'blueHour', 'rainbow', 'star', 'galaxy'].indexOf(v) !== -1)))
}

section('4. 结论卡：与图表标记同源不打架')
{
  const { times, h } = fakeHourly(1)
  const detail = times.map((_, i) => hourView(times, h, i))
  const out = sky.summarize({
    date: DATE, lat: COORD.lat, lng: COORD.lng, elevation: 2000, elevOK: true, detail, days: [],
    heading: 75,
  })
  check('产出 6 张结论卡', out.items.length === 6, out.items.map(i => i.key).join(','))
  check('每张卡都有标题与文案', out.items.every(i => i.title && i.text))
  check('概率卡都带三级标签', out.items.filter(i => i.key !== 'light').every(i => ['条件较好', '条件一般', '条件较差'].indexOf(i.label) !== -1),
    out.items.map(i => i.key + ':' + i.label).join(' '))
  check('返回日出日落与月相', !!out.sun.sunrise && !!out.sun.sunset && Number.isFinite(out.moon.illumination))
  // 同源校验：图上有云海标记 → 结论也说有云海机会
  const sea = out.items.filter(i => i.key === 'cloudSea')[0]
  const hasMark = Object.keys(out.marks).some(k => out.marks[k].indexOf('cloudSea') !== -1)
  check('图上有云海标记时结论也给出时段（' + sea.window + '）', !hasMark || !!sea.window, sea.text)
  check('图上有星空标记时星空结论给窗口', (() => {
    const star = out.items.filter(i => i.key === 'star')[0]
    return Object.keys(out.marks).some(k => out.marks[k].indexOf('star') !== -1) ? !!star.window : true
  })(), out.items.filter(i => i.key === 'star')[0].text)
}

section('5. 节点日程 → 天气日期的衔接')
{
  const points = [
    { id: 'a', name: '起点', time: '2020-05-02T06:30:00+08:00', ele: 700, coordinates: COORD },
    { id: 'b', name: '中点', time: '2020-05-02T11:00:00+08:00', ele: 1400, coordinates: COORD },
    { id: 'c', name: '终点', time: '2020-05-03T09:00:00+08:00', ele: 900, coordinates: COORD },
  ]
  const sched = RS.schedule(points, '2026-09-26T08:00:00+08:00')
  check('三节点都能推算', sched.every(s => s.known))
  check('标签带第几天', RS.nodeLabel(sched[2]) === '第2天 10:30', RS.nodeLabel(sched[2]))
  check('跨 2 天', RS.spanDays(sched) === 2)
  check('日期在预报范围内（第1天 9/26）', sched[0].arriveDate === '2026-09-26', sched[0].arriveDate)
  // 天相上下文用节点的 ele（真实海拔）而非模型值
  const p = points[2]
  const ctx = {
    date: sched[2].arriveDate, lat: p.coordinates.lat, lng: p.coordinates.lng,
    elevation: p.ele, elevOK: true, detail: [], days: [], heading: 90,
  }
  check('用节点高程做天相上下文不抛异常（数据不足走降级）', sky.summarize(ctx) !== null
    && sky.summarize(ctx).items.filter(i => i.key === 'cloudSea')[0].score === 0)
  check('无 ele 的节点退回模型值时 elevOK=false', (() => {
    const o = sky.summarize(Object.assign({}, ctx, { elevation: 1167, elevOK: false, detail: [
      { t: '06:00', temp: 10, pop: 10, precip: 0, showers: 0, code: 2, wind: 5, rh: 60, cloud: { low: 10, mid: 50, high: 40 }, band: null },
    ] }))
    return /缺少可信海拔/.test(o.items.filter(i => i.key === 'cloudSea')[0].text)
  })())
}

// 6. 窗口复用与「图/卡同窗」契约
// covers/buildDayCards/buildChartSeries 一律取**真实现**来测：先前这里放的是镜像实现，
// 结果实现改了镜像没改，测试反而在为旧契约背书。
section('6. 窗口复用与图/卡同窗契约')

const PAGE_PATH = require.resolve('../miniprogram/pages/weather/weather.js')

// 加载真页面配置（global.Page 捕获）
function pageConfig() {
  global.Page = cfg => { global.__PAGE_CFG = cfg }
  delete require.cache[PAGE_PATH] // 每次取最新源码，避免吃到缓存的旧实现
  require(PAGE_PATH)
  return global.__PAGE_CFG
}

// 页面实例：数据同步并入 this.data，但 setData 回调像真机一样异步触发（竞态复现的关键）
function makePage(cfg) {
  const page = Object.assign({}, cfg)
  page.data = JSON.parse(JSON.stringify(cfg.data || {}))
  page._patches = [] // 记录每次 setData 的入参，用于观测"日期是否在第一轮就落定"
  page.setData = function (patch, cb) {
    this._patches.push(patch)
    Object.assign(this.data, patch)
    if (cb) setImmediate(cb)
  }
  return page
}

const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
// 从起始日起 n 天的日值
function fakeDays(from, n, code) {
  const out = []
  for (let i = 0; i < n; i++) out.push({
    date: addDays(from, i), code: code == null ? 2 : code,
    tMax: 20, tMin: 10, precipProbMax: 20,
    cloud: { low: 10, mid: 20, high: 20 },
  })
  return out
}
// 从起始日起 n 天的逐小时序列（形状同 hourView 产出）
function fakeSeries(from, n) {
  const out = []
  for (let i = 0; i < n * 24; i++) {
    out.push({
      d: addDays(from, Math.floor(i / 24)),
      t: String(i % 24).padStart(2, '0') + ':00',
      temp: 12, pop: 10, precip: 0, showers: 0, code: 2, wind: 7, rh: 60, uv: 3,
      cloud: { low: 20, mid: 30, high: 30 }, band: null,
    })
  }
  return out
}

{
  const cfg = pageConfig()
  const covers = cfg.covers
  const days = fakeDays(DATE, 4)
  const hours = fakeSeries(DATE, 4)
  const cached = { pointId: 'p1', series: hours, days, detail: [], updatedAt: DATE + 'T10:00:00+08:00' }
  const d0 = days[0].date
  const d1 = days[1].date
  check('同点同日的缓存可复用（重进页面零外呼）', covers(cached, d0, 'p1'))
  // 窗口中间的日期**不允许**复用：series 是从所选日起的 7 天，从中间切会让剩余天数越切越少
  check('窗口中间的日期不复用（否则图越切越短）', covers(cached, d1, 'p1') === false, d1)
  check('窗口外不覆盖（需外呼）', covers(cached, '2026-10-20', 'p1') === false)
  check('换节点后不覆盖（pointId 不匹配）', covers(cached, d0, 'p2') === false)
  check('未锚定的返回体不覆盖（series 首日 ≠ 所选日）',
    covers(Object.assign({}, cached, { series: hours.slice(24) }), d0, 'p1') === false)
}

{
  // 图与概览条必须同窗：都从所选日起 7 天。这是 A 组修复的核心不变量。
  const cfg = pageConfig()
  const page = makePage(cfg)
  page.view = { activity: { routeSnapshot: { points: [{ coordinates: COORD }] } } }
  page.data.date = '2026-10-03'

  const days = fakeDays(DATE, 12) // 今天 9/28 起 12 天，所选日 10/03 落在中间
  const cards = page.buildDayCards(days, COORD)
  const chart = page.buildChartSeries(fakeSeries('2026-10-03', 7), '2026-10-03')
  check('所选日在窗口中间时概览条首日 = 所选日', cards[0].date === '2026-10-03', cards[0] && cards[0].date)
  check('概览条 7 张', cards.length === 7, String(cards.length))
  check('图 168 小时（7 天）', chart.length === 168, String(chart.length))
  check('图首日 = 卡首日（同窗）', chart[0].d === cards[0].date, chart[0].d + ' vs ' + cards[0].date)

  // 所选日不在窗口内（选了过去的日子）：两者一起退回预报首日，不能一个退一个不退
  page.data.date = '2026-09-20'
  const cards2 = page.buildDayCards(days, COORD)
  const chart2 = page.buildChartSeries(fakeSeries(DATE, 7), '2026-09-20')
  check('过去日期：卡与图一起退回预报首日',
    cards2[0].date === DATE && chart2[0].d === DATE,
    cards2[0].date + ' vs ' + chart2[0].d)
}

// 7. 首屏/切节点的日期竞态（回归）
// 真机上 setData 回调在渲染后才异步回到逻辑层。若日期被放进回调里再设，
// 紧随其后同步发出的 fetchWeather 就读到上一次的空日期 → 发出 date:'' → 云函数回"日期无效"。
// 这里加载真页面（global.Page 捕获配置）+ 异步 setData 回调，把那条链原样跑一遍。

const api = require('../miniprogram/utils/api')

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(cond, ms = 1500) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (cond()) return true; await sleep(5) }
  return cond()
}

// 加载真页面配置并打上网络桩；返回 { page, calls }
function bootPage(read) {
  global.Page = cfg => { global.__PAGE_CFG = cfg }
  delete require.cache[PAGE_PATH] // 每次取最新源码，避免吃到缓存的旧实现
  require(PAGE_PATH)
  const cfg = global.__PAGE_CFG
  const calls = []
  // weather.js 持有的是同一个 api 模块对象，改属性即生效
  api.read = () => Promise.resolve(read)
  api.getWeather = (activityId, pointId, date) => {
    calls.push({ activityId, pointId, date })
    return new Promise(() => {}) // 只关心入参，不消费返回体
  }
  return { page: makePage(cfg), calls }
}

async function raceCases() {
  section('7. 首屏与切节点的日期竞态（回归）')
  const points = [
    { id: 'p1', name: '起点', time: '2020-05-02T07:00:00+08:00', coordinates: COORD },
    { id: 'p2', name: '营地', time: '2020-05-03T07:00:00+08:00', coordinates: COORD },
  ]
  const startAt = '2026-10-03T07:00:00+08:00'
  const read = {
    revision: 1,
    now: '2026-09-28T09:00:00+08:00',
    view: {
      kind: 'activity',
      permittedActions: [],
      activity: { id: 'a1', title: '测试活动', startAt, routeSnapshot: { points } },
    },
  }

  // 情形 A：带了入口日期（详情页「天气」入口带入），首屏不能发空日期
  {
    const { page, calls } = bootPage(read)
    page.onLoad({ id: 'a1', date: '2026-10-03' })
    await page.reload()
    await waitFor(() => calls.length > 0)
    const first = calls[0]
    check('首屏发出合法日期（不是空串）',
      !!first && /^\d{4}-\d{2}-\d{2}$/.test(first.date), first ? JSON.stringify(first) : 'getWeather 未被调用')
    check('首屏日期取入口带入的 2026-10-03', !!first && first.date === '2026-10-03', first && first.date)
    check('页面显示的日期与请求一致', page.data.date === (first && first.date), page.data.date)
    // 时序断言：reload 的第一轮 setData 就必须带合法日期。
    // 若日期被放进回调里再设，这里会缺 date —— 即使下游有兜底，也说明时序已退化。
    const firstPatch = (page._patches[0] || {})
    check('reload 第一轮 setData 已带合法日期（无时序竞态）',
      /^\d{4}-\d{2}-\d{2}$/.test(firstPatch.date || ''), JSON.stringify(Object.keys(firstPatch)))
    // 兜底之后不应再多发请求
    check('首屏一次到位，不重复外呼', calls.length === 1, 'calls=' + calls.length)

    // 情形 B：切到第 2 天抵达的节点，日期跟着走，且必须同一次 setData 落定
    const before = calls.length
    page.onPoint({ detail: { value: 1 } })
    await waitFor(() => calls.length > before)
    const second = calls[1]
    const expect = RS.schedule(points, startAt)[1].arriveDate
    check('切到第 2 天节点后日期 = ' + expect, !!second && second.date === expect,
      second ? second.date : 'getWeather 未被调用')
    check('切节点后页面日期与请求一致', !!second && second.date === page.data.date, page.data.date)
    check('切节点未多发请求（共 ' + calls.length + ' 次）', calls.length === 2, 'calls=' + calls.length)
  }

  // 情形 C：不带入口日期，兜底到活动出发日——这条正是线上截图那条链
  {
    const noTime = { ...read, view: { ...read.view, activity: { ...read.view.activity, routeSnapshot: { points: points.map(p => ({ id: p.id, name: p.name, coordinates: p.coordinates })) } } } }
    const { page, calls } = bootPage(noTime)
    page.onLoad({ id: 'a1' })
    await page.reload()
    await waitFor(() => calls.length > 0)
    const first = calls[0]
    check('无时间戳+无入口日期时发出 2026-10-03（活动出发日）',
      !!first && first.date === '2026-10-03', first ? first.date : 'getWeather 未被调用')
    check('页面日期非空', /^\d{4}-\d{2}-\d{2}$/.test(page.data.date), page.data.date)
  }
}

// 8. 云函数预报窗口从所选日起（A 组回归）
// fetchForecast 会真外呼 Open-Meteo，这里把 https.get 桩掉，走真实切片逻辑。

const https = require('https')
const wf = require('../cloudfunctions/trailApi/lib/weather')

const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600]

// 造一份 Open-Meteo 返回体：从 from 起 n 天逐小时 + 逐日
function fakeOpenMeteo(from, n) {
  const times = []
  for (let i = 0; i < n * 24; i++) {
    times.push(addDays(from, Math.floor(i / 24)) + 'T' + String(i % 24).padStart(2, '0') + ':00')
  }
  const hourly = { time: times }
  const fill = (k, v) => { hourly[k] = times.map(() => v) }
  fill('temperature_2m', 12); fill('apparent_temperature', 11)
  fill('precipitation_probability', 10); fill('precipitation', 0); fill('showers', 0)
  fill('weather_code', 2); fill('wind_speed_10m', 7); fill('wind_gusts_10m', 12)
  fill('relative_humidity_2m', 60); fill('cloud_cover_low', 20)
  fill('cloud_cover_mid', 30); fill('cloud_cover_high', 40)
  fill('uv_index', 3); fill('visibility', 20000); fill('freezing_level_height', 4000)
  LEVELS.forEach(lv => { fill('cloud_cover_' + lv + 'hPa', 10); fill('geopotential_height_' + lv + 'hPa', lv) })
  const dayList = []
  for (let i = 0; i < n; i++) dayList.push(addDays(from, i))
  const daily = {
    time: dayList,
    weather_code: dayList.map(() => 2),
    temperature_2m_max: dayList.map(() => 20), temperature_2m_min: dayList.map(() => 10),
    wind_speed_10m_max: dayList.map(() => 9), precipitation_sum: dayList.map(() => 0),
    precipitation_probability_max: dayList.map(() => 20), precipitation_hours: dayList.map(() => 0),
    sunrise: dayList.map(d => d + 'T06:30'), sunset: dayList.map(d => d + 'T18:40'),
    uv_index_max: dayList.map(() => 5),
  }
  return { elevation: 1234, hourly, daily }
}

// 桩掉 https.get：记录请求 URL，按 payload 应答
function stubHttps(payload, capture) {
  const saved = https.get
  https.get = (url, cb) => {
    capture.url = String(url)
    const res = {
      statusCode: 200,
      resume() {},
      on(ev, fn) { if (ev === 'data') capture._d = fn; else if (ev === 'end') capture._e = fn; return res },
    }
    process.nextTick(() => { cb(res); capture._d(JSON.stringify(payload)); capture._e() })
    return { on() { return this }, setTimeout() { return this } }
  }
  return () => { https.get = saved }
}

async function windowCases() {
  section('8. 云函数预报窗口从所选日起（A 组回归）')
  const today = wf.cnToday()
  const restores = []
  try {
    // 所选日 = 今天+5：窗口必须覆盖 今天 → 所选日+6 = 12 天，且序列锚定在所选日
    {
      const cap = {}
      restores.push(stubHttps(fakeOpenMeteo(today, 16), cap))
      const f = await wf.fetchForecast(30.9, 103.4, addDays(today, 5))
      const fd = new URL(cap.url).searchParams.get('forecast_days')
      check('forecast_days 覆盖 今天→所选日+6（12 天）', fd === '12', fd)
      check('series 首日 = 所选日（不是今天）', f.series[0] && f.series[0].d === addDays(today, 5),
        f.series[0] && f.series[0].d)
      check('series 整 7 天 168 小时', f.series.length === 168, String(f.series.length))
      check('days 首日 = 所选日（与图同窗）', f.days[0] && f.days[0].date === addDays(today, 5),
        f.days[0] && f.days[0].date)
      check('days 整 7 条', f.days.length === 7, String(f.days.length))
      check('detail 是所选日 24 小时', f.detail.length === 24, String(f.detail.length))
    }
    // 所选日 = 今天+12：Open-Meteo 上限 16 天，只拿得到 4 天——有多少给多少，但首日仍须锚定
    {
      const cap = {}
      restores.push(stubHttps(fakeOpenMeteo(today, 16), cap))
      const far = addDays(today, 12)
      const f = await wf.fetchForecast(30.9, 103.4, far)
      const fd = new URL(cap.url).searchParams.get('forecast_days')
      check('远期 forecast_days 封顶 16', fd === '16', fd)
      check('远期 series 首日仍 = 所选日', f.series[0] && f.series[0].d === far, f.series[0] && f.series[0].d)
      check('远期有多少给多少（4 天 96 小时）', f.series.length === 96, String(f.series.length))
      check('远期 days 首日 = 所选日', f.days[0] && f.days[0].date === far, f.days[0] && f.days[0].date)
    }
  } finally {
    restores.forEach(fn => fn())
  }
}

// 9. meteogram 布局不变量（把这次评审修掉的坑钉住）
// 几何从组件里抽到 layout.js 就是为了这里能直接断言——以前这些只能靠肉眼看截图。
section('9. meteogram 布局不变量')

const LAY = require('../miniprogram/components/meteogram/layout.js')

{
  const order = ['marks', 'temp', 'rain', 'cloud', 'bandProfile', 'wind', 'code', 'axis']
  let overlap = ''
  for (let i = 0; i < order.length - 1; i++) {
    const a = LAY.ROW[order[i]]
    const b = LAY.ROW[order[i + 1]]
    if (a.y + a.h > b.y) overlap = order[i] + '(' + a.y + '+' + a.h + ') > ' + order[i + 1] + '(' + b.y + ')'
  }
  check('行与行不重叠（V2 新增云带剖面/风行后）', !overlap, overlap)
  check('画布高度覆盖最后一行', LAY.CHART_H >= LAY.ROW.axis.y + LAY.ROW.axis.h,
    LAY.CHART_H + ' < ' + (LAY.ROW.axis.y + LAY.ROW.axis.h))
  // V2 云带剖面的海拔映射：0/6000m 映射到行内上下缘，中点居中
  const bp = LAY.ROW.bandProfile
  check('bandAltY 0m 落在行底、6000m 落在行顶',
    Math.abs(LAY.bandAltY(0, bp) - (bp.y + bp.h - 2)) < 0.01
    && Math.abs(LAY.bandAltY(6000, bp) - (bp.y + 2)) < 0.01,
    LAY.bandAltY(0, bp) + '/' + LAY.bandAltY(6000, bp))
  check('bandAltY 越界海拔被夹住（-500 → 0m 端，9000 → 6000m 端）',
    LAY.bandAltY(-500, bp) === LAY.bandAltY(0, bp) && LAY.bandAltY(9000, bp) === LAY.bandAltY(6000, bp))

  // 左刻度栏必须装得下最长标签 `高/中/低`（原来是 34px，右对齐会左溢出到 x=-15 被裁）
  // 刻度栏画布字体是 9px，textWidth 必须按同一字号算
  const widest = LAY.textWidth('高/中/低', 9)
  check('刻度栏装得下最长标签 `高/中/低`（宽 ' + Math.round(widest) + '）',
    LAY.PAD_L - 4 >= widest + 4, LAY.PAD_L + ' vs ' + Math.round(widest))
  // `mm/h`（左对齐 x=2）与极值（右对齐到 PAD_L-4）不能叠
  const gutterRoom = LAY.PAD_L - 4 - (2 + LAY.textWidth('mm/h', 9))
  check('mm/h 与极值不重叠（余 ' + Math.round(gutterRoom) + 'px）',
    gutterRoom >= LAY.textWidth('12.0', 9) + 4, '余 ' + Math.round(gutterRoom))

  // 时间轴两行不能抢同一个 y（原来是 y+14 与 y+14，日分隔格必然双重曝光）
  check('日期行与小时行分开（差 ' + (LAY.AXIS_HOUR_DY - LAY.AXIS_DAY_DY) + 'px）',
    LAY.AXIS_HOUR_DY - LAY.AXIS_DAY_DY >= 12, String(LAY.AXIS_HOUR_DY - LAY.AXIS_DAY_DY))
  check('小时标签落在轴行内',
    LAY.AXIS_HOUR_DY + 9 <= LAY.ROW.axis.h, LAY.AXIS_HOUR_DY + ' + 9 > ' + LAY.ROW.axis.h)

  // 3 条泳道必须放得进标记行（这是"被盖掉的标签"问题的根因所在）
  const lanesNeed = LAY.MARK_LANE_H * 3 + LAY.MARK_LANE_GAP * 2
  check('3 条泳道放得进标记行（需 ' + lanesNeed + '，有 ' + LAY.ROW.marks.h + '）',
    lanesNeed <= LAY.ROW.marks.h, lanesNeed + ' > ' + LAY.ROW.marks.h)
  check('温度行放得下三档刻度', LAY.ROW.temp.h >= 40, String(LAY.ROW.temp.h))

  // 浅色块上的字要用深墨：黄金 #D6A33C 上的白字对比度只有 ~1.9:1
  check('黄金色块用深墨（白字看不清）', LAY.inkOn('#D6A33C') !== '#FFFFFF', LAY.inkOn('#D6A33C'))
  check('星空色块用白字', LAY.inkOn('#2D533F') === '#FFFFFF', LAY.inkOn('#2D533F'))
  check('云海色块用白字', LAY.inkOn('#346583') === '#FFFFFF', LAY.inkOn('#346583'))
}

{
  // 图例必须**动态**：只列图上真出现过的窗口（原来是固定 7 项，看着像 tag 云）
  const prevComponent = global.Component
  global.Component = cfg => { global.__COMP_CFG = cfg }
  delete require.cache[require.resolve('../miniprogram/components/meteogram/meteogram.js')]
  require('../miniprogram/components/meteogram/meteogram.js')
  const cfg = global.__COMP_CFG
  global.Component = prevComponent

  const comp = Object.assign({}, cfg.methods || {}, cfg)
  comp.data = JSON.parse(JSON.stringify(cfg.data || {}))
  comp.setData = function (patch) { Object.assign(this.data, patch) }

  comp.data.marks = { '2026-10-03T21:00': ['star'], '2026-10-03T22:00': ['star', 'galaxy'] }
  comp.refreshLegend()
  check('图例只列出现过的（星空、银河）',
    comp.data.legend.map(i => i.k).join(',') === 'star,galaxy', comp.data.legend.map(i => i.k).join(','))

  comp.data.marks = {}
  comp.refreshLegend()
  check('没有天相窗口时图例为空并给出说明',
    comp.data.legend.length === 0 && /没有/.test(comp.data.legendTip), comp.data.legendTip)

  comp.data.marks = { '2026-10-03T05:00': ['cloudSea'], '2026-10-03T18:00': ['alpenglow', 'golden'] }
  comp.refreshLegend()
  check('云海与晨昏光都列出', comp.data.legend.length === 3,
    comp.data.legend.map(i => i.k).join(','))
}

// 9b. 点图换算 tapColumn（滚动映射回归）：e.detail.x 是页面坐标，canvas 在横滚
// scroll-view 里，滚动后 boundingClientRect().left 为负——直接减 PAD_L 不算滚动，
// 滑到第 4 天点屏中部会落回 series 首日（2026-09-30 开发者工具实测复现后修复）。
const LAYOUT = require('../miniprogram/components/meteogram/layout')
section('9b. 点图换算 tapColumn（滚动映射回归）')
{
  // 页面左 padding 20 + 卡片内边距 16 → 未滚动时 canvas 左缘 ≈36
  check('未滚动：屏中部 x=180 → 第 1 天 04 时列', LAYOUT.tapColumn(180, 36, 22) === 4,
    LAYOUT.tapColumn(180, 36, 22))
  const scrolledLeft = 36 - 1584 // scrollLeft = 3 天 × 24 列 × 22px
  check('滚到第 4 天：屏中部 x=180 → 内容列 76（第 4 天 04 时）',
    LAYOUT.tapColumn(180, scrolledLeft, 22) === 76, LAYOUT.tapColumn(180, scrolledLeft, 22))
  check('同一内容列两种坐标路径等价（rect.left 已含 -scrollLeft，不得重复加滚移）',
    LAYOUT.tapColumn(180 + 1584, 36, 22) === LAYOUT.tapColumn(180, scrolledLeft, 22))
  check('点在刻度栏返回负列（由 series 守卫吞掉）', LAYOUT.tapColumn(0, 36, 22) < 0)
  check('hourWidth 收敛：放大模式 44px 列宽照常换算',
    LAYOUT.tapColumn(180, 36, 44) === Math.floor((180 - 36 - 52) / 44))
}

// 10. 全图展示（横屏页）：数据交接与"全览"列宽反推
section('10. 全图展示（横屏页）')

const chartStore = require('../miniprogram/utils/chart-store')
const FC_PATH = require.resolve('../miniprogram/pages/weather-chart/weather-chart.js')

function fcConfig() {
  global.Page = cfg => { global.__FC_CFG = cfg }
  delete require.cache[FC_PATH]
  require(FC_PATH)
  return global.__FC_CFG
}

{
  const cfg = pageConfig()
  const page = makePage(cfg)
  page.data.date = DATE
  page.view = { activity: { routeSnapshot: { points: [{ coordinates: COORD, name: '冷杉坪' }] } } }
  const result = {
    series: fakeSeries(DATE, 7),
    days: fakeDays(DATE, 7),
    updatedAt: DATE + 'T06:00:00+08:00',
    pointElevation: 1500,
  }
  chartStore.clear()
  page.applyWeather(result, { name: '冷杉坪', coordinates: COORD }, {})
  const p = chartStore.get()
  check('天气页把 7 天图表交给横屏页（store）', !!p && p.series.length === 168,
    p ? String(p.series.length) : 'null')
  check('store 带节点名（横屏页标题用）', !!p && p.pointName === '冷杉坪', p && p.pointName)
  check('store 的选中日 = 所选日', !!p && p.selected[DATE] === true, p && Object.keys(p.selected || {}))
  check('store 的 marks/night 与页面数据同源',
    !!p && p.marks === page.data.chartMarks && p.night === page.data.chartNight)

  const savedWx = global.wx
  global.wx = { getSystemInfoSync: () => ({ windowWidth: 780, windowHeight: 390 }) }
  try {
    const fcfg = fcConfig()
    const make = () => {
      const pg = Object.assign({}, fcfg)
      pg.data = JSON.parse(JSON.stringify(fcfg.data || {}))
      pg.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) cb() }
      return pg
    }

    // 空 store：不崩、给可理解的空态
    chartStore.clear()
    let pg = make()
    pg.onLoad()
    check('store 为空时进空态而不是崩', pg.data.ready === true && pg.data.hasData === false)

    // 有数据
    chartStore.set(p)
    pg = make()
    pg.onLoad()
    check('读到 store 后进入图表态', pg.data.hasData === true && pg.data.series.length === 168,
      String(pg.data.series.length))
    check('标题给日期区间（9/28 – 10/4 · 7 天）', pg.data.range === '9/28 – 10/4 · 7 天', pg.data.range)

    // 全览 = 按屏宽反推列宽，且必须真的塞得进视口
    pg.applyMode('fit')
    const vw = 780
    const chartW = 52 + 168 * pg.data.hourWidth + 8
    check('全览列宽按屏宽反推（780 → ' + pg.data.hourWidth + '）', pg.data.hourWidth === 4,
      String(pg.data.hourWidth))
    check('全览下整张图塞得进视口（' + chartW + ' ≤ ' + (vw - 32) + '）',
      chartW <= vw - 32, String(chartW))
    check('全览列宽不低于下限 3', pg.data.hourWidth >= 3, String(pg.data.hourWidth))

    pg.applyMode('std')
    check('标准 = 22（layout.HOUR_W）', pg.data.hourWidth === 22, String(pg.data.hourWidth))
    pg.applyMode('big')
    check('放大 = 44', pg.data.hourWidth === 44, String(pg.data.hourWidth))

    // 极窄视口必须被下限夹住，不能算出 0/负数把图画没
    global.wx = { getSystemInfoSync: () => ({ windowWidth: 120 }) }
    pg.applyMode('fit')
    check('极窄视口下夹到下限 3', pg.data.hourWidth === 3, String(pg.data.hourWidth))

    // 点某小时 → 头部读数
    global.wx = { getSystemInfoSync: () => ({ windowWidth: 780 }) }
    pg.onPickHour({ detail: { date: DATE, t: '06:00' } })
    check('点图上小时给出读数', /^9\/28 06:00/.test(pg.data.picked), pg.data.picked)

    // 组件列宽收敛
    global.Component = cfg2 => { global.__COMP_CFG2 = cfg2 }
    delete require.cache[require.resolve('../miniprogram/components/meteogram/meteogram.js')]
    require('../miniprogram/components/meteogram/meteogram.js')
    const mcfg = global.__COMP_CFG2
    global.Component = undefined
    const mw = v => {
      const c = Object.assign({}, mcfg.methods || {}, mcfg)
      c.data = Object.assign({}, mcfg.data, { hourWidth: v })
      return c.hourWidth()
    }
    check('列宽下限 3', mw(1) === 3, String(mw(1)))
    check('列宽上限 72', mw(999) === 72, String(mw(999)))
    check('未给列宽时回退标准 22', mw(0) === 22 && mw('x') === 22, mw(0) + '/' + mw('x'))
  } finally {
    global.wx = savedWx
  }
}

// 11. 新客户端配旧云函数：部署前的必答题
// A 组同时改了服务端窗口锚定和客户端 covers()。但**云函数部署与小程序热重载不是同一刻**——
// 未部署时线上跑的是旧版 fetchForecast：`days = diff+2`（从今天起）、
// `series = times.slice(0,168)`（也锚今天）。旧版窗口 diff+2 必然覆盖所选日，
// 所以 days 里找得到所选日、series 里却不一定有（旧 series 固定 7 天 = 今天起 168 小时）。
// 这里如实复刻旧版返回体，验证客户端在两种所选日距离下的真实行为。
section('11. 新客户端配旧云函数：部署前的必答题')

// 如实复刻旧版 fetchForecast 的返回体
function oldServerResult(today, selectedDate) {
  const diff = Math.round((Date.parse(selectedDate + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000)
  const win = Math.min(16, Math.max(1, diff + 2))       // 旧版：diff+2
  const times = fakeSeries(today, win)                   // 从今天的 win 天逐小时
  return {
    pointId: 'p1',
    series: times.slice(0, 168),                         // 旧版：固定前 168 小时，锚今天
    days: fakeDays(today, win),                          // 旧版：全部 win 天，从今天起
    detail: [],
    updatedAt: today + 'T06:00:00+08:00',
  }
}

{
  const cfg = pageConfig()
  const page = makePage(cfg)
  const today = wf.cnToday()

  // ---- 场景一：所选日 = 今天+3（旧版窗口内，series 也覆盖得到）----
  {
    const selected = addDays(today, 3)
    const r = oldServerResult(today, selected)
    check('近程：旧版 series 锚在今天', r.series[0].d === today, r.series[0].d)
    check('近程：旧版 days 里含所选日', r.days.some(d => d.date === selected), selected)

    page.data.date = selected
    const chart = page.buildChartSeries(r.series, selected)
    const cards = page.buildDayCards(r.days, COORD)
    check('近程：图锚在所选日', chart[0].d === selected, chart[0].d)
    check('近程：卡锚在所选日', cards[0].date === selected, cards[0].date)
    check('近程：图与卡同窗', chart[0].d === cards[0].date,
      '图 ' + chart[0].d + ' vs 卡 ' + cards[0].date)
  }

  // ---- 场景二：所选日 = 今天+10（旧版 series 只有 7 天，够不到）----
  {
    const selected = addDays(today, 10)
    const r = oldServerResult(today, selected)
    check('远期：旧版 series 够不到所选日（这是错位的根源）',
      !r.series.some(h => h.d === selected), selected)
    check('远期：旧版 days 仍含所选日（所以客户端兜底不会整体退回）',
      r.days.some(d => d.date === selected), selected)

    page.data.date = selected
    const chart = page.buildChartSeries(r.series, selected)
    const cards = page.buildDayCards(r.days, COORD)

    // 这是本次测试的真正结论：未部署云函数时，图会退回今天、卡停在所选日 → 错位
    check('**未部署云函数 + 所选日≥7天：图退回今天、卡停在所选日（错位）**',
      chart[0].d === today && cards[0].date === selected,
      '图 ' + chart[0].d + ' vs 卡 ' + cards[0].date)

    // 但客户端的缓存契约是安全的：不会拿错锚的返回体当命中（宁可重取）
    check('远期：错锚返回体不被判为可覆盖（缓存契约仍安全）',
      cfg.covers(r, selected, 'p1') === false)
  }

  // ---- 客户端侧唯一能保证的不变量，与服务端版本无关 ----
  {
    const r = { pointId: 'p1', series: fakeSeries(addDays(today, 3), 2), days: fakeDays(today, 5), detail: [], updatedAt: today }
    check('错锚返回体一律不判为可覆盖（series[0].d !== date 时必重取）',
      cfg.covers(r, today, 'p1') === false)
    check('同点同日且已锚定才判可覆盖',
      cfg.covers({ pointId: 'p1', series: fakeSeries(today, 7), days: fakeDays(today, 5), detail: [], updatedAt: today }, today, 'p1') === true)
  }

  // ---- 天相标记与夜间底色不依赖服务端新增字段，旧版返回体也应算得出 ----
  {
    const r = oldServerResult(today, addDays(today, 3))
    const marks = page.buildChartMarks(r.series, COORD, 1500, false, r.days)
    const night = page.buildNightMap(r.series, COORD, 1500)
    check('旧版返回体也能算出天相标记', Object.keys(marks).length > 0, String(Object.keys(marks).length))
    check('旧版返回体也能算出夜间底色', Object.keys(night).length > 0, String(Object.keys(night).length))
  }
}

// ============ 11b. 统一卡读数 r2/r3：海拔与云态解读（真机 bug 回归）============
// 真机 375px 截图实证的 bug 现场：r2 = 「海拔 undefined m 云量 null%」、r3 解读行整行缺失。
// 根因：applyUnifiedSelection 读 u.geo.userAlt，但 buildUnified 返回体把海拔嵌在
// cloud.userAlt 下、顶层根本没有 userAlt → inferState 三路比较全收到 undefined →
// cUser/key 恒 null。B 形态的 span 云区行不依赖 userAlt（改前即绿）= 回归护栏。
{
  section('11b. 统一卡读数 r2/r3：海拔与云态解读（真机 undefined/null 回归）')

  const mkCloudLevels = covers => {
    const times = []
    for (let i = 0; i < 48; i++) times.push(addDays(DATE, Math.floor(i / 24)) + 'T' + String(i % 24).padStart(2, '0') + ':00')
    return {
      times,
      levels: covers.map(c => ({ altitudes: times.map(() => c.alt), cloudCover: times.map(() => c.cov) })),
    }
  }
  const mkResult = (covers, updatedAt) => ({
    pointId: 'p1',
    series: fakeSeries(DATE, 2),
    days: fakeDays(DATE, 3),
    detail: [],
    updatedAt,
    cloudLevels: mkCloudLevels(covers),
  })
  const runPick = (covers, q, updatedAt) => {
    /* q = { ele, eleSrc, modelEle }：走真实分类器 format.resolveElev，
       页面拿到的 elevation / elevSource / elevBasis 与线上完全同路（不在测试里另判一次）。 */
    const page = makePage(pageConfig())
    page.data.date = DATE
    page.data.viewSpan = 24
    page.data.chartPick = { date: DATE, t: '13:00' }
    const EV = require('../miniprogram/utils/format').resolveElev(q.ele, q.eleSrc, q.modelEle)
    page.elevSource = EV.source
    page.elevBasis = EV.basis
    page._runPickEV = EV
    const card = page.buildUnifiedCard(mkResult(covers, updatedAt), EV.elevation)
    if (card) card._page = page   // 判据要看 geo / 分类结果；不给生产卡加字段
    return card
  }
  const noLeak = card => !!card && !/undefined|null/.test([card.r1, card.r2, card.r3, card.r4].join(' '))
  const dump = card => card ? [card.r1, card.r2, card.r3, card.r4].join(' | ') : 'card=null'

  // A：此点 3500m 在覆盖区 [1000,5000] 内，该海拔云量 65% ≥ IN_C(60) → 三态之一「此点正处于云中」
  {
    const card = runPick([{ alt: 1000, cov: 10 }, { alt: 3500, cov: 65 }, { alt: 5000, cov: 20 }], { ele: 3500, eleSrc: 'picked' }, DATE + 'T10:00:00+08:00')
    check('11b-A 卡构建成功（src/selSrc 非空）', !!card && !!card.src && !!card.selSrc, dump(card))
    check('11b-A r1 = 13:00 · 12° …', !!card && /^13:00 · 12° /.test(card.r1), card && card.r1)
    check('11b-A r2 = 海拔 3,500 m 云量 65%', !!card && card.r2 === '海拔 3,500 m 云量 65%', card && card.r2)
    check('11b-A r3 = 此点正处于云中（stKey=in）', !!card && card.r3 === '此点正处于云中' && card.stKey === 'in',
      card && (card.r3 + '/' + card.stKey))
    check('11b-A r1-r4 无 undefined/null 泄漏', noLeak(card), dump(card))
  }

  // B：云量 80% 厚层 → span 云区行（span 不读 userAlt，改前即绿 = 回归护栏）
  {
    const card = runPick([{ alt: 1000, cov: 10 }, { alt: 3500, cov: 80 }, { alt: 5000, cov: 20 }], { ele: 3500, eleSrc: 'picked' }, DATE + 'T10:01:00+08:00')
    check('11b-B 卡构建成功（src/selSrc 非空）', !!card && !!card.src && !!card.selSrc, dump(card))
    check('11b-B r2 = 云量 80% · 云区 3,150–3,750 m', !!card && card.r2 === '云量 80% · 云区 3,150–3,750 m', card && card.r2)
    check('11b-B r3 = 此点正处于云中（stKey=in）', !!card && card.r3 === '此点正处于云中' && card.stKey === 'in',
      card && (card.r3 + '/' + card.stKey))
    check('11b-B r1-r4 无 undefined/null 泄漏', noLeak(card), dump(card))
  }

  // C：此点 500m 低于覆盖区（lo=max(SCAN_MIN,1000)=1000）→ 云层在此点上方；cUser 不可采样 → 云量 —
  {
    const card = runPick([{ alt: 1000, cov: 10 }, { alt: 3500, cov: 65 }, { alt: 5000, cov: 20 }], { ele: 500, eleSrc: 'gpx' }, DATE + 'T10:02:00+08:00')
    check('11b-C 卡构建成功（src/selSrc 非空）', !!card && !!card.src && !!card.selSrc, dump(card))
    check('11b-C r2 = 海拔 500 m 云量 —', !!card && card.r2 === '海拔 500 m 云量 —', card && card.r2)
    check('11b-C r3 = 云层在此点上方（stKey=mid）', !!card && card.r3 === '云层在此点上方' && card.stKey === 'mid',
      card && (card.r3 + '/' + card.stKey))
    check('11b-C r1-r4 无 undefined/null 泄漏', noLeak(card), dump(card))
  }

  // D：浓云整体在此点之下 → 第三态；r3 必须与图例同源
  {
    const card = runPick([{ alt: 1000, cov: 5 }, { alt: 2000, cov: 90 }, { alt: 2500, cov: 90 }, { alt: 5000, cov: 5 }],
      { ele: 4200, eleSrc: 'picked' }, DATE + 'T10:03:00+08:00')
    check('11b-D r3 = 云带在此点下方（stKey=ok）', !!card && card.r3 === '云带在此点下方' && card.stKey === 'ok',
      card && (card.r3 + '/' + card.stKey))
    check('11b-D 图例与 r3 同源：入云小时的「琥珀段」文字 = r3 那一档',
      !!card && card.legendIn === '此点正处于云中' && card.legendIn !== card.r3, card && card.legendIn)
  }

  // E：主语治理——地图选点与手填坐标都不得写成「你」
  ;[['picked', '地图选点'], ['manual', '手动填写'], ['gpx', 'GPX 记录']].forEach(([src, nm]) => {
    const card = runPick([{ alt: 1000, cov: 10 }, { alt: 3500, cov: 80 }, { alt: 5000, cov: 20 }], { ele: 3500, eleSrc: src }, DATE + 'T10:04:00+08:00')
    check('11b-E ' + nm + '（3500m 在云带里）：r3 用查询点主语、不出现「你」',
      !!card && card.r3 === '此点正处于云中' && card.r3.indexOf('你') === -1 && card.readout.indexOf('你') === -1,
      card && card.r3)
  })

  // F：完全没有可信海拔（点没有高程，返回体也没有模型地形高度）
  {
    const card = runPick([{ alt: 1000, cov: 10 }, { alt: 3500, cov: 80 }, { alt: 5000, cov: 20 }], {}, DATE + 'T10:05:00+08:00')
    check('11b-F 无海拔：不给任何三态结论（r3 空、stKey 空）', !!card && card.r3 === '' && card.stKey === '', dump(card))
    check('11b-F 无海拔：图上不画「此点」参考线（旧实现会把 null 钳成 2000m 并标出字来，凭空捏造一个位置）',
      (() => {
        const UMG = require('../miniprogram/utils/meteogram-svg')
        const geo = card._page._unified.geo
        const svg = UMG.renderUnifiedBase(geo, {}).svg
        return geo.cloud.userAlt === null && !/此点 /.test(svg)
      })(), '见 renderUnifiedBase 输出')
    check('11b-F 无海拔：r1-r4 无 undefined/null 泄漏', noLeak(card), dump(card))
    check('11b-F 无海拔：云区事实行照给（数据本身有效，只是判不出与它的高低关系）',
      !!card && /^云量 \d+% · 云区 /.test(card.r2), card && card.r2)
    /* 真机取证抓到的原错：没有高程时图例走了「点在窗外」那一支，拼出
       「此点在剖面下方 null m」——把「不知道」又写成了一个数值。图例必须分清这两种「没有虚线」。 */
    check('11b-F 无海拔：图例说「海拔未知」，不得出现 null/NaN，也不得谎称有虚线',
      !!card && card.elevShown === false && card.legendElev === require('../miniprogram/utils/format').cloudLegendNoElev() &&
        !/null|NaN/.test(card.legendElev), card && card.legendElev)
  }

  // G：模型估算海拔（±300–600m）而云带底缘就落在这一带 → 判不出方向，不是「晴空」也不是「云在上方」
  {
    const covers = [{ alt: 4000, cov: 90 }, { alt: 4600, cov: 90 }]
    const est = runPick(covers, { modelEle: 3650 }, DATE + 'T10:06:00+08:00')
    check('11b-G 出处分类走 estimated（由 format.resolveElev 判，页面不再自造分类）',
      !!est && est._page._runPickEV.basis === 'estimated', est && est._page._runPickEV.basis)
    check('11b-G 模型海拔 3650 + 云带 4000–4600：不给确定结论（r3 空）', !!est && est.r3 === '' && est.stKey === '', dump(est))
    /* 反向对照（同一条数据、同一个数字 3650，只把出处换成可信高程）：必须给出「云层在此点上方」。
       没有这条对照，"r3 为空"可能只是判据坏了而不是在弃权。 */
    const trusted = runPick(covers, { ele: 3650, eleSrc: 'picked' }, DATE + 'T10:06:00+08:00')
    check('11b-G 反向对照：同一个 3650m 若是可信高程 ⇒ 明确判「云层在此点上方」',
      !!trusted && trusted.r3 === '云层在此点上方' && trusted.stKey === 'mid', trusted && (trusted.r3 + '/' + trusted.stKey))
    check('11b-G r1-r4 无 undefined/null 泄漏', noLeak(est) && noLeak(trusted), dump(est) + ' || ' + dump(trusted))
  }
  // H：图例跟着图走 + 判读不随显示窗漂移（页面级，2026-10-09 显示窗自适应轮）
  {
    const FMT = require('../miniprogram/utils/format')
    const insideCard = runPick([{ alt: 1000, cov: 5 }, { alt: 2500, cov: 90 }, { alt: 3200, cov: 88 }, { alt: 4000, cov: 5 }],
      { ele: 3000, eleSrc: 'picked' }, DATE + 'T10:07:00+08:00')
    const gp = insideCard._page._unified.geo.profile
    check('11b-H 点在窗内：图例写「虚线 = 此点海拔」且画板开关为真',
      insideCard.elevShown === true && insideCard.legendElev === FMT.cloudLegendElev() &&
        3000 >= gp.lo && 3000 <= gp.hi, JSON.stringify([gp.lo, gp.hi, insideCard.legendElev]))
    const outCard = runPick([{ alt: 1000, cov: 5 }, { alt: 2500, cov: 90 }, { alt: 3200, cov: 88 }, { alt: 4000, cov: 5 }],
      { ele: 6200, eleSrc: 'picked' }, DATE + 'T10:08:00+08:00')
    const gp2 = outCard._page._unified.geo.profile
    check('11b-H 点在窗外：图例不谎称有虚线，且那句话与图上印的逐字相同（图例=图，不是两套话）',
      outCard.elevShown === false && gp2.pointOutside === 'above' &&
        (() => {
          const UMGx = require('../miniprogram/utils/meteogram-svg')
          const svg = UMGx.renderUnifiedBase(outCard._page._unified.geo, {}).svg
          return outCard.legendElev.length > 0 && svg.indexOf(outCard.legendElev) >= 0
        })(),
      JSON.stringify([gp2.pointOutside, gp2.pointOutsideDelta, outCard.legendElev]))
    /* 判读必须是显示窗的无关量：把跨度上限改到极小（窗一定会变），同一小时同一海拔的 r3 不许变。
       这一条防的是「窗反过来污染判读」——那会让同一份数据因为图怎么画而给出不同结论。 */
    const CFFm = require('../miniprogram/utils/cloud-field-svg.js')
    const snap = Object.assign({}, CFFm.PROFILE)
    const before = { r1: insideCard.r1, r2: insideCard.r2, r3: insideCard.r3, stKey: insideCard.stKey }
    CFFm.PROFILE.MAX_SPAN = 1000
    CFFm.PROFILE.PAD_M = 0
    const shrunk = runPick([{ alt: 1000, cov: 5 }, { alt: 2500, cov: 90 }, { alt: 3200, cov: 88 }, { alt: 4000, cov: 5 }],
      { ele: 3000, eleSrc: 'picked' }, DATE + 'T10:07:00+08:00')
    Object.keys(snap).forEach(k => { CFFm.PROFILE[k] = snap[k] })
    check('11b-H 变异证明：窗被压缩后页面判读逐字不变（r3/stKey/r2 全部相同）',
      shrunk.r3 === before.r3 && shrunk.stKey === before.stKey &&
        shrunk._page._unified.geo.profile.hi - shrunk._page._unified.geo.profile.lo <= 1000 &&
        before.r3 !== '', JSON.stringify([before.r3, shrunk.r3,
          [shrunk._page._unified.geo.profile.lo, shrunk._page._unified.geo.profile.hi]]))
  }
}

// ============ 12. local 模式（P3 独立天气模块 §5）============
// 单点与轨迹组共用同一查询视图：不 read 活动、日期第一轮落定、分享降精度（决策 b）、
// 轨迹组按 §5.4 展开抵达日程且基准日不随切日前漂。加载真页面配置（同第 7 节手法）。
const WPm = require('../miniprogram/utils/watch-points')
const ISO = /^\d{4}-\d{2}-\d{2}$/

async function localCases() {
  section('12. local 模式：单点 / 轨迹组 / 分享降精度 / 保存此点')

  // weather.js 在 require 时捕获 draft.wxStorage（模块级 createWatchPoints），
  // 必须在 pageConfig() 之前 patch，再逐次重取页面源码。
  const draft = require('../miniprogram/utils/draft')
  const storageMap = new Map()
  draft.wxStorage = {
    get: k => (storageMap.has(k) ? storageMap.get(k) : null),
    set: (k, v) => storageMap.set(k, v),
  }

  const modalCalls = []
  const toasts = []
  const navTitles = []
  global.wx = {
    showModal: o => { modalCalls.push(o) },
    showToast: o => { toasts.push(o) },
    setNavigationBarTitle: o => { navTitles.push(o && o.title) },
    hideShareMenu: () => {},
  }

  const readCalls = []
  const byPointCalls = []
  const actCalls = []
  api.read = req => {
    readCalls.push(req)
    return Promise.resolve({ revision: 1, now: '', view: { kind: 'denied', message: 'local 模式不应读活动' } })
  }
  api.getWeather = (a, p, d) => { actCalls.push([a, p, d]); return new Promise(() => {}) }
  api.getWeatherByPoint = (lat, lng, d) => {
    byPointCalls.push([lat, lng, d])
    return Promise.resolve({
      status: 'ready', updatedAt: DATE + 'T10:00:00+08:00', pointElevation: 4250,
      days: fakeDays(DATE, 7), detail: [], series: fakeSeries(DATE, 7),
    })
  }

  // 轨迹组数据：经真实 fromGpx 组装（锚点 = 第 1 点 08:00，第 3 点 +25h）
  const trackSet = WPm.fromGpx({
    ok: true,
    points: [
      { name: '垭口', coordinates: { lat: 30.9458, lng: 103.4769 }, time: '2026-09-01T08:00:00+08:00', ele: 4200 },
      { name: '营地', coordinates: { lat: 30.9511, lng: 103.4822 }, time: '2026-09-01T15:00:00+08:00', ele: 4500 },
      { name: '', coordinates: { lat: 30.9600, lng: 103.4901 }, time: '2026-09-02T09:00:00+08:00', ele: 5000 },
    ],
    track: [], distanceKm: 21.3, ascentM: 1200, suggestions: null, stats: { hasElevation: true },
  }, '测试轨迹.gpx')
  storageMap.set(WPm.TRACKS_KEY, [trackSet])

  const boot = options => {
    const cfg = pageConfig()
    const page = makePage(cfg)
    page.onLoad(options)
    page.onShow()
    return page
  }

  // ---- 单点 ----
  {
    const page = boot({ src: 'local', lat: '31.06321', lng: '102.90856', name: encodeURIComponent('四姑娘山'), date: '2026-10-03' })
    check('单点：不发起 api.read', readCalls.length === 0)
    // resolveContext 是 Promise，setData 在微任务里——先等到查询发出，再回看第一轮 patch
    const ok = await waitFor(() => byPointCalls.length === 1)
    const first = page._patches.find(p => 'date' in p)
    check('单点：第一轮 setData 已带合法 date', !!first && ISO.test(first.date), first && first.date)
    check('单点：查询走 getWeatherByPoint 且入参齐全',
      ok && byPointCalls[0][0] === 31.06321 && byPointCalls[0][1] === 102.90856 && byPointCalls[0][2] === '2026-10-03',
      JSON.stringify(byPointCalls[0]))
    check('单点：不调用 getWeather', actCalls.length === 0)
    check('单点：静态点卡点名', !!page.data.pointCard && page.data.pointCard.name === '四姑娘山')
    check('单点：显示保存入口', page.data.showSave === true)
    check('单点：导航标题 = 点名', navTitles.indexOf('四姑娘山') !== -1)
  }

  // ---- 非法坐标 ----
  {
    const page = boot({ src: 'local', lat: '91', lng: '103' })
    await waitFor(() => !!page.data.denied)
    check('非法 lat → denied 且零外呼',
      /坐标/.test(page.data.denied) && byPointCalls.length === 1 && readCalls.length === 0, page.data.denied)
  }

  // ---- name 缺省 ----
  {
    const page = boot({ src: 'local', lat: '31.0632', lng: '102.9085' })
    await waitFor(() => !!page.data.pointCard)
    check('name 缺省走坐标文案（不显示"未命名"）',
      /北纬/.test(page.data.pointCard.name), page.data.pointCard && page.data.pointCard.name)
  }

  // ---- 保存此点 + 3dp 去重替换 ----
  {
    const page = boot({ src: 'local', lat: '31.0632', lng: '102.9085', name: 'TestPoint' })
    await waitFor(() => byPointCalls.length >= 2)
    page.onSavePoint()
    const afterFirst = storageMap.get(WPm.POINTS_KEY) || []
    check('保存此点：写入本地观察点', afterFirst.length === 1 && afterFirst[0].name === 'TestPoint')
    page.onSavePoint()
    check('同格再存触发去重确认', modalCalls.length === 1 && /已有很近的观察点/.test(modalCalls[0].title))
    modalCalls[0].success({ confirm: true })
    const after = storageMap.get(WPm.POINTS_KEY) || []
    check('确认替换后仍一条且沿用原行', after.length === 1 && after[0].name === 'TestPoint'
      && afterFirst[0].createdAt === after[0].createdAt)
    check('保存成功有 toast 反馈', toasts.some(t => /已存入观察点|已替换/.test(t.title)))
  }

  // ---- 分享（P3 §5.3 决策 (b)：只带 3dp 坐标与日期，不带 name/ele）----
  {
    const page = boot({ src: 'local', lat: '31.06321', lng: '102.90856', name: 'MtTest' })
    await waitFor(() => page.data.dayCards.length > 0)
    const share = page.onShareAppMessage()
    check('分享 path 只带 3dp 坐标与日期',
      /^\/pages\/weather\/weather\?src=local&lat=31\.063&lng=102\.909&date=\d{4}-\d{2}-\d{2}$/.test(share.path), share.path)
    check('分享 path 不带 name/ele（宁可少给信息也不泄露精确位置）',
      share.path.indexOf('name=') === -1 && share.path.indexOf('ele=') === -1, share.path)
    check('分享 title 含点名与日期',
      share.title.indexOf('MtTest') !== -1 && share.title.indexOf(page.data.date) !== -1, share.title)
  }

  // ---- 轨迹组：§5.4 抵达日程 + 基准日防漂 ----
  {
    const page = boot({ src: 'local', set: trackSet.id, point: 2, date: '2026-10-03' })
    check('轨迹组：不发起 api.read', readCalls.length === 0)
    const ok = await waitFor(() => page.data.pointLabels.length === 3)
    check('轨迹组：点集来自本地存储', ok)
    check('轨迹组：锚点 08:00 + 基准日 10-03 展开第 2 天抵达', page.data.date === '2026-10-04', page.data.date)
    check('轨迹组：picker 标签带第几天', /第2天/.test(page.data.pointLabels[2]), page.data.pointLabels[2])
    check('轨迹组：无静态点卡、无保存入口（节点已在组里）',
      page.data.pointCard === null && page.data.showSave === false)
    check('轨迹组：查询按当前节点坐标', byPointCalls.some(c => c[0] === 30.96 && c[1] === 103.4901 && c[2] === '2026-10-04'))

    // 防漂：用户切日后基准日固定——切到节点 1 日期回到它的抵达日，而非继续前漂
    const baseBefore = page._baseDate
    page.onDayTap({ currentTarget: { dataset: { date: '2026-10-05' } } })
    await waitFor(() => page.data.date === '2026-10-05')
    page.onPoint({ detail: { value: 1 } })
    // 查询在 setData 回调（异步）里发出——等真实调用落账，再断言
    const switched = await waitFor(() => byPointCalls.some(c => c[0] === 30.9511 && c[1] === 103.4822 && c[2] === '2026-10-03'))
    check('切日后基准日固定（无"日期前漂"循环）',
      page._baseDate === baseBefore && page.data.date === '2026-10-03',
      'base=' + page._baseDate + ' date=' + page.data.date)
    check('切节点再次查询按该节点坐标与抵达日', switched)
  }

  // ---- 组 id 失效 ----
  {
    const page = boot({ src: 'local', set: 'wt-gone' })
    await waitFor(() => !!page.data.denied)
    check('轨迹组已删除 → denied 且零外呼',
      /轨迹组已删除/.test(page.data.denied) && readCalls.length === 0, page.data.denied)
  }
}



/* 路线模式的海拔语义（2026-10-09 Weather V2 审计 §5.3）
 * 逐节点各用自己的高程：切换节点后图上的参考线、云场 userAltitude、判读都必须跟着走；
 * 节点自己没有高程时退回模型值并显式标来源，绝不沿用上一个节点的海拔（那是最像"对"的错）。 */
async function routeElevCases () {
  section('12. 路线模式：海拔必须跟着节点走')
  const C = { lat: 30.9, lng: 103.48 }
  const pts = [
    { id: 'p1', name: '垭口', time: '2026-10-03T08:00:00+08:00', coordinates: C, ele: 4200, eleSource: 'gpx' },
    { id: 'p2', name: '营地', time: '2026-10-03T15:00:00+08:00', coordinates: C, ele: 5000, eleSource: 'gpx' },
    { id: 'p3', name: '无名点', time: '2026-10-03T18:00:00+08:00', coordinates: C },
  ]
  const read = {
    revision: 1, now: '2026-10-03T09:00:00+08:00',
    view: {
      kind: 'activity', permittedActions: [],
      activity: { id: 'a1', title: '测试活动', startAt: '2026-10-03T07:00:00+08:00', routeSnapshot: { points: pts } },
    },
  }
  global.Page = cfg => { global.__PAGE_CFG = cfg }
  delete require.cache[PAGE_PATH]
  require(PAGE_PATH)
  const cfg = global.__PAGE_CFG
  api.read = () => Promise.resolve(read)
  /* 一条恒定云场：浓云带 4000–4600m，其余高度几乎无云。
     三个节点各自的海拔（4200 在带里 / 5000 在带下 / 无高程→模型 3650 在带内误差带上）
     必须给出三个不同的判读——「判读跟着节点走」才是真的按节点高程算，
     只测参考线数字换了而判读沿用第一个节点，是这个洞最常见的穿帮方式。 */
  const lvTimes = []
  for (let i = 0; i < 7 * 24; i++) lvTimes.push(addDays('2026-10-03', Math.floor(i / 24)) + 'T' + String(i % 24).padStart(2, '0') + ':00')
  const decks = [{ alt: 1000, cov: 5 }, { alt: 3900, cov: 10 }, { alt: 4000, cov: 92 }, { alt: 4600, cov: 90 }, { alt: 4700, cov: 10 }, { alt: 6000, cov: 5 }]
  api.getWeather = () => Promise.resolve({
    status: 'ready', updatedAt: '2026-10-03T09:00:00+08:00', pointElevation: 3650,
    days: fakeDays('2026-10-03', 7), detail: [], series: fakeSeries('2026-10-03', 7),
    cloudLevels: { times: lvTimes, levels: decks.map(d => ({ altitudes: lvTimes.map(() => d.alt), cloudCover: lvTimes.map(() => d.cov) })) },
  })
  const page = makePage(cfg)
  page.onLoad({ id: 'a1', date: '2026-10-03' })
  await page.reload()
  await waitFor(() => page.data.dayCards && page.data.dayCards.length > 0)

  check('节点 1：图上参考线海拔 = 该节点自己的 4200（不是活动起点、不是模型值）',
    page.data.chartElev === 4200, '实际 ' + page.data.chartElev)
  check('节点 1：出处记为 gpx（活动模式没有点卡——pointCard 只在 local 单点模式出现，海拔出处靠 elevSource 驱动图上标签）',
    page.elevSource === 'gpx', '实际 ' + page.elevSource)
  check('活动模式不渲染点卡（因此也不会在路线模式下写"此点海拔 X m"这类无来源文案）',
    page.data.pointCard === null)
  /* 判读必须跟着节点走：先点 13:00，读一次；切节点后重新点同一小时再读。
     只测「参考线数字换了」不够——那正是最容易穿帮的地方：图上的线跟着节点走了，
     r3 却还沿用第一个节点的海拔判出来的词。 */
  const pickRead = async () => {
    page.onChartPickHour({ detail: { date: '2026-10-03', t: '13:00' } })
    await waitFor(() => page.data.unified && page.data.unified.r1)
    const u = page.data.unified
    return { r3: u.r3, stKey: u.stKey, r2: u.r2 }
  }
  const n1 = await pickRead()
  check('节点 1（4200m，GPX 高程）判读：此点正处于云中',
    n1.r3 === '此点正处于云中' && n1.stKey === 'in', JSON.stringify(n1))
  page.onPoint({ detail: { value: 1 } })
  await waitFor(() => page.data.chartElev === 5000)
  check('切到节点 2：海拔跟着换成 5000（没有沿用上一节点）', page.data.chartElev === 5000, '实际 ' + page.data.chartElev)
  const n2 = await pickRead()
  check('节点 2（5000m）判读换成「云带在此点下方」——没有沿用节点 1 的结论',
    n2.r3 === '云带在此点下方' && n2.stKey === 'ok', JSON.stringify(n2))
  page.onPoint({ detail: { value: 2 } })
  await waitFor(() => page.data.chartElev === 3650)
  check('节点 3 无高程：退回模型值 3650，且出处标 model（不是沿用 5000）',
    page.data.chartElev === 3650 && page.elevSource === 'model',
    page.data.chartElev + ' / ' + page.elevSource)
  check('节点 3 的标签必须带「模型估算」：用页面此刻真实状态（chartElev + elevSource）合成图上文案',
    /模型估算/.test(require('../miniprogram/utils/format').elevLineLabel('3,650', page.elevSource)),
    'elevSource=' + page.elevSource)
  check('出处标签单源：model → 「模型地形估算」（页面不再自己写一份）',
    require('../miniprogram/utils/format').elevSourceLabel('model') === '模型地形估算')
  const n3 = await pickRead()
  check('节点 3（无高程 → 模型估算 3650，云带底缘 4000 就在误差带里）不给确定结论：r3 空',
    n3.r3 === '' && n3.stKey === '', JSON.stringify(n3))
  check('节点 3 弃权不等于「什么都没显示」：云区事实行照给（事实层不随解释层弃权）',
    /^云量 \d+% · 云区 /.test(n3.r2), n3.r2)
}

raceCases()
  .catch(e => { failed++; console.error('  ✗ 竞态用例执行异常（' + e.message + '）') })
  .then(windowCases)
  .catch(e => { failed++; console.error('  ✗ 窗口用例执行异常（' + e.message + '）') })
  .then(localCases)
  .catch(e => { failed++; console.error('  ✗ local 模式用例执行异常（' + e.message + '）') })
  .then(routeElevCases)
  .catch(e => { failed++; console.error('  ✗ 路线海拔用例执行异常（' + e.message + '）') })
  .then(() => {
    console.log('\npassed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
})

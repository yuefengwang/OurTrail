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

section('6. 窗口内复用：切日/切节点不外呼')
{
  // 镜像页面 covers() 的判定：series 自带 7 天，窗口内的日期不必再查
  const covers = (result, date, pointId) => {
    if (!result || result.pointId !== pointId) return false
    return (result.series || []).some(x => x.d === date) && (result.days || []).some(d => d.date === date)
  }
  const { times, h } = fakeHourly(4)
  const series = times.map((_, i) => hourView(times, h, i))
  const days = []
  for (let d = 0; d < 4; d++) days.push({ date: DATE, cloud: { low: 10, mid: 20, high: 20 } })
  // 构造 4 天不同的日期
  const dlist = []
  for (let d = 0; d < 4; d++) dlist.push(Date.parse(DATE + 'T00:00:00Z') + d * 86400000)
  const s2 = series.map((x, i) => ({ ...x, d: new Date(dlist[Math.floor(i / 24)]).toISOString().slice(0, 10) }))
  const dl = dlist.map(ms => ({ date: new Date(ms).toISOString().slice(0, 10) }))
  const cached = { pointId: 'p1', series: s2, days: dl, detail: [], updatedAt: DATE + 'T10:00:00+08:00' }
  const d0 = dl[0].date
  const d1 = dl[1].date
  check('缓存覆盖窗口内第 1 天', covers(cached, d0, 'p1'))
  check('缓存覆盖窗口内第 2 天（切日零外呼）', covers(cached, d1, 'p1'))
  check('窗口外不覆盖（需外呼）', covers(cached, '2026-10-20', 'p1') === false)
  check('换节点后不覆盖（pointId 不匹配）', covers(cached, d0, 'p2') === false)
  check('切日后能从 series 本地切出 detail（' + s2.filter(x => x.d === d1).length + ' 小时）',
    s2.filter(x => x.d === d1).length === 24)
}

// 7. 首屏/切节点的日期竞态（回归）
// 真机上 setData 回调在渲染后才异步回到逻辑层。若日期被放进回调里再设，
// 紧随其后同步发出的 fetchWeather 就读到上一次的空日期 → 发出 date:'' → 云函数回"日期无效"。
// 这里加载真页面（global.Page 捕获配置）+ 异步 setData 回调，把那条链原样跑一遍。
section('7. 首屏与切节点的日期竞态（回归）')

const api = require('../miniprogram/utils/api')
const PAGE_PATH = require.resolve('../miniprogram/pages/weather/weather.js')

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(cond, ms = 1500) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (cond()) return true; await sleep(5) }
  return cond()
}

// 造页面实例：数据同步并进 this.data，但回调像真机一样异步触发（竞态复现的关键）
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

raceCases().catch(e => { failed++; console.error('  ✗ 竞态用例执行异常（' + e.message + '）') }).then(() => {
  console.log('\npassed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
})


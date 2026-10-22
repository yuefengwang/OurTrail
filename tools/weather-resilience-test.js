// 天气韧性：超时 / 断网 / 气象服务故障时的恢复与话术
// node tools/weather-resilience-test.js
//
// 背景（用户报告）：天气页"常常获取天气超时"，且报错信息面向开发者
// （"请重新上传部署 cloudfunctions/trailApi…把超时改为 20 秒"），而使用者是户外人员。
// 本套件把四道防线钉住：
//   ① 传输层话术面向用户、错误码语义不变（与 scenario-api-test 分工：那里管协议层）
//   ② 读操作自动重试（瞬时故障不该让用户自己点重试）；
//   ③ 全部失败后本地缓存软降级（标明了时效的旧数据 > 一面错误墙）；
//   ④ 云端外呼失败时陈旧缓存兜底（stale 标记，页面据此标注"不是实时"）。
// 另钉住活动模式天气不再全量加载 15 个集合（当年 3 秒超时的成分之一）。
'use strict'
const path = require('path')
const Module = require('module')
const https = require('https')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const DEV_JARGON = /部署|上传并部署|控制台|cloudfunctions|504003|FUNCTIONS_TIME_LIMIT| trailApi| Require stack/i

/* ============================================================ 1. weather-cache 纯函数 */
section('1. 本地天气缓存：容量 / 时效 / 只收 ready / 深拷贝')

const WC = require('../miniprogram/utils/weather-cache')

function memStorage() {
  const map = new Map()
  return { map, get: k => (map.has(k) ? map.get(k) : null), set: (k, v) => { map.set(k, v) } }
}
const readyResult = (updatedAt) => ({
  status: 'ready', updatedAt: updatedAt || '2026-10-03T10:00:00+08:00',
  days: [{ date: '2026-10-03' }], detail: [{ t: '08:00' }], series: [{ d: '2026-10-03', t: '08:00' }],
})

{
  const s = memStorage()
  const c = WC.createWeatherCache(s)
  c.put('wp-local@31.06,102.91', '2026-10-03', readyResult())
  const hit = c.get('wp-local@31.06,102.91', '2026-10-03')
  check('put → get 往返，savedAt 与 ageMs 齐全', !!hit && !!hit.savedAt && hit.ageMs >= 0 && hit.result.status === 'ready', JSON.stringify(hit && hit.savedAt))
  check('取出的是深拷贝：改返回值不动缓存', (() => {
    hit.result.series[0].d = 'HACKED'
    return c.get('wp-local@31.06,102.91', '2026-10-03').result.series[0].d === '2026-10-03'
  })())
  check('换点（scope 不同）不误命中', c.get('wp-local@31.07,102.91', '2026-10-03') === null)
  check('换日期不误命中', c.get('wp-local@31.06,102.91', '2026-10-04') === null)
  c.put('wp-local@31.06,102.91', '2026-10-03', { status: 'unavailable', message: '天气服务超时' })
  check('非 ready 形状不入库（unavailable 没有展示价值）',
    c.get('wp-local@31.06,102.91', '2026-10-03').result.status === 'ready')
  s.map.set(WC.KEY, '坏数据')
  check('存储损坏 → null 且不抛', c.get('wp-local@31.06,102.91', '2026-10-03') === null)
}
{
  // 容量：单键 1MB 上限 ⇒ CAP=6，按 savedAt 保留最新
  const s = memStorage()
  const c = WC.createWeatherCache(s)
  for (let i = 0; i < 8; i++) {
    c.put('scope' + i, '2026-10-03', readyResult('2026-10-03T0' + i + ':00:00+08:00'))
  }
  const all = s.map.get(WC.KEY)
  check('CAP=6：只留最近 6 条', Object.keys(all).length === 6, String(Object.keys(all).length))
  check('淘汰的是最旧（scope0/1 不在，scope7 在）', !all['scope0|2026-10-03'] && !all['scope1|2026-10-03'] && !!all['scope7|2026-10-03'])
}
{
  check('ageText 分档', WC.ageText(0) === '不久前' && WC.ageText(5 * 60000) === '5 分钟前'
    && WC.ageText(3 * 3600000) === '3 小时前' && WC.ageText(50 * 3600000) === '2 天前'
    && WC.ageText(-1) === '不久前', [WC.ageText(0), WC.ageText(5 * 60000), WC.ageText(3 * 3600000), WC.ageText(50 * 3600000)].join('/'))
  check('MAX_AGE_MS = 12 小时（更旧的旧预报不冒充现在的天气）', WC.MAX_AGE_MS === 12 * 3600000)
  const s = memStorage()
  const c = WC.createWeatherCache(s, () => Date.parse('2026-10-03T12:00:00Z'))
  c.put('sc', '2026-10-03', readyResult())
  check('假钟可注入：ageMs 按注入时钟算', c.get('sc', '2026-10-03').ageMs === 0)
}

/* ============================================================ 2. 页面：重试 / 软降级 / 话术 */
section('2. 天气页：瞬时故障自动重试、失败软降级、分场景话术')

const PAGE_PATH = require.resolve('../miniprogram/pages/weather/weather')
const api = require('../miniprogram/utils/api')
const draft = require('../miniprogram/utils/draft')

function pageConfig() {
  global.Page = cfg => { global.__PAGE_CFG = cfg }
  delete require.cache[PAGE_PATH]
  require(PAGE_PATH)
  return global.__PAGE_CFG
}
function makePage(cfg) {
  const page = Object.assign({}, cfg)
  page.data = JSON.parse(JSON.stringify(cfg.data || {}))
  page._patches = []
  page.setData = function (patch, cb) {
    this._patches.push(patch)
    Object.assign(this.data, patch)
    if (cb) setImmediate(cb)
  }
  return page
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(cond, ms = 8000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (cond()) return true; await sleep(5) }
  return cond()
}
function fakeDays(from, n) {
  const out = []
  for (let i = 0; i < n; i++) {
    out.push({ date: addDays(from, i), code: 2, tMax: 20, tMin: 10, precipProbMax: 20, cloud: { low: 10, mid: 20, high: 20 } })
  }
  return out
}
function fakeSeries(from, n) {
  const out = []
  for (let i = 0; i < n * 24; i++) {
    out.push({
      d: addDays(from, Math.floor(i / 24)), t: String(i % 24).padStart(2, '0') + ':00',
      temp: 12, pop: 10, precip: 0, showers: 0, code: 2, wind: 7, rh: 60, uv: 3,
      cloud: { low: 20, mid: 30, high: 30 }, band: null,
    })
  }
  return out
}
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const DATE = '2026-10-03'
const SCOPE = 'wp-local@31.06,102.91' // 31.06321/102.90856 的 2dp 网格 + 单点 id
const ready = (updatedAt) => ({
  status: 'ready', updatedAt: updatedAt || DATE + 'T10:00:00+08:00', pointElevation: 4250,
  days: fakeDays(DATE, 7), detail: [], series: fakeSeries(DATE, 7),
})
const netErr = () => Object.assign(new Error('等了太久没连上服务器。山里信号不稳时容易这样，请再试一次。'), { code: 'NETWORK' })

function boot(storage, byPoint) {
  draft.wxStorage = storage
  global.wx = { showModal() {}, showToast() {}, setNavigationBarTitle() {}, hideShareMenu() {} }
  const cfg = pageConfig()
  api.getWeather = () => Promise.reject(netErr())
  api.getWeatherByPoint = byPoint
  const page = makePage(cfg)
  page.onLoad({ src: 'local', lat: '31.06321', lng: '102.90856', date: DATE })
  page.onShow()
  return page
}
function seedCache(storage, ageMs, result) {
  storage.map.set(WC.KEY, {
    [SCOPE + '|' + DATE]: { v: 1, savedAt: new Date(Date.now() - ageMs).toISOString(), result: result || ready(DATE + 'T07:00:00+08:00') },
  })
}

async function pageCases() {
  // ① 瞬时 NETWORK 失败 → 自动重试一次即成功：用户看到数据，不是错误墙
  {
    const calls = []
    const page = boot(memStorage(), () => {
      calls.push(1)
      return calls.length === 1 ? Promise.reject(netErr()) : Promise.resolve(ready())
    })
    const ok = await waitFor(() => page.data.dayCards.length > 0)
    check('① 瞬时失败后自动重试并成功：数据照常展示', ok && calls.length === 2, 'calls=' + calls.length)
    check('① 重试期间有"正在重试"提示（不是静默转圈）',
      page._patches.some(p => /正在重试/.test(p.retryNote || '')),
      JSON.stringify(page._patches.filter(p => p.retryNote).map(p => p.retryNote)))
    check('① 成功后无错误态残留', page.data.emptyTitle === '' && page.data.weatherStale === null && page.data.loadingWeather === false,
      'title=' + JSON.stringify(page.data.emptyTitle) + ' stale=' + JSON.stringify(page.data.weatherStale) +
      ' loading=' + page.data.loadingWeather + ' skyNote=' + JSON.stringify(page.data.skyInputNote))
  }

  // ② 持续 NETWORK 失败且无缓存：友好文案 + 恰好 3 次尝试（1 + 2 重试）
  {
    const calls = []
    const page = boot(memStorage(), () => { calls.push(1); return Promise.reject(netErr()) })
    const done = await waitFor(() => page.data.loadingWeather === false && !!page.data.emptyDetail)
    check('② 持续失败：恰好 3 次尝试后放弃（不无限重试）', done && calls.length === 3, 'calls=' + calls.length)
    check('② 失败文案点名"山里常见"并给下一步', /山里常见/.test(page.data.emptyDetail) && /重新查询|再试/.test(page.data.emptyDetail), page.data.emptyDetail)
    check('② 界面无开发者术语', !DEV_JARGON.test(page.data.emptyTitle + page.data.emptyDetail), page.data.emptyTitle + ' / ' + page.data.emptyDetail)
    check('② 失败面板用 error 样式（与"没有数据"的 empty 区分开）', page.data.emptyKind === 'error', page.data.emptyKind)
    check('② 数据区保持空（不拿旧窗口冒充）', page.data.dayCards.length === 0)
  }

  // ③ 持续失败 + 有本地缓存：软降级展示旧数据 + 明确标注时效；且不影响随后的真重试
  {
    const calls = []
    const storage = memStorage()
    seedCache(storage, 3 * 3600000)
    const page = boot(storage, () => { calls.push(1); return Promise.reject(netErr()) })
    const ok = await waitFor(() => page.data.dayCards.length > 0)
    check('③ 连不上时展示 3 小时前的缓存数据（不是错误墙）', ok, 'dayCards=' + page.data.dayCards.length)
    check('③ 横幅写明时效与出路', !!page.data.weatherStale && /3 小时前/.test(page.data.weatherStale.text) && /重新查询/.test(page.data.weatherStale.text),
      page.data.weatherStale && page.data.weatherStale.text)
    check('③ 页脚"更新时间"用数据本身的取数时间（不拿本次响应冒充）',
      page.data.updatedAt === '2026-10-03 07:00', page.data.updatedAt)
    check('③ 软降级不写 _lastResult（否则重试会被 covers() 直接复用旧数据）', !page._lastResult)
    page.fetchWeather()
    await waitFor(() => calls.length === 6)
    check('③ 手动"重新查询"真的再次外呼（3 次尝试）', calls.length === 6, 'calls=' + calls.length)
  }

  // ④ 超过 12 小时的缓存不用（旧云层不能冒充现在的天气）
  {
    const calls = []
    const storage = memStorage()
    seedCache(storage, 13 * 3600000)
    const page = boot(storage, () => { calls.push(1); return Promise.reject(netErr()) })
    await waitFor(() => page.data.loadingWeather === false && !!page.data.emptyDetail)
    check('④ 13 小时前的缓存不用：仍走错误文案', page.data.dayCards.length === 0 && page.data.emptyKind === 'error',
      'dayCards=' + page.data.dayCards.length)
  }

  // ⑤ out_of_range 是确定性业务态：不重试（重试改变不了日期窗口）
  {
    const calls = []
    const page = boot(memStorage(), () => { calls.push(1); return Promise.resolve({ status: 'out_of_range' }) })
    const done = await waitFor(() => page.data.loadingWeather === false)
    check('⑤ out_of_range 只调一次（不重试）', done && calls.length === 1, 'calls=' + calls.length)
    check('⑤ 沿用"临近出发再核实"的既有文案', /14天|临近出发/.test(page.data.emptyDetail), page.data.emptyDetail)
    check('⑤ out_of_range 不是错误（empty 样式）', page.data.emptyKind === 'empty', page.data.emptyKind)
  }

  // ⑥ 云端 unavailable（Open-Meteo 超时/5xx）同样自动重试
  {
    const calls = []
    const page = boot(memStorage(), () => {
      calls.push(1)
      return calls.length === 1
        ? Promise.resolve({ status: 'unavailable', message: '天气服务超时' })
        : Promise.resolve(ready())
    })
    const ok = await waitFor(() => page.data.dayCards.length > 0)
    check('⑥ unavailable 也重试，第二次成功', ok && calls.length === 2, 'calls=' + calls.length)
  }

  // ⑦ 成功即写缓存（下次连不上时才有软降级的素材）
  {
    const storage = memStorage()
    const page = boot(storage, () => Promise.resolve(ready()))
    await waitFor(() => page.data.dayCards.length > 0)
    const entry = (storage.map.get(WC.KEY) || {})[SCOPE + '|' + DATE]
    check('⑦ 成功后写入本地缓存（scope=点id@2dp网格）', !!entry && entry.result.status === 'ready' && !!entry.savedAt,
      JSON.stringify(Object.keys(storage.map.get(WC.KEY) || {})))
  }

  // ⑧ 切点/切日作废旧链路：迟到的响应不许覆盖新点的数据（token 纪律）
  {
    let resolveFirst = null
    const calls = []
    const page = boot(memStorage(), () => {
      calls.push(1)
      if (calls.length === 1) return new Promise(r => { resolveFirst = r })
      return Promise.resolve(ready(DATE + 'T11:00:00+08:00'))
    })
    await waitFor(() => calls.length === 1)
    page.fetchWeather() // 同点再查一次：令牌 +1，第二条链上路
    await waitFor(() => calls.length === 2 && /11:00/.test(page.data.updatedAt || ''))
    resolveFirst(ready(DATE + 'T09:00:00+08:00')) // 迟到的旧响应
    await sleep(30)
    check('⑧ 迟到响应被令牌作废：页面保留第二次的数据', /11:00/.test(page.data.updatedAt), page.data.updatedAt)
  }
}

/* ============================================================ 3. 云端：陈旧兜底 + 活动模式瘦身 */
section('3. 云函数：外呼失败陈旧兜底 / 新鲜缓存零外呼 / 活动模式不再全量加载')

const STUB = path.join(__dirname, 'stub-wx-server-sdk.js')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'wx-server-sdk') return STUB
  return origResolve.call(this, request, ...rest)
}
const stub = require('./stub-wx-server-sdk')
const W = require('../cloudfunctions/trailApi/lib/weather')

// https 桩：每次调用即记数并立即以 error 结束（模拟 Open-Meteo 超时）
function failHttps() {
  const saved = https.get
  const state = { count: 0 }
  https.get = () => {
    state.count++
    const req = {
      on(ev, fn) { if (ev === 'error') req._err = fn; return req },
      setTimeout() { return this },
    }
    process.nextTick(() => req._err && req._err(new Error('天气服务超时')))
    return req
  }
  return { state, restore: () => { https.get = saved } }
}

async function serverCases() {
  const today = W.cnToday()
  const date = addDays(today, 1)
  const LAT = 30.9, LNG = 103.4 // 中国境内：resolvePointQuery 会做 GCJ→WGS 纠偏
  const wgs = W.gcjToWgs(LAT, LNG)
  const cacheKey = W.weatherCacheKey(wgs.lat, wgs.lng, date)

  const freshForecast = {
    elevation: 1234,
    days: [{ date, code: 2, tMax: 20, tMin: 10 }],
    detail: [{ t: '08:00', d: date, temp: 12 }],
    series: [{ t: '08:00', d: date, temp: 12 }],
    cloudLevels: null,
  }

  function freshDb() {
    stub.__state.db = stub.__fakeDb()
    return stub.__state.db
  }
  function seedCache(db, ageMs, forecast) {
    db.collection('weather_cache').doc(cacheKey).set({
      data: { forecast: forecast || freshForecast, fetchedAt: new Date(Date.now() - ageMs) },
    })
  }

  // 每个用例重建 db 并重取 index.js（模块级 ensuredFor 记的是 db 实例）
  function loadApi() {
    delete require.cache[require.resolve('../cloudfunctions/trailApi/index')]
    return require('../cloudfunctions/trailApi/index')
  }
  const callByPoint = trailApi => trailApi.main({ action: 'getWeatherByPoint', lat: LAT, lng: LNG, date })

  // ① 30 分钟内的新鲜缓存：零外呼
  {
    const db = freshDb()
    seedCache(db, 5 * 60000)
    const https1 = failHttps()
    const trailApi = loadApi()
    const r = await callByPoint(trailApi)
    check('① 新鲜缓存命中：零外呼且 stale=false', r.ok && r.data.status === 'ready' && r.data.stale === false
      && r.data.staleAt === undefined && https1.state.count === 0,
      'https=' + https1.state.count + ' stale=' + (r.data && r.data.stale))
    https1.restore()
  }

  // ② 外呼失败 + 12 小时内的陈旧缓存：软降级返回并标记 stale
  {
    const db = freshDb()
    const fetchedAt = new Date(Date.now() - 3 * 3600000)
    seedCache(db, 3 * 3600000)
    const https2 = failHttps()
    const trailApi = loadApi()
    const r = await callByPoint(trailApi)
    check('② 外呼失败 + 3 小时旧缓存 → ready 且 stale=true', r.ok && r.data.status === 'ready' && r.data.stale === true,
      JSON.stringify({ ok: r.ok, status: r.data && r.data.status, stale: r.data && r.data.stale }))
    check('② staleAt = 数据的实际取数时间（页面据此标注时效）', r.data.staleAt === fetchedAt.toISOString(), r.data.staleAt)
    check('② 软降级返回的就是旧缓存的数据', r.data.series.length === 1 && r.data.days[0].date === date)
    check('② 外呼确实发生过（不是绕过失败）', https2.state.count === 1, 'https=' + https2.state.count)
    https2.restore()
  }

  // ③ 超过 12 小时的缓存不兜底（旧云层不能冒充现在的天气）
  //    注意信封形状：byPoint 把取数失败收敛成 status:'unavailable' 业务态（既有设计），
  //    由客户端重试/软降级/话术层收口；这里断言"没有拿 13 小时前的数据充当 ready"。
  {
    const db = freshDb()
    seedCache(db, 13 * 3600000)
    const https3 = failHttps()
    const trailApi = loadApi()
    const r = await callByPoint(trailApi)
    check('③ 13 小时前的缓存不兜底：unavailable 而非 ready', r.ok === true && r.data.status === 'unavailable',
      JSON.stringify({ ok: r.ok, status: r.data && r.data.status }))
    check('③ 不出现 stale 标记（没有东西被当成旧数据展示）', r.data.stale === undefined || r.data.stale === false)
    https3.restore()
  }

  // ④ 无缓存 + 外呼失败：同样明确失败（客户端还有本地缓存与重试两道防线）
  {
    const db = freshDb()
    const https4 = failHttps()
    const trailApi = loadApi()
    const r = await callByPoint(trailApi)
    check('④ 无缓存外呼失败 → unavailable（不伪造 ready）', r.ok === true && r.data.status === 'unavailable',
      JSON.stringify({ ok: r.ok, status: r.data && r.data.status }))
    https4.restore()
  }

  // ⑤ 活动模式：只读 ot_activities + weather_cache，不再全量加载 15 个集合
  {
    const db = freshDb()
    db.collection('ot_activities').doc('a1').set({
      data: {
        id: 'a1', title: '测试活动', startAt: today + 'T07:00:00+08:00',
        routeSnapshot: { points: [{ id: 'pt-1', name: '山门', coordinates: { lat: LAT, lng: LNG } }] },
      },
    })
    const wgsA = W.gcjToWgs(LAT, LNG)
    db.collection('weather_cache').doc(W.weatherCacheKey(wgsA.lat, wgsA.lng, date)).set({
      data: { forecast: freshForecast, fetchedAt: new Date() },
    })
    const touched = []
    const rawCollection = db.collection.bind(db)
    db.collection = name => { touched.push(name); return rawCollection(name) }
    const https5 = failHttps()
    const trailApi = loadApi()
    const r = await trailApi.main({ action: 'getWeather', activityId: 'a1', pointId: 'pt-1', date })
    check('⑤ 活动模式天气正常返回', r.ok && r.data.status === 'ready', JSON.stringify(r).slice(0, 120))
    check('⑤ 只碰 ot_activities 与 weather_cache（不再 15 集合全量加载）',
      touched.length > 0 && touched.every(n => n === 'ot_activities' || n === 'weather_cache'),
      JSON.stringify([...new Set(touched)]))
    check('⑤ 全量状态集合零读取（ot_signups 等从未被碰）',
      !touched.some(n => /ot_(signups|vehicles|receipts|events|profiles)/.test(n)), JSON.stringify([...new Set(touched)]))
    check('⑤ 新鲜缓存 ⇒ 零外呼', https5.state.count === 0, 'https=' + https5.state.count)
    https5.restore()

    const missing = await trailApi.main({ action: 'getWeather', activityId: 'nope', pointId: 'pt-1', date })
    check('⑤ 活动不存在 → NOT_FOUND（与改造前同一语义）', missing.ok === false && missing.error.code === 'NOT_FOUND', JSON.stringify(missing.error))
  }

  // ⑥ 读故障 ≠ 活动不存在：ot_activities 读超时必须原样抛出（INTERNAL），不冒充 NOT_FOUND
  {
    const db = freshDb()
    const rawCollection = db.collection.bind(db)
    db.collection = name => {
      const coll = rawCollection(name)
      if (name !== 'ot_activities') return coll
      return Object.assign({}, coll, {
        doc: id => Object.assign({}, coll.doc(id), {
          get: () => Promise.reject(new Error('document.get:fail -502004 read timeout')),
        }),
      })
    }
    const trailApi = loadApi()
    const r = await trailApi.main({ action: 'getWeather', activityId: 'a1', pointId: 'pt-1', date })
    check('⑥ 读故障归类 INTERNAL，不冒充"找不到此活动"', r.ok === false && r.error.code === 'INTERNAL', JSON.stringify(r.error))
  }
}

pageCases()
  .then(serverCases)
  .then(() => {
    console.log('\n==== passed=' + passed + ' failed=' + failed + ' ====')
    process.exit(failed ? 1 : 0)
  })
  .catch(e => {
    failed++
    console.error('  ✗ 用例执行异常（' + (e && e.stack || e) + '）')
    console.log('\n==== passed=' + passed + ' failed=' + failed + ' ====')
    process.exit(1)
  })

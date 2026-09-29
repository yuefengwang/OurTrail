// Open-Meteo 天气代理：按经纬度取逐小时预报 + 7 日概览 + 气压层云量剖面（云层带重建）。
// 设计文档：docs/product/天气模块升级-徒步天气概览设计.md（§4 数据层）。
// Open-Meteo 会根据坐标做海拔降尺度，山区预报比城市天气更贴近实际。
// 注意：本文件自带 GCJ→WGS 转换（云函数独立包，不能 require 小程序目录），
// 与 miniprogram/utils/gpx.js 的同名函数保持一致，改动须两侧同步。
const https = require('https')

const HOURLY = [
  'temperature_2m', 'apparent_temperature', 'precipitation_probability', 'precipitation', 'showers',
  'weather_code', 'wind_speed_10m', 'wind_gusts_10m', 'relative_humidity_2m',
  'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
  'uv_index', 'visibility', 'freezing_level_height',
]
const CLOUD_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600]
// 气压层剖面：云量（相对湿度近似）+ 位势高度（换算层海拔 m ASL）
for (const lv of CLOUD_LEVELS) {
  HOURLY.push('cloud_cover_' + lv + 'hPa', 'geopotential_height_' + lv + 'hPa')
}
const DAILY = [
  'weather_code', 'temperature_2m_max', 'temperature_2m_min', 'wind_speed_10m_max',
  'precipitation_sum', 'precipitation_probability_max', 'precipitation_hours',
  'sunrise', 'sunset', 'uv_index_max',
]

function cnToday() {
  // 云函数运行在 UTC，换算成北京时间的自然日
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error('天气服务暂时不可用（' + res.statusCode + '）'))
      }
      let buf = ''
      res.on('data', c => { buf += c })
      res.on('end', () => {
        try { resolve(JSON.parse(buf)) } catch (e) { reject(new Error('天气数据解析失败')) }
      })
    })
    req.on('error', reject)
    // 云函数总超时 20s（config.json）：外呼收在 10s 内，给状态加载与缓存写入留余量
    req.setTimeout(10000, () => req.destroy(new Error('天气服务超时')))
  })
}

/* ---------- GCJ-02 → WGS-84（与 miniprogram/utils/gpx.js 同步维护） ---------- */

const GCJ_A = 6378245.0
const GCJ_EE = 0.00669342162296594323

function outOfChina(lat, lng) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320.0 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0
  return ret
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0
  return ret
}

function wgsToGcj(lat, lng) {
  if (outOfChina(lat, lng)) return { lat, lng }
  const radLat = (lat * Math.PI) / 180
  let magic = Math.sin(radLat)
  magic = 1 - GCJ_EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  let dLat = transformLat(lng - 105.0, lat - 35.0)
  let dLng = transformLng(lng - 105.0, lat - 35.0)
  dLat = (dLat * 180.0) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI)
  dLng = (dLng * 180.0) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI)
  return { lat: lat + dLat, lng: lng + dLng }
}

function gcjToWgs(lat, lng) {
  if (outOfChina(lat, lng)) return { lat, lng }
  let wLat = lat
  let wLng = lng
  for (let i = 0; i < 2; i++) {
    const cur = wgsToGcj(wLat, wLng)
    wLat += lat - cur.lat
    wLng += lng - cur.lng
  }
  return { lat: wLat, lng: wLng }
}

/* ---------- 云层带：气压层剖面重建 ---------- */

// 该小时各非空层 { alt(m ASL), cc(%) }；取云量 ≥80% 的"成层云"层的最低/最高海拔。
// 50~80% 视为薄云不入带。无成层云 → null。高海拔地点低层气压层在地下时 Open-Meteo 返回 null，跳过。
function cloudBandAt(h, i) {
  const levels = []
  for (const lv of CLOUD_LEVELS) {
    const cc = h['cloud_cover_' + lv + 'hPa'] ? h['cloud_cover_' + lv + 'hPa'][i] : null
    const alt = h['geopotential_height_' + lv + 'hPa'] ? h['geopotential_height_' + lv + 'hPa'][i] : null
    if (Number.isFinite(cc) && Number.isFinite(alt)) levels.push({ alt, cc })
  }
  levels.sort((a, b) => a.alt - b.alt)
  const solid = levels.filter(l => l.cc >= 80)
  if (!solid.length) return null
  let cover = 0
  for (const l of solid) cover = Math.max(cover, l.cc)
  return {
    base: Math.round(solid[0].alt),
    top: Math.round(solid[solid.length - 1].alt),
    cover: Math.round(cover),
  }
}

// 返回 { elevation, days, detail }；detail 为所选日 24h 全量（含 band）。
async function fetchForecast(lat, lng, date) {
  const diff = Math.round((Date.parse(date) - Date.parse(cnToday())) / 86400000)
  if (diff > 15) return { tooEarly: true, days: [], detail: [] } // 超出预报范围，临近出发再查
  // 图表与概览条都以「所选日」为首日展示 7 天，所以窗口必须覆盖 今天 → 所选日+6。
  // 原来取 diff+2 天，所选日会落在窗口末尾：series 只剩 1 天（图窄到不用滑、也点不到"某天"），
  // 而概览条又从今天起排，两者错开 6 天、选中日还不在首屏——这里是同一个根因，一并修掉。
  // Open-Meteo forecast_days 上限 16：所选日再往后只能有多少给多少。
  const days = Math.min(16, Math.max(1, diff + 7))
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly: HOURLY.join(','),
    daily: DAILY.join(','),
    timezone: 'Asia/Shanghai',
    forecast_days: String(days),
  })
  const j = await fetchJson('https://api.open-meteo.com/v1/forecast?' + q.toString())
  const h = j.hourly || {}
  const d = j.daily || {}
  const times = h.time || []

  // 逐日低/中/高云量均值（对齐 meteogram 日条那排云量图标）
  const cloudSum = {}
  for (let i = 0; i < times.length; i++) {
    const day = times[i].slice(0, 10)
    if (!cloudSum[day]) cloudSum[day] = { low: [0, 0], mid: [0, 0], high: [0, 0] }
    const add = (k, v) => { if (Number.isFinite(v)) { cloudSum[day][k][0] += v; cloudSum[day][k][1] += 1 } }
    add('low', (h.cloud_cover_low || [])[i])
    add('mid', (h.cloud_cover_mid || [])[i])
    add('high', (h.cloud_cover_high || [])[i])
  }
  const mean = (k, day) => {
    const s = cloudSum[day] ? cloudSum[day][k] : null
    return s && s[1] ? Math.round(s[0] / s[1]) : 0
  }

  const outDays = (d.time || []).map((t, i) => ({
    date: t,
    code: (d.weather_code || [])[i],
    tMax: Math.round((d.temperature_2m_max || [])[i]),
    tMin: Math.round((d.temperature_2m_min || [])[i]),
    windMax: Math.round((d.wind_speed_10m_max || [])[i]),
    precipSum: Math.round(((d.precipitation_sum || [])[i] || 0) * 10) / 10,
    precipProbMax: (d.precipitation_probability_max || [])[i] || 0,
    precipHours: (d.precipitation_hours || [])[i] || 0,
    sunrise: ((d.sunrise || [])[i] || '').slice(11, 16),
    sunset: ((d.sunset || [])[i] || '').slice(11, 16),
    uvMax: (d.uv_index_max || [])[i],
    cloud: { low: mean('low', t), mid: mean('mid', t), high: mean('high', t) },
  }))

  const detail = []
  for (let i = 0; i < times.length; i++) {
    if (times[i].indexOf(date) !== 0) continue
    detail.push(hourView(times, h, i))
  }
  // 逐日概览同样从所选日起、且与 series 等长（最多 7 天）——两条各起一头正是"图一天、卡七天"错位的来源。
  const dayStart = Math.max(0, outDays.findIndex(d => d.date === date))
  const daysOut = outDays.slice(dayStart, dayStart + 7)
  // meteogram 逐小时序列：**从所选日起**最多 168 小时（不足 7 天有多少给多少）。
  // 不能固定取 times 的前 168 小时——times 永远从今天起，所选日靠后时会截出一段与所选日
  // 完全无关的旧窗口，客户端兜底逻辑又会照单全收，导致上半屏与下半屏讲的不是同一天。
  const start = Math.max(0, times.findIndex(t => t.slice(0, 10) === date))
  const series = times.slice(start, start + 168).map((_, i) => hourView(times, h, start + i))
  return { elevation: Math.round(j.elevation), days: daysOut, detail, series }
}

// 单小时投影（detail/series 共用）：t 保持 'HH:mm'（既有消费者依赖），d 为所属日期
function hourView(times, h, i) {
  return {
    t: times[i].slice(11, 16),
    d: times[i].slice(0, 10),
    temp: (h.temperature_2m || [])[i],
    feels: (h.apparent_temperature || [])[i],
    pop: (h.precipitation_probability || [])[i],
    precip: (h.precipitation || [])[i],
    showers: (h.showers || [])[i],
    code: (h.weather_code || [])[i],
    wind: (h.wind_speed_10m || [])[i],
    gust: (h.wind_gusts_10m || [])[i],
    // 相对湿度：彩虹/雾/露的水分信号（降水为 0 时高湿仍可能有雾或虹）
    rh: (h.relative_humidity_2m || [])[i],
    cloud: {
      low: (h.cloud_cover_low || [])[i],
      mid: (h.cloud_cover_mid || [])[i],
      high: (h.cloud_cover_high || [])[i],
    },
    uv: (h.uv_index || [])[i],
    visibility: Number.isFinite((h.visibility || [])[i]) ? Math.round((h.visibility || [])[i] / 100) / 10 : null,
    freezing: (h.freezing_level_height || [])[i],
    band: cloudBandAt(h, i),
  }
}

/* ---------- P3 独立天气模块：按点自由查询的纯逻辑 ---------- */
// index.js 只做编排（缓存读写、响应组装），校验/窗口判定/坐标纠偏/返回体投影都在这里，
// smoke-test.js 不依赖 wx-server-sdk 即可覆盖。设计文档：天气模块升级-P3 §8。

// 免 OPENID 的天气 action：天气是非个人数据，v1 起 getWeather 即免鉴权，byPoint 沿用同一语义。
const FREE_ACTIONS = { getWeather: true, getWeatherByPoint: true }
function isWeatherFreeAction(action) {
  return FREE_ACTIONS[action] === true
}

// 缓存 key：WGS 坐标 2dp 网格（≈1.1 km）+ 日期。活动节点与自由查询落同格即共享缓存，
// 这是"两路径缓存互通"的全部机制——index.js 的 getCachedForecast 也用本函数取 key。
function weatherCacheKey(lat, lng, date) {
  return 'w_' + lat.toFixed(2) + '_' + lng.toFixed(2) + '_' + date
}

/**
 * 校验 + 窗口判定 + 坐标纠偏（纯函数）。
 * @returns {ok:true, wgs:{lat,lng}, date}
 *        | {ok:false, code:'INVALID_INPUT', message}   坐标/日期不合法（fail 出 envelopes 级错误）
 *        | {ok:false, status:'out_of_range'}           距今 0–14 天窗口外（业务态，非错误）
 */
function resolvePointQuery(payload, todayIso) {
  const lat = Number(payload && payload.lat)
  const lng = Number(payload && payload.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, code: 'INVALID_INPUT', message: '坐标无效，请检查经纬度。' }
  }
  const date = String((payload && payload.date) || '')
  // 日期校验比活动路径的 validDateStr 更严一档：除了格式，还要求真实存在——
  // Date.parse 会把 '2026-02-30' 滚动成 3 月 2 日，格式校验抓不住，必须往返比对。
  const dateOK = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(date + 'T00:00:00Z'))
    && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date
  if (!dateOK) {
    return { ok: false, code: 'INVALID_INPUT', message: '日期无效。' }
  }
  const diff = Math.round((Date.parse(date) - Date.parse(todayIso)) / 86400000)
  if (!Number.isFinite(diff) || diff < 0 || diff > 14) return { ok: false, status: 'out_of_range' }
  return { ok: true, wgs: gcjToWgs(lat, lng), date }
}

/**
 * 把 fetchForecast 返回体投影为 byPoint 响应体（不含 status/updatedAt，index.js 补）。
 * 形状与活动路径 ready 分支逐字段一致（少遗留 hours，客户端自 P2 起不消费）。
 * 无可用数据（超预报范围/当日无数据）返回 null，由 index.js 转 out_of_range。
 */
function pointResponse(forecast) {
  if (!forecast || forecast.tooEarly) return null
  const detail = forecast.detail || []
  if (!detail.length) return null
  return {
    days: forecast.days || [],
    detail,
    series: forecast.series || [],
    pointElevation: forecast.elevation,
  }
}

module.exports = {
  fetchForecast, cnToday, gcjToWgs, cloudBandAt, hourView,
  isWeatherFreeAction, weatherCacheKey, resolvePointQuery, pointResponse,
}

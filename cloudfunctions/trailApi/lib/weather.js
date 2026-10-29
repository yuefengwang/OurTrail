// Open-Meteo 天气代理：按经纬度取逐小时预报 + 7 日概览 + 气压层云量剖面（云层带重建）。
// 设计文档：docs/product/天气模块升级-徒步天气概览设计.md（§4 数据层）。
// Open-Meteo 会根据坐标做海拔降尺度，山区预报比城市天气更贴近实际。
// 注意：本文件自带 GCJ→WGS 转换（云函数独立包，不能 require 小程序目录），
// 与 miniprogram/utils/gpx.js 的同名函数保持一致，改动须两侧同步。
const https = require('https')

const HOURLY = [
  'temperature_2m', 'apparent_temperature', 'precipitation_probability', 'precipitation', 'showers',
  'weather_code', 'wind_speed_10m', 'wind_gusts_10m', 'relative_humidity_2m',
  'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'cloud_cover',
  'uv_index', 'visibility', 'freezing_level_height', 'boundary_layer_height',
  // V2 additive（2026-10）：风向（Timeline 风行箭头）/ 气压与露点（Numbers 折叠表）。
  // 三者均为 optional：旧客户端忽略，新客户端对缺失降级（'—'/不画箭头），不得因单字段缺失失败。
  'wind_direction_10m', 'surface_pressure', 'dew_point_2m',
  // 2026-10 天相输入修正：低层温度/湿度廓线，用于云海逆温判断（925/850/700 hPa）。
  // 与云量/位势高度同一 provider，仍为 optional；缺一档只丢该档，不影响整条天气响应。
  'temperature_925hPa', 'relative_humidity_925hPa',
  'temperature_850hPa', 'relative_humidity_850hPa',
  'temperature_700hPa', 'relative_humidity_700hPa',
]
const CLOUD_LEVELS = [1000, 975, 950, 925, 900, 850, 825, 800, 775, 750, 725, 700, 675, 650, 625, 600, 575, 550, 525, 500, 475, 450]
/* 剖面显示用的更高气压层（450hPa≈6,700m，400hPa≈7,600m，350hPa≈8,600m，300hPa≈9,700m @30°N；
   实测中国境内 300hPa 高度 8,498–9,765m）。
   只喂 cloudLevels（云层剖面图）；cloudBandAt 的业务成带判据仍走 CLOUD_LEVELS
   —— 业务扫描范围是独立决策（铁律 28），抬显示天花板不得顺带改天相结论。
   300 是给高原/雪山场景的顶：珠峰顶 ≈323hPa，再高的卷云对徒步决策没有信息量。 */
const PROFILE_CLOUD_LEVELS = CLOUD_LEVELS.concat([400, 350, 300])
// 气压层剖面：云量（相对湿度近似）+ 位势高度（换算层海拔 m ASL）
for (const lv of PROFILE_CLOUD_LEVELS) {
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

/* ---------- 日级代表性现象码（2026-10-28） ---------- */
// provider 的 daily.weather_code 是全天 24h 内最严重的码：折多山 10-28 只有深夜是雾，
// 整日徽标就被染成「雾」，而当天白昼日照 11 小时。日徽标回答的是「这一天出门会遇到什么」，
// 因此按**白昼窗口**重取代表码；`days[].code` 原值保留（安全条款仍读它）。
// 口径与理由：docs/superpowers/specs/2026-10-28-weather-day-code-design.md §2

// 雾的三证门：provider 给 45/48 还不够——实测 43 个雾小时里 19 个 RH<90%
// （最低 51%；10-28 00:00 能见度 0.54 km 但 RH 67%），只凭能见度会把干霾/低云读成雾。
// 90 与 1 km 是本次唯一新增的数字，取在被证伪簇（67–89）与被证实簇（91–100）之间。
const FOG_CODES = [45, 48]
const FOG_RH_MIN = 90
const FOG_VIS_KM_MAX = 1

function fogConfirmed(x) {
  if (!x || FOG_CODES.indexOf(Number(x.code)) === -1) return false
  return Number.isFinite(x.rh) && x.rh >= FOG_RH_MIN
    && Number.isFinite(x.visibility) && x.visibility < FOG_VIS_KM_MAX
}

// 恶劣天气一票否决：窗口内只要有雷/冻雨/雪，就不许被众数投掉。
// 跨类别取最危险的一类（冻雨比雪更危险：路面结冰），同类取较大码。
const SEVERE_GROUPS = [
  { rank: 3, codes: [95, 96, 99] },
  { rank: 2, codes: [66, 67, 56, 57] },
  { rank: 1, codes: [71, 73, 75, 77, 85, 86] },
]

function severeCodeAmong(hours) {
  let best = null
  for (const g of SEVERE_GROUPS) {
    const hit = hours.filter(x => g.codes.indexOf(Number(x.code)) !== -1)
    if (!hit.length) continue
    const code = Math.max.apply(null, hit.map(x => Number(x.code)))
    if (!best || g.rank > best.rank) best = { rank: g.rank, code }
  }
  return best ? best.code : null
}

// 极昼/极夜或 provider 缺字段时回退固定窗口：窗口只决定徽标，不参与安全条款。
const DAY_WINDOW_FALLBACK = ['08:00', '18:00']

function dayWindow(sunrise, sunset) {
  const ok = typeof sunrise === 'string' && typeof sunset === 'string'
    && /^\d{2}:\d{2}$/.test(sunrise) && /^\d{2}:\d{2}$/.test(sunset)
    && sunrise < sunset
  return ok ? [sunrise, sunset] : DAY_WINDOW_FALLBACK
}

/**
 * 白昼代表性现象码。hours 需含 {t:'HH:mm', code, rh, visibility(km)}——
 * hourView 逐时对象与 fetchForecast 内部的轻量投影同形，两处共用本函数。
 * 回退链：窗口内无小时 → provider 日码；雾码缺佐证 → 不参与投票。
 */
function representativeDayCode(hours, sunrise, sunset, providerCode) {
  const win = dayWindow(sunrise, sunset)
  const inWindow = (hours || []).filter(x => x && x.t >= win[0] && x.t <= win[1])
  const pool = inWindow.filter(x => FOG_CODES.indexOf(Number(x.code)) === -1 || fogConfirmed(x))
  if (!pool.length) return providerCode
  const severe = severeCodeAmong(pool)
  if (severe !== null) return severe
  const counts = new Map()
  for (const x of pool) {
    const c = Number(x.code)
    if (!Number.isFinite(c)) continue
    counts.set(c, (counts.get(c) || 0) + 1)
  }
  let bestCode = null
  let bestCount = 0
  for (const [code, n] of counts) {
    // 并列取较大码：不替天气说好话（多云优先于晴）
    if (n > bestCount || (n === bestCount && code > bestCode)) { bestCode = code; bestCount = n }
  }
  return bestCode === null ? providerCode : bestCode
}

// 返回 { elevation, days, detail, series, cloudLevels }；detail 为所选日 24h 全量（含 band）。
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

  // 日码投票只需要 code/rh/visibility，不重算 band/profile（轻量投影与 hourView 共用
  // visibilityKm 与 fogConfirmed，判据不会两处各写一遍）。
  const hourFacts = times.map((t, i) => ({
    t: t.slice(11, 16),
    code: (h.weather_code || [])[i],
    rh: (h.relative_humidity_2m || [])[i],
    visibility: visibilityKm(h, i),
  }))
  const factsByDate = {}
  for (let i = 0; i < times.length; i++) {
    const day = times[i].slice(0, 10)
    if (!factsByDate[day]) factsByDate[day] = []
    factsByDate[day].push(hourFacts[i])
  }

  const outDays = (d.time || []).map((t, i) => {
    const code = (d.weather_code || [])[i]
    const sunrise = ((d.sunrise || [])[i] || '').slice(11, 16)
    const sunset = ((d.sunset || [])[i] || '').slice(11, 16)
    return {
      date: t,
      code,
      // 白昼代表性现象码（additive）：日徽标读它；`code` 原值保留（雷暴/雪的安全条款仍读 code）
      dayCode: representativeDayCode(factsByDate[t], sunrise, sunset, code),
      tMax: Math.round((d.temperature_2m_max || [])[i]),
      tMin: Math.round((d.temperature_2m_min || [])[i]),
      windMax: Math.round((d.wind_speed_10m_max || [])[i]),
      precipSum: Math.round(((d.precipitation_sum || [])[i] || 0) * 10) / 10,
      precipProbMax: (d.precipitation_probability_max || [])[i] || 0,
      precipHours: (d.precipitation_hours || [])[i] || 0,
      sunrise,
      sunset,
      uvMax: (d.uv_index_max || [])[i],
      cloud: { low: mean('low', t), mid: mean('mid', t), high: mean('high', t) },
    }
  })

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
  // Weather V2 additive：多高度云量剖面（与 series 同窗）。buildCloudLevels 内部
  // 全防御，任何异常返回 null —— 旧客户端不读它，新客户端按缺失降级。
  const cloudLevels = buildCloudLevels(times, h, start, series.length)
  return { elevation: Math.round(j.elevation), days: daysOut, detail, series, cloudLevels }
}

/* ---------- Cloud Levels：多高度云量剖面（Weather V2 additive，2026-10） ---------- */

// 把气压层云量/位势高度整理成稳定的透出结构。设计约束：
//   ▸ ADD-ONLY：缺失/异常一律返回 null，绝不影响天气响应主体；
//   ▸ altitude = geopotential_height（模型真实层高 m ASL，逐时变化，故为数组而非标量）；
//   ▸ 缺失值以 null 保留在数组内（可识别），整层全空的气压层（山区地下层）整层省略；
//   ▸ 数值全部整型化（cover 0-100 clamp、海拔取整），NaN 不允许离开本函数。
function buildCloudLevels(times, h, start, count) {
  try {
    if (!times || !times.length || count <= 0) return null
    const slice = times.slice(start, start + count)
    if (slice.length < count) return null
    const levels = []
    for (const lv of PROFILE_CLOUD_LEVELS) {
      const ccArr = h['cloud_cover_' + lv + 'hPa'] || []
      const gtArr = h['geopotential_height_' + lv + 'hPa'] || []
      const altitudes = []
      const cloudCover = []
      let any = false
      for (let i = 0; i < slice.length; i++) {
        const gi = start + i
        const cc = ccArr[gi]
        const gt = gtArr[gi]
        if (Number.isFinite(cc) && Number.isFinite(gt)) {
          altitudes.push(Math.round(gt))
          cloudCover.push(Math.round(Math.max(0, Math.min(100, cc))))
          any = true
        } else {
          altitudes.push(null)
          cloudCover.push(null)
        }
      }
      if (any) levels.push({ pressure: lv, altitudes, cloudCover })
    }
    if (!levels.length) return null
    return { times: slice, levels, unit: { altitude: 'm ASL', cloudCover: '%' } }
  } catch (e) {
    return null
  }
}

// 单小时投影（detail/series 共用）：t 保持 'HH:mm'（既有消费者依赖），d 为所属日期。
// windDir/pressure/dewPoint 为 V2 additive：Open-Meteo 请求里带了就有、没带（旧返回体/测试桩）就是
// undefined——消费方必须按缺失降级，不得假设存在。
const PROFILE_LEVELS = [925, 850, 700]

function profileLevel(h, lv, i) {
  const t = (h['temperature_' + lv + 'hPa'] || [])[i]
  const rh = (h['relative_humidity_' + lv + 'hPa'] || [])[i]
  const tOK = Number.isFinite(t)
  const rhOK = Number.isFinite(rh)
  if (!tOK && !rhOK) return null
  return { t: tOK ? t : null, rh: rhOK ? rh : null }
}

// 能见度 m → km（保留 1 位小数）。逐时投影与日级雾门共用，避免两处各写一遍取整。
function visibilityKm(h, i) {
  const v = (h.visibility || [])[i]
  return Number.isFinite(v) ? Math.round(v / 100) / 10 : null
}

function hourView(times, h, i) {
  const p925 = profileLevel(h, 925, i)
  const p850 = profileLevel(h, 850, i)
  const p700 = profileLevel(h, 700, i)
  const code = (h.weather_code || [])[i]
  const rh = (h.relative_humidity_2m || [])[i]
  const visibility = visibilityKm(h, i)
  return {
    t: times[i].slice(11, 16),
    d: times[i].slice(0, 10),
    temp: (h.temperature_2m || [])[i],
    feels: (h.apparent_temperature || [])[i],
    pop: (h.precipitation_probability || [])[i],
    precip: (h.precipitation || [])[i],
    showers: (h.showers || [])[i],
    code,
    // 雾的佐证结论（additive）：逐时 code 不回改，本字段只给「入云（雾）」提示用
    fog: fogConfirmed({ code, rh, visibility }),
    wind: (h.wind_speed_10m || [])[i],
    gust: (h.wind_gusts_10m || [])[i],
    windDir: (h.wind_direction_10m || [])[i],
    // 相对湿度：彩虹/雾/露的水分信号（降水为 0 时高湿仍可能有雾或虹）
    rh,
    pressure: (h.surface_pressure || [])[i],
    dewPoint: (h.dew_point_2m || [])[i],
    cloud: {
      // 总云量：三层之外的一个交叉校验；旧返回体没有就是 undefined
      total: (h.cloud_cover || [])[i],
      low: (h.cloud_cover_low || [])[i],
      mid: (h.cloud_cover_mid || [])[i],
      high: (h.cloud_cover_high || [])[i],
    },
    uv: (h.uv_index || [])[i],
    visibility,
    freezing: (h.freezing_level_height || [])[i],
    // 边界层高度（m）：霾/扩散的辅助信号，可选
    pblh: (h.boundary_layer_height || [])[i],
    // 低层温湿廓线：云海逆温判断用；缺档为 null，三档全缺则整体 null
    profile: (p925 || p850 || p700) ? { 925: p925, 850: p850, 700: p700 } : null,
    band: cloudBandAt(h, i),
  }
}

// Provider 元信息（V2 最小 interface）：响应体携带数据源标识，页脚/页头署名据此渲染，
// 未来切换 Meteoblue 时只改这里与 fetchForecast 的外呼，UI 与天相分析零改动。
const PROVIDER = { id: 'open-meteo', label: 'Open-Meteo', attribution: 'Open-Meteo.com（CC BY 4.0）' }

/* ---------- P3 独立天气模块：按点自由查询的纯逻辑 ---------- */
// index.js 只做编排（缓存读写、响应组装），校验/窗口判定/坐标纠偏/返回体投影都在这里，
// smoke-test.js 不依赖 wx-server-sdk 即可覆盖。设计文档：天气模块升级-P3 §8。

// 免 OPENID 的天气 action：天气是非个人数据，v1 起 getWeather 即免鉴权，byPoint 沿用同一语义。
// getSkyContext 是同一类“按点取环境事实”的只读 action，也不携带个人信息。
const FREE_ACTIONS = { getWeather: true, getWeatherByPoint: true, getSkyContext: true }
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
    cloudLevels: forecast.cloudLevels || null,
    pointElevation: forecast.elevation,
    // 陈旧兜底透传：index.js 的 getCachedForecast 在外呼失败时可能返回 12 小时内的
    // 旧预报（带 stale/staleAt）。旧客户端不读这两个键；新客户端据此标注时效。
    stale: !!forecast.stale,
    staleAt: forecast.stale ? forecast.staleAt : undefined,
  }
}

module.exports = {
  fetchForecast, fetchJson, cnToday, gcjToWgs, cloudBandAt, hourView, PROVIDER, PROFILE_LEVELS,
  isWeatherFreeAction, weatherCacheKey, resolvePointQuery, pointResponse,
  buildCloudLevels, fogConfirmed, representativeDayCode,
}

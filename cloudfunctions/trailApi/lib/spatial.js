// 方向性天气采样：以查询点为中心，8 个方位 × 3 个距离取 24 个 Open-Meteo 点，
// 聚合成「每个方位一条逐时云/降水曲线」。用途：
//   · 银河：银心方位上的云量（不是只看整列中高层云）；
//   · 彩虹：反日点方位上有没有降水（不是只看查询点有没有雨）；
//   · 光染/云海：后续可按太阳/谷地方位取低云。
// 纯函数（grid/aggregate）与网络分离：smoke-test 可直接测几何与聚合，不外呼。
// 这是 Open-Meteo 同源扩展（Slice 2），不引入新数据源；模型分辨率约 15 km，
// 0.05°/15/30 km 采样是「方向粗判」，不是雷达实况。结果必须按方向/小时标注来源。
'use strict'

const { fetchJson } = require('./weather')

const AZIMUTHS = [0, 45, 90, 135, 180, 225, 270, 315]
const DISTANCES_KM = [5, 15, 30]

// 从 (lat,lng) 沿方位角走 km 的球面近似；只用于 1–30 km 的天气采样，不用于导航。
function offsetPoint(lat, lng, azimuthDeg, km) {
  const rad = azimuthDeg * Math.PI / 180
  const dLat = (km / 111.32) * Math.cos(rad)
  const cosLat = Math.cos(lat * Math.PI / 180)
  const dLng = cosLat > 1e-6 ? (km / (111.32 * cosLat)) * Math.sin(rad) : 0
  return {
    lat: Math.max(-89.9, Math.min(89.9, lat + dLat)),
    lng: ((lng + dLng + 540) % 360) - 180,
    azimuth: azimuthDeg,
    distance: km,
  }
}

// 8×3 = 24 个采样点；顺序固定（aggregateSpatial 依赖这个顺序）
function gridPoints(lat, lng) {
  const out = []
  AZIMUTHS.forEach(az => {
    DISTANCES_KM.forEach(d => out.push(offsetPoint(lat, lng, az, d)))
  })
  return out
}

function buildSpatialUrl(lat, lng, date, endDate) {
  const pts = gridPoints(lat, lng)
  const q = new URLSearchParams({
    latitude: pts.map(p => p.lat.toFixed(4)).join(','),
    longitude: pts.map(p => p.lng.toFixed(4)).join(','),
    hourly: 'cloud_cover_low,cloud_cover_mid,cloud_cover_high,cloud_cover,precipitation,precipitation_probability',
    start_date: date,
    // 跨夜：银河/星空的“今晚”会走到次日晨，方向云必须同时覆盖次日
    end_date: endDate || date,
    timezone: 'Asia/Shanghai',
  })
  return { url: 'https://api.open-meteo.com/v1/forecast?' + q.toString(), points: pts }
}

function finite(v) {
  return typeof v === 'number' && Number.isFinite(v)
}

// 单方位单小时：三个距离点里取有限值的均值；全缺 → null（可识别，不编 0）
function avgAt(items, key, hourIdx) {
  const xs = items
    .map(it => it && it.hourly && (it.hourly[key] || [])[hourIdx])
    .filter(finite)
  if (!xs.length) return null
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 10) / 10
}

/**
 * 把 24 个 Open-Meteo 响应聚合成 8 个方位。
 * @param payload 数组（多坐标）或单个对象
 * @param points  gridPoints 的返回值（顺序与 payload 对应）
 * @param date    'YYYY-MM-DD'
 * @returns {date, azimuths, hours, byAzimuth:[{azimuth, low[], mid[], high[], total[], precip[], pop[]}]}
 *          数据不足返回 null（调用方按缺省降级，不把缺测当 0）。
 */
function aggregateSpatial(payload, points, date, endDate) {
  const list = Array.isArray(payload) ? payload : [payload]
  if (!list.length) return null
  const first = list.find(it => it && it.hourly && Array.isArray(it.hourly.time))
  if (!first) return null
  const end = endDate || date
  const hourIdx = []
  const times = []
  const hours = []
  first.hourly.time.forEach((t, i) => {
    const day = String(t).slice(0, 10)
    if (day >= date && day <= end) {
      hourIdx.push(i)
      times.push(String(t).slice(0, 16))
      hours.push(String(t).slice(11, 16))
    }
  })
  if (!hourIdx.length) return null
  const byAzimuth = AZIMUTHS.map(az => {
    const items = points
      .map((p, i) => (p.azimuth === az ? list[i] : null))
      .filter(Boolean)
    const arr = key => hourIdx.map(i => avgAt(items, key, i))
    return {
      azimuth: az,
      low: arr('cloud_cover_low'),
      mid: arr('cloud_cover_mid'),
      high: arr('cloud_cover_high'),
      total: arr('cloud_cover'),
      precip: arr('precipitation'),
      pop: arr('precipitation_probability'),
    }
  })
  return {
    date,
    endDate: end,
    dates: times.map(t => t.slice(0, 10)).filter((d, i, a) => a.indexOf(d) === i),
    times,
    hours,
    byAzimuth,
  }
}

async function fetchSpatial(lat, lng, date, endDate) {
  const { url, points } = buildSpatialUrl(lat, lng, date, endDate)
  const payload = await fetchJson(url)
  return aggregateSpatial(payload, points, date, endDate)
}

module.exports = {
  AZIMUTHS, DISTANCES_KM, offsetPoint, gridPoints, buildSpatialUrl,
  aggregateSpatial, fetchSpatial,
}

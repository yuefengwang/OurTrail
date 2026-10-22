// 地形地平线：以查询点为中心，16 个方位 × 9 个距离（1–80 km）采样 Copernicus DEM 90 m，
// 计算每个方位的「地平线角」。用途：
//   · 银河：银心方位的地平线角是否高过银心高度；
//   · 彩虹：反日方向是否被山脊挡住；
//   · 光染：日出/日落方位的最高地形点（候选山脊），替代“轨迹走向”这个假目标；
//   · 云海：四周 openness（有多少方位的地平线在水平线以下）。
// 这是“粗地平线”：90 m DEM 不含树木/建筑，采样距离离散，折射用 0.13 经验系数。
// 网络与几何分离：horizonFrom/pointsFor 可在 node 下测，fetchHorizon 才外呼。
'use strict'

const { fetchJson } = require('./weather')
const { offsetPoint } = require('./spatial')

const AZIMUTHS = []
for (let a = 0; a < 360; a += 22.5) AZIMUTHS.push(a)
const DISTANCES_KM = [1, 2, 4, 8, 12, 20, 30, 50, 80]
const R_EARTH = 6371000
const REFRACTION = 0.13
const ELEV_URL = 'https://api.open-meteo.com/v1/elevation'

function dipDeg(elevM) {
  const h = Number.isFinite(elevM) && elevM > 0 ? elevM : 0
  return Math.acos(R_EARTH / (R_EARTH + h)) * 180 / Math.PI
}

// 16×9 = 144 个点；顺序固定（horizonFrom 依赖）
function pointsFor(lat, lng) {
  const out = []
  AZIMUTHS.forEach(az => {
    DISTANCES_KM.forEach(d => out.push(offsetPoint(lat, lng, az, d)))
  })
  return out
}

function elevationUrl(points) {
  return ELEV_URL +
    '?latitude=' + points.map(p => p.lat.toFixed(4)).join(',') +
    '&longitude=' + points.map(p => p.lng.toFixed(4)).join(',')
}

/**
 * 由 DEM 高程算每个方位的最高视角。
 * @param pointElev 观察点海拔（m）；不传/非数时用 0
 * @param samples   pointsFor 的返回值
 * @param elevations 与 samples 等长的海拔数组（缺失/NaN 跳过）
 * @returns {elevation, dip, horizon:[{azimuth,angle,distance,elevation}], openness, source}
 *          angle 是相对观察点水平面的几何角；平地的海平面地平线为 -dip。
 */
function horizonFrom(pointElev, samples, elevations) {
  const ground = Number.isFinite(pointElev) ? pointElev : 0
  const dip = dipDeg(ground)
  const byAz = AZIMUTHS.map(az => {
    let best = { azimuth: az, angle: -dip, distance: 0, elevation: Math.round(ground) }
    samples.forEach((s, i) => {
      if (s.azimuth !== az) return
      const h = elevations[i]
      if (!Number.isFinite(h)) return
      const d = s.distance * 1000
      const drop = (1 - REFRACTION) * d * d / (2 * R_EARTH)
      const angle = Math.atan(((h - ground) - drop) / d) * 180 / Math.PI
      if (angle > best.angle) {
        best = {
          azimuth: az,
          angle: Math.round(angle * 100) / 100,
          distance: s.distance,
          elevation: Math.round(h),
        }
      }
    })
    return best
  })
  const openness = Math.round(byAz.filter(h => h.angle < 1).length / byAz.length * 100) / 100
  return {
    elevation: Math.round(ground),
    dip: Math.round(dip * 100) / 100,
    horizon: byAz,
    openness,
    source: 'copernicus-glo90',
  }
}

async function fetchElevations(points) {
  const chunks = []
  for (let i = 0; i < points.length; i += 100) chunks.push(points.slice(i, i + 100))
  const results = await Promise.all(chunks.map(chunk => fetchJson(elevationUrl(chunk))))
  const out = []
  results.forEach(j => {
    if (!j || !Array.isArray(j.elevation)) throw new Error('地形数据解析失败')
    out.push.apply(out, j.elevation)
  })
  return out
}

async function fetchHorizon(lat, lng, elevation) {
  const pts = pointsFor(lat, lng)
  const needCenter = !Number.isFinite(elevation)
  // 中心点与网格并行，避免“缺海拔”时把两次 10s 超时串成 20s
  const [center, elevs] = await Promise.all([
    needCenter ? fetchElevations([{ lat, lng }]) : Promise.resolve(null),
    fetchElevations(pts),
  ])
  const ground = needCenter ? center[0] : elevation
  return horizonFrom(ground, pts, elevs)
}

module.exports = {
  AZIMUTHS, DISTANCES_KM, dipDeg, pointsFor, elevationUrl,
  horizonFrom, fetchElevations, fetchHorizon,
}

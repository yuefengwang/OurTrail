// 天文计算：太阳位置与日出日落/三重暮光/黄金蓝调时刻 + 月相、银心季节与方位、观星条件。
// 纯函数、无 wx 依赖，可在 node 下测试（tools/astro-test.js）。
// 太阳位置算法：NOAA Solar Calculator（低精度式），日出日落误差约 ±2 分钟，
// 精度只用于"有没有可能"的概率判断，不做航海/天文级用途。
//
// 时间基准约定：全站时间都是北京时间且无夏令时，故所有换算固定 UTC+8（不查时区库）。
// 传入的 dateStr 为北京时间的自然日 'YYYY-MM-DD'，与 Open-Meteo（timezone=Asia/Shanghai）一致。
'use strict'

const RAD = Math.PI / 180
const DEG = 180 / Math.PI
const TZ_MIN = 8 * 60 // 北京时间固定 +08:00

const SYNODIC = 29.530588853 // 朔望月（天）
// 参考点：2000-01-06 18:14 UTC 新月
const REF_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14)

/* ---------- 基础工具 ---------- */

function norm360(x) {
  const v = x % 360
  return v < 0 ? v + 360 : v
}

function norm1440(x) {
  const v = x % 1440
  return v < 0 ? v + 1440 : v
}

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v)
}

// 分钟 → 'HH:mm'（跨日由调用方用 dayOffset 表达）
function hhmm(min) {
  const v = Math.round(norm1440(min))
  return String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0')
}

// 判断归一化时是否跨过日界（用于"次日 05:32"这类表述）
function dayOffset(min) {
  const raw = min + TZ_MIN
  return Math.floor(raw / 1440) === 0 && raw >= 0 ? 0 : (raw < 0 ? -1 : 1)
}

/* ---------- 太阳：赤纬与均时差 ---------- */

function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

// 一年中的第几天（1–366）
function dayOfYear(dateStr) {
  const y = Number(dateStr.slice(0, 4))
  const m = Number(dateStr.slice(5, 7))
  const d = Number(dateStr.slice(8, 10))
  const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
  return cum[m - 1] + d + (m > 2 && isLeap(y) ? 1 : 0)
}

// 太阳赤纬（度）与均时差（分钟）。NOAA 分数年公式：只需年内第几天，不依赖儒略日。
// 均时差取当日 12:00 附近的值——一天内变化 < 20 秒，对日出时刻无影响。
function solarTerms(dateStr) {
  const n = dayOfYear(dateStr)
  const g = (2 * Math.PI / 365) * (n - 1 + 0.5)
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g))
  const declRad = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
    - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g)
  return { decl: declRad * DEG, eqTime, dayOfYear: n }
}

// 日出日落的视高度角：几何地平线 -0.833°（蒙气差）再减去俯角 → 高处看日出更早、日落更晚
const SUN_HORIZON = -0.833

// 太阳高度角 h0（度）的升/落时刻，单位为北京时间的"当日分钟数"（可能 >1440 表示跨到次日）
// 返回 null 表示该高度角全天不到（极夜方向）；polarDay 表示全天都在（极昼方向）。
function altitudeCrossings(dateStr, lat, lng, h0) {
  const { decl, eqTime } = solarTerms(dateStr)
  const cosH = (Math.sin(h0 * RAD) - Math.sin(lat * RAD) * Math.sin(decl * RAD))
    / (Math.cos(lat * RAD) * Math.cos(decl * RAD))
  if (cosH > 1) return null
  if (cosH < -1) return { polarDay: true }
  const H = Math.acos(clamp(cosH, -1, 1)) * DEG
  return {
    rise: 720 - 4 * (lng + H) - eqTime + TZ_MIN,
    set: 720 - 4 * (lng - H) - eqTime + TZ_MIN,
  }
}

// 地平线俯角（度）：高山看日出比海边早。h=3000m 时约 1.77°。
function horizonDip(elevM) {
  if (!Number.isFinite(elevM) || elevM <= 0) return 0
  return (Math.acos(6371000 / (6371000 + elevM)) * DEG)
}

/**
 * 某日太阳事件时刻表。
 * @param dateStr 北京时间自然日 'YYYY-MM-DD'
 * @param elevM 观察点海拔（可选，用于俯角修正：越高日出越早、日落越晚）
 * @returns { sunrise, sunset, civilDawn, civilDusk, nauticalDawn, nauticalDusk, astroDawn, astroDusk, dayLengthMin, dip }
 *          值为 'HH:mm'；极昼/极夜方向为 null。dayLengthMin 为昼长（分钟）。
 */
function sunTimes(dateStr, lat, lng, elevM) {
  const dip = horizonDip(elevM)
  const at = h0 => {
    const c = altitudeCrossings(dateStr, lat, lng, h0)
    if (!c) return { rise: null, set: null }
    if (c.polarDay) return { rise: null, set: null, allDay: true }
    return { rise: c.rise, set: c.set }
  }
  // 日出日落含蒙气差（-0.833）并按海拔修正俯角；暮光角取标准几何角（-6/-12/-18），不修正俯角
  const sun = at(SUN_HORIZON - dip)
  const civil = at(-6)
  const nautical = at(-12)
  const astro = at(-18)
  const val = v => (v == null ? null : hhmm(v))
  return {
    sunrise: val(sun.rise),
    sunset: val(sun.set),
    civilDawn: val(civil.rise),
    civilDusk: val(civil.set),
    nauticalDawn: val(nautical.rise),
    nauticalDusk: val(nautical.set),
    astroDawn: val(astro.rise),
    astroDusk: val(astro.set),
    dayLengthMin: sun.rise != null && sun.set != null ? Math.round(sun.set - sun.rise) : null,
    dip: Math.round(dip * 100) / 100,
  }
}

/**
 * 摄影窗口：由太阳高度角穿越点推出黄金时刻与蓝调时刻。
 * 时间推进顺序（清晨）：天文暮光 -18° → 航海 -12° → 民用 -6° → 蓝调结束 -4° → 日出 0° → 黄金结束 +6°。
 * 蓝调 = -6°→-4°（民用暮光前后，星空/风光摄影的经典窗口）；黄金 = 0°→6°（日出后 / 日落前）。
 * @returns { morningGolden, eveningGolden, dawnBlue, duskBlue } 形如 { from, to }（'HH:mm'）或 null
 */
function photoWindows(dateStr, lat, lng, elevM) {
  const dip = horizonDip(elevM)
  const at = h0 => altitudeCrossings(dateStr, lat, lng, h0)
  const p6 = at(6 + dip)     // 黄金时刻外沿（+6°）
  const hz = at(SUN_HORIZON - dip) // 与 sunTimes 同源的日出/日落参考
  const b4 = at(-4)
  const b6 = at(-6)
  const ok = c => c && !c.polarDay && c.rise != null && c.set != null
  return {
    morningGolden: ok(p6) && ok(hz) ? { from: hhmm(hz.rise), to: hhmm(p6.rise) } : null,
    eveningGolden: ok(p6) && ok(hz) ? { from: hhmm(p6.set), to: hhmm(hz.set) } : null,
    dawnBlue: ok(b4) && ok(b6) ? { from: hhmm(b6.rise), to: hhmm(b4.rise) } : null,
    duskBlue: ok(b4) && ok(b6) ? { from: hhmm(b4.set), to: hhmm(b6.set) } : null,
  }
}

/**
 * 任意时刻的太阳位置。
 * @param dateMs 时间戳（UTC 毫秒）
 * @returns { altitude, azimuth } 高度角与方位角（度）。方位角自北顺时针：0=N 90=E 180=S 270=W。
 */
function solarPosition(dateMs, lat, lng) {
  const utc = new Date(dateMs)
  const terms = solarTerms(utc.toISOString().slice(0, 10))
  const minUtc = utc.getUTCHours() * 60 + utc.getUTCMinutes() + utc.getUTCSeconds() / 60
  const trueSolar = norm1440(minUtc + terms.eqTime + 4 * lng)
  let ha = trueSolar / 4 - 180
  if (ha < -180) ha += 360
  const cosZ = Math.sin(lat * RAD) * Math.sin(terms.decl * RAD)
    + Math.cos(lat * RAD) * Math.cos(terms.decl * RAD) * Math.cos(ha * RAD)
  const zenith = Math.acos(clamp(cosZ, -1, 1)) * DEG
  // 方位角用 atan2 式：正午前后太阳接近天顶时 acos 式会因分母趋零而失稳（cosAz 溢出 1）
  const az = Math.atan2(
    Math.sin(ha * RAD),
    Math.cos(ha * RAD) * Math.sin(lat * RAD) - Math.tan(terms.decl * RAD) * Math.cos(lat * RAD)
  )
  const azimuth = norm360(az * DEG + 180)
  return { altitude: Math.round((90 - zenith) * 100) / 100, azimuth: Math.round(azimuth * 100) / 100 }
}

// 把北京时间的 'YYYY-MM-DD' + 'HH:mm' 折成 UTC 毫秒（固定 +08:00）
function cnToMs(dateStr, hhmmStr) {
  const t = (hhmmStr || '00:00').slice(0, 5)
  return Date.parse(dateStr + 'T' + t + ':00+08:00')
}

// 方位角 → 中文八方位短语（用于"往哪看"）
const BEARINGS = [
  [0, '正北'], [45, '东北'], [90, '正东'], [135, '东南'],
  [180, '正南'], [225, '西南'], [270, '正西'], [315, '西北'], [360, '正北'],
]

function bearingLabel(deg) {
  if (!Number.isFinite(deg)) return ''
  const a = norm360(deg)
  for (let i = 0; i < BEARINGS.length; i++) {
    if (a < BEARINGS[i][0] + 22.5) return BEARINGS[i][1]
  }
  return '正北'
}

/* ---------- 月相与银河 ---------- */

// 月相：返回 { age（月龄，天）, illumination（照亮百分比 0-100）, name }
function moonInfo(dateIso) {
  const days = (Date.parse(dateIso + 'T12:00:00Z') - REF_NEW_MOON) / 86400000
  const age = ((days % SYNODIC) + SYNODIC) % SYNODIC
  const illumination = Math.round((1 - Math.cos((2 * Math.PI * age) / SYNODIC)) / 2 * 100)
  const names = ['新月', '娥眉月', '上弦月', '盈凸月', '满月', '亏凸月', '下弦月', '残月']
  const name = names[Math.floor((age / SYNODIC) * 8 + 0.5) % 8]
  return { age: Math.round(age * 10) / 10, illumination, name }
}

// 银河核心季节（北纬 25–35°）：约 3–10 月夜间可见银心方向
function galaxySeason(dateIso) {
  const m = Number(dateIso.slice(5, 7))
  return m >= 3 && m <= 10
}

// 银心（银河核心）方位：北纬 25–40° 的经验曲线——入夜东南、午夜前后正南偏西、后半夜西南。
// 表以"20:00 起的钟点数"为横轴（单调递增，天然跨零点），按北京时间的钟点线性插值。
// 只用于"该往哪个方向找"的粗判，不是天文级星历。
const GALAXY_BEARING_TABLE = [
  [20.5, 105], [22, 128], [23.5, 150], [25, 172], [26.5, 196], [28, 218], [29.5, 238],
]

/**
 * 银心方位角（度）。hour 为北京时间钟点小数（0–24）。非银心季返回 null。
 */
function galaxyBearing(dateIso, hour) {
  if (!galaxySeason(dateIso) || !Number.isFinite(hour)) return null
  const t = hour < 20 ? hour + 24 : hour // 20:00 之后的钟点视为"次日凌晨"，统一到同一坐标系
  const tb = GALAXY_BEARING_TABLE
  if (t <= tb[0][0]) return tb[0][1]
  if (t >= tb[tb.length - 1][0]) return tb[tb.length - 1][1]
  for (let i = 0; i < tb.length - 1; i++) {
    if (t >= tb[i][0] && t <= tb[i + 1][0]) {
      const r = (t - tb[i][0]) / (tb[i + 1][0] - tb[i][0])
      return Math.round(tb[i][1] + (tb[i + 1][1] - tb[i][1]) * r)
    }
  }
  return null
}

/**
 * 星空/银河结论。nightHours: 该日天文暗夜时段的小时 { t, cloud:{low,mid,high}, precip }，
 * moon: moonInfo 结果。返回 { star:{tone,text}, galaxy:{tone,text} }，概率语言。
 */
function starSight(nightHours, moon, galaxy) {
  const n = nightHours.length
  if (!n) return { star: { tone: '', text: '夜间数据不足' }, galaxy: { tone: '', text: '夜间数据不足' } }
  const clearRate = Math.round(nightHours.filter(h => (h.cloud.high + h.cloud.mid) / 2 < 30 && !h.precip).length / n * 100)
  const brightMoon = moon.illumination >= 60
  const star = { tone: '', text: '' }
  if (clearRate >= 70 && !brightMoon) {
    star.tone = 'success'
    star.text = '夜间晴朗且月照仅 ' + moon.illumination + '%（' + moon.name + '），星空条件好'
  } else if (clearRate >= 70) {
    star.text = '夜间晴朗，但月照 ' + moon.illumination + '% 较亮，亮星可见、银河困难'
  } else if (clearRate >= 40) {
    star.tone = 'warning'
    star.text = '夜间有云（晴 ' + clearRate + '%），观星看运气'
  } else {
    star.tone = 'warning'
    star.text = '夜间云量高，观星条件差'
  }
  const galaxyOut = { tone: '', text: '' }
  if (!galaxy) {
    galaxyOut.text = '不在银心季节（约 3–10 月），仅亮星可见'
  } else if (clearRate >= 70 && moon.illumination < 35) {
    galaxyOut.tone = 'success'
    galaxyOut.text = '银心季 + 月照低 + 夜间晴，凌晨朝东南方向银河概率较大'
  } else if (clearRate >= 70) {
    galaxyOut.text = '银心季但月照偏亮，银河大概率被月光盖住'
  } else {
    galaxyOut.text = '夜间云量偏高，银河不建议抱期望'
  }
  return { star, galaxy: galaxyOut }
}

module.exports = {
  solarTerms, solarPosition, sunTimes, photoWindows, altitudeCrossings, horizonDip, dayOfYear,
  cnToMs, hhmm, norm1440, norm360, bearingLabel, galaxyBearing,
  moonInfo, galaxySeason, starSight,
}

// 天文计算：太阳位置与日出日落/三重暮光/黄金蓝调时刻 + 月相、月球高度/升落、银心高度与方位。
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

/* ---------- 月球与银心位置（纯几何，供星空/银河判定用） ----------
 * 这里只回答“这个时刻它在地平线上多高、朝哪边”，不做星历级精度：
 * 月球用 Schlyter 简化式 + 主要摄动项（误差约 0.2–0.5°，对“在不在天上/离银心多远”足够）；
 * 银心用 J2000 固定赤经赤纬 + 地方恒星时。两个函数都不依赖 wx，可在 node 下测。
 * 注意：月球位置是地心坐标，未做地平视差修正（最大约 1°，对应升落约 2 分钟）。
 */

const GALACTIC_CENTER = { ra: 266.41683, dec: -29.00781 } // J2000，银心 Sgr A*

function julianDay(dateMs) {
  return dateMs / 86400000 + 2440587.5
}

// 格林尼治平恒星时（度）。Meeus 简化式，精度足够做“地平线上/下”判断。
function gmstDeg(dateMs) {
  const jd = julianDay(dateMs)
  const T = (jd - 2451545.0) / 36525
  const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
    + 0.000387933 * T * T - T * T * T / 38710000
  return norm360(gmst)
}

function localSiderealDeg(dateMs, lng) {
  return norm360(gmstDeg(dateMs) + lng)
}

/**
 * 赤道坐标 → 地平坐标。方位角自北顺时针，高度角为几何高度（未含蒙气差）。
 * 与 solarPosition 同一套方位约定：H 为正表示天体在子午线以西。
 */
function equatorialToHorizontal(raDeg, decDeg, lat, lng, dateMs) {
  const H = norm360(localSiderealDeg(dateMs, lng) - raDeg) * RAD
  const dec = decDeg * RAD
  const latRad = lat * RAD
  const sinAlt = Math.sin(dec) * Math.sin(latRad)
    + Math.cos(dec) * Math.cos(latRad) * Math.cos(H)
  const altitude = Math.asin(clamp(sinAlt, -1, 1)) * DEG
  const az = Math.atan2(
    Math.sin(H),
    Math.cos(H) * Math.sin(latRad) - Math.tan(dec) * Math.cos(latRad)
  )
  return {
    altitude: Math.round(altitude * 100) / 100,
    azimuth: Math.round(norm360(az * DEG + 180) * 100) / 100,
  }
}

/**
 * 月球地心位置 → 地平坐标。Schlyter 简化式 + 主要摄动项。
 * 误差约 0.2–0.5°，用于“月亮是否在地平线上、离银心多远”，不做定位/摄影级用途。
 */
function moonPosition(dateMs, lat, lng) {
  // Schlyter 的 d：自 2000-01-01 00:00 UT（JD 2451543.5）起的天数
  const d = julianDay(dateMs) - 2451543.5
  const N = norm360(125.1228 - 0.0529538083 * d) // 升交点黄经
  const i = 5.1454 // 轨道倾角
  const w = norm360(318.0634 + 0.1643573223 * d) // 近地点角距
  const a = 60.2666 // 地球半径
  const e = 0.0549
  const M = norm360(115.3654 + 13.0649929509 * d) // 平近点角

  // 解开普勒方程
  let E = M * RAD
  for (let k = 0; k < 10; k++) {
    E = E - (E - e * Math.sin(E) - M * RAD) / (1 - e * Math.cos(E))
  }
  const xv = a * (Math.cos(E) - e)
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E)
  const v = Math.atan2(yv, xv)
  const r = Math.sqrt(xv * xv + yv * yv)
  const vw = v + w * RAD
  const Nr = N * RAD
  const ir = i * RAD

  // 未摄动的黄道直角坐标
  const xe = r * (Math.cos(Nr) * Math.cos(vw) - Math.sin(Nr) * Math.sin(vw) * Math.cos(ir))
  const ye = r * (Math.sin(Nr) * Math.cos(vw) + Math.cos(Nr) * Math.sin(vw) * Math.cos(ir))
  const ze = r * Math.sin(vw) * Math.sin(ir)
  let lon = Math.atan2(ye, xe)
  let latEcl = Math.atan2(ze, Math.sqrt(xe * xe + ye * ye))

  // 主要摄动项（Schlyter §Moon）：把月亮从“理想二体”拉回真实轨道
  const Ms = norm360(356.0470 + 0.9856002585 * d) // 太阳平近点角
  const ws = norm360(282.9404 + 4.70935e-5 * d) // 太阳近地点黄经
  const Ls = norm360(Ms + ws) // 太阳平黄经
  const Lm = norm360(N + w + M) // 月亮平黄经
  const D = norm360(Lm - Ls) // 平距角
  const F = norm360(Lm - N) // 升交点角距
  const sin = x => Math.sin(x * RAD)
  const cos = x => Math.cos(x * RAD)
  lon += (-1.274 * sin(M - 2 * D) + 0.658 * sin(2 * D) - 0.186 * sin(Ms)
    - 0.059 * sin(2 * M - 2 * D) - 0.057 * sin(M - 2 * D + Ms)
    + 0.053 * sin(M + 2 * D) + 0.046 * sin(2 * D - Ms)
    + 0.041 * sin(M - Ms) - 0.035 * sin(D) - 0.031 * sin(M + Ms)
    - 0.015 * sin(2 * F - 2 * D) + 0.011 * sin(M - 4 * D)) * RAD
  latEcl += (-0.173 * sin(F - 2 * D) - 0.055 * sin(M - F - 2 * D)
    - 0.046 * sin(M + F - 2 * D) + 0.033 * sin(F + 2 * D)
    + 0.017 * sin(2 * M + F)) * RAD

  // 黄道 → 赤道
  const ob = (23.4393 - 3.563e-7 * d) * RAD
  const xeq = Math.cos(latEcl) * Math.cos(lon)
  const yeq = Math.cos(latEcl) * Math.sin(lon) * Math.cos(ob) - Math.sin(latEcl) * Math.sin(ob)
  const zeq = Math.cos(latEcl) * Math.sin(lon) * Math.sin(ob) + Math.sin(latEcl) * Math.cos(ob)
  const ra = norm360(Math.atan2(yeq, xeq) * DEG)
  const dec = Math.atan2(zeq, Math.sqrt(xeq * xeq + yeq * yeq)) * DEG
  return equatorialToHorizontal(ra, dec, lat, lng, dateMs)
}

/**
 * 某日北京时间的月出/月落。按 10 分钟采样找地平线穿越，误差约几分钟；
 * 极区或当天不升不落时 alwaysUp/alwaysDown 为 true。
 */
function moonTimes(dateStr, lat, lng, elevM) {
  const h0 = SUN_HORIZON - horizonDip(elevM)
  const start = cnToMs(dateStr, '00:00')
  const events = []
  let prev = null
  for (let m = 0; m <= 1440; m += 10) {
    const p = moonPosition(start + m * 60000, lat, lng)
    const above = p.altitude > h0
    if (prev && above !== prev.above) {
      const frac = (h0 - prev.alt) / (p.altitude - prev.alt)
      events.push({ type: above ? 'rise' : 'set', min: prev.m + frac * (m - prev.m) })
    }
    prev = { m, alt: p.altitude, above }
  }
  const at = type => {
    const e = events.find(x => x.type === type)
    return e ? hhmm(e.min) : null
  }
  return {
    rise: at('rise'),
    set: at('set'),
    alwaysUp: events.length === 0 && !!prev && prev.above,
    alwaysDown: events.length === 0 && !!prev && !prev.above,
  }
}

// 银心（Sgr A*）在该时刻的地平坐标；核心是否可见用它判，不再用月份经验表。
function galaxyPosition(dateMs, lat, lng) {
  return equatorialToHorizontal(GALACTIC_CENTER.ra, GALACTIC_CENTER.dec, lat, lng, dateMs)
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

module.exports = {
  solarTerms, solarPosition, sunTimes, photoWindows, altitudeCrossings, horizonDip, dayOfYear,
  /* 几何地平线 + 蒙气差的视高度（-0.833°）：日出日落与彩虹「太阳照得出来」的判定共用这一个数。
     新代码引用它，不再新写 -0.833 字面量。 */
  SUN_HORIZON,
  cnToMs, hhmm, norm1440, norm360, bearingLabel,
  moonInfo, SYNODIC,
  equatorialToHorizontal, moonPosition, moonTimes, galaxyPosition,
}

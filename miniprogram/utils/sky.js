// 天相转译：把客观气象与天文数据翻译成徒步者看得懂的结论卡。
// 输入一个路线节点的当日 24h 逐时数据 + 坐标/海拔 + 轨迹走向；输出结论列表与逐小时天相标记。
// 纯函数、无 wx 依赖，可在 node 下测试（tools/sky-test.js）。
//
// 定位（重要）：这是"概率判断"，不是预报产品。结论一律用概率语言，并附判断依据、
// "往哪看"与时段；模型云量与云海为推算，具体山谷的云海与光染任何产品都无法保证。
// 置信分级：单模型（Open-Meteo）信号叠加，按分数给三级文案（条件较好/一般/较差），
// 不做多模型互验——理由见设计文档《天气模块升级-P2 天相与 meteogram》§4。
'use strict'

const A = require('./astro')
/* 「什么算一个实心云带」不由本文件定义：provider 的 cloudBandAt 已经按 ≥80% 成带，
   这个判据的唯一出处在 L1 云层事实模块里。以前这里抄过两遍字面量 80，
   现在改一处只会跟着一起动（tools/cloud-layer-facts-test.js §7 用影子常量证这条链真的接上了）。 */
const CLF = require('./cloud-layer-facts.js')

/* ---------- 基础工具 ---------- */

function hourMin(t) {
  const s = (t || '').slice(0, 5)
  if (s.length < 4) return NaN
  return Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5))
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function mean(list) {
  const xs = list.filter(x => Number.isFinite(x))
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}

// 两点间真方位角（度，自北顺时针）
function bearingBetween(a, b) {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(b.lat)) return null
  const toRad = Math.PI / 180
  const dLng = (b.lng - a.lng) * toRad
  const y = Math.sin(dLng) * Math.cos(b.lat * toRad)
  const x = Math.cos(a.lat * toRad) * Math.sin(b.lat * toRad)
    - Math.sin(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.cos(dLng)
  return Math.round((Math.atan2(y, x) / toRad + 360) % 360)
}

// 方位角是否落在 [from, to] 弧内（from/to 为 0-360 度，from > to 表示跨 0）
function inArc(deg, from, to) {
  const d = ((deg % 360) + 360) % 360
  return from <= to ? d >= from && d <= to : d >= from || d <= to
}

// 钟点是否落在 [from, to] 分钟区间内（from > to 视为跨 0）
function inWindow(m, from, to) {
  if (!Number.isFinite(m) || !Number.isFinite(from) || !Number.isFinite(to)) return false
  return from <= to ? m >= from && m <= to : m >= from || m <= to
}

/**
 * 整点小时 [m, m+59] 是否与 [from, to] 区间相交。
 * 晨昏光染窗口约 50 分钟、蓝调仅十余分钟，若按"整点是否落在窗口内"判定会整段漏掉
 * （例如日出 06:09 → 窗口 06:09-06:59，里面一个整点都没有）。故与太阳位置相关的标记
 * 一律用相交判定。
 */
function hourTouches(m, from, to) {
  if (!Number.isFinite(m) || !Number.isFinite(from) || !Number.isFinite(to)) return false
  if (from <= to) return m + 59 >= from && m <= to
  return m + 59 >= from || m <= to
}

function addDays(iso, n) {
  return new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
}

/* ---------- 置信分级 ---------- */

const GRADES = [
  { min: 70, tone: 'success', label: '条件较好' },
  { min: 45, tone: 'warning', label: '条件一般' },
  { min: 0, tone: 'neutral', label: '条件较差' },
]

function grade(score) {
  const s = Math.max(0, Math.min(100, score))
  for (const g of GRADES) {
    if (s >= g.min) return { score: Math.round(s), tone: g.tone, label: g.label }
  }
  return { score: Math.round(s), tone: 'neutral', label: GRADES[GRADES.length - 1].label }
}

/* 结论的三态判定（呈现层据此决定"出不出这张卡"，不再靠分数恰好为 0 的巧合）：
   possible —— 必要条件成立，有戏；分数只回答"多有戏"，不回答"要不要露出来"。
   excluded —— **判过了**，必要条件不成立（暗夜晴空 0%、没有成层低云带、此点不在云上、
               太阳能不能照出来都不成立）⇒ 页面沉默。乌漆嘛黑的一天还挂着
               「朝西南 231 度找银心带」，是把"不可能"包装成"建议"。
   unknown  —— 缺输入判不出（没有可信海拔、没有暗夜时段数据）⇒ **必须仍然出现并说明缺什么**，
               否则未知会被读成"没有云/没有机会"（铁律 26②）。
   分档阈值一个都没动：这是给已有分支结论起名字，不是新增判据。 */
const VERDICT = { POSSIBLE: 'possible', EXCLUDED: 'excluded', UNKNOWN: 'unknown' }

/* 页面/呈现层只问这一句，不各自比较枚举原文（铁律 22：模板不比较枚举字面量）。
   没有 verdict 的一律算"不沉默"——判不出不能读成不成立，缺字段也不能把卡吃掉。 */
function isSilent(item) {
  return !!item && item.verdict === VERDICT.EXCLUDED
}

/* 「条件一般」的上界（= GRADES 里「条件较好」的下界减 1）。
   文案已经说了「未计入 / 光污染较高 / 月光偏亮…不建议抱太大期望」时，星级必须与之一致，
   不能再挂「条件较好」。三种封印同源：缺光污染读数、光污染较高、银河月光影响大。
   上限直接读 GRADES 而不是写字面量 69：分档定义改了，这里必须跟着改（铁律 31③）。 */
function cap69(score, cond) {
  const top = GRADES[0].min - 1
  return cond && score > top ? top : score
}

/* 「光到不到得了山体」的唯一口径：低云 < 40%。
   三处消费同一个数：逐小时光染判据、彩虹的"太阳照得出来"闸、时间轴摄影窗口的事实后缀。
   放进**导出的对象**而不是 const 字面量，是为了让影子测试改得动（铁律 31③）——
   写成 const + 快照赋值的话，影子改了不跟着动，那条门就是假的。
   它与"暗夜晴空口径" (mid+high)/2 < 30 不是一回事（那说的是天上有没有云，这说的是光到不到地面），
   同值不同义一律不合并（铁律 31②）。 */
const LIGHT_LIMITS = { LOW_CLOUD_MAX: 40 }
function lightReachesGround(c) { return c.low < LIGHT_LIMITS.LOW_CLOUD_MAX }

/* ---------- 逐小时速览 ---------- */

function hourCloud(h) {
  const cloud = h.cloud || {}
  return {
    low: num(cloud.low) || 0,
    mid: num(cloud.mid) || 0,
    high: num(cloud.high) || 0,
    rh: num(h.rh),
    precip: num(h.precip) || 0,
    showers: num(h.showers) || 0,
    pop: num(h.pop) || 0,
    wind: num(h.wind),
    band: h.band || null,
  }
}

// 缺测不能当 0：只有低/中/高云与降水都拿到读数，才允许参与“晴空率/无降水”判断。
function hasCloudAmount(h) {
  const c = h && h.cloud
  return !!(c && num(c.low) != null && num(c.mid) != null && num(c.high) != null)
}

function hasCloudData(h) {
  return !!(hasCloudAmount(h) && num(h.precip) != null)
}

function coverageOf(hours, pred) {
  const list = hours || []
  const valid = list.filter(pred).length
  return {
    valid,
    total: list.length,
    enough: list.length > 0 && valid >= Math.ceil(list.length * 0.8),
  }
}

function dataCoverage(hours) {
  return coverageOf(hours, hasCloudData)
}

function cloudLevelIndex(h, date, cloudLevels) {
  if (!cloudLevels || !Array.isArray(cloudLevels.times)) return -1
  return cloudLevels.times.indexOf((h.d || date) + 'T' + String(h.t || '').slice(0, 5))
}

/**
 * 观察点“头顶上方”的云量峰值（0–100）。数据来自云函数返回的 22 层云量剖面
 * cloudLevels（times + levels[{pressure, altitudes[], cloudCover[]}]）。
 * - 只统计海拔高于此点的层；低云若在脚下，不挡天顶；
 * - 返回 null 表示没有剖面/对不上时刻，调用方退回低/中/高三层均值（旧口径）。
 * 这是星空/银河从“只关心中高层”走向“按高度判断”的接缝；阈值仍由调用方决定。
 */
function cloudAboveAt(h, date, cloudLevels, elevation) {
  if (!cloudLevels || !Array.isArray(cloudLevels.levels)) return null
  const idx = cloudLevelIndex(h, date, cloudLevels)
  if (idx < 0) return null
  const ground = Number.isFinite(elevation) ? elevation : 0
  let max = 0
  let low = 0
  let high = 0
  let levels = 0
  cloudLevels.levels.forEach(lv => {
    const alt = lv.altitudes && lv.altitudes[idx]
    const cover = lv.cloudCover && lv.cloudCover[idx]
    if (!Number.isFinite(alt) || !Number.isFinite(cover)) return
    if (alt <= ground + 50) return
    levels += 1
    if (cover > max) max = cover
    if (alt <= ground + 2000) { if (cover > low) low = cover }
    else if (cover > high) high = cover
  })
  return levels ? { max, low, high, levels, source: 'profile' } : null
}

/**
 * 低层逆温：比较此点地面温度与“此点上方最近一个气压层”的温度。
 * 需要 hour.profile（925/850/700 的温度/湿度）与 cloudLevels 里该气压层的高度。
 * dT > 0.5℃ 视为逆温；没有温湿廓线/高度时返回 null（判不出，不扣分也不加分）。
 * 选择“最低的、在此点之上的层”，避免高海拔点拿地下层做比较。
 */
function inversionAt(h, date, cloudLevels, elevation) {
  if (!h || !h.profile) return null
  const surfaceT = num(h.temp)
  if (surfaceT == null) return null
  const idx = cloudLevelIndex(h, date, cloudLevels)
  if (idx < 0) return null
  const ground = Number.isFinite(elevation) ? elevation : 0
  let best = null
  ;[925, 850, 700].forEach(p => {
    const lv = h.profile[p]
    const t = lv && num(lv.t)
    const layer = cloudLevels.levels.filter(x => x.pressure === p)[0]
    const alt = layer && layer.altitudes && layer.altitudes[idx]
    if (t == null || !Number.isFinite(alt) || alt <= ground + 100) return
    if (!best || alt < best.alt) best = { pressure: p, t, alt }
  })
  if (!best) return null
  const dT = Math.round((best.t - surfaceT) * 10) / 10
  return {
    inversion: dT > 0.5,
    dT,
    dZ: Math.round(best.alt - ground),
    pressure: best.pressure,
    alt: Math.round(best.alt),
  }
}

// 天文暗夜小时：该自然日 00:00 到天文晨光始，以及天文暮光终到 24:00
function nightHours(detail, sun) {
  const dawn = hourMin(sun.astroDawn)
  const dusk = hourMin(sun.astroDusk)
  return detail.filter(h => {
    const m = hourMin(h.t)
    if (!Number.isFinite(m) || !Number.isFinite(dawn) || !Number.isFinite(dusk)) return false
    return m < dawn || m > dusk
  })
}

/* ---------- 月球/银心：把“月照百分比”还原成“此刻月亮在不在天上” ---------- */

const RAD = Math.PI / 180

// 两个地平坐标之间的角距（度）
function angularSeparation(a, b) {
  if (!a || !b) return null
  const cosSep = Math.sin(a.altitude * RAD) * Math.sin(b.altitude * RAD)
    + Math.cos(a.altitude * RAD) * Math.cos(b.altitude * RAD) * Math.cos((a.azimuth - b.azimuth) * RAD)
  return Math.acos(Math.max(-1, Math.min(1, cosSep))) / RAD
}

/**
 * 从方向性天气（getSkyContext 的 spatial）里取某时刻、某方位的值。
 * spatial.times 是 'YYYY-MM-DDTHH:mm'；按圆周插值到相邻两个方位。
 * 返回 null = 该时刻/该方向没有读数（调用方退回整列口径，不把缺测当 0）。
 */
function directionValue(spatial, timeKey, azimuth, key) {
  if (!spatial || !Array.isArray(spatial.byAzimuth) || !Array.isArray(spatial.times)) return null
  const idx = spatial.times.indexOf(timeKey)
  if (idx < 0) return null
  const dirs = spatial.byAzimuth.slice().sort((a, b) => a.azimuth - b.azimuth)
  if (!dirs.length) return null
  const az = ((azimuth % 360) + 360) % 360
  let lo = dirs[dirs.length - 1]
  let hi = dirs[0]
  for (const d of dirs) {
    if (d.azimuth <= az) lo = d
    else { hi = d; break }
  }
  const a0 = lo.azimuth
  const a1 = hi.azimuth <= a0 ? hi.azimuth + 360 : hi.azimuth
  const target = az < a0 ? az + 360 : az
  const f = a1 === a0 ? 0 : (target - a0) / (a1 - a0)
  const v0 = lo[key] && lo[key][idx]
  const v1 = hi[key] && hi[key][idx]
  if (v0 == null && v1 == null) return null
  if (v0 == null) return v1
  if (v1 == null) return v0
  return Math.round((v0 + (v1 - v0) * f) * 10) / 10
}

// 某方位的地形地平线角（度）；16 方位之间圆周插值。terrain 缺失返回 null。
function terrainAt(terrain, azimuth) {
  if (!terrain || !Array.isArray(terrain.horizon) || !terrain.horizon.length) return null
  const hs = terrain.horizon.slice().sort((a, b) => a.azimuth - b.azimuth)
  const az = ((azimuth % 360) + 360) % 360
  let lo = hs[hs.length - 1]
  let hi = hs[0]
  for (const h of hs) {
    if (h.azimuth <= az) lo = h
    else { hi = h; break }
  }
  const a0 = lo.azimuth
  const a1 = hi.azimuth <= a0 ? hi.azimuth + 360 : hi.azimuth
  const target = az < a0 ? az + 360 : az
  const f = a1 === a0 ? 0 : (target - a0) / (a1 - a0)
  const mix = k => (Number.isFinite(lo[k]) && Number.isFinite(hi[k])
    ? Math.round((lo[k] + (hi[k] - lo[k]) * f) * 100) / 100
    : null)
  const angle = mix('angle')
  if (angle == null) return null
  return { azimuth: az, angle, distance: mix('distance'), elevation: mix('elevation') }
}

/* ---------- 大气透明度 / seeing / 气溶胶（Slice 3） ---------- */

function nearestSeven(series, timeKey) {
  if (!Array.isArray(series) || !series.length) return null
  const target = Date.parse(timeKey + ':00+08:00')
  if (!Number.isFinite(target)) return null
  let best = null
  series.forEach(x => {
    const t = Date.parse(x.at + ':00+08:00')
    if (!Number.isFinite(t)) return
    const dt = Math.abs(t - target)
    if (dt <= 1.5 * 3600000 && (!best || dt < best.dt)) best = { x, dt }
  })
  return best ? best.x : null
}

/**
 * 取某小时的空气输入：7Timer 3 小时一档（取 ±1.5h 最近）、CAMS 逐时。
 * 返回 null = 两个源都没有这一小时；一个源缺失只丢对应字段。
 */
function atmosphereAt(atmosphere, timeKey) {
  if (!atmosphere) return null
  const seven = nearestSeven(atmosphere.sevenTimer && atmosphere.sevenTimer.series, timeKey)
  const air = ((atmosphere.air && atmosphere.air.series) || []).filter(x => x.at === timeKey)[0] || null
  if (!seven && !air) return null
  return {
    seeing: seven ? seven.seeing : null,
    transparency: seven ? seven.transparency : null,
    cloudPct: seven ? seven.cloudPct : null,
    aod: air ? air.aod : null,
    pm25: air ? air.pm25 : null,
  }
}

/**
 * 空气对观星的影响（工程启发式，不是校准概率）：
 * AOD ≥0.4 扣 8、≤0.15 加 4；
 * **7Timer 透明度是“数值越小越好”**（1=<0.3，8=>1 mag/air mass；官方图例：越少/越蓝越好）：
 * ≤3 加 4、≥6 扣 6；
 * seeing 同样是“数值越小越好”：≤3（<1″）加 3、≥6（>2.5″）扣 4。
 * 缺字段不扣分也不加分；只作为“云/月”之后的第三层修正。
 */
function atmosphereImpact(a) {
  if (!a) return { score: 0, text: '' }
  let score = 0
  const parts = []
  if (a.aod != null) {
    if (a.aod >= 0.4) { score -= 8; parts.push('CAMS 气溶胶偏高') }
    else if (a.aod <= 0.15) { score += 4; parts.push('CAMS 气溶胶低') }
  }
  if (a.transparency != null) {
    if (a.transparency >= 6) { score -= 6; parts.push('7Timer 透明度偏低') }
    else if (a.transparency <= 3) { score += 4; parts.push('7Timer 透明度好') }
  }
  if (a.seeing != null) {
    if (a.seeing >= 6) { score -= 4; parts.push('seeing 较差') }
    else if (a.seeing <= 3) { score += 3; parts.push('seeing 好') }
  }
  return { score, text: parts.join('、') }
}

/**
 * 光污染对观星的影响：Bortle ≤3（或 SQM ≥21.5）加 3；
 * Bortle ≥6（或 SQM <19）扣 10；其余中性。两者矛盾时按更差的一侧处理（保守）。
 * 无数据返回 missing；调用方（星/银河）在“缺失”（null 与未传字段同解）时把分数封顶，
 * 不把没取到当成天空暗。
 */
function lightPollutionImpact(lp) {
  if (!lp) return { score: 0, text: '', poor: false, missing: true }
  const b = lp.bortle
  const sqm = lp.sqm
  const polluted = (b != null && b >= 6) || (sqm != null && sqm < 19)
  const dark = !polluted && ((b != null && b <= 3) || (sqm != null && sqm >= 21.5))
  if (dark) return { score: 3, text: '天空较暗', poor: false, missing: false }
  if (polluted) return { score: -10, text: '光污染较高', poor: true, missing: false }
  return { score: 0, text: '光污染中等', poor: false, missing: false }
}

function moonAtHour(date, h, lat, lng) {
  return A.moonPosition(A.cnToMs(h.d || date, h.t), lat, lng)
}

function galaxyAtHour(date, h, lat, lng) {
  return A.galaxyPosition(A.cnToMs(h.d || date, h.t), lat, lng)
}

// 月照对观星的实际影响：只看“在地平线上的小时数 × 最高高度”。
// 月亮整夜在地平线下 ⇒ 0；满月整夜高挂 ⇒ 接近 100。
function moonSummary(hours, date, lat, lng) {
  let upHours = 0
  let maxAltitude = -90
  hours.forEach(h => {
    const p = moonAtHour(date, h, lat, lng)
    if (p.altitude > -0.833) {
      upHours += 1
      if (p.altitude > maxAltitude) maxAltitude = p.altitude
    }
  })
  return { upHours, hours: hours.length, maxAltitude }
}

function moonAltitudeFactor(maxAltitude) {
  if (!(maxAltitude > 0)) return 0
  return Math.min(1, maxAltitude / 30)
}

function moonLine(stat, scope) {
  const s = scope || '夜段'
  return stat.upHours > 0
    ? '月亮在' + s + ' ' + stat.upHours + '/' + stat.hours + ' 小时在地平线上（最高 ' + Math.round(stat.maxAltitude) + '°）'
    : '月亮在整个' + s + '都在地平线下'
}

/* ---------- 夜窗口：今晚入夜 → 次日天文晨光始 ----------
 * 旧实现只取所选自然日的 24h，于是“今晚”的卡片里混进了所选日 00:00–04:00
 * （属于前一夜），却漏掉所选日入夜后的次日 00:00–04:00（真正的后半夜）。
 * series 是云函数返回的 7 天逐时序列；有它时按“今晚”取，没有时退回旧口径，
 * 保证纯函数测试可以只喂 detail。 */
function nightHoursForDate(ctx, sun) {
  const { date, lat, lng, elevation, detail, series } = ctx
  const s = sun || A.sunTimes(date, lat, lng, elevation)
  const nextDate = addDays(date, 1)
  const nextSun = A.sunTimes(nextDate, lat, lng, elevation)
  const dusk = hourMin(s.astroDusk)
  const dawn = hourMin(nextSun.astroDawn)
  if (!Number.isFinite(dusk) || !Number.isFinite(dawn)) return []
  if (Array.isArray(series) && series.length) {
    const evening = series.filter(h => h.d === date && hourMin(h.t) > dusk)
    const morning = series.filter(h => h.d === nextDate && hourMin(h.t) < dawn)
    if (evening.length || morning.length) return evening.concat(morning)
  }
  return nightHours(detail, s)
}

// 夜段文案：次日的小时前加“次日”，避免 00:00–04:00 被误读成今晚凌晨
function nightWindowText(hours, date) {
  const parts = []
  let cur = null
  ;(hours || []).forEach(h => {
    const m = hourMin(h.t)
    const nextDay = !!(h.d && h.d !== date)
    if (cur && nextDay === cur.nextDay && m === hourMin(cur.to) + 60) {
      cur.to = h.t
    } else {
      if (cur) parts.push(cur)
      cur = { from: h.t, to: h.t, nextDay }
    }
  })
  if (cur) parts.push(cur)
  return parts.map(p => (p.nextDay ? '次日 ' : '') + p.from + '-' + p.to).join(' / ')
}

function nightScope(ctx) {
  return Array.isArray(ctx.series) && ctx.series.some(h => h.d === addDays(ctx.date, 1))
    ? '今晚入夜到次日晨'
    : '夜段延续到次日（晨段属前夜尾段）'
}

// 把小时列表切成连续区段。跨零点时自然分成两段（暗夜 = 当日 00:00 到天文晨光 + 天文暮光到 24:00）
function hourSegments(list) {
  if (!list.length) return []
  const segs = []
  let start = list[0]
  let prev = list[0]
  for (let i = 1; i < list.length; i++) {
    const h = list[i]
    if (hourMin(h.t) !== hourMin(prev.t) + 60) {
      segs.push(start.t + '-' + prev.t)
      start = h
    }
    prev = h
  }
  segs.push(start.t + '-' + prev.t)
  return segs
}

function windowText(list) {
  return hourSegments(list).join(' / ')
}

// 晨昏光染的经验时间窗：日出后 50 分钟内、日落前 50 分钟内（徒步者的经验窗口）
const LIGHT_WINDOW_MIN = 50

/* ---------- 逐小时天相判定（meteogram 标记行与结论卡同源） ---------- */

/**
 * 逐小时天相标记：{ 'HH:mm': ['alpenglow', 'star', ...] }。
 * 与结论卡共用同一套阈值，避免图上的标记与文字结论互相打架。
 * @param ctx { date, lat, lng, elevation, elevOK, detail }
 */
function hourMarks(ctx) {
  const { date, lat, lng, elevation, elevOK, detail, cloudLevels, terrain } = ctx
  const sun = A.sunTimes(date, lat, lng, elevation)
  const win = A.photoWindows(date, lat, lng, elevation)
  const dawnMin = hourMin(sun.astroDawn)
  const duskMin = hourMin(sun.astroDusk)
  const moonIll = A.moonInfo(date).illumination
  const riseMin = hourMin(sun.sunrise)
  const setMin = hourMin(sun.sunset)
  const marks = {}
  const add = (h, key) => {
    if (!marks[h.t]) marks[h.t] = []
    if (marks[h.t].indexOf(key) === -1) marks[h.t].push(key)
  }
  detail.forEach(h => {
    const c = hourCloud(h)
    const m = hourMin(h.t)
    const band = c.band

    if (band && elevOK && band.base <= elevation && elevation <= band.top) add(h, 'inCloud')
    if (CLF.isCloudBand(band) && hasCloudAmount(h) && elevOK && elevation > band.top && c.high < 30 && m < 10 * 60) add(h, 'cloudSea')

    // 晨昏光染：落在晨昏窗口内，且低云少（光能到山体）、中高云有（被染色）、无降水
    const inLightWindow = hourTouches(m, riseMin, riseMin + LIGHT_WINDOW_MIN)
      || hourTouches(m, setMin - LIGHT_WINDOW_MIN, setMin)
    if (inLightWindow && hasCloudData(h) && c.precip < 0.3 && c.pop < 40 && lightReachesGround(c) && c.mid + c.high >= 25) {
      add(h, 'alpenglow')
    }
    if (win.morningGolden && hourTouches(m, hourMin(win.morningGolden.from), hourMin(win.morningGolden.to))) add(h, 'golden')
    if (win.eveningGolden && hourTouches(m, hourMin(win.eveningGolden.from), hourMin(win.eveningGolden.to))) add(h, 'golden')
    if (win.dawnBlue && hourTouches(m, hourMin(win.dawnBlue.from), hourMin(win.dawnBlue.to))) add(h, 'blueHour')
    if (win.duskBlue && hourTouches(m, hourMin(win.duskBlue.from), hourMin(win.duskBlue.to))) add(h, 'blueHour')

    // 彩虹：太阳高度 < 40 度（主虹在反日点 42 度半径）、**太阳照得出来**、且空气有水分。
    // 「有水分」这一支以前还包含 `c.low >= 70`——那是把"满天低云"当成水分信号，
    // 而低云恰恰是把太阳遮死的东西：实测全天 low/mid/high=100%、一滴雨没下，
    // 彩虹照样拿 40+30=70 分 = 「条件较好 ★★★★」。同一天光染判 0 分并明说云量不足，
    // 两个现象对同一份云量数据的态度互相矛盾（截图里那张 4 星彩虹卡就是这么来的）。
    // 现在水分只看真降水与高湿；遮光闸复用本文件已有的两个口径，**不新造数字**：
    //   c.low < 40            ← 光染那句「低云少（光能到山体）」
    //   (mid + high) / 2 < 30 ← 星空/银河那句「暗夜晴空」口径
    const solar = A.solarPosition(A.cnToMs(date, h.t), lat, lng)
    const wet = c.precip > 0.05 || c.showers > 0.05 || (c.rh != null && c.rh >= 88)
    const sunVisible = lightReachesGround(c) && (c.mid + c.high) / 2 < 30
    if (hasCloudData(h) && solar.altitude < 40 && solar.altitude > -2 && wet && sunVisible) add(h, 'rainbow')

    // 星空 / 银河：天文暗夜 + 观察点上方云少 + 无降水；银河另需银心真的在地平线上、月照不压
    const dark = Number.isFinite(dawnMin) && Number.isFinite(duskMin) && (m < dawnMin || m > duskMin)
    const prof = cloudAboveAt(h, date, cloudLevels, elevation)
    const skyCloud = prof ? prof.max : (c.high + c.mid) / 2
    if (hasCloudData(h) && dark && skyCloud < 30 && c.precip === 0) {
      add(h, 'star')
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const ms = A.cnToMs(h.d || date, h.t)
        const gp = A.galaxyPosition(ms, lat, lng)
        const ridge = terrainAt(terrain, gp.azimuth)
        if (gp.altitude > 0 && (!ridge || gp.altitude > ridge.angle + 1)) {
          const mp = A.moonPosition(ms, lat, lng)
          const sep = angularSeparation(gp, mp)
          const moonUp = mp.altitude > -0.833
          if (moonIll < 35 && (!moonUp || sep > 60)) add(h, 'galaxy')
        }
      }
    }
  })
  return marks
}

/* ---------- 结论卡 ---------- */

// 日照金山（晨昏光染）
function alpenglowConclusion(ctx) {
  const { date, lat, lng, elevation, elevOK, detail, heading } = ctx
  const marks = hourMarks(ctx)
  const all = detail.filter(h => (marks[h.t] || []).indexOf('alpenglow') !== -1)
  const dawnList = all.filter(h => hourMin(h.t) < 12 * 60)
  const duskList = all.filter(h => hourMin(h.t) >= 12 * 60)
  const isDawn = dawnList.length > 0
  const list = isDawn ? dawnList : duskList
  const side = isDawn ? '晨光' : '昏光'
  const item = { key: 'alpenglow', title: '晨昏光染', window: '', look: '', text: '' }
  const sun = A.sunTimes(date, lat, lng, elevation)
  const riseMin = hourMin(sun.sunrise)
  const setMin = hourMin(sun.sunset)
  const windowHours = detail.filter(h => {
    const m = hourMin(h.t)
    return hourTouches(m, riseMin, riseMin + LIGHT_WINDOW_MIN)
      || hourTouches(m, setMin - LIGHT_WINDOW_MIN, setMin)
  })
  const cover = dataCoverage(windowHours)
  if (!cover.enough) {
    item.text = '晨昏窗口的云量/降水读数不足（' + cover.valid + '/' + cover.total + ' 小时），无法判断光染条件。'
    return Object.assign(item, grade(0), { verdict: VERDICT.UNKNOWN })
  }
  if (!list.length) {
    item.text = '今天' + side + '前后云量或降水条件不足，山体被光染的概率很低。'
    item.look = heading == null ? '' : '前进方向朝' + A.bearingLabel(heading)
    /* 判过了：晨昏窗口内没有一小时满足"低云少 + 无降水" ⇒ 必要条件不成立，页面沉默 */
    return Object.assign(item, grade(0), { verdict: VERDICT.EXCLUDED })
  }
  const first = list[0]
  const solar = A.solarPosition(A.cnToMs(date, first.t), lat, lng)
  const ridge = terrainAt(ctx.terrain, solar.azimuth)
  const sunAboveRidge = ridge ? solar.altitude > ridge.angle + 0.5 : null
  const c = hourCloud(first)
  let score = 30
  const reasons = []
  if (c.low < 25) { score += 18; reasons.push('低云少') }
  if (c.mid + c.high >= 40) { score += 14; reasons.push('中高云可被染色') }
  if (c.precip === 0 && c.pop < 30) { score += 16; reasons.push('无降水') }
  if (c.band) {
    if (elevOK && elevation > c.band.top) { score += 14; reasons.push('此点在云层带上方') }
    else if (elevOK && elevation <= c.band.top) { score -= 8; reasons.push('此点在云带内，' + side + '易被云挡住') }
  } else {
    score += 6
  }
  /* 有地形剖面时，用“太阳方位的地平线”替代轨迹走向：
     轨迹走向不是目标山体方位，拿它当“视野开阔”是假证据。 */
  if (ridge) {
    if (sunAboveRidge) {
      score += 8
      reasons.push('太阳高于此方位山脊（约 ' + Math.round(ridge.angle) + '°）')
    } else {
      score -= 10
      reasons.push('太阳低于此方位山脊（约 ' + Math.round(ridge.angle) + '°），山体可能被挡')
    }
  } else {
    const need = isDawn ? [22.5, 157.5] : [202.5, 337.5]
    if (heading == null) {
      reasons.push('需' + (isDawn ? '东至东北' : '西至西北') + '侧视野开阔')
    } else if (inArc(heading, need[0], need[1])) {
      score += 8
      reasons.push('前进方向朝' + A.bearingLabel(isDawn ? 90 : 270))
    } else {
      score -= 4
      reasons.push('前进方向偏' + A.bearingLabel(heading))
    }
  }
  const g = grade(score)
  const blockedByRidge = !!(ridge && !sunAboveRidge)
  const caveat = ridge
    ? '地形为 90 m DEM 粗判，未计树木/建筑；坡向与山体材质仍需现场判断。'
    : '这里只用了云量与降水：本工具没有目标山峰的位置、坡向、遮挡（DEM）数据，给不出「某座山会不会金山」。'
  item.text = (blockedByRidge
    ? side + '在 ' + windowText(list) + ' 太阳低于此方位山脊，山体被光染的概率较低（'
    : side + '在 ' + windowText(list) + ' 有山体被光染的可能（')
    + reasons.join('、') + '）。' + caveat
  item.look = ridge
    ? '朝' + A.bearingLabel(solar.azimuth) + '看山脊线'
      + (ridge.distance > 0
        ? '（此方位地形最高点约 ' + Math.round(ridge.elevation) + ' m / 距离约 ' + Math.round(ridge.distance) + ' km，DEM 90 m 粗判）'
        : '（此方位无更高地形，地平线约 ' + Math.round(ridge.angle) + '°）')
    : (isDawn ? '朝东至东北' : '朝西至西北') + '看山脊线'
      + (heading == null ? '' : '（按轨迹走向朝' + A.bearingLabel(heading) + '，为粗判）')
  item.window = windowText(list)
  return Object.assign(item, g, { verdict: VERDICT.POSSIBLE })
}

// 云海：五信号合成（低层湿层 / 清晨时段 / 高层干净 / 观察点在带顶之上 / 微风），另参考前日降水
function cloudSeaConclusion(ctx) {
  const { date, lat, lng, elevation, elevOK, detail, days, cloudLevels } = ctx
  const marks = hourMarks(ctx)
  const list = detail.filter(h => (marks[h.t] || []).indexOf('cloudSea') !== -1)
  const item = { key: 'cloudSea', title: '云海', window: '', look: '站在此点向低处与远处看云顶', text: '' }
  if (!elevOK) {
    item.text = '此点缺少可信海拔（GPX 未记录高程），无法判断是否高过云层带。'
    /* 判不出 ≠ 不成立：没有海拔不能断言"这里看不到云海"，卡片必须留着说缺什么 */
    return Object.assign(item, grade(0), { verdict: VERDICT.UNKNOWN })
  }
  const hasBandField = detail.some(h => h && Object.prototype.hasOwnProperty.call(h, 'band'))
  if (!hasBandField) {
    item.text = '云层剖面数据不足，无法判断今天有没有成层云带。'
    /* 没有 band 字段 ≠ 没有云带：缺测不能印成“云海无从形成” */
    return Object.assign(item, grade(0), { verdict: VERDICT.UNKNOWN })
  }
  const solid = detail.filter(h => CLF.isCloudBand(h.band))
  if (!solid.length) {
    item.text = '今天没有成层的低云带（无 ' + CLF.LAYER_LIMITS.CLOUD_BAND_COVER_MIN + '% 以上云量的层），云海无从形成。'
    return Object.assign(item, grade(0), { verdict: VERDICT.EXCLUDED })
  }
  const morningAll = detail.filter(h => hourMin(h.t) < 10 * 60)
  const morningSolid = solid.filter(h => hourMin(h.t) < 10 * 60)
  if (!morningSolid.length) {
    item.text = '今天有成层云带但不在清晨时段（10 点前），云海机会低。'
    return Object.assign(item, grade(0), { verdict: VERDICT.EXCLUDED })
  }
  let score = 20
  const reasons = []
  const baseMin = Math.min.apply(null, morningSolid.map(h => h.band.base))
  if (baseMin <= 2200) {
    score += 18
    reasons.push('低层有云带（底约 ' + Math.round(baseMin) + ' m）')
  } else {
    score += 4
    reasons.push('云带偏高（底约 ' + Math.round(baseMin) + ' m）')
  }
  /* “此点在云带上方”是几何事实；“有没有成云海窗口”还取决于高层云/风。
     旧实现把两者压成一个 above，于是高层云多时也会说“此点不在云带上方”。 */
  const aboveBand = morningSolid.some(h => elevation > h.band.top)
  const visible = list.length > 0
  if (aboveBand) { score += 24; reasons.push('此点在云带上方') } else { reasons.push('此点不在云带上方') }
  const morningCover = coverageOf(morningAll, hasCloudAmount)
  if (!morningCover.enough) {
    item.text = '清晨云量读数不足（' + morningCover.valid + '/' + morningCover.total + ' 小时），无法判断云海条件。'
    return Object.assign(item, grade(0), { verdict: VERDICT.UNKNOWN })
  }
  const morning = morningAll.filter(hasCloudAmount)
  const highClean = morning.every(h => (num(h.cloud && h.cloud.high) || 0) < 30)
  if (highClean) { score += 14; reasons.push('清晨高层云少') }
  else reasons.push('清晨高层云较多')
  const w = mean(morning.map(h => hourCloud(h).wind).filter(x => x != null))
  if (w != null && w < 15) { score += 12; reasons.push('清晨微风（' + Math.round(w) + ' km/h）') }
  else if (w != null) reasons.push('清晨风偏大（' + Math.round(w) + ' km/h）')
  /* 逆温是云海“把云压在谷地”的关键；没有温湿廓线时不加分也不扣分（判不出 ≠ 不成立） */
  const inv = morning.map(h => inversionAt(h, date, cloudLevels, elevation)).filter(Boolean)
  if (inv.length) {
    const inverted = inv.filter(x => x.inversion).length
    if (inverted >= Math.ceil(inv.length / 2)) {
      score += 10
      reasons.push('清晨有逆温（' + inverted + '/' + inv.length + ' 小时）')
    } else {
      score -= 4
      reasons.push('清晨无明显逆温')
    }
  }
  const prev = (days || []).find(d => d.date === addDays(date, -1))
  if (prev && prev.precipSum > 0) {
    score += 12
    reasons.push('前日有降水（' + prev.precipSum + ' mm）')
  }
  /* DEM 地形开放度：四周山脊高于水平线的方位越多，越不容易看到云顶；
     只是“视野”启发式，不替代云带/逆温本身的判定。 */
  if (ctx.terrain && Number.isFinite(ctx.terrain.openness)) {
    if (ctx.terrain.openness < 0.3) {
      score -= 6
      reasons.push('四周地形较封闭（DEM 90 m）')
    } else if (ctx.terrain.openness > 0.7) {
      score += 4
      reasons.push('四周视野较开阔（DEM 90 m）')
    }
  }
  const g = grade(score)
  item.text = aboveBand
    ? (visible
      ? '清晨 ' + windowText(list) + ' 有在云顶之上看云海的机会（' + reasons.join('、') + '）。'
      : '此点在云带上方，但清晨高层云较多或风偏大，云顶被遮住的概率较高（' + reasons.join('、') + '）。')
    : '今天有云带但此点在云带内或云带偏高，云海机会低（' + reasons.join('、') + '）。'
  item.window = visible ? windowText(list) : ''
  /* aboveBand===false 是“判过了”：有可信海拔、有成层云带，但此点不在带顶之上 ⇒ 站在这里看不到云顶。
     高层云多/风大只影响窗口质量，不等于“此点不在云带上方”。 */
  return Object.assign(item, g, { verdict: aboveBand ? VERDICT.POSSIBLE : VERDICT.EXCLUDED })
}

// 星空：天文暗夜窗口 + 晴空率 + 月光实际影响（月照 × 在地平线上的小时 × 高度）
function starConclusion(ctx) {
  const { date, lat, lng, elevation, detail } = ctx
  const sun = A.sunTimes(date, lat, lng, elevation)
  const night = ctx.night || nightHoursForDate(ctx, sun)
  const moon = A.moonInfo(date)
  const item = { key: 'star', title: '星空', window: '', look: '关掉手电、避开城镇光害，找开阔北向视野', text: '' }
  if (!night.length) {
    item.text = '天文暗夜时段数据不足（今日极昼/极夜或无数据）。'
    /* 没有暗夜时段的读数 ⇒ 没判过，不能断言"看不到星空" */
    return Object.assign(item, grade(0), { verdict: VERDICT.UNKNOWN })
  }
  const cover = dataCoverage(night)
  if (!cover.enough) {
    item.text = '夜段云量/降水读数不足（' + cover.valid + '/' + cover.total + ' 小时），无法判断星空条件。'
    return Object.assign(item, grade(0), { verdict: VERDICT.UNKNOWN })
  }
  const validNight = night.filter(hasCloudData)
  const cs = validNight.map(h => {
    const c = hourCloud(h)
    const prof = cloudAboveAt(h, date, ctx.cloudLevels, elevation)
    return { c, cloud: prof ? prof.max : (c.high + c.mid) / 2 }
  })
  const clearRate = Math.round(cs.filter(x => x.cloud < 30 && !x.c.precip).length / cs.length * 100)
  const partial = validNight.length < night.length
    ? '（云量读数 ' + validNight.length + '/' + night.length + ' 小时）'
    : ''
  /* 月照不是“照亮百分比”一个数：满月在地平线下时不该扣分，月牙高挂时也不该当无月。
     这里用夜段内“月亮在地平线上的小时数 × 最高高度”折算成有效月光。 */
  const moonStat = moonSummary(night, date, lat, lng)
  const moonEffective = moon.illumination
    * (moonStat.upHours / night.length)
    * moonAltitudeFactor(moonStat.maxAltitude)
  let score = 0
  if (clearRate >= 70) score += 45
  else if (clearRate >= 40) score += 26
  else score += 8
  if (moonEffective < 25) score += 28
  else if (moonEffective < 50) score += 16
  else if (moonEffective < 70) score += 6
  const atmTime = night[0] ? (night[0].d || date) + 'T' + night[0].t : date + 'T00:00'
  const atm = atmosphereAt(ctx.atmosphere, atmTime)
  const atmImpact = atmosphereImpact(atm)
  score += atmImpact.score
  const atmPoor = atmImpact.score < 0
  const atmText = atmImpact.text ? '；' + atmImpact.text : ''
  /* 光污染的两种「没有读数」同解：调用方没传这个字段（undefined：首屏、整源失败、
     配额用尽）与显式 null（问过但没有值）都是「没取到」，不能读成「天空很暗」。
     纯函数分不清「没有这个概念」与「问了没取到」，按失败关闭统一处理（铁律 26②）。 */
  const lp = ctx.lightPollution || null
  const lpMissing = ctx.lightPollution == null
  const lpImpact = lightPollutionImpact(lp)
  score += lpImpact.score
  const lpPoor = lpImpact.poor
  /* 结论句已经点过「光污染较高」时，证据句只补来源，不把同一句判词印两遍。
     用显式布尔判定而不是回头匹配文案（铁律 31④：按字面挑句子 = 文案即接口）。 */
  const lpNamed = lpPoor && clearRate >= 70
  const lpSource = lp ? '（DarkSkySites.com，模型估算）' : ''
  const lpText = lpMissing
    ? '；未计入光污染（最高按条件一般）'
    : lpNamed ? '；光污染数据来自 DarkSkySites.com（模型估算）'
      : (lpImpact.text ? '；' + lpImpact.text + lpSource : '')
  score = cap69(score, lpMissing || lpPoor)
  const why = lpPoor ? '光污染较高'
    : lpMissing ? '光污染未计入'
      : moonEffective >= 25 ? '月光偏亮'
        : atmPoor ? '大气透明度/seeing 偏弱' : '月光偏亮'
  const g = grade(score)
  item.window = nightWindowText(night, date)
  item.text = '天文暗夜 ' + nightWindowText(night, date) + '（' + night.length + ' 小时，' + nightScope(ctx) + '）'
    + partial + '，'
    + (clearRate >= 70 && moonEffective < 25 && !atmPoor && !lpPoor && !lpMissing
      ? '夜间晴朗且月光影响小，星空条件好'
      : clearRate >= 70
        ? '夜间晴朗，但' + why + '，星空条件一般'
        : clearRate >= 40
          ? '夜间有云（晴 ' + clearRate + '%），观星看运气'
          : '夜间云量高，观星条件差')
    + '（暗夜晴空 ' + clearRate + '%，' + moon.name + '月照 ' + moon.illumination + '%，'
    + moonLine(moonStat) + atmText + lpText + '）。'
  /* 暗夜晴空 0% ⇒ 整个天文暗夜里没有一小时"中高层云少且无降水"，星空是被判掉的、不是没判的 */
  return Object.assign(item, g, { verdict: clearRate === 0 ? VERDICT.EXCLUDED : VERDICT.POSSIBLE })
}

// 银河：银心在地平线上 + 暗夜晴空 + 月光（高度/角距）+ 实际方位
function galaxyConclusion(ctx) {
  const { date, lat, lng, elevation, detail } = ctx
  const sun = A.sunTimes(date, lat, lng, elevation)
  const night = ctx.night || nightHoursForDate(ctx, sun)
  const moon = A.moonInfo(date)
  const item = { key: 'galaxy', title: '银河', window: '', look: '', text: '' }
  if (!night.length) {
    item.text = '天文暗夜时段数据不足。'
    return Object.assign(item, grade(0), { verdict: VERDICT.UNKNOWN })
  }
  const rows = night.map(h => {
    const c = hourCloud(h)
    const prof = cloudAboveAt(h, date, ctx.cloudLevels, elevation)
    const gp = galaxyAtHour(date, h, lat, lng)
    const mp = moonAtHour(date, h, lat, lng)
    const timeKey = (h.d || date) + 'T' + h.t
    const dVals = ['low', 'mid', 'high']
      .map(k => directionValue(ctx.spatial, timeKey, gp.azimuth, k))
      .filter(v => v != null)
    return {
      h,
      c,
      valid: hasCloudData(h),
      cloud: prof ? prof.max : (c.high + c.mid) / 2,
      dirCloud: dVals.length ? Math.max.apply(null, dVals) : null,
      gp,
      mp,
      terrain: terrainAt(ctx.terrain, gp.azimuth),
    }
  })
  const aboveHorizon = rows.filter(r => r.gp.altitude > 0)
  if (!aboveHorizon.length) {
    item.text = '银心在这段夜里一直在地平线以下，看不到银河核心。'
    /* 银心高度是几何事实：这是判过了的不成立，不是数据不足 */
    return Object.assign(item, grade(0), { verdict: VERDICT.EXCLUDED })
  }
  /* 高于几何地平线还不够：90 m DEM 的山脊可能挡在它前面。
     +1° 是粗余量（树线/建筑未计）；没有 terrain 时保持旧口径。 */
  const visible = aboveHorizon.filter(r => !r.terrain || r.gp.altitude > r.terrain.angle + 1)
  if (!visible.length) {
    const ridges = aboveHorizon
      .map(r => (r.terrain && Number.isFinite(r.terrain.angle) ? r.terrain.angle : null))
      .filter(v => v != null)
    const maxRidge = ridges.length ? Math.max.apply(null, ridges) : null
    const maxAlt = Math.max.apply(null, aboveHorizon.map(r => r.gp.altitude))
    item.text = maxRidge != null && maxRidge > 0
      ? '银心在夜段高于地平线，但被山脊挡住（此方位地平线角最高约 ' + Math.round(maxRidge) + '°，DEM 90 m 粗判）。'
      : '银心在夜段只贴近地平线（最高约 ' + Math.round(maxAlt) + '°），实际可见性很低。'
    return Object.assign(item, grade(0), { verdict: VERDICT.EXCLUDED })
  }
  const cover = dataCoverage(visible.map(r => r.h))
  if (!cover.enough) {
    item.text = '银心可见时段的云量/降水读数不足（' + cover.valid + '/' + cover.total + ' 小时），无法判断银河条件。'
    return Object.assign(item, grade(0), { verdict: VERDICT.UNKNOWN })
  }
  const visibleValid = visible.filter(r => r.valid)
  const clearRate = Math.round(visibleValid.filter(r => r.cloud < 30 && r.c.precip === 0).length
    / visibleValid.length * 100)
  const partial = visibleValid.length < visible.length
    ? '（云量读数 ' + visibleValid.length + '/' + visible.length + ' 小时）'
    : ''
  const moonStat = moonSummary(visibleValid.map(r => r.h), date, lat, lng)
  let score = 20
  if (clearRate >= 70) score += 40
  else if (clearRate >= 40) score += 22
  // 取“整列云最少、同云量下银心更高”的一小时；有方向云时把银心方向的云也算进排序
  let best = visibleValid[0]
  for (const r of visibleValid) {
    const a = r.cloud + (r.dirCloud == null ? 0 : r.dirCloud * 0.5)
    const b = best.cloud + (best.dirCloud == null ? 0 : best.dirCloud * 0.5)
    if (a < b || (a === b && r.gp.altitude > best.gp.altitude)) best = r
  }
  /* 月光还要看“离银心多远”：月亮在银心附近时，即使月照不高也会压掉银河带 */
  const sep = angularSeparation(best.gp, best.mp)
  const moonUp = best.mp.altitude > -0.833
  const sepFactor = !moonUp ? 0 : sep < 45 ? 1 : sep < 90 ? 0.7 : 0.4
  const moonEffective = moon.illumination
    * (moonStat.upHours / visibleValid.length)
    * moonAltitudeFactor(moonStat.maxAltitude)
    * sepFactor
  if (moonEffective < 20) score += 28
  else if (moonEffective < 35) score += 18
  else if (moonEffective < 50) score += 6
  const atmTime = (best.h.d || date) + 'T' + best.h.t
  const atm = atmosphereAt(ctx.atmosphere, atmTime)
  const atmImpact = atmosphereImpact(atm)
  score += atmImpact.score
  const atmPoor = atmImpact.score < 0
  const atmText = atmImpact.text ? '；' + atmImpact.text : ''
  const dirCloud = best.dirCloud
  const dirHigh = dirCloud != null && dirCloud >= 60
  const dirText = dirCloud == null
    ? ''
    : '；银心方向云约 ' + Math.round(dirCloud) + '%（方向为模式粗判）'
  if (dirCloud != null) {
    if (dirCloud < 30) score += 5
    else if (dirHigh) score -= 20
  }
  /* 与星空同一口径：undefined 与 null 都是「没取到」，都按失败关闭封顶（铁律 26②）。 */
  const lp = ctx.lightPollution || null
  const lpMissing = ctx.lightPollution == null
  const lpImpact = lightPollutionImpact(lp)
  score += lpImpact.score
  const lpPoor = lpImpact.poor
  /* reason 会点到「光污染较高」的那一支才去重；clearRate<70 / 方向云 / 大气 先说话时，
     证据句仍要把光污染说完。显式布尔，不匹配文案（铁律 31④）。 */
  const lpNamed = lpPoor && clearRate >= 70 && !dirHigh && !atmPoor
  const lpSource = lp ? '（DarkSkySites.com，模型估算）' : ''
  const lpText = lpMissing
    ? '；未计入光污染（最高按条件一般）'
    : lpNamed ? '；光污染数据来自 DarkSkySites.com（模型估算）'
      : (lpImpact.text ? '；' + lpImpact.text + lpSource : '')
  /* 三个「条件较好」的封印统一在**全部加减分之后**施加：缺光污染读数、光污染较高、
     月光影响大。旧实现把缺测封顶放在方向云 +5 之前（74 能顶回「条件较好」），
     月光那条又另写一遍 —— 同一件事拆成三处，正是漏判的来源。 */
  score = cap69(score, lpMissing || lpPoor || moonEffective >= 35)
  const g = grade(score)
  const maxAlt = Math.max.apply(null, visible.map(r => r.gp.altitude))
  item.window = best.h.t + ' 前后' + (best.h.d && best.h.d !== date ? '（次日）' : '')
  const ridgeNote = best.terrain && best.terrain.angle > 0
    ? '（此方位山脊约 ' + Math.round(best.terrain.angle) + '°）'
    : ''
  item.look = '朝' + A.bearingLabel(best.gp.azimuth) + '（约 ' + Math.round(best.gp.azimuth) + ' 度）找银心带' + ridgeNote
  const reason = clearRate < 70
    ? '暗夜有云（晴 ' + clearRate + '%）'
    : (dirHigh ? '银心方向云较多（约 ' + Math.round(dirCloud) + '%）'
      : (atmPoor ? '大气透明度/seeing 偏弱'
        : (lpPoor ? '光污染较高'
          : (lpMissing ? '光污染未计入' : '月光偏亮（' + moonLine(moonStat, '银心可见时段') + '）'))))
  item.text = clearRate >= 70 && moonEffective < 35 && !dirHigh && !atmPoor && !lpPoor && !lpMissing
    ? '银心季 + 暗夜晴（' + clearRate + '%）+ 月光影响小，银心在夜段最高约 '
      + Math.round(maxAlt) + '°' + partial + '，银河可见概率较大（' + moonLine(moonStat, '银心可见时段') + '）'
      + dirText + atmText + lpText + '。'
    : '银心在夜段最高约 ' + Math.round(maxAlt) + '°' + partial + '，但' + reason
      + (dirHigh ? '' : dirText) + atmText + lpText + '，银河不建议抱太大期望。'
  /* 银心可见时段里晴空 0% ⇒ 判过了的不成立，不是没判 */
  return Object.assign(item, g, { verdict: clearRate === 0 ? VERDICT.EXCLUDED : VERDICT.POSSIBLE })
}

// 彩虹：反日点 42 度半径，太阳越高虹越低
function rainbowConclusion(ctx) {
  const { date, lat, lng, elevation, detail, spatial } = ctx
  const marks = hourMarks(ctx)
  const list = detail.filter(h => (marks[h.t] || []).indexOf('rainbow') !== -1)
  const item = { key: 'rainbow', title: '彩虹', window: '', look: '', text: '' }
  const cover = dataCoverage(detail)
  if (!cover.enough) {
    item.text = '全天云量/降水读数不足（' + cover.valid + '/' + cover.total + ' 小时），无法判断彩虹条件。'
    return Object.assign(item, grade(0), { verdict: VERDICT.UNKNOWN })
  }
  if (!list.length) {
    item.text = '今天没有"太阳照得出来 + 空气有水分"同时成立的钟点，彩虹概率很低'
      + '（彩虹要求太阳在身后且高度低于约 40 度，还得真能看到太阳——满天云时这个条件不成立）。'
    /* 逐小时都判过了（太阳高度、遮光、水分三项），没有任何一小时同时成立 ⇒ 沉默 */
    return Object.assign(item, grade(0), { verdict: VERDICT.EXCLUDED })
  }
  const first = list[0]
  const solar = A.solarPosition(A.cnToMs(date, first.t), lat, lng)
  const anti = A.norm360(solar.azimuth + 180)
  const top = Math.max(2, Math.round(42 - solar.altitude))
  /* 彩虹的雨幕必须在太阳对侧：有点降水不等于反日方向有雨。
     有 spatial 时优先用反日方位的降水/概率；没有时退回单点口径（旧行为）。 */
  const dirWet = list.map(h => {
    const s = A.solarPosition(A.cnToMs(h.d || date, h.t), lat, lng)
    const antiH = A.norm360(s.azimuth + 180)
    const timeKey = (h.d || date) + 'T' + h.t
    return {
      h,
      anti: antiH,
      precip: directionValue(spatial, timeKey, antiH, 'precip'),
      pop: directionValue(spatial, timeKey, antiH, 'pop'),
      terrain: terrainAt(ctx.terrain, antiH),
    }
  })
  const directional = dirWet.some(x => x.precip != null || x.pop != null)
  const wetHours = directional
    ? dirWet.filter(x => (x.precip != null && x.precip > 0.05) || (x.pop != null && x.pop >= 50)).length
    : list.filter(h => hourCloud(h).precip > 0.05 || hourCloud(h).showers > 0.05).length
  const blocked = dirWet.filter(x => x.terrain && x.terrain.angle > 2)
  const terrainBlocked = list.length > 0 && blocked.length === list.length
  let score = 40
  if (wetHours >= 2) score += 30
  else if (wetHours === 1) score += 20
  else if (directional) score -= 10
  if (terrainBlocked) score -= 15
  if (solar.altitude < 12) score += 20
  else if (solar.altitude < 25) score += 10
  if (list.length >= 3) score += 10
  const g = grade(score)
  item.window = windowText(list)
  /* 方位角必须取整再印：`anti` 是 `norm360(solar.azimuth + 180)` 的原始浮点，
     以前直接拼进中文，真机上出现过「朝正西（约 284.15999999999997 度）看」。
     银河那句（galaxyConclusion）用的是 galaxyPosition 的方位角，并且自己也 Math.round——
     同一写法不等于同一个数，所以这里不能省。*/
  item.look = '背对太阳，朝' + A.bearingLabel(anti) + '（约 ' + Math.round(anti) + ' 度，反日点方向）看，主虹顶部仰角约 ' + top + ' 度'
  const wetText = directional
    ? (wetHours
      ? '反日方向有降水信号（方向为模式粗判），彩虹出现的可能性存在'
      : '反日方向未检出降水（方向为模式粗判），彩虹出现的条件不足')
    : '有降水或高湿，彩虹出现的可能性存在'
  const terrainText = terrainBlocked
    ? '；反日方向地平线被山脊挡住（约 '
      + Math.round(Math.max.apply(null, blocked.map(x => x.terrain.angle))) + '°，DEM 90 m 粗判）'
    : ''
  item.text = (solar.altitude < 12 ? '太阳压得低，' : '太阳偏高，') + '在 ' + windowText(list)
    + ' ' + wetText + terrainText + '；彩虹只在太阳对侧且太阳低于约 40 度时可见。'
  return Object.assign(item, g, { verdict: VERDICT.POSSIBLE })
}

// 摄影窗口：黄金时刻与蓝调时刻（客观时刻，无概率）
function lightConclusion(ctx) {
  const { date, lat, lng, elevation } = ctx
  const w = A.photoWindows(date, lat, lng, elevation)
  const sun = A.sunTimes(date, lat, lng, elevation)
  const seg = x => (x ? x.from + '-' + x.to : '--')
  return {
    key: 'light',
    title: '晨昏光窗口',
    score: 100,
    tone: '',
    label: '客观时刻',
    /* 客观时刻不是"概率判断"，永远不因天气被沉默（页面本来也不渲染这张卡） */
    verdict: VERDICT.POSSIBLE,
    window: '',
    look: '',
    text: '日出 ' + (sun.sunrise || '--') + ' · 日落 ' + (sun.sunset || '--')
      + '；黄金时刻 晨 ' + seg(w.morningGolden) + ' / 昏 ' + seg(w.eveningGolden)
      + '；蓝调时刻 晨 ' + seg(w.dawnBlue) + ' / 昏 ' + seg(w.duskBlue)
      + '（蓝调按太阳 -6 至 -4 度推算，通常只有十几分钟）。',
  }
}

/**
 * 主入口：把一个节点的当日数据翻译成天相结论 + 逐小时标记。
 * @param ctx { date, lat, lng, elevation, elevOK, detail, days, heading }
 *        elevation 为可信海拔（GPX 节点高程优先，否则模型降尺度值）；elevOK=false 时
 *        云海/光染的"在云上"判断跳过并在文案里说明。
 */
function summarize(ctx) {
  const { date, lat, lng } = ctx
  if (!date || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const sun = A.sunTimes(date, lat, lng, ctx.elevation)
  const night = nightHoursForDate(ctx, sun)
  const moon = A.moonInfo(date)
  const starCtx = Object.assign({}, ctx, { night })
  const items = [
    lightConclusion(ctx),
    alpenglowConclusion(ctx),
    cloudSeaConclusion(ctx),
    starConclusion(starCtx),
    galaxyConclusion(starCtx),
    rainbowConclusion(ctx),
  ]
  return { sun, moon, items, marks: hourMarks(ctx), night }
}

module.exports = {
  hourMin, num, mean, bearingBetween, inArc, inWindow, hourTouches, addDays,
  grade, cap69, hourCloud, nightHours, nightHoursForDate, nightWindowText, cloudAboveAt, inversionAt,
  directionValue, terrainAt, atmosphereAt, atmosphereImpact, lightPollutionImpact,
  hourMarks, hourSegments, summarize, LIGHT_WINDOW_MIN,
  VERDICT, isSilent, LIGHT_LIMITS, lightReachesGround,
}

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
  const { date, lat, lng, elevation, elevOK, detail } = ctx
  const sun = A.sunTimes(date, lat, lng, elevation)
  const win = A.photoWindows(date, lat, lng, elevation)
  const dawnMin = hourMin(sun.astroDawn)
  const duskMin = hourMin(sun.astroDusk)
  const moonIll = A.moonInfo(date).illumination
  const galaxySeason = A.galaxySeason(date)
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
    if (band && elevOK && elevation > band.top && c.high < 30 && m < 10 * 60 && band.cover >= 80) add(h, 'cloudSea')

    // 晨昏光染：落在晨昏窗口内，且低云少（光能到山体）、中高云有（被染色）、无降水
    const inLightWindow = hourTouches(m, riseMin, riseMin + LIGHT_WINDOW_MIN)
      || hourTouches(m, setMin - LIGHT_WINDOW_MIN, setMin)
    if (inLightWindow && c.precip < 0.3 && c.pop < 40 && c.low < 40 && c.mid + c.high >= 25) {
      add(h, 'alpenglow')
    }
    if (win.morningGolden && hourTouches(m, hourMin(win.morningGolden.from), hourMin(win.morningGolden.to))) add(h, 'golden')
    if (win.eveningGolden && hourTouches(m, hourMin(win.eveningGolden.from), hourMin(win.eveningGolden.to))) add(h, 'golden')
    if (win.dawnBlue && hourTouches(m, hourMin(win.dawnBlue.from), hourMin(win.dawnBlue.to))) add(h, 'blueHour')
    if (win.duskBlue && hourTouches(m, hourMin(win.duskBlue.from), hourMin(win.duskBlue.to))) add(h, 'blueHour')

    // 彩虹：太阳高度 < 40 度（主虹在反日点 42 度半径）且空气有水分
    const solar = A.solarPosition(A.cnToMs(date, h.t), lat, lng)
    const wet = c.precip > 0.05 || c.showers > 0.05 || (c.rh != null && c.rh >= 88) || c.low >= 70
    if (solar.altitude < 40 && solar.altitude > -2 && wet) add(h, 'rainbow')

    // 星空 / 银河：天文暗夜 + 高中层云少 + 无降水；银河另需银心季且月照低
    const dark = Number.isFinite(dawnMin) && Number.isFinite(duskMin) && (m < dawnMin || m > duskMin)
    if (dark && (c.high + c.mid) / 2 < 30 && c.precip === 0) {
      add(h, 'star')
      if (galaxySeason && moonIll < 35) add(h, 'galaxy')
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
  if (!list.length) {
    item.text = '今天' + side + '前后云量或降水条件不足，山体被光染的概率很低。'
    item.look = heading == null ? '' : '前进方向朝' + A.bearingLabel(heading)
    return Object.assign(item, grade(0))
  }
  const first = list[0]
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
  const g = grade(score)
  item.text = side + '在 ' + windowText(list) + ' 有山体被光染的可能（' + reasons.join('、') + '）。'
    + '这里只用了云量与降水：本工具没有目标山峰的位置、坡向、遮挡（DEM）数据，给不出「某座山会不会金山」。'
  item.look = (isDawn ? '朝东至东北' : '朝西至西北') + '看山脊线'
    + (heading == null ? '' : '（按轨迹走向朝' + A.bearingLabel(heading) + '，为粗判）')
  item.window = windowText(list)
  return Object.assign(item, g)
}

// 云海：五信号合成（低层湿层 / 清晨时段 / 高层干净 / 观察点在带顶之上 / 微风），另参考前日降水
function cloudSeaConclusion(ctx) {
  const { date, lat, lng, elevation, elevOK, detail, days } = ctx
  const marks = hourMarks(ctx)
  const list = detail.filter(h => (marks[h.t] || []).indexOf('cloudSea') !== -1)
  const item = { key: 'cloudSea', title: '云海', window: '', look: '站在此点向低处与远处看云顶', text: '' }
  if (!elevOK) {
    item.text = '此点缺少可信海拔（GPX 未记录高程），无法判断是否高过云层带。'
    return Object.assign(item, grade(0))
  }
  const solid = detail.filter(h => h.band && h.band.cover >= 80)
  if (!solid.length) {
    item.text = '今天没有成层的低云带（无 80% 以上云量的层），云海无从形成。'
    return Object.assign(item, grade(0))
  }
  let score = 20
  const reasons = []
  const baseMin = Math.min.apply(null, solid.map(h => h.band.base))
  if (baseMin <= 2200) {
    score += 18
    reasons.push('低层有云带（底约 ' + Math.round(baseMin) + ' m）')
  } else {
    score += 4
    reasons.push('云带偏高（底约 ' + Math.round(baseMin) + ' m）')
  }
  const above = list.length > 0
  if (above) { score += 24; reasons.push('此点在云带上方') } else { reasons.push('此点不在云带上方') }
  const morning = detail.filter(h => hourMin(h.t) < 10 * 60)
  const highClean = morning.every(h => (num(h.cloud && h.cloud.high) || 0) < 30)
  if (highClean) { score += 14; reasons.push('清晨高层云少') }
  const w = mean(morning.map(h => hourCloud(h).wind).filter(x => x != null))
  if (w != null && w < 15) { score += 12; reasons.push('清晨微风（' + Math.round(w) + ' km/h）') }
  const prev = (days || []).find(d => d.date === addDays(date, -1))
  if (prev && prev.precipSum > 0) {
    score += 12
    reasons.push('前日有降水（' + prev.precipSum + ' mm）')
  }
  const g = grade(score)
  item.text = above
    ? '清晨 ' + windowText(list) + ' 有在云顶之上看云海的机会（' + reasons.join('、') + '）。'
    : '今天有云带但此点在云带内或云带偏高，云海机会低（' + reasons.join('、') + '）。'
  item.window = above ? windowText(list) : ''
  return Object.assign(item, g)
}

// 星空：天文暗夜窗口 + 晴空率 + 月照
function starConclusion(ctx) {
  const { date, lat, lng, elevation, detail } = ctx
  const sun = A.sunTimes(date, lat, lng, elevation)
  const night = nightHours(detail, sun)
  const moon = A.moonInfo(date)
  const item = { key: 'star', title: '星空', window: '', look: '关掉手电、避开城镇光害，找开阔北向视野', text: '' }
  if (!night.length) {
    item.text = '天文暗夜时段数据不足（今日极昼/极夜或无数据）。'
    return Object.assign(item, grade(0))
  }
  const sight = A.starSight(night, moon, A.galaxySeason(date))
  const cs = night.map(hourCloud)
  const clearRate = Math.round(cs.filter(c => (c.high + c.mid) / 2 < 30 && !c.precip).length / cs.length * 100)
  let score = 0
  if (clearRate >= 70) score += 45
  else if (clearRate >= 40) score += 26
  else score += 8
  if (moon.illumination < 25) score += 28
  else if (moon.illumination < 50) score += 16
  else if (moon.illumination < 70) score += 6
  const g = grade(score)
  item.window = windowText(night)
  item.text = '天文暗夜 ' + windowText(night) + '（' + night.length + ' 小时，夜段延续到次日，晨段属前夜尾段），'
    + sight.star.text
    + '（暗夜晴空 ' + clearRate + '%，' + moon.name + '月照 ' + moon.illumination + '%）。'
  return Object.assign(item, g)
}

// 银河：银心季 + 暗夜晴空 + 月照 + 方位
function galaxyConclusion(ctx) {
  const { date, lat, lng, elevation, detail } = ctx
  const sun = A.sunTimes(date, lat, lng, elevation)
  const night = nightHours(detail, sun)
  const moon = A.moonInfo(date)
  const item = { key: 'galaxy', title: '银河', window: '', look: '', text: '' }
  if (!A.galaxySeason(date)) {
    item.text = '不在银心季节（约 3-10 月），此时夜空以亮星为主，银河不明显。'
    return Object.assign(item, grade(0))
  }
  if (!night.length) {
    item.text = '天文暗夜时段数据不足。'
    return Object.assign(item, grade(0))
  }
  const cs = night.map(hourCloud)
  const clearRate = Math.round(cs.filter(c => (c.high + c.mid) / 2 < 30 && c.precip === 0).length / cs.length * 100)
  let score = 20
  if (clearRate >= 70) score += 40
  else if (clearRate >= 40) score += 22
  if (moon.illumination < 20) score += 28
  else if (moon.illumination < 35) score += 18
  else if (moon.illumination < 50) score += 6
  // 取暗夜里高中层云最少的一小时作为推荐时段，给出该钟点的银心方位
  let best = night[0]
  for (const h of night) {
    const a = hourCloud(h)
    const b = hourCloud(best)
    if ((a.high + a.mid) / 2 < (b.high + b.mid) / 2) best = h
  }
  const hour = Number(best.t.slice(0, 2)) + Number(best.t.slice(3, 5)) / 60
  const bearing = A.galaxyBearing(date, hour)
  const g = grade(score)
  item.window = best.t + ' 前后'
  item.look = bearing == null ? '' : '朝' + A.bearingLabel(bearing) + '（约 ' + bearing + ' 度）找银心带'
  item.text = clearRate >= 70 && moon.illumination < 35
    ? '银心季 + 暗夜晴（' + clearRate + '%）+ 月照 ' + moon.illumination + '%，银河可见概率较大。'
    : '银心季，但' + (clearRate < 70 ? '暗夜有云（晴 ' + clearRate + '%）' : '月照 ' + moon.illumination + '% 偏亮') + '，银河不建议抱太大期望。'
  return Object.assign(item, g)
}

// 彩虹：反日点 42 度半径，太阳越高虹越低
function rainbowConclusion(ctx) {
  const { date, lat, lng, elevation, detail } = ctx
  const marks = hourMarks(ctx)
  const list = detail.filter(h => (marks[h.t] || []).indexOf('rainbow') !== -1)
  const item = { key: 'rainbow', title: '彩虹', window: '', look: '', text: '' }
  if (!list.length) {
    item.text = '今天没有合适的太阳高度与空气水分组合，彩虹概率很低（彩虹要求太阳在身后且高度低于约 40 度）。'
    return Object.assign(item, grade(0))
  }
  const first = list[0]
  const solar = A.solarPosition(A.cnToMs(date, first.t), lat, lng)
  const anti = A.norm360(solar.azimuth + 180)
  const top = Math.max(2, Math.round(42 - solar.altitude))
  const wetHours = list.filter(h => hourCloud(h).precip > 0.05 || hourCloud(h).showers > 0.05).length
  let score = 40
  if (wetHours >= 2) score += 30
  else if (wetHours === 1) score += 20
  if (solar.altitude < 12) score += 20
  else if (solar.altitude < 25) score += 10
  if (list.length >= 3) score += 10
  const g = grade(score)
  item.window = windowText(list)
  item.look = '背对太阳，朝' + A.bearingLabel(anti) + '（约 ' + anti + ' 度）看，主虹顶部仰角约 ' + top + ' 度'
  item.text = (solar.altitude < 12 ? '太阳压得低，' : '太阳偏高，') + '在 ' + windowText(list)
    + ' 有降水或高湿，彩虹出现的可能性存在；彩虹只在太阳对侧且太阳低于约 40 度时可见。'
  return Object.assign(item, g)
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
  const moon = A.moonInfo(date)
  const items = [
    lightConclusion(ctx),
    alpenglowConclusion(ctx),
    cloudSeaConclusion(ctx),
    starConclusion(ctx),
    galaxyConclusion(ctx),
    rainbowConclusion(ctx),
  ]
  return { sun, moon, items, marks: hourMarks(ctx) }
}

module.exports = {
  hourMin, num, mean, bearingBetween, inArc, inWindow, hourTouches, addDays,
  grade, hourCloud, nightHours, hourMarks, hourSegments, summarize, LIGHT_WINDOW_MIN,
}

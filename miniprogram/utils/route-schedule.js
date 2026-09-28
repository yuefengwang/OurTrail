// 路线日程推算：把 GPX 轨迹时间戳映射到活动的出发时刻，得到每个节点的"第几天 / 几点抵达"。
// 纯函数、无 wx 依赖，可在 node 下测试（tools/route-schedule-test.js）。
//
// 为什么需要它：徒步者看天气是按"走到哪个点、几点到"来判断的，而活动日程是我们定的。
// GPX 里的绝对日期无意义（那是某次历史记录），有意义的是**相对出发点的耗时**，
// 所以只用时间差，再用活动的出发钟点对齐，绝不把 GPX 的日期当活动日期。
//
// 边界（用户明确要求）：轨迹里没有时间信息的点就"给不出提醒"，不编造、不按距离插值，
// 页面上直接标为无时间信息。
'use strict'

const TZ_MIN = 8 * 60 // 固定 +08:00（中国无夏令时，与全站时间基准一致）

// ISO instant → 北京时间的"当日分钟数"
function minutesOfDay(iso) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return NaN
  return Math.floor((t + TZ_MIN * 60000) / 60000) % 1440
}

function dateOf(iso) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Date(t + TZ_MIN * 60000).toISOString().slice(0, 10)
}

function clockOf(minutes) {
  const v = ((minutes % 1440) + 1440) % 1440
  return String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(Math.round(v % 60)).padStart(2, '0')
}

function durationText(min) {
  const m = Math.max(0, Math.round(min))
  if (m < 60) return m + ' 分钟'
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? h + ' 小时 ' + r + ' 分' : h + ' 小时'
}

/**
 * 推算各节点抵达日程。
 * @param points [{ id, name, time, ele, coordinates }]
 * @param startAt 活动出发时刻（ISO instant）；未定时为 null，此时只给"出发后多久"不给日期
 * @returns [{ id, known, elapsedMin, dayIndex, arriveAt, arriveTime, arriveDate }]
 *   known=false → 该节点没有时间戳，推不出提醒
 *   dayIndex 从 1 开始；startAt 为空时 dayIndex/arriveAt 为 null
 */
function schedule(points, startAt) {
  const list = points || []
  const timed = list.filter(p => p && Number.isFinite(Date.parse(p.time)))
  if (!timed.length) {
    return list.map(p => ({ id: p && p.id, known: false, elapsedMin: null, dayIndex: null, arriveAt: null, arriveTime: null, arriveDate: null }))
  }
  // 锚点：第一个有时间戳的节点。GPX 的绝对日期无意义，只取"相对锚点的耗时"，
  // 再以活动的出发时刻为基准展开——抵达时刻的钟点自然就是出发钟点，不需要额外偏移。
  const anchor = timed[0]
  const anchorMs = Date.parse(anchor.time)
  const startMs = startAt ? Date.parse(startAt) : NaN
  const hasStart = Number.isFinite(startMs)

  return list.map(p => {
    if (!p || !Number.isFinite(Date.parse(p.time))) {
      return { id: p && p.id, known: false, elapsedMin: null, dayIndex: null, arriveAt: null, arriveTime: null, arriveDate: null }
    }
    const elapsedMin = Math.round((Date.parse(p.time) - anchorMs) / 60000)
    if (!hasStart) {
      return { id: p.id, known: true, elapsedMin, dayIndex: null, arriveAt: null, arriveTime: null, arriveDate: null }
    }
    const arriveMs = startMs + elapsedMin * 60000
    const arriveDate = dateOf(new Date(arriveMs).toISOString())
    const startDate = dateOf(startAt)
    // 跨天数 = 两个自然日之差（用 UTC 正午做差，避开时区与夏令时）
    const dayDiff = Math.round((Date.parse(arriveDate + 'T00:00:00Z') - Date.parse(startDate + 'T00:00:00Z')) / 86400000)
    return {
      id: p.id,
      known: true,
      elapsedMin,
      dayIndex: dayDiff + 1,
      arriveAt: new Date(arriveMs).toISOString(),
      arriveTime: clockOf(minutesOfDay(new Date(arriveMs).toISOString())),
      arriveDate,
    }
  })
}

/** 节点选择器上的短标签：'第2天 14:20' / '出发后 5 小时 20 分' / '无时间信息' */
function nodeLabel(item) {
  if (!item || !item.known) return '无时间信息'
  if (item.arriveTime) return '第' + item.dayIndex + '天 ' + item.arriveTime
  return '出发后 ' + durationText(item.elapsedMin)
}

/** 天气页顶部的说明文案：讲清楚这个日期是怎么来的 */
function basisText(sched, hasStart) {
  if (!sched || !sched.some(s => s.known)) {
    return '这条轨迹没有记录时间信息，无法推算抵达日程——下面是所选日期的天气。'
  }
  return hasStart
    ? '按轨迹记录的时间差与出发时刻推算抵达时间，日期已自动对齐。'
    : '活动未定出发时刻，先看轨迹各点的耗时；定了出发时间就能定位到当天。'
}

/** 整个行程跨几天（第 1 天到第 N 天），无时间戳返回 null */
function spanDays(sched) {
  const known = (sched || []).filter(s => s.known && s.dayIndex)
  if (!known.length) return null
  return Math.max.apply(null, known.map(s => s.dayIndex))
}

module.exports = { schedule, nodeLabel, basisText, spanDays, durationText, minutesOfDay, clockOf }

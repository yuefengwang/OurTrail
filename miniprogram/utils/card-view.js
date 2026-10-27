// 活动卡正文的三行派生（纯函数，wx-free）：chips 行 + 人数。
//
// 只做展示派生：服务端投影字段 info / status / metrics 一字不动
// （tools/a20-owner-hero-test.js 按字节比对它们，派生字段不许进那个对象）。
// 首页与发现页共用本文件，消除两页各自复制一份「距离/爬升」的口径；
// 两页的 status 语义仍然不同（首页有归属前缀、发现页没有），那部分留在各页，不在这里抹平。
'use strict'
const F = require('./format')

// 路线事实仍以页面的 metrics 形态出一次（{key,label,value,unit}）：那是 home/discover
// 卡片对象的既有契约（tools/home-collab-list-test.js、tools/scenario-discover-test.js
// 按字节比对它），本文件只把「哪两项算事实」收成一处，不给它改名。
// 缺字段整项不出现——「没填」不许印成「0 km / 0 m」（路线可整体后补）。
function metricsOf(activity) {
  const route = (activity || {}).routeSnapshot || {}
  const metrics = []
  if (route.distanceKm) metrics.push({ key: 'distance', label: '距离', value: String(route.distanceKm), unit: 'km' })
  if (route.ascentM) metrics.push({ key: 'ascent', label: '爬升', value: String(route.ascentM), unit: 'm' })
  return metrics
}

// chips 的次序就是截断优先级：日期 > 难度 > 距离 > 爬升（参考板的活动卡只有一行 chips）。
function chipsOf(activity) {
  const a = activity || {}
  const chips = []
  if (a.startAt) chips.push({ key: 'date', text: F.dateLabel(a.startAt) })
  const difficulty = F.difficultyLabel((a.routeSnapshot || {}).difficulty)
  if (difficulty) chips.push({ key: 'difficulty', text: difficulty })
  for (const m of metricsOf(a)) chips.push({ key: m.key, text: m.value + ' ' + m.unit })
  return chips
}

// 人数只印一次：`已确认 3/10`；组织者多一格待审核队列。
// pending 是组织者的工作队列，非组织者即使投影里带了这个数也不印（失败关闭，
// 与首页 info 行既有判据同源：归属位只认投影显式给的 owner）。
// pending=0 照印「待审核 0 人」——那是「审完了」这个事实，不是缺失
// （与 home/discover 的 info 行同一条已登记判据；0 不是缺失）。
function peopleOf(source) {
  const m = source || {}
  const confirmed = typeof m.confirmed === 'number' ? m.confirmed : null
  const capacity = typeof m.capacity === 'number' ? m.capacity : null
  let text = ''
  if (confirmed !== null) text = '已确认 ' + confirmed + (capacity === null ? ' 人' : '/' + capacity)
  const pending = m.owner && typeof m.pending === 'number'
    ? '待审核 ' + m.pending + ' 人'
    : ''
  return { text, pending }
}

module.exports = { chipsOf, metricsOf, peopleOf }

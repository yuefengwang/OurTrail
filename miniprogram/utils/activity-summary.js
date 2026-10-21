// 活动详情的事实摘要：只把已经落在结构化字段里的时间/路线/集合拼成一句话，
// 不推断路线难度、不补写集合地址、不生成任何用户没填过的内容。
// 调用方必须把它标成「根据活动信息自动整理」，不能与领队手写介绍混为一谈。
'use strict'
const F = require('./format')

function numberText(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10)
}

function buildFactSummary(activity) {
  const a = activity || {}
  const parts = []
  const used = []

  if (a.startAt) {
    parts.push(F.dateLabel(a.startAt) + ' ' + F.hhmm(a.startAt) + ' 出发')
    used.push('start')
  }

  const route = a.routeSnapshot || {}
  const routeBits = []
  if (route.title && String(route.title).trim()) routeBits.push('「' + String(route.title).trim() + '」')
  if (Number(route.distanceKm) > 0) routeBits.push('全程约 ' + numberText(route.distanceKm) + ' km')
  if (Number(route.ascentM) > 0) routeBits.push('累计爬升约 ' + numberText(route.ascentM) + ' m')
  if (routeBits.length) {
    parts.push('路线' + routeBits.join('，'))
    used.push('route')
  }

  const pickup = Array.isArray(a.pickupPoints) ? a.pickupPoints[0] : null
  if (pickup && pickup.name && String(pickup.name).trim()) {
    parts.push('集合在「' + String(pickup.name).trim() + '」' + (pickup.meetingAt ? '，' + F.hhmm(pickup.meetingAt) : ''))
    used.push('pickup')
  }

  return {
    text: parts.length ? parts.join('；') + '。' : '',
    used: used,
  }
}

module.exports = { buildFactSummary, numberText }

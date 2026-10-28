// 个人天气计划（V3「沿途天气」的可保存计划）。
//
// 定位：一条路线 + 「哪天到哪个节点、几点到」。计划**不改**原始 GPX / 路线资产，
// 同一营地可以在相邻两天重复出现（D1 17:00 / D2 08:00 是合法形态）。
//
// 授权：owner 双层（permissions.canExecute 一次 + 本文件一次）。
// 被授权者（sharedWith）**只读**；「复制为独立计划」由客户端读后 plan.create，
// 新 ownerId = 复制者，不属于越权。
//
// 归属与 visibility 的推导直接对齐 routes.js（同一套 normalize 语义）：
// 客户端提交的 visibility 一律忽略，由 sharedWith 推导；
// 不允许「private + 非空名单」或「shared + 空名单」的矛盾态。
'use strict'

const S = require('./schema')
const { failure, deepClone } = require('./contracts')

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const MAX_PLAN_DAYS = 7

const success = ids => ({ ok: true, value: ids })

// 与客户端 utils/weather-v3.planTimeViolation 同一口径：
// 同一天内抵达时间不得沿 stops 顺序逆序；空值不参与比较。
function timeViolation(stops) {
  for (let d = 1; d <= MAX_PLAN_DAYS; d++) {
    let prev = null
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i]
      if (!s || s.day !== d || !s.time) continue
      const m = Number(s.time.slice(0, 2)) * 60 + Number(s.time.slice(3, 5))
      if (!Number.isFinite(m)) continue
      if (prev !== null && m < prev) return { day: d, index: i }
      prev = m
    }
  }
  return null
}

/** 资产级归一化：时间戳、去重、剔自己、visible 派生（对齐 routes.normalize）。 */
function normalize(input, actorId, now) {
  const sharedWith = Array.from(new Set((input.sharedWith || []).filter(id => id !== actorId)))
  return {
    sharedWith,
    visibility: sharedWith.length ? 'shared' : 'private',
    updatedAt: now,
  }
}

function validateInput(state, input) {
  if (!S.validate(S.PlanInput, input)) return failure('INVALID_INPUT', '计划字段不完整或格式不正确。')
  if (!String(input.name || '').trim()) return failure('INVALID_INPUT', '请填写计划名称。')
  if (!ISO_DATE.test(String(input.startDate || ''))) return failure('INVALID_INPUT', '出发日期格式应为 YYYY-MM-DD。')
  const route = state.routes.find(r => r.id === input.routeId)
  if (!route) return failure('NOT_FOUND', '找不到这条路线，请先在路线库保存。')
  const limit = route.points.length
  for (const stop of input.stops) {
    if (stop.nodeIndex < 0 || stop.nodeIndex >= limit) {
      return failure('INVALID_INPUT', '计划里的节点不在该路线上。')
    }
    if (stop.time !== '' && !HHMM.test(stop.time)) {
      return failure('INVALID_INPUT', '抵达时间应为 HH:mm，或留空表示待安排。')
    }
  }
  const bad = timeViolation(input.stops)
  if (bad) return failure('INVALID_INPUT', `第 ${bad.day} 天的抵达时间先于前一站，请调整后再保存。`)
  return { ok: true, value: route }
}

function handlePlans(state, command, context) {
  const p = command.payload
  if (['plan.create', 'plan.update', 'plan.delete'].indexOf(p.type) === -1) {
    return failure('INVALID_INPUT', '此计划处理器不支持该操作。')
  }
  const actorId = command.actor.userId
  if (!actorId) return failure('AUTH_REQUIRED', '请先选择当前账号。')

  if (p.type === 'plan.create') {
    const valid = validateInput(state, p.input)
    if (!valid.ok) return valid
    const plan = Object.assign(deepClone(p.input), { id: context.id('plan'), ownerId: actorId }, normalize(p.input, actorId, context.now))
    state.plans.push(plan)
    return success([plan.id])
  }

  const plan = state.plans.find(x => x.id === p.planId)
  if (!plan) return failure('NOT_FOUND', '找不到这个计划。')
  // 授权双保险：canExecute 已做 owner 门，这里按 owner 再判一次。
  if (plan.ownerId !== actorId) return failure('FORBIDDEN', '只有计划创建者可以修改、分享或删除这个计划。')

  if (p.type === 'plan.update') {
    const valid = validateInput(state, p.input)
    if (!valid.ok) return valid
    Object.assign(plan, deepClone(p.input), normalize(p.input, actorId, context.now))
    return success([plan.id])
  }

  state.plans.splice(state.plans.indexOf(plan), 1)
  return success([plan.id])
}

module.exports = { handlePlans, timeViolation, normalizePlan: normalize }
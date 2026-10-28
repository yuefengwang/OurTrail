// 个人天气计划的客户端出口（唯一 api 调用点）。
//
// 服务端契约：read {kind:'plans'} → { kind:'plans', plans:[…] }；
// plan.create {input} / plan.update {planId,input,expectedRevision} / plan.delete {planId,expectedRevision}。
// 投影里**没有** ownerId / sharedWith 原文，所以「取消某一位」不可做；
// 分享面只支持「按协作码添加」与「取消全部共享」（sharedCount>0 时可用）。
'use strict'

const api = require('./api')
const V3 = require('./weather-v3')

/** 读计划列表（带全局 revision，写入时必须带它：缺 revision 一律 fail closed） */
function listPlans() {
  return api.read({ kind: 'plans' }).then(res => {
    const view = res && res.view
    if (!view || view.kind !== 'plans') {
      const err = new Error((view && view.message) || '读取个人计划失败。')
      err.code = (view && view.code) || 'INVALID_INPUT'
      throw err
    }
    return { plans: view.plans || [], revision: Number.isFinite(res && res.revision) ? res.revision : null }
  })
}

/** 读视图行 → 可提交的输入（剔除投影字段；stops 深拷贝） */
function inputOf(plan) {
  const p = plan || {}
  return {
    routeId: p.routeId,
    name: String(p.name == null ? '' : p.name),
    startDate: p.startDate,
    stops: (Array.isArray(p.stops) ? p.stops : []).map(s => ({
      nodeIndex: s.nodeIndex, day: s.day, time: s.time || '',
    })),
    sharedWith: Array.isArray(p.sharedWith) ? p.sharedWith.slice() : [],
  }
}

/** 编辑草稿（副本模式：id 清空、名字加「（副本）」） */
function draftOf(plan, opts) {
  const o = opts || {}
  const input = inputOf(plan)
  if (o.copy) {
    return { id: null, input: Object.assign({}, input, { name: input.name + '（副本）', sharedWith: [] }) }
  }
  return { id: plan && plan.id ? plan.id : null, input }
}

/**
 * 保存草稿前的本地校验（服务端同源口径；本地先拦是为了不让用户白等一次往返）。
 * 返回 { ok:true, input } 或 { ok:false, error }。
 */
function validateDraft(draft, nodeCount) {
  const d = draft || {}
  const input = d.input || {}
  const name = String(input.name || '').trim()
  if (!name) return { ok: false, error: '请填写计划名称。' }
  if (!V3.isDate(input.startDate)) return { ok: false, error: '请选择出发日期。' }
  const stops = Array.isArray(input.stops) ? input.stops : []
  for (const s of stops) {
    if (!Number.isFinite(s.nodeIndex) || s.nodeIndex < 0 || s.nodeIndex >= nodeCount) {
      return { ok: false, error: '计划里的节点不在该路线上。' }
    }
    if (s.time && !V3.typedTime(s.time)) return { ok: false, error: '抵达时间应为 HH:mm，或留空表示待安排。' }
  }
  const bad = V3.planTimeViolation(stops)
  if (bad) return { ok: false, error: '第 ' + bad.day + ' 天的抵达时间先于前一站，请调整后再保存。' }
  return { ok: true, input: Object.assign({}, input, { name, stops }) }
}

function savePlan(planId, input, revision, requestId) {
  const payload = planId
    ? { type: 'plan.update', planId, input }
    : { type: 'plan.create', input }
  return api.dispatch(payload, revision, requestId)
}

function deletePlan(planId, revision, requestId) {
  return api.dispatch({ type: 'plan.delete', planId }, revision, requestId)
}

/** 某个路线上最近更新的计划（列表已按 updatedAt 倒序） */
function planForRoute(plans, routeId) {
  const list = Array.isArray(plans) ? plans : []
  return list.filter(p => p.routeId === routeId)[0] || null
}

/** 与我共享的计划（不是 owner）；列表里用来分组 */
function sharedPlans(plans) {
  return (Array.isArray(plans) ? plans : []).filter(p => !p.isOwner)
}

function ownPlans(plans) {
  return (Array.isArray(plans) ? plans : []).filter(p => p.isOwner)
}

module.exports = {
  listPlans, inputOf, draftOf, validateDraft, savePlan, deletePlan, planForRoute, ownPlans, sharedPlans,
}
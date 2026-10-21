// V2 路线库：路线资产生命周期（创建 / 编辑 / 删除）。
// 与活动命令的边界：route.* 不挂 activityId、不产事件、不发通知——
// 事件与通知的活动归属由 invariants.js 钉死（event.activityId / notice.activityId 必须存在），
// 路线是活动之外的资产，它的变更没有「活动受众」可通知。
// 删除的保护：被活动引用的路线不能删（活动里的 routeSnapshot 是冻结快照，
// 删了资产不影响历史活动，但 routeId 会变成悬空引用）。
'use strict'

const S = require('./schema')
const { failure, deepClone } = require('./contracts')

const success = ids => ({ ok: true, value: ids })
const uniqueIds = ids => new Set(ids).size === ids.length

function validateInput(input) {
  if (!S.validate(S.RouteInput, input)) return failure('INVALID_INPUT', '路线字段不完整或格式不正确。')
  if (!input.title.trim()) return failure('INVALID_INPUT', '请填写路线名称。')
  if (!uniqueIds(input.points.map(p => p.id)) || !uniqueIds(input.risks.map(r => r.id))) {
    return failure('INVALID_INPUT', '路线节点与风险标识不能重复。')
  }
  return { ok: true, value: null }
}

/** 资产级字段的服务端归一化：客户端只提交语义，时间戳与去重/剔自己由这里定。 */
function normalize(input, actorId, now) {
  // 共享给自己没有意义；重复邀请同一个人也只留一份。
  const sharedWith = Array.from(new Set((input.sharedWith || []).filter(id => id !== actorId)))
  return {
    source: input.source || 'manual',
    // visibility 是派生显示字段，不允许与 sharedWith 矛盾：
    // 「visibility=private 但名单里有人」会让协作者静默失去访问（UI 忘了切开关），
    // 「visibility=shared 但名单为空」会让人以为已分享出去。以名单为准推导，
    // 客户端提交的 visibility 一律忽略（schema 仍校验其取值合法）。
    visibility: sharedWith.length ? 'shared' : 'private',
    sharedWith,
    updatedAt: now,
  }
}

function handleRoutes(state, command, context) {
  const p = command.payload
  if (['route.create', 'route.update', 'route.delete'].indexOf(p.type) === -1) {
    return failure('INVALID_INPUT', '此路线处理器不支持该操作。')
  }
  const actorId = command.actor.userId
  if (!actorId) return failure('AUTH_REQUIRED', '请先选择当前账号。')

  if (p.type === 'route.create') {
    const valid = validateInput(p.input)
    if (!valid.ok) return valid
    const route = Object.assign(deepClone(p.input), { id: context.id('route'), ownerId: actorId }, normalize(p.input, actorId, context.now))
    state.routes.push(route)
    return success([route.id])
  }

  const route = state.routes.find(r => r.id === p.routeId)
  if (!route) return failure('NOT_FOUND', '找不到此路线。')
  // 授权双保险：canExecute 已做 owner 门，这里按 owner 再判一次——
  // 与 activity.js:99 同构：授权不依赖单点实现。
  if (route.ownerId !== actorId) return failure('FORBIDDEN', '只有路线创建者可以修改或删除路线。')

  if (p.type === 'route.update') {
    const valid = validateInput(p.input)
    if (!valid.ok) return valid
    // 可选字段的「清空」：route.update 是全量替换，但 Object.assign 不会删除缺键。
    // 用户把难度改回「未标注」时输入里没有 difficulty，必须显式删掉旧值。
    if (!Object.prototype.hasOwnProperty.call(p.input, 'difficulty')) delete route.difficulty
    Object.assign(route, deepClone(p.input), normalize(p.input, actorId, context.now))
    return success([route.id])
  }

  // route.delete：被活动引用的路线不能删。活动里的 routeSnapshot 是创建时冻结的副本，
  // 删资产不破坏历史活动，但 routeId 悬空会让「活动用了哪条路线」查不到。
  const usedBy = state.activities.filter(a => a.routeId === route.id)
  if (usedBy.length) {
    return failure('CONFLICT', '有 ' + usedBy.length + ' 个活动正在使用此路线，请先在活动中解除关联再删除。')
  }
  state.routes.splice(state.routes.indexOf(route), 1)
  return success([route.id])
}

module.exports = { handleRoutes }

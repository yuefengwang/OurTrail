// 由原型 domain/profile.ts 移植：常用资料、同行人、协作授权（membership）。
'use strict'

const { failure, deepClone, genId } = require('./contracts')

function handleProfile(state, command, context) {
  const payload = command.payload
  const userId = command.actor.userId
  if (payload.type === 'membership.save' || payload.type === 'membership.revoke') {
    const activity = state.activities.find(a => a.id === payload.activityId)
    if (!activity) return failure('NOT_FOUND', '找不到本场活动。')
    if (['archived', 'cancelled'].indexOf(activity.phase) !== -1) return failure('WRONG_PHASE', '已结束的活动不能修改工作授权。')
    if (payload.type === 'membership.revoke') {
      state.memberships = state.memberships.filter(m => m.id !== payload.membershipId)
      return { ok: true, value: [payload.membershipId] }
    }
    const membership = payload.membership
    if (Date.parse(membership.expiresAt) <= Date.parse(context.now)) return failure('INVALID_INPUT', '授权结束时间必须晚于当前时间。')
    if (!state.profiles.some(p => p.id === membership.userId)) return failure('NOT_FOUND', '找不到被授权的账号。请对方在「我的」页复制身份码给你。')
    if (membership.role === 'staff' && (!membership.capabilities.length || new Set(membership.capabilities).size !== membership.capabilities.length
      || (membership.scope.kind === 'selected' && !membership.scope.signupIds.length))) {
      return failure('INVALID_INPUT', '请选择工作能力和有效的分管范围。')
    }
    state.memberships = state.memberships.filter(m => m.id !== membership.id
      && !(membership.role === 'vehicle_contact' && m.role === 'vehicle_contact' && m.activityId === membership.activityId && m.vehicleId === membership.vehicleId))
    state.memberships.push(deepClone(membership))
    return { ok: true, value: [membership.id] }
  }
  let profile = state.profiles.find(p => p.id === userId)
  if (payload.type === 'profile.save' || payload.type === 'companion.save') {
    const person = deepClone(payload.person)
    person.name = person.name.trim()
    person.phone = person.phone.trim()
    person.emergency.name = person.emergency.name.trim()
    person.emergency.phone = person.emergency.phone.trim()
    if (!person.name || !person.phone) {
      return failure('INVALID_INPUT', '请填写姓名与联系电话。', {
        name: person.name ? '' : '请填写姓名',
        phone: person.phone ? '' : '请填写联系电话',
      })
    }
    if (payload.type === 'profile.save') {
      if (!profile) {
        profile = { id: userId, person, companions: [] }
        state.profiles.push(profile)
      } else profile.person = person
      return { ok: true, value: [userId] }
    }
    if (!profile) return failure('NOT_FOUND', '请先保存当前账号资料。')
    const id = payload.companionId || context.id('companion')
    const companion = profile.companions.find(c => c.id === id)
    if (companion) companion.person = person
    else profile.companions.push({ id, person })
    return { ok: true, value: [id] }
  }
  if (payload.type === 'companion.remove' && profile) {
    profile.companions = profile.companions.filter(c => c.id !== payload.companionId)
    return { ok: true, value: [payload.companionId] }
  }
  return failure('INVALID_INPUT', '不是有效的资料操作。')
}

// membership.id 由服务端保证存在（客户端可不传）。
function ensureMembershipId(payload) {
  // 这是「校验之前」的归一化步骤，所以它必须对任意入参都成立：曾经直接读 payload.membership.id，
  // 于是 membership.save 带 null/缺字段时抛 TypeError，被 main 当成 INVALID_INPUT 原文（英文）返回给用户。
  // 缺什么就由 schema 校验说什么——授权与校验的顺序不能反过来。
  const membership = payload && payload.membership
  if (payload && payload.type === 'membership.save' && membership && !membership.id) {
    payload.membership = Object.assign({}, membership, { id: genId('membership') })
  }
  return payload
}

module.exports = { handleProfile, ensureMembershipId }

// 由原型 domain/commands.ts 移植：命令调度、幂等回执、版本 CAS、事件与通知自动发布。
'use strict'

const S = require('./schema')
const { failure, deepClone, genId } = require('./contracts')
const { canExecute } = require('./permissions')
const { assertInvariants } = require('./invariants')
const { handleActivity } = require('./activity')
const { handleSignup } = require('./signup')
const { handleTransport } = require('./transport')
const { handleField } = require('./field')
const { handleProfile, ensureMembershipId } = require('./profile')
const { handleNotices } = require('./notices')

const summaries = {
  'activity.create': '活动草稿已保存', 'activity.edit': '活动说明与安排已更新', 'activity.copy': '已复制为新的活动草稿',
  'activity.publish': '活动已发布', 'activity.transition': '活动阶段已更新', 'activity.delete': '活动草稿已删除',
  'signup.submit': '新的报名已收到', 'signup.review': '报名审核结果已更新', 'signup.promote': '候补已转为待确认',
  'signup.cancel': '报名资格已取消或移除', 'signup.edit': '报名资料与出行安排已更新', 'group.setTogether': '同行安排要求已更新',
  'vehicle.save': '车辆安排已更新', 'vehicle.remove': '车辆已移除', 'assignment.commit': '分车方案已保存',
  'assignment.set': '乘车安排已更新', 'assignment.remove': '乘车安排已解除', 'assignment.swap': '座位已交换',
  'membership.save': '活动工作授权已更新', 'membership.revoke': '活动工作授权已撤销',
  'attendance.checkin': '已记录到达集合点', 'attendance.board': '已更新本程上车记录', 'attendance.departure': '已核实出发情况',
  'attendance.returnPlan': '返程计划已更新', 'attendance.node': '已记录到达路线节点', 'attendance.home': '已确认安全到家',
  'vehicle.depart': '本程车辆已发车', 'vehicle.complete': '本程车辆行驶已完成',
  'position.report': '已主动上报一次位置', 'position.revoke': '位置授权已撤回',
  'incident.report': '收到现场情况报备', 'incident.resolve': '现场情况已核实处理',
  'notice.publish': '站内通知已发布', 'notice.read': '已阅读站内通知', 'notice.delivery': '已记录通知渠道结果',
  'export.record': '已记录名单导出用途', 'profile.save': '常用资料已保存', 'companion.save': '常用同行人已保存', 'companion.remove': '常用同行人已移除',
}

function handle(state, command, context) {
  const type = command.payload.type
  switch (type) {
    case 'activity.create': case 'activity.edit': case 'activity.copy': case 'activity.publish': case 'activity.transition': case 'activity.delete':
      return handleActivity(state, command, context)
    case 'signup.submit': case 'signup.review': case 'signup.promote': case 'signup.cancel': case 'signup.edit': case 'group.setTogether':
      return handleSignup(state, command, context)
    case 'vehicle.save': case 'vehicle.remove': case 'assignment.commit': case 'assignment.set': case 'assignment.remove': case 'assignment.swap':
      return handleTransport(state, command, context)
    case 'attendance.checkin': case 'attendance.board': case 'attendance.departure': case 'attendance.returnPlan': case 'attendance.node': case 'attendance.home':
    case 'vehicle.depart': case 'vehicle.complete': case 'position.report': case 'position.revoke': case 'incident.report': case 'incident.resolve':
      return handleField(state, command, context)
    case 'profile.save': case 'companion.save': case 'companion.remove': case 'membership.save': case 'membership.revoke':
      return handleProfile(state, command, context)
    case 'notice.publish': case 'notice.read': case 'notice.delivery': case 'export.record':
      return handleNotices(state, command, context)
    default:
      return failure('INVALID_INPUT', '不支持此操作。')
  }
}

function recordChange(before, after, command, targetIds, context) {
  const p = command.payload
  const activityId = p.type === 'activity.create' || p.type === 'activity.copy' ? targetIds[0] : ('activityId' in p ? p.activityId : null)
  // activity.delete：活动已随之移除，事件无处挂靠（且草稿无受众），不记录变更事件
  if (!activityId || p.type === 'notice.read' || p.type === 'activity.delete') return
  const eventId = context.id('event')
  const summary = p.type === 'export.record'
    ? (p.mode === 'sensitive' ? '敏感' : '普通') + '名单导出：' + (p.purpose.trim() || '活动人员核对')
    : p.type === 'activity.transition' ? summaries[p.type] + '：' + p.reason.trim() : summaries[p.type]
  const subjectIds = targetIds.filter(id => after.signups.some(s => s.id === id))
  after.events.push({ id: eventId, activityId, kind: p.type, actorId: command.actor.userId, subjectIds, occurredAt: context.now, summary })
  if (p.type === 'notice.publish') {
    const notice = after.notices.find(n => n.id === targetIds[0])
    if (notice) notice.sourceEventId = eventId
    return
  }
  let audience = null
  if (['activity.publish', 'activity.edit', 'activity.transition'].indexOf(p.type) !== -1) audience = { kind: 'activity' }
  if (p.type.indexOf('signup.') === 0 || p.type.indexOf('assignment.') === 0) {
    const ids = new Set(subjectIds)
    for (const signup of after.signups.filter(s => s.activityId === activityId)) {
      const old = before.assignments.find(a => a.signupId === signup.id)
      const next = after.assignments.find(a => a.signupId === signup.id)
      if (!old !== !next || (old && next && (old.vehicleId !== next.vehicleId || old.seatLabel !== next.seatLabel))) ids.add(signup.id)
    }
    if (ids.size) audience = { kind: 'signups', signupIds: Array.from(ids) }
  }
  if (audience) {
    after.notices.push({
      id: context.id('notice'), activityId, audience, sourceEventId: eventId,
      content: summaries[p.type] + '，请打开活动查看最新安排。', publishedAt: context.now, readBy: {}, deliveries: [],
    })
  }
}

/** 回执上限：只保留最近的回执，幂等窗口之外的重放按新请求处理。 */
function pruneReceipts(state) {
  const LIMIT = 600
  if (state.receipts.length > LIMIT) {
    state.receipts = state.receipts.slice(state.receipts.length - LIMIT)
  }
}

/**
 * 输入 command: { actor, requestId, expectedRevision, fingerprint, payload }
 * context: { now, id(kind) }
 * 返回 { ok, value: { state, targetIds, replayed } } 或 { ok:false, error }
 */
function reduceCommand(state, input, context) {
  const payload = ensureMembershipId(input.payload)
  const command = {
    actor: input.actor, requestId: input.requestId,
    expectedRevision: input.expectedRevision, fingerprint: input.fingerprint, payload,
  }
  if (!S.validate(S.Command, command)
    || !S.validate(S.specInstant, context.now)) {
    return failure('INVALID_INPUT', '操作字段不完整或格式不正确。')
  }
  if (!/^[a-f0-9]{64}$/.test(input.fingerprint)) {
    return failure('INVALID_INPUT', '操作字段不完整或格式不正确。')
  }
  const permission = canExecute(state, command.actor, command.payload, context.now)
  if (!permission.ok) return permission
  const receipt = state.receipts.find(r => r.actorId === command.actor.userId && r.requestId === command.requestId)
  if (receipt) {
    return receipt.fingerprint === command.fingerprint
      ? { ok: true, value: { state, targetIds: receipt.targetIds.slice(), replayed: true } }
      : failure('REQUEST_REUSED', '此请求号已用于另一份内容，请重新提交当前输入。')
  }
  if (state.revision !== command.expectedRevision) return failure('CONFLICT', '安排已更新，本次修改没有保存。请核对最新状态后重新提交。')
  const candidate = deepClone(state)
  const result = handle(candidate, command, context)
  if (!result.ok) return result
  recordChange(state, candidate, command, result.value, context)
  candidate.revision += 1
  candidate.savedAt = context.now
  candidate.receipts.push({
    actorId: command.actor.userId, requestId: command.requestId, fingerprint: command.fingerprint,
    targetIds: result.value.slice(), appliedAt: context.now,
  })
  pruneReceipts(candidate)
  // 事件与通知也限量，防止状态无限膨胀
  if (candidate.events.length > 800) candidate.events = candidate.events.slice(candidate.events.length - 800)
  if (candidate.notices.length > 800) candidate.notices = candidate.notices.slice(candidate.notices.length - 800)
  const valid = assertInvariants(candidate)
  if (!valid.ok) return valid
  return { ok: true, value: { state: candidate, targetIds: result.value, replayed: false } }
}

module.exports = { reduceCommand, genId }

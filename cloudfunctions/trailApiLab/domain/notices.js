// 由原型 domain/notices.ts 移植：站内通知发布/已读/渠道结果、导出审计。
'use strict'

const { failure } = require('./contracts')

function handleNotices(state, command, context) {
  const payload = command.payload
  if (!('activityId' in payload)) return failure('INVALID_INPUT', '通知操作缺少活动。')
  const activity = state.activities.find(a => a.id === payload.activityId)
  if (!activity) return failure('NOT_FOUND', '找不到本场活动。')
  if (payload.type !== 'notice.read' && payload.type !== 'export.record' && ['archived', 'cancelled'].indexOf(activity.phase) !== -1) {
    return failure('WRONG_PHASE', '已结束活动的通知记录只读。')
  }
  switch (payload.type) {
    case 'notice.publish': {
      if (!payload.content.trim()) return failure('INVALID_INPUT', '请填写通知内容。')
      if (payload.audience.kind === 'signups' && new Set(payload.audience.signupIds).size !== payload.audience.signupIds.length) return failure('INVALID_INPUT', '通知接收人不能重复。')
      const id = context.id('notice')
      state.notices.push({
        id, activityId: payload.activityId, audience: JSON.parse(JSON.stringify(payload.audience)), sourceEventId: null,
        content: payload.content.trim(), publishedAt: context.now, readBy: {}, deliveries: [],
      })
      return { ok: true, value: [id] }
    }
    case 'notice.read': {
      const notice = state.notices.find(n => n.id === payload.noticeId)
      if (!notice) return failure('NOT_FOUND', '找不到此通知。')
      if (!notice.readBy[command.actor.userId]) notice.readBy[command.actor.userId] = context.now
      return { ok: true, value: [notice.id] }
    }
    case 'notice.delivery': {
      if ((payload.channel === 'copy' && ['copied', 'failed'].indexOf(payload.status) === -1)
        || (payload.channel === 'subscription_simulation' && payload.status === 'copied')) {
        return failure('INVALID_INPUT', '投递结果与所选渠道不一致。')
      }
      const notice = state.notices.find(n => n.id === payload.noticeId)
      if (!notice) return failure('NOT_FOUND', '找不到此通知。')
      notice.deliveries.push({ id: context.id('delivery'), channel: payload.channel, status: payload.status, at: context.now, by: command.actor.userId, detail: payload.detail })
      return { ok: true, value: [notice.id] }
    }
    case 'export.record':
      if (!payload.signupIds.length || new Set(payload.signupIds).size !== payload.signupIds.length
        || (payload.mode === 'sensitive' && !payload.purpose.trim())) {
        return failure('INVALID_INPUT', '请选择导出人员，敏感导出还需填写用途。')
      }
      return { ok: true, value: payload.signupIds.slice() }
    default:
      return failure('INVALID_INPUT', '不是有效的通知操作。')
  }
}

module.exports = { handleNotices }

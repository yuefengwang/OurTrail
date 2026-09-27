import type { Command, Context, Result } from './contracts';
import type { State } from './model';

export function handleNotices(state: State, command: Command, context: Context): Result<string[]> {
  const payload = command.payload;
  if (!('activityId' in payload)) return { ok: false, error: { code: 'INVALID_INPUT', message: '通知操作缺少活动。' } };
  const activity = state.activities.find(a => a.id === payload.activityId)!;
  if (payload.type !== 'notice.read' && payload.type !== 'export.record' && ['archived', 'cancelled'].includes(activity.phase)) {
    return { ok: false, error: { code: 'WRONG_PHASE', message: '已结束活动的通知记录只读。' } };
  }
  switch (payload.type) {
    case 'notice.publish': {
      if (!payload.content.trim()) return { ok: false, error: { code: 'INVALID_INPUT', message: '请填写通知内容。' } };
      if (payload.audience.kind === 'signups' && new Set(payload.audience.signupIds).size !== payload.audience.signupIds.length) return { ok: false, error: { code: 'INVALID_INPUT', message: '通知接收人不能重复。' } };
      const id = context.id('notice');
      state.notices.push({ id, activityId: payload.activityId, audience: structuredClone(payload.audience), sourceEventId: null,
        content: payload.content.trim(), publishedAt: context.now, readBy: {}, deliveries: [] });
      return { ok: true, value: [id] };
    }
    case 'notice.read': {
      const notice = state.notices.find(n => n.id === payload.noticeId)!;
      notice.readBy[command.actor.userId!] ??= context.now;
      return { ok: true, value: [notice.id] };
    }
    case 'notice.delivery': {
      if ((payload.channel === 'copy' && !['copied', 'failed'].includes(payload.status)) || (payload.channel === 'subscription_simulation' && payload.status === 'copied')) {
        return { ok: false, error: { code: 'INVALID_INPUT', message: '投递结果与所选渠道不一致。' } };
      }
      const notice = state.notices.find(n => n.id === payload.noticeId)!;
      notice.deliveries.push({ id: context.id('delivery'), channel: payload.channel, status: payload.status, at: context.now, by: command.actor.userId!, detail: payload.detail });
      return { ok: true, value: [notice.id] };
    }
    case 'export.record':
      if (!payload.signupIds.length || new Set(payload.signupIds).size !== payload.signupIds.length || (payload.mode === 'sensitive' && !payload.purpose.trim())) {
        return { ok: false, error: { code: 'INVALID_INPUT', message: '请选择导出人员，敏感导出还需填写用途。' } };
      }
      return { ok: true, value: [...payload.signupIds] };
    default:
      return { ok: false, error: { code: 'INVALID_INPUT', message: '不是有效的通知操作。' } };
  }
}

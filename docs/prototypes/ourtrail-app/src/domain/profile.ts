import type { Command, Context, Result } from './contracts';
import type { State } from './model';

export function handleProfile(state: State, command: Command, context: Context): Result<string[]> {
  const payload = command.payload;
  const userId = command.actor.userId!;
  if (payload.type === 'membership.save' || payload.type === 'membership.revoke') {
    const activity = state.activities.find(a => a.id === payload.activityId)!;
    if (['archived', 'cancelled'].includes(activity.phase)) return { ok: false, error: { code: 'WRONG_PHASE', message: '已结束的活动不能修改工作授权。' } };
    if (payload.type === 'membership.revoke') {
      state.memberships = state.memberships.filter(m => m.id !== payload.membershipId);
      return { ok: true, value: [payload.membershipId] };
    }
    const membership = payload.membership;
    if (Date.parse(membership.expiresAt) <= Date.parse(context.now)) return { ok: false, error: { code: 'INVALID_INPUT', message: '授权结束时间必须晚于当前时间。' } };
    if (!state.profiles.some(p => p.id === membership.userId)) return { ok: false, error: { code: 'NOT_FOUND', message: '找不到被授权的演示账号。' } };
    if (membership.role === 'staff' && (!membership.capabilities.length || new Set(membership.capabilities).size !== membership.capabilities.length || (membership.scope.kind === 'selected' && !membership.scope.signupIds.length))) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: '请选择工作能力和有效的分管范围。' } };
    }
    state.memberships = state.memberships.filter(m => m.id !== membership.id && !(membership.role === 'vehicle_contact' && m.role === 'vehicle_contact' && m.activityId === membership.activityId && m.vehicleId === membership.vehicleId));
    state.memberships.push(structuredClone(membership));
    return { ok: true, value: [membership.id] };
  }
  let profile = state.profiles.find(p => p.id === userId);
  if (payload.type === 'profile.save' || payload.type === 'companion.save') {
    const person = structuredClone(payload.person);
    person.name = person.name.trim();
    person.phone = person.phone.trim();
    person.emergency.name = person.emergency.name.trim();
    person.emergency.phone = person.emergency.phone.trim();
    if (!person.name || !person.phone) return { ok: false, error: { code: 'INVALID_INPUT', message: '请填写姓名与联系电话。', fieldErrors: { name: person.name ? '' : '请填写姓名', phone: person.phone ? '' : '请填写联系电话' } } };
    if (payload.type === 'profile.save') {
      if (!profile) {
        profile = { id: userId, person, companions: [] };
        state.profiles.push(profile);
      } else profile.person = person;
      return { ok: true, value: [userId] };
    }
    if (!profile) return { ok: false, error: { code: 'NOT_FOUND', message: '请先保存当前账号资料。' } };
    const id = payload.companionId ?? context.id('companion');
    const companion = profile.companions.find(c => c.id === id);
    if (companion) companion.person = person;
    else profile.companions.push({ id, person });
    return { ok: true, value: [id] };
  }
  if (payload.type === 'companion.remove' && profile) {
    profile.companions = profile.companions.filter(c => c.id !== payload.companionId);
    return { ok: true, value: [payload.companionId] };
  }
  return { ok: false, error: { code: 'INVALID_INPUT', message: '不是有效的资料操作。' } };
}

import { ActivityInputSchema, type ActivityInput, type Command, type Context, type ErrorCode, type Result } from './contracts';
import type { ActivityRecord, State } from './model';
import { registerParticipants } from './signup';
import { isCurrentSignup } from './permissions';

const fail = (code: ErrorCode, message: string): Result<never> => ({ ok: false, error: { code, message } });
const success = (ids: string[]): Result<string[]> => ({ ok: true, value: ids });
const unique = (ids: string[]) => new Set(ids).size === ids.length;

function validateInput(state: State, ownerId: string, input: ActivityInput, full: boolean, activityId?: string): Result<null> {
  if (!ActivityInputSchema.safeParse(input).success) return fail('INVALID_INPUT', '活动字段不完整或格式不正确。');
  if (input.routeId && !state.routes.some(r => r.id === input.routeId && r.ownerId === ownerId)) return fail('FORBIDDEN', '请选择当前发起者自己的私有路线。');
  if (!unique(input.pickupPoints.map(p => p.id)) || !unique(input.routeSnapshot.points.map(p => p.id)) || !unique(input.routeSnapshot.risks.map(r => r.id))) {
    return fail('INVALID_INPUT', '集合点、路线节点与风险标识不能重复。');
  }
  if (full) {
    if (!input.title.trim() || !input.routeSnapshot.title.trim() || !input.startAt || !input.endAt || !input.deadlineAt
      || !input.pickupPoints.length || !input.routeSnapshot.points.length || !input.routeSnapshot.risks.length
      || input.pickupPoints.some(p => !p.name.trim() || !p.address.trim() || !p.meetingAt)
      || input.routeSnapshot.points.some(p => !p.name.trim())
      || input.routeSnapshot.risks.some(r => !r.title.trim() || !r.advice.trim())) {
      return fail('INVALID_INPUT', '发布需要完整的标题、活动时间、集合信息、路线节点与风险说明。');
    }
    if (Date.parse(input.deadlineAt) > Date.parse(input.startAt) || Date.parse(input.startAt) >= Date.parse(input.endAt)) {
      return fail('INVALID_INPUT', '截止时间不能晚于开始时间，结束时间必须晚于开始时间。');
    }
  }
  if (activityId) {
    const roster = state.signups.filter(s => s.activityId === activityId);
    if (roster.filter(s => s.status === 'pending' || s.status === 'confirmed').length > input.capacity) return fail('CAPACITY', '活动名额不能低于待确认和已确认总人数。');
    const pickups = new Set(input.pickupPoints.map(p => p.id));
    if (roster.some(s => s.trip.mode === 'shared' && !pickups.has(s.trip.pickupPointId))
      || state.vehicles.some(v => v.activityId === activityId && v.pickupPointIds.some(id => !pickups.has(id)))) {
      return fail('INVALID_INPUT', '已有报名或车辆引用的上车点不能删除。');
    }
    const signupIds = new Set(roster.map(s => s.id));
    const points = new Set(input.routeSnapshot.points.map(p => p.id));
    if (state.attendance.some(a => signupIds.has(a.signupId) && a.nodes.some(n => !points.has(n.pointId)))) {
      return fail('INVALID_INPUT', '已有履约记录引用的路线节点不能删除。');
    }
  }
  return { ok: true, value: null };
}

/** Saving an ad-hoc route stores a private source; future edits remain activity snapshots. */
function persistPrivateRoute(state: State, activity: ActivityRecord, context: Context) {
  const route = activity.routeSnapshot;
  if (activity.routeId === null && (route.title.trim() || route.points.length || route.risks.length)) {
    const id = context.id('route');
    state.routes.push({ ...structuredClone(route), id, ownerId: activity.ownerId });
    activity.routeId = id;
  }
}

export function handleActivity(state: State, command: Command, context: Context): Result<string[]> {
  const p = command.payload;
  if (!['activity.create', 'activity.edit', 'activity.copy', 'activity.publish', 'activity.transition'].includes(p.type)) {
    return fail('INVALID_INPUT', '此活动处理器不支持该操作。');
  }
  const actorId = command.actor.userId;
  if (!actorId) return fail('AUTH_REQUIRED', '请先选择当前账号。');

  if (p.type === 'activity.create') {
    const valid = validateInput(state, actorId, p.input, false);
    if (!valid.ok) return valid;
    const activity: ActivityRecord = { ...structuredClone(p.input), id: context.id('activity'), ownerId: actorId, phase: 'draft', acceptingSignups: false };
    persistPrivateRoute(state, activity, context);
    state.activities.push(activity);
    return success([activity.id]);
  }
  const activityId = p.type === 'activity.copy' ? p.sourceActivityId : 'activityId' in p ? p.activityId : null;
  const activity = state.activities.find(a => a.id === activityId);
  if (!activity) return fail('NOT_FOUND', '找不到本场活动。');

  switch (p.type) {
    case 'activity.copy': {
      const copy: ActivityRecord = {
        ...structuredClone(activity), id: context.id('activity'), ownerId: actorId, phase: 'draft', acceptingSignups: false,
        startAt: null, endAt: null, deadlineAt: null,
        pickupPoints: activity.pickupPoints.map(point => ({ ...structuredClone(point), meetingAt: null })),
      };
      if (copy.ownerId !== activity.ownerId) copy.routeId = null;
      persistPrivateRoute(state, copy, context);
      state.activities.push(copy);
      return success([copy.id]);
    }
    case 'activity.edit': {
      if (['closing', 'archived', 'cancelled'].includes(activity.phase)) return fail('WRONG_PHASE', '结束核验、归档或取消后，活动内容为只读。');
      const parsed = ActivityInputSchema.safeParse(p.input);
      if (!parsed.success) return fail('INVALID_INPUT', '活动字段不完整或格式不正确。');
      const input = parsed.data;
      if (activity.phase === 'gathering' || activity.phase === 'active') {
        const lockedKeys = ['title', 'startAt', 'deadlineAt', 'acceptingSignups', 'capacity', 'approvalMode', 'routeId', 'routeSnapshot', 'pickupPoints'] as const;
        if (lockedKeys.some(key => JSON.stringify(input[key]) !== JSON.stringify(activity[key]))
          || !input.endAt || !activity.endAt || Date.parse(input.endAt) < Date.parse(activity.endAt)) {
          return fail('WRONG_PHASE', '集合或行程中仅可修改说明、装备、费用和取消说明，并延长结束时间。');
        }
      }
      const valid = validateInput(state, activity.ownerId, input, activity.phase !== 'draft', activity.id);
      if (!valid.ok) return valid;
      Object.assign(activity, input);
      if (activity.phase === 'draft') activity.acceptingSignups = false;
      persistPrivateRoute(state, activity, context);
      return success([activity.id]);
    }
    case 'activity.publish': {
      if (activity.phase !== 'draft') return fail('WRONG_PHASE', '只有草稿活动可以发布。');
      const { id, ownerId, phase, ...input } = activity;
      const valid = validateInput(state, ownerId, input, true, id);
      if (!valid.ok) return valid;
      const targets = [activity.id];
      if (p.participation) {
        if (p.participation.personRef.kind !== 'user' || p.participation.personRef.userId !== actorId || actorId !== ownerId) {
          return fail('INVALID_INPUT', '发布时只能明确选择发起者本人参与，不能代同行人加入。');
        }
        const registered = registerParticipants(state, activity, [p.participation], actorId, true, 'confirmed', context);
        if (!registered.ok) return registered;
        targets.push(...registered.value);
      }
      persistPrivateRoute(state, activity, context);
      activity.phase = 'published';
      activity.acceptingSignups = true;
      return success(targets);
    }
    case 'activity.transition': {
      const roster = state.signups.filter(s => s.activityId === activity.id);
      const confirmed = roster.filter(s => s.status === 'confirmed');
      const ids = new Set(roster.map(s => s.id));
      const records = state.attendance.filter(a => ids.has(a.signupId));
      if (p.next === 'cancelled') {
        if (!['draft', 'published', 'gathering'].includes(activity.phase)) return fail('WRONG_PHASE', '只能在出发前取消活动。');
        if (records.some(a => a.departure?.kind === 'joined' || a.boardingByLeg.outbound || a.boardingByLeg.return || a.home)
          || state.vehicles.some(v => v.activityId === activity.id && (v.legs.outbound.departed || v.legs.return.departed || v.legs.outbound.completed || v.legs.return.completed))) {
          return fail('UNRESOLVED_SAFETY', '已有出发或上车事实，不能取消活动并移除乘车关联。');
        }
        // A driver remains a confirmed signup under the shared invariants. Do not erase or rewrite that relationship.
        if (state.vehicles.some(v => v.activityId === activity.id && v.drivers.some(d => d.kind === 'participant'))) return fail('DRIVER_CONFLICT', '取消前请先更换参与者司机。');
        roster.filter(isCurrentSignup).forEach(s => { s.status = 'cancelled'; });
        state.assignments = state.assignments.filter(a => a.activityId !== activity.id);
        state.positions.forEach(position => {
          if (ids.has(position.signupId) && position.revokedAt === null) position.revokedAt = context.now;
        });
        activity.phase = 'cancelled';
        activity.acceptingSignups = false;
        return success([activity.id]);
      }
      if (activity.phase === 'published' && p.next === 'gathering') {
        if (roster.some(s => s.status === 'pending')) return fail('UNRESOLVED_DEPARTURE', '请先处理所有待确认报名，再开始集合。');
      } else if (activity.phase === 'gathering' && p.next === 'active') {
        for (const signup of confirmed) {
          const record = records.find(a => a.signupId === signup.id);
          if (!record?.departure) return fail('UNRESOLVED_DEPARTURE', '请逐一核实已确认参与者的出发情况。');
          const participantDriver = state.vehicles.some(v => v.activityId === activity.id && v.drivers.some(d => d.kind === 'participant' && d.signupId === signup.id));
          if (record.departure.kind === 'joined' && (!record.checkIn || (signup.trip.mode === 'shared' && !participantDriver && !record.boardingByLeg.outbound))) {
            return fail('UNRESOLVED_DEPARTURE', '实际出行者需要签到；拼车乘客还需要去程上车确认。');
          }
        }
        for (const signup of confirmed) {
          const record = records.find(a => a.signupId === signup.id)!;
          if (record.departure?.kind === 'coordinating'
            && !state.incidents.some(i => i.activityId === activity.id && i.kind === 'late' && i.subjectIds.includes(signup.id) && i.resolution === null)) {
            state.incidents.push({
              id: context.id('incident'), activityId: activity.id, subjectIds: [signup.id], kind: 'late',
              description: '出发情况仍在协调，请继续核实人员去向。',
              opened: { at: context.now, by: actorId, note: '开始行程时仍在协调，保留未解决的迟到异常。' }, resolution: null,
            });
          }
        }
      } else if (activity.phase === 'active' && p.next === 'closing') {
        if (!p.reason.trim()) return fail('INVALID_INPUT', '请说明结束行程并进入安全核验的原因。');
      } else if (activity.phase === 'closing' && p.next === 'archived') {
        const unsafe = confirmed.some(signup => {
          const record = records.find(a => a.signupId === signup.id);
          return !record?.departure || record.departure.kind === 'coordinating' || (record.departure.kind === 'joined' && !record.home);
        });
        if (unsafe || state.incidents.some(i => i.activityId === activity.id && i.resolution === null)) return fail('UNRESOLVED_SAFETY', '仍有出发情况、到家或异常未核实，不能归档。');
      } else {
        return fail('WRONG_PHASE', '不允许跳过或回退活动阶段；草稿请使用发布操作。');
      }
      activity.phase = p.next;
      activity.acceptingSignups = false;
      return success([activity.id]);
    }
    default: return fail('INVALID_INPUT', '此活动处理器不支持该操作。');
  }
}

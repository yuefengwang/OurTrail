import { ParticipantInputSchema, type Command, type Context, type ErrorCode, type ParticipantInput, type Result } from './contracts';
import { PersonSchema, TripSchema, type ActivityRecord, type PersonRecord, type SignupRecord, type State, type Trip } from './model';
import { isCurrentSignup, isOwnSignup, requireSignups } from './permissions';

const fail = (code: ErrorCode, message: string): Result<never> => ({ ok: false, error: { code, message } });
const success = (ids: string[]): Result<string[]> => ({ ok: true, value: ids });
const occupied = (state: State, activityId: string) => state.signups.filter(s => s.activityId === activityId && (s.status === 'pending' || s.status === 'confirmed')).length;
const personKey = (ref: ParticipantInput['personRef']) => JSON.stringify(ref.kind === 'user' ? ['user', ref.userId] : ['companion', ref.ownerId, ref.companionId]);

function normalizedPerson(input: PersonRecord): Result<PersonRecord> {
  const parsed = PersonSchema.safeParse(input);
  if (!parsed.success) return fail('INVALID_INPUT', '参与者资料格式不正确。');
  const person = parsed.data;
  person.name = person.name.trim();
  person.phone = person.phone.trim();
  person.emergency.name = person.emergency.name.trim();
  person.emergency.phone = person.emergency.phone.trim();
  person.medical = person.medical.trim();
  if (!person.name || !person.phone || !person.emergency.name || !person.emergency.phone) {
    return fail('INVALID_INPUT', '请填写参与者姓名、电话及紧急联系人姓名和电话。');
  }
  return { ok: true, value: person };
}

function validTrip(activity: ActivityRecord, trip: Trip): boolean {
  return TripSchema.safeParse(trip).success
    && (trip.mode === 'self' || activity.pickupPoints.some(point => point.id === trip.pickupPointId));
}

/** Shared by submission and explicit owner participation; validates the whole batch before writing. */
export function registerParticipants(
  state: State, activity: ActivityRecord, inputs: ParticipantInput[], userId: string,
  keepTogether: boolean, status: 'pending' | 'confirmed' | 'waitlisted', context: Context,
): Result<string[]> {
  if (!inputs.length) return fail('INVALID_INPUT', '请至少选择一位参与者。');
  const profile = state.profiles.find(p => p.id === userId);
  if (!profile) return fail('NOT_FOUND', '当前账号资料不存在。');
  const keys = new Set(state.signups.filter(s => s.activityId === activity.id && isCurrentSignup(s)).map(s => personKey(s.personRef)));
  const prepared: ParticipantInput[] = [];
  for (const input of inputs) {
    const parsed = ParticipantInputSchema.safeParse(input);
    if (!parsed.success) return fail('INVALID_INPUT', '报名资料格式不正确。');
    const item = parsed.data;
    const ref = item.personRef;
    if (ref.kind === 'user' ? ref.userId !== userId : ref.ownerId !== userId || !profile.companions.some(c => c.id === ref.companionId)) {
      return fail('FORBIDDEN', '只能为本人或当前账号已有的同行人报名。');
    }
    const key = personKey(ref);
    if (keys.has(key)) return fail('DUPLICATE_PERSON', '同一位参与者不能重复报名本场活动。');
    keys.add(key);
    if (!item.consent.dataUse || (ref.kind === 'companion' && !item.consent.proxyAuthority)) {
      return fail('CONSENT_REQUIRED', '每位参与者需要资料使用同意，同行人还需要有效代办授权。');
    }
    const person = normalizedPerson(item.participant);
    if (!person.ok) return person;
    if (!validTrip(activity, item.trip)) return fail('INVALID_INPUT', '请选择本场活动有效的上车点。');
    prepared.push({ ...item, participant: person.value });
  }
  const fits = occupied(state, activity.id) + prepared.length <= activity.capacity;
  if (status !== 'waitlisted' && !fits) {
    return fail('CAPACITY', '剩余名额不足以接收整组参与者，请明确选择候补。');
  }
  if (status === 'waitlisted' && fits) return fail('INVALID_INPUT', '整组仍有名额，请正常提交报名。');
  const groupId = context.id('group');
  const records: SignupRecord[] = prepared.map(input => ({
    id: context.id('signup'), activityId: activity.id, groupId, submittedByUserId: userId,
    personRef: input.personRef, participant: input.participant, trip: input.trip, status,
    consent: { at: context.now, recordedBy: userId, dataUse: true, proxyAuthority: input.consent.proxyAuthority, proxyHome: input.consent.proxyHome },
  }));
  state.groups.push({ id: groupId, activityId: activity.id, submittedByUserId: userId, keepTogether });
  state.signups.push(...records);
  state.attendance.push(...records.map(signup => ({
    signupId: signup.id, checkIn: null, boardingByLeg: { outbound: null, return: null },
    returnPlan: { kind: 'assigned' as const }, departure: null, nodes: [], home: null,
  })));
  return success(records.map(s => s.id));
}

/** Never detach a person from historical boarding or a vehicle that has already moved. */
function travelLocked(state: State, signupId: string): boolean {
  const record = state.attendance.find(a => a.signupId === signupId);
  if (!record || record.departure?.kind === 'joined' || record.boardingByLeg.outbound || record.boardingByLeg.return || record.home) return true;
  const vehicleIds = new Set(state.assignments.filter(a => a.signupId === signupId).map(a => a.vehicleId));
  return state.vehicles.some(v => (vehicleIds.has(v.id) || v.drivers.some(d => d.kind === 'participant' && d.signupId === signupId))
    && (v.legs.outbound.departed !== null || v.legs.return.departed !== null || v.legs.outbound.completed !== null || v.legs.return.completed !== null));
}

export function handleSignup(state: State, command: Command, context: Context): Result<string[]> {
  const p = command.payload;
  if (!['signup.submit', 'signup.review', 'signup.promote', 'signup.cancel', 'signup.edit', 'group.setTogether'].includes(p.type)) {
    return fail('INVALID_INPUT', '此报名处理器不支持该操作。');
  }
  if (!command.actor.userId) return fail('AUTH_REQUIRED', '请先选择当前账号。');
  if (!('activityId' in p)) return fail('INVALID_INPUT', '缺少活动标识。');
  const activity = state.activities.find(a => a.id === p.activityId);
  if (!activity) return fail('NOT_FOUND', '找不到本场活动。');

  switch (p.type) {
    case 'signup.submit': {
      if (activity.phase !== 'published' || !activity.acceptingSignups || !activity.deadlineAt || Date.parse(context.now) >= Date.parse(activity.deadlineAt)) {
        return fail('WRONG_PHASE', '本场活动不在开放报名时段。');
      }
      const status = p.mode === 'waitlist' ? 'waitlisted' : activity.approvalMode === 'automatic' ? 'confirmed' : 'pending';
      return registerParticipants(state, activity, p.participants, command.actor.userId, p.keepTogether, status, context);
    }
    case 'signup.review':
    case 'signup.promote':
    case 'signup.cancel': {
      if (!p.signupIds.length || new Set(p.signupIds).size !== p.signupIds.length) return fail('INVALID_INPUT', '请选择不重复的报名记录。');
      if (p.type === 'signup.cancel' ? !['published', 'gathering'].includes(activity.phase) : activity.phase !== 'published') {
        return fail('WRONG_PHASE', '当前活动阶段不能变更报名资格。');
      }
      const targets = requireSignups(state, activity.id, p.signupIds);
      if (!targets.ok) return targets;
      if (p.type === 'signup.review') {
        if (targets.value.some(s => s.status !== 'pending')) return fail('WRONG_PHASE', '只有待确认报名可以审核。');
        targets.value.forEach(s => { s.status = p.decision === 'confirm' ? 'confirmed' : 'rejected'; });
      } else if (p.type === 'signup.promote') {
        if (targets.value.some(s => s.status !== 'waitlisted')) return fail('WRONG_PHASE', '只有候补报名可以转为待确认。');
        const ids = new Set(p.signupIds);
        for (const signup of targets.value) {
          const group = state.groups.find(g => g.id === signup.groupId);
          if (!group) return fail('INVALID_INPUT', '报名组不存在。');
          if (group.keepTogether && state.signups.some(s => s.groupId === group.id && s.status === 'waitlisted' && !ids.has(s.id))) {
            return fail('GROUP_SCOPE', '请同时递补仍在候补的全部同行组成员，或先明确允许分开。');
          }
        }
        if (occupied(state, activity.id) + targets.value.length > activity.capacity) return fail('CAPACITY', '名额不足，整批候补均未变更。');
        targets.value.forEach(s => { s.status = 'pending'; });
      } else {
        if (targets.value.some(s => !isCurrentSignup(s) || travelLocked(state, s.id))) return fail('WRONG_PHASE', '出发或上车后不能取消报名，请使用现场异常与返程流程。');
        if (targets.value.some(s => state.vehicles.some(v => v.drivers.some(d => d.kind === 'participant' && d.signupId === s.id)))) {
          return fail('DRIVER_CONFLICT', '请先更换参与者司机，再取消该报名。');
        }
        const ids = new Set(p.signupIds);
        targets.value.forEach(s => { s.status = isOwnSignup(s, command.actor) ? 'cancelled' : 'removed'; });
        state.assignments = state.assignments.filter(a => !ids.has(a.signupId));
        state.positions.forEach(position => {
          if (ids.has(position.signupId) && position.revokedAt === null) position.revokedAt = context.now;
        });
      }
      return success([...p.signupIds]);
    }
    case 'signup.edit': {
      const targets = requireSignups(state, activity.id, [p.signupId]);
      if (!targets.ok) return targets;
      const signup = targets.value[0];
      const ordinaryEdit = activity.phase === 'published' && activity.deadlineAt !== null && Date.parse(context.now) < Date.parse(activity.deadlineAt);
      const gatheringCoordination = activity.phase === 'gathering' && command.actor.userId === activity.ownerId;
      if ((!ordinaryEdit && !gatheringCoordination) || !isCurrentSignup(signup) || travelLocked(state, signup.id)) {
        return fail('WRONG_PHASE', '报名资料已锁定，集合时仅发起者可协调尚未出发或上车的人员。');
      }
      const person = normalizedPerson(p.participant);
      if (!person.ok) return person;
      if (!validTrip(activity, p.trip)) return fail('INVALID_INPUT', '请选择本场活动有效的上车点。');
      const tripChanged = signup.trip.mode !== p.trip.mode || (signup.trip.mode === 'shared' && p.trip.mode === 'shared' && signup.trip.pickupPointId !== p.trip.pickupPointId);
      signup.participant = person.value;
      signup.trip = { ...p.trip };
      if (tripChanged) state.assignments = state.assignments.filter(a => a.signupId !== signup.id);
      return success([signup.id]);
    }
    case 'group.setTogether': {
      const group = state.groups.find(g => g.id === p.groupId && g.activityId === activity.id);
      if (!group) return fail('NOT_FOUND', '找不到本场同行组。');
      const members = state.signups.filter(s => s.groupId === group.id && isCurrentSignup(s));
      if (!['published', 'gathering'].includes(activity.phase) || members.some(s => travelLocked(state, s.id))) return fail('WRONG_PHASE', '出发前才能调整同行组安排要求。');
      if (p.keepTogether) {
        const ids = new Set(members.filter(s => s.status === 'confirmed').map(s => s.id));
        if (new Set(state.assignments.filter(a => ids.has(a.signupId)).map(a => a.vehicleId)).size > 1) return fail('GROUP_SCOPE', '同行组已分配到不同车辆，请先协调同车。');
      }
      group.keepTogether = p.keepTogether;
      return success([group.id]);
    }
    default: return fail('INVALID_INPUT', '此报名处理器不支持该操作。');
  }
}

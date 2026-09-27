import type {
  AccessView, ActivityView, Actor, AuthorizedView, NoticeManagementView, Payload,
  PersonRowView, ReadRequest, Result, SensitiveView, SignupFormView, TransportView,
} from './contracts';
import type {
  ActivityRecord, EvidenceRecord, MembershipRecord, NoticeRecord, PersonRecord,
  SignupRecord, State, VehicleRecord,
} from './model';
import {
  authRequired, canExecute, canReadNotice, canReadSensitive, hasProxyConsent, isCurrentSignup,
  isOwnSignup, isOwner, isSelfSignup, permissionDenied, requireActivity, requireSignups,
  staffCan, vehicleCan, workDataAvailable,
} from './permissions';

// Projection boundaries deliberately construct fields instead of copying stored records.
function personView(person: PersonRecord): PersonRecord {
  return { name: person.name, phone: person.phone, emergency: { name: person.emergency.name, phone: person.emergency.phone }, medical: person.medical };
}
function evidenceView(evidence: EvidenceRecord | null): EvidenceRecord | null {
  return evidence ? { at: evidence.at, by: evidence.by, note: evidence.note } : null;
}
function activityView(activity: ActivityRecord): ActivityRecord {
  return {
    id: activity.id, ownerId: activity.ownerId, title: activity.title, description: activity.description,
    organizerIntro: activity.organizerIntro, startAt: activity.startAt, endAt: activity.endAt,
    deadlineAt: activity.deadlineAt, phase: activity.phase, acceptingSignups: activity.acceptingSignups,
    capacity: activity.capacity, approvalMode: activity.approvalMode, routeId: activity.routeId,
    routeSnapshot: {
      title: activity.routeSnapshot.title, distanceKm: activity.routeSnapshot.distanceKm, ascentM: activity.routeSnapshot.ascentM,
      points: activity.routeSnapshot.points.map((p) => ({ id: p.id, name: p.name, kind: p.kind, coordinates: p.coordinates ? { lat: p.coordinates.lat, lng: p.coordinates.lng } : null })),
      risks: activity.routeSnapshot.risks.map((r) => ({ id: r.id, title: r.title, advice: r.advice })),
    },
    pickupPoints: activity.pickupPoints.map((p) => ({
      id: p.id, name: p.name, meetingAt: p.meetingAt, address: p.address,
      coordinates: p.coordinates ? { lat: p.coordinates.lat, lng: p.coordinates.lng } : null,
    })),
    equipment: activity.equipment.map((e) => e), feeNote: activity.feeNote, cancellationNote: activity.cancellationNote,
  };
}
function vehicleView(vehicle: VehicleRecord, contacts = true): VehicleRecord {
  return {
    id: vehicle.id, activityId: vehicle.activityId, label: vehicle.label, plate: vehicle.plate,
    legalCapacity: vehicle.legalCapacity, blockedSeats: vehicle.blockedSeats,
    drivers: vehicle.drivers.map((d) => d.kind === 'participant'
      ? { kind: 'participant', signupId: d.signupId }
      : { kind: 'service', name: d.name, phone: contacts ? d.phone : '', userId: d.userId }),
    seatLabels: vehicle.seatLabels?.map((s) => s) ?? null, pickupPointIds: vehicle.pickupPointIds.map((p) => p),
    legs: {
      outbound: { departed: evidenceView(vehicle.legs.outbound.departed), completed: evidenceView(vehicle.legs.outbound.completed) },
      return: { departed: evidenceView(vehicle.legs.return.departed), completed: evidenceView(vehicle.legs.return.completed) },
    },
  };
}
function membershipView(membership: MembershipRecord): MembershipRecord {
  return membership.role === 'staff' ? {
    role: 'staff', id: membership.id, activityId: membership.activityId, userId: membership.userId, expiresAt: membership.expiresAt,
    scope: membership.scope.kind === 'all' ? { kind: 'all' } : { kind: 'selected', signupIds: membership.scope.signupIds.map((id) => id) },
    capabilities: membership.capabilities.map((c) => c),
  } : {
    role: 'vehicle_contact', id: membership.id, activityId: membership.activityId, userId: membership.userId,
    expiresAt: membership.expiresAt, vehicleId: membership.vehicleId,
  };
}
function noticeView(notice: NoticeRecord): NoticeRecord {
  return {
    id: notice.id, activityId: notice.activityId, content: notice.content, publishedAt: notice.publishedAt,
    sourceEventId: notice.sourceEventId,
    audience: notice.audience.kind === 'activity' ? { kind: 'activity' } : notice.audience.kind === 'vehicle'
      ? { kind: 'vehicle', vehicleId: notice.audience.vehicleId }
      : { kind: 'signups', signupIds: notice.audience.signupIds.map((id) => id) },
    readBy: Object.fromEntries(Object.entries(notice.readBy)),
    deliveries: notice.deliveries.map((d) => ({ id: d.id, channel: d.channel, status: d.status, at: d.at, by: d.by, detail: d.detail })),
  };
}
function assignmentFor(state: State, signup: SignupRecord) {
  return state.assignments.find((a) => a.activityId === signup.activityId && a.signupId === signup.id
    && state.vehicles.some((v) => v.activityId === signup.activityId && v.id === a.vehicleId));
}
function participantDriverVehicle(state: State, signup: SignupRecord) {
  return state.vehicles.find((v) => v.activityId === signup.activityId && v.drivers.some((d) => d.kind === 'participant' && d.signupId === signup.id));
}
function rowView(state: State, signup: SignupRecord): PersonRowView {
  const attendance = state.attendance.find((a) => a.signupId === signup.id);
  const assignment = assignmentFor(state, signup);
  const vehicle = state.vehicles.find((v) => v.id === assignment?.vehicleId && v.activityId === signup.activityId) ?? participantDriverVehicle(state, signup);
  const activity = state.activities.find((a) => a.id === signup.activityId);
  return {
    signupId: signup.id, groupId: signup.groupId, name: signup.participant.name, status: signup.status,
    pickup: signup.trip.mode === 'self' ? '自行前往' : activity?.pickupPoints.find((p) => signup.trip.mode === 'shared' && p.id === signup.trip.pickupPointId)?.name ?? '',
    vehicle: vehicle?.label ?? '', seat: assignment?.seatLabel ?? null,
    checkedIn: !!attendance?.checkIn, outboundBoarded: !!attendance?.boardingByLeg.outbound,
    returnBoarded: !!attendance?.boardingByLeg.return, returnPlan: attendance?.returnPlan.kind ?? 'assigned',
    departure: attendance?.departure?.kind ?? 'unknown', home: !!attendance?.home,
  };
}
function ownerPermission(state: State, actor: Actor, activityId: string): Result<null> {
  if (actor.userId === null) return authRequired();
  const exists = requireActivity(state, activityId);
  if (!exists.ok) return exists;
  return isOwner(state, actor, activityId) ? { ok: true, value: null } : permissionDenied('仅活动所有者可管理此资源。');
}

export function selectSensitive(state: State, actor: Actor, activityId: string, signupId: string, purpose: string, now: string): Result<SensitiveView> {
  const permission = canReadSensitive(state, actor, activityId, signupId, purpose, now);
  if (!permission.ok) return permission;
  const person = state.signups.find((s) => s.id === signupId)!.participant;
  return { ok: true, value: { signupId, emergency: { name: person.emergency.name, phone: person.emergency.phone }, medical: person.medical } };
}

export function selectContact(state: State, actor: Actor, activityId: string, signupId: string, now: string): Result<{ name: string; phone: string }> {
  if (actor.userId === null) return authRequired();
  const exists = requireActivity(state, activityId);
  if (!exists.ok) return exists;
  const targets = requireSignups(state, activityId, [signupId]);
  if (!targets.ok) return targets;
  const signup = targets.value[0];
  const assignment = assignmentFor(state, signup);
  const workAllowed = workDataAvailable(state, activityId) && (isOwner(state, actor, activityId)
    || staffCan(state, actor, activityId, 'roster', [signupId], now)
    || (signup.status === 'confirmed' && !!assignment && vehicleCan(state, actor, activityId, assignment.vehicleId, now)));
  if (!isSelfSignup(signup, actor) && !hasProxyConsent(signup, actor) && !workAllowed) return permissionDenied('没有此人的联络权限。');
  return { ok: true, value: { name: signup.participant.name, phone: signup.participant.phone } };
}

export function selectSignupForm(state: State, actor: Actor, activityId: string, signupId: string, purpose: string, now: string): Result<SignupFormView> {
  const permission = canReadSensitive(state, actor, activityId, signupId, purpose, now);
  if (!permission.ok) return permission;
  const signup = state.signups.find((s) => s.id === signupId)!;
  if (!isOwnSignup(signup, actor) && !isOwner(state, actor, activityId)) return permissionDenied('没有编辑此报名的权限。');
  return {
    ok: true, value: {
      signupId, groupId: signup.groupId,
      input: {
        personRef: signup.personRef.kind === 'user' ? { kind: 'user', userId: signup.personRef.userId }
          : { kind: 'companion', ownerId: signup.personRef.ownerId, companionId: signup.personRef.companionId },
        participant: personView(signup.participant),
        trip: signup.trip.mode === 'self' ? { mode: 'self' } : { mode: 'shared', pickupPointId: signup.trip.pickupPointId },
        consent: { dataUse: signup.consent.dataUse, proxyAuthority: signup.consent.proxyAuthority, proxyHome: signup.consent.proxyHome },
      },
    },
  };
}

export function selectTransport(state: State, actor: Actor, activityId: string, _now: string): Result<TransportView> {
  const permission = ownerPermission(state, actor, activityId);
  if (!permission.ok) return permission;
  return { ok: true, value: {
    vehicles: state.vehicles.filter((v) => v.activityId === activityId).map((v) => vehicleView(v, workDataAvailable(state, activityId))),
    assignments: state.assignments.filter((a) => a.activityId === activityId
      && state.signups.some((s) => s.activityId === activityId && s.id === a.signupId)
      && state.vehicles.some((v) => v.activityId === activityId && v.id === a.vehicleId))
      .map((a) => ({ activityId: a.activityId, signupId: a.signupId, vehicleId: a.vehicleId, seatLabel: a.seatLabel })),
    groups: state.groups.filter((g) => g.activityId === activityId).map((g) => ({ id: g.id, keepTogether: g.keepTogether, signupIds: state.signups.filter((s) => s.activityId === activityId && s.groupId === g.id).map((s) => s.id) })),
  } };
}
export function selectAccess(state: State, actor: Actor, activityId: string, _now: string): Result<AccessView> {
  const permission = ownerPermission(state, actor, activityId);
  if (!permission.ok) return permission;
  return { ok: true, value: { memberships: state.memberships.filter((m) => m.activityId === activityId).map(membershipView) } };
}
export function selectNoticeManagement(state: State, actor: Actor, activityId: string, _now: string): Result<NoticeManagementView> {
  const permission = ownerPermission(state, actor, activityId);
  if (!permission.ok) return permission;
  return { ok: true, value: { notices: state.notices.filter((n) => n.activityId === activityId).map(noticeView) } };
}

/** Quote every CSV cell and neutralize formulas even after leading whitespace. */
function csvCell(value: string): string {
  const safe = /^\s*[=+@-]/u.test(value) || /^[\t\r]/u.test(value) || /^\s*[\t\r]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function selectExport(state: State, actor: Actor, activityId: string, signupIds: string[], mode: 'ordinary' | 'sensitive', purpose: string, now: string): Result<string> {
  const permission = canExecute(state, actor, { type: 'export.record', activityId, signupIds, mode, purpose }, now);
  if (!permission.ok) return permission;
  const headers = ['姓名', '报名状态', '上车点', '车辆', '座位', '签到', '去程上车', '返程上车', '到家'];
  if (mode === 'sensitive') headers.push('紧急联系人', '紧急联系电话', '健康备注');
  const statusLabels: Record<SignupRecord['status'], string> = { pending: '待审核', confirmed: '已确认', waitlisted: '候补', rejected: '已拒绝', cancelled: '已取消', removed: '已移除' };
  const cells = [headers];
  for (const id of signupIds) {
    const signup = state.signups.find((s) => s.id === id)!;
    const row = rowView(state, signup);
    const values = [row.name, statusLabels[row.status], row.pickup, row.vehicle, row.seat ?? '', row.checkedIn ? '已签到' : '未签到', row.outboundBoarded ? '已上车' : '未上车', row.returnBoarded ? '已上车' : '未上车', row.home ? '已到家' : '未到家'];
    if (mode === 'sensitive') {
      const sensitive = selectSensitive(state, actor, activityId, id, purpose, now);
      if (!sensitive.ok) return sensitive;
      values.push(sensitive.value.emergency.name, sensitive.value.emergency.phone, sensitive.value.medical);
    }
    cells.push(values);
  }
  return { ok: true, value: cells.map((row) => row.map(csvCell).join(',')).join('\r\n') };
}

function hasStaffMembership(state: State, actor: Actor, activityId: string, now: string): boolean {
  return actor.userId !== null && state.memberships.some((m) => m.role === 'staff' && m.activityId === activityId && m.userId === actor.userId && Date.parse(now) < Date.parse(m.expiresAt));
}
function deniedView(code: 'AUTH_REQUIRED' | 'FORBIDDEN' | 'NOT_FOUND', message: string): AuthorizedView {
  return { kind: 'denied', code, message };
}
function validCoordinates(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function selectView(state: State, actor: Actor, request: ReadRequest, now: string): AuthorizedView {
  if (request.kind === 'profile') {
    if (actor.userId === null) return deniedView('AUTH_REQUIRED', '请先选择当前账号。');
    const profile = state.profiles.find((p) => p.id === actor.userId);
    if (!profile) return deniedView('NOT_FOUND', '找不到当前账号资料。');
    return { kind: 'profile', profile: { id: profile.id, person: personView(profile.person), companions: profile.companions.map((c) => ({ id: c.id, person: personView(c.person) })) } };
  }
  if (request.kind === 'home') {
    return { kind: 'home', activities: state.activities.filter((a) => {
      const owner = isOwner(state, actor, a.id);
      if (a.phase === 'draft') return owner;
      const own = state.signups.some((s) => s.activityId === a.id && isOwnSignup(s, actor));
      const membership = request.perspective === 'staff' ? hasStaffMembership(state, actor, a.id, now)
        : request.perspective === 'vehicle' && state.vehicles.some((v) => vehicleCan(state, actor, a.id, v.id, now));
      return owner || own || membership || request.openedActivityIds.includes(a.id);
    }).map(activityView) };
  }
  if (request.kind === 'notices') {
    if (actor.userId === null) return deniedView('AUTH_REQUIRED', '请先选择当前账号。');
    if (request.activityId && !state.activities.some((a) => a.id === request.activityId)) return deniedView('NOT_FOUND', '找不到此活动。');
    return { kind: 'notices', notices: state.notices.filter((n) => (!request.activityId || n.activityId === request.activityId) && canReadNotice(state, actor, n, now))
      .map((n) => ({ id: n.id, activityId: n.activityId, content: n.content, publishedAt: n.publishedAt, read: Object.hasOwn(n.readBy, actor.userId!) })) };
  }
  if (request.kind !== 'activity') return deniedView('FORBIDDEN', '不支持此读取请求。');
  const activity = state.activities.find((a) => a.id === request.activityId);
  if (!activity) return deniedView('NOT_FOUND', '找不到此活动。');
  const owner = isOwner(state, actor, activity.id);
  if (activity.phase === 'draft' && !owner) return deniedView('FORBIDDEN', '未发布活动仅所有者可见。');
  if (request.perspective === 'organizer' && !owner) return deniedView('FORBIDDEN', '不是此活动的组织者。');
  if (request.perspective === 'staff' && !hasStaffMembership(state, actor, activity.id, now)) return deniedView('FORBIDDEN', '此活动的协作授权不存在或已过期。');
  let vehicle: VehicleRecord | undefined;
  if (request.perspective === 'vehicle') {
    if (request.vehicleId) {
      vehicle = state.vehicles.find((v) => v.id === request.vehicleId);
      if (!vehicle) return deniedView('NOT_FOUND', '找不到此车辆。');
      if (vehicle.activityId !== activity.id) return deniedView('FORBIDDEN', '车辆不属于此活动。');
    } else vehicle = state.vehicles.find((v) => vehicleCan(state, actor, activity.id, v.id, now));
    if (!vehicle || !vehicleCan(state, actor, activity.id, vehicle.id, now)) return deniedView('FORBIDDEN', '没有此车辆的联络权限。');
  }
  const all = state.signups.filter((s) => s.activityId === activity.id);
  const own = all.filter((s) => isOwnSignup(s, actor));
  const primary = own.find((s) => s.id === request.selectedSignupId)
    ?? own.find((s) => isSelfSignup(s, actor) && isCurrentSignup(s))
    ?? [...own].reverse().find((s) => isSelfSignup(s, actor));
  const passengers = vehicle && workDataAvailable(state, activity.id) ? all.filter((s) => s.status === 'confirmed' && assignmentFor(state, s)?.vehicleId === vehicle!.id) : [];
  const visible = request.perspective === 'organizer' ? all
    : request.perspective === 'staff' ? all.filter((s) => staffCan(state, actor, activity.id, 'roster', [s.id], now))
      : request.perspective === 'vehicle' ? passengers : own;
  const rows = visible.map((s) => rowView(state, s));
  const incidents = request.perspective === 'vehicle' ? [] : state.incidents.filter((i) => i.activityId === activity.id
    && i.subjectIds.every((id) => all.some((s) => s.id === id))
    && (request.perspective === 'organizer' || (request.perspective === 'staff'
      ? staffCan(state, actor, activity.id, 'incident', i.subjectIds, now)
      : i.subjectIds.some((id) => own.some((s) => s.id === id)))))
    .map((i) => ({ id: i.id, subjectIds: i.subjectIds.map((id) => id), kind: i.kind, description: i.description, resolved: i.resolution !== null }));
  const positions = request.perspective === 'vehicle' || activity.phase !== 'active' ? [] : state.positions.flatMap((p) => {
    const signup = all.find((s) => s.id === p.signupId);
    if (!signup || signup.status !== 'confirmed' || !signup.consent.dataUse || p.revokedAt !== null
      || !(Date.parse(now) < Date.parse(p.consentExpiresAt)) || !Number.isFinite(Date.parse(p.reportedAt))
      || !validCoordinates(p.coordinates.lat, p.coordinates.lng)) return [];
    const allowed = request.perspective === 'organizer' || (request.perspective === 'staff'
      ? staffCan(state, actor, activity.id, 'position', [signup.id], now)
      : isSelfSignup(signup, actor) || hasProxyConsent(signup, actor));
    return allowed ? [{ signupId: signup.id, name: signup.participant.name, coordinates: { lat: p.coordinates.lat, lng: p.coordinates.lng }, reportedAt: p.reportedAt, stale: Date.parse(now) - Date.parse(p.reportedAt) > 30 * 60_000 }] : [];
  });
  const confirmed = all.filter((s) => s.status === 'confirmed').length;
  const pending = all.filter((s) => s.status === 'pending').length;
  const view: ActivityView = {
    kind: 'activity', activity: activityView(activity), perspective: request.perspective,
    primarySignupId: primary?.id ?? null, rows,
    counters: {
      confirmed, pending, occupied: confirmed + pending, waitlisted: all.filter((s) => s.status === 'waitlisted').length,
      remaining: activity.capacity - confirmed - pending,
      unassigned: visible.filter((s) => s.status === 'confirmed' && s.trip.mode === 'shared' && !assignmentFor(state, s) && !participantDriverVehicle(state, s)).length,
      unchecked: rows.filter((r) => r.status === 'confirmed' && !r.checkedIn).length,
      pendingHome: rows.filter((r) => r.status === 'confirmed' && r.departure === 'joined' && !r.home).length,
      openIncidents: incidents.filter((i) => !i.resolved && i.subjectIds.some((id) => visible.some((s) => s.id === id))).length,
    },
    permittedActions: [],
    vehicleTask: vehicle && workDataAvailable(state, activity.id) ? {
      vehicle: vehicleView(vehicle),
      passengers: passengers.map((s) => {
        const r = rowView(state, s);
        return {
          signupId: r.signupId, groupId: r.groupId, name: r.name, status: r.status, pickup: r.pickup,
          vehicle: r.vehicle, seat: r.seat, checkedIn: r.checkedIn, outboundBoarded: r.outboundBoarded,
          returnBoarded: r.returnBoarded, returnPlan: r.returnPlan, departure: r.departure, home: r.home, phone: s.participant.phone,
        };
      }),
    } : null,
    positions, incidents,
  };
  view.permittedActions = permittedActions(state, actor, view, visible, now);
  return view;
}

function permittedActions(state: State, actor: Actor, view: ActivityView, visible: SignupRecord[], now: string): Payload['type'][] {
  if (actor.userId === null) return [];
  const { id: activityId, phase } = view.activity;
  const actions = new Set<Payload['type']>();
  const add = (payload: Payload) => { if (canExecute(state, actor, payload, now).ok) actions.add(payload.type); };
  const work = phase !== 'archived' && phase !== 'cancelled';
  const organizer = view.perspective === 'organizer';
  if (organizer) {
    actions.add('activity.copy');
    actions.add('export.record');
    if (work) {
      actions.add('activity.edit');
      actions.add('activity.transition');
      actions.add('membership.save');
      actions.add('membership.revoke');
      actions.add('notice.publish');
      actions.add('notice.delivery');
      if (phase === 'draft') actions.add('activity.publish');
      if (phase === 'published' || phase === 'gathering') {
        for (const type of ['signup.review', 'signup.promote', 'vehicle.save', 'vehicle.remove', 'assignment.commit', 'assignment.set', 'assignment.remove', 'assignment.swap'] as const) actions.add(type);
      }
    }
  }
  if (view.perspective === 'participant' && phase === 'published' && view.activity.acceptingSignups
    && (!view.activity.deadlineAt || Date.parse(now) < Date.parse(view.activity.deadlineAt))) actions.add('signup.submit');
  for (const signup of visible) {
    if (work && phase === 'published' && isCurrentSignup(signup)) {
      add({ type: 'signup.cancel', activityId, signupIds: [signup.id], reason: '' });
      add({ type: 'signup.edit', activityId, signupId: signup.id, participant: signup.participant, trip: signup.trip, purpose: '编辑报名资料' });
      add({ type: 'group.setTogether', activityId, groupId: signup.groupId, keepTogether: true });
    }
    if (state.positions.some((p) => p.signupId === signup.id && p.revokedAt === null)) add({ type: 'position.revoke', activityId, signupId: signup.id });
    if (!work || signup.status !== 'confirmed') continue;
    const attendance = state.attendance.find((a) => a.signupId === signup.id)!;
    const lateArrival = phase === 'active' && attendance.departure?.kind === 'coordinating';
    if (phase === 'gathering' || lateArrival) {
      add({ type: 'attendance.checkin', activityId, signupId: signup.id, checkIn: { method: 'manual', evidence: { at: now, by: actor.userId, note: '' } } });
      add({ type: 'attendance.departure', activityId, signupId: signup.id, outcome: { kind: 'joined', evidence: { at: now, by: actor.userId, note: '' } } });
      add({ type: 'attendance.board', activityId, signupId: signup.id, leg: 'outbound', boarded: true, note: '' });
    }
    if (phase === 'active' && attendance.departure?.kind === 'joined') {
      add({ type: 'attendance.node', activityId, signupId: signup.id, pointId: view.activity.routeSnapshot.points[0]?.id ?? '', note: '' });
      add({ type: 'position.report', activityId, signupId: signup.id, coordinates: { lat: 0, lng: 0 }, consent: true });
    }
    if (phase === 'gathering' || phase === 'active' || phase === 'closing') add({ type: 'incident.report', activityId, signupIds: [signup.id], kind: 'other', description: '' });
    if (phase === 'active' || phase === 'closing') {
      add({ type: 'attendance.returnPlan', activityId, signupId: signup.id, plan: 'assigned', note: '' });
      if (attendance.departure?.kind === 'joined' && attendance.returnPlan.kind === 'assigned') add({ type: 'attendance.board', activityId, signupId: signup.id, leg: 'return', boarded: true, note: '' });
      if (phase === 'closing' && attendance.departure?.kind === 'joined' && !attendance.home) add({ type: 'attendance.home', activityId, signupId: signup.id, note: '' });
    }
  }
  if (work && ['gathering', 'active', 'closing'].includes(phase)) {
    for (const incident of view.incidents.filter((i) => !i.resolved)) add({ type: 'incident.resolve', activityId, incidentId: incident.id, note: '' });
    const vehicles = organizer ? state.vehicles.filter((v) => v.activityId === activityId) : view.vehicleTask ? [view.vehicleTask.vehicle] : [];
    for (const vehicle of vehicles) {
      add({ type: 'vehicle.depart', activityId, vehicleId: vehicle.id, leg: phase === 'closing' ? 'return' : 'outbound', note: '' });
      add({ type: 'vehicle.complete', activityId, vehicleId: vehicle.id, leg: phase === 'closing' ? 'return' : 'outbound', note: '' });
    }
  }
  if (state.notices.some((n) => n.activityId === activityId && canReadNotice(state, actor, n, now))) actions.add('notice.read');
  return Array.from(actions);
}

export type DetailState = 'new' | 'pending' | 'confirmed' | 'ready' | 'gathering' | 'checked' | 'active' | 'closing' | 'finished' | 'waitlist' | 'closed' | 'cancelled';
export function getDetailState(view: ActivityView, now: string): DetailState {
  const { activity } = view;
  if (activity.phase === 'cancelled') return 'cancelled';
  if (activity.phase === 'archived') return 'finished';
  const signup = view.rows.find((row) => row.signupId === view.primarySignupId);
  if (signup?.status === 'pending') return 'pending';
  if (signup?.status === 'waitlisted') return 'waitlist';
  if (signup?.status === 'confirmed') {
    if (activity.phase === 'closing') return 'closing';
    if (activity.phase === 'active') return 'active';
    if (activity.phase === 'gathering') return signup.checkedIn ? 'checked' : 'gathering';
    return signup.pickup === '自行前往' || !!signup.vehicle ? 'ready' : 'confirmed';
  }
  return activity.phase === 'published' && activity.acceptingSignups
    && (!activity.deadlineAt || Date.parse(now) < Date.parse(activity.deadlineAt)) ? 'new' : 'closed';
}

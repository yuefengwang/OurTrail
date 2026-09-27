import type { Command, Context, ErrorCode, Result } from './contracts';
import type { EvidenceRecord, State } from './model';
import { isSelfSignup } from './permissions';

const fail = (code: ErrorCode, message: string): Result<never> => ({ ok: false, error: { code, message } });

export function handleField(state: State, command: Command, context: Context): Result<string[]> {
  const p = command.payload;
  if (!('activityId' in p)) return fail('INVALID_INPUT', '现场操作缺少活动。');
  const activity = state.activities.find(a => a.id === p.activityId)!;
  const phase = activity.phase;
  const evidence = (note: string): EvidenceRecord => ({ at: context.now, by: command.actor.userId!, note: note.trim() });
  const done = (...ids: string[]): Result<string[]> => ({ ok: true, value: ids });
  if (p.type === 'position.revoke') {
    const position = state.positions.find(position => position.signupId === p.signupId);
    if (position) position.revokedAt ??= context.now;
    return done(p.signupId);
  }
  if (['draft', 'published', 'archived', 'cancelled'].includes(phase)) return fail('WRONG_PHASE', '当前活动阶段不能记录现场履约。');
  if (p.type === 'incident.report') {
    if (!p.signupIds.length || new Set(p.signupIds).size !== p.signupIds.length || !p.description.trim()) return fail('INVALID_INPUT', '请选择涉及人员并填写具体情况。');
    const id = context.id('incident');
    state.incidents.push({ id, activityId: p.activityId, subjectIds: [...p.signupIds], kind: p.kind, description: p.description.trim(), opened: evidence('收到现场报备'), resolution: null });
    return done(id);
  }
  if (p.type === 'incident.resolve') {
    if (!p.note.trim()) return fail('INVALID_INPUT', '请填写核实与处理结果。');
    const incident = state.incidents.find(i => i.id === p.incidentId)!;
    incident.resolution ??= evidence(p.note);
    return done(incident.id);
  }
  if (p.type === 'vehicle.depart' || p.type === 'vehicle.complete') {
    const vehicle = state.vehicles.find(v => v.id === p.vehicleId)!;
    const leg = vehicle.legs[p.leg];
    if ((p.leg === 'outbound' && !['gathering', 'active'].includes(phase)) || (p.leg === 'return' && !['active', 'closing'].includes(phase))) return fail('WRONG_PHASE', '当前阶段不能操作这一程车辆。');
    if (p.type === 'vehicle.complete') {
      if (!leg.departed) return fail('WRONG_PHASE', '车辆尚未发车，不能完成本程。');
      leg.completed ??= evidence(p.note);
    } else {
      const passengers = state.assignments.filter(a => a.vehicleId === vehicle.id).map(a => state.attendance.find(r => r.signupId === a.signupId)!);
      const unresolved = passengers.some(r => p.leg === 'outbound'
        ? !r.boardingByLeg.outbound && !['not_departed', 'coordinating'].includes(r.departure?.kind ?? '')
        : r.departure?.kind === 'joined' && r.returnPlan.kind === 'assigned' && !r.boardingByLeg.return);
      if (unresolved) return fail('UNRESOLVED_DEPARTURE', '仍有本车人员未上车或未核实去向，请逐人清点。');
      leg.departed ??= evidence(p.note);
    }
    return done(vehicle.id);
  }
  if (!('signupId' in p)) return fail('INVALID_INPUT', '现场操作缺少参与者。');
  const signup = state.signups.find(s => s.id === p.signupId)!;
  const record = state.attendance.find(a => a.signupId === signup.id)!;
  if (signup.status !== 'confirmed') return fail('WRONG_PHASE', '只有已确认的参与者可以记录履约。');
  const assignment = state.assignments.find(a => a.signupId === signup.id);
  const vehicle = assignment && state.vehicles.find(v => v.id === assignment.vehicleId);
  const participantDriver = state.vehicles.some(v => v.activityId === activity.id && v.drivers.some(d => d.kind === 'participant' && d.signupId === signup.id));
  const lateArrival = phase === 'active' && record.departure?.kind === 'coordinating';
  switch (p.type) {
    case 'attendance.checkin':
      if (phase !== 'gathering' && !lateArrival) return fail('WRONG_PHASE', '签到仅用于集合或已记录的迟到补到。');
      if (p.checkIn.method === 'manual' && !p.checkIn.evidence.note.trim()) return fail('INVALID_INPUT', '人工签到需要现场核实依据。');
      if (p.checkIn.method === 'simulation' && !isSelfSignup(signup, command.actor)) return fail('FORBIDDEN', '模拟定位签到只能由本人主动操作。');
      record.checkIn = p.checkIn.method === 'manual'
        ? { method: 'manual', evidence: evidence(p.checkIn.evidence.note) }
        : { method: 'simulation', evidence: evidence(p.checkIn.evidence.note), coordinates: { ...p.checkIn.coordinates } };
      return done(signup.id);
    case 'attendance.board': {
      if (p.leg === 'outbound' ? phase !== 'gathering' && !lateArrival : !['active', 'closing'].includes(phase)) return fail('WRONG_PHASE', '当前阶段不能修改这一程上车记录。');
      if (!vehicle) return fail('INVALID_INPUT', '请先安排本人的乘坐车辆。');
      if (p.leg === 'outbound' && (!record.checkIn || record.departure?.kind === 'not_departed')) return fail('UNRESOLVED_DEPARTURE', '请先签到并核实是否随队出发。');
      if (p.leg === 'return' && (record.departure?.kind !== 'joined' || record.returnPlan.kind === 'independent')) return fail('WRONG_PHASE', '仅随队且按原车返程的参与者需要返程清点。');
      if (vehicle.legs[p.leg].departed && !(lateArrival && p.leg === 'outbound' && p.boarded && !record.boardingByLeg.outbound)) return fail('WRONG_PHASE', '车辆已发车，不能抹去或改写已有上车事实。');
      record.boardingByLeg[p.leg] = p.boarded ? record.boardingByLeg[p.leg] ?? evidence(p.note) : null;
      return done(signup.id);
    }
    case 'attendance.departure': {
      if (phase !== 'gathering' && !lateArrival) return fail('WRONG_PHASE', '只能在集合或迟到协调时核实出发结果。');
      const kind = p.outcome.kind;
      if (record.departure?.kind === 'joined' && kind !== 'joined') return fail('WRONG_PHASE', '已出行者须继续安全收尾，不能改成未出发。');
      if (kind !== 'joined' && (!p.outcome.evidence.note.trim() || record.boardingByLeg.outbound)) return fail('UNRESOLVED_DEPARTURE', '未出发或协调状态需要依据，且不能与已上车事实矛盾。');
      if (kind === 'joined' && (!record.checkIn || (signup.trip.mode === 'shared' && !participantDriver && (!assignment || !record.boardingByLeg.outbound)))) return fail('UNRESOLVED_DEPARTURE', '请先核实签到及必要的去程上车。');
      record.departure = { kind, evidence: evidence(p.outcome.evidence.note) };
      return done(signup.id);
    }
    case 'attendance.returnPlan':
      if (!['active', 'closing'].includes(phase) || record.departure?.kind !== 'joined') return fail('WRONG_PHASE', '出行后才能核实返程安排。');
      if (!p.note.trim()) return fail('INVALID_INPUT', '请填写返程安排的核实依据。');
      if (record.boardingByLeg.return || vehicle?.legs.return.departed) return fail('WRONG_PHASE', '已有返程上车或发车事实，不能直接改为另一安排。');
      record.returnPlan = p.plan === 'assigned' ? { kind: 'assigned' } : { kind: 'independent', evidence: evidence(p.note) };
      return done(signup.id);
    case 'attendance.node':
      if (phase !== 'active' || record.departure?.kind !== 'joined') return fail('WRONG_PHASE', '实际随队出行时才能确认路线节点。');
      if (!activity.routeSnapshot.points.some(point => point.id === p.pointId)) return fail('NOT_FOUND', '找不到本场路线节点。');
      if (!record.nodes.some(n => n.pointId === p.pointId)) record.nodes.push({ pointId: p.pointId, evidence: evidence(p.note) });
      return done(signup.id);
    case 'attendance.home':
      if (phase !== 'closing' || record.departure?.kind !== 'joined') return fail('WRONG_PHASE', '请在行程结束后，为已出行者确认安全到家。');
      if (!isSelfSignup(signup, command.actor) && !p.note.trim()) return fail('INVALID_INPUT', '代确认需要逐人的核实依据。');
      record.home ??= evidence(p.note);
      return done(signup.id);
    case 'position.report':
      if (phase !== 'active' || record.departure?.kind !== 'joined') return fail('WRONG_PHASE', '位置仅在实际出行中由本人主动上报。');
      if (!p.consent) return fail('CONSENT_REQUIRED', '每次上报前，请明确同意本场授权人员查看本次位置。');
      if (!activity.endAt || Date.parse(activity.endAt) <= Date.parse(context.now)) return fail('CONSENT_REQUIRED', '本场位置授权时间已结束，请领队明确延长行程后重新授权。');
      state.positions = state.positions.filter(position => position.signupId !== signup.id);
      state.positions.push({ signupId: signup.id, coordinates: { ...p.coordinates }, reportedAt: context.now, consentExpiresAt: activity.endAt, revokedAt: null });
      return done(signup.id);
    default:
      return fail('INVALID_INPUT', '不是有效的现场操作。');
  }
}

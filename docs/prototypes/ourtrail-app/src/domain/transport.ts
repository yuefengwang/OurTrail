import type { Command, Context, ErrorCode, Result, VehicleInput } from './contracts';
import type { AssignmentRecord, DriverRecord, State, VehicleRecord } from './model';
import { passengerCapacity } from './allocation';
import { requireSignups } from './permissions';

const fail = (code: ErrorCode, message: string): Result<never> => ({ ok: false, error: { code, message } });
const done = (ids: string[]): Result<string[]> => ({ ok: true, value: ids });
const hasLegHistory = (vehicle: VehicleRecord) => Object.values(vehicle.legs).some(leg => leg.departed || leg.completed);

function vehicleInActivity(state: State, activityId: string, vehicleId: string): Result<VehicleRecord> {
  const vehicle = state.vehicles.find(v => v.id === vehicleId);
  if (!vehicle) return fail('NOT_FOUND', '找不到车辆。');
  if (vehicle.activityId !== activityId) return fail('FORBIDDEN', '车辆不属于此活动。');
  return { ok: true, value: vehicle };
}

function editableAssignments(state: State, activityId: string, signupIds: string[], vehicleIds: string[]): Result<null> {
  const signups = requireSignups(state, activityId, signupIds);
  if (!signups.ok) return signups;
  for (const signupId of signupIds) {
    const record = state.attendance.find(a => a.signupId === signupId);
    if (record && (record.boardingByLeg.outbound || record.boardingByLeg.return || record.departure)) {
      return fail('WRONG_PHASE', '已有上车或出发核实记录，不能修改乘车安排。');
    }
  }
  const oldVehicleIds = state.assignments.filter(a => signupIds.includes(a.signupId)).map(a => a.vehicleId);
  for (const vehicleId of new Set([...oldVehicleIds, ...vehicleIds])) {
    const found = vehicleInActivity(state, activityId, vehicleId);
    if (!found.ok) return found;
    if (hasLegHistory(found.value)) return fail('WRONG_PHASE', '车辆已发车，不能修改乘车安排。');
  }
  return { ok: true, value: null };
}

function driverIdentity(state: State, driver: DriverRecord): string | null {
  if (driver.kind === 'service') return driver.userId === null ? null : `user:${driver.userId}`;
  const signup = state.signups.find(s => s.id === driver.signupId);
  if (!signup) return null;
  const ref = signup.personRef;
  return ref.kind === 'user' ? `user:${ref.userId}` : `companion:${ref.ownerId}:${ref.companionId}`;
}

function validateDrivers(state: State, activityId: string, vehicleId: string | null, input: VehicleInput): Result<null> {
  const occupied = new Set(state.vehicles.filter(v => v.activityId === activityId && v.id !== vehicleId)
    .flatMap(v => v.drivers.map(d => driverIdentity(state, d))).filter((id): id is string => id !== null));
  for (const driver of input.drivers) {
    if (driver.kind === 'participant') {
      const signup = state.signups.find(s => s.id === driver.signupId);
      if (!signup || signup.activityId !== activityId || signup.status !== 'confirmed') {
        return fail('DRIVER_CONFLICT', '参与者司机必须是本场已确认报名者。');
      }
      if (state.assignments.some(a => a.signupId === driver.signupId)) {
        return fail('DRIVER_CONFLICT', '司机不能同时占用乘客座位，请先明确解除其乘客安排。');
      }
    } else if (driver.userId !== null && !state.profiles.some(p => p.id === driver.userId)) {
      return fail('DRIVER_CONFLICT', '司机账号不存在。');
    }
    const identity = driverIdentity(state, driver);
    if (identity !== null) {
      if (occupied.has(identity)) return fail('DRIVER_CONFLICT', '同一位司机不能重复登记或驾驶本场多辆车。');
      occupied.add(identity);
    }
  }
  return { ok: true, value: null };
}

const sameAssignment = (a: AssignmentRecord, b: AssignmentRecord) => a.activityId === b.activityId
  && a.signupId === b.signupId && a.vehicleId === b.vehicleId && a.seatLabel === b.seatLabel;

/** The dispatcher owns authorization, cloning, receipts, notices and final invariants. */
export function handleTransport(candidate: State, command: Command, context: Context): Result<string[]> {
  const payload = command.payload;
  if (payload.type !== 'vehicle.save' && payload.type !== 'vehicle.remove' && payload.type !== 'assignment.commit'
    && payload.type !== 'assignment.set' && payload.type !== 'assignment.remove' && payload.type !== 'assignment.swap') {
    return fail('INVALID_INPUT', '不支持此车辆安排操作。');
  }
  const activity = candidate.activities.find(a => a.id === payload.activityId);
  if (!activity) return fail('NOT_FOUND', '找不到活动。');
  const vehicleCommand = payload.type === 'vehicle.save' || payload.type === 'vehicle.remove';
  if (activity.phase !== 'published' && activity.phase !== 'gathering' && !(vehicleCommand && activity.phase === 'draft')) {
    return fail('WRONG_PHASE', '当前阶段不能修改车辆或乘车安排。');
  }

  switch (payload.type) {
    case 'vehicle.save': {
      let old: VehicleRecord | undefined;
      if (payload.vehicleId !== null) {
        const found = vehicleInActivity(candidate, payload.activityId, payload.vehicleId);
        if (!found.ok) return found;
        old = found.value;
        if (hasLegHistory(old)) return fail('WRONG_PHASE', '已发车或完成行程的车辆不能修改配置。');
      }
      const drivers = validateDrivers(candidate, payload.activityId, payload.vehicleId, payload.input);
      if (!drivers.ok) return drivers;
      const vehicle: VehicleRecord = {
        ...structuredClone(payload.input), id: old?.id ?? context.id('vehicle'), activityId: payload.activityId,
        legs: old?.legs ?? { outbound: { departed: null, completed: null }, return: { departed: null, completed: null } },
      };
      const capacity = passengerCapacity(vehicle);
      if (capacity < 0) return fail('VEHICLE_FULL', '核载减去司机及不可用位后不能为负数。');
      if (vehicle.seatLabels && (vehicle.seatLabels.length !== capacity || new Set(vehicle.seatLabels).size !== vehicle.seatLabels.length)) {
        return fail('INVALID_INPUT', '座号必须唯一，且数量与可用乘客位一致。');
      }
      if (old) candidate.vehicles[candidate.vehicles.indexOf(old)] = vehicle;
      else candidate.vehicles.push(vehicle);
      return done([vehicle.id]);
    }
    case 'vehicle.remove': {
      const found = vehicleInActivity(candidate, payload.activityId, payload.vehicleId);
      if (!found.ok) return found;
      if (hasLegHistory(found.value)) return fail('WRONG_PHASE', '不能删除已有行程事实的车辆。');
      if (candidate.assignments.some(a => a.vehicleId === payload.vehicleId)) {
        return fail('CONFLICT', '车辆仍有乘客安排，请先明确调整或解除安排。');
      }
      candidate.vehicles = candidate.vehicles.filter(v => v.id !== payload.vehicleId);
      candidate.memberships = candidate.memberships.filter(m => m.role !== 'vehicle_contact' || m.vehicleId !== payload.vehicleId);
      // Notices and events are historical facts, not vehicle configuration children.
      return done([payload.vehicleId]);
    }
    case 'assignment.commit': {
      const preview = payload.preview;
      if (preview.activityId !== payload.activityId || preview.assignments.some(a => a.activityId !== payload.activityId)) {
        return fail('FORBIDDEN', '预览或乘车安排不属于此活动。');
      }
      if (preview.baseRevision !== candidate.revision) return fail('CONFLICT', '分车预览已过期，请重新生成。');
      const bySignup = new Map(preview.assignments.map(a => [a.signupId, a]));
      if (bySignup.size !== preview.assignments.length) return fail('INVALID_INPUT', '分车预览不能重复安排同一位参与者。');
      const existing = candidate.assignments.filter(a => a.activityId === payload.activityId);
      for (const assignment of existing) {
        const proposed = bySignup.get(assignment.signupId);
        if (!proposed || !sameAssignment(assignment, proposed)) {
          return fail('CONFLICT', '分车预览不能删除或覆盖已有座位，请使用明确的调整操作。');
        }
      }
      const existingIds = new Set(existing.map(a => a.signupId));
      const additions = preview.assignments.filter(a => !existingIds.has(a.signupId));
      const editable = editableAssignments(candidate, payload.activityId, additions.map(a => a.signupId), additions.map(a => a.vehicleId));
      if (!editable.ok) return editable;
      // Keep original records and their order byte-for-byte; unassigned is advisory only.
      candidate.assignments.push(...structuredClone(additions));
      return done(additions.map(a => a.signupId));
    }
    case 'assignment.set': {
      const editable = editableAssignments(candidate, payload.activityId, [payload.target.signupId], [payload.target.vehicleId]);
      if (!editable.ok) return editable;
      const index = candidate.assignments.findIndex(a => a.signupId === payload.target.signupId);
      const next = { activityId: payload.activityId, ...structuredClone(payload.target) };
      if (index < 0) candidate.assignments.push(next);
      else candidate.assignments[index] = next;
      return done([payload.target.signupId]);
    }
    case 'assignment.remove': {
      const editable = editableAssignments(candidate, payload.activityId, [payload.signupId], []);
      if (!editable.ok) return editable;
      if (!candidate.assignments.some(a => a.activityId === payload.activityId && a.signupId === payload.signupId)) {
        return fail('NOT_FOUND', '这位参与者尚未分配车辆。');
      }
      candidate.assignments = candidate.assignments.filter(a => a.signupId !== payload.signupId);
      return done([payload.signupId]);
    }
    case 'assignment.swap': {
      const { firstSignupId, secondSignupId } = payload;
      if (firstSignupId === secondSignupId) return fail('INVALID_INPUT', '交换座位需要两位不同的参与者。');
      const editable = editableAssignments(candidate, payload.activityId, [firstSignupId, secondSignupId], []);
      if (!editable.ok) return editable;
      const first = candidate.assignments.find(a => a.signupId === firstSignupId);
      const second = candidate.assignments.find(a => a.signupId === secondSignupId);
      if (!first || !second) return fail('NOT_FOUND', '交换前两位参与者都必须已有乘车安排。');
      // Apply both sides before the dispatcher checks pickup/group/capacity/seat invariants.
      candidate.assignments = candidate.assignments.map(a => a.signupId === firstSignupId
        ? { ...a, vehicleId: second.vehicleId, seatLabel: second.seatLabel }
        : a.signupId === secondSignupId ? { ...a, vehicleId: first.vehicleId, seatLabel: first.seatLabel } : a);
      return done([firstSignupId, secondSignupId]);
    }
  }
}

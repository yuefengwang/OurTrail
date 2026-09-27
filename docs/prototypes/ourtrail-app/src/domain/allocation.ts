import type { Actor, AssignmentPreview, Result } from './contracts';
import { InstantSchema, type SignupRecord, type State, type VehicleRecord } from './model';
import { assertInvariants } from './invariants';
import { authRequired, isOwner, permissionDenied, requireActivity } from './permissions';

/** Driver seats include service drivers; invalid negative capacity is not hidden. */
export function passengerCapacity(vehicle: VehicleRecord): number {
  return vehicle.legalCapacity - vehicle.drivers.length - vehicle.blockedSeats;
}

const natural = new Intl.Collator('en', { numeric: true });
const compare = (a: string, b: string) => natural.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

/** Pure, deterministic, additive preview. Existing seats are never rearranged. */
export function planAssignments(state: State, actor: Actor, activityId: string, now: string): Result<AssignmentPreview> {
  if (actor.userId === null) return authRequired();
  const exists = requireActivity(state, activityId);
  if (!exists.ok) return exists;
  if (!isOwner(state, actor, activityId)) return permissionDenied();
  const activity = state.activities.find(a => a.id === activityId)!;
  if (activity.phase !== 'published' && activity.phase !== 'gathering') {
    return { ok: false, error: { code: 'WRONG_PHASE', message: '仅可在已发布或集合阶段安排车辆。' } };
  }
  if (!InstantSchema.safeParse(now).success) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: '当前时间格式不正确。' } };
  }
  const valid = assertInvariants(state);
  if (!valid.ok) return valid;

  const allVehicles = state.vehicles.filter(v => v.activityId === activityId);
  const drivers = new Set(allVehicles.flatMap(v => v.drivers.flatMap(d => d.kind === 'participant' ? [d.signupId] : [])));
  const vehicles = allVehicles.filter(v => !Object.values(v.legs).some(l => l.departed || l.completed))
    .sort((a, b) => compare(a.id, b.id));
  const eligible = state.signups.filter(s => s.activityId === activityId && s.status === 'confirmed'
    && s.trip.mode === 'shared' && !drivers.has(s.id)).sort((a, b) => compare(a.id, b.id));
  const together = new Set(state.groups.filter(g => g.activityId === activityId && g.keepTogether).map(g => g.id));
  const units = new Map<string, SignupRecord[]>();
  for (const signup of eligible) {
    const key = together.has(signup.groupId) ? `group:${signup.groupId}` : `signup:${signup.id}`;
    const members = units.get(key) ?? [];
    members.push(signup);
    units.set(key, members);
  }

  const assignments = structuredClone(state.assignments.filter(a => a.activityId === activityId));
  const assigned = new Map(assignments.map(a => [a.signupId, a]));
  const unassigned: AssignmentPreview['unassigned'] = [];
  for (const members of units.values()) {
    const remaining = members.filter(s => !assigned.has(s.id));
    if (!remaining.length) continue;
    const oldVehicleId = members.map(s => assigned.get(s.id)?.vehicleId).find(id => id !== undefined);
    const available = vehicles.filter(v => oldVehicleId === undefined || v.id === oldVehicleId);
    const matching = available.filter(v => members.every(s => s.trip.mode === 'shared' && v.pickupPointIds.includes(s.trip.pickupPointId)));
    const vehicle = matching.find(v => passengerCapacity(v) - assignments.filter(a => a.vehicleId === v.id).length >= remaining.length);
    if (!vehicle) {
      const reason: AssignmentPreview['unassigned'][number]['reason'] = !available.length ? 'no_vehicle' : !matching.length ? 'pickup_mismatch'
        : members.length > 1 && matching.every(v => passengerCapacity(v) < members.length) ? 'group_too_large' : 'no_seat';
      unassigned.push(...remaining.map(s => ({ signupId: s.id, reason })));
      continue;
    }
    const occupied = new Set(assignments.filter(a => a.vehicleId === vehicle.id).map(a => a.seatLabel));
    const seats = vehicle.seatLabels?.filter(label => !occupied.has(label)).sort(compare);
    remaining.forEach((signup, index) => {
      const assignment = { activityId, signupId: signup.id, vehicleId: vehicle.id, seatLabel: seats?.[index] ?? null };
      assignments.push(assignment);
      assigned.set(signup.id, assignment);
    });
  }
  return { ok: true, value: { activityId, baseRevision: state.revision, assignments, unassigned } };
}

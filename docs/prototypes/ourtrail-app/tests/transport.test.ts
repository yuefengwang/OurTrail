import { describe, expect, it } from 'vitest';
import { createFixture } from '../src/data/fixtures';
import { planAssignments } from '../src/domain/allocation';
import { reduceCommand } from '../src/domain/commands';
import { assertInvariants } from '../src/domain/invariants';
import type { AssignmentPreview, Payload, VehicleInput } from '../src/domain/contracts';
import type { State, VehicleRecord } from '../src/domain/model';
import { NOW, context, makeCommand, must } from './helpers';

function execute(state: State, payload: Payload, userId = 'u-owner') {
  return reduceCommand(state, makeCommand(state, payload, userId), context);
}
function rejectUnchanged(state: State, payload: Payload, code: string, userId = 'u-owner') {
  const before = JSON.stringify(state);
  expect(execute(state, payload, userId)).toMatchObject({ ok: false, error: { code } });
  expect(JSON.stringify(state)).toBe(before);
}
function input(vehicle: VehicleRecord, changes: Partial<VehicleInput> = {}): VehicleInput {
  const { id: _id, activityId: _activityId, legs: _legs, ...value } = structuredClone(vehicle);
  return { ...value, ...changes };
}
function assignment(state: State, signupId: string) { return state.assignments.find(a => a.signupId === signupId)!; }
function preview(state: State): AssignmentPreview {
  return must(planAssignments(state, { userId: 'u-owner' }, 'a1', NOW));
}
function small(): State {
  const state = createFixture('transport', NOW);
  const ids = ['s-lin', 's-zhou', 's-su', 's-owner'];
  state.signups = state.signups.filter(s => ids.includes(s.id));
  state.attendance = state.attendance.filter(a => ids.includes(a.signupId));
  state.assignments = [];
  state.memberships = state.memberships.filter(m => m.role === 'vehicle_contact');
  return state;
}
const set = (signupId: string, vehicleId: string, seatLabel: string | null = null): Payload => ({ type: 'assignment.set', activityId: 'a1', target: { signupId, vehicleId, seatLabel } });
const save = (state: State, changes: Partial<VehicleInput> = {}, vehicleId = 'v1'): Payload => ({ type: 'vehicle.save', activityId: 'a1', vehicleId, input: input(state.vehicles.find(v => v.id === vehicleId)!, changes) });

describe('assignment commit', () => {
  it('commits a preview additively without changing old assignments or the original state', () => {
    const state = createFixture('transport', NOW);
    const before = JSON.stringify(state);
    const old = structuredClone(state.assignments);
    const planned = preview(state);
    const applied = must(execute(state, { type: 'assignment.commit', activityId: 'a1', preview: planned }));
    expect(applied.state.assignments).toHaveLength(21);
    for (const existing of old) expect(JSON.stringify(assignment(applied.state, existing.signupId))).toBe(JSON.stringify(existing));
    expect(applied.targetIds).toEqual(expect.arrayContaining(planned.assignments.filter(a => !old.some(b => a.signupId === b.signupId)).map(a => a.signupId)));
    expect(assertInvariants(applied.state).ok).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('rejects stale previews even in a command with a fresh expected revision', () => {
    const state = createFixture('transport', NOW);
    const planned = preview(state);
    state.revision++;
    rejectUnchanged(state, { type: 'assignment.commit', activityId: 'a1', preview: planned }, 'CONFLICT');
  });

  it('rejects forged previews omitting an existing assignment', () => {
    const state = createFixture('transport', NOW);
    const planned = preview(state);
    planned.assignments = planned.assignments.filter(a => a.signupId !== 's-lin');
    rejectUnchanged(state, { type: 'assignment.commit', activityId: 'a1', preview: planned }, 'CONFLICT');
  });

  it('rejects forged previews replacing an existing seat', () => {
    const state = createFixture('transport', NOW);
    const planned = preview(state);
    planned.assignments.find(a => a.signupId === 's-lin')!.seatLabel = null;
    rejectUnchanged(state, { type: 'assignment.commit', activityId: 'a1', preview: planned }, 'CONFLICT');
  });

  it('does not use unassigned claims to remove old seats', () => {
    const state = createFixture('transport', NOW);
    const planned = preview(state);
    planned.unassigned = [{ signupId: 's-lin', reason: 'no_vehicle' }];
    const applied = must(execute(state, { type: 'assignment.commit', activityId: 'a1', preview: planned }));
    expect(assignment(applied.state, 's-lin')).toEqual(assignment(state, 's-lin'));
  });

  it('rejects duplicate people and conflicting seats in a preview', () => {
    const state = small();
    const planned = preview(state);
    planned.assignments.push(structuredClone(planned.assignments[0]));
    rejectUnchanged(state, { type: 'assignment.commit', activityId: 'a1', preview: planned }, 'INVALID_INPUT');
    planned.assignments.pop();
    planned.assignments[1].seatLabel = planned.assignments[0].seatLabel;
    rejectUnchanged(state, { type: 'assignment.commit', activityId: 'a1', preview: planned }, 'SEAT_TAKEN');
  });

  it('rejects cross-activity preview and assignment targets', () => {
    const state = small();
    const planned = preview(state);
    planned.activityId = 'other';
    rejectUnchanged(state, { type: 'assignment.commit', activityId: 'a1', preview: planned }, 'FORBIDDEN');
    planned.activityId = 'a1';
    planned.assignments[0].activityId = 'other';
    rejectUnchanged(state, { type: 'assignment.commit', activityId: 'a1', preview: planned }, 'FORBIDDEN');
    state.activities.push({ ...structuredClone(state.activities[0]), id: 'a2' });
    state.vehicles.push({ ...structuredClone(state.vehicles[1]), id: 'foreign-car', activityId: 'a2' });
    planned.assignments[0].activityId = 'a1';
    planned.assignments[0].vehicleId = 'foreign-car';
    rejectUnchanged(state, { type: 'assignment.commit', activityId: 'a1', preview: planned }, 'FORBIDDEN');
  });
});

describe('manual assignment operations', () => {
  it('sets and replaces exactly one target, retaining attendance and unrelated seats', () => {
    const state = small();
    state.assignments = [{ activityId: 'a1', signupId: 's-lin', vehicleId: 'v1', seatLabel: '01' }];
    state.attendance.find(a => a.signupId === 's-lin')!.checkIn = { method: 'manual', evidence: { at: NOW, by: 'u-owner', note: 'checked' } };
    const applied = must(execute(state, set('s-lin', 'v2'))).state;
    expect(applied.assignments).toEqual([{ activityId: 'a1', signupId: 's-lin', vehicleId: 'v2', seatLabel: null }]);
    expect(applied.attendance).toEqual(state.attendance);
    const added = must(execute(applied, set('s-owner', 'v1', '01'))).state;
    expect(added.assignments).toHaveLength(2);
    expect(assignment(added, 's-lin')).toEqual(assignment(applied, 's-lin'));
  });

  it('removes assignments only explicitly and keeps notice and attendance history', () => {
    const state = createFixture('transport', NOW);
    const next = must(execute(state, { type: 'assignment.remove', activityId: 'a1', signupId: 's-lin' })).state;
    expect(next.assignments).toHaveLength(state.assignments.length - 1);
    expect(next.assignments.some(a => a.signupId === 's-lin')).toBe(false);
    expect(next.attendance).toEqual(state.attendance);
    for (const notice of state.notices) expect(next.notices).toContainEqual(notice);
    rejectUnchanged(next, { type: 'assignment.remove', activityId: 'a1', signupId: 's-lin' }, 'NOT_FOUND');
  });

  it('rejects seat duplication, incompatible pickups, and overcapacity without changing state', () => {
    const state = createFixture('transport', NOW);
    rejectUnchanged(state, set('s-lin', 'v1', '01'), 'SEAT_TAKEN');
    const empty = small();
    empty.vehicles[1].pickupPointIds = ['p-chadianzi'];
    rejectUnchanged(empty, set('s-lin', 'v2'), 'PICKUP_MISMATCH');
    empty.vehicles[1].pickupPointIds.push('p-xipu');
    empty.vehicles[1].legalCapacity = 1;
    rejectUnchanged(empty, set('s-lin', 'v2'), 'VEHICLE_FULL');
  });

  it('rejects pending, self-arriving, and participant-driver passenger assignments', () => {
    const state = small();
    state.signups.find(s => s.id === 's-lin')!.status = 'pending';
    rejectUnchanged(state, set('s-lin', 'v2'), 'WRONG_PHASE');
    state.signups.find(s => s.id === 's-lin')!.status = 'confirmed';
    state.signups.find(s => s.id === 's-lin')!.trip = { mode: 'self' };
    rejectUnchanged(state, set('s-lin', 'v2'), 'INVALID_INPUT');
    state.vehicles[1].drivers = [{ kind: 'participant', signupId: 's-owner' }];
    rejectUnchanged(state, set('s-owner', 'v2'), 'DRIVER_CONFLICT');
  });

  it('does not split keep-together groups when manually moving one member', () => {
    const state = createFixture('transport', NOW);
    rejectUnchanged(state, set('s-su', 'v2'), 'GROUP_SCOPE');
  });

  it('swaps two occupied seats simultaneously and changes no other assignment', () => {
    const state = createFixture('transport', NOW);
    const before = JSON.stringify(state);
    const first = assignment(state, 's-lin');
    const second = assignment(state, 's-walker-08');
    const next = must(execute(state, { type: 'assignment.swap', activityId: 'a1', firstSignupId: first.signupId, secondSignupId: second.signupId })).state;
    expect(assignment(next, first.signupId)).toEqual({ ...first, vehicleId: second.vehicleId, seatLabel: second.seatLabel });
    expect(assignment(next, second.signupId)).toEqual({ ...second, vehicleId: first.vehicleId, seatLabel: first.seatLabel });
    expect(next.assignments.filter(a => ![first.signupId, second.signupId].includes(a.signupId))).toEqual(state.assignments.filter(a => ![first.signupId, second.signupId].includes(a.signupId)));
    expect(JSON.stringify(state)).toBe(before);
  });

  it('swaps within one numbered vehicle without a transient duplicate-seat failure', () => {
    const state = createFixture('transport', NOW);
    const next = must(execute(state, { type: 'assignment.swap', activityId: 'a1', firstSignupId: 's-lin', secondSignupId: 's-owner' })).state;
    expect(assignment(next, 's-lin').seatLabel).toBe(assignment(state, 's-owner').seatLabel);
    expect(assignment(next, 's-owner').seatLabel).toBe(assignment(state, 's-lin').seatLabel);
  });

  it('rejects swaps of identical IDs, unassigned people, incompatible pickups, and split groups atomically', () => {
    const state = createFixture('transport', NOW);
    const swap = (a: string, b: string): Payload => ({ type: 'assignment.swap', activityId: 'a1', firstSignupId: a, secondSignupId: b });
    rejectUnchanged(state, swap('s-lin', 's-lin'), 'INVALID_INPUT');
    rejectUnchanged(state, swap('s-lin', 's-walker-16'), 'NOT_FOUND');
    rejectUnchanged(state, swap('s-su', 's-walker-08'), 'GROUP_SCOPE');
    const local = small();
    local.vehicles[0].pickupPointIds = ['p-xipu'];
    local.vehicles[1].pickupPointIds = ['p-chadianzi'];
    local.signups.find(s => s.id === 's-owner')!.trip = { mode: 'shared', pickupPointId: 'p-chadianzi' };
    local.assignments = [
      { activityId: 'a1', signupId: 's-lin', vehicleId: 'v1', seatLabel: '01' },
      { activityId: 'a1', signupId: 's-owner', vehicleId: 'v2', seatLabel: null },
    ];
    expect(assertInvariants(local).ok).toBe(true);
    rejectUnchanged(local, swap('s-lin', 's-owner'), 'PICKUP_MISMATCH');
  });

  it.each(['draft', 'active', 'closing', 'archived', 'cancelled'] as const)('blocks assignment edits in %s', phase => {
    const state = createFixture('transport', NOW);
    state.activities[0].phase = phase;
    rejectUnchanged(state, set('s-lin', 'v2'), 'WRONG_PHASE');
    rejectUnchanged(state, { type: 'assignment.remove', activityId: 'a1', signupId: 's-lin' }, 'WRONG_PHASE');
    rejectUnchanged(state, { type: 'assignment.swap', activityId: 'a1', firstSignupId: 's-lin', secondSignupId: 's-owner' }, 'WRONG_PHASE');
    rejectUnchanged(state, { type: 'assignment.commit', activityId: 'a1', preview: { activityId: 'a1', baseRevision: state.revision, assignments: state.assignments, unassigned: [] } }, 'WRONG_PHASE');
  });

  it.each(['outbound', 'return'] as const)('preserves %s boarding evidence and blocks edits to that person', leg => {
    const state = createFixture('transport', NOW);
    state.activities[0].phase = 'gathering';
    state.attendance.find(a => a.signupId === 's-lin')!.boardingByLeg[leg] = { at: NOW, by: 'u-owner', note: 'boarded' };
    rejectUnchanged(state, set('s-lin', 'v2'), 'WRONG_PHASE');
    rejectUnchanged(state, { type: 'assignment.remove', activityId: 'a1', signupId: 's-lin' }, 'WRONG_PHASE');
    rejectUnchanged(state, { type: 'assignment.swap', activityId: 'a1', firstSignupId: 's-lin', secondSignupId: 's-owner' }, 'WRONG_PHASE');
  });

  it('blocks old or new departed vehicles and preserves resolved departure evidence', () => {
    const state = createFixture('transport', NOW);
    state.activities[0].phase = 'gathering';
    state.vehicles[0].legs.outbound.departed = { at: NOW, by: 'u-owner', note: 'departed' };
    rejectUnchanged(state, set('s-lin', 'v2'), 'WRONG_PHASE');
    rejectUnchanged(state, set('s-walker-16', 'v1', '18'), 'WRONG_PHASE');
    rejectUnchanged(state, { type: 'assignment.remove', activityId: 'a1', signupId: 's-lin' }, 'WRONG_PHASE');
    const planned = { activityId: 'a1', baseRevision: state.revision, assignments: [...state.assignments, { activityId: 'a1', signupId: 's-walker-16', vehicleId: 'v1', seatLabel: '18' }], unassigned: [] };
    rejectUnchanged(state, { type: 'assignment.commit', activityId: 'a1', preview: planned }, 'WRONG_PHASE');
    state.vehicles[0].legs.outbound.departed = null;
    state.attendance.find(a => a.signupId === 's-lin')!.departure = { kind: 'not_departed', evidence: { at: NOW, by: 'u-owner', note: 'not traveling' } };
    rejectUnchanged(state, set('s-lin', 'v2'), 'WRONG_PHASE');
  });
});

describe('vehicle configuration', () => {
  it('creates vehicles with empty legs and service drivers consuming seats', () => {
    const state = small();
    const next = must(execute(state, { type: 'vehicle.save', activityId: 'a1', vehicleId: null, input: input(state.vehicles[1], { drivers: [{ kind: 'service', name: 'new', phone: '', userId: null }] }) })).state;
    expect(next.vehicles).toHaveLength(3);
    expect(next.vehicles[2].legs).toEqual({ outbound: { departed: null, completed: null }, return: { departed: null, completed: null } });
    expect(next.vehicles[2].activityId).toBe('a1');
  });

  it('saves valid vehicle edits without losing legs, seats, or existing notices', () => {
    const state = createFixture('transport', NOW);
    const next = must(execute(state, save(state, { label: 'New label' }))).state;
    expect(next.vehicles[0].label).toBe('New label');
    expect(next.vehicles[0].legs).toEqual(state.vehicles[0].legs);
    expect(next.assignments).toEqual(state.assignments);
    for (const notice of state.notices) expect(next.notices).toContainEqual(notice);
  });

  it('allows vehicle configuration during draft preparation', () => {
    const state = small();
    state.activities[0].phase = 'draft';
    expect(execute(state, save(state, { label: 'Draft car' })).ok).toBe(true);
  });

  it('rejects negative capacity, wrong label counts, and duplicate seat labels', () => {
    const state = small();
    rejectUnchanged(state, save(state, { legalCapacity: 1, blockedSeats: 1, seatLabels: null }), 'VEHICLE_FULL');
    rejectUnchanged(state, save(state, { seatLabels: ['1'] }), 'INVALID_INPUT');
    rejectUnchanged(state, save(state, { legalCapacity: 3, seatLabels: ['1', '1'] }), 'INVALID_INPUT');
  });

  it('rejects shrink, changed pickup, and deleted seat labels without evicting passengers', () => {
    const state = createFixture('transport', NOW);
    rejectUnchanged(state, save(state, { legalCapacity: 12, seatLabels: null }), 'VEHICLE_FULL');
    rejectUnchanged(state, save(state, { pickupPointIds: ['p-chadianzi'] }), 'PICKUP_MISMATCH');
    rejectUnchanged(state, save(state, { seatLabels: null }), 'INVALID_INPUT');
    rejectUnchanged(state, { type: 'vehicle.remove', activityId: 'a1', vehicleId: 'v1' }, 'CONFLICT');
  });

  it('requires confirmed same-activity participant drivers and rejects passenger-driver conflicts', () => {
    const state = small();
    state.signups.find(s => s.id === 's-owner')!.status = 'pending';
    rejectUnchanged(state, save(state, { drivers: [{ kind: 'participant', signupId: 's-owner' }] }, 'v2'), 'DRIVER_CONFLICT');
    state.signups.find(s => s.id === 's-owner')!.status = 'confirmed';
    state.assignments = [{ activityId: 'a1', signupId: 's-owner', vehicleId: 'v1', seatLabel: '01' }];
    rejectUnchanged(state, save(state, { drivers: [{ kind: 'participant', signupId: 's-owner' }] }, 'v2'), 'DRIVER_CONFLICT');
    state.assignments = [];
    state.activities.push({ ...structuredClone(state.activities[0]), id: 'a2' });
    state.groups.push({ id: 'foreign-group', activityId: 'a2', submittedByUserId: 'u-owner', keepTogether: false });
    state.signups.push({ ...structuredClone(state.signups.find(s => s.id === 's-owner')!), id: 'foreign-signup', groupId: 'foreign-group', activityId: 'a2' });
    state.attendance.push({ ...structuredClone(state.attendance[0]), signupId: 'foreign-signup' });
    rejectUnchanged(state, save(state, { drivers: [{ kind: 'participant', signupId: 'foreign-signup' }] }, 'v2'), 'FORBIDDEN');
  });

  it('never assigns one driver to two vehicles or duplicates the same driver seat', () => {
    const state = small();
    state.vehicles[1].drivers = [{ kind: 'participant', signupId: 's-owner' }];
    rejectUnchanged(state, save(state, { drivers: [{ kind: 'participant', signupId: 's-owner' }] }), 'DRIVER_CONFLICT');
    rejectUnchanged(state, save(state, { drivers: [{ kind: 'participant', signupId: 's-lin' }, { kind: 'participant', signupId: 's-lin' }], seatLabels: null }), 'DRIVER_CONFLICT');
    rejectUnchanged(state, save(state, { drivers: [{ kind: 'service', name: 'same owner', phone: '', userId: 'u-owner' }] }), 'DRIVER_CONFLICT');
    rejectUnchanged(state, save(state, { drivers: [{ kind: 'service', name: 'same driver', phone: '', userId: 'u-driver' }] }, 'v2'), 'DRIVER_CONFLICT');
  });

  it('removes an empty vehicle and its contacts but preserves historical vehicle notices', () => {
    const state = small();
    state.notices[0].audience = { kind: 'vehicle', vehicleId: 'v1' };
    const notices = structuredClone(state.notices);
    const next = must(execute(state, { type: 'vehicle.remove', activityId: 'a1', vehicleId: 'v1' })).state;
    expect(next.vehicles.some(v => v.id === 'v1')).toBe(false);
    expect(next.memberships.some(m => m.role === 'vehicle_contact' && m.vehicleId === 'v1')).toBe(false);
    for (const notice of notices) expect(next.notices).toContainEqual(notice);
    expect(assertInvariants(next).ok).toBe(true);
  });

  it('never resets or deletes departed/completed vehicle facts', () => {
    const state = small();
    state.activities[0].phase = 'gathering';
    state.vehicles[0].legs.outbound.departed = { at: NOW, by: 'u-owner', note: 'departed' };
    state.vehicles[0].legs.outbound.completed = { at: NOW, by: 'u-owner', note: 'completed' };
    rejectUnchanged(state, save(state, { label: 'Reset' }), 'WRONG_PHASE');
    rejectUnchanged(state, { type: 'vehicle.remove', activityId: 'a1', vehicleId: 'v1' }, 'WRONG_PHASE');
    const forged = save(state);
    if (forged.type !== 'vehicle.save') throw new Error('fixture');
    Object.assign(forged.input, { legs: { outbound: { departed: null, completed: null }, return: { departed: null, completed: null } } });
    rejectUnchanged(state, forged, 'INVALID_INPUT');
  });

  it.each(['active', 'closing', 'archived', 'cancelled'] as const)('blocks ordinary vehicle edits in %s', phase => {
    const state = small();
    state.activities[0].phase = phase;
    rejectUnchanged(state, save(state), 'WRONG_PHASE');
    rejectUnchanged(state, { type: 'vehicle.remove', activityId: 'a1', vehicleId: 'v1' }, 'WRONG_PHASE');
  });

  it('does not give vehicle contacts configuration or allocation authority', () => {
    const state = createFixture('transport', NOW);
    const payloads: Payload[] = [
      save(state), { type: 'vehicle.remove', activityId: 'a1', vehicleId: 'v1' },
      set('s-lin', 'v2'), { type: 'assignment.remove', activityId: 'a1', signupId: 's-lin' },
      { type: 'assignment.swap', activityId: 'a1', firstSignupId: 's-lin', secondSignupId: 's-owner' },
      { type: 'assignment.commit', activityId: 'a1', preview: preview(state) },
    ];
    for (const payload of payloads) rejectUnchanged(state, payload, 'FORBIDDEN', 'u-driver');
  });
});

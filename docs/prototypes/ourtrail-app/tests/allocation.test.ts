import { describe, expect, it } from 'vitest';
import { createFixture } from '../src/data/fixtures';
import { passengerCapacity, planAssignments } from '../src/domain/allocation';
import { assertInvariants } from '../src/domain/invariants';
import type { Result } from '../src/domain/contracts';
import type { State } from '../src/domain/model';

const NOW = '2026-09-24T07:00:00+08:00';
const OWNER = { userId: 'u-owner' };
function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}
function scenario(ids: string[] = ['s-lin']): State {
  const state = createFixture('transport', NOW);
  state.signups = state.signups.filter(s => ids.includes(s.id));
  state.attendance = state.attendance.filter(a => ids.includes(a.signupId));
  state.assignments = [];
  state.memberships = [];
  state.vehicles = [state.vehicles[1]];
  return state;
}
const plan = (state: State) => must(planAssignments(state, OWNER, 'a1', NOW));

describe('passenger capacity', () => {
  it('subtracts every driver and blocked seat without clamping', () => {
    const vehicle = scenario().vehicles[0];
    expect(passengerCapacity(vehicle)).toBe(6);
    vehicle.drivers.push({ kind: 'service', name: 'Second driver', phone: '', userId: null });
    expect(passengerCapacity(vehicle)).toBe(5);
    vehicle.blockedSeats = 6;
    expect(passengerCapacity(vehicle)).toBe(-1);
  });
});

describe('assignment planning', () => {
  it('is owner-only and reports missing activities', () => {
    const state = scenario();
    for (const userId of ['u-driver', 'u-staff', 'u-lin']) {
      expect(planAssignments(state, { userId }, 'a1', NOW)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    }
    expect(planAssignments(state, { userId: null }, 'a1', NOW)).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } });
    expect(planAssignments(state, OWNER, 'missing', NOW)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it.each(['draft', 'active', 'closing', 'archived', 'cancelled'] as const)('rejects %s planning', phase => {
    const state = scenario();
    state.activities[0].phase = phase;
    expect(planAssignments(state, OWNER, 'a1', NOW)).toMatchObject({ ok: false, error: { code: 'WRONG_PHASE' } });
  });

  it('excludes self-arrivals, non-confirmed people, and participant drivers', () => {
    const state = scenario(['s-lin', 's-staff', 's-owner', 's-walker-01', 's-walker-02']);
    state.signups.find(s => s.id === 's-lin')!.trip = { mode: 'self' };
    state.signups.find(s => s.id === 's-staff')!.status = 'pending';
    state.signups.find(s => s.id === 's-walker-01')!.status = 'waitlisted';
    state.vehicles[0].drivers = [{ kind: 'participant', signupId: 's-owner' }];
    expect(plan(state).assignments.map(a => a.signupId)).toEqual(['s-walker-02']);
    expect(plan(state).unassigned).toEqual([]);
  });

  it('retains existing assignment bytes and counts unnumbered occupants on numbered vehicles', () => {
    const state = scenario(['s-lin', 's-owner', 's-staff']);
    const vehicle = state.vehicles[0];
    vehicle.legalCapacity = 3;
    vehicle.seatLabels = ['10', '2'];
    state.assignments = [{ activityId: 'a1', signupId: 's-lin', vehicleId: vehicle.id, seatLabel: null }];
    const before = JSON.stringify(state);
    const preview = plan(state);
    expect(preview).toMatchObject({ activityId: 'a1', baseRevision: state.revision });
    expect(JSON.stringify(preview.assignments[0])).toBe(JSON.stringify(state.assignments[0]));
    expect(preview.assignments).toHaveLength(2);
    expect(preview.assignments[1].seatLabel).toBe('2');
    expect(preview.unassigned).toEqual([{ signupId: 's-staff', reason: 'no_seat' }]);
    expect(JSON.stringify(state)).toBe(before);
    preview.assignments[0].seatLabel = 'changed';
    expect(JSON.stringify(state)).toBe(before);
  });

  it('uses stable natural seat order regardless of label input order', () => {
    const state = scenario(['s-lin', 's-owner', 's-staff']);
    state.vehicles[0].legalCapacity = 4;
    state.vehicles[0].seatLabels = ['10', '2', '1'];
    const before = JSON.stringify(state);
    expect(plan(state).assignments.map(a => a.seatLabel)).toEqual(['1', '2', '10']);
    expect(plan(state)).toEqual(plan(state));
    expect(JSON.stringify(state)).toBe(before);
  });

  it('never splits a keep-together group across individually available seats', () => {
    const state = scenario(['s-zhou', 's-su']);
    state.vehicles[0].legalCapacity = 2;
    state.vehicles.push({ ...structuredClone(state.vehicles[0]), id: 'v3' });
    const preview = plan(state);
    expect(preview.assignments).toEqual([]);
    expect(preview.unassigned).toEqual([
      { signupId: 's-su', reason: 'group_too_large' },
      { signupId: 's-zhou', reason: 'group_too_large' },
    ]);
  });

  it('fills a partial group only on its old vehicle and preserves its seat', () => {
    const state = scenario(['s-zhou', 's-su']);
    state.vehicles.push({ ...structuredClone(state.vehicles[0]), id: 'v1' });
    state.assignments = [{ activityId: 'a1', signupId: 's-zhou', vehicleId: 'v2', seatLabel: null }];
    const preview = plan(state);
    expect(preview.assignments).toEqual([
      state.assignments[0], { activityId: 'a1', signupId: 's-su', vehicleId: 'v2', seatLabel: null },
    ]);
  });

  it('leaves the remainder unassigned when the partial group old vehicle has no room', () => {
    const state = scenario(['s-zhou', 's-su', 's-lin']);
    state.vehicles[0].legalCapacity = 3;
    state.vehicles.push({ ...structuredClone(state.vehicles[0]), id: 'v3' });
    state.assignments = ['s-zhou', 's-lin'].map(signupId => ({ activityId: 'a1', signupId, vehicleId: 'v2', seatLabel: null }));
    const preview = plan(state);
    expect(preview.assignments).toEqual(state.assignments);
    expect(preview.unassigned).toEqual([{ signupId: 's-su', reason: 'no_seat' }]);
  });

  it('requires one vehicle to serve every pickup in a group', () => {
    const state = scenario(['s-zhou', 's-su']);
    state.signups.find(s => s.id === 's-su')!.trip = { mode: 'shared', pickupPointId: 'p-chadianzi' };
    state.vehicles[0].pickupPointIds = ['p-xipu'];
    state.vehicles.push({ ...structuredClone(state.vehicles[0]), id: 'v3', pickupPointIds: ['p-chadianzi'] });
    expect(plan(state).unassigned.map(a => a.reason)).toEqual(['pickup_mismatch', 'pickup_mismatch']);
    state.vehicles[0].pickupPointIds.push('p-chadianzi');
    expect(plan(state).assignments.map(a => a.vehicleId)).toEqual(['v2', 'v2']);
  });

  it('distinguishes absent vehicles, pickup mismatch, and insufficient remaining seats', () => {
    const state = scenario();
    state.vehicles[0].pickupPointIds = ['p-chadianzi'];
    expect(plan(state).unassigned).toEqual([{ signupId: 's-lin', reason: 'pickup_mismatch' }]);
    state.vehicles[0].pickupPointIds.push('p-xipu');
    state.vehicles[0].legalCapacity = 1;
    expect(plan(state).unassigned).toEqual([{ signupId: 's-lin', reason: 'no_seat' }]);
    state.vehicles = [];
    expect(plan(state).unassigned).toEqual([{ signupId: 's-lin', reason: 'no_vehicle' }]);
  });

  it('does not add passengers to departed vehicles, even in gathering', () => {
    const state = scenario(['s-zhou', 's-su']);
    state.activities[0].phase = 'gathering';
    state.assignments = [{ activityId: 'a1', signupId: 's-zhou', vehicleId: 'v2', seatLabel: null }];
    state.vehicles[0].legs.outbound.departed = { at: NOW, by: 'u-owner', note: 'departed' };
    const preview = plan(state);
    expect(preview.assignments).toEqual(state.assignments);
    expect(preview.unassigned).toEqual([{ signupId: 's-su', reason: 'no_vehicle' }]);
  });

  it('keeps every generated candidate invariant-valid', () => {
    const state = createFixture('transport', NOW);
    const before = JSON.stringify(state);
    const preview = plan(state);
    expect(assertInvariants({ ...state, assignments: preview.assignments })).toEqual({ ok: true, value: null });
    expect(preview.assignments).toHaveLength(21);
    expect(preview.unassigned).toEqual([]);
    expect(JSON.stringify(state)).toBe(before);
  });
});

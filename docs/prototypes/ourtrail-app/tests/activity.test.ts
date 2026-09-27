import { describe, expect, it } from 'vitest';
import { createFixture } from '../src/data/fixtures';
import { reduceCommand } from '../src/domain/commands';
import type { ActivityInput, ErrorCode, Payload } from '../src/domain/contracts';
import type { ActivityRecord, State } from '../src/domain/model';
import { assertInvariants } from '../src/domain/invariants';
import { NOW, apply, context, inputFor, makeCommand, must } from './helpers';

function inputOf(activity: ActivityRecord): ActivityInput {
  const { id, ownerId, phase, ...input } = structuredClone(activity);
  return input;
}
function draft(): State {
  const state = createFixture('empty', NOW);
  const input = inputOf(createFixture('signup', NOW).activities[0]);
  return apply(state, { type: 'activity.create', input: { ...input, routeId: null } });
}
function fails(state: State, payload: Payload, code: ErrorCode, actor = 'u-owner') {
  const before = structuredClone(state);
  expect(reduceCommand(state, makeCommand(state, payload, actor), context)).toMatchObject({ ok: false, error: { code } });
  expect(state).toEqual(before);
}
function readyToStart(): State {
  const state = createFixture('gathering', NOW);
  state.attendance.forEach(record => {
    record.departure = { kind: 'not_departed', evidence: { at: NOW, by: 'u-owner', note: '核实未出发' } };
  });
  return state;
}

describe('activity creation and publishing', () => {
  it('creates a draft owned by the actor and persists an isolated private route', () => {
    const before = createFixture('empty', NOW);
    const input = { ...inputOf(createFixture('signup', NOW).activities[0]), routeId: null };
    const created = must(reduceCommand(before, makeCommand(before, { type: 'activity.create', input }), context));
    const activity = created.state.activities[0];
    expect(created.targetIds[0]).toBe(activity.id);
    expect(activity).toMatchObject({ ownerId: 'u-owner', phase: 'draft', acceptingSignups: false });
    expect(created.state.routes[0]).toMatchObject({ id: activity.routeId, ownerId: 'u-owner', title: input.routeSnapshot.title });
    activity.routeSnapshot.points[0].name = '活动快照修改';
    expect(created.state.routes[0].points[0].name).toBe(input.routeSnapshot.points[0].name);
    expect(before.activities).toEqual([]);
  });

  it('accepts incomplete draft content but refuses publication atomically', () => {
    const state = createFixture('empty', NOW);
    const input = { ...inputOf(createFixture('signup', NOW).activities[0]), routeId: null,
      title: '', startAt: null, endAt: null, deadlineAt: null, pickupPoints: [],
      routeSnapshot: { title: '', distanceKm: 0, ascentM: 0, points: [], risks: [] } };
    const next = apply(state, { type: 'activity.create', input });
    fails(next, { type: 'activity.publish', activityId: next.activities[0].id, participation: null }, 'INVALID_INPUT');
  });

  it('copies content only and clears all dates including pickup meeting times', () => {
    const state = createFixture('active', NOW);
    const before = structuredClone(state);
    const result = must(reduceCommand(state, makeCommand(state, { type: 'activity.copy', sourceActivityId: 'a1' }), context));
    const copy = result.state.activities.find(a => a.id === result.targetIds[0])!;
    expect(copy).toMatchObject({ phase: 'draft', acceptingSignups: false, startAt: null, endAt: null, deadlineAt: null });
    expect(copy.pickupPoints.every(point => point.meetingAt === null)).toBe(true);
    expect(copy.routeSnapshot).toEqual(state.activities[0].routeSnapshot);
    for (const key of ['signups', 'groups', 'vehicles', 'assignments', 'attendance', 'memberships', 'positions', 'incidents'] as const) {
      expect(result.state[key]).toEqual(before[key]);
    }
    expect(state).toEqual(before);
  });

  it('publishes without silently enrolling its owner', () => {
    const state = draft();
    const next = apply(state, { type: 'activity.publish', activityId: state.activities[0].id, participation: null });
    expect(next.activities[0]).toMatchObject({ phase: 'published', acceptingSignups: true });
    expect(next.signups).toEqual([]);
  });

  it('explicit owner participation is confirmed even in manual approval mode', () => {
    const state = draft();
    const next = apply(state, { type: 'activity.publish', activityId: state.activities[0].id, participation: inputFor(state, 'u-owner') });
    expect(next.signups).toHaveLength(1);
    expect(next.signups[0]).toMatchObject({ status: 'confirmed', personRef: { kind: 'user', userId: 'u-owner' }, consent: { at: NOW, recordedBy: 'u-owner' } });
    expect(next.attendance).toHaveLength(1);
    expect(assertInvariants(next).ok).toBe(true);
  });

  it('does not allow an owner companion as publication participation', () => {
    const state = draft();
    state.profiles.find(p => p.id === 'u-owner')!.companions.push({ id: 'owner-companion', person: structuredClone(state.profiles[0].person) });
    const participation = inputFor(state, 'u-owner');
    participation.personRef = { kind: 'companion', ownerId: 'u-owner', companionId: 'owner-companion' };
    participation.consent.proxyAuthority = true;
    fails(state, { type: 'activity.publish', activityId: state.activities[0].id, participation }, 'INVALID_INPUT');
  });

  it('requires participation consent before publishing', () => {
    const state = draft();
    const participation = inputFor(state, 'u-owner');
    participation.consent.dataUse = false;
    fails(state, { type: 'activity.publish', activityId: state.activities[0].id, participation }, 'CONSENT_REQUIRED');
  });

  it.each(['title', 'risk', 'point', 'pickup', 'time'] as const)('validates publish %s requirements', field => {
    const state = draft();
    const a = state.activities[0];
    if (field === 'title') a.title = '   ';
    if (field === 'risk') a.routeSnapshot.risks = [];
    if (field === 'point') a.routeSnapshot.points = [];
    if (field === 'pickup') a.pickupPoints = [];
    if (field === 'time') a.deadlineAt = a.endAt;
    fails(state, { type: 'activity.publish', activityId: a.id, participation: null }, 'INVALID_INPUT');
  });
});

describe('activity editing restrictions', () => {
  it('preserves stored route and other activity snapshots when editing its snapshot', () => {
    const state = createFixture('cross-day', NOW);
    const input = inputOf(state.activities[0]);
    input.routeSnapshot.title = '本场调整';
    const next = apply(state, { type: 'activity.edit', activityId: 'a1', input });
    expect(next.activities[0].routeSnapshot.title).toBe('本场调整');
    expect(next.activities[1]).toEqual(state.activities[1]);
    expect(next.routes).toEqual(state.routes);
  });

  it('persists a newly supplied private route on draft save without changing its source snapshot', () => {
    const state = draft();
    state.activities[0].routeId = null;
    state.activities[0].routeSnapshot = { title: '', distanceKm: 0, ascentM: 0, points: [], risks: [] };
    const input = inputOf(state.activities[0]);
    input.routeSnapshot = structuredClone(createFixture('signup', NOW).activities[0].routeSnapshot);
    const next = apply(state, { type: 'activity.edit', activityId: state.activities[0].id, input });
    const saved = next.routes.find(r => r.id === next.activities[0].routeId)!;
    expect(saved).toMatchObject({ ownerId: 'u-owner', title: input.routeSnapshot.title });
    next.activities[0].routeSnapshot.points[0].name = '仅活动调整';
    expect(saved.points[0].name).toBe(input.routeSnapshot.points[0].name);
    expect(input.routeId).toBeNull();
  });

  it('rejects deleting pickup references and lowering capacity below occupied count', () => {
    const state = createFixture('signup', NOW);
    const input = inputOf(state.activities[0]);
    input.pickupPoints = input.pickupPoints.filter(p => p.id !== 'p-xipu');
    fails(state, { type: 'activity.edit', activityId: 'a1', input }, 'INVALID_INPUT');
    fails(state, { type: 'activity.edit', activityId: 'a1', input: { ...inputOf(state.activities[0]), capacity: 20 } }, 'CAPACITY');
  });

  it('rejects deleting route nodes with attendance evidence', () => {
    const state = createFixture('signup', NOW);
    state.attendance[0].nodes.push({ pointId: 'pt-taian', evidence: { at: NOW, by: 'u-owner', note: '已有节点记录' } });
    const input = inputOf(state.activities[0]);
    input.routeSnapshot.points = input.routeSnapshot.points.filter(p => p.id !== 'pt-taian');
    fails(state, { type: 'activity.edit', activityId: 'a1', input }, 'INVALID_INPUT');
  });

  it.each(['gathering', 'active'] as const)('limits %s changes to operational notes and end extension', phase => {
    const state = createFixture(phase, NOW);
    const input = inputOf(state.activities[0]);
    const next = apply(state, { type: 'activity.edit', activityId: 'a1', input: { ...input, description: '新版说明', equipment: ['雨衣'], endAt: '2026-09-26T20:00:00+08:00' } });
    expect(next.activities[0].description).toBe('新版说明');
    fails(state, { type: 'activity.edit', activityId: 'a1', input: { ...input, capacity: 25 } }, 'WRONG_PHASE');
    fails(state, { type: 'activity.edit', activityId: 'a1', input: { ...input, endAt: '2026-09-26T17:00:00+08:00' } }, 'WRONG_PHASE');
  });

  it.each(['closing', 'archived', 'cancelled'] as const)('treats %s as read only', phase => {
    const state = createFixture('empty', NOW);
    const a = structuredClone(createFixture('signup', NOW).activities[0]);
    a.phase = phase;
    a.acceptingSignups = false;
    state.routes = createFixture('signup', NOW).routes;
    state.activities.push(a);
    fails(state, { type: 'activity.edit', activityId: a.id, input: { ...inputOf(a), description: '不可修改' } }, 'WRONG_PHASE');
  });
});

describe('activity transitions preserve safety facts', () => {
  it('requires publish command and rejects skipped transitions', () => {
    const state = draft();
    fails(state, { type: 'activity.transition', activityId: state.activities[0].id, next: 'published', reason: '' }, 'WRONG_PHASE');
    fails(createFixture('signup', NOW), { type: 'activity.transition', activityId: 'a1', next: 'active', reason: '' }, 'WRONG_PHASE');
  });

  it('requires all pending applications reviewed before gathering and stops accepting', () => {
    const state = createFixture('signup', NOW);
    fails(state, { type: 'activity.transition', activityId: 'a1', next: 'gathering', reason: '' }, 'UNRESOLVED_DEPARTURE');
    const next = apply(createFixture('transport', NOW), { type: 'activity.transition', activityId: 'a1', next: 'gathering', reason: '' });
    expect(next.activities[0]).toMatchObject({ phase: 'gathering', acceptingSignups: false });
  });

  it('requires known departures, check-in and shared passenger outbound boarding', () => {
    fails(createFixture('gathering', NOW), { type: 'activity.transition', activityId: 'a1', next: 'active', reason: '' }, 'UNRESOLVED_DEPARTURE');
    const state = readyToStart();
    state.attendance[0].departure!.kind = 'joined';
    state.attendance[0].checkIn = null;
    fails(state, { type: 'activity.transition', activityId: 'a1', next: 'active', reason: '' }, 'UNRESOLVED_DEPARTURE');
    state.attendance[0].checkIn = { method: 'manual', evidence: { at: NOW, by: 'u-owner', note: '' } };
    fails(state, { type: 'activity.transition', activityId: 'a1', next: 'active', reason: '' }, 'UNRESOLVED_DEPARTURE');
    state.attendance[0].boardingByLeg.outbound = { at: NOW, by: 'u-owner', note: '已上车' };
    expect(apply(state, { type: 'activity.transition', activityId: 'a1', next: 'active', reason: '' }).activities[0].phase).toBe('active');
  });

  it('permits joined participant drivers without a passenger boarding fact', () => {
    const state = readyToStart();
    state.attendance[0].departure!.kind = 'joined';
    state.vehicles[0].drivers = [{ kind: 'participant', signupId: state.signups[0].id }];
    state.assignments = state.assignments.filter(a => a.signupId !== state.signups[0].id);
    expect(apply(state, { type: 'activity.transition', activityId: 'a1', next: 'active', reason: '' }).activities[0].phase).toBe('active');
  });

  it('opens unresolved late incidents for coordinating people', () => {
    const state = readyToStart();
    state.attendance[0].departure!.kind = 'coordinating';
    const next = apply(state, { type: 'activity.transition', activityId: 'a1', next: 'active', reason: '继续协调' });
    expect(next.incidents).toEqual([expect.objectContaining({ kind: 'late', subjectIds: [state.signups[0].id], resolution: null, opened: expect.objectContaining({ at: NOW, by: 'u-owner' }) })]);
    expect(next.attendance[0].departure!.kind).toBe('coordinating');
  });

  it('requires closing reason and retains location/boarding evidence', () => {
    const state = createFixture('active', NOW);
    fails(state, { type: 'activity.transition', activityId: 'a1', next: 'closing', reason: '  ' }, 'INVALID_INPUT');
    const next = apply(state, { type: 'activity.transition', activityId: 'a1', next: 'closing', reason: '结束行程，跟进到家' });
    expect(next.activities[0]).toMatchObject({ phase: 'closing', acceptingSignups: false });
    expect(next.positions).toEqual(state.positions);
    expect(next.attendance).toEqual(state.attendance);
  });

  it('archives only once departures, home and incidents are resolved', () => {
    const state = createFixture('closing', NOW);
    const command: Payload = { type: 'activity.transition', activityId: 'a1', next: 'archived', reason: '' };
    fails(state, command, 'UNRESOLVED_SAFETY');
    state.attendance.forEach(a => { a.home = { at: NOW, by: 'u-owner', note: '到家已核实' }; });
    fails(state, command, 'UNRESOLVED_SAFETY');
    state.incidents.forEach(i => { i.resolution = { at: NOW, by: 'u-owner', note: '已核实' }; });
    const next = apply(state, command);
    expect(next.activities[0].phase).toBe('archived');
    expect(next.attendance).toEqual(state.attendance);
  });

  it('cancels before departure, revokes positions and preserves check-in facts', () => {
    const state = createFixture('gathering', NOW);
    state.positions.push({ signupId: 's-lin', coordinates: { lat: 30, lng: 104 }, reportedAt: NOW, consentExpiresAt: state.activities[0].endAt!, revokedAt: null });
    const next = apply(state, { type: 'activity.transition', activityId: 'a1', next: 'cancelled', reason: '天气原因' });
    expect(next.signups.every(s => s.status === 'cancelled')).toBe(true);
    expect(next.assignments).toEqual([]);
    expect(next.positions[0].revokedAt).toBe(NOW);
    expect(next.attendance).toEqual(state.attendance);
    expect(next.vehicles).toEqual(state.vehicles);
  });

  it('never cancels an activity with joined people, departed vehicles or boarding history', () => {
    const payload: Payload = { type: 'activity.transition', activityId: 'a1', next: 'cancelled', reason: '取消' };
    const joined = createFixture('gathering', NOW);
    joined.attendance[0].departure = { kind: 'joined', evidence: { at: NOW, by: 'u-owner', note: '' } };
    fails(joined, payload, 'UNRESOLVED_SAFETY');
    const departed = createFixture('gathering', NOW);
    departed.vehicles[0].legs.outbound.departed = { at: NOW, by: 'u-owner', note: '' };
    fails(departed, payload, 'UNRESOLVED_SAFETY');
    const boarded = createFixture('gathering', NOW);
    boarded.attendance[0].boardingByLeg.outbound = { at: NOW, by: 'u-owner', note: '' };
    fails(boarded, payload, 'UNRESOLVED_SAFETY');
  });
});

import { describe, expect, it } from 'vitest';
import {
  ActivitySchema, CoordinatesSchema, CountSchema, IdSchema, InstantSchema,
  MembershipSchema, ReturnPlanSchema, StateSchema, TextSchema, VehicleSchema,
} from '../src/domain/model';
import { canonicalPayload, PayloadSchema, type Payload } from '../src/domain/contracts';
import { createFixture, getWeather, type FixtureName } from '../src/data/fixtures';

// Deliberately independent of helpers.ts: commands.ts belongs to T04.
const NOW = '2026-09-24T07:00:00+08:00';
const names: FixtureName[] = [
  'empty', 'signup', 'transport', 'gathering', 'active', 'closing', 'archived', 'cross-day',
];

function statusCounts(name: FixtureName) {
  const state = createFixture(name, NOW);
  return {
    confirmed: state.signups.filter((s) => s.status === 'confirmed').length,
    pending: state.signups.filter((s) => s.status === 'pending').length,
    waitlisted: state.signups.filter((s) => s.status === 'waitlisted').length,
  };
}

describe('schema v1 fixtures', () => {
  it.each(names)('%s is valid JSON state with stable IDs', (name) => {
    const state = createFixture(name, NOW);
    expect(StateSchema.parse(state)).toEqual(state);
    expect(StateSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(createFixture(name, NOW)).toEqual(state);
    expect(state.savedAt).toBe(NOW);
  });

  it.each(names)('%s returns independent nested objects on every call', (name) => {
    const first = createFixture(name, NOW);
    const second = createFixture(name, NOW);
    expect(first).not.toBe(second);
    first.profiles[0].person.emergency.name = 'changed';
    first.profiles[0].companions.push({ id: 'test-companion', person: first.profiles[0].person });
    if (first.activities[0]) first.activities[0].routeSnapshot.points[0].name = 'changed';
    if (first.vehicles[0]) first.vehicles[0].pickupPointIds.push('changed');
    if (first.signups[0]) first.signups[0].participant.name = 'changed';
    expect(second).toEqual(createFixture(name, NOW));
  });

  it('rejects a different schema version', () => {
    expect(StateSchema.safeParse({ ...createFixture('empty', NOW), schemaVersion: 9 }).success).toBe(false);
  });

  it('empty has the fixed profiles and companion but no activities', () => {
    const state = createFixture('empty', NOW);
    expect(state.activities).toEqual([]);
    expect(state.signups).toEqual([]);
    expect(state.profiles.map((p) => [p.id, p.person.name])).toEqual([
      ['u-owner', '陈屿'], ['u-staff', '许安'], ['u-driver', '许川'], ['u-lin', '林溪'],
      ['u-zhou', '周遥'], ['u-new', '顾言'], ['u-other', '沈禾'],
    ]);
    expect(state.profiles.find((p) => p.id === 'u-zhou')?.companions[0]).toMatchObject({
      id: 'c-su', person: { name: '苏晴' },
    });
  });

  it('signup has 18 confirmed, 3 pending and 2 waitlisted with capacity 24', () => {
    expect(statusCounts('signup')).toEqual({ confirmed: 18, pending: 3, waitlisted: 2 });
    const state = createFixture('signup', NOW);
    expect(state.activities[0]).toMatchObject({ id: 'a1', title: '青城后山', capacity: 24, phase: 'published' });
    expect(state.signups.find((s) => s.id === 's-zhou')?.groupId).toBe('g-zhou');
    expect(state.signups.find((s) => s.id === 's-su')).toMatchObject({
      groupId: 'g-zhou', personRef: { kind: 'companion', ownerId: 'u-zhou', companionId: 'c-su' },
    });
  });

  it('transport has 21 confirmed including owner/staff, 15 assigned and 6 unassigned', () => {
    const state = createFixture('transport', NOW);
    expect(statusCounts('transport')).toEqual({ confirmed: 21, pending: 0, waitlisted: 0 });
    expect(state.signups.filter((s) => ['s-owner', 's-staff'].includes(s.id)).map((s) => s.status))
      .toEqual(['confirmed', 'confirmed']);
    expect(state.assignments).toHaveLength(15);
    expect(new Set(state.assignments.map((a) => a.signupId)).size).toBe(15);
    expect(state.signups.filter((s) => !state.assignments.some((a) => a.signupId === s.id))).toHaveLength(6);
    expect(state.assignments.every((a) => state.signups.some((s) => s.id === a.signupId && s.status === 'confirmed'))).toBe(true);
  });

  it('vehicles have 24 passenger seats after counting service drivers', () => {
    const { vehicles } = createFixture('transport', NOW);
    expect(vehicles[0]).toMatchObject({
      id: 'v1', legalCapacity: 19, blockedSeats: 0,
      drivers: [{ kind: 'service', userId: 'u-driver' }], pickupPointIds: ['p-chadianzi', 'p-xipu'],
    });
    expect(vehicles[0].seatLabels).toEqual(Array.from({ length: 18 }, (_, i) => String(i + 1).padStart(2, '0')));
    expect(vehicles[1]).toMatchObject({ id: 'v2', legalCapacity: 7, blockedSeats: 0, seatLabels: null });
    expect(vehicles.reduce((sum, v) => sum + v.legalCapacity - v.blockedSeats - v.drivers.filter((d) => d.kind === 'service').length, 0)).toBe(24);
  });

  it('memberships restrict staff to six people and vehicle contact to v1', () => {
    const state = createFixture('transport', NOW);
    const staff = state.memberships.find((m) => m.role === 'staff');
    expect(staff?.role).toBe('staff');
    if (staff?.role !== 'staff') throw new Error('Missing staff fixture');
    expect(staff.scope.kind).toBe('selected');
    if (staff.scope.kind === 'selected') expect(staff.scope.signupIds).toHaveLength(6);
    expect(staff.capabilities).toEqual(['roster', 'checkin', 'node', 'incident', 'position', 'home']);
    expect(Date.parse(staff.expiresAt)).toBeGreaterThanOrEqual(Date.parse(state.activities[0].endAt!));
    const contact = state.memberships.find((m) => m.role === 'vehicle_contact');
    expect(contact).toMatchObject({ userId: 'u-driver', vehicleId: 'v1' });
    expect(contact).not.toHaveProperty('capabilities');
    expect(MembershipSchema.safeParse({ ...contact, capabilities: ['sensitive'] }).success).toBe(false);
  });

  it('gathering has everyone assigned, some check-ins and no departures', () => {
    const state = createFixture('gathering', NOW);
    expect(state.activities[0].phase).toBe('gathering');
    expect(state.assignments).toHaveLength(21);
    const checked = state.attendance.filter((a) => a.checkIn !== null).length;
    expect(checked).toBeGreaterThan(0);
    expect(checked).toBeLessThan(21);
    expect(state.attendance.every((a) => a.departure === null)).toBe(true);
    expect(state.vehicles.every((v) => v.legs.outbound.departed === null)).toBe(true);
  });

  it('active has 21 joined and boarded, departed vehicles, eight positions and an open incident', () => {
    const state = createFixture('active', NOW);
    expect(state.activities[0].phase).toBe('active');
    expect(state.attendance).toHaveLength(21);
    expect(state.attendance.every((a) => a.departure?.kind === 'joined' && a.checkIn && a.boardingByLeg.outbound)).toBe(true);
    expect(state.vehicles.every((v) => v.legs.outbound.departed !== null)).toBe(true);
    expect(state.positions).toHaveLength(8);
    expect(state.positions.every((p) => p.consentExpiresAt === state.activities[0].endAt && p.revokedAt === null)).toBe(true);
    expect(state.incidents.filter((i) => i.resolution === null)).toHaveLength(1);
  });

  it('closing has 19 home, Lin and Su outstanding, and an open Su withdrawal', () => {
    const state = createFixture('closing', NOW);
    expect(state.activities[0].phase).toBe('closing');
    expect(state.attendance.filter((a) => a.departure?.kind === 'joined')).toHaveLength(21);
    expect(state.attendance.filter((a) => a.home !== null)).toHaveLength(19);
    expect(state.attendance.filter((a) => a.home === null).map((a) => a.signupId).sort()).toEqual(['s-lin', 's-su']);
    expect(state.incidents.filter((i) => i.resolution === null)).toEqual([
      expect.objectContaining({ kind: 'withdrawal', subjectIds: ['s-su'] }),
    ]);
    expect(state.attendance.find((a) => a.signupId === 's-su')?.returnPlan).toMatchObject({ kind: 'independent' });
  });

  it('archived has everyone joined and home with resolved incidents', () => {
    const state = createFixture('archived', NOW);
    expect(state.activities[0].phase).toBe('archived');
    expect(state.attendance).toHaveLength(21);
    expect(state.attendance.every((a) => a.departure?.kind === 'joined' && a.home !== null)).toBe(true);
    expect(state.incidents.every((i) => i.resolution !== null)).toBe(true);
  });

  it('records organizer verification rather than unauthorized proxy home confirmation', () => {
    const state = createFixture('archived', NOW);
    const signup = state.signups.find((s) => s.id === 's-su')!;
    const home = state.attendance.find((a) => a.signupId === signup.id)!.home!;
    expect(signup.consent.proxyHome).toBe(false);
    expect(home.by).toBe(state.activities[0].ownerId);
    expect(home.note).toContain('领队核实');
    expect(home.note).not.toContain('本人确认');
  });

  it('route, pickups, fee and cross-day dates carry complete content', () => {
    const activity = createFixture('signup', NOW).activities[0];
    expect(activity).toMatchObject({
      startAt: '2026-09-26T08:00:00+08:00', endAt: '2026-09-26T18:00:00+08:00',
      deadlineAt: '2026-09-25T20:00:00+08:00', routeSnapshot: { distanceKm: 12.8, ascentM: 680 },
    });
    expect(activity.routeSnapshot.points.map((p) => p.name)).toEqual(['泰安古镇', '飞泉沟', '白云索道下站']);
    expect(activity.pickupPoints.map((p) => [p.id, p.name, p.meetingAt])).toEqual([
      ['p-chadianzi', '茶店子', '2026-09-26T07:00:00+08:00'],
      ['p-xipu', '犀浦', '2026-09-26T07:20:00+08:00'],
    ]);
    expect(activity.feeNote).toContain('¥168');
    const second = createFixture('cross-day', NOW).activities.find((a) => a.id === 'a2')!;
    expect(second.startAt?.slice(0, 10)).toBe('2026-10-17');
    expect(second.endAt?.slice(0, 10)).toBe('2026-10-18');
  });

  it.each(names.filter((n) => !['empty', 'signup'].includes(n)))('%s contains a published, non-sensitive notice', (name) => {
    const state = createFixture(name, NOW);
    expect(state.notices.length).toBeGreaterThan(0);
    const summaries = [...state.notices.map((n) => n.content), ...state.events.map((e) => e.summary)].join(' ');
    for (const profile of state.profiles) {
      expect(profile.person.phone).toMatch(/^000000000\d{2}$/);
      expect(summaries).not.toContain(profile.person.phone);
      if (profile.person.medical) expect(summaries).not.toContain(profile.person.medical);
    }
  });
});

describe('schema boundaries', () => {
  it('uses trip.mode and checkIn.method at the integration boundary', () => {
    const state = createFixture('signup', NOW);
    const signup = { ...state.signups[0], trip: { mode: 'shared', pickupPointId: 'p-xipu' } };
    expect(StateSchema.safeParse({ ...state, signups: [signup] }).success).toBe(true);
    expect(PayloadSchema.safeParse({
      type: 'attendance.checkin', activityId: 'a1', signupId: 's-owner',
      checkIn: { method: 'manual', evidence: { at: NOW, by: 'u-owner', note: '签到' } },
    }).success).toBe(true);
  });

  it('validates IDs, text, counts, coordinates and offset timestamps without coercion', () => {
    expect(IdSchema.safeParse('').success).toBe(false);
    expect(IdSchema.safeParse('a'.repeat(121)).success).toBe(false);
    expect(TextSchema.safeParse('a'.repeat(2001)).success).toBe(false);
    expect(CountSchema.safeParse(-1).success).toBe(false);
    expect(CountSchema.safeParse(1.1).success).toBe(false);
    expect(CountSchema.safeParse('1').success).toBe(false);
    expect(CountSchema.safeParse(NaN).success).toBe(false);
    expect(CoordinatesSchema.safeParse({ lat: 91, lng: 0 }).success).toBe(false);
    expect(CoordinatesSchema.safeParse({ lat: 0, lng: -181 }).success).toBe(false);
    expect(CoordinatesSchema.safeParse({ lat: -90, lng: 180 }).success).toBe(true);
    expect(InstantSchema.safeParse(NOW).success).toBe(true);
    expect(InstantSchema.safeParse('2026-09-24T07:00:00').success).toBe(false);
  });

  it('requires valid capacities, drivers and explicit structured return plans', () => {
    const state = createFixture('transport', NOW);
    for (const capacity of [0, 501, 1.5]) {
      expect(ActivitySchema.safeParse({ ...state.activities[0], capacity }).success).toBe(false);
    }
    for (const legalCapacity of [0, 61]) {
      expect(VehicleSchema.safeParse({ ...state.vehicles[0], legalCapacity }).success).toBe(false);
    }
    expect(VehicleSchema.safeParse({ ...state.vehicles[0], drivers: [] }).success).toBe(false);
    expect(ReturnPlanSchema.safeParse({ kind: 'assigned' }).success).toBe(true);
    expect(ReturnPlanSchema.safeParse({ kind: 'independent', evidence: { at: NOW, by: 'u-owner', note: '自行返程' } }).success).toBe(true);
    expect(ReturnPlanSchema.safeParse('assigned').success).toBe(false);
    expect(ReturnPlanSchema.safeParse({ kind: 'independent' }).success).toBe(false);
    expect(state.attendance.every((a) => a.returnPlan.kind === 'assigned')).toBe(true);
  });
});

describe('command contracts', () => {
  it('validates payloads and rejects unknown operations or invalid JSON fields', () => {
    expect(PayloadSchema.safeParse({ type: 'position.report', activityId: 'a1', signupId: 's-lin', coordinates: { lat: 30, lng: 103 }, consent: true }).success).toBe(true);
    expect(PayloadSchema.safeParse({ type: 'not-a-command' }).success).toBe(false);
    expect(PayloadSchema.safeParse({ type: 'position.report', activityId: 'a1', signupId: 's-lin', coordinates: { lat: NaN, lng: 103 }, consent: true }).success).toBe(false);
    expect(PayloadSchema.safeParse({ type: 'profile.save', person: () => undefined }).success).toBe(false);
  });

  it('canonicalizes object keys recursively but keeps array order', () => {
    const first: Payload = {
      type: 'position.report', activityId: 'a1', signupId: 's-lin',
      coordinates: { lng: 103, lat: 30 }, consent: true,
    };
    const second: Payload = {
      consent: true, coordinates: { lat: 30, lng: 103 }, signupId: 's-lin', activityId: 'a1', type: 'position.report',
    };
    expect(canonicalPayload(first)).toBe(canonicalPayload(second));
    expect(canonicalPayload(first)).toBe('{"activityId":"a1","consent":true,"coordinates":{"lat":30,"lng":103},"signupId":"s-lin","type":"position.report"}');
    expect(canonicalPayload({ type: 'signup.promote', activityId: 'a1', signupIds: ['b', 'a'] }))
      .not.toBe(canonicalPayload({ type: 'signup.promote', activityId: 'a1', signupIds: ['a', 'b'] }));
  });
});

describe('deterministic weather', () => {
  it('returns fixed hourly data for valid points in the next 14 calendar days', () => {
    const activity = createFixture('signup', NOW).activities[0];
    const pointId = activity.routeSnapshot.points[0].id;
    const result = getWeather(activity, pointId, '2026-09-26', NOW);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected weather');
    expect(result.updatedAt).toBe(NOW);
    expect(result.hours.length).toBeGreaterThan(0);
    expect(result.hours.every((h) => h.at.startsWith('2026-09-26') && Number.isFinite(h.temperature) && Number.isFinite(h.precipitation) && typeof h.wind === 'string' && h.wind.length > 0)).toBe(true);
    expect(getWeather(activity, pointId, '2026-09-26', NOW)).toEqual(result);
    expect(getWeather(activity, pointId, '2026-10-08', NOW).status).toBe('ready');
    expect(getWeather(activity, pointId, '2026-10-09', NOW).status).toBe('out_of_range');
    expect(getWeather(activity, pointId, '2026-09-23', NOW).status).toBe('out_of_range');
  });

  it('returns unavailable for invalid points or invalid date strings', () => {
    const activity = createFixture('signup', NOW).activities[0];
    expect(getWeather(activity, 'missing', '2026-09-26', NOW).status).toBe('unavailable');
    expect(getWeather(activity, activity.routeSnapshot.points[0].id, '2026-02-30', NOW).status).toBe('unavailable');
  });
});

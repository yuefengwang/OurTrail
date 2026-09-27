import { describe, expect, it } from 'vitest';
import { createFixture } from '../src/data/fixtures';
import { reduceCommand } from '../src/domain/commands';
import type { ErrorCode, ParticipantInput, Payload } from '../src/domain/contracts';
import type { State } from '../src/domain/model';
import { NOW, apply, context, inputFor, makeCommand, must } from './helpers';

function fails(state: State, payload: Payload, code: ErrorCode, actor = 'u-owner', now = NOW) {
  const before = structuredClone(state);
  expect(reduceCommand(state, makeCommand(state, payload, actor), { ...context, now })).toMatchObject({ ok: false, error: { code } });
  expect(state).toEqual(before);
}
function submit(state: State, participants = [inputFor(state, 'u-new')], mode: 'apply' | 'waitlist' = 'apply'): Payload {
  return { type: 'signup.submit', activityId: 'a1', participants, keepTogether: true, mode };
}
function pair(state: State): ParticipantInput[] {
  const profile = state.profiles.find(p => p.id === 'u-new')!;
  profile.companions.push({ id: 'new-companion', person: structuredClone(profile.person) });
  const companion = inputFor(state, 'u-new');
  companion.personRef = { kind: 'companion', ownerId: 'u-new', companionId: 'new-companion' };
  companion.consent.proxyAuthority = true;
  return [inputFor(state, 'u-new'), companion];
}

describe('signup submission', () => {
  it.each(['manual', 'automatic'] as const)('creates snapshots, individual consent and default attendance in %s mode', approvalMode => {
    const state = createFixture('signup', NOW);
    state.activities[0].approvalMode = approvalMode;
    const participants = pair(state);
    participants[0].participant.name = '  新名字  ';
    participants[0].participant.phone = ' 12345 ';
    participants[0].participant.emergency.name = ' 紧急联系人 ';
    participants[0].participant.emergency.phone = ' 98765 ';
    const result = must(reduceCommand(state, makeCommand(state, submit(state, participants), 'u-new'), context));
    const records = result.state.signups.filter(s => result.targetIds.includes(s.id));
    expect(records).toHaveLength(2);
    expect(records.every(s => s.status === (approvalMode === 'manual' ? 'pending' : 'confirmed'))).toBe(true);
    expect(records[0].participant).toMatchObject({ name: '新名字', phone: '12345', emergency: { name: '紧急联系人', phone: '98765' } });
    expect(records[1].consent).toEqual({ at: NOW, recordedBy: 'u-new', dataUse: true, proxyAuthority: true, proxyHome: false });
    expect(result.state.attendance.filter(a => result.targetIds.includes(a.signupId))).toEqual(records.map(s => ({
      signupId: s.id, checkIn: null, boardingByLeg: { outbound: null, return: null }, departure: null,
      returnPlan: { kind: 'assigned' }, nodes: [], home: null,
    })));
    expect(result.state.profiles).toEqual(state.profiles);
  });

  it('requires nonempty input and all required contact fields', () => {
    const state = createFixture('signup', NOW);
    fails(state, submit(state, []), 'INVALID_INPUT', 'u-new');
    for (const field of ['name', 'phone', 'emergencyName', 'emergencyPhone'] as const) {
      const participant = inputFor(state, 'u-new');
      if (field === 'emergencyName') participant.participant.emergency.name = '  ';
      else if (field === 'emergencyPhone') participant.participant.emergency.phone = '  ';
      else participant.participant[field] = '  ';
      fails(state, submit(state, [participant]), 'INVALID_INPUT', 'u-new');
    }
  });

  it('requires each person data consent and companion proxy authority atomically', () => {
    const state = createFixture('signup', NOW);
    const participants = pair(state);
    participants[1].consent.dataUse = false;
    fails(state, submit(state, participants), 'CONSENT_REQUIRED', 'u-new');
    participants[1].consent.dataUse = true;
    participants[1].consent.proxyAuthority = false;
    fails(state, submit(state, participants), 'CONSENT_REQUIRED', 'u-new');
  });

  it('rejects foreign user/companion references and a removed companion', () => {
    const state = createFixture('signup', NOW);
    fails(state, submit(state, [inputFor(state, 'u-other')]), 'FORBIDDEN', 'u-new');
    const participant = inputFor(state, 'u-new');
    participant.personRef = { kind: 'companion', ownerId: 'u-zhou', companionId: 'c-su' };
    fails(state, submit(state, [participant]), 'FORBIDDEN', 'u-new');
    participant.personRef = { kind: 'companion', ownerId: 'u-new', companionId: 'removed' };
    fails(state, submit(state, [participant]), 'FORBIDDEN', 'u-new');
  });

  it('rejects duplicate people within a request and in every live status', () => {
    const state = createFixture('signup', NOW);
    fails(state, submit(state, [inputFor(state, 'u-new'), inputFor(state, 'u-new')]), 'DUPLICATE_PERSON', 'u-new');
    for (const status of ['pending', 'confirmed', 'waitlisted'] as const) {
      state.signups.find(s => s.id === 's-lin')!.status = status;
      fails(state, submit(state, [inputFor(state, 'u-lin')]), 'DUPLICATE_PERSON', 'u-lin');
    }
  });

  it('detects duplicates even when explicit waitlisting would otherwise have spare capacity', () => {
    const state = createFixture('signup', NOW);
    fails(state, submit(state, [inputFor(state, 'u-new'), inputFor(state, 'u-new')], 'waitlist'), 'DUPLICATE_PERSON', 'u-new');
    fails(state, submit(state, [inputFor(state, 'u-lin')], 'waitlist'), 'DUPLICATE_PERSON', 'u-lin');
  });

  it('capacity applies atomically to the whole group and waitlisting is explicit', () => {
    const state = createFixture('signup', NOW);
    state.activities[0].capacity = 22;
    const participants = pair(state);
    fails(state, submit(state, participants), 'CAPACITY', 'u-new');
    const next = apply(state, submit(state, participants, 'waitlist'), 'u-new');
    expect(next.signups.filter(s => s.submittedByUserId === 'u-new').map(s => s.status)).toEqual(['waitlisted', 'waitlisted']);
    fails(state, submit(state, [participants[0]], 'waitlist'), 'INVALID_INPUT', 'u-new');
  });

  it('does not accept signup when closed, after deadline, or outside published', () => {
    const state = createFixture('signup', NOW);
    state.activities[0].acceptingSignups = false;
    fails(state, submit(state), 'WRONG_PHASE', 'u-new');
    state.activities[0].acceptingSignups = true;
    fails(state, submit(state), 'WRONG_PHASE', 'u-new', state.activities[0].deadlineAt!);
    fails(createFixture('gathering', NOW), submit(state), 'WRONG_PHASE', 'u-new');
  });
});

describe('signup review and promotion', () => {
  it('confirms or rejects only selected pending applications', () => {
    const state = createFixture('signup', NOW);
    const pending = state.signups.filter(s => s.status === 'pending');
    const next = apply(state, { type: 'signup.review', activityId: 'a1', signupIds: [pending[0].id], decision: 'confirm' });
    expect(next.signups.find(s => s.id === pending[0].id)!.status).toBe('confirmed');
    expect(next.signups.find(s => s.id === pending[1].id)!.status).toBe('pending');
    const rejected = apply(next, { type: 'signup.review', activityId: 'a1', signupIds: [pending[1].id], decision: 'reject' });
    expect(rejected.signups.find(s => s.id === pending[1].id)!.status).toBe('rejected');
  });

  it('rejects empty, repeated or mixed-status review targets atomically', () => {
    const state = createFixture('signup', NOW);
    const id = state.signups.find(s => s.status === 'pending')!.id;
    fails(state, { type: 'signup.review', activityId: 'a1', signupIds: [], decision: 'confirm' }, 'INVALID_INPUT');
    fails(state, { type: 'signup.review', activityId: 'a1', signupIds: [id, id], decision: 'confirm' }, 'INVALID_INPUT');
    fails(state, { type: 'signup.review', activityId: 'a1', signupIds: [id, 's-lin'], decision: 'confirm' }, 'WRONG_PHASE');
  });

  it('promotes whole keep-together groups to pending even under automatic approval', () => {
    let state = createFixture('signup', NOW);
    state.activities[0].capacity = 21;
    state.activities[0].approvalMode = 'automatic';
    state = apply(state, submit(state, pair(state), 'waitlist'), 'u-new');
    const ids = state.signups.filter(s => s.submittedByUserId === 'u-new').map(s => s.id);
    state.activities[0].capacity = 24;
    fails(state, { type: 'signup.promote', activityId: 'a1', signupIds: [ids[0]] }, 'GROUP_SCOPE');
    const next = apply(state, { type: 'signup.promote', activityId: 'a1', signupIds: ids });
    expect(next.signups.filter(s => ids.includes(s.id)).map(s => s.status)).toEqual(['pending', 'pending']);
  });

  it('promotes only the remaining waitlisted group after an explicit member cancellation', () => {
    let state = createFixture('signup', NOW);
    state.activities[0].capacity = 21;
    state = apply(state, submit(state, pair(state), 'waitlist'), 'u-new');
    const ids = state.signups.filter(s => s.submittedByUserId === 'u-new').map(s => s.id);
    state = apply(state, { type: 'signup.cancel', activityId: 'a1', signupIds: [ids[0]], reason: '' }, 'u-new');
    state.activities[0].capacity = 22;
    const next = apply(state, { type: 'signup.promote', activityId: 'a1', signupIds: [ids[1]] });
    expect(next.signups.find(s => s.id === ids[0])!.status).toBe('cancelled');
    expect(next.signups.find(s => s.id === ids[1])!.status).toBe('pending');
  });

  it('does not partially promote when capacity is insufficient', () => {
    let state = createFixture('signup', NOW);
    state.activities[0].capacity = 21;
    state = apply(state, submit(state, pair(state), 'waitlist'), 'u-new');
    const ids = state.signups.filter(s => s.submittedByUserId === 'u-new').map(s => s.id);
    fails(state, { type: 'signup.promote', activityId: 'a1', signupIds: ids }, 'CAPACITY');
  });
});

describe('signup cancellation, editing and group scope', () => {
  it('cancels only selected owned companion and releases its assignment/position', () => {
    const state = createFixture('transport', NOW);
    state.positions.push({ signupId: 's-su', coordinates: { lat: 30, lng: 104 }, reportedAt: NOW, consentExpiresAt: state.activities[0].endAt!, revokedAt: null });
    const next = apply(state, { type: 'signup.cancel', activityId: 'a1', signupIds: ['s-su'], reason: '同行人取消' }, 'u-zhou');
    expect(next.signups.find(s => s.id === 's-su')!.status).toBe('cancelled');
    expect(next.signups.find(s => s.id === 's-zhou')).toEqual(state.signups.find(s => s.id === 's-zhou'));
    expect(next.assignments.some(a => a.signupId === 's-su')).toBe(false);
    expect(next.assignments.find(a => a.signupId === 's-zhou')).toEqual(state.assignments.find(a => a.signupId === 's-zhou'));
    expect(next.positions[0].revokedAt).toBe(NOW);
    expect(next.attendance).toEqual(state.attendance);
  });

  it('owner removal marks other participants removed and own signup cancelled', () => {
    const state = createFixture('transport', NOW);
    const next = apply(state, { type: 'signup.cancel', activityId: 'a1', signupIds: ['s-lin', 's-owner'], reason: '核对名单' });
    expect(next.signups.find(s => s.id === 's-lin')!.status).toBe('removed');
    expect(next.signups.find(s => s.id === 's-owner')!.status).toBe('cancelled');
  });

  it('requires replacing participant drivers before cancellation', () => {
    const state = createFixture('transport', NOW);
    state.vehicles[0].drivers = [{ kind: 'participant', signupId: 's-lin' }];
    state.assignments = state.assignments.filter(a => a.signupId !== 's-lin');
    fails(state, { type: 'signup.cancel', activityId: 'a1', signupIds: ['s-lin'], reason: '' }, 'DRIVER_CONFLICT');
  });

  it.each(['boarded', 'returnBoarded', 'joined', 'vehicleDeparted'] as const)('preserves historical evidence on %s cancellation/edit attempts', evidence => {
    const state = createFixture('gathering', NOW);
    const attendance = state.attendance.find(a => a.signupId === 's-lin')!;
    const fact = { at: NOW, by: 'u-owner', note: '历史事实' };
    if (evidence === 'boarded') attendance.boardingByLeg.outbound = fact;
    if (evidence === 'returnBoarded') attendance.boardingByLeg.return = fact;
    if (evidence === 'joined') attendance.departure = { kind: 'joined', evidence: fact };
    if (evidence === 'vehicleDeparted') state.vehicles[0].legs.outbound.departed = fact;
    fails(state, { type: 'signup.cancel', activityId: 'a1', signupIds: ['s-su', 's-lin'], reason: '取消' }, 'WRONG_PHASE');
    fails(state, { type: 'signup.edit', activityId: 'a1', signupId: 's-lin', participant: state.signups.find(s => s.id === 's-lin')!.participant, trip: { mode: 'self' }, purpose: '协调资料' }, 'WRONG_PHASE');
  });

  it('edits only the selected snapshot and releases assignment when trip changes', () => {
    const state = createFixture('transport', NOW);
    const person = structuredClone(state.signups.find(s => s.id === 's-su')!.participant);
    person.phone = ' 123456 ';
    const next = apply(state, { type: 'signup.edit', activityId: 'a1', signupId: 's-su', participant: person, trip: { mode: 'self' }, purpose: '' }, 'u-zhou');
    expect(next.signups.find(s => s.id === 's-su')!.participant.phone).toBe('123456');
    expect(next.assignments.some(a => a.signupId === 's-su')).toBe(false);
    expect(next.profiles).toEqual(state.profiles);
    expect(next.signups.find(s => s.id === 's-zhou')).toEqual(state.signups.find(s => s.id === 's-zhou'));
    expect(next.attendance).toEqual(state.attendance);
  });

  it('only owner can coordinate gathering edits and nobody edits active/closing', () => {
    const state = createFixture('gathering', NOW);
    const payload: Payload = { type: 'signup.edit', activityId: 'a1', signupId: 's-lin', participant: state.signups.find(s => s.id === 's-lin')!.participant, trip: { mode: 'self' }, purpose: '集合协调' };
    fails(state, payload, 'WRONG_PHASE', 'u-lin');
    expect(apply(state, payload).signups.find(s => s.id === 's-lin')!.trip.mode).toBe('self');
    fails(createFixture('active', NOW), payload, 'WRONG_PHASE');
    fails(createFixture('closing', NOW), payload, 'WRONG_PHASE');
    const published = createFixture('transport', NOW);
    fails(published, payload, 'WRONG_PHASE', 'u-lin', published.activities[0].deadlineAt!);
  });

  it('explicit split permission is required and cannot be undone across vehicles', () => {
    let state = createFixture('transport', NOW);
    state = apply(state, { type: 'group.setTogether', activityId: 'a1', groupId: 'g-zhou', keepTogether: false }, 'u-zhou');
    const assignment = state.assignments.find(a => a.signupId === 's-su')!;
    assignment.vehicleId = 'v2';
    assignment.seatLabel = null;
    fails(state, { type: 'group.setTogether', activityId: 'a1', groupId: 'g-zhou', keepTogether: true }, 'GROUP_SCOPE', 'u-zhou');
    fails(state, { type: 'group.setTogether', activityId: 'a1', groupId: 'g-zhou', keepTogether: true }, 'FORBIDDEN', 'u-lin');
  });
});

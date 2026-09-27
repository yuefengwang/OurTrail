import { expect, it } from 'vitest';
import type { ActivityInput } from '../src/domain/contracts';
import { createFixture } from '../src/data/fixtures';
import { reduceCommand } from '../src/domain/commands';
import { assertInvariants } from '../src/domain/invariants';
import { NOW, context, inputFor, makeCommand, must, apply } from './helpers';

it('从新活动到安全归档使用同一套事实', () => {
  let state = createFixture('empty', NOW);
  const source = createFixture('signup', NOW).activities.find(a => a.id === 'a1')!;
  const { id, ownerId, phase, ...template } = source;
  const input: ActivityInput = { ...template, routeId: null, capacity: 4, approvalMode: 'manual' };
  const created = must(reduceCommand(state, makeCommand(state, { type: 'activity.create', input }), context));
  state = created.state;
  const activityId = created.targetIds[0];
  state = apply(state, { type: 'activity.publish', activityId, participation: null });
  expect(state.signups.filter(s => s.activityId === activityId)).toHaveLength(0);
  const submitted = must(reduceCommand(state, makeCommand(state, {
    type: 'signup.submit', activityId, participants: [inputFor(state, 'u-new')],
    keepTogether: true, mode: 'apply',
  }, 'u-new'), context));
  state = submitted.state;
  const signupId = submitted.targetIds[0];
  expect(state.signups.find(s => s.id === signupId)?.status).toBe('pending');
  state = apply(state, { type: 'signup.review', activityId, signupIds: [signupId], decision: 'confirm' });
  const savedVehicle = must(reduceCommand(state, makeCommand(state, {
    type: 'vehicle.save', activityId, vehicleId: null,
    input: {
      label: '测试1号车', plate: '演示车01', legalCapacity: 7,
      drivers: [{ kind: 'service', name: '许川', phone: '00000000003', userId: 'u-driver' }],
      blockedSeats: 0, seatLabels: null, pickupPointIds: ['p-xipu'],
    },
  }), context));
  state = savedVehicle.state;
  const vehicleId = savedVehicle.targetIds[0];
  state = apply(state, {
    type: 'membership.save', activityId,
    membership: {
      id: 'm-driver-lifecycle', activityId, userId: 'u-driver', role: 'vehicle_contact',
      vehicleId, expiresAt: source.endAt!,
    },
  });
  state = apply(state, { type: 'assignment.set', activityId, target: { signupId, vehicleId, seatLabel: null } });
  state = apply(state, { type: 'notice.publish', activityId, audience: { kind: 'activity' }, content: '集合与车辆已安排。' });
  state = apply(state, { type: 'activity.transition', activityId, next: 'gathering', reason: '开始集合' });
  state = apply(state, {
    type: 'attendance.checkin', activityId, signupId,
    checkIn: { method: 'manual', evidence: { at: NOW, by: 'u-owner', note: '现场见到本人' } },
  });
  expect(state.attendance.find(a => a.signupId === signupId)?.boardingByLeg.outbound).toBeNull();
  state = apply(state, {
    type: 'attendance.board', activityId, signupId, leg: 'outbound', boarded: true, note: '已在车上',
  }, 'u-driver');
  state = apply(state, {
    type: 'attendance.departure', activityId, signupId,
    outcome: { kind: 'joined', evidence: { at: NOW, by: 'u-owner', note: '核实随队出发' } },
  });
  state = apply(state, {
    type: 'vehicle.depart', activityId, vehicleId, leg: 'outbound', note: '人数核对完成',
  }, 'u-driver');
  state = apply(state, { type: 'activity.transition', activityId, next: 'active', reason: '开始行程' });
  const incident = must(reduceCommand(state, makeCommand(state, {
    type: 'incident.report', activityId, signupIds: [signupId], kind: 'withdrawal',
    description: '合成示例：中途下撤，领队跟进。',
  }), context));
  state = apply(incident.state, {
    type: 'attendance.returnPlan', activityId, signupId, plan: 'independent', note: '领队核实由接应人员送回',
  });
  state = apply(state, {
    type: 'activity.transition', activityId, next: 'closing', reason: '行程结束，继续安全确认',
  });
  state = apply(state, { type: 'attendance.home', activityId, signupId, note: '本人已到家' }, 'u-new');
  const before = structuredClone(state);
  const blocked = reduceCommand(state, makeCommand(state, {
    type: 'activity.transition', activityId, next: 'archived', reason: '尝试归档',
  }), context);
  expect(blocked).toMatchObject({ ok: false, error: { code: 'UNRESOLVED_SAFETY' } });
  expect(state).toEqual(before);
  state = apply(state, {
    type: 'incident.resolve', activityId, incidentId: incident.targetIds[0], note: '下撤接应和安全结果已核实',
  });
  state = apply(state, { type: 'activity.transition', activityId, next: 'archived', reason: '安全缺口全部关闭' });
  expect(state.activities.find(a => a.id === activityId)?.phase).toBe('archived');
  expect(state.signups.find(s => s.id === signupId)?.status).toBe('confirmed');
  const attendance = state.attendance.find(a => a.signupId === signupId)!;
  expect(attendance.boardingByLeg.outbound).not.toBeNull();
  expect(attendance.boardingByLeg.return).toBeNull();
  expect(attendance.returnPlan.kind).toBe('independent');
  expect(assertInvariants(state)).toEqual({ ok: true, value: null });
});

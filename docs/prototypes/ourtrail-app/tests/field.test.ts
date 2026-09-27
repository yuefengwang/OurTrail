import { expect, it } from 'vitest';
import { createFixture } from '../src/data/fixtures';
import { reduceCommand } from '../src/domain/commands';
import { NOW, context, makeCommand, apply } from './helpers';

it('人工签到采用当前身份和时间，不代写上车', () => {
  const state = createFixture('gathering', NOW);
  const next = apply(state, { type: 'attendance.checkin', activityId: 'a1', signupId: 's-walker-10', checkIn: { method: 'manual', evidence: { at: '2020-01-01T00:00:00Z', by: 'u-other', note: '现场核对本人' } } });
  const record = next.attendance.find(a => a.signupId === 's-walker-10')!;
  expect(record.checkIn?.evidence).toEqual({ at: NOW, by: 'u-owner', note: '现场核对本人' });
  expect(record.boardingByLeg.outbound).toBeNull();
});

it('到家不会解决异常，无代报授权的提交者不能操作', () => {
  const state = createFixture('closing', NOW);
  const payload = { type: 'attendance.home' as const, activityId: 'a1', signupId: 's-su', note: '电话核实已到家' };
  expect(reduceCommand(state, makeCommand(state, payload, 'u-zhou'), context)).toMatchObject({ ok: false, error: { code: 'CONSENT_REQUIRED' } });
  const next = apply(state, payload);
  expect(next.attendance.find(a => a.signupId === 's-su')!.home).toMatchObject({ by: 'u-owner' });
  expect(next.incidents[0].resolution).toBeNull();
});

it('到家只在收尾且实际出行后，司机完成车辆不代表到家', () => {
  const state = createFixture('active', NOW);
  expect(reduceCommand(state, makeCommand(state, { type: 'attendance.home', activityId: 'a1', signupId: 's-lin', note: '' }, 'u-lin'), context)).toMatchObject({ ok: false, error: { code: 'WRONG_PHASE' } });
  const next = apply(state, { type: 'vehicle.complete', activityId: 'a1', vehicleId: 'v1', leg: 'outbound', note: '抵达' }, 'u-driver');
  expect(next.attendance.every(a => !a.home)).toBe(true);
});

it('实际出行者不能降级为未出发', () => {
  const state = createFixture('active', NOW);
  const next = reduceCommand(state, makeCommand(state, { type: 'attendance.departure', activityId: 'a1', signupId: 's-lin', outcome: { kind: 'not_departed', evidence: { at: NOW, by: 'u-owner', note: '不再参加' } } }), context);
  expect(next.ok).toBe(false);
  expect(state.attendance.find(a => a.signupId === 's-lin')!.departure?.kind).toBe('joined');
});

it('位置逐次同意，过期和收尾拒绝新增，撤回可在归档执行', () => {
  const state = createFixture('active', NOW);
  const payload = { type: 'position.report' as const, activityId: 'a1', signupId: 's-lin', coordinates: { lat: 30, lng: 103 }, consent: false };
  expect(reduceCommand(state, makeCommand(state, payload, 'u-lin'), context)).toMatchObject({ ok: false, error: { code: 'CONSENT_REQUIRED' } });
  state.activities[0].endAt = NOW;
  expect(reduceCommand(state, makeCommand(state, { ...payload, consent: true }, 'u-lin'), context).ok).toBe(false);
  const closing = createFixture('closing', NOW);
  expect(reduceCommand(closing, makeCommand(closing, { ...payload, consent: true }, 'u-lin'), context)).toMatchObject({ ok: false, error: { code: 'WRONG_PHASE' } });
  const archived = apply(createFixture('archived', NOW), { type: 'position.revoke', activityId: 'a1', signupId: 's-lin' }, 'u-lin');
  expect(archived.positions.find(p => p.signupId === 's-lin')!.revokedAt).toBe(NOW);
});

it('下撤保留资格和去程，另行返程不需要返程上车', () => {
  const state = createFixture('active', NOW);
  const next = apply(state, { type: 'attendance.returnPlan', activityId: 'a1', signupId: 's-su', plan: 'independent', note: '电话核实家人接回' });
  expect(next.signups.find(s => s.id === 's-su')!.status).toBe('confirmed');
  expect(next.assignments).toEqual(state.assignments);
  expect(next.attendance.find(a => a.signupId === 's-su')!.boardingByLeg.outbound).not.toBeNull();
  expect(reduceCommand(next, makeCommand(next, { type: 'attendance.board', activityId: 'a1', signupId: 's-su', leg: 'return', boarded: true, note: '' }), context).ok).toBe(false);
});

it('车辆出发必须清点所有本车乘客，不能自动填缺失事实', () => {
  const state = createFixture('gathering', NOW);
  const before = structuredClone(state);
  expect(reduceCommand(state, makeCommand(state, { type: 'vehicle.depart', activityId: 'a1', vehicleId: 'v1', leg: 'outbound', note: '' }, 'u-driver'), context)).toMatchObject({ ok: false, error: { code: 'UNRESOLVED_DEPARTURE' } });
  expect(state).toEqual(before);
});

it('去返程分别保存，上车后发车不允许抹去上车事实', () => {
  const state = createFixture('active', NOW);
  const next = apply(state, { type: 'attendance.board', activityId: 'a1', signupId: 's-lin', leg: 'return', boarded: true, note: '返程清点' }, 'u-driver');
  expect(next.attendance.find(a => a.signupId === 's-lin')!.boardingByLeg.return).toMatchObject({ by: 'u-driver' });
  expect(next.attendance.find(a => a.signupId === 's-lin')!.boardingByLeg.outbound).toEqual(state.attendance.find(a => a.signupId === 's-lin')!.boardingByLeg.outbound);
  expect(reduceCommand(state, makeCommand(state, { type: 'attendance.board', activityId: 'a1', signupId: 's-lin', leg: 'outbound', boarded: false, note: '删除' }), context).ok).toBe(false);
});

it('本人模拟定位不能伪造他人签到，待确认者不能签到', () => {
  const state = createFixture('gathering', NOW);
  expect(reduceCommand(state, makeCommand(state, { type: 'attendance.checkin', activityId: 'a1', signupId: 's-lin', checkIn: { method: 'simulation', evidence: { at: NOW, by: 'u-owner', note: '模拟' }, coordinates: { lat: 30, lng: 103 } } }), context).ok).toBe(false);
  const pending = createFixture('signup', NOW);
  pending.activities[0].phase = 'gathering';
  expect(reduceCommand(pending, makeCommand(pending, { type: 'attendance.checkin', activityId: 'a1', signupId: pending.signups.find(s => s.status === 'pending')!.id, checkIn: { method: 'manual', evidence: { at: NOW, by: 'u-owner', note: '到达' } } }), context).ok).toBe(false);
});

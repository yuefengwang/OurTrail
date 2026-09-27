import { expect, it } from 'vitest';
import { createFixture } from '../src/data/fixtures';
import { reduceCommand } from '../src/domain/commands';
import { selectView, selectSensitive } from '../src/domain/selectors';
import { NOW, context, makeCommand, must, apply } from './helpers';

it('更新常用资料不会改历史报名快照', () => {
  const state = createFixture('transport', NOW);
  const signup = structuredClone(state.signups.find(s => s.id === 's-lin'));
  const person = state.profiles.find(p => p.id === 'u-lin')!.person;
  const next = apply(state, { type: 'profile.save', person: { ...person, phone: '00000000099' } }, 'u-lin');
  expect(next.signups.find(s => s.id === 's-lin')).toEqual(signup);
  expect(next.profiles.find(p => p.id === 'u-lin')!.person.phone).toBe('00000000099');
});

it('删除常用同行人保留历史身份及履约，不再接受旧条目新增报名', () => {
  const state = createFixture('transport', NOW);
  const old = structuredClone(state.signups.find(s => s.id === 's-su'));
  const next = apply(state, { type: 'companion.remove', companionId: 'c-su' }, 'u-zhou');
  expect(next.profiles.find(p => p.id === 'u-zhou')!.companions).toEqual([]);
  expect(next.signups.find(s => s.id === 's-su')).toEqual(old);
  expect(next.attendance).toEqual(state.attendance);
});

it('撤销授权立即影响读取，旧请求回执不能恢复权限', () => {
  const state = createFixture('gathering', NOW);
  const command = makeCommand(state, { type: 'attendance.checkin', activityId: 'a1', signupId: 's-lin', checkIn: { method: 'manual', evidence: { at: NOW, by: 'u-staff', note: '现场核实' } } }, 'u-staff');
  const checked = must(reduceCommand(state, command, context)).state;
  const next = apply(checked, { type: 'membership.revoke', activityId: 'a1', membershipId: 'm-staff' });
  expect(selectView(next, { userId: 'u-staff' }, { kind: 'activity', activityId: 'a1', perspective: 'staff' }, NOW)).toMatchObject({ kind: 'denied' });
  expect(reduceCommand(next, command, context)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
});

it('更换车辆联系人同时移除旧关系且不改司机或乘车人', () => {
  const state = createFixture('transport', NOW);
  const next = apply(state, { type: 'membership.save', activityId: 'a1', membership: {
    id: 'm-replacement', role: 'vehicle_contact', activityId: 'a1', userId: 'u-new', vehicleId: 'v1', expiresAt: '2026-09-27T00:00:00+08:00',
  } });
  expect(next.memberships.filter(m => m.role === 'vehicle_contact' && m.vehicleId === 'v1')).toHaveLength(1);
  expect(selectView(next, { userId: 'u-driver' }, { kind: 'activity', activityId: 'a1', perspective: 'vehicle' }, NOW)).toMatchObject({ kind: 'denied' });
  expect(next.vehicles).toEqual(state.vehicles);
  expect(next.assignments).toEqual(state.assignments);
});

it('拒绝已经过期的新增授权和归档后的工作修改', () => {
  for (const name of ['transport', 'archived'] as const) {
    const state = createFixture(name, NOW);
    const membership = { ...state.memberships[0], expiresAt: name === 'transport' ? NOW : '2026-09-27T00:00:00+08:00' };
    expect(reduceCommand(state, makeCommand(state, { type: 'membership.save', activityId: 'a1', membership }), context).ok).toBe(false);
  }
  expect(selectSensitive(createFixture('archived', NOW), { userId: 'u-owner' }, 'a1', 's-lin', '历史查看', NOW)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
});

import { describe, expect, it } from 'vitest';
import { createFixture } from '../src/data/fixtures';
import { assertInvariants } from '../src/domain/invariants';

const now = '2026-09-24T07:00:00+08:00';
describe('跨记录约束', () => {
  it.each(['empty', 'signup', 'transport', 'gathering', 'active', 'closing', 'archived', 'cross-day'] as const)(
    '%s 样本事实有效', name => {
      expect(assertInvariants(createFixture(name, now))).toEqual({ ok: true, value: null });
    },
  );
  it('不以负数截断掩盖超卖', () => {
    const state = createFixture('transport', now);
    state.activities[0].capacity = 20;
    expect(assertInvariants(state)).toMatchObject({ ok: false, error: { code: 'CAPACITY' } });
  });
  it('拒绝重复座位而非悄悄换号', () => {
    const state = createFixture('transport', now);
    state.assignments[1].seatLabel = state.assignments[0].seatLabel;
    state.assignments[1].vehicleId = state.assignments[0].vehicleId;
    expect(assertInvariants(state)).toMatchObject({ ok: false, error: { code: 'SEAT_TAKEN' } });
  });
  it('不存在的报名不能出现在车上', () => {
    const state = createFixture('transport', now);
    state.assignments[0].signupId = 'missing-person';
    expect(assertInvariants(state)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });
  it('归档必须所有出行者到家且异常已结', () => {
    const state = createFixture('closing', now);
    state.activities[0].phase = 'archived';
    expect(assertInvariants(state)).toMatchObject({ ok: false, error: { code: 'UNRESOLVED_SAFETY' } });
  });
  it('没有座号也必须遵守核载', () => {
    const state = createFixture('transport', now);
    const car = state.vehicles.find(v => v.id === 'v1')!;
    car.seatLabels = null;
    car.legalCapacity = 2;
    state.assignments.filter(a => a.vehicleId === car.id).forEach(a => { a.seatLabel = null; });
    expect(assertInvariants(state)).toMatchObject({ ok: false, error: { code: 'VEHICLE_FULL' } });
  });
});

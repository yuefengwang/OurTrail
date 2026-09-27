import { expect, it, vi } from 'vitest';
import { createFixture } from '../src/data/fixtures';
import { createStore, loadSnapshot, STORAGE_KEY } from '../src/data/store';
import { reduceCommand } from '../src/domain/commands';
import { NOW, context, makeCommand, must } from './helpers';

it('保存失败不发布任何内存成功状态', () => {
  const initial = createFixture('empty', NOW);
  const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  const store = createStore(initial, storage, context);
  const notify = vi.fn();
  store.subscribe(notify);
  const before = store.getSnapshot();
  const result = store.dispatch(makeCommand(initial, {
    type: 'profile.save', person: { ...initial.profiles[0].person, name: '更新后的合成姓名' },
  }, initial.profiles[0].id));
  expect(result).toMatchObject({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } });
  expect(store.getSnapshot()).toBe(before);
  expect(notify).not.toHaveBeenCalled();
});

it('未写入时快照稳定，保存成功之后才通知订阅者', () => {
  const initial = createFixture('empty', NOW);
  const save = vi.fn();
  const store = createStore(initial, { getItem: () => null, setItem: save }, context);
  expect(store.getSnapshot()).toBe(store.getSnapshot());
  const notify = vi.fn(() => expect(save).toHaveBeenCalledOnce());
  const unsubscribe = store.subscribe(notify);
  const result = store.dispatch(makeCommand(initial, {
    type: 'profile.save', person: { ...initial.profiles[0].person, name: '新的姓名' },
  }));
  expect(result.ok).toBe(true);
  expect(store.getSnapshot()).not.toBe(initial);
  expect(notify).toHaveBeenCalledOnce();
  unsubscribe();
  const next = store.getSnapshot();
  store.dispatch(makeCommand(next, { type: 'profile.save', person: next.profiles[0].person }));
  expect(notify).toHaveBeenCalledOnce();
});

it('相同请求重放不重复事件或版本，异内容重用请求号被拒绝', () => {
  const state = createFixture('empty', NOW);
  const command = makeCommand(state, { type: 'profile.save', person: state.profiles[0].person });
  const first = must(reduceCommand(state, command, context));
  const replay = must(reduceCommand(first.state, command, context));
  expect(replay.replayed).toBe(true);
  expect(replay.state).toBe(first.state);
  expect(replay.state.revision).toBe(state.revision + 1);
  const changed = makeCommand(first.state, {
    type: 'profile.save', person: { ...state.profiles[0].person, name: '另一份内容' },
  }, 'u-owner', { requestId: command.requestId });
  expect(reduceCommand(first.state, changed, context)).toMatchObject({
    ok: false, error: { code: 'REQUEST_REUSED' },
  });
});

it('旧版本提交失败且原状态不变', () => {
  const state = createFixture('empty', NOW);
  const before = structuredClone(state);
  const command = makeCommand(state, { type: 'profile.save', person: state.profiles[0].person },
    'u-owner', { expectedRevision: state.revision + 1 });
  expect(reduceCommand(state, command, context)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  expect(state).toEqual(before);
});

it('快照恢复先解析字段和跨记录约束，损坏时不覆盖原文', () => {
  const state = createFixture('transport', NOW);
  const save = vi.fn();
  const restored = must(loadSnapshot({ getItem: () => JSON.stringify(state), setItem: save }));
  expect(restored).toEqual(state);
  expect(save).not.toHaveBeenCalled();
  for (const raw of ['{invalid', JSON.stringify({ ...state, schemaVersion: 9 }),
    JSON.stringify({ ...state, assignments: [{ activityId: 'a1', signupId: 'missing', vehicleId: 'v1', seatLabel: null }] })]) {
    expect(loadSnapshot({ getItem: () => raw, setItem: save })).toMatchObject({
      ok: false, error: { code: 'CORRUPT_SNAPSHOT' },
    });
  }
  expect(save).not.toHaveBeenCalled();
});

it('不存在与不可读取的缓存分别返回空值和存储错误', () => {
  expect(loadSnapshot({ getItem: () => null, setItem: vi.fn() })).toEqual({ ok: true, value: null });
  expect(loadSnapshot({ getItem: () => { throw new Error('blocked'); }, setItem: vi.fn() }))
    .toMatchObject({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } });
});

it('只向本原型键持久化合成快照', () => {
  const state = createFixture('empty', NOW);
  const storage = { getItem: () => null, setItem: vi.fn() };
  const store = createStore(state, storage, context);
  store.dispatch(makeCommand(state, { type: 'profile.save', person: state.profiles[0].person }));
  expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, JSON.stringify(store.getSnapshot()));
});

it.each(['independent-return', 'waitlisted-boarded', 'boarding-without-assignment'])('拒绝恢复互相矛盾的履约快照：%s', scenario => {
  const state = createFixture(scenario === 'waitlisted-boarded' ? 'signup' : 'active', NOW);
  const signup = scenario === 'waitlisted-boarded' ? state.signups.find(s => s.status === 'waitlisted')! : state.signups.find(s => s.id === 's-lin')!;
  const record = state.attendance.find(a => a.signupId === signup.id)!;
  const evidence = { at: NOW, by: 'u-owner', note: '模拟矛盾的缓存记录' };
  if (scenario === 'independent-return') record.returnPlan = { kind: 'independent', evidence };
  if (scenario === 'boarding-without-assignment') state.assignments = state.assignments.filter(a => a.signupId !== signup.id);
  record.boardingByLeg.return = evidence;
  const save = vi.fn();
  expect(loadSnapshot({ getItem: () => JSON.stringify(state), setItem: save })).toMatchObject({ ok: false, error: { code: 'CORRUPT_SNAPSHOT' } });
  expect(save).not.toHaveBeenCalled();
});

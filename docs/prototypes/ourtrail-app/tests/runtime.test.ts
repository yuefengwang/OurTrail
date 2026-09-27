import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { createRuntime, DEMO_NOW, runtime } from '../src/app/runtime';
import { useCommand, useRuntimeVersion, useView } from '../src/app/useView';
import { createFixture, fixtureNames } from '../src/data/fixtures';
import { STORAGE_KEY } from '../src/data/store';
import { canonicalPayload, type Payload } from '../src/domain/contracts';

const hash = async (text: string) => createHash('sha256').update(text).digest('hex');
function setup(raw: string | null = null) {
  let saved = raw;
  let sequence = 0;
  const storage = { getItem: vi.fn(() => saved), setItem: vi.fn((_key: string, value: string) => { saved = value; }) };
  const digest = vi.fn(hash);
  const app = createRuntime({ storage, digest, id: kind => `${kind}-${++sequence}` });
  return { app, storage, digest, saved: () => saved };
}
function profilePayload(name = '修改后的合成姓名'): Payload {
  return { type: 'profile.save', person: { ...createFixture('signup', DEMO_NOW).profiles.find(p => p.id === 'u-lin')!.person, name } };
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('runtime persistence boundary', () => {
  it('seeds once before exposing views, keeps stable versions and exports no raw store', () => {
    const { app, storage } = setup();
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(storage.setItem.mock.calls[0][0]).toBe(STORAGE_KEY);
    expect(app.getActor()).toEqual({ userId: 'u-lin' });
    expect(app.getPerspective()).toBe('participant');
    expect(app.getNow()).toBe(DEMO_NOW);
    const version = app.getVersion();
    app.read({ kind: 'profile' });
    expect(app.getVersion()).toBe(version);
    const actor = app.getActor(); actor.userId = 'u-owner';
    expect(app.getActor().userId).toBe('u-lin');
    for (const key of ['state', 'store', 'getSnapshot', 'dispatch']) expect(app).not.toHaveProperty(key);
    expect(storage.getItem).toHaveBeenCalledOnce();
  });
  it.each(['{broken', JSON.stringify({ schemaVersion: 99 }), ''])('never overwrites corrupt snapshot %s', raw => {
    const { app, storage, saved } = setup(raw);
    expect(app.getBootError()?.code).toBe('CORRUPT_SNAPSHOT');
    expect(app.read({ kind: 'home', perspective: 'participant', openedActivityIds: [] }).kind).toBe('denied');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(saved()).toBe(raw);
  });
  it('handles blocked storage and initial quota without a fake successful view', async () => {
    for (const storage of [
      { getItem: () => { throw Error('blocked'); }, setItem: vi.fn() },
      { getItem: () => null, setItem: vi.fn(() => { throw Error('quota'); }) },
    ]) {
      const app = createRuntime({ storage, digest: hash });
      expect(app.getBootError()?.code).toBe('STORAGE_UNAVAILABLE');
      expect(app.read({ kind: 'profile' }).kind).toBe('denied');
      expect(await app.submitCommand(profilePayload())).toMatchObject({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } });
    }
  });
  it('loads valid storage without reseeding and rejects invariant corruption', () => {
    const initial = createFixture('transport', DEMO_NOW);
    expect(setup(JSON.stringify(initial)).storage.setItem).not.toHaveBeenCalled();
    initial.assignments[0].signupId = 'missing';
    const { app, storage } = setup(JSON.stringify(initial));
    expect(app.getBootError()?.code).toBe('CORRUPT_SNAPSHOT');
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('retains exact published snapshot on failed saves and resets, and preserves subscribers on reset', async () => {
    const { app, storage, saved } = setup();
    const notify = vi.fn(); app.subscribe(notify);
    const before = saved(); const version = app.getVersion(); const view = app.read({ kind: 'profile' });
    const persist = storage.setItem.getMockImplementation()!;
    storage.setItem.mockImplementation(() => { throw Error('quota'); });
    expect(await app.submitCommand(profilePayload())).toMatchObject({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } });
    expect(app.resetDemo('empty')).toMatchObject({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } });
    expect(saved()).toBe(before); expect(app.getVersion()).toBe(version);
    expect(app.read({ kind: 'profile' })).toEqual(view);
    expect(notify).not.toHaveBeenCalled();
    storage.setItem.mockImplementation(persist);
    for (const name of fixtureNames) expect(app.resetDemo(name).ok).toBe(true);
    expect(notify).toHaveBeenCalledTimes(fixtureNames.length);
    expect(app.getBootError()).toBeNull();
  });
  it('recovers corrupt storage only through explicit reset and leaves unrelated keys intact', () => {
    const values = new Map([[STORAGE_KEY, '{corrupt'], ['another-app', 'keep']]);
    const app = createRuntime({ storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } } });
    const error = app.getBootError()!; error.message = 'mutated';
    expect(app.getBootError()?.message).not.toBe('mutated');
    expect(app.resetDemo('signup').ok).toBe(true);
    expect(app.getBootError()).toBeNull(); expect(values.get('another-app')).toBe('keep');
    expect(app.read({ kind: 'profile' }).kind).toBe('profile');
  });
  it('retries a failed save with the same SHA-256 and request identity', async () => {
    const { app, storage, digest, saved } = setup();
    storage.setItem.mockImplementationOnce(() => { throw Error('quota'); });
    expect(await app.submitCommand(profilePayload(), 'retry-save', 0)).toMatchObject({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } });
    expect((await app.submitCommand(profilePayload(), 'retry-save', 0)).ok).toBe(true);
    expect(digest).toHaveBeenCalledOnce();
    expect(JSON.parse(saved()!).receipts).toHaveLength(1);
    expect(JSON.parse(saved()!).receipts[0].requestId).toBe('retry-save');
  });
});

describe('actor, time and request semantics', () => {
  it('validates before hashing and hashes canonical payload, replaying identical requests', async () => {
    const { app, digest } = setup();
    expect(await app.submitCommand({ type: 'invalid' } as unknown as Payload)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(digest).not.toHaveBeenCalled();
    const payload = profilePayload();
    expect(await app.submitCommand(payload, 'request-one', 0)).toMatchObject({ ok: true, value: { replayed: false } });
    expect(digest).toHaveBeenCalledWith(canonicalPayload(payload));
    expect(await app.submitCommand(payload, 'request-one', 0)).toMatchObject({ ok: true, value: { replayed: true } });
    expect(app.getRevision()).toBe(1);
  });
  it('captures actor before deferred hashing, including switch away and back', async () => {
    const { storage } = setup();
    let resolve!: (value: string) => void;
    const app = createRuntime({ storage, digest: () => new Promise(r => { resolve = r; }) });
    const pending = app.submitCommand(profilePayload());
    app.setDemoUser('u-owner'); app.setDemoUser('u-lin');
    resolve(await hash(canonicalPayload(profilePayload())));
    expect(await pending).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(app.getRevision()).toBe(0);
  });
  it('captures revision before hashing and does not silently rebase an older command', async () => {
    const { storage } = setup();
    let release!: (value: string) => void;
    let count = 0;
    const app = createRuntime({ storage, digest: text => ++count === 1 ? new Promise(r => { release = r; }) : hash(text) });
    const first = app.submitCommand(profilePayload('第一份'), 'first');
    expect((await app.submitCommand(profilePayload('第二份'), 'second')).ok).toBe(true);
    release(await hash(canonicalPayload(profilePayload('第一份'))));
    expect(await first).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });
  it('rejects offline before and after hash; storage/offline retries can reuse identity', async () => {
    const { app, digest } = setup();
    app.setOffline(true);
    expect(await app.submitCommand(profilePayload(), 'retry', 0)).toMatchObject({ ok: false, error: { code: 'OFFLINE' } });
    expect(digest).not.toHaveBeenCalled();
    app.setOffline(false);
    expect((await app.submitCommand(profilePayload(), 'retry', 0)).ok).toBe(true);
    const { storage } = setup(); let release!: (value: string) => void;
    const deferred = createRuntime({ storage, digest: () => new Promise(r => { release = r; }) });
    const pending = deferred.submitCommand(profilePayload()); deferred.setOffline(true);
    release(await hash(canonicalPayload(profilePayload())));
    expect(await pending).toMatchObject({ ok: false, error: { code: 'OFFLINE' } });
  });
  it('rejects pending commands after a successful reset and rechecks time-sensitive authority', async () => {
    const { storage } = setup(); let release!: (value: string) => void;
    const app = createRuntime({ storage, digest: () => new Promise(r => { release = r; }) });
    const pending = app.submitCommand(profilePayload()); app.resetDemo('signup');
    release(await hash(canonicalPayload(profilePayload())));
    expect(await pending).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    app.resetDemo('gathering'); app.setDemoUser('u-staff');
    const payload: Payload = { type: 'attendance.checkin', activityId: 'a1', signupId: 's-lin', checkIn: { method: 'manual', evidence: { at: DEMO_NOW, by: 'u-staff', note: '本人已到达' } } };
    expect(app.can(payload).ok).toBe(true);
    const expiring = app.submitCommand(payload);
    app.setDemoTime('2026-09-27T07:00:00+08:00');
    release(await hash(canonicalPayload(payload)));
    expect(await expiring).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(app.readContact('a1', 's-lin').ok).toBe(false);
  });
  it('binds specialized read projections to the actor without exposing mutable records', () => {
    const { app } = setup();
    expect(app.readSignupForm('a1', 's-lin', '修改本人信息').ok).toBe(true);
    expect(app.readSensitive('a1', 's-zhou', '好奇').ok).toBe(false);
    expect(app.readAccess('a1').ok).toBe(false);
    expect(app.readNoticeManagement('a1').ok).toBe(false);
    expect(app.readWeather('a1', 'pt-taian', '2026-09-26').status).toBe('ready');
    expect(app.readWeather('missing', 'pt-taian', '2026-09-26').status).toBe('unavailable');
    app.setDemoUser('u-owner');
    expect(app.readExport('a1', ['s-lin'], 'ordinary', '名单核对').ok).toBe(true);
    const access = app.readAccess('a1');
    expect(access.ok).toBe(true);
    if (access.ok) access.value.memberships.length = 0;
    const reread = app.readAccess('a1'); expect(reread.ok && reread.value.memberships.length).toBe(2);
  });
  it('isolates cloned drafts by actor, activity and form without render notifications; reset clears them', () => {
    const { app } = setup(); const notify = vi.fn(); app.subscribe(notify);
    const value = { name: 'draft' }; app.setDraft('a1', 'signup', value); value.name = 'mutated';
    expect(app.getDraft('a1', 'signup')).toEqual({ name: 'draft' });
    expect(notify).not.toHaveBeenCalled();
    expect(app.getDraft('a2', 'signup')).toBeUndefined();
    expect(app.getDraft('a1', 'edit')).toBeUndefined();
    app.setDemoUser('u-owner'); expect(app.getDraft('a1', 'signup')).toBeUndefined();
    app.setDemoUser('u-lin'); expect(app.getDraft('a1', 'signup')).toEqual({ name: 'draft' });
    app.rememberActivity('a1'); expect(app.getOpenedActivityIds()).toEqual(['a1']);
    app.resetDemo('signup'); expect(app.getDraft('a1', 'signup')).toBeUndefined();
    expect(app.getOpenedActivityIds()).toEqual([]);
  });
  it('perspective and remembered links never confer authority; invalid users and times do not publish', () => {
    const { app } = setup(); const version = app.getVersion();
    expect(app.setDemoUser('invented').ok).toBe(false);
    expect(app.setDemoTime('not a date').ok).toBe(false);
    expect(app.getVersion()).toBe(version);
    expect(app.rememberActivity('missing').ok).toBe(false);
    app.setPerspective('organizer'); app.rememberActivity('a1');
    expect(app.can({ type: 'activity.copy', sourceActivityId: 'a1' }).ok).toBe(false);
    expect(app.readTransport('a1').ok).toBe(false);
    app.setDemoUser('u-owner'); expect(app.previewAssignments('a1').ok).toBe(true);
  });
  it('ticks only elapsed minutes from demo time and releases its interval', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2040-01-01T00:00:00Z'));
    const { app } = setup(); const stop = app.startRuntimeClock();
    vi.advanceTimersByTime(120_000);
    expect(Date.parse(app.getNow())).toBe(Date.parse(DEMO_NOW) + 120_000);
    vi.setSystemTime(new Date('2050-01-01T00:00:00Z')); vi.advanceTimersByTime(60_000);
    expect(Date.parse(app.getNow())).toBe(Date.parse(DEMO_NOW) + 180_000);
    stop(); const now = app.getNow(); vi.advanceTimersByTime(60_000); expect(app.getNow()).toBe(now);
  });
});

describe('React subscriptions and commands', () => {
  // Supply the actual browser-standard algorithm, not a command/digest mock.
  beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });
  afterEach(() => { vi.unstubAllGlobals(); });
  it('reads stable version snapshots without accessing storage during render', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem'); const write = vi.spyOn(Storage.prototype, 'setItem');
    const hook = renderHook(() => ({ version: useRuntimeVersion(), view: useView({ kind: 'profile' }) }));
    const before = hook.result.current.version;
    hook.rerender(); expect(hook.result.current.version).toBe(before);
    expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  });
  it('retries offline input with identical identity/revision; a conflict requires a fresh explicit run', async () => {
    runtime.resetDemo('signup'); runtime.setDemoUser('u-lin'); runtime.setOffline(true);
    const submit = vi.spyOn(runtime, 'submitCommand');
    const hook = renderHook(useCommand); const payload = profilePayload();
    await act(async () => { await hook.result.current.run(payload); });
    expect(hook.result.current.error?.code).toBe('OFFLINE');
    const first = submit.mock.calls[0];
    await act(async () => { await hook.result.current.run(payload); });
    expect(submit.mock.calls[1]).toEqual(first);
    act(() => { runtime.setOffline(false); });
    await act(async () => { await runtime.submitCommand(profilePayload('另一项修改')); });
    await act(async () => { await hook.result.current.run(payload); });
    expect(hook.result.current.error?.code).toBe('CONFLICT');
    await act(async () => { await hook.result.current.run(payload); });
    expect(submit.mock.calls.at(-1)?.[1]).not.toBe(first[1]);
    expect(hook.result.current.error).toBeNull(); expect(hook.result.current.success).not.toBeNull();
  });
  it('keeps storage retry identity but changes it for edited input or another actor', async () => {
    runtime.resetDemo('signup'); runtime.setDemoUser('u-lin'); runtime.setOffline(false);
    const submit = vi.spyOn(runtime, 'submitCommand'); const hook = renderHook(useCommand);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw Error('quota'); });
    await act(async () => { await hook.result.current.run(profilePayload()); });
    expect(hook.result.current.error?.code).toBe('STORAGE_UNAVAILABLE');
    await act(async () => { await hook.result.current.run(profilePayload()); });
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]);
    expect(hook.result.current.success).not.toBeNull();
    act(() => { runtime.setOffline(true); });
    await act(async () => { await hook.result.current.run(profilePayload('第一份')); });
    await act(async () => { await hook.result.current.run(profilePayload('修改过')); });
    expect(submit.mock.calls[3][1]).not.toBe(submit.mock.calls[2][1]);
    act(() => { runtime.setDemoUser('u-owner'); });
    expect(hook.result.current.error).toBeNull(); expect(hook.result.current.success).toBeNull();
    await act(async () => { await hook.result.current.run(profilePayload('修改过')); });
    expect(submit.mock.calls[4][1]).not.toBe(submit.mock.calls[3][1]);
  });
  it('blocks duplicate pending clicks and clears command state immediately on actor switch', async () => {
    runtime.resetDemo('signup'); runtime.setDemoUser('u-lin'); runtime.setOffline(false);
    const submit = vi.spyOn(runtime, 'submitCommand'); const hook = renderHook(useCommand);
    let first!: ReturnType<typeof runtime.submitCommand>; let second!: typeof first;
    act(() => { first = hook.result.current.run(profilePayload()); second = hook.result.current.run(profilePayload()); });
    expect(submit).toHaveBeenCalledOnce();
    await act(async () => { await Promise.all([first, second]); });
    expect(hook.result.current.success).not.toBeNull();
    act(() => { runtime.setDemoUser('u-owner'); });
    expect(hook.result.current.success).toBeNull(); expect(hook.result.current.error).toBeNull();
  });
});

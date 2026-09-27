import { createFixture, fixtureNames, getWeather, type FixtureName } from '../data/fixtures';
import { createStore, loadSnapshot, STORAGE_KEY, type StoragePort } from '../data/store';
import {
  canonicalPayload, PayloadSchema, PerspectiveSchema, ReadRequestSchema,
  type Actor, type AuthorizedView, type Context, type DispatchResult, type DomainError,
  type Payload, type Perspective, type ReadRequest, type Result, type WeatherResult,
} from '../domain/contracts';
import { CountSchema, IdSchema, InstantSchema, StateSchema, type State } from '../domain/model';
import { assertInvariants } from '../domain/invariants';
import { canExecute } from '../domain/permissions';
import { planAssignments } from '../domain/allocation';
import {
  selectAccess, selectContact, selectExport, selectNoticeManagement, selectSensitive,
  selectSignupForm, selectTransport, selectView,
} from '../domain/selectors';

export const DEMO_NOW = '2026-09-24T07:00:00+08:00';
export type RuntimeOptions = {
  storage: StoragePort;
  now?: string;
  id?: (kind: string) => string;
  digest?: (text: string) => Promise<string>;
};
const failure = (code: DomainError['code'], message: string): { ok: false; error: DomainError } => ({ ok: false, error: { code, message } });
const success: Result<null> = { ok: true, value: null };
async function sha256(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

/** A private store boundary. Construct outside React render; all reads are storage-free. */
export function createRuntime(options: RuntimeOptions) {
  const context: Context = { now: options.now ?? DEMO_NOW, id: options.id ?? (() => globalThis.crypto.randomUUID()) };
  const digest = options.digest ?? sha256;
  let store: ReturnType<typeof createStore> | null = null;
  let detachStore: (() => void) | undefined;
  let bootError: DomainError | null = null;
  let actor: Actor = { userId: 'u-lin' };
  let actorEpoch = 0;
  let generation = 0;
  let perspective: Perspective = 'participant';
  let offline = false;
  let version = 0;
  let opened: string[] = [];
  const listeners = new Set<() => void>();
  const drafts = new Map<string, unknown>();
  const fingerprints = new Map<string, { canonical: string; digest: Promise<string> }>();
  const fixtureUsers = new Set(createFixture('signup', DEMO_NOW).profiles.map(profile => profile.id));
  const notify = () => { version += 1; listeners.forEach(listener => listener()); };
  const unavailable = () => ({ ok: false as const, error: structuredClone(bootError ?? { code: 'CORRUPT_SNAPSHOT' as const, message: '演示记录尚未载入，请确认后重置演示。' }) });
  const mutationError = () => bootError || !store ? unavailable() : offline ? failure('OFFLINE', '当前处于离线演示模式，本次修改未保存。请保留输入并在恢复后重试。') : null;
  const draftKey = (activityId: string, form: string) => JSON.stringify([actor.userId, activityId, form]);
  const publishStore = (state: State) => {
    detachStore?.();
    store = createStore(state, options.storage, context);
    detachStore = store.subscribe(notify);
  };
  function saveFixture(name: FixtureName): Result<State> {
    if (!fixtureNames.includes(name)) return failure('INVALID_INPUT', '未知的演示场景。');
    let state: State;
    try { state = StateSchema.parse(createFixture(name, context.now)); }
    catch { return failure('INVALID_INPUT', '演示场景或当前时间无效。'); }
    const valid = assertInvariants(state);
    if (!valid.ok) return valid;
    try { options.storage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { return failure('STORAGE_UNAVAILABLE', '演示记录没有保存，原记录未改变。请检查浏览器存储权限或空间。'); }
    return { ok: true, value: state };
  }
  if (!InstantSchema.safeParse(context.now).success) {
    bootError = failure('INVALID_INPUT', '演示时钟必须为有效的带时区 ISO 时间。').error;
  } else {
    const loaded = loadSnapshot(options.storage);
    if (!loaded.ok) bootError = loaded.error;
    else if (loaded.value) publishStore(loaded.value);
    else {
      const seeded = saveFixture('signup');
      if (seeded.ok) publishStore(seeded.value);
      else bootError = seeded.error;
    }
  }

  const read = (request: ReadRequest): AuthorizedView => {
    // AuthorizedView's denied code is deliberately narrower than DomainError.
    // The boot error remains available verbatim through getBootError().
    if (bootError || !store) return { kind: 'denied', code: 'FORBIDDEN', message: unavailable().error.message };
    const parsed = ReadRequestSchema.safeParse(request);
    if (!parsed.success) return { kind: 'denied', code: 'FORBIDDEN', message: '读取参数无效。' };
    return selectView(store.getSnapshot(), actor, parsed.data, context.now);
  };
  let clockUsers = 0;
  let interval: ReturnType<typeof setInterval> | undefined;
  let clockStarted = 0;
  let clockDemo = Date.parse(context.now);
  const startRuntimeClock = () => {
    if (clockUsers++ === 0) {
      clockStarted = performance.now(); clockDemo = Date.parse(context.now);
      interval = setInterval(() => {
        if (!Number.isFinite(clockDemo)) return;
        context.now = new Date(clockDemo + Math.max(0, performance.now() - clockStarted)).toISOString();
        notify();
      }, 60_000);
    }
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      if (--clockUsers === 0) { clearInterval(interval); interval = undefined; }
    };
  };

  return {
    getVersion: () => version,
    getRevision: () => store?.getSnapshot().revision ?? 0,
    getActor: (): Actor => ({ ...actor }),
    getPerspective: () => perspective,
    getNow: () => context.now,
    getBootError: () => bootError ? structuredClone(bootError) : null,
    isOffline: () => offline,
    getOpenedActivityIds: () => [...opened],
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    read,
    readSignupForm: (activityId: string, signupId: string, purpose: string) => store && !bootError ? selectSignupForm(store.getSnapshot(), actor, activityId, signupId, purpose, context.now) : unavailable(),
    readTransport: (activityId: string) => store && !bootError ? selectTransport(store.getSnapshot(), actor, activityId, context.now) : unavailable(),
    readAccess: (activityId: string) => store && !bootError ? selectAccess(store.getSnapshot(), actor, activityId, context.now) : unavailable(),
    readNoticeManagement: (activityId: string) => store && !bootError ? selectNoticeManagement(store.getSnapshot(), actor, activityId, context.now) : unavailable(),
    readSensitive: (activityId: string, signupId: string, purpose: string) => store && !bootError ? selectSensitive(store.getSnapshot(), actor, activityId, signupId, purpose, context.now) : unavailable(),
    readContact: (activityId: string, signupId: string) => store && !bootError ? selectContact(store.getSnapshot(), actor, activityId, signupId, context.now) : unavailable(),
    readExport: (activityId: string, signupIds: string[], mode: 'ordinary' | 'sensitive', purpose: string) => store && !bootError ? selectExport(store.getSnapshot(), actor, activityId, signupIds, mode, purpose, context.now) : unavailable(),
    readWeather: (activityId: string, pointId: string, date: string): WeatherResult => {
      const view = read({ kind: 'activity', activityId, perspective: 'participant' });
      return view.kind === 'activity' ? getWeather(view.activity, pointId, date, context.now)
        : { status: 'unavailable', message: view.kind === 'denied' ? view.message : '无法读取此活动。' };
    },
    previewAssignments: (activityId: string) => store && !bootError ? planAssignments(store.getSnapshot(), actor, activityId, context.now) : unavailable(),
    can: (payload: Payload): Result<null> => {
      const blocked = mutationError(); if (blocked) return blocked;
      const parsed = PayloadSchema.safeParse(payload);
      return parsed.success ? canExecute(store!.getSnapshot(), actor, parsed.data, context.now) : failure('INVALID_INPUT', '操作字段不完整或格式不正确。');
    },
    async submitCommand(payload: Payload, requestId?: string, expectedRevision?: number): Promise<DispatchResult> {
      const parsed = PayloadSchema.safeParse(payload);
      if (!parsed.success || (requestId !== undefined && !IdSchema.safeParse(requestId).success)
        || (expectedRevision !== undefined && !CountSchema.safeParse(expectedRevision).success)) {
        return failure('INVALID_INPUT', '操作字段不完整或格式不正确。');
      }
      const blocked = mutationError(); if (blocked) return blocked;
      const capturedActor = { ...actor };
      const capturedEpoch = actorEpoch;
      const capturedGeneration = generation;
      const revision = expectedRevision ?? store!.getSnapshot().revision;
      const canonical = canonicalPayload(parsed.data);
      let fingerprint: string;
      let request: string;
      try {
        request = requestId ?? context.id('request');
        if (!IdSchema.safeParse(request).success) return failure('INVALID_INPUT', '请求号无效，本次修改未保存。');
        const key = JSON.stringify([actorEpoch, generation, request]);
        let entry = fingerprints.get(key);
        if (!entry || entry.canonical !== canonical) {
          entry = { canonical, digest: digest(canonical) };
          if (fingerprints.size >= 100) fingerprints.delete(fingerprints.keys().next().value!);
          fingerprints.set(key, entry);
        }
        try { fingerprint = await entry.digest; }
        catch (error) { fingerprints.delete(key); throw error; }
      } catch { return failure('INVALID_INPUT', '无法生成安全请求摘要，请使用支持 Web Crypto 的安全浏览器环境后重试。'); }
      if (capturedEpoch !== actorEpoch || capturedGeneration !== generation) return failure('CONFLICT', '账号或演示记录已切换，本次修改未保存。请核对当前账号与内容后重新提交。');
      const changed = mutationError(); if (changed) return changed;
      if (!/^[a-f0-9]{64}$/.test(fingerprint)) return failure('INVALID_INPUT', '安全请求摘要无效，本次修改未保存。');
      // Use current time/permissions after hashing, never a stale authorization result.
      return store!.dispatch({ actor: capturedActor, requestId: request, expectedRevision: revision, fingerprint, payload: parsed.data });
    },
    /** Destructive demo action: caller must obtain explicit confirmation before invoking. */
    resetDemo: (name: FixtureName): Result<null> => {
      const saved = saveFixture(name); if (!saved.ok) return saved;
      publishStore(saved.value); bootError = null; generation += 1;
      if (!saved.value.profiles.some(profile => profile.id === actor.userId) && actor.userId !== null) { actor = { userId: 'u-lin' }; actorEpoch += 1; }
      fingerprints.clear(); drafts.clear(); opened = []; notify(); return success;
    },
    setDemoUser: (userId: string | null): Result<null> => {
      if (userId !== null && (!fixtureUsers.has(userId) || (store && !store.getSnapshot().profiles.some(profile => profile.id === userId)))) return failure('INVALID_INPUT', '请选择现有的演示账号。');
      if (actor.userId !== userId) { actor = { userId }; actorEpoch += 1; fingerprints.clear(); opened = []; notify(); }
      return success;
    },
    setPerspective: (value: Perspective): Result<null> => {
      if (!PerspectiveSchema.safeParse(value).success) return failure('INVALID_INPUT', '未知的显示视角。');
      if (perspective !== value) { perspective = value; notify(); } return success;
    },
    setDemoTime: (now: string): Result<null> => {
      if (!InstantSchema.safeParse(now).success) return failure('INVALID_INPUT', '请输入有效的带时区 ISO 时间。');
      if (context.now !== now) { context.now = now; clockDemo = Date.parse(now); clockStarted = performance.now(); notify(); } return success;
    },
    setOffline: (value: boolean) => { if (offline !== value) { offline = value; notify(); } },
    rememberActivity: (activityId: string): Result<null> => {
      const view = read({ kind: 'activity', activityId, perspective: 'participant' });
      if (view.kind !== 'activity') return view.kind === 'denied' ? failure(view.code, view.message) : failure('NOT_FOUND', '找不到此活动。');
      if (!opened.includes(activityId)) { opened = [...opened, activityId]; notify(); } return success;
    },
    getDraft: <T,>(activityId: string, form: string): T | undefined => structuredClone(drafts.get(draftKey(activityId, form))) as T | undefined,
    setDraft: <T,>(activityId: string, form: string, value: T) => { drafts.set(draftKey(activityId, form), structuredClone(value)); },
    clearDraft: (activityId: string, form: string) => { drafts.delete(draftKey(activityId, form)); },
    startRuntimeClock,
  };
}

export type Runtime = ReturnType<typeof createRuntime>;
// Access the browser storage property inside guarded port methods; privacy-mode
// property access can itself throw. Module initialization is outside React render.
export const runtime = createRuntime({ storage: {
  getItem: key => globalThis.localStorage.getItem(key),
  setItem: (key, value) => globalThis.localStorage.setItem(key, value),
} });
export const startRuntimeClock = runtime.startRuntimeClock;
